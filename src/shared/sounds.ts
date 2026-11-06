// Downloadable instrument sample packs. Sources (free, attribution licences):
//  - Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), via the Tone.js audio repository
//  - MusyngKite General MIDI soundfont, rendered to MP3 by Benjamin Gleitzman (midi-js-soundfonts, CC BY-SA 3.0)
//  - Tone.js acoustic drum kit samples (MIT)

export interface SampleFile { note: number; file: string; url: string }
export interface SoundPack { id: string; label: string; files: SampleFile[]; credit: string }

const MK = 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/MusyngKite'
const TONE = 'https://raw.githubusercontent.com/Tonejs/audio/master'
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const SHARP_S = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
const name = (m: number, table: string[]) => `${table[m % 12]}${Math.floor(m / 12) - 1}`

function musyngKite(id: string, label: string, folder: string, lo: number, hi: number, step = 1): SoundPack {
  const files: SampleFile[] = []
  for (let m = lo; m <= hi; m += step) files.push({ note: m, file: `${name(m, FLAT)}.mp3`, url: `${MK}/${folder}-mp3/${name(m, FLAT)}.mp3` })
  return { id, label, files, credit: 'MusyngKite soundfont (CC BY-SA 3.0), MP3 renders by Benjamin Gleitzman' }
}

function salamander(): SoundPack {
  const files: SampleFile[] = []
  for (let m = 21; m <= 108; m += 3) files.push({ note: m, file: `${name(m, SHARP_S)}.mp3`, url: `${TONE}/salamander/${name(m, SHARP_S)}.mp3` })
  return { id: 'piano', label: 'Salamander Grand Piano', files, credit: 'Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0)' }
}

function kit(): SoundPack {
  const k = (note: number, f: string) => ({ note, file: `${f}.mp3`, url: `${TONE}/drum-samples/acoustic-kit/${f}.mp3` })
  return { id: 'drums', label: 'Acoustic Kit', files: [k(36, 'kick'), k(38, 'snare'), k(42, 'hihat'), k(50, 'tom1'), k(47, 'tom2'), k(43, 'tom3')], credit: 'Tone.js acoustic kit samples (MIT)' }
}

export const SOUND_PACKS: SoundPack[] = [
  salamander(),
  musyngKite('epiano', 'E-Piano', 'electric_piano_1', 28, 103),
  musyngKite('organ', 'Drawbar Organ', 'drawbar_organ', 36, 96),
  musyngKite('steel', 'Steel-String Acoustic', 'acoustic_guitar_steel', 40, 88),
  musyngKite('nylon', 'Nylon Guitar', 'acoustic_guitar_nylon', 40, 88),
  musyngKite('clean', 'Clean Electric Guitar', 'electric_guitar_clean', 40, 88),
  musyngKite('drive', 'Overdriven Guitar', 'overdriven_guitar', 40, 88),
  musyngKite('dist', 'Distortion Guitar', 'distortion_guitar', 40, 88),
  musyngKite('bass', 'Finger Bass', 'electric_bass_finger', 23, 67),
  musyngKite('synthbass', 'Synth Bass', 'synth_bass_1', 24, 72),
  musyngKite('voice', 'Choir “Aah”', 'choir_aahs', 40, 84),
  musyngKite('strings', 'String Ensemble', 'string_ensemble_1', 28, 100),
  musyngKite('brass', 'Brass Section', 'brass_section', 34, 84),
  musyngKite('reed', 'Flute', 'flute', 59, 98),
  musyngKite('lead', 'Saw Lead', 'lead_2_sawtooth', 36, 96),
  musyngKite('pad', 'Warm Pad', 'pad_2_warm', 36, 96),
  kit()
]

export const DEFAULT_PACKS = ['piano', 'steel', 'clean', 'drive', 'bass', 'drums', 'voice', 'strings']

export function packFor(id: string): SoundPack | undefined { return SOUND_PACKS.find((p) => p.id === id) }

export interface PackStatus { id: string; have: number; total: number; ready: boolean }

// ---------- effects ----------
export type FxType = 'eq' | 'comp' | 'reverb' | 'delay' | 'chorus' | 'drive' | 'filter' | 'gain'
export interface BuiltinFxSlot { id: string; type: FxType; on: boolean; params: Record<string, number> }
export interface VstComponent { id: string; name: string; vendor: string; kind: 'effect' | 'instrument' }
export interface VstModule { path: string; name: string }
export interface VstParameter { id: number; label: string; value: number; steps: number }
export interface VstState { component?: string; controller?: string }
export interface VstConfiguration { params: Record<string, number>; plugin: VstModule & VstComponent; state?: VstState }
export interface VstFxSlot extends VstConfiguration { id: string; type: 'vst3'; on: boolean }
export type FxSlot = BuiltinFxSlot | VstFxSlot

