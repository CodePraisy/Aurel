import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Part, Project, ViewMode } from '@shared/types'
import { renderScore, playbackWaypoints, playbackX, xForTick, systemForMeasure, type ScoreLayout, type Colors } from '@/notation/render'
import { measureTicks, isFretted } from '@/music/theory'
import { useProject } from '@/store/project'
import { useApp } from '@/store/app'
import { player } from '@/audio/player'
import { cx } from '@/components/ui'
import { openContextMenu } from '@/components/menu'
import { ADDABLE } from '../Dialogs'
import { partRemovalActions } from './PartsPanel'
import { INSTRUMENTS } from '@/music/theory'
import { Play, Repeat, Trash2, ArrowUp, ArrowDown, Copy, ClipboardPaste, ListPlus, ListX, Plus, SlidersHorizontal, Waves } from 'lucide-react'

function cssColor(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).join(',')
  return alpha === 1 ? `rgb(${v})` : `rgba(${v},${alpha})`
}

export function themeColors(): Colors {
  return { ink: cssColor('ink'), paper: cssColor('paper'), staff: cssColor('ink', 0.42), faint: cssColor('ink', 0.5), accent: cssColor('accent') }
}

const identities = new WeakMap<object, number>()
let nextIdentity = 1
function identity(o: object): number {
  let id = identities.get(o)
  if (!id) { id = nextIdentity++; identities.set(o, id) }
  return id
}

export function visibleParts(p: Project): Part[] {
  const sel = p.view?.part ?? 'all'
  if (sel === 'all') return p.score.parts
  const part = p.score.parts.find((x) => x.id === sel)
  if (!part) return p.score.parts
  return part.group ? p.score.parts.filter((x) => x.group === part.group) : [part]
}

