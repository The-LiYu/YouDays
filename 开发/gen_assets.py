"""生成优日的 Android 图标与启动图。

用法：python gen_assets.py
图标：朱砂底 + 奶油色日历页（含装订环与日期格），启动图：奶油底 + 图标 + 优日。
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "手机端" / "native" / "android" / "app" / "src" / "main" / "res"
PREVIEW = ROOT / "预览"

BG = (246, 242, 235, 255)
CREAM = (251, 243, 230, 255)
INK = (35, 30, 24, 255)
MUTED = (155, 145, 131, 255)
ACCENT_TOP = (214, 106, 77)
ACCENT_BOTTOM = (184, 71, 48)
CAL_HEADER = (158, 58, 39, 255)
CAL_CELL = (223, 206, 183, 255)
CAL_MARK = (200, 85, 61, 255)

FONT_SERIF = "C:/Windows/Fonts/simsun.ttc"
FONT_SANS = "C:/Windows/Fonts/msyh.ttc"


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    strip = Image.new("RGB", (1, max(size, 2)))
    px = strip.load()
    for y in range(strip.height):
        t = y / (strip.height - 1)
        px[0, y] = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
    return strip.resize((size, size), Image.Resampling.BICUBIC).convert("RGBA")


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
    )
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


def calendar_mark(size: int, with_shadow: bool = True) -> Image.Image:
    """奶油色日历页：顶部装订环、朱砂页眉、3×3 日期格，其中一格被朱砂标记。"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = size * 0.205
    pw = size * 0.590
    py = size * 0.265
    ph = size * 0.535
    radius = size * 0.072

    if with_shadow:
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle(
            [px, py + size * 0.020, px + pw, py + ph + size * 0.020],
            radius=radius,
            fill=(92, 48, 32, 70),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.016))
        layer.alpha_composite(shadow)

    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle([px, py, px + pw, py + ph], radius=radius, fill=CREAM)

    header_h = size * 0.115
    draw.rounded_rectangle([px, py, px + pw, py + header_h * 2], radius=radius, fill=CAL_HEADER)
    draw.rectangle([px, py + header_h * 0.5, px + pw, py + header_h], fill=CAL_HEADER)

    ring_w = size * 0.036
    for fx in (0.365, 0.635):
        cx = px + pw * fx
        draw.rounded_rectangle(
            [cx - ring_w / 2, py - size * 0.050, cx + ring_w / 2, py + size * 0.052],
            radius=ring_w / 2,
            fill=CREAM,
        )

    cell = size * 0.070
    gap = size * 0.035
    grid_w = 3 * cell + 2 * gap
    sx = px + pw / 2 - grid_w / 2
    y0 = py + size * 0.178
    for row in range(3):
        for col in range(3):
            x = sx + col * (cell + gap)
            y = y0 + row * (cell + gap)
            fill = CAL_MARK if (row == 1 and col == 1) else CAL_CELL
            draw.rounded_rectangle([x, y, x + cell, y + cell], radius=size * 0.018, fill=fill)
    return layer


def seal(size: int, round_icon: bool = False) -> Image.Image:
    img = vertical_gradient(size, ACCENT_TOP, ACCENT_BOTTOM)
    img.putalpha(circle_mask(size) if round_icon else rounded_mask(size, 0.225))
    img.alpha_composite(calendar_mark(size))
    return img


def adaptive_foreground(size: int) -> Image.Image:
    """自适应图标前景：透明底，内容留在 66/108 安全区内。"""
    return calendar_mark(size, with_shadow=False)


def text_with_spacing(draw, text, font, fill, center_x, top):
    widths = [draw.textlength(ch, font=font) for ch in text]
    gap = font.size * 0.10
    total = sum(widths) + gap * (len(text) - 1)
    x = center_x - total / 2
    for ch, w in zip(text, widths):
        draw.text((x, top), ch, font=font, fill=fill)
        x += w + gap


def make_splash(width: int, height: int) -> Image.Image:
    img = Image.new("RGBA", (width, height), BG)
    m = min(width, height)
    seal_size = int(m * 0.30)
    cx, cy = width // 2, int(height * 0.40)

    # 柔和的印记阴影
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        [cx - seal_size / 2, cy - seal_size / 2 + m * 0.035,
         cx + seal_size / 2, cy + seal_size / 2 + m * 0.035],
        radius=int(seal_size * 0.225),
        fill=(110, 62, 40, 60),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(m * 0.022))
    img.alpha_composite(shadow)

    mark = seal(seal_size)
    img.alpha_composite(mark, (cx - seal_size // 2, cy - seal_size // 2))

    draw = ImageDraw.Draw(img)
    title_font = ImageFont.truetype(FONT_SERIF, int(m * 0.095))
    text_with_spacing(draw, "优日", title_font, INK, cx, cy + seal_size * 0.82)

    tag_font = ImageFont.truetype(FONT_SANS, int(m * 0.027))
    tag = "记住值得记住的日子"
    tag_w = sum(draw.textlength(ch, font=tag_font) for ch in tag) + tag_font.size * 0.25 * (len(tag) - 1)
    draw.text((cx - tag_w / 2, cy + seal_size * 0.82 + m * 0.135), tag, font=tag_font, fill=MUTED)
    return img


def main() -> None:
    densities = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    foreground = {
        "mdpi": 108,
        "hdpi": 162,
        "xhdpi": 216,
        "xxhdpi": 324,
        "xxxhdpi": 432,
    }
    for density, size in densities.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        seal(size).save(folder / "ic_launcher.png")
        seal(size, round_icon=True).save(folder / "ic_launcher_round.png")
    for density, size in foreground.items():
        folder = RES / f"mipmap-{density}"
        adaptive_foreground(size).save(folder / "ic_launcher_foreground.png")

    splashes = {
        "drawable": (480, 320),
        "drawable-land-mdpi": (480, 320),
        "drawable-land-hdpi": (800, 480),
        "drawable-land-xhdpi": (1280, 720),
        "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xxxhdpi": (1920, 1280),
        "drawable-port-mdpi": (320, 480),
        "drawable-port-hdpi": (480, 800),
        "drawable-port-xhdpi": (720, 1280),
        "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xxxhdpi": (1280, 1920),
    }
    for folder_name, (w, h) in splashes.items():
        folder = RES / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        make_splash(w, h).convert("RGB").save(folder / "splash.png")

    PREVIEW.mkdir(parents=True, exist_ok=True)
    seal(512).save(PREVIEW / "icon-512.png")
    make_splash(780, 1688).convert("RGB").save(PREVIEW / "splash.png")

    # Android 12 启动屏图标：单独一张，避免把自适应图标直接当启动图使用
    nodpi = RES / "drawable-nodpi"
    nodpi.mkdir(parents=True, exist_ok=True)
    seal(512).save(nodpi / "splash_icon.png")
    print("assets generated")


if __name__ == "__main__":
    main()
