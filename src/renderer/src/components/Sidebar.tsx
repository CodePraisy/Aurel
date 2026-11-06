import { useState, type DragEvent, type ReactNode } from 'react'
import { Home as HomeIcon, Library as LibraryIcon, Settings as SettingsIcon, RefreshCw, ChevronRight, FolderPlus, Folder, FolderOpen, X, PanelLeftClose, PanelLeftOpen, Pencil, Trash2, AudioLines, PenLine, FolderInput, Plus } from 'lucide-react'
import type { LibraryEntry, SessionFolder, SessionTab } from '@shared/types'
import { useApp } from '@/store/app'
import { addFolder, closeOtherSessions, closeSession, moveFolder, moveSession, removeFolder, renameFolder, toggleFolder } from '@/store/sessions'
import { openContextMenu, type MenuEntry } from './menu'
import { Artwork, cx } from './ui'

const SESSION = 'application/x-aurel-session'
const FOLDER = 'application/x-aurel-folder'
type Drop = { kind: 'before'; id: string } | { kind: 'folder'; id: string } | { kind: 'end' } | null

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 19 L10.5 4.5 L17 19" />
      <path d="M7 13.2 H14" />
      <circle cx="18.5" cy="17.5" r="2.2" fill="currentColor" stroke="none" />
      <path d="M20.6 17.4 V8.2" />
    </svg>
  )
}

function NavItem({ on, open, icon, label, onClick }: { on: boolean; open: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={open ? undefined : label} aria-current={on ? 'page' : undefined}
      className={cx('side-item no-drag', on && 'on', open ? 'w-full px-3 justify-start' : 'w-10 justify-center')}>
      {icon}{open && <span className="truncate">{label}</span>}
    </button>
  )
}

