import { recordingRate } from '@shared/rhythm'
import type { Listen, Part, Project, VstInstrumentPreset } from '@shared/types'
import { PPQ } from '@shared/types'
import { flattenPart, tempoMap, scoreEndTick, type PlayNote, type TempoMap } from '@/music/score'
import { beatTicks, measureTicks } from '@/music/theory'
import { playNote, partInsert, click, warmup, DEFAULT_SOUND, SOUNDS, type SoundId, type Voice, type NoteOpts } from './synth'
import { api } from '@/lib/api'
import { buildChain } from './fx'
import { packReady, onPacksChanged, loadPack, resetMissing } from './samples'
import { customId, newFx, orderChain, type CustomSound, type FxSlot, type StemStream, type VstEvent, type VstFailure, type VstFxSlot, type VstSlotSpec } from '@shared/sounds'
import { NativeTrack } from './native'
import { customSound, setCustomSounds, swapFor, vstSwapFor } from './custom'

/** Effects used when a part has never had its chain edited. */
export function defaultFx(sound: SoundId): FxSlot[] {
  const rv = (mix: number, size = 2.2) => { const f = newFx('reverb'); f.id = 'default-reverb'; f.params.mix = mix; f.params.size = size; return f }
  const ch = (mix: number) => { const f = newFx('chorus'); f.id = 'default-chorus'; f.params.mix = mix; return f }
  switch (sound) {
    case 'piano': return [rv(0.18)]
    case 'epiano': return [ch(0.3), rv(0.15)]
    case 'clean': return [ch(0.2), rv(0.15)]
    case 'steel': case 'nylon': return [rv(0.14, 1.6)]
    case 'strings': case 'voice': case 'pad': return [rv(0.3, 3)]
    case 'brass': case 'reed': case 'lead': return [rv(0.18)]
    case 'drums': return [rv(0.08, 1.2)]
    default: return []
  }
}
let instrumentFxDefaults: Record<string, FxSlot[]> = {}
const factoryFx = new Map<SoundId, FxSlot[]>()
/** The part's own chain, or its instrument's default (one stable array per sound). */
export const fxFor = (p: Part): FxSlot[] => {
  if (p.fx) return p.fx
  const sound = soundFor(p)
  if (instrumentFxDefaults[sound]) return instrumentFxDefaults[sound]
  let chain = factoryFx.get(sound)
  if (!chain) { chain = defaultFx(sound); factoryFx.set(sound, chain) }
  return chain
}
export const soundFor = (p: Part): SoundId => {
  const chosen = (p.sound as SoundId) || DEFAULT_SOUND[p.kind]
  if (customId(chosen)) return customSound(chosen) ? chosen : DEFAULT_SOUND[p.kind] // a deleted instrument falls back to the default
  return (swapFor(chosen) as SoundId | null) ?? chosen // "use my instrument instead of …" from Settings
}

/**
 * How a part is heard:
 *  synth   built-in instrument, built-in effects (Web Audio only)
 *  stem    its isolated recording, built-in effects
 *  vsti    a VST3 instrument (and any VST3 effects), streamed from the host
 *  stemfx  its recording through VST3 effects, streamed from the host
 *  capture a built-in instrument whose sound is fed live into VST3 effects
 */
export type Route = 'synth' | 'stem' | 'vsti' | 'stemfx' | 'capture'

/** The part's VST3 instrument: its own, or one chosen in Settings to replace its built-in sound everywhere. */
export function vstFor(part: Part): Part['vstInstrument'] {
  if (part.vstInstrument) return part.vstInstrument
  const chosen = part.sound || DEFAULT_SOUND[part.kind]
  return customId(chosen) ? undefined : vstSwapFor(chosen) ?? undefined
}

export function routeFor(part: Part, hasAudio: boolean): Route {
  const plugins = fxFor(part).some((slot) => slot.type === 'vst3')
  if (part.stem && part.playback === 'audio' && hasAudio) return plugins ? 'stemfx' : 'stem'
  if (vstFor(part)) return 'vsti'
  return plugins ? 'capture' : 'synth'
}

/** The part's plug-ins in processing order: its VST3 instrument, then its VST3 effects. */
export function pluginSlots(part: Part, route: Route): VstSlotSpec[] {
  const slots: VstSlotSpec[] = []
  const instrument = vstFor(part)
  if (route === 'vsti' && instrument) slots.push({ id: 'instrument', on: true, config: instrument })
  for (const slot of orderChain(fxFor(part))) {
    if (slot.type !== 'vst3') continue
    const fx = slot as VstFxSlot
    // keep the slot object itself as the config identity, so unchanged plug-ins are not reloaded
    slots.push({ id: fx.id, on: fx.on, config: configOf(fx) })
  }
  return slots
}
const configs = new WeakMap<VstFxSlot, VstSlotSpec['config']>()
function configOf(fx: VstFxSlot): VstSlotSpec['config'] {
  let c = configs.get(fx)
  if (!c) { c = { plugin: fx.plugin, params: fx.params, state: fx.state }; configs.set(fx, c) }
  return c
}

export interface PlayerOptions {
  speed: number
  loop: { from: number; to: number } | null // measures, inclusive
  loopOn: boolean
  metronome: boolean
  metronomeVolume: number
  countIn: number // bars
  transpose: number // semitones (MIDI playback)
  compare: string | null // part id played as audio (left) + MIDI (right)
  mix: { on: boolean; volume: number } // original full mix
  trainer: { on: boolean; from: number; to: number; step: number }
  listen: Listen
}

export interface TrackStatus { loading: boolean; error: string | null; failures: VstFailure[]; latency: number; crashed: string[] }

interface Bus {
  input: AudioNode // where built-in instrument notes go
  chainIn: AudioNode // start of the built-in effects
  capture: GainNode | null // built-in sound headed for VST3 effects
  gain: GainNode
  pan: StereoPannerNode
  sound: SoundId
  route: Route
  key: string
}
interface AudioTrack {
  el: HTMLAudioElement; src: MediaElementAudioSourceNode; gain: GainNode; pan: StereoPannerNode
  partId: string | null; url: string; fxKey?: string; fxOutput?: GainNode
}
type Listener = () => void
export interface LiveNote { stop(): void }

