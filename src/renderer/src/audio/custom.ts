import { CUSTOM_PREFIX, customId, type CustomSound } from '@shared/sounds'

// The user's own sample instruments and which built-in sounds they replace (from Settings).
let list: CustomSound[] = []
let swaps: Record<string, string> = {}
const changeListeners = new Set<(changed: string[]) => void>()

/** Update from settings; reports the sound ids whose samples changed so they are reloaded. */
export function setCustomSounds(next: CustomSound[], nextSwaps: Record<string, string>): boolean {
  const before = new Map(list.map((c) => [c.id, JSON.stringify(c.samples)]))
  const changed = [...new Set([...before.keys(), ...next.map((c) => c.id)])]
    .filter((id) => before.get(id) !== JSON.stringify(next.find((c) => c.id === id)?.samples))
    .map((id) => CUSTOM_PREFIX + id)
  const swapsChanged = JSON.stringify(swaps) !== JSON.stringify(nextSwaps)
  const namesChanged = JSON.stringify(list.map((c) => c.name)) !== JSON.stringify(next.map((c) => c.name))
  list = next
  swaps = nextSwaps
  if (changed.length) changeListeners.forEach((fn) => fn(changed))
  return changed.length > 0 || swapsChanged || namesChanged
}

export function onCustomSoundsChanged(fn: (changed: string[]) => void): void { changeListeners.add(fn) }
export const customSounds = (): CustomSound[] => list
export function customSound(sound: string): CustomSound | undefined {
  const id = customId(sound)
  return id ? list.find((c) => c.id === id) : undefined
}
/** The custom sound used everywhere instead of a built-in one, if the user chose one. */
export function swapFor(builtin: string): string | null {
  const id = swaps[builtin]
  return id && list.some((c) => c.id === id) ? CUSTOM_PREFIX + id : null
}
