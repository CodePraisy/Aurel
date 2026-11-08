import { useApp } from '@/store/app'

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    useApp.getState().toast('Original video link copied', 'ok')
  } catch {
    useApp.getState().toast('Could not copy the link. Select it in the song information and copy it manually.', 'error')
  }
}
