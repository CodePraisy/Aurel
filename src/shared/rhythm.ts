import type { Project, RhythmEstimate } from './types'

/** Apply an estimate to an import before it has any notation to re-bar. */
export function applyRhythmEstimate(project: Project, rhythm: RhythmEstimate | null): void {
  project.analysis = { ...(project.analysis ?? { status: 'none' }), rhythm }
  if (!project.audio || !rhythm) return
  project.score.tempo = rhythm.bpm
  if (rhythm.timeSig) project.score.timeSig = rhythm.timeSig
  project.audio.offset = +rhythm.downbeat.toFixed(4)
}

export function detectedBpm(project: Project): number | undefined {
  const bpm = project.analysis?.detectedTempo ?? project.analysis?.rhythm?.bpm
  return bpm && Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : undefined
}

export function recordingRate(project: Project, speed: number): number {
  const reference = project.audio?.referenceTempo ?? detectedBpm(project)
  const ratio = project.audio?.tempoLinked && reference && reference > 0 ? project.score.tempo / reference : 1
  return Math.max(0.0625, Math.min(16, speed * ratio))
}
