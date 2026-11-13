// Midnight Owl content script: settings, the O key, which videos to process, and diagnostics.
// The picture work happens in engine.js (WebGL on the GPU); filters.js is the CSS fallback.
'use strict';
const owlApi = globalThis.browser ?? globalThis.chrome;
const OWL_DEFAULTS = { on: false, mode: 'smart', warm: false, cap: 0.8, debug: false, engine: 'auto' };
let owl = { ...OWL_DEFAULTS };
const owlVideos = new Map();          // <video> -> OwlVideo
let owlStyle = null, owlSvg = null, owlPort = null;

// ---- diagnostics log ------------------------------------------------------------------------------
// Events are batched and handed to the background, which keeps the log for the popup's "Save log".
// Perf lines are only produced while diagnostics are on; errors and fallbacks are always recorded.
const owlQueue = [];
let owlFlush = 0;
function owlLog(kind, data = {}, always = false) {
  if (!owl.debug && !always) return;
  owlQueue.push({ t: Date.now(), kind, host: location.hostname, frame: window === top ? 'top' : 'sub', ...data });
  if (!owlFlush) owlFlush = setTimeout(() => {
    owlFlush = 0;
    owlApi.runtime.sendMessage({ owlLog: owlQueue.splice(0) }).catch?.(() => {});
  }, 1500);
}

// ---- CSS fallback (used only for videos WebGL can't read: DRM, cross-origin, native fullscreen) ----
function owlCss(on) {
  if (!on) { owlStyle?.remove(); owlSvg?.remove(); return; }
  if (!owlSvg) {
    owlSvg = document.importNode(new DOMParser().parseFromString(owlFilterSvg(owl.cap), 'image/svg+xml').documentElement, true);
    owlStyle = document.createElement('style');
  }
  owlSvg.querySelectorAll('.owl-inv').forEach(m => m.setAttribute('values', owlInvertMatrix(owl.cap)));
  const mode = owl.mode === 'mask' ? 'smart' : owl.mode;
  // YouTube's "Ambient mode" paints a glow behind the player from the original (bright) frames: hide it.
  owlStyle.textContent = `video.owl-css{filter:${owlFilterCss(mode, owl.warm)}!important}` +
    '#cinematics,#cinematics-container{visibility:hidden!important}';
  if (!owlSvg.isConnected) (document.body || document.documentElement).append(owlSvg);
  if (!owlStyle.isConnected) (document.head || document.documentElement).append(owlStyle);
}

// ---- videos ----------------------------------------------------------------------------------------
function owlAttach(v) {
  if (!owl.on || owlVideos.has(v) || !(v instanceof HTMLVideoElement)) return;
  owlVideos.set(v, new OwlVideo(v, owl, {
    log: owlLog,
    gone: r => { r.stop(); owlVideos.delete(v); owlReport(); },
  }));
  owlReport();
}

function owlSync() {
  owlCss(owl.on);
  if (owl.on) {
    for (const r of owlVideos.values()) r.update(owl);
    document.querySelectorAll('video').forEach(owlAttach);
  } else {
    for (const r of owlVideos.values()) r.stop();
    owlVideos.clear();
  }
  owlReport();
}

// New videos (YouTube navigation, embeds, players created late) are picked up when they load or play.
for (const t of ['loadeddata', 'play']) document.addEventListener(t, e => owlAttach(e.target), true);

// ---- toolbar icon ---------------------------------------------------------------------------------
// While this frame is darkening a video it holds an open port to the background; the background lights the
// owl for this tab while any frame holds one. Closing the tab, navigating, or turning off drops the port.
function owlReport() {
  const active = owl.on && owlVideos.size > 0;
  if (active && !owlPort) {
    try {
      owlPort = owlApi.runtime.connect({ name: 'owl-active' });
      owlPort.onDisconnect.addListener(() => { owlPort = null; setTimeout(owlReport, 1000); });   // background restarted
    } catch { owlPort = null; }
  } else if (!active && owlPort) {
    const p = owlPort; owlPort = null; p.disconnect();
  }
}

// ---- keys -----------------------------------------------------------------------------------------
// O toggles on any page with a video, never while typing. Pages without video keep their own O shortcut.
function owlTyping(e) {
  const t = e.composedPath()[0];
  return t instanceof Element && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
addEventListener('keydown', e => {
  if (e.code !== 'KeyO' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || owlTyping(e)) return;
  if (!document.querySelector('video')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  owlLog('toggle', { by: 'O', to: !owl.on }, true);
  owlApi.storage.local.set({ on: !owl.on });
}, true);

// ---- settings -------------------------------------------------------------------------------------
owlApi.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let touched = false;
  for (const [k, { newValue }] of Object.entries(changes)) if (k in OWL_DEFAULTS) { owl[k] = newValue ?? OWL_DEFAULTS[k]; touched = true; }
  if (touched) owlSync();
});
owlApi.storage.local.get(OWL_DEFAULTS).then(s => { owl = { ...OWL_DEFAULTS, ...s }; owlSync(); });
