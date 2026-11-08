// Screenshots of the built app (npm run build first), under Xvfb:
//   xvfb-run -a node tools/screens/shoot.mjs <userDataDir> <outDir> [projectId]
import { createRequire } from 'module'
const { _electron: electron } = createRequire(import.meta.url)('playwright')
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const [userData, outDir, projectId] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const themes = (process.env.THEMES ?? 'dark,light').split(',')
const settingsFile = join(userData, 'settings.json')
for (const theme of themes) {
  const prev = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {}
  writeFileSync(settingsFile, JSON.stringify({ ...prev, theme, termsAccepted: true, setupDone: true, autoSetup: false, checkUpdates: false, particles: 0 }))
  const app = await electron.launch({ executablePath: join(process.cwd(), 'node_modules/electron/dist/electron'), args: ['.', `--user-data-dir=${userData}`, '--no-sandbox'], cwd: process.cwd(), env: { ...process.env, ELECTRON_DISABLE_GPU: '1' } })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForTimeout(2500)
  await win.screenshot({ path: join(outDir, `${theme}-home.png`) })
  if (projectId) {
    await win.evaluate((id) => { const s = window.__aurelGo; if (s) s(id) }, projectId).catch(() => {})
    const card = win.locator('button', { hasText: process.env.DEMO_TITLE ?? 'Blur of Life' }).first()
    if (await card.count()) await card.click()
    await win.waitForTimeout(4000)
    await win.screenshot({ path: join(outDir, `${theme}-studio.png`) })
  }
  if (process.env.SETTINGS) {
    await win.keyboard.press('Escape')
    await win.locator('nav button', { hasText: 'Settings' }).first().click().catch(() => {})
    await win.waitForTimeout(1200)
    await win.screenshot({ path: join(outDir, `${theme}-settings.png`) })
  }
  await app.close()
}
