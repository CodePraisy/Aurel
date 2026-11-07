import type { TranscriptionSource } from '@shared/types'
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
    const optional = new Set(['transkun', 'onnxruntime', 'torchcrepe', 'adtof-pytorch'])
    const missing = Object.entries(j.packages).filter(([name, version]) => !version && !optional.has(name)).map(([name]) => name)
    return {
      python: { found: true, path: py.cmd, version: j.python },
      packages: j.packages, cuda: !!j.cuda, gpuName: j.gpu ?? undefined,
      ready: !!j.ready,
      upgraded: !!j.upgraded && fs.existsSync(beatModelPath()),
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
  const upgrading = !!status?.ready && !status.upgraded
  const run = async (cmd: string, args: string[], stage: string, env: NodeJS.ProcessEnv) => {
    ctx.progress(stage, -1)
    const r = await ctx.run(cmd, args, { env, onLine: (line) => {
      ctx.log(line)
      if (/Downloading|Installed|Prepared|Resolved/.test(line)) ctx.progress(stage, -1, line.trim().slice(0, 110))
    } })
    if (r.code !== 0) throw new Error(`${stage} failed. ${r.err.split('\n').filter(Boolean).slice(-2).join(' ')}`)
  }
  if (!status?.ready || !status.upgraded) {
    const uv = await installUv(ctx)
    const env = uvEnv()
    if (!status?.python.found) {
      await run(uv, ['python', 'install', '3.10'], 'Installing Python 3.10', env)
      await run(uv, ['venv', '--allow-existing', '--python', '3.10', paths.venv], 'Creating AI environment', env)
    }
    const hasNvidia = (await tryRun('nvidia-smi', ['-L'])).code === 0
    if (!upgrading) {
      await run(uv, ['pip', 'install', '--python', py.cmd, 'torch==2.5.1', 'torchaudio==2.5.1', '--index-url', hasNvidia ? 'https://download.pytorch.org/whl/cu121' : 'https://download.pytorch.org/whl/cpu'],
        hasNvidia ? 'Installing PyTorch with GPU support (~2.5 GB)' : 'Installing PyTorch (CPU)', env)
    }
    if (!upgrading) {
      await run(uv, ['pip', 'install', '--python', py.cmd, '-r', join(paths.engineScript, '..', 'requirements.txt')], 'Installing separation and transcription packages', env)
    }
    // the per-instrument models are an upgrade: if one fails to install, transcription still works with the older ones
    try {
      await run(uv, ['pip', 'install', '--python', py.cmd, '-r', join(paths.engineScript, '..', 'requirements-models.txt')], 'Adding the per-instrument transcription models', env)
    } catch (e) { ctx.log(`Some transcription models could not be installed: ${(e as Error).message}`) }
    if (!fs.existsSync(beatModelPath())) {
      try {
        await run(py.cmd, [paths.engineScript, 'prepare-beats', '--dir', join(paths.engineRoot, 'models', 'beats')], 'Downloading the beat and bar model', { ...process.env, PYTHONIOENCODING: 'utf-8' })
      } catch (e) { ctx.log(`The beat model could not be downloaded: ${(e as Error).message}`) }
    }
    ctx.progress('Verifying the AI engine', -1)
    status = await checkPython(py)
  }
  if (!status.ready) throw new Error(status.message ?? 'Engine verification failed')
  const marker = join(root, ENGINE_READY_FILE)
  if (!fs.existsSync(marker) || fs.readFileSync(marker, "utf8") !== DEFAULT_SETTINGS.separationModel) {
    const model = DEFAULT_SETTINGS.separationModel
    await run(py.cmd, [paths.engineScript, 'prepare-model', '--model', model], 'Downloading the default separation model', {
      ...process.env, PYTHONIOENCODING: 'utf-8', TORCH_HOME: join(root, 'models')
    })
    writeAtomic(marker, model)
  }
  await run(py.cmd, [paths.engineScript, "prepare-words", "--models-dir", join(root, "models", "whisper"), "--words-model", getSettings().lyricsModel ?? "base"], "Preparing the Whisper word transcription model", { ...process.env, PYTHONIOENCODING: "utf-8" })
  cached = null
  return status
}

/** Beat This! model, downloaded next to the other engine models. */
function beatModelPath(): string {
  return join(paths.engineRoot, 'models', 'beats', 'beat_this.onnx')
}

let gpuInUse = false

export async function processJob(ctx: JobCtx, projectId: string, sources?: TranscriptionSource[]): Promise<{ analysis: string }> {
  const st = await engineStatus()
  if (!st.ready) throw new Error(st.message ?? 'AI engine is not ready.')
  const py = enginePython()!
  const project = loadProjectFile(projectId)
  if (!project?.audio) throw new Error('This project has no audio to process.')
  const s = getSettings()
  // automatic detection needs the 6-source split, or guitar and piano would end up in "other"
  const model = !sources?.length || sources.some((source) => source === 'guitar' || source === 'piano') ? 'htdemucs_6s' : s.separationModel
  const dir = paths.project(projectId)
  const setStatus = (status: NonNullable<typeof project.analysis>['status'], error?: string) => {
    const p = loadProjectFile(projectId)
    if (!p) return
    p.analysis = { ...(p.analysis ?? { status }), status, error }
    saveProjectFile(p)
  }
  // Songs imported before silence trimming: remove the leading gap now, so the transcription starts with the music.
  {
    const cut = trimLeadingSilence(join(dir, project.audio.original))
    const p = loadProjectFile(projectId)
    if (p?.audio) {
      p.audio.trimmed = (p.audio.trimmed ?? 0) + cut
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
  const useGpu = s.device !== 'cpu' && st.cuda && !gpuInUse
  const device = s.device !== 'cpu' && st.cuda && gpuInUse ? 'cpu' : s.device
  if (useGpu) gpuInUse = true
  try {
    if (device === 'cpu' && s.device !== 'cpu') ctx.progress('Starting a parallel transcription on the CPU', -1)
    const r = await ctx.run(py.cmd, [
      ...py.pre, '-u', paths.engineScript, 'process',
      '--input', join(dir, project.audio.original),
      '--out', dir,
      '--model', model,
      '--models-dir', join(paths.engineRoot, 'models', 'whisper'),
      '--beat-model', beatModelPath(),
      '--quality', s.transcribeQuality ?? 'balanced',
      '--sensitivity', String(s.noteSensitivity ?? 0.5),
      '--drum-model', s.drumModel ?? 'adtof',
      '--words', s.lyricWords === false ? '0' : '1',
      '--words-model', s.lyricsModel ?? 'base',
      ...(s.lyricsLanguage ? ['--language', s.lyricsLanguage] : []),
      ...(sources?.length ? ['--sources', ...sources] : []),
      '--device', device,
      ...(s.drumSplit ? ['--drums'] : [])
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', TORCH_HOME: join(model === DEFAULT_SETTINGS.separationModel ? paths.engineRoot : paths.data, 'models') },
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
  } finally {
    if (useGpu) gpuInUse = false
  }
}
