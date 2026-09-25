"""
dendrite_gen.py -- procedural cubic (non-faceted metal), equiaxed, free-growth dendrite
for Blender 4.5, run headless:

  blender.exe -b --factory-startup --python dendrite_gen.py -- --t 1.0 --seed 7 \
      --out C:/Users/frank/solidify-hero-out --views top,iso,close --res 1000 --samples 64 --save-blend

  # topology sweep (no render), nonzero exit if any stage is not one closed genus-0 surface:
  blender.exe -b --factory-startup --python dendrite_gen.py -- --stages 0.1,0.3,0.6,1.0 --no-render

  # skeleton statistics only (arm counts, tertiary length spread), no mesh:
  blender.exe -b --factory-startup --python dendrite_gen.py -- --skeleton-only

Import (sequence renderer): build(A, t) -> (object, mesh, arms, vertex coords, stats, gate_ok); A comes from
parse_args() with sys.argv set, extract_features(arms, t, A, seed) is the features JSON, and camera_basis /
fit_distance / place_camera are the camera helpers look.py shares.

Version note: v3 = v1 (the dense fir-tree that reads at page scale) with these repairs:
  1. tertiaries no longer weld to bodies they are not attached to (the v1 see-through pinholes at the secondary
     roots), see clearance_pass; a TOPOLOGY GATE proves it (one closed genus-0 surface or exit code 2);
  2. secondaries are seeded by exactly the v1 random sequence (same stations, vigor, space limits for the same
     seed), so their count and lengths are v1's;
  3. build() / features JSON in the shape render_sequence.py and look.py consume.
  v3.1 (judge round): same-row webbing is gone: an arm's radius law is a paraboloid tip growing toward the root
  (RMAX_BY_GEN / TAU_THICK_BY_GEN / KNEE_P) and two neighbors of a row keep a resolvable liquid channel between
  their trunks (apply_channel_caps), welded only at the coalesced base that grows with age (root zipping,
  ZIP_*); necks are short root constrictions; remelting stubs thin out instead of ballooning; tertiaries are
  one staggered helix per host (no '+' whorls), never born at a capped host's tip (tip_reach_time), on every
  secondary that grew long enough (TERT_HOST_*), and the clearance pass caps rather than drops what it can;
  primary tips follow the Ivantsov paraboloid further back; the near-core stubs that could never protrude are
  not seeded (CORE_MIN_PROT).
  v4 (the scroll hero's continuous camera): the emergence ramp (emerge_shift, EMERGE_*), in the DRAWN geometry only. A
  side arm's drawn protrusion is a smooth function of its true one that starts buried inside the parent when the arm
  switches on, so newborns surface as a swelling instead of appearing at once, remelting stubs sink back, and
  tertiaries on a remelting host retract ahead of its retreating tip instead of vanishing (v3 dropped up to 14 tip
  radii of tertiary in one frame, 61 times in the last 34 growth frames at seed 7).
  v4.1: sample_arm keeps the one station of a short drawn arm (v4 drew nothing until a newborn's apex was ~1 rho out
  of its parent, then the whole cap at once), and the ramp is 2 tip radii long, buried 0.35 rho deep, with lead gain 1.
  Measured over EVERY birth and death of the timeline's 276 growth frames (hero/emerge_check.py, the sphere union
  before the closing, so a little conservative): 8 of 1,891 births stick out of the rest of the crystal on the first
  frame they are drawn, by at most 0.06 rho (0.0003 model units, 0.16 px at the full view); all 67 deaths are buried
  (0.35 rho inside the parent) on their last drawn frame; the drawn protrusion of a surfacing arm rises at most 0.73
  rho in one frame, and a tertiary retracting on a remelting host sinks at most 1.32 rho in one frame (v3: 14). The
  skeleton and every rule that tests geometry (clearance, channel caps, necks) see the undrawn arms, so the t = 1
  crystal's caps, drops and necks are v3's; the mesh changes only at arms inside the ramp (newborns near the tips and
  tertiaries retracting on remelting hosts).

Morphology model (what the numbers mean)
-----------------------------------------
* Six primary arms along <100> (+-x, +-y, +-z), born at t=0 from the nucleus, tips advancing at
  ~constant speed V (small per-arm scatter, 4 %), so the six tips outline an octahedron.
* Every arm is an Ivantsov paraboloid at its tip: envelope radius r(s') = sqrt(2*rho*s') at
  distance s' behind the tip, saturating a few tip radii back to a trunk radius r_max that then
  thickens slowly with the age of that station (coarsening, r_max ~ (1 + age/tau)^(1/3)).
  The union-of-spheres envelope trick: spheres of radius sqrt(2*rho*(c - rho/2)) centred at c behind
  the tip have exactly the paraboloid r^2 = 2*rho*s' as their envelope.
* Fourfold anisotropy: a few tip radii behind the (round) tip the cross-section becomes four-lobed,
  with ridges along the four perpendicular <100> directions (four spheres offset along +-e1, +-e2).
* Side branches: one row per ridge, so four rows per arm, all along <100>. Candidates are seeded
  at spacing lambda0 ~ 2.2 rho and are born `onset` tip radii behind the tip as broad swellings of
  the parent SURFACE (growth is counted from the surface, and a newborn's tip radius starts blunt and
  sharpens to its own rho within ~0.05 of growth time). They compete:
  a branch survives to age A only while it is the most vigorous candidate within lambda(A)/2,
  lambda(A) = lambda0 (1 + A/tau_c)^(1/3) (Kattamis-Flemings style coarsening). Losers stop and
  remelt (their stub shrinks exponentially), winners keep growing, faster the more vigorous.
* Space limit: a secondary at distance s from the centre meets the neighbouring primary's
  secondaries on the diagonal plane, so it slows (tanh law) towards L_cap ~ 0.75-0.9 s.
  Together with the age law this gives the tapered, spear-like envelope of each arm.
* Roots neck with age (Gibbs-Thomson): a Gaussian waist just outside the trunk, depth growing
  with arm age; tertiaries repeat the recipe on the long-lived secondaries.
* Tertiaries (v3): only on long-lived secondaries with >= 6 tip radii of protrusion, four rows, seeded a
  little denser than the secondary spacing law but with a wide spacing jitter, a random 5 % of candidates
  that never nucleate, a wide spread of tip speeds and space limits (uneven lengths); the clearance pass
  below then removes every one that would bridge to a neighbor, which is most of v1's. The two in-plane
  rows point at the neighboring secondary of the host's row and run parallel to the trunk just above
  it; the two out-of-plane rows point at the diagonal with the next row. Any tertiary that would come
  within CLEAR_RADII of its own local radius (at least the closing diameter) of a body it is not attached
  to is capped short of it, or dropped if less than 3 rho of room is left (clearance_pass, at t = 1,
  the longest and thickest every arm ever gets, so the cap holds at every earlier t).
* Roots (v3): a neck only on an isolated root. Where an arm has coalesced with a neighbor (bodies welded
  at or above the waist) the two waists under the weld were a see-through tunnel in v1 (141 of its 184
  handles at seed 7); root remelting needs a liquid channel, so such an arm keeps no neck
  (apply_neck_limits, faded in over a few voxels of approach so a growth sequence never pops).
* Everything becomes ONE surface: points -> SDF grid (exact union of spheres) -> mesh ->
  mesh -> SDF -> mesh at -(k + o) -> mesh -> SDF -> mesh at +o: a morphological closing of radius k
  (natural fillets where branches meet) followed by an opening of one voxel o (removes the sub-voxel
  knife-edge tail of every weld where two coalescing bodies part, and any speck: what marching cubes
  turns into spurious handles and floating fragments) -> light Laplacian smoothing -> smooth shading.
  Each vertex stores birth and age = t - birth, sampled from the nearest skeleton point.
* TOPOLOGY GATE: the dendrite is a tree, so the mesh must be ONE closed surface of genus 0: every
  edge in exactly two faces, one connected component, Euler characteristic V - E + F = 2. Anything
  else fails the build (exit code 2); --stages sweeps several t in one run.
"""
import argparse
import json
import math
import os
import re
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

INF = float('inf')
TAU_NECK = 0.25     # root necking develops with arm age
TAU_REMELT = 0.25   # stunted branches remelt on this time scale (length)
TAU_REMELT_R = 0.35 # ... and thin out on this one (radius): a loser gives its material to its neighbors
TAU_YOUNG = 0.05    # newborn side branches start as broad swellings and sharpen to their own rho
YOUNG_BLUNT = 2.5   # tip radius factor at birth: rho_eff = rho * (1 + YOUNG_BLUNT * exp(-age/TAU_YOUNG))
STUB_BLUNT = 1.0    # a remelting stub's tip goes blunt by at most this factor (v1: up to 7x, a barrel)
ALIVE_PROT = 0.5    # a side arm exists (alive) while it protrudes more than this many of its tip radii beyond its
                    # parent's surface: born when its growth passes it, gone when a remelting stub shrinks below it
# v4 emergence ramp (DRAWN geometry only; the skeleton, the states and every rule that tests geometry are unchanged):
# a side arm switches on at ALIVE_PROT tip radii of protrusion, which v3 drew at once, a dome 0.5 rho high and ~2 rho
# wide popping out of a static surface in one frame (and a remelting stub vanished the same way). The DRAWN protrusion
# is instead a smooth function of the true one: EMERGE_BURY tip radii below the parent's surface (hidden inside it) at
# the switch-on, a C1 cubic that leaves with zero speed and joins the true protrusion with matching speed EMERGE_RHO tip
# radii later (emerge_shift). A newborn surfaces as a bump that swells out, a dying stub sinks back into its parent,
# and the tip radius keeps its blunt-to-sharp law (young_factor); only the protrusion is ramped, never the radius.
# The same curve also retires side arms whose PARENT's tip retreats past them: a stunted secondary that remelts takes
# its tertiaries with it (set_state kills a side arm within two parent tip radii of the parent's tip), which v3 drew as
# tertiaries up to 14 tip radii long vanishing in one frame (61 of them in frames 196-229 at seed 7, full view). The
# ramp's input is min(h, a0 + EMERGE_TIP_K x (the parent tip's lead over the station - EMERGE_TIP_LEAD rho)), so such
# an arm retracts in step with the retreating tip and has sunk into the host before the host's tip reaches it (the
# margin covers a frame of retreat). On a growing host the lead grows faster than the tertiary (its tip speed is below
# the host's), so the term is inactive there but for a few arms near a slowing (capped) host's tip.
# v4.1 values, measured over EVERY birth and death of the 276 growth frames (hero/emerge_check.py, 2026-09-24): v4's
# 1.0 / 0.25 / 2.0 with the old sampler left 492 of 1,889 tertiary births sticking out of the rest of the crystal on the
# first frame they were drawn (up to 0.77 rho, 2 px at full view), because sample_arm drew nothing for a short arm
# until its apex was ~1 rho out; with the sampler fixed a 1-rho ramp still let 106 out (a fast tertiary rises ~0.4 rho
# a frame, and the ramp's steep middle takes 2.4x that). A 2-rho ramp buried 0.35 rho deep and a lead gain of 1 leave
# 8 of 1,891 births out, by at most 0.06 rho (0.16 px at full view); every death is buried on its last drawn frame.
EMERGE_RHO = 2.0
EMERGE_BURY = 0.35
EMERGE_TIP_K = 1.0
EMERGE_TIP_LEAD = 1.0
# radius law per generation (v3.1): r(station) = knee radius RMAX * rho, grown by the station's age (coarsening),
# r = RMAX rho (1 + age / TAU_THICK)^(1/3); the tip is an Ivantsov paraboloid r^2 = 2 rho c joined to that trunk
# radius by a soft minimum (KNEE_P). Primaries: a broad knee (2.2 rho) with slow thickening keeps the root at v1's
# 0.05 while the first 0.1 behind the tip follows the paraboloid. Side arms: a narrow knee (1.2 rho) with fast
# thickening, so a secondary is thin at its tip and grows toward its root (a young one is a needle, an old one a
# spear), instead of v1's sausage that reached its full radius 1.4 tip radii behind the tip.
RMAX_BY_GEN = (2.2, 1.2, 1.35)
TAU_THICK_BY_GEN = (0.9, 0.12, 0.12)
KNEE_P = 4.0        # soft-minimum exponent joining the paraboloid to the trunk radius (larger = sharper knee)
NUC_FACTOR = 1.3    # nucleus radius in units of the primary trunk radius ...
NUC_RMAX = 1.8      # ... under v1's trunk law (1.8 rho, tau 0.35): the nucleus, and with it the first side-branch
NUC_TAU = 0.35      # station of every row, is exactly v1's, so the secondary random sequence is unchanged
# channel rule (v3.1): two neighbors of one row must leave a liquid channel between them that the closing cannot
# fill and marching cubes resolves: gap >= 2 fillet + CHANNEL_VOXELS voxels. The less vigorous arm of a pair (the
# one the coarsening law will stop) yields: its trunk radius is capped so the channel to its dominant neighbor stays
# open (apply_channel_caps); an arm is never capped below max(rho, R_FLOOR_VOXELS voxels). The cap fades in as
# the dominant neighbor grows from CAP_RAMP[0] to CAP_RAMP[1] tip radii of protrusion (a ripple constrains nothing,
# and a growth sequence never pops). Same-row welds are therefore confined to the fillet at the very root.
CHANNEL_VOXELS_BY_GEN = (0.0, 2.0, 1.0)    # tertiary rows may share a welded base (a serrated fin), not a curtain
R_FLOOR_VOXELS = 2.0
CAP_RAMP = (1.0, 4.0)
CAP_SHARE = 0.6     # the more vigorous arm of a crowded pair gets this share of the room, the loser the rest
# root zipping (v3.1): coalescence starts at the roots and zips outward late in coarsening. An arm older than
# ZIP_T0 keeps its full (uncapped) trunk radius, welded to its row neighbors, up to ZIP_SPEED * (age - ZIP_T0)
# above the parent surface, blended over ZIP_BAND; above that the channel cap holds. So the oldest arms near the
# core have coalesced bases and thin tapered tops, the young ones near the tip are separate needles, and the
# profile stays monotone (thick root, thin tip), which keeps a same-row weld tunnel-free.
ZIP_T0 = 0.3
ZIP_SPEED = 0.12
ZIP_BAND = 0.01
# root neck (v3.1): a short constriction right at the root (v1: a Gaussian 0.7 body radii up, 0.7 wide, which with
# the constant body radius above it made a lozenge); never thinner than the arm's floor radius
NECK_POS = 0.55
NECK_WIDTH = 0.40
NECK_FLOOR_VOXELS = 2.5
# tertiary rules (secondaries are untouched: same random sequence, same laws as v1)
TERT_SPACING = 1.5          # tertiary station spacing along the host, in units of the secondary law lambda0 * rho(host):
                            # the coarsened spacing (~6 tertiary tip radii), so neighbors in a row keep a channel
