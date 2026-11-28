"""Figures for the CMS paper, drawn only from paper/cms/data/ledger.json, the committed CPU replays
in docs/validation/, and two archived terminal checkpoints in paper/cms/data/samples/.

    python -I paper/cms/scripts/ledger.py && python -I paper/cms/scripts/figures.py
"""
import json
import math
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
VAL = os.path.join(ROOT, "docs", "validation")
DATA = os.path.join(ROOT, "paper", "cms", "data")
FIG = os.path.join(ROOT, "paper", "cms", "figures")
os.makedirs(FIG, exist_ok=True)
L = json.load(open(os.path.join(DATA, "ledger.json"), encoding="utf-8"))

# Validated 3-slot categorical palette (dataviz reference slots 1-3, all-pairs CVD pass, light);
# literature references in neutral inks with their own markers.
BLUE, ORANGE, AQUA = "#257de0", "#f47230", "#00b894"
INK, INK2, GRID = "#191919", "#666666", "#d9d9d9"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 8, "axes.labelsize": 8, "axes.titlesize": 8,
    "legend.fontsize": 7, "xtick.labelsize": 7, "ytick.labelsize": 7,
    "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "axes.linewidth": 0.6, "lines.linewidth": 1.2, "lines.markersize": 5,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.4, "axes.axisbelow": True,
    "legend.frameon": False, "savefig.dpi": 600, "pdf.fonttype": 42,
})
ONE, TWO = 3.54, 7.48  # single and double column widths (in)


def save(fig, name):
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(FIG, f"{name}.{ext}"), bbox_inches="tight")
    plt.close(fig)


def arm(session, name):
    return next(a for a in L["arms"] if a["session"] == session and a["name"] == name)


def tag(ax, s):
    ax.text(-0.16, 1.02, s, transform=ax.transAxes, fontweight="bold", fontsize=9, va="bottom")


# ---------------------------------------------------------------- Fig 1: tip shape
def tip_patch(fname):
    j = json.load(open(os.path.join(DATA, "samples", fname), encoding="utf-8"))
    ff = j["farFieldDiagnostics"]
    zt, rho = ff["patchTipW0"], ff["patchRhoW0"]
    pts = j["points"]
    x = np.array([p["x"] for p in pts]); y = np.array([p["y"] for p in pts]); z = np.array([p["z"] for p in pts])
    xs, ys = np.unique(x), np.unique(y)
    Z = np.full((len(ys), len(xs)), np.nan)
    for p in pts:
        Z[np.searchsorted(ys, p["y"]), np.searchsorted(xs, p["x"])] = p["z"]
    return xs / rho, ys / rho, (zt - Z) / rho, rho


fig, (a1, a2) = plt.subplots(1, 2, figsize=(TWO, 2.9), gridspec_kw={"width_ratios": [1, 1.25]})
X, Y, D, rho171 = tip_patch("e171cal-000315690.json")
lev = np.arange(0.25, 2.01, 0.25)
cs = a1.contour(X, Y, D, levels=lev, colors=BLUE, linewidths=1.0)
a1.clabel(cs, levels=lev[1::2], fmt="%.2f", fontsize=6, inline_spacing=2)
th = np.linspace(0, math.pi / 2, 200)
for d in lev:  # paraboloid of the same tip radius: depth = r^2 / 2
    r = math.sqrt(2 * d)
    a1.plot(r * np.cos(th), r * np.sin(th), color=INK2, lw=0.6, ls=(0, (2, 2)))
a1.plot([0, 1.9], [0, 1.9], color=INK2, lw=0.5, ls=":")
a1.set_xlim(0, X.max()); a1.set_ylim(0, Y.max()); a1.set_aspect("equal")
a1.set_xlabel(r"$x/\rho$  [100]"); a1.set_ylabel(r"$y/\rho$  [010]")
a1.grid(False)
a1.text(0.12, 0.28, "[110]", color=INK2, fontsize=7, rotation=45)
a1.set_title(r"$\varepsilon_4=0.0171$ tip: depth below tip $(z_{tip}-z)/\rho$", loc="left")
tag(a1, "(a)")

for fname, col, lab in (("e171cal-000315690.json", BLUE, r"$\varepsilon_4=0.0171$"),
                        ("e265cal06-000292429.json", AQUA, r"$\varepsilon_4=0.0265$")):
    X, Y, D, _ = tip_patch(fname)
    a2.plot(X, D[0, :], color=col, lw=1.4, label=f"{lab}, [100]")
    n = min(len(X), len(Y))
    a2.plot(np.sqrt(2) * X[:n], np.diag(D)[:n], color=col, lw=1.4, ls=(0, (4, 2)), label=f"{lab}, [110]")
