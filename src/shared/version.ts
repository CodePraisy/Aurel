/** True when `candidate` is a later version than `current` ("v0.10.0" > "0.9.3"). */
export function newer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const a = parse(candidate), b = parse(current)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
