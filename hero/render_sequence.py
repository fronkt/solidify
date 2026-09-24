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
Close-up mesh: tour frames framed narrower than FINE_WIDTH (the tertiary and neck windows, 158-179) render the t = 1
crystal meshed on a 0.002 SDF grid instead of the generator's 0.004 (build_fine_mesh: same skeleton, same arm states,
same closing and opening radii in model units, so only the resolution changes at the switch), with a minimum tertiary
tip radius (TERT_TIP_MIN), and pass the generator's topology gate (one closed genus-0 surface) or the log says so.
Anchors: the five feature points (from the generator's own skeleton at t = 1) are projected with
bpy_extras.object_utils.world_to_camera_view and tested for occlusion with scene.ray_cast from the camera;
visible = 1 only if the first surface the ray meets is the crystal within the point's own surface distance, on the
mesh that frame renders. The neck is the secondary whose root is visibly necked ON THE MESH (pick_neck measures the
waist by ray casts from the arm's axis; the closing fills a shallow model neck), and its anchor sits at that waist.
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
from mathutils.bvhtree import BVHTree
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
# the close-up mesh: tour frames framed narrower than FINE_WIDTH (frame width at the target, model units: frame 157 is
# 0.48, 158 is 0.42, so the tertiary and neck windows 158-179) render the same t = 1 crystal meshed on a finer SDF
# grid. At the generator's 0.004 voxel a secondary tip (rho 0.009) is 2.2 voxels and a tertiary tip (0.0054) 1.35,
# and the closing / opening (erode by fillet + opening, dilate back) squeezes a tertiary's core below one voxel, so
# the secondary tips mesh as chisel bevels and the tertiary tips as cones with a nub once a tip spans 20+ px. The
# skeleton, the arm states (channel caps, necks) and the closing / opening radii stay the generator's, in model units,
# so the shape does not change at the switch, only its resolution. The skeleton and every voxel-dependent growth rule
# still see A.voxel.
FINE_WIDTH = 0.45
FINE_VOXEL = 0.002
FINE_SMOOTH_ITERS = 4        # the generator smooths 2 iterations at 0.004; half the edge length needs more passes for
                             # the same smoothing length (4 at 0.002 smooths ~0.7 of it and shrinks thin parts half as
                             # much, so nothing thins visibly at the switch)
# the neck view (frames 168-179, keys at 172 and 179): camera direction tilt_x X + side normal + tilt_d * arm direction
# (per key), the arm's screen angle phi (deg, 0 = right, y down), the waist anchor's frame position, frame width
# (for a row-3 arm: a level view from -y, drifting 3 deg below level; the trunk runs up the left of center), and kd, the
# key light's extra desaturation toward white: the trunk's key-lit flank fills more of this frame than any other tour
# view, and the key is the rig's one warm lamp, so without it the neck frames read warm (midtone R/B 1.14 against
# 1.08-1.12 on the rest of the tour; Light.specular_factor has no effect in Cycles 4.5, so the key cannot be made less
# specular alone). Eased in over the glide from the tertiary view like ev.
NECK_VIEW = dict(tilt_x=(0.30, 0.34), tilt_d=(0.0, 0.05), phi=0.0, sx=0.62, sy=0.50, width=0.22, lens=80.0, fstop=8.0,
                 ev=-0.1, kd=0.12)
TERT_TIP_MIN = 0.008         # minimum tertiary tip radius in the close-up mesh (model units; the tertiary rho is 0.0054):
                             # one extra sphere of this radius just behind each living tertiary's apex (the apex does not
                             # move), capped by the arm's own envelope radius there so a thin, capped tertiary gets no knob.
                             # The opening erodes a cap by 0.004 before growing it back, so the cap's core must stay a few
                             # voxels wide: at 0.0065 the longest tertiaries still ended in a 2-3 px point, at 0.008 they
                             # are round


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
        span_pts=None, span_frac=None, kd=0.0):
    """one camera key. frm = direction the camera looks from; width = frame width at the target depth (model
    units), or derived from span_pts / span_frac (projected extent of the points / fraction of the frame);
    P = the world point that must project at (sx, sy) (frame fractions, origin top-left); roll from `axis`
    at screen angle `theta` unless given directly; kd = added desaturation of the key light toward white (eased
    along the path like ev)."""
    az, el = angles_of(frm)
    if roll is None:
        roll = roll_for(frm, axis, theta)
    if width is None:
        f, r, u = basis(frm, roll)
        width = projected_extent(span_pts, f, r, u) / float(span_frac)
    return dict(f=int(frame), az=float(az), el=float(el), roll=float(roll), lens=float(lens), width=float(width),
                P=[float(x) for x in P], sx=float(sx), sy=float(sy), fstop=float(fstop), ev=float(ev), kd=float(kd))


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
    for name in ('az', 'el', 'roll', 'lens', 'sx', 'sy', 'ev', 'kd'):
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
                    P=[0.0, 0.0, 0.0], sx=0.5, sy=0.5, fstop=16.0, ev=0.0, kd=0.0)

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
        # neck: the necked secondary in profile, seen from the side perpendicular to the arm and the trunk (from the
        # front for a -z or +z arm, from above for a -y arm), tilted a little toward the trunk's tip and the arm's tip
        # (NECK_VIEW) and rolled so the arm points at NECK_VIEW['phi'] on screen: the trunk runs up the left of center
        # and the arm reaches right from it against the void, so the waist (the anchor) sits right of center (label
        # right) and the trunk, seen side on with the key raking across it, neither fills the frame as a flat slab nor
        # runs into its right edge
        n = side_normal(nd)
        NV = NECK_VIEW
        for fk, tx, td in ((172, NV['tilt_x'][0], NV['tilt_d'][0]), (179, NV['tilt_x'][1], NV['tilt_d'][1])):
            v = unit(tx * X + 1.00 * n + td * nd)
            ks.append(key(fk, v, NV['width'], ne, NV['sx'], NV['sy'], axis=nd, theta=NV['phi'], lens=NV['lens'],
                          fstop=NV['fstop'], ev=NV['ev'], kd=NV['kd']))
        for name in ('az', 'el', 'roll'):
            _unwrap(ks, name)
        return ks

    def state(self, f):
        if f <= TOUR0:
            return self.full_state(f)
        return interp_keys(self.keys, f)

    def fine(self, f):
        """frame f renders the close-up mesh (a tour frame framed narrower than FINE_WIDTH)."""
        return f > TOUR0 and self.state(f)['width'] < FINE_WIDTH

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


