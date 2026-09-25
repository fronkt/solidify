"""
motion_check.py -- the planner's screen-motion measure against the rendered meshes themselves (plain Python: numpy;
no Blender): for chosen frames of path.json, the p90 point motion of the step into that frame measured on EVERY vertex
of the cached mesh the frame renders (the growth mesh at its t, or the close-up mesh), next to the planner's number.

  python hero/motion_check.py [--path <v4>/path.json] [--cache <v4>/cache/mesh] [--frames 1,60,...|auto]
      [--out <v4>/motion_check.json]

Growth frames need their mesh in the cache (render_sequence.py --cache-only); the frame before is taken as the same
mesh scaled by e(t_f-1) / e(t_f), the planner's own growth model. 'auto' = every growth frame whose mesh is cached plus
40 frozen frames spread over the cool, tour and pull-back chapters.
"""
import argparse
import glob
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import path_plan as PP  # noqa: E402


def cam_of(rec, res=1200):
    return PP.Cam(np.asarray(rec['forward']), np.asarray(rec['right']), np.asarray(rec['up']), rec['target'],
                  rec['width'], rec['lens'], res)


def p90(pts0, pts1, c0, c1, R=1200):
    a, oka = c0.project(pts0)
    b, okb = c1.project(pts1)
    ina = oka & (a[:, 0] >= 0) & (a[:, 0] <= R) & (a[:, 1] >= 0) & (a[:, 1] <= R)
    inb = okb & (b[:, 0] >= 0) & (b[:, 0] <= R) & (b[:, 1] >= 0) & (b[:, 1] <= R)
    m = (ina | inb) & oka & okb
    if m.sum() < 20:
        return None, int(m.sum())
    return float(np.percentile(np.hypot(*(b[m] - a[m]).T), 90)), int(m.sum())


def main(argv=None):
    p = argparse.ArgumentParser(description='the planner\'s p90 screen motion vs the rendered meshes')
    p.add_argument('--path', default=PP.OUT_DEFAULT + '/path.json')
    p.add_argument('--cache', default=PP.MESH_CACHE_DEFAULT)
    p.add_argument('--frames', default='auto')
    p.add_argument('--out', default=PP.OUT_DEFAULT + '/motion_check.json')
    A = p.parse_args(sys.argv[1:] if argv is None else argv)
    data = PP.load_path(A.path)
    meta, recs = data['meta'], data['frames']
    TL = PP.load_timeline(meta['timeline'])
    F = meta['features']
    mesh_key = F.get('mesh_key')
    fine_fp = None
    gen = {}
    for fp in glob.glob(os.path.join(A.cache, '*', '*.npz')):
        try:
            with np.load(fp, allow_pickle=False) as z:
                m = json.loads(str(z['meta']))
                key = str(z['key'])
        except Exception:  # noqa
            continue
        if m.get('kind') == 'fine' and key == mesh_key:
            fine_fp = fp
        elif m.get('kind') == 'gen':
            gen[round(float(m['t']), 9)] = fp
    G = int(TL['growth']['to'])
    if A.frames == 'auto':
        frames = [f for f in range(1, G) if round(PP.t_of(TL, f), 9) in gen]
        N = PP.n_frames(TL)
        frames += sorted({int(round(G + 1 + k * (N - 2 - G) / 39.0)) for k in range(40)})
    else:
        frames = [int(x) for x in A.frames.split(',')]
    DG = PP.import_generator()
    GA = PP.gen_args(DG, 7)
    nuc = lambda t: float(DG.nucleus_radius(GA, t))
    L1 = float(F['L1'])

    def extent(t):
        return 2.0 * ((L1 * t) ** 6 + (1.05 * nuc(t)) ** 6) ** (1.0 / 6.0)
    fine = None
    rows = []
    for f in frames:
        rec, rp = recs[f], recs[f - 1]
        c0, c1 = cam_of(rp), cam_of(rec)
        t1, t0 = PP.t_of(TL, f), PP.t_of(TL, f - 1)
        if PP.frozen(TL, f) and PP.frozen(TL, f - 1):
            if fine is None:
                if fine_fp is None:
                    print('[motion] no cached close-up mesh with key %s' % mesh_key)
                    continue
                with np.load(fine_fp) as z:
                    fine = z['co'].reshape(-1, 3).astype(np.float64)
            v0 = v1 = fine
            src = 'close-up mesh (%d vertices)' % len(fine)
        else:
            fp = gen.get(round(t1, 9))
            if fp is None:
                continue
            with np.load(fp) as z:
                v1 = z['co'].reshape(-1, 3).astype(np.float64)
            v0 = v1 * (extent(t0) / extent(t1))
            src = 'growth mesh t=%.4f (%d vertices)' % (t1, len(v1))
        px, n = p90(v0, v1, c0, c1)
        rows.append(dict(f=f, chapter=rec['chapter'], planner=rec['px'], mesh=None if px is None else round(px, 3),
                         ratio=None if px is None or not rec['px'] else round(px / rec['px'], 3), points=n, source=src))
        print('[motion] f%03d %-8s planner %6.2f  mesh %6.2f  (x%.3f)  %s' % (
            f, rec['chapter'], rec['px'], px or float('nan'), (px or 0) / max(rec['px'], 1e-9), src))
    r = np.array([x['ratio'] for x in rows if x['ratio'] is not None])
    mx = max((x for x in rows if x['mesh'] is not None), key=lambda x: x['mesh'])
    growth = np.array([x['ratio'] for x in rows if x['ratio'] is not None and not PP.frozen(TL, x['f'])])
    froz = np.array([x['ratio'] for x in rows if x['ratio'] is not None and PP.frozen(TL, x['f'])])
    summ = dict(path=A.path, frames=len(rows), mesh_px_max=mx['mesh'], mesh_px_max_frame=mx['f'], cap=PP.CAP_PX,
                ratio_growth=[round(float(growth.min()), 3), round(float(np.median(growth)), 3),
                              round(float(growth.max()), 3)] if len(growth) else None,
                ratio_frozen=[round(float(froz.min()), 3), round(float(np.median(froz)), 3),
                              round(float(froz.max()), 3)] if len(froz) else None)
    print('[motion] mesh p90 max %.2f px at frame %d (cap %.0f); mesh / planner ratio growth (min, median, max) %s, '
          'frozen %s' % (mx['mesh'], mx['f'], PP.CAP_PX, summ['ratio_growth'], summ['ratio_frozen']))
    tmp = '%s.%d.tmp' % (A.out, os.getpid())
    with open(tmp, 'w') as fh:
        json.dump(dict(summary=summ, rows=rows), fh, indent=1)
    os.replace(tmp, A.out)
    return 0 if mx['mesh'] <= PP.CAP_PX else 1


if __name__ == '__main__':
    sys.exit(main())
