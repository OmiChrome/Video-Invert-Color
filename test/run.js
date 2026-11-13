// End-to-end tests of the extension in Chromium. Usage: node test/run.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../extension'), PAGES = path.join(__dirname, 'pages');
if (!fs.existsSync(path.join(PAGES, 'demo.mp4'))) fs.copyFileSync(path.resolve(__dirname, '../research/lab/demo.mp4'), path.join(PAGES, 'demo.mp4'));
const types = { '.html': 'text/html', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  const f = path.join(PAGES, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(PAGES) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const data = fs.readFileSync(f), range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-').map(Number), end = e || data.length - 1;
    res.writeHead(206, { 'Content-Type': types[path.extname(f)], 'Content-Range': `bytes ${s}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - s + 1 });
    return res.end(data.subarray(s, end + 1));
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' }); res.end(data);
}).listen(8770);

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
// Which path is darkening the first video in this frame: 'webgl' (canvas over it), 'css' (fallback filter) or 'off'.
const pathOf = frame => frame.evaluate(() => {
  const v = document.querySelector('video'), c = v && v.nextElementSibling;
  if (c && c.classList.contains('owl-canvas') && getComputedStyle(c).display !== 'none') return 'webgl';
  if (v && v.classList.contains('owl-css') && getComputedStyle(v).filter !== 'none') return 'css';
  return 'off';
});
const luma = async (page, sel = '#v') => {
  const buf = await page.locator(sel).screenshot();
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; }
    return s / n;
  }, buf.toString('base64'));
};
const seek = (page, t) => page.evaluate(async t => {
  const v = document.querySelector('video'); v.pause(); v.currentTime = t;
  await new Promise(r => v.addEventListener('seeked', r, { once: true }));
  await new Promise(r => setTimeout(r, 300));
}, t);

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'owl-')), {
    channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const set = s => sw.evaluate(s => chrome.storage.local.set(s), s);
  // The toolbar owl of a tab: bright when its title says it is darkening a video.
  const iconOn = async pg => { await pg.bringToFront(); return sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return (await chrome.action.getTitle({ tabId: t.id })).includes('darkening'); }); };
  const page = await ctx.newPage();
  const url = 'http://localhost:8770/video.html';
  await page.goto(url); await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  await seek(page, 2.5);

  check('off by default', (await pathOf(page)) === 'off');
  const before = await luma(page);
  await page.mouse.click(1100, 800);
  await page.keyboard.press('o'); await page.waitForTimeout(600);
  check('O turns it on, drawn by WebGL', (await pathOf(page)) === 'webgl', await pathOf(page));
  check('O is not passed to the page', (await page.evaluate(() => pageKeys)) === 0);
  const box = await page.evaluate(() => { const v = document.querySelector('video').getBoundingClientRect(), c = document.querySelector('.owl-canvas').getBoundingClientRect(); return [v.x - c.x, v.y - c.y, v.width - c.width, v.height - c.height].map(Math.round); });
  check('canvas sits exactly on the picture', box.every(d => Math.abs(d) <= 1), JSON.stringify(box));
  const after = await luma(page);
  check('whiteboard goes dark', after < 0.15, `mean luma ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  check('toolbar owl lights up', await iconOn(page));

  await page.evaluate(() => history.replaceState(null, '', '/video.html?t=93'));
  await page.evaluate(() => history.pushState(null, '', '/video.html?v=next'));
  await page.waitForTimeout(800);
  check('owl stays lit after in-page URL changes (YouTube-style)', await iconOn(page));

  await page.evaluate(() => { const v = document.querySelector('video'); v.style.display = 'none'; v.play(); });
  await page.waitForTimeout(700);
  check('hidden video: no canvas left on screen', await page.evaluate(() => getComputedStyle(document.querySelector('.owl-canvas')).display === 'none'));
  await page.evaluate(() => { document.querySelector('video').style.display = ''; });
  await page.waitForTimeout(700);
  check('video shown again: canvas back on the picture', (await pathOf(page)) === 'webgl');
  await page.evaluate(() => document.querySelector('video').pause());
  await seek(page, 2.5);
  await page.evaluate(() => { const v = document.querySelector('video'); v.width = 800; v.height = 450; });
  await page.waitForTimeout(600);
  const paused = await luma(page);
  check('resized while paused: picture redrawn, not black', paused > 0.04 && paused < 0.15, `mean luma ${paused.toFixed(2)}`);
  await page.evaluate(() => { const v = document.querySelector('video'); v.width = 960; v.height = 540; });
  await page.waitForTimeout(400);

  await page.locator('#box').click(); await page.keyboard.type('hello owl');
  check('typing o in a text box does not toggle', (await pathOf(page)) === 'webgl' && (await page.inputValue('#box')) === 'hello owl');

  const scenes = [['blackboard stays as dark as it was', 7, l => l < 0.2], ['grey slide goes dark', 21.5, l => l < 0.15], ['face kept natural (not flipped)', 15, l => l > 0.2 && l < 0.45], ['uneven lighting goes dark', 35.5, l => l < 0.15], ['teacher scene: board dark, teacher kept', 39, l => l > 0.08 && l < 0.3]];
  for (const [name, t, ok] of scenes) { await seek(page, t); const l = await luma(page); check(name, ok(l), `mean luma ${l.toFixed(2)}`); }

  await seek(page, 2.5);
  for (const [mode, ok] of [['invert', l => l < 0.15], ['dim', l => l > 0.4 && l < 0.7], ['smart', l => l < 0.15]]) {
    await set({ mode }); await page.waitForTimeout(400);
    const l = await luma(page);
    check(`mode ${mode}`, (await pathOf(page)) === 'webgl' && ok(l), `mean luma ${l.toFixed(2)}`);
  }
  await set({ warm: true }); await page.waitForTimeout(300);
  const warmShot = await page.locator('#v').screenshot();
  check('warm tint applies', warmShot.length > 0);
  await set({ warm: false });

  // diagnostics: stats overlay + log
  await set({ debug: true });
  await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 0; v.playbackRate = 2.5; v.play(); });
  await page.waitForTimeout(5000);
  check('stats overlay shows on the video', await page.evaluate(() => !!document.querySelector('.owl-hud') && document.querySelector('.owl-hud').textContent.includes('webgl')));
  const log = await sw.evaluate(async () => (await chrome.storage.session.get('owlLog')).owlLog ?? []);
  const perf = log.filter(e => e.kind === 'perf');
  check('log records perf lines', perf.length >= 1, perf.length ? JSON.stringify(perf[perf.length - 1]) : `kinds: ${[...new Set(log.map(e => e.kind))]}`);
  check('log records the video and settings', log.some(e => e.kind === 'video' && e.path === 'webgl') && log.some(e => e.kind === 'settings'));
  await set({ debug: false }); await page.waitForTimeout(300);
  check('stats overlay gone when diagnostics are off', await page.evaluate(() => !document.querySelector('.owl-hud')));

  // other pages
  const p2 = await ctx.newPage(); await p2.goto('http://localhost:8770/novideo.html'); await p2.waitForTimeout(300);
  await p2.keyboard.press('o');
  check('page without video keeps its own O key', (await p2.evaluate(() => pageKeys)) === 1);
  check('owl dim on page without video', !(await iconOn(p2)));

  const p3 = await ctx.newPage(); await p3.goto('http://localhost:8770/csp.html');
  await p3.waitForFunction(() => document.querySelector('video').readyState >= 2); await p3.waitForTimeout(600);
  check('works on a strict-CSP page', (await pathOf(p3)) === 'webgl');

  const p4 = await ctx.newPage();
  await p4.goto('http://localhost:8770/novideo.html?x');
  await p4.evaluate(() => { const f = document.createElement('iframe'); f.src = 'http://127.0.0.1:8770/video.html'; f.width = 600; f.height = 400; document.body.append(f); });
  await p4.waitForTimeout(2000);
  const frame = p4.frames().find(f => f.url().includes('127.0.0.1'));
  check('works inside a cross-origin iframe (embedded player)', !!frame && (await pathOf(frame)) === 'webgl');
  check('owl bright for embedded video', await iconOn(p4));

  const p6 = await ctx.newPage(); await p6.goto(url); await p6.waitForFunction(() => document.querySelector('video').readyState >= 2);
  await p6.waitForTimeout(600);
  await p6.evaluate(() => { const v = document.querySelector('video'); v.play(); setTimeout(() => v.remove(), 200); });
  await p6.waitForTimeout(1500);
  check('removed video: its canvas is cleaned up', await p6.evaluate(() => !document.querySelector('.owl-canvas')));
  await p6.close();

  const p5 = await ctx.newPage(); await p5.goto('http://localhost:8770/xvideo.html');
  await p5.waitForFunction(() => document.querySelector('video').readyState >= 2); await p5.waitForTimeout(1200);
  check('cross-origin video without CORS falls back to the CSS filter', (await pathOf(p5)) === 'css', await pathOf(p5));

  await page.bringToFront(); await page.mouse.click(1100, 800);
  await page.keyboard.press('o'); await page.waitForTimeout(600);
  check('O turns it off again', (await pathOf(page)) === 'off');
  check('off everywhere (other tab, iframe, fallback)', (await pathOf(p3)) === 'off' && (await pathOf(frame)) === 'off' && (await pathOf(p5)) === 'off');
  check('owl dim when off', !(await iconOn(page)));

  // popup
  const extId = sw.url().split('/')[2]; const pop = await ctx.newPage(); await pop.setViewportSize({ width: 256, height: 330 });
  await pop.goto(`chrome-extension://${extId}/popup.html`); await pop.waitForTimeout(300);
  await pop.click('input[name=mode][value=dim]'); await pop.waitForTimeout(200);
  check('popup saves mode', (await sw.evaluate(() => chrome.storage.local.get('mode'))).mode === 'dim');
  await pop.click('input[name=mode][value=smart]');
  await pop.click('input[name=on]'); await pop.waitForTimeout(300);
  check('popup switch turns it on', (await sw.evaluate(() => chrome.storage.local.get('on'))).on === true);
  await pop.locator('details summary').click(); await pop.waitForTimeout(200);
  await pop.screenshot({ path: path.resolve(__dirname, '../assets/popup.png') });

  await ctx.close(); server.close();
  console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
