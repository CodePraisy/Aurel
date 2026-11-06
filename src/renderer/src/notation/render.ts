import {
  Renderer, Stave, TabStave, StaveNote, TabNote, Voice, Formatter, Beam, Accidental, Dot, Articulation, Annotation,
  StaveTie, StaveConnector, GhostNote, Bend, Vibrato, TabTie, TabSlide, Fraction, Modifier, Stroke,
  type RenderContext, type StemmableNote, type Tickable
} from 'vexflow'
import type { NoteEvent, Part, Score, ViewMode } from '@shared/types'
import { PPQ } from '@shared/types'
import { durInfo, INSTRUMENTS, isFretted, spell, keyAccidentals, letterIndex, drumPiece, KEY_NAMES, WHOLE } from '@/music/theory'
import { assignTab, tuningOf, type TabPos } from '@/music/tab'

export interface Colors { ink: string; paper: string; staff: string; faint: string; accent: string }

export interface RowLayout {
  partId: string
  kind: 'staff' | 'tab'
  y: number // top of the stave lines
  h: number // height of the stave lines
  top: number // hit area top
  bottom: number
  events: { id: string; measure: number; start: number; dur: number; x: number; rest: boolean; glyph?: SVGElement }[]
}

export interface SystemLayout {
  top: number
  bottom: number
  measures: { index: number; x: number; w: number; noteX: number; endX: number }[]
  rows: RowLayout[]
}

export interface ScoreLayout { width: number; height: number; zoom: number; systems: SystemLayout[] }

export interface RenderOptions {
  parts: Part[]
  mode: ViewMode
  width: number // css px available
  zoom: number
  colors: Colors
  header?: boolean
  split?: boolean // one SVG per system (print: lets pages break between systems)
}

const DUR_CODE: Record<number, string> = { [WHOLE]: 'w', [WHOLE / 2]: 'h', [PPQ]: 'q', [PPQ / 2]: '8', [PPQ / 4]: '16', [PPQ / 8]: '32' }
const MIN_W: Record<string, number> = { w: 48, h: 40, q: 32, '8': 26, '16': 21, '32': 17 }
const ART: Record<string, string> = { staccato: 'a.', accent: 'a>', tenuto: 'a-', marcato: 'a^', fermata: 'a@a' }

function rows(p: Part, mode: ViewMode): ('staff' | 'tab')[] {
  if (!isFretted(p.kind)) return ['staff']
  if (mode === 'staff') return ['staff']
  if (mode === 'tab') return ['tab']
  return ['staff', 'tab']
}

function clefName(p: Part): string {
  return p.clef === 'treble8' ? 'treble' : p.clef
}

function measureMinWidth(score: Score, parts: Part[], mi: number): number {
  let w = 0
  for (const p of parts) {
    const m = p.measures[mi]
    if (!m) continue
    let pw = 0
    for (const e of m.events) {
      const info = durInfo(e.dur)
      const code = info ? DUR_CODE[info.base] : 'q'
      pw += (MIN_W[code] ?? 26) + (info?.dotted ? 6 : 0) + (e.notes.length > 2 ? 4 : 0) + (e.arpeggio && e.notes.length > 1 ? 12 : 0)
    }
    w = Math.max(w, pw)
  }
  return Math.max(70, w + 24 + (score.timeSig.num > 4 ? 8 : 0))
}

function staffOverflow(part: Part, measures: number[], key: number): { above: number; below: number } {
  if (part.kind === 'drums') return { above: 0, below: 0 }
  const bass = part.clef === 'bass'
  const bottom = bass ? 2 * 7 + letterIndex('G') : 4 * 7 + letterIndex('E')
  const top = bottom + 8
  const shift = INSTRUMENTS[part.kind].displayShift
  let above = 0, below = 0
  for (const index of measures) {
    for (const event of part.measures[index]?.events ?? []) {
      if (event.rest) continue
      for (const note of event.notes) {
        const { octave, step } = spell(note.pitch + shift, key)
        const line = octave * 7 + letterIndex(step)
        if (line > top) above = Math.max(above, (line - top) * 5 + 12)
        if (line < bottom) below = Math.max(below, (bottom - line) * 5 + 12)
      }
    }
  }
  return { above, below }
}

