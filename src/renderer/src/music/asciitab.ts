import type { Part, Score } from '@shared/types'
import { PPQ } from '@shared/types'
import { midiName, isFretted } from './theory'
import { assignTab, tuningOf } from './tab'
import type { RangeOpts } from './midi'

/** Plain-text tablature, 4 measures per line. */
export function partToAsciiTab(score: Score, p: Part, o: RangeOpts = {}): string {
  if (!isFretted(p.kind)) return ''
  const tab = assignTab(p)
  const tuning = tuningOf(p)
  const from = o.from ?? 0
  const to = o.to ?? p.measures.length - 1
  const names = tuning.map((t) => midiName(t).replace(/\d+$/, '').padEnd(2, ' '))
  const out: string[] = [`${score.title} — ${p.name}`, `Tuning: ${tuning.map((t) => midiName(t)).join(' ')}${p.capo ? `  Capo ${p.capo}` : ''}  Tempo: ${score.tempo}`, '']
  const perLine = 4
  for (let start = from; start <= to; start += perLine) {
    const rows = names.map((n) => `${n}|`)
    for (let mi = start; mi < Math.min(start + perLine, to + 1); mi++) {
      for (const e of p.measures[mi].events) {
        const pos = tab.get(e.id)
        const cells = tuning.map(() => '')
        if (!e.rest && pos) {
          pos.forEach((x) => {
            if (!x) return
            let s = String(x.fret)
            if (e.tech?.includes('harmonic')) s = `<${s}>`
            if (e.tech?.includes('bend')) s += 'b'
            if (e.tech?.includes('hammer')) s += 'h'
            if (e.tech?.includes('slide')) s += '/'
            if (e.tech?.includes('vibrato')) s += '~'
            cells[x.string - 1] = s
          })
        }
        const w = Math.max(...cells.map((c) => c.length), 1) + Math.max(1, Math.round(e.dur / (PPQ / 2)))
        cells.forEach((c, i) => { rows[i] += c.padEnd(w, '-') })
      }
      rows.forEach((_, i) => { rows[i] += '|' })
    }
    out.push(`[${start + 1}]`, ...rows, '')
  }
  return out.join('\n')
}
