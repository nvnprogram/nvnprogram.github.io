const VS_QUAD = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;    // canvas px
layout(location=1) in vec2 aBox;    // px from the rect centre (y down)
uniform vec2 uRes;
out vec2 vBox, vScreen;
void main(){
  gl_Position = vec4(aPos.x/uRes.x*2.0-1.0, 1.0-aPos.y/uRes.y*2.0, 0.0, 1.0);
  vBox = aBox; vScreen = aPos;
}`;

const HEAD = `#version 300 es
precision highp float;
out vec4 o;
in vec2 vBox, vScreen;
uniform vec2 uRes, uHalf, uOrigin;      // uOrigin: rect centre in canvas px
uniform float uRadius, uOpacity, uTime;
uniform vec4 uClip;                    // canvas px x0,y0,x1,y1 of the clipping ancestor(s) (huge = none)
uniform vec2 uClipFade;                // px over which alpha ramps in from each clip edge (x, y) - mirrors a CSS mask fade
float clipCov(){ vec2 d = min(vScreen - uClip.xy, uClip.zw - vScreen); vec2 c = clamp(d / uClipFade, 0.0, 1.0); return c.x * c.y; }
vec3 toLin(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
float sdRoundRect(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r; }
float shapeCover(vec2 p){ float sd = sdRoundRect(p, uHalf, uRadius); return clamp(0.5 - sd/max(fwidth(sd), 1e-5), 0.0, 1.0); }
`;

const FS_FILL = HEAD + `
uniform vec3 uColor; uniform float uAlpha, uMix, uDarken; uniform int uUseBlur; uniform sampler2D uBlur;
void main(){
  float cov = shapeCover(vBox);
  vec3 rgb = uColor;
  if(uUseBlur == 1){
    vec3 b = texture(uBlur, vec2(vScreen.x/uRes.x, 1.0 - vScreen.y/uRes.y)).rgb;
    b *= 1.0 - uDarken * b;
    rgb = mix(b, uColor, uMix);
  }
  float a = clamp(cov * uAlpha, 0.0, 1.0) * clipCov();
  o = vec4(rgb * a, a) * uOpacity;
}`;

const FS_SHEEN = HEAD + `
uniform sampler2D uNoise, uGlow;
uniform vec3 uColor; uniform float uAlpha, uWobble;
uniform vec2 uLobeRate;        // uv per px for the lobe (x const law, y fits the height)
uniform vec2 uNoiseRate;       // uv per px for the noise sample (very low frequency)
uniform vec2 uNoiseScroll;     // uv offset (already * time)
uniform vec2 uDispPx;          // uv displacement -> px for the silhouette clip
void main(){
  vec4 C = texture(uNoise, vec2(0.5, 0.938) + uNoiseRate * vBox + uNoiseScroll);
  vec2 d = (vec2(dot(C.xyz, vec3(0.007, 0.0, 0.0)) - 0.0035, dot(C.xyz, vec3(0.0, 0.007, 0.0)) - 0.0035)) * uWobble;
  float lobe = texture(uGlow, vec2(0.5) + uLobeRate * vBox + d).a;
  float Sw = shapeCover(vBox + d * uDispPx);
  float ab = min(lobe, Sw);
  float a = clamp(ab * uAlpha, 0.0, 1.0) * clipCov();
  o = vec4(uColor * a, a) * uOpacity;
}`;

const FS_FLORAL = HEAD + `
uniform sampler2D uNoise, uFloral;
uniform vec3 uColor; uniform float uAlpha, uGradTop;
uniform vec2 uAnchor;          // px position used as the tiling origin (box centre or screen)
uniform float uTilePx, uNoiseTilePx;
uniform vec2 uDrift;           // uv offset (already * time)
uniform float uDispAmt;
void main(){
  vec2 p = vBox + uAnchor;
  vec4 C = texture(uNoise, vec2(0.5) + p / uNoiseTilePx);
  vec2 d = vec2(dot(C.xyz, vec3(uDispAmt, 0.0, 0.0)) - uDispAmt*0.5, dot(C.xyz, vec3(0.0, uDispAmt, 0.0)) - uDispAmt*0.5);
  float m = texture(uFloral, vec2(0.281, 0.719) + p / uTilePx + uDrift + d).a;
  float Sw = shapeCover(vBox);
  float ab = min(m, Sw);
  float vg = mix(uGradTop, 1.0, clamp(vBox.y / max(uHalf.y, 1.0) * 0.5 + 0.5, 0.0, 1.0));
  float a = clamp(ab * uAlpha, 0.0, 1.0) * clipCov();
  o = vec4(uColor * vg * a, a) * uOpacity;
}`;

const FS_GLOW = HEAD + `
uniform sampler2D uGlow;
uniform vec3 uColor; uniform float uAlpha; uniform vec2 uFill;   // fraction of the texture the box spans
void main(){
  float lobe = texture(uGlow, vec2(0.49, 0.5) + vBox / (2.0 * uHalf) * uFill).a;
  float ab = min(lobe, shapeCover(vBox));
  float a = clamp(ab * uAlpha, 0.0, 1.0) * clipCov();
  o = vec4(uColor * a, a) * uOpacity;
}`;

const FS_EDGE = HEAD + `
uniform vec3 uColor; uniform float uAlpha;
void main(){
  float sd = sdRoundRect(vBox, uHalf, uRadius);
  float rim = 0.521 * smoothstep(-1.726, 0.764, sd) * exp(-max(sd, 0.0) / 4.857);
  float a = clamp(rim * uAlpha, 0.0, 1.0) * clipCov();
  o = vec4(uColor * a, a) * uOpacity;
}`;

const FS_SPRITE = HEAD + `
uniform sampler2D uTex; uniform vec3 uColor; uniform float uAlpha; uniform int uMask, uDecode;
void main(){
  vec2 uv = vBox / (2.0 * uHalf) + 0.5;
  vec4 s = texture(uTex, uv);
  if(uDecode == 1) s.rgb = toLin(s.rgb);
  vec3 rgb = (uMask == 1 ? vec3(1.0) : s.rgb) * uColor;
  float a = clamp(s.a * uAlpha, 0.0, 1.0) * clipCov();
  o = vec4(rgb * a, a) * uOpacity;
}`;

const VS_BLIT = `#version 300 es
precision highp float;
layout(location=0) in vec2 p; out vec2 uv;
void main(){ uv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

const FS_PRESENT = `#version 300 es
precision highp float;
uniform sampler2D t; in vec2 uv; out vec4 o;
vec3 toSrgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(vec3(0.0031308), c)); }
void main(){
  vec4 c = texture(t, uv);
  vec3 straight = c.a > 1e-4 ? c.rgb / c.a : c.rgb;
  o = vec4(toSrgb(straight) * c.a, c.a);
}`;

const FS_COPY = `#version 300 es
precision highp float;
uniform sampler2D t; in vec2 uv; out vec4 o;
void main(){ o = vec4(texture(t, uv).rgb, 1.0); }`;

const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D t; uniform vec2 dir; in vec2 uv; out vec4 o;
const float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
void main(){
  vec3 s = texture(t, uv).rgb * w0;
  s += (texture(t, uv + dir*1.0).rgb + texture(t, uv - dir*1.0).rgb) * w1;
  s += (texture(t, uv + dir*2.0).rgb + texture(t, uv - dir*2.0).rgb) * w2;
  s += (texture(t, uv + dir*3.0).rgb + texture(t, uv - dir*3.0).rgb) * w3;
  s += (texture(t, uv + dir*4.0).rgb + texture(t, uv - dir*4.0).rgb) * w4;
  o = vec4(s, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const uni = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); uni[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u: uni };
}

export const s2l = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
export const l2s = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
export const hexToLin = h => [0, 2, 4].map(i => s2l(parseInt(h.substr(1 + i, 2), 16) / 255));
export const linToHex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, l2s(v))) * 255).toString(16).padStart(2, '0')).join('');

