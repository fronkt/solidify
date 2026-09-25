"""
encode_frames.py -- turn the transparent Cycles masters of render_sequence.py into the frame set the landing
page scrubs (plain python + Pillow + numpy; no Blender).

  python hero/encode_frames.py [--seq C:/Users/frank/solidify-hero-out/v4/seq]
      [--out C:/Users/frank/solidify-hero-out/v4/public_hero] [--timeline hero/timeline.json]
      [--quality 76] [--min-quality 66] [--poster N]
      [--contact-sheet C:/Users/frank/solidify-hero-out/v4/contact_sheet.png] [--contact-only [--from-masters]]
      [--tile 360] [--cols 6] [--step K]

The frame set is the timeline (read through path_plan.load_timeline; default hero/timeline.json, loaded when main
runs, so an unreadable default never stops a run that passes --timeline): N frames, the chapters, the feature windows
(with their holds and label sides), px_per_frame, the poster frame and the byte budgets (timeline.budget_bytes).
hero/timeline_v3.json describes the shipped v3 set (180 frames), so the v3 masters still encode:
  python hero/encode_frames.py --timeline hero/timeline_v3.json --seq C:/Users/frank/solidify-hero-out/v3/seq --out <dir>
Per frame: straight-alpha 'over' onto #0a0a0a in display (sRGB-encoded) space, exactly as a browser would composite
the transparent PNG. Nothing else: round 4 has no emission and no bloom (the judge rounds rejected every glow), so the
composite is the render. Then the 1200 set (as rendered) and the 600 set (Lanczos) as OPAQUE lossy WebP. Quality
starts at --quality and steps down (never below --min-quality) until each set fits its budget (timeline.budget_bytes;
v3's per-frame budget x N when the timeline gives none). The poster is the timeline's poster frame (v4: the last frame,
the pull-back's end pose; all five features must be visible on it), encoded on its own.
manifest.json follows the timeline's version: a v4 timeline writes manifest version 2 (v1's fields plus px_per_frame
and hold_px, and each feature carries its hold and label side), an older one version 1 exactly as shipped with v3. The
anchors are the ones render_sequence.py measured; `source` names the generator.
Refuses to encode when frames.json was rendered for another frame count, when a master is missing, when a frame has no
anchors, when any rendered frame's mesh failed the topology gate (frames.json 'gate' != 'PASS'), or when the poster has
an occluded feature.
Writing: everything is encoded into a staging folder beside --out, then swapped in (the old 1200 / 600 folders are
renamed aside, the new ones renamed in, the posters replaced, manifest.json LAST), so an interrupted encode never
leaves a half old, half new set; the frame folders hold f000.webp .. f{N-1}.webp and nothing else.
The default --out is a staging folder under v4/ (the page's public/hero is written only when --out names it, once the
page and its gates read the v4 contract).
The encode report (qualities, bytes, budgets) goes beside the contact sheet (<sheet>_encode_report.json); nothing is
written into --seq, so the masters stay as rendered.
--contact-sheet draws every K-th SHIPPED frame (the 1200 WebP, not the master; K = --step, default about N / 36) with its
anchors and index, which is how the set is checked by eye; --contact-only --from-masters tiles whatever masters exist
in --seq (a smoke test, a preview or a partial render) with the anchors of its frames.json where it has them.
"""
import argparse
import json
import math
import os
import shutil
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import path_plan as PP  # noqa: E402  (timeline reader; numpy only)

SIZES = (1200, 600)
BG = (0x0A, 0x0A, 0x0A)
TL = None
N_FRAMES = 0
CHAPTERS = []
FEATURES = []
BUDGET = {}
COLORS = {'tip': (80, 220, 255), 'primary': (255, 90, 220), 'lambda2': (190, 255, 90), 'tertiary': (255, 170, 60),
          'neck': (255, 255, 255)}
DEFAULT_SEQ = 'C:/Users/frank/solidify-hero-out/v4/seq'
DEFAULT_OUT = 'C:/Users/frank/solidify-hero-out/v4/public_hero'
DEFAULT_SHEET = 'C:/Users/frank/solidify-hero-out/v4/contact_sheet.png'


def use_timeline(tl):
    """this module's frame set from timeline `tl`."""
    global TL, N_FRAMES, CHAPTERS, FEATURES, BUDGET
    TL = tl
    N_FRAMES = PP.n_frames(tl)
    CHAPTERS = [{'id': c['id'], 'from': int(c['from']), 'to': int(c['to'])} for c in tl['chapters']]
    FEATURES = []
    for f in tl['features']:
        fe = {'id': f['id'], 'kind': f['kind'], 'from': int(f['from']), 'to': int(f['to'])}
        if 'hold' in f:
            fe['hold'] = list(f['hold'])
        if f.get('label') is not None:
            fe['label'] = f['label']
        FEATURES.append(fe)
    BUDGET = {s: PP.budget_bytes(tl, s) for s in SIZES + ('poster',)}


