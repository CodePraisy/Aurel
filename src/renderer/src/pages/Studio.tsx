import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Sparkles, ZoomIn, ZoomOut, PanelBottom, Loader2, Check, AlertTriangle, Star, RefreshCw } from 'lucide-react'
import { TRANSCRIPTION_SOURCES, type InstrumentKind, type Project, type TranscriptionSource } from '@shared/types'
import { applyRhythmEstimate, detectedBpm } from '@shared/rhythm'
import { useApp, pendingProcess } from '@/store/app'
import Rack from './studio/Rack'
import VocalWords from './studio/VocalWords'
import { useProject } from '@/store/project'
import { player } from '@/audio/player'
import { api } from '@/lib/api'
import { openContextMenu, Select } from '@/components/menu'
import { Artwork, cx, Modal, Progress, Popover, fmtTime } from '@/components/ui'
import { KEY_NAMES, measureTicks, INSTRUMENTS } from '@/music/theory'
import { rebar, measureCount, transposePart } from '@/music/score'
import ScoreView from './studio/ScoreView'
import PartsPanel, { familyIcon } from './studio/PartsPanel'
import Toolbar from './studio/Toolbar'
import Transport, { toggleLoop, usePlayer } from './studio/Transport'
import InstrumentPanel from './studio/Instruments'
import ExportDialog from './studio/ExportDialog'
import Waveform from './studio/Waveform'
import { useStudioKeys } from './studio/shortcuts'
import { ADDABLE } from './Dialogs'
import TimeSignaturePicker, { parseTimeSignature } from './studio/TimeSignaturePicker'
import { ArpeggioEditor, TransposeEditor } from './studio/ScoreEditDialogs'

function stored(key: string, def: number): number { try { const v = localStorage.getItem(key); return v ? +v : def } catch { return def } }
function store(key: string, v: number) { try { localStorage.setItem(key, String(v)) } catch { /* storage unavailable */ } }

type RhythmField = 'tempo' | 'meter'

function useDrag(initial: number, key: string, min: number, max: number, axis: 'x' | 'y', invert = false) {
  const [size, setSize] = useState(() => stored(key, initial))
  const start = (e: React.MouseEvent) => {
    e.preventDefault()
    const s0 = size
    const p0 = axis === 'x' ? e.clientX : e.clientY
    const move = (ev: MouseEvent) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - p0
      setSize(Math.max(min, Math.min(max, s0 + (invert ? -d : d))))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setSize((s) => { store(key, s); return s }) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return [size, start] as const
}

function useMidiInput(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !navigator.requestMIDIAccess) return
    let access: MIDIAccess | null = null
    let lastOn = 0
    const onMsg = (e: MIDIMessageEvent) => {
      const d = e.data
      if (!d || d.length < 3) return
      const cmd = d[0] & 0xf0
      if (cmd !== 0x90 || d[2] === 0) return
      const st = useProject.getState()
      const now = performance.now()
      const chord = now - lastOn < 60
      lastOn = now
      st.inputNote(d[1], { chord, velocity: d[2] })
    }
    navigator.requestMIDIAccess().then((a) => {
      access = a
      const bind = () => a.inputs.forEach((i) => { i.onmidimessage = onMsg })
      bind()
      a.onstatechange = bind
    }).catch(() => undefined)
    return () => { access?.inputs.forEach((i) => { i.onmidimessage = null }) }
  }, [enabled])
}

