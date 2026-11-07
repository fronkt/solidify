"""CPU-only replay of archived 3D tip checkpoints (Q3c hypothesis ranking).

Inputs are the raw per-checkpoint JSON files written by the five-arm needle
runner (`points` = surface heights of the psi=0.5 crossing in a 40x40 column
patch of the positive quadrant, with the dendrite axis on the x=y=0 corner).
No GPU, browser or phase evolution is involved.

The script answers, from existing data only:
  1. Reproduction: the unchanged local-tip estimator (a NumPy port of
     scripts/fixtures/quant3d-tip-analysis.mjs) recomputes each arm's
     terminal P and sigma*.
  2. Decomposition: sigma* = (V d0/D) / (2 P_Iv^2 (rho/rho_Iv)^2). The selected
     velocity (Karma-Lee-Plapp 2000 recommend it as the robust selection
     measure) is separated from the local tip distortion rho/rho_Iv.
  3. Stationarity: late-time trends of V, rho and sigma over all checkpoints.
  4. Morphology: the four-fold Fourier amplitude A1(z) of r^2(phi, z) in tip
     radius units (Karma-Rappel 1996 Eq. 8, Table I columns alpha and 1/A).
  5. Interface-width and mesh sensitivities between the existing arms, with
     post-hoc extrapolations that are DIAGNOSTIC ONLY (no acceptance verdict,
     no coefficient selection).

Usage:
  python -I scripts/research/quant3d-q3c-tip-replay.py --self-test
  python -I scripts/research/quant3d-q3c-tip-replay.py \
      --campaign default=<dir-with-arm-NNN.json> \
      --campaign candidate=<dir> --out <result.json>
"""
import argparse
import glob
import hashlib
import json
import math
import os
import sys

import numpy as np
from scipy.interpolate import RectBivariateSpline
from scipy.optimize import brentq
from scipy.special import exp1

# Karma and Rappel, PRL 77, 4050 (1996), arXiv:patt-sol/9607005v1, Table I,
# PDF page 3 (Delta = 0.45). Columns: P, sigma*, alpha, 1/A (phase field);
# P, sigma* (numerical solvability); P_Iv (linear solvability).
KR96 = {
    0.0123: {"P": 0.360, "sigma": 0.036, "alpha": 1.73, "invA": 11.3, "solvP": 0.367, "solvSigma": 0.0329},
    0.0171: {"P": 0.312, "sigma": 0.063, "alpha": 1.68, "invA": 10.1, "solvP": 0.324, "solvSigma": 0.0578},
    0.0265: {"P": 0.236, "sigma": 0.16, "alpha": 1.62, "invA": 7.8, "solvP": 0.247, "solvSigma": 0.142},
}
KR96_PIV = 0.471
UNDERCOOLING = 0.45
ARMS = ("base", "domain", "dx", "dt", "width")
# Declared before any morphology value was computed: depths (in local tip
# radii) at which A1 is evaluated and the log-log fit range.
MORPH_DEPTHS = [0.5 + 0.25 * k for k in range(9)]  # 0.5 ... 2.5
MORPH_FIT = (0.75, 2.5)
# Apex profile (added after the first morphology pass, before reading it):
# axisymmetric secant radius A0(s)/(2s) in local-tip-radius units. A pure
# paraboloid gives 1 at every depth; Karma-Lee-Plapp (2000) describe a
# localized tip distortion that makes the far paraboloid radius exceed rho.
APEX_DEPTHS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4]
PHI_COUNT = 91  # uniform samples on [0, pi/2], endpoints included


def ivantsov_peclet(delta):
    """Solve Delta = P exp(P) E1(P) for the 3D paraboloid of revolution."""
    f = lambda p: p * math.exp(p) * exp1(p) - delta
    return brentq(f, 1e-6, 50.0, xtol=1e-15, rtol=1e-15, maxiter=200)


