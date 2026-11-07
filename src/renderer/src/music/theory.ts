import { PPQ, type Clef, type InstrumentKind } from '@shared/types'

export const WHOLE = PPQ * 4

// Representable durations, longest first. Dotted values are 1.5x their base.
export const BASE_DURS = [WHOLE, WHOLE / 2, PPQ, PPQ / 2, PPQ / 4, PPQ / 8]
export const DURATIONS: { ticks: number; base: number; dotted: boolean }[] = BASE_DURS.flatMap((b) => [
  { ticks: b * 1.5, base: b, dotted: true },
  { ticks: b, base: b, dotted: false }
]).sort((a, b) => b.ticks - a.ticks)

export const DURATION_NAMES: Record<number, string> = {
  [WHOLE]: 'Whole', [WHOLE / 2]: 'Half', [PPQ]: 'Quarter', [PPQ / 2]: 'Eighth', [PPQ / 4]: '16th', [PPQ / 8]: '32nd'
}

export function durInfo(ticks: number): { base: number; dotted: boolean } | null {
  const d = DURATIONS.find((x) => x.ticks === ticks)
  return d ? { base: d.base, dotted: d.dotted } : null
}

export function measureTicks(ts: { num: number; den: number }): number {
  return Math.round(ts.num * (WHOLE / ts.den))
}

export function beatTicks(ts: { num: number; den: number }): number {
  // compound meters (6/8, 9/8, 12/8) beat on the dotted quarter
  if (ts.den === 8 && ts.num % 3 === 0 && ts.num > 3) return (WHOLE / 8) * 3
  return WHOLE / ts.den
}

/**
 * Split a span into representable durations. Values are aligned to their own
 * grid so rests/notes read naturally (e.g. no half note starting off-beat).
 */
export function decompose(start: number, length: number, allowDotted = true): number[] {
  const out: number[] = []
  let pos = start
  let left = length
  let guard = 0
  while (left > 0 && guard++ < 512) {
    let chosen = 0
    for (const d of DURATIONS) {
      if (d.ticks > left) continue
      if (d.dotted && !allowDotted) continue
      const grid = d.dotted ? d.base / 2 : d.base
      if (pos % grid !== 0) continue
      if (d.dotted && pos % d.base !== 0 && d.base > PPQ / 2) continue
      chosen = d.ticks
      break
    }
    if (!chosen) chosen = Math.min(left, PPQ / 8) // fallback: 32nd grid
    out.push(chosen)
    pos += chosen
    left -= chosen
  }
  return out
}

// ---------- pitch spelling ----------
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]
export const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
export const MINOR_KEY_NAMES = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']

export interface Spelled { step: string; alter: number; octave: number }

/** Accidental (by letter index) that the key signature applies. */
export function keyAccidentals(fifths: number): number[] {
  const acc = [0, 0, 0, 0, 0, 0, 0]
  const sharpOrder = [3, 0, 4, 1, 5, 2, 6] // F C G D A E B
  const flatOrder = [6, 2, 5, 1, 4, 0, 3] // B E A D G C F
  if (fifths > 0) for (let i = 0; i < fifths; i++) acc[sharpOrder[i]] = 1
  if (fifths < 0) for (let i = 0; i < -fifths; i++) acc[flatOrder[i]] = -1
  return acc
}

export function spell(midi: number, fifths: number): Spelled {
  const pc = ((midi % 12) + 12) % 12
  const acc = keyAccidentals(fifths)
  // 1) in-key spelling
  for (let i = 0; i < 7; i++) {
    if ((LETTER_PC[i] + acc[i] + 12) % 12 === pc) return mk(i, acc[i], midi)
  }
  // 2) chromatic: sharps in sharp/neutral keys, flats in flat keys
  const prefer = fifths < 0 ? -1 : 1
  for (const a of [prefer, -prefer]) {
    for (let i = 0; i < 7; i++) if ((LETTER_PC[i] + a + 12) % 12 === pc) return mk(i, a, midi)
  }
  return mk(0, 0, midi)
}

