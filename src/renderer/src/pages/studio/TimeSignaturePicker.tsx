import { useState } from 'react'
import type { Score } from '@shared/types'
import { Select } from '@/components/menu'

const PRESETS = ['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '6/8', '7/8', '9/8', '12/8']
const NOTE_VALUES = ['1', '2', '4', '8', '16', '32']
const OPTIONS = [...PRESETS.map((value) => ({ value, label: value })), { value: 'custom', label: 'Custom…' }]

export function parseTimeSignature(value: string): Score['timeSig'] | null {
  const [beats, note] = value.split('/')
  const num = Number(beats)
  return Number.isInteger(num) && num >= 1 && num <= 32 && NOTE_VALUES.includes(note) ? { num, den: Number(note) } : null
}

export default function TimeSignaturePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [custom, setCustom] = useState(!PRESETS.includes(value))
  const [beats, note] = value.split('/')
  return (
    <div>
      <Select value={custom ? 'custom' : value} options={OPTIONS} onChange={(next) => {
        setCustom(next === 'custom')
        if (next !== 'custom') onChange(next)
      }} />
      {custom && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label><div className="label mb-1">Beats per bar</div><input className="field" type="number" value={beats} min={1} max={32} step={1} required onChange={(e) => onChange(`${e.target.value}/${note}`)} /></label>
          <div><div className="label mb-1">Note value</div><Select value={note} options={NOTE_VALUES.map((n) => ({ value: n, label: n }))} onChange={(n) => onChange(`${beats}/${n}`)} /></div>
        </div>
      )}
    </div>
  )
}
