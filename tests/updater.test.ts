import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'

const mocks = vi.hoisted(() => ({ root: '', fetch: vi.fn(), quit: vi.fn(), spawn: vi.fn() }))
vi.mock('electron', () => ({ app: { getVersion: () => '0.6.2', getPath: () => process.platform === 'darwin' ? join(mocks.root, 'Aurel.app/Contents/MacOS/Aurel') : 'C:/Users/Test/Aurel/Aurel.exe', quit: mocks.quit }, net: { fetch: mocks.fetch }, shell: { openExternal: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/store', () => ({ paths: { get data() { return mocks.root } } }))
vi.mock('child_process', () => ({ spawn: mocks.spawn }))

beforeEach(() => {
  vi.resetModules()
  mocks.root = fs.mkdtempSync(join(tmpdir(), 'aurel-update-test-'))
  mocks.fetch.mockReset(); mocks.quit.mockReset(); mocks.spawn.mockReset()
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
})
afterEach(() => {
  vi.useRealTimers()
  expect(mocks.root.startsWith(join(tmpdir(), 'aurel-update-test-'))).toBe(true)
  fs.rmSync(mocks.root, { recursive: true, force: true })
})

function release() {
  return new Response(JSON.stringify({ tag_name: 'v999.0.0', html_url: 'https://github.com/CodePraisy/Aurel/releases', assets: [
    { name: 'Aurel-999.0.0-Windows-x64.exe', size: 4, browser_download_url: 'https://example.com/update' },
    { name: `Aurel-999.0.0-macOS-${process.arch}.zip`, size: 4, browser_download_url: 'https://example.com/update' }
  ] }))
}

describe('background app updates', () => {
  it('does not launch an installer or quit until explicitly told to restart', async () => {
    const updater = await import('../src/main/updater')
    mocks.fetch.mockResolvedValueOnce(release()).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4])))
    const controller = new AbortController()
    const ctx = { id: 'test', signal: controller.signal, check: vi.fn(), progress: vi.fn(), log: vi.fn(), run: vi.fn() }
    await updater.installUpdate(ctx)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    // A later update request reuses the completed download.
    await updater.installUpdate(ctx)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    vi.useFakeTimers()
    await updater.restartForUpdate()
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(601)
    expect(mocks.quit).toHaveBeenCalledTimes(1)
  })

  it('cancels a stalled body immediately, removes partial files, and permits retry', async () => {
    const updater = await import('../src/main/updater')
    const { startJob, cancelJob } = await import('../src/main/jobs')
    let stalled!: () => void
    const started = new Promise<void>((resolve) => { stalled = resolve })
    mocks.fetch.mockResolvedValueOnce(release()).mockImplementationOnce(async () => {
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])) } }))
    })
    let done!: (update: import('../src/shared/types').JobUpdate) => void
    const finished = new Promise<import('../src/shared/types').JobUpdate>((resolve) => { done = resolve })
    const id = startJob('update', updater.installUpdate, (update) => { if (update.pct > 0) stalled(); if (update.done) done(update) })
    await started
    cancelJob(id)
    expect((await finished).error).toBe('Cancelled')
    expect(fs.readdirSync(join(mocks.root, 'updates'))).toEqual([])
    expect(mocks.spawn).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4])))
    const controller = new AbortController()
    await updater.installUpdate({ id: 'retry', signal: controller.signal, check: vi.fn(), progress: vi.fn(), log: vi.fn(), run: vi.fn() })
    expect(fs.readdirSync(join(mocks.root, 'updates'))).toHaveLength(1)
  })
})
