import type { EngineGrid, RhythmDetail, TempoChange, Technique } from '@shared/types'
import { PPQ } from '@shared/types'

/**
 * Notes placed by beat, not by clock time.
 *
 * The engine gives every note its position in beats along the detected beat grid (`b`, `be`),
 * so a band that drifts ahead or behind a metronome still lands on the right beat. Here each
 * beat picks the simplest subdivision that explains the notes in it (a quarter, eighths,
 * sixteenths…), the way a person writing it down would, instead of forcing every beat onto
 * sixteenths.
 */

export interface RhythmOptions {
  detail: RhythmDetail
  fillGaps: boolean
  straightSwing: boolean
  /** write triplets in simple meters where the notes clearly divide a beat in three */
  triplets?: boolean
}

export const DEFAULT_RHYTHM: RhythmOptions = { detail: 'standard', fillGaps: true, straightSwing: true, triplets: true }

export interface BeatNote { b: number; be: number; p: number; v: number; strum?: 'down' | 'up'; tech?: Technique[]; bend?: number }

export interface GridOnset { tick: number; end: number; pitches: Map<number, number>; strum?: 'down' | 'up'; tech?: Technique[]; bend?: number }

/** Ticks in one tracked beat, and the subdivisions a beat may use. */
export function beatFrame(grid: EngineGrid, detail: RhythmDetail): { beatTicks: number; divisions: number[] } {
  const ts = grid.timeSig ?? { num: grid.meter, den: 4 }
  const compound = ts.den === 8 && grid.meter !== 6
  if (compound) {
    // each beat is a dotted quarter: three eighths
    return { beatTicks: PPQ * 1.5, divisions: detail === 'simple' ? [1, 3] : detail === 'standard' ? [1, 3, 6] : [1, 3, 6, 12] }
  }
  if (grid.meter === 6) return { beatTicks: PPQ / 2, divisions: detail === 'detailed' ? [1, 2, 4] : [1, 2] }
  return { beatTicks: PPQ, divisions: detail === 'simple' ? [1, 2] : detail === 'standard' ? [1, 2, 4] : [1, 2, 4, 8] }
}

/** Simple meters (2/4, 3/4, 4/4…) are where a triplet is a special case worth writing. */
function beatFrameIsSimple(grid: EngineGrid): boolean {
  const ts = grid.timeSig ?? { num: grid.meter, den: 4 }
  return ts.den === 4 && grid.meter !== 6
}

/** Swung eighths (long-short) written as straight eighths. */
export function unswing(frac: number, swing: number | undefined, on: boolean): number {
  if (!on || !swing || swing < 0.56 || swing > 0.8) return frac
  return frac < swing ? (frac * 0.5) / swing : 0.5 + ((frac - swing) * 0.5) / (1 - swing)
}

const distance = (f: number, d: number) => Math.abs(f - Math.round(f * d) / d)
const worst = (fracs: number[], d: number) => Math.max(...fracs.map((f) => distance(f, d)))

/**
 * The simplest subdivision for each beat: the coarsest one that puts every onset in that beat
 * within reach of a grid line (a little over half a step, which absorbs human timing).
 *
 * With `triplets`, a beat is written in three only when that fits clearly better than the binary
 * values: some note must sit near a third of the beat (not near a quarter), and all of them
 * within ~6% of a beat of the triplet lines. Sloppy sixteenths stay sixteenths.
 */
export function chooseDivisions(fracsByBeat: Map<number, number[]>, divisions: number[], triplets: number[] = []): Map<number, number> {
  const out = new Map<number, number>()
  for (const [beat, fracs] of fracsByBeat) {
    let pick = divisions[divisions.length - 1]
    for (const d of divisions) {
      if (fracs.every((f) => distance(f, d) <= (0.5 / d) * 0.62)) { pick = d; break }
    }
    if (triplets.length && pick >= 4 && fracs.length >= 2) {
      const binary = worst(fracs, Math.max(4, pick))
      for (const t of triplets) {
        const fit = worst(fracs, t)
        const thirds = fracs.some((f) => distance(f, 3) < 0.05 && distance(f, 4) > 0.06)
        if (thirds && fit <= 0.06 && fit + 0.025 < binary) { pick = t; break }
      }
    }
    out.set(beat, pick)
  }
  return out
}

/** Snap a beat position with the subdivision its beat uses. Returns ticks. */
function snap(b: number, divisionOf: (beat: number) => number, frame: { beatTicks: number }, swing: number | undefined, straight: boolean): number {
  let beat = Math.floor(b + 1e-6)
  let f = unswing(b - beat, swing, straight)
  const d = divisionOf(beat)
  let step = Math.round(f * d)
  if (step === d) { beat += 1; step = 0; f = 0 }
  return Math.round((beat + step / d) * frame.beatTicks)
}

export type LineMode = 'poly' | 'melody' | 'bass' | 'drums'

