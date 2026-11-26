"""Independent NumPy/CuPy port of the 3D pure-substance tip fixture (fp32 vs fp64).

Transliterates, for the PURE path only (alloyOn 0, scen 0, noiseAmp 0, identity
quaternions, aniMode3 1, facet 0, solver 1, frozenT 0), the three passes the
GPU fixture scripts/fixtures/quant3d-tip-driver.mjs dispatches per substep at
source ab2b45c:

  pass 0  FLUX3D_WGSL                     (src/shaders3d.ts ~201-236)
  pass 1  phi3dWgsl(false, latticeKinetics) (src/shaders3d.ts ~532-561 with
          splitLoads3/quantLap3 ~246-288, PHASE_ANISO3_CORE ~312-343 and
          QUANT_PHASE3 in src/shaders3d-quant.ts ~14-56)
  pass 2  transport3dWgsl(false)           (src/shaders3d.ts ~595-622 with
          splitTransport3 ~575-593)

with the rectangular specialization of scripts/fixtures/rect3d-specialize.mjs
(integer bounds only). Operation order follows the WGSL expression trees
(left-associative, no reassociation, no fused multiply-add). Every binary op is
one IEEE operation in the working dtype; float32 here therefore differs from
the GPU only where the GPU compiler contracts, reorders or uses non-correctly-
rounded division/sqrt (see quant3d-fp64-port.md). Checkpoint files have the
schema the width-ladder harness writes ({source, config, ...sample}) so that
quant3d-q3c-tip-replay.py and localTip read them unchanged.

Usage:
  python -I scripts/research/quant3d-fp64-port.py --self-test
  python -I scripts/research/quant3d-fp64-port.py --box-gates --capture DIR   # cloud GPU, before long jobs
  python -I scripts/research/quant3d-fp64-port.py --config arm.json [--arm NAME]
      --out DIR [--dtype float32|float64] [--backend numpy|cupy|fused|fused-cpu]
      [--inputs gpu|exact] [--steps N] [--max-checkpoints M]
      [--schedule protocol|every:K] [--dump-fields] [--dump-at 1,17,64]
      [--dump-every K] [--resume STEP|auto] [--flush-minutes M]
      [--init-state state.npy] [--chunk-voxels V]

Backends: numpy/cupy run the array path; fused runs one CUDA kernel per pass
(flux, then phase+transport) from FUSED_SRC through a CuPy RawModule with
--fmad=false; fused-cpu compiles the same C for the CPU ($SOLIDIFY_CC or
`python -m ziglang cc`) and is bitwise identical to the array path.

The arm JSON has the LADDER_ARMS schema (name, lambda, epsilon4, undercooling,
radius, dims, dx, dt, D, d0, physicalTimeScale, latticeKinetics, ...; optional
center as in the driver). It may be one object or a list (select with --arm).
"""
import argparse
import hashlib
import json
import math
import os
import sys
import time

import numpy as np

SOURCE_COMMIT = "ab2b45cb8027518bcd06f944959ccc9080afe4bd"

# ----------------------------------------------------------------- protocol
# scripts/fixtures/quant3d-tip-protocol.mjs
TIP_TERMINAL_PHYSICAL_TIME = 1949.1356423198636
TIP_SAMPLE_PERIOD_PHYSICAL = 32.370331090315965
TIP_TERMINAL_SAMPLE_COUNT = 10


def fixed_terminal_schedule(dt, physical_time_scale=1.0,
                            terminal_physical_time=TIP_TERMINAL_PHYSICAL_TIME,
                            sample_period_physical=TIP_SAMPLE_PERIOD_PHYSICAL):
    """fixedTerminalSchedule() in f64, same expression order as the JS."""
    for label, value in (("dt", dt), ("physicalTimeScale", physical_time_scale),
                         ("terminalPhysicalTime", terminal_physical_time),
                         ("samplePeriodPhysical", sample_period_physical)):
        if not (value > 0 and math.isfinite(value)):
            raise ValueError(f"{label} must be positive and finite")
    count = math.ceil(terminal_physical_time / sample_period_physical)
    if count < TIP_TERMINAL_SAMPLE_COUNT:
        raise ValueError("ten declared terminal samples are required")
    checkpoints = []
    for index in range(count):
        physical = terminal_physical_time - (count - index - 1) * sample_period_physical
        requested = physical * physical_time_scale
        steps = math.ceil(requested / dt)
        if steps < 1:
            raise ValueError("declared checkpoint exceeds safe integer substeps")
        tau = steps * dt
        checkpoints.append({"index": index, "steps": steps, "requestedPhysicalTime": physical,
                            "requestedTimeTau0": requested, "timeTau0": tau,
                            "physicalTime": tau / physical_time_scale, "roundingTau0": tau - requested})
    if any(checkpoints[i]["steps"] <= checkpoints[i - 1]["steps"] for i in range(1, count)):
        raise ValueError("observation cadence must exceed one distinct substep")
    return {"terminalSteps": checkpoints[-1]["steps"], "checkpoints": checkpoints}


# ---------------------------------------------------------- driver constants
# DEFAULTS3D (src/sim3d.ts) overridden by parameters() in quant3d-tip-driver.mjs.
def driver_parameters(config):
    lam = config["lambda"]
    return {"solver": 1, "lambda": lam, "dx": config["dx"], "dt": config["dt"], "epsBar": 1, "tau": 1,
            "delta": config["epsilon4"], "deltaZ": 0, "aniMode3": 1, "latent": 1,
            "dTherm": .6267 * lam, "dSol": .6267 * lam, "frozenT": 0, "alloyOn": 0, "noiseAmp": 0,
            "pPore": 0, "twinProb": 0, "facet": 0, "scen": 0, "coolRate": 0, "heatIn": 0,
            "tFar": 1 - config["undercooling"]}


def v8_hypot(*args):
    """V8 Math.hypot (src/builtins/math.tq): max-normalised Kahan sum of squares.
    Vectorised over NumPy float64 arrays; the per-element operation order is the
    builtin's. Verified against node in the self-test data path (see .md)."""
    absv = [np.abs(np.asarray(a, dtype=np.float64)) for a in args]
    mx = absv[0]
    for a in absv[1:]:
        mx = np.maximum(mx, a)
    safe = np.where(mx == 0, 1.0, mx)
    total = np.zeros_like(mx)
    comp = np.zeros_like(mx)
    for a in absv:
        n = a / safe
        summand = n * n - comp
        prelim = total + summand
        comp = (prelim - total) - summand
        total = prelim
    return np.where(mx == 0, 0.0, np.sqrt(total) * mx)


def _hiword(x):
    return (x.view(np.uint64) >> np.uint64(32)).astype(np.int64)


def _from_hiword(hi):
    return (np.asarray(hi, dtype=np.uint64) << np.uint64(32)).view(np.float64)


def fdlibm_expm1(x):
    """V8 base::ieee754::expm1 (fdlibm/FreeBSD msun), vectorised; finite |x| < 709 only."""
    x = np.array(x, dtype=np.float64)
    hx = _hiword(x)
    neg = (hx & 0x80000000) != 0
    hx = hx & 0x7FFFFFFF
    if (hx >= 0x40862E42).any():
        raise ValueError("fdlibm_expm1 port covers |x| < 709.78 only")
    ln2_hi, ln2_lo, invln2 = 6.93147180369123816490e-01, 1.90821492927058770002e-10, 1.44269504088896338700e+00
    Q1, Q2, Q3 = -3.33333333333331316428e-02, 1.58730158725481460165e-03, -7.93650757867487942473e-05
    Q4, Q5 = 4.00821782732936239552e-06, -2.01099218183624371326e-07
    minus_one = neg & (hx >= 0x4043687A)          # x < -56 ln2: tiny - one = -1
    tiny = hx < 0x3C900000                        # |x| < 2^-54: x
    red = hx > 0x3FD62E42
    near = red & (hx < 0x3FF0A2B2)
    k = np.zeros(x.shape, dtype=np.int64)
    hi, lo = x.copy(), np.zeros_like(x)
    m = near & ~neg; hi[m] = x[m] - ln2_hi; lo[m] = ln2_lo; k[m] = 1
    m = near & neg; hi[m] = x[m] + ln2_hi; lo[m] = -ln2_lo; k[m] = -1
    gen = red & ~near
    kg = np.trunc(invln2 * x[gen] + np.where(neg[gen], -0.5, 0.5)).astype(np.int64)   # C double->int
    k[gen] = kg
    tg = kg.astype(np.float64)
    hi[gen] = x[gen] - tg * ln2_hi
    lo[gen] = tg * ln2_lo
    xr = np.where(red, hi - lo, x)
    c = np.where(red, (hi - xr) - lo, 0.0)
    hfx = 0.5 * xr
    hxs = xr * hfx
    r1 = 1.0 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))))
    t = 3.0 - r1 * hfx
    e = hxs * ((r1 - t) / (6.0 - xr * t))
    out = xr - (xr * e - hxs)                     # k == 0
    twopk = _from_hiword(0x3FF00000 + (k << 20))
    e2 = (xr * (e - c) - c) - hxs
    out = np.where(k == -1, 0.5 * (xr - e2) - 0.5, out)
    out = np.where((k == 1) & (xr < -0.25), -2.0 * (e2 - (xr + 0.5)), out)
    out = np.where((k == 1) & ~(xr < -0.25), 1.0 + 2.0 * (xr - e2), out)
    far = (k <= -2) | (k > 56)
    out = np.where(far, (1.0 - (e2 - xr)) * twopk - 1.0, out)
    small_k = (k >= 2) & (k < 20)
    t1 = _from_hiword(0x3FF00000 - (0x200000 >> np.clip(k, 0, 63)))
    out = np.where(small_k, (t1 - (e2 - xr)) * twopk, out)
    mid_k = (k >= 20) & (k <= 56)
    t2 = _from_hiword(np.clip(0x3FF - k, 0, 0x7FF) << 20)
    out = np.where(mid_k, ((xr - (e2 + t2)) + 1.0) * twopk, out)
    out = np.where(tiny, x, out)
    return np.where(minus_one, -1.0, out)


def fdlibm_tanh(x):
    """V8 Math.tanh = base::ieee754::tanh (fdlibm), vectorised; finite x."""
    x = np.asarray(x, dtype=np.float64)
    jx = _hiword(x)
    ix = jx & 0x7FFFFFFF
    ax = np.abs(x)
    big = ix >= 0x3FF00000
    t_big = fdlibm_expm1(np.where(big & (ix < 0x40360000), 2.0 * ax, 0.0))
    t_small = fdlibm_expm1(np.where(~big, -2.0 * ax, 0.0))
    z = np.where(big, 1.0 - 2.0 / (t_big + 2.0), -t_small / (t_small + 2.0))
    z = np.where(ix >= 0x40360000, 1.0, z)        # |x| >= 22: one - tiny
    z = np.where(ix < 0x3E300000, ax, z)          # |x| < 2^-28: x
    return np.where((jx & 0x80000000) != 0, -z, z)


