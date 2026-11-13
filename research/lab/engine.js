// Midnight Owl engine: draws each video frame through a small WebGL2 pipeline into a canvas laid over the video.
//
// Text first: anything darker than the paper flips to light (text, pen, lines, outlines), unless it belongs to a
// big solid shape (box, bar, pie, hair, photo), and the paper flips to near-black. All decisions are made on a tiny
// 240×135 grid (≈8 px cells at 1080p), so the full-size pass is two texture reads and a little arithmetic per
// pixel, light enough for an old integrated GPU.
//
//   1 stats    per cell: paper share (bright, colourless), paper brightness, pure-white share
//              + mipmaps = free large-scale averages
//   2 board    may this area flip? paper scenes vs. illustrated scenes, grown one block to reach paper edges;
//              also the local paper brightness, so grey and unevenly lit boards go fully dark
//   3-4 open   "big solid" map: shrink the non-paper areas by 3 cells, grow them back. Text strokes, pen lines and
//              small marks vanish; boxes, bars, pies, hair and photos come back at their exact size
//   5 decide   per cell: board · paper level · big solid
//   6 picture  per pixel: flip paper and ink, keep big solids, soft highlight roll-off for everything kept
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
// full-resolution pixels for the analysis, whatever the player size (mipmaps only smooth the picture pass)
vec3 src0(vec2 uv) { return textureLod(uSrc, uSrcRect.xy + vec2(uv.x, 1.0 - uv.y) * uSrcRect.zw, 0.0).rgb; }
float chroma(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
// Paper = colourless and not dark. Real paper (digital whiteboards, slides, flat grey backgrounds) has almost no tint;
// skies, walls and white animals in drawings carry a 0.04+ tint, so they are not treated as paper.
float neutral(vec3 c) { return 1.0 - smoothstep(0.03, 0.06, chroma(c)); }
float paperness(vec3 c, float y) { return neutral(c) * smoothstep(0.45, 0.6, y); }
`;

// Pass 1 (small grid): 16 samples per cell, at texel corners so each one averages 2×2 pixels (all 64 at 1080p).
const OWL_STATS_FS = OWL_COMMON + `
void main() {
  float P = 0.0, PY = 0.0, WHITE = 0.0, DARK = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec3 c = src0(vUv + (vec2(float(i), float(j)) - 1.5) * 0.25 * uCell);
    float y = dot(c, W), p = paperness(c, y);
    P += p; PY += p * y; WHITE += neutral(c) * smoothstep(0.88, 0.95, y); DARK += 1.0 - smoothstep(0.35, 0.5, y);
  }
  // R: paper share · G: paper-weighted brightness · B: pure-white share · A: dark-ink share
  o = vec4(P, PY, WHITE, DARK) * 0.0625;
}`;

// Pass 2 (small grid): where may we flip? One value per cell, grown by one block so a qualifying paper area flips
// right up to its edges. Also the local paper brightness used to normalise grey or unevenly lit boards.
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
  float b = boardAt(vUv, g);
  vec2 d = uCell * 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
    if (i != 0 || j != 0) b = max(b, boardAt(vUv + vec2(float(i), float(j)) * d, g));
  vec4 L3 = textureLod(uStats, vUv, 3.0), L4 = textureLod(uStats, vUv, 4.0);
  float level = mix(L4.g / max(L4.r, 1e-3), L3.g / max(L3.r, 1e-3), smoothstep(0.3, 0.6, L3.r));
  o = vec4(b, clamp(level, 0.0, 1.0), textureLod(uStats, vUv, 0.0).a, 1.0);   // B: dark-ink share of this cell
}`;

