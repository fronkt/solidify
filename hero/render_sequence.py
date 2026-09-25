"""
render_sequence.py -- the SOLIDIFY landing hero (v4): the scroll-scrubbed frames of a cubic metal dendrite growing,
cooling and being toured, rendered along the camera path that path_plan.py plans (Blender 4.5 LTS, headless, Cycles
on the Intel Arc via oneAPI).

  blender.exe -b --factory-startup --python hero/render_sequence.py -- [--out C:/Users/frank/solidify-hero-out/v4/seq]
      [--path C:/Users/frank/solidify-hero-out/v4/path.json] [--timeline hero/timeline.json]
      [--res 1200] [--samples 96] [--seed 7] [--frames all | 0-777 | 12-95/6 | 5,17,120 | spread:30]
      [--force | --rerender-stale] [--features-only] [--refeature] [--anchors-only] [--cache-only] [--prune-cache]
      [--preview] [--eevee | --workbench] [--coarse-frozen] [--no-anchors] [--gate-soft] [--allow-stale]
      [--allow-failed-path] [--key-on-camera] [--cache DIR] [--no-cache] [--verify-cache] [--build-only 1.0,0.6,0.3]
      [--set k=v ...]

The frame set is hero/timeline.json (the one source for N, the chapters, the feature windows and holds, the poster
frame, the growth and warmth laws; path_plan.load_timeline reads it for this file, the planner and encode_frames.py):
  seed, grow, branch   growth time t runs linearly in frame (constant tip speed, as the generator models its tips) from
                       timeline.growth.t[0] (the bare nucleus) to 1 at the last growth frame; every frame has its own
                       mesh, dendrite_gen.build at its t (same seed; newborn side arms surface through the generator's
                       emergence ramp, hero/emerge_check.py measures every birth), taken from the mesh cache
                       (mesh_cache.py) or built into it
  cool                 the light rig eases from warm to neutral (look.Look.set_warmth 1 -> 0, timeline.warmth); the
                       crystal is the t = 1 crystal from here on, unchanged (no growth, no coarsening after growth ends)
  tour                 the frozen crystal; five callouts, each a soft hold inside its window, in the order primary, tip,
                       lambda2, tertiary, neck (the look-at slides from the tip toward the root)
  pullback             the path opens back to the whole crystal and stops on the poster pose, the LAST frame (a real
                       render; no dissolve)
Camera: frame i takes path.json's record i (forward / right / up, target, width, lens, f-stop, exposure, key
desaturation, and the key light's trailing frame): one continuous path planned offline by path_plan.py, re-timed by
projected screen motion and capped. No camera keys live in this file. The renderer REFUSES a path.json that failed the
planner's check (--allow-failed-path), was planned for another version of the timeline, on other feature points, or
for another generator (--allow-stale): a render on a stale path would put the callouts off their pixels.
Meshes (mesh_cache.py, mesh_recipe.py): frames before t = 1 render the generator's mesh at their t ('gen'); every frozen
frame (t = 1: the last growth frame on) renders the close-up mesh ('fine'), one mesh for all of them. The close-up mesh
is the same t = 1 crystal on a 0.002 SDF grid instead of the generator's 0.004, with 4 smoothing passes instead of 2,
and with a sphere of up to 0.008 behind every living tertiary's apex (capped by the arm's own envelope), so the mesh
changes ONCE, between the last two growth frames (the generator's t = 1 - dt mesh, then the close-up mesh), at the full
view on the last growth step; README.md gives the measured size of that change. Every mesh is built once, gated (one
closed genus-0 surface) and stored under --cache (default <v4>/cache/mesh) keyed by a hash of dendrite_gen.py,
mesh_recipe.py, the generator arguments, Blender, numpy, the kind and t, so previews and the final render load the same
meshes (a growth mesh loads in ~0.1 s instead of 1-35 s of building) and a stale one cannot be read. A mesh that FAILS
the gate is never cached, and this file refuses to render it (exit code 2; --gate-soft renders it with a warning);
--cache-only exits 2 when any mesh it built or checked fails. --no-cache builds without touching the cache;
--verify-cache re-runs the topology count on every load; --prune-cache deletes superseded fingerprint directories.
Look (round 4, final): NO emission (look.Look(emission=0)); satin steel throughout and the freeze told with light: warm
key through seed / grow / branch, the neutral rig after the cool chapter. The rim, fill and bounce ride in camera space
(look.py); the KEY trails the camera (path.json key_basis: it turns 0.4 of the camera's own rotation each frame, anchored
on the tour), so the shading moves over the crystal as it turns. No bloom, no compositing.
Features: the five callout points come from the generator's own t = 1 skeleton (tip apex; two points on the +x axis;
the lambda2 pair's roots; the tertiary near its tip) plus the neck, a side arm whose root is visibly necked ON THE MESH
(neck_candidates: ray casts from the arm's axis on the close-up mesh). The picks (path_plan.choose_tertiary_and_neck,
path_plan.pick_lambda2) keep the look-at moving from the tip toward the root: the tertiary's host station at or tipward
of the neck's root, the lambda2 pair tipward of the tertiary. --features-only writes them to --features (default
<v4>/features.json) for the planner and stops; --refeature picks them again. Every other run reuses that file while its
key matches (features_key: a hash of the frozen mesh's cache key and of the source of the pick functions and constants)
and STOPS when it does not (the path was planned on those points); a --coarse-frozen preview keeps its own copy.
Anchors: the five feature points are projected with bpy_extras.object_utils.world_to_camera_view and tested for
occlusion with scene.ray_cast from the camera on the mesh the frozen frames render; visible = 1 only if the first
surface the ray meets is the crystal within the point's own surface distance and the point sits clear of the page's
6 % edge fade. Frames before t = 1 carry visible = 0 (the frozen features do not exist yet). The anchor pass runs over
every frame at the end of every run (unless --no-anchors) and writes <out>/frames.json, which encode_frames.py reads.
Preview: --preview renders at 600 px with EEVEE (the same material, light rig, key trail, warmth and Filmic view as the
final frames, 16 samples, about 1 s a frame from the cache) into <v4>/preview_eevee, or with --workbench (Workbench
studio light, a framing check) into <v4>/preview_workbench; an explicit --out / --res / --samples holds. --eevee alone
switches the engine for any run. --coarse-frozen: the frozen frames use the generator's t = 1 mesh instead of the
close-up mesh. --cache-only builds (or checks) the meshes of the frame set and renders nothing.
Resumable: every PNG is rendered to f###.part.png and renamed onto f###.png when complete, and frames.json records, per
frame, a render key (sha1 of the camera record, the mesh key, engine / res / samples, the look parameters, exposure,
warmth, key desaturation). A frame whose PNG exists, is complete (PNG signature + IEND) and carries the current key is
skipped; a truncated PNG is rendered again; a PNG rendered from other inputs (another path, mesh or look) makes the run
STOP and list them, unless --rerender-stale (render those again) or --force (render every requested frame again).
Every frame's mesh and render seconds go to stdout and to <out>/render_log.txt. --build-only 1.0,0.6,0.3 builds those
times in that order through the skeleton memo, without the mesh cache, and prints the vertex counts, which must equal a
fresh single-t build's (the check that the memo is safe).
Outputs (all under --out): f000.png .. (res x res RGBA, transparent film, straight alpha), frames.json (per frame: t,
warmth, camera, anchors, seconds, topology gate, render key), render_log.txt, build/ (the generator's per-t feature
files).
"""
import argparse
import hashlib
import inspect
import json
import math
import os
import sys
import time

