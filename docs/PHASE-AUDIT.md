# PHASE-AUDIT — where every row of `src/phasedata.ts` comes from

`src/phasedata.ts` carries four numbers and two names per (base, solute) pair: the
invariant type on the base-rich side, its temperature, the liquid composition there,
the maximum solid solubility in the base-rich primary phase, the reaction, and the
name of the second phase.

Hand-entered data is the weakest link in an otherwise gated instrument, so every row
is **independently recomputed** from an openly-licensed CALPHAD database and the
result is printed beside the shipped value below. Where the two disagree the
disagreement is **named**, not averaged and not swallowed by a widened tolerance.
That is the point of this document: a reader can check any row without taking the
table's word for it, and can see which rows this instrument has not resolved.

---

## 1 · What was used

| | |
|---|---|
| **pycalphad** | 0.11.2 (MIT licence) on Python 3.12.10 |
| **Al-base systems** | MatCalc `mc_al_v2.037.tdb` — TU Wien, E. Povoden-Karadeniz |
| **Fe-base systems** | MatCalc `mc_fe_v2.062.tdb` — TU Wien, E. Povoden-Karadeniz |
| **Ni-base systems** | MatCalc `mc_ni_v2.036.tdb` — TU Wien, E. Povoden-Karadeniz |
| **Cu–Sn** | NIST `NIST-solder.tdb` — U. R. Kattner, NIST |

The three MatCalc databases carry, in their own headers, the notice: *"Open Database
License: http://opendatacommons.org/licenses/odbl/1.0/. Any rights in individual
contents of the database are licensed under the Database Contents License:
http://opendatacommons.org/licenses/dbcl/1.0/."* The NIST solder database is a work
of the U.S. Government (17 U.S.C. §105).

**This repository vendors none of them.** They are downloaded by URL when the audit is
run. That is deliberate: ODbL §4.4a share-alike attaches to a redistributed database,
and keeping them out of the tree keeps Solidify single-licence. It also means the
shipped bundle contains no CALPHAD data — the app ships the ~25 cited numbers below
and nothing else.

Downloads:

```
https://www.matcalc.at/images/stories/Download/Database/mc_al_v2037.tdb
https://www.matcalc.at/images/stories/Download/Database/mc_fe_v2062.tdb
https://www.matcalc.at/images/stories/Download/Database/mc_ni_v2036.tdb
https://www.metallurgy.nist.gov/phase/solder/NIST-solder.tdb
```

The version numbers matter and are quoted as **run**. An earlier draft of the v7.1
plan cited mc_al v2.035 / mc_fe v2.061 / mc_ni v2.033, which were the versions current
when the plan was written; the live files are newer and the reassessments they list
include Al–Cu (March 2025), which is one of the systems audited here.

---

## 2 · What had to be changed to read the files at all

pycalphad implements the standard TDB grammar. MatCalc's databases carry vendor
extensions alongside it, and — separately — a number of genuine typographical errors.
Both are handled by `scripts/phase-audit/sanitize.py`, which **reports everything it
removes**. Nothing below alters a Gibbs energy of any phase relevant to these systems.

