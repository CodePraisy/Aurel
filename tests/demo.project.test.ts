// Builds a demo project folder from an engine analysis, for screenshots of the studio.
// DEMO_ANALYSIS=<run>/analysis.json DEMO_OUT=<userData>/Library/projects/<id> npx vitest run tests/demo.project.test.ts
import { it } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import type { EngineAnalysis, Project } from '@shared/types'
import { analysisToScore, DEFAULT_TRANSCRIBE } from '@/music/quantize'

it.runIf(!!process.env.DEMO_ANALYSIS)('demo project', () => {
  const a = JSON.parse(fs.readFileSync(process.env.DEMO_ANALYSIS!, 'utf8')) as EngineAnalysis
  const { score, offset } = analysisToScore(a, process.env.DEMO_TITLE ?? 'Blur of Life', 'AlpacaGuitarSet', undefined, undefined, true, DEFAULT_TRANSCRIBE)
  const out = process.env.DEMO_OUT!
  const id = out.split('/').pop()!
  score.parts.forEach((p) => { if (p.stem) p.stem = p.stem })
  const project: Project = {
    id, kind: 'transcription', created: Date.now(), updated: Date.now(), score,
    audio: { original: 'audio.wav', duration: a.duration ?? 48, offset },
    analysis: { status: 'done', device: 'cpu', detectedTempo: a.tempo, finishedAt: Date.now() },
    practice: { loops: [], speed: 1 }, view: { mode: 'both', zoom: 1, part: 'all' }
  }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(join(out, 'project.json'), JSON.stringify(project))
})
