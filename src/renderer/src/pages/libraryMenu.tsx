import { FolderOpen, Package, Pencil, Star, Trash2, Folder, FolderPlus, Play, PenLine, AudioLines, Youtube, FileMusic, Copy } from 'lucide-react'
import type { LibraryEntry } from '@shared/types'
import type { MenuEntry } from '@/components/menu'
import { useApp } from '@/store/app'
import { api } from '@/lib/api'
import { midiToScore } from '@/music/midi'
import { newProject, uid } from '@/music/score'

export interface LibraryActions { rename(e: LibraryEntry): void; remove(e: LibraryEntry): void; newCollection(forId?: string): void }

export function itemMenu(e: LibraryEntry, a: LibraryActions): MenuEntry[] {
  const st = useApp.getState()
  const refresh = () => void st.refreshLibrary()
  return [
    { label: 'Open', icon: <Play size={14} />, onClick: () => st.go({ name: 'studio', projectId: e.id }) },
    { label: 'Change cover photo…', onClick: () => void st.changeCover(e.id) },
    { label: 'Rename…', icon: <Pencil size={14} />, onClick: () => a.rename(e) },
    { label: e.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <Star size={14} />, onClick: async () => { await api.library.setFavorite(e.id, !e.favorite); refresh() } },
    {
      label: 'Move to collection', icon: <Folder size={14} />,
      submenu: [
        ...st.collections.map((c) => ({ label: c.name, checked: e.collections.includes(c.id), onClick: async () => { await api.library.setInCollection(c.id, e.id, !e.collections.includes(c.id)); refresh() } })),
        ...(st.collections.length ? [{ separator: true } as MenuEntry] : []),
        { label: 'New collection…', icon: <FolderPlus size={14} />, onClick: () => a.newCollection(e.id) }
      ]
    },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: async () => {
      const p = await api.project.load(e.id)
      if (p.audio) { st.toast('Songs with audio can be copied with Export .aurel, then Open .aurel.', 'info'); return }
      const copy = { ...p, id: uid('s'), created: Date.now(), updated: Date.now(), score: { ...p.score, title: `${p.score.title} (copy)` } }
      await api.project.create(copy)
      refresh()
    } },
    { separator: true },
    { label: 'Export .aurel file', icon: <Package size={14} />, onClick: async () => { const r = await api.library.exportPortable(e.id); if (r) st.toast('Project exported', 'ok') } },
    { label: 'Show project folder', icon: <FolderOpen size={14} />, onClick: () => void api.library.reveal(e.id) },
    { separator: true },
    { label: 'Delete…', icon: <Trash2 size={14} />, danger: true, onClick: () => a.remove(e) }
  ]
}

export function createMenu(a: LibraryActions): MenuEntry[] {
  const st = useApp.getState()
  return [
    { label: 'New composition', icon: <PenLine size={14} />, onClick: () => st.setDialog('new') },
    { label: 'Import audio…', icon: <AudioLines size={14} />, onClick: async () => { const p = await api.media.pickAudio(); if (p) void st.importFile(p) } },
    { label: 'Import from YouTube…', icon: <Youtube size={14} />, onClick: () => st.setDialog('youtube') },
    { label: 'Import MIDI…', icon: <FileMusic size={14} />, onClick: async () => {
      const f = await api.media.pickMidi()
      if (!f) return
      const p = newProject(midiToScore(f.data, f.name), 'composition')
      await api.project.create(p)
      await st.refreshLibrary()
      st.go({ name: 'studio', projectId: p.id })
    } },
    { separator: true },
    { label: 'New collection…', icon: <FolderPlus size={14} />, onClick: () => a.newCollection() }
  ]
}

/** Rename a project (its title) from outside the editor. */
export async function renameProject(id: string, title: string): Promise<void> {
  const p = await api.project.load(id)
  p.score.title = title
  p.updated = Date.now()
  await api.project.save(p)
  await useApp.getState().refreshLibrary()
}
