import { Undo2, Redo2, Plus, Minus, ListPlus, ListX, Copy, ClipboardPaste, Layers, Waves, ArrowUpDown } from 'lucide-react'
import type { Dynamic, Project } from '@shared/types'
import { PPQ } from '@shared/types'
import { useProject } from '@/store/project'
import { Select } from '@/components/menu'
import { cx, Popover, MenuItem } from '@/components/ui'
import { isFretted, WHOLE } from '@/music/theory'
import { CHORD_SHORTCUT } from './shortcuts'

function NoteGlyph({ base, rest }: { base: number; rest?: boolean }) {
  const flags = base <= PPQ / 2 ? Math.round(Math.log2(PPQ / base)) : 0
  if (rest) return <span className="font-display text-[15px]">𝄽</span>
  const hollow = base >= WHOLE / 2
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" className="overflow-visible">
      <ellipse cx="5" cy="14" rx="4" ry="2.9" transform="rotate(-22 5 14)" fill={hollow ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="1.4" />
      {base < WHOLE && <line x1="8.6" y1="13" x2="8.6" y2="1.5" stroke="currentColor" strokeWidth="1.3" />}
      {Array.from({ length: flags }).map((_, i) => <path key={i} d={`M8.6 ${1.5 + i * 3.4} q 4 2 3.5 6`} fill="none" stroke="currentColor" strokeWidth="1.3" />)}
    </svg>
  )
}

