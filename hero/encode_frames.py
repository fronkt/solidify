"""
encode_frames.py -- turn the transparent Cycles masters of render_sequence.py into the frame sets the landing page
scrubs, to the delivery contract in docs/HERO-DELIVERY.md (manifest version 3). Plain python + Pillow (with AVIF) +
numpy; no Blender.

  python hero/encode_frames.py [--seq C:/Users/frank/solidify-hero-out/v4/seq] [--out public/hero]
      [--timeline hero/timeline.json] [--flow C:/Users/frank/solidify-hero-out/v4/a5/flow.json]
      [--cache C:/Users/frank/solidify-hero-out/v4/encode_cache] [--sets 1200:60,900:60,720:62] [--min-quality Q]
      [--segment-frames 32] [--first-every 16] [--workers 6] [--threads 1] [--stop-after SECONDS] [--cache-only]
      [--contact-sheet C:/Users/frank/solidify-hero-out/v4/contact_sheet.png] [--contact-only [--from-masters]]
      [--tile 360] [--cols 6] [--step K]

What it writes (docs/HERO-DELIVERY.md has the contract, field by field):
  <out>/manifest.json          the stable manifest (revalidated on every visit), written LAST
  <out>/poster-1200.avif,.webp the stable poster = the last frame (no-JS, reduced motion, the still, first paint)
  <out>/v4-<hash>/<w>/...      one immutable, content-hashed directory: per set a sparse first-pass segment
                               (first.bin: every 16th frame plus 0 and N-1) and contiguous segments of K frames
                               (000-031.bin, ...); a segment is the frames' AVIF files back to back, and the manifest
                               gives each segment's frame list and [offset, length] per frame
The directory name is v<timeline version>-<first 10 hex of sha256(the set files' bytes in manifest order, then the
manifest file's bytes with "dir":"">. Anything else in <out> is removed after the swap (the v3 set included).

Per frame: straight-alpha 'over' onto #0a0a0a in display (sRGB-encoded) space, exactly as a browser composites the
transparent PNG (round 4: no emission, no bloom), then Lanczos to each set width and AVIF (aom, speed 4, 4:2:0, full
range) at the set's quality: 1200 q60, 900 q60, 720 q62, the lowest qualities at which no sampled frame falls more than
0.002 masked SSIM below the approved WebP q76 look (v4/a5/delivery.md). The poster: AVIF q68 and WebP q84 at 1200.

Streaming, bounded RAM: a pool of at most 6 worker processes; each loads ONE master, composites it, encodes every
width that is not cached yet, writes each result to the per-frame cache and drops it. The parent never holds an image:
it assembles the segments by appending cached frames one at a time. The per-frame cache (--cache) is keyed by the
master's sha256, the width, the format, the quality and the encoder recipe (background, resampling, codec settings and
library versions), so a re-run skips done work and an interrupted run resumes; --stop-after stops submitting after that
many seconds (exit 3: re-run to continue), which keeps each run under a shell time limit.

Quality and budgets: each set must fit timeline.budget_bytes[<width>] (all its files, the first-pass segment included)
and each poster timeline.budget_bytes['poster']. The quality steps down by 2 while a set is over budget, but never below
--min-quality, which defaults to the set's own quality: the delivery measurement found the next steps down visibly
below the approved look, so by default an over-budget set is refused rather than degraded. --cache-only fills the
cache, prints each set's bytes and the budgets the rule gives (measured x 1.10, rounded up to 64 KiB; posters to
4 KiB), and stops.

Refuses to encode when frames.json was rendered for another frame count, when a master is missing or not res x res,
when a frame has no anchors, when any rendered frame's mesh failed the topology gate (frames.json 'gate' != 'PASS'),
when the poster is not the last frame or has an occluded feature, when the timeline is older than version 4 (the v3
re-encode path was dropped with manifest v1: its masters and set stay in git history), when hero/timeline.json has CRLF
line endings (the digest is defined over the LF file), when the flow file (per-step motion and the blend gate) is
missing, has the wrong length, or was made for another version of the timeline or other masters, and when a set or a
poster is over its budget.

Writing: everything goes into a staging folder under --cache (outside the repo tree a dev server watches), then the
hashed directory is moved in, the posters are replaced, manifest.json is replaced LAST, and only then is anything else
in --out deleted; an interrupted encode never leaves a manifest that points at a missing or half-written set.
The contact sheet is drawn from the SHIPPED 1200 set (decoded from its segments), every K-th frame (K = --step, default
about N / 36) with its anchors and index; --contact-only redraws it from the set in --out; --contact-only
--from-masters tiles whatever masters exist in --seq (a preview or a partial render). The encode report (qualities,
bytes, budgets, segments, times, peak RAM) goes beside the sheet (<sheet>_encode_report.json); nothing is written into
--seq.
"""
import argparse
import gzip
import hashlib
import io
import json
import math
import os
import shutil
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait

from PIL import Image, ImageDraw, ImageFont, features

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import path_plan as PP  # noqa: E402  (timeline reader; numpy only)

MANIFEST_VERSION = 3
BG = (0x0A, 0x0A, 0x0A)
BG_HEX = '#0a0a0a'
FEATURE_ORDER = ('primary', 'tip', 'lambda2', 'tertiary', 'neck')
DEFAULT_SETS = '1200:60,900:60,720:62'
AVIF_OPTS = {'speed': 4, 'subsampling': '4:2:0', 'range': 'full'}
WEBP_OPTS = {'method': 6}
POSTER_WIDTH = 1200
POSTER_Q = {'avif': 68, 'webp': 84}
POSTER_FILES = {'avif': 'poster-%d.avif' % POSTER_WIDTH, 'webp': 'poster-%d.webp' % POSTER_WIDTH}
MIME = {'avif': 'image/avif', 'webp': 'image/webp'}
SEGMENT_FRAMES = 32         # one K for every set, so a set switch maps frames to segments the same way
FIRST_EVERY = 16
SEGMENT_TARGET = (0.5e6, 1.5e6)   # bytes: the contract's band for a set's mean contiguous segment
BUDGET_HEADROOM = 1.10
MAX_WORKERS = 6
COLORS = {'tip': (80, 220, 255), 'primary': (255, 90, 220), 'lambda2': (190, 255, 90), 'tertiary': (255, 170, 60),
          'neck': (255, 255, 255)}
