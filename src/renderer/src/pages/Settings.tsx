import { useEffect, useState, type ReactNode } from 'react'
import { Palette, Volume2, Cpu, Download, Upload, Keyboard, Info, RefreshCw, Check, Loader2, Speaker, PenLine, Music, Scale, Plug, KeyboardMusic, SlidersHorizontal } from 'lucide-react'
import { packFor, SOUND_PACKS, type PackStatus } from '@shared/sounds'
import type { Settings, UpdateInfo } from '@shared/types'
import { useApp } from '@/store/app'
import { useProject } from '@/store/project'
import { api } from '@/lib/api'
import { Select } from '@/components/menu'
import { cx, Slider, Toggle, Progress } from '@/components/ui'
import { CHORD_SHORTCUT, SHORTCUTS } from './studio/shortcuts'
import { usePlayer } from './studio/Transport'
import EffectsSettings from './studio/EffectsSettings'
import CustomSounds from './settings/CustomSounds'
import { DeviceFormat, EffectTails, MidiSection, PluginsSection } from './settings/AudioSections'

const SECTIONS = [
  { k: 'appearance', label: 'Appearance', icon: Palette },
  { k: 'audio', label: 'Audio device', icon: Speaker },
  { k: 'midi', label: 'MIDI', icon: KeyboardMusic },
  { k: 'playback', label: 'Playback', icon: Volume2 },
  { k: 'editor', label: 'Editor', icon: PenLine },
  { k: 'sounds', label: 'Instrument sounds', icon: Music },
  { k: 'plugins', label: 'Plug-ins', icon: Plug },
  { k: 'effects', label: 'Default effects', icon: SlidersHorizontal },
  { k: 'engine', label: 'AI Engine', icon: Cpu },
  { k: 'import', label: 'Import', icon: Download },
  { k: 'export', label: 'Export', icon: Upload },
  { k: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { k: 'legal', label: 'Terms & privacy', icon: Scale },
  { k: 'about', label: 'About & limits', icon: Info }
]

function useOutputs(): { id: string; label: string }[] {
  const [list, setList] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    const load = () => navigator.mediaDevices?.enumerateDevices().then((d) => setList(d.filter((x) => x.kind === 'audiooutput' && x.deviceId !== 'default' && x.deviceId !== 'communications').map((x, i) => ({ id: x.deviceId, label: x.label || `Output ${i + 1}` })))).catch(() => undefined)
    load()
    navigator.mediaDevices?.addEventListener('devicechange', load)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load)
  }, [])
  return list
}