const K = {
  sheenAlpha: 0.7843, sheenLobeRateX: 0.00031147541, sheenLobeSpanY: 0.38, sheenNoiseRate: 0.000089285716, sheenNoiseScroll: [0, 0.001000001],
  floral0: { alpha: 0.2353, tilePx: 1 / 0.0046875002, noiseTilePx: 1 / 0.024107144, drift: [-0.00049999968, 0.00049999942], disp: 0.02, gradTop: 0.55686278 },
  floral1: { alpha: 0.3922, tilePx: 1 / 0.0062500001, noiseTilePx: 1 / 0.024107144, drift: [-0.0010000015, 0.001000001], disp: 0.02, gradTop: 1.0 },
  glowAlpha: 0.7843, glowFill: [0.8, 0.8],
  edgeAlpha: 0.7843, edgeColor: [0.058823533, 0.047058828, 0.047058828],
  fillAlpha: 0.9411766,
  btnGlowTint: [0.14901961, 0.098039225, 0.098039225], btnBaseTint: [0.21960786, 0.058823533, 0.058823533],
  plateMean: [0.5862, 0.4365, 0.4133],
  wobbleRefPx: 640, wobbleCurve: 0.25,
};

export const DEFAULT_LOOK = {
  bg: hexToLin('#bdb0aa'), frost: [1, 0.96470594, 0.9450981], floral: [1, 0.7960785, 0.65490198], floral2: [1, 0.3137255, 0],
  panel: hexToLin('#d378e0'), glow: [0.56862748, 0.35686275, 0.20784315], button: [0.5862, 0.4365, 0.4133],
  bgDarken: 0.82, bgFloralScale: 1.25, panelFloralScale: 0.72, panelMix: 0.62, blurDarken: 0.45, wobble: 1.0,
  panelSheenAlpha: 0.62, panelGlowAlpha: 0.7843, bgSheenAlpha: 0.7843, bgFloralAlpha: 1.0, panelFloralAlpha: 1.0,
  panelFlorals: false, panelAlpha: 0.9411766,
};