export function renderScore(el: HTMLElement, score: Score, o: RenderOptions): ScoreLayout {
  el.innerHTML = ''
  const parts = o.parts
  const zoom = o.zoom
  const W = Math.max(400, o.width / zoom)
  const count = parts[0]?.measures.length ?? 0
  const multi = parts.length > 1
  const marginL = multi ? 100 : 18
  const marginR = 14
  const keyW = Math.abs(score.keyFifths) * 10
  const headerW = (first: boolean, hasTime: boolean) => (first ? 38 + keyW + (hasTime ? 28 : 0) + 8 : 0)
  const tabs = new Map<string, Map<string, (TabPos | null)[]>>()
  for (const p of parts) if (isFretted(p.kind)) tabs.set(p.id, assignTab(p))

  // ---- pack measures into systems
  const systemsIdx: number[][] = []
  let line: number[] = []
  let used = 0
  for (let mi = 0; mi < count; mi++) {
    const w = measureMinWidth(score, parts, mi) + headerW(line.length === 0, mi === 0)
    if (line.length && used + w > W - marginL - marginR) { systemsIdx.push(line); line = []; used = 0 }
    used += line.length === 0 ? measureMinWidth(score, parts, mi) + headerW(true, mi === 0) : w
    line.push(mi)
  }
  if (line.length) systemsIdx.push(line)

  // ---- vertical metrics
  const STAFF_H = 40
  const rowSpec = parts.flatMap((p) => rows(p, o.mode).map((k) => ({ p, k })))
  const rowGap = (k: 'staff' | 'tab', prev: 'staff' | 'tab' | null, samePart: boolean) => (prev === null ? 0 : samePart ? 34 : k === 'tab' ? 40 : 48)
  const tabH = (p: Part) => (tuningOf(p).length - 1) * 13
  const headerH = o.header ? 90 : 18
  const systemTop = 34
  const systemBottom = 46
  let y = headerH
  const layoutSystems: SystemLayout[] = []
  const systemMetrics = systemsIdx.map((measures) => {
    const top = y
    let rowY = top + systemTop
    let previous: { p: Part; k: 'staff' | 'tab'; below: number } | undefined
    const placedRows = rowSpec.map(({ p, k }) => {
      const { above, below } = k === 'staff' ? staffOverflow(p, measures, score.keyFifths) : { above: 0, below: 0 }
      rowY += rowGap(k, previous?.k ?? null, previous?.p === p) + above + (previous?.below ?? 0)
      const h = k === 'staff' ? STAFF_H : tabH(p)
      const placed = { p, k, y: rowY, h, above, below }
      rowY += h
      previous = placed
      return placed
    })
    const bottom = rowY + (placedRows.at(-1)?.below ?? 0)
    y = bottom + systemBottom
    return { top, bottom, rows: placedRows }
  })
  const totalH = y + 10

  type Ctx = RenderContext & { setBackgroundFillStyle?: (s: string) => void; setViewBox?: (x: number, y: number, w: number, h: number) => void }
  const makeCtx = (host: HTMLElement, top: number, h: number): Ctx => {
    const r = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG)
    r.resize(W * zoom, h * zoom)
    const c = r.getContext() as Ctx
    c.scale(zoom, zoom)
    if (top) c.setViewBox?.(0, top, W, h)
    c.setFillStyle(o.colors.ink)
    c.setStrokeStyle(o.colors.ink)
    c.setBackgroundFillStyle?.(o.colors.paper)
    return c
  }
  const chunk = (top: number, h: number): Ctx => {
    const d = document.createElement('div')
    d.style.breakInside = 'avoid'
    el.appendChild(d)
    return makeCtx(d, top, h)
  }
  let ctx: Ctx = o.split ? chunk(0, (systemMetrics[1]?.top ?? totalH) - 0) : makeCtx(el, 0, totalH)

  if (o.header) {
    ctx.save()
    ctx.setFont('Fraunces Variable, Georgia, serif', 26, 'normal')
    const tw = ctx.measureText(score.title).width
    ctx.fillText(score.title, (W - tw) / 2, 44)
    ctx.setFont('Inter Variable, sans-serif', 11, 'normal')
    if (score.composer) { const cw = ctx.measureText(score.composer).width; ctx.fillText(score.composer, (W - cw) / 2, 64) }
    ctx.fillText(`♩ = ${score.tempo}`, marginL, 72)
    ctx.restore()
  }

  const pendingTie = new Map<string, { note: StaveNote | null; pitches: number[] }>()
  const pendingTab = new Map<string, { note: TabNote; kind: 'hammer' | 'slide'; pitch: number }>()

  systemsIdx.forEach((mis, si) => {
    const { top: sy, bottom, rows: rowYs } = systemMetrics[si]
    if (o.split && si > 0) ctx = chunk(sy, (systemMetrics[si + 1]?.top ?? totalH) - sy)
    const firstSystem = si === 0
    // widths: stretch to fill (last system only if it's at least 60% full)
    const mins = mis.map((mi, k) => measureMinWidth(score, parts, mi) + headerW(k === 0, mi === 0))
    const avail = W - marginL - marginR
    const total = mins.reduce((a, b) => a + b, 0)
    const last = si === systemsIdx.length - 1
    const stretch = last && total < avail * 0.6 ? 1 : avail / total
    const widths = mins.map((w) => w * stretch)

    const sys: SystemLayout = {
      top: sy, bottom: bottom + 28, measures: [],
      rows: rowYs.map((r) => ({ partId: r.p.id, kind: r.k, y: r.y, h: r.h, top: r.y - r.above - 26, bottom: r.y + r.h + r.below + 26, events: [] }))
    }

    // part labels
    if (multi) {
      ctx.save()
      ctx.setFont('Inter Variable, sans-serif', 10, firstSystem ? 'bold' : 'normal')
      ctx.setFillStyle(o.colors.faint)
      const seenGroup = new Set<string>()
      for (const r of rowYs) {
        if (r.k === 'tab' && rows(r.p, o.mode).length > 1) continue
        const label = r.p.group ? r.p.name.replace(/\s+(RH|LH)$/, '') : r.p.name
        if (r.p.group) { if (seenGroup.has(r.p.group)) continue; seenGroup.add(r.p.group) }
        const short = firstSystem ? label : label.slice(0, 5) + (label.length > 5 ? '.' : '')
        const groupRows = r.p.group ? rowYs.filter((x) => x.p.group === r.p.group) : [r]
        const mid = (groupRows[0].y + groupRows[groupRows.length - 1].y + groupRows[groupRows.length - 1].h) / 2
        ctx.fillText(short.length > 12 ? short.slice(0, 11) + '…' : short, 6, mid + 3)
      }
      ctx.restore()
    }

    let x = marginL
    mis.forEach((mi, k) => {
      const w = widths[k]
      const staves: (Stave | TabStave)[] = []
      rowYs.forEach((r) => {
        const isTab = r.k === 'tab'
        const st = isTab
          ? new TabStave(x, r.y - 4 * 13, w, { num_lines: tuningOf(r.p).length, fill_style: o.colors.staff })
          : new Stave(x, r.y - 40, w, { fill_style: o.colors.staff })
        if (k === 0) {
          if (isTab) st.addClef('tab')
          else {
            st.addClef(clefName(r.p), 'default', r.p.clef === 'treble8' || (r.p.kind === 'bass' && r.p.clef === 'bass') ? '8vb' : undefined)
            if (r.p.kind !== 'drums') st.addKeySignature(KEY_NAMES[score.keyFifths + 7])
            if (mi === 0) st.addTimeSignature(`${score.timeSig.num}/${score.timeSig.den}`)
          }
        }
        if (mi === count - 1) st.setEndBarType(3)
        staves.push(st)
      })
      Stave.formatBegModifiers(staves)
      staves.forEach((st) => st.setContext(ctx).draw())
      if (k === 0) {
        ctx.save()
        ctx.setFont('Inter Variable, sans-serif', 9, 'normal')
        ctx.setFillStyle(o.colors.faint)
        ctx.fillText(String(mi + 1), x, rowYs[0].y - 20)
        ctx.restore()
      }
      if (rowYs.length > 1) {
        const top = staves[0]
        const bottom = staves[staves.length - 1]
        new StaveConnector(top, bottom).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw()
        if (k === 0) new StaveConnector(top, bottom).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw()
      }
      if (k === 0) {
        // braces for grand staff groups
        const groups = new Map<string, number[]>()
        rowYs.forEach((r, i) => { if (r.p.group) groups.set(r.p.group, [...(groups.get(r.p.group) ?? []), i]) })
        for (const idx of groups.values()) if (idx.length > 1) new StaveConnector(staves[idx[0]], staves[idx[idx.length - 1]]).setType(StaveConnector.type.BRACE).setContext(ctx).draw()
      }

      // ---- notes
      const voices: Voice[] = []
      const drawLater: (() => void)[] = []
      const recorded: { row: RowLayout; e: NoteEvent; note: Tickable }[] = []
      rowYs.forEach((r, ri) => {
        const part = r.p
        const m = part.measures[mi]
        if (!m) return
        const isTab = r.k === 'tab'
        const tabMap = tabs.get(part.id)
        const accState = keyAccidentals(part.kind === 'drums' ? 0 : score.keyFifths)
        const measAcc = new Map<string, number>()
        const notes: Tickable[] = []
        const beamable: StemmableNote[] = []
        const shift = INSTRUMENTS[part.kind].displayShift
        for (const e of m.events) {
          const info = durInfo(e.dur) ?? { base: PPQ, dotted: false }
          const code = DUR_CODE[info.base] ?? 'q'
          const dur = code + (info.dotted ? 'd' : '')
          let note: Tickable
          if (isTab) {
            const pos = tabMap?.get(e.id)
            if (e.rest || !pos || pos.every((p) => !p)) {
              note = o.mode === 'tab' && e.rest ? new StaveNote({ keys: ['b/4'], duration: code + 'r' + (info.dotted ? 'd' : ''), clef: 'treble' }) : new GhostNote({ duration: dur })
              if (o.mode === 'tab' && e.rest && info.dotted) Dot.buildAndAttach([note as StaveNote], { all: true })
            } else {
              const positions = pos.filter((p): p is TabPos => !!p).map((p) => ({ str: p.string, fret: e.tech?.includes('harmonic') ? `<${p.fret}>` : String(p.fret) }))
              const tn = new TabNote({ positions, duration: dur }, o.mode === 'tab')
              if (e.arpeggio && positions.length > 1 && o.mode === 'tab') tn.addModifier(new Stroke(e.arpeggio.direction === 'up' ? Stroke.Type.ROLL_UP : Stroke.Type.ROLL_DOWN, { all_voices: false }), 0)
              if (info.dotted && o.mode === 'tab') Dot.buildAndAttach([tn], { all: true })
              if (e.tech?.includes('bend')) tn.addModifier(new Bend((e.bend ?? 2) >= 2 ? 'Full' : (e.bend ?? 2) === 1 ? '1/2' : `${e.bend}`), 0)
              if (e.tech?.includes('vibrato')) tn.addModifier(new Vibrato(), 0)
              if (e.tech?.includes('palmMute') && o.mode === 'tab') tn.addModifier(new Annotation('P.M.').setFont('Inter Variable', 9, 'normal').setVerticalJustification(Annotation.VerticalJustify.TOP), 0)
              const prevT = pendingTab.get(part.id)
              if (prevT) {
                const notesPair = { first_note: prevT.note, last_note: tn, first_indices: [0], last_indices: [0] }
                drawLater.push(() => {
                  if (prevT.kind === 'hammer') TabTie.createHammeron(notesPair).setContext(ctx).draw()
                  else new TabSlide(notesPair, (e.notes[0]?.pitch ?? 0) >= prevT.pitch ? TabSlide.SLIDE_UP : TabSlide.SLIDE_DOWN).setContext(ctx).draw()
                })
                pendingTab.delete(part.id)
              }
              if (e.tech?.includes('hammer')) pendingTab.set(part.id, { note: tn, kind: 'hammer', pitch: e.notes[0].pitch })
              else if (e.tech?.includes('slide')) pendingTab.set(part.id, { note: tn, kind: 'slide', pitch: e.notes[0].pitch })
              note = tn
            }
          } else if (e.rest || !e.notes.length) {
            const restKey = part.clef === 'bass' ? 'd/3' : 'b/4'
            const sn = new StaveNote({ keys: [restKey], duration: code + 'r', clef: clefName(part) })
            if (info.dotted) Dot.buildAndAttach([sn], { all: true })
            note = sn
            pendingTie.delete(part.id)
          } else {
            const sorted = [...e.notes].sort((a, b) => a.pitch - b.pitch)
            let keys: string[]
            const accs: (string | null)[] = []
            if (part.kind === 'drums') {
              const uniq = [...new Map(sorted.map((n) => [drumPiece(n.pitch).id, drumPiece(n.pitch)])).values()]
              keys = uniq.map((d) => d.key + (d.head === 'x' ? '/x2' : d.head === 'circle-x' ? '/x3' : ''))
              uniq.forEach(() => accs.push(null))
            } else {
              keys = sorted.map((n) => {
                const sp = spell(n.pitch + shift, score.keyFifths)
                const li = letterIndex(sp.step)
                const k2 = `${sp.step}${sp.octave}`
                const cur = measAcc.has(k2) ? measAcc.get(k2)! : accState[li]
                accs.push(cur === sp.alter ? null : sp.alter === 1 ? '#' : sp.alter === -1 ? 'b' : 'n')
                measAcc.set(k2, sp.alter)
                return `${sp.step.toLowerCase()}/${sp.octave}`
              })
            }
            const sn = new StaveNote({ keys, duration: dur, clef: clefName(part), auto_stem: part.kind !== 'drums', stem_direction: part.kind === 'drums' ? 1 : undefined })
            if (e.arpeggio && keys.length > 1 && part.kind !== 'drums') sn.addModifier(new Stroke(e.arpeggio.direction === 'up' ? Stroke.Type.ROLL_UP : Stroke.Type.ROLL_DOWN, { all_voices: false }), 0)
            accs.forEach((a, i) => { if (a) sn.addModifier(new Accidental(a), i) })
            if (info.dotted) Dot.buildAndAttach([sn], { all: true })
            for (const a of e.art ?? []) sn.addModifier(new Articulation(ART[a]).setPosition(a === 'fermata' ? Modifier.Position.ABOVE : sn.getStemDirection() === 1 ? Modifier.Position.BELOW : Modifier.Position.ABOVE), 0)
            if (e.dynamic) sn.addModifier(new Annotation(e.dynamic).setFont('Fraunces Variable, Georgia, serif', 13, 'bold', 'italic').setVerticalJustification(Annotation.VerticalJustify.BOTTOM), 0)
            if (e.tech?.includes('palmMute') && o.mode === 'staff') sn.addModifier(new Annotation('P.M.').setFont('Inter Variable', 9).setVerticalJustification(Annotation.VerticalJustify.TOP), 0)
            if (e.tech?.includes('vibrato')) sn.addModifier(new Vibrato(), 0)
            // ties
            const pt = pendingTie.get(part.id)
            if (pt && part.kind !== 'drums') {
              const fi: number[] = [], li: number[] = []
              pt.pitches.forEach((p, i) => { const j = sorted.findIndex((n) => n.pitch === p); if (j >= 0) { fi.push(i); li.push(j) } })
              const first = pt.note
              if (fi.length) drawLater.push(() => new StaveTie(first ? { first_note: first, last_note: sn, first_indices: fi, last_indices: li } : { first_note: undefined as unknown as StaveNote, last_note: sn, first_indices: li, last_indices: li }).setContext(ctx).draw())
            }
            if (e.tie) pendingTie.set(part.id, { note: sn, pitches: sorted.map((n) => n.pitch) })
            else pendingTie.delete(part.id)
            note = sn
            if (info.base < PPQ) beamable.push(sn)
          }
          notes.push(note)
          recorded.push({ row: sys.rows[ri], e, note })
        }
        const voice = new Voice({ num_beats: score.timeSig.num, beat_value: score.timeSig.den }).setMode(Voice.Mode.SOFT)
        voice.addTickables(notes)
        voice.setStave(staves[ri])
        voices.push(voice)
        if (!isTab && beamable.length > 1) {
          const groups = score.timeSig.den === 8 && score.timeSig.num % 3 === 0 ? [new Fraction(3, 8)] : score.timeSig.den === 8 ? [new Fraction(2, 8)] : [new Fraction(1, 4)]
          const stavenotes = notes.filter((n): n is StaveNote => n instanceof StaveNote)
          const beams = Beam.generateBeams(stavenotes, { groups, ...(part.kind === 'drums' ? { stem_direction: 1, maintain_stem_directions: false } : {}) })
          drawLater.unshift(() => beams.forEach((b) => b.setContext(ctx).draw()))
        }
        // close ties that cross into the next system
        if (k === mis.length - 1) {
          const pt = pendingTie.get(part.id)
          if (pt?.note && mi < count - 1) {
            const first = pt.note
            const idx = pt.pitches.map((_, i) => i)
            drawLater.push(() => new StaveTie({ first_note: first, last_note: undefined as unknown as StaveNote, first_indices: idx, last_indices: idx }).setContext(ctx).draw())
            pendingTie.set(part.id, { note: null, pitches: pt.pitches })
          }
        }
      })
      const startX = Math.max(...staves.map((s) => s.getNoteStartX()))
      staves.forEach((s) => s.setNoteStartX(startX))
      const fmt = new Formatter()
      voices.forEach((v) => fmt.joinVoices([v]))
      const noteW = x + w - startX - 14
      try { fmt.format(voices, Math.max(20, noteW)) } catch { /* degenerate measure */ }
      voices.forEach((v, i) => { try { v.draw(ctx, staves[i]) } catch (err) { console.warn('draw voice', err) } })
      drawLater.forEach((f) => { try { f() } catch (err) { console.warn('draw extra', err) } })
      for (const r of recorded) {
        const nx = (r.note as StaveNote).getAbsoluteX?.() ?? startX
        const glyph = r.note.getSVGElement()
        r.row.events.push({ id: r.e.id, measure: mi, start: r.e.start, dur: r.e.dur, x: nx, rest: !!r.e.rest, glyph })
      }
      sys.measures.push({ index: mi, x, w, noteX: startX, endX: x + w })
      x += w
    })
    layoutSystems.push(sys)
  })
  return { width: W, height: totalH, zoom, systems: layoutSystems }
}

