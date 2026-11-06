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
      const parts = p.score.parts.filter((x) => !params.partIds || params.partIds.includes(x.id))
      const score = { ...p.score, parts: parts.map((x) => ({ ...x, measures: x.measures.slice(params.from ?? 0, (params.to ?? x.measures.length - 1) + 1) })) }
      await document.fonts.ready
      const el = ref.current!
      renderScore(el, score, { parts: score.parts, mode: params.mode as 'staff' | 'tab' | 'both', width: 760, zoom: 1, header: true, split: true, colors: { ink: '#111', paper: '#fff', staff: '#555', faint: '#666', accent: '#000' } })
      setMsg('')
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