# row 3 (-z) first: its arms hang from the trunk's underside, and the neck view of one (from -y, level, the arm pointing
# right) keeps the tertiary view's roll (-z already points down-right there), so the glide 165 -> 172 is a descent and
# a zoom, not a spin; a row-2 arm pointed right needs a 150 deg roll (32 deg per frame), a row-1 arm has no root neck
# the mesh shows (best silhouette ratio 0.92, at 1.2 root radii). Rows 2 / 1 stay as fallbacks for other seeds.
NECK_ROW_PENALTY = {3: 0.0, 2: 0.05, 1: 0.05}
NECK_MAX_RATIO = 0.92                    # silhouette waist / section above it: a pinch that reads at the neck framing


def pick_neck(px, t, exclude, bvh):
    """the +x arm secondary whose root is most visibly necked ON THE MESH (bvh: the mesh the neck window renders). The
    model's neck is a short Gaussian waist just outside the trunk, and the closing (fillet) fills most of it (at seed 7
    the deepest root necks on the +x arm, rows 1-3, measure 0.87 silhouette waist / section above). So each candidate
    (a row in NECK_ROW_PENALTY; mid-arm; not one of the lambda2 pair, whose dots stay unshared; alive with a model
    neck and > 5 tip radii of protrusion) is measured with mesh_waist, and the pick is
    the smallest silhouette waist / section-above ratio (+ NECK_ROW_PENALTY, + 0.01 per tertiary it hosts: a cleaner
    profile) among those under NECK_MAX_RATIO whose fillet onto the trunk is wider than the waist (a pinch, not a
    taper). Returns (score, arm, waist dict) or None."""
    best = None
    cands = []
    for c in px.children:
        if c.idx in exclude or c.row not in NECK_ROW_PENALTY:
            continue
        if not (c.alive and (c.L - c.R_root) > 5.0 * c.rho and c.k_neck > 0.0):
            continue
        if not (0.25 * px.L < c.s_par < 0.85 * px.L):
            continue
        w = mesh_waist(bvh, c, t)
        if w is None or w['ratio'] is None or w['ratio'] >= NECK_MAX_RATIO or not (w['flare'] or 0.0) > w['r_neck']:
            continue
        score = w['ratio'] + NECK_ROW_PENALTY[c.row] + 0.01 * sum(1 for g in c.children if g.alive)
        cands.append((round(score, 3), c.idx, c.row, round(c.s_par, 3), w['ratio'], w['r_neck'], w['r_out']))
        if best is None or score < best[0]:
            best = (score, c, w)
    print('[seq] neck candidates on the mesh (score, arm, row, s_par, waist/above, r_waist, r_above):', sorted(cands)[:8])
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
    nk = pick_neck(px, 1.0, ex, mesh_bvh(ob))
    if nk is None:
        raise SystemExit('no secondary on the +x arm outside the lambda2 pair has a waist visible on the mesh')
    _, c, wst = nk
    neck = c.origin + c.d * (c.R_root + wst['h_neck'])        # on the arm's axis at the measured waist
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
        'neck': {'arm': c.idx, 'row': c.row, 's_par': round(c.s_par, 5), 'arm_age': round(c.age, 4), 'point': neck.tolist(),
                 'direction': c.d.tolist(), 'mesh_waist_height': wst['h_neck'], 'mesh_waist_radius': wst['r_neck'],
                 'mesh_radius_above': wst['r_out'], 'mesh_root_flare': wst['flare'], 'mesh_waist_ratio': wst['ratio'],
                 'root_rmax': wst['rr']},
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
    _drop_helpers()
    secs = time.perf_counter() - t0
    print('[seq] mesh t=%.4f: %d verts, gate %s, %.1fs' % (t, len(me.vertices), 'PASS' if ok else 'FAIL', secs))
    sys.stdout.flush()
    return ob, arms, ok, secs