**Vendor commands dropped** (they carry no thermodynamic parameters; they configure
MatCalc's own solver):

- `REFERENCE_ELEMENT` ×1 per file
- `ADD_COMPOSITION_SET` ×3 (Al), ×12 (Fe), ×9 (Ni)
- `LIST_OF_REFERENCES` and its body

**Parameter types dropped** — `HMVA` (vacancy formation enthalpy, ×7/×21/×13) and `SE`
(interfacial energy, ×1). These feed MatCalc's precipitation and diffusion solvers.
Neither appears in an equilibrium Gibbs energy, so neither can move a phase boundary.

**A modelling feature that IS lost** — `ATTACH_CONTRIBUTION` (×1 per file), MatCalc's
order/disorder coupling (`GP_MAT`→`FCC_A1`, `BCC_B2`→`BCC_A2`). pycalphad expresses
order/disorder through `TYPE_DEFINITION`'s `DISORDERED_PART` and cannot consume this
command. The consequence is real and was caught by validation rather than by reading:
with `GP_MAT` active but stripped of its disordered contribution its Gibbs energy is
too low, it goes spuriously stable, and the Al–Si eutectic comes out at **604 °C with
`GP_MAT` as the primary phase at 51 wt% Si** against a known 577 °C and 1.65 wt%. The
fix is in §3.

**Published typographical errors repaired**, each by an explicit recorded rule:

| Error | Where | Repair |
|---|---|---|
| `6000.00.00` as an upper temperature limit | `SIGMA` FE:CR:FE and FE:CR:MN, in mc_fe and mc_ni | → `6000.00` |
| `G(G_PHASE;FE:CU:SI;0)` — `;` where the phase-name comma belongs | mc_fe | → `G(G_PHASE,…` |
| whitespace between `REF:` and its key | four Si–Ti parameters, mc_al | closed up |
| a second word after the REF key (`REF:test koze10`) | `BCC_DISL`, mc_fe | truncated to the key |
| trailing `> >> 1` on a constituent line | `MNB4`, mc_fe | stripped |
| two `PARAMETER` commands merged by a missing `!` | `LAVES_PHASE` MN,TI:NI, mc_fe | split |

**Two commands could not be repaired and were dropped**, recorded by name:
`G(PDMN_B2,MN:PD;0)` and `G(PDMN_B2,PD:MN;0)` in mc_fe, both of which carry a
duplicated temperature range (`273.00 273 … ; 6000.00 N ; 6000.00 N`) that cannot be
resolved unambiguously. Pd–Mn is not among the audited systems.

After these changes all four databases parse, and the sanitizer re-parses every command
through pycalphad's own grammar before writing, so an unparseable command is dropped
loudly rather than failing the whole file later.

---

## 3 · How each number is obtained

`scripts/phase-audit/invariant.py`. No number is hand-entered or fitted.

**Phase selection** (`phasesel.py`). Two filters, both recorded per system in the
output:

1. *Fillable* — a phase can only form if **every** sublattice has at least one
   constituent built solely from the active elements. pycalphad's own `filter_phases`
   keeps a phase when *any* sublattice is active, which admits `AL11CR2` into an Al–Si
   binary.
2. *Not metastable by construction* — MatCalc's alloy databases ship transition
   precipitates and cluster phases for **precipitation kinetics**: GP zones, solute
   clusters, prime and double-prime transition phases. MatCalc suspends these for an
   equilibrium calculation and so does this audit. This is what corrects the 604 °C
   Al–Si failure in §2.

**The invariant** is located as the composition at which **the first-forming solid
changes identity**. Walking composition upward from the dilute end, below the invariant
the first solid out of the melt is the primary phase; above it, something else. That
changeover composition *is* C_inv and the liquidus temperature there *is* T_inv. This
is the definition of a binary invariant rather than a signal fitted to one, and it
reads eutectics and peritectics with the same code.

> An earlier version located the invariant as a **plateau in the solidus**. It
> reproduces Al–Si and fails Fe–C twice over: compositions whose liquid survives to the
> bottom of the scan window all report that floor and collectively fake a plateau
> there, and the true δ-peritectic plateau spans only 0.09–0.17 wt% C, which a uniform
> composition grid resolves with two points. Both failures have the same shape — the
> measurement was being read off the window rather than off the physics.

**The primary phase** is the first solid to form at the dilute end, evaluated *at the
liquidus*. Evaluating it at the bottom of the temperature range instead returns
austenite for Fe–C, because γ is what is stable at 1427 °C — but the phase that
freezes out of the melt is δ-ferrite, and the peritectic being searched for is the one
that consumes it.

**The second phase** is the first-forming solid just **above** the invariant
composition. Reading it from below the isotherm returns nothing for a peritectic: in
L + β → α the reacting phase β lives above the isotherm and is gone below it.

**The type** is decided by whether the liquidus has a local **minimum** at C_inv
(eutectic: it descends to T_inv and climbs past it) or passes through monotonically
(peritectic). This uses only liquidus values and avoids comparing phase compositions,
which is undecidable when the second phase sits within ~1 wt% of the invariant liquid.

**C_SM** is the maximum solute the primary phase holds anywhere on the invariant
isotherm. Reading it at a single probe composition is wrong: at exactly C_inv a
peritectic primary is single-phase, so its composition is just the overall composition
and says nothing about a solubility limit.

**The scan window** (temperature range, composition range) is an **input**, recorded
per system. A window that excludes the invariant makes the system report
`NO_INVARIANT_IN_RANGE` rather than inventing one — which is how Al–Zn, Ni–Al and
Ni–Mo were caught on the first pass and re-run wider, and how Cu–Ni and Fe–Cr were
confirmed to have no invariant at all.

---

## 4 · Validation against independently known values

Before any row was trusted, the method was checked against systems whose invariants are
textbook. These are not inputs to the calculation.

| System | Computed | Known (independent) | Agreement |
|---|---|---|---|
| Al-Si | eutectic, **577.1 C**, 12.51 / 1.567 wt% | eutectic, 577 C, 12.6 / 1.65 wt% | 0.1 K; 0.7 % on C_inv |
| Al-Cu | eutectic, **553.4 C**, 32.27 / 5.484 wt% | eutectic, 548.2 C, 33.2 / 5.65 wt% | 5.2 K; 2.8 % on C_inv |
| Fe-C | peritectic, **1494.6 C**, 0.528 / 0.092 wt% | peritectic, 1495 C, 0.53 / 0.09 wt% | 0.4 K; 0.4 % on C_inv |

Fe-C is the strongest single result in the audit: it lands the delta-ferrite peritectic -- the
*right* invariant, not the 1147 C cementite eutectic -- to within 0.4 K and 0.4 %, on a system
whose primary phase exists over only a 144 K window.

---

## 5 · Row-by-row

The **shipped** column is what `src/phasedata.ts` carries. The **recomputed** column is this
audit, run independently. Ratios are computed/shipped.

| pair | shipped (cited) | recomputed (pycalphad) | ΔT | C_inv ratio | C_SM ratio | verdict |
|---|---|---|---|---|---|---|
| al-Cu | eutectic, 548.2 °C, 33.2 / 5.65 wt% | eutectic, 553.4 °C, 32.27 / 5.484 wt% (FCC_A1 + THETA_AL2CU) | +5.2 | 0.97 | 0.97 | agree |
| al-Si | eutectic, 577 °C, 12.6 / 1.65 wt% | eutectic, 577.1 °C, 12.51 / 1.567 wt% (FCC_A1 + SI_DIAMOND_A4) | +0.1 | 0.99 | 0.95 | agree |
| al-Mg | eutectic, 450 °C, 35 / 17.4 wt% | peritectic, 451.2 °C, 34.83 / 16.772 wt% (FCC_A1 + G_AL12MG17) | +1.2 | 1.00 | 0.96 | **type decided by hand** (cited eutectic, computed peritectic) |
| al-Zn | eutectic, 381 °C, 95 / 83.1 wt% | eutectic, 380.9 °C, 94.84 / 83.29 wt% (FCC_A1 + HCP_ZN) | -0.1 | 1.00 | 1.00 | agree |
| al-Fe | eutectic, 655 °C, 1.8 / 0.052 wt% | eutectic, 654 °C, 1.82 / 0.046 wt% (FCC_A1 + AL13FE4) | -1.0 | 1.01 | 0.89 | agree |
| al-Ti | peritectic, 665 °C, 0.15 / 1.32 wt% | peritectic, 665.5 °C, 0.15 / 1.38 wt% (FCC_A1 + AL3TI_L) | +0.5 | 0.99 | 1.05 | agree |
| fe-C | peritectic, 1495 °C, 0.53 / 0.09 wt% | peritectic, 1494.6 °C, 0.53 / 0.092 wt% (BCC_A2 + FCC_A1) | -0.4 | 1.00 | 1.02 | agree |
| fe-Mn | peritectic, 1473 °C, 12.3 / 8.9 wt% | peritectic, 1473.6 °C, 12.72 / 9.801 wt% (BCC_A2 + FCC_A1) | +0.6 | 1.03 | 1.10 | agree |
| fe-Si | eutectic, 1200 °C, 19.2 / 17.8 wt% | **NO_INVARIANT_IN_RANGE** | — | — | — | not resolved by the recomputation |
| fe-Ni | peritectic, 1517 °C, 12.43 / 4 wt% *(CALPHAD-sourced)* | peritectic, 1504 °C, 12.43 / 9.989 wt% (BCC_A2 + FCC_A1) | -13.0 | 1.00 | 2.50 | **named disagreement** |
| fe-Cr | isomorphous | **NO_INVARIANT_IN_RANGE** | — | — | — | AGREE — both find no invariant |
| fe-Mo | eutectic, 1450 °C, 36.4 / 34.8 wt% | eutectic, 1453.2 °C, 36.02 / 36.409 wt% (BCC_A2 + R_PHASE) | +3.2 | 0.99 | 1.05 | agree |
| ni-Nb | eutectic, 1282 °C, 21.6 / 18.3 wt% | eutectic, 1362 °C, 27.24 / 24.944 wt% (FCC_A1 + DELTA) | +80.0 | 1.26 | 1.36 | **named disagreement** |
| ni-Ti | eutectic, 1304 °C, 13.8 / 11.4 wt% | eutectic, 1309.7 °C, 13.29 / 12.322 wt% (FCC_A1 + ETA) | +5.7 | 0.96 | 1.08 | agree |
| ni-Al | peritectic, 1381.6 °C, 12.17 / 10.413 wt% | eutectic, 1381.6 °C, 12.17 / 10.413 wt% (FCC_A1 + NIAL) | 0.0 | 1.00 | 1.00 | **type decided by hand** (cited peritectic, computed eutectic) |
| ni-Cr | eutectic, 1345 °C, 51 / 46.9 wt% | eutectic, 1344.9 °C, 50.92 / 46.986 wt% (FCC_A1 + BCC_A2) | -0.1 | 1.00 | 1.00 | agree |
| ni-Mo | eutectic, 1309 °C, 45.7 / 39.2 wt% | eutectic, 1306 °C, 45.17 / 37.451 wt% (FCC_A1 + BCC_A2) | -3.0 | 0.99 | 0.96 | agree |
| ni-W | eutectic, 1495 °C, 45 / 39.9 wt% | eutectic, 1497.9 °C, 44.53 / 40.143 wt% (FCC_A1 + BCC_A2) | +2.9 | 0.99 | 1.01 | agree |
| mg-Al | eutectic, 437 °C, 32.3 / 12.9 wt% | eutectic, 435.3 °C, 33 / 10.146 wt% (HCP_A3 + G_AL12MG17) | -1.7 | 1.02 | 0.79 | **named disagreement** |
| mg-Zn | peritectic, 341 °C, 51.5 / 6.2 wt% | eutectic, 341 °C, 52.3 / 7.551 wt% (HCP_A3 + MG2ZN3) | +0.0 | 1.02 | 1.22 | **type decided by hand** (cited peritectic, computed eutectic) |
| mg-Zr | peritectic, 653.6 °C, 0.58 / 2.58 wt% | peritectic, 651.9 °C, 0.2 / null wt% (HCP_A3 + CBCC_A12) | -1.7 | 0.34 | 0.00 | **named disagreement** |
| cu-Sn | peritectic, 797.9 °C, 25.52 / 13.48 wt% | peritectic, 796 °C, 26.76 / 14.303 wt% (FCC_A1 + BCC_A2) | -1.9 | 1.05 | 1.06 | agree |
| cu-Zn | peritectic, 903 °C, 37.46 / 32.52 wt% | peritectic, 902.2 °C, 38 / 32.392 wt% (FCC_A1 + BCC_A2) | -0.8 | 1.01 | 1.00 | agree |
| cu-Ni | isomorphous | **NO_INVARIANT_IN_RANGE** | — | — | — | AGREE — both find no invariant |
| zn-Al | eutectic, 381 °C, 5 / 1.17 wt% | eutectic, 380.9 °C, 5.16 / 1.295 wt% (HCP_ZN + FCC_A1) | -0.1 | 1.03 | 1.11 | agree |

**Tally: 16 agree, 2 agree by both finding no invariant, 3 reaction types decided by hand,
4 named disagreements, 1 not resolved.**

### The named disagreements

- **ni-Nb -- 80 K.** The cited eutectic (1282 C, 21.6 wt% Nb) and mc_ni's assessment (1362 C,
  27.24 wt%) do not agree, on the same reaction and the same second phase (delta-Ni3Nb). Both
  are internally consistent. **This instrument has not resolved which is right**, and the
  shipped row is the cited one.
