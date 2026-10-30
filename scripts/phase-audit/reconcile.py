"""Targeted R2 reproductions. Input: directory of sanitized MatCalc TDBs.

No database/PDF is redistributed. Writes every equilibrium vertex to JSON,
including distinct composition sets with the same phase name. Restricted phase
sets are sensitivity probes, not a replacement equilibrium assessment.
"""
import argparse
import json
import pathlib
import warnings
import numpy as np
from pycalphad import Database, Model, equilibrium, variables as v
from scipy.optimize import root
import sympy as sp
from phasesel import select
from invariant import wt_pct

warnings.filterwarnings("ignore")
CASES = [
    ("ni", "NI", "NB", [.148, .19], [1282, 1320, 1362], ["LIQUID", "FCC_A1", "DELTA"]),
    ("fe", "FE", "NI", [.045, .08, .12], [1504, 1514, 1517], ["LIQUID", "BCC_A2", "FCC_A1"]),
    ("al", "MG", "AL", [.10, .15, .30], [435.3, 437], ["LIQUID", "HCP_A3", "G_AL12MG17"]),
    ("al", "MG", "ZR", [.0016, .007], [650, 653.6, 654.6], ["LIQUID", "HCP_A3", "BCC_A2"]),
    ("fe", "FE", "SI", [.28, .33, .36], [1200, 1250, 1300], ["LIQUID", "BCC_A2", "FCC_A1"]),
]


def probe(db, base, solute, xs, temperatures, restricted):
    phases, suspended, _ = select(db, base, solute)
    out = {"base": base, "solute": solute, "full_phases": phases,
           "suspended": suspended, "calculations": []}
    for label, active in [("full", phases), ("restricted_sensitivity", restricted)]:
        e = equilibrium(db, [base, solute, "VA"], active,
                        {v.X(solute): xs, v.T: [t + 273.15 for t in temperatures], v.P: 101325, v.N: 1})
        ci = list(e.component.values).index(solute)
        for j, temperature in enumerate(temperatures):
            for k, composition in enumerate(xs):
                q = e.isel(T=j, **{"X_" + solute: k})
                names, fractions = q.Phase.values.ravel(), q.NP.values.ravel()
                xx = q.X.values.reshape((-1, len(e.component)))
                points = [{"phase": str(name), "fraction": float(fraction),
                           "x": float(xx[i, ci]), "wt_pct": wt_pct(float(xx[i, ci]), base, solute)}
                          for i, (name, fraction) in enumerate(zip(names, fractions))
                          if str(name) and np.isfinite(fraction) and fraction > 1e-8]
                out["calculations"].append({"set": label, "T_C": temperature,
                                             "x_bulk": composition, "points": points})
    return out


def common_tangent_fe_ni(db):
    """Four chemical-potential equalities, independent of identity-change search."""
    temp, x = sp.symbols("temperature x", real=True)
    phases, functions = ["LIQUID", "BCC_A2", "FCC_A1"], []
    for phase in phases:
        model = Model(db, ["FE", "NI", "VA"], phase)
        subs = {v.T: temp, v.P: 101325}
        for j, constituents in enumerate(model.constituents):
            for species in constituents:
                subs[v.Y(phase, j, species)] = x if str(species) == "NI" else 1 - x if str(species) == "FE" else 1
        g = sp.sympify(model.GM).subs(subs)
        functions.append(sp.lambdify((temp, x), (g, sp.diff(g, x)), modules="numpy", cse=True))

    def residual(z):
        gd = [fn(z[0], xx) for fn, xx in zip(functions, z[1:])]
        mu = [(g - xx * dg, g + (1 - xx) * dg) for (g, dg), xx in zip(gd, z[1:])]
        return [(mu[i][j] - mu[0][j]) / 1000 for i in [1, 2] for j in [0, 1]]

    result = root(residual, [1777, .12, .095, .11], tol=1e-10)
    if not result.success or max(abs(z) for z in residual(result.x)) > 1e-7:
        raise RuntimeError("Fe-Ni common tangent did not converge")
    return {"temperature_C": float(result.x[0] - 273.15),
            "residual_kJ_per_mol": [float(z) for z in residual(result.x)],
            "phases": {phase: {"x_Ni": float(xx), "wt_Ni": wt_pct(float(xx), "FE", "NI")}
                       for phase, xx in zip(phases, result.x[1:])}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clean_dir", type=pathlib.Path)
    ap.add_argument("out_dir", type=pathlib.Path)
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    databases = {key: Database(str(args.clean_dir / name)) for key, name in
                 [("al", "mc_al_v2037.tdb"), ("fe", "mc_fe_v2062.tdb"), ("ni", "mc_ni_v2036.tdb")]}
    for key, base, solute, xs, temperatures, restricted in CASES:
        out = probe(databases[key], base, solute, xs, temperatures, restricted)
        (args.out_dir / f"{base}-{solute}-probes.json").write_text(json.dumps(out, indent=2), encoding="utf8")
        print(f"{base}-{solute}: {len(out['calculations'])} equilibrium states", flush=True)
    out = common_tangent_fe_ni(databases["fe"])
    (args.out_dir / "FeNi-common-tangent.json").write_text(json.dumps(out, indent=2), encoding="utf8")
    print("Fe-Ni common tangent:", out["temperature_C"], flush=True)


if __name__ == "__main__":
    main()
