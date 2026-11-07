import { parseYouTubeId } from '../src/shared/youtube'
import { detectedBpm, recordingRate } from '../src/shared/rhythm'
import { newer } from '../src/shared/version'
import { noteFromName } from '../src/shared/sounds'
import { describe, it, expect } from 'vitest'
import { Midi } from '@tonejs/midi'
import { decompose, spell, measureTicks, pitchFromLetter, WHOLE } from '@/music/theory'
import { emptyMeasure, overwrite, newScore, newProject, flattenPart, tempoMap, normalizeMeasure, rippleDelete, moveEvent, diatonicShift, partTimeline, defaultPart } from '@/music/score'
import { assignTab, positionsFor, suggestTuning } from '@/music/tab'
import { quantizeNotes, onsetsToMeasures, detectKey, analysisToScore } from '@/music/quantize'
import { scoreToMidi, midiToScore } from '@/music/midi'
import { scoreToMusicXml } from '@/music/musicxml'
import { partToAsciiTab } from '@/music/asciitab'
import { encodeWav } from '@/music/wav'
import { PPQ } from '@shared/types'

const MT = measureTicks({ num: 4, den: 4 })
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

function wellFormed(xml: string): boolean {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '')
  const stack: string[] = []
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m
    if (self) continue
    if (close) { if (stack.pop() !== name) return false } else stack.push(name)
  }
  return stack.length === 0
}

describe('durations', () => {
  it('decomposes spans onto the grid', () => {
    expect(decompose(0, MT)).toEqual([WHOLE])
    expect(decompose(480, 1440, false)).toEqual([480, 960])
    expect(sum(decompose(120, 1000))).toBe(1000)
    expect(decompose(0, 720)).toEqual([720]) // dotted quarter
  })
})

describe('measure editing', () => {
  it('overwrites a rest with a note and refills', () => {
    const m = emptyMeasure(MT)
    const { measure } = overwrite(m, MT, { notes: [{ pitch: 60 }], velocity: 90 }, 0, PPQ)
    expect(measure.events.map((e) => [e.start, e.dur, !!e.rest])).toEqual([[0, 480, false], [480, 480, true], [960, 960, true]])
  })
  it('truncates an overlapped note and keeps total length', () => {
    let m = overwrite(emptyMeasure(MT), MT, { notes: [{ pitch: 60 }], velocity: 90 }, 0, 960).measure
    m = overwrite(m, MT, { notes: [{ pitch: 64 }], velocity: 90 }, 480, 480).measure
    expect(m.events[0].dur).toBe(480)
    expect(m.events[1].notes[0].pitch).toBe(64)
    expect(sum(m.events.map((e) => e.dur))).toBe(MT)
  })
  it('splits non-representable notes into ties', () => {
    const m = normalizeMeasure({ events: [{ id: 'a', start: 0, dur: 1200, notes: [{ pitch: 60 }], velocity: 80 }] }, MT)
    const notes = m.events.filter((e) => !e.rest)
    expect(sum(notes.map((e) => e.dur))).toBe(1200)
    expect(notes[0].tie).toBe(true)
    expect(notes[notes.length - 1].tie).toBeFalsy()
  })
})

describe('pitch', () => {
  it('spells by key', () => {
    expect(spell(61, 2)).toEqual({ step: 'C', alter: 1, octave: 4 })
    expect(spell(61, -4)).toEqual({ step: 'D', alter: -1, octave: 4 })
    expect(spell(71, -7)).toEqual({ step: 'C', alter: -1, octave: 5 })
    expect(spell(60, 0)).toEqual({ step: 'C', alter: 0, octave: 4 })
  })
  it('chooses nearest octave for letter input', () => {
    expect(pitchFromLetter('A', 0, 67)).toBe(69)
    expect(pitchFromLetter('F', 1, 64)).toBe(66) // F# in G major
  })
})

