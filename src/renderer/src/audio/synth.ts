// Built-in instruments rendered with the Web Audio API. Every voice works on
// any BaseAudioContext, so the same code drives live playback and WAV export.
import type { InstrumentKind, Technique } from '@shared/types'
import { drumPiece } from '@/music/theory'
import { packReady, playSample, loadPack } from './samples'
import { customSound, customSounds } from './custom'

export type BuiltinSoundId = 'piano' | 'epiano' | 'organ' | 'nylon' | 'steel' | 'clean' | 'drive' | 'dist' | 'bass' | 'synthbass' | 'drums' | 'voice' | 'strings' | 'brass' | 'reed' | 'lead' | 'pad' | 'sine'
/** A built-in sound, or one of the user's own instruments (`custom:<id>`). */
export type SoundId = BuiltinSoundId | `custom:${string}`

export const SOUNDS: { id: BuiltinSoundId; label: string; for: InstrumentKind[] }[] = [
  { id: 'piano', label: 'Grand Piano', for: ['piano', 'other'] },
  { id: 'epiano', label: 'E-Piano', for: ['epiano', 'piano'] },
  { id: 'organ', label: 'Drawbar Organ', for: ['organ'] },
  { id: 'steel', label: 'Steel Acoustic', for: ['acoustic-guitar'] },
  { id: 'nylon', label: 'Nylon Guitar', for: ['acoustic-guitar'] },
  { id: 'clean', label: 'Clean Electric', for: ['clean-guitar'] },
  { id: 'dist', label: 'Distortion Guitar', for: ['distorted-guitar'] },
  { id: 'drive', label: 'Overdrive Guitar', for: ['distorted-guitar', 'clean-guitar'] },
  { id: 'bass', label: 'Finger Bass', for: ['bass'] },
  { id: 'synthbass', label: 'Synth Bass', for: ['bass', 'synth'] },
  { id: 'drums', label: 'Studio Kit', for: ['drums'] },
  { id: 'strings', label: 'String Ensemble', for: ['strings'] },
  { id: 'brass', label: 'Brass Section', for: ['brass'] },
  { id: 'reed', label: 'Flute', for: ['woodwinds'] },
  { id: 'lead', label: 'Saw Lead', for: ['synth'] },
  { id: 'pad', label: 'Warm Pad', for: ['synth'] },
  { id: 'sine', label: 'Pure Sine', for: ['other'] }
]

export const DEFAULT_SOUND: Record<InstrumentKind, BuiltinSoundId> = {
  piano: 'piano', epiano: 'epiano', organ: 'organ', synth: 'lead', 'acoustic-guitar': 'steel', 'clean-guitar': 'clean',
  'distorted-guitar': 'dist', bass: 'bass', drums: 'drums', vocals: 'voice', singer: 'sine', strings: 'strings', brass: 'brass', woodwinds: 'reed', other: 'piano'
}

/** Display name of any sound, built-in or your own. */
export function soundLabel(id: SoundId): string {
  return SOUNDS.find((s) => s.id === id)?.label ?? customSound(id)?.name ?? 'Missing instrument'
}

/** Built-in sounds followed by the user's own instruments. */
export function allSounds(): { id: SoundId; label: string; custom: boolean }[] {
  return [
    ...SOUNDS.map((s) => ({ id: s.id as SoundId, label: s.label, custom: false })),
    ...customSounds().map((c) => ({ id: `custom:${c.id}` as SoundId, label: c.name, custom: true }))
  ]
}