def initial_fields(config, dims, dtype=np.float64):
    """fields() of the driver: f64 tanh seed (V8 Math.hypot/Math.tanh), returned
    in `dtype` (np.float32 = the Float32Array the GPU uploads). Built in z-slabs
    so the f64 temporaries stay small on large boxes. Layout (z, y, x)."""
    nx, ny, nz = dims
    dx, radius = config["dx"], config["radius"]
    center = config.get("center") or [0, 0, 0]
    x = (np.arange(nx, dtype=np.float64) + .5) * dx - center[0]
    y = (np.arange(ny, dtype=np.float64) + .5) * dx - center[1]
    z = (np.arange(nz, dtype=np.float64) + .5) * dx - center[2]
    phi = np.empty((nz, ny, nx), dtype=dtype)
    step = max(1, (1 << 21) // (nx * ny))
    for z0 in range(0, nz, step):
        Z, Y, X = np.meshgrid(z[z0:z0 + step], y, x, indexing="ij")
        distance = v8_hypot(X, Y, Z)
        phi[z0:z0 + step] = .5 * (1 - fdlibm_tanh((distance - radius) / math.sqrt(2)))  # Math.SQRT2
    T = np.full((nz, ny, nx), 1 - config["undercooling"], dtype=dtype)
    return phi, T


# ------------------------------------------------------------- metrology
# JavaScript-faithful ports of scripts/fixtures/quant3d-tip-analysis.mjs used
# by sample(); scalar float64, same reduction order as the JS.
def phase_crossing_batch(values, nodes, coordinate="atanh"):
    """phaseCrossing() for many brackets at once (rows); identical per-row
    float64 operation order (Lagrange product order, 24 bisection steps)."""
    values = np.asarray(values, dtype=np.float64)
    if values.shape[1] != len(nodes) or not np.isfinite(values).all():
        raise ValueError("invalid level-set samples")
    data = values if coordinate == "raw" else np.arctanh(1 - 2 * values)
    if not np.isfinite(data).all():
        raise ValueError("saturated samples do not resolve the interface profile")
    target = .5 if coordinate == "raw" else 0.0

    def poly(t):
        total = np.zeros(values.shape[0])
        for j, node in enumerate(nodes):
            product = np.ones(values.shape[0])
            for k, other in enumerate(nodes):
                if k != j:
                    product = product * (t - other) / (node - other)
            total = total + data[:, j] * product
        return total

    def before(v):
        return v >= target if coordinate == "raw" else v <= target

    zero = np.zeros(values.shape[0])
    if not (before(poly(zero)).all() and (~before(poly(zero + 1))).all()):
        raise ValueError("level-set crossing is not bracketed")
    lo, hi = zero.copy(), zero + 1
    for _ in range(24):
        mid = (lo + hi) / 2
        b = before(poly(mid))
        lo = np.where(b, mid, lo)
        hi = np.where(b, hi, mid)
    return (lo + hi) / 2


def js_line_fit(points):
    if len(points) < 3:
        raise ValueError("line fit needs at least three points")
    n = len(points)
    xm = 0.0
    for p in points:
        xm = xm + p[0]
    xm = xm / n
    ym = 0.0
    for p in points:
        ym = ym + p[1]
    ym = ym / n
    xx = 0.0
    for p in points:
        xx = xx + (p[0] - xm) ** 2
    if not (xx > 0):
        raise ValueError("degenerate fit abscissae")
    sxy = 0.0
    for p in points:
        sxy = sxy + (p[0] - xm) * (p[1] - ym)
    slope = sxy / xx
    intercept = ym - slope * xm
    var = 0.0
    for p in points:
        var = var + (p[1] - intercept - slope * p[0]) ** 2
    var = var / (n - 2)
    return {"slope": slope, "intercept": intercept, "slopeError": math.sqrt(var / xx),
            "interceptError": math.sqrt(var * (1 / n + xm * xm / xx)), "rms": math.sqrt(var)}


def _js_solve(matrix, values):
    n = len(values)
    a = [list(row) + [values[i]] for i, row in enumerate(matrix)]
    for k in range(n):
        best = k
        for j in range(k + 1, n):
            if abs(a[j][k]) > abs(a[best][k]):
                best = j
        if abs(a[best][k]) < 1e-12:
            raise ValueError("singular tip surface fit")
        a[k], a[best] = a[best], a[k]
        divisor = a[k][k]
        for j in range(k, n + 1):
            a[k][j] /= divisor
        for i in range(n):
            if i != k:
                factor = a[i][k]
                for j in range(k, n + 1):
                    a[i][j] -= factor * a[k][j]
    return [row[n] for row in a]


def _surface_fit(points, radius):
    data = [p for p in points if p["x"] * p["x"] + p["y"] * p["y"] <= radius * radius]
    if len(data) < 12:
        return None

    def features(p):
        x2, y2 = (p["x"] / radius) ** 2, (p["y"] / radius) ** 2
        return [1, x2, y2, x2 * x2, x2 * y2, y2 * y2]

    z0 = max(p["z"] for p in data)
    a = [[0.0] * 6 for _ in range(6)]
    b = [0.0] * 6
    for p in data:
        row = features(p)
        for j in range(6):
            b[j] += row[j] * (p["z"] - z0)
            for k in range(6):
                a[j][k] += row[j] * row[k]
    c = _js_solve(a, b)
    bx, by = c[1] / radius ** 2, c[2] / radius ** 2
    if not (bx < 0 and by < 0):
        return None
    total = 0.0
    for p in data:
        row = features(p)
        pred = z0
        for j in range(6):
            pred = pred + row[j] * c[j]
        total = total + (pred - p["z"]) ** 2
    rms = math.sqrt(total / (len(data) - 6))
    return {"radius": radius, "points": len(data), "tip": z0 + c[0], "bx": bx, "by": by,
            "rhoX": -1 / (2 * bx), "rhoY": -1 / (2 * by), "rho": -1 / (bx + by), "rms": rms}


def _local_tip_base(points, dx):
    initial = _surface_fit(points, 8 * dx)
    if not initial:
        raise ValueError("local tip is unresolved or no longer convex")
    windows = [w for w in (_surface_fit(points, initial["rho"] * f) for f in (.25, .35, .45, .5)) if w]
    if len(windows) < 3:
        raise ValueError("fewer than three resolved local curvature windows")
    if len({w["points"] for w in windows}) < 3:
        raise ValueError("local windows sample the same points; refine dx")
    ext = {f: js_line_fit([[w["radius"] ** 4, w[f]] for w in windows]) for f in ("bx", "by", "tip")}
    x, y, z = ext["bx"], ext["by"], ext["tip"]
    if not (x["intercept"] < 0 and y["intercept"] < 0):
        raise ValueError("invalid extrapolated principal curvatures")
    rho = -1 / (x["intercept"] + y["intercept"])
    rho_error = max(max(abs(w["rho"] - rho) for w in windows),
                    2 * (x["interceptError"] + y["interceptError"]) * rho * rho)
    return {"tip": z["intercept"],
            "tipError": max(max(abs(w["tip"] - z["intercept"]) for w in windows), 2 * z["interceptError"]),
            "rho": rho, "rhoError": rho_error, "rhoX": -1 / (2 * x["intercept"]),
            "rhoY": -1 / (2 * y["intercept"]), "windows": windows}


def local_tip(points, dx):
    """localTip() of quant3d-tip-analysis.mjs (fine, coarse-control and raw variants)."""
    fine = _local_tip_base(points, dx)
    if all(math.isfinite(p.get("zCoarse", float("nan"))) for p in points):
        coarse = _local_tip_base([{**p, "z": p["zCoarse"]} for p in points], dx)
        fine["interpolation"] = {"coordinate": "atanh(1-2psi)", "degree": 5, "controlDegree": 3,
                                 "rhoDifference": abs(fine["rho"] - coarse["rho"]),
                                 "tipDifference": abs(fine["tip"] - coarse["tip"])}
        fine["rhoError"] = max(fine["rhoError"], fine["interpolation"]["rhoDifference"])
        fine["tipError"] = max(fine["tipError"], fine["interpolation"]["tipDifference"])
    if all(math.isfinite(p.get("zRaw", float("nan"))) for p in points):
        raw = _local_tip_base([{**p, "z": p["zRaw"]} for p in points], dx)
        fine["rawPhaseSensitivity"] = {"degree": 5, "rho": raw["rho"], "tip": raw["tip"],
                                       "rhoRelativeDifference": abs(raw["rho"] / fine["rho"] - 1),
                                       "tipDifference": abs(raw["tip"] - fine["tip"])}
    return fine


# ------------------------------------------------------------------ solver
# PRECISION NOTES (where the GPU's f32 can differ from this IEEE evaluation):
# * '/' : WGSL does not require correctly rounded division; on the captured
#   Dawn/D3D12/Intel Xe2 path dt/tauLoc behaves as dt*(1/tauLoc) and
#   gph/|gph| as gph*(1/|gph|) (quant3d-fp64-port.md, gate 1 forensics). The
#   port keeps IEEE division. Uniform-only divisions (1/(2dx), 1/dx^2, /6,
#   /dTherm, /12) are the same for every cell.
# * sqrt : flux pass |grad phi| only; WGSL permits an approximate sqrt.
# * a*b+c : no fused multiply-add here; HLSL/D3D compilers may contract or
#   reorder unless 'precise'. FMA variants fitted the GPU worse (gate 1).
# * denormals : NumPy/CuPy keep f32 subnormals; D3D may flush them. They only
#   arise in the phi tail (< 1.2e-38).
# * dot(), sums : evaluated left to right as written ((x+y)+z, face and edge
#   sums in QUANT_EDGES3 order).
# * No inverseSqrt, pow, exp, tanh or atan reaches this pure path (inverseSqrt
#   and smoothstep are alloy-only; atan is the Kobayashi branch; hash3 noise
#   is multiplied by noiseAmp = 0). tanh/hypot (seed) and atanh (metrology) are
#   JavaScript float64: hypot and tanh are V8 ports here (bitwise), atanh is
#   NumPy's (<= 1 ulp from V8; sample() still matched the GPU JSON bitwise).
EDGES3 = [(-1, -1, 0), (-1, 1, 0), (1, -1, 0), (1, 1, 0),      # QUANT_EDGES3 order, (x, y, z)
          (-1, 0, -1), (-1, 0, 1), (1, 0, -1), (1, 0, 1),
          (0, -1, -1), (0, -1, 1), (0, 1, -1), (0, 1, 1)]


class QuantStatusError(RuntimeError):
    pass


# ------------------------------------------------------------ fused kernels
# One CUDA kernel per pass: flux, then phase+transport (transport reads only
# this cell's phase output, as in the array path). The per-cell functions are
# plain C shared by the CUDA kernels (CuPy RawModule, NVRTC --fmad=false, IEEE
# division/sqrt; f32 ftz forced by CuPy, see FUSED_NVRTC_OPTIONS) and by CPU host loops (any C compiler with
# -ffp-contract=off) used to validate them locally. Every statement mirrors one
# array operation of TipPort, in the same order; constants come from
# TipPort._constants in the working dtype.
FUSED_CONSTS = ("inv2dx", "lap_scale", "e2", "gcoef", "w2", "tau_a", "tau_b", "stab_l", "dx2", "coef_T",
                "qgmin_flux", "qgmin", "big", "lo_phi", "hi_phi", "T_lo", "T_hi", "half", "twelve", "c24",
                "one", "two", "zero", "four", "three", "delta", "lam", "dt_", "tau", "latent", "dtcool", "dtheat")
FUSED_SRC = r"""
/* quant3d fused tip kernels (quant3d-fp64-port.py); REAL_DOUBLE selects the dtype. */
#if REAL_DOUBLE
typedef double real;
#define SQRT sqrt
#else
typedef float real;
#define SQRT sqrtf
#endif
#ifdef __CUDACC__
#define DEVFN static __device__ __forceinline__
#define RESTRICT __restrict__
#else
#include <math.h>
#define DEVFN static inline
#define RESTRICT restrict
#endif
enum { C_INV2DX, C_LAPSCALE, C_E2, C_GCOEF, C_W2, C_TAUA, C_TAUB, C_STABL, C_DX2, C_COEFT, C_QGMINF, C_QGMIN,
       C_BIG, C_LOPHI, C_HIPHI, C_TLO, C_THI, C_HALF, C_TWELVE, C_C24, C_ONE, C_TWO, C_ZERO, C_FOUR, C_THREE,
       C_DELTA, C_LAM, C_DT, C_TAU, C_LATENT, C_DTCOOL, C_DTHEAT, C_COUNT };
enum { I_NX, I_NY, I_NZ, I_LATTICE, I_W2ONE, I_TAUONE, I_LATENTONE, I_COOL, I_HEAT, I_COUNT };
#define IDX(x, y, z) ((((long long)(z)) * ny + (y)) * nx + (x))

/* np.maximum / np.minimum semantics (NaN-propagating, first operand on ties). */
DEVFN real npmax(real a, real b) { return (a >= b || a != a) ? a : b; }
DEVFN real npmin(real a, real b) { return (a <= b || a != a) ? a : b; }

/* FLUX3D_WGSL with the identity quaternion: (A.xyz, w) per cell. */
DEVFN void flux_cell(int x, int y, int z, int nx, int ny, int nz, const real* RESTRICT c,
                     const real* RESTRICT phi, real* RESTRICT Ax, real* RESTRICT Ay, real* RESTRICT Az,
                     real* RESTRICT Aw) {
  const long long i = IDX(x, y, z);
  const int xe = x + 1 < nx ? x + 1 : nx - 1, xw = x > 0 ? x - 1 : 0;
  const int yn = y + 1 < ny ? y + 1 : ny - 1, ys = y > 0 ? y - 1 : 0;
  const int zu = z + 1 < nz ? z + 1 : nz - 1, zd = z > 0 ? z - 1 : 0;
  real t;
  real gx = phi[IDX(xe, y, z)] - phi[IDX(xw, y, z)]; gx = gx * c[C_INV2DX];
  real gy = phi[IDX(x, yn, z)] - phi[IDX(x, ys, z)]; gy = gy * c[C_INV2DX];
  real gz = phi[IDX(x, y, zu)] - phi[IDX(x, y, zd)]; gz = gz * c[C_INV2DX];
  real g2 = gx * gx; t = gy * gy; g2 = g2 + t; t = gz * gz; g2 = g2 + t;
  if (g2 < c[C_QGMINF]) { Ax[i] = c[C_ZERO]; Ay[i] = c[C_ZERO]; Az[i] = c[C_ZERO]; Aw[i] = c[C_E2]; return; }
  const real gm = SQRT(g2);
  const real nX = gx / gm, nY = gy / gm, nZ = gz / gm;
  real n3x = nX * nX; n3x = n3x * nX;
  real n3y = nY * nY; n3y = n3y * nY;
  real n3z = nZ * nZ; n3z = n3z * nZ;
  real s = n3x * nX; t = n3y * nY; s = s + t; t = n3z * nZ; s = s + t;
  s = s * c[C_FOUR]; s = s - c[C_THREE]; s = s * c[C_DELTA]; s = s + c[C_ONE];
  const real a = s;
  n3x = n3x * c[C_GCOEF]; n3y = n3y * c[C_GCOEF]; n3z = n3z * c[C_GCOEF];
  real d = n3x * nX; t = n3y * nY; d = d + t; t = n3z * nZ; d = d + t;
  const real ea = a * c[C_E2];
  const real coef = ea * gm;
  t = d * nX; n3x = n3x - t; Ax[i] = n3x * coef;
  t = d * nY; n3y = n3y - t; Ay[i] = n3y * coef;
  t = d * nZ; n3z = n3z - t; Az[i] = n3z * coef;
  Aw[i] = ea * a;
}

/* quantLap3: (2*faceSum + edgeSum - 24*center) * (invdx2/6), QUANT_EDGES3 order. */
DEVFN real lap18(const real* RESTRICT f, int x, int y, int z, int xe, int xw, int yn, int ys, int zu, int zd,
                 int nx, int ny, const real* RESTRICT c) {
  real F = f[IDX(xe, y, z)] + f[IDX(xw, y, z)];
  F = F + f[IDX(x, yn, z)]; F = F + f[IDX(x, ys, z)]; F = F + f[IDX(x, y, zu)]; F = F + f[IDX(x, y, zd)];
  real E = f[IDX(xw, ys, z)] + f[IDX(xw, yn, z)];
  E = E + f[IDX(xe, ys, z)]; E = E + f[IDX(xe, yn, z)];
  E = E + f[IDX(xw, y, zd)]; E = E + f[IDX(xw, y, zu)]; E = E + f[IDX(xe, y, zd)]; E = E + f[IDX(xe, y, zu)];
  E = E + f[IDX(x, ys, zd)]; E = E + f[IDX(x, ys, zu)]; E = E + f[IDX(x, yn, zd)]; E = E + f[IDX(x, yn, zu)];
  F = F * c[C_TWO]; F = F + E;
  const real t = f[IDX(x, y, z)] * c[C_C24];
  F = F - t; F = F * c[C_LAPSCALE];
  return F;
}

/* phi3dWgsl (QUANT_PHASE3, pure) + transport3dWgsl; returns the status flag bits. */
DEVFN unsigned phase_cell(int x, int y, int z, const int* RESTRICT ip, const real* RESTRICT c,
                          const real* RESTRICT phi, const real* RESTRICT T, const real* RESTRICT Ax,
                          const real* RESTRICT Ay, const real* RESTRICT Az, const real* RESTRICT Aw,
                          real* RESTRICT phiN, real* RESTRICT TN) {
  const int nx = ip[I_NX], ny = ip[I_NY], nz = ip[I_NZ];
  const long long i = IDX(x, y, z);
  const int xe = x + 1 < nx ? x + 1 : nx - 1, xw = x > 0 ? x - 1 : 0;
  const int yn = y + 1 < ny ? y + 1 : ny - 1, ys = y > 0 ? y - 1 : 0;
  const int zu = z + 1 < nz ? z + 1 : nz - 1, zd = z > 0 ? z - 1 : 0;
  const real p = phi[i], tt = T[i];
  const real lapPhi = lap18(phi, x, y, z, xe, xw, yn, ys, zu, zd, nx, ny, c);
  const real lapT = lap18(T, x, y, z, xe, xw, yn, ys, zu, zd, nx, ny, c);
  real u;
  real gpx = phi[IDX(xe, y, z)] - phi[IDX(xw, y, z)]; gpx = gpx * c[C_INV2DX];
  real gpy = phi[IDX(x, yn, z)] - phi[IDX(x, ys, z)]; gpy = gpy * c[C_INV2DX];
  real gpz = phi[IDX(x, y, zu)] - phi[IDX(x, y, zd)]; gpz = gpz * c[C_INV2DX];
  const real fw = Aw[i];
  real gWx = Aw[IDX(xe, y, z)] - Aw[IDX(xw, y, z)]; gWx = gWx * c[C_INV2DX];
  real gWy = Aw[IDX(x, yn, z)] - Aw[IDX(x, ys, z)]; gWy = gWy * c[C_INV2DX];
  real gWz = Aw[IDX(x, y, zu)] - Aw[IDX(x, y, zd)]; gWz = gWz * c[C_INV2DX];
  /* QUANT-NORMAL-FLUX: odd reflection of A's normal component at the faces */
  const real aE = x == nx - 1 ? -Ax[i] : Ax[IDX(x + 1, y, z)], aW = x == 0 ? -Ax[i] : Ax[IDX(x - 1, y, z)];
  const real aN = y == ny - 1 ? -Ay[i] : Ay[IDX(x, y + 1, z)], aS = y == 0 ? -Ay[i] : Ay[IDX(x, y - 1, z)];
  const real aU = z == nz - 1 ? -Az[i] : Az[IDX(x, y, z + 1)], aD = z == 0 ? -Az[i] : Az[IDX(x, y, z - 1)];
  real rdiv = aE - aW; u = aN - aS; rdiv = rdiv + u; u = aU - aD; rdiv = rdiv + u; rdiv = rdiv * c[C_INV2DX];
  real dot = gWx * gpx; u = gWy * gpy; dot = dot + u; u = gWz * gpz; dot = dot + u;
  real aniso = fw * lapPhi; aniso = aniso + dot; aniso = aniso + rdiv;
  real q = p * c[C_TWO]; q = q - c[C_ONE];
  real well = q * q; well = c[C_ONE] - well;
  const real drive = tt - c[C_ONE];
  real tauLoc;
  int bad32 = 0;
  if (ip[I_LATTICE]) {
    const real X = ip[I_W2ONE] ? fw : fw / c[C_W2];
    tauLoc = X - c[C_TAUB]; tauLoc = tauLoc * c[C_TAUA];
    bad32 = !((tauLoc > 0) && (tauLoc <= c[C_BIG]));
  } else {
    tauLoc = ip[I_TAUONE] ? fw : fw * c[C_TAU];
    if (!ip[I_W2ONE]) tauLoc = tauLoc / c[C_W2];
  }
  real r = q * q; r = r * q; r = q - r;
  real L = well * c[C_LAM]; L = L * well; L = L * drive;
  r = r - L; r = r * c[C_HALF];
  real raw = c[C_DT] / tauLoc; r = r + aniso; raw = raw * r; raw = raw + p;
  real phiNew = npmin(npmax(raw, c[C_ZERO]), c[C_ONE]);
  real dPhi = phiNew - p;
  unsigned flags = 0;
  real st = c[C_DX2] * tauLoc; st = st / c[C_TWELVE];
  int bad2 = 0;
  if (c[C_STABL] > st) {
    real g2p = gpx * gpx; u = gpy * gpy; g2p = g2p + u; u = gpz * gpz; g2p = g2p + u;
    const int active = ((p > c[C_LOPHI]) && (p < c[C_HIPHI])) || (g2p > c[C_QGMIN]);
    bad2 = active && !bad32;
  }
  const int bad4 = !((raw >= -c[C_BIG]) && (raw <= c[C_BIG])) && !bad32 && !bad2;
  if (bad32) flags |= 32u;
  if (bad2) flags |= 2u;
  if (bad4) flags |= 4u;
  if (flags) { phiNew = p; dPhi = c[C_ZERO]; }
  real TNew = lapT * c[C_COEFT]; TNew = TNew + tt;
  if (ip[I_LATENTONE]) { TNew = TNew + dPhi; } else { u = dPhi * c[C_LATENT]; TNew = TNew + u; }
  if (ip[I_COOL]) TNew = TNew - c[C_DTCOOL];
  if (ip[I_HEAT]) TNew = TNew + c[C_DTHEAT];
  if (!((TNew >= c[C_TLO]) && (TNew <= c[C_THI]))) flags |= 16u;
  phiN[i] = phiNew;
  TN[i] = npmin(npmax(TNew, -c[C_ONE]), c[C_TWO]);
  return flags;
}

#ifdef __CUDACC__
extern "C" __global__ void flux_kernel(const int* RESTRICT ip, const real* RESTRICT c, const real* RESTRICT phi,
                                       real* RESTRICT Ax, real* RESTRICT Ay, real* RESTRICT Az, real* RESTRICT Aw) {
  const int x = blockIdx.x * blockDim.x + threadIdx.x, y = blockIdx.y * blockDim.y + threadIdx.y,
            z = blockIdx.z * blockDim.z + threadIdx.z;
  const int nx = ip[I_NX], ny = ip[I_NY], nz = ip[I_NZ];
  if (x >= nx || y >= ny || z >= nz) return;
  flux_cell(x, y, z, nx, ny, nz, c, phi, Ax, Ay, Az, Aw);
}
extern "C" __global__ void phase_kernel(const int* RESTRICT ip, const real* RESTRICT c, const real* RESTRICT phi,
                                        const real* RESTRICT T, const real* RESTRICT Ax, const real* RESTRICT Ay,
                                        const real* RESTRICT Az, const real* RESTRICT Aw, real* RESTRICT phiN,
                                        real* RESTRICT TN, unsigned* flags) {
  const int x = blockIdx.x * blockDim.x + threadIdx.x, y = blockIdx.y * blockDim.y + threadIdx.y,
            z = blockIdx.z * blockDim.z + threadIdx.z;
  if (x >= ip[I_NX] || y >= ip[I_NY] || z >= ip[I_NZ]) return;
  const unsigned f = phase_cell(x, y, z, ip, c, phi, T, Ax, Ay, Az, Aw, phiN, TN);
  if (f) atomicOr(flags, f);
}
#else
#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT __attribute__((visibility("default")))
#endif
EXPORT void flux_host(const int* ip, const real* c, const real* phi, real* Ax, real* Ay, real* Az, real* Aw) {
  const int nx = ip[I_NX], ny = ip[I_NY], nz = ip[I_NZ];
  for (int z = 0; z < nz; z++) for (int y = 0; y < ny; y++) for (int x = 0; x < nx; x++)
    flux_cell(x, y, z, nx, ny, nz, c, phi, Ax, Ay, Az, Aw);
}
EXPORT unsigned phase_host(const int* ip, const real* c, const real* phi, const real* T, const real* Ax,
                           const real* Ay, const real* Az, const real* Aw, real* phiN, real* TN) {
  unsigned flags = 0;
  for (int z = 0; z < ip[I_NZ]; z++) for (int y = 0; y < ip[I_NY]; y++) for (int x = 0; x < ip[I_NX]; x++)
    flags |= phase_cell(x, y, z, ip, c, phi, T, Ax, Ay, Az, Aw, phiN, TN);
  return flags;
}
#endif
"""
# CuPy appends -ftz=true to every NVRTC build (cupy/cuda/compiler.py, _compile_with_cache_cuda,
# v13.6) and NVRTC rejects a second --ftz ("defined more than once", first L40S box, 2026-11-26),
# so the CUDA build cannot ask for IEEE f32 denormals. FTZ applies to single precision only: the
# float64 kernels are unaffected, and the float32 fused path flushes f32 subnormals exactly as
# CuPy's own array path does. nvrtc_ptx() adds the same flag so the local PTX census matches.
FUSED_NVRTC_OPTIONS = ("--fmad=false", "--prec-div=true", "--prec-sqrt=true", "--std=c++14")
CUPY_FORCED_NVRTC_OPTIONS = ("-ftz=true",)
FUSED_CC_FLAGS = ("-O2", "-shared", "-ffp-contract=off", "-fno-fast-math")


def build_fused_cpu(dtype):
    """Compile FUSED_SRC for the CPU (validation path) and load it with ctypes.
    Compiler: $SOLIDIFY_CC (e.g. 'gcc'), else `python -m ziglang cc`. Cache:
    $SOLIDIFY_FUSED_CACHE, else the system temp directory."""
    import ctypes
    import subprocess
    import tempfile
    double = dtype == "float64"
    key = hashlib.sha256((FUSED_SRC + dtype + " ".join(FUSED_CC_FLAGS)).encode()).hexdigest()[:16]
    cache = os.environ.get("SOLIDIFY_FUSED_CACHE") or os.path.join(tempfile.gettempdir(), "solidify-fused")
    os.makedirs(cache, exist_ok=True)
    lib = os.path.join(cache, f"quant3d_fused_{dtype}_{key}" + (".dll" if sys.platform == "win32" else ".so"))
    if not os.path.exists(lib):
        src = os.path.join(cache, f"quant3d_fused_{key}.c")
        with open(src, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(FUSED_SRC)
        cc = os.environ.get("SOLIDIFY_CC", "").split() or [sys.executable, "-m", "ziglang", "cc"]
        extra = [] if sys.platform == "win32" else ["-fPIC", "-lm"]
        cmd = cc + list(FUSED_CC_FLAGS) + extra + ["-std=c11", f"-DREAL_DOUBLE={int(double)}", "-o", lib + ".tmp", src]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"fused CPU build failed: {' '.join(cmd)}\n{proc.stderr}")
        os.replace(lib + ".tmp", lib)
    return ctypes.CDLL(lib)


class FusedBackend:
    """Runs one substep as two fused kernels on the TipPort's own arrays:
    flux (phi -> A.xyz, w), then phase+transport (phi, T, A -> phiN, TN).
    device 'cuda': CuPy RawModule; device 'cpu': the same C via ctypes."""

    BLOCK = (32, 4, 2)

    def __init__(self, port, device):
        self.port, self.device = port, device
        double = port.dtype_name == "float64"
        consts = np.array([getattr(port, n) for n in FUSED_CONSTS], dtype=port.dt_type)
        if consts.dtype != port.dt_type or len(consts) != 32:
            raise AssertionError("fused constant table")
        ints = np.array([port.nx, port.ny, port.nz, int(port.lattice), int(port.w2 == 1), int(port.tau == 1),
                         int(port.latent == 1), int(port.coolRate != 0), int(port.heatIn != 0)], dtype=np.int32)
        if device == "cuda":
            import cupy
            self.cp = cupy
            self.module = cupy.RawModule(code=FUSED_SRC, options=FUSED_NVRTC_OPTIONS + (f"-DREAL_DOUBLE={int(double)}",))
            self.k_flux = self.module.get_function("flux_kernel")
            self.k_phase = self.module.get_function("phase_kernel")
            self.c, self.ip = cupy.asarray(consts), cupy.asarray(ints)
            self.flag_buf = cupy.zeros(1, dtype=cupy.uint32)
            bx, by, bz = self.BLOCK
            self.grid = (-(-port.nx // bx), -(-port.ny // by), -(-port.nz // bz))
        elif device == "cpu":
            import ctypes
            self.ct = ctypes
            self.lib = build_fused_cpu(port.dtype_name)
            self.lib.phase_host.restype = ctypes.c_uint
            self.c, self.ip = consts, ints
            self.host_flags = 0
        else:
            raise ValueError("fused device must be cuda or cpu")

    def step(self):
        p = self.port
        if self.device == "cuda":
            self.k_flux(self.grid, self.BLOCK, (self.ip, self.c, p.phi, p.Ax, p.Ay, p.Az, p.Aw))
            self.k_phase(self.grid, self.BLOCK, (self.ip, self.c, p.phi, p.T, p.Ax, p.Ay, p.Az, p.Aw,
                                                 p.phiN, p.TN, self.flag_buf))
        else:
            ptr = lambda a: self.ct.c_void_p(a.ctypes.data)
            for a in (p.phi, p.T, p.phiN, p.TN, p.Ax, p.Ay, p.Az, p.Aw):
                if not a.flags.c_contiguous or a.dtype != p.dt_type:
                    raise AssertionError("fused CPU path needs contiguous arrays of the working dtype")
            self.lib.flux_host(ptr(self.ip), ptr(self.c), ptr(p.phi), ptr(p.Ax), ptr(p.Ay), ptr(p.Az), ptr(p.Aw))
            self.host_flags |= self.lib.phase_host(ptr(self.ip), ptr(self.c), ptr(p.phi), ptr(p.T), ptr(p.Ax),
                                                   ptr(p.Ay), ptr(p.Az), ptr(p.Aw), ptr(p.phiN), ptr(p.TN))

    def read_flags(self):
        """Accumulated status bits (never reset, as the driver's status buffer); syncs the device."""
        if self.device == "cuda":
            return int(self.flag_buf.get()[0])
        return self.host_flags


def nvrtc_ptx(dtype, arch="compute_89", library=None):
    """Compile FUSED_SRC to PTX with NVRTC (no GPU needed) using the same options
    as the CUDA path. Library: $SOLIDIFY_NVRTC, else the nvidia-cuda-nvrtc-cu12
    wheel. Returns the PTX text."""
    import ctypes
    import glob as _glob
    if library is None:
        library = os.environ.get("SOLIDIFY_NVRTC")
    if library is None:
        import importlib.util as _iu
        spec = _iu.find_spec("nvidia")
        roots = list(spec.submodule_search_locations) if spec else []
        pats = ["cuda_nvrtc/bin/nvrtc64_*_0.dll", "cuda_nvrtc/lib/libnvrtc.so.*"]
        hits = [h for r in roots for pat in pats for h in _glob.glob(os.path.join(r, pat)) if ".alt." not in h]
        if not hits:
            raise RuntimeError("NVRTC library not found (pip install nvidia-cuda-nvrtc-cu12 or set SOLIDIFY_NVRTC)")
        library = sorted(hits)[0]
    if sys.platform == "win32":   # nvrtc loads nvrtc-builtins by name: preload it from the same directory
        libdir = os.path.dirname(os.path.abspath(library))
        os.environ["PATH"] = libdir + os.pathsep + os.environ.get("PATH", "")
        for builtins in _glob.glob(os.path.join(libdir, "nvrtc-builtins64_*.dll")):
            ctypes.CDLL(builtins)
    nv = ctypes.CDLL(library)
    prog = ctypes.c_void_p()
    check = lambda rc, what: None if rc == 0 else (_ for _ in ()).throw(RuntimeError(f"NVRTC {what} failed ({rc})"))
    check(nv.nvrtcCreateProgram(ctypes.byref(prog), FUSED_SRC.encode(), b"quant3d_fused.cu", 0, None, None), "create")
    opts = list(FUSED_NVRTC_OPTIONS + CUPY_FORCED_NVRTC_OPTIONS) + [f"-DREAL_DOUBLE={int(dtype == 'float64')}",
                                                                     f"--gpu-architecture={arch}", "--device-as-default-execution-space"]
    arr = (ctypes.c_char_p * len(opts))(*[o.encode() for o in opts])
    rc = nv.nvrtcCompileProgram(prog, len(opts), arr)
    size = ctypes.c_size_t()
    nv.nvrtcGetProgramLogSize(prog, ctypes.byref(size))
    log = ctypes.create_string_buffer(size.value)
    nv.nvrtcGetProgramLog(prog, log)
    if rc != 0:
        raise RuntimeError("NVRTC compile failed:\n" + log.value.decode(errors="replace"))
    nv.nvrtcGetPTXSize(prog, ctypes.byref(size))
    ptx = ctypes.create_string_buffer(size.value)
    check(nv.nvrtcGetPTX(prog, ptx), "getPTX")
    nv.nvrtcDestroyProgram(ctypes.byref(prog))
    return ptx.value.decode()


class TipPort:
    """State lives as two arrays phi, T of shape (nz, ny, nx) (texture order,
    x fastest). One step = flux pass over all voxels, then the phase and the
    transport pass fused per z-chunk (the transport pass reads only this cell's
    phase output, so fusing them is exact), written to the ping-pong pair."""

    def __init__(self, config, dtype="float32", backend="numpy", inputs="gpu", chunk_voxels=None,
                 init_state=None, keep_aux=False):
        if backend in ("cupy", "fused"):
            import cupy  # noqa: F401  (only imported on request)
            self.xp = cupy
        elif backend in ("numpy", "fused-cpu"):
            self.xp = np
        else:
            raise ValueError("backend must be numpy, cupy, fused (CUDA kernels) or fused-cpu")
        if dtype not in ("float32", "float64"):
            raise ValueError("dtype must be float32 or float64")
        if inputs not in ("gpu", "exact"):
            raise ValueError("inputs must be gpu or exact")
        self.backend, self.dtype_name, self.inputs = backend, dtype, inputs
        self.dt_type = np.float32 if dtype == "float32" else np.float64
        self.config = config
        self.p = driver_parameters(config)
        self.dims = [int(n) for n in config["dims"]]
        if len(self.dims) != 3 or not all(n > 1 for n in self.dims):
            raise ValueError("rectangular dimensions must be three grid extents > 1")
        self.nx, self.ny, self.nz = self.dims
        self.lattice = config.get("latticeKinetics") is True
        plane = self.nx * self.ny
        if chunk_voxels is None:
            # CPU: cache-sized chunks. GPU: ~25 chunk-sized temporaries at peak,
            # so 2^23 voxels keep them near 2 GB in float64.
            chunk_voxels = 1 << 15 if backend == "numpy" else 1 << 23
        layers = max(2, chunk_voxels // plane)
        self.chunks = [(z, min(z + layers, self.nz)) for z in range(0, self.nz, layers)]
        self._constants()
        xp = self.xp
        if init_state is not None:
            s = np.asarray(init_state)
            if s.shape != (self.nz, self.ny, self.nx, 2):
                raise ValueError(f"init state must have shape {(self.nz, self.ny, self.nx, 2)}")
            phi0, T0 = s[..., 0], s[..., 1]
        else:  # GPU upload: Float32Array(state); exact inputs keep the f64 seed
            phi0, T0 = initial_fields(config, self.dims, np.float32 if self.round_inputs else np.float64)
        self.phi = xp.asarray(np.ascontiguousarray(phi0), dtype=self.dt_type)
        self.T = xp.asarray(np.ascontiguousarray(T0), dtype=self.dt_type)
        self.phiN = xp.empty_like(self.phi)
        self.TN = xp.empty_like(self.T)
        self.Ax, self.Ay, self.Az, self.Aw = (xp.empty_like(self.phi) for _ in range(4))
        # Optional copy of the phase pass output (the GPU aux texture: phiNew, dPhi).
        self.aux = xp.empty(self.phi.shape + (2,), dtype=self.dt_type) if keep_aux else None
        self.fused = None
        if backend.startswith("fused"):
            if keep_aux:
                raise ValueError("keep_aux is an array-path diagnostic")
            self.fused = FusedBackend(self, "cuda" if backend == "fused" else "cpu")
        self.steps = 0
        self.time = 0.0          # JS clock: time += batch * p.dt per advance batch
        self.frame = 0
        self.flags = 0
        self.interface_seen = False

    # Uniforms are Float32 on the GPU; WGSL literals are f32 (abstract-float
    # const-expressions such as 47.0/75.0 are folded in f64, then rounded).
    def K(self, value):
        if self.round_inputs:
            return self.dt_type(np.float32(value))
        return self.dt_type(value)

    def _constants(self):
        self.round_inputs = self.dtype_name == "float32" or self.inputs == "gpu"
        K, p = self.K, self.p
        one, two = K(1.0), K(2.0)
        self.one, self.two, self.zero = one, two, K(0.0)
        self.dx_, self.dt_ = K(p["dx"]), K(p["dt"])
        self.epsBar, self.tau, self.delta = K(p["epsBar"]), K(p["tau"]), K(p["delta"])
        self.lam, self.dTherm, self.latent = K(p["lambda"]), K(p["dTherm"]), K(p["latent"])
        self.coolRate, self.heatIn = K(p["coolRate"]), K(p["heatIn"])
        dx, dt = self.dx_, self.dt_
        self.inv2dx = one / (two * dx)                       # let inv2dx = 1.0 / (2.0 * P.dx)
        self.invdx2 = one / (dx * dx)                        # let invdx2 = 1.0 / (P.dx * P.dx)
        self.lap_scale = self.invdx2 / K(6.0)                # (invdx2 / 6.0)
        self.e2 = self.epsBar * self.epsBar                  # let e2 = P.epsBar * P.epsBar
        self.gcoef = K(16.0) * self.delta                    # 16.0 * P.delta * n3
        self.w2 = max(K(1.0e-20), self.epsBar * self.epsBar)  # max(1.0e-20, epsBar^2)
        # tauLoc = P.tau * (47/75) * P.lambda / P.dTherm * (fC.w / w2 - (1321/9870) * dx * dx / w2)
        self.tau_a = (((self.tau * K(47.0 / 75.0)) * self.lam) / self.dTherm)
        self.tau_b = ((K(1321.0 / 9870.0) * dx) * dx) / self.w2
        # stability: dt * epsBar * epsBar * (1 + 20|delta|) > dx * dx * tauLoc / 12
        self.stab_l = ((dt * self.epsBar) * self.epsBar) * (one + K(20.0) * abs(self.delta))
        self.dx2 = dx * dx
        self.coef_T = dt * self.dTherm                       # P.dt * P.dTherm * lapT
        self.qgmin_flux = K(1e-12)                           # flux pass: g2 < 1e-12
        self.qgmin = K(1.0e-12)                              # QGMIN3
        self.big = K(3.0e38)                                 # finite3
        self.lo_phi, self.hi_phi = K(1.0e-6), K(0.999999)
        self.T_lo, self.T_hi = K(-1.00001), K(2.00001)
        self.half, self.twelve, self.c24 = K(0.5), K(12.0), K(24.0)
        self.four, self.three = K(4.0), K(3.0)
        self.dtcool, self.dtheat = dt * self.coolRate, dt * self.heatIn   # P.dt * P.coolRate, P.dt * P.heatIn

    def uniforms(self):
        names = ("dx_", "dt_", "epsBar", "tau", "delta", "lam", "dTherm", "latent", "inv2dx", "invdx2",
                 "lap_scale", "gcoef", "tau_a", "tau_b", "stab_l", "coef_T")
        return {n: float(getattr(self, n)) for n in names}

    # ---- neighbour access with cid3 clamping (= edge replication)
    def _zslab(self, F, lo, hi):
        nz, xp = F.shape[0], self.xp
        a, b = max(lo, 0), min(hi, nz)
        parts = [F[0:1]] * max(0, -lo)
        if a < b:
            parts.append(F[a:b])
        parts += [F[nz - 1:nz]] * max(0, hi - nz)
        return parts[0] if len(parts) == 1 else xp.concatenate(parts, axis=0)

    def _slab_xy(self, F, lo, hi):
        return self.xp.pad(self._zslab(F, lo, hi), ((0, 0), (1, 1), (1, 1)), mode="edge")

    @staticmethod
    def _nb(S, ox, oy, oz):
        L, Y, X = S.shape[0] - 2, S.shape[1] - 2, S.shape[2] - 2
        return S[1 + oz:1 + oz + L, 1 + oy:1 + oy + Y, 1 + ox:1 + ox + X]

    def _cdiff(self, F, axis):
        """F[clamp(i+1)] - F[clamp(i-1)] along axis (cid3 neighbours)."""
        D = self.xp.empty_like(F)
        sl = lambda s: tuple(s if k == axis else slice(None) for k in range(3))
        D[sl(slice(1, -1))] = F[sl(slice(2, None))] - F[sl(slice(None, -2))]
        D[sl(slice(0, 1))] = F[sl(slice(1, 2))] - F[sl(slice(0, 1))]
        D[sl(slice(-1, None))] = F[sl(slice(-1, None))] - F[sl(slice(-2, -1))]
        return D

    def _rdiff(self, F, axis):
        """QUANT-NORMAL-FLUX: aE - aW with aE = -fC at the high face, aW = -fC at the low face."""
        D = self.xp.empty_like(F)
        sl = lambda s: tuple(s if k == axis else slice(None) for k in range(3))
        D[sl(slice(1, -1))] = F[sl(slice(2, None))] - F[sl(slice(None, -2))]
        D[sl(slice(0, 1))] = F[sl(slice(1, 2))] - (-F[sl(slice(0, 1))])
        D[sl(slice(-1, None))] = (-F[sl(slice(-1, None))]) - F[sl(slice(-2, -1))]
        return D

    def _lap18(self, S):
        """quantLap3: (2*faceSum + edgeSum - 24*center) * (invdx2 / 6), WGSL sum order."""
        xp, nb = self.xp, self._nb
        F = nb(S, 1, 0, 0) + nb(S, -1, 0, 0)
        F += nb(S, 0, 1, 0)
        F += nb(S, 0, -1, 0)
        F += nb(S, 0, 0, 1)
        F += nb(S, 0, 0, -1)
        E = nb(S, *EDGES3[0]) + nb(S, *EDGES3[1])
        for e in EDGES3[2:]:
            E += nb(S, *e)
        F *= self.two
        F += E
        xp.multiply(nb(S, 0, 0, 0), self.c24, out=E)
        F -= E
        F *= self.lap_scale
        return F

    # ---- pass 0: FLUX3D_WGSL
    def _flux_chunk(self, z0, z1):
        # g2 == 0 cells give 0/0 normals; they are replaced by the (0, 0, 0, e2) branch.
        with np.errstate(divide="ignore", invalid="ignore"):
            self._flux_chunk_body(z0, z1)

    def _flux_chunk_body(self, z0, z1):
        xp, nb = self.xp, self._nb
        S = self._slab_xy(self.phi, z0 - 1, z1 + 1)
        gx = nb(S, 1, 0, 0) - nb(S, -1, 0, 0); gx *= self.inv2dx
        gy = nb(S, 0, 1, 0) - nb(S, 0, -1, 0); gy *= self.inv2dx
        gz = nb(S, 0, 0, 1) - nb(S, 0, 0, -1); gz *= self.inv2dx
        g2 = gx * gx                              # dot(gph, gph) = (x*x + y*y) + z*z
        t = gy * gy; g2 += t
        xp.multiply(gz, gz, out=t); g2 += t
        small = g2 < self.qgmin_flux              # || aniMode3 == 0u (aniMode3 is 1)
        gm = xp.sqrt(g2)
        nx_ = gx / gm; ny_ = gy / gm; nz_ = gz / gm       # nrm = gph / gm
        # qrotInv/qrot with the identity quaternion are exact identities.
        # aniso3, cubic harmonic: n3 = np*np*np; a = 1 + d(4(n3.np) - 3); g = 16 d n3
        n3x = nx_ * nx_; n3x *= nx_
        n3y = ny_ * ny_; n3y *= ny_
        n3z = nz_ * nz_; n3z *= nz_
        s = n3x * nx_
        xp.multiply(n3y, ny_, out=t); s += t
        xp.multiply(n3z, nz_, out=t); s += t
        s *= self.K(4.0); s -= self.K(3.0); s *= self.delta; s += self.one   # a
        a = s
        n3x *= self.gcoef; n3y *= self.gcoef; n3z *= self.gcoef               # gl = g
        d = n3x * nx_                              # dot(gl, nrm)
        xp.multiply(n3y, ny_, out=t); d += t
        xp.multiply(n3z, nz_, out=t); d += t
        ea = a if self.e2 == 1 else a * self.e2    # e2 * an.a (e2 == 1 is exact)
        coef = ea * gm                             # (e2 * a) * gm
        for comp, nrm, out in ((n3x, nx_, self.Ax), (n3y, ny_, self.Ay), (n3z, nz_, self.Az)):
            xp.multiply(d, nrm, out=t)
            comp -= t                              # tang = gl - dot(gl, nrm) * nrm
            comp *= coef                           # (e2 * a * gm) * tang
            out[z0:z1] = xp.where(small, self.zero, comp)
        w = ea * a                                 # (e2 * a) * a
        self.Aw[z0:z1] = xp.where(small, self.e2, w)

    # ---- passes 1+2: phi3dWgsl (QUANT_PHASE3) and transport3dWgsl
    def _phase_transport_chunk(self, z0, z1):
        xp, nb, nz = self.xp, self._nb, self.nz
        Sp = self._slab_xy(self.phi, z0 - 1, z1 + 1)
        St = self._slab_xy(self.T, z0 - 1, z1 + 1)
        phi, T = nb(Sp, 0, 0, 0), nb(St, 0, 0, 0)
        lapPhi = self._lap18(Sp)
        lapT = self._lap18(St)
        gpx = nb(Sp, 1, 0, 0) - nb(Sp, -1, 0, 0); gpx *= self.inv2dx
        gpy = nb(Sp, 0, 1, 0) - nb(Sp, 0, -1, 0); gpy *= self.inv2dx
        gpz = nb(Sp, 0, 0, 1) - nb(Sp, 0, 0, -1); gpz *= self.inv2dx
        fw = self.Aw[z0:z1]
        # gradW = vec3f(fE.w - fW.w, fN.w - fS.w, fU.w - fD.w) * inv2dx   (clamped)
        gWx = self._cdiff(fw, 2); gWx *= self.inv2dx
        gWy = self._cdiff(fw, 1); gWy *= self.inv2dx
        gWz = self._zslab(self.Aw, z0 + 1, z1 + 1) - self._zslab(self.Aw, z0 - 1, z1 - 1); gWz *= self.inv2dx
        # reflectedDivA = ((aE - aW) + (aN - aS) + (aU - aD)) * inv2dx
        rdiv = self._rdiff(self.Ax[z0:z1], 2)
        rdiv += self._rdiff(self.Ay[z0:z1], 1)
        azU, azD = self._zslab(self.Az, z0 + 1, z1 + 1), self._zslab(self.Az, z0 - 1, z1 - 1)
        dAz = azU - azD
        if z1 == nz:
            dAz[-1] = (-self.Az[nz - 1]) - azD[-1]
        if z0 == 0:
            dAz[0] = azU[0] - (-self.Az[0])
        rdiv += dAz
        rdiv *= self.inv2dx
        # aniso = fC.w * lapPhi + dot(gradW, gph) + reflectedDivA
        aniso = fw * lapPhi
        t = gWx * gpx
        xp.multiply(gWy, gpy, out=gWy); t += gWy
        xp.multiply(gWz, gpz, out=gWz); t += gWz
        aniso += t
        aniso += rdiv
        # QUANT_PHASE3 (pure: drive = T - 1, factor = 1)
        q = phi * self.two; q -= self.one                    # 2.0 * phi - 1.0
        well = q * q; xp.subtract(self.one, well, out=well)  # 1.0 - q * q
        drive = T - self.one
        if self.lattice:
            X = fw if self.w2 == 1 else fw / self.w2         # fC.w / w2 (w2 == 1 exact)
            tauLoc = X - self.tau_b
            tauLoc *= self.tau_a                             # coefA * (...)
            bad32 = ~((tauLoc > 0) & (tauLoc <= self.big))   # !(tauLoc > 0) || !finite3
        else:
            tauLoc = fw * self.tau if self.tau != 1 else fw.copy()
            if self.w2 != 1:
                tauLoc /= self.w2                            # (tau * fC.w / w2) * factor(=1)
            bad32 = None
        # react = 0.5 * (q - q*q*q - lambda*well*well*drive) (+ noiseAmp * ... = 0)
        r = q * q; r *= q
        xp.subtract(q, r, out=r)
        L = well * self.lam; L *= well; L *= drive
        r -= L
        r *= self.half
        # raw = phi + P.dt / tauLoc * (aniso + react)
        raw = self.dt_ / tauLoc
        r += aniso                                           # aniso + react
        raw *= r
        raw += phi
        phiNew = xp.minimum(xp.maximum(raw, self.zero), self.one)
        dPhi = phiNew - phi
        flags = 0
        stab = self.stab_l > ((self.dx2 * tauLoc) / self.twelve)
        bad2 = None
        if bool(stab.any()):
            g2p = gpx * gpx; g2p += gpy * gpy; g2p += gpz * gpz
            active = ((phi > self.lo_phi) & (phi < self.hi_phi)) | (g2p > self.qgmin)
            bad2 = stab & active
            if bad32 is not None:
                bad2 &= ~bad32
        if bad32 is not None and bool(bad32.any()):
            flags |= 32
        if bad2 is not None and bool(bad2.any()):
            flags |= 2
        bad4 = ~((raw >= -self.big) & (raw <= self.big))
        for m in (bad32, bad2):
            if m is not None:
                bad4 &= ~m
        if bool(bad4.any()):
            flags |= 4
        if flags:
            bad = bad4
            for m in (bad32, bad2):
                if m is not None:
                    bad = bad | m
            phiNew = xp.where(bad, phi, phiNew)
            dPhi = xp.where(bad, self.zero, dPhi)
        if self.aux is not None:
            self.aux[z0:z1, ..., 0] = phiNew
            self.aux[z0:z1, ..., 1] = dPhi
        if not self.interface_seen:
            g2p = gpx * gpx; g2p += gpy * gpy; g2p += gpz * gpz
            self.interface_seen = bool((((phi > self.lo_phi) & (phi < self.hi_phi)) | (g2p > self.qgmin)).any())
        # transport (frozenT == 0): TNew = T + dt*dTherm*lapT + latent*dPhi - dt*cool + dt*heat
        TNew = lapT
        TNew *= self.coef_T
        TNew += T
        if self.latent == 1:
            TNew += dPhi
        else:
            TNew += dPhi * self.latent
        if self.coolRate != 0:
            TNew -= self.dt_ * self.coolRate
        if self.heatIn != 0:
            TNew += self.dt_ * self.heatIn
        if bool((~((TNew >= self.T_lo) & (TNew <= self.T_hi))).any()):
            flags |= 16
        self.phiN[z0:z1] = phiNew
        self.TN[z0:z1] = xp.minimum(xp.maximum(TNew, -self.one), self.two)   # clamp(TNew, -1, 2)
        return flags

    def step(self):
        flags = 0
        if self.fused is not None:
            self.fused.step()          # flags accumulate on the device; read in advance()
        else:
            for z0, z1 in self.chunks:
                self._flux_chunk(z0, z1)
            for z0, z1 in self.chunks:
                flags |= self._phase_transport_chunk(z0, z1)
        self.phi, self.phiN = self.phiN, self.phi
        self.T, self.TN = self.TN, self.T
        self.steps += 1
        self.flags |= flags
        return flags

    def advance(self, count, clock=True):
        """advance(count) of the driver: count substeps; the f64 clock adds
        batch * p.dt per command batch of cap = floor(1.6e8 / voxels) steps."""
        start = time.perf_counter()
        for _ in range(count):
            self.step()
        if clock:
            cap = max(1, math.floor(1.6e8 / (self.nx * self.ny * self.nz)))
            left = count
            while left > 0:
                batch = min(left, cap)
                self.frame += 1
                self.time += batch * self.p["dt"]
                left -= batch
        if self.fused is not None:
            self.flags |= self.fused.read_flags()     # one device sync per advance, as the driver
        if self.flags:
            raise QuantStatusError(f"quantitative diagnostic flags {self.flags}")
        return {"count": count, "seconds": time.perf_counter() - start, "time": self.time, "steps": self.steps,
                "minTau": None if self.fused is not None else (1.0 if self.interface_seen else float("inf"))}

    def fields_numpy(self):
        xp = self.xp
        if xp is np:
            return self.phi, self.T
        return xp.asnumpy(self.phi), xp.asnumpy(self.T)

    def _to_np(self, a):
        return a if self.xp is np else self.xp.asnumpy(a)

    # ---- sample(): the driver's direct-state metrology, same schema
    def sample(self):
        nx, ny, nz, p, config = self.nx, self.ny, self.nz, self.p, self.config
        width = min(40, nx, ny)
        phi = self._to_np(self.phi[:, :width, :width]).astype(np.float64)   # exact widening
        Tslab = self._to_np(self.T[nz - 1:nz, 0:1, 0:1]).astype(np.float64)
        cond = (phi[:-1] >= .5) & (phi[1:] < .5)                            # a >= .5 && b < .5
        has = cond.any(axis=0)
        zhit = (nz - 2) - np.argmax(cond[::-1], axis=0)                      # first hit scanning down
        cols = [(y, x, int(zhit[y, x])) for y in range(width) for x in range(width)
                if has[y, x] and not (zhit[y, x] < 2 or zhit[y, x] + 3 >= nz)]
        points = []
        if cols:
            yy = np.array([c[0] for c in cols]); xx = np.array([c[1] for c in cols])
            zz = np.array([c[2] for c in cols])
            brackets = np.stack([phi[zz + k, yy, xx] for k in (-2, -1, 0, 1, 2, 3)], axis=1)
            fine = phase_crossing_batch(brackets, [-2, -1, 0, 1, 2, 3])
            coarse = phase_crossing_batch(brackets[:, 1:5], [-1, 0, 1, 2])
            raw = phase_crossing_batch(brackets, [-2, -1, 0, 1, 2, 3], "raw")
            dx = p["dx"]
            for i, (y, x, z) in enumerate(cols):
                points.append({"x": (x + .5) * dx, "y": (y + .5) * dx, "xCell": x, "yCell": y, "zCell": z,
                               "phaseBracket": [float(v) for v in brackets[i]],
                               "z": (z + .5 + float(fine[i])) * dx,
                               "zCoarse": (z + .5 + float(coarse[i])) * dx,
                               "zRaw": (z + .5 + float(raw[i])) * dx})
        top = float(Tslab[0, 0, 0])
        patch_rho = config["radius"]
        patch_tip = max((pt["z"] for pt in points), default=float("-inf"))
        patch_source = "initial seed radius; current local curvature unresolved"
        try:
            tip = local_tip(points, p["dx"])
            patch_rho, patch_tip = tip["rho"], tip["tip"]
            patch_source = "local curvature and axis intercept reconstructed from this same state snapshot"
        except (ValueError, ZeroDivisionError):
            pass
        if not math.isfinite(patch_tip):
            patch_tip = config["radius"]
        extent = max(1, math.ceil(2 * patch_rho / p["dx"]))
        x_count, y_count = min(nx, extent), min(ny, extent)
        z_begin = max(0, math.floor(patch_tip / p["dx"] - .5) - extent)
        z_end = min(nz, math.ceil(patch_tip / p["dx"] - .5) + extent + 1)
        zlen = max(1, z_end - z_begin)
        specs = [{"face": "x-max", "origin": [nx - 1, 0, z_begin], "size": [1, y_count, zlen]},
                 {"face": "y-max", "origin": [0, ny - 1, z_begin], "size": [x_count, 1, zlen]},
                 {"face": "z-max", "origin": [0, 0, nz - 1], "size": [x_count, y_count, 1]}]
        patches = []
        for spec in specs:
            (ox, oy, oz), (sx, sy, sz) = spec["origin"], spec["size"]
            if ox + sx > nx or oy + sy > ny or oz + sz > nz:
                raise ValueError("far-field patch outside the texture (the GPU copy would fail validation)")
            fp = self._to_np(self.phi[oz:oz + sz, oy:oy + sy, ox:ox + sx]).astype(np.float64).ravel().tolist()
            fT = self._to_np(self.T[oz:oz + sz, oy:oy + sy, ox:ox + sx]).astype(np.float64).ravel().tolist()
            lo, hi, total, phase_max = float("inf"), float("-inf"), 0.0, float("-inf")
            for a, b in zip(fp, fT):
                if not (math.isfinite(a) and math.isfinite(b)):
                    raise ValueError("non-finite far-field diagnostic")
                phase_max = max(phase_max, a)
                lo = min(lo, b); hi = max(hi, b); total += b
            n = len(fp)
            dev = max(abs(lo - p["tFar"]), abs(hi - p["tFar"]))
            patches.append({**spec, "samples": n, "temperature": {"min": lo, "max": hi, "mean": total / n},
                            "maximumPhase": phase_max, "maxAbsTemperatureDeviation": dev,
                            "maxAbsTemperatureDeviationOverUndercooling": dev / config["undercooling"]})
        label = "Float32" if self.dtype_name == "float32" else "Float64"
        return {"time": self.time, "steps": self.steps, "points": points, "aheadBoundaryTemperature": top,
                "phaseBracketSource": {"component": "stored phase psi", "crossing": .5,
                                       "zOffsetsFromZCell": [-2, -1, 0, 1, 2, 3],
                                       "coordinates": "voxel centers: ((xCell+.5),(yCell+.5),(zCell+.5+offset))*dx; "
                                                      f"brackets are direct {label} port state values"},
                "farFieldDiagnostics": {
                    "source": f"direct current-state {self.backend} {self.dtype_name} port array reads; "
                              "no diffusion-length proxy or extrapolated temperature",
                    "referenceTemperature": p["tFar"],
                    "referenceSource": "uniform initial far-field Ttilde = 1 - prescribed undercooling",
                    "undercooling": config["undercooling"], "patchTipW0": patch_tip, "patchRhoW0": patch_rho,
                    "patchSource": patch_source,
                    "patchGeometry": "transverse far faces within two local tip radii in z and the other transverse "
                                     "coordinate; ahead face within two radii of the axis; cell-centered coordinates",
                    "patches": patches}}


# --------------------------------------------------------------------- run
def disable_power_throttling():
    """Windows confines windowless background processes to efficiency cores
    (EcoQoS), silently halving CPU throughput. Opt this process out (per
    process, no admin, reversible). Returns True when the call succeeded."""
    if sys.platform != "win32":
        return False
    import ctypes
    from ctypes import wintypes

    class PowerThrottlingState(ctypes.Structure):
        _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    k32.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.SetProcessInformation.restype = wintypes.BOOL
    state = PowerThrottlingState(1, 1, 0)  # EXECUTION_SPEED controlled, throttling off
    return bool(k32.SetProcessInformation(k32.GetCurrentProcess(), 4, ctypes.byref(state), ctypes.sizeof(state)))


def bytes_per_voxel(dtype):
    """Persistent arrays: phi, T, ping-pong phi/T, flux A.xyz + w = 8 fields."""
    return 8 * np.dtype(dtype).itemsize


def load_config(path, arm=None):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, list):
        if arm is None:
            raise ValueError("config is a list of arms; select one with --arm NAME")
        matches = [a for a in data if a.get("name") == arm]
        if len(matches) != 1:
            raise ValueError(f"arm {arm!r} not found exactly once")
        return matches[0]
    if arm is not None and data.get("name") != arm:
        raise ValueError(f"config name {data.get('name')!r} != --arm {arm!r}")
    return data


def _replace(tmp, path):
    """os.replace with a short retry: Windows refuses while a reader holds the target."""
    for attempt in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.25)


def atomic_write_text(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    _replace(tmp, path)


def dump_fields(port, out, steps):
    """phi/T .npy restart point, written atomically (a kill mid-dump never leaves a torn file)."""
    d = os.path.join(out, "fields")
    os.makedirs(d, exist_ok=True)
    phi, T = port.fields_numpy()
    name = port.config.get("name", "arm")
    for tag, arr in (("phi", phi), ("T", T)):
        path = os.path.join(d, f"{name}-{steps:09d}-{tag}.npy")
        with open(path + ".tmp", "wb") as fh:
            np.save(fh, arr)
            fh.flush()
            os.fsync(fh.fileno())
        _replace(path + ".tmp", path)


def latest_restart(out, name, targets, dims, dtype):
    """Largest scheduled checkpoint with a complete, loadable phi/T dump."""
    shape = (dims[2], dims[1], dims[0])
    for steps in sorted((t for t in targets), reverse=True):
        stem = os.path.join(out, "fields", f"{name}-{steps:09d}")
        try:
            ok = all(np.load(stem + f"-{tag}.npy", mmap_mode="r").shape == shape
                     and np.load(stem + f"-{tag}.npy", mmap_mode="r").dtype == np.dtype(dtype) for tag in ("phi", "T"))
        except (OSError, ValueError):
            ok = False
        if ok:
            return steps
    return None


def run(args):
    unthrottled = disable_power_throttling() if not args.keep_power_throttling else False
    config = load_config(args.config, args.arm)
    init = np.load(args.init_state) if args.init_state else None
    port = TipPort(config, args.dtype, args.backend, args.inputs, args.chunk_voxels, init)
    name = config.get("name", "arm")
    out = os.path.abspath(args.out)
    os.makedirs(os.path.join(out, "samples"), exist_ok=True)
    if args.schedule == "protocol":
        plan = fixed_terminal_schedule(config["dt"], config.get("physicalTimeScale", 1.0))
        targets = [c["steps"] for c in plan["checkpoints"]]
    elif args.schedule.startswith("every:"):
        k = int(args.schedule[6:])
        if not args.steps:
            raise ValueError("--schedule every:K needs --steps N")
        targets = list(range(k, args.steps + 1, k))
    else:
        raise ValueError("schedule must be protocol or every:K")
    if args.max_checkpoints:
        targets = targets[:args.max_checkpoints]
    off_schedule = []
    if args.steps:
        targets = [t for t in targets if t <= args.steps]
        if not targets or targets[-1] != args.steps:
            targets.append(args.steps)
            off_schedule.append(args.steps)
    dump_at = sorted({int(s) for s in args.dump_at.split(",")}) if args.dump_at else []
    mpath = os.path.join(out, "port-run.json")
    cap = max(1, math.floor(1.6e8 / (port.nx * port.ny * port.nz)))

    def clock(delta):
        # The harness calls advance(checkpoint delta); the driver adds batch * p.dt
        # per command batch of at most cap substeps (float64 JS clock).
        left = delta
        while left > 0:
            batch = min(left, cap)
            port.frame += 1
            port.time += batch * port.p["dt"]
            left -= batch

    observed, clock_mark = 0, 0
    resume = None
    if args.resume == "auto":
        # Start-or-continue: the same command line can be re-issued after a kill.
        if os.path.exists(mpath):
            with open(mpath, encoding="utf-8") as fh:
                previous = json.load(fh)
            if previous.get("completed") and previous.get("targets") == targets:
                print("PORT-DONE already complete", json.dumps({"samples": len(previous["samples"])}))
                return previous
            resume = latest_restart(out, name, targets, port.dims, port.dt_type)
            print("PORT-RESUME", json.dumps({"fromSteps": resume}), flush=True)
    elif args.resume:
        resume = int(args.resume)
    if resume:
        # Restart from dumped fields at a written checkpoint; rebuild the clock exactly.
        if resume not in targets:
            raise ValueError("--resume STEP must be a scheduled checkpoint of this run")
        with open(mpath, encoding="utf-8") as fh:
            manifest = json.load(fh)
        if manifest["config"] != config or manifest["dtype"] != args.dtype or manifest["inputs"] != args.inputs:
            raise ValueError("resume: config/dtype/inputs differ from the original run")
        stem = os.path.join(out, "fields", f"{name}-{resume:09d}")
        port.phi = port.xp.asarray(np.load(stem + "-phi.npy"), dtype=port.dt_type)
        port.T = port.xp.asarray(np.load(stem + "-T.npy"), dtype=port.dt_type)
        for t in [t for t in targets if t <= resume]:
            clock(t - clock_mark)
            clock_mark = t
        port.steps = observed = resume
        manifest["samples"] = [s for s in manifest["samples"] if s["steps"] <= resume]
        manifest["unresolved"] = [s for s in manifest["unresolved"] if s["steps"] <= resume]
        known = {s["steps"] for s in manifest["samples"]}
        for t in [t for t in targets if t <= resume and t not in known]:
            # a kill between the sample write and the manifest save: re-register the file
            path = f"samples/{name}-{t:09d}.json"
            if os.path.exists(os.path.join(out, path)):
                blob = open(os.path.join(out, path), "rb").read()
                manifest["samples"].append({"path": path, "sha256": hashlib.sha256(blob).hexdigest(), "steps": t,
                                            "time": json.loads(blob)["time"], "recoveredOnResume": True})
        manifest["samples"].sort(key=lambda s: s["steps"])
        manifest.setdefault("resumes", []).append({"fromSteps": resume, "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                                   "backend": args.backend,
                                                   "portSha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest()})
        manifest["completed"] = False
        manifest["targets"], manifest["offScheduleTargets"] = targets, off_schedule
    else:
        manifest = {"purpose": "independent NumPy/CuPy port of the quant3d tip fixture; precision study, no acceptance",
                    "portSource": os.path.basename(__file__),
                    "portSha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest(),
                    "transliteratedFrom": SOURCE_COMMIT, "config": config, "dtype": args.dtype,
                    "backend": args.backend, "inputs": args.inputs, "uniformsInWorkingDtype": port.uniforms(),
                    "chunks": len(port.chunks), "bytesPerVoxelPersistent": bytes_per_voxel(args.dtype),
                    "windowsPowerThrottlingDisabled": unthrottled,
                    "targets": targets, "offScheduleTargets": off_schedule, "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "samples": [], "unresolved": [], "dumps": [], "completed": False}

    def save():
        atomic_write_text(mpath, json.dumps(manifest, indent=1) + "\n")

    if not resume:
        zero = port.sample()
        manifest["initialTip"] = max((pt["z"] for pt in zero["points"]), default=None)
        if args.dump_fields or 0 in dump_at:
            dump_fields(port, out, 0)
            manifest["dumps"].append(0)
    manifest["backendLast"] = args.backend
    save()
    started, first = time.perf_counter(), observed
    last_flush = time.perf_counter()
    stops = sorted(set(targets) | {s for s in dump_at if 0 < s <= targets[-1]})
    stops = [s for s in stops if s > observed]
    for stop in stops:
        port.advance(stop - observed, clock=False)
        observed = stop
        k = targets.index(stop) + 1 if stop in targets else 0
        if k:  # the checkpoint's sample is written before any restart dump of the same state
            clock(stop - clock_mark)
            clock_mark = stop
            raw = port.sample()
            source = f"direct {args.backend} {args.dtype} port state snapshot; quant3d-fp64-port.py ({SOURCE_COMMIT[:7]} WGSL)"
            text = json.dumps({"source": source, "config": config, **raw}, separators=(",", ":"), allow_nan=False)
            path = f"samples/{name}-{raw['steps']:09d}.json"
            atomic_write_text(os.path.join(out, path), text)
            entry = {"path": path, "sha256": hashlib.sha256(text.encode()).hexdigest(), "steps": raw["steps"],
                     "time": raw["time"], "wallSeconds": time.perf_counter() - started}
            try:
                t = local_tip(raw["points"], config["dx"])
                entry.update({"tip": t["tip"], "rho": t["rho"], "tipError": t["tipError"], "rhoError": t["rhoError"]})
            except (ValueError, ZeroDivisionError) as error:
                manifest["unresolved"].append({"steps": raw["steps"], "reason": str(error)})
            manifest["samples"].append(entry)
        explicit = bool(stop in dump_at or (args.dump_fields and k) or (stop == targets[-1] and args.dump_every)
                        or (args.dump_every and k and k % args.dump_every == 0))
        flush = bool(k and args.flush_minutes and stop != targets[-1]
                     and time.perf_counter() - last_flush >= 60 * args.flush_minutes)
        if explicit or flush:
            dump_fields(port, out, stop)
            manifest["dumps"].append(stop)
            if flush and not explicit:
                # Time-based restart points: keep the newest two, prune older ones.
                manifest.setdefault("restartDumps", []).append(stop)
                for old in manifest["restartDumps"][:-2]:
                    for tag in ("phi", "T"):
                        try:
                            os.remove(os.path.join(out, "fields", f"{name}-{old:09d}-{tag}.npy"))
                        except OSError:
                            pass
                    manifest["dumps"] = [d for d in manifest["dumps"] if d != old]
                manifest["restartDumps"] = manifest["restartDumps"][-2:]
            last_flush = time.perf_counter()
        if not k:
            continue
        elapsed = max(1e-9, time.perf_counter() - started)
        rate = port.nx * port.ny * port.nz * (observed - first) / elapsed
        eta = (targets[-1] - observed) * port.nx * port.ny * port.nz / max(rate, 1e-9) / 3600
        manifest["progress"] = {"steps": observed, "of": targets[-1], "voxelStepsPerSecond": rate, "etaHours": eta,
                                "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        print("PORT-PROGRESS", json.dumps({"arm": name, "steps": observed, "of": targets[-1],
                                           "minutes": round(elapsed / 60, 3), "voxelStepsPerSecond": rate,
                                           "etaHours": round(eta, 3)}), flush=True)
        save()
    manifest["completed"] = True
    manifest["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    manifest["wallSeconds"] = time.perf_counter() - started
    manifest["voxelStepsPerSecond"] = port.nx * port.ny * port.nz * (observed - first) / max(1e-9, manifest["wallSeconds"])
    save()
    return manifest


# --------------------------------------------------------------- self-test
def self_test():
    checks = []

    def check(name, ok, value):
        checks.append((name, bool(ok), value))

    # Schedule identical to fixedTerminalSchedule for the registered ladder arms (node values).
    s = fixed_terminal_schedule(0.0180006338, 1)
    check("w40-anchor schedule (61 checkpoints, 385/2183/3981 ... 108282)",
          len(s["checkpoints"]) == 61 and [c["steps"] for c in s["checkpoints"][:3]] == [385, 2183, 3981]
          and s["terminalSteps"] == 108282, s["terminalSteps"])
    s = fixed_terminal_schedule(0.017020371256848042, 0.5120000000000001)
    check("w50 schedule (209/1182/2156 ... 58634)",
          [c["steps"] for c in s["checkpoints"][:3]] == [209, 1182, 2156] and s["terminalSteps"] == 58634,
          s["terminalSteps"])
    # Metrology: selfTestTipGeometry() first control of quant3d-tip-analysis.mjs.
    dx, pts = .4, []
    for y in range(20):
        for x in range(20):
            X, Y = (x + .5) * dx, (y + .5) * dx
            pts.append({"x": X, "y": Y, "z": 73.25 - X * X / 24 - Y * Y / 24 + .00006 * (X ** 4 - 6 * X * X * Y * Y + Y ** 4)})
    t = local_tip(pts, dx)
    check("localTip port recovers rho=12, tip=73.25 (1e-8)", abs(t["rho"] / 12 - 1) <= 1e-8 and abs(t["tip"] - 73.25) <= 1e-8,
          (t["rho"], t["tip"]))
    # phaseCrossing of an exact tanh profile (crossing at offset .3).
    vals = np.array([[.5 * (1 - math.tanh((k - .3) / math.sqrt(2))) for k in (-2, -1, 0, 1, 2, 3)]])
    c = float(phase_crossing_batch(vals, [-2, -1, 0, 1, 2, 3])[0])
    check("phaseCrossing of an exact tanh profile (atanh is exact for tanh)", abs(c - .3) < 1e-6, c)
    base = {"name": "selftest", "lambda": 4, "epsilon4": .0171, "undercooling": .45, "radius": 6, "dx": .8,
            "dt": .0180006338, "D": 2.5068, "d0": .220975, "physicalTimeScale": 1, "latticeKinetics": True}
    # Boundary rule: a field invariant in y and z stays exactly invariant (clamped neighbours).
    for dtype in ("float32", "float64"):
        cfg = {**base, "dims": [24, 6, 5]}
        x = (np.arange(24) + .5) * .8
        prof = .5 * (1 - np.tanh((x - 9.3) / math.sqrt(2)))
        st = np.zeros((5, 6, 24, 2))
        st[..., 0] = prof[None, None, :]
        st[..., 1] = .55 + .01 * np.cos(x / 3)[None, None, :]
        port = TipPort(cfg, dtype, init_state=st.astype(np.float32))
        port.advance(40)
        inv = max(float(np.abs(port.phi - port.phi[:1, :1, :]).max()), float(np.abs(port.T - port.T[:1, :1, :]).max()))
        check(f"{dtype}: y/z-invariant planar front stays exactly invariant", inv == 0.0, inv)
    # Enthalpy sum(T - latent*phi) is conserved (the 18-point Laplacian with clamped
    # ghosts is conservative) while no clamp is active.
    for dtype, tol in (("float32", 2e-6), ("float64", 1e-13)):
        cfg = {**base, "dims": [16, 18, 20], "center": [6.4, 7.2, 8.0], "radius": 4}
        port = TipPort(cfg, dtype)
        h0 = float((port.T.astype(np.float64) - port.phi.astype(np.float64)).sum())
        port.advance(60)
        h1 = float((port.T.astype(np.float64) - port.phi.astype(np.float64)).sum())
        check(f"{dtype}: enthalpy conserved over 60 steps (relative {tol:g})", abs(h1 - h0) <= tol * abs(h0),
              abs(h1 - h0) / abs(h0))
    # Cubic symmetry of the corner seed in a cube.
    for dtype, tol in (("float32", 1e-6), ("float64", 1e-14)):
        port = TipPort({**base, "dims": [14, 14, 14]}, dtype)
        port.advance(30)
        phi = port.phi.astype(np.float64)
        asym = max(float(np.abs(phi - phi.transpose(p)).max()) for p in ((0, 2, 1), (1, 0, 2), (2, 1, 0), (1, 2, 0)))
        check(f"{dtype}: corner seed keeps cubic (axis-permutation) symmetry ({tol:g})", asym <= tol, asym)
    # Short f32 vs f64 agreement.
    a = TipPort({**base, "dims": [14, 14, 14]}, "float32"); a.advance(50)
    b = TipPort({**base, "dims": [14, 14, 14]}, "float64"); b.advance(50)
    d = float(np.abs(a.phi.astype(np.float64) - b.phi).max())
    check("float32 vs float64 phase after 50 steps < 1e-5", d < 1e-5, d)
    # Chunked evaluation is bitwise identical to one chunk.
    c1 = TipPort({**base, "dims": [10, 12, 23]}, "float32")
    c2 = TipPort({**base, "dims": [10, 12, 23]}, "float32", chunk_voxels=240)
    c1.advance(20); c2.advance(20)
    check("z-chunked evaluation is bitwise identical to unchunked",
          c1.phi.tobytes() == c2.phi.tobytes() and c1.T.tobytes() == c2.T.tobytes(), len(c2.chunks))
    # sample() schema on the corner seed.
    sm = TipPort({**base, "dims": [20, 20, 24], "radius": 8}, "float32").sample()
    keys = ["time", "steps", "points", "aheadBoundaryTemperature", "phaseBracketSource", "farFieldDiagnostics"]
    check("sample() keys match the driver's", list(sm) == keys and len(sm["points"]) > 0
          and list(sm["points"][0]) == ["x", "y", "xCell", "yCell", "zCell", "phaseBracket", "z", "zCoarse", "zRaw"],
          len(sm["points"]))
    ok = all(c[1] for c in checks)
    for name, passed, value in checks:
        print(("PASS " if passed else "FAIL ") + name + f": {value}")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--config")
    ap.add_argument("--arm")
    ap.add_argument("--out")
    ap.add_argument("--dtype", default="float64", choices=["float32", "float64"])
    ap.add_argument("--backend", default="numpy", choices=["numpy", "cupy", "fused", "fused-cpu"],
                    help="numpy/cupy: array path; fused: one CUDA kernel per pass (CuPy RawModule); "
                         "fused-cpu: the same kernels compiled for the CPU (validation)")
    ap.add_argument("--inputs", default="gpu", choices=["gpu", "exact"],
                    help="gpu: uniforms, WGSL literals and the initial state rounded to Float32 first (isolates "
                         "arithmetic precision); exact: float64 values of the config/literals (float64 only)")
    ap.add_argument("--steps", type=int, help="stop at this substep (short tests); writes a sample there")
    ap.add_argument("--max-checkpoints", type=int)
    ap.add_argument("--schedule", default="protocol", help="protocol (fixedTerminalSchedule) or every:K")
    ap.add_argument("--dump-fields", action="store_true", help="save phi/T .npy at step 0 and every checkpoint")
    ap.add_argument("--dump-at", help="comma list of substeps at which to save phi/T .npy")
    ap.add_argument("--dump-every", type=int, help="save phi/T .npy at every K-th checkpoint and the last (restart points)")
    ap.add_argument("--resume", help="STEP: restart at that checkpoint from OUT/fields/<name>-STEP-{phi,T}.npy; "
                                     "auto: start, or continue from the newest complete dump (re-issue after a kill)")
    ap.add_argument("--flush-minutes", type=float, default=0,
                    help="write a restart dump at the first checkpoint after every M minutes (newest two kept)")
    ap.add_argument("--init-state", help="(nz, ny, nx, 2) npy initial (phi, T), e.g. a GPU readback")
    ap.add_argument("--chunk-voxels", type=int)
    ap.add_argument("--keep-power-throttling", action="store_true",
                    help="Windows: do not opt this process out of efficiency-core confinement")
    ap.add_argument("--box-gates", action="store_true",
                    help="cloud-GPU gates (fused vs array fp64, fused fp32 vs WGSL captures, throughput); "
                         "prints PASS/FAIL lines, exits non-zero on any failure")
    ap.add_argument("--capture", default="verify-out/fp64-port/capture", help="--box-gates: WGSL capture directory")
    ap.add_argument("--arms", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "quant3d-fp64-port-arms.json"),
                    help="--box-gates: arm configs for the throughput probe")
    ap.add_argument("--probe-steps", type=int, default=2000, help="--box-gates: timed steps per throughput probe")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(0 if self_test() else 1)
    if args.box_gates:
        import importlib.util as _iu
        spec = _iu.spec_from_file_location("quant3d_fp64_port_selftest", os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "quant3d-fp64-port-selftest.py"))
        gates = _iu.module_from_spec(spec)
        spec.loader.exec_module(gates)
        sys.exit(gates.box_gates(args.capture, args.arms, args.probe_steps))
    if not (args.config and args.out):
        ap.error("--config and --out are required (or --self-test / --box-gates)")
    m = run(args)
    print("PORT-DONE", json.dumps({"samples": len(m["samples"]), "unresolved": len(m["unresolved"]),
                                   "voxelStepsPerSecond": m.get("voxelStepsPerSecond")}))


if __name__ == "__main__":
    main()