def _drop_helpers():
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


def fine_points(arms, t, A, voxel, tip_min):
    """the generator's sphere set (dendrite_gen.collect_points) with the arms sampled for a `voxel` grid instead of
    A.voxel, plus the tertiary tip spheres: for each living tertiary that protrudes at least 2 tip_min, one sphere
    of radius r = min(tip_min, envelope radius r behind the apex) centered r behind the apex. Returns (points,
    number of tip spheres, their radii)."""
    out = {'pos': [np.zeros((1, 3))], 'rad': [np.array([DG.nucleus_radius(A, t)])], 'birth': [np.array([0.0])],
           'gen': [np.array([-1], dtype=np.int32)], 'arm': [np.array([-1], dtype=np.int32)]}
    for a in arms:
        DG.sample_arm(a, t, voxel, out)
    radii = []
    if tip_min > 0.0:
        for a in arms:
            if not (a.alive and a.gen == 2) or (a.L - a.R_root) < 2.0 * tip_min:
                continue
            r = tip_min
            for _ in range(3):             # the envelope r behind the apex, never a knob wider than the arm there
                r = min(tip_min, float(DG.arm_profile(a, t, np.array([r]), shift=False)[0][0]))
            if r <= 0.0:
                continue
            tb = float(DG.arm_profile(a, t, np.array([r]), shift=True)[2][0])
            out['pos'].append((a.origin + a.d * (a.L - r))[None, :])
            out['rad'].append(np.array([r]))
            out['birth'].append(np.array([tb]))
            out['gen'].append(np.array([2], dtype=np.int32))
            out['arm'].append(np.array([a.idx], dtype=np.int32))
            radii.append(r)
    return {k: np.concatenate(v) for k, v in out.items()}, len(radii), radii


