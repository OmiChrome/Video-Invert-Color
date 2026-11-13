# Publish Midnight Owl

Everything you need is in two folders:

| Folder | What |
|---|---|
| `release/` | `midnight-owl-edge-1.0.0.zip`, `midnight-owl-firefox-1.0.0.zip` |
| `store/` | Logo, screenshots, promo tile, and all the text in `LISTING.md` |

---

## Firefox (free, ~1 day review)

1. Go to **https://addons.mozilla.org/developers/** → **Log in** (make a free Mozilla account).
2. Click **Submit a New Add-on** → choose **On this site** → **Continue**.
3. Upload **`release/midnight-owl-firefox-1.0.0.zip`**. Tick **Firefox** (desktop) → **Continue**.
4. "Do you need to submit source code?" → **No** → **Continue**.
5. Fill in from `store/LISTING.md`:
   - Name, Summary, Description
   - Categories: **Appearance** and **Photos, Music & Videos**
   - License: **MIT License**
   - "Does this add-on have a privacy policy?" → **No**
   - Notes to reviewer: copy *Notes for reviewers*
6. Click **Submit Version**.
7. Open **Edit Product Page** → **Images** → set the icon to `store/logo-300.png` and add the 3 screenshots.

You'll get an email when it's approved. Your page will be `https://addons.mozilla.org/firefox/addon/<your-slug>/`.

---

## Microsoft Edge (free, up to 7 business days review)

1. Go to **https://partner.microsoft.com/dashboard/microsoftedge/overview** → sign in with a Microsoft account → register as an **Individual** developer (free).
2. Click **Create new extension**.
3. **Packages** → upload **`release/midnight-owl-edge-1.0.0.zip`** → **Continue**.
4. **Availability** → Visibility **Public**, Markets **all** → **Save**.
5. **Properties**:
   - Category: **Accessibility**
   - "Does your extension access, collect or transmit personal information?" → **No** (then no privacy policy is needed)
   - Website (optional): `https://github.com/OmiChrome/Video-Invert-Color`
   - **Save**
6. **Store listings** → **English** → fill in from `store/LISTING.md`:
   - Description
   - Extension logo: `store/logo-300.png`
   - Small promotional tile: `store/promo-440x280.png`
   - Screenshots: the 3 `store/screenshot-*.png`
   - Short description and search terms
   - **Save**
7. **Submission options** → paste *Notes for reviewers* into **Notes for certification** → **Save**.
8. Click **Publish**.

You'll get an email when it's approved. Your page will be `https://microsoftedge.microsoft.com/addons/detail/<id>`.

---

## After both are approved

Send me the two store links and I'll switch the README badges from "coming soon" to live version badges.

## Updating later

1. Bump `"version"` in `extension/manifest.json` (for example `1.0.1`).
2. Run `python3 build.py` → new zips in `dist/`.
3. Firefox: your add-on → **Upload New Version**. Edge: your extension → **Packages** → **Replace** → **Publish**.

## Chrome (later)

The Chrome Web Store charges a one-time $5 developer fee. When you're ready: https://chrome.google.com/webstore/devconsole → upload `dist/midnight-owl-chrome-*.zip` and use the same text and images.
