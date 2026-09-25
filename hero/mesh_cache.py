"""
mesh_cache.py -- the hero's meshes, built once per growth time and kept on disk, so the previews and the final render
use the same meshes and never rebuild one (Blender 4.5, headless; imported by render_sequence.py and topo_check.py).

What a mesh IS lives in mesh_recipe.py (the generator's mesh 'gen' at any t, the close-up mesh 'fine' at t = 1); this
file only stores, loads and keys them. Every mesh runs dendrite_gen's topology gate (one closed genus-0 surface) when
it is built; a mesh that FAILS is returned to the caller (which refuses to render it unless told --gate-soft) but never
saved, so a later run builds it again instead of serving a failed mesh as a cache hit.

The skeleton does not depend on t and costs ~50-80 s, so it is memoized per parameter set (installed on import:
build() follows build_skeleton with update_states(arms, t, A), which rewrites every per-time field from the static ones).

Cache layout: <root>/<fingerprint[:16]>/<kind>_t<t, 9 decimals>.npz, one file per (kind, t), written atomically (a
per-process temp name, then os.replace, retried while another process holds the file).
The fingerprint (sha1) covers everything that shapes a mesh and nothing else:
  * the CODE of dendrite_gen.py and mesh_recipe.py (path_plan.code_digest: the syntax tree without docstrings, so a
    comment or docstring edit keeps the cache and any code edit drops it) and the live values of their UPPER_CASE
    constants (a constant patched at run time counts as an edit). This file's own code is NOT in it: an edit to how
    meshes are saved, loaded or logged keeps every cached mesh;
  * every generator argument that shapes the crystal (all but the render and IO ones, path_plan.GEN_ARG_SKIP);
  * the Blender version (the SDF and mesh nodes) and numpy's (the skeleton's random draws).
Each file also carries its full key, sha1 of (fingerprint, kind, t, the kind's own parameters), which load compares
before it trusts the file; a key mismatch, an unreadable file or arrays that disagree with the stored counts mean a
rebuild. Superseded fingerprint directories are never read again; MeshCache.prune() (render_sequence.py --prune-cache)
deletes them.
Stored per mesh: the vertex coordinates (float32), the polygon corners (vertex index per loop) and polygon starts
(int32), the 'age' attribute (float32; 'birth' = t - age is restored on load) and meta (key, t, kind, voxel, gate,
topology, reach = the primary arm length, alive-arm counts, vertex / loop / polygon / edge counts, build seconds). A
loaded mesh is the built one: the same vertices in the same order and the same polygons (edges recomputed and checked
against the stored count), smooth shaded. The planner (path_plan.py, no Blender) reads the close-up mesh's 'co' array
straight from its file to measure screen motion on the frozen frames.

  import mesh_cache as MC
  cache = MC.MeshCache(A)                         # A: dendrite_gen.parse_args() (render_sequence.gen_args)
  ob, meta, secs, how = cache.get('gen', t)       # how = 'hit' (loaded) or 'build' (built; saved if it passed the gate)
"""
import hashlib
import json
import os
import shutil
import sys
import time

import numpy as np

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import dendrite_gen as DG   # noqa: E402
import mesh_recipe as MR     # noqa: E402
import path_plan as PP       # noqa: E402

DEFAULT_ROOT = 'C:/Users/frank/solidify-hero-out/v4/cache/mesh'
KINDS = ('gen', 'fine')
# the recipe's names, for the callers that import them from here
FINE_VOXEL = MR.FINE_VOXEL
FINE_SMOOTH_ITERS = MR.FINE_SMOOTH_ITERS
TERT_TIP_MIN = MR.TERT_TIP_MIN
build_gen = MR.build_gen
build_fine = MR.build_fine
fine_points = MR.fine_points
skeleton_at = MR.skeleton_at
drop_helpers = MR.drop_helpers
alive_counts = MR.alive_counts
kind_params = MR.kind_params
BUILDERS = MR.BUILDERS


# ---- skeleton memo -------------------------------------------------------------------------------------------------
_SKELETONS = {}
_build_skeleton_fresh = DG.build_skeleton
_SKELETON_KEYS = ('seed', 'tip_radius', 'arm_length', 'rho_ratio', 'rho_ratio_tertiary', 'onset', 'lambda0',
                  'coarsen_tau', 'tertiary_density', 'neck', 'speed_ratio', 'voxel', 'fillet', 'only_arms',
                  'no_clearance')