describe('tab', () => {
  const s = newScore({ title: 't', composer: '', tempo: 120, num: 4, den: 4, keyFifths: 0, instruments: ['acoustic-guitar'], measures: 1 })
  const g = s.parts[0]
  it('finds positions', () => {
    expect(positionsFor(g, 40)).toEqual([{ string: 6, fret: 0 }])
    expect(positionsFor(g, 64).map((x) => x.string)).toContain(1)
  })
  it('assigns an open C chord on distinct strings with small stretch', () => {
    g.measures[0] = overwrite(g.measures[0], MT, { notes: [48, 52, 55, 60, 64].map((pitch) => ({ pitch })), velocity: 80 }, 0, PPQ).measure
    const pos = assignTab(g).get(g.measures[0].events[0].id)!
    const strings = pos.map((p) => p!.string)
    expect(new Set(strings).size).toBe(5)
    const frets = pos.map((p) => p!.fret)
    expect(Math.max(...frets)).toBeLessThanOrEqual(5)
  })
  it('respects capo', () => {
    const p = { ...g, capo: 2 }
    expect(positionsFor(p, 42)).toEqual([{ string: 6, fret: 0 }])
  })
})

describe('transcription quantization', () => {
  it('groups chords, quantizes, and ties across barlines', () => {
    const tempo = 120 // 0.5s per beat
    const notes = [
      { s: 0.01, e: 0.49, p: 60, v: 90 },
      { s: 0.0, e: 0.5, p: 64, v: 80 },
      { s: 1.5, e: 2.5, p: 67, v: 90 } // beat 4 -> beat 2 of bar 2
    ]
    const on = quantizeNotes(notes, { tempo, offset: 0, timeSig: { num: 4, den: 4 } })
    expect(on.length).toBe(2)
    expect(on[0].pitches.size).toBe(2)
    const ms = onsetsToMeasures(on, { num: 4, den: 4 })
    expect(ms.length).toBe(2)
    const last = ms[0].events.filter((e) => !e.rest).pop()!
    expect(last.tie).toBe(true)
    expect(ms[1].events[0].notes[0].pitch).toBe(67)
  })
  it('detects C major and A minor', () => {
    const cmaj = [60, 62, 64, 65, 67, 69, 71, 72, 60, 64, 67].map((p) => ({ p, dur: 1 }))
    expect(detectKey(cmaj).fifths).toBe(0)
    const amin = [57, 59, 60, 62, 64, 65, 68, 69, 57, 60, 64, 57].map((p) => ({ p, dur: 1 }))
    expect(detectKey(amin).name).toBe('A minor')
  })
  it('builds a multi-part score from engine analysis', () => {
    const { score, offset } = analysisToScore({
      tempo: 100, beatOffset: 0.6, device: 'cpu',
      stems: [{ name: 'bass', file: 'stems/bass.wav', kind: 'bass', confidence: 0.9 }, { name: 'piano', file: 'stems/piano.wav', kind: 'piano', confidence: 0.7 }, { name: 'drums', file: 'stems/drums.wav', kind: 'drums', confidence: 1 }],
      notes: { bass: [{ s: 0.6, e: 1.2, p: 40, v: 90 }], piano: [{ s: 0.6, e: 1.2, p: 72, v: 70 }, { s: 0.6, e: 1.2, p: 48, v: 70 }] },
      drums: [{ t: 0.6, piece: 'kick', v: 100 }, { t: 0.9, piece: 'snare', v: 90 }]
    }, 'Song', 'Artist')
    expect(offset).toBeCloseTo(0.6)
    expect(score.parts.map((p) => p.name)).toEqual(['Bass', 'Piano RH', 'Piano LH', 'Drums'])
    const lens = new Set(score.parts.map((p) => p.measures.length))
    expect(lens.size).toBe(1)
    expect(score.parts[3].measures[0].events.some((e) => e.notes.some((n) => n.pitch === 36))).toBe(true)
  })
})

