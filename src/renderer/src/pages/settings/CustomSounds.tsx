import { useState } from 'react'
import { Loader2, Play, Plus, Trash2, X } from 'lucide-react'
import { noteFromName, type CustomSound } from '@shared/sounds'
import { api } from '@/lib/api'
import { useApp } from '@/store/app'
import { player } from '@/audio/player'
import { SOUNDS, type SoundId } from '@/audio/synth'
import { Select } from '@/components/menu'
import { midiName } from '@/music/theory'

const plain = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** "Grand Piano C4.wav" -> "Grand Piano" */
function nameFromFile(path: string): string {
  const base = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
  return base.replace(/[\s_-]*([A-Ga-g](#|b|s)?-?\d|\d{2,3})$/, '').replace(/[_-]+/g, ' ').trim() || 'My instrument'
}

function Instrument({ sound }: { sound: CustomSound }) {
  const { settings, updateSettings, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const id = `custom:${sound.id}` as SoundId
  const swaps = settings?.soundSwaps ?? {}
  const replaces = Object.entries(swaps).find(([, c]) => c === sound.id)?.[0] ?? ''
  const save = (next: CustomSound) => updateSettings({ customSounds: (settings?.customSounds ?? []).map((c) => (c.id === sound.id ? next : c)) })
  const setSwap = (builtin: string) => {
    const next = Object.fromEntries(Object.entries(swaps).filter(([b, c]) => c !== sound.id && b !== builtin))
    if (builtin) next[builtin] = sound.id
    void updateSettings({ soundSwaps: next })
  }
  const addSamples = async () => {
    const files = await api.sounds.pickSamples()
    if (!files.length) return
    setBusy(true)
    try { useApp.setState({ settings: await api.sounds.addCustom(sound.name, files, sound.id) }) }
    catch (e) { toast(plain(e as Error), 'error') }
    finally { setBusy(false) }
  }
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <input className="field !h-8 flex-1 font-medium" aria-label="Instrument name" defaultValue={sound.name} key={sound.name}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          onBlur={(e) => { const name = e.currentTarget.value.trim(); if (name && name !== sound.name) void save({ ...sound, name }); else e.currentTarget.value = sound.name }} />
        <button className="btn-soft !h-8" onClick={() => void player.previewSound(id, [60, 64, 67])}><Play size={13} /> Play</button>
        {confirming
          ? <button className="btn-danger !h-8" onClick={async () => { useApp.setState({ settings: await api.sounds.removeCustom(sound.id) }); toast(`Deleted ${sound.name}.`, 'ok') }}>Delete for good</button>
          : <button className="icon-btn !h-8 !w-8 hover:!text-bad" title={`Delete ${sound.name}`} aria-label={`Delete ${sound.name}`} onClick={() => setConfirming(true)}><Trash2 size={14} /></button>}
      </div>
      <div className="flex items-center gap-3 mb-3 text-[12.5px]">
        <span className="text-muted">Use everywhere instead of</span>
        <Select width={200} title="Built-in sound to replace" value={replaces} onChange={setSwap} options={[{ value: '', label: 'Nothing (pick it per part)' }, ...SOUNDS.filter((s) => s.id !== 'sine').map((s) => ({ value: s.id, label: s.label }))]} />
      </div>
      <div className="label mb-1.5">Samples · root note</div>
      <div className="flex flex-wrap gap-1.5">
        {sound.samples.map((s) => (
          <span key={s.file} className="chip !h-7 !pl-2 !pr-1 gap-1" title={s.file}>
            <span className="max-w-[140px] truncate text-muted">{s.file.replace(/^\d+-/, '').replace(/\.wav$/, '')}</span>
            <input className="w-11 bg-transparent text-fg text-center rounded border border-line focus:border-accent outline-none" aria-label={`Root note of ${s.file}`} defaultValue={midiName(s.note)} key={s.note}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              onBlur={(e) => {
                const note = noteFromName(e.currentTarget.value.trim())
                if (note === null) { e.currentTarget.value = midiName(s.note); toast('Write the note like C4, F#3 or Bb2.', 'error'); return }
                if (note !== s.note) void save({ ...sound, samples: sound.samples.map((x) => (x.file === s.file ? { ...x, note } : x)).sort((a, b) => a.note - b.note) })
              }} />
            {sound.samples.length > 1 && <button className="icon-btn !h-5 !w-5" aria-label={`Remove ${s.file}`} title="Remove sample" onClick={() => void save({ ...sound, samples: sound.samples.filter((x) => x.file !== s.file) })}><X size={11} /></button>}
          </span>
        ))}
        <button className="btn-ghost !h-7 !text-[12px]" disabled={busy} onClick={() => void addSamples()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add samples</button>
      </div>
    </div>
  )
}

/** Settings → Instrument sounds: instruments made from your own recordings. */
export default function CustomSounds() {
  const { settings, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const add = async () => {
    const files = await api.sounds.pickSamples()
    if (!files.length) return
    setBusy(true)
    try {
      const next = await api.sounds.addCustom(nameFromFile(files[0]), files)
      useApp.setState({ settings: next })
      toast(`Added ${next.customSounds.at(-1)?.name}. Choose it in any part's Sound & effects.`, 'ok')
    } catch (e) { toast(plain(e as Error), 'error') }
    finally { setBusy(false) }
  }
  const list = settings?.customSounds ?? []
  return (
    <section className="mt-5">
      <div className="flex items-end justify-between gap-4 mb-2">
        <div>
          <h3 className="font-display text-[19px]">Your instruments</h3>
          <p className="text-muted text-[12.5px] mt-1 leading-relaxed max-w-[520px]">Make an instrument from your own recordings. One sample is enough, and more samples across the range sound more natural. Name files by their note (for example <span className="kbd">Piano C4.wav</span>) and Aurel sets the root notes for you. Use it in any part, or swap it in for a built-in sound everywhere.</p>
        </div>
        <button className="btn-primary shrink-0" disabled={busy} onClick={() => void add()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add instrument…</button>
      </div>
      <div className="space-y-3 mt-4">
        {list.map((s) => <Instrument key={s.id} sound={s} />)}
        {!list.length && <p className="text-faint text-[12.5px] text-center border border-dashed border-line rounded-xl p-5">No instruments of your own yet.</p>}
      </div>
    </section>
  )
}
