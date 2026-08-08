#!/usr/bin/env python3
"""Generate Distiller's icon set.

A rounded indigo tile with a stack of three cards leaning back into one — the
"many pages, few cards" idea. Rendered at 8x and downsampled so the curves stay
clean at 16px. Requires Pillow.

    python3 scripts/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Extension" / "icons"
SIZES = [16, 19, 32, 38, 48, 64, 128, 256, 512, 1024]

SS = 8  # supersampling factor
BASE = 512

ACCENT_TOP = (110, 104, 240)
ACCENT_BOTTOM = (72, 66, 200)
CARD = (255, 255, 255)


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (1, size), top)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.NEAREST)


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def render(size):
    s = size * SS
    tile = vertical_gradient(s, ACCENT_TOP, ACCENT_BOTTOM).convert("RGBA")
    tile.putalpha(rounded_mask(s, int(s * 0.225)))

    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    u = s / 512.0
    radius = int(22 * u)

    # Three cards: two receding ghosts behind one solid face card.
    ghosts = [
        # (left, top, right, bottom, alpha)
        (150 * u, 96 * u, 400 * u, 196 * u, 70),
        (128 * u, 138 * u, 400 * u, 258 * u, 120),
    ]
    for left, top, right, bottom, alpha in ghosts:
        d.rounded_rectangle([left, top, right, bottom], radius=radius, fill=CARD + (alpha,))

    d.rounded_rectangle([104 * u, 196 * u, 400 * u, 416 * u], radius=radius, fill=CARD + (255,))

    # A bold question rule and two lighter answer rules, drawn in the tile's own
    # colour so they read as cut out of the card.
    RULE = (96, 90, 220)
    d.rounded_rectangle([144 * u, 248 * u, 356 * u, 274 * u], radius=13 * u, fill=RULE + (255,))
    d.rounded_rectangle([144 * u, 320 * u, 300 * u, 342 * u], radius=11 * u, fill=RULE + (110,))
    d.rounded_rectangle([144 * u, 362 * u, 246 * u, 384 * u], radius=11 * u, fill=RULE + (110,))

    tile.alpha_composite(layer)
    return tile.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        render(size).save(OUT / f"icon-{size}.png")
        print(f"icons/icon-{size}.png")


if __name__ == "__main__":
    main()
