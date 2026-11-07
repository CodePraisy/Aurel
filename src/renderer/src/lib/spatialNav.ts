/**
 * Arrow keys move focus to the nearest control in that direction, everywhere in the app
 * (cards, lists, settings rows, dialogs), the way a TV or game console menu works.
 *
 * Places that already use the arrows (the score, menus, pickers, sliders, text fields) handle
 * the key first and stop it, so this only runs where the arrows would otherwise do nothing.
 */

const FOCUSABLE = 'button:not(:disabled), a[href], [role="button"], [role="tab"], [role="option"], [role="menuitem"], input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled), [tabindex]:not([tabindex="-1"])'

type Dir = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[aria-hidden="true"], [inert]')
}

/** Where focus may go: the open dialog if there is one, else the whole window. */
function scope(from: Element | null): ParentNode {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]')).filter(visible)
  const own = from?.closest('[role="dialog"], [aria-modal="true"], [data-nav-scope]')
  return own ?? dialogs.at(-1) ?? document
}

/** Where the pointer last went down: with nothing focused, the arrows start from there. */
let lastPointer: { x: number; y: number } | null = null

export function nextInDirection(from: HTMLElement | null, dir: Dir, root: ParentNode = scope(from)): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el !== from && visible(el))
  if (!from) {
    if (!lastPointer) return all.find((el) => !el.closest('nav')) ?? all[0] ?? null
    const { x, y } = lastPointer
    const dist = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)) }
    return all.reduce<HTMLElement | null>((b, el) => (!b || dist(el) < dist(b) ? el : b), null)
  }
  const a = from.getBoundingClientRect()
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of all) {
    if (from.contains(el) || el.contains(from)) continue
    const b = el.getBoundingClientRect()
    const bx = b.left + b.width / 2, by = b.top + b.height / 2
    // distance along the arrow, and how far off the line it is (overlapping rows/columns count as on it)
    let along: number, off: number
    if (dir === 'ArrowRight') { along = b.left - a.right; off = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) ? Math.abs(by - ay) : 0 }
    else if (dir === 'ArrowLeft') { along = a.left - b.right; off = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) ? Math.abs(by - ay) : 0 }
    else if (dir === 'ArrowDown') { along = b.top - a.bottom; off = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)) ? Math.abs(bx - ax) : 0 }
    else { along = a.top - b.bottom; off = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)) ? Math.abs(bx - ax) : 0 }
    // must lie in that direction (a little overlap is fine: tight grids touch)
    const centreAhead = dir === 'ArrowRight' ? bx > ax + 2 : dir === 'ArrowLeft' ? bx < ax - 2 : dir === 'ArrowDown' ? by > ay + 2 : by < ay - 2
    if (!centreAhead || along < -Math.min(a.width, a.height) / 2) continue
    const score = Math.max(0, along) + off * 2.5
    if (score < bestScore) { bestScore = score; best = el }
  }
  return best
}

export function installSpatialNav(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    const active = document.activeElement as HTMLElement | null
    const t = (e.target as HTMLElement | null) ?? active
    if (t?.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable], [role="slider"], [data-select-popup], [data-context-menu], [data-score-keys]')) return
    // a focused container (a panel, the menu itself) is not a place to move from: start near the pointer
    const from = active && active !== document.body && active.matches(FOCUSABLE) ? active : null
    const next = nextInDirection(from, e.key as Dir)
    if (!next) return
    e.preventDefault()
    next.focus({ preventScroll: false })
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const onPointer = (e: PointerEvent) => { lastPointer = { x: e.clientX, y: e.clientY } }
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onPointer, true)
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointer, true) }
}
