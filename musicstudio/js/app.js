import { Sdodr, SdodrDom } from './sdodr.js';
import { Theme, KEYS, ACCENTS, hashString } from './theme.js';
import { Player, decodeFile, renderOffline, encode } from './audio.js';
import { Waveform } from './waveform.js';
import { Slider } from './slider.js';

const $ = id => document.getElementById(id);
const PREFS_KEY = 'musicstudio.prefs.v1';
const DEFAULTS = { playbackRate: 1, reverbWetMix: 0 };
const IMPORT_DEFAULTS = { playbackRate: 0.8, reverbWetMix: 0.4 };
const PRESET_VALUES = { slowed: { playbackRate: 0.8, reverbWetMix: 0.4 }, nightcore: { playbackRate: 1.2, reverbWetMix: 0.1 }, reset: DEFAULTS };
const LOOP_NEXT = { none: 'all', all: 'one', one: 'none' };

const fmtRate = r => (Math.round(r * 100) / 100).toString().replace(/\.?0+$/, '') + 'x';
const fmtPct = w => Math.round(w * 100) + '%';
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snap = (v, step) => Math.round(Math.round(v / step) * step * 1000) / 1000;

const state = {
  tracks: [], current: -1, loopMode: 'all', snap: true, dlFormat: 'wav', volume: 0.9, muted: false, lastVolume: 0.9,
  defaults: Object.assign({}, IMPORT_DEFAULTS),
};
let player, wave, sd, sd2, theme, dom, busy = false;
const sliders = {};

// ---------- prefs (volume, loop, snap, export format - autosaved, separate from the theme) ----------
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (typeof p.volume === 'number') state.volume = clamp(p.volume, 0, 1);
    if (p.loopMode in LOOP_NEXT) state.loopMode = p.loopMode;
    if (typeof p.snap === 'boolean') state.snap = p.snap;
    if (p.dlFormat === 'mp3' || p.dlFormat === 'wav') state.dlFormat = p.dlFormat;
    if (p.defaults) { if (typeof p.defaults.playbackRate === 'number') state.defaults.playbackRate = clamp(p.defaults.playbackRate, 0.5, 1.5); if (typeof p.defaults.reverbWetMix === 'number') state.defaults.reverbWetMix = clamp(p.defaults.reverbWetMix, 0, 1); }
  } catch (e) { /* ignore */ }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ volume: state.volume, loopMode: state.loopMode, snap: state.snap, dlFormat: state.dlFormat, defaults: state.defaults })); } catch (e) { /* ignore */ }
}

// ---------- toast / busy ----------
let toastTimer;
const shortName = (n, max = 42) => n.length > max ? n.slice(0, max - 1).trimEnd() + '…' : n;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function setBusy(on, text) { busy = on; $('busy').hidden = !on; if (text) $('busyText').textContent = text; }

// ---------- bus-destination style marquee for overflowing titles ----------
function marquee(el) {
  const inner = el.querySelector('.mq');
  if (!inner) return;
  el.classList.remove('scrolling');
  inner.style.transform = '';
  const shift = inner.scrollWidth - el.clientWidth;
  if (shift > 4) {
    el.style.setProperty('--mq-shift', (-shift) + 'px');
    el.style.setProperty('--mq-dur', Math.max(8, shift / 28 + 5).toFixed(1) + 's'); 
    el.classList.add('scrolling');
  }
}
function refreshMarquees() { for (const el of document.querySelectorAll('.marquee')) marquee(el); }

