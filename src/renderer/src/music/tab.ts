import type { NoteEvent, Part } from '@shared/types'

export interface TabPos { string: number; fret: number }
export const MAX_FRET = 24

export function tuningOf(p: Part): number[] {
  return p.tuning ?? [64, 59, 55, 50, 45, 40]
}

export function pitchAt(p: Part, string: number, fret: number): number {
  return tuningOf(p)[string - 1] + (p.capo ?? 0) + fret
}

/** All playable (string, fret) positions for a pitch. Frets are relative to the capo. */
export function positionsFor(p: Part, pitch: number): TabPos[] {
  const t = tuningOf(p)
  const capo = p.capo ?? 0
  const out: TabPos[] = []
  t.forEach((open, i) => {
    const fret = pitch - open - capo
    if (fret >= 0 && fret <= MAX_FRET - capo) out.push({ string: i + 1, fret })
  })
  return out
}

function chordCost(pos: TabPos[], hand: number): number {
  const fretted = pos.filter((x) => x.fret > 0).map((x) => x.fret)
  const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0
  const center = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : hand
  const spanPenalty = span > 4 ? 40 * (span - 4) : span
  return spanPenalty + Math.abs(center - hand) * 1.2 + fretted.reduce((a, f) => a + f * 0.15, 0)
}

/**
 * Assign strings/frets to a chord: respect manual positions, then search the
 * remaining notes for distinct strings with the smallest stretch near `hand`.
 */
export function assignChord(p: Part, e: NoteEvent, hand: number): (TabPos | null)[] {
  const fixed: (TabPos | null)[] = e.notes.map((n) =>
    n.string && n.fret !== undefined && pitchAt(p, n.string, n.fret) === n.pitch ? { string: n.string, fret: n.fret } : null
  )
  const used = new Set(fixed.filter(Boolean).map((x) => x!.string))
  const free = e.notes.map((_, i) => i).filter((i) => !fixed[i])
  const options = free.map((i) => positionsFor(p, e.notes[i].pitch).filter((x) => !used.has(x.string)))
  let best: (TabPos | null)[] | null = null
  let bestCost = Infinity
  let visited = 0
  const cur: (TabPos | null)[] = [...fixed]
  const rec = (k: number, taken: Set<number>) => {
    if (visited++ > 5000) return
    if (k === free.length) {
      const all = cur.filter(Boolean) as TabPos[]
      const c = chordCost(all, hand) + cur.filter((x) => !x).length * 100
      if (c < bestCost) { bestCost = c; best = [...cur] }
      return
    }
    const i = free[k]
    let any = false
    for (const o of options[k]) {
      if (taken.has(o.string)) continue
      any = true
      cur[i] = o
      taken.add(o.string)
      rec(k + 1, taken)
      taken.delete(o.string)
      cur[i] = null
    }
    if (!any) { cur[i] = null; rec(k + 1, taken) } // unplayable note: leave unassigned
  }
  rec(0, new Set(used))
  return best ?? fixed
}

/** Compute tab positions for the whole part, keyed by event id. */
export function assignTab(p: Part): Map<string, (TabPos | null)[]> {
  const res = new Map<string, (TabPos | null)[]>()
  let hand = 2
  for (const m of p.measures) {
    for (const e of m.events) {
      if (e.rest || !e.notes.length) continue
      const pos = assignChord(p, e, hand)
      res.set(e.id, pos)
      const fr = pos.filter((x): x is TabPos => !!x && x.fret > 0).map((x) => x.fret)
      if (fr.length) hand = hand * 0.4 + (fr.reduce((a, b) => a + b, 0) / fr.length) * 0.6
    }
  }
  return res
}
