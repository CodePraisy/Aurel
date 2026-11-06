import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') }
    },
    plugins: [
      react(),
      {
        // strict CSP for the packaged app (dev needs inline scripts for React Fast Refresh)
        name: 'aurel-csp',
        apply: 'build',
        transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: aurel: https://i.ytimg.com https://*.ytimg.com; media-src 'self' blob: aurel:; connect-src 'self' aurel:; font-src 'self' data:" />`)
      }
    ]
  }
})
