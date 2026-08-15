"""Targeted C_SM read for rows whose two-phase window the log scan stepped over.

C_SM is the primary-side end of the invariant tie-line, so it can be read
wherever the primary coexists with anything on that isotherm. Probing relative
to the KNOWN invariant composition puts the probes inside the window instead of
hoping a geometric ladder lands in it.
"""
import json, sys, warnings, numpy as np
warnings.filterwarnings("ignore")
from invariant import Calc, wt_pct

for key, tdb, base, sol in [("al-ZN", "tdbc/mc_al_v2037.tdb", "AL", "ZN"),
                            ("mg-ZR", "tdbc/mc_al_v2037.tdb", "MG", "ZR")]:
    d = json.load(open(f"results/{key}.json"))
    if d.get("status") != "OK":
        print(key, "skip", d.get("status")); continue
    T = d["T_inv_K"]; xinv = d["C_inv_x"]; prim = d["primary"]
    c = Calc(tdb, base, sol)
    best, hits = None, []
    for f in (0.30, 0.50, 0.65, 0.75, 0.85, 0.92, 0.96, 1.05, 1.2, 1.6, 2.5, 4.0, 8.0):
        for dT in (+0.5, -0.5):
            x = xinv * f
            if not (1e-7 < x < 0.995):
                continue
            try:
                p = c.point(x, T + dT)
            except Exception:
                continue
            if prim in p and len(p) >= 2:
                v = p[prim]["x"]
                hits.append((round(f, 2), dT, round(v, 5), sorted(p)))
                best = v if best is None else max(best, v)
    print(f"{key}: primary={prim}  C_SM_x={best}  C_SM_wt="
          f"{'None' if best is None else round(wt_pct(best, base, sol), 3)}  hits={len(hits)}")
    for h in hits[:6]:
        print("   ", h)
