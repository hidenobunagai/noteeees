"""Render the README demo (docs/demo.mp4 + docs/demo.gif).

    bun tools/demo/capture.ts     # seed sample notes + capture the real Moments webview
    uv run --no-project --with pillow --with pygments python tools/demo/make_demo.py

Part 1 — Notes: drawn VS Code-style scenes (the Notes UI is native VS Code:
tree view + editor), but every label, count, filename and file body comes from
tools/demo/.notes/notes-data.json, which seed.ts produces by running the real
extension code: NotesTreeProvider (buildSidebarTagGroups / buildTagSummary /
orderPinnedNotes / limitSidebarNotes), BacklinksProvider (collectBacklinks /
parseWikiLinks), resolveFilename/resolveUniqueFilePath for file names, and the
default snippet from snippets/markdown.json for the newly created note.

Part 2 — Moments: every panel frame is a real screenshot of the Moments
webview (panel markup and webview JS/CSS straight from src/moments/panel.ts +
webview/, feed written by the extension's own appendMoment/collectMomentsFeed,
live typing + tag click driven through Playwright). The title/outro cards are
synthetic; the editor frame shows the real moments/2026-10-05.md file on disk.

The webview is 420x860 CSS px, captured at DPR 3. Each Moments scene crops a
262.5 CSS px tall slice of it and scales it to the full 1600x1000 canvas, so
body text is ~48px in the canvas (~24px in the 800px GIF). Scenes keep one
fixed crop (their "camera"), and camera moves interpolate the crop, so
crossfades stay camera-consistent. capture.ts writes tools/demo/shots/shots.json
with the element boxes the crops below are derived from.

The drawn Notes scenes use the full canvas at a fixed camera (WIDE) and ~30px
fonts, so sidebar and editor text stay >= ~14px in the 800px GIF.
"""

import json
import os
import re
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
DATA = json.loads((NOTES / "notes-data.json").read_text())  # seed.ts sidebar/backlink dump

# Visible slice of the webview, in CSS px, scaled to the whole canvas
VIS_H = k.H * VW / k.W  # 262.5
HALF = VIS_H / 2  # crop centre must stay in [HALF, VH - HALF]

CAP_NOTES = "Notes — plain Markdown files in a folder you choose"
CAP_NEW = "Cmd+Shift+N: title in, real .md file out"
CAP_WIKI = "[[Wiki-links]], backlinks and #tags — no database"
CAP_TAGS = "Notes grouped by tag, ready in the sidebar"
CAP_FEED = "Moments — capture a thought in one keystroke (Cmd+Shift+M)"
CAP_SAVE = "Enter to save. That's it."
CAP_TAG = "Click a #tag to filter the feed"
CAP_MD = "Just Markdown files — yours, searchable via MCP"

# ---------------------------------------------------------------- drawn Notes scenes
#
# Layout of the drawn window (canvas px): sidebar 110..670, editor 670..1490,
# content band 114..860 (caption pill lives below 890, so it never covers UI).

SB_X0, SB_X1 = k.MARGIN, k.MARGIN + 560
ED_X1 = k.W - k.MARGIN
Y_TOP, Y_BOT = 114, 70 + k.WIN_H
TAB_H = 44
TREE_TOP = Y_TOP + 56  # below the EXPLORER header
CODE_X, NUM_X = SB_X1 + 74, SB_X1 + 56
LH_N = 38  # note line height at MONO 30
SB_BG, ED_BG, TAB_BG = (24, 24, 24), (31, 31, 31), (25, 26, 30)
BORDER = (40, 44, 54)
FG_DIM = (157, 157, 157)
MD_BLUE = (81, 154, 186)
LINK_C, TAG_C, HEAD_C, FM_KEY = (78, 170, 252), (229, 192, 123), (86, 156, 214), (157, 197, 253)

UI28 = k.font("ui", 28)
UI30 = k.font("ui", 30)
UI34 = k.font("ui", 34)
UIB30 = k.font("ui_bold", 30)
ICON_F = k.font("ui_bold", 17)
M30 = k.font("mono", 30)
M30B = k.font("mono_bold", 30)

WIKILINK_RE = re.compile(r"(\[\[[^\]]+\]\]|#[A-Za-z][\w-]*)")


def clip(text: str, font, maxw: float) -> str:
    if font.getlength(text) <= maxw:
        return text
    while text and font.getlength(text + "…") > maxw:
        text = text[:-1]
    return text + "…"


