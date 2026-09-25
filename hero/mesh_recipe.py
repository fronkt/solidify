"""
mesh_recipe.py -- how the hero's meshes are built (Blender 4.5, headless): the generator's mesh at any growth time and
the close-up mesh the frozen frames render. mesh_cache.py stores what these functions build; its fingerprint hashes
the code of THIS file and of dendrite_gen.py (and their constants), not the cache's own I/O, so an edit to how meshes
are saved, loaded or logged keeps every cached mesh and an edit to how one is built drops them all.

Two kinds of mesh:
  gen   dendrite_gen.build(A, t): the generator's own mesh (SDF voxel A.voxel = 0.004, A.smooth_iters smoothing passes),
        which every growth frame renders;
  fine  build_fine(A, t): the close-up mesh the frozen frames render (t = 1). It is NOT the generator's mesh at a finer
        resolution only: the same skeleton and arm states on a FINE_VOXEL = 0.002 SDF grid with FINE_SMOOTH_ITERS
        passes, PLUS a sphere of up to TERT_TIP_MIN radius behind every living tertiary's drawn apex (so tertiary tips
        read round in close-ups; capped by the arm's own envelope there). The frame sequence switches from the one to
        the other once, on the first frozen frame (the last growth step, at the full view); README.md gives the
        measured size of that change.
Both run dendrite_gen's topology gate (one closed genus-0 surface) when they are built.
The skeleton does not depend on t and costs ~50-80 s; mesh_cache.py memoizes it per parameter set (skeleton_at here
calls dendrite_gen.build_skeleton, which mesh_cache replaces with the memoized version on import).
"""
import json
import sys
import time

import numpy as np

import bpy

import dendrite_gen as DG

# the close-up mesh: every frozen frame renders the same t = 1 crystal meshed on a finer SDF grid. At the generator's
# 0.004 voxel a secondary tip (rho 0.009) is 2.2 voxels and a tertiary tip (0.0054) 1.35, and the closing / opening
# (erode by fillet + opening, dilate back) squeezes a tertiary's core below one voxel, so in close-ups the secondary tips
# mesh as chisel bevels and the tertiary tips as cones with a nub. The skeleton, the arm states (channel caps, necks)
# and the closing / opening radii stay the generator's, in model units; the skeleton and every voxel-dependent growth
# rule still see A.voxel. What differs from the generator's t = 1 mesh: the resolution (finer grid, more smoothing
# passes, so thin parts shrink less) and the tertiary tip spheres (TERT_TIP_MIN), which make every long tertiary's tip
# up to 1.48x blunter than its rho.
FINE_VOXEL = 0.002
FINE_SMOOTH_ITERS = 4        # the generator smooths 2 iterations at 0.004; half the edge length needs more passes for
                             # the same smoothing length (4 at 0.002 smooths ~0.7 of it and shrinks thin parts half as
                             # much)
TERT_TIP_MIN = 0.008         # minimum tertiary tip radius in the close-up mesh (model units; the tertiary rho is 0.0054):
                             # one extra sphere of this radius just behind each living tertiary's DRAWN apex (the apex
                             # does not move), capped by the arm's own envelope radius there so a thin, capped tertiary
                             # gets no knob. The opening erodes a cap by 0.004 before growing it back, so the cap's core
                             # must stay a few voxels wide: at 0.0065 the longest tertiaries still ended in a 2-3 px
                             # point, at 0.008 they are round


def skeleton_at(A, t):
    """the skeleton (memoized when mesh_cache is imported) with its states at growth time t."""
    arms = DG.build_skeleton(A, np.random.default_rng(A.seed))
    DG.update_states(arms, t, A)
    return arms


def drop_helpers():
    """remove the generator's helper point object and orphan meshes / node groups."""
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


def alive_counts(arms):
    alive = [a for a in arms if a.alive]
    return {'primary': sum(a.gen == 0 for a in alive), 'secondary': sum(a.gen == 1 for a in alive),
            'tertiary': sum(a.gen == 2 for a in alive),
            'emerging': sum(1 for a in alive if DG.emerge_shift(a) > 0.0)}


def build_gen(A, t):
    """dendrite_gen.build at growth time t (its own gate); returns (object, meta)."""
    ob, me, arms, _co, stats, ok = DG.build(A, t)
    drop_helpers()
    topo = {k: v for k, v in stats['mesh'].items() if k != 'small_components'}
    meta = dict(kind='gen', t=t, voxel=A.voxel, smooth_iters=A.smooth_iters, gate='PASS' if ok else 'FAIL',
                topology=topo, small_components=stats['mesh'].get('small_components'),
                reach=max(a.L for a in arms if a.gen == 0), counts=alive_counts(arms),
                build_seconds=stats['timings_seconds']['build_total'])
    print('[mesh] gen t=%.4f: %d verts, gate %s, %.1fs' % (t, topo['vertices'], meta['gate'], meta['build_seconds']))
    return ob, meta