describe('playback model', () => {
  it('rolls a chord in the chosen direction and keeps its original end in playback and MIDI', () => {
    const s = newScore({ title: 'Roll', composer: '', tempo: 120, num: 4, den: 4, keyFifths: 0, instruments: ['piano'], measures: 1 })
    const p = s.parts[0]
    p.measures[0] = overwrite(p.measures[0], MT, {
      notes: [{ pitch: 60 }, { pitch: 67 }, { pitch: 64 }], velocity: 90, arpeggio: { direction: 'down', delayMs: 50 }
    }, 0, 480).measure
    const notes = flattenPart(p, tempoMap(s))
    expect(notes.map((n) => [n.pitch, n.tick, n.tick + n.dur])).toEqual([[67, 0, 480], [64, 48, 480], [60, 96, 480]])
    const midi = new Midi(scoreToMidi(s))
    expect(midi.tracks[0].notes.map((n) => [n.midi, n.ticks])).toEqual([[67, 0], [64, 48], [60, 96]])
  })

  it('spaces a roll in beats, independent of tempo', () => {
    for (const tempo of [60, 180]) {
      const s = newScore({ title: 'Roll', composer: '', tempo, num: 4, den: 4, keyFifths: 0, instruments: ['piano'], measures: 1 })
      const p = s.parts[0]
      p.measures[0] = overwrite(p.measures[0], MT, { notes: [{ pitch: 60 }, { pitch: 64 }, { pitch: 67 }], velocity: 90, arpeggio: { direction: 'up', beats: 1 / 8 } }, 0, 960).measure
      expect(flattenPart(p, tempoMap(s)).map((n) => n.tick)).toEqual([0, 60, 120])
    }
  })

  it('merges ties into one sounding note', () => {
    const s = newScore({ title: 't', composer: '', tempo: 120, num: 4, den: 4, keyFifths: 0, instruments: ['vocals'], measures: 2 })
    const p = s.parts[0]
    p.measures[0] = overwrite(p.measures[0], MT, { notes: [{ pitch: 60 }], velocity: 80, tie: true }, 1440, 480).measure
    p.measures[1] = overwrite(p.measures[1], MT, { notes: [{ pitch: 60 }], velocity: 80 }, 0, 480).measure
    const notes = flattenPart(p, tempoMap(s))
    expect(notes.length).toBe(1)
    expect(notes[0].dur).toBe(960)
  })
  it('maps ticks to seconds with tempo changes and speed', () => {
    const s = newScore({ title: 't', composer: '', tempo: 120, num: 4, den: 4, keyFifths: 0, instruments: ['piano'], measures: 4 })
    s.tempoChanges = [{ measure: 2, bpm: 60 }]
    const tm = tempoMap(s)
    expect(tm.tickToSec(MT * 2)).toBeCloseTo(4)
    expect(tm.tickToSec(MT * 3)).toBeCloseTo(8)
    expect(tm.secToTick(6)).toBeCloseTo(MT * 2.5)
    expect(tempoMap(s, 0.5).tickToSec(MT)).toBeCloseTo(4)
  })
})

describe('exporters', () => {
  const s = newScore({ title: 'Demo & Test', composer: 'Me', tempo: 96, num: 3, den: 4, keyFifths: -2, instruments: ['piano', 'clean-guitar', 'bass', 'drums'], measures: 3 })
  const mt3 = measureTicks(s.timeSig)
  s.parts[0].measures[0] = overwrite(s.parts[0].measures[0], mt3, { notes: [{ pitch: 70 }, { pitch: 74 }], velocity: 90, art: ['staccato'], dynamic: 'mf' }, 0, PPQ).measure
  s.parts[2].measures[1] = overwrite(s.parts[2].measures[1], mt3, { notes: [{ pitch: 52 }], velocity: 90, tech: ['hammer'] }, 0, PPQ).measure
  s.parts[4].measures[0] = overwrite(s.parts[4].measures[0], mt3, { notes: [{ pitch: 36 }, { pitch: 42 }], velocity: 100 }, 0, PPQ / 2).measure

  it('writes a MIDI file readable by other tools', () => {
    const bytes = scoreToMidi(s)
    const midi = new Midi(bytes)
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(96)
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([3, 4])
    const piano = midi.tracks.find((t) => t.name === 'Piano RH')!
    expect(piano.notes.map((n) => n.midi).sort()).toEqual([70, 74])
    const drums = midi.tracks.find((t) => t.name === 'Drums')!
    expect(drums.channel).toBe(9)
    expect(midi.tracks.find((t) => t.name === 'Clean Electric Guitar')!.notes[0].ticks).toBe(mt3)
  })
  it('round-trips MIDI into a score', () => {
    const back = midiToScore(scoreToMidi(s).buffer as ArrayBuffer, 'x')
    expect(back.tempo).toBe(96)
    expect(back.parts.length).toBe(3) // tracks without notes are skipped
  })
  it('exports a selected range', () => {
    const midi = new Midi(scoreToMidi(s, { from: 1, to: 1, partIds: [s.parts[2].id] }))
    expect(midi.tracks.length).toBe(1)
    expect(midi.tracks[0].notes[0].ticks).toBe(0)
  })
  it('writes well-formed MusicXML with tab and percussion', () => {
    const xml = scoreToMusicXml(s)
    expect(wellFormed(xml)).toBe(true)
    expect(xml).toContain('<fifths>-2</fifths>')
    expect(xml).toContain('<step>B</step><alter>-1</alter>')
    expect(xml).toContain('<staccato/>')
    expect(xml).toContain('<display-step>F</display-step>')
    expect(xml).toContain('<hammer-on type="start">H</hammer-on>')
    expect(xml).toContain('Demo &amp; Test')
  })
  it('writes ascii tab for fretted parts', () => {
    const t = partToAsciiTab(s, s.parts[2])
    expect(t.split('\n').filter((l) => l.includes('|')).length).toBeGreaterThanOrEqual(6)
  })
  it('encodes WAV headers', () => {
    const w = encodeWav([new Float32Array(100), new Float32Array(100)], 48000, 24)
    const v = new DataView(w.buffer)
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint16(34, true)).toBe(24)
    expect(w.length).toBe(44 + 100 * 2 * 3)
  })
})

