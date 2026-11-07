import { useEffect, useState, type ReactNode } from 'react'
import { Zap, Gauge, Sparkles, Check, Loader2, Wand2, Download } from 'lucide-react'
import type { Settings, TranscribeQuality } from '@shared/types'
import { useApp, applyAnalysis } from '@/store/app'
import { useProject } from '@/store/project'
import { api } from '@/lib/api'
import { Select } from '@/components/menu'
import { cx, Toggle } from '@/components/ui'

const QUALITIES: { k: TranscribeQuality; label: string; icon: typeof Zap; time: string; text: string }[] = [
  { k: 'fast', label: 'Fast', icon: Zap, time: '≈ 1× song length on a CPU', text: 'Quick separation and one general note model. Good for a first listen.' },
  { k: 'balanced', label: 'Balanced', icon: Gauge, time: '≈ 2–3× on a CPU, seconds on a GPU', text: 'A model for each instrument (Transkun, CREPE, ADTOF), checked against each other, with chords and key. BS-RoFormer separation on an NVIDIA GPU.' },
  { k: 'best', label: 'Best', icon: Sparkles, time: '≈ 4–6× on a CPU', text: 'Everything in Balanced, with extra separation passes (BS-RoFormer with more overlap on a GPU, two Demucs models on a CPU).' }
]

