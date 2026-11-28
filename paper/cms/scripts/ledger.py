"""Numbers ledger for the CMS paper.

Every number quoted in paper/cms/manuscript.md comes from paper/cms/data/ledger.json, which this
script builds from the committed result files in docs/validation/. Run from the repository root:

    python -I paper/cms/scripts/ledger.py

It recomputes the acceptance budget (1+|e|)(1+u)(1+d)-1 for every arm against both KR96 rows and
asserts that it equals the budget the run harness recorded, where the harness recorded one.
"""
import json
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
VAL = os.path.join(ROOT, "docs", "validation")
OUT = os.path.join(ROOT, "paper", "cms", "data", "ledger.json")

# Karma & Rappel, PRL 77, 4050 (1996), Table I, Delta = 0.45: eps4 -> (PF P, PF sigma*, solv P, solv sigma*)
KR96 = {
    0.0123: (0.360, 0.036, 0.367, 0.0329),
    0.0171: (0.312, 0.063, 0.324, 0.0578),
    0.0265: (0.236, 0.16, 0.247, 0.142),
}
LIMIT = 0.10

# (session tag, file, GPU) in chronological order
RUNS = [
    ("lattice-5arm", "quant3d-lattice-five-arm-2026-10-30.json", "NVIDIA RTX 5090"),
    ("q3c-W1", "quant3d-q3c-width-ladder-2026-11-07.json", "Intel Arc 140V"),
    ("q3c-A", "quant3d-q3c-narrow-ladder-2026-11-24.json", "NVIDIA L40S"),
    ("q3c-B", "quant3d-q3c-optb-lam28-2026-11-24.json", "NVIDIA L40S"),
    ("q3d-s1", "quant3d-q3d-rows-2026-11-26.json", "NVIDIA L40S"),
    ("q3d-s2", "quant3d-q3d-rows-s2-2026-11-26.json", "NVIDIA L40S"),
    ("q3d-s3", "quant3d-q3d-rows-s3-2026-11-27.json", "NVIDIA L40S"),
]


def load(name):
    with open(os.path.join(VAL, name), encoding="utf-8") as f:
        return json.load(f)


def nearest_row(eps):
    return min(KR96, key=lambda r: abs(math.log(eps / r)))


