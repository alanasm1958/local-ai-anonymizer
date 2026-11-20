"""Generate the extension icons: a dark blue shield with two redaction bars."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
SCALE = 8  # draw large, then downsample for smooth edges
DARK_BLUE = (40, 58, 151, 255)   # brand primary dark blue #283A97
LIGHT_BLUE = (0, 161, 228, 255)  # brand primary light blue #00A1E4
GOLD = (253, 194, 15, 255)       # brand secondary gold #FDC20F
WHITE = (255, 255, 255, 255)
OUT_DIR = Path(__file__).resolve().parent.parent / "icons"


def shield(size: int) -> list[tuple[float, float]]:
    s = size
    return [
        (s * 0.50, s * 0.04),
        (s * 0.90, s * 0.18),
        (s * 0.88, s * 0.52),
        (s * 0.76, s * 0.76),
        (s * 0.50, s * 0.96),
        (s * 0.24, s * 0.76),
        (s * 0.12, s * 0.52),
        (s * 0.10, s * 0.18),
    ]


def draw_icon(size: int) -> Image.Image:
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.polygon(shield(big), fill=DARK_BLUE)
    bar_h = big * 0.11
    radius = bar_h / 2
    draw.rounded_rectangle((big * 0.27, big * 0.34, big * 0.73, big * 0.34 + bar_h), radius, fill=WHITE)
    draw.rounded_rectangle((big * 0.27, big * 0.53, big * 0.58, big * 0.53 + bar_h), radius, fill=LIGHT_BLUE)
    draw.ellipse((big * 0.63, big * 0.53, big * 0.63 + bar_h, big * 0.53 + bar_h), fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon-{size}.png"
        draw_icon(size).save(path)
        print(f"wrote {path.relative_to(OUT_DIR.parent)}")


if __name__ == "__main__":
    main()
