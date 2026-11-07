import { useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { api } from '@/lib/api'
import { renderScore } from '@/notation/render'

/** Hidden window used by the main process to engrave PDFs. Always light, paper-like. */
export default function PrintView() {
  const ref = useRef<HTMLDivElement>(null)
  const [msg, setMsg] = useState('Preparing…')
  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.body.style.overflow = 'visible'
    document.body.style.background = '#fff'
    ;(async () => {
      const params = await api.print.params()
      if (!params) { setMsg('Nothing to print'); return }
      const p: Project = await api.project.load(params.projectId)
      const selected = p.score.parts.filter((x) => !params.partIds || params.partIds.includes(x.id))
      const parts = selected.filter((part) => part.kind !== "singer")
      const score = { ...p.score, parts: parts.map((x) => ({ ...x, measures: x.measures.slice(params.from ?? 0, (params.to ?? x.measures.length - 1) + 1) })) }
      await document.fonts.ready
      const el = ref.current!
      renderScore(el, score, { parts: score.parts, mode: params.mode as 'staff' | 'tab' | 'both', width: 760, zoom: Math.max(0.5, Math.min(1.4, params.scale ?? 1)), spacing: Math.max(0.7, Math.min(1.5, params.spacing ?? 1)), header: true, split: true, colors: { ink: '#111', paper: '#fff', staff: '#555', faint: '#666', accent: '#000' } })
      for (const part of selected.filter((part) => part.kind === "singer")) {
        const title = document.createElement("h2")
        title.textContent = part.name + " · lyrics"
        el.appendChild(title)
        for (const word of part.lyrics?.words ?? []) {
          const beat = (word.start - (p.audio?.offset ?? 0)) * p.score.tempo / 60
          const measure = Math.floor(beat / (p.score.timeSig.num * 4 / p.score.timeSig.den))
          if (measure < (params.from ?? 0) || measure > (params.to ?? Infinity)) continue
          const item = document.createElement("span")
          item.textContent = word.text + " "
          item.title = "Time " + word.start.toFixed(2)
          el.appendChild(item)
        }
      }
      setMsg("")
      requestAnimationFrame(() => api.print.ready())
    })()
  }, [])
  return (
    <div style={{ background: '#fff', color: '#111', padding: '0 0 0 0', width: 760, margin: '0 auto' }}>
      {msg && <div>{msg}</div>}
      <div ref={ref} className="score-sheet" />
    </div>
  )
}