// ---------- fit the current view into the viewport (CSS zoom on #app, see --fit in app.css) ----------
// Natural height is measured with the min-height released; the view is scaled down (never up) to leave ~4% room.
let fitRaf = 0, lastVp = '', pageFits = true, parkY = 0, touching = 0;
const PARK = 120;   // > any status bar height
function parkScroll() { if (parkY) requestAnimationFrame(() => { if (Math.abs(window.scrollY - parkY) > 0.5) window.scrollTo(0, parkY); }); }
function fitToViewport() {
  const app = $('app'), root = document.documentElement.style;
  app.classList.add('measuring'); root.setProperty('--fit', '1');
  const natural = app.offsetHeight;
  app.classList.remove('measuring');
  const vh = SdodrDom.viewportHeight(), vw = window.innerWidth;
  const fit = +Math.min(1, Math.max(0.5, (vh * 0.96) / Math.max(1, natural))).toFixed(3);
  root.setProperty('--fit', String(fit));
  root.setProperty('--vw-l', (vw / fit).toFixed(4) + 'px');    // viewport size in #app layout px (see app.css); x fit = exactly the viewport
  root.setProperty('--vh-l', (vh / fit).toFixed(4) + 'px');
  // Page fits -> the user must not be able to pan it (touch-action: none on the root; inner scrollers re-enable pan-y).
  pageFits = natural * fit <= vh + 0.5;
  parkY = pageFits && navigator.maxTouchPoints > 1 ? PARK : 0;
  document.documentElement.style.overflow = '';
  document.documentElement.style.touchAction = pageFits ? 'none' : '';
  root.setProperty('--park', parkY + 'px');
  if (dom) { dom.fits = pageFits; dom.parkY = parkY; }
  parkScroll();
  lastVp = vw + 'x' + vh;
  requestAnimationFrame(refreshMarquees);
}
function scheduleFit() { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitToViewport); }

// ---------- lock-screen / background controls ----------
function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.metadata = t ? new MediaMetadata({ title: t.name.replace(/\.[^.]+$/, ''), artist: 'musicstudio' }) : null; } catch (e) { /* unsupported */ }
}

// ---------- tracks ----------
let nextId = 1;
function addFiles(files) {
  const list = Array.from(files || []).filter(f => f && (f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|webm|aif|aiff)$/i.test(f.name)));
  if (!list.length) { toast('No audio files found in that selection'); return; }
  const startEmpty = state.tracks.length === 0;
  for (const f of list) {
    const t = { id: nextId++, name: f.name, file: f, buffer: null, error: null, settings: Object.assign({}, state.defaults), decoding: true };
    state.tracks.push(t);
    decodeFile(f).then(buf => { t.buffer = buf; t.decoding = false; onDecoded(t); }, err => { t.decoding = false; t.error = String(err && err.message || err); onDecodeFailed(t); });
  }
  showPlayer();
  renderList();
  if (startEmpty) selectTrack(0, true); 
}
function onDecoded(t) {
  renderList();
  const cur = state.tracks[state.current];
  if (cur === t) loadCurrentIntoPlayer(pendingAutoplay);
}
function onDecodeFailed(t) {
  toast('Could not decode "' + shortName(t.name) + '"');
  const i = state.tracks.indexOf(t);
  if (i >= 0) removeTrack(i);
}
function removeTrack(i) {
  const wasCurrent = i === state.current;
  state.tracks.splice(i, 1);
  if (state.tracks.length === 0) { state.current = -1; player.stop(); player.buffer = null; wave.setBuffer(null); theme.setTrackHash(null); updateTrackUI(); renderList(); return; }
  if (wasCurrent) selectTrack(Math.min(i, state.tracks.length - 1), player.playing);
  else { if (i < state.current) state.current--; renderList(); }
}
function clearTracks() { player.stop(); state.tracks = []; state.current = -1; wave.setBuffer(null); theme.setTrackHash(null); updateTrackUI(); renderList(); }
// Replace the current track with the first chosen file (keeping its speed / reverb); extra files are inserted after it.
function replaceCurrent(files) {
  const list = Array.from(files || []).filter(f => f && (f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|webm|aif|aiff)$/i.test(f.name)));
  if (!list.length) { toast('No audio files found in that selection'); return; }
  const cur = currentTrack();
  if (!cur) { addFiles(list); return; }
  const wasPlaying = player.playing;
  player.stop();
  const made = list.map((f, i) => ({ id: nextId++, name: f.name, file: f, buffer: null, error: null, settings: Object.assign({}, i === 0 ? cur.settings : state.defaults), decoding: true }));
  state.tracks.splice(state.current, 1, ...made);
  for (const t of made) decodeFile(t.file).then(buf => { t.buffer = buf; t.decoding = false; onDecoded(t); }, err => { t.decoding = false; t.error = String(err && err.message || err); onDecodeFailed(t); });
  selectTrack(state.current, wasPlaying || !cur.buffer);
  toast('Replaced with "' + shortName(made[0].name) + '"');
}

