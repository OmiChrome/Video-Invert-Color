'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { on: false, mode: 'smart', warm: false, cap: 0.8, debug: false };
const form = document.forms[0];

function show(s) {
  form.on.checked = s.on;
  form.mode.value = s.mode === 'mask' ? 'smart' : s.mode;
  form.cap.value = s.cap;
  form.warm.checked = s.warm;
  form.debug.checked = s.debug;
  document.getElementById('owl').src = `icons/${s.on ? 'on' : 'off'}-48.png`;
}

form.addEventListener('change', () => {
  const s = { on: form.on.checked, mode: form.mode.value, cap: +form.cap.value, warm: form.warm.checked, debug: form.debug.checked };
  api.storage.local.set(s).then(() => show(s));
});

async function entries() {
  return (await api.storage.session?.get('owlLog'))?.owlLog ?? [];
}
async function count() {
  const n = (await entries()).length;
  document.getElementById('count').value = n ? `${n} entries` : 'empty';
}

document.getElementById('save').addEventListener('click', async () => {
  const log = {
    extension: api.runtime.getManifest().version,
    browser: navigator.userAgent,
    settings: await api.storage.local.get(DEFAULTS),
    saved: new Date().toISOString(),
    entries: await entries(),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(log, null, 1)], { type: 'application/json' }));
  a.download = `midnight-owl-log-${log.saved.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

document.getElementById('clear').addEventListener('click', async () => {
  await api.runtime.sendMessage({ owlClearLog: true });
  setTimeout(count, 400);
});

api.storage.local.get(DEFAULTS).then(show);
count();
