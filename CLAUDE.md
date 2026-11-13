# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Midnight Owl**: an MV3 browser extension (Chrome/Edge/Opera, Firefox incl. Firefox for Android) that darkens lecture videos (YouTube first) for watching in a dark room. Press **O** (or **Alt+O**) on a page with a video.

The owner's priorities, in order:

1. Text must stay clearly readable: no half-flipped letters, no halos, crisp light text on near-black.
2. It must run smoothly on a low-end integrated GPU (the owner uses an Intel HD with 128 MB). Keep per-pixel work minimal.
3. No bright flash at scene cuts, even at 2.5× playback.
4. Never invert faces, photos or illustrated scenes.

## Commands

```bash
python3 build.py                                        # dist/midnight-owl-{edge,firefox,chrome}.zip (+ unpacked dist/<target>/)
npx -y web-ext@10.8.0 lint --source-dir dist/firefox    # must stay at 0 errors / 0 warnings
node test/run.js                                        # end-to-end suite: Chromium with the extension loaded (~3 min)
node research/bench.js <video> [start] [speed] [secs]   # extension off vs CSS path vs WebGL path
python3 research/make_demo.py research/lab/demo.mp4 [--no-labels]   # synthetic test lecture
node research/sheet.js      # research/lab/comparison.jpg
node site/make-media.js     # site/media/*.gif, rendered with the real engine
node store/make-images.js   # store screenshots / logo / promo tile
cd research/lab && python3 -m http.server               # the lab page (original vs engine, side by side)
```

- There is no package.json. Scripts expect `require('playwright')` with Chromium available.
- `test/run.js` is one sequential script with no per-test filter. It serves `test/pages/` on :8770, using `localhost` and `127.0.0.1` for cross-origin cases.
- The tests launch a persistent context with `channel: 'chromium'` and `--load-extension`.
- The tests copy `research/lab/demo.mp4` into `test/pages/` (gitignored).

## Architecture

Content scripts load in the order `filters.js` → `engine.js` → `content.js` into one shared scope, in every frame (`all_frames`, `match_about_blank`). Globals are prefixed `owl` / `Owl`.

**`extension/engine.js`**

- **`OwlGL`** is the WebGL2 pipeline.
  - All analysis passes run on a 135-row grid (240×135 for 16:9, ≈8 px cells at 1080p) and end in a small decision texture.
  - The only full-resolution pass reads the video frame plus that texture. The file header lists the passes and why they exist.
  - Mode `'mask'` renders the decision maps for debugging.
  - The low-end GPU budget lives in the full-size pass. Put new logic on the grid, not there.
- **`OwlVideo`** manages one `<video>`.
  - It inserts a canvas as the video's next sibling.
  - Placement uses `getBoundingClientRect` deltas divided by the measured scale, so it works with page zoom and scaled parents. It clips to overflow ancestors and re-places on resize, mutation and scroll.
  - It draws on `requestVideoFrameCallback`, capped at about 30 fps unless the `smooth` setting is on.
  - It falls back to an inline CSS filter (class `owl-css`, SVG filters from `filters.js`) for the reasons in `cssReason()`:
    - cross-origin video (`SecurityError` on upload)
    - DRM (`mediaKeys`)
    - native fullscreen
    - native controls or showing `<track>` captions
    - a transformed video
    - context loss (retried)
    - more than 6 contexts
    - `engine: 'css'`

**`extension/content.js`**

- Settings come from `storage.local`. Keys are in `OWL_DEFAULTS`: `on, mode, warm, cap, debug, smooth, engine`.
- The O key handler:
  - accepts only `isTrusted` key presses;
  - matches by `e.key`, with an `e.code` fallback for non-Latin layouts;
  - does nothing while the user is typing or when the page has no video.
- Videos are found through media events on the document and on open shadow roots, plus a MutationObserver.
- It holds a runtime port named `owl-active` while it darkens a video.
- When the extension context is invalidated it tears itself down, and on startup it removes leftovers from an older copy.

**`extension/background.js`**

- The toolbar icon is bright for a tab while that tab holds `owl-active` ports. There are no URL heuristics, because YouTube's in-page navigation must not affect it.
- It handles the Alt+O command.
- It keeps the diagnostics log in `storage.session` (at most 5000 entries).
- Firefox for Android has no commands API and no action icon, so those calls are optional-chained.

**`extension/popup.*`** is a plain HTML form bound to `storage.local`. Diagnostics toggles `debug` (on-video stats and the perf log) and `smooth`, and saves the log as JSON.

## Build and release

- `extension/manifest.json` is the Chrome/Edge source of truth. `build.py` rewrites it for Firefox: `background.scripts`, gecko id `midnight-owl@omichrome.github.io`, `data_collection_permissions`, `strict_min_version` 142.
- Zip names have no version, so `releases/latest/download/<name>` links keep working.
- `.github/workflows/release.yml` runs on every push to `main`. It builds, lints and runs the tests.
  - If the manifest version has no GitHub release yet, it creates tag `v<version>`, with notes from `docs/releases/v<version>.md`.
  - So a release is: bump the version, add the notes file, push `main`. Tags can't be pushed from Claude's environment.
- `.github/workflows/pages.yml` deploys `site/`. The repo's Pages source must be set to GitHub Actions.
- Store submission steps and listing text are in `docs/PUBLISHING.md` and `store/LISTING.md`.

## Research and testing notes

- `research/lab/engine.js` is a copy of `extension/engine.js` for the lab page. Re-copy it after engine changes; the lab is also published as a claude.ai artifact.
- **Visual tuning loop:**
  - Render frames through `OwlGL` in headless Chromium.
  - Serve the page over http; `file://` images taint WebGL.
  - Compare original/processed crops at native resolution and check the `'mask'` view.
- This container has no GPU (software GL), so performance numbers here are only relative. The on-video stats and the saved log give real numbers on the owner's machine.
- YouTube shows automated browsers a bot check. Test on local pages and videos instead.
- **Sam O'Nella footage:** the owner has permission for research use. It may live under `research/` with attribution, but must not be used in `site/`, `store/` or README media.
- A service worker can't message itself. In tests, clear the log with `sw.evaluate(() => { log = []; return chrome.storage.session.set({ owlLog: [] }); })`.

## Commits

- Author commits as `Omi <108952834+OmiChrome@users.noreply.github.com>` (`git commit --author=...`).
- Keep the session's `Co-Authored-By` trailer.
- Never put session URLs in commit messages; the repo is public.
