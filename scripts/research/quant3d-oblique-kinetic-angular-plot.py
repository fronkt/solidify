"""Plot the completed, frozen angular study without adding an estimator or fit.

The linear intercept uses precisely the registered expression in the sealed
summary script; that summary saves its absolute spread rather than its sign.
All other plotted intercepts are copied from summary.json.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
from matplotlib import font_manager, ft2font, pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import FixedLocator, FuncFormatter, LogLocator
import numpy as np


SUMMARY_SHA256 = "89575bdf8040402669b4517d7ec0b831a1ccb319a2b7e4044b8fe3b781a068e2"
SUMMARY_SOURCE_SHA256 = "42a3ed5b05a379bf38b991765b7a9b9bb4f6ce4c89c2cafa574cae5ea0535624"
STUDY_SHA256 = "8c6551259c7b849a564a97910d43576f535bfc5714e3fa5dbe75d5812fc84415"
NORMALS = ((2, 1, 0), (2, 1, 1), (3, 2, 1))
MODELS = (
    ("default", "Default", "#0072B2", "o"),
    ("principal", "Principal correction", "#D55E00", "s"),
    ("angular", "Angular correction", "#009E73", "D"),
)
METHODS = (
    "linear_intercept", "primary_quadratic_intercept",
    "secondary_quadratic_intercept", "cubic_intercept",
)
CAPTION = (
    "Solid-side finite-range kinetic intercepts on the physical lattice; markers "
    "use the registered quadratic fit at V = 0.005, 0.01, 0.02. Bars show the full "
    "intercept range across the registered linear, primary quadratic, secondary "
    "quadratic and cubic methods; they are fit sensitivity, not statistical "
    "confidence intervals. V = 0.04 is held out from the primary fit and enters "
    "only the registered secondary/cubic sensitivity fits. Unit width, P.tau = 1, "
    "identity grain; [321] is the held-out orientation. These finite-range "
    "diagnostics establish no exact zero-speed coefficient, temporal stability, "
    "production adoption or Q3 acceptance."
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(summary_path: Path) -> tuple[dict, list[dict]]:
    if sha256(summary_path) != SUMMARY_SHA256:
        raise ValueError("Input is not the completed frozen angular summary")
    summary = json.loads(summary_path.read_text())
    if summary["summarySourceSha256"] != SUMMARY_SOURCE_SHA256 or summary["studySha256"] != STUDY_SHA256:
        raise ValueError("Frozen summary provenance mismatch")
    if not (summary["newStudyCompleted"] and summary["cpuSourceStable"] and summary["inputsStable"]):
        raise ValueError("Completed immutable CPU evidence is required")
    if len(summary["groups"]) != 27:
        raise ValueError("Expected all 27 registered main comparison groups")
    rows = []
    for group in summary["groups"]:
        normal = tuple(group["normal"])
        if normal not in NORMALS or group["h"] not in (.8, .4, .2) or group.get("failed"):
            raise ValueError("Unexpected or incomplete group")
        v = np.asarray(group["speeds"], dtype=float)
        if not np.array_equal(v, np.array([.005, .01, .02, .04])):
            raise ValueError("Registered velocity window changed")
        solid = group["Solid"]
        # Exact registered expression in the immutable angular-summary.py.
        linear = float(np.polynomial.polynomial.polyfit(v[:3], np.asarray(solid["values"])[:3], 1)[0])
        primary = solid["primaryQuadraticIntercept"]
        if abs(linear - primary) != solid["linearQuadraticSpread"]:
            raise ValueError("Registered linear-fit reconstruction differs from the sealed summary")
        row = {
            "normal": "".join(map(str, normal)), "held_out_normal": normal == (3, 2, 1),
            "h": group["h"], "model": group["tauModel"],
            "primary_quadratic_intercept": primary,
            "linear_intercept": linear,
            "secondary_quadratic_intercept": solid["secondaryQuadraticIntercept"],
            "cubic_intercept": solid["cubicIntercept"],
        }
        values = [row[key] for key in METHODS]
        if not np.all(np.isfinite(values)):
            raise ValueError("A nonfinite registered intercept cannot be silently omitted")
        row["fit_min"] = min(values)
        row["fit_max"] = max(values)
        row["range_crosses_zero"] = row["fit_min"] <= 0 <= row["fit_max"]
        rows.append(row)
    identities = {(row["normal"], row["h"], row["model"]) for row in rows}
    if len(identities) != 27 or {row["model"] for row in rows} != {model[0] for model in MODELS}:
        raise ValueError("Duplicate or missing registered model comparison")
    rows.sort(key=lambda row: (row["normal"], row["h"], [m[0] for m in MODELS].index(row["model"])))
    return summary, rows


def plot_rows(rows: list[dict]) -> tuple[plt.Figure, dict]:
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 10,
        "axes.titlesize": 12, "axes.labelsize": 11,
        "xtick.labelsize": 10, "ytick.labelsize": 10,
        "axes.spines.top": False, "axes.spines.right": False,
        "svg.hashsalt": "solidify-angular-frozen-summary-v1",
        "svg.fonttype": "none", "pdf.fonttype": 42,
    })
    fig, axes = plt.subplots(1, 3, figsize=(11.8, 5.15), sharey=True)
    # Reserve explicit figure space for the shared legend and caption.
    fig.subplots_adjust(left=.087, right=.985, bottom=.285, top=.775, wspace=.13)
    minimum = min(row["fit_min"] for row in rows)
    maximum = max(row["fit_max"] for row in rows)
    yscale = "log" if minimum > 0 else "symlog"
    linear_threshold = 1e-6
    for panel, (ax, normal) in enumerate(zip(axes, NORMALS)):
        normal_text = "".join(map(str, normal))
        ax.set_title(f"[{normal_text}]" + ("  (held out)" if normal == (3, 2, 1) else ""), pad=10)
        ax.set_xscale("log", base=2)
        if yscale == "log":
            ax.set_yscale("log")
            ax.yaxis.set_major_locator(LogLocator(base=10))
        else:
            ax.set_yscale("symlog", linthresh=linear_threshold, linscale=1)
            ax.axhline(0, color="#616161", linewidth=.8)
        ax.set_xlim(.175, .915)
        ax.xaxis.set_major_locator(FixedLocator([.2, .4, .8]))
        ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:g}"))
        ax.xaxis.set_minor_locator(FixedLocator([]))
        ax.set_xlabel("Physical lattice spacing h")
        ax.grid(axis="y", which="major", color="#D8DDE3", linewidth=.65)
        ax.grid(axis="x", which="major", color="#E9ECF0", linewidth=.55)
        ax.set_axisbelow(True)
        for model, label, color, marker in MODELS:
            selected = sorted((row for row in rows if row["normal"] == normal_text and row["model"] == model), key=lambda row: row["h"])
            x = np.array([row["h"] for row in selected])
            y = np.array([row["primary_quadratic_intercept"] for row in selected])
            lower = np.array([row["fit_min"] for row in selected])
            upper = np.array([row["fit_max"] for row in selected])
            ax.errorbar(x, y, yerr=np.stack((y-lower, upper-y)),
                        color=color, marker=marker, markersize=5.7, linewidth=1.55,
                        elinewidth=1.3, capsize=3.8, capthick=1.2,
                        markeredgecolor="white", markeredgewidth=.6,
                        label=label, zorder=3)
        if panel == 0:
            ax.set_ylabel(r"Solid-side finite-range intercept $\widehat{\beta}_{s}$")
    if yscale == "log":
        axes[0].set_ylim(minimum / 1.7, maximum * 1.8)
    else:
        axes[0].set_ylim(min(minimum * 1.5, -linear_threshold), max(maximum * 1.5, linear_threshold))
    fig.suptitle("Oblique kinetic correction: registered fit sensitivity", x=.535, y=.97,
                 fontsize=15, fontweight="semibold")
    handles = [Line2D([], [], color=color, marker=marker, linewidth=1.55,
                      markersize=6, label=label) for _, label, color, marker in MODELS]
    fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(.535, .902),
               ncol=3, frameon=False, handlelength=2, columnspacing=2.1)
    fig.text(.087, .188,
             "Markers: primary quadratic at V = 0.005, 0.01, 0.02; V = 0.04 held out from that fit.\n"
             "Bars: full range of four registered intercept methods; fit sensitivity, not confidence intervals.",
             ha="left", va="top", fontsize=9.2, linespacing=1.5)
    fig.text(.087, .071,
             "Unit width, P.tau = 1, identity grain. Finite-range diagnostics; no exact zero-speed, stability or adoption claim.",
             ha="left", va="top", fontsize=8.9, color="#42474D")
    return fig, {"xscale": "log base2", "yscale": yscale,
                 "symlogLinearThresholdIfNeeded": linear_threshold,
                 "minimumRegisteredIntercept": minimum,
                 "maximumRegisteredIntercept": maximum,
                 "rangeCrossingZeroCount": sum(row["range_crosses_zero"] for row in rows),
                 "theoreticalOrFittedGuides": "none"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=Path("verify-out/q3-oblique-angular-study-v2/summary.json"))
    parser.add_argument("--output-prefix", type=Path, default=Path("docs/validation/quant3d-angular-kinetic-fit-sensitivity-2026-10-31"))
    args = parser.parse_args()
    summary, rows = load_rows(args.summary)
    study_path = args.summary.with_name("study.json")
    if sha256(study_path) != STUDY_SHA256:
        raise ValueError("The original completed study must accompany its frozen summary")
    frozen_cpu_hashes = json.loads(study_path.read_text())["cpuSourceHashes"]
    prefix = args.output_prefix
    prefix.parent.mkdir(parents=True, exist_ok=True)
    table_path = prefix.with_suffix(".csv")
    with table_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({key: format(value, ".17g") if isinstance(value, float) else value for key, value in row.items()})
    caption_path = prefix.with_suffix(".md")
    caption_path.write_text("# Angular kinetic fit-sensitivity figure\n\n" + CAPTION + "\n\n"
        "Reproduce from the repository root:\n\n```sh\n"
        "python scripts/research/quant3d-oblique-kinetic-angular-plot.py\n```\n\n"
        "The CSV records every plotted primary value and each registered fit method. "
        "The JSON records input, source, environment and output hashes.\n", encoding="utf-8")
    fig, plot = plot_rows(rows)
    png_path = prefix.with_suffix(".png")
    svg_path = prefix.with_suffix(".svg")
    fig.savefig(png_path, dpi=300, facecolor="white", metadata={"Title": "Solidify angular kinetic fit sensitivity", "Description": CAPTION})
    fig.savefig(svg_path, facecolor="white", metadata={"Title": "Solidify angular kinetic fit sensitivity", "Description": CAPTION, "Date": None, "Creator": "Solidify frozen-summary plotting script"})
    plt.close(fig)
    font_path = Path(font_manager.findfont(font_manager.FontProperties(family="DejaVu Sans")))
    environment = {"python": sys.version, "implementation": platform.python_implementation(),
                   "platform": platform.platform(), "numpy": np.__version__,
                   "matplotlib": matplotlib.__version__, "backend": matplotlib.get_backend(),
                   "freetype": ft2font.__freetype_version__, "font": font_path.name,
                   "fontSha256": sha256(font_path)}
    environment_hash = hashlib.sha256(json.dumps(environment, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    provenance = {
        "format": "solidify-angular-kinetic-fit-sensitivity-figure-v1",
        "sourceSummary": str(args.summary).replace("\\", "/"), "summarySha256": SUMMARY_SHA256,
        "summarySourceSha256": SUMMARY_SOURCE_SHA256, "studySha256": STUDY_SHA256,
        "frozenCpuSourceHashes": frozen_cpu_hashes,
        "sealSha256": summary["sealSha256"], "plotSourceSha256": sha256(Path(__file__)),
        "registeredFitMethods": {
            "linear": "degree1, V=.005/.01/.02; exact sealed summary expression reconstructed",
            "primaryQuadratic": "degree2, V=.005/.01/.02; copied from frozen summary",
            "secondaryQuadratic": "degree2, V=.01/.02/.04; copied from frozen summary",
            "cubic": "degree3, V=.005/.01/.02/.04; copied from frozen summary",
        },
        "fitRangeMeaning": "full registered-method range; deterministic sensitivity, not statistical confidence interval",
        "newFitsOrPhysicalCoefficientSelection": False,
        "plottedRows": len(rows), "plot": plot, "caption": CAPTION,
        "environment": environment, "canonicalEnvironmentSha256": environment_hash,
        "outputs": {path.name: sha256(path) for path in [table_path, caption_path, png_path, svg_path]},
    }
    provenance_path = prefix.with_suffix(".json")
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"outputs": provenance["outputs"], "provenanceSha256": sha256(provenance_path),
                      "plotSourceSha256": provenance["plotSourceSha256"], "plot": plot}, indent=2))


if __name__ == "__main__":
    main()