export class Sdodr {
  static async create(canvas, { assetBase = 'assets/tex/' } = {}) {
    const r = new Sdodr();
    r.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    r.gl = gl;
    r.float = !!gl.getExtension('EXT_color_buffer_float');
    r.look = Object.assign({}, DEFAULT_LOOK);
    r.assetBase = assetBase;
    r._init();
    await r._loadTextures();
    return r;
  }

  _init() {
    const gl = this.gl;
    this.pFill = program(gl, VS_QUAD, FS_FILL);
    this.pSheen = program(gl, VS_QUAD, FS_SHEEN);
    this.pFloral = program(gl, VS_QUAD, FS_FLORAL);
    this.pGlow = program(gl, VS_QUAD, FS_GLOW);
    this.pEdge = program(gl, VS_QUAD, FS_EDGE);
    this.pSprite = program(gl, VS_QUAD, FS_SPRITE);
    this.pPresent = program(gl, VS_BLIT, FS_PRESENT);
    this.pCopy = program(gl, VS_BLIT, FS_COPY);
    this.pBlur = program(gl, VS_BLIT, FS_BLUR);

    this.vbo = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    this.blitVAO = gl.createVertexArray();
    gl.bindVertexArray(this.blitVAO);
    const bb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quad = new Float32Array(24);
    this.fbW = 0; this.fbH = 0;
  }

