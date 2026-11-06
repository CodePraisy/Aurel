// Plays one VST3 track's audio as the host streams it in, and asks the host for more.
// Every block from the host is stamped with the frame of the audio clock it belongs to,
// so playback stays sample-locked to the metronome and other tracks.

class AurelStream extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options.processorOptions || {}
    this.size = o.ring || 262144
    this.left = new Float32Array(this.size)
    this.right = new Float32Array(this.size)
    this.stamp = new Float64Array(this.size).fill(-1)
    this.lookahead = o.lookahead || 2048
    this.interval = o.interval || 256
    this.gen = 0
    this.nextWant = 0
    this.receivedEnd = 0
    this.expectFrom = Infinity
    this.xruns = 0
    this.lastReport = 0
    this.host = null
    // capture: the built-in instrument plays `delay` frames early; its sound is sent ahead to the host
    this.delay = -1
    this.cap = new Float32Array(2 * 1024)
    this.capFrames = 0
    this.capStart = 0
    this.capLoud = false
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.type === 'port') {
        this.host = m.port
        this.host.onmessage = (ev) => this.receive(ev.data)
        this.nextWant = 0
      } else if (m.type === 'reset') this.reset(m.gen, m.frame)
      else if (m.type === 'expect') this.expectFrom = m.frame
      else if (m.type === 'lookahead') this.lookahead = m.frames
      else if (m.type === 'capture') { this.delay = m.delay; this.capFrames = 0 }
    }
  }

  reset(gen, frame) {
    this.gen = gen
    this.receivedEnd = frame
    const stamp = this.stamp
    for (let i = 0; i < stamp.length; i++) if (stamp[i] >= frame) stamp[i] = -1
  }

  receive(m) {
    if (!m || m.g < this.gen) return
    if (m.g > this.gen) this.reset(m.g, m.f)
    const d = m.d
    const n = d.length >> 1
    const size = this.size
    let idx = ((m.f % size) + size) % size
    for (let i = 0; i < n; i++) {
      this.left[idx] = d[2 * i]
      this.right[idx] = d[2 * i + 1]
      this.stamp[idx] = m.f + i
      if (++idx === size) idx = 0
    }
    if (m.f + n > this.receivedEnd) this.receivedEnd = m.f + n
  }

  capture(input, start) {
    const l = input[0], r = input[1] || input[0]
    const n = l.length
    if (this.capFrames === 0) { this.capStart = start; this.capLoud = false }
    const buf = this.cap
    let o = this.capFrames * 2
    for (let i = 0; i < n; i++) {
      const a = l[i], b = r[i]
      buf[o++] = a; buf[o++] = b
      if (!this.capLoud && (a > 1e-6 || a < -1e-6 || b > 1e-6 || b < -1e-6)) this.capLoud = true
    }
    this.capFrames += n
    if (this.capFrames * 2 >= buf.length) {
      // silent stretches are not sent: the host treats missing input as silence
      if (this.capLoud && this.host) this.host.postMessage({ i: this.capStart + this.delay, g: this.gen, d: buf.slice(0, this.capFrames * 2) })
      this.capFrames = 0
    }
  }

  process(inputs, outputs) {
    if (this.delay >= 0 && inputs[0] && inputs[0].length) this.capture(inputs[0], currentFrame)
    const out = outputs[0]
    const l = out[0], r = out[1] || out[0]
    const n = l.length
    const start = currentFrame
    const size = this.size
    let missing = 0
    for (let i = 0; i < n; i++) {
      const f = start + i
      const idx = f % size
      if (this.stamp[idx] === f) { l[i] = this.left[idx]; r[i] = this.right[idx] }
      else {
        l[i] = 0; r[i] = 0
        if (f >= this.expectFrom && f < this.receivedEnd + size) missing++
      }
    }
    if (missing && start >= this.expectFrom && this.receivedEnd <= start) this.xruns++
    if (this.host && start >= this.nextWant) {
      this.host.postMessage({ want: start + n + this.lookahead })
      this.nextWant = start + this.interval
    }
    if (this.xruns && this.host && start - this.lastReport > sampleRate) {
      this.host.postMessage({ xrun: this.xruns })
      this.xruns = 0
      this.lastReport = start
    }
    return true
  }
}

registerProcessor('aurel-stream', AurelStream)
