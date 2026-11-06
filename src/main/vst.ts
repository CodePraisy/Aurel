import { app, MessageChannelMain, type MessagePortMain, type WebContents } from 'electron'
import fs from 'fs'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { basename, isAbsolute, join, sep } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import type {
  StemStream, VstChainResult, VstComponent, VstConfiguration, VstEvent, VstFailure, VstModule, VstParameter, VstRenderSpec, VstSlotSpec
} from '@shared/sounds'
import { getSettings, paths } from './store'

const runFile = promisify(execFile)

// ---------------------------------------------------------------- locating the host

function hostPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'vst-host', 'aurel-vst-host.exe')
    : join(app.getAppPath(), 'build', 'vst-host', 'aurel-vst-host.exe')
}

/** The command that runs the host. AUREL_VST_HOST ("program|arg|…") replaces it for tests. */
function hostCommand(): { cmd: string; args: string[] } | null {
  const override = process.env.AUREL_VST_HOST
  if (override) {
    const [cmd, ...args] = override.split('|')
    return { cmd, args }
  }
  if (process.platform !== 'win32' || !fs.existsSync(hostPath())) return null
  return { cmd: hostPath(), args: [] }
}

const UNAVAILABLE = 'The VST3 host is not available in this build of Aurel.'

function vstRoots(): string[] {
  const common = process.env.CommonProgramW6432 ?? process.env.CommonProgramFiles
  const local = process.env.LOCALAPPDATA
  const roots = [common && join(common, 'VST3'), local && join(local, 'Programs', 'Common', 'VST3'), ...getSettings().vstFolders]
  return [...new Set(roots.filter((root): root is string => typeof root === 'string' && isAbsolute(root)))]
}

const disabled = (path: string) => getSettings().vstDisabled.includes(path.toLowerCase())

// ---------------------------------------------------------------- load failures, kept between runs

const failuresFile = () => join(paths.data, 'vst-failures.json')
let failureCache: VstFailure[] | null = null

export function vstFailures(): VstFailure[] {
  if (!failureCache) {
    try { failureCache = JSON.parse(fs.readFileSync(failuresFile(), 'utf8')) } catch { failureCache = [] }
  }
  return failureCache!
}

function recordFailure(failure: Omit<VstFailure, 'at'>): VstFailure {
  const entry = { ...failure, at: Date.now() }
  const rest = vstFailures().filter((f) => !(f.path === entry.path && f.name === entry.name))
  failureCache = [entry, ...rest].slice(0, 50)
  try { fs.writeFileSync(failuresFile(), JSON.stringify(failureCache, null, 1)) } catch { /* best effort */ }
  return entry
}

function clearFailure(path: string, name: string): void {
  const list = vstFailures()
  const next = list.filter((f) => !(f.path === path && f.name === name))
  if (next.length === list.length) return
  failureCache = next
  try { fs.writeFileSync(failuresFile(), JSON.stringify(failureCache, null, 1)) } catch { /* best effort */ }
}

export function clearVstFailures(): void {
  failureCache = []
  try { fs.rmSync(failuresFile(), { force: true }) } catch { /* ignore */ }
}

// ---------------------------------------------------------------- scanning

export async function scanVst() {
  const roots = vstRoots()
  const available = !!hostCommand()
  const modules = new Map<string, VstModule & { disabled: boolean }>()
  const visited = new Set<string>()
  async function visit(dir: string, depth: number) {
    if (depth > 10 || modules.size >= 1000 || visited.size >= 5000) return
    const resolved = await realpath(dir).catch(() => null)
    if (!resolved || visited.has(resolved.toLowerCase())) return
    visited.add(resolved.toLowerCase())
    for (const entry of await readdir(resolved, { withFileTypes: true }).catch(() => [])) {
      const path = join(resolved, entry.name)
      if (/\.vst3$/i.test(entry.name) && (entry.isFile() || entry.isDirectory())) {
        modules.set(path.toLowerCase(), { path, name: basename(entry.name).slice(0, -5), disabled: disabled(path) })
      } else if (entry.isDirectory()) await visit(path, depth + 1)
    }
  }
  if (available) for (const root of roots) await visit(root, 0)
  return { available, roots, modules: [...modules.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

async function checkedPath(path: string): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path) || !/\.vst3$/i.test(path)) throw new Error('Select an installed VST3 plug-in.')
  const actual = await realpath(path).catch(() => null)
  if (actual) {
    const lower = actual.toLowerCase()
    for (const dir of vstRoots()) {
      const root = await realpath(dir).catch(() => null)
      if (root && lower.startsWith(root.toLowerCase().replace(/[\\/]+$/, '') + sep)) return actual
    }
  }
  throw new Error('This plug-in was not found in a configured VST3 folder.')
}

