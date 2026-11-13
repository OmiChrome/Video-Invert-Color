// Midnight Owl background: the bright/dim toolbar owl, the Alt+O command, and the diagnostics log.
'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const icons = state => Object.fromEntries([16, 32, 48, 128].map(n => [n, `icons/${state}-${n}.png`]));

// ---- toolbar owl ----------------------------------------------------------------------------------
// Each frame that is darkening a video keeps a port named "owl-active" open. A tab's owl is bright while it
// has at least one such port. Navigations, closed tabs and turning off all close ports, so the icon can't
// get stuck (YouTube's in-page URL changes don't matter).
const live = new Map();   // tabId -> number of open ports

function paint(tabId) {
  const on = (live.get(tabId) ?? 0) > 0;
  // Firefox for Android has no toolbar icon, so these calls are optional.
  api.action.setIcon?.({ tabId, path: icons(on ? 'on' : 'off') })?.catch?.(() => {});
  api.action.setTitle?.({ tabId, title: on ? 'Midnight Owl is darkening this video' : 'Midnight Owl (O or Alt+O)' })?.catch?.(() => {});
  record({ kind: 'icon', tabId, on });
}

api.runtime.onConnect.addListener(port => {
  if (port.name !== 'owl-active') return;
  const tabId = port.sender?.tab?.id;
  if (tabId == null) return;
  live.set(tabId, (live.get(tabId) ?? 0) + 1);
  paint(tabId);
  port.onDisconnect.addListener(() => {
    const n = (live.get(tabId) ?? 1) - 1;
    if (n > 0) live.set(tabId, n); else live.delete(tabId);
    paint(tabId);
  });
});

// ---- Alt+O ----------------------------------------------------------------------------------------
// Keyboard shortcuts don't exist on Firefox for Android; there the popup is the switch.
api.commands?.onCommand.addListener(async cmd => {
  if (cmd !== 'toggle') return;
  const { on = false } = await api.storage.local.get('on');
  record({ kind: 'toggle', by: 'Alt+O', to: !on }, true);
  api.storage.local.set({ on: !on });
});

// ---- diagnostics log ------------------------------------------------------------------------------
// Kept in storage.session (memory only, cleared when the browser closes), at most 5000 entries.
// Content scripts send batches; the popup saves the log as a JSON file.
let debug = false, log = null, loading = null, saveTimer = 0;
api.storage.local.get({ debug: false }).then(s => { debug = s.debug; });

function loadLog() {
  return loading ??= (api.storage.session?.get('owlLog') ?? Promise.resolve({})).then(r => { log = r.owlLog ?? []; });
}
async function addLog(entries) {
  await loadLog();
  log.push(...entries);
  if (log.length > 5000) log.splice(0, log.length - 5000);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.storage.session?.set({ owlLog: log }), 300);
}
function record(entry, always = false) {
  if (debug || always) addLog([{ t: Date.now(), src: 'background', ...entry }]);
}

api.runtime.onMessage.addListener((msg, sender) => {
  if (Array.isArray(msg?.owlLog)) {
    const tabId = sender.tab?.id, frameId = sender.frameId;
    addLog(msg.owlLog.map(e => ({ ...e, tabId, frameId })));
  } else if (msg?.owlClearLog) {
    log = []; clearTimeout(saveTimer);
    api.storage.session?.set({ owlLog: [] });
  }
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('debug' in changes) debug = !!changes.debug.newValue;
  const keys = Object.keys(changes).filter(k => ['on', 'mode', 'warm', 'cap', 'debug'].includes(k));
  if (keys.length) record({ kind: 'settings', ...Object.fromEntries(keys.map(k => [k, changes[k].newValue])) }, 'on' in changes);
  // Turned off: dim every tab, even ones whose ports we no longer know about after a background restart.
  if (changes.on && !changes.on.newValue) {
    live.clear();
    api.tabs.query({}).then(tabs => tabs.forEach(t => paint(t.id))).catch(() => {});
  }
});
