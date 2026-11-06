import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AurelApi } from '@shared/api'
import type { JobUpdate } from '@shared/types'
import type { VstEvent } from '@shared/sounds'

const i = ipcRenderer.invoke.bind(ipcRenderer)

const api: AurelApi = {
  platform: process.platform,
  library: {
    list: () => i('lib:list'),
    setFavorite: (id, fav) => i('lib:fav', id, fav),
    remove: (id) => i('lib:remove', id),
    collections: () => i('lib:collections'),
    createCollection: (name) => i('lib:createCollection', name),
    deleteCollection: (id) => i('lib:deleteCollection', id),
    setInCollection: (c, p, v) => i('lib:setInCollection', c, p, v),
    exportPortable: (id) => i('lib:exportPortable', id),
    importPortable: () => i('lib:importPortable'),
    reveal: (id) => i('lib:reveal', id)
  },
  project: {
    create: (p) => i('project:create', p),
    load: (id) => i('project:load', id),
    save: (p) => i('project:save', p),
    readText: (id, rel) => i('project:readText', id, rel),
    url: (id, rel) => `aurel://p/${id}/${rel.split('/').map(encodeURIComponent).join('/')}`
  },
  media: {
    pickAudio: () => i('media:pickAudio'),
    pickMidi: () => i('media:pickMidi'),
    importAudio: (path, opts) => i('media:importAudio', path, opts),
    importUrl: (url) => i('media:importUrl', url),
    analyzeRhythm: (id) => i('media:analyzeRhythm', id),
    peaks: (id) => i('media:peaks', id),
    pitchShift: (id, rel, semis) => i('media:pitchShift', id, rel, semis),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  youtube: {
    check: (url) => i('yt:check', url),
    acquire: (url) => i('yt:acquire', url),
    update: () => i('yt:update')
  },
  engine: {
    status: (force) => i('engine:status', force),
    install: () => i('engine:install'),
    process: (id) => i('engine:process', id)
  },
  jobs: {
    cancel: (id) => i('jobs:cancel', id),
    active: () => i('jobs:active'),
    onUpdate: (cb) => {
      const fn = (_: unknown, u: JobUpdate) => cb(u)
      ipcRenderer.on('job:update', fn)
      return () => ipcRenderer.removeListener('job:update', fn)
    }
  },
  settings: {
    get: () => i('settings:get'),
    set: (patch) => i('settings:set', patch)
  },
  exporter: {
    saveDialog: (name, filters) => i('export:saveDialog', name, filters),
    chooseFolder: () => i('export:chooseFolder'),
    writeFile: (path, data) => i('export:writeFile', path, data),
    writeAudio: (path, wav, format) => i('export:writeAudio', path, wav, format),
    pdf: (id, path, opts) => i('export:pdf', id, path, opts),
    openPath: (p) => i('export:openPath', p)
  },
  print: {
    ready: () => ipcRenderer.send('print:ready'),
    params: () => i('print:params')
  },
  sounds: {
    status: () => i('sounds:status'),
    download: (ids) => i('sounds:download', ids),
    url: (pack, file) => `aurel://s/${pack}/${file}`,
    customUrl: (id, file) => `aurel://c/${id}/${file}`,
    pickSamples: () => i('sounds:pickSamples'),
    addCustom: (name, files, into) => i('sounds:addCustom', name, files, into),
    removeCustom: (id) => i('sounds:removeCustom', id)
  },
  vst: {
    scan: () => i('vst:scan'),
    components: (path) => i('vst:components', path),
    failures: () => i('vst:failures'),
    clearFailures: () => i('vst:clearFailures'),
    parameters: (track, slotId, plugin) => i('vst:parameters', track, slotId, plugin),
    edit: (track, slotId, configuration, title) => i('vst:edit', track, slotId, configuration, title),
    open: (track, sampleRate, blockSize) => i('vst:open', track, sampleRate, blockSize),
    close: (track) => i('vst:close', track),
    chain: (track, slots) => i('vst:chain', track, slots),
    send: (track, lines) => ipcRenderer.send('vst:send', track, lines),
    stem: (projectId, rel, semis, speed, sampleRate) => i('vst:stem', projectId, rel, semis, speed, sampleRate),
    render: (spec) => i('vst:render', spec),
    onEvent: (cb) => {
      const fn = (_: unknown, event: VstEvent) => cb(event)
      ipcRenderer.on('vst:event', fn)
      return () => ipcRenderer.removeListener('vst:event', fn)
    }
  },
  setup: { run: () => i('setup:run') },
  updates: {
    check: () => i('updates:check'),
    install: () => i('updates:install'),
    version: () => ipcRenderer.sendSync('updates:version')
  },
  shell: { openExternal: (url) => i('shell:openExternal', url) }
}

contextBridge.exposeInMainWorld('aurel', api)

// Audio ports for VST3 tracks go straight to the page (and from there into the audio thread),
// so streamed audio never passes through this script.
ipcRenderer.on('vst:port', (event, data: { session: string }) => {
  window.postMessage({ type: 'aurel-vst-port', session: data.session }, '*', event.ports)
})