export interface NoteOpts {
  tech?: Technique[]
  bend?: number
  slideTo?: number // semitones to glide over the note's tail
  staccato?: boolean
  accent?: boolean
  legato?: boolean // hammer-on / pull-off target
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

// ---------- cached sample buffers ----------
const bufCache = new Map<string, AudioBuffer>()
const SR = 44100

function makeBuffer(ctx: BaseAudioContext, seconds: number, fill: (d: Float32Array, sr: number) => void, channels = 1): AudioBuffer {
  const len = Math.floor(seconds * SR)
  const b = ctx.createBuffer(channels, len, SR)
  for (let c = 0; c < channels; c++) fill(b.getChannelData(c), SR)
  return b
}

/** Karplus–Strong plucked string. `bright` 0..1, `decay` ~ seconds to -60 dB at A2. */
function pluck(ctx: BaseAudioContext, pitch: number, bright: number, decay: number, body = 0): AudioBuffer {
  const key = `ks:${pitch}:${bright}:${decay}:${body}`
  const hit = bufCache.get(key)
  if (hit) return hit
  const f = hz(pitch)
  const seconds = Math.min(6, Math.max(1.2, decay * (110 / f) ** 0.35))
  const b = makeBuffer(ctx, seconds, (d, sr) => {
    const N = Math.max(2, Math.round(sr / f))
    const line = new Float32Array(N)
    let lp = 0
    for (let i = 0; i < N; i++) { const n = Math.random() * 2 - 1; lp = lp + (n - lp) * (0.25 + bright * 0.7); line[i] = lp }
    const loss = Math.pow(0.001, 1 / (seconds * f)) // -60dB over the buffer
    const mix = 0.5 - bright * 0.03
    let idx = 0
    let prev = 0
    for (let i = 0; i < d.length; i++) {
      const cur = line[idx]
      const next = (cur * mix + prev * (1 - mix)) * loss
      prev = cur
      line[idx] = next
      d[i] = cur
      idx = (idx + 1) % N
    }
    if (body > 0) { // simple body resonance: two damped resonators
      let y1 = 0, y2 = 0, z1 = 0, z2 = 0
      const r = (fr: number, q: number) => { const w = (2 * Math.PI * fr) / sr; return { a1: 2 * q * Math.cos(w), a2: -q * q } }
      const A = r(110, 0.995), B = r(220, 0.99)
      for (let i = 0; i < d.length; i++) {
        const x = d[i]
        const ya = x * 0.02 + A.a1 * y1 + A.a2 * y2; y2 = y1; y1 = ya
        const yb = x * 0.02 + B.a1 * z1 + B.a2 * z2; z2 = z1; z1 = yb
        d[i] = x + body * (ya + yb)
      }
    }
    let peak = 0
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
    if (peak > 0) for (let i = 0; i < d.length; i++) d[i] /= peak
  })
  bufCache.set(key, b)
  return b
}

/** Additive piano tone with stretched partials, per-partial decay and a hammer thump. */
function pianoBuf(ctx: BaseAudioContext, pitch: number, layer: number): AudioBuffer {
  const key = `pf:${pitch}:${layer}`
  const hit = bufCache.get(key)
  if (hit) return hit
  const f0 = hz(pitch)
  const t60 = Math.max(0.9, 9 * Math.pow(0.955, pitch - 21))
  const seconds = Math.min(7, t60 * 0.9)
  const B = 0.00008 * Math.pow(1.03, pitch - 21)
  const bright = 0.55 + layer * 0.25
  const partials: { f: number; a: number; d: number }[] = []
  for (let k = 1; k <= 24; k++) {
    const f = f0 * k * Math.sqrt(1 + B * k * k)
    if (f > 16000) break
    const a = Math.pow(k, -1.1 - (1 - bright)) * (k === 1 ? 1 : 0.9) * (1 + 0.3 * Math.sin(k * 1.7))
    partials.push({ f, a, d: t60 / (1 + 0.35 * (k - 1)) })
  }
  const b = makeBuffer(ctx, seconds, (d, sr) => {
    for (const p of partials) {
      const w = (2 * Math.PI * p.f) / sr
      const dec = Math.exp(-6.9 / (p.d * sr))
      let amp = p.a
      const det = 1 + 0.0007 * Math.sin(p.f) // unison chorus between strings
      const w2 = w * det
      for (let i = 0; i < d.length; i++) {
        d[i] += amp * (Math.sin(w * i) + 0.6 * Math.sin(w2 * i)) * 0.6
        amp *= dec
        if (amp < 1e-5) break
      }
    }
    const thump = Math.floor(0.012 * sr)
    for (let i = 0; i < thump; i++) d[i] += (Math.random() * 2 - 1) * (1 - i / thump) * 0.25 * bright
    for (let i = 0; i < Math.min(d.length, 64); i++) d[i] *= i / 64
    let peak = 0
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
    for (let i = 0; i < d.length; i++) d[i] /= peak || 1
  })
  bufCache.set(key, b)
  return b
}

/** Two-operator FM e-piano (tine + bell). */
function epianoBuf(ctx: BaseAudioContext, pitch: number): AudioBuffer {
  const key = `ep:${pitch}`
  const hit = bufCache.get(key)
  if (hit) return hit
  const f = hz(pitch)
  const seconds = Math.min(5, 3.5 * Math.pow(0.97, pitch - 40) + 0.8)
  const b = makeBuffer(ctx, seconds, (d, sr) => {
    for (let i = 0; i < d.length; i++) {
      const t = i / sr
      const idx = 2.2 * Math.exp(-t * 6) + 0.25
      const bell = 0.18 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * f * 14 * t)
      d[i] = (Math.sin(2 * Math.PI * f * t + idx * Math.sin(2 * Math.PI * f * t)) + bell) * Math.exp(-t * (1.2 + pitch / 60)) * Math.min(1, i / 40)
    }
  })
  bufCache.set(key, b)
  return b
}

