/** Encode planar float channels to a RIFF WAV (PCM 16/24 or IEEE float 32). */
export function encodeWav(channels: Float32Array[], sampleRate: number, bitDepth: 16 | 24 | 32): Uint8Array {
  const nCh = channels.length
  const len = channels[0]?.length ?? 0
  const bps = bitDepth / 8
  const dataBytes = len * nCh * bps
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, bitDepth === 32 ? 3 : 1, true)
  v.setUint16(22, nCh, true); v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * bps, true)
  v.setUint16(32, nCh * bps, true); v.setUint16(34, bitDepth, true)
  w(36, 'data'); v.setUint32(40, dataBytes, true)
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]))
      if (bitDepth === 16) { v.setInt16(o, Math.round(x * 32767), true); o += 2 }
      else if (bitDepth === 24) { const n = Math.round(x * 8388607); v.setUint8(o, n & 255); v.setUint8(o + 1, (n >> 8) & 255); v.setUint8(o + 2, (n >> 16) & 255); o += 3 }
      else { v.setFloat32(o, x, true); o += 4 }
    }
  }
  return new Uint8Array(buf)
}

export function peakNormalize(channels: Float32Array[], target = 0.966): void {
  let peak = 0
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]))
  if (peak < 1e-6) return
  const g = target / peak
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g
}
