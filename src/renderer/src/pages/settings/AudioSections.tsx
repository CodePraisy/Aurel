import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, FolderPlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { Settings } from '@shared/types'
import type { VstFailure, VstModule } from '@shared/sounds'
import { player } from '@/audio/player'
import { midi } from '@/audio/midi'
import { api } from '@/lib/api'
import { useApp } from '@/store/app'
import { useProject } from '@/store/project'
import { Select } from '@/components/menu'
import { cx, Toggle } from '@/components/ui'
import { usePlayer } from '../studio/Transport'

export function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-3.5 border-b border-line last:border-0">
      <div className="flex-1 min-w-0"><div className="font-medium">{title}</div>{desc && <div className="text-muted text-[12.5px] mt-0.5 leading-relaxed">{desc}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`

/** Sample rate, buffer size and the latency the device actually reports. */
export function DeviceFormat({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  usePlayer()
  useEffect(() => { player.wake() }, [s.sampleRate, s.bufferSize])
  const info = player.latencyInfo
  const rates: { v: Settings['sampleRate']; l: string }[] = [{ v: 0, l: 'Device' }, { v: 44100, l: '44.1 kHz' }, { v: 48000, l: '48 kHz' }, { v: 96000, l: '96 kHz' }]
  const sizes: Settings['bufferSize'][] = [128, 256, 512, 1024, 2048]
  const rate = info?.sampleRate ?? 48000
  return (
    <>
      <Row title="Sample rate" desc={<>Match your audio interface to avoid resampling. <b>Device</b> uses whatever Windows is set to{info ? ` (now ${info.sampleRate / 1000} kHz)` : ''}.</>}>
        <div className="seg">{rates.map((r) => <button key={r.v} className={cx(s.sampleRate === r.v && 'on')} onClick={() => set({ sampleRate: r.v })}>{r.l}</button>)}</div>
      </Row>
      <Row title="Buffer size" desc="Smaller feels tighter when you play a MIDI keyboard; larger avoids crackles on a busy computer.">
        <div className="seg">{sizes.map((n) => <button key={n} className={cx(s.bufferSize === n && 'on')} title={ms((n / rate) * 1000)} onClick={() => set({ bufferSize: n })}>{n}</button>)}</div>
      </Row>
      <Row title="Reported latency" desc="What the audio device reports, plus the time Aurel renders VST3 plug-ins ahead of playback. Playback timing is compensated; this is the delay you feel when playing live.">
        {info ? (
          <div className="text-right text-[12.5px] tabular-nums leading-relaxed">
            <div>Device buffer {ms(info.buffer)}</div>
            <div>Output {ms(info.output)}</div>
            <div className="text-muted">With VST3 plug-ins +{ms(info.plugins)}</div>
          </div>
        ) : <span className="text-muted text-[12.5px]">Measuring…</span>}
      </Row>
    </>
  )
}

/** USB and Bluetooth MIDI keyboards. */
export function MidiSection({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const [, force] = useState(0)
  useEffect(() => midi.subscribe(() => force((x) => x + 1)), [])
  useEffect(() => { void midi.start() }, [])
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 400); return () => clearInterval(t) }, [])
  const receiving = performance.now() - midi.lastMessage < 600
  const setMode = (inputMode: Settings['inputMode']) => { set({ inputMode }); useProject.getState().setInputMode(inputMode) }
  const chosenMissing = !!s.midiInput && !midi.devices.some((d) => d.id === s.midiInput)
  return (
    <>
      <h2 className="font-display text-[22px] mb-1">MIDI</h2>
      <p className="text-muted mb-4 leading-relaxed">Plug in a USB MIDI keyboard (or pair a Bluetooth one in Windows) and play. It is picked up automatically, even after Aurel has started.</p>
      {midi.error && <p role="alert" className="flex items-center gap-2 text-bad text-[12.5px] mb-3"><AlertTriangle size={14} className="shrink-0" /> <span className="flex-1">{midi.error}</span> <button className="btn-soft !h-7" onClick={() => void midi.start()}>Try again</button></p>}
      <Row title="Input device" desc={midi.devices.length ? `${midi.devices.length} connected.` : 'No MIDI devices found. Connect one and it will appear here.'}>
        <div className="flex items-center gap-3">
          <span className={cx('flex items-center gap-1.5 text-[12px]', receiving ? 'text-ok' : 'text-faint')} aria-live="polite"><span className={cx('h-2 w-2 rounded-full', receiving ? 'bg-ok' : 'bg-fg/20')} />{receiving ? 'Receiving' : 'Idle'}</span>
          <Select width={240} value={s.midiInput} onChange={(v) => set({ midiInput: v })} options={[
            { value: '', label: 'All MIDI inputs' },
            ...midi.devices.map((d) => ({ value: d.id, label: d.name })),
            ...(chosenMissing ? [{ value: s.midiInput, label: 'Disconnected device' }] : [])
          ]} />
        </div>
      </Row>
      <Row title="Input channel" desc="Listen to one channel when a keyboard sends on several (split or layered setups).">
        <Select width={140} value={String(s.midiChannel)} onChange={(v) => set({ midiChannel: Number(v) })} options={[{ value: '0', label: 'All channels' }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Channel ${i + 1}` }))]} />
      </Row>
      <Row title="Plays" desc="Which part the keyboard sounds like. It uses that part's instrument, VST3 plug-ins and effects.">
        <Select width={200} value={s.auditionTrack} onChange={(v) => set({ auditionTrack: v })} options={[
          { value: 'selected', label: 'The selected part' }, { value: 'first', label: 'Always the first part' }, { value: 'piano', label: 'Built-in grand piano' }
        ]} />
      </Row>
      <Row title="Notes you play" desc="Write adds them to the score at the cursor (keys pressed together become a chord). Play only lets you practise without writing. Switch any time in the studio.">
        <div className="seg">{(['write', 'play'] as const).map((m) => <button key={m} className={cx(s.inputMode === m && 'on')} onClick={() => setMode(m)}>{m === 'write' ? 'Write notes' : 'Play only'}</button>)}</div>
      </Row>
    </>
  )
}