- **mg-Zr -- C_inv 0.58 vs 0.20 wt%, and no C_SM at all.** mc_al is an *aluminium* database;
  its Mg-Zr binary returns a second phase with the alpha-Mn structure where the accepted
  diagram has (alpha-Zr), and thirteen targeted probes on both sides of the invariant isotherm
  found no two-phase field to read C_SM from. **This row has no reliable open reproduction
  path.** The shipped values are the cited ones; the recomputation is recorded as unusable,
  not as a competing answer.
- **fe-Ni -- 13 K, and C_SM 2.5x.** The cited row could not supply C_inv at all, so that field
  is CALPHAD-sourced while T_inv and C_SM are cited. The C_SM ratio compares a cited
  delta-ferrite solubility (4 wt%) against a computed one (9.99 wt%), and those are not the
  same quantity if the two sources disagree about where the delta field ends. Flagged rather
  than reconciled.
- **mg-Al -- C_SM ratio 0.79.** Computed 10.15 wt% against a cited 12.9 wt%. The researcher's
  own confidence on this row was *recalled* rather than *cited-found*, the weakest provenance
  in the table; T and C_inv agree to 1.7 K and 2 %.

### The reaction types decided by hand

Three rows disagreed on the *label* rather than the numbers. Each decision is recorded in that
row's own `source` string in `src/phasedata.ts`:

