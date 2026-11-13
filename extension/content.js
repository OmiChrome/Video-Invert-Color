// Midnight Owl content script: settings, the O key, which videos to process, and diagnostics.
// The picture work happens in engine.js (WebGL on the GPU); filters.js is the CSS fallback.
'use strict';
const owlApi = globalThis.browser ?? globalThis.chrome;
const OWL_DEFAULTS = { on: false, mode: 'smart', warm: false, cap: 0.8, debug: false, smooth: false, engine: 'auto' };
let owl = { ...OWL_DEFAULTS };
const owlVideos = new Map();          // <video> -> OwlVideo
let owlSvg = null, owlStyle = null, owlPort = null, owlDead = false, owlMo = null;

// A previous copy of this script (before an extension update or reload) may have left things behind.
for (const n of document.querySelectorAll('.owl-canvas, .owl-hud, #owl-filters, style[data-owl]')) n.remove();
for (const v of document.querySelectorAll('video.owl-css')) { v.classList.remove('owl-css'); v.style.removeProperty('filter'); }

// After the extension is updated, reloaded or disabled, this copy can no longer talk to it: switch everything off.
const owlAlive = () => { try { return !!owlApi.runtime?.id; } catch { return false; } };
function owlTeardown() {
  if (owlDead) return;
  owlDead = true;
  for (const r of owlVideos.values()) r.stop();
  owlVideos.clear();
  owlCss(false);
  owlMo?.disconnect();
}

// ---- diagnostics log ------------------------------------------------------------------------------
// Events are batched and handed to the background, which keeps the log for the popup's "Save log".
// Perf lines are only produced while diagnostics are on; errors and fallbacks are always recorded.
const owlQueue = [];
let owlFlush = 0;
function owlLog(kind, data = {}, always = false) {
  if (owlDead || (!owl.debug && !always)) return;
  owlQueue.push({ t: Date.now(), kind, host: location.hostname, frame: window === top ? 'top' : 'sub', ...data });
  if (!owlFlush) owlFlush = setTimeout(() => {
    owlFlush = 0;
    if (owlAlive()) owlApi.runtime.sendMessage({ owlLog: owlQueue.splice(0) }).catch?.(() => {});
  }, 1500);
}

// ---- page-level pieces: SVG filters for the CSS fallback, and YouTube's ambient glow ------------------
function owlCss(on) {
  if (!on) { owlStyle?.remove(); owlSvg?.remove(); return; }
  if (!owlSvg) {
    owlSvg = document.importNode(new DOMParser().parseFromString(owlFilterSvg(owl.cap), 'image/svg+xml').documentElement, true);
    owlStyle = document.createElement('style');
    owlStyle.dataset.owl = '';
    // YouTube's "Ambient mode" paints a glow behind the player from the original (bright) frames: hide it.
    owlStyle.textContent = '#cinematics,#cinematics-container{visibility:hidden!important}';
  }
  owlSvg.querySelectorAll('.owl-inv').forEach(m => m.setAttribute('values', owlInvertMatrix(owl.cap)));
  if (!owlSvg.isConnected) (document.body || document.documentElement).append(owlSvg);
  if (!owlStyle.isConnected) (document.head || document.documentElement).append(owlStyle);
}

// ---- videos ----------------------------------------------------------------------------------------
function owlAttach(v) {
  if (owlDead || !owl.on || owlVideos.has(v) || !(v instanceof HTMLVideoElement)) return;
  owlVideos.set(v, new OwlVideo(v, owl, {
    log: owlLog,
    gone: r => { r.stop(); owlVideos.delete(v); owlReport(); },
  }));
  owlReport();
}

// Videos inside (open) shadow DOM: media events don't leave a shadow root, so listen on each root we find.
const owlRoots = new WeakSet();
function owlWatch(root) {
  if (!owlRoots.has(root)) {
    owlRoots.add(root);
    for (const t of ['loadeddata', 'play']) root.addEventListener(t, e => owlAttach(e.target), true);
  }
  root.querySelectorAll('video').forEach(owlAttach);
}
function owlScanShadows(from) {
  const walk = document.createTreeWalker(from, NodeFilter.SHOW_ELEMENT);
  for (let n = walk.currentNode; n; n = walk.nextNode()) if (n.shadowRoot) { owlWatch(n.shadowRoot); owlScanShadows(n.shadowRoot); }
}

function owlSync() {
  if (owlDead) return;
  owlCss(owl.on);
  if (owl.on) {
    for (const r of owlVideos.values()) r.update(owl);
    owlWatch(document);
    owlScanShadows(document.documentElement);
    // web components that show up later (players like <mux-player>) get their shadow roots watched too
    owlMo ??= new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.shadowRoot || n.localName.includes('-'))) owlScanShadows(n);
    });
    owlMo.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    owlMo?.disconnect();
    for (const r of owlVideos.values()) r.stop();
    owlVideos.clear();
  }
  owlReport();
}

// Scrolling inside a scroller can move a video without any resize: re-place overlays once per frame.
let owlScrollRaf = 0;
document.addEventListener('scroll', () => {
  if (!owlVideos.size || owlScrollRaf) return;
  owlScrollRaf = requestAnimationFrame(() => { owlScrollRaf = 0; for (const r of owlVideos.values()) r.place(); });
}, { capture: true, passive: true });

// ---- toolbar icon ---------------------------------------------------------------------------------
// While this frame is darkening a video it holds an open port to the background; the background lights the
// owl for this tab while any frame holds one. Closing the tab, navigating, or turning off drops the port.
function owlReport() {
  const active = !owlDead && owl.on && owlVideos.size > 0;
  if (active && !owlPort) {
    try {
      owlPort = owlApi.runtime.connect({ name: 'owl-active' });
      owlPort.onDisconnect.addListener(() => {
        owlPort = null;
        if (!owlAlive()) return owlTeardown();          // extension updated, reloaded or disabled
        setTimeout(owlReport, 1000);                    // background restarted: reconnect
      });
    } catch { owlPort = null; if (!owlAlive()) owlTeardown(); }
  } else if (!active && owlPort) {
    const p = owlPort; owlPort = null; p.disconnect();
  }
}

// ---- keys -----------------------------------------------------------------------------------------
// O toggles on any page with a video. Real key presses only (not page scripts), by the letter on the key
// (so Dvorak and Colemak work; other alphabets fall back to the key's position), never while typing.
function owlTyping(e) {
  let a = e.composedPath()[0];
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;    // deepest focused element in open shadow roots
  const editable = el => el instanceof Element && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    /^(textbox|searchbox|combobox)$/.test(el.getAttribute('role') || ''));
  return editable(a) || e.composedPath().slice(0, 4).some(editable);
}
function owlIsO(e) {
  if (e.key === 'o' || e.key === 'O') return true;
  return e.code === 'KeyO' && !/^[a-z]$/i.test(e.key);
}
addEventListener('keydown', e => {
  if (!e.isTrusted || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || !owlIsO(e) || owlTyping(e)) return;
  if (!document.querySelector('video') && !owlVideos.size) return;
  if (!owlAlive()) return owlTeardown();                // leave the key to the page
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
