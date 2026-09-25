"""
path_plan.py -- the SOLIDIFY hero v4 camera path: keys -> splines -> screen-motion re-timing -> caps -> path.json.

  python hero/path_plan.py [--out C:/Users/frank/solidify-hero-out/v4] [--timeline hero/timeline.json]
      [--features <out>/features.json] [--no-check] [--plot] [--points 5000] [--design overrides.json] [--tag _x]
      [--mesh-cache <out>/cache/mesh] [--growth-points auto|meshes|proxy]
  python hero/path_plan.py --propose [--design ...]     size the post-growth chapters from measured costs
                                                        (writes <out>/timeline_proposed.json, never hero/timeline.json)
  python hero/path_plan.py --scan-keys                  where each callout is visible on the lathe (design aid)

Plain Python: numpy, and scipy for the planning itself (RotationSpline, PCHIP, cKDTree). render_sequence.py,
encode_frames.py, preview_sheet.py and emerge_check.py import the timeline readers, the camera math, the code digest
and the path reader from this module; those need numpy only (scipy and the generator are imported lazily).

Pipeline (hero/README.md):
  1. render_sequence.py --features-only  -> <out>/features.json   the t = 1 feature points; the neck is measured on the
                                                                   close-up mesh, so this step needs Blender
  2. render_sequence.py --cache-only     -> every growth mesh in the cache, gated (so step 3 measures them)
  3. path_plan.py                        -> <out>/path.json, path_report.json, path_report.txt (+ path_report.png)
     (a FAILED check writes path<tag>_failed.json and the report and leaves path.json alone; exit code 1)
  4. render_sequence.py --anchors-only   -> <out>/seq/frames.json  projection + occlusion of every anchor on the path
Without step 1 the planner falls back to skeleton-only feature points (the neck from the model's neck depth, not the
mesh) and says so in the report; the renderer refuses a path planned on other features than its own. Without step 2
the growth frames are measured on the sphere-set proxy (within 0.94-1.16 of the meshes; the report says which).

The path
--------
One continuous camera move, never at rest before the last frame. The path parameter u is the ARC LENGTH of the view
direction in degrees, so a step of du turns the view by du degrees wherever it is on the path (the turn rate is
continuous across every hand-over by construction):
  seed + grow + branch   a level orbit about the world z axis, azimuth one way (ORBIT_DEG in all), elevation on one slow
                         swell (EL_CENTER -+ EL_AMP, period EL_PERIOD deg of azimuth, no multiple of 90, so the
                         cube-symmetric crystal never shows the same view a quarter turn later; low while the crystal is
                         small and turns fast); the frame width is the growth law below, so the orbit only turns
  cool                   the orbit hands over to the lathe: the orbit extended TRANS_EXT deg and the lathe extended
                         TRANS_EXT deg back, slerped with a smootherstep weight (both keep moving); the look-at slides
                         onto the +x arm and the frame narrows, eased in over the whole hand-over (HANDOVER_EASE); the
                         lens goes from LENS_GROWTH to LENS_TOUR across the hand-over (one monotone change, PCHIP)
  tour                   a lathe orbit about the +x trunk: the camera direction turns about +x one way (phi), the trunk
                         keeps one screen angle (THETA, so roll is computed, never keyed), the look-at slides from the
                         tip toward the root (tip -> lambda2 -> tertiary -> neck, each nearer the root than the last);
                         each callout gets a soft hold of >= 16 frames at HOLD_SPEED px/frame, centered on its key
  pullback               the lathe runs on LATHE_TAIL deg past the last key; from its exit the camera follows a TRACK
                         on the view sphere (pull_track) that leaves on the lathe's own heading (past the top of the arm:
                         down) and turns that heading smoothly (smootherstep over the first q of the track) through
                         'toward lower azimuth' up to at most 'up', so the azimuth never increases and the picture's
                         flow never reverses at speed; the roll goes, as an angle, from the lathe's convention to the
                         lathe's dutch at its exit held constant (an orbit about world z turned by that dutch: the
                         lathe leaves the picture rolled ~160 deg against world up, and unrolling that at the 1 deg/frame
                         roll cap would cost ~140 frames; a floating cubic crystal has no up). The track ends ON the
                         poster pose, the last frame, while the frame opens to the whole crystal at the tour lens (a
                         pure dolly). The track, and with it the poster, is searched (PULL_ARC x PULL_DPSI x PULL_Q):
                         its end must show all five anchors unoccluded (SphereOcclusion) with most of its neighbors,
                         within POSTER_EL and off the mirror planes; among the tracks whose pull-back turns within
                         PULL_TURN_TOL of POSTER_TURN, the gentlest
Interpolation: orientation = scipy RotationSpline through dense orientation samples of those analytic motions (no az/el
gimbal anywhere); look-at P, its screen position (sx, sy), log zoom, log f-stop, exposure and key desaturation = one
centripetal Catmull-Rom (Barry-Goldman) over the key states, reached through a monotone PCHIP map from u, so every
channel is C1 in u; the lens is its own monotone PCHIP (no Catmull-Rom overshoot). Between consecutive keys the look-at
and width follow samples of the optimal zoom-and-pan path (van Wijk & Nuij 2003, as d3.interpolateZoom). Warmth and
growth time are functions of the FRAME (timeline.json), not of u.

Growth framing (seed..branch): growth time t is linear in frame (constant tip speed, as the generator models it). The
frame width is W(f) = e(t_f) / span(f), e = the crystal's bounding-sphere diameter. Through the seed, span follows the
log-rate law ln W = a ln e + b (SPAN0 of the frame at frame 0; the ln-width cap binds there), then span climbs LINEARLY
in frame to SPAN1 at the last growth frame, blended C1 over SPAN_BLEND frames either side of the seed's end, so the
crystal's size on screen (and with it the tips' outward speed on screen, growth and dolly together) grows evenly
through grow and branch. The growth ALONE seen by a fixed camera still slows (it scales as dt / t); it could only stay
even if the camera stopped receding after the seed, which the ln-width cap and the seed's framing rule out.

Re-timing: frames -> u by projected screen motion. Points: growth frames use their own cached meshes when every growth
mesh is cached (--growth-points), else the generator's sphere sets at a grid of growth times turned into a surface
sample (points on the spheres outside every other sphere, spread by area), scaled self-similarly between grid times and
blended between the two grid times around t (measured within 0.94-1.16 of the meshes); frozen frames use the vertices
of the cached close-up mesh itself (the file render_sequence renders, found by features.json's mesh_key; within
0.99-1.01 of every vertex). Per frame, the points inside the frame, subsampled to --points. The step motion of frame f
is the 90th percentile of the displacement of those points between frames f-1 and f (growth flow included), in px at
1200. Each segment between fixed frames gets a target speed profile (constant through growth; the cool hand-over a TURN
rate easing from the orbit's to the first hold's, its screen speed allowed to rise to the cap over HANDOVER_PX_RAMP of
it; between holds a glide that accelerates and brakes over GLIDE_RAMP of it; HOLD_SPEED in holds; to zero on the last
frame) whose amplitude is solved so the segment lands exactly on its end; every step is also capped (px, ln width,
twist, direction change) and slew-limited (its turn within SLEW of the previous step's).

Caps and checks (the check exits 1 when one fails): p90 screen motion <= 12 px/frame at 1200, |d ln width| <= 0.03 per
frame, roll <= 1 deg/frame (roll = the twist about the camera's own view axis per frame), soft holds >= HOLD_MIN
px/frame for >= HOLD_FRAMES_MIN frames, no zero-speed frame before the last, max / median step < 4, the turn rate never
jumps by more than TURN_JUMP of itself in one frame while above TURN_JUMP_FLOOR deg/frame, the picture's flow (median
screen displacement) never jumps by more than FLOW_JUMP_MAX px in one frame (a bounce), every anchor visible through its
hold, all five on the poster, and the look-at's position along the arm never back toward the tip after the tip key.
The report also compares each chapter's turn with the storyboard's target (STORYBOARD_TURN), measures the crystal's size
on screen, and carries the key light's trailing orientation (KEY_TRAIL) for every frame.
"""
import argparse
import ast
import glob
import hashlib
import inspect
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TIMELINE_PATH = os.path.join(HERE, 'timeline.json')
OUT_DEFAULT = 'C:/Users/frank/solidify-hero-out/v4'
MESH_CACHE_DEFAULT = OUT_DEFAULT + '/cache/mesh'
X, Y, Z = np.eye(3)
EDGE_FADE = 0.06              # the page fades the frame over its outer 6 %: an anchor there counts as not visible

# ---- caps (spec) and design constants -----------------------------------------------------------------------------
CAP_PX = 12.0                 # p90 point motion per frame, px at 1200
CAP_DLNW = 0.03               # |d ln width| per frame
CAP_ROLL = 1.0                # twist, deg per frame
CAP_MARGIN = 0.96             # the re-timing aims this far under each cap (mesh-vertex points)
CAP_MARGIN_PROXY = 0.92       # ... on frozen frames when the close-up mesh is not found and the sphere proxy stands in
HOLD_SPEED = 3.3              # soft hold, px per frame
HOLD_MIN = 3.0                # spec: a hold never slower than this
HOLD_FRAMES_MIN = 16
WINDOW_PAD = 10               # --propose: a callout's window is its hold and this many frames either side
OMEGA_MAX = 3.4               # design cap on the view-direction turn, deg per frame (the seed turns at about this)
GLIDE_RAMP = 0.3              # a glide accelerates over its first 30 % and brakes over its last 30 % (sin^2, C1)
VW_RHO = 1.0                  # zoom_pan_path's zoom / pan trade-off (d3 uses sqrt 2; larger zooms out more)
VW_T = (0.2, 0.4, 0.6, 0.8)   # where that path is sampled into keys
VW_MAX_OUT = 1.6              # ... never wider than this x the wider end of the leg
TURN_JUMP = 0.25              # check: the turn rate may change by at most this fraction of itself in one frame ...
TURN_JUMP_FLOOR = 0.1         # ... while it is above this (deg/frame; the braked stop on the poster is exempt below it)
FLOW_JUMP_MAX = 2.5           # check: the picture's flow (the median screen displacement of its points, px/frame at 1200)
                              # may change by at most this much from one frame to the next. Calibrated 2026-09-24: a
                              # pull-back whose camera heading reversed within ~2 deg of arc (a bounce: the flow swung
                              # ~120 deg in two frames) jumped 5.5 and 3.4 px; the passing path's largest jump is 1.4 px
                              # (the look-at starting to slide onto the arm), its 95th percentile 0.46. A direction test
                              # cannot do this: at the full view the median flow of an orbiting crystal is ~0 and its
                              # direction noise, and at a callout's soft hold the look-at turns round on purpose
SLEW = 0.18                   # the re-timing keeps each frame's turn within this fraction of the previous frame's ...
SLEW_FLOOR = 0.06             # ... while that is above this (deg/frame): where the zoom or the pan hands the pixel budget
                              # back to the turn (or takes it), the turn eases instead of jumping; a slower turn is
                              # raised only as far as the caps allow
# the storyboard's turn per chapter (concept A, deg of camera travel): the report compares the path with it
STORYBOARD_TURN = {'seed': 120.0, 'grow': 240.0, 'branch': 120.0, 'cool': 40.0, 'tour': 110.0, 'pullback': 70.0}

LENS_GROWTH = 55.0
LENS_TOUR = 70.0
SPAN0 = 0.15                  # bounding-circle diameter / frame width at frame 0 (the nucleus)
SPAN1 = 0.86                  # ... at the end of growth (whole crystal inside the page's 6 % edge fade)
SPAN_BLEND = 8                # frames either side of the seed's end over which the seed's log-rate law hands over to the
                              # linear climb of the span (C1)
ORBIT_DEG = 540.0             # azimuth travel through seed + grow + branch (one and a half turns over 276 frames)
AZ_DIR = -1.0                 # azimuth decreases (the lathe that follows turns the same way)
# elevation: one slow swell, el = EL_CENTER - EL_AMP cos(2 pi (alpha - EL_TROUGH) / EL_PERIOD): low while the crystal is
# small and turns fast (an orbit twists the view by turn x sin(elevation), and the twist cap would otherwise throttle
# the turn there), a crest near the hand-over. The period is no multiple of 90, so a quarter turn never shows the same
# view of the cube-symmetric crystal twice
EL_CENTER, EL_AMP, EL_PERIOD, EL_TROUGH = 25.0, 12.0, 700.0, 100.0
HANDOVER_EASE = True          # the look-at / width channel eases in over the whole hand-over (the orbit keeps turning)
HANDOVER_PX_RAMP = 0.3        # the hand-over's screen speed eases from the growth's to the cap over this much of it
AZ_END_AHEAD = 18.0           # the orbit ends this far (azimuth) short of the lathe's first view
TRANS_EXT = 18.0              # the hand-over extends the orbit forward and the lathe back by this many deg each (= the
                              # orbit's shortfall, so the extended orbit arrives next to the lathe's first view)
LATHE_LEAD = 20.0             # the lathe is pure this many deg of phi before the first tour key
LATHE_TAIL = 14.0             # ... and this many deg past the last one (its hold), before the pull-back blend starts
# an option: the pull-back widens FIRST and turns mostly wide, a channel key dict(frac, W, P) that far (in u) from the
# last tour key to the poster already framing W x the poster's width, its look-at P of the way to the poster's.
# Measured 2026-09-24: 117 frames at the cap with it, 120 without; but its zoom ends abruptly in u, and the turn that
# takes the pixel budget back then has to ease in (the slew limit), so the picture nearly stalls (11.5 -> 3.5 -> 11.5
# px/frame over ~10 frames). Off: the zoom-and-pan path spreads the widening over the whole pull-back.
PULL_WIDE = None

# the tour: one key per callout, at the center of its hold. phi = lathe angle about +x (0 = camera on +y, 90 = above
# (+z), 180 = on -y), beta = angle between the camera direction and +x (90 = side on), W = frame width at the look-at
# (model units), (sx, sy) = where the look-at P sits in the frame (fractions from the top-left; sy > 0.5 puts it low,
# leaving the room above the trunk to the crystal's mass); P is the feature point itself (pairs: their midpoint)
# Chosen from --scan-keys on the seed-7 features (2026-09-24): each key sits inside its feature's visible region with
# room for its hold either side (the neck, a +z arm's root at 0.63 L, reads from phi 155-195 at beta 65-75, the lambda2
# pair on the -y flank from phi 70-150, the tertiary almost everywhere past phi 70); about 27 deg of lathe between keys
TOUR_KEYS = [
    dict(id='primary', phi=50.0, beta=60.0, W=1.50, P=(0.70, 0.0, 0.0), sx=0.50, sy=0.55, fstop=11.0, ev=-0.05, kd=0.0),
    dict(id='tip', phi=78.0, beta=62.0, W=0.72, sx=0.38, sy=0.62, fstop=6.0, ev=-0.10, kd=0.0),
    dict(id='lambda2', phi=105.0, beta=72.0, W=0.72, sx=0.45, sy=0.62, fstop=6.0, ev=-0.10, kd=0.0),
    dict(id='tertiary', phi=132.0, beta=72.0, W=0.56, sx=0.45, sy=0.62, fstop=4.0, ev=-0.10, kd=0.0),
    dict(id='neck', phi=160.0, beta=70.0, W=0.50, sx=0.45, sy=0.62, fstop=8.0, ev=-0.10, kd=0.12),
]
# the poster: the whole crystal at the tour lens (so the pull-back is a pure dolly)
POSTER_KEY = dict(W=None, P=(0.0, 0.0, 0.0), sx=0.5, sy=0.5, fstop=16.0, ev=0.0, kd=0.0, lens=LENS_TOUR)
THETA = None                  # trunk screen angle on the lathe (deg, x right, y down); None = zero dutch at lathe entry
# the poster pose is the end of the pull-back's track (search_pull): at (az, el) with el in POSTER_EL, >= POSTER_MIRROR
# deg off the cube's mirror planes (below 60 deg of elevation), all five anchors in frame and unoccluded, at least
# POSTER_NEIGHBORS of its 8 neighbors (+-POSTER_STEP / 2) passing too (robust to small path errors), reached from the
# lathe by turning the azimuth one way by at most POSTER_DAZ_MAX; among the tracks whose turn is within PULL_TURN_TOL of
# POSTER_TURN, the gentlest, then the most neighbors, then elevation nearest POSTER_EL0
POSTER_SEARCH = True
POSTER_STEP = 5.0
POSTER_EL = (15.0, 70.0)
POSTER_EL0 = 35.0
POSTER_MIRROR = 6.0
POSTER_NEIGHBORS = 6
POSTER_DAZ_MAX = 200.0
POSTER_TURN = 70.0
PULL_TURN_TOL = 10.0          # ... tracks whose turn is this close to POSTER_TURN compete on gentleness
PULL_ARC = (40.0, 110.0, 5.0)       # the pull-back tracks searched: arc length (deg) from, to, step ...
PULL_DPSI = (-175.0, -95.0, 5.0)    # ... total heading rotation (deg; from 'down' through 'toward lower azimuth' to at
                                    # most 'up', so the azimuth never increases) ...
PULL_Q = (0.3, 0.4, 0.5, 0.65, 0.8)  # ... and the share of the arc the heading turns over (then it runs straight on)
POSTER_FALLBACK = dict(arc=60.0, dpsi=-150.0, q=0.5)    # used only without the occlusion model (no sphere set)
# the key light trails the camera: it turns KEY_TRAIL of the camera's own per-frame rotation (rim, fill and bounce stay
# on the camera), so the shading moves over the crystal as it turns. The trail is anchored (equal to the camera rig) at
# the frame KEY_TRAIL_ANCHOR ('auto' = the tour hold or poster frame that keeps every hold and the poster nearest the
# designed rig) and integrated forward and back from there
KEY_TRAIL = 0.4
KEY_TRAIL_ANCHOR = 'auto'

T_GRID = (0.03, 0.04, 0.05, 0.06, 0.075, 0.09, 0.11, 0.135, 0.165, 0.2, 0.25, 0.31, 0.38, 0.46, 0.55, 0.65, 0.76,
          0.88, 1.0)
POINTS_VERSION = 2            # the point-cloud recipe (sample_cloud); part of the points cache key

