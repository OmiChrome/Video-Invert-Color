// Night Owl background: Alt+O command and the bright/dim toolbar icon.
'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const icons = state => Object.fromEntries([16, 32, 48, 128].map(s => [s, `icons/${state}-${s}.png`]));
const activeFrames = new Map(); // tabId -> Set of frameIds darkening a video

function paint(tabId) {
  const on = (activeFrames.get(tabId)?.size ?? 0) > 0;
  api.action.setIcon({ tabId, path: icons(on ? 'on' : 'off') }).catch(() => {});
  api.action.setTitle({ tabId, title: on ? 'Night Owl is darkening this video (O or Alt+O)' : 'Night Owl (O or Alt+O)' }).catch(() => {});
}

api.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null || typeof msg?.owlActive !== 'boolean') return;
  const set = activeFrames.get(tabId) ?? new Set();
  msg.owlActive ? set.add(sender.frameId) : set.delete(sender.frameId);
  activeFrames.set(tabId, set);
  paint(tabId);
});

api.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) { activeFrames.delete(tabId); paint(tabId); }
});
api.tabs.onRemoved.addListener(tabId => activeFrames.delete(tabId));

api.commands.onCommand.addListener(async cmd => {
  if (cmd !== 'toggle') return;
  const { on = false } = await api.storage.local.get('on');
  api.storage.local.set({ on: !on });
});
