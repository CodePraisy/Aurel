import { packFor, customId } from '@shared/sounds'
import { customSound, onCustomSoundsChanged } from './custom'
import { api } from '@/lib/api'
import { drumPiece } from '@/music/theory'

type State = 'missing' | 'loading' | 'ready'
const buffers = new Map<string, Map<number, AudioBuffer>>()
const states = new Map<string, State>()
const loading = new Map<string, Promise<boolean>>()
const listeners = new Set<() => void>()
let decoder: OfflineAudioContext | null = null

export function onPacksChanged(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn) }
const emit = () => listeners.forEach((f) => f())

export function packState(id: string): State { return states.get(id) ?? 'missing' }
export function packReady(id: string): boolean { return states.get(id) === 'ready' }

/** Decode a downloaded pack into memory. Resolves false if files are missing on disk. */
export function loadPack(id: string): Promise<boolean> {
  if (states.get(id) === 'ready') return Promise.resolve(true)
  if (states.get(id) === 'missing') return Promise.resolve(false) // not downloaded; retried after resetMissing()
  const pending = loading.get(id)
  if (pending) return pending
  const own = customSound(id)
  const pack = own ? { id: customId(id)!, files: own.samples.map((s) => ({ note: s.note, file: s.file })) } : packFor(id)
  if (!pack) return Promise.resolve(false)
  states.set(id, 'loading')
  const p = (async () => {
    decoder ??= new OfflineAudioContext(2, 1, 44100)
    const map = new Map<number, AudioBuffer>()
    try {
      if (!own) {
        const status = (await api.sounds.status()).find((s) => s.id === id)
        if (!status?.ready) throw new Error('not downloaded')
      }
      await Promise.all(pack.files.map(async (f) => {
        const r = await fetch(own ? api.sounds.customUrl(pack.id, f.file) : api.sounds.url(pack.id, f.file))
        if (!r.ok) throw new Error('missing')
        map.set(f.note, await decoder!.decodeAudioData(await r.arrayBuffer()))
      }))
      buffers.set(id, map)
      states.set(id, 'ready')
      emit()
      return true
    } catch {
      states.set(id, 'missing')
      return false
    } finally {
      loading.delete(id)
    }
  })()
  loading.set(id, p)
  return p
}

// Your own instruments reload when their samples change.
onCustomSoundsChanged((ids) => {
  for (const id of ids) { buffers.delete(id); states.delete(id); loading.delete(id) }
  emit()
})

/** Forget loaded state (after a download finishes) so packs are re-read from disk. */
export function resetMissing(): void { for (const [k, v] of states) if (v === 'missing') states.delete(k) }

const RELEASE: Record<string, number> = { piano: 0.35, epiano: 0.3, organ: 0.08, steel: 0.18, nylon: 0.18, clean: 0.15, drive: 0.12, dist: 0.12, bass: 0.12, synthbass: 0.1, voice: 0.4, strings: 0.35, brass: 0.15, reed: 0.12, lead: 0.15, pad: 0.8, drums: 0.05 }
const LEVEL: Record<string, number> = { piano: 1.25, drums: 1.1, bass: 1.1 }

export interface SampleHit { src: AudioBufferSourceNode; gain: GainNode; end: number }

/** Play the nearest sample, re-pitched. Returns null when the pack (or a drum piece) isn't available. */
export function playSample(ctx: BaseAudioContext, dest: AudioNode, packId: string, pitch: number, when: number, dur: number, vel: number, opts: { palmMute?: boolean; legato?: boolean; staccato?: boolean }): SampleHit | null {
  const map = buffers.get(packId)
  if (!map) return null
  let buf: AudioBuffer | undefined
  let rate = 1
  if (packId === 'drums') {
    const piece = drumPiece(pitch)
    const key = piece.id === 'hhPedal' ? 42 : piece.midi
    buf = map.get(key)
    if (!buf) return null
  } else {
    let best = -1, bestD = Infinity
    for (const n of map.keys()) { const d = Math.abs(n - pitch); if (d < bestD) { bestD = d; best = n } }
    buf = map.get(best)
    rate = Math.pow(2, (pitch - best) / 12)
  }
  if (!buf) return null
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const g = ctx.createGain()
  const v = Math.max(1, Math.min(127, vel)) / 127
  const peak = Math.pow(v, 1.5) * 0.85 * (LEVEL[packId] ?? 1) * (opts.legato ? 0.7 : 1) * (packId === 'drums' && drumPiece(pitch).id === 'hhPedal' ? 0.5 : 1)
  let head: AudioNode = src
  if (packId === 'piano' || opts.palmMute) {
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = opts.palmMute ? 1100 : 1800 + v * v * 16000
    head.connect(lp)
    head = lp
  }
  head.connect(g).connect(dest)
  g.gain.setValueAtTime(peak, when)
  const natural = buf.duration / rate
  const length = packId === 'drums' ? natural : Math.min(natural, opts.palmMute ? Math.min(dur, 0.2) : opts.staccato ? Math.max(0.06, dur * 0.5) : dur)
  const rel = opts.palmMute ? 0.05 : RELEASE[packId] ?? 0.15
  const end = when + length
  if (end < when + natural) {
    g.gain.setValueAtTime(peak, end)
    g.gain.setTargetAtTime(0, end, rel / 4)
  }
  src.start(when)
  src.stop(Math.min(when + natural, end + rel + 0.05))
  return { src, gain: g, end: end + rel }
}
