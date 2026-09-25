"""
look.py -- the FINAL look for the SOLIDIFY landing hero: a procedural cubic metal dendrite in Cycles
(Blender 4.5 LTS, headless). This is the one scene script the sequence renderer imports or calls.

Direction (three-way judge panel: satin steel won two of three; polished nickel read as glitter at page
scale; the incandescent variant was rejected for wrong physics and a broken alpha), revised after the
round-1 panel (must-fix list in the round-2 brief):

  FROZEN  (h = 0)  neutral satin steel. Principled BSDF, metallic 1, base colour iron's F0 (linear
                   0.565/0.570/0.575, neutral: round 1's cool tint 0.535/0.555/0.595 turned every warm
                   reflection rose), roughness 0.26 with only low-frequency variation (a noise of scale 2
                   in object units, +-0.02, and the old trunk a touch more matte than the fresh tips via
                   the generator's 'age' attribute: +0.03). No micro noise, no bump: at page scale that
                   reads as glitter. The midtone warmth (R/B 1.10-1.15) comes from the key alone.
  GROWING (h = 1)  self-luminous metal: every studio light is off (hot_light 0), the base colour is a dark
                   oxide and the roughness high, so the image is emission alone. Round 3 (the round-2
                   judges asked for it) gives the glow a real brightness gradient: a CORE PROXY m runs from
                   0 at the thin young tips to 1 at the thick old core, and emission goes emit_lo -> emit_hi
                   (0.55 -> 3.4) and 1750 K -> 2100 K along it, so the tips are deep orange and the core and
                   junction are rolled off by Filmic toward pale yellow-white. m is cubic-symmetric by
                   construction (mostly the normalised distance from the nucleus, |P| / Reach, with a little
                   of the vertex 'age'), identical on all six arms and continuous across every root. No
                   limb darkening (a conductor's emissivity is flat until ~60 deg); the cavity term (roots,
                   junction, between side-branch rows) carries the rest of the tonal structure. Bloom is
                   post, on the opaque composite (encode_frames.py).
  COOLING (0<h<1)  the same m is the thermal-mass proxy: h_local = h (1 - cool_gain (1-h) (1-m)), so the
                   tips lose their glow a little ahead of the core, with a falloff over ~0.7 of the arm
                   length (many trunk radii), no hard edge, no crescent at a secondary root, no diagonal.
                   The oxide base colour and the high roughness follow h_local (not the global h), so a
                   station that still glows is dark metal lit from inside and the key's warm highlight never
                   mixes with the red into pink. Strength falls as h_local^2.9: gentler than Wien, on
                   purpose, so the cooling chapter reads at the exposure of the growing one.

  view transform   FILMIC (look None), not AgX. AgX's chroma inset desaturates any bright saturated colour
                   toward pastel: measured, pure 1780 K emission through AgX is (185,93,3) at strength 0.2
                   but (222,139,81) at 0.5 and (241,171,131) at 1.0 -- the round-1 "salmon", lights or no
                   lights. Filmic follows the per-channel path a camera does: (183,105,0) at 0.2,
                   (218,151,0) at 0.5, (235,183,0) at 1.0, (253,231,3) at 4.0. A 2 % white leak in the
                   emission colour (the blue tail of the Planckian spectrum that the Rec.709 clip of the
                   Blackbody node drops, plus sensor crosstalk) lets the hottest cores reach yellow-white
                   instead of pure yellow.
  lights   Key  3200 K softbox, desaturated 40 % toward white (diffusion), 3 x 3 m at 3.6 m, upper RIGHT
                in camera space and mostly to the side: it rakes across the side-branch rows and lays their
                shadows over the trunk, and it is the only warm thing in the frame.
           Rim  7000 K tall strip behind LEFT (30 % toward white): cuts the silhouette out of the dark page.
           Fill 6000 K, very large and dim, front left: surfaces facing away from the key keep a gradient
                instead of going black.
           No amber kicker: the page's amber is reserved for UI accents.
           Lights sit in CAMERA space per view at a fixed distance from the view target, so every still
           and every frame of a sequence shares one light geometry.
  world    near-black neutral gradient, only ever seen in the metal's reflections (film is transparent).
  film     transparent, straight alpha, no compositor (bloom is added later in post on the opaque
           composite, so nothing may bleed glare into the alpha). The close-up's trunk leaves the frame at
           the bottom by construction, so that still gets its alpha feathered to 0 over the bottom 15 % in
           the composite step (RGB untouched, straight alpha scaled), which is how it bleeds off the page
           instead of ending in a cut line.
  camera   hero  three-quarter view, fitted so the full t=1 crystal spans ~0.78 of the frame HEIGHT
                 (per-axis fit + recentre on the projected bounding box); not a 4-fold head-on view.
           close one arm (+x) seen from the nucleus side and above, receding towards its tip: the necked
                 roots of the lambda2 pair sit crisp in the foreground (focus = the pair's first root,
                 f/2.8: the primary tip is 0.2 model units behind the focus plane, a 4 px blur circle at
                 1000 px, while both roots stay within 1 px), the frame beyond the tip is void (label
                 space). Landmarks (roots, tertiary, tip) are projected to pixels and written to the report
                 so the composite step can measure local sharpness at each one (alpha-edge gradient).

  measured (round 2 deliverables, 1000 px, 128 samples, Intel Arc 140V; composite metrics in report.json):
           frozen hero    coverage 13.9 % of the frame, crystal spans 0.774 of the frame height, midtone R/B
                          1.12, object pixels >= 240/255: 1.1 %, pixels with R-B > 40: 0.4 % (round 1: 12.4 %),
                          pixels with B > G: 0.6 %, 17.6 s
           frozen close   midtone R/B 1.10, clip 1.5 %, alpha feathered over the bottom 15 % (bottom row and
                          left column carry 0 opaque pixels), alpha-edge gradient at the lambda2 roots 128/125
                          vs 77 at the primary tip (tip softer), 16.5 s
           growing t=0.6  median (222,162,46) = hue 39.5 deg, B/G 0.28 (round 1: (240,172,133), hue 22, B/G
                          0.77); hue p5-p95 27-42 deg; interior luma p1-p99 108-197: flanks (180,106,22),
                          flats (223,163,52), junction and roots (230,189,98); 18.1 s
           cooling h=0.4  median (125,105,99), midtone R/B 1.22 (round 1: 1.32), pixels with R-B > 40: 11.7 %
                          (round 1: 38 %), pixels with B > G: 0.5 % (no magenta), glow confined to the inner
                          trunk and junction; 24.7 s

CLI, Blender:
  blender.exe -b --factory-startup --python look.py -- [--shots "label:t:h:view;..."] [--out DIR]
      [--res 1000] [--samples 128] [--set key=value ...] [--view hero.view_from=1,-1.45,0.75 ...]
  default shots = the four deliverables (frozen hero, frozen close, growing t=0.6 h=1, cooling t=1 h=0.4)
  Blend files come from dendrite_gen.py --save-blend: --blend is a pattern with {t}; --features likewise.

CLI, plain python (PIL): feather + composite every still onto the page colour, write metrics into report.json
  python look.py --composite DIR_OR_PNG [...]
  (the Blender run calls this itself through the system python when it finishes)

Round 4 (the final sequence, render_sequence.py): NO emission. Two judge rounds rejected every glow as plastic or
wrong physics, so the sequence is built with Look(emission=0): the emission branch is left out of the shader
entirely and the crystal is satin steel in every frame. The freeze is told with LIGHT instead: set_warmth(w) eases
every lamp's color temperature between a warm rig at w = 1 (key 2600 K, rim 6000 K, fill 4800 K, plus a faint
3400 K bounce card under the crystal, as if lit from the melt) and the final neutral rig at w = 0 (key 3200 K, rim
7000 K, fill 6000 K, bounce off). The sequence holds w = 1 through seed and grow and eases it to 0 across the cool
chapter. Subtle on purpose: the metal reads as steel throughout. The warmth is a global cast (the big fill), not a
reflection: the bounce was 2300 K until a smoke pass showed its mirror image turning the vertical -z trunk into a gold
rod; measured at 600 px (crystal pixels, HSV S > 0.5 at hue 15-45 / midtone R/B): frame 60 7.1 % / 1.29 -> 0.7 % /
1.27, frame 95 8.1 % / 1.29 -> 0.6 % / 1.27, frame 110 5.0 % / 1.20 -> 0.8 % / 1.18; the tour (w = 0) is unchanged.

Import (sequence renderer):
  import look
  L = look.Look(res=1200, samples=96, emission=0)
  L.setup(clear=True)                   # material / world / lights / camera, no mesh yet
  for f in frames:
      L.adopt(dendrite_gen.build(A, t)[0])   # takes over the in-process mesh, keeps the rig
      L.frame(view_dict)
      L.set_warmth(w)
      L.render(path)
  look.composite_and_metrics([...])     # plain python, PIL: *_on-0a0a0a.png + metrics
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np

try:
    import bpy
    from mathutils import Vector
except ImportError:          # plain python: only the --composite path is available
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
if bpy is not None:
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    from dendrite_gen import camera_basis, fit_distance, place_camera  # noqa: E402  (helpers only)

PAGE_BG = (0x0A, 0x0A, 0x0A)
DEFAULT_BLEND = 'C:/Users/frank/solidify-hero-out/dendrite_t{t:.2f}.blend'
DEFAULT_FEATURES = 'C:/Users/frank/solidify-hero-out/features_dendrite_t{t:.2f}.json'
DEFAULT_OUT = 'C:/Users/frank/solidify-hero-out/final_look'
DEFAULT_SHOTS = ('frozen_hero:1.0:0.0:hero;frozen_close:1.0:0.0:close;'
                 'growing_t0.6_h1.0:0.6:1.0:hero;cooling_t1.0_h0.4:1.0:0.4:hero')

# ---- look parameters (all overridable with --set key=value or Look(**tweaks)) --------------------
# Round 3 (sequence render) changes, from the round-2 judge notes:
#   * the hot state is self-luminous metal, not a lit object: hot_light 0 (all studio light off at h = 1), no
#     limb darkening (limb 0; a metal's directional emissivity is flat until ~60 deg and the judge read the
#     roll-off as shading), the cavity term alone carries the tonal structure;
#   * a real brightness gradient: emission runs from emit_lo on the thin young tips (deep orange) to emit_hi on
#     the thick old core and junction (rolled off by Filmic toward yellow-white), driven by a CORE PROXY m that is
#     cubic-symmetric by construction: m = smoothstep((a_eff - mass_t0) / mass_w) with
#     a_eff = (1 - age_mix) (1 - |P| / Reach) + age_mix (age / AgeMax), i.e. mostly the normalised distance from the
#     nucleus (smooth, continuous across every secondary root, identical on all six arms) with a little of the
#     vertex 'age' attribute so thin side arms read younger than the trunk at the same radius. Reach (current
#     primary length) and AgeMax (current t) are set per frame by set_growth();
#   * cooling: the same m is the thermal-mass proxy, so the glow leaves the tips first and the core last with a
#     falloff over ~mass_w of the arm length (many trunk radii) and no hard edge, crescent or diagonal; cool_gain
#     is modest so the fade reads as near-uniform;
#   * no pink chrome: in the hot zone the base colour goes to a dark oxide and the roughness up (both by
#     h_local, not by the global h), so a glowing station is dark metal lit from inside and the key's warm
#     highlight cannot mix with the red.
LOOK = dict(
    base=(0.565, 0.570, 0.575),   # linear: iron F0, neutral (a cool tint here turns every warm reflection rose)
    rough=0.26,                   # freshest surface
    rough_age=0.03,               # + over the full age range (old trunk a touch more matte)
    rough_var=0.02,               # +- low-frequency variation
    rough_var_scale=2.0,          # noise scale in object units (the crystal spans ~2)
    t_hot=1750.0,                 # K at h_local = 1 on the thin tips (deep orange through Filmic)
    t_core=350.0,                 # + K on the core (m = 1): the thick old solid reads yellow-white
    t_cold=900.0,                 # K as h_local -> 0 (strength is ~0 there anyway)
    bb_leak=0.02,                 # emission colour = blackbody + bb_leak * R_blackbody * white (Planckian blue tail)
    emit_lo=0.20,                 # emission strength at h_local = 1 where m = 0 (tips, young side arms): Filmic
                                  # puts 0.2 at (183,105,0), deep orange
    emit_hi=4.0,                  # ... and where m = 1 (core, junction): Filmic rolls 4.0 off to (253,231,3) and the
                                  # blue leak lifts it to pale yellow-white; the ramp between is log-linear in m
    emit_gamma=2.9,               # strength *= h_local^gamma (gentler than Wien so the cooling chapter reads)
    limb=0.0, limb_pow=0.6,       # emission *= 1 - limb * facing^pow (0 = flat, per the round-2 notes; negative
                                  # values brighten the grazing silhouette slightly)
    cavity=1.0, cavity_dist=0.25, # emission *= 1 + cavity * (1 - AO): cavity radiation between arms
    age_mix=0.0,                  # weight of the vertex age (vs the radial distance) in the core proxy. 0: the vertex
                                  # age steps at every side-branch root (the generator samples birth from the nearest
                                  # skeleton point, so the trunk around a root inherits the arm's later birth) and any
                                  # share of it shows as a dark oval at each root while hot
    mass_t0=0.12, mass_w=0.70,    # m = smoothstep((a_eff - mass_t0) / mass_w): soft, over most of the arm length
    core_span_min=0.05,           # model units: floor of (Reach - Core) in the radial proxy (see _build_material)
    cool_gain=0.9,                # h_local = h (1 - cool_gain (1-h) (1-m)): tips ahead of the core while cooling
    rough_hot=0.50,               # roughness where h_local = 1 (lerp by h_local)
    oxide=(0.16, 0.13, 0.11),     # linear base colour of the hot zone (dark scale), lerp by oxide_amt * sqrt(h_local)
    oxide_amt=0.85,
    hot_light=0.0,                # key + rim fraction at h = 1 (lerp by h^2): 0 = pure emission while growing
    fill_heat_pow=4.0,            # fill + world *= 1 - h^pow: off only near h = 1
    key=1.0, rim=1.0, fill=1.0,   # light power multipliers
    key_desat=0.40,               # key colour = lerp(blackbody 3200 K, white, key_desat)
    rim_desat=0.30,
    world=1.0,                    # world gradient multiplier
    filmic_look='None',           # Filmic look ('None' = base contrast, 'Medium High Contrast', 'High Contrast', ...)
    # round 4: emission switch and the warm / neutral light rigs that set_warmth() eases between
    emission=1.0,                 # multiplier on the emission strength; 0 leaves the emission branch out of the
                                  # shader entirely (the final sequence: no glow anywhere)
    key_kelvin=3200.0, rim_kelvin=7000.0, fill_kelvin=6000.0,                  # the neutral rig (warmth 0)
    key_kelvin_warm=2600.0, rim_kelvin_warm=6000.0, fill_kelvin_warm=4800.0,   # the warm rig (warmth 1); the fill,
                                  # the largest and softest lamp, carries the warm cast (5600 K before the gold-rod fix)
    key_desat_warm=0.60,          # the key's mix toward white at warmth 1 (0.40 at warmth 0): a 2600 K key at the
                                  # frozen rig's desaturation rendered the steel as brass (midtone R/B 1.5-1.7); the
                                  # warm rig is meant to read as steel under warm light (R/B ~1.3)
    key_warm_gain=1.12,           # key power at warmth 1 (a 2600 K blackbody carries less luminance than 3200 K)
    bounce=1.0,                   # power multiplier of the warm bounce card under the crystal; it is on at warmth 1
    bounce_kelvin=3400.0,         # and off at warmth 0 (the frozen rig has no warm light from below). At 2300 K its
                                  # mirror image turned the vertical -z trunk into a gold rod (9 % of the crystal's
                                  # pixels strongly orange, HSV S > 0.5 at hue 15-45, at frames 60 and 95); at 3400 K it is
                                  # a pale warm lift (0.4-0.8 %), and the warm story is a global cast (fill 4800 K)
)

# view_from = direction the camera looks FROM (towards target). fill_h / fill_w = fraction of the frame the
# crystal may span vertically / horizontally (per-axis fit); width = frame width at the target plane in
# model units (close-ups). focus = world point that must be sharp, or the name of a feature landmark
# (default: the target). fstop 0 = no DOF. feather = (bottom, left) fractions of the frame over which the
# alpha is faded to 0 in the composite step (0 = none). landmarks = feature points projected into the report.
# exposure = EV added to the base exposure for this view (the close-up fills its frame with the brightest
# specular areas, so it sits 0.15 EV under the hero to keep clipping under 1.5 %).
VIEWS = {
    'hero':  dict(view_from=(1.0, -1.45, 0.75), up=(0.0, 0.0, 1.0), lens=55.0, fill_h=0.78, fill_w=0.90,
                  target=(0.0, 0.0, 0.0), fstop=8.0, feather=(0.0, 0.0), landmarks=()),
    # +x arm from the nucleus side, between its -y and +z side-branch rows (both show their necked roots,
    # the +z row's tertiaries are not foreshortened away); trunk vertical at ~30 % of the width, tip near the
    # top edge, the right ~37 % of the frame is empty for labels. Focus on the lambda2 pair's first root.
    'close': dict(view_from=(-0.30, -0.65, 0.70), up=(1.0, 0.08, 0.0), lens=85.0, width=0.74,
                  target=(0.62, -0.235, 0.05), focus='lambda2_root_a', fstop=2.8, feather=(0.15, 0.0), exposure=-0.15,
                  landmarks=('lambda2_root_a', 'lambda2_root_b', 'lambda2_tip_a', 'lambda2_tip_b', 'tertiary_root',
                             'tertiary_tip', 'primary_tip', 'necked_root')),
}

# name, (LOOK key of the neutral kelvin, LOOK key of the warm kelvin), desat key, watts, shape, (size_x, size_y),
# camera-space direction (toward camera, right, up). The Bounce is a round-4 addition: a large dim warm card under
# the crystal that exists only while warmth > 0 (its power is scaled by the warmth, see _apply_light_power).
LIGHTS = [
    ('Key',    ('key_kelvin', 'key_kelvin_warm'),       'key_desat', 150.0, 'RECTANGLE', (3.0, 3.0), (0.30, 1.00, 0.70)),
    ('Rim',    ('rim_kelvin', 'rim_kelvin_warm'),       'rim_desat', 320.0, 'RECTANGLE', (0.8, 3.0), (-0.90, -0.75, 0.50)),
    ('Fill',   ('fill_kelvin', 'fill_kelvin_warm'),     None,        195.0, 'DISK',      (6.0, 6.0), (1.00, -0.70, 0.15)),
    ('Bounce', ('bounce_kelvin', 'bounce_kelvin'),      None,         30.0, 'DISK',      (5.0, 5.0), (0.55, -0.30, -1.00)),
]
LIGHT_DIST = 3.6


def mired_lerp(t_a, t_b, w):
    """color temperature between t_a (w = 0) and t_b (w = 1), interpolated in mired (1e6 / K), which is how
    color temperature is perceived and how gel filters are graded."""
    return 1.0 / ((1.0 - w) / float(t_a) + w / float(t_b))


def reach_of(feats, t):
    """current primary arm length from a generator features dict (falls back to ~t)."""
    tips = (feats or {}).get('tips') or []
    if tips:
        return max(float(x.get('length', 0.0)) for x in tips) or max(t, 1e-3)
    return max(1.03 * float(t), 1e-3)


def landmark_points(feats):
    """named world points from a generator features_*.json (missing ones are skipped)."""
    out = {}
    if not feats:
        return out
    lp = feats.get('lambda2_pair') or {}
    for k in ('root_a', 'root_b', 'tip_a', 'tip_b'):
        if k in lp:
            out['lambda2_' + k] = lp[k]
    te = feats.get('tertiary') or {}
    for k in ('root', 'tip'):
        if k in te:
            out['tertiary_' + k] = te[k]
    nr = feats.get('necked_root') or {}
    if 'root_on_trunk' in nr:
        out['necked_root'] = nr['root_on_trunk']
    pa = feats.get('primary_axis') or {}
    if 'tip' in pa:
        out['primary_tip'] = pa['tip']
    return out


# ==================================================================================================
# scene
# ==================================================================================================
class Look:
    """material + world + lights + camera for one 'Dendrite' mesh; one heat parameter."""

    def __init__(self, res=1000, samples=128, cpu=False, exposure=-0.3, **tweaks):
        if bpy is None:
            raise RuntimeError('Look needs to run inside Blender')
        bad = set(tweaks) - set(LOOK)
        if bad:
            raise ValueError('unknown look parameters: %s' % sorted(bad))
        self.p = dict(LOOK, **tweaks)
        self.res, self.samples, self.cpu, self.exposure = res, samples, cpu, exposure
        self.ob = self.mat = self.cam = None
        self.world_bg = None
        self.lights = {}
        self.light_bb = {}        # name -> the Blackbody node of that lamp (set_warmth drives its temperature)
        self.light_mix = {}       # name -> the desaturation Mix node of that lamp, if it has one
        self.heat = 0.0
        self.warmth = 0.0
        self.device = None
        self.blend = None
        self.feats = {}
        self._cam = None          # (f, r, u, cam_loc, tan_half) of the last frame()
        self.reach, self.age_max, self.core = 1.0, 1.0, 0.0

    # ---- geometry ---------------------------------------------------------------------------------
    def setup(self, clear=True):
        """build the rig (material, world, lights, camera, render settings) once, with no mesh yet.
        clear=True first empties the (factory) scene of objects and orphan data."""
        if clear:
            for o in list(bpy.data.objects):
                bpy.data.objects.remove(o, do_unlink=True)
            for coll in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras, bpy.data.materials):
                for x in list(coll):
                    if x.users == 0:
                        coll.remove(x)
        self.ob = None
        self.mat = self._build_material()
        self._build_world()
        self._build_lights()
        self._build_camera()
        self.device = self._setup_render()
        self.set_warmth(self.warmth)
        self.set_heat(self.heat)
        self.set_growth(self.reach, self.age_max, self.core)
        return self

    def load(self, blend, features=None):
        """empty the (factory) scene, append the 'Dendrite' mesh of a generator .blend, build the rig.
        The generator file is never opened as the main file, so every blend stays an external library
        and swap() can go back and forth between growth stages freely."""
        self.setup(clear=True)
        self.swap(blend, features)
        return self.ob

    def _drop_current(self):
        old = self.ob
        old_me = old.data if old is not None else None
        if old is not None:
            try:
                bpy.data.objects.remove(old, do_unlink=True)
            except ReferenceError:
                pass
        if old_me is not None and old_me.users == 0:
            bpy.data.meshes.remove(old_me)
        self.ob = None

    def adopt(self, ob, features=None):
        """take over a mesh object that already exists in the scene (built in-process by dendrite_gen.build):
        drop the current one, assign the look material. features may be a dict or a json path."""
        if ob.type != 'MESH':
            raise SystemExit('adopt(): %r is not a mesh' % ob.name)
        if self.mat is None:
            self.setup(clear=False)
        if self.ob is not ob:
            self._drop_current()
        self.ob, self.blend = ob, None
        ob.hide_render = False
        ob.hide_viewport = False
        self._assign()
        self._take_features(features)
        return ob

    def _take_features(self, features):
        self.feats = {}
        if isinstance(features, dict):
            self.feats = features
        elif features and os.path.isfile(features):
            with open(features) as fh:
                self.feats = json.load(fh)

    def swap(self, blend, features=None):
        """append the 'Dendrite' object of a generator .blend and drop the current one; the rig stays."""
        if not os.path.isfile(blend):
            raise SystemExit('blend not found: %s  (run dendrite_gen.py with --save-blend first)' % blend)
        self._drop_current()
        with bpy.data.libraries.load(blend, link=False) as (src, dst):
            if 'Dendrite' not in src.objects:
                raise SystemExit("no 'Dendrite' object in %s" % blend)
            dst.objects = ['Dendrite']
        ob = dst.objects[0]
        if ob.type != 'MESH':
            raise SystemExit("'Dendrite' in %s is not a mesh" % blend)
        bpy.context.scene.collection.objects.link(ob)
        ob.hide_render = False
        ob.hide_viewport = False
        self.ob, self.blend = ob, blend
        self._assign()
        self._take_features(features)
        print('[look] mesh <- %s  (%d verts)%s' % (os.path.basename(blend), len(ob.data.vertices),
                                                  '  features <- %s' % os.path.basename(str(features)) if self.feats else ''))
        return ob

    def _assign(self):
        me = self.ob.data
        me.materials.clear()
        me.materials.append(self.mat)
        for m in list(bpy.data.materials):          # the generator's clay materials
            if m is not self.mat and m.users == 0:
                bpy.data.materials.remove(m)

    def points(self, cap=60000):
        """a subsample of the current mesh's vertices (for framing)."""
        me = self.ob.data
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3).astype(np.float64)
        step = max(1, len(co) // cap)
        return co[::step]

    # ---- material ---------------------------------------------------------------------------------
    def _build_material(self):
        P = self.p
        mat = bpy.data.materials.new('DendriteSteel')
        mat.use_nodes = True
        nt = mat.node_tree
        N, L = nt.nodes, nt.links
        bsdf = N['Principled BSDF']
        b = P['base']
        bsdf.inputs['Base Color'].default_value = (b[0], b[1], b[2], 1.0)
        bsdf.inputs['Metallic'].default_value = 1.0
        bsdf.inputs['Coat Weight'].default_value = 0.0
        bsdf.inputs['Sheen Weight'].default_value = 0.0

        def value(name, v):
            n = N.new('ShaderNodeValue')
            n.name = n.label = name
            n.outputs[0].default_value = float(v)
            return n.outputs[0]

        heat = value('Heat', 0.0)
        reach = value('Reach', 1.0)        # current primary arm length (model units), set_growth()
        core = value('Core', 0.0)          # current nucleus radius: everything inside it is core (m = 1), set_growth()
        age_max = value('AgeMax', 1.0)     # current growth time t, set_growth()

        def math(op, a=None, b_=None, c=None, clamp=False):
            n = N.new('ShaderNodeMath')
            n.operation = op
            n.use_clamp = clamp
            for i, v in enumerate((a, b_, c)):
                if v is None:
                    continue
                if isinstance(v, (int, float)):
                    n.inputs[i].default_value = float(v)
                else:
                    L.new(v, n.inputs[i])
            return n.outputs['Value']

        # core proxy m (cubic-symmetric, continuous across roots): a_rad = 1 - (|P| - Core) / (Reach - Core), so the
        # nucleus is all core and the primary tips are all tip; a_eff = (1 - age_mix) a_rad + age_mix (age / AgeMax);
        # m = smoothstep((a_eff - mass_t0) / mass_w)
        tc = N.new('ShaderNodeTexCoord')
        vlen = N.new('ShaderNodeVectorMath')
        vlen.operation = 'LENGTH'
        L.new(tc.outputs['Object'], vlen.inputs[0])
        # the span is floored so that while the arms are still inside the nucleus (the seed) the whole nucleus
        # surface, mesh noise included, stays a_rad ~ 1 (core) instead of flipping voxel by voxel
        span = math('MAXIMUM', math('SUBTRACT', reach, core), P['core_span_min'])
        rn = math('DIVIDE', math('SUBTRACT', vlen.outputs['Value'], core), span)
        a_rad = math('SUBTRACT', 1.0, rn, clamp=True)
        attr = N.new('ShaderNodeAttribute')
        attr.attribute_name = 'age'
        a_age = math('DIVIDE', attr.outputs['Fac'], age_max, clamp=True)
        a_eff = math('MULTIPLY_ADD', math('SUBTRACT', a_age, a_rad), P['age_mix'], a_rad)
        mx = math('DIVIDE', math('SUBTRACT', a_eff, P['mass_t0']), P['mass_w'], clamp=True)
        m = math('MULTIPLY', math('MULTIPLY', mx, mx), math('SUBTRACT', 3.0, math('MULTIPLY', mx, 2.0)))

        # h_local = h * (1 - cool_gain * (1 - h) * (1 - m))
        one_minus_h = math('SUBTRACT', 1.0, heat)
        one_minus_m = math('SUBTRACT', 1.0, m)
        h_loc = math('MULTIPLY', heat,
                     math('SUBTRACT', 1.0, math('MULTIPLY', math('MULTIPLY', one_minus_h, one_minus_m), P['cool_gain'])), clamp=True)

        # roughness = rough + rough_age * age_norm + rough_var * (2 noise - 1) + h_local * (rough_hot - rough)
        noise = N.new('ShaderNodeTexNoise')
        noise.noise_dimensions = '3D'
        noise.inputs['Scale'].default_value = P['rough_var_scale']
        noise.inputs['Detail'].default_value = 2.0
        noise.inputs['Roughness'].default_value = 0.5
        L.new(tc.outputs['Object'], noise.inputs['Vector'])
        var = math('MULTIPLY_ADD', noise.outputs['Fac'], 2.0 * P['rough_var'], -P['rough_var'])
        r0 = math('MULTIPLY_ADD', a_age, P['rough_age'], P['rough'])
        r1 = math('ADD', r0, var)
        r2 = math('MULTIPLY_ADD', h_loc, P['rough_hot'] - P['rough'], r1, clamp=True)
        L.new(r2, bsdf.inputs['Roughness'])

        # base colour: steel -> dark oxide in the hot zone (by h_local, so a glowing station never carries a
        # bright chrome highlight into the red)
        ox = math('MULTIPLY', math('POWER', h_loc, 0.5), P['oxide_amt'], clamp=True)
        mixc = N.new('ShaderNodeMix')
        mixc.data_type = 'RGBA'
        mixc.blend_type = 'MIX'
        L.new(ox, mixc.inputs['Factor'])
        mixc.inputs[6].default_value = (b[0], b[1], b[2], 1.0)
        o = P['oxide']
        mixc.inputs[7].default_value = (o[0], o[1], o[2], 1.0)
        L.new(mixc.outputs[2], bsdf.inputs['Base Color'])

        if P['emission'] <= 0.0:
            # round 4: no glow anywhere. The emission branch (blackbody color, cavity AO, strength ramp) is not built,
            # so the shader carries nothing Cycles has to evaluate for it; heat still drives roughness and oxide.
            bsdf.inputs['Emission Strength'].default_value = 0.0
            return mat

        # emission colour: blackbody(T) + bb_leak * R * white, T = t_cold + (t_hot + t_core m - t_cold) h_local
        t_top = math('MULTIPLY_ADD', m, P['t_core'], P['t_hot'])
        temp = math('MULTIPLY_ADD', h_loc, math('SUBTRACT', t_top, P['t_cold']), P['t_cold'])
        bb = N.new('ShaderNodeBlackbody')
        L.new(temp, bb.inputs['Temperature'])
        sep = N.new('ShaderNodeSeparateColor')
        L.new(bb.outputs['Color'], sep.inputs['Color'])
        leak = math('MULTIPLY', sep.outputs['Red'], P['bb_leak'])
        comb = N.new('ShaderNodeCombineColor')
        for k in ('Red', 'Green', 'Blue'):
            L.new(leak, comb.inputs[k])
        addc = N.new('ShaderNodeMix')
        addc.data_type = 'RGBA'
        addc.blend_type = 'ADD'
        addc.inputs['Factor'].default_value = 1.0
        L.new(bb.outputs['Color'], addc.inputs[6])
        L.new(comb.outputs['Color'], addc.inputs[7])
        L.new(addc.outputs[2], bsdf.inputs['Emission Color'])

        # emission strength: emit_lo * (emit_hi / emit_lo)^m * h_local^gamma * (1 - limb * facing^pow)
        #                    * (1 + cavity * (1 - AO))   (log-linear in m: Filmic compresses the top two stops, so a
        #                    linear ramp would put the whole arm on the shoulder and leave the gradient to the tips)
        e_hot = math('MULTIPLY', math('POWER', P['emit_hi'] / P['emit_lo'], m), P['emit_lo'])
        hg = math('POWER', h_loc, P['emit_gamma'])
        strength = math('MULTIPLY', hg, e_hot)
        if abs(P['limb']) > 1e-9:
            lw = N.new('ShaderNodeLayerWeight')
            lw.inputs['Blend'].default_value = 0.5
            limb = math('SUBTRACT', 1.0, math('MULTIPLY', math('POWER', lw.outputs['Facing'], P['limb_pow']), P['limb']))
            strength = math('MULTIPLY', strength, math('MAXIMUM', limb, 0.0))
        if P['cavity'] > 0.0:
            ao = N.new('ShaderNodeAmbientOcclusion')
            ao.samples = 4
            ao.only_local = True
            ao.inputs['Distance'].default_value = P['cavity_dist']
            cav = math('MULTIPLY_ADD', math('SUBTRACT', 1.0, ao.outputs['AO']), P['cavity'], 1.0)
            strength = math('MULTIPLY', strength, cav)
        if abs(P['emission'] - 1.0) > 1e-9:
            strength = math('MULTIPLY', strength, P['emission'])
        L.new(strength, bsdf.inputs['Emission Strength'])
        return mat

    def set_heat(self, h):
        """0 = frozen satin steel, 1 = incandescent glow (only with emission > 0); everything in between is cooling."""
        h = float(min(max(h, 0.0), 1.0))
        self.heat = h
        self.mat.node_tree.nodes['Heat'].outputs[0].default_value = h
        self._apply_light_power()

    def set_warmth(self, w):
        """round 4: the light rig's color temperature. 1 = the warm rig (seed and grow), 0 = the neutral rig (the
        frozen crystal); lamp temperatures are interpolated in mired, the bounce card fades with w."""
        w = float(min(max(w, 0.0), 1.0))
        self.warmth = w
        for name, cold_key, warm_key, _desat, _watts, _shape, _size, _coeff in self._light_specs():
            bb = self.light_bb.get(name)
            if bb is not None:
                bb.inputs['Temperature'].default_value = mired_lerp(self.p[cold_key], self.p[warm_key], w)
        mix = self.light_mix.get('Key')
        if mix is not None:
            mix.inputs['Factor'].default_value = self.p['key_desat'] + (self.p['key_desat_warm'] - self.p['key_desat']) * w
        self._apply_light_power()

    def _light_specs(self):
        for name, (cold_key, warm_key), desat_key, watts, shape, size, coeff in LIGHTS:
            yield name, cold_key, warm_key, desat_key, watts, shape, size, coeff

    def _apply_light_power(self):
        """lamp power from base_energy x heat factor (key + rim off at full incandescence, fill + world off only
        near it) x the warmth factor (the key's warm gain, the bounce card's fade)."""
        h, w = self.heat, self.warmth
        hard = 1.0 - (1.0 - self.p['hot_light']) * h * h      # key + rim
        soft = 1.0 - h ** self.p['fill_heat_pow']              # fill + bounce + world
        for name, ob in self.lights.items():
            k = soft if name in ('Fill', 'Bounce') else hard
            if name == 'Key':
                k *= 1.0 + (self.p['key_warm_gain'] - 1.0) * w
            elif name == 'Bounce':
                k *= w
            ob.data.energy = ob['base_energy'] * k
        if self.world_bg is not None:
            self.world_bg.inputs['Strength'].default_value = self.p['world'] * soft

    def set_growth(self, reach, age_max, core=0.0):
        """the growth state the core proxy is normalised by: reach = current primary arm length (model
        units), age_max = current growth time t (the 'age' attribute runs 0..t), core = current nucleus
        radius (everything inside it counts as core)."""
        self.reach, self.age_max = max(float(reach), 1e-6), max(float(age_max), 1e-6)
        self.core = max(float(core), 0.0)
        if self.mat is not None:
            nodes = self.mat.node_tree.nodes
            nodes['Reach'].outputs[0].default_value = self.reach
            nodes['Core'].outputs[0].default_value = self.core
            nodes['AgeMax'].outputs[0].default_value = self.age_max

    # ---- world + lights -----------------------------------------------------------------------------
    def _build_world(self):
        scene = bpy.context.scene
        world = bpy.data.worlds.new('VoidGradient')
        scene.world = world
        world.use_nodes = True
        nt = world.node_tree
        N, L = nt.nodes, nt.links
        bg = N['Background']
        tc = N.new('ShaderNodeTexCoord')
        sep = N.new('ShaderNodeSeparateXYZ')
        L.new(tc.outputs['Generated'], sep.inputs['Vector'])
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = -1.0
        mr.inputs['From Max'].default_value = 1.0
        mr.clamp = True
        L.new(sep.outputs['Z'], mr.inputs['Value'])
        ramp = N.new('ShaderNodeValToRGB')
        ramp.color_ramp.interpolation = 'EASE'
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[0].color = (0.004, 0.004, 0.0045, 1.0)
        ramp.color_ramp.elements[1].position = 0.95
        ramp.color_ramp.elements[1].color = (0.028, 0.030, 0.034, 1.0)
        L.new(mr.outputs['Result'], ramp.inputs['Fac'])
        L.new(ramp.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = self.p['world']
        self.world_bg = bg
        return world

    def _build_lights(self):
        mult = {'Key': self.p['key'], 'Rim': self.p['rim'], 'Fill': self.p['fill'], 'Bounce': self.p['bounce']}
        self.lights = {}
        self.light_bb = {}
        self.light_mix = {}
        for name, cold_key, warm_key, desat_key, watts, shape, size, coeff in self._light_specs():
            if mult[name] <= 0.0:
                continue
            ld = bpy.data.lights.new(name, 'AREA')
            ld.shape = shape
            ld.size = size[0]
            if shape == 'RECTANGLE':
                ld.size_y = size[1]
            ld.use_nodes = True
            nt = ld.node_tree
            bb = nt.nodes.new('ShaderNodeBlackbody')
            bb.inputs['Temperature'].default_value = mired_lerp(self.p[cold_key], self.p[warm_key], self.warmth)
            self.light_bb[name] = bb
            col = bb.outputs['Color']
            if desat_key is not None and self.p[desat_key] > 0.0:
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MIX'
                mix.inputs['Factor'].default_value = float(self.p[desat_key])
                nt.links.new(bb.outputs['Color'], mix.inputs[6])
                mix.inputs[7].default_value = (1.0, 1.0, 1.0, 1.0)
                col = mix.outputs[2]
                self.light_mix[name] = mix
            nt.links.new(col, nt.nodes['Emission'].inputs['Color'])
            ob = bpy.data.objects.new(name, ld)
            bpy.context.scene.collection.objects.link(ob)
            ob['base_energy'] = watts * mult[name]
            ob['coeff'] = coeff
            ld.energy = ob['base_energy']
            self.lights[name] = ob

    def _place_lights(self, f, r, u, target, light_frames=None):
        """every lamp at its camera-space direction (coeff: toward camera, right, up) from the view target; a lamp named
        in light_frames = {name: (f, r, u)} takes those coefficients in that frame instead of the camera's (the
        sequence's trailing key light)."""
        for name, ob in self.lights.items():
            a, b, c = ob['coeff']
            fr = (light_frames or {}).get(name)
            if fr is not None:
                lf, lr, lu = (np.asarray(x, dtype=np.float64) for x in fr)
                v = a * (-lf) + b * lr + c * lu
            else:
                v = a * (-f) + b * r + c * u
            v = v / np.linalg.norm(v)
            loc = target + v * LIGHT_DIST
            ob.location = Vector(loc)
            ob.rotation_euler = Vector(target - loc).to_track_quat('-Z', 'Y').to_euler()

    # ---- camera -----------------------------------------------------------------------------------
    def _build_camera(self):
        scene = bpy.context.scene
        cd = bpy.data.cameras.new('LookCam')
        cd.sensor_width = 36.0
        cd.sensor_fit = 'HORIZONTAL'
        cd.clip_start = 0.01
        cd.clip_end = 100.0
        cd.dof.aperture_blades = 0
        self.cam = bpy.data.objects.new('LookCam', cd)
        scene.collection.objects.link(self.cam)
        scene.camera = self.cam

    def _resolve_point(self, spec):
        """a world point given as a 3-tuple or as the name of a feature landmark."""
        if spec is None:
            return None
        if isinstance(spec, str):
            pts = landmark_points(self.feats)
            if spec not in pts:
                print('[look] landmark %r not in the features file; focusing on the target instead' % spec)
                return None
            return np.asarray(pts[spec], dtype=np.float64)
        return np.asarray(spec, dtype=np.float64)

    def project(self, p):
        """world point -> pixel (x right, y down) in the current frame; None if behind the camera."""
        if self._cam is None:
            return None
        f, r, u, cam_loc, tan_half = self._cam
        d = np.asarray(p, dtype=np.float64) - cam_loc
        z = float(d @ f)
        if z <= 1e-6:
            return None
        x = float(d @ r) / z / tan_half
        y = float(d @ u) / z / tan_half
        return [round((0.5 + 0.5 * x) * self.res, 1), round((0.5 - 0.5 * y) * self.res, 1)]

    def frame(self, view, fit_points=None, light_frames=None, **override):
        """aim the camera and the light rig at a view; returns the camera parameters as plain data. light_frames
        ({lamp name: (forward, right, up)}) places those lamps in their own frame instead of the camera's."""
        if isinstance(view, dict):
            V = dict(view)
        else:
            V = dict(VIEWS[view])
        V.update(override)
        f, r, u = camera_basis(V['view_from'], V['up'])
        target = np.asarray(V['target'], dtype=np.float64)
        lens = float(V['lens'])
        tan_half = 18.0 / lens
        if 'width' in V:
            dist = 0.5 * float(V['width']) / tan_half
        else:
            pts = np.asarray(fit_points if fit_points is not None else self.points(), dtype=np.float64)
            if 'fill_h' in V:
                for _ in range(2):        # per-axis fit, recentre on the projected bbox, fit again
                    dist = max(_fit_axis(pts, f, u, target, tan_half, V['fill_h']),
                               _fit_axis(pts, f, r, target, tan_half, V['fill_w']))
                    target = target + _recentre(pts, f, r, u, target, dist, tan_half)
            else:
                dist = fit_distance(pts, f, r, u, target, lens, V['fill'])
        self.cam.data.lens = lens
        place_camera(self.cam, f, r, u, target, dist)
        cam_loc = target - f * dist
        self._cam = (f, r, u, cam_loc, tan_half)
        focus = self._resolve_point(V.get('focus'))
        depth = float(np.dot(focus - cam_loc, f)) if focus is not None else dist
        fstop = float(V.get('fstop', 0.0))
        self.cam.data.dof.use_dof = fstop > 0.0
        self.cam.data.dof.focus_distance = max(depth, 0.01)
        self.cam.data.dof.aperture_fstop = max(fstop, 0.5)
        bpy.context.scene.view_settings.exposure = self.exposure + float(V.get('exposure', 0.0))
        self._place_lights(f, r, u, target, light_frames)
        pts = landmark_points(self.feats)
        marks = {k: self.project(pts[k]) for k in V.get('landmarks', ()) if k in pts}
        return dict(view=view if isinstance(view, str) else 'custom', view_from=list(map(float, V['view_from'])),
                    up=list(map(float, V['up'])), target=[round(float(x), 4) for x in target],
                    lens=lens, dist=round(float(dist), 4), fstop=fstop, focus_depth=round(depth, 4),
                    focus=None if focus is None else [round(float(x), 4) for x in focus],
                    exposure=round(self.exposure + float(V.get('exposure', 0.0)), 3),
                    feather=list(V.get('feather', (0.0, 0.0))), landmarks_px=marks)

    # ---- render -----------------------------------------------------------------------------------
    def _setup_render(self):
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        cyc = scene.cycles
        cyc.samples = self.samples
        cyc.use_adaptive_sampling = True
        cyc.adaptive_threshold = 0.01
        cyc.use_denoising = True
        cyc.denoiser = 'OPENIMAGEDENOISE'
        cyc.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
        cyc.denoising_prefilter = 'ACCURATE'
        cyc.max_bounces = 8
        cyc.diffuse_bounces = 2
        cyc.glossy_bounces = 4
        cyc.transmission_bounces = 0
        cyc.volume_bounces = 0
        cyc.caustics_reflective = False
        cyc.caustics_refractive = False
        cyc.blur_glossy = 0.5
        scene.render.use_persistent_data = True
        scene.render.resolution_x = self.res
        scene.render.resolution_y = self.res
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '8'
        scene.render.image_settings.compression = 50
        scene.view_settings.view_transform = 'Filmic'      # per-channel path for incandescence; see docstring
        try:
            scene.view_settings.look = str(self.p['filmic_look'])
        except TypeError as e:
            print('[render] Filmic look %r not available (%s); using None' % (self.p['filmic_look'], e))
            scene.view_settings.look = 'None'
        scene.view_settings.exposure = self.exposure
        scene.view_settings.gamma = 1.0
        scene.render.use_compositing = False      # bloom is post, on the opaque composite: keep alpha clean
        scene.render.use_sequencer = False
        scene.render.dither_intensity = 1.0
        note = 'CPU'
        if not self.cpu:
            try:
                prefs = bpy.context.preferences.addons['cycles'].preferences
                prefs.compute_device_type = 'ONEAPI'
                prefs.get_devices()
                gpu = [d for d in prefs.devices if d.type == 'ONEAPI']
                for d in prefs.devices:
                    d.use = True
                if gpu:
                    cyc.device = 'GPU'
                    note = 'GPU ONEAPI: ' + ', '.join(d.name for d in gpu)
                else:
                    cyc.device = 'CPU'
                    note = 'CPU (no ONEAPI device found)'
            except Exception as e:  # noqa
                cyc.device = 'CPU'
                note = 'CPU (GPU init failed: %s)' % e
        else:
            cyc.device = 'CPU'
        print('[render] device:', note)
        return note

    def render(self, path):
        scene = bpy.context.scene
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        scene.render.filepath = path
        t0 = time.perf_counter()
        bpy.ops.render.render(write_still=True)
        secs = round(time.perf_counter() - t0, 1)
        print('[render] %s  %.1fs  heat %.2f' % (path, secs, self.heat))
        return secs


def _fit_axis(points, f, axis, target, tan_half, fill):
    """camera distance so that the projected extent along one image axis spans `fill` of the frame."""
    p = points - target[None, :]
    ext = np.abs(p @ axis)
    depth = p @ f
    return float((ext / (fill * tan_half) - depth).max())


def _recentre(points, f, r, u, target, dist, tan_half):
    """shift of the target that centres the projected bounding box in the frame."""
    p = points - target[None, :]
    depth = dist + p @ f
    x = (p @ r) / depth / tan_half
    y = (p @ u) / depth / tan_half
    cx = 0.5 * (x.min() + x.max())
    cy = 0.5 * (y.min() + y.max())
    return (cx * r + cy * u) * tan_half * dist


# ==================================================================================================
# feather + composite + metrics (plain python, PIL)
# ==================================================================================================
def _smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


FEATHER_TAG = 'solidify_feather'


def feather_alpha(path, bottom=0.0, left=0.0):
    """fade the straight alpha of a transparent PNG to 0 over the bottom / left fraction of the frame
    (RGB untouched), in place, and tag the file (PNG tEXt chunk) so a later composite pass over the same
    directory does not feather it a second time. Returns True if anything was changed."""
    if bottom <= 0.0 and left <= 0.0:
        return False
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo
    im0 = Image.open(path)
    if FEATHER_TAG in getattr(im0, 'text', {}) or FEATHER_TAG in im0.info:
        print('[feather] %s already feathered (%s); skipped' % (os.path.basename(path), im0.info.get(FEATHER_TAG) or im0.text.get(FEATHER_TAG)))
        return False
    im = im0.convert('RGBA')
    arr = np.asarray(im).copy()
    h, w = arr.shape[:2]
    wgt = np.ones((h, w), dtype=np.float32)
    if bottom > 0.0:
        y = np.arange(h, dtype=np.float32)
        y0 = (1.0 - bottom) * (h - 1)
        wgt *= (1.0 - _smoothstep((y - y0) / max((h - 1) - y0, 1.0)))[:, None]
    if left > 0.0:
        x = np.arange(w, dtype=np.float32)
        x1 = left * (w - 1)
        wgt *= _smoothstep(x / max(x1, 1.0))[None, :]
    arr[..., 3] = np.round(arr[..., 3].astype(np.float32) * wgt).astype(np.uint8)
    meta = PngInfo()
    meta.add_text(FEATHER_TAG, 'bottom=%.3f left=%.3f' % (bottom, left))
    Image.fromarray(arr, 'RGBA').save(path, optimize=True, pnginfo=meta)
    return True


def _hue_deg(rgb):
    r, g, b = [float(x) for x in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    if mx <= mn:
        return 0.0
    if mx == r:
        return (60.0 * (g - b) / (mx - mn)) % 360.0
    if mx == g:
        return 120.0 + 60.0 * (b - r) / (mx - mn)
    return 240.0 + 60.0 * (r - g) / (mx - mn)


def local_sharpness(lum, alpha, cx, cy, half=40):
    """focus readout around (cx, cy): p99 / p90 of the luminance gradient magnitude inside the object
    (silhouette excluded: the 3 px next to the alpha edge are dropped so contrast against the void does not
    count), and edge_grad_p90 = p90 of the alpha gradient on the silhouette itself: a hard, in-focus edge
    steps ~255 in one pixel, a defocused one spreads over its blur circle (255 / n px)."""
    h, w = lum.shape
    x0, x1 = max(int(cx) - half, 0), min(int(cx) + half, w)
    y0, y1 = max(int(cy) - half, 0), min(int(cy) + half, h)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    a = alpha[y0:y1, x0:x1].astype(np.float32)
    m = a > 250
    for _ in range(3):        # erosion by 1 px, 4-neighbourhood
        mm = m.copy()
        mm[1:] &= m[:-1]
        mm[:-1] &= m[1:]
        mm[:, 1:] &= m[:, :-1]
        mm[:, :-1] &= m[:, 1:]
        m = mm
    out = {}
    if m.sum() >= 50:
        gy, gx = np.gradient(lum[y0:y1, x0:x1])
        g = np.hypot(gx, gy)[m]
        out.update(p99=round(float(np.percentile(g, 99)), 1), p90=round(float(np.percentile(g, 90)), 1), n=int(m.sum()))
    ay, ax = np.gradient(a)
    ag = np.hypot(ax, ay)
    edge = (a > 8) & (a < 247)
    if edge.sum() >= 20:
        out['edge_grad_p90'] = round(float(np.percentile(ag[edge], 90)), 1)
        out['edge_px'] = int(edge.sum())
    return out or None


def composite_and_metrics(paths, bg=PAGE_BG, suffix='_on-0a0a0a', shot_info=None):
    """straight-alpha 'over' onto the page colour in display (sRGB-encoded) space, exactly as a browser
    composites a transparent PNG, plus a readout per still. shot_info (from report.json) supplies per-shot
    feather fractions (applied to the transparent PNG first) and landmark pixels (local sharpness).
    Returns {stem: metrics}."""
    from PIL import Image
    shot_info = shot_info or {}
    out = {}
    for path in paths:
        stem = os.path.splitext(os.path.basename(path))[0]
        info = shot_info.get(stem, {})
        cam = info.get('camera', {})
        fb, fl = (cam.get('feather') or [0.0, 0.0])[:2]
        feathered = feather_alpha(path, float(fb), float(fl))
        im = Image.open(path).convert('RGBA')
        base = Image.new('RGBA', im.size, tuple(bg) + (255,))
        comp = Image.alpha_composite(base, im)
        dst = os.path.splitext(path)[0] + suffix + '.png'
        comp.convert('RGB').save(dst, optimize=True)

        src = np.asarray(im)
        a = src[..., 3]
        c = np.asarray(comp)[..., :3].astype(np.int32)
        h, w = a.shape
        m = a >= 128
        n = int(m.sum())
        rows = np.where(m.any(axis=1))[0]
        cols = np.where(m.any(axis=0))[0]
        rgb = c[m]
        luma = 0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]
        mid = (luma >= 60.0) & (luma <= 170.0)
        mrgb = rgb[mid] if mid.any() else rgb
        med = np.median(rgb, axis=0)
        lum_full = 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
        stats = {
            'composite': dst,
            'feathered': feathered,
            'object_px': n,
            'coverage_pct': round(100.0 * n / float(h * w), 2),
            'height_frac': round((rows[-1] - rows[0] + 1) / float(h), 3) if len(rows) else 0.0,
            'width_frac': round((cols[-1] - cols[0] + 1) / float(w), 3) if len(cols) else 0.0,
            'midtone_px': int(mid.sum()),
            'midtone_rb': round(float(mrgb[:, 0].mean() / max(mrgb[:, 2].mean(), 1e-6)), 3),
            'midtone_gb': round(float(mrgb[:, 1].mean() / max(mrgb[:, 2].mean(), 1e-6)), 3),
            'midtone_mean_rgb': [round(float(v), 1) for v in mrgb.mean(axis=0)],
            'median_rgb': [int(v) for v in med],
            'median_hue_deg': round(_hue_deg(med), 1),
            'median_bg': round(float(med[2]) / max(float(med[1]), 1e-6), 3),
            'hue_p5_p95_deg': [round(float(np.percentile([_hue_deg(x) for x in rgb[::max(1, n // 4000)]], q)), 1) for q in (5, 95)],
            'warm_px_pct_RminusB_gt40': round(100.0 * float(((rgb[:, 0] - rgb[:, 2]) > 40).mean()), 2),
            'cool_px_pct_BminusG_gt4': round(100.0 * float(((rgb[:, 2] - rgb[:, 1]) > 4).mean()), 2),
            'luma_20_60_pct': round(100.0 * float(((luma >= 20.0) & (luma <= 60.0)).mean()), 2),
            'clip240_pct_maxch': round(100.0 * float((rgb.max(axis=1) >= 240).mean()), 2),
            'clip240_pct_luma': round(100.0 * float((luma >= 240.0).mean()), 2),
            'luma_mean': round(float(luma.mean()), 1),
            'luma_p50': round(float(np.percentile(luma, 50)), 1),
            'luma_p99': round(float(np.percentile(luma, 99)), 1),
            'edge_opaque_px': {'bottom_row': int((a[-1] >= 128).sum()), 'top_row': int((a[0] >= 128).sum()),
                               'left_col': int((a[:, 0] >= 128).sum()), 'right_col': int((a[:, -1] >= 128).sum())},
            'corner_rgba': [int(v) for v in src[0, 0]],
        }
        marks = cam.get('landmarks_px') or {}
        if marks:
            stats['sharpness'] = {k: local_sharpness(lum_full, a, v[0], v[1]) for k, v in marks.items() if v is not None}
        out[stem] = stats
        print('[composite] %s -> %s%s' % (os.path.basename(path), os.path.basename(dst),
                                          '  (alpha feathered bottom %.2f left %.2f)' % (fb, fl) if feathered else ''))
        print('[metrics]   %s' % json.dumps({k: v for k, v in stats.items() if k not in ('composite',)}))
    return out


def _collect_pngs(items, suffix='_on-0a0a0a'):
    paths = []
    for it in items:
        if os.path.isdir(it):
            for fn in sorted(os.listdir(it)):
                if fn.lower().endswith('.png') and not fn.lower().endswith(suffix + '.png'):
                    paths.append(os.path.join(it, fn))
        elif it.lower().endswith('.png'):
            paths.append(it)
    return paths


def _read_report(out_dir):
    rpath = os.path.join(out_dir, 'report.json')
    if os.path.isfile(rpath):
        try:
            with open(rpath) as fh:
                return json.load(fh)
        except Exception as e:  # noqa
            print('[report] could not read %s: %s' % (rpath, e))
    return {}


def _merge_metrics_into_report(out_dir, metrics):
    rpath = os.path.join(out_dir, 'report.json')
    report = _read_report(out_dir)
    shots = report.setdefault('shots', {})
    for stem, st in metrics.items():
        shots.setdefault(stem, {})['metrics'] = st
    with open(rpath, 'w') as fh:
        json.dump(report, fh, indent=1, default=str)
    print('[report] ->', rpath)


def run_composite_subprocess(out_dir):
    """from inside Blender: composite with the system python (Blender's python has no PIL)."""
    exe = None
    for cand in ('python', 'python3', 'py'):
        p = shutil.which(cand)
        if p and 'blender' not in p.lower():
            exe = p
            break
    cmd = [exe or 'python', os.path.abspath(__file__), '--composite', out_dir]
    print('[composite] running:', ' '.join(cmd))
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except Exception as e:  # noqa
        print('[composite] FAILED to launch (%s); run manually:\n  %s' % (e, ' '.join(cmd)))
        return False
    print(r.stdout)
    if r.returncode != 0:
        print('[composite] FAILED (%d); run manually:\n  %s\n%s' % (r.returncode, ' '.join(cmd), r.stderr))
        return False
    return True


# ==================================================================================================
# CLI
# ==================================================================================================
def parse_args(argv):
    p = argparse.ArgumentParser(description='SOLIDIFY hero dendrite: final look (Blender 4.5 Cycles, headless)')
    p.add_argument('--shots', default=DEFAULT_SHOTS, help='"label:t:h:view;..." (view = hero | close)')
    p.add_argument('--blend', default=DEFAULT_BLEND, help='.blend path pattern with {t}')
    p.add_argument('--features', default=DEFAULT_FEATURES, help='features json pattern with {t} (landmarks, focus)')
    p.add_argument('--fit-t', type=float, default=1.0, help='crystal every view is framed on')
    p.add_argument('--out', default=DEFAULT_OUT)
    p.add_argument('--res', type=int, default=1000)
    p.add_argument('--samples', type=int, default=128)
    p.add_argument('--exposure', type=float, default=-0.3, help='view exposure (EV); Filmic sits ~0.3 EV brighter than AgX in the mids')
    p.add_argument('--cpu', action='store_true')
    p.add_argument('--set', action='append', default=[], metavar='KEY=VALUE',
                   help='look tweak, e.g. --set rough=0.27 --set base=0.56,0.57,0.58 --set key=1.2')
    p.add_argument('--view', action='append', default=[], metavar='VIEW.KEY=VALUE',
                   help='view override, e.g. --view hero.view_from=1,-1.6,0.7 --view close.width=0.5')
    p.add_argument('--no-composite', action='store_true')
    p.add_argument('--composite', nargs='*', metavar='DIR_OR_PNG',
                   help='(plain python) feather + composite stills onto #0a0a0a and write metrics; no rendering')
    return p.parse_args(argv)


def _value(s):
    s = s.strip()
    if ',' in s:
        return tuple(float(x) for x in s.split(','))
    try:
        return float(s)
    except ValueError:
        return s


def parse_set(items):
    out = {}
    for it in items:
        k, v = it.split('=', 1)
        out[k.strip()] = _value(v)
    return out


def parse_view(items):
    out = {}
    for it in items:
        k, v = it.split('=', 1)
        view, key = k.strip().split('.', 1)
        out.setdefault(view, {})[key] = _value(v)
    return out


def parse_shots(s):
    shots = []
    for part in s.split(';'):
        part = part.strip()
        if not part:
            continue
        label, t, h, view = [x.strip() for x in part.split(':')]
        shots.append((label, float(t), float(h), view))
    return shots


def main_blender(A):
    os.makedirs(A.out, exist_ok=True)
    tweaks = parse_set(A.set)
    overrides = parse_view(A.view)
    shots = parse_shots(A.shots)
    L = Look(res=A.res, samples=A.samples, cpu=A.cpu, exposure=A.exposure, **tweaks)
    L.load(A.blend.format(t=A.fit_t), A.features.format(t=A.fit_t))
    fit = L.points()
    current_t = A.fit_t
    report = {'device': L.device, 'args': vars(A).copy(), 'look': L.p,
              'views': {k: dict(v, **overrides.get(k, {})) for k, v in VIEWS.items()}, 'shots': {}}
    rpath = os.path.join(A.out, 'report.json')
    if os.path.isfile(rpath):                 # a partial re-render keeps the other shots' entries
        try:
            with open(rpath) as fh:
                report['shots'] = json.load(fh).get('shots', {})
        except Exception as e:  # noqa
            print('[report] could not merge previous report: %s' % e)
    L.set_growth(reach_of(L.feats, current_t), current_t)
    for label, t, h, view in shots:
        if abs(t - current_t) > 1e-9:
            L.swap(A.blend.format(t=t), A.features.format(t=t))
            current_t = t
            L.set_growth(reach_of(L.feats, t), t)
        cam = L.frame(view, fit, **overrides.get(view, {}))
        L.set_heat(h)
        path = os.path.join(A.out, label + '.png')
        secs = L.render(path)
        report['shots'][label] = dict(t=t, heat=h, view=view, seconds=secs, device=L.device,
                                      verts=len(L.ob.data.vertices), camera=cam, png=path)
        with open(rpath, 'w') as fh:
            json.dump(report, fh, indent=1, default=str)
    print('[report] ->', rpath)
    if not A.no_composite:
        run_composite_subprocess(A.out)


def main_python(A):
    paths = _collect_pngs(A.composite)
    if not paths:
        print('[composite] nothing to do')
        return 0
    dirs = sorted({os.path.dirname(os.path.abspath(p)) for p in paths})
    info = {}
    for d in dirs:
        info.update(_read_report(d).get('shots', {}))
    try:
        metrics = composite_and_metrics(paths, shot_info=info)
    except ImportError as e:
        print('[composite] PIL/numpy missing in this python (%s): pip install pillow numpy' % e)
        return 3
    for d in dirs:
        _merge_metrics_into_report(d, {k: v for k, v in metrics.items()
                                       if os.path.dirname(os.path.abspath(v['composite'])) == d})
    return 0


if __name__ == '__main__':
    if bpy is not None:
        argv = sys.argv
        argv = argv[argv.index('--') + 1:] if '--' in argv else []
        A = parse_args(argv)
        if A.composite is not None:
            sys.exit(main_python(A))
        main_blender(A)
    else:
        A = parse_args(sys.argv[1:])
        if A.composite is None:
            print('outside Blender only --composite is available:\n  python look.py --composite DIR', file=sys.stderr)
            sys.exit(2)
        sys.exit(main_python(A))
