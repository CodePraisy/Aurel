import { useState } from 'react'
import type { Part } from '@shared/types'
import { cx, Modal } from '@/components/ui'

const COLORS = ['#ed75aa', '#e65b5b', '#ef9b48', '#d2ad38', '#65b778', '#35b4a6', '#529ee8', '#9182ec', '#bf7bdc', '#a98a72']

export default function InstrumentColor({ part, onApply, onClose }: { part: Part; onApply: (color?: string) => void; onClose: () => void }) {
  const [color, setColor] = useState(part.color)
  return <Modal open title="Instrument color" onClose={onClose} width={360} footer={<>
    <button className="btn-ghost" onClick={onClose}>Cancel</button>
    <button className="btn-primary" onClick={() => onApply(color)}>Apply</button>
  </>}>
    <p className="text-sm text-muted mb-4">Choose a color for {part.name}{part.group ? ' and its paired staff' : ''}. It appears on the instrument and its notation.</p>
    <div className="grid grid-cols-5 gap-3 mb-5">{COLORS.map((value) =>
      <button key={value} aria-label={`Color ${value}`} aria-pressed={color === value} title={value}
        className={cx('h-9 rounded-lg border-2 transition-transform hover:scale-105', color === value ? 'border-fg ring-2 ring-accent/40' : 'border-transparent')}
        style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}</div>
    <label className="flex items-center justify-between gap-3 text-sm">Custom color
      <input type="color" aria-label="Custom instrument color" className="h-9 w-16 cursor-pointer bg-transparent rounded" value={color ?? COLORS[0]} onChange={(event) => setColor(event.target.value)} />
    </label>
    <button className={cx('btn-soft mt-4 w-full', !color && 'text-accent')} onClick={() => setColor(undefined)}>Use theme color{!color ? ' ✓' : ''}</button>
  </Modal>
}
