// Test stand-in for aurel-vst-host.exe: same stdin/stdout protocol, simple sounds.
// Instruments are sine tones; effects multiply by their first parameter; a slot whose name
// contains "Crashy" crashes the process after a second of audio, like a faulty plug-in.
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const out = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32LE(type, 0); h.writeUInt32LE(body.length, 4); process.stdout.write(Buffer.concat([h, body])) }
const emit = (line) => out(2, Buffer.from(line))

if (args[0] === 'list') {
  const name = path.basename(args[1], '.vst3')
  const kind = /synth|piano/i.test(name) ? 'instrument' : 'effect'
  console.log(JSON.stringify([{ id: (name.replace(/\W/g, '').toUpperCase() + '0'.repeat(32)).slice(0, 32).replace(/[^0-9A-F]/g, 'A'), name, vendor: 'Mock', kind }]))
  process.exit(0)
}
if (args[0] === 'inspect') { console.log(JSON.stringify([{ id: 0, label: 'Level', value: 1, steps: 0 }])); process.exit(0) }
if (args[0] !== 'serve') process.exit(1)

const sr = Number(args[1]) || 48000, block = Number(args[2]) || 256
const latency = Number(process.env.MOCK_LATENCY || 0)
let chain = [], pending = [], q = 0, want = 0, discard = 0, gen = 0, events = [], held = new Map(), file = null, rendered = 0, phase = new Map()
let input = new Map()
emit('ready\t2')

function applyLine(line) {
  const f = line.split('\t')
  switch (f[0]) {
    case 'slot': {
      const [, id, on, restore, name, classId, dir, mod] = f
      pending.push({ id, on: on === '1', restore: restore === '1', name, classId, dir, mod })
      break
    }
    case 'commit': {
      const next = []
      for (const p of pending) {
        if (p.classId.startsWith('BAD')) { emit(`fail\t${p.id}\tMock refused to load.`); continue }
        const old = chain.find((c) => c.id === p.id)
        const inst = old && old.classId === p.classId ? old : { ...p, gain: 1, instrument: /synth|piano/i.test(p.name) }
        inst.on = p.on
        inst.dir = p.dir
        if (p.restore || !old) {
          try { for (const line of fs.readFileSync(path.join(p.dir, 'params.txt'), 'utf8').split('\n')) { const [k, v] = line.split('='); if (k === '0') inst.gain = Number(v) } } catch {}
        }
        next.push(inst)
      }
      chain = next; pending = []
      emit(`chain\t${f[1]}\t${latency}`)
      break
    }
    case 'param': { const inst = chain.find((c) => c.id === f[1]); if (inst && f[2] === '0') inst.gain = Number(f[3]); break }
    case 'params': emit(`params\t${f[1]}\t${JSON.stringify([{ id: 0, label: 'Level', value: chain.find((c) => c.id === f[1])?.gain ?? 1, steps: 0 }])}`); break
    case 'edit': {
      const inst = chain.find((c) => c.id === f[1])
      if (!inst) { emit(`editfail\t${f[1]}\tnot loaded`); break }
      emit(`editor\t${inst.id}\t1`)
      inst.editing = setTimeout(() => closeEditor(inst), Number(process.env.MOCK_EDIT_MS || 400))
      inst.gain = 0.5 // what the user "changed" in the editor, heard immediately
      break
    }
    case 'closeeditor': { const inst = chain.find((c) => c.id === f[1]); if (inst?.editing) { clearTimeout(inst.editing); closeEditor(inst) } break }
    case 'save': { const inst = chain.find((c) => c.id === f[1]); if (inst) save(inst); break }
    case 'flush': held.clear(); break
    case 'quit': process.exit(0); break
    case 'want': want = Math.max(want, Number(f[1])); break
    case 'reset': gen = Number(f[1]); events = []; file = null; input.clear(); q = Number(f[2]) - latency; discard = Number(f[2]); events.push({ frame: Number(f[2]), type: 'alloff' }); want = Math.max(want, Number(f[2])); break
    case 'on': events.push({ frame: Number(f[1]), type: 'on', pitch: Number(f[2]), vel: Number(f[3]) }); break
    case 'off': events.push({ frame: Number(f[1]), type: 'off', pitch: Number(f[2]) }); break
    case 'alloff': events.push({ frame: Number(f[1]), type: 'alloff' }); break
    case 'file': events.push({ frame: Number(f[1]), type: 'file', offset: Number(f[2] || 0), path: f[3] || '' }); break
  }
  events.sort((a, b) => a.frame - b.frame)
}
function save(inst) {
  inst.saves = (inst.saves || 0) + 1
  fs.writeFileSync(path.join(inst.dir, 'component.bin'), `mock-state-${inst.name}-${inst.saves}`)
  fs.writeFileSync(path.join(inst.dir, 'changed.txt'), `0=${inst.gain}\n`)
  emit(`saved\t${inst.id}`)
}
function closeEditor(inst) { inst.editing = null; save(inst); emit(`editor\t${inst.id}\t0`) }

