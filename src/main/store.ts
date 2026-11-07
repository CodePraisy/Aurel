import { app } from 'electron'
import { join, dirname, resolve, sep } from 'path'
import fs from 'fs'
import initSqlJs, { type Database } from 'sql.js'
import type { Collection, LibraryEntry, Project, Settings } from '@shared/types'

// ---------- paths ----------
let engineSetupRoot: string | undefined

export function useInstallerEngineRoot(machine: boolean): void {
  engineSetupRoot = machine ? paths.machineEngine : paths.data
  if (!engineSetupRoot) throw new Error('Could not locate the shared Windows installation folder.')
}

export const ENGINE_READY_FILE = 'default-model-ready'

export function enginePythonAt(root: string): string {
  return process.platform === 'win32' ? join(root, 'engine-venv', 'Scripts', 'python.exe') : join(root, 'engine-venv', 'bin', 'python')
}

export const paths = {
  get data() { return app.getPath('userData') },
  get library() { return join(app.getPath('userData'), 'Library') },
  get projects() { return join(app.getPath('userData'), 'Library', 'projects') },
  project(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid project id')
    return join(app.getPath('userData'), 'Library', 'projects', id)
  },
  /** Resolve a project-relative path, refusing anything outside the project folder. */
  inProject(id: string, rel: string) {
    const base = resolve(this.project(id))
    const full = resolve(base, rel)
    if (full !== base && !full.startsWith(base + sep)) throw new Error('Path escapes project')
    return full
  },
  get engineScript() {
    return app.isPackaged ? join(process.resourcesPath, 'engine', 'aurel_engine.py') : join(app.getAppPath(), 'engine', 'aurel_engine.py')
  },
  get machineEngine() {
    const common = process.env.CommonProgramW6432 ?? process.env.CommonProgramFiles
    return process.platform === 'win32' && common ? join(common, 'Aurel', 'AI Engine') : undefined
  },
  get engineRoot() {
    if (engineSetupRoot) return engineSetupRoot
    if (fs.existsSync(join(this.data, ENGINE_READY_FILE))) return this.data
    const shared = this.machineEngine
    return shared && fs.existsSync(join(shared, ENGINE_READY_FILE)) && fs.existsSync(enginePythonAt(shared)) ? shared : this.data
  },
  get engineInstallRoot() { return engineSetupRoot ?? this.data },
  get engineTools() { return join(this.engineInstallRoot, 'Tools') },
  get venv() { return join(this.engineInstallRoot, 'engine-venv') },
  get sounds() { return join(app.getPath('userData'), 'Sounds') },
  get customSounds() { return join(app.getPath('userData'), 'Custom Sounds') },
  get tools() { return join(app.getPath('userData'), 'Tools') },
  get venvPython() { return enginePythonAt(this.engineInstallRoot) },
  get ffmpeg(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p: string = require('ffmpeg-static')
    return p.replace('app.asar', 'app.asar.unpacked')
  }
}

export function writeAtomic(file: string, data: string | Uint8Array): void {
  fs.mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

// ---------- settings ----------
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'gold',
  reduceMotion: false,
  pythonPath: '',
  ytDlpPath: '',
  device: 'auto',
  separationModel: 'htdemucs_ft',
  drumSplit: true,
  transcribeQuality: 'balanced',
  noteSensitivity: 0.5,
  rhythmDetail: 'standard',
  fillGaps: true,
  straightSwing: true,
  followTempo: true,
  vocalMelody: false,
  lyricWords: true,
  lyricsModel: 'base',
  lyricsLanguage: '',
  drumModel: 'adtof',
  guitarChordLimit: 6,
  particleSpeed: 1,
  particleSize: 1,
  openAfterImport: true,
  autoProcess: false,
  metronomeVolume: 0.6,
  countInBars: 1,
  defaultView: 'both',
  pianoGrandStaff: true,
  noteInputPreview: true,
  export: { sampleRate: 44100, bitDepth: 24, channels: 2, normalize: true, tail: 2 },
  soundfont: '',
  vstFolders: [],
  fxDefaults: {},
  outputDevice: '',
  latency: 'interactive',
  sampleRate: 0,
  bufferSize: 256,
  midiInput: '',
  midiChannel: 0,
  auditionTrack: 'selected',
  effectTails: true,
  countInOn: false,
  vstDisabled: [],
  customSounds: [],
  vstInstruments: [],
  soundSwaps: {},
  checkUpdates: true,
  skippedVersion: '',
  masterVolume: 0.9,
  autoScroll: true,
  soloFollowsView: true,
  cursorStyle: 'band',
  highlightNotes: true,
  inputMode: 'write',
  uiScale: 1,
  termsAccepted: false,
  autoSetup: true,
  setupDone: false,
  particles: 36,
  deleteMode: 'rest',
  sidebarOpen: true,
  sessions: [],
  sessionFolders: []
}

