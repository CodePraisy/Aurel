import { useEffect, useState } from 'react'
import { AlertTriangle, SlidersHorizontal, Copy, Piano, Guitar, Drum, Mic2, Music, AudioLines, Waves, MoreHorizontal, Plus, ArrowUp, ArrowDown, Trash2, Pencil, Layers, Headphones, SplitSquareHorizontal, GripVertical } from 'lucide-react'
import type { InstrumentKind, Part, Project } from '@shared/types'
import { useProject } from '@/store/project'
import { useApp } from '@/store/app'
import { player, soundFor } from '@/audio/player'
import { SOUNDS } from '@/audio/synth'
import { INSTRUMENTS, TUNINGS, isFretted, midiName } from '@/music/theory'
import { cx, Slider, Modal, Popover, MenuItem, Confidence } from '@/components/ui'
import { openContextMenu, type MenuEntry } from '@/components/menu'
import { uid } from '@/music/score'
import { ADDABLE } from '../Dialogs'
import VstPicker from './VstPicker'

export function familyIcon(kind: InstrumentKind, size = 15) {
  const f = INSTRUMENTS[kind].family
  if (f === 'keys') return <Piano size={size} />
  if (f === 'guitar' || f === 'bass') return <Guitar size={size} />
  if (f === 'drums') return <Drum size={size} />
  if (f === 'voice') return <Mic2 size={size} />
  if (f === 'synth') return <Waves size={size} />
  return <Music size={size} />
}

export function partRemovalActions(part: Part): MenuEntry[] {
  const remove = (label: string, group: boolean): MenuEntry => ({
    label, icon: <Trash2 size={14} />, danger: true, onClick: () => useProject.getState().removePart(part.id, group)
  })
  return part.group ? [remove('Remove this staff', false), remove('Remove both staves', true)] : [remove('Remove instrument', true)]
}

/** Loading / failed state of a part's VST3 plug-ins; clicking opens its sound rack. */
function PluginBadge({ part }: { part: Part }) {
  const status = player.status(part.id)
  if (!status) return null
  const problem = status.error ?? (status.failures.length ? `${status.failures.map((f) => f.name).join(', ')} did not load` : status.crashed.length ? 'A plug-in crashed' : null)
  if (status.loading) return <span className="chip shrink-0" title="Loading VST3 plug-ins">Loading…</span>
  if (!problem) return <span className="chip shrink-0" title="Plays through VST3 plug-ins">VST3</span>
  return (
    <button className="chip shrink-0 !text-bad !bg-bad/10 inline-flex items-center gap-1" title={`${problem}. Open Sound & effects for details.`} onClick={(e) => { e.stopPropagation(); useProject.setState({ rackPart: part.id }) }}>
      <AlertTriangle size={11} /> Plug-in problem
    </button>
  )
}

function usePlayerOpts() {
  const [, force] = useState(0)
  useEffect(() => player.subscribe(() => force((x) => x + 1)), [])
  return player.opts
}