rr = np.linspace(0, 3.0, 100)
a2.plot(rr, rr ** 2 / 2, color=INK, lw=0.8, ls=":", label=r"paraboloid $r^2/2\rho^2$")
a2.set_xlim(0, 2.8); a2.set_ylim(0, 3.0)
a2.set_xlabel(r"distance from axis $r/\rho$"); a2.set_ylabel(r"depth below tip $(z_{tip}-z)/\rho$")
a2.legend(loc="upper left", handlelength=2.6)
a2.set_title("Principal-plane profiles (terminal checkpoints)", loc="left")
tag(a2, "(b)")
fig.tight_layout()
save(fig, "fig1_tip_shape")

# ---------------------------------------------------------------- Fig 2: approach to steady state
def series(fname, name):
    x = json.load(open(os.path.join(VAL, fname), encoding="utf-8"))["campaigns"]["q3d"]["arms"][name]
    s = x["series"]; t = x["terminal"]; D = x["config"]["D"]
    tdiff = D / t["velocity"] ** 2
    return (np.array([p["time"] for p in s]) / tdiff, np.array([p["sigma"] for p in s]),
            np.array([p["P"] for p in s]), t)


fig, (b1, b2) = plt.subplots(1, 2, figsize=(TWO, 2.5))
for fname, name, col, lab, ref in (
        ("quant3d-q3d-rows-replay-s2-2026-11-26.json", "e123cal", ORANGE, r"$\varepsilon_4=0.0123$", 0.0123),
        ("quant3d-q3d-rows-replay-2026-11-26.json", "e171cal", BLUE, r"$\varepsilon_4=0.0171$", 0.0171),
        ("quant3d-q3d-rows-replay-s3-2026-11-27.json", "e265cal06", AQUA, r"$\varepsilon_4=0.0265$ ($\Delta x=0.6$)", 0.0265)):
    t, sg, P, term = series(fname, name)
    b1.plot(t, sg / term["sigma"], color=col, marker="o", ms=2.5, lw=1.0, label=lab)
    b2.plot(t, P / term["P"], color=col, marker="o", ms=2.5, lw=1.0, label=lab)
for ax, q in ((b1, r"$\sigma^*(t)/\sigma^*_{\rm terminal}$"), (b2, r"$P(t)/P_{\rm terminal}$")):
    ax.axhspan(0.99, 1.01, color=GRID, alpha=0.5, lw=0)
    ax.set_xlabel(r"time $t\,V^2/D$"); ax.set_ylabel(q)
b1.set_ylim(0.4, 1.15); b2.set_ylim(0.9, 2.2)
b1.legend(loc="lower right"); tag(b1, "(a)"); tag(b2, "(b)")
fig.tight_layout()
save(fig, "fig2_transient")

# ---------------------------------------------------------------- Fig 3: width ladder
lad = L["widthLadder"]; fits = L["widthFits"]
lam = np.array([p["lambda"] for p in lad])
fig, axs = plt.subplots(1, 3, figsize=(TWO, 2.5))
kr = L["kr96"]["0.0171"]
specs = (("sigmaStar", r"$\sigma^*$", kr["pfSigma"], kr["solvSigma"]),
         ("P", r"$P$", kr["pfP"], kr["solvP"]),
         ("Vd0OverD", r"$V d_0/D$", 2 * kr["pfP"] ** 2 * kr["pfSigma"], 2 * kr["solvP"] ** 2 * kr["solvSigma"]))
ll = np.linspace(0, 5.2, 200)
for ax, (q, lab, pf, sv) in zip(axs, specs):
    y = np.array([p[q] for p in lad])
    ax.plot(lam, y, "o", color=BLUE, ms=4.5, label=r"raw $\varepsilon_4=0.0171$", zorder=3)
    for fit, ls, flab in (("linear", "-", r"linear in $\lambda$"), ("quadratic", (0, (4, 2)), r"linear in $\lambda^2$")):
        c = fits[q][fit]["coefficients"]; pw = fits[q][fit]["powers"]
        ax.plot(ll, sum(ci * ll ** pi for ci, pi in zip(c, pw)), color=BLUE, lw=0.8, ls=ls, alpha=0.8, label=flab)
    cal = arm("q3d-s1", "e171cal")
    ax.plot([2.8], [cal[q]], "D", color=ORANGE, ms=4.5, label=r"calibrated ($\varepsilon_{\rm eff}=0.0171$)", zorder=4)
    ax.axhline(pf, color=INK, lw=0.8, ls="-."); ax.axhline(sv, color=INK2, lw=0.8, ls=":")
    ax.set_xlim(0, 5.3); ax.set_xlabel(r"coupling $\lambda \propto W_0/d_0$"); ax.set_title(lab, loc="left")
