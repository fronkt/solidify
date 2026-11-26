"""Gates for quant3d-fp64-port.py (precision study; no acceptance).

  gate1 --capture DIR   faithfulness vs real WGSL output written by
                        quant3d-fp64-port-capture.mjs (float32 port vs GPU;
                        target max |d phi|, max |d T| <= 1e-5 at every stop).
                        Also: step-1 per-pass comparison, the phase and
                        transport passes fed with the GPU's own inputs, the
                        float64 port against the same GPU trajectory (the
                        precision gap the port exists to measure), and the
                        sample() metrology port on the GPU's own state.
  gate2                 float32 vs float64 port self-consistency on a small
                        grid (difference growth), float64 input-rounding
                        control, and the cubic symmetry of the corner seed.
  gate3                 NumPy voxel-steps/s at small sizes, both dtypes.
  gate4 --work DIR      reduced arm through the CLI with the protocol
                        schedule shape; files parsed by the replay's
                        local_tip, by the JavaScript localTip (node) and, with
                        ten or more checkpoints, by the replay CLI.

  python -I scripts/research/quant3d-fp64-port-selftest.py gate1 --capture DIR --out gate1.json
"""
import argparse
import glob
import importlib.util
import json
import math
import os
import subprocess
import sys
import time
import warnings

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


port_mod = load("quant3d_fp64_port", "quant3d-fp64-port.py")
TipPort = port_mod.TipPort
TARGET = 1e-5
BASE = {"name": "gate", "lambda": 4, "epsilon4": .0171, "undercooling": .45, "radius": 8, "dx": .8,
        "dt": 0.0180006338, "D": 2.5068, "d0": 0.220975, "physicalTimeScale": 1, "latticeKinetics": True}


def diff_stats(a, b):
    a64, b64 = np.asarray(a, np.float64), np.asarray(b, np.float64)
    d = np.abs(a64 - b64)
    out = {"maxAbs": float(d.max()), "rms": float(np.sqrt((d * d).mean())),
           "mismatches": int((np.asarray(a) != np.asarray(b)).sum()), "cells": int(d.size)}
    if np.asarray(a).dtype == np.float32 and np.asarray(b).dtype == np.float32:
        big = (np.abs(a64) >= 1e-30) & (np.abs(b64) >= 1e-30) & (np.sign(a64) == np.sign(b64))
        ia = np.abs(np.asarray(a)[big].view(np.int32).astype(np.int64))
        ib = np.abs(np.asarray(b)[big].view(np.int32).astype(np.int64))
        out["maxUlpWhereAbsAbove1e-30"] = int(np.abs(ia - ib).max()) if big.any() else 0
    return out


def denormals(x):
    x = np.asarray(x)
    return int(((x != 0) & (np.abs(x) < np.finfo(x.dtype).tiny)).sum())


def compare_samples(mine, gpu):
    """sample() port vs the GPU's sample() JSON on the SAME state."""
    pm, pg = mine["points"], gpu["points"]
    out = {"points": [len(pm), len(pg)],
           "sameCells": [(p["xCell"], p["yCell"], p["zCell"]) for p in pm] == [(p["xCell"], p["yCell"], p["zCell"]) for p in pg]}
    if out["sameCells"] and pm:
        out["phaseBracketsIdentical"] = all(a["phaseBracket"] == b["phaseBracket"] for a, b in zip(pm, pg))
        for key in ("x", "y", "z", "zCoarse", "zRaw"):
            out[f"max|d {key}|"] = max(abs(a[key] - b[key]) for a, b in zip(pm, pg))
    out["aheadBoundaryTemperatureIdentical"] = mine["aheadBoundaryTemperature"] == gpu["aheadBoundaryTemperature"]
    fm, fg = mine["farFieldDiagnostics"], gpu["farFieldDiagnostics"]
    out["patchesIdentical"] = fm["patches"] == fg["patches"]
    out["patchSourceIdentical"] = fm["patchSource"] == fg["patchSource"]
    out["|d patchTipW0|"] = abs(fm["patchTipW0"] - fg["patchTipW0"])
    out["|d patchRhoW0|"] = abs(fm["patchRhoW0"] - fg["patchRhoW0"])
    out["schemaKeysIdentical"] = (list(mine) == [k for k in gpu if k not in ("source", "config")]
                                  and list(fm) == list(fg) and list(mine["phaseBracketSource"]) == list(gpu["phaseBracketSource"]))
    return out


