import { useEffect, useRef, useState } from 'react'
import { Plus, X, Youtube, AlertTriangle, Loader2, Upload } from 'lucide-react'
import type { InstrumentKind, YouTubeCheck } from '@shared/types'
import { useApp } from '@/store/app'
import { parseYouTubeId } from '@shared/youtube'
import { api } from '@/lib/api'
import { Select } from '@/components/menu'
import { Modal, cx, fmtTime, Popover, MenuItem } from '@/components/ui'
import { INSTRUMENTS, KEY_NAMES } from '@/music/theory'
import { newScore, newProject } from '@/music/score'
import TimeSignaturePicker, { parseTimeSignature } from './studio/TimeSignaturePicker'

const TEMPLATES: { name: string; parts: InstrumentKind[] }[] = [
  { name: 'Blank', parts: [] },
  { name: 'Solo Piano', parts: ['piano'] },
  { name: 'Rock Band', parts: ['distorted-guitar', 'clean-guitar', 'bass', 'drums'] },
  { name: 'Singer-Songwriter', parts: ['acoustic-guitar'] },
  { name: 'Jazz Trio', parts: ['piano', 'bass', 'drums'] },
  { name: 'Lead Sheet', parts: ['piano'] },
  { name: 'Strings', parts: ['strings', 'strings', 'strings', 'strings'] }
]
export const ADDABLE: InstrumentKind[] = ['piano', 'epiano', 'organ', 'synth', 'acoustic-guitar', 'clean-guitar', 'distorted-guitar', 'bass', 'drums', 'strings', 'brass', 'woodwinds']

export function NewCompositionDialog() {
  const { dialog, setDialog, refreshLibrary, go } = useApp()
  const [title, setTitle] = useState('Untitled')
  const [composer, setComposer] = useState('')
  const [tempo, setTempo] = useState(100)
  const [key, setKey] = useState(0)
  const [ts, setTs] = useState('4/4')
  const [measures, setMeasures] = useState(16)
  const [parts, setParts] = useState<InstrumentKind[]>(['piano'])
  const [tpl, setTpl] = useState('Solo Piano')
  const close = () => setDialog(null)

  const create = async () => {
    const timeSig = parseTimeSignature(ts)
    if (!timeSig) return
    const { num, den } = timeSig
    const score = newScore({ title: title.trim() || 'Untitled', composer, tempo, num, den, keyFifths: key, instruments: parts.length ? parts : ['piano'], measures, pianoGrandStaff: useApp.getState().settings?.pianoGrandStaff })
    if (tpl === 'Strings') ['Violin I', 'Violin II', 'Viola', 'Cello'].forEach((n, i) => { if (score.parts[i]) { score.parts[i].name = n; if (i === 3) score.parts[i].clef = 'bass' } })
    const p = newProject(score, 'composition')
    p.view = { ...p.view!, mode: useApp.getState().settings?.defaultView ?? 'both' }
    await api.project.create(p)
    await refreshLibrary()
    close()
    go({ name: 'studio', projectId: p.id })
  }

  return (
    <Modal open={dialog === 'new'} onClose={close} title="New composition" width={600} footer={<><button className="btn-ghost" onClick={close}>Cancel</button><button className="btn-primary" disabled={!parseTimeSignature(ts)} onClick={create}>Create score</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1"><div className="label mb-1.5">Title</div><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus onFocus={(e) => e.target.select()} /></label>
        <label><div className="label mb-1.5">Composer</div><input className="field" value={composer} placeholder="Optional" onChange={(e) => setComposer(e.target.value)} /></label>
        <div><div className="label mb-1.5">Tempo (BPM)</div><div className="flex gap-1.5"><input className="field" type="number" min={20} max={300} value={tempo} onChange={(e) => setTempo(Math.max(20, Math.min(300, +e.target.value || 100)))} /><TapButton onTempo={setTempo} /></div></div>
        <label><div className="label mb-1.5">Measures</div><input className="field" type="number" min={1} max={999} value={measures} onChange={(e) => setMeasures(Math.max(1, Math.min(999, +e.target.value || 16)))} /></label>
        <label><div className="label mb-1.5">Key signature</div>
          <Select value={key} onChange={setKey} options={KEY_NAMES.map((k, i) => ({ value: i - 7, label: `${k} major`, hint: i - 7 !== 0 ? `${Math.abs(i - 7)}${i - 7 > 0 ? '♯' : '♭'}` : '' }))} />
        </label>
        <div><div className="label mb-1.5">Time signature</div><TimeSignaturePicker value={ts} onChange={setTs} /></div>
      </div>
      <div className="label mt-5 mb-2">Template</div>
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATES.map((t) => <button key={t.name} className={cx('chip !h-7 !px-2.5 hover:text-fg', tpl === t.name && '!bg-accent/15 !text-accent')} onClick={() => { setTpl(t.name); setParts(t.parts) }}>{t.name}</button>)}
      </div>
      <div className="label mt-5 mb-2">Instruments</div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {parts.map((k, i) => (
          <span key={i} className="chip !h-7 !pl-2.5 !pr-1 !text-fg">{INSTRUMENTS[k].label}<button className="icon-btn !h-5 !w-5" aria-label={`Remove ${INSTRUMENTS[k].label}`} title={`Remove ${INSTRUMENTS[k].label}`} onClick={() => setParts(parts.filter((_, j) => j !== i))}><X size={12} /></button></span>
        ))}
        <Popover width={220} trigger={(t) => <button className="btn-soft !h-7" onClick={t}><Plus size={14} /> Add</button>}>
          {(close2) => ADDABLE.map((k) => <MenuItem key={k} onClick={() => { setParts([...parts, k]); setTpl(''); close2() }}>{INSTRUMENTS[k].label}</MenuItem>)}
        </Popover>
      </div>
      {parts.length === 0 && <p className="text-faint text-[12px] mt-2">A piano part will be added so you have somewhere to start.</p>}
    </Modal>
  )
}

