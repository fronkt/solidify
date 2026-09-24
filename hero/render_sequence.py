"""
render_sequence.py -- the SOLIDIFY landing hero: 180 scroll-scrubbed frames of a cubic metal dendrite
growing, cooling and being toured (Blender 4.5 LTS, headless, Cycles on the Intel Arc via oneAPI).

  blender.exe -b --factory-startup --python hero/render_sequence.py -- [--out C:/Users/frank/solidify-hero-out/v3/seq]
      [--res 1200] [--samples 96] [--seed 7] [--frames 0-179] [--force] [--anchors-only] [--preview]
      [--build-only 1.0,0.6,0.3] [--set k=v ...]

What it does, per frame i (frame set contract, see README.md):
  seed  0-11    the t = 0.03 crystal (a nucleus with six stubs), scaled 0.25 -> 1 so a tiny steel point appears
  grow  12-95   growth time t = 0.03 -> 1.0 (ease-out); the mesh is REBUILT every frame with dendrite_gen.build
                (same seed), the camera dollies out so the crystal spans ~15 % -> ~78 % of the frame height while
                turning slowly
  cool  96-119  the light rig eases from warm to neutral (look.Look.set_warmth 1 -> 0, smoothstep); the turn
                continues to the three-quarter rest at frame 120
  tour  120-179 the frozen t = 1 crystal; the camera eases from one feature to the next, holding on each well
                inside its window (tip 122-133, primary 134-145, lambda2 146-157, tertiary 158-167, neck
                168-179), each anchor kept on the side of the frame away from its label
Look (round 4, final): NO emission in any frame (look.Look(emission=0)); the metal is satin steel throughout and the
freeze is told with light alone: through seed and grow the key is ~2600 K with a faint warm bounce from below, and
across the cool chapter every lamp eases to the neutral rig (key 3200 K, rim 7000 K). No bloom, no compositing.
Camera: one smooth path. Every parameter (azimuth, elevation, roll, log width, target point, on-screen anchor
position, lens, log f-stop, exposure) is keyed and eased (smoothstep) between keys, so there is no jump between
consecutive frames. The frame width through seed / grow / cool is the projected extent of the t = 1 tip octahedron
AT THAT FRAME'S ORIENTATION, scaled by t and combined with the nucleus, divided by the wanted span, so the crystal
spans 0.78 of the frame height from frame 95 on whatever the turn does. The light rig rides in camera space
(look.py), so every frame shares one light geometry.
Anchors: the five feature points (from the generator's own skeleton at t = 1) are projected with
bpy_extras.object_utils.world_to_camera_view and tested for occlusion with scene.ray_cast from the camera;
visible = 1 only if the first surface the ray meets is the crystal within the point's own surface distance.
Frames before the crystal has reached t = 1 (i < 95) carry visible = 0: the frozen features do not exist yet.
Resumable: a frame whose PNG already exists is skipped (unless --force); the anchor pass runs over all 180
frames at the end of every run and writes seq/frames.json, which encode_frames.py reads. Every frame's build and
render seconds go to stdout and to <out>/render_log.txt.
Speed: dendrite_gen.build_skeleton (the stations, vigor, space limits and the clearance caps; 50-60 s, mostly the
clearance pass at 13 growth times) does not depend on t, so it is memoized per parameter set for the run
(cached_build_skeleton below) and each grow frame costs only the SDF -> mesh step (3-30 s) plus the render.
--build-only 1.0,0.6,0.3 builds those times in that order through the cache and prints the vertex counts, which
must equal a fresh single-t build's (the check that the cache is safe).
Outputs (all under --out): f000.png .. f179.png (1200 x 1200 RGBA, transparent film, straight alpha), frames.json
(per frame: t, warmth, camera, anchors, seconds, topology gate), render_log.txt, build/ (the generator's per-t
feature files).
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import dendrite_gen as DG   # noqa: E402
import look                  # noqa: E402

# ---- frame set contract --------------------------------------------------------------------------
N_FRAMES = 180
CHAPTERS = [('seed', 0, 11), ('grow', 12, 95), ('cool', 96, 119), ('tour', 120, 179)]
FEATURES = [('tip', 'point', 122, 133), ('primary', 'pair', 134, 145), ('lambda2', 'pair', 146, 157),
            ('tertiary', 'point', 158, 167), ('neck', 'point', 168, 179)]
LABEL_SIDE = {'tip': 'left', 'primary': 'left', 'lambda2': 'right', 'tertiary': 'right', 'neck': 'right'}
T0 = 0.03
GROW0, GROW1 = 12, 95
COOL0, COOL1 = 96, 119
TOUR0 = 120
SPAN0, SPAN1 = 0.15, 0.78          # fraction of the frame height the crystal spans at the start / end of grow
HERO_FROM = (1.0, -1.45, 0.75)     # the three-quarter rest (look.py's hero view): azimuth -55, elevation 23
# the turn from frame 0 to the rest at 120: 25 deg of azimuth (from -80, ten degrees short of the x = 0 mirror
# plane, where the crystal reads as a flat cross) and 22 deg of elevation (from 45 down to 23), so the camera
# never sits in an axis plane of the cube while the crystal grows
TURN_DEG = 25.0
TURN_EL = 22.0
DEFAULT_OUT = 'C:/Users/frank/solidify-hero-out/v3/seq'
X, Y, Z = np.eye(3)


# ---- skeleton cache ------------------------------------------------------------------------------
_SKELETONS = {}
_build_skeleton_fresh = DG.build_skeleton
_SKELETON_KEYS = ('seed', 'tip_radius', 'arm_length', 'rho_ratio', 'rho_ratio_tertiary', 'onset', 'lambda0',
                  'coarsen_tau', 'tertiary_density', 'neck', 'speed_ratio', 'voxel', 'fillet', 'only_arms',
                  'no_clearance')


def cached_build_skeleton(A, rng):
    """dendrite_gen.build_skeleton once per parameter set. The skeleton is t-independent (stations, vigor,
    space limits, births, the clearance caps); build() follows this call with update_states(arms, t, A), which
    rewrites every per-time field (age, L, R_root, alive, k_neck, w_free, w_now, r_cap) from the static ones,
    so the same Arm objects serve every t. The rng is consumed only on the first call; nothing after
    build_skeleton draws from it."""
    key = tuple((k, getattr(A, k, None)) for k in _SKELETON_KEYS)
    if key not in _SKELETONS:
        t0 = time.perf_counter()
        _SKELETONS[key] = _build_skeleton_fresh(A, rng)
        print('[seq] skeleton built in %.1fs (memoized for this run)' % (time.perf_counter() - t0))
    return _SKELETONS[key]


DG.build_skeleton = cached_build_skeleton


def smoothstep(x):
    x = min(1.0, max(0.0, float(x)))
    return x * x * (3.0 - 2.0 * x)


def chapter_of(f):
    for name, a, b in CHAPTERS:
        if a <= f <= b:
            return name
    raise ValueError(f)


def t_of(f):
    """growth time: T0 through the seed, ease-out to 1.0 at frame 95, 1.0 after."""
    if f <= GROW0:
        return T0
    if f >= GROW1:
        return 1.0
    u = (f - GROW0) / float(GROW1 - GROW0)
    return T0 + (1.0 - T0) * (1.0 - (1.0 - u) ** 1.8)


def warmth_of(f):
    """the light rig: warm (1) through seed and grow, easing to the neutral rig (0) across the cool chapter."""
    if f <= GROW1:
        return 1.0
    if f >= COOL1:
        return 0.0
    return 1.0 - smoothstep((f - GROW1) / float(COOL1 - GROW1))


def scale_of(f):
    """the seed: the nucleus appears (object scale 0.25 -> 1 over frames 0-12)."""
    if f >= GROW0:
        return 1.0
    return 0.25 + 0.75 * smoothstep(f / float(GROW0))


def span_of(f):
    if f <= GROW0:
        return SPAN0
    if f >= GROW1:
        return SPAN1
    return SPAN0 + (SPAN1 - SPAN0) * smoothstep((f - GROW0) / float(GROW1 - GROW0))


# ---- camera geometry -----------------------------------------------------------------------------
def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def dir_from_angles(az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    return np.array([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)])


def angles_of(v):
    v = unit(v)
    return math.degrees(math.atan2(v[1], v[0])), math.degrees(math.atan2(v[2], math.hypot(v[0], v[1])))


def basis(frm, roll_deg=0.0):
    """camera basis for a camera looking FROM direction `frm` toward the target, rolled about its axis:
    f forward, r right, u up (roll 0 = world z up)."""
    f = -unit(frm)
    r0 = unit(np.cross(f, Z))
    u0 = np.cross(r0, f)
    c, s = math.cos(math.radians(roll_deg)), math.sin(math.radians(roll_deg))
    return f, c * r0 + s * u0, -s * r0 + c * u0


def screen_angle(d, f, r, u):
    """angle (deg) of world direction d on screen: x right, y DOWN (0 = right, -90 = up)."""
    return math.degrees(math.atan2(-float(np.dot(d, u)), float(np.dot(d, r))))


def roll_for(frm, axis, theta_deg):
    """the roll that puts world direction `axis` at screen angle theta (screen angle = angle at roll 0 + roll)."""
    f, r0, u0 = basis(frm, 0.0)
    return theta_deg - screen_angle(np.asarray(axis, dtype=np.float64), f, r0, u0)


def projected_extent(points, f, r, u):
    """on-screen extent of points in frame-width units at the target depth: the length of a pair, the
    larger axis extent of a cloud."""
    p = np.asarray(points, dtype=np.float64)
    if len(p) == 2:
        return float(math.hypot(np.ptp(p @ r), np.ptp(p @ u)))
    return max(np.ptp(p @ r), np.ptp(p @ u))


def key(frame, frm, width, P, sx=0.5, sy=0.5, roll=None, axis=X, theta=-30.0, lens=55.0, fstop=16.0, ev=0.0,
        span_pts=None, span_frac=None):
    """one camera key. frm = direction the camera looks from; width = frame width at the target depth (model
    units), or derived from span_pts / span_frac (projected extent of the points / fraction of the frame);
    P = the world point that must project at (sx, sy) (frame fractions, origin top-left); roll from `axis`
    at screen angle `theta` unless given directly."""
    az, el = angles_of(frm)
    if roll is None:
        roll = roll_for(frm, axis, theta)
    if width is None:
        f, r, u = basis(frm, roll)
        width = projected_extent(span_pts, f, r, u) / float(span_frac)
    return dict(f=int(frame), az=float(az), el=float(el), roll=float(roll), lens=float(lens), width=float(width),
                P=[float(x) for x in P], sx=float(sx), sy=float(sy), fstop=float(fstop), ev=float(ev))


def _unwrap(keys, name):
    for i in range(1, len(keys)):
        a, b = keys[i - 1][name], keys[i][name]
        while b - a > 180.0:
            b -= 360.0
        while b - a < -180.0:
            b += 360.0
        keys[i][name] = b


def interp_keys(keys, f):
    """piecewise smoothstep between keys (ease in / out at every key); log space for width and fstop."""
    ks = sorted(keys, key=lambda k: k['f'])
    if f <= ks[0]['f']:
        return dict(ks[0])
    if f >= ks[-1]['f']:
        return dict(ks[-1])
    for k0, k1 in zip(ks[:-1], ks[1:]):
        if k0['f'] <= f <= k1['f']:
            break
    w = smoothstep((f - k0['f']) / float(max(k1['f'] - k0['f'], 1)))
    out = {'f': f}
    for name in ('az', 'el', 'roll', 'lens', 'sx', 'sy', 'ev'):
        out[name] = k0[name] + (k1[name] - k0[name]) * w
    for name in ('width', 'fstop'):
        out[name] = math.exp(math.log(k0[name]) + (math.log(k1[name]) - math.log(k0[name])) * w)
    out['P'] = [a + (b - a) * w for a, b in zip(k0['P'], k1['P'])]
    return out


def side_normal(nd):
    """for a side arm pointing along nd (a <100> direction perpendicular to the +x trunk): the direction to look
    FROM to see the arm in profile next to the trunk, i.e. perpendicular to both, on the side the rest of the
    tour's cameras are on (-y / +z)."""
    n = unit(np.cross(X, unit(nd)))
    if float(np.dot(n, np.array([0.0, -1.0, 1.0]))) < 0.0:
        n = -n
    return n