function trackHash(t) { return hashString(t.name + '|' + (t.file && t.file.size) + '|' + (t.file && t.file.lastModified)); }
function selectTrack(i, autoplay) {
  if (i < 0 || i >= state.tracks.length) return;
  state.current = i;
  renderList();
  theme.setTrackHash(trackHash(state.tracks[i]));
  loadCurrentIntoPlayer(autoplay);
}
let pendingAutoplay = false;
function loadCurrentIntoPlayer(autoplay) {
  const t = state.tracks[state.current];
  pendingAutoplay = !!autoplay;
  updateTrackUI();
  if (!t || !t.buffer) { player.stop(); player.buffer = null; wave.setBuffer(null); return; }
  player.setBuffer(t.buffer);
  player.setRate(t.settings.playbackRate);
  player.setReverb(t.settings.reverbWetMix);
  wave.setBuffer(t.buffer);
  if (pendingAutoplay) { pendingAutoplay = false; player.play(0).then(updatePlayIcon); } else updatePlayIcon();
}
function currentTrack() { return state.tracks[state.current] || null; }

// ---------- playlist drop-down ----------
function renderList() {
  const ul = $('trackList');
  ul.innerHTML = '';
  for (let i = 0; i < state.tracks.length; i++) {
    const t = state.tracks[i];
    const li = document.createElement('li');
    li.className = (i === state.current ? 'current ' : '') + (t.decoding ? 'decoding' : '');
    li.dataset.index = i;
    const info = document.createElement('div');
    const n = document.createElement('div'); n.className = 'name marquee'; n.title = t.name;
    const sp = document.createElement('span'); sp.className = 'mq'; sp.textContent = t.name; n.appendChild(sp);
    const s = document.createElement('div'); s.className = 'sum'; s.textContent = fmtRate(t.settings.playbackRate) + ' speed, ' + fmtPct(t.settings.reverbWetMix) + ' reverb' + (t.buffer ? ' · ' + fmtTime(t.buffer.duration) : '');
    info.append(n, s);
    const rm = document.createElement('button'); rm.className = 'rm'; rm.title = 'Remove'; rm.setAttribute('aria-label', 'Remove ' + t.name);
    rm.innerHTML = '<svg><use href="#i-x"/></svg>';
    rm.addEventListener('click', e => { e.stopPropagation(); removeTrack(i); });
    li.append(info, rm);
    li.addEventListener('click', () => selectTrack(i, player.playing || !player.buffer));
    ul.appendChild(li);
  }
  $('plEmpty').hidden = state.tracks.length > 0;
  $('plCount').textContent = state.tracks.length;
  requestAnimationFrame(refreshMarquees);
}
function setPlaylistOpen(open) {
  const w = $('playlistWrap');
  if (open) { w.hidden = false; requestAnimationFrame(() => { w.classList.add('open'); refreshMarquees(); }); }
  else { w.classList.remove('open'); setTimeout(() => { if (!w.classList.contains('open')) w.hidden = true; }, 300); }
  $('plToggle').setAttribute('aria-expanded', String(open));
}
const playlistOpen = () => $('playlistWrap').classList.contains('open');

