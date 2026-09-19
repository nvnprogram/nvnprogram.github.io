self.onmessage = (e) => {
  try {
    const { sampleRate, length, channels } = e.data;
    const nch = channels.length;
    const bytes = 44 + length * nch * 2;
    const buf = new ArrayBuffer(bytes);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, length * nch * 2, true);
    let o = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < nch; c++) {
        let s = channels[c][i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
        o += 2;
      }
    }
    self.postMessage({ buffer: buf }, [buf]);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
