export class Slider {
  constructor(root, { min = 0, max = 1, step = 0.05, value = 0, onInput = null, format = v => String(v) } = {}) {
    this.root = root; this.min = min; this.max = max; this.step = step; this.onInput = onInput; this.format = format;
    root.classList.add('sl');
    root.setAttribute('role', 'slider'); root.tabIndex = 0;
    root.setAttribute('aria-valuemin', String(min)); root.setAttribute('aria-valuemax', String(max));
    this.track = document.createElement('div'); this.track.className = 'sl-track';
    this.fill = document.createElement('div'); this.fill.className = 'sl-fill';
    this.thumb = document.createElement('div'); this.thumb.className = 'sl-thumb'; this.thumb.dataset.sd = 'panel'; this.thumb.dataset.sdRadius = '1'; this.thumb.dataset.sdLayer = 'top';   // jelly disc, drawn above the track
    root.append(this.track, this.fill, this.thumb);
    this._drag = false;
    const pos = e => { const r = this.root.getBoundingClientRect(); const pad = this.thumb.getBoundingClientRect().width / 2; return Math.min(1, Math.max(0, (e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad))); };
    root.addEventListener('pointerdown', e => { if (e.button !== 0) return; this._drag = true; root.setPointerCapture(e.pointerId); root.focus({ preventScroll: true }); this._fromFrac(pos(e)); e.preventDefault(); });
    root.addEventListener('pointermove', e => { if (this._drag) this._fromFrac(pos(e)); });
    const up = () => { this._drag = false; };
    root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
    root.addEventListener('keydown', e => {
      const st = this.step > 0 ? this.step : 0.01;
      let v = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = this.value + st;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = this.value - st;
      else if (e.key === 'Home') v = this.min; else if (e.key === 'End') v = this.max;
      if (v == null) return;
      e.preventDefault(); this.set(v, true);
    });
    this.set(value, false);
  }
  _quant(v) {
    v = Math.min(this.max, Math.max(this.min, v));
    if (this.step > 0) v = this.min + Math.round((v - this.min) / this.step) * this.step;
    return Math.round(v * 1000) / 1000;
  }
  _fromFrac(f) { this.set(this.min + f * (this.max - this.min), true); }
  set(v, fire) {
    this.value = this._quant(v);
    const f = (this.value - this.min) / (this.max - this.min || 1);
    this.root.style.setProperty('--f', String(f));
    this.root.setAttribute('aria-valuenow', String(this.value));
    this.root.setAttribute('aria-valuetext', this.format(this.value));
    if (fire && this.onInput) this.onInput(this.value);
  }
  setStep(s) { this.step = s; }
}
