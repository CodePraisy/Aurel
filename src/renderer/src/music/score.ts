import type { Measure, NoteEvent, NoteHead, Part, Score, InstrumentKind, Project, Technique } from '@shared/types'
import { PPQ } from '@shared/types'
import { decompose, INSTRUMENTS, measureTicks, isFretted } from './theory'

let idCounter = 0
export function uid(prefix = 'e'): string {
  idCounter = (idCounter + 1) % 1e6
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function restEvent(start: number, dur: number): NoteEvent {
  return { id: uid(), start, dur, rest: true, notes: [], velocity: 80 }
}

export function emptyMeasure(mt: number): Measure {
  return { events: decompose(0, mt, false).reduce<NoteEvent[]>((acc, d) => {
    const start = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].dur : 0
    acc.push(restEvent(start, d))
    return acc
  }, []) }
}

/**
 * Normalize a measure: sort, clip to the bar, split non-representable notes
 * into tied pieces, and re-fill all gaps (including former rests) with rests.
 */
export function normalizeMeasure(m: Measure, mt: number): Measure {
  const notes = m.events
    .filter((e) => !e.rest && e.notes.length > 0)
    .sort((a, b) => a.start - b.start)
  const out: NoteEvent[] = []
  let pos = 0
  for (let i = 0; i < notes.length; i++) {
    const e = notes[i]
    if (e.start >= mt) break
    const start = Math.max(e.start, pos)
    const nextStart = i + 1 < notes.length ? notes[i + 1].start : mt
    const end = Math.min(e.start + e.dur, mt, Math.max(nextStart, start))
    if (end <= start) continue
    if (start > pos) for (const d of decompose(pos, start - pos, false)) { out.push(restEvent(pos, d)); pos += d }
    pos = start
    const pieces = decompose(start, end - start)
    pieces.forEach((d, k) => {
      const last = k === pieces.length - 1
      out.push({ ...e, id: k === 0 ? e.id : uid(), start: pos, dur: d, tie: last ? e.tie : true, dynamic: k === 0 ? e.dynamic : undefined, arpeggio: k === 0 ? e.arpeggio : undefined })
      pos += d
    })
  }
  if (pos < mt) for (const d of decompose(pos, mt - pos, false)) { out.push(restEvent(pos, d)); pos += d }
  return { events: out }
}

/** Write an event over [start, start+dur), MuseScore-style overwrite. */
export function overwrite(m: Measure, mt: number, ev: Omit<NoteEvent, 'id' | 'start' | 'dur'> & { id?: string }, start: number, dur: number): { measure: Measure; id: string } {
  const end = Math.min(start + dur, mt)
  const kept: NoteEvent[] = []
  for (const e of m.events) {
    if (e.rest) continue
    const eEnd = e.start + e.dur
    if (eEnd <= start || e.start >= end) { kept.push(e); continue }
    if (e.start < start) kept.push({ ...e, dur: start - e.start, tie: false })
    // anything after `end` that the new event covered becomes rest
  }
  const id = ev.id ?? uid()
  if (!ev.rest && ev.notes.length) kept.push({ ...ev, id, start, dur: end - start } as NoteEvent)
  return { measure: normalizeMeasure({ events: kept }, mt), id }
}

export function measureCount(score: Score): number {
  return score.parts[0]?.measures.length ?? 0
}

export function defaultPart(kind: InstrumentKind, mCount: number, mt: number, name?: string): Part {
  const def = INSTRUMENTS[kind]
  return {
    id: uid('p'),
    name: name ?? def.label,
    kind,
    clef: def.clef,
    tuning: def.tuning ? [...def.tuning] : undefined,
    capo: isFretted(kind) ? 0 : undefined,
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    playback: 'midi',
    measures: Array.from({ length: mCount }, () => emptyMeasure(mt))
  }
}

/** Piano is written on a grand staff: two parts sharing a group. */
export function pianoParts(mCount: number, mt: number, kind: InstrumentKind = 'piano', label?: string): Part[] {
  const group = uid('g')
  const rh = defaultPart(kind, mCount, mt, `${label ?? INSTRUMENTS[kind].label} RH`)
  const lh = defaultPart(kind, mCount, mt, `${label ?? INSTRUMENTS[kind].label} LH`)
  rh.group = group
  lh.group = group
  lh.clef = 'bass'
  return [rh, lh]
}