// ---------- drums ----------
function drumBuf(ctx: BaseAudioContext, id: string): AudioBuffer {
  const key = `dr:${id}`
  const hit = bufCache.get(key)
  if (hit) return hit
  const noise = () => Math.random() * 2 - 1
  let b: AudioBuffer
  const hp = (d: Float32Array, a: number) => { let x1 = 0, y1 = 0; for (let i = 0; i < d.length; i++) { const y = a * (y1 + d[i] - x1); x1 = d[i]; y1 = y; d[i] = y } }
  const bp = (d: Float32Array, fc: number, q: number, sr: number) => {
    const w = (2 * Math.PI * fc) / sr, al = Math.sin(w) / (2 * q), b0 = al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < d.length; i++) { const x = d[i]; const y = (b0 * x - b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y }
  }
  switch (id) {
    case 'kick':
      b = makeBuffer(ctx, 0.6, (d, sr) => {
        let ph = 0
        for (let i = 0; i < d.length; i++) {
          const t = i / sr
          const f = 45 + 110 * Math.exp(-t * 28)
          ph += (2 * Math.PI * f) / sr
          d[i] = Math.tanh(1.6 * Math.sin(ph) * Math.exp(-t * 6.5)) + (t < 0.004 ? noise() * 0.4 * (1 - t / 0.004) : 0)
        }
      }); break
    case 'snare':
      b = makeBuffer(ctx, 0.45, (d, sr) => {
        const n = new Float32Array(d.length).map(noise)
        bp(n, 3500, 0.6, sr)
        for (let i = 0; i < d.length; i++) {
          const t = i / sr
          d[i] = 0.9 * n[i] * Math.exp(-t * 14) + 0.7 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 26) + 0.3 * Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 30)
        }
      }); break
    case 'hh': case 'hhPedal': case 'hhOpen': case 'crash': case 'ride': {
      const len = { hh: 0.09, hhPedal: 0.07, hhOpen: 0.55, crash: 2.2, ride: 1.6 }[id]!
      const decay = { hh: 55, hhPedal: 70, hhOpen: 6, crash: 1.9, ride: 2.6 }[id]!
      b = makeBuffer(ctx, len, (d, sr) => {
        const ratios = [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523]
        const base = id === 'ride' ? 420 : 330
        for (let i = 0; i < d.length; i++) {
          const t = i / sr
          let m = 0
          for (const r of ratios) m += Math.sign(Math.sin(2 * Math.PI * base * r * t))
          d[i] = (m / 6) * 0.6 + noise() * 0.5
        }
        hp(d, id === 'ride' ? 0.9 : 0.95)
        hp(d, 0.9)
        for (let i = 0; i < d.length; i++) {
          const t = i / sr
          d[i] *= Math.exp(-t * decay) * (id === 'ride' ? 0.6 + 0.4 * Math.exp(-t * 30) : 1)
        }
      }); break
    }
    default: { // toms
      const f0 = { tomHi: 210, tomMid: 150, tomFloor: 98 }[id] ?? 150
      b = makeBuffer(ctx, 0.8, (d, sr) => {
        let ph = 0
        for (let i = 0; i < d.length; i++) {
          const t = i / sr
          ph += (2 * Math.PI * f0 * (1 + 0.6 * Math.exp(-t * 20))) / sr
          d[i] = Math.sin(ph) * Math.exp(-t * 5.5) + (t < 0.01 ? noise() * 0.3 : 0)
        }
      })
    }
  }
  let peak = 0
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
  for (let i = 0; i < d.length; i++) d[i] /= peak || 1
  bufCache.set(key, b)
  return b
}

