import type { BuiltinFxSlot, FxSlot } from '@shared/sounds'

const irCache = new Map<string, AudioBuffer>()
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${seconds.toFixed(1)}`
  const hit = irCache.get(key)
  if (hit) return hit
  const len = Math.floor(ctx.sampleRate * seconds)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < len; i++) {
      const t = i / len
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * (i < 64 ? i / 64 : 1)
    }
  }
  irCache.set(key, b)
  return b
}

const curves = new Map<number, Float32Array>()
function shaper(amount: number): Float32Array<ArrayBuffer> {
  const k = Math.round(amount * 10) / 10
  let c = curves.get(k)
  if (!c) {
    c = new Float32Array(4096)
    for (let i = 0; i < c.length; i++) { const x = (i / (c.length - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k) }
    curves.set(k, c)
  }
  return c as Float32Array<ArrayBuffer>
}

const dbToGain = (db: number) => Math.pow(10, db / 20)

/** Wet/dry wrapper: returns [input, output] around a wet path. */
function wetDry(ctx: BaseAudioContext, mix: number, build: (inp: AudioNode, out: AudioNode) => void): [AudioNode, AudioNode] {
  const inp = ctx.createGain()
  const out = ctx.createGain()
  const dry = ctx.createGain(); dry.gain.value = 1 - mix * 0.5
  const wet = ctx.createGain(); wet.gain.value = mix
  inp.connect(dry).connect(out)
  const wetIn = ctx.createGain()
  inp.connect(wetIn)
  build(wetIn, wet)
  wet.connect(out)
  return [inp, out]
}

function effect(ctx: BaseAudioContext, s: BuiltinFxSlot): [AudioNode, AudioNode] {
  const p = s.params
  switch (s.type) {
    case 'eq': {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.lowCut; hp.Q.value = 0.7
      const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 160; lo.gain.value = p.low
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = p.midFreq; mid.Q.value = 0.9; mid.gain.value = p.mid
      const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 6000; hi.gain.value = p.high
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(p.highCut, ctx.sampleRate / 2 - 100); lp.Q.value = 0.7
      hp.connect(lo).connect(mid).connect(hi).connect(lp)
      return [hp, lp]
    }
    case 'comp': {
      const c = ctx.createDynamicsCompressor()
      c.threshold.value = p.threshold; c.ratio.value = p.ratio; c.attack.value = p.attack / 1000; c.release.value = p.release / 1000; c.knee.value = 6
      const g = ctx.createGain(); g.gain.value = dbToGain(p.makeup)
      c.connect(g)
      return [c, g]
    }
    case 'reverb': return wetDry(ctx, p.mix, (inp, out) => {
      const pre = ctx.createDelay(0.5); pre.delayTime.value = p.predelay / 1000
      const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, p.size)
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = p.tone
      inp.connect(pre).connect(conv).connect(tone).connect(out)
    })
    case 'delay': return wetDry(ctx, p.mix, (inp, out) => {
      const d = ctx.createDelay(2); d.delayTime.value = p.time / 1000
      const fb = ctx.createGain(); fb.gain.value = p.feedback
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = p.tone
      inp.connect(d).connect(tone).connect(out)
      tone.connect(fb).connect(d)
    })
    case 'chorus': return wetDry(ctx, p.mix, (inp, out) => {
      const merger = ctx.createChannelMerger(2)
      for (let ch = 0; ch < 2; ch++) {
        const d = ctx.createDelay(0.05); d.delayTime.value = 0.012 + ch * 0.004
        const lfo = ctx.createOscillator(); lfo.frequency.value = p.rate * (ch ? 1.1 : 1)
        const depth = ctx.createGain(); depth.gain.value = 0.004 * p.depth
        lfo.connect(depth).connect(d.delayTime)
        lfo.start()
        inp.connect(d).connect(merger, 0, ch)
      }
      merger.connect(out)
    })
    case 'drive': {
      const pre = ctx.createGain(); pre.gain.value = p.gain
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80
      const ws = ctx.createWaveShaper(); ws.curve = shaper(Math.min(8, 1 + p.gain / 4)); ws.oversample = '4x'
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = p.tone; tone.Q.value = 0.8
      const post = ctx.createGain(); post.gain.value = p.level
      pre.connect(hp).connect(ws).connect(tone)
      if (p.cab >= 0.5) {
        const cab1 = ctx.createBiquadFilter(); cab1.type = 'peaking'; cab1.frequency.value = 110; cab1.gain.value = 3
        const cab2 = ctx.createBiquadFilter(); cab2.type = 'peaking'; cab2.frequency.value = 2400; cab2.gain.value = 4; cab2.Q.value = 1.2
        const cab3 = ctx.createBiquadFilter(); cab3.type = 'lowpass'; cab3.frequency.value = 5200; cab3.Q.value = 0.9
        tone.connect(cab1).connect(cab2).connect(cab3).connect(post)
      } else tone.connect(post)
      return [pre, post]
    }
    case 'filter': {
      const f = ctx.createBiquadFilter(); f.type = p.mode >= 0.5 ? 'highpass' : 'lowpass'; f.frequency.value = p.freq; f.Q.value = p.q
      return [f, f]
    }
    case 'gain': {
      const g = ctx.createGain(); g.gain.value = dbToGain(p.db)
      // mid/side width
      const split = ctx.createChannelSplitter(2)
      const merge = ctx.createChannelMerger(2)
      const w = p.width
      const ll = ctx.createGain(), lr = ctx.createGain(), rl = ctx.createGain(), rr = ctx.createGain()
      ll.gain.value = rr.gain.value = (1 + w) / 2
      lr.gain.value = rl.gain.value = (1 - w) / 2
      g.connect(split)
      split.connect(ll, 0).connect(merge, 0, 0); split.connect(rl, 1).connect(merge, 0, 0)
      split.connect(rr, 1).connect(merge, 0, 1); split.connect(lr, 0).connect(merge, 0, 1)
      return [g, merge]
    }
  }
}

/** Chain enabled effects in order in front of `out`; returns the chain input. */
export function buildChain(ctx: BaseAudioContext, slots: FxSlot[] | undefined, out: AudioNode): AudioNode {
  const active = (slots ?? []).filter((s): s is BuiltinFxSlot => s.on && s.type !== 'vst3')
  if (!active.length) return out
  const input = ctx.createGain()
  let prev: AudioNode = input
  for (const s of active) {
    const [i, o] = effect(ctx, s)
    prev.connect(i)
    prev = o
  }
  prev.connect(out)
  return input
}
