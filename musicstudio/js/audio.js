export const REVERB_DECAY = 5;
export const REVERB_PREDELAY = 0.01;

let sharedCtx = null;
export function audioContext() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedCtx;
}

const irCache = new Map();
export function impulseResponse(ctx, sampleRate = ctx.sampleRate) {
  const key = sampleRate;
  if (irCache.has(key)) return irCache.get(key);
  const len = Math.ceil((REVERB_DECAY + REVERB_PREDELAY) * sampleRate);
  const buf = ctx.createBuffer(2, len, sampleRate);
  const tc = Math.log(REVERB_DECAY + 1) / Math.log(200);
  const pre = Math.round(REVERB_PREDELAY * sampleRate);
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      d[i] = (rnd() * 2 - 1) * Math.exp(-t / tc);
    }
  }
  irCache.set(key, buf);
  return buf;
}

export function equalPower(wet) {
  const w = Math.min(1, Math.max(0, wet));
  return { dry: Math.cos(w * Math.PI / 2), wet: Math.sin(w * Math.PI / 2) };
}

// Decode any browser-supported container (mp3, wav, flac, ogg, m4a, aac, webm...)
export async function decodeFile(file) {
  const ab = await file.arrayBuffer();
  const ctx = audioContext();
  return await new Promise((res, rej) => {
    // callback form for widest support (Safari)
    const p = ctx.decodeAudioData(ab.slice(0), res, rej);
    if (p && p.then) p.then(res, rej);
  });
}

// Builds the processing graph on any BaseAudioContext; returns nodes + input.
export function buildGraph(ctx, { playbackRate, reverbWetMix, gain = 1 }) {
  const dry = ctx.createGain(), wet = ctx.createGain(), master = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = impulseResponse(ctx, ctx.sampleRate);
  const ep = equalPower(reverbWetMix);
  dry.gain.value = ep.dry; wet.gain.value = ep.wet; master.gain.value = gain;
  conv.connect(wet);
  dry.connect(master); wet.connect(master);
  master.connect(ctx.destination);
  return { dry, wet, master, conv, playbackRate };
}