import numpy as np

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import dendrite_gen as DG   # noqa: E402
import look                  # noqa: E402
import mesh_cache as MC      # noqa: E402  (also memoizes dendrite_gen.build_skeleton)
import path_plan as PP       # noqa: E402

# ---- frame set contract (hero/timeline.json) -----------------------------------------------------------------------
V4 = 'C:/Users/frank/solidify-hero-out/v4'
DEFAULT_OUT = V4 + '/seq'
DEFAULT_PATH = V4 + '/path.json'
DEFAULT_FEATURES = V4 + '/features.json'
TL = None
N_FRAMES = 0
CHAPTERS = []
FEATURES = []
LABEL_SIDE = {}


def use_timeline(tl):
    """make timeline `tl` this module's frame set (N_FRAMES, CHAPTERS, FEATURES, LABEL_SIDE)."""
    global TL, N_FRAMES, CHAPTERS, FEATURES, LABEL_SIDE
    TL = tl
    N_FRAMES = PP.n_frames(tl)
    CHAPTERS = PP.chapter_list(tl)
    FEATURES = PP.feature_list(tl)
    LABEL_SIDE = {f['id']: f.get('label') for f in tl['features']}


use_timeline(PP.load_timeline())
X, Y, Z = np.eye(3)
FINE_VOXEL = MC.FINE_VOXEL             # the close-up mesh's SDF voxel (mesh_recipe.py holds the close-up mesh recipe)


def chapter_of(f):
    return PP.chapter_of(TL, f)


def sha1_file(path):
    with open(path, 'rb') as fh:
        return hashlib.sha1(fh.read()).hexdigest()


# ---- camera (path.json) ------------------------------------------------------------------------------------------
class PathCamera:
    """path.json (path_plan.py) as the camera for every frame. Refuses (SystemExit) a path that failed the planner's
    check unless allow_failed, and one planned for another timeline, other feature points (features_key) or another
    generator (gen_fp) unless allow_stale."""

    def __init__(self, path, features_key=None, gen_fp=None, allow_stale=False, allow_failed=False, log=print):
        if not os.path.isfile(path):
            raise SystemExit('no camera path at %s: run  python hero/path_plan.py  first (after --features-only)' % path)
        self.path = path
        self.data = PP.load_path(path)
        self.meta = self.data['meta']
        self.frames = self.data['frames']
        if len(self.frames) != N_FRAMES:
            raise SystemExit('path %s has %d frames, the timeline %d: re-run path_plan.py' % (path, len(self.frames), N_FRAMES))
        problems = []
        if self.meta.get('timeline_sha1') != sha1_file(TL['_path']):
            problems.append('it was planned for another version of %s' % TL['_path'])
        if features_key is not None and self.meta.get('features_key') != features_key:
            problems.append('it was planned on other feature points (features key %s, current %s)' % (
                str(self.meta.get('features_key'))[:12], features_key[:12]))
        if gen_fp is not None and self.meta.get('generator') != gen_fp:
            problems.append('it was planned for another generator (%s, current %s)' % (
                str(self.meta.get('generator'))[:12], gen_fp[:12]))
        self.stale = problems
        if problems:
            msg = 'path %s is stale: %s; re-run path_plan.py' % (path, '; '.join(problems))
            if not allow_stale:
                raise SystemExit(msg + ' (or pass --allow-stale)')
            log('[seq] WARNING (--allow-stale): ' + msg)
        if self.meta.get('ok') is False:
            msg = 'path %s FAILED the planner\'s check (%s)' % (path, self.meta.get('generated'))
            if not allow_failed:
                raise SystemExit(msg + ': fix the plan, or pass --allow-failed-path')
            log('[seq] WARNING (--allow-failed-path): ' + msg)

    def rec(self, f):
        return self.frames[f]

    def state(self, f):
        r = self.frames[f]
        return {k: r[k] for k in ('az', 'el', 'roll', 'lens', 'width', 'P', 'sx', 'sy', 'fstop', 'ev', 'kd', 'u')}

    def view(self, f):
        r = self.frames[f]
        return self.state(f), PP.view_of(r)


# ---- features (anchor points) -------------------------------------------------------------------
def snap(ob, p):
    ok, loc, _n, _i = ob.closest_point_on_mesh(Vector([float(x) for x in p]))
    return np.array(loc, dtype=np.float64) if ok else np.asarray(p, dtype=np.float64)


def surface_distance(ob, p):
    ok, loc, _n, _i = ob.closest_point_on_mesh(Vector([float(x) for x in p]))
    return float((Vector([float(x) for x in p]) - loc).length) if ok else 0.0


# v4: the neck is a +x-arm secondary whose ROOT is visibly necked on the close-up mesh, from the rows the lathe tour sees
# near profile: the tour turns over the top of the +x arm from the +y side to the -y side, and its neck view looks from
# above the -y side, where a +z arm (row 2) stands up from the trunk with its root facing the camera; a -y arm (row 1)
# points toward the camera (foreshortened) but its root faces it too; a -z arm (row 3) hangs under the trunk (root
# hidden from above) and a +y arm (row 0) is on the far side. Rows not listed are not candidates; NECK_SPAR_FALLBACK (all
# rows, v3's range) applies only when nothing qualifies.
# Measured at seed 7 (2026-09-24, t = 1 skeleton and close-up mesh): nearer the root the waists are shallow. Of the 25
# +x secondaries between 0.25 and 0.60 L that protrude more than 5 tip radii, 11 keep no model neck and 14 keep a
# shallow one (11 of them 10-26 tip radii long): apply_neck_limits cuts the age law's necks (k 0.34-0.41) down to at
# most 0.23 as row neighbours approach, the floor radius limits the channel-capped arms, and the closing fills the rest,
# so their mesh waist / section-above ratio is 0.94 or more (above NECK_MAX_RATIO). The readable waists are at 0.62 L
# (row 2, ratio ~0.92) and 0.67 L (row 2, 0.87); path_plan.choose_tertiary_and_neck takes the clearest one that still
# has a tertiary at or tipward of it.
NECK_ROW_PENALTY = {2: 0.0, 1: 0.06}
NECK_SPAR = (0.25, 0.70)                 # fraction of the +x arm's length: nearer the root than v3's pick (0.71 L)
NECK_SPAR_FALLBACK = (0.25, 0.85)
NECK_MAX_RATIO = 0.92                    # silhouette waist / section above it: a pinch that reads at the neck framing


def neck_candidates(px, t, exclude, bvh, rows=None, spar=NECK_SPAR, log=print):
    """the +x arm secondaries whose root is visibly necked ON THE MESH (bvh: the mesh the frozen frames render). The
    model's neck is a short Gaussian waist just outside the trunk, and the closing (fillet) fills most of it. So each
    candidate (a row in `rows` (default NECK_ROW_PENALTY); s_par within `spar` of the arm; not in `exclude`; alive with
    a model neck and > 5 tip radii of protrusion) is measured with mesh_waist; a candidate passes when its silhouette
    waist / section-above ratio is under NECK_MAX_RATIO and its fillet onto the trunk is wider than the waist (a pinch,
    not a taper). Returns [(score, arm, waist dict)] of the passing ones, score = ratio + the row penalty + 0.01 per
    tertiary it hosts (a cleaner profile); every measured candidate goes to the log."""
    rows = NECK_ROW_PENALTY if rows is None else rows
    out, measured = [], []
    for c in px.children:
        if c.idx in exclude or c.row not in rows:
            continue
        if not (c.alive and (c.L - c.R_root) > 5.0 * c.rho and c.k_neck > 0.0):
            continue
        if not (spar[0] * px.L < c.s_par < spar[1] * px.L):
            continue
        w = mesh_waist(bvh, c, t)
        if w is None or w['ratio'] is None:
            continue
        ok = w['ratio'] < NECK_MAX_RATIO and (w['flare'] or 0.0) > w['r_neck']
        measured.append((round(c.s_par / px.L, 3), c.idx, c.row, round(c.k_neck, 3), w['ratio'], 'PASS' if ok else '-'))
        if ok:
            score = w['ratio'] + rows[c.row] + 0.01 * sum(1 for g in c.children if g.alive)
            out.append((score, c, w))
    log('[seq] neck candidates measured on the mesh, rows %s, s_par %s L (s/L, arm, row, model k_neck, waist/above, '
        'pass): %s' % (sorted(rows), spar, sorted(measured)))
    return out


