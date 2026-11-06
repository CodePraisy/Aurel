import fs from 'fs'
import { join, basename, extname } from 'path'
import crypto from 'crypto'
import { net } from 'electron'
import type { Project } from '@shared/types'
import { applyRhythmEstimate } from '@shared/rhythm'
import { paths, saveProjectFile, findDuplicate, indexProject, writeAtomic } from './store'
import type { JobCtx } from './jobs'
import { guessTempo } from './analyze'

export const AUDIO_EXT = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'alac', 'webm', 'mp4', 'mkv', 'mov', 'avi', 'm4v']

export function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

const parseTime = (s: string) => { const m = s.match(/(\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0 }

export interface Probe { duration: number; hasAudio: boolean; title?: string; artist?: string; hasCover: boolean }

export async function probe(ctx: JobCtx, file: string): Promise<Probe> {
  const { err } = await ctx.run(paths.ffmpeg, ['-hide_banner', '-i', file])
  const dur = err.match(/Duration:\s*([\d:.]+)/)
  const tag = (k: string) => err.match(new RegExp(`^\\s+${k}\\s*:\\s*(.+)$`, 'mi'))?.[1]?.trim()
  return {
    duration: dur ? parseTime(dur[1]) : 0,
    hasAudio: /Stream #\S+.*Audio:/.test(err),
    hasCover: /Stream #\S+.*Video:.*\(attached pic\)/.test(err) || /Video: (mjpeg|png)/.test(err),
    title: tag('title'),
    artist: tag('artist') ?? tag('album_artist')
  }
}

/** Decode anything FFmpeg understands into 44.1 kHz stereo 16-bit WAV. */
export async function toWav(ctx: JobCtx, input: string, output: string, duration: number, stage = 'Converting audio'): Promise<void> {
  fs.mkdirSync(join(output, '..'), { recursive: true })
  const res = await ctx.run(paths.ffmpeg, ['-hide_banner', '-y', '-i', input, '-vn', '-map_metadata', '-1', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', output], {
    onLine: (l) => { const m = l.match(/time=([\d:.]+)/); if (m && duration) ctx.progress(stage, Math.min(1, parseTime(m[1]) / duration)) }
  })
  if (res.code !== 0 || !fs.existsSync(output)) throw new Error(`FFmpeg could not decode this file.\n${res.err.split('\n').slice(-4).join('\n')}`)
}

export async function extractCover(ctx: JobCtx, input: string, out: string): Promise<boolean> {
  try {
    const r = await ctx.run(paths.ffmpeg, ['-hide_banner', '-y', '-i', input, '-an', '-frames:v', '1', '-vf', 'scale=512:-1', out])
    return r.code === 0 && fs.existsSync(out)
  } catch { return false }
}

/**
 * Remove silence before the music starts, so playback and transcription begin with the first sound.
 * Anything above about -54 dBFS counts as sound, so soft notes and fade-ins are kept, along with a
 * 30 ms margin before them. Returns the seconds removed (0 when there was no real gap).
 */
export function trimLeadingSilence(wavFile: string): number {
  const buf = fs.readFileSync(wavFile)
  let off = 12, channels = 2, rate = 44100, bits = 16, dataStart = -1, dataLen = 0, dataHeader = -1
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') { channels = buf.readUInt16LE(off + 10); rate = buf.readUInt32LE(off + 12); bits = buf.readUInt16LE(off + 22) }
    if (id === 'data') { dataHeader = off; dataStart = off + 8; dataLen = Math.min(size, buf.length - dataStart); break }
    off += 8 + size + (size % 2)
  }
  if (dataStart < 0 || bits !== 16) return 0
  const frameBytes = 2 * channels
  const frames = Math.floor(dataLen / frameBytes)
  const threshold = Math.round(0.002 * 32768) // ≈ -54 dBFS
  let first = frames
  for (let i = 0; i < frames && first === frames; i++) {
    for (let c = 0; c < channels; c++) {
      if (Math.abs(buf.readInt16LE(dataStart + i * frameBytes + c * 2)) > threshold) { first = i; break }
    }
  }
  if (first >= frames) return 0 // silent file: leave it alone
  const cut = Math.max(0, first - Math.round(rate * 0.03))
  if (cut < rate * 0.25) return 0
  const kept = (frames - cut) * frameBytes
  const out = Buffer.alloc(dataStart + kept)
  buf.copy(out, 0, 0, dataStart)
  buf.copy(out, dataStart, dataStart + cut * frameBytes, dataStart + frames * frameBytes)
  out.writeUInt32LE(out.length - 8, 4)
  out.writeUInt32LE(kept, dataHeader + 4)
  writeAtomic(wavFile, out)
  return cut / rate
}

/** Min/max peak pairs for drawing a waveform, computed from our WAV. */
export function computePeaks(wavFile: string, buckets = 3000): number[] {
  const buf = fs.readFileSync(wavFile)
  let off = 12
  let dataStart = 44
  let dataLen = buf.length - 44
  let channels = 2
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') channels = buf.readUInt16LE(off + 10)
    if (id === 'data') { dataStart = off + 8; dataLen = Math.min(size, buf.length - dataStart); break }
    off += 8 + size + (size % 2)
  }
  const frames = Math.floor(dataLen / (2 * channels))
  const per = Math.max(1, Math.floor(frames / buckets))
  const out: number[] = []
  for (let b = 0; b < buckets && b * per < frames; b++) {
    let mn = 0, mx = 0
    const end = Math.min(frames, (b + 1) * per)
    for (let i = b * per; i < end; i += 4) {
      const s = buf.readInt16LE(dataStart + i * 2 * channels) / 32768
      if (s < mn) mn = s
      if (s > mx) mx = s
    }
    out.push(+mn.toFixed(3), +mx.toFixed(3))
  }
  return out
}

