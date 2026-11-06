import { AudioLines, Youtube, PenLine, FileMusic, Link2, PackageOpen, Cpu, ArrowRight } from 'lucide-react'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { Artwork, cx, relTime, Modal } from '@/components/ui'
import { midiToScore } from '@/music/midi'
import { newProject } from '@/music/score'
import { openContextMenu } from '@/components/menu'
import { itemMenu, createMenu, renameProject, type LibraryActions } from './libraryMenu'
import { useState } from 'react'
import type { LibraryEntry } from '@shared/types'

export default function Home() {
  const { library, go, setDialog, importFile, engine, refreshLibrary, toast } = useApp()
  const recent = [...library].sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 6)

  const pickAudio = async () => { const p = await api.media.pickAudio(); if (p) void importFile(p) }
  const importMidi = async () => {
    const f = await api.media.pickMidi()
    if (!f) return
    try {
      const p = newProject(midiToScore(f.data, f.name), 'composition')
      await api.project.create(p)
      await refreshLibrary()
      go({ name: 'studio', projectId: p.id })
    } catch (e) { toast(`Could not read MIDI: ${(e as Error).message}`, 'error') }
  }
  const openPortable = async () => {
    try { const id = await api.library.importPortable(); if (id) { await refreshLibrary(); go({ name: 'studio', projectId: id }) } } catch (e) { toast((e as Error).message, 'error') }
  }

  const cards = [
    { icon: AudioLines, title: 'Import Audio', body: 'MP3, WAV, FLAC, M4A, OGG or a video file. Drag & drop works anywhere.', action: pickAudio, hint: 'Separate · Transcribe · Practice' },
    { icon: Youtube, title: 'YouTube Link', body: 'Paste a link to download a recording. Then choose how to transcribe it.', action: () => setDialog('youtube'), hint: 'Download · Transcribe' },
    { icon: PenLine, title: 'New Composition', body: 'Start from a blank score. Write on the staff or in tab, with drums on a step grid.', action: () => setDialog('new'), hint: 'Notation · Tab · Drums' }
  ]

  const [renaming, setRenaming] = useState<LibraryEntry | null>(null)
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null)
  const actions: LibraryActions = { rename: setRenaming, remove: setDeleting, newCollection: () => go({ name: 'library' }) }
  return (
    <div className="h-full overflow-auto" onContextMenu={(e) => openContextMenu(e, createMenu(actions))}>
      <div className="max-w-[1080px] mx-auto px-10 pb-16">
        <header className="pt-6 pb-10 animate-fadein">
          <div className="label mb-3">Transcribe · Compose · Practice</div>
          <h1 className="font-display text-[44px] leading-[1.05] font-light tracking-tight">
            What are we <span className="italic text-accent">playing</span> today?
          </h1>
        </header>

        <section className="grid grid-cols-3 gap-4">
          {cards.map((c, i) => (
            <button key={c.title} onClick={c.action} className="group card text-left p-6 hover:border-accent/50 hover:-translate-y-0.5 transition-all duration-200 animate-fadein relative overflow-hidden" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/[0.06] group-hover:bg-accent/[0.12] transition-colors" />
              <div className="h-11 w-11 rounded-xl bg-accent/12 bg-accent/10 text-accent flex items-center justify-center mb-5"><c.icon size={21} strokeWidth={1.7} /></div>
              <div className="font-display text-[21px] mb-1.5">{c.title}</div>
              <p className="text-muted text-[13px] leading-relaxed min-h-[40px]">{c.body}</p>
              <div className="mt-5 flex items-center justify-between text-[11.5px] text-faint">
                <span>{c.hint}</span>
                <ArrowRight size={15} className="text-accent opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
              </div>
            </button>
          ))}
        </section>

        <div className="flex items-center gap-2 mt-4">
          <button className="btn-ghost" onClick={importMidi}><FileMusic size={15} /> Import MIDI</button>
          <button className="btn-ghost" onClick={() => setDialog('url')}><Link2 size={15} /> Audio from URL</button>
          <button className="btn-ghost" onClick={openPortable}><PackageOpen size={15} /> Open .aurel project</button>
          <div className="flex-1" />
          {engine && (
            <button className={cx('chip !h-7 !px-2.5 hover:text-fg', engine.ready ? '!text-ok' : '')} onClick={() => go({ name: 'settings', section: 'engine' })}>
              <Cpu size={13} /> {engine.ready ? `AI engine ready${engine.cuda ? ` · ${engine.gpuName ?? 'GPU'}` : ' · CPU'}` : 'AI engine not installed'}
            </button>
          )}
        </div>

        <section className="mt-12">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-[22px]">Recent</h2>
            {library.length > 0 && <button className="btn-ghost !h-7" onClick={() => go({ name: 'library' })}>Open library <ArrowRight size={14} /></button>}
          </div>
          {recent.length === 0 ? (
            <div className="card border-dashed px-6 py-10 text-center text-muted">Your songs and compositions will show up here.</div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {recent.map((e) => (
                <button key={e.id} onContextMenu={(ev) => openContextMenu(ev, itemMenu(e, actions))} onClick={() => go({ name: 'studio', projectId: e.id })} className="card p-3 flex items-center gap-3 text-left hover:bg-raised/60 transition-colors">
                  <Artwork id={e.id} artwork={e.artwork} title={e.title} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{e.title}</div>
                    <div className="text-[12px] text-muted truncate">{e.artist || (e.kind === 'composition' ? 'Composition' : 'Imported')} · {relTime(e.opened || e.updated)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename" width={420}>
        <form onSubmit={async (ev) => { ev.preventDefault(); const t = (new FormData(ev.currentTarget).get('t') as string).trim(); if (t && renaming) await renameProject(renaming.id, t); setRenaming(null) }} className="flex gap-2">
          <input name="t" className="field" defaultValue={renaming?.title} autoFocus onFocus={(e) => e.target.select()} />
          <button className="btn-primary !h-9">Save</button>
        </form>
      </Modal>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete song?" width={420} footer={<><button className="btn-ghost" onClick={() => setDeleting(null)}>Cancel</button><button className="btn bg-bad text-white hover:brightness-110" onClick={async () => { await api.library.remove(deleting!.id); setDeleting(null); void refreshLibrary() }}>Delete</button></>}>
        <p className="text-muted">“{deleting?.title}” and its audio, stems and notation will be removed from this computer.</p>
      </Modal>
    </div>
  )
}
