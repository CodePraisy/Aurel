export function youtubeSourceLink(...sources: (string | undefined | null)[]): string | null {
  for (const source of sources) {
    const id = source && parseYouTubeId(source)
    if (id) return `https://www.youtube.com/watch?v=${id}`
  }
  return null
}

export function parseYouTubeId(input: string): string | null {
  let u: URL
  try { u = new URL(input.trim()) } catch { return null }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/)
      if (m) id = m[2]
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null
}
