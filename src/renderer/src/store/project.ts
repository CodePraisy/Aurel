import { create } from 'zustand'
import type { Articulation, Dynamic, InstrumentKind, Measure, NoteEvent, Part, Project, Score, Technique, ViewMode } from '@shared/types'
import { PPQ } from '@shared/types'
import { api } from '@/lib/api'
import { measureTicks, pitchFromLetter, isFretted, INSTRUMENTS, durInfo } from '@/music/theory'
import {
  overwrite, cloneMeasure, insertMeasures, deleteMeasures, transposePart, defaultPart, pianoParts, toggleIn,
  emptyMeasure, measureCount, normalizeMeasure, uid, rippleDelete, moveEvent, findEvent, setMeasureCount
} from '@/music/score'
import { pitchAt } from '@/music/tab'
import { player } from '@/audio/player'
import { soundLabel, DEFAULT_SOUND, type SoundId } from '@/audio/synth'
import { useApp } from './app'

export interface Cursor { partId: string; measure: number; tick: number }
interface NoteSelection { partId: string; anchor: string; ids: string[] }

interface EditorState {
  project: Project | null
  past: Score[]
  future: Score[]
  saving: boolean
  savedAt: number
  cursor: Cursor | null
  sel: string | null // selected event id
  noteSelection: NoteSelection | null
  range: { from: number; to: number } | null // measure selection
  dur: number
  dotted: boolean
  tabString: number
  clipboard: { measures: Measure[] } | { notes: NoteEvent[] } | null
  rackPart: string | null // part whose sound & effects rack is open
  inputMode: 'write' | 'play' // on-screen piano, fretboard and MIDI keyboard: write notes or just play sounds
  chordMode: boolean // entered notes stack onto the current chord until you move on
  setInputMode(m: 'write' | 'play'): void
  toggleChordMode(): void
  /** A note from the piano / MIDI keyboard / fretboard: written or just heard depending on inputMode. */
  inputNote(pitch: number, opts?: { chord?: boolean; pos?: { string: number; fret: number }; velocity?: number; silent?: boolean }): void
  load(id: string): Promise<void>
  close(): void
  save(): Promise<void>
  setMetadata(patch: Partial<Pick<Score, 'title' | 'composer'>>): void
  replace(p: Project): void
  edit(fn: (s: Score) => void): void
  patchProject(fn: (p: Project) => void, history?: boolean): void
  updatePart(id: string, patch: Partial<Part>): void
  undo(): void
  redo(): void
  setView(v: Partial<NonNullable<Project['view']>>): void
  select(partId: string, measure: number, eventId: string | null, tick?: number): void
  selectNotes(partId: string, eventId: string, mode: 'extend' | 'toggle'): void
  clearNoteSelection(): void
  setRange(r: { from: number; to: number } | null): void
  setDur(d: number): void
  toggleDot(): void
  move(dir: -1 | 1, byMeasure?: boolean): void
  enterPitch(pitch: number, chord?: boolean, pos?: { string: number; fret: number }): void
  enterLetter(letter: string, chord: boolean): void
  enterRest(): void
  deleteSel(mode?: 'rest' | 'shift'): void
  /** Drag and drop: move (or copy) a note to `measure`/`tick`, `steps` staff positions up or down. */
  moveNote(partId: string, eventId: string, measure: number, tick: number, steps: number, copy: boolean): void
  /** Set how many bars the piece has (removing bars from the end). */
  setBarCount(count: number): void
  transposeSel(semis: number): void
  setFret(fret: number): void
  toggleArt(a: Articulation): void
  toggleTech(t: Technique): void
  setDynamic(d: Dynamic | null): void
  toggleTie(): void
  copy(): void
  paste(): void
  duplicate(): void
  addMeasures(at: number, n?: number): void
  removeMeasures(): void
  addPart(kind: InstrumentKind, source?: Pick<Part, 'name' | 'vstInstrument'>): void
  removePart(id: string, removeGroup?: boolean): void
  movePart(id: string, dir: -1 | 1): void
  reorderPart(id: string, targetId: string, after: boolean): void
  drumToggle(measure: number, step: number, midi: number, steps: number): void
}

let saveTimer: number | null = null
const HISTORY = 200

function notePositions(part: Part) {
  return part.measures.flatMap((m, measure) => m.events.filter((e) => !e.rest).map((event) => ({ measure, event })))
}

function currentPart(s: EditorState): Part | undefined {
  return s.project?.score.parts.find((p) => p.id === s.cursor?.partId)
}

