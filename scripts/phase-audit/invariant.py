"""Compute a binary invariant (type, T_inv, C_inv, C_SM, second phase) from an
open CALPHAD TDB via pycalphad. Nothing is hand-entered; every number returned
is read out of the database.

METHOD -- the first-forming solid changes identity AT the invariant.

Walk composition upward from the dilute end and ask, at each composition, which
solid appears first out of the melt. Below the invariant composition it is the
PRIMARY phase (the solid solution continuous with the pure base). Above it, it
is something else. The composition where that identity flips IS C_inv, and the
liquidus temperature there IS T_inv. This is the definition of a binary
invariant rather than a signal fitted to one, and it reads eutectics and
peritectics with the same code:

  Al-Si  below 12.6 wt% Si the first solid is FCC_A1, above it silicon
  Fe-C   below 0.53 wt% C the first solid is BCC_A2 (delta), above it FCC_A1

An earlier version located the invariant as a PLATEAU in the solidus. It works
for Al-Si and fails for Fe-C, twice over: compositions whose liquid survives to
the bottom of the scan window all report that floor and fake a plateau there,
and the true peritectic plateau spans only 0.09-0.17 wt% C, which a uniform
composition grid resolves with two points. Both failures are the same shape --
the measurement was being read off a window rather than off the physics.

TYPE is then decided by composition ordering at the invariant, which is again
the definition: for L -> a + b the liquid lies BETWEEN the two solid
compositions; for L + a -> b the product lies between the primary and the
liquid.
"""
import argparse, json, warnings
import numpy as np

warnings.filterwarnings("ignore")

from pycalphad import Database, equilibrium, variables as v
from phasesel import select

MASS = {
    "AL": 26.9815, "CU": 63.546, "SI": 28.085, "MG": 24.305, "ZN": 65.38,
    "FE": 55.845, "TI": 47.867, "C": 12.011, "MN": 54.938, "NI": 58.6934,
    "CR": 51.9961, "MO": 95.95, "NB": 92.9064, "W": 183.84, "ZR": 91.224,
    "SN": 118.71, "PB": 207.2, "AG": 107.868,
}


def wt_pct(x, base, solute):
    ms, mb = MASS[solute], MASS[base]
    return 100.0 * x * ms / (x * ms + (1.0 - x) * mb)


def is_liq(name):
    return "LIQ" in name.upper()


class Calc:
    def __init__(self, tdb, base, solute):
        self.db = Database(tdb)
        self.base, self.solute = base, solute
        self.comps = sorted({base, solute, "VA"})
        self.phases, self.suspended, _ = select(self.db, base, solute)
        self.calls = 0

    def _eq(self, x, T):
        self.calls += 1
        return equilibrium(self.db, self.comps, self.phases,
                           {v.X(self.solute): x, v.T: T, v.P: 101325, v.N: 1})

    def point(self, x, T):
        e = self._eq(x, T)
        p = np.atleast_1d(e.Phase.values.squeeze())
        n = np.atleast_1d(e.NP.values.squeeze())
        xx = e.X.values.squeeze()
        ci = list(e.component.values).index(self.solute)
        out = {}
        for i in range(p.shape[0]):
            nm = str(p[i])
            if nm in ("", "nan"):
                continue
            f = float(n[i])
            if not np.isfinite(f) or f <= 1e-9:
                continue
            out[nm] = {"f": f, "x": float(xx[i, ci])}
        return out

    def scanT(self, x, ts):
        """one vectorised call over a temperature array -> list of phase dicts"""
        self.calls += 1
        e = equilibrium(self.db, self.comps, self.phases,
                        {v.X(self.solute): x, v.T: ts, v.P: 101325, v.N: 1})
        p = e.Phase.values.squeeze()
        n = e.NP.values.squeeze()
        xx = e.X.values.squeeze()
        ci = list(e.component.values).index(self.solute)
        p = np.atleast_2d(p); n = np.atleast_2d(n)
        if xx.ndim == 2:
            xx = xx[None, :, :]
        out = []
        for ti in range(p.shape[0]):
            d = {}
            for vtx in range(p.shape[1]):
                nm = str(p[ti, vtx])
                if nm in ("", "nan"):
                    continue
                f = float(n[ti, vtx])
                if not np.isfinite(f) or f <= 1e-9:
                    continue
                d[nm] = {"f": f, "x": float(xx[ti, vtx, ci])}
            out.append(d)
        return out

    def liquidus(self, x, tlo, thi, tol=0.15, n1=21, n2=13):
        """(T_liquidus, first-forming solid) at composition x, or (None, None).

        Two vectorised sweeps rather than a point-by-point bisection: the same
        resolution for two equilibrium calls instead of ~25. On Fe-C with 27
        active phases the bisection form did not finish inside ten minutes.
        """
        def bracket(ts):
            rows = self.scanT(x, ts)
            has_solid = [any(not is_liq(k) for k in d) for d in rows]
            idx = [i for i, s in enumerate(has_solid) if s]
            return rows, (max(idx) if idx else None)

        ts = np.linspace(tlo, thi, n1)
        rows, i = bracket(ts)
        if i is None:
            return None, None                      # fully liquid across the range
        if i == len(ts) - 1:
            return None, None                      # solid already at the ceiling
        lo, hi = ts[i], ts[i + 1]

        while hi - lo > tol:
            ts2 = np.linspace(lo, hi, n2)
            rows2, j = bracket(ts2)
            if j is None:
                hi = lo + (hi - lo) * 0.5
                continue
            if j == len(ts2) - 1:
                lo = ts2[j]
                break
            lo, hi = ts2[j], ts2[j + 1]
            rows = rows2

        T = 0.5 * (lo + hi)
        d = self.point(x, lo)                      # just below the liquidus
        solids = {k: vv for k, vv in d.items() if not is_liq(k)}
        if not solids:
            return T, None
        return T, max(solids, key=lambda k: solids[k]["f"])


