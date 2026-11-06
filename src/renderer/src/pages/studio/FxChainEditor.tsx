import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, Plus, Power, RotateCcw, Trash2 } from 'lucide-react'
import { FX_DEFS, newFx, orderChain, type FxSlot, type FxType, type VstConfiguration, type VstFailure, type VstParameter } from '@shared/sounds'
import { api } from '@/lib/api'
import { Select } from '@/components/menu'
import { cx, Slider } from '@/components/ui'
import { uid } from '@/music/score'
import VstPicker from './VstPicker'

const effects = (Object.keys(FX_DEFS) as FxType[]).map((value) => ({ value, label: FX_DEFS[value].label }))
const plain = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function format(value: number, unit?: string): string {
  if (unit === 'Hz') return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))
  return `${Number(value.toFixed(2))}${unit ?? ''}`
}

/** Where a plug-in lives: the part's live track (heard while you edit) or nowhere yet (Settings defaults). */
export interface PluginHome { track: string | null; slotId: string }

function QuickParameters({ configuration, home, onChange }: { configuration: VstConfiguration; home: PluginHome; onChange: (next: VstConfiguration) => void }) {
  const [parameters, setParameters] = useState<VstParameter[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    setBusy(true)
    setError('')
    try { setParameters(await api.vst.parameters(home.track, home.slotId, configuration.plugin)) }
    catch (e) { setError(plain(e as Error)) }
    finally { setBusy(false) }
  }
  if (!parameters) return (
    <div>
      <button className="btn-ghost !h-7" disabled={busy} onClick={() => void load()}>{busy ? 'Reading controls…' : 'Show controls'}</button>
      {error && <p className="text-bad text-[12px] mt-1" role="alert">{error}</p>}
    </div>
  )
  const matching = parameters.filter((p) => p.label.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="space-y-2">
      {parameters.length > 12 && <input className="field !h-7" aria-label="Filter plug-in controls" placeholder="Filter controls…" value={query} onChange={(e) => setQuery(e.target.value)} />}
      <div className="max-h-52 overflow-auto space-y-1.5">
        {matching.slice(0, 64).map((p) => {
          const value = configuration.params[p.id] ?? p.value
          return <label key={p.id} className="flex gap-2 items-center text-[11.5px]">
            <span className="w-28 shrink-0 truncate text-muted" title={p.label}>{p.label}</span>
            <Slider title={p.label} value={value} min={0} max={1} step={p.steps > 0 ? 1 / p.steps : 0.01} onChange={(v) => onChange({ ...configuration, params: { ...configuration.params, [p.id]: v } })} />
            <span className="w-9 shrink-0 text-right text-faint tabular-nums">{Math.round(100 * value)}%</span>
          </label>
        })}
      </div>
      {!matching.length && <p className="text-muted text-[12px]">{parameters.length ? 'No matching controls.' : 'This plug-in exposes no editable controls.'}</p>}
      {matching.length > 64 && <p className="text-faint text-[12px]">Use the filter to find more controls.</p>}
    </div>
  )
}