def line_fit(xs, ys):
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    n = len(xs)
    if n < 3:
        raise ValueError("line fit needs at least three points")
    xm, ym = xs.mean(), ys.mean()
    xx = ((xs - xm) ** 2).sum()
    slope = ((xs - xm) * (ys - ym)).sum() / xx
    intercept = ym - slope * xm
    var = ((ys - intercept - slope * xs) ** 2).sum() / (n - 2)
    return {"slope": slope, "intercept": intercept,
            "slopeError": math.sqrt(var / xx),
            "interceptError": math.sqrt(var * (1 / n + xm * xm / xx))}


def surface_fit(P, radius):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    m = x * x + y * y <= radius * radius
    if m.sum() < 12:
        return None
    x, y, z = x[m], y[m], z[m]
    x2, y2 = (x / radius) ** 2, (y / radius) ** 2
    F = np.stack([np.ones_like(x2), x2, y2, x2 * x2, x2 * y2, y2 * y2], axis=1)
    z0 = z.max()
    # Normal equations, as in the JavaScript estimator.
    c = np.linalg.solve(F.T @ F, F.T @ (z - z0))
    bx, by = c[1] / radius ** 2, c[2] / radius ** 2
    if not (bx < 0 and by < 0):
        return None
    return {"radius": radius, "points": int(m.sum()), "tip": z0 + c[0], "bx": bx, "by": by,
            "rho": -1 / (bx + by)}


def local_tip_base(P, dx):
    initial = surface_fit(P, 8 * dx)
    if initial is None:
        raise ValueError("local tip is unresolved or no longer convex")
    windows = [w for w in (surface_fit(P, initial["rho"] * f) for f in (.25, .35, .45, .5)) if w]
    if len(windows) < 3 or len({w["points"] for w in windows}) < 3:
        raise ValueError("fewer than three resolved local curvature windows")
    r4 = [w["radius"] ** 4 for w in windows]
    fx = line_fit(r4, [w["bx"] for w in windows])
    fy = line_fit(r4, [w["by"] for w in windows])
    fz = line_fit(r4, [w["tip"] for w in windows])
    rho = -1 / (fx["intercept"] + fy["intercept"])
    rho_err = max(max(abs(w["rho"] - rho) for w in windows),
                  2 * (fx["interceptError"] + fy["interceptError"]) * rho * rho)
    tip_err = max(max(abs(w["tip"] - fz["intercept"]) for w in windows), 2 * fz["interceptError"])
    return {"tip": fz["intercept"], "tipError": tip_err, "rho": rho, "rhoError": rho_err,
            "rhoX": -1 / (2 * fx["intercept"]), "rhoY": -1 / (2 * fy["intercept"])}


def local_tip(points, dx):
    P = np.array([[p["x"], p["y"], p["z"]] for p in points], float)
    fine = local_tip_base(P, dx)
    if all(math.isfinite(p.get("zCoarse", float("nan"))) for p in points):
        Pc = np.array([[p["x"], p["y"], p["zCoarse"]] for p in points], float)
        coarse = local_tip_base(Pc, dx)
        fine["rhoError"] = max(fine["rhoError"], abs(fine["rho"] - coarse["rho"]))
        fine["tipError"] = max(fine["tipError"], abs(fine["tip"] - coarse["tip"]))
    return fine


def operating_state(samples, D, d0):
    last = samples[-10:]
    windows = []
    for i in range(3):
        data = last[i * 3:i * 3 + 4]
        v = line_fit([s["time"] for s in data], [s["tip"] for s in data])
        windows.append({"velocity": v["slope"], "rho": sum(s["rho"] for s in data) / 4,
                        "centerTime": sum(s["time"] for s in data) / 4})
    V = sum(w["velocity"] for w in windows) / 3
    rho = sum(w["rho"] for w in windows) / 3
    return {"velocity": V, "rho": rho, "P": rho * V / (2 * D), "sigma": 2 * D * d0 / (rho * rho * V),
            "windowVelocities": [w["velocity"] for w in windows],
            "windowRhos": [w["rho"] for w in windows],
            "terminalTime": last[-1]["time"], "terminalSteps": last[-1]["steps"]}


