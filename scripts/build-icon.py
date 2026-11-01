#!/usr/bin/env python3
"""Render the icon deterministically from its white artwork mask. Requires Pillow.

Normal rebuild: python3 scripts/build-icon.py
Import artwork once: python3 scripts/build-icon.py --extract-from SOURCE.png
The import ignores damaged source alpha and separates white from orange using blue.
"""

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ARTWORK = ROOT / 'assets/icon-artwork.png'
OUTPUT = ROOT / 'assets/icon.png'
ORANGE = (255, 62, 0)


def squircle(size, inset=4, samples=8):
    """Area-sample |x/r|^4 + |y/r|^4 <= 1, without ringing filters."""
    width, height = size
    if width != height or width <= 2 * inset:
        raise ValueError('The artwork must be square and larger than its inset.')
    center = width * samples / 2
    radius = (width / 2 - inset) * samples
    high = Image.new('L', (width * samples, height * samples))
    draw = ImageDraw.Draw(high)
    for x in range(width * samples):
        normalized = abs((x + 0.5 - center) / radius)
        if normalized >= 1:
            continue
        extent = radius * (1 - normalized ** 4) ** 0.25
        top = math.ceil(center - extent - 0.5)
        bottom = math.floor(center + extent - 0.5)
        draw.line((x, top, x, bottom), fill=255)
    return high.resize(size, Image.Resampling.BOX)


def render(artwork):
    rgb = Image.composite(
        Image.new('RGB', artwork.size, 'white'),
        Image.new('RGB', artwork.size, ORANGE),
        artwork
    )
    result = rgb.convert('RGBA')
    alpha = squircle(artwork.size)
    result.putalpha(alpha)
    # Empty exterior pixels carry no hidden colored speckles either.
    result.paste((0, 0, 0, 0), mask=alpha.point(lambda value: 255 if value == 0 else 0))
    return result


def preview(icon, destination):
    sheet = Image.new('RGB', (1248, 500), '#eeeeee')
    draw = ImageDraw.Draw(sheet)
    for column, (label, color) in enumerate([('White', '#ffffff'), ('Dark', '#18181b'), ('Checkerboard', '#ffffff')]):
        x = column * 416
        draw.rectangle((x, 0, x + 415, 499), fill=color)
        if column == 2:
            for row in range(0, 500, 16):
                for cell in range(0, 416, 16):
                    if (row // 16 + cell // 16) % 2:
                        draw.rectangle((x + cell, row, x + cell + 15, row + 15), fill='#d1d5db')
        draw.text((x + 16, 10), label, fill='#ffffff' if column == 1 else '#111111')
        for size, offset in [(384, (16, 40)), (64, (16, 428)), (32, (104, 444))]:
            scaled = icon.resize((size, size), Image.Resampling.LANCZOS)
            sheet.paste(scaled, (x + offset[0], offset[1]), scaled)
    sheet.save(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extract-from', type=Path)
    parser.add_argument('--preview', type=Path)
    args = parser.parse_args()
    if args.extract_from:
        with Image.open(args.extract_from) as source:
            blue = source.convert('RGB').getchannel('B')
            lookup = [round(255 * max(0, min(1, (value - 8) / (245 - 8)))) for value in range(256)]
            artwork = blue.point(lookup)
            artwork.save(ARTWORK, optimize=True)
    with Image.open(ARTWORK) as source:
        icon = render(source.convert('L'))
    icon.save(OUTPUT, optimize=True)
    if args.preview:
        preview(icon, args.preview)
    print(f'Wrote {OUTPUT}: {icon.width}×{icon.height}, #FF3E00, analytic n=4 squircle')


if __name__ == '__main__':
    main()