// ---------- studio UI ----------
function updateTrackUI() {
  const t = currentTrack();
  $('trackName').querySelector('.mq').textContent = t ? t.name : '—';
  $('trackName').title = t ? t.name + ' \u2014 click to replace this track' : '';
  requestAnimationFrame(() => marquee($('trackName').querySelector('.marquee')));
  updateMediaSession(t);
  const s = t ? t.settings : DEFAULTS;
  sliders.speed.set(s.playbackRate, false); $('speedVal').textContent = fmtRate(s.playbackRate);
  sliders.reverb.set(s.reverbWetMix, false); $('reverbVal').textContent = fmtPct(s.reverbWetMix);
  updatePresetChips(s);
  $('prevBtn').disabled = !t; $('nextBtn').disabled = !t; $('playBtn').disabled = !t || !t.buffer; $('dlBtn').disabled = !t || !t.buffer;
  updateTimes();
}
// The highlighted preset follows the direction of the speed (any slowdown = Slowed+Reverb, any speed-up = Nightcore,
// exactly 1x with no reverb = Original, 1x with reverb = none). Clicking a chip, highlighted or not, applies its values.
function updatePresetChips(s) {
  const r = s.playbackRate, w = s.reverbWetMix;
  const pick = r < 1 - 1e-6 ? 'slowed' : r > 1 + 1e-6 ? 'nightcore' : w < 1e-6 ? 'reset' : null;
  for (const b of document.querySelectorAll('[data-preset]')) b.classList.toggle('active', b.dataset.preset === pick);
}
function updateTimes() {
  const t = currentTrack();
  if (!t || !t.buffer) { $('tCur').textContent = '0:00'; $('tEnd').textContent = '0:00'; wave.setProgress(0); return; }
  const pos = player.position(), rate = t.settings.playbackRate;
  $('tCur').textContent = fmtTime(pos / rate);
  $('tEnd').textContent = fmtTime(t.buffer.duration / rate);
  wave.setProgress(pos / t.buffer.duration);
}
function updatePlayIcon() {
  const p = player.playing;
  if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = p ? 'playing' : 'paused'; } catch (e) { /* noop */ }
  $('playIcon').setAttribute('href', p ? '#i-pause' : '#i-play');
  $('playBtn').title = p ? 'Pause' : 'Play'; $('playBtn').setAttribute('aria-label', p ? 'Pause' : 'Play');
}
function updateLoopUI() {
  const m = state.loopMode;
  $('loopIcon').setAttribute('href', m === 'one' ? '#i-loop1' : '#i-loop');
  $('loopInd').hidden = m === 'none';
  $('loopBtn').style.opacity = m === 'none' ? 0.55 : 1;
  const label = 'Repeat ' + m;
  $('loopBtn').title = label; $('loopBtn').setAttribute('aria-label', label);
}
function updateVolumeUI() {
  const v = state.muted ? 0 : state.volume;
  sliders.volume.set(v, false);
  $('volIcon').setAttribute('href', v > 0 ? '#i-vol' : '#i-mute');
  $('muteBtn').title = v > 0 ? 'Mute' : 'Unmute';
}
function applySnapUI() {
  const step = state.snap ? 0.05 : 0.001;
  sliders.speed.setStep(step); sliders.reverb.setStep(step);
  $('snapBtn').classList.toggle('active', state.snap);
  $('snapBtn').setAttribute('aria-pressed', String(state.snap));
}
function applyFormatUI() {
  $('dlFmt').textContent = state.dlFormat.toUpperCase();
  for (const b of document.querySelectorAll('[data-fmt]')) b.classList.toggle('active', b.dataset.fmt === state.dlFormat);
}

function setSettings(patch, fromSlider) {
  const t = currentTrack();
  if (!t) return;
  Object.assign(t.settings, patch);
  if (patch.playbackRate != null) player.setRate(t.settings.playbackRate);
  if (patch.reverbWetMix != null) player.setReverb(t.settings.reverbWetMix);
  if (!fromSlider) updateTrackUI(); else {
    $('speedVal').textContent = fmtRate(t.settings.playbackRate); $('reverbVal').textContent = fmtPct(t.settings.reverbWetMix);
    updatePresetChips(t.settings);
  }
  renderList();
}

// ---------- transport ----------
async function togglePlay() {
  const t = currentTrack();
  if (!t || !t.buffer) return;
  if (player.playing) player.pause(); else await player.play();
  updatePlayIcon();
}
function prev() {
  const t = currentTrack(); if (!t) return;
  if (player.position() > 3 || state.tracks.length === 1) { player.seek(0); if (!player.playing) updateTimes(); return; }
  const i = state.current - 1;
  selectTrack(i < 0 ? state.tracks.length - 1 : i, player.playing);
}
function next(fromEnd) {
  const t = currentTrack(); if (!t) return;
  const wasPlaying = fromEnd ? true : player.playing;
  let i = state.current + 1;
  if (i >= state.tracks.length) {
    if (fromEnd && state.loopMode !== 'all') { player.stop(); updatePlayIcon(); updateTimes(); return; }
    i = 0;
  }
  selectTrack(i, wasPlaying);
}
function onTrackEnded() {
  if (state.loopMode === 'one') { player.play(0).then(updatePlayIcon); return; }
  if (state.tracks.length > 1) { next(true); return; }
  if (state.loopMode === 'all') { player.play(0).then(updatePlayIcon); return; }
  updatePlayIcon(); updateTimes();
}