let settingsCache: Settings | null = null
export function getSettings(): Settings {
  if (settingsCache) return settingsCache
  try {
    const raw = JSON.parse(fs.readFileSync(join(paths.data, 'settings.json'), 'utf8'))
    settingsCache = { ...DEFAULT_SETTINGS, ...raw, export: { ...DEFAULT_SETTINGS.export, ...(raw.export ?? {}) } }
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS }
  }
  return settingsCache!
}
export function setSettings(patch: Partial<Settings>): Settings {
  settingsCache = { ...getSettings(), ...patch }
  writeAtomic(join(paths.data, 'settings.json'), JSON.stringify(settingsCache, null, 2))
  return settingsCache
}

// ---------- library database (SQLite via sql.js) ----------
let db: Database
let flushTimer: NodeJS.Timeout | null = null
const dbFile = () => join(paths.library, 'aurel.db')

export async function openLibrary(): Promise<void> {
  fs.mkdirSync(paths.projects, { recursive: true })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm').replace('app.asar', 'app.asar.unpacked')
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) as unknown as ArrayBuffer })
  let data: Uint8Array | undefined
  try { data = fs.readFileSync(dbFile()) } catch { /* new library */ }
  try { db = new SQL.Database(data) } catch { db = new SQL.Database() }
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT, artist TEXT, kind TEXT, created INTEGER, updated INTEGER, opened INTEGER,
    favorite INTEGER DEFAULT 0, duration REAL DEFAULT 0, artwork TEXT, status TEXT, source TEXT, hash TEXT, youtube_id TEXT);
    CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS collection_items (collection_id TEXT, project_id TEXT, PRIMARY KEY (collection_id, project_id));
    CREATE INDEX IF NOT EXISTS idx_hash ON projects(hash);
    CREATE INDEX IF NOT EXISTS idx_yt ON projects(youtube_id);`)
  reindex()
}

/** Crash recovery: make the index agree with the project folders on disk. */
function reindex(): void {
  const known = new Set(all<{ id: string }>('SELECT id FROM projects').map((r) => r.id))
  const onDisk = new Set<string>()
  for (const id of fs.readdirSync(paths.projects)) {
    const p = loadProjectFile(id)
    if (!p) continue
    onDisk.add(id)
    if (!known.has(id)) indexProject(p, {})
  }
  for (const id of known) if (!onDisk.has(id)) run('DELETE FROM projects WHERE id = ?', [id])
  flush()
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 250)
}
export function flush(): void {
  if (!db) return
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  writeAtomic(dbFile(), db.export())
}

function all<T>(sql: string, params: (string | number | null)[] = []): T[] {
  const st = db.prepare(sql)
  st.bind(params)
  const rows: T[] = []
  while (st.step()) rows.push(st.getAsObject() as T)
  st.free()
  return rows
}
function run(sql: string, params: (string | number | null)[] = []): void {
  db.run(sql, params)
  scheduleFlush()
}

export function listEntries(): LibraryEntry[] {
  const coll = all<{ collection_id: string; project_id: string }>('SELECT * FROM collection_items')
  return all<Record<string, unknown>>('SELECT * FROM projects ORDER BY updated DESC').map((r) => ({
    id: r.id as string,
    title: r.title as string,
    artist: (r.artist as string) ?? '',
    kind: r.kind as LibraryEntry['kind'],
    created: r.created as number,
    updated: r.updated as number,
    opened: (r.opened as number) ?? 0,
    favorite: !!r.favorite,
    duration: (r.duration as number) ?? 0,
    artwork: (r.artwork as string) || null,
    status: ((r.status as string) || 'none') as LibraryEntry['status'],
    source: (r.source as string) || null,
    collections: coll.filter((c) => c.project_id === r.id).map((c) => c.collection_id)
  }))
}

export function indexProject(p: Project, extra: { hash?: string; youtubeId?: string; artwork?: string; source?: string; opened?: number }): void {
  const existing = all<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [p.id])[0]
  const artwork = extra.artwork ?? (existing?.artwork as string) ?? (fs.existsSync(join(paths.project(p.id), 'artwork.jpg')) ? 'artwork.jpg' : null)
  db.run(
    `INSERT INTO projects (id, title, artist, kind, created, updated, opened, favorite, duration, artwork, status, source, hash, youtube_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, artist=excluded.artist, kind=excluded.kind, updated=excluded.updated,
       opened=excluded.opened, duration=excluded.duration, artwork=excluded.artwork, status=excluded.status,
       source=excluded.source, hash=excluded.hash, youtube_id=excluded.youtube_id`,
    [
      p.id, p.score.title, p.score.composer, p.kind, p.created, p.updated,
      extra.opened ?? (existing?.opened as number) ?? 0, (existing?.favorite as number) ?? 0,
      p.audio?.duration ?? 0, artwork, p.analysis?.status ?? 'none',
      extra.source ?? (existing?.source as string) ?? p.audio?.sourceUrl ?? null,
      extra.hash ?? (existing?.hash as string) ?? null,
      extra.youtubeId ?? (existing?.youtube_id as string) ?? p.audio?.youtube?.id ?? null
    ]
  )
  scheduleFlush()
}

export function findDuplicate(by: 'hash' | 'youtube_id', value: string): string | undefined {
  return all<{ id: string }>(`SELECT id FROM projects WHERE ${by === 'hash' ? 'hash' : 'youtube_id'} = ? LIMIT 1`, [value])[0]?.id
}

export function markOpened(id: string): void { run('UPDATE projects SET opened = ? WHERE id = ?', [Date.now(), id]) }
export function setFavorite(id: string, fav: boolean): void { run('UPDATE projects SET favorite = ? WHERE id = ?', [fav ? 1 : 0, id]) }

export function removeProject(id: string): void {
  run('DELETE FROM projects WHERE id = ?', [id])
  run('DELETE FROM collection_items WHERE project_id = ?', [id])
  fs.rmSync(paths.project(id), { recursive: true, force: true })
  flush()
}

export function listCollections(): Collection[] {
  return all<{ id: string; name: string; count: number }>(
    'SELECT c.id, c.name, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS count FROM collections c ORDER BY c.created'
  )
}
export function createCollection(name: string): Collection {
  const id = `c${Date.now().toString(36)}`
  run('INSERT INTO collections (id, name, created) VALUES (?,?,?)', [id, name, Date.now()])
  return { id, name, count: 0 }
}
export function deleteCollection(id: string): void {
  run('DELETE FROM collections WHERE id = ?', [id])
  run('DELETE FROM collection_items WHERE collection_id = ?', [id])
}
export function setInCollection(cid: string, pid: string, inIt: boolean): void {
  if (inIt) run('INSERT OR IGNORE INTO collection_items (collection_id, project_id) VALUES (?,?)', [cid, pid])
  else run('DELETE FROM collection_items WHERE collection_id = ? AND project_id = ?', [cid, pid])
}

// ---------- project files ----------
export function loadProjectFile(id: string): Project | null {
  const dir = paths.project(id)
  for (const f of ['project.json', 'project.bak.json']) {
    try { return JSON.parse(fs.readFileSync(join(dir, f), 'utf8')) as Project } catch { /* try backup */ }
  }
  return null
}

export function saveProjectFile(p: Project): void {
  const dir = paths.project(p.id)
  fs.mkdirSync(dir, { recursive: true })
  const file = join(dir, 'project.json')
  if (fs.existsSync(file)) fs.copyFileSync(file, join(dir, 'project.bak.json'))
  writeAtomic(file, JSON.stringify(p))
  indexProject(p, {})
}
