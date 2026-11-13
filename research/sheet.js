// Renders research/lab/comparison.jpg: every scene of demo.mp4 through every mode, in Chromium.
// Usage: node research/sheet.js   (needs ffmpeg and Playwright)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const LAB = path.join(__dirname, 'lab'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
const SCENES = [['Whiteboard', 2.5], ['Blackboard', 7], ['Slide + face', 11], ['Face', 15], ['Dark slide', 18.5], ['Grey slide', 21.5], ['Photo', 32.5], ['Uneven light', 35.5], ['Teacher', 39]];
const MODES = [['Original', 'none'], ['Classic invert', 'invert(1)'], ['Invert', 'url(#owl-invert)'], ['Smart', 'url(#owl-smart)'], ['Dim', 'url(#owl-dim)']];
for (const [, t] of SCENES) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(t), '-i', path.join(LAB, 'demo.mp4'), '-frames:v', '1', path.join(tmp, `${t}.png`)]);
const cell = 'width:300px;height:169px;display:block';
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0c10;font:600 15px system-ui;color:#e6e7ea;padding:8px">
<script>${fs.readFileSync(path.join(LAB, 'filters.js'), 'utf8')}; document.body.insertAdjacentHTML('afterbegin', owlFilterSvg(0.8));</script>
<div style="display:grid;grid-template-columns:repeat(${MODES.length},300px);gap:4px">
${MODES.map(([n]) => `<div style="padding:4px 2px;color:${n === 'Smart' ? '#ffc845' : '#8a8f99'}">${n}</div>`).join('')}
${SCENES.map(([, t]) => MODES.map(([, f]) => `<img src="${t}.png" style="${cell};filter:${f}">`).join('')).join('')}</div>`;
fs.writeFileSync(path.join(tmp, 'sheet.html'), html);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1540, height: 600 } });
  await p.goto('file://' + path.join(tmp, 'sheet.html')); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(LAB, 'comparison.jpg'), fullPage: true, type: 'jpeg', quality: 82 });
  await b.close(); console.log('wrote research/lab/comparison.jpg');
})();
