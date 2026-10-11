"""Render a terminal-style GIF from the captured output of scripts/demo.ts.
The text is the real program output, only the typing/pacing is simulated.
Usage: python3 scripts/render_gif.py scratch/gif/demo.txt docs/demo.gif
"""
import subprocess, sys, shutil, os, re
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
lines = open(src).read().rstrip("\n").split("\n")

FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 18)
W, H, PAD, LH = 980, 0, 24, 26
BG, FG, DIM = (22, 22, 30), (205, 214, 244), (127, 132, 156)
GREEN, RED, BLUE, YELLOW = (166, 227, 161), (243, 139, 168), (137, 180, 250), (249, 226, 175)

def color(line):
    if line.startswith("=="): return BLUE
    if "REFUSED" in line: return RED
    if line.endswith("accepted"): return GREEN
    if "both edits survived" in line: return GREEN
    if line.startswith("A base"): return YELLOW
    return FG

# Group lines into steps so each section appears together, with a pause after each.
steps, cur = [], []
for l in lines:
    if l.startswith("==") and cur:
        steps.append(cur); cur = []
    cur.append(l)
if cur: steps.append(cur)

visible_rows = 30
H = PAD * 2 + LH * (visible_rows + 1)
os.makedirs("scratch/gif/frames", exist_ok=True)
for f in os.listdir("scratch/gif/frames"):
    os.remove(os.path.join("scratch/gif/frames", f))

shown, frames = [("$ node scripts/demo.ts", FG), ("", FG)], []
def frame(extra=None, hold=1):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, 34), fill=(30, 30, 46))
    for i, c in enumerate([(243, 139, 168), (249, 226, 175), (166, 227, 161)]):
        d.ellipse((14 + i * 22, 11, 26 + i * 22, 23), fill=c)
    d.text((W // 2 - 90, 8), "mozak: two agents, one graph", font=FONT, fill=DIM)
    rows = shown + ([extra] if extra else [])
    rows = rows[-visible_rows:]
    y = 34 + PAD
    for text, col in rows:
        d.text((PAD, y), text, font=FONT, fill=col)
        y += LH
    frames.append((img, hold))

frame(hold=8)
for step in steps:
    for l in step:
        if l.strip() == "":
            shown.append(("", FG)); continue
        # type the heading line fast, reveal others whole
        shown.append((l, color(l)))
        frame(hold=3 if l.startswith("==") else 2)
    hold = 14 if any("REFUSED" in l for l in step) else 8
    frames[-1] = (frames[-1][0], hold)
frame(hold=30)

# write frames at 10 fps, repeating by hold count
n = 0
for img, hold in frames:
    for _ in range(hold):
        img.save(f"scratch/gif/frames/f{n:04d}.png"); n += 1
os.makedirs(os.path.dirname(out), exist_ok=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "10", "-i", "scratch/gif/frames/f%04d.png",
                "-vf", "split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse", out], check=True)
print(f"{n} frames, {n/10:.1f}s, {os.path.getsize(out)/1024:.0f} KB -> {out}")
