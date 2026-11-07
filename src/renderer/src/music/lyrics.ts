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

export const LYRIC_LINE = 24

let measureCtx: CanvasRenderingContext2D | null = null
/** Width of a word as drawn under the staff (14 px text plus button padding). */
export function lyricWidth(text: string): number {
  if (typeof document !== 'undefined') {
    measureCtx ??= document.createElement('canvas').getContext('2d')
    if (measureCtx) {
      measureCtx.font = `14px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`
      return Math.ceil(measureCtx.measureText(text.trim()).width) + 12
    }
  }
  return text.trim().length * 7.6 + 12
}

/**
 * Put each word under the beat it is sung on. A word that would run into the one before it is
 * nudged right a little; if that would move it too far from its beat it drops to the next line
 * instead, so every word stays close to its note.
 */
export function placeLyrics(items: { x: number; width: number }[], maxShift = 28, gap = 4): { x: number; line: number }[] {
  const right: number[] = []
  return items.map(({ x, width }) => {
    let best: { x: number; line: number } | null = null
    for (let line = 0; line <= right.length; line++) {
      const pos = Math.max(x, (right[line] ?? -Infinity) + gap)
      if (pos - x <= maxShift) { best = { x: pos, line }; break }
      if (!best || pos < best.x) best = { x: pos, line }
    }
    right[best!.line] = best!.x + width
    return best!
  })
}
