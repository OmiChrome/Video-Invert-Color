# Research: night viewing of lecture videos

Everything here is research. Nothing is the extension yet.

| File | What it is |
|---|---|
| `lab/index.html` | **Midnight Owl Lab**: original and the real extension engine side by side, every mode, plus a "What flips" mask view. Serve the folder (`cd research/lab && python3 -m http.server`) and open it. |
| `lab/engine.js` | Copy of `extension/engine.js`. |
| `make_demo.py` | Generates `lab/demo.mp4`, a 41 s synthetic lecture with 11 scenes (`--no-labels` for the website GIFs). |
| `sheet.js` | Renders `lab/comparison.jpg`: original · classic invert · v1.0 SVG filter · v1.1 engine. |
| `bench.js` | Performance benchmark: extension off vs. CSS/SVG path vs. WebGL path on any video file. |

## Round 4 (current): the WebGL engine (v1.1)

The SVG filter of v1.0 ran ~25 full-screen filter steps per frame, and users saw lag above 2×. v1.1 draws each frame
with WebGL2 into a canvas laid exactly over the video. Every decision is made on a 240×135 grid; the full-size pass
reads only the frame and one decision value per pixel. Details are in the header of `extension/engine.js`.

What changed in the picture, tuned on 12 frames of a real 1080p Sam O'Nella video (not committed, it is copyrighted)
plus the synthetic demo:

- Only **paper** (colourless: a tint under ~0.03, and not dark) and the **lines drawn on it** flip. A line is ink with
  paper on both sides, horizontally or vertically, at 16 or 32 px.
- **Solid fills stay**: grey boxes, icons, badges, hair, bars, pies, photos. White glyphs walled in by a solid fill stay white.
- **Illustrated scenes stay natural.** If under ~50 % of the frame is paper, only large areas of pure white (caption
  panels, slides) may flip, never light-grey skies, columns, glows, sheep or white faces.
- **Grey and unevenly lit boards** are divided by their local brightness before flipping, so they go evenly dark.
- No more auras: the board region is grown one block so flips reach the edges of paper areas; box corners stay clean.

Benchmark (`bench.js`, 1080p VP9 at 2.5×, 1280×720 player, headless Chromium with software rendering, so absolute
numbers are far slower than on any real GPU; compare rows):

| | page frame rate | note |
|---|---|---|
| extension off | 60 fps | |
| v1.0 CSS/SVG filter | 3 fps | the whole page crawls: the lag users saw |
| v1.1 WebGL engine | 15 fps | 5× faster in software. Most of the remaining cost is the software copy of each 1080p frame, which a real GPU does on-chip |

In software GL, Smart costs 64 ms vs 34 ms for a plain copy per frame (it was 138 ms before the decisions moved to the grid).

Robustness fixes from an independent code review (all covered by `test/run.js`, 46 checks):

- GPU context loss falls back to the CSS filter and retries WebGL; it can never leave a white box.
- Videos with the browser's own controls or captions, transformed videos and DRM videos use the CSS filter, so nothing is hidden or black.
- The overlay follows scrolling, is clipped by overflow containers, and lines up under page zoom and scaled parents.
- After an extension update or reload, the old content script switches itself off and its leftovers are removed.
- O only reacts to real key presses, by the letter on the key (Dvorak, Colemak), never while typing; videos inside shadow DOM are found too.
- Known limits: a speech bubble or caption panel in an illustrated scene can flip only partly at its edges, and
  a light sky right under such a panel can get a faint dark smudge.

> Rounds 1–3 below are kept for history.

## Algorithms tested

| | Name | How | JS at runtime |
|---|---|---|---|
| A | Classic invert | CSS `invert(1)`, what Video Enhancer does | none |
| B | Hue-safe invert | one `feColorMatrix`: flips luma, keeps chroma, caps white at 80% | none |
| C | Adaptive hue-safe | B, re-tuned per scene from a 64×36 sample (median luma, hysteresis, bright-area guard) | sampler |
| D | Smart board | SVG filter graph: find bright + colourless "paper", blur to get local paper fraction, invert only board regions, dim everything else | none |
| E | Smart board + scene check | D, but the board map is a 32×18 grid computed in JS, with a whole-frame gate | sampler + feImage |
| F | Dim only | gamma/brightness, no inversion | none |

