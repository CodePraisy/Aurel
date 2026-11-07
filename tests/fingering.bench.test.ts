// Tab fingering against real tabs (AlpacaGuitarSet open subset): FINGERING=<fingering.json> npx vitest run tests/fingering.bench.test.ts
import { it } from 'vitest'
import fs from 'fs'
import { PPQ, type Part } from '@shared/types'
import { assignTab } from '@/music/tab'
import { defaultPart } from '@/music/score'

it.runIf(!!process.env.FINGERING)('tab fingering vs real tabs', () => {
  const data = JSON.parse(fs.readFileSync(process.env.FINGERING!, 'utf8')) as Record<string, { beat: number; dur: number; notes: { pitch: number; string: number; fret: number }[] }[]>
  let right = 0, total = 0, rightChords = 0, chords = 0
  for (const [name, evs] of Object.entries(data)) {
    if (!evs.length) continue
    const part: Part = defaultPart('clean-guitar', 0, 4 * PPQ, name)
    part.measures = [{ events: evs.map((e, i) => ({ id: `e${i}`, start: Math.round(e.beat * PPQ), dur: Math.max(1, Math.round(e.dur * PPQ)), velocity: 80, notes: e.notes.map((n) => ({ pitch: n.pitch })) })) }]
    const tab = assignTab(part)
    let r = 0, rc = 0
    evs.forEach((e, i) => {
      const got = tab.get(`e${i}`) ?? []
      let all = true
      e.notes.forEach((n, k) => { const g = got[k]; if (g && g.string === n.string && g.fret === n.fret) r++; else all = false })
      if (all) rc++
      total += e.notes.length
    })
    right += r; rightChords += rc; chords += evs.length
    console.log(`${name.padEnd(32)} notes ${(r / evs.reduce((t, e) => t + e.notes.length, 0)).toFixed(3)}  events ${(rc / evs.length).toFixed(3)}`)
  }
  console.log(`ALL notes on the same string and fret as the real tab: ${(right / total).toFixed(3)} (${total} notes); whole events: ${(rightChords / chords).toFixed(3)}`)
})
