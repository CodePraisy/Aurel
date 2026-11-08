import type { EngineAnalysis, InstrumentKind, Measure, NoteEvent, Part, Score } from '@shared/types'
import { PPQ } from '@shared/types'
import { DRUM_PIECES, KEY_NAMES, MINOR_KEY_NAMES, measureTicks } from './theory'
import { defaultPart, emptyMeasure, normalizeMeasure, pianoParts, uid } from './score'
import { DEFAULT_RHYTHM, beatFrame, quantizeOnGrid, tempoPlan, type GridOnset, type LineMode, type RhythmOptions } from './beatgrid'

export interface TranscribeOptions {
  rhythm: RhythmOptions
  followTempo: boolean
  vocalMelody: boolean
  guitarChordLimit: number
  chords?: boolean
}
export const DEFAULT_TRANSCRIBE: TranscribeOptions = { rhythm: DEFAULT_RHYTHM, followTempo: true, vocalMelody: false, guitarChordLimit: 6, chords: true }

export interface RawNote { s: number; e: number; p: number; v: number }

export interface QuantizeOpts {
  tempo: number
  offset: number // seconds that map to tick 0
  timeSig: { num: number; den: number }
  grid?: number // ticks
  minDur?: number // seconds
  maxPoly?: number
  mode?: 'poly' | 'melody' | 'bass'
}

type Onset = GridOnset

/** Quantize free-timed notes onto the grid and group simultaneous onsets into chords. */
export function quantizeNotes(notes: RawNote[], o: QuantizeOpts): Onset[] {
  const grid = o.grid ?? PPQ / 4
  const toTick = (sec: number) => ((sec - o.offset) * o.tempo * PPQ) / 60
  const minDur = o.minDur ?? 0.06
  const byTick = new Map<number, Onset>()
  for (const n of notes) {
    if (n.e - n.s < minDur) continue
    const t = Math.round(toTick(n.s) / grid) * grid
    if (t < 0) continue
    const end = Math.max(t + grid, Math.round(toTick(n.e) / grid) * grid)
    let on = byTick.get(t)
    if (!on) { on = { tick: t, end, pitches: new Map() }; byTick.set(t, on) }
    on.end = Math.max(on.end, end)
    on.pitches.set(n.p, Math.max(on.pitches.get(n.p) ?? 0, n.v))
  }
  const onsets = [...byTick.values()].sort((a, b) => a.tick - b.tick)
  const maxPoly = o.maxPoly ?? 8
  for (const on of onsets) {
    let ps = [...on.pitches.entries()].sort((a, b) => b[1] - a[1]) // loudest first
    if (o.mode === 'melody') ps = [[Math.max(...on.pitches.keys()), on.pitches.get(Math.max(...on.pitches.keys()))!]]
    else if (o.mode === 'bass') ps = [[Math.min(...on.pitches.keys()), on.pitches.get(Math.min(...on.pitches.keys()))!]]
    else ps = ps.slice(0, maxPoly)
    on.pitches = new Map(ps)
  }
  return onsets
}

/** Strum direction and playing techniques the engine heard, carried onto the written note. */
function onsetExtras(on: GridOnset): Partial<NoteEvent> {
  const x: Partial<NoteEvent> = {}
  if (on.strum) x.strum = on.strum
  if (on.tech?.length) { x.tech = on.tech; if (on.bend) x.bend = on.bend }
  return x
}

/** Turn grid onsets into measures, splitting across barlines with ties. */
export function onsetsToMeasures(onsets: Onset[], ts: { num: number; den: number }, minMeasures = 1, drums = false): Measure[] {
  const mt = measureTicks(ts)
  const last = onsets.length ? onsets[onsets.length - 1] : null
  const count = Math.max(minMeasures, last ? Math.ceil(Math.max(last.end, last.tick + 1) / mt) : 1)
  const raw: NoteEvent[][] = Array.from({ length: count }, () => [])
  onsets.forEach((on, i) => {
    const next = i + 1 < onsets.length ? onsets[i + 1].tick : Infinity
    let end = Math.min(on.end, next)
    if (drums) end = Math.min(next, on.tick + PPQ) // drum hits: notate up to a quarter
    let t = on.tick
    const notes = [...on.pitches.entries()].map(([pitch]) => ({ pitch }))
    const vel = Math.round(Math.max(...on.pitches.values()))
    while (t < end) {
      const mi = Math.floor(t / mt)
      if (mi >= count) break
      const barEnd = (mi + 1) * mt
      const segEnd = Math.min(end, barEnd)
      raw[mi].push({ id: uid(), start: t - mi * mt, dur: segEnd - t, notes, velocity: Math.max(1, Math.min(127, vel)), tie: segEnd < end && !drums, ...(t === on.tick ? onsetExtras(on as GridOnset) : {}) })
      t = segEnd
      if (drums) break
    }
  })
  return raw.map((events) => (events.length ? normalizeMeasure({ events }, mt) : emptyMeasure(mt)))
}