def tip_or_none(points, dx):
    try:
        t = port_mod.local_tip(points, dx)
        return {"tip": t["tip"], "rho": t["rho"], "tipError": t["tipError"], "rhoError": t["rhoError"]}
    except (ValueError, ZeroDivisionError) as e:
        return {"unresolved": str(e)}


def gate1(capture):
    meta = json.load(open(os.path.join(capture, "capture.json"), encoding="utf-8"))
    result = {"capture": {k: meta.get(k) for k in ("source", "dirty", "browser", "adapter", "served", "nativeEquivalence",
                                                   "deviceErrors", "seconds")},
              "target": TARGET, "fixtures": []}
    passed = True
    for fx in meta["fixtures"]:
        cfg, stops = fx["config"], fx.get("stopList") or meta["stops"]
        nx, ny, nz = cfg["dims"]
        d = os.path.join(capture, fx["name"])
        rd = lambda kind, s, ch: np.fromfile(os.path.join(d, f"{kind}-{s:09d}.f32"), "<f4").reshape(nz, ny, nx, ch)
        gs = lambda s: json.load(open(os.path.join(d, f"sample-{s:09d}.json"), encoding="utf-8"))
        row = {"name": fx["name"], "config": cfg, "stops": []}
        p32 = TipPort(cfg, "float32", keep_aux=True)
        p64 = TipPort(cfg, "float64")
        g0 = rd("state", 0, 2)
        row["initialState"] = {"phiMismatches": int((p32.phi != g0[..., 0]).sum()), "TMismatches": int((p32.T != g0[..., 1]).sum()),
                               "cells": int(g0[..., 0].size)}
        t0 = time.perf_counter()
        prev = 0
        for s in stops:
            g = rd("state", s, 2)
            if s > prev:
                p32.advance(s - prev); p64.advance(s - prev); prev = s
            entry = {"steps": s, "phi": diff_stats(p32.phi, g[..., 0]), "T": diff_stats(p32.T, g[..., 1]),
                     "float64PortVsGpu": {"phiMaxAbs": float(np.abs(p64.phi - g[..., 0]).max()),
                                          "TMaxAbs": float(np.abs(p64.T - g[..., 1]).max())},
                     "denormalPhiCells": {"port32": denormals(p32.phi), "gpu": denormals(g[..., 0])}}
            if s == 1:
                fl, ax = rd("flux", 1, 4), rd("aux", 1, 2)
                entry["passes"] = {name: diff_stats(mine, theirs) for name, mine, theirs in (
                    ("flux.Ax", p32.Ax, fl[..., 0]), ("flux.Ay", p32.Ay, fl[..., 1]), ("flux.Az", p32.Az, fl[..., 2]),
                    ("flux.w", p32.Aw, fl[..., 3]), ("aux.phiNew", p32.aux[..., 0], ax[..., 0]), ("aux.dPhi", p32.aux[..., 1], ax[..., 1]))}
                # Phase pass fed the GPU's own state and flux; transport fed the GPU's own aux.
                q = TipPort(cfg, "float32", init_state=g0, keep_aux=True)
                q.Ax[:], q.Ay[:], q.Az[:], q.Aw[:] = fl[..., 0], fl[..., 1], fl[..., 2], fl[..., 3]
                q._phase_transport_chunk(0, nz)
                St = q._slab_xy(q.T, -1, nz + 1)
                lapT = q._lap18(St)
                TN = lapT * q.coef_T; TN += g0[..., 1]; TN += ax[..., 1]
                TN = np.minimum(np.maximum(TN, np.float32(-1)), np.float32(2))
                entry["isolatedPasses"] = {"phasePassGivenGpuFlux.phiNew": diff_stats(q.aux[..., 0], ax[..., 0]),
                                           "transportPassGivenGpuAux.T": diff_stats(TN, g[..., 1])}
            # Metrology port on the GPU's own state, and each solver's own sample.
            gpu_sample = gs(s)
            same = TipPort(cfg, "float32", init_state=g)
            same.steps, same.time = gpu_sample["steps"], gpu_sample["time"]
            entry["samplePortOnGpuState"] = compare_samples(same.sample(), gpu_sample)
            entry["tip"] = {"gpu": tip_or_none(gpu_sample["points"], cfg["dx"]),
                            "port32": tip_or_none(p32.sample()["points"], cfg["dx"]),
                            "port64": tip_or_none(p64.sample()["points"], cfg["dx"])}
            row["stops"].append(entry)
            print(f"GATE1 {fx['name']:12s} step {s:6d} max|dphi| {entry['phi']['maxAbs']:.3e} max|dT| {entry['T']['maxAbs']:.3e}"
                  f" | f64 port vs GPU: dphi {entry['float64PortVsGpu']['phiMaxAbs']:.3e} dT {entry['float64PortVsGpu']['TMaxAbs']:.3e}",
                  flush=True)
        worst = max(max(e["phi"]["maxAbs"], e["T"]["maxAbs"]) for e in row["stops"])
        row["worstMaxAbs"] = worst
        row["passed"] = bool(worst <= TARGET and row["initialState"]["phiMismatches"] == 0)
        row["portSeconds"] = time.perf_counter() - t0
        passed &= row["passed"]
        result["fixtures"].append(row)
    result["passed"] = bool(passed)
    return result