const curveCache = new Map<number, Float32Array>()
function driveCurve(amount: number): Float32Array {
  const hit = curveCache.get(amount)
  if (hit) return hit
  const n = 2048
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount) }
  curveCache.set(amount, c)
  return c
}

// ---------- voices ----------
export interface Voice { stop(at: number): void; end: number }

function envGain(ctx: BaseAudioContext, dest: AudioNode, when: number, peak: number, attack: number, decay: number, sustain: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(peak, when + attack)
  g.gain.setTargetAtTime(peak * sustain, when + attack, decay / 3)
  g.connect(dest)
  return g
}

function applyPitchFx(param: AudioParam, ctx: BaseAudioContext, when: number, dur: number, o: NoteOpts): void {
  param.setValueAtTime(0, when)
  if (o.tech?.includes('bend')) {
    param.setValueAtTime(0, when + Math.min(0.05, dur * 0.15))
    param.linearRampToValueAtTime((o.bend ?? 2) * 100, when + Math.min(0.25, dur * 0.5))
  }
  if (o.slideTo) param.linearRampToValueAtTime(0, when + dur * 0.55), param.linearRampToValueAtTime(o.slideTo * 100, when + dur * 0.98)
  if (o.tech?.includes('vibrato') && dur > 0.15) {
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    lfo.frequency.value = 5.6
    depth.gain.setValueAtTime(0, when)
    depth.gain.linearRampToValueAtTime(o.tech.includes('bend') ? 25 : 35, when + Math.min(0.3, dur * 0.4))
    lfo.connect(depth).connect(param)
    lfo.start(when)
    lfo.stop(when + dur + 0.5)
  }
}

function playBuffer(ctx: BaseAudioContext, dest: AudioNode, buf: AudioBuffer, when: number, dur: number, gain: number, release: number, rate = 1, o: NoteOpts = {}, filter?: BiquadFilterNode): Voice {
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, when)
  if (filter) { src.connect(filter); filter.connect(g) } else src.connect(g)
  g.connect(dest)
  applyPitchFx(src.detune, ctx, when, dur, o)
  src.start(when)
  const end = when + Math.min(dur, buf.duration / rate)
  g.gain.setValueAtTime(gain, end)
  g.gain.setTargetAtTime(0, end, release / 4)
  src.stop(end + release + 0.05)
  return { end: end + release, stop: (at) => { g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, 0.02); try { src.stop(at + 0.1) } catch { /* already stopped */ } } }
}

