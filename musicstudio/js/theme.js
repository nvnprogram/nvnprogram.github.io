import { hexToLin } from './sdodr.js';

export const STORAGE_KEY = 'musicstudio.theme.v1';

export const KEYS = [
  ['bg', 'Background'],
  ['panel', 'Panel backdrop'],
  ['glow', 'Panel glow'],
  ['frost', 'Frost sheen'],
  ['floral', 'Floral'],
  ['floral2', 'Floral accent'],
  ['text', 'Text'],
  ['textPanel', 'Text on panels'],
  ['button', 'Round button'],
  ['icon', 'Button icons'],
];
export const ACCENT_KEYS = ['glow', 'button', 'floral', 'floral2'];
export const THEME_KEYS = ['bg', 'panel', 'frost', 'text', 'textPanel', 'icon'];

export const PRESETS = {
  light: {
    bg: '#a4978f', panel: '#efe5e0', glow: '#c4a07e', frost: '#fffbfa', floral: '#ffe6d4', floral2: '#ff9700',
    text: '#5a4f4f', textPanel: '#5a4f4f', button: '#c9b0ac', icon: '#5a4f4f',
  },
  dark: {
    bg: '#2a2624', panel: '#4d4644', glow: '#b79880', frost: '#a89a94', floral: '#c9b3a4', floral2: '#e0895a',
    text: '#f1e9e4', textPanel: '#f4ede8', button: '#9c8c86', icon: '#f1e9e4',
  },
  darker: {
    bg: '#14110f', panel: '#2d2725', glow: '#b79880', frost: '#6f635e', floral: '#a08d80', floral2: '#c47a50',
    text: '#f1e9e4', textPanel: '#f4ede8', button: '#7d6f6a', icon: '#f1e9e4',
  },
};
export const THEME_NAMES = ['light', 'dark', 'darker'];
export const SDODR_BASE = 'darker';

const SCALARS = {
  light: { bgDarken: 0.85, bgSheenAlpha: 0.4, panelMix: 0.7, blurDarken: 0.45, panelSheenAlpha: 0.62, bgFloralAlpha: 0.7 },
  dark: { bgDarken: 1.0, bgSheenAlpha: 0.35, panelMix: 0.55, blurDarken: 0.3, panelSheenAlpha: 0.35, bgFloralAlpha: 0.55 },
};

const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const pick = (src, keys) => { const o = {}; for (const k of keys) o[k] = src[k]; return o; };

const hexRgb = h => [0, 2, 4].map(i => parseInt(h.substr(1 + i, 2), 16) / 255);
const rgbHex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
function rgbToHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}
function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const lerpHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A.map((v, i) => v + (B[i] - v) * t)); };
const EPS = 3 / 255;
const sameHex = (a, b) => { const A = hexRgb(a), B = hexRgb(b); return A.every((v, i) => Math.abs(v - B[i]) <= EPS); };
const sameSet = (a, b, keys) => keys.every(k => isHex(a[k]) && isHex(b[k]) && sameHex(a[k], b[k]));

