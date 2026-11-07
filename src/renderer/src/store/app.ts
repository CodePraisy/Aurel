import { detectedBpm } from '@shared/rhythm'
import { create } from 'zustand'
import type { Collection, EngineAnalysis, EngineStatus, JobUpdate, LibraryEntry, Project, Settings, TranscriptionSource, UpdateInfo } from '@shared/types'
import { api } from '@/lib/api'
import { analysisToScore, DEFAULT_TRANSCRIBE, type TranscribeOptions } from '@/music/quantize'
import { player } from '@/audio/player'
import { useProject } from './project'

export type Route = { name: 'home' } | { name: 'library' } | { name: 'settings'; section?: string } | { name: 'studio'; projectId: string }

export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'error'; action?: { label: string; run: () => void } }
export interface JobInfo extends JobUpdate { label: string; projectId?: string; logs: string[]; audioSynced?: boolean }

interface AppState {
  route: Route
  history: Route[]
  settings: Settings | null
  library: LibraryEntry[]
  collections: Collection[]
  engine: EngineStatus | null
  jobs: Record<string, JobInfo>
  toasts: Toast[]
  dialog: null | 'new' | 'youtube' | 'url'
  projectRevision: Record<string, number> // bumps when a project changes outside the editor
  update: UpdateInfo | null // a newer release to offer
  go(r: Route): void
  back(fallback?: Route): void
  setDialog(d: AppState['dialog']): void
  loadSettings(): Promise<void>
  updateSettings(p: Partial<Settings>): Promise<void>
  refreshLibrary(): Promise<void>
  refreshEngine(force?: boolean): Promise<EngineStatus>
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void
  track(jobId: string, label: string, projectId?: string): void
  importFile(path: string): Promise<void>
  changeCover(projectId: string): Promise<void>
  processProject(projectId: string, sources?: TranscriptionSource[]): Promise<void>
}

let toastId = 0
const requestingProcess = new Set<string>()
const applyingProcess = new Set<string>()
export const pendingProcess = new Map<string, TranscriptionSource[] | undefined>()
/** The model upgrade is offered once per session; if it cannot finish, transcription uses the models already installed. */
let upgradeTried = false

export const useApp = create<AppState>((set, get) => ({
  route: { name: 'home' },
  history: [],
  settings: null,
  library: [],
  collections: [],
  engine: null,
  jobs: {},
  toasts: [],
  dialog: null,
  projectRevision: {},
  update: null,
  go: (route) => set((s) => JSON.stringify(s.route) === JSON.stringify(route) ? s :
    { route, history: [...s.history.slice(-39), s.route] }),
  back: (fallback = { name: 'home' }) => set((s) => ({
    route: s.history.at(-1) ?? fallback,
    history: s.history.slice(0, -1)
  })),
  setDialog: (dialog) => set({ dialog }),
  loadSettings: async () => set({ settings: await api.settings.get() }),
  updateSettings: async (p) => set({ settings: await api.settings.set(p) }),
  refreshLibrary: async () => {
    const [library, collections] = await Promise.all([api.library.list(), api.library.collections()])
    set({ library, collections })
  },
  refreshEngine: async (force) => {
    const engine = await api.engine.status(force)
    set({ engine })
    return engine
  },
  toast: (text, kind = 'info', action) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 9000 : 5000)
  },
  track: (jobId, label, projectId) => set((s) => ({ jobs: { ...s.jobs, [jobId]: { ...(s.jobs[jobId] ?? { jobId, kind: 'import', stage: 'Starting', pct: -1, logs: [] }), label, projectId: projectId ?? s.jobs[jobId]?.projectId } } })),
  changeCover: async (projectId) => {
    try {
      if (await api.project.changeCover(projectId)) await get().refreshLibrary()
    } catch (error) {
      get().toast((error as Error).message, 'error')
    }
  },
  importFile: async (path) => {
    const { jobId } = await api.media.importAudio(path)
    get().track(jobId, path.split(/[\\/]/).pop() ?? 'Audio')
  },
  processProject: async (projectId, sources) => {
    if (pendingProcess.has(projectId) || requestingProcess.has(projectId) || applyingProcess.has(projectId) ||
      Object.values(get().jobs).some((j) => j.kind === 'process' && j.projectId === projectId && !j.done)) return
    requestingProcess.add(projectId)
    try {
      const eng = await get().refreshEngine()
      if (!eng.ready || (!eng.upgraded && !upgradeTried)) {
        upgradeTried = eng.ready
        // a first install, or an older engine: add the per-instrument models first, then transcribe
        pendingProcess.set(projectId, sources)
        const { jobId } = await api.engine.install()
        get().track(jobId, eng.ready ? 'Adding the new transcription models (one time, ~300 MB)' : 'Installing the AI engine (one time, ~3–5 GB)')
        return
      }
      const editor = useProject.getState()
      if (editor.project?.id === projectId) await editor.save()
      const { jobId } = await api.engine.process(projectId, sources)
      const title = get().library.find((l) => l.id === projectId)?.title ?? 'Song'
      get().track(jobId, `Transcribing “${title}”`, projectId)
    } catch (e) {
      pendingProcess.delete(projectId)
      get().toast((e as Error).message, 'error')
    } finally {
      requestingProcess.delete(projectId)
    }
  }
}))

