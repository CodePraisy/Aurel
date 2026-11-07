import { useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { api } from '@/lib/api'
import { player } from '@/audio/player'
import { tempoMap } from '@/music/score'
import { cx } from '@/components/ui'

export default function Waveform({ project, height = 120 }: { project: Project; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const played = useRef<HTMLDivElement>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const dur = project.audio?.duration ?? 0
  useEffect(() => { void api.media.peaks(project.id).then(setPeaks) }, [project.id, project.audio?.trimmed])

  useEffect(() => {
    const c = canvas.current
    if (!c || !peaks) return
    const draw = () => {
      const w = c.clientWidth, h = c.clientHeight
      const dpr = window.devicePixelRatio || 1
      c.width = w * dpr; c.height = h * dpr
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().split(/\s+/).join(',')
      g.fillStyle = `rgba(${col},0.75)`
      const n = peaks.length / 2
      for (let x = 0; x < w; x++) {
        const i = Math.floor((x / w) * n)
        const mn = peaks[i * 2], mx = peaks[i * 2 + 1]
        const y0 = h / 2 - mx * h * 0.46, y1 = h / 2 - mn * h * 0.46
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [peaks])

  useEffect(() => {
    let raf = 0
    const tm = tempoMap(project.score, 1)
    const f = () => {
      if (head.current && dur) {
        const sec = (project.audio?.offset ?? 0) + tm.tickToSec(Math.max(0, player.getTick())) * player.audioScale
        // never outside the strip (a count-in or an unloaded player can give a time before the start)
        const pct = Math.max(0, Math.min(100, (sec / dur) * 100))
        head.current.style.left = `${pct}%`
        if (played.current) played.current.style.width = `${pct}%`
      }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [project.score, project.audio, dur])

  const seek = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const sec = ((e.clientX - r.left) / r.width) * dur - (project.audio?.offset ?? 0)
    player.seek(Math.max(0, tempoMap(project.score, 1).secToTick(sec / player.audioScale)))
  }

  return (
    <div className="waveform relative w-full cursor-pointer overflow-hidden rounded-md" style={{ height }} onClick={seek}>
      <canvas ref={canvas} className="w-full h-full" />
      <div ref={played} className="waveform-played absolute inset-y-0 left-0 pointer-events-none" />
      {!peaks && <div className="absolute inset-0 flex items-center justify-center text-faint text-[12px]">Loading waveform…</div>}
      <div ref={head} className={cx('absolute top-0 bottom-0 -ml-px w-[2px] bg-fg shadow-[0_0_8px_rgb(var(--fg)/0.5)] transition-opacity', !peaks && 'opacity-0')} />
    </div>
  )
}