// ---------- key detection (Krumhansl-Schmuckler) ----------
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / 12
  const mb = b.reduce((x, y) => x + y, 0) / 12
  let n = 0, da = 0, db = 0
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  return da && db ? n / Math.sqrt(da * db) : 0
}

export function detectKey(notes: { p: number; dur: number }[]): { fifths: number; name: string; minor: boolean; confidence: number } {
  const hist = new Array(12).fill(0)
  for (const n of notes) hist[((n.p % 12) + 12) % 12] += n.dur
  let best = { fifths: 0, name: 'C major', minor: false, confidence: 0 }
  let bestR = -2
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const prof = (minor ? MINOR : MAJOR).map((_, i) => (minor ? MINOR : MAJOR)[(i - tonic + 12) % 12])
      const r = corr(hist, prof)
      if (r > bestR) {
        bestR = r
        const majorTonic = minor ? (tonic + 3) % 12 : tonic
        let fifths = (majorTonic * 7) % 12
        if (fifths > 6) fifths -= 12
        const name = minor ? `${MINOR_KEY_NAMES[fifths + 7]} minor` : `${KEY_NAMES[fifths + 7]} major`
        best = { fifths, name, minor, confidence: Math.max(0, r) }
      }
    }
  }
  return best
}

// ---------- analysis -> score ----------
const MODE_FOR: Partial<Record<InstrumentKind, QuantizeOpts['mode']>> = { vocals: 'melody', singer: 'melody', bass: 'bass', brass: 'melody', woodwinds: 'melody' }
const POLY_FOR: Partial<Record<InstrumentKind, number>> = { 'acoustic-guitar': 6, 'clean-guitar': 6, 'distorted-guitar': 4, piano: 10, epiano: 10, organ: 8, synth: 6, strings: 6 }