const SAT_BASE = { glow: 0.55, button: 0.35, floral: 0.55, floral2: 0.72 };
export function lightnessOf(preset) { const o = {}; for (const k of ACCENT_KEYS) o[k] = rgbToHsl(hexRgb(preset[k]))[2]; return o; }
const L_DEFAULT = lightnessOf(PRESETS[SDODR_BASE]);
export const ACCENTS = [
  { name: 'neon', hues: { glow: 205, button: 210, floral: 300, floral2: 200 }, sat: 1.0 },
  { name: 'lime', hues: { glow: 95, button: 100, floral: 90, floral2: 150 }, sat: 0.9 },
  { name: 'rose', hues: { glow: 345, button: 350, floral: 350, floral2: 10 }, sat: 1.0 },
  { name: 'violet', hues: { glow: 270, button: 275, floral: 265, floral2: 320 }, sat: 1.0 },
  { name: 'teal', hues: { glow: 175, button: 180, floral: 170, floral2: 210 }, sat: 0.9 },
  { name: 'magenta', hues: { glow: 328, button: 332, floral: 330, floral2: 338 }, sat: 0.85, light: 0.12 },   // light pink
  { name: 'cyan', hues: { glow: 220, button: 225, floral: 230, floral2: 190 }, sat: 1.0 },
  { name: 'gold', hues: { glow: 42, button: 38, floral: 43, floral2: 38 }, sat: 1.0, light: -0.06 },          // goldenrod / antique gold, not lemon
];
function accentColors(a, jitter = 0, satBoost = 1, lref = L_DEFAULT) {
  const out = {};
  for (const k of ACCENT_KEYS) {
    const s = Math.min(1, Math.max(0.1, SAT_BASE[k] * a.sat * satBoost));
    const l = Math.min(0.95, Math.max(0.05, lref[k] + (a.light || 0)));
    out[k] = rgbHex(hslToRgb([(a.hues[k] + jitter + 360) % 360, s, l]));
  }
  return out;
}
export function accentNamed(name, lref) { const a = ACCENTS.find(x => x.name === name); return a ? accentColors(a, 0, 1, lref) : null; }
export function randomAccentName(hash) { const i = hash % (ACCENTS.length + 1); return i === ACCENTS.length ? 'sdodr' : ACCENTS[i].name; }
export function accentFor(hash, lref) { const n = randomAccentName(hash); return n === 'sdodr' ? null : accentNamed(n, lref); }
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function nearestPreset(colors) {
  let best = SDODR_BASE, bd = Infinity;
  for (const n of THEME_NAMES) {
    let d = 0;
    for (const k of THEME_KEYS) { const A = hexRgb(colors[k]), B = hexRgb(PRESETS[n][k]); for (let i = 0; i < 3; i++) d += (A[i] - B[i]) ** 2; }
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

export class Theme {
  constructor(renderer) {
    this.r = renderer;
    this.themeName = SDODR_BASE;
    this.accentMode = 'random';   // default: per-song accents (a saved preset overrides this)
    this.colors = Object.assign({}, PRESETS[SDODR_BASE]);
    this.shown = Object.assign({}, this.colors);
    this.customTheme = null;     // last custom THEME_KEYS set (null = none yet)
    this.customAccent = null;    // last custom ACCENT_KEYS set
    this.trackHash = null;
    this.listeners = new Set();
    this._anim = null;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _scalarsFor(colors) {
    const [r, g, b] = hexToLin(colors.bg);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum < 0.1 ? SCALARS.dark : SCALARS.light;
  }
  // push the displayed colors to the GL look + CSS variables
  _push(colors) {
    const c = this.shown = Object.assign({}, colors);
    const s = this._scalarsFor(c);
    if (this.r) this.r.setLook(Object.assign({
      bg: hexToLin(c.bg), panel: hexToLin(c.panel), glow: hexToLin(c.glow), frost: hexToLin(c.frost),
      floral: hexToLin(c.floral), floral2: hexToLin(c.floral2), button: hexToLin(c.button),
    }, s));
    const root = document.documentElement.style;
    root.setProperty('--c-bg', c.bg); root.setProperty('--c-panel', c.panel); root.setProperty('--c-glow', c.glow);
    root.setProperty('--c-frost', c.frost); root.setProperty('--c-floral', c.floral); root.setProperty('--c-floral2', c.floral2);
    root.setProperty('--c-text', c.text); root.setProperty('--c-text-panel', c.textPanel);
    root.setProperty('--c-button', c.button); root.setProperty('--c-icon', c.icon);
    document.documentElement.dataset.theme = s === SCALARS.dark ? 'dark' : 'light';
    for (const fn of this.listeners) fn(this.shown);
  }
  // smooth lerp from the displayed colors to the target ones
  _commit(animateMs = 0) {
    const target = Object.assign({}, this.colors);
    if (this._anim) { cancelAnimationFrame(this._anim.raf); this._anim = null; }
    if (!animateMs) { this._push(target); return; }
    const from = Object.assign({}, this.shown), t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / animateMs), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // ease in-out
      const cur = {};
      for (const [k] of KEYS) cur[k] = lerpHex(from[k], target[k], e);
      this._push(cur);
      if (t < 1) this._anim.raf = requestAnimationFrame(step); else this._anim = null;
    };
    this._anim = { raf: requestAnimationFrame(step) };
  }

  // the "Sdodr" accent = the accent colors of the current theme preset (nearest preset for a custom theme)
  _themePreset() { return PRESETS[THEME_NAMES.includes(this.themeName) ? this.themeName : nearestPreset(this.colors)]; }
  _sdodrAccent() { return pick(this._themePreset(), ACCENT_KEYS); }
  _lref() { return lightnessOf(this._themePreset()); }   // accent lightness follows the theme
  _accentColors(mode) {
    if (mode === 'sdodr') return this._sdodrAccent();
    if (mode === 'random') return (this.trackHash != null && accentFor(this.trackHash, this._lref())) || this._sdodrAccent();
    if (mode === 'custom') return this.customAccent;
    return accentNamed(mode, this._lref());
  }
  _applyAccent() { const a = this._accentColors(this.accentMode); if (a) Object.assign(this.colors, a); }
  // snap themeName / accentMode back onto whatever the current colors match (within EPS); 'random' is kept
  _classify() {
    this.themeName = THEME_NAMES.find(n => sameSet(this.colors, PRESETS[n], THEME_KEYS)) || 'custom';
    if (this.accentMode === 'random') return;
    if (sameSet(this.colors, this._sdodrAccent(), ACCENT_KEYS)) this.accentMode = 'sdodr';
    else { const lref = this._lref(); const a = ACCENTS.find(x => sameSet(this.colors, accentNamed(x.name, lref), ACCENT_KEYS)); this.accentMode = a ? a.name : 'custom'; }
    if (this.themeName === 'custom') this.customTheme = pick(this.colors, THEME_KEYS);
    if (this.accentMode === 'custom') this.customAccent = pick(this.colors, ACCENT_KEYS);
  }

  usePreset(name, animateMs = 350) {
    if (!PRESETS[name]) return;
    Object.assign(this.colors, pick(PRESETS[name], THEME_KEYS));
    this.themeName = name;
    this._applyAccent();   // sdodr / random-without-track follow the theme; named + custom accents are theme-independent
    this._commit(animateMs);
  }
  useCustomTheme(animateMs = 350) {
    if (this.customTheme) Object.assign(this.colors, this.customTheme);
    this.themeName = 'custom';
    this._applyAccent();
    this._classify();
    this._commit(animateMs);
  }
  setAccentMode(mode, animateMs = 600) {
    this.accentMode = Theme.validAccent(mode);
    this._applyAccent();
    this._commit(animateMs);
  }
  static validAccent(m) { return m === 'random' || m === 'sdodr' || m === 'custom' || ACCENTS.some(a => a.name === m) ? m : 'random'; }
  // Advanced colors: editing an accent key makes the accent Custom, editing a theme key makes the theme Custom
  set(key, hex) {
    if (!isHex(hex) || !KEYS.some(([k]) => k === key)) return;
    this.colors[key] = hex.toLowerCase();
    if (ACCENT_KEYS.includes(key)) { this.accentMode = 'custom'; this.customAccent = pick(this.colors, ACCENT_KEYS); }
    else { this.themeName = 'custom'; this.customTheme = pick(this.colors, THEME_KEYS); }
    this._classify();
    this._commit(0);
  }
  setTrackHash(h, animateMs = 700) { this.trackHash = h == null ? null : (h >>> 0); if (this.accentMode === 'random') { this._applyAccent(); this._commit(animateMs); } }

  savePreset() {
    const data = {
      version: 3, theme: this.themeName, accent: this.accentMode, colors: Object.assign({}, this.colors),
      customTheme: this.customTheme, customAccent: this.customAccent, savedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }
  static readSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !d.colors) return null;
      return d;
    } catch (e) { return null; }
  }
  // load = take the saved colors, then classify them back onto the built-in themes / accents (Custom if nothing matches)
  loadSaved(animateMs = 350) {
    const d = Theme.readSaved();
    if (!d) return false;
    const colors = Object.assign({}, PRESETS[SDODR_BASE]);
    if (d.version >= 3) {
      for (const [k] of KEYS) if (isHex(d.colors[k])) colors[k] = d.colors[k].toLowerCase();
    } else { 
      Object.assign(colors, PRESETS[d.base] || {});
      for (const [k] of KEYS) if (isHex(d.colors[k])) colors[k] = d.colors[k].toLowerCase();
      const a = accentNamed(d.accent, lightnessOf(PRESETS[d.base] || PRESETS[SDODR_BASE])); if (a) Object.assign(colors, a);
    }
    this.colors = colors;
    const validSet = (o, keys) => o && keys.every(k => isHex(o[k])) ? pick(o, keys) : null;
    this.customTheme = validSet(d.customTheme, THEME_KEYS);
    this.customAccent = validSet(d.customAccent, ACCENT_KEYS);
    this.accentMode = d.accent === 'random' ? 'random' : 'sdodr';
    this._classify();
    if (this.accentMode === 'random') this._applyAccent();
    this._commit(animateMs);
    return true;
  }
  init() { if (!this.loadSaved(0)) { this.accentMode = 'random'; this.usePreset(SDODR_BASE, 0); } }
}
