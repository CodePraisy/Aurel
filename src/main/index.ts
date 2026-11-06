import { app, BrowserWindow, dialog, ipcMain, protocol, shell, nativeTheme, nativeImage } from 'electron'
import { join, extname, basename } from 'path'
import fs from 'fs'
import { Readable } from 'stream'
import JSZip from 'jszip'
import { TRANSCRIPTION_SOURCES, type Project, type Settings, type TranscriptionSource } from '@shared/types'
import {
  paths, openLibrary, flush, listEntries, setFavorite, removeProject, listCollections, createCollection, deleteCollection,
  setInCollection, loadProjectFile, saveProjectFile, markOpened, getSettings, setSettings, indexProject, useInstallerEngineRoot, writeAtomic
} from './store'
import { startJob, cancelJob, activeJobs } from './jobs'
import { importAudioJob, importUrlJob, convertWav, newId, AUDIO_EXT, pitchShift } from './media'
import { guessTempo } from './analyze'
import { checkYouTube, acquireYouTubeJob } from './youtube'
import { engineStatus, installEngineJob, processJob } from './engine'
import { packStatus, downloadPacksJob, addCustomSound, removeCustomSound } from './sounds'
import { installYtDlp } from './tools'
import { checkForUpdate, installUpdate } from './updater'
import { SOUND_PACKS } from '@shared/sounds'
import {
  clearVstFailures, closeAllTracks, closeTrack, editTrackPlugin, openTrack, pluginParameters, prepareStemStream, renderTrack, scanVst,
  setOwnerWindow, trackChain, trackSend, vstComponents, vstFailures
} from './vst'

protocol.registerSchemesAsPrivileged([
  { scheme: 'aurel', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

let main: BrowserWindow | null = null
const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

const BG: Record<Settings['theme'], string> = { dark: '#0e0f13', light: '#f6f5f2', sakura: '#220f1b' }

function rendererUrl(hash = ''): { url?: string; file?: string; hash: string } {
  if (isDev) return { url: `${process.env.ELECTRON_RENDERER_URL}#${hash}`, hash }
  return { file: join(__dirname, '../renderer/index.html'), hash }
}

function loadRenderer(win: BrowserWindow, hash = ''): void {
  const r = rendererUrl(hash)
  if (r.url) win.loadURL(r.url)
  else win.loadFile(r.file!, { hash })
}

function secureWebPreferences(): Electron.WebPreferences {
  return { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true, spellcheck: false }
}

function createWindow(): void {
  const theme = getSettings().theme
  main = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1024, minHeight: 680,
    backgroundColor: BG[theme], show: false, title: 'Aurel',
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'build', 'icon.png'),
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32' ? { color: '#00000000', symbolColor: theme === 'light' ? '#3a3530' : '#d8d6cf', height: 40 } : undefined,
    // The native plug-in window can cover Studio while its renderer still schedules audio.
    webPreferences: { ...secureWebPreferences(), backgroundThrottling: false }
  })
  main.once('ready-to-show', () => main?.show())
  try { setOwnerWindow(main.getNativeWindowHandle()) } catch { /* editors just open unowned */ }
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  main.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) e.preventDefault() })
  loadRenderer(main)
}

/** aurel://p/<projectId>/<relative path> — streams project files with Range support. */
function registerProtocol(): void {
  protocol.handle('aurel', async (req) => {
    const u = new URL(req.url)
    const [kind, id, ...rest] = [u.hostname, ...u.pathname.split('/').filter(Boolean)]
    if ((kind !== 'p' && kind !== 's' && kind !== 'c') || !id) return new Response('Not found', { status: 404 })
    let file: string
    try {
      if (kind === 's') {
        if (!/^[\w-]+$/.test(id) || rest.length !== 1 || !/^[\w-]+\.mp3$/.test(rest[0])) throw new Error('bad')
        file = join(paths.sounds, id, rest[0])
      } else if (kind === 'c') {
        if (!/^[\w-]+$/.test(id) || rest.length !== 1 || !/^[\w-]+\.wav$/.test(rest[0])) throw new Error('bad')
        file = join(paths.customSounds, id, rest[0])
      } else file = paths.inProject(id, decodeURIComponent(rest.join('/')))
    } catch { return new Response('Forbidden', { status: 403 }) }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('Not found', { status: 404 })
    const size = fs.statSync(file).size
    const types: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mid': 'audio/midi' }
    const type = types[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.get('range')
    const m = range?.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      const start = m[1] ? +m[1] : 0
      const end = m[2] ? Math.min(+m[2], size - 1) : size - 1
      const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream
      return new Response(stream, { status: 206, headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' } })
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })
}

// ---------- PDF printing ----------
const printParams = new Map<number, unknown>()
async function printPdf(projectId: string, out: string, opts: Record<string, unknown>): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: secureWebPreferences() })
  printParams.set(win.webContents.id, { projectId, ...opts })
  try {
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out rendering score')), 60000)
      ipcMain.once(`print:ready:${win.webContents.id}`, () => { clearTimeout(t); resolve() })
    })
    loadRenderer(win, 'print')
    await ready
    const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } })
    fs.writeFileSync(out, pdf)
  } finally {
    printParams.delete(win.webContents.id)
    win.destroy()
  }
}