function oscVoice(ctx: BaseAudioContext, dest: AudioNode, pitch: number, when: number, dur: number, vel: number, o: NoteOpts, cfg: {
  waves: { type: OscillatorType; detune: number; gain: number; mult?: number }[]
  attack: number; decay: number; sustain: number; release: number
  filter?: { type: BiquadFilterType; freq: number; q?: number; env?: number }
  vibrato?: number
  noise?: number
}): Voice {
  const f = hz(pitch)
  const peak = 0.22 * (vel / 127) ** 1.3
  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(dest)
  const env = envGain(ctx, out, when, peak, cfg.attack, cfg.decay, cfg.sustain)
  let target: AudioNode = env
  let filt: BiquadFilterNode | null = null
  if (cfg.filter) {
    filt = ctx.createBiquadFilter()
    filt.type = cfg.filter.type
    filt.Q.value = cfg.filter.q ?? 0.7
    const base = cfg.filter.freq * (0.6 + 0.6 * vel / 127)
    filt.frequency.setValueAtTime(base, when)
    if (cfg.filter.env) {
      filt.frequency.linearRampToValueAtTime(base * cfg.filter.env, when + cfg.attack + 0.02)
      filt.frequency.setTargetAtTime(base, when + cfg.attack + 0.02, 0.25)
    }
    filt.connect(target)
    target = filt
  }
  const oscs: OscillatorNode[] = []
  for (const w of cfg.waves) {
    const osc = ctx.createOscillator()
    osc.type = w.type
    osc.frequency.value = f * (w.mult ?? 1)
    const g = ctx.createGain()
    g.gain.value = w.gain
    osc.connect(g).connect(target)
    applyPitchFx(osc.detune, ctx, when, dur, o)
    osc.detune.setValueAtTime(w.detune, when)
    if (cfg.vibrato) {
      const lfo = ctx.createOscillator()
      const d = ctx.createGain()
      lfo.frequency.value = 5 + Math.random() * 0.6
      d.gain.setValueAtTime(0, when)
      d.gain.linearRampToValueAtTime(cfg.vibrato, when + 0.35)
      lfo.connect(d).connect(osc.detune)
      lfo.start(when)
      lfo.stop(when + dur + cfg.release + 0.2)
    }
    osc.start(when)
    osc.stop(when + dur + cfg.release + 0.2)
    oscs.push(osc)
  }
  if (cfg.noise) {
    const nb = noiseBuffer(ctx)
    const n = ctx.createBufferSource()
    n.buffer = nb
    n.loop = true
    const g = ctx.createGain()
    g.gain.value = cfg.noise
    const bpf = ctx.createBiquadFilter()
    bpf.type = 'bandpass'
    bpf.frequency.value = f * 2
    n.connect(bpf).connect(g).connect(target)
    n.start(when)
    n.stop(when + dur + cfg.release + 0.2)
  }
  const endT = when + dur
  env.gain.setValueAtTime(peak * cfg.sustain, endT)
  env.gain.cancelScheduledValues(endT)
  env.gain.setTargetAtTime(0, endT, cfg.release / 3)
  return { end: endT + cfg.release, stop: (at) => { env.gain.cancelScheduledValues(at); env.gain.setTargetAtTime(0, at, 0.02); oscs.forEach((x) => { try { x.stop(at + 0.1) } catch { /* noop */ } }) } }
}

let noiseB: AudioBuffer | null = null
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (!noiseB) noiseB = makeBuffer(ctx, 2, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1 })
  return noiseB
}

function voiceAah(ctx: BaseAudioContext, dest: AudioNode, pitch: number, when: number, dur: number, vel: number, o: NoteOpts): Voice {
  const f = hz(pitch)
  const peak = 0.3 * (vel / 127)
  const env = envGain(ctx, dest, when, peak, 0.08, 0.3, 0.85)
  const formants = [[730, 1, 10], [1090, 0.5, 12], [2440, 0.25, 14]]
  const bus = ctx.createGain()
  for (const [fr, g, q] of formants) {
    const b = ctx.createBiquadFilter()
    b.type = 'bandpass'
    b.frequency.value = fr
    b.Q.value = q
    const gg = ctx.createGain()
    gg.gain.value = g * 3
    bus.connect(b).connect(gg).connect(env)
  }
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = f
  osc.connect(bus)
  applyPitchFx(osc.detune, ctx, when, dur, o)
  const lfo = ctx.createOscillator()
  const depth = ctx.createGain()
  lfo.frequency.value = 5.2
  depth.gain.setValueAtTime(0, when)
  depth.gain.linearRampToValueAtTime(22, when + 0.4)
  lfo.connect(depth).connect(osc.detune)
  osc.start(when); lfo.start(when)
  const end = when + dur
  env.gain.cancelScheduledValues(end)
  env.gain.setTargetAtTime(0, end, 0.08)
  osc.stop(end + 0.5); lfo.stop(end + 0.5)
  return { end: end + 0.3, stop: (at) => { env.gain.cancelScheduledValues(at); env.gain.setTargetAtTime(0, at, 0.02); try { osc.stop(at + 0.1); lfo.stop(at + 0.1) } catch { /* noop */ } } }
}

