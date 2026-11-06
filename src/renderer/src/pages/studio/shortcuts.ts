import { useEffect } from 'react'
import { PPQ } from '@shared/types'
import { useProject } from '@/store/project'
import { player } from '@/audio/player'
import { isFretted } from '@/music/theory'
import { useApp } from '@/store/app'

export const CHORD_SHORTCUT = 'Alt+C'

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  { group: 'Playback', items: [['Space', 'Play / pause'], ['Home', 'Back to start (or loop start)'], ['L', 'Loop selected measures'], ['M', 'Metronome'], ['[ ]', 'Speed −/+ 5%']] },
  { group: 'Note entry', items: [['A … G', 'Enter note at cursor'], [CHORD_SHORTCUT, 'Toggle Chord mode'], ['Shift A … G', 'Add note to chord'], ['0', 'Enter rest'], ['3 4 5 6 7', '16th, 8th, quarter, half, whole'], ['2', '32nd'], ['.', 'Toggle dot'], ['T', 'Toggle tie'], ['0 … 24 (tab)', 'Fret on the selected string'], ['Alt ↑ ↓ (tab)', 'Choose string']] },
  { group: 'Editing', items: [['Ctrl / Cmd S', 'Save project'], ['Shift+click a note', 'Select a range of notes on the staff'], ['Ctrl+click a note', 'Add or remove a note from the selection'], ['↑ ↓', 'Pitch up / down a semitone'], ['Ctrl ↑ ↓', 'Octave up / down'], ['← →', 'Previous / next note'], ['Ctrl ← →', 'Previous / next measure'], ['Shift ← →', 'Extend measure selection'], ['Delete', 'Delete selected notes or measures (Settings → Editor picks rest or shift back)'], ['Shift Delete', 'Delete the other way: shift back or leave a rest'], ['Drag a note', 'Move it (up/down changes pitch); Ctrl+drag copies'], ['Ctrl C / V', 'Copy / paste notes or measures'], ['Ctrl D', 'Duplicate measures'], ['Ctrl Z / Y', 'Undo / redo'], ['Ctrl Enter', 'Insert measure after']] },
  { group: 'View', items: [['Ctrl + / −', 'Zoom'], ['Ctrl 1 2 3', 'Sheet, tab, both']] }
]

const DUR_KEYS: Record<string, number> = { '2': PPQ / 8, '3': PPQ / 4, '4': PPQ / 2, '5': PPQ, '6': PPQ * 2, '7': PPQ * 4 }