# tour feature picks (shared: render_sequence.py measures the neck candidates on the close-up mesh, the skeleton
# fallback here takes them from the model). The look-at slides from the tip toward the root, so the tertiary's host
# station must lie at or tipward of the neck's root and the lambda2 pair tipward of the tertiary:
TERT_DIR = (0.0, -1.0, 0.0)          # the tertiary points -y (toward the late tour's views, ~30 deg out of the image)
TERT_HOST_FACING = (0.0, -1.0, 1.0)  # on a host standing on the camera's side of the trunk (+z or -y)
TERT_MIN_LEN = 0.04                  # and at least this long (model units)
L2_ROWS = (1, 0, 2, 3)               # lambda2 rows, best first (1 = -y: side-on from the lathe's views over -y)
L2_MIN_PROT = 4.0                    # both arms protrude > this many tip radii and are still growing
L2_TIPWARD = 0.02                    # the pair's middle at least this x L tipward of the tertiary's host station
L2_MAX_SPAR = 0.90                   # ... and inside this x L (the arms near the tip are stubs)


# =====================================================================================================================
# timeline (numpy only; render_sequence.py, encode_frames.py and preview_sheet.py read these)
# =====================================================================================================================
def load_timeline(path=None):
    path = path or TIMELINE_PATH
    with open(path) as fh:
        TL = json.load(fh)
    errs = timeline_errors(TL)
    if errs:
        raise ValueError('timeline %s: %s' % (path, '; '.join(errs)))
    TL['_path'] = os.path.abspath(path)
    return TL


def timeline_errors(TL):
    """structural errors only (the frame set must be well formed); design rules such as the soft hold's length are the
    planner's check (report), so an older frame set (v3: no holds) still loads."""
    errs = []
    N = int(TL['frames'])
    ch = TL['chapters']
    if ch[0]['from'] != 0 or ch[-1]['to'] != N - 1:
        errs.append('chapters must run 0..%d' % (N - 1))
    for a, b in zip(ch[:-1], ch[1:]):
        if b['from'] != a['to'] + 1:
            errs.append('chapters %s / %s not contiguous' % (a['id'], b['id']))
    tour = [c for c in ch if c['id'] == 'tour']
    if not tour:
        errs.append('no tour chapter')
    fs = TL['features']
    for k, f in enumerate(fs):
        if 'hold' in f:
            h0, h1 = f['hold']
            if not (f['from'] <= h0 <= h1 <= f['to']):
                errs.append('%s: hold %s outside its window' % (f['id'], f['hold']))
        elif int(TL.get('version', 4)) >= 4:
            errs.append('%s: no hold (a v4 timeline gives every feature one)' % f['id'])
        if tour and not (tour[0]['from'] <= f['from'] and f['to'] <= tour[0]['to']):
            errs.append('%s: window outside the tour' % f['id'])
        if k and f['from'] <= fs[k - 1]['to']:
            errs.append('%s overlaps %s' % (f['id'], fs[k - 1]['id']))
    if not (0 <= TL['poster'] < N):
        errs.append('poster outside the frames')
    g = TL['growth']
    if not (0 <= g['from'] < g['to'] < N):
        errs.append('growth range')
    return errs


def n_frames(TL):
    return int(TL['frames'])


def chapter_list(TL):
    return [(c['id'], int(c['from']), int(c['to'])) for c in TL['chapters']]


def feature_list(TL):
    return [(f['id'], f['kind'], int(f['from']), int(f['to'])) for f in TL['features']]


def chapter_span(TL, cid):
    for c in TL['chapters']:
        if c['id'] == cid:
            return int(c['from']), int(c['to'])
    raise KeyError(cid)


def chapter_of(TL, f):
    for c in TL['chapters']:
        if c['from'] <= f <= c['to']:
            return c['id']
    raise ValueError(f)


def t_of(TL, f):
    """growth time: 'linear' in frame through the growth range (constant tip speed, v4), or v3's 'ease-out'
    (t0 + (t1 - t0)(1 - (1 - x)^power)); clamped outside the range."""
    g = TL['growth']
    t0, t1 = g['t']
    if f <= g['from']:
        return float(t0)
    if f >= g['to']:
        return float(t1)
    x = (f - g['from']) / float(g['to'] - g['from'])
    if g.get('law', 'linear') == 'ease-out':
        x = 1.0 - (1.0 - x) ** float(g.get('power', 1.8))
    return float(t0 + (t1 - t0) * x)


def warmth_of(TL, f):
    """the light rig: warm (1) until the cool chapter, eased to neutral (0) across it ('cosine', or v3's
    'smoothstep')."""
    w = TL['warmth']
    if f <= w['from']:
        return 1.0
    if f >= w['to']:
        return 0.0
    x = (f - w['from']) / float(w['to'] - w['from'])
    if w.get('law', 'cosine') == 'smoothstep':
        return 1.0 - x * x * (3.0 - 2.0 * x)
    return 0.5 * (1.0 + math.cos(math.pi * x))


def frozen(TL, f):
    """the crystal is at t = 1 (no more growth): these frames render the close-up (fine) mesh."""
    return f >= int(TL['growth']['to'])


V3_BUDGET_PER_FRAME = {1200: 69905, 600: 20389}  # bytes per frame: v3's set budgets (12 MiB / 3.5 MiB for 180 frames)


def budget_bytes(TL, size):
    """the byte budget of the `size` set (1200, 600) or of one poster ('poster'): timeline.budget_bytes when given,
    else v3's per-frame budget x N (the posters 400 KiB)."""
    b = TL.get('budget_bytes') or {}
    if str(size) in b:
        return int(b[str(size)])
    if size == 'poster':
        return 400 * 1024
    return int(V3_BUDGET_PER_FRAME[int(size)] * n_frames(TL))


# =====================================================================================================================
# code digests (numpy only; mesh_cache.py keys the mesh cache with these, render_sequence.py checks path.json with them)
# =====================================================================================================================
def code_digest(path):
    """sha1 of a module's CODE: its syntax tree (ast.dump) with every docstring removed, so an edit that can change what
    the code does changes the digest (any statement, expression, literal or name, print text included) and an edit to a
    comment, a docstring or the formatting does not."""
    with open(path, encoding='utf-8') as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = node.body
            if b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant) and isinstance(b[0].value.value, str):
                node.body = b[1:] or [ast.Pass()]
    return hashlib.sha1(ast.dump(tree).encode()).hexdigest()


def source_digest(path):
    """sha1 of a module's source with its comments, docstrings, trailing whitespace and blank lines removed: like
    code_digest a comment or docstring edit keeps it, but it does not depend on the Python version (ast.dump's text
    differs between Blender's Python 3.11 and a system 3.12, so an AST digest from the planner never matched the
    renderer's). The planner and the renderer compare generators with this; the mesh cache (Blender only) keeps
    code_digest."""
    import io
    import tokenize
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    kill = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = node.body
            if b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant) and isinstance(b[0].value.value, str):
                kill.update(range(b[0].lineno, b[0].end_lineno + 1))
    cut = {}
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.COMMENT:
            cut[tok.start[0]] = tok.start[1]
    out = []
    for i, line in enumerate(src.splitlines(), 1):
        if i in kill:
            continue
        line = (line[:cut[i]] if i in cut else line).rstrip()
        if line.strip():
            out.append(line)
    return hashlib.sha1('\n'.join(out).encode()).hexdigest()


def _plain(v):
    """plain data only (numbers, strings, None and containers of them): what a key may hash. A function's text carries
    its memory address, which differs from run to run."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return True
    if isinstance(v, (tuple, list)):
        return all(_plain(x) for x in v)
    if isinstance(v, dict):
        return all(isinstance(k, str) and _plain(x) for k, x in v.items())
    return False


def live_constants(mod, tag):
    """the current values of a module's UPPER_CASE plain-data constants, as {tag.NAME: value}: a constant patched at run
    time counts as an edit of the source would."""
    return {'%s.%s' % (tag, k): v for k, v in vars(mod).items() if k.isupper() and not k.startswith('_') and _plain(v)}


# =====================================================================================================================
# camera math (numpy only)
# =====================================================================================================================
def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def dir_from_angles(az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    return np.array([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)])


def angles_of(v):
    v = unit(v)
    return math.degrees(math.atan2(v[1], v[0])), math.degrees(math.atan2(v[2], math.hypot(v[0], v[1])))


def level_frame(view_from):
    """(forward, right, up) for a camera looking from `view_from` toward the target, world z up (roll 0)."""
    f = -unit(view_from)
    r = unit(np.cross(f, Z))
    return f, r, np.cross(r, f)


def lathe_frame(view_from, axis, theta_deg):
    """(forward, right, up) with world direction `axis` at screen angle theta (deg; x right, y down)."""
    f = -unit(view_from)
    a = np.asarray(axis, dtype=np.float64)
    a = unit(a - float(a @ f) * f)
    c = np.cross(a, f)
    th = math.radians(theta_deg)
    r = math.cos(th) * a + math.sin(th) * c
    u = -math.sin(th) * a + math.cos(th) * c
    return f, r, u


def screen_angle(d, f, r, u):
    """angle (deg) of world direction d on screen: x right, y DOWN (0 = right, -90 = up)."""
    return math.degrees(math.atan2(-float(np.dot(d, u)), float(np.dot(d, r))))


def dutch_roll(f, r, u):
    """v3's roll: the camera's rotation about its view axis away from the level (world z up) frame, deg."""
    _f, r0, u0 = level_frame(-f)
    return math.degrees(math.atan2(float(r @ u0), float(r @ r0)))


def lathe_dir(phi_deg, beta_deg):
    """camera direction (from target toward camera) at lathe angle phi about +x and angle beta from +x."""
    p, b = math.radians(phi_deg), math.radians(beta_deg)
    return np.array([math.cos(b), math.sin(b) * math.cos(p), math.sin(b) * math.sin(p)])


def frame_matrix(f, r, u):
    """camera-to-world rotation (columns: camera x = right, y = up, z = -forward), as Blender's camera."""
    return np.column_stack([r, u, -f])


class Cam:
    """pinhole camera as look.py frames it: square frame, 36 mm horizontal sensor, the target at the frame center,
    the frame `width` model units wide at the target's depth."""

    def __init__(self, f, r, u, target, width, lens, res=1200):
        self.f, self.r, self.u = np.asarray(f), np.asarray(r), np.asarray(u)
        self.T = np.asarray(target, dtype=np.float64)
        self.W, self.lens, self.res = float(width), float(lens), res
        self.tan_half = 18.0 / float(lens)
        self.dist = 0.5 * self.W / self.tan_half
        self.loc = self.T - self.f * self.dist

    def project(self, pts):
        d = pts - self.loc
        z = d @ self.f
        zs = np.maximum(z, 1e-9)
        x = (d @ self.r) / zs / self.tan_half
        y = (d @ self.u) / zs / self.tan_half
        return np.stack([(0.5 + 0.5 * x) * self.res, (0.5 - 0.5 * y) * self.res], axis=1), z > 1e-6


def target_of(P, sx, sy, W, r, u):
    """the frame-center point that puts world point P at (sx, sy) (fractions from the top-left) at width W."""
    return np.asarray(P, dtype=np.float64) - (sx - 0.5) * W * r + (sy - 0.5) * W * u


# =====================================================================================================================
# path.json reader (numpy only)
# =====================================================================================================================
def load_path(path):
    with open(path) as fh:
        data = json.load(fh)
    frames = data['frames']
    for k, rec in enumerate(frames):
        if rec['f'] != k:
            raise ValueError('path %s: frame %d out of order' % (path, k))
    return data


def view_of(rec):
    """the look.Look.frame() view dict for one path.json frame record."""
    f = np.asarray(rec['forward'], dtype=np.float64)
    return dict(view_from=tuple(-f), up=tuple(rec['up']), lens=rec['lens'], width=rec['width'],
                target=tuple(rec['target']), focus=tuple(rec['P']), fstop=rec['fstop'], exposure=rec['ev'],
                feather=(0.0, 0.0), landmarks=())


def key_frame_of(rec):
    """(forward, right, up) of the key light's trailing frame for one path.json record, or None (a path without it)."""
    M = rec.get('key_basis')
    if M is None:
        return None
    M = np.asarray(M, dtype=np.float64)
    return -M[:, 2], M[:, 0], M[:, 1]


# =====================================================================================================================
# generator access (plain Python: bpy / mathutils stubbed; the skeleton code never touches them)
# =====================================================================================================================
def import_generator():
    try:
        import bpy  # noqa: F401  (inside Blender: the real one)
    except ImportError:
        import types
        bpy = types.ModuleType('bpy')
        mu = types.ModuleType('mathutils')

        class _Stub:
            def __init__(self, *a, **k):
                raise RuntimeError('mathutils is stubbed outside Blender')
        mu.Matrix = _Stub
        mu.Vector = _Stub
        sys.modules.setdefault('bpy', bpy)
        sys.modules.setdefault('mathutils', mu)
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import dendrite_gen as DG
    return DG


def gen_args(DG, seed=7):
    saved = sys.argv
    sys.argv = ['path_plan', '--', '--seed', str(seed), '--no-render']
    try:
        A = DG.parse_args()
    finally:
        sys.argv = saved
    return A


GEN_ARG_SKIP = ('t', 'stages', 'out', 'name', 'res', 'samples', 'exposure', 'key_power', 'views', 'no_render',
                'save_blend', 'cpu', 'gate_soft', 'skeleton_only', 'dump_arms')


def gen_fingerprint(DG, A):
    """(sha1 hex, shaping args): the generator's CODE (source_digest: a comment or docstring edit keeps it, and it is
    the same under Blender's Python and the system's), its live constants and every argument that shapes the crystal.
    path.json records it; render_sequence.py refuses a path planned for another generator."""
    args = {k: v for k, v in sorted(vars(A).items()) if k not in GEN_ARG_SKIP}
    h = hashlib.sha1(source_digest(DG.__file__).encode())
    h.update(json.dumps(live_constants(DG, 'DG'), sort_keys=True, default=str).encode())
    h.update(json.dumps(args, sort_keys=True, default=str).encode())
    return h.hexdigest(), args


def points_key(gen_fp):
    """the point-cloud cache key: the generator fingerprint plus the sampling recipe (POINTS_VERSION and the source of
    sample_cloud), so a change to either rebuilds the clouds."""
    h = hashlib.sha1(gen_fp.encode())
    h.update(('%d|' % POINTS_VERSION).encode())
    h.update(inspect.getsource(sample_cloud).encode())
    return h.hexdigest()[:12]


def fib_dirs(n):
    k = np.arange(n) + 0.5
    z = 1.0 - 2.0 * k / n
    r = np.sqrt(np.maximum(1.0 - z * z, 0.0))
    ph = math.pi * (3.0 - math.sqrt(5.0)) * k
    return np.stack([r * np.cos(ph), r * np.sin(ph), z], axis=1)


