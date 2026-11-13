'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const $ = id => document.getElementById(id);
const show = s => {
  $('on').checked = s.on; $('warm').checked = s.warm; $('cap').value = s.cap;
  document.querySelector(`[name=mode][value=${s.mode}]`).checked = true;
  $('owl').src = `icons/${s.on ? 'on' : 'off'}-128.png`;
};
api.storage.local.get({ on: false, mode: 'smart', warm: false, cap: 0.8 }).then(show);
const save = () => api.storage.local.set({
  on: $('on').checked, warm: $('warm').checked, cap: +$('cap').value,
  mode: document.querySelector('[name=mode]:checked').value,
}).then(() => api.storage.local.get().then(show));
document.addEventListener('change', save);