def build_fine_mesh(A, t, voxel=FINE_VOXEL, smooth_iters=FINE_SMOOTH_ITERS, tip_min=TERT_TIP_MIN):
    """the close-up mesh: dendrite_gen.build's steps at growth time t with the same skeleton (memoized), the same arm
    states (update_states with the generator's A, so every voxel-dependent growth rule sees A.voxel) and the same
    closing and opening radii in model units, but the spheres sampled for, and the SDF meshed on, a `voxel` grid,
    the tertiary tip spheres added (fine_points) and smooth_iters Laplacian passes. Runs the generator's topology
    gate on the result. Returns (object, arms, gate ok, seconds, topology dict)."""
    t0 = time.perf_counter()
    arms = DG.build_skeleton(A, np.random.default_rng(A.seed))
    DG.update_states(arms, t, A)
    pts, n_tip, radii = fine_points(arms, t, A, voxel, tip_min)
    skel = DG.make_skeleton_object(pts)
    ng = DG.build_gn_tree(voxel, A.fillet, t, A.open_voxels * A.voxel)
    mod = skel.modifiers.new('DendriteSDF', 'NODES')
    mod.node_group = ng
    me = DG.evaluated_mesh(skel)
    skel.modifiers.remove(mod)
    ob = bpy.data.objects.new('Dendrite', me)
    bpy.context.scene.collection.objects.link(ob)
    if smooth_iters > 0:
        sm = ob.modifiers.new('Smooth', 'SMOOTH')
        sm.factor = 0.5
        sm.iterations = smooth_iters
        me2 = DG.evaluated_mesh(ob)
        ob.modifiers.remove(sm)
        ob.data = me2
        bpy.data.meshes.remove(me)
        me = me2
    me.shade_smooth()
    me.name = 'DendriteFine'
    _drop_helpers()
    co, _bb = DG.mesh_bbox(me)
    topo = DG.mesh_topology(me, co)
    ok = bool(topo['single_closed_genus0_surface'])
    secs = time.perf_counter() - t0
    print('[seq] fine mesh t=%.4f voxel %.4f: %d verts, %d faces, chi %d, components %d, genus %s, gate %s; %d tertiary '
          'tip spheres (radius %.4f..%.4f); %.1fs' % (
              t, voxel, topo['vertices'], topo['faces'], topo['euler_characteristic'], topo['components'],
              topo['genus_total'], 'PASS' if ok else 'FAIL', n_tip, min(radii) if radii else 0.0,
              max(radii) if radii else 0.0, secs))
    if topo.get('small_components'):
        print('[seq] fine mesh small components:', json.dumps(topo['small_components']))
    sys.stdout.flush()
    topo = dict(topo, voxel=voxel, smooth_iters=smooth_iters, tip_min=tip_min, tip_spheres=n_tip)
    return ob, arms, ok, secs, topo


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
    xs = unit(X - float(np.dot(X, c.d)) * c.d)
    ys = unit(np.cross(c.d, xs))
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

    # the t = 1 crystal first, both meshes (the generator's and the close-up one): features, anchor points, the tour
    # keys. The neck is picked on the close-up mesh, the one its window renders. Both stay in memory for the run; the
    # one not rendering is unlinked from the scene, so renders and ray casts only ever see one crystal
    coll = bpy.context.scene.collection
    ob1, arms1, ok1, _ = build_mesh(A, 1.0)
    reach1 = max(a.L for a in arms1 if a.gen == 0)
    feats1 = DG.extract_features(arms1, 1.0, A, A.seed)
    obf, _armsf, okf, secs_f, topo_f = build_fine_mesh(A, 1.0)      # the arms stay in their t = 1 state
    log('[seq] fine mesh (t = 1, voxel %.4f): %d verts, gate %s (chi %d, %d component(s), genus %s), %.1fs' % (
        FINE_VOXEL, topo_f['vertices'], 'PASS' if okf else 'FAIL', topo_f['euler_characteristic'], topo_f['components'],
        topo_f['genus_total'], secs_f))
    if not okf:
        log('[seq] WARNING: the fine mesh FAILS the topology gate (one closed genus-0 surface)')
    kept = {False: (ob1, ok1), True: (obf, okf)}
    bpy.context.view_layer.update()
    pts, finfo = feature_points(obf, arms1, feats1)
    coll.objects.unlink(obf)
    L.adopt(ob1)
    bpy.context.view_layer.update()
    tips = np.array([tp['position'] for tp in feats1['tips']])
    S = Schedule(A, tips, pts)
    tol = {fid: [1.6 * surface_distance(ob1, p) + EPS_VIS for p in pts[fid]] for fid, _k, _a, _b in FEATURES}
    log('[seq] extent(95) %.3f  L1 %.3f  width(0) %.3f  width(12) %.3f  width(95) %.3f  width(120) %.3f' % (
        S.arm_extent(GROW1), S.L1, S.width_full(0), S.width_full(GROW0), S.width_full(GROW1), S.width_full(TOUR0)))
    log('[seq] features: ' + json.dumps(finfo))
    log('[seq] visibility tolerances: ' + json.dumps({k: [round(x, 4) for x in v] for k, v in tol.items()}))
    data['meta'].update(dict(seed=A_.seed, res=res, samples=samples, device=L.device, exposure=A_.exposure, look=dict(L.p),
                             emission=0.0, warmth='1 through frame %d, smoothstep to 0 at frame %d' % (GROW1, COOL1),
                             features=finfo, tolerances=tol, extent95=S.arm_extent(GROW1), L1=S.L1, keys=S.keys,
                             chapters=[dict(id=n, **{'from': a, 'to': b}) for n, a, b in CHAPTERS],
                             feature_windows=[dict(id=n, kind=k, **{'from': a, 'to': b}) for n, k, a, b in FEATURES],
                             blender=bpy.app.version_string, generated=time.strftime('%Y-%m-%d %H:%M:%S')))
    atomic_json(fpath, data)

    scene = bpy.context.scene
    current_t, cur_fine = 1.0, False
    cur_ob, cur_reach, cur_ok = ob1, reach1, ok1
    fine_frames = [f for f in range(N_FRAMES) if S.fine(f)]
    data['meta']['fine_mesh'] = dict(width_below=FINE_WIDTH, voxel=FINE_VOXEL, generator_voxel=A.voxel,
                                     smooth_iters=FINE_SMOOTH_ITERS, tertiary_tip_min=TERT_TIP_MIN,
                                     frames=[fine_frames[0], fine_frames[-1]] if fine_frames else [],
                                     build_seconds=round(secs_f, 1),
                                     topology={k: v for k, v in topo_f.items() if k != 'small_components'})
    atomic_json(fpath, data)

    def ensure_mesh(t, fine=False):
        """the mesh frame i renders: the generator's (dendrite_gen.build) or, for the close-up tour frames, the fine
        one; the two t = 1 meshes are kept (unlinked while not in use), any other t is built and dropped."""
        nonlocal current_t, cur_fine, cur_ob, cur_reach, cur_ok
        fine = bool(fine) and abs(t - 1.0) < 1e-9
        if abs(t - current_t) < 1e-9 and fine == cur_fine and cur_ob is not None:
            return 0.0
        if abs(current_t - 1.0) < 1e-9 and L.ob is not None:      # park a kept mesh (L.adopt would delete it)
            if L.ob.name in coll.objects:
                coll.objects.unlink(L.ob)
            L.ob = None
        secs = 0.0
        if abs(t - 1.0) < 1e-9:
            ob, ok = kept[fine]
            if ob.name not in coll.objects:
                coll.objects.link(ob)
            reach = reach1
        else:
            ob, arms, ok, secs = build_mesh(A, t)
            reach = max(a.L for a in arms if a.gen == 0)
            if not ok:
                log('[seq] WARNING: the generator mesh at t=%.4f FAILS the topology gate' % t)
        L.adopt(ob)
        bpy.context.view_layer.update()
        current_t, cur_fine, cur_ob, cur_reach, cur_ok = t, fine, ob, reach, ok
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
    key_desat0 = L.p['key_desat']                      # the neutral rig's key desaturation; the keys add st['kd']
    for f in todo:
        t = t_of(f)
        build_s = ensure_mesh(t, S.fine(f))
        scene.render.use_persistent_data = f >= GROW1        # the mesh stops changing at frame 95
        st, view, _b = S.view(f)
        cam = L.frame(view)
        w = warmth_of(f)
        L.p['key_desat'] = min(key_desat0 + st.get('kd', 0.0), 1.0)
        L.set_warmth(w)
        reach = cur_reach
        L.set_growth(reach, t, DG.nucleus_radius(A, t))      # the age term of the roughness is normalized by t
        s = scale_of(f)
        cur_ob.scale = (s, s, s)
        png = os.path.join(out, 'f%03d.png' % f)
        secs = L.render(png)
        rec = dict(chapter=chapter_of(f), t=round(t, 5), warmth=round(w, 5), scale=round(s, 4), reach=round(reach, 5),
                   mesh='fine' if cur_fine else 'generator', voxel=FINE_VOXEL if cur_fine else A.voxel,
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

    # ---- anchor pass (all 180 frames, on the t = 1 crystal as each frame renders it: the close-up frames on the
    # fine mesh) ---------------------------------------------------------------------------------------------------
    t0 = time.perf_counter()
    groups = {False: [f for f in range(N_FRAMES) if f not in fine_frames], True: fine_frames}
    for fine in (cur_fine, not cur_fine):
        if not groups[fine]:
            continue
        ensure_mesh(1.0, fine)
        cur_ob.scale = (1.0, 1.0, 1.0)
        L.set_warmth(0.0)
        L.set_growth(reach1, 1.0, DG.nucleus_radius(A, 1.0))
        for f in groups[fine]:
            st, view, _b = S.view(f)
            cam = L.frame(view)
            bpy.context.view_layer.update()
            rows, rows_px = anchor_rows(scene, L.cam, cur_ob, pts, res, frozen=f >= GROW1, tol=tol)
            rec = data['frames'].setdefault(str(f), {})
            rec.update(dict(chapter=chapter_of(f), t=round(t_of(f), 5), warmth=round(warmth_of(f), 5),
                            scale=round(scale_of(f), 4), anchors=rows, anchors_px=rows_px,
                            anchor_mesh='fine' if fine else 'generator',
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
