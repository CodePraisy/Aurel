import type { CustomSound, FxSlot, VstConfiguration } from './sounds'

// Shared data model for Aurel. The Score is the single source of truth for
// imported (AI-transcribed) songs and original compositions alike.

export const PPQ = 480 // ticks per quarter note

export type InstrumentKind =
  | 'piano' | 'epiano' | 'organ' | 'synth'
  | 'acoustic-guitar' | 'clean-guitar' | 'distorted-guitar' | 'bass'
  | 'drums' | 'vocals' | 'singer' | 'strings' | 'brass' | 'woodwinds' | 'other'

export const TRANSCRIPTION_SOURCES = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const
export type TranscriptionSource = typeof TRANSCRIPTION_SOURCES[number]

export type Clef = 'treble' | 'bass' | 'treble8' | 'percussion'
export type Articulation = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata'
export type Technique = 'bend' | 'slide' | 'hammer' | 'palmMute' | 'harmonic' | 'vibrato'
export type Dynamic = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
/** Rolled chord. `beats` is the gap between successive notes, in beats (quarter notes). */
export interface Arpeggio { direction: 'up' | 'down'; beats?: number; /** older projects: gap in milliseconds */ delayMs?: number }

export interface NoteHead {
  pitch: number // MIDI pitch (sounding)
  string?: number // 1 = highest string. Only for fretted parts; auto-assigned when absent
  fret?: number
}

export interface NoteEvent {
  id: string
  start: number // ticks from start of measure
  dur: number // ticks; always a representable (optionally dotted) value
  rest?: boolean
  notes: NoteHead[]
  velocity: number // 1..127
  tie?: boolean // tied into the next event
  art?: Articulation[]
  tech?: Technique[]
  bend?: number // semitones for 'bend'
  dynamic?: Dynamic
  arpeggio?: Arpeggio
}

export interface Measure { events: NoteEvent[] }

export interface Classification {
  label: string
  confidence: number // 0..1
  traits?: Record<string, string>
}

export interface VocalWord { start: number; end: number; text: string; b?: number }
export interface VocalTranscript { error?: string; language: string; words: VocalWord[]; text: string }

export interface Part {
  lyrics?: VocalTranscript
  id: string
  name: string
  kind: InstrumentKind
  clef: Clef
  tuning?: number[] // string pitches, index 0 = string 1 (highest)
  capo?: number
  group?: string // parts sharing a group are drawn with a brace (piano RH/LH)
  volume: number // 0..1
  pan: number // -1..1
  mute: boolean
  solo: boolean
  playback: 'midi' | 'audio'
  stem?: string // project-relative path of the isolated recording
  classification?: Classification
  sound?: string // built-in sound id; defaults from kind
  vstInstrument?: VstConfiguration
  fx?: FxSlot[] // effects chain after the instrument
  measures: Measure[]
}

export interface TempoChange { measure: number; bpm: number }

export interface Score {
  title: string
  composer: string
  tempo: number // bpm (quarter note)
  tempoChanges?: TempoChange[]
  timeSig: { num: number; den: number }
  keyFifths: number // -7..7
  parts: Part[]
}

/** What you hear: the original recording, the transcribed notes, or each part's own choice. */
export type Listen = 'original' | 'transcription' | 'parts'

export interface PracticeLoop { id: string; name: string; from: number; to: number }

export interface ProjectAudio {
  original: string // project-relative path (wav)
  playback?: string // compressed copy used for streaming playback
  duration: number // seconds
  offset: number // seconds of audio that correspond to tick 0
  tempoLinked?: boolean
  referenceTempo?: number
  startAt?: number // recording start used when transcription removes leading empty bars
  trimmed?: number // seconds of leading silence removed from the original file
  sourceUrl?: string
  youtube?: YouTubeMeta
}

export interface AnalysisInfo {
  status: 'none' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
  device?: string
  detectedTempo?: number
  rhythm?: RhythmEstimate | null // null means audio was checked but the pulse was unclear
  detectedKey?: string
  finishedAt?: number
}

export interface RhythmEstimate {
  bpm: number
  timeSig?: Score['timeSig']
  downbeat: number
}

export interface Project {
  instrumentHints?: Partial<Record<TranscriptionSource, InstrumentKind>>
  id: string
  kind: 'transcription' | 'composition'
  created: number
  updated: number
  score: Score
  audio?: ProjectAudio
  analysis?: AnalysisInfo
  practice: { loops: PracticeLoop[]; speed: number; listen?: Listen }
  view?: { mode: ViewMode; zoom: number; part: string | 'all'; lyricsMode?: boolean }
}

export type ViewMode = 'staff' | 'tab' | 'both'

export interface LibraryEntry {
  id: string
  title: string
  artist: string
  kind: Project['kind']
  created: number
  updated: number
  opened: number
  favorite: boolean
  duration: number
  artwork: string | null // project-relative path
  status: AnalysisInfo['status']
  source: string | null
  collections: string[]
}

export interface Collection { id: string; name: string; count: number }

export interface YouTubeMeta {
  id: string
  url: string
  title: string
  channel: string
  thumbnail: string
  duration?: number
  license?: string
  isLive?: boolean
  drm?: boolean
}

export interface YouTubeCheck {
  meta: YouTubeMeta | null
  error?: string
  tool: { available: boolean; version?: string; path?: string }
  acquirable: boolean
  reasons: string[] // why acquisition is blocked or needs attention
  creativeCommons: boolean
  duplicateOf?: string
}

export interface EngineStatus {
  python: { found: boolean; path?: string; version?: string }
  packages: Record<string, string | null>
  cuda: boolean
  gpuName?: string
  ready: boolean
  /** The newer transcription models (Transkun, Beat This!, CREPE, ADTOF) are installed. */
  upgraded?: boolean
  message?: string
}

