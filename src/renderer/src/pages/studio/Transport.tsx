import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, Repeat, Timer, Gauge, Music4, TrendingUp, BookmarkPlus, Trash2, SkipBack, ArrowUpDown, Loader2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { player } from '@/audio/player'
import { useProject } from '@/store/project'
import { useApp } from '@/store/app'
import { cx, Slider, Popover, MenuItem, Toggle, fmtTime } from '@/components/ui'
import { beatTicks, measureTicks } from '@/music/theory'
import { tempoMap } from '@/music/score'
import { uid } from '@/music/score'

export function toggleLoop(): void {
  const st = useProject.getState()
  const o = player.opts
  const r = st.range ?? (st.cursor ? { from: st.cursor.measure, to: st.cursor.measure } : null)
  if (o.loopOn && (!st.range || (o.loop && o.loop.from === st.range.from && o.loop.to === st.range.to))) { player.setOptions({ loopOn: false }); return }
  if (!r) return
  player.setOptions({ loop: r, loopOn: true })
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
  const saveLoop = () => {
    if (!o.loop) return
    const l = o.loop
    st.patchProject((pp) => { pp.practice.loops.push({ id: uid('l'), name: `Bars ${l.from + 1}–${l.to + 1}`, from: l.from, to: l.to }) })
  }
  const total = player.endTick

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
        <div ref={knobRef} className="absolute top-1/2 h-3.5 w-3.5 -mt-[7px] -ml-[7px] rounded-full bg-accent shadow-[0_0_10px_rgb(var(--accent)/.6)] scale-0 group-hover:scale-100 transition-transform" />
      </div>
      <div className="h-[58px] flex items-center px-4 gap-2">
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

        <div className="flex items-center gap-2 ml-2 w-[250px]">
          <Gauge size={15} className="text-muted shrink-0" />
          <Slider value={o.speed} min={0.25} max={2} step={0.05} onChange={setSpeed} title="Playback speed" />
          <button className="text-[12px] tabular-nums w-11 text-right hover:text-accent" title="Reset to 100%" onClick={() => setSpeed(1)}>{Math.round(o.speed * 100)}%</button>
        </div>

        <div className="w-px h-6 bg-line mx-2" />
        <button className={cx('icon-btn', o.loopOn && 'on')} title="Loop selection (L)" onClick={toggleLoop}><Repeat size={16} /></button>
        <Popover width={250} trigger={(t) => <button className="btn-ghost !h-8 !px-2 text-[12px]" onClick={t}>{o.loop ? `${o.loop.from + 1}–${o.loop.to + 1}` : 'Loops'}</button>}>
          {(close) => (
            <>
              <div className="px-2.5 py-1.5 text-[11.5px] text-faint">Select measures (Shift+click) then press L.</div>
              {project.practice.loops.map((l) => (
                <div key={l.id} className="flex items-center">
                  <MenuItem onClick={() => { player.setOptions({ loop: { from: l.from, to: l.to }, loopOn: true }); st.setRange({ from: l.from, to: l.to }); close() }}>{l.name}</MenuItem>
                  <button className="icon-btn !h-7 !w-7" onClick={() => st.patchProject((pp) => { pp.practice.loops = pp.practice.loops.filter((x) => x.id !== l.id) })}><Trash2 size={13} /></button>
                </div>
              ))}
              <MenuItem icon={<BookmarkPlus size={14} />} onClick={() => { saveLoop(); close() }}>{o.loop ? 'Save current loop' : 'No loop set'}</MenuItem>
            </>
          )}
        </Popover>
        <Popover width={260} trigger={(t) => <button className={cx('icon-btn', o.trainer.on && 'on')} title="Speed trainer" onClick={t}><TrendingUp size={16} /></button>}>
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
        <button className={cx('btn-ghost !px-2', o.metronome && '!text-accent !bg-accent/10')} aria-pressed={o.metronome} title="Toggle metronome (M)" onClick={() => player.setOptions({ metronome: !o.metronome })}><Music4 size={16} /> Metronome</button>
        <button className={cx('icon-btn', o.countIn > 0 && 'on')} aria-pressed={o.countIn > 0} title={o.countIn ? `Count-in: ${o.countIn} bar${o.countIn > 1 ? 's' : ''} (click to turn off)` : 'Count-in'} onClick={() => void useApp.getState().updateSettings({ countInOn: !o.countIn })}><Timer size={16} /></button>
        <button className={cx('btn-ghost !px-2 ml-1 tabular-nums', o.transpose !== 0 && '!text-accent !bg-accent/10')} aria-label="Transpose playback" title="Transpose playback (semitones)" onClick={onTranspose}>
          <ArrowUpDown size={16} /> {o.transpose > 0 ? `+${o.transpose}` : o.transpose}
        </button>
        {o.compare && <span className="chip !text-accent2 ml-1">Comparing: audio L / MIDI R</span>}
        {p.dropouts > 0 && <button className="chip !text-warn ml-1" title="The plug-ins could not keep up and the sound dropped out. Try a larger buffer size in Settings → Audio device. Click to dismiss." onClick={() => { player.dropouts = 0; player.setOptions({}) }}>Audio dropouts: {p.dropouts}</button>}
        <div className="flex-1" />
        <span className="text-[11px] text-faint tabular-nums">{Math.ceil(total / mt)} bars</span>
      </div>
    </div>
  )
}