function SoundsSection() {
  const { jobs, track } = useApp()
  const [packs, setPacks] = useState<PackStatus[]>([])
  const busy = Object.values(jobs).some((j) => (j.kind === 'sounds' || j.kind === 'tools') && !j.done)
  useEffect(() => { void api.sounds.status().then(setPacks) }, [busy])
  const missing = packs.filter((p) => !p.ready)
  const dl = async (ids: string[]) => { const { jobId } = await api.sounds.download(ids); track(jobId, 'Downloading instrument sounds') }
  return (
    <>
      <h2 className="font-display text-[22px] mb-1">Instrument sounds</h2>
      <p className="text-muted mb-2 leading-relaxed">Every part plays one of these. All of them are stored on this computer and work offline.</p>
      <CustomSounds />
      <h3 className="font-display text-[19px] mt-8 mb-1">Built-in instruments</h3>
      <p className="text-muted text-[12.5px] mb-3 leading-relaxed">Recorded instruments from the Salamander Grand Piano and the MusyngKite General MIDI set.</p>
      <div className="flex gap-2 mb-3">
        <button className="btn-primary" disabled={busy || !missing.length} onClick={() => dl(missing.map((p) => p.id))}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {missing.length ? `Download ${missing.length} missing` : 'All sounds installed'}</button>
      </div>
      <div className="card divide-y divide-line">
        {packs.map((p) => (
          <div key={p.id} className="flex items-center px-4 h-11 gap-3">
            <span className="flex-1">{packFor(p.id)?.label}</span>
            <span className="text-[12px] text-faint tabular-nums">{p.have}/{p.total}</span>
            {p.ready ? <span className="chip !text-ok !bg-ok/10"><Check size={12} /> Installed</span> : <button className="btn-soft !h-7" disabled={busy} onClick={() => dl([p.id])}>Download</button>}
          </div>
        ))}
      </div>
    </>
  )
}

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-3.5 border-b border-line last:border-0">
      <div className="flex-1 min-w-0"><div className="font-medium">{title}</div>{desc && <div className="text-muted text-[12.5px] mt-0.5 leading-relaxed">{desc}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function TestChordButton() {
  const p = usePlayer()
  return (
    <button className="btn-soft" disabled={!!p.testChordSound} onClick={() => p.previewRandomChord()}>
      {p.testChordSound ? `Playing ${p.testChordSound}` : 'Play chord'}
    </button>
  )
}

function UpdatesCard({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const [state, setState] = useState<{ checking: boolean; text?: string }>({ checking: false })
  const check = async () => {
    setState({ checking: true })
    const u: UpdateInfo = await api.updates.check().catch((e: Error) => ({ available: false, error: e.message, current: api.updates.version() }))
    if (u.available) { useApp.setState({ update: u }); setState({ checking: false, text: `Version ${u.version} is available.` }) }
    else setState({ checking: false, text: u.error ?? `You have the latest version (${u.current}).` })
  }
  return (
    <div className="card px-5 py-1 mb-5">
      <Row title="Check for updates automatically" desc="When Aurel starts, look for a newer release on GitHub and ask before installing it."><Toggle on={s.checkUpdates} onChange={(v) => set({ checkUpdates: v })} /></Row>
      <Row title="Updates" desc={state.text ?? (s.skippedVersion ? `Skipping version ${s.skippedVersion}.` : 'Updates download, install and restart Aurel for you.')}>
        <button className="btn-soft" disabled={state.checking} onClick={() => void check()}>{state.checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check now</button>
      </Row>
    </div>
  )
}

export default function SettingsPage({ section }: { section?: string }) {
  const { settings, updateSettings, engine, refreshEngine, jobs, track } = useApp()
  const [sec, setSec] = useState(section ?? 'appearance')
  const [yt, setYt] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const outputs = useOutputs()
  useEffect(() => { if (section) setSec(section) }, [section])
  if (!settings) return null
  const s = settings
  const set = (p: Partial<Settings>) => void updateSettings(p)
  const installJob = Object.values(jobs).find((j) => j.kind === 'install')

  const themes: { k: Settings['theme']; label: string; bg: string; panel: string; accent: string; ink: string }[] = [
    { k: 'dark', label: 'Dark', bg: '#0d0e12', panel: '#1d1f27', accent: '#dcb670', ink: '#dedad0' },
    { k: 'light', label: 'Light', bg: '#f4f3ef', panel: '#ffffff', accent: '#a87a28', ink: '#1e1c1a' },
    { k: 'sakura', label: 'Sakura', bg: '#220f1b', panel: '#311626', accent: '#ff78a8', ink: '#ffe9f1' }
  ]

  return (
    <div className="h-full flex">
      <aside className="w-[220px] shrink-0 px-3 pt-1 border-r border-line">
        <h1 className="font-display text-[26px] px-2 mb-4">Settings</h1>
        {SECTIONS.map((x) => (
          <button key={x.k} onClick={() => setSec(x.k)} className={cx('w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px]', sec === x.k ? 'bg-accent/10 text-accent' : 'text-muted hover:text-fg hover:bg-fg/[0.05]')}>
            <x.icon size={16} /> {x.label}
          </button>
        ))}
      </aside>
      <div className="flex-1 overflow-auto">
        <div className="max-w-[720px] px-10 pb-16 animate-fadein" key={sec}>
          {sec === 'appearance' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Appearance</h2>
              <div className="grid grid-cols-3 gap-3 mb-6">
                {themes.map((t) => (
                  <button key={t.k} onClick={() => set({ theme: t.k })} className={cx('rounded-xl border-2 p-1.5 text-left transition-colors', s.theme === t.k ? 'border-accent' : 'border-line hover:border-faint')}>
                    <div className="rounded-lg h-[92px] p-2.5 flex gap-2" style={{ background: t.bg }}>
                      <div className="w-5 rounded-md" style={{ background: t.panel }} />
                      <div className="flex-1 rounded-md p-2 flex flex-col gap-1.5" style={{ background: t.panel }}>
                        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-px" style={{ background: t.ink, opacity: 0.35 }} />)}
                        <div className="flex gap-1 mt-1">{[0, 1, 2].map((i) => <div key={i} className="h-2 w-2 rounded-full" style={{ background: i === 1 ? t.accent : t.ink }} />)}</div>
                      </div>
                    </div>
                    <div className="px-1 pt-1.5 pb-0.5 flex items-center justify-between text-[13px] font-medium">{t.label}{s.theme === t.k && <Check size={14} className="text-accent" />}</div>
                  </button>
                ))}
              </div>
              {s.theme !== 'sakura' && (
                <Row title="Accent colour">
                  <div className="flex gap-2">
                    {[['gold', '#dcb670'], ['blue', '#7da8ff'], ['mint', '#6ecdaa'], ['rose', '#ec809e']].map(([k, c]) => (
                      <button key={k} onClick={() => set({ accent: k })} className={cx('h-7 w-7 rounded-full border-2', s.accent === k ? 'border-fg' : 'border-transparent')} style={{ background: c }} title={k} />
                    ))}
                  </div>
                </Row>
              )}
              <Row title="Interface size" desc="Scale the whole interface.">
                <div className="seg">{[0.9, 1, 1.1, 1.25].map((z) => <button key={z} className={cx(s.uiScale === z && 'on')} onClick={() => set({ uiScale: z })}>{Math.round(z * 100)}%</button>)}</div>
              </Row>
              {s.theme === 'sakura' && <Row title="Reduce motion" desc="Turns off interface animations and falling petals."><Toggle on={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} /></Row>}
            </>
          )}
          {sec === 'playback' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Playback</h2>
              <Row title="Count-in" desc="Clicks before playback starts. Also on the transport bar.">
                <div className="flex items-center gap-3">
                  <div className="seg">{[1, 2, 4].map((n) => <button key={n} disabled={!s.countInOn} className={cx(s.countInOn && s.countInBars === n && 'on')} onClick={() => set({ countInBars: n })}>{n} bar{n > 1 ? 's' : ''}</button>)}</div>
                  <Toggle on={s.countInOn} onChange={(v) => set({ countInOn: v })} />
                </div>
              </Row>
              <Row title="Metronome volume"><div className="flex items-center gap-3 w-56"><Slider title="Metronome volume" value={s.metronomeVolume} min={0} max={1} onChange={(v) => set({ metronomeVolume: v })} /><span className="w-10 text-right tabular-nums">{Math.round(s.metronomeVolume * 100)}%</span></div></Row>
              <Row title="Follow playback" desc="Scroll the score automatically to keep the cursor in view."><Toggle on={s.autoScroll} onChange={(v) => set({ autoScroll: v })} /></Row>
              <Row title="Solo follows track selection" desc="Choosing a part solos it; going back to the full score clears the solos. Use the S button to unsolo while staying on a part."><Toggle on={s.soloFollowsView} onChange={(v) => set({ soloFollowsView: v })} /></Row>
              <Row title="Playback cursor"><div className="seg">{(['band', 'line'] as const).map((c) => <button key={c} className={cx(s.cursorStyle === c && 'on')} onClick={() => set({ cursorStyle: c })}>{c === 'band' ? 'Band' : 'Thin line'}</button>)}</div></Row>
              <Row title="Highlight playing notes" desc="Light up each note as it sounds."><Toggle on={s.highlightNotes} onChange={(v) => set({ highlightNotes: v })} /></Row>
              <EffectTails s={s} set={set} />
            </>
          )}
          {sec === 'audio' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Audio device</h2>
              <Row title="Output device" desc="Where playback, previews and the metronome are heard.">
                <Select width={280} value={s.outputDevice} onChange={(v) => set({ outputDevice: v })} options={[{ value: '', label: 'System default' }, ...outputs.map((o) => ({ value: o.id, label: o.label }))]} />
              </Row>
              <Row title="Master volume"><div className="flex items-center gap-3 w-56"><Slider title="Master volume" value={s.masterVolume} min={0} max={1.2} onChange={(v) => set({ masterVolume: v })} /><span className="w-10 text-right tabular-nums">{Math.round(s.masterVolume * 100)}%</span></div></Row>
              <DeviceFormat s={s} set={set} />
              <Row title="Test sound" desc="Each chord uses a randomly chosen instrument."><TestChordButton /></Row>
            </>
          )}
          {sec === 'editor' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Editor</h2>
              <Row title="Piano, fretboard & MIDI keyboard" desc="Write adds the notes you play to the score; Play only lets you play without writing. You can switch any time in the studio.">
                <div className="seg">{(['write', 'play'] as const).map((m) => <button key={m} className={cx(s.inputMode === m && 'on')} onClick={() => { set({ inputMode: m }); useProject.getState().setInputMode(m) }}>{m === 'write' ? 'Write' : 'Play only'}</button>)}</div>
              </Row>
              <Row title="Hear notes while writing" desc="Play each note as you enter or change it."><Toggle on={s.noteInputPreview} onChange={(v) => set({ noteInputPreview: v })} /></Row>
              <Row title="Use two staves for keyboard instruments" desc="New piano, E-Piano and organ parts use treble and bass staves."><Toggle on={s.pianoGrandStaff} onChange={(v) => set({ pianoGrandStaff: v })} /></Row>
              <Row title="Default notation view" desc="Used when a song is opened for the first time.">
                <div className="seg">{(['staff', 'tab', 'both'] as const).map((v) => <button key={v} className={cx(s.defaultView === v && 'on')} onClick={() => set({ defaultView: v })}>{v === 'staff' ? 'Sheet' : v === 'tab' ? 'Tab' : 'Both'}</button>)}</div>
              </Row>
              <Row title="Chords" desc={<>Click <b>Chord</b> in the toolbar or press <b>{CHORD_SHORTCUT}</b> to toggle chord mode. Notes stack on the same beat. Press → to move on.</>}><span className="kbd">{CHORD_SHORTCUT}</span></Row>
            </>
          )}
          {sec === 'sounds' && <SoundsSection />}
          {sec === 'midi' && <MidiSection s={s} set={set} />}
          {sec === 'plugins' && <PluginsSection s={s} />}
          {sec === 'effects' && <EffectsSettings settings={s} />}
          {sec === 'legal' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Terms of Use & Privacy</h2>
              <div className="card p-5 space-y-3 text-[13px] leading-relaxed text-muted select-text">
                <p><b className="text-fg">Your content, your responsibility.</b> Aurel is a tool that runs on your computer. You are solely responsible for the audio you import or download, including from YouTube or other sites, and for how you use any recordings, stems, transcriptions, scores or exports you make with it. Only use content you have the right to use and follow the laws and platform terms that apply to you.</p>
                <p><b className="text-fg">No warranty.</b> Aurel is provided “as is”, without warranties of any kind. Its authors are not liable for any claim, damage or loss arising from your use of the software or of content you process with it.</p>
                <p><b className="text-fg">Privacy.</b> Your library, audio, transcriptions and settings stay on this computer. Aurel has no accounts and sends no analytics. It only connects to the internet to download instrument sounds, the AI engine and the YouTube importer, to fetch YouTube metadata and audio when you ask, and to download a direct audio link you enter.</p>
                <p className="text-faint text-[12px]">This summary is not legal advice. {s.termsAccepted ? 'You accepted these terms.' : 'You accept these terms the first time you import from YouTube.'}</p>
              </div>
              <h3 className="font-display text-[17px] mt-6 mb-2">Credits</h3>
              <div className="card divide-y divide-line text-[12.5px]">
                {[...new Set(SOUND_PACKS.map((p) => p.credit))].map((c) => <div key={c} className="px-4 py-2.5 text-muted">{c}</div>)}
                <div className="px-4 py-2.5 text-muted">Demucs (MIT) by Meta AI · Basic Pitch (Apache 2.0) by Spotify · librosa (ISC) · VexFlow (MIT) · FFmpeg (GPL) · yt-dlp (Unlicense) · Deno (MIT) · uv (MIT)</div>
              </div>
            </>
          )}
          {sec === 'engine' && (
            <>
              <h2 className="font-display text-[22px] mb-1">AI Engine</h2>
              <p className="text-muted mb-4 leading-relaxed">Demucs separates instruments; Spotify’s Basic Pitch converts each one to notes. Everything runs locally on your computer — after setup, no internet is needed.</p>
              <div className="card p-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className={cx('h-2.5 w-2.5 rounded-full', engine?.ready ? 'bg-ok' : 'bg-warn')} />
                  <div className="flex-1">
                    <div className="font-medium">{engine?.ready ? 'Ready' : 'Not installed'}</div>
                    <div className="text-[12.5px] text-muted">
                      {engine?.ready ? `${engine.cuda ? `GPU: ${engine.gpuName}` : 'CPU only (slower — expect a few minutes per song)'} · Python ${engine.python.version}` : engine?.message}
                    </div>
                  </div>
                  <button className="icon-btn" title="Re-check" onClick={() => refreshEngine(true)}><RefreshCw size={15} /></button>
                  {!engine?.ready && <button className="btn-primary" disabled={!!installJob && !installJob.done} onClick={async () => { const { jobId } = await api.engine.install(); track(jobId, 'Installing AI engine') }}>Install engine</button>}
                </div>
                {engine?.ready && (
                  <div className="flex flex-wrap gap-1.5 mt-3">{Object.entries(engine.packages).map(([k, v]) => <span key={k} className="chip">{k} {v ?? '—'}</span>)}</div>
                )}
                {installJob && (
                  <div className="mt-3">
                    <div className="text-[12.5px] mb-1.5">{installJob.stage}{installJob.message ? ` · ${installJob.message}` : ''}</div>
                    {!installJob.done && <Progress pct={installJob.pct} />}
                    <pre className="mt-2 h-40 overflow-auto rounded-lg bg-bg p-2 text-[11px] font-mono text-muted whitespace-pre-wrap select-text">{installJob.logs.join('\n')}</pre>
                  </div>
                )}
                {!engine?.ready && <p className="text-[12px] text-faint mt-3 leading-relaxed">Nothing to install by hand: Aurel downloads its own private Python, PyTorch (the GPU build if an NVIDIA card is found) and the models — roughly 3–5 GB, once. It also starts automatically the first time you press Transcribe.</p>}
              </div>
              <Row title="Processing device"><div className="seg">{(['auto', 'cuda', 'cpu'] as const).map((d) => <button key={d} className={cx(s.device === d && 'on')} onClick={() => set({ device: d })}>{d === 'auto' ? 'Auto' : d.toUpperCase()}</button>)}</div></Row>
              <Row title="Separation model" desc="6-source separates guitar and piano too. Fine-tuned 4-source is higher quality but merges guitar/piano into “other”.">
                <Select width={224} value={s.separationModel} onChange={(v) => set({ separationModel: v })} options={[{ value: 'htdemucs_6s', label: 'HT-Demucs 6-source' }, { value: 'htdemucs', label: 'HT-Demucs 4-source' }, { value: 'htdemucs_ft', label: 'HT-Demucs fine-tuned' }]} />
              </Row>
              <Row title="Split drums" desc="Also write approximate kick / snare / hi-hat stems (frequency-band split)."><Toggle on={s.drumSplit} onChange={(v) => set({ drumSplit: v })} /></Row>
              <Row title="Transcribe automatically after import"><Toggle on={s.autoProcess} onChange={(v) => set({ autoProcess: v })} /></Row>
              <Row title="Custom Python (advanced)" desc="Leave empty to use Aurel’s own environment.">
                <input className="field !w-64" placeholder={"C:\\Python310\\python.exe"} defaultValue={s.pythonPath} onBlur={(e) => { set({ pythonPath: e.target.value.trim() }); setTimeout(() => refreshEngine(true), 200) }} />
              </Row>
            </>
          )}
          {sec === 'import' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Import</h2>
              <Row title="YouTube importer" desc="Aurel downloads and keeps its own copy of yt-dlp. YouTube changes often; if imports start failing, update it.">
                <div className="flex gap-2">
                  <button className="btn-soft !h-9" onClick={async () => { setChecking(true); const r = await api.youtube.check('https://www.youtube.com/watch?v=aqz-KE-bpKQ'); setYt(r.tool.available ? `Installed: yt-dlp ${r.tool.version}` : 'Not installed yet — it downloads automatically on your first YouTube import.'); setChecking(false) }}>{checking ? <Loader2 size={14} className="animate-spin" /> : 'Check'}</button>
                  <button className="btn-soft !h-9" onClick={async () => { const { jobId } = await api.youtube.update(); track(jobId, 'Updating YouTube importer') }}>Update now</button>
                </div>
              </Row>
              <Row title="Custom yt-dlp (advanced)" desc="Leave empty to use Aurel’s own copy.">
                <input className="field !w-56" placeholder="Bundled" defaultValue={s.ytDlpPath} onBlur={(e) => set({ ytDlpPath: e.target.value.trim() })} />
              </Row>
              {yt && <p className="text-[12.5px] text-muted -mt-1 mb-2">{yt}</p>}
              <Row title="Duplicate detection" desc="Files are fingerprinted (SHA-256) and YouTube videos matched by ID, so re-importing opens the existing song."><span className="chip !text-ok">On</span></Row>
            </>
          )}
          {sec === 'export' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Export defaults</h2>
              <Row title="Sample rate"><div className="seg">{([44100, 48000, 96000] as const).map((r) => <button key={r} className={cx(s.export.sampleRate === r && 'on')} onClick={() => set({ export: { ...s.export, sampleRate: r } })}>{r / 1000} kHz</button>)}</div></Row>
              <Row title="Bit depth"><div className="seg">{([16, 24, 32] as const).map((b) => <button key={b} className={cx(s.export.bitDepth === b && 'on')} onClick={() => set({ export: { ...s.export, bitDepth: b } })}>{b === 32 ? '32 float' : `${b}-bit`}</button>)}</div></Row>
              <Row title="Channels"><div className="seg">{([2, 1] as const).map((c) => <button key={c} className={cx(s.export.channels === c && 'on')} onClick={() => set({ export: { ...s.export, channels: c } })}>{c === 2 ? 'Stereo' : 'Mono'}</button>)}</div></Row>
              <Row title="Normalize" desc="Peak-normalize single-file exports to -0.3 dBFS. DAW stem packages are never normalized individually, so relative levels stay intact."><Toggle on={s.export.normalize} onChange={(v) => set({ export: { ...s.export, normalize: v } })} /></Row>
              <Row title="Release tail" desc="Extra seconds rendered after the last measure so notes ring out.">
                <div className="flex items-center gap-3 w-56"><Slider title="Release tail" value={s.export.tail} min={0} max={8} step={0.5} onChange={(v) => set({ export: { ...s.export, tail: v } })} /><span className="tabular-nums w-10 text-right">{s.export.tail}s</span></div>
              </Row>
            </>
          )}
          {sec === 'shortcuts' && (
            <>
              <h2 className="font-display text-[22px] mb-4">Keyboard shortcuts</h2>
              {SHORTCUTS.map((g) => (
                <div key={g.group} className="mb-6">
                  <div className="label mb-2">{g.group}</div>
                  <div className="card divide-y divide-line">
                    {g.items.map(([k, d]) => <div key={k + d} className="flex items-center justify-between px-4 h-10"><span>{d}</span><span className="flex gap-1">{k.split(' ').map((x) => <span key={x} className="kbd">{x}</span>)}</span></div>)}
                  </div>
                </div>
              ))}
            </>
          )}
          {sec === 'about' && (
            <>
              <h2 className="font-display text-[22px] mb-1">Aurel {api.updates.version()}</h2>
              <p className="text-muted mb-5">Notation-first transcription, composition and practice.</p>
              <UpdatesCard s={s} set={set} />
              <div className="card p-5 space-y-3 text-[13px] leading-relaxed">
                <div className="font-medium">What to expect from automatic transcription</div>
                <ul className="list-disc pl-5 space-y-1.5 text-muted">
                  <li><b className="text-fg">Separation</b> is very good for vocals, drums and bass; guitar and piano stems often contain bleed from each other. Multiple guitars are only split when they are panned apart.</li>
                  <li><b className="text-fg">Pitch</b> is reliable for clear monophonic lines (bass, vocals, lead). Dense chords, distorted guitar and reverb-heavy mixes produce extra or missing notes.</li>
                  <li><b className="text-fg">Rhythm</b> is quantized to 16ths at one detected tempo. Triplets, swing, rubato and tempo changes are not captured; the first beat is assumed to be a downbeat.</li>
                  <li><b className="text-fg">Drums</b> are detected by frequency band: kick, snare, hi-hat and cymbals. Toms and ghost notes are mostly missed.</li>
                  <li><b className="text-fg">Tab</b> fingerings are chosen automatically for playability, not from the recording. Bends, slides and other techniques are not detected — add them by hand.</li>
                  <li>Instrument type (clean vs. distorted, acoustic vs. electric) is a heuristic guess with a confidence badge. Correct it from the part menu.</li>
                </ul>
                <p className="text-muted">Treat a transcription as a strong first draft: everything is editable, and you can always compare it against the isolated recording.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