export interface FxParamDef { k: string; label: string; min: number; max: number; step: number; def: number; unit?: string }
export const FX_DEFS: Record<FxType, { label: string; params: FxParamDef[] }> = {
  eq: { label: 'EQ', params: [
    { k: 'lowCut', label: 'Low cut', min: 20, max: 500, step: 1, def: 20, unit: 'Hz' },
    { k: 'low', label: 'Low', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
    { k: 'midFreq', label: 'Mid freq', min: 200, max: 6000, step: 10, def: 1000, unit: 'Hz' },
    { k: 'mid', label: 'Mid', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
    { k: 'high', label: 'High', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
    { k: 'highCut', label: 'High cut', min: 2000, max: 20000, step: 100, def: 20000, unit: 'Hz' }
  ] },
  comp: { label: 'Compressor', params: [
    { k: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, def: -18, unit: 'dB' },
    { k: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, def: 4, unit: ':1' },
    { k: 'attack', label: 'Attack', min: 0, max: 200, step: 1, def: 10, unit: 'ms' },
    { k: 'release', label: 'Release', min: 20, max: 1000, step: 10, def: 200, unit: 'ms' },
    { k: 'makeup', label: 'Makeup', min: 0, max: 24, step: 0.5, def: 4, unit: 'dB' }
  ] },
  reverb: { label: 'Reverb', params: [
    { k: 'size', label: 'Size', min: 0.3, max: 8, step: 0.1, def: 2.2, unit: 's' },
    { k: 'predelay', label: 'Pre-delay', min: 0, max: 120, step: 1, def: 15, unit: 'ms' },
    { k: 'tone', label: 'Tone', min: 1000, max: 16000, step: 100, def: 7000, unit: 'Hz' },
    { k: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.25 }
  ] },
  delay: { label: 'Delay', params: [
    { k: 'time', label: 'Time', min: 20, max: 1500, step: 5, def: 350, unit: 'ms' },
    { k: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, def: 0.35 },
    { k: 'tone', label: 'Tone', min: 500, max: 12000, step: 100, def: 4000, unit: 'Hz' },
    { k: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.25 }
  ] },
  chorus: { label: 'Chorus', params: [
    { k: 'rate', label: 'Rate', min: 0.05, max: 5, step: 0.05, def: 0.8, unit: 'Hz' },
    { k: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.5 },
    { k: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.4 }
  ] },
  drive: { label: 'Amp / Drive', params: [
    { k: 'gain', label: 'Gain', min: 1, max: 30, step: 0.5, def: 6 },
    { k: 'tone', label: 'Tone', min: 800, max: 10000, step: 50, def: 4500, unit: 'Hz' },
    { k: 'cab', label: 'Cabinet', min: 0, max: 1, step: 1, def: 1 },
    { k: 'level', label: 'Level', min: 0, max: 1.5, step: 0.01, def: 0.5 }
  ] },
  filter: { label: 'Filter', params: [
    { k: 'mode', label: 'Low/High-pass', min: 0, max: 1, step: 1, def: 0 },
    { k: 'freq', label: 'Cutoff', min: 40, max: 18000, step: 10, def: 3000, unit: 'Hz' },
    { k: 'q', label: 'Resonance', min: 0.1, max: 15, step: 0.1, def: 0.7 }
  ] },
  gain: { label: 'Utility', params: [
    { k: 'db', label: 'Gain', min: -24, max: 24, step: 0.5, def: 0, unit: 'dB' },
    { k: 'width', label: 'Stereo width', min: 0, max: 2, step: 0.01, def: 1 }
  ] }
}

export function newFx(type: FxType): BuiltinFxSlot {
  return { id: `fx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type, on: true, params: Object.fromEntries(FX_DEFS[type].params.map((p) => [p.k, p.def])) }
}

export function hasVstEffects(chain: FxSlot[]): boolean {
  return chain.some((slot) => slot.type === 'vst3' && slot.on)
}

// ---------- real-time VST3 tracks ----------
/** One plug-in in a track's chain, in processing order (an instrument always comes first). */
export interface VstSlotSpec { id: string; on: boolean; config: VstConfiguration }
export interface VstFailure { slotId?: string; path: string; name: string; message: string; at: number }
export interface VstChainResult { available: boolean; latency: number; failures: VstFailure[]; reason?: string }
export interface VstEvent {
  session: string
  type: 'crash' | 'restarted' | 'failed' | 'editor' | 'fail' | 'latency' | 'xrun' | 'saved'
  slotId?: string
  plugin?: string
  message?: string
  open?: boolean
  latency?: number
  config?: VstConfiguration
}
/** A recorded stem prepared as raw audio for a host track, at one speed and transposition. */
export interface StemStream { ref: string; frames: number }
export interface VstRenderSpec {
  slots: VstSlotSpec[]
  sampleRate: number
  frames: number
  tempo: number
  timeSig: { num: number; den: number }
  notes: number[] // flat [startFrame, endFrame, pitch, velocity, …]
  file?: { ref: string; frame: number; offset: number }
  input?: Uint8Array // dry stereo float audio from a built-in instrument, starting at frame 0
}

/** VST3 effects run first, then Aurel's built-in effects, in playback and in export alike. */
export function orderChain(chain: FxSlot[]): FxSlot[] {
  return [...chain.filter((slot) => slot.type === 'vst3'), ...chain.filter((slot) => slot.type !== 'vst3')]
}