// 1 s of 16-bit mono digital silence as a WAV blob URL. A looping <audio> playing this keeps the page's audio
// session alive on iOS Safari (Web Audio alone is suspended as soon as the tab is backgrounded / screen locks)
let silentUrl = null;
function silentWavUrl(rate = 8000, seconds = 1) {
  if (silentUrl) return silentUrl;
  const n = rate * seconds, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

export class Player {
  constructor() {
    this.ctx = audioContext();
    this.graph = buildGraph(this.ctx, { playbackRate: 1, reverbWetMix: 0, gain: 0.9 });
    this.keep = document.createElement('audio');   // session keep-alive (see silentWavUrl)
    this.keep.loop = true; this.keep.preload = 'auto'; this.keep.setAttribute('playsinline', ''); this.keep.src = silentWavUrl();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.playing) this._reassert(); });
    this.ctx.addEventListener('statechange', () => { if (this.ctx.state !== 'running' && this.playing && !document.hidden) this._reassert(); });
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this._offset = 0;          // buffer position (seconds of the source) when (re)started
    this._startedAt = 0;       // ctx time the current source started
    this._rate = 1;
    this._wet = 0;
    this.onended = null;       // called when playback reaches the end naturally
    this._endTimer = null;
  }
  get duration() { return this.buffer ? this.buffer.duration : 0; }
  get rate() { return this._rate; }
  get reverb() { return this._wet; }
  get volume() { return this.graph.master.gain.value; }

  setBuffer(buf) { this.stop(); this.buffer = buf; this._offset = 0; }
  _keepAlive(on) {
    const k = this.keep;
    if (on) { const p = k.play(); if (p && p.catch) p.catch(() => { /* needs a gesture first; retried on the next play() */ }); }
    else if (!k.paused) k.pause();
  }
  // Call synchronously inside a user gesture (click on a file chooser, the file input's change event): resumes the
  // context and plays the keep-alive element once so later programmatic play() (after async decoding) is allowed on iOS.
  unlock() { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); this._keepAlive(true); if (!this.playing && !this.buffer) this._unlockPending = true; }
  // back in the foreground / after an interruption (call, Siri): resume the context and re-assert the keep-alive
  _reassert() { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); this._keepAlive(true); }

  position() {
    if (!this.buffer) return 0;
    if (!this.playing) return this._offset;
    const p = this._offset + (this.ctx.currentTime - this._startedAt) * this._rate;
    return Math.min(this.buffer.duration, Math.max(0, p));
  }
  outputDuration() { return this.buffer ? this.buffer.duration / this._rate : 0; }

  setVolume(v, ramp = 0.03) {
    const g = this.graph.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), t + ramp);
  }
  setReverb(w) {
    this._wet = w;
    const ep = equalPower(w), t = this.ctx.currentTime;
    for (const [n, v] of [[this.graph.dry, ep.dry], [this.graph.wet, ep.wet]]) {
      n.gain.cancelScheduledValues(t); n.gain.setValueAtTime(n.gain.value, t); n.gain.linearRampToValueAtTime(v, t + 0.03);
    }
  }
  setRate(r) {
    const pos = this.position();
    this._rate = r;
    if (this.playing && this.source) {
      this._offset = pos; this._startedAt = this.ctx.currentTime;
      this.source.playbackRate.setValueAtTime(r, this.ctx.currentTime);
      this._scheduleEnd();
    }
  }
  _scheduleEnd() {
    clearTimeout(this._endTimer);
    if (!this.playing || !this.buffer) return;
    const remain = (this.buffer.duration - this._offset) / this._rate;
    this._endTimer = setTimeout(() => this._onEnd(), Math.max(0, remain * 1000) + 30);
  }
  _onEnd() {
    if (!this.playing) return;
    if (this.position() < this.buffer.duration - 0.05) { this._scheduleEnd(); return; }
    this._teardownSource();
    this.playing = false; this._offset = this.buffer.duration;
    this._keepAlive(false);
    if (this.onended) this.onended();
  }
  _teardownSource() {
    clearTimeout(this._endTimer);
    if (this.source) { try { this.source.onended = null; this.source.stop(); } catch (e) { /* already stopped */ } try { this.source.disconnect(); } catch (e) { /* noop */ } this.source = null; }
  }
  async play(fromSeconds) {
    if (!this.buffer) return;
    this._keepAlive(true);   // synchronously, before any await, so it stays inside the user gesture (iOS)
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (e) { /* user gesture needed */ } }
    this._teardownSource();
    if (fromSeconds != null) this._offset = fromSeconds;
    if (this._offset >= this.buffer.duration - 1e-3) this._offset = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this._rate;
    src.connect(this.graph.dry); src.connect(this.graph.conv);
    src.onended = () => { if (this.source === src) this._onEnd(); };   // reliable in the background (timers are throttled there)
    src.start(0, this._offset);
    this.source = src; this._startedAt = this.ctx.currentTime; this.playing = true;
    this._scheduleEnd();
  }
  pause() {
    if (!this.playing) return;
    this._offset = this.position();
    this._teardownSource();
    this.playing = false;
    this._keepAlive(false);
  }
  stop() { this._teardownSource(); this.playing = false; this._offset = 0; this._keepAlive(false); }
  seek(seconds) {
    const s = Math.max(0, Math.min(this.duration, seconds));
    if (this.playing) this.play(s); else this._offset = s;
  }
}

export async function renderOffline(buffer, { playbackRate, reverbWetMix }, sampleRate) {
  const sr = sampleRate || audioContext().sampleRate;
  const len = Math.max(1, Math.ceil(buffer.duration / playbackRate * sr));
  const oc = new OfflineAudioContext(2, len, sr);
  const g = buildGraph(oc, { playbackRate, reverbWetMix, gain: 1 });
  const src = oc.createBufferSource();
  src.buffer = buffer; src.playbackRate.value = playbackRate;
  src.connect(g.dry); src.connect(g.conv);
  src.start(0);
  return await oc.startRendering();
}

export function encode(buffer, format, { bitrate = 320 } = {}) {
  return new Promise((resolve, reject) => {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice());
    const url = new URL(format === 'mp3' ? 'mp3-worker.js' : 'wav-worker.js', import.meta.url);
    const w = new Worker(url);
    w.onmessage = e => {
      w.terminate();
      if (e.data && e.data.error) return reject(new Error(e.data.error));
      resolve(new Blob([e.data.buffer], { type: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' }));
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || 'encoder worker failed')); };
    w.postMessage({ sampleRate: buffer.sampleRate, length: buffer.length, channels, bitrate }, channels.map(c => c.buffer));
  });
}

export function peaks(buffer, n) {
  const chs = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const per = Math.max(1, Math.floor(chs[0].length / n));
  const out = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const s = b * per, e = Math.min(s + per, chs[0].length);
    let m = 0;
    const step = Math.max(1, Math.floor((e - s) / 256));
    for (const d of chs) for (let i = s; i < e; i += step) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
    out[b] = m;
  }
  return out;
}