TERT_JITTER = (0.7, 1.4)    # spacing jitter between consecutive tertiary stations: uneven combs
TERT_SKIP = 0.05            # fraction of tertiary candidates that never nucleate
TERT_SPEED = (0.55, 0.90)   # tertiary tip speed = 0.6 * host speed * (a + b * vigor): a wide spread of lengths
TERT_OOP_CAP = (0.55, 0.90) # out-of-plane tertiary space limit, fraction of its distance from the trunk axis
TERT_HOST_MIN_STOP = 0.25   # a secondary hosts tertiaries if it grew for at least this long (v3: 0.6, which left
                            # two thirds of the long secondaries bare)
TERT_MIN_PROT = 6.0         # ... and protruded at least this many of its tip radii at its longest
TERT_HOST_MIN_BODY = 1.15   # ... and is not channel-capped to a needle (body radius at t = 1 in tip radii)
TERT_HOST_RATIO = 0.7       # a tertiary's trunk radius never exceeds this fraction of its host's body radius
REACH_MAX = 0.97            # a space-limited arm never reaches beyond this fraction of its cap: a side branch
                            # seeded beyond cap - onset would be born at the host's tip (the v3 'cat ears')
CLEAR_RADII = 1.5           # a side arm stops >= this many of its own local radii short of any foreign body
CLEAR_ROOT_FREE = 1.0       # ... except within this many body radii of its own root (welds there are fillets)
CLEAR_MIN_PROT = (3.0, 1.0) # a capped arm left with less protrusion than this (in rho; secondary, tertiary) is
                            # dropped; a tertiary nub of one tip radius is kept (v3 dropped everything under 3 rho)
CORE_MIN_PROT = 3.0         # a secondary whose space limit never lets it protrude this many rho is not seeded
CLEAR_TIMES = (0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.8, 0.85, 0.9, 0.93, 0.97, 1.0)   # growth times at
                            # which the clearance pass tests every arm against the world AS IT IS THEN: a growing arm
                            # is longest and fattest at t = 1, but a stunted one is longest at its stop time and widest
                            # (a blister) while it remelts, an arm dead by t = 1 still existed before, and a newborn is
                            # a dome wider than it is long for its first ~0.05 (dense sampling late, where most
                            # tertiaries are born)
NECK_ZONE = 2.2             # the root neck lives within this many root radii of the parent surface; anything welded
                            # to the arm at or above the waist in that zone (a coalesced neighbor, a hugged trunk)
                            # suppresses the neck (a weld below the waist roofs nothing); the waist sits at NECK_POS
WELD_FADE_VOXELS = 1.5      # the neck fades out over this many voxels of approach before the weld forms (no pop)
OPEN_VOXELS = 1.0           # morphological opening after the closing, in voxels: removes sub-voxel slivers (the
                            # knife-edge tail of a weld where two coalescing bodies part, and specks), which are
                            # what marching cubes turns into spurious handles and floating fragments
GATE_EXIT_CODE = 2


# ----------------------------------------------------------------------------------------------
# skeleton model
# ----------------------------------------------------------------------------------------------
class Arm:
    def __init__(self):
        self.idx = -1
        self.gen = 0
        self.origin = np.zeros(3)
        self.d = np.zeros(3)
        self.e1 = np.zeros(3)
        self.e2 = np.zeros(3)
        self.birth = 0.0
        self.V = 1.0
        self.rho = 0.02
        self.rmax0 = 0.036
        self.Lcap = INF
        self.stop_age = INF
        self.parent = None
        self.s_par = 0.0
        self.vigor = 1.0
        self.row = -1
        self.delta_max = 0.0
        self.neck = 0.0
        self.children = []
        self.gap_prev = 0.0
        self.gap_next = 0.0
        self.onset = 0.0      # side-branch onset behind the parent's tip (model units)
        self.r_floor = 0.0    # the trunk radius is never capped, and the neck never cut, below this
        self.dropped = False  # removed by clearance_pass (never alive again)
        # state at the current growth time
        self.age = 0.0
        self.L = 0.0
        self.R_root = 0.0
        self.alive = False
        self.k_neck = 0.0     # root-neck depth factor now (the sequence renderer reads it)
        self.w_now = 0.0      # largest body radius now (features JSON, clearance)
        self.w_free = 0.0     # ... the same without the channel cap
        self.r_cap = INF      # channel rule: trunk radius cap now (apply_channel_caps)


def room(arm, R_root):
    """space left for the protruding part of the arm beyond the parent surface (INF if uncapped)."""
    if arm.Lcap >= INF:
        return INF
    return max(arm.Lcap - R_root, 2.0 * arm.rho)


def protrusion(arm, age, cap):
    """protrusion beyond the parent surface after `age`: constant speed, tanh slow-down towards `cap`.
    Side branches are perturbations of the parent SURFACE, so growth is counted from there, not from
    the parent axis (otherwise a branch would need R_root/V of invisible growth before emerging)."""
    h = arm.V * age
    if cap < INF:
        return cap * math.tanh(h / cap)
    return h


def length_at(arm, t, R_root):
    """skeleton length from the arm origin (parent axis) = R_root + protrusion."""
    age = t - arm.birth
    if age <= 0.0:
        return 0.0
    cap = room(arm, R_root)
    h = protrusion(arm, age, cap)
    if age > arm.stop_age:                       # lost the coarsening competition: stop, then remelt
        hs = protrusion(arm, arm.stop_age, cap)
        h = hs * math.exp(-(age - arm.stop_age) / TAU_REMELT)
    return R_root + h


def t_pass_vec(arm, s):
    """time at which the tip of `arm` passed distance s from its origin (free growth law);
    everything inside the parent (s < R_root) counts as passed at birth."""
    s = np.asarray(s, dtype=np.float64)
    s_eff = np.maximum(s - arm.R_root, 0.0)
    cap = room(arm, arm.R_root)
    if cap < INF:
        x = np.clip(s_eff / cap, 0.0, 0.999)
        a = cap / arm.V * np.arctanh(x)
    else:
        a = s_eff / arm.V
    return arm.birth + a


def tip_reach_time(arm, s):
    """time at which the tip of `arm` reaches distance s from its origin; INF when the space limit keeps it short
    of s (a side branch seeded there would never be born). For an uncapped arm this is v1's birth law."""
    s_eff = s - arm.R_root
    if s_eff <= 0.0:
        return arm.birth
    cap = room(arm, arm.R_root)
    if cap < INF:
        x = s_eff / cap
        if x >= REACH_MAX:
            return INF
        return arm.birth + cap / arm.V * math.atanh(x)
    return arm.birth + s_eff / arm.V


def env_radius(rho, rmax, c):
    """Ivantsov paraboloid sqrt(2 rho c) joined to the trunk radius rmax by a soft minimum (arrays ok): follows
    the paraboloid to ~0.85 rmax, then saturates (v1's 1 - exp form left it at 0.63 of the paraboloid there)."""
    c = np.maximum(c, 0.0)
    para = np.sqrt(2.0 * rho * c)
    return para * rmax / np.power(np.power(para, KNEE_P) + np.power(rmax, KNEE_P), 1.0 / KNEE_P)


def young_factor(arm, age):
    """a newborn side branch is a broad swelling of the parent surface that sharpens to its own rho."""
    if arm.gen == 0:
        return 1.0
    return 1.0 + YOUNG_BLUNT * math.exp(-age / TAU_YOUNG)


def station_rmax(arm, t, s):
    """trunk (saturated) radius of the stations at distance s from the arm origin at time t: the knee radius grown
    by the station's age (coarsening); a stunted arm stops thickening when it stops growing and thins as it remelts;
    a newborn is broad at the base; the channel rule caps the whole arm (arm.r_cap). Returns (rmax, station birth)."""
    s = np.asarray(s, dtype=np.float64)
    tb = np.minimum(t, t_pass_vec(arm, s))
    t_eff = min(t, arm.birth + arm.stop_age)
    a = np.maximum(t_eff - tb, 0.0)
    rmax = arm.rmax0 * np.cbrt(1.0 + a / TAU_THICK_BY_GEN[arm.gen])
    age = t - arm.birth
    if arm.gen >= 1:
        rmax = rmax * min(2.0, math.sqrt(young_factor(arm, age)))
        if age > arm.stop_age:
            rmax = rmax * math.exp(-(age - arm.stop_age) / TAU_REMELT_R)
    return rmax, tb


def capped_rmax(arm, t, s, rmax):
    """the channel cap applied to the uncapped trunk radii `rmax` of stations s: full radius within the zipped root
    zone (h < ZIP_SPEED (age - ZIP_T0) above the parent surface), the cap above it, blended over ZIP_BAND."""
    if arm.r_cap >= INF or arm.gen == 0:
        return rmax
    h_zip = ZIP_SPEED * max(0.0, (t - arm.birth) - ZIP_T0)
    h = np.asarray(s, dtype=np.float64) - arm.R_root
    keep = np.clip((h_zip + ZIP_BAND - h) / (2.0 * ZIP_BAND), 0.0, 1.0)     # 1 in the zipped zone, 0 above
    return np.minimum(rmax, arm.r_cap + keep * np.maximum(rmax - arm.r_cap, 0.0))


def root_rmax(arm, t):
    """uncapped trunk radius of the arm's root station (scalar)."""
    return float(station_rmax(arm, t, np.array([arm.R_root]))[0][0])


def radius_env_at(arm, t, s):
    """envelope radius of `arm` at distance s from its origin at time t (scalar, no neck/lobes)."""
    c = arm.L - s
    if c <= 0.0:
        return 0.0
    rmax, _ = station_rmax(arm, t, np.array([s]))
    rmax = capped_rmax(arm, t, np.array([s]), rmax)
    return float(env_radius(effective_rho(arm, t - arm.birth), rmax, np.array([c]))[0])


def effective_rho(arm, age):
    """tip radius actually used: young side branches are broad swellings, remelting stubs go (a little) blunt."""
    rho = arm.rho * young_factor(arm, age)
    if age > arm.stop_age:
        rho = rho * (1.0 + STUB_BLUNT * min((age - arm.stop_age) / TAU_REMELT, 1.0))
    return rho