## Results (headless Chromium, `lab/results.json`)

Mean output luminance per scene (0 black, 1 white), and the peak during rapid cuts at 2.5×:

| | whiteboard | blackboard | slide+face | face | dark slide | grey slide | photo | **peak, cuts @2.5×** |
|---|---|---|---|---|---|---|---|---|
| A | 0.11 | 0.80 | 0.18 | 0.50 (alien) | 0.86 | 0.43 | 0.60 | 0.86 |
| B | 0.14 | 0.65 | 0.19 | 0.43 (alien) | 0.70 | 0.38 | 0.51 | 0.70 |
| C | 0.11 | 0.16 | 0.16 | 0.14 (inverted face) | 0.11 | **0.09** | 0.32 | 0.67 |
| **D** | 0.12 | **0.08** | **0.14** | **0.22 (natural)** | **0.06** | 0.29 | **0.20** | **0.29** |
| E | 0.12 | 0.08 | 0.14 | 0.20 (natural) | 0.06 | 0.29 | 0.20 | 0.52 |
| F | 0.48 | 0.07 | 0.43 | 0.24 | 0.05 | 0.26 | 0.18 | 0.48 |

What this shows:
- **D is the only one that passes every scene, and the only one with no flash at 2.5×.** It runs entirely in the GPU filter on every frame, so there is no lag to catch up after a cut.
- **Every JavaScript-driven method (C, E) flashes on fast cuts.** The sampler is always at least one decision behind. youtube-darkview has the same weakness, made worse by a 3-frame "turn off" delay.
- **D's known weaknesses:**
  - Grey (not white) slides are only dimmed (0.29), not inverted.
  - Big solid-colour blocks in diagrams show a soft dark-to-light gradient where the board mask fades.
- The sampler costs about 2 ms per sample in headless Chromium (64×36 readback). That's cheap, but it's the latency, not the cost, that makes C and E flash.

## Prior art (summary of what exists)

- **plurid/youtube-darkview**
  - A canvas overlay that re-draws every frame with a per-pixel JavaScript loop.
  - Probe: 160×90; a pixel counts as paper when luma ≥ 204 and chroma ≤ 41. It inverts when paper covers ≥ 28–45% of the frame.
  - Inside 20 px blocks it inverts only paper and neutral ink. Coloured pixels are left alone.
  - Face/photo protection: mid-tone, high-variance blocks grouped into protected boxes.
  - It reads YouTube's storyboard thumbnails to know ahead which parts of the video are dark.
  - Our D uses the same idea, but as an SVG filter on the GPU, with no per-frame JS.
- **Dark Reader** never darkens video. In its filter mode it inverts the page and re-inverts `img`/`video` back. Its matrix "invertNHue" is the same family as our hue-safe matrix.
- **Whiteboard to Blackboard (Firefox), Video Enhancer, Video Color Inverter, Turn Off the Lights**: static CSS `invert()` / `hue-rotate()` presets with no adaptivity.
- **Chrome Auto Dark Mode**
  - Colours are inverted in CIELAB lightness: `L' = 110 − L`.
  - Images go through a small classifier and are inverted only if they look like icons, never photos.
- **Apple Smart Invert** excludes whole elements (images, video) instead of analysing pixels.
- **Zhang & He, "Whiteboard scanning and image enhancement" (2007)** estimate the whiteboard background per cell from the brightest 25% of pixels. That idea could fix D's grey-slide weakness.

Sources: https://github.com/plurid/youtube-darkview · https://github.com/darkreader/darkreader · https://addons.mozilla.org/firefox/addon/whiteboard-to-blackboard-smart/ · https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/ · https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/Digital-Signal-Processing.pdf · https://bugzilla.mozilla.org/show_bug.cgi?id=1906212 (Firefox GPU SVG filters, feImage not included) · https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
