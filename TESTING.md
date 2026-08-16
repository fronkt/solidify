# Testing

```bash
npm test
```

runs the headless verification suite: starts `vite` on port 5199, then drives each script in
`scripts/verify-*.mjs` against a real WebGPU browser via `puppeteer-core`, and tears the server
down afterward (`scripts/run-tests.mjs`).

**`verify-3d.mjs` is part of that suite as of v5.0.** It was previously run by hand, and — more
importantly — it printed `FAIL` on a failing check but always exited `0`, so its twenty-three
assertions could not break a build. Every check now routes its failure through a counter that
sets the exit code, and page errors count as failures too.

**`verify-heattreat.mjs` and `verify-heattreat-gpu.mjs` joined `npm test` in v6.0** for the
same reason: a gate that no build runs is not a gate (the U0 lesson, which this repo has now
paid for twice), and joining the suite is what found the GPU gate's own flaky assertions
within two runs. `K_MC`'s drift is re-measured on every suite run, so a change to the Potts
pass fails the build rather than quietly shipping a wrong sweep budget.

**Three more browser-free members joined in v6.1** — `verify-thermal.mjs`, `verify-fade.mjs`
and `verify-porosity.mjs`, the arithmetic halves of the lab's cooling-curve analysis, refiner
fade and Sievert gas porosity — bringing the CI-runnable set to five at the time (v7.0's
`verify-rng.mjs` and `verify-experiment.mjs` have since made it seven, v7.1 P0's
`verify-phasedata.mjs` eight, v7.1 P1's `verify-alloy.mjs` nine, v7.1 P2's
`verify-phasediagram.mjs` ten, v7.1 P3's `verify-regimes.mjs` eleven and v7.1 P4's
`verify-elements.mjs` twelve). They run first in the
suite for the same reason the first two do: they are instant, and a failure there means the
GPU half is not worth starting.

**v7.0 C1 added the comparator layer's pair** — `verify-experiment.mjs` (browser-free, in CI)
proves the bench's doctrine on fake casts and holds the extracted power-law fit bit-for-bit
against a verbatim copy of the inline code it replaced; `verify-experiment-gpu.mjs` runs the
real casts, anchored on the KR-1998 tip velocity — a constant the v7 arc does not touch,
deliberately not `K_MC`, which the pinning and recrystallization milestones are designed to
move.

**Requirements**: a WebGPU-capable Chrome/Chromium at the path hardcoded in each verify script
(`C:\Program Files\Google\Chrome\Application\chrome.exe`) — Windows with a real GPU, or the
`--use-angle=swiftshader` software-rendering path the scripts themselves fall back to for
GPU-less environments. **This is not portable to a generic hosted CI runner as-is** — the
executable path and WebGPU/ANGLE availability are both host-specific, which is why CI gates
only the OS-agnostic steps — typecheck, build, and the twelve browser-free scripts
(`verify-units.mjs`, `verify-rng.mjs`, `verify-heattreat.mjs`, `verify-thermal.mjs`,
`verify-fade.mjs`, `verify-porosity.mjs`, `verify-experiment.mjs`, `verify-phasedata.mjs`,
`verify-alloy.mjs`, `verify-phasediagram.mjs`, `verify-regimes.mjs`, `verify-elements.mjs`; see
`.github/workflows/ci.yml`) — rather than
this suite. If you want to run the physics/UI verification yourself, do it locally.

## What each script checks

- **`verify-rng.mjs`** (v7.0, C0a) — the seeded-stream contract, browser-free in the
  `verify-units.mjs` style. Seven checks. `RNG-DETERMINISM` (same seed, same sequence; `reset()`
  is a true rewind; every draw in `[0,1)`, which the site placers assume when they multiply by
  `n`). `RNG-STREAM-INDEPENDENCE` (two names must not alias, and draining one must not advance
  another — this is what lets the optimizer search beside a cast without moving it).
  `RNG-NAME-DERIVATION` — the future-proofing one: it registers two stream names that do not
  exist yet (`convection`, `recrystallization`) and requires `sim2d`'s next 16 draws to be
  byte-identical. Streams are derived by hashing the name into the seed rather than by splitting
  a counter precisely so that D3 and C3 can each take a stream without renumbering everybody and
  silently moving every measured constant in the suite. `RNG-REDERIVE-IN-PLACE` holds a cached
  stream across a `setSeed` and requires it to follow the new seed — consumers cache their stream
  in a field, so a `setSeed` that swapped the registry entry instead of mutating in place would
  be a seed control that visibly does nothing (caught in review, gated so it cannot return).
  `RNG-DERIVED-DRAWS` (int/sign/gauss moments over 20 000 draws, 4-sigma bands).
  `RNG-SEED-ROUNDTRIP` (the eight hex digits the UI prints and the link packs, round-tripped).
  `RNG-NUCLEATION` stages an 800-site charge twice and requires the fired list to be identical —
  it lives here rather than in the GPU gate because nucleation only fires on frame-loop stats
  arrivals, so a `stepSync`-driven cast never exercises it at all.
- **`verify-heattreat.mjs`** — the arithmetic half of v6.0 heat treatment, browser-free in the
  `verify-units.mjs` style (vite middleware + `ssrLoadModule`, so it loads `src/heattreat.ts`
  rather than re-implementing it — a test that re-implements the thing it is testing proves
  nothing). The Arrhenius integrals, the closed-form laws, every refusal path, the domain
  limit, the shipped twin matrix and the incipient-melting catch — and the second suite member
  GitHub CI can actually run. `HT-DEMO` prints the headline numbers (a 1 h anneal takes steel
  12 → ~296 µm) rather than asserting them, so a regression stays visible in the log.
  `HT-VERDICT` (v6.1, L4) gates the MPa formatter's three bands and the printed-precision
  doctrine itself — a spec missed by less than the display's own rounding must judge as met —
  which became gateable here when `fmtMPa`/`shownMPa` moved into pure `heattreat.ts` so the
  furnace card and the lab card share one verdict.
- **`verify-thermal.mjs`** (browser-free, v6.1) — the cooling-curve analysis against synthetic
  curves with prescribed landmarks: recovery clean and at the readback's real noise, the
  20 Hz→4 Hz resampling identity that fails an index-based derivative, "no arrest" honestly
  reported on a monotonic quench, derived f_s vs prescribed, and `retain()`'s span-preserving
  decimation — the check that gates the old head-dropping `splice` bug directly. `TA-CSC`
  (v6.2) adds the Clyne–Davies hot-tearing ratio: exact on prescribed crossings, ordered
  under a longer vulnerable stage, and refusing with a note on both arms (a record that never
  reaches f_s 0.99, and one that never reaches 0.40).
- **`verify-fade.mjs`** (browser-free, v6.1) — refiner fade: identity at zero hold (nothing
  shipped moves), the incubation shoulder a decay-from-t0 model cannot produce, monotone
  non-increase, the residual floor, and <½ surviving 30 min per the settling data.
- **`verify-porosity.mjs`** (browser-free, v6.1) — Sievert's law: C = h_L·√p (the air/argon
  ratio is √(p₁/p₂), not p₁/p₂), the rejected fraction, the atmosphere ordering with vacuum
  exactly zero, refusal by name for materials without hydrogen data, and the Ransley–Neufeld
  numbers as a drift tripwire.
