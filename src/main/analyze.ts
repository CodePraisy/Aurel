import fs from 'fs'
import type { RhythmEstimate } from '../shared/types'

const MIN_BPM = 45
const MAX_BPM = 240
const ANALYSIS_SECONDS = 120

/** Read the start of a PCM16 WAV, including WAVs with extra RIFF chunks. */
function readPcm(file: string) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const header = Buffer.alloc(16)
    if (fs.readSync(fd, header, 0, 12, 0) !== 12 ||
        header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('Expected a PCM WAV recording')
    }
    let channels = 0
    let sr = 0
    for (let pos = 12; pos + 8 <= size;) {
      if (fs.readSync(fd, header, 0, 8, pos) !== 8) break
      const id = header.toString('ascii', 0, 4)
      const length = header.readUInt32LE(4)
      pos += 8
      if (id === 'fmt ' && length >= 16 && fs.readSync(fd, header, 0, 16, pos) === 16) {
        if (header.readUInt16LE(0) !== 1 || header.readUInt16LE(14) !== 16) break
        channels = header.readUInt16LE(2)
        sr = header.readUInt32LE(4)
      } else if (id === 'data' && channels > 0 && sr > 0) {
        const pcm = Buffer.allocUnsafe(Math.min(length, size - pos, sr * channels * 2 * ANALYSIS_SECONDS))
        const bytes = fs.readSync(fd, pcm, 0, pcm.length, pos)
        return { pcm: pcm.subarray(0, bytes), channels, sr }
      }
      pos += length + (length % 2)
    }
    throw new Error('Could not read PCM16 audio')
  } finally {
    fs.closeSync(fd)
  }
}

/** Low, mid and high attack strength. Measure channels separately to avoid stereo cancellation. */
function attacks({ pcm, channels, sr }: ReturnType<typeof readPcm>, hop: number) {
  const frames = Math.floor(pcm.length / (2 * channels * hop))
  const bands = Array.from({ length: 3 }, () => new Float32Array(frames))
  const bass = new Float64Array(channels)
  const body = new Float64Array(channels)
  const bassMix = 1 - Math.exp(-2 * Math.PI * 160 / sr)
  const bodyMix = 1 - Math.exp(-2 * Math.PI * 1800 / sr)
  let pos = 0
  for (let frame = 0; frame < frames; frame++) {
    let low = 0, mid = 0, high = 0
    for (let i = 0; i < hop; i++) {
      for (let ch = 0; ch < channels; ch++, pos += 2) {
        const sample = pcm.readInt16LE(pos) / 32768
        bass[ch] += (sample - bass[ch]) * bassMix
        body[ch] += (sample - body[ch]) * bodyMix
        low += bass[ch] ** 2
        mid += (body[ch] - bass[ch]) ** 2
        high += (sample - body[ch]) ** 2
      }
    }
    bands[0][frame] = low
    bands[1][frame] = mid
    bands[2][frame] = high
  }
  for (const band of bands) {
    const peak = band.reduce((max, energy) => Math.max(max, energy), 0)
    // A floor relative to the loudest frame keeps quiet tails and codec noise from dominating.
    const floor = Math.max(peak * 0.002, hop * channels * 1e-8)
    let previous = 0
    for (let i = 0; i < band.length; i++) {
      const level = Math.log1p(band[i] / floor)
      band[i] = Math.max(0, level - previous)
      previous += 0.6 * (level - previous)
    }
  }
  return bands
}

function correlations(env: Float32Array, maxLag: number) {
  const mean = env.reduce((sum, value) => sum + value, 0) / env.length
  const centered = env.map((value) => value - mean)
  const scores = new Float64Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let cross = 0, recent = 0, delayed = 0
    for (let i = lag; i < centered.length; i++) {
      const a = centered[i], b = centered[i - lag]
      cross += a * b
      recent += a * a
      delayed += b * b
    }
    if (recent > 0 && delayed > 0) scores[lag] = cross / Math.sqrt(recent * delayed)
  }
  return scores
}

function estimateMeter(beats: number[][]) {
  // Compare how well accents repeat in groups of 3 and 4. A uniform click has no meter evidence.
  const candidates = [3, 4].map((num) => {
    const pattern = Array.from({ length: num }, (_, phase) => beats.map((band) => {
      const values = band.filter((_, i) => i % num === phase)
      return values.reduce((sum, value) => sum + value, 0) / values.length
    }))
    let variation = 0, explained = 0
    for (let b = 0; b < beats.length; b++) {
      const mean = beats[b].reduce((sum, value) => sum + value, 0) / beats[b].length
      for (let i = 0; i < beats[b].length; i++) {
        variation += (beats[b][i] - mean) ** 2
        explained += (pattern[i % num][b] - mean) ** 2
      }
    }
    const accents = pattern.map(([low, mid, high]) => 1.5 * low + mid + 0.5 * high)
    return { num, phase: accents.indexOf(Math.max(...accents)), strength: variation > 0 ? explained / variation : 0 }
  }).sort((a, b) => b.strength - a.strength)
  const [best, next] = candidates
  return best.strength >= 0.15 && best.strength - next.strength >= 0.08 ? best : undefined
}

