import fs from 'fs'
import { join } from 'path'
import { net } from 'electron'
import { SOUND_PACKS, packFor, type PackStatus } from '@shared/sounds'
import { paths } from './store'
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
