import { memo, type CSSProperties } from 'react'

const marks = [
  { x: 7, y: 24, size: 34, turn: -14, kind: 'eighth' },
  { x: 17, y: 68, size: 20, turn: 10, kind: 'quarter-rest' },
  { x: 27, y: 89, size: 30, turn: -9, kind: 'quarter' },
  { x: 44, y: 12, size: 25, turn: 12, kind: 'eighth-rest' },
  { x: 55, y: 81, size: 19, turn: -12, kind: 'eighth' },
  { x: 67, y: 16, size: 30, turn: -8, kind: 'quarter' },
  { x: 77, y: 74, size: 33, turn: 14, kind: 'eighth-rest' },
  { x: 86, y: 29, size: 23, turn: -11, kind: 'quarter-rest' },
  { x: 93, y: 56, size: 40, turn: 10, kind: 'eighth' },
  { x: 96, y: 88, size: 21, turn: -7, kind: 'quarter-rest' }
] as const

export function MusicMark({ kind, className }: { kind: typeof marks[number]['kind']; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 28" fill="currentColor" aria-hidden="true">
      {kind === 'quarter-rest' ? (
        <path d="m14.2 1.8 1.1.6-3.8 6.2 5.9 5.1-5 4.3c-2.5 2.2-1.1 4.7 2 4.2l1 .6c-2.1 2.7-7.9 2-8.3-1.4-.3-2.2 1-4.1 3.3-5.9L6.9 12z" />
      ) : kind === 'eighth-rest' ? (
        <path d="M17.7 6.3 12 24.2l-2-.7 4-12.5c-2.5 2.1-7.4 2-8.7-.7-1.1-2.2.4-4.5 2.8-4.5 2.1 0 3.4 1.9 2.8 3.8 2.2.7 4.2-1 5.4-3.7z" />
      ) : (
        <>
          <ellipse cx="8.4" cy="22" rx="5.5" ry="3.6" transform="rotate(-22 8.4 22)" />
          <path d="M12 3h2v18.2h-2z" />
          {kind === 'eighth' && <path d="M13 3c0 5.6 7.6 6.6 7.6 12.3 0 1.6-.7 3.2-1.7 4.2.7-4.6-1.3-6.8-5.9-8.8z" />}
        </>
      )}
    </svg>
  )
}

export const MusicScene = memo(function MusicScene({ dim }: { dim: boolean }) {
  return (
    <div className={dim ? 'theme-scene music-scene theme-scene-dim' : 'theme-scene music-scene'} aria-hidden="true">
      <svg className="scene-staff" viewBox="0 0 1200 800" preserveAspectRatio="none" fill="none">
        {[0, 1, 2, 3, 4].map((line) => (
          <path key={line} transform={`translate(0 ${line * 9})`} d="M-40 614C165 552 233 721 474 690c294-38 400-199 766-149M675 72c245 82 319-67 566-33" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {marks.map((mark, i) => (
        <div className="scene-note" key={i} style={{
          left: `${mark.x}%`, top: `${mark.y}%`, width: mark.size,
          '--note-turn': `${mark.turn}deg`, '--note-drift': `${(i % 2 ? -1 : 1) * (12 + i * 2)}px`,
          '--note-duration': `${13 + (i * 7) % 11}s`, '--note-delay': `${-i * 2.3}s`
        } as CSSProperties}><MusicMark kind={mark.kind} /></div>
      ))}
    </div>
  )
})
