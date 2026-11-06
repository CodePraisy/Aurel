import fs from 'fs'
import { basename, extname, join } from 'path'
import { spawn } from 'child_process'
import { net } from 'electron'
import { SOUND_PACKS, packFor, noteFromName, type CustomSound, type PackStatus } from '@shared/sounds'
import type { Settings } from '@shared/types'
import { getSettings, paths, setSettings } from './store'
import type { JobCtx } from './jobs'

export function packStatus(): PackStatus[] {
  return SOUND_PACKS.map((p) => {
    const dir = join(paths.sounds, p.id)
    const have = p.files.filter((f) => fs.existsSync(join(dir, f.file))).length
    return { id: p.id, have, total: p.files.length, ready: have === p.files.length }
  })
}

async function fetchTo(url: string, file: string, tries = 3): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await net.fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      fs.writeFileSync(`${file}.part`, buf)
      fs.renameSync(`${file}.part`, file)
      return
    } catch (e) {
      if (i === tries - 1) throw e
      await new Promise((res) => setTimeout(res, 600 * (i + 1)))
    }
  }
}

/** Download sample packs (skipping files already present), 8 at a time. */
export async function downloadPacksJob(ctx: JobCtx, ids: string[]): Promise<PackStatus[]> {
  const todo: { url: string; file: string }[] = []
  for (const id of ids) {
    const p = packFor(id)
    if (!p) continue
    const dir = join(paths.sounds, id)
    fs.mkdirSync(dir, { recursive: true })
    for (const f of p.files) if (!fs.existsSync(join(dir, f.file))) todo.push({ url: f.url, file: join(dir, f.file) })
  }
  let done = 0
  let failed = 0
  const worker = async () => {
    while (todo.length) {
      ctx.check()
      const t = todo.shift()!
      try { await fetchTo(t.url, t.file) } catch { failed++ }
      done++
      ctx.progress('Downloading instrument sounds', done / (done + todo.length), `${done} files`)
    }
  }
  ctx.progress('Downloading instrument sounds', 0)
  await Promise.all(Array.from({ length: 8 }, worker))
  if (failed) throw new Error(`${failed} sound files could not be downloaded. Check your internet connection and try again from Settings → Sounds.`)
  return packStatus()
}

// ---------- your own instruments ----------
const MAX_SAMPLES = 128

function convert(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 44.1 kHz stereo WAV, at most 60 s per sample
    const p = spawn(paths.ffmpeg, ['-hide_banner', '-y', '-i', input, '-vn', '-map_metadata', '-1', '-t', '60', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', output], { windowsHide: true })
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`Could not read ${basename(input)}. Use a WAV, AIFF, FLAC, MP3, OGG or M4A file.`))))
  })
}

/**
 * Copy samples into Aurel as a new instrument (or add them to an existing one, `into`).
 * Each sample's root note comes from its file name when it has one, otherwise from the
 * order the files were chosen, starting at middle C.
 */
export async function addCustomSound(name: string, files: string[], into?: string): Promise<Settings> {
  if (!Array.isArray(files) || !files.length) throw new Error('Choose at least one audio file.')
  const settings = getSettings()
  const existing = into ? settings.customSounds.find((c) => c.id === into) : undefined
  if (into && !existing) throw new Error('That instrument no longer exists.')
  const id = existing?.id ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const dir = join(paths.customSounds, id)
  fs.mkdirSync(dir, { recursive: true })
  const samples = [...(existing?.samples ?? [])]
  const taken = new Set(samples.map((s) => s.note))
  let next = 60
  for (const file of files.slice(0, MAX_SAMPLES - samples.length)) {
    if (typeof file !== 'string' || !fs.existsSync(file)) continue
    const stem = basename(file, extname(file)).replace(/[^\w-]+/g, '_').slice(0, 40) || 'sample'
    const out = `${samples.length + 1}-${stem}.wav`
    await convert(file, join(dir, out))
    let note = noteFromName(basename(file))
    if (note === null) { while (taken.has(next)) next++; note = next }
    taken.add(note)
    samples.push({ file: out, note })
  }
  if (!samples.length) throw new Error('None of the chosen files could be used.')
  const sound: CustomSound = { id, name: (typeof name === 'string' && name.trim().slice(0, 60)) || existing?.name || 'My instrument', samples: samples.sort((a, b) => a.note - b.note) }
  const list = existing ? settings.customSounds.map((c) => (c.id === id ? sound : c)) : [...settings.customSounds, sound]
  return setSettings({ customSounds: list })
}

export function removeCustomSound(id: string): Settings {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid instrument.')
  const settings = getSettings()
  const swaps = Object.fromEntries(Object.entries(settings.soundSwaps).filter(([, c]) => c !== id))
  const next = setSettings({ customSounds: settings.customSounds.filter((c) => c.id !== id), soundSwaps: swaps })
  fs.rmSync(join(paths.customSounds, id), { recursive: true, force: true })
  return next
}