const DURS = [WHOLE, WHOLE / 2, PPQ, PPQ / 2, PPQ / 4, PPQ / 8]
const DUR_KEY: Record<number, string> = { [WHOLE]: '7', [WHOLE / 2]: '6', [PPQ]: '5', [PPQ / 2]: '4', [PPQ / 4]: '3', [PPQ / 8]: '2' }
const DYNAMICS: Dynamic[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff']

export default function Toolbar({ project, onEditArpeggio, onTranspose }: { project: Project; onEditArpeggio: (partId: string, eventId: string) => void; onTranspose: () => void }) {
  const st = useProject()
  const part = project.score.parts.find((p) => p.id === st.cursor?.partId)
  const ev = part && st.cursor ? [st.cursor.measure, st.cursor.measure - 1].flatMap((mi) => part.measures[mi]?.events ?? []).find((e) => e.id === st.sel) : undefined
  const noteSel = !!ev && !ev.rest
  const fretted = !!part && isFretted(part.kind)
  const curDur = ev && !ev.rest ? ev.dur : st.dotted ? st.dur * 1.5 : st.dur
  const base = DURS.find((d) => d === curDur || d * 1.5 === curDur) ?? st.dur
  const dotted = curDur === base * 1.5
  const Btn = ({ on, title, onClick, children, disabled }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button className={cx('icon-btn shrink-0', on && 'on')} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>
  )
  const sep = <div className="w-px h-5 bg-line mx-1.5" />

  return (
    <div className="h-11 shrink-0 flex items-center px-3 gap-0.5 border-b border-line bg-panel/50 overflow-x-auto">
      <Btn title="Undo (Ctrl+Z)" onClick={st.undo} disabled={!st.past.length}><Undo2 size={16} /></Btn>
      <Btn title="Redo (Ctrl+Y)" onClick={st.redo} disabled={!st.future.length}><Redo2 size={16} /></Btn>
      {sep}
      {DURS.map((d) => <Btn key={d} on={base === d} title={`Duration (${DUR_KEY[d]})`} onClick={() => st.setDur(d)}><NoteGlyph base={d} /></Btn>)}
      <Btn on={dotted} title="Dot (.)" onClick={st.toggleDot}><span className="text-[18px] leading-none -mt-1">•</span></Btn>
      <button className={cx('icon-btn shrink-0', st.chordMode && 'on')} aria-label="Chord mode" aria-pressed={st.chordMode} aria-keyshortcuts={CHORD_SHORTCUT} title={`Chord mode (${CHORD_SHORTCUT}). Stack notes on the same beat. Press → to move on.`} onClick={st.toggleChordMode}><Layers size={16} /></button>
      <Btn on={!!ev?.arpeggio} title="Arpeggiate selected chord" disabled={!part || part.kind === 'drums' || (ev?.notes.length ?? 0) < 2} onClick={() => { if (part && ev) onEditArpeggio(part.id, ev.id) }}><Waves size={16} /></Btn>
      <Btn title="Rest (0)" onClick={st.enterRest}><NoteGlyph base={PPQ} rest /></Btn>
      <Btn on={!!ev?.tie} title="Tie (T)" onClick={st.toggleTie} disabled={!noteSel}><span className="text-[15px]">‿</span></Btn>
      {sep}
      <Btn on={!!ev?.art?.includes('staccato')} title="Staccato" disabled={!noteSel} onClick={() => st.toggleArt('staccato')}><span className="text-[20px] leading-none -mt-1.5">·</span></Btn>
      <Btn on={!!ev?.art?.includes('accent')} title="Accent" disabled={!noteSel} onClick={() => st.toggleArt('accent')}><span className="text-[14px]">&gt;</span></Btn>
      <Btn on={!!ev?.art?.includes('tenuto')} title="Tenuto" disabled={!noteSel} onClick={() => st.toggleArt('tenuto')}><span className="text-[14px] font-bold">–</span></Btn>
      <Btn on={!!ev?.art?.includes('marcato')} title="Marcato" disabled={!noteSel} onClick={() => st.toggleArt('marcato')}><span className="text-[13px]">^</span></Btn>
      <Btn on={!!ev?.art?.includes('fermata')} title="Fermata" disabled={!noteSel} onClick={() => st.toggleArt('fermata')}><span className="text-[15px]">𝄐</span></Btn>
      <Popover width={130} trigger={(t) => <button className={cx('btn-ghost !h-8 !px-2 font-display italic font-bold', ev?.dynamic && '!text-accent')} title="Dynamic" disabled={!noteSel} onClick={t}>{ev?.dynamic ?? 'mf'}</button>}>
        {(close) => <>{DYNAMICS.map((d) => <MenuItem key={d} onClick={() => { st.setDynamic(d); close() }}><span className="font-display italic font-bold">{d}</span></MenuItem>)}<MenuItem onClick={() => { st.setDynamic(null); close() }}>None</MenuItem></>}
      </Popover>
      {fretted && (
        <>
          {sep}
          {([['bend', 'Bend', 'b'], ['slide', 'Slide to next', '/'], ['hammer', 'Hammer-on / pull-off to next', 'h'], ['palmMute', 'Palm mute', 'P.M.'], ['harmonic', 'Natural harmonic', '◇'], ['vibrato', 'Vibrato', '∿']] as const).map(([k, title, label]) => (
            <Btn key={k} on={!!ev?.tech?.includes(k)} title={title} disabled={!noteSel} onClick={() => st.toggleTech(k)}><span className="text-[12px] font-semibold">{label}</span></Btn>
          ))}
          {ev?.tech?.includes('bend') && (
            <Select className="ml-1 [&_.field]:!h-7" width={84} value={ev.bend ?? 2} onChange={(v) => st.edit((s) => { const p = s.parts.find((x) => x.id === part!.id)!; for (const m of p.measures) for (const x of m.events) if (x.id === ev.id) x.bend = v })} options={[{ value: 1, label: '½' }, { value: 2, label: 'Full' }, { value: 3, label: '1½' }, { value: 4, label: '2' }]} />
          )}
        </>
      )}
      {sep}
      <Btn title="Semitone down (↓)" onClick={() => st.transposeSel(-1)} disabled={!noteSel && !st.range}><Minus size={15} /></Btn>
      <Btn title="Semitone up (↑)" onClick={() => st.transposeSel(1)} disabled={!noteSel && !st.range}><Plus size={15} /></Btn>
      <Btn title="Transpose score or selection" onClick={onTranspose}><ArrowUpDown size={16} /></Btn>
      {sep}
      <Btn title={st.noteSelection ? 'Copy selected notes (Ctrl+C)' : 'Copy measures (Ctrl+C)'} onClick={st.copy}><Copy size={15} /></Btn>
      <Btn title="Paste (Ctrl+V)" onClick={st.paste} disabled={!st.clipboard}><ClipboardPaste size={15} /></Btn>
      <Btn title="Insert measure after (Ctrl+Enter)" onClick={() => st.addMeasures((st.cursor?.measure ?? 0) + 1)}><ListPlus size={16} /></Btn>
      <Btn title="Delete measure(s)" onClick={st.removeMeasures}><ListX size={16} /></Btn>
      <div className="flex-1" />
      {st.noteSelection && <span className="text-[11.5px] text-accent whitespace-nowrap mr-2">{st.noteSelection.ids.length} selected</span>}
      {fretted && project.view?.mode !== 'staff' && <span className="text-[11.5px] text-faint mr-2 whitespace-nowrap">String {st.tabString} · type fret numbers</span>}
      <span className="text-[11.5px] text-faint whitespace-nowrap">{st.cursor ? `Bar ${st.cursor.measure + 1}` : ''}</span>
    </div>
  )
}