export default function PartsPanel({ project }: { project: Project }) {
  const st = useProject()
  const opts = usePlayerOpts()
  const soloFollowsView = useApp((s) => s.settings?.soloFollowsView)
  const view = project.view?.part ?? 'all'
  const [renaming, setRenaming] = useState<string | null>(null)
  const [addingVst, setAddingVst] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null)
  const parts = project.score.parts

  const selectPart = (p: Part | 'all') => {
    st.patchProject((next) => {
      next.view = { mode: 'both', zoom: 1, ...next.view, part: p === 'all' ? 'all' : p.id }
      if (soloFollowsView) for (const part of next.score.parts) {
        part.solo = p !== 'all' && (part.id === p.id || (!!p.group && p.group === part.group))
      }
    })
    if (p !== 'all') st.select(p.id, st.cursor?.measure ?? 0, p.measures[st.cursor?.measure ?? 0]?.events[0]?.id ?? null, 0)
  }
  const toggleSolo = (p: Part) => st.patchProject((next) => {
    for (const part of next.score.parts) {
      if (part.id === p.id || (p.group && p.group === part.group)) part.solo = !p.solo
    }
  })

  const addMenu: MenuEntry = { label: 'Add instrument', icon: <Plus size={14} />, submenu: [
    ...ADDABLE.map((k) => ({ label: INSTRUMENTS[k].label, onClick: () => st.addPart(k) })),
    { separator: true }, { label: 'Add VST3 instrument…', onClick: () => setAddingVst(true) }
  ] }
  const partMenu = (p: Part): MenuEntry[] => [
    { label: 'Rename', icon: <Pencil size={14} />, onClick: () => setRenaming(p.id) },
    { label: 'Sound & effects…', icon: <SlidersHorizontal size={14} />, onClick: () => useProject.setState({ rackPart: p.id }) },
    { label: 'Instrument type', icon: familyIcon(p.kind, 14), submenu: ADDABLE.map((k) => ({ label: INSTRUMENTS[k].label, checked: k === p.kind, onClick: () => { const def = INSTRUMENTS[k]; st.updatePart(p.id, { kind: k, sound: undefined, clef: p.group ? p.clef : def.clef, tuning: def.tuning ? [...def.tuning] : undefined }) } })) },
    { label: p.mute ? 'Unmute' : 'Mute', onClick: () => st.updatePart(p.id, { mute: !p.mute }) },
    { label: p.solo ? 'Unsolo' : 'Solo', onClick: () => toggleSolo(p) },
    { separator: true },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => st.edit((sc) => {
      const i = sc.parts.findIndex((x) => x.id === p.id)
      const group = p.group ? uid('g') : undefined
      const block = p.group ? sc.parts.filter((x) => x.group === p.group) : [sc.parts[i]]
      const copies = block.map((b) => ({ ...structuredClone(b), id: uid('p'), name: `${b.name} (copy)`, group, stem: undefined, playback: 'midi' as const }))
      sc.parts.splice(sc.parts.indexOf(block[block.length - 1]) + 1, 0, ...copies)
    }) },
    { label: 'Move up', icon: <ArrowUp size={14} />, onClick: () => st.movePart(p.id, -1) },
    { label: 'Move down', icon: <ArrowDown size={14} />, onClick: () => st.movePart(p.id, 1) },
    { separator: true },
    addMenu,
    ...partRemovalActions(p)
  ]

  return (
    <div className="h-full flex flex-col" onContextMenu={(e) => openContextMenu(e, [addMenu])}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="label">Instruments</span>
        <Popover align="right" width={210} trigger={(t) => <button className="icon-btn !h-7 !w-7" title="Add instrument" onClick={t}><Plus size={15} /></button>}>
          {(close) => <>
            <MenuItem onClick={() => { close(); setAddingVst(true) }}>Add VST3 instrument…</MenuItem>
            {ADDABLE.map((k) => <MenuItem key={k} icon={familyIcon(k, 14)} onClick={() => { st.addPart(k); close() }}>{INSTRUMENTS[k].label}</MenuItem>)}
          </>}
        </Popover>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-3 space-y-1">
        {parts.length > 1 && (
          <button onClick={() => selectPart('all')} className={cx('w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px]', view === 'all' ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-fg/[0.05] hover:text-fg')}>
            <Layers size={15} /> Full score
          </button>
        )}
        {project.audio && (
          <div className="rounded-xl px-2.5 py-2 bg-fg/[0.03]">
            <div className="flex items-center gap-2">
              <AudioLines size={15} className="text-muted" />
              <span className="flex-1 text-[13px]">Original mix</span>
              <label className="flex items-center gap-0.5 text-[12px] text-muted tabular-nums">
                <input
                  key={opts.mix.volume} aria-label="Original mix volume percent" type="number" min={0} max={120} step={1}
                  className="field !h-6 !w-11 !px-1 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  defaultValue={Math.round(opts.mix.volume * 100)} onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') e.currentTarget.value = String(Math.round(player.opts.mix.volume * 100))
                    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                  }}
                  onBlur={(e) => {
                    const raw = e.currentTarget.valueAsNumber
                    const percent = Number.isFinite(raw) ? Math.max(0, Math.min(120, Math.round(raw))) : Math.round(player.opts.mix.volume * 100)
                    e.currentTarget.value = String(percent)
                    if (percent / 100 !== player.opts.mix.volume) player.setOptions({ mix: { ...player.opts.mix, volume: percent / 100 } })
                  }}
                />%
              </label>
              <button className={cx('icon-btn !h-6 !w-6 text-[11px] font-bold', !opts.mix.on && 'on !text-bad !bg-bad/10')} aria-pressed={!opts.mix.on} title="Mute original mix" onClick={() => player.setOptions({ mix: { ...opts.mix, on: !opts.mix.on } })}>M</button>
            </div>
            <Slider className="mt-1" value={opts.mix.volume} min={0} max={1.2} title="Original mix volume" onChange={(v) => player.setOptions({ mix: { ...opts.mix, volume: v } })} />
          </div>
        )}
        {parts.map((p, i) => {
          const active = view === p.id || (view !== 'all' && parts.find((x) => x.id === view)?.group === p.group && !!p.group)
          const groupHead = !p.group || parts.findIndex((x) => x.group === p.group) === i
          const from = parts.find((x) => x.id === dragging)
          const canDrop = from && from.id !== p.id && (!from.group || from.group !== p.group)
          return (
            <div key={p.id} onContextMenu={(e) => openContextMenu(e, partMenu(p))}
              onDragOver={(e) => {
                if (!canDrop) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect()
                setDropTarget({ id: p.id, after: e.clientY >= r.top + r.height / 2 })
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((target) => target?.id === p.id ? null : target) }}
              onDrop={(e) => {
                if (!canDrop) return
                e.preventDefault()
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                st.reorderPart(from.id, p.id, e.clientY >= r.top + r.height / 2)
                setDragging(null)
                setDropTarget(null)
              }}
              className={cx('group relative rounded-xl px-2.5 py-2 transition-colors', active ? 'bg-accent/[0.09] ring-1 ring-accent/30' : 'hover:bg-fg/[0.04]', !groupHead && '-mt-0.5')}>
              {dropTarget?.id === p.id && <div className={cx('pointer-events-none absolute inset-x-1 h-0.5 rounded bg-accent', dropTarget.after ? 'bottom-0' : 'top-0')} />}
              <div className="flex items-center gap-2">
                <span className="cursor-grab text-faint hover:text-accent active:cursor-grabbing -ml-1" title="Drag to reorder instrument" draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-aurel-instrument', p.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging(p.id)
                  }} onDragEnd={() => { setDragging(null); setDropTarget(null) }}><GripVertical size={14} /></span>
                <button className={cx('shrink-0', active ? 'text-accent' : 'text-muted')} aria-label={`Show ${p.name}`} title={`Show ${p.name}`} onClick={() => selectPart(p)}>{familyIcon(p.kind)}</button>
                <div className="flex-1 min-w-0" onClick={() => selectPart(p)}>
                  {renaming === p.id ? (
                    <input autoFocus className="field !h-6 !px-1.5 !text-[12.5px]" defaultValue={p.name} onBlur={(e) => { st.updatePart(p.id, { name: e.target.value.trim() || p.name }); setRenaming(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} />
                  ) : (
                    <div className="text-[13px] font-medium truncate cursor-default" onDoubleClick={() => setRenaming(p.id)}>{p.name}</div>
                  )}
                  <div className="flex items-center gap-1.5 text-[11px] text-faint">
                    <span className="truncate">{p.vstInstrument?.plugin.name ?? SOUNDS.find((s) => s.id === soundFor(p))?.label}</span>
                    <PluginBadge part={p} />
                    {p.classification && <Confidence value={p.classification.confidence} />}
                  </div>
                </div>
                <button className={cx('icon-btn !h-6 !w-6 text-[11px] font-bold', p.mute && 'on !text-bad !bg-bad/10')} title="Mute" onClick={() => st.updatePart(p.id, { mute: !p.mute })}>M</button>
                <button className={cx('icon-btn !h-6 !w-6 text-[11px] font-bold', p.solo && 'on')} aria-pressed={p.solo} title={p.solo ? 'Unsolo' : 'Solo'} onClick={() => toggleSolo(p)}>S</button>
                <PartMenu part={p} onRename={() => setRenaming(p.id)} compare={opts.compare === p.id} />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider value={p.volume} min={0} max={1} onChange={(v) => st.updatePart(p.id, { volume: v })} title="Volume" />
                {p.stem && (
                  <div className="seg !p-[1px] shrink-0">
                    <button className={cx('!h-5 !px-1.5 !text-[10.5px]', p.playback === 'audio' && 'on')} title="Play the AI-isolated recording" onClick={() => st.updatePart(p.id, { playback: 'audio' })}>Audio</button>
                    <button className={cx('!h-5 !px-1.5 !text-[10.5px]', p.playback === 'midi' && 'on')} title="Play the transcribed notes" onClick={() => st.updatePart(p.id, { playback: 'midi' })}>MIDI</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {parts.length === 0 && <p className="text-faint text-[12px] px-2.5 py-2 leading-relaxed">No notation parts yet. Transcribe with AI or add an instrument to write your own part along with the recording.</p>}
      </div>
      {addingVst && <Modal open title="Add VST3 instrument" onClose={() => setAddingVst(false)} width={420}>
        <VstPicker kind="instrument" onPick={(configuration) => {
          st.addPart('synth', { name: configuration.plugin.name, vstInstrument: configuration })
          setAddingVst(false)
        }} />
      </Modal>}
    </div>
  )
}

function PartMenu({ part, onRename, compare }: { part: Part; onRename: () => void; compare: boolean }) {
  const st = useProject()
  const [sub, setSub] = useState<null | 'kind' | 'sound' | 'tuning' | 'pan'>(null)
  return (
    <Popover align="right" width={250} trigger={(t, open) => <button className={cx('icon-btn !h-6 !w-6', !open && 'opacity-0 group-hover:opacity-100')} onClick={() => { setSub(null); t() }}><MoreHorizontal size={15} /></button>}>
      {(close) => {
        if (sub === 'kind') return <div className="max-h-[320px] overflow-auto">{ADDABLE.map((k) => (
          <MenuItem key={k} icon={familyIcon(k, 14)} onClick={() => {
            const def = INSTRUMENTS[k]
            st.updatePart(part.id, { kind: k, sound: undefined, clef: part.group ? part.clef : def.clef, tuning: def.tuning ? (isFretted(part.kind) && part.tuning?.length && INSTRUMENTS[part.kind].family === def.family ? part.tuning : [...def.tuning]) : undefined, classification: part.classification ? { ...part.classification, label: k, confidence: 1 } : undefined })
            close()
          }}>{INSTRUMENTS[k].label}{k === part.kind ? ' ✓' : ''}</MenuItem>
        ))}</div>
        if (sub === 'sound') return <div className="max-h-[320px] overflow-auto">{SOUNDS.map((s) => (
          <MenuItem key={s.id} onClick={() => { st.updatePart(part.id, { sound: s.id, vstInstrument: undefined }); player.preview({ ...part, sound: s.id, vstInstrument: undefined }, part.kind === 'drums' ? 38 : part.clef === 'bass' ? 43 : 64); close() }} hint={s.for.includes(part.kind) ? 'suggested' : ''}>{s.label}{!part.vstInstrument && soundFor(part) === s.id ? ' ✓' : ''}</MenuItem>
        ))}</div>
        if (sub === 'tuning') return (
          <div className="p-1">
            {Object.entries(TUNINGS).filter(([, t]) => t.for === (INSTRUMENTS[part.kind].family === 'bass' ? 'bass' : 'guitar')).map(([k, t]) => (
              <MenuItem key={k} onClick={() => { st.edit((s) => { s.parts.find((x) => x.id === part.id)!.tuning = [...t.strings]; }); close() }} hint={t.strings.map((x) => midiName(x).replace(/\d/, '')).reverse().join('')}>{t.name}</MenuItem>
            ))}
            <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
              <span className="text-[12.5px] flex-1">Capo</span>
              <input type="number" min={0} max={12} className="field !h-7 !w-16" value={part.capo ?? 0} onChange={(e) => st.edit((s) => { s.parts.find((x) => x.id === part.id)!.capo = Math.max(0, Math.min(12, +e.target.value || 0)) })} />
            </div>
          </div>
        )
        if (sub === 'pan') return (
          <div className="p-2.5">
            <div className="flex justify-between text-[12px] text-muted mb-1"><span>L</span><span>Pan {Math.round(part.pan * 100)}</span><span>R</span></div>
            <Slider value={part.pan} min={-1} max={1} onChange={(v) => st.updatePart(part.id, { pan: Math.abs(v) < 0.04 ? 0 : v })} />
          </div>
        )
        return (
          <>
            <MenuItem icon={<Pencil size={14} />} onClick={() => { onRename(); close() }}>Rename</MenuItem>
            <MenuItem icon={familyIcon(part.kind, 14)} onClick={() => setSub('kind')} hint={INSTRUMENTS[part.kind].label}>Instrument type</MenuItem>
            <MenuItem icon={<SlidersHorizontal size={14} />} onClick={() => { useProject.setState({ rackPart: part.id }); close() }}>Sound & effects…</MenuItem>
            <MenuItem icon={<Music size={14} />} onClick={() => setSub('sound')}>Quick sound change</MenuItem>
            {isFretted(part.kind) && <MenuItem icon={<Guitar size={14} />} onClick={() => setSub('tuning')} hint={part.capo ? `capo ${part.capo}` : ''}>Tuning & capo</MenuItem>}
            <MenuItem icon={<Headphones size={14} />} onClick={() => setSub('pan')}>Pan</MenuItem>
            {part.stem && <MenuItem icon={<SplitSquareHorizontal size={14} />} onClick={() => { player.setOptions({ compare: compare ? null : part.id }); close() }} hint="audio L · MIDI R">{compare ? 'Stop comparing' : 'Compare with recording'}</MenuItem>}
            {part.classification && (
              <div className="px-2.5 py-1.5 text-[11.5px] text-faint leading-relaxed">
                AI guessed <b className="text-muted">{INSTRUMENTS[part.classification.label as InstrumentKind]?.label ?? part.classification.label}</b> ({Math.round(part.classification.confidence * 100)}%)
                {part.classification.traits?.tone ? ` · ${part.classification.traits.tone}` : ''}{part.classification.traits?.panning ? ` · ${part.classification.traits.panning}` : ''}
              </div>
            )}
            <div className="h-px bg-line my-1" />
            <MenuItem icon={<ArrowUp size={14} />} onClick={() => { st.movePart(part.id, -1); close() }}>Move up</MenuItem>
            <MenuItem icon={<ArrowDown size={14} />} onClick={() => { st.movePart(part.id, 1); close() }}>Move down</MenuItem>
            {partRemovalActions(part).map((action) => <MenuItem key={action.label} icon={action.icon} danger onClick={() => { action.onClick?.(); close() }}>{action.label}</MenuItem>)}
          </>
        )
      }}
    </Popover>
  )
}