# ---- schedule ------------------------------------------------------------------------------------
class Schedule:
    """everything about frame i except the mesh itself."""

    def __init__(self, A, tips, extra_pts):
        self.A = A
        az_h, el_h = angles_of(HERO_FROM)
        self.turn = [dict(f=0, az=az_h - TURN_DEG, el=el_h + TURN_EL), dict(f=TOUR0, az=az_h, el=el_h)]
        # the t = 1 tip octahedron (plus the center): its projected extent at a frame's orientation is the
        # crystal's on-screen span, since every side branch stays inside it
        self.tips = np.vstack([np.asarray(tips, dtype=np.float64), np.zeros((1, 3))])
        self.L1 = float(np.linalg.norm(tips, axis=1).max())
        self.pts = extra_pts             # feature points, for the tour keys
        self.keys = self.tour_keys()

    def turn_state(self, f):
        w = smoothstep(f / float(TOUR0))
        k0, k1 = self.turn
        return dict(az=k0['az'] + (k1['az'] - k0['az']) * w, el=k0['el'] + (k1['el'] - k0['el']) * w)

    def arm_extent(self, f):
        """projected extent (frame-width units at the target depth) of the t = 1 tips at frame f's orientation."""
        st = self.turn_state(f)
        fv, r, u = basis(dir_from_angles(st['az'], st['el']), 0.0)
        return projected_extent(self.tips, fv, r, u)

    def extent(self, f, t):
        e_arms = self.arm_extent(f) * t          # the primary length is linear in t (dendrite_gen.length_at)
        e_nuc = 2.1 * DG.nucleus_radius(self.A, t)
        return (e_arms ** 6 + e_nuc ** 6) ** (1.0 / 6.0)

    def width_full(self, f):
        return self.extent(f, t_of(f)) / span_of(f)

    def full_state(self, f):
        st = self.turn_state(f)
        return dict(f=f, az=st['az'], el=st['el'], roll=0.0, lens=55.0, width=self.width_full(f),
                    P=[0.0, 0.0, 0.0], sx=0.5, sy=0.5, fstop=16.0, ev=0.0)

    def tour_keys(self):
        P = self.pts
        tip = P['tip'][0]
        pa, pb = P['primary']
        la, lb = P['lambda2']
        te = P['tertiary'][0]
        ne = P['neck'][0]
        nd = unit(np.asarray(P['neck_dir']))
        mid = lambda a, b: [(x + y) / 2.0 for x, y in zip(a, b)]
        # the rest at 120, re-expressed with the tip as its anchor point (same camera: target stays the origin), so
        # the glide into the tip view moves the tip's screen position monotonically instead of swinging it out to
        # the frame edge halfway
        k0 = self.full_state(TOUR0)
        f0, r0, u0 = basis(dir_from_angles(k0['az'], k0['el']), k0['roll'])
        k0['P'] = [float(x) for x in tip]
        k0['sx'] = 0.5 + float(np.dot(tip, r0)) / k0['width']
        k0['sy'] = 0.5 - float(np.dot(tip, u0)) / k0['width']
        ks = [k0]
        # tip: from the side, a little in front and above; the arm rises to the right, the tip on the right
        # (label left)
        ks.append(key(126, (0.42, -0.86, 0.46), 0.46, tip, 0.66, 0.44, axis=X, theta=-26, lens=65, fstop=6.0, ev=-0.1))
        ks.append(key(131, (0.50, -0.84, 0.42), 0.46, tip, 0.66, 0.44, axis=X, theta=-26, lens=65, fstop=6.0, ev=-0.1))
        # primary: the whole +x arm on the diagonal, root-side and tip-side points both on the right half (label left).
        # Holds end two frames early so the tumble into the lambda2 view (the largest roll of the tour) gets ten frames
        ks.append(key(136, (0.55, -1.00, 0.62), None, mid(pa, pb), 0.68, 0.50, axis=X, theta=-42, lens=55, fstop=11.0,
                      ev=-0.05, span_pts=[pa, pb], span_frac=0.44))
        ks.append(key(141, (0.62, -0.98, 0.58), None, mid(pa, pb), 0.68, 0.50, axis=X, theta=-42, lens=55, fstop=11.0,
                      ev=-0.05, span_pts=[pa, pb], span_frac=0.44))
        # lambda2: looking down on the -y row so the pair shows its full length. The trunk keeps the primary view's
        # screen angle (-42: up-right), so the camera only climbs and zooms between the two views instead of rolling;
        # the row's arms point down-right from it, the roots on the left third (label right)
        ks.append(key(150, (0.25, -0.38, 1.00), 0.55, mid(la, lb), 0.32, 0.52, axis=X, theta=-42, lens=70, fstop=6.0, ev=-0.1))
        ks.append(key(155, (0.30, -0.44, 1.00), 0.55, mid(la, lb), 0.32, 0.52, axis=X, theta=-42, lens=70, fstop=6.0, ev=-0.1))
        # tertiary: from above and in front of the host's comb (the +z row seen from az -50, el 50, on the way from
        # the lambda2 view to the neck view), rolled so the host rises up-left from the trunk (Z at -150 on screen,
        # a roll within 13 deg of the lambda2 key's) and its tertiary hangs down from it to the anchor at left center;
        # a wide aperture melts the combs behind and below into soft shapes so the branch on a branch is the one
        # sharp thing (label right)
        ks.append(key(161, (0.413, -0.492, 0.766), 0.32, te, 0.34, 0.50, axis=Z, theta=-150, lens=80, fstop=2.2, ev=-0.1))
        ks.append(key(165, (0.440, -0.510, 0.740), 0.32, te, 0.34, 0.50, axis=Z, theta=-150, lens=80, fstop=2.2, ev=-0.1))
        # neck: the necked secondary in profile next to the trunk, seen from the side perpendicular to the arm
        # (from above for a -y arm, from the front for a +z arm), tilted a little toward the arm's tip; the trunk
        # runs across the frame and the arm hangs from it (or rises, and then the anchor sits low instead of high);
        # label right
        n = side_normal(nd)
        v1 = unit(0.30 * X + 1.00 * n + 0.50 * nd)
        v2 = unit(0.34 * X + 0.98 * n + 0.55 * nd)
        theta_n = -20.0
        _fv, _r, u1 = basis(v1, roll_for(v1, X, theta_n))
        sy_n = 0.42 if float(np.dot(nd, u1)) < 0.0 else 0.58
        ks.append(key(172, v1, 0.30, ne, 0.36, sy_n, axis=X, theta=theta_n, lens=80, fstop=8.0, ev=-0.1))
        ks.append(key(179, v2, 0.30, ne, 0.36, sy_n, axis=X, theta=theta_n, lens=80, fstop=8.0, ev=-0.1))
        for name in ('az', 'el', 'roll'):
            _unwrap(ks, name)
        return ks

    def state(self, f):
        if f <= TOUR0:
            return self.full_state(f)
        return interp_keys(self.keys, f)

    def view(self, f):
        """the look.Look.frame() view dict for frame f, plus the camera basis."""
        st = self.state(f)
        frm = dir_from_angles(st['az'], st['el'])
        fv, r, u = basis(frm, st['roll'])
        W = st['width']
        P = np.asarray(st['P'])
        target = P - (st['sx'] - 0.5) * W * r + (st['sy'] - 0.5) * W * u
        view = dict(view_from=tuple(frm), up=tuple(u), lens=st['lens'], width=W, target=tuple(target),
                    focus=tuple(P), fstop=st['fstop'], exposure=st['ev'], feather=(0.0, 0.0), landmarks=())
        return st, view, (fv, r, u)


