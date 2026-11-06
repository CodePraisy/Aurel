import { CUSTOM_PREFIX, customId, type CustomSound, type VstConfiguration } from '@shared/sounds'
import type { VstInstrumentPreset } from '@shared/types'

// The user's own sample instruments and which built-in sounds they replace (from Settings).
let list: CustomSound[] = []
let swaps: Record<string, string> = {}
let presets: VstInstrumentPreset[] = []
/** Swap targets that are VST3 instrument presets are stored as "vst:<preset id>". */
export const VST_SWAP = 'vst:'
const changeListeners = new Set<(changed: string[]) => void>()

/** Update from settings; reports the sound ids whose samples changed so they are reloaded. */
export function setCustomSounds(next: CustomSound[], nextSwaps: Record<string, string>, nextPresets: VstInstrumentPreset[] = presets): boolean {
  const before = new Map(list.map((c) => [c.id, JSON.stringify(c.samples)]))
  const changed = [...new Set([...before.keys(), ...next.map((c) => c.id)])]
    .filter((id) => before.get(id) !== JSON.stringify(next.find((c) => c.id === id)?.samples))
    .map((id) => CUSTOM_PREFIX + id)
  const swapsChanged = JSON.stringify(swaps) !== JSON.stringify(nextSwaps)
  const namesChanged = JSON.stringify(list.map((c) => c.name)) !== JSON.stringify(next.map((c) => c.name))
  const presetsChanged = JSON.stringify(presets) !== JSON.stringify(nextPresets)
  list = next
  swaps = nextSwaps
  presets = nextPresets
  if (changed.length) changeListeners.forEach((fn) => fn(changed))
  return changed.length > 0 || swapsChanged || namesChanged || presetsChanged
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

/** The VST3 instrument used everywhere instead of a built-in sound, if the user chose one. */
export function vstSwapFor(builtin: string): VstConfiguration | null {
  const id = swaps[builtin]
  if (!id?.startsWith(VST_SWAP)) return null
  return presets.find((p) => p.id === id.slice(VST_SWAP.length))?.configuration ?? null
}

/** Name of whatever replaces a built-in sound everywhere (your instrument or a VST3 preset). */
export function swapName(builtin: string): string | null {
  const id = swaps[builtin]
  if (!id) return null
  if (id.startsWith(VST_SWAP)) return presets.find((p) => p.id === id.slice(VST_SWAP.length))?.name ?? null
  return list.find((c) => c.id === id)?.name ?? null
}