- **`verify-experiment.mjs`** (browser-free, v7.0 C1) — the comparator layer's doctrine, on
  fake casts. Eight checks. `EXP-FIT-EXACT` / `EXP-FIT-INADMISSIBLE` (a synthetic exact law
  comes back out; a ladder below its own d₀ has no admissible K > 0 fit and must answer null,
  not least-bad). `EXP-FIT-PARITY` — the extracted fit against a VERBATIM copy of the four-way
  inlined code it replaced, `Object.is`-exact on both an exact and a jittered ladder, with a
  finiteness clause because `Object.is(NaN, NaN)` is true and two broken fits would otherwise
  "agree". `EXP-BAND` (a replicate band is the range, not a σ dressed up at N = 2).
  `EXP-DECLARED` (a sweep missing its swept name, its controlled variable, its tolerance, its
  values or its seeds throws — an undeclared comparison is a programmer error, and the fully
  declared twin runs). `EXP-REFUSE-UNMATCHED` / `EXP-REFUSE-DEAD` (arms whose achieved
  controlled variable disagrees beyond the stated tolerance, or a NaN measurement, refuse to
  render — no means, no band geometry, the refusal naming the variable, the spread and the
  offending run). `EXP-RENDERED` (a rendered comparison carries the controlled variable by
  name, every seed, and means the check recomputes independently of the formatter under test).
- **`verify-phasedata.mjs`** (browser-free, v7.1 P0) — the binary invariant table. Seven
  checks, all about totality and both polarities rather than about whether any one number is
  right (a number's correctness is the audit's job — `docs/PHASE-AUDIT.md` recomputes every
  row from an open CALPHAD database). `PD-ROW-SOURCED` requires every row to carry a source
  over 30 characters AND the set of sources to hold at least five distinct strings, so one
  blanket citation pasted 25 times fails. `PD-SECOND-PHASE-POLARITY` requires a row with an
  invariant to NAME its second phase and its reaction, and an isomorphous row to leave both
  empty with null numbers — both directions asserted, and both branches asserted non-empty so
  a table with no isomorphous systems cannot pass vacuously. `PD-TABLE-BIJECTION` holds
  `BASES` and `BINARY` in step in both directions, so neither table can drift ahead of the
  other. `PD-ORDERING` requires each row to obey its own reaction's geometry (for a base-rich
  eutectic, C_SM < C_inv — a row that violates it was transcribed from the wrong side of the
  diagram, the likeliest hand-entry error and one no amount of sourcing would catch), and
  requires at least one eutectic and one peritectic to be present. `PD-SOLUTE-SOURCED` does
  the same distinct-set check on `alloy.ts`'s 25 coefficient rows. `PD-SLOPE-CONSISTENT`
  (v7.1 P2) requires each row to describe a diagram that can be DRAWN: a liquidus that rises
  from the pure base means the first solid is richer in solute than the liquid (k > 1), which at
  the invariant means C_SM > C_inv — otherwise the solidus reaches the invariant at a smaller
  composition, rises faster, and ends up above the liquidus, which is not a phase diagram.
  `ni-W` is the single shipped violation (invariant 1495 °C over nickel's 1455, but C_SM 39.9 <
  C_inv 45) and it is carried BY NAME rather than repaired, because which of the three numbers
  is wrong has not been resolved; the exception list is itself the assertion, so a new
  inconsistent row fails and so does ni-W quietly becoming consistent. Liveness: at least two
  rows must have rising invariants, or the branch is never exercised.
  `PD-PRODUCT-SOURCED` (v7.1 P3) polices the `Csecond` field — the peritectic PRODUCT's own
  composition, which decides whether the phase this solver grows survives its own reaction.
  It is carried only on the peritectic rows whose base solid is a REACTANT, the ordering
  C_SM < C_second < C_inv is required (violate it and the row is not describing the reaction it
  claims), and **every value must appear in its own row's `second`/`source` prose** — the field
  was transcribed from that sentence, so tying it back to it is what makes it a citation rather
  than a number somebody typed. Fe–Ni carries `null` because its literature value is a
  4.2–4.7 wt% bracket rather than a number, and that null is asserted to be explained in the
  row's own source. Both polarities: at least three rows carry the field and at least one
  declines it, so "populate everything" and "populate nothing" both fail.
