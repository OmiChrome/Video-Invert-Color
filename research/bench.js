// Performance benchmark: plays a video at a given speed with the extension off, on the old CSS/SVG filter
// path, and on the WebGL path, and reports dropped frames, page frame rate and renderer cost.
// Usage: node research/bench.js <video file> [start seconds] [speed] [seconds per run]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const [,, file, start = '90', speed = '2.5', secs = '10'] = process.argv;
const EXT = path.resolve(__dirname, '../extension');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/v')) {
    const size = fs.statSync(file).size, range = req.headers.range || 'bytes=0-';
    const [s, e] = range.replace('bytes=', '').split('-').map(Number), end = Math.min(e || size - 1, s + 8e6, size - 1);
    res.writeHead(206, { 'Content-Type': 'video/webm', 'Content-Range': `bytes ${s}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - s + 1 });
    return fs.createReadStream(file, { start: s, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><body style="margin:0;background:#000"><video id="v" src="/v" muted playsinline style="width:1280px;height:720px"></video>`);
}).listen(8791);

async function run(ctx, sw, label, settings) {
  await sw.evaluate(s => chrome.storage.local.set(s), settings);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8791/');
  await page.evaluate(async ([t, r]) => {
    const v = document.getElementById('v');
    await new Promise(ok => v.readyState >= 1 ? ok() : v.addEventListener('loadedmetadata', ok, { once: true }));
    v.currentTime = +t; await new Promise(ok => v.addEventListener('seeked', ok, { once: true }));
    v.playbackRate = +r; await v.play();
  }, [start, speed]);
  await page.waitForTimeout(1500);   // warm-up
  const result = await page.evaluate(async ms => {
    const v = document.getElementById('v'), q0 = v.getVideoPlaybackQuality();
    let raf = 0, worst = 0, last = performance.now();
    const tick = now => { raf++; worst = Math.max(worst, now - last); last = now; if (performance.now() - t0 < ms) requestAnimationFrame(tick); };
    const t0 = performance.now(); requestAnimationFrame(tick);
    await new Promise(ok => setTimeout(ok, ms));
    const q = v.getVideoPlaybackQuality(), el = (performance.now() - t0) / 1000;
    return { decoded: q.totalVideoFrames - q0.totalVideoFrames, dropped: q.droppedVideoFrames - q0.droppedVideoFrames, pageFps: +(raf / el).toFixed(1), worstFrameMs: Math.round(worst), path: document.querySelector('.owl-canvas') ? 'webgl' : v.classList.contains('owl-css') ? 'css' : 'off' };
  }, +secs * 1000);
  result.droppedPct = +(100 * result.dropped / Math.max(1, result.decoded)).toFixed(1);
  const log = await sw.evaluate(async () => (await chrome.storage.session.get('owlLog')).owlLog ?? []);
  const perf = log.filter(e => e.kind === 'perf');
  if (perf.length) result.rendererCpuMs = +(perf.reduce((a, e) => a + e.cpuMs, 0) / perf.length).toFixed(2);
  await sw.evaluate(() => { log = []; return chrome.storage.session.set({ owlLog: [] }); });   // a worker can't message itself
  await page.close();
  console.log(label.padEnd(26), JSON.stringify(result));
  return result;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-')), {
    channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  console.log(`video ${path.basename(file)} from ${start}s at ${speed}x, ${secs}s per run, player 1280x720`);
  const out = {};
  for (let round = 0; round < 2; round++) {
    out[`off#${round}`] = await run(ctx, sw, 'off', { on: false, debug: false });
    out[`css#${round}`] = await run(ctx, sw, 'old CSS/SVG filter', { on: true, mode: 'smart', engine: 'css', debug: true });
    out[`webgl#${round}`] = await run(ctx, sw, 'new WebGL engine', { on: true, mode: 'smart', engine: 'auto', debug: true });
  }
  fs.writeFileSync(path.join(os.tmpdir(), 'bench-result.json'), JSON.stringify(out, null, 1));
  await ctx.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