axs[0].text(0.15, kr["pfSigma"] * 1.004, "KR96 PF", fontsize=6.5, color=INK, va="bottom")
axs[0].text(0.15, kr["solvSigma"] * 0.996, "KR96 solvability", fontsize=6.5, color=INK2, va="top")
axs[0].legend(loc="lower left", fontsize=6, handlelength=2.2)
for ax, s in zip(axs, "abc"):
    tag(ax, f"({s})")
fig.tight_layout()
save(fig, "fig3_width_ladder")

# ---------------------------------------------------------------- Fig 4: effective anisotropy
fig, ax = plt.subplots(figsize=(ONE, 2.4))
groups = ((0.8, 20, BLUE, "o", r"$\Delta x/W_0=0.8$, $R=20W_0$"), (0.6, 20, AQUA, "s", r"$\Delta x/W_0=0.6$, $R=20W_0$"),
          (0.8, 30, ORANGE, "^", r"$\Delta x/W_0=0.8$, $R=30W_0$"))
for dx, R, col, mk, lab in groups:
    pts = sorted((e for e in L["equilibrium"] if e["dx"] == dx and e["R"] == R), key=lambda e: e["epsRaw"])
    ax.errorbar([e["epsRaw"] for e in pts], [e["ratio"] for e in pts], yerr=[e["epsEffError"] / e["epsRaw"] for e in pts],
                color=col, marker=mk, ls="-", lw=0.8, ms=4.5, capsize=0, label=lab)
ax.set_xlabel(r"input (raw) $\varepsilon_4$"); ax.set_ylabel(r"$\varepsilon_{\rm eff}/\varepsilon_4$ (equilibrium shape)")
ax.set_ylim(0.955, 0.99); ax.legend(loc="center right")
fig.tight_layout()
save(fig, "fig4_effective_anisotropy")

# ---------------------------------------------------------------- Fig 5: KR96 comparison
def eff_of(raw, dx):
    m = [e for e in L["equilibrium"] if e["R"] == 20 and e["dx"] == dx and abs(e["epsRaw"] / raw - 1) < 1e-6]
    assert len(m) >= 1, (raw, dx)
    return m[0]["epsEff"]


ours = {
    "raw": [("q3c-A", "w28", 0.8), ("q3d-s1", "e265base", 0.8)],
    "cal08": [("q3d-s2", "e123cal", 0.8), ("q3d-s1", "e171cal", 0.8), ("q3d-s2", "e265cal", 0.8)],
    "cal06": [("q3d-s3", "e265cal06", 0.6)],
    "raw06": [("q3c-B", "dx", 0.6), ("q3d-s1", "e265dx", 0.6)],
}
style = {"raw": (BLUE, "o", r"raw $\varepsilon_4$, $\Delta x=0.8$"), "raw06": (BLUE, "s", r"raw $\varepsilon_4$, $\Delta x=0.6$"),
         "cal08": (ORANGE, "D", r"calibrated, $\Delta x=0.8$"), "cal06": (AQUA, "D", r"calibrated, $\Delta x=0.6$")}
fig, (c1, c2) = plt.subplots(1, 2, figsize=(TWO, 2.7))
rows = sorted(float(k) for k in L["kr96"])
for ax, q, pfk, svk, lab in ((c1, "sigmaStar", "pfSigma", "solvSigma", r"$\sigma^*$"), (c2, "P", "pfP", "solvP", r"$P$")):
    ax.plot(rows, [L["kr96"][str(r)][pfk] for r in rows], color=INK, marker="s", mfc="white", ms=5, lw=0.9, ls="-.",
            label="KR96 phase field")
    ax.plot(rows, [L["kr96"][str(r)][svk] for r in rows], color=INK2, marker="o", mfc="white", ms=5, lw=0.9, ls=":",
            label="KR96 solvability")
    for key in ("raw", "raw06", "cal08", "cal06"):
        col, mk, slab = style[key]
        xs, ys, es = [], [], []
        for sess, name, dx in ours[key]:
            a = arm(sess, name)
            xs.append(eff_of(a["epsRaw"], dx)); ys.append(a[q]); es.append(a["uS" if q == "sigmaStar" else "uP"] * a[q])
        ax.errorbar(xs, ys, yerr=es, color=col, marker=mk, ls="none", ms=4.5, capsize=0, lw=0.8,
                    mfc=col if key.startswith("cal") else "white", label=slab)
    ax.set_xscale("log"); ax.set_xlabel(r"effective anisotropy $\varepsilon_{\rm eff}$ (KR96 definition)")
    ax.set_xticks([0.012, 0.017, 0.026]); ax.set_xticklabels(["0.012", "0.017", "0.026"]); ax.minorticks_off()
    ax.set_title(lab, loc="left")