export function YouTubeDialog() {
  const { dialog, setDialog, track, importFile, settings, updateSettings } = useApp()
  const [url, setUrl] = useState('')
  const [checking, setChecking] = useState(false)
  const [res, setRes] = useState<YouTubeCheck | null>(null)
  const close = () => { setDialog(null); setRes(null); setUrl('') }
  const needsTerms = !settings?.termsAccepted
  const request = useRef(0)
  const importing = useRef(false)
  const [importBusy, setImportBusy] = useState(false)
  const [checkedUrl, setCheckedUrl] = useState("")

  const check = async () => {
    const input = url.trim(), token = ++request.current
    setChecking(true)
    setRes(null)
    try {
      const result = await api.youtube.check(input)
      if (token === request.current) { setRes(result); setCheckedUrl(input) }
    } catch (error) { if (token === request.current) useApp.getState().toast((error as Error).message, "error") }
    finally { if (token === request.current) setChecking(false) }
  }
  useEffect(() => {
    request.current++
    setRes(null)
    setCheckedUrl("")
    setChecking(false)
    if (dialog !== "youtube" || !parseYouTubeId(url)) return
    const timer = setTimeout(() => void check(), 400)
    return () => { clearTimeout(timer); request.current++ }
  }, [url, dialog])
  const acquire = async () => {
    if (importing.current || checking || checkedUrl !== url.trim() || !res?.acquirable) return
    importing.current = true
    setImportBusy(true)
    try {
      if (needsTerms) await updateSettings({ termsAccepted: true })
      const { jobId } = await api.youtube.acquire(url.trim())
      track(jobId, res.meta?.title ?? "YouTube import")
      close()
    } catch (error) { useApp.getState().toast((error as Error).message, "error") }
    finally { importing.current = false; setImportBusy(false) }
  }
  const pickFile = async () => { const p = await api.media.pickAudio(); if (p) { void importFile(p); close() } }
  const valid = !!parseYouTubeId(url)

  return (
    <Modal open={dialog === 'youtube'} onClose={close} title={<span className="flex items-center gap-2"><Youtube size={20} className="text-accent" /> Import from YouTube</span>} width={580}
      footer={<>
        <button className="btn-ghost mr-auto" onClick={pickFile}><Upload size={14} /> Import a file instead</button>
        <button className="btn-ghost" onClick={close}>Cancel</button>
        {res?.duplicateOf
          ? <button className="btn-primary" onClick={() => { useApp.getState().go({ name: 'studio', projectId: res.duplicateOf! }); close() }}>Open existing</button>
          : <button className="btn-primary" disabled={!valid || checking || importBusy || checkedUrl !== url.trim() || !res?.acquirable} onClick={acquire}>{needsTerms ? 'Agree & import' : 'Download recording'}</button>}
      </>}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void check() }}>
        <input className="field" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => { setUrl(e.target.value); setRes(null) }} autoFocus />
        <button className="btn-soft !h-9" disabled={!url.trim() || checking}>{checking ? <Loader2 size={15} className="animate-spin" /> : 'Preview'}</button>
      </form>
      {res?.error && <div className="mt-3 text-bad text-[13px]">{res.error}</div>}
      {res?.meta && (
        <div className="mt-4 card p-3 flex gap-3 bg-raised/40">
          {res.meta.thumbnail && <img src={res.meta.thumbnail} className="w-[148px] h-[83px] object-cover rounded-lg" alt="" />}
          <div className="min-w-0 flex-1">
            <div className="font-medium leading-snug line-clamp-2">{res.meta.title}</div>
            <div className="text-muted text-[12.5px] mt-0.5">{res.meta.channel}{res.meta.duration ? ` · ${fmtTime(res.meta.duration)}` : ''}</div>
            {res.duplicateOf && <span className="chip !text-accent mt-2">Already in your library</span>}
          </div>
        </div>
      )}
      {res && res.reasons.length > 0 && (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn/[0.07] p-3 text-[12.5px] space-y-1.5">
          {res.reasons.map((r) => <div key={r} className="flex gap-2"><AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" /><span>{r}</span></div>)}
        </div>
      )}
      {needsTerms && (
        <p className="mt-3 text-faint text-[12px] leading-relaxed">
          By importing you agree to Aurel’s <button className="underline hover:text-fg" onClick={() => { close(); useApp.getState().go({ name: 'settings', section: 'legal' }) }}>Terms of Use</button>: you are responsible for what you download and how you use it, including compliance with copyright law and YouTube’s terms.
        </p>
      )}
    </Modal>
  )
}

