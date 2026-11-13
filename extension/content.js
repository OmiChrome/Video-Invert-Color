// Midnight Owl content script. Adds one <style> rule and one hidden <svg> while on; nothing runs per frame.
'use strict';
const owlApi = globalThis.browser ?? globalThis.chrome;
const OWL_DEFAULTS = { on: false, mode: 'smart', warm: false, cap: 0.8 };
let owl = { ...OWL_DEFAULTS }, owlSvg = null, owlStyle = null, owlActive = false;

function owlRender() {
  if (owl.on) {
    if (!owlSvg) {
      owlSvg = document.importNode(new DOMParser().parseFromString(owlFilterSvg(owl.cap), 'image/svg+xml').documentElement, true);
      owlStyle = document.createElement('style');
    }
    owlSvg.querySelectorAll('.owl-inv').forEach(m => m.setAttribute('values', owlInvertMatrix(owl.cap)));
    owlStyle.textContent = `video{filter:${owlFilterCss(owl.mode, owl.warm)}!important}`;
    if (!owlSvg.isConnected) (document.body || document.documentElement).append(owlSvg);
    if (!owlStyle.isConnected) (document.head || document.documentElement).append(owlStyle);
  } else {
    owlSvg?.remove(); owlStyle?.remove();
  }
  owlReport();
}

// Tell the toolbar icon whether this frame is darkening a video right now.
function owlReport() {
  const active = owl.on && !!document.querySelector('video');
  if (active === owlActive) return;
  owlActive = active;
  owlApi.runtime.sendMessage({ owlActive: active }).catch?.(() => {});
}

function owlTyping(e) {
  const t = e.composedPath()[0];
  return t instanceof Element && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

// O toggles on any page that has a video. Pages without video keep their own O shortcut.
addEventListener('keydown', e => {
  if (e.code !== 'KeyO' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || owlTyping(e)) return;
  if (!document.querySelector('video')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  owlApi.storage.local.set({ on: !owl.on });
}, true);

// Videos that appear later (YouTube navigation, embeds) are covered by the CSS rule already;
// this only keeps the toolbar icon honest.
document.addEventListener('loadeddata', owlReport, true);
document.addEventListener('play', owlReport, true);

owlApi.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, { newValue }] of Object.entries(changes)) if (k in OWL_DEFAULTS) owl[k] = newValue ?? OWL_DEFAULTS[k];
  owlRender();
});
owlApi.storage.local.get(OWL_DEFAULTS).then(s => { owl = s; owlRender(); });