def emerge_shift(arm):
    """v4 emergence ramp: how far the DRAWN side arm sits behind its skeleton tip (model units, >= 0; 0 for a primary
    and for any arm past the ramp). With h the true protrusion (L - R_root), a0 = ALIVE_PROT rho the switch-on, w =
    EMERGE_RHO rho the ramp and b = EMERGE_BURY rho, the drawn protrusion p runs from -b at the switch-on (the apex
    inside the parent) to its input at a0 + w along the cubic Hermite with dp/dh = 0 at the start and 1 at the end,
    monotone in between. The input is h_in = min(h, a0 + EMERGE_TIP_K * lead), lead = how far the parent's tip still
    runs ahead of the station (set_state kills the arm at lead < 0), so an arm on a retreating parent retracts along the
    same curve and is buried before it dies. p depends only on continuous state, so a growing arm surfaces and a
    remelting or orphaned one sinks back without a jump, and p <= h_in <= h: the drawn arm (the same profile around a
    lower apex) lies inside the skeleton's at every station."""
    if arm.gen == 0 or EMERGE_RHO <= 0.0:
        return 0.0
    h = arm.L - arm.R_root
    a0 = ALIVE_PROT * arm.rho
    w = EMERGE_RHO * arm.rho
    h_in = h
    par = arm.parent
    if par is not None and EMERGE_TIP_K > 0.0:
        lead = par.L - 2.0 * par.rho - arm.s_par
        h_in = min(h, a0 + EMERGE_TIP_K * (lead - EMERGE_TIP_LEAD * arm.rho))
    if h_in >= a0 + w:
        return max(h - h_in, 0.0)
    bury = EMERGE_BURY * arm.rho
    span = a0 + w + bury                   # the drawn protrusion's travel over the ramp
    x = min(max((h_in - a0) / w, 0.0), 1.0)
    m = w / span                           # end slope of the unit Hermite that makes dp/dh = 1 at the top
    p = -bury + span * ((m - 2.0) * x ** 3 + (3.0 - m) * x ** 2)
    return max(h - p, 0.0)


def neck_depth(arm, t):
    """root-neck depth factor (0..neck) of a side arm at time t; needs arm.L and arm.R_root set."""
    if arm.gen == 0 or arm.neck <= 0.0:
        return 0.0
    age = max(t - arm.birth, 0.0)
    prot = arm.L - arm.R_root
    k = arm.neck * (1.0 - math.exp(-age / TAU_NECK))
    return k * min(1.0, max(0.0, prot / (2.5 * root_rmax(arm, t)) - 0.2))   # no neck on stubby young bumps


def arm_profile(arm, t, c, shift, L=None):
    """For stations at distance c behind the current tip: (radius, ridge offset delta, station birth).
    shift=True returns the sphere radius whose envelope is the paraboloid; False the envelope itself.
    L: the tip position the stations hang from (default the skeleton's arm.L; sample_arm passes the drawn tip)."""
    c = np.asarray(c, dtype=np.float64)
    L = arm.L if L is None else L
    s = L - c
    rmax, tb = station_rmax(arm, t, s)
    rmax = capped_rmax(arm, t, s, rmax)
    age = max(t - arm.birth, 0.0)
    rho = effective_rho(arm, age)
    r = env_radius(rho, rmax, c - (0.5 * rho if shift else 0.0))
    if arm.gen >= 1 and arm.neck > 0.0:
        k = arm.k_neck            # neck_depth(arm, t), set by set_state, scaled down by apply_neck_limits
        if k > 0.0:
            rr = root_rmax(arm, t)
            s_neck = arm.R_root + NECK_POS * rr
            w = NECK_WIDTH * rr
            r_necked = r * (1.0 - k * np.exp(-((s - s_neck) / w) ** 2))
            r = np.maximum(r_necked, np.minimum(r, arm.r_floor))    # a neck never thinner than the floor radius
    delta = arm.delta_max * (1.0 - np.exp(-c / (3.0 * arm.rho))) * r
    return r, delta, tb


def body_radius(arm, t):
    """largest envelope radius of the arm at time t (gen 0: the trunk radius at its root station)."""
    if arm.gen == 0:
        return float(arm_profile(arm, t, np.array([arm.L]), shift=False)[0][0])
    s = np.linspace(arm.R_root, arm.L, 48)
    r, _, _ = arm_profile(arm, t, arm.L - s, shift=False)
    return float(r.max())


def set_state(arm, t):
    """v1's per-arm state at time t (parents first); the body radii follow in apply_channel_caps."""
    arm.age = t - arm.birth
    par = arm.parent
    arm.R_root = 0.0 if par is None else radius_env_at(par, t, arm.s_par)
    arm.L = length_at(arm, t, arm.R_root) if arm.age > 0.0 else 0.0
    arm.alive = (not arm.dropped) and arm.age > 0.0 and (arm.L - arm.R_root) > ALIVE_PROT * arm.rho
    if par is not None and ((not par.alive) or arm.s_par > par.L - 2.0 * par.rho):
        arm.alive = False           # a side branch within two tip radii of its parent's tip would fork that tip
    arm.k_neck = neck_depth(arm, t) if arm.alive else 0.0


def apply_channel_caps(arms, gen, t, A):
    """The channel rule for one generation (states of that generation set at t). Two alive neighbors of one row
    must leave a liquid channel of 2 fillet + CHANNEL_VOXELS voxels between their trunks; the less vigorous of the
    pair (the one the coarsening law stops first, so the pair's eventual loser) yields: its trunk radius is capped
    at spacing - channel - (dominant's uncapped body radius), never below its floor radius, and the cap fades in
    while the dominant grows from CAP_RAMP[0] to CAP_RAMP[1] tip radii of protrusion. Pairs farther apart than
    ~1.5 lambda0 are unconstrained: the coarsened survivors keep v1's full body. Sets r_cap, w_free, w_now.
    Returns the number of capped arms."""
    ch = 2.0 * A.fillet + CHANNEL_VOXELS_BY_GEN[gen] * A.voxel
    mine = [a for a in arms if a.gen == gen]
    rows = {}
    for a in mine:
        a.r_cap = INF
        a.w_free = body_radius(a, t) if a.alive else 0.0
        if gen >= 2 and a.alive:                 # never fatter than its host (the host's state is final here)
            a.r_cap = max(a.r_floor, TERT_HOST_RATIO * a.parent.w_now)
        if a.alive and a.parent is not None:
            rows.setdefault((a.parent.idx, a.row), []).append(a)
    n_cap = 0

    def ramp(x):
        return min(max(((x.L - x.R_root) / x.rho - CAP_RAMP[0]) / (CAP_RAMP[1] - CAP_RAMP[0]), 0.0), 1.0)

    for lst in rows.values():
        lst.sort(key=lambda x: x.s_par)
        for a, b in zip(lst[:-1], lst[1:]):
            dom, sub = (a, b) if a.vigor >= b.vigor else (b, a)
            S = (b.s_par - a.s_par) - ch                     # room for the two trunk radii
            if dom.w_free + sub.w_free <= S:
                continue
            # the pair shares the room CAP_SHARE : 1 - CAP_SHARE, each taking what the other leaves unused; the cap
            # from a neighbor fades in with that neighbor's protrusion
            for x, y, share in ((dom, sub, CAP_SHARE), (sub, dom, 1.0 - CAP_SHARE)):
                wt = ramp(y)
                if wt <= 0.0:
                    continue
                cap = max(x.r_floor, share * S, S - y.w_free)
                x.r_cap = min(x.r_cap, cap + (1.0 - wt) * 1.0)
    for a in mine:
        if a.alive:
            a.w_now = body_radius(a, t) if a.r_cap < INF else a.w_free
            n_cap += int(a.w_now < a.w_free - 1e-6)
        else:
            a.w_now = 0.0
    return n_cap


def set_states(arms, t, A):
    """arm states at time t without the neck rule: generation by generation, v1's set_state (a child's root radius
    needs its parent's capped profile) then the channel caps. Returns the number of channel-capped arms."""
    n_cap = 0
    for gen in (0, 1, 2):
        for a in arms:
            if a.gen == gen:
                set_state(a, t)
        n_cap += apply_channel_caps(arms, gen, t, A)
    return n_cap


def unnecked_points(arms, t, A):
    """all spheres at time t with every root neck switched off (the geometry a weld test must see: a neck only
    widens gaps, and the necks are what the test decides). The skeleton's own arms, without the v4 emergence ramp:
    the tests see every newborn at its full size, a superset of what is drawn, so they stay conservative and the
    t = 1 crystal (caps, drops, necks) is v3's."""
    saved = [a.k_neck for a in arms]
    for a in arms:
        a.k_neck = 0.0
    try:
        return collect_points(arms, t, A, emerge=False)
    finally:
        for a, k in zip(arms, saved):
            a.k_neck = k


def sphere_tables(arms, owner):
    """per sphere: owning arm's parent index (-2 for a primary or the nucleus) and row, for vectorized exclusion masks."""
    n = len(arms)
    par_of = np.full(n + 1, -2, dtype=np.int32)
    row_of = np.full(n + 1, -1, dtype=np.int32)
    for a in arms:
        par_of[a.idx] = a.parent.idx if a.parent is not None else -2
        row_of[a.idx] = a.row
    return par_of[owner], row_of[owner]          # owner -1 (nucleus) reads the spare last slot


class SphereGrid:
    """uniform grid over sphere centers: query(lo, hi) -> indices of the spheres that may reach into the box."""

    def __init__(self, P, R, cell=0.06):
        self.cell = cell
        self.rmax = float(np.sort(R)[-2]) if len(R) > 1 else float(R.max())    # the nucleus alone is bigger
        self.pmin = P.min(0) - self.rmax
        keys = np.floor((P - self.pmin) / cell).astype(np.int64)
        self.shape = keys.max(0) + 1
        flat = (keys[:, 0] * self.shape[1] + keys[:, 1]) * self.shape[2] + keys[:, 2]
        self.order = np.argsort(flat, kind='stable')
        self.flat = flat[self.order]

    def query(self, lo, hi):
        lo = np.maximum(np.floor((lo - self.rmax - self.pmin) / self.cell).astype(np.int64), 0)
        hi = np.minimum(np.floor((hi + self.rmax - self.pmin) / self.cell).astype(np.int64), self.shape - 1)
        if (hi < lo).any():
            return np.empty(0, dtype=np.int64)
        out = []
        for i in range(lo[0], hi[0] + 1):
            for j in range(lo[1], hi[1] + 1):
                base = (i * self.shape[1] + j) * self.shape[2]
                a = np.searchsorted(self.flat, base + lo[2], 'left')
                b = np.searchsorted(self.flat, base + hi[2], 'right')
                if b > a:
                    out.append(self.order[a:b])
        return np.concatenate(out) if out else np.empty(0, dtype=np.int64)


def attached_mask(owner, sp_par, sp_row, a, all_siblings):
    """spheres of bodies `a` is attached to: itself, its parent, its children, and its siblings on the same parent
    (all of them, or only the perpendicular ones that meet it inside the parent's fillet)."""
    m = (owner == a.idx) | (owner == a.parent.idx) | (sp_par == a.idx)
    sib = sp_par == a.parent.idx
    if not all_siblings:
        sib &= sp_row != a.row
    return m | sib


def apply_neck_limits(arms, t, A):
    """Necks are limited by coalescence. v1 necked every side arm; where two neighbors of a row had already
    coalesced (bodies welded above the trunk) the two waists under the weld were a see-through tunnel, the pinholes
    along the trunk (at seed 7, t = 1: 141 of v1's 184 handles). A weld at or above the waist roofs the waist gap, so
    that gap must stay narrower than the closing can fill: with un-necked bodies gap0 apart and radii r_i, R_j, a
    neck depth k opens the waist gap to gap0 + (r_i + R_j) k, hence k <= (G0 - gap0) / (r_i + R_j) with
    G0 = closing diameter - 1.5 voxels (a deeply overlapped pair keeps a partial waist, a pair welded across an open
    gap keeps none); a pair not yet welded fades its necks in over WELD_FADE_VOXELS of approach, so a growth sequence
    never pops. Contacts below the waist (a low stub against the foot) roof nothing and do not count; perpendicular
    siblings on the same parent and the arm's own children are attached at the root and do not count either.
    Un-necked geometry at t. Returns the number of arms whose neck was reduced."""
    side = [a for a in arms if a.gen >= 1 and a.alive and a.k_neck > 0.0]
    if not side:
        return 0
    pts = unnecked_points(arms, t, A)
    P, R, owner = pts['pos'], pts['rad'], pts['arm']
    sp_par, sp_row = sphere_tables(arms, owner)
    weld_thr = 2.0 * A.fillet + 0.5 * A.voxel           # a gap this narrow may weld under the closing
    G0 = 2.0 * A.fillet - 1.5 * A.voxel                  # a gap this narrow is certainly filled by it
    fade = WELD_FADE_VOXELS * A.voxel
    n_cut = 0
    for a in side:
        idx_own = np.where(owner == a.idx)[0]
        if len(idx_own) == 0:
            continue
        s_o = (P[idx_own] - a.origin[None, :]) @ a.d
        rmax_root = root_rmax(a, t)
        zone = (s_o >= a.R_root) & (s_o <= a.R_root + NECK_ZONE * rmax_root)
        if not zone.any():
            continue
        p_z, r_z, s_z = P[idx_own][zone], R[idx_own][zone], s_o[zone]
        s_waist = a.R_root + NECK_POS * rmax_root
        mid = 0.5 * (p_z.min(0) + p_z.max(0))
        reach = 0.5 * np.linalg.norm(p_z.max(0) - p_z.min(0)) + float(r_z.max()) + weld_thr + fade
        near = ~attached_mask(owner, sp_par, sp_row, a, False) & (np.linalg.norm(P - mid[None, :], axis=1) - R <= reach)
        if not near.any():
            continue
        vec = P[near][None, :, :] - p_z[:, None, :]
        dist = np.linalg.norm(vec, axis=2)
        gap = dist - r_z[:, None] - R[near][None, :]
        s_contact = s_z[:, None] + r_z[:, None] * (vec @ a.d) / np.maximum(dist, 1e-12)   # height of the contact point
        gap = np.where(s_contact >= s_waist, gap, INF)
        if not np.isfinite(gap).any():
            continue
        # per neighboring body (owner), its closest approach to this arm's zone: for a parallel neighbor that is the
        # same-height pair whose gap the waist opens; pairs above or below it are farther and say nothing about it
        i_min = np.argmin(gap, axis=0)
        g_col = gap[i_min, np.arange(gap.shape[1])]
        rr_col = r_z[i_min] + R[near]
        own_col = owner[near]
        order = np.lexsort((g_col, own_col))
        first = np.ones(len(order), dtype=bool)
        first[1:] = own_col[order][1:] != own_col[order][:-1]
        sel = order[first]
        g_o, rr_o = g_col[sel], rr_col[sel]
        ok = np.isfinite(g_o)
        if not ok.any():
            continue
        g_o, rr_o = g_o[ok], rr_o[ok]
        k0 = a.k_neck
        k_plug = np.clip((G0 - g_o) / rr_o, 0.0, 1.0)              # depth the closing's plug still allows
        k_fade = k0 * np.clip((g_o - weld_thr) / fade, 0.0, 1.0)   # not welded yet: fade in with the approach
        k_new = float(min(k0, np.maximum(k_plug, k_fade).min()))
        if k_new < k0:
            a.k_neck = k_new
            n_cut += 1
    return n_cut


