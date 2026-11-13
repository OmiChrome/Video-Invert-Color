#!/usr/bin/env python3
"""Build store packages from ./extension.

  python3 build.py   ->  dist/midnight-owl-edge-<v>.zip     (Microsoft Edge Add-ons)
                        dist/midnight-owl-firefox-<v>.zip  (Firefox Add-ons)
                        dist/midnight-owl-chrome-<v>.zip   (Chrome Web Store, for later)
"""
import json, shutil, zipfile
from pathlib import Path

ROOT = Path(__file__).parent
SRC, DIST = ROOT / "extension", ROOT / "dist"
GECKO_ID = "midnight-owl@omichrome.github.io"

def build(target):
    manifest = json.loads((SRC / "manifest.json").read_text())
    if target == "firefox":
        manifest["background"] = {"scripts": ["background.js"]}
        manifest["browser_specific_settings"] = {"gecko": {
            "id": GECKO_ID, "strict_min_version": "142.0",
            "data_collection_permissions": {"required": ["none"]}}}
    out = DIST / target
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(SRC, out, ignore=shutil.ignore_patterns(".*", "manifest.json"))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    zpath = DIST / f"midnight-owl-{target}-{manifest['version']}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(out).as_posix())
    print(zpath.relative_to(ROOT))

if __name__ == "__main__":
    for t in ("edge", "firefox", "chrome"):
        build(t)
