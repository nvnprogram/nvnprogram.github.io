import { peaks } from './audio.js';

const hexRgb = h => [0, 2, 4].map(i => parseInt(h.substr(1 + i, 2), 16));
const rgbHex = c => '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const brighten = (h, t) => rgbHex(hexRgb(h).map(v => v + (255 - v) * t));
const saturate = (h, k, dl) => {
  const [r, g, b] = hexRgb(h).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let hue = 0, sat = 0;
  if (d > 1e-6) {
    sat = d / (1 - Math.abs(2 * l - 1));
    hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const s2 = Math.min(1, sat * k + 0.12), l2 = Math.min(0.9, Math.max(0.1, l + dl));
  const c = (1 - Math.abs(2 * l2 - 1)) * s2, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = l2 - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex([r1 + m, g1 + m, b1 + m].map(v => v * 255));
};
const lerpHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A.map((v, i) => v * (1 - t) + B[i] * t)); };

export class Waveform {
  constructor(canvas, { onSeek } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.onSeek = onSeek;
    this.buffer = null; this.peaks = null; this.progress = 0; this.dirty = true;
    this._w = 0; this._h = 0; this._dpr = 1;
    this._drag = false;
    const pos = e => { const r = canvas.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    canvas.addEventListener('pointerdown', e => { if (!this.buffer) return; this._drag = true; canvas.setPointerCapture(e.pointerId); this._scrub(pos(e), false); });
    canvas.addEventListener('pointermove', e => { if (this._drag) this._scrub(pos(e), false); });
    const up = e => { if (!this._drag) return; this._drag = false; this._scrub(pos(e), true); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    this.ro = new ResizeObserver(() => { this.dirty = true; this.draw(); });
    this.ro.observe(canvas);
  }
  _scrub(frac, commit) { this.progress = frac; this.dirty = true; if (this.onSeek) this.onSeek(frac, commit); }
  get scrubbing() { return this._drag; }
  setBuffer(buf) { this.buffer = buf; this.peaks = null; this.progress = 0; this.dirty = true; this.draw(); }
  setProgress(p) { if (this._drag) return; const v = Math.min(1, Math.max(0, p || 0)); if (Math.abs(v - this.progress) > 0.0005) { this.progress = v; this.dirty = true; } }
  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w !== this._w || h !== this._h) { this.canvas.width = w; this.canvas.height = h; this._w = w; this._h = h; this._dpr = dpr; this.peaks = null; }
  }
  draw(force) {
    this._fit();
    if (!this.dirty && !force) return;
    this.dirty = false;
    const c = this.ctx, W = this._w, H = this._h, dpr = this._dpr;
    c.clearRect(0, 0, W, H);
    const cs = getComputedStyle(this.canvas);
    const fg = cs.getPropertyValue('--wave-fg').trim() || '#5a4f4f';
    const base = cs.getPropertyValue('--wave-done').trim() || '#c4a07e';
    // played bars: the highlight pushed toward a more saturated, slightly brighter version of itself
    const done = lerpHex(base, saturate(base, 1.9, 0.08), 0.6);
    const bar = Math.max(1, Math.round(2 * dpr)), gap = Math.max(1, Math.round(1 * dpr));
    const n = Math.max(8, Math.floor(W / (bar + gap)));
    if (!this.buffer) {
      c.fillStyle = fg; c.globalAlpha = 0.35; c.fillRect(0, H / 2 - dpr, W, 2 * dpr); c.globalAlpha = 1;
      return;
    }
    if (!this.peaks || this.peaks.length !== n) {
      const p = peaks(this.buffer, n);
      let m = 0; for (const v of p) if (v > m) m = v;
      const k = m > 0 ? 1 / m : 1;
      for (let i = 0; i < n; i++) p[i] = Math.pow(p[i] * k, 0.85);   // gentle compression so quiet parts show
      this.peaks = p;
    }
    const mid = H / 2, maxH = H * 0.92;
    const split = Math.round(this.progress * n);
    for (let i = 0; i < n; i++) {
      const h = Math.max(2 * dpr, this.peaks[i] * maxH);
      c.fillStyle = i < split ? done : fg;
      c.globalAlpha = i < split ? 1 : 0.6;
      const x = i * (bar + gap);
      c.fillRect(x, mid - h / 2, bar, h);
    }
    c.globalAlpha = 1;
  }
}