def update_states(arms, t, A):
    """arm states at time t: set_states (v1's per-arm state plus the channel caps), then the neck rule.
    Returns (channel-capped arms, neck-limited arms)."""
    n_cap = set_states(arms, t, A)
    return n_cap, apply_neck_limits(arms, t, A)


def nucleus_radius(A, t):
    return NUC_FACTOR * NUC_RMAX * A.tip_radius * math.cbrt(1.0 + max(t, 0.0) / NUC_TAU)


def make_rows(par, gen, arms, A, rng, L_final=None):
    """seed the four side-branch rows of `par` (state of `par` must be set at t=1; L_final is the parent length
    to seed along, its length at t=1 unless given). Secondaries (gen 1): exactly v1's per-row random sequence.
    Tertiaries (gen 2): one helix of stations along the host, consecutive stations a quarter turn apart
    (rows 0, 2, 1, 3 or the mirror image), TERT_SPACING / 4 apart with jitter, so each row is a comb with its own
    phase and no station is shared by two rows (v3 seeded the four rows independently: ~150 '+' whorls)."""
    rho_c = par.rho * (A.rho_ratio if gen == 1 else A.rho_ratio_tertiary)
    lam0 = A.lambda0 * par.rho * (1.0 if gen == 1 else TERT_SPACING)
    jitter = (0.8, 1.2) if gen == 1 else TERT_JITTER
    skip = 0.0 if gen == 1 else TERT_SKIP
    onset = A.onset * par.rho
    if L_final is None:
        L_final = par.L
    if par.gen == 0:
        s_min = 1.2 * nucleus_radius(A, 1.0)
    else:
        s_min = par.R_root + 2.5 * par.rho
    row_defs = [(par.e1, par.d, par.e2), (-par.e1, par.d, par.e2),
                (par.e2, par.d, par.e1), (-par.e2, par.d, par.e1)]
    per_row = None
    if gen == 2:
        per_row = [[], [], [], []]
        order = (0, 2, 1, 3) if rng.random() < 0.5 else (0, 3, 1, 2)
        k = int(rng.integers(0, 4))
        s = s_min + rng.uniform(0.0, 0.25 * lam0)
        while s < L_final - onset:
            if rng.random() >= skip:
                per_row[order[k % 4]].append(s)
            k += 1
            s += 0.25 * lam0 * rng.uniform(*jitter)
    for ri, (dc, ec1, ec2) in enumerate(row_defs):
        if gen == 1:                       # v1's draws, in v1's order (stations, then vigor, then caps, per row)
            s_list = []
            s = s_min + rng.uniform(0.0, lam0)
            while s < L_final - onset:
                s_list.append(s)
                s += lam0 * rng.uniform(*jitter)
        else:
            s_list = per_row[ri]
        s_list = [s for s in s_list if tip_reach_time(par, s + onset) < INF]   # never born at the parent's tip
        n = len(s_list)
        if n == 0:
            continue
        s_arr = np.array(s_list)
        vig = rng.random(n)
        d_dom = np.full(n, INF)
        for i in range(n):
            m = vig > vig[i]
            if m.any():
                d_dom[i] = np.abs(s_arr[m] - s_arr[i]).min()
        with np.errstate(over='ignore', invalid='ignore'):
            stop = A.coarsen_tau * ((2.0 * d_dom / lam0) ** 3 - 1.0)
        row_arms = []
        for i in range(n):
            if stop[i] <= 0.01:
                continue
            arm = Arm()
            arm.idx = len(arms)
            arm.gen = gen
            arm.parent = par
            arm.s_par = float(s_arr[i])
            arm.origin = par.origin + par.d * s_arr[i]
            arm.d = np.array(dc, dtype=np.float64)
            arm.e1 = np.array(ec1, dtype=np.float64)
            arm.e2 = np.array(ec2, dtype=np.float64)
            arm.birth = tip_reach_time(par, float(s_arr[i]) + onset)   # = v1's t_pass(s) + onset / V for a secondary
            arm.vigor = float(vig[i])
            arm.rho = rho_c
            arm.rmax0 = RMAX_BY_GEN[gen] * rho_c
            arm.r_floor = max(rho_c, R_FLOOR_VOXELS * A.voxel)
            arm.onset = onset
            arm.stop_age = float(stop[i])
            arm.row = ri
            if gen == 1:
                arm.V = A.speed_ratio * par.V * (0.8 + 0.4 * vig[i])
                arm.Lcap = float(s_arr[i] * rng.uniform(0.75, 0.9))    # diagonal plane with neighbour primary
                arm.delta_max = 0.20
                arm.neck = A.neck
                if arm.Lcap - radius_env_at(par, 1.0, arm.s_par) < CORE_MIN_PROT * rho_c:
                    arm.dropped = True      # next to the nucleus the space limit leaves a bump the coarsening
                    # would absorb (v3's jagged stubs of random height at the core); its draws are made, v1's
                    # sequence for the rest of the row is unchanged
            else:
                arm.V = 0.6 * par.V * (TERT_SPEED[0] + TERT_SPEED[1] * vig[i])
                if ri < 2:                 # in-plane: toward the neighboring secondary; clearance_pass sets the real limit
                    gap = par.gap_next if ri == 0 else par.gap_prev
                    arm.Lcap = 0.45 * gap
                else:                      # out of plane: diagonal with the next row, uneven
                    arm.Lcap = float(s_arr[i]) * rng.uniform(*TERT_OOP_CAP)
                arm.delta_max = 0.10
                arm.neck = 0.6 * A.neck
            par.children.append(arm)
            arms.append(arm)
            row_arms.append(arm)
        if gen == 1:
            longlived = [a for a in row_arms if a.stop_age >= 0.5]
            for a in row_arms:
                prev = [b.s_par for b in longlived if b.s_par < a.s_par - 1e-9]
                nxt = [b.s_par for b in longlived if b.s_par > a.s_par + 1e-9]
                a.gap_prev = a.s_par - max(prev) if prev else 2.0 * lam0
                a.gap_next = min(nxt) - a.s_par if nxt else 2.0 * lam0


def build_skeleton(A, rng):
    arms = []
    I = np.eye(3)
    for ax in range(3):
        for sg in (1.0, -1.0):
            arm = Arm()
            arm.idx = len(arms)
            arm.gen = 0
            arm.origin = np.zeros(3)
            arm.d = sg * I[ax]
            arm.e1 = I[(ax + 1) % 3].copy()
            arm.e2 = I[(ax + 2) % 3].copy()
            arm.birth = 0.0
            arm.V = A.arm_length * rng.uniform(0.96, 1.04)
            arm.rho = A.tip_radius
            arm.rmax0 = RMAX_BY_GEN[0] * A.tip_radius
            arm.r_floor = A.tip_radius
            arm.delta_max = 0.28
            arm.neck = 0.0
            arms.append(arm)
    set_states(arms, 1.0, A)
    for par in list(arms):
        make_rows(par, 1, arms, A, rng)
    set_states(arms, 1.0, A)
    secs = [a for a in arms if a.gen == 1]
    # tertiary hosts: every secondary that grew for at least TERT_HOST_MIN_STOP and protruded TERT_MIN_PROT tip
    # radii at its longest (a stunted one at its stop time; its tertiaries are seeded along that length and die with
    # the host's retreat), a random tertiary_density fraction of them
    n_host = 0
    for par in secs:
        if not par.alive or par.stop_age < TERT_HOST_MIN_STOP or par.w_now < TERT_HOST_MIN_BODY * par.rho:
            continue                     # a squeezed loser (channel-capped to a needle) does not branch
        t_stop = min(1.0, par.birth + par.stop_age)
        set_state(par, t_stop)
        L_stop, prot_max = par.L, par.L - par.R_root
        set_state(par, 1.0)
        if prot_max < TERT_MIN_PROT * par.rho:
            continue
        if rng.random() > A.tertiary_density:
            continue
        make_rows(par, 2, arms, A, rng, L_final=L_stop)
        n_host += 1
    if getattr(A, 'only_arms', ''):
        keep_subtrees(arms, A.only_arms)
    update_states(arms, 1.0, A)
    n_t = sum(1 for a in arms if a.gen == 2)
    if getattr(A, 'no_clearance', False):
        report = {}
    else:
        report = clearance_pass(arms, A)
        update_states(arms, 1.0, A)
    print('[skeleton] tertiaries seeded: %d on %d hosts; clearance (gen: seeded/capped/dropped): %s' % (
        n_t, n_host, json.dumps(report)))
    return arms


def keep_subtrees(arms, spec):
    """debug (--only-arms): keep the six trunks and only the side-arm subtrees named in spec, comma-separated:
    "p0" = every side arm of primary 0, "p0r1" = row 1 of primary 0, "p0r1s3" = the 4th seeded secondary of that
    row (with its tertiaries), "p0r1s3-7" = the 4th to 8th. Dropped arms already drew their random numbers, so the
    kept geometry is unchanged."""
    prim = [a for a in arms if a.gen == 0]
    keep = set()
    for item in spec.split(','):
        m = re.match(r'p(\d+)(?:r(\d+))?(?:s(\d+)(?:-(\d+))?)?$', item.strip())
        if not m:
            raise SystemExit('bad --only-arms item: %r' % item)
        p = prim[int(m.group(1))]
        secs = sorted([c for c in p.children if m.group(2) is None or c.row == int(m.group(2))], key=lambda c: c.s_par)
        if m.group(3) is not None:
            lo = int(m.group(3))
            hi = int(m.group(4)) if m.group(4) is not None else lo
            secs = secs[lo:hi + 1]
        for c in secs:
            keep.add(c.idx)
            keep.update(g.idx for g in c.children)
    for a in arms:
        if a.gen >= 1 and a.idx not in keep:
            a.dropped = True


def dump_arms(arms, path):
    rows = []
    for a in arms:
        rows.append({'idx': a.idx, 'gen': a.gen, 'parent': None if a.parent is None else a.parent.idx, 'row': a.row,
                     's_par': round(a.s_par, 5), 'd': _l(a.d), 'birth': round(a.birth, 4), 'age': round(a.age, 4),
                     'stop_age': None if a.stop_age >= INF else round(a.stop_age, 4), 'vigor': round(a.vigor, 4),
                     'L': round(a.L, 5), 'R_root': round(a.R_root, 5), 'protrusion': round(a.L - a.R_root, 5),
                     'Lcap': None if a.Lcap >= INF else round(a.Lcap, 5), 'w_now': round(a.w_now, 5),
                     'k_neck': round(a.k_neck, 4), 'alive': bool(a.alive), 'dropped': bool(a.dropped),
                     'n_children': len(a.children)})
    with open(path, 'w') as fh:
        json.dump(rows, fh, indent=0)
    print('[arms] ->', path)


