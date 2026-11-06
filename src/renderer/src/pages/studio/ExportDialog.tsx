import { useState } from 'react'
import { Loader2, FolderDown, FileDown } from 'lucide-react'
import type { ExportAudioSettings, Project } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/store/app'
import { useProject } from '@/store/project'
import { Select } from '@/components/menu'
import { Modal, cx, Toggle } from '@/components/ui'
import { renderWav } from '@/audio/render'
import { scoreToMidi } from '@/music/midi'
import { scoreToMusicXml } from '@/music/musicxml'
import { partToAsciiTab } from '@/music/asciitab'
import { measureCount } from '@/music/score'
import { isFretted, INSTRUMENTS } from '@/music/theory'

type Format = 'wav' | 'mp3' | 'flac' | 'mid' | 'musicxml' | 'pdf' | 'txt'
const FORMATS: { k: Format; label: string; audio?: boolean }[] = [
  { k: 'wav', label: 'WAV', audio: true }, { k: 'mp3', label: 'MP3', audio: true }, { k: 'flac', label: 'FLAC', audio: true },
  { k: 'mid', label: 'MIDI' }, { k: 'musicxml', label: 'MusicXML' }, { k: 'pdf', label: 'PDF' }, { k: 'txt', label: 'Tab (.txt)' }
]
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled'

