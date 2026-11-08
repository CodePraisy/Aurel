import { useEffect, useState } from 'react'
import { useProject } from '@/store/project'
import { Download, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useApp } from '@/store/app'
import { Modal, Progress } from '@/components/ui'

export function UpdateDialog() {
  const { update, updateReady, settings, jobs, track, updateSettings } = useApp()
  const job = Object.values(jobs).reverse().find((j) => j.kind === 'update')
  const [starting, setStarting] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [readyHidden, setReadyHidden] = useState(false)
  useEffect(() => { setReadyHidden(false) }, [updateReady])
  const close = () => useApp.setState({ update: null })
  const running = starting || (!!job && !job.done)
  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    try {
      await useProject.getState().save()
      await api.updates.restart()
    } catch (error) {
      useApp.getState().toast((error as Error).message, 'error')
      setRestarting(false)
    }
  }
  if (updateReady) {
    if (readyHidden) return <button className="fixed bottom-20 right-5 z-[90] btn-soft shadow-xl !bg-panel border border-line" onClick={() => setReadyHidden(false)}>Update ready · Restart…</button>
    return <Modal open title={`Aurel ${updateReady.version} is ready`} width={420} onClose={() => { if (!restarting) setReadyHidden(true) }} footer={<>
      <button className="btn-ghost" disabled={restarting} onClick={() => setReadyHidden(true)}>Later</button>
      <button className="btn-primary" disabled={restarting} onClick={() => void restart()}>{restarting ? 'Restarting…' : 'Restart now'}</button>
    </>}>
      <p className="text-muted">The update has downloaded. Restart now to install it, or keep working and restart later. Your current piece will be saved before restarting.</p>
    </Modal>
  }
  if (!update?.available) return null
  const install = async () => {
    if (running) return
    setStarting(true)
    try {
      const { jobId } = await api.updates.install()
      track(jobId, `Updating to Aurel ${update.version}`)
    } catch (error) {
      useApp.getState().toast((error as Error).message, 'error')
    } finally { setStarting(false) }
  }
  return <Modal open onClose={close} width={520} title={running ? `Downloading Aurel ${update.version}` : `Aurel ${update.version} is available`}>
    <p className="text-muted mb-3">You have version {update.current}. {update.canInstall ? 'Download in the background and keep working. Aurel will ask before restarting to install it.' : 'Download it from the release page.'}</p>
    {update.notes && !running && <div className="card p-3 mb-4 max-h-[240px] overflow-auto whitespace-pre-wrap text-[12.5px] leading-relaxed select-text">{update.notes}</div>}
    {job?.error && <p className={job.error === 'Cancelled' ? 'text-muted mb-3' : 'text-bad mb-3'} role="status">{job.error === 'Cancelled' ? 'Update download cancelled. You can try again whenever you’re ready.' : job.error}</p>}
    {job && !job.done && <div className="mb-4" role="status">
      <div className="flex justify-between text-[12.5px] mb-1.5"><span>{job.stage}{job.message ? ` · ${job.message}` : ''}</span>{job.pct >= 0 && <span className="tabular-nums text-accent">{Math.floor(job.pct * 100)}%</span>}</div>
      <Progress pct={job.pct} />
    </div>}
    <div className="flex items-center gap-2">
      {!running && <button className="btn-ghost mr-auto" onClick={() => { void updateSettings({ skippedVersion: update.version ?? '' }); close() }}>Skip this version</button>}
      <button className="btn-ghost" onClick={close}>{running ? 'Keep working' : 'Later'}</button>
      {running ? <button className="btn-soft" disabled={!job || job.done} onClick={() => { if (job) void api.jobs.cancel(job.jobId) }}>Cancel download</button> : update.canInstall
        ? <button className="btn-primary" onClick={() => void install()}><Download size={14} /> Download update</button>
        : <button className="btn-primary" onClick={() => { if (update.page) void api.shell.openExternal(update.page); close() }}>Open download page</button>}
      {starting && <Loader2 size={14} className="animate-spin" />}
    </div>
    {settings?.checkUpdates && <p className="text-[11.5px] text-faint mt-3">Turn off update checks in Settings → About & limits.</p>}
  </Modal>
}