def fine_points(arms, t, A, voxel, tip_min):
    """the generator's sphere set (dendrite_gen.collect_points, the drawn crystal) with the arms sampled for a `voxel`
    grid instead of A.voxel, plus the tertiary tip spheres: for each living tertiary that protrudes at least 2 tip_min,
    one sphere of radius r = min(tip_min, envelope radius r behind the drawn apex) centered r behind that apex.
    Returns (points, number of tip spheres, their radii)."""
    out = {'pos': [np.zeros((1, 3))], 'rad': [np.array([DG.nucleus_radius(A, t)])], 'birth': [np.array([0.0])],
           'gen': [np.array([-1], dtype=np.int32)], 'arm': [np.array([-1], dtype=np.int32)]}
    for a in arms:
        DG.sample_arm(a, t, voxel, out)
    radii = []
    if tip_min > 0.0:
        for a in arms:
            if not (a.alive and a.gen == 2) or (a.L - a.R_root) < 2.0 * tip_min:
                continue
            L = a.L - DG.emerge_shift(a)           # the drawn apex (a retracting tertiary's is below its skeleton's)
            if L - a.R_root < 2.0 * tip_min:
                continue
            r = tip_min
            for _ in range(3):             # the envelope r behind the apex, never a knob wider than the arm there
                r = min(tip_min, float(DG.arm_profile(a, t, np.array([r]), shift=False, L=L)[0][0]))
            if r <= 0.0:
                continue
            tb = float(DG.arm_profile(a, t, np.array([r]), shift=True, L=L)[2][0])
            out['pos'].append((a.origin + a.d * (L - r))[None, :])
            out['rad'].append(np.array([r]))
            out['birth'].append(np.array([tb]))
            out['gen'].append(np.array([2], dtype=np.int32))
            out['arm'].append(np.array([a.idx], dtype=np.int32))
            radii.append(r)
    return {k: np.concatenate(v) for k, v in out.items()}, len(radii), radii


def build_fine(A, t, voxel=FINE_VOXEL, smooth_iters=FINE_SMOOTH_ITERS, tip_min=TERT_TIP_MIN):
    """the close-up mesh: dendrite_gen.build's steps at growth time t with the same skeleton (memoized), the same arm
    states (update_states with the generator's A, so every voxel-dependent growth rule sees A.voxel) and the same
    closing and opening radii in model units, but the spheres sampled for, and the SDF meshed on, a `voxel` grid, the
    tertiary tip spheres added (fine_points) and smooth_iters Laplacian passes. Runs the generator's topology gate on
    the result. Returns (object, meta)."""
    t0 = time.perf_counter()
    arms = skeleton_at(A, t)
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
    drop_helpers()
    co, _bb = DG.mesh_bbox(me)
    topo = DG.mesh_topology(me, co)
    ok = bool(topo['single_closed_genus0_surface'])
    secs = time.perf_counter() - t0
    print('[mesh] fine t=%.4f voxel %.4f: %d verts, %d faces, chi %d, components %d, genus %s, gate %s; %d tertiary '
          'tip spheres (radius %.4f..%.4f); %.1fs' % (
              t, voxel, topo['vertices'], topo['faces'], topo['euler_characteristic'], topo['components'],
              topo['genus_total'], 'PASS' if ok else 'FAIL', n_tip, min(radii) if radii else 0.0,
              max(radii) if radii else 0.0, secs))
    if topo.get('small_components'):
        print('[mesh] fine mesh small components:', json.dumps(topo['small_components']))
    sys.stdout.flush()
    meta = dict(kind='fine', t=t, voxel=voxel, smooth_iters=smooth_iters, tip_min=tip_min, tip_spheres=n_tip,
                gate='PASS' if ok else 'FAIL', topology={k: v for k, v in topo.items() if k != 'small_components'},
                small_components=topo.get('small_components'), reach=max(a.L for a in arms if a.gen == 0),
                counts=alive_counts(arms), build_seconds=round(secs, 2))
    return ob, meta


BUILDERS = {'gen': build_gen, 'fine': build_fine}


def kind_params(kind, A):
    """the per-kind parameters a cached mesh's key carries (on top of the fingerprint, the kind and t)."""
    if kind == 'gen':
        return {'voxel': A.voxel, 'smooth_iters': A.smooth_iters}
    return {'voxel': FINE_VOXEL, 'smooth_iters': FINE_SMOOTH_ITERS, 'tip_min': TERT_TIP_MIN}