def manifest_version():
    return 2 if int(TL.get('version', 4)) >= 4 else 1


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


def clean_dir(out_dir, n=None):
    """a frame directory may hold nothing but the set's f000.webp .. f{n-1}.webp (HERO-FILES): drop anything else,
    frames of a longer earlier set included."""
    n = N_FRAMES if n is None else n
    if not os.path.isdir(out_dir):
        return
    for fn in os.listdir(out_dir):
        ok = fn.startswith('f') and fn.endswith('.webp') and len(fn) == 9 and fn[1:4].isdigit() and int(fn[1:4]) < n
        if not ok:
            os.remove(os.path.join(out_dir, fn))


def load_seq(seq):
    fpath = os.path.join(seq, 'frames.json')
    if not os.path.isfile(fpath):
        raise SystemExit('missing %s (run render_sequence.py first)' % fpath)
    with open(fpath) as fh:
        data = json.load(fh)
    n_meta = data.get('meta', {}).get('frames')
    n_rec = len(data.get('frames', {}))
    n_seq = int(n_meta) if n_meta is not None else n_rec
    if n_seq != N_FRAMES:
        raise SystemExit('%s describes %d frames (%s), the timeline %s has %d: pass the timeline it was rendered for '
                         '(the v3 masters: --timeline hero/timeline_v3.json)' % (
                             fpath, n_seq, 'meta.frames' if n_meta is not None else 'frame records', TL['_path'], N_FRAMES))
    missing = [i for i in range(N_FRAMES) if not os.path.isfile(os.path.join(seq, 'f%03d.png' % i))]
    noanch = [i for i in range(N_FRAMES) if 'anchors' not in data['frames'].get(str(i), {})]
    badgate = [i for i in range(N_FRAMES) if data['frames'].get(str(i), {}).get('gate') != 'PASS']
    if missing:
        raise SystemExit('%d masters missing in %s: %s%s' % (len(missing), seq, missing[:10], ' ...' if len(missing) > 10 else ''))
    if noanch:
        raise SystemExit('%d frames have no anchors in frames.json (run render_sequence.py --anchors-only): %s' % (len(noanch), noanch[:10]))
    if badgate:
        raise SystemExit('%d frames were rendered from a mesh that failed the topology gate or carry no gate record: %s' % (
            len(badgate), badgate[:10]))
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
    source = 'hero/dendrite_gen.py seed %s, Blender %s Cycles, %s spp, satin steel (no emission)' % (
        seed, str(blender).replace(' LTS', ''), samples)
    if manifest_version() == 1:            # v3's contract, exactly as shipped
        feats = [{k: f[k] for k in ('id', 'kind', 'from', 'to')} for f in FEATURES]
        return {'version': 1, 'frames': N_FRAMES, 'pattern': 'f{i:03d}.webp', 'sizes': list(SIZES),
                'background': '#0a0a0a', 'chapters': CHAPTERS, 'features': feats, 'anchors': anchors, 'poster': poster,
                'source': source}
    return {
        'version': 2, 'frames': N_FRAMES, 'px_per_frame': TL['px_per_frame'], 'hold_px': TL['hold_px'],
        'pattern': 'f{i:03d}.webp', 'sizes': list(SIZES), 'background': '#0a0a0a',
        'chapters': CHAPTERS, 'features': FEATURES, 'anchors': anchors, 'poster': poster, 'source': source,
    }


def swap_in(stage, out):
    """move the staged set into `out`: each frame folder renamed in (the old one renamed aside first, then deleted),
    the posters replaced, manifest.json last."""
    os.makedirs(out, exist_ok=True)
    olds = []
    for size in SIZES:
        dst = os.path.join(out, str(size))
        if os.path.isdir(dst):
            old = os.path.join(out, '.old-%d-%d' % (os.getpid(), size))
            os.rename(dst, old)
            olds.append(old)
        os.rename(os.path.join(stage, str(size)), dst)
    for fn in sorted(os.listdir(stage)):
        if fn.startswith('poster-'):
            os.replace(os.path.join(stage, fn), os.path.join(out, fn))
    os.replace(os.path.join(stage, 'manifest.json'), os.path.join(out, 'manifest.json'))
    for old in olds:
        shutil.rmtree(old, ignore_errors=True)
    shutil.rmtree(stage, ignore_errors=True)