- **`verify-alloy.mjs`** (browser-free, v7.1 P1) — the composer's chemistry and the
  calibration it now feeds. Ten checks. `ALLOY-SUMS-EXACT` recomputes the superposition's own
  algebra inside the gate from `BASES` — ΔT_L = Σm·c, Q = Σm·c(k−1), the base-inclusive
  wt%↔at% mole balance with `molBase` asserted strictly positive (`derive()` had no guard and
  goes negative past 100 wt% total) — over 34 cases, plus the liveness clause that the k_eff
  spread across the nine presets exceeds a floor measured first (it is 1.147; a classifier
  that collapsed to one constant would satisfy every identity above it). Deliberately NOT
  "k_eff = 1 − Q/|ΔT_L| against the shipped `kPart`", which is false for A356+TiB because
  `kRaw` is clamped, and would be a definition asserted against itself. `ALLOY-CLAMP-REPORT`
  pins which of the shipped bounds actually BOUND for each preset — a fact about the tree no
  definition can satisfy trivially, and the place the c0-floor finding lives (every addition
  below 0.75 wt% total is invisible to the solver's c0). `ALLOY-REFUSE-NAMED` drives eight
  input shapes that used to be silently dropped, requires each refusal to exceed 20 characters
  and to contain the offending key, requires the DISTINCT count to equal the number driven,
  and requires an un-triggered control to raise none — so a function that always returns
  refusals fails. It also records by name the drop sites it does NOT drive, including the one
  measured to be unreachable. `CALIB-MIX-OWN` recomputes the poured mix's reference interval
  independently, asserts the branch label against the temperature test in both directions,
  asserts the identity ΔT₀·k_eff = Q, and asserts that every preset which calibrates differs
  from the material default. `CALIB-MIX-REFUSE` drives six mixes with no reference interval
  and asserts WHICH clause fired for each — a refusal naming the wrong mechanism is a wrong
  statement rather than an absent one. `CALIB-MIX-OFF-IDENTITY` is the one that protects the
  rest of the suite: with no poured mix, `calibrate()` is `Object.is`-identical to a verbatim
  transcription of the pre-P1 implementation across 324 comparisons, and the two materials
  with no `si` block are asserted by NAME and by count rather than by both sides returning
  null. `DEPR-CONSISTENT` states the exact relation between the depression the composer prints
  and the one the solver integrates: they agree exactly iff no bound bound, both polarities
  required present. `PD-CONSTRUCT-AGREE` and `PD-VANTHOFF-CROSSCHECK` are the two gates v7.1
  P0 specified and deferred; both pin per-row baselines rather than bands, because the spreads
  were measured first and are too wide for a band to assert anything. `PD-DOC-CALIBRATION`
  recomputes the twenty-five numbers `science/index.html` quotes about the calibration — 4340's
  1504 K default and its 78 K poured range, A356's 303 K interval against its 35 K real primary
  range and the 8.7x ratio between them, the 53 wt% reference liquid against the 12.6 wt%
  eutectic, A356+TiB's −0.59 — and requires each to appear in the prose as written, the same
  way `HT-DOC-CONSTANTS` polices the heat-treatment constants. Both sides are normalised for
  the U+2212 minus sign first, or it would be a typography check wearing a physics gate's name.
- **`verify-phasediagram.mjs`** (browser-free, v7.1 P2) — the drawn phase diagram. Three checks.
  `src/phasediagram.ts` splits so that this is possible at all: `layout()` returns vertices in
  DATA space (wt%, °C) and knows nothing about pixels, and the renderer is only `toPx`.
  `PD-FIGURE-GEOMETRY` asserts the drawing IS the row — the liquidus polyline's endpoints are
  `Object.is`-exactly (0, T_m) and (C_inv, T_inv), the solidus's (0, T_m) and (C_SM, T_inv), the
  invariant horizontal is at T_inv spanning C_SM..C_inv, the solvus is vertical at C_SM, the
  solidus lies at or below the liquidus at 40 sampled compositions, and the pour marker's
  ordinate equals `derive(mix)`'s own liquidus and survives a round-trip through the px
  transform. Explicitly not "the SVG contains more than N paths". It also pins the FRAME:
  everything drawn must fill at least 60 % of the box and nothing drawn may fall outside it —
  the first version sized the frame on the chords' value at the axis edge, which extrapolates
  the Al–Si solidus 12 wt% past where it exists and put A356's y-axis at −96 °C, and the second
  forgot the solver line's endpoint and pushed Cu–Ni's below the floor. Both clamp branches are
  asserted exercised by shipped presets, and the residual offset is required present for every
  multi-solute preset and absent for every single-solute one. `PD-NO-ROW-REFUSES` drives eleven
  undrawable cases — the five materials with no alloy base, an unknown material, a pure melt, an
  unknown base, an inherited object key, all-zero weights and the geometrically impossible ni-W
  row — and requires each refusal to exceed 40 characters, the distinct-reason set to match, and
  ni-W's to name the geometry rather than claim there is no row; both polarities, so a `layout()`
  that refused everything cannot pass. `PD-FIGURE-CURSOR` settles the three absences without a
  GPU: a temperature on the diagram is drawn, one off it is NOT drawn and IS named, and null is
  silent — "no liquid left" and "below the axis" are different facts and the panel says so.
- **`verify-regimes.mjs`** (browser-free, v7.1 P3) — the composition regimes, the invariant
  fraction and the ceiling. Five checks. `PD-REGIME-EXACT` classifies every row from BOTH sides
  of BOTH of its boundaries: C_inv ∓ 1e-9 and C_SM ∓ 1e-9, with the exact regime asserted on
  each side rather than "A356 comes out two-phase", which one hardcoded branch would satisfy.
  Across C_inv the NAME of the first phase to freeze must change, and both names are read out of
  the table — `(Al)` from BASES, `theta-Al2Cu` from the row — so two empty strings cannot pass
  as "different". The two rows whose base solid is the peritectic PRODUCT (Al–Ti, Mg–Zr) have
  C_inv < C_SM, so their whole two-phase band lies past the invariant; that topology is asserted
  separately, and it is why C_inv is tested first — in the other order those rows report
  SINGLE-PHASE for a melt whose first solid is Al3Ti. It also gates the shaded band on the P2
  figure, whose edges are `Object.is`-exactly the row's own C_SM and C_inv.
  `PD-INVARIANT-BAND` recomputes the lever rule and Gulliver–Scheil inside the gate to 1e-9 over
  every eutectic row and asserts the ordering lever ≤ Scheil at every sampled composition, both
  monotone in composition. It also pins the two things an adversarial review corrected in this
  milestone: the peritectic refusal must give the DATUM-based reason (at a eutectic every drop of
  remaining liquid freezes at T_inv, so its fraction IS the share that freezes there; a peritectic
  consumes only part of it and the rest freezes below T_p) and the retired, false explanation —
  that the lever rule and Scheil "do not describe a peritectic" — is BANNED from coming back; and
  a reactant-peritectic melt richer than the reaction's own product must report the primary
  CONSUMED and drop it from the equilibrium set, while a leaner one must retain it. Its anchors are INDEPENDENT statements rather than the same formula
  twice: as k → 0 the solid takes nothing, so mass balance alone fixes the eutectic share at
  c₀/C_inv and Gulliver–Scheil must approach it; the lever rule is linear, so a quarter of the
  way across the band it is exactly 0.25, which a flipped lever gives as 0.75. Pb–Sn
  (61.9 wt% Sn, 183 °C, 18.3 wt% solubility) drives all of them as GATE-LOCAL data — a row for
  it in `phasedata.ts` would break `PD-ROW-SOURCED`'s bijection, since Pb is not a base metal.
  The five peritectic rows are asserted EXCLUSIONS that refuse the fraction by name, so a
  predicate that silently swallowed them could not pass. `ALLOY-PHASES-NAMED` drives both
  polarities over the nine presets: four emit exactly one `notGrown` line per over-solubility
  solute containing that row's own second-phase token, five emit none, and the two columns
  (PHASES EQUILIBRIUM PREDICTS / PHASES THIS SOLVER GROWS) must differ by exactly as many phases
  as there are lines. `PD-CAP-CEILING` asserts the POSTCONDITION rather than the implementation —
  for any input, the solutes `derive()` actually used carry no composition at or past their own
  C_inv — by all three routes: the slider bound, a share link, and `window.__solidify.alloy`.
  It fails on the pre-P3 tree for all 25 pairs. Five pairs where the hand-picked cap reached past
  the invariant are pinned as named regression cases (Fe–C 2 → 0.52, Al–Fe 2 → 1.75, Al–Ti
  0.5 → 0.14, Mg–Zr 0.8 → 0.57, Zn–Al 5 → 4.95, the last of which had its slider maximum sitting
  exactly ON the eutectic), and the liveness clause is that all nine presets still pour — so a
  ceiling that refused everything cannot pass. `ALLOY-SHARE-CLAMP` round-trips a corpus of ten
  pre-arc links including the landing page's own, requires over-ceiling links to restore CLAMPED
  with a named refusal rather than being rejected whole, and requires a malformed weight to be
  rejected whole rather than silently reduced — which is how the `#alloy=al:Si1.2.3` defect was
  found, where `parseFloat` returned 1.2 and the link restored a silent 1.2 wt% Si.
- **`verify-elements.mjs`** (browser-free, v7.1 P4) — the 118-element table and the tier
  classifier. Six checks, and the module load is guarded so all six REPORT on a tree where
  `src/elements.ts` does not exist; P3 learned that an unwrapped call inside a gate kills the
  file with zero output, and this found the level above it, in the one place a non-vacuity proof
  looks. `EL-TABLE-SHAPE` asserts 118 rows in Z order and pins the three patterns that look like
  data-entry bugs and are not: seven places where the atomic mass FALLS as Z rises (Ar→K, Co→Ni,
  Te→I, Th→Pa, U→Np, Pu→Am, Bh→Hs — natural-abundance masses against longest-lived-isotope mass
  numbers), one row whose boiling point is BELOW its melting point (arsenic, which sublimes at
  887 K and melts at 1090 K only under 3.6 MPa of its own vapour), and two rows with no melting
  point at all (helium, which needs 2.5 MPa to freeze; carbon, which sublimes). It also asserts
  the masses `alloy.ts` and `elements.ts` carry for the same element agree to 0.05 g/mol, and
  ties the radius column to an independent physical quantity: the close-packed-equivalent radius
  from the density, r = (0.7405·3M/4πρN_A)^⅓, must agree to 2 % for every metal that is actually
  close-packed. That check exists because this milestone's own review found a defect all six
  gates missed — the CN8→CN12 correction was applied to the s-block bcc rows and forgotten on the
  d-block ones, so V, Cr, Nb, Mo, Ta, W and Ra carried the nearest-neighbour radius a·√3/4 while
  the file's own source string said they did not. Reverting any one of them now fails by 2.8–2.9 %.
  The ten rows that legitimately miss are pinned by measured value with their structure named
  (α-Po at 12.7 %, the only simple-cubic element; α-Pu at −6.5 %, the least symmetric metal
  known; Ga, Sn, Sb, Bi, Mn, Hg, Pa, Am). Densities are gate-local, the same idiom
  `verify-regimes.mjs` uses for Pb–Sn — a check on the shipped table, not cargo in the bundle.
  `EL-TIER-TOTAL` drives all 6 × 118 = 708 pairs: exactly one of four tiers each, deterministic,
  never null, and every non-ASSESSED sentence over 25 characters (the shortest is 186). The
  distinctness clause counts sentence SKELETONS — base labels, element symbols and every number
  replaced — because the naive distinct-string count is vacuous when every sentence interpolates
  its own element: measured on this tree it is 488 of 708, and it would pass a file that said
  "X is not available in Y" seven hundred times. There are 31 skeletons, no one of them may cover more than half the grid (the largest covers
  294 of 708), and no two REASONS may
  share one, because a refusal naming the wrong mechanism is a wrong statement rather than an
  absent one. Liveness runs both ways: all four tiers non-empty, every base admitting something,
  and the ASSESSED count equal to the number of pairs holding both a cited `Solute.source` and a
  `phasedata` row — 25, computed rather than written. Every one of the 708 is then driven through
  `derive()` as well, and ASSESSED must hold if and only if the pour is accepted, so an admission
  and a pour cannot drift apart. `EL-TROUTON-CROSSCHECK` checks the vaporisation data against a
  physical law instead of against itself. The fixed-point check originally planned for this slot
  was a tautology — p(T_b) = exp(0) = 1 atm for ANY enthalpy — so a zinc row carrying 11.5 kJ/mol
  instead of 115 would have passed it while turning 59 atm over liquid iron into 1.5 and
  reversing what the number teaches. ΔH_vap/T_b must sit in Trouton's 85–110 J/mol·K window;
  53 of the 96 rows carrying both fields legitimately do not, and each is pinned BY VALUE to
  ±1.5 and required to explain itself with a `TROUTON:` clause in its own source string, so the
  enumeration cannot rot into an unread allow-list. `EL-VAPOUR-ADVISORY` pins the four foundry
  tripwires — Zn 59 atm over liquid Fe, Mg 16, Mn 0.037, Hg 39 over liquid Al — measured on this
  tree and each reproducing the literature value the milestone plan quoted before any of it was
  written. The direction that would be a bug is asserted too: applied as a REFUSAL this rule
  refuses brass, so Cu–30Zn must compute above one atmosphere, must stay ASSESSED, and its line
  must name the activity coefficient the app does not have. Bands are asserted at the composition
  each claim is about — pure zinc into a charge BOILS, 1 wt% dissolved is a FUME — which is a
  distinction the first draft of the gate got wrong. `ALLOY-MOVES-THE-PHYSICS` replaces the
  deleted bundle-delta metric: every assessed pair at its own probe composition must move the
  UNCLAMPED liquidus by at least 0.5 K (half the measured minimum of 1.0 K) with a finite Q, and
  beside it a named CLAMP-SWALLOWS report lists every pair the shipped c0 floor and mLiq clamp
  make invisible to the solver. Two are — Al–Ti and Mg–Zr, both grain refiners, which move the
  liquidus 2.3 K and 2.0 K and the growth restriction factor 18.4 K and 11.0 K while moving c0,
  mLiq and kPart by exactly 0.0000. That is a finding printed rather than a gate that cannot go
  green. `EL-DOC-CLAIMS` gates this milestone's prose in the commit that writes it, on
  `PD-DOC-CALIBRATION`'s mechanics one layer over: sixteen claims recomputed from the modules and
  required to appear in `science/index.html`, with HTML tags stripped and typographic dashes
  flattened first so the gate cannot fail on typography, and with no claim allowed to be a bare
  small integer — "the ceiling binds for 5 pairs" is satisfied by any document containing the
  character 5, a lesson this repo wrote down at P3.
- **`verify-phasediagram-gpu.mjs`** (v7.1 P2) — `PD-CURSOR-LIVE`, the cursor against a real cast.
  Its own file, and that is the point: written inside `verify-quant.mjs` first, it could not pass
  there, because every QPF-* block above it stages the solver by writing `frozenT`, `dx` and `dt`
  straight onto `sim.params` and none of them puts anything back — with `frozenT: 1` inherited
  the melt sat at its staged temperature forever and both reads agreed, and with it cleared the
  inherited timestep cooled the melt past the shader's own readout clamp to 162 °C. Neither
  failure was in the code under test. The gate compares the drawn cursor's own label against
  `units.fmtC`'s conversion of `meanLiqT` — the same formatter the corner readout uses — at two
  separate reads, and requires the two to DIFFER; "it moved downward" would be the PIN3-LIVE
  directional-proxy mistake in a new costume, since a cursor wired to solid fraction would also
  move downward. Three more arms cover the absences: a Kobayashi undercooling of 0.9 puts the
  melt 224 K below the melting point and off the diagram (absent AND named), an abstract material
  has no thermometer at all (absent, silent), and a casting driven to fracSolid 1.0 reports
  `meanLiqT: null` (absent, silent). That last arm needs `pPore: 0`, because a shrinkage pore
  pins its cell's φ below 0.5 and never freezes, so the stats kernel counts it as liquid forever.
- **`verify-dive.mjs`** — boots the landing page, confirms the Three.js scroll-dive engaged
  (not the 2.5D SVG fallback), scrubs through a set of scroll progresses, and captures
  screenshots + console errors at each one.
- **`verify-dive-fallbacks.mjs`** — the fallback matrix: WebGL blocked (must fall back to the
  old SVG camera), `prefers-reduced-motion` (must render a static stage), and a phone viewport
  on the 3D path.
- **`verify-scroll-order.mjs`** — asserts the pinned scroll acts never overlap (dive → lens →
  materials, strictly in order). This is a regression that hit twice: a pinned ScrollTrigger
  created asynchronously after later pins computed their start offsets without the dive's
  spacer, so the acts interleaved.
- **`verify-optimizer.mjs`** — confirms "Engineer it" enters ML mode paused, that the run/pause
  transport gates the CMA-ES loop (it doesn't auto-start), and that exiting the mode restores
  normal transport.
- **`verify-tools.mjs`** — the v1.8 tool batch (faceted growth, `#set=` share-link round-trip,
  the analysis-panel enlarge modal, the specimen-tilt view) plus the v4.0 physics checks below,
  the lab gates (`LAB`, and v6.1's `LAB4` — the σ_y row must BE Hall–Petch on the gate's own
  census to the printed decimal, the verdict must judge the spec as dialled at the pour even
  when the dial is shoved to 999 mid-run, a no-spec pour must carry no verdict row, and the
  model metal must refuse by name) and the heat-treat share-link gates.
- **`verify-scale3d.mjs`** — the 3D half of the v5.0 length-anchor change, on its own so it
  does not need the full 23-check volume suite to re-run: both solvers carry one resolution,
  the volume's `eqDiamUm` actually follows it (doubling the pitch doubles the reported diameter
  for the same voxel count — the check the old hardcoded `1 mm / 1024` could never pass), and
  the SCALE panel reports the volume's derived domain rather than the 2D grid's.
- **`verify-3d.mjs`** — the TRUE-3D mode end to end: entry, growth, grain claiming, all nine
  lenses, orbit + ViewCube, tap-at-depth seeding, alloy, twins, icosahedral symmetry, the grain
  selector, stereology, STL export, the share round-trip, the 3D lab, and (v6.2) the shaped-mould
  library: `STEP3` and `FEED-MASK`.

- **`verify-quant.mjs`** — the calibrated (Karma–Rappel) solver, checked against physics it did
  not get to choose. The Kobayashi path can only be tested for self-consistency, because it has
  no calibrated surface energy and therefore no independent number to be right or wrong about;
  once `W0` and `τ0` are *derived* from a real `d0` and `D`, the model owes you a specific
  critical radius, a specific tip velocity, and an answer that does not depend on how wide the
  diffuse interface was made. Ten checks: `QPF-EQUIL` (equilibrium profile width and a flat
  front that does not drift), `QPF-GIBBS-THOMSON` (`R* = d0/Δ`), `QPF-CONVERGE` (steady tip
  velocity at three interface widths), `QPF-TIP-KR` and `QPF-TIP-RADIUS` (both against published
  values), `AT-PARTITION` and `AT-WIDTH` (the anti-trapping current, on and off),
  `QPF-MASS` (solute conservation), `CALIB-BAND` and `CALIB-LOCK` (the mode as the app offers it).

  Three things about this file are worth copying rather than rediscovering. **Every measurement
  goes through `sim.stepSync()`, never the frame loop** — a frame-paced arm receives an
  unpredictable number of substeps, and every rate here would otherwise be a race. **The
  reference values are looked up, not remembered**, and the file says which paper and which
  table. And **the tolerances that the plan wrote before anything was measured were replaced by
  what the measurements support**, with the reason recorded in `tasks/todo.md` rather than the
  numbers quietly relaxed.

  It is also where four separate wrong comparisons were caught, all of the same shape: equal
  wall-clock, equal distance travelled, equal substep count and equal bath temperature are all
  proxies, and each of them produced a confident wrong answer here. Before comparing two runs,
  name the variable being held fixed and check it is the one the physics is measured against.

- **`verify-experiment-gpu.mjs`** (v7.0 C1) — that rule as load-bearing code: the comparator
  layer (`src/experiment.ts`) running real casts. `EXP-REPRO-LIVE` — a nucleation-LIVE cast is
  deterministic per seed. `RNG-REPRO` had to bypass the site model with `scatterSeeds` because
  nucleation fires on frame-loop stats arrivals; `castCensus` drives it synchronously between
  fence-paced chunks (update → stepSync → readStats → observe, the frame loop's own order),
  with the app's wall-clock `nuc.observe` held off and the seed-stamp queue drained before
  growing, so 246 emergently-fired sites replay to a byte-identical census while a different
  seed differs. `EXP-SWEEP-CONTROLLED` — a real coolRate sweep, two seeds per arm, read at
  matched solid fraction: the arms' achieved read-states must sit within a tolerance sized
  from measured chunk overshoot (0.03 — the first cut of this gate used a lazy 0.08 and let a
  budget-exhausted arm at fs 0.447 pass as "matched", which is precisely the failure the bench
  exists to refuse), the replicate band must be alive (seeds must matter somewhere), the v4.0
  direction must hold (faster cooling ⇒ more grains, 288 vs 170 measured), and the rendered
  text must name the controlled variable. `EXP-TIP-ANCHOR` — the bench anchored on a constant
  this arc does not touch: one `castTip` arm reproduces the Karma–Rappel 1998 solvability tip
  velocity (V·d₀/D measured 0.01678 against 0.017, 1.3 %), through an implementation
  deliberately independent of `verify-quant.mjs`'s — two witnesses asserting the same
  published number every build cross-check each other, where sharing one implementation would
  let a bug assert itself.

- **`verify-heattreat-gpu.mjs`** — the measured half of v6.0: puppeteer against real WebGPU,
  because a Monte Carlo Potts pass can look completely right and be completely wrong. The pass
  invariants, the RNG-decorrelation trap, the measured (m, K_MC) pair in both dimensions,
  homogenization against the discrete stencil eigenvalue, Σ3 annealing twins, and the two
  end-to-end panel gates `HT-PANEL` / `HT3-PANEL`.

**Physics-behaviour tests (v4.0).** These are the first checks in the suite that assert a
*physical* relationship rather than a UI one, and they exist because the nucleation model was
rebuilt to make that relationship emergent:

- **`NUC-COUPLING`** — the reviewer's point, as a regression: with the inoculant charge held
  fixed, raising the cooling rate must produce *more* grains. Nothing in the code says so; it
  follows from the melt reaching a deeper undercooling before recalescence.
- **`NUC-ARREST`** — with heavy latent heat, part of the charge must go unfired: recalescence
  has to stop nucleation while the casting is still freezing.
- **`NUC-GATE`** — a seed offered to alloy melt that sits *above* its (depressed) liquidus must
  not stamp at all. This one encodes a real bug that shipped for months.
- **`ATMOSPHERE`** — oxide-film sites from a dirty melt must activate before a clean charge's
  own deep sites can.
- **`SPEEDMULT`** — asserts the step count the frame requests, not elapsed sim-time; the
  fence-backpressure guard skips frames, so timing-based versions of this test are flaky.
- **`LAB` / `LAB3`** — an experiment can be configured, poured, and produces a report card; the
  dimension switch is blocked mid-pour; touching a physics dial sets the intervention flag.

**Physics-behaviour tests (v5.0).**

- **`UNITS-*`** (`verify-units.mjs`) — the scaling layer, checked without a browser, so it is
  one of the two parts of the suite CI can gate (`verify-heattreat.mjs` joined it in v6.0). Eight checks: that kelvin-per-unit really is the heat
  equation's own `(L/c_p)/K` for four materials computed independently in the test; that the
  time factor is forced by whichever diffusivity is anchoring; that every converter round-trips;
  that an abstract material reads as *unknown* rather than as zero; that the undercooling dial's
  own maximum is past the Turnbull limit for aluminium and inside it for water. Two carry more
  weight than the rest:
  - **`UNITS-GRID-INVARIANT`** — the same dendrite must measure the same in µm at 512², 1024²
    and 2048², with the *domain* growing instead. This is the inverted-anchor regression: the
    old code fixed a 1 mm domain and derived the pitch as `1000/n`, so one dendrite read four
    different sizes at four different grids.
  - **`UNITS-HONESTY`** — the report must *name* what it cannot match. Lewis is flagged (model
    ≈1.1, real ≈9200) and the capillary ratio is `null`, "not defined", rather than asserted
    as 1.0.
- **`REFINE-FAIR`** — two alloys of very different growth restriction, compared *fairly*, come
  out the same within noise. Fair means both conditions: each charge starts at the same
  undercooling **below its own liquidus** (equal bath temperature is not equal undercooling when
  one liquidus is depressed 170 K further) and both are read at the same **solid fraction**
  (equal time is not equal progress when one grows twice as slowly). Getting either wrong flips
  the answer, in opposite directions — which is how both the pre-v4.0 claim and the v4.0
  inversion happened.

  It asserts equivalence rather than an effect on purpose. An earlier version of this test
  asserted the textbook mechanism — more sites firing in the slower alloy — from a measurement
  that looked convincing and **did not reproduce**: the harness paces the solver against
  wall-clock frames and the ≥2-fence backpressure guard skips them unpredictably, so the two
  casts had not run the same amount of physics. Anything derived from *how far a cast got* is
  not a controlled variable here (see postmortem #6 in `tasks/todo.md`, which records the same
  trap one release earlier). Grain count at matched solid fraction is stable to <8 % across
  four independent runs, so that is what is asserted.

- **`PASSSPLIT`** — the solidification step exists in two shapes, fused
  `FLUX → UPDATE` (what ships) and split `FLUX → PHI → TRANSPORT` (what the quantitative
  solver needs, because its anti-trapping current wants `∂φ/∂t` at cell *faces* and a fused
  pass only knows it at its own cell). Both are composed from **one** copy of the physics text
  in `shaders.ts` — `LOADS` / `PHI_CORE` / `TRANSPORT_CORE` — so they cannot drift apart, and
  this test A/Bs them on identical initial conditions (`reset()` zeroes `frame`, so both arms
  draw the same noise stream) over 2000 substeps, pure and alloy. It also *measures* the cost
  of the extra dispatch rather than assuming it: ~1.25×, which is why fused remains the default.

  It earned its place immediately. The fragment split left one `let` declared in both halves,
  which is harmless for either split pipeline but a duplicate declaration in the fused shader —
  so `UPDATE_WGSL` stopped compiling, its dispatches silently did nothing, and the shipped
  solver produced no solid at all **with a clean console**.

**Harness guards (v5.0).**

- **WGSL compile errors** — a shader that fails to compile does not throw, does not log, and
  still yields a pipeline whose dispatches quietly do nothing; the only symptom is a field that
  never changes. `shaderModule()` in `src/shaders.ts` polls `getCompilationInfo()` and logs
  `[solidify] WGSL <pass>:<line> <message>` on any error, in both dimensions, so the suite's
  error channel catches it. Added after exactly that bug cost an afternoon.

- **`PARAM-WARN`** — runs in both `verify-tools` and `verify-3d`, and watches the browser's
  **warning** channel, not just its errors. A uniform or storage struct that outgrows its
  binding is reported by WebGPU as `binding size … < minimum …` — a *warning* — while every
  readback through that binding silently returns zeros. That shipped once already (postmortem
  #1 in `tasks/todo.md`: the 2D stats struct gained a slot and all stats went to zero for
  weeks). Any milestone that changes a params or stats layout must keep this green.
- **`RNG-REPRO`** (v7.0, C0a) — the seeded stream end to end through the real solver.
  `verify-rng.mjs` gates the module's contract; this gates that the *sweep* took, i.e. that no
  consumer still reaches for `Math.random()` behind the seed's back. A 512² cast is poured three
  times through `stepSync` — twice at one seed, once at another — and compared on the **full
  per-grain census**, not just the count: two runs can easily agree on how many grains formed
  while disagreeing about every one of them (they do here — both seeds give exactly 400 grains,
  and only the diameters and solid fraction distinguish them). Measured: 400 diameters and
  `fracSolid` 0.981033325 byte-identical across two independent casts; the other seed gives
  0.979911804. It seeds via `scatterSeeds` + `addSeed` with **no** explicit `theta0` — the
  canonical cast helper in `verify-heattreat-gpu` passes its own seeded angle, which is correct
  there and would bypass the very draw under test here. `castGrew` is asserted before any
  identity claim: the first draft of this gate compared three arms that had each produced zero
  solid and pronounced them reproducible (see `tasks/lessons.md`).

**Physics-behaviour tests (v6.0).** Heat treatment is a second model on a second clock — real
schedule → Arrhenius integral → sweep budget → GPU pass — and the gates split the way the map
does: `verify-heattreat.mjs` checks the arithmetic anywhere Node runs,
`verify-heattreat-gpu.mjs` measures the kinetics on the hardware that ships them.

- **`HT-ARRH-HOLD` / `HT-ARRH-RAMP`** — the Arrhenius walker. A hold has an exact closed form
  (the integrand is constant), so any disagreement is a bug in the walker, not the quadrature —
  rel err 3e-15. A ramp has no elementary integral, so its reference is the same routine at 64×
  the sample count (rel err 3e-8): convergence, the only thing a quadrature can honestly be
  tested for.
- **`HT-RAMP-COUNTS`** — a slow ramp to temperature must contribute more than a fast one, and
  both more than the hold alone (+31.5 % measured). Charging a schedule only for its hold is
  the exact shape of a bug that would look right in every readout and under-report every
  treatment — the same class as v5.0's "equal wall-clock is not equal physics".
- **`HT-LAWS`** — grain growth, Hall–Petch (and its direction: coarser must be weaker),
  parabolic scale and decarb depth, each against its closed form to 1e-12, plus the `ggN ≠ 2`
  path that no shipped material exercises but the code carries.
- **`HT-HOMOG-ANALYTIC`** — the segregation decay the GPU pass is measured against, known good
  *before* the solver exists — so when `HT-HOMOG-2D/3D` ever disagrees, the argument is about
  the solver rather than about the reference.
- **`HT-SWEEPS`** — the budget → sweeps inversion round-trips, and the model exponent must
  actually be *used*: the test makes m and 2 disagree on purpose and requires the answers to
  differ, because an implementation that silently assumed the parabolic m = 2 would have passed
  every other check. Ideal curvature-driven growth is parabolic; Monte Carlo Potts is not, and
  the assumption costs a measured 4.8× error in the sweep budget (9 499 sweeps against 1 980).
- **`HT-REFUSE` / `HT-TWIN-MATRIX`** — every refusal path fires and names what is missing, and
  the reasons are asserted *distinct* — a generic "not available" would be the dead-knob class
  in a different costume. `HT-REFUSE` tests the machinery on synthetic contexts (15 cases, 10
  refusals); `HT-TWIN-MATRIX` tests the shipped *data*: Cu and Co twin, Al and Ni refuse with
  their SFE printed, steel and SCN refuse structurally, HCP refuses before SFE is even
  consulted — annealed copper full of Σ3 twins and annealed aluminium with none, from one
  machinery and two numbers.
- **`HT-INCIPIENT` / `HT-DOMAIN-LIMIT`** — the two honest walls. φ is frozen, so a schedule
  above the melting point is not a treatment the model can integrate — and in a real shop it
  ruins the casting; same limit, two reasons. And steel's own sourced coefficients predict
  ~296 µm after a 1 h anneal — three grains across the 1 mm 2D domain, wider than the entire
  188 µm volume — so a schedule past `domainLimitUm()` is refused *with the analytic answer
  still printed*.
- **`MC-COHERENCE` / `MC3-COHERENCE`** — the sweep invariants, asserted exactly: boundaries
  must move, and nothing else may — no invented id, no deleted one, liquid/mould/pore
  untouched, φ byte-identical, `dir` unmoved. `dir` indexes the state ping-pong too and this
  pass never writes state, so an odd dispatch count would pair a current state field with a
  stale grain field — which renders as nothing visible at all.
- **`MC-RNG-DECORRELATION` / `MC3-RNG-DECORRELATION`** — the trap the pass shape exists to
  avoid: `queue.writeBuffer` is ordered against `submit()`, not interleaved with dispatches, so
  many sweeps in one command buffer would share one RNG salt and freeze the dynamics in a way
  that looks exactly like lattice pinning. Consecutive sweeps must flip *different* cells.
- **`GG-EXPONENT` / `GG3-EXPONENT`** — measure the model's growth exponent m in
  D^m − D₀^m = K_MC·S, over a decade of lever arm (an exponent fitted over a 1.36× change in d
  is ill-conditioned). The estimator earned its shape through two wrong versions: a
  through-origin fit made the exponent pay for the as-cast smoothing transient, and a floated
  intercept looked excellent (r² > 0.99 on every cast) while being degenerate — three casts
  returned m = 2.41, 3.41 and 2.905 with bands that did not overlap. The intercept is now
  pinned to the measured d₀ (at S = 0 the grain size *is* d₀), and the fit window is fixed in
  sweeps ([300, 3200] in 2D; [550, 3800] in 3D, the domain wall included on purpose because
  the panel's dials legally reach it) — a threshold keyed to a stochastic measurement is a
  knife edge: one cast landed 102 grains, one over the old floor, a saturation-shoulder point
  entered the fit and bent the exponent 2.85 → 3.61. Saturation rungs still run and print:
  they are `domainLimitUm()` demonstrated empirically.
- **`GG-KMC` / `GG3-KMC`** — the shipped constant is the PAIR: m = 2.44, K_MC = 4.79 in 2D and
  m = 2.25, K_MC = 1.28 in the volume, measured separately because the neighbourhood, the
  colouring and the pinning geometry all differ. K is measured at the *shipped* exponent,
  never the free-fit one — it carries units of cells^m, so a wandering m drags K 80 % with it.
  The gate is K-drift plus r² at the shipped m; exponent-band containment is printed, not
  gated, after a fifth cast's band excluded the shipped 2.44 while K moved 8 % and r² held
  0.996 — the band is an r²-window statistic within one cast, and cast-to-cast variance
  exceeds it. The 2D drift tolerance was widened 15 % → 25 % with the arithmetic recorded in
  `tasks/todo.md` (the through-origin fit weights points by S², the top rung carries ~half the
  fit, and its d̄ moves ~9 % between casts — ±20 % swings in K from a healthy pass), and the
  volume followed it to 25 % in v6.2. This paragraph, the README and the science page all kept
  the volume's older 15 % for two releases afterwards, each citing a cast-to-cast spread that
  had been read off two casts which happened to agree. Six consecutive runs of
  `verify-heattreat-gpu` on identical code returned K/K_shipped = 1.186, 0.924, 1.057, 0.886,
  0.934, 0.937, so the older gate reds a good build roughly one run in six. `K_MC_TOL_3D`'s own
  docblock in `src/heattreat.ts` carries that evidence and is the authority if these ever
  disagree again — which `HT-DOC-CONSTANTS` now exists to prevent.
- **`GG-STAGNATION` / `GG3-STAGNATION`** — flips per sweep must not decay to zero, because a
  pinned lattice looks exactly like a finished anneal (3D pins harder — that is why the
  neighbourhood is 26 and not 6).
- **`HT-HOMOG-2D` / `HT-HOMOG-3D`** — homogenization against the *discrete* stencil
  eigenvalue, exact: a synthetic φ = 1 block seeded with a DCT-II mode — an exact eigenvector
  of the clamp-edge Laplacian — must decay as (1 − 2D(1 − cos k))^I. Measured rel err 9e-7 in
  both dimensions, conservation to 1e-7, φ byte-identical; the continuum exp(−Dk²I) is printed
  alongside with its gap, because that gap is the model's own discretization error and belongs
  on the science page, not swept into a tolerance.
- **`HT-TWIN-SIGMA3`** — annealing twins are real crystallography or they are noise: every
  surviving twin must sit in exact Σ3 registry (60° about ⟨111⟩, checked CPU-side against the
  actual volume adjacency), must be a metallographically visible plate rather than single-cell
  debris (median 107 vox), and must survive further annealing — the cusp + Σ3-mobility
  physics. It exists because two in-pass single-cell spawn mechanisms were built as designed
  and measured dead (3/512 survivors; 15/493 after the mobility fix, 29/520 after setting the cusp to the physical 0.04): a 1-voxel twin pays
  ~12 neighbours of Σ3 energy where adopting the parent pays ~one, an artificial nucleation
  barrier no cusp value removes, because a {111} stacking event is sub-grid for a per-cell
  flip. Plates are the one inserted thing; everything after birth is the pass's physics.
- **`HT-PANEL` / `HT3-PANEL`** — the checks with teeth for the whole budget map, driven
  through the DOM the way a user would: schedule → Arrhenius integral → law endpoint →
  `sweepsFor` → Potts pass → the census must land near the endpoint the material's own law
  predicted (measured 0.963 / 1.003 / 0.983 of the law across three 2D runs, 0.912 in the
  volume; rails 0.65–1.35). Both assert the solver-paused interlock, the incipient refusal
  straight off the temperature dial, and the homog + oxide card rows. The volume's two
  specifics: the domain-limit refusal is the COMMON case — the same 12 h anneal that legally
  ran on the 500 µm 2D specimen is refused on the 125 µm volume with the law's answer still
  printed — and the aluminium arm of the twin physics (allocator frozen, the SFE sentence on
  the card). Since H6 they also gate the strength row and the spec verdict: the card's σ_y
  must *be* `hallPetch` on the measured d̄ to 0.2 MPa — the ⟨V⟩-equivalent d̄ in the volume,
  because the dimension switch is exactly where a cached 2D census once printed d₀ = 0.0 µm
  with a straight face — a spec committed before a softening anneal must come back "missed", a
  spec dialled under a near-noop run must come back "met", and no verdict row appears when no
  spec was set, because a pass/fail against a spec nobody set would be an invented judgement.

The rest are behavioural/regression checks on the UI and scroll choreography, which is where
nearly every bug in this codebase has actually occurred (see `tasks/todo.md` for the
postmortems). Morphology correctness is still checked by eye against the published Kobayashi
figures and documented in `tasks/todo.md`'s M1 verification note.

**v6.2 additions.** `UNITS-NIYAMA` joins `verify-units.mjs` (the Ny → K·s^½·mm⁻¹ closure
over the layer's own methods, the cited steel anchor recomputed from scratch, and the refusal
under the abstract material). `NY3` and `KPART3` join `verify-3d.mjs`: NY3 recomputes
|∇T|/√(−lapT − envRate) on the CPU for freshly-frozen voxels and requires the recorded value
to match (median ratio ~1.18 — a missing scenario term blows it by orders), plus the −1
"no measurement" sentinels and the stats risk counter against a CPU recount; KPART3 requires a
3D material swap to land the material's own alloy constants and the solute rejection to move.

**v6.2 Phase D Milestone M.** `STEP3` joins `verify-3d.mjs`: pours a step-block mould and checks
rasterization exactness (a real GPU mask readback vs an independent classification from
`stepSectionBounds`, zero mismatches over the full grid), `readRegion`'s per-grain GPU counts
against an independent CPU recount over the same bbox (byte-exact), freeze-time ordering
(thinnest section's last freeze predates the thickest's, via the age record), and regional d̄
growing from thinnest to thickest — calibrated against a real furnace-programme pour first,
because a "quench" programme's strong set-point coupling swamps the geometric wall-conduction
effect between sections entirely. `FEED-MASK` joins it too: two sealed chambers split by an
internal wall, one riser-connected and one capped short of the top, built with a direct
`writeMask` call reusing the pigtail's own kind number so `submit()`'s dispatch never
re-rasterizes over it; post-fix the sealed chamber shows real porosity (calibrated ~6 %) and the
open one shows none, with `pPore` deliberately amplified to force a clear signal from a short
run. `MOULD-SHARE`/`MOULD-SHARE-MALFORMED` join `verify-tools.mjs`, mirroring the `HT-SHARE`
pair for the lab tuple's 9th element.

**v7.0 C2 — the Zener dispersion.** Pinning is a MODE on the heat-treat uniform (fraction in
the `pinF` slot, radius in flags bits), implemented entirely in the eligibility-MASK pass —
particles are mask-ineligible cells, the exact wall semantics liquid films, pores and mould
walls already have, and the anneal shaders are untouched. Six gates:

- **`GG-PIN-OFF-IDENTITY`** — the keystone: the mode at zero is the pre-C2 anneal, bit for
  bit. Two same-binary arms from byte-identical casts (the pre-C2 call shape vs `{f: 0, r: 0}`)
  compare full-field element-exact (103 336 flips in each, fields identical); the pre-C2
  ANCHOR is `GG-KMC` continuing to measure the shipped constants. Liveness beside identity:
  both arms must have flipped, and the pinned third arm must differ AND flip fewer.
- **`GG-PIN-LIMIT`** — the pinned arm gets a LAW, not an exemption. Three (f, r) ladders must
  each plateau (last-rung growth < 1.2 % where the unpinned lattice grows 4.4 %), sit within
  8 % of the shipped `d_lim = 7.24·r^0.205/f^0.356` (fitted over nine plateaued ladders, worst
  residual 5.4 %; the exponents are this lattice's own — finite-kT detachment and a
  count-weighted census, deliberately not classic Zener's r/f or Srolovitz's T = 0 r/√f), and
  order correctly in f. An unpinned mini-arm is the contrast: the f = 0.12 specimen's plateau
  (6 000 sweeps) must sit below 0.45× the unpinned arm at 3 000 sweeps — deliberately different
  horizons in the strict direction, since the unpinned specimen only grows past 3 000
  (measured 0.37).
- **`PIN3-LIVE`** — the volume's fabric, asserted as the WALL GUARANTEE: the pinned arm's
  flipped voxels must avoid a JS replica of the hash fabric (measured: 0 fabric flips of
  ~30 000), with the fabric proven nonempty (~9 % of a lattice sample). Its first cut demanded
  "pinned flips fewer than plain" and failed on a correct build — excluding particles from the
  energy sum ADDS flat moves near particle surfaces, so the flip count is not monotone in
  pinning. Assert the mechanism's own invariant, not a directional proxy of it.
- **`HT-PIN-PANEL`** — the operator surface, cheaply: dials append after the three the other
  panel gates drive positionally, the note pre-judges with the measured law without
  introducing an arrow before the law prediction (the `dPred` parse hazard), a near-noop
  pinned run's card carries the `pinned` row, and zero reverts the note.
- **`HT-ZENER` / `PIN-STRUCTURE`** (browser-free, in CI) — the limit law's arithmetic
  (off-states answer Infinity, monotone the two directions the ladders measure, one spot
  recomputed from the exported constants — a formula-shape check; the constants' values are
  GG-PIN-LIMIT's job), and the POR-PORE-SOLUTE-style structural invariants: the particle
  test lives in BOTH mask shaders behind the f ≤ 0 guard, the ANNEAL shaders read no particle
  term (a pinning term in the acceptance arithmetic would re-open the K_MC calibration), and
  both dims interpolate ONE fabric salt. `HT-DOC-CONSTANTS` now also requires the science page
  to quote the measured triple and bans the retired absolute unpinned-growth claim from all
  three documents ("unpinned by default" is the honest v7.0 sentence — and the ban caught THIS
  file quoting the banned phrase verbatim while describing the ban, which is exactly the class
  of self-reference a text gate has to survive).

`HT-SHARE` additionally round-trips the dispersion dials — the ht tuple grew its optional
tail (temperature, hold, spec, fraction, radius) under the lab-tuple doctrine, and a
three-element pre-C2 link still restores.

**A note on `GG3-KMC`'s tolerance.** The calibration pours are now seeded LCGs rather than
`Math.random()`, which made the 2D `GG-KMC` byte-identical run to run. The 3D one still moves,
because its freeze loop stops on a measured threshold: six consecutive runs on identical code
spread K/K_shipped over 0.886–1.186, so `K_MC_TOL_3D` was re-measured from 15 % to 25 % with
that evidence recorded in the constant's own docblock. The drift prints on every run, and
`HT3-PANEL` gates the same constant a second way — on an integral rather than a fit.

`npm run build` (Vite + `tsc`) plus the twelve browser-free scripts — `verify-units.mjs`,
`verify-rng.mjs`, `verify-heattreat.mjs`, `verify-thermal.mjs`, `verify-fade.mjs`,
`verify-porosity.mjs`, `verify-experiment.mjs`, `verify-phasedata.mjs`,
`verify-alloy.mjs`, `verify-phasediagram.mjs`, `verify-regimes.mjs` and
`verify-elements.mjs` — are the checks anyone on any OS can run
without a GPU, and are what CI actually gates on (`.github/workflows/ci.yml`).