def morphology(points, dx, tip, rho):
    """Four-fold Fourier modes of r^2(phi, z) in units of the local tip radius."""
    xi = sorted({p["xCell"] for p in points})
    yi = sorted({p["yCell"] for p in points})
    nx, ny = len(xi), len(yi)
    Z = np.full((nx, ny), np.nan)
    for p in points:
        Z[p["xCell"] - xi[0], p["yCell"] - yi[0]] = p["z"]
    if np.isnan(Z).any() or xi[0] != 0 or yi[0] != 0:
        raise ValueError("incomplete or offset surface patch")
    xs = (np.arange(nx) + .5) * dx
    ys = (np.arange(ny) + .5) * dx
    # Even reflection through the x=0 and y=0 symmetry planes of the quadrant.
    xp = np.concatenate([-xs[::-1], xs])
    yp = np.concatenate([-ys[::-1], ys])
    Zp = np.block([[Z[::-1, ::-1], Z[::-1, :]], [Z[:, ::-1], Z]])
    spline = RectBivariateSpline(xp, yp, Zp, kx=3, ky=3, s=0)
    rmax = min(xs[-1], ys[-1])
    phis = np.linspace(0, math.pi / 2, PHI_COUNT)
    w = np.full(PHI_COUNT, 1.0)
    w[0] = w[-1] = .5
    w /= w.sum()
    out = []
    for depth in APEX_DEPTHS + MORPH_DEPTHS:
        target = tip - depth * rho
        r2 = []
        for phi in phis:
            c, s = math.cos(phi), math.sin(phi)
            f = lambda r: float(spline(r * c, r * s, grid=False)) - target
            if not (f(0.0) > 0 and f(rmax) < 0):
                r2 = None
                break
            r2.append((brentq(f, 0.0, rmax, xtol=1e-12) / rho) ** 2)
        if r2 is None:
            out.append({"depth": depth, "covered": False})
            continue
        r2 = np.array(r2)
        A0 = float((w * r2).sum())
        A1 = float(2 * (w * r2 * np.cos(4 * phis)).sum())
        A2 = float(2 * (w * r2 * np.cos(8 * phis)).sum())
        out.append({"depth": depth, "covered": True, "A0": A0, "A1": A1, "A2": A2})
    return out


def power_fit(rows):
    use = [r for r in rows if r["covered"] and MORPH_FIT[0] - 1e-12 <= r["depth"] <= MORPH_FIT[1] + 1e-12 and r["A1"] > 0]
    if len(use) < 3:
        return None
    f = line_fit([math.log(r["depth"]) for r in use], [math.log(r["A1"]) for r in use])
    return {"alpha": f["slope"], "A": math.exp(f["intercept"]), "invA": math.exp(-f["intercept"]),
            "points": len(use)}


def load_campaign(directory):
    """Group `<arm>-<9-digit step>.json` files by arm name (registered five-arm
    names first, then any other names such as the width-ladder arms)."""
    names = set()
    for f in glob.glob(os.path.join(directory, "*-*.json")):
        stem = os.path.basename(f)[:-5]
        arm, _, steps = stem.rpartition("-")
        if len(steps) == 9 and steps.isdigit() and not arm.endswith("-initial") and not arm.startswith("throughput"):
            names.add(arm)
    arms = {}
    for arm in list(ARMS) + sorted(names - set(ARMS)):
        files = sorted(f for f in glob.glob(os.path.join(directory, f"{arm}-*.json"))
                       if os.path.basename(f)[len(arm) + 1:-5].isdigit())
        if files:
            arms[arm] = files
    return arms


