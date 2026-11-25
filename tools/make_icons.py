#!/usr/bin/env python3
"""Generate the launcher icons (adaptive foreground + legacy PNGs) into src/android/res.

    python -I tools/make_icons.py

Motif: two tilted orbits with a small planet and a glowing core, kept inside the adaptive-icon
safe zone (the central 66 of 108 dp) so no launcher mask crops it.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

RES = Path(__file__).resolve().parent.parent / "src" / "android" / "res"
BACKGROUND = (28, 37, 71, 255)   # deep night blue, same as @color/icon_bg
GOLD = (244, 197, 66, 255)
CORE = (255, 243, 196, 255)
PLANET = (143, 166, 255, 255)
TILTS = (-60, 60)
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
SUPERSAMPLE = 4


def foreground(size):
    """The adaptive-icon layer at `size` px, drawn at 4x and reduced for smooth edges."""
    n = size * SUPERSAMPLE
    c = n / 2
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    for tilt in TILTS:
        ring = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse(
            [c - n * 0.29, c - n * 0.115, c + n * 0.29, c + n * 0.115],
            outline=GOLD, width=round(n * 0.022),
        )
        img.alpha_composite(ring.rotate(tilt, resample=Image.BICUBIC, center=(c, c)))

    # a small planet travelling on one of the orbits
    t = math.radians(35)
    px, py = n * 0.29 * math.cos(t), n * 0.115 * math.sin(t)
    ang = math.radians(TILTS[1])
    x = c + px * math.cos(ang) - py * math.sin(ang)
    y = c + px * math.sin(ang) + py * math.cos(ang)
    r = n * 0.04
    ImageDraw.Draw(img).ellipse([x - r, y - r, x + r, y + r], fill=PLANET)

    # glowing core
    glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    rg = n * 0.085
    ImageDraw.Draw(glow).ellipse([c - rg, c - rg, c + rg, c + rg], fill=GOLD[:3] + (110,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(n * 0.02)))
    r = n * 0.052
    ImageDraw.Draw(img).ellipse([c - r, c - r, c + r, c + r], fill=CORE)
    return img.resize((size, size), Image.LANCZOS)


def legacy(size, round_shape):
    """Pre-API-26 style icon: the adaptive foreground shows its central 72 of 108 dp."""
    pad = round(size * 18 / 108)
    inner = size - 2 * pad
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    box = [0, 0, size * SUPERSAMPLE, size * SUPERSAMPLE]
    if round_shape:
        ImageDraw.Draw(mask).ellipse(box, fill=255)
    else:
        ImageDraw.Draw(mask).rounded_rectangle(box, radius=round(size * SUPERSAMPLE * 0.22), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    plate = Image.new("RGBA", (size, size), BACKGROUND)
    icon.paste(plate, (0, 0), mask)
    icon.alpha_composite(foreground(inner), (pad, pad))
    return icon


def write(img, rel):
    path = RES / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    return path


def main():
    written = []
    for name, scale in DENSITIES.items():
        written.append(write(foreground(round(108 * scale)), f"drawable-{name}/ic_launcher_foreground.png"))
        size = round(48 * scale)
        written.append(write(legacy(size, False), f"mipmap-{name}/ic_launcher.png"))
        written.append(write(legacy(size, True), f"mipmap-{name}/ic_launcher_round.png"))
    print(f"wrote {len(written)} icon files under {RES.relative_to(RES.parent.parent)}")


if __name__ == "__main__":
    main()
