# phase-audit — recomputing every row of `src/phasedata.ts`

The [2026 reconciliation](../../docs/PHASE-RECONCILIATION.md) corrects five
interpretations in the original audit. This is an attempted cross-check within
specified database and algorithm scope, not proof that every binary is modeled.
Fe-Si/Mg-Zr coverage failures and duplicate composition sets are now explicit
unsupported results. See `reconcile.py` for full/restricted sensitivity probes
and an independent Fe-Ni common-tangent calculation; `verify_audit.py` checks the
method's data-loss regression without any database download.


This is the tooling behind `docs/PHASE-AUDIT.md`. It recomputes the binary invariant
(type, T_inv, C_inv, C_SM, second phase) for all 25 of the composer's (base, solute)
pairs from openly licensed CALPHAD databases where their scope permits. A failed
or unsupported calculation does not certify the hand-entered row.

**It is not part of `npm test` and it is not in CI.** It needs Python, pycalphad and a
network fetch of four `.tdb` files, none of which a `npm ci` runner has — which is
exactly the reason the *shipped* cross-check (`PD-*` in `scripts/verify-phasedata.mjs`)
is written in browser-free JavaScript instead. This directory is the deeper, slower
audit a human runs when a row changes; the gates are what runs on every commit.

## Running it

```
python -m venv pdaudit
pdaudit/Scripts/pip install pycalphad==0.11.2

# fetch the four databases (NOT vendored -- ODbL 4.4a share-alike attaches to a
# redistributed database, and keeping them out of the tree keeps this repo
# single-licence). URLs are in docs/PHASE-AUDIT.md section 1.
mkdir tdb tdbc
curl -o tdb/mc_al_v2037.tdb https://www.matcalc.at/images/stories/Download/Database/mc_al_v2037.tdb
# ... and mc_fe_v2062, mc_ni_v2036, NIST-solder

python sanitize.py tdb/mc_al_v2037.tdb tdbc/mc_al_v2037.tdb    # and the other three
python runall.py                                               # writes results/*.json
```

Roughly 10 minutes per system on 8 cores, 5 systems concurrently.

## The files

- `sanitize.py` — strips MatCalc vendor commands and parameter types pycalphad cannot
  read, repairs the typographical errors in the published databases by explicit rule,
  and drops anything still unparseable **by name**. Reports everything it removes.
- `phasesel.py` — chooses the phase set: every sublattice must be fillable from the
  active elements, and MatCalc's precipitation-kinetics phases (GP zones, clusters,
  prime/double-prime transition precipitates) are suspended for an equilibrium
  calculation. Leaving them in puts the Al–Si eutectic at 604 °C instead of 577 °C.
- `invariant.py` — the calculation. Locates the invariant as the composition where the
  first-forming solid changes identity, which can locate many eutectics and peritectics but cannot resolve same-identity
  composition-set reactions. Duplicate vertices are refused rather than merged.
- `runall.py` — the 25 systems and their scan windows. **The window is an input**, so a
  window that excludes an invariant reports `NO_INVARIANT_IN_RANGE` rather than
  inventing one.
- `csm_probe.py` — targeted C_SM read for rows whose two-phase window the geometric
  composition ladder steps over.
- `findbad.py` — lists every command a `.tdb` carries that pycalphad's own grammar
  rejects. Normalise whitespace before parsing or it reports hundreds of false
  positives on perfectly good multi-line `FUNCTION` commands.
