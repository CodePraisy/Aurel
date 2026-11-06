import fs from 'fs'
import { join } from 'path'
import { net } from 'electron'
import { spawnSync } from 'child_process'
import JSZip from 'jszip'
import { paths, getSettings } from './store'
import type { JobCtx } from './jobs'

const WIN = process.platform === 'win32'
const GH = 'https://github.com'

async function download(ctx: JobCtx | null, url: string, file: string, stage: string): Promise<void> {
  const r = await net.fetch(url)
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status}) for ${url}`)
  const total = Number(r.headers.get('content-length') ?? 0)
  fs.mkdirSync(join(file, '..'), { recursive: true })
  const out = fs.createWriteStream(`${file}.part`)
  const reader = r.body.getReader()
  let got = 0
  for (;;) {
    ctx?.check()
    const { done, value } = await reader.read()
    if (done) break
    got += value.length
    out.write(value)
    ctx?.progress(stage, total ? got / total : -1, `${(got / 1e6).toFixed(1)} MB`)
  }
  await new Promise((res) => out.end(res))
  fs.renameSync(`${file}.part`, file)
}

// ---------- yt-dlp ----------
export const ytDlpBundled = () => join(paths.tools, WIN ? 'yt-dlp.exe' : 'yt-dlp')

export function ytDlpCmd(): string {
  const s = getSettings().ytDlpPath
  if (s) return s
  if (fs.existsSync(ytDlpBundled())) return ytDlpBundled()
  return 'yt-dlp'
}

const denoPath = () => join(paths.tools, WIN ? 'deno.exe' : 'deno')

/** yt-dlp needs a JavaScript runtime for YouTube; ship Deno next to it. */
async function installDeno(ctx: JobCtx | null): Promise<void> {
  if (fs.existsSync(denoPath())) return
  const target = WIN ? 'x86_64-pc-windows-msvc' : process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin` : 'x86_64-unknown-linux-gnu'
  const zipFile = join(paths.tools, 'deno.zip')
  await download(ctx, `${GH}/denoland/deno/releases/latest/download/deno-${target}.zip`, zipFile, 'Downloading JavaScript runtime for YouTube')
  const zip = await JSZip.loadAsync(fs.readFileSync(zipFile))
  const entry = Object.values(zip.files).find((f) => /(^|\/)deno(\.exe)?$/.test(f.name))
  if (entry) fs.writeFileSync(denoPath(), await entry.async('nodebuffer'))
  if (!WIN) fs.chmodSync(denoPath(), 0o755)
  fs.rmSync(zipFile, { force: true })
}

/** Environment for running yt-dlp with the bundled tools on PATH. */
export function toolEnv(): NodeJS.ProcessEnv {
  const sep = WIN ? ';' : ':'
  return { ...process.env, PATH: `${paths.tools}${sep}${process.env.PATH ?? process.env.Path ?? ''}` }
}

let ytInstall: Promise<string> | null = null
export async function installYtDlp(ctx: JobCtx | null, force = false): Promise<string> {
  if (!ytInstall) {
    // The downloader is shared by all jobs. Cancelling one import leaves setup available to the others.
    ytInstall = installYtTools(force).finally(() => { ytInstall = null })
  }
  ctx?.progress('Preparing YouTube downloader', -1)
  const file = await ytInstall
  ctx?.check()
  return file
}

async function installYtTools(force: boolean): Promise<string> {
  const ctx = null
  const file = ytDlpBundled()
  await installDeno(ctx).catch(() => undefined)
  if (fs.existsSync(file) && !force) return file
  const asset = WIN ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
  await download(ctx, `${GH}/yt-dlp/yt-dlp/releases/latest/download/${asset}`, file, 'Downloading YouTube importer')
  if (!WIN) fs.chmodSync(file, 0o755)
  return file
}

// ---------- uv (manages Python + packages for the AI engine) ----------
export const uvPath = () => join(paths.engineTools, 'uv', WIN ? 'uv.exe' : 'uv')

export async function installUv(ctx: JobCtx): Promise<string> {
  const exe = uvPath()
  if (fs.existsSync(exe)) return exe
  const dir = join(paths.engineTools, 'uv')
  fs.mkdirSync(dir, { recursive: true })
  if (WIN) {
    const zipFile = join(dir, 'uv.zip')
    await download(ctx, `${GH}/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip`, zipFile, 'Downloading Python manager')
    const zip = await JSZip.loadAsync(fs.readFileSync(zipFile))
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir) continue
      const base = name.split('/').pop()!
      if (base.endsWith('.exe')) fs.writeFileSync(join(dir, base), await f.async('nodebuffer'))
    }
    fs.rmSync(zipFile, { force: true })
  } else {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const target = process.platform === 'darwin' ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`
    const tgz = join(dir, 'uv.tar.gz')
    await download(ctx, `${GH}/astral-sh/uv/releases/latest/download/uv-${target}.tar.gz`, tgz, 'Downloading Python manager')
    spawnSync('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1'])
    fs.rmSync(tgz, { force: true })
  }
  if (!fs.existsSync(exe)) throw new Error('Could not unpack the Python manager (uv).')
  return exe
}

export function uvEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: join(paths.engineTools, 'python'),
    UV_CACHE_DIR: join(paths.engineTools, 'uv-cache'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    VIRTUAL_ENV: paths.venv
  }
}