def gate2():
    out = {"config": {**BASE, "dims": [32, 32, 32]}, "rows": []}
    cfg = out["config"]
    a = TipPort(cfg, "float32")
    b = TipPort(cfg, "float64")
    c = TipPort(cfg, "float64", inputs="exact")
    prev = 0
    for s in (0, 50, 100, 200, 400, 600, 800):
        if s > prev:
            for p in (a, b, c):
                p.advance(s - prev)
            prev = s
        a64 = a.phi.astype(np.float64)
        far = (a64 < 1e-3) & (b.phi < 1e-3)
        row = {"steps": s,
               "f32VsF64.phiMaxAbs": float(np.abs(a64 - b.phi).max()),
               "f32VsF64.TMaxAbs": float(np.abs(a.T.astype(np.float64) - b.T).max()),
               "f32VsF64.TMaxAbsFarField(phi<1e-3)": float(np.abs(a.T.astype(np.float64) - b.T)[far].max()) if far.any() else None,
               "f64GpuInputsVsExactInputs.phiMaxAbs": float(np.abs(b.phi - c.phi).max()),
               "f64GpuInputsVsExactInputs.TMaxAbs": float(np.abs(b.T - c.T).max())}
        for name, p in (("f32", a), ("f64", b)):
            phi = p.phi.astype(np.float64)
            row[f"{name}.cubicAsymmetry"] = max(float(np.abs(phi - phi.transpose(t)).max())
                                                for t in ((0, 2, 1), (1, 0, 2), (2, 1, 0), (1, 2, 0), (2, 0, 1)))
        out["rows"].append(row)
        print("GATE2", json.dumps(row), flush=True)
    return out


def gate3():
    unthrottled = port_mod.disable_power_throttling()
    out = {"windowsPowerThrottlingDisabled": unthrottled, "rows": [],
           "note": "single NumPy process; median of 3 timed windows after 2 warm-up steps"}
    for dims in ([48, 48, 48], [64, 64, 64], [96, 96, 96]):
        for dtype in ("float32", "float64"):
            p = TipPort({**BASE, "dims": dims}, dtype)
            p.advance(2)
            n = 10 if dims[0] < 96 else 4
            rates = []
            for _ in range(3):
                t = time.perf_counter(); p.advance(n); rates.append(np.prod(dims) * n / (time.perf_counter() - t))
            row = {"dims": dims, "dtype": dtype, "chunks": len(p.chunks), "voxelStepsPerSecond": float(np.median(rates)),
                   "range": [float(min(rates)), float(max(rates))], "bytesPerVoxelPersistent": port_mod.bytes_per_voxel(dtype)}
            out["rows"].append(row)
            print("GATE3", json.dumps(row), flush=True)
    return out