c1.set_yscale("log"); c1.set_yticks([0.03, 0.05, 0.1, 0.15]); c1.set_yticklabels(["0.03", "0.05", "0.10", "0.15"])
c1.legend(loc="upper left", fontsize=6.3)
tag(c1, "(a)"); tag(c2, "(b)")
fig.tight_layout()
save(fig, "fig5_kr96_rows")

# ---------------------------------------------------------------- Fig 6: error budget at eps4 0.0171
c28 = L["controls28"]; fw = L["widthFits"]["sigmaStar"]
items = [
    ("fp64 vs fp32 arithmetic", abs(L["precision"]["w28"]["fp64_vs_fp32"]["sigmaStar"]), None),
    ("GPU vendor (Arc 140V vs L40S, $\\lambda=4$)", abs(L["portability"]["arc140v_vs_l40s_w40anchor"]["sigmaStar"]), None),
    ("domain +11%", abs(c28["domain"]["sigmaStar"]), None),
    ("time step halved", abs(c28["dt"]["sigmaStar"]), None),
    ("width $\\lambda$ 2.8$\\to$2.52", abs(c28["width"]["sigmaStar"]), None),
    ("grid $\\Delta x$ 0.8$\\to$0.6", abs(c28["dx"]["sigmaStar"]), None),
    ("anisotropy definition (raw vs $\\varepsilon_{\\rm eff}$)", abs(L["definitionEffect"]["0.0171_e171cal_vs_w28"]["sigmaStar"]), None),
    ("width extrapolation $W_0\\to0$ (model-dependent)",
     abs(fw["quadratic"]["interceptVsNarrowest"]), abs(fw["linear"]["interceptVsNarrowest"])),
]
fig, ax = plt.subplots(figsize=(5.2, 3.0))
yy = np.arange(len(items))[::-1]
floor = 1e-4
for y, (lab, v, v2) in zip(yy, items):
    v = max(v * 100, floor)
    if v2 is None:
        ax.barh(y, v - floor, left=floor, height=0.55, color=BLUE)
        ax.text(v * 1.25, y, ("< 0.0001%" if v <= floor else f"{v:.2g}%"), va="center", fontsize=6.5, color=INK,
                bbox=dict(fc="white", ec="none", pad=0.6), zorder=5)
    else:
        ax.barh(y, v2 * 100 - v, left=v, height=0.55, color="white", edgecolor=BLUE, hatch="////", lw=0.8)
        ax.barh(y, v - floor, left=floor, height=0.55, color=BLUE, alpha=0.35)
        ax.text(v2 * 100 * 1.15, y, f"{v:.2g}-{v2 * 100:.2g}%", va="center", fontsize=6.5, color=INK)
sep = (L["kr96"]["0.0171"]["pfSigma"] / L["kr96"]["0.0171"]["solvSigma"] - 1) * 100
ax.axvline(sep, color=INK2, lw=0.8, ls=":")
ax.text(sep * 0.9, -0.8, "KR96 PF vs solvability (%.1f%%)" % sep, ha="right", va="center", fontsize=6, color=INK2)
ax.axvline(10, color=INK, lw=0.8, ls="-.")
ax.text(10 * 1.1, -0.8, "10% budget", ha="left", va="center", fontsize=6, color=INK)
ax.set_yticks(yy); ax.set_yticklabels([i[0] for i in items], fontsize=6.5)
ax.set_ylim(-1.3, len(items) - 0.5)
ax.set_xscale("log"); ax.set_xlim(floor, 400); ax.set_xlabel(r"$|\Delta\sigma^*|/\sigma^*$ (%)")
ax.grid(axis="y", visible=False)
fig.tight_layout()
save(fig, "fig6_error_budget")
print("figures written to", os.path.relpath(FIG, ROOT))
