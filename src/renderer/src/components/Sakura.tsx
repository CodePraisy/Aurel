import { useMemo } from 'react'

/** Drawn cherry trees framing the window, with slowly falling petals. Purely decorative. */
function Blossoms({ cx, cy, r, n, seed }: { cx: number; cy: number; r: number; n: number; seed: number }) {
  const pts = useMemo(() => {
    let s = seed
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    return Array.from({ length: n }, () => {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * r
      return { x: cx + Math.cos(a) * d * 1.3, y: cy + Math.sin(a) * d * 0.8, s: 5 + rnd() * 9, o: 0.55 + rnd() * 0.45, c: rnd() }
    })
  }, [cx, cy, r, n, seed])
  return (
    <g>
      {pts.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y})`} opacity={p.o}>
          {[0, 72, 144, 216, 288].map((rot) => <ellipse key={rot} rx={p.s * 0.42} ry={p.s * 0.62} cy={-p.s * 0.5} transform={`rotate(${rot})`} fill={p.c > 0.6 ? '#ffd6e4' : p.c > 0.25 ? '#ffadc9' : '#ff86b0'} />)}
          <circle r={p.s * 0.18} fill="#c2185b" opacity={0.7} />
        </g>
      ))}
    </g>
  )
}

export function SakuraScene({ reduceMotion, dim }: { reduceMotion: boolean; dim?: boolean }) {
  const petals = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    left: (i * 37) % 100, delay: -((i * 1.7) % 18), dur: 14 + ((i * 7) % 10), sway: 3 + (i % 4),
    drift: `${((i * 53) % 220) - 60}px`, spin: `${360 + ((i * 97) % 540)}deg`, scale: 0.6 + ((i * 13) % 10) / 14
  })), [])
  const bark = '#3b1424'
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 transition-opacity duration-500" style={{ opacity: dim ? 0.32 : 1 }} aria-hidden>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(1200px 700px at 85% -10%, rgb(255 120 168 / .16), transparent 60%), radial-gradient(900px 600px at -5% 110%, rgb(255 140 182 / .14), transparent 60%)' }} />
      {/* left tree */}
      <svg className="absolute -left-10 bottom-0 w-[520px] h-[560px] opacity-[0.55]" viewBox="0 0 520 560">
        <path d="M120 560 C130 470 110 420 150 360 C185 305 175 250 230 200 C270 165 300 150 340 120" stroke={bark} strokeWidth="26" fill="none" strokeLinecap="round" />
        <path d="M165 345 C220 330 260 300 310 300 C350 300 380 280 410 260" stroke={bark} strokeWidth="12" fill="none" strokeLinecap="round" />
        <path d="M215 215 C190 170 150 150 110 140" stroke={bark} strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M300 140 C330 100 360 80 400 70" stroke={bark} strokeWidth="8" fill="none" strokeLinecap="round" />
        <Blossoms cx={350} cy={110} r={95} n={70} seed={3} />
        <Blossoms cx={140} cy={135} r={70} n={45} seed={7} />
        <Blossoms cx={400} cy={255} r={70} n={45} seed={11} />
        <Blossoms cx={270} cy={190} r={60} n={30} seed={19} />
      </svg>
      {/* top-right branch */}
      <svg className="absolute right-0 -top-6 w-[560px] h-[300px] opacity-[0.5]" viewBox="0 0 560 300">
        <path d="M560 30 C470 40 420 70 360 110 C310 140 260 150 200 150" stroke={bark} strokeWidth="14" fill="none" strokeLinecap="round" />
        <path d="M400 85 C380 140 340 170 300 200" stroke={bark} strokeWidth="7" fill="none" strokeLinecap="round" />
        <Blossoms cx={230} cy={140} r={65} n={40} seed={23} />
        <Blossoms cx={320} cy={195} r={55} n={30} seed={29} />
        <Blossoms cx={430} cy={70} r={70} n={45} seed={31} />
      </svg>
      {!reduceMotion && petals.map((p, i) => (
        <div key={i} className="petal" style={{ left: `${p.left}%`, animationDuration: `${p.dur}s, ${p.sway}s`, animationDelay: `${p.delay}s, ${p.delay}s`, transform: `scale(${p.scale})`, ['--drift' as string]: p.drift, ['--spin' as string]: p.spin }} />
      ))}
    </div>
  )
}