# ---- features (anchor points) -------------------------------------------------------------------
def snap(ob, p):
    ok, loc, _n, _i = ob.closest_point_on_mesh(Vector([float(x) for x in p]))
    return np.array(loc, dtype=np.float64) if ok else np.asarray(p, dtype=np.float64)


def surface_distance(ob, p):
    ok, loc, _n, _i = ob.closest_point_on_mesh(Vector([float(x) for x in p]))
    return float((Vector([float(x) for x in p]) - loc).length) if ok else 0.0


def pick_neck(px, t, exclude):
    """the +x arm secondary with the deepest waist (neck / body radius < 0.9), row 1 (-y) strongly preferred
    over row 2 (+z) (the rows the rest view faces; the neck view is built from the picked arm's direction),
    mid-arm, not one of the lambda2 pair (that pair's dots stay unshared), preferably without tertiaries of its
    own (a clean profile)."""
    best = None
    cands = []
    for c in px.children:
        if c.idx in exclude or c.row not in (1, 2):
            continue
        if not (c.alive and (c.L - c.R_root) > 5.0 * c.rho and c.k_neck > 0.0):
            continue
        if not (0.25 * px.L < c.s_par < 0.85 * px.L):
            continue
        s = np.linspace(c.R_root, c.L, 200)
        r, _, _ = DG.arm_profile(c, t, c.L - s, shift=False)
        i_neck = int(np.argmin(r[: len(r) // 2]))
        r_body = float(r[i_neck:].max())
        ratio = float(r[i_neck]) / r_body if r_body > 0 else 1.0
        if ratio >= 0.9:
            continue
        score = ratio + (0.0 if c.row == 1 else 0.5) + (0.03 if any(g.alive for g in c.children) else 0.0)
        cands.append((round(score, 3), c.row, round(c.s_par, 3), round(ratio, 3)))
        if best is None or score < best[0]:
            best = (score, c, float(s[i_neck]), float(r[i_neck]), r_body, ratio)
    print('[seq] neck candidates (score, row, s_par, neck/body):', sorted(cands)[:8])
    return best


def feature_points(ob, arms, feats):
    """world points per feature id (lists of points). Points sit on the skeleton axes (the tip apex, the
    root of a side arm just outside the junction, the tertiary near its tip, the primary axis); the
    occlusion test allows for each point's own distance to the surface, so no snapping to one side."""
    for k in ('lambda2_pair', 'tertiary'):
        if k not in feats:
            raise SystemExit('the generator found no %s at t = 1 (features json); cannot place the tour' % k)
    px = [a for a in arms if a.gen == 0][0]
    L = px.L
    tip = px.origin + px.d * L
    lp = feats['lambda2_pair']
    ex = set()
    ra = np.asarray(lp['root_a'])
    rb = np.asarray(lp['root_b'])
    rd = np.asarray(lp['row_direction'])
    la = ra + rd * 0.35 * lp['body_radius_a']
    lb = rb + rd * 0.35 * lp['body_radius_b']
    for c in px.children:
        if np.allclose(c.origin + c.d * c.R_root, ra, atol=1e-4) or np.allclose(c.origin + c.d * c.R_root, rb, atol=1e-4):
            ex.add(c.idx)
    te = feats['tertiary']
    t_root, t_tip = np.asarray(te['root']), np.asarray(te['tip'])
    tert = t_root + (t_tip - t_root) * 0.8
    host_dir = unit(np.asarray(te['parent_secondary_tip']) - np.asarray(te['parent_secondary_root']))
    nk = pick_neck(px, 1.0, ex)
    if nk is None:
        raise SystemExit('no necked secondary found on the +x arm outside the lambda2 pair')
    _, c, s_neck, r_neck, r_body, ratio = nk
    neck = c.origin + c.d * (s_neck + 0.35 * r_body)
    pts = {
        'tip': [tip],
        'primary': [np.array([0.30 * L, 0.0, 0.0]), np.array([0.92 * L, 0.0, 0.0])],
        'lambda2': [la, lb],
        'tertiary': [tert],
        'neck': [neck],
        'neck_dir': c.d.copy(),
        'tertiary_host_dir': host_dir,
    }
    info = {
        'primary_length': round(L, 5),
        'lambda2': {'row': lp['row'], 'spacing': lp['spacing'], 'roots': [la.tolist(), lb.tolist()]},
        'tertiary': {'host_row': te['host_row'], 'length': te['length'], 'point': tert.tolist(), 'direction': te['direction']},
        'neck': {'row': c.row, 's_par': round(c.s_par, 5), 'neck_radius': round(r_neck, 5), 'body_radius': round(r_body, 5),
                 'neck_to_body_ratio': round(ratio, 4), 'arm_age': round(c.age, 4), 'point': neck.tolist(),
                 'direction': c.d.tolist()},
        'tip': tip.tolist(),
        'primary_pair': [pts['primary'][0].tolist(), pts['primary'][1].tolist()],
    }
    return pts, info


# ---- anchors -------------------------------------------------------------------------------------
EPS_VIS = 0.012
EDGE_FADE = 0.06      # the page fades the frame to transparent over its outer 6 % (index.html); a point inside that
                      # band counts as not visible, as scripts/verify-hero-manifest.mjs requires of in-window anchors


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
    os.makedirs(out_build, exist_ok=True)
    return A


def build_mesh(A, t):
    """dendrite_gen.build at growth time t; drops the helper skeleton object and orphan data."""
    t0 = time.perf_counter()
    ob, me, arms, co, stats, ok = DG.build(A, t)
    for o in list(bpy.data.objects):
        if o.name.startswith('DendriteSkeleton'):
            m = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if m is not None and m.users == 0:
                bpy.data.meshes.remove(m)
    for ng in list(bpy.data.node_groups):
        if ng.users == 0:
            bpy.data.node_groups.remove(ng)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    secs = time.perf_counter() - t0
    print('[seq] mesh t=%.4f: %d verts, gate %s, %.1fs' % (t, len(me.vertices), 'PASS' if ok else 'FAIL', secs))
    sys.stdout.flush()
    return ob, arms, ok, secs


# ---- CLI -----------------------------------------------------------------------------------------
def parse_frames(spec):
    out = []
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
    p = argparse.ArgumentParser(description='SOLIDIFY hero: render the 180-frame sequence (Blender 4.5, headless)')
    p.add_argument('--out', default=DEFAULT_OUT)
    p.add_argument('--res', type=int, default=1200)
    p.add_argument('--samples', type=int, default=96)
    p.add_argument('--seed', type=int, default=7)
    p.add_argument('--frames', default='0-179', help='e.g. 0-179, 12-95/6, 5,17,120')
    p.add_argument('--force', action='store_true', help='re-render frames whose PNG exists')
    p.add_argument('--anchors-only', action='store_true', help='no rendering: schedule + anchors -> frames.json')
    p.add_argument('--preview', action='store_true', help='400 px, 24 spp, every 6th frame, into <out>_preview')
    p.add_argument('--build-only', default='', metavar='T,T,...',
                   help='no rendering: build the mesh at these growth times in this order (through the skeleton '
                        'cache) and print the vertex counts; a cache-safety check against fresh single-t builds')
    p.add_argument('--exposure', type=float, default=-0.3)
    p.add_argument('--cpu', action='store_true')
    p.add_argument('--set', action='append', default=[], metavar='KEY=VALUE', help='look tweak (look.LOOK keys)')
    return p.parse_args(argv)


def atomic_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(data, fh, indent=1, default=str)
    os.replace(tmp, path)


def main():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    A_ = parse_args(argv)
    out = A_.out
    res, samples = A_.res, A_.samples
    frames = parse_frames(A_.frames)
    if A_.preview:
        out = out.rstrip('/\\') + '_preview'
        res = A_.res if A_.res != 1200 else 400          # the defaults shrink; an explicit --res / --samples holds
        samples = A_.samples if A_.samples != 96 else 24
        if A_.frames == '0-179':
            frames = list(range(0, N_FRAMES, 6)) + [N_FRAMES - 1]
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
    A = gen_args(A_.seed, os.path.join(out, 'build'))
    log('[seq] start: out=%s res=%d samples=%d seed=%d device=%s frames=%s' % (out, res, samples, A_.seed, L.device, A_.frames))

    if A_.build_only:
        for t in [float(x) for x in A_.build_only.split(',') if x.strip()]:
            ob, arms, ok, secs = build_mesh(A, t)
            L.adopt(ob)
            log('[seq] build-only t=%.4f: %d verts, gate %s, %.1fs (alive arms %d)' % (
                t, len(ob.data.vertices), 'PASS' if ok else 'FAIL', secs, sum(1 for a in arms if a.alive)))
        return

    # the t = 1 crystal first: features, anchor points, the tour keys
    ob1, arms1, ok1, _ = build_mesh(A, 1.0)
    L.adopt(ob1)
    bpy.context.view_layer.update()
    feats1 = DG.extract_features(arms1, 1.0, A, A.seed)
    pts, finfo = feature_points(ob1, arms1, feats1)
    tips = np.array([tp['position'] for tp in feats1['tips']])
    S = Schedule(A, tips, pts)
    tol = {fid: [1.6 * surface_distance(ob1, p) + EPS_VIS for p in pts[fid]] for fid, _k, _a, _b in FEATURES}
    log('[seq] extent(95) %.3f  L1 %.3f  width(0) %.3f  width(12) %.3f  width(95) %.3f  width(120) %.3f' % (
        S.arm_extent(GROW1), S.L1, S.width_full(0), S.width_full(GROW0), S.width_full(GROW1), S.width_full(TOUR0)))
    log('[seq] features: ' + json.dumps(finfo))
    log('[seq] visibility tolerances: ' + json.dumps({k: [round(x, 4) for x in v] for k, v in tol.items()}))
    data['meta'].update(dict(seed=A_.seed, res=res, samples=samples, device=L.device, exposure=A_.exposure, look=L.p,
                             emission=0.0, warmth='1 through frame %d, smoothstep to 0 at frame %d' % (GROW1, COOL1),
                             features=finfo, tolerances=tol, extent95=S.arm_extent(GROW1), L1=S.L1, keys=S.keys,
                             chapters=[dict(id=n, **{'from': a, 'to': b}) for n, a, b in CHAPTERS],
                             feature_windows=[dict(id=n, kind=k, **{'from': a, 'to': b}) for n, k, a, b in FEATURES],
                             blender=bpy.app.version_string, generated=time.strftime('%Y-%m-%d %H:%M:%S')))
    atomic_json(fpath, data)

    scene = bpy.context.scene
    current_t = 1.0
    cur_ob, cur_arms, cur_ok = ob1, arms1, ok1

    def ensure_mesh(t):
        nonlocal current_t, cur_ob, cur_arms, cur_ok
        if abs(t - current_t) < 1e-9 and cur_ob is not None:
            return 0.0
        ob, arms, ok, secs = build_mesh(A, t)
        L.adopt(ob)
        bpy.context.view_layer.update()
        current_t, cur_ob, cur_arms, cur_ok = t, ob, arms, ok
        return secs

    # ---- render pass ------------------------------------------------------------------------------
    todo = []
    for f in frames:
        png = os.path.join(out, 'f%03d.png' % f)
        if os.path.isfile(png) and not A_.force:
            continue
        todo.append(f)
    if A_.anchors_only:
        todo = []
    log('[seq] frames to render: %d of %d requested (%s)' % (len(todo), len(frames), 'preview' if A_.preview else 'final'))
    t_run0 = time.perf_counter()
    done = 0
    scene.cycles.samples = samples
    for f in todo:
        t = t_of(f)
        build_s = ensure_mesh(t)
        scene.render.use_persistent_data = f >= GROW1        # the mesh stops changing at frame 95
        st, view, _b = S.view(f)
        cam = L.frame(view)
        w = warmth_of(f)
        L.set_warmth(w)
        reach = max(a.L for a in cur_arms if a.gen == 0)
        L.set_growth(reach, t, DG.nucleus_radius(A, t))      # the age term of the roughness is normalized by t
        s = scale_of(f)
        cur_ob.scale = (s, s, s)
        png = os.path.join(out, 'f%03d.png' % f)
        secs = L.render(png)
        rec = dict(chapter=chapter_of(f), t=round(t, 5), warmth=round(w, 5), scale=round(s, 4), reach=round(reach, 5),
                   verts=len(cur_ob.data.vertices), gate='PASS' if cur_ok else 'FAIL', build_seconds=round(build_s, 1),
                   render_seconds=secs, samples=samples,
                   state={k: (round(v, 5) if isinstance(v, float) else v) for k, v in st.items()},
                   camera=dict(dist=cam['dist'], target=cam['target'], lens=cam['lens'], fstop=cam['fstop'],
                               exposure=cam['exposure']))
        data['frames'].setdefault(str(f), {}).update(rec)
        atomic_json(fpath, data)
        done += 1
        el = time.perf_counter() - t_run0
        log('[seq] frame %03d  %-4s t=%.3f w=%.2f  build %5.1fs render %5.1fs  | %d/%d done, %.1f min elapsed, ~%.1f min left' % (
            f, rec['chapter'], t, w, build_s, secs, done, len(todo), el / 60.0, el / 60.0 / done * (len(todo) - done)))

    # ---- anchor pass (all 180 frames, on the t = 1 crystal) ---------------------------------------
    ensure_mesh(1.0)
    cur_ob.scale = (1.0, 1.0, 1.0)
    L.set_warmth(0.0)
    L.set_growth(max(a.L for a in cur_arms if a.gen == 0), 1.0, DG.nucleus_radius(A, 1.0))
    t0 = time.perf_counter()
    for f in range(N_FRAMES):
        st, view, _b = S.view(f)
        cam = L.frame(view)
        bpy.context.view_layer.update()
        rows, rows_px = anchor_rows(scene, L.cam, cur_ob, pts, res, frozen=f >= GROW1, tol=tol)
        rec = data['frames'].setdefault(str(f), {})
        rec.update(dict(chapter=chapter_of(f), t=round(t_of(f), 5), warmth=round(warmth_of(f), 5), scale=round(scale_of(f), 4),
                        anchors=rows, anchors_px=rows_px,
                        state={k: (round(v, 5) if isinstance(v, float) else v) for k, v in st.items()},
                        camera=dict(dist=cam['dist'], target=cam['target'], lens=cam['lens'], fstop=cam['fstop'],
                                    exposure=cam['exposure'])))
    # poster candidates: tour frames with all five features visible
    cands = [f for f in range(TOUR0, N_FRAMES) if all(data['frames'][str(f)]['anchors'][fid][-1] == 1 for fid, _k, _a, _b in FEATURES)]
    data['meta']['poster_candidates'] = cands
    data['meta']['poster_frame'] = (TOUR0 if TOUR0 in cands else (cands[0] if cands else None))
    per = {}
    for fid, _k, a, b in FEATURES:
        per[fid] = sum(1 for f in range(a, b + 1) if data['frames'][str(f)]['anchors'][fid][-1] == 1)
    data['meta']['visible_in_window'] = per
    # the largest roll / azimuth step between consecutive frames (a fast spin shows up here before it does on screen)
    steps = []
    for f in range(1, N_FRAMES):
        s0, s1 = data['frames'][str(f - 1)]['state'], data['frames'][str(f)]['state']
        steps.append((round(max(abs(s1['roll'] - s0['roll']), abs(s1['az'] - s0['az']), abs(s1['el'] - s0['el'])), 2), f))
    data['meta']['max_angle_step_deg'] = max(steps)
    atomic_json(fpath, data)
    log('[seq] anchors for %d frames in %.1fs; visible in window %s; poster candidates %s -> poster frame %s; '
        'largest angle step %.1f deg at frame %d' % (
            N_FRAMES, time.perf_counter() - t0, json.dumps(per), cands[:12], data['meta']['poster_frame'],
            max(steps)[0], max(steps)[1]))
    have = sum(1 for f in range(N_FRAMES) if os.path.isfile(os.path.join(out, 'f%03d.png' % f)))
    log('[seq] done: %d/%d PNGs in %s, %.1f min this run' % (have, N_FRAMES, out, (time.perf_counter() - t_run0) / 60.0))
    log('[seq] frames.json -> ' + fpath)


if __name__ == '__main__':
    main()