def cached_build_skeleton(A, rng):
    """dendrite_gen.build_skeleton once per parameter set. The skeleton is t-independent (stations, vigor, space
    limits, births, the clearance caps); build() follows this call with update_states(arms, t, A), which rewrites every
    per-time field (age, L, R_root, alive, k_neck, w_free, w_now, r_cap) from the static ones, so the same Arm objects
    serve every t. The rng is consumed only on the first call; nothing after build_skeleton draws from it."""
    key = tuple((k, getattr(A, k, None)) for k in _SKELETON_KEYS)
    if key not in _SKELETONS:
        t0 = time.perf_counter()
        _SKELETONS[key] = _build_skeleton_fresh(A, rng)
        print('[mesh] skeleton built in %.1fs (memoized for this run)' % (time.perf_counter() - t0))
    return _SKELETONS[key]


DG.build_skeleton = cached_build_skeleton


# ---- keys and files ------------------------------------------------------------------------------------------------
def fingerprint(A):
    """(sha1 hex, the shaping arguments): the code and live constants of dendrite_gen.py and mesh_recipe.py, the
    shaping args, Blender and numpy."""
    h = hashlib.sha1()
    for path in (DG.__file__, MR.__file__):
        h.update(PP.code_digest(path).encode())
    consts = dict(PP.live_constants(DG, 'DG'), **PP.live_constants(MR, 'MR'))
    h.update(json.dumps(consts, sort_keys=True, default=str).encode())
    args = {k: v for k, v in sorted(vars(A).items()) if k not in PP.GEN_ARG_SKIP}
    h.update(json.dumps(args, sort_keys=True, default=str).encode())
    h.update(('blender %s | numpy %s' % (bpy.app.version_string, np.__version__)).encode())
    return h.hexdigest(), args


def t_tag(t):
    return '%.9f' % float(t)


class CacheMiss(Exception):
    pass


def replace_retry(tmp, path, tries=20, wait=0.25):
    """os.replace, retried while Windows reports the target busy (another process reading or writing it)."""
    for k in range(tries):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if k == tries - 1:
                raise
            time.sleep(wait)


def mesh_counts(me):
    return dict(vertices=len(me.vertices), loops=len(me.loops), polygons=len(me.polygons), edges=len(me.edges))


