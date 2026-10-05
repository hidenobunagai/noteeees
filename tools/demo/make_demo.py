"""Render the README demo (docs/demo.mp4 + docs/demo.gif).

    bun tools/demo/capture.ts     # seed sample notes + capture the real Moments webview
    uv run --no-project --with pillow --with pygments python tools/demo/make_demo.py

Every panel frame is a real screenshot of the Moments webview (panel markup and
webview JS/CSS straight from src/moments/panel.ts + webview/, feed written by the
extension's own appendMoment/collectMomentsFeed, live typing + tag click driven
through Playwright). The only synthetic frames are the title/outro cards and the
editor scene, which shows the real moments/2026-10-05.md file on disk.

The webview is 420x860 CSS px, captured at DPR 3. Each scene crops a 262.5 CSS
px tall slice of it and scales it to the full 1600x1000 canvas, so body text is
~48px in the canvas (~24px in the 800px GIF). Scenes keep one fixed crop (their
"camera"), and camera moves interpolate the crop, so crossfades stay
camera-consistent. capture.ts writes tools/demo/shots/shots.json with the
element boxes the crops below are derived from.
"""

import json
import os
from pathlib import Path

from PIL import Image, ImageDraw

import demo_kit as k

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DEMO_REPO", HERE.parents[1]))
OUT = Path(os.environ.get("DEMO_OUT", ROOT / "docs"))
SHOTS = HERE / "shots"
NOTES = HERE / ".notes"  # seed.ts NOTES_DIR
META = json.loads((SHOTS / "shots.json").read_text())
BOXES = META["boxes"]
TEXT = META["text"]
DPR = META["deviceScaleFactor"]  # PNG pixels per CSS pixel
VW, VH = META["viewport"]  # 420 x 860

# Visible slice of the webview, in CSS px, scaled to the whole canvas
VIS_H = k.H * VW / k.W  # 262.5
HALF = VIS_H / 2  # crop centre must stay in [HALF, VH - HALF]

CAP_FEED = "Moments — capture a thought in one keystroke (Cmd+Shift+M)"
CAP_SAVE = "Enter to save. That's it."
CAP_TAG = "Click a #tag to filter the feed"
CAP_MD = "Just Markdown files — yours, searchable via MCP"


# ---------------------------------------------------------------- cameras

def pngs(name: str) -> list[str]:
    """PNG file names of one capture step, in capture order."""
    return [s["png"] for s in META["shots"] if s["name"] == name]


def crop(png: str, cy: float) -> Image.Image:
    """The webview slice centred on CSS y=cy, scaled to the full canvas."""
    if not HALF <= cy <= VH - HALF:
        raise ValueError(f"crop centre {cy} out of range")
    img = Image.open(SHOTS / png).convert("RGB")
    top = (cy - HALF) * DPR
    return img.crop((0, round(top), img.width, round(top + VIS_H * DPR))).resize(
        (k.W, k.H), Image.LANCZOS
    )


def at(css_x: float, css_y: float, cy: float) -> tuple[float, float]:
    """CSS point -> canvas point inside the crop centred on cy."""
    return css_x / VW * k.W, (css_y - (cy - HALF)) / VIS_H * k.H


def span(top: float, bottom: float) -> float:
    """Crop centre framing [top, bottom] with equal margins; warns when too tall."""
    if bottom - top > VIS_H:
        print(f"  ! scene spans {bottom - top:.0f} CSS px > {VIS_H} visible")
    return min(max((top + bottom) / 2, HALF), VH - HALF)


# Fixed crops, derived from the element boxes the capture recorded
CY_TOP = HALF  # topbar + composer + today's date marker
CY_LABELS = span(BOXES["timeline"]["y"] - 20, BOXES["labelOlder"]["y"] + 13 + 65)
CY_INPUT = BOXES["input"]["y"] - 2 + HALF  # composer + first entry (typing / tag click)
CY_RESULT = span(BOXES["resultLabelToday"]["y"] - 10, BOXES["resultLabelOlder"]["y"] + 13 + 65)
print(f"crops: labels cy={CY_LABELS:.0f} input cy={CY_INPUT:.0f} result cy={CY_RESULT:.0f}")


def pan_crops(png: str, a: float, b: float, secs: float, cap: str = ""):
    """Camera move between two crops of the same screenshot (caption stays put)."""
    n = max(1, int(secs * k.FPS))
    for i in range(n):
        cy = a + (b - a) * k.ease((i + 1) / n)
        yield k.caption(crop(png, cy), cap, 1.0 if cap else 0.0)


def hold_cap(img: Image.Image, secs: float, cap: str) -> object:
    """Still frame with a caption that is already fully visible (no re-fade)."""
    for _ in range(int(secs * k.FPS)):
        yield k.caption(img, cap, 1.0)