export default function Studio({ projectId }: { projectId: string }) {
  const { go, jobs, processProject, changeCover, projectRevision, library, refreshLibrary } = useApp()
  const { project, load, close, saving, setMetadata, setView, patchProject, edit, noteSelection, range, transposeSel } = useProject()
  const [err, setErr] = useState<string | null>(null)
  const [transcribeOpen, setTranscribeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [rhythmField, setRhythmField] = useState<RhythmField | null>(null)
  const [rollTarget, setRollTarget] = useState<{ partId: string; eventId: string } | null>(null)
  const [transposeTarget, setTransposeTarget] = useState<'score' | 'playback' | null>(null)
  const [showInst, setShowInst] = useState(() => stored('aurel.inst', 1) === 1)
  const [sideW, dragSide] = useDrag(256, 'aurel.side', 200, 420, 'x')
  const [instH, dragInst] = useDrag(200, 'aurel.instH', 110, 380, 'y', true)
  const firstRev = useRef(projectRevision[projectId] ?? 0)
  usePlayer()

  useEffect(() => {
    load(projectId).catch((e) => setErr((e as Error).message))
    return () => close()
  }, [projectId, load, close])

  // reload when the project changes outside the editor (AI processing finished)
  const rev = projectRevision[projectId] ?? 0
  useEffect(() => {
    if (rev === firstRev.current) return
    firstRev.current = rev
    let current = true
    void api.project.load(projectId).then((p) => {
      const editor = useProject.getState()
      if (!current || editor.project?.id !== projectId) return
      if (p.analysis?.status !== 'done') {
        const next = { ...editor.project, analysis: p.analysis }
        useProject.setState({ project: next })
        return
      }
      editor.replace({ ...p, score: { ...p.score, title: editor.project.score.title, composer: editor.project.score.composer } })
    })
    return () => { current = false }
  }, [rev, projectId])

  const onToggleLoop = useCallback(() => toggleLoop(), [])
  const rackOpen = useProject((x) => !!x.rackPart)
  useStudioKeys(!!project && !transcribeOpen && !exportOpen && !rackOpen && !rhythmField && !rollTarget && !transposeTarget, onToggleLoop)
  useMidiInput(!!project)

  if (err) return <div className="h-full flex flex-col items-center justify-center gap-3 text-muted"><AlertTriangle className="text-bad" />{err}<button className="btn-soft" onClick={() => go({ name: 'library' })}>Back to library</button></div>
  if (!project) return <div className="h-full flex items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>

  const p: Project = project
  const s = p.score
  const job = Object.values(jobs).find((j) => j.projectId === p.id && j.kind === 'process' && !j.done)
  const installJob = pendingProcess.has(p.id) ? Object.values(jobs).find((j) => j.kind === 'install' && !j.done) : undefined
  const status = p.analysis?.status ?? 'none'
  const entry = library.find((l) => l.id === p.id)
  const mode = p.view?.mode ?? 'both'
  const zoom = p.view?.zoom ?? 1
  const loop = player.opts.loopOn ? player.opts.loop : null
  const hasParts = s.parts.length > 0
  const singerView = s.parts.some((part) => part.kind === "singer") && (s.parts.every((part) => part.kind === "singer") || s.parts.find((part) => part.id === p.view?.part)?.kind === "singer")
  const editArpeggio = (partId: string, eventId: string) => setRollTarget({ partId, eventId })
  const rollChord = rollTarget && s.parts.find((part) => part.id === rollTarget.partId)?.measures
    .flatMap((m) => m.events).find((event) => event.id === rollTarget.eventId)

  const setTimeSig = (num: number, den: number) => {
    if (num === s.timeSig.num && den === s.timeSig.den) return
    const oldMt = measureTicks(s.timeSig)
    const newMt = measureTicks({ num, den })
    const count = Math.max(1, Math.ceil((measureCount(s) * oldMt) / newMt))
    edit((sc) => { for (const part of sc.parts) rebar(part, oldMt, newMt, count); sc.timeSig = { num, den } })
    const st = useProject.getState()
    if (st.cursor && st.project) {
      const at = st.cursor.measure * oldMt + st.cursor.tick
      const measure = Math.min(count - 1, Math.floor(at / newMt))
      const part = st.project.score.parts.find((x) => x.id === st.cursor!.partId)
      const event = part?.measures[measure]?.events.find((e) => e.start <= at % newMt && e.start + e.dur > at % newMt)
      if (part) st.select(part.id, measure, event?.id ?? null, event?.start ?? 0)
      st.setRange(null)
    }
  }
  const setTempo = (bpm: number, linkAudio: boolean) => {
    if (!Number.isFinite(bpm) || bpm <= 0) return
    const tempo = Math.max(20, Math.min(300, Math.round(bpm)))
    patchProject((next) => {
      if (next.audio) {
        next.audio.referenceTempo = detectedBpm(next) ?? next.audio.referenceTempo ?? next.score.tempo
        next.audio.tempoLinked = linkAudio
      }
      next.score.tempo = tempo
    }, tempo !== s.tempo)
  }
  const startTranscription = (sources?: TranscriptionSource[], hints?: Project["instrumentHints"]) => {
        patchProject((next) => { next.instrumentHints = hints })
        setTranscribeOpen(false)
        void processProject(p.id, sources)
      }
  const editOnRightClick = (field: RhythmField) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setRhythmField(field)
  }

  return (
    <div className="h-full flex flex-col">
      {/* top bar */}
      <header className="h-12 shrink-0 flex items-center gap-2 pl-3 pr-[150px] border-b border-line drag">
        <button className="no-drag shrink-0" aria-label="Change cover photo" title="Change cover photo"
          onClick={() => void changeCover(p.id)}
          onContextMenu={(event) => openContextMenu(event, [{ label: 'Change cover photo…', onClick: () => void changeCover(p.id) }])}>
          <Artwork id={p.id} artwork={entry?.artwork ?? null} title={s.title} size={30} />
        </button>
        <Popover width={330} trigger={(t) => (
          <button className="no-drag text-left min-w-0 max-w-[340px] px-1.5 py-0.5 rounded-md hover:bg-fg/[0.05]" onClick={t}>
            <div className="text-[13.5px] font-medium truncate leading-tight">{s.title}</div>
            <div className="text-[11.5px] text-muted truncate leading-tight">{s.composer || (p.kind === 'composition' ? 'Original composition' : 'Unknown artist')} · <span onContextMenu={editOnRightClick('tempo')}>{s.tempo} BPM</span> · {KEY_NAMES[s.keyFifths + 7]} · <span onContextMenu={editOnRightClick('meter')}>{s.timeSig.num}/{s.timeSig.den}</span></div>
          </button>
        )}>
          {(closeDetails) => (
            <div className="p-2 space-y-2.5 no-drag">
              <label className="block"><div className="label mb-1">Title</div><input className="field !h-8" value={s.title} onChange={(e) => setMetadata({ title: e.target.value })} onBlur={() => { if (!s.title.trim()) setMetadata({ title: 'Untitled' }); void useProject.getState().save().then(refreshLibrary).catch(() => undefined) }} /></label>
              <label className="block"><div className="label mb-1">{p.kind === 'composition' ? 'Composer' : 'Artist'}</div><input className="field !h-8" value={s.composer} onChange={(e) => setMetadata({ composer: e.target.value })} onBlur={() => void useProject.getState().save().then(refreshLibrary).catch(() => undefined)} /></label>
              <div className="grid grid-cols-3 gap-2">
                <div><div className="label mb-1">Tempo</div><button className="field !h-8 text-left" onClick={() => { closeDetails(); setRhythmField('tempo') }}>{s.tempo} BPM</button></div>
                <label><div className="label mb-1">Key</div>
                  <Select value={s.keyFifths} onChange={(v) => edit((sc) => { sc.keyFifths = v })} options={KEY_NAMES.map((k, i) => ({ value: i - 7, label: k }))} />
                </label>
                <div><div className="label mb-1">Time</div>
                  <button className="field !h-8 text-left" title="Edit time signature" onClick={() => { closeDetails(); setRhythmField('meter') }}>{s.timeSig.num}/{s.timeSig.den}</button>
                </div>
              </div>
              {p.audio && (
                <div>
                  <div className="label mb-1">Align notation to recording</div>
                  <div className="flex items-center gap-1.5">
                    {[-0.05, -0.01].map((d) => <button key={d} className="btn-soft !h-7 !px-2" onClick={() => patchProject((pp) => { pp.audio!.offset = Math.max(0, +(pp.audio!.offset + d).toFixed(3)) })}>{d * 1000}ms</button>)}
                    <span className="flex-1 text-center text-[12px] tabular-nums">{(p.audio.offset * 1000).toFixed(0)} ms</span>
                    {[0.01, 0.05].map((d) => <button key={d} className="btn-soft !h-7 !px-2" onClick={() => patchProject((pp) => { pp.audio!.offset = +(pp.audio!.offset + d).toFixed(3) })}>+{d * 1000}ms</button>)}
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    <button className="btn-ghost !h-7 !px-2 flex-1" title="Shift by one beat" onClick={() => patchProject((pp) => { pp.audio!.offset = Math.max(0, pp.audio!.offset - 60 / s.tempo) })}>− 1 beat</button>
                    <button className="btn-ghost !h-7 !px-2 flex-1" onClick={() => patchProject((pp) => { pp.audio!.offset = pp.audio!.offset + 60 / s.tempo })}>+ 1 beat</button>
                  </div>
                  {p.analysis?.detectedKey && <p className="text-[11px] text-faint mt-2">Detected: {detectedBpm(p)} BPM, {p.analysis.detectedKey}{p.analysis.device ? ` · processed on ${p.analysis.device.toUpperCase()}` : ''}</p>}
                </div>
              )}
            </div>
          )}
        </Popover>
        <button className={cx('icon-btn no-drag', entry?.favorite && 'text-accent')} title="Favorite" onClick={async () => { await api.library.setFavorite(p.id, !entry?.favorite); void refreshLibrary() }}><Star size={15} fill={entry?.favorite ? 'currentColor' : 'none'} /></button>
        <span className="text-[11px] text-faint no-drag ml-1 flex items-center gap-1">{saving ? <><Loader2 size={11} className="animate-spin" /> Saving</> : <><Check size={11} /> Saved</>}</span>
        <div className="flex-1" />
        {hasParts && (
          <div className="flex items-center gap-1.5 no-drag">
            <div className="seg">
              {(['staff', 'tab', 'both'] as const).map((m) => <button key={m} className={cx(mode === m && 'on')} onClick={() => setView({ mode: m })}>{m === 'staff' ? 'Sheet' : m === 'tab' ? 'Tab' : 'Both'}</button>)}
            </div>
            <button className="icon-btn" title="Zoom out (Ctrl −)" onClick={() => setView({ zoom: Math.max(0.5, +(zoom - 0.1).toFixed(2)) })}><ZoomOut size={16} /></button>
            <span className="text-[11.5px] text-muted w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" title="Zoom in (Ctrl +)" onClick={() => setView({ zoom: Math.min(2, +(zoom + 0.1).toFixed(2)) })}><ZoomIn size={16} /></button>
            <button className={cx('icon-btn', showInst && 'on')} title="Fretboard / keyboard" onClick={() => { setShowInst(!showInst); store('aurel.inst', showInst ? 0 : 1) }}><PanelBottom size={16} /></button>
          </div>
        )}
        {p.audio && !job && !installJob && hasParts && (
          <button className={cx('no-drag', status === 'done' ? 'btn-soft' : 'btn-primary pulse')} onClick={() => setTranscribeOpen(true)} title="Separate instruments and transcribe">
            <Sparkles size={15} className={status === 'done' ? 'text-accent' : ''} /> {status === 'done' ? 'Re-transcribe' : 'Transcribe'}
          </button>
        )}
        <button className="btn-primary no-drag" onClick={() => setExportOpen(true)}><Download size={15} /> Export</button>
      </header>

      {(job || installJob) && (
        <div className="shrink-0 px-5 py-2.5 border-b border-line bg-accent/[0.05] flex items-center gap-4">
          <Sparkles size={16} className="text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{installJob && !job ? `Installing AI engine · ${installJob.stage}` : job?.stage ?? 'Processing…'} <span className="text-muted font-normal">{(job ?? installJob)?.message}</span></span>
              {((job ?? installJob)?.pct ?? -1) >= 0 && <span className="ml-auto shrink-0 tabular-nums text-accent" aria-label="Progress">{Math.floor(((job ?? installJob)!.pct) * 100)}%</span>}
            </div>
            <Progress pct={(job ?? installJob)?.pct ?? -1} className="mt-1.5" />
          </div>
          <button className="btn-ghost" onClick={() => api.jobs.cancel((job ?? installJob)!.jobId)}>Cancel</button>
        </div>
      )}
      {status === 'failed' && !job && (
        <div className="shrink-0 px-5 py-2 border-b border-line bg-bad/[0.06] text-[12.5px] flex items-center gap-2"><AlertTriangle size={14} className="text-bad" /> Transcription failed: {p.analysis?.error?.split('\n')[0]}</div>
      )}
      {player.fxError && <div role="alert" className="shrink-0 px-5 py-2 border-b border-line text-[12.5px] text-bad">Playback could not start: {player.fxError}</div>}

      <div className="flex-1 min-h-0 flex">
        <aside className="shrink-0 min-h-0 overflow-hidden border-r border-line bg-panel/40" style={{ width: sideW }}>
          <PartsPanel project={p} />
        </aside>
        <div className="w-1 -ml-0.5 cursor-col-resize hover:bg-accent/40 z-10" onMouseDown={dragSide} />
        <section className="flex-1 min-w-0 flex flex-col">
          {hasParts && !singerView ? (
            <>
              <Toolbar project={p} onEditArpeggio={editArpeggio} onTranspose={() => setTransposeTarget('score')} />
              <div className="flex-1 min-h-0"><ScoreView project={p} loop={loop} onEditArpeggio={editArpeggio} /></div>
              {showInst && (
                <>
                  <div className="h-1 -mb-0.5 cursor-row-resize hover:bg-accent/40 z-10" onMouseDown={dragInst} />
                  <div className="shrink-0 border-t border-line bg-panel/40" style={{ height: instH }}><InstrumentPanel project={p} /></div>
                </>
              )}
            </>
          ) : !hasParts ? (
            <EmptyStudio project={p} running={!!job || !!installJob} onTranscribe={startTranscription} onEditRhythm={setRhythmField} />
          ) : null}
          {hasParts && <VocalWords project={p} expanded={singerView} />}
          {hasParts && p.audio && <div className="shrink-0 border-t border-line px-4 py-1 bg-panel/30"><Waveform project={p} height={34} /></div>}
        </section>
      </div>
      <Transport project={p} onEditRhythm={setRhythmField} onTranspose={() => setTransposeTarget('playback')} />
      {rhythmField && <RhythmEditor field={rhythmField} project={p} onClose={() => setRhythmField(null)} setTempo={setTempo} setTimeSig={setTimeSig} />}
      {rollTarget && rollChord && <ArpeggioEditor current={rollChord.arpeggio} bpm={p.score.tempo} onClose={() => setRollTarget(null)} onApply={(roll) => {
        edit((score) => {
          const part = score.parts.find((x) => x.id === rollTarget.partId)
          const chord = part?.measures.flatMap((m) => m.events).find((event) => event.id === rollTarget.eventId)
          if (chord) chord.arpeggio = roll
        })
        setRollTarget(null)
      }} />}
      {transposeTarget && <TransposeEditor playback={transposeTarget === 'playback'} current={transposeTarget === 'playback' ? player.opts.transpose : 0} hasSelection={transposeTarget === 'score' && !!(noteSelection || range)} onClose={() => setTransposeTarget(null)} onApply={(semitones, selection) => {
        if (transposeTarget === 'playback') player.setOptions({ transpose: semitones })
        else if (semitones && selection) transposeSel(semitones)
        else if (semitones) edit((score) => {
          for (const part of score.parts) transposePart(part, semitones)
          if (semitones % 12) score.keyFifths = ((score.keyFifths + 7 * semitones + 6) % 12 + 12) % 12 - 6
        })
        setTransposeTarget(null)
      }} />}
      {transcribeOpen && <TranscriptionDialog onClose={() => setTranscribeOpen(false)} onStart={startTranscription} />}
      <ExportDialog project={p} open={exportOpen} onClose={() => setExportOpen(false)} />
      <Rack />
    </div>
  )
}

