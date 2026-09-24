"""
topo_check.py -- topology audit of ANY generator module (the v1 reference copy, an archived version, or the
current dendrite_gen.py) with the current module's gate code. Builds the mesh at each stage the way the v1
main() did (skeleton -> spheres -> SDF -> closing -> smoothing) and reports V, E, F, Euler characteristic,
components and genus. No render. Exit code 2 with --strict if any stage is not one closed genus-0 surface.

  blender.exe -b --factory-startup --python hero/topo_check.py -- --module C:/path/to/dendrite_gen_v1_ref.py \
      --stages 0.1,0.3,0.6,1.0 --out C:/Users/frank/solidify-hero-out/v3/topo_v1.json [--strict] -- <generator args>

Anything after a second '--' is passed to the module's own parse_args (e.g. --seed 7 --tertiary-density 0).
"""
import argparse
import importlib.util
import json
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import dendrite_gen as GATE   # noqa: E402  (mesh_topology, mesh_bbox, clear_scene)


def load_module(path):
    spec = importlib.util.spec_from_file_location('gen_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_v1_style(M, A, t):
    """the v1 main() build steps, run against module M (v1 and v3 share these function names)."""
    A.t = t
    t0 = time.perf_counter()
    rng = M.np.random.default_rng(A.seed)
    arms = M.build_skeleton(A, rng)
    if hasattr(M, 'update_states'):
        M.update_states(arms, t, A)
    else:
        for a in arms:
            M.set_state(a, t)
    pts = M.collect_points(arms, t, A)
    skel = M.make_skeleton_object(pts)
    if hasattr(A, 'open_voxels'):
        ng = M.build_gn_tree(A.voxel, A.fillet, t, A.open_voxels * A.voxel)
    else:
        ng = M.build_gn_tree(A.voxel, A.fillet, t)
    mod = skel.modifiers.new('DendriteSDF', 'NODES')
    mod.node_group = ng
    me = M.evaluated_mesh(skel)
    skel.modifiers.remove(mod)
    ob = bpy.data.objects.new('Dendrite', me)
    bpy.context.scene.collection.objects.link(ob)
    if A.smooth_iters > 0:
        sm = ob.modifiers.new('Smooth', 'SMOOTH')
        sm.factor = 0.5
        sm.iterations = A.smooth_iters
        me2 = M.evaluated_mesh(ob)
        ob.modifiers.remove(sm)
        ob.data = me2
        bpy.data.meshes.remove(me)
        me = me2
    alive = [a for a in arms if a.alive]
    counts = {'alive_primary': sum(a.gen == 0 for a in alive), 'alive_secondary': sum(a.gen == 1 for a in alive),
              'alive_tertiary': sum(a.gen == 2 for a in alive), 'arms_total': len(arms),
              'alive_tertiary_in_plane': sum(1 for a in alive if a.gen == 2 and a.row < 2),
              'alive_tertiary_out_of_plane': sum(1 for a in alive if a.gen == 2 and a.row >= 2),
              'alive_secondary_growing': sum(1 for a in alive if a.gen == 1 and a.age < a.stop_age),
              'alive_tertiary_growing': sum(1 for a in alive if a.gen == 2 and a.age < a.stop_age)}
    tl = M.np.array([a.L - a.R_root for a in alive if a.gen == 2])
    if len(tl):
        counts['tertiary_protrusion'] = {'median': round(float(M.np.median(tl)), 5), 'max': round(float(tl.max()), 5),
                                         'cv': round(float(tl.std() / tl.mean()), 4)}
    return me, counts, round(time.perf_counter() - t0, 1)


def main():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    gen_argv = []
    if '--' in argv:
        k = argv.index('--')
        argv, gen_argv = argv[:k], argv[k + 1:]
    p = argparse.ArgumentParser(description='topology audit of a dendrite generator module (Blender, headless)')
    p.add_argument('--module', required=True, help='path of the generator .py to test')
    p.add_argument('--stages', default='0.1,0.3,0.6,1.0')
    p.add_argument('--out', default='', help='JSON report path')
    p.add_argument('--strict', action='store_true', help='exit code 2 if any stage fails the gate')
    A_ = p.parse_args(argv)

    M = load_module(A_.module)
    saved = sys.argv
    sys.argv = ['blender', '--'] + gen_argv + ['--no-render']
    try:
        A = M.parse_args()
    finally:
        sys.argv = saved
    stages = [float(x) for x in A_.stages.split(',') if x.strip()]
    rows = []
    all_ok = True
    for t in stages:
        GATE.clear_scene()
        me, counts, secs = build_v1_style(M, A, t)
        topo = GATE.mesh_topology(me)
        ok = topo['single_closed_genus0_surface']
        all_ok &= ok
        row = dict(t=t, seconds=secs, counts=counts, **topo)
        rows.append(row)
        print('[topo] %s t=%.2f: V=%d E=%d F=%d chi=%d comp=%d genus=%s watertight=%s -> %s | %s' % (
            os.path.basename(A_.module), t, topo['vertices'], topo['edges'], topo['faces'], topo['euler_characteristic'],
            topo['components'], topo['genus_total'], topo['watertight'], 'PASS' if ok else 'FAIL', json.dumps(counts)))
        sys.stdout.flush()
    print('\n[topo]   t    verts   chi comp genus  gate   sec  tert')
    for r in rows:
        print('[topo] %4.2f %8d %5d %4d %5.1f  %s %4d %5d' % (r['t'], r['vertices'], r['euler_characteristic'], r['components'],
                                                          r['genus_total'], 'PASS' if r['single_closed_genus0_surface'] else 'FAIL',
                                                          r['counts']['alive_secondary'], r['counts']['alive_tertiary']))
    if A_.out:
        os.makedirs(os.path.dirname(os.path.abspath(A_.out)), exist_ok=True)
        with open(A_.out, 'w') as fh:
            json.dump({'module': A_.module, 'generator_args': gen_argv, 'stages': rows, 'all_pass': all_ok}, fh, indent=1)
        print('[topo] ->', A_.out)
    if A_.strict and not all_ok:
        sys.stdout.flush()
        sys.exit(GATE.GATE_EXIT_CODE)


if __name__ == '__main__':
    main()
