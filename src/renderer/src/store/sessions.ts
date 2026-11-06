import type { SessionFolder, SessionTab } from '@shared/types'
import { uid } from '@/music/score'
import { useApp } from './app'

/** Pieces kept open in the sidebar, with optional folders. Stored in settings so they survive a restart. */
function current(): { sessions: SessionTab[]; folders: SessionFolder[] } {
  const s = useApp.getState().settings
  return { sessions: s?.sessions ?? [], folders: s?.sessionFolders ?? [] }
}
function save(sessions: SessionTab[], folders?: SessionFolder[]): void {
  const patch = folders ? { sessions, sessionFolders: folders } : { sessions }
  // show the change at once; the settings file catches up
  useApp.setState((st) => st.settings ? { settings: { ...st.settings, ...patch } } : st)
  void useApp.getState().updateSettings(patch)
}

export function openSession(projectId: string): void {
  const { sessions } = current()
  if (!sessions.some((x) => x.projectId === projectId)) save([...sessions, { projectId }])
}

/** Close a session; if it is the one on screen, show the next one (or Home). */
export function closeSession(projectId: string): void {
  const { sessions } = current()
  const at = sessions.findIndex((x) => x.projectId === projectId)
  if (at < 0) return
  const rest = sessions.filter((x) => x.projectId !== projectId)
  save(rest)
  const app = useApp.getState()
  if (app.route.name === 'studio' && app.route.projectId === projectId) {
    const next = rest[Math.min(at, rest.length - 1)]
    app.go(next ? { name: 'studio', projectId: next.projectId } : { name: 'home' })
  }
}

export function closeOtherSessions(projectId: string): void {
  save(current().sessions.filter((x) => x.projectId === projectId))
}

/** Move a session before another one (or to the end of `folder` when `before` is null). */
export function moveSession(projectId: string, folder: string | undefined, before: string | null): void {
  const { sessions } = current()
  const item = sessions.find((x) => x.projectId === projectId)
  if (!item || before === projectId) return
  const rest = sessions.filter((x) => x.projectId !== projectId)
  const moved = { ...item, folder }
  let at = before ? rest.findIndex((x) => x.projectId === before) : -1
  if (at < 0) {
    // after the last session of that folder, so folders stay together
    const lastInFolder = rest.map((x) => x.folder).lastIndexOf(folder)
    at = lastInFolder >= 0 ? lastInFolder + 1 : rest.length
  }
  rest.splice(at, 0, moved)
  save(rest)
}

export function addFolder(name = 'New folder'): string {
  const { sessions, folders } = current()
  const id = uid('f')
  save(sessions, [...folders, { id, name }])
  return id
}
export function renameFolder(id: string, name: string): void {
  const { sessions, folders } = current()
  save(sessions, folders.map((f) => f.id === id ? { ...f, name: name.trim() || f.name } : f))
}
export function toggleFolder(id: string): void {
  const { sessions, folders } = current()
  save(sessions, folders.map((f) => f.id === id ? { ...f, collapsed: !f.collapsed } : f))
}
/** Remove a folder; its sessions stay open, outside any folder. */
export function removeFolder(id: string): void {
  const { sessions, folders } = current()
  save(sessions.map((x) => x.folder === id ? { projectId: x.projectId } : x), folders.filter((f) => f.id !== id))
}
export function moveFolder(id: string, before: string | null): void {
  const { sessions, folders } = current()
  const f = folders.find((x) => x.id === id)
  if (!f || before === id) return
  const rest = folders.filter((x) => x.id !== id)
  const at = before ? rest.findIndex((x) => x.id === before) : -1
  rest.splice(at < 0 ? rest.length : at, 0, f)
  save(sessions, rest)
}