function findPulse(env: Float32Array, fps: number, minimumCorrelation: number) {
  if (env.length < 4 * fps || env.reduce((sum, value) => sum + value ** 2, 0) < 1) return null
  const minLag = Math.floor(60 * fps / MAX_BPM)
  const maxLag = Math.ceil(60 * fps / MIN_BPM)
  const corr = correlations(env, maxLag * 2 + 4)
  const peaks: { lag: number; score: number }[] = []
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corr[lag] < minimumCorrelation || corr[lag] <= corr[lag - 1] || corr[lag] < corr[lag + 1]) continue
    const repeat = Math.max(corr[2 * lag - 2], corr[2 * lag - 1], corr[2 * lag], corr[2 * lag + 1], corr[2 * lag + 2])
    const preference = 1 - 0.12 * Math.abs(Math.log2(60 * fps / lag / 110))
    peaks.push({ lag, score: (0.8 * corr[lag] + 0.2 * Math.max(0, repeat)) * preference })
  }
  const strongest = peaks.reduce<(typeof peaks)[number] | undefined>(
    (best, peak) => !best || peak.score > best.score ? peak : best, undefined)
  if (!strongest) return null

  // Prefer the fundamental over its multiples when they have comparable evidence.
  const { lag } = peaks.find((p) => {
    const multiple = strongest.lag / p.lag
    return Math.abs(multiple - Math.round(multiple)) < 0.055 && p.score >= strongest.score * 0.85
  }) ?? strongest
  const left = corr[lag - 1], center = corr[lag], right = corr[lag + 1]
  return lag + 0.5 * (left - right) / (left - 2 * center + right)
}

/** Estimate the prevailing pulse and, when the accents support it, 3/4 or 4/4. */
export function guessTempo(file: string): RhythmEstimate | null {
  const wav = readPcm(file)
  const hop = Math.max(1, Math.round(wav.sr / 100))
  const fps = wav.sr / hop
  const bands = attacks(wav, hop)
  const pulse = bands[0].map((low, i) => (low + bands[1][i] + bands[2][i]) / 3)
  // Smooth by a few frames so small variations in timing don't erase a repeating pulse.
  const smooth = pulse.map((value, i) =>
    (3 * value + 2 * ((pulse[i - 1] ?? 0) + (pulse[i + 1] ?? 0)) + (pulse[i - 2] ?? 0) + (pulse[i + 2] ?? 0)) / 9)
  let period = findPulse(smooth, fps, 0.22)
  if (period === null) {
    // In a performance with tempo drift, look for a pulse supported by several separate sections.
    const sections: number[] = []
    const size = Math.round(12 * fps)
    for (let i = 0; i + size <= smooth.length; i += size) {
      const local = findPulse(smooth.subarray(i, i + size), fps, 0.22)
      if (local !== null) sections.push(local)
    }
    const groups = sections.map((p) => sections.filter((v) => Math.abs(v / p - 1) < 0.06))
    const group = groups.sort((a, b) => b.length - a.length)[0]
    if (!group || group.length < 3 || group.length <= sections.length / 2) return null
    period = group.reduce((sum, value) => sum + value, 0) / group.length
    // An overall estimate from different passages does not establish a downbeat or meter.
    return { bpm: Math.round(60 * fps / period * 10) / 10, downbeat: 0 }
  }
  const bpm = Math.round(60 * fps / period * 10) / 10

  // Fit the phase near the start to avoid accumulating phase error over a long recording.
  const first = Math.max(0, smooth.findIndex((v) => v > 0.08))
  const phaseEnd = Math.min(smooth.length, first + Math.round(24 * fps))
  let phase = 0, bestPhaseScore = -1
  for (let p = 0; p < period; p += 0.25) {
    let score = 0
    for (let t = p; t < phaseEnd; t += period) score += smooth[Math.round(t)] ?? 0
    if (score > bestPhaseScore) { phase = p; bestPhaseScore = score }
  }
  const start = Math.max(0, Math.ceil((first - phase - 4) / period))
  const end = Math.floor((phaseEnd - phase - 4) / period)
  const count = end - start + 1
  const beats = bands.map((band) => Array.from({ length: Math.max(0, count) }, (_, i) => {
    const at = Math.round(phase + (start + i) * period)
    return Math.max(...band.subarray(Math.max(0, at - 4), at + 5))
  }))
  const meter = count >= 12 ? estimateMeter(beats) : undefined
  const bar = (meter?.num ?? 1) * period
  const downbeat = (phase + (meter ? (start + meter.phase) * period : 0)) % bar / fps
  return { bpm, timeSig: meter ? { num: meter.num, den: 4 } : undefined, downbeat }
}
