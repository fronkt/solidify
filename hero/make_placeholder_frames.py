"""PLACEHOLDER frames for the landing hero, written to the frame-set contract.

The real hero is a Blender render of hero/dendrite_gen.py (180 frames, grow ->
cool -> tour). Until those frames exist this script writes stand-ins with the
SAME paths, sizes, frame count, background and manifest shape, so the page and
its gates (scripts/verify-hero-manifest.mjs, scripts/verify-hero.mjs) can be
built and tested now. The real render overwrites everything this writes.

What a placeholder frame is: one of two finished stills (the incandescent look
while growing, the satin-steel look once frozen) moved by a 2D camera (scale,
in-plane turn, a pan toward each feature during the tour) over #0a0b0d, with
its frame index printed small in the bottom-left corner. The anchors are the
same five hand-picked points on the steel still, pushed through the same
camera, so the callouts land where the stand-in draws them. manifest.source
says PLACEHOLDER, and verify-hero-manifest.mjs prints a notice while it does.

    python hero/make_placeholder_frames.py [--src C:/Users/frank/solidify-hero-out]

Needs Pillow (with WebP). Writes public/hero/{1200,600}/f000..f179.webp,
public/hero/poster-{1200,600}.webp and public/hero/manifest.json.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "hero"
N = 180
SIZES = (1200, 600)
BG = (10, 11, 13)   # #0a0b0d, the page background
BUDGET = {1200: 12 * 1024 * 1024, 600: int(3.5 * 1024 * 1024)}

CHAPTERS = [
    {"id": "seed", "from": 0, "to": 11},
    {"id": "grow", "from": 12, "to": 95},
    {"id": "cool", "from": 96, "to": 119},
    {"id": "tour", "from": 120, "to": 179},
]
FEATURES = [
    {"id": "tip", "kind": "point", "from": 122, "to": 133},
    {"id": "primary", "kind": "pair", "from": 134, "to": 145},
    {"id": "lambda2", "kind": "pair", "from": 146, "to": 157},
    {"id": "tertiary", "kind": "point", "from": 158, "to": 167},
    {"id": "neck", "kind": "point", "from": 168, "to": 179},
]
# Feature points picked by eye on satin-steel_hero.png (1000 x 1000 px).
# primary = (root side, tip side) along the upward arm; lambda2 = the roots of
# two adjacent secondary arms on the lower-right arm.
POINTS = {
    "tip": [(500, 152)],
    "primary": [(502, 380), (500, 182)],
    "lambda2": [(708, 541), (724, 546)],
    "tertiary": [(677, 470)],
    "neck": [(765, 549)],
}
STEEL_CENTRE = (520, 470)    # middle of the steel crystal's bounding box
STEEL_EXTENT = 665           # its larger bounding-box side, px
GLOW_CENTRE = (532, 478)
GLOW_EXTENT = 610
POSTER_FRAME = 120           # first tour frame: the whole frozen crystal, no zoom (same camera as 119)
OCCLUDED = {"tertiary": {158, 159}}   # exercise the page's visible=0 path


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def feature_at(i: int):
    for f in FEATURES:
        if f["from"] <= i <= f["to"]:
            return f
    return None


def camera(i: int):
    """(fill fraction F, turn in degrees, zoom, pan target feature id, pan weight)."""
    if i <= 11:
        return 0.15, -8.0, 1.0, None, 0.0
    if i <= 95:
        u = (i - 12) / 83
        return lerp(0.15, 0.78, u), lerp(-8.0, 22.0, u), 1.0, None, 0.0
    if i <= 119:
        v = (i - 96) / 23
        return 0.78, lerp(22.0, 34.0, v), 1.0, None, 0.0
    w = (i - 120) / 59
    f = feature_at(i)
    if f is None:
        return 0.78, lerp(34.0, 104.0, w), 1.0, None, 0.0
    span = f["to"] - f["from"] + 1
    b = math.sin(math.pi * (i - f["from"] + 0.5) / span) ** 0.6
    return 0.78, lerp(34.0, 104.0, w), 1.0 + 0.25 * b, f["id"], 0.35 * b


def forward(p, centre, k, theta, origin):
    """source px -> output px: origin + k * R(theta) * (p - centre)."""
    c, s = math.cos(theta), math.sin(theta)
    dx, dy = p[0] - centre[0], p[1] - centre[1]
    return origin[0] + k * (c * dx - s * dy), origin[1] + k * (s * dx + c * dy)


def affine_inverse(centre, k, theta, origin):
    """PIL AFFINE coefficients mapping output px back to source px."""
    c, s = math.cos(theta), math.sin(theta)
    ox, oy = origin
    a, b = c / k, s / k
    d, e = -s / k, c / k
    return (a, b, centre[0] - (a * ox + b * oy), d, e, centre[1] - (d * ox + e * oy))


def frame_camera(i: int, size: int):
    F, turn, zoom, pan_id, pan_w = camera(i)
    theta = math.radians(turn)
    k = F * size / STEEL_EXTENT * zoom
    mid = (size / 2, size / 2)
    origin = mid
    if pan_id:
        pts = [forward(p, STEEL_CENTRE, k, theta, mid) for p in POINTS[pan_id]]
        fx = sum(p[0] for p in pts) / len(pts)
        fy = sum(p[1] for p in pts) / len(pts)
        origin = (mid[0] - (fx - mid[0]) * pan_w, mid[1] - (fy - mid[1]) * pan_w)
    return F, theta, k, zoom, origin


def place(src: Image.Image, centre, k, theta, origin, size):
    """An RGBA still pushed through the camera onto a transparent layer."""
    # premultiplied, so the bicubic resample does not drag dark fringes in
    pm = src.convert("RGBa")
    out = pm.transform((size, size), Image.AFFINE, affine_inverse(centre, k, theta, origin),
                       resample=Image.BICUBIC, fillcolor=(0, 0, 0, 0))
    return out.convert("RGBA")


def glow_dot(size: int, r: float, strength: float) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    halo = r * 4
    d.ellipse((c - halo, c - halo, c + halo, c + halo), fill=(255, 140, 50, int(120 * strength)))
    layer = layer.filter(ImageFilter.GaussianBlur(halo * 0.6))
    d = ImageDraw.Draw(layer)
    d.ellipse((c - r, c - r, c + r, c + r), fill=(255, 236, 200, int(255 * strength)))
    return layer.filter(ImageFilter.GaussianBlur(max(1.0, r * 0.25)))


def label(img: Image.Image, text: str) -> None:
    size = img.size[0]
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", max(10, size // 70))
    except OSError:
        font = ImageFont.load_default()
    ImageDraw.Draw(img).text((size * 0.02, size * 0.965), text, fill=(74, 80, 90), font=font)


def render(i: int, steel: Image.Image, glow: Image.Image, size: int, tag: str) -> Image.Image:
    base = Image.new("RGBA", (size, size), BG + (255,))
    F, theta, k, zoom, origin = frame_camera(i, size)
    if i <= 11:
        t = i / 11
        base.alpha_composite(glow_dot(size, size * lerp(0.004, 0.018, t), lerp(0.35, 1.0, t)))
    elif i <= 119:
        # the glow still is matched to the steel one by its own bounding extent
        g = place(glow, GLOW_CENTRE, F * size / GLOW_EXTENT * zoom, theta, origin, size)
        mix = 0.0 if i <= 95 else smooth((i - 96) / 23)
        if mix < 1:
            if mix > 0:
                g.putalpha(g.getchannel("A").point(lambda a: int(a * (1 - mix))))
            base.alpha_composite(g)
        if mix > 0:
            s = place(steel, STEEL_CENTRE, k, theta, origin, size)
            s.putalpha(s.getchannel("A").point(lambda a: int(a * mix)))
            base.alpha_composite(s)
    else:
        base.alpha_composite(place(steel, STEEL_CENTRE, k, theta, origin, size))
    img = base.convert("RGB")
    label(img, tag)
    return img


def anchors_at(i: int):
    size = 1000.0   # normalized output, any size works
    _, theta, k, _, origin = frame_camera(i, size)
    rows = {}
    for f in FEATURES:
        pts = [forward(p, STEEL_CENTRE, k, theta, origin) for p in POINTS[f["id"]]]
        raw = [v / size for p in pts for v in p]
        inside = all(0.02 <= v <= 0.98 for v in raw)
        vis = 0 if (not inside or i in OCCLUDED.get(f["id"], ())) else 1
        # the contract's coordinates are normalized 0..1: a point the camera has
        # left behind is clamped to the frame's edge and flagged invisible
        rows[f["id"]] = [round(min(1.0, max(0.0, v)), 5) for v in raw] + [vis]
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="C:/Users/frank/solidify-hero-out")
    ap.add_argument("--quality", type=int, default=74)
    ap.add_argument("--force", action="store_true",
                    help="overwrite even when public/hero holds a real (non-placeholder) render")
    args = ap.parse_args()
    # never clobber the real render: it lands in the same directory
    existing = OUT / "manifest.json"
    if existing.exists() and not args.force:
        src_line = json.loads(existing.read_text(encoding="utf-8")).get("source", "")
        if "PLACEHOLDER" not in src_line:
            raise SystemExit(f"public/hero already holds a real render ({src_line!r}); pass --force to overwrite it")
    has_frames = any(next((OUT / str(s)).glob("f*.webp"), None) is not None for s in SIZES)
    if not existing.exists() and has_frames and not args.force:
        raise SystemExit("public/hero has frames but no manifest (a render in progress?); pass --force to overwrite")
    src = Path(args.src)
    steel = Image.open(src / "look_satin-steel" / "satin-steel_hero.png").convert("RGBA")
    glow = Image.open(src / "look_incandescent-growth" / "incandescent_t0.45_hero.png").convert("RGBA")

    for size in SIZES:
        (OUT / str(size)).mkdir(parents=True, exist_ok=True)

    # render once at 1200, then downsample for 600, so both sets agree exactly
    frames = [render(i, steel, glow, 1200, f"f{i:03d}  PLACEHOLDER") for i in range(N)]
    poster = render(POSTER_FRAME, steel, glow, 1200, "POSTER  PLACEHOLDER")

    totals = {}
    for size in SIZES:
        q = args.quality
        while True:
            total = 0
            for i, fr in enumerate(frames):
                im = fr if size == 1200 else fr.resize((size, size), Image.LANCZOS)
                p = OUT / str(size) / f"f{i:03d}.webp"
                im.save(p, "WEBP", quality=q, method=4)
                total += p.stat().st_size
            if total <= BUDGET[size] or q <= 40:
                break
            q -= 6
        pim = poster if size == 1200 else poster.resize((size, size), Image.LANCZOS)
        pim.save(OUT / f"poster-{size}.webp", "WEBP", quality=min(90, q + 8), method=4)
        totals[size] = (total, q)

    rows = [anchors_at(i) for i in range(N)]
    manifest = {
        "version": 1,
        "frames": N,
        "pattern": "f{i:03d}.webp",
        "sizes": list(SIZES),
        "background": "#0a0b0d",
        "chapters": CHAPTERS,
        "features": FEATURES,
        "anchors": {f["id"]: [rows[i][f["id"]] for i in range(N)] for f in FEATURES},
        "poster": {"frame": POSTER_FRAME, "anchors": rows[POSTER_FRAME]},
        "source": "hero/make_placeholder_frames.py PLACEHOLDER, not the Blender render",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    for size, (total, q) in totals.items():
        print(f"{size}: {N} frames, {total / 1e6:.2f} MB at quality {q}")


if __name__ == "__main__":
    main()
