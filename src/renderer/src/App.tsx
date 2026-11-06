import { useEffect, useRef, useState } from 'react'
import { player } from '@/audio/player'
import { midi } from '@/audio/midi'
import { useProject } from '@/store/project'
import { ContextMenuHost } from '@/components/menu'
import { SakuraScene } from '@/components/Sakura'
import { Home as HomeIcon, Library as LibraryIcon, Settings as SettingsIcon, Music2, X, Check, AlertCircle, Info, FileAudio } from 'lucide-react'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { cx, Progress } from '@/components/ui'
import Home from '@/pages/Home'
import Library from '@/pages/Library'
import SettingsPage from '@/pages/Settings'
import Studio from '@/pages/Studio'
import { NewCompositionDialog, YouTubeDialog, UrlDialog } from '@/pages/Dialogs'
import { UpdateDialog } from '@/pages/UpdateDialog'

export default function App() {
  const { route, go, settings, loadSettings, refreshLibrary, refreshEngine, toasts, jobs, importFile } = useApp()
  const [dragging, setDragging] = useState(false)

  useEffect(() => { void loadSettings(); void refreshLibrary(); void refreshEngine() }, [loadSettings, refreshLibrary, refreshEngine])
  // MIDI keyboards: plays the selected part (or writes into the score in Write mode)
  useEffect(() => {
    midi.setTarget({
      settings: () => {
        const s = useApp.getState().settings
        const st = useProject.getState()
        return { input: s?.midiInput ?? '', channel: s?.midiChannel ?? 0, mode: st.project ? st.inputMode : 'play', audition: s?.auditionTrack ?? 'selected' }
      },
      part: (audition) => {
        const st = useProject.getState()
        const parts = st.project?.score.parts ?? []
        if (audition === 'piano' || !parts.length) return null
        if (audition === 'first') return parts[0]
        return parts.find((x) => x.id === st.cursor?.partId) ?? parts[0]
      },
      write: (pitch, velocity, chord) => {
        const st = useProject.getState()
        const part = st.project?.score.parts.find((x) => x.id === st.cursor?.partId)
        if (!part || !st.cursor) return false
        st.inputNote(pitch, { chord, velocity, silent: true })
        return true
      }
    })
    void midi.start()
  }, [])
  useEffect(() => { midi.bind() }, [settings?.midiInput])
  // look for a new release once per start, unless turned off
  const updateChecked = useRef(false)
  useEffect(() => {
    if (!settings || updateChecked.current || !settings.checkUpdates) return
    updateChecked.current = true
    const t = setTimeout(() => void api.updates.check().then((u) => {
      if (u.available && u.version !== useApp.getState().settings?.skippedVersion) useApp.setState({ update: u })
    }, () => undefined), 4000)
    return () => clearTimeout(t)
  }, [settings])
  // plug-in crashes and reloads are announced, never silent
  useEffect(() => player.onHostEvent((e) => {
    const where = e.partName ? ` on ${e.partName}` : ''
    if (e.type === 'crash') useApp.getState().toast(`${e.plugin ?? 'A plug-in'} crashed${where}. Aurel is reloading the track without it.`, 'error')
    else if (e.type === 'failed') useApp.getState().toast(`${e.message ?? 'A plug-in track stopped'}${where}`, 'error')
    else if (e.type === 'fail') useApp.getState().toast(`${e.plugin ?? 'A plug-in'}${where}: ${e.message ?? 'stopped working'}`, 'error')
  }), [])
  // first run: fetch instrument sounds and the YouTube importer in the background
  const setupStarted = useRef(false)
  useEffect(() => {
    if (!settings || setupStarted.current || settings.setupDone || !settings.autoSetup) return
    setupStarted.current = true
    void api.setup.run().then(({ jobId }) => useApp.getState().track(jobId, 'Setting up Aurel: downloading instrument sounds'))
  }, [settings])
  useEffect(() => {
    if (!settings) return
    player.configure({ sampleRate: settings.sampleRate, bufferSize: settings.bufferSize, sinkId: settings.outputDevice, volume: settings.masterVolume, fxDefaults: settings.fxDefaults, effectTails: settings.effectTails, customSounds: settings.customSounds, soundSwaps: settings.soundSwaps })
    document.documentElement.style.zoom = String(settings.uiScale || 1)
  }, [settings])
  useEffect(() => {
    if (!settings) return
    const r = document.documentElement
    r.dataset.theme = settings.theme
    r.dataset.accent = settings.theme === 'sakura' ? '' : settings.accent
    r.dataset.motion = settings.theme === 'sakura' && settings.reduceMotion ? 'reduce' : ''
    ;(window as unknown as { __aurelSettings: typeof settings }).__aurelSettings = settings
  }, [settings])

  // drag & drop audio anywhere
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setDragging(true); e.preventDefault() } }
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false) }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      for (const f of Array.from(e.dataTransfer?.files ?? [])) {
        const p = api.media.pathForFile(f)
        if (p) void importFile(p)
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [importFile])

  if (!settings) return <div className="h-full bg-bg" />
  const studioOpen = route.name === 'studio'
  const nav = [
    { key: 'home', icon: HomeIcon, label: 'Home', on: route.name === 'home', go: () => go({ name: 'home' }) },
    { key: 'library', icon: LibraryIcon, label: 'Library', on: route.name === 'library', go: () => go({ name: 'library' }) }
  ]
  const jobList = Object.values(jobs)

  return (
    <div className="h-full flex relative">
      {settings.theme === 'sakura' && <SakuraScene reduceMotion={settings.reduceMotion} dim={route.name !== 'home'} />}
      <nav className="relative z-10 w-[60px] shrink-0 flex flex-col items-center pt-3 pb-3 gap-1 border-r border-line bg-panel/60 drag">
        <div className="h-9 w-9 mb-3 rounded-xl bg-accent/15 text-accent flex items-center justify-center no-drag" title="Aurel">
          <Logo />
        </div>
        {nav.map((n) => (
          <button key={n.key} onClick={n.go} title={n.label} className={cx('no-drag h-10 w-10 rounded-xl flex items-center justify-center transition-colors', n.on ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg hover:bg-fg/[0.06]')}>
            <n.icon size={19} strokeWidth={1.8} />
          </button>
        ))}
        {studioOpen && (
          <button title="Studio" className="no-drag h-10 w-10 rounded-xl flex items-center justify-center bg-accent/15 text-accent"><Music2 size={19} strokeWidth={1.8} /></button>
        )}
        <div className="flex-1" />
        <button onClick={() => go({ name: 'settings' })} title="Settings" className={cx('no-drag h-10 w-10 rounded-xl flex items-center justify-center transition-colors', route.name === 'settings' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg hover:bg-fg/[0.06]')}>
          <SettingsIcon size={19} strokeWidth={1.8} />
        </button>
      </nav>

      <main className="flex-1 min-w-0 flex flex-col relative z-10">
        {route.name !== 'studio' && <div className="h-10 shrink-0 drag" />}
        <div className="flex-1 min-h-0">
          {route.name === 'home' && <Home />}
          {route.name === 'library' && <Library />}
          {route.name === 'settings' && <SettingsPage section={route.section} />}
          {route.name === 'studio' && <Studio key={route.projectId} projectId={route.projectId} />}
        </div>
      </main>

      {jobList.length > 0 && (
        <div className="fixed left-[72px] bottom-[76px] z-40 flex flex-col gap-2 w-[340px]">
          {jobList.map((j) => (
            <div key={j.jobId} className="card shadow-xl px-3.5 py-3 animate-fadein">
              <div className="flex items-center gap-2">
                <FileAudio size={15} className={j.error ? 'text-bad' : 'text-accent'} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium truncate flex gap-2"><span className="truncate">{j.label}</span>{!j.done && !j.error && j.pct >= 0 && <span className="ml-auto shrink-0 tabular-nums text-accent">{Math.floor(j.pct * 100)}%</span>}</div>
                  <div className="text-[11.5px] text-muted truncate">{j.error ? j.error.split('\n')[0] : j.stage}{j.message ? ` · ${j.message}` : ''}</div>
                </div>
                {!j.done && <button className="icon-btn !h-6 !w-6" title="Cancel" onClick={() => api.jobs.cancel(j.jobId)}><X size={13} /></button>}
              </div>
              {!j.done && <Progress pct={j.pct} className="mt-2" />}
            </div>
          ))}
        </div>
      )}

      <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div key={t.id} className="card shadow-xl pl-3 pr-2 py-2.5 flex items-center gap-2.5 max-w-[420px] animate-fadein">
            {t.kind === 'ok' ? <Check size={15} className="text-ok shrink-0" /> : t.kind === 'error' ? <AlertCircle size={15} className="text-bad shrink-0" /> : <Info size={15} className="text-accent shrink-0" />}
            <span className="text-[13px]">{t.text}</span>
            {t.action && <button className="btn-soft !h-7" onClick={t.action.run}>{t.action.label}</button>}
          </div>
        ))}
      </div>

      {dragging && (
        <div className="fixed inset-0 z-[60] bg-bg/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-accent/70 rounded-2xl px-16 py-12 text-center">
            <FileAudio size={34} className="mx-auto text-accent mb-3" />
            <div className="font-display text-xl">Drop to import</div>
            <div className="text-muted mt-1">Audio or video files</div>
          </div>
        </div>
      )}
      <ContextMenuHost />
      <NewCompositionDialog />
      <YouTubeDialog />
      <UrlDialog />
      <UpdateDialog />
    </div>
  )
}

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 19 L10.5 4.5 L17 19" />
      <path d="M7 13.2 H14" />
      <circle cx="18.5" cy="17.5" r="2.2" fill="currentColor" stroke="none" />
      <path d="M20.6 17.4 V8.2" />
    </svg>
  )
}
