import fs from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { EngineStatus } from '@shared/types'
import { DEFAULT_SETTINGS, ENGINE_READY_FILE, enginePythonAt, getSettings, paths, loadProjectFile, saveProjectFile, writeAtomic } from './store'
import { installUv, uvEnv } from './tools'
import type { JobCtx } from './jobs'
import { computePeaks, trimLeadingSilence } from './media'

interface Py { cmd: string; pre: string[] }

function tryRun(cmd: string, args: string[], timeout = 20000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = '', err = ''
    let p
    try { p = spawn(cmd, args, { windowsHide: true }) } catch { return resolve({ code: -1, out, err }) }
    const t = setTimeout(() => p.kill(), timeout)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => { clearTimeout(t); resolve({ code: -1, out, err }) })
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out, err }) })
  })
}

/** Python that runs the engine: explicit setting > managed venv. */
function enginePython(): Py | null {
  const s = getSettings()
  if (s.pythonPath) return { cmd: s.pythonPath, pre: [] }
  const managed = enginePythonAt(paths.engineRoot)
  if (fs.existsSync(managed)) return { cmd: managed, pre: [] }
  return null
}

async function checkPython(py: Py): Promise<EngineStatus> {
  const r = await tryRun(py.cmd, [...py.pre, paths.engineScript, 'status'], 60000)
  try {
    if (r.code !== 0) throw new Error()
    const j = JSON.parse(r.out.trim().split('\n').pop()!)
    const missing = Object.entries(j.packages).filter(([, version]) => !version).map(([name]) => name)
    return {
      python: { found: true, path: py.cmd, version: j.python },
      packages: j.packages, cuda: !!j.cuda, gpuName: j.gpu ?? undefined,
      ready: !!j.ready,
      message: j.ready ? undefined : missing.length ? `Missing packages: ${missing.join(', ')}` : r.err.trim().split('\n').pop()
    }
  } catch {
    return { python: { found: false, path: py.cmd }, packages: {}, cuda: false, ready: false, message: `Could not run the engine with ${py.cmd}. ${r.err.split('\n').slice(-2).join(' ')}` }
  }
}

let cached: { at: number; status: EngineStatus } | null = null

export async function engineStatus(force = false): Promise<EngineStatus> {
  if (cached && !force && Date.now() - cached.at < 60_000) return cached.status
  const py = enginePython()
  let status: EngineStatus
  if (!py) {
    status = {
      python: { found: false },
      packages: {}, cuda: false, ready: false,
      message: 'The AI engine is not installed yet. Aurel will download it automatically (about 3–5 GB).'
    }
  } else status = await checkPython(py)
  cached = { at: Date.now(), status }
  return status
}

export async function installEngineJob(ctx: JobCtx): Promise<EngineStatus> {
  const py = { cmd: paths.venvPython, pre: [] }
  const root = paths.engineInstallRoot
  if (paths.engineRoot !== root) {
    const shared = await engineStatus(true)
    if (shared.ready) return shared
  }
  let status = fs.existsSync(py.cmd) ? await checkPython(py) : undefined
  const run = async (cmd: string, args: string[], stage: string, env: NodeJS.ProcessEnv) => {
    ctx.progress(stage, -1)
    const r = await ctx.run(cmd, args, { env, onLine: (line) => {
      ctx.log(line)
      if (/Downloading|Installed|Prepared|Resolved/.test(line)) ctx.progress(stage, -1, line.trim().slice(0, 110))
    } })
    if (r.code !== 0) throw new Error(`${stage} failed. ${r.err.split('\n').filter(Boolean).slice(-2).join(' ')}`)
  }
  if (!status?.ready) {
    const uv = await installUv(ctx)
    const env = uvEnv()
    if (!status?.python.found) {
      await run(uv, ['python', 'install', '3.10'], 'Installing Python 3.10', env)
      await run(uv, ['venv', '--allow-existing', '--python', '3.10', paths.venv], 'Creating AI environment', env)
    }
    const hasNvidia = (await tryRun('nvidia-smi', ['-L'])).code === 0
    await run(uv, ['pip', 'install', '--python', py.cmd, 'torch==2.5.1', 'torchaudio==2.5.1', '--index-url', hasNvidia ? 'https://download.pytorch.org/whl/cu121' : 'https://download.pytorch.org/whl/cpu'],
      hasNvidia ? 'Installing PyTorch with GPU support (~2.5 GB)' : 'Installing PyTorch (CPU)', env)
    await run(uv, ['pip', 'install', '--python', py.cmd, '-r', join(paths.engineScript, '..', 'requirements.txt')], 'Installing separation and transcription packages', env)
    ctx.progress('Verifying the AI engine', -1)
    status = await checkPython(py)
  }
  if (!status.ready) throw new Error(status.message ?? 'Engine verification failed')
  const marker = join(root, ENGINE_READY_FILE)
  if (!fs.existsSync(marker)) {
    const model = DEFAULT_SETTINGS.separationModel
    await run(py.cmd, [paths.engineScript, 'prepare-model', '--model', model], 'Downloading the default separation model', {
      ...process.env, PYTHONIOENCODING: 'utf-8', TORCH_HOME: join(root, 'models')
    })
    writeAtomic(marker, model)
  }
  cached = null
  return status
}

