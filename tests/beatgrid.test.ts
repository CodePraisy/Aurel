import { describe, it, expect } from 'vitest'
import { PPQ, type EngineGrid } from '@shared/types'
import { chooseDivisions, quantizeOnGrid, tempoPlan, unswing, DEFAULT_RHYTHM } from '@/music/beatgrid'
import { analysisToScore, DEFAULT_TRANSCRIBE } from '@/music/quantize'
import { decompose } from '@/music/theory'
import { placeLyrics } from '@/music/lyrics'

const steady = (bpm: number, beats: number, start = 0): number[] => Array.from({ length: beats + 1 }, (_, i) => start + (i * 60) / bpm)
const grid = (times: number[], meter = 4, extra: Partial<EngineGrid> = {}): EngineGrid => ({ times, meter, bpm: 60 / (times[1] - times[0]), timeSig: { num: meter, den: 4 }, ...extra })

describe('beat grid quantizing', () => {
  it('gives each beat the simplest rhythm that fits', () => {
    const d = chooseDivisions(new Map([[0, [0, 0.02]], [1, [0, 0.51]], [2, [0, 0.26, 0.49, 0.77]]]), [1, 2, 4])
    expect([d.get(0), d.get(1), d.get(2)]).toEqual([1, 2, 4])
  })

  it('keeps sloppy timing on the right beat instead of on a neighbouring 16th', () => {
    const notes = [0, 1.06, 1.94, 3.03].map((b) => ({ b, be: b + 0.9, p: 60, v: 90 }))
    const on = quantizeOnGrid(notes, grid(steady(100, 8)), DEFAULT_RHYTHM, 'melody')
    expect(on.map((o) => o.tick)).toEqual([0, PPQ, 2 * PPQ, 3 * PPQ])
  })

  it('writes swung eighths as straight eighths', () => {
    expect(unswing(0.66, 0.66, true)).toBeCloseTo(0.5)
    const notes = [0, 0.66, 1, 1.66].map((b) => ({ b, be: b + 0.3, p: 64, v: 90 }))
    const on = quantizeOnGrid(notes, grid(steady(120, 8), 4, { swing: 0.66 }), DEFAULT_RHYTHM, 'melody')
    expect(on.map((o) => o.tick)).toEqual([0, PPQ / 2, PPQ, 1.5 * PPQ])
  })

  it('holds notes over tiny gaps instead of writing slivers of rest', () => {
    const notes = [{ b: 0, be: 0.8, p: 60, v: 90 }, { b: 1, be: 1.9, p: 62, v: 90 }]
    const on = quantizeOnGrid(notes, grid(steady(120, 8)), DEFAULT_RHYTHM, 'melody')
    expect(on[0].end).toBe(PPQ)
  })

  it('a steady band gets one tempo; a drifting one gets tempo changes that keep bar lines on the audio', () => {
    expect(tempoPlan(grid(steady(96, 32)), PPQ, true)).toEqual({ tempo: 96, changes: [] })
    // the band speeds up from 100 to 112 bpm over 16 bars
    const times = [0]
    for (let i = 0; i < 64; i++) times.push(times[i] + 60 / (100 + (12 * i) / 64))
    const plan = tempoPlan(grid(times), PPQ, true)
    expect(plan.changes.length).toBeGreaterThan(2)
    // replay the plan: every bar line within 35 ms of the recording
    let t = 0, bpm = plan.tempo
    for (let bar = 0; bar < 16; bar++) {
      const change = plan.changes.find((c) => c.measure === bar)
      if (change) bpm = change.bpm
      t += (4 * 60) / bpm
      expect(Math.abs(t - times[(bar + 1) * 4])).toBeLessThan(0.035)
    }
    expect(tempoPlan(grid(times), PPQ, false).changes).toEqual([])
  })

  it('builds the score from beat positions: drums, chords and the pickup bar', () => {
    const times = steady(120, 16, 1.0)
    const a = {
      engine: 2, tempo: 120, beatOffset: 1, device: 'cpu', duration: 10, timeSig: { num: 4, den: 4 },
      grid: grid(times),
      stems: [{ name: 'guitar', file: 'stems/guitar.wav', kind: 'clean-guitar' as const, confidence: 1 }, { name: 'drums', file: 'stems/drums.wav', kind: 'drums' as const, confidence: 1 }],
      notes: { guitar: [52, 56, 59].map((p) => ({ s: 1.5, e: 2.4, p, v: 80, b: 1.02, be: 2.8 })) },
      drums: [{ t: 1, piece: 'kick', v: 100, b: 0 }, { t: 1.5, piece: 'snare', v: 100, b: 1.01 }]
    }
    const { score, offset } = analysisToScore(a, 'T', '', { num: 4, den: 4 }, undefined, true, DEFAULT_TRANSCRIBE)
    expect(offset).toBe(1)
    expect(score.tempo).toBe(120)
    const chord = score.parts[0].measures[0].events.find((e) => !e.rest)!
    expect(chord.start).toBe(PPQ)
    expect(chord.notes.map((n) => n.pitch).sort()).toEqual([52, 56, 59])
    const hits = score.parts[1].measures[0].events.filter((e) => !e.rest)
    expect(hits.map((e) => e.start)).toEqual([0, PPQ])
  })
})

describe('lyrics under their notes', () => {
  it('nudges a word right a little, or drops it a line rather than far from its note', () => {
    const placed = placeLyrics([{ x: 0, width: 50 }, { x: 40, width: 40 }, { x: 45, width: 30 }])
    expect(placed[0]).toEqual({ x: 0, line: 0 })
    expect(placed[1]).toEqual({ x: 54, line: 0 })
    expect(placed[2].line).toBe(1)
    expect(placed[2].x).toBe(45)
  })
})

