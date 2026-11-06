import type { FxSlot, VstConfiguration } from './sounds'

// Shared data model for Aurel. The Score is the single source of truth for
// imported (AI-transcribed) songs and original compositions alike.

export const PPQ = 480 // ticks per quarter note

export type InstrumentKind =
  | 'piano' | 'epiano' | 'organ' | 'synth'
  | 'acoustic-guitar' | 'clean-guitar' | 'distorted-guitar' | 'bass'
  | 'drums' | 'vocals' | 'strings' | 'brass' | 'woodwinds' | 'other'

export type Clef = 'treble' | 'bass' | 'treble8' | 'percussion'
export type Articulation = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata'
export type Technique = 'bend' | 'slide' | 'hammer' | 'palmMute' | 'harmonic' | 'vibrato'
export type Dynamic = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
export interface Arpeggio { direction: 'up' | 'down'; delayMs: number }

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

export interface Part {
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

export interface PracticeLoop { id: string; name: string; from: number; to: number }

export interface ProjectAudio {
  original: string // project-relative path (wav)
  playback?: string // compressed copy used for streaming playback
  duration: number // seconds
  offset: number // seconds of audio that correspond to tick 0
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
  id: string
  kind: 'transcription' | 'composition'
  created: number
  updated: number
  score: Score
  audio?: ProjectAudio
  analysis?: AnalysisInfo
  practice: { loops: PracticeLoop[]; speed: number }
  view?: { mode: ViewMode; zoom: number; part: string | 'all' }
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
  message?: string
}

export interface JobUpdate {
  jobId: string
  kind: 'import' | 'youtube' | 'process' | 'install' | 'export' | 'sounds' | 'tools'
  stage: string
  pct: number // 0..1, -1 = indeterminate
  message?: string
  log?: string
  done?: boolean
  error?: string
  result?: unknown
}

export interface Settings {
  theme: 'dark' | 'light' | 'sakura'
  accent: string
  reduceMotion: boolean
  pythonPath: string
  ytDlpPath: string
  device: 'auto' | 'cuda' | 'cpu'
  separationModel: 'htdemucs_6s' | 'htdemucs' | 'htdemucs_ft'
  drumSplit: boolean
  autoProcess: boolean
  metronomeVolume: number
  countInBars: number
  defaultView: ViewMode
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
}

export interface ExportAudioSettings {
  sampleRate: 44100 | 48000 | 96000
  bitDepth: 16 | 24 | 32
  channels: 1 | 2
  normalize: boolean
  tail: number // seconds of release tail
}

export interface EngineAnalysis {
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
  notes: Record<string, { s: number; e: number; p: number; v: number; b?: number }[]>
  drums?: { t: number; piece: string; v: number }[]
}
