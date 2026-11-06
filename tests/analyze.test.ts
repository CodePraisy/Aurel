import { afterAll, describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { guessTempo } from '../src/main/analyze'
import { encodeWav } from '@/music/wav'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurel-rhythm-'))
const sr = 44100

afterAll(() => {
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name))
  fs.rmdirSync(dir)
})

function writeTrack(name: string, channels: Float32Array[]): string {
  const file = path.join(dir, `${name}.wav`)
  fs.writeFileSync(file, encodeWav(channels, sr, 16))
  return file
}

/** Kick on downbeats, softer clicks on other beats, starting after `lead` seconds. */
function clickTrack(bpm: number, beatsPerBar: number, seconds: number, lead: number, invert = false): string {
  const x = new Float32Array(sr * seconds)
  const period = 60 / bpm
  for (let b = 0, t = lead; t < seconds - 0.3; b++, t += period) {
    const down = b % beatsPerBar === 0
    const s0 = Math.floor(t * sr)
    for (let i = 0; i < sr * 0.15; i++) {
      const tt = i / sr
      const kick = down ? Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12) * 0.9 : 0
      const tick = Math.sin(2 * Math.PI * 1800 * tt) * Math.exp(-tt * 60) * 0.25
      x[s0 + i] += kick + tick
    }
  }
  return writeTrack(`${bpm}-${beatsPerBar}`, [x, invert ? x.map((s) => -s) : x])
}

describe('tempo & meter detection', () => {
  it.each([[120, 4, 0.75], [96, 3, 0.4], [73.5, 4, 0.2], [147, 3, 0.53], [182, 4, 0.7]])(
    'finds %s BPM in %s/4 and the downbeat', (bpm, num, lead) => {
      const g = guessTempo(clickTrack(bpm, num, 35, lead))
      expect(g).not.toBeNull()
      expect(g!.bpm).toBe(Math.round(bpm))
      expect(g!.timeSig).toEqual({ num, den: 4 })
      expect(g!.downbeat).toBeCloseTo(lead, 1)
    }
  )
  it('keeps the pulse when stereo channels cancel in a mono sum', () => {
    const g = guessTempo(clickTrack(104, 4, 22, 0.2, true))
    expect(g?.bpm).toBeCloseTo(104, 0)
    expect(g?.timeSig).toEqual({ num: 4, den: 4 })
  })
  it('reports the tempo of unaccented beats with no meter estimate', () => {
    const g = guessTempo(clickTrack(133, 0, 24, 0.3))
    expect(g?.bpm).toBeCloseTo(133, 0)
    expect(g?.timeSig).toBeUndefined()
  })
  it('leaves tempo and meter unknown on silence', () => {
    expect(guessTempo(writeTrack('silence', [new Float32Array(sr * 8)]))).toBeNull()
  })
})
