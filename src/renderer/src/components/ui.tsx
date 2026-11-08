import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { api } from '@/lib/api'

export function cx(...c: (string | false | null | undefined)[]): string { return c.filter(Boolean).join(' ') }

export function Modal({ open, onClose, title, children, width = 520, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  // Rendered at the top of the page: inside a blurred or animated panel, "fixed" would only cover that panel.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 backdrop-blur-[4px] animate-overlay" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" className="card shadow-2xl max-h-[88vh] max-w-[calc(100vw-32px)] flex flex-col animate-pop" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="font-display text-[19px] font-medium">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 pb-4 overflow-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>, document.body
  )
}

export function Slider({ value, min, max, step = 0.01, onChange, className, title }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; className?: string; title?: string }) {
  const pct = ((value - min) / (max - min)) * 100
  return <input type="range" className={cx('slider', className)} title={title} aria-label={title} min={min} max={max} step={step} value={value} style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => onChange(+e.target.value)} />
}

export function Toggle({ on, onChange, label, ariaLabel, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode; ariaLabel?: string; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2.5 select-none', disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}>
      <button type="button" role="switch" disabled={disabled} aria-label={ariaLabel} aria-checked={on} onClick={() => onChange(!on)} className={cx('toggle relative h-[18px] w-8 rounded-full transition-colors duration-200', on ? 'bg-accent on' : 'bg-fg/15')}>
        <span className={cx('absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform duration-200 ease-[cubic-bezier(.3,1.5,.6,1)]', on ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
      </button>
      {label && <span className="text-[13px]">{label}</span>}
    </label>
  )
}

export function Progress({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cx('h-1.5 rounded-full bg-fg/10 overflow-hidden', className)}>
      {pct < 0 ? <div className="h-full w-1/3 rounded-full bg-accent indet" /> : <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(pct * 100)}%` }} />}
    </div>
  )
}

function hashHue(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }

export function Artwork({ id, artwork, title, size = 44, className }: { id: string; artwork: string | null; title: string; size?: number; className?: string }) {
  const [err, setErr] = useState(false)
  const hue = hashHue(id)
  if (artwork && !err) return <img src={api.project.url(id, artwork)} onError={() => setErr(true)} className={cx('object-cover rounded-lg bg-raised', className)} style={{ width: size, height: size }} alt="" draggable={false} />
  const initials = title.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  return (
    <div className={cx('rounded-lg flex items-center justify-center font-display text-white/90', className)} style={{ width: size, height: size, fontSize: size * 0.34, background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${(hue + 50) % 360} 50% 28%))` }}>
      {initials || '♪'}
    </div>
  )
}

export function moveMenuFocus(event: React.KeyboardEvent, buttons: HTMLElement[], horizontal = true): void {
  if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || !buttons.length) return
  const index = buttons.indexOf(document.activeElement as HTMLElement)
  let next: number
  if (event.key === "Home") next = 0
  else if (event.key === "End") next = buttons.length - 1
  else if (event.key === "ArrowDown" || (horizontal && event.key === "ArrowRight")) next = (index + 1) % buttons.length
  else if (event.key === "ArrowUp" || (horizontal && event.key === "ArrowLeft")) next = (index < 0 ? buttons.length - 1 : (index + buttons.length - 1) % buttons.length)
  else return
  event.preventDefault()
  event.stopPropagation()
  buttons[next].focus()
}

export function Popover({ trigger, children, align = 'left', side = 'bottom', width = 240 }: { trigger: (open: () => void, isOpen: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; side?: 'top' | 'bottom'; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const target = e.target as Element
      const selectId = target.closest<HTMLElement>('[data-select-popup]')?.dataset.selectPopup
      if (!ref.current?.contains(target) && !(selectId && ref.current?.contains(document.getElementById(selectId)))) setOpen(false)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', key) }
  }, [open])
  const panel = useRef<HTMLDivElement>(null)
  return (
    <div className="relative" ref={ref} data-keyboard-menu={open ? "" : undefined} onKeyDown={(event) => {
      if (open && panel.current) moveMenuFocus(event, Array.from(panel.current.querySelectorAll("button:not(:disabled)")))
    }}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div ref={panel} className={cx('absolute z-40 card shadow-xl p-1.5', side === 'top' ? 'animate-pop-up' : 'animate-pop-down', side === 'top' ? 'bottom-full mb-1.5 max-h-[65vh] overflow-y-auto' : 'mt-1.5', align === 'right' ? 'right-0' : 'left-0')} style={{ width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, hint }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; hint?: string }) {
  return (
    <button className={cx('w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] text-left hover:bg-fg/[0.07]', danger ? 'text-bad' : 'text-fg')} onClick={onClick}>
      {icon && <span className="text-muted">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-faint text-[11px]">{hint}</span>}
    </button>
  )
}

export function Confidence({ value }: { value: number }) {
  const tone = value >= 0.7 ? 'text-ok bg-ok/10' : value >= 0.45 ? 'text-warn bg-warn/10' : 'text-bad bg-bad/10'
  return <span className={cx('chip !h-[18px] !px-1.5 !text-[10px] tabular-nums', tone)} title="AI classification confidence">{Math.round(value * 100)}%</span>
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function relTime(ts: number): string {
  if (!ts) return 'never'
  const d = (Date.now() - ts) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`
  return new Date(ts).toLocaleDateString()
}