export function newScore(opts: { title: string; composer: string; tempo: number; num: number; den: number; keyFifths: number; instruments: InstrumentKind[]; measures?: number }): Score {
  const ts = { num: opts.num, den: opts.den }
  const mt = measureTicks(ts)
  const count = opts.measures ?? 16
  const parts: Part[] = []
  for (const k of opts.instruments) {
    if (k === 'piano' || k === 'epiano' || k === 'organ') parts.push(...pianoParts(count, mt, k))
    else parts.push(defaultPart(k, count, mt))
  }
  return { title: opts.title, composer: opts.composer, tempo: opts.tempo, timeSig: ts, keyFifths: opts.keyFifths, parts }
}

export function setMeasureCount(score: Score, count: number): void {
  const mt = measureTicks(score.timeSig)
  for (const p of score.parts) {
    while (p.measures.length < count) p.measures.push(emptyMeasure(mt))
    if (p.measures.length > count) p.measures.length = count
  }
}

export function insertMeasures(score: Score, at: number, n = 1): void {
  const mt = measureTicks(score.timeSig)
  for (const p of score.parts) p.measures.splice(at, 0, ...Array.from({ length: n }, () => emptyMeasure(mt)))
}

export function deleteMeasures(score: Score, from: number, to: number): void {
  for (const p of score.parts) p.measures.splice(from, to - from + 1)
  if (measureCount(score) === 0) setMeasureCount(score, 1)
}

export function cloneMeasure(m: Measure): Measure {
  return { events: m.events.map((e) => ({ ...e, id: uid(), notes: e.notes.map((n) => ({ ...n })), art: e.art && [...e.art], tech: e.tech && [...e.tech] })) }
}

export function transposeEvent(e: NoteEvent, semis: number, keepFrets = false): NoteEvent {
  if (e.rest) return e
  return {
    ...e,
    notes: e.notes.map((n) => ({ pitch: Math.max(0, Math.min(127, n.pitch + semis)), ...(keepFrets && n.string ? { string: n.string } : {}) }))
  }
}

export function transposePart(p: Part, semis: number, from = 0, to = p.measures.length - 1): void {
  if (p.kind === 'drums') return
  for (let i = from; i <= to; i++) p.measures[i].events = p.measures[i].events.map((e) => transposeEvent(e, semis))
}

export function toggleIn<T>(arr: T[] | undefined, v: T): T[] {
  const a = arr ? [...arr] : []
  const i = a.indexOf(v)
  if (i >= 0) a.splice(i, 1)
  else a.push(v)
  return a
}

export function noteHeadsEqual(a: NoteHead[], b: NoteHead[]): boolean {
  if (a.length !== b.length) return false
  const pa = a.map((n) => n.pitch).sort()
  const pb = b.map((n) => n.pitch).sort()
  return pa.every((p, i) => p === pb[i])
}

// ---------- timing ----------
export interface TempoMap {
  mt: number
  tickToSec: (tick: number) => number
  secToTick: (sec: number) => number
  bpmAt: (tick: number) => number
}

export function tempoMap(score: Score, speed = 1): TempoMap {
  const mt = measureTicks(score.timeSig)
  const changes = [...(score.tempoChanges ?? [])].filter((c) => c.measure > 0).sort((a, b) => a.measure - b.measure)
  const segs: { tick: number; sec: number; bpm: number }[] = [{ tick: 0, sec: 0, bpm: score.tempo }]
  for (const c of changes) {
    const last = segs[segs.length - 1]
    const tick = c.measure * mt
    if (tick <= last.tick) { last.bpm = c.bpm; continue }
    segs.push({ tick, sec: last.sec + ((tick - last.tick) / PPQ) * (60 / (last.bpm * speed)), bpm: c.bpm })
  }
  const segFor = (tick: number) => { let s = segs[0]; for (const x of segs) if (x.tick <= tick) s = x; return s }
  return {
    mt,
    tickToSec: (tick) => { const s = segFor(tick); return s.sec + ((tick - s.tick) / PPQ) * (60 / (s.bpm * speed)) },
    secToTick: (sec) => {
      let s = segs[0]
      for (const x of segs) if (x.sec <= sec) s = x
      return s.tick + ((sec - s.sec) * s.bpm * speed * PPQ) / 60
    },
    bpmAt: (tick) => segFor(tick).bpm
  }
}

