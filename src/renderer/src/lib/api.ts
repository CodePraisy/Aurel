import type { AurelApi } from '@shared/api'

declare global { interface Window { aurel: AurelApi } }

export const api: AurelApi = window.aurel
