#!/usr/bin/env python3
"""Generate PWA icon PNGs from a simple procedural design.

Usage:
    .venv-icons/bin/python scripts/generate-icons.py

Requires Pillow (install: python3 -m venv .venv-icons && .venv-icons/bin/pip install Pillow).
"""

from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(ROOT, "public")

BACKGROUND = "#2E1A47"
ACCENT = "#E8A838"
ACCENT_DIM = "#B67E2A"
SAFE_ZONE_FRACTION = 0.4  # Keep critical content inside this radius for maskable icons


def draw_icon(size):
    img = Image.new("RGBA", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(img)

    cx = cy = size // 2
    safe_radius = int(size * SAFE_ZONE_FRACTION)

    # Outer ring (stays inside safe zone)
    ring_width = max(2, size // 64)
    draw.ellipse(
        [(cx - safe_radius, cy - safe_radius), (cx + safe_radius, cy + safe_radius)],
        outline=ACCENT,
        width=ring_width,
    )

    # Hour ticks
    tick_count = 12
    tick_in = safe_radius * 0.78
    tick_out = safe_radius * 0.88
    for i in range(tick_count):
        angle = (i / tick_count) * 360 - 90
        import math

        rad = math.radians(angle)
        x1 = cx + tick_in * math.cos(rad)
        y1 = cy + tick_in * math.sin(rad)
        x2 = cx + tick_out * math.cos(rad)
        y2 = cy + tick_out * math.sin(rad)
        draw.line([(x1, y1), (x2, y2)], fill=ACCENT_DIM, width=max(1, size // 96))

    # Clock hands (10:10)
    import math

    def draw_hand(angle_deg, length_ratio, width):
        rad = math.radians(angle_deg - 90)
        length = safe_radius * length_ratio
        x2 = cx + length * math.cos(rad)
        y2 = cy + length * math.sin(rad)
        draw.line([(cx, cy), (x2, y2)], fill=ACCENT, width=width)
        # Round cap approximation
        draw.ellipse(
            [(x2 - width / 2, y2 - width / 2), (x2 + width / 2, y2 + width / 2)],
            fill=ACCENT,
        )

    # Hour hand pointing at 10
    draw_hand(300, 0.5, max(2, size // 48))
    # Minute hand pointing at 2
    draw_hand(60, 0.7, max(2, size // 64))

    # Center dot
    center_radius = max(3, size // 64)
    draw.ellipse(
        [(cx - center_radius, cy - center_radius), (cx + center_radius, cy + center_radius)],
        fill=ACCENT,
    )

    return img


def save_icons():
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    sizes = [192, 512]
    for size in sizes:
        img = draw_icon(size)
        img.save(os.path.join(PUBLIC_DIR, f"icon-{size}x{size}.png"), "PNG")
        print(f"Generated public/icon-{size}x{size}.png")

    # Maskable variant: same design, content already lives inside the safe zone
    img512 = draw_icon(512)
    img512.save(os.path.join(PUBLIC_DIR, "maskable-icon-512x512.png"), "PNG")
    print("Generated public/maskable-icon-512x512.png")


if __name__ == "__main__":
    save_icons()
