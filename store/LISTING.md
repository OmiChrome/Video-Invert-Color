# Store listing text (copy-paste)

**Name**
Midnight Owl: Dark Mode for Lectures

**Summary / short description** (under 250 characters)
Watch whiteboard lectures in a dark room. Bright boards turn dark, while faces, photos and diagram colours stay natural. Press O on any video to turn it on or off.

**Description**
Midnight Owl makes lecture videos comfortable to watch at night, in a dark room.

• Whiteboards, grey slides and unevenly lit boards turn dark, and the writing turns light.
• Ink and diagram colours keep their hue: red stays red, blue stays blue.
• Faces, photos, icons, boxes and illustrated scenes keep their look, so the teacher still looks human.
• Blackboards and dark slides stay dark, so you never get a white flash, even at 2.5× speed.

How to use: press O on any page with a video (Alt+O works too). The owl icon lights up while it is working and turns grey when it is not.
On Android (Firefox): open the menu → Extensions → Midnight Owl, and flip the switch.

Three modes: Smart (default), Invert and Dim. Also a warm tint for less blue light and a text brightness slider.

Fast: every frame is processed on your GPU (WebGL), so there is no lag even at 2.5× speed. About 70 KB, no tracking, no data collected.

Free and open source (MIT): https://github.com/OmiChrome/Video-Invert-Color

**Search terms** (Edge, up to 7)
dark mode, video, lecture, whiteboard, night mode, invert, youtube

**Category**
Edge: Accessibility · Firefox: Appearance, Photos Music & Videos

**Privacy**
Collects no personal data. Sends nothing anywhere. Uses `storage` only to remember your settings.

**Notes for reviewers**
No build step and no minified code; the zip is the plain source from the repo's `extension/` folder.
To test: open any YouTube video of a whiteboard lecture and press O (or use the toolbar popup).
The content script runs on all sites so the O key and the video filter work on any site and inside embedded players.

**Images** (in the `store/` folder)
- Logo 300×300: `logo-300.png`
- Screenshots 1280×800: `screenshot-1-whiteboard.png`, `screenshot-2-faces.png`, `screenshot-3-popup.png`
- Small promo tile 440×280 (Edge, optional): `promo-440x280.png`
