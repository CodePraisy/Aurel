import { useState } from 'react'
import type { Settings } from '@shared/types'
import type { FxSlot } from '@shared/sounds'
import { defaultFx } from '@/audio/player'
import { allSounds, type SoundId } from '@/audio/synth'
import { Select } from '@/components/menu'
import { useApp } from '@/store/app'
import FxChainEditor from './FxChainEditor'

export default function EffectsSettings({ settings }: { settings: Settings }) {
  const { updateSettings, toast } = useApp()
  const [sound, setSound] = useState<SoundId>('piano')
  const [draft, setDraft] = useState<FxSlot[]>(() => structuredClone(settings.fxDefaults.piano ?? defaultFx('piano')))
  const chooseSound = (id: SoundId) => {
    setSound(id)
    setDraft(structuredClone(settings.fxDefaults[id] ?? defaultFx(id)))
  }
  const save = async (chain: FxSlot[]) => {
    const latest = useApp.getState().settings?.fxDefaults ?? settings.fxDefaults
    await updateSettings({ fxDefaults: { ...latest, [sound]: chain } })
    toast('Instrument effects default saved.', 'ok')
  }
  const reset = async () => {
    const next = { ...settings.fxDefaults }
    delete next[sound]
    setDraft(defaultFx(sound))
    await updateSettings({ fxDefaults: next })
  }
  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-display text-[22px] mb-1">Default effects</h2>
        <p className="text-muted mb-3">Each built-in instrument starts with these effects in every piece. Changing a part's effects in a piece makes a copy for that piece only; use <b>Save as instrument default</b> in the part's Sound &amp; effects to bring it back here.</p>
        <div className="mb-3"><Select width={240} title="Choose instrument" value={sound} onChange={chooseSound} options={allSounds().map((entry) => ({ value: entry.id, label: entry.custom ? `${entry.label} (yours)` : entry.label }))} /></div>
        <FxChainEditor key={sound} chain={draft} onChange={setDraft} onNativeSave={(chain) => void save(chain)} />
        <div className="flex flex-wrap gap-2 justify-end mt-3">
          <button className="btn-ghost" onClick={() => void reset()}>Reset factory chain</button>
          <button className="btn-primary" onClick={() => void save(draft)}>Save as instrument default</button>
        </div>
      </section>
    </div>
  )
}