export function useStudioKeys(enabled: boolean, onToggleLoop: () => void): void {
  useEffect(() => {
    if (!enabled) return
    let fretBuf = ''
    let fretAt = 0
    let fretState: { cursor: ReturnType<typeof useProject.getState>['cursor']; sel: string | null } | null = null
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], [data-keyboard-menu], [data-context-menu], [data-select-popup]')) return
      const st = useProject.getState()
      const p = st.project
      if (!p) return
      const part = p.score.parts.find((x) => x.id === st.cursor?.partId)
      const mode = p.view?.mode ?? 'both'
      const tabEntry = !!part && isFretted(part.kind) && mode !== 'staff'
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key
      const handled = () => { e.preventDefault(); e.stopPropagation() }

      if (k === ' ') { handled(); if (!e.repeat) player.toggle(); return }
      if (k === 'Home') { handled(); player.stop(); return }
      if (ctrl && k.toLowerCase() === 'z') { handled(); if (e.shiftKey) st.redo(); else st.undo(); return }
      if (ctrl && k.toLowerCase() === 'y') { handled(); st.redo(); return }
      if (ctrl && k.toLowerCase() === 'c') { handled(); st.copy(); return }
      if (ctrl && k.toLowerCase() === 'v') { handled(); st.paste(); return }
      if (ctrl && k.toLowerCase() === 'd') { handled(); st.duplicate(); return }
      if (ctrl && k === 'Enter') { handled(); st.addMeasures((st.cursor?.measure ?? 0) + 1); return }
      if (ctrl && (k === '=' || k === '+')) { handled(); st.setView({ zoom: Math.min(2, +((p.view?.zoom ?? 1) + 0.1).toFixed(2)) }); return }
      if (ctrl && k === '-') { handled(); st.setView({ zoom: Math.max(0.5, +((p.view?.zoom ?? 1) - 0.1).toFixed(2)) }); return }
      if (ctrl && ['1', '2', '3'].includes(k)) { handled(); st.setView({ mode: (['staff', 'tab', 'both'] as const)[+k - 1] }); return }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        handled()
        const dir = k === 'ArrowLeft' ? -1 : 1
        if (e.shiftKey && st.cursor) {
          const r = st.range ?? { from: st.cursor.measure, to: st.cursor.measure }
          const anchor = st.cursor.measure === r.from && r.to !== r.from ? r.to : r.from
          const edge = (r.from === anchor ? r.to : r.from) + dir
          const max = p.score.parts[0].measures.length - 1
          const ne = Math.max(0, Math.min(max, edge))
          st.setRange({ from: Math.min(anchor, ne), to: Math.max(anchor, ne) })
          return
        }
        st.setRange(null)
        st.move(dir, ctrl)
        return
      }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        handled()
        const dir = k === 'ArrowUp' ? 1 : -1
        if (tabEntry && e.altKey && part) {
          const n = part.tuning?.length ?? 6
          useProject.setState({ tabString: Math.max(1, Math.min(n, st.tabString - dir)) })
          return
        }
        st.transposeSel(dir * (ctrl ? 12 : 1))
        return
      }
      if (k === 'Delete' || k === 'Backspace') {
        handled()
        // Shift+Delete does the other kind of delete (rest ↔ shift back)
        const mode = useApp.getState().settings?.deleteMode ?? 'rest'
        st.deleteSel(e.shiftKey ? (mode === 'rest' ? 'shift' : 'rest') : mode)
        return
      }
      if (k === 'Escape') { st.setRange(null); st.clearNoteSelection(); return }
      if (e.altKey && !ctrl && !e.shiftKey && e.code === 'KeyC') {
        handled()
        if (!e.repeat) st.toggleChordMode()
        return
      }
      if (ctrl || e.altKey) return
      if (k === '.') { handled(); st.toggleDot(); return }
      if (k.toLowerCase() === 't') { handled(); st.toggleTie(); return }
      if (k.toLowerCase() === 'l') { handled(); onToggleLoop(); return }
      if (k.toLowerCase() === 'm') { handled(); player.setOptions({ metronome: !player.opts.metronome }); return }
      if (k === '[' || k === ']') { handled(); player.setOptions({ speed: Math.max(0.25, Math.min(2, +(player.opts.speed + (k === ']' ? 0.05 : -0.05)).toFixed(2))) }); return }
      if (/^[0-9]$/.test(k)) {
        handled()
        if (tabEntry) {
          const now = Date.now()
          if (fretBuf && fretState && now - fretAt < 700 && +(fretBuf + k) <= 24) {
            fretBuf += k
            st.undo()
            useProject.setState({ cursor: fretState.cursor, sel: fretState.sel })
          } else {
            fretBuf = k
            fretState = { cursor: st.cursor, sel: st.sel }
          }
          fretAt = now
          useProject.getState().setFret(+fretBuf)
          return
        }
        if (k === '0') { st.enterRest(); return }
        if (DUR_KEYS[k]) st.setDur(DUR_KEYS[k])
        return
      }
      if (/^[a-gA-G]$/.test(k)) { handled(); st.enterLetter(k.toUpperCase(), e.shiftKey); return }
    }
    // Space must always mean play/pause: catch it before focused buttons turn it into a click
    const ku = (e: KeyboardEvent) => {
      if (e.key !== ' ' || (e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
      e.preventDefault()
      e.stopPropagation()
    }
    const blurButtons = () => { const a = document.activeElement as HTMLElement | null; if (a && a.tagName === 'BUTTON') a.blur() }
    window.addEventListener('keydown', h, true)
    window.addEventListener('keyup', ku, true)
    window.addEventListener('mouseup', blurButtons)
    return () => { window.removeEventListener('keydown', h, true); window.removeEventListener('keyup', ku, true); window.removeEventListener('mouseup', blurButtons) }
  }, [enabled, onToggleLoop])
}