/** Installed VST3 plug-ins: where Aurel looks, which are switched on, and which failed. */
export function PluginsSection({ s }: { s: Settings }) {
  const { updateSettings, toast } = useApp()
  const [catalog, setCatalog] = useState<{ available: boolean; roots: string[]; modules: (VstModule & { disabled: boolean })[] } | null>(null)
  const [failures, setFailures] = useState<VstFailure[]>([])
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const refresh = async () => {
    setBusy(true)
    try {
      const [found, failed] = await Promise.all([api.vst.scan(), api.vst.failures()])
      setCatalog(found)
      setFailures(failed)
    } catch (e) { toast((e as Error).message, 'error') }
    finally { setBusy(false) }
  }
  useEffect(() => { void refresh() }, [s.vstFolders.join('\n'), s.vstDisabled.join('\n')])
  const addFolder = async () => {
    const folder = await api.exporter.chooseFolder()
    if (!folder || s.vstFolders.some((path) => path.toLowerCase() === folder.toLowerCase())) return
    await updateSettings({ vstFolders: [...s.vstFolders, folder] })
  }
  const toggle = (path: string, on: boolean) => {
    const key = path.toLowerCase()
    void updateSettings({ vstDisabled: on ? s.vstDisabled.filter((p) => p !== key) : [...s.vstDisabled, key] })
  }
  const shown = (catalog?.modules ?? []).filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <>
      <h2 className="font-display text-[22px] mb-1">Plug-ins</h2>
      <p className="text-muted mb-4 leading-relaxed">Aurel uses the VST3 instruments and effects already installed on this computer. Each part runs its plug-ins in a separate process, so a plug-in that crashes cannot take Aurel down with it.</p>
      {catalog && !catalog.available && <p role="alert" className="flex items-center gap-2 text-bad text-[12.5px] mb-3"><AlertTriangle size={14} /> The VST3 host is not available in this build of Aurel.</p>}
      <div className="label mb-2">Search folders</div>
      <ul className="space-y-1 text-[12px] text-muted mb-3">
        {catalog?.roots.map((folder) => <li key={folder} className="flex items-center gap-2 bg-panel rounded-lg px-3 py-1.5">
          <span className="break-all flex-1">{folder}</span>
          {s.vstFolders.includes(folder) ? <button className="icon-btn !h-6 !w-6" title="Remove search folder" onClick={() => void updateSettings({ vstFolders: s.vstFolders.filter((path) => path !== folder) })}><Trash2 size={13} /></button> : <span className="text-faint text-[11px]">Standard</span>}
        </li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button className="btn-soft" onClick={() => void addFolder()}><FolderPlus size={14} /> Add search folder</button>
        <button className="btn-ghost" disabled={busy} onClick={() => void refresh()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Rescan</button>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="label">Installed ({catalog?.modules.length ?? 0})</div>
        {(catalog?.modules.length ?? 0) > 8 && <input className="field !h-7 !w-48" aria-label="Filter plug-ins" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />}
      </div>
      <div className="card divide-y divide-line mb-6 max-h-[360px] overflow-auto">
        {shown.map((m) => (
          <div key={m.path} className="flex items-center gap-3 px-4 h-11">
            <span className={cx('flex-1 truncate', m.disabled && 'text-faint line-through')} title={m.path}>{m.name}</span>
            {failures.some((f) => f.path.toLowerCase() === m.path.toLowerCase()) && <span className="chip !text-bad" title="See failed plug-ins below">Failed</span>}
            <Toggle on={!m.disabled} onChange={(on) => toggle(m.path, on)} />
          </div>
        ))}
        {catalog && !shown.length && <div className="px-4 py-3 text-muted text-[12.5px]">{catalog.modules.length ? 'No plug-ins match.' : 'No VST3 plug-ins found in these folders.'}</div>}
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="label">Failed to load</div>
        {!!failures.length && <button className="btn-ghost !h-7" onClick={async () => { await api.vst.clearFailures(); setFailures([]) }}>Clear list</button>}
      </div>
      {failures.length ? (
        <div className="card divide-y divide-line">
          {failures.map((f) => (
            <div key={f.path + f.name + f.at} className="px-4 py-2.5">
              <div className="flex items-center gap-2"><AlertTriangle size={13} className="text-bad shrink-0" /><span className="font-medium truncate">{f.name}</span><span className="text-faint text-[11px] ml-auto shrink-0">{new Date(f.at).toLocaleString()}</span></div>
              <div className="text-muted text-[12px] mt-0.5 break-words">{f.message}</div>
              {f.path && <div className="text-faint text-[11px] break-all">{f.path}</div>}
            </div>
          ))}
        </div>
      ) : <p className="flex items-center gap-2 text-[12.5px] text-muted"><Check size={14} className="text-ok" /> No plug-in has failed.</p>}
    </>
  )
}

export function EffectTails({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return <Row title="Effect tails after stopping" desc="Let reverb and delay ring out when you pause or stop. Turn off to cut to silence immediately."><Toggle on={s.effectTails} onChange={(v) => set({ effectTails: v })} /></Row>
}