export default function ScoreView({ project, loop, onEditArpeggio }: { project: Project; loop: { from: number; to: number } | null; onEditArpeggio: (partId: string, eventId: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const svgHost = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const barHi = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [layout, setLayout] = useState<ScoreLayout | null>(null)
  const theme = useApp((s) => s.settings?.theme)
  const { cursor, sel, range, tabString, noteSelection } = useProject()
  const mode: ViewMode = project.view?.mode ?? 'both'
  const zoom = project.view?.zoom ?? 1
  const parts = useMemo(() => visibleParts(project), [project])
  const mt = measureTicks(project.score.timeSig)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Re-engrave only when something drawn changes: a part's volume, mute, sound or effects do not.
  const latest = useRef({ score: project.score, parts })
  latest.current = { score: project.score, parts }
  const notationKey = useMemo(() => {
    const sc = project.score
    return JSON.stringify([sc.title, sc.composer, sc.tempo, sc.timeSig, sc.keyFifths,
      parts.map((p) => [p.id, p.name, p.kind, p.clef, p.group, p.tuning, p.capo, identity(p.measures)])])
  }, [project.score, parts])
  useLayoutEffect(() => {
    if (!svgHost.current || width < 100) return
    const t0 = performance.now()
    const { score, parts: shown } = latest.current
    const l = renderScore(svgHost.current, score, { parts: shown, mode, width: width - 48, zoom, colors: themeColors(), header: true })
    setLayout(l)
    if (performance.now() - t0 > 400) console.info(`score render ${Math.round(performance.now() - t0)}ms`)
  }, [notationKey, mode, zoom, width, theme])

  useLayoutEffect(() => {
    if (!layout || !noteSelection) return
    const ids = new Set(noteSelection.ids)
    const glyphs = layout.systems.flatMap((sys) => sys.rows).filter((row) => row.partId === noteSelection.partId)
      .flatMap((row) => row.events).flatMap((ev) => ids.has(ev.id) && ev.glyph ? [ev.glyph] : [])
    for (const glyph of glyphs) glyph.classList.add('selected-note')
    return () => { for (const glyph of glyphs) glyph.classList.remove('selected-note') }
  }, [layout, noteSelection])

  // playhead: Songsterr-style band cursor, current-bar tint, live note highlights, smooth follow
  const settings = useApp((x) => x.settings)
  const cursorStyle = settings?.cursorStyle ?? 'band'
  const autoScroll = settings?.autoScroll ?? true
  const highlight = settings?.highlightNotes ?? true
  useEffect(() => {
    if (!layout) return
    const waypoints = new Map(layout.systems.map((sys) => [sys, playbackWaypoints(sys, mt)]))
    let raf = 0
    let lastSys = -1
    let active = new Set<SVGElement>()
    let lastTick = -1
    const loopFn = () => {
      const el = playhead.current
      const bar = barHi.current
      const next = new Set<SVGElement>()
      if (el && bar) {
        const tick = Math.min(player.getTick(), player.endTick)
        if (tick < lastTick) lastSys = -1
        lastTick = tick
        const mi = Math.min(Math.floor(tick / mt), (parts[0]?.measures.length ?? 1) - 1)
        const sys = systemForMeasure(layout, mi)
        if (sys && (player.playheadStarted || tick > 0)) {
          const x = playbackX(waypoints.get(sys)!, tick)
          const top = sys.rows[0].top + 8
          const bottom = sys.rows[sys.rows.length - 1].bottom - 8
          const w = cursorStyle === 'band' ? 18 : 2
          el.style.display = 'block'
          el.style.width = `${w * zoom}px`
          el.style.transform = `translate(${(x - w / 2) * zoom}px, ${top * zoom}px)`
          el.style.height = `${(bottom - top) * zoom}px`
          const m = sys.measures.find((mm) => mm.index === mi)
          if (m && player.state === 'playing') {
            bar.style.display = 'block'
            bar.style.transform = `translate(${m.x * zoom}px, ${top * zoom}px)`
            bar.style.width = `${m.w * zoom}px`
            bar.style.height = `${(bottom - top) * zoom}px`
          } else bar.style.display = 'none'
          if (highlight && player.playheadStarted) {
            const local = tick - mi * mt
            for (const r of sys.rows) {
              const ev = r.events.find((e) => e.measure === mi && !e.rest && e.start <= local && e.start + e.dur > local)
              if (ev?.glyph) next.add(ev.glyph)
            }
          }
          const si = layout.systems.indexOf(sys)
          if (autoScroll && player.state === 'playing' && si !== lastSys && scroller.current) {
            lastSys = si
            const sc = scroller.current
            sc.scrollTo({ top: Math.max(0, sys.top * zoom - sc.clientHeight * 0.16), behavior: 'smooth' })
          }
        } else {
          el.style.display = 'none'
          bar.style.display = 'none'
        }
      }
      for (const glyph of active) if (!next.has(glyph)) glyph.classList.remove('playing-note')
      for (const glyph of next) if (!active.has(glyph)) glyph.classList.add('playing-note')
      active = next
      raf = requestAnimationFrame(loopFn)
    }
    raf = requestAnimationFrame(loopFn)
    return () => { cancelAnimationFrame(raf); for (const glyph of active) glyph.classList.remove('playing-note') }
  }, [layout, mt, zoom, parts, cursorStyle, autoScroll, highlight])

  // keep the cursor visible while editing
  useEffect(() => {
    if (!layout || !cursor || player.state === 'playing') return
    const sys = systemForMeasure(layout, cursor.measure)
    const sc = scroller.current
    if (!sys || !sc) return
    if (sys.top * zoom < sc.scrollTop || sys.bottom * zoom > sc.scrollTop + sc.clientHeight) sc.scrollTo({ top: Math.max(0, sys.top * zoom - 80), behavior: 'smooth' })
  }, [cursor, layout, zoom])

  const hit = (e: React.MouseEvent) => {
    if (!layout || !svgHost.current) return null
    const r = svgHost.current.getBoundingClientRect()
    const uiZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    const x = (e.clientX - r.left) / (zoom * uiZoom)
    const y = (e.clientY - r.top) / (zoom * uiZoom)
    const sys = layout.systems.find((s) => y >= s.top && y <= s.bottom)
    if (!sys) return null
    const m = sys.measures.find((mm) => x >= mm.x && x < mm.x + mm.w)
    if (!m) return null
    const target = e.target as Node
    let row = sys.rows.find((rr) => rr.events.some((event) => event.glyph?.contains(target)))
      ?? sys.rows.find((rr) => y >= rr.top && y <= rr.bottom)
    if (!row) row = sys.rows.reduce((a, b) => (Math.abs(b.y + b.h / 2 - y) < Math.abs(a.y + a.h / 2 - y) ? b : a))
    const evs = row.events.filter((ev) => ev.measure === m.index)
    const glyphHit = evs.find((event) => event.glyph?.contains(target))
    const ev = glyphHit ?? evs.reduce<(typeof evs)[number] | null>((best, cur) => (!best || Math.abs(cur.x + 6 - x) < Math.abs(best.x + 6 - x) ? cur : best), null)
    const noteHit = ev && !ev.rest && (glyphHit || (Math.abs(ev.x + 6 - x) <= 12 && y >= row.top && y <= row.bottom))
    return { sys, m, row, ev, noteHit, x, y }
  }

  const onClick = (e: React.MouseEvent) => {
    const h = hit(e)
    if (!h) return
    const st = useProject.getState()
    if (h.noteHit && h.ev && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      st.selectNotes(h.row.partId, h.ev.id, e.shiftKey ? 'extend' : 'toggle')
      return
    }
    if (e.shiftKey && st.cursor) {
      const a = st.range ? (st.range.from === st.cursor.measure ? st.range.to : st.range.from) : st.cursor.measure
      st.setRange({ from: Math.min(a, h.m.index), to: Math.max(a, h.m.index) })
      return
    }
    st.setRange(null)
    st.select(h.row.partId, h.m.index, h.ev?.id ?? null, h.ev?.start ?? 0)
    if (h.row.kind === 'tab') {
      const part = project.score.parts.find((p) => p.id === h.row.partId)
      const n = part?.tuning?.length ?? 6
      useProject.setState({ tabString: Math.max(1, Math.min(n, Math.round((h.y - h.row.y) / 13) + 1)) })
    }
    player.seek(h.m.index * mt + (h.ev?.start ?? 0))
  }
  const onContext = (e: React.MouseEvent) => {
    const h = hit(e)
    const st = useProject.getState()
    if (h) {
      const inRange = st.range && h.m.index >= st.range.from && h.m.index <= st.range.to
      const inNotes = h.noteHit && st.noteSelection?.partId === h.row.partId && !!h.ev && st.noteSelection.ids.includes(h.ev.id)
      if (!inRange && !inNotes) { st.setRange(null); st.select(h.row.partId, h.m.index, h.ev?.id ?? null, h.ev?.start ?? 0) }
    }
    const mi = h?.m.index ?? st.cursor?.measure ?? 0
    const part = project.score.parts.find((p) => p.id === (h?.row.partId ?? st.cursor?.partId))
    const ev = h?.ev && !h.ev.rest
    const chord = h?.ev && part?.measures[mi]?.events.find((event) => event.id === h.ev?.id)
    const selectedNotes = useProject.getState().noteSelection
    const r = useProject.getState().range ?? { from: mi, to: mi }
    openContextMenu(e, [
      { label: 'Play from here', icon: <Play size={14} />, onClick: () => player.play(mi * mt + (h?.ev?.start ?? 0)) },
      { label: `Loop bars ${r.from + 1}–${r.to + 1}`, icon: <Repeat size={14} />, onClick: () => player.setOptions({ loop: r, loopOn: true }) },
      { separator: true },
      ...(ev ? [
        { label: selectedNotes ? 'Delete selected notes' : 'Delete note', icon: <Trash2 size={14} />, hint: 'Del', onClick: () => useProject.getState().deleteSel() },
        { label: 'Up a semitone', icon: <ArrowUp size={14} />, hint: '↑', onClick: () => useProject.getState().transposeSel(1) },
        { label: 'Down a semitone', icon: <ArrowDown size={14} />, hint: '↓', onClick: () => useProject.getState().transposeSel(-1) },
        { label: 'Tie to next', onClick: () => useProject.getState().toggleTie() },
        ...(part && part.kind !== 'drums' && chord && chord.notes.length > 1 ? [{ label: 'Arpeggiate chord…', icon: <Waves size={14} />, onClick: () => onEditArpeggio(part.id, chord.id) }] : []),
        { separator: true }
      ] : []),
      { label: selectedNotes ? 'Copy selected notes' : 'Copy bars', icon: <Copy size={14} />, hint: 'Ctrl C', onClick: () => useProject.getState().copy() },
      { label: 'Paste', icon: <ClipboardPaste size={14} />, hint: 'Ctrl V', disabled: !useProject.getState().clipboard, onClick: () => useProject.getState().paste() },
      { label: 'Duplicate bars', hint: 'Ctrl D', onClick: () => useProject.getState().duplicate() },
      { label: 'Insert bar before', icon: <ListPlus size={14} />, onClick: () => useProject.getState().addMeasures(mi) },
      { label: 'Insert bar after', icon: <ListPlus size={14} />, onClick: () => useProject.getState().addMeasures(mi + 1) },
      { label: r.from === r.to ? 'Delete bar' : `Delete bars ${r.from + 1}–${r.to + 1}`, icon: <ListX size={14} />, danger: true, onClick: () => useProject.getState().removeMeasures() },
      { separator: true },
      { label: 'Add instrument', icon: <Plus size={14} />, submenu: ADDABLE.map((k) => ({ label: INSTRUMENTS[k].label, onClick: () => useProject.getState().addPart(k) })) },
      ...(part ? [{ label: `Sound & effects: ${part.name}`, icon: <SlidersHorizontal size={14} />, onClick: () => useProject.setState({ rackPart: part.id }) }, ...partRemovalActions(part)] : [])
    ])
  }
  const onDouble = (e: React.MouseEvent) => {
    const h = hit(e)
    if (!h) return
    player.play(h.m.index * mt + (h.ev?.start ?? 0))
  }

  // ---- overlays
  const overlays: React.ReactNode[] = []
  if (layout) {
    const band = (from: number, to: number, cls: string, key: string, label?: string) => {
      for (const sys of layout.systems) {
        const ms = sys.measures.filter((m) => m.index >= from && m.index <= to)
        if (!ms.length) continue
        const x0 = ms[0].x
        const x1 = ms[ms.length - 1].x + ms[ms.length - 1].w
        overlays.push(
          <div key={`${key}${sys.top}`} className={cls} style={{ left: x0 * zoom, top: (sys.top + 14) * zoom, width: (x1 - x0) * zoom, height: (sys.bottom - sys.top - 6) * zoom }}>
            {label && ms[0].index === from && <span className="absolute -top-0.5 left-1 text-[10px] font-semibold uppercase tracking-wider">{label}</span>}
          </div>
        )
      }
    }
    if (loop) band(loop.from, loop.to, 'absolute rounded-md bg-accent2/[0.07] border border-accent2/40 text-accent2 pointer-events-none', 'loop', 'Loop')
    if (range) band(range.from, range.to, 'absolute rounded-md bg-accent/[0.08] border border-accent/50 pointer-events-none', 'range')
    if (cursor && !noteSelection) {
      const sys = systemForMeasure(layout, cursor.measure)
      const rowsFor = sys?.rows.filter((r) => r.partId === cursor.partId) ?? []
      for (const row of rowsFor) {
        const ev = row.events.find((e) => e.id === sel && e.measure === cursor.measure) ?? row.events.find((e) => e.measure === cursor.measure && e.start === cursor.tick)
        const x = ev ? ev.x : xForTick(sys!, cursor.measure, cursor.tick, mt)
        if (x === null) continue
        overlays.push(<div key={`cur${row.kind}`} className="absolute rounded-[5px] bg-accent/20 ring-1 ring-accent/70 pointer-events-none transition-all duration-75" style={{ left: (x - 5) * zoom, top: (row.y - 14) * zoom, width: 22 * zoom, height: (row.h + 28) * zoom }} />)
        const part = project.score.parts.find((p) => p.id === row.partId)
        if (row.kind === 'tab' && part && isFretted(part.kind)) {
          overlays.push(<div key="str" className="absolute bg-accent pointer-events-none rounded" style={{ left: (x - 8) * zoom, top: (row.y + (tabString - 1) * 13 - 1) * zoom, width: 28 * zoom, height: 2 }} />)
        }
      }
    }
  }

  return (
    <div ref={host} className="h-full min-w-0 relative">
      <div ref={scroller} className="absolute inset-0 overflow-auto">
        <div className="mx-6 my-5 rounded-2xl bg-paper shadow-[0_1px_0_rgb(var(--line)),0_10px_40px_-20px_rgb(0_0_0/0.35)] relative">
          <div className="relative score-sheet" onClick={onClick} onDoubleClick={onDouble} onContextMenu={onContext} style={{ cursor: 'text' }}>
            <div ref={svgHost} />
            <div className="absolute inset-0 pointer-events-none">
              {overlays}
              <div ref={barHi} className="absolute left-0 top-0 rounded-lg bg-accent/[0.06] pointer-events-none" style={{ display: 'none' }} />
              <div ref={playhead} className={cx('absolute left-0 top-0 pointer-events-none', cursorStyle === 'band' ? 'rounded-md bg-gradient-to-b from-accent/0 via-accent/30 to-accent/0 border-x border-accent/40' : 'rounded bg-accent shadow-[0_0_12px_rgb(var(--accent))]')} style={{ display: 'none', willChange: 'transform' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