def arm_record(tag, gpu, a):
    c = a["config"]
    if "terminal" in a:
        t = a["terminal"]
        st, wall, steps = t.get("state") or {}, t.get("wallMinutes"), None
    else:  # five-arm 2026-10-30 layout
        st, wall, steps = a.get("state") or {}, None, None
    if not st.get("ready", True) or "sigmaStar" not in st:
        return {"session": tag, "name": c["name"], "ready": False}
    row = c.get("row") or nearest_row(c["epsilon4"])
    dims = c.get("dims")
    r = {
        "session": tag, "gpu": gpu, "name": c["name"], "row": row, "epsRaw": c["epsilon4"],
        "lambda": c["lambda"], "dx": c["dx"], "dt": c["dt"], "dims": dims,
        "voxels": dims[0] * dims[1] * dims[2] if dims else None,
        "seedRadius": c.get("radius"), "wallMinutes": wall,
        "P": st["P"], "sigmaStar": st["sigmaStar"], "Vd0OverD": st["Vd0OverD"], "rhoOverD0": st["rhoOverD0"],
        "rhoW0": st.get("rho"), "velocityW0Tau0": st.get("velocity"),
        "uP": (st.get("uncertainty") or {}).get("P"), "uS": (st.get("uncertainty") or {}).get("sigmaStar"),
        "dP": (st.get("drift") or {}).get("P"), "dS": (st.get("drift") or {}).get("sigmaStar"),
        "aheadLD": st.get("aheadDiffusionLengths"), "sideLD": st.get("sideDiffusionLengths"),
    }
    if r["rhoW0"]:
        r["rhoCells"] = r["rhoW0"] / c["dx"]
        r["W0OverRho"] = 1 / r["rhoW0"]
    samples = a.get("samples") or []
    if samples and samples[-1].get("steps"):
        r["steps"] = samples[-1]["steps"]
    elif (a.get("terminalObservation") or {}).get("terminalSteps"):
        r["steps"] = a["terminalObservation"]["terminalSteps"]
    bpv = (a.get("setup") or {}).get("bytesPerVoxel")
    r["bytesPerVoxel"] = bpv
    if r.get("voxels") and bpv:
        r["textureGiB"] = r["voxels"] * bpv / 2 ** 30
    if r.get("steps") and wall and r.get("voxels"):
        r["voxelStepsPerSecond"] = r["voxels"] * r["steps"] / (wall * 60)
    ti = st.get("thinInterface") or {}
    r["W0VOverD"] = ti.get("W0OverDiffusionLength")
    b = a.get("boundary") or {}
    r["travelLD"] = b.get("travelDiffusionLengths") or b.get("conservativeTravelDiffusionLengths")
    pfP, pfS, svP, svS = KR96[row]
    if r["uP"] is None:
        # 2026-10-30 layout records only the PF budget; recover the combined (1+u)(1+d) factor from it
        rb, re_ = a["referenceErrorBudget"], a["relativeError"]
        factor = {q: (1 + rb[q]) / (1 + abs(re_[q])) for q in ("P", "sigmaStar")}
        assert abs(abs(r["P"] / pfP - 1) - abs(re_["P"])) < 1e-12
        r["combinedUncertaintyDrift"] = {q: factor[q] - 1 for q in factor}
    else:
        factor = {"P": (1 + r["uP"]) * (1 + r["dP"]), "sigmaStar": (1 + r["uS"]) * (1 + r["dS"])}
    for lab, rp, rs in (("PF", pfP, pfS), ("Solv", svP, svS)):
        eP, eS = r["P"] / rp - 1, r["sigmaStar"] / rs - 1
        bP = (1 + abs(eP)) * factor["P"] - 1
        bS = (1 + abs(eS)) * factor["sigmaStar"] - 1
        r[f"err{lab}"] = {"P": eP, "sigmaStar": eS}
        r[f"budget{lab}"] = {"P": bP, "sigmaStar": bS}
        r[f"accepted{lab}"] = bP <= LIMIT and bS <= LIMIT
    # agree with the harness's own assessment wherever it recorded one
    for lab, key in (("PF", "assessmentPF"), ("Solv", "assessmentSolv")):
        h = a.get(key)
        if h and abs(c["epsilon4"] - row) / row < 0.05:
            for q in ("P", "sigmaStar"):
                assert abs(h["referenceErrorBudget"][q] - r[f"budget{lab}"][q]) < 1e-12, (tag, c["name"], lab, q)
    return r


arms = []
for tag, fname, gpu in RUNS:
    j = load(fname)
    for a in j["arms"]:
        arms.append(arm_record(tag, gpu, a))
A = {(r["session"], r["name"]): r for r in arms if r.get("ready", True)}


def rel(a, b, q):
    return a[q] / b[q] - 1


QS = ("P", "sigmaStar", "Vd0OverD", "rhoOverD0")

# ---- pairwise controls ----
w28 = A[("q3c-A", "w28")]
controls28 = {n: {q: rel(A[("q3c-B", n)], w28, q) for q in QS} for n in ("domain", "dt", "width", "dx")}
base40 = A[("lattice-5arm", "base")]
controls40 = {n: {q: rel(A[("lattice-5arm", n)], base40, q) for q in QS} for n in ("domain", "dt", "width", "dx")}
e265 = A[("q3d-s1", "e265base")]
controls265 = {n: {q: rel(A[("q3d-s1", n)], e265, q) for q in QS} for n in ("e265width", "e265dx")}
controls265["e265cal06_vs_e265cal"] = {q: rel(A[("q3d-s3", "e265cal06")], A[("q3d-s2", "e265cal")], q) for q in QS}

# ---- width ladder at raw eps4 0.0171, dx 0.8 (one point per lambda; prefer the newest hardware) ----
ladder_src = [("q3c-W1", "w50"), ("q3c-W1", "w44"), ("q3c-A", "w40-anchor"), ("lattice-5arm", "width"),
              ("q3c-A", "w32"), ("q3c-A", "w28"), ("q3c-B", "width")]
