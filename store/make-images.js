// Renders the store images into store/. Usage: node store/make-images.js  (needs ffmpeg and Playwright)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), OUT = __dirname, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
const frame = t => { const f = path.join(tmp, `${t}.png`); execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(t), '-i', path.join(ROOT, 'research/lab/demo.mp4'), '-frames:v', '1', f]); return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); };
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const owl = fs.readFileSync(path.join(ROOT, 'assets/owl-on.svg'), 'utf8');
const filters = fs.readFileSync(path.join(ROOT, 'extension/filters.js'), 'utf8');
const base = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0b0c10;color:#e6e7ea;font-family:system-ui,"Segoe UI",sans-serif}
  .h{font-size:44px;font-weight:700;letter-spacing:-.01em} .s{font-size:22px;color:#9aa0aa}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:14px} img.f{width:100%;display:block;border-radius:10px}
  .lab{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#8a8f99;margin:8px 2px 0} .lab.a{color:#ffc845}
  </style><script>${filters};document.addEventListener('DOMContentLoaded',()=>document.body.insertAdjacentHTML('afterbegin',owlFilterSvg(0.8)))</script>`;
// One big split view: left half original, right half Midnight Owl.
const shot = (title, sub, a) => `${base}<body style="width:1280px;height:800px;box-sizing:border-box;padding:36px 56px;display:grid;gap:22px;align-content:start">
  <div style="display:flex;align-items:center;gap:18px"><div style="width:60px;height:60px">${owl}</div><div><div class="h">${title}</div><div class="s">${sub}</div></div></div>
  <div style="position:relative;width:1168px;height:657px;border-radius:12px;overflow:hidden">
    <img src="${a}" style="position:absolute;inset:0;width:100%;height:100%">
    <img src="${a}" style="position:absolute;inset:0;width:100%;height:100%;filter:url(#owl-smart);clip-path:inset(0 0 0 50%)">
    <div style="position:absolute;top:0;bottom:0;left:50%;width:3px;margin-left:-1px;background:#ffc845"></div>
    <div style="position:absolute;top:14px;left:16px;background:#0b0c10cc;padding:4px 10px;border-radius:6px;font-size:16px">Before</div>
    <div style="position:absolute;top:14px;right:16px;background:#0b0c10cc;padding:4px 10px;border-radius:6px;font-size:16px;color:#ffc845">Midnight Owl</div>
  </div></body>`;
const pages = {
  'screenshot-1-whiteboard.png': [1280, 800, shot('Whiteboards turn dark', 'Ink and diagrams keep their colours', frame(2.5))],
  'screenshot-2-faces.png': [1280, 800, shot('Faces stay natural', 'Only the board flips, never the teacher', frame(39.6))],
  'screenshot-3-popup.png': [1280, 800, `${base}<body style="width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:90px">
     <img src="${b64(path.join(ROOT, 'assets/popup.png'))}" style="width:400px;border-radius:14px;box-shadow:0 20px 60px #000">
     <div style="display:grid;gap:22px"><div class="h">Press <span style="color:#ffc845">O</span></div><div class="s" style="font-size:26px">on any video to turn it on or off.<br>Alt + O works too.</div>
     <div class="s" style="font-size:26px">The owl lights up while it works.</div>
     <div style="display:flex;gap:26px;align-items:center"><img src="${b64(path.join(ROOT, 'extension/icons/on-128.png'))}" width="96"><img src="${b64(path.join(ROOT, 'extension/icons/off-128.png'))}" width="96"></div></div></body>`],
  'promo-440x280.png': [440, 280, `${base}<body style="width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box;background:radial-gradient(circle at 25% 40%,#262a45,#0b0c10 70%)">
     <div style="width:130px;height:130px;flex:none">${owl}</div><div><div style="font-size:34px;font-weight:700;line-height:1.05">Midnight<br>Owl</div><div class="s" style="font-size:16px;margin-top:8px">Dark mode for lecture videos</div></div></body>`],
  'logo-300.png': [300, 300, `<!doctype html><body style="margin:0;background:transparent"><div style="width:300px;height:300px">${owl}</div>`],
};
(async () => {
  const b = await chromium.launch();
  for (const [name, [w, h, html]] of Object.entries(pages)) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const f = path.join(tmp, name + '.html'); fs.writeFileSync(f, html); await p.goto('file://' + f); await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(OUT, name), omitBackground: name.startsWith('logo') }); await p.close(); console.log('store/' + name);
  }
  await b.close();
})();
