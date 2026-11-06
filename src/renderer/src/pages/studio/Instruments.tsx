import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, PenLine, Volume2 } from 'lucide-react'
import type { Part, Project } from '@shared/types'
import { PPQ } from '@shared/types'
import { player, type LiveNote } from '@/audio/player'
import { midi } from '@/audio/midi'
import { useProject } from '@/store/project'
import { assignTab, tuningOf, positionsFor, type TabPos } from '@/music/tab'
import { DRUM_PIECES, drumPiece, isFretted, measureTicks, midiName } from '@/music/theory'
import { cx } from '@/components/ui'
import { CHORD_SHORTCUT } from './shortcuts'

/** Notes sounding now (while playing) or the selected chord (while editing). */
function useActive(part: Part | undefined): { pitches: number[]; eventIds: string[] } {
  const [act, setAct] = useState<{ pitches: number[]; eventIds: string[] }>({ pitches: [], eventIds: [] })
  const st = useProject()
  useEffect(() => {
    if (!part) return
    const notes = player.notesFor(part.id)
    let raf = 0
    let last = ''
    const f = () => {
      let pitches: number[] = []
      let ids: string[] = []
      if (player.state === 'playing') {
        const t = player.getTick()
        const on = notes.filter((n) => n.tick <= t && n.tick + n.dur > t)
        pitches = on.map((n) => n.pitch)
        ids = on.map((n) => n.eventId)
      } else if (st.sel) {
        for (const m of part.measures) { const e = m.events.find((x) => x.id === st.sel); if (e) { pitches = e.notes.map((n) => n.pitch); ids = [e.id]; break } }
      }
      const key = pitches.join(',') + '|' + ids.join(',')
      if (key !== last) { last = key; setAct({ pitches, eventIds: ids }) }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [part, st.sel])
  return act
}

export function Fretboard({ part }: { part: Part }) {
  const st = useProject()
  const fretDrag = useRef(false)
  useEffect(() => { const up = () => { fretDrag.current = false }; window.addEventListener('pointerup', up); return () => window.removeEventListener('pointerup', up) }, [])
  const active = useActive(part)
  const tab = useMemo(() => assignTab(part), [part])
  const tuning = tuningOf(part)
  const frets = 22
  const W = 1000, rowH = 17
  const H = tuning.length * rowH + 16
  const fx = (f: number) => (f === 0 ? 18 : 38 + (f - 0.5) * ((W - 50) / frets))
  const dots = new Map<string, TabPos>()
  for (const id of active.eventIds) for (const p of tab.get(id) ?? []) if (p) dots.set(`${p.string}:${p.fret}`, p)
  if (!active.eventIds.length) for (const pitch of active.pitches) { const pos = positionsFor(part, pitch)[0]; if (pos) dots.set(`${pos.string}:${pos.fret}`, pos) }
  const capo = part.capo ?? 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <rect x={28} y={6} width={W - 40} height={H - 12} rx={6} fill="rgb(var(--raised))" />
      {[3, 5, 7, 9, 15, 17, 19, 21].map((f) => <circle key={f} cx={fx(f)} cy={H / 2} r={4} fill="rgb(var(--fg) / 0.12)" />)}
      <circle cx={fx(12)} cy={H / 2 - rowH} r={4} fill="rgb(var(--fg) / 0.12)" /><circle cx={fx(12)} cy={H / 2 + rowH} r={4} fill="rgb(var(--fg) / 0.12)" />
      {Array.from({ length: frets + 1 }).map((_, f) => <line key={f} x1={38 + f * ((W - 50) / frets)} x2={38 + f * ((W - 50) / frets)} y1={8} y2={H - 8} stroke="rgb(var(--fg) / 0.25)" strokeWidth={f === 0 ? 4 : 1.2} />)}
      {capo > 0 && <rect x={fx(capo) - 4} y={6} width={8} height={H - 12} rx={3} fill="rgb(var(--accent) / 0.5)" />}
      {tuning.map((t, i) => {
        const y = 8 + rowH / 2 + i * rowH
        return (
          <g key={i}>
            <text x={10} y={y + 4} fontSize={10} fill="rgb(var(--muted))" textAnchor="middle">{midiName(t).replace(/\d+$/, '')}</text>
            <line x1={30} x2={W - 12} y1={y} y2={y} stroke="rgb(var(--fg) / 0.5)" strokeWidth={0.8 + i * 0.35} />
            {Array.from({ length: frets + 1 }).map((_, f) => (
              <rect key={f} x={f === 0 ? 2 : fx(f) - (W - 50) / frets / 2} y={y - rowH / 2} width={f === 0 ? 34 : (W - 50) / frets} height={rowH} fill="transparent" className="cursor-pointer hover:fill-[rgb(var(--accent)/0.12)]"
                onPointerDown={(e) => {
                  const rel = f === 0 ? 0 : f - capo
                  if (rel < 0) return
                  fretDrag.current = true
                  if (st.cursor?.partId === part.id) st.inputNote(t + capo + rel, { pos: { string: i + 1, fret: rel }, chord: e.shiftKey })
                  else player.preview(part, t + capo + rel)
                }}
                onPointerEnter={() => { const rel = f === 0 ? 0 : f - capo; if (fretDrag.current && rel >= 0) player.preview(part, t + capo + rel, 85, 0.5) }} />
            ))}
          </g>
        )
      })}
      {[...dots.values()].map((p) => {
        const y = 8 + rowH / 2 + (p.string - 1) * rowH
        const x = p.fret === 0 && !capo ? 18 : fx(p.fret + capo)
        return (
          <g key={`${p.string}:${p.fret}`} className="pointer-events-none">
            <circle cx={x} cy={y} r={7.5} fill="rgb(var(--accent))" />
            <text x={x} y={y + 3.5} fontSize={9.5} fontWeight={700} textAnchor="middle" fill="rgb(var(--bg))">{p.fret}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Keyboard({ part }: { part: Part | undefined }) {
  const st = useProject()
  const active = useActive(part)
  const lo = 36, hi = 96
  const whites: number[] = []
  for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m)
  const ww = 1000 / whites.length
  const [held, setHeld] = useState<number | null>(null)
  const dragging = useRef(false)
  const live = useRef<LiveNote | null>(null)
  useEffect(() => {
    const up = () => { dragging.current = false; setHeld(null); live.current?.stop(); live.current = null }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])
  const [, setMidiTick] = useState(0)
  useEffect(() => midi.subscribe(() => setMidiTick((x) => x + 1)), [])
  const on = new Set([...active.pitches, ...midi.held])
  if (held !== null) on.add(held)
  const down = (m: number, e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = true
    setHeld(m)
    const vel = Math.round(60 + 60 * Math.min(1, (e.nativeEvent.offsetY || 50) / 100))
    if (part?.kind === 'drums') player.preview(part, m, vel)
    else if (st.inputMode === 'play' || !st.cursor) { live.current?.stop(); live.current = player.noteOn(part ?? null, m, vel) } // sounds while held
    else st.inputNote(m, { chord: e.shiftKey, velocity: vel })
  }
  // dragging across keys glides: sounds only, so a slide never writes a run of notes
  const enter = (m: number) => { if (!dragging.current) return; setHeld(m); player.preview(part ?? null, m, 90, 0.45) }
  const key = (m: number, props: React.SVGProps<SVGRectElement>) => <rect {...props} className="cursor-pointer" onPointerDown={(e) => down(m, e)} onPointerEnter={() => enter(m)} />
  return (
    <svg viewBox="0 0 1000 110" className="w-full h-full touch-none select-none" preserveAspectRatio="none">
      {whites.map((m, i) => (
        <g key={m}>
          {key(m, { x: i * ww + 0.5, y: 0, width: ww - 1, height: 108, rx: 3, fill: on.has(m) ? 'rgb(var(--accent))' : '#f6f3ec', stroke: '#b9b3a8' })}
          {m % 12 === 0 && <text x={i * ww + ww / 2} y={100} fontSize={9} textAnchor="middle" fill="#8a8478" className="pointer-events-none">C{m / 12 - 1}</text>}
        </g>
      ))}
      {whites.map((m, i) => (![4, 11].includes(m % 12) && m < hi ? (
        <g key={`b${m}`}>{key(m + 1, { x: (i + 1) * ww - ww * 0.3, y: 0, width: ww * 0.6, height: 66, rx: 2, fill: on.has(m + 1) ? 'rgb(var(--accent))' : '#1b1a1f' })}</g>
      ) : null))}
    </svg>
  )
}

export function DrumGrid({ part, project }: { part: Part; project: Project }) {
  const st = useProject()
  const mt = measureTicks(project.score.timeSig)
  const step = PPQ / 4
  const steps = Math.round(mt / step)
  const mi = Math.min(st.cursor?.measure ?? 0, part.measures.length - 1)
  const m = part.measures[mi]
  const ref = useRef<HTMLDivElement>(null)
  const [playStep, setPlayStep] = useState(-1)
  useEffect(() => {
    let raf = 0
    const f = () => {
      const t = player.getTick()
      setPlayStep(player.state === 'playing' && Math.floor(t / mt) === mi ? Math.floor((t % mt) / step) : -1)
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [mi, mt, step])
  const has = (s: number, midi: number) => m.events.some((e) => !e.rest && Math.round(e.start / step) === s && e.notes.some((n) => drumPiece(n.pitch).midi === midi))
  const beat = project.score.timeSig.den === 8 ? 2 : 4
  const go = (d: number) => {
    const n = Math.max(0, mi + d)
    if (n >= part.measures.length) st.addMeasures(part.measures.length)
    st.select(part.id, n, null, 0)
  }
  return (
    <div ref={ref} className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-1.5">
        <button className="icon-btn !h-6 !w-6" onClick={() => go(-1)}><ChevronLeft size={14} /></button>
        <span className="text-[12px] text-muted w-20 text-center">Bar {mi + 1}</span>
        <button className="icon-btn !h-6 !w-6" onClick={() => go(1)}><ChevronRight size={14} /></button>
        <span className="text-[11px] text-faint">16th-note steps · click to toggle hits</span>
      </div>
      <div className="flex-1 overflow-auto">
        {DRUM_PIECES.map((d) => (
          <div key={d.id} className="flex items-center gap-1 h-[17px]">
            <span className="w-24 text-[11px] text-muted truncate">{d.label}</span>
            {Array.from({ length: steps }).map((_, s) => (
              <button key={s} onClick={() => st.drumToggle(mi, s, d.midi, steps)}
                className={cx('flex-1 h-[13px] rounded-[3px] transition-colors', has(s, d.midi) ? 'bg-accent' : s % beat === 0 ? 'bg-fg/[0.12] hover:bg-fg/25' : 'bg-fg/[0.06] hover:bg-fg/20', playStep === s && 'ring-1 ring-accent2')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function InstrumentPanel({ project }: { project: Project }) {
  const st = useProject()
  const part = project.score.parts.find((p) => p.id === st.cursor?.partId)
  const fretted = !!part && isFretted(part.kind)
  const drums = part?.kind === 'drums'
  const [tab, setTab] = useState<'fret' | 'keys' | 'drums'>('fret')
  const effective = drums ? 'drums' : fretted && tab !== 'keys' ? 'fret' : 'keys'
  return (
    <div className="h-full flex flex-col px-4 pt-2 pb-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="seg">
          {fretted && <button className={cx(effective === 'fret' && 'on')} onClick={() => setTab('fret')}>Fretboard</button>}
          {!drums && <button className={cx(effective === 'keys' && 'on')} onClick={() => setTab('keys')}>Keyboard</button>}
          {drums && <button className="on">Step grid</button>}
        </div>
        <span className="text-[11.5px] text-faint truncate">{part ? part.name : 'Select a part'}</span>
        <div className="flex-1" />
        {!drums && (
          <>
            <div className="seg" title="Write: keys you press are added to the score. Play: just hear them.">
              <button className={cx(st.inputMode === 'write' && 'on')} onClick={() => st.setInputMode('write')}><PenLine size={13} className="inline -mt-0.5 mr-1" />Write</button>
              <button className={cx(st.inputMode === 'play' && 'on')} onClick={() => st.setInputMode('play')}><Volume2 size={13} className="inline -mt-0.5 mr-1" />Play only</button>
            </div>
            <button className={cx('btn-soft !h-8', st.chordMode && '!bg-accent/15 !text-accent')} aria-pressed={st.chordMode} aria-keyshortcuts={CHORD_SHORTCUT} title="Stack notes on the same beat. Press → to move on." onClick={st.toggleChordMode}>Chord mode <kbd className="kbd" aria-hidden="true">{CHORD_SHORTCUT}</kbd></button>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {part && effective === 'fret' && <Fretboard part={part} />}
        {effective === 'keys' && <Keyboard part={part} />}
        {part && effective === 'drums' && <DrumGrid part={part} project={project} />}
      </div>
    </div>
  )
}