export default function ExportDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const settings = useApp((s) => s.settings)!
  const toast = useApp((s) => s.toast)
  const st = useProject()
  const count = measureCount(project.score)
  const [tab, setTab] = useState<'file' | 'daw'>('file')
  const [scope, setScope] = useState<'all' | 'range' | 'measure' | 'custom'>(st.range ? 'range' : 'all')
  const [custom, setCustom] = useState({ from: 1, to: count })
  const [who, setWho] = useState<'mix' | 'one' | 'each'>('mix')
  const [partId, setPartId] = useState(st.cursor?.partId ?? project.score.parts[0]?.id ?? '')
  const [fmt, setFmt] = useState<Format>('wav')
  const [audio, setAudio] = useState<ExportAudioSettings>(settings.export)
  const [useStems, setUseStems] = useState(true)
  const [withPdf, setWithPdf] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const parts = project.score.parts
  const hasAudio = parts.some((p) => p.stem && p.playback === 'audio')

  const range = (): { from: number; to: number } => {
    if (scope === 'range' && st.range) return st.range
    if (scope === 'measure') return { from: st.cursor?.measure ?? 0, to: st.cursor?.measure ?? 0 }
    if (scope === 'custom') return { from: Math.max(0, custom.from - 1), to: Math.min(count - 1, custom.to - 1) }
    return { from: 0, to: Math.max(0, count - 1) }
  }
  const isAudio = FORMATS.find((f) => f.k === fmt)?.audio
  const groupIds = (id: string) => { const p = parts.find((x) => x.id === id); return p?.group ? parts.filter((x) => x.group === p.group).map((x) => x.id) : [id] }
  const units = (): { name: string; ids: string[] }[] => {
    if (who === 'mix') return [{ name: project.score.title, ids: parts.map((p) => p.id) }]
    if (who === 'one') return [{ name: `${project.score.title} - ${parts.find((p) => p.id === partId)?.name.replace(/ (RH|LH)$/, '') ?? 'Part'}`, ids: groupIds(partId) }]
    const seen = new Set<string>()
    return parts.flatMap((p) => {
      const key = p.group ?? p.id
      if (seen.has(key)) return []
      seen.add(key)
      return [{ name: `${project.score.title} - ${p.group ? p.name.replace(/ (RH|LH)$/, '') : p.name}`, ids: groupIds(p.id) }]
    })
  }

  const write = async (path: string, ids: string[], f: Format, r: { from: number; to: number }, normalize = audio.normalize) => {
    if (f === 'mid') return api.exporter.writeFile(path, scoreToMidi(project.score, { partIds: ids, ...r }))
    if (f === 'musicxml') return api.exporter.writeFile(path, scoreToMusicXml(project.score, { partIds: ids, ...r }))
    if (f === 'txt') return api.exporter.writeFile(path, ids.map((id) => parts.find((p) => p.id === id)!).filter((p) => isFretted(p.kind)).map((p) => partToAsciiTab(project.score, p, r)).join('\n\n') || 'No guitar or bass parts in this selection.')
    if (f === 'pdf') return api.exporter.pdf(project.id, path, { partIds: ids, mode: project.view?.mode ?? 'both', ...r })
    const wav = await renderWav(project, { partIds: ids, ...r, settings: { ...audio, normalize }, useAudioStems: useStems })
    return api.exporter.writeAudio(path, wav, f as 'wav' | 'mp3' | 'flac')
  }

  const exportFiles = async () => {
    const r = range()
    const us = units()
    const ext = fmt === 'txt' ? 'txt' : fmt
    try {
      if (us.length === 1) {
        const path = await api.exporter.saveDialog(`${safe(us[0].name)}.${ext}`, [{ name: fmt.toUpperCase(), extensions: [ext] }])
        if (!path) return
        setBusy(`Exporting ${fmt.toUpperCase()}…`)
        await write(path, us[0].ids, fmt, r)
        toast(`Exported ${path.split(/[\\/]/).pop()}`, 'ok', { label: 'Show', run: () => api.exporter.openPath(path.replace(/[\\/][^\\/]+$/, '')) })
      } else {
        const dir = await api.exporter.chooseFolder()
        if (!dir) return
        for (const [i, u] of us.entries()) {
          setBusy(`Exporting ${i + 1} of ${us.length}: ${u.name}`)
          await write(`${dir}/${safe(u.name)}.${ext}`, u.ids, fmt, r, false)
        }
        toast(`Exported ${us.length} files`, 'ok', { label: 'Open folder', run: () => api.exporter.openPath(dir) })
      }
      onClose()
    } catch (e) { toast(`Export failed: ${(e as Error).message}`, 'error') } finally { setBusy(null) }
  }

  const exportDaw = async () => {
    const base = await api.exporter.chooseFolder()
    if (!base) return
    const r = range()
    const dir = `${base}/${safe(project.score.title)} - Aurel export`
    const s = project.score
    try {
      const each = (() => { const seen = new Set<string>(); return parts.flatMap((p) => { const k = p.group ?? p.id; if (seen.has(k)) return []; seen.add(k); return [{ name: p.group ? p.name.replace(/ (RH|LH)$/, '') : p.name, ids: groupIds(p.id) }] }) })()
      setBusy('Rendering full mix…')
      await write(`${dir}/${safe(s.title)} - Full Mix.wav`, parts.map((p) => p.id), 'wav', r, false)
      for (const [i, u] of each.entries()) {
        setBusy(`Rendering stem ${i + 1} of ${each.length}: ${u.name}`)
        await write(`${dir}/Stems/${String(i + 1).padStart(2, '0')} ${safe(u.name)}.wav`, u.ids, 'wav', r, false)
        await write(`${dir}/MIDI/${String(i + 1).padStart(2, '0')} ${safe(u.name)}.mid`, u.ids, 'mid', r)
      }
      setBusy('Writing MIDI & MusicXML…')
      await write(`${dir}/${safe(s.title)} - Multitrack.mid`, parts.map((p) => p.id), 'mid', r)
      await write(`${dir}/${safe(s.title)}.musicxml`, parts.map((p) => p.id), 'musicxml', r)
      if (withPdf) { setBusy('Engraving PDF…'); await write(`${dir}/${safe(s.title)}.pdf`, parts.map((p) => p.id), 'pdf', r) }
      const readme = [
        `${s.title}${s.composer ? ` — ${s.composer}` : ''}`, '',
        `Tempo: ${s.tempo} BPM${s.tempoChanges?.length ? ' (with tempo changes — see MIDI)' : ''}`,
        `Time signature: ${s.timeSig.num}/${s.timeSig.den}`,
        `Measures: ${r.from + 1}–${r.to + 1}`,
        `Audio: ${audio.sampleRate} Hz, ${audio.bitDepth === 32 ? '32-bit float' : `${audio.bitDepth}-bit`}, ${audio.channels === 2 ? 'stereo' : 'mono'}`, '',
        'FL Studio: set the project tempo above, then drag every file from Stems/ into the Playlist at bar 1.',
        'All stems have identical length and start at the first exported measure, so they line up exactly.',
        'Drag the MIDI files onto Channel Rack instruments to re-voice any part.', '',
        'Parts:', ...each.map((u, i) => `  ${String(i + 1).padStart(2, '0')} ${u.name} (${INSTRUMENTS[parts.find((p) => p.id === u.ids[0])!.kind].label})`)
      ].join('\n')
      await api.exporter.writeFile(`${dir}/README.txt`, readme)
      toast('DAW package ready', 'ok', { label: 'Open folder', run: () => api.exporter.openPath(dir) })
      onClose()
    } catch (e) { toast(`Export failed: ${(e as Error).message}`, 'error') } finally { setBusy(null) }
  }

  const seg = <T extends string | number>(v: T, set: (x: T) => void, opts: [T, string][]) => (
    <div className="seg">{opts.map(([k, l]) => <button key={String(k)} className={cx(v === k && 'on')} onClick={() => set(k)}>{l}</button>)}</div>
  )

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Export" width={640}
      footer={busy ? <div className="flex items-center gap-2 text-muted mr-auto"><Loader2 size={15} className="animate-spin" /> {busy}</div> : (
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          {tab === 'file' ? <button className="btn-primary" disabled={!parts.length && fmt !== 'wav'} onClick={exportFiles}><FileDown size={15} /> Export</button>
            : <button className="btn-primary" disabled={!parts.length} onClick={exportDaw}><FolderDown size={15} /> Choose folder & export</button>}
        </>
      )}>
      <div className="seg mb-4">
        <button className={cx(tab === 'file' && 'on')} onClick={() => setTab('file')}>File</button>
        <button className={cx(tab === 'daw' && 'on')} onClick={() => setTab('daw')}>Export to DAW (FL Studio)</button>
      </div>
      <div className="space-y-3.5">
        <div className="flex items-center gap-4"><span className="label w-24">Range</span>
          {seg(scope, setScope, [['all', 'Whole song'], ...(st.range ? [['range', `Bars ${st.range.from + 1}–${st.range.to + 1}`] as ['range', string]] : []), ['measure', `Bar ${(st.cursor?.measure ?? 0) + 1}`], ['custom', 'Custom']])}
        </div>
        {scope === 'custom' && (
          <div className="flex items-center gap-2 pl-28">
            <span className="text-muted">Bars</span>
            <input type="number" className="field !w-20 !h-8" min={1} max={count} value={custom.from} onChange={(e) => setCustom({ ...custom, from: +e.target.value })} />
            <span className="text-muted">to</span>
            <input type="number" className="field !w-20 !h-8" min={1} max={count} value={custom.to} onChange={(e) => setCustom({ ...custom, to: +e.target.value })} />
          </div>
        )}
        {tab === 'file' && (
          <>
            <div className="flex items-center gap-4"><span className="label w-24">Instruments</span>
              {seg(who, setWho, [['mix', 'All together'], ['one', 'One instrument'], ['each', 'Each separately']])}
            </div>
            {who === 'one' && (
              <div className="pl-28">
                <Select width={256} value={partId} onChange={setPartId} options={parts.filter((p) => !p.group || parts.find((x) => x.group === p.group) === p).map((p) => ({ value: p.id, label: p.group ? p.name.replace(/ (RH|LH)$/, '') : p.name }))} />
              </div>
            )}
            <div className="flex items-center gap-4"><span className="label w-24">Format</span>
              <div className="flex flex-wrap gap-1.5">{FORMATS.map((f) => <button key={f.k} className={cx('chip !h-7 !px-2.5', fmt === f.k ? '!bg-accent/15 !text-accent' : 'hover:text-fg')} onClick={() => setFmt(f.k)}>{f.label}</button>)}</div>
            </div>
          </>
        )}
        {tab === 'daw' && (
          <div className="rounded-lg bg-fg/[0.03] border border-line p-3 text-[12.5px] text-muted leading-relaxed">
            Creates a folder with the full-mix WAV, one WAV stem and one MIDI file per instrument, a multitrack MIDI, MusicXML and a README with the tempo. Every stem has the same start and length so they align at bar 1.
            <div className="mt-2"><Toggle on={withPdf} onChange={setWithPdf} label="Include PDF sheet music" /></div>
          </div>
        )}
        {(tab === 'daw' || isAudio) && (
          <div className="card p-3 space-y-2.5 bg-raised/30">
            <div className="flex items-center gap-3 flex-wrap">
              {seg(audio.sampleRate, (v) => setAudio({ ...audio, sampleRate: v }), [[44100, '44.1k'], [48000, '48k'], [96000, '96k']])}
              {seg(audio.bitDepth, (v) => setAudio({ ...audio, bitDepth: v }), [[16, '16-bit'], [24, '24-bit'], [32, '32f']])}
              {seg(audio.channels, (v) => setAudio({ ...audio, channels: v }), [[2, 'Stereo'], [1, 'Mono']])}
            </div>
            <div className="flex items-center gap-5 flex-wrap">
              {tab === 'file' && <Toggle on={audio.normalize} onChange={(v) => setAudio({ ...audio, normalize: v })} label="Normalize" />}
              <label className="flex items-center gap-2 text-[13px]">Tail <input type="number" min={0} max={10} step={0.5} className="field !w-16 !h-7" value={audio.tail} onChange={(e) => setAudio({ ...audio, tail: +e.target.value })} /> s</label>
              {hasAudio && <Toggle on={useStems} onChange={setUseStems} label="Use isolated recordings for “Audio” parts" />}
            </div>
            <p className="text-[11.5px] text-faint">Parts are rendered with their assigned built-in instrument sounds.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