def gate4(work):
    os.makedirs(work, exist_ok=True)
    # Reduced arm: base physics (w40-anchor coefficients, seed radius 8, dx .8, dt),
    # 40x40 transverse cells (the full 40x40 metrology patch), shortened z and a
    # 0.06 time scale so the unchanged fixedTerminalSchedule gives 61 small checkpoints.
    arm = {"name": "w40-reduced", "lambda": 4, "epsilon4": 0.0171, "undercooling": 0.45, "radius": 8,
           "dims": [40, 40, 72], "dx": 0.8, "dt": 0.0180006338, "D": 2.5068, "d0": 0.220975,
           "physicalTimeScale": 0.06, "maximumTimeTau0": 1949.1356423198636 * 0.06,
           "samplePeriodTau0": 32.370331090315965 * 0.06, "latticeKinetics": True}
    cfg_path = os.path.join(work, "w40-reduced.json")
    with open(cfg_path, "w", encoding="utf-8") as fh:
        json.dump(arm, fh)
    out_dir = os.path.join(work, "run-f32")
    cmd = [sys.executable, "-I", os.path.join(HERE, "quant3d-fp64-port.py"), "--config", cfg_path, "--out", out_dir,
           "--dtype", "float32", "--dump-at", "0"]
    t = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    res = {"arm": arm, "command": " ".join(cmd[1:]), "exitCode": proc.returncode, "seconds": time.perf_counter() - t,
           "stdoutTail": proc.stdout.strip().splitlines()[-3:], "stderrTail": proc.stderr.strip().splitlines()[-5:]}
    files = sorted(glob.glob(os.path.join(out_dir, "samples", "*.json")))
    res["files"] = len(files)
    replay = load("q3c_replay", "quant3d-q3c-tip-replay.py")
    py_parsed, py_unresolved = [], []
    for f in files:
        dat = json.load(open(f, encoding="utf-8"))
        try:
            t_ = replay.local_tip(dat["points"], dat["config"]["dx"])
            py_parsed.append({"steps": dat["steps"], "tip": t_["tip"], "rho": t_["rho"]})
        except ValueError as e:
            py_unresolved.append({"steps": dat["steps"], "reason": str(e)})
    res["replayLocalTip"] = {"resolved": len(py_parsed), "unresolved": len(py_unresolved),
                             "first": py_parsed[:2], "last": py_parsed[-2:], "firstUnresolved": py_unresolved[:2]}
    js = ("import { readFileSync } from 'node:fs'; import { localTip } from '" +
          "file:///" + os.path.join(ROOT, "scripts", "fixtures", "quant3d-tip-analysis.mjs").replace("\\", "/") + "';"
          "const files = JSON.parse(process.argv[1]); let ok = 0, bad = 0, last = null;"
          "for (const f of files) { const d = JSON.parse(readFileSync(f, 'utf8'));"
          "try { const t = localTip(d.points, d.config.dx); ok++; last = { steps: d.steps, tip: t.tip, rho: t.rho }; } catch { bad++; } }"
          "console.log(JSON.stringify({ ok, bad, last }));")
    pj = subprocess.run(["node", "--input-type=module", "-e", js, json.dumps(files)], capture_output=True, text=True)
    res["jsLocalTip"] = json.loads(pj.stdout) if pj.returncode == 0 else {"error": pj.stderr[-400:]}
    if py_parsed and "last" in res["jsLocalTip"] and res["jsLocalTip"]["last"]:
        res["jsVsPythonLastRhoRelative"] = abs(res["jsLocalTip"]["last"]["rho"] / py_parsed[-1]["rho"] - 1)
    if len(files) >= 10:
        rp = subprocess.run([sys.executable, "-I", os.path.join(HERE, "quant3d-q3c-tip-replay.py"), "--campaign",
                             f"port={os.path.join(out_dir, 'samples')}", "--out", os.path.join(work, "replay.json")],
                            capture_output=True, text=True)
        res["replayCli"] = {"exitCode": rp.returncode, "stdout": rp.stdout.strip().splitlines()[-3:],
                            "stderrTail": rp.stderr.strip().splitlines()[-2:]}
    print("GATE4", json.dumps({k: res[k] for k in ("exitCode", "files", "replayLocalTip", "jsLocalTip")}), flush=True)
    return res