def sample_cloud(sp, rng, n_cand=400000, n_max=60000):
    """a surface sample of a sphere set (the drawn crystal before its closing): about n_cand random points spread over
    the spheres in proportion to their area (r^2; every sphere at least one), kept where they lie outside every other
    sphere (the union's surface), so the points cover the surface evenly, like a mesh's vertices; at most n_max."""
    from scipy.spatial import cKDTree
    pos, rad = np.asarray(sp['pos'], dtype=np.float64), np.asarray(sp['rad'], dtype=np.float64)
    i_nuc = int(np.argmax(rad))
    w = rad ** 2
    n_i = np.maximum(1, np.round(n_cand * w / w.sum())).astype(np.int64)
    own = np.repeat(np.arange(len(pos)), n_i)
    d = rng.normal(size=(len(own), 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    pts = pos[own] + rad[own, None] * d
    others = np.arange(len(pos)) != i_nuc
    idx_o = np.flatnonzero(others)
    keep = np.ones(len(pts), dtype=bool)
    k = min(32, len(idx_o))
    if k > 0:
        tree = cKDTree(pos[others])
        for a in range(0, len(pts), 200000):
            b = min(a + 200000, len(pts))
            dist, ii = tree.query(pts[a:b], k=k)
            dist, ii = dist.reshape(b - a, k), ii.reshape(b - a, k)
            ok_i = ii < len(idx_o)
            j = idx_o[np.minimum(ii, len(idx_o) - 1)]
            inside = ok_i & (dist < rad[j] - 1e-9) & (j != own[a:b, None])
            keep[a:b] = ~inside.any(axis=1)
    # the nucleus (the one large sphere) is tested for every point
    keep &= (np.linalg.norm(pts - pos[i_nuc], axis=1) >= rad[i_nuc] - 1e-9) | (own == i_nuc)
    pts = pts[keep]
    if len(pts) > n_max:
        pts = pts[rng.choice(len(pts), n_max, replace=False)]
    return pts.astype(np.float32)


_SKELETONS = {}


def skeleton(DG, A, gfp):
    """the generator's skeleton for fingerprint gfp, built once per process (the point clouds and the sphere set
    share it; ~60-80 s each otherwise)."""
    if gfp not in _SKELETONS:
        _SKELETONS[gfp] = DG.build_skeleton(A, np.random.default_rng(A.seed))
    return _SKELETONS[gfp]


def _save_npz_atomic(fp, **arrays):
    tmp = '%s.%d.part' % (fp, os.getpid())
    with open(tmp, 'wb') as fh:
        np.savez_compressed(fh, **arrays)
    for k in range(20):
        try:
            os.replace(tmp, fp)
            return
        except PermissionError:
            if k == 19:
                raise
            time.sleep(0.25)


def _load_npz(fp, *names):
    """the named arrays of a cache file, or None when it is missing or unreadable (a truncated write)."""
    if not os.path.isfile(fp):
        return None
    try:
        with np.load(fp) as z:
            return [z[n] for n in names]
    except Exception as e:  # noqa
        print('[plan] unreadable cache file %s (%s): rebuilding it' % (fp, e))
        return None


def point_clouds(cache_dir, seed=7, t_grid=T_GRID, log=print):
    """{t: (M, 3) float32} for every t in t_grid, from the generator's sphere sets (sample_cloud), cached under
    <cache_dir>/points/<points_key>/. Also returns the key, the generator fingerprint, the nucleus-radius law, DG, A."""
    DG = import_generator()
    A = gen_args(DG, seed)
    gfp, args = gen_fingerprint(DG, A)
    key = points_key(gfp)
    d = os.path.join(cache_dir, 'points', key)
    os.makedirs(d, exist_ok=True)
    info = os.path.join(d, 'generator_args.json')
    if not os.path.isfile(info):
        tmp = '%s.%d.tmp' % (info, os.getpid())
        with open(tmp, 'w') as fh:
            json.dump(dict(points_key=key, generator=gfp, seed=seed, args=args, source=DG.__file__,
                           points_version=POINTS_VERSION), fh, indent=1, default=str)
        os.replace(tmp, info)
    clouds = {}
    arms = None
    for t in t_grid:
        fp = os.path.join(d, 't%.4f.npz' % t)
        z = _load_npz(fp, 'pts')
        if z is not None:
            clouds[t] = z[0]
            continue
        if arms is None:
            t0 = time.perf_counter()
            arms = skeleton(DG, A, gfp)
            log('[plan] generator skeleton built in %.1fs (points cache %s)' % (time.perf_counter() - t0, key))
        t0 = time.perf_counter()
        DG.update_states(arms, t, A)
        sp = DG.collect_points(arms, t, A)
        pts = sample_cloud(sp, np.random.default_rng(int(t * 1e4) + 17))
        _save_npz_atomic(fp, pts=pts)
        clouds[t] = pts
        log('[plan]   t=%.3f: %d spheres -> %d surface points (%.1fs)' % (t, len(sp['rad']), len(pts),
                                                                         time.perf_counter() - t0))
    nuc = lambda t: float(DG.nucleus_radius(A, t))
    return clouds, key, gfp, nuc, DG, A


def sphere_set(cache_dir, seed=7, t=1.0, log=print):
    """the generator's sphere set (collect_points: pos, rad) at growth time t, cached under the generator fingerprint
    (it does not depend on the point-cloud recipe)."""
    DG = import_generator()
    A = gen_args(DG, seed)
    gfp, _args = gen_fingerprint(DG, A)
    fp = os.path.join(cache_dir, 'points', 'spheres_' + gfp[:12], 'spheres_t%.4f.npz' % t)
    z = _load_npz(fp, 'pos', 'rad')
    if z is not None:
        return {'pos': z[0], 'rad': z[1]}
    t0 = time.perf_counter()
    arms = skeleton(DG, A, gfp)
    DG.update_states(arms, t, A)
    sp = DG.collect_points(arms, t, A)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    _save_npz_atomic(fp, pos=sp['pos'].astype(np.float32), rad=sp['rad'].astype(np.float32))
    log('[plan] sphere set t=%.2f: %d spheres (%.1fs, cached)' % (t, len(sp['rad']), time.perf_counter() - t0))
    return {'pos': sp['pos'], 'rad': sp['rad']}


def growth_mesh_files(fine_fp, TL, log=print):
    """{growth frame: its cached generator mesh file} when EVERY growth frame's mesh is in the close-up mesh's cache
    directory (the same fingerprint: the same generator code and arguments), else None. All or nothing: a partly
    filled cache measured some frames on meshes and the rest on the proxy, whose small offset would put a blip in the
    re-timing at every cached frame."""
    if not fine_fp:
        return None, 0
    d = os.path.dirname(fine_fp)
    out = {}
    for f in range(1, int(TL['growth']['to'])):
        fp = os.path.join(d, 'gen_t%.9f.npz' % t_of(TL, f))
        if os.path.isfile(fp):
            out[f] = fp
    n_need = int(TL['growth']['to']) - 1
    if len(out) < n_need:
        log('[plan] growth frames measured on the sphere proxy: %d of %d growth meshes cached (render_sequence.py '
            '--cache-only builds them all)' % (len(out), n_need))
        return None, len(out)
    log('[plan] growth frames measured on their own cached meshes (%d)' % len(out))
    return out, len(out)


MESH_POINTS_MAX = 40000       # vertices kept per growth mesh for the motion measure (a fixed random subsample)


def fine_mesh_cloud(mesh_key, root=MESH_CACHE_DEFAULT, n=300000, log=print):
    """vertices of the cached close-up mesh whose key is `mesh_key` (features.json: the mesh the frozen frames render),
    a fixed random subsample of n; None when no cached file carries that key."""
    if not mesh_key:
        return None, None
    for fp in sorted(glob.glob(os.path.join(root, '*', 'fine_t1.000000000.npz'))):
        try:
            with np.load(fp, allow_pickle=False) as z:
                if str(z['key']) != mesh_key:
                    continue
                co = z['co'].reshape(-1, 3)
        except Exception as e:  # noqa
            log('[plan] unreadable close-up mesh %s (%s)' % (fp, e))
            continue
        rng = np.random.default_rng(20260924)
        sel = rng.choice(len(co), min(n, len(co)), replace=False)
        log('[plan] frozen frames measured on the close-up mesh %s (%d of %d vertices)' % (fp, len(sel), len(co)))
        return co[np.sort(sel)].astype(np.float64), fp
    return None, None


# =====================================================================================================================
# tour features (shared picks; the neck candidates come from the mesh in render_sequence.py)
# =====================================================================================================================
def tertiary_candidates(DG, px):
    """living, still-growing, fully drawn tertiaries of the +x arm that point TERT_DIR from a host facing
    TERT_HOST_FACING and are at least TERT_MIN_LEN long, longest first."""
    want = unit(TERT_DIR)
    host_face = unit(TERT_HOST_FACING)
    out = []
    for c in px.children:
        if not c.alive or float(np.dot(c.d, host_face)) < 0.5:
            continue
        for g in c.children:
            if not (g.alive and g.age < g.stop_age) or DG.emerge_shift(g) > 0.0:
                continue
            ln = g.L - g.R_root
            if ln < TERT_MIN_LEN or float(np.dot(g.d, want)) < 0.9:
                continue
            out.append(g)
    return sorted(out, key=lambda g: -(g.L - g.R_root))


def choose_tertiary_and_neck(DG, px, necks):
    """the (tertiary, neck) pair for the tour: `necks` = [(score, arm, info)] measured neck candidates (lower score =
    a clearer waist). The tertiary's host station must lie at or tipward of the neck's root (so the look-at moves
    toward the root from the tertiary to the neck): the clearest neck that has such a tertiary, then of those
    tertiaries the nearest the neck along the arm (the shortest pan), then the longest. Returns (tertiary, neck tuple,
    monotone) or, when no pair keeps the order, (the longest tertiary, the clearest neck, False)."""
    terts = tertiary_candidates(DG, px)
    tol = 1e-4
    for nk in sorted(necks, key=lambda x: x[0]):
        s_n = nk[1].s_par
        ok = [g for g in terts if g.parent.s_par >= s_n - tol]
        if ok:
            g = min(ok, key=lambda g: (round(g.parent.s_par - s_n, 4), -(g.L - g.R_root)))
            return g, nk, True
    if not necks:
        return (terts[0] if terts else None), None, False
    return (terts[0] if terts else None), sorted(necks, key=lambda x: x[0])[0], False


def lambda2_channel(DG, c1, c2, t):
    """(narrowest gap between the two envelopes above the zipped bases, radii of each arm there): the liquid channel
    the callout should show open; measured at matched heights above the parent surface (dendrite_gen's rule)."""
    short = min(c1.L - c1.R_root, c2.L - c2.R_root)
    hs = np.linspace(0.35 * short, short, 24)
    r1 = DG.arm_profile(c1, t, c1.L - (c1.R_root + hs), shift=False)[0]
    r2 = DG.arm_profile(c2, t, c2.L - (c2.R_root + hs), shift=False)[0]
    gap = abs(c2.s_par - c1.s_par) - r1 - r2
    return float(gap.min()), float(r1.max()), float(r2.max())


def pick_lambda2(DG, px, t, A, s_min, exclude=()):
    """two adjacent living, still-growing secondaries of one row of the +x arm (rows L2_ROWS, best first), both
    protruding > L2_MIN_PROT tip radii, whose middle lies between s_min and L2_MAX_SPAR x L (tipward of the tertiary,
    so the look-at keeps moving toward the root): an open liquid channel first, then the spacing nearest that row's
    median there (a representative lambda2), then the pair nearest s_min (the shortest pan). The same dict as
    dendrite_gen.extract_features' lambda2_pair, or None."""
    ch_open = 2.0 * A.fillet + DG.CHANNEL_VOXELS_BY_GEN[1] * A.voxel
    L = px.L
    for ri in L2_ROWS:
        row = sorted([c for c in px.children if c.row == ri and c.alive and c.age < c.stop_age
                      and (c.L - c.R_root) > L2_MIN_PROT * c.rho and c.idx not in exclude], key=lambda c: c.s_par)
        pairs = [(c1, c2) for c1, c2 in zip(row[:-1], row[1:])
                 if s_min <= 0.5 * (c1.s_par + c2.s_par) <= L2_MAX_SPAR * L]
        if not pairs:
            continue
        med = float(np.median([c2.s_par - c1.s_par for c1, c2 in pairs]))
        best = None
        for c1, c2 in pairs:
            gap, _r1, _r2 = lambda2_channel(DG, c1, c2, t)
            key = (0 if gap >= ch_open else 1, round(abs((c2.s_par - c1.s_par) - med) / L, 3),
                   0.5 * (c1.s_par + c2.s_par) - s_min)
            if best is None or key < best[0]:
                best = (key, c1, c2)
        _k, c1, c2 = best
        gap, rc1, rc2 = lambda2_channel(DG, c1, c2, t)
        _l = lambda v: [round(float(x), 5) for x in np.asarray(v).ravel()]
        return {
            'row': ri, 'row_direction': _l(c1.d), 'direction': _l(c1.d),
            'root_a': _l(c1.origin + c1.d * c1.R_root), 'tip_a': _l(c1.origin + c1.d * c1.L),
            'root_b': _l(c2.origin + c2.d * c2.R_root), 'tip_b': _l(c2.origin + c2.d * c2.L),
            'spacing': round(abs(c2.s_par - c1.s_par), 5),
            'distance_from_centre': [round(c1.s_par, 5), round(c2.s_par, 5)],
            'arms': [c1.idx, c2.idx],
            'body_radius_a': round(c1.w_now, 5), 'body_radius_b': round(c2.w_now, 5),
            'channel_radius_a': round(rc1, 5), 'channel_radius_b': round(rc2, 5),
            'channel_gap_min': round(gap, 5), 'channel_open': bool(gap >= ch_open),
            'source': 'path_plan.pick_lambda2 (tipward of the tertiary, row %d)' % ri,
        }
    return None


def lambda2_points(lp):
    """the lambda2 callout's two points: each root, 0.35 body radii up its arm (dendrite_gen's pair dict)."""
    rd = np.asarray(lp['row_direction'])
    return (np.asarray(lp['root_a']) + rd * 0.35 * lp['body_radius_a'],
            np.asarray(lp['root_b']) + rd * 0.35 * lp['body_radius_b'])


NECK_ROWS = (2, 1)            # skeleton fallback (render_sequence.neck_candidates measures the mesh): rows the neck may
NECK_SPAR = (0.25, 0.70)      # come from, and its s_par range / L


def skeleton_features(DG, A):
    """fallback feature points from the skeleton alone (no mesh): the picks render_sequence.feature_points makes, except
    that the neck candidates are scored by the MODEL's neck depth (the mesh pick measures the rendered waist; the
    closing fills shallow model necks)."""
    arms = DG.build_skeleton(A, np.random.default_rng(A.seed))
    DG.update_states(arms, 1.0, A)
    feats = DG.extract_features(arms, 1.0, A, A.seed)
    px = [a for a in arms if a.gen == 0][0]
    L = px.L
    necks = []
    for c in px.children:
        if c.row not in NECK_ROWS or not (c.alive and (c.L - c.R_root) > 5.0 * c.rho and c.k_neck > 0.0):
            continue
        if not (NECK_SPAR[0] * L < c.s_par < NECK_SPAR[1] * L):
            continue
        necks.append((-c.k_neck + 0.05 * NECK_ROWS.index(c.row), c, None))
    if not necks:
        raise SystemExit('no secondary in rows %s with a model neck in %s L' % (NECK_ROWS, NECK_SPAR))
    g, nk, mono = choose_tertiary_and_neck(DG, px, necks)
    best = nk[1]
    rr = DG.root_rmax(best, 1.0)
    neck = best.origin + best.d * (best.R_root + DG.NECK_POS * rr)
    lp = pick_lambda2(DG, px, 1.0, A, (g.parent.s_par if g is not None else best.s_par) + L2_TIPWARD * L,
                      exclude={best.idx}) or feats['lambda2_pair']
    la, lb = lambda2_points(lp)
    t_root, t_tip = g.origin + g.d * g.R_root, g.origin + g.d * g.L
    tips = [tp['position'] for tp in feats['tips']]
    return dict(source='skeleton (provisional: the neck is not measured on the mesh)',
                points={'tip': [(px.origin + px.d * L).tolist()],
                        'primary': [[0.30 * L, 0.0, 0.0], [0.92 * L, 0.0, 0.0]],
                        'lambda2': [la.tolist(), lb.tolist()],
                        'tertiary': [(t_root + (t_tip - t_root) * 0.8).tolist()],
                        'neck': [neck.tolist()]},
                neck_dir=best.d.tolist(), neck_arm=best.idx, neck_row=best.row, neck_s_par=best.s_par,
                order_monotone=bool(mono), tips=tips, L1=float(max(np.linalg.norm(tips, axis=1))),
                primary_length=float(L))


def load_features(path, DG=None, A=None, log=print):
    if path and os.path.isfile(path):
        with open(path) as fh:
            F = json.load(fh)
        F.setdefault('source', 'render_sequence.py --features-only (%s)' % path)
        return F
    log('[plan] no features file at %s: skeleton-only fallback (run render_sequence.py --features-only)' % path)
    return skeleton_features(DG, A)


def feature_P(F, fid):
    pts = np.asarray(F['points'][fid], dtype=np.float64)
    return pts.mean(axis=0)


# =====================================================================================================================
# splines
# =====================================================================================================================
class CompositeCR:
    """centripetal Catmull-Rom (Barry-Goldman, alpha 0.5) through key vectors, reached from the path parameter u by a
    monotone PCHIP map u -> knot, so the curve is C1 in u. dist_fn(a, b) is the key-to-key distance the knots use."""

    def __init__(self, u_keys, values, dist_fn, floor=1e-3):
        from scipy.interpolate import PchipInterpolator
        self.u = np.asarray(u_keys, dtype=np.float64)
        V = np.asarray(values, dtype=np.float64)
        n = len(V)
        d = np.array([max(dist_fn(V[i], V[i + 1]), floor) for i in range(n - 1)])
        kn = np.concatenate([[0.0], np.cumsum(np.sqrt(d))])
        self.kn = np.concatenate([[kn[0] - (kn[1] - kn[0])], kn, [kn[-1] + (kn[-1] - kn[-2])]])
        self.V = np.vstack([2 * V[0] - V[1], V, 2 * V[-1] - V[-2]])
        self.map = PchipInterpolator(self.u, kn)

    def __call__(self, u):
        return self.many(np.array([u], dtype=np.float64))[0]

    def many(self, us):
        """the curve at an array of path parameters (vectorized Barry-Goldman)."""
        k = self.map(np.clip(us, self.u[0], self.u[-1]))[:, None]
        i = np.clip(np.searchsorted(self.kn, k[:, 0], side='right') - 1, 1, len(self.kn) - 3)
        t0, t1, t2, t3 = (self.kn[i + j][:, None] for j in (-1, 0, 1, 2))
        P0, P1, P2, P3 = (self.V[i + j] for j in (-1, 0, 1, 2))
        A1 = ((t1 - k) * P0 + (k - t0) * P1) / (t1 - t0)
        A2 = ((t2 - k) * P1 + (k - t1) * P2) / (t2 - t1)
        A3 = ((t3 - k) * P2 + (k - t2) * P3) / (t3 - t2)
        B1 = ((t2 - k) * A1 + (k - t0) * A2) / (t2 - t0)
        B2 = ((t3 - k) * A2 + (k - t1) * A3) / (t3 - t1)
        return ((t2 - k) * B1 + (k - t1) * B2) / (t2 - t1)


def quat_matrix(q):
    """rotation matrix of a unit quaternion (x, y, z, w)."""
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def rotvec_of(R):
    """rotation vector (axis x angle, rad) of a rotation matrix (angle < 180 deg)."""
    s = 0.5 * np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    c = 0.5 * (np.trace(R) - 1.0)
    sn = float(np.linalg.norm(s))
    ang = math.atan2(sn, max(-1.0, min(1.0, c)))
    return s * (ang / sn) if sn > 1e-12 else s


def zoom_pan_path(P0, W0, P1, W1, rho):
    """van Wijk & Nuij (2003), 'Smooth and efficient zooming and panning' (the path d3.interpolateZoom takes): the
    optimal joint pan + zoom from look-at P0 at frame width W0 to P1 at W1. Returns f(t) -> (P, W) for t in [0, 1],
    uniform in the path's own perceived length (zoom out, pan while wide, zoom in; a pure zoom when P0 == P1)."""
    P0, P1 = np.asarray(P0, dtype=np.float64), np.asarray(P1, dtype=np.float64)
    d = P1 - P0
    d1 = float(np.linalg.norm(d))
    r2, r4 = rho * rho, rho ** 4
    if d1 < 1e-9:
        S = math.log(W1 / W0) / rho
        return lambda t: (P0 + t * d, W0 * math.exp(rho * t * S))
    b0 = (W1 * W1 - W0 * W0 + r4 * d1 * d1) / (2.0 * W0 * r2 * d1)
    b1 = (W1 * W1 - W0 * W0 - r4 * d1 * d1) / (2.0 * W1 * r2 * d1)
    q0 = math.log(math.sqrt(b0 * b0 + 1.0) - b0)
    q1 = math.log(math.sqrt(b1 * b1 + 1.0) - b1)
    S = (q1 - q0) / rho

    def at(t):
        s = t * S
        uf = W0 / (r2 * d1) * (math.cosh(q0) * math.tanh(rho * s + q0) - math.sinh(q0))
        return P0 + uf * d, W0 * math.cosh(q0) / math.cosh(rho * s + q0)
    return at


def smoothstep(x):
    x = min(1.0, max(0.0, float(x)))
    return x * x * (3.0 - 2.0 * x)


def smootherstep(x):
    x = min(1.0, max(0.0, float(x)))
    return x * x * x * (x * (6.0 * x - 15.0) + 10.0)


def slerp_toward(Ra, Rb, w):
    """the rotation w of the way from Ra to Rb (scipy Rotations, the shorter arc)."""
    from scipy.spatial.transform import Rotation
    return Ra * Rotation.from_rotvec(w * (Ra.inv() * Rb).as_rotvec())


# =====================================================================================================================
# the plan
# =====================================================================================================================
class Plan:
    """keys -> splines for one timeline + feature set; state(u, f) is the camera at path parameter u on frame f."""

    CH = ('Px', 'Py', 'Pz', 'sx', 'sy', 'lnZ', 'lnF', 'ev', 'kd')

    def __init__(self, TL, F, nuc_r, design=None, log=print, occ=None):
        from scipy.interpolate import PchipInterpolator
        self.TL, self.F, self.log = TL, F, log
        self.occ = occ
        self.tol = feature_tolerances(F, occ)
        self.poster_search = None
        self.N = n_frames(TL)
        self.G = int(TL['growth']['to'])
        try:
            self.F_S = chapter_span(TL, 'seed')[1]
        except KeyError:
            self.F_S = max(1, self.G // 8)
        self.nuc_r = nuc_r
        D = dict(TOUR_KEYS=TOUR_KEYS, POSTER_KEY=POSTER_KEY, THETA=THETA)
        D.update(design or {})
        self.D = D
        self.L1 = float(F['L1'])
        # growth framing: the seed's log-rate law ln W = a ln e + b (SPAN0 at frame 0, SPAN1 at the end of growth),
        # then a linear climb of the span from its value at the seed's end to SPAN1 (lnW_frame)
        e0, e1 = self.extent(t_of(TL, 0)), self.extent(t_of(TL, self.G))
        W0, W1 = e0 / SPAN0, e1 / SPAN1
        self.dolly_a = math.log(W1 / W0) / math.log(e1 / e0)
        self.dolly_b = math.log(W0) - self.dolly_a * math.log(e0)
        self.W_full = W1
        self.span_S = self.span_seed(self.F_S)
        # the lathe
        tk = D['TOUR_KEYS']
        self.phi_L0 = tk[0]['phi'] - LATHE_LEAD
        self.phi_n = tk[-1]['phi']
        self.phi_B = self.phi_n + LATHE_TAIL
        p = PchipInterpolator([k['phi'] for k in tk], [k['beta'] for k in tk])
        lo, hi = tk[0]['phi'], tk[-1]['phi']
        self.beta_fn = lambda phi: float(p(min(max(phi, lo), hi)))
        v_L0 = lathe_dir(self.phi_L0, self.beta_fn(self.phi_L0))
        az_L0, _el_L0 = angles_of(v_L0)
        self.az_end = az_L0 - AZ_DIR * AZ_END_AHEAD
        self.az0 = self.az_end - AZ_DIR * ORBIT_DEG
        if D['THETA'] is None:           # trunk screen angle on the lathe: zero dutch at the lathe entry
            f0, r0, u0 = level_frame(v_L0)
            self.theta = screen_angle(X, f0, r0, u0)
        else:
            self.theta = float(D['THETA'])
        # the poster pose (whole view sphere) and the pull-back that reaches it
        vB = lathe_dir(self.phi_B, self.beta_fn(self.phi_B))
        self.az_B, self.el_B = angles_of(vB)
        self.dutch_B = dutch_roll(*self.lathe_frame_at(self.phi_B))
        a1, e1 = angles_of(lathe_dir(self.phi_B + 0.05, self.beta_fn(self.phi_B + 0.05)))
        a0, e0 = angles_of(lathe_dir(self.phi_B - 0.05, self.beta_fn(self.phi_B - 0.05)))
        self.psi_B = math.degrees(math.atan2(e1 - e0, ((a1 - a0 + 180.0) % 360.0 - 180.0) *
                                             math.cos(math.radians(self.el_B))))
        self.tail_arc = float(self.arc_length([frame_matrix(*self.lathe_frame_at(self.phi_n + x))
                                               for x in np.linspace(0.0, LATHE_TAIL, 15)])[-1])
        pk = dict(D['POSTER_KEY'])
        if POSTER_SEARCH and occ is not None:
            pk = self.search_pull(pk)
        else:
            self.pull = dict(POSTER_FALLBACK)
            self._pull_track = self.pull_track(self.pull['arc'], self.pull['dpsi'], self.pull.get('q', 1.0))
            pk.update(az=float(self._pull_track[-1][0]), el=float(self._pull_track[-1][1]))
        pk['daz'] = self.daz_to(pk['az'])
        D['POSTER_KEY'] = pk
        self.poster = pk
        # the orientation path, parameterized by the view direction's arc length
        self.build_path()
        # channel keys
        keys_u, keys_v, self.key_ids = [], [], []

        def add(u, P, sx, sy, W, fstop, ev, kd, kid):
            keys_u.append(u)
            keys_v.append([P[0], P[1], P[2], sx, sy, math.log(W / self.W_full), math.log(fstop), ev, kd])
            self.key_ids.append(kid)
        g0 = dict(P=(0.0, 0.0, 0.0), sx=0.5, sy=0.5, W=self.W_full, fstop=16.0, ev=0.0, kd=0.0)
        add(0.0, kid='start', **g0)
        add(self.u_orbit_end, kid='orbit_end', **g0)
        self.tour_u = {}
        for k in tk:
            u = self.u_of_phi(k['phi'])
            self.tour_u[k['id']] = u
            P = k['P'] if k.get('P') is not None else feature_P(F, k['id'])      # a key may aim elsewhere
            add(u, P, k['sx'], k['sy'], k['W'], k['fstop'], k['ev'], k['kd'], k['id'])
        if PULL_WIDE:
            kn = tk[-1]
            u_n = self.tour_u[kn['id']]
            Pn = np.asarray(kn['P'] if kn.get('P') is not None else feature_P(F, kn['id']), dtype=np.float64)
            Pw = (1.0 - PULL_WIDE['P']) * Pn + PULL_WIDE['P'] * np.asarray(pk['P'], dtype=np.float64)
            add(u_n + PULL_WIDE['frac'] * (self.u_end - u_n), Pw, pk['sx'], pk['sy'],
                PULL_WIDE['W'] * (pk['W'] or self.W_full), pk['fstop'], pk['ev'], pk['kd'], 'pull_wide')
        add(self.u_end, pk['P'], pk['sx'], pk['sy'], pk['W'] or self.W_full, pk['fstop'], pk['ev'], pk['kd'], 'poster')
        # between consecutive keys from the orbit's end on, the look-at and the width follow the optimal zoom-and-pan
        # path (zoom_pan_path) instead of moving in lockstep: a few samples of it become extra keys, never wider than
        # VW_MAX_OUT x the wider end and never wider than the full view; the other channels go linearly in between
        ku, kv, kid = [keys_u[0], keys_u[1]], [keys_v[0], keys_v[1]], self.key_ids[:2]
        for i in range(1, len(keys_u) - 1):
            a, b = np.asarray(keys_v[i]), np.asarray(keys_v[i + 1])
            Wa, Wb = self.W_full * math.exp(a[5]), self.W_full * math.exp(b[5])
            if float(np.linalg.norm(b[:3] - a[:3])) > 0.02:
                zp = zoom_pan_path(a[:3], Wa, b[:3], Wb, VW_RHO)
                cap = min(VW_MAX_OUT * max(Wa, Wb), 1.02 * self.W_full)
                for t in VW_T:
                    P, W = zp(t)
                    v = a + t * (b - a)
                    v[:3] = P
                    v[5] = math.log(min(W, cap) / self.W_full)
                    ku.append(keys_u[i] + t * (keys_u[i + 1] - keys_u[i]))
                    kv.append(v.tolist())
                    kid.append('zoompan')
            ku.append(keys_u[i + 1])
            kv.append(keys_v[i + 1])
            kid.append(self.key_ids[i + 1])
        keys_u, keys_v, self.key_ids = ku, kv, kid
        self.keys_u = np.array(keys_u)

        def dist(a, b):
            Wa, Wb = self.W_full * math.exp(a[5]), self.W_full * math.exp(b[5])
            wm = math.sqrt(Wa * Wb)
            return (float(np.linalg.norm(a[:3] - b[:3])) / wm + abs(a[3] - b[3]) + abs(a[4] - b[4]) + abs(a[5] - b[5])
                    + abs(a[6] - b[6]) / 3.0 + abs(a[7] - b[7]) + abs(a[8] - b[8]))
        self.cr = CompositeCR(keys_u, keys_v, dist)
        # the lens: its own monotone channel, LENS_GROWTH through the orbit, LENS_TOUR from the lathe's entry on
        self.lens_fn = PchipInterpolator([0.0, self.u_orbit_end, self.u_L0, self.u_end],
                                         [LENS_GROWTH, LENS_GROWTH, LENS_TOUR, pk.get('lens', LENS_TOUR)])
        self.tabulate()

    # ---- growth framing -------------------------------------------------------------------------------------------
    def extent(self, t):
        """bounding-sphere diameter of the crystal at growth time t (smooth max of the longest primary and the
        nucleus; primaries grow linearly in t)."""
        ea = self.L1 * t
        en = 1.05 * self.nuc_r(t)
        return 2.0 * (ea ** 6 + en ** 6) ** (1.0 / 6.0)

    def span_seed(self, f):
        """the seed's law: bounding circle / frame width under ln W = a ln e + b."""
        e = self.extent(t_of(self.TL, min(f, self.G)))
        return e / math.exp(self.dolly_a * math.log(e) + self.dolly_b)

    def span_of(self, f):
        """bounding circle / frame width at growth frame f: the seed's law, handing over (smootherstep, SPAN_BLEND
        frames either side of the seed's end) to a linear climb from the seed's end to SPAN1 at the last growth frame."""
        f = min(max(f, 0), self.G)
        lin = self.span_S + (SPAN1 - self.span_S) * (f - self.F_S) / float(self.G - self.F_S)
        w = smootherstep((f - (self.F_S - SPAN_BLEND)) / float(2 * SPAN_BLEND))
        return (1.0 - w) * self.span_seed(f) + w * lin

    def lnW_frame(self, f):
        f = min(f, self.G)
        return math.log(self.extent(t_of(self.TL, f))) - math.log(self.span_of(f))

    # ---- the orientation path -------------------------------------------------------------------------------------
    def orbit_angles(self, alpha):
        az = self.az0 + AZ_DIR * alpha
        el = EL_CENTER - EL_AMP * math.cos(2.0 * math.pi * (alpha - EL_TROUGH) / EL_PERIOD)
        return az, el

    def orbit_frame(self, alpha):
        az, el = self.orbit_angles(alpha)
        return level_frame(dir_from_angles(az, el))

    def lathe_frame_at(self, phi):
        return lathe_frame(lathe_dir(phi, self.beta_fn(phi)), X, self.theta)

    def daz_to(self, az):
        """azimuth the pull-back turns (one way, AZ_DIR) from the lathe's blend start to azimuth az, deg in [0, 360)."""
        return (AZ_DIR * (az - self.az_B)) % 360.0

    def orbit_rolled(self, az, el):
        """the frame looking from (az, el) with the lathe's dutch at the pull-back's start (dutch_B): a level orbit's
        frame turned about its own view axis by a constant angle. The lathe keeps the trunk at one screen angle while it
        passes over the top of the arm, so by the tour's end the picture is rolled ~160 deg against world up; unrolling
        that to a level poster would cost ~1 frame per degree at the roll cap, and a floating cubic crystal has no up."""
        f, r0, u0 = level_frame(dir_from_angles(az, el))
        D = math.radians(self.dutch_B)
        return f, math.cos(D) * r0 + math.sin(D) * u0, math.cos(D) * u0 - math.sin(D) * r0

    def pull_track(self, arc, dpsi, q=1.0, step=0.25):
        """the pull-back's direction path as (az, el) at uniform arc steps (s = k / m): from the lathe's exit, moving
        along the sphere with a MAP heading psi (atan2(d el, cos(el) d az): 180 = a level orbit turning the azimuth
        down, 90 = straight up) that starts on the lathe's own heading psi_B (~ -92: down) and rotates by dpsi (-180 <
        dpsi < 0: from 'down' through 'toward lower azimuth', so the azimuth never increases) along smootherstep(s / q),
        i.e. within the first q of the `arc` degrees, then runs on at the final heading."""
        m = max(2, int(math.ceil(arc / step)))
        dl = arc / m
        az, el = self.az_B, self.el_B
        out = [(az, el)]
        for k in range(m):
            psi = math.radians(self.psi_B + dpsi * smootherstep(((k + 0.5) / m) / q))
            el_mid = el + 0.5 * dl * math.sin(psi)
            az += dl * math.cos(psi) / max(math.cos(math.radians(el_mid)), 1e-6)
            el += dl * math.sin(psi)
            out.append((az, el))
        return np.array(out)

    def pull_dirs(self, ss, az_p=None, el_p=None):
        """the pull-back's view directions at blend positions ss (0..1, uniform in arc) along the chosen track
        (self.pull: arc, dpsi). Past the top of the arm the lathe heads down while every pose that shows all five
        callouts lies above, so the heading must come round: this path turns it at a bounded, smooth rate (a slerp
        between the two moving frames, then a Hermite curve, both turned it within ~2 deg of arc: a bounce, the
        crystal's screen flow swinging ~110-120 deg in two frames)."""
        tr = self._pull_track
        m = len(tr) - 1
        out = []
        for s in np.asarray(ss, dtype=np.float64):
            x = min(max(s, 0.0), 1.0) * m
            i = min(int(x), m - 1)
            w = x - i
            az, el = (1.0 - w) * tr[i] + w * tr[i + 1]
            out.append(dir_from_angles(az, el))
        return out

    def pull_frames(self, ss, az_p=None, el_p=None):
        """the pull-back's orientations at blend positions ss (0..1): along pull_dirs, a camera whose dutch angle (roll
        against the level frame) goes from the lathe's convention (the trunk at its screen angle, dutch unwrapped so it
        is continuous along the curve) to the orbit's constant dutch_B, weight smootherstep(s); the last is the poster.
        The roll is blended as an ANGLE: a slerp between the two frames took the shorter arc, which switched sides where
        their difference passed 180 deg (a roll flip)."""
        ss = np.asarray(ss, dtype=np.float64)
        s_all = np.concatenate([[0.0], ss])
        dirs = self.pull_dirs(s_all, az_p, el_p)
        dl = np.array([dutch_roll(*lathe_frame(v, X, self.theta)) for v in dirs])
        dl = np.degrees(np.unwrap(np.radians(dl)))
        dl += 360.0 * round((self.dutch_B - dl[0]) / 360.0)          # starts at the lathe's own dutch
        out = []
        for s, v, d in zip(s_all[1:], dirs[1:], dl[1:]):
            w = smootherstep(s)
            roll = (1.0 - w) * d + w * self.dutch_B
            f, r0, u0 = level_frame(v)
            R_ = math.radians(roll)
            out.append(frame_matrix(f, math.cos(R_) * r0 + math.sin(R_) * u0, math.cos(R_) * u0 - math.sin(R_) * r0))
        return out

    def handover_frames(self, ss):
        """the cool chapter's hand-over at blend positions ss (0..1): the orbit extended forward and the lathe
        extended back by TRANS_EXT each, slerped with a smootherstep weight (both keep moving: no stop in it)."""
        from scipy.spatial.transform import Rotation
        out = []
        for s in ss:
            Ro = Rotation.from_matrix(frame_matrix(*self.orbit_frame(ORBIT_DEG + s * TRANS_EXT)))
            Rl = Rotation.from_matrix(frame_matrix(*self.lathe_frame_at(self.phi_L0 - (1.0 - s) * TRANS_EXT)))
            out.append(slerp_toward(Ro, Rl, smootherstep(s)).as_matrix())
        return out

    @staticmethod
    def arc_length(mats):
        """cumulative arc length (deg) of the view direction along a list of camera matrices; a step that only rolls
        still advances by a quarter of its rotation, so the parameter always increases."""
        M = np.asarray(mats)
        fw = -M[:, :, 2]
        c = np.clip(np.sum(fw[1:] * fw[:-1], axis=1), -1.0, 1.0)
        dd = np.degrees(np.arccos(c))
        rel = np.einsum('nji,njk->nik', M[:-1], M[1:])
        rt = np.degrees(np.arccos(np.clip((np.trace(rel, axis1=1, axis2=2) - 1.0) * 0.5, -1.0, 1.0)))
        return np.concatenate([[0.0], np.cumsum(np.maximum(dd, 0.25 * rt))])

    def pull_turn(self, arc):
        """the pull-back's turn (arc length of the view direction, deg) from the last tour key: the lathe's tail and
        the track."""
        return self.tail_arc + float(arc)

    def build_path(self):
        """dense orientation samples of orbit, hand-over, lathe and pull-back, the arc-length parameter u of each, and
        the RotationSpline through them."""
        from scipy.spatial.transform import Rotation, RotationSpline
        mats, tags = [], []
        for a in np.arange(0.0, ORBIT_DEG + 1e-9, 2.0):
            mats.append(frame_matrix(*self.orbit_frame(a)))
            tags.append(('orbit', a))
        for s in np.linspace(0.0, 1.0, 41)[1:-1]:
            mats.append(self.handover_frames([s])[0])
            tags.append(('handover', s))
        for ph in np.arange(self.phi_L0, self.phi_B + 1e-9, 1.0):
            mats.append(frame_matrix(*self.lathe_frame_at(ph)))
            tags.append(('lathe', ph))
        if tags[-1][1] < self.phi_B - 1e-9:
            mats.append(frame_matrix(*self.lathe_frame_at(self.phi_B)))
            tags.append(('lathe', self.phi_B))
        ss = np.linspace(0.0, 1.0, 81)[1:]
        for s, M in zip(ss, self.pull_frames(ss, self.poster['az'], self.poster['el'])):
            mats.append(M)
            tags.append(('pull', s))
        u = self.arc_length(mats)
        self.path_u, self.path_tags = u, tags
        idx = {k: [i for i, t in enumerate(tags) if t[0] == k] for k in ('orbit', 'handover', 'lathe', 'pull')}
        self.u_orbit_end = float(u[idx['orbit'][-1]])
        self.u_L0 = float(u[idx['lathe'][0]])
        self.u_B = float(u[idx['lathe'][-1]])
        self.u_end = float(u[-1])
        self._lathe_phi = np.array([tags[i][1] for i in idx['lathe']])
        self._lathe_u = u[idx['lathe']]
        self.R = Rotation.from_matrix(np.array(mats))
        self.rot = RotationSpline(u, self.R)
        self.u_samples = u
        self.turn_pieces = {k: round(float(u[v[-1]] - u[max(v[0] - 1, 0)]), 2) for k, v in idx.items()}

    def u_of_phi(self, phi):
        return float(np.interp(phi, self._lathe_phi, self._lathe_u))

    # ---- poster ---------------------------------------------------------------------------------------------------
    def pose_visible(self, f, r, u, pk):
        """all five anchors in frame and unoccluded at camera frame (f, r, u) framed like pk."""
        W = pk['W'] or self.W_full
        cam = Cam(f, r, u, target_of(pk['P'], pk['sx'], pk['sy'], W, r, u), W, pk.get('lens', LENS_TOUR), 1)
        for fid, pts in self.F['points'].items():
            pts = np.asarray(pts, dtype=np.float64)
            xy, ok = cam.project(pts)
            if not (ok.all() and (xy >= EDGE_FADE).all() and (xy <= 1.0 - EDGE_FADE).all()):
                return False
            if any(self.occ.hidden(cam.loc, p, self.tol[fid][k]) for k, p in enumerate(pts)):
                return False
        return True

    def search_pull(self, pk):
        """the pull-back and its poster (see POSTER_* and PULL_*): over tracks (arc, dpsi) from the lathe's exit
        (pull_track), the endpoint is the poster, a camera at (az, el) framed like pk (the roll does not matter there:
        the whole crystal sits inside the frame's inscribed circle); it must show all five anchors unoccluded with at
        least POSTER_NEIGHBORS of its 8 neighbors (+-POSTER_STEP / 2 in az and el) passing too, keep POSTER_MIRROR off
        the cube's mirror planes below 60 deg of elevation, and lie in POSTER_EL. Among those whose pull-back turn is
        within PULL_TURN_TOL of POSTER_TURN, the gentlest track (smallest peak heading rate, |dpsi| x 1.875 / arc,
        deg of heading per deg of arc), then the most neighbors, then elevation nearest POSTER_EL0; if none is that
        close, the nearest turn."""
        t0 = time.perf_counter()
        cache = {}

        def vis(az, el):
            k = (round(az * 2.0) / 2.0, round(el * 2.0) / 2.0)          # a 0.5 deg grid of poses, each tested once
            if k not in cache:
                cache[k] = self.pose_visible(*level_frame(dir_from_angles(*k)), pk)
            return cache[k]
        h = 0.5 * POSTER_STEP
        cands, n_tracks = [], 0
        for arc in np.arange(PULL_ARC[0], PULL_ARC[1] + 1e-9, PULL_ARC[2]):
            for dpsi in np.arange(PULL_DPSI[0], PULL_DPSI[1] + 1e-9, PULL_DPSI[2]):
                for q in PULL_Q:
                    n_tracks += 1
                    az, el = self.pull_track(arc, dpsi, q, step=0.5)[-1]
                    az = (az + 180.0) % 360.0 - 180.0
                    if not (POSTER_EL[0] <= el <= POSTER_EL[1]):
                        continue
                    if el < 60.0:
                        m = az % 45.0
                        if min(m, 45.0 - m) < POSTER_MIRROR:
                            continue
                    daz = self.daz_to(az)
                    if not (0.0 < daz <= POSTER_DAZ_MAX) or not vis(az, el):
                        continue
                    nb = sum(vis(az + da, el + de) for da in (-h, 0.0, h) for de in (-h, 0.0, h) if da or de)
                    if nb < POSTER_NEIGHBORS:
                        continue
                    cands.append(dict(arc=float(arc), dpsi=float(dpsi), q=float(q), az=round(float(az), 2),
                                      el=round(float(el), 2), neighbors=int(nb), daz=round(daz, 1),
                                      turn=round(self.pull_turn(arc), 1),
                                      heading_rate=round(abs(dpsi) * 1.875 / (q * arc), 2)))
        self.poster_search = dict(tracks=n_tracks, candidates=len(cands), poses_tested=len(cache),
                                  lathe_exit=dict(phi=round(self.phi_B, 2), az=round(self.az_B, 2), el=round(self.el_B, 2),
                                                  heading=round(self.psi_B, 1), tail_arc=round(self.tail_arc, 1)),
                                  seconds=round(time.perf_counter() - t0, 1))
        if not cands:
            self.log('[plan] pull-back search: no track ends on a pose that shows all five anchors; fallback %s' %
                     POSTER_FALLBACK)
            self.pull = dict(POSTER_FALLBACK)
        else:
            near = [c for c in cands if abs(c['turn'] - POSTER_TURN) <= PULL_TURN_TOL]
            if near:
                best = min(near, key=lambda c: (c['heading_rate'], -c['neighbors'], abs(c['el'] - POSTER_EL0)))
            else:
                best = min(cands, key=lambda c: (abs(c['turn'] - POSTER_TURN), c['heading_rate']))
            self.pull = dict(arc=best['arc'], dpsi=best['dpsi'], q=best['q'])
            top = sorted(cands, key=lambda c: -c['turn'])[:5]
            self.poster_search.update(chosen=best, most_turn=top)
            self.log('[plan] pull-back search: %d tracks, %d end on a robust pose showing all five anchors; chose arc %.0f '
                     'deg, heading turn %.0f deg over its first %.0f %% (peak %.2f deg of heading per deg of arc), poster '
                     'az %.1f el %.1f (%d neighbors pass), pull-back turn %.1f deg (target %.0f; the most on offer %.1f) '
                     '(%.0fs)' % (n_tracks, len(cands), best['arc'], best['dpsi'], 100 * best['q'], best['heading_rate'],
                                  best['az'], best['el'], best['neighbors'], best['turn'], POSTER_TURN, top[0]['turn'],
                                  time.perf_counter() - t0))
        self._pull_track = self.pull_track(self.pull['arc'], self.pull['dpsi'], self.pull.get('q', 1.0))
        az, el = self._pull_track[-1]
        pk.update(az=float((az + 180.0) % 360.0 - 180.0), el=float(el))
        return pk

    # ---- state ----------------------------------------------------------------------------------------------------
    def tabulate(self, du=0.01):
        """the orientation spline and the channel curves sampled every du of u (the re-timing reads these; a step
        between samples interpolates linearly: normalized quaternion lerp, far below a pixel at this spacing)."""
        n = int(math.ceil(self.u_end / du)) + 1
        us = np.linspace(0.0, self.u_end, n)
        q = self.rot(us).as_quat()
        flip = np.concatenate([[1.0], np.sign(np.sum(q[1:] * q[:-1], axis=1))])
        q *= np.cumprod(flip)[:, None]
        uc = us.copy()
        if HANDOVER_EASE:
            # the channel curve's own parameter over the hand-over (orbit end -> first tour key): w = u0 + L (2x^2 - x^3),
            # zero rate at the orbit's end, rate 1 at the key (C1), so the dolly and the slide onto the arm build up
            # over the whole cool chapter instead of taking the turn's share of the screen motion within a few frames
            u0, u1 = self.u_orbit_end, self.tour_u[self.D['TOUR_KEYS'][0]['id']]
            m = (us > u0) & (us < u1)
            x = (us[m] - u0) / (u1 - u0)
            uc[m] = u0 + (u1 - u0) * (2.0 * x * x - x ** 3)
        self.tab = (us, q, self.cr.many(uc), self.lens_fn(us), us[1] - us[0])

    def state(self, u, f):
        u = min(max(float(u), 0.0), self.u_end)
        us, Q, C, LN, du = self.tab
        i = min(int(u / du), len(us) - 2)
        w = (u - us[i]) / du
        q = (1.0 - w) * Q[i] + w * Q[i + 1]
        M = quat_matrix(q / np.linalg.norm(q))
        r, up, f_ = M[:, 0], M[:, 1], -M[:, 2]
        c = (1.0 - w) * C[i] + w * C[i + 1]
        lens = float((1.0 - w) * LN[i] + w * LN[i + 1])
        P = c[:3]
        sx, sy, lnZ, lnF, ev, kd = c[3:]
        W = math.exp(self.lnW_frame(f) + lnZ)
        T = target_of(P, sx, sy, W, r, up)
        return dict(u=u, f=f_, r=r, up=up, P=P, sx=float(sx), sy=float(sy), W=W, lens=lens,
                    fstop=math.exp(lnF), ev=float(ev), kd=float(kd), T=T, M=M)

    def cam(self, st, res=1200):
        return Cam(st['f'], st['r'], st['up'], st['T'], st['W'], st['lens'], res)


# =====================================================================================================================
# re-timing
# =====================================================================================================================
class Motion:
    """screen motion of the crystal between two camera states (p90 px at res over the points inside the frame).
    Growth frames: the surface samples of the generator's sphere sets at the two grid times around t_f (each scaled to
    t_f, their p90s blended by log t, so the measure is continuous in t and the re-timing does not stutter where the
    nearest grid time changes); frozen frames: the close-up mesh's own vertices (`fine`) when given."""

    def __init__(self, plan, clouds, res=1200, n_points=5000, fine=None, gen_meshes=None):
        self.plan, self.res, self.n = plan, res, n_points
        self.ts = np.array(sorted(clouds))
        self.lts = np.log(self.ts)
        self.clouds = {t: np.asarray(p, dtype=np.float64) for t, p in clouds.items()}
        self.fine = fine
        self.gen_meshes = gen_meshes
        self._mesh_lru = {}
        self._sel = None

    def mesh_points(self, f):
        """a fixed subsample (MESH_POINTS_MAX) of growth frame f's cached mesh vertices, loaded once and kept (the
        growth fit marches every growth frame ~15 times; 275 x 40k points is ~260 MB)."""
        pts = self._mesh_lru.get(f)
        if pts is None:
            with np.load(self.gen_meshes[f]) as z:
                co = z['co'].reshape(-1, 3)
            if len(co) > MESH_POINTS_MAX:
                co = co[np.sort(np.random.default_rng(31 + f).choice(len(co), MESH_POINTS_MAX, replace=False))]
            pts = co.astype(np.float64)
            self._mesh_lru[f] = pts
        return pts

    def clouds_for(self, f):
        """[(points, their growth time, weight)] for frame f: the close-up mesh on frozen frames, the frame's own
        cached mesh on growth frames when every growth mesh is cached, else the two grid times around t_f, weighted
        linearly in log t."""
        if self.fine is not None and frozen(self.plan.TL, f):
            return [(self.fine, 1.0, 1.0)]
        if self.gen_meshes is not None and f in self.gen_meshes:
            return [(self.mesh_points(f), t_of(self.plan.TL, f), 1.0)]
        lt = math.log(t_of(self.plan.TL, f))
        i = int(np.searchsorted(self.lts, lt))
        if i <= 0 or i >= len(self.ts):
            tg = float(self.ts[min(max(i, 0), len(self.ts) - 1)])
            return [(self.clouds[tg], tg, 1.0)]
        w = (lt - self.lts[i - 1]) / (self.lts[i] - self.lts[i - 1])
        out = [(self.clouds[float(self.ts[i - 1])], float(self.ts[i - 1]), 1.0 - w),
               (self.clouds[float(self.ts[i])], float(self.ts[i]), w)]
        return [c for c in out if c[2] > 1e-6]

    def cloud_for(self, f):
        """(points, growth time) of the heavier of frame f's clouds (tools that want one cloud)."""
        pts, tg, _w = max(self.clouds_for(f), key=lambda c: c[2])
        return pts, tg

    def margin(self, f):
        """how far under the px cap the re-timing aims on frame f: CAP_MARGIN on mesh vertices and on growth frames
        (the proxy there was measured within 0.94-1.16 of the meshes, at ~6 px of a 12 px cap), CAP_MARGIN_PROXY on a
        frozen frame measured on the sphere proxy (no close-up mesh found)."""
        return CAP_MARGIN if (self.fine is not None or not frozen(self.plan.TL, f)) else CAP_MARGIN_PROXY

    def select(self, st0, f0, margin=0.12):
        """the points of frame f0's clouds inside frame f0 (with a margin), subsampled; cached for the step solve."""
        sel = []
        n = 0
        cam = self.plan.cam(st0, self.res)
        for k, (pts, tg, w) in enumerate(self.clouds_for(f0)):
            s0 = self.plan.extent(t_of(self.plan.TL, f0)) / self.plan.extent(tg)
            xy, ok = cam.project(pts * s0)
            lo, hi = -margin * self.res, (1.0 + margin) * self.res
            m = ok & (xy[:, 0] > lo) & (xy[:, 0] < hi) & (xy[:, 1] > lo) & (xy[:, 1] < hi)
            idx = np.flatnonzero(m)
            if len(idx) > self.n:      # the same subsample every time this frame is measured (march and report agree)
                idx = np.random.default_rng(1000 + int(f0) + 7919 * k).choice(idx, self.n, replace=False)
            sel.append((pts[idx], tg, w))
            n += len(idx)
        self._sel = (sel, f0)
        return n

    def step(self, st0, st1, f0, f1):
        """p90 displacement (px) of the selected points from (st0, frame f0) to (st1, frame f1), blended over the
        frame's clouds; growth scales the crystal by e(t1)/e(t0) in between."""
        sel, _fs = self._sel
        e = self.plan.extent
        TL = self.plan.TL
        c0, c1 = self.plan.cam(st0, self.res), self.plan.cam(st1, self.res)
        R = self.res
        tot, wsum, npts = 0.0, 0.0, 0
        for pts, tg, w in sel:
            if len(pts) == 0:
                continue
            a, oka = c0.project(pts * (e(t_of(TL, f0)) / e(tg)))
            b, okb = c1.project(pts * (e(t_of(TL, f1)) / e(tg)))
            ina = oka & (a[:, 0] >= 0) & (a[:, 0] <= R) & (a[:, 1] >= 0) & (a[:, 1] <= R)
            inb = okb & (b[:, 0] >= 0) & (b[:, 0] <= R) & (b[:, 1] >= 0) & (b[:, 1] <= R)
            m = (ina | inb) & oka & okb
            if m.sum() < 20:
                continue
            d = np.hypot(*(b[m] - a[m]).T)
            tot += w * float(np.percentile(d, 90))
            wsum += w
            npts += int(m.sum())
        if wsum <= 0.0:
            return 0.0, npts
        return tot / wsum, npts

    def median_flow(self, st0, st1, f0, f1):
        """the median screen displacement vector (px, x right, y down) of the selected points of the frame's heavier
        cloud: the direction the picture flows in (the report's flow check)."""
        sel, _fs = self._sel
        pts, tg, _w = max(sel, key=lambda c: c[2])
        if len(pts) < 20:
            return np.zeros(2)
        e = self.plan.extent
        TL = self.plan.TL
        a, oka = self.plan.cam(st0, self.res).project(pts * (e(t_of(TL, f0)) / e(tg)))
        b, okb = self.plan.cam(st1, self.res).project(pts * (e(t_of(TL, f1)) / e(tg)))
        m = oka & okb
        return np.median(b[m] - a[m], axis=0) if m.sum() >= 20 else np.zeros(2)


def rot_step(st0, st1):
    """(view-direction turn, twist about the view axis, total rotation), deg, between two states."""
    dd = math.degrees(math.acos(max(-1.0, min(1.0, float(st0['f'] @ st1['f'])))))
    rel = rotvec_of(st0['M'].T @ st1['M'])                              # in the first camera's own axes
    tw = math.degrees(abs(float(rel[2])))                               # camera z = -forward: the optical axis
    return dd, tw, math.degrees(float(np.linalg.norm(rel)))


class Retimer:
    """frames -> u. mode 'px' (default): a segment's speed profile is a p90 screen speed; mode 'turn': it is a turn
    rate in deg/frame (the cool hand-over, where the dolly and the pan share the screen motion with the turn), the
    caps holding either way."""

    def __init__(self, plan, motion):
        self.plan, self.motion = plan, motion
        self.cache = {}
        self.mode = 'px'
        self.px_ceiling = None        # mode 'turn': px_ceiling(f) caps the screen speed as well (the hand-over's ease)

    def st(self, u, f):
        k = (round(u, 9), f)
        s = self.cache.get(k)
        if s is None:
            s = self.plan.state(u, f)
            if len(self.cache) > 20000:
                self.cache.clear()
            self.cache[k] = s
        return s

    def load(self, u0, f0, du, f1, v):
        """how far over budget a step of du is (1 = exactly at the tightest of: target speed v (px, or deg in mode
        'turn'), the px cap, the ln-width cap, the twist cap, the direction-turn cap)."""
        st0, st1 = self.st(u0, f0), self.st(u0 + du, f1)
        px, _n = self.motion.step(st0, st1, f0, f1)
        dd, tw, _tot = rot_step(st0, st1)
        dl = abs(math.log(st1['W'] / st0['W']))
        mg = self.motion.margin(f1)
        target = (dd if self.mode == 'turn' else px) / max(v, 1e-6)
        if self.mode == 'turn' and self.px_ceiling is not None:
            target = max(target, px / max(self.px_ceiling(f1), 1e-6))
        return max(target, px / (CAP_PX * mg), dl / (CAP_DLNW * mg), tw / (CAP_ROLL * mg), dd / OMEGA_MAX)

    def solve_step(self, u0, f0, f1, v, sign, du_guess):
        """the step du (sign = +1 forward, -1 backward in u) with load 1, or the largest du under 1."""
        u_lim = self.plan.u_end if sign > 0 else 0.0
        room = abs(u_lim - u0)
        if room <= 1e-9:
            return 0.0
        lo, hi = 0.0, min(max(du_guess, 1e-4), room)
        g_hi = self.load(u0, f0, sign * hi, f1, v)
        for _ in range(40):
            if g_hi >= 1.0 or hi >= room:
                break
            lo = hi
            hi = min(hi * 2.0, room)
            g_hi = self.load(u0, f0, sign * hi, f1, v)
        if g_hi < 1.0:
            return sign * hi
        g_lo = self.load(u0, f0, sign * lo, f1, v) if lo > 0 else self.load(u0, f0, 0.0, f1, v)
        if g_lo >= 1.0:          # already over budget at du = lo (growth alone moves the picture this much)
            return sign * lo
        for _ in range(18):      # regula falsi / bisection on the (nearly linear) load
            mid = lo + (hi - lo) * min(max((1.0 - g_lo) / max(g_hi - g_lo, 1e-9), 0.1), 0.9)
            g = self.load(u0, f0, sign * mid, f1, v)
            if abs(g - 1.0) < 0.004:
                return sign * mid
            if g < 1.0:
                lo, g_lo = mid, g
            else:
                hi, g_hi = mid, g
            if hi - lo < 1e-7:
                break
        return sign * lo

    def turn_of(self, u0, f0, du, f1):
        return rot_step(self.st(u0, f0), self.st(u0 + du, f1))[0]

    def hard_load(self, u0, f0, du, f1):
        """the step's load against the caps alone (no target speed)."""
        st0, st1 = self.st(u0, f0), self.st(u0 + du, f1)
        px, _n = self.motion.step(st0, st1, f0, f1)
        dd, tw, _tot = rot_step(st0, st1)
        dl = abs(math.log(st1['W'] / st0['W']))
        mg = self.motion.margin(f1)
        return max(px / (CAP_PX * mg), dl / (CAP_DLNW * mg), tw / (CAP_ROLL * mg), dd / OMEGA_MAX)

    def slew(self, u, f0, f1, step, dd_prev, sign):
        """the step with its turn kept within SLEW of the previous step's (dd_prev), while that is above SLEW_FLOOR:
        a faster turn is cut back; a slower one is raised toward (1 - SLEW) dd_prev as far as the caps allow. u is the
        view direction's arc length, so the turn is ~|du| and two secant corrections land it."""
        if dd_prev is None or dd_prev < SLEW_FLOOR or abs(step) < 1e-9:
            return step
        dd = self.turn_of(u, f0, step, f1)
        if dd < 1e-9:
            return step
        if dd > (1.0 + SLEW) * dd_prev:
            want = (1.0 + SLEW) * dd_prev
            s = step
            for _ in range(2):
                s = s * want / max(self.turn_of(u, f0, s, f1), 1e-9)
            return s
        if dd < (1.0 - SLEW) * dd_prev:
            want = (1.0 - SLEW) * dd_prev
            room = (self.plan.u_end - u) if sign > 0 else u
            s = step
            for _ in range(2):
                s = min(abs(s * want / max(self.turn_of(u, f0, s, f1), 1e-9)), room) * sign
            if self.hard_load(u, f0, s, f1) <= 1.0:
                return s
            lo, hi = step, s                                  # the caps allow step, not s: the largest in between
            for _ in range(14):
                mid = 0.5 * (lo + hi)
                if self.hard_load(u, f0, mid, f1) <= 1.0:
                    lo = mid
                else:
                    hi = mid
            return lo
        return step

    def march(self, u_start, f_a, f_b, speed_fn, direction=+1, dd_prev=None):
        """u at frames f_a..f_b (direction +1) or f_a down to f_b (direction -1), starting from u_start; each step
        also slew-limited against the previous step's turn (dd_prev: the turn of the step before f_a, if known)."""
        us = [u_start]
        u = u_start
        du = 0.5
        fr = range(f_a + 1, f_b + 1) if direction > 0 else range(f_a - 1, f_b - 1, -1)
        prev = f_a
        for f in fr:
            st0 = self.st(u, prev)
            self.motion.select(st0, prev)
            step = self.solve_step(u, prev, f, speed_fn(f), direction, abs(du) * 1.3 + 1e-4)
            step = self.slew(u, prev, f, step, dd_prev, direction)
            dd_prev = self.turn_of(u, prev, step, f) if abs(step) > 1e-12 else dd_prev
            u += step
            du = step if abs(step) > 1e-6 else du
            us.append(u)
            prev = f
        return np.array(us)

    def frames_at_cap(self, u_a, u_b, f_a, limit=3000):
        """frames the path u_a -> u_b needs at a constant CAP_PX (x margin) with every other cap in force, on the
        crystal of frame f_a (a frozen segment): the floor under any profile's frame count."""
        u, n, du = u_a, 0, 0.5
        v = CAP_PX * self.motion.margin(f_a)
        while u < u_b - 1e-9 and n < limit:
            self.motion.select(self.st(u, f_a), f_a)
            step = self.solve_step(u, f_a, f_a, v, +1, du * 1.3 + 1e-4)
            if step <= 1e-9:
                break
            du = step
            u += step
            n += 1
        return n if u >= u_b - 1e-9 else None

    def fit_segment(self, u_a, u_b, f_a, f_b, profile, K_lo, K_hi, label, dd_prev=None):
        """amplitude K of profile(f, K) so the march from (f_a, u_a) lands on u_b at f_b; returns (us, K, ok)."""
        def reach(K):
            us = self.march(u_a, f_a, f_b, lambda f: profile(f, K), dd_prev=dd_prev)
            return us

        def miss(us):
            """landing error at f_b; arriving early counts as overshoot (the march stalls at the end of the path, so
            without this every amplitude above the right one would also 'land')."""
            early = int(np.sum(us[:-1] >= u_b - 1e-6))
            return us[-1] - u_b + early * max(0.05 * abs(u_b - u_a), 1e-2)
        us_hi = reach(K_hi)
        if us_hi[-1] < u_b - 1e-6:
            self.plan.log('[plan] %s: even at the caps the path gets to u=%.2f of %.2f in %d frames' % (
                label, us_hi[-1], u_b, f_b - f_a))
            return us_hi, K_hi, False
        us_lo = reach(K_lo)
        if us_lo[-1] > u_b + 1e-6:
            self.plan.log('[plan] %s: too many frames: at the slowest profile the path overshoots (u=%.2f > %.2f)' % (
                label, us_lo[-1], u_b))
            return us_lo, K_lo, False
        a, b = K_lo, K_hi
        ya, yb = miss(us_lo), miss(us_hi)
        us = us_hi
        K = K_hi
        side = 0
        tol = 2e-3 * max(1.0, abs(u_b - u_a))
        for it in range(40):            # Illinois regula falsi (the retained end's value is halved when it sticks)
            K = b - yb * (b - a) / (yb - ya) if abs(yb - ya) > 1e-12 else 0.5 * (a + b)
            if not (min(a, b) < K < max(a, b)):
                K = 0.5 * (a + b)
            us = reach(K)
            y = miss(us)
            if abs(y) < tol:
                break
            if y < 0:
                a, ya = K, y
                if side == -1:
                    yb *= 0.5
                side = -1
            else:
                b, yb = K, y
                if side == 1:
                    ya *= 0.5
                side = 1
            if abs(b - a) < 1e-6:
                break
        # land exactly: spread the residual over the segment in proportion to the steps
        res = u_b - us[-1]
        steps = np.diff(us)
        tot = steps.sum()
        if abs(tot) > 1e-12:
            us = np.concatenate([[us[0]], us[0] + np.cumsum(steps * (1.0 + res / tot))])
        return us, K, True


def bump(x, ramp=None):
    """0 at both ends of a segment, 1 in the middle: sin^2 ramps over the first and last `ramp` of it (C1) and a
    plateau between (ramp 0.5 = one sin^2 bump)."""
    r = GLIDE_RAMP if ramp is None else ramp
    x = min(max(x, 0.0), 1.0)
    e = min(x, 1.0 - x)
    return 1.0 if e >= r else math.sin(0.5 * math.pi * e / r) ** 2


def xm(f, fa, fb):
    """segment position of the step that lands on frame f, taken at the step's midpoint (so the last step of the
    pull-back is small but never zero)."""
    return (f - 0.5 - fa) / float(fb - fa)


def retime(plan, motion, log=print):
    """u(f) for every frame, segment by segment. Returns (u array, per-segment info)."""
    TL = plan.TL
    N, G = plan.N, plan.G
    feats = TL['features']
    R = Retimer(plan, motion)
    u = np.full(N, np.nan)
    info = []
    u[0] = 0.0
    h = HOLD_SPEED
    # 1. growth orbit: constant target speed S (solved), u 0 -> orbit end at the last growth frame
    t0 = time.perf_counter()
    us, S, ok = R.fit_segment(0.0, plan.u_orbit_end, 0, G, lambda f, K: K, 1.0, 3.0 * CAP_PX, 'growth orbit')
    u[0:G + 1] = us
    info.append(dict(segment='growth orbit', frames=[0, G], u=[0.0, plan.u_orbit_end], amplitude=round(S, 3), ok=ok,
                     seconds=round(time.perf_counter() - t0, 1)))
    log('[plan] growth orbit: %d frames, steady %.2f px/frame (%.1fs)' % (G, S, time.perf_counter() - t0))
    # 2. holds: march out from each key at the hold speed
    holds = []
    for fe in feats:
        h0, h1 = fe['hold']
        c = (h0 + h1) // 2
        uc = plan.tour_u[fe['id']]
        fwd = R.march(uc, c, h1, lambda f: h, +1)
        bwd = R.march(uc, c, h0, lambda f: h, -1)
        u[c:h1 + 1] = fwd
        u[h0:c + 1] = bwd[::-1]
        holds.append((fe['id'], h0, c, h1))
        info.append(dict(segment='hold ' + fe['id'], frames=[h0, h1], u=[float(u[h0]), float(u[h1])], center=c,
                         amplitude=h, ok=bool(u[h0] <= uc <= u[h1])))
    def turn_into(f):
        """the turn of the step landing on frame f (both frames already placed), the slew limit's start."""
        return R.turn_of(u[f - 1], f - 1, u[f] - u[f - 1], f)
    # 3. cool: orbit end -> first hold. A TURN-rate profile (mode 'turn'): from the orbit's last turn rate down to the
    # hold's first (smootherstep) plus a solved bump, the screen motion capped; a screen-speed profile here let the
    # dolly and the pan take the pixel budget from the turn mid-chapter (a sag to 0.35 deg/frame, then a rise)
    fa, fb = G, holds[0][1]
    wG = turn_into(fa)
    wH = R.turn_of(u[fb], fb, u[fb + 1] - u[fb], fb + 1)
    prof = lambda f, K: wH + (wG - wH) * (1.0 - smootherstep(xm(f, fa, fb))) + K * bump(xm(f, fa, fb))
    # ... and the screen speed may rise from the growth's steady S to the cap only over the first HANDOVER_PX_RAMP of
    # the hand-over (the dolly and the pan start there; without it the picture's speed doubled within ~4 frames)
    top = CAP_PX * CAP_MARGIN
    R.mode = 'turn'
    R.px_ceiling = lambda f: S + (top - S) * smootherstep(xm(f, fa, fb) / HANDOVER_PX_RAMP)
    try:
        us, K, ok = R.fit_segment(u[fa], u[fb], fa, fb, prof, -0.9 * min(wG, wH), 3.0, 'cool hand-over', dd_prev=wG)
    finally:
        R.mode = 'px'
        R.px_ceiling = None
    need = R.frames_at_cap(u[fa], u[fb], fb)
    u[fa:fb + 1] = us
    info.append(dict(segment='hand-over to the lathe', frames=[fa, fb], u=[float(u[fa]), float(u[fb])],
                     amplitude=round(K, 3), mode='turn deg/frame %.3f -> %.3f' % (wG, wH), ok=ok, frames_at_cap=need))
    # 4. glides between holds
    for (ia, _a0, _ac, a1), (ib, b0, _bc, _b1) in zip(holds[:-1], holds[1:]):
        fa, fb = a1, b0
        prof = (lambda fa_, fb_: (lambda f, K: h + K * bump(xm(f, fa_, fb_))))(fa, fb)
        us, K, ok = R.fit_segment(u[fa], u[fb], fa, fb, prof, -0.9 * h, 3.0 * CAP_PX, 'glide %s -> %s' % (ia, ib),
                                  dd_prev=turn_into(fa))
        need = R.frames_at_cap(u[fa], u[fb], fb)
        u[fa:fb + 1] = us
        info.append(dict(segment='glide %s -> %s' % (ia, ib), frames=[fa, fb], u=[float(u[fa]), float(u[fb])],
                         amplitude=round(K, 3), peak=round(h + K, 2), ok=ok, frames_at_cap=need))
    # 5. pull-back: last hold -> the poster pose, easing to a stop on the last frame
    fa, fb = holds[-1][3], N - 1
    prof = lambda f, K: h * (1 - smoothstep(xm(f, fa, fb))) + K * bump(xm(f, fa, fb))
    us, K, ok = R.fit_segment(u[fa], plan.u_end, fa, fb, prof, -0.9 * h, 3.0 * CAP_PX, 'pull-back',
                              dd_prev=turn_into(fa))
    need = R.frames_at_cap(u[fa], plan.u_end, fb)
    u[fa:fb + 1] = us
    info.append(dict(segment='pull-back', frames=[fa, fb], u=[float(u[fa]), plan.u_end], amplitude=round(K, 3), ok=ok,
                     frames_at_cap=need))
    if np.isnan(u).any():
        raise RuntimeError('frames without a path position: %s' % np.flatnonzero(np.isnan(u))[:20])
    return u, info


def propose_timeline(plan, motion, TL, hold_frames=17, slack=2, log=print):
    """size the post-growth chapters from measured costs: every key-to-key leg's frames at a flat cap speed, divided
    by what the speed profiles make of them (holds at HOLD_SPEED cover part of each leg; a glide averages
    HOLD_SPEED + (peak - HOLD_SPEED)(1 - GLIDE_RAMP)). The growth chapters are kept. Returns a timeline dict."""
    R = Retimer(plan, motion)
    G = plan.G
    f1 = G + 1
    peak = CAP_PX * CAP_MARGIN
    ids = [k['id'] for k in plan.D['TOUR_KEYS']]
    us = [plan.u_orbit_end] + [plan.tour_u[i] for i in ids] + [plan.u_end]
    legs = [R.frames_at_cap(a, b, f1) for a, b in zip(us[:-1], us[1:])]
    log('[plan] legs at a flat cap speed (frames): ' + ', '.join('%s %s' % (n, v) for n, v in zip(
        ['hand-over'] + ['%s->%s' % (a, b) for a, b in zip(ids[:-1], ids[1:])] + ['pull-back'], legs)))
    half_hold = 0.5 * hold_frames * HOLD_SPEED / peak              # cap-frames a half hold covers
    eff_glide = (HOLD_SPEED + (peak - HOLD_SPEED) * (1.0 - GLIDE_RAMP)) / peak
    hand = int(math.ceil((legs[0] - half_hold) / eff_glide)) + slack
    glides = [int(math.ceil((n - 2 * half_hold) / eff_glide)) + slack for n in legs[1:-1]]
    eff_pull = 0.5 * HOLD_SPEED / peak + (1.0 - GLIDE_RAMP) - 0.05     # from the hold speed, plateau, brake to 0
    pull = int(math.ceil((legs[-1] - half_hold) / eff_pull)) + slack
    feats, f = [], G + hand
    kinds = {fe['id']: fe for fe in TL['features']}
    holds = []
    for k, fid in enumerate(ids):
        h0 = f
        h1 = h0 + hold_frames - 1
        holds.append((h0, h1))
        f = h1 + (glides[k] if k < len(glides) else 0)
    N = holds[-1][1] + pull + 1
    # windows: the hold and WINDOW_PAD frames either side (the first: 8 frames of lead-in), never into the neighbor's;
    # between windows the camera glides and no callout shows
    wins = []
    for k, (h0, h1) in enumerate(holds):
        a = h0 - 8 if k == 0 else max(h0 - WINDOW_PAD, holds[k - 1][1] + 1)
        b = h1 + WINDOW_PAD if k + 1 == len(holds) else min(h1 + WINDOW_PAD, holds[k + 1][0] - WINDOW_PAD - 1)
        wins.append((a, b))
    for k, fid in enumerate(ids):
        fe = kinds.get(fid, dict(id=fid, kind='point', label='right'))
        feats.append(dict(id=fid, kind=fe['kind'], **{'from': wins[k][0], 'to': wins[k][1]},
                          hold=[holds[k][0], holds[k][1]], label=fe.get('label', 'right')))
    chapters = [dict(c) for c in TL['chapters'] if c['to'] <= G]
    chapters.append({'id': 'cool', 'from': G + 1, 'to': wins[0][0] - 1})
    chapters.append({'id': 'tour', 'from': wins[0][0], 'to': wins[-1][1]})
    chapters.append({'id': 'pullback', 'from': wins[-1][1] + 1, 'to': N - 1})
    out = {k: v for k, v in TL.items() if not k.startswith('_')}
    out.update(frames=N, chapters=chapters, features=feats, poster=N - 1,
               warmth={'from': G + 1, 'to': wins[0][0] - 1, 'law': 'cosine'},
               budget_bytes={'1200': V3_BUDGET_PER_FRAME[1200] * N, '600': V3_BUDGET_PER_FRAME[600] * N,
                             'poster': 400 * 1024})
    return out, legs


# =====================================================================================================================
# report
# =====================================================================================================================
def measure(plan, motion, u, log=print):
    """per-frame states and metrics along the final u(f)."""
    TL = plan.TL
    N = plan.N
    recs = []
    sts = [plan.state(u[f], f) for f in range(N)]
    orbit = 0.0
    for f in range(N):
        st = sts[f]
        az, el = angles_of(-st['f'])
        rec = dict(f=f, chapter=chapter_of(TL, f), u=round(float(u[f]), 5), t=round(t_of(TL, f), 5),
                   warmth=round(warmth_of(TL, f), 5), scale=1.0, mesh='fine' if frozen(TL, f) else 'generator',
                   forward=[round(float(x), 7) for x in st['f']], right=[round(float(x), 7) for x in st['r']],
                   up=[round(float(x), 7) for x in st['up']], target=[round(float(x), 6) for x in st['T']],
                   P=[round(float(x), 6) for x in st['P']], sx=round(st['sx'], 5), sy=round(st['sy'], 5),
                   width=round(st['W'], 6), lens=round(st['lens'], 4), fstop=round(st['fstop'], 4),
                   ev=round(st['ev'], 4), kd=round(st['kd'], 4), az=round(az, 4), el=round(el, 4),
                   roll=round(dutch_roll(st['f'], st['r'], st['up']), 4))
        if f > 0:
            motion.select(sts[f - 1], f - 1)
            px, npts = motion.step(sts[f - 1], st, f - 1, f)
            mf = motion.median_flow(sts[f - 1], st, f - 1, f)
            dd, tw, tot = rot_step(sts[f - 1], st)
            orbit += dd
            rec.update(px=round(px, 3), points=npts, turn=round(dd, 4), twist=round(tw, 4), rot=round(tot, 4),
                       dlnw=round(math.log(st['W'] / sts[f - 1]['W']), 5), du=round(float(u[f] - u[f - 1]), 5),
                       flow=[round(float(mf[0]), 3), round(float(mf[1]), 3)])
        else:
            rec.update(px=None, points=0, turn=0.0, twist=0.0, rot=0.0, dlnw=0.0, du=0.0, flow=[0.0, 0.0])
        rec['orbit_deg'] = round(orbit, 3)
        recs.append(rec)
    return recs, sts


def key_light_coeff():
    """the Key lamp's camera-space direction in look.py (toward camera, right, up) as camera-local (x right, y up,
    z toward the camera)."""
    import look
    for name, _k, _d, _w, _s, _z, coeff in look.LIGHTS:
        if name == 'Key':
            a, b, c = coeff
            return unit([b, c, a])
    raise KeyError('Key')


def key_trail(recs, frac=None, anchor=None, TL=None):
    """the key light's trailing orientation for every frame: R_trail(f) = R_trail(f-1) (R(f-1)^-1 R(f))^frac, i.e.
    the key turns `frac` of the camera's own rotation each frame, anchored equal to the camera at frame `anchor` and
    integrated forward and back from it. Writes rec['key_basis'] (3 x 3, columns = the key frame's right, up,
    -forward, as frame_matrix) and rec['key_offset_deg'] (how far the key has swung from its designed place on the
    camera). Returns a summary."""
    from scipy.spatial.transform import Rotation
    frac = KEY_TRAIL if frac is None else frac
    anchor = KEY_TRAIL_ANCHOR if anchor is None else anchor
    N = len(recs)
    Rc = Rotation.from_matrix(np.array([frame_matrix(np.asarray(r['forward']), np.asarray(r['right']),
                                                     np.asarray(r['up'])) for r in recs]))
    Dk = Rotation.from_rotvec(frac * (Rc[:-1].inv() * Rc[1:]).as_rotvec())
    v = key_light_coeff()
    checks = []
    if TL is not None:
        for fe in TL['features']:
            checks += list(range(fe['hold'][0], fe['hold'][1] + 1))
        checks.append(int(TL['poster']))

    def run(a):
        T = [None] * N
        T[a] = Rc[a]
        for f in range(a + 1, N):
            T[f] = T[f - 1] * Dk[f - 1]
        for f in range(a, 0, -1):
            T[f - 1] = T[f] * Dk[f - 1].inv()
        Tq = Rotation.from_quat(np.array([x.as_quat() for x in T]))
        off = np.degrees(np.arccos(np.clip(np.sum(Rc.apply(v) * Tq.apply(v), axis=1), -1.0, 1.0)))
        return Tq, off
    if anchor == 'auto':
        cands = sorted({(fe['hold'][0] + fe['hold'][1]) // 2 for fe in TL['features']} | {int(TL['poster'])}) \
            if TL is not None else [N - 1]
        best = None
        for a in cands:
            Tq, off = run(a)
            worst = float(off[checks].max()) if checks else 0.0
            if best is None or worst < best[0]:
                best = (worst, a, Tq, off)
        _w, anchor, Tq, off = best
    else:
        Tq, off = run(int(anchor))
    M = Tq.as_matrix()
    for f, rec in enumerate(recs):
        rec['key_basis'] = [[round(float(x), 7) for x in row] for row in M[f]]
        rec['key_offset_deg'] = round(float(off[f]), 2)
    per = {}
    if TL is not None:
        for cid, a, b in chapter_list(TL):
            per[cid] = [round(float(off[a:b + 1].min()), 1), round(float(off[a:b + 1].max()), 1)]
    return dict(frac=frac, anchor=int(anchor), offset_max=round(float(off.max()), 1),
                offset_at_holds_max=round(float(off[checks].max()), 1) if checks else None,
                offset_at_poster=round(float(off[int(TL['poster'])]), 1) if TL is not None else None,
                offset_by_chapter=per)


class SphereOcclusion:
    """approximate occlusion on the generator's t = 1 sphere set (the mesh is their union, closed by the fillet): a
    feature point is hidden when the ray from the camera enters any sphere earlier than the point's own surface
    distance allows (render_sequence.anchor_rows' rule, 1.6 x surface distance + 0.012, on the sphere union's depth).
    The closing's fillets are not in the sphere set, so this can miss an occluder the mesh has; the Blender anchor pass
    is the one that counts."""

    def __init__(self, sp):
        self.C = np.asarray(sp['pos'], dtype=np.float64)
        self.r = np.asarray(sp['rad'], dtype=np.float64)

    def depth(self, p):
        return float(np.max(self.r - np.linalg.norm(self.C - p, axis=1)))

    def hidden(self, cam_loc, p, tol):
        d = p - cam_loc
        dist = float(np.linalg.norm(d))
        d /= dist
        rel = self.C - cam_loc
        s = rel @ d
        m = (s > 0.0) & (s < dist + 0.1)
        if not m.any():
            return False
        s = s[m]
        perp2 = np.einsum('ij,ij->i', rel[m], rel[m]) - s * s
        r2 = self.r[m] ** 2
        hit = perp2 < r2
        if not hit.any():
            return False
        entry = s[hit] - np.sqrt(r2[hit] - perp2[hit])
        return bool(entry.min() < dist - tol)


def feature_tolerances(F, occ):
    """per feature point, how much crystal may lie in front of it before it counts as hidden: the mesh's own values
    from features.json (render_sequence.py: 1.6 x the point's distance to the rendered surface + 0.012), else the sphere
    union's depth (a lobed trunk makes that smaller than the mesh's: conservative)."""
    if F.get('tolerances'):
        return {k: [float(x) for x in v] for k, v in F['tolerances'].items()}
    if occ is None:
        return {k: [0.012] * len(v) for k, v in F['points'].items()}
    return {k: [1.6 * max(occ.depth(np.asarray(p, dtype=np.float64)), 0.0) + 0.012 for p in v]
            for k, v in F['points'].items()}


def anchor_table(plan, recs, sts, occ=None):
    """analytic anchors: every feature point projected on every frame; visible needs it inside the frame clear of the
    page's edge fade and, with `occ` (SphereOcclusion), not hidden on frozen frames (earlier frames carry 0, as the
    Blender pass writes them). render_sequence.py --anchors-only is the real test (projection + ray casts on the mesh)."""
    F = plan.F
    out = {}
    tol = plan.tol
    for fe in plan.TL['features']:
        pts = np.asarray(F['points'][fe['id']], dtype=np.float64)
        rows = []
        for f, st in enumerate(sts):
            cam = plan.cam(st, 1)
            xy, ok = cam.project(pts)
            vis = bool(ok.all() and (xy >= EDGE_FADE).all() and (xy <= 1.0 - EDGE_FADE).all())
            if vis and occ is not None:
                if not frozen(plan.TL, f):
                    vis = False
                else:
                    vis = not any(occ.hidden(cam.loc, p, tol[fe['id']][k]) for k, p in enumerate(pts))
            rows.append([round(float(v), 5) for v in xy.ravel()] + [int(vis)])
        out[fe['id']] = rows
    return out


def tip_speeds(plan, sts):
    """the tips on screen, px/frame at 1200, per growth frame: (size, growth). size = how fast the crystal's size on
    screen grows: the change from frame f-1 to f of the RMS distance of the six primary tips (at t_f, each frame's own
    camera) from the frame's center, the growth and the dolly together (the six tips are an octahedron, whose RMS
    projected radius does not depend on the view direction, so the orbit drops out; this is the outward speed of the
    tips a viewer sees, which the dolly law sets); growth = the median displacement of a tip between t(f-1) and t(f)
    seen by frame f's camera (growth alone, which falls as dt / t falls unless the camera stops receding)."""
    tips = np.asarray(plan.F['tips'], dtype=np.float64)
    size = np.full(plan.G + 1, np.nan)
    grow = np.full(plan.G + 1, np.nan)
    prev = None
    for f in range(0, plan.G + 1):
        cam = plan.cam(sts[f], 1200)
        b, okb = cam.project(tips * t_of(plan.TL, f))
        rad = float(np.sqrt(np.mean(np.sum((b[okb] - 600.0) ** 2, axis=1)))) if okb.any() else np.nan
        if prev is not None:
            size[f] = rad - prev
            a, oka = cam.project(tips * t_of(plan.TL, f - 1))
            m = oka & okb & (b[:, 0] >= 0) & (b[:, 0] <= 1200) & (b[:, 1] >= 0) & (b[:, 1] <= 1200)
            if m.any():
                grow[f] = float(np.median(np.hypot(*(b[m] - a[m]).T)))
        prev = rad
    return size, grow


def report(plan, recs, sts, info, anchors, u, trail=None, fine_src=None):
    TL = plan.TL
    N = plan.N
    px = np.array([r['px'] for r in recs[1:]], dtype=np.float64)
    dl = np.array([abs(r['dlnw']) for r in recs[1:]])
    tw = np.array([r['twist'] for r in recs[1:]])
    dd = np.array([r['turn'] for r in recs[1:]])
    rot = np.array([r['rot'] for r in recs[1:]])
    rolls = np.array([r['roll'] for r in recs])
    droll = np.abs((np.diff(rolls) + 180.0) % 360.0 - 180.0)
    du = np.array([r['du'] for r in recs[1:]])
    chap = {}
    for cid, a, b in chapter_list(TL):
        sl = slice(max(a, 1) - 1, b)          # steps landing on frames a..b
        tgt = STORYBOARD_TURN.get(cid)
        chap[cid] = dict(frames=[a, b], turn_deg=round(float(dd[sl].sum()), 2), rotation_deg=round(float(rot[sl].sum()), 2),
                         turn_target_deg=tgt, turn_vs_target=round(float(dd[sl].sum()) / tgt, 3) if tgt else None,
                         twist_deg=round(float(tw[sl].sum()), 2), px_median=round(float(np.median(px[sl])), 2),
                         px_max=round(float(px[sl].max()), 2), px_min=round(float(px[sl].min()), 2),
                         deg_per_frame_mean=round(float(dd[sl].mean()), 3), deg_per_frame_min=round(float(dd[sl].min()), 3),
                         deg_per_frame_max=round(float(dd[sl].max()), 3),
                         dlnw_max=round(float(dl[sl].max()), 4), twist_max=round(float(tw[sl].max()), 3))
    holds = {}
    for fe in TL['features']:
        h0, h1 = fe['hold']
        sl = slice(h0, h1)                    # steps landing on frames h0+1..h1 (inside the hold)
        a, b = fe['from'], fe['to']
        rows = anchors[fe['id']][a:b + 1]
        hold_rows = anchors[fe['id']][h0:h1 + 1]
        xs = [np.mean(r[0:-1:2]) for r in hold_rows]
        ys = [np.mean(r[1:-1:2]) for r in hold_rows]
        holds[fe['id']] = dict(window=[a, b], hold=[h0, h1], hold_frames=h1 - h0 + 1,
                               hold_px_min=round(float(px[sl].min()), 3), hold_px_max=round(float(px[sl].max()), 3),
                               visible_in_window='%d/%d' % (sum(r[-1] for r in rows), len(rows)),
                               visible_in_hold='%d/%d' % (sum(r[-1] for r in hold_rows), len(hold_rows)),
                               anchor_x_in_hold=[round(float(min(xs)), 3), round(float(max(xs)), 3)],
                               anchor_y_in_hold=[round(float(min(ys)), 3), round(float(max(ys)), 3)],
                               label=fe.get('label'),
                               label_side_ok=bool((fe.get('label') == 'right' and max(xs) < 0.62)
                                                  or (fe.get('label') == 'left' and min(xs) > 0.38)
                                                  or fe.get('label') not in ('left', 'right')))
    pf = TL['poster']
    poster_in = {k: anchors[k][pf][-1] for k in anchors}
    med = float(np.median(px))
    zero_steps = [int(k + 1) for k in np.flatnonzero(du[:-1] <= 1e-9)]       # a zero step before the final frame
    # the turn rate's frame-to-frame change (frame f's turn vs frame f-1's), where either is above the floor
    jumps = []
    for k in range(1, len(dd)):
        hi = max(dd[k], dd[k - 1])
        if hi >= TURN_JUMP_FLOOR and abs(dd[k] - dd[k - 1]) > TURN_JUMP * hi:
            jumps.append([k + 1, round(float(dd[k - 1]), 3), round(float(dd[k]), 3)])
    rel = [abs(dd[k] - dd[k - 1]) / max(dd[k], dd[k - 1]) for k in range(1, len(dd))
           if max(dd[k], dd[k - 1]) >= TURN_JUMP_FLOOR]
    # the picture's flow (median screen displacement): no jump of more than FLOW_JUMP_MAX px from one frame to the next
    # (a camera heading that reverses within a frame or two: a bounce)
    fl = np.array([r['flow'] for r in recs[1:]], dtype=np.float64)
    fj = np.linalg.norm(np.diff(fl, axis=0), axis=1)
    flow_bad = [[int(k + 2), round(float(fj[k]), 2)] for k in np.flatnonzero(fj > FLOW_JUMP_MAX)]
    flow_max = (float(fj.max()), int(np.argmax(fj)) + 2) if len(fj) else (0.0, None)
    # the look-at along the +x arm: from the tip key on, never back toward the tip
    order = [k['id'] for k in plan.D['TOUR_KEYS']]
    xs_key = [(k['id'], float(np.asarray(k['P'] if k.get('P') is not None else feature_P(plan.F, k['id']))[0]))
              for k in plan.D['TOUR_KEYS']] + [('poster', float(plan.poster['P'][0]))]
    i_tip = order.index('tip') if 'tip' in order else 0
    tail = xs_key[i_tip:]
    monotone = all(b[1] <= a[1] + 5e-3 for a, b in zip(tail[:-1], tail[1:]))
    # the crystal's size on screen (the dolly law): even from the end of the seed law's hand-over to the last growth frame
    ts, tg = tip_speeds(plan, sts)
    f_even = min(plan.F_S + SPAN_BLEND, plan.G)
    seg = ts[f_even:plan.G + 1]
    seg = seg[np.isfinite(seg)]
    tipspeed = dict(frames=[f_even, plan.G], median=round(float(np.median(seg)), 3), min=round(float(seg.min()), 3),
                    max=round(float(seg.max()), 3), max_over_min=round(float(seg.max() / seg.min()), 3),
                    seed_start=round(float(np.nanmedian(ts[1:6])), 3),
                    by_chapter={cid: round(float(np.nanmedian(ts[max(a, 1):min(b, plan.G) + 1])), 3)
                                for cid, a, b in chapter_list(TL) if a <= plan.G},
                    growth_only_by_chapter={cid: round(float(np.nanmedian(tg[max(a, 1):min(b, plan.G) + 1])), 3)
                                            for cid, a, b in chapter_list(TL) if a <= plan.G},
                    per_frame=[None if not np.isfinite(x) else round(float(x), 3) for x in ts],
                    growth_only_per_frame=[None if not np.isfinite(x) else round(float(x), 3) for x in tg])
    cap = dict(
        px_max=round(float(px.max()), 3), px_max_frame=int(np.argmax(px)) + 1, px_cap=CAP_PX,
        dlnw_max=round(float(dl.max()), 5), dlnw_max_frame=int(np.argmax(dl)) + 1, dlnw_cap=CAP_DLNW,
        roll_max=round(float(tw.max()), 4), roll_max_frame=int(np.argmax(tw)) + 1, roll_cap=CAP_ROLL,
        turn_max=round(float(dd.max()), 3), turn_max_frame=int(np.argmax(dd)) + 1,
        px_median=round(med, 3), px_max_over_median=round(float(px.max()) / med, 3), ratio_target=4.0,
        hold_px_min=round(min(v['hold_px_min'] for v in holds.values()), 3), hold_min=HOLD_MIN,
        hold_frames_min=min(v['hold_frames'] for v in holds.values()),
        turn_rate_change_max=round(float(max(rel)), 3) if rel else 0.0, turn_rate_jumps=jumps[:20],
        flow_jump_max=round(float(flow_max[0]), 3), flow_jump_max_frame=flow_max[1], flow_jumps=flow_bad[:20],
        flow_jump_p95=round(float(np.percentile(fj, 95)), 3) if len(fj) else 0.0,
        zero_steps_before_last=zero_steps, final_step_px=round(float(px[-1]), 3),
    )
    fails = []
    if cap['px_max'] > CAP_PX + 1e-6:
        fails.append('p90 motion %.2f px > %.0f at frame %d' % (cap['px_max'], CAP_PX, cap['px_max_frame']))
    if cap['dlnw_max'] > CAP_DLNW + 1e-9:
        fails.append('ln width step %.4f > %.2f at frame %d' % (cap['dlnw_max'], CAP_DLNW, cap['dlnw_max_frame']))
    if cap['roll_max'] > CAP_ROLL + 1e-6:
        fails.append('roll (twist) %.3f deg > %.1f at frame %d' % (cap['roll_max'], CAP_ROLL, cap['roll_max_frame']))
    if cap['px_max_over_median'] >= 4.0:
        fails.append('max/median step ratio %.2f >= 4' % cap['px_max_over_median'])
    if cap['hold_px_min'] < HOLD_MIN - 1e-6:
        fails.append('a soft hold drops to %.2f px/frame (< %.1f)' % (cap['hold_px_min'], HOLD_MIN))
    if cap['hold_frames_min'] < HOLD_FRAMES_MIN:
        fails.append('a soft hold of %d frames (< %d)' % (cap['hold_frames_min'], HOLD_FRAMES_MIN))
    if zero_steps:
        fails.append('zero-speed steps before the last frame: %s' % zero_steps[:10])
    if jumps:
        fails.append('the turn rate jumps by more than %d %% in one frame at %d frames (first: frame %d, %.3f -> %.3f '
                     'deg/frame)' % (100 * TURN_JUMP, len(jumps), jumps[0][0], jumps[0][1], jumps[0][2]))
    if flow_bad:
        fails.append('the picture\'s flow jumps by more than %.1f px in one frame at %d frames (first: frame %d, %.2f px)' % (
            FLOW_JUMP_MAX, len(flow_bad), flow_bad[0][0], flow_bad[0][1]))
    if not monotone:
        fails.append('the look-at moves back toward the tip after the tip key: %s' % [(k, round(x, 3)) for k, x in tail])
    for s in info:
        if not s.get('ok', True):
            fails.append('segment %s did not fit its frames' % s['segment'])
    for k, v in holds.items():
        n_in, n_all = map(int, v['visible_in_hold'].split('/'))
        if n_in < n_all:
            fails.append('%s anchor is out of frame or hidden during its hold (%s)' % (k, v['visible_in_hold']))
    if not all(poster_in.values()):
        fails.append('poster frame %d: anchors out of frame or hidden %s' % (pf, [k for k, v in poster_in.items() if not v]))
    return dict(
        generated=time.strftime('%Y-%m-%d %H:%M:%S'), frames=N, timeline=TL['_path'],
        features_source=plan.F.get('source'), theta_deg=round(plan.theta, 3), poster_search=plan.poster_search,
        poster_pose=dict(az=round(plan.poster['az'], 2), el=round(plan.poster['el'], 2), daz=round(plan.poster['daz'], 1),
                         dutch=round(plan.dutch_B, 1), pull_track=plan.pull),
        frozen_motion_points=fine_src or 'sphere proxy (no close-up mesh found; CAP_MARGIN_PROXY)',
        visibility='anchors: in frame (clear of the 6 % edge fade) and not hidden on the t = 1 sphere set (approximate; '
                   'render_sequence.py --anchors-only ray-casts the mesh)',
        orbit=dict(az0=round(plan.az0 % 360.0, 3), az_end=round(plan.az_end % 360.0, 3), orbit_deg=ORBIT_DEG,
                   el_center=EL_CENTER, el_amp=EL_AMP, el_period=EL_PERIOD, el_start=round(plan.orbit_angles(0.0)[1], 2),
                   el_end=round(plan.orbit_angles(ORBIT_DEG)[1], 2)),
        dolly=dict(a=round(plan.dolly_a, 5), b=round(plan.dolly_b, 5), W_full=round(plan.W_full, 5), span0=SPAN0,
                   span_seed_end=round(plan.span_S, 4), span1=SPAN1, span_blend=SPAN_BLEND),
        path_turn_by_piece=plan.turn_pieces,
        look_at_along_arm=[(k, round(x, 4)) for k, x in xs_key], look_at_monotone=bool(monotone),
        tip_speed_px=tipspeed, key_light=trail,
        total_turn_deg=round(float(dd.sum()), 2), total_turn_target_deg=sum(STORYBOARD_TURN.values()),
        total_rotation_deg=round(float(rot.sum()), 2),
        total_twist_deg=round(float(tw.sum()), 2), dutch_roll_step_max=round(float(droll.max()), 3),
        chapters=chap, holds=holds, segments=info, caps=cap, poster=dict(frame=pf, anchors_visible=poster_in),
        fails=fails, ok=not fails)


def report_text(rep):
    L = []
    c = rep['caps']
    L.append('SOLIDIFY hero v4 path  (%s)  %d frames' % (rep['generated'], rep['frames']))
    L.append('features: %s' % rep['features_source'])
    L.append('frozen-frame motion measured on: %s' % rep['frozen_motion_points'])
    if rep.get('growth_motion_points'):
        L.append('growth-frame motion measured on: %s' % rep['growth_motion_points'])
    L.append('total turn %.1f deg of view direction (storyboard %.0f), total rotation %.1f deg, total twist %.1f deg; '
             'trunk angle on the lathe %.1f deg' % (rep['total_turn_deg'], rep['total_turn_target_deg'],
                                                   rep['total_rotation_deg'], rep['total_twist_deg'], rep['theta_deg']))
    L.append('p90 motion: max %.2f px (frame %d, cap %.0f), median %.2f, max/median %.2f (target < 4); ln width step max '
             '%.4f (frame %d, cap %.2f); roll (twist) max %.3f deg/frame (frame %d, cap %.1f); direction turn max %.2f '
             'deg/frame (frame %d); turn-rate change max %.1f %% a frame above %.1f deg/frame (limit %.0f %%)' % (
                 c['px_max'], c['px_max_frame'], c['px_cap'], c['px_median'], c['px_max_over_median'], c['dlnw_max'],
                 c['dlnw_max_frame'], c['dlnw_cap'], c['roll_max'], c['roll_max_frame'], c['roll_cap'], c['turn_max'],
                 c['turn_max_frame'], 100 * c['turn_rate_change_max'], TURN_JUMP_FLOOR, 100 * TURN_JUMP))
    L.append('flow (median screen displacement): largest change in one frame %.2f px (frame %s; limit %.1f), 95th '
             'percentile %.2f' % (c['flow_jump_max'], c['flow_jump_max_frame'], FLOW_JUMP_MAX, c['flow_jump_p95']))
    L.append('%-9s %9s %8s %7s %6s %8s %8s %7s %7s %7s %8s %8s' % ('chapter', 'frames', 'turn', 'target', 'ratio',
                                                                  'deg/fr', 'min/fr', 'px med', 'px max', 'px min',
                                                                  'dlnw max', 'twist mx'))
    for k, v in rep['chapters'].items():
        L.append('%-9s %4d-%-4d %8.1f %7s %6s %8.2f %8.3f %7.2f %7.2f %7.2f %8.4f %8.3f' % (
            k, v['frames'][0], v['frames'][1], v['turn_deg'],
            '%.0f' % v['turn_target_deg'] if v['turn_target_deg'] else '-',
            '%.2f' % v['turn_vs_target'] if v['turn_vs_target'] else '-', v['deg_per_frame_mean'],
            v['deg_per_frame_min'], v['px_median'], v['px_max'], v['px_min'], v['dlnw_max'], v['twist_max']))
    ts = rep['tip_speed_px']
    L.append('crystal size on screen (tips from the center, growth + dolly, px/frame at 1200): frames %d-%d median %.2f, '
             'min %.2f, max %.2f (max/min %.2f); seed start %.2f; by chapter %s; growth alone by chapter %s' % (
                 ts['frames'][0], ts['frames'][1], ts['median'], ts['min'], ts['max'], ts['max_over_min'],
                 ts['seed_start'], json.dumps(ts['by_chapter']), json.dumps(ts['growth_only_by_chapter'])))
    L.append('look-at along the +x arm (x): %s -> %s' % (rep['look_at_along_arm'],
                                                         'monotone from the tip' if rep['look_at_monotone'] else 'NOT monotone'))
    if rep.get('poster_search'):
        ps = {k: v for k, v in rep['poster_search'].items() if k != 'visible_poses'}
        L.append('poster search: %s' % json.dumps(ps))
    if rep.get('key_light'):
        L.append('key light trail: %s' % json.dumps(rep['key_light']))
    L.append('holds (window, hold, hold px min..max, anchor visible (in frame + sphere occlusion): window / hold, anchor '
             'x/y in the hold):')
    for k, v in rep['holds'].items():
        L.append('  %-9s %s %s  %.2f..%.2f px  %s / %s  x %s y %s  label %s%s' % (
            k, v['window'], v['hold'], v['hold_px_min'], v['hold_px_max'], v['visible_in_window'], v['visible_in_hold'],
            v['anchor_x_in_hold'], v['anchor_y_in_hold'], v['label'], '' if v['label_side_ok'] else ' (SIDE?)'))
    L.append('segments:')
    for s in rep['segments']:
        L.append('  %-28s frames %s (%d) u %.1f..%.1f amplitude %s%s%s%s' % (
            s['segment'], s['frames'], s['frames'][1] - s['frames'][0], s['u'][0], s['u'][1], s['amplitude'],
            (' peak %s' % s['peak']) if 'peak' in s else '',
            (' | %s frames at a flat cap speed' % s['frames_at_cap']) if 'frames_at_cap' in s else '',
            '' if s.get('ok', True) else '  DID NOT FIT'))
    L.append('poster frame %d (az %.0f, el %.0f), anchors visible: %s' % (
        rep['poster']['frame'], rep['poster_pose']['az'], rep['poster_pose']['el'], rep['poster']['anchors_visible']))
    L.append('CHECK: ' + ('PASS' if rep['ok'] else 'FAIL: ' + '; '.join(rep['fails'])))
    return '\n'.join(L)


def plot(recs, TL, path):
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except Exception as e:  # noqa
        print('[plan] no plot (%s)' % e)
        return None
    f = np.arange(1, len(recs))
    px = [r['px'] for r in recs[1:]]
    dd = [r['turn'] for r in recs[1:]]
    tw = [r['twist'] for r in recs[1:]]
    dl = [abs(r['dlnw']) for r in recs[1:]]
    W = [r['width'] for r in recs]
    ko = [r.get('key_offset_deg', 0.0) for r in recs]
    fig, ax = plt.subplots(5, 1, figsize=(14, 12), sharex=True)
    ax[0].plot(f, px, lw=1.2)
    ax[0].axhline(CAP_PX, color='r', lw=0.8, ls='--')
    ax[0].axhline(HOLD_MIN, color='g', lw=0.8, ls=':')
    ax[0].set_ylabel('p90 px/frame')
    ax[1].plot(f, dd, lw=1.2, label='direction turn')
    ax[1].plot(f, tw, lw=1.0, label='twist (roll)')
    ax[1].axhline(CAP_ROLL, color='r', lw=0.8, ls='--')
    ax[1].set_ylabel('deg/frame')
    ax[1].legend(loc='upper right')
    ax[2].plot(f, dl, lw=1.2)
    ax[2].axhline(CAP_DLNW, color='r', lw=0.8, ls='--')
    ax[2].set_ylabel('|d ln W|/frame')
    ax[3].semilogy(np.arange(len(recs)), W, lw=1.2)
    ax[3].set_ylabel('width')
    ax[4].plot(np.arange(len(recs)), ko, lw=1.2)
    ax[4].set_ylabel('key light off rig (deg)')
    ax[4].set_xlabel('frame')
    for a in ax:
        for c in TL['chapters']:
            a.axvline(c['from'], color='k', lw=0.5, alpha=0.4)
        for fe in TL['features']:
            a.axvspan(fe['hold'][0], fe['hold'][1], color='orange', alpha=0.12)
    for c in TL['chapters']:
        ax[0].text(c['from'] + 2, CAP_PX * 1.02, c['id'], fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=90)
    plt.close(fig)
    return path


def scan_keys(plan, step=5.0, log=print):
    """for each tour key's framing (W, sx, sy, the feature point as P), where on the lathe (phi, beta) its anchor is in
    frame and unoccluded: an ASCII map per feature ('#' visible, '.' not), the design aid for TOUR_KEYS."""
    phis = np.arange(20.0, 200.0 + 1e-9, step)
    betas = np.arange(40.0, 110.0 + 1e-9, step)
    for k in plan.D['TOUR_KEYS']:
        fid = k['id']
        pts = np.asarray(plan.F['points'][fid], dtype=np.float64)
        P = k['P'] if k.get('P') is not None else feature_P(plan.F, fid)
        log('%s: P %s, W %.2f, (sx, sy) (%.2f, %.2f); rows beta %s..%s, columns phi %s..%s step %s' % (
            fid, np.round(P, 3).tolist(), k['W'], k['sx'], k['sy'], betas[0], betas[-1], phis[0], phis[-1], step))
        for b in betas:
            row = ''
            for ph in phis:
                f, r, u = lathe_frame(lathe_dir(ph, b), X, plan.theta)
                cam = Cam(f, r, u, target_of(P, k['sx'], k['sy'], k['W'], r, u), k['W'], LENS_TOUR, 1)
                xy, ok = cam.project(pts)
                vis = bool(ok.all() and (xy >= EDGE_FADE).all() and (xy <= 1.0 - EDGE_FADE).all())
                if vis and plan.occ is not None:
                    vis = not any(plan.occ.hidden(cam.loc, p, plan.tol[fid][i]) for i, p in enumerate(pts))
                row += '#' if vis else '.'
            log('  beta %5.1f %s' % (b, row))


# =====================================================================================================================
def atomic_json(path, data, indent=None):
    tmp = '%s.%d.tmp' % (path, os.getpid())
    with open(tmp, 'w') as fh:
        json.dump(data, fh, indent=indent, default=str)
    for k in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if k == 19:
                raise
            time.sleep(0.25)


def parse_args(argv):
    p = argparse.ArgumentParser(description='SOLIDIFY hero v4: plan the camera path (path.json + motion report)')
    p.add_argument('--timeline', default=TIMELINE_PATH)
    p.add_argument('--out', default=OUT_DEFAULT)
    p.add_argument('--features', default=None, help='default <out>/features.json')
    p.add_argument('--mesh-cache', default=None, help='the mesh cache root (default <out>/cache/mesh), where the '
                                                      'close-up mesh the frozen frames are measured on is found')
    p.add_argument('--seed', type=int, default=7)
    p.add_argument('--points', type=int, default=5000, help='points per frame for the screen-motion measure')
    p.add_argument('--no-check', action='store_true', help='always exit 0 and write path.json even when the check '
                                                          'fails (the report still says PASS / FAIL)')
    p.add_argument('--plot', action='store_true', help='also write <out>/path_report.png')
    p.add_argument('--design', default=None,
                   help='JSON of design overrides: any upper-case constant of this module (TOUR_KEYS, POSTER_KEY, '
                        'THETA, ORBIT_DEG, EL_*, SPAN*, HOLD_SPEED, GLIDE_RAMP, ...), for trying a variant without '
                        'editing the file')
    p.add_argument('--tag', default='', help='suffix for the output names (path<tag>.json, path_report<tag>.*)')
    p.add_argument('--propose', action='store_true',
                   help='only size the post-growth chapters from measured leg costs and write '
                        '<out>/timeline_proposed.json (hero/timeline.json is never written)')
    p.add_argument('--scan-keys', action='store_true', help='print where each callout is visible on the lathe, stop')
    p.add_argument('--growth-points', choices=('auto', 'meshes', 'proxy'), default='auto',
                   help='growth frames measured on their cached meshes (auto: when every one is cached; meshes: '
                        'require them) or on the sphere-set proxy')
    return p.parse_args(argv)


def apply_design(path):
    with open(path) as fh:
        over = json.load(fh)
    g = globals()
    for k, v in over.items():
        if not (k.isupper() and k in g):
            raise SystemExit('design override %r is not a constant of path_plan.py' % k)
        g[k] = v
    return over


def main(argv=None):
    A = parse_args(sys.argv[1:] if argv is None else argv)
    t_run = time.perf_counter()
    os.makedirs(A.out, exist_ok=True)
    over = apply_design(A.design) if A.design else {}
    if over:
        print('[plan] design overrides from %s: %s' % (A.design, sorted(over)))
    TL = load_timeline(A.timeline)
    clouds, key, gfp, nuc, DG, GA = point_clouds(os.path.join(A.out, 'cache'), A.seed)
    F = load_features(A.features or os.path.join(A.out, 'features.json'), DG, GA)
    occ = SphereOcclusion(sphere_set(os.path.join(A.out, 'cache'), A.seed))
    plan = Plan(TL, F, nuc, occ=occ)
    print('[plan] %d frames; orbit az %.1f -> %.1f (%.0f deg), el %.1f -> %.1f; lathe trunk angle %.1f deg; seed dolly a '
          '%.3f, W %.3f -> %.3f; path turn by piece %s; poster az %.1f el %.1f' % (
              plan.N, plan.az0 % 360, plan.az_end % 360, ORBIT_DEG, plan.orbit_angles(0)[1],
              plan.orbit_angles(ORBIT_DEG)[1], plan.theta, plan.dolly_a, math.exp(plan.lnW_frame(0)), plan.W_full,
              plan.turn_pieces, plan.poster['az'], plan.poster['el']))
    if A.scan_keys:
        scan_keys(plan)
        return 0
    fine, fine_src = fine_mesh_cloud(F.get('mesh_key'), A.mesh_cache or os.path.join(A.out, 'cache', 'mesh'))
    if fine is None:
        print('[plan] no cached close-up mesh with key %s: frozen frames measured on the sphere proxy at margin %.2f' % (
            F.get('mesh_key'), CAP_MARGIN_PROXY))
    gen_meshes, n_gen = growth_mesh_files(fine_src, TL)
    if A.growth_points == 'meshes' and not gen_meshes:
        raise SystemExit('--growth-points meshes: only %d of %d growth meshes are cached (render_sequence.py '
                         '--cache-only)' % (n_gen, int(TL['growth']['to']) - 1))
    if A.growth_points == 'proxy':
        gen_meshes = None
    growth_src = ('the cached growth meshes (%d)' % n_gen) if gen_meshes else \
        ('the sphere-set surface proxy (%d of %d growth meshes cached)' % (n_gen, int(TL['growth']['to']) - 1))
    motion = Motion(plan, clouds, res=int(TL.get('res', 1200)), n_points=A.points, fine=fine, gen_meshes=gen_meshes)
    if A.propose:
        prop, legs = propose_timeline(plan, motion, TL)
        pp = os.path.join(A.out, 'timeline_proposed%s.json' % A.tag)
        atomic_json(pp, prop, indent=1)
        print(json.dumps({k: prop[k] for k in ('frames', 'chapters', 'features', 'poster')}, indent=1))
        print('[plan] proposed timeline -> %s (%.1fs)' % (pp, time.perf_counter() - t_run))
        return 0
    u, info = retime(plan, motion)
    recs, sts = measure(plan, motion, u)
    trail = key_trail(recs, TL=TL)
    anchors = anchor_table(plan, recs, sts, occ)
    rep = report(plan, recs, sts, info, anchors, u, trail=trail, fine_src=fine_src)
    rep['growth_motion_points'] = growth_src
    with open(TL['_path'], 'rb') as fh:
        tl_sha = hashlib.sha1(fh.read()).hexdigest()
    meta = dict(version=4, generated=rep['generated'], frames=plan.N, timeline=TL['_path'], timeline_sha1=tl_sha,
                px_per_frame=TL['px_per_frame'], poster=TL['poster'], points_cache=key, generator=gfp,
                features=F, features_key=F.get('key'), theta_deg=plan.theta, u_end=plan.u_end, W_full=plan.W_full,
                frozen_motion_points=fine_src, growth_motion_points=growth_src, key_light=trail,
                design=dict(TOUR_KEYS=plan.D['TOUR_KEYS'], POSTER_KEY=plan.D['POSTER_KEY'], ORBIT_DEG=ORBIT_DEG,
                            EL=[EL_CENTER, EL_AMP, EL_PERIOD, EL_TROUGH], SPAN=[SPAN0, SPAN1, SPAN_BLEND],
                            LENS=[LENS_GROWTH, LENS_TOUR], HOLD_SPEED=HOLD_SPEED, OMEGA_MAX=OMEGA_MAX,
                            TRANS_EXT=TRANS_EXT, LATHE_TAIL=LATHE_TAIL, KEY_TRAIL=KEY_TRAIL),
                caps=dict(px=CAP_PX, dlnw=CAP_DLNW, roll=CAP_ROLL, roll_definition='twist about the view axis, deg/frame'),
                design_overrides=over, ok=rep['ok'])
    tag = A.tag
    failed = not rep['ok'] and not A.no_check
    path_out = os.path.join(A.out, 'path%s%s.json' % (tag, '_failed' if failed else ''))
    atomic_json(path_out, dict(meta=meta, frames=recs))
    rep['anchors_analytic'] = anchors
    atomic_json(os.path.join(A.out, 'path_report%s.json' % tag), rep, indent=1)
    txt = report_text(rep)
    with open(os.path.join(A.out, 'path_report%s.txt' % tag), 'w') as fh:
        fh.write(txt + '\n')
    print(txt)
    if A.plot:
        p = plot(recs, TL, os.path.join(A.out, 'path_report%s.png' % tag))
        if p:
            print('[plan] plot -> ' + p)
    if failed:
        print('[plan] CHECK FAILED: the path went to %s; path%s.json is untouched (--no-check writes it anyway)' % (
            path_out, tag))
    print('[plan] %s, path_report%s.json/.txt -> %s (%.1fs)' % (os.path.basename(path_out), tag, A.out,
                                                               time.perf_counter() - t_run))
    return 0 if (rep['ok'] or A.no_check) else 1


if __name__ == '__main__':
    sys.exit(main())
