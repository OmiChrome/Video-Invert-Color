<div align="center">

<img src="assets/owl.png" width="104" alt="Midnight Owl">

# Midnight Owl

**Watch lectures at midnight.**<br>
Press <kbd>O</kbd>. Whiteboards turn dark. Faces, photos and colours stay as they are.

[![Download](https://img.shields.io/github/v/release/OmiChrome/Video-Invert-Color?style=for-the-badge&label=download&color=ffc845&labelColor=1c1c1e&logo=github)](https://github.com/OmiChrome/Video-Invert-Color/releases/latest)
[![Website](https://img.shields.io/badge/website-live-ffc845?style=for-the-badge&labelColor=1c1c1e&logo=githubpages&logoColor=white)](https://omichrome.github.io/Video-Invert-Color/)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-coming_soon-FF7139?style=for-the-badge&labelColor=1c1c1e&logo=firefoxbrowser&logoColor=white)](#install)
[![Edge Add-ons](https://img.shields.io/badge/Edge_Add--ons-coming_soon-0078D7?style=for-the-badge&labelColor=1c1c1e&logo=microsoftedge&logoColor=white)](#install)

![Android](https://img.shields.io/badge/Android-Firefox-3DDC84?style=flat-square&logo=android&logoColor=white)
![WebGL2](https://img.shields.io/badge/engine-WebGL2-555?style=flat-square)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-555?style=flat-square)
![Size](https://img.shields.io/badge/size-~80_KB-555?style=flat-square)
![No tracking](https://img.shields.io/badge/data_collected-none-2ea44f?style=flat-square)
![License: MIT](https://img.shields.io/badge/license-MIT-555?style=flat-square)

<img src="site/media/hero.gif" width="760" alt="A whiteboard lecture: left of the moving line is the original, right of it Midnight Owl">

</div>

## Use

| | |
|---|---|
| <kbd>O</kbd> | On / off, on any page with a video |
| <kbd>Alt</kbd> + <kbd>O</kbd> | Same, from anywhere in the browser |
| <img src="extension/icons/on-32.png" width="20"> | Bright while it is darkening a video, grey otherwise |

<img src="assets/popup.png" width="230" alt="Popup">

| Mode | |
|---|---|
| **Smart** (default) | Paper and the lines on it flip. Everything else stays. |
| **Invert** | The whole video flips, colours kept |
| **Dim** | Darker, nothing flips |

## Install

**[Download the latest release](https://github.com/OmiChrome/Video-Invert-Color/releases/latest)**. Store listings for Firefox and Edge are on the way.

- **Edge / Chrome:** unzip, open `edge://extensions` or `chrome://extensions`, turn on Developer mode, **Load unpacked**
- **Firefox:** `about:debugging` → This Firefox → **Load Temporary Add-on** → pick the zip

## Develop

```bash
python3 build.py       # zips in dist/
node test/run.js       # end-to-end tests in Chromium
```

[How it works](research/README.md) · [Publishing](docs/PUBLISHING.md) · [Website source](site/)

## License

[MIT](LICENSE) © OmiChrome. Use it, change it, fork it; just keep the credit.
