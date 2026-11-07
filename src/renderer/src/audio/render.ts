import type { ExportAudioSettings, Part, Project } from '@shared/types'
import { orderChain, type VstRenderSpec } from '@shared/sounds'
import { flattenPart, tempoMap, measureCount, type TempoMap } from '@/music/score'
import { measureTicks } from '@/music/theory'
import { encodeWav, peakNormalize } from '@/music/wav'
import { playNote, partInsert, type NoteOpts } from './synth'
import { soundFor, fxFor, pluginSlots, routeFor, type Route } from './player'
import { buildChain } from './fx'
import { loadPack } from './samples'
import { api } from '@/lib/api'

export interface RenderOpts {
  partIds: string[] // parts to include
  from: number // measure
  to: number // measure, inclusive
  settings: ExportAudioSettings
  useAudioStems: boolean // render parts set to "Original audio" from their stems
  transpose?: number
}

const decoded = new Map<string, AudioBuffer>()
async function loadAudio(url: string, sr: number): Promise<AudioBuffer> {
  const key = `${url}@${sr}`
  const hit = decoded.get(key)
  if (hit) return hit
  const data = await (await fetch(url)).arrayBuffer()
  const tmp = new OfflineAudioContext(2, 1, sr)
  const b = await tmp.decodeAudioData(data)
  decoded.set(key, b)
  return b
}

function pluginBuffer(bytes: Uint8Array, sampleRate: number): AudioBuffer {
  const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  const audio = new AudioBuffer({ numberOfChannels: 2, length: data.length / 2, sampleRate })
  const left = audio.getChannelData(0), right = audio.getChannelData(1)
  for (let i = 0; i < audio.length; i++) { left[i] = data[2 * i]; right[i] = data[2 * i + 1] }
  return audio
}

const hostError = (e: Error) => new Error(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))

/** A part that plays through VST3 plug-ins, rendered by the same host used for playback. */
async function renderPluginPart(project: Project, part: Part, route: Route, tm: TempoMap, t0: number, t1: number, o: RenderOpts, length: number): Promise<AudioBuffer> {
  const sr = o.settings.sampleRate
  const startSec = tm.tickToSec(t0)
  const spec: VstRenderSpec = {
    slots: pluginSlots(part, route), sampleRate: sr, frames: length, tempo: tm.bpmAt(t0), timeSig: project.score.timeSig, notes: []
  }
  if (route === 'vsti') {
    for (const n of flattenPart(part, tm)) {
      if (n.tick >= t1 || n.tick + n.dur <= t0) continue
      const from = Math.round((tm.tickToSec(Math.max(n.tick, t0)) - startSec) * sr)
      const to = Math.round((tm.tickToSec(Math.min(n.tick + n.dur, t1)) - startSec) * sr)
      const end = n.staccato ? from + Math.max(1, Math.round((to - from) * 0.45)) : to
      const pitch = part.kind === 'drums' ? n.pitch : n.pitch + (o.transpose ?? 0)
      spec.notes.push(from, Math.max(from + 1, end), Math.max(0, Math.min(127, pitch)), Math.min(127, n.velocity * (n.accent ? 1.18 : 1)))
    }
  } else if (route === 'stemfx' && part.stem && project.audio) {
    const stream = await api.vst.stem(project.id, part.stem, o.transpose ?? 0, 1, sr).catch((e: Error) => { throw hostError(e) })
    const audioStart = Math.round((project.audio.offset + startSec) * sr)
    spec.file = { ref: stream.ref, frame: Math.max(0, -audioStart), offset: Math.max(0, audioStart) }
  } else {
    // built-in instrument into VST3 effects: render it dry first, then hand it to the plug-ins
    const dry = new OfflineAudioContext(2, length, sr)
    await schedulePart(dry, project, part, tm, t0, t1, { ...o, useAudioStems: false }, dry.destination)
    const buffer = await dry.startRendering()
    const l = buffer.getChannelData(0), r = buffer.getChannelData(1)
    const pcm = new Float32Array(length * 2)
    for (let i = 0; i < length; i++) { pcm[2 * i] = l[i]; pcm[2 * i + 1] = r[i] }
    spec.input = new Uint8Array(pcm.buffer)
  }
  const out = await api.vst.render(spec).catch((e: Error) => { throw hostError(e) })
  return pluginBuffer(out, sr)
}