describe('releases and samples', () => {
  it('compares versions numerically', () => {
    expect(newer('v0.10.0', '0.9.3')).toBe(true)
    expect(newer('0.2.0', '0.2.0')).toBe(false)
    expect(newer('v0.1.9', '0.2.0')).toBe(false)
  })
  it('reads a sample\'s root note from its file name', () => {
    expect(noteFromName('Grand Piano C4.wav')).toBe(60)
    expect(noteFromName('Bass_A#2.wav')).toBe(46)
    expect(noteFromName('Cello-Db3.aif')).toBe(49)
    expect(noteFromName('69.wav')).toBe(69)
    expect(noteFromName('kick.wav')).toBeNull()
  })
})

describe('recording tempo controls', () => {
  it('uses the recording reference BPM only when linking is enabled', () => {
    const project = newProject(newScore({ title: '', composer: '', tempo: 150, num: 4, den: 4, keyFifths: 0, instruments: [] }), 'transcription')
    project.audio = { original: 'audio/original.wav', duration: 30, offset: 0 }
    project.analysis = { status: 'done', detectedTempo: 119.8 }
    expect(detectedBpm(project)).toBe(120)
    expect(recordingRate(project, 0.8)).toBe(0.8)
    project.audio.tempoLinked = true
    expect(recordingRate(project, 0.8)).toBe(1)
    project.audio.referenceTempo = 100
    expect(recordingRate(project, 0.8)).toBeCloseTo(1.2)
  })
})

describe('instrument defaults', () => {
  it('can create keyboard instruments with one staff', () => {
    const options = { title: '', composer: '', tempo: 120, num: 4, den: 4, keyFifths: 0, instruments: ['piano' as const] }
    expect(newScore(options).parts).toHaveLength(2)
    expect(newScore({ ...options, pianoGrandStaff: false }).parts).toHaveLength(1)
  })

  it('suggests a preset that can play a note below standard guitar range', () => {
    const score = newScore({ title: '', composer: '', tempo: 120, num: 4, den: 4, keyFifths: 0, instruments: ['clean-guitar'], measures: 1 })
    const [part] = score.parts
    expect(suggestTuning(part)).toBeNull()
    part.measures[0].events = [{ id: 'low-d', start: 0, dur: PPQ, velocity: 80, notes: [{ pitch: 38 }] }]
    expect(suggestTuning(part)?.name).toBe('Drop D')
  })
})

