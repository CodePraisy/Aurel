import type { TranscriptionSource } from './types'
import type { PackStatus, StemStream, VstChainResult, VstComponent, VstConfiguration, VstEvent, VstFailure, VstModule, VstParameter, VstRenderSpec, VstSlotSpec } from './sounds'
import type { Collection, EngineStatus, JobUpdate, LibraryEntry, Project, RhythmEstimate, Settings, UpdateInfo, YouTubeCheck } from './types'

export interface ImportResult { projectId: string; duplicate?: boolean }
export interface FileFilter { name: string; extensions: string[] }

/** The full surface exposed to the renderer through the preload bridge. */
export interface AurelApi {
  platform: string
  library: {
    list(): Promise<LibraryEntry[]>
    setFavorite(id: string, fav: boolean): Promise<void>
    remove(id: string): Promise<void>
    collections(): Promise<Collection[]>
    createCollection(name: string): Promise<Collection>
    deleteCollection(id: string): Promise<void>
    setInCollection(collectionId: string, projectId: string, inIt: boolean): Promise<void>
    exportPortable(id: string): Promise<string | null>
    importPortable(): Promise<string | null>
    reveal(id: string): Promise<void>
  }
  project: {
    create(project: Project): Promise<void>
    load(id: string): Promise<Project>
    save(project: Project, analysisComplete?: boolean): Promise<void>
    changeCover(projectId: string): Promise<boolean>
    readText(id: string, rel: string): Promise<string>
    url(id: string, rel: string): string
  }
  media: {
    pickAudio(): Promise<string | null>
    pickMidi(): Promise<{ name: string; data: ArrayBuffer } | null>
    importAudio(path: string, opts?: { allowDuplicate?: boolean }): Promise<{ jobId: string }>
    importUrl(url: string): Promise<{ jobId: string }>
    analyzeRhythm(id: string): Promise<RhythmEstimate | null>
    peaks(id: string): Promise<number[] | null>
    pitchShift(id: string, rel: string, semis: number): Promise<string>
    pathForFile(file: File): string
  }
  youtube: {
    check(url: string): Promise<YouTubeCheck>
    acquire(url: string): Promise<{ jobId: string }>
    update(): Promise<{ jobId: string }>
  }
  engine: {
    status(force?: boolean): Promise<EngineStatus>
    install(): Promise<{ jobId: string }>
    process(projectId: string, sources?: TranscriptionSource[]): Promise<{ jobId: string }>
  }
  jobs: {
    cancel(jobId: string): Promise<void>
    onUpdate(cb: (u: JobUpdate) => void): () => void
    active(): Promise<JobUpdate[]>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  exporter: {
    saveDialog(defaultName: string, filters: FileFilter[]): Promise<string | null>
    chooseFolder(): Promise<string | null>
    writeFile(path: string, data: Uint8Array | string): Promise<void>
    writeAudio(path: string, wav: Uint8Array, format: 'wav' | 'mp3' | 'flac'): Promise<void>
    previewPdf(projectId: string, opts: { partIds: string[] | null; mode: string; from?: number; to?: number; scale?: number; spacing?: number }): Promise<void>
    pdf(projectId: string, path: string, opts: { partIds: string[] | null; mode: string; from?: number; to?: number; scale?: number; spacing?: number }): Promise<void>
    openPath(path: string): Promise<void>
  }
  print: {
    ready(): void
    params(): Promise<{ projectId: string; partIds: string[] | null; mode: string; from?: number; to?: number; scale?: number; spacing?: number } | null>
  }
  sounds: {
    status(): Promise<PackStatus[]>
    download(ids: string[]): Promise<{ jobId: string }>
    url(pack: string, file: string): string
    customUrl(id: string, file: string): string
    pickSamples(): Promise<string[]>
    /** Import samples as a new instrument, or add them to `into`. Returns the updated settings. */
    addCustom(name: string, files: string[], into?: string): Promise<Settings>
    removeCustom(id: string): Promise<Settings>
  }
  vst: {
    scan(): Promise<{ available: boolean; roots: string[]; modules: (VstModule & { disabled: boolean })[] }>
    components(path: string): Promise<VstComponent[]>
    failures(): Promise<VstFailure[]>
    clearFailures(): Promise<void>
    /** Parameters of a plug-in; read from the live instance when the track has it loaded. */
    parameters(track: string | null, slotId: string | null, plugin: VstConfiguration['plugin']): Promise<VstParameter[]>
    /** Opens the plug-in's own editor; resolves with its saved settings when the window closes. */
    edit(track: string | null, slotId: string, configuration: VstConfiguration, title: string): Promise<VstConfiguration>
    open(track: string, sampleRate: number, blockSize: number): Promise<{ available: boolean; reason?: string }>
    close(track: string): Promise<void>
    chain(track: string, slots: VstSlotSpec[]): Promise<VstChainResult>
    send(track: string, lines: string[]): void
    stem(projectId: string, rel: string, semis: number, speed: number, sampleRate: number): Promise<StemStream>
    render(spec: VstRenderSpec): Promise<Uint8Array>
    onEvent(cb: (event: VstEvent) => void): () => void
  }
  setup: { run(): Promise<{ jobId: string }> }
  updates: {
    check(): Promise<UpdateInfo>
    /** Download and install the latest release, then restart Aurel. */
    install(): Promise<{ jobId: string }>
    version(): string
  }
  shell: { openExternal(url: string): Promise<void> }
}