// ---------- portable project files ----------
async function exportPortable(id: string): Promise<string | null> {
  const p = loadProjectFile(id)
  if (!p) throw new Error('Project not found')
  const res = await dialog.showSaveDialog(main!, { defaultPath: `${p.score.title.replace(/[\\/:*?"<>|]/g, '_')}.aurel`, filters: [{ name: 'Aurel project', extensions: ['aurel'] }] })
  if (res.canceled || !res.filePath) return null
  const zip = new JSZip()
  const dir = paths.project(id)
  const walk = (rel: string) => {
    for (const f of fs.readdirSync(join(dir, rel))) {
      const r = rel ? `${rel}/${f}` : f
      if (fs.statSync(join(dir, r)).isDirectory()) walk(r)
      else if (!f.endsWith('.tmp') && f !== 'project.bak.json') zip.file(r, fs.readFileSync(join(dir, r)))
    }
  }
  walk('')
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } })
  fs.writeFileSync(res.filePath, buf)
  return res.filePath
}

async function importPortable(): Promise<string | null> {
  const res = await dialog.showOpenDialog(main!, { filters: [{ name: 'Aurel project', extensions: ['aurel'] }], properties: ['openFile'] })
  if (res.canceled || !res.filePaths[0]) return null
  const zip = await JSZip.loadAsync(fs.readFileSync(res.filePaths[0]))
  const pj = zip.file('project.json')
  if (!pj) throw new Error('Not an Aurel project file')
  const project = JSON.parse(await pj.async('string')) as Project
  const id = newId()
  const dir = paths.project(id)
  for (const [name, f] of Object.entries(zip.files)) {
    if (f.dir || name.includes('..')) continue
    const target = paths.inProject(id, name)
    fs.mkdirSync(join(target, '..'), { recursive: true })
    fs.writeFileSync(target, await f.async('nodebuffer'))
  }
  project.id = id
  project.updated = Date.now()
  saveProjectFile(project)
  const cover = fs.readdirSync(dir).find((name) => /^cover-[a-z0-9]+\.jpg$/.test(name))
  if (cover) indexProject(project, { artwork: cover })
  return id
}

