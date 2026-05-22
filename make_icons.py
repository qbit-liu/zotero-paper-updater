#!/usr/bin/env python3
"""Render plugin icons.

Original design: two stacked papers (back offset behind the front, suggesting
an older version superseded by a newer one) on an indigo rounded square, with
a circular refresh badge in the top-right.

Run: python3 make_icons.py
Outputs: icon-48.png, icon-96.png, icon-128.png, icon-source.png
"""

from PIL import Image, ImageDraw

# Colors
BG          = (49, 46, 129, 255)    # indigo-900
BG_RING     = (30, 27, 75, 255)     # darker inner ring
BACK_DOC    = (147, 197, 253, 255)  # blue-300 (peeks out behind)
DOC         = (255, 255, 255, 255)
FOLD        = (203, 213, 225, 255)  # slate-300
LINE        = (148, 163, 184, 255)  # slate-400
BADGE       = (16, 185, 129, 255)   # emerald-500
BADGE_RING  = (255, 255, 255, 255)
ARROW       = (255, 255, 255, 255)

S = 1024  # base render size; downsampled with LANCZOS


def render():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Indigo rounded square with a subtle inner ring
    draw.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.17), fill=BG)
    draw.rounded_rectangle(
        (int(S * 0.025), int(S * 0.025), S - int(S * 0.025), S - int(S * 0.025)),
        radius=int(S * 0.15),
        outline=BG_RING,
        width=int(S * 0.008),
    )

    # Back paper (the "older version"), offset to the top-left so a corner
    # peeks out behind the front sheet.
    draw.rounded_rectangle(
        (int(S * 0.14), int(S * 0.18),
         int(S * 0.66), int(S * 0.78)),
        radius=int(S * 0.04),
        fill=BACK_DOC,
    )

    # Front paper (the "newer version") with a folded top-right corner.
    fold = int(S * 0.12)
    dl, dt, dr, db = int(S * 0.24), int(S * 0.28), int(S * 0.80), int(S * 0.88)
    draw.polygon(
        [(dl, dt), (dr - fold, dt), (dr, dt + fold), (dr, db), (dl, db)],
        fill=DOC,
    )
    draw.polygon(
        [(dr - fold, dt), (dr, dt + fold), (dr - fold, dt + fold)],
        fill=FOLD,
    )

    # Text lines on the front paper — three rows, decreasing width.
    line_x = dl + int(S * 0.06)
    line_y0 = dt + int(S * 0.18)
    line_dy = int(S * 0.085)
    line_h = int(S * 0.035)
    for i, w_frac in enumerate([0.32, 0.40, 0.24]):
        y = line_y0 + i * line_dy
        draw.rounded_rectangle(
            (line_x, y, line_x + int(S * w_frac), y + line_h),
            radius=line_h // 2,
            fill=LINE,
        )

    # Refresh badge in the top-right: emerald disc with a white ring, and a
    # circular arrow (3/4 arc + arrowhead) on top.
    bx, by, br = int(S * 0.78), int(S * 0.22), int(S * 0.16)
    ring = int(S * 0.022)
    draw.ellipse(
        (bx - br - ring, by - br - ring, bx + br + ring, by + br + ring),
        fill=BADGE_RING,
    )
    draw.ellipse((bx - br, by - br, bx + br, by + br), fill=BADGE)

    # Bold up-arrow inside the badge — reads as "update / new version" at any size.
    a = int(br * 1.25)
    head_h = int(a * 0.45)
    head_w = int(a * 0.95)
    stem_w = int(a * 0.34)
    half = a // 2
    arrow_poly = [
        (bx,                by - half),
        (bx + head_w // 2,  by - half + head_h),
        (bx + stem_w // 2,  by - half + head_h),
        (bx + stem_w // 2,  by + half),
        (bx - stem_w // 2,  by + half),
        (bx - stem_w // 2,  by - half + head_h),
        (bx - head_w // 2,  by - half + head_h),
    ]
    draw.polygon(arrow_poly, fill=ARROW)

    return img


def make_toolbar_icon(state):
    """Render a 32x32 toolbar icon — green up-arrow (idle) or red stop (scanning)."""
    s = 256  # high-res for downsampling
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if state == "idle":
        # Emerald disc with white up-arrow
        draw.ellipse((6, 6, s - 6, s - 6), fill=BADGE)
        a = int(s * 0.58)
        cx, cy = s // 2, s // 2
        head_h = int(a * 0.45)
        head_w = int(a * 0.92)
        stem_w = int(a * 0.34)
        half = a // 2
        poly = [
            (cx,                cy - half),
            (cx + head_w // 2,  cy - half + head_h),
            (cx + stem_w // 2,  cy - half + head_h),
            (cx + stem_w // 2,  cy + half),
            (cx - stem_w // 2,  cy + half),
            (cx - stem_w // 2,  cy - half + head_h),
            (cx - head_w // 2,  cy - half + head_h),
        ]
        draw.polygon(poly, fill=ARROW)
    elif state == "scanning":
        # Red disc with white rounded square (stop)
        draw.ellipse((6, 6, s - 6, s - 6), fill=(220, 38, 38, 255))  # red-600
        sq = int(s * 0.42)
        cx, cy = s // 2, s // 2
        draw.rounded_rectangle(
            (cx - sq // 2, cy - sq // 2, cx + sq // 2, cy + sq // 2),
            radius=int(sq * 0.18),
            fill=ARROW,
        )

    return img.resize((32, 32), Image.LANCZOS)


def main():
    img = render()
    img.save("icon-source.png")
    for size in (48, 96, 128):
        img.resize((size, size), Image.LANCZOS).save(f"icon-{size}.png")
        print(f"Wrote icon-{size}.png")

    for state in ("idle", "scanning"):
        path = f"content/tb-{state}.png"
        make_toolbar_icon(state).save(path)
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