function mk(letterIdx: number, alter: number, midi: number): Spelled {
  const naturalPc = LETTER_PC[letterIdx]
  const octave = Math.round((midi - alter - naturalPc) / 12) - 1
  return { step: LETTERS[letterIdx], alter, octave }
}

export function letterIndex(step: string): number { return LETTERS.indexOf(step) }

export function midiName(midi: number): string {
  const s = spell(midi, 0)
  return `${s.step}${s.alter === 1 ? '#' : s.alter === -1 ? 'b' : ''}${s.octave}`
}

/** Pitch for a letter typed at the cursor: nearest octave to a reference pitch. */
export function pitchFromLetter(letter: string, fifths: number, near: number): number {
  const idx = LETTERS.indexOf(letter.toUpperCase())
  const pc = (LETTER_PC[idx] + keyAccidentals(fifths)[idx] + 12) % 12
  let best = pc + 60
  let bestDist = Infinity
  for (let oct = 0; oct < 10; oct++) {
    const p = pc + oct * 12
    const d = Math.abs(p - near)
    if (d < bestDist) { bestDist = d; best = p }
  }
  return best
}

// ---------- instruments ----------
export interface InstrumentDef {
  kind: InstrumentKind
  label: string
  clef: Clef
  tuning?: number[]
  program: number // General MIDI program (0-based)
  range: [number, number]
  family: 'keys' | 'guitar' | 'bass' | 'drums' | 'voice' | 'orchestral' | 'synth' | 'other'
  displayShift: number // written pitch = sounding + displayShift
}

export const TUNINGS: Record<string, { name: string; strings: number[]; for: 'guitar' | 'bass' }> = {
  standard: { name: 'Standard (EADGBE)', strings: [64, 59, 55, 50, 45, 40], for: 'guitar' },
  dropD: { name: 'Drop D', strings: [64, 59, 55, 50, 45, 38], for: 'guitar' },
  halfDown: { name: 'Half-step down', strings: [63, 58, 54, 49, 44, 39], for: 'guitar' },
  dadgad: { name: 'DADGAD', strings: [62, 57, 55, 50, 45, 38], for: 'guitar' },
  openG: { name: 'Open G', strings: [62, 59, 55, 50, 43, 38], for: 'guitar' },
  dropC: { name: 'Drop C', strings: [62, 57, 53, 48, 43, 36], for: 'guitar' },
  seven: { name: '7-string (B)', strings: [64, 59, 55, 50, 45, 40, 35], for: 'guitar' },
  bass4: { name: 'Bass standard (EADG)', strings: [43, 38, 33, 28], for: 'bass' },
  bassDropD: { name: 'Bass Drop D', strings: [43, 38, 33, 26], for: 'bass' },
  bass5: { name: '5-string bass (BEADG)', strings: [43, 38, 33, 28, 23], for: 'bass' },
  bass6: { name: '6-string bass', strings: [48, 43, 38, 33, 28, 23], for: 'bass' }
}