/** Per-part effect chain (e.g. amp distortion) shared by all of the part's notes. */
export function partInsert(ctx: BaseAudioContext, sound: SoundId, out: AudioNode): AudioNode {
  if ((sound === 'drive' || sound === 'dist') && !packReady(sound)) {
    const pre = ctx.createGain(); pre.gain.value = 3.5
    const ws = ctx.createWaveShaper(); ws.curve = driveCurve(4) as Float32Array<ArrayBuffer>; ws.oversample = '2x'
    const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 4200; cab.Q.value = 0.9
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 90
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 900; mid.gain.value = 4
    const post = ctx.createGain(); post.gain.value = 0.32
    pre.connect(hpf).connect(ws).connect(mid).connect(cab).connect(post).connect(out)
    return pre
  }
  if (sound === 'clean') {
    const ch = ctx.createBiquadFilter(); ch.type = 'peaking'; ch.frequency.value = 2500; ch.gain.value = 3
    ch.connect(out)
    return ch
  }
  return out
}

/** Schedule one note. Returns a handle so live playback can cut notes on stop. */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, sound: SoundId, pitch: number, when: number, dur: number, vel: number, o: NoteOpts = {}): Voice {
  const v = Math.max(1, Math.min(127, vel * (o.accent ? 1.18 : 1)))
  const len = o.staccato ? Math.min(dur, Math.max(0.06, dur * 0.45)) : dur
  const amp = (v / 127) ** 1.5
  const pm = o.tech?.includes('palmMute')
  if (sound !== 'sine' && !o.tech?.includes('harmonic')) {
    if (packReady(sound)) {
      const h = playSample(ctx, dest, sound, pitch, when, len, v, { palmMute: pm, legato: o.legato, staccato: o.staccato })
      if (h) {
        if (sound !== 'drums') applyPitchFx(h.src.detune, ctx, when, len, o)
        return { end: h.end, stop: (at) => { h.gain.gain.cancelScheduledValues(at); h.gain.gain.setTargetAtTime(0, at, 0.03); try { h.src.stop(at + 0.15) } catch { /* stopped */ } } }
      }
    } else void loadPack(sound)
  }
  if (o.tech?.includes('harmonic')) {
    return oscVoice(ctx, dest, pitch + 12, when, Math.max(len, 1.2), v, o, { waves: [{ type: 'sine', detune: 0, gain: 1 }, { type: 'sine', detune: 0, gain: 0.15, mult: 2 }], attack: 0.003, decay: 1.6, sustain: 0.001, release: 0.6 })
  }
  switch (sound) {
    case 'piano': return playBuffer(ctx, dest, pianoBuf(ctx, pitch, v > 90 ? 2 : v > 55 ? 1 : 0), when, len, amp * 0.55, 0.18, 1, o)
    case 'epiano': return playBuffer(ctx, dest, epianoBuf(ctx, pitch), when, len, amp * 0.4, 0.15, 1, o)
    case 'steel': case 'nylon': case 'clean': case 'drive': case 'dist': case 'bass': {
      const cfg = { steel: [0.75, 4, 0.35], nylon: [0.35, 3.2, 0.5], clean: [0.55, 4.5, 0], drive: [0.6, 5, 0], dist: [0.6, 5, 0], bass: [0.28, 5, 0] }[sound] as [number, number, number]
      let filter: BiquadFilterNode | undefined
      if (pm) { filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = sound === 'bass' ? 500 : 1100 }
      const buf = pluck(ctx, pitch, o.legato ? cfg[0] * 0.6 : cfg[0], cfg[1], cfg[2])
      const gain = amp * (sound === 'bass' ? 0.6 : 0.45) * (o.legato ? 0.7 : 1)
      return playBuffer(ctx, dest, buf, when, pm ? Math.min(len, 0.18) : len, gain, pm ? 0.05 : 0.09, 1, o, filter)
    }
    case 'drums': return playBuffer(ctx, dest, drumBuf(ctx, drumPiece(pitch).id), when, 3, amp * 0.7, 0.05)
    case 'voice': return voiceAah(ctx, dest, pitch, when, len, v, o)
    case 'organ': return oscVoice(ctx, dest, pitch, when, len, 100, o, { waves: [1, 2, 3, 4, 6, 8].map((m, i) => ({ type: 'sine' as OscillatorType, detune: 0, gain: [0.8, 0.6, 0.5, 0.35, 0.2, 0.18][i], mult: m })), attack: 0.008, decay: 0.05, sustain: 1, release: 0.06 })
    case 'strings': return oscVoice(ctx, dest, pitch, when, len, v, o, { waves: [{ type: 'sawtooth', detune: -7, gain: 0.5 }, { type: 'sawtooth', detune: 6, gain: 0.5 }, { type: 'sawtooth', detune: 0, gain: 0.3, mult: 0.5 }], attack: 0.22, decay: 0.4, sustain: 0.85, release: 0.45, filter: { type: 'lowpass', freq: 2600, q: 0.6 }, vibrato: 9 })
    case 'brass': return oscVoice(ctx, dest, pitch, when, len, v, o, { waves: [{ type: 'sawtooth', detune: -4, gain: 0.6 }, { type: 'sawtooth', detune: 4, gain: 0.6 }], attack: 0.05, decay: 0.3, sustain: 0.75, release: 0.15, filter: { type: 'lowpass', freq: 1400, q: 1.2, env: 2.4 }, vibrato: 6 })
    case 'reed': return oscVoice(ctx, dest, pitch, when, len, v, o, { waves: [{ type: 'square', detune: 0, gain: 0.35 }, { type: 'triangle', detune: 3, gain: 0.6 }], attack: 0.04, decay: 0.2, sustain: 0.85, release: 0.1, filter: { type: 'lowpass', freq: 2200, q: 0.8 }, vibrato: 10, noise: 0.08 })
    case 'lead': return oscVoice(ctx, dest, pitch, when, len, v, o, { waves: [{ type: 'sawtooth', detune: -9, gain: 0.45 }, { type: 'sawtooth', detune: 9, gain: 0.45 }, { type: 'square', detune: 0, gain: 0.25, mult: 0.5 }], attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.18, filter: { type: 'lowpass', freq: 3200, q: 2, env: 2 } })
    case 'pad': return oscVoice(ctx, dest, pitch, when, len, v, o, { waves: [{ type: 'sawtooth', detune: -12, gain: 0.35 }, { type: 'sawtooth', detune: 12, gain: 0.35 }, { type: 'triangle', detune: 0, gain: 0.5 }], attack: 0.5, decay: 0.8, sustain: 0.8, release: 0.9, filter: { type: 'lowpass', freq: 1800, q: 0.5 } })
    case 'synthbass': return oscVoice(ctx, dest, pitch, when, len, v, o, { waves: [{ type: 'sawtooth', detune: 0, gain: 0.6 }, { type: 'square', detune: 0, gain: 0.4, mult: 0.5 }], attack: 0.004, decay: 0.25, sustain: 0.6, release: 0.08, filter: { type: 'lowpass', freq: 700, q: 4, env: 3 } })
    default: return oscVoice(ctx, dest, pitch, when, len, v, o, { waves: [{ type: 'sine', detune: 0, gain: 1 }], attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.2 })
  }
}