  _fbo(w, h, byte = false) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.float && !byte) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.float) {
      this.float = false; gl.deleteTexture(tex); gl.deleteFramebuffer(fbo);
      return this._fbo(w, h);
    }
    return { fbo, tex, w, h };
  }
  _del(t) { if (t) { this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fbo); } }

  _resize(w, h) {
    if (w === this.fbW && h === this.fbH) return;
    this.fbW = w; this.fbH = h;
    this._del(this.scene); this.scene = this._fbo(w, h);
    const bw = Math.max(1, Math.floor(w / 4)), bh = Math.max(1, Math.floor(h / 4));
    this._del(this.blurA); this._del(this.blurB);
    this.blurA = this._fbo(bw, bh); this.blurB = this._fbo(bw, bh);
  }

  async _loadTextures() {
    const gl = this.gl;
    const load = async (id, repeat) => {
      const res = await fetch(this.assetBase + id + '.png');
      const img = await createImageBitmap(await res.blob(), { imageOrientation: 'none', premultiplyAlpha: 'none' });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, repeat ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (repeat) gl.generateMipmap(gl.TEXTURE_2D);
      return tex;
    };
    const [noise, glow, floral, buttonBase, buttonSymbol] = await Promise.all([
      load('noise', true), load('glow', false), load('floral', true), load('buttonBase', false), load('buttonSymbol', false),
    ]);
    this.tex = { noise, glow, floral, buttonBase, buttonSymbol };
  }

  setLook(look) { this.look = Object.assign({}, DEFAULT_LOOK, look); this._avgDirty = true; }
  // color of the background bubble at top/bottom edge for borders
  _bgAverage() {
    const gl = this.gl, L = this.look, W = 16, H = 64;
    if (!this.avgFbo) this.avgFbo = this._fbo(W, H, true);
    const fw = this.fbW, fh = this.fbH; this.fbW = W; this.fbH = H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.avgFbo.fbo); gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.BLEND);
    const vw = this.viewport ? this.viewport.w : W;
    const rect = { cx: W / 2, cy: H / 2, hw: W / 2 + 1, hh: H / 2 + 1, r: 0, seed: 0, lobeScale: vw / W, opacity: 1 };
    this._fill(rect, 0, L.bg.map(c => c * L.bgDarken), 1.0, false);
    this._sheen(rect, 0, L.frost, L.bgSheenAlpha, 0);
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    this.fbW = fw; this.fbH = fh;
    const row = Math.min(H - 1, Math.max(0, Math.round((H - 1) * (1 - (this.edgeFrac || 0)))));
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = 0; x < W; x++) { const i = (row * W + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    n *= 255;
    return linToHex([r / n, g / n, b / n]);
  }

  _quad(cx, cy, hw, hh, pad) {
    const q = this.quad, x0 = cx - hw - pad, x1 = cx + hw + pad, y0 = cy - hh - pad, y1 = cy + hh + pad;
    const bx0 = -hw - pad, bx1 = hw + pad, by0 = -hh - pad, by1 = hh + pad;
    q.set([x0, y0, bx0, by0, x1, y0, bx1, by0, x0, y1, bx0, by1, x0, y1, bx0, by1, x1, y0, bx1, by0, x1, y1, bx1, by1]);
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, q, gl.DYNAMIC_DRAW);
  }
  _common(P, rect, time) {
    const gl = this.gl;
    gl.useProgram(P.p);
    gl.uniform2f(P.u.uRes, this.fbW, this.fbH);
    gl.uniform2f(P.u.uHalf, rect.hw, rect.hh);
    gl.uniform2f(P.u.uOrigin, rect.cx, rect.cy);
    gl.uniform1f(P.u.uRadius, rect.r);
    gl.uniform1f(P.u.uOpacity, rect.opacity == null ? 1 : rect.opacity);
    gl.uniform1f(P.u.uTime, time);
    const c = rect.clip, f = rect.clipFade;
    if (c) gl.uniform4f(P.u.uClip, c[0], c[1], c[2], c[3]); else gl.uniform4f(P.u.uClip, -1e6, -1e6, 1e6, 1e6);
    gl.uniform2f(P.u.uClipFade, f ? Math.max(1, f[0]) : 1, f ? Math.max(1, f[1]) : 1);
  }
  _blendOver() { const gl = this.gl; gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
  _blendAdd() { const gl = this.gl; gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE); }
  _tex(unit, tex, loc) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }
  _draw() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 6); }

  _fill(rect, time, color, alpha, useBlur) {
    const P = this.pFill, gl = this.gl, L = this.look;
    this._common(P, rect, time);
    gl.uniform3fv(P.u.uColor, color);
    gl.uniform1f(P.u.uAlpha, alpha);
    gl.uniform1f(P.u.uMix, L.panelMix);
    gl.uniform1f(P.u.uDarken, L.blurDarken);
    gl.uniform1i(P.u.uUseBlur, useBlur ? 1 : 0);
    this._tex(0, useBlur ? this.blurTex : this.tex.glow, P.u.uBlur);
    this._blendOver();
    this._quad(rect.cx, rect.cy, rect.hw, rect.hh, 2);
    this._draw();
  }
  _sheen(rect, time, color, alpha, wobble) {
    const P = this.pSheen, gl = this.gl;
    this._common(P, rect, time);
    gl.uniform3fv(P.u.uColor, color);
    gl.uniform1f(P.u.uAlpha, alpha);
    gl.uniform1f(P.u.uWobble, wobble);
    const H = rect.hh * 2;
    gl.uniform2f(P.u.uLobeRate, K.sheenLobeRateX * rect.lobeScale, K.sheenLobeSpanY / Math.max(H, 1));
    gl.uniform2f(P.u.uNoiseRate, K.sheenNoiseRate, -K.sheenNoiseRate);
    gl.uniform2f(P.u.uNoiseScroll, K.sheenNoiseScroll[0] * time + rect.seed, K.sheenNoiseScroll[1] * time);
    gl.uniform2f(P.u.uDispPx, 160, -H);
    this._tex(0, this.tex.noise, P.u.uNoise);
    this._tex(1, this.tex.glow, P.u.uGlow);
    this._blendOver();
    this._quad(rect.cx, rect.cy, rect.hw, rect.hh, 2);
    this._draw();
  }
  _floral(rect, time, layer, color, scale, screenSpace, alphaMul = 1) {
    const P = this.pFloral, gl = this.gl;
    this._common(P, rect, time);
    gl.uniform3fv(P.u.uColor, color);
    gl.uniform1f(P.u.uAlpha, layer.alpha * alphaMul);
    gl.uniform1f(P.u.uGradTop, layer.gradTop);
    gl.uniform1f(P.u.uTilePx, layer.tilePx * scale);
    gl.uniform1f(P.u.uNoiseTilePx, layer.noiseTilePx * scale);
    gl.uniform2f(P.u.uDrift, layer.drift[0] * time + rect.seed, layer.drift[1] * time);
    gl.uniform1f(P.u.uDispAmt, layer.disp);
    this._tex(0, this.tex.noise, P.u.uNoise);
    this._tex(1, this.tex.floral, P.u.uFloral);
    this._blendAdd();
    this._quad(rect.cx, rect.cy, rect.hw, rect.hh, 2);
    gl.uniform2f(P.u.uAnchor, screenSpace ? rect.cx : 0, screenSpace ? rect.cy : 0);
    this._draw();
  }
  _glow(rect, time, color, alpha) {
    const P = this.pGlow, gl = this.gl;
    this._common(P, rect, time);
    gl.uniform3fv(P.u.uColor, color);
    gl.uniform1f(P.u.uAlpha, alpha);
    gl.uniform2f(P.u.uFill, K.glowFill[0], K.glowFill[1]);
    this._tex(0, this.tex.glow, P.u.uGlow);
    this._blendOver();
    this._quad(rect.cx, rect.cy, rect.hw, rect.hh, 2);
    this._draw();
  }
  static wobbleGain(heightCss) { return Math.max(1, Math.pow(K.wobbleRefPx / Math.max(1, heightCss), K.wobbleCurve)); }
  _tintRatio() { const L = this.look; return [0, 1, 2].map(i => L.button[i] / K.plateMean[i]); }
  _edge(rect, time) {
    const P = this.pEdge, gl = this.gl, r = this._tintRatio();
    this._common(P, rect, time);
    gl.uniform3fv(P.u.uColor, [K.edgeColor[0] * r[0], K.edgeColor[1] * r[1], K.edgeColor[2] * r[2]]);
    gl.uniform1f(P.u.uAlpha, K.edgeAlpha);
    this._blendOver();
    this._quad(rect.cx, rect.cy, rect.hw, rect.hh, 18);
    this._draw();
  }
  _sprite(cx, cy, hw, hh, tex, color, alpha, mask, decode, opacity = 1, clip = null, clipFade = null) {
    const P = this.pSprite, gl = this.gl;
    this._common(P, { cx, cy, hw, hh, r: 0, opacity, clip, clipFade }, 0);
    gl.uniform3fv(P.u.uColor, color);
    gl.uniform1f(P.u.uAlpha, alpha);
    gl.uniform1i(P.u.uMask, mask ? 1 : 0);
    gl.uniform1i(P.u.uDecode, decode ? 1 : 0);
    this._tex(0, tex, P.u.uTex);
    this._blendOver();
    this._quad(cx, cy, hw, hh, 0);
    this._draw();
  }

  _blurScene(sourceInA = false) {
    const gl = this.gl, A = this.blurA, B = this.blurB;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.blitVAO);
    if (!sourceInA) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo); gl.viewport(0, 0, A.w, A.h);
      gl.useProgram(this.pCopy.p);
      this._tex(0, this.scene.tex, this.pCopy.u.t);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.useProgram(this.pBlur.p);
    let src = A, dst = B;
    for (let i = 0; i < 3; i++) {
      for (const d of [[1 / A.w, 0], [0, 1 / A.h]]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.w, dst.h);
        this._tex(0, src.tex, this.pBlur.u.t);
        gl.uniform2f(this.pBlur.u.dir, d[0], d[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const t = src; src = dst; dst = t;
      }
    }
    this.blurTex = src.tex;
    gl.enable(gl.BLEND);
  }

  render(time, panels, rounds, { bgVisible = true, overlay = false } = {}) {
    const gl = this.gl, L = this.look;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    this._resize(W, H);
    if (overlay) bgVisible = false;
    if (this._avgDirty && this.onBgAverage && !overlay) { this._avgDirty = false; this.onBgAverage(this._bgAverage()); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (overlay && !panels.length && !rounds.length) {
      this._present(); return;
    }

    // 1. background bubble: fill (darkened) + wobbling sheen + florals (bigger), no glow
    const bg = { cx: W / 2, cy: H / 2, hw: W / 2 + 4, hh: H / 2 + 4, r: 0, seed: 0, lobeScale: 1 };
    const cw = this.canvas.clientWidth || window.innerWidth || W;
    const vw = this.viewport ? this.viewport.w : cw, vh = this.viewport ? this.viewport.h : (window.innerHeight || H);
    // bg floral tile scale follows the smaller viewport side: phones (~430) 0.7, laptops (~900) 1.0, big screens 1.1
    const cssMin = Math.min(vw, vh);
    const vp = Math.min(1.1, Math.max(0.7, 0.7 + 0.3 * (cssMin - 430) / 470));
    const dpr = W / Math.max(1, cw);
    const bgScale = L.bgFloralScale * vp * dpr;
    if (bgVisible) {
      this._fill(bg, time, L.bg.map(c => c * L.bgDarken), 1.0, false);
      this._sheen(bg, time, L.frost, L.bgSheenAlpha, 0);   // no wobble on the main background: its edge stays static and blends into the page color
      this._floral(bg, time, K.floral0, L.floral, bgScale, true, L.bgFloralAlpha);
      this._floral(bg, time, K.floral1, L.floral2, bgScale, true, L.bgFloralAlpha);
    }

    // 2. blurred backdrop for the panels
    if (panels.length) {
      if (overlay) {
        const A = this.blurA;
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo); gl.viewport(0, 0, A.w, A.h);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const fw = this.fbW, fh = this.fbH; this.fbW = A.w; this.fbH = A.h;
        const sb = { cx: A.w / 2, cy: A.h / 2, hw: A.w / 2 + 2, hh: A.h / 2 + 2, r: 0, seed: 0, lobeScale: 1 };
        this._fill(sb, time, L.bg.map(c => c * L.bgDarken), 1.0, false);
        this._sheen(sb, time, L.frost, L.bgSheenAlpha, 0);
        this._floral(sb, time, K.floral0, L.floral, bgScale / 4, true, L.bgFloralAlpha);
        this._floral(sb, time, K.floral1, L.floral2, bgScale / 4, true, L.bgFloralAlpha);
        this.fbW = fw; this.fbH = fh;
        this._blurScene(true);
      } else this._blurScene();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
      gl.viewport(0, 0, W, H);
    }

    // 3. panels
    for (const p of panels) {
      const hw = p.w / 2, hh = p.h / 2;
      const rr = p.radius == null ? 1 : p.radius;
      const rad = p.rpx != null ? p.rpx : rr * hh; 
      const rect = { cx: p.x + hw, cy: p.y + hh, hw, hh, r: Math.min(rad, hw, hh), opacity: p.opacity, seed: p.seed || 0, lobeScale: 1, clip: p.clip, clipFade: p.clipFade };
      const color = p.color || L.panel, glow = p.glow || L.glow;
      this._fill(rect, time, color, L.panelAlpha * (p.fillAlpha == null ? 1 : p.fillAlpha), true);
      if (p.noGlow !== true) this._glow(rect, time, glow, L.panelGlowAlpha * (p.glowAlpha == null ? 1 : p.glowAlpha));
      this._sheen(rect, time, L.frost, L.panelSheenAlpha, L.wobble * Sdodr.wobbleGain(p.h / dpr));
      if (p.floral === true || (L.panelFlorals && p.noFloral !== true)) {
        this._floral(rect, time, K.floral0, L.floral, L.panelFloralScale * dpr, false, L.panelFloralAlpha);
        this._floral(rect, time, K.floral1, L.floral2, L.panelFloralScale * dpr, false, L.panelFloralAlpha);
      }
      this._edge(rect, time);
    }

    // 4. round buttons (glow 128 sq behind a 100x90 base + plate)
    for (const b of rounds) {
      const s = b.tight ? Math.min(b.w / 52, b.h / 52) : Math.min(b.w / 100, b.h / 90);
      const cx = b.x + b.w / 2 + 1.0 * s, cy = b.y + b.h / 2 + 2.0 * s;
      const op = b.opacity == null ? 1 : b.opacity;
      const ratio = this._tintRatio();
      const mul = (t) => [t[0] * ratio[0], t[1] * ratio[1], t[2] * ratio[2]];
      if (!b.tight) this._sprite(cx, cy - 1.2 * s, 64 * s, 64 * s, this.tex.glow, mul(K.btnGlowTint), 1, true, false, op, b.clip, b.clipFade);
      this._sprite(cx, cy, 50 * s, 45 * s, this.tex.buttonBase, mul(K.btnBaseTint), 1, true, false, op, b.clip, b.clipFade);
      this._sprite(cx, cy, 50 * s, 45 * s, this.tex.buttonSymbol, ratio, 1, false, true, op, b.clip, b.clipFade);
    }
    this._present();
  }

  _present() {
    const gl = this.gl, W = this.fbW, H = this.fbH;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.pPresent.p);
    gl.bindVertexArray(this.blitVAO);
    this._tex(0, this.scene.tex, this.pPresent.u.t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.BLEND);
  }
}