export const INSTRUMENTS: Record<InstrumentKind, InstrumentDef> = {
  piano: { kind: 'piano', label: 'Piano', clef: 'treble', program: 0, range: [21, 108], family: 'keys', displayShift: 0 },
  epiano: { kind: 'epiano', label: 'E-Piano', clef: 'treble', program: 4, range: [28, 103], family: 'keys', displayShift: 0 },
  organ: { kind: 'organ', label: 'Organ', clef: 'treble', program: 16, range: [36, 96], family: 'keys', displayShift: 0 },
  synth: { kind: 'synth', label: 'Synthesizer', clef: 'treble', program: 81, range: [24, 108], family: 'synth', displayShift: 0 },
  'acoustic-guitar': { kind: 'acoustic-guitar', label: 'Acoustic Guitar', clef: 'treble8', tuning: TUNINGS.standard.strings, program: 25, range: [40, 88], family: 'guitar', displayShift: 12 },
  'clean-guitar': { kind: 'clean-guitar', label: 'Clean Electric Guitar', clef: 'treble8', tuning: TUNINGS.standard.strings, program: 27, range: [40, 88], family: 'guitar', displayShift: 12 },
  'distorted-guitar': { kind: 'distorted-guitar', label: 'Distorted Guitar', clef: 'treble8', tuning: TUNINGS.standard.strings, program: 30, range: [40, 88], family: 'guitar', displayShift: 12 },
  bass: { kind: 'bass', label: 'Bass Guitar', clef: 'bass', tuning: TUNINGS.bass4.strings, program: 33, range: [28, 67], family: 'bass', displayShift: 12 },
  drums: { kind: 'drums', label: 'Drums', clef: 'percussion', program: 0, range: [35, 81], family: 'drums', displayShift: 0 },
  singer: { kind: 'singer', label: 'Singer', clef: 'treble', program: 53, range: [40, 84], family: 'voice', displayShift: 0 },
  vocals: { kind: 'vocals', label: 'Choir', clef: 'treble', program: 53, range: [40, 84], family: 'voice', displayShift: 0 },
  strings: { kind: 'strings', label: 'Strings', clef: 'treble', program: 48, range: [28, 100], family: 'orchestral', displayShift: 0 },
  brass: { kind: 'brass', label: 'Brass', clef: 'treble', program: 61, range: [34, 84], family: 'orchestral', displayShift: 0 },
  woodwinds: { kind: 'woodwinds', label: 'Woodwinds', clef: 'treble', program: 73, range: [48, 96], family: 'orchestral', displayShift: 0 },
  other: { kind: 'other', label: 'Other', clef: 'treble', program: 0, range: [21, 108], family: 'other', displayShift: 0 }
}

export function isFretted(kind: InstrumentKind): boolean {
  const f = INSTRUMENTS[kind].family
  return f === 'guitar' || f === 'bass'
}

// ---------- drums (General MIDI) ----------
export interface DrumPiece { id: string; label: string; midi: number; key: string; head: 'normal' | 'x' | 'circle-x'; short: string }

/** Ordered top to bottom as they appear in the step grid and on the staff. */
export const DRUM_PIECES: DrumPiece[] = [
  { id: 'crash', label: 'Crash', midi: 49, key: 'a/5', head: 'x', short: 'CC' },
  { id: 'ride', label: 'Ride', midi: 51, key: 'f/5', head: 'x', short: 'RD' },
  { id: 'hhOpen', label: 'Open Hi-hat', midi: 46, key: 'g/5', head: 'circle-x', short: 'OH' },
  { id: 'hh', label: 'Closed Hi-hat', midi: 42, key: 'g/5', head: 'x', short: 'HH' },
  { id: 'tomHi', label: 'High Tom', midi: 50, key: 'e/5', head: 'normal', short: 'T1' },
  { id: 'tomMid', label: 'Mid Tom', midi: 47, key: 'd/5', head: 'normal', short: 'T2' },
  { id: 'snare', label: 'Snare', midi: 38, key: 'c/5', head: 'normal', short: 'SN' },
  { id: 'tomFloor', label: 'Floor Tom', midi: 43, key: 'a/4', head: 'normal', short: 'FT' },
  { id: 'kick', label: 'Kick', midi: 36, key: 'f/4', head: 'normal', short: 'BD' },
  { id: 'hhPedal', label: 'Pedal Hi-hat', midi: 44, key: 'd/4', head: 'x', short: 'PH' }
]

const DRUM_ALIASES: Record<number, number> = { 35: 36, 40: 38, 37: 38, 39: 38, 41: 43, 45: 47, 48: 50, 52: 49, 55: 49, 57: 49, 53: 51, 59: 51 }

export function drumPiece(midi: number): DrumPiece {
  const m = DRUM_ALIASES[midi] ?? midi
  return DRUM_PIECES.find((p) => p.midi === m) ?? DRUM_PIECES[6]
}

export function drumPieceById(id: string): DrumPiece | undefined {
  return DRUM_PIECES.find((p) => p.id === id)
}
