import { useMemo, useState } from 'react'
import { Search, Star, MoreHorizontal, FolderPlus, Trash2, Package, FolderOpen, Library as LibIcon, Clock, AudioLines, PenLine, Folder, Check, Plus, PackageOpen } from 'lucide-react'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { Artwork, cx, fmtTime, relTime, Popover, MenuItem, Modal } from '@/components/ui'
import type { LibraryEntry } from '@shared/types'
import { openContextMenu } from '@/components/menu'
import { itemMenu, createMenu, renameProject, type LibraryActions } from './libraryMenu'

type Filter = 'all' | 'fav' | 'recent' | 'transcription' | 'composition' | `c:${string}`

export default function Library() {
  const { library, collections, refreshLibrary, go, toast, jobs } = useApp()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<'updated' | 'title' | 'created'>('updated')
  const [confirm, setConfirm] = useState<LibraryEntry | null>(null)
  const [newColl, setNewColl] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<LibraryEntry | null>(null)
  const actions: LibraryActions = { rename: setRenaming, remove: setConfirm, newCollection: (forId) => setNewColl(forId ?? '') }

  const list = useMemo(() => {
    let l = library
    if (filter === 'fav') l = l.filter((e) => e.favorite)
    if (filter === 'recent') l = l.filter((e) => e.opened).sort((a, b) => b.opened - a.opened).slice(0, 30)
    if (filter === 'transcription' || filter === 'composition') l = l.filter((e) => e.kind === filter)
    if (filter.startsWith('c:')) l = l.filter((e) => e.collections.includes(filter.slice(2)))
    const s = q.trim().toLowerCase()
    if (s) l = l.filter((e) => `${e.title} ${e.artist} ${e.source ?? ''}`.toLowerCase().includes(s))
    if (filter !== 'recent') l = [...l].sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : sort === 'created' ? b.created - a.created : b.updated - a.updated))
    return l
  }, [library, filter, q, sort])

  const side = [
    { k: 'all' as Filter, icon: LibIcon, label: 'All songs', n: library.length },
    { k: 'fav' as Filter, icon: Star, label: 'Favorites', n: library.filter((e) => e.favorite).length },
    { k: 'recent' as Filter, icon: Clock, label: 'Recently opened', n: library.filter((e) => e.opened).length },
    { k: 'transcription' as Filter, icon: AudioLines, label: 'Transcriptions', n: library.filter((e) => e.kind === 'transcription').length },
    { k: 'composition' as Filter, icon: PenLine, label: 'Compositions', n: library.filter((e) => e.kind === 'composition').length }
  ]

  const statusChip = (e: LibraryEntry) => {
    if (e.kind === 'composition') return null
    const m: Record<string, [string, string]> = { done: ['Transcribed', 'text-ok bg-ok/10'], running: ['Processing…', 'text-accent bg-accent/10'], failed: ['Failed', 'text-bad bg-bad/10'], none: ['Audio only', ''], cancelled: ['Audio only', ''], queued: ['Queued', ''] }
    const [t, c] = m[e.status] ?? m.none
    const job = Object.values(jobs).find((j) => j.projectId === e.id && j.kind === 'process' && !j.done)
    if (job && job.pct >= 0) return <span className={cx('chip tabular-nums', m.running[1])}>Transcribing {Math.floor(job.pct * 100)}%</span>
    return <span className={cx('chip', c)}>{t}</span>
  }

  return (
    <div className="h-full flex">
      <aside className="w-[230px] shrink-0 px-3 pt-1 border-r border-line overflow-auto">
        <h1 className="font-display text-[26px] px-2 mb-4">Library</h1>
        {side.map((s) => (
          <button key={s.k} onClick={() => setFilter(s.k)} className={cx('w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px]', filter === s.k ? 'bg-accent/12 bg-accent/10 text-accent' : 'text-muted hover:text-fg hover:bg-fg/[0.05]')}>
            <s.icon size={16} /> <span className="flex-1 text-left">{s.label}</span><span className="text-[11px] tabular-nums opacity-70">{s.n}</span>
          </button>
        ))}
        <div className="flex items-center justify-between mt-6 mb-1 px-2.5">
          <span className="label">Collections</span>
          <button className="icon-btn !h-6 !w-6" title="New collection" onClick={() => setNewColl('')}><Plus size={14} /></button>
        </div>
        {collections.map((c) => (
          <div key={c.id} className="group flex items-center">
            <button onClick={() => setFilter(`c:${c.id}`)} className={cx('flex-1 flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px] min-w-0', filter === `c:${c.id}` ? 'bg-accent/10 text-accent' : 'text-muted hover:text-fg hover:bg-fg/[0.05]')}>
              <Folder size={15} /><span className="flex-1 text-left truncate">{c.name}</span><span className="text-[11px] opacity-70">{c.count}</span>
            </button>
            <button className="icon-btn !h-7 !w-7 opacity-0 group-hover:opacity-100" title="Delete collection" onClick={async () => { await api.library.deleteCollection(c.id); if (filter === `c:${c.id}`) setFilter('all'); void refreshLibrary() }}><Trash2 size={13} /></button>
          </div>
        ))}
        {collections.length === 0 && <p className="px-2.5 text-faint text-[12px]">Group songs into setlists or practice routines.</p>}
      </aside>

      <section className="flex-1 min-w-0 flex flex-col" onContextMenu={(e) => openContextMenu(e, createMenu(actions))}>
        <div className="px-6 pb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-[460px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="field !pl-9" placeholder="Search title, artist or source" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="seg">
            {(['updated', 'title', 'created'] as const).map((s) => <button key={s} className={cx(sort === s && 'on')} onClick={() => setSort(s)}>{s === 'updated' ? 'Last edited' : s === 'title' ? 'Title' : 'Date added'}</button>)}
          </div>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={async () => { try { const id = await api.library.importPortable(); if (id) { await refreshLibrary(); go({ name: 'studio', projectId: id }) } } catch (e) { toast((e as Error).message, 'error') } }}><PackageOpen size={15} /> Open .aurel</button>
        </div>
        <div className="flex-1 overflow-auto px-6 pb-10">
          {list.length === 0 ? (
            <div className="text-center text-muted mt-24">{library.length ? 'Nothing matches.' : 'Your library is empty. Import a song or start a composition from Home.'}</div>
          ) : (
            <div className="flex flex-col stagger">
              {list.map((e) => (
                <div key={e.id} onContextMenu={(ev) => openContextMenu(ev, itemMenu(e, actions))} onDoubleClick={() => go({ name: 'studio', projectId: e.id })} className="group flex items-center gap-3.5 px-2 py-2 rounded-xl hover:bg-fg/[0.05] hover:translate-x-0.5 transition-all duration-200 cursor-default">
                  <button onClick={() => go({ name: 'studio', projectId: e.id })}><Artwork id={e.id} artwork={e.artwork} title={e.title} size={46} /></button>
                  <div className="min-w-0 flex-1">
                    <button className="font-medium truncate hover:text-accent text-left max-w-full" onClick={() => go({ name: 'studio', projectId: e.id })}>{e.title}</button>
                    <div className="text-[12px] text-muted truncate">{e.artist || (e.kind === 'composition' ? 'Original composition' : '—')}</div>
                  </div>
                  <div className="w-[120px]">{statusChip(e)}</div>
                  <div className="w-[60px] text-[12px] text-muted tabular-nums">{e.duration ? fmtTime(e.duration) : ''}</div>
                  <div className="w-[100px] text-[12px] text-faint">{relTime(e.updated)}</div>
                  <button className={cx('icon-btn', e.favorite ? 'text-accent' : 'opacity-0 group-hover:opacity-100')} title="Favorite" onClick={async () => { await api.library.setFavorite(e.id, !e.favorite); void refreshLibrary() }}>
                    <Star size={16} fill={e.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <Popover align="right" width={230} trigger={(t) => <button className="icon-btn" onClick={t}><MoreHorizontal size={16} /></button>}>
                    {(close) => (
                      <>
                        {collections.map((c) => (
                          <MenuItem key={c.id} icon={e.collections.includes(c.id) ? <Check size={14} /> : <Folder size={14} />} onClick={async () => { await api.library.setInCollection(c.id, e.id, !e.collections.includes(c.id)); void refreshLibrary(); close() }}>{c.name}</MenuItem>
                        ))}
                        <MenuItem icon={<FolderPlus size={14} />} onClick={() => { setNewColl(e.id); close() }}>New collection…</MenuItem>
                        <div className="h-px bg-line my-1" />
                        <MenuItem icon={<Package size={14} />} onClick={async () => { close(); const p = await api.library.exportPortable(e.id); if (p) toast('Project exported', 'ok') }}>Export .aurel file</MenuItem>
                        <MenuItem icon={<FolderOpen size={14} />} onClick={() => { close(); void api.library.reveal(e.id) }}>Show project folder</MenuItem>
                        <MenuItem icon={<Trash2 size={14} />} danger onClick={() => { close(); setConfirm(e) }}>Delete…</MenuItem>
                      </>
                    )}
                  </Popover>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete song?" width={420} footer={<><button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="btn bg-bad text-white hover:brightness-110" onClick={async () => { await api.library.remove(confirm!.id); setConfirm(null); void refreshLibrary() }}>Delete</button></>}>
        <p className="text-muted">“{confirm?.title}” and its audio, stems and notation will be removed from this computer. This can’t be undone.</p>
      </Modal>
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename" width={420}>
        <form onSubmit={async (ev) => { ev.preventDefault(); const t = (new FormData(ev.currentTarget).get('t') as string).trim(); if (t && renaming) await renameProject(renaming.id, t); setRenaming(null) }} className="flex gap-2">
          <input name="t" className="field" defaultValue={renaming?.title} autoFocus onFocus={(e) => e.target.select()} />
          <button className="btn-primary !h-9">Save</button>
        </form>
      </Modal>
      <Modal open={newColl !== null} onClose={() => setNewColl(null)} title="New collection" width={400}>
        <form onSubmit={async (ev) => {
          ev.preventDefault()
          const name = new FormData(ev.currentTarget).get('name') as string
          if (!name.trim()) return
          const c = await api.library.createCollection(name.trim())
          if (newColl) await api.library.setInCollection(c.id, newColl, true)
          setNewColl(null)
          void refreshLibrary()
        }} className="flex gap-2">
          <input name="name" className="field" placeholder="e.g. Setlist, Practice this week" autoFocus />
          <button className="btn-primary !h-9">Create</button>
        </form>
      </Modal>
    </div>
  )
}
