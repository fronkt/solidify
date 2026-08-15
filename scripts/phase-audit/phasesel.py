"""Choose the phase set for a binary equilibrium calculation, and say why.

Two filters, both recorded in the output so the audit states what was included
rather than implying "the database decided".

1. FILLABLE. A phase can only form if EVERY sublattice has at least one
   constituent built solely from the active elements. pycalphad's own
   filter_phases keeps a phase when ANY sublattice is active, which lets
   AL11CR2 into an Al-Si binary; that is too permissive for this job.

2. NOT METASTABLE-BY-CONSTRUCTION. MatCalc's alloy databases ship transition
   precipitates and cluster phases for PRECIPITATION KINETICS -- GP zones,
   clusters, prime and double-prime transition phases. They are not equilibrium
   phases and MatCalc suspends them for an equilibrium calculation. Two of them
   (GP_MAT, BCC_B2) additionally lose their order/disorder contribution when
   ATTACH_CONTRIBUTION is dropped, which makes them spuriously STABLE: with
   GP_MAT active the Al-Si eutectic comes out at 604 C against a known 577 C,
   with GP_MAT as the primary phase at 51 wt% Si. Excluding them is what makes
   the calculation an equilibrium calculation.
"""
import re

# Suspended for equilibrium. Each entry is a rule, not a hand-picked answer.
METASTABLE_RULES = [
    (r"^GP_", "GP zone (precipitation-kinetics phase)"),
    (r"_GP$", "GP zone (precipitation-kinetics phase)"),
    (r"^CL_", "solute cluster (precipitation-kinetics phase)"),
    (r"_DP$", "double-prime transition precipitate"),
    (r"^PRE_", "pre-precipitate (kinetics phase)"),
    (r"^TH_DP_", "double-prime/GPB transition precipitate"),
    (r"_PRIME$", "prime transition precipitate"),
    (r"^THETA_PRIME$", "theta-prime transition precipitate"),
    (r"_ZP$", "zeta-prime transition precipitate"),
    (r"_G_P$", "gamma-prime transition precipitate"),
    (r"^B_PRIME_", "beta-prime transition precipitate"),
    (r"^MGSI_B_P$", "beta-prime Mg-Si transition precipitate"),
    (r"^GP_MAT$", "GP zone; also loses its FCC_A1 order/disorder contribution"),
    (r"^BCC_B2$", "ordered B2; loses its BCC_A2 order/disorder contribution"),
]


def is_metastable(name):
    for pat, why in METASTABLE_RULES:
        if re.search(pat, name):
            return why
    return None


def species_elements(sp):
    """elements a Species is built from"""
    try:
        return set(sp.constituents.keys())
    except AttributeError:
        return {str(sp)}


def fillable(dbf, phase_name, active):
    """every sublattice must have >=1 constituent made only of active elements"""
    ph = dbf.phases[phase_name]
    for sub in ph.constituents:
        ok = False
        for sp in sub:
            els = species_elements(sp)
            if els <= active:
                ok = True
                break
        if not ok:
            return False
    return True


def select(dbf, base, solute, verbose=False):
    active = {base, solute, "VA", "/-"}
    keep, dropped_fill, dropped_meta = [], [], []
    for name in dbf.phases:
        if "GAS" in name.upper():
            continue
        if not fillable(dbf, name, active):
            dropped_fill.append(name)
            continue
        why = is_metastable(name)
        if why:
            dropped_meta.append((name, why))
            continue
        keep.append(name)
    return sorted(keep), sorted(dropped_meta), sorted(dropped_fill)


if __name__ == "__main__":
    import sys, warnings
    warnings.filterwarnings("ignore")
    from pycalphad import Database
    db = Database(sys.argv[1])
    base, sol = sys.argv[2].upper(), sys.argv[3].upper()
    keep, meta, fill = select(db, base, sol)
    print(f"{base}-{sol}: {len(keep)} active phases")
    print("  active:    ", ", ".join(keep))
    if meta:
        print("  suspended: " + ", ".join(f"{n} ({w})" for n, w in meta))
