import type { Project, VocalTranscript } from '@shared/types'
import { recordingRate } from '@shared/rhythm'
import { tempoMap } from './score'

export type LyricWord = VocalTranscript['words'][number]

export function lyricTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

export function lyricTiming(project: Project) {
  const timing = tempoMap(project.score)
  const rate = recordingRate(project, 1)
  return {
    toTick: (seconds: number) => timing.secToTick((seconds - (project.audio?.offset ?? 0)) / rate),
    toSeconds: (tick: number) => timing.tickToSec(tick) * rate + (project.audio?.offset ?? 0)
  }
}

export function lyricLines(words: LyricWord[]): LyricWord[][] {
  const lines: LyricWord[][] = []
  for (const word of words) {
    const line = lines.at(-1)
    const previous = line?.at(-1)
    if (!line || (previous && (word.start - previous.end > 1.2 || line.length >= 9 || /[.!?…]$/.test(previous.text.trim())))) lines.push([word])
    else line.push(word)
  }
  return lines
}

/** Pack the same widths used for inline lyric buttons, leaving room for wrapping. */
export function lyricRows(words: LyricWord[], width: number): number {
  let rows = words.length ? 1 : 0
  let used = 0
  for (const word of words) {
    const size = Math.min(width, word.text.trim().length * 8 + 16)
    if (used && used + size > width) { rows++; used = 0 }
    used += size
  }
  return rows
}
