// Measures every lab algorithm in headless Chromium.
// Usage: (cd research/lab && python3 -m http.server 8765 &) ; node research/measure.js
// Writes research/lab/results.json and research/shots/<algo>-<scene>.png
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const ALGOS = ['off', 'classic', 'hue', 'adapt', 'board', 'grid', 'dim'];
const SCENES = { whiteboard: 2.5, blackboard: 7, 'slide+face': 11, 'face': 15, 'dark slide': 18.5, 'grey slide': 21.5, 'fade end': 30.5, photo: 32.5 };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:8765/index.html');
  await page.waitForFunction(() => document.getElementById('v').readyState >= 3);
  const lumaOf = async (file) => page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data, ys = [];
    for (let i = 0; i < d.length; i += 16) ys.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
    ys.sort((a, b) => a - b); return { mean: ys.reduce((a, b) => a + b) / ys.length, p95: ys[Math.floor(ys.length * 0.95)] };
  }, file.toString('base64'));
  const video = page.locator('#v');
  const res = { scenes: {}, flash: {}, peak: {}, sampler: {} };
  for (const s of Object.keys(SCENES)) res.scenes[s] = {};
  for (const algo of ALGOS) {
    await page.check(`input[name=algo][value=${algo}]`);
    await page.evaluate(() => { const v = document.getElementById('v'); v.playbackRate = 2.5; });
    for (const [scene, t] of Object.entries(SCENES)) {
      // play into the scene so adaptive algorithms see real frames, then freeze
      await page.evaluate(async (t) => { const v = document.getElementById('v'); v.pause(); v.currentTime = t - 1.2;
        await new Promise(r => v.addEventListener('seeked', r, { once: true })); await v.play(); }, t);
      await page.waitForFunction((t) => document.getElementById('v').currentTime >= t, t, { polling: 'raf' });
      await page.evaluate(() => document.getElementById('v').pause());
      await page.waitForTimeout(150);
      const buf = await video.screenshot({ path: path.join(OUT, `${algo}-${scene.replace(/\W+/g, '_')}.png`) });
      res.scenes[scene][algo] = await lumaOf(buf);
    }
    // rapid cuts at 2.5x: capture continuously, record peak brightness and biggest jump
    await page.evaluate(async () => { const v = document.getElementById('v'); v.currentTime = 23; await new Promise(r => v.addEventListener('seeked', r, { once: true })); await v.play(); });
    let prev = null, jump = 0, peak = 0;
    while (await page.evaluate(() => document.getElementById('v').currentTime < 26.8)) {
      const m = await lumaOf(await video.screenshot());
      peak = Math.max(peak, m.mean); if (prev) jump = Math.max(jump, Math.abs(m.mean - prev)); prev = m.mean;
    }
    res.flash[algo] = jump; res.peak[algo] = peak;
    res.sampler[algo] = await page.locator('#stats').textContent();
    console.log(algo, 'peak', peak.toFixed(3), 'jump', jump.toFixed(3), '|', res.sampler[algo]);
  }
  fs.writeFileSync(path.join(__dirname, 'lab', 'results.json'), JSON.stringify(res, null, 1));
  for (const s of Object.keys(SCENES)) console.log(s.padEnd(12), ALGOS.map(a => `${a}:${res.scenes[s][a].mean.toFixed(2)}`).join(' '));
  await browser.close();
})();