DEFAULT_SEQ = 'C:/Users/frank/solidify-hero-out/v4/seq'
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, '..', 'public', 'hero'))
DEFAULT_CACHE = 'C:/Users/frank/solidify-hero-out/v4/encode_cache'
DEFAULT_FLOW = 'C:/Users/frank/solidify-hero-out/v4/a5/flow.json'
DEFAULT_SHEET = 'C:/Users/frank/solidify-hero-out/v4/contact_sheet.png'

TL = None
N_FRAMES = 0
CHAPTERS = []
FEATURES = []


def use_timeline(tl):
    """this module's frame set from timeline `tl`."""
    global TL, N_FRAMES, CHAPTERS, FEATURES
    TL = tl
    N_FRAMES = PP.n_frames(tl)
    CHAPTERS = [{'id': c['id'], 'from': int(c['from']), 'to': int(c['to'])} for c in tl['chapters']]
    FEATURES = []
    for f in tl['features']:
        fe = {'id': f['id'], 'kind': f['kind'], 'from': int(f['from']), 'to': int(f['to'])}
        if 'hold' in f:
            fe['hold'] = [int(v) for v in f['hold']]
        if f.get('label') is not None:
            fe['label'] = f['label']
        FEATURES.append(fe)


def timeline_sha1(path):
    """the timeline digest path_plan.py and render_sequence.py record: sha1 of the file's bytes. It is defined over the
    LF file (the blob in git); a CRLF checkout (core.autocrlf) would change it, so that is refused."""
    with open(path, 'rb') as fh:
        raw = fh.read()
    if b'\r\n' in raw:
        raise SystemExit('%s has CRLF line endings (a core.autocrlf checkout?): the timeline digest is defined over '
                         'the LF file; restore LF (e.g. .gitattributes "hero/timeline.json text eol=lf")' % path)
    return hashlib.sha1(raw).hexdigest()


def composite(master_path):
    """RGBA master -> opaque RGB uint8 on the page color (straight-alpha over in display space, as a browser does)."""
    im = Image.open(master_path).convert('RGBA')
    base = Image.new('RGBA', im.size, BG + (255,))
    return Image.alpha_composite(base, im).convert('RGB')


# ---- process helpers -------------------------------------------------------------------------------------------------
def unthrottle(pid=None):
    """Windows parks windowless processes on the E-cores (power throttling); release `pid` (default this process).
    Best effort; a no-op elsewhere."""
    if os.name != 'nt':
        return False
    try:
        import ctypes
        from ctypes import wintypes

        class PPTS(ctypes.Structure):
            _fields_ = [('Version', wintypes.ULONG), ('ControlMask', wintypes.ULONG), ('StateMask', wintypes.ULONG)]

        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k32.SetProcessInformation.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
        k32.CloseHandle.argtypes = (wintypes.HANDLE,)
        h = k32.OpenProcess(0x0600, False, int(pid or os.getpid()))
        if not h:
            return False
        s = PPTS(1, 1, 0)       # ProcessPowerThrottling: control execution speed, state 0 = not throttled
        ok = k32.SetProcessInformation(h, 4, ctypes.byref(s), ctypes.sizeof(s))
        k32.CloseHandle(h)
        return bool(ok)
    except Exception:  # noqa
        return False


class RamWatch:
    """peak resident memory of this process plus its children (sampled every 0.25 s; psutil when installed)."""

    def __init__(self):
        try:
            import psutil
            self.ps = psutil
        except ImportError:
            self.ps = None
        self.peak = 0
        self.peak_parent = 0
        self._stop = threading.Event()
        self._t = None

    def sample(self):
        if not self.ps:
            return
        try:
            me = self.ps.Process(os.getpid())
            own = me.memory_info().rss
            tot = own
            for c in me.children(recursive=True):
                try:
                    tot += c.memory_info().rss
                except Exception:  # noqa (a worker that just exited)
                    pass
            self.peak = max(self.peak, tot)
            self.peak_parent = max(self.peak_parent, own)
        except Exception:  # noqa
            pass

    def start(self):
        def loop():
            while not self._stop.is_set():
                self.sample()
                self._stop.wait(0.25)
        self._t = threading.Thread(target=loop, daemon=True)
        self._t.start()
        return self

    def stop(self):
        self._stop.set()
        if self._t:
            self._t.join()
        self.sample()


# ---- the per-frame cache -----------------------------------------------------------------------------------------------
def recipe():
    """everything besides the master, the width, the format and the quality that decides a cached frame's bytes."""
    return {'composite': 'straight-alpha over %s, display space' % BG_HEX, 'resample': 'lanczos',
            'avif': dict(AVIF_OPTS, codec='aom'), 'webp': dict(WEBP_OPTS), 'pillow': Image.__version__,
            'libavif': features.version('avif'), 'libwebp': features.version('webp')}


def recipe_key():
    return hashlib.sha1(json.dumps(recipe(), sort_keys=True).encode()).hexdigest()[:12]


def cache_path(cache_root, key, w, fmt, q, master_sha):
    return os.path.join(cache_root, key, '%d-%s-q%d' % (w, fmt, q), master_sha[:40] + '.' + fmt)


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def encode_bytes(im, fmt, q, threads=1):
    buf = io.BytesIO()
    if fmt == 'avif':
        im.save(buf, 'AVIF', quality=int(q), max_threads=int(threads), **AVIF_OPTS)
    elif fmt == 'webp':
        im.save(buf, 'WEBP', quality=int(q), **WEBP_OPTS)
    else:
        raise ValueError(fmt)
    return buf.getvalue()