def clearance_pass(arms, A):
    """No arm may weld to a body it is not attached to. Such a weld closes a loop of solid around empty space, one
    handle each: the tips of two secondaries from perpendicular primaries meeting on the diagonal plane (a loop
    through both trunks and the nucleus), an in-plane tertiary reaching the neighboring secondary of its host's
    row or hugging the trunk, a tertiary meeting another. Every secondary and then every tertiary is walked outward
    from its root and capped at the last station that still clears every foreign sphere by max(CLEAR_RADII x its own
    local radius, the closing diameter); one left with less than 3 rho of room is dropped. The test is run at every
    time in CLEAR_TIMES, the arm as it is then against the un-necked world as it is then (a growing arm is longest
    and fattest at t = 1, a stunted one is longest at its stop time and widest while it remelts, an arm dead by t = 1
    still existed before); the cap is the tightest over the times and, being a cap on the growth law, bounds the arm
    at every t. Within a generation the more vigorous arm settles first and the weaker one of a colliding pair yields.
    Not foreign: the parent, the arm's own children and its siblings on the same parent (same-row neighbors coalesce
    on purpose, that is v1's look, and apply_neck_limits keeps their roots tunnel-free; perpendicular ones meet inside
    the parent's fillet). In the root zone (the first body radius above the parent) anything touching a root sphere
    would be bridged to the parent by this arm (a short in-plane tertiary reaching the next secondary across an open
    slot, or roofing the trunk-host corner it sits just above: the slot or groove below it is a tunnel), so there the
    criterion is 'could it weld' and a hit drops the arm. The one exception is a secondary's root against the nucleus:
    the nucleus surface a root sphere seems to approach is buried inside the trunk. The caller refreshes the states."""
    n_arm = len(arms) + 1
    gen_of = np.full(n_arm, -1, dtype=np.int32)          # index -1 (the nucleus) maps to the last slot
    for a in arms:
        gen_of[a.idx] = a.gen

    def build_worlds():
        worlds = []
        for tg in CLEAR_TIMES:
            set_states(arms, tg, A)
            pts = unnecked_points(arms, tg, A)
            owner = pts['arm']
            rr = np.zeros(n_arm)                   # parent-surface radius and body radius of every arm at this time,
            ww = np.zeros(n_arm)                   # read back per sphere through its owner
            for a in arms:
                rr[a.idx], ww[a.idx] = a.R_root, a.w_now
            sp_par, sp_row = sphere_tables(arms, owner)
            by_owner = {}
            for i in np.argsort(owner, kind='stable'):
                by_owner.setdefault(int(owner[i]), []).append(int(i))
            worlds.append(dict(t=tg, P=pts['pos'], R=pts['rad'], owner=owner, root_r=rr[owner], body_w=ww[owner],
                               sp_par=sp_par, sp_row=sp_row, gen=gen_of[owner], grid=SphereGrid(pts['pos'], pts['rad']),
                               by_owner={k: np.array(v) for k, v in by_owner.items()}))
        return worlds

    need_root = 2.0 * A.fillet + 1.5 * A.voxel          # a root sphere must not be weldable to a foreign body
    c_min = 2.0 * A.fillet + 2.0 * A.voxel + 0.002      # a body clears the closing AND the neck rule's fade band
    report = {}
    for gen in (1, 2):
        worlds = build_worlds()                          # rebuilt per generation: the caps of gen 1 shorten the
        for W in worlds:                                 # bodies gen 2 is tested against (v3 tested against the
            W['active'] = W['gen'] < gen                 # uncapped ones); older generations active, peers join once settled
        seeded = capped = dropped = dropped_root = 0
        root_hits = {}
        present = [x for x in arms if x.gen == gen and not x.dropped and any(x.idx in W['by_owner'] for W in worlds)]
        for a in sorted(present, key=lambda x: -x.vigor):
            seeded += 1
            gp = -1 if a.gen == 1 else None            # root-zone exemption: the nucleus for a secondary, nothing else
            new_cap = None
            r_base = 0.0
            hit_root = False
            for W in worlds:
                idx_own = W['by_owner'].get(a.idx)
                if idx_own is None:
                    continue
                P, R, owner = W['P'], W['R'], W['owner']
                s_o = (P[idx_own] - a.origin[None, :]) @ a.d
                r_o = R[idx_own]
                rr = W['root_r'][idx_own]
                r_base = max(r_base, float(rr.max()))
                # a sphere centered below the parent surface counts only by the cap it pokes out (a newborn's dome
                # is all such spheres, wider than the parent is deep there): the cap of height p sits inside the ball
                # of its own base radius sqrt(2 r p - p^2) centered at the surface point, so test that ball instead
                buried = s_o < rr
                prot = s_o + r_o - rr
                above = np.where(buried, prot > 0.5 * A.voxel, True)
                if not above.any():
                    continue
                s_e = np.where(buried, rr, s_o)
                r_e = np.where(buried, np.sqrt(np.maximum(2.0 * r_o * prot - prot * prot, 0.0)), r_o)
                p_e = P[idx_own] + a.d[None, :] * (s_e - s_o)[:, None]
                s_o = s_e
                p_a = p_e[above]
                r_a = r_e[above]
                pad = float(r_a.max()) + c_min
                cand = W['grid'].query(p_a.min(0) - pad, p_a.max(0) + pad)
                if len(cand):
                    cand = cand[W['active'][cand] & ~attached_mask(owner[cand], W['sp_par'][cand], W['sp_row'][cand], a, True)]
                if not len(cand):
                    continue
                order = np.argsort(s_o[above])
                s_t = s_o[above][order]
                p_t = p_a[order]
                r_t = r_a[order]
                zone_top = (W['root_r'][idx_own] + CLEAR_ROOT_FREE * W['body_w'][idx_own])[above][order]
                d = np.linalg.norm(p_t[:, None, :] - P[cand][None, :, :], axis=2)
                clear = d - R[cand][None, :] - r_t[:, None]
                root_zone = s_t < zone_top
                if gp is not None and root_zone.any():
                    clear[np.ix_(root_zone, owner[cand] == gp)] = INF
                need = np.where(root_zone, need_root, np.maximum(CLEAR_RADII * r_t, c_min))
                bad = clear.min(axis=1) < need
                if not bad.any():
                    continue
                i_bad = int(np.argmax(bad))
                cap_here = float(s_t[i_bad - 1]) if (i_bad > 0 and not root_zone[i_bad]) else -INF
                if root_zone[i_bad]:
                    hit_root = True
                    j = int(np.argmin(clear[i_bad]))
                    o = int(owner[cand][j])
                    kind = 'nucleus' if o < 0 else ('trunk' if arms[o].gen == 0 else
                                                     'uncle' if (a.parent.parent is not None and arms[o].parent is a.parent.parent
                                                                 and arms[o].row == a.parent.row) else
                                                     'uncle_other_row' if (a.parent.parent is not None and arms[o].parent is a.parent.parent)
                                                     else 'gen%d' % arms[o].gen)
                    root_hits[kind] = root_hits.get(kind, 0) + 1
                new_cap = cap_here if new_cap is None else min(new_cap, cap_here)
            if new_cap is not None:
                if new_cap - r_base < CLEAR_MIN_PROT[gen - 1] * a.rho:
                    a.dropped = True
                    a.alive = False
                    for c in a.children:
                        c.dropped = True
                        c.alive = False
                    dropped += 1
                    dropped_root += int(hit_root)
                    continue
                a.Lcap = min(a.Lcap, new_cap)
                capped += 1
                if a.children:                   # the cap moves the host's tip: side branches it no longer reaches
                    set_state(a, 1.0)            # onset tip radii before t = 1 are never born (states are at t = 1
                    for c in a.children:         # here, CLEAR_TIMES ends with 1.0)
                        c.birth = tip_reach_time(a, c.s_par + c.onset)
                        if c.birth >= 1.0:
                            c.dropped = True
                            c.alive = False
            for W in worlds:
                idx_own = W['by_owner'].get(a.idx)
                if idx_own is None:
                    continue
                if new_cap is None:
                    W['active'][idx_own] = True
                else:
                    s_o = (W['P'][idx_own] - a.origin[None, :]) @ a.d
                    W['active'][idx_own[s_o <= a.Lcap + 1e-9]] = True
        report['gen%d' % gen] = {'seeded': seeded, 'capped': capped, 'dropped': dropped, 'dropped_at_root': dropped_root,
                                 'root_hits_by_body': root_hits}
    return report


# ----------------------------------------------------------------------------------------------
# skeleton -> spheres
# ----------------------------------------------------------------------------------------------
def sample_arm(arm, t, voxel, out, emerge=True):
    """the arm's spheres at time t for a `voxel` grid, appended to `out`. emerge=True (the drawn crystal) hangs the
    profile from the drawn tip (emerge_shift); False from the skeleton's tip (the geometry the rules test)."""
    if not arm.alive:
        return
    L = arm.L - (emerge_shift(arm) if emerge else 0.0)
    rho = arm.rho
    h = max(0.5 * voxel, 0.3 * rho)
    age = max(t - arm.birth, 0.0)
    rho_eff = effective_rho(arm, age)
    c0 = 0.5 * rho_eff + 0.25 * h
    if L <= c0:           # v4.1: a short drawn arm keeps its one station (v4 returned while L - c0 <= h, so a blunt
        return            # newborn on a thin host drew nothing until its apex was ~1 rho out, then appeared at once)
    c = np.arange(c0, L, h)
    s = L - c
    if arm.gen > 0:
        keep = s >= arm.R_root - 2.0 * rho          # drop stations deep inside the parent
        c = c[keep]
        s = s[keep]
    if len(c) == 0:
        return
    r, delta, tb = arm_profile(arm, t, c, shift=True, L=L)
    ok = r > 0.3 * voxel
    c, s, r, delta, tb = c[ok], s[ok], r[ok], delta[ok], tb[ok]
    if len(c) == 0:
        return
    pos = arm.origin[None, :] + s[:, None] * arm.d[None, :]
    lobed = delta > 0.3 * voxel
    g = np.full(len(c), arm.gen, dtype=np.int32)
    who = np.full(len(c), arm.idx, dtype=np.int32)
    if (~lobed).any():
        out['pos'].append(pos[~lobed])
        out['rad'].append(r[~lobed])
        out['birth'].append(tb[~lobed])
        out['gen'].append(g[~lobed])
        out['arm'].append(who[~lobed])
    if lobed.any():
        for e in (arm.e1, -arm.e1, arm.e2, -arm.e2):
            out['pos'].append(pos[lobed] + delta[lobed, None] * e[None, :])
            out['rad'].append(r[lobed] - delta[lobed])
            out['birth'].append(tb[lobed])
            out['gen'].append(g[lobed])
            out['arm'].append(who[lobed])


def collect_points(arms, t, A, emerge=True):
    """all spheres at time t: position, radius, station birth, generation, owning arm index (-1 = nucleus).
    emerge=True: the drawn crystal (v4 emergence ramp); False: the skeleton's arms (unnecked_points, the tests)."""
    out = {'pos': [], 'rad': [], 'birth': [], 'gen': [], 'arm': []}
    out['pos'].append(np.zeros((1, 3)))
    out['rad'].append(np.array([nucleus_radius(A, t)]))
    out['birth'].append(np.array([0.0]))
    out['gen'].append(np.array([-1], dtype=np.int32))
    out['arm'].append(np.array([-1], dtype=np.int32))
    for a in arms:
        sample_arm(a, t, A.voxel, out, emerge=emerge)
    return {k: np.concatenate(v) for k, v in out.items()}


# ----------------------------------------------------------------------------------------------
# features for callouts
# ----------------------------------------------------------------------------------------------
def _l(v):
    return [round(float(x), 5) for x in np.asarray(v).ravel()]