FUSED_FIXTURES = (("corner-24x28x36", {**BASE, "dims": [24, 28, 36]}, 512),
                  ("centred-17x9x12", {**BASE, "dims": [17, 9, 12], "radius": 3, "center": [6.0, 3.0, 4.4]}, 200),
                  ("degenerate-2x3x5", {**BASE, "dims": [2, 3, 5]}, 50),
                  ("w50-eq32", {**BASE, "lambda": 5, "dt": 0.017020371256848042, "radius": 5, "dims": [32, 32, 32],
                                "center": [12.8, 12.8, 12.8]}, 512))


def field_diff(a, b):
    a = [np.asarray(x) for x in a]
    b = [np.asarray(x) for x in b]
    return {"phiMaxAbs": float(np.abs(a[0].astype(np.float64) - b[0]).max()),
            "TMaxAbs": float(np.abs(a[1].astype(np.float64) - b[1]).max()),
            "valueMismatches": int((a[0] != b[0]).sum() + (a[1] != b[1]).sum()), "cells": int(2 * a[0].size)}


def fused_vs_array(backend, fixtures=FUSED_FIXTURES, dtypes=("float64", "float32")):
    """Fused kernels vs the validated NumPy array path from the same initial state."""
    rows = []
    for name, cfg, steps in fixtures:
        for dtype in dtypes:
            ref = TipPort(cfg, dtype)
            fused = TipPort(cfg, dtype, backend=backend)
            ref.advance(steps)
            fused.advance(steps)
            rows.append({"fixture": name, "dtype": dtype, "steps": steps, **field_diff(fused.fields_numpy(), ref.fields_numpy())})
    return rows


def fused_vs_capture(capture, backend):
    """Fused float32 vs the captured WGSL states, every stop of every fixture."""
    meta = json.load(open(os.path.join(capture, "capture.json"), encoding="utf-8"))
    rows = []
    for fx in meta["fixtures"]:
        cfg, stops = fx["config"], fx.get("stopList") or meta["stops"]
        nx, ny, nz = cfg["dims"]
        port = TipPort(cfg, "float32", backend=backend)
        prev, worst = 0, {"phi": 0.0, "T": 0.0}
        per_stop = []
        for s in stops:
            if s > prev:
                port.advance(s - prev); prev = s
            g = np.fromfile(os.path.join(capture, fx["name"], f"state-{s:09d}.f32"), "<f4").reshape(nz, ny, nx, 2)
            phi, T = port.fields_numpy()
            d = {"steps": s, "phi": float(np.abs(phi.astype(np.float64) - g[..., 0]).max()),
                 "T": float(np.abs(T.astype(np.float64) - g[..., 1]).max())}
            worst = {k: max(worst[k], d[k]) for k in worst}
            per_stop.append(d)
        rows.append({"fixture": fx["name"], "stops": per_stop, "worst": worst})
    return rows


def ptx_report(archs=("compute_89", "compute_90", "compute_80")):
    """NVRTC compile of the fused source (no GPU needed): build check, FMA count, f64 op census."""
    import collections
    import re
    out = {}
    for arch in archs:
        for dtype in ("float64", "float32"):
            ptx = port_mod.nvrtc_ptx(dtype, arch)
            entry = {}
            for kern in ("flux_kernel", "phase_kernel"):
                body = ptx.split(f".entry {kern}")[1].split(".entry")[0]
                ops = collections.Counter(re.findall(r"^\s+(?:@!?%p\d+\s+)?([a-z]+(?:\.[a-z0-9]+)*)", body, re.M))
                suffix = ".f64" if dtype == "float64" else ".f32"
                entry[kern] = {"fma": sum(v for k, v in ops.items() if k.startswith("fma")),
                               "arith": sum(v for k, v in ops.items() if k.endswith(suffix) and k.split(".")[0] in
                                            ("add", "sub", "mul", "setp", "neg", "max", "min")),
                               "div": sum(v for k, v in ops.items() if k.startswith("div") and k.endswith(suffix)),
                               "sqrt": sum(v for k, v in ops.items() if k.startswith("sqrt") and k.endswith(suffix)),
                               "loads": sum(v for k, v in ops.items() if k.startswith("ld.global") and k.endswith(suffix))}
            out[f"{arch}/{dtype}"] = entry
    return out