/** The settings that shape how detected notes are written down. */
export function transcribeOptions(s: Settings | null | undefined): TranscribeOptions {
  if (!s) return DEFAULT_TRANSCRIBE
  return {
    rhythm: { detail: s.rhythmDetail ?? 'standard', fillGaps: s.fillGaps ?? true, straightSwing: s.straightSwing ?? true },
    followTempo: s.followTempo ?? true,
    vocalMelody: s.vocalMelody ?? false,
    guitarChordLimit: s.guitarChordLimit ?? 6
  }
}

/** Turn the engine's analysis into an editable score and save it. */
async function syncAudio(projectId: string, jobId: string): Promise<void> {
  const open = useProject.getState().project
  if (open?.id !== projectId) return
  const disk = await api.project.load(projectId)
  if (!disk.audio || useProject.getState().project?.id !== projectId || useApp.getState().jobs[jobId]?.done) return
  useProject.getState().patchProject((p) => {
    if (p.audio && disk.audio && p.audio.trimmed === undefined && disk.audio.trimmed !== undefined) {
      p.audio = { ...p.audio, duration: disk.audio.duration, trimmed: disk.audio.trimmed, offset: Math.max(0, p.audio.offset - disk.audio.trimmed) }
    }
    p.analysis = { ...p.analysis, status: 'running' }
  })
}

export async function applyAnalysis(projectId: string): Promise<void> {
  const editor = useProject.getState()
  if (editor.project?.id === projectId) await editor.save()
  const project: Project = await api.project.load(projectId)
  const a = JSON.parse(await api.project.readText(projectId, 'analysis.json')) as EngineAnalysis
  const rhythm = project.analysis?.rhythm
  const editedTempo = project.audio?.referenceTempo !== undefined
  // The engine's own beat grid wins unless the user set the tempo by hand (an import-time estimate is not a choice).
  const grid = (editedTempo || (rhythm && !a.grid)) && project.audio ? {
    tempo: project.audio.tempoLinked ? project.audio.referenceTempo ?? detectedBpm(project) ?? project.score.tempo : project.score.tempo,
    offset: project.audio.offset
  } : undefined
  for (const stem of a.stems) {
    const family = stem.name.replace(/_[LR]$/, "") as keyof NonNullable<Project["instrumentHints"]>
    const hint = project.instrumentHints?.[family]
    if (hint) { stem.kind = hint; stem.confidence = 1 }
  }
  a.tempo = Math.round(a.tempo)
  const timeSig = grid ? project.score.timeSig : a.timeSig ?? project.score.timeSig
  const settings = useApp.getState().settings
  const { score, offset, key } = analysisToScore(a, project.score.title, project.score.composer, timeSig, grid, settings?.pianoGrandStaff, transcribeOptions(settings))
  if (editedTempo) score.tempo = project.score.tempo
  project.score = score
  project.audio = { ...project.audio!, offset, startAt: offset - (project.audio?.offset ?? 0) >= 60 / score.tempo * score.timeSig.num * 4 / score.timeSig.den ? offset : project.audio?.startAt }
  project.analysis = { status: 'done', device: a.device, rhythm, detectedTempo: rhythm ? Math.round(rhythm.bpm) : a.tempo, detectedKey: key, finishedAt: Date.now() }
  project.view = { mode: useApp.getState().settings?.defaultView ?? 'both', zoom: 1, part: score.parts.find((p) => p.kind.includes('guitar'))?.id ?? score.parts[0]?.id ?? 'all' }
  project.updated = Date.now()
  await api.project.save(project, true)
}

