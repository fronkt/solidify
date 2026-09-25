"""
emerge_check.py -- every side-arm birth and death over the growth frames of the timeline, measured on the drawn
geometry (dendrite_gen.emerge_shift), so a claim about the emergence ramp covers every arm, not a sample (plain Python:
numpy + scipy; bpy is stubbed, the skeleton code never touches it).

  python hero/emerge_check.py [--timeline hero/timeline.json] [--seed 7]
      [--out C:/Users/frank/solidify-hero-out/v4/emerge_check.json] [--strict] [--tol 0.0]

For every growth frame f (t = path_plan.t_of) the arm states are set as the generator sets them (set_states: v1's
per-arm state and the channel caps; the neck rule is left out, it only makes root necks shallower and changes neither a
length, a root radius nor who is alive). Then, per side arm:
  birth   the first frame it is drawn (alive at f, not at f - 1): its drawn apex height above the parent's envelope
          at its station, p = drawn protrusion (L - emerge_shift - R_root), and its sphere-union protrusion: how far any
          point of the newborn's own spheres lies outside every OTHER sphere of the crystal (the rest of the crystal at
          that frame; 48 directions per sphere, the newborn's interior points left out). Both in its own tip radii rho
          and in px at the full view (1200 px over the frame width at the end of growth, path_plan's W_full ~ 2.4).
  death   the last frame it is drawn (alive at f - 1, not at f): the same two numbers on that frame.
  step    between two frames it is drawn in: the change of p (rise and sink separately, in rho).
The sphere union is the crystal before the closing (fillet) and the opening, so it is a little conservative: the
closing only adds material in the concave corners and the one-voxel opening removes slivers thinner than a voxel.
--strict exits 2 when a birth or a death sticks out of the rest of the crystal by more than --tol (model units).
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import path_plan as PP  # noqa: E402

OUT_DEFAULT = PP.OUT_DEFAULT + '/emerge_check.json'


def fib_dirs(n=48):
    k = np.arange(n) + 0.5
    z = 1.0 - 2.0 * k / n
    r = np.sqrt(1.0 - z * z)
    ph = math.pi * (3.0 - math.sqrt(5.0)) * k
    return np.stack([r * np.cos(ph), r * np.sin(ph), z], axis=1)


DIRS = fib_dirs()


def arm_spheres(DG, a, t, voxel):
    out = {'pos': [], 'rad': [], 'birth': [], 'gen': [], 'arm': []}
    DG.sample_arm(a, t, voxel, out)
    if not out['pos']:
        return np.zeros((0, 3)), np.zeros(0)
    return np.concatenate(out['pos']), np.concatenate(out['rad'])


def union_protrusion(P, R, tree, C, Rr, rmax, nuc_c, nuc_r):
    """how far the union of spheres (P, R) reaches outside the union of the rest (centers C, radii Rr in a cKDTree
    `tree`, the largest radius rmax, plus the nucleus): max over the surface points of (P, R) that are not inside
    another of its own spheres of the rest's distance function, floored at 0. Model units."""
    if len(P) == 0:
        return 0.0
    pts = (P[:, None, :] + R[:, None, None] * DIRS[None, :, :]).reshape(-1, 3)
    own = np.linalg.norm(pts[:, None, :] - P[None, :, :], axis=2) - R[None, :]
    owner = np.repeat(np.arange(len(P)), len(DIRS))
    own[np.arange(len(pts)), owner] = 1.0                      # a point is on its own sphere
    pts = pts[own.min(axis=1) > -1e-9]                          # drop points inside another sphere of the arm
    if len(pts) == 0:
        return 0.0
    sdf = np.linalg.norm(pts - nuc_c[None, :], axis=1) - nuc_r
    k = min(48, len(C))
    d, idx = tree.query(pts, k=k)
    d = np.atleast_2d(d)
    idx = np.atleast_2d(idx)
    s2 = np.min(np.where(np.isfinite(d), d - Rr[np.minimum(idx, len(Rr) - 1)], np.inf), axis=1)
    sdf = np.minimum(sdf, s2)
    # a sphere farther than the k-th neighbor could still be nearer by surface distance only if it is larger by the
    # difference: never the case once the k-th center distance exceeds the best found + rmax
    return float(max(sdf.max(), 0.0))