function RhythmEditor({ field, project, onClose, setTempo, setTimeSig }: {
  field: RhythmField; project: Project; onClose: () => void; setTempo: (bpm: number, linkAudio: boolean) => void; setTimeSig: (num: number, den: number) => void
}) {
  const [bpm, setBpm] = useState(String(Math.round(project.score.tempo)))
  const [linkAudio, setLinkAudio] = useState(project.audio?.tempoLinked ?? false)
  const detected = detectedBpm(project)
  const [meter, setMeter] = useState(`${project.score.timeSig.num}/${project.score.timeSig.den}`)
  const tempo = field === 'tempo'
  const timeSig = parseTimeSignature(meter)
  return (
    <Modal open onClose={onClose} title={tempo ? 'Change tempo' : 'Change time signature'} width={330}>
      <form onSubmit={(e) => {
        e.preventDefault()
        if (tempo) setTempo(Number(bpm), linkAudio)
        else if (timeSig) setTimeSig(timeSig.num, timeSig.den)
        onClose()
      }}>
        {tempo ? (
          <div className="space-y-3">
            <label className="block"><div className="label mb-1.5">Score tempo (BPM)</div><input type="number" className="field" min={20} max={300} step={1} value={bpm} onChange={(e) => setBpm(e.target.value)} autoFocus onFocus={(e) => e.target.select()} required /></label>
            <TapTempo onTempo={(t) => setBpm(String(t))} />
            {detected !== undefined && <button type="button" className="btn-soft" onClick={() => setBpm(String(detected))}>Use detected BPM ({detected})</button>}
            {project.audio && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={linkAudio} onChange={(e) => setLinkAudio(e.target.checked)} /> Change recording speed with BPM</label>}
          </div>
        ) : (
          <div><div className="label mb-1.5">Beats per measure / note value</div><TimeSignaturePicker value={meter} onChange={setMeter} /></div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!tempo && !timeSig}>Apply</button>
        </div>
      </form>
    </Modal>
  )
}

function TranscriptionDialog({ onClose, onStart, embedded = false }: { embedded?: boolean; onClose: () => void; onStart: (sources?: TranscriptionSource[], hints?: Project["instrumentHints"]) => void }) {
  const [auto, setAuto] = useState(true)
  const [selected, setSelected] = useState<TranscriptionSource[]>([])
  const [hints, setHints] = useState<NonNullable<Project["instrumentHints"]>>({})
  const choices: Partial<Record<TranscriptionSource, InstrumentKind[]>> = { guitar: ["acoustic-guitar", "clean-guitar", "distorted-guitar"], piano: ["piano", "epiano", "organ"], other: ["strings", "brass", "woodwinds", "synth"] }
  const labels = { vocals: 'Singer / vocals', drums: 'Drums', bass: 'Bass', guitar: 'Guitar', piano: 'Piano / keys', other: 'Other instruments' }
  const content = (<>
      <div className="seg w-fit mb-3" role="group" aria-label="Instrument detection">
        <button aria-pressed={auto} className={cx(auto && 'on')} onClick={() => { setAuto(true); setSelected([]); setHints({}) }}>Detect automatically</button>
        <button aria-pressed={!auto} className={cx(!auto && 'on')} onClick={() => setAuto(false)}>Choose instruments</button>
      </div>
      {auto && <p className="text-sm text-muted">Aurel finds the instruments in the recording and transcribes the audible tracks.</p>}
      {
        <div className="grid grid-cols-2 gap-3">
          {TRANSCRIPTION_SOURCES.map((source) => <button key={source} className={cx("btn-soft !h-10", selected.includes(source) && "!bg-accent/20 !text-accent")} aria-pressed={selected.includes(source)} onClick={() => { setAuto(false); setSelected((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]) }}>{labels[source]}</button>)}
          {selected.filter((source) => choices[source]).map((source) => <div key={source} className="col-span-2"><div className="label mb-1">{labels[source]} sound</div><Select value={hints[source] ?? ""} onChange={(kind) => setHints({ ...hints, [source]: kind || undefined })} options={[{ value: "", label: "Let the model decide" }, ...choices[source]!.map((kind) => ({ value: kind, label: INSTRUMENTS[kind].label }))]} /></div>)}
        </div>}
    <div className="flex justify-end mt-4">      <button className="btn-primary" disabled={!auto && !selected.length} onClick={() => onStart(auto ? undefined : selected, auto ? undefined : hints)}>Start transcription</button></div>
  </>)
  return embedded ? <div className="space-y-3">{content}</div> : <Modal open title="Transcribe recording" onClose={onClose} width={460}>{content}</Modal>
}

function EmptyStudio({ project, running, onTranscribe, onEditRhythm }: { project: Project; running: boolean; onTranscribe: (sources?: TranscriptionSource[], hints?: Project["instrumentHints"]) => void; onEditRhythm: (field: RhythmField) => void }) {
  const { engine, toast } = useApp()
  const st = useProject()
  const [checkingRhythm, setCheckingRhythm] = useState(false)
  const rhythm = project.analysis?.rhythm
  const recheckRhythm = async () => {
    setCheckingRhythm(true)
    try {
      const estimate = await api.media.analyzeRhythm(project.id)
      if (useProject.getState().project === project) st.patchProject((p) => applyRhythmEstimate(p, estimate))
    } catch {
      toast('Could not read the recording to recheck its tempo.', 'error')
    } finally {
      setCheckingRhythm(false)
    }
  }
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[900px] mx-auto px-8 py-8">
        {project.audio && !running && (
          <div className="relative overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.16] via-accent/[0.06] to-transparent p-7 mb-6 animate-fadein">
            <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent/10 blur-2xl" />
            <div className="label !text-accent mb-2">Next step</div>
            <div className="font-display text-[30px] leading-tight mb-2">Turn this recording into sheet music & tabs</div>
            <p className="text-muted max-w-[560px] leading-relaxed mb-5">Aurel separates every instrument, then writes editable notation for each one. It runs on your computer{engine?.cuda ? ` using your ${engine.gpuName ?? 'GPU'}` : ''}; a typical song takes {engine?.cuda ? '1–2' : '3–8'} minutes.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <button className="chip !h-7 hover:text-fg" title="Edit score tempo" onClick={() => onEditRhythm('tempo')} onContextMenu={(e) => { e.preventDefault(); onEditRhythm('tempo') }}>{rhythm ? `${Math.round(rhythm.bpm)} BPM estimated` : rhythm === null ? 'Tempo unclear' : 'Tempo not verified'}</button>
              <button className="chip !h-7 hover:text-fg" title="Edit time signature" onClick={() => onEditRhythm('meter')} onContextMenu={(e) => { e.preventDefault(); onEditRhythm('meter') }}>{rhythm?.timeSig ? `${rhythm.timeSig.num}/${rhythm.timeSig.den} estimated` : rhythm === undefined ? 'Meter not verified' : 'Meter unclear'}</button>
              <button className="btn-soft !h-7" disabled={checkingRhythm} onClick={() => void recheckRhythm()}><RefreshCw size={13} className={checkingRhythm ? 'animate-spin' : ''} /> {checkingRhythm ? 'Checking…' : 'Recheck tempo & meter'}</button>
              {!engine?.ready && <span className="text-[12px] text-faint">First run downloads the AI engine (~3–5 GB) automatically.</span>}
            </div>
            <div className="mt-5 relative"><TranscriptionDialog embedded onClose={() => undefined} onStart={onTranscribe} /></div>
          </div>
        )}
        {project.audio && (
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="label">Original recording · {fmtTime(project.audio.duration)}</div>
              <button className="btn-soft !h-7" onClick={() => player.toggle()}>{player.state === 'playing' ? 'Pause' : 'Play'}</button>
            </div>
            <Waveform project={project} height={110} />
          </div>
        )}
        {running ? (
          <div className="text-center text-muted py-8">Working on it. You can keep using Aurel while this runs.</div>
        ) : (
          <div className="card p-6">
            <div className="font-display text-[19px] mb-1">{project.audio ? 'Or write along yourself' : 'Add an instrument'}</div>
            <p className="text-muted text-[13px] leading-relaxed mb-4">{project.audio ? 'Add a part and notate it while the recording plays.' : 'Pick an instrument to start writing. You can also right-click the score later.'}</p>
            <div className="flex flex-wrap gap-1.5">
              {ADDABLE.map((k) => <button key={k} className="chip !h-7 hover:text-fg" onClick={() => st.addPart(k)}>{familyIcon(k, 13)} {INSTRUMENTS[k].label}</button>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Tap along to the beat; the tempo is the average of the last taps. A pause of 2 s starts over. */
export function TapTempo({ onTempo }: { onTempo: (bpm: number) => void }) {
  const taps = useRef<number[]>([])
  const [count, setCount] = useState(0)
  const [bpm, setBpm] = useState<number | null>(null)
  const [pulse, setPulse] = useState(0)
  const tap = () => {
    const now = performance.now()
    const list = taps.current
    if (list.length && now - list[list.length - 1] > 2000) list.length = 0
    list.push(now)
    if (list.length > 8) list.shift()
    setCount(list.length)
    setPulse((p) => p + 1)
    if (list.length >= 2) {
      const gaps = list.slice(1).map((t, i) => t - list[i])
      const value = Math.max(20, Math.min(300, Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length))))
      setBpm(value)
      onTempo(value)
    }
  }
  return (
    <div className="flex items-center gap-3">
      <button type="button" className="btn-soft !h-10 flex-1 relative overflow-hidden" aria-label="Tap tempo"
        onMouseDown={(e) => { e.preventDefault(); tap() }}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 't') { e.preventDefault(); tap() } }}>
        {pulse > 0 && <span key={pulse} className="absolute inset-0 bg-accent/25 animate-overlay [animation-direction:reverse]" />}
        <span className="relative">Tap tempo</span>
      </button>
      <span className="w-24 text-[12px] text-muted tabular-nums">{bpm ? `${bpm} BPM` : count ? 'keep tapping…' : 'tap the beat'}</span>
    </div>
  )
}
