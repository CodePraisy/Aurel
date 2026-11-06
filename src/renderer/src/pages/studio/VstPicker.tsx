import { useEffect, useState } from 'react'
import type { VstConfiguration, VstModule } from '@shared/sounds'
import { api } from '@/lib/api'
import { Select } from '@/components/menu'

export default function VstPicker({ kind, onPick }: {
  kind: VstConfiguration['plugin']['kind']; onPick: (configuration: VstConfiguration) => void
}) {
  const [modules, setModules] = useState<VstModule[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [choices, setChoices] = useState<VstConfiguration['plugin'][]>([])
  useEffect(() => {
    void api.vst.scan().then(({ available, modules: found }) => {
      setModules(found)
      if (!available) setError('This build does not include the Windows VST3 host.')
      else if (!found.length) setError('No VST3 plug-ins found. Add a folder in Settings → Effects & VST3.')
    }).catch((e: Error) => setError(e.message)).finally(() => setBusy(false))
  }, [])
  const pick = (plugin: VstConfiguration['plugin']) => onPick({ plugin, params: {} })
  const choose = async (path: string) => {
    const module = modules.find((entry) => entry.path === path)
    if (!module || busy) return
    setSelected(path)
    setChoices([])
    setError('')
    setBusy(true)
    try {
      const variants = (await api.vst.components(path)).filter((entry) => entry.kind === kind).map((entry) => ({ ...module, ...entry }))
      if (variants.length === 1) pick(variants[0])
      else if (variants.length > 1) setChoices(variants)
      else setError(`This plug-in does not expose a VST3 ${kind}.`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      {!!modules.length && <Select value={selected} onChange={(path) => void choose(path)} options={[
        { value: '', label: 'Choose an installed VST3…' },
        ...modules.map((module) => ({ value: module.path, label: module.name }))
      ]} />}
      {!!choices.length && <Select value="" onChange={(id) => {
        const plugin = choices.find((entry) => entry.id === id)
        if (plugin) pick(plugin)
      }} options={[
        { value: '', label: `Choose a VST3 ${kind}…` },
        ...choices.map((plugin) => ({ value: plugin.id, label: plugin.name }))
      ]} />}
      {busy && <p className="text-muted text-[12px]" role="status">{selected ? 'Checking plug-in…' : 'Finding installed VST3 plug-ins…'}</p>}
      {error && <p className="text-bad text-[12px]" role="alert">{error}</p>}
    </div>
  )
}