def gate_fused(capture):
    res = {"array": fused_vs_array("fused-cpu"), "capture": fused_vs_capture(capture, "fused-cpu"), "ptx": ptx_report()}
    ok_a = all(r["phiMaxAbs"] <= 1e-12 and r["TMaxAbs"] <= 1e-12 for r in res["array"] if r["dtype"] == "float64")
    ok_b = all(r["worst"]["phi"] <= TARGET and r["worst"]["T"] <= TARGET for r in res["capture"])
    ok_p = all(k["fma"] == 0 for e in res["ptx"].values() for k in e.values())
    for r in res["array"]:
        print("FUSED-A", json.dumps(r), flush=True)
    for r in res["capture"]:
        print("FUSED-B", r["fixture"], json.dumps(r["worst"]), flush=True)
    for k, v in res["ptx"].items():
        print("FUSED-PTX", k, json.dumps(v), flush=True)
    # Fused CPU speed for reference (single thread).
    for dtype in ("float32", "float64"):
        p = TipPort({**BASE, "dims": [64, 64, 64]}, dtype, backend="fused-cpu")
        p.advance(2)
        t = time.perf_counter(); p.advance(10)
        res.setdefault("cpuRate", {})[dtype] = 64 ** 3 * 10 / (time.perf_counter() - t)
    print("FUSED-CPU-RATE", json.dumps(res["cpuRate"]))
    res["passed"] = {"a_fp64_fused_vs_array_le_1e-12": ok_a, "b_fp32_fused_vs_wgsl_le_1e-5": ok_b, "ptx_no_fma": ok_p}
    print("FUSED", json.dumps(res["passed"]))
    return res


