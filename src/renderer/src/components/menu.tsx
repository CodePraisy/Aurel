import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { cx, moveMenuFocus } from './ui'

export interface MenuEntry {
  label?: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  onClick?: () => void
  submenu?: MenuEntry[]
  separator?: boolean
}

const useMenu = create<{ menu: { x: number; y: number; items: MenuEntry[] } | null; open(x: number, y: number, items: MenuEntry[]): void; close(): void }>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null })
}))

/** Open a context menu at the mouse position. */
export function openContextMenu(e: React.MouseEvent | MouseEvent, items: MenuEntry[]): void {
  e.preventDefault()
  e.stopPropagation()
  useMenu.getState().open(e.clientX, e.clientY, items)
}

const TITLE_BAR = 42
const WINDOW_BUTTONS = 150

function MenuList({ items, x, y, onDone, leftOf, onBack, focusFirst = true }: { items: MenuEntry[]; x: number; y: number; onDone: () => void; leftOf?: number; onBack?: () => void; focusFirst?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
  const [pos, setPos] = useState({ x: x / zoom, y: y / zoom })
  const [sub, setSub] = useState<{ i: number; x: number; y: number; leftOf: number; focus: boolean } | null>(null)
  const [shown, setShown] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Work in screen pixels from the menu's real size, so UI scaling cannot push it off-screen.
    const width = el.offsetWidth * zoom, height = el.offsetHeight * zoom
    const W = window.innerWidth, H = window.innerHeight
    let nx = x, ny = y
    if (nx + width > W - 8) nx = leftOf === undefined ? x - width : leftOf - width - 4
    if (ny + height > H - 8) ny = Math.max(8, H - height - 8)
    nx = Math.max(8, Math.min(nx, W - width - 8))
    // keep clear of the window buttons drawn over the top-right corner on Windows
    if (ny < TITLE_BAR && nx + width > W - WINDOW_BUTTONS) ny = TITLE_BAR
    setPos({ x: nx / zoom, y: ny / zoom })
    setShown(true)
  }, [x, y, leftOf, zoom])
  useLayoutEffect(() => { if (shown && focusFirst) ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus() }, [shown, focusFirst])
  const openSub = (button: HTMLButtonElement, i: number, focus: boolean) => {
    const bounds = ref.current!.getBoundingClientRect()
    setSub({ i, x: bounds.right + 4, y: button.getBoundingClientRect().top - 6, leftOf: bounds.left, focus })
  }
  return (
    <>
      <div ref={ref} data-context-menu role="menu" className={cx('fixed z-[140] min-w-[210px] max-w-[300px] card shadow-2xl p-1.5 overflow-auto', shown ? 'animate-pop-menu' : 'invisible')} style={{ left: pos.x, top: pos.y, maxHeight: (window.innerHeight - 16) / zoom }} onContextMenu={(e) => e.preventDefault()} onKeyDown={(event) => {
        const button = document.activeElement as HTMLButtonElement
        const index = Number(button.dataset.menuIndex)
        if (event.key === "ArrowRight" && items[index]?.submenu) { event.preventDefault(); openSub(button, index, true); return }
        if (event.key === "ArrowLeft" && onBack) { event.preventDefault(); onBack(); return }
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) setSub(null)
        moveMenuFocus(event, Array.from(ref.current!.querySelectorAll("button:not(:disabled)")), false)
      }}>
        {items.map((it, i) => it.separator ? <div key={i} className="h-px bg-line my-1" /> : (
          <button key={i} role="menuitem" data-menu-index={i} aria-haspopup={it.submenu ? "menu" : undefined} aria-expanded={it.submenu ? sub?.i === i : undefined} disabled={it.disabled}
            className={cx('w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] text-left disabled:opacity-40', it.danger ? 'text-bad hover:bg-bad/10' : 'text-fg hover:bg-fg/[0.07]', sub?.i === i && 'bg-fg/[0.07]')}
            onMouseEnter={(event) => { if (it.submenu) openSub(event.currentTarget, i, false); else setSub(null) }}
            onClick={(event) => { if (it.submenu) openSub(event.currentTarget, i, true); else { it.onClick?.(); onDone() } }}>
            <span className="w-4 flex justify-center text-muted">{it.checked ? <Check size={14} className="text-accent" /> : it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-faint text-[11px]">{it.hint}</span>}
            {it.submenu && <ChevronRight size={13} className="text-faint" />}
          </button>
        ))}
      </div>
      {sub && items[sub.i]?.submenu && <MenuList items={items[sub.i].submenu!} x={sub.x} y={sub.y} onDone={onDone} leftOf={sub.leftOf} focusFirst={sub.focus} onBack={() => {
        ref.current?.querySelectorAll<HTMLButtonElement>("[data-menu-index]").forEach((button) => { if (Number(button.dataset.menuIndex) === sub.i) button.focus() })
        setSub(null)
      }} />}
    </>
  )
}

