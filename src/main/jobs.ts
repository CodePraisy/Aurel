import { BrowserWindow } from 'electron'
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import type { JobUpdate } from '@shared/types'

interface Job { key?: string; update: JobUpdate; procs: Set<ChildProcess>; cancelled: boolean; controller: AbortController }
const jobs = new Map<string, Job>()

export class Cancelled extends Error { constructor() { super('Cancelled') } }

export function broadcast(u: JobUpdate): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('job:update', u)
}

export interface JobCtx {
  signal: AbortSignal
  id: string
  progress(stage: string, pct: number, message?: string): void
  log(line: string): void
  run(cmd: string, args: string[], opts?: SpawnOptions & { onLine?: (line: string, stream: 'out' | 'err') => void }): Promise<{ code: number; out: string; err: string }>
  check(): void
}

/** Start a background job; returns its id immediately. */
export function startJob(kind: JobUpdate['kind'], fn: (ctx: JobCtx) => Promise<unknown>, onUpdate = broadcast, options: { key?: string; projectId?: string } = {}): string {
  const existing = options.key && [...jobs.values()].find((job) => job.key === options.key && !job.update.done)
  if (existing) return existing.update.jobId
  const id = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const job: Job = { key: options.key, update: { jobId: id, kind, projectId: options.projectId, stage: 'Starting', pct: -1 }, procs: new Set(), cancelled: false, controller: new AbortController() }
  jobs.set(id, job)
  const send = (patch: Partial<JobUpdate>) => { job.update = { ...job.update, ...patch, log: patch.log }; onUpdate(job.update) }
  const ctx: JobCtx = {
    signal: job.controller.signal,
    id,
    progress: (stage, pct, message) => { ctx.check(); send({ stage, pct, message }) },
    log: (line) => send({ log: line }),
    check: () => { if (job.cancelled) throw new Cancelled() },
    run: (cmd, args, opts = {}) => new Promise((resolve, reject) => {
      ctx.check()
      const p = spawn(cmd, args, { windowsHide: true, ...opts })
      job.procs.add(p)
      let out = ''
      let err = ''
      const lines = (stream: 'out' | 'err') => {
        let buf = ''
        return (chunk: Buffer) => {
          const s = chunk.toString()
          if (stream === 'out') out += s
          else err += s
          if (err.length > 200_000) err = err.slice(-100_000)
          buf += s
          const parts = buf.split(/\r\n|\r|\n/)
          buf = parts.pop() ?? ''
          for (const l of parts) if (l.trim()) opts.onLine?.(l, stream)
        }
      }
      p.stdout?.on('data', lines('out'))
      p.stderr?.on('data', lines('err'))
      p.on('error', (e) => { job.procs.delete(p); reject(e) })
      p.on('close', (code) => {
        job.procs.delete(p)
        if (job.cancelled) reject(new Cancelled())
        else resolve({ code: code ?? -1, out, err })
      })
    })
  }
  setImmediate(async () => {
    try {
      const result = await fn(ctx)
      send({ stage: 'Done', pct: 1, done: true, result })
    } catch (e) {
      const cancelled = job.cancelled || e instanceof Cancelled
      const msg = cancelled ? 'Cancelled' : (e as Error).message
      send({ stage: cancelled ? 'Cancelled' : 'Failed', pct: 0, done: true, error: msg })
    } finally {
      setTimeout(() => jobs.delete(id), 60_000)
    }
  })
  return id
}

export function cancelJob(id: string): void {
  const job = jobs.get(id)
  if (!job || job.update.done) return
  job.cancelled = true
  job.controller.abort()
  for (const p of job.procs) killTree(p)
}

export function activeJobs(): JobUpdate[] {
  return [...jobs.values()].filter((j) => !j.update.done).map((j) => j.update)
}

function killTree(p: ChildProcess): void {
  if (!p.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true })
  else p.kill('SIGTERM')
}