export async function processJob(ctx: JobCtx, projectId: string): Promise<{ analysis: string }> {
  const st = await engineStatus()
  if (!st.ready) throw new Error(st.message ?? 'AI engine is not ready.')
  const py = enginePython()!
  const project = loadProjectFile(projectId)
  if (!project?.audio) throw new Error('This project has no audio to process.')
  const s = getSettings()
  const dir = paths.project(projectId)
  const setStatus = (status: NonNullable<typeof project.analysis>['status'], error?: string) => {
    const p = loadProjectFile(projectId)
    if (!p) return
    p.analysis = { ...(p.analysis ?? { status }), status, error }
    saveProjectFile(p)
  }
  // Songs imported before silence trimming: remove the leading gap now, so the transcription starts with the music.
  if (project.audio.trimmed === undefined) {
    const cut = trimLeadingSilence(join(dir, project.audio.original))
    const p = loadProjectFile(projectId)
    if (p?.audio) {
      p.audio.trimmed = cut
      if (cut > 0) {
        p.audio.duration = Math.max(0, p.audio.duration - cut)
        p.audio.offset = Math.max(0, p.audio.offset - cut)
        writeAtomic(join(dir, 'peaks.json'), JSON.stringify(computePeaks(join(dir, p.audio.original))))
        fs.rmSync(join(dir, 'cache'), { recursive: true, force: true }) // pitch-shifted and streamed copies of the old file
      }
      saveProjectFile(p)
    }
  }
  setStatus('running')
  let result: string | null = null
  let lastErr = ''
  try {
    const r = await ctx.run(py.cmd, [
      ...py.pre, '-u', paths.engineScript, 'process',
      '--input', join(dir, project.audio.original),
      '--out', dir,
      '--model', s.separationModel,
      '--device', s.device,
      ...(s.drumSplit ? ['--drums'] : [])
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', TORCH_HOME: join(s.separationModel === DEFAULT_SETTINGS.separationModel ? paths.engineRoot : paths.data, 'models') },
      onLine: (l, stream) => {
        if (stream === 'err') { ctx.log(l); lastErr = l; return }
        try {
          const m = JSON.parse(l)
          if (m.type === 'progress') ctx.progress(m.stage, m.pct ?? -1, m.message)
          else if (m.type === 'result') result = m.analysis
          else if (m.type === 'error') lastErr = m.message
        } catch { ctx.log(l) }
      }
    })
    if (r.code !== 0 || !result) throw new Error(lastErr || `Engine exited with code ${r.code}`)
    return { analysis: result }
  } catch (e) {
    setStatus((e as Error).message === 'Cancelled' ? 'cancelled' : 'failed', (e as Error).message)
    throw e
  }
}
