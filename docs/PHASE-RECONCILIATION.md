# Phase data reconciliation, 2026-10-29

This review supersedes the five affected rows and their interpretation in the
original [phase audit](PHASE-AUDIT.md). Table version **1.2.0** retains 25 binary
records: two isomorphous, 21 complete invariant tuples, and two incomplete
invariants. A database disagreement is evidence to investigate, not a reason to
combine endpoints from different assessments or call every result equally valid.
The solver still evolves one solute and one solid. This review does not add any
second-phase physics or certify its dilute coefficients as a full phase diagram.

| Pair | Decision | Remaining limit |
|---|---|---|
| Ni-Nb | Retain 1282 C / liquid 21.6 / solid 18.3 wt% Nb | MatCalc differs by 80 K; not explained by units or phase filtering |
| Mg-Zr | Retain liquid 0.58 wt% Zr; use its source's 654 C; withdraw solid 2.58 wt% | Unknown Mg-rich solid endpoint; diagram and equilibrium phase claim refused |
| Fe-Ni | One coherent peritectic: 1517.25 C, liquid 5.15 / delta 4.02 / gamma 4.54 wt% Ni | Published assessed tuples differ; no mixed-assessment endpoints |
| Mg-Al | Retain 437 C / liquid approximately 32.3 / solid 12.9 wt% Al | Liquid endpoint remains approximate; MatCalc solid endpoint is lower |
| Fe-Si | First liquid reaction is peritectic at 1286 C; withdraw later-eutectic endpoints | First-peritectic endpoints unknown; diagram and equilibrium phase claim refused |

## Ni-Nb: a reproduced database disagreement

