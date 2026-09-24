"""
encode_frames.py -- turn the transparent Cycles masters of render_sequence.py into the frame set the landing
page scrubs (plain python + Pillow + numpy; no Blender).

  python hero/encode_frames.py [--seq C:/Users/frank/solidify-hero-out/v3/seq] [--out C:/Users/frank/solidify/public/hero]
      [--quality 76] [--min-quality 66] [--poster N] [--contact-sheet C:/Users/frank/solidify-hero-out/v3/contact_sheet.png]
      [--contact-only [--from-masters]] [--tile 360] [--cols 6]

Per frame: straight-alpha 'over' onto #0a0b0d in display (sRGB-encoded) space, exactly as a browser would composite
the transparent PNG. Nothing else: round 4 has no emission and no bloom (the judge rounds rejected every glow), so the
composite is the render. Then the 1200 set (as rendered) and the 600 set (Lanczos) as OPAQUE lossy WebP. Quality
starts at --quality and steps down (never below --min-quality) until each set fits its budget (12 MiB / 3.5 MiB).
The poster is the tour frame frames.json names (all five features visible), encoded on its own. manifest.json is
written to the contract (README.md; scripts/verify-hero-manifest.mjs checks it), with the anchors render_sequence.py
measured; its `source` names the generator, so the PLACEHOLDER notice the page's gate raised goes away with it.
--contact-sheet draws every 6th SHIPPED frame (the 1200 WebP, not the master) with its anchors and index, which is how
the set is checked by eye; --contact-only --from-masters tiles whatever masters exist in --seq (a smoke test or a
partial render) with the anchors of its frames.json.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

N_FRAMES = 180
SIZES = (1200, 600)
BG = (0x0A, 0x0B, 0x0D)
BUDGET = {1200: 12 * 1024 * 1024, 600: int(3.5 * 1024 * 1024)}
POSTER_MAX = 400 * 1024
CHAPTERS = [{'id': 'seed', 'from': 0, 'to': 11}, {'id': 'grow', 'from': 12, 'to': 95},
            {'id': 'cool', 'from': 96, 'to': 119}, {'id': 'tour', 'from': 120, 'to': 179}]
FEATURES = [{'id': 'tip', 'kind': 'point', 'from': 122, 'to': 133}, {'id': 'primary', 'kind': 'pair', 'from': 134, 'to': 145},
            {'id': 'lambda2', 'kind': 'pair', 'from': 146, 'to': 157}, {'id': 'tertiary', 'kind': 'point', 'from': 158, 'to': 167},
            {'id': 'neck', 'kind': 'point', 'from': 168, 'to': 179}]
COLORS = {'tip': (80, 220, 255), 'primary': (255, 90, 220), 'lambda2': (190, 255, 90), 'tertiary': (255, 170, 60),
          'neck': (255, 255, 255)}
DEFAULT_SEQ = 'C:/Users/frank/solidify-hero-out/v3/seq'
DEFAULT_OUT = 'C:/Users/frank/solidify/public/hero'
DEFAULT_SHEET = 'C:/Users/frank/solidify-hero-out/v3/contact_sheet.png'


def composite(master_path):
    """RGBA master -> opaque RGB uint8 on the page color (straight-alpha over in display space, as a browser does)."""
    im = Image.open(master_path).convert('RGBA')
    base = Image.new('RGBA', im.size, BG + (255,))
    return Image.alpha_composite(base, im).convert('RGB')


# ---- encoding ------------------------------------------------------------------------------------
def save_webp(im, path, q):
    im.save(path, 'WEBP', quality=int(q), method=6)
    return os.path.getsize(path)


def encode_set(images, out_dir, q):
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for i, im in enumerate(images):
        total += save_webp(im, os.path.join(out_dir, 'f%03d.webp' % i), q)
    return total


def clean_dir(out_dir):
    """the frame directories may hold nothing but f000..f179.webp (HERO-FILES): drop anything else."""
    if not os.path.isdir(out_dir):
        return
    for fn in os.listdir(out_dir):
        if not (fn.startswith('f') and fn.endswith('.webp') and len(fn) == 9 and fn[1:4].isdigit()):
            os.remove(os.path.join(out_dir, fn))


def load_seq(seq):
    fpath = os.path.join(seq, 'frames.json')
    if not os.path.isfile(fpath):
        raise SystemExit('missing %s (run render_sequence.py first)' % fpath)
    with open(fpath) as fh:
        data = json.load(fh)
    missing = [i for i in range(N_FRAMES) if not os.path.isfile(os.path.join(seq, 'f%03d.png' % i))]
    noanch = [i for i in range(N_FRAMES) if 'anchors' not in data['frames'].get(str(i), {})]
    if missing:
        raise SystemExit('%d masters missing in %s: %s%s' % (len(missing), seq, missing[:10], ' ...' if len(missing) > 10 else ''))
    if noanch:
        raise SystemExit('%d frames have no anchors in frames.json (run render_sequence.py --anchors-only): %s' % (len(noanch), noanch[:10]))
    return data


def build_manifest(data, poster_frame, samples, seed, blender):
    anchors = {}
    for f in FEATURES:
        rows = []
        for i in range(N_FRAMES):
            row = data['frames'][str(i)]['anchors'][f['id']]
            rows.append([round(float(v), 5) for v in row[:-1]] + [int(row[-1])])
        anchors[f['id']] = rows
    poster = {'frame': int(poster_frame), 'anchors': {f['id']: anchors[f['id']][poster_frame] for f in FEATURES}}
    return {
        'version': 1, 'frames': N_FRAMES, 'pattern': 'f{i:03d}.webp', 'sizes': list(SIZES), 'background': '#0a0b0d',
        'chapters': CHAPTERS, 'features': FEATURES, 'anchors': anchors, 'poster': poster,
        'source': 'hero/dendrite_gen.py seed %s, Blender %s Cycles, %s spp, satin steel (no emission)' % (
            seed, str(blender).replace(' LTS', ''), samples),
    }


# ---- contact sheet -------------------------------------------------------------------------------
def contact_sheet(out_hero, manifest, sheet_path, step=6, tile=360, cols=6, frames=None, loader=None):
    """every `step`-th shipped frame (or the given frames, through `loader(i) -> RGB image`) with its anchors."""
    if frames is None:
        frames = list(range(0, N_FRAMES, step))
        if N_FRAMES - 1 not in frames:
            frames.append(N_FRAMES - 1)
    if loader is None:
        loader = lambda i: Image.open(os.path.join(out_hero, '1200', 'f%03d.webp' % i)).convert('RGB')
    cols = max(1, min(cols, len(frames)))
    rows = int(math.ceil(len(frames) / float(cols)))
    pad = 6
    W = cols * (tile + pad) + pad
    H = rows * (tile + pad + 18) + pad + 20
    sheet = Image.new('RGB', (W, H), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('arial.ttf', 15)
        font_b = ImageFont.truetype('arialbd.ttf', 15)
    except Exception:  # noqa
        font = font_b = ImageFont.load_default()
    chap = {i: c['id'] for c in CHAPTERS for i in range(c['from'], c['to'] + 1)}
    win = {i: f['id'] for f in FEATURES for i in range(f['from'], f['to'] + 1)}
    for n, i in enumerate(frames):
        r, c = divmod(n, cols)
        x0 = pad + c * (tile + pad)
        y0 = pad + r * (tile + pad + 18)
        im = loader(i).resize((tile, tile), Image.LANCZOS)
        sheet.paste(im, (x0, y0))
        d = ImageDraw.Draw(sheet)
        for f in FEATURES:
            row = manifest['anchors'][f['id']][i]
            vis = row[-1] == 1
            pts = [(x0 + row[k] * tile, y0 + row[k + 1] * tile) for k in range(0, len(row) - 1, 2)]
            col = COLORS[f['id']]
            active = f['from'] <= i <= f['to']
            rad = 6 if active else 4
            if len(pts) == 2:
                d.line([pts[0], pts[1]], fill=col if vis else tuple(v // 3 for v in col), width=3 if active else 1)
            for p in pts:
                box = [p[0] - rad, p[1] - rad, p[0] + rad, p[1] + rad]
                if vis:
                    d.ellipse(box, fill=col, outline=(0, 0, 0))
                else:
                    d.ellipse(box, outline=col, width=2)
        label = 'f%03d  %s' % (i, chap[i]) + ('  [%s]' % win[i] if i in win else '')
        d.rectangle([x0, y0 + tile, x0 + tile, y0 + tile + 18], fill=(24, 24, 28))
        d.text((x0 + 4, y0 + tile + 1), label, fill=(235, 235, 235), font=font_b if i in win else font)
    # legend
    legend = '  '.join('%s = %s' % (f['id'], 'pair' if f['kind'] == 'pair' else 'point') for f in FEATURES)
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, H - 18), 'filled = visible, hollow = occluded / off frame; bold label = inside a feature window;  ' + legend,
              fill=(200, 200, 200), font=font)
    sheet.save(sheet_path, optimize=True)
    return sheet_path, len(frames)


# ---- main ----------------------------------------------------------------------------------------
def parse_args(argv):
    p = argparse.ArgumentParser(description='SOLIDIFY hero: composite + WebP frame set + manifest')
    p.add_argument('--seq', default=DEFAULT_SEQ)
    p.add_argument('--out', default=DEFAULT_OUT)
    p.add_argument('--quality', type=int, default=76)
    p.add_argument('--min-quality', type=int, default=66)
    p.add_argument('--poster', type=int, default=None, help='poster frame (default: frames.json meta.poster_frame)')
    p.add_argument('--contact-sheet', default=DEFAULT_SHEET)
    p.add_argument('--contact-only', action='store_true', help='only redraw the contact sheet from the shipped set')
    p.add_argument('--from-masters', action='store_true',
                   help='with --contact-only: tile the masters present in --seq (composited) with the anchors of its '
                        'frames.json; for checking a smoke test or a partial render')
    p.add_argument('--tile', type=int, default=360)
    p.add_argument('--cols', type=int, default=6)
    return p.parse_args(argv)


def main(argv):
    A = parse_args(argv)
    t0 = time.perf_counter()
    if A.contact_only and A.from_masters:
        with open(os.path.join(A.seq, 'frames.json')) as fh:
            data = json.load(fh)
        have = sorted(int(fn[1:4]) for fn in os.listdir(A.seq) if fn.startswith('f') and fn.endswith('.png') and len(fn) == 8)
        have = [i for i in have if 'anchors' in data['frames'].get(str(i), {})]
        m = {'anchors': {f['id']: [data['frames'][str(i)]['anchors'][f['id']] if str(i) in data['frames'] and 'anchors' in data['frames'][str(i)]
                                    else [0, 0, 0] for i in range(N_FRAMES)] for f in FEATURES}}
        loader = lambda i: composite(os.path.join(A.seq, 'f%03d.png' % i))
        path, n = contact_sheet(A.out, m, A.contact_sheet, frames=have, loader=loader, tile=A.tile, cols=A.cols)
        print('[encode] contact sheet from %d masters -> %s' % (n, path))
        return 0
    if A.contact_only:
        with open(os.path.join(A.out, 'manifest.json')) as fh:
            m = json.load(fh)
        path, n = contact_sheet(A.out, m, A.contact_sheet, tile=A.tile, cols=A.cols)
        print('[encode] contact sheet (%d frames) -> %s' % (n, path))
        return 0
    data = load_seq(A.seq)
    meta = data['meta']
    poster_frame = A.poster if A.poster is not None else meta.get('poster_frame')
    if poster_frame is None:
        raise SystemExit('no poster frame: frames.json meta.poster_frame is null (no tour frame has all five features visible)')
    pf = data['frames'][str(poster_frame)]['anchors']
    hidden = [k for k, v in pf.items() if v[-1] != 1]
    if hidden:
        raise SystemExit('poster frame %d has occluded features: %s' % (poster_frame, hidden))

    # composites
    print('[encode] compositing %d masters from %s' % (N_FRAMES, A.seq))
    imgs = []
    for i in range(N_FRAMES):
        imgs.append(composite(os.path.join(A.seq, 'f%03d.png' % i)))
        if i % 30 == 29:
            print('[encode]   %d/%d  (%.0fs)' % (i + 1, N_FRAMES, time.perf_counter() - t0))
            sys.stdout.flush()
    if imgs[0].size != (1200, 1200):
        print('[encode] WARNING: masters are %dx%d, not 1200x1200; the 1200 set is resampled' % imgs[0].size)
        imgs = [im.resize((1200, 1200), Image.LANCZOS) for im in imgs]
    sets = {1200: imgs, 600: [im.resize((600, 600), Image.LANCZOS) for im in imgs]}

    # encode within budget
    report = {'quality': {}, 'bytes': {}, 'poster_frame': int(poster_frame)}
    for size in SIZES:
        out_dir = os.path.join(A.out, str(size))
        clean_dir(out_dir)
        q = A.quality
        while True:
            total = encode_set(sets[size], out_dir, q)
            print('[encode] %d set at q%d: %.2f MiB (budget %.2f)' % (size, q, total / 1048576.0, BUDGET[size] / 1048576.0))
            sys.stdout.flush()
            if total <= BUDGET[size] or q <= A.min_quality:
                break
            q -= 2
        report['quality'][size] = q
        report['bytes'][size] = total
        if total > BUDGET[size]:
            print('[encode] WARNING: %d set is over budget at the minimum quality' % size)

    # posters
    for size in SIZES:
        path = os.path.join(A.out, 'poster-%d.webp' % size)
        q = min(84, report['quality'][size] + 8)
        n = save_webp(sets[size][poster_frame], path, q)
        while n > POSTER_MAX and q > A.min_quality:
            q -= 4
            n = save_webp(sets[size][poster_frame], path, q)
        report['bytes']['poster-%d' % size] = n
        print('[encode] poster-%d (frame %d) q%d: %.0f KiB' % (size, poster_frame, q, n / 1024.0))

    # manifest
    m = build_manifest(data, poster_frame, meta.get('samples', '?'), meta.get('seed', '?'), meta.get('blender', '4.5.11'))
    with open(os.path.join(A.out, 'manifest.json'), 'w') as fh:
        json.dump(m, fh, separators=(',', ':'))
    print('[encode] manifest -> %s  (%s)' % (os.path.join(A.out, 'manifest.json'), m['source']))
    path, n = contact_sheet(A.out, m, A.contact_sheet, tile=A.tile, cols=A.cols)
    print('[encode] contact sheet (%d frames) -> %s' % (n, path))
    with open(os.path.join(A.seq, 'encode_report.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
    print('[encode] done in %.0fs: 1200 set %.2f MiB (q%d), 600 set %.2f MiB (q%d), posters %.0f / %.0f KiB' % (
        time.perf_counter() - t0, report['bytes'][1200] / 1048576.0, report['quality'][1200],
        report['bytes'][600] / 1048576.0, report['quality'][600],
        report['bytes']['poster-1200'] / 1024.0, report['bytes']['poster-600'] / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