export type TranscribeQuality = 'fast' | 'balanced' | 'best'
export type RhythmDetail = 'simple' | 'standard' | 'detailed'

/** The beat grid the engine found: one time per beat, beat 0 on the first bar line. */
export interface EngineGrid {
  times: number[]
  meter: number // tracked beats per bar
  bpm: number
  division?: 'binary' | 'ternary'
  swing?: number // where the off-beat eighth falls (0.5 = straight)
  timeSig?: { num: number; den: number }
}

export interface UpdateInfo {
  current: string
  available: boolean
  version?: string
  notes?: string
  page?: string
  asset?: { name: string; size: number; url: string }
  canInstall?: boolean // false: the update has to be downloaded by hand from `page`
  error?: string
}

export interface JobUpdate {
  projectId?: string
  jobId: string
  kind: 'import' | 'youtube' | 'process' | 'install' | 'export' | 'sounds' | 'tools' | 'update'
  stage: string
  pct: number // 0..1, -1 = indeterminate
  message?: string
  log?: string
  done?: boolean
  error?: string
  result?: unknown
}

export interface VstInstrumentPreset { id: string; name: string; kind: InstrumentKind; configuration: VstConfiguration }

export interface Settings {
  theme: 'dark' | 'light' | 'sakura'
  accent: string
  reduceMotion: boolean
  pythonPath: string
  ytDlpPath: string
  device: 'auto' | 'cuda' | 'cpu'
  separationModel: 'htdemucs_6s' | 'htdemucs' | 'htdemucs_ft'
  drumSplit: boolean
  // ---- transcription (engine 2)
  transcribeQuality: TranscribeQuality
  noteSensitivity: number // 0 = only clear notes … 1 = catch quiet notes too
  rhythmDetail: RhythmDetail
  fillGaps: boolean // hold notes over tiny gaps instead of writing short rests
  straightSwing: boolean // write swung eighths as straight eighths
  followTempo: boolean // score tempo follows the recording bar by bar
  vocalMelody: boolean // write the singer's melody as notes under the words
  lyricWords: boolean // recognise the singer's words
  lyricsModel: 'base' | 'small'
  lyricsLanguage: string // '' = detect
  drumModel: 'adtof' | 'basic'
  guitarChordLimit: number // most notes in one guitar chord
  autoProcess: boolean
  metronomeVolume: number
  countInBars: number
  defaultView: ViewMode
  pianoGrandStaff: boolean
  noteInputPreview: boolean
  export: ExportAudioSettings
  soundfont: string
  vstFolders: string[]
  fxDefaults: Record<string, FxSlot[]>
  outputDevice: string // '' = system default
  latency: 'interactive' | 'balanced' | 'playback' // legacy; superseded by bufferSize
  sampleRate: 0 | 44100 | 48000 | 96000 // 0 = the device's own rate
  bufferSize: 128 | 256 | 512 | 1024 | 2048 // frames per audio callback
  midiInput: string // '' = every connected MIDI input
  midiChannel: number // 0 = all channels, 1..16
  auditionTrack: 'selected' | 'first' | 'piano' // what a MIDI keyboard plays when no part is selected
  effectTails: boolean // let reverb and delay ring out after stopping
  countInOn: boolean
  vstDisabled: string[] // lower-cased module paths the user switched off
  customSounds: CustomSound[]
  vstInstruments: VstInstrumentPreset[]
  soundSwaps: Record<string, string> // built-in sound id -> custom sound id used everywhere instead
  checkUpdates: boolean // look for a new version on GitHub at start-up
  skippedVersion: string // a version the user chose to skip
  masterVolume: number
  autoScroll: boolean
  soloFollowsView: boolean
  cursorStyle: 'band' | 'line'
  highlightNotes: boolean
  inputMode: 'write' | 'play'
  uiScale: number
  termsAccepted: boolean
  autoSetup: boolean // download sounds + tools on first run
  setupDone: boolean
  particles: number // floating notes in the background, 0 = none
  particleSpeed: number // 1 = normal drift
  particleSize: number // 1 = normal size
  openAfterImport: boolean // show a new recording in the studio as soon as it is imported
  deleteMode: 'rest' | 'shift' // what Delete does to a note: leave a rest, or pull the following notes back
  sidebarOpen: boolean // sidebar shows names and sessions, or icons only
  sessions: SessionTab[] // pieces open in the sidebar, in order
  sessionFolders: SessionFolder[]
}

export interface SessionTab { projectId: string; folder?: string }
export interface SessionFolder { id: string; name: string; collapsed?: boolean }

export interface ExportAudioSettings {
  sampleRate: 44100 | 48000 | 96000
  bitDepth: 16 | 24 | 32
  channels: 1 | 2
  normalize: boolean
  tail: number // seconds of release tail
}

export interface EngineAnalysis {
  engine?: number
  quality?: TranscribeQuality
  grid?: EngineGrid
  methods?: Record<string, string>
  duration?: number
  lyrics?: Record<string, VocalTranscript>
  tempo: number
  beatOffset: number
  timeSig?: { num: number; den: number }
  downbeat?: number
  beats?: number[]
  device: string
  stems: {
    name: string
    file: string
    kind: InstrumentKind
    confidence: number
    traits?: Record<string, string>
  }[]
  /** s/e in seconds; b/be in beats on the grid (engine 2) */
  notes: Record<string, { s: number; e: number; p: number; v: number; b?: number; be?: number }[]>
  drums?: { t: number; piece: string; v: number; b?: number }[]
}