function validId(id: string): string {
  if (typeof id !== 'string' || !/^[A-Fa-f0-9]{32}$/.test(id)) throw new Error('Invalid VST3 plug-in id.')
  return id.toUpperCase()
}

async function runHost(args: string[], timeout = 20_000): Promise<string> {
  const host = hostCommand()
  if (!host) throw new Error(UNAVAILABLE)
  try {
    return (await runFile(host.cmd, [...host.args, ...args], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.trim()
  } catch (e) {
    const failure = e as Error & { stderr?: string; killed?: boolean }
    throw new Error(failure.killed ? 'The plug-in took too long to respond.' : failure.stderr?.trim().slice(0, 300) || 'The plug-in did not load. Check that it opens in your other audio software.')
  }
}

export async function vstComponents(path: string): Promise<VstComponent[]> {
  const checked = await checkedPath(path)
  try {
    const list = JSON.parse((await runHost(['list', checked])).split('\n').at(-1)!) as VstComponent[]
    clearFailure(checked, basename(checked, '.vst3'))
    return list
  } catch (e) {
    recordFailure({ path: checked, name: basename(checked, '.vst3'), message: (e as Error).message })
    throw e
  }
}

async function inspectParameters(plugin: VstConfiguration['plugin']): Promise<VstParameter[]> {
  return JSON.parse((await runHost(['inspect', await checkedPath(plugin.path), validId(plugin.id)])).split('\n').at(-1)!)
}

// ---------------------------------------------------------------- live host sessions

const MAX_STATE = 64 * 1024 * 1024
const clean = (text: string) => text.replace(/[\t\r\n]/g, ' ')
const hash = (text: string) => createHash('sha1').update(text).digest('hex')
const stateKey = (config: VstConfiguration) => hash(`${config.plugin.path}|${config.plugin.id}|${config.state?.component ?? ''}|${config.state?.controller ?? ''}`)

interface LoadedSlot { dir: string; key: string; params: Record<string, number>; config: VstConfiguration; on: boolean }
interface Pending<T> { resolve(value: T): void; reject(error: Error): void }

let ownerWindow = 0n
export function setOwnerWindow(handle: Buffer | null): void {
  ownerWindow = handle && handle.length >= 8 ? handle.readBigUInt64LE(0) : handle && handle.length >= 4 ? BigInt(handle.readUInt32LE(0)) : 0n
}

class HostSession {
  private proc: ChildProcess | null = null
  private buf = Buffer.alloc(0)
  private stderr = ''
  private stateRoot = ''
  private slots = new Map<string, LoadedSlot>()
  private chain: VstSlotSpec[] = []
  private seq = 0
  private commits = new Map<string, Pending<number>>()
  private failures: { slotId: string; message: string }[] = []
  private saved = new Map<string, Array<() => void>>()
  private editors = new Map<string, Pending<VstConfiguration>>()
  private paramWaiters = new Map<string, Pending<VstParameter[]>>()
  private crashes: number[] = []
  private closing = false
  private lastWant = 0
  private wantSince = 0
  private lastAudio = 0
  private watchdog: NodeJS.Timeout | null = null
  latency = 0
  port: MessagePortMain | null = null
  audioSink: ((frame: number, generation: number, data: Float32Array) => void) | null = null

  constructor(readonly key: string, readonly sampleRate: number, readonly block: number, private readonly notify: (event: VstEvent) => void) {}

  async start(): Promise<void> {
    const host = hostCommand()
    if (!host) throw new Error(UNAVAILABLE)
    if (!this.stateRoot) this.stateRoot = await mkdtemp(join(tmpdir(), 'aurel-track-'))
    this.buf = Buffer.alloc(0)
    this.stderr = ''
    const proc = spawn(host.cmd, [...host.args, 'serve', String(this.sampleRate), String(this.block)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The VST3 host did not start.')), 15000)
      this.onReady = () => { clearTimeout(timer); resolve() }
      proc.once('error', (e) => { clearTimeout(timer); reject(e) })
    })
    proc.stdout!.on('data', (data: Buffer) => this.read(data))
    proc.stderr!.on('data', (data: Buffer) => { this.stderr = (this.stderr + data.toString()).slice(-4000) })
    proc.stdin!.on('error', () => undefined)
    proc.on('exit', (code) => { if (this.proc === proc) void this.exited(code) })
    await ready
    this.watchdog ??= setInterval(() => this.checkAlive(), 1000)
  }

  private onReady: () => void = () => undefined

  private write(lines: string[]): void {
    if (!lines.length || !this.proc?.stdin?.writable) return
    this.proc.stdin.write(lines.join('\n') + '\n')
  }

  private read(data: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data
    while (this.buf.length >= 8) {
      const type = this.buf.readUInt32LE(0)
      const length = this.buf.readUInt32LE(4)
      if (this.buf.length < 8 + length) break
      const body = this.buf.subarray(8, 8 + length)
      this.buf = this.buf.subarray(8 + length)
      if (type === 1) this.audio(body)
      else this.text(body.toString('utf8'))
    }
  }

  private audio(body: Buffer): void {
    this.lastAudio = Date.now()
    const frame = Number(body.readBigInt64LE(0))
    const generation = body.readUInt32LE(8)
    const frames = body.readUInt32LE(12)
    if (!frames) return // heartbeat from an idle track
    const data = new Float32Array(frames * 2)
    new Uint8Array(data.buffer).set(body.subarray(16, 16 + frames * 8))
    if (this.audioSink) this.audioSink(frame, generation, data)
    else this.port?.postMessage({ g: generation, f: frame, d: data })
  }

  private text(line: string): void {
    const f = line.split('\t')
    switch (f[0]) {
      case 'ready': this.onReady(); break
      case 'chain': {
        this.latency = Number(f[2]) || 0
        this.commits.get(f[1])?.resolve(this.latency)
        this.commits.delete(f[1])
        break
      }
      case 'fail': {
        this.failures.push({ slotId: f[1], message: f[2] ?? 'The plug-in could not be loaded.' })
        if (!this.commits.size) {
          const slot = this.slots.get(f[1])
          this.notify({ session: this.key, type: 'fail', slotId: f[1], plugin: slot?.config.plugin.name, message: f[2] })
        }
        break
      }
      case 'saved': {
        const waiters = this.saved.get(f[1]) ?? []
        this.saved.delete(f[1])
        waiters.forEach((w) => w())
        break
      }
      case 'editor': this.notify({ session: this.key, type: 'editor', slotId: f[1], open: f[2] === '1' }); break
      case 'editfail': {
        this.editors.get(f[1])?.reject(new Error(f[2] ?? 'The editor could not open.'))
        this.editors.delete(f[1])
        break
      }
      case 'params': {
        try { this.paramWaiters.get(f[1])?.resolve(JSON.parse(f[2] ?? '[]')) } catch (e) { this.paramWaiters.get(f[1])?.reject(e as Error) }
        this.paramWaiters.delete(f[1])
        break
      }
      case 'latency': this.latency = Number(f[1]) || 0; this.notify({ session: this.key, type: 'latency', latency: this.latency }); break
      default: if (f[0] === 'log') console.log(`[vst ${this.key}]`, f.slice(1).join(' '))
    }
  }

  private crashedSlot(): LoadedSlot | undefined {
    const match = this.stderr.match(/crash\t([^\t\n]*)\t/)
    return match ? this.slots.get(match[1]) : undefined
  }

  private async exited(code: number | null): Promise<void> {
    this.proc = null
    if (this.closing) return
    const slot = this.crashedSlot()
    const names = slot ? slot.config.plugin.name : this.chain.map((s) => s.config.plugin.name).join(', ') || 'The VST3 host'
    const message = slot ? `${names} crashed.` : `${names} stopped unexpectedly${code ? ` (code ${code})` : ''}.`
    if (slot) recordFailure({ path: slot.config.plugin.path, name: slot.config.plugin.name, message: 'Crashed while running.' })
    for (const p of [...this.commits.values(), ...this.editors.values(), ...this.paramWaiters.values()]) p.reject(new Error(message))
    this.commits.clear(); this.editors.clear(); this.paramWaiters.clear()
    for (const waiters of this.saved.values()) waiters.forEach((w) => w())
    this.saved.clear()
    this.notify({ session: this.key, type: 'crash', slotId: slot ? [...this.slots.entries()].find(([, s]) => s === slot)?.[0] : undefined, plugin: names, message })
    const now = Date.now()
    this.crashes = [...this.crashes.filter((t) => now - t < 60_000), now]
    if (this.crashes.length > 3) {
      this.notify({ session: this.key, type: 'failed', plugin: names, message: `${message} Aurel stopped reloading it after repeated crashes.` })
      return
    }
    // A crashed plug-in is left out of the reloaded chain so it cannot take the track down again.
    const chain = slot ? this.chain.filter((s) => this.slots.get(s.id) !== slot) : this.chain
    this.slots.clear()
    try {
      await this.start()
      await this.setChain(chain)
      this.notify({ session: this.key, type: 'restarted', plugin: names, message })
    } catch (e) {
      this.notify({ session: this.key, type: 'failed', plugin: names, message: (e as Error).message })
    }
  }

  private checkAlive(): void {
    // A plug-in that hangs stops audio without exiting; restart the track after a few seconds of silence.
    if (!this.proc || !this.wantSince || this.audioSink) return
    if (this.lastAudio < this.wantSince && Date.now() - this.wantSince > 4000) {
      this.wantSince = 0
      this.stderr += '\n'
      this.proc.kill()
    }
  }

  want(frame: number): void {
    if (!Number.isFinite(frame)) return
    const target = Math.floor(frame)
    if (target <= this.lastWant) return
    this.lastWant = target
    if (!this.wantSince || this.lastAudio >= this.wantSince) this.wantSince = Date.now()
    this.write([`want\t${target}`])
  }

  /** Load, reuse or reconfigure plug-ins so the track matches `chain`. */
  async setChain(chain: VstSlotSpec[]): Promise<VstChainResult> {
    if (!this.proc) await this.start()
    const lines: string[] = []
    const after: string[] = []
    const failures: VstFailure[] = []
    const keep = new Set<string>()
    const accepted: VstSlotSpec[] = []
    for (const [index, spec] of chain.entries()) {
      const config = spec.config
      const name = config?.plugin?.name ?? 'Plug-in'
      try {
        if (!/^[\w.-]{1,64}$/.test(spec.id)) throw new Error('Invalid plug-in slot.')
        if (config.plugin.kind === 'instrument' && index > 0) throw new Error('Only one instrument can be used per track.')
        const path = await checkedPath(config.plugin.path)
        const id = validId(config.plugin.id)
        if (disabled(path)) throw new Error('This plug-in is turned off in Settings → Plug-ins.')
        const key = stateKey(config)
        const previous = this.slots.get(spec.id)
        const restore = !previous || previous.key !== key
        const dir = previous?.dir ?? join(this.stateRoot, spec.id)
        if (restore) {
          await fs.promises.mkdir(dir, { recursive: true })
          for (const part of ['component', 'controller'] as const) {
            const data = config.state?.[part]
            const file = join(dir, `${part}.bin`)
            if (typeof data === 'string' && data.length <= Math.ceil(MAX_STATE / 3) * 4) await writeFile(file, Buffer.from(data, 'base64'))
            else await rm(file, { force: true })
          }
          await writeFile(join(dir, 'params.txt'), Object.entries(config.params ?? {})
            .filter(([k, v]) => /^\d{1,10}$/.test(k) && Number.isFinite(v)).slice(0, 8192).map(([k, v]) => `${k}=${Math.max(0, Math.min(1, v))}`).join('\n'))
        } else {
          for (const [k, v] of Object.entries(config.params ?? {})) {
            if (/^\d{1,10}$/.test(k) && Number.isFinite(v) && previous!.params[k] !== v) after.push(`param\t${spec.id}\t${k}\t${Math.max(0, Math.min(1, v))}`)
          }
        }
        lines.push(['slot', spec.id, spec.on ? '1' : '0', restore ? '1' : '0', clean(name), id, dir, path].join('\t'))
        this.slots.set(spec.id, { dir, key, params: { ...(config.params ?? {}) }, config, on: spec.on })
        keep.add(spec.id)
        accepted.push(spec)
      } catch (e) {
        failures.push(recordFailure({ slotId: spec.id, path: config?.plugin?.path ?? '', name, message: (e as Error).message }))
      }
    }
    for (const id of [...this.slots.keys()]) if (!keep.has(id)) this.slots.delete(id)
    this.chain = accepted
    const seq = String(++this.seq)
    this.failures = []
    const done = new Promise<number>((resolve, reject) => this.commits.set(seq, { resolve, reject }))
    this.write([...lines, `commit\t${seq}`, ...after])
    const latency = await Promise.race([done, new Promise<number>((_, reject) => setTimeout(() => reject(new Error('Loading the plug-ins took too long.')), 90_000))])
    for (const failure of this.failures) {
      const slot = this.slots.get(failure.slotId)
      failures.push(recordFailure({ slotId: failure.slotId, path: slot?.config.plugin.path ?? '', name: slot?.config.plugin.name ?? 'Plug-in', message: failure.message }))
      this.slots.delete(failure.slotId)
    }
    for (const spec of accepted) if (this.slots.has(spec.id)) clearFailure(spec.config.plugin.path, spec.config.plugin.name)
    return { available: true, latency, failures }
  }

  send(lines: string[]): void { this.write(lines) }

  /** Live audio for the chain's input, already stamped with the frame it must be heard at. */
  input(generation: number, frame: number, data: Float32Array): void {
    const frames = data.length >> 1
    if (!this.proc?.stdin?.writable || !frames || frames > 65536 || !Number.isInteger(generation) || !Number.isFinite(frame)) return
    const header = Buffer.from(`input\t${generation}\t${Math.round(frame)}\t${frames}\n`)
    this.proc.stdin.write(Buffer.concat([header, Buffer.from(data.buffer, data.byteOffset, frames * 8)]))
  }

  private async collect(id: string): Promise<VstConfiguration> {
    const slot = this.slots.get(id)
    if (!slot) throw new Error('This plug-in is not loaded.')
    const read = (name: string) => readFile(join(slot.dir, name)).then((b) => b.toString('base64'), () => undefined)
    const [component, controller] = await Promise.all([read('component.bin'), read('controller.bin')])
    const params = { ...slot.config.params }
    const changes = await readFile(join(slot.dir, 'changed.txt'), 'utf8').catch(() => '')
    for (const line of changes.split(/\r?\n/)) {
      const [k, text] = line.split('=')
      const value = Number(text)
      if (/^\d{1,10}$/.test(k ?? '') && Number.isFinite(value)) params[k] = value
    }
    const config: VstConfiguration = { plugin: slot.config.plugin, params, state: { component, controller } }
    // The live instance already holds this state; the next chain update must not reload it.
    slot.key = stateKey(config)
    slot.params = { ...params }
    slot.config = config
    return config
  }

  /** Opens the plug-in's own editor on the instance being heard; resolves with its settings when it closes. */
  edit(id: string, title: string): Promise<VstConfiguration> {
    if (!this.slots.has(id)) return Promise.reject(new Error('This plug-in is not loaded.'))
    const existing = this.editors.get(id)
    const result = new Promise<VstConfiguration>((resolve, reject) => {
      this.editors.set(id, { resolve: (c) => { existing?.resolve(c); resolve(c) }, reject: (e) => { existing?.reject(e); reject(e) } })
    })
    const waiters = this.saved.get(id) ?? []
    waiters.push(() => {
      const pending = this.editors.get(id)
      this.editors.delete(id)
      if (pending) this.collect(id).then((config) => {
        // also announced, so the piece is updated even if its window was closed meanwhile
        this.notify({ session: this.key, type: 'saved', slotId: id, config })
        pending.resolve(config)
      }, pending.reject)
    })
    this.saved.set(id, waiters)
    this.write([`edit\t${id}\t${clean(title)}\t${ownerWindow}`])
    return result
  }

  async parameters(id: string): Promise<VstParameter[]> {
    const result = new Promise<VstParameter[]>((resolve, reject) => this.paramWaiters.set(id, { resolve, reject }))
    this.write([`params\t${id}`])
    return await Promise.race([result, new Promise<VstParameter[]>((_, reject) => setTimeout(() => reject(new Error('The plug-in did not answer.')), 10_000))])
  }

  has(id: string): boolean { return this.slots.has(id) }

  async close(): Promise<void> {
    this.closing = true
    if (this.watchdog) clearInterval(this.watchdog)
    // Closing an open editor saves its settings first.
    const open = [...this.editors.keys()]
    if (open.length && this.proc) {
      const saved = Promise.all(open.map((id) => new Promise<void>((resolve) => {
        const waiters = this.saved.get(id) ?? []
        waiters.push(resolve)
        this.saved.set(id, waiters)
      })))
      this.write(open.map((id) => `closeeditor\t${id}`))
      await Promise.race([saved, new Promise((r) => setTimeout(r, 3000))])
    }
    const proc = this.proc
    this.write(['quit'])
    this.proc = null
    if (proc) setTimeout(() => { if (proc.exitCode === null) proc.kill() }, 3000)
    this.port?.close()
    this.port = null
    if (this.stateRoot) await rm(this.stateRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

const sessions = new Map<string, HostSession>()
let notifyTarget: WebContents | null = null
const notify = (event: VstEvent) => { if (notifyTarget && !notifyTarget.isDestroyed()) notifyTarget.send('vst:event', event) }

function validSession(key: string): string {
  if (typeof key !== 'string' || !/^[\w:.-]{1,120}$/.test(key)) throw new Error('Invalid track.')
  return key
}

/** Start (or reuse) the host for one track and hand its audio port to the renderer. */
export async function openTrack(sender: WebContents, key: string, sampleRate: number, block: number): Promise<{ available: boolean; reason?: string }> {
  validSession(key)
  if (!hostCommand()) return { available: false, reason: UNAVAILABLE }
  if (![44100, 48000, 88200, 96000, 192000].includes(sampleRate) || ![64, 128, 256, 512, 1024, 2048].includes(block)) throw new Error('Unsupported audio format.')
  notifyTarget = sender
  let session = sessions.get(key)
  if (session && (session.sampleRate !== sampleRate || session.block !== block)) {
    await session.close()
    sessions.delete(key)
    session = undefined
  }
  if (!session) {
    session = new HostSession(key, sampleRate, block, notify)
    sessions.set(key, session)
    try { await session.start() } catch (e) { sessions.delete(key); throw e }
  }
  // A fresh port each time the renderer asks: the previous audio node is gone.
  session.port?.close()
  const { port1, port2 } = new MessageChannelMain()
  session.port = port1
  const owner = session
  port1.on('message', (e) => {
    const data = e.data as { want?: number; xrun?: number; i?: number; g?: number; d?: Float32Array }
    if (typeof data?.want === 'number') owner.want(data.want)
    else if (typeof data?.i === 'number' && data.d instanceof Float32Array) owner.input(data.g ?? 0, data.i, data.d)
    else if (typeof data?.xrun === 'number') notify({ session: key, type: 'xrun', message: String(data.xrun) })
  })
  port1.start()
  sender.postMessage('vst:port', { session: key }, [port2])
  return { available: true }
}

export async function closeTrack(key: string): Promise<void> {
  const session = sessions.get(key)
  sessions.delete(key)
  await session?.close()
}

export async function closeAllTracks(): Promise<void> {
  await Promise.all([...sessions.keys()].map(closeTrack))
}

export async function trackChain(key: string, chain: VstSlotSpec[]): Promise<VstChainResult> {
  const session = sessions.get(validSession(key))
  if (!session) return { available: false, latency: 0, failures: [], reason: hostCommand() ? 'The track is not open.' : UNAVAILABLE }
  if (!Array.isArray(chain) || chain.length > 32) throw new Error('Invalid effects chain.')
  return session.setChain(chain)
}

const AUDIO_OPS = new Set(['on', 'off', 'alloff', 'reset', 'tempo', 'playing', 'flush'])
const streams = new Map<string, string>() // stem stream ref -> file

/** Timed events for a track. Only well-formed numeric commands get through to the host. */
export function trackSend(key: string, lines: string[]): void {
  const session = sessions.get(key)
  if (!session || !Array.isArray(lines)) return
  const ok: string[] = []
  for (const line of lines.slice(0, 20000)) {
    if (typeof line !== 'string') continue
    const f = line.split('\t')
    if (f[0] === 'file') {
      // file <frame> <offset> <ref> — the ref is resolved here so the renderer never names a path
      const path = f[3] ? streams.get(f[3]) : ''
      if (/^-?\d+$/.test(f[1] ?? '') && /^\d+$/.test(f[2] ?? '') && path !== undefined) ok.push(path ? `file\t${f[1]}\t${f[2]}\t${path}` : `file\t${f[1]}`)
      continue
    }
    if (AUDIO_OPS.has(f[0]) && f.slice(1).every((v) => /^-?\d+(\.\d+)?$/.test(v))) ok.push(line)
  }
  session.send(ok)
}

export async function editTrackPlugin(key: string | null, slotId: string, config: VstConfiguration, title: string): Promise<VstConfiguration> {
  if (key) {
    const session = sessions.get(validSession(key))
    if (session?.has(slotId)) return session.edit(slotId, title)
  }
  // No live track (e.g. editing an instrument default in Settings): load it on its own just for editing.
  const session = new HostSession(`edit-${Date.now()}`, 48000, 512, () => undefined)
  try {
    await session.start()
    const result = await session.setChain([{ id: 'edit', on: true, config }])
    if (result.failures.length) throw new Error(result.failures[0].message)
    return await session.edit('edit', title)
  } finally {
    await session.close()
  }
}

export async function pluginParameters(key: string | null, slotId: string | null, plugin: VstConfiguration['plugin']): Promise<VstParameter[]> {
  const session = key ? sessions.get(key) : undefined
  if (session && slotId && session.has(slotId)) return session.parameters(slotId)
  return inspectParameters(plugin)
}

/** Offline render through the same host code used for playback, so an export sounds like what you heard. */
export async function renderTrack(spec: VstRenderSpec): Promise<Uint8Array> {
  const frames = Math.floor(spec.frames)
  if (!Number.isFinite(frames) || frames <= 0 || frames > 96000 * 60 * 30) throw new Error('This section is too long to render.')
  if (!Array.isArray(spec.notes) || spec.notes.length % 4) throw new Error('Invalid note data.')
  const session = new HostSession(`render-${Date.now()}`, spec.sampleRate, 512, () => undefined)
  const out = new Float32Array(frames * 2)
  let received = 0
  let inputFile = ''
  try {
    await session.start()
    const chain = await session.setChain(spec.slots)
    if (chain.failures.length) throw new Error(`${chain.failures[0].name}: ${chain.failures[0].message}`)
    const done = new Promise<void>((resolve) => {
      session.audioSink = (frame, _generation, data) => {
        const start = Math.max(0, frame)
        const end = Math.min(frames, frame + data.length / 2)
        if (end > start) out.set(data.subarray((start - frame) * 2, (end - frame) * 2), start * 2)
        received = Math.max(received, end)
        if (received >= frames) resolve()
      }
    })
    const lines = [`tempo\t${spec.tempo}\t${spec.timeSig.num}\t${spec.timeSig.den}`, 'playing\t1', 'reset\t1\t0']
    const n = spec.notes
    for (let i = 0; i < n.length; i += 4) {
      const pitch = Math.max(0, Math.min(127, Math.round(n[i + 2])))
      lines.push(`on\t${Math.round(n[i])}\t${pitch}\t${Math.max(1, Math.min(127, Math.round(n[i + 3])))}`, `off\t${Math.round(n[i + 1])}\t${pitch}`)
    }
    if (spec.file) lines.push(`file\t${Math.round(spec.file.frame)}\t${Math.max(0, Math.round(spec.file.offset))}\t${spec.file.ref}`)
    if (spec.input) {
      if (!(spec.input instanceof Uint8Array) || spec.input.byteLength % 8 || spec.input.byteLength > 1024 * 1024 * 1024) throw new Error('Invalid audio for the effects.')
      inputFile = join(tmpdir(), `aurel-render-${Date.now()}-${Math.random().toString(36).slice(2)}.f32`)
      await writeFile(inputFile, spec.input)
      const ref = hash(inputFile).slice(0, 20)
      streams.set(ref, inputFile)
      lines.push(`file\t0\t0\t${ref}`)
    }
    trackSendTo(session, lines)
    session.send([`want\t${frames}`])
    const seconds = frames / spec.sampleRate
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('The plug-ins took too long to render.')), Math.max(60_000, seconds * 3000)))])
    return new Uint8Array(out.buffer)
  } finally {
    session.audioSink = null
    await session.close()
    if (inputFile) await rm(inputFile, { force: true }).catch(() => undefined)
  }
}