def main(argv=None):
    p = argparse.ArgumentParser(description='SOLIDIFY hero: every side-arm birth / death on the drawn geometry')
    p.add_argument('--timeline', default=None)
    p.add_argument('--seed', type=int, default=7)
    p.add_argument('--out', default=OUT_DEFAULT)
    p.add_argument('--strict', action='store_true', help='exit 2 when a birth or death sticks out by more than --tol')
    p.add_argument('--tol', type=float, default=0.0, help='model units a birth or death may stick out (default 0)')
    p.add_argument('--union', default='births+deaths', help="'births+deaths' (default), 'births', 'none'")
    p.add_argument('--set', action='append', default=[], metavar='NAME=VALUE',
                   help='try another value of a dendrite_gen constant (e.g. EMERGE_RHO=2.0) without editing the file')
    A_ = p.parse_args(sys.argv[1:] if argv is None else argv)
    from scipy.spatial import cKDTree
    TL = PP.load_timeline(A_.timeline)
    DG = PP.import_generator()
    for kv in A_.set:
        k, v = kv.split('=', 1)
        if not (k.isupper() and hasattr(DG, k)):
            raise SystemExit('--set %s: not a dendrite_gen constant' % k)
        setattr(DG, k, type(getattr(DG, k))(float(v)))
        print('[emerge] %s = %s (override)' % (k, getattr(DG, k)))
    A = PP.gen_args(DG, A_.seed)
    t_run = time.perf_counter()
    arms = DG.build_skeleton(A, np.random.default_rng(A.seed))
    print('[emerge] skeleton %.1fs; EMERGE_RHO %.2f, EMERGE_BURY %.2f, EMERGE_TIP_K %.1f, EMERGE_TIP_LEAD %.1f' % (
        time.perf_counter() - t_run, DG.EMERGE_RHO, DG.EMERGE_BURY, DG.EMERGE_TIP_K, DG.EMERGE_TIP_LEAD))
    g0, g1 = int(TL['growth']['from']), int(TL['growth']['to'])
    side = [a for a in arms if a.gen >= 1]
    # full-view px per model unit: the frame width at the end of growth (the crystal's bounding circle at SPAN1)
    W_full = None
    try:
        tips = np.array([a.origin + a.d * a.L for a in arms if a.gen == 0])
    except Exception:  # noqa
        tips = None
    prev_alive = np.zeros(len(side), dtype=bool)
    prev_p = np.full(len(side), np.nan)
    births, deaths = [], []
    rise = (0.0, None, None)
    sink = (0.0, None, None)
    do_b = A_.union in ('births', 'births+deaths')
    do_d = A_.union == 'births+deaths'
    last_state = None
    pending = []
    for f in range(g0, g1 + 1):
        t = PP.t_of(TL, f)
        DG.set_states(arms, t, A)
        alive = np.array([a.alive for a in side])
        pdraw = np.array([((a.L - DG.emerge_shift(a)) - a.R_root) if a.alive else np.nan for a in side])
        rho = np.array([a.rho for a in side])
        born = np.flatnonzero(alive & ~prev_alive) if f > g0 else np.zeros(0, dtype=int)
        died = np.flatnonzero(prev_alive & ~alive)
        both = alive & prev_alive
        if both.any():
            dp = (pdraw - prev_p) / rho
            dp[~both] = 0.0
            i = int(np.argmax(dp))
            if dp[i] > rise[0]:
                rise = (float(dp[i]), int(side[i].idx), f)
            i = int(np.argmin(dp))
            if -dp[i] > sink[0]:
                sink = (float(-dp[i]), int(side[i].idx), f)
        # a newborn whose drawn stations are all still inside the parent draws no sphere yet: its birth is the first
        # frame it draws one
        pending = [i for i in pending if alive[i]]
        cand = sorted(set(pending) | set(int(i) for i in born))
        need_union = (do_b and len(cand)) or (do_d and len(died))
        if need_union:
            sp = DG.collect_points(arms, t, A)
            nuc_c, nuc_r = sp['pos'][0], float(sp['rad'][0])
        new_pending = []
        for i in cand:
            a = side[i]
            P_, R_ = arm_spheres(DG, a, t, A.voxel)
            if len(P_) == 0:
                new_pending.append(i)
                continue
            rec = dict(arm=int(a.idx), gen=int(a.gen), frame=f, t=round(t, 5), p_rho=round(float(pdraw[i] / a.rho), 4))
            if do_b:
                m = (sp['arm'] != a.idx)
                m[0] = False
                C, Rr = sp['pos'][m], sp['rad'][m]
                # only the rest near the newborn matters
                lo, hi = P_.min(0) - 0.2, P_.max(0) + 0.2
                near = np.all((C >= lo) & (C <= hi), axis=1)
                tree = cKDTree(C[near]) if near.sum() else None
                u = union_protrusion(P_, R_, tree, C[near], Rr[near], 0.0, nuc_c, nuc_r) if tree is not None else 0.0
                rec['union'] = round(u, 6)
                rec['union_rho'] = round(u / a.rho, 4)
            births.append(rec)
        pending = new_pending
        # deaths: measured on the frame before (the last one the arm is drawn in)
        if len(died) and do_d:
            if last_state is not None:
                t_prev, sp_prev = last_state
                DG.set_states(arms, t_prev, A)
                for i in died:
                    a = side[i]
                    m = (sp_prev['arm'] != a.idx)
                    m[0] = False
                    C, Rr = sp_prev['pos'][m], sp_prev['rad'][m]
                    P_, R_ = arm_spheres(DG, a, t_prev, A.voxel)
                    if len(P_):
                        lo, hi = P_.min(0) - 0.2, P_.max(0) + 0.2
                        near = np.all((C >= lo) & (C <= hi), axis=1)
                        tree = cKDTree(C[near]) if near.sum() else None
                        u = union_protrusion(P_, R_, tree, C[near], Rr[near], 0.0, sp_prev['pos'][0],
                                             float(sp_prev['rad'][0])) if tree is not None else 0.0
                    else:
                        u = 0.0
                    deaths.append(dict(arm=int(a.idx), gen=int(a.gen), last_frame=f - 1, t=round(t_prev, 5),
                                       p_rho=round(float(prev_p[i] / a.rho), 4), union=round(u, 6),
                                       union_rho=round(u / a.rho, 4)))
                DG.set_states(arms, t, A)
        elif len(died):
            for i in died:
                a = side[i]
                deaths.append(dict(arm=int(a.idx), gen=int(a.gen), last_frame=f - 1, p_rho=round(float(prev_p[i] / a.rho), 4)))
        if do_d:
            last_state = (t, sp if need_union else DG.collect_points(arms, t, A))
        prev_alive, prev_p = alive, pdraw
        if f % 25 == 0:
            print('[emerge] frame %d t=%.3f: %d births, %d deaths so far (%.0fs)' % (
                f, t, len(births), len(deaths), time.perf_counter() - t_run))
            sys.stdout.flush()
    # full view scale
    TL_g = TL
    W_full = None
    try:
        e1 = 2.0 * max(np.linalg.norm(tips, axis=1)) if tips is not None else None
        W_full = e1 / PP.SPAN1 if e1 else None
    except Exception:  # noqa
        W_full = None
    px_unit = (TL_g.get('res', 1200) / W_full) if W_full else None

    def summ(rows, key):
        v = np.array([r[key] for r in rows if key in r])
        return v
    bp = summ(births, 'p_rho')
    bu = np.array([r.get('union', 0.0) for r in births])
    dp_ = summ(deaths, 'p_rho')
    du = np.array([r.get('union', 0.0) for r in deaths])
    out_b = [r for r in births if r.get('union', 0.0) > A_.tol]
    out_d = [r for r in deaths if r.get('union', 0.0) > A_.tol]
    rep = dict(
        generated=time.strftime('%Y-%m-%d %H:%M:%S'), timeline=TL['_path'], frames=[g0, g1], seed=A_.seed,
        emerge=dict(rho=DG.EMERGE_RHO, bury=DG.EMERGE_BURY, tip_k=DG.EMERGE_TIP_K, tip_lead=DG.EMERGE_TIP_LEAD),
        px_per_model_unit_full_view=round(px_unit, 1) if px_unit else None,
        births=dict(n=len(births), apex_above_parent=int((bp > 0).sum()), apex_p_rho_max=round(float(bp.max()), 4) if len(bp) else None,
                    apex_p_rho_median=round(float(np.median(bp)), 4) if len(bp) else None,
                    union_out=len(out_b), union_max=round(float(bu.max()), 6) if len(bu) else None,
                    union_max_rho=round(max([r.get('union_rho', 0.0) for r in births] or [0.0]), 4),
                    union_max_px_full_view=round(float(bu.max()) * px_unit, 2) if (px_unit and len(bu)) else None,
                    by_gen={g: int(sum(1 for r in births if r['gen'] == g)) for g in (1, 2)},
                    out_by_gen={g: int(sum(1 for r in out_b if r['gen'] == g)) for g in (1, 2)},
                    out_frames=[min((r['frame'] for r in out_b), default=None), max((r['frame'] for r in out_b), default=None)]),
        deaths=dict(n=len(deaths), apex_above_parent=int((dp_ > 0).sum()) if len(dp_) else 0,
                    apex_p_rho_max=round(float(np.nanmax(dp_)), 4) if len(dp_) else None,
                    union_out=len(out_d), union_max=round(float(du.max()), 6) if len(du) else None),
        step=dict(max_rise_rho=round(rise[0], 4), max_rise_arm=rise[1], max_rise_frame=rise[2],
                  max_sink_rho=round(sink[0], 4), max_sink_arm=sink[1], max_sink_frame=sink[2]),
        births_out=out_b[:400], deaths_out=out_d[:200], seconds=round(time.perf_counter() - t_run, 1))
    os.makedirs(os.path.dirname(os.path.abspath(A_.out)), exist_ok=True)
    tmp = '%s.%d.tmp' % (A_.out, os.getpid())
    with open(tmp, 'w') as fh:
        json.dump(dict(rep, births_all=births, deaths_all=deaths), fh, indent=1)
    os.replace(tmp, A_.out)
    print(json.dumps({k: rep[k] for k in ('emerge', 'px_per_model_unit_full_view', 'births', 'deaths', 'step', 'seconds')},
                     indent=1))
    print('[emerge] -> %s' % A_.out)
    bad = len(out_b) + len(out_d)
    if A_.strict and bad:
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