/** Playback waypoints span the whole system so the playhead glides across barlines. */
export function playbackWaypoints(sys: SystemLayout, mt: number): [number, number][] {
  const points = new Map<number, number>()
  for (const row of sys.rows) {
    for (const event of row.events) {
      const tick = event.measure * mt + event.start
      // notes first: where a note and a rest share a beat, the note's position wins
      if (!event.rest && !points.has(tick)) points.set(tick, event.x + 5)
    }
  }
  // rests too, so the cursor keeps time across them instead of gliding to the next note
  for (const row of sys.rows) for (const event of row.events) {
    const tick = event.measure * mt + event.start
    if (event.rest && !points.has(tick)) points.set(tick, event.x + 5)
  }
  for (const measure of sys.measures) {
    const tick = measure.index * mt
    if (!points.has(tick)) points.set(tick, measure.noteX + 5)
  }
  const last = sys.measures.at(-1)!
  points.set((last.index + 1) * mt, last.endX)
  return [...points].sort((a, b) => a[0] - b[0])
}

export function playbackX(points: [number, number][], tick: number): number {
  let low = 0, high = points.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (points[middle][0] <= tick) low = middle
    else high = middle
  }
  const [t0, x0] = points[low], [t1, x1] = points[high]
  const fraction = Math.max(0, Math.min(1, (tick - t0) / (t1 - t0)))
  return x0 + (x1 - x0) * fraction
}

/** Interpolated x position for a tick within a measure of a system. */
export function xForTick(sys: SystemLayout, mi: number, tick: number, mt: number): number | null {
  const m = sys.measures.find((x) => x.index === mi)
  if (!m) return null
  const pts = new Map<number, number>()
  for (const r of sys.rows) for (const e of r.events) if (e.measure === mi && !pts.has(e.start)) pts.set(e.start, e.x)
  const arr = [...pts.entries()].sort((a, b) => a[0] - b[0])
  if (!arr.length || arr[0][0] > 0) arr.unshift([0, m.noteX])
  arr.push([mt, m.endX - 6])
  for (let i = 0; i < arr.length - 1; i++) {
    const [t0, x0] = arr[i]
    const [t1, x1] = arr[i + 1]
    if (tick >= t0 && tick <= t1) return x0 + ((x1 - x0) * (tick - t0)) / Math.max(1, t1 - t0)
  }
  return arr[arr.length - 1][1]
}

export function systemForMeasure(layout: ScoreLayout, mi: number): SystemLayout | undefined {
  return layout.systems.find((s) => s.measures.some((m) => m.index === mi))
}