def analyse_arm(files, piv):
    samples, config, morph_rows, hashes = [], None, [], []
    for i, f in enumerate(files):
        raw = open(f, "rb").read()
        hashes.append({"file": os.path.basename(f), "sha256": hashlib.sha256(raw).hexdigest()})
        d = json.loads(raw)
        config = config or d["config"]
        if d["config"] != config:
            raise ValueError("configuration changed within an arm")
        dt = config["dt"]
        canonical = d["steps"] * dt
        t = local_tip(d["points"], config["dx"])
        s = {"time": canonical, "reportedTime": d["time"], "steps": d["steps"], **t}
        samples.append(s)
        if i >= len(files) - 10:
            s["morphology"] = morphology(d["points"], config["dx"], t["tip"], t["rho"])
    D, d0 = config["D"], config["d0"]
    state = operating_state(samples, D, d0)
    V, rho = state["velocity"], state["rho"]
    rho_iv = 2 * D * piv / V
    lam = config["lambda"]
    a1 = 0.8839
    derived = {
        "Vd0OverD": V * d0 / D,
        "rhoOverD0": rho / d0,
        "rhoOverRhoIv": rho / rho_iv,
        "sigmaVelocity": (V * d0 / D) / (2 * piv * piv),  # KLP sigma_p with rho_p = rho_Iv
        "W0OverD0": 1 / d0,
        "W0OverRho": 1 / rho,
        "W0VOverD": V / D,
        "lambda": lam,
        "dxOverW0": config["dx"],
    }
    # Instantaneous series from consecutive checkpoints (central differences).
    series = []
    for k in range(1, len(samples) - 1):
        a, b = samples[k - 1], samples[k + 1]
        v = (b["tip"] - a["tip"]) / (b["time"] - a["time"])
        r = samples[k]["rho"]
        series.append({"time": samples[k]["time"], "velocity": v, "rho": r,
                       "sigma": 2 * D * d0 / (r * r * v), "P": r * v / (2 * D),
                       "rhoOverRhoIv": r * v / (2 * D * piv)})
    # Late-time trends: last 20 instantaneous points, slope per diffusion time D/V^2.
    late = series[-20:]
    tD = D / V ** 2
    trends = {}
    for key in ("velocity", "rho", "sigma", "rhoOverRhoIv"):
        f = line_fit([p["time"] for p in late], [p[key] for p in late])
        mean = sum(p[key] for p in late) / len(late)
        trends[key] = {"relativeChangePerDiffusionTime": f["slope"] * tD / mean,
                       "relativeChangeError": f["slopeError"] * tD / mean,
                       "spanDiffusionTimes": (late[-1]["time"] - late[0]["time"]) / tD}
    # Morphology over the terminal ten checkpoints.
    term = [s for s in samples[-10:] if "morphology" in s]
    per_depth = {}
    for s in term:
        for r in s["morphology"]:
            if r["covered"]:
                per_depth.setdefault(r["depth"], []).append(r)
    morph = []
    for depth in APEX_DEPTHS + MORPH_DEPTHS:
        rows = per_depth.get(depth, [])
        if not rows:
            morph.append({"depth": depth, "covered": False})
            continue
        A1 = np.array([r["A1"] for r in rows])
        A0 = np.array([r["A0"] for r in rows])
        A2 = np.array([r["A2"] for r in rows])
        morph.append({"depth": depth, "covered": True, "samples": len(rows),
                      "A0": float(A0.mean()), "A1": float(A1.mean()), "A1Spread": float(A1.max() - A1.min()),
                      "A2": float(A2.mean()), "secantRadius": float(A0.mean() / (2 * depth)),
                      "depthInW0": depth * rho, "depthInCells": depth * rho / config["dx"]})
    fits = [power_fit(s["morphology"]) for s in term]
    fits = [f for f in fits if f]
    return {
        "config": config,
        "sampleCount": len(samples),
        "hashes": hashes,
        "terminal": state,
        "derived": derived,
        "trends": trends,
        "morphology": {"depthsInRho": MORPH_DEPTHS, "fitRange": MORPH_FIT, "terminal": morph,
                       "powerFitMean": {k: float(np.mean([f[k] for f in fits])) for k in ("alpha", "A", "invA")} if fits else None,
                       "powerFitSpread": {k: float(np.ptp([f[k] for f in fits])) for k in ("alpha", "invA")} if fits else None},
        "series": series,
        "samples": [{k: v for k, v in s.items() if k != "morphology"} for s in samples],
    }


