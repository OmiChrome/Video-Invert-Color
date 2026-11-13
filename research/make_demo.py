"""Generate a synthetic lecture test video covering the night-mode edge cases.

Usage: python3 research/make_demo.py research/lab/demo.mp4
Photos: NASA portrait of Eileen Collins (public domain) and coffee.png, both from
the scikit-image sample data set.
"""
import math, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 960, 540, 30
HERE = Path(__file__).parent / "assets-src"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
def font(n): return ImageFont.truetype(BOLD, n)
FACE = Image.open(HERE / "astronaut.png").convert("RGB")
COFFEE = Image.open(HERE / "coffee.png").convert("RGB")

WB, INK, RED, BLUE, GREEN, ORANGE = (243, 243, 238), (25, 25, 30), (205, 35, 35), (30, 70, 200), (25, 140, 60), (240, 140, 20)
BB, CHALK = (32, 40, 36), (232, 232, 222)

def write(d, lines, x, y, reveal, size=34, gap=58):
    """Progressively 'hand-write' lines: reveal in [0,1] controls how many chars show."""
    total = sum(len(t) for t, _ in lines); n = int(total * reveal)
    for i, (t, c) in enumerate(lines):
        d.text((x, y + i * gap), t[:max(0, n)], fill=c, font=font(size)); n -= len(t)

def diagram(d, x, y, colors, outline):
    for i, (h, c) in enumerate(zip([120, 70, 160, 100], colors)):
        d.rectangle((x + i * 55, y + 180 - h, x + i * 55 + 40, y + 180), fill=c)
    d.line((x - 10, y + 182, x + 230, y + 182), fill=outline, width=3)
    d.pieslice((x + 260, y + 40, x + 400, y + 180), 0, 140, fill=colors[0])
    d.pieslice((x + 260, y + 40, x + 400, y + 180), 140, 250, fill=colors[1])
    d.pieslice((x + 260, y + 40, x + 400, y + 180), 250, 360, fill=colors[2])

def whiteboard(t, reveal=1.0):
    im = Image.new("RGB", (W, H), WB); d = ImageDraw.Draw(im)
    write(d, [("Newton's 2nd law:  F = m a", INK), ("Energy:  E = m c^2", RED), ("v = u + a t", BLUE), ("note: units in SI", GREEN)], 40, 30, reveal)
    diagram(d, 500, 280, [RED, BLUE, GREEN, ORANGE], INK)
    d.ellipse((40 + 20 * math.sin(t * 3), 300, 300 + 20 * math.sin(t * 3), 500), outline=RED, width=5)
    return im

def blackboard(t, reveal=1.0):
    im = Image.new("RGB", (W, H), BB); d = ImageDraw.Draw(im)
    write(d, [("Integral:  ∫ x dx = x²/2", CHALK), ("limit  x → 0", (250, 200, 120)), ("sin x / x = 1", (150, 200, 255))], 40, 40, reveal)
    diagram(d, 500, 280, [(240, 120, 120), (140, 170, 255), (140, 220, 150), (250, 210, 120)], CHALK)
    return im

def slide_with_cam(t):
    im = whiteboard(t); cam = FACE.resize((300, 300)); im.paste(cam, (W - 320, H - 320))
    ImageDraw.Draw(im).rectangle((W - 321, H - 321, W - 19, H - 19), outline=(0, 0, 0), width=2); return im

def full_cam(t):
    z = 1.0 + 0.03 * math.sin(t)  # slow zoom so it is a 'video'
    c = FACE.resize((int(W * z), int(W * z))); y0 = int((c.height - H) * 0.15)
    return c.crop((0, y0, W, y0 + H))

def dark_slide(t):
    im = Image.new("RGB", (W, H), (18, 22, 40)); d = ImageDraw.Draw(im)
    d.text((40, 40), "Dark-theme slide", fill=(240, 240, 250), font=font(40))
    d.text((40, 110), "already dark: must NOT be inverted", fill=(255, 200, 90), font=font(28))
    diagram(d, 300, 250, [(255, 99, 99), (99, 160, 255), (99, 220, 140), (255, 200, 80)], (220, 220, 230)); return im

def gray_slide(t):
    im = Image.new("RGB", (W, H), (150, 150, 150)); d = ImageDraw.Draw(im)
    write(d, [("Mid-gray background", INK), ("red ink", RED), ("blue ink", BLUE)], 40, 40, 1.0)
    diagram(d, 500, 280, [RED, BLUE, GREEN, ORANGE], INK); return im

def photo(t):
    return COFFEE.resize((W, int(W * COFFEE.height / COFFEE.width))).crop((0, 20, W, 20 + H))

def rapid_cuts(t):
    return whiteboard(t) if int(t / 0.4) % 2 == 0 else Image.eval(full_cam(t), lambda v: int(v * 0.35))

def uneven(t):
    """Whiteboard filmed with a lamp on one side: grey, uneven corners."""
    import numpy as np
    im = np.asarray(whiteboard(t), dtype=np.float32) / 255
    yy, xx = np.mgrid[0:H, 0:W]
    light = 0.62 + 0.38 * np.exp(-(((xx - W * (0.35 + 0.05 * math.sin(t))) / (W * 0.6)) ** 2 + ((yy - H * 0.4) / (H * 0.7)) ** 2))
    return Image.fromarray((im * light[..., None] * 255).astype("uint8"))

TEACHER_MASK = None
def teacher(t):
    """Teacher standing in front of the board, moving a little."""
    global TEACHER_MASK
    from PIL import ImageFilter
    if TEACHER_MASK is None:
        m = Image.new("L", (380, 380), 0); d = ImageDraw.Draw(m)
        d.ellipse((100, 10, 280, 230), fill=255); d.ellipse((40, 150, 340, 420), fill=255)
        TEACHER_MASK = m.filter(ImageFilter.GaussianBlur(4))
    im = whiteboard(t); im.paste(FACE.resize((380, 380)), (540 + int(40 * math.sin(t * 1.5)), 160), TEACHER_MASK); return im

def fade_in(t):
    a = min(1.0, t / 3.0); return Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), whiteboard(t), a)

SEGMENTS = [  # (label, seconds, frame-fn(local_t))
    ("1 whiteboard + colour diagram", 5, lambda t: whiteboard(t, min(1, t / 3))),
    ("2 blackboard (already dark)", 4, lambda t: blackboard(t, min(1, t / 2.5))),
    ("3 slide + camera inset (face)", 4, slide_with_cam),
    ("4 full-frame camera (face)", 4, full_cam),
    ("5 dark-theme slide", 3, dark_slide),
    ("6 mid-gray slide", 3, gray_slide),
    ("7 rapid cuts white/dark", 4, rapid_cuts),
    ("8 fade black -> whiteboard", 4, fade_in),
    ("9 natural photo", 3, photo),
    ("10 uneven lighting", 3, uneven),
    ("11 teacher in front of board", 4, teacher),
]

def main(out):
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    start = 0.0; marks = []
    for label, dur, fn in SEGMENTS:
        marks.append((round(start, 2), label))
        for i in range(int(dur * FPS)):
            t = i / FPS; im = fn(t)
            ImageDraw.Draw(im).text((8, H - 22), label, fill=(255, 0, 255), font=font(14))
            p.stdin.write(im.tobytes())
        start += dur
    p.stdin.close(); p.wait()
    print("segments:", marks)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(HERE / "demo.mp4"))