/** Metronome click. */
export function click(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean, volume: number): OscillatorNode {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.value = accent ? 1760 : 1180
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(0.5 * volume, when + 0.001)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
  o.connect(g).connect(dest)
  o.start(when)
  o.stop(when + 0.08)
  return o
}

/** Pre-generate sample buffers so the first playback doesn't stutter. */
export function warmup(ctx: BaseAudioContext, items: { sound: SoundId; pitch: number }[]): void {
  const uniq = [...new Map(items.map((i) => [`${i.sound}:${i.pitch}`, i])).values()]
  for (const s of new Set(items.map((i) => i.sound))) if (s !== 'sine') void loadPack(s)
  let k = 0
  const step = () => {
    const end = Math.min(uniq.length, k + 6)
    for (; k < end; k++) {
      const { sound, pitch } = uniq[k]
      if (sound === 'piano') { pianoBuf(ctx, pitch, 1); pianoBuf(ctx, pitch, 2) }
      else if (sound === 'epiano') epianoBuf(ctx, pitch)
      else if (sound === 'drums') drumBuf(ctx, drumPiece(pitch).id)
      else if (['steel', 'nylon', 'clean', 'drive', 'bass'].includes(sound)) {
        const cfg = { steel: [0.75, 4, 0.35], nylon: [0.35, 3.2, 0.5], clean: [0.55, 4.5, 0], drive: [0.6, 5, 0], bass: [0.28, 5, 0] }[sound as 'steel']
        pluck(ctx, pitch, cfg[0], cfg[1], cfg[2])
      }
    }
    if (k < uniq.length) setTimeout(step, 0)
  }
  step()
}