export function analysisToScore(a: EngineAnalysis, title: string, composer: string, ts = { num: 4, den: 4 }, grid?: { tempo: number; offset: number }, pianoGrandStaff = true, opts: TranscribeOptions = DEFAULT_TRANSCRIBE): { score: Score; offset: number; key: string } {
  // Engine 2 places every note on the detected beat grid; use that unless the user set their own tempo grid.
  if (a.grid && a.grid.times.length > a.grid.meter && !grid) return beatGridScore(a, title, composer, pianoGrandStaff, opts)
  const tempo = grid?.tempo ?? (Math.round(a.tempo) || 120)
  const mt = measureTicks(ts)
  const measureSec = (mt / PPQ) * (60 / tempo)
  const all = Object.entries(a.notes).filter(([name]) => name !== "vocals").flatMap(([, notes]) => notes)
  const words = Object.values(a.lyrics ?? {}).flatMap((lyrics) => lyrics.words)
  const firstNote = Math.min(...words.map((word) => word.start), ...all.filter((n) => n.e - n.s >= 0.06).map((n) => n.s), ...(a.drums ?? []).map((d) => d.t))
  let offset = grid?.offset ?? a.downbeat ?? a.beatOffset
  if (Number.isFinite(firstNote) && firstNote - offset >= measureSec) {
    offset += Math.floor((firstNote - offset) / measureSec) * measureSec
  }
  // Step back if the recording has notes before the detected downbeat.
  const beatSec = 60 / tempo
  if (isFinite(firstNote) && firstNote < offset - 0.03) offset = Math.max(0, offset - Math.ceil((offset - firstNote - 0.03) / beatSec) * beatSec)
  const pitched = a.stems.filter((s) => s.kind !== 'drums' && s.name !== 'vocals')
  const key = detectKey(pitched.flatMap((s) => (a.notes[s.name] ?? []).map((n) => ({ p: n.p, dur: n.e - n.s }))))

  const lastSec = Math.max(...all.map((n) => n.e), ...words.map((word) => word.end), ...(a.drums ?? []).map((d) => d.t), a.duration ?? 1)
  const minMeasures = Math.max(1, Math.ceil(((lastSec - offset) / measureSec)))
  const parts: Part[] = []
  for (const stem of a.stems) {
    const singer = stem.name === "vocals"
    const kind = singer ? "singer" : stem.kind
    const cls = { label: kind, confidence: stem.confidence, traits: stem.traits }
    if (stem.kind === 'drums') {
      const hits = a.drums ?? []
      const piece = (id: string) => DRUM_PIECES.find((p) => p.id === id)?.midi ?? 38
      const raw: RawNote[] = hits.map((h) => ({ s: h.t, e: h.t + 0.1, p: piece(h.piece), v: h.v }))
      const p = defaultPart('drums', 0, mt, 'Drums')
      p.measures = onsetsToMeasures(quantizeNotes(raw, { tempo, offset, timeSig: ts, minDur: 0, maxPoly: 4 }), ts, minMeasures, true)
      Object.assign(p, { stem: stem.file, playback: 'audio', classification: cls })
      parts.push(p)
      continue
    }
    const notes = a.notes[stem.name] ?? []
    const isKeys = stem.kind === 'piano' || stem.kind === 'epiano' || stem.kind === 'organ'
    const label = stemLabel(stem.name, stem.kind)
    if (isKeys && pianoGrandStaff) {
      const [rh, lh] = pianoParts(0, mt, stem.kind, label)
      const hi = notes.filter((n) => n.p >= 60)
      const lo = notes.filter((n) => n.p < 60)
      rh.measures = onsetsToMeasures(quantizeNotes(hi, { tempo, offset, timeSig: ts, maxPoly: 5 }), ts, minMeasures)
      lh.measures = onsetsToMeasures(quantizeNotes(lo, { tempo, offset, timeSig: ts, maxPoly: 5 }), ts, minMeasures)
      Object.assign(rh, { stem: stem.file, playback: 'audio', classification: cls })
      Object.assign(lh, { classification: cls })
      parts.push(rh, lh)
      continue
    }
    const p = defaultPart(kind, 0, mt, singer ? "Singer" : label)
    if (singer) {
      p.lyrics = a.lyrics?.[stem.name] ?? { language: "", words: [], text: "" }
      p.measures = Array.from({ length: minMeasures }, () => emptyMeasure(mt))
      Object.assign(p, { stem: stem.file, playback: "audio", classification: cls })
      parts.push(p)
      continue
    }
    p.measures = onsetsToMeasures(
      quantizeNotes(notes, { tempo, offset, timeSig: ts, mode: MODE_FOR[kind] ?? 'poly', maxPoly: POLY_FOR[stem.kind] ?? 6 }),
      ts, minMeasures
    )
    Object.assign(p, { stem: stem.file, playback: 'audio', classification: cls })
    parts.push(p)
  }
  // equalize measure counts
  const count = Math.max(1, ...parts.map((p) => p.measures.length))
  for (const p of parts) while (p.measures.length < count) p.measures.push(emptyMeasure(mt))
  return { score: { title, composer, tempo, timeSig: ts, keyFifths: key.fifths, parts }, offset, key: key.name }
}

function stemLabel(name: string, kind: InstrumentKind): string {
  const side = name.match(/_(L|R)$/)?.[1]
  return baseLabel(name.replace(/_(L|R)$/, ''), kind) + (side ? ` ${side}` : '')
}

function baseLabel(name: string, kind: InstrumentKind): string {
  const map: Record<string, string> = { vocals: 'Vocals', bass: 'Bass', guitar: 'Guitar', piano: 'Piano', other: 'Other', drums: 'Drums' }
  if (kind === 'synth') return 'Synth'
  if (kind === 'strings') return 'Strings'
  if (kind === 'distorted-guitar') return 'Distorted Guitar'
  if (kind === 'acoustic-guitar') return 'Acoustic Guitar'
  if (kind === 'clean-guitar') return 'Clean Guitar'
  return map[name] ?? name
}

