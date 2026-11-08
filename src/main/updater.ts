import { app, net, shell } from 'electron'
import fs from 'fs'
import { dirname, join } from 'path'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline, finished } from 'stream/promises'
import type { UpdateInfo } from '@shared/types'
import { newer } from '@shared/version'
import type { JobCtx } from './jobs'
import { paths } from './store'

// Releases are published on GitHub; each one carries the downloads for every platform.
const REPO = 'CodePraisy/Aurel'

let latest: UpdateInfo | null = null
let prepared: { info: UpdateInfo; dir: string; file: string } | null = null
let restarting = false


/** Which download replaces this copy of Aurel. */
function assetPattern(): RegExp | null {
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? /-Windows-x64-Portable\.exe$/i : /-Windows-x64\.exe$/i
  if (process.platform === 'darwin') return process.arch === 'arm64' ? /-macOS-arm64\.zip$/i : /-macOS-x64\.zip$/i
  return null
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  let res: Response
  try {
    res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Aurel/${current}` }, signal: AbortSignal.timeout(10000) })
  } catch {
    return { current, available: false, error: 'Could not reach GitHub. Check your internet connection.' }
  }
  if (res.status === 404) return { current, available: false, error: 'No published release was found. (Update checks need the GitHub repository or its releases to be public.)' }
  if (!res.ok) return { current, available: false, error: `GitHub answered ${res.status}. Try again later.` }
  const release = await res.json() as { tag_name: string; name?: string; body?: string; html_url: string; draft?: boolean; prerelease?: boolean; assets: { name: string; size: number; browser_download_url: string }[] }
  const version = release.tag_name.replace(/^v/i, '')
  const pattern = assetPattern()
  const asset = pattern ? release.assets.find((a) => pattern.test(a.name)) : undefined
  latest = {
    current, version, available: !release.draft && !release.prerelease && newer(version, current),
    notes: (release.body ?? '').slice(0, 4000), page: release.html_url,
    asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : undefined,
    canInstall: !!asset && (process.platform === 'win32' || process.platform === 'darwin')
  }
  return latest
}

async function download(ctx: JobCtx, url: string, file: string, size: number): Promise<void> {
  ctx.check()
  const res = await net.fetch(url, { signal: ctx.signal })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || size
  fs.mkdirSync(dirname(file), { recursive: true })
  const out = fs.createWriteStream(`${file}.part`, { fd: fs.openSync(`${file}.part`, 'w') })
  const closed = finished(out).catch(() => undefined)
  let got = 0
  try {
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), async function* (source) {
      for await (const value of source) {
        ctx.check()
        got += value.length
        ctx.progress('Downloading update', total ? got / total : -1, `${(got / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB`)
        yield value
      }
    }, out, { signal: ctx.signal })
    ctx.check()
    if (total && got < total) throw new Error('The download was interrupted. Try again.')
    fs.renameSync(`${file}.part`, file)
  } finally {
    out.destroy()
    await closed
    fs.rmSync(`${file}.part`, { force: true })
  }
}

function detached(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

/** Download and stage the release. Keep the running app untouched until restart is requested. */
export async function installUpdate(ctx: JobCtx): Promise<UpdateInfo> {
  if (prepared && fs.existsSync(prepared.file)) return prepared.info
  const info = latest ?? await checkForUpdate()
  if (!info.available || !info.asset || !info.canInstall) throw new Error('There is no update to install.')
  const dir = join(paths.data, 'updates')
  fs.rmSync(dir, { recursive: true, force: true })
  const file = join(dir, info.asset.name)
  await download(ctx, info.asset.url, file, info.asset.size)
  ctx.progress('Update ready', 1, 'Keep working, or restart when you’re ready')
  prepared = { info, dir, file }
  return info
}

/** Only the explicit Restart now action hands off to the installer and quits. */
export async function restartForUpdate(): Promise<void> {
  if (restarting) return
  if (!prepared || !fs.existsSync(prepared.file)) throw new Error('Download the update before restarting.')
  restarting = true
  const { info, dir, file } = prepared
  try {
  if (process.platform === 'win32') {
    const portable = process.env.PORTABLE_EXECUTABLE_FILE
    if (portable) {
      // replace the portable .exe once this one has exited, then start the new one
      const script = join(dir, 'update.cmd')
      fs.writeFileSync(script, [
        '@echo off',
        `:wait`,
        `tasklist /FI "PID eq ${process.pid}" | find "${process.pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
        `copy /y "${file}" "${portable}" >nul`,
        `start "" "${portable}"`,
        `del "${file}"`,
        `(goto) 2>nul & del "%~f0"`
      ].join('\r\n'))
      await detached('cmd.exe', ['/c', script])
    } else {
      // NSIS: silent install over the current one (same install scope), then relaunch
      const perMachine = /program files/i.test(app.getPath('exe'))
      await detached(file, ['/S', '--updated', '--force-run', perMachine ? '/allusers' : '/currentuser'])
    }
  } else if (process.platform === 'darwin') {
    const bundle = join(app.getPath('exe'), '..', '..', '..') // …/Aurel.app
    const unpacked = join(dir, 'unpacked')
    const script = join(dir, 'update.sh')
    fs.writeFileSync(script, [
      '#!/bin/sh',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
      `ditto -x -k "${file}" "${unpacked}" || exit 1`,
      `NEW="$(find "${unpacked}" -maxdepth 1 -name '*.app' | head -n 1)"`,
      `[ -n "$NEW" ] || exit 1`,
      `rm -rf "${bundle}" && mv "$NEW" "${bundle}"`,
      `xattr -cr "${bundle}" 2>/dev/null`,
      `open "${bundle}"`,
      `rm -rf "${dir}"`
    ].join('\n'), { mode: 0o755 })
    try { fs.accessSync(dirname(bundle), fs.constants.W_OK) } catch {
      await shell.openExternal(info.page!)
      throw new Error('Aurel cannot replace itself in this folder. The download page is open in your browser.')
    }
    await detached('/bin/sh', [script])
  }
  setTimeout(() => app.quit(), 600)
  } catch (error) { restarting = false; throw error }
}
