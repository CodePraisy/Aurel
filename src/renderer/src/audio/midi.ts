import type { Part } from '@shared/types'
import { player, type LiveNote } from './player'

export interface MidiDevice { id: string; name: string; manufacturer: string; connected: boolean }

export interface MidiSettings { input: string; channel: number; mode: 'write' | 'play'; audition: 'selected' | 'first' | 'piano' }

/** Where incoming notes go; provided by the studio store so this module has no UI dependencies. */
export interface MidiTarget {
  settings(): MidiSettings
  /** The part a key should sound on (null = built-in piano). */
  part(audition: MidiSettings['audition']): Part | null
  /** Write a note into the score at the cursor; false when nothing can be written right now. */
  write(pitch: number, velocity: number, chord: boolean): boolean
}

const CHORD_WINDOW = 60 // ms: keys pressed this close together become one chord

/**
 * USB / Bluetooth MIDI keyboards via Web MIDI. Notes sound for as long as the key
 * (or the sustain pedal) is held, on the part's own instrument and plug-ins.
 */
class MidiInput {
  devices: MidiDevice[] = []
  error: string | null = null
  supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
  /** Keys currently down, for lighting up the on-screen keyboard. */
  held = new Set<number>()
  lastMessage = 0
  private access: MIDIAccess | null = null
  private starting: Promise<void> | null = null
  private target: MidiTarget | null = null
  private sounding = new Map<number, LiveNote>()
  private sustain = false
  private sustained = new Set<number>()
  private lastOn = 0
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private emit(): void { this.listeners.forEach((fn) => fn()) }

  setTarget(target: MidiTarget): void { this.target = target; this.bind() }

  start(): Promise<void> {
    if (!this.supported) { this.error = 'This system does not offer MIDI input.'; return Promise.resolve() }
    this.starting ??= navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      this.access = access
      this.error = null
      access.onstatechange = () => { this.refresh(); this.bind() }
      this.refresh()
      this.bind()
    }, (e: Error) => {
      this.error = `MIDI input could not start${e?.message ? ` (${e.message})` : ''}. Reconnect the keyboard and press Try again.`
      this.starting = null
      this.emit()
    })
    return this.starting
  }

  private refresh(): void {
    const list: MidiDevice[] = []
    this.access?.inputs.forEach((input) => list.push({ id: input.id, name: input.name || 'MIDI input', manufacturer: input.manufacturer || '', connected: input.state === 'connected' }))
    this.devices = list.sort((a, b) => a.name.localeCompare(b.name))
    this.emit()
  }

  /** Listen to the chosen input (or all of them). Call after the device setting changes. */
  bind(): void {
    if (!this.access) return
    const wanted = this.target?.settings().input ?? ''
    this.access.inputs.forEach((input) => {
      input.onmidimessage = !wanted || input.id === wanted ? (e) => this.message(e.data) : null
    })
  }

  private message(data: Uint8Array | null): void {
    if (!data || data.length < 2 || !this.target) return
    const settings = this.target.settings()
    const status = data[0] & 0xf0
    const channel = (data[0] & 0x0f) + 1
    if (settings.channel && channel !== settings.channel) return
    this.lastMessage = performance.now()
    const note = data[1], value = data[2] ?? 0
    if (status === 0x90 && value > 0) this.noteOn(note, value, settings)
    else if (status === 0x80 || (status === 0x90 && value === 0)) this.noteOff(note)
    else if (status === 0xb0 && note === 64) this.pedal(value >= 64)
    else if (status === 0xb0 && (note === 120 || note === 123)) this.allOff()
    else return
    this.emit()
  }

  private noteOn(pitch: number, velocity: number, settings: MidiSettings): void {
    const target = this.target!
    this.sounding.get(pitch)?.stop()
    this.sustained.delete(pitch)
    const now = performance.now()
    const chord = this.held.size > 0 && now - this.lastOn < CHORD_WINDOW
    this.lastOn = now
    this.held.add(pitch)
    if (settings.mode === 'write') target.write(pitch, velocity, chord)
    this.sounding.set(pitch, player.noteOn(target.part(settings.audition), pitch, velocity))
  }

  private noteOff(pitch: number): void {
    this.held.delete(pitch)
    if (this.sustain) { this.sustained.add(pitch); return }
    this.sounding.get(pitch)?.stop()
    this.sounding.delete(pitch)
  }

  private pedal(down: boolean): void {
    this.sustain = down
    if (down) return
    for (const pitch of this.sustained) {
      if (this.held.has(pitch)) continue
      this.sounding.get(pitch)?.stop()
      this.sounding.delete(pitch)
    }
    this.sustained.clear()
  }

  allOff(): void {
    for (const note of this.sounding.values()) note.stop()
    this.sounding.clear()
    this.sustained.clear()
    this.held.clear()
    this.emit()
  }
}

export const midi = new MidiInput()