function render() {
  while (q < want) {
    const n = block, p = q + latency
    const l = new Float32Array(n), r = new Float32Array(n)
    const inst = chain[0]?.instrument ? chain[0] : null
    for (let i = 0; i < n; i++) {
      const t = p + i
      while (events.length && events[0].frame <= t) {
        const e = events.shift()
        if (e.type === 'on') held.set(e.pitch, e.vel)
        else if (e.type === 'off') held.delete(e.pitch)
        else if (e.type === 'alloff') held.clear()
        else if (e.type === 'file') file = e.path ? { path: e.path, start: e.frame, offset: e.offset, fd: fs.openSync(e.path, 'r'), frames: fs.statSync(e.path).size / 8 } : null
      }
      let v = 0
      if (inst && inst.on) for (const [pitch, vel] of held) { const ph = (phase.get(pitch) || 0) + 2 * Math.PI * 440 * Math.pow(2, (pitch - 69) / 12) / sr; phase.set(pitch, ph); v += 0.15 * (vel / 127) * Math.sin(ph) }
      l[i] = v; r[i] = v
      if (file) {
        const idx = file.offset + (t - file.start)
        if (idx >= 0 && idx < file.frames) { const b = Buffer.alloc(8); fs.readSync(file.fd, b, 0, 8, idx * 8); l[i] += b.readFloatLE(0); r[i] += b.readFloatLE(4) }
      }
      for (const [start, pcm] of input) { const k = t - start; if (k >= 0 && k < pcm.length / 2) { l[i] += pcm[2 * k]; r[i] += pcm[2 * k + 1] } }
    }
    for (const fx of chain) if (!fx.instrument && fx.on) for (let i = 0; i < n; i++) { l[i] *= fx.gain; r[i] *= fx.gain }
    for (const [start, pcm] of input) if (start + pcm.length / 2 < p) input.delete(start)
    const from = Math.max(0, Math.min(n, discard - q))
    if (from < n) {
      const body = Buffer.alloc(16 + (n - from) * 8)
      body.writeBigInt64LE(BigInt(q + from), 0); body.writeUInt32LE(gen, 8); body.writeUInt32LE(n - from, 12)
      for (let i = from; i < n; i++) { body.writeFloatLE(l[i], 16 + (i - from) * 8); body.writeFloatLE(r[i], 20 + (i - from) * 8) }
      out(1, body)
    }
    q += n
    rendered += n
    if (chain.some((c) => /Crashy/.test(c.name)) && rendered > sr) { process.stderr.write(`crash\t${chain.find((c) => /Crashy/.test(c.name)).id}\tC0000005\n`); process.exit(3) }
  }
}

let buf = Buffer.alloc(0)
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d])
  for (;;) {
    const nl = buf.indexOf(10)
    if (nl < 0) break
    const line = buf.subarray(0, nl).toString()
    if (line.startsWith('input\t')) {
      const [, g, frame, frames] = line.split('\t')
      const need = nl + 1 + Number(frames) * 8
      if (buf.length < need) break
      const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset + nl + 1, buf.byteOffset + need))
      buf = buf.subarray(need)
      if (Number(g) === gen) input.set(Number(frame), pcm)
      continue
    }
    buf = buf.subarray(nl + 1)
    if (line) applyLine(line)
  }
  render()
})
process.stdin.on('end', () => process.exit(0))
