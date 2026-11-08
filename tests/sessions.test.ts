import { describe, expect, it } from 'vitest'
import { existingSessions } from '../src/shared/sessions'
import { youtubeSourceLink } from '../src/shared/youtube'

describe('saved session cleanup', () => {
  it('removes every stale tab when the last song is deleted', () => {
    expect(existingSessions([{ projectId: 'deleted' }, { projectId: 'also-deleted', folder: 'folder' }], [])).toEqual([])
  })
  it('retains existing sessions, their order, and their folders', () => {
    const keep = { projectId: 'keep', folder: 'folder' }
    expect(existingSessions([{ projectId: 'deleted' }, keep, { projectId: 'other' }], [{ id: 'other' }, { id: 'keep' }])).toEqual([keep, { projectId: 'other' }])
  })
})

describe('original video links', () => {
  it('recovers a canonical link from saved short URLs or a fallback source', () => {
    expect(youtubeSourceLink('https://youtu.be/dQw4w9WgXcQ?t=32')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(youtubeSourceLink(undefined, 'C:/audio.wav', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(youtubeSourceLink('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})
