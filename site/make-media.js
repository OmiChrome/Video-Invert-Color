// Renders the site's demo GIFs with the real engine, from our own synthetic lecture (research/make_demo.py,
// rendered without scene labels). Hero: a wipe that moves across the frame; others: original | Midnight Owl.
// Usage: node site/make-media.js   (needs Python with Pillow, ffmpeg and Playwright)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'media');
const clean = path.join(os.tmpdir(), 'midnight-owl-demo-clean.mp4');
execFileSync('python3', [path.join(ROOT, 'research/make_demo.py'), clean, '--no-labels'], { stdio: 'ignore' });
const files = { '/demo.mp4': clean, '/engine.js': path.join(ROOT, 'extension/engine.js') };
const server = http.createServer((req, res) => {
  const f = files[req.url];
  if (f) { res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'video/mp4' }); return res.end(fs.readFileSync(f)); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><script src="/engine.js"></script><video id="v" muted playsinline></video>
<script>fetch('/demo.mp4').then(r => r.blob()).then(b => { document.getElementById('v').src = URL.createObjectURL(b); });</script>`);
}).listen(8792);

// name, start, end (video seconds), video seconds per GIF frame, GIF fps, mode (split | side)
const CLIPS = [
  ['hero', 0.5, 5.0, 1 / 12, 12, 'wipe'],
  ['whiteboard', 0.0, 5.0, 1 / 10, 10, 'side'],
  ['faces', 37.0, 41.0, 1 / 10, 10, 'side'],
  ['fast-cuts', 23.0, 27.0, 2.5 / 10, 10, 'side'],     // 2.5× speed
  ['grey-boards', 34.0, 37.0, 1 / 10, 10, 'side'],
];

(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8792/'); await p.waitForFunction(() => document.getElementById('v').readyState >= 2);
  for (const [name, t0, t1, step, fps, layout] of CLIPS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
    let i = 0;
    for (let t = t0; t < t1 - 1e-6; t += step) {
      const png = await p.evaluate(async ([t, layout, t0, t1]) => {
        const v = document.getElementById('v');
        v.currentTime = t; await new Promise(r => v.addEventListener('seeked', r, { once: true }));
        const W = 960, H = 540;
        const gc = window.gc ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
        const e = window.eng ??= new OwlGL(gc); e.set({ mode: 'smart', cap: 0.8 }); e.render(v);
        const wipe = layout === 'wipe';
        const out = Object.assign(document.createElement('canvas'), { width: W, height: wipe ? H : H / 2 });
        const x = out.getContext('2d');
        if (wipe) {   // original on the left of a divider that sweeps across, Midnight Owl on the right
          const k = (t - t0) / (t1 - t0), cut = Math.round(W * (0.5 - 0.36 * Math.cos(2 * Math.PI * k)));
          x.drawImage(v, 0, 0, W, H); x.drawImage(gc, cut, 0, W - cut, H, cut, 0, W - cut, H);
          x.fillStyle = '#ffc845'; x.fillRect(cut - 1, 0, 3, H);
        } else {      // side by side, half size
          x.drawImage(v, 0, 0, W / 2, H / 2); x.drawImage(gc, W / 2, 0, W / 2, H / 2);
        }
        return out.toDataURL('image/png').split(',')[1];
      }, [t, layout, t0, t1]);
      fs.writeFileSync(path.join(dir, `f${String(i++).padStart(4, '0')}.png`), Buffer.from(png, 'base64'));
    }
    const gif = path.join(OUT, name + '.gif'), w = layout === 'wipe' ? 800 : 720;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'),
      '-vf', `scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', gif]);
    console.log(`${name}.gif  ${i} frames  ${(fs.statSync(gif).size / 1024).toFixed(0)} KB`);
  }
  await b.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
