/** Guitar chord boxes for chord symbols (C, F#m, Bb7, G/B …): open shapes where they exist,
 *  otherwise the E- or A-shape barre chord, whichever sits lower on the neck. */
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const
// frets per string, low E to high e; null = not played
const OPEN: Record<string, (number | null)[]> = {
  C: [null, 3, 2, 0, 1, 0], D: [null, null, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0], G: [3, 2, 0, 0, 0, 3], A: [null, 0, 2, 2, 2, 0],
  Am: [null, 0, 2, 2, 1, 0], Dm: [null, null, 0, 2, 3, 1], Em: [0, 2, 2, 0, 0, 0],
  C7: [null, 3, 2, 3, 1, 0], D7: [null, null, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0], G7: [3, 2, 0, 0, 0, 1], A7: [null, 0, 2, 0, 2, 0], B7: [null, 2, 1, 2, 0, 2],
  Am7: [null, 0, 2, 0, 1, 0], Em7: [0, 2, 0, 0, 0, 0], Dm7: [null, null, 0, 2, 1, 1], Cmaj7: [null, 3, 2, 0, 0, 0], Fmaj7: [null, null, 3, 2, 1, 0],
  Dsus4: [null, null, 0, 2, 3, 3], Asus4: [null, 0, 2, 2, 3, 0], Dsus2: [null, null, 0, 2, 3, 0], Asus2: [null, 0, 2, 2, 0, 0], E5: [0, 2, 2, null, null, null], A5: [null, 0, 2, 2, null, null]
}
const E_SHAPE: Record<string, (number | null)[]> = { '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, null, 1, 1, 0, null], '5': [0, 2, 2, null, null, null], sus4: [0, 2, 2, 2, 0, 0], sus2: [0, 2, 4, 4, null, null], dim: [0, 1, 2, 0, null, null] }
const A_SHAPE: Record<string, (number | null)[]> = { '': [null, 0, 2, 2, 2, 0], m: [null, 0, 2, 2, 1, 0], '7': [null, 0, 2, 0, 2, 0], m7: [null, 0, 2, 0, 1, 0], maj7: [null, 0, 2, 1, 2, 0], '5': [null, 0, 2, 2, null, null], sus4: [null, 0, 2, 2, 3, 0], sus2: [null, 0, 2, 2, 0, 0], dim: [null, 0, 1, 2, 1, null] }

export function guitarShape(name: string): { frets: (number | null)[]; base: number } | null {
  const m = name.match(/^([A-G])([#b]?)(maj7|m7|sus4|sus2|dim|m|7|5)?/)
  if (!m) return null
  const key = m[1] + m[2] + (m[3] ?? '')
  const open = OPEN[key]
  if (open) return { frets: open, base: 1 }
  const pc = (NOTE[m[1] as keyof typeof NOTE] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12
  const q = m[3] === undefined ? '' : m[3]
  const eFret = (pc - 4 + 12) % 12 || 12, aFret = (pc - 9 + 12) % 12 || 12
  const useA = aFret < eFret
  const shape = (useA ? A_SHAPE : E_SHAPE)[q] ?? (useA ? A_SHAPE[''] : E_SHAPE[''])
  const at = useA ? aFret : eFret
  const frets = shape.map((f) => (f === null ? null : f + at))
  return { frets, base: at }
}

export function ChordDiagram({ name, size = 1 }: { name: string; size?: number }) {
  const shape = guitarShape(name)
  if (!shape) return null
  const played = shape.frets.filter((f): f is number => f !== null && f > 0)
  const low = played.length ? Math.min(...played) : 1
  const first = low <= 2 && Math.max(...played, 0) <= 4 ? 1 : low
  const W = 74 * size, H = 92 * size, x0 = 12 * size, y0 = 20 * size, sw = (W - 2 * x0) / 5, fh = (H - y0 - 8 * size) / 4
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} guitar chord`} className="chord-box">
      {first === 1 ? <rect x={x0} y={y0 - 3 * size} width={W - 2 * x0} height={3 * size} rx={1} className="fill-current" /> : <text x={1} y={y0 + fh * 0.65} fontSize={9 * size} className="fill-current opacity-70">{first}</text>}
      {Array.from({ length: 5 }, (_, i) => <line key={`f${i}`} x1={x0} x2={W - x0} y1={y0 + i * fh} y2={y0 + i * fh} className="stroke-current opacity-40" strokeWidth={1} />)}
      {Array.from({ length: 6 }, (_, i) => <line key={`s${i}`} x1={x0 + i * sw} x2={x0 + i * sw} y1={y0} y2={y0 + 4 * fh} className="stroke-current opacity-60" strokeWidth={1} />)}
      {shape.frets.map((f, i) => {
        const x = x0 + i * sw
        if (f === null) return <text key={i} x={x} y={y0 - 6 * size} fontSize={9 * size} textAnchor="middle" className="fill-current opacity-60">×</text>
        if (f === 0) return <circle key={i} cx={x} cy={y0 - 8 * size} r={3 * size} className="stroke-current" fill="none" strokeWidth={1.2} />
        const row = f - first
        return row >= 0 && row < 4 ? <circle key={i} cx={x} cy={y0 + (row + 0.5) * fh} r={5 * size} className="chord-dot" /> : null
      })}
    </svg>
  )
}
