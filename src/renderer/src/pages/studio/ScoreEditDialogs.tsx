import { useState } from 'react'
import type { Arpeggio } from '@shared/types'
import { Select } from '@/components/menu'
import { Modal } from '@/components/ui'

export function ArpeggioEditor({ current, onClose, onApply }: { current?: Arpeggio; onClose: () => void; onApply: (roll?: Arpeggio) => void }) {
  const [direction, setDirection] = useState<Arpeggio['direction']>(current?.direction ?? 'up')
  const [delay, setDelay] = useState(String(current?.delayMs ?? 35))
  return (
    <Modal open onClose={onClose} title="Arpeggiate chord" width={390}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onApply({ direction, delayMs: Number(delay) }) }}>
        <div><div className="label mb-1.5">Direction</div>
          <Select value={direction} onChange={setDirection} options={[
            { value: 'up', label: 'Bottom to top (low → high)' },
            { value: 'down', label: 'Top to bottom (high → low)' }
          ]} />
        </div>
        <label className="block"><div className="label mb-1.5">Delay between notes (ms)</div><input className="field" type="number" min={1} max={250} step={1} value={delay} onChange={(e) => setDelay(e.target.value)} required /></label>
        <p className="text-[12px] text-muted">The first note starts on the beat. Short chords use a shorter delay to fit the roll.</p>
        <div className="flex gap-2 justify-end">
          {current && <button type="button" className="btn-danger mr-auto" onClick={() => onApply()}>Remove roll</button>}
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Apply</button>
        </div>
      </form>
    </Modal>
  )
}

export function TransposeEditor({ playback, current, hasSelection, onClose, onApply }: {
  playback: boolean; current: number; hasSelection: boolean; onClose: () => void; onApply: (semitones: number, selectedOnly: boolean) => void
}) {
  const [semitones, setSemitones] = useState(String(current))
  const [scope, setScope] = useState<'selection' | 'score'>(hasSelection ? 'selection' : 'score')
  const max = playback ? 12 : 24
  const amount = Number(semitones)
  const change = (step: number) => setSemitones(String(Math.min(max, Math.max(-max, amount + step))))
  return (
    <Modal open onClose={onClose} title={playback ? 'Transpose playback' : 'Transpose score'} width={350}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onApply(amount, scope === 'selection') }}>
        {hasSelection && <div><div className="label mb-1.5">Apply to</div><Select value={scope} onChange={setScope} options={[{ value: 'selection', label: 'Selection' }, { value: 'score', label: 'Whole score' }]} /></div>}
        <div>
          <label htmlFor="transpose-semitones" className="label block mb-1.5">Semitones</label>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-soft" onClick={() => change(-1)} disabled={amount <= -max}>− Down</button>
            <input id="transpose-semitones" className="field min-w-0 text-center tabular-nums" type="number" min={-max} max={max} step={1} value={semitones} onChange={(e) => setSemitones(e.target.value)} autoFocus onFocus={(e) => e.target.select()} required />
            <button type="button" className="btn-soft" onClick={() => change(1)} disabled={amount >= max}>Up +</button>
          </div>
        </div>
        <p className="text-[12px] text-muted">{amount === 0 ? 'Original pitch' : `${amount > 0 ? 'Up' : 'Down'} ${Math.abs(amount)} semitone${Math.abs(amount) === 1 ? '' : 's'}`}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Apply</button>
        </div>
      </form>
    </Modal>
  )
}