// ---------- IPC ----------
function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('lib:list', () => listEntries())
  h('lib:fav', (_e, id: string, fav: boolean) => setFavorite(id, fav))
  h('lib:remove', (_e, id: string) => removeProject(id))
  h('lib:collections', () => listCollections())
  h('lib:createCollection', (_e, name: string) => createCollection(name))
  h('lib:deleteCollection', (_e, id: string) => deleteCollection(id))
  h('lib:setInCollection', (_e, c: string, p: string, v: boolean) => setInCollection(c, p, v))
  h('lib:exportPortable', (_e, id: string) => exportPortable(id))
  h('lib:importPortable', () => importPortable())
  h('lib:reveal', (_e, id: string) => shell.openPath(paths.project(id)))

  h('project:create', (_e, p: Project) => saveProjectFile(p))
  h('project:load', (_e, id: string) => {
    const p = loadProjectFile(id)
    if (!p) throw new Error('Project not found or unreadable')
    markOpened(id)
    return p
  })
  h('project:save', (_e, p: Project, analysisComplete = false) => {
    const disk = loadProjectFile(p.id)
    if (!disk) throw new Error('Project not found.')
    if (p.audio && disk.audio?.trimmed !== undefined && p.audio.trimmed === undefined) {
      p.audio = { ...p.audio, duration: disk.audio.duration, trimmed: disk.audio.trimmed, offset: Math.max(0, p.audio.offset - disk.audio.trimmed) }
    }
    if (!analysisComplete && disk.analysis) {
      if ((disk.analysis.finishedAt ?? 0) > (p.analysis?.finishedAt ?? 0)) {
        p.score = { ...disk.score, title: p.score.title, composer: p.score.composer }
        p.audio = disk.audio
        p.view = disk.view
        p.analysis = disk.analysis
      } else p.analysis = { ...disk.analysis, rhythm: p.analysis?.rhythm === undefined ? disk.analysis.rhythm : p.analysis.rhythm }
    }
    saveProjectFile(p)
  })
  h('project:cover', async (_e, id: string) => {
    if (!loadProjectFile(id)) throw new Error('Project not found.')
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] })
    if (picked.canceled || !picked.filePaths[0]) return false
    const image = nativeImage.createFromPath(picked.filePaths[0])
    if (image.isEmpty()) throw new Error('This image could not be opened.')
    const project = loadProjectFile(id)
    if (!project) throw new Error('Project not found.')
    const { width, height } = image.getSize()
    const scale = Math.min(1, 1024 / Math.max(width, height))
    const artwork = `cover-${newId().slice(1)}.jpg`
    const oldArtwork = listEntries().find((entry) => entry.id === id)?.artwork
    fs.writeFileSync(join(paths.project(id), artwork), image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }).toJPEG(88))
    indexProject(project, { artwork })
    if (oldArtwork && /^cover-[a-z0-9]+\.jpg$/.test(oldArtwork)) fs.rmSync(join(paths.project(id), oldArtwork), { force: true })
    return true
  })
  h('project:readText', (_e, id: string, rel: string) => fs.readFileSync(paths.inProject(id, rel), 'utf8'))

  h('media:pickAudio', async () => {
    const r = await dialog.showOpenDialog(main!, { properties: ['openFile'], filters: [{ name: 'Audio & video', extensions: AUDIO_EXT }, { name: 'All files', extensions: ['*'] }] })
    return r.canceled ? null : r.filePaths[0]
  })
  h('media:pickMidi', async () => {
    const r = await dialog.showOpenDialog(main!, { properties: ['openFile'], filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const b = fs.readFileSync(r.filePaths[0])
    return { name: basename(r.filePaths[0]).replace(/\.midi?$/i, ''), data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
  })
  h('media:importAudio', (_e, path: string, opts?: { allowDuplicate?: boolean }) => ({ jobId: startJob('import', (ctx) => importAudioJob(ctx, path, !!opts?.allowDuplicate)) }))
  h('media:importUrl', (_e, url: string) => ({ jobId: startJob('import', (ctx) => importUrlJob(ctx, url)) }))
  h('media:analyzeRhythm', (_e, id: string) => {
    const p = loadProjectFile(id)
    if (!p?.audio) throw new Error('This project has no recording to analyze.')
    return guessTempo(paths.inProject(id, p.audio.original))
  })
  h('vst:scan', () => scanVst())
  h('vst:components', (_e, path) => vstComponents(path))
  h('vst:failures', () => vstFailures())
  h('vst:clearFailures', () => clearVstFailures())
  h('vst:parameters', (_e, track, slotId, plugin) => pluginParameters(track, slotId, plugin))
  h('vst:edit', (_e, track, slotId, configuration, title) => editTrackPlugin(track, slotId, configuration, String(title ?? '')))
  h('vst:open', (e, track: string, sampleRate: number, blockSize: number) => openTrack(e.sender, track, sampleRate, blockSize))
  h('vst:close', (_e, track: string) => closeTrack(track))
  h('vst:chain', (_e, track, slots) => trackChain(track, slots))
  ipcMain.on('vst:send', (_e, track: string, lines: string[]) => trackSend(track, lines))
  h('vst:stem', (_e, id: string, rel: string, semis: number, speed: number, sampleRate: number) => prepareStemStream(id, rel, semis, speed, sampleRate))
  h('vst:render', (_e, spec) => renderTrack(spec))
  h('media:peaks', (_e, id: string) => { try { return JSON.parse(fs.readFileSync(join(paths.project(id), 'peaks.json'), 'utf8')) } catch { return null } })

  h('media:pitchShift', (_e, id: string, rel: string, semis: number) => pitchShift(id, rel, semis))

  h('yt:check', (_e, url: string) => checkYouTube(url))
  h('yt:acquire', (_e, url: string) => ({ jobId: startJob('youtube', (ctx) => acquireYouTubeJob(ctx, url)) }))
  h('yt:update', () => ({ jobId: startJob('tools', (ctx) => installYtDlp(ctx, true)) }))

  h('sounds:status', () => packStatus())
  h('sounds:download', (_e, ids: string[]) => ({ jobId: startJob('sounds', (ctx) => downloadPacksJob(ctx, ids)) }))
  h('sounds:pickSamples', async () => {
    const r = await dialog.showOpenDialog(main!, { title: 'Choose samples for your instrument', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] }] })
    return r.canceled ? [] : r.filePaths
  })
  h('sounds:addCustom', (_e, name: string, files: string[], into?: string) => addCustomSound(name, files, into))
  h('sounds:removeCustom', (_e, id: string) => removeCustomSound(id))
  h('setup:run', () => ({ jobId: startJob('tools', async (ctx) => {
    await downloadPacksJob(ctx, SOUND_PACKS.map((p) => p.id))
    try { await installYtDlp(ctx) } catch { /* YouTube tools are retried on first use */ }
    return packStatus()
  }) }))

  h('updates:check', () => checkForUpdate())
  h('updates:install', () => ({ jobId: startJob('update', installUpdate, undefined, { key: 'app-update' }) }))
  ipcMain.on('updates:version', (e) => { e.returnValue = app.getVersion() })
  h('engine:status', (_e, force?: boolean) => engineStatus(!!force))
  h('engine:install', () => ({ jobId: startJob('install', installEngineJob, undefined, { key: 'engine-install' }) }))
  h('engine:process', (_e, id: string, sources?: TranscriptionSource[]) => {
    const selected = sources ? TRANSCRIPTION_SOURCES.filter((source) => sources.includes(source)) : undefined
    return { jobId: startJob('process', (ctx) => processJob(ctx, id, selected), undefined, { key: `process:${id}`, projectId: id }) }
  })

  h('jobs:cancel', (_e, id: string) => cancelJob(id))
  h('jobs:active', () => activeJobs())

  h('settings:get', () => getSettings())
  h('settings:set', (_e, patch: Partial<Settings>) => {
    const s = setSettings(patch)
    if (patch.theme && main && process.platform === 'win32') {
      try { main.setTitleBarOverlay({ color: '#00000000', symbolColor: s.theme === 'light' ? '#3a3530' : '#d8d6cf', height: 40 }) } catch { /* not supported */ }
      main.setBackgroundColor(BG[s.theme])
    }
    nativeTheme.themeSource = s.theme === 'light' ? 'light' : 'dark'
    return s
  })

  h('export:saveDialog', async (_e, name: string, filters: Electron.FileFilter[]) => {
    const r = await dialog.showSaveDialog(main!, { defaultPath: name, filters })
    return r.canceled ? null : r.filePath
  })
  h('export:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(main!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  h('export:writeFile', (_e, path: string, data: Uint8Array | string) => writeAtomic(path, typeof data === 'string' ? data : Buffer.from(data)))
  h('export:writeAudio', async (_e, path: string, wav: Uint8Array, format: 'wav' | 'mp3' | 'flac') => {
    if (format === 'wav') return writeAtomic(path, Buffer.from(wav))
    const tmp = join(app.getPath('temp'), `aurel-${Date.now()}.wav`)
    fs.writeFileSync(tmp, Buffer.from(wav))
    try { await convertWav(null, tmp, path, format) } finally { fs.rmSync(tmp, { force: true }) }
  })
  h('export:pdf', (_e, id: string, out: string, opts: Record<string, unknown>) => printPdf(id, out, opts))
  h('export:openPath', (_e, p: string) => shell.openPath(p))
  h('print:params', (e) => printParams.get(e.sender.id) ?? null)
  ipcMain.on('print:ready', (e) => ipcMain.emit(`print:ready:${e.sender.id}`))
  h('shell:openExternal', (_e, url: string) => { if (/^https:\/\//.test(url)) return shell.openExternal(url) })
}

const installForMachine = process.argv.includes('--install-ai-engine-for-machine')
const setupAi = installForMachine || process.argv.includes('--install-ai-engine')
if (setupAi) {
  app.whenReady().then(() => {
    useInstallerEngineRoot(installForMachine)
    let lastStage = ''
    startJob('install', installEngineJob, (update) => {
      if (update.log) console.log(update.log)
      if (update.stage !== lastStage) {
        lastStage = update.stage
        console.log(update.stage)
      }
      if (update.done) {
        const message = update.error ?? 'AI transcription is ready.'
        process.stdout.write(`${message}\n`, () => app.exit(update.error ? 1 : 0))
      }
    })
  }).catch((error) => {
    process.stdout.write(`${(error as Error).message}\n`, () => app.exit(1))
  })
}
else if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus() } })
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.aurel.studio')
    await openLibrary()
    nativeTheme.themeSource = getSettings().theme === 'light' ? 'light' : 'dark'
    registerProtocol()
    registerIpc()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('before-quit', () => { flush(); void closeAllTracks() })
  app.on('window-all-closed', () => { flush(); if (process.platform !== 'darwin') app.quit() })
}