def extract_features(arms, t, A, seed):
    """All callouts live on the +x primary arm, the one the close-up camera visits (VIEW_SPECS['close']
    looks from (+0.25, -0.30, +1.0): the -y row (row 1) and the +z row (row 2) face the camera).
    Same JSON schema as the v2 generator (render_sequence.py and look.py read it)."""
    prim = [a for a in arms if a.gen == 0]
    px = prim[0]
    feats = {
        't': t, 'seed': seed,
        'units': 'model units; primary arm length ~ arm_length at t=1',
        'callout_arm': '+x primary (direction [1,0,0]); close-up camera from (+0.25,-0.30,+1.0), so rows 1 (-y) '
                       'and 2 (+z) face it; lambda2 pair and necked root from row 1, tertiary on a row-2 secondary',
        'centre': [0.0, 0.0, 0.0],
        'nucleus_radius': round(nucleus_radius(A, t), 5),
        'tips': [{'direction': _l(a.d), 'position': _l(a.origin + a.d * a.L), 'length': round(a.L, 5),
                  'tip_radius': a.rho} for a in prim],
        'primary_axis': {'root': [0.0, 0.0, 0.0], 'direction': _l(px.d), 'tip': _l(px.origin + px.d * px.L),
                         'length': round(px.L, 5)},
    }
    # lambda2: two adjacent live, still-growing secondaries of the +x arm's -y row nearest mid-arm (fall back to
    # any row); the callout should show the coarsened spacing, not a stub
    def live_row(ri):
        return sorted([c for c in px.children if c.row == ri and c.alive and c.age < c.stop_age
                       and (c.L - c.R_root) > 4.0 * c.rho], key=lambda c: c.s_par)

    def channel(c1, c2):
        """(narrowest gap between the two envelopes above the zipped bases, radii of each arm there): the liquid
        channel the callout should show open; measured at matched heights above the parent surface."""
        short = min(c1.L - c1.R_root, c2.L - c2.R_root)
        hs = np.linspace(0.35 * short, short, 24)
        r1 = arm_profile(c1, t, c1.L - (c1.R_root + hs), shift=False)[0]
        r2 = arm_profile(c2, t, c2.L - (c2.R_root + hs), shift=False)[0]
        gap = abs(c2.s_par - c1.s_par) - r1 - r2
        return float(gap.min()), float(r1.max()), float(r2.max())

    ch_open = 2.0 * A.fillet + CHANNEL_VOXELS_BY_GEN[1] * A.voxel
    best = None
    for ri in (1, 0, 2, 3):
        row = live_row(ri)
        pairs = [(c1, c2) for c1, c2 in zip(row[:-1], row[1:]) if 0.3 * px.L < 0.5 * (c1.s_par + c2.s_par) < 0.75 * px.L]
        if not pairs:
            pairs = list(zip(row[:-1], row[1:]))
        if not pairs:
            continue
        med = float(np.median([c2.s_par - c1.s_par for c1, c2 in pairs]))   # typical coarsened spacing mid-arm
        for c1, c2 in pairs:
            gap, _, _ = channel(c1, c2)
            score = abs((c2.s_par - c1.s_par) - med) + (0.0 if gap >= ch_open else 1.0)   # an open channel first
            if best is None or score < best[0]:
                best = (score, c1, c2, ri)
        if best is not None:
            break
    if best is not None:
        _, c1, c2, ri = best
        gap, rc1, rc2 = channel(c1, c2)
        feats['lambda2_pair'] = {
            'row': ri, 'row_direction': _l(c1.d), 'direction': _l(c1.d),
            'root_a': _l(c1.origin + c1.d * c1.R_root), 'tip_a': _l(c1.origin + c1.d * c1.L),
            'root_b': _l(c2.origin + c2.d * c2.R_root), 'tip_b': _l(c2.origin + c2.d * c2.L),
            'spacing': round(abs(c2.s_par - c1.s_par), 5),
            'distance_from_centre': [round(c1.s_par, 5), round(c2.s_par, 5)],
            'body_radius_a': round(c1.w_now, 5), 'body_radius_b': round(c2.w_now, 5),   # at the (zipped) root
            'channel_radius_a': round(rc1, 5), 'channel_radius_b': round(rc2, 5),       # above the coalesced base
            'channel_gap_min': round(gap, 5), 'channel_open': bool(gap >= ch_open),
        }
    # tertiary: the longest living, still-growing tertiary on the +x arm, preferring a host in row 2 (seen in
    # profile from above)
    terts = [g for c in px.children for g in c.children if g.alive and g.age < g.stop_age]
    if terts:
        pref = [g for g in terts if g.parent.row == 2] or terts
        g = max(pref, key=lambda g: g.L - g.R_root)
        feats['tertiary'] = {
            'root': _l(g.origin + g.d * g.R_root), 'tip': _l(g.origin + g.d * g.L), 'direction': _l(g.d),
            'length': round(g.L - g.R_root, 5), 'tip_radius': g.rho, 'host_row': g.parent.row,
            'parent_secondary_root': _l(g.parent.origin + g.parent.d * g.parent.R_root),
            'parent_secondary_tip': _l(g.parent.origin + g.parent.d * g.parent.L),
        }
    # necked root: the +x arm secondary with the deepest waist (row 1 preferred, then any)
    best = None
    for ri in (1, 0, 2, 3):
        for c in px.children:
            if c.row != ri or not (c.alive and (c.L - c.R_root) > 5.0 * c.rho and c.k_neck > 0.0):
                continue
            s = np.linspace(c.R_root, c.L, 200)
            r, _, _ = arm_profile(c, t, c.L - s, shift=False)
            i_neck = int(np.argmin(r[: len(r) // 2]))
            r_body = float(r[i_neck:].max())
            ratio = float(r[i_neck]) / r_body if r_body > 0 else 1.0
            if best is None or ratio < best[0]:
                best = (ratio, c, float(s[i_neck]), float(r[i_neck]), r_body)
        if best is not None and best[0] < 0.8:
            break
    if best is not None:
        ratio, c, s_neck, r_neck, r_body = best
        feats['necked_root'] = {
            'row': c.row,
            'root_on_trunk': _l(c.origin + c.d * c.R_root), 'neck_point': _l(c.origin + c.d * s_neck),
            'tip': _l(c.origin + c.d * c.L), 'direction': _l(c.d),
            'neck_radius': round(r_neck, 5), 'body_radius': round(r_body, 5), 'neck_to_body_ratio': round(ratio, 4),
            'arm_age': round(c.age, 4),
        }
    alive = [a for a in arms if a.alive]
    tl = [a.L - a.R_root for a in alive if a.gen == 2]
    long_sec = [a for a in alive if a.gen == 1 and (a.L - a.R_root) >= TERT_MIN_PROT * a.rho]
    feats['counts'] = {
        'arms_total_in_skeleton': len(arms),
        'dropped_by_clearance': sum(1 for a in arms if a.dropped),
        'alive_primary': sum(1 for a in alive if a.gen == 0),
        'alive_secondary': sum(1 for a in alive if a.gen == 1),
        'alive_secondary_growing': sum(1 for a in alive if a.gen == 1 and a.age < a.stop_age),
        'alive_tertiary': sum(1 for a in alive if a.gen == 2),
        'alive_tertiary_growing': sum(1 for a in alive if a.gen == 2 and a.age < a.stop_age),
        'alive_tertiary_in_plane': sum(1 for a in alive if a.gen == 2 and a.row < 2),
        'alive_tertiary_out_of_plane': sum(1 for a in alive if a.gen == 2 and a.row >= 2),
        'tertiary_hosts': len({a.parent.idx for a in alive if a.gen == 2}),
        'long_secondaries': len(long_sec),
        'long_secondaries_with_tertiaries': sum(1 for a in long_sec if any(g.alive for g in a.children)),
        'necked_secondaries': sum(1 for a in alive if a.gen == 1 and a.k_neck > 0.05),
        'channel_capped_secondaries': sum(1 for a in alive if a.gen == 1 and a.w_now < a.w_free - 1e-6),
        'channel_capped_tertiaries': sum(1 for a in alive if a.gen == 2 and a.w_now < a.w_free - 1e-6),
    }
    if tl:
        tl = np.array(tl)
        feats['tertiary_length'] = {'min': round(float(tl.min()), 5), 'median': round(float(np.median(tl)), 5),
                                    'max': round(float(tl.max()), 5), 'cv': round(float(tl.std() / tl.mean()), 4)}
    return feats


# ----------------------------------------------------------------------------------------------
# Blender: points -> SDF -> closing -> mesh (+age attribute)
# ----------------------------------------------------------------------------------------------
def sock(node, name, kind, inputs=True):
    coll = node.inputs if inputs else node.outputs
    for s in coll:
        if s.name == name and s.type == kind:
            return s
    for s in coll:
        if s.name == name:
            return s
    raise KeyError(name)


def build_gn_tree(voxel, fillet, t, opening=0.0):
    """points (rad, birth) -> union of spheres dilated by `fillet` -> mesh -> SDF -> mesh at -(fillet + opening)
    (the closing's erosion and the opening's erosion in one step) -> SDF -> mesh at +opening (the opening's
    dilation) -> birth / age attributes sampled from the nearest sphere."""
    ng = bpy.data.node_groups.new('DendriteSDF', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, Lk = ng.nodes, ng.links
    n_in = N.new('NodeGroupInput')
    n_out = N.new('NodeGroupOutput')
    m2p = N.new('GeometryNodeMeshToPoints')
    m2p.mode = 'VERTICES'
    Lk.new(n_in.outputs['Geometry'], m2p.inputs['Mesh'])
    a_rad = N.new('GeometryNodeInputNamedAttribute')
    a_rad.data_type = 'FLOAT'
    a_rad.inputs['Name'].default_value = 'rad'
    a_birth = N.new('GeometryNodeInputNamedAttribute')
    a_birth.data_type = 'FLOAT'
    a_birth.inputs['Name'].default_value = 'birth'
    add = N.new('ShaderNodeMath')
    add.operation = 'ADD'
    add.inputs[1].default_value = fillet
    Lk.new(a_rad.outputs['Attribute'], add.inputs[0])
    p2s = N.new('GeometryNodePointsToSDFGrid')
    p2s.inputs['Voxel Size'].default_value = voxel
    Lk.new(m2p.outputs['Points'], p2s.inputs['Points'])
    Lk.new(add.outputs['Value'], p2s.inputs['Radius'])
    g2m1 = N.new('GeometryNodeGridToMesh')
    g2m1.inputs['Threshold'].default_value = 0.0
    g2m1.inputs['Adaptivity'].default_value = 0.0
    Lk.new(p2s.outputs['SDF Grid'], g2m1.inputs['Grid'])
    mesh_out = g2m1.outputs['Mesh']
    if fillet > 0.0 or opening > 0.0:
        m2s = N.new('GeometryNodeMeshToSDFGrid')
        m2s.inputs['Voxel Size'].default_value = voxel
        m2s.inputs['Band Width'].default_value = int(math.ceil((fillet + opening) / voxel)) + 3
        Lk.new(mesh_out, m2s.inputs['Mesh'])
        g2m2 = N.new('GeometryNodeGridToMesh')
        g2m2.inputs['Threshold'].default_value = -(fillet + opening)
        g2m2.inputs['Adaptivity'].default_value = 0.0
        Lk.new(m2s.outputs['SDF Grid'], g2m2.inputs['Grid'])
        mesh_out = g2m2.outputs['Mesh']
    if opening > 0.0:
        m2s2 = N.new('GeometryNodeMeshToSDFGrid')
        m2s2.inputs['Voxel Size'].default_value = voxel
        m2s2.inputs['Band Width'].default_value = int(math.ceil(opening / voxel)) + 3
        Lk.new(mesh_out, m2s2.inputs['Mesh'])
        g2m3 = N.new('GeometryNodeGridToMesh')
        g2m3.inputs['Threshold'].default_value = opening
        g2m3.inputs['Adaptivity'].default_value = 0.0
        Lk.new(m2s2.outputs['SDF Grid'], g2m3.inputs['Grid'])
        mesh_out = g2m3.outputs['Mesh']
    pos = N.new('GeometryNodeInputPosition')
    near = N.new('GeometryNodeSampleNearest')
    near.domain = 'POINT'
    Lk.new(m2p.outputs['Points'], near.inputs['Geometry'])
    Lk.new(pos.outputs['Position'], near.inputs['Sample Position'])
    sidx = N.new('GeometryNodeSampleIndex')
    sidx.data_type = 'FLOAT'
    sidx.domain = 'POINT'
    Lk.new(m2p.outputs['Points'], sidx.inputs['Geometry'])
    Lk.new(a_birth.outputs['Attribute'], sock(sidx, 'Value', 'VALUE'))
    Lk.new(near.outputs['Index'], sidx.inputs['Index'])
    sub = N.new('ShaderNodeMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[0].default_value = t
    Lk.new(sock(sidx, 'Value', 'VALUE', False), sub.inputs[1])
    st1 = N.new('GeometryNodeStoreNamedAttribute')
    st1.data_type = 'FLOAT'
    st1.domain = 'POINT'
    st1.inputs['Name'].default_value = 'birth'
    Lk.new(mesh_out, st1.inputs['Geometry'])
    Lk.new(sock(sidx, 'Value', 'VALUE', False), sock(st1, 'Value', 'VALUE'))
    st2 = N.new('GeometryNodeStoreNamedAttribute')
    st2.data_type = 'FLOAT'
    st2.domain = 'POINT'
    st2.inputs['Name'].default_value = 'age'
    Lk.new(st1.outputs['Geometry'], st2.inputs['Geometry'])
    Lk.new(sub.outputs['Value'], sock(st2, 'Value', 'VALUE'))
    Lk.new(st2.outputs['Geometry'], n_out.inputs['Geometry'])
    return ng


def make_skeleton_object(pts):
    me = bpy.data.meshes.new('DendriteSkeleton')
    n = len(pts['rad'])
    me.vertices.add(n)
    me.vertices.foreach_set('co', pts['pos'].astype(np.float32).ravel())
    for name, arr, kind in (('rad', pts['rad'], 'FLOAT'), ('birth', pts['birth'], 'FLOAT'), ('gen', pts['gen'], 'INT')):
        at = me.attributes.new(name, kind, 'POINT')
        at.data.foreach_set('value', arr.astype(np.float32 if kind == 'FLOAT' else np.int32))
    me.update()
    ob = bpy.data.objects.new('DendriteSkeleton', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def evaluated_mesh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    return bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)


def connected_components(nv, edges):
    """number of connected components of the vertex graph (vectorized hook-and-jump union-find)."""
    parent = np.arange(nv, dtype=np.int64)
    u, v = edges[:, 0].astype(np.int64), edges[:, 1].astype(np.int64)
    for _ in range(200):
        pu, pv = parent[u], parent[v]
        m = pu != pv
        if not m.any():
            break
        lo = np.minimum(pu[m], pv[m])
        hi = np.maximum(pu[m], pv[m])
        np.minimum.at(parent, hi, lo)
        while True:                                   # pointer jumping until every vertex points at a root
            gp = parent[parent]
            if np.array_equal(gp, parent):
                break
            parent = gp
    roots, counts = np.unique(parent, return_counts=True)
    return len(roots), np.sort(counts)[::-1]


def connected_component_labels(nv, edges):
    """root label per vertex (same union-find as connected_components)."""
    parent = np.arange(nv, dtype=np.int64)
    u, v = edges[:, 0].astype(np.int64), edges[:, 1].astype(np.int64)
    for _ in range(200):
        pu, pv = parent[u], parent[v]
        m = pu != pv
        if not m.any():
            break
        lo = np.minimum(pu[m], pv[m])
        hi = np.maximum(pu[m], pv[m])
        np.minimum.at(parent, hi, lo)
        while True:
            gp = parent[parent]
            if np.array_equal(gp, parent):
                break
            parent = gp
    return parent


def mesh_topology(me, co=None):
    """watertightness, Euler characteristic, components, genus. Genus of one closed surface = (2 - chi)/2.
    With `co` (vertex coords) the smaller components are located (centroid, extent) for debugging."""
    nv, nf, ne = len(me.vertices), len(me.polygons), len(me.edges)
    loops_edge = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get('edge_index', loops_edge)
    cnt = np.bincount(loops_edge, minlength=ne)
    boundary = int(np.count_nonzero(cnt == 1))
    nonmanifold = int(np.count_nonzero(cnt > 2))
    wire = int(np.count_nonzero(cnt == 0))
    ev = np.empty(ne * 2, dtype=np.int32)
    me.edges.foreach_get('vertices', ev)
    labels = connected_component_labels(nv, ev.reshape(-1, 2))
    roots, counts = np.unique(labels, return_counts=True)
    ncomp = len(roots)
    sizes = np.sort(counts)[::-1]
    chi = nv - ne + nf
    genus_total = (2 * ncomp - chi) / 2.0
    ok = (boundary == 0 and nonmanifold == 0 and wire == 0 and ncomp == 1 and chi == 2)
    out = {
        'vertices': nv, 'edges': ne, 'faces': nf, 'euler_characteristic': chi,
        'components': ncomp, 'component_sizes_top5': [int(x) for x in sizes[:5]],
        'genus_total': genus_total, 'through_holes': int(round(genus_total)) if ncomp == 1 else None,
        'boundary_edges': boundary, 'nonmanifold_edges': nonmanifold, 'wire_edges': wire,
        'watertight': boundary == 0 and nonmanifold == 0 and wire == 0,
        'single_closed_genus0_surface': ok,
    }
    if co is not None and ncomp > 1:
        big = roots[np.argmax(counts)]
        small = []
        for r, n in sorted(zip(roots, counts), key=lambda x: x[1]):
            if r == big or len(small) >= 5:
                continue
            c = co[labels == r]
            small.append({'vertices': int(n), 'centroid': _l(c.mean(0)), 'extent': _l(c.max(0) - c.min(0))})
        out['small_components'] = small
    return out


def mesh_bbox(me):
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    return co, {'bbox_min': _l(co.min(0)), 'bbox_max': _l(co.max(0))}


def trunk_cross_sections(co, px, n_bins=36):
    """fourfold check on the +x trunk: minimum radius per azimuth bin in thin slabs along the arm
    (the minimum rejects side branches, leaving the trunk surface). Ratio ridge/diagonal > 1 means the
    cross-section has its lobes along <100>; ~1 at the tip means the tip is round."""
    out = []
    for frac in (0.05, 0.15, 0.4, 0.7):
        x0 = px.L * (1.0 - frac)
        m = np.abs(co[:, 0] - x0) < 0.003
        if m.sum() < 50:
            continue
        y, z = co[m, 1], co[m, 2]
        rad = np.sqrt(y * y + z * z)
        ang = np.mod(np.degrees(np.arctan2(z, y)), 360.0)
        b = (ang / (360.0 / n_bins)).astype(int) % n_bins
        rmin = np.full(n_bins, np.nan)
        for i in range(n_bins):
            if (b == i).any():
                rmin[i] = rad[b == i].min()
        centers = (np.arange(n_bins) + 0.5) * (360.0 / n_bins)
        ridge = np.nanmean(rmin[np.minimum(np.mod(centers, 90.0), 90.0 - np.mod(centers, 90.0)) < 12.0])
        diag = np.nanmean(rmin[np.abs(np.mod(centers, 90.0) - 45.0) < 12.0])
        out.append({'distance_behind_tip': round(px.L * frac, 4), 'r_ridge': round(float(ridge), 5),
                    'r_diagonal': round(float(diag), 5), 'ridge_over_diagonal': round(float(ridge / diag), 4)})
    return out


def make_material(age_tint, t):
    mat = bpy.data.materials.new('DendriteClay' if not age_tint else 'DendriteAge')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.72, 0.72, 0.72, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.55
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.35
    if age_tint:
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = 'age'
        div = nt.nodes.new('ShaderNodeMath')
        div.operation = 'DIVIDE'
        div.inputs[1].default_value = max(t, 1e-6)
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (1.0, 0.45, 0.10, 1.0)    # newest surface: warm
        ramp.color_ramp.elements[1].color = (0.35, 0.42, 0.55, 1.0)   # oldest: cool grey-blue
        nt.links.new(attr.outputs['Fac'], div.inputs[0])
        nt.links.new(div.outputs['Value'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


# ----------------------------------------------------------------------------------------------
# camera, lights, render
# ----------------------------------------------------------------------------------------------
def camera_basis(view_from, up_hint):
    f = -np.asarray(view_from, dtype=np.float64)
    f /= np.linalg.norm(f)
    up = np.asarray(up_hint, dtype=np.float64)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return f, r, u


def place_camera(cam_ob, f, r, u, target, dist):
    loc = np.asarray(target) - f * dist
    rot = Matrix((Vector(r), Vector(u), Vector(-f))).transposed().to_4x4()
    cam_ob.matrix_world = Matrix.Translation(Vector(loc)) @ rot


def fit_distance(points, f, r, u, target, lens, fill):
    p = np.asarray(points) - np.asarray(target)[None, :]
    a = np.abs(p @ r)
    b = np.abs(p @ u)
    c = p @ f
    tan_half = 18.0 / lens
    need = np.maximum(a, b) / (fill * tan_half) - c
    return float(need.max())


def make_area_light(name, loc, target, size, energy):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = 'DISK'
    ld.size = size
    ld.energy = energy
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob['base_energy'] = energy
    ob['base_size'] = size
    ob.location = Vector(loc)
    direction = Vector(np.asarray(target) - np.asarray(loc))
    ob.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return ob


def place_lights(lights, f, r, u, target, R):
    """three-point rig in camera space; power scales with distance^2 so exposure is size-independent."""
    key, fill, rim = lights
    dist = 4.0 * R
    def at(v):
        v = np.asarray(v, dtype=np.float64)
        return np.asarray(target) + v / np.linalg.norm(v) * dist
    for ob, v in ((key, -f * 1.0 - r * 0.8 + u * 0.9), (fill, -f * 1.0 + r * 1.1 + u * 0.15),
                  (rim, f * 0.9 + r * 0.4 + u * 1.0)):
        loc = at(v)
        ob.location = Vector(loc)
        ob.rotation_euler = Vector(np.asarray(target) - loc).to_track_quat('-Z', 'Y').to_euler()
        ob.data.energy = ob['base_energy'] * (dist / 4.4) ** 2
        ob.data.size = ob['base_size'] * (dist / 4.4)


def setup_render(A):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    cyc = scene.cycles
    cyc.samples = A.samples
    cyc.use_adaptive_sampling = True
    cyc.adaptive_threshold = 0.02
    cyc.use_denoising = True
    cyc.denoiser = 'OPENIMAGEDENOISE'
    cyc.max_bounces = 6
    cyc.diffuse_bounces = 3
    cyc.glossy_bounces = 2
    cyc.transmission_bounces = 0
    cyc.volume_bounces = 0
    scene.render.resolution_x = A.res
    scene.render.resolution_y = A.res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = A.exposure
    device_note = 'CPU'
    if not A.cpu:
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'ONEAPI'
            prefs.get_devices()
            gpu = [d for d in prefs.devices if d.type == 'ONEAPI']
            for d in prefs.devices:
                d.use = True
            if gpu:
                cyc.device = 'GPU'
                device_note = 'GPU ONEAPI: ' + ', '.join(d.name for d in gpu)
            else:
                cyc.device = 'CPU'
                device_note = 'CPU (no ONEAPI device found)'
        except Exception as e:  # noqa
            cyc.device = 'CPU'
            device_note = 'CPU (GPU init failed: %s)' % e
    else:
        cyc.device = 'CPU'
    world = bpy.data.worlds.new('World') if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg is not None:
        bg.inputs[0].default_value = (0.55, 0.57, 0.6, 1.0)
        bg.inputs[1].default_value = 0.12
    print('[render] device:', device_note)
    return device_note


VIEW_SPECS = {
    # name: (view_from direction, up hint, lens mm, fill fraction, region selector, age tint)
    'top':   ((0.0, 0.0, 1.0), (0.0, 1.0, 0.0), 80.0, 0.72, 'all', False),
    'iso':   ((1.0, -1.6, 0.8), (0.0, 0.0, 1.0), 50.0, 0.76, 'all', False),
    'close': ((0.25, -0.30, 1.0), (0.0, 1.0, 0.0), 85.0, 0.85, 'arm', False),
    'age':   ((1.0, -1.6, 0.8), (0.0, 0.0, 1.0), 50.0, 0.70, 'all', True),
}


def render_views(A, dendrite_ob, co, arms, stats):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('HeroCam')
    cam_data.sensor_width = 36.0
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_start = 0.01
    cam_data.clip_end = 100.0
    cam_ob = bpy.data.objects.new('HeroCam', cam_data)
    scene.collection.objects.link(cam_ob)
    scene.camera = cam_ob
    lights = (make_area_light('Key', (0, 0, 5), (0, 0, 0), 1.8, A.key_power),
              make_area_light('Fill', (0, 0, 5), (0, 0, 0), 5.0, A.key_power * 0.22),
              make_area_light('Rim', (0, 0, 5), (0, 0, 0), 1.5, A.key_power * 0.6))
    R = float(np.linalg.norm(co, axis=1).max())
    sub = co[:: max(1, len(co) // 60000)]
    clay = make_material(False, A.t)
    tint = None
    timings = {}
    for name in [v.strip() for v in A.views.split(',') if v.strip()]:
        if name not in VIEW_SPECS:
            print('[render] unknown view', name)
            continue
        view_from, up, lens, fill, region, age_tint = VIEW_SPECS[name]
        f, r, u = camera_basis(view_from, up)
        if region == 'arm':
            px = [a for a in arms if a.gen == 0][0]
            m = (co[:, 0] > 0.32 * px.L) & (np.abs(co[:, 1]) < 0.32) & (np.abs(co[:, 2]) < 0.32)
            pts = co[m][:: max(1, int(m.sum()) // 60000)] if m.any() else sub
            target = np.array([0.66 * px.L, 0.0, 0.0])
        else:
            pts = sub
            target = np.zeros(3)
        cam_data.lens = lens
        dist = fit_distance(pts, f, r, u, target, lens, fill)
        place_camera(cam_ob, f, r, u, target, dist)
        place_lights(lights, f, r, u, target, R if region != 'arm' else 0.6 * R)
        if age_tint:
            if tint is None:
                tint = make_material(True, A.t)
            dendrite_ob.data.materials[0] = tint
        else:
            dendrite_ob.data.materials[0] = clay
        path = os.path.join(A.out, '%s_t%.2f_%s.png' % (A.name, A.t, name))
        scene.render.filepath = path
        t0 = time.perf_counter()
        bpy.ops.render.render(write_still=True)
        timings[name] = round(time.perf_counter() - t0, 1)
        print('[render] %s -> %s  (%.1fs, cam dist %.2f)' % (name, path, timings[name], dist))
        try:   # brightness / coverage readout so exposure is not guessed
            img = bpy.data.images.load(path)
            px = np.empty(len(img.pixels), dtype=np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            m = px[:, 3] > 0.5
            print('[render]   coverage %.1f%% of frame, mean linear RGB of object %.3f, 99th pct %.3f' % (
                100.0 * m.mean(), px[m, :3].mean(), np.percentile(px[m, :3], 99)))
            bpy.data.images.remove(img)
        except Exception as e:  # noqa
            print('[render]   (readout failed: %s)' % e)
    dendrite_ob.data.materials[0] = clay
    stats['render_seconds'] = timings


# ----------------------------------------------------------------------------------------------
def parse_args():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    p = argparse.ArgumentParser(description='procedural cubic dendrite for Blender 4.5 (headless)')
    p.add_argument('--t', type=float, default=1.0, help='growth time in [0,1]')
    p.add_argument('--stages', default='', help='comma list of t values to build (topology sweep); overrides --t')
    p.add_argument('--seed', type=int, default=7)
    p.add_argument('--out', default='C:/Users/frank/solidify-hero-out')
    p.add_argument('--name', default='dendrite')
    p.add_argument('--tip-radius', type=float, default=0.018, help='primary tip radius rho (arm length = 1)')
    p.add_argument('--arm-length', type=float, default=1.0, help='primary arm length reached at t=1')
    p.add_argument('--rho-ratio', type=float, default=0.5, help='tip radius ratio secondary/primary')
    p.add_argument('--rho-ratio-tertiary', type=float, default=0.6, help='tip radius ratio tertiary/secondary')
    p.add_argument('--onset', type=float, default=5.0, help='side-branch onset behind the tip, in rho')
    p.add_argument('--lambda0', type=float, default=2.2, help='initial side-branch spacing, in rho of the parent')
    p.add_argument('--coarsen-tau', type=float, default=0.045, help='coarsening time constant (smaller = faster)')
    p.add_argument('--tertiary-density', type=float, default=1.0, help='fraction of long secondaries with tertiaries')
    p.add_argument('--neck', type=float, default=0.45, help='root necking strength (0..0.6)')
    p.add_argument('--speed-ratio', type=float, default=0.55, help='secondary / primary tip speed')
    p.add_argument('--voxel', type=float, default=0.004)
    p.add_argument('--fillet', type=float, default=0.005, help='closing radius for junction fillets')
    p.add_argument('--open-voxels', type=float, default=OPEN_VOXELS,
                   help='opening radius after the closing, in voxels (removes sub-voxel slivers and specks; 0 = off)')
    p.add_argument('--smooth-iters', type=int, default=2)
    p.add_argument('--res', type=int, default=1000)
    p.add_argument('--samples', type=int, default=64)
    p.add_argument('--exposure', type=float, default=-0.7)
    p.add_argument('--key-power', type=float, default=300.0)
    p.add_argument('--views', default='top,iso,close')
    p.add_argument('--no-render', action='store_true')
    p.add_argument('--save-blend', action='store_true')
    p.add_argument('--cpu', action='store_true')
    p.add_argument('--gate-soft', action='store_true', help='report a topology failure but keep going (debug renders)')
    p.add_argument('--no-clearance', action='store_true', help='debug: skip the clearance pass (v1 behavior)')
    p.add_argument('--skeleton-only', action='store_true', help='print skeleton counts and the features JSON, no mesh')
    p.add_argument('--only-arms', default='', help='debug: keep only these side-arm subtrees, e.g. p0 or p0r1,p0r2 or p0r1s3')
    p.add_argument('--dump-arms', default='', help='debug: write every arm\'s state at t to this JSON path')
    return p.parse_args(argv)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.node_groups, bpy.data.materials):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


def build(A, t):
    """build the dendrite at growth time t; returns (object, mesh, arms, vertex coords, stats, gate_ok).
    The object 'Dendrite' is linked to the scene with a clay material; the helper 'DendriteSkeleton' point object
    stays linked but hidden (the caller may remove it). Writes features_<name>_t<t>.json into A.out."""
    A.t = t
    stats = {'t': t, 'seed': A.seed, 'params': vars(A).copy(), 'timings_seconds': {}}
    T = stats['timings_seconds']
    t_build0 = time.perf_counter()

    t0 = time.perf_counter()
    rng = np.random.default_rng(A.seed)
    arms = build_skeleton(A, rng)
    n_cap, n_cut = update_states(arms, t, A)
    T['skeleton'] = round(time.perf_counter() - t0, 3)
    alive = [a for a in arms if a.alive]
    print('[skeleton] arms: %d total (%d dropped by clearance), alive at t=%.2f: %d primary, %d secondary, %d tertiary '
          'on %d hosts; channel caps on %d arms; necks suppressed on %d coalesced roots, %d necked side arms left' % (
              len(arms), sum(a.dropped for a in arms), t, sum(a.gen == 0 for a in alive), sum(a.gen == 1 for a in alive),
              sum(a.gen == 2 for a in alive), len({a.parent.idx for a in alive if a.gen == 2}), n_cap, n_cut,
              sum(1 for a in alive if a.gen >= 1 and a.k_neck > 0.05)))

    t0 = time.perf_counter()
    pts = collect_points(arms, t, A)
    T['points'] = round(time.perf_counter() - t0, 3)
    print('[points] %d spheres (radius %.4f..%.4f)' % (len(pts['rad']), pts['rad'].min(), pts['rad'].max()))

    t0 = time.perf_counter()
    skel = make_skeleton_object(pts)
    ng = build_gn_tree(A.voxel, A.fillet, t, A.open_voxels * A.voxel)
    mod = skel.modifiers.new('DendriteSDF', 'NODES')
    mod.node_group = ng
    me = evaluated_mesh(skel)
    skel.modifiers.remove(mod)
    skel.hide_render = True
    skel.hide_viewport = True
    T['sdf_and_mesh'] = round(time.perf_counter() - t0, 3)
    print('[mesh] raw: %d verts, %d faces (%.1fs)' % (len(me.vertices), len(me.polygons), T['sdf_and_mesh']))

    t0 = time.perf_counter()
    ob = bpy.data.objects.new('Dendrite', me)
    bpy.context.scene.collection.objects.link(ob)
    if A.smooth_iters > 0:
        sm = ob.modifiers.new('Smooth', 'SMOOTH')
        sm.factor = 0.5
        sm.iterations = A.smooth_iters
        me2 = evaluated_mesh(ob)
        ob.modifiers.remove(sm)
        ob.data = me2
        bpy.data.meshes.remove(me)
        me = me2
    me.shade_smooth()
    me.name = 'Dendrite'
    T['smooth'] = round(time.perf_counter() - t0, 3)
    T['build_total'] = round(time.perf_counter() - t_build0, 3)

    t0 = time.perf_counter()
    co, bb = mesh_bbox(me)
    topo = mesh_topology(me, co)
    T['topology_check'] = round(time.perf_counter() - t0, 3)
    stats['mesh'] = dict(topo, **bb)
    gate_ok = topo['single_closed_genus0_surface']
    print('[topology] V=%d E=%d F=%d  chi=V-E+F=%d  components=%d  genus=%s  boundary=%d nonmanifold=%d  -> %s' % (
        topo['vertices'], topo['edges'], topo['faces'], topo['euler_characteristic'], topo['components'],
        topo['genus_total'], topo['boundary_edges'], topo['nonmanifold_edges'],
        'PASS (one closed genus-0 surface)' if gate_ok else 'FAIL'))
    if topo.get('small_components'):
        print('[topology] small components:', json.dumps(topo['small_components']))
    stats['topology_gate'] = 'PASS' if gate_ok else 'FAIL'
    stats['trunk_cross_sections'] = trunk_cross_sections(co, [a for a in arms if a.gen == 0][0])
    for cs in stats['trunk_cross_sections']:
        print('[check] trunk %.3f behind tip: r_ridge %.4f r_diag %.4f ratio %.3f' % (
            cs['distance_behind_tip'], cs['r_ridge'], cs['r_diagonal'], cs['ridge_over_diagonal']))
    ages = np.empty(len(me.vertices), dtype=np.float32)
    me.attributes['age'].data.foreach_get('value', ages)
    stats['age_attribute'] = {'min': round(float(ages.min()), 4), 'max': round(float(ages.max()), 4)}
    print('[mesh] final: %d verts, %d faces, build %.1fs, age %.3f..%.3f' % (
        topo['vertices'], topo['faces'], T['build_total'], ages.min(), ages.max()))

    feats = extract_features(arms, t, A, A.seed)
    stats['counts'] = feats['counts']
    if getattr(A, 'dump_arms', ''):
        dump_arms(arms, A.dump_arms)
    fpath = os.path.join(A.out, 'features_%s_t%.2f.json' % (A.name, t))
    with open(fpath, 'w') as fh:
        json.dump(feats, fh, indent=1)
    print('[features] ->', fpath)
    me.materials.append(make_material(False, t))
    return ob, me, arms, co, stats, gate_ok


def write_stats(A, stats, t):
    spath = os.path.join(A.out, 'stats_%s_t%.2f.json' % (A.name, t))
    with open(spath, 'w') as fh:
        json.dump(stats, fh, indent=1, default=str)
    print('[stats] ->', spath)


def main():
    A = parse_args()
    os.makedirs(A.out, exist_ok=True)

    if A.skeleton_only:
        rng = np.random.default_rng(A.seed)
        arms = build_skeleton(A, rng)
        n_cap, n_cut = update_states(arms, A.t, A)
        feats = extract_features(arms, A.t, A, A.seed)
        alive = [a for a in arms if a.alive]
        print('[skeleton] counts at t=%.2f: %s' % (A.t, json.dumps(feats['counts'])))
        print('[skeleton] channel caps on %d arms; necks: suppressed on %d coalesced roots; %d secondaries and %d tertiaries '
              'keep a neck > 0.05' % (n_cap, n_cut, sum(1 for a in alive if a.gen == 1 and a.k_neck > 0.05),
                                      sum(1 for a in alive if a.gen == 2 and a.k_neck > 0.05)))
        print('[skeleton] tertiary protrusion: %s' % json.dumps(feats.get('tertiary_length')))
        if A.dump_arms:
            dump_arms(arms, A.dump_arms)
        fpath = os.path.join(A.out, 'features_%s_t%.2f.json' % (A.name, A.t))
        with open(fpath, 'w') as fh:
            json.dump(feats, fh, indent=1)
        print('[features] ->', fpath)
        return

    if A.stages:
        stages = [float(x) for x in A.stages.split(',') if x.strip()]
        rows = []
        all_ok = True
        for t in stages:
            clear_scene()
            ob, me, arms, co, stats, ok = build(A, t)
            write_stats(A, stats, t)
            m = stats['mesh']
            rows.append((t, stats['timings_seconds']['build_total'], m['vertices'], m['faces'], m['euler_characteristic'],
                         m['components'], m['genus_total'], m['watertight'], 'PASS' if ok else 'FAIL'))
            all_ok &= ok
        print('\n[stages]   t   build_s    verts    faces  chi comp genus watertight gate')
        for r in rows:
            print('[stages] %4.2f  %7.1f %8d %8d %4d %4d %5.1f %10s %s' % r)
        if not all_ok:
            print('[TOPOLOGY GATE] FAIL: at least one stage is not a single closed genus-0 surface')
            sys.stdout.flush()
            sys.exit(GATE_EXIT_CODE)
        print('[TOPOLOGY GATE] PASS for all stages')
        return

    clear_scene()
    ob, me, arms, co, stats, ok = build(A, A.t)
    if not ok:
        stats['device'] = None
        write_stats(A, stats, A.t)
        print('[TOPOLOGY GATE] FAIL at t=%.2f: %s' % (A.t, json.dumps(stats['mesh'])))
        if not A.gate_soft:
            sys.stdout.flush()
            sys.exit(GATE_EXIT_CODE)
        print('[TOPOLOGY GATE] --gate-soft: continuing with renders for inspection')

    if not A.no_render:
        stats['device'] = setup_render(A)
        render_views(A, ob, co, arms, stats)

    if A.save_blend:
        t0 = time.perf_counter()
        bpath = os.path.join(A.out, '%s_t%.2f.blend' % (A.name, A.t))
        bpy.ops.wm.save_as_mainfile(filepath=bpath, compress=True)
        stats['timings_seconds']['save_blend'] = round(time.perf_counter() - t0, 1)
        stats['blend'] = bpath
        print('[blend] ->', bpath)

    write_stats(A, stats, A.t)
    print('[done] timings:', stats['timings_seconds'])
    if not ok:
        sys.stdout.flush()
        sys.exit(GATE_EXIT_CODE)


if __name__ == '__main__':
    main()