def card(title: str, sub: str, sub2: str) -> Image.Image:
    """Title card with a readable (large) third line."""
    img = Image.new("RGB", (k.W, k.H), k.BG)
    d = ImageDraw.Draw(img)
    d.text((k.W / 2, k.H / 2 - 70), title, font=k.TITLE, fill=k.FG, anchor="mm")
    d.text((k.W / 2, k.H / 2 + 30), sub, font=k.font("ui", 42), fill=k.ACCENT, anchor="mm")
    d.text((k.W / 2, k.H / 2 + 120), sub2, font=k.font("ui", 44), fill=(178, 186, 204), anchor="mm")
    return img


def frames():
    feed = pngs("feed-top")[0]
    added = pngs("added")[0]
    filtered = pngs("filtered")[0]
    typed = pngs("type")  # one PNG per prefix of TEXT, incl. the empty composer
    if len(typed) != len(TEXT) + 1:
        raise SystemExit(f"{len(typed)} typing frames for {len(TEXT)} chars")

    # 1. title card
    intro = card("Noteeees", "Plain-markdown notes + a quick-capture feed", "VS Code extension")
    yield from k.hold(intro, 2.2)

    # 2. the feed: top of the panel, then a camera move down to the sticky date
    #    markers (today's and yesterday's, framed by one fixed crop)
    yield from k.fade(intro, crop(feed, CY_TOP), 0.5)
    yield from k.hold(crop(feed, CY_TOP), 1.4, CAP_FEED)
    yield from pan_crops(feed, CY_TOP, CY_LABELS, 0.8, CAP_FEED)
    yield from hold_cap(crop(feed, CY_LABELS), 1.2, CAP_FEED)

    # 3. composer: move up to the input, type, Enter, the entry appears
    yield from pan_crops(feed, CY_LABELS, CY_INPUT, 0.7, CAP_SAVE)
    for png in typed:
        frame = crop(png, CY_INPUT)
        for _ in range(2):  # 15 characters/second at 30fps
            yield k.caption(frame, CAP_SAVE, 1.0)
    yield from k.fade(crop(typed[-1], CY_INPUT), crop(added, CY_INPUT), 0.4)
    yield from k.hold(crop(added, CY_INPUT), 1.4, CAP_SAVE)

    # 4. pointer to the new entry's #work tag, click, feed filtered
    img_added = crop(added, CY_INPUT)
    start = (k.W * 0.18, k.H * 0.30)
    tag = BOXES["tag"]
    target = at(tag["x"] + tag["width"] / 2, tag["y"] + tag["height"] / 2, CY_INPUT)
    yield from k.glide(img_added, 0.8, start, target, CAP_TAG)
    yield from k.click(img_added, 0.4, target, CAP_TAG)
    yield from k.fade(img_added, crop(filtered, CY_INPUT), 0.35)
    yield from hold_cap(crop(filtered, CY_INPUT), 0.9, CAP_TAG)
    # camera moves down on the filtered feed: the #idea entry is gone, so both
    # date markers fit in one view
    yield from pan_crops(filtered, CY_INPUT, CY_RESULT, 0.7, CAP_TAG)
    yield from hold_cap(crop(filtered, CY_RESULT), 1.4, CAP_TAG)

    # 5. the file the extension just wrote, in a VS Code-style editor
    src = (NOTES / "moments" / "2026-10-05.md").read_text()
    rows = k.highlight(src, "markdown")
    longest = max(sum(len(text) for text, _, _ in row) for row in rows)
    ed = k.editor(rows, title="moments/2026-10-05.md — Noteeees", tab="2026-10-05.md")
    x1 = k.code_xy(0, 0)[0] + longest * k.MONO.getlength("M")
    ed_cam = k.fit(k.MARGIN, k.code_xy(0, 0)[1] - 14, x1, k.code_xy(0, len(rows) - 1)[1] + k.LH + 8)
    print(f"editor: {len(rows)} lines, zoom {ed_cam[2]:.2f} -> {24 * ed_cam[2]:.0f}px code")
    yield from k.fade(crop(filtered, CY_RESULT), k.camera(ed, *ed_cam), 0.5)
    yield from k.hold(ed, 2.4, CAP_MD, ed_cam)

    # 6. outro
    outro = card("Noteeees", "github.com/hidenobunagai/noteeees", "VS Marketplace · Open VSX")
    yield from k.fade(k.camera(ed, *ed_cam), outro, 0.6)
    yield from k.hold(outro, 2.4)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    k.encode(frames(), OUT / "demo.mp4", OUT / "demo.gif")