def feature_points(ob, arms, feats, A, log=print):
    """world points per feature id (lists of points). Points sit on the skeleton axes (the tip apex, the
    root of a side arm just outside the junction, the tertiary near its tip, the primary axis); the
    occlusion test allows for each point's own distance to the surface, so no snapping to one side."""
    px = [a for a in arms if a.gen == 0][0]
    L = px.L
    tip = px.origin + px.d * L
    bvh = mesh_bvh(ob)
    necks = neck_candidates(px, 1.0, set(), bvh, log=log)
    if not necks:
        log('[seq] no neck in rows %s at %s L: falling back to every row, %s L' % (
            sorted(NECK_ROW_PENALTY), NECK_SPAR, NECK_SPAR_FALLBACK))
        necks = neck_candidates(px, 1.0, set(), bvh, rows={0: 0.1, 1: 0.06, 2: 0.0, 3: 0.03}, spar=NECK_SPAR_FALLBACK,
                                log=log)
    if not necks:
        raise SystemExit('no secondary on the +x arm has a waist visible on the mesh')
    g, nk, monotone = PP.choose_tertiary_and_neck(DG, px, necks)
    if g is None:
        raise SystemExit('no tertiary qualifies (path_plan.TERT_*): cannot place the tertiary callout')
    _, c, wst = nk
    if not monotone:
        log('[seq] WARNING: no tertiary sits at or tipward of a readable neck: the look-at will move back toward the tip '
            'between the tertiary and the neck (the planner\'s check fails on that)')
    neck = c.origin + c.d * (c.R_root + wst['h_neck'])        # on the arm's axis at the measured waist
    lp = PP.pick_lambda2(DG, px, 1.0, A, g.parent.s_par + PP.L2_TIPWARD * L, exclude={c.idx})
    if lp is None:
        log('[seq] WARNING: no lambda2 pair tipward of the tertiary: the generator\'s pick stands')
        lp = dict(feats['lambda2_pair'], source='dendrite_gen.extract_features')
    la, lb = PP.lambda2_points(lp)
    te = {'root': (g.origin + g.d * g.R_root).tolist(), 'tip': (g.origin + g.d * g.L).tolist(),
          'direction': g.d.tolist(), 'length': round(g.L - g.R_root, 5), 'tip_radius': g.rho,
          'host_row': g.parent.row, 'host_arm': g.parent.idx, 'host_s_par': round(g.parent.s_par, 5), 'arm': g.idx,
          'parent_secondary_root': (g.parent.origin + g.parent.d * g.parent.R_root).tolist(),
          'parent_secondary_tip': (g.parent.origin + g.parent.d * g.parent.L).tolist(),
          'source': 'path_plan.choose_tertiary_and_neck (at or tipward of the neck)'}
    log('[seq] tertiary: %s' % json.dumps({k: te[k] for k in ('arm', 'length', 'host_arm', 'host_s_par', 'source')}))
    t_root, t_tip = np.asarray(te['root']), np.asarray(te['tip'])
    tert = t_root + (t_tip - t_root) * 0.8
    host_dir = PP.unit(np.asarray(te['parent_secondary_tip']) - np.asarray(te['parent_secondary_root']))
    pts = {
        'tip': [tip],
        'primary': [np.array([0.30 * L, 0.0, 0.0]), np.array([0.92 * L, 0.0, 0.0])],
        'lambda2': [la, lb],
        'tertiary': [tert],
        'neck': [neck],
        'neck_dir': c.d.copy(),
        'tertiary_host_dir': host_dir,
    }
    xs = {'tip': float(tip[0]), 'lambda2': float(0.5 * (la[0] + lb[0])), 'tertiary': float(tert[0]), 'neck': float(neck[0])}
    info = {
        'primary_length': round(L, 5),
        'lambda2': {'row': lp['row'], 'spacing': lp['spacing'], 'roots': [la.tolist(), lb.tolist()],
                    'arms': lp.get('arms'), 'distance_from_centre': lp['distance_from_centre'],
                    'channel_open': lp.get('channel_open'), 'channel_gap_min': lp.get('channel_gap_min'),
                    'source': lp.get('source')},
        'tertiary': {'host_row': te['host_row'], 'length': te['length'], 'point': tert.tolist(), 'direction': te['direction'],
                     'arm': te['arm'], 'host_arm': te.get('host_arm'), 'host_s_par': te.get('host_s_par'),
                     'source': te['source']},
        'neck': {'arm': c.idx, 'row': c.row, 's_par': round(c.s_par, 5), 's_par_over_L': round(c.s_par / L, 4),
                 'arm_age': round(c.age, 4), 'k_neck': round(c.k_neck, 4), 'point': neck.tolist(),
                 'direction': c.d.tolist(), 'mesh_waist_height': wst['h_neck'], 'mesh_waist_radius': wst['r_neck'],
                 'mesh_radius_above': wst['r_out'], 'mesh_root_flare': wst['flare'], 'mesh_waist_ratio': wst['ratio'],
                 'root_rmax': wst['rr']},
        'tip': tip.tolist(),
        'primary_pair': [pts['primary'][0].tolist(), pts['primary'][1].tolist()],
        'x_along_arm': {k: round(v, 4) for k, v in xs.items()},
        'order_monotone': bool(monotone and xs['tip'] >= xs['lambda2'] >= xs['tertiary'] >= xs['neck'] - 1e-4),
    }
    return pts, info


def feature_tolerances(ob, pts):
    """the occlusion allowance per feature point: its own distance to the surface (x 1.6) + EPS_VIS."""
    return {fid: [1.6 * surface_distance(ob, p) + EPS_VIS for p in pts[fid]] for fid, _k, _a, _b in FEATURES}


def features_key(mesh_key):
    """the key a features file must carry to be reused: a hash of the frozen mesh's cache key (itself covering the
    generator, the mesh recipe and every shaping argument) and of the source of the functions and constants that pick
    the features (here and in path_plan.py), so an edit elsewhere does not force a re-pick and an edit to a pick
    always does."""
    h = hashlib.sha1(mesh_key.encode())
    for fn in (surface_distance, neck_candidates, feature_points, features_json, mesh_waist, feature_tolerances,
               PP.tertiary_candidates, PP.choose_tertiary_and_neck, PP.lambda2_channel, PP.pick_lambda2,
               PP.lambda2_points):
        h.update(inspect.getsource(fn).encode())
    consts = dict(NECK_ROW_PENALTY=NECK_ROW_PENALTY, NECK_SPAR=NECK_SPAR, NECK_SPAR_FALLBACK=NECK_SPAR_FALLBACK,
                  NECK_MAX_RATIO=NECK_MAX_RATIO, EPS_VIS=EPS_VIS, features=[f[0] for f in FEATURES],
                  PP=dict(TERT_DIR=PP.TERT_DIR, TERT_HOST_FACING=PP.TERT_HOST_FACING, TERT_MIN_LEN=PP.TERT_MIN_LEN,
                          L2_ROWS=PP.L2_ROWS, L2_MIN_PROT=PP.L2_MIN_PROT, L2_TIPWARD=PP.L2_TIPWARD,
                          L2_MAX_SPAR=PP.L2_MAX_SPAR))
    h.update(json.dumps(consts, sort_keys=True, default=str).encode())
    return h.hexdigest()