// ---------- playback flattening ----------
export interface PlayNote {
  partId: string
  tick: number
  dur: number // ticks (ties merged)
  pitch: number
  velocity: number
  tech?: Technique[]
  bend?: number
  staccato?: boolean
  accent?: boolean
  measure: number
  eventId: string
}

const DYN_VEL: Record<string, number> = { pp: 36, p: 52, mp: 68, mf: 84, f: 100, ff: 116 }

export function flattenPart(p: Part, timing: TempoMap): PlayNote[] {
  const out: PlayNote[] = []
  const open = new Map<number, PlayNote>() // pitch -> note awaiting tie continuation
  let dynVel: number | null = null
  p.measures.forEach((m, mi) => {
    for (const e of m.events) {
      if (e.dynamic) dynVel = DYN_VEL[e.dynamic]
      const tick = mi * timing.mt + e.start
      if (e.rest) { open.clear(); continue }
      const nextOpen = new Map<number, PlayNote>()
      const roll = p.kind !== 'drums' && e.notes.length > 1 ? e.arpeggio : undefined
      const notes = roll ? [...e.notes].sort((a, b) => (roll.direction === 'up' ? 1 : -1) * (a.pitch - b.pitch)) : e.notes
      const step = roll
        ? Math.min(Math.round(Math.max(0, roll.delayMs) * timing.bpmAt(tick) * PPQ / 60_000), Math.floor(e.dur * 0.8 / (notes.length - 1)))
        : 0
      for (const [i, n] of notes.entries()) {
        const cont = open.get(n.pitch)
        if (cont && cont.tick + cont.dur === tick) {
          cont.dur += e.dur
          if (e.tie) nextOpen.set(n.pitch, cont)
          continue
        }
        const vel = dynVel !== null ? Math.round((dynVel * e.velocity) / 84) : e.velocity
        const pn: PlayNote = {
          partId: p.id, tick: tick + i * step, dur: e.dur - i * step, pitch: n.pitch, velocity: Math.max(1, Math.min(127, vel)),
          tech: e.tech, bend: e.bend, staccato: e.art?.includes('staccato'), accent: e.art?.includes('accent') || e.art?.includes('marcato'),
          measure: mi, eventId: e.id
        }
        out.push(pn)
        if (e.tie) nextOpen.set(n.pitch, pn)
      }
      open.clear()
      nextOpen.forEach((v, k) => open.set(k, v))
    }
  })
  return out
}

export function scoreEndTick(score: Score): number {
  return measureCount(score) * measureTicks(score.timeSig)
}

export function newProject(score: Score, kind: Project['kind']): Project {
  const now = Date.now()
  return {
    id: uid('s'),
    kind,
    created: now,
    updated: now,
    score,
    practice: { loops: [], speed: 1 },
    view: { mode: 'both', zoom: 1, part: score.parts[0]?.id ?? 'all' }
  }
}

export function findEvent(p: Part, id: string): { mi: number; ei: number } | null {
  for (let mi = 0; mi < p.measures.length; mi++) {
    const ei = p.measures[mi].events.findIndex((e) => e.id === id)
    if (ei >= 0) return { mi, ei }
  }
  return null
}

export function ticksToBeats(t: number): number { return t / PPQ }

/** Re-bar a part after a time-signature change, splitting notes across new barlines with ties. */
export function rebar(part: Part, oldMt: number, newMt: number, count: number): void {
  const raw: NoteEvent[][] = Array.from({ length: count }, () => [])
  part.measures.forEach((m, mi) => {
    for (const e of m.events) {
      if (e.rest) continue
      let t = mi * oldMt + e.start
      let left = e.dur
      let first = true
      while (left > 0) {
        const nmi = Math.floor(t / newMt)
        if (nmi >= count) break
        const segEnd = Math.min(t + left, (nmi + 1) * newMt)
        raw[nmi].push({ ...e, id: first ? e.id : uid(), start: t - nmi * newMt, dur: segEnd - t, tie: segEnd < t + left ? true : e.tie, arpeggio: first ? e.arpeggio : undefined })
        left -= segEnd - t
        t = segEnd
        first = false
      }
    }
  })
  part.measures = raw.map((events) => normalizeMeasure({ events }, newMt))
}
