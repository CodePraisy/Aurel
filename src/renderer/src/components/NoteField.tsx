import { memo, useEffect, useRef } from 'react'

// Glyphs on a 24 × 28 grid (SVG path data, drawn with Path2D).
const GLYPHS = {
  quarter: 'M12 3h2v18.2h-2zM8.4 18.4c3 0 5.6 1.4 5.6 3.4s-2.9 3.9-5.8 3.9-5-1.3-5-3.3 2.4-4 5.2-4z',
  eighth: 'M12 3h2v18.2h-2zM8.4 18.4c3 0 5.6 1.4 5.6 3.4s-2.9 3.9-5.8 3.9-5-1.3-5-3.3 2.4-4 5.2-4zM13 3c0 5.6 7.6 6.6 7.6 12.3 0 1.6-.7 3.2-1.7 4.2.7-4.6-1.3-6.8-5.9-8.8z',
  beamed: 'M6.6 6.2 21.4 2.6v4.2L6.6 10.4zM6.6 8h1.8v13.6H6.6zM19.6 4.4h1.8v13.6h-1.8zM3.8 19.2c2.4 0 4.6 1 4.6 2.6s-2.3 3.2-4.6 3.2S0 24 0 22.4s1.6-3.2 3.8-3.2zM16.8 15.6c2.4 0 4.6 1 4.6 2.6s-2.3 3.2-4.6 3.2-3.8-1-3.8-2.6 1.6-3.2 3.8-3.2z',
  half: 'M12 3h2v18.2h-2zM8.4 18.4c3 0 5.6 1.4 5.6 3.4s-2.9 3.9-5.8 3.9-5-1.3-5-3.3 2.4-4 5.2-4zm-.3 1.9c-1.8.3-3.2 1.3-3 2.1.2.8 1.8 1.1 3.6.7 1.8-.4 3.1-1.3 2.9-2.1-.2-.8-1.7-1-3.5-.7z',
  quarterRest: 'm14.2 1.8 1.1.6-3.8 6.2 5.9 5.1-5 4.3c-2.5 2.2-1.1 4.7 2 4.2l1 .6c-2.1 2.7-7.9 2-8.3-1.4-.3-2.2 1-4.1 3.3-5.9L6.9 12z',
  eighthRest: 'M17.7 6.3 12 24.2l-2-.7 4-12.5c-2.5 2.1-7.4 2-8.7-.7-1.1-2.2.4-4.5 2.8-4.5 2.1 0 3.4 1.9 2.8 3.8 2.2.7 4.2-1 5.4-3.7z',
  sharp: 'M9 2h1.6v24H9zM14 1h1.6v24H14zM5 9.6 20 6.4v2.4L5 12zM5 17.6l15-3.2v2.4L5 20z',
  flat: 'M7 1h1.8v25H7zM8.8 15.4c3.6-3.4 9.6-2 8.4 2.6-.8 3-4.8 5.6-8.4 8l-.2-2.1c2.8-2 5.4-4 5.8-6 .5-2.6-2.8-3.2-5.4-.6z'
} as const
const KINDS = Object.keys(GLYPHS) as (keyof typeof GLYPHS)[]
// notes turn up more often than rests and accidentals
const WEIGHTS = [5, 5, 3, 2, 3, 3, 1.5, 1.5]

interface Particle { x: number; y: number; size: number; depth: number; speed: number; sway: number; phase: number; turn: number; spin: number; kind: number; accent: boolean; alpha: number }

function rgbVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).join(',')
  return `rgb(${v})`
}

/** One pre-drawn bitmap per glyph and colour, so a frame is only drawImage calls. */
function sprites(colors: string[], px: number): HTMLCanvasElement[][] {
  return colors.map((color) => KINDS.map((kind) => {
    const c = document.createElement('canvas')
    c.width = Math.ceil(24 * px); c.height = Math.ceil(28 * px)
    const g = c.getContext('2d')!
    g.scale(px, px)
    g.fillStyle = color
    g.fill(new Path2D(GLYPHS[kind]))
    return c
  }))
}

function pickKind(r: number): number {
  const total = WEIGHTS.reduce((a, b) => a + b, 0)
  let x = r * total
  for (let i = 0; i < WEIGHTS.length; i++) { x -= WEIGHTS[i]; if (x <= 0) return i }
  return 0
}

function spawn(w: number, h: number, anywhere: boolean): Particle {
  const depth = 0.35 + Math.random() * 0.65
  const size = 14 + depth * 30
  return {
    x: Math.random() * w, y: anywhere ? Math.random() * h : h + size + Math.random() * 60,
    size, depth, speed: 7 + depth * 16, sway: 8 + Math.random() * 26, phase: Math.random() * Math.PI * 2,
    turn: (Math.random() - 0.5) * 0.6, spin: (Math.random() - 0.5) * 0.25, kind: pickKind(Math.random()),
    accent: Math.random() < 0.42, alpha: 0.10 + depth * 0.26
  }
}

/**
 * Notes, rests and accidentals drifting up the background. Drawn on one canvas;
 * `count` sets how many. Slows to 30 fps when it is behind other pages and stops in hidden windows.
 */
export const NoteField = memo(function NoteField({ count, dim, theme, accent }: { count: number; dim: boolean; theme: string; accent: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ particles: Particle[]; dim: boolean }>({ particles: [], dim })
  state.current.dim = dim

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const g = canvas.getContext('2d')!
    const still = document.documentElement.dataset.motion === 'reduce'
    let w = 0, h = 0, dpr = 1
    let art = sprites([rgbVar('accent'), rgbVar('muted')], 2)
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      art = sprites([rgbVar('accent'), rgbVar('muted')], 2 * dpr > 3 ? 3 : 2)
    }
    resize()
    const list = state.current.particles
    while (list.length < count) list.push(spawn(w, h, true))
    list.length = count
    let raf = 0, last = performance.now(), t = 0
    const draw = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      for (const p of list) {
        const x = p.x + Math.sin(t * 0.35 * p.depth + p.phase) * p.sway
        const fade = Math.min(1, (h + p.size - p.y) / 120, (p.y + p.size) / 140)
        if (fade <= 0) continue
        g.globalAlpha = p.alpha * Math.max(0, fade)
        g.setTransform(dpr, 0, 0, dpr, x * dpr, p.y * dpr)
        g.rotate(p.turn + Math.sin(t * p.spin + p.phase) * 0.35)
        const s = p.size / 28
        g.drawImage(art[p.accent ? 0 : 1][p.kind], -12 * s, -14 * s, 24 * s, 28 * s)
      }
      g.globalAlpha = 1
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const minStep = state.current.dim ? 1000 / 30 : 1000 / 62
      if (now - last < minStep) return
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      t += dt
      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        p.y -= p.speed * dt
        if (p.y < -p.size * 2) list[i] = spawn(w, h, false)
      }
      draw()
    }
    const onResize = () => { resize(); draw() }
    window.addEventListener('resize', onResize)
    const visibility = () => { if (document.hidden) cancelAnimationFrame(raf); else if (!still) { last = performance.now(); raf = requestAnimationFrame(frame) } }
    document.addEventListener('visibilitychange', visibility)
    if (still || !count) draw()
    else raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', visibility) }
  }, [count, theme, accent])

  return <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-hidden="true" />
})
