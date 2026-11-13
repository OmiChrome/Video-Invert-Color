// Midnight Owl engine: draws each video frame through a small WebGL2 pipeline into a canvas laid over the video.
//
// All decisions are made on a tiny 240×135 grid (≈8 px cells at 1080p); the full-size pass only reads the frame
// and one decision value per pixel, so the cost per frame is about the same as a plain copy.
//
//   1 stats    per cell: paper share (bright, colourless), paper brightness, pure-white share, colourful share
//              + mipmaps = free large-scale averages
//   2 board    may this area flip? paper scenes vs. illustrated scenes, grown one block to reach paper edges;
//              also the local paper brightness (so grey and unevenly lit boards go fully dark) and "is this a line"
//   3-4 close  fill tiny gaps in the line map so bold, tight words flip as a whole
//   5 decide   per cell: flip lines? flip paper (unless it is a white glyph walled in by a solid fill)?
//   6 picture  per pixel: flip or keep, with a soft highlight roll-off for everything kept
//
// Everything is decided from the frame being shown, so cuts never flash, at any playback speed.
'use strict';

const OWL_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const OWL_COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec4 uSrcRect;   // visible part of the source: x, y, w, h in texture coords
uniform vec2 uCell;      // one stats cell in uv
out vec4 o;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
vec3 src(vec2 uv) { return texture(uSrc, uSrcRect.xy + vec2(uv.x, 1.0 - uv.y) * uSrcRect.zw).rgb; }
float chroma(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
// Paper = colourless and not dark. Real paper (digital whiteboards, slides, flat grey backgrounds) has almost no tint;
// skies, walls and white animals in drawings carry a 0.04+ tint, so they are not treated as paper.
float neutral(vec3 c) { return 1.0 - smoothstep(0.03, 0.06, chroma(c)); }
float paperness(vec3 c, float y) { return neutral(c) * smoothstep(0.45, 0.6, y); }
`;

const OWL_STATS_FS = OWL_COMMON + `
void main() {
  float P = 0.0, PY = 0.0, WHITE = 0.0, COL = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec3 c = src(vUv + (vec2(float(i), float(j)) - 1.5) * 0.25 * uCell);
    float y = dot(c, W), p = paperness(c, y);
    P += p; PY += p * y; WHITE += neutral(c) * smoothstep(0.88, 0.95, y); COL += smoothstep(0.1, 0.25, chroma(c));
  }
  // R: paper share · G: paper-weighted brightness · B: pure-white share · A: colourful share
  o = vec4(P, PY, WHITE, COL) * 0.0625;
}`;

// Pass 2 (same small grid): where may we flip? One value per cell, grown by one block so a qualifying paper
// area flips right up to its edges. Also the local paper brightness used to normalise grey or unevenly lit boards.
const OWL_BOARD_FS = OWL_COMMON + `
uniform sampler2D uStats;
float boardAt(vec2 uv, float g) {
  vec4 L = textureLod(uStats, uv, 4.0);   // ≈128 px blocks at 1080p
  vec4 X = textureLod(uStats, uv, 5.0);   // ≈256 px blocks
  // Paper scenes (whiteboards, slides, plain drawings): enough paper around, over a large area.
  float paperScene = smoothstep(0.3, 0.55, L.r) * smoothstep(0.2, 0.45, X.r);
  // Illustrated scenes, photos, maps: only big areas of pure white (caption panels, slides) qualify,
  // never light-grey skies, columns, glows or white faces inside the picture.
  float pictureScene = smoothstep(0.25, 0.45, L.b) * smoothstep(0.2, 0.35, X.b);
  return mix(pictureScene, paperScene, g) * smoothstep(0.42, 0.52, L.g / max(L.r, 1e-3));
}
void main() {
  // Whole-frame paper share: paper scenes are ~75-97 % paper, illustrated ones well under 50 %.
  float g = smoothstep(0.5, 0.7, textureLod(uStats, vec2(0.5), 12.0).r);
  float b0 = boardAt(vUv, g), b = b0;
  vec2 d = uCell * 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
    if (i != 0 || j != 0) b = max(b, boardAt(vUv + vec2(float(i), float(j)) * d, g));
  vec4 L3 = textureLod(uStats, vUv, 3.0), L4 = textureLod(uStats, vUv, 4.0);
  float level = mix(L4.g / max(L4.r, 1e-3), L3.g / max(L3.r, 1e-3), smoothstep(0.3, 0.6, L3.r));
  // Is this cell part of a line or of text? Paper on both sides at 2 cells, horizontally or vertically; also at
  // 4 cells for colourless ink (thick black strokes, bold titles). Coloured fills (hair, badges, bars) only get
  // the near test, so only their thin outline area could ever count as a line.
  float ink = 0.0, far = 1.0 - smoothstep(0.3, 0.6, textureLod(uStats, vUv, 0.0).a);
  for (int k = 2; k <= 4; k += 2) {
    vec2 dx = vec2(uCell.x * float(k), 0.0), dy = vec2(0.0, uCell.y * float(k));
    float t = max(min(textureLod(uStats, vUv + dx, 0.0).r, textureLod(uStats, vUv - dx, 0.0).r),
                  min(textureLod(uStats, vUv + dy, 0.0).r, textureLod(uStats, vUv - dy, 0.0).r));
    ink = max(ink, k == 2 ? t : t * far);
  }
  o = vec4(b, clamp(level, 0.0, 1.0), ink, b0);
}`;

// Passes 3 and 4 (small grid): morphological closing of the ink map (grow one cell, then shrink one cell).
// Fills the tiny gaps inside bold, tightly spaced words so they flip as a whole, without growing into boxes.
const OWL_MORPH_FS = OWL_COMMON + `
uniform sampler2D uIn;
uniform int uGrow;   // 1 = max (grow), 0 = min (shrink)
uniform int uChan;   // read channel: 2 = board.b, 0 = .r
void main() {
  float v = uGrow == 1 ? 0.0 : 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 t = texture(uIn, vUv + vec2(float(i), float(j)) * uCell);
    float x = uChan == 2 ? t.b : t.r;
    v = uGrow == 1 ? max(v, x) : min(v, x);
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

// Pass 5 (small grid): the per-cell decisions the picture pass needs.
const OWL_DECIDE_FS = OWL_COMMON + `
uniform sampler2D uStats, uBoard, uIn;
float solid(vec2 uv) { return (1.0 - textureLod(uStats, uv, 0.0).r) * (1.0 - texture(uIn, uv).r); }
void main() {
  vec4 B = texture(uBoard, vUv);
  // Walled paper: a SOLID fill (not paper, not text) on both sides along at least two directions = a white glyph
  // inside a badge or box; it stays white. A gap between lines of text, or between two shapes (one direction
  // only), still goes dark.
  vec2 dx = vec2(uCell.x * 2.0, 0.0), dy = vec2(0.0, uCell.y * 2.0), d1 = (dx + dy) * 0.7071, d2 = (dx - dy) * 0.7071;
  float wa = min(solid(vUv + dx), solid(vUv - dx)), wb = min(solid(vUv + dy), solid(vUv - dy));
  float wc = min(solid(vUv + d1), solid(vUv - d1)), we = min(solid(vUv + d2), solid(vUv - d2));
  float walled = max(max(max(min(wa, wb), min(wa, wc)), max(min(wa, we), min(wb, wc))), max(min(wb, we), min(wc, we)));
  // R board · G paper brightness · B flip lines here · A flip paper here
  o = vec4(B.r, B.g, smoothstep(0.3, 0.6, texture(uIn, vUv).r), 1.0 - smoothstep(0.55, 0.85, walled));
}`;

// Pass 6 (screen size): the picture.
const OWL_MAIN_FS = OWL_COMMON + `
uniform sampler2D uDecide;
uniform int uMode;       // 0 smart, 1 invert, 2 dim, 3 smart + mask view (diagnostics)
uniform float uCap;      // brightest flipped ink
uniform vec3 uTint;
const float DARK = 0.06;

// Soft highlight roll-off: shadows and mid-tones untouched, whites capped near 0.85·cap.
vec3 keep(vec3 c, float y) {
  float knee = 0.35, room = max(uCap * 0.85 - knee, 0.05);
  float y2 = y < knee ? y : knee + room * (1.0 - exp(-(y - knee) / room));
  return c * (y2 / max(y, 1e-4));
}
// Brightness flip that keeps hue: the paper level becomes DARK, the darkest ink becomes uCap.
vec3 flip(vec3 c, float y, float level) {
  vec3 cn = min(c / level, 1.0);
  float yn = min(y / level, 1.0);
  float yt = DARK + (uCap - DARK) * pow(1.0 - yn, 1.2);
  return clamp(cn + (yt - yn), 0.0, 1.0);
}

void main() {
  vec3 c = src(vUv);
  float y = dot(c, W);
  vec3 outc;
  if (uMode == 2) {
    outc = keep(c, y);
  } else if (uMode == 1) {
    outc = flip(c, y, 1.0);
  } else {
    vec4 D = texture(uDecide, vUv);
    float level = max(D.g, 0.45);
    float isPaper = neutral(c) * smoothstep(0.6, 0.8, y / level);
    float f = D.r * mix(D.b, D.a, isPaper);
    outc = mix(keep(c, y), flip(c, y, level), f);
    if (uMode == 3) outc = mix(vec3(y) * 0.35, vec3(D.r, f, isPaper), 0.8);   // red board · green flipped · blue paper
  }
  o = vec4(outc * uTint, 1.0);
}`;

function owlShader(gl, type, text) {
  const s = gl.createShader(type);
  gl.shaderSource(s, text);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

function owlProgram(gl, fs, names) {
  const p = gl.createProgram();
  gl.attachShader(p, owlShader(gl, gl.VERTEX_SHADER, OWL_VS));
  gl.attachShader(p, owlShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}

// The GPU part. Usable with any image source: <video>, <img>, <canvas>, ImageBitmap.
// Texture units: 0 = video frame, 1 = stats (mipmapped), 2 = board, 3 = line map (scratch), 4 = line map (closed),
// 5 = decisions.
class OwlGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw Object.assign(new Error('WebGL2 is not available'), { name: 'NoWebGL2' });
    this.gl = gl;
    this.stats = owlProgram(gl, OWL_STATS_FS, ['uSrc', 'uSrcRect', 'uCell']);
    this.board = owlProgram(gl, OWL_BOARD_FS, ['uStats', 'uCell']);
    this.morph = owlProgram(gl, OWL_MORPH_FS, ['uIn', 'uCell', 'uGrow', 'uChan']);
    this.decide = owlProgram(gl, OWL_DECIDE_FS, ['uStats', 'uBoard', 'uIn', 'uCell']);
    this.main = owlProgram(gl, OWL_MAIN_FS, ['uSrc', 'uSrcRect', 'uDecide', 'uMode', 'uCap', 'uTint']);
    this.vao = gl.createVertexArray();
    this.statsFbo = gl.createFramebuffer();
    this.boardFbo = gl.createFramebuffer();
    this.inkFbo = [gl.createFramebuffer(), gl.createFramebuffer()];
    this.decideFbo = gl.createFramebuffer();
    this.srcTex = this.texture(0, 1, 1, false, true);
    this.statsTex = this.boardTex = this.decideTex = null; this.inkTex = []; this.gw = this.gh = 0; this.srcMips = false;
    this.mode = 0; this.cap = 0.8; this.tint = [1, 1, 1];
    this.timer = null;
  }

  texture(unit, w, h, mipmapped, mutable) {
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (!mutable) gl.texStorage2D(gl.TEXTURE_2D, mipmapped ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  set({ mode = 'smart', cap = 0.8, warm = false }) {
    this.mode = { smart: 0, invert: 1, dim: 2, mask: 3 }[mode] ?? 0;
    this.cap = +cap;
    this.tint = warm ? [1, 0.82, 0.55] : [1, 1, 1];
  }

  // The small analysis grid: 135 rows, as many columns as the picture's shape needs (240 for 16:9).
  grid(aspect) {
    const gh = 135, gw = Math.max(16, Math.min(512, Math.round(gh * aspect)));
    if (gw === this.gw && gh === this.gh) return;
    const gl = this.gl;
    if (this.statsTex) for (const t of [this.statsTex, this.boardTex, this.decideTex, ...this.inkTex]) gl.deleteTexture(t);
    this.statsTex = this.texture(1, gw, gh, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statsFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.statsTex, 0);
    this.boardTex = this.texture(2, gw, gh, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.boardFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.boardTex, 0);
    this.inkTex = [this.texture(3, gw, gh, false), this.texture(4, gw, gh, false)];
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.inkFbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.inkTex[i], 0);
    }
    this.decideTex = this.texture(5, gw, gh, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.decideFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.decideTex, 0);
    this.gw = gw; this.gh = gh;
  }

  // Optional GPU timing (only where the browser exposes the timer extension). Returns the last measured ms or null.
  gpuTime(enable) {
    const gl = this.gl;
    if (!enable) return null;
    if (this.timer === null) this.timer = { ext: gl.getExtension('EXT_disjoint_timer_query_webgl2'), q: null, ms: null };
    const t = this.timer;
    if (!t.ext) return null;
    if (t.q && gl.getQueryParameter(t.q, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(t.ext.GPU_DISJOINT_EXT)) t.ms = gl.getQueryParameter(t.q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(t.q); t.q = null;
    }
    return t.ms;
  }

  render(source, rect = [0, 0, 1, 1], timed = false) {
    const gl = this.gl, canvas = gl.canvas;
    const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
    const t = timed && this.timer?.ext && !this.timer.q ? (this.timer.q = gl.createQuery()) : null;
    if (t) gl.beginQuery(this.timer.ext.TIME_ELAPSED_EXT, t);
    gl.bindVertexArray(this.vao);
    this.grid((sw * rect[2]) / Math.max(1, sh * rect[3]));

    // the frame
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const mips = sw * rect[2] > canvas.width * 1.6;   // big video in a small player: avoid shimmering text
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    if (mips !== this.srcMips) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); this.srcMips = mips; }

    const cell = [1 / this.gw, 1 / this.gh];
    if (this.mode === 0 || this.mode === 3) {
      // pass 1: stats + mip chain
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.statsFbo);
      gl.viewport(0, 0, this.gw, this.gh);
      gl.useProgram(this.stats.p);
      gl.uniform1i(this.stats.u.uSrc, 0);
      gl.uniform4fv(this.stats.u.uSrcRect, rect);
      gl.uniform2fv(this.stats.u.uCell, cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.statsTex);
      gl.generateMipmap(gl.TEXTURE_2D);
      // pass 2: board
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.boardFbo);
      gl.useProgram(this.board.p);
      gl.uniform1i(this.board.u.uStats, 1);
      gl.uniform2fv(this.board.u.uCell, cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // passes 3-4: close the ink map (grow from board.b into ink[0], shrink into ink[1])
      gl.useProgram(this.morph.p);
      gl.uniform2fv(this.morph.u.uCell, cell);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.boardTex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.inkFbo[0]);
      gl.uniform1i(this.morph.u.uIn, 2); gl.uniform1i(this.morph.u.uGrow, 1); gl.uniform1i(this.morph.u.uChan, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.inkTex[0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.inkFbo[1]);
      gl.uniform1i(this.morph.u.uIn, 3); gl.uniform1i(this.morph.u.uGrow, 0); gl.uniform1i(this.morph.u.uChan, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // pass 5: per-cell decisions
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.inkTex[1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.decideFbo);
      gl.useProgram(this.decide.p);
      gl.uniform1i(this.decide.u.uStats, 1); gl.uniform1i(this.decide.u.uBoard, 2); gl.uniform1i(this.decide.u.uIn, 4);
      gl.uniform2fv(this.decide.u.uCell, cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // pass 6: the picture
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.decideTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const m = this.main;
    gl.useProgram(m.p);
    gl.uniform1i(m.u.uSrc, 0);
    gl.uniform1i(m.u.uDecide, 5);
    gl.uniform4fv(m.u.uSrcRect, rect);
    gl.uniform1i(m.u.uMode, this.mode);
    gl.uniform1f(m.u.uCap, this.cap);
    gl.uniform3fv(m.u.uTint, this.tint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (t) gl.endQuery(this.timer.ext.TIME_ELAPSED_EXT);
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ---------------------------------------------------------------------------------------------
// One <video> on the page: a canvas laid exactly over the picture, redrawn on every new video frame.
// Falls back to the CSS/SVG filter (class "owl-css") when WebGL can't be used for this video.

const OWL_MAX_GL = 6;
let owlGlCount = 0, owlNoGl = false;

class OwlVideo {
  constructor(video, settings, hooks) {
    this.v = video; this.s = { ...settings }; this.hooks = hooks;
    this.path = 'none'; this.reason = ''; this.lock = '';
    this.canvas = null; this.engine = null; this.hud = null;
    this.rect = [0, 0, 1, 1]; this.box = ''; this.shown = false; this.handle = 0; this.raf = 0;
    this.perf = { frames: 0, cpu: 0, cpuMax: 0, skipped: 0, lastPresented: -1, since: performance.now(), q: video.getVideoPlaybackQuality?.() };
    this.onEvent = e => this.event(e);
    for (const t of ['loadstart', 'loadeddata', 'seeked', 'resize', 'emptied', 'ratechange', 'play', 'pause']) video.addEventListener(t, this.onEvent);
    document.addEventListener('fullscreenchange', this.onEvent);
    addEventListener('resize', this.onEvent);
    this.choose();
  }

  log(kind, data, always) { this.hooks.log(kind, { ...this.describe(), ...data }, always); }
  describe() {
    const v = this.v;
    return { path: this.path, video: `${v.videoWidth}x${v.videoHeight}`, shown: this.canvas ? `${this.canvas.width}x${this.canvas.height}` : '', rate: v.playbackRate, src: (v.currentSrc || '').split(':')[0] };
  }

  cssReason() {
    if (this.s.engine === 'css') return 'forced';   // hidden setting, used for benchmarks and as an escape hatch
    if (owlNoGl) return 'webgl2-unavailable';
    if (this.lock) return this.lock;
    if (this.v.mediaKeys) return 'protected-video';
    if (document.fullscreenElement === this.v) return 'native-fullscreen';
    if (!this.engine && owlGlCount >= OWL_MAX_GL) return 'too-many-videos';
    return '';
  }

  choose() {
    const why = this.cssReason();
    if (why) this.toCss(why); else this.toGl();
  }

  toGl() {
    if (!this.engine) {
      const c = this.canvas = document.createElement('canvas');
      c.className = 'owl-canvas';
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;pointer-events:none;display:none;';
      try {
        this.engine = new OwlGL(c);
      } catch (e) {
        if (e.name === 'NoWebGL2') owlNoGl = true;
        this.canvas = null;
        this.log('error', { what: 'webgl-init', message: String(e.message || e) }, true);
        return this.toCss(owlNoGl ? 'webgl2-unavailable' : 'webgl-init-failed');
      }
      owlGlCount++;
      c.addEventListener('webglcontextlost', e => { e.preventDefault(); this.log('context-lost', {}, true); this.toCss('context-lost'); });
      c.addEventListener('webglcontextrestored', () => { this.disposeGl(); this.log('context-restored', {}, true); this.choose(); });
      this.v.after(c);
      this.ro = new ResizeObserver(() => this.place());
      this.ro.observe(this.v);
      if (this.v.parentElement) this.ro.observe(this.v.parentElement);
      this.mo = new MutationObserver(() => this.place());
      this.mo.observe(this.v, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    this.engine.set(this.s);
    this.v.classList.remove('owl-css');
    if (this.path !== 'webgl') { this.path = 'webgl'; this.reason = ''; this.log('attach', {}); }
    this.place();
    this.loop();
    this.draw();
  }

  toCss(reason) {
    this.stopLoop();
    if (this.canvas) this.canvas.style.display = 'none';
    this.shown = false;
    this.v.classList.add('owl-css');
    if (this.path !== 'css' || this.reason !== reason) { this.path = 'css'; this.reason = reason; this.log('fallback', { reason }, true); }
    this.hudUpdate(true);
  }

  update(settings) {
    const wasDebug = this.s.debug;
    this.s = { ...settings };
    if (this.engine) this.engine.set(settings);
    if (!settings.debug) this.hudRemove();
    this.choose();
    if (settings.debug && !wasDebug) this.log('video', { reason: this.reason });   // snapshot when diagnostics start
  }

  event(e) {
    switch (e.type) {
      case 'loadstart': this.lock = ''; this.choose(); break;            // new source: try WebGL again
      case 'fullscreenchange': this.choose(); break;
      case 'resize': this.box = ''; this.place(); this.draw(); break;  // intrinsic size changed
      case 'emptied': if (this.canvas) this.canvas.style.display = 'none'; this.shown = false; break;
      case 'ratechange': this.log('rate', {}); break;
      default: this.place(); this.draw();
    }
  }

  // Lay the canvas exactly over the visible picture (handles object-fit, borders, transformed parents).
  place() {
    const v = this.v, c = this.canvas;
    if (!v.isConnected) return this.hooks.gone(this);
    if (!c || this.path !== 'webgl') return;
    const cs = getComputedStyle(v);
    const w = v.clientWidth, h = v.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
    if (!w || !h || !vw || !vh || cs.display === 'none' || cs.visibility === 'hidden') {   // hidden: no canvas until it shows again
      c.style.display = 'none'; this.shown = false; this.box = ''; return;
    }
    let x = 0, y = 0, cw = w, ch = h, rect = [0, 0, 1, 1];
    const ar = vw / vh, box = w / h;
    if (cs.objectFit === 'cover') {
      if (box > ar) { const s = ar / box; rect = [0, (1 - s) / 2, 1, s]; } else { const s = box / ar; rect = [(1 - s) / 2, 0, s, 1]; }
    } else if (cs.objectFit !== 'fill') {
      if (box > ar) { cw = h * ar; x = (w - cw) / 2; } else { ch = w / ar; y = (h - ch) / 2; }
    }
    const fixed = cs.position === 'fixed';
    c.style.position = fixed ? 'fixed' : 'absolute';
    const vr = v.getBoundingClientRect();
    let ox = 0, oy = 0;
    if (!fixed) {   // where would left:0/top:0 put us? (works for any containing block)
      const cr = c.getBoundingClientRect();
      ox = cr.left - (parseFloat(c.style.left) || 0); oy = cr.top - (parseFloat(c.style.top) || 0);
      if (c.style.display === 'none') {   // hidden canvases have no box: measure once while invisible
        c.style.visibility = 'hidden'; c.style.display = 'block';
        const r2 = c.getBoundingClientRect();
        ox = r2.left - (parseFloat(c.style.left) || 0); oy = r2.top - (parseFloat(c.style.top) || 0);
        c.style.display = 'none'; c.style.visibility = '';
      }
    }
    const left = vr.left - ox + v.clientLeft + x, top = vr.top - oy + v.clientTop + y;
    const key = [left, top, cw, ch, cs.zIndex, cs.opacity, rect].join();
    const dpr = devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(Math.min(cw * dpr, vw * rect[2]))), ph = Math.max(1, Math.round(Math.min(ch * dpr, vh * rect[3])));
    const resized = c.width !== pw || c.height !== ph;
    if (resized) { c.width = pw; c.height = ph; }   // resizing clears the canvas: redraw below (matters when paused)
    if (key !== this.box) {
      this.box = key;
      Object.assign(c.style, { left: left + 'px', top: top + 'px', width: cw + 'px', height: ch + 'px', zIndex: cs.zIndex === 'auto' ? '' : cs.zIndex, opacity: cs.opacity, borderRadius: cs.borderRadius });
      this.rect = rect;
      this.hudPlace();
    }
    if (resized && this.shown) this.draw();
  }

  loop() {
    if (this.handle || this.raf) return;
    const v = this.v;
    if (v.requestVideoFrameCallback) {
      const tick = (now, meta) => {
        this.handle = 0;
        if (this.path !== 'webgl') return;
        this.handle = v.requestVideoFrameCallback(tick);
        this.draw(meta);
      };
      this.handle = v.requestVideoFrameCallback(tick);
    } else {   // older browsers: redraw when the picture time changes
      let last = -1;
      const tick = () => {
        this.raf = 0;
        if (this.path !== 'webgl') return;
        this.raf = requestAnimationFrame(tick);
        if (v.currentTime !== last) { last = v.currentTime; this.draw(); }
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  stopLoop() {
    if (this.handle) this.v.cancelVideoFrameCallback?.(this.handle);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.handle = this.raf = 0;
  }

  draw(meta) {
    if (this.path !== 'webgl' || !this.engine) return;
    const v = this.v, c = this.canvas;
    if (v.readyState < 2 || !v.videoWidth) return;
    if (!this.box) this.place();
    const p = this.perf;
    if (this.box && (p.frames & 63) === 0) this.place();   // cheap safety net for layout changes we weren't told about
    if (!this.box || this.path !== 'webgl' || !this.engine) return;   // hidden, removed or switched to CSS meanwhile
    const t0 = performance.now();
    try {
      this.engine.gpuTime(this.s.debug);
      this.engine.render(v, this.rect, this.s.debug);
    } catch (e) {
      if (e && e.name === 'SecurityError') { this.lock = 'cross-origin-video'; return this.toCss(this.lock); }
      this.log('error', { what: 'render', message: String(e && e.message || e) }, true);
      this.lock = 'render-error';
      return this.toCss(this.lock);
    }
    const ms = performance.now() - t0;
    if (!this.shown) { c.style.display = 'block'; this.shown = true; }
    p.frames++; p.cpu += ms; if (ms > p.cpuMax) p.cpuMax = ms;
    if (meta && p.lastPresented >= 0 && meta.presentedFrames > p.lastPresented + 1) p.skipped += meta.presentedFrames - p.lastPresented - 1;
    if (meta) p.lastPresented = meta.presentedFrames;
    if (this.s.debug && performance.now() - p.since > 2000) this.report();
  }

  // Every 2 s while diagnostics are on: one perf line to the log and the on-video stats box.
  report() {
    const p = this.perf, now = performance.now(), secs = (now - p.since) / 1000;
    const q = this.v.getVideoPlaybackQuality?.(), q0 = p.q;
    const line = {
      fps: +(p.frames / secs).toFixed(1),
      cpuMs: +(p.cpu / Math.max(1, p.frames)).toFixed(2),
      cpuMaxMs: +p.cpuMax.toFixed(2),
      gpuMs: this.engine?.timer?.ms != null ? +this.engine.timer.ms.toFixed(2) : null,
      skipped: p.skipped,
      dropped: q && q0 ? q.droppedVideoFrames - q0.droppedVideoFrames : null,
      decoded: q && q0 ? q.totalVideoFrames - q0.totalVideoFrames : null,
      paused: this.v.paused,
    };
    this.lastLine = line;
    if (!this.v.paused) this.log('perf', line);
    this.hudUpdate();
    Object.assign(p, { frames: 0, cpu: 0, cpuMax: 0, skipped: 0, since: now, q });
  }

  hudUpdate(force) {
    if (!this.s.debug) return this.hudRemove();
    if (!this.hud) {
      const d = this.hud = document.createElement('div');
      d.className = 'owl-hud';
      d.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#ffc845;background:rgba(0,0,0,.72);padding:4px 7px;border-radius:5px;white-space:pre;';
      (this.canvas || this.v).after(d);
      this.hudPlace();
    }
    const l = this.lastLine || {}, why = this.path === 'css' ? ` (${this.reason})` : '';
    this.hud.textContent = `Midnight Owl · ${this.path}${why} · ${this.s.mode}\n` +
      `${this.v.videoWidth}x${this.v.videoHeight} → ${this.canvas?.width ?? '-'}x${this.canvas?.height ?? '-'} · ${this.v.playbackRate}×\n` +
      (this.path === 'webgl' ? `${l.fps ?? '-'} fps · cpu ${l.cpuMs ?? '-'} ms (max ${l.cpuMaxMs ?? '-'})${l.gpuMs != null ? ` · gpu ${l.gpuMs} ms` : ''}\nskipped ${l.skipped ?? '-'} · dropped ${l.dropped ?? '-'}/${l.decoded ?? '-'}` : 'CSS filter path');
    if (force) this.hudPlace();
  }

  hudPlace() {
    if (!this.hud) return;
    const ref = this.path === 'webgl' && this.canvas ? this.canvas.style : null;
    this.hud.style.left = (ref ? parseFloat(ref.left) : this.v.offsetLeft) + 8 + 'px';
    this.hud.style.top = (ref ? parseFloat(ref.top) : this.v.offsetTop) + 8 + 'px';
  }

  hudRemove() { this.hud?.remove(); this.hud = null; }

  disposeGl() {
    this.stopLoop();
    this.ro?.disconnect(); this.mo?.disconnect();
    this.ro = this.mo = null;
    if (this.engine) { this.engine.dispose(); this.engine = null; owlGlCount--; }
    this.canvas?.remove(); this.canvas = null; this.shown = false; this.box = '';
  }

  stop() {
    this.disposeGl();
    this.hudRemove();
    this.v.classList.remove('owl-css');
    for (const t of ['loadstart', 'loadeddata', 'seeked', 'resize', 'emptied', 'ratechange', 'play', 'pause']) this.v.removeEventListener(t, this.onEvent);
    document.removeEventListener('fullscreenchange', this.onEvent);
    removeEventListener('resize', this.onEvent);
    this.path = 'none';
  }
}
