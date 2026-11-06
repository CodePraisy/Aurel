import { useEffect } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useApp } from '@/store/app'
import { Modal, Progress } from '@/components/ui'

/** Offers a newer release from GitHub; installing it downloads, installs and restarts Aurel. */
export function UpdateDialog() {
  const { update, settings, jobs, track, updateSettings } = useApp()
  const job = Object.values(jobs).find((j) => j.kind === 'update')
  useEffect(() => { if (job?.error) useApp.getState().toast(job.error.split('\n')[0], 'error') }, [job?.error])
  if (!update?.available) return null
  const close = () => useApp.setState({ update: null })
  const running = !!job && !job.done
  const install = async () => { const { jobId } = await api.updates.install(); track(jobId, `Updating to Aurel ${update.version}`) }
  return (
    <Modal open onClose={running ? () => undefined : close} width={520} title={`Aurel ${update.version} is available`}>
      <p className="text-muted mb-3">You have version {update.current}. {update.canInstall ? 'Aurel downloads the new version, installs it and restarts. Your library and settings are kept.' : 'Download it from the release page.'}</p>
      {update.notes && <div className="card p-3 mb-4 max-h-[240px] overflow-auto whitespace-pre-wrap text-[12.5px] leading-relaxed select-text">{update.notes}</div>}
      {running && (
        <div className="mb-4" role="status">
          <div className="flex justify-between text-[12.5px] mb-1.5"><span>{job.stage}{job.message ? ` · ${job.message}` : ''}</span>{job.pct >= 0 && <span className="tabular-nums text-accent">{Math.floor(job.pct * 100)}%</span>}</div>
          <Progress pct={job.pct} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <button className="btn-ghost mr-auto" disabled={running} onClick={() => { void updateSettings({ skippedVersion: update.version ?? '' }); close() }}>Skip this version</button>
        <button className="btn-ghost" disabled={running} onClick={close}>Later</button>
        {update.canInstall
          ? <button className="btn-primary" disabled={running} onClick={() => void install()}>{running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {running ? 'Updating…' : 'Update now'}</button>
          : <button className="btn-primary" onClick={() => { if (update.page) void api.shell.openExternal(update.page); close() }}>Open download page</button>}
      </div>
      {settings?.checkUpdates && <p className="text-[11.5px] text-faint mt-3">Turn off update checks in Settings → About.</p>}
    </Modal>
  )
}