// Passes 3-4 (small grid): opening of the "not paper" map. Shrink (min over 7×7 cells), then grow (max over 7×7).
// Anything thinner than ~7 cells (56 px at 1080p: letters, bold titles, pen strokes, outlines, small marks) is gone
// afterwards; boxes, bars, pies, hair and photos come back with their exact outline.
const OWL_OPEN_FS = OWL_COMMON + `
uniform sampler2D uIn;
uniform int uGrow;   // 0: shrink, reading 1 - paper share from the stats (.r); 1: grow, reading .r
void main() {
  float v = uGrow == 1 ? 0.0 : 1.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    float x = texture(uIn, vUv + vec2(float(i), float(j)) * uCell).r;
    v = uGrow == 1 ? max(v, x) : min(v, 1.0 - x);
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

// Pass 5 (small grid): the per-cell values the picture pass needs, in one texture.
const OWL_DECIDE_FS = OWL_COMMON + `
uniform sampler2D uBoard, uIn;
void main() {
  vec4 B = texture(uBoard, vUv);
  // R board · G paper brightness · B big solid shape here (keep it as it is)
  o = vec4(B.r, B.g, smoothstep(0.8, 0.95, texture(uIn, vUv).r), 1.0);
}`;

// Pass 6 (screen size): the picture.
const OWL_MAIN_FS = OWL_COMMON + `
uniform sampler2D uDecide;
uniform vec2 uPx;        // one output pixel in uv
uniform int uMode;       // 0 smart, 1 invert, 2 dim, 3 smart + mask view (diagnostics)
uniform float uCap;      // brightest flipped ink
uniform vec3 uTint;
const float DARK = 0.06;

// Soft highlight roll-off: shadows and mid-tones untouched, whites capped near 0.85·cap. (Cheap rational knee.)
vec3 keep(vec3 c, float y) {
  float knee = 0.35, room = max(uCap * 0.85 - knee, 0.05);
  float t = max(y - knee, 0.0) / room;
  float y2 = y < knee ? y : knee + room * t / (1.0 + t);
  return c * (y2 / max(y, 1e-4));
}
// Brightness flip that keeps hue: the paper level becomes DARK, ink becomes uCap.
// crisp (Smart mode): paper with its faint noise and shadows goes to clean black, real ink to full brightness,
// and the anti-aliased edges in between keep their proportions, so letters keep their true shape.
vec3 flip(vec3 c, float y, float level, bool crisp) {
  vec3 cn = min(c / level, 1.0);
  float yn = min(y / level, 1.0), t = 1.0 - yn;
  float yt = DARK + (uCap - DARK) * (crisp ? clamp((t - 0.06) / 0.54, 0.0, 1.0) : t);
  return clamp(cn + (yt - yn), 0.0, 1.0);
}