# ---- contact sheet -------------------------------------------------------------------------------
def contact_sheet(out_hero, manifest, sheet_path, step=None, tile=360, cols=6, frames=None, loader=None):
    """every `step`-th shipped frame (or the given frames, through `loader(i) -> RGB image`) with its anchors."""
    if step is None:
        step = max(1, int(round(N_FRAMES / 36.0)))
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
            if len(row) < 3:              # a preview frame without an anchor pass: no marks
                continue
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
    p.add_argument('--out', default=DEFAULT_OUT, help='the frame set folder (default a staging folder under v4/; '
                                                      'public/hero only once the page reads the v4 contract)')
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
    p.add_argument('--step', type=int, default=None, help='contact sheet: every K-th frame (default ~N/36)')
    p.add_argument('--timeline', default=None, help='default hero/timeline.json')
    return p.parse_args(argv)


def main(argv):
    A = parse_args(argv)
    use_timeline(PP.load_timeline(A.timeline))
    t0 = time.perf_counter()
    if A.contact_only and A.from_masters:
        with open(os.path.join(A.seq, 'frames.json')) as fh:
            data = json.load(fh)
        have = sorted(int(fn[1:4]) for fn in os.listdir(A.seq) if fn.startswith('f') and fn.endswith('.png') and len(fn) == 8)
        have = [i for i in have if i < N_FRAMES]
        fr = data.get('frames', {})
        m = {'anchors': {f['id']: [fr[str(i)]['anchors'][f['id']] if 'anchors' in fr.get(str(i), {}) else []
                                   for i in range(N_FRAMES)] for f in FEATURES}}
        loader = lambda i: composite(os.path.join(A.seq, 'f%03d.png' % i))
        path, n = contact_sheet(A.out, m, A.contact_sheet, frames=have, loader=loader, tile=A.tile, cols=A.cols)
        print('[encode] contact sheet from %d masters -> %s' % (n, path))
        return 0
    if A.contact_only:
        with open(os.path.join(A.out, 'manifest.json')) as fh:
            m = json.load(fh)
        path, n = contact_sheet(A.out, m, A.contact_sheet, step=A.step, tile=A.tile, cols=A.cols)
        print('[encode] contact sheet (%d frames) -> %s' % (n, path))
        return 0
    data = load_seq(A.seq)
    meta = data['meta']
    poster_frame = A.poster if A.poster is not None else meta.get('poster_frame', TL['poster'])
    if poster_frame is None:
        raise SystemExit('no poster frame: frames.json meta.poster_frame is null')
    pf = data['frames'][str(poster_frame)]['anchors']
    hidden = [k for k, v in pf.items() if v[-1] != 1]
    if hidden:
        raise SystemExit('poster frame %d has occluded features: %s' % (poster_frame, hidden))

    # composites
    print('[encode] compositing %d masters from %s (timeline %s, manifest version %d)' % (
        N_FRAMES, A.seq, TL['_path'], manifest_version()))
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

    # encode within budget, into a staging folder beside --out
    out = os.path.abspath(A.out)
    stage = os.path.join(os.path.dirname(out), '.%s.staging-%d' % (os.path.basename(out), os.getpid()))
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    report = {'quality': {}, 'bytes': {}, 'budget': {str(k): v for k, v in BUDGET.items()}, 'poster_frame': int(poster_frame)}
    for size in SIZES:
        out_dir = os.path.join(stage, str(size))
        q = A.quality
        while True:
            clean_dir(out_dir)
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
        path = os.path.join(stage, 'poster-%d.webp' % size)
        q = min(84, report['quality'][size] + 8)
        n = save_webp(sets[size][poster_frame], path, q)
        while n > BUDGET['poster'] and q > A.min_quality:
            q -= 4
            n = save_webp(sets[size][poster_frame], path, q)
        report['bytes']['poster-%d' % size] = n
        print('[encode] poster-%d (frame %d) q%d: %.0f KiB' % (size, poster_frame, q, n / 1024.0))

    # manifest (last), then the swap
    m = build_manifest(data, poster_frame, meta.get('samples', '?'), meta.get('seed', '?'), meta.get('blender', '4.5.11'))
    with open(os.path.join(stage, 'manifest.json'), 'w') as fh:
        json.dump(m, fh, separators=(',', ':'))
    swap_in(stage, out)
    print('[encode] set -> %s (manifest version %d: %s)' % (out, m['version'], m['source']))
    path, n = contact_sheet(out, m, A.contact_sheet, step=A.step, tile=A.tile, cols=A.cols)
    print('[encode] contact sheet (%d frames) -> %s' % (n, path))
    rp = os.path.splitext(A.contact_sheet)[0] + '_encode_report.json'      # beside the sheet: never into the masters
    with open(rp, 'w') as fh:
        json.dump(report, fh, indent=1)
    print('[encode] done in %.0fs: 1200 set %.2f MiB (q%d), 600 set %.2f MiB (q%d), posters %.0f / %.0f KiB' % (
        time.perf_counter() - t0, report['bytes'][1200] / 1048576.0, report['quality'][1200],
        report['bytes'][600] / 1048576.0, report['quality'][600],
        report['bytes']['poster-1200'] / 1024.0, report['bytes']['poster-600'] / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
