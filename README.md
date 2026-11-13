<div align="center">

<img src="assets/owl.png" width="112" alt="Night Owl">

# Night Owl

**Watch whiteboard lectures in a dark room.**
Bright boards turn dark. Faces, photos and colours stay natural.

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-coming_soon-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#install)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-coming_soon-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white)](#install)
[![Edge Add-ons](https://img.shields.io/badge/Edge_Add--ons-coming_soon-0078D7?style=for-the-badge&logo=microsoftedge&logoColor=white)](#install)
[![Opera Add-ons](https://img.shields.io/badge/Opera_Add--ons-coming_soon-FF1B2D?style=for-the-badge&logo=opera&logoColor=white)](#install)

![Manifest V3](https://img.shields.io/badge/Manifest-V3-555?style=flat-square)
![Size](https://img.shields.io/badge/size-~40_KB-555?style=flat-square)
![No tracking](https://img.shields.io/badge/data_collected-none-2ea44f?style=flat-square)
![JS per frame](https://img.shields.io/badge/JS_per_frame-0-2ea44f?style=flat-square)

<img src="assets/before-after.jpg" width="720" alt="Before and after: whiteboard, teacher, grey slide, blackboard">

</div>

## Use

| Key | |
|---|---|
| <kbd>O</kbd> | On / off, on any page with a video |
| <kbd>Alt</kbd> + <kbd>O</kbd> | Backup shortcut (change it in `chrome://extensions/shortcuts`) |

The toolbar owl **lights up** when it is darkening a video and goes **grey** when it isn't.

<img src="assets/popup.png" width="240" alt="Popup">

| Mode | |
|---|---|
| **Smart** (default) | Only bright boards flip to dark |
| **Invert** | Whole video flips, colours kept |
| **Dim** | Darker, nothing flips |

## Install

Store links arrive once the listings are approved. Until then, load it yourself:

1. Download or clone this repo
2. Open `chrome://extensions`, turn on **Developer mode**
3. Click **Load unpacked** and pick the `extension` folder

Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → `dist/firefox/manifest.json` (after `python3 build.py`).

## Develop

```bash
python3 build.py      # store zips in dist/
node test/run.js      # end-to-end tests in Chromium
```

Try every mode side by side in the lab: `research/lab/` · How it works: [`research/`](research/README.md) · Publishing: [`docs/PUBLISHING.md`](docs/PUBLISHING.md)
