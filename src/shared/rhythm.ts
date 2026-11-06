import type { Project, RhythmEstimate } from './types'

/** Apply an estimate to an import before it has any notation to re-bar. */
export function applyRhythmEstimate(project: Project, rhythm: RhythmEstimate | null): void {
  project.analysis = { ...(project.analysis ?? { status: 'none' }), rhythm }
  if (!project.audio || !rhythm) return
  project.score.tempo = rhythm.bpm
  if (rhythm.timeSig) project.score.timeSig = rhythm.timeSig
  project.audio.offset = +rhythm.downbeat.toFixed(4)
}
