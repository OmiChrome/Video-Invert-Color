# Publishing

`python3 build.py` makes two zips in `dist/`. Bump `version` in `extension/manifest.json` before every upload.

| Store | Zip | Where | Fee | Review |
|---|---|---|---|---|
| Chrome Web Store | `night-owl-chrome-*.zip` | https://chrome.google.com/webstore/devconsole | $5 once | ~1–3 days |
| Firefox Add-ons | `night-owl-firefox-*.zip` | https://addons.mozilla.org/developers/ | free | ~1 day |
| Edge Add-ons | `night-owl-chrome-*.zip` | https://partner.microsoft.com/dashboard/microsoftedge | free | ~3–7 days |
| Opera Add-ons | `night-owl-chrome-*.zip` | https://addons.opera.com/developer/ | free | ~1–2 weeks |

## Listing text (copy-paste)

- **Name:** Night Owl: Dark Lectures
- **Short:** Watch whiteboard lectures in a dark room. Bright boards turn dark; faces, photos and colours stay natural. Press O.
- **Category:** Accessibility (Chrome, Edge) · Appearance (Firefox)
- **Screenshots:** `assets/before-after.jpg`, `assets/popup.png` (Chrome wants 1280×800 or 640×400; crop or pad)
- **Icon:** `extension/icons/on-128.png`

## Privacy answers

- Collects no data. Sends nothing anywhere. No remote code.
- `storage`: remembers on/off, mode, warm tint and text brightness.
- Content script on all sites: needed so <kbd>O</kbd> and the filter work on any video, including embedded YouTube players.

## After approval

Replace the "coming soon" badges in `README.md` with live ones:

```
https://img.shields.io/chrome-web-store/v/<CHROME_ID>?style=for-the-badge&logo=googlechrome&logoColor=white
https://img.shields.io/amo/v/<AMO_SLUG>?style=for-the-badge&logo=firefoxbrowser&logoColor=white
```

Pushing a tag like `v1.0.0` builds both zips and attaches them to a GitHub release (`.github/workflows/release.yml`).
