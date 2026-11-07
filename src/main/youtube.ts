import fs from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { net } from 'electron'
import type { Project, YouTubeCheck, YouTubeMeta } from '@shared/types'
import { paths, findDuplicate, saveProjectFile, indexProject, writeAtomic } from './store'
import { computePeaks, emptyTranscriptionProject, newId, toWav, applyTempoGuess, trimLeadingSilence } from './media'
import type { JobCtx } from './jobs'
import { ytDlpCmd, installYtDlp, toolEnv } from './tools'

export { parseYouTubeId } from '@shared/youtube'
import { parseYouTubeId } from '@shared/youtube'

export function ytDlpVersion(): Promise<{ available: boolean; version?: string; path?: string }> {
  return new Promise((resolve) => {
    const p = spawn(ytDlpCmd(), ['--version'], { windowsHide: true, env: toolEnv() })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve({ available: false }))
    p.on('close', (code) => resolve(code === 0 ? { available: true, version: out.trim(), path: ytDlpCmd() } : { available: false }))
  })
}

async function oembed(id: string): Promise<Partial<YouTubeMeta> | null> {
  try {
    const r = await net.fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)
    if (!r.ok) return null
    const j = (await r.json()) as { title: string; author_name: string; thumbnail_url: string }
    return { title: j.title, channel: j.author_name, thumbnail: j.thumbnail_url }
  } catch { return null }
}

function ytJson(url: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    // No cookies, no credentials: only content that is publicly accessible is ever considered.
    const p = spawn(ytDlpCmd(), ['-J', '--no-playlist', '--skip-download', '--no-warnings', url], { windowsHide: true, env: toolEnv() })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve(null))
    p.on('close', () => { try { resolve(JSON.parse(out)) } catch { resolve(null) } })
  })
}

/** Validate the link and gather metadata for the import dialog. */
export async function checkYouTube(url: string): Promise<YouTubeCheck> {
  const id = parseYouTubeId(url)
  const tool = await ytDlpVersion()
  if (!id) return { meta: null, error: 'That does not look like a YouTube video link.', tool, acquirable: false, reasons: [], creativeCommons: false }
  const canonical = `https://www.youtube.com/watch?v=${id}`
  const base = await oembed(id)
  let meta: YouTubeMeta | null = base ? { id, url: canonical, title: base.title!, channel: base.channel!, thumbnail: base.thumbnail! } : null
  const reasons: string[] = []
  if (tool.available) {
    const info = await ytJson(canonical)
    if (info) {
      meta = {
        id, url: canonical,
        title: (info.title as string) ?? meta?.title ?? id,
        channel: (info.channel as string) ?? (info.uploader as string) ?? meta?.channel ?? '',
        thumbnail: (info.thumbnail as string) ?? meta?.thumbnail ?? '',
        duration: info.duration as number | undefined,
        license: (info.license as string) || undefined,
        isLive: !!info.is_live
      }
      if (meta.isLive) reasons.push('Live streams can’t be imported until they have ended.')
    } else if (!meta) reasons.push('This video could not be found. It may be private or removed.')
  }
  if (!meta) meta = { id, url: canonical, title: `YouTube video ${id}`, channel: '', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }
  return { meta, tool, acquirable: reasons.length === 0, reasons, creativeCommons: !!meta.license && /creative commons/i.test(meta.license), duplicateOf: findDuplicate('youtube_id', id) }
}

export async function acquireYouTubeJob(ctx: JobCtx, url: string): Promise<{ projectId: string; duplicate?: boolean }> {
  ctx.progress('Preparing', -1)
  await installYtDlp(ctx)
  ctx.progress('Checking video', -1)
  const check = await checkYouTube(url)
  if (!check.meta) throw new Error(check.error ?? check.reasons[0] ?? 'Invalid link')
  if (check.duplicateOf) return { projectId: check.duplicateOf, duplicate: true }
  if (!check.acquirable) throw new Error(check.reasons.join('\n'))
  const meta = check.meta
  const id = newId()
  const dir = paths.project(id)
  const dl = join(dir, 'audio', 'download')
  fs.mkdirSync(join(dir, 'audio'), { recursive: true })
  try {
    const r = await ctx.run(ytDlpCmd(), [
      '-f', 'bestaudio/best', '--no-playlist', '--no-part', '--newline', '--no-warnings',
      '--ffmpeg-location', paths.ffmpeg, '-o', `${dl}.%(ext)s`, meta.url
    ], {
      env: toolEnv(),
      onLine: (l) => {
        const m = l.match(/\[download\]\s+([\d.]+)%/)
        if (m) ctx.progress('Downloading audio', +m[1] / 100, l.replace('[download]', '').trim())
      }
    })
    const file = fs.readdirSync(join(dir, 'audio')).find((f) => f.startsWith('download.'))
    if (r.code !== 0 || !file) throw new Error(`Download failed.\n${r.err.split('\n').filter(Boolean).slice(-3).join('\n')}`)
    const src = join(dir, 'audio', file)
    await toWav(ctx, src, join(dir, 'audio', 'original.wav'), meta.duration ?? 0, 'Converting audio')
    fs.rmSync(src, { force: true })
    ctx.progress('Saving to library', -1)
    const trimmed = trimLeadingSilence(join(dir, 'audio', 'original.wav'))
    writeAtomic(join(dir, 'peaks.json'), JSON.stringify(computePeaks(join(dir, 'audio', 'original.wav'))))
    if (meta.thumbnail) {
      try { const t = await net.fetch(meta.thumbnail); if (t.ok) fs.writeFileSync(join(dir, 'artwork.jpg'), Buffer.from(await t.arrayBuffer())) } catch { /* artwork optional */ }
    }
    const p: Project = emptyTranscriptionProject(id, meta.title, meta.channel, Math.max(0, (meta.duration ?? 0) - trimmed))
    p.audio!.trimmed = trimmed
    p.audio!.sourceUrl = meta.url
    p.audio!.youtube = meta
    ctx.progress('Detecting tempo & time signature', -1)
    applyTempoGuess(p, join(dir, 'audio', 'original.wav'))
    const existing = findDuplicate('youtube_id', meta.id)
    if (existing) {
      fs.rmSync(dir, { recursive: true, force: true })
      return { projectId: existing, duplicate: true }
    }
    saveProjectFile(p)
    indexProject(p, { youtubeId: meta.id, source: meta.url, artwork: fs.existsSync(join(dir, 'artwork.jpg')) ? 'artwork.jpg' : undefined })
    return { projectId: id }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}
