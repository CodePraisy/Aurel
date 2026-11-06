import { create } from 'zustand'
import type { Collection, EngineAnalysis, EngineStatus, JobUpdate, LibraryEntry, Project, Settings } from '@shared/types'
import { api } from '@/lib/api'
import { analysisToScore } from '@/music/quantize'
import { player } from '@/audio/player'

export type Route = { name: 'home' } | { name: 'library' } | { name: 'settings'; section?: string } | { name: 'studio'; projectId: string }

export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'error'; action?: { label: string; run: () => void } }
export interface JobInfo extends JobUpdate { label: string; projectId?: string; logs: string[] }

interface AppState {
  route: Route
  settings: Settings | null
  library: LibraryEntry[]
  collections: Collection[]
  engine: EngineStatus | null
  jobs: Record<string, JobInfo>
  toasts: Toast[]
  dialog: null | 'new' | 'youtube' | 'url'
  projectRevision: Record<string, number> // bumps when a project changes outside the editor
  go(r: Route): void
  setDialog(d: AppState['dialog']): void
  loadSettings(): Promise<void>
  updateSettings(p: Partial<Settings>): Promise<void>
  refreshLibrary(): Promise<void>
  refreshEngine(force?: boolean): Promise<EngineStatus>
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void
  track(jobId: string, label: string, projectId?: string): void
  importFile(path: string): Promise<void>
  processProject(projectId: string): Promise<void>
}

let toastId = 0
export const pendingProcess = new Set<string>()

export const useApp = create<AppState>((set, get) => ({
  route: { name: 'home' },
  settings: null,
  library: [],
  collections: [],
  engine: null,
  jobs: {},
  toasts: [],
  dialog: null,
  projectRevision: {},
  go: (route) => set({ route }),
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
  track: (jobId, label, projectId) => set((s) => ({ jobs: { ...s.jobs, [jobId]: { jobId, kind: 'import', stage: 'Starting', pct: -1, label, projectId, logs: [] } } })),
  importFile: async (path) => {
    const { jobId } = await api.media.importAudio(path)
    get().track(jobId, path.split(/[\\/]/).pop() ?? 'Audio')
  },
  processProject: async (projectId) => {
    const eng = await get().refreshEngine()
    if (!eng.ready) {
      // install the engine automatically, then come back to this song
      pendingProcess.add(projectId)
      if (!Object.values(get().jobs).some((j) => j.kind === 'install' && !j.done)) {
        const { jobId } = await api.engine.install()
        get().track(jobId, 'Installing the AI engine (one time, ~3–5 GB)')
        get().toast('Installing the AI engine first. Transcription starts automatically when it’s done.', 'info')
      }
      set((s) => ({ projectRevision: { ...s.projectRevision, [projectId]: (s.projectRevision[projectId] ?? 0) + 1 } }))
      return
    }
    const { jobId } = await api.engine.process(projectId)
    const title = get().library.find((l) => l.id === projectId)?.title ?? 'Song'
    get().track(jobId, `Transcribing “${title}”`, projectId)
    set((s) => ({ projectRevision: { ...s.projectRevision, [projectId]: (s.projectRevision[projectId] ?? 0) + 1 } }))
  }
}))

/** Turn the engine's analysis into an editable score and save it. */
export async function applyAnalysis(projectId: string): Promise<void> {
  const project: Project = await api.project.load(projectId)
  const a = JSON.parse(await api.project.readText(projectId, 'analysis.json')) as EngineAnalysis
  const rhythm = project.analysis?.rhythm
  const grid = rhythm !== undefined && project.audio ? { tempo: project.score.tempo, offset: project.audio.offset } : undefined
  const timeSig = grid ? project.score.timeSig : a.timeSig ?? project.score.timeSig
  const { score, offset, key } = analysisToScore(a, project.score.title, project.score.composer, timeSig, grid)
  project.score = score
  project.audio = { ...project.audio!, offset }
  project.analysis = { status: 'done', device: a.device, rhythm, detectedTempo: grid ? rhythm?.bpm : a.tempo, detectedKey: key, finishedAt: Date.now() }
  project.view = { mode: useApp.getState().settings?.defaultView ?? 'both', zoom: 1, part: score.parts.find((p) => p.kind.includes('guitar'))?.id ?? score.parts[0]?.id ?? 'all' }
  project.updated = Date.now()
  await api.project.save(project)
}

// Global job listener: progress, completion handling, and chaining import -> AI processing.
api.jobs.onUpdate(async (u) => {
  const st = useApp.getState()
  const prev = st.jobs[u.jobId]
  const info: JobInfo = { ...(prev ?? { label: u.kind, logs: [] }), ...u, logs: u.log ? [...(prev?.logs ?? []), u.log].slice(-300) : prev?.logs ?? [] }
  useApp.setState((s) => ({ jobs: { ...s.jobs, [u.jobId]: info } }))
  if (!u.done) return
  setTimeout(() => useApp.setState((s) => { const j = { ...s.jobs }; delete j[u.jobId]; return { jobs: j } }), u.error ? 15000 : 2500)
  if (u.kind === 'sounds' || u.kind === 'tools') player.refreshSounds()
  if (u.error) {
    if (u.kind === 'install') pendingProcess.clear()
    if (u.error !== 'Cancelled') st.toast(u.error.split('\n')[0], 'error')
    if (u.kind === 'process' && info.projectId) {
      useApp.setState((s) => ({ projectRevision: { ...s.projectRevision, [info.projectId!]: (s.projectRevision[info.projectId!] ?? 0) + 1 } }))
    }
    void st.refreshLibrary()
    return
  }
  const result = u.result as { projectId?: string; duplicate?: boolean; analysis?: string } | undefined
  if ((u.kind === 'import' || u.kind === 'youtube') && result?.projectId) {
    await st.refreshLibrary()
    if (result.duplicate) {
      st.toast('That song is already in your library — opened the existing copy.', 'info')
      st.go({ name: 'studio', projectId: result.projectId })
      return
    }
    st.go({ name: 'studio', projectId: result.projectId })
    const eng = await st.refreshEngine()
    if (st.settings?.autoProcess && eng.ready) void useApp.getState().processProject(result.projectId)
  }
  if (u.kind === 'process' && info.projectId) {
    try {
      await applyAnalysis(info.projectId)
      st.toast('Transcription ready. Notation is fully editable.', 'ok')
    } catch (e) {
      st.toast(`Could not build the score: ${(e as Error).message}`, 'error')
    }
    useApp.setState((s) => ({ projectRevision: { ...s.projectRevision, [info.projectId!]: (s.projectRevision[info.projectId!] ?? 0) + 1 } }))
    void st.refreshLibrary()
  }
  if (u.kind === 'install') {
    await st.refreshEngine(true)
    st.toast('AI engine installed.', 'ok')
    for (const id of [...pendingProcess]) { pendingProcess.delete(id); void useApp.getState().processProject(id) }
  }
  if (u.kind === 'tools' && useApp.getState().settings && !useApp.getState().settings!.setupDone) {
    void useApp.getState().updateSettings({ setupDone: true })
    st.toast('Instrument sounds are ready.', 'ok')
  }
})