// Drives one or two Sdodr renderers from the DOM: measures every [data-sd] element each frame and
// renders. Elements inside a [data-sd-layer="top"] ancestor go to the overlay renderer (a second
// canvas above the page content, so drawers occlude what is under them).
export class SdodrDom {
  constructor(renderer, canvas, overlayRenderer = null, overlayCanvas = null) {
    this.r = renderer; this.canvas = canvas;
    this.r2 = overlayRenderer; this.canvas2 = overlayCanvas;
    this.time = 0; this.last = performance.now(); this.running = false; this.dprCap = 2;
    this.seeds = new WeakMap(); this._seedN = 0;
    this.clippers = new WeakMap(); this._frameN = 0;
    this.scrollers = [];
    this.overscan = 150;
    this.fits = true;          
    this.parkY = 0;           
    this.frameHook = null;
  }
  async addScroller(el) {
    const canvas = document.createElement('canvas');
    canvas.className = 'sd-scroll-canvas'; canvas.setAttribute('aria-hidden', 'true');
    el.insertBefore(canvas, el.firstChild);
    const r = await Sdodr.create(canvas, { assetBase: this.r.assetBase });
    r.setLook(this.r.look);
    const cs = getComputedStyle(el);
    this.scrollers.push({ el, canvas, r, padBottom: parseFloat(cs.paddingBottom) || 0, w: 0, h: 0, panels: [], rounds: [] });
    return r;
  }
  _scrollerOf(el) { for (const s of this.scrollers) if (s.el !== el && s.el.contains(el)) return s; return null; }
  static viewportHeight() { const vv = window.visualViewport; return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, vv ? vv.height : 0); }
  _clippers(el) {
    const c = this.clippers.get(el);
    if (c && this._frameN - c.at < 60) return c.els;
    const els = [];
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/auto|scroll|hidden|clip/.test(cs.overflowX + ' ' + cs.overflowY)) els.push(a);
    }
    this.clippers.set(el, { els, at: this._frameN });
    return els;
  }
  _clipFor(el, cache) {
    const anc = this._clippers(el);
    if (!anc.length) return null;
    let x0 = -Infinity, y0 = -Infinity, x1 = Infinity, y1 = Infinity, fade = 0;
    for (const a of anc) {
      let r = cache.get(a);
      if (!r) { const rc = a.getBoundingClientRect(); r = { l: rc.left, t: rc.top, r: rc.right, b: rc.bottom, fade: parseFloat(getComputedStyle(a).getPropertyValue('--sd-clip-fade')) || 0 }; cache.set(a, r); }
      x0 = Math.max(x0, r.l); y0 = Math.max(y0, r.t); x1 = Math.min(x1, r.r); y1 = Math.min(y1, r.b); fade = Math.max(fade, r.fade);
    }
    return { x0, y0, x1, y1, fade };
  }
  start() { if (this.running) return; this.running = true; requestAnimationFrame(t => this._frame(t)); }
  stop() { this.running = false; }
  _seed(el) { let s = this.seeds.get(el); if (s == null) { s = (++this._seedN) * 0.173; this.seeds.set(el, s); } return s; }
  measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const cw = document.documentElement.clientWidth || window.innerWidth, vh = SdodrDom.viewportHeight();
    // document height from the page content itself (not scrollHeight, which would include our own canvases:
    // absolutely positioned boxes add to the scrollable overflow, and 100vh on iOS is the large viewport)
    let docH = vh;
    for (const ch of document.body.children) { if (ch === this.canvas || ch === this.canvas2) continue; const b = ch.getBoundingClientRect().bottom + (window.scrollY || 0); if (b > docH) docH = b; }
    docH = Math.floor(docH);   // never taller than the content (a taller canvas would make the page scrollable)
    const over = this.overscan, overB = this.fits ? over : 0, totalH = docH + over + overB;
    const edgeFrac = (over + this.parkY) / totalH;
    if (totalH !== this._totalH || edgeFrac !== this._edgeFrac) {
      this._totalH = totalH; this._edgeFrac = edgeFrac;
      for (const c of [this.canvas, this.canvas2]) if (c) { c.style.top = -over + 'px'; c.style.height = totalH + 'px'; }
      for (const r of [this.r, this.r2]) if (r) { r.edgeFrac = edgeFrac; r._avgDirty = true; }   // where the visible top edge sits in the canvas
    }
    const W = Math.round(cw * dpr), H = Math.round(totalH * dpr);
    for (const c of [this.canvas, this.canvas2]) if (c && (c.width !== W || c.height !== H)) { c.width = W; c.height = H; }
    for (const r of [this.r, this.r2]) if (r) r.viewport = { w: cw, h: vh };
    const sx = window.scrollX || 0, sy = (window.scrollY || 0) + over;   // canvas y = document y + overscan
    const base = { panels: [], rounds: [] }, top = { panels: [], rounds: [] };
    // scroll-container layers: origin = scroll-content origin in viewport px; canvas sized to the content (visual px)
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fit')) || 1;
    for (const s of this.scrollers) {
      s.panels = []; s.rounds = []; s.rect = s.el.getBoundingClientRect(); s.active = s.rect.width > 0 && s.rect.height > 0;
      if (!s.active) continue;
      s.origin = { x: s.rect.left - s.el.scrollLeft * zoom, y: s.rect.top - s.el.scrollTop * zoom };
      let bottom = s.rect.top;
      for (const ch of s.el.children) if (ch !== s.canvas) { const b = ch.getBoundingClientRect().bottom; if (b > bottom) bottom = b; }
      const cwv = s.rect.width, chv = bottom - s.origin.y + s.padBottom * zoom;              // content size in visual px
      const W2 = Math.round(cwv * dpr), H2 = Math.round(chv * dpr);
      if (W2 !== s.w || H2 !== s.h) {
        s.w = W2; s.h = H2; s.canvas.width = W2; s.canvas.height = H2;
        const z = s.canvas.currentCSSZoom || zoom;                                            // CSS px inside the zoomed app are layout px
        s.canvas.style.width = (cwv / z) + 'px'; s.canvas.style.height = (chv / z) + 'px';
      }
      s.r.viewport = { w: cw, h: vh };
    }
    const els = document.querySelectorAll('[data-sd]');
    const clipCache = new Map(); this._frameN++;
    for (const el of els) {
      const rc = el.getBoundingClientRect();
      if (rc.width < 1 || rc.height < 1) continue;
      if (rc.bottom < -vh || rc.top > 2 * vh || rc.right < -40 || rc.left > cw + 40) continue;   // keep a viewport of margin for fast scrolls
      const sc = this.scrollers.length ? this._scrollerOf(el) : null;
      if (sc && (!sc.active || rc.bottom < sc.rect.top - 300 || rc.top > sc.rect.bottom + 300)) continue;
      const clip = sc ? null : this._clipFor(el, clipCache);                                   // inside a scroller the CSS overflow/mask clips the canvas itself
      if (clip && (rc.right <= clip.x0 || rc.left >= clip.x1 || rc.bottom <= clip.y0 || rc.top >= clip.y1)) continue;   // fully scrolled out of its container
      const kind = el.dataset.sd;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;   // invisible DOM => no bubble
      const op = parseFloat(el.dataset.sdOpacity || cs.getPropertyValue('--sd-opacity') || '1') * parseFloat(cs.opacity);
      const layer = sc ? sc : (this.r2 && el.closest('[data-sd-layer="top"]')) ? top : base;
      const ox = sc ? -sc.origin.x : sx, oy = sc ? -sc.origin.y : sy;
      const rect = { x: (rc.left + ox) * dpr, y: (rc.top + oy) * dpr, w: rc.width * dpr, h: rc.height * dpr, opacity: isNaN(op) ? 1 : op };
      if (clip) { rect.clip = [(clip.x0 + sx) * dpr, (clip.y0 + sy) * dpr, (clip.x1 + sx) * dpr, (clip.y1 + sy) * dpr]; rect.clipFade = [1, clip.fade * dpr]; }
      if (kind === 'round') { rect.tight = 'sdTight' in el.dataset; layer.rounds.push(rect); }
      else {
        const col = el.dataset.sdColor || cs.getPropertyValue('--sd-color').trim();
        const glow = el.dataset.sdGlow || cs.getPropertyValue('--sd-glow').trim();
        layer.panels.push(Object.assign(rect, {
          radius: el.dataset.sdRadius != null ? parseFloat(el.dataset.sdRadius) : 1,
          rpx: el.dataset.sdRpx != null ? parseFloat(el.dataset.sdRpx) * dpr : null,
          color: col && col.startsWith('#') ? hexToLin(col) : null,
          glow: glow && glow.startsWith('#') ? hexToLin(glow) : null,
          noGlow: 'sdNoglow' in el.dataset, noFloral: 'sdNofloral' in el.dataset, floral: 'sdFloral' in el.dataset,
          fillAlpha: el.dataset.sdFill != null ? parseFloat(el.dataset.sdFill) : 1,
          glowAlpha: el.dataset.sdGlowAlpha != null ? parseFloat(el.dataset.sdGlowAlpha) : 1,
          seed: this._seed(el),
        }));
      }
    }
    return { base, top, scrollers: this.scrollers };
  }
  renderOnce() {
    const { base, top } = this.measure();
    this.r.render(this.time, base.panels, base.rounds);
    if (this.r2) this.r2.render(this.time, top.panels, top.rounds, { overlay: true });
    for (const s of this.scrollers) if (s.active) { s.r.look = this.r.look; s.r.render(this.time, s.panels, s.rounds, { overlay: true }); }
  }
  _frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.time += dt * 60;
    if (this.frameHook) this.frameHook(dt);
    this.renderOnce();
    requestAnimationFrame(t => this._frame(t));
  }
}