def sensitivities(arms):
    out = {}
    base = arms.get("base")
    if not base:
        return out
    b = base["derived"]
    keys = ("Vd0OverD", "rhoOverRhoIv", "rhoOverD0")
    for name in ("width", "dx", "dt", "domain"):
        a = arms.get(name)
        if not a:
            continue
        d = a["derived"]
        row = {k: d[k] / b[k] - 1 for k in keys}
        row["sigma"] = a["terminal"]["sigma"] / base["terminal"]["sigma"] - 1
        row["P"] = a["terminal"]["P"] / base["terminal"]["P"] - 1
        out[name] = row
    # Post-hoc extrapolations, DIAGNOSTIC ONLY. Two equally simple model forms
    # are reported side by side because two points cannot select between them.
    if "width" in arms:
        wb, ww = b["W0OverD0"], arms["width"]["derived"]["W0OverD0"]
        ext = {}
        for form, g in (("linear-in-W", lambda w: w), ("quadratic-in-W", lambda w: w * w)):
            row = {}
            for key, vb, vw in (("Vd0OverD", b["Vd0OverD"], arms["width"]["derived"]["Vd0OverD"]),
                                ("rhoOverRhoIv", b["rhoOverRhoIv"], arms["width"]["derived"]["rhoOverRhoIv"]),
                                ("sigma", base["terminal"]["sigma"], arms["width"]["terminal"]["sigma"])):
                slope = (math.log(vw) - math.log(vb)) / (g(ww) - g(wb))
                row[key] = math.exp(math.log(vb) - slope * g(wb))
            ext[form] = row
        out["widthExtrapolationDiagnosticOnly"] = ext
    if "width" in arms and "dx" in arms:
        # Additive log model ln s = ln s_inf + a (W/d0)^2 + b h^2, three arms.
        wb, ww = b["W0OverD0"], arms["width"]["derived"]["W0OverD0"]
        hb, hd = b["dxOverW0"], arms["dx"]["derived"]["dxOverW0"]
        row = {}
        for key, getter in (("sigma", lambda A: A["terminal"]["sigma"]),
                            ("Vd0OverD", lambda A: A["derived"]["Vd0OverD"]),
                            ("rhoOverRhoIv", lambda A: A["derived"]["rhoOverRhoIv"])):
            lb = math.log(getter(base))
            a = (math.log(getter(arms["width"])) - lb) / (ww * ww - wb * wb)
            bb = (math.log(getter(arms["dx"])) - lb) / (hd * hd - hb * hb)
            row[key] = {"value": math.exp(lb - a * wb * wb - bb * hb * hb), "a": a, "b": bb}
        out["widthAndMeshExtrapolationDiagnosticOnly"] = row
    return out