def box_gates(capture, arms_path, probe_steps=2000):
    """Run on the cloud GPU before any long job. Prints PASS/FAIL lines; returns the exit code."""
    port_mod.disable_power_throttling()
    oks = []

    def line(name, ok, detail):
        print(("PASS " if ok else "FAIL ") + name + " " + detail, flush=True)
        oks.append(bool(ok))

    try:
        import cupy
        props = cupy.cuda.runtime.getDeviceProperties(0)
        print("BOX", json.dumps({"gpu": props["name"].decode() if isinstance(props["name"], bytes) else props["name"],
                                 "cc": f"{props['major']}.{props['minor']}", "memoryGiB": props["totalGlobalMem"] / 2 ** 30,
                                 "cupy": cupy.__version__, "cudaRuntime": cupy.cuda.runtime.runtimeGetVersion(),
                                 "driver": cupy.cuda.runtime.driverGetVersion(), "numpy": np.__version__}), flush=True)
    except Exception as e:  # noqa: BLE001
        line("box: CuPy/CUDA available", False, repr(e))
        return 1
    # (a) fused GPU float64 vs the NumPy array path (the validated reference), same initial state.
    try:
        for r in fused_vs_array("fused", dtypes=("float64",)):
            line(f"a fused-fp64-vs-array {r['fixture']} {r['steps']} steps", r["phiMaxAbs"] <= 1e-12 and r["TMaxAbs"] <= 1e-12,
                 f"max|dphi| {r['phiMaxAbs']:.3e} max|dT| {r['TMaxAbs']:.3e} mismatches {r['valueMismatches']}/{r['cells']}")
        for r in fused_vs_array("fused", dtypes=("float32",)):
            line(f"a' fused-fp32-vs-array {r['fixture']} {r['steps']} steps", r["phiMaxAbs"] <= TARGET and r["TMaxAbs"] <= TARGET,
                 f"max|dphi| {r['phiMaxAbs']:.3e} max|dT| {r['TMaxAbs']:.3e} mismatches {r['valueMismatches']}/{r['cells']} "
                 "(bitwise expected)")
    except Exception as e:  # noqa: BLE001
        line("a fused-vs-array", False, repr(e))
    # (b) fused GPU float32 vs the captured WGSL states.
    try:
        if not os.path.exists(os.path.join(capture, "capture.json")):
            raise FileNotFoundError(f"{capture}/capture.json (copy verify-out/fp64-port/capture from the laptop)")
        for r in fused_vs_capture(capture, "fused"):
            line(f"b fused-fp32-vs-WGSL {r['fixture']} (stops {r['stops'][-1]['steps']})",
                 r["worst"]["phi"] <= TARGET and r["worst"]["T"] <= TARGET,
                 f"worst max|dphi| {r['worst']['phi']:.3e} max|dT| {r['worst']['T']:.3e}")
    except Exception as e:  # noqa: BLE001
        line("b fused-fp32-vs-WGSL", False, repr(e))
    # (c) throughput probe on the real arms.
    try:
        arms = json.load(open(arms_path, encoding="utf-8"))
        for arm in arms:
            nx, ny, nz = arm["dims"]
            plan = port_mod.fixed_terminal_schedule(arm["dt"], arm.get("physicalTimeScale", 1.0))
            phi0, T0 = port_mod.initial_fields(arm, arm["dims"], np.float32)
            init = np.stack([phi0, T0], axis=-1)
            del phi0, T0
            for dtype in ("float64", "float32"):
                port = TipPort(arm, dtype, backend="fused", init_state=init)
                port.advance(10)
                t = time.perf_counter()
                port.advance(probe_steps)
                secs = time.perf_counter() - t
                finite = bool(cupy.isfinite(port.phi).all()) and bool(cupy.isfinite(port.T).all())
                rate = nx * ny * nz * probe_steps / secs
                hours = nx * ny * nz * plan["terminalSteps"] / rate / 3600
                used = cupy.get_default_memory_pool().total_bytes() / 2 ** 30
                print("THROUGHPUT", json.dumps({"arm": arm["name"], "dtype": dtype, "steps": probe_steps, "seconds": secs,
                                                "voxelStepsPerSecond": rate, "terminalSteps": plan["terminalSteps"],
                                                "projectedFullArmHours": hours, "gpuPoolGiB": used}), flush=True)
                line(f"c probe {arm['name']} {dtype}", finite and not port.flags,
                     f"{rate:.3e} voxel-steps/s, projected {hours:.2f} h for {plan['terminalSteps']} steps")
                del port
                cupy.get_default_memory_pool().free_all_blocks()
    except Exception as e:  # noqa: BLE001
        line("c throughput probe", False, repr(e))
    print("BOX-GATES", "PASS" if all(oks) else "FAIL", f"{sum(oks)}/{len(oks)}", flush=True)
    return 0 if all(oks) else 1


def main():
    warnings.simplefilter("ignore", RuntimeWarning)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gate", choices=["gate1", "gate2", "gate3", "gate4", "fused", "box"])
    ap.add_argument("--capture")
    ap.add_argument("--work")
    ap.add_argument("--out")
    args = ap.parse_args()
    port_mod.disable_power_throttling()
    if args.gate == "gate1":
        res = gate1(args.capture)
    elif args.gate == "gate2":
        res = gate2()
    elif args.gate == "gate3":
        res = gate3()
    elif args.gate == "fused":
        res = gate_fused(args.capture)
    elif args.gate == "box":
        sys.exit(box_gates(args.capture or "verify-out/fp64-port/capture",
                           os.path.join(HERE, "quant3d-fp64-port-arms.json")))
    else:
        res = gate4(args.work)
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(res, fh, indent=1)
            fh.write("\n")
    if args.gate == "gate1":
        print("GATE1", "PASS" if res["passed"] else "FAIL", [(f["name"], f["worstMaxAbs"]) for f in res["fixtures"]])
        sys.exit(0 if res["passed"] else 1)
    if args.gate == "fused":
        sys.exit(0 if all(res["passed"].values()) else 1)


if __name__ == "__main__":
    main()