def run(tdb, base, solute, tmin, tmax, xmax=0.5, nscan=14, xmin=1e-3):
    c = Calc(tdb, base, solute)
    res = {"base": base, "solute": solute, "tdb": tdb,
           "n_phases": len(c.phases),
           "suspended": [f"{n} ({w})" for n, w in c.suspended]}

    # ---- primary: the first solid to form at the dilute end ---------------
    x_dilute = xmin
    T_liq0, primary = c.liquidus(x_dilute, tmin, tmax)
    if primary is None:
        res["status"] = "NO_LIQUIDUS_AT_DILUTE_END"
        res["T_liquidus_dilute"] = T_liq0
        return res
    res["primary"] = primary
    res["T_liquidus_dilute_C"] = float(T_liq0 - 273.15)

    # ---- scan composition for the change of first-forming solid ------------
    xs = np.geomspace(x_dilute * 2, xmax, nscan)
    scan = []
    x_lo, x_hi = x_dilute, None
    T_lo_seen, T_hi_seen = T_liq0, T_liq0
    for x in xs:
        T, ph = c.liquidus(float(x), tmin, tmax)
        scan.append({"x": float(x), "wt": wt_pct(float(x), base, solute),
                     "T_C": None if T is None else float(T - 273.15), "first": ph})
        if ph is None:
            continue
        if ph == primary:
            x_lo, T_lo_seen = float(x), T
        else:
            x_hi, T_hi_seen = float(x), T
            break
    res["scan"] = scan

    if x_hi is None:
        res["status"] = "NO_INVARIANT_IN_RANGE"
        res["note"] = ("the first-forming solid is the primary phase across the "
                       "whole scanned composition range -- isomorphous, or the "
                       "invariant lies beyond xmax")
        return res

    # ---- bisect composition for the changeover ----------------------------
    # The invariant liquidus is bracketed by the two scan points either side of
    # it, so searching the full [tmin, tmax] on every bisection step re-does
    # work already done. Narrowing to a margin around that bracket is what
    # brings a system from ~6 minutes to well under one.
    margin = 40.0
    tw_lo = max(tmin, min(T_lo_seen, T_hi_seen) - margin)
    tw_hi = min(tmax, max(T_lo_seen, T_hi_seen) + margin)
    for _ in range(18):
        xm = 0.5 * (x_lo + x_hi)
        T, ph = c.liquidus(xm, tw_lo, tw_hi)
        if ph is None:                       # fell outside the narrowed window
            T, ph = c.liquidus(xm, tmin, tmax)
        if ph == primary:
            x_lo = xm
        else:
            x_hi = xm
        if x_hi - x_lo < 1e-5:
            break
    C_inv_x = 0.5 * (x_lo + x_hi)
    T_inv, _ = c.liquidus(C_inv_x, tw_lo, tw_hi)
    if T_inv is None:
        T_inv, _ = c.liquidus(C_inv_x, tmin, tmax)
    if T_inv is None:
        res["status"] = "NO_LIQUIDUS_AT_INVARIANT"
        return res

    # ---- SECOND PHASE: the first solid to form just ABOVE the invariant ----
    # This is the phase whose appearance defines the invariant, and it is what
    # the changeover search already found. Reading it from BELOW the invariant
    # instead (the earlier version) returns nothing for a peritectic: in
    # L + b -> a the reacting phase b lives ABOVE the isotherm and is gone
    # below it, which is why Al-Ti, Mg-Zr and Fe-Mo all came back "second: None"
    # with an undecidable type.
    x_above = min(C_inv_x * 1.15, xmax)
    T_above, second = c.liquidus(x_above, tmin, tmax)
    if second == primary:                      # too close to the changeover
        x_above = min(C_inv_x * 1.4, xmax)
        T_above, second = c.liquidus(x_above, tmin, tmax)
    res["second"] = second
    res["x_above_probe"] = x_above

    # ---- TYPE: is the invariant a MINIMUM of the liquidus? -----------------
    # Eutectic: the liquidus descends to T_inv from the base-rich side and
    # climbs again past it -- C_inv is a local minimum. Peritectic: the liquidus
    # passes through C_inv monotonically. This is the textbook distinction and
    # it needs only liquidus values, which are already in hand -- no phase
    # composition ordering, which is what made the previous discriminator fail
    # on Mg-Zn where the second phase sits within 1 wt% of the eutectic liquid.
    x_below = max(C_inv_x * 0.85, x_dilute * 1.01)
    T_below, _ = c.liquidus(x_below, tmin, tmax)
    res["T_below_C"] = None if T_below is None else float(T_below - 273.15)
    res["T_above_C"] = None if T_above is None else float(T_above - 273.15)

    kind = "unknown"
    if T_below is not None and T_above is not None:
        tol = 0.5
        if T_below > T_inv + tol and T_above > T_inv + tol:
            kind = "eutectic"
        elif (T_below < T_inv < T_above) or (T_above < T_inv < T_below):
            kind = "peritectic"
    res["invariant_kind"] = kind

    # ---- C_SM: max solute the PRIMARY phase holds on the invariant isotherm -
    # One vectorised scan along T_inv - eps. C_SM is the richest the primary
    # solid solution ever gets, which is its composition wherever it coexists
    # with another phase on that isotherm. Reading it at a single probe
    # composition is what went wrong before: at exactly C_inv a peritectic
    # primary is SINGLE-PHASE, so its composition is just the overall
    # composition and carries no information about the solubility limit.
    # C_SM is the end of the invariant tie-line on the primary side, so it can
    # be read wherever the primary coexists with ANYTHING on that isotherm --
    # with the second phase just below it, or with the liquid just above it.
    # Scanning only below misses it entirely whenever the two-phase
    # primary+second field is narrow or sits outside the composition window,
    # which is what returned C_SM: null for Al-Zn, Fe-Mn, Fe-Ni, Cu-Zn and
    # Mg-Zr on the previous pass.
    eps = 0.5
    xs_iso = np.geomspace(max(x_dilute, 1e-5), xmax, 16)
    prim_x, coexist = [], 0
    for T_probe in (T_inv - eps, T_inv + eps):
        for xq in xs_iso:
            d = c.point(float(xq), T_probe)
            if primary in d and len(d) >= 2:
                prim_x.append(d[primary]["x"])
                coexist += 1
    C_SM_x = max(prim_x) if prim_x else None
    res["C_SM_coexist_points"] = coexist

    res.update({
        "status": "OK",
        "T_inv_K": float(T_inv), "T_inv_C": float(T_inv - 273.15),
        "C_inv_x": float(C_inv_x), "C_inv_wt": float(wt_pct(C_inv_x, base, solute)),
        "C_SM_x": None if C_SM_x is None else float(C_SM_x),
        "C_SM_wt": None if C_SM_x is None else float(wt_pct(C_SM_x, base, solute)),
        "n_equilibria": c.calls,
    })
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tdb"); ap.add_argument("base"); ap.add_argument("solute")
    ap.add_argument("--tmin", type=float, required=True)
    ap.add_argument("--tmax", type=float, required=True)
    ap.add_argument("--xmax", type=float, default=0.5)
    ap.add_argument("--nscan", type=int, default=14)
    ap.add_argument("--xmin", type=float, default=1e-3)
    a = ap.parse_args()
    print(json.dumps(run(a.tdb, a.base.upper(), a.solute.upper(),
                         a.tmin, a.tmax, a.xmax, a.nscan, a.xmin), indent=2, default=str))


if __name__ == "__main__":
    main()
