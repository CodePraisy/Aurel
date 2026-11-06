// Protocol test for `aurel-vst-host serve` against real plug-ins: the Steinberg SDK's
// mda-vst3 examples (Piano, Delay, Limiter). Build them from the VST3 SDK, then:
//   AUREL_TEST_VST3=<path to mda-vst3.vst3> node native/vst-host/test/protocol-test.cjs
// On Linux the Windows host runs under Wine (paths are translated to Z:\...).
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const WINE = process.platform !== 'win32'
const win = (p) => (WINE ? 'Z:' + path.resolve(p).replace(/\//g, '\\') : path.resolve(p))
const HOST = process.env.AUREL_VST_HOST_EXE || path.join(__dirname, '../../../build/vst-host/aurel-vst-host.exe')
if (!process.env.AUREL_TEST_VST3) { console.error('Set AUREL_TEST_VST3 to the mda-vst3.vst3 bundle.'); process.exit(2) }
const PLUG = win(process.env.AUREL_TEST_VST3)
const PIANO = 'A77EA27C1F184322BBD2AD9373A2B7A0'
const DELAY = 'E5041336E9434B28B7B0126795F0C32F'
const LIMITER = 'E13C8DA072DE4A97A0890C280BDA61F8'
const SR = 48000
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aurel-host-test-'))
const dir = (name) => { const d = path.join(ROOT, name); fs.mkdirSync(d, { recursive: true }); return d }
let failures = 0
const check = (ok, label, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failures++ }

function start() {
  const proc = WINE
    ? spawn('wine', [HOST, 'serve', String(SR), '256'], { env: { WINEDEBUG: '-all', ...process.env } })
    : spawn(HOST, ['serve', String(SR), '256'])
  const s = { proc, text: [], audio: [], waiters: [], buf: Buffer.alloc(0), stderr: '' }
  proc.stderr.on('data', (d) => { s.stderr += d })
  proc.stdout.on('data', (d) => {
    s.buf = Buffer.concat([s.buf, d])
    while (s.buf.length >= 8) {
      const type = s.buf.readUInt32LE(0), len = s.buf.readUInt32LE(4)
      if (s.buf.length < 8 + len) break
      const body = s.buf.subarray(8, 8 + len)
      s.buf = s.buf.subarray(8 + len)
      if (type === 1) {
        const frame = Number(body.readBigInt64LE(0)), gen = body.readUInt32LE(8), frames = body.readUInt32LE(12)
        const pcm = new Float32Array(body.buffer.slice(body.byteOffset + 16, body.byteOffset + 16 + frames * 8))
        s.audio.push({ frame, gen, frames, pcm })
      } else s.text.push(body.toString('utf8'))
      s.waiters = s.waiters.filter((w) => !w())
    }
  })
  s.send = (...lines) => proc.stdin.write(lines.join('\n') + '\n')
  s.waitText = (pred, ms = 20000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for text; got ' + JSON.stringify(s.text.slice(-5)) + ' stderr ' + s.stderr.slice(-300))), ms)
    const test = () => { const hit = s.text.find(pred); if (hit) { clearTimeout(t); resolve(hit); return true } return false }
    if (!test()) s.waiters.push(test)
  })
  s.waitAudio = (gen, until, ms = 20000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for audio gen ${gen} until ${until}`)), ms)
    const test = () => {
      const end = Math.max(0, ...s.audio.filter((a) => a.gen === gen).map((a) => a.frame + a.frames))
      if (end >= until) { clearTimeout(t); resolve(); return true }
      return false
    }
    if (!test()) s.waiters.push(test)
  })
  return s
}

function collect(s, gen, from, to) {
  const out = new Float32Array((to - from) * 2)
  const have = new Uint8Array(to - from)
  for (const a of s.audio) {
    if (a.gen !== gen) continue
    for (let i = 0; i < a.frames; i++) {
      const f = a.frame + i
      if (f < from || f >= to) continue
      out[2 * (f - from)] = a.pcm[2 * i]; out[2 * (f - from) + 1] = a.pcm[2 * i + 1]; have[f - from] = 1
    }
  }
  return { out, have }
}
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[2 * i] ** 2 + x[2 * i + 1] ** 2; return Math.sqrt(s / Math.max(1, 2 * (b - a))) }
const firstAbove = (x, th) => { for (let i = 0; i < x.length / 2; i++) if (Math.abs(x[2 * i]) > th || Math.abs(x[2 * i + 1]) > th) return i; return -1 }

;(async () => {
  const s = start()
  await s.waitText((t) => t.startsWith('ready'))
  check(true, 'host starts in serve mode')

  // 1. instrument + effect chain
  const pianoDir = dir('piano'), delayDir = dir('delay')
  s.send(`slot\tinst\t1\t1\tmda Piano\t${PIANO}\t${win(pianoDir)}\t${PLUG}`, `slot\tfx1\t1\t1\tmda Delay\t${DELAY}\t${win(delayDir)}\t${PLUG}`, 'commit\t1')
  const chain = await s.waitText((t) => t.startsWith('chain\t1'))
  check(true, 'chain loads (piano + delay)', chain)
  const latency = Number(chain.split('\t')[2])

  // 2. timed note: heard at the exact frame asked for
  const R = 48000, note = R + 4803
  s.send('tempo\t120\t4\t4', 'playing\t1', `reset\t1\t${R}`, `on\t${note}\t60\t110`, `off\t${note + 24000}\t60`, `want\t${R + SR * 2}`)
  await s.waitAudio(1, R + SR * 2)
  const g1 = s.audio.filter((a) => a.gen === 1)
  check(g1[0].frame === R, 'first output frame is the reset frame (pre-roll discarded)', `first=${g1[0].frame}`)
  const { out, have } = collect(s, 1, R, R + SR * 2)
  check(have.every(Boolean), 'no gaps in streamed audio')
  const onset = firstAbove(out, 0.01)
  check(onset >= 4803 - 1 && onset < 4803 + 32, 'note onset lands on its frame', `onset at +${onset} (expected +4803), latency ${latency}`)
  check(rms(out, 0, 4790) < 1e-4, 'silence before the note')
  check(rms(out, 4800, 14400) > 0.01, 'piano is audible', `rms ${rms(out, 4800, 14400).toFixed(4)}`)

  // 3. live parameter change + save
  s.send('params\tfx1')
  const params = JSON.parse((await s.waitText((t) => t.startsWith('params\tfx1'))).split('\t')[2])
  check(params.length > 0, 'parameter list from the live instance', `${params.length} params: ${params.slice(0, 3).map((p) => p.label).join(', ')}`)
  s.send(`param\tfx1\t${params[0].id}\t0.9`, 'save\tfx1')
  await s.waitText((t) => t === 'saved\tfx1')
  check(fs.existsSync(path.join(delayDir, 'component.bin')), 'state saved to the slot folder')
  check(fs.readFileSync(path.join(delayDir, 'changed.txt'), 'utf8').includes(`${params[0].id}=0.9`), 'changed parameter recorded')

  // 4. seek: new generation, old timeline dropped
  const R2 = 300000
  s.send(`reset\t2\t${R2}`, `on\t${R2 + 5}\t64\t100`, `off\t${R2 + 12000}\t64`, `want\t${R2 + SR}`)
  await s.waitAudio(2, R2 + SR)
  const g2 = collect(s, 2, R2, R2 + SR)
  check(firstAbove(g2.out, 0.01) < 64, 'after seek the note sounds immediately', `onset +${firstAbove(g2.out, 0.01)}`)

  // 5. effect-only chain playing a recorded stem from a file, sample accurate
  const stem = path.join(ROOT, 'stem.f32')
  const sine = new Float32Array(SR * 2 * 2)
  for (let i = 0; i < SR * 2; i++) sine[2 * i] = sine[2 * i + 1] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
  fs.writeFileSync(stem, Buffer.from(sine.buffer))
  const limDir = dir('limiter')
  s.send(`slot\tfx2\t1\t1\tmda Limiter\t${LIMITER}\t${win(limDir)}\t${PLUG}`, 'commit\t2')
  await s.waitText((t) => t.startsWith('chain\t2'))
  const R3 = 600000
  s.send(`reset\t3\t${R3}`, `file\t${R3 + 1000}\t0\t${win(stem)}`, `want\t${R3 + SR}`)
  await s.waitAudio(3, R3 + SR)
  const g3 = collect(s, 3, R3, R3 + SR)
  const stemOnset = firstAbove(g3.out, 0.001)
  check(Math.abs(stemOnset - 1000) <= 2, 'stem starts on its frame through the effect', `onset +${stemOnset}`)
  check(rms(g3.out, 2000, 40000) > 0.1, 'stem is audible through the chain', `rms ${rms(g3.out, 2000, 40000).toFixed(3)}`)

  // 5b. live input (Aurel's built-in instruments through VST3 effects), stamped and generation-checked
  const R6 = 900000
  s.send(`reset\t6\t${R6}`, `want\t${R6}`)
  const chunk = new Float32Array(4096 * 2)
  for (let i = 0; i < 4096; i++) chunk[2 * i] = chunk[2 * i + 1] = 0.4 * Math.sin(2 * Math.PI * 330 * i / SR)
  const stale = new Float32Array(1024 * 2).fill(0.9)
  s.proc.stdin.write(Buffer.concat([
    Buffer.from(`input\t5\t${R6 + 100}\t1024\n`), Buffer.from(stale.buffer), // old generation: must be ignored
    Buffer.from(`input\t6\t${R6 + 2003}\t4096\n`), Buffer.from(chunk.buffer)
  ]))
  s.send(`want\t${R6 + SR}`)
  await s.waitAudio(6, R6 + SR)
  const g6 = collect(s, 6, R6, R6 + SR)
  const liveOnset = firstAbove(g6.out, 0.001)
  check(Math.abs(liveOnset - 2003) <= 2, 'live input is heard at its stamped frame', `onset +${liveOnset}`)
  check(rms(g6.out, 2100, 6000) > 0.1, 'live input passes through the effect', `rms ${rms(g6.out, 2100, 6000).toFixed(3)}`)

  // 6. idle: nothing playing, a far-ahead request returns instantly without work
  s.send(`reset\t4\t${R3 + SR * 10}`, 'playing\t0')
  const t0 = Date.now()
  s.send(`want\t${R3 + SR * 40}`)
  await new Promise((r) => setTimeout(r, 600))
  const g4 = s.audio.filter((a) => a.gen === 4).reduce((n, a) => n + a.frames, 0)
  check(g4 < SR * 4, 'idle tracks skip ahead instead of rendering silence', `${g4} frames rendered in ${Date.now() - t0} ms`)

  // 7. speed: render 60 s of piano chords as fast as possible
  s.send(`slot\tinst\t1\t0\tmda Piano\t${PIANO}\t${win(pianoDir)}\t${PLUG}`, 'commit\t3')
  await s.waitText((t) => t.startsWith('chain\t3'))
  const R5 = 10_000_000
  const lines = [`reset\t5\t${R5}`, 'playing\t1']
  for (let b = 0; b < 120; b++) for (const p of [60, 64, 67]) lines.push(`on\t${R5 + b * 24000 + 7}\t${p}\t90`, `off\t${R5 + b * 24000 + 20000}\t${p}`)
  const t1 = Date.now()
  s.send(...lines, `want\t${R5 + SR * 60}`)
  await s.waitAudio(5, R5 + SR * 60, 60000)
  const ms = Date.now() - t1
  check(ms < 20000, 'renders faster than real time', `60 s of audio in ${ms} ms (${(60000 / ms).toFixed(1)}x real time)`)

  // 8. failures are named, not hidden
  s.send(`slot\tbad\t1\t1\tMissing\t${'0'.repeat(32)}\t${win(dir('bad'))}\t${PLUG}`, 'commit\t4')
  const fail = await s.waitText((t) => t.startsWith('fail\tbad'))
  check(true, 'missing plug-in reports an error', fail)

  s.send('flush', 'quit')
  const code = await new Promise((r) => s.proc.on('exit', r))
  check(code === 0, 'clean exit', `code ${code}`)
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('HARNESS ERROR', e.message); process.exit(2) })