def vs_window(title: str):
    """Blank VS Code-style window: sidebar pane + editor pane + EXPLORER header."""
    img, d = k.window("")
    d.text((k.W / 2, 92), title, font=UI28, fill=FG_DIM, anchor="mm")
    d.rectangle((SB_X0, Y_TOP, SB_X1, Y_BOT), fill=SB_BG)
    d.rectangle((SB_X1, Y_TOP, ED_X1, Y_BOT), fill=ED_BG)
    d.line((SB_X1, Y_TOP, SB_X1, Y_BOT), fill=BORDER, width=2)
    d.text((SB_X0 + 20, Y_TOP + 28), "EXPLORER", font=UI28, fill=FG_DIM, anchor="lm")
    return img, d


def chevron(d: ImageDraw.ImageDraw, x: float, y: float, open_: bool) -> None:
    if open_:
        pts = [(x - 9, y - 5), (x + 9, y - 5), (x, y + 9)]
    else:
        pts = [(x - 5, y - 9), (x + 9, y), (x - 5, y + 9)]
    d.polygon(pts, fill=(180, 185, 195))


def note_icon(d: ImageDraw.ImageDraw, x: float, y: float, color) -> None:
    d.rounded_rectangle((x, y - 14, x + 20, y + 14), 4, outline=color, width=2)
    d.text((x + 10, y), "M", font=ICON_F, fill=color, anchor="mm")


def row(level: int, label: str, h: int, **kw) -> dict:
    return {"level": level, "label": label, "h": h, **kw}


def draw_tree(d: ImageDraw.ImageDraw, rows: list[dict]) -> None:
    """Sidebar tree rows: {level, label, h, chev?, icon?, desc?, bold?}."""
    y = TREE_TOP
    for r in rows:
        cy = y + r["h"] // 2
        x = SB_X0 + 18 + r["level"] * 30
        if r.get("chev") is not None:
            chevron(d, x + 9, cy, r["chev"])
            x += 30
        if r.get("icon") == "note":
            note_icon(d, x, cy, MD_BLUE)
            x += 34
        elif r.get("icon") == "file":
            note_icon(d, x, cy, FG_DIM)
            x += 34
        elif r.get("icon") == "arrow":
            d.text((x, cy), "→", font=UI28, fill=FG_DIM, anchor="lm")
            x += 32
        font = UIB30 if r.get("bold") else UI30
        d.text((x, cy), r["label"], font=font, fill=r.get("color", k.FG), anchor="lm")
        if r.get("desc"):
            lx = x + font.getlength(r["label"]) + 14
            maxw = SB_X1 - 18 - lx
            if maxw >= 90:
                d.text((lx, cy), clip(r["desc"], UI28, maxw), font=UI28, fill=FG_DIM, anchor="lm")
        y += r["h"]
    if y > Y_BOT:
        print(f"  ! sidebar tree spans to {y:.0f} > {Y_BOT}")


def row_sections() -> dict:
    return {s["kind"]: s for s in DATA["sections"]}


def rows_notes() -> list[dict]:
    """Scene 1: Pinned + Recent expanded, Tags collapsed, Backlinks collapsed."""
    sec = row_sections()
    rows = [row(0, "Noteeees", 54, chev=True)]
    for kind in ("pinnedRoot", "recentRoot"):
        rows.append(row(1, sec[kind]["label"], 48, chev=True))
        rows += [row(2, c["label"], 46, icon="note") for c in sec[kind]["children"]]
    rows.append(row(1, sec["tagsRoot"]["label"], 48, chev=False))
    rows.append(row(0, "Backlinks", 54, chev=False))
    return rows


def rows_tags() -> list[dict]:
    """Scene 4: Tags expanded (first tag group open), Pinned/Recent collapsed."""
    sec = row_sections()
    rows = [
        row(0, "Noteeees", 54, chev=True),
        row(1, sec["pinnedRoot"]["label"], 48, chev=False),
        row(1, sec["recentRoot"]["label"], 48, chev=False),
        row(1, sec["tagsRoot"]["label"], 48, chev=True),
    ]
    for i, group in enumerate(sec["tagsRoot"]["children"]):
        rows.append(row(2, group["label"], 46, chev=i == 0, desc=group.get("description")))
        if i == 0:
            rows += [
                row(3, c["label"], 44, icon="note", desc=c.get("description"))
                for c in group.get("children", [])
            ]
    rows.append(row(0, "Backlinks", 54, chev=False))
    return rows


