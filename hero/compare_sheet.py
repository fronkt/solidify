"""
compare_sheet.py -- side-by-side sheet of two generator versions in identical views (plain Python, PIL).
Each transparent render is composited onto the page color #0a0a0a, scaled to one cell, labeled; optional
magnified crops make small defects (pinholes) visible at sheet scale. Under each column header a density line
is read from that side's features_<name>_t1.00.json (alive secondaries / tertiaries / hosts, long secondaries
carrying tertiaries), so the sheet compares surface density and not only silhouettes.

  python hero/compare_sheet.py --left-dir DIR --left-name v1 --right-dir DIR --right-name v3 \
      --views t1.00_iso,t1.00_top,t1.00_close,t0.30_iso,t0.60_iso \
      --zoom t1.00_close:0.62,0.60,0.30 --cell 560 --out C:/Users/frank/solidify-hero-out/v3/compare_v1_v3.png

File names follow the generator: <name>_<view>.png. A --zoom entry view:cx,cy,frac adds a row with the square
crop centered at (cx, cy) (frame fractions) of side frac x frame, magnified to the cell.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

PAGE_BG = (0x0A, 0x0A, 0x0A)


def density_line(d, name):
    """one line of counts from features_<name>_t1.00.json in dir d ('' if absent)."""
    path = os.path.join(d, 'features_%s_t1.00.json' % name)
    if not os.path.isfile(path):
        return ''
    with open(path) as fh:
        c = json.load(fh).get('counts', {})
    parts = ['%d secondaries' % c.get('alive_secondary', 0), '%d tertiaries' % c.get('alive_tertiary', 0)]
    if 'tertiary_hosts' in c:
        parts.append('%d hosts' % c['tertiary_hosts'])
    if 'long_secondaries' in c:
        parts.append('%d of %d long secondaries carry tertiaries' % (c.get('long_secondaries_with_tertiaries', 0),
                                                                    c['long_secondaries']))
    return 't=1 alive: ' + ', '.join(parts)


def font(size):
    for cand in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf'):
        if os.path.isfile(cand):
            return ImageFont.truetype(cand, size)
    return ImageFont.load_default()


def composite(path):
    im = Image.open(path).convert('RGBA')
    base = Image.new('RGBA', im.size, PAGE_BG + (255,))
    return Image.alpha_composite(base, im).convert('RGB')


def crop_frac(im, cx, cy, frac):
    w, h = im.size
    side = int(round(frac * min(w, h)))
    x0 = int(round(cx * w - side / 2.0))
    y0 = int(round(cy * h - side / 2.0))
    x0 = min(max(x0, 0), w - side)
    y0 = min(max(y0, 0), h - side)
    return im.crop((x0, y0, x0 + side, y0 + side))


def main():
    p = argparse.ArgumentParser(description='v1 vs v3 comparison sheet')
    p.add_argument('--left-dir', required=True)
    p.add_argument('--left-name', required=True)
    p.add_argument('--left-label', default='')
    p.add_argument('--right-dir', required=True)
    p.add_argument('--right-name', required=True)
    p.add_argument('--right-label', default='')
    p.add_argument('--views', required=True, help='comma list, e.g. t1.00_iso,t1.00_top,t1.00_close')
    p.add_argument('--zoom', action='append', default=[], metavar='VIEW:CX,CY,FRAC')
    p.add_argument('--cell', type=int, default=560)
    p.add_argument('--out', required=True)
    A = p.parse_args()

    views = [v.strip() for v in A.views.split(',') if v.strip()]
    rows = [(v, None) for v in views]
    for z in A.zoom:
        view, spec = z.split(':', 1)
        cx, cy, frac = [float(x) for x in spec.split(',')]
        rows.append((view.strip(), (cx, cy, frac)))

    cell, gutter, header, label_h = A.cell, 24, 100, 34
    W = gutter * 3 + cell * 2
    H = header + len(rows) * (cell + label_h + gutter)
    sheet = Image.new('RGB', (W, H), PAGE_BG)
    draw = ImageDraw.Draw(sheet)
    f_big, f_small, f_tiny = font(30), font(20), font(15)
    left_label = A.left_label or A.left_name
    right_label = A.right_label or A.right_name
    draw.text((gutter, 20), left_label, fill=(235, 235, 235), font=f_big)
    draw.text((gutter * 2 + cell, 20), right_label, fill=(235, 235, 235), font=f_big)
    for col, (d, name) in enumerate(((A.left_dir, A.left_name), (A.right_dir, A.right_name))):
        line = density_line(d, name)
        if line:
            draw.text((gutter + col * (cell + gutter), 62), line, fill=(170, 170, 170), font=f_tiny)
            print('[sheet] %s: %s' % (name, line))

    y = header
    missing = []
    for view, zoom in rows:
        for col, (d, name) in enumerate(((A.left_dir, A.left_name), (A.right_dir, A.right_name))):
            path = os.path.join(d, '%s_%s.png' % (name, view))
            x = gutter + col * (cell + gutter)
            if not os.path.isfile(path):
                missing.append(path)
                draw.rectangle((x, y, x + cell, y + cell), outline=(90, 90, 90))
                draw.text((x + 12, y + 12), 'missing: ' + os.path.basename(path), fill=(200, 80, 80), font=f_small)
                continue
            im = composite(path)
            tag = view
            if zoom is not None:
                im = crop_frac(im, *zoom)
                tag = '%s  crop %.0f%% at (%.2f, %.2f), x%.1f' % (view, zoom[2] * 100, zoom[0], zoom[1], 1.0 / zoom[2])
            im = im.resize((cell, cell), Image.LANCZOS)
            sheet.paste(im, (x, y))
            draw.text((x, y + cell + 6), tag, fill=(190, 190, 190), font=f_small)
        y += cell + label_h + gutter

    os.makedirs(os.path.dirname(os.path.abspath(A.out)), exist_ok=True)
    sheet.save(A.out, optimize=True)
    print('[sheet] -> %s  (%d x %d, %d rows)' % (A.out, W, H, len(rows)))
    if missing:
        print('[sheet] missing inputs:', missing)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
