import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { player } from '@/audio/player'
import { measureTicks } from '@/music/theory'
import { lyricLines, lyricTimestamp, lyricTiming, type LyricWord } from '@/music/lyrics'
import type { ScoreLayout } from '@/notation/render'
import { useProject } from '@/store/project'
import { useApp } from '@/store/app'
import { cx } from '@/components/ui'

export default function VocalWords({ project, layout }: { project: Project; layout?: ScoreLayout }) {
  const [editing, setEditing] = useState(false)
  const [tick, setTick] = useState(0)
  const activeLine = useRef<HTMLDivElement>(null)
  const follow = useApp((s) => s.settings?.autoScroll ?? true)
  const part = project.score.parts.find((p) => p.kind === 'singer')
  const timing = useMemo(() => lyricTiming(project), [project])
  const lines = useMemo(() => lyricLines(part?.lyrics?.words ?? []), [part?.lyrics])
  useEffect(() => {
    if (!part) return
    const timer = setInterval(() => setTick(player.getTick()), 50)
    return () => clearInterval(timer)
  }, [part?.id])
  const seconds = timing.toSeconds(tick)
  const currentLine = lines.findIndex((line, i) => seconds >= line[0].start && (i === lines.length - 1 || seconds < lines[i + 1][0].start))
  useEffect(() => {
    if (!layout && follow && player.state === 'playing') activeLine.current?.scrollIntoView({
      block: 'center', behavior: document.documentElement.dataset.motion === 'reduce' ? 'instant' : 'smooth'
    })
  }, [currentLine, follow, layout])
  if (!part) return null
  const lyrics = part.lyrics
  const wordButton = (word: LyricWord, index: number, large = false) => {
    const active = seconds >= word.start && seconds < word.end
    return <button key={index} data-lyric-start={word.start} aria-current={active ? 'true' : undefined}
      className={cx('inline-flex flex-col items-start text-left rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        large ? 'px-1.5 py-2 hover:bg-accent/10' : 'px-1.5 py-0.5 hover:bg-accent/10',
        active ? 'text-accent bg-accent/10' : seconds >= word.end ? (large ? 'text-fg' : 'text-ink') : (large ? 'text-muted' : 'text-ink/60'))}
      title={`Play from ${lyricTimestamp(word.start)}`} aria-label={`${word.text.trim()}, ${lyricTimestamp(word.start)}`}
      onClick={() => player.seek(Math.max(0, timing.toTick(word.start)))}>
      <span className={cx('break-words max-w-full', large ? 'text-[clamp(24px,3vw,44px)] font-semibold leading-tight' : 'text-[14px] leading-6')}>{word.text.trim()}</span>
      {large && <span className="text-[10px] leading-5 font-normal tabular-nums text-muted">{lyricTimestamp(word.start)}</span>}
    </button>
  }
  if (layout) {
    const mt = measureTicks(project.score.timeSig)
    return <div className="absolute inset-0 pointer-events-none" aria-label="Lyrics beneath the score">
      {layout.systems.map((system, index) => {
        const start = system.measures[0].index * mt
        const end = (system.measures.at(-1)!.index + 1) * mt
        const words = (lyrics?.words ?? []).filter((w) => timing.toTick(w.start) >= start && timing.toTick(w.start) < end)
        return words.length ? <div key={index} className="absolute pointer-events-auto flex flex-wrap content-start items-start"
          style={{ left: system.measures[0].x, top: system.bottom - 10,
            width: layout.width - system.measures[0].x - 14, zoom: layout.zoom }}>
          {words.map((word, wi) => wordButton(word, wi))}
        </div> : null
      })}
    </div>
  }
  return <div className="flex-1 min-h-0 overflow-auto bg-paper/50" aria-label="Lyrics view">
    <div className="max-w-4xl mx-auto px-8 py-8 sm:px-12">
      <div className="flex items-center justify-between gap-4 mb-10">
        <div><h2 className="font-display text-2xl">{project.score.title}</h2>
          <p className="text-sm text-muted mt-1">{project.score.composer ? `${project.score.composer} · ` : ''}{part.name} · Click a word to jump to it</p></div>
        <button className="btn-soft shrink-0" disabled={!lyrics?.words.length} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit words'}</button>
      </div>
      {lyrics?.error && <p className="text-bad text-sm mb-6">Words could not be recognized. Re-transcribe to retry.</p>}
      {!lyrics?.words.length && <p className="text-sm text-muted">{lyrics ? 'No words were recognized.' : 'Re-transcribe this recording to recognize the singer’s words.'}</p>}
      {editing ? <div className="flex flex-wrap gap-3">{lyrics?.words.map((word, index) =>
        <label key={index} className="text-[11px] text-muted tabular-nums">{lyricTimestamp(word.start)}
          <input aria-label={`Word ${index + 1}`} className="field !h-8 !w-32 block mt-1" value={word.text} onChange={(e) => {
            const text = e.target.value
            useProject.getState().patchProject((p) => {
              const target = p.score.parts.find((x) => x.id === part.id)?.lyrics
              if (!target) return
              target.words[index].text = text
              target.text = target.words.map((w) => w.text).join(' ')
            })
          }} />
        </label>)}</div> : <div className="pb-[35vh] space-y-7">{lines.map((line, index) =>
        <div key={index} ref={index === currentLine ? activeLine : undefined} data-lyric-line={index}
          className={cx('flex flex-wrap gap-x-1 scroll-my-24 transition-opacity', currentLine >= 0 && index !== currentLine && 'opacity-50')}>
          {line.map((word, wi) => wordButton(word, wi, true))}
        </div>)}</div>}
    </div>
  </div>
}