export function emptyTranscriptionProject(id: string, title: string, artist: string, duration: number): Project {
  const now = Date.now()
  return {
    id, kind: 'transcription', created: now, updated: now,
    score: { title, composer: artist, tempo: 120, timeSig: { num: 4, den: 4 }, keyFifths: 0, parts: [] },
    audio: { original: 'audio/original.wav', duration, offset: 0 },
    analysis: { status: 'none' },
    practice: { loops: [], speed: 1 },
    view: { mode: 'both', zoom: 1, part: 'all' }
  }
}

/** Detect BPM, meter and first downbeat so the grid lines up from the start. */
export function applyTempoGuess(p: Project, wavFile: string): void {
  try {
    applyRhythmEstimate(p, guessTempo(wavFile))
  } catch (error) {
    console.warn('Could not analyze the imported recording', error)
    applyRhythmEstimate(p, null)
  }
}

export async function importAudioJob(ctx: JobCtx, file: string, allowDuplicate: boolean): Promise<{ projectId: string; duplicate?: boolean }> {
  ctx.progress('Checking file', -1)
  if (!fs.existsSync(file)) throw new Error('File not found')
  const hash = await hashFile(file)
  const dup = findDuplicate('hash', hash)
  if (dup && !allowDuplicate) return { projectId: dup, duplicate: true }
  const info = await probe(ctx, file)
  if (!info.hasAudio) throw new Error('This file has no audio stream.')
  const id = newId()
  const dir = paths.project(id)
  try {
    await toWav(ctx, file, join(dir, 'audio', 'original.wav'), info.duration)
    ctx.progress('Analysing waveform', -1)
    const trimmed = trimLeadingSilence(join(dir, 'audio', 'original.wav'))
    writeAtomic(join(dir, 'peaks.json'), JSON.stringify(computePeaks(join(dir, 'audio', 'original.wav'))))
    if (info.hasCover) await extractCover(ctx, file, join(dir, 'artwork.jpg'))
    const title = info.title || basename(file, extname(file)).replace(/[_]+/g, ' ')
    const p = emptyTranscriptionProject(id, title, info.artist ?? '', Math.max(0, info.duration - trimmed))
    p.audio!.trimmed = trimmed
    p.audio!.sourceUrl = file
    ctx.progress('Detecting tempo & time signature', -1)
    applyTempoGuess(p, join(dir, 'audio', 'original.wav'))
    saveProjectFile(p)
    indexProject(p, { hash, source: basename(file) })
    return { projectId: id }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

/** Direct audio/video URL (not a streaming platform page). */
export async function importUrlJob(ctx: JobCtx, url: string): Promise<{ projectId: string; duplicate?: boolean }> {
  let u: URL
  try { u = new URL(url) } catch { throw new Error('That is not a valid URL.') }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links are supported.')
  ctx.progress('Connecting', -1)
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`Server responded ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!/audio|video|octet-stream/.test(type)) throw new Error(`The link does not point to an audio file (content-type: ${type || 'unknown'}).`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const ext = extname(u.pathname).slice(1).toLowerCase() || 'bin'
  const tmp = join(paths.data, 'downloads', `${Date.now()}.${AUDIO_EXT.includes(ext) ? ext : 'bin'}`)
  fs.mkdirSync(join(tmp, '..'), { recursive: true })
  const out = fs.createWriteStream(tmp)
  let got = 0
  const reader = res.body.getReader()
  try {
    for (;;) {
      ctx.check()
      const { done, value } = await reader.read()
      if (done) break
      got += value.length
      out.write(value)
      ctx.progress('Downloading', total ? got / total : -1, `${(got / 1e6).toFixed(1)} MB`)
    }
  } finally {
    await new Promise((r) => out.end(r))
  }
  try {
    const r = await importAudioJob(ctx, tmp, false)
    if (!r.duplicate) {
      const pj = JSON.parse(fs.readFileSync(join(paths.project(r.projectId), 'project.json'), 'utf8')) as Project
      pj.audio!.sourceUrl = url
      if (pj.score.title.match(/^\d+$/)) pj.score.title = decodeURIComponent(basename(u.pathname, extname(u.pathname))) || 'Imported audio'
      saveProjectFile(pj)
      indexProject(pj, { source: url })
    }
    return r
  } finally { fs.rmSync(tmp, { force: true }) }
}

export async function convertWav(ctx: JobCtx | null, wav: string, out: string, format: 'mp3' | 'flac'): Promise<void> {
  const args = ['-hide_banner', '-y', '-i', wav, ...(format === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '320k'] : ['-c:a', 'flac']), out]
  const { spawnSync } = await import('child_process')
  if (ctx) { const r = await ctx.run(paths.ffmpeg, args); if (r.code !== 0) throw new Error('FFmpeg encode failed'); return }
  const r = spawnSync(paths.ffmpeg, args, { windowsHide: true })
  if (r.status !== 0) throw new Error(`FFmpeg encode failed: ${r.stderr?.toString().split('\n').slice(-3).join(' ')}`)
}

/** Pitch-shift a project audio file by semitones without changing tempo (cached). */
export async function pitchShift(projectId: string, rel: string, semis: number): Promise<string> {
  if (!semis) return rel
  const out = `cache/shift/${rel.replace(/[\\/]/g, '_').replace(/\.wav$/, '')}.${semis > 0 ? 'p' : 'm'}${Math.abs(semis)}.wav`
  const full = paths.inProject(projectId, out)
  if (fs.existsSync(full)) return out
  fs.mkdirSync(join(full, '..'), { recursive: true })
  const ratio = Math.pow(2, semis / 12)
  // asetrate shifts pitch+tempo; atempo restores the tempo (chained to stay within 0.5..2)
  let tempo = 1 / ratio
  const chain: string[] = []
  while (tempo < 0.5) { chain.push('atempo=0.5'); tempo /= 0.5 }
  while (tempo > 2) { chain.push('atempo=2'); tempo /= 2 }
  chain.push(`atempo=${tempo.toFixed(6)}`)
  const { spawn } = await import('child_process')
  await new Promise<void>((resolve, reject) => {
    const p = spawn(paths.ffmpeg, ['-hide_banner', '-y', '-i', paths.inProject(projectId, rel), '-af', `asetrate=${Math.round(44100 * ratio)},aresample=44100,${chain.join(',')}`, '-c:a', 'pcm_s16le', full], { windowsHide: true })
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('Pitch shift failed'))))
  })
  return out
}