ladder = sorted(({"lambda": A[k]["lambda"], "session": k[0], "name": k[1],
                  **{q: A[k][q] for q in QS}, "uS": A[k]["uS"], "W0OverRho": A[k].get("W0OverRho")}
                 for k in ladder_src), key=lambda x: x["lambda"])


def lsq(xs, ys, powers):
    # least squares y = sum c_k x^p_k, solved by normal equations (small, well-conditioned here)
    n = len(powers)
    M = [[sum(x ** (pi + pj) for x in xs) for pj in powers] for pi in powers]
    v = [sum(y * x ** pi for x, y in zip(xs, ys)) for pi in powers]
    for i in range(n):  # Gaussian elimination
        piv = M[i][i]
        for j in range(i + 1, n):
            f = M[j][i] / piv
            M[j] = [a - f * b for a, b in zip(M[j], M[i])]
            v[j] -= f * v[i]
    c = [0.0] * n
    for i in reversed(range(n)):
        c[i] = (v[i] - sum(M[i][j] * c[j] for j in range(i + 1, n))) / M[i][i]
    fit = [sum(ck * x ** p for ck, p in zip(c, powers)) for x in xs]
    rms = math.sqrt(sum((f / y - 1) ** 2 for f, y in zip(fit, ys)) / len(ys))
    return c, rms


fits = {}
xs = [p["lambda"] for p in ladder]
for q in ("sigmaStar", "P", "Vd0OverD"):
    ys = [p[q] for p in ladder]
    fits[q] = {}
    for lab, powers in (("linear", (0, 1)), ("quadratic", (0, 2)), ("full", (0, 1, 2))):
        c, rms = lsq(xs, ys, powers)
        fits[q][lab] = {"coefficients": c, "powers": list(powers), "relRms": rms,
                        "intercept": c[0], "interceptVsNarrowest": c[0] / ys[0] - 1}

# ---- precision (CPU replays of the same checkpoints format) ----
def replay_terminal(fname, campaign, arm):
    x = load(fname)["campaigns"][campaign]["arms"][arm]
    t, d = x["terminal"], x["derived"]
    return {"V": t["velocity"], "rho": t["rho"], "P": t["P"], "sigmaStar": t["sigma"], "Vd0OverD": d["Vd0OverD"],
            "steps": t["terminalSteps"]}


precision = {}
for arm, (camp64, camp32) in {"w40-anchor": ("anchor", "fp32port"), "w28": ("w28", "fp32port28")}.items():
    web = replay_terminal("quant3d-q3c-narrow-ladder-replay-2026-11-24.json", "ladder", arm)
    f64 = replay_terminal("quant3d-q3d-fp64-replay-s2-2026-11-26.json", camp64, arm)
    f32 = replay_terminal("quant3d-q3d-fp32port-replay-s2-2026-11-26.json", camp32, arm)
    assert web["steps"] == f64["steps"] == f32["steps"]
    precision[arm] = {
        "steps": web["steps"], "webgpu": web, "fp32port": f32, "fp64port": f64,
        "fp64_vs_fp32": {q: f64[q] / f32[q] - 1 for q in ("V", "rho", "P", "sigmaStar")},
        "fp64_vs_webgpu": {q: f64[q] / web[q] - 1 for q in ("V", "rho", "P", "sigmaStar")},
        "fp32port_vs_webgpu": {q: f32[q] / web[q] - 1 for q in ("V", "rho", "P", "sigmaStar")},
    }
arc = replay_terminal("quant3d-q3c-width-ladder-replay-2026-11-07.json", "ladder", "w40-anchor")
l40 = replay_terminal("quant3d-q3c-narrow-ladder-replay-2026-11-24.json", "ladder", "w40-anchor")
portability = {"arc140v_vs_l40s_w40anchor": {q: l40[q] / arc[q] - 1 for q in ("V", "rho", "P", "sigmaStar")}}

