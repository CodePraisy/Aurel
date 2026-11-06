import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, Repeat, Timer, Gauge, Music4, TrendingUp, BookmarkPlus, Trash2, SkipBack, ArrowUpDown, Loader2, ChevronDown, AlertTriangle } from 'lucide-react'
import type { Listen, Project } from '@shared/types'
import { player } from '@/audio/player'
import { useProject } from '@/store/project'
import { useApp } from '@/store/app'
import { cx, Slider, Popover, Toggle, fmtTime, Modal } from '@/components/ui'
import { beatTicks, measureTicks } from '@/music/theory'
import { tempoMap } from '@/music/score'
import { uid } from '@/music/score'

export function toggleLoop(): void {
  const st = useProject.getState()
  const o = player.opts
  if (!st.project || player.endTick <= 0) return
  const mt = measureTicks(st.project.score.timeSig)
  const last = Math.max(0, Math.ceil(player.endTick / mt) - 1)
  const bar = Math.min(last, st.cursor?.measure ?? Math.floor(player.getTick() / mt))
  const r = st.range ?? { from: bar, to: bar }
  if (o.loopOn && (!st.range || (o.loop && o.loop.from === st.range.from && o.loop.to === st.range.to))) { player.setOptions({ loopOn: false }); return }
  player.setOptions({ loop: r, loopOn: true })
}

/** Hear the original recording or the transcription, for every part at once. */
function ListenSwitch({ solo }: { solo: boolean }) {
  const { listen } = player.opts
  const set = (next: Listen) => {
    player.setOptions({ listen: next, compare: null })
    useProject.getState().patchProject((p) => { p.practice.listen = next })
  }
  return (
    <div className="seg shrink-0" role="group" aria-label="Playback source">
      <button className={cx(listen === 'original' && 'on')} aria-pressed={listen === 'original'} title={solo ? 'Play the soloed instruments’ isolated recordings' : 'Play the original recording'} onClick={() => set('original')}>Audio</button>
      <button className={cx(listen === 'transcription' && 'on')} aria-pressed={listen === 'transcription'} title="Play the notes in the score" onClick={() => set('transcription')}>MIDI</button>
    </div>
  )
}

export function usePlayer() {
  const [, force] = useState(0)
  useEffect(() => player.subscribe(() => force((x) => x + 1)), [])
  return player
}