// Global job listener: progress, completion handling, and chaining import -> AI processing.
api.jobs.onUpdate(async (u) => {
  const st = useApp.getState()
  const prev = st.jobs[u.jobId]
  const result = u.result as { projectId?: string; duplicate?: boolean } | undefined
  const info: JobInfo = { ...(prev ?? { label: u.kind, logs: [] }), ...u, logs: u.log ? [...(prev?.logs ?? []), u.log].slice(-300) : prev?.logs ?? [] }
  info.projectId ??= result?.projectId
  if (u.done && u.kind === 'process' && info.projectId && !u.error) applyingProcess.add(info.projectId)
  // The engine may have trimmed leading silence before starting: give an open piece the new timing.
  if (!u.done && u.kind === 'process' && !info.audioSynced && info.projectId && u.pct >= 0) {
    info.audioSynced = true
    void syncAudio(info.projectId, u.jobId).catch(() => undefined)
  }
  useApp.setState((s) => ({ jobs: { ...s.jobs, [u.jobId]: info } }))
  if (!u.done) return
  setTimeout(() => useApp.setState((s) => { const j = { ...s.jobs }; delete j[u.jobId]; return { jobs: j } }), 30000)
  if (u.kind === 'sounds' || u.kind === 'tools') player.refreshSounds()
  if (u.error) {
    if (u.kind === 'install') {
      // an engine that works but could not take the new models still transcribes
      const waiting = [...pendingProcess]
      pendingProcess.clear()
      if (upgradeTried && useApp.getState().engine?.ready) for (const [id, sources] of waiting) void useApp.getState().processProject(id, sources)
    }
    if (u.error !== 'Cancelled') st.toast(u.error.split('\n')[0], 'error')
    if (u.kind === 'process' && info.projectId) {
      useApp.setState((s) => ({ projectRevision: { ...s.projectRevision, [info.projectId!]: (s.projectRevision[info.projectId!] ?? 0) + 1 } }))
    }
    void st.refreshLibrary()
    return
  }
  if ((u.kind === 'import' || u.kind === 'youtube') && result?.projectId) {
    await st.refreshLibrary()
    st.toast(result.duplicate ? 'This song is already in your library.' : 'Recording ready.', 'ok', {
      label: 'Choose instruments', run: () => st.go({ name: 'studio', projectId: result.projectId! })
    })
    if (result.duplicate) return
    const current = useApp.getState()
    if (current.settings?.openAfterImport !== false && (current.route.name === 'home' || current.route.name === 'library') && !current.dialog) current.go({ name: 'studio', projectId: result.projectId })
  }
  if (u.kind === 'process' && info.projectId) {
    try {
      await applyAnalysis(info.projectId)
      st.toast('Transcription ready.', 'ok', {
        label: 'Open score', run: () => st.go({ name: 'studio', projectId: info.projectId! })
      })
    } catch (e) {
      st.toast(`Could not build the score: ${(e as Error).message}`, 'error')
    } finally { applyingProcess.delete(info.projectId) }
    useApp.setState((s) => ({ projectRevision: { ...s.projectRevision, [info.projectId!]: (s.projectRevision[info.projectId!] ?? 0) + 1 } }))
    void st.refreshLibrary()
  }
  if (u.kind === 'install') {
    await st.refreshEngine(true)
    st.toast('AI engine installed.', 'ok')
    for (const [id, sources] of [...pendingProcess]) { pendingProcess.delete(id); void useApp.getState().processProject(id, sources) }
  }
  if (u.kind === 'tools' && useApp.getState().settings && !useApp.getState().settings!.setupDone) {
    void useApp.getState().updateSettings({ setupDone: true })
    st.toast('Instrument sounds are ready.', 'ok')
  }
})