// ---------- engine 2: notes placed by beat ----------
function beatGridScore(a: EngineAnalysis, title: string, composer: string, pianoGrandStaff: boolean, opts: TranscribeOptions): { score: Score; offset: number; key: string } {
  const g = a.grid!
  const ts = g.timeSig ?? a.timeSig ?? { num: g.meter, den: 4 }
  const mt = measureTicks(ts)
  const { beatTicks } = beatFrame(g, opts.rhythm.detail)
  const { tempo, changes } = tempoPlan(g, beatTicks, opts.followTempo)
  const bars = Math.max(1, Math.floor((g.times.length - 1) / g.meter))
  const beatsOf = (n: EngineAnalysis['notes'][string][number]) => ({ b: n.b ?? 0, be: n.be ?? n.b ?? 0, p: n.p, v: n.v, strum: n.strum, tech: n.tech, bend: n.bend })
  const lines = (notes: Parameters<typeof beatsOf>[0][], mode: LineMode, maxPoly = 8) =>
    onsetsToMeasures(quantizeOnGrid(notes.filter((n) => n.b !== undefined).map(beatsOf), g, opts.rhythm, mode, maxPoly), ts, bars, mode === 'drums')
  const pitched = a.stems.filter((s) => s.kind !== 'drums' && s.name !== 'vocals')
  const detected = detectKey(pitched.flatMap((s) => (a.notes[s.name] ?? []).map((n) => ({ p: n.p, dur: n.e - n.s }))))
  // engine 3 finds the key from every part together; its answer wins when it has one
  const key = a.key ? { fifths: Math.max(-7, Math.min(7, a.key.fifths)), name: a.key.name.replace(' major', '').replace(' minor', 'm') } : detected
  const parts: Part[] = []
  for (const stem of a.stems) {
    const singer = stem.name === 'vocals'
    const kind = singer ? 'singer' : stem.kind
    const cls = { label: kind, confidence: stem.confidence, traits: { ...stem.traits, ...(a.methods?.[stem.name] ? { model: a.methods[stem.name] } : {}), ...(a.bleed?.[stem.name] ? { 'bleed removed': `${a.bleed[stem.name]} notes` } : {}) } }
    if (stem.kind === 'drums') {
      const piece = (id: string) => DRUM_PIECES.find((p) => p.id === id)?.midi ?? 38
      const p = defaultPart('drums', 0, mt, 'Drums')
      p.measures = lines((a.drums ?? []).map((h) => ({ s: h.t, e: h.t + 0.1, p: piece(h.piece), v: h.v, b: h.b, be: h.b })), 'drums', 4)
      Object.assign(p, { stem: stem.file, playback: 'audio', classification: { ...cls, traits: { ...cls.traits, ...(a.methods?.drums ? { model: a.methods.drums } : {}) } } })
      parts.push(p)
      continue
    }
    const notes = a.notes[stem.name] ?? []
    const isKeys = stem.kind === 'piano' || stem.kind === 'epiano' || stem.kind === 'organ'
    const label = stemLabel(stem.name, stem.kind)
    if (isKeys && pianoGrandStaff) {
      const [rh, lh] = pianoParts(0, mt, stem.kind, label)
      rh.measures = lines(notes.filter((n) => n.p >= 60), 'poly', 5)
      lh.measures = lines(notes.filter((n) => n.p < 60), 'poly', 5)
      Object.assign(rh, { stem: stem.file, playback: 'audio', classification: cls })
      Object.assign(lh, { classification: cls })
      parts.push(rh, lh)
      continue
    }
    const p = defaultPart(kind, 0, mt, singer ? 'Singer' : label)
    if (singer) {
      p.lyrics = a.lyrics?.[stem.name] ?? { language: '', words: [], text: '' }
      p.measures = opts.vocalMelody && notes.length ? lines(notes, 'melody') : Array.from({ length: bars }, () => emptyMeasure(mt))
      Object.assign(p, { stem: stem.file, playback: 'audio', classification: cls })
      parts.push(p)
      continue
    }
    const guitar = stem.kind.includes('guitar')
    p.measures = lines(notes, MODE_FOR[kind] ?? 'poly', guitar ? opts.guitarChordLimit : POLY_FOR[stem.kind] ?? 6)
    Object.assign(p, { stem: stem.file, playback: 'audio', classification: cls })
    parts.push(p)
  }
  const count = Math.max(1, ...parts.map((p) => p.measures.length))
  for (const p of parts) while (p.measures.length < count) p.measures.push(emptyMeasure(mt))
  // the singer goes last, so the words printed under each system sit right under the vocal staff
  parts.sort((x, y) => Number(x.kind === 'singer') - Number(y.kind === 'singer'))
  const score: Score = { title, composer, tempo, timeSig: ts, keyFifths: key.fifths, parts }
  if (changes.length) score.tempoChanges = changes
  if (opts.chords !== false && a.chords?.length) {
    const total = count * mt
    score.chords = a.chords
      .map((c) => ({ tick: Math.round(c.b * beatTicks), name: c.name }))
      .filter((c) => c.tick >= 0 && c.tick < total)
      .map((c) => ({ measure: Math.floor(c.tick / mt), tick: c.tick % mt, name: c.name }))
  }
  return { score, offset: +g.times[0].toFixed(4), key: key.name }
}