export function PluginControls({ configuration, home, onChange, onSave, autoOpen }: {
  configuration: VstConfiguration; home: PluginHome; onChange: (next: VstConfiguration) => void; onSave?: (next: VstConfiguration) => void; autoOpen?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const didOpen = useRef(false)
  const latest = useRef(configuration)
  latest.current = configuration
  const edit = async () => {
    setEditing(true)
    setMessage(null)
    try {
      const saved = await api.vst.edit(home.track, home.slotId, latest.current, configuration.plugin.name)
      if (onSave) onSave(saved)
      else onChange(saved)
      setMessage({ text: 'Plug-in settings saved with this piece.' })
    } catch (e) {
      setMessage({ text: plain(e as Error), error: true })
    } finally { setEditing(false) }
  }
  useEffect(() => {
    if (autoOpen && !didOpen.current) {
      didOpen.current = true
      void edit()
    }
  }, [autoOpen])
  return (
    <div className="space-y-2">
      <button className="btn-soft !h-7" onClick={() => void edit()} title={editing ? 'Bring the plug-in window to the front' : undefined}>
        <ExternalLink size={13} /> {editing ? 'Show plug-in window' : 'Open plug-in editor'}
      </button>
      {editing && <p className="text-[12px] text-muted" role="status">{home.track ? 'Changes are heard as you make them. They are saved when you close the plug-in window.' : 'Close the plug-in window to save its settings.'}</p>}
      {message && <p className={cx('text-[12px]', message.error ? 'text-bad' : 'text-muted')} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {!editing && <QuickParameters configuration={configuration} home={home} onChange={onChange} />}
    </div>
  )
}

export function PluginProblem({ failure, crashed, onRetry }: { failure?: VstFailure; crashed?: boolean; onRetry?: () => void }) {
  if (!failure && !crashed) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-bad/[0.08] text-bad text-[12px] px-2.5 py-2 mb-2">
      <AlertTriangle size={14} className="shrink-0 mt-px" />
      <span className="flex-1">{crashed ? 'This plug-in crashed and was taken out of the chain.' : `Not loaded: ${failure!.message}`} It is silent until fixed; Aurel does not swap in another sound.</span>
      {onRetry && <button className="btn-ghost !h-6 !px-2 !text-bad" onClick={onRetry}><RotateCcw size={12} /> Try again</button>}
    </div>
  )
}

export default function FxChainEditor({ chain: unordered, onChange, onNativeSave, track = null, failures = [], crashed = [], onRetry }: {
  chain: FxSlot[]; onChange: (chain: FxSlot[]) => void; onNativeSave?: (chain: FxSlot[]) => void
  track?: string | null; failures?: VstFailure[]; crashed?: string[]; onRetry?: () => void
}) {
  // VST3 effects always run before Aurel's built-in ones (the same in playback and export)
  const chain = orderChain(unordered)
  const [picking, setPicking] = useState(false)
  const [autoOpen, setAutoOpen] = useState<string | null>(null)
  const latest = useRef(chain)
  latest.current = chain
  const patch = (slot: FxSlot) => onChange(latest.current.map((s) => s.id === slot.id ? slot : s))
  const move = (index: number, offset: number) => {
    const next = [...chain]
    const [slot] = next.splice(index, 1)
    next.splice(index + offset, 0, slot)
    onChange(next)
  }
  const kind = (s: FxSlot | undefined) => (s?.type === 'vst3' ? 'vst' : 'builtin')
  const hasBoth = chain.some((s) => s.type === 'vst3') && chain.some((s) => s.type !== 'vst3')
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select width={180} value="" options={[{ value: '', label: 'Add built-in effect' }, ...effects]} onChange={(type) => {
          if (type) onChange([...chain, newFx(type as FxType)])
        }} />
        <button className="btn-soft" onClick={() => setPicking(!picking)} aria-expanded={picking}><Plus size={14} /> Add VST3 effect</button>
      </div>
      {picking && <VstPicker kind="effect" onPick={(configuration) => {
        const id = uid('fx')
        onChange(orderChain([...latest.current, { ...configuration, id, type: 'vst3', on: true }]))
        setAutoOpen(id)
        setPicking(false)
      }} />}
      {hasBoth && <p className="text-[11.5px] text-faint">VST3 effects run first, then the built-in effects.</p>}
      {chain.map((slot, i) => (
        <div key={slot.id} className={cx('rounded-xl border p-3', slot.on ? 'border-line bg-raised/40' : 'border-line/60 opacity-55')}>
          <div className="flex items-center gap-1.5 mb-2">
            <button className={cx('icon-btn !h-7 !w-7', slot.on && 'on')} title={slot.on ? 'Bypass' : 'Enable'} aria-pressed={slot.on} onClick={() => patch({ ...slot, on: !slot.on })}><Power size={14} /></button>
            <span className="font-medium text-[13px] flex-1 truncate">{slot.type === 'vst3' ? slot.plugin.name : FX_DEFS[slot.type].label}</span>
            {slot.type === 'vst3' && <span className="chip">VST3</span>}
            <button className="icon-btn !h-7 !w-7" title="Move effect up" disabled={i === 0 || kind(chain[i - 1]) !== kind(slot)} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
            <button className="icon-btn !h-7 !w-7" title="Move effect down" disabled={i === chain.length - 1 || kind(chain[i + 1]) !== kind(slot)} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
            <button className="icon-btn !h-7 !w-7 hover:!text-bad" title="Remove effect" onClick={() => onChange(chain.filter((s) => s.id !== slot.id))}><Trash2 size={14} /></button>
          </div>
          {slot.type === 'vst3' ? <>
            <PluginProblem failure={failures.find((f) => f.slotId === slot.id)} crashed={crashed.includes(slot.id)} onRetry={onRetry} />
            <PluginControls configuration={slot} home={{ track, slotId: slot.id }} autoOpen={autoOpen === slot.id} onChange={(configuration) => patch({ ...slot, ...configuration })} onSave={(configuration) => {
              if (!latest.current.some((entry) => entry.id === slot.id)) return
              const next = latest.current.map((entry) => entry.id === slot.id ? { ...entry, ...configuration } : entry)
              onChange(next)
              onNativeSave?.(next)
            }} />
          </> : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {FX_DEFS[slot.type].params.map((d) => {
                const value = slot.params[d.k] ?? d.def
                return <label key={d.k} className="flex items-center gap-2 text-[11.5px]">
                  <span className="w-[64px] shrink-0 text-muted truncate" title={d.label}>{d.label}</span>
                  <Slider title={d.label} value={value} min={d.min} max={d.max} step={d.step} onChange={(v) => patch({ ...slot, params: { ...slot.params, [d.k]: v } })} />
                  <span className="w-12 shrink-0 text-right tabular-nums text-faint">{d.k === 'mode' ? (value >= 0.5 ? 'HP' : 'LP') : d.k === 'cab' ? (value >= 0.5 ? 'On' : 'Off') : format(value, d.unit)}</span>
                </label>
              })}
            </div>
          )}
        </div>
      ))}
      {!chain.length && <p className="text-faint text-[12px] text-center border border-dashed border-line rounded-xl p-4">No effects. Add a built-in effect or one of your VST3 plug-ins.</p>}
    </div>
  )
}