# ---- effective anisotropy from equilibrium shapes ----
eq = []
for fname, sess in (("quant3d-q3d-equilibrium-2026-11-26.json", "s1"), ("quant3d-q3d-equilibrium-s2-2026-11-26.json", "s2"),
                    ("quant3d-q3d-equilibrium-s3-2026-11-27.json", "s3")):
    for case in load(fname)["cases"]:
        cfg, m = case["config"], case["measurements"][-1]
        eq.append({"session": sess, "geometry": cfg["name"], "dx": cfg["dx"], "R": cfg["radius"], "lambda": cfg["lambda"],
                   "epsRaw": cfg["epsilon"], "epsEff": m["epsilon"], "epsEffError": m["epsilonError"],
                   "ratio": m["epsilon"] / cfg["epsilon"], "d0Effective": m["d0Effective"],
                   "d0Nominal": 0.8838834764831844 / cfg["lambda"]})

# ---- headline comparisons ----
cal = {"0.0123": A[("q3d-s2", "e123cal")], "0.0171": A[("q3d-s1", "e171cal")],
       "0.0265_dx08": A[("q3d-s2", "e265cal")], "0.0265_dx06": A[("q3d-s3", "e265cal06")]}
definition = {
    "0.0171_e171cal_vs_w28": {q: rel(A[("q3d-s1", "e171cal")], w28, q) for q in QS},
    "0.0265_e265cal_vs_e265base": {q: rel(A[("q3d-s2", "e265cal")], e265, q) for q in QS},
    "0.0265_e265cal06_vs_e265dx": {q: rel(A[("q3d-s3", "e265cal06")], A[("q3d-s1", "e265dx")], q) for q in QS},
}
predictions = {  # frozen in scripts/research/quant3d-paper-rows.md before each run
    "e171cal": {"sigmaStar": 0.06023, "P": 0.3184, "Vd0OverD": 0.012216},
    "e265cal": {"sigmaStar": 0.13966, "P": 0.25113, "Vd0OverD": 0.017617},
    "e265cal06": {"sigmaStar": 0.13343, "P": 0.25582, "Vd0OverD": 0.017465},
}
prediction_miss = {}
for n, pred in predictions.items():
    r = next(x for x in arms if x["name"] == n)
    prediction_miss[n] = {q: r[q] / v - 1 for q, v in pred.items()}

# ---- tip morphology: four-fold amplitude A1(z) = A |z|^alpha (CPU replay; diagnostic, not a gate) ----
KR96_MORPH = {0.0123: (1.73, 11.3), 0.0171: (1.68, 10.1), 0.0265: (1.62, 7.8)}  # (alpha, 1/A), KR96 Table I
morphology = {}
for fname, name, row in (("quant3d-q3d-rows-replay-s2-2026-11-26.json", "e123cal", 0.0123),
                         ("quant3d-q3d-rows-replay-2026-11-26.json", "e171cal", 0.0171),
                         ("quant3d-q3d-rows-replay-s2-2026-11-26.json", "e265cal", 0.0265),
                         ("quant3d-q3d-rows-replay-s3-2026-11-27.json", "e265cal06", 0.0265)):
    m = load(fname)["campaigns"]["q3d"]["arms"][name]["morphology"]
    fit = m.get("powerFitMean")
    ka, kinv = KR96_MORPH[row]
    morphology[name] = {"row": row, "fitRangeInRho": m["fitRange"], "kr96Alpha": ka, "kr96InvA": kinv,
                        "alpha": fit and fit["alpha"], "invA": fit and fit["invA"],
                        "spread": m.get("powerFitSpread"),
                        "alphaVsKR96": fit and fit["alpha"] / ka - 1, "invAVsKR96": fit and fit["invA"] / kinv - 1,
                        "covered": [d.get("covered") for d in m["terminal"]]}

ledger = {
    "kr96": {str(k): dict(zip(("pfP", "pfSigma", "solvP", "solvSigma"), v)) for k, v in KR96.items()},
    "morphology": morphology,
    "arms": arms, "controls28": controls28, "controls40": controls40, "controls265": controls265,
    "widthLadder": ladder, "widthFits": fits, "precision": precision, "portability": portability,
    "equilibrium": eq, "calibratedRows": cal, "definitionEffect": definition, "predictionMiss": prediction_miss,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(ledger, f, indent=1)
print("wrote", os.path.relpath(OUT, ROOT), "-", len(arms), "arms")