void main() {
  vec3 c = src(vUv);
  float y = dot(c, W);
  vec3 outc;
  if (uMode == 2) {
    outc = keep(c, y);
  } else if (uMode == 1) {
    outc = flip(c, y, 1.0, false);
  } else {
    vec4 D = texture(uDecide, vUv);
    float level = max(D.g, 0.45), yn = y / level;
    // Inside a board, outside big solid shapes, flip:
    //   · everything colourless: paper, grey edges, black and grey ink
    //   · anything darker than the paper: coloured pen and text
    //   · light colours right next to a much darker pixel: the anti-aliased edges of coloured letters
    // Light colours away from ink (a yellow highlighter, a light fill) stay as they are, so they stay readable.
    float room = D.r * (1.0 - D.b);
    float g = max(neutral(c), 1.0 - smoothstep(0.55, 0.75, yn));
    if (room > 0.01 && g < 0.99) {
      vec2 dx = vec2(uPx.x * 1.5, 0.0), dy = vec2(0.0, uPx.y * 1.5);
      float n = min(min(dot(src(vUv + dx), W), dot(src(vUv - dx), W)), min(dot(src(vUv + dy), W), dot(src(vUv - dy), W)));
      g = max(g, 1.0 - smoothstep(0.45, 0.65, n / level));
    }
    float f = room * g;
    outc = mix(keep(c, y), flip(c, y, level, true), f);
    if (uMode == 3) outc = mix(vec3(y) * 0.35, vec3(D.r, f, D.b), 0.8);   // red board · green flipped · blue big solid
  }
  o = vec4(outc * uTint, 1.0);
}`;

// Compile every shader first and only then ask for the results, so the driver can work on them in parallel;
// the vertex shader is shared by all programs.
function owlPrograms(gl, defs) {
  const compile = (type, text) => { const sh = gl.createShader(type); gl.shaderSource(sh, text); gl.compileShader(sh); return sh; };
  const vs = compile(gl.VERTEX_SHADER, OWL_VS);
  const made = defs.map(([fs]) => {
    const f = compile(gl.FRAGMENT_SHADER, fs), p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, f); gl.linkProgram(p);
    return { p, f };
  });
  return made.map(({ p, f }, i) => {
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('shader: ' + (gl.getShaderInfoLog(f) || gl.getProgramInfoLog(p)));
    const u = {};
    for (const n of defs[i][1]) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  });
}

// The GPU part. Usable with any image source: <video>, <img>, <canvas>, ImageBitmap.
// Texture units: 0 = video frame, 1 = stats (mipmapped), 2 = board, 3 = opening scratch, 4 = big solids, 5 = decisions.
class OwlGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) throw Object.assign(new Error('WebGL2 is not available'), { name: 'NoWebGL2' });
    this.gl = gl;
    [this.stats, this.board, this.open, this.decide, this.main] = owlPrograms(gl, [
      [OWL_STATS_FS, ['uSrc', 'uSrcRect', 'uCell']],
      [OWL_BOARD_FS, ['uStats', 'uCell']],
      [OWL_OPEN_FS, ['uIn', 'uCell', 'uGrow']],
      [OWL_DECIDE_FS, ['uBoard', 'uIn', 'uCell']],
      [OWL_MAIN_FS, ['uSrc', 'uSrcRect', 'uDecide', 'uPx', 'uMode', 'uCap', 'uTint']],
    ]);
    this.vao = gl.createVertexArray();
    this.fbo = { stats: gl.createFramebuffer(), board: gl.createFramebuffer(), open: [gl.createFramebuffer(), gl.createFramebuffer()], decide: gl.createFramebuffer() };
    this.tex = {};
    this.src = { tex: null, w: 0, h: 0, mips: false };
    this.gw = this.gh = 0;
    this.mode = 0; this.cap = 0.8; this.tint = [1, 1, 1];
    this.timer = null;
  }

  texture(unit, w, h, levels) {
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  target(fbo, tex) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
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
    const gl = this.gl, T = this.tex;
    for (const t of Object.values(T).flat()) gl.deleteTexture(t);
    T.stats = this.texture(1, gw, gh, Math.floor(Math.log2(Math.max(gw, gh))) + 1);
    T.board = this.texture(2, gw, gh, 1);
    T.open = [this.texture(3, gw, gh, 1), this.texture(4, gw, gh, 1)];
    T.decide = this.texture(5, gw, gh, 1);
    this.target(this.fbo.stats, T.stats);
    this.target(this.fbo.board, T.board);
    this.target(this.fbo.open[0], T.open[0]);
    this.target(this.fbo.open[1], T.open[1]);
    this.target(this.fbo.decide, T.decide);
    this.gw = gw; this.gh = gh;
  }

  // The video frame goes into a texture allocated once per video size (texSubImage2D: no reallocation per frame).
  upload(source, sw, sh, mips) {
    const gl = this.gl, S = this.src;
    gl.activeTexture(gl.TEXTURE0);
    if (!S.tex || S.w !== sw || S.h !== sh || S.mips !== mips) {
      if (S.tex) gl.deleteTexture(S.tex);
      S.tex = this.texture(0, sw, sh, mips ? Math.floor(Math.log2(Math.max(sw, sh))) + 1 : 1);
      Object.assign(S, { w: sw, h: sh, mips });
    } else gl.bindTexture(gl.TEXTURE_2D, S.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
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
    const gl = this.gl, canvas = gl.canvas, T = this.tex;
    const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
    const q = timed && this.timer?.ext && !this.timer.q ? (this.timer.q = gl.createQuery()) : null;
    if (q) gl.beginQuery(this.timer.ext.TIME_ELAPSED_EXT, q);
    gl.bindVertexArray(this.vao);
    this.grid((sw * rect[2]) / Math.max(1, sh * rect[3]));
    // mipmaps only when a big video is shown much smaller (they cost bandwidth on small GPUs)
    this.upload(source, sw, sh, sw * rect[2] > canvas.width * 2);
    const cell = [1 / this.gw, 1 / this.gh];
    const pass = (prog, fbo) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.useProgram(prog.p); gl.uniform2fv(prog.u.uCell, cell); };
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    if (this.mode === 0 || this.mode === 3) {
      gl.viewport(0, 0, this.gw, this.gh);
      // 1 stats + mip chain
      pass(this.stats, this.fbo.stats);
      gl.uniform1i(this.stats.u.uSrc, 0); gl.uniform4fv(this.stats.u.uSrcRect, rect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bind(1, T.stats); gl.generateMipmap(gl.TEXTURE_2D);
      // 2 board
      pass(this.board, this.fbo.board);
      gl.uniform1i(this.board.u.uStats, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 3-4 opening: shrink stats → open[0], grow open[0] → open[1]
      pass(this.open, this.fbo.open[0]);
      gl.uniform1i(this.open.u.uIn, 1); gl.uniform1i(this.open.u.uGrow, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bind(3, T.open[0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.open[1]);
      gl.uniform1i(this.open.u.uIn, 3); gl.uniform1i(this.open.u.uGrow, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 5 decide
      bind(2, T.board); bind(4, T.open[1]);
      pass(this.decide, this.fbo.decide);
      gl.uniform1i(this.decide.u.uBoard, 2); gl.uniform1i(this.decide.u.uIn, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // 6 the picture
    bind(5, T.decide);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const m = this.main;
    gl.useProgram(m.p);
    gl.uniform1i(m.u.uSrc, 0); gl.uniform1i(m.u.uDecide, 5);
    gl.uniform4fv(m.u.uSrcRect, rect);
    gl.uniform2f(m.u.uPx, 1 / canvas.width, 1 / canvas.height);
    gl.uniform1i(m.u.uMode, this.mode); gl.uniform1f(m.u.uCap, this.cap); gl.uniform3fv(m.u.uTint, this.tint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (q) gl.endQuery(this.timer.ext.TIME_ELAPSED_EXT);
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ---------------------------------------------------------------------------------------------
// One <video> on the page: a canvas laid exactly over the picture, redrawn on every new video frame.
// Falls back to the CSS/SVG filter when WebGL can't be used for this video.

const OWL_MAX_GL = 6;
const OWL_EVENTS = ['loadstart', 'loadeddata', 'seeked', 'resize', 'emptied', 'ratechange', 'play', 'pause', 'encrypted', 'waitingforkey'];
let owlGlCount = 0, owlNoGl = false;

class OwlVideo {
  constructor(video, settings, hooks) {
    this.v = video; this.s = { ...settings }; this.hooks = hooks;
    this.path = 'none'; this.reason = ''; this.lock = '';
    this.canvas = null; this.engine = null; this.hud = null; this.glEvents = null; this.filterBefore = null;
    this.rect = [0, 0, 1, 1]; this.box = ''; this.shown = false; this.handle = 0; this.raf = 0;
    this.perf = { frames: 0, cpu: 0, cpuMax: 0, skipped: 0, lastPresented: -1, since: performance.now(), q: video.getVideoPlaybackQuality?.() };
    this.onEvent = e => this.event(e);
    for (const t of OWL_EVENTS) video.addEventListener(t, this.onEvent);
    video.textTracks?.addEventListener?.('change', this.onEvent);
    document.addEventListener('fullscreenchange', this.onEvent);
    addEventListener('resize', this.onEvent);
    this.choose();
  }

  log(kind, data, always) { this.hooks.log(kind, { ...this.describe(), ...data }, always); }
  describe() {
    const v = this.v;
    return { path: this.path, video: `${v.videoWidth}x${v.videoHeight}`, shown: this.canvas ? `${this.canvas.width}x${this.canvas.height}` : '', rate: v.playbackRate, src: (v.currentSrc || '').split(':')[0] };
  }

  // Why this video can't use the WebGL overlay right now ('' = it can).
  cssReason() {
    const v = this.v;
    if (this.s.engine === 'css') return 'forced';                            // hidden setting, for benchmarks and as an escape hatch
    if (owlNoGl) return 'webgl2-unavailable';
    if (this.lock) return this.lock;                                         // cross-origin, render error (until a new source)
    if (this.engine?.gl.isContextLost()) return 'context-lost';
    if (v.mediaKeys) return 'protected-video';                               // DRM frames can't be read
    if (document.fullscreenElement === v) return 'native-fullscreen';        // the overlay can't follow into native fullscreen
    if (v.controls) return 'native-controls';                                // the overlay would hide the browser's own controls
    if ([...(v.textTracks || [])].some(t => t.mode === 'showing')) return 'captions-showing';   // ...and its captions
    if (getComputedStyle(v).transform !== 'none') return 'transformed-video';
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
        this.canvas = this.engine = null;
        this.log('error', { what: 'webgl-init', message: String(e.message || e) }, true);
        return this.toCss(owlNoGl ? 'webgl2-unavailable' : 'webgl-init-failed');
      }
      owlGlCount++;
      // Listeners die with this canvas (dispose() itself fires a "lost" event later, which must be ignored).
      const ac = this.glEvents = new AbortController();
      c.addEventListener('webglcontextlost', e => { e.preventDefault(); this.log('context-lost', {}, true); this.toCss('context-lost'); }, { signal: ac.signal });
      c.addEventListener('webglcontextrestored', () => { this.log('context-restored', {}, true); this.disposeGl(); this.choose(); }, { signal: ac.signal });
      this.v.after(c);
      this.ro = new ResizeObserver(() => this.place());
      this.ro.observe(this.v);
      if (this.v.parentElement) this.ro.observe(this.v.parentElement);
      this.mo = new MutationObserver(() => this.place());
      this.mo.observe(this.v, { attributes: true, attributeFilter: ['style', 'class', 'controls'] });
    }
    this.engine.set(this.s);
    this.cssOff();
    if (this.path !== 'webgl') { this.path = 'webgl'; this.reason = ''; this.log('attach', {}); }
    this.place();
    this.loop();
    this.draw();
  }

  toCss(reason) {
    this.stopLoop();
    // Free the WebGL context unless we expect to come straight back (leaving native fullscreen).
    if (reason === 'native-fullscreen') { if (this.canvas) this.canvas.style.display = 'none'; } else this.disposeGl();
    this.shown = false;
    this.cssOn();
    if (this.path !== 'css' || this.reason !== reason) { this.path = 'css'; this.reason = reason; this.log('fallback', { reason }, true); }
    // After a GPU reset, try WebGL again a little later (a few times at most).
    if (reason === 'context-lost' && (this.retries = (this.retries || 0) + 1) <= 3)
      setTimeout(() => { if (this.path === 'css' && this.reason === 'context-lost') this.choose(); }, 3000);
    this.hudUpdate(true);
  }

  // The CSS/SVG fallback is an inline style on the video, so it also works inside shadow DOM and under strict CSP.
  cssOn() {
    const st = this.v.style;
    if (!this.filterBefore) this.filterBefore = [st.getPropertyValue('filter'), st.getPropertyPriority('filter')];
    const mode = this.s.mode === 'mask' ? 'smart' : this.s.mode;
    st.setProperty('filter', owlFilterCss(mode, this.s.warm), 'important');
    this.v.classList.add('owl-css');
  }
  cssOff() {
    if (this.filterBefore) {
      const [val, prio] = this.filterBefore;
      if (val) this.v.style.setProperty('filter', val, prio); else this.v.style.removeProperty('filter');
      this.filterBefore = null;
    }
    this.v.classList.remove('owl-css');
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
      case 'fullscreenchange': case 'encrypted': case 'waitingforkey': case 'change': this.choose(); break;
      case 'resize': this.box = ''; this.place(); this.draw(); break;  // intrinsic size changed
      case 'emptied': if (this.canvas) this.canvas.style.display = 'none'; this.shown = false; break;
      case 'ratechange': this.log('rate', {}); break;
      default: this.place(); this.draw();
    }
  }

  // Lay the canvas exactly over the visible picture. Works for any containing block, page zoom and scaled
  // parents (all distances are converted with the measured scale), clips to scrolling/overflow parents the canvas
  // would otherwise escape, and follows position:fixed videos.
  place() {
    const v = this.v, c = this.canvas;
    if (!v.isConnected) return this.hooks.gone(this);
    if (!c || this.path !== 'webgl') return;
    const cs = getComputedStyle(v);
    if (cs.transform !== 'none' || v.controls) return this.choose();
    const w = v.clientWidth, h = v.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
    if (!w || !h || !vw || !vh || cs.display === 'none' || cs.visibility === 'hidden') {   // hidden: no canvas until it shows again
      c.style.display = 'none'; this.shown = false; this.box = ''; return;
    }
    let x = 0, y = 0, cw = w, ch = h, rect = [0, 0, 1, 1];
    const ar = vw / vh, box = w / h;
    if (cs.objectFit === 'cover') {
      if (box > ar) { const k = ar / box; rect = [0, (1 - k) / 2, 1, k]; } else { const k = box / ar; rect = [(1 - k) / 2, 0, k, 1]; }
    } else if (cs.objectFit !== 'fill') {
      if (box > ar) { cw = h * ar; x = (w - cw) / 2; } else { ch = w / ar; y = (h - ch) / 2; }
    }
    // measure (a display:none canvas has no box, so show it invisibly for a moment)
    const wasHidden = c.style.display === 'none';
    if (wasHidden) { c.style.visibility = 'hidden'; c.style.display = 'block'; }
    c.style.position = cs.position === 'fixed' ? 'fixed' : 'absolute';
    c.style.width = cw + 'px'; c.style.height = ch + 'px';
    const cr = c.getBoundingClientRect(), vr = v.getBoundingClientRect();
    const sx = cr.width / (c.offsetWidth || 1) || 1, sy = cr.height / (c.offsetHeight || 1) || 1;   // screen px per canvas CSS px
    const vsx = vr.width / (v.offsetWidth || 1) || 1, vsy = vr.height / (v.offsetHeight || 1) || 1;
    const tx = vr.left + (v.clientLeft + x) * vsx, ty = vr.top + (v.clientTop + y) * vsy;          // target, in screen px
    const left = (parseFloat(c.style.left) || 0) + (tx - cr.left) / sx, top = (parseFloat(c.style.top) || 0) + (ty - cr.top) / sy;
    // clip by overflow/scroll parents between the video and the canvas's containing block
    let l = -Infinity, t = -Infinity, r = Infinity, b = Infinity;
    const cb = c.offsetParent;
    for (let el = v.parentElement; el && el !== cb && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const es = getComputedStyle(el);
      if (es.overflowX === 'visible' && es.overflowY === 'visible') continue;
      const er = el.getBoundingClientRect();
      l = Math.max(l, er.left); t = Math.max(t, er.top); r = Math.min(r, er.right); b = Math.min(b, er.bottom);
    }
    const tw = cw * vsx, th = ch * vsy;
    const ins = [Math.max(0, t - ty) / sy, Math.max(0, tx + tw - r) / sx, Math.max(0, ty + th - b) / sy, Math.max(0, l - tx) / sx];
    const clip = ins.some(n => n > 0.5) ? `inset(${ins.map(n => n.toFixed(1) + 'px').join(' ')})` : '';
    if (wasHidden) { c.style.display = 'none'; c.style.visibility = ''; }

    const key = [left, top, cw, ch, clip, cs.zIndex, cs.opacity, rect].join();
    const dpr = devicePixelRatio || 1;
    // canvas resolution = its size on screen in device pixels (zoom and scaled parents included), at most the video's
    const pw = Math.max(1, Math.round(Math.min(cw * sx * dpr, vw * rect[2]))), ph = Math.max(1, Math.round(Math.min(ch * sy * dpr, vh * rect[3])));
    const resized = c.width !== pw || c.height !== ph;
    if (resized) { c.width = pw; c.height = ph; }   // resizing clears the canvas: redraw below (matters when paused)
    if (key !== this.box) {
      this.box = key;
      Object.assign(c.style, { left: left + 'px', top: top + 'px', clipPath: clip, zIndex: cs.zIndex === 'auto' ? '' : cs.zIndex, opacity: cs.opacity, borderRadius: cs.borderRadius });
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
    // Low-power default: process at most ~30 frames a second. At 2.5× a 24 fps lecture shows 60 frames a second;
    // every other one is plenty for text and halves the GPU work. Seeks and paused frames are always drawn.
    const now = performance.now();
    if (meta && !this.s.smooth && !v.paused && now - (this.lastDraw || 0) < 29) { p.capped = (p.capped || 0) + 1; p.cappedSince = (p.cappedSince || 0) + 1; return; }
    if (this.box && (p.frames & 63) === 0) this.place();   // cheap safety net for layout changes we weren't told about
    if (!this.box || this.path !== 'webgl' || !this.engine) return;   // hidden, removed or switched to CSS meanwhile
    this.lastDraw = now;
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
    if (meta && p.lastPresented >= 0 && meta.presentedFrames > p.lastPresented + 1) p.skipped += meta.presentedFrames - p.lastPresented - 1 - (p.cappedSince || 0);
    if (meta) p.lastPresented = meta.presentedFrames;
    p.cappedSince = 0;
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
      capped: p.capped || 0,
      dropped: q && q0 ? q.droppedVideoFrames - q0.droppedVideoFrames : null,
      decoded: q && q0 ? q.totalVideoFrames - q0.totalVideoFrames : null,
      paused: this.v.paused,
    };
    this.lastLine = line;
    if (!this.v.paused) this.log('perf', line);
    this.hudUpdate();
    Object.assign(p, { frames: 0, cpu: 0, cpuMax: 0, skipped: 0, capped: 0, since: now, q });
  }

  hudUpdate(force) {
    if (!this.s.debug || this.path === 'none') return this.hudRemove();
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
      (this.path === 'webgl' ? `${l.fps ?? '-'} fps · cpu ${l.cpuMs ?? '-'} ms (max ${l.cpuMaxMs ?? '-'})${l.gpuMs != null ? ` · gpu ${l.gpuMs} ms` : ''}\nskipped ${l.skipped ?? '-'} · capped ${l.capped ?? '-'} · dropped ${l.dropped ?? '-'}/${l.decoded ?? '-'}` : 'CSS filter path');
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
    this.glEvents?.abort(); this.glEvents = null;   // first: dispose() fires a late "lost" event we must not hear
    this.ro?.disconnect(); this.mo?.disconnect();
    this.ro = this.mo = null;
    if (this.engine) { this.engine.dispose(); this.engine = null; owlGlCount--; }
    this.canvas?.remove(); this.canvas = null; this.shown = false; this.box = '';
  }

  stop() {
    this.path = 'none';
    this.disposeGl();
    this.hudRemove();
    this.cssOff();
    for (const t of OWL_EVENTS) this.v.removeEventListener(t, this.onEvent);
    this.v.textTracks?.removeEventListener?.('change', this.onEvent);
    document.removeEventListener('fullscreenchange', this.onEvent);
    removeEventListener('resize', this.onEvent);
  }
}