function findSel(s: EditorState): { part: Part; mi: number; ei: number; e: NoteEvent } | null {
  const part = currentPart(s)
  if (!part || !s.sel || !s.cursor) return null
  for (const mi of [s.cursor.measure, s.cursor.measure - 1]) {
    const ei = part.measures[mi]?.events.findIndex((e) => e.id === s.sel) ?? -1
    if (ei >= 0) return { part, mi, ei, e: part.measures[mi].events[ei] }
  }
  return null
}

/** Undo history and cursor of pieces open in the sidebar, kept while you look at another one. */
const sessionStash = new Map<string, { past: Score[]; future: Score[]; cursor: Cursor | null; sel: string | null }>()

export const useProject = create<EditorState>((set, get) => {
  let loadRequest = 0
  let editRevision = 0
  let saves = Promise.resolve()
  const save = () => {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    const project = get().project
    if (!project) return Promise.resolve()
    const revision = editRevision
    set({ saving: true })
    const task = saves.then(() => api.project.save({ ...project, score: { ...project.score, title: project.score.title.trim() || 'Untitled' }, updated: Date.now() }))
    saves = task.catch(() => undefined)
    return task.then(() => {
      if (get().project?.id === project.id && editRevision === revision) set({ saving: false, savedAt: Date.now() })
    })
  }
  const autoSave = () => void save().catch((error: Error) => {
    set({ saving: false })
    console.error('Aurel could not save the project', error)
  })
  const scheduleSave = () => {
    editRevision++
    set({ saving: true })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = window.setTimeout(autoSave, 600)
  }
  const commit = (project: Project, history = true) => {
    const prev = get().project
    set((st) => ({
      project,
      past: history && prev ? [...st.past.slice(-HISTORY + 1), prev.score] : st.past,
      future: history ? [] : st.future
    }))
    player.setProject(project)
    scheduleSave()
  }
  /** Run `fn` on a deep copy of the score and commit it as one undo step. */
  const editScore = (fn: (s: Score) => void) => {
    const p = get().project
    if (!p) return
    const score: Score = structuredClone(p.score)
    fn(score)
    commit({ ...p, score })
  }
  const mt = () => measureTicks(get().project!.score.timeSig)
  const curDur = () => {
    const { dur, dotted } = get()
    const d = dotted ? dur * 1.5 : dur
    return durInfo(d) ? d : dur
  }
  let quiet = false // the note is already sounding (held MIDI key), so entry stays silent
  const previewEvent = (part: Part, pitches: number[]) => {
    if (quiet) return
    const settings = (window as unknown as { __aurelSettings?: { noteInputPreview: boolean } }).__aurelSettings
    if (settings && !settings.noteInputPreview) return
    if (player.state === 'playing') return
    pitches.forEach((p) => player.preview(part, p, 90, 0.5))
  }
  const advance = (partId: string, measure: number, tick: number, len: number) => {
    let t = tick + len
    let m = measure
    const MT = mt()
    if (t >= MT) {
      m++
      t = 0
      if (m >= measureCount(get().project!.score)) editScore((s) => insertMeasures(s, m, 1))
    }
    const ev = get().project!.score.parts.find((p) => p.id === partId)!.measures[m].events.find((e) => e.start <= t && e.start + e.dur > t)
    set({ cursor: { partId, measure: m, tick: t }, sel: ev?.id ?? null })
  }

  return {
    project: null, past: [], future: [], saving: false, savedAt: 0,
    cursor: null, sel: null, noteSelection: null, range: null, dur: PPQ, dotted: false, tabString: 1, clipboard: null,
    inputMode: (window as unknown as { __aurelSettings?: { inputMode?: 'write' | 'play' } }).__aurelSettings?.inputMode ?? 'write',
    chordMode: false,
    rackPart: null,
    setInputMode: (m) => set({ inputMode: m }),
    toggleChordMode: () => set({ chordMode: !get().chordMode }),
    inputNote: (pitch, o = {}) => {
      const st = get()
      const part = currentPart(st)
      if (st.inputMode === 'play' || !part || !st.cursor) { player.preview(part ?? null, pitch, o.velocity ?? 96); return }
      quiet = !!o.silent
      try {
        if (o.pos) { useProject.setState({ tabString: o.pos.string }); get().setFret(o.pos.fret); return }
        get().enterPitch(pitch, o.chord)
      } finally { quiet = false }
    },

    load: async (id) => {
      const request = ++loadRequest
      await saves
      const p = await api.project.load(id)
      if (request !== loadRequest) return
      const kept = sessionStash.get(id)
      set({ project: p, past: kept?.past ?? [], future: kept?.future ?? [], cursor: null, sel: null, noteSelection: null, range: null, saving: false })
      player.setProject(p)
      // switching back to a session: same undo history and cursor as you left it
      if (kept?.cursor && p.score.parts.some((x) => x.id === kept.cursor!.partId) && kept.cursor.measure < measureCount(p.score)) {
        set({ cursor: kept.cursor, sel: kept.sel })
        return
      }
      const first = p.score.parts.find((x) => x.id === p.view?.part) ?? p.score.parts[0]
      if (first) {
        const e = first.measures[0]?.events[0]
        set({ cursor: { partId: first.id, measure: 0, tick: 0 }, sel: e?.id ?? null })
      }
    },
    close: () => {
      const st = get()
      if (st.project) {
        sessionStash.set(st.project.id, { past: st.past, future: st.future, cursor: st.cursor, sel: st.sel })
        if (sessionStash.size > 12) sessionStash.delete(sessionStash.keys().next().value!)
      }
      loadRequest++
      if (saveTimer !== null) autoSave()
      player.release()
      set({ project: null, past: [], future: [], cursor: null, sel: null, noteSelection: null, range: null, saving: false })
    },
    replace: (p) => { set({ project: p, past: [], future: [], noteSelection: null }); player.setProject(p) },
    save,
    setMetadata: (patch) => {
      const project = get().project
      if (!project) return
      set({ project: { ...project, score: { ...project.score, ...patch } } })
      scheduleSave()
    },
    edit: editScore,
    patchProject: (fn, history = false) => {
      const p = get().project
      if (!p) return
      const n = structuredClone(p)
      fn(n)
      commit(n, history)
    },
    updatePart: (id, patch) => {
      const p = get().project
      if (!p) return
      const old = p.score.parts.find((x) => x.id === id)
      if (old && !('name' in patch)) {
        const name = autoName(old, { ...old, ...patch }, patch)
        if (name) patch = { ...patch, name }
      }
      const parts = p.score.parts.map((x) => (x.id === id ? { ...x, ...patch } : x))
      commit({ ...p, score: { ...p.score, parts } }, false)
    },
    undo: () => {
      const { past, project, future } = get()
      if (!past.length || !project) return
      const score = past[past.length - 1]
      const np = { ...project, score }
      set({ past: past.slice(0, -1), future: [project.score, ...future], project: np })
      player.setProject(np)
      scheduleSave()
    },
    redo: () => {
      const { past, project, future } = get()
      if (!future.length || !project) return
      const np = { ...project, score: future[0] }
      set({ past: [...past, project.score], future: future.slice(1), project: np })
      player.setProject(np)
      scheduleSave()
    },
    setView: (v) => get().patchProject((p) => { p.view = { mode: 'both', zoom: 1, part: 'all', ...p.view, ...v } }),
    select: (partId, measure, eventId, tick) => {
      const part = get().project?.score.parts.find((p) => p.id === partId)
      const e = part?.measures[measure]?.events.find((x) => x.id === eventId)
      set({ cursor: { partId, measure, tick: tick ?? e?.start ?? 0 }, sel: eventId, noteSelection: null })
    },
    selectNotes: (partId, eventId, mode) => {
      const st = get()
      const part = st.project?.score.parts.find((p) => p.id === partId)
      if (!part) return
      const notes = notePositions(part)
      const clicked = notes.findIndex(({ event }) => event.id === eventId)
      if (clicked < 0) return
      const current = st.noteSelection?.partId === partId ? st.noteSelection : null
      const anchorId = current?.anchor ?? (st.cursor?.partId === partId ? st.sel : null)
      const anchor = notes.findIndex(({ event }) => event.id === anchorId)
      const from = anchor < 0 ? clicked : anchor
      const ids = new Set(current?.ids ?? (anchor >= 0 ? [notes[anchor].event.id] : []))
      if (mode === 'extend') {
        ids.clear()
        for (const { event } of notes.slice(Math.min(from, clicked), Math.max(from, clicked) + 1)) ids.add(event.id)
      } else if (ids.has(eventId)) ids.delete(eventId)
      else ids.add(eventId)
      const focus = ids.has(eventId) ? notes[clicked] : notes.find(({ event }) => ids.has(event.id))
      const pos = focus ?? notes[clicked]
      set({
        range: null,
        cursor: { partId, measure: pos.measure, tick: pos.event.start },
        sel: focus?.event.id ?? null,
        noteSelection: ids.size ? { partId, anchor: notes[from].event.id, ids: [...ids] } : null
      })
    },
    clearNoteSelection: () => set({ noteSelection: null }),
    setRange: (range) => set(range ? { range, noteSelection: null } : { range }),
    setDur: (dur) => {
      set({ dur, dotted: false })
      const st0 = get()
      const s = findSel(st0)
      // change the selected note only when the cursor sits on it (not right after entering it)
      if (s && !s.e.rest && st0.cursor && s.mi === st0.cursor.measure && s.e.start === st0.cursor.tick) {
        const d = dur
        editScore((sc) => {
          const part = sc.parts.find((p) => p.id === s.part.id)!
          const { measure, id } = overwrite(part.measures[s.mi], mt(), { ...s.e, id: s.e.id }, s.e.start, d)
          part.measures[s.mi] = measure
          set({ sel: id })
        })
      }
    },
    toggleDot: () => {
      const st = get()
      const s = findSel(st)
      set({ dotted: !st.dotted })
      if (s && !s.e.rest && st.cursor && s.mi === st.cursor.measure && s.e.start === st.cursor.tick) {
        const info = durInfo(s.e.dur)
        if (!info) return
        const nd = info.dotted ? info.base : info.base * 1.5
        editScore((sc) => {
          const part = sc.parts.find((p) => p.id === s.part.id)!
          part.measures[s.mi] = overwrite(part.measures[s.mi], mt(), s.e, s.e.start, nd).measure
        })
      }
    },
    move: (dir, byMeasure) => {
      const st = get()
      const part = currentPart(st)
      if (!part || !st.cursor) return
      if (st.noteSelection) set({ noteSelection: null })
      let { measure } = st.cursor
      if (byMeasure) {
        measure = Math.max(0, Math.min(part.measures.length - 1, measure + dir))
        const e = part.measures[measure].events[0]
        set({ cursor: { partId: part.id, measure, tick: 0 }, sel: e?.id ?? null })
        return
      }
      const evs = part.measures[measure].events
      let ei = evs.findIndex((e) => e.id === st.sel)
      if (ei < 0) ei = evs.findIndex((e) => e.start <= st.cursor!.tick && e.start + e.dur > st.cursor!.tick)
      ei += dir
      if (ei < 0) {
        if (measure === 0) return
        measure--
        ei = part.measures[measure].events.length - 1
      } else if (ei >= part.measures[measure].events.length) {
        if (measure >= part.measures.length - 1) return
        measure++
        ei = 0
      }
      const e = part.measures[measure].events[ei]
      set({ cursor: { partId: part.id, measure, tick: e.start }, sel: e.id })
    },
    enterPitch: (pitch, chord, pos) => {
      const st = get()
      const part = currentPart(st)
      if (!part || !st.cursor) return
      if (st.noteSelection) set({ noteSelection: null })
      const head = pos ? { pitch, string: pos.string, fret: pos.fret } : { pitch }
      const s = findSel(st)
      const atCursor = !!s && s.mi === st.cursor.measure && s.e.start === st.cursor.tick
      if (st.chordMode && s && !s.e.rest && atCursor && s.e.notes.some((n) => n.pitch === pitch)) {
        // in chord mode, entering a note that's already in the chord removes it
        if (s.e.notes.length > 1) editScore((sc) => { const e = sc.parts.find((x) => x.id === part.id)!.measures[s.mi].events[s.ei]; e.notes = e.notes.filter((n) => n.pitch !== pitch) })
        return
      }
      if ((chord || (st.chordMode && atCursor)) && s && !s.e.rest) {
        if (s.e.notes.some((n) => n.pitch === pitch)) return
        editScore((sc) => {
          const p = sc.parts.find((x) => x.id === part.id)!
          const e = p.measures[s.mi].events[s.ei]
          e.notes = [...e.notes.filter((n) => !pos || n.string !== pos.string), head]
        })
        previewEvent(part, [pitch])
        return
      }
      const { measure, tick, partId } = st.cursor
      const len = Math.min(curDur(), mt() - tick)
      let newId = ''
      editScore((sc) => {
        const p = sc.parts.find((x) => x.id === partId)!
        const r = overwrite(p.measures[measure], mt(), { notes: [head], velocity: 90 }, tick, len)
        p.measures[measure] = r.measure
        newId = r.id
      })
      previewEvent(part, [pitch])
      if (st.chordMode) { set({ sel: newId, cursor: { partId, measure, tick } }); return }
      advance(partId, measure, tick, len)
      set({ sel: newId })
    },
    enterLetter: (letter, chord) => {
      const st = get()
      const part = currentPart(st)
      if (!part || part.kind === 'drums' || !st.cursor) return
      const sel = findSel(st)
      const ref = sel && !sel.e.rest ? sel.e.notes[sel.e.notes.length - 1].pitch : lastPitchBefore(part, st.cursor.measure, st.cursor.tick) ?? defaultRef(part)
      let pitch = pitchFromLetter(letter, st.project!.score.keyFifths, ref)
      if (chord && sel && !sel.e.rest) { while (pitch <= ref) pitch += 12; if (pitch - ref > 12) pitch -= 12 }
      const [lo, hi] = INSTRUMENTS[part.kind].range
      while (pitch < lo) pitch += 12
      while (pitch > hi) pitch -= 12
      get().enterPitch(pitch, chord)
    },
    enterRest: () => {
      const st = get()
      if (!st.cursor) return
      const { measure, tick, partId } = st.cursor
      const len = Math.min(curDur(), mt() - tick)
      editScore((sc) => {
        const p = sc.parts.find((x) => x.id === partId)!
        p.measures[measure] = overwrite(p.measures[measure], mt(), { notes: [], velocity: 80, rest: true }, tick, len).measure
      })
      advance(partId, measure, tick, len)
    },
    deleteSel: (requested) => {
      const st = get()
      if (st.range) { get().removeMeasures(); return }
      const mode = requested ?? useApp.getState().settings?.deleteMode ?? 'rest'
      if (st.noteSelection) {
        const { partId, ids } = st.noteSelection
        const selected = new Set(ids)
        editScore((sc) => {
          const part = sc.parts.find((p) => p.id === partId)
          if (!part) return
          if (mode === 'shift') { rippleDelete(part, mt(), selected); return }
          part.measures = part.measures.map((m) => m.events.some((e) => selected.has(e.id))
            ? normalizeMeasure({ events: m.events.filter((e) => !selected.has(e.id)) }, mt()) : m)
        })
        set({ noteSelection: null, sel: null })
        return
      }
      const s = findSel(st)
      if (!s) return
      if (mode === 'shift') {
        // pull the following notes back; the cursor stays where the note was
        const at = s.mi * mt() + s.e.start
        editScore((sc) => {
          const p = sc.parts.find((x) => x.id === s.part.id)!
          rippleDelete(p, mt(), new Set([s.e.id]))
          const mi = Math.floor(at / mt())
          const ne = p.measures[mi]?.events.find((e) => e.start <= at - mi * mt() && e.start + e.dur > at - mi * mt())
          set({ sel: ne?.id ?? null, cursor: { partId: s.part.id, measure: mi, tick: ne?.start ?? 0 } })
        })
        return
      }
      if (s.e.rest) return
      editScore((sc) => {
        const p = sc.parts.find((x) => x.id === s.part.id)!
        const m = p.measures[s.mi]
        m.events.splice(s.ei, 1)
        p.measures[s.mi] = normalizeMeasure(m, mt())
        const ne = p.measures[s.mi].events.find((e) => e.start === s.e.start)
        set({ sel: ne?.id ?? null })
      })
    },
    moveNote: (partId, eventId, measure, tick, steps, copy) => {
      const p = get().project
      if (!p) return
      let id: string | null = null
      editScore((sc) => {
        const part = sc.parts.find((x) => x.id === partId)
        if (!part) return
        id = moveEvent(part, mt(), eventId, measure * mt() + tick, { steps: part.kind === 'drums' ? 0 : steps, keyFifths: sc.keyFifths, copy })
      })
      const part = get().project!.score.parts.find((x) => x.id === partId)
      const found = id && part ? findEvent(part, id) : null
      if (found && part) {
        const e = part.measures[found.mi].events[found.ei]
        set({ cursor: { partId, measure: found.mi, tick: e.start }, sel: e.id, noteSelection: null })
        if (steps) previewEvent(part, e.notes.map((n) => n.pitch))
      }
    },
    setBarCount: (count) => {
      const n = Math.max(1, Math.min(2000, Math.round(count)))
      editScore((sc) => setMeasureCount(sc, n))
      const c = get().cursor
      if (c && c.measure >= n) set({ cursor: { ...c, measure: n - 1, tick: 0 }, sel: null })
      const r = get().range
      if (r && r.to >= n) set({ range: r.from >= n ? null : { from: r.from, to: n - 1 } })
    },
    transposeSel: (semis) => {
      const st = get()
      if (st.noteSelection) {
        const { partId, ids } = st.noteSelection
        const selected = new Set(ids)
        editScore((sc) => {
          const part = sc.parts.find((p) => p.id === partId)
          if (!part || part.kind === 'drums') return
          for (const m of part.measures) for (const e of m.events) {
            if (selected.has(e.id)) e.notes = e.notes.map((n) => ({ pitch: Math.max(0, Math.min(127, n.pitch + semis)) }))
          }
        })
        return
      }
      if (st.range && st.cursor) {
        const r = st.range
        editScore((sc) => { const p = sc.parts.find((x) => x.id === st.cursor!.partId)!; transposePart(p, semis, r.from, r.to) })
        return
      }
      const s = findSel(st)
      if (!s || s.e.rest || s.part.kind === 'drums') return
      const pitches = s.e.notes.map((n) => n.pitch + semis)
      editScore((sc) => {
        const p = sc.parts.find((x) => x.id === s.part.id)!
        const e = p.measures[s.mi].events[s.ei]
        e.notes = e.notes.map((n) => ({ pitch: Math.max(0, Math.min(127, n.pitch + semis)) }))
      })
      previewEvent(s.part, pitches)
    },
    setFret: (fret) => {
      const st = get()
      const part = currentPart(st)
      if (!part || !isFretted(part.kind) || !st.cursor) return
      const string = st.tabString
      const pitch = pitchAt(part, string, fret)
      const s = findSel(st)
      if (s && !s.e.rest && s.e.start === st.cursor.tick) {
        // replace note on this string or add to chord
        const notes = s.e.notes.filter((n) => n.string !== string)
        editScore((sc) => {
          const p = sc.parts.find((x) => x.id === part.id)!
          p.measures[s.mi].events[s.ei].notes = [...notes.filter((n) => n.pitch !== pitch), { pitch, string, fret }]
        })
        previewEvent(part, [pitch])
        return
      }
      get().enterPitch(pitch, false, { string, fret })
    },
    toggleArt: (a) => {
      const s = findSel(get())
      if (!s || s.e.rest) return
      editScore((sc) => { const e = sc.parts.find((x) => x.id === s.part.id)!.measures[s.mi].events[s.ei]; e.art = toggleIn(e.art, a) })
    },
    toggleTech: (t) => {
      const s = findSel(get())
      if (!s || s.e.rest) return
      editScore((sc) => {
        const e = sc.parts.find((x) => x.id === s.part.id)!.measures[s.mi].events[s.ei]
        e.tech = toggleIn(e.tech, t)
        if (t === 'bend' && e.tech.includes('bend')) e.bend = e.bend ?? 2
      })
    },
    setDynamic: (d) => {
      const s = findSel(get())
      if (!s || s.e.rest) return
      editScore((sc) => { const e = sc.parts.find((x) => x.id === s.part.id)!.measures[s.mi].events[s.ei]; e.dynamic = d ?? undefined })
    },
    toggleTie: () => {
      const s = findSel(get())
      if (!s || s.e.rest) return
      editScore((sc) => { const e = sc.parts.find((x) => x.id === s.part.id)!.measures[s.mi].events[s.ei]; e.tie = !e.tie })
    },
    copy: () => {
      const st = get()
      const part = currentPart(st)
      if (!part || !st.cursor) return
      if (st.noteSelection) {
        const ids = new Set(st.noteSelection.ids)
        const notes = notePositions(part).filter(({ event }) => ids.has(event.id)).map(({ measure, event }) => ({
          ...structuredClone(event), start: measure * mt() + event.start
        }))
        if (!notes.length) return
        const first = notes[0].start
        for (const [i, note] of notes.entries()) {
          note.tie = note.tie && note.start + note.dur === notes[i + 1]?.start
          note.start -= first
        }
        set({ clipboard: { notes } })
        return
      }
      const r = st.range ?? { from: st.cursor.measure, to: st.cursor.measure }
      set({ clipboard: { measures: part.measures.slice(r.from, r.to + 1).map(cloneMeasure) } })
    },
    paste: () => {
      const st = get()
      if (!st.clipboard || !st.cursor) return
      const { measure, partId } = st.cursor
      const clip = st.clipboard
      if ('notes' in clip) {
        const length = mt()
        const at = measure * length + st.cursor.tick
        const last = clip.notes.at(-1)!
        editScore((sc) => {
          const part = sc.parts.find((x) => x.id === partId)!
          const need = Math.ceil((at + last.start + last.dur) / length)
          if (need > measureCount(sc)) insertMeasures(sc, measureCount(sc), need - measureCount(sc))
          for (const note of clip.notes) {
            let position = at + note.start
            let remaining = note.dur
            while (remaining > 0) {
              const bar = Math.floor(position / length)
              const tick = position % length
              const dur = Math.min(remaining, length - tick)
              const segment = { ...note, id: undefined, tie: dur < remaining || note.tie, arpeggio: remaining === note.dur ? note.arpeggio : undefined }
              part.measures[bar] = overwrite(part.measures[bar], length, segment, tick, dur).measure
              position += dur
              remaining -= dur
            }
          }
        })
        set({ range: null, noteSelection: null, sel: null })
        return
      }
      editScore((sc) => {
        const need = measure + clip.measures.length
        if (need > measureCount(sc)) insertMeasures(sc, measureCount(sc), need - measureCount(sc))
        const p = sc.parts.find((x) => x.id === partId)!
        clip.measures.forEach((m, i) => { p.measures[measure + i] = cloneMeasure(m) })
      })
      set({ range: { from: measure, to: measure + clip.measures.length - 1 }, noteSelection: null })
    },
    duplicate: () => {
      const st = get()
      if (!st.cursor) return
      const r = st.range ?? { from: st.cursor.measure, to: st.cursor.measure }
      const n = r.to - r.from + 1
      editScore((sc) => {
        insertMeasures(sc, r.to + 1, n)
        for (const p of sc.parts) for (let i = 0; i < n; i++) p.measures[r.to + 1 + i] = cloneMeasure(p.measures[r.from + i])
      })
      set({ range: { from: r.to + 1, to: r.to + n }, noteSelection: null })
    },
    addMeasures: (at, n = 1) => editScore((sc) => insertMeasures(sc, at, n)),
    removeMeasures: () => {
      const st = get()
      const r = st.range ?? (st.cursor ? { from: st.cursor.measure, to: st.cursor.measure } : null)
      if (!r) return
      editScore((sc) => deleteMeasures(sc, r.from, r.to))
      const part = currentPart(get())
      const m = Math.min(r.from, (part?.measures.length ?? 1) - 1)
      set({ range: null, noteSelection: null, cursor: part ? { partId: part.id, measure: m, tick: 0 } : null, sel: part?.measures[m]?.events[0]?.id ?? null })
    },
    addPart: (kind, source) => {
      const p = get().project
      if (!p) return
      const MT = measureTicks(p.score.timeSig)
      let count = measureCount(p.score)
      if (!count) count = p.audio ? Math.max(1, Math.ceil((((p.audio.duration - p.audio.offset) * p.score.tempo) / 60) * PPQ / MT)) : 16
      const parts = source ? [{ ...defaultPart(kind, count, MT, source.name), vstInstrument: source.vstInstrument }]
        : useApp.getState().settings?.pianoGrandStaff !== false && (kind === 'piano' || kind === 'epiano' || kind === 'organ') ? pianoParts(count, MT, kind) : [defaultPart(kind, count, MT)]
      editScore((sc) => { sc.parts.push(...parts) })
      set({ cursor: { partId: parts[0].id, measure: 0, tick: 0 }, sel: parts[0].measures[0].events[0].id, noteSelection: null })
      get().setView({ part: parts[0].id })
    },
    removePart: (id, removeGroup = true) => {
      const { project: p, cursor } = get()
      if (!p) return
      const part = p.score.parts.find((x) => x.id === id)
      if (!part) return
      const siblings = part.group ? p.score.parts.filter((x) => x.group === part.group && x.id !== id) : []
      const removed = new Set([id, ...(removeGroup ? siblings.map((x) => x.id) : [])])
      const parts = p.score.parts.filter((x) => !removed.has(x.id)).map((x) => (
        !removeGroup && siblings.length === 1 && x.id === siblings[0].id ? { ...x, group: undefined } : x
      ))
      const remaining = (!removeGroup && siblings[0]) || parts[0]
      const view = p.view && removed.has(p.view.part) ? { ...p.view, part: (!removeGroup && siblings[0]?.id) || 'all' } : p.view
      commit({ ...p, view, score: { ...p.score, parts } })
      if (!cursor || removed.has(cursor.partId)) {
        const measure = Math.min(cursor?.measure ?? 0, Math.max(0, (remaining?.measures.length ?? 1) - 1))
        set({ cursor: remaining ? { partId: remaining.id, measure, tick: 0 } : null, sel: remaining?.measures[measure]?.events[0]?.id ?? null, range: null, noteSelection: null })
      }
    },
    movePart: (id, dir) => editScore((sc) => {
      const i = sc.parts.findIndex((x) => x.id === id)
      const part = sc.parts[i]
      const block = part.group ? sc.parts.filter((x) => x.group === part.group) : [part]
      const start = sc.parts.indexOf(block[0])
      sc.parts.splice(start, block.length)
      let j = start + dir
      if (dir === 1) { const nxt = sc.parts[start]; if (nxt?.group) j = start + sc.parts.filter((x) => x.group === nxt.group).length }
      else { const prv = sc.parts[start - 1]; if (prv?.group) j = start - sc.parts.filter((x) => x.group === prv.group).length }
      sc.parts.splice(Math.max(0, Math.min(sc.parts.length, j)), 0, ...block)
    }),
    reorderPart: (id, targetId, after) => {
      const parts = get().project?.score.parts
      const part = parts?.find((p) => p.id === id)
      const target = parts?.find((p) => p.id === targetId)
      if (!parts || !part || !target || part === target || (part.group && part.group === target.group)) return
      const isSource = (p: Part) => part.group ? p.group === part.group : p.id === id
      const isTarget = (p: Part) => target.group ? p.group === target.group : p.id === targetId
      const block = parts.filter(isSource)
      const rest = parts.filter((p) => !isSource(p))
      const at = after ? rest.findLastIndex(isTarget) + 1 : rest.findIndex(isTarget)
      rest.splice(at, 0, ...block)
      if (rest.some((p, i) => p !== parts[i])) editScore((score) => {
        const byId = new Map(score.parts.map((p) => [p.id, p]))
        score.parts = rest.map((p) => byId.get(p.id)!)
      })
    },
    drumToggle: (measure, step, midi, steps) => {
      const st = get()
      const part = currentPart(st)
      if (!part || part.kind !== 'drums') return
      const MT = mt()
      const stepT = MT / steps
      // rebuild measure from a step grid of onsets
      const m = part.measures[measure]
      const grid: Map<number, Set<number>> = new Map()
      for (const e of m.events) if (!e.rest) {
        const k = Math.round(e.start / stepT)
        grid.set(k, new Set([...(grid.get(k) ?? []), ...e.notes.map((n) => n.pitch)]))
      }
      const cell = grid.get(step) ?? new Set<number>()
      if (cell.has(midi)) cell.delete(midi)
      else cell.add(midi)
      grid.set(step, cell)
      const onsets = [...grid.entries()].filter(([, v]) => v.size).sort((a, b) => a[0] - b[0])
      const events: NoteEvent[] = onsets.map(([k, v], i) => {
        const start = k * stepT
        const next = i + 1 < onsets.length ? onsets[i + 1][0] * stepT : MT
        return { id: uid(), start, dur: Math.min(next - start, PPQ), notes: [...v].map((pitch) => ({ pitch })), velocity: midi === 42 || midi === 44 ? 80 : 100 }
      })
      editScore((sc) => { sc.parts.find((x) => x.id === part.id)!.measures[measure] = events.length ? normalizeMeasure({ events }, MT) : emptyMeasure(MT) })
      if (!cell.has(midi)) return
      previewEvent(part, [midi])
    }
  }
})