def features_json(pts, info, feats, mesh_note):
    """the planner's input (path_plan.load_features): the anchor points exactly as the anchor pass uses them."""
    tips = [tp['position'] for tp in feats['tips']]
    return dict(source='render_sequence.py --features-only (%s)' % mesh_note,
                generated=time.strftime('%Y-%m-%d %H:%M:%S'),
                points={fid: [np.asarray(p).tolist() for p in pts[fid]] for fid, _k, _a, _b in FEATURES},
                neck_dir=np.asarray(pts['neck_dir']).tolist(), tertiary_host_dir=np.asarray(pts['tertiary_host_dir']).tolist(),
                neck_arm=info['neck']['arm'], neck_row=info['neck']['row'], neck_s_par=info['neck']['s_par'],
                order_monotone=info['order_monotone'],
                tips=tips, L1=float(max(np.linalg.norm(tips, axis=1))), primary_length=info['primary_length'],
                info=info)


# ---- anchors -------------------------------------------------------------------------------------
EPS_VIS = 0.012
EDGE_FADE = PP.EDGE_FADE      # the page fades the frame to transparent over its outer 6 % (index.html); a point inside
                              # that band counts as not visible, as scripts/verify-hero-manifest.mjs requires of anchors


def anchor_rows(scene, cam, ob, pts, res, frozen, tol):
    """per feature: [x, y, visible] or [x1, y1, x2, y2, visible] (frame fractions, origin top-left), plus the
    pixel version. visible needs every point of the feature inside the frame (clear of the page's edge fade) and
    unoccluded (ray cast from the camera; the first hit must be the crystal within tol[id][k] of the point)."""
    dg = bpy.context.evaluated_depsgraph_get()
    cam_loc = np.array(cam.matrix_world.translation, dtype=np.float64)
    rows, rows_px = {}, {}
    for fid, kind, _a, _b in FEATURES:
        row, vis = [], 1
        for k, p in enumerate(pts[fid]):
            p = np.asarray(p, dtype=np.float64)
            co = world_to_camera_view(scene, cam, Vector(p))
            x, y, depth = float(co.x), 1.0 - float(co.y), float(co.z)
            inside = EDGE_FADE <= x <= 1.0 - EDGE_FADE and EDGE_FADE <= y <= 1.0 - EDGE_FADE and depth > 0.0
            row += [min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)]
            if not inside:
                vis = 0
                continue
            if not frozen:
                vis = 0
                continue
            d = p - cam_loc
            dist = float(np.linalg.norm(d))
            hit, loc, _n, _i, hob, _m = scene.ray_cast(dg, Vector(cam_loc), Vector(d / dist), distance=dist + 1.0)
            if hit:
                hd = float((Vector(loc) - Vector(cam_loc)).length)
                if hob.original is not ob and hob is not ob:
                    vis = 0
                elif hd < dist - tol[fid][k]:
                    vis = 0
        rows[fid] = [round(v, 5) for v in row] + [vis]
        rows_px[fid] = [round(v * res, 1) for v in row] + [vis]
    return rows, rows_px


# ---- mesh ----------------------------------------------------------------------------------------
def gen_args(seed, out_build):
    saved = sys.argv
    sys.argv = ['blender', '--', '--seed', str(seed), '--out', out_build, '--name', 'seq', '--no-render']
    try:
        A = DG.parse_args()
    finally:
        sys.argv = saved
    os.makedirs(out_build, exist_ok=True)       # dendrite_gen.build writes its per-t features JSON there
    return A


def mesh_bvh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(ob, dg)


def mesh_waist(bvh, c, t, n_h=49, n_az=24):
    """the root of side arm c as rendered: rays from the arm's axis outward at heights h above the parent's envelope
    surface (0 .. 4 root radii rr); the first hit is the arm's own surface. Two profiles: r(h), the median radius over
    n_az azimuths, and the SILHOUETTE half-width s(h), the mean of the rays along +-X (the trunk axis, which is the
    in-image direction across the arm in a profile view from the side normal) and 10 deg either side of them, i.e.
    the half-width of the outline a viewer sees. The waist is the narrowest silhouette in 0.1 .. 1.3 rr (a ROOT
    neck, just above the fillet onto the trunk); the section above it is the MEDIAN silhouette over 0.75 .. 2.5 rr
    above the waist (a median, so a tertiary's root further up does not pass for a body); the flare is the widest
    silhouette below the waist (that fillet). ratio = waist / above: a pinch reads below ~0.9 when the flare is wider
    than the waist too. Returns a dict (model units) or None."""
    rr = DG.root_rmax(c, t)
    hs = np.linspace(0.0, 4.0 * rr, n_h)
    ang = np.linspace(0.0, 2.0 * math.pi, n_az, endpoint=False)
    dirs = [Vector([float(x) for x in (math.cos(a) * c.e1 + math.sin(a) * c.e2)]) for a in ang]
    xs = PP.unit(X - float(np.dot(X, c.d)) * c.d)
    ys = PP.unit(np.cross(c.d, xs))
    sil = [Vector([float(v) for v in (sg * (math.cos(b) * xs + math.sin(b) * ys))])
           for sg in (1.0, -1.0) for b in (math.radians(-10.0), 0.0, math.radians(10.0))]
    prof = np.full(n_h, np.nan)
    half = np.full(n_h, np.nan)
    for i, h in enumerate(hs):
        p = Vector([float(x) for x in (c.origin + c.d * (c.R_root + h))])
        rs = []
        for v in dirs:
            loc, _n, _i, dist = bvh.ray_cast(p, v, 5.0 * rr)
            if loc is not None:
                rs.append(dist)
        if len(rs) >= n_az // 2:
            prof[i] = float(np.median(rs))
        ss = []
        for v in sil:
            loc, _n, _i, dist = bvh.ray_cast(p, v, 5.0 * rr)
            if loc is not None:
                ss.append(dist)
        if len(ss) == len(sil):
            half[i] = float(np.mean(ss))
    lo = (hs >= 0.1 * rr) & (hs <= 1.3 * rr) & np.isfinite(half)
    if not lo.any():
        return None
    i_n = int(np.flatnonzero(lo)[np.argmin(half[lo])])
    up = (hs >= hs[i_n] + 0.75 * rr) & (hs <= hs[i_n] + 2.5 * rr) & np.isfinite(half)
    below = (hs < hs[i_n]) & np.isfinite(half)
    s_out = float(np.median(half[up])) if up.any() else float('nan')
    return dict(h=[round(float(x), 5) for x in hs], r=[round(float(x), 5) for x in prof],
                s=[round(float(x), 5) for x in half], rr=round(rr, 5), h_neck=round(float(hs[i_n]), 5),
                r_neck=round(float(half[i_n]), 5), r_out=round(s_out, 5),
                ratio=round(float(half[i_n]) / s_out, 4) if s_out > 0 else None,
                flare=round(float(half[below].max()), 5) if below.any() else None)