function trackSendTo(session: HostSession, lines: string[]): void {
  const ok = lines.map((line) => {
    const f = line.split('\t')
    if (f[0] !== 'file') return line
    const path = streams.get(f[3])
    return path ? `file\t${f[1]}\t${f[2]}\t${path}` : ''
  }).filter(Boolean)
  session.send(ok)
}

/** Raw float audio of a stem at the playback speed and transposition, for plug-ins to process. */
export async function prepareStemStream(projectId: string, rel: string, semis: number, speed: number, sampleRate: number): Promise<StemStream> {
  if (!Number.isInteger(semis) || Math.abs(semis) > 24 || !(speed >= 0.25 && speed <= 2) || ![44100, 48000, 88200, 96000, 192000].includes(sampleRate)) {
    throw new Error('Unsupported playback settings.')
  }
  const source = paths.inProject(projectId, rel)
  const name = `${rel.replace(/[\\/]/g, '_').replace(/\.\w+$/, '')}.${semis}.${speed.toFixed(3)}.${sampleRate}.f32`
  const file = paths.inProject(projectId, `cache/stream/${name}`)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(join(file, '..'), { recursive: true })
    const filters: string[] = []
    const ratio = Math.pow(2, semis / 12)
    if (semis) filters.push(`asetrate=${Math.round(44100 * ratio)}`, 'aresample=44100')
    // atempo only accepts 0.5–2 per stage
    let tempo = speed / (semis ? ratio : 1)
    while (tempo < 0.5) { filters.push('atempo=0.5'); tempo /= 0.5 }
    while (tempo > 2) { filters.push('atempo=2'); tempo /= 2 }
    if (Math.abs(tempo - 1) > 1e-6) filters.push(`atempo=${tempo.toFixed(6)}`)
    const tmp = `${file}.tmp`
    await new Promise<void>((resolve, reject) => {
      const p = spawn(paths.ffmpeg, ['-hide_banner', '-y', '-i', source, ...(filters.length ? ['-af', filters.join(',')] : []), '-ac', '2', '-ar', String(sampleRate), '-f', 'f32le', tmp], { windowsHide: true })
      p.on('error', reject)
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('Could not prepare the recording for plug-in playback.'))))
    })
    fs.renameSync(tmp, file)
  }
  const ref = hash(file).slice(0, 20)
  streams.set(ref, file)
  return { ref, frames: Math.floor(fs.statSync(file).size / 8) }
}