const ids = new WeakMap<object, number>()
let nextId = 1
const idOf = (o: object | undefined) => { if (!o) return 0; let v = ids.get(o); if (!v) { v = nextId++; ids.set(o, v) } return v }

class Player {
  ctx: AudioContext | null = null
  private master!: GainNode
  private metroBus!: GainNode
  private buses = new Map<string, Bus>()
  private tracks = new Map<string, AudioTrack>()
  private native = new Map<string, NativeTrack>()
  private crashed = new Map<string, Set<string>>() // part -> slot ids left out after a crash
  private streams = new Map<string, StemStream>()
  /** True while recordings are converted for plug-in playback (speed or key changes). */
  preparingFx = false
  fxError: string | null = null
  dropouts = 0
  private project: Project | null = null
  private notes: (PlayNote & { opts: NoteOpts; sound: SoundId })[] = []
  private voices = new Set<Voice>()
  private timer: number | null = null
  private tm!: TempoMap
  private tm1!: TempoMap
  private segTick0 = 0
  private segCtx0 = 0
  private beforeWrap: { tick: number; time: number; map: TempoMap } | null = null
  private schedTick = 0
  private noteIdx = 0
  private pausedTick = 0
  private endHandled = false
  private preRoll = 0
  private startRequest = 0
  state: 'stopped' | 'playing' = 'stopped'
  countingIn = false
  private countClicks: OscillatorNode[] = []
  opts: PlayerOptions = {
    speed: 1, loop: null, loopOn: false, metronome: false, metronomeVolume: 0.6, countIn: 0, transpose: 0, compare: null,
    mix: { on: true, volume: 0.9 }, trainer: { on: false, from: 0.6, to: 1, step: 0.05 }, listen: 'parts'
  }
  private listeners = new Set<Listener>()
  private eventListeners = new Set<(e: VstEvent & { partName?: string }) => void>()
  private lastTestSound?: SoundId
  testChordSound: string | null = null

  constructor() {
    onPacksChanged(() => { if (this.ctx && this.project) this.syncBuses(); this.emit() })
    api.vst?.onEvent((e) => this.hostEvent(e))
  }

  // ---------- device settings ----------
  private sampleRatePref = 0
  private bufferSize = 256
  private sinkId = ''
  private masterVol = 0.9
  private effectTails = true

