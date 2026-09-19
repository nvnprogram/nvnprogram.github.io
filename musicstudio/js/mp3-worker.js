importScripts('../vendor/lame.min.js');
self.onmessage = (e) => {
  try {
    const { sampleRate, length, channels, bitrate } = e.data;
    const nch = Math.min(2, channels.length);
    const enc = new lamejs.Mp3Encoder(nch, sampleRate, bitrate || 320);
    const toI16 = (f) => {
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) { let s = f[i]; s = s < -1 ? -1 : s > 1 ? 1 : s; out[i] = s < 0 ? s * 32768 : s * 32767; }
      return out;
    };
    const L = toI16(channels[0]);
    const R = nch > 1 ? toI16(channels[1]) : null;
    const parts = [];
    const block = 1152 * 8;
    for (let i = 0; i < length; i += block) {
      const l = L.subarray(i, i + block);
      const r = R ? R.subarray(i, i + block) : undefined;
      const mp3 = nch > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (mp3.length) parts.push(new Uint8Array(mp3));
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    let total = 0; for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    self.postMessage({ buffer: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