export function UrlDialog() {
  const { dialog, setDialog, track } = useApp()
  const [url, setUrl] = useState('')
  const close = () => { setDialog(null); setUrl('') }
  const go = async () => { const { jobId } = await api.media.importUrl(url.trim()); track(jobId, url.split('/').pop() || 'Download'); close() }
  return (
    <Modal open={dialog === 'url'} onClose={close} title="Import audio from a URL" footer={<><button className="btn-ghost" onClick={close}>Cancel</button><button className="btn-primary" disabled={!/^https?:\/\//.test(url.trim())} onClick={go}>Download</button></>}>
      <input className="field" placeholder="https://example.com/song.mp3" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
      <p className="mt-2 text-faint text-[12px]">A direct link to an audio or video file. For YouTube pages, use “YouTube Link”.</p>
    </Modal>
  )
}

/** Small tap-tempo button: tap the beat a few times. */
function TapButton({ onTempo }: { onTempo: (bpm: number) => void }) {
  const taps = useRef<number[]>([])
  return (
    <button type="button" className="btn-soft !h-9 shrink-0" title="Tap the beat to set the tempo" onMouseDown={(e) => {
      e.preventDefault()
      const now = performance.now(), list = taps.current
      if (list.length && now - list[list.length - 1] > 2000) list.length = 0
      list.push(now)
      if (list.length > 8) list.shift()
      if (list.length >= 2) onTempo(Math.max(20, Math.min(300, Math.round(60000 * (list.length - 1) / (list[list.length - 1] - list[0])))))
    }}>Tap</button>
  )
}
