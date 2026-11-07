import { describe, it, expect } from 'vitest'
import { PPQ, type EngineGrid } from '@shared/types'
import { chooseDivisions, quantizeOnGrid, tempoPlan, unswing, DEFAULT_RHYTHM } from '@/music/beatgrid'
import { analysisToScore, DEFAULT_TRANSCRIBE } from '@/music/quantize'
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