def self_test():
    checks = []
    piv = ivantsov_peclet(UNDERCOOLING)
    checks.append(("Ivantsov P(0.45) rounds to KR96 0.471", round(piv, 3) == 0.471, piv))
    # Known paraboloid with a prescribed cos(4 phi) mode:
    # z = -r^2/(2 rho) + c r^4 cos(4 phi)/rho^3 on the runner's cell-centre grid.
    dx, rho, c = 0.8, 12.0, 0.004
    pts = []
    for i in range(40):
        for j in range(40):
            x, y = (i + .5) * dx, (j + .5) * dx
            r2, phi = x * x + y * y, math.atan2(y, x)
            z = 150 - r2 / (2 * rho) + c * r2 * r2 * math.cos(4 * phi) / rho ** 3
            pts.append({"x": x, "y": y, "xCell": i, "yCell": j, "z": z})
    t = local_tip(pts, dx)
    checks.append(("local tip radius of a paraboloid", abs(t["rho"] / rho - 1) < 2e-3, t["rho"]))
    m = morphology(pts, dx, t["tip"], t["rho"])
    # For this surface r^2 = 2|z| + 8 c |z|^2 cos 4phi + O(c^2): A1(z) = 8 c z^2.
    r = [row for row in m if row["covered"] and abs(row["depth"] - 2.0) < 1e-12][0]
    expect = 8 * c * 4.0
    checks.append(("A1(-2) of a known cos4phi paraboloid within 2%", abs(r["A1"] / expect - 1) < 0.02, (r["A1"], expect)))
    checks.append(("A0(-2) of a paraboloid within 1%", abs(r["A0"] / 4.0 - 1) < 0.01, r["A0"]))
    pf = power_fit(m)
    checks.append(("power-law exponent of the known surface near 2", abs(pf["alpha"] - 2) < 0.05, pf["alpha"]))
    # Axisymmetric control: no four-fold mode.
    pts0 = [{**p, "z": 150 - (p["x"] ** 2 + p["y"] ** 2) / (2 * rho)} for p in pts]
    m0 = morphology(pts0, dx, 150.0, rho)
    checks.append(("axisymmetric control has |A1| < 1e-4", max(abs(r["A1"]) for r in m0 if r["covered"]) < 1e-4,
                   max(abs(r["A1"]) for r in m0 if r["covered"])))
    ok = all(c[1] for c in checks)
    for name, passed, value in checks:
        print(("PASS " if passed else "FAIL ") + name + f": {value}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--campaign", action="append", default=[])
    ap.add_argument("--out")
    ap.add_argument("--summary", help="also write a compact summary without per-sample series")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(0 if self_test() else 1)
    piv = ivantsov_peclet(UNDERCOOLING)
    result = {"purpose": "Q3c CPU replay of archived tip checkpoints; diagnostic only, no acceptance",
              "ivantsovPeclet": piv, "kr96": {str(k): v for k, v in KR96.items()},
              "kr96Source": "Karma and Rappel, PRL 77, 4050 (1996), arXiv:patt-sol/9607005v1, Table I, PDF p.3",
              "campaigns": {}}
    for spec in args.campaign:
        name, directory = spec.split("=", 1)
        files = load_campaign(directory)
        arms = {arm: analyse_arm(f, piv) for arm, f in files.items()}
        result["campaigns"][name] = {"directory": directory, "arms": arms, "sensitivities": sensitivities(arms)}
        for arm, a in arms.items():
            s, d = a["terminal"], a["derived"]
            print(f"{name:9s} {arm:6s} n={a['sampleCount']:2d} t={s['terminalTime']:8.2f} P={s['P']:.6f} "
                  f"sigma={s['sigma']:.6f} Vd0/D={d['Vd0OverD']:.6f} rho/rhoIv={d['rhoOverRhoIv']:.4f} "
                  f"sig_p={d['sigmaVelocity']:.5f} invA={a['morphology']['powerFitMean']['invA'] if a['morphology']['powerFitMean'] else float('nan'):.2f} "
                  f"alpha={a['morphology']['powerFitMean']['alpha'] if a['morphology']['powerFitMean'] else float('nan'):.3f}")
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(result, fh, indent=1)
            fh.write("\n")
    if args.summary:
        compact = json.loads(json.dumps(result))
        for campaign in compact["campaigns"].values():
            campaign["directory"] = os.path.basename(os.path.normpath(campaign["directory"]))
            for arm in campaign["arms"].values():
                arm.pop("series", None)
                arm.pop("samples", None)
                arm["hashes"] = arm["hashes"][-10:]  # the retained terminal checkpoints
                arm["morphology"]["terminal"] = [
                    {k: (round(v, 6) if isinstance(v, float) else v) for k, v in row.items()}
                    for row in arm["morphology"]["terminal"]]
        with open(args.summary, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(compact, fh, indent=1, sort_keys=True)
            fh.write("\n")


if __name__ == "__main__":
    main()
