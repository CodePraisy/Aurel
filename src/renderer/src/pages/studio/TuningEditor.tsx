import { useState } from 'react'
import type { Part } from '@shared/types'
import { noteFromName } from '@shared/sounds'
import { Modal } from '@/components/ui'
import { suggestTuning, tuningOf } from '@/music/tab'
import { midiName } from '@/music/theory'

export default function TuningEditor({ part, onClose, onApply }: {
  part: Part; onClose: () => void; onApply: (tuning: number[]) => void
}) {
  const [notes, setNotes] = useState(() => tuningOf(part).map(midiName))
  const [suggestion, setSuggestion] = useState('')
  const tuning = notes.map((note) => /^[A-G][#b♯♭]?-?\d$/i.test(note.trim()) ? noteFromName(note.trim()) : null)
  return (
    <Modal open onClose={onClose} title={`Tuning · ${part.name}`} width={370}>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (tuning.every((pitch) => pitch !== null)) onApply(tuning)
      }}>
        <p className="text-sm text-muted mb-3">Enter the open pitches from string 1 to the lowest string, such as E4 or Bb2. Capo is set separately.</p>
        <div className="grid grid-cols-3 gap-2">
          {notes.map((note, index) => (
            <label key={index}>
              <div className="label mb-1">String {index + 1}</div>
              <input className="field" value={note} aria-invalid={tuning[index] === null} onChange={(event) => {
                setNotes(notes.map((value, i) => i === index ? event.target.value : value))
                setSuggestion('')
              }} />
            </label>
          ))}
        </div>
        {suggestion && <p className="text-sm text-muted mt-3" role="status">{suggestion}</p>}
        <div className="flex items-center gap-2 justify-end mt-4">
          <button type="button" className="btn-soft mr-auto" onClick={() => {
            const best = suggestTuning(part)
            if (best) setNotes(best.strings.map(midiName))
            setSuggestion(best ? `Best fit for these notes · ${best.name}` : 'Add notes to this part to get a suggestion.')
          }}>Suggest tuning</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={tuning.some((pitch) => pitch === null)}>Apply</button>
        </div>
      </form>
    </Modal>
  )
}
