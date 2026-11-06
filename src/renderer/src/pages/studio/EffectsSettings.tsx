import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { PPQ, type Settings } from '@shared/types'
import type { FxSlot } from '@shared/sounds'
import { defaultFx, player } from '@/audio/player'
import { renderWav } from '@/audio/render'
import { newProject, newScore, uid } from '@/music/score'
import { midiName } from '@/music/theory'
import { allSounds, type SoundId } from '@/audio/synth'
import { Select } from '@/components/menu'
import { useApp } from '@/store/app'
import FxChainEditor from './FxChainEditor'

export default function EffectsSettings({ settings }: { settings: Settings }) {
  const { updateSettings, toast } = useApp()
  const [sound, setSound] = useState<SoundId>('piano')
  const [draft, setDraft] = useState<FxSlot[]>(() => structuredClone(settings.fxDefaults.piano ?? defaultFx('piano')))
  const audition = useRef<AbortController | null>(null)
  const [testKey, setTestKey] = useState<string | null>(null)
  useEffect(() => () => audition.current?.abort(), [])
  const test = async () => {
    if (audition.current) return
    const controller = new AbortController()
    audition.current = controller
    const root = 48 + Math.floor(Math.random() * 12)
    setTestKey(midiName(root).slice(0, -1))
    try {
      const score = newScore({ title: 'Effects test', composer: '', tempo: 128, num: 4, den: 4, keyFifths: 0,
        instruments: ['piano'], measures: 2, pianoGrandStaff: false })
      const part = score.parts[0]
      part.sound = sound
      part.fx = draft
      const scales = [[0, 2, 4, 5, 7, 9, 11, 12], [0, 2, 3, 5, 7, 8, 10, 12]]
      scales.forEach((scale, bar) => {
        part.measures[bar].events = scale.map((interval, index) => ({
          id: uid('n'), start: index * PPQ / 2, dur: PPQ / 2, notes: [{ pitch: root + interval }], velocity: 88
        }))
      })
      const wav = await renderWav(newProject(score, 'composition'), {
        partIds: [part.id], from: 0, to: 1, useAudioStems: false,
        settings: { ...settings.export, normalize: false, channels: 2, bitDepth: 16, tail: 1.5 }
      })
      await player.playPreviewAudio(Uint8Array.from(wav).buffer, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) toast((error as Error).message, 'error')
    } finally {
      if (audition.current === controller) {
        audition.current = null
        setTestKey(null)
      }
    }
  }
  const stopTest = () => {
    audition.current?.abort()
    audition.current = null
    setTestKey(null)
  }
  const chooseSound = (id: SoundId) => {
    stopTest()
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
        <div className="mb-3 flex items-center gap-2">
          <button className="btn-soft" disabled={testKey !== null} onClick={() => void test()}><Play size={14} /> Test scales</button>
          <button className="btn-soft" disabled={testKey === null} onClick={stopTest}><Square size={14} /> Stop</button>
          <span className="text-[12px] text-muted" role="status">{testKey ? `${testKey} major and minor` : 'Hear the current chain on two scales in a random key.'}</span>
        </div>
        <FxChainEditor key={sound} chain={draft} onChange={setDraft} onNativeSave={(chain) => void save(chain)} />
        <div className="flex flex-wrap gap-2 justify-end mt-3">
          <button className="btn-ghost" onClick={() => void reset()}>Reset factory chain</button>
          <button className="btn-primary" onClick={() => void save(draft)}>Save as instrument default</button>
        </div>
      </section>
    </div>
  )
}