def atomic_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = '%s.%d.tmp' % (path, os.getpid())
    with open(tmp, 'wb') as fh:
        fh.write(data)
    os.replace(tmp, path)


_THREADS = 1


def _worker_init(threads):
    global _THREADS
    _THREADS = int(threads)
    unthrottle()


def encode_frame(task):
    """one master -> every (width, format, quality) job for it, each written to its cache path; returns sizes only."""
    i, master, res, jobs = task
    t0 = time.perf_counter()
    im = composite(master)
    if im.size != (res, res):
        raise RuntimeError('master %s is %dx%d, not %dx%d' % (master, im.size[0], im.size[1], res, res))
    out = []
    for w, fmt, q, dst in jobs:
        src = im if w == res else im.resize((w, w), Image.LANCZOS)
        data = encode_bytes(src, fmt, q, _THREADS)
        atomic_write(dst, data)
        out.append((w, fmt, q, len(data)))
        del src, data
    peak = None
    try:
        import psutil
        mi = psutil.Process().memory_info()
        peak = getattr(mi, 'peak_wset', None) or mi.rss
    except Exception:  # noqa
        pass
    return i, out, time.perf_counter() - t0, peak


def fill_cache(tasks, workers, threads, deadline, log):
    """run the encode tasks on a pool (at most `workers` processes, a bounded number in flight); stop submitting at
    `deadline` (perf_counter) and return (done, left, per-worker peak bytes, seconds of work)."""
    done, peaks, work = 0, [], 0.0
    if not tasks:
        return 0, 0, peaks, work
    pending = list(tasks)
    inflight = set()
    t0 = time.perf_counter()
    with ProcessPoolExecutor(max_workers=workers, initializer=_worker_init, initargs=(threads,)) as ex:
        while pending or inflight:
            while pending and len(inflight) < 2 * workers and (deadline is None or time.perf_counter() < deadline):
                inflight.add(ex.submit(encode_frame, pending.pop(0)))
            if not inflight:
                break
            fin, inflight = wait(inflight, return_when=FIRST_COMPLETED)
            for fu in fin:
                i, out, dt, peak = fu.result()
                done += 1
                work += dt
                if peak:
                    peaks.append(peak)
                if done % 25 == 0 or (not pending and not inflight):
                    el = time.perf_counter() - t0
                    log('[encode]   %d/%d frames encoded (%.0f s, %.2f s a frame per worker)' % (
                        done, len(tasks), el, work / max(done, 1)))
    return done, len(pending), peaks, work


# ---- the masters --------------------------------------------------------------------------------------------------------
def load_seq(seq):
    fpath = os.path.join(seq, 'frames.json')
    if not os.path.isfile(fpath):
        raise SystemExit('missing %s (run render_sequence.py first)' % fpath)
    with open(fpath) as fh:
        data = json.load(fh)
    n_meta = data.get('meta', {}).get('frames')
    n_rec = len(data.get('frames', {}))
    n_seq = int(n_meta) if n_meta is not None else n_rec
    if n_seq != N_FRAMES:
        raise SystemExit('%s describes %d frames (%s), the timeline %s has %d: pass the timeline it was rendered for' % (
            fpath, n_seq, 'meta.frames' if n_meta is not None else 'frame records', TL['_path'], N_FRAMES))
    missing = [i for i in range(N_FRAMES) if not os.path.isfile(os.path.join(seq, 'f%03d.png' % i))]
    noanch = [i for i in range(N_FRAMES) if 'anchors' not in data['frames'].get(str(i), {})]
    badgate = [i for i in range(N_FRAMES) if data['frames'].get(str(i), {}).get('gate') != 'PASS']
    if missing:
        raise SystemExit('%d masters missing in %s: %s%s' % (len(missing), seq, missing[:10], ' ...' if len(missing) > 10 else ''))
    if noanch:
        raise SystemExit('%d frames have no anchors in frames.json (run render_sequence.py --anchors-only): %s' % (len(noanch), noanch[:10]))
    if badgate:
        raise SystemExit('%d frames were rendered from a mesh that failed the topology gate or carry no gate record: %s' % (
            len(badgate), badgate[:10]))
    return data


def flow_label(path):
    """the flow file's name in the (public) manifest: the part below solidify-hero-out/, never a local user path"""
    p = os.path.abspath(path).replace(os.sep, '/')
    k = p.find('solidify-hero-out/')
    return p[k:] if k >= 0 else os.path.basename(p)


def load_flow(path, tl_sha, meta):
    """per-step motion and the blend gate (v4/a5/flow_gate.py): one entry per step i = frame i+1 over frame i."""
    if not os.path.isfile(path):
        raise SystemExit('no flow file at %s (per-step flow and the blend gate; v4/a5/flow_gate.py writes it)' % path)
    with open(path) as fh:
        fl = json.load(fh)
    st = fl.get('step', {})
    probs = []
    if fl.get('frames') != N_FRAMES or fl.get('steps') != N_FRAMES - 1:
        probs.append('it describes %s frames / %s steps, the timeline %d / %d' % (
            fl.get('frames'), fl.get('steps'), N_FRAMES, N_FRAMES - 1))
    for k in ('p90', 'blend'):
        if len(st.get(k, [])) != N_FRAMES - 1:
            probs.append('step.%s has %d entries, not %d' % (k, len(st.get(k, [])), N_FRAMES - 1))
    if (fl.get('timeline') or {}).get('sha1') != tl_sha:
        probs.append('it was made for another version of the timeline (sha1 %s, current %s): re-run v4/a5/flow_gate.py, '
                     'which re-derives it from the stored rows' % (str((fl.get('timeline') or {}).get('sha1'))[:12], tl_sha[:12]))
    ms = fl.get('masters') or {}
    for k in ('res', 'samples', 'seed'):
        if k in ms and k in meta and ms[k] != meta[k]:
            probs.append('it was measured on other masters (%s %s, frames.json %s)' % (k, ms[k], meta[k]))
    if probs:
        raise SystemExit('flow file %s refused: %s' % (path, '; '.join(probs)))
    p90 = [round(float(v), 2) for v in st['p90']]
    blend = [1 if bool(v) else 0 for v in st['blend']]
    if any(not (v >= 0 and math.isfinite(v)) for v in p90):
        raise SystemExit('flow file %s: a step flow is negative or not finite' % path)
    crit = fl.get('criterion', {})
    return {
        'flow_p90': p90,
        'blend': blend,
        'units': 'flow_p90: 90th percentile of crystal-masked optical flow from frame i to i+1, px at 1200',
        'rule': 'draw frame i+1 over frame i at alpha f only where blend[i] = 1: at f = 0.5 at most %g of crystal pixels '
                'off the true in-between by more than 24/255, and their 99th percentile at most %g (picture-aware; '
                'elsewhere cut)' % (crit.get('frac_gt24_max', 0.05), crit.get('err_crystal_p99_max', 48.0)),
        # no timestamps anywhere in the manifest: the directory name hashes it, so the same content keeps its name
        'source': {'file': flow_label(path), 'timeline_sha1': tl_sha},
    }


