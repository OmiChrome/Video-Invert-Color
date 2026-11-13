// End-to-end test of the extension in Chromium. Usage: node test/run.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../extension'), PAGES = path.join(__dirname, 'pages');
if (!fs.existsSync(path.join(PAGES, 'demo.mp4'))) fs.copyFileSync(path.resolve(__dirname, '../research/lab/demo.mp4'), path.join(PAGES, 'demo.mp4'));
const types = { '.html': 'text/html', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  const f = path.join(PAGES, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(PAGES) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const data = fs.readFileSync(f), range = req.headers.range;
  if (range) { const [s, e] = range.replace('bytes=', '').split('-').map(Number); const end = e || data.length - 1;
    res.writeHead(206, { 'Content-Type': types[path.extname(f)], 'Content-Range': `bytes ${s}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - s + 1 }); return res.end(data.subarray(s, end + 1)); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' }); res.end(data);
}).listen(8770);

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const filterOf = (frame) => frame.evaluate(() => getComputedStyle(document.querySelector('video')).filter);
const luma = async (page, sel = '#v') => {
  const buf = await page.locator(sel).screenshot();
  return page.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; } return s / n; }, buf.toString('base64'));
};
const seek = (page, t) => page.evaluate(async t => { const v = document.querySelector('video'); v.pause(); v.currentTime = t;
  await new Promise(r => v.addEventListener('seeked', r, { once: true })); await new Promise(r => setTimeout(r, 200)); }, t);

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'owl-')), {
    channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  // The toolbar icon for the active tab: bright when its title says it is darkening a video.
  const iconState = async (pg) => { await pg.bringToFront(); return sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return (await chrome.action.getTitle({ tabId: t.id })).includes('darkening'); }); };
  const page = await ctx.newPage();
  const url = 'http://localhost:8770/video.html';
  await page.goto(url); await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  await seek(page, 2.5);

  check('off by default: no filter', (await filterOf(page)) === 'none');
  const before = await luma(page);
  await page.mouse.click(1100, 800);
  await page.keyboard.press('o'); await page.waitForTimeout(300);
  check('O turns it on', (await filterOf(page)).includes('owl-smart'), await filterOf(page));
  check('O is not passed to the page', (await page.evaluate(() => pageKeys)) === 0);
  const after = await luma(page);
  check('whiteboard goes dark', after < 0.15, `mean luma ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  check('toolbar icon is bright', await iconState(page));

  await page.locator('#box').click(); await page.keyboard.type('hello owl');
  check('typing o in a text box does not toggle', (await filterOf(page)).includes('owl-smart') && (await page.inputValue('#box')) === 'hello owl');

  await seek(page, 7); const bb = await luma(page);
  check('blackboard stays dark', bb < 0.12, `mean luma ${bb.toFixed(2)}`);
  await seek(page, 21.5); const gs = await luma(page);
  check('grey slide goes dark', gs < 0.15, `mean luma ${gs.toFixed(2)}`);
  await seek(page, 15); const face = await luma(page);
  check('face is dimmed, not flipped (stays mid-dark)', face > 0.12 && face < 0.3, `mean luma ${face.toFixed(2)}`);

  for (const mode of ['invert', 'dim', 'smart']) {
    await sw.evaluate(m => chrome.storage.local.set({ mode: m }), mode); await page.waitForTimeout(200);
    check(`mode ${mode} applies`, (await filterOf(page)).includes(`owl-${mode}`));
  }
  await sw.evaluate(() => chrome.storage.local.set({ warm: true })); await page.waitForTimeout(200);
  check('warm tint chains', (await filterOf(page)).includes('owl-warm'));
  await sw.evaluate(() => chrome.storage.local.set({ warm: false }));

  // other tabs and frames
  const p2 = await ctx.newPage(); await p2.goto('http://localhost:8770/novideo.html'); await p2.waitForTimeout(300);
  await p2.keyboard.press('o');
  check('page without video keeps its own O key', (await p2.evaluate(() => pageKeys)) === 1);
  check('toolbar icon dim on page without video', !(await iconState(p2)));

  const p3 = await ctx.newPage(); await p3.goto('http://localhost:8770/csp.html');
  await p3.waitForFunction(() => document.querySelector('video').readyState >= 2); await p3.waitForTimeout(300);
  check('works on a strict-CSP page', (await filterOf(p3)).includes('owl-smart'), await filterOf(p3));

  const p4 = await ctx.newPage();
  await p4.goto('http://localhost:8770/novideo.html?x'); await p4.evaluate(() => { const f = document.createElement('iframe'); f.src = 'http://127.0.0.1:8770/video.html'; f.width = 600; f.height = 400; document.body.append(f); });
  await p4.waitForTimeout(1500);
  const frame = p4.frames().find(f => f.url().includes('127.0.0.1'));
  check('works inside a cross-origin iframe (embedded player)', !!frame && (await filterOf(frame)).includes('owl-smart'));
  check('toolbar icon bright for embedded video', await iconState(p4));

  await page.bringToFront(); await page.mouse.click(1100, 800);
  await page.keyboard.press('o'); await page.waitForTimeout(300);
  check('O turns it off again', (await filterOf(page)) === 'none');
  check('off everywhere (other tab, iframe)', (await filterOf(p3)) === 'none' && (await filterOf(frame)) === 'none');
  check('toolbar icon dim when off', !(await iconState(page)));

  // popup renders
  const extId = sw.url().split('/')[2]; const pop = await ctx.newPage(); await pop.setViewportSize({ width: 268, height: 230 });
  await pop.goto(`chrome-extension://${extId}/popup.html`); await pop.waitForTimeout(300);
  await pop.click('label:has([value=dim])'); await pop.waitForTimeout(200);
  check('popup saves mode', (await sw.evaluate(() => chrome.storage.local.get('mode'))).mode === 'dim');
  await pop.click('label:has([value=smart])'); await pop.click('#on'); await pop.waitForTimeout(300);
  await pop.screenshot({ path: path.resolve(__dirname, '../assets/popup.png') });
  check('popup switch turns it on', (await sw.evaluate(() => chrome.storage.local.get('on'))).on === true);

  await ctx.close(); server.close();
  console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