// ---------- download ----------
async function download() {
  const t = currentTrack();
  if (!t || !t.buffer || busy) return;
  const fmt = state.dlFormat;
  try {
    setBusy(true, 'Rendering ' + fmtRate(t.settings.playbackRate) + ' / ' + fmtPct(t.settings.reverbWetMix) + ' reverb…');
    await new Promise(r => setTimeout(r, 30));
    const rendered = await renderOffline(t.buffer, t.settings, t.buffer.sampleRate);
    setBusy(true, fmt === 'mp3' ? 'Encoding MP3…' : 'Writing WAV…');
    const blob = await encode(rendered, fmt, { bitrate: 320 });
    const base = t.name.replace(/\.[^.]+$/, '');
    const name = base + ' (' + fmtRate(t.settings.playbackRate) + ' speed, ' + fmtPct(t.settings.reverbWetMix) + ' reverb).' + fmt;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    toast('Saved ' + shortName(name, 60));
  } catch (e) {
    console.error(e); toast('Export failed: ' + (e && e.message || e));
  } finally { setBusy(false); }
}

// ---------- views ----------
function showPlayer() { $('landing').hidden = true; $('player').hidden = false; $('plToggle').hidden = false; scheduleFit(); }

// ---------- settings drawer ----------
function buildSettingsPanel() {
  const row = $('accentRow');
  for (const a of ACCENTS.map(a => a.name).concat('custom')) {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.sd = 'panel'; b.dataset.accent = a;
    if (a === 'custom') b.id = 'accentCustom';
    b.textContent = a.charAt(0).toUpperCase() + a.slice(1);
    row.appendChild(b);
  }
  // Advanced colors show the effective colors (theme + accent); editing one flips its owner to Custom
  const grid = $('colorGrid');
  grid.innerHTML = '';
  for (const [key, label] of KEYS) {
    const row = document.createElement('label'); row.className = 'crow';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = theme.colors[key]; inp.dataset.key = key;
    inp.addEventListener('input', () => { theme.set(key, inp.value); hint('Custom colors (not saved yet).'); });
    const span = document.createElement('span'); span.textContent = label;
    row.append(inp, span); grid.appendChild(row);
  }
  theme.onChange(() => { const c = theme.colors; for (const inp of grid.querySelectorAll('input[type=color]')) if (inp.value !== c[inp.dataset.key]) inp.value = c[inp.dataset.key]; wave.dirty = true; updatePresetButtons(); });
  updatePresetButtons();
}
function updatePresetButtons() {
  $('presetLight').classList.toggle('active', theme.themeName === 'light');
  $('presetDark').classList.toggle('active', theme.themeName === 'dark');
  $('presetDarker').classList.toggle('active', theme.themeName === 'darker');
  $('presetCustom').classList.toggle('active', theme.themeName === 'custom');
  $('presetCustom').disabled = !theme.customTheme;
  $('accentCustom').disabled = !theme.customAccent;
  for (const b of document.querySelectorAll('[data-accent]')) b.classList.toggle('active', b.dataset.accent === theme.accentMode);
}
function hint(msg, ok) { const h = $('themeHint'); h.textContent = msg; h.classList.toggle('ok', !!ok); }

