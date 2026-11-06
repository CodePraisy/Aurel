import workletUrl from './stream-worklet.js?url&no-inline'
import { api } from '@/lib/api'
import type { VstFailure, VstSlotSpec } from '@shared/sounds'

// ---------- audio ports arrive from the preload script ----------
const waiting = new Map<string, (port: MessagePort) => void>()
const early = new Map<string, MessagePort>()
window.addEventListener('message', (e) => {
  if (e.source !== window || (e.data as { type?: string })?.type !== 'aurel-vst-port' || !e.ports[0]) return
  const session = (e.data as { session: string }).session
  const resolve = waiting.get(session)
  if (resolve) { waiting.delete(session); resolve(e.ports[0]) }
  else early.set(session, e.ports[0])
})
function nextPort(session: string): Promise<MessagePort> {
  early.delete(session)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(session); reject(new Error('The plug-in track did not connect.')) }, 8000)
    waiting.set(session, (port) => { clearTimeout(timer); resolve(port) })
  })
}

const worklets = new WeakMap<BaseAudioContext, Promise<void>>()
function ensureWorklet(ctx: BaseAudioContext): Promise<void> {
  let ready = worklets.get(ctx)
  if (!ready) { ready = ctx.audioWorklet.addModule(workletUrl); worklets.set(ctx, ready) }
  return ready
}

/**
 * One part played through VST3 plug-ins in real time. Its host process keeps the
 * plug-ins loaded; this side sends timed events and plays the streamed result.
 * Times are frames of the AudioContext clock.
 */
export class NativeTrack {
  node: AudioWorkletNode | null = null
  latency = 0
  failures: VstFailure[] = []
  error: string | null = null
  loading = true
  private gen = 0
  private queue: string[] = []
  private flushing = false
  private chainRun: Promise<void> = Promise.resolve()
  private chainKey: unknown = null
  readonly ready: Promise<boolean>

  constructor(
    readonly session: string,
    private readonly ctx: AudioContext,
    private output: AudioNode,
    private readonly block: number,
    private lookahead: number,
    private readonly changed: () => void
  ) {
    this.ready = this.open()
  }

  private async open(): Promise<boolean> {
    try {
      await ensureWorklet(this.ctx)
      const port = nextPort(this.session)
      const opened = await api.vst.open(this.session, this.ctx.sampleRate, this.block)
      if (!opened.available) {
        port.catch(() => undefined)
        this.error = opened.reason ?? 'VST3 plug-ins are not available.'
        return false
      }
      const hostPort = await port
      if (this.ctx.state === 'closed') return false
      const node = new AudioWorkletNode(this.ctx, 'aurel-stream', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
        processorOptions: { lookahead: this.lookahead, interval: Math.max(128, this.block), ring: 1 << 18 }
      })
      node.port.postMessage({ type: 'port', port: hostPort }, [hostPort])
      node.connect(this.output)
      this.captureSource?.connect(node)
      this.node = node
      return true
    } catch (e) {
      this.error = (e as Error).message
      return false
    } finally {
      this.loading = false
      this.changed()
    }
  }

  private captureSource: AudioNode | null = null

  /** Route the streamed audio into `output`; `capture` (if any) feeds the plug-ins live. */
  connect(output: AudioNode, capture: AudioNode | null): void {
    if (output !== this.output) {
      this.output = output
      if (this.node) { this.node.disconnect(); this.node.connect(output) }
    }
    if (capture !== this.captureSource) {
      if (this.captureSource && this.node) try { this.captureSource.disconnect(this.node) } catch { /* not connected */ }
      this.captureSource = capture
      if (capture && this.node) capture.connect(this.node)
    }
  }

  /** Bring the loaded plug-ins in line with the part. Calls with the same key are skipped. */
  setChain(key: unknown, slots: VstSlotSpec[]): Promise<void> {
    if (key === this.chainKey) return this.chainRun
    this.chainKey = key
    this.chainRun = this.chainRun.then(async () => {
      if (!(await this.ready) || this.chainKey !== key) return
      try {
        const result = await api.vst.chain(this.session, slots)
        if (this.chainKey !== key) return
        this.latency = result.latency
        this.failures = result.failures
        this.error = result.available ? null : result.reason ?? 'VST3 plug-ins are not available.'
      } catch (e) {
        this.error = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      }
      this.changed()
    })
    return this.chainRun
  }

  /** Forget the loaded chain so the next setChain reloads it (after a crash). */
  invalidate(): void { this.chainKey = null }

  private send(...lines: string[]): void {
    this.queue.push(...lines)
    if (this.flushing) return
    this.flushing = true
    queueMicrotask(() => {
      this.flushing = false
      const batch = this.queue
      this.queue = []
      if (batch.length) api.vst.send(this.session, batch)
    })
  }

  frameOf(time: number): number { return Math.round(time * this.ctx.sampleRate) }

  /** Start a new timeline at `frame`: drops everything scheduled before and silences held notes. */
  reset(frame: number): void {
    this.gen++
    this.node?.port.postMessage({ type: 'reset', gen: this.gen, frame })
    this.send(`reset\t${this.gen}\t${frame}`)
  }
  expect(frame: number): void { this.node?.port.postMessage({ type: 'expect', frame }) }
  capture(delayFrames: number | null): void { this.node?.port.postMessage({ type: 'capture', delay: delayFrames ?? -1 }) }
  setLookahead(frames: number): void { this.lookahead = frames; this.node?.port.postMessage({ type: 'lookahead', frames }) }
  noteOn(frame: number, pitch: number, velocity: number): void { this.send(`on\t${frame}\t${pitch}\t${Math.max(1, Math.min(127, Math.round(velocity)))}`) }
  noteOff(frame: number, pitch: number): void { this.send(`off\t${frame}\t${pitch}`) }
  allOff(frame: number): void { this.send(`alloff\t${frame}`) }
  file(frame: number, offset: number, ref: string | null): void { this.send(ref ? `file\t${frame}\t${Math.max(0, Math.round(offset))}\t${ref}` : `file\t${frame}\t0`) }
  tempo(bpm: number, num: number, den: number): void { this.send(`tempo\t${+bpm.toFixed(3)}\t${num}\t${den}`) }
  playing(on: boolean): void { this.send(`playing\t${on ? 1 : 0}`) }
  /** Silence effect tails now. */
  flush(): void { this.send('flush') }

  close(): void {
    this.node?.disconnect()
    this.node = null
    void this.ready.then(() => api.vst.close(this.session)).catch(() => undefined)
  }
}
