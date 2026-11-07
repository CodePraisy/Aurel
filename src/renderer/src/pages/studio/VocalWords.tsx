import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { PPQ } from '@shared/types'
import { player } from '@/audio/player'
import { measureCount, tempoMap } from '@/music/score'
import { measureTicks } from '@/music/theory'
import { recordingRate } from '@shared/rhythm'
import { useProject } from '@/store/project'
import { cx, fmtTime } from '@/components/ui'

export default function VocalWords({ project, expanded }: { project: Project; expanded: boolean }) {
  const [editing, setEditing] = useState(false)
  const [tick, setTick] = useState(0)
  const part = project.score.parts.find((part) => part.kind === 'singer' &&
    (!project.view?.part || project.view.part === 'all' || project.view.part === part.id))
  useEffect(() => {
    if (!part) return
    const timer = setInterval(() => setTick(player.getTick()), 100)
    return () => clearInterval(timer)
  }, [part?.id])
  if (!part) return null
  const lyrics = part.lyrics
  const timing = tempoMap(project.score)
  const mt = measureTicks(project.score.timeSig)
  const barCount = Math.max(1, measureCount(project.score))
  const rowTicks = mt * 4
  const toTick = (seconds: number) => timing.secToTick((seconds - (project.audio?.offset ?? 0)) / recordingRate(project, 1))
  const editWord = (index: number, text: string) => useProject.getState().patchProject((project) => {
    const target = project.score.parts.find((p) => p.id === part.id)?.lyrics
    if (!target) return
    target.words[index].text = text
    target.text = target.words.map((word) => word.text).join(' ')
  })
  return (
    <div className={cx('border-t border-line bg-panel/60 px-4 py-3 overflow-auto', expanded ? 'flex-1 min-h-0' : 'max-h-64 shrink-0')}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div><div className="font-display text-lg">Singer · lyric timeline</div>
          <p className="text-[11px] text-muted">Click words to seek. Bar lines and beat marks follow the score. Recognized words may need correction.</p></div>
        <button className="btn-soft !h-7" disabled={!lyrics?.words.length} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit words'}</button>
      </div>
      {lyrics?.error && <p className="text-bad text-[12px] mb-3">Words could not be recognized. Re-transcribe to retry. {lyrics.error}</p>}
      {!lyrics?.words.length && <p className="text-[12px] text-muted mb-3">{lyrics ? 'No words were recognized.' : 'Re-transcribe this recording to recognize the singer’s words.'}</p>}
      {editing ? <div className="flex flex-wrap gap-2">{lyrics?.words.map((word, index) =>
        <label key={index} className="text-[10px] text-muted">{fmtTime(word.start)}
          <input aria-label={`Word ${index + 1}`} className="field !h-7 !w-28 block" value={word.text} onChange={(e) => editWord(index, e.target.value)} />
        </label>)}</div> :
        Array.from({ length: Math.ceil(barCount / 4) }, (_, row) => {
          const start = row * rowTicks
          const end = Math.min((row + 1) * rowTicks, barCount * mt)
          const rowWords = (lyrics?.words ?? []).filter((word) => toTick(word.end) > start && toTick(word.start) < end)
          const beats = (end - start) / (PPQ * 4 / project.score.timeSig.den)
          return <div key={row} className="relative h-28 mb-3 rounded-lg border border-line overflow-hidden">
            {Array.from({ length: Math.ceil(beats) }, (_, beat) => <div key={beat} className={cx('absolute inset-y-0 border-l', beat % project.score.timeSig.num ? 'border-line/40' : 'border-accent/40')} style={{ left: `${beat / beats * 100}%` }}>
              <span className="text-[10px] text-faint px-1">{beat % project.score.timeSig.num === 0 ? row * 4 + Math.floor(beat / project.score.timeSig.num) + 1 : ''}</span>
            </div>)}
            {rowWords.map((word, index) => {
              const left = Math.max(start, toTick(word.start))
              const right = Math.min(end, toTick(word.end))
              return <button key={index} className={cx('absolute top-8 h-10 text-left px-1 border rounded text-[12px] truncate', tick >= toTick(word.start) && tick < toTick(word.end) ? 'bg-accent/25 border-accent text-accent' : 'bg-raised border-line')}
                style={{ left: `${(left - start) / (end - start) * 100}%`, width: `${Math.max(0.3, (right - left) / (end - start) * 100)}%` }}
                title={`${word.text} · ${fmtTime(word.start)}`} onClick={() => player.seek(Math.max(0, toTick(word.start)))}>{toTick(word.start) < start ? '…' : word.text}</button>
            })}
            {tick >= start && tick < end && <div className="absolute inset-y-0 w-px bg-accent pointer-events-none" style={{ left: `${(tick - start) / (end - start) * 100}%` }} />}
          </div>
        })}
    </div>
  )
}