// ---------- boot ----------
async function main() {
  loadPrefs();
  const canvas = $('gl'), canvas2 = $('gl2');
  try {
    if (new URLSearchParams(location.search).has('nogl')) throw new Error('forced no-gl');
    sd = await Sdodr.create(canvas, { assetBase: 'assets/tex/' });
    sd2 = await Sdodr.create(canvas2, { assetBase: 'assets/tex/' });
  } catch (e) {
    console.error('WebGL2 unavailable, falling back to flat CSS', e);
    sd = null; sd2 = null;
    document.documentElement.classList.add('no-gl');
  }
  theme = new Theme(sd);
  theme.onChange(() => { if (sd2) sd2.setLook(sd.look); });
  if (sd) sd.onBgAverage = hex => {   // average rendered background (no florals) -> page background + browser chrome tint
    document.documentElement.style.setProperty('--c-bg-eff', hex);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', hex);
  };
  theme.init();
  player = new Player();
  player.setVolume(state.volume);
  player.onended = onTrackEnded;
  wave = new Waveform($('wave'), {
    onSeek: (frac, commit) => { const t = currentTrack(); if (!t || !t.buffer) return; if (commit) { player.seek(frac * t.buffer.duration); updateTimes(); } else { $('tCur').textContent = fmtTime(frac * t.buffer.duration / t.settings.playbackRate); } },
  });
  sliders.speed = new Slider($('speed'), { min: 0.5, max: 1.5, step: 0.05, value: 1, format: fmtRate, onInput: v => setSettings({ playbackRate: v }, true) });
  sliders.reverb = new Slider($('reverb'), { min: 0, max: 1, step: 0.05, value: 0, format: fmtPct, onInput: v => setSettings({ reverbWetMix: v }, true) });
  sliders.defSpeed = new Slider($('defSpeed'), { min: 0.5, max: 1.5, step: 0.05, value: state.defaults.playbackRate, format: fmtRate, onInput: v => { state.defaults.playbackRate = v; $('defSpeedVal').textContent = fmtRate(v); savePrefs(); } });
  sliders.defReverb = new Slider($('defReverb'), { min: 0, max: 1, step: 0.05, value: state.defaults.reverbWetMix, format: fmtPct, onInput: v => { state.defaults.reverbWetMix = v; $('defReverbVal').textContent = fmtPct(v); savePrefs(); } });
  $('defSpeedVal').textContent = fmtRate(state.defaults.playbackRate); $('defReverbVal').textContent = fmtPct(state.defaults.reverbWetMix);
  sliders.volume = new Slider($('volume'), { min: 0, max: 1, step: 0.01, value: state.volume, format: fmtPct, onInput: v => { state.volume = v; state.muted = false; player.setVolume(v); updateVolumeUI(); savePrefs(); } });
  if (sd) {
    dom = new SdodrDom(sd, canvas, sd2, canvas2);
    await dom.addScroller(document.querySelector('.drawer-scroll'));   // settings drawer: its chips / thumbs scroll on the compositor
    let acc = 0;
    dom.frameHook = dt => {
      acc += dt;
      if (acc > 1 / 30) {
        acc = 0; if (player.playing) updateTimes();
        const vp = window.innerWidth + 'x' + SdodrDom.viewportHeight(); if (vp !== lastVp) scheduleFit();   // Safari's bars can settle without a resize event
        // park watchdog: a scrollTo during a rotation can be clamped by the old layout; correct it once things settle, never while a finger is down
        if (parkY && !touching && Math.abs(window.scrollY - parkY) > 0.5) window.scrollTo(0, parkY);
      }
      wave.draw();
    };
    dom.start();
  } else {
    setInterval(() => { if (player.playing) updateTimes(); wave.draw(); }, 50);
  }
  buildSettingsPanel();
  applySnapUI(); applyFormatUI(); updateLoopUI(); updateVolumeUI(); updateTrackUI(); renderList();
  window.addEventListener('resize', scheduleFit);
  document.addEventListener('touchmove', e => { if (!parkY) return; const t = e.target; if (t && t.closest && t.closest('.drawer-scroll, #trackList')) return; e.preventDefault(); }, { passive: false });
  window.addEventListener('pageshow', parkScroll);
  document.addEventListener('touchstart', () => { touching++; }, { passive: true });
  const touchEnd = () => { touching = Math.max(0, touching - 1); };
  document.addEventListener('touchend', touchEnd, { passive: true }); document.addEventListener('touchcancel', touchEnd, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) parkScroll(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleFit);
  fitToViewport();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleFit);
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* unsupported action */ } };
    set('play', () => { if (!player.playing) togglePlay(); });
    set('pause', () => { if (player.playing) togglePlay(); });
    set('previoustrack', prev); set('nexttrack', () => next(false));
  }

  // files
  // unlock audio inside the gesture that opens / completes the file pick, so the auto-play after decoding is allowed (iOS)
  for (const id of ['fileInput', 'addInput', 'replaceInput']) { const inp = $(id); const lab = inp.closest('label') || document.querySelector('label[for="' + id + '"]'); (lab || inp).addEventListener('click', () => player.unlock()); }
  $('trackName').addEventListener('click', () => player.unlock());
  $('fileInput').addEventListener('change', e => { player.unlock(); addFiles(e.target.files); e.target.value = ''; });
  $('addInput').addEventListener('change', e => { player.unlock(); addFiles(e.target.files); e.target.value = ''; });
  $('clearBtn').addEventListener('click', clearTracks);
  $('trackName').addEventListener('click', () => { if (currentTrack()) $('replaceInput').click(); });
  $('replaceInput').addEventListener('change', e => { player.unlock(); replaceCurrent(e.target.files); e.target.value = ''; });
  const overlaps = (a, b) => { const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(); return A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom; };
  $('plToggle').addEventListener('click', e => {
    e.stopPropagation();
    const opening = !playlistOpen(); setPlaylistOpen(opening);
    if (opening && !$('settingsPanel').hidden && overlaps($('playlist'), $('settingsPanel'))) $('settingsPanel').hidden = true;
  });
  document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragover'); });
  document.addEventListener('dragleave', e => { if (e.relatedTarget == null) document.body.classList.remove('dragover'); });
  document.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dragover'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  // presets + snap
  for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => setSettings(Object.assign({}, PRESET_VALUES[b.dataset.preset])));
  $('snapBtn').addEventListener('click', () => {
    state.snap = !state.snap; applySnapUI(); savePrefs();
    if (state.snap) { const t = currentTrack(); if (t) setSettings({ playbackRate: snap(t.settings.playbackRate, 0.05), reverbWetMix: snap(t.settings.reverbWetMix, 0.05) }); }
  });

  // transport
  $('playBtn').addEventListener('click', togglePlay);
  $('prevBtn').addEventListener('click', prev);
  $('nextBtn').addEventListener('click', () => next(false));
  $('loopBtn').addEventListener('click', () => { state.loopMode = LOOP_NEXT[state.loopMode]; updateLoopUI(); savePrefs(); });
  $('muteBtn').addEventListener('click', () => {
    if (state.muted || state.volume === 0) { state.muted = false; if (state.volume === 0) state.volume = state.lastVolume || 0.9; }
    else { state.lastVolume = state.volume; state.muted = true; }
    player.setVolume(state.muted ? 0 : state.volume); updateVolumeUI(); savePrefs();
  });
  document.addEventListener('keydown', e => {
    if (e.target && (/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) || e.target.classList.contains('sl'))) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') { const t = currentTrack(); if (t && t.buffer) { player.seek(player.position() + 5); updateTimes(); } }
    else if (e.code === 'ArrowLeft') { const t = currentTrack(); if (t && t.buffer) { player.seek(player.position() - 5); updateTimes(); } }
  });

  // download + export format (autosaved pref)
  $('dlBtn').addEventListener('click', download);
  for (const b of document.querySelectorAll('[data-fmt]')) b.addEventListener('click', () => { state.dlFormat = b.dataset.fmt; applyFormatUI(); savePrefs(); });

  // settings drawer + playlist: click outside closes
  const panel = $('settingsPanel');
  $('settingsBtn').addEventListener('click', e => {
    e.stopPropagation(); panel.hidden = !panel.hidden;
    if (!panel.hidden && playlistOpen() && overlaps(panel, $('playlist'))) setPlaylistOpen(false);
  });
  $('settingsClose').addEventListener('click', () => { panel.hidden = true; });
  document.addEventListener('click', e => {
    const path = e.composedPath();
    if (!panel.hidden && !path.includes(panel)) panel.hidden = true;
    if (playlistOpen() && !path.includes($('playlistWrap'))) setPlaylistOpen(false);
  });
  $('presetLight').addEventListener('click', () => { theme.usePreset('light'); hint('Light preset applied (not saved yet).'); });
  $('presetDark').addEventListener('click', () => { theme.usePreset('dark'); hint('Dark preset applied (not saved yet).'); });
  $('presetDarker').addEventListener('click', () => { theme.usePreset('darker'); hint('Yet Darker preset applied (not saved yet).'); });
  $('presetCustom').addEventListener('click', () => { theme.useCustomTheme(); hint('Custom theme applied (not saved yet).'); });
  for (const b of document.querySelectorAll('[data-accent]')) b.addEventListener('click', () => { const m = b.dataset.accent; theme.setAccentMode(m); updatePresetButtons(); hint((m === 'random' ? 'Random per-song accents' : m === 'sdodr' ? 'Side Order accents' : m === 'custom' ? 'Custom accent' : b.textContent + ' accent') + ' (not saved yet).'); });
  $('savePreset').addEventListener('click', () => { hint(theme.savePreset() ? 'Preset saved to this browser. It will be used after a refresh.' : 'Could not save (storage blocked).', true); });
  $('loadPreset').addEventListener('click', () => { hint(theme.loadSaved() ? 'Saved preset loaded.' : 'No saved preset found.', true); });

  // expose for headless tests
  window.__ms = { state, player, theme, sd, sd2, dom, sliders, addFiles, replaceCurrent, selectTrack, setSettings, currentTrack, wave, setPlaylistOpen, fitToViewport };
  window.__msReady = true;
}
main();