  /** Apply audio device settings; recreates the audio context if the format changed. */
  configure(o: { sampleRate?: number; bufferSize?: number; sinkId?: string; volume?: number; fxDefaults?: Record<string, FxSlot[]>; effectTails?: boolean; customSounds?: CustomSound[]; soundSwaps?: Record<string, string>; vstInstruments?: VstInstrumentPreset[] }): void {
    if (o.customSounds && setCustomSounds(o.customSounds, o.soundSwaps ?? {}, o.vstInstruments ?? []) && this.project) {
      this.setProject(this.project) // instruments may sound different now
      this.emit()
    }
    if (o.fxDefaults && o.fxDefaults !== instrumentFxDefaults) { instrumentFxDefaults = o.fxDefaults; if (this.ctx && this.project) this.syncBuses() }
    if (o.effectTails !== undefined) this.effectTails = o.effectTails
    if (o.volume !== undefined) { this.masterVol = o.volume; if (this.ctx) this.master.gain.setTargetAtTime(o.volume, this.ctx.currentTime, 0.02) }
    const format = (o.sampleRate !== undefined && o.sampleRate !== this.sampleRatePref) || (o.bufferSize !== undefined && o.bufferSize !== this.bufferSize)
    if (o.sampleRate !== undefined) this.sampleRatePref = o.sampleRate
    if (o.bufferSize !== undefined) this.bufferSize = o.bufferSize
    if (format && this.ctx) {
      this.hardStop()
      for (const t of this.native.values()) t.close()
      this.native.clear()
      for (const t of this.tracks.values()) { t.el.pause(); t.el.src = '' }
      void this.ctx.close()
      this.ctx = null
      this.buses.clear()
      this.tracks.clear()
      this.streams.clear()
      if (this.project) this.syncBuses()
      this.emit()
    }
    if (o.sinkId !== undefined && o.sinkId !== this.sinkId) {
      this.sinkId = o.sinkId
      const c = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
      void c?.setSinkId?.(o.sinkId).catch(() => undefined)
    }
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const rate = this.sampleRatePref || undefined
      this.ctx = new AudioContext({ latencyHint: this.bufferSize / (rate ?? 48000), sampleRate: rate })
      const sc = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      if (this.sinkId) void sc.setSinkId?.(this.sinkId).catch(() => undefined)
      this.master = this.ctx.createGain()
      this.master.gain.value = this.masterVol
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -6
      comp.ratio.value = 4
      this.master.connect(comp).connect(this.ctx.destination)
      this.metroBus = this.ctx.createGain()
      this.metroBus.gain.value = this.opts.metronomeVolume
      this.metroBus.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** Leave the piece: stop, and unload its plug-ins (open editors save first). */
  release(): void {
    this.hardStop()
    this.pausedTick = 0
    for (const t of this.native.values()) t.close()
    this.native.clear()
    this.crashed.clear()
    this.project = null
    this.emit()
  }

  /** Start the audio device (for measuring latency in Settings). */
  wake(): void { this.ensure(); this.emit() }

  /** What the device reports, plus the plug-in streaming buffer. */
  get latencyInfo(): { sampleRate: number; buffer: number; output: number; plugins: number } | null {
    if (!this.ctx) return null
    const plugins = Math.max(0, ...[...this.native.values()].map((t) => t.latency)) + this.lookahead
    return {
      sampleRate: this.ctx.sampleRate,
      buffer: this.ctx.baseLatency * 1000,
      output: ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000,
      plugins: (plugins / this.ctx.sampleRate) * 1000
    }
  }

  /** Frames of audio the host renders ahead of the clock. */
  private get lookahead(): number {
    const sr = this.ctx?.sampleRate ?? 48000
    return Math.max(Math.round(sr * 0.03), this.bufferSize * 4)
  }

  /** Frames between a built-in note being played and it coming back out of the plug-ins. */
  private captureDelay(track: NativeTrack): number { return this.lookahead + track.latency + 1024 + 768 }

  /** Seconds a note must be known in advance so a plug-in track can play it on time. */
  private leadFor(route: Route, track?: NativeTrack): number {
    const sr = this.ctx?.sampleRate ?? 48000
    if (!track) return 0
    if (route === 'capture') return this.captureDelay(track) / sr + 0.04
    if (route === 'vsti' || route === 'stemfx') return (this.lookahead + track.latency + 256) / sr + 0.04
    return 0
  }

  private get maxLead(): number {
    let lead = 0
    for (const part of this.project?.score.parts ?? []) {
      const route = this.route(part)
      lead = Math.max(lead, this.leadFor(route, this.native.get(part.id)))
    }
    return lead
  }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private emit(): void { this.listeners.forEach((f) => f()) }
  /** Plug-in crashes, reloads and failures, for notifications. */
  onHostEvent(fn: (e: VstEvent & { partName?: string }) => void): () => void { this.eventListeners.add(fn); return () => this.eventListeners.delete(fn) }

  setOptions(patch: Partial<PlayerOptions>): void {
    const listenChanged = patch.listen !== undefined && patch.listen !== this.opts.listen
    const loopChanged = (patch.loopOn !== undefined && patch.loopOn !== this.opts.loopOn) || (patch.loop !== undefined && patch.loop !== this.opts.loop)
    const speedChanged = patch.speed !== undefined && patch.speed !== this.opts.speed
    const transposeChanged = patch.transpose !== undefined && patch.transpose !== this.opts.transpose
    this.opts = { ...this.opts, ...patch }
    if ((speedChanged || transposeChanged || loopChanged) && !listenChanged && this.state === 'playing') this.restartAt(this.getTick())
    else if (speedChanged && this.project) this.tm = tempoMap(this.project.score, this.opts.speed)
    if (transposeChanged && this.project?.audio) void this.applyAudioTranspose().catch((error: Error) => {
      this.fxError = error.message
      this.emit()
    })
    if (listenChanged && this.ctx && this.project) {
      this.syncBuses()
      if (this.state === 'playing') this.restartAt(this.getTick())
    }
    this.applyMix()
    this.emit()
  }

  /** Called whenever the project/score changes. Cheap enough to run on every edit. */
  setProject(p: Project): void {
    const first = !this.project || this.project.id !== p.id
    const hasStems = p.score.parts.some((part) => part.stem)
    const timingChanged = !first && (p.score.tempo !== this.project!.score.tempo ||
      p.audio?.offset !== this.project!.audio?.offset ||
      recordingRate(p, this.opts.speed) !== recordingRate(this.project!, this.opts.speed))
    const resume = timingChanged && this.state === 'playing' ? this.getTick() : null
    if (first || (hasStems && !this.project?.score.parts.some((part) => part.stem))) {
      this.opts.mix = { ...this.opts.mix, on: true }
    }
    if (first) {
      this.stop()
      for (const t of this.native.values()) t.close()
      this.native.clear()
      this.crashed.clear()
      this.streams.clear()
      this.fxError = null
      this.dropouts = 0
      this.pausedTick = 0
      this.opts.loop = null
      this.opts.loopOn = false
      this.opts.speed = p.practice.speed || 1
      this.opts.listen = p.audio ? (p.practice.listen === 'transcription' && p.score.parts.length ? 'transcription' : 'original') : 'parts'
      this.opts.compare = null
      this.opts.transpose = 0
      this.shifted.clear()
    }
    this.project = p
    const s = p.score
    this.tm = tempoMap(s, this.opts.speed)
    this.tm1 = tempoMap(s, 1)
    const all: (PlayNote & { opts: NoteOpts; sound: SoundId })[] = []
    for (const part of s.parts) {
      const ns = flattenPart(part, this.tm1)
      const sound = soundFor(part)
      ns.forEach((n, i) => {
        const opts: NoteOpts = { tech: n.tech, bend: n.bend, staccato: n.staccato, accent: n.accent }
        if (n.tech?.includes('slide')) {
          // first later note that starts once this one ends (binary search; notes are sorted by tick)
          const target = n.tick + n.dur - 1
          let lo = i + 1, hi = ns.length
          while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m].tick < target) lo = m + 1; else hi = m }
          if (lo < ns.length) opts.slideTo = ns[lo].pitch - n.pitch
        }
        const prevEv = i > 0 ? ns[i - 1] : null
        if (prevEv?.tech?.includes('hammer') && prevEv.tick + prevEv.dur === n.tick) opts.legato = true
        all.push({ ...n, opts, sound })
      })
    }
    all.sort((a, b) => a.tick - b.tick)
    this.notes = all
    for (const part of s.parts) if (soundFor(part) !== 'sine' && !part.vstInstrument) void loadPack(soundFor(part))
    // plug-ins load as soon as the piece opens and stay loaded, so Play is instant
    if (!this.ctx && s.parts.some((part) => this.route(part) !== 'synth' && this.route(part) !== 'stem')) this.ensure()
    if (this.ctx) {
      this.syncBuses()
      warmup(this.ctx, all.slice(0, 400).filter((n) => this.route(s.parts.find((x) => x.id === n.partId)!) !== 'vsti').map((n) => ({ sound: n.sound, pitch: n.pitch })))
    }
    if (this.state === 'playing') this.noteIdx = this.indexAt(this.schedTick)
    this.applyMix()
    if (resume !== null) this.restartAt(resume)
    if (first) this.emit()
  }

  private indexAt(tick: number): number {
    let lo = 0, hi = this.notes.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.notes[m].tick < tick) lo = m + 1; else hi = m }
    return lo
  }

  private effective(part: Part): Part {
    if (this.opts.listen === 'transcription' && part.playback !== 'midi') return { ...part, playback: 'midi' }
    if (this.opts.listen === 'original' && part.stem && part.playback !== 'audio') return { ...part, playback: 'audio' }
    return part
  }
  private get audioRate(): number { return this.project ? recordingRate(this.project, this.opts.speed) : this.opts.speed }
  get audioScale(): number { return this.audioRate / this.opts.speed }
  route(part: Part): Route { return routeFor(this.effective(part), !!this.project?.audio) }

  /** Plug-in state for the part, for the parts list and the sound rack. */
  status(partId: string): TrackStatus | null {
    const t = this.native.get(partId)
    if (!t) return null
    return { loading: t.loading, error: t.error, failures: t.failures, latency: t.latency, crashed: [...(this.crashed.get(partId) ?? [])] }
  }

  /** Session id for a part's live plug-ins, or null when the part plays without plug-ins. */
  trackFor(partId: string): string | null { return this.native.has(partId) && this.project ? `${this.project.id}.${partId}` : null }

  /** Put a crashed plug-in back in the chain. */
  retry(partId: string): void {
    this.crashed.delete(partId)
    this.native.get(partId)?.invalidate()
    if (this.project) this.syncBuses()
    this.emit()
  }

  private slotsFor(part: Part, route: Route): { key: string; slots: VstSlotSpec[] } {
    const left = this.crashed.get(part.id)
    const slots = pluginSlots(part, route).filter((slot) => !left?.has(slot.id))
    const keys: (string | number)[] = [route, ...slots.flatMap((slot) => [idOf(slot.config), slot.on ? 1 : 0])]
    return { key: keys.join(','), slots }
  }

  private hostEvent(e: VstEvent): void {
    if (e.type === 'saved' && e.config && (!this.project || !e.session.startsWith(`${this.project.id}.`))) {
      // the piece was closed while its plug-in window was open: store the settings in the file
      const dot = e.session.indexOf('.')
      void persistPluginState(e.session.slice(0, dot), e.session.slice(dot + 1), e.slotId ?? '', e.config)
      return
    }
    if (!this.project || !e.session.startsWith(`${this.project.id}.`)) return
    const partId = e.session.slice(this.project.id.length + 1)
    const part = this.project.score.parts.find((x) => x.id === partId)
    const track = this.native.get(partId)
    if (e.type === 'xrun') { this.dropouts += Number(e.message) || 1; this.emit(); return }
    if (e.type === 'crash' && track) {
      if (e.slotId) {
        const set = this.crashed.get(partId) ?? new Set<string>()
        set.add(e.slotId)
        this.crashed.set(partId, set)
      }
      track.invalidate()
    }
    if (e.type === 'restarted' && track) {
      if (this.state === 'playing') this.restartAt(this.getTick())
    }
    if (e.type === 'failed' && track) track.error = e.message ?? 'The plug-in track stopped.'
    if (e.type === 'fail' && track) track.failures = [...track.failures, { slotId: e.slotId, path: '', name: e.plugin ?? 'Plug-in', message: e.message ?? '', at: Date.now() }]
    this.eventListeners.forEach((fn) => fn({ ...e, partName: part?.name }))
    this.emit()
  }

  private syncBuses(): void {
    const ctx = this.ensure()
    const p = this.project!
    const ids = new Set(p.score.parts.map((x) => x.id))
    for (const [id, b] of this.buses) if (!ids.has(id)) { b.pan.disconnect(); this.buses.delete(id) }
    for (const part of p.score.parts) {
      const sound = soundFor(part)
      const route = this.route(part)
      const builtins = orderChain(fxFor(part)).filter((slot) => slot.type !== 'vst3')
      const key = `${route}|${sound}|${packReady(sound)}|${JSON.stringify(builtins)}`
      let b = this.buses.get(part.id)
      if (b && b.key !== key) { b.pan.disconnect(); b.capture?.disconnect(); this.buses.delete(part.id); b = undefined }
      if (!b) {
        const gain = ctx.createGain()
        const pan = ctx.createStereoPanner()
        gain.connect(pan).connect(this.master)
        const chainIn = buildChain(ctx, builtins, gain)
        const capture = route === 'capture' ? ctx.createGain() : null
        b = { input: partInsert(ctx, sound, capture ?? chainIn), chainIn, capture, gain, pan, sound, route, key }
        this.buses.set(part.id, b)
      }
      // live plug-in track
      const wantsNative = route === 'vsti' || route === 'stemfx' || route === 'capture'
      let track = this.native.get(part.id)
      if (!wantsNative && track) { track.close(); this.native.delete(part.id); track = undefined }
      if (wantsNative) {
        if (!track) {
          track = new NativeTrack(`${p.id}.${part.id}`, ctx, b.chainIn, Math.min(512, this.bufferSize), this.lookahead, () => this.emit())
          this.native.set(part.id, track)
        }
        track.connect(b.chainIn, b.capture)
        const { key: chainKey, slots } = this.slotsFor(part, route)
        void track.setChain(chainKey, slots)
      }
    }
    for (const [id, t] of this.native) if (!ids.has(id)) { t.close(); this.native.delete(id) }
    // recordings played directly: stems without plug-ins, and the original mix
    const want = new Map<string, { url: string; partId: string | null; fx?: FxSlot[] }>()
    if (p.audio) want.set('__mix', { url: api.project.url(p.id, this.shiftedPath(p.audio.original)), partId: null })
    for (const part of p.score.parts) {
      if (!part.stem || !p.audio) continue
      const route = this.route(part)
      if (route === 'stemfx') continue
      // a stem stays loaded for "compare" even when the part plays MIDI
      want.set(part.id, { url: api.project.url(p.id, this.shiftedPath(part.stem)), partId: part.id, fx: route === 'stem' ? fxFor(part) : [] })
    }
    for (const [k, t] of this.tracks) if (!want.has(k) || want.get(k)!.url !== t.url) { t.el.pause(); t.el.src = ''; t.pan.disconnect(); this.tracks.delete(k) }
    for (const [k, w] of want) {
      let track = this.tracks.get(k)
      if (!track) {
        const el = new Audio()
        el.preload = 'auto'
        el.crossOrigin = 'anonymous'
        el.preservesPitch = true
        el.src = w.url
        const src = ctx.createMediaElementSource(el)
        const gain = ctx.createGain()
        const pan = ctx.createStereoPanner()
        gain.connect(pan).connect(this.master)
        track = { el, src, gain, pan, partId: w.partId, url: w.url }
        this.tracks.set(k, track)
      }
      const builtins = (w.fx ?? []).filter((slot) => slot.type !== 'vst3')
      const fxKey = JSON.stringify(builtins)
      if (track.fxKey !== fxKey) {
        track.src.disconnect()
        track.fxOutput?.disconnect()
        const output = ctx.createGain()
        output.connect(track.gain)
        track.src.connect(buildChain(ctx, builtins, output))
        track.fxKey = fxKey
        track.fxOutput = output
      }
    }
  }

  private shifted = new Map<string, string>() // stem -> shifted relative path
  private shiftedPath(stem: string): string { return (this.opts.transpose && this.shifted.get(`${stem}@${this.opts.transpose}`)) || stem }
  private async applyAudioTranspose(): Promise<void> {
    const p = this.project
    if (!p) return
    const semis = this.opts.transpose
    if (semis) {
      const stems = [p.audio?.original, ...p.score.parts.filter((x) => this.route(x) === 'stem').map((x) => x.stem)].filter(Boolean) as string[]
      for (const s of stems) {
        const key = `${s}@${semis}`
        if (!this.shifted.has(key)) this.shifted.set(key, await api.media.pitchShift(p.id, s, semis))
      }
    }
    if (p.audio) this.shifted.set(`${p.audio.original}@0`, p.audio.original)
    if (this.project?.id !== p.id || this.opts.transpose !== semis) return
    const playing = this.state === 'playing'
    const tick = this.getTick()
    if (playing) this.pause()
    this.syncBuses()
    this.applyMix()
    if (playing) this.play(tick)
  }

  /** Raw audio of a stem for plug-in playback at the current speed and key; converted once and cached. */
  private async streamFor(part: Part): Promise<StemStream | null> {
    const p = this.project
    if (!p || !part.stem || !this.ctx) return null
    const key = `${part.stem}@${this.opts.transpose}@${this.audioRate}@${this.ctx.sampleRate}`
    const hit = this.streams.get(key)
    if (hit) return hit
    const stream = await api.vst.stem(p.id, part.stem, this.opts.transpose, this.audioRate, this.ctx.sampleRate)
    if (this.project?.id === p.id) this.streams.set(key, stream)
    return stream
  }

  private audible(part: Part): boolean {
    const anySolo = this.project!.score.parts.some((x) => x.solo)
    return !part.mute && (!anySolo || part.solo)
  }

  applyMix(): void {
    if (!this.ctx || !this.project) return
    const t = this.ctx.currentTime
    const parts = this.project.score.parts
    const original = this.opts.listen === 'original' && !!this.project.audio
    const anySolo = parts.some((part) => part.solo)
    const soloAudio = original && anySolo
    for (const part of parts) {
      const b = this.buses.get(part.id)
      const tr = this.tracks.get(part.id)
      const route = this.route(part)
      const comparing = this.opts.compare === part.id && !!tr
      const notesOn = original ? soloAudio && route === 'stemfx' : (route !== 'stem' || comparing)
      if (b) {
        b.gain.gain.setTargetAtTime(this.audible(part) && notesOn ? part.volume : 0, t, 0.015)
        b.pan.pan.setTargetAtTime(comparing ? 0.9 : part.pan, t, 0.015)
      }
      if (tr) {
        const audioOn = this.audible(part) && (original ? soloAudio && route === 'stem' : route === 'stem' || comparing)
        tr.gain.gain.setTargetAtTime(audioOn ? part.volume : 0, t, 0.015)
        tr.pan.pan.setTargetAtTime(comparing ? -0.9 : part.pan, t, 0.015)
      }
    }
    const mix = this.tracks.get('__mix')
    if (mix) {
      const mixOn = this.opts.mix.on && !anySolo && (original || this.opts.listen === 'parts')
      mix.gain.gain.setTargetAtTime(mixOn ? this.opts.mix.volume : 0, t, 0.015)
    }
    this.metroBus.gain.setTargetAtTime(this.opts.metronomeVolume, t, 0.01)
  }

  // ---------- transport ----------
  getTick(): number {
    if (this.state !== 'playing' || !this.ctx) return this.pausedTick
    const now = this.ctx.currentTime
    if (now < this.segCtx0) {
      const previous = this.beforeWrap
      return previous ? previous.map.secToTick(previous.map.tickToSec(previous.tick) + now - previous.time) : this.segTick0
    }
    return this.tm.secToTick(this.tm.tickToSec(this.segTick0) + (now - this.segCtx0))
  }
  /**
   * The position you are hearing right now, moving smoothly every frame. The audio clock itself
   * only advances once per audio buffer (and runs ahead of the speakers), so the score cursor
   * uses the output timestamp, carried forward with the display clock.
   */
  getVisualTick(): number {
    if (this.state !== 'playing' || !this.ctx) return this.pausedTick
    const ctx = this.ctx
    const stamp = ctx.getOutputTimestamp?.()
    let now = ctx.currentTime
    if (stamp?.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0) {
      now = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000
      // never run ahead of the scheduler's clock or jump backwards
      now = Math.min(now, ctx.currentTime + 0.05)
      if (now < this.lastVisual && this.lastVisual - now < 0.1) now = this.lastVisual
    }
    this.lastVisual = now
    if (now < this.segCtx0) {
      const previous = this.beforeWrap
      return previous ? previous.map.secToTick(previous.map.tickToSec(previous.tick) + now - previous.time) : this.segTick0
    }
    return this.tm.secToTick(this.tm.tickToSec(this.segTick0) + (now - this.segCtx0))
  }
  private lastVisual = 0
  get playheadStarted(): boolean {
    return this.state === 'playing' && !!this.ctx && (this.beforeWrap !== null || this.ctx.currentTime >= this.segCtx0)
  }
  private ctxAt(tick: number): number { return this.segCtx0 + this.tm.tickToSec(tick) - this.tm.tickToSec(this.segTick0) }
  private loopTicks(): { a: number; b: number } | null {
    const l = this.opts.loopOn && this.opts.loop
    if (!l || !this.project) return null
    const mt = measureTicks(this.project.score.timeSig)
    const a = l.from * mt
    const b = Math.min(this.endTick, (l.to + 1) * mt)
    return a < b ? { a, b } : null
  }
  get endTick(): number {
    if (!this.project) return 0
    const s = this.project.score
    const e = scoreEndTick(s)
    if (this.project.audio && (s.parts.length === 0 || this.opts.listen === 'original')) {
      return Math.max(0, this.tm1.secToTick((this.project.audio.duration - this.project.audio.offset) / this.audioScale))
    }
    return e
  }

  play(from?: number, withCountIn = true): void {
    if (!this.project) return
    if (withCountIn && this.opts.trainer.on && this.loopTicks()) this.opts.speed = this.opts.trainer.from
    const ctx = this.ensure()
    this.syncBuses()
    const request = ++this.startRequest
    const stemParts = this.project.score.parts.filter((part) => this.route(part) === 'stemfx')
    const loading = [...this.native.values()].filter((t) => t.loading).map((t) => t.ready)
    const missing = stemParts.filter((part) => !this.streams.has(`${part.stem}@${this.opts.transpose}@${this.audioRate}@${ctx.sampleRate}`))
    if (!missing.length && !loading.length) { this.start(from, withCountIn); return }
    // Rare: a plug-in track is still starting, or a recording needs converting for this speed or key.
    this.preparingFx = true
    this.fxError = null
    this.emit()
    void Promise.all([...missing.map((part) => this.streamFor(part)), ...loading]).then(() => {
      if (request !== this.startRequest) return
      this.preparingFx = false
      this.start(from, withCountIn)
    }, (error: Error) => {
      if (request !== this.startRequest) return
      this.preparingFx = false
      this.fxError = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      this.emit()
    })
  }

  private start(from: number | undefined, withCountIn: boolean): void {
    const ctx = this.ensure()
    const project = this.project!
    if (this.state === 'playing') this.hardStop()
    this.fxError = null
    this.applyMix()
    let tick = from ?? this.pausedTick
    const loop = this.loopTicks()
    if (loop && (tick < loop.a || tick >= loop.b)) tick = loop.a
    if (tick >= this.endTick - 1) tick = 0
    this.tm = tempoMap(project.score, this.opts.speed)
    const countIn = withCountIn ? this.opts.countIn : 0
    const mt = measureTicks(project.score.timeSig)
    const countSec = countIn ? this.tm.tickToSec(tick + countIn * mt) - this.tm.tickToSec(tick) : 0
    const lead = Math.max(0.08, this.maxLead)
    this.segTick0 = tick
    this.segCtx0 = ctx.currentTime + lead + countSec
    this.beforeWrap = null
    // from the very start, play the recording from 0:00 and let the bar grid begin at the first downbeat
    this.preRoll = tick === 0 && project.audio && this.opts.listen !== 'transcription' ? project.audio.offset / this.audioRate : 0
    this.segCtx0 += this.preRoll
    if (countIn) {
      const beat = beatTicks(project.score.timeSig)
      const beats = Math.round((countIn * mt) / beat)
      const secPerBeat = countSec / beats
      for (let i = 0; i < beats; i++) this.countClicks.push(click(ctx, this.metroBus, ctx.currentTime + lead + i * secPerBeat, i % Math.round(mt / beat) === 0, 1))
      this.countingIn = true
      const request = this.startRequest
      setTimeout(() => {
        if (request !== this.startRequest) return
        this.countClicks = []
        this.countingIn = false
        this.emit()
      }, (countSec + lead) * 1000)
    }
    this.schedTick = tick
    this.noteIdx = this.indexAt(tick)
    this.state = 'playing'
    this.endHandled = false
    this.startNative()
    this.startTracks()
    if (this.timer) clearInterval(this.timer)
    this.timer = window.setInterval(() => this.schedule(), 25)
    this.schedule()
    this.emit()
  }

  private restartAt(tick: number): void { this.hardStop(); this.play(tick, false) }

  /** New timeline for every plug-in track, starting now. */
  private startNative(): void {
    if (!this.ctx || !this.project) return
    const project = this.project
    const sr = this.ctx.sampleRate
    const now = Math.round(this.ctx.currentTime * sr) + 128
    const ts = project.score.timeSig
    for (const part of project.score.parts) {
      const track = this.native.get(part.id)
      if (!track) continue
      const route = this.route(part)
      track.reset(now)
      track.tempo(this.tm.bpmAt(this.segTick0), ts.num, ts.den)
      track.playing(true)
      track.capture(route === 'capture' ? this.captureDelay(track) : null)
      track.expect(Math.round((this.segCtx0 - this.preRoll) * sr))
      if (route === 'stemfx') this.cueStem(part, track, this.segTick0, this.segCtx0 - this.preRoll, this.preRoll)
    }
  }

  /** Start a stem through plug-ins at `time`, from the point that matches `tick`. */
  private cueStem(part: Part, track: NativeTrack, tick: number, time: number, preRoll = 0): void {
    const project = this.project!
    const stream = this.streams.get(`${part.stem}@${this.opts.transpose}@${this.audioRate}@${this.ctx!.sampleRate}`)
    if (!stream || !project.audio) return
    const sr = this.ctx!.sampleRate
    // stream time runs at playback speed; score seconds come from the speed-1 tempo map
    const audioSec = (this.tm1.tickToSec(tick) * this.audioScale + project.audio.offset) / this.audioRate - preRoll
    const offset = Math.round(audioSec * sr)
    const frame = Math.round(time * sr) + Math.max(0, -offset)
    track.file(frame, Math.max(0, offset), stream.ref)
  }

  private startTracks(): void {
    if (!this.ctx || !this.project) return
    const scoreSec = this.tm1.tickToSec(this.segTick0) * this.audioScale - this.preRoll * this.audioRate
    const startAt = this.segCtx0 - this.preRoll
    const request = this.startRequest
    for (const t of this.tracks.values()) {
      const audioSec = scoreSec + (this.project.audio?.offset ?? 0)
      t.el.pause()
      t.el.playbackRate = this.audioRate
      t.el.preservesPitch = true
      t.el.currentTime = Math.max(0, audioSec)
      const delay = (startAt - this.ctx.currentTime + Math.max(0, -audioSec) / this.audioRate) * 1000
      window.setTimeout(() => { if (this.state === 'playing' && request === this.startRequest) void t.el.play().catch(() => undefined) }, Math.max(0, delay - 15))
    }
  }

  private syncTracks(): void {
    if (!this.ctx || !this.project || this.ctx.currentTime < this.segCtx0 + 0.3) return
    const scoreSec = this.tm1.tickToSec(this.getTick()) * this.audioScale
    for (const t of this.tracks.values()) {
      const expected = scoreSec + (this.project.audio?.offset ?? 0)
      if (t.el.paused || t.el.seeking) continue
      if (expected > t.el.duration) { t.el.pause(); continue }
      // nudge the rate for small drift; jump only when far off
      const drift = t.el.currentTime - expected
      if (Math.abs(drift) > 0.12) t.el.currentTime = expected
      else t.el.playbackRate = Math.max(0.0625, Math.min(16, this.audioRate * (Math.abs(drift) > 0.015 ? 1 - Math.max(-0.03, Math.min(0.03, drift)) : 1)))
    }
  }

  private schedule(): void {
    if (!this.ctx || !this.project || this.state !== 'playing') return
    const ctx = this.ctx
    const sr = ctx.sampleRate
    const horizon = ctx.currentTime + Math.max(0.18, this.maxLead + 0.1)
    const loop = this.loopTicks()
    const end = loop ? loop.b : this.endTick
    let toTick = this.tm.secToTick(this.tm.tickToSec(this.segTick0) + (horizon - this.segCtx0))
    toTick = Math.min(toTick, end)
    const s = this.project.score
    const semis = this.opts.transpose
    const parts = new Map(s.parts.map((part) => [part.id, part]))
    const originalOnly = this.opts.listen === 'original' && !!this.project.audio
    while (this.noteIdx < this.notes.length && this.notes[this.noteIdx].tick < toTick) {
      const n = this.notes[this.noteIdx++]
      if (n.tick < this.schedTick || originalOnly) continue
      const part = parts.get(n.partId)
      if (!part) continue
      const route = this.route(part)
      if (route === 'stem' || route === 'stemfx') {
        if (this.opts.compare !== part.id || route === 'stemfx') continue
      }
      const bus = this.buses.get(n.partId)
      if (!bus) continue
      const when = this.ctxAt(n.tick)
      const dur = this.tm.tickToSec(n.tick + n.dur) - this.tm.tickToSec(n.tick)
      const drums = part.kind === 'drums'
      const pitch = Math.max(0, Math.min(127, drums ? n.pitch : n.pitch + semis))
      const track = this.native.get(n.partId)
      if (route === 'vsti') {
        if (!track) continue
        const start = Math.round(when * sr)
        const len = n.staccato ? dur * 0.45 : dur
        track.noteOn(start, pitch, n.velocity * (n.accent ? 1.18 : 1))
        track.noteOff(start + Math.max(1, Math.round(len * sr)), pitch)
        continue
      }
      // built-in instrument; with plug-in effects it plays early by the capture delay
      const early = route === 'capture' && track ? this.captureDelay(track) / sr : 0
      const at = when - early
      if (at < ctx.currentTime - 0.01) continue
      const v = playNote(ctx, bus.input, n.sound, pitch, Math.max(at, ctx.currentTime), dur, n.velocity, n.opts)
      this.voices.add(v)
      setTimeout(() => this.voices.delete(v), (v.end - ctx.currentTime) * 1000 + 200)
    }
    if (this.opts.metronome) {
      const beat = beatTicks(s.timeSig)
      const mt = measureTicks(s.timeSig)
      let b = Math.ceil(this.schedTick / beat) * beat
      for (; b < toTick; b += beat) click(ctx, this.metroBus, this.ctxAt(b), b % mt === 0, 1)
    }
    this.schedTick = toTick
    if (toTick >= end) {
      if (loop) {
        if (ctx.currentTime < this.segCtx0) return
        const request = this.startRequest
        const wrapAt = this.ctxAt(loop.b)
        this.beforeWrap = { tick: this.segTick0, time: this.segCtx0, map: this.tm }
        if (this.opts.trainer.on) this.opts.speed = Math.min(this.opts.trainer.to, +(this.opts.speed + this.opts.trainer.step).toFixed(3))
        this.tm = tempoMap(s, this.opts.speed)
        this.segTick0 = loop.a
        this.segCtx0 = wrapAt
        this.preRoll = 0
        this.schedTick = loop.a
        this.noteIdx = this.indexAt(loop.a)
        // plug-in tracks: release held notes at the loop end and restart stems from the loop start
        for (const part of s.parts) {
          const track = this.native.get(part.id)
          if (!track) continue
          track.allOff(Math.round(wrapAt * sr))
          if (this.route(part) === 'stemfx') {
            if (this.streams.has(`${part.stem}@${this.opts.transpose}@${this.audioRate}@${sr}`)) this.cueStem(part, track, loop.a, wrapAt)
            else {
              // the trainer changed speed: convert in the background, then catch up
              track.file(Math.round(wrapAt * sr), 0, null)
              void this.streamFor(part).then(() => { if (request === this.startRequest && this.state === 'playing') this.restartAt(this.getTick()) }, () => undefined)
            }
          }
        }
        window.setTimeout(() => { if (request === this.startRequest && this.state === 'playing') { this.startTracks(); this.emit() } }, Math.max(0, (wrapAt - ctx.currentTime) * 1000 - 30))
      } else if (!this.endHandled) {
        this.endHandled = true
        const request = this.startRequest
        window.setTimeout(() => { if (request === this.startRequest && this.state === 'playing') { this.stop(); this.emit() } }, Math.max(0, (this.ctxAt(end) - ctx.currentTime) * 1000) + 300)
      }
    }
    this.syncTracks()
  }

  private hardStop(): void {
    for (const click of this.countClicks) click.stop()
    this.countClicks = []
    this.countingIn = false
    this.startRequest++
    this.preparingFx = false
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    const t = this.ctx?.currentTime ?? 0
    for (const v of this.voices) v.stop(t)
    this.voices.clear()
    for (const tr of this.tracks.values()) tr.el.pause()
    if (this.ctx) {
      const frame = Math.round(t * this.ctx.sampleRate) + 64
      for (const track of this.native.values()) {
        track.reset(frame)
        track.playing(false)
        track.expect(Infinity)
        if (!this.effectTails) track.flush()
      }
    }
    this.beforeWrap = null
    this.state = 'stopped'
  }

  pause(): void {
    if (this.state !== 'playing') return
    this.pausedTick = Math.min(this.getTick(), this.endTick)
    this.hardStop()
    this.emit()
  }

  stop(): void {
    const loop = this.loopTicks()
    this.hardStop()
    this.pausedTick = loop ? loop.a : 0
    this.emit()
  }

  seek(tick: number): void {
    const t = Math.max(0, Math.min(tick, this.endTick))
    if (this.state === 'playing') this.restartAt(t)
    else { this.pausedTick = t; this.emit() }
  }

  toggle(): void { if (this.preparingFx) this.stop(); else if (this.state === 'playing') this.pause(); else this.play() }

  // ---------- auditioning: note entry, on-screen keyboard and fretboard, MIDI keyboard ----------
  /** Play a note on a part as it really sounds (its own instrument and effects) until stop() is called. */
  noteOn(part: Part | null, pitch: number, velocity = 96): LiveNote {
    const ctx = this.ensure()
    if (this.project) this.syncBuses()
    const sr = ctx.sampleRate
    const bus = part ? this.buses.get(part.id) : null
    const route = part ? this.route(part) : 'synth'
    const track = part ? this.native.get(part.id) : undefined
    const p = Math.max(0, Math.min(127, pitch))
    if (part && route === 'vsti') {
      if (!track) return { stop: () => undefined }
      // ahead of the host's render position so the note keeps its exact length
      const ahead = () => this.lookahead + track.latency + Math.max(256, Math.round(ctx.baseLatency * sr))
      const frameNow = () => Math.round(ctx.currentTime * sr)
      if (track.live) {
        const start = frameNow() + ahead()
        track.noteOn(start, p, velocity)
        let stopped = false
        return { stop: () => { if (stopped) return; stopped = true; track.noteOff(Math.max(start + 1, frameNow() + ahead()), p) } }
      }
      // The plug-in is still loading (just opened, or the first note of the session): play the note
      // as soon as it is ready, with the length the key was held, instead of losing it.
      const asked = performance.now()
      let held: number | null = null
      let started: number | null = null
      void track.whenLive().then((ok) => {
        if (!ok || performance.now() - asked > 4000) return
        const start = frameNow() + ahead()
        started = start
        track.noteOn(start, p, velocity)
        if (held !== null) track.noteOff(start + Math.round(Math.min(2, held) * sr), p)
      })
      return { stop: () => {
        if (held !== null) return
        held = (performance.now() - asked) / 1000
        if (started !== null) track.noteOff(Math.max(started + 1, frameNow() + ahead()), p)
      } }
    }
    const sound = part ? soundFor(part) : 'piano'
    // the part's own sound and effects; a muted part still sounds (dry) when you play it directly
    let dest: AudioNode = bus ? bus.input : partInsert(ctx, sound, this.master)
    if (bus && bus.gain.gain.value === 0) dest = partInsert(ctx, sound, this.master)
    if (route === 'capture' && track && this.state !== 'playing') track.capture(this.captureDelay(track))
    const v = playNote(ctx, dest, sound, p, ctx.currentTime + 0.005, 30, velocity)
    return { stop: () => v.stop(ctx.currentTime) }
  }

  /** Hear any sound on its own (Settings → Instrument sounds). */
  async previewSound(sound: SoundId, pitches: number[]): Promise<void> {
    const ctx = this.ensure()
    await loadPack(sound)
    const input = partInsert(ctx, sound, this.master)
    pitches.forEach((p, i) => playNote(ctx, input, sound, p, ctx.currentTime + 0.03 + i * 0.12, 1.2, 92))
  }

  async playPreviewAudio(wav: ArrayBuffer, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    const ctx = this.ensure()
    const buffer = await ctx.decodeAudioData(wav)
    if (signal.aborted) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.master)
    await new Promise<void>((resolve) => {
      const stop = () => source.stop()
      signal.addEventListener('abort', stop, { once: true })
      source.onended = () => {
        signal.removeEventListener('abort', stop)
        source.disconnect()
        resolve()
      }
      source.start()
    })
  }

  /** Audition a single note of fixed length (note entry, fretboard, MIDI keyboard). */
  preview(part: Part | null, pitch: number, vel = 96, seconds = 0.6): void {
    const note = this.noteOn(part, pitch, vel)
    window.setTimeout(() => note.stop(), seconds * 1000)
  }

  /** Preview button in the sound rack. */
  async previewEffects(part: Part, pitch: number): Promise<void> {
    const track = this.native.get(part.id)
    if (track) {
      await track.ready
      if (track.error) throw new Error(track.error)
    }
    this.preview(part, pitch, 100, 1.5)
  }

  previewRandomChord(): void {
    if (this.testChordSound) return
    const sounds = SOUNDS.filter((sound) => sound.id !== 'drums' && sound.id !== 'sine' && sound.id !== this.lastTestSound)
    const ready = sounds.filter((sound) => packReady(sound.id))
    const pool = ready.length ? ready : sounds
    const sound = pool[Math.floor(Math.random() * pool.length)]
    const ctx = this.ensure()
    const input = partInsert(ctx, sound.id, this.master)
    const start = ctx.currentTime + 0.04
    const end = Math.max(...[60, 64, 67].map((pitch) => playNote(ctx, input, sound.id, pitch, start, 0.9, 72).end))
    this.lastTestSound = sound.id
    this.testChordSound = sound.label
    this.emit()
    const finish = () => {
      const remaining = end - ctx.currentTime
      if (ctx.state !== 'closed' && remaining > 0.01) {
        window.setTimeout(finish, Math.max(50, remaining * 1000))
      } else {
        this.testChordSound = null
        this.emit()
      }
    }
    window.setTimeout(finish, (end - ctx.currentTime) * 1000)
  }

  /** Re-read sample packs from disk after a download. */
  refreshSounds(): void {
    resetMissing()
    if (this.project) for (const part of this.project.score.parts) if (soundFor(part) !== 'sine') void loadPack(soundFor(part))
  }

  notesFor(partId: string): PlayNote[] { return this.notes.filter((n) => n.partId === partId) }
  get ppq(): number { return PPQ }
}

export const player = new Player()

/** Write a plug-in's saved settings into a piece that is no longer open. */
async function persistPluginState(projectId: string, partId: string, slotId: string, config: VstSlotSpec['config']): Promise<void> {
  try {
    const project = await api.project.load(projectId)
    const part = project.score.parts.find((p) => p.id === partId)
    if (!part) return
    if (slotId === 'instrument') part.vstInstrument = config
    else {
      const chain = fxFor(part)
      if (!chain.some((slot) => slot.id === slotId)) return
      part.fx = chain.map((slot) => (slot.id === slotId && slot.type === 'vst3' ? { ...slot, ...config } : slot))
    }
    await api.project.save({ ...project, updated: Date.now() })
  } catch { /* the piece was deleted */ }
}