async function schedulePart(ctx: OfflineAudioContext, project: Project, part: Part, tm: TempoMap, t0: number, t1: number, options: RenderOpts, out: AudioNode) {
  const startSec = tm.tickToSec(t0)
  if ((options.useAudioStems || part.kind === "singer") && part.playback === 'audio' && part.stem && project.audio) {
    const relative = options.transpose ? await api.media.pitchShift(project.id, part.stem, options.transpose) : part.stem
    const buf = await loadAudio(api.project.url(project.id, relative), ctx.sampleRate)
    const audioStart = project.audio.offset + startSec
    const audioEnd = project.audio.offset + tm.tickToSec(t1)
    const start = Math.max(0, audioStart)
    const duration = Math.min(audioEnd, buf.duration) - start
    if (duration > 0) {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(out)
      src.start(Math.max(0, -audioStart), start, duration)
    }
    return
  }
  const sound = soundFor(part)
  const notes = flattenPart(part, tm)
  const input = partInsert(ctx, sound, out)
  notes.forEach((n, i) => {
    if (n.tick < t0 || n.tick >= t1) return
    const end = Math.min(n.tick + n.dur, t1)
    const opts: NoteOpts = { tech: n.tech, bend: n.bend, staccato: n.staccato, accent: n.accent }
    const next = notes[i + 1]
    if (n.tech?.includes('slide') && next) opts.slideTo = next.pitch - n.pitch
    const pitch = part.kind === 'drums' ? n.pitch : Math.max(0, Math.min(127, n.pitch + (options.transpose ?? 0)))
    playNote(ctx, input, sound, pitch, tm.tickToSec(n.tick) - startSec, tm.tickToSec(end) - tm.tickToSec(n.tick), n.velocity, opts)
  })
}

/**
 * Render the selected parts and measure range offline with the same voices used
 * for live playback. Every render of the same range has identical length so
 * stems line up sample-accurately in a DAW.
 */
export async function renderWav(project: Project, o: RenderOpts): Promise<Uint8Array> {
  const s = project.score
  const mt = measureTicks(s.timeSig)
  const tm = tempoMap(s, 1)
  const t0 = o.from * mt
  const t1 = (o.to + 1) * mt
  const sr = o.settings.sampleRate
  const startSec = tm.tickToSec(t0)
  const lengthSec = s.parts.length ? tm.tickToSec(t1) - startSec + o.settings.tail : (project.audio?.duration ?? 1)
  await Promise.all(s.parts.filter((p) => o.partIds.includes(p.id)).map((p) => loadPack(soundFor(p))))
  const ctx = new OfflineAudioContext(2, Math.ceil(lengthSec * sr), sr)
  const master = ctx.createGain()
  master.connect(ctx.destination)
  for (const part of s.parts) {
    if (!o.partIds.includes(part.id)) continue
    const gain = ctx.createGain()
    gain.gain.value = part.volume
    const pan = ctx.createStereoPanner()
    pan.pan.value = part.pan
    gain.connect(pan).connect(master)
    // VST3 effects run first (in the host), then the built-in ones, exactly as in playback
    const builtins = orderChain(fxFor(part)).filter((slot) => slot.type !== 'vst3')
    const route = routeFor(part, !!project.audio && (o.useAudioStems || part.kind === "singer"))
    if (route === 'vsti' || route === 'stemfx' || route === 'capture') {
      const src = ctx.createBufferSource()
      src.buffer = await renderPluginPart(project, part, route, tm, t0, t1, o, ctx.length)
      src.connect(buildChain(ctx, builtins, gain))
      src.start()
    } else await schedulePart(ctx, project, part, tm, t0, t1, o, buildChain(ctx, builtins, gain))
  }
  if (!s.parts.length && project.audio) {
    const buf = await loadAudio(api.project.url(project.id, project.audio.original), sr)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(master)
    src.start(0)
  }
  const out = await ctx.startRendering()
  let chans = [out.getChannelData(0), out.getChannelData(1)]
  if (o.settings.channels === 1) {
    const m = new Float32Array(out.length)
    for (let i = 0; i < m.length; i++) m[i] = (chans[0][i] + chans[1][i]) * 0.5
    chans = [m]
  }
  if (o.settings.normalize) peakNormalize(chans)
  return encodeWav(chans, sr, o.settings.bitDepth)
}

export function fullRange(project: Project): { from: number; to: number } {
  return { from: 0, to: Math.max(0, measureCount(project.score) - 1) }
}