# ---- preview engine --------------------------------------------------------------------------------------------------
def use_workbench(res):
    """Blender's Workbench engine instead of Cycles: a framing and pacing check at a few seconds per frame (studio
    light, one flat steel grey, cavity shading so the branch rows read; transparent film as the real frames)."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'SINGLE'
    sh.single_color = (0.58, 0.59, 0.61)
    sh.show_specular_highlight = True
    try:
        sh.show_cavity = True
        sh.cavity_type = 'BOTH'
    except Exception:  # noqa
        pass
    try:
        scene.display.render_aa = '8'
    except Exception:  # noqa
        pass
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = True
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    return 'WORKBENCH'


def use_eevee(res, samples):
    """EEVEE (Next) instead of Cycles, with everything else look.py set up kept: the satin-steel Principled material,
    the light rig (the key's trail included) and its warmth, the dark world, Filmic, the exposure, transparent film.
    Screen-space ray tracing gives the metal its reflections of the crystal itself; shadows stay on. A preview of the
    real look at about a second a frame (measured on the Arc 140V at 600 px), not a substitute for the Cycles frames: no
    multiple bounces, softer contact shadows."""
    scene = bpy.context.scene
    items = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in items else 'BLENDER_EEVEE'
    ee = scene.eevee
    ee.taa_render_samples = int(samples)
    for attr, val in (('use_raytracing', True), ('use_shadows', True), ('use_gtao', True)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
    scene.render.film_transparent = True
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    return scene.render.engine


# ---- resume ----------------------------------------------------------------------------------------------------------
RENDER_FIELDS = ('forward', 'right', 'up', 'target', 'P', 'width', 'lens', 'fstop', 'ev', 'kd', 'key_basis')


def render_key(rec_path, mesh_key, engine, res, samples, look_p, exposure, warmth, key_desat):
    """what a frame's pixels depend on, hashed: the camera record's render fields, the mesh, engine / res / samples,
    the look parameters, exposure, warmth and the key's desaturation."""
    blob = dict(cam={k: rec_path.get(k) for k in RENDER_FIELDS}, mesh=mesh_key, engine=engine, res=res,
                samples=samples, look={k: look_p[k] for k in sorted(look_p)}, exposure=round(float(exposure), 6),
                warmth=round(float(warmth), 6), key_desat=round(float(key_desat), 6))
    return hashlib.sha1(json.dumps(blob, sort_keys=True, default=str).encode()).hexdigest()


def png_complete(path):
    """a PNG that was written to its end: the signature and the IEND chunk (a truncated write fails this)."""
    try:
        with open(path, 'rb') as fh:
            head = fh.read(8)
            fh.seek(-12, os.SEEK_END)
            tail = fh.read(12)
    except OSError:
        return False
    return head == b'\x89PNG\r\n\x1a\n' and tail[4:8] == b'IEND'


# ---- CLI -----------------------------------------------------------------------------------------
def parse_frames(spec):
    """'all', 'spread:N' (N frames evenly spread, first and last included), or a comma list of frames and ranges
    'a-b' or 'a-b/step'."""
    if spec in ('all', ''):
        return list(range(N_FRAMES))
    out = []
    if spec.startswith('spread:'):
        n = max(2, int(spec.split(':', 1)[1]))
        return sorted({int(round(i * (N_FRAMES - 1) / float(n - 1))) for i in range(n)})
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
            out += list(range(int(a), int(b) + 1, step))
        else:
            out.append(int(part))
    return sorted({f for f in out if 0 <= f < N_FRAMES})


def parse_args(argv):
    p = argparse.ArgumentParser(description='SOLIDIFY hero v4: render the frame set along path.json (Blender 4.5, headless)')
    p.add_argument('--out', default=DEFAULT_OUT)
    p.add_argument('--path', default=DEFAULT_PATH, help='the camera path (path_plan.py)')
    p.add_argument('--timeline', default=None, help='default hero/timeline.json')
    p.add_argument('--features', default=DEFAULT_FEATURES, help='where the feature points are written (planner input)')
    p.add_argument('--res', type=int, default=1200)
    p.add_argument('--samples', type=int, default=96)
    p.add_argument('--seed', type=int, default=7)
    p.add_argument('--frames', default='all', help='all, spread:30, or e.g. 0-777, 12-95/6, 5,17,120')
    p.add_argument('--force', action='store_true', help='render every requested frame again, whatever exists')
    p.add_argument('--rerender-stale', action='store_true',
                   help='render again the frames whose PNG was rendered from other inputs (path, mesh, look); without '
                        'it such frames stop the run')
    p.add_argument('--features-only', action='store_true',
                   help='build the t = 1 close-up mesh, pick the features (the neck on the mesh), write --features, stop')
    p.add_argument('--refeature', action='store_true', help='pick the features again and rewrite --features')
    p.add_argument('--anchors-only', action='store_true', help='no rendering: path + anchors -> frames.json')
    p.add_argument('--cache-only', action='store_true',
                   help='no rendering: build (or check) the cached meshes of the frame set, then stop (exit 2 when one '
                        'fails the gate)')
    p.add_argument('--prune-cache', action='store_true', help='delete the superseded fingerprint directories of the '
                                                              'mesh cache (meshes no current code can read), then stop')
    p.add_argument('--preview', action='store_true',
                   help='EEVEE at 600 px, 16 samples (unless --workbench / --res / --samples), into <v4>/preview_eevee '
                        '(or <v4>/preview_workbench) unless --out is given')
    p.add_argument('--eevee', action='store_true', help='render with EEVEE (the look.py rig, a fast look preview)')
    p.add_argument('--workbench', action='store_true', help='render with the Workbench engine (framing preview)')
    p.add_argument('--coarse-frozen', action='store_true',
                   help='frozen frames on the generator t = 1 mesh instead of the close-up mesh (previews only)')
    p.add_argument('--no-anchors', action='store_true', help='skip the anchor pass')
    p.add_argument('--key-on-camera', action='store_true',
                   help='keep the key light on the camera (ignore path.json key_basis): an A/B of the trailing key')
    p.add_argument('--gate-soft', action='store_true', help='render a mesh that fails the topology gate (with a warning) '
                                                           'instead of stopping with exit code 2')
    p.add_argument('--allow-stale', action='store_true', help='render on a path.json planned for another timeline, '
                                                             'other features or another generator (a warning only)')
    p.add_argument('--allow-failed-path', action='store_true', help='render on a path.json that failed the planner\'s '
                                                                    'check')
    p.add_argument('--cache', default=MC.DEFAULT_ROOT, help='the mesh cache root (mesh_cache.py)')
    p.add_argument('--no-cache', action='store_true', help='build every mesh, neither read nor write the cache')
    p.add_argument('--verify-cache', action='store_true', help='re-run the topology count on every cached mesh loaded')
    p.add_argument('--build-only', default='', metavar='T,T,...',
                   help='no rendering, no mesh cache: build the mesh at these growth times in this order (through the '
                        'skeleton memo) and print the vertex counts; a memo-safety check against fresh single-t builds')
    p.add_argument('--exposure', type=float, default=-0.3)
    p.add_argument('--cpu', action='store_true')
    p.add_argument('--set', action='append', default=[], metavar='KEY=VALUE', help='look tweak (look.LOOK keys)')
    return p.parse_args(argv)


def atomic_json(path, data):
    tmp = '%s.%d.tmp' % (path, os.getpid())
    with open(tmp, 'w') as fh:
        json.dump(data, fh, indent=1, default=str)
    MC.replace_retry(tmp, path)


def main():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    A_ = parse_args(argv)
    if A_.timeline:
        use_timeline(PP.load_timeline(A_.timeline))
    out = A_.out
    res, samples = A_.res, A_.samples
    frames = parse_frames(A_.frames)
    eevee = A_.eevee or (A_.preview and not A_.workbench)
    if A_.preview:
        if out == DEFAULT_OUT:                           # a preview never lands among the masters (an explicit --out holds)
            out = V4 + ('/preview_workbench' if A_.workbench else '/preview_eevee')
        res = A_.res if A_.res != 1200 else 600          # the defaults shrink; an explicit --res / --samples holds
        samples = A_.samples if A_.samples != 96 else (16 if eevee else 24)
    os.makedirs(out, exist_ok=True)
    log_path = os.path.join(out, 'render_log.txt')

    def log(msg):
        print(msg)
        sys.stdout.flush()
        with open(log_path, 'a') as fh:
            fh.write(time.strftime('%Y-%m-%d %H:%M:%S  ') + msg + '\n')

    fpath = os.path.join(out, 'frames.json')
    data = {'meta': {}, 'frames': {}}
    if os.path.isfile(fpath):
        try:
            with open(fpath) as fh:
                data = json.load(fh)
        except Exception as e:  # noqa
            print('[seq] could not read previous frames.json (%s); starting fresh' % e)

    tweaks = look.parse_set(A_.set)
    tweaks.setdefault('emission', 0.0)           # round 4: no glow anywhere (a --set emission=1 still allows it)
    L = look.Look(res=res, samples=samples, cpu=A_.cpu, exposure=A_.exposure, **tweaks)
    L.setup(clear=True)
    L.set_heat(0.0)
    engine = use_workbench(res) if A_.workbench else (use_eevee(res, samples) if eevee else 'CYCLES')
    A = gen_args(A_.seed, os.path.join(out, 'build'))
    cache = MC.MeshCache(A, root=A_.cache, read=not A_.no_cache, write=not A_.no_cache, verify=A_.verify_cache, log=log)
    log('[seq] start: out=%s res=%d samples=%d seed=%d engine=%s device=%s frames=%s (%d frames in the timeline %s); '
        'mesh cache %s%s' % (out, res, samples, A_.seed, engine, L.device, A_.frames, N_FRAMES, TL['_path'], cache.dir,
                             ' (off: --no-cache)' if A_.no_cache else ''))

    if A_.prune_cache:
        gone = cache.prune()
        log('[seq] prune: kept %s; deleted %d superseded fingerprint directories (%.1f MB): %s' % (
            cache.dir, len(gone), sum(b for _d, b in gone) / 1e6, [os.path.basename(d) for d, _b in gone]))
        return

    if A_.build_only:
        for t in [float(x) for x in A_.build_only.split(',') if x.strip()]:
            ob, meta = MC.build_gen(A, t)
            L.adopt(ob)
            log('[seq] build-only t=%.4f: %d verts, gate %s, %.1fs (alive arms %s)' % (
                t, len(ob.data.vertices), meta['gate'], meta['build_seconds'], json.dumps(meta['counts'])))
        return

    def cache_note(kind, t, secs, how):
        return '%s %s t=%.4f in %.1fs' % ('loaded' if how == 'hit' else 'built and cached' if not A_.no_cache else 'built',
                                           kind, t, secs)

    def gate_stop(what):
        """a mesh failed the topology gate: stop (exit code 2) unless --gate-soft."""
        if A_.gate_soft:
            log('[seq] WARNING (--gate-soft): %s FAILS the topology gate (one closed genus-0 surface); rendering it' % what)
            return
        log('[seq] %s FAILS the topology gate (one closed genus-0 surface): stopping (--gate-soft renders it)' % what)
        sys.stdout.flush()
        sys.exit(DG.GATE_EXIT_CODE)

    # the frozen crystal first: the close-up mesh (every frozen frame renders it, and the neck is picked on it), the
    # features, the planner's features file. With --coarse-frozen the generator's t = 1 mesh stands in for it.
    coll = bpy.context.scene.collection
    kind_z = 'gen' if A_.coarse_frozen else 'fine'
    obz, meta_z, secs_z, how_z = cache.get(kind_z, 1.0)
    okz = meta_z['gate'] == 'PASS'
    reach1 = float(meta_z['reach'])
    topo_z = dict(meta_z['topology'], voxel=meta_z['voxel'])
    mesh_note = ('generator mesh, voxel %.4f (--coarse-frozen)' % A.voxel) if A_.coarse_frozen else \
        ('close-up mesh, voxel %.4f' % FINE_VOXEL)
    log('[seq] frozen mesh (%s, t = 1): %d verts, gate %s (chi %d, %d component(s), genus %s); %s' % (
        mesh_note, topo_z['vertices'], meta_z['gate'], topo_z['euler_characteristic'], topo_z['components'],
        topo_z['genus_total'], cache_note(kind_z, 1.0, secs_z, how_z)))
    if not okz:
        gate_stop('the frozen mesh (%s)' % mesh_note)

    if A_.cache_only:
        # the growth meshes of the frame set, in increasing t (each built once, gated, stored; a cached one is checked)
        ts = sorted({PP.t_of(TL, f) for f in frames if not PP.frozen(TL, f)})
        log('[seq] cache only: %d growth meshes for %d frames' % (len(ts), len(frames)))
        t_run0 = time.perf_counter()
        fails = [] if okz else [1.0]
        for k, t in enumerate(ts):
            ob, meta, secs, how = cache.get('gen', t)
            if meta['gate'] != 'PASS':
                fails.append(round(t, 5))
            log('[seq] cache %d/%d: %s, %d verts, gate %s (chi %s, %s component(s)), emerging arms %s | %.1f min '
                'elapsed' % (k + 1, len(ts), cache_note('gen', t, secs, how), meta['vertices'], meta['gate'],
                             meta['topology'].get('euler_characteristic'), meta['topology'].get('components'),
                             meta['counts'].get('emerging'), (time.perf_counter() - t_run0) / 60.0))
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
        st = cache.stats
        log('[seq] cache only: done, %d built (%.1f s), %d loaded (%.1f s), %.1f MB written; gate failures: %s' % (
            st['build'], st['build_s'], st['hit'], st['load_s'], st['bytes'] / 1e6, fails or 'none'))
        if fails:
            sys.stdout.flush()
            sys.exit(DG.GATE_EXIT_CODE)
        return

    L.adopt(obz)
    bpy.context.view_layer.update()
    # the feature points: reused from the features file when it was picked on this very frozen mesh by these picks
    # (its key); --features-only / --refeature pick them again (the skeleton at t = 1 is needed for that, ~1 min). Any
    # other run stops on a stale features file (the path was planned on it); a --coarse-frozen preview keeps and
    # refreshes its own copy.
    feat_path = os.path.join(out, 'features_coarse.json') if A_.coarse_frozen else A_.features
    fkey = features_key(meta_z['key'])
    fj = None
    repick = A_.features_only or A_.refeature
    if not repick and os.path.isfile(feat_path):
        try:
            with open(feat_path) as fh:
                fj = json.load(fh)
        except Exception as e:  # noqa
            log('[seq] could not read %s (%s)' % (feat_path, e))
        if fj is not None and fj.get('key') != fkey:
            if not A_.coarse_frozen:
                raise SystemExit('%s was picked on another frozen mesh or by other picks: run --features-only (then '
                                 'path_plan.py) first' % feat_path)
            log('[seq] %s is stale: picking again (preview copy)' % feat_path)
            fj = None
    elif not repick and not A_.coarse_frozen:
        raise SystemExit('no features file at %s: run --features-only (then path_plan.py) first' % feat_path)
    if fj is None:
        armsz = MC.skeleton_at(A, 1.0)
        feats1 = DG.extract_features(armsz, 1.0, A, A.seed)
        pts_n, finfo_n = feature_points(obz, armsz, feats1, A, log=log)
        tol_n = feature_tolerances(obz, pts_n)
        fj = features_json(pts_n, finfo_n, feats1, mesh_note)
        fj['tolerances'] = tol_n    # the occlusion allowance per point (the planner's approximate occlusion test uses it)
        fj['key'] = fkey
        fj['mesh_key'] = meta_z['key']
        # the planner's input comes from the close-up mesh only: a --coarse-frozen (preview) run writes its own copy
        os.makedirs(os.path.dirname(os.path.abspath(feat_path)), exist_ok=True)
        atomic_json(feat_path, fj)
        log('[seq] features -> %s' % feat_path)
    else:
        log('[seq] features <- %s (current: picked on this frozen mesh by these picks)' % feat_path)
    pts = {fid: [np.asarray(p, dtype=np.float64) for p in fj['points'][fid]] for fid, _k, _a, _b in FEATURES}
    tol = {fid: [float(x) for x in fj['tolerances'][fid]] for fid, _k, _a, _b in FEATURES}
    finfo = fj['info']
    log('[seq] neck: arm %d, row %d, s_par %.3f (%.2f L), mesh waist ratio %.3f; tertiary: %s; lambda2: %s; along the arm '
        '%s (monotone %s)' % (
            finfo['neck']['arm'], finfo['neck']['row'], finfo['neck']['s_par'], finfo['neck']['s_par_over_L'],
            finfo['neck']['mesh_waist_ratio'], json.dumps({k: finfo['tertiary'].get(k) for k in ('arm', 'host_arm', 'length')}),
            json.dumps({k: finfo['lambda2'].get(k) for k in ('arms', 'spacing', 'channel_open')}),
            json.dumps(finfo.get('x_along_arm')), finfo.get('order_monotone')))
    if A_.features_only:
        log('[seq] features only: done (next: python hero/path_plan.py)')
        return

    gen_fp = PP.gen_fingerprint(DG, A)[0]
    S = PathCamera(A_.path, features_key=None if A_.coarse_frozen else fkey, gen_fp=gen_fp, allow_stale=A_.allow_stale,
                   allow_failed=A_.allow_failed_path, log=log)
    fm = S.meta.get('features') or {}
    if fm.get('points') and A_.coarse_frozen:
        drift = max(float(np.linalg.norm(np.asarray(fm['points'][fid]) - np.asarray(fj['points'][fid])))
                    for fid, _k, _a, _b in FEATURES)
        if drift > 1e-4:
            log('[seq] note: the coarse mesh puts the features up to %.4f away from the close-up mesh the path was '
                'planned on (preview only)' % drift)
    log('[seq] features: ' + json.dumps(finfo))
    log('[seq] visibility tolerances: ' + json.dumps({k: [round(x, 4) for x in v] for k, v in tol.items()}))
    data['meta'].update(dict(
        version=4, seed=A_.seed, res=res, samples=samples, engine=engine, device=L.device, exposure=A_.exposure,
        look=dict(L.p), emission=0.0, timeline=TL['_path'], frames=N_FRAMES, px_per_frame=TL['px_per_frame'],
        warmth='1 until frame %d, cosine to 0 at frame %d' % (TL['warmth']['from'], TL['warmth']['to']),
        growth='t %s linear over frames %d-%d' % (TL['growth']['t'], TL['growth']['from'], TL['growth']['to']),
        path=S.path, path_generated=S.meta.get('generated'), path_ok=S.meta.get('ok'), path_stale=S.stale,
        key_light='on the camera (--key-on-camera)' if A_.key_on_camera else S.meta.get('key_light'),
        gate_soft=bool(A_.gate_soft),
        features=finfo, tolerances=tol,
        chapters=[dict(id=n, **{'from': a, 'to': b}) for n, a, b in CHAPTERS],
        feature_windows=[dict(id=n, kind=k, **{'from': a, 'to': b}) for n, k, a, b in FEATURES],
        frozen_mesh=dict(from_frame=TL['growth']['to'], note=mesh_note, key=meta_z['key'], cache=how_z,
                         seconds=round(secs_z, 1), build_seconds=meta_z.get('build_seconds'), topology=topo_z),
        mesh_cache=cache.dir, emergence=dict(ramp_rho=DG.EMERGE_RHO, bury_rho=DG.EMERGE_BURY, tip_k=DG.EMERGE_TIP_K,
                                             tip_lead_rho=DG.EMERGE_TIP_LEAD),
        blender=bpy.app.version_string, generated=time.strftime('%Y-%m-%d %H:%M:%S')))
    atomic_json(fpath, data)

    scene = bpy.context.scene
    cur = dict(t=1.0, ob=obz, reach=reach1, ok=okz, how='kept', verts=topo_z['vertices'])

    def ensure_mesh(t):
        """the mesh frame i renders: the frozen mesh for t = 1 (kept for the whole run, unlinked while not in use),
        the generator's for any other t (from the cache or built into it, then dropped after its frame).
        Returns the seconds it took to get it."""
        if abs(t - cur['t']) < 1e-9 and cur['ob'] is not None:
            cur['how'] = 'kept'
            return 0.0
        if abs(cur['t'] - 1.0) < 1e-9 and L.ob is not None:       # park the kept mesh (L.adopt would delete it)
            if L.ob.name in coll.objects:
                coll.objects.unlink(L.ob)
            L.ob = None
        secs, how = 0.0, 'kept'
        if abs(t - 1.0) < 1e-9:
            ob, ok, reach = obz, okz, reach1
            if ob.name not in coll.objects:
                coll.objects.link(ob)
        else:
            ob, meta, secs, how = cache.get('gen', t)
            reach, ok = float(meta['reach']), meta['gate'] == 'PASS'
            if not ok:
                gate_stop('the generator mesh at t=%.5f' % t)
        L.adopt(ob)
        bpy.context.view_layer.update()
        cur.update(t=t, ob=ob, reach=reach, ok=ok, how=how, verts=len(ob.data.vertices))
        return secs

    key_desat0 = L.p['key_desat']                      # the neutral rig's key desaturation; the path adds its kd

    def frame_inputs(f):
        """(t, frozen, mesh key, warmth, key desaturation, render key) of frame f."""
        t = PP.t_of(TL, f)
        fz = PP.frozen(TL, f)
        mk = meta_z['key'] if fz else cache.key('gen', t)
        w = PP.warmth_of(TL, f)
        kds = min(key_desat0 + S.rec(f).get('kd', 0.0), 1.0)
        return t, fz, mk, w, kds, render_key(S.rec(f), mk, engine, res, samples,
                                             dict(L.p, key_desat=key_desat0, key_on_camera=bool(A_.key_on_camera)),
                                             A_.exposure, w, kds)

    # ---- render pass ------------------------------------------------------------------------------
    todo, stale, broken = [], [], []
    for f in frames:
        png = os.path.join(out, 'f%03d.png' % f)
        if A_.force or not os.path.isfile(png):
            todo.append(f)
            continue
        if not png_complete(png):
            broken.append(f)
            todo.append(f)
            continue
        if data['frames'].get(str(f), {}).get('render_key') != frame_inputs(f)[5]:
            stale.append(f)
    if broken:
        log('[seq] %d truncated PNGs will be rendered again: %s' % (len(broken), broken[:20]))
    if stale and not A_.anchors_only:
        if not A_.rerender_stale:
            raise SystemExit('[seq] %d existing frames were rendered from other inputs (path, mesh or look) or carry no '
                             'render key: %s%s. Pass --rerender-stale to render them again (or --force for every '
                             'requested frame).' % (len(stale), stale[:20], ' ...' if len(stale) > 20 else ''))
        log('[seq] %d stale frames will be rendered again (--rerender-stale): %s' % (len(stale), stale[:20]))
        todo += stale
    if A_.anchors_only:
        todo = []
    # growth frames in increasing t, then the frozen frames (one mesh swap)
    todo = sorted(set(todo), key=lambda f: (PP.frozen(TL, f), f))
    log('[seq] frames to render: %d of %d requested (%s)' % (len(todo), len(frames), 'preview' if A_.preview else 'final'))
    t_run0 = time.perf_counter()
    done = 0
    if engine == 'CYCLES':
        scene.cycles.samples = samples
    for f in todo:
        t, fz, mk, w, kds, rkey = frame_inputs(f)
        build_s = ensure_mesh(1.0 if fz else t)
        scene.render.use_persistent_data = fz               # the mesh stops changing at the frozen frames
        st, view = S.view(f)
        rec_p = S.rec(f)
        kf = None if A_.key_on_camera else PP.key_frame_of(rec_p)
        cam = L.frame(view, light_frames={'Key': kf} if kf is not None else None)
        L.p['key_desat'] = kds
        L.set_warmth(w)
        L.set_growth(cur['reach'], t, DG.nucleus_radius(A, t))      # the age term of the roughness is normalized by t
        cur['ob'].scale = (1.0, 1.0, 1.0)
        png = os.path.join(out, 'f%03d.png' % f)
        part = os.path.join(out, 'f%03d.part.png' % f)
        secs = L.render(part)
        if not png_complete(part):
            raise SystemExit('[seq] frame %d: the render did not write a complete PNG (%s)' % (f, part))
        MC.replace_retry(part, png)
        rec = dict(chapter=chapter_of(f), t=round(t, 5), warmth=round(w, 5), scale=1.0, reach=round(cur['reach'], 5),
                   mesh=('frozen: ' + mesh_note) if fz else 'generator', voxel=topo_z.get('voxel') if fz else A.voxel,
                   mesh_key=mk, verts=cur['verts'], gate='PASS' if cur['ok'] else 'FAIL', mesh_seconds=round(build_s, 2),
                   mesh_from=cur['how'], render_seconds=secs, samples=samples, engine=engine, render_key=rkey,
                   key_offset_deg=rec_p.get('key_offset_deg'),
                   state={k: (round(v, 5) if isinstance(v, float) else v) for k, v in st.items()},
                   camera=dict(dist=cam['dist'], target=cam['target'], lens=cam['lens'], fstop=cam['fstop'],
                               exposure=cam['exposure']))
        data['frames'].setdefault(str(f), {}).update(rec)
        atomic_json(fpath, data)
        done += 1
        el = time.perf_counter() - t_run0
        log('[seq] frame %03d  %-8s t=%.3f w=%.2f  mesh %5.1fs (%-5s) render %5.1fs  | %d/%d done, %.1f min elapsed, '
            '~%.1f min left' % (f, rec['chapter'], t, w, build_s, cur['how'], secs, done, len(todo), el / 60.0,
                                el / 60.0 / done * (len(todo) - done)))
    L.p['key_desat'] = key_desat0
    st_c = cache.stats
    log('[seq] meshes this run: %d built (%.1f s, %.1f MB cached), %d loaded from the cache (%.1f s)' % (
        st_c['build'], st_c['build_s'], st_c['bytes'] / 1e6, st_c['hit'], st_c['load_s']))

    if A_.no_anchors:
        log('[seq] done (no anchor pass): %d rendered, %.1f min' % (done, (time.perf_counter() - t_run0) / 60.0))
        return
    # ---- anchor pass (every frame, on the frozen mesh the frozen frames render) ------------------------------------
    t0 = time.perf_counter()
    ensure_mesh(1.0)
    cur['ob'].scale = (1.0, 1.0, 1.0)
    L.set_warmth(0.0)
    L.set_growth(reach1, 1.0, DG.nucleus_radius(A, 1.0))
    for f in range(N_FRAMES):
        st, view = S.view(f)
        cam = L.frame(view)
        bpy.context.view_layer.update()
        rows, rows_px = anchor_rows(scene, L.cam, cur['ob'], pts, res, frozen=PP.frozen(TL, f), tol=tol)
        rec = data['frames'].setdefault(str(f), {})
        rec.update(dict(chapter=chapter_of(f), t=round(PP.t_of(TL, f), 5), warmth=round(PP.warmth_of(TL, f), 5),
                        scale=1.0, anchors=rows, anchors_px=rows_px, anchor_mesh=mesh_note,
                        state={k: (round(v, 5) if isinstance(v, float) else v) for k, v in st.items()},
                        camera=dict(dist=cam['dist'], target=cam['target'], lens=cam['lens'], fstop=cam['fstop'],
                                    exposure=cam['exposure'])))
    tour = [c for c in TL['chapters'] if c['id'] == 'tour'][0]
    after = range(tour['from'], N_FRAMES)
    cands = [f for f in after if all(data['frames'][str(f)]['anchors'][fid][-1] == 1 for fid, _k, _a, _b in FEATURES)]
    pf = int(TL['poster'])
    pvis = {fid: data['frames'][str(pf)]['anchors'][fid][-1] for fid, _k, _a, _b in FEATURES}
    data['meta']['poster_candidates'] = cands
    data['meta']['poster_frame'] = pf
    data['meta']['poster_visible'] = pvis
    per, per_hold, side = {}, {}, {}
    for fe in TL['features']:
        fid, a, b = fe['id'], fe['from'], fe['to']
        h0, h1 = fe['hold']
        per[fid] = '%d/%d' % (sum(1 for f in range(a, b + 1) if data['frames'][str(f)]['anchors'][fid][-1] == 1), b - a + 1)
        per_hold[fid] = '%d/%d' % (sum(1 for f in range(h0, h1 + 1) if data['frames'][str(f)]['anchors'][fid][-1] == 1),
                                   h1 - h0 + 1)
        xs = [float(np.mean(data['frames'][str(f)]['anchors'][fid][0:-1:2])) for f in range(h0, h1 + 1)]
        lab = LABEL_SIDE.get(fid)
        ok = (lab == 'right' and max(xs) < 0.62) or (lab == 'left' and min(xs) > 0.38) or lab not in ('left', 'right')
        side[fid] = dict(label=lab, anchor_x=[round(min(xs), 3), round(max(xs), 3)], ok=bool(ok))
    data['meta']['visible_in_window'] = per
    data['meta']['visible_in_hold'] = per_hold
    data['meta']['label_side'] = side
    steps = []
    for f in range(1, N_FRAMES):
        r1 = S.rec(f)
        steps.append((round(max(r1.get('turn', 0.0), r1.get('twist', 0.0)), 3), f))
    data['meta']['max_angle_step_deg'] = max(steps)
    atomic_json(fpath, data)
    log('[seq] anchors for %d frames in %.1fs; visible in window %s; in hold %s; label sides %s; poster frame %d visible %s; '
        'poster candidates %d (%s..)' % (
            N_FRAMES, time.perf_counter() - t0, json.dumps(per), json.dumps(per_hold),
            json.dumps({k: v['ok'] for k, v in side.items()}), pf, json.dumps(pvis), len(cands), cands[:6]))
    have = sum(1 for f in range(N_FRAMES) if os.path.isfile(os.path.join(out, 'f%03d.png' % f)))
    log('[seq] done: %d/%d PNGs in %s, %.1f min this run' % (have, N_FRAMES, out, (time.perf_counter() - t_run0) / 60.0))
    log('[seq] frames.json -> ' + fpath)


if __name__ == '__main__':
    main()
