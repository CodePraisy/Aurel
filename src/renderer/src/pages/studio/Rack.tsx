import { useEffect, useState } from 'react'
import { Download, Check, Loader2 } from 'lucide-react'
import type { Part } from '@shared/types'
import { packFor, type FxSlot, type PackStatus } from '@shared/sounds'
import { useProject } from '@/store/project'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { player, soundFor, fxFor } from '@/audio/player'
import { SOUNDS, soundLabel, type SoundId } from '@/audio/synth'
import { customSounds, swapFor } from '@/audio/custom'
import { Modal, cx } from '@/components/ui'
import FxChainEditor, { PluginControls, PluginProblem } from './FxChainEditor'
import { usePlayer } from './Transport'
import VstPicker from './VstPicker'

export default function Rack() {
  const { rackPart, project, updatePart } = useProject()
  const { jobs, track, toast, settings, updateSettings } = useApp()
  usePlayer()
  const [packs, setPacks] = useState<PackStatus[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [pickingInstrument, setPickingInstrument] = useState(false)
  const part = project?.score.parts.find((p) => p.id === rackPart)
  const downloading = Object.values(jobs).some((j) => (j.kind === 'sounds' || j.kind === 'tools') && !j.done)
  useEffect(() => { if (rackPart) void api.sounds.status().then(setPacks) }, [rackPart, downloading])
  if (!part) return null
  const close = () => useProject.setState({ rackPart: null })
  const sound = soundFor(part)
  const chain = fxFor(part)
  const liveTrack = player.trackFor(part.id)
  const status = player.status(part.id)
  const failure = (slotId: string) => status?.failures.find((f) => f.slotId === slotId)
  const saveDefault = async () => {
    await updateSettings({ fxDefaults: { ...(settings?.fxDefaults ?? {}), [sound]: chain } })
    updatePart(part.id, { fx: undefined })
    toast(`Saved as the default effects for ${SOUNDS.find((s) => s.id === sound)?.label ?? 'this instrument'}.`, 'ok')
  }
  const setChain = (fx: FxSlot[]) => updatePart(part.id, { fx })
  const packStatus = (id: string) => packs.find((p) => p.id === id)
  const choose = (id: string) => {
    updatePart(part.id, { sound: id, vstInstrument: undefined })
    setTimeout(() => player.preview({ ...part, sound: id, vstInstrument: undefined } as Part, part.kind === 'drums' ? 38 : part.clef === 'bass' ? 40 : 64, 100, 1.2), 50)
  }
  const download = async (ids: string[]) => { const { jobId } = await api.sounds.download(ids); track(jobId, 'Downloading instrument sounds') }

  return (
    <Modal open onClose={close} width={780} title={<span>Sound & effects <span className="text-muted font-sans text-[14px] ml-1">· {part.name}</span></span>}>
      <div className="grid grid-cols-[250px_1fr] gap-5">
        <div>
          <div className="label mb-2">Instrument</div>
          <label className="block mb-2"><div className="label mb-1">Track name</div><input key={part.id + part.name} className="field !h-8" defaultValue={part.name} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={(e) => {
            const name = e.currentTarget.value.trim()
            if (name && name !== part.name) updatePart(part.id, { name })
            else e.currentTarget.value = part.name
          }} /></label>
          {part.vstInstrument && <div className="rounded-xl bg-raised/40 border border-line p-2 mb-2">
            <div className="text-[13px] font-medium mb-2 flex items-center gap-1.5"><span className="truncate">{part.vstInstrument.plugin.name}</span> <span className="chip">VST3</span></div>
            {status?.loading && <p className="text-[12px] text-muted mb-2" role="status">Loading plug-in…</p>}
            {status?.error && <PluginProblem failure={{ path: '', name: part.vstInstrument.plugin.name, message: status.error, at: 0 }} />}
            <PluginProblem failure={failure('instrument')} crashed={status?.crashed.includes('instrument')} onRetry={() => player.retry(part.id)} />
            <PluginControls key={part.vstInstrument.plugin.id} configuration={part.vstInstrument} home={{ track: liveTrack, slotId: 'instrument' }} onChange={(vstInstrument) => updatePart(part.id, { vstInstrument })} />
          </div>}
          <button className="btn-soft w-full mb-2" aria-expanded={pickingInstrument} onClick={() => setPickingInstrument(!pickingInstrument)}>{part.vstInstrument ? 'Change VST3 instrument…' : 'Use a VST3 instrument…'}</button>
          {pickingInstrument && <div className="mb-2"><VstPicker kind="instrument" onPick={(vstInstrument) => {
            updatePart(part.id, { vstInstrument, playback: 'midi' })
            setPickingInstrument(false)
          }} /></div>}
          <div className="space-y-1 max-h-[280px] overflow-auto pr-1">
            {settings?.vstInstruments.map((preset) => <button key={preset.id} className="btn-ghost w-full !justify-start" title={preset.name} onClick={() => updatePart(part.id, { vstInstrument: preset.configuration, playback: 'midi' })}>
              <span className="truncate flex-1 text-left">{preset.name}</span><span className="text-faint text-[11px]">VST3</span>
            </button>)}
            {SOUNDS.filter((s) => s.id !== 'sine').map((s) => {
              const st = packStatus(s.id)
              const on = !part.vstInstrument && sound === s.id
              return (
                <div key={s.id} className={cx('flex items-center gap-2 px-2.5 h-9 rounded-lg cursor-pointer text-[13px]', on ? 'bg-accent/15 text-accent' : 'hover:bg-fg/[0.06]')} onClick={() => choose(s.id)}>
                  <span className="flex-1 truncate">{s.label}{swapFor(s.id) ? <span className="text-faint text-[11px]"> · plays {soundLabel(swapFor(s.id) as SoundId)}</span> : s.for.includes(part.kind) && !on ? <span className="text-faint text-[11px]"> · suggested</span> : null}</span>
                  {st && !st.ready && (downloading ? <Loader2 size={13} className="animate-spin text-faint" /> : <button className="icon-btn !h-6 !w-6" title={`Download ${packFor(s.id)?.label}`} onClick={(e) => { e.stopPropagation(); void download([s.id]) }}><Download size={13} /></button>)}
                  {st?.ready && on && <Check size={14} />}
                </div>
              )
            })}
            {customSounds().length > 0 && <div className="label pt-2 pb-1 px-1">Your instruments</div>}
            {customSounds().map((c) => {
              const id = `custom:${c.id}`
              const on = !part.vstInstrument && sound === id
              return (
                <div key={id} className={cx('flex items-center gap-2 px-2.5 h-9 rounded-lg cursor-pointer text-[13px]', on ? 'bg-accent/15 text-accent' : 'hover:bg-fg/[0.06]')} onClick={() => choose(id)}>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-faint text-[11px]">{c.samples.length} sample{c.samples.length === 1 ? '' : 's'}</span>
                  {on && <Check size={14} />}
                </div>
              )
            })}
          </div>
          <button className="btn-ghost w-full mt-1 !justify-start !text-[12px]" onClick={() => { close(); useApp.getState().go({ name: 'settings', section: 'sounds' }) }}>Add your own instrument…</button>
          {packs.some((p) => !p.ready) && <button className="btn-soft w-full mt-2" disabled={downloading} onClick={() => download(packs.filter((p) => !p.ready).map((p) => p.id))}><Download size={14} /> Download all sounds</button>}
          <p className="text-[11px] text-faint mt-2 leading-relaxed">Built-in instruments use recorded samples once downloaded.</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="label">Effects chain</div>
            <span className="chip">{part.fx ? 'Custom for this piece' : 'Instrument default'}</span>
          </div>
          <div className="space-y-2 max-h-[440px] overflow-auto pr-1">
            <FxChainEditor key={part.id} chain={chain} onChange={setChain} track={liveTrack} failures={status?.failures} crashed={status?.crashed} onRetry={() => player.retry(part.id)} />
            {status && !status.error && <p className="text-[12px] text-faint">Plug-ins run live: changes are heard right away.{status.latency ? ` Their ${Math.round((status.latency / (player.ctx?.sampleRate ?? 48000)) * 1000)} ms delay is compensated.` : ''}</p>}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button className="btn-ghost" disabled={!part.fx} title="Go back to the effects saved for this instrument" onClick={() => updatePart(part.id, { fx: undefined })}>Use instrument default</button>
            <button className="btn-ghost" disabled={!part.fx} title="Use this chain for every part with this instrument" onClick={() => void saveDefault()}>Save as instrument default</button>
            <button className="btn-soft" disabled={previewing} onClick={async () => {
              setPreviewing(true)
              try { await player.previewEffects(part, part.kind === 'drums' ? 36 : part.clef === 'bass' ? 40 : 60) }
              catch (e) { toast((e as Error).message, 'error') }
              finally { setPreviewing(false) }
            }}>{previewing ? 'Loading…' : 'Preview'}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