export default function Transport({ project, onEditRhythm, onTranspose }: { project: Project; onEditRhythm: (field: 'tempo' | 'meter') => void; onTranspose: () => void }) {
  const p = usePlayer()
  const o = p.opts
  const settings = useApp((s) => s.settings)
  const st = useProject()
  const posRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const dragFrac = useRef<number | null>(null)
  const mt = measureTicks(project.score.timeSig)
  const beat = beatTicks(project.score.timeSig)

  useEffect(() => {
    let raf = 0
    const tm = tempoMap(project.score, 1)
    const f = () => {
      const t = player.getTick()
      const m = Math.floor(t / mt)
      const b = Math.floor((t - m * mt) / beat)
      if (posRef.current) posRef.current.textContent = `${m + 1}.${b + 1}`
      if (timeRef.current) timeRef.current.textContent = fmtTime(tm.tickToSec(t))
      const frac = dragFrac.current ?? Math.min(1, t / Math.max(1, player.endTick))
      if (barRef.current) barRef.current.style.width = `${frac * 100}%`
      if (knobRef.current) knobRef.current.style.left = `${frac * 100}%`
      if (dragFrac.current !== null && posRef.current) { const dt = dragFrac.current * player.endTick; const m = Math.floor(dt / mt); posRef.current.textContent = `${m + 1}.${Math.floor((dt - m * mt) / beat) + 1}` }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [project.score, mt, beat])

  useEffect(() => { player.setOptions({ metronomeVolume: settings?.metronomeVolume ?? 0.6 }) }, [settings?.metronomeVolume])
  useEffect(() => { player.setOptions({ countIn: settings?.countInOn ? settings.countInBars : 0 }) }, [settings?.countInOn, settings?.countInBars])

  const setSpeed = (v: number) => {
    player.setOptions({ speed: v })
    st.patchProject((pp) => { pp.practice.speed = v })
  }
  const total = player.endTick
  const bars = project.score.parts[0]?.measures.length ?? Math.ceil(total / mt)

  return (
    <div className="shrink-0 border-t border-line bg-panel/70 backdrop-blur">
      <div className="group relative h-3 -mt-1.5 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          const el = e.currentTarget
          el.setPointerCapture(e.pointerId)
          const r = el.getBoundingClientRect()
          const at = (x: number) => Math.max(0, Math.min(1, (x - r.left) / r.width))
          dragFrac.current = at(e.clientX)
          const wasPlaying = player.state === 'playing'
          if (wasPlaying) player.pause()
          const move = (ev: PointerEvent) => { dragFrac.current = at(ev.clientX) }
          const up = (ev: PointerEvent) => {
            el.removeEventListener('pointermove', move)
            el.removeEventListener('pointerup', up)
            const f = at(ev.clientX)
            dragFrac.current = null
            if (wasPlaying) player.play(f * total)
            else player.seek(f * total)
          }
          el.addEventListener('pointermove', move)
          el.addEventListener('pointerup', up)
        }}>
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] group-hover:h-[5px] transition-all bg-fg/[0.08] rounded-full overflow-hidden">
          <div ref={barRef} className="h-full bg-accent rounded-full" />
        </div>
        {o.loop && bars > 0 && <div className={cx('absolute top-1/2 -translate-y-1/2 h-[7px] rounded-full pointer-events-none transition-opacity', o.loopOn ? 'bg-accent2/35 ring-1 ring-accent2/70' : 'bg-fg/10')}
          style={{ left: `${(o.loop.from / bars) * 100}%`, width: `${((o.loop.to - o.loop.from + 1) / bars) * 100}%` }} />}
        <div ref={knobRef} className="absolute top-1/2 h-3.5 w-3.5 -mt-[7px] -ml-[7px] rounded-full bg-accent shadow-[0_0_10px_rgb(var(--accent)/.6)] scale-0 group-hover:scale-100 transition-transform" />
      </div>
      <div className="min-h-[58px] flex flex-wrap items-center px-4 py-1 gap-2">
        {project.audio && project.score.parts.length > 0 && <ListenSwitch solo={project.score.parts.some((part) => part.solo)} />}
        <button className="icon-btn" title="Back to start (Home)" onClick={() => player.stop()}><SkipBack size={17} /></button>
        <button className={cx('h-10 w-10 rounded-full flex items-center justify-center bg-accent text-bg hover:brightness-110 transition', p.state === 'playing' && 'pulse')} title={p.preparingFx ? 'Cancel' : 'Play / pause (Space)'} onClick={() => player.toggle()}>
          {p.preparingFx ? <Loader2 size={18} className="animate-spin" /> : p.state === 'playing' ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
        </button>
        <button className="icon-btn" title="Stop" onClick={() => player.stop()}><Square size={15} /></button>
        <div className="ml-2 w-[112px] leading-tight">
          <div className="font-mono text-[17px] tabular-nums"><span ref={posRef}>1.1</span></div>
          <div className="text-[11px] text-faint tabular-nums">{p.preparingFx ? <span className="text-accent">Loading plug-ins…</span> : <span ref={timeRef}>0:00</span>}{p.countingIn && <span className="text-accent ml-1.5">count-in</span>}</div>
        </div>
        <div className="flex flex-col items-start text-[12px] text-muted leading-tight w-[86px]">
          <button className="rounded px-1 hover:bg-fg/[0.08] hover:text-accent" title="Edit score tempo" onClick={() => onEditRhythm('tempo')} onContextMenu={(e) => { e.preventDefault(); onEditRhythm('tempo') }}><span className="text-fg font-medium tabular-nums">{Math.round(project.score.tempo * o.speed * 10) / 10}</span> BPM</button>
          <button className="rounded px-1 hover:bg-fg/[0.08] hover:text-accent" title="Edit time signature" onClick={() => onEditRhythm('meter')} onContextMenu={(e) => { e.preventDefault(); onEditRhythm('meter') }}>{project.score.timeSig.num}/{project.score.timeSig.den}</button>
        </div>

        <div className="flex items-center gap-2 ml-2 flex-1 min-w-28 max-w-[230px]">
          <Gauge size={15} className="text-muted shrink-0" />
          <Slider value={o.speed} min={0.25} max={2} step={0.05} onChange={setSpeed} title="Playback speed" />
          <button className="text-[12px] tabular-nums w-11 text-right hover:text-accent" title="Reset to 100%" onClick={() => setSpeed(1)}>{Math.round(o.speed * 100)}%</button>
        </div>

        <div className="w-px h-6 bg-line mx-2" />
        <LoopControl project={project} bars={bars} />
        <Popover width={260} side="top" align="right" trigger={(t) => <button className={cx('icon-btn', o.trainer.on && 'on')} title="Speed trainer" onClick={t}><TrendingUp size={16} /></button>}>
          {() => (
            <div className="p-2.5 space-y-3">
              <Toggle on={o.trainer.on} onChange={(v) => player.setOptions({ trainer: { ...o.trainer, on: v }, loopOn: v ? true : o.loopOn, loop: o.loop ?? (st.cursor ? { from: st.cursor.measure, to: st.cursor.measure } : null) })} label="Gradual tempo training" />
              <p className="text-[11.5px] text-faint">Each pass through the loop gets a little faster until the target speed.</p>
              {(['from', 'to', 'step'] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-12 text-[12px] text-muted capitalize">{k === 'step' ? 'Step' : k === 'from' ? 'Start' : 'Target'}</span>
                  <Slider value={o.trainer[k]} min={k === 'step' ? 0.01 : 0.25} max={k === 'step' ? 0.2 : 2} step={0.01} onChange={(v) => player.setOptions({ trainer: { ...o.trainer, [k]: v } })} />
                  <span className="w-10 text-right text-[12px] tabular-nums">{Math.round(o.trainer[k] * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </Popover>
        <button className={cx('icon-btn', o.metronome && 'on')} aria-label="Metronome" aria-pressed={o.metronome} title="Toggle metronome (M)" onClick={() => player.setOptions({ metronome: !o.metronome })}><Music4 size={16} /></button>
        <button className={cx('icon-btn', o.countIn > 0 && 'on')} aria-pressed={o.countIn > 0} title={o.countIn ? `Count-in: ${o.countIn} bar${o.countIn > 1 ? 's' : ''} (click to turn off)` : 'Count-in'} onClick={() => void useApp.getState().updateSettings({ countInOn: !o.countIn })}><Timer size={16} /></button>
        <button className={cx('icon-btn tabular-nums', o.transpose !== 0 && 'on')} aria-label="Transpose playback" title="Transpose playback (semitones)" onClick={onTranspose}>
          <ArrowUpDown size={16} />
        </button>
        {o.compare && <span className="chip !text-accent2 ml-1">Comparing: audio L / MIDI R</span>}
        {p.dropouts > 0 && <button className="chip !text-warn ml-1" title="The plug-ins could not keep up and the sound dropped out. Try a larger buffer size in Settings → Audio device. Click to dismiss." onClick={() => { player.dropouts = 0; player.setOptions({}) }}>Audio dropouts: {p.dropouts}</button>}
        <div className="flex-1" />
        <BarCount project={project} />
      </div>
    </div>
  )
}

/** Loop on/off, with quick choices (whole piece, the selected bars, this bar), typed bar numbers and saved sections. */
function LoopControl({ project, bars }: { project: Project; bars: number }) {
  const o = player.opts
  const st = useProject()
  const loop = o.loop
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [name, setName] = useState('')
  useEffect(() => { setFrom(loop ? String(loop.from + 1) : ''); setTo(loop ? String(loop.to + 1) : '') }, [loop?.from, loop?.to])
  const last = Math.max(0, bars - 1)
  const setLoop = (a: number, b: number) => {
    const lo = Math.max(0, Math.min(a, b, last)), hi = Math.min(last, Math.max(a, b))
    player.setOptions({ loop: { from: lo, to: hi }, loopOn: true })
    st.setRange({ from: lo, to: hi })
  }
  const bar = st.cursor?.measure ?? 0
  const whole = !!loop && loop.from === 0 && loop.to === last
  const label = !loop ? 'Loop' : whole ? 'Whole piece' : loop.from === loop.to ? `Bar ${loop.from + 1}` : `Bars ${loop.from + 1}–${loop.to + 1}`
  const saved = project.practice.loops
  const save = () => {
    if (!loop) return
    const n = name.trim() || `Bars ${loop.from + 1}–${loop.to + 1}`
    st.patchProject((pp) => { pp.practice.loops.push({ id: uid('l'), name: n, from: loop.from, to: loop.to }) })
    setName('')
  }
  const applyTyped = () => {
    const a = parseInt(from, 10), b = parseInt(to, 10)
    if (Number.isFinite(a) && Number.isFinite(b)) setLoop(a - 1, b - 1)
  }
  return (
    <div className="flex items-center">
      <button className={cx('icon-btn !rounded-r-none', o.loopOn && 'on')} aria-label="Loop" aria-pressed={o.loopOn} title={o.loopOn ? `Looping ${label} (L to stop)` : 'Loop (L)'}
        onClick={() => { if (o.loopOn) player.setOptions({ loopOn: false }); else if (loop && !st.range) player.setOptions({ loopOn: true }); else toggleLoop() }}><Repeat size={16} /></button>
      <Popover width={290} side="top" trigger={(t, open) => (
        <button className={cx('h-8 pl-1 pr-1.5 rounded-r-lg text-[12px] flex items-center gap-1 max-w-[130px] transition-colors', o.loopOn ? 'text-accent bg-accent/10' : 'text-muted hover:text-fg hover:bg-fg/[0.07]', open && 'bg-fg/[0.07]')}
          aria-label="Choose what to loop" aria-expanded={open} onClick={t}><span className="truncate">{label}</span><ChevronDown size={12} className="shrink-0" /></button>
      )}>
        {(close) => (
          <div className="p-1.5 space-y-2.5">
            <div className="flex items-center justify-between"><span className="label">Loop</span><Toggle ariaLabel="Loop on" on={o.loopOn} onChange={(v) => { if (v && !loop) setLoop(0, last); else player.setOptions({ loopOn: v }) }} /></div>
            <div className="grid grid-cols-3 gap-1.5">
              <button className={cx('btn-soft !h-8 !px-1 !text-[12px]', whole && o.loopOn && '!bg-accent/15 !text-accent')} onClick={() => setLoop(0, last)}>Whole piece</button>
              <button className="btn-soft !h-8 !px-1 !text-[12px]" disabled={!st.range} title={st.range ? '' : 'Shift+click bars in the score to select them'} onClick={() => st.range && setLoop(st.range.from, st.range.to)}>Selection</button>
              <button className="btn-soft !h-8 !px-1 !text-[12px]" onClick={() => setLoop(bar, bar)}>Bar {bar + 1}</button>
            </div>
            <form className="flex items-center gap-1.5 text-[12.5px]" onSubmit={(e) => { e.preventDefault(); applyTyped() }}>
              <span className="text-muted">Bars</span>
              <input className="field !h-8 !w-14 text-center tabular-nums" aria-label="Loop from bar" inputMode="numeric" value={from} placeholder="1" onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} />
              <span className="text-muted">to</span>
              <input className="field !h-8 !w-14 text-center tabular-nums" aria-label="Loop to bar" inputMode="numeric" value={to} placeholder={String(bars)} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} />
              <button className="btn-soft !h-8 !px-2.5 ml-auto" title={`Loop these bars (piece has ${bars})`}>Set</button>
            </form>
            <div>
              <div className="label mb-1">Sections</div>
              {!saved.length && <p className="text-[11.5px] text-faint mb-1.5">Save loops you practise often, like “Chorus” or “Solo”.</p>}
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {saved.map((l) => {
                  const on = o.loopOn && loop?.from === l.from && loop?.to === l.to
                  return (
                    <div key={l.id} className={cx('group flex items-center rounded-md', on && 'bg-accent/10')}>
                      <button className={cx('flex-1 min-w-0 text-left px-2 h-8 text-[13px] truncate rounded-md hover:bg-fg/[0.06]', on && 'text-accent')} onClick={() => { setLoop(l.from, l.to); close() }}>
                        {l.name} <span className="text-faint text-[11px]">· {l.from === l.to ? `bar ${l.from + 1}` : `${l.from + 1}–${l.to + 1}`}</span>
                      </button>
                      <button className="icon-btn !h-7 !w-7 opacity-0 group-hover:opacity-100" aria-label={`Delete ${l.name}`} onClick={() => st.patchProject((pp) => { pp.practice.loops = pp.practice.loops.filter((x) => x.id !== l.id) })}><Trash2 size={13} /></button>
                    </div>
                  )
                })}
              </div>
              <form className="flex gap-1.5 mt-1.5" onSubmit={(e) => { e.preventDefault(); save() }}>
                <input className="field !h-8 !text-[12.5px]" placeholder={loop ? 'Name this section…' : 'Set a loop first'} disabled={!loop} value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn-soft !h-8 shrink-0" disabled={!loop} title="Save section"><BookmarkPlus size={14} /></button>
              </form>
            </div>
          </div>
        )}
      </Popover>
    </div>
  )
}

/** The piece's length in bars; type a number to change it. Removing bars that hold notes asks first. */
function BarCount({ project }: { project: Project }) {
  const st = useProject()
  const bars = project.score.parts[0]?.measures.length ?? 0
  const [value, setValue] = useState(String(bars))
  const [confirm, setConfirm] = useState<{ to: number; filled: number } | null>(null)
  useEffect(() => setValue(String(bars)), [bars])
  const apply = () => {
    const n = parseInt(value, 10)
    if (!Number.isFinite(n) || n < 1 || n === bars) { setValue(String(bars)); return }
    if (n < bars) {
      const filled = new Set<number>()
      for (const part of project.score.parts) part.measures.forEach((m, i) => { if (i >= n && m.events.some((e) => !e.rest)) filled.add(i) })
      if (filled.size) { setConfirm({ to: n, filled: filled.size }); return }
    }
    st.setBarCount(Math.min(2000, n))
  }
  return (
    <label className="flex items-center gap-1 text-[11px] text-faint tabular-nums" title="Number of bars. Type a new number to add or remove bars at the end.">
      <input className="w-11 h-6 rounded-md bg-transparent border border-transparent hover:border-line focus:border-accent/60 focus:bg-fg/[0.05] text-right px-1 text-[12px] text-muted outline-none transition-colors"
        aria-label="Number of bars" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onFocus={(e) => e.currentTarget.select()} onBlur={apply}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setValue(String(bars)); e.currentTarget.blur() } }} />
      bars
      {confirm && <Modal open title="Remove bars?" width={400} onClose={() => { setConfirm(null); setValue(String(bars)) }} footer={<>
        <button className="btn-ghost" onClick={() => { setConfirm(null); setValue(String(bars)) }}>Keep {bars} bars</button>
        <button className="btn bg-bad text-white hover:brightness-110" onClick={() => { st.setBarCount(confirm.to); setConfirm(null) }}>Remove {bars - confirm.to} bar{bars - confirm.to === 1 ? '' : 's'}</button>
      </>}>
        <div className="flex gap-3 text-[13px] leading-relaxed">
          <AlertTriangle size={20} className="text-warn shrink-0 mt-0.5" />
          <p>Going from {bars} to {confirm.to} bars deletes bars {confirm.to + 1}–{bars}. {confirm.filled === 1 ? 'One of them has' : `${confirm.filled} of them have`} notes in them, which will be deleted too. You can undo this with Ctrl+Z.</p>
        </div>
      </Modal>}
    </label>
  )
}