def rows_backlinks() -> list[dict]:
    """Scene 3: Noteeees collapsed, Backlinks view open with the real entries."""
    rows = [row(0, "Noteeees", 54, chev=False), row(0, "Backlinks", 54, chev=True)]
    for b in DATA["backlinks"]:
        rows.append(row(1, b["label"], 46, icon="file", desc=b.get("description")))
        rows += [row(2, c["label"], 44, icon="arrow") for c in b.get("children", [])]
    return rows


def note_runs(line: str) -> list:
    """Colored runs for one line of a note (front matter / headings / links / tags)."""
    if line == "---":
        return [(line, (110, 118, 135), False)]
    if re.match(r"^#{1,6} ", line):
        return [(line, HEAD_C, True)]
    m = re.match(r"^(tags|title|date):(.*)$", line)
    if m:
        return [(m[1] + ":", FM_KEY, False), (m[2], k.FG, False)]
    runs = []
    for part in WIKILINK_RE.split(line):
        if not part:
            continue
        if part.startswith("[["):
            runs.append((part, LINK_C, True))
        elif part.startswith("#"):
            runs.append((part, TAG_C, True))
        else:
            runs.append((part, k.FG, False))
    return runs


def draw_editor(
    d: ImageDraw.ImageDraw,
    src: str,
    tab: str,
    hl_rows=(),
    cursor: tuple[int, int] | None = None,
) -> None:
    d.rectangle((SB_X1, Y_TOP, ED_X1, Y_TOP + TAB_H), fill=TAB_BG)
    tw = max(260, UI30.getlength(tab) + 56)
    d.rectangle((SB_X1, Y_TOP, SB_X1 + tw, Y_TOP + TAB_H), fill=ED_BG)
    d.rectangle((SB_X1, Y_TOP, SB_X1 + tw, Y_TOP + 3), fill=(0, 120, 212))
    d.text((SB_X1 + 24, Y_TOP + TAB_H // 2), tab, font=UI30, fill=k.FG, anchor="lm")
    d.line((SB_X1, Y_TOP + TAB_H, ED_X1, Y_TOP + TAB_H), fill=BORDER, width=2)
    lines = src.rstrip("\n").split("\n")
    for r, line in enumerate(lines):
        y = Y_TOP + TAB_H + 20 + r * LH_N
        if r in hl_rows:
            d.rectangle((SB_X1 + 2, y - 6, ED_X1 - 2, y + LH_N - 6), fill=k.HL_ROW)
        d.text((NUM_X, y), str(r + 1), font=M30, fill=(110, 118, 135), anchor="ra")
        x = CODE_X
        for text, color, bold in note_runs(line):
            font = M30B if bold else M30
            d.text((x, y), text, font=font, fill=color)
            x += font.getlength(text)
    if cursor:
        col, r = cursor
        x = CODE_X + col * M30.getlength("M")
        y = Y_TOP + TAB_H + 20 + r * LH_N
        d.rectangle((x, y - 2, x + 3, y + LH_N - 8), fill=k.FG)
    if Y_TOP + TAB_H + 20 + len(lines) * LH_N > Y_BOT:
        print(f"  ! editor spans past {Y_BOT}: {len(lines)} lines")


def notes_scene(tab: str, src: str, rows: list[dict], hl_rows=(), cursor=None) -> Image.Image:
    img, d = vs_window(f"{tab} — noteeees")
    draw_tree(d, rows)
    draw_editor(d, src, tab, hl_rows, cursor)
    return img


def with_keycap(img: Image.Image) -> Image.Image:
    img = img.copy()
    d = ImageDraw.Draw(img, "RGBA")
    label = "Cmd + Shift + N"
    w = UI34.getlength(label) + 80
    # bottom of the editor pane, below the note's last line
    cx, cy = (SB_X1 + ED_X1) / 2, Y_BOT - 66
    box = (cx - w / 2, cy - 36, cx + w / 2, cy + 36)
    d.rounded_rectangle(box, 16, fill=(33, 38, 50, 255), outline=(94, 104, 124), width=3)
    d.rounded_rectangle((box[0] + 7, box[1] + 7, box[2] - 7, box[1] + 18), 6, fill=(66, 74, 94, 255))
    d.text((cx, cy + 4), label, font=UI34, fill=(240, 242, 246, 255), anchor="mm")
    return img


PROMPT = "Enter note title (use / for subfolders)"  # i18n key noteTitlePrompt


def with_input(img: Image.Image, typed: str) -> Image.Image:
    """VS Code-style quick input at the top of the window (real prompt as placeholder)."""
    img = img.copy()
    d = ImageDraw.Draw(img, "RGBA")
    x0, x1, y0, y1 = 260, k.W - 260, Y_TOP + 30, Y_TOP + 112
    d.rounded_rectangle((x0, y0, x1, y1), 12, fill=(31, 33, 43, 255), outline=(0, 120, 212), width=3)
    if typed:
        d.text((x0 + 26, (y0 + y1) / 2), typed, font=UI34, fill=k.FG, anchor="lm")
        cx = x0 + 26 + UI34.getlength(typed) + 4
        d.rectangle((cx, y0 + 18, cx + 3, y1 - 18), fill=k.FG)
    else:
        d.text((x0 + 26, (y0 + y1) / 2), PROMPT, font=UI30, fill=(152, 152, 152, 255), anchor="lm")
    return img


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


def fade_cap(a: Image.Image, b: Image.Image, secs: float, cap: str):
    """Crossfade that keeps the caption fully visible (within one scene)."""
    n = max(1, int(secs * k.FPS))
    for i in range(n):
        yield k.caption(Image.blend(a, b, k.ease((i + 1) / n)), cap, 1.0)


def card(title: str, sub: str, sub2: str) -> Image.Image:
    """Title card with a readable (large) third line."""
    img = Image.new("RGB", (k.W, k.H), k.BG)
    d = ImageDraw.Draw(img)
    d.text((k.W / 2, k.H / 2 - 70), title, font=k.TITLE, fill=k.FG, anchor="mm")
    if sub:
        d.text((k.W / 2, k.H / 2 + 30), sub, font=k.font("ui", 42), fill=k.ACCENT, anchor="mm")
    if sub2:
        d.text((k.W / 2, k.H / 2 + 120), sub2, font=k.font("ui", 44), fill=(178, 186, 204), anchor="mm")
    return img


def frames():
    feed = pngs("feed-top")[0]
    added = pngs("added")[0]
    filtered = pngs("filtered")[0]
    typed = pngs("type")  # one PNG per prefix of TEXT, incl. the empty composer
    if len(typed) != len(TEXT) + 1:
        raise SystemExit(f"{len(typed)} typing frames for {len(TEXT)} chars")

    # ------------------------------------------------ Notes part (drawn scenes)
    open_tab = DATA["openNote"]["relativePath"]
    open_src = DATA["openNote"]["content"]
    new_note = DATA["newNote"]
    open_lines = open_src.rstrip("\n").split("\n")
    hl_open = [
        i for i, line in enumerate(open_lines) if "[[" in line or re.search(r"#[A-Za-z]", line)
    ]

    # 1. title card
    intro = card("Noteeees", "Markdown notes + a quick-capture feed", "VS Code extension")
    yield from k.hold(intro, 2.0)

    # 2. sidebar (Pinned/Recent/Tags with real counts) + an open note
    scene1 = notes_scene(open_tab, open_src, rows_notes())
    yield from k.fade(intro, scene1, 0.5)
    yield from k.hold(scene1, 2.8, CAP_NOTES)

    # 3. Cmd+Shift+N: keycap, typed title (real prompt as placeholder), then the
    #    file the real filename rules + default snippet produced
    scene2_new = notes_scene(
        new_note["relativePath"],
        new_note["content"],
        rows_notes(),
        cursor=(
            len(new_note["content"].rstrip("\n").split("\n")[-1]),
            len(new_note["content"].rstrip("\n").split("\n")) - 1,
        ),
    )
    keyed = with_keycap(scene1)
    yield from k.fade(scene1, keyed, 0.35)
    yield from k.hold(keyed, 0.7, CAP_NEW)
    placeholder = with_input(keyed, "")
    yield from fade_cap(keyed, placeholder, 0.3, CAP_NEW)
    title = new_note["title"]
    for i in range(len(title) + 1):
        frame = k.caption(with_input(keyed, title[:i]), CAP_NEW, 1.0)
        for _ in range(2):  # ~15 characters/second at 30fps
            yield frame
    yield from fade_cap(with_input(keyed, title), scene2_new, 0.45, CAP_NEW)
    yield from hold_cap(scene2_new, 2.0, CAP_NEW)

    # 4. the open note again: wiki-link + #tag highlighted, real Backlinks tree
    scene3 = notes_scene(open_tab, open_src, rows_backlinks(), hl_rows=hl_open)
    yield from k.fade(scene2_new, scene3, 0.45)
    yield from k.hold(scene3, 4.0, CAP_WIKI)

    # 5. Tags group expanded with the real counts and notes
    scene4 = notes_scene(open_tab, open_src, rows_tags())
    yield from k.fade(scene3, scene4, 0.45)
    yield from k.hold(scene4, 3.5, CAP_TAGS)

    # ------------------------------------------------ Moments part (real shots)
    # 6. divider
    divider = card("Moments", "quick capture in one keystroke", "")
    yield from k.fade(scene4, divider, 0.5)
    yield from k.hold(divider, 1.3)

    # 7. the feed: top of the panel, then a camera move down to the sticky date
    #    markers (today's and yesterday's, framed by one fixed crop)
    yield from k.fade(divider, crop(feed, CY_TOP), 0.5)
    yield from k.hold(crop(feed, CY_TOP), 1.0, CAP_FEED)
    yield from pan_crops(feed, CY_TOP, CY_LABELS, 0.7, CAP_FEED)
    yield from hold_cap(crop(feed, CY_LABELS), 0.7, CAP_FEED)

    # 8. composer: move up to the input, type, Enter, the entry appears
    yield from pan_crops(feed, CY_LABELS, CY_INPUT, 0.6, CAP_SAVE)
    for png in typed:
        frame = crop(png, CY_INPUT)
        for _ in range(2):  # 15 characters/second at 30fps
            yield k.caption(frame, CAP_SAVE, 1.0)
    yield from k.fade(crop(typed[-1], CY_INPUT), crop(added, CY_INPUT), 0.4)
    yield from k.hold(crop(added, CY_INPUT), 1.0, CAP_SAVE)

    # 9. pointer to the new entry's #work tag, click, feed filtered
    img_added = crop(added, CY_INPUT)
    start = (k.W * 0.18, k.H * 0.30)
    tag = BOXES["tag"]
    target = at(tag["x"] + tag["width"] / 2, tag["y"] + tag["height"] / 2, CY_INPUT)
    yield from k.glide(img_added, 0.7, start, target, CAP_TAG)
    yield from k.click(img_added, 0.35, target, CAP_TAG)
    yield from k.fade(img_added, crop(filtered, CY_INPUT), 0.35)
    yield from hold_cap(crop(filtered, CY_INPUT), 0.6, CAP_TAG)
    yield from pan_crops(filtered, CY_INPUT, CY_RESULT, 0.6, CAP_TAG)
    yield from hold_cap(crop(filtered, CY_RESULT), 1.2, CAP_TAG)

    # 10. the file the extension just wrote, in a VS Code-style editor
    src = (NOTES / "moments" / "2026-10-05.md").read_text()
    rows = k.highlight(src, "markdown")
    longest = max(sum(len(text) for text, _, _ in row) for row in rows)
    ed = k.editor(rows, title="moments/2026-10-05.md — Noteeees", tab="2026-10-05.md")
    x1 = k.code_xy(0, 0)[0] + longest * k.MONO.getlength("M")
    ed_cam = k.fit(k.MARGIN, k.code_xy(0, 0)[1] - 14, x1, k.code_xy(0, len(rows) - 1)[1] + k.LH + 8)
    print(f"editor: {len(rows)} lines, zoom {ed_cam[2]:.2f} -> {24 * ed_cam[2]:.0f}px code")
    yield from k.fade(crop(filtered, CY_RESULT), k.camera(ed, *ed_cam), 0.5)
    yield from k.hold(ed, 1.8, CAP_MD, ed_cam)

    # 11. outro
    outro = card("Noteeees", "github.com/hidenobunagai/noteeees", "VS Marketplace · Open VSX")
    yield from k.fade(k.camera(ed, *ed_cam), outro, 0.6)
    yield from k.hold(outro, 2.2)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    k.encode(frames(), OUT / "demo.mp4", OUT / "demo.gif")