describe('shift back and drag', () => {
  const bar = (pitches: number[]) => {
    let m = emptyMeasure(MT)
    pitches.forEach((p, i) => { m = overwrite(m, MT, { notes: [{ pitch: p }], velocity: 90 }, i * PPQ, PPQ).measure })
    return m
  }
  const notes = (part: ReturnType<typeof defaultPart>) => partTimeline(part, MT).map((x) => [x.at, x.e.notes[0].pitch, x.e.dur])
  it('pulls later notes back across the barline, keeping the bar count', () => {
    const part = defaultPart('piano', 2, MT)
    part.measures = [bar([60, 62, 64, 65]), bar([67, 69, 71, 72])]
    rippleDelete(part, MT, new Set([part.measures[0].events[1].id]))
    expect(part.measures.length).toBe(2)
    expect(notes(part).map((n) => n[1])).toEqual([60, 64, 65, 67, 69, 71, 72])
    expect(part.measures[0].events.map((e) => e.notes[0]?.pitch)).toEqual([60, 64, 65, 67])
    expect(part.measures[1].events.at(-1)!.rest).toBe(true)
  })
  it('a note moved over a barline is tied, and its old place becomes rest', () => {
    const part = defaultPart('piano', 2, MT)
    part.measures = [bar([60]), emptyMeasure(MT)]
    const id = part.measures[0].events[0].id
    part.measures[0] = overwrite(part.measures[0], MT, { id, notes: [{ pitch: 60 }], velocity: 90 }, 0, PPQ * 2).measure
    moveEvent(part, MT, id, MT - PPQ, { steps: 1, keyFifths: 0 })
    const t = notes(part)
    expect(t).toEqual([[MT - PPQ, 62, PPQ], [MT, 62, PPQ]])
    expect(part.measures[0].events.find((e) => !e.rest)!.tie).toBe(true)
    expect(sum(part.measures[0].events.map((e) => e.dur))).toBe(MT)
  })
  it('copy keeps the original; moving onto a note replaces it', () => {
    const part = defaultPart('piano', 1, MT)
    part.measures = [bar([60, 62])]
    moveEvent(part, MT, part.measures[0].events[0].id, PPQ, { copy: true })
    expect(notes(part)).toEqual([[0, 60, PPQ], [PPQ, 60, PPQ]])
  })
  it('steps follow the key signature', () => {
    expect(diatonicShift(60, 1, 0)).toBe(62)
    expect(diatonicShift(64, 1, 0)).toBe(65)
    expect(diatonicShift(66, 1, 1)).toBe(67) // G major: F# up to G
    expect(diatonicShift(65, 1, 1)).toBe(66) // F natural is written E#, so one step up is F#
    expect(diatonicShift(60, -1, 0)).toBe(59)
    expect(diatonicShift(60, 7, 0)).toBe(72)
  })
})

describe("YouTube video links", () => {
  it("uses the same parser for pasted, mobile, and short links", () => {
    expect(parseYouTubeId(" https://youtu.be/dQw4w9WgXcQ?si=abc ")).toBe("dQw4w9WgXcQ")
    expect(parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(parseYouTubeId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
  })
})

describe("Transcription leading rests", () => {
  it("omits complete empty bars before the first detected note", () => {
    const analysis = { tempo: 120, beatOffset: 0, downbeat: 0, device: "cpu", stems: [{ name: "piano", file: "stems/piano.wav", kind: "piano", confidence: 1 }], notes: { piano: [{ s: 8, e: 8.5, p: 64, v: 90 }] } } as Parameters<typeof analysisToScore>[0]
    const result = analysisToScore(analysis, "Intro", "", { num: 4, den: 4 })
    expect(result.offset).toBe(8)
    expect(result.score.parts[0].measures[0].events.find((event) => !event.rest)?.start).toBe(0)
  })
})

describe("Singer transcription", () => {
  it("keeps words and the isolated recording without generating notes", () => {
    const lyrics = { language: "en", text: "Hello", words: [{ start: 0.2, end: 0.8, text: "Hello" }] }
    const analysis = { tempo: 120, beatOffset: 0, duration: 4, device: "cpu", stems: [{ name: "vocals", file: "stems/vocals.wav", kind: "vocals", confidence: 1 }], notes: { vocals: [{ s: 0.2, e: 0.8, p: 65, v: 95 }] }, lyrics: { vocals: lyrics } } as Parameters<typeof analysisToScore>[0]
    const { score } = analysisToScore(analysis, "Song", "", { num: 4, den: 4 })
    expect(score.parts[0].kind).toBe("singer")
    expect(score.parts[0].name).toBe("Singer")
    expect(score.parts[0].stem).toBe("stems/vocals.wav")
    expect(score.parts[0].playback).toBe("audio")
    expect(score.parts[0].lyrics).toEqual(lyrics)
    expect(score.parts[0].measures.flatMap((measure) => measure.events).every((event) => event.rest)).toBe(true)
  })
})