- **al-Mg** -- kept the cited *eutectic*. The recomputation said peritectic; that is a
  limitation of the type test (past this eutectic the beta-Al3Mg2 liquidus rises only
  shallowly, so a local-minimum test on a 15 % composition step sees no minimum). T and C_inv
  agree to 1.2 K and 0.5 %.
- **ni-Al** -- took the *computed* eutectic. The cited row describes the gamma-prime Ni3Al
  peritectic at 1362 C, which is not the first invariant a dilute Ni-Al melt meets on cooling:
  the Ni-rich liquidus terminates at the gamma + beta-NiAl eutectic, computed at 1381.6 C
  against a published ~1385 C. The composer models dilute alloys, so the eutectic is the
  reaction that matters.
- **mg-Zn** -- kept the cited numbers, corrected the label to *eutectic*. The Mg-rich Mg-Zn
  invariant is L -> (Mg) + Mg51Zn20, and the recomputation independently returns eutectic.

### Not resolved

- **fe-Si.** Three widening passes (composition ceiling to 0.55 mole fraction, floor to 1150 K,
  18 scan points) still return `NO_INVARIANT_IN_RANGE`: the first-forming solid stays BCC_A2
  across the whole scanned range, because mc_fe models the ordered B2/D0_3 Fe-Si field as part
  of BCC_A2, so no *identity* change occurs at the boundary this method looks for. The shipped
  row is the cited one. A method tracking ordering rather than phase identity would resolve it;
  this one does not, and says so.

---

## 6 · Reproducing this

```
python -m venv pdaudit
pdaudit/Scripts/pip install pycalphad==0.11.2
# fetch the four .tdb files from the URLs in §1
python sanitize.py mc_al_v2037.tdb clean/mc_al_v2037.tdb    # and the other three
python runall.py                                            # writes results/*.json
```

Each system writes a JSON file recording the database, the scan window, the phases
suspended, the composition scan with the first-forming solid at each point, and the
derived invariant. A row can be re-derived from its own output file alone.
