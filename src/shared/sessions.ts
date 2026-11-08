import type { SessionTab } from './types'

export function existingSessions(sessions: SessionTab[], library: { id: string }[]): SessionTab[] {
  const ids = new Set(library.map((entry) => entry.id))
  return sessions.filter((session) => ids.has(session.projectId))
}