export function ContextMenuHost() {
  const { menu, close } = useMenu()
  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-context-menu]')) close() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const t = setTimeout(() => { window.addEventListener('mousedown', down); window.addEventListener('contextmenu', down) })
    window.addEventListener('keydown', key)
    window.addEventListener('blur', close)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', down); window.removeEventListener('contextmenu', down); window.removeEventListener('keydown', key); window.removeEventListener('blur', close) }
  }, [menu, close])
  if (!menu) return null
  return createPortal(<MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} onDone={close} />, document.body)
}

/** Themed replacement for <select>, whose native popup ignores the app theme on Windows. */
export function Select<T extends string | number>({ value, options, onChange, className, width, title }: { value: T; options: { value: T; label: ReactNode; hint?: string }[]; onChange: (v: T) => void; className?: string; width?: number; title?: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !listRef.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [open])
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const place = () => {
      if (!ref.current || !listRef.current) return
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
      const r = ref.current.getBoundingClientRect()
      const below = (window.innerHeight - r.bottom) / zoom
      const above = r.top / zoom
      const height = Math.min(280, listRef.current.scrollHeight + 2)
      const up = below < height + 8 && above > below
      const width = Math.min(window.innerWidth / zoom - 16, Math.max(160, r.width / zoom))
      const left = Math.max(8, Math.min(r.left / zoom, window.innerWidth / zoom - width - 8))
      const position = up ? { bottom: below + r.height / zoom + 4 } : { top: r.bottom / zoom + 4 }
      setRect({ ...position, left, width, maxHeight: Math.max(36, Math.min(height, (up ? above : below) - 8)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('animationend', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('animationend', place, true)
    }
  }, [open])
  useLayoutEffect(() => {
    if (open && rect && document.activeElement === ref.current?.querySelector("button")) {
      (listRef.current?.querySelector<HTMLButtonElement>('[data-sel="1"]') ?? listRef.current?.querySelector("button"))?.focus()
    }
  }, [open, rect])
  const cur = options.find((o) => o.value === value)
  return (
    <div id={id} data-keyboard-menu="" ref={ref} className={cx('relative', className)} style={{ width }} title={title}>
      <button type="button" className="field flex items-center justify-between gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        if (!open) { setOpen(true); return }
        const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button")
        if (buttons?.length) (listRef.current?.querySelector<HTMLButtonElement>('[data-sel="1"]') ?? buttons[0]).focus()
      }}>
        <span className="truncate">{cur?.label ?? String(value)}</span>
        <ChevronDown size={14} className={cx('text-muted shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && createPortal(
        <div ref={listRef} data-select-popup={id} className="fixed z-[120] card shadow-2xl p-1 overflow-auto animate-fadein" onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setOpen(false); ref.current?.querySelector("button")?.focus(); return }
          moveMenuFocus(event, Array.from(listRef.current!.querySelectorAll("button")))
        }} style={rect ?? { visibility: 'hidden' }}>
          {options.map((o) => (
            <button key={String(o.value)} type="button" data-sel={o.value === value ? '1' : '0'}
              className={cx('w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-[13px] text-left', o.value === value ? 'bg-accent/15 text-accent' : 'text-fg hover:bg-fg/[0.07]')}
              onClick={(event) => { onChange(o.value); setOpen(false); if (event.detail === 0) ref.current?.querySelector("button")?.focus() }}>
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="text-[11px] text-faint">{o.hint}</span>}
            </button>
          ))}
        </div>, document.body
      )}
    </div>
  )
}
