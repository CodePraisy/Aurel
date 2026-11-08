import type { CSSProperties } from 'react'

export function instrumentAccent(color?: string): CSSProperties {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return {}
  const rgb = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16)).join(' ')
  return { '--accent': rgb, '--accent2': rgb } as CSSProperties
}