export default function Sidebar({ version, checking, onCheckUpdates }: { version: string; checking: boolean; onCheckUpdates: () => void }) {
  const { route, go, settings, library, updateSettings } = useApp()
  const [drop, setDrop] = useState<Drop>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const open = settings?.sidebarOpen ?? true
  const byId = new Map(library.map((e) => [e.id, e]))
  // a session whose piece was deleted is not shown
  const sessions = (settings?.sessions ?? []).filter((s) => !library.length || byId.has(s.projectId))
  const folders = settings?.sessionFolders ?? []
  const active = route.name === 'studio' ? route.projectId : null

  const folderMenu = (f: SessionFolder): MenuEntry[] => [
    { label: 'Rename folder', icon: <Pencil size={14} />, onClick: () => setRenaming(f.id) },
    { label: f.collapsed ? 'Expand' : 'Collapse', onClick: () => toggleFolder(f.id) },
    { separator: true },
    { label: 'Delete folder (keeps its pieces open)', icon: <Trash2 size={14} />, danger: true, onClick: () => removeFolder(f.id) }
  ]
  const sessionMenu = (s: SessionTab, entry?: LibraryEntry): MenuEntry[] => [
    { label: 'Open', onClick: () => go({ name: 'studio', projectId: s.projectId }) },
    { label: 'Move to folder', icon: <FolderInput size={14} />, submenu: [
      ...folders.map((f) => ({ label: f.name, checked: s.folder === f.id, onClick: () => moveSession(s.projectId, f.id, null) })),
      ...(s.folder ? [{ label: 'No folder', onClick: () => moveSession(s.projectId, undefined, null) }] : []),
      { separator: true },
      { label: 'New folder…', icon: <FolderPlus size={14} />, onClick: () => { const id = addFolder(); moveSession(s.projectId, id, null); setRenaming(id) } }
    ] },
    { separator: true },
    { label: `Close ${entry?.title ?? 'session'}`, icon: <X size={14} />, onClick: () => closeSession(s.projectId) },
    { label: 'Close other sessions', disabled: sessions.length < 2, onClick: () => closeOtherSessions(s.projectId) }
  ]

  // ---- drag and drop
  const over = (e: DragEvent, target: Drop) => {
    const types = e.dataTransfer.types
    if (!types.includes(SESSION) && !types.includes(FOLDER)) return
    if (types.includes(FOLDER) && target?.kind === 'before') return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (JSON.stringify(target) !== JSON.stringify(drop)) setDrop(target)
  }
  const dropOn = (e: DragEvent, target: Drop, folder?: string) => {
    const session = e.dataTransfer.getData(SESSION)
    const folderId = e.dataTransfer.getData(FOLDER)
    if (!session && !folderId) return
    e.preventDefault()
    e.stopPropagation()
    setDrop(null)
    if (folderId) { moveFolder(folderId, target?.kind === 'folder' ? target.id : null); return }
    if (target?.kind === 'before') moveSession(session, folder, target.id)
    else if (target?.kind === 'folder') moveSession(session, target.id, null)
    else moveSession(session, undefined, null)
  }

  const item = (s: SessionTab) => {
    const entry = byId.get(s.projectId)
    const on = active === s.projectId
    const title = entry?.title ?? 'Loading…'
    return (
      <div key={s.projectId} className="relative animate-slidein">
        {drop?.kind === 'before' && drop.id === s.projectId && <div className="drop-line" />}
        <div role="button" tabIndex={0} draggable title={open ? undefined : title}
          className={cx('side-item group no-drag cursor-pointer', on && 'on', open ? 'w-full pl-2 pr-1 justify-start' : 'w-10 justify-center !px-0')}
          onClick={() => go({ name: 'studio', projectId: s.projectId })}
          onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'studio', projectId: s.projectId }) }}
          onContextMenu={(e) => openContextMenu(e, sessionMenu(s, entry))}
          onDragStart={(e) => { e.dataTransfer.setData(SESSION, s.projectId); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => setDrop(null)}
          onDragOver={(e) => over(e, { kind: 'before', id: s.projectId })}
          onDrop={(e) => dropOn(e, { kind: 'before', id: s.projectId }, s.folder)}>
          <Artwork id={s.projectId} artwork={entry?.artwork ?? null} title={title} size={open ? 24 : 28} className={cx('shrink-0 transition-transform group-hover:scale-105', on && 'ring-2 ring-accent/70')} />
          {open && <>
            <span className="flex-1 min-w-0 text-left">
              <span className="block truncate text-[12.5px] leading-tight">{title}</span>
              <span className="flex items-center gap-1 text-[10.5px] text-faint leading-tight">
                {entry?.kind === 'composition' ? <PenLine size={9} /> : <AudioLines size={9} />}
                {entry?.kind === 'composition' ? 'Composition' : 'Transcription'}
              </span>
            </span>
            <button className="icon-btn !h-6 !w-6 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Close session" aria-label={`Close ${title}`}
              onClick={(e) => { e.stopPropagation(); closeSession(s.projectId) }}><X size={12} /></button>
          </>}
        </div>
      </div>
    )
  }

  const loose = sessions.filter((s) => !s.folder || !folders.some((f) => f.id === s.folder))

  return (
    <nav className={cx('sidebar relative z-20 shrink-0 flex flex-col pt-3 pb-2 drag transition-[width] duration-300 ease-out', open ? 'w-[228px] px-2.5' : 'w-[64px] px-3 items-center')}>
      <div className={cx('flex items-center gap-2.5 mb-4 no-drag', open ? 'px-1.5' : 'justify-center')}>
        <div className="logo-chip h-9 w-9 shrink-0 rounded-xl flex items-center justify-center text-accent" title="Aurel"><Logo /></div>
        {open && <span className="font-display text-[19px] tracking-tight animate-fadein">Aurel</span>}
      </div>
      <div className={cx('flex flex-col gap-1', !open && 'items-center')}>
        <NavItem open={open} on={route.name === 'home'} icon={<HomeIcon size={18} strokeWidth={1.8} />} label="Home" onClick={() => go({ name: 'home' })} />
        <NavItem open={open} on={route.name === 'library'} icon={<LibraryIcon size={18} strokeWidth={1.8} />} label="Library" onClick={() => go({ name: 'library' })} />
      </div>

      <div className={cx('mt-5 mb-1.5 flex items-center no-drag', open ? 'px-2' : 'justify-center')}>
        {open ? <>
          <span className="label flex-1">Sessions</span>
          <button className="icon-btn !h-6 !w-6" title="New folder" aria-label="New folder" onClick={() => setRenaming(addFolder())}><FolderPlus size={13} /></button>
          <button className="icon-btn !h-6 !w-6" title="New composition" aria-label="New composition" onClick={() => useApp.getState().setDialog('new')}><Plus size={13} /></button>
        </> : <div className="h-px w-6 bg-line" />}
      </div>

      <div className={cx('flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-drag -mx-1 px-1 pb-4 flex flex-col gap-0.5', !open && 'items-center')}
        onDragOver={(e) => over(e, { kind: 'end' })} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrop(null) }} onDrop={(e) => dropOn(e, { kind: 'end' })}>
        {!sessions.length && !folders.length && open && (
          <p className="px-2 py-2 text-[11.5px] text-faint leading-relaxed">Pieces you open stay here, so you can switch between them. Drag to reorder or into folders.</p>
        )}
        {folders.map((f) => {
          const inside = sessions.filter((s) => s.folder === f.id)
          const target = drop?.kind === 'folder' && drop.id === f.id
          return (
            <div key={f.id} className={cx('rounded-lg transition-colors', target && 'bg-accent/10 ring-1 ring-accent/50')}
              onDragOver={(e) => over(e, { kind: 'folder', id: f.id })} onDrop={(e) => dropOn(e, { kind: 'folder', id: f.id })}>
              <div role="button" tabIndex={0} draggable={renaming !== f.id} title={open ? undefined : f.name}
                className={cx('side-item !h-8 group cursor-pointer text-muted', open ? 'w-full px-2 justify-start' : 'w-10 justify-center')}
                onClick={() => toggleFolder(f.id)} onDoubleClick={() => open && setRenaming(f.id)}
                onContextMenu={(e) => openContextMenu(e, folderMenu(f))}
                onDragStart={(e) => { e.dataTransfer.setData(FOLDER, f.id); e.dataTransfer.effectAllowed = 'move' }}>
                {open && <ChevronRight size={13} className={cx('shrink-0 transition-transform duration-200', !f.collapsed && 'rotate-90')} />}
                {f.collapsed ? <Folder size={15} className="shrink-0 text-accent/80" /> : <FolderOpen size={15} className="shrink-0 text-accent/80" />}
                {open && (renaming === f.id
                  ? <input autoFocus defaultValue={f.name} className="field !h-6 !px-1.5 !text-[12px]" onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => { renameFolder(f.id, e.currentTarget.value); setRenaming(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} />
                  : <><span className="flex-1 truncate text-left text-[12.5px] font-medium text-fg/90">{f.name}</span><span className="text-[10.5px] text-faint tabular-nums pr-1">{inside.length}</span></>)}
              </div>
              <div className={cx('grid transition-[grid-template-rows] duration-300 ease-out', f.collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}>
                <div className={cx('overflow-hidden flex flex-col gap-0.5', open && 'pl-3 ml-2 border-l border-line/70', !open && 'items-center')}>
                  {inside.map(item)}
                  {!inside.length && open && <div className="text-[11px] text-faint px-2 py-1">Drag pieces here</div>}
                </div>
              </div>
            </div>
          )
        })}
        {loose.map(item)}
        {drop?.kind === 'end' && <div className="drop-line relative" />}
      </div>

      <div className={cx('flex flex-col gap-1 pt-2 border-t border-line/60 no-drag', !open && 'items-center')}>
        <NavItem open={open} on={route.name === 'settings'} icon={<SettingsIcon size={18} strokeWidth={1.8} />} label="Settings" onClick={() => go({ name: 'settings' })} />
        <div className={cx('flex items-center', open ? 'justify-between px-1' : 'flex-col gap-1')}>
          <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted hover:bg-fg/[0.06] hover:text-accent tabular-nums"
            title="Check for updates" aria-label="Check for updates" onClick={onCheckUpdates}>
            <RefreshCw size={10} className={cx(checking && 'animate-spin')} /><span>v{version}</span>
          </button>
          <button className="icon-btn !h-7 !w-7" title={open ? 'Collapse sidebar' : 'Expand sidebar'} aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
            onClick={() => void updateSettings({ sidebarOpen: !open })}>
            {open ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
        </div>
      </div>
    </nav>
  )
}
