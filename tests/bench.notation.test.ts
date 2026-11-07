// Notation benchmark: how many notes end up on the right beat with the right pitch.
// Runs only when BENCH_RUNS points at engine outputs (analysis.json per song) and BENCH_SONGS at
// the generated songs with truth.json. Not part of the normal test run.
import { describe, it } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import { PPQ, type EngineAnalysis } from '@shared/types'
import { analysisToScore, DEFAULT_TRANSCRIBE } from '@/music/quantize'
import { measureTicks } from '@/music/theory'

const RUNS = process.env.BENCH_RUNS
const SONGS = process.env.BENCH_SONGS
const DRUM = (p: number) => ({ 35: 'k', 36: 'k', 38: 's', 40: 's', 42: 'h', 44: 'h', 46: 'h' } as Record<number, string>)[p] ?? (p >= 41 && p <= 50 && ![42, 44, 46, 49].includes(p) ? 't' : 'c')

describe.runIf(!!RUNS && !!SONGS)('notation benchmark', () => {
  it('scores notes on the right beat', () => {
    const totals: Record<string, { tp: number; fp: number; fn: number; tpR: number; fpR: number; fnR: number }> = {}
    const add = (k: string, v: { tp: number; fp: number; fn: number; tpR: number; fpR: number; fnR: number }) => {
      const t = totals[k] ??= { tp: 0, fp: 0, fn: 0, tpR: 0, fpR: 0, fnR: 0 }
      for (const key of Object.keys(v) as (keyof typeof v)[]) t[key] += v[key]
    }
    let meterOk = 0, tempoOk = 0, n = 0
    for (const song of fs.readdirSync(RUNS!).filter((d) => fs.existsSync(join(RUNS!, d, 'analysis.json'))).sort()) {
      const a = JSON.parse(fs.readFileSync(join(RUNS!, song, 'analysis.json'), 'utf8')) as EngineAnalysis
      const truth = JSON.parse(fs.readFileSync(join(SONGS!, song, 'truth.json'), 'utf8'))
      const ts = a.timeSig ?? { num: 4, den: 4 }
      const { score } = analysisToScore(a, song, '', ts, undefined, true, { ...DEFAULT_TRANSCRIBE, vocalMelody: true })
      n++
      if (score.timeSig.num === truth.meter && score.timeSig.den === 4) meterOk++
      const ibis = truth.beats.slice(1).map((x: number, i: number) => x - truth.beats[i]).sort((x: number, y: number) => x - y)
      const trueBpm = 60 / ibis[Math.floor(ibis.length / 2)]
      if (Math.abs(score.tempo - trueBpm) / trueBpm < 0.04) tempoOk++
      const mt = measureTicks(score.timeSig)
      // tied continuations are not new notes
      const starts = (pred: (k: string) => boolean, drums: boolean) => {
        const seen = new Set<string>()
        const out: { tick: number; p: string }[] = []
        for (const p of score.parts.filter((x) => pred(x.kind))) {
          let tiedIn = new Set<number>()
          p.measures.forEach((m, mi) => m.events.forEach((e) => {
            if (e.rest) { tiedIn = new Set(); return }
            for (const h of e.notes) {
              if (!tiedIn.has(h.pitch)) {
                const key = `${mi * mt + e.start}:${h.pitch}`
                if (!seen.has(key)) { seen.add(key); out.push({ tick: mi * mt + e.start, p: drums ? DRUM(h.pitch) : String(h.pitch) }) }
              }
            }
            tiedIn = e.tie ? new Set(e.notes.map((h) => h.pitch)) : new Set()
          }))
        }
        return out
      }
      const groups: [string, (k: string) => boolean, boolean][] = [
        ['guitar', (k) => k.includes('guitar'), false], ['bass', (k) => k === 'bass', false],
        ['piano', (k) => k === 'piano' || k === 'organ' || k === 'epiano', false], ['drums', (k) => k === 'drums', true], ['vocals', (k) => k === 'singer', false]
      ]
      for (const [name, pred, drums] of groups) {
        const ref = (truth.notes[name] ?? []).map((x: { beat: number; p: number }) => ({ tick: Math.round(x.beat * PPQ), p: drums ? DRUM(x.p) : String(x.p) }))
        if (!ref.length) continue
        const est = starts(pred, drums)
        // the score may start a bar earlier (pickup room): try whole-bar shifts
        let best = { tp: -1, fp: 0, fn: 0, tpR: 0, fpR: 0, fnR: 0 }
        for (const shift of process.env.BENCH_ANY_SHIFT ? Array.from({ length: 33 }, (_, i) => (i - 16) / (mt / PPQ)) : [-2, -1, 0, 1, 2]) {
          const keys = new Set(ref.map((r: { tick: number; p: string }) => `${Math.round(r.tick + shift * mt)}:${r.p}`))
          const ticks = new Set(ref.map((r: { tick: number }) => Math.round(r.tick + shift * mt)))
          const estKeys = new Set(est.map((e) => `${e.tick}:${e.p}`))
          const estTicks = new Set(est.map((e) => e.tick))
          const tp = [...estKeys].filter((k) => keys.has(k)).length
          const tpR = [...estTicks].filter((t) => ticks.has(t)).length
          if (tp > best.tp) best = { tp, fp: estKeys.size - tp, fn: keys.size - tp, tpR, fpR: estTicks.size - tpR, fnR: ticks.size - tpR }
        }
        add(name, best)
      }
    }
    const f = (tp: number, fp: number, fn: number) => (2 * tp) / Math.max(1, 2 * tp + fp + fn)
    const rows = Object.entries(totals).map(([k, t]) => `${k.padEnd(7)} notes F1 ${f(t.tp, t.fp, t.fn).toFixed(3)}  rhythm F1 ${f(t.tpR, t.fpR, t.fnR).toFixed(3)}  (P ${(t.tp / Math.max(1, t.tp + t.fp)).toFixed(2)} R ${(t.tp / Math.max(1, t.tp + t.fn)).toFixed(2)})`)
    console.log(`\n${process.env.BENCH_TAG ?? ''} songs ${n}  meter ok ${meterOk}/${n}  tempo ok ${tempoOk}/${n}\n${rows.join('\n')}`)
  })
})
