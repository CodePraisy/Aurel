import { useEffect, useRef, useState } from 'react'
import { player } from '@/audio/player'
import { midi } from '@/audio/midi'
import { useProject } from '@/store/project'
import { ContextMenuHost } from '@/components/menu'
import { SakuraScene } from '@/components/Sakura'
import { NoteField } from '@/components/NoteField'
import Sidebar from '@/components/Sidebar'
import { openSession } from '@/store/sessions'
import { RefreshCw, X, Check, AlertCircle, Info, FileAudio } from 'lucide-react'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { cx, Modal, Progress } from '@/components/ui'
import Home from '@/pages/Home'
import Library from '@/pages/Library'
import SettingsPage from '@/pages/Settings'
import Studio from '@/pages/Studio'
import { NewCompositionDialog, YouTubeDialog, UrlDialog } from '@/pages/Dialogs'
import { UpdateDialog } from '@/pages/UpdateDialog'
import { installSpatialNav } from '@/lib/spatialNav'

export default function App() {
  const { route, go, settings, loadSettings, refreshLibrary, refreshEngine, toasts, jobs, importFile } = useApp()
  const [systemStill, setSystemStill] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const still = !!settings?.reduceMotion || systemStill
  const [version] = useState(() => api.updates.version())
  const [updateStatus, setUpdateStatus] = useState<{ checking: boolean; error?: string } | null>(null)
  const updateRequest = useRef(0)
  const closeUpdateStatus = () => { updateRequest.current++; setUpdateStatus(null) }
  const checkForUpdates = async () => {
    if (updateStatus?.checking) return
    const request = ++updateRequest.current
    setUpdateStatus({ checking: true })
    try {
      const result = await api.updates.check()
      if (request !== updateRequest.current) return
      if (result.available) {
        setUpdateStatus(null)
        useApp.setState({ update: result })
      } else setUpdateStatus({ checking: false, error: result.error })
    } catch (error) {
      if (request === updateRequest.current) setUpdateStatus({ checking: false, error: (error as Error).message })
    }
  }
  const [openJob, setOpenJob] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => { void loadSettings(); void refreshLibrary(); void refreshEngine() }, [loadSettings, refreshLibrary, refreshEngine])
  // arrow keys move between buttons, cards and rows on every page
  useEffect(() => installSpatialNav(), [])
  // every piece you open stays in the sidebar until you close it
  const openId = route.name === 'studio' ? route.projectId : null
  useEffect(() => { if (openId && settings) openSession(openId) }, [openId, !!settings])
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
    void api.updates.check().then((u) => {
      const current = useApp.getState().settings
      if (current?.checkUpdates && u.available && u.version !== current.skippedVersion) useApp.setState({ update: u })
    }, () => undefined)
  }, [settings?.checkUpdates])
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
    player.configure({ sampleRate: settings.sampleRate, bufferSize: settings.bufferSize, sinkId: settings.outputDevice, volume: settings.masterVolume, fxDefaults: settings.fxDefaults, effectTails: settings.effectTails, customSounds: settings.customSounds, soundSwaps: settings.soundSwaps, vstInstruments: settings.vstInstruments })
    document.documentElement.style.zoom = String(settings.uiScale || 1)
  }, [settings])
  useEffect(() => {
    if (!settings) return
    const r = document.documentElement
    r.dataset.theme = settings.theme
    r.dataset.accent = settings.theme === 'sakura' ? '' : settings.accent
    ;(window as unknown as { __aurelSettings: typeof settings }).__aurelSettings = settings
  }, [settings])
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setSystemStill(preference.matches)
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.motion = still ? "reduce" : ""
  }, [still])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return
      const editor = useProject.getState()
      if (!editor.project) return
      event.preventDefault()
      if (event.repeat) return
      const { toast } = useApp.getState()
      void editor.save().then(() => toast('Score saved.', 'ok'), (error: Error) => toast(`Could not save: ${error.message}`, 'error'))
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [])

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
  const jobList = Object.values(jobs).reverse()
  const selectedJob = openJob ? jobs[openJob] : undefined
  const dim = route.name !== 'home'

  return (
    <div className="h-full flex relative">
      {settings.theme === 'sakura'
        ? <SakuraScene dim={dim} petals={settings.particles} />
        : <div className={cx('theme-scene', dim && 'theme-scene-dim')} aria-hidden="true">
            <NoteField count={settings.particles} dim={dim} theme={settings.theme} accent={settings.accent} still={still} speed={settings.particleSpeed ?? 1} scale={settings.particleSize ?? 1} />
          </div>}
      <Sidebar version={version} checking={!!updateStatus?.checking} onCheckUpdates={() => void checkForUpdates()} />

      <main className="flex-1 min-w-0 flex flex-col relative z-10">
        {route.name !== 'studio' && <div className="h-10 shrink-0 drag" />}
        <div key={route.name === 'studio' ? `studio-${route.projectId}` : route.name} className="flex-1 min-h-0 animate-page">
          {route.name === 'home' && <Home />}
          {route.name === 'library' && <Library />}
          {route.name === 'settings' && <SettingsPage section={route.section} />}
          {route.name === 'studio' && <Studio key={route.projectId} projectId={route.projectId} />}
        </div>
      </main>

      {jobList.length > 0 && (
        <div className={cx('fixed bottom-[76px] z-40 flex flex-col gap-2 w-[340px] max-h-[45vh] overflow-y-auto transition-[left] duration-300', settings.sidebarOpen ? 'left-[240px]' : 'left-[76px]')}>
          {jobList.map((j) => (
            <div key={j.jobId} className="card shadow-xl px-3.5 py-3 animate-slidein">
              <div className="flex items-center gap-2">
                <FileAudio size={15} className={j.error ? 'text-bad' : 'text-accent'} />
                <button className="flex-1 min-w-0 text-left hover:text-accent rounded" title="View job details" onClick={() => setOpenJob(j.jobId)}>
                  <div className="text-[12.5px] font-medium truncate flex gap-2"><span className="truncate">{j.label}</span>{!j.done && !j.error && j.pct >= 0 && <span className="ml-auto shrink-0 tabular-nums text-accent">{Math.floor(j.pct * 100)}%</span>}</div>
                  <div className="text-[11.5px] text-muted truncate">{j.error ? j.error.split('\n')[0] : j.stage}{j.message ? ` · ${j.message}` : ''}</div>
                </button>
                {!j.done && <button className="icon-btn !h-6 !w-6" title="Cancel" onClick={() => api.jobs.cancel(j.jobId)}><X size={13} /></button>}
              </div>
              {!j.done && <Progress pct={j.pct} className="mt-2" />}
            </div>
          ))}
        </div>
      )}

      <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div key={t.id} className="card shadow-xl pl-3 pr-2 py-2.5 flex items-center gap-2.5 max-w-[420px] animate-toast">
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
      {selectedJob && <Modal open title={selectedJob.label} onClose={() => setOpenJob(null)} footer={<>
        {selectedJob.projectId && <button className="btn-primary" onClick={() => {
          go({ name: 'studio', projectId: selectedJob.projectId! })
          setOpenJob(null)
        }}>{selectedJob.kind === 'process' ? 'Open project' : 'Open recording'}</button>}
        {!selectedJob.done && <button className="btn-soft" onClick={() => void api.jobs.cancel(selectedJob.jobId)}>Cancel job</button>}
        <button className="btn-ghost" onClick={() => setOpenJob(null)}>Close</button>
      </>}>
        <div className="text-[13px] text-muted">{selectedJob.stage}{selectedJob.message ? ` · ${selectedJob.message}` : ''}</div>
        {!selectedJob.done && <Progress pct={selectedJob.pct} className="mt-3" />}
        {selectedJob.error && <p className="text-bad whitespace-pre-wrap mt-3">{selectedJob.error}</p>}
        {selectedJob.logs.length > 0 && <details className="mt-4 text-[12px] text-muted">
          <summary className="cursor-pointer">Activity log</summary>
          <pre className="max-h-44 overflow-auto mt-2 whitespace-pre-wrap">{selectedJob.logs.join('\n')}</pre>
        </details>}
      </Modal>}
      <ContextMenuHost />
      <NewCompositionDialog />
      <YouTubeDialog />
      <UrlDialog />
      {updateStatus && <Modal open title="Check for updates" width={365} onClose={closeUpdateStatus}
        footer={<button className="btn-soft" onClick={closeUpdateStatus}>{updateStatus.checking ? 'Cancel' : 'Close'}</button>}>
        <div className="flex items-center gap-3 text-sm" role="status">
          {updateStatus.checking ? <><RefreshCw size={20} className="shrink-0 animate-spin text-accent" /> Checking GitHub for a newer version…</> :
            updateStatus.error ? <><AlertCircle size={20} className="shrink-0 text-bad" />{updateStatus.error}</> :
            <><Check size={20} className="shrink-0 text-ok" />You’re up to date. Aurel v{version} is the latest version.</>}
        </div>
      </Modal>}
      <UpdateDialog />
    </div>
  )
}

export { Logo } from '@/components/Sidebar'