# ---- sets and segments --------------------------------------------------------------------------------------------------
def parse_sets(spec):
    sets = []
    for part in spec.split(','):
        w, q = part.split(':')
        sets.append({'width': int(w), 'format': 'avif', 'quality': int(q)})
    ws = [s['width'] for s in sets]
    if ws != sorted(ws, reverse=True) or len(set(ws)) != len(ws):
        raise SystemExit('--sets: widths must be distinct and largest first (%s)' % spec)
    return sets


def first_frames(n, every):
    return sorted(set(range(0, n, every)) | {0, n - 1})


def segment_ranges(n, k):
    return [list(range(a, min(a + k, n))) for a in range(0, n, k)]


def seg_name(w, frames, digits):
    return '%d/%0*d-%0*d.bin' % (w, digits, frames[0], digits, frames[-1])


def propose_budget(nbytes, grain=65536):
    return int(math.ceil(nbytes * BUDGET_HEADROOM / grain) * grain)


def write_segment(path, frames, src_of, hasher):
    """append the frames' cached files to one segment file, one at a time; returns (bytes, index)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    index, off = [], 0
    with open(path, 'wb') as out:
        for i in frames:
            with open(src_of(i), 'rb') as fh:
                data = fh.read()
            out.write(data)
            hasher.update(data)
            index.append([off, len(data)])
            off += len(data)
            del data
    return off, index


def build_manifest_body(data, sets_out, poster_files, steps, tl_sha, masters_sha, meta):
    anchors = {}
    for f in FEATURES:
        rows = []
        for i in range(N_FRAMES):
            row = data['frames'][str(i)]['anchors'][f['id']]
            rows.append([round(float(v), 5) for v in row[:-1]] + [int(row[-1])])
        anchors[f['id']] = rows
    last = N_FRAMES - 1
    source = 'hero/dendrite_gen.py seed %s, Blender %s Cycles, %s spp, satin steel (no emission)' % (
        meta.get('seed', '?'), str(meta.get('blender', '4.5.11')).replace(' LTS', ''), meta.get('samples', '?'))
    rec = recipe()
    return {
        'version': MANIFEST_VERSION,
        'dir': '',
        'frames': N_FRAMES,
        'timeline': {'file': 'hero/timeline.json', 'version': int(TL['version']), 'sha1': tl_sha},
        'px_per_frame': TL['px_per_frame'],
        'hold_px': TL['hold_px'],
        'background': BG_HEX,
        'chapters': CHAPTERS,
        'features': FEATURES,
        'anchors': anchors,
        'poster': {'frame': last, 'width': POSTER_WIDTH, 'files': poster_files,
                   'anchors': {f['id']: anchors[f['id']][last] for f in FEATURES}},
        'steps': steps,
        'sets': sets_out,
        'masters': {'res': int(TL.get('res', 1200)), 'sha256': masters_sha},
        'encoder': {'composite': rec['composite'], 'resample': rec['resample'], 'avif': rec['avif'],
                    'webp': rec['webp'], 'pillow': rec['pillow'], 'libavif': rec['libavif'], 'libwebp': rec['libwebp']},
        'source': source,
    }


def dump_manifest(m):
    return json.dumps(m, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


# ---- the swap -------------------------------------------------------------------------------------------------------------
def clean_stale_staging(places, log):
    """staging folders of runs that died: `places` = [(folder, name prefix)]; a folder is removed only when its pid is
    gone (psutil), so a run in another shell is left alone."""
    try:
        import psutil
        alive = psutil.pid_exists
    except ImportError:
        return
    for parent, prefix in places:
        if not os.path.isdir(parent):
            continue
        for fn in os.listdir(parent):
            if not fn.startswith(prefix):
                continue
            try:
                pid = int(fn.rsplit('-', 1)[1])
            except ValueError:
                continue
            if pid != os.getpid() and not alive(pid):
                shutil.rmtree(os.path.join(parent, fn), ignore_errors=True)
                log('[encode] removed a dead run\'s staging folder %s' % os.path.join(parent, fn))


def move(src, dst, is_dir):
    """rename (same volume; retried), else copy then delete (another volume); for files the copy lands by os.replace."""
    try:
        return retry(os.replace if not is_dir else os.rename, src, dst)
    except OSError as e:
        if getattr(e, 'winerror', None) != 17 and e.errno != 18:     # not "a different disk drive" / EXDEV
            raise
    if is_dir:
        shutil.copytree(src, dst)
        retry(shutil.rmtree, src)
    else:
        shutil.copyfile(src, dst + '.part')
        retry(os.replace, dst + '.part', dst)
        retry(os.remove, src)


def retry(fn, *args, tries=60):
    """Windows: a file just written can stay open in a scanner or a file watcher for a moment, and a rename or delete
    of it (or of its folder) is then denied; wait and try again (about 30 s at most) before giving up."""
    for k in range(tries):
        try:
            return fn(*args)
        except PermissionError:
            if k == tries - 1:
                raise
            time.sleep(min(0.1 * (k + 1), 1.0))


def swap_in(stage, pending, out, dirname, log):
    """the staged set directory moved in as `dirname` (kept if an identical one is already there), the posters
    replaced, manifest.json LAST; then everything else in `out` (earlier sets, v3's frame folders and posters, strays)
    deleted. The staging folder lives outside --out's tree (under --cache): a dev server watching public/ holds handles
    on the folders it watches, and Windows then refuses to rename them."""
    os.makedirs(out, exist_ok=True)
    dst = os.path.join(out, dirname)
    if os.path.isdir(dst):
        log('[encode] %s is already in place (same content hash): kept' % dirname)
    else:
        move(pending, dst, True)
    for fn in POSTER_FILES.values():
        move(os.path.join(stage, fn), os.path.join(out, fn), False)
    move(os.path.join(stage, 'manifest.json'), os.path.join(out, 'manifest.json'), False)
    keep = {'manifest.json', dirname} | set(POSTER_FILES.values())
    removed = []
    for fn in sorted(os.listdir(out)):
        if fn in keep:
            continue
        p = os.path.join(out, fn)
        retry(shutil.rmtree if os.path.isdir(p) else os.remove, p)
        removed.append(fn)
    retry(shutil.rmtree, stage)
    return removed


# ---- contact sheet ------------------------------------------------------------------------------------------------------
def shipped_loader(out_hero, manifest, width=None):
    """frame i of the shipped set (the largest by default), decoded from its contiguous segment."""
    s = [x for x in manifest['sets'] if width is None or x['width'] == width][0]
    where = {}
    for seg in s['segments']:
        for i, (off, ln) in zip(seg['frames'], seg['index']):
            where[i] = (seg['file'], off, ln)
    base = os.path.join(out_hero, manifest['dir'])

    def load(i):
        fn, off, ln = where[i]
        with open(os.path.join(base, fn), 'rb') as fh:
            fh.seek(off)
            data = fh.read(ln)
        return Image.open(io.BytesIO(data)).convert('RGB')
    return load


def contact_sheet(manifest, sheet_path, loader, step=None, tile=360, cols=6, frames=None):
    """every `step`-th frame (or the given frames), through `loader(i) -> RGB image`, with its anchors."""
    if step is None:
        step = max(1, int(round(N_FRAMES / 36.0)))
    if frames is None:
        frames = list(range(0, N_FRAMES, step))
        if N_FRAMES - 1 not in frames:
            frames.append(N_FRAMES - 1)
    cols = max(1, min(cols, len(frames)))
    rows = int(math.ceil(len(frames) / float(cols)))
    pad = 6
    W = cols * (tile + pad) + pad
    H = rows * (tile + pad + 18) + pad + 20
    sheet = Image.new('RGB', (W, H), (24, 24, 28))
    try:
        font = ImageFont.truetype('arial.ttf', 15)
        font_b = ImageFont.truetype('arialbd.ttf', 15)
    except Exception:  # noqa
        font = font_b = ImageFont.load_default()
    chap = {i: c['id'] for c in CHAPTERS for i in range(c['from'], c['to'] + 1)}
    win = {i: f['id'] for f in FEATURES for i in range(f['from'], f['to'] + 1)}
    for n, i in enumerate(frames):
        r, c = divmod(n, cols)
        x0 = pad + c * (tile + pad)
        y0 = pad + r * (tile + pad + 18)
        im = loader(i)
        sheet.paste(im.resize((tile, tile), Image.LANCZOS), (x0, y0))
        del im
        d = ImageDraw.Draw(sheet)
        for f in FEATURES:
            row = manifest['anchors'][f['id']][i]
            if len(row) < 3:              # a preview frame without an anchor pass: no marks
                continue
            vis = row[-1] == 1
            pts = [(x0 + row[k] * tile, y0 + row[k + 1] * tile) for k in range(0, len(row) - 1, 2)]
            col = COLORS.get(f['id'], (255, 255, 255))
            active = f['from'] <= i <= f['to']
            rad = 6 if active else 4
            if len(pts) == 2:
                d.line([pts[0], pts[1]], fill=col if vis else tuple(v // 3 for v in col), width=3 if active else 1)
            for p in pts:
                box = [p[0] - rad, p[1] - rad, p[0] + rad, p[1] + rad]
                if vis:
                    d.ellipse(box, fill=col, outline=(0, 0, 0))
                else:
                    d.ellipse(box, outline=col, width=2)
        label = 'f%03d  %s' % (i, chap[i]) + ('  [%s]' % win[i] if i in win else '')
        d.rectangle([x0, y0 + tile, x0 + tile, y0 + tile + 18], fill=(24, 24, 28))
        d.text((x0 + 4, y0 + tile + 1), label, fill=(235, 235, 235), font=font_b if i in win else font)
    legend = '  '.join('%s = %s' % (f['id'], 'pair' if f['kind'] == 'pair' else 'point') for f in FEATURES)
    ImageDraw.Draw(sheet).text((pad, H - 18), 'filled = visible, hollow = occluded / off frame; bold label = inside a '
                               'feature window;  ' + legend, fill=(200, 200, 200), font=font)
    sheet.save(sheet_path, optimize=True)
    return sheet_path, len(frames)


# ---- main ---------------------------------------------------------------------------------------------------------------
def parse_args(argv):
    p = argparse.ArgumentParser(description='SOLIDIFY hero: composite + AVIF frame sets in segments + manifest v3')
    p.add_argument('--seq', default=DEFAULT_SEQ)
    p.add_argument('--out', default=DEFAULT_OUT, help='the page\'s hero folder (default the repo\'s public/hero)')
    p.add_argument('--timeline', default=None, help='default hero/timeline.json')
    p.add_argument('--flow', default=DEFAULT_FLOW, help='per-step flow and the blend gate (v4/a5/flow.json)')
    p.add_argument('--cache', default=DEFAULT_CACHE, help='the per-frame cache (outside the repo)')
    p.add_argument('--sets', default=DEFAULT_SETS, help='width:quality, largest first (AVIF)')
    p.add_argument('--min-quality', type=int, default=None,
                   help='lowest quality the budget step-down may reach (default: each set\'s own quality, no step-down)')
    p.add_argument('--segment-frames', type=int, default=SEGMENT_FRAMES)
    p.add_argument('--first-every', type=int, default=FIRST_EVERY)
    p.add_argument('--workers', type=int, default=MAX_WORKERS, help='encode processes (at most %d)' % MAX_WORKERS)
    p.add_argument('--threads', type=int, default=1, help='AVIF threads per worker')
    p.add_argument('--stop-after', type=float, default=None,
                   help='stop submitting frames after this many seconds (exit 3; re-run to continue from the cache)')
    p.add_argument('--cache-only', action='store_true', help='fill the cache, report bytes and proposed budgets, stop')
    p.add_argument('--contact-sheet', default=DEFAULT_SHEET)
    p.add_argument('--contact-only', action='store_true', help='only redraw the contact sheet from the shipped set')
    p.add_argument('--from-masters', action='store_true',
                   help='with --contact-only: tile the masters present in --seq (composited) with the anchors of its '
                        'frames.json; for checking a smoke test or a partial render')
    p.add_argument('--tile', type=int, default=360)
    p.add_argument('--cols', type=int, default=6)
    p.add_argument('--step', type=int, default=None, help='contact sheet: every K-th frame (default ~N/36)')
    return p.parse_args(argv)


def log(msg):
    print(msg)
    sys.stdout.flush()


def main(argv):
    A = parse_args(argv)
    use_timeline(PP.load_timeline(A.timeline))
    t_start = time.perf_counter()
    unthrottle()

    if A.contact_only and A.from_masters:
        with open(os.path.join(A.seq, 'frames.json')) as fh:
            data = json.load(fh)
        have = sorted(int(fn[1:4]) for fn in os.listdir(A.seq) if fn.startswith('f') and fn.endswith('.png') and len(fn) == 8)
        have = [i for i in have if i < N_FRAMES]
        fr = data.get('frames', {})
        m = {'anchors': {f['id']: [fr[str(i)]['anchors'][f['id']] if 'anchors' in fr.get(str(i), {}) else []
                                   for i in range(N_FRAMES)] for f in FEATURES}}
        loader = lambda i: composite(os.path.join(A.seq, 'f%03d.png' % i))
        path, n = contact_sheet(m, A.contact_sheet, loader, frames=have, tile=A.tile, cols=A.cols)
        log('[encode] contact sheet from %d masters -> %s' % (n, path))
        return 0
    if A.contact_only:
        with open(os.path.join(A.out, 'manifest.json')) as fh:
            m = json.load(fh)
        path, n = contact_sheet(m, A.contact_sheet, shipped_loader(A.out, m), step=A.step, tile=A.tile, cols=A.cols)
        log('[encode] contact sheet (%d shipped frames) -> %s' % (n, path))
        return 0

    # ---- refusals ----
    if int(TL.get('version', 0)) < 4:
        raise SystemExit('timeline %s is version %s: manifest v3 needs a v4 timeline (the v3 re-encode path and manifest '
                         'v1 were dropped; the v3 set stays in git history)' % (TL['_path'], TL.get('version')))
    tl_sha = timeline_sha1(TL['_path'])
    last = N_FRAMES - 1
    if int(TL['poster']) != last:
        raise SystemExit('the timeline\'s poster is frame %s: the contract makes the last frame (%d) the poster' % (TL['poster'], last))
    if [f['id'] for f in FEATURES] != list(FEATURE_ORDER):
        raise SystemExit('the timeline\'s features are %s, the contract\'s order is %s' % (
            [f['id'] for f in FEATURES], list(FEATURE_ORDER)))
    data = load_seq(A.seq)
    meta = data['meta']
    if meta.get('poster_frame') is not None and int(meta['poster_frame']) != last:
        raise SystemExit('frames.json names poster frame %s; the contract\'s poster is the last frame (%d)' % (meta['poster_frame'], last))
    hidden = [k for k, v in data['frames'][str(last)]['anchors'].items() if v[-1] != 1]
    if hidden:
        raise SystemExit('the poster (frame %d) has occluded features: %s' % (last, hidden))
    res = int(TL.get('res', 1200))
    w0, h0 = Image.open(os.path.join(A.seq, 'f000.png')).size
    if (w0, h0) != (res, res):
        raise SystemExit('masters are %dx%d, the timeline says %d x %d' % (w0, h0, res, res))
    steps = load_flow(A.flow, tl_sha, meta)
    sets = parse_sets(A.sets)
    if sets[0]['width'] != res or POSTER_WIDTH > res:
        raise SystemExit('the largest set (%d) must be the masters\' width (%d)' % (sets[0]['width'], res))
    workers = max(1, min(MAX_WORKERS, int(A.workers)))
    budgets = TL.get('budget_bytes') or {}

    # ---- master digests (streamed, one file at a time) ----
    t0 = time.perf_counter()
    masters = [os.path.join(A.seq, 'f%03d.png' % i) for i in range(N_FRAMES)]
    msha = [file_sha256(p) for p in masters]
    masters_sha = hashlib.sha256(''.join(msha).encode()).hexdigest()
    log('[encode] %d masters hashed in %.1f s (masters sha256 %s); timeline %s sha1 %s; manifest version %d' % (
        N_FRAMES, time.perf_counter() - t0, masters_sha[:12], TL['_path'], tl_sha[:12], MANIFEST_VERSION))
    key = recipe_key()
    ram = RamWatch().start()
    deadline = None if A.stop_after is None else t_start + float(A.stop_after)
    peaks, work_s, enc_s, n_enc = [], 0.0, 0.0, 0

    # ---- encode (fill the cache), stepping quality down per set while over budget ----
    def need(pairs):
        """(i -> [(w, fmt, q, path)]) for every (i, w, fmt, q) whose cache file is missing"""
        todo = {}
        for i, w, fmt, q in pairs:
            p = cache_path(A.cache, key, w, fmt, q, msha[i])
            if not os.path.isfile(p):
                todo.setdefault(i, []).append((w, fmt, q, p))
        return todo

    def set_bytes(s, frames):
        return sum(os.path.getsize(cache_path(A.cache, key, s['width'], 'avif', s['quality'], msha[i])) for i in frames)

    firsts = first_frames(N_FRAMES, A.first_every)
    for s in sets:
        s['floor'] = s['quality'] if A.min_quality is None else min(s['quality'], int(A.min_quality))
    while True:
        pairs = [(i, s['width'], 'avif', s['quality']) for i in range(N_FRAMES) for s in sets]
        pairs += [(last, POSTER_WIDTH, fmt, q) for fmt, q in POSTER_Q.items()]
        todo = need(pairs)
        tasks = [(i, masters[i], res, todo[i]) for i in sorted(todo)]
        if tasks:
            log('[encode] %d frames to encode (%d cached files missing), %d workers x %d AVIF threads, cache %s/%s' % (
                len(tasks), sum(len(v) for v in todo.values()), workers, A.threads, A.cache, key))
        te = time.perf_counter()
        done, left, pk, work = fill_cache(tasks, workers, A.threads, deadline, log)
        enc_s += time.perf_counter() - te
        peaks += pk
        work_s += work
        n_enc += done
        if left:
            ram.stop()
            log('[encode] stopped after %.0f s with %d frames left (--stop-after); re-run to continue from the cache; '
                'peak RAM %.0f MiB (all processes)' % (time.perf_counter() - t_start, left, ram.peak / 2 ** 20))
            return 3
        over = []
        for s in sets:
            s['frames_bytes'] = set_bytes(s, range(N_FRAMES))
            s['first_bytes'] = set_bytes(s, firsts)
            s['total'] = s['frames_bytes'] + s['first_bytes']
            b = budgets.get(str(s['width']))
            if b is not None and s['total'] > int(b) and s['quality'] - 2 >= s['floor']:
                over.append(s)
        if A.cache_only or not over:
            break
        for s in over:
            log('[encode] %d set at q%d is %.2f MiB, over its budget %.2f MiB: q%d' % (
                s['width'], s['quality'], s['total'] / 2 ** 20, int(budgets[str(s['width'])]) / 2 ** 20, s['quality'] - 2))
            s['quality'] -= 2

    poster_src = {fmt: cache_path(A.cache, key, POSTER_WIDTH, fmt, q, msha[last]) for fmt, q in POSTER_Q.items()}
    poster_bytes = {fmt: os.path.getsize(p) for fmt, p in poster_src.items()}
    proposed = {str(s['width']): propose_budget(s['total']) for s in sets}
    proposed['poster'] = propose_budget(max(poster_bytes.values()), 4096)
    for s in sets:
        log('[encode] %d set q%d: frames %.2f MiB + first pass %.2f MiB = %.2f MiB (%.1f KiB a frame); budget %s' % (
            s['width'], s['quality'], s['frames_bytes'] / 2 ** 20, s['first_bytes'] / 2 ** 20, s['total'] / 2 ** 20,
            s['frames_bytes'] / 1024.0 / N_FRAMES,
            '%.2f MiB' % (int(budgets[str(s['width'])]) / 2 ** 20) if str(s['width']) in budgets else 'MISSING'))
    log('[encode] posters: %s' % ', '.join('%s q%d %.1f KiB' % (f, POSTER_Q[f], b / 1024.0) for f, b in poster_bytes.items()))
    log('[encode] budgets by the rule (measured x %.2f, rounded up to 64 KiB, posters to 4 KiB): %s' % (
        BUDGET_HEADROOM, json.dumps(proposed)))
    if A.cache_only:
        ram.stop()
        log('[encode] --cache-only: done in %.0f s; peak RAM %.0f MiB (all processes), parent %.0f MiB' % (
            time.perf_counter() - t_start, ram.peak / 2 ** 20, ram.peak_parent / 2 ** 20))
        return 0

    # ---- budgets: refuse rather than ship over ----
    bad = []
    for s in sets:
        b = budgets.get(str(s['width']))
        if b is None:
            bad.append('no budget for the %d set in %s budget_bytes (the rule gives %d)' % (s['width'], TL['_path'], proposed[str(s['width'])]))
        elif s['total'] > int(b):
            bad.append('%d set %d B over its budget %d B at q%d (the floor)' % (s['width'], s['total'], int(b), s['quality']))
    pb = budgets.get('poster')
    if pb is None:
        bad.append('no poster budget in budget_bytes')
    else:
        bad += ['poster %s %d B over its budget %d B' % (f, n, int(pb)) for f, n in poster_bytes.items() if n > int(pb)]
    if bad:
        ram.stop()
        raise SystemExit('refused, nothing written: ' + '; '.join(bad))

    # ---- assemble the segments into a staging folder beside --out ----
    ta = time.perf_counter()
    out = os.path.abspath(A.out)
    staging_root = os.path.join(os.path.abspath(A.cache), 'staging')
    clean_stale_staging([(staging_root, 'run-'), (os.path.dirname(out), '.%s.staging-' % os.path.basename(out))], log)
    stage = os.path.join(staging_root, 'run-%d' % os.getpid())
    shutil.rmtree(stage, ignore_errors=True)
    pending = os.path.join(stage, 'pending')
    os.makedirs(pending)
    hasher = hashlib.sha256()
    digits = max(3, len(str(last)))
    sets_out, seg_report = [], {}
    for s in sets:
        w, q = s['width'], s['quality']
        src_of = lambda i, w=w, q=q: cache_path(A.cache, key, w, 'avif', q, msha[i])
        fn = '%d/first.bin' % w
        nb, idx = write_segment(os.path.join(pending, fn), firsts, src_of, hasher)
        first = {'file': fn, 'every': int(A.first_every), 'bytes': nb, 'frames': firsts, 'index': idx}
        segs = []
        for fr in segment_ranges(N_FRAMES, A.segment_frames):
            fn = seg_name(w, fr, digits)
            nb, idx = write_segment(os.path.join(pending, fn), fr, src_of, hasher)
            segs.append({'file': fn, 'bytes': nb, 'frames': fr, 'index': idx})
        total = first['bytes'] + sum(x['bytes'] for x in segs)
        sets_out.append({'width': w, 'format': 'avif', 'type': MIME['avif'], 'quality': q, 'bytes': total,
                         'segment_frames': int(A.segment_frames), 'first': first, 'segments': segs})
        full = [x['bytes'] for x in segs if len(x['frames']) == A.segment_frames]
        seg_report[w] = {'segments': len(segs), 'mean_MB': round(sum(full) / max(len(full), 1) / 1e6, 3),
                         'min_MB': round(min(full) / 1e6, 3), 'max_MB': round(max(full) / 1e6, 3),
                         'first_MB': round(first['bytes'] / 1e6, 3), 'first_frames': len(firsts)}
        mean = sum(full) / max(len(full), 1)
        if not (SEGMENT_TARGET[0] <= mean <= SEGMENT_TARGET[1]):
            log('[encode] WARNING: the %d set\'s mean segment is %.2f MB, outside %.1f-%.1f MB: pick another '
                '--segment-frames' % (w, mean / 1e6, SEGMENT_TARGET[0] / 1e6, SEGMENT_TARGET[1] / 1e6))
    poster_files = []
    for fmt in ('avif', 'webp'):
        dst = os.path.join(stage, POSTER_FILES[fmt])
        shutil.copyfile(poster_src[fmt], dst)
        poster_files.append({'file': POSTER_FILES[fmt], 'format': fmt, 'type': MIME[fmt], 'quality': POSTER_Q[fmt],
                             'bytes': os.path.getsize(dst), 'sha256': file_sha256(dst)})
    body = build_manifest_body(data, sets_out, poster_files, steps, tl_sha, masters_sha, meta)
    blank = dump_manifest(body)
    hasher.update(blank)
    digest = hasher.hexdigest()
    dirname = 'v%d-%s' % (int(TL['version']), digest[:10])
    body['dir'] = dirname
    final = dump_manifest(body)
    tag = ('"dir":"%s"' % dirname).encode()
    if final.count(tag) != 1 or final.replace(tag, b'"dir":""') != blank:
        raise SystemExit('internal: the manifest with its dir blanked is not the hashed body')
    with open(os.path.join(stage, 'manifest.json'), 'wb') as fh:
        fh.write(final)
    removed = swap_in(stage, pending, out, dirname, log)
    asm_s = time.perf_counter() - ta
    log('[encode] set -> %s/%s (manifest %.1f KiB); removed from %s: %s' % (
        out, dirname, len(final) / 1024.0, out, ', '.join(removed) or 'nothing'))

    # ---- contact sheet from the SHIPPED 1200 set ----
    tc = time.perf_counter()
    path, n = contact_sheet(body, A.contact_sheet, shipped_loader(out, body, sets[0]['width']), step=A.step,
                            tile=A.tile, cols=A.cols)
    sheet_s = time.perf_counter() - tc
    ram.stop()
    log('[encode] contact sheet (%d shipped frames) -> %s' % (n, path))

    report = {
        'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
        'out': out, 'dir': dirname, 'content_sha256': digest,
        'timeline': {'file': TL['_path'], 'sha1': tl_sha}, 'masters_sha256': masters_sha,
        'sets': {str(s['width']): {'format': 'avif', 'quality': s['quality'], 'bytes': so['bytes'],
                                   'MiB': round(so['bytes'] / 2 ** 20, 2),
                                   'frames_bytes': s['frames_bytes'], 'first_bytes': s['first_bytes'],
                                   'budget': int(budgets[str(s['width'])]), 'segments': seg_report[s['width']]}
                 for s, so in zip(sets, sets_out)},
        'posters': {p['file']: {'quality': p['quality'], 'bytes': p['bytes'], 'budget': int(budgets['poster'])}
                    for p in poster_files},
        'budget_rule': 'set: bytes of all its files x %.2f rounded up to 64 KiB; poster: the larger poster x %.2f rounded '
                       'up to 4 KiB' % (BUDGET_HEADROOM, BUDGET_HEADROOM),
        'budgets_by_rule': proposed,
        'manifest_bytes': len(final), 'manifest_gzip_bytes': len(gzip.compress(final, 9)),
        'blend_steps': sum(steps['blend']),
        'seconds': {'total': round(time.perf_counter() - t_start, 1), 'encode_wall': round(enc_s, 1),
                    'encode_work_per_frame': round(work_s / n_enc, 2) if n_enc else None,
                    'assemble_swap': round(asm_s, 1), 'contact_sheet': round(sheet_s, 1)},
        'workers': workers, 'avif_threads': A.threads, 'frames_encoded_this_run': n_enc,
        'peak_ram_MiB': {'all_processes_sampled': round(ram.peak / 2 ** 20, 1),
                         'parent_sampled': round(ram.peak_parent / 2 ** 20, 1),
                         'worker_peak_working_set_max': round(max(peaks) / 2 ** 20, 1) if peaks else None},
        'recipe': recipe(), 'cache': os.path.join(A.cache, key), 'contact_sheet': path,
    }
    rp = os.path.splitext(A.contact_sheet)[0] + '_encode_report.json'      # beside the sheet: never into the masters
    with open(rp, 'w') as fh:
        json.dump(report, fh, indent=1)
    log('[encode] done in %.0f s: %s; posters %s; peak RAM %.0f MiB (all processes); report %s' % (
        time.perf_counter() - t_start,
        ', '.join('%d q%d %.2f MiB' % (s['width'], s['quality'], so['bytes'] / 2 ** 20) for s, so in zip(sets, sets_out)),
        ', '.join('%.0f KiB' % (p['bytes'] / 1024.0) for p in poster_files), ram.peak / 2 ** 20, rp))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