describe('triplets', () => {
  it('writes a beat of triplets as triplets, but keeps sloppy sixteenths as sixteenths', () => {
    const d = chooseDivisions(new Map([[0, [0, 0.34, 0.65]], [1, [0, 0.27, 0.49, 0.73]], [2, [0.02, 0.31]]]), [1, 2, 4], [3])
    expect(d.get(0)).toBe(3)
    expect(d.get(1)).toBe(4)
    expect(d.get(2)).not.toBe(3) // a lone note late in the beat is a late 16th, not a triplet
  })

  it('triplet notes become triplet eighths that fill the beat', () => {
    const notes = [0, 0.33, 0.67, 1, 2].map((b, i) => ({ b: b + (i % 2 ? 0.01 : -0.01), be: b + 0.3, p: 64, v: 90 }))
    const { score } = analysisToScore({ engine: 3, tempo: 100, beatOffset: 0, device: 'cpu', timeSig: { num: 4, den: 4 }, grid: grid(steady(100, 8)),
      stems: [{ name: 'other', file: 'x.wav', kind: 'strings', confidence: 1 }], notes: { other: notes.map((n) => ({ ...n, s: n.b * 0.6, e: n.be * 0.6 })) } }, 'T', '', { num: 4, den: 4 }, undefined, true, DEFAULT_TRANSCRIBE)
    const evs = score.parts[0].measures[0].events
    expect(evs.slice(0, 3).map((e) => [e.start, e.dur])).toEqual([[0, PPQ / 3], [PPQ / 3, PPQ / 3], [(2 * PPQ) / 3, PPQ / 3]])
    expect(evs[3].start).toBe(PPQ)
    expect(evs.reduce((t, e) => t + e.dur, 0)).toBe(4 * PPQ)
  })

  it('splits a span that ends on a triplet into ordinary values, then triplets', () => {
    expect(decompose(0, PPQ * 2 + PPQ / 3)).toEqual([PPQ * 2, PPQ / 3])
    expect(decompose(PPQ / 3, PPQ * 2 - PPQ / 3)).toEqual([PPQ / 3, PPQ / 3, PPQ])
  })

  it('carries chord symbols and the engine key into the score', () => {
    const a = {
      engine: 3, tempo: 120, beatOffset: 0, device: 'cpu', timeSig: { num: 4, den: 4 }, grid: grid(steady(120, 8)),
      stems: [{ name: 'guitar', file: 'g.wav', kind: 'clean-guitar' as const, confidence: 1 }],
      notes: { guitar: [{ s: 0, e: 1, p: 55, v: 80, b: 0, be: 2, strum: 'down' as const }, { s: 0, e: 1, p: 59, v: 80, b: 0, be: 2 }, { s: 0, e: 1, p: 62, v: 80, b: 0, be: 2 }] },
      chords: [{ b: 0, be: 4, s: 0, e: 2, name: 'G' }, { b: 6, be: 8, s: 3, e: 4, name: 'Em' }],
      key: { tonic: 7, mode: 'major', name: 'G major', fifths: 1, confidence: 0.8 }
    }
    const { score } = analysisToScore(a, 'T', '', { num: 4, den: 4 }, undefined, true, DEFAULT_TRANSCRIBE)
    expect(score.keyFifths).toBe(1)
    expect(score.chords).toEqual([{ measure: 0, tick: 0, name: 'G' }, { measure: 1, tick: 2 * PPQ, name: 'Em' }])
    expect(score.parts[0].measures[0].events[0].strum).toBe('down')
  })
})

describe('MusicXML for the new notation', () => {
  it('writes chord symbols as <harmony> and triplets with <time-modification>', async () => {
    const { harmonyXml, scoreToMusicXml } = await import('@/music/musicxml')
    expect(harmonyXml('Bbm')).toContain('<root-step>B</root-step><root-alter>-1</root-alter></root><kind text="m">minor</kind>')
    expect(harmonyXml('G/B')).toContain('<bass><bass-step>B</bass-step></bass>')
    const notes = [0, 0.33, 0.67, 1].map((b) => ({ b, be: b + 0.3, p: 64, v: 90, s: b * 0.6, e: (b + 0.3) * 0.6 }))
    const { score } = analysisToScore({ engine: 3, tempo: 100, beatOffset: 0, device: 'cpu', timeSig: { num: 4, den: 4 }, grid: grid(steady(100, 8)),
      stems: [{ name: 'other', file: 'x.wav', kind: 'strings', confidence: 1 }], notes: { other: notes }, chords: [{ b: 0, be: 4, s: 0, e: 2.4, name: 'Em' }] }, 'T', '', { num: 4, den: 4 }, undefined, true, DEFAULT_TRANSCRIBE)
    const xml = scoreToMusicXml(score)
    expect(xml).toContain('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>')
    expect(xml).toContain('<root-step>E</root-step>')
  })
})

describe('chord boxes', () => {
  it('uses open shapes where they exist and barre shapes elsewhere', async () => {
    const { guitarShape } = await import('@/components/ChordDiagram')
    expect(guitarShape('G')!.frets).toEqual([3, 2, 0, 0, 0, 3])
    expect(guitarShape('F')!.frets).toEqual([1, 3, 3, 2, 1, 1]) // E-shape barre at 1
    expect(guitarShape('Bbm')!.frets).toEqual([null, 1, 3, 3, 2, 1]) // A-shape barre at 1
    expect(guitarShape('C#m7')!.base).toBe(4)
  })
})
