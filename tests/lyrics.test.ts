import { describe, expect, it } from 'vitest'
import { lyricLines, lyricRows, lyricTimestamp, lyricTiming } from '@/music/lyrics'
import { newProject, newScore } from '@/music/score'
import { PPQ } from '@shared/types'

describe('lyric navigation and layout', () => {
  it('formats precise timestamps and carries rounded milliseconds into the next minute', () => {
    expect(lyricTimestamp(32.334)).toBe('0:32.334')
    expect(lyricTimestamp(59.9996)).toBe('1:00.000')
    expect(lyricTimestamp(-1)).toBe('0:00.000')
  })
  it('seeks to recording words with linked tempo and recording alignment', () => {
    const project = newProject(newScore({ title: '', composer: '', tempo: 150, num: 4, den: 4, keyFifths: 0, instruments: [] }), 'transcription')
    project.audio = { original: 'audio.wav', duration: 30, offset: 2, referenceTempo: 120, tempoLinked: true }
    const timing = lyricTiming(project)
    expect(timing.toTick(7)).toBeCloseTo(10 * PPQ)
    expect(timing.toSeconds(timing.toTick(7))).toBeCloseTo(7)
    project.audio.tempoLinked = false
    expect(lyricTiming(project).toTick(7)).toBeCloseTo(12.5 * PPQ)
  })
  it('groups phrases at punctuation or pauses without creating empty lines', () => {
    const words = [{ start: 0, end: 1, text: 'Hello' }, { start: 1, end: 2, text: 'world.' },
      { start: 2.1, end: 3, text: 'Sing' }, { start: 5, end: 6, text: 'again' }]
    expect(lyricLines(words).map((line) => line.map((w) => w.text))).toEqual([['Hello', 'world.'], ['Sing'], ['again']])
    expect(lyricLines([])).toEqual([])
    expect(lyricRows(words, 100)).toBeGreaterThan(lyricRows(words, 800))
  })
})