The shipped 1282 C tuple comes from the printed diagram in Okamoto's 1998
evaluation, after Bolcavage and Kattner 1996. Independent experimental support is
[Chen et al., *Experimental investigation of the Nb-Ni phase diagram* (2005)](https://doi.org/10.1007/s10853-005-4553-4):
their DTA result for the Ni-rich eutectic is 1285 +/- 2 C. The
[authors' university record](https://ucrisportal.univie.ac.at/en/publications/experimental-investigation-of-the-nb-ni-phase-diagram/)
also exposes this result. This supports retaining the cited near-1282 C reaction,
without pretending the 1996 assessed compositions are directly measured in 2005.

The sanitized mc_ni v2.036 calculation was independently repeated with the full
selected phase set and with only LIQUID/FCC_A1/DELTA. Both give the same topology
and disagree with the cited temperature. At 1282 C and x_Nb = 0.148, this database
returns single FCC_A1 rather than liquid at the cited eutectic. Near 1362 C the
liquid/FCC/DELTA transition is reproduced. Atomic-to-weight conversion and the
phase filter therefore do not explain the 80 K difference. The original audit's
phrase "both defensible" was unsupported and is withdrawn. Which database
parameters cause the discrepancy remains unresolved; the precipitation-oriented
database is not a replacement for the directly cited binary assessment here.

## Mg-Zr: a known liquid endpoint is not a known solid endpoint

[Schaum and Burnett, NBS RP2352 (1952)](https://nvlpubs.nist.gov/nistpubs/jres/049/3/V49.N03.A04.pdf),
text and Figure 7, place the peritectic at 654 C beginning at 0.58 wt% Zr. The
previous 2.58 wt% Mg-rich solid endpoint could not be traced to this paper. Figure
7 does not justify that value; no replacement is digitized without a stated
uncertainty. Other assessments differ, and their endpoints cannot be combined
with the 1952 liquid composition as if they formed one measured tuple.

Two audit failures compound that missing source. The full mc_al v2.037 model
activates CBCC_A12, a manganese-structure solution, as the competing phase. Its
Mg-Zr stability is not validated by the cited binary experiment. A sensitivity
probe limited to LIQUID/HCP_A3/BCC_A2 instead returns two distinct HCP_A3
composition sets. The original `invariant.py` dictionary keyed by phase name
silently overwrote one set. Its first-solid-identity algorithm also cannot locate
a reaction between two composition sets that share an identity. It now refuses
such results explicitly instead of returning an invariant from lost data.

`Csm` is therefore null with a source-specific reason. The liquid boundary still
provides the conservative 0.57 wt% solver maximum. Neither the diagram nor the
equilibrium phase list invents a claim from the unknown solid endpoint.

## Fe-Ni: use all endpoints from one primary table

[Luo et al., *A simple model for lamellar peritectic coupled growth with peritectic reaction*
(2007), Table 1](https://www.sciengine.com/doi/pdfView/0789140d120747d0ae9b5f7efe55fce2),
[DOI 10.1007/s11433-007-0042-x](https://doi.org/10.1007/s11433-007-0042-x),
provides Tp = 1790.4 K and Ni atomic fractions delta 0.0383, gamma 0.0433, liquid
0.0491. These are the paper's physical/material parameters, not a new equilibrium
measurement made by Solidify. Its source tuple is internally consistent and is
used whole. The primary publisher's indexed Table 1 is readable; direct PDF
downloads can return an anti-bot response, so an HTML error is not treated as a
downloaded paper.

Using Fe 55.845 and Ni 58.6934 g/mol,

```
wt% Ni = 100 x_Ni M_Ni / (x_Ni M_Ni + (1 - x_Ni) M_Fe)
delta 4.017502689, gamma 4.540825071, liquid 5.147545467 wt% Ni
T = 1790.4 - 273.15 = 1517.25 C
```

The shipped concentrations round together to 0.01 wt%. Their ordering is
delta 4.02 < gamma 4.54 < liquid 5.15. The product composition is now known within
this cited parameter set, and the solver ceiling becomes 5.10 wt% Ni. A mixture
of literature T/delta and MatCalc liquid 12.426 wt%, as previously shipped,
described neither assessment and is removed.

An independent common-tangent solution of the unchanged mc_fe v2.062 Gibbs
models gives **1503.917908 C**, liquid 12.429287, delta 10.070393, gamma 11.194575
wt% Ni. It solves equality of both component chemical potentials among LIQUID,
BCC_A2 and FCC_A1; residuals are below 1e-7 kJ/mol. This verifies the database's
different tuple without validating its experimental accuracy. The old audit's
9.989 wt% delta was a finite-temperature/coarse-probe estimate rather than an
exact invariant endpoint. No averaging or cross-assessment mixing is used.

## Mg-Al: distinguish the weak field from the directly sourced fields

[Nie, *Precipitation and Hardening in Magnesium Alloys* (2012)](https://doi.org/10.1007/s11661-012-1217-2),
Section II.A, explicitly gives 710 K (437 C) and maximum Al solubility 11.8 at%
(12.9 wt%) at that temperature. These two fields are directly sourced; calling
the whole tuple "recalled" obscured this. The liquid endpoint 32.3 wt% remains an
approximate handbook-derived value, and the row continues to say so.

Both full and LIQUID/HCP_A3/G_AL12MG17 restricted mc_al equilibria reproduce the
lower solid endpoint: about 10.15 wt% at the database's 435.3 C invariant and
about 10.08 wt% at 437 C. Neither atomic/weight coordinates nor accidental
inclusion of another compound accounts for it. The published 12.9 wt% is retained
with the assessment difference stated. It is not silently replaced merely to
agree with the open database.

## Fe-Si: the later eutectic was the wrong reaction

[Bernhard et al., *A Hybrid Update of the Fe-Si System by DSC, Thermodynamic Modeling and
Statistical Learning from Ladle Refining Data of Electrical Steels* (2025)](https://doi.org/10.1007/s11663-024-03419-1),
Figure 9 and Table VIII, show the earlier **bcc_A2 + liquid -> bcc_B2 peritectic
at 1286 C**. The later liquid -> bcc_B2 + Fe2Si eutectic is 1194 C in this work
(Table IX); its listed compositions are not first-peritectic endpoints.
The [authors' institute copy](https://www.k1-met.com/fileadmin/user_upload/Publications/Journal_articles_open_access/Bernhard_et_al__2025__FeSi_system_ladle_refining_data_MetMatTrB_56_2249-2276.pdf)
is also accessible. The previous approximately 1200 C/19.2/17.8 wt% row described
that later reaction and cannot delimit the base-rich primary branch.

The earlier peritectic's composition endpoints are not tabulated in the accessed
source. They remain null, with an explicit refusal. The 5 wt% dilute Si cap is
retained as an instrument limit, not relabeled a measured phase boundary. Direct
API requests beyond that dilute scope are refused as well as bounded by the UI. The
source's peritectic-region specimen at x_Si = 0.2202 is about 12.5 wt% Si, beyond
that cap, but it does not supply all invariant endpoints.

The original mc_fe check cannot adjudicate this topology: v2.062 contains no
FE2SI, FESI or FE5SI3 phases, and its BCC_B2 model loses an attached order/disorder
contribution during sanitization and is suspended. A no-invariant result from
that phase set is a coverage failure. The earlier explanation that ordering
simply remained inside an adequately modeled BCC phase is withdrawn.

## Reproduction and acceptance

Environment used: Python 3.12, pycalphad 0.11.2, NumPy, SciPy and SymPy. PDFs were
read with PyMuPDF. No TDB or paper is redistributed. Exact original-download
SHA-256 hashes:

| Database | SHA-256 |
|---|---|
| mc_al_v2037.tdb | `87ec595f2caae189227ed11d5598c899b436b866ccfefea91304ca57188817c4` |
| mc_fe_v2062.tdb | `aa02077eac3f602dd7479cbeafb09b450e282716752b3ae2b1fc3a57d9c64865` |
| mc_ni_v2036.tdb | `84ba813156e1f7d8bde495d74420319afec03572b981f6b56103807f305313ab` |

Fetch and sanitize the named originals as described in
[the audit README](../scripts/phase-audit/README.md), then run:

```
python scripts/phase-audit/verify_audit.py
python scripts/phase-audit/reconcile.py path/to/tdbc verify-out/phase-reconcile/reproduced
```

The latter writes all vertices for five full/restricted equilibrium probes plus
the independent Fe-Ni common tangent. Restricted probes test sensitivity; they
do not authorize deleting inconvenient stable phases to fit a target. The audit
reports `UNSUPPORTED_DATABASE_MODEL` for the known Fe-Si/Mg-Zr model failures and
`UNSUPPORTED_MULTIPLE_COMPOSITION_SETS` for phase-name collisions.

Browser-free acceptance retains the existing gate names. It independently
converts the Fe-Ni primary atomic-fraction tuple, checks its product ordering and
six binding solver caps, requires the two named incomplete rows to refuse phase
claims at several compositions, and requires exactly those two plus the existing
Ni-W geometric refusal to decline a diagram. These checks do not certify the
unknown endpoints or the full multicomponent phase equilibria.