const LANGUAGES = [['', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['ru', 'Russian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['yo', 'Yoruba'], ['ig', 'Igbo'], ['sw', 'Swahili']]

export function SettingRow({ id, title, desc, children }: { id?: string; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div data-setting={id} className="setting-row flex items-center gap-6 py-3.5 border-b border-line last:border-0">
      <div className="flex-1 min-w-0"><div className="font-medium">{title}</div>{desc && <div className="text-muted text-[12.5px] mt-0.5 leading-relaxed">{desc}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Note sensitivity: one slider for every model's thresholds. */
function Sensitivity({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  const label = local < 0.3 ? 'Only clear notes' : local < 0.45 ? 'Cleaner' : local <= 0.55 ? 'Balanced' : local <= 0.7 ? 'More notes' : 'Every note it hears'
  return (
    <div className="w-72">
      <div className="flex items-center justify-between text-[11px] text-faint mb-1.5"><span>Fewer, cleaner</span><span className="text-accent font-medium text-[12px]">{label}</span><span>Catch quiet notes</span></div>
      <input type="range" aria-label="Note sensitivity" className="slider" min={0} max={1} step={0.05} value={local}
        style={{ ['--pct' as string]: `${local * 100}%` }}
        onChange={(e) => setLocal(+e.target.value)} onPointerUp={() => onChange(local)} onKeyUp={() => onChange(local)} onBlur={() => local !== value && onChange(local)} />
    </div>
  )
}

function ApplyNow() {
  const project = useProject((s) => s.project)
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const can = !!project && project.analysis?.status === 'done'
  return (
    <SettingRow id="applyNow" title="Apply to the open song" desc={can ? `Rewrite “${project!.score.title}” with the rhythm, tempo, chord and singer settings above. Your edits to that transcription are replaced. Quality, sensitivity and models need a new transcription.` : 'Open a transcribed song to rewrite it with these settings.'}>
      <button className="btn-soft" disabled={!can || busy} onClick={async () => {
        setBusy(true)
        try {
          await applyAnalysis(project!.id)
          await useProject.getState().load(project!.id)
          toast('Transcription rewritten with your settings.', 'ok')
        } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
      }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Apply</button>
    </SettingRow>
  )
}

export default function TranscriptionSection({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const { engine, jobs, track } = useApp()
  const installing = Object.values(jobs).some((j) => j.kind === 'install' && !j.done)
  return (
    <>
      <h2 className="font-display text-[22px] mb-1">Transcription</h2>
      <p className="text-muted mb-4 leading-relaxed">How recordings become notation. The engine splits the song into instruments, finds every beat and bar line, and uses a model made for each instrument.</p>
      {engine?.ready && !engine.upgraded && (
        <div className="card p-4 mb-5 flex items-center gap-3 upgrade-card">
          <Sparkles size={18} className="text-accent shrink-0" />
          <div className="flex-1 text-[13px] leading-relaxed"><b>New transcription models are available.</b> Per-instrument note models, a much better beat and bar finder and BS-RoFormer separation support (a few hundred MB, once; the 700 MB BS-RoFormer weights come later, only if they are used).</div>
          <button className="btn-primary" disabled={installing} onClick={async () => { const { jobId } = await api.engine.install(); track(jobId, 'Adding the new transcription models') }}>
            {installing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Install
          </button>
        </div>
      )}
      <div data-setting="quality" className="setting-row grid grid-cols-3 gap-3 mb-5">
        {QUALITIES.map((q) => {
          const on = s.transcribeQuality === q.k
          return (
            <button key={q.k} aria-pressed={on} onClick={() => set({ transcribeQuality: q.k })}
              className={cx('quality-card text-left rounded-xl border-2 p-3.5', on ? 'border-accent on' : 'border-line hover:border-faint')}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={cx('h-7 w-7 rounded-lg flex items-center justify-center', on ? 'bg-accent text-bg' : 'bg-fg/[0.07] text-muted')}><q.icon size={15} /></span>
                <span className="font-medium">{q.label}</span>
                {on && <Check size={14} className="ml-auto text-accent animate-pop" />}
              </div>
              <div className="text-[11.5px] text-muted leading-relaxed">{q.text}</div>
              <div className="text-[10.5px] text-faint mt-2">{q.time}</div>
            </button>
          )
        })}
      </div>
      <div className="card px-5 py-1 mb-5">
        <SettingRow id="sensitivity" title="Note sensitivity" desc="Lower keeps only notes the models are sure of. Higher catches soft notes, with more extras to delete.">
          <Sensitivity value={s.noteSensitivity ?? 0.5} onChange={(v) => set({ noteSensitivity: v })} />
        </SettingRow>
        <SettingRow id="separator" title="Instrument separation" desc={(s.separator ?? 'auto') === 'auto' ? `Automatic: BS-RoFormer on an NVIDIA GPU${engine?.cuda ? ' (yours)' : ''}, Demucs on the processor.` : s.separator === 'roformer' ? 'BS-RoFormer: several dB cleaner guitar, piano, bass and drums than Demucs. 700 MB download; slow without an NVIDIA GPU.' : 'HT-Demucs: fast everywhere, good on vocals, bass and drums.'}>
          <div className="seg">{([['auto', 'Automatic'], ['roformer', 'BS-RoFormer'], ['demucs', 'Demucs']] as const).map(([k, l]) => <button key={k} className={cx((s.separator ?? 'auto') === k && 'on')} onClick={() => set({ separator: k })}>{l}</button>)}</div>
        </SettingRow>
        <SettingRow id="bleedCheck" title="Remove notes heard from other instruments" desc="Separation leaves a little of each instrument in the others. A note that sounds much louder in another part is taken out of this one."><Toggle ariaLabel="Remove notes heard from other instruments" on={s.bleedCheck ?? true} onChange={(v) => set({ bleedCheck: v })} /></SettingRow>
        <SettingRow id="chordSymbols" title="Find chords and the key" desc="Chord symbols over the score and the key signature, worked out from every part together."><Toggle ariaLabel="Find chords and the key" on={s.chordSymbols ?? true} onChange={(v) => set({ chordSymbols: v })} /></SettingRow>
        <SettingRow id="chordCleanup" title="Chord-aware clean-up" desc="Quiet, short notes that fit neither the chord being played nor the next one are removed as mistakes."><Toggle ariaLabel="Chord-aware clean-up" on={s.chordCleanup ?? true} disabled={s.chordSymbols === false} onChange={(v) => set({ chordCleanup: v })} /></SettingRow>
        <SettingRow id="detectTechniques" title="Playing techniques" desc="Bends (with how far), vibrato, slides and hammer-ons on single-note guitar and bass lines, from the pitch of the recording."><Toggle ariaLabel="Playing techniques" on={s.detectTechniques ?? true} onChange={(v) => set({ detectTechniques: v })} /></SettingRow>
        <SettingRow id="drumModel" title="Drum transcription" desc={s.drumModel === 'basic' ? 'Kick, snare and hi-hat from frequency bands.' : 'ADTOF finds kick, snare, toms, hi-hat and cymbals. Its model is licensed for non-commercial use.'}>
          <div className="seg">{([['adtof', 'Advanced'], ['basic', 'Basic']] as const).map(([k, l]) => <button key={k} className={cx((s.drumModel ?? 'adtof') === k && 'on')} onClick={() => set({ drumModel: k })}>{l}</button>)}</div>
        </SettingRow>
      </div>

      <h3 className="font-display text-[18px] mb-1">Writing it down</h3>
      <p className="text-muted text-[12.5px] mb-2">These shape the notation. Change them and press Apply to rewrite an open song without transcribing again.</p>
      <div className="card px-5 py-1 mb-5">
        <SettingRow id="rhythmDetail" title="Rhythm detail" desc="Each beat uses the simplest rhythm that fits what was played, down to this.">
          <div className="seg">{([['simple', 'Simple', '8ths'], ['standard', 'Standard', '16ths'], ['detailed', 'Detailed', '32nds']] as const).map(([k, l, h]) => <button key={k} title={`Down to ${h}`} className={cx((s.rhythmDetail ?? 'standard') === k && 'on')} onClick={() => set({ rhythmDetail: k })}>{l}</button>)}</div>
        </SettingRow>
        <SettingRow id="fillGaps" title="Hold notes over short gaps" desc="Instead of writing a tiny rest between notes, the first note lasts until the next one."><Toggle ariaLabel="Hold notes over short gaps" on={s.fillGaps ?? true} onChange={(v) => set({ fillGaps: v })} /></SettingRow>
        <SettingRow id="straightSwing" title="Write swing as straight eighths" desc="Swung (long-short) eighths are written as plain eighths, the usual way to notate swing."><Toggle ariaLabel="Write swing as straight eighths" on={s.straightSwing ?? true} onChange={(v) => set({ straightSwing: v })} /></SettingRow>
        <SettingRow id="followTempo" title="Tempo" desc="Follow the recording adds a tempo change wherever the band speeds up or slows down, so the score stays in sync with the audio.">
          <div className="seg">{([[true, 'Follow the recording'], [false, 'One tempo']] as const).map(([k, l]) => <button key={String(k)} className={cx((s.followTempo ?? true) === k && 'on')} onClick={() => set({ followTempo: k })}>{l}</button>)}</div>
        </SettingRow>
        <SettingRow id="triplets" title="Triplets" desc="Write a beat as triplets where the notes clearly split it in three (in 2/4, 3/4 and 4/4)."><Toggle ariaLabel="Triplets" on={s.triplets ?? true} onChange={(v) => set({ triplets: v })} /></SettingRow>
        <SettingRow id="chordLimit" title="Notes per guitar chord" desc="The most notes kept in one guitar chord (the loudest win).">
          <div className="seg">{[3, 4, 5, 6].map((k) => <button key={k} className={cx((s.guitarChordLimit ?? 6) === k && 'on')} onClick={() => set({ guitarChordLimit: k })}>{k}</button>)}</div>
        </SettingRow>
        <ApplyNow />
      </div>

      <h3 className="font-display text-[18px] mb-2">Singer</h3>
      <div className="card px-5 py-1 mb-5">
        <SettingRow id="lyricWords" title="Recognise the singer’s words" desc="Whisper listens to the isolated voice. Each word is moved onto the note it is sung on."><Toggle ariaLabel="Recognise the singer’s words" on={s.lyricWords ?? true} onChange={(v) => set({ lyricWords: v })} /></SettingRow>
        <SettingRow id="vocalMelody" title="Write the singer’s melody" desc="Put the sung notes on the Singer staff, with the words under them."><Toggle ariaLabel="Write the singer’s melody" on={s.vocalMelody ?? false} onChange={(v) => set({ vocalMelody: v })} /></SettingRow>
        <SettingRow id="lyricsModel" title="Word recognition model" desc={({ base: 'Base: quick, 140 MB.', small: 'Small: noticeably better on sung words, 460 MB.', medium: 'Medium: better again, 1.5 GB; slow without a GPU.', turbo: 'Large v3 Turbo: the most accurate, 1.6 GB; best with an NVIDIA GPU.' } as Record<string, string>)[s.lyricsModel ?? 'base']}>
          <div className="seg">{([['base', 'Base'], ['small', 'Small'], ['medium', 'Medium'], ['turbo', 'Turbo']] as const).map(([k, l]) => <button key={k} disabled={s.lyricWords === false} className={cx((s.lyricsModel ?? 'base') === k && 'on')} onClick={() => set({ lyricsModel: k })}>{l}</button>)}</div>
        </SettingRow>
        <SettingRow id="lyricsLanguage" title="Lyrics language" desc="Telling Whisper the language avoids it guessing wrong on short songs.">
          <Select width={210} value={s.lyricsLanguage ?? ''} onChange={(v) => set({ lyricsLanguage: v })} options={LANGUAGES.map(([value, label]) => ({ value, label }))} />
        </SettingRow>
      </div>

      <h3 className="font-display text-[18px] mb-2">Your own models</h3>
      <div className="card px-5 py-1 mb-5">
        <SettingRow id="customNoteModel" title="Custom note model" desc={s.customNoteModel ? `Guitar and piano notes come from ${s.customNoteModel.split(/[\\/]/).pop()}.` : 'A Transkun checkpoint you fine-tuned with tools/train (see its README). Used for guitar and piano.'}>
          <div className="flex items-center gap-2">
            {s.customNoteModel && <button className="btn-ghost" onClick={() => set({ customNoteModel: '' })}>Use built-in</button>}
            <button className="btn-soft" onClick={async () => { const f = await api.media.pickModel(); if (f) set({ customNoteModel: f }) }}>Choose…</button>
          </div>
        </SettingRow>
      </div>

      <div className="card px-5 py-1">
        <SettingRow id="openAfterImport" title="Open new recordings in the studio" desc="Go straight to a song when its import finishes."><Toggle ariaLabel="Open new recordings in the studio" on={s.openAfterImport ?? true} onChange={(v) => set({ openAfterImport: v })} /></SettingRow>
      </div>
    </>
  )
}

/** Quality and sensitivity, right where a transcription is started. */
export function QuickTranscribeSettings() {
  const s = useApp((x) => x.settings)
  const update = useApp((x) => x.updateSettings)
  if (!s) return null
  return (
    <div className="flex items-end gap-5 flex-wrap rounded-xl bg-fg/[0.04] px-3.5 py-3">
      <div>
        <div className="label mb-1.5">Quality</div>
        <div className="seg">{QUALITIES.map((q) => <button key={q.k} title={q.text} className={cx((s.transcribeQuality ?? 'balanced') === q.k && 'on')} onClick={() => void update({ transcribeQuality: q.k })}><q.icon size={12} className="inline -mt-0.5 mr-1" />{q.label}</button>)}</div>
      </div>
      <div className="flex-1 min-w-[220px]">
        <div className="label mb-1.5">Note sensitivity</div>
        <Sensitivity value={s.noteSensitivity ?? 0.5} onChange={(v) => void update({ noteSensitivity: v })} />
      </div>
    </div>
  )
}
