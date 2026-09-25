"""
preview_sheet.py -- contact sheet (and optional flip-book) of a rendered frame folder: previews or masters (plain
Python: numpy + Pillow).

  python hero/preview_sheet.py --seq C:/Users/frank/solidify-hero-out/v4/preview_slice
      [--out <seq>/contact_sheet.png] [--frames all | spread:36 | 0-229/8,300] [--cols 6] [--tile 300]
      [--anim <seq>/flipbook.webp [--anim-frames all] --anim-size 360 --fps 24]

Each transparent frame is composited onto the page colour #0a0a0a and labelled with its index, chapter, growth time t
and the camera's cumulative turn (degrees of view direction since frame 0, summed from path.json's per-frame 'turn'),
so the sheet shows how the growth reads and how far the camera has travelled between tiles. A header line gives the
folder, the frame count, the render settings from frames.json and the mean mesh / render seconds per frame. --anim
writes the --anim-frames (default every frame present), in order, as an animated WebP (a quick feel for the motion; a
scroll preview in the page is the real test).
"""
import argparse
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import path_plan as PP   # noqa: E402

PAGE_BG = (0x0A, 0x0A, 0x0A)
DEFAULT_PATH = 'C:/Users/frank/solidify-hero-out/v4/path.json'


def font(size):
    for name in ('arial.ttf', 'DejaVuSans.ttf', 'segoeui.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def on_page(path, size=None):
    """the RGBA frame composited onto the page colour (straight alpha), optionally resized (square)."""
    im = Image.open(path).convert('RGBA')
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    bg = Image.new('RGBA', im.size, PAGE_BG + (255,))
    return Image.alpha_composite(bg, im).convert('RGB')


def present_frames(seq):
    out = []
    for fn in os.listdir(seq):
        m = re.fullmatch(r'f(\d{3,4})\.png', fn)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def select(spec, have, n_total):
    if spec in ('', 'all'):
        return have
    if spec.startswith('spread:'):
        k = max(2, int(spec.split(':', 1)[1]))
        if len(have) <= k:
            return have
        idx = sorted({int(round(i * (len(have) - 1) / float(k - 1))) for i in range(k)})
        return [have[i] for i in idx]
    want = set()
    for part in spec.split(','):
        part = part.strip()
        if not part:
            continue
        step = 1
        if '/' in part:
            part, step = part.split('/')
            step = int(step)
        if '-' in part:
            a, b = part.split('-')
            want.update(range(int(a), int(b) + 1, step))
        else:
            want.add(int(part))
    return [f for f in have if f in want and f < n_total]


def cumulative_turn(path_json):
    if not path_json or not os.path.isfile(path_json):
        return None
    with open(path_json) as fh:
        frames = json.load(fh)['frames']
    return np.cumsum([0.0] + [float(r.get('turn', 0.0)) for r in frames[1:]])


def main(argv):
    p = argparse.ArgumentParser(description='contact sheet / flip-book of a rendered hero frame folder')
    p.add_argument('--seq', required=True, help='folder with f000.png .. (and frames.json)')
    p.add_argument('--out', default=None, help='sheet path (default <seq>/contact_sheet.png)')
    p.add_argument('--frames', default='all', help='all, spread:36, or a list like 0-229/8,300,725')
    p.add_argument('--cols', type=int, default=6)
    p.add_argument('--tile', type=int, default=300)
    p.add_argument('--path', default=DEFAULT_PATH, help='path.json for the cumulative turn labels')
    p.add_argument('--timeline', default=None, help='default hero/timeline.json')
    p.add_argument('--anim', default='', help='also write an animated WebP here')
    p.add_argument('--anim-frames', default='all', help='frames of the flip-book (same syntax as --frames)')
    p.add_argument('--anim-size', type=int, default=360)
    p.add_argument('--fps', type=float, default=24.0)
    A = p.parse_args(argv)

    TL = PP.load_timeline(A.timeline)
    N = PP.n_frames(TL)
    have = present_frames(A.seq)
    if not have:
        raise SystemExit('no f###.png in %s' % A.seq)
    frames = select(A.frames, have, N)
    meta, recs = {}, {}
    fj = os.path.join(A.seq, 'frames.json')
    if os.path.isfile(fj):
        with open(fj) as fh:
            d = json.load(fh)
        meta, recs = d.get('meta', {}), d.get('frames', {})
    turn = cumulative_turn(A.path)

    tile, cols = A.tile, A.cols
    rows = (len(frames) + cols - 1) // cols
    head, lab = 44, 22
    sheet = Image.new('RGB', (cols * tile, head + rows * (tile + lab)), PAGE_BG)
    dr = ImageDraw.Draw(sheet)
    f_small, f_head = font(13), font(15)
    ms = [recs.get(str(f), {}).get('mesh_seconds', recs.get(str(f), {}).get('build_seconds')) for f in frames]
    rs = [recs.get(str(f), {}).get('render_seconds') for f in frames]
    ms = [x for x in ms if x is not None]
    rs = [x for x in rs if x is not None]
    dr.text((8, 5), '%s  |  %d of %d frames  |  %s %s px, %s samples' % (
        A.seq, len(frames), N, meta.get('engine', '?'), meta.get('res', '?'), meta.get('samples', '?')),
        fill=(210, 212, 216), font=f_head)
    dr.text((8, 24), 'mean per frame: mesh %.2f s, render %.2f s   |   label: frame  chapter  t  cumulative turn' % (
        float(np.mean(ms)) if ms else float('nan'), float(np.mean(rs)) if rs else float('nan')),
        fill=(150, 152, 158), font=f_small)
    for k, f in enumerate(frames):
        r, c = divmod(k, cols)
        x, y = c * tile, head + r * (tile + lab)
        sheet.paste(on_page(os.path.join(A.seq, 'f%03d.png' % f), tile), (x, y))
        t = PP.t_of(TL, f)
        txt = 'f%03d  %s  t %.3f' % (f, PP.chapter_of(TL, f), t)
        if turn is not None and f < len(turn):
            txt += '  %.0f deg' % turn[f]
        dr.text((x + 6, y + tile + 3), txt, fill=(200, 202, 206), font=f_small)
    out = A.out or os.path.join(A.seq, 'contact_sheet.png')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out, optimize=True)
    print('[sheet] %d frames -> %s (%dx%d)' % (len(frames), out, sheet.size[0], sheet.size[1]))
    if A.anim:
        ims = [on_page(os.path.join(A.seq, 'f%03d.png' % f), A.anim_size) for f in select(A.anim_frames, have, N)]
        ims[0].save(A.anim, save_all=True, append_images=ims[1:], duration=int(round(1000.0 / A.fps)), loop=0,
                    quality=70, method=4)
        print('[sheet] flip-book of %d frames at %.0f fps -> %s (%.1f MB)' % (
            len(ims), A.fps, A.anim, os.path.getsize(A.anim) / 1e6))


if __name__ == '__main__':
    main(sys.argv[1:])