function lastPitchBefore(p: Part, measure: number, tick: number): number | null {
  for (let mi = measure; mi >= 0 && mi >= measure - 8; mi--) {
    const evs = p.measures[mi].events.filter((e) => !e.rest && (mi < measure || e.start < tick))
    if (evs.length) { const e = evs[evs.length - 1]; return e.notes[e.notes.length - 1].pitch }
  }
  return null
}

function defaultRef(p: Part): number {
  if (p.clef === 'bass') return p.kind === 'bass' ? 40 : 50
  if (p.kind.includes('guitar')) return 60
  return 67
}

export function viewMode(p: Project | null): ViewMode { return p?.view?.mode ?? 'both' }

// ---------- automatic part names ----------
const vstName = (part: Part): string | null => {
  const vst = part.vstInstrument
  if (!vst) return null
  const presets = useApp.getState().settings?.vstInstruments ?? []
  return (presets.find((x) => x.configuration === vst) ?? presets.find((x) => x.configuration.plugin.id === vst.plugin.id))?.name ?? vst.plugin.name
}
const soundName = (part: Part): string => soundLabel(((part.sound as SoundId) || DEFAULT_SOUND[part.kind]))

/**
 * When a part changes instrument and still has the name it was given automatically
 * (its instrument, sound or plug-in), it takes the new instrument's name. A name the
 * user typed is kept. Piano staves keep their " RH" / " LH" ending.
 */
function autoName(old: Part, next: Part, patch: Partial<Part>): string | null {
  let base: string | null = null
  if ('vstInstrument' in patch && patch.vstInstrument !== old.vstInstrument) base = vstName(next) ?? ('kind' in patch ? INSTRUMENTS[next.kind].label : soundName(next))
  else if ('kind' in patch && patch.kind !== old.kind) base = INSTRUMENTS[next.kind].label
  else if ('sound' in patch && patch.sound !== old.sound) base = soundName(next)
  if (!base) return null
  const defaults = new Set([INSTRUMENTS[old.kind].label, soundName(old), ...(old.vstInstrument ? [old.vstInstrument.plugin.name, vstName(old)!] : [])])
  const m = /^(.*?)( RH| LH| \(copy\)| \d+)?$/.exec(old.name)!
  if (!defaults.has(m[1])) return null
  const name = base + (m[2] ?? '')
  return name === old.name ? null : name
}