def save_mesh(path, me, meta):
    """write mesh `me` with its (complete) meta, atomically. meta must carry the key and the counts (MeshCache.get
    puts them there)."""
    c = mesh_counts(me)
    if any(meta.get(k) != v for k, v in c.items()) or 'key' not in meta:
        raise ValueError('save_mesh: meta does not describe this mesh (%s vs %s)' % (
            {k: meta.get(k) for k in c}, c))
    co = np.empty(c['vertices'] * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    lv = np.empty(c['loops'], dtype=np.int32)
    me.loops.foreach_get('vertex_index', lv)
    ls = np.empty(c['polygons'], dtype=np.int32)
    me.polygons.foreach_get('loop_start', ls)
    age = np.empty(c['vertices'], dtype=np.float32)
    me.attributes['age'].data.foreach_get('value', age)
    tmp = '%s.%d.part' % (path, os.getpid())
    with open(tmp, 'wb') as fh:
        np.savez(fh, key=np.array(meta['key']), meta=np.array(json.dumps(meta, default=str)), co=co, loops=lv,
                 loop_start=ls, age=age)
    replace_retry(tmp, path)
    return os.path.getsize(path)


def load_mesh(path, key, name='Dendrite'):
    """the stored mesh as a new object linked to the scene, or CacheMiss (other key, unreadable, inconsistent)."""
    try:
        with np.load(path, allow_pickle=False) as z:
            if str(z['key']) != key:
                raise CacheMiss('key mismatch')
            meta = json.loads(str(z['meta']))
            co, lv, ls, age = z['co'], z['loops'], z['loop_start'], z['age']
    except CacheMiss:
        raise
    except Exception as e:  # noqa
        raise CacheMiss('unreadable (%s)' % e)
    nv, nl, npoly = meta['vertices'], meta['loops'], meta['polygons']
    if co.size != 3 * nv or lv.size != nl or ls.size != npoly or age.size != nv:
        raise CacheMiss('array sizes disagree with the stored counts')
    me = bpy.data.meshes.new(name)
    me.vertices.add(nv)
    me.vertices.foreach_set('co', co)
    me.loops.add(nl)
    me.loops.foreach_set('vertex_index', lv)
    me.polygons.add(npoly)
    me.polygons.foreach_set('loop_start', ls)
    me.update(calc_edges=True)
    if len(me.edges) != meta['edges']:
        bpy.data.meshes.remove(me)
        raise CacheMiss('edge count %d != stored %d' % (len(me.edges), meta['edges']))
    at = me.attributes.new('age', 'FLOAT', 'POINT')
    at.data.foreach_set('value', age)
    bt = me.attributes.new('birth', 'FLOAT', 'POINT')
    bt.data.foreach_set('value', (np.float32(meta['t']) - age).astype(np.float32))
    me.shade_smooth()
    ob = bpy.data.objects.new('Dendrite', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, meta


class MeshCache:
    """per-(kind, t) meshes on disk under <root>/<fingerprint[:16]>/ (see the module docstring). read=False and
    write=False (--no-cache) touch nothing on disk."""

    def __init__(self, A, root=DEFAULT_ROOT, read=True, write=True, verify=False, log=print):
        self.A = A
        self.fp, self.args = fingerprint(A)
        self.root = root
        self.dir = os.path.join(root, self.fp[:16])
        self.read, self.write, self.verify, self.log = read, write, verify, log
        if read or write:
            os.makedirs(self.dir, exist_ok=True)
            info = os.path.join(self.dir, 'cache_info.json')
            if write and not os.path.isfile(info):
                tmp = '%s.%d.tmp' % (info, os.getpid())
                with open(tmp, 'w') as fh:
                    json.dump(dict(fingerprint=self.fp, args=self.args, sources=[DG.__file__, MR.__file__],
                                   blender=bpy.app.version_string, numpy=np.__version__,
                                   created=time.strftime('%Y-%m-%d %H:%M:%S')), fh, indent=1, default=str)
                replace_retry(tmp, info)
        self.stats = {'hit': 0, 'build': 0, 'build_s': 0.0, 'load_s': 0.0, 'bytes': 0, 'failed': 0}

    def key(self, kind, t):
        blob = json.dumps([self.fp, kind, t_tag(t), kind_params(kind, self.A)], sort_keys=True)
        return hashlib.sha1(blob.encode()).hexdigest()

    def path(self, kind, t):
        return os.path.join(self.dir, '%s_t%s.npz' % (kind, t_tag(t)))

    def has(self, kind, t):
        p = self.path(kind, t)
        if not os.path.isfile(p):
            return False
        try:
            with np.load(p, allow_pickle=False) as z:
                return str(z['key']) == self.key(kind, t)
        except Exception:  # noqa
            return False

    def get(self, kind, t, build=True):
        """(object linked to the scene, meta, seconds, 'hit' | 'build'); builds on a miss (build=True) and saves the
        mesh if it passed the gate. meta always carries 'key' and the vertex / loop / polygon / edge counts."""
        if kind not in BUILDERS:
            raise ValueError(kind)
        p, k = self.path(kind, t), self.key(kind, t)
        if self.read and os.path.isfile(p):
            t0 = time.perf_counter()
            try:
                ob, meta = load_mesh(p, k)
                if self.verify:
                    topo = DG.mesh_topology(ob.data)
                    if bool(topo['single_closed_genus0_surface']) != (meta['gate'] == 'PASS') or \
                            topo['euler_characteristic'] != meta['topology']['euler_characteristic']:
                        raise CacheMiss('topology on load disagrees with the stored gate')
                if meta.get('gate') != 'PASS':        # a v4 cache may hold one: never serve it
                    raise CacheMiss('stored mesh failed the gate')
                secs = time.perf_counter() - t0
                self.stats['hit'] += 1
                self.stats['load_s'] += secs
                return ob, meta, secs, 'hit'
            except CacheMiss as e:
                self.log('[mesh] cache %s t=%s: %s, rebuilding' % (kind, t_tag(t), e))
                drop_helpers()
        if not build:
            raise CacheMiss('not cached: %s t=%s' % (kind, t_tag(t)))
        t0 = time.perf_counter()
        ob, meta = BUILDERS[kind](self.A, t)
        secs = time.perf_counter() - t0
        meta['build_seconds'] = round(secs, 2)
        meta.update(key=k, **mesh_counts(ob.data))
        if meta['gate'] != 'PASS':
            self.stats['failed'] += 1
            self.log('[mesh] %s t=%s FAILS the topology gate: not cached' % (kind, t_tag(t)))
        elif self.write:
            self.stats['bytes'] += save_mesh(p, ob.data, meta)
        self.stats['build'] += 1
        self.stats['build_s'] += secs
        return ob, meta, secs, 'build'

    def prune(self):
        """delete every other fingerprint directory under the root (meshes no current code can read). Returns
        [(dir, bytes)]."""
        out = []
        if not os.path.isdir(self.root):
            return out
        keep = os.path.normcase(os.path.abspath(self.dir))
        for name in sorted(os.listdir(self.root)):
            d = os.path.join(self.root, name)
            if not os.path.isdir(d) or os.path.normcase(os.path.abspath(d)) == keep:
                continue
            if len(name) != 16 or any(c not in '0123456789abcdef' for c in name):
                continue                                   # not a fingerprint directory: leave it alone
            size = sum(os.path.getsize(os.path.join(r, f)) for r, _d, fs in os.walk(d) for f in fs)
            shutil.rmtree(d)
            out.append((d, size))
        return out
