import { Midi } from '@tonejs/midi'
import type { InstrumentKind, Part, Score } from '@shared/types'
import { PPQ } from '@shared/types'
import { INSTRUMENTS, measureTicks } from './theory'
import { defaultPart, flattenPart, measureCount, tempoMap } from './score'
import { onsetsToMeasures, quantizeNotes, detectKey } from './quantize'

export interface RangeOpts { partIds?: string[]; from?: number; to?: number }

function vlq(n: number): number[] {
  const bytes = [n & 0x7f]
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80)
  return bytes
}

function str(s: string): number[] { return [...new TextEncoder().encode(s)] }

type Ev = { tick: number; order: number; data: number[] }

function trackChunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const body: number[] = []
  let last = 0
  for (const e of events) { body.push(...vlq(Math.max(0, e.tick - last)), ...e.data); last = Math.max(last, e.tick) }
  body.push(0x00, 0xff, 0x2f, 0x00)
  const len = body.length
  return [...str('MTrk'), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body]
}

export function partsInRange(score: Score, o: RangeOpts): Part[] {
  return score.parts.filter((p) => !o.partIds || o.partIds.includes(p.id))
}

/** Standard MIDI File (type 1). One track per part, conductor track first. */
export function scoreToMidi(score: Score, o: RangeOpts = {}): Uint8Array {
  const timing = tempoMap(score)
  const mt = timing.mt
  const from = o.from ?? 0
  const to = o.to ?? measureCount(score) - 1
  const t0 = from * mt
  const t1 = (to + 1) * mt
  const conductor: Ev[] = []
  const tempoEv = (tick: number, bpm: number) => {
    const us = Math.round(60_000_000 / bpm)
    conductor.push({ tick, order: 0, data: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] })
  }
  conductor.push({ tick: 0, order: 0, data: [0xff, 0x03, ...vlq(str(score.title).length), ...str(score.title)] })
  let bpm0 = score.tempo
  for (const c of score.tempoChanges ?? []) if (c.measure <= from) bpm0 = c.bpm
  tempoEv(0, bpm0)
  for (const c of score.tempoChanges ?? []) if (c.measure > from && c.measure <= to) tempoEv(c.measure * mt - t0, c.bpm)
  conductor.push({ tick: 0, order: 0, data: [0xff, 0x58, 0x04, score.timeSig.num, Math.log2(score.timeSig.den), 24, 8] })
  conductor.push({ tick: 0, order: 0, data: [0xff, 0x59, 0x02, score.keyFifths & 255, 0] })

  const tracks: number[][] = [trackChunk(conductor)]
  let ch = 0
  const groupCh = new Map<string, number>()
  for (const p of partsInRange(score, o)) {
    let channel: number
    if (p.kind === 'drums') channel = 9
    else if (p.group && groupCh.has(p.group)) channel = groupCh.get(p.group)!
    else { channel = ch; ch = (ch + 1) % 16; if (ch === 9) ch = 10; if (p.group) groupCh.set(p.group, channel) }
    const ev: Ev[] = [{ tick: 0, order: 0, data: [0xff, 0x03, ...vlq(str(p.name).length), ...str(p.name)] }]
    if (p.kind !== 'drums') ev.push({ tick: 0, order: 1, data: [0xc0 | channel, INSTRUMENTS[p.kind].program] })
    ev.push({ tick: 0, order: 1, data: [0xb0 | channel, 7, Math.round(p.volume * 127)] })
    ev.push({ tick: 0, order: 1, data: [0xb0 | channel, 10, Math.round((p.pan + 1) * 63.5)] })
    for (const n of flattenPart(p, timing)) {
      if (n.tick >= t1 || n.tick < t0) continue
      const on = n.tick - t0
      const off = Math.min(n.tick + n.dur, t1) - t0
      const dur = n.staccato ? Math.max(30, (off - on) / 2) : off - on
      ev.push({ tick: on, order: 3, data: [0x90 | channel, n.pitch, n.velocity] })
      ev.push({ tick: on + dur, order: 2, data: [0x80 | channel, n.pitch, 0] })
    }
    tracks.push(trackChunk(ev))
  }
  const header = [...str('MThd'), 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255]
  return new Uint8Array([...header, ...tracks.flat()])
}

const PROGRAM_KIND = (program: number, drums: boolean): InstrumentKind => {
  if (drums) return 'drums'
  if (program <= 3) return 'piano'
  if (program <= 7) return 'epiano'
  if (program >= 16 && program <= 23) return 'organ'
  if (program === 24 || program === 25) return 'acoustic-guitar'
  if (program >= 26 && program <= 28) return 'clean-guitar'
  if (program >= 29 && program <= 31) return 'distorted-guitar'
  if (program >= 32 && program <= 39) return 'bass'
  if (program >= 40 && program <= 51) return 'strings'
  if (program >= 52 && program <= 54) return 'vocals'
  if (program >= 56 && program <= 63) return 'brass'
  if (program >= 64 && program <= 79) return 'woodwinds'
  if (program >= 80 && program <= 103) return 'synth'
  return 'other'
}

/** Import a .mid file into a new score (notes are quantized to 16ths). */
export function midiToScore(data: ArrayBuffer, title: string): Score {
  const midi = new Midi(data)
  const tempo = Math.round(midi.header.tempos[0]?.bpm ?? 120)
  const tsArr = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4]
  const ts = { num: tsArr[0], den: tsArr[1] }
  const mt = measureTicks(ts)
  const scale = PPQ / midi.header.ppq
  const parts: Part[] = []
  const allNotes: { p: number; dur: number }[] = []
  for (const tr of midi.tracks) {
    if (!tr.notes.length) continue
    const drums = tr.channel === 9 || tr.instrument.percussion
    const kind = PROGRAM_KIND(tr.instrument.number, drums)
    // ticks -> seconds at a fixed tempo keeps quantization in score-time
    const raw = tr.notes.map((n) => ({ s: (n.ticks * scale) / PPQ * (60 / tempo), e: ((n.ticks + n.durationTicks) * scale) / PPQ * (60 / tempo), p: n.midi, v: Math.round(n.velocity * 127) }))
    if (!drums) raw.forEach((n) => allNotes.push({ p: n.p, dur: n.e - n.s }))
    const p = defaultPart(kind, 0, mt, tr.name || INSTRUMENTS[kind].label)
    if (kind === 'bass' || kind === 'piano') p.clef = kind === 'bass' ? 'bass' : avgPitch(raw) < 58 ? 'bass' : 'treble'
    p.measures = onsetsToMeasures(quantizeNotes(raw, { tempo, offset: 0, timeSig: ts, minDur: 0, maxPoly: drums ? 4 : 10, mode: 'poly' }), ts, 1, drums)
    parts.push(p)
  }
  if (!parts.length) parts.push(defaultPart('piano', 4, mt))
  const count = Math.max(...parts.map((p) => p.measures.length))
  for (const p of parts) while (p.measures.length < count) p.measures.push(...onsetsToMeasures([], ts, 1))
  return { title, composer: '', tempo, timeSig: ts, keyFifths: detectKey(allNotes).fifths, parts }
}

function avgPitch(n: { p: number }[]): number { return n.reduce((a, b) => a + b.p, 0) / Math.max(1, n.length) }