/**
 * Quantize notes that carry beat positions. Notes landing on the same tick become one chord;
 * a single line (melody, bass) keeps one note per tick. Durations snap too, never shorter than
 * one step, and (with fillGaps) run on to the next note instead of leaving a sliver of rest.
 */
export function quantizeOnGrid(notes: BeatNote[], grid: EngineGrid, opts: RhythmOptions, mode: LineMode, maxPoly = 8): GridOnset[] {
  const frame = beatFrame(grid, opts.detail)
  const fracs = new Map<number, number[]>()
  for (const n of notes) {
    if (n.b < -0.25) continue
    const beat = Math.floor(n.b + 1e-6)
    const f = unswing(n.b - beat, grid.swing, opts.straightSwing)
    ;(fracs.get(beat) ?? fracs.set(beat, []).get(beat)!).push(f)
  }
  const simple = beatFrameIsSimple(grid)
  const tripletDivs = opts.triplets !== false && simple ? (opts.detail === 'detailed' ? [3, 6] : [3]) : []
  const divisions = chooseDivisions(fracs, frame.divisions, tripletDivs)
  const fallback = frame.divisions.includes(2) ? 2 : frame.divisions[1] ?? 1
  const divisionOf = (beat: number) => divisions.get(beat) ?? fallback
  const byTick = new Map<number, GridOnset>()
  for (const n of notes) {
    const tick = Math.max(0, snap(n.b, divisionOf, frame, grid.swing, opts.straightSwing))
    const stepTicks = frame.beatTicks / divisionOf(Math.floor(n.b + 1e-6))
    const end = Math.max(tick + stepTicks, snap(Math.max(n.be, n.b), divisionOf, frame, grid.swing, opts.straightSwing))
    let on = byTick.get(tick)
    if (!on) { on = { tick, end, pitches: new Map() }; byTick.set(tick, on) }
    if (n.strum) on.strum = n.strum
    if (n.tech?.length) { on.tech = [...new Set([...(on.tech ?? []), ...n.tech])]; if (n.bend) on.bend = n.bend }
    on.end = Math.max(on.end, end)
    on.pitches.set(n.p, Math.max(on.pitches.get(n.p) ?? 0, n.v))
  }
  const onsets = [...byTick.values()].sort((a, b) => a.tick - b.tick)
  for (const on of onsets) {
    const loudest = [...on.pitches.entries()].sort((a, b) => b[1] - a[1])
    if (mode === 'melody' || mode === 'bass') on.pitches = new Map([loudest[0]])
    else if (mode !== 'drums') on.pitches = new Map(loudest.slice(0, maxPoly))
  }
  if (opts.fillGaps && mode !== 'drums') {
    // a gap shorter than half a beat (a whole beat under chords) is notation noise, not a rest
    const limit = mode === 'poly' ? frame.beatTicks : frame.beatTicks / 2
    for (let i = 0; i + 1 < onsets.length; i++) {
      const gap = onsets[i + 1].tick - onsets[i].end
      if (gap > 0 && gap <= limit) onsets[i].end = onsets[i + 1].tick
    }
  }
  return onsets
}

/**
 * Score tempo from the beat grid. With `follow`, a tempo change is written at a bar only when
 * the recording has drifted more than ~30 ms from the written tempo, so a steady band gets one
 * tempo and a drifting one stays in sync bar by bar.
 */
export function tempoPlan(grid: EngineGrid, beatTicks: number, follow: boolean): { tempo: number; changes: TempoChange[] } {
  const q = beatTicks / PPQ // quarter notes per tracked beat
  const t = grid.times
  const m = grid.meter
  // average tempo: least-squares slope of beat time against beat number
  const n = t.length
  const mean = (n - 1) / 2
  const tm = t.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  t.forEach((x, i) => { num += (i - mean) * (x - tm); den += (i - mean) ** 2 })
  const fitted = (60 * q) / (num / den || 0.5)
  const nice = (bpm: number) => Math.abs(bpm - Math.round(bpm)) < 0.15 ? Math.round(bpm) : Math.round(bpm * 10) / 10
  const tempo = nice(fitted)
  if (!follow) return { tempo, changes: [] }
  const bars = Math.floor((n - 1) / m)
  const barSec = (bpm: number) => (60 * q * m) / bpm
  const changes: TempoChange[] = []
  let written = tempo
  let start = t[0] // where the written tempo puts the current bar line
  for (let k = 0; k < bars; k++) {
    const actual = t[(k + 1) * m]
    if (Math.abs(start + barSec(written) - actual) > 0.03) {
      const bpm = Math.round(((60 * q * m) / (actual - start)) * 10) / 10
      if (Math.abs(bpm - written) >= 0.1) {
        changes.push({ measure: k, bpm })
        written = bpm
      }
    }
    start += barSec(written)
  }
  if (changes[0]?.measure === 0) return { tempo: changes.shift()!.bpm, changes }
  return { tempo, changes }
}
