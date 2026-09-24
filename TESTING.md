# Testing

```bash
npm test
```

runs the headless verification suite: starts `vite` on port 5199, then drives each script in
`scripts/verify-*.mjs` against a real WebGPU browser via `puppeteer-core`, and tears the server
down afterward (`scripts/run-tests.mjs`). One browser script is the exception:
`verify-hero.mjs` removes `navigator.gpu` from every page it opens and launches Chrome
without the WebGPU flags, because the landing hero must work without a GPU, so it needs no GPU
itself.

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
`verify-phasediagram.mjs` ten, v7.1 P3's `verify-regimes.mjs` eleven, v7.1 P4's
`verify-elements.mjs` twelve and v7.1 P5's `verify-composer-grid.mjs` thirteen, where v7.1 P6
left it, and v8's `verify-hero-manifest.mjs` fourteen: **fourteen browser-free scripts**, and
`CI-SCRIPT-COUNT` derives that number from `ci.yml`'s own run lines and fails if any place this
document states it disagrees). They run first in the
suite for the same reason the first two do: they are instant, and a failure there means the
GPU half is not worth starting.

**v7.0 C1 added the comparator layer's pair** — `verify-experiment.mjs` (browser-free, in CI)
proves the bench's doctrine on fake casts and holds the extracted power-law fit bit-for-bit
against a verbatim copy of the inline code it replaced; `verify-experiment-gpu.mjs` runs the
real casts, anchored on the KR-1998 tip velocity — a constant the v7 arc does not touch,
deliberately not `K_MC`, which the pinning and recrystallization milestones are designed to
move.

**Requirements**: a WebGPU-capable Chrome/Chromium at the path hardcoded in each verify script
(`C:\Program Files\Google\Chrome\Application\chrome.exe`) — Windows with a real GPU. **No
script falls back to a software renderer** (the two that forced `--use-angle=swiftshader` were
the dive's, removed with it in v8 U4), so the browser scripts simply fail on a GPU-less host,
except `verify-hero.mjs`, which runs with WebGPU removed and needs no GPU; it still needs the
hardcoded Chrome path and the 5199 server, so it is not in CI either.
**This is not portable to a generic hosted CI runner as-is** — the
executable path and WebGPU/ANGLE availability are both host-specific, which is why CI gates
only the OS-agnostic steps — typecheck, build, and the fourteen browser-free scripts
(`verify-units.mjs`, `verify-rng.mjs`, `verify-heattreat.mjs`, `verify-thermal.mjs`,
`verify-fade.mjs`, `verify-porosity.mjs`, `verify-experiment.mjs`, `verify-phasedata.mjs`,
`verify-alloy.mjs`, `verify-phasediagram.mjs`, `verify-regimes.mjs`, `verify-elements.mjs`,
`verify-composer-grid.mjs`, `verify-hero-manifest.mjs`; see
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
  v7.0 C3a adds the two browser-free halves of stored energy: `SE-STRUCTURE` (the kernel's text
  invariants — the stored binding is `read`, and the 2D kernel carries no stored term) and
  `HT-TEMP-SENSITIVITY` (the furnace enters through the sweep count and nowhere else, so two
  schedules at different temperatures must give byte-identical kT and recovery rate).
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
- **`verify-phasedata.mjs`** (browser-free, v7.1 P0) — the binary invariant table, and since
  v7.1 P6 the documents that quote it. Eleven
  checks. The first seven are all about totality and both polarities rather than about whether any one number is
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
  `PD-DOC-CONSTANTS` (v7.1 P6) is `HT-DOC-CONSTANTS`' mechanics one layer over: a claim list
  across **six** documents — `index.html`, `science/index.html`, `README.md`, this file,
  `src/tour.ts` and `src/alloy.ts` — every claim a string BUILT from a module export rather than
  typed, and every one carrying its units, because "1" as a claim is satisfied by any page
  containing the digit one (the gate prints its own claim and ban counts, so they are not
  restated here to go stale). It covers the table version, the Al–Si and Fe–C invariants, A356's freezing range
  recomputed through `derive()`, and the four `derive()` outputs that were quoted as prose with
  nothing recomputing them: the two normalised liquidus values the honesty page's first flaw
  turns on, and the two growth-restriction factors on the front door. The plan named four
  documents; `index.html` is the fifth because that is where the retracted claim actually lived
  and where both Q values are printed, and a list without it could gate neither. `src/alloy.ts`
  is the sixth, added when the audit found the Scheil floor's justification quoting a k-ratio
  span — "0.68 to 3.30" — that no set in the tree produces: 3.30 is a peritectic the gate it
  credits excludes. Both spans are now recomputed from the two tables.
  The **bans** run beside them, and they self-test: each carries a fixture that MUST fire and a
  real sentence from this tree that must NOT, both pushed through the same scanner the documents
  go through. That is deliberately not the per-ban negative lookahead the plan called for — this
  repo has twice shipped a ban that matched the sentence describing it, and N hand-written
  lookaheads are N chances to repeat that. Instead the scanner strips, once, what is quotation
  rather than claim: backticked spans in markdown, HTML comments, TS comments. Which is why the
  banned strings appear in this paragraph inside backticks — `refined the metal eight-fold`,
  `genuinely refines the grains`, `data-count="369"`, the composer's solute set called closed,
  the per-solute slider `cap` presented as a solubility limit, and the superseded material
  count. The fixtures are what prove the stripping did not quietly neuter the pattern.
  `CI-SCRIPT-COUNT` (v7.1 P6) closes a hole nothing was watching: this document states, in three
  separate places, the size of the CI-runnable set; the v7.1 arc added six members to it; and no
  gate compared the two. The count is DERIVED from `ci.yml`'s own `- run: node scripts/verify-*.mjs`
  lines and every stated site must agree with it. Liveness on both halves — the derived count
  must be greater than zero, so a renamed workflow step cannot make the comparison vacuous at
  zero, and at least three sites must be FOUND, so a heading rewrite that dropped two of them
  fails here instead of silently reducing this to a one-site check.
  `PD-LANDING-FIGURE` (v7.1 P6, added by the milestone's own review) settles what
  `PD-DOC-CONSTANTS` cannot. The front door's Al–Si drawing is hand-typed SVG, deliberately, so
  that `phasedata.ts` stays out of the landing chunk — and that put its geometry out of reach of
  every gate. Checking that "1.65 wt%" and "577 °C" APPEAR is not checking where they are drawn:
  measured, moving the marker to 10.2 wt% and 74 px off its own liquidus left all thirteen
  browser-free gates green. The figure is now re-derived from the row through **its own axis
  line**, so a wrong drawing and a drawing of a wrong row fail separately — the solvus standing at
  C_SM, the two bands meeting on it, the marker's abscissa at `data-c` and its ordinate on the
  liquidus chord, the drop line hanging from the marker, the solidus origin shared with the
  liquidus (the point `landing-motion.ts` interpolates from), and the pour agreeing across the
  figure, the chip and the CTA hash. It self-tests on the bans' fires/spares pattern: the
  identical parser runs again over an in-memory copy with the marker displaced, and the gate
  fails if that fixture does not produce a violation.
  `TESTING-CHECK-COUNT` (v7.1 P6) is the same idea one level down, and it exists because one
  level down is where the rot was: the P6 audit of this document found **eight** stated counts
  wrong at once — `verify-units.mjs` said eight and has nine, `verify-quant.mjs` said ten and
  has eleven, `verify-3d.mjs` was cited as a 23-check suite and prints 30, `EL-DOC-CLAIMS` was
  called sixteen claims and checks seventeen, `ALLOY-REFUSE-NAMED` eight input shapes against
  fifteen driven, the element reasons 31 skeletons against 32. Hand-correcting eight numbers with
  nothing under them is how there came to be eight. Wherever a bullet in this file states a check
  count in words, the gate counts the DISTINCT gate NAMES in the script that bullet's own header
  names, and requires the two to agree. Distinct names rather than `check(` call sites, because
  `PD-FIGURE-CURSOR` reports from two branches and a call-site count would make this document
  wrong for being right; and attribution by bullet header rather than by proximity, because
  `verify-scale3d.mjs`'s entry contains the phrase "the full 30-check volume suite" about a
  different script entirely. Ten sites today, with a liveness floor of six.
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
  below 0.75 wt% total is invisible to the solver's c0). `ALLOY-REFUSE-NAMED` drives fifteen
  input shapes that used to be silently dropped, requires each refusal to exceed 20 characters
  and to contain the offending key, requires the DISTINCT count to equal the number driven,
  and requires an un-triggered control to raise none — so a function that always returns
  refusals fails. It also records by name the drop sites it does NOT drive, including the one
  measured to be unreachable. `CALIB-MIX-OWN` recomputes the poured mix's reference interval
  independently, asserts the branch label against the temperature test in both directions,
  asserts the identity ΔT₀·k_eff = Q, and asserts that every preset which calibrates differs
  from the material default. `CALIB-MIX-REFUSE` drives six mixes with no reference interval
  and asserts WHICH clause fired for each — a refusal naming the wrong mechanism is a wrong
  statement rather than an absent one. Since v8 U1c `dT0Source` is the learn-mode text and
  `dT0Line` is what the composer prints with learn mode off, so both gates hold the on-screen
  line to the same clauses: the EXTRAPOLATED GAUGE label, the real primary range and the ratio
  (or, for 4340, "no primary freezing range left" and no ratio), no negative kelvin figure, and
  each refusal's clause and offending value, six distinct lines for six cases. A DILUTE line
  prints a solidus temperature, and `CALIB-MIX-OWN` requires it to say "linear solidus" (the
  learn text "straight-line solidus"), with at least one shipped preset in that branch: the
  number is TmC + (m/k)c, and 2024's reads 579.6 °C against a real solidus near 500 °C. `CALIB-MIX-OFF-IDENTITY` is the one that protects the
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
- **`verify-phasediagram.mjs`** (browser-free, v7.1 P2) — the drawn phase diagram. Four checks.
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
  asserted exercised by shipped presets, and the residual offset is required present exactly
  when it is non-zero — NOT "present iff multi-solute", which is the claim the first version made
  and which hid a real defect: tin bronze has one solute, so that test said "absent" and passed
  while its marker floated 30.8 K above the drawn line, because Cu–Sn's dilute slope and its
  invariant chord disagree by half again. The residual must also start on the drawn liquidus, end
  on the marker, and decompose additively into its two causes — the other solutes and the
  chord-versus-dilute gap — with both causes shown dominant for some shipped preset. Since the
  v8 U1c review it also reads the NOTE that explains that bar, over the presets and three named
  cases (Ni–5Nb–1W, Al–0.175Fe, Al–1Cu): each printed part carries its own direction, "down"
  (it puts the marker below the drawn line) or "up", that direction matches the sign of the
  part it describes, and the signed parts add up to the signed total the note prints (the U1c
  cut gave the first part no direction, so Ni–5Nb–1W's 1.0 K from W, which raises the
  liquidus, read as "below"); a residual that rounds to 0.0 K prints no note, no part prints as
  0.0 K and no note ends on a colon; opposite-signed parts and a silent residual must each be
  met at least once. And the standing chord note may call the chords "the boundaries the solver
  uses" only on an isomorphous figure, whose lines are drawn from the solver's own m and k: an
  invariant row's chords join the pure metal to the cited invariant point while the solver
  integrates the dilute slope, so neither the line nor its learn text may claim it there (every
  pair, drawn at half its slider range). `PD-NO-ROW-REFUSES` drives eleven
  undrawable cases — the five materials with no alloy base, an unknown material, a pure melt, an
  unknown base, an inherited object key, all-zero weights and the geometrically impossible ni-W
  row — and requires each refusal to exceed 40 characters, at least five distinct reasons among the eleven, and
  ni-W's to name the geometry rather than claim there is no row; both polarities, so a `layout()`
  that refused everything cannot pass. `PD-FIGURE-CURSOR` settles the three absences without a
  GPU: a temperature on the diagram is drawn, one off it is NOT drawn and IS named, and null is
  silent — "no liquid left" and "below the axis" are different facts and the panel says so.
  (A figure note is `{ line, learn }` since v8 U1c; the naming is required of the LINE, the
  half on screen with learn mode off.)
  `PD-CHAPTER-PURE` (v7.1 P6) gates the claim the new tour chapter makes, on the layer where it
  can be gated: the chapter opens the composer and tells the reader to drag SI across 1.65 wt%,
  and it cannot step them through the modal, so what it asserts has to be true of `layout()` and
  `derive()`. Crossing C_SM must change the regime, move BOTH vertices of the shaded band to the
  row's own numbers, and change what the app says it will not grow — with the second phase named
  on the rich side and absent on the lean one. **Two pairs, because one cannot show both
  polarities.** The plan said the crossing "flips `notGrown` from absent to present"; measured,
  that is false for Al–Si, where a lean charge already carries a Gulliver–Scheil caveat at
  1.60 wt% because 9.3 % of it goes through the eutectic anyway. What flips there is the KIND of
  line — a Scheil-only caveat below, an equilibrium second phase above — which is the stronger
  claim, since a presence check passes on a line that was always there. Fe–C is where absent-to-
  present is real (nothing at 0.09 wt% C, one line at 0.10), so both shapes are asserted rather
  than one assumed of the other. The chapter itself is checked too: it exists, its `apply` opens
  the composer, and its prose names C_SM, the invariant temperature and the second phase.
- **`verify-regimes.mjs`** (browser-free, v7.1 P3) — the composition regimes, the invariant
  fraction and the ceiling. Five checks. `PD-REGIME-EXACT` classifies every row from BOTH sides
  of BOTH of its boundaries: C_inv ∓ 1e-9 and C_SM ∓ 1e-9, with the exact regime asserted on
  each side rather than "A356 comes out two-phase", which one hardcoded branch would satisfy.
  Across C_inv the NAME of the first phase to freeze must change, and both names are read out of
  the table — `(Al)` from BASES, `θ-Al2Cu` from the row — so two empty strings cannot pass
  as "different". The two rows whose base solid is the peritectic PRODUCT (Al–Ti, Mg–Zr) have
  C_inv < C_SM, so their whole two-phase band lies past the invariant; that topology is asserted
  separately, and it is why C_inv is tested first — in the other order those rows report
  SINGLE-PHASE for a melt whose first solid is Al3Ti. It also gates the shaded band on the P2
  figure, whose edges are `Object.is`-exactly the row's own C_SM and C_inv. Since v8 U1c each
  regime has two halves, the learn-mode `source` and the on-screen `line`, and both are held at
  every sample: the line present, number-clean and naming its own solute, and a SINGLE-PHASE
  line keeping its qualifiers on screen ("at T_inv", "at equilibrium" and "no solvus below
  T_inv"), because a bare "single-phase" reads as the casting's state when cold and 2024 is
  (Al) + θ at room temperature.
  `PD-INVARIANT-BAND` recomputes the lever rule and Gulliver–Scheil inside the gate to 1e-9 over
  every eutectic row and asserts the ordering lever ≤ Scheil at every sampled composition, both
  monotone in composition. It also pins the two things an adversarial review corrected in this
  milestone: the peritectic refusal must give the DATUM-based reason (at a eutectic every drop of
  remaining liquid freezes at T_inv, so its fraction IS the share that freezes there; a peritectic
  consumes only part of it and the rest freezes below T_p) and the retired, false explanation —
  that the lever rule and Scheil "do not describe a peritectic" — is BANNED from coming back; and
  a reactant-peritectic melt richer than the reaction's own product must report the primary
  CONSUMED and drop it from the equilibrium set, while a leaner one must retain it. The
  peritectic's on-screen regime line (what the readout and the figure print with learn mode off)
  must name the reaction and say "no fraction", and, for the row whose product composition is a
  bracket (Fe–Ni), say "bracket", the same clauses the learn text is held to. Its anchors are INDEPENDENT statements rather than the same formula
  twice: as k → 0 the solid takes nothing, so mass balance alone fixes the eutectic share at
  c₀/C_inv and Gulliver–Scheil must approach it; the lever rule is linear, so a quarter of the
  way across the band it is exactly 0.25, which a flipped lever gives as 0.75. Pb–Sn
  (61.9 wt% Sn, 183 °C, 18.3 wt% solubility) drives all of them as GATE-LOCAL data — a row for
  it in `phasedata.ts` would break `PD-ROW-SOURCED`'s bijection, since Pb is not a base metal.
  Five of the table's seven peritectic rows are asserted EXCLUSIONS that refuse the fraction by
  name, so a predicate that silently swallowed them could not pass; the other two (Al–Ti, Mg–Zr)
  are the product peritectics whose whole two-phase band lies past the invariant and which
  `PD-REGIME-EXACT` handles separately. `ALLOY-PHASES-NAMED` drives both
  polarities over the nine presets: seven emit at least one `notGrown` line and two emit none,
  with every line containing that row's own second-phase token, and the two columns
  (EQUILIBRIUM LEAVES / SOLVER GROWS) must differ by exactly as many phases as there are
  lines. The lines are the on-screen half since v8 U1c, so a peritectic's refusal is read off the
  line as "no fraction", and every line must carry its learn text (`notGrownLearn`, the same
  string `derive()` files under the line in `d.learn`), where a peritectic's still says "No
  fraction is put on it". `PD-CAP-CEILING` asserts the POSTCONDITION rather than the implementation —
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
  never null, and every non-ASSESSED sentence over 25 characters (the shortest is 177). The
  distinctness clause counts sentence SKELETONS — base labels, element symbols and every number
  replaced — because the naive distinct-string count is vacuous when every sentence interpolates
  its own element: measured on this tree it is 488 of 708, and it would pass a file that said
  "X is not available in Y" seven hundred times. There are 32 skeletons, no one of them may cover more than half the grid (the largest covers
  294 of 708), and no two REASONS may
  share one, because a refusal naming the wrong mechanism is a wrong statement rather than an
  absent one. Liveness runs both ways: all four tiers non-empty, every base admitting something,
  and the ASSESSED count equal to the number of pairs holding both a cited `Solute.source` and a
  `phasedata` row — 25, computed rather than written. Every one of the 708 is then driven through
  `derive()` as well, and ASSESSED must hold if and only if the pour is accepted, so an admission
  and a pour cannot drift apart. Every PAST-THE-INVARIANT answer, driven at the ceiling and one
  step past it, must carry its own wt% and its ceiling in BOTH halves: the sentence (learn mode)
  and the `line` the reason panel shows with learn mode off. Since v8 U1c the sentence is the learn-mode text and the vapor
  advisory has two halves too, the on-screen `line` and the learn `text`: each half must carry
  " atm" exactly when a pressure was computed, and a refused one must say which of the five
  reasons applies without printing a pressure. `EL-TROUTON-CROSSCHECK` checks the vaporisation data against a
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
  must name the activity coefficient the app does not have (both halves, since v8 U1c). The
  ideal-solution caveat is held on both halves as well: kept by the lines between the cutoff and
  the fume threshold, dropped only where the hundredfold headroom holds. Bands are asserted at the composition
  each claim is about — pure zinc into a charge BOILS, 1 wt% dissolved is a FUME — which is a
  distinction the first draft of the gate got wrong. `ALLOY-MOVES-THE-PHYSICS` replaces the
  deleted bundle-delta metric: every assessed pair at its own probe composition must move the
  UNCLAMPED liquidus by at least 0.5 K (half the measured minimum of 1.0 K) with a finite Q, and
  beside it a named CLAMP-SWALLOWS report lists every pair the shipped c0 floor and mLiq clamp
  make invisible to the solver. Two are — Al–Ti and Mg–Zr, both grain refiners, which move the
  liquidus 2.3 K and 2.0 K and the growth restriction factor 18.4 K and 11.0 K while moving c0,
  mLiq and kPart by exactly 0.0000. That is a finding printed rather than a gate that cannot go
  green. `EL-DOC-CLAIMS` gates this milestone's prose in the commit that writes it, on
  `PD-DOC-CALIBRATION`'s mechanics one layer over: seventeen claims recomputed from the modules and
  required to appear in `science/index.html`, with HTML tags stripped and typographic dashes
  flattened first so the gate cannot fail on typography, and with no claim allowed to be a bare
  small integer — "the ceiling binds for 5 pairs" is satisfied by any document containing the
  character 5, a lesson this repo wrote down at P3.
- **`verify-composer-grid.mjs`** (browser-free, v7.1 P5) — the periodic grid the composer now
  opens with. Seven checks, module load guarded the same way. `ALLOY-OPEN-IDENTITY` is the
  keystone and it is a NON-REGRESSION gate by construction, which is the honest description:
  P5 adds no pourable chemistry — ASSESSED is the same 25 pairs — so all 9 presets and all 25
  legacy pairs must derive a bit-identical `{alloyOn, c0, mLiq, kPart, dSol}` tuple and an
  identical `clamps[]` against a reference **measured on da16b5f, the commit before P5**. Not
  by reasoning that `alloy.ts` was untouched: a pre-P5 worktree was checked out and the same
  generator run against both trees, and the two JSON payloads compared byte for byte, because
  "I did not change it" and "it does not behave differently" are different claims. Equality is
  trivially satisfiable, so three more clauses carry the gate — every arm separately proven
  ALIVE (c0 > 0, kPart inside (0,1), dSol > 0, a non-empty name, real solute entries), a
  deliberately perturbed control mix (A356 with its silicon moved by a tenth of a per cent)
  required to produce a DIFFERENT tuple so a comparator stuck at "equal" fails, and the same
  mix with its keys reordered required to still MATCH so the comparator is not merely
  sensitive to something else. `Object.is`, not `===`, so a sign-flipped zero counts as a
  difference. The clamp STRINGS in that reference were re-baselined on purpose in v8 U1c, when
  three of them lost an em dash to a colon; every number is still the da16b5f measurement.
  `ALLOY-SHARE-PRE-P5` restores fifteen links minted before this arc — including
  the landing page's own published `#alloy=al:Si7,Mg0.35,Ti0.12` and the three that clamp
  against a P3 ceiling — and requires the mix, the refusals, the `clamped[]` signal and the
  re-encoded string to be unchanged; then proves structurally that no grid cell can put a new
  symbol into a link, because every element the grid calls ASSESSED is already in that base's
  solute set. `GRID-LAYOUT-TOTAL` places all 118 elements in the 18-column table with no two
  sharing a cell, pins nineteen positions by hand, requires the two sockets under scandium and
  yttrium to stay EMPTY, and requires the drawing to agree with the `block` column the data
  already carries — so moving lanthanum in one place and not the other fails the build.
  `GRID-REASON-LINE` walks all 708 pairs: every one has a one-line reason, none is a prefix of
  its own sentence (the mechanical form of "composed, not truncated"), none leaks a
  placeholder, the 708 lines carry 33 distinct skeletons with no two reasons sharing one, and
  **29 cells are pinned by BRANCH with a marker each must carry and one it must not** — the
  shape P4's second review proved a count of shapes cannot replace. (v8 U1c de-dashed these
  lines, so the markers that held an em dash, "REACTS — to AlN" and "oxygen does dissolve — it
  is probed in-ladle", now read "reacts to form AlN" and "(it is probed in-ladle)", and a
  must-not that named another branch's old words follows that branch's new ones.) It also holds the
  composition the grid asks at: 25 pairs are ASSESSED at each pair's own `probeWt` and only 22
  at a flat 1 wt%, and the three that would have painted as refusals are named (al-Ti, fe-C,
  mg-Zr). `LANDING-CLOSURE-CLEAN` walks the static-import closure from `src/landing.ts` and
  requires it not to reach `elements.ts`, `alloy.ts`, `phasedata.ts`, `composer.ts` or
  `phasediagram.ts`. Deliberately the SOURCE closure and not a grep of `dist/` — `npm test`
  does not build, so a bundle-reading gate would either fail on a fresh clone or be allowed to
  skip, and a gate that can skip is not a gate — and the closure is the mechanism rather than
  the symptom, since Rollup hoists a module into a shared chunk exactly when two entries can
  reach it. `GRID-DOC-CLAIMS` gates this milestone's own prose in the commit that writes it, on
  `EL-DOC-CLAIMS`' mechanics one layer over: 15 claims across **two** documents —
  `science/index.html` and `README.md`, because the README quotes the mercury advisory's own
  computed pressures and a `derive()` output printed as prose with no gate on it is exactly the
  failure C0b was built to close — with every expected value recomputed from the modules, tags
  stripped and dashes flattened so it cannot fail on typography, and no claim allowed to be a
  bare small integer. It caught two of its own subjects while being written: "at half its own
  invariant composition" (false wherever the ceiling exceeds 2 wt%, since `probeWt` is a `min`)
  and a fume-stripe mechanism given as "hundreds of degrees" when the measured bracket is
  11 K at one end and 54 K at the other. Four of the six P5 checks FAIL against the pre-P5 tree,
  verified by running them there; the two that pass on both are the non-regression pair, which
  is what they are for. `COMPOSER-COPY` (v8 U1c) holds every string the composer can print to
  `docs/COPY-STYLE.md`, read from the functions that compute it rather than from a browser
  sample, because almost all of it is computed: all 708 grid lines and sentences with their
  vapor and size readouts (and the past-the-invariant and not-a-composition compositions the
  probe cannot reach), `derive()` over the presets, every pair at four compositions and every
  refusal shape, the share-link refusals, and `layout()` over all of those with the melt on the
  diagram, off it and in the wrong crucible. It sorts them into LINES (on screen: no prose em
  dash, no British spelling, no repo path or milestone code, no NaN/undefined/null, one line
  under 200 characters) and LEARN texts (the same bans, and 1 to 2 sentences), and requires
  every caveat line `derive()` raises and every figure note to carry a learn text of its own.
  The phase diagram's source line is each row's `cite`, all 25 of which must be complete (no
  "…") and 30–130 characters, and the figure must print exactly that one. Both detectors are run
  on a fixture first, and liveness requires computed and refused vapor lines, six refusal
  kinds, all four clamps, all four ΔT₀ regimes and the cursor, chord and dashed-line notes.
- **`verify-hero-manifest.mjs`** (browser-free, v8, in CI) — the landing hero's pre-rendered
  frame set against the contract that the Blender renderer and the page were both written to:
  180 square, opaque WebP frames on `#0a0b0d` at 1200 and 600 px, a poster at each size, and
  `public/hero/manifest.json`. Six checks, each in its own try/catch. `HERO-MANIFEST-SCHEMA`
  holds the top-level keys, the four chapters (seed 0–11, grow 12–95, cool 96–119, tour
  120–179) and the five feature windows to the contract exactly, because the page's chapter text
  and callouts are keyed to them; contiguity, windows inside the tour and windows that do not
  overlap are asserted on their own as well, so the message names the property that broke. It
  also requires the poster frame to be a tour frame (the contract's "a tour frame in which all
  five features are visible"; the placeholder named frame 119, in the cool chapter, until this
  clause, and now names 120, which has the same camera and the same anchors).
  `HERO-MANIFEST-ANCHORS` requires 180 rows per feature in the right shape (a point is
  `[x, y, visible]`, a pair `[x1, y1, x2, y2, visible]`), every coordinate in [0, 1] and every
  flag 0 or 1, each feature visible for at least half of its own window, no visible in-window
  anchor within 0.06 of the frame's edge (the page's edge fade ramps over the outer 6 %, and the
  dot is not faded with it), and all five of the poster's anchors visible, since reduced motion
  shows every callout at once, and equal to its frame's own rows. `HERO-FILES`
  requires both sizes' 180 frames and both posters on disk and nothing else in the frame
  directories, so a stale 181st frame fails. `HERO-WEBP-HEADERS` parses every file's RIFF header
  by hand (VP8, VP8L and VP8X): the RIFF length equal to the file length, the size's own square
  dimensions, no alpha, no animation. `HERO-BUDGET` holds each set's total under its budget,
  12 MiB and 3.5 MiB. `HERO-PAGE-KEYS` ties the page to the manifest by id: every feature has
  words in `src/hero.ts`, the page has a block for each chapter it keys to, and the no-JS
  poster is the 1200 file. Each was made to fail once on a scratch copy of the tree, and each
  failed on its own clause: the grow/cool boundary moved by one frame, a coordinate set to 1.2,
  a poster anchor flagged invisible, a stray `f180.webp`, a truncated frame, a frame with real
  alpha (a fully opaque alpha channel is dropped by the encoder and correctly passes), two
  4 MB frames, a renamed copy key; and, added after review, the poster moved to frame 119, a
  poster anchor that disagrees with its frame's row, and a visible anchor 0.04 from the edge
  (0.07 correctly passes). Writing it caught the placeholder generator emitting off-frame
  coordinates as the tour panned. A manifest whose `source` says PLACEHOLDER
  (`hero/make_placeholder_frames.py`, the stand-in until the render lands) honors the contract
  and passes locally with a notice on every run, but FAILS `HERO-MANIFEST-SCHEMA` when
  `process.env.CI` is set, so a push to main or a PR cannot carry the stand-ins toward a deploy
  (`HERO_ALLOW_PLACEHOLDER=1` lets one run through on purpose).
- **`verify-composer-gpu.mjs`** (v7.1 P5) — `COMPOSER-GRID-PANEL`, the grid driven through the
  DOM the way a visitor drives it, and the first gate in this suite that clicks the composer.
  Its own file on the `verify-phasediagram-gpu.mjs` precedent: a panel gate sharing a page with
  kernels other gates have staged is a gate testing whatever they left behind. Both polarities
  everywhere. An ASSESSED cell adds exactly one solute row at the ceiling-aware default, and a
  refused cell adds nothing — a presence-only check passes on a grid that adds everything.
  Switching Al → Fe changes at least one cell's tier (14 do) AND leaves at least one unchanged
  (104 do) — a grid that refused the whole table would satisfy the first clause perfectly. The
  reason panel is compared against the exact string `admit()` returns for that pair, loaded
  from the module rather than retyped, and the aluminium and iron answers are required to
  DIFFER. The vapour stripe is checked as a SECOND channel: Al → Fe puts a fume mark on sodium,
  potassium, calcium and cadmium, none of which changed tier, so a grid wired to the tier alone
  cannot pass. And the three ceiling pairs are added by click and required to land one step
  UNDER their invariant rather than on it. `COMPOSER-LEARN` (v8 U1c) reads the modal in its two
  registers as VISIBLE text, with 1045 steel poured and the mercury cell open: learn mode off
  shows each caveat's line (the grid line, the vapor line, `dT0Line`, the ungrown-phase line, a
  clamp) and none of their learn texts, with no learn element and no "i" on screen; learn mode
  on adds each learn text from the same producer, the three "i" buttons (composer, element
  screen, phase diagram) and the readout hints, and the header's "i" opens exactly the
  composer's own explanation; turned off again, it all goes. In both states no prose em dash is
  in the modal's visible text or its tooltips. Since the U1c review: learn mode is switched with
  the MODAL'S OWN toggle, and only after `elementFromPoint` at its centre returns it (the top
  bar's toggle sits under the overlay, where a real click closed the modal, and the old gate's
  scripted `toggle.click()` skipped the hit test that would have shown it); the hint count is
  exact for each state (five for 1045, a peritectic with no "freezes at T_inv" row, six for
  A356 poured through its quick-fill) and `composer.learnAudit()` must report every declared
  hint bound; the ASSESSED Mn cell already in the 1045 melt is opened with learn off and on, so
  the tier chip "assessed · pourable" and the in-melt call to action (the composer's own
  literals, which no other gate renders) are scanned for dashes too; and no learn paragraph is
  shown twice, with the figure's repeats of the readout's clamp and regime paragraphs counted as
  held back, so the dedupe is seen working. `COMPOSER-DIALOG` (U1c review) drives the modal with
  real key presses: opened from the rail's own button with focus on it, the card is a
  `role="dialog"` with `aria-modal` and a label, focus moves into its header, every child of
  `#app` but `#tour` is inert, Tab from the last stop wraps to the first and Shift+Tab back,
  Space does not run the melt behind it, the reason panel is a polite live region describing
  the picked cell, and Escape closes it, lifts the inert and returns focus to the button; the
  positive control is that with the modal closed Space runs the melt again. Every clause the
  U1c review added here and in the browser-free gates above was proved able to fail with no
  worktree edit: fifteen perturbations of a scratch copy of the tree, each confirmed landed,
  each FAILing its own gate with its own named reason while that script's other checks stayed
  OK, each file restored byte for byte from the tree; and two runs of this file against a second
  dev server serving the copy with thirteen browser-side perturbations (a drifted hint key, an
  em dash in the tier chip, the dedupe off, the modal's toggle not hit-testable, focus left
  behind, no inert, no Tab or Shift+Tab wrap, Space reaching the melt, no live region, no
  Escape, inert left after close, focus not returned), each read off its own flag.
- **`verify-phasediagram-gpu.mjs`** (v7.1 P2, joined by `TOUR-PD-STEP` in P6) — `PD-CURSOR-LIVE`, the cursor against a real cast.
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
- **`verify-scroll-order.mjs`** — asserts the pinned scroll acts never overlap (hero → lens →
  materials, strictly in order). It exits 1 if any of the three pins is missing, if they start
  out of order, or if one starts inside another, so an empty pin list cannot pass as "no
  overlap". A new pinned act adds its trigger id to the script's `REQUIRED` list. The regression
  it was written for hit twice: a pinned ScrollTrigger created asynchronously after later pins
  had computed their start offsets without its spacer, so the acts interleaved. That pin was the
  scroll dive, removed from the landing in v8 U4 along with its two screenshot scripts. The v8
  hero that replaced it is pinned too, and it is the reason `src/hero.ts` creates its pin
  synchronously, before `landing.ts` awaits the GPU adapter the lens and materials pins wait on.
  Moving that call below the materials pin was measured to fail here: the lens pin then starts
  at 900 px, inside the hero's 0–3760.
- **`verify-hero.mjs`** (v8) — the landing hero driven by scrolling, against the 5199 server
  like the rest of the suite. It removes `navigator.gpu` on every page it opens: the hero must
  not need WebGPU (`landing.ts` boots it above the GPU gate), and without it the lens and
  materials sims stay off. Twelve checks, each in its own try/catch. `HERO-BOOT` (live mode with
  no WebGPU, the `heroAct` pin and its length; before the first scroll only the skeleton, frame
  0 and every 8th frame and the last, 24 files, and after it every frame; the set chosen by the
  rule, the smallest set at least as wide as the canvas in device px, which at the gate's
  1440 × 900 is the 1200 set for an 835 px canvas). `HERO-NONBLANK` (canvas pixels that differ
  from `#0a0b0d` at pin progress 0, 0.5 and 0.95). `HERO-FRAME-FOLLOWS` scrolls forward through
  all four chapters (seed, grow, cool, tour) and then back, requires the drawn frame to be
  round(p × 179), and then compares PIXELS: the gate fetches and decodes the expected file
  itself, draws it the way the page does, and requires the canvas to match it (mean difference
  under 0.1, measured 0.001 to 0.033) while a frame six away, the control, does not (over 0.5
  and over three times the match). The difference is taken over the region where either picture
  has crystal, not the whole canvas, which would divide it by the background's share: at the
  seed stop that made the control 0.599 against the 0.5 floor, and the region makes it 1.867.
  An index that moved without the picture moving cannot pass. `HERO-CALLOUTS` requires each
  callout shown at the visible frame nearest its window's middle, its dot within 1.5 px of the
  manifest anchor mapped through the canvas's drawn rect by the gate's own mapping, its label
  outside the frame on its own side, with its copy as written, and alone; then hidden three
  frames outside its window on either side, at every frame the manifest marks occluded, and in
  the hold. The occluded clause no longer depends on the render occluding anything: the gate
  also flips one interior frame's visible flag to 0 in the page's own manifest object and
  requires the callout hidden there and fully shown on the frames either side, and requires at
  least one occluded frame tested overall. (An earlier "over no crystal pixels" clause was
  removed: in live mode the canvas is the frame square, so a label outside it on its own side
  can never overlap a crystal pixel, and the clause measured nothing.) `HERO-CHAPTERS` requires
  each chapter's lines fully shown in its chapter and fully hidden elsewhere, split into more
  than one line, with the copy as written; and, on a second page with the manifest held back
  2.5 s, no chapter heading visible and the end chapter's link not hit-testable before the text
  timeline exists, since all three chapters share one place. `HERO-CTA` hit-tests rather than
  checking visibility: the opening's four links reachable at the top, the faded opening
  unreachable mid-growth, and the end's single filled CTA reachable in the hold. `HERO-CAPTION`
  (present, linked to `hero/README.md`, bottom-right and hit-testable at progress 0, 0.5 and
  0.95). `HERO-REDUCED` (under `prefers-reduced-motion`: no pin, the section scrolls with the
  page, the poster, all five labels on the poster's anchors, the chapter text stacked and not
  split). `HERO-NOJS` (JavaScript off: the 1200 poster as a plain `<img>` with alt text).
  `HERO-MOBILE` (390 × 844 at DPR 3: the 1200 set, by the rule; at every stop of the pin and in
  the still layout, no horizontal overflow of the document AND no rendered hero text, link,
  label or nav item past either edge of the screen, measured on the elements and on their
  text's own extent, because `#heroAct` clips its overflow and `#topnav` is fixed, so neither
  ever reaches the document's `scrollWidth`; the frame centered with the heading above it and
  the body below; every feature's label, at the visible frame nearest its window's middle, fully
  shown, titles only). `HERO-FALLBACK` (the still the code promises, served broken three ways by
  request interception: no manifest gives the poster alone with no pin left behind; frames 100
  onward missing from both sets fails each set by count, tries the 600 set after the 1200, and
  lands on the still with its five labels on the poster's anchors and nothing of live mode left,
  no extra callouts, no split text, no inline styles on the opening; the whole 1200 set missing
  runs live on the 600 set, its pixels checked like `HERO-FRAME-FOLLOWS`). `HERO-NO-ERRORS` (no
  page error, console error or failed same-origin request on any page it opened, except the
  404s and aborted fetches `HERO-FALLBACK` causes on purpose).
  Each was made to fail once by breaking the thing it guards, and each failed on its own clause:
  the pin switched off; the frame never drawn; the target one frame ahead; the anchor mapping
  shifted 6 px; the cool text never leaving; the end CTA's `pointer-events` removed; the caption
  relinked; reduced motion booted live; the no-JS poster pointed at the 600 file; the stacked
  heading rule deleted, and separately a 480 px block after the hero; a thrown error. The
  clauses added after review were broken the same way, each on a copy restored by hash, and
  each failed only its own check: the whole set fetched at once (`HERO-BOOT`); frame failures
  recorded but never acted on (`HERO-FALLBACK`); the pre-timeline hiding rule deleted
  (`HERO-CHAPTERS`); the phone's chapter body pushed 120 px past the right edge, which left the
  document's overflow at 0 (`HERO-MOBILE`, on the leaves alone); the visible flag ignored
  (`HERO-CALLOUTS`); the fallback leaving the live callouts in place (`HERO-FALLBACK`); and the
  old `dev < 900 ? 600 : 1200` size rule (`HERO-BOOT`, and `HERO-FALLBACK`, because that rule
  never runs out of sets and so never reaches the still). Two
  things its first runs taught. The scroll helper returned before ScrollTrigger had SEEN the
  new scroll, when a stale progress equals a stale scrub and every clause after it is trivially
  true, so it now waits for the trigger's progress to match the requested position first. And
  `HERO-CHAPTERS` found a real defect rather than a test one: the cool chapter is 24 frames
  (~430 px) and its text was fully legible for only ~105 px of that; the reveals were tightened
  until it holds from about frame 104 to frame 114.
- **`verify-optimizer.mjs`** — confirms "Engineer it" enters ML mode paused, that the run/pause
  transport gates the CMA-ES loop (it doesn't auto-start), and that exiting the mode restores
  normal transport. It mostly logs; its one verdict, `EXIT`, sets the exit code: the mode is
  left by the panel's `exit` button found by its text (v8 U1b: the header's first button is now
  learn mode's "i", which the old `#lab button` selector clicked instead, leaving the mode
  open), and afterwards the optimizer, the engineering transport and the panel must all be
  gone; a missing button fails by name. Until the U1b review this step never ran whenever the
  search converged inside the burst budget, because that branch applied the recipe and exited
  the process first, so the exit path was untested exactly when the run went well. It now runs
  on both paths: after an apply the script re-enters the mode and leaves it by the button.
  Proved able to fail with no worktree edit, twice, each time a second dev server serving the
  tree through one logged in-memory change to `src/optimizer.ts` and a copy of this script
  differing only in its hardcoded port: the button printing "leave" failed `EXIT` with
  `exitButtonFound: false`, and a button whose click does nothing failed it with the optimizer,
  its engineering transport and its panel all still up; exit code 1 both times. (Every run
  since has ended on the report branch, converged or stalled, so the paused branch's copy of
  the step is the one that rarely runs.)
- **`verify-tools.mjs`** — the v1.8 tool batch (faceted growth, `#set=` share-link round-trip,
  the analysis-panel enlarge modal, the specimen-tilt view) plus the v4.0 physics checks below,
  the lab gates (`LAB`, and v6.1's `LAB4` — the σ_y row must BE Hall–Petch on the gate's own
  census to the printed decimal, the verdict must judge the spec as dialled at the pour even
  when the dial is shoved to 999 mid-run, a no-spec pour must carry no verdict row, and the
  model metal must refuse by name) and the heat-treat share-link gates.

  v8 U1b re-pinned `LAB4`'s verdict with the copy pass. The row now reads
  `spec σ_y ≥ N MPa · met: casting at N MPa` (or `· missed:`), and the gate keys on
  ` · met: ` / ` · missed: `. It keyed on ` — met: ` and a bare `/missed/` before; de-dashing
  the row alone would have made the verdict clause read "none" and left the refusal guard's
  "met" half matching nothing. The estimator name the gate reads (`⟨A⟩-equivalent`) moved from
  the σ_y caveat to the census row, beside the d̄ it defines. The report's learn-mode sentences
  are empty `data-lrn` slots filled only while learn mode is on (`src/learn` `learnSlot`), so
  this gate, which runs with learn mode off, reads exactly the instrument's text; the same holds
  for `#htNote` and `#htReport` below. Proved able to fail with no worktree edit: a second vite
  server on a spare port served the tree through a transform that made three logged in-memory
  changes to `src/lab.ts` (the met and missed tokens renamed, and the model metal's refusal made
  to print ` · missed: `), and a copy of this script differing only in its hardcoded port ran
  against it: `LAB4` FAILed with `verdictWord: "none"` and `refuseC: false`, and the other 15
  checks stayed OK.
- **`verify-rail.mjs`** (v8 U0): the control rail never scrolls sideways, every slider's value
  is on screen, and nothing sits under the rail or on the chrome beside it; since v8 U1a also
  that learn mode works and that no prose em dash reaches the rail in the states and strings
  listed under `RAIL-NO-EMDASH` below. Nine checks,
  measured in the real app at 1280x720, 1440x900, 1920x1080, 1024x768 and 960x1000 (a
  half-screen window on a 1920 display), in 2D and TRUE 3D, with every rail section opened by
  clicking its heading, every rail sample taken twice (learn mode off, and on with every
  section's explanation expanded), and every box read only after the CSS transitions a resize
  or a rail toggle starts have finished. `RAIL-NO-HSCROLL` (rail `scrollWidth <= clientWidth`),
  `RAIL-ROWS-INSIDE` (every slider row is a grid, and its label, slider and value sit inside the
  rail's content box; no zero-width value; at least 15 values per sample), `RAIL-TEXT-WRAPS`
  (every rendered element AND every rendered line of text inside the content box, learn text
  included: every learn sample must show at least 30 learn elements),
  `RAIL-VAL-FITS` (each slider driven to its min and then its max in a real material, reading
  every value after every step: each stays on one line inside the rail; liveness is per state,
  so the calibrated sweep must have read the coupling λ row, 17 characters with its W₀/d₀, and
  some sweep must have printed a K/s rate in exponent form, 10 characters, the widest seen being
  `2.9e+9 K/s` from the 3D sweep), `RAIL-CLEAR` (with every lens legend and analysis panel that
  can appear beside the rail switched on, and all of it again with the rail hidden: no chrome
  and no mode panel overlaps the rail; the items sized against the transport bar, meaning the
  mode panels, the hint, the SEM bar and the HUD, stay clear of it; the lens bar, `#head`'s
  three text lines measured as rendered text with a long alloy name in `#matline`, the
  readouts, the learn toggle, CONTROLS, the TRUE 3D switch, the view cube and the scale bar
  never overlap one another; and every open mode panel holds its content, with no sideways
  scroll, nothing painted past its content box, and no slider in it under 60 px), `RAIL-HIDE`
  (at 1280x720 and on a 390x844 phone: the toggle moves the whole rail off screen, and
  CONTROLS, the switch, the view cube, the HUD and both analysis columns to 14 px from the
  window's edge and the lens bar's center to where the CSS puts it; showing the rail again
  puts each back beside it; CONTROLS is on screen in every state, and the learn toggle is on
  screen 6 px left of it, or just under it (a gap of at most 12 px) exactly where the CSS
  rule `--learn-drop` says that row has no room, which is only the phone with the rail open;
  the expectation is derived from the measured CONTROLS offset, so a drop at a desktop width
  fails, and both placements must have been expected in some sample),
  `SLICE-ROWS-INSIDE` (the SECTION PLANE popup, whose rows share the grid), `RAIL-LEARN`
  (v8 U1a: off for a new viewer, nothing stored and nothing rendered; `ui.learnAudit()` finds
  an entry per section, a section per entry and every declared hint bound to its control; a
  real click on the top bar's toggle sets `aria-pressed` and stores it; every visible section
  header then has an "i" that is a focusable `<button>` with `aria-expanded` and an
  `aria-controls` body right under the header; Enter and Space open an explanation without
  opening or closing the section; the header's title is itself a `<button>` whose
  `aria-expanded` and `aria-controls` describe the section body, reached by one more Shift+Tab,
  and Enter closes the section and Space reopens it; Space still runs and pauses with nothing
  focused (the positive control for the clauses that say it did not), and after a MOUSE click
  on the learn toggle, an "i" or a lens button it still runs and pauses and does not press
  that button again (the first cut read `:focus-visible`, which Chrome sets on a clicked button
  on the Space keydown itself); every explanation is 1 to 2 sentences; every hint is one line
  and shows exactly when its control does, in every learn sample, at least 15 per sample; off
  again renders nothing, in every learn-off sample too; the setting survives a reload; with
  `localStorage` made to throw, the page boots with no error of its own and the toggle and
  headers still work, the perturbation's landing checked; and every learn string any material
  or state can show, read from the modules, is 1 to 2 sentences, with hints under 49
  characters) and `RAIL-NO-EMDASH` (v8 U1a: no prose em dash in the rendered rail text or its
  tooltips, learn off and on, in every sample and once more with a composer mix poured in
  calibrated mode, whose source line lands in the SCALE calibration readout and must be found
  there, nor in any of those strings or in the calibration line of each of the nine famous
  presets poured; only an exact `—` text node, the empty-value glyph, is allowed, so a spaced
  ` — ` alone between two elements counts as prose; both copies of the detector, the page's
  and the script's, are run on one fixture first). It also writes
  twelve screenshots, `rail-{2d,3d}[-learn]-{top,mid,bottom}.png` at 1440x900, to the output
  directory for a person to look at.

  Puppeteer hides scrollbars in headless mode by default, which hands the rail 10 px no visitor
  gets, so this script launches with `ignoreDefaultArgs: ["--hide-scrollbars"]` and requires a
  real scrollbar in at least one sample. It was proved against the defect before it was trusted:
  on the old CSS (268 px rail, flex rows, no `min-width: 0` on the slider) it fails six of its
  seven clauses, `RAIL-NO-HSCROLL` with exactly the audit's 305 against 257. With the old row
  rules on the new 340 px rail, `RAIL-NO-HSCROLL` alone would have passed (the rows come to 291
  of 301 px) while sub-panel values ran into the padding and the calibrated readouts wrapped,
  which is why the content-box and one-line clauses exist. `RAIL-CLEAR`, `RAIL-HIDE`,
  `SLICE-ROWS-INSIDE` and `RAIL-TEXT-WRAPS` were each broken on purpose once (heat-treat panel
  sized to the window, hide transform fixed at 268 px, the popup's column override removed,
  notes forced onto one line) and each failed on its own clause. That last one is why
  `RAIL-TEXT-WRAPS` measures text lines as well as element boxes: a one-line note running past
  its own block leaves the block's box where it was, and the element half passed it.

  A review of the first cut found what the gate could not see then: at 1024x768 the HUD's
  cards covered the transport bar's pause, x1 and rec buttons, the optimizer's target slider
  was 0 px wide, the TRUE 3D switch covered the CURV lens button, and the scale bar sat under
  that switch at every width (it did before the rail change too); at 960 the lab and
  heat-treat panels scrolled sideways or painted values over the rail; with the rail hidden
  the hint and the mode panels reached the transport bar; and the pooled `RAIL-VAL-FITS` floor
  passed on the 3D rate alone. The clauses added for those were proved the same way, by injecting each defect
  as a style or script override after load (no source edit) and running the whole gate:
  `#hud` uncapped, the switch pinned at `top: 50px`, the scale bar put back beside the rail,
  `body.railHidden #hud` given a fixed offset and `setCalibrated` made a no-op failed
  `RAIL-CLEAR` (the HUD over the transport bar at 1024 and 960; switch over lens bar; switch
  over scale bar at all five widths), `RAIL-HIDE` (`hud not at the edge`) and `RAIL-VAL-FITS`
  (`calibratedCouplingRead: false`, with `2.9e+9 K/s` still printed). The panel floor removed,
  `--center-inset` tied back to the rail, the optimizer's header unwrapped with its slider
  floor dropped, and `#matline` uncapped failed `RAIL-CLEAR` on the panels' overflow at 960,
  a 0 px slider at 1024 and 960, the hint over the transport bar with the rail hidden, and
  `#matline` under the lens bar at 1024. The mode panels themselves stayed clear of the
  transport bar in that run: their own `left` clamp (`.modepanel`, `app/index.html`) is a
  second guard that does not depend on `--center-inset`.

  The two v8 U1a checks were proved without a source edit too: a second dev server, on a spare
  port, served the tree through a vite transform that made three in-memory changes and logged
  each one as it landed, and the whole gate ran against it. A prose em dash in the seed readout,
  and one in the quasicrystal's learn sentence (no sampled state shows that material), failed
  `RAIL-NO-EMDASH` on both halves: the rendered text, learn off and on, and the module strings.
  A hint key that no longer matched its control's label failed `RAIL-LEARN` (`hintsUnbound`).
  The other seven checks stayed OK in that run.

  The clauses the U1a review added were proved the same way, four logged in-memory changes on
  a second server in one run: the Space guard put back on `:focus-visible` failed `RAIL-LEARN`
  (after a mouse click the learn toggle and an "i" were pressed again and the run did not flip,
  and the ETCH lens did not flip it; the nothing-focused control still flipped);
  `pouredMixSource` put back to the mix's `dT0Source` failed `RAIL-NO-EMDASH` on both halves
  (the poured rail, learn off and on, and the A356, 1045, 4340 and tin bronze lines); the
  section header without `aria-expanded` failed `RAIL-LEARN` (`headOk`); and `--learn-drop`
  forced on at every width failed `RAIL-HIDE` at 1280x720 in all three states and on the phone
  with the rail hidden, where the old clause accepted "under" anywhere (`RAIL-CLEAR` saw that
  drop only at 1024 and 960, as the switch reaching the lens bar). The other five checks stayed
  OK.

  The U1b review extended the gate past the rail, because learn mode is what makes the other
  bottom-anchored surfaces grow and nothing sampled them with it on. Every mode panel sample is
  now taken twice, learn off and then on with the panel's "i" open (13 panels opened, 130 panel
  audits, 70 of them with the rail hidden); the analysis columns are sampled with learn on and
  one explanation open per column, in 2D (ETCH) and TRUE 3D (SLICE, with the SECTION PLANE
  popup's explanation open too); and one more panel state carries a real report: a 4 h anneal
  of a seeded 512² aluminum casting, whose card (with learn on) had taken the uncapped heat treat
  panel to -48 px at 1024x768. `RAIL-CLEAR` then holds every open mode panel, both columns and
  the popup against the top chrome (the lens bar, `#head`'s lines, the readouts, the learn
  toggle, CONTROLS, the TRUE 3D switch, the view cube and the scale bar), never against one
  another, and fails any of them whose top is above the window; its liveness requires the
  learn-on samples to have had explanations open, each column and the popup and some mode panel
  to have been capped (scrolling) in a learn-on sample, and the treated card to have been on
  screen. `RAIL-LEARN` adds the panels' hint audit (`panelLearnAudit()` in
  `src/learn/panels.ts`: every declared panel hint bound, matched by the label its control
  prints, 16 today), learn text in every learn-on panel audit and none in a learn-off one, and
  every panel hint one line and shown exactly with its control; the panel learn strings, hints,
  caveat lines, report-card and status sentences and the thermal notes join the module strings
  that `RAIL-LEARN` holds to 1 to 2 sentences and `RAIL-NO-EMDASH` scans. `SLICE-ROWS-INSIDE`
  samples the popup with learn on as well (on the Niyama cut style, its tallest state), its CT
  sweep hint shown and on one line. Proved able to fail with no worktree edit: a second dev
  server on a spare port served the tree through a vite config whose plugin made three logged
  in-memory changes (the three `--top-band` caps removed from `app/index.html`, the lab's
  "mold shape" hint keyed "mould shape", and the CT sweep hint put back to its two-line text),
  and the whole gate ran against it. `RAIL-CLEAR` FAILed on the clauses it gained: panels above
  the window (the lab panel at -31 px at 1280x720 with learn on, the treated heat treat at
  -185 px at 1024x768 and -22 px at 960x1000, the 3D column at -78 px), the lab panel and the 2D
  column over the learn toggle, CONTROLS, the TRUE 3D switch and the lens bar, and the liveness
  (nothing capped). `RAIL-LEARN` FAILed on `panelHintsUnbound: ["panel:lab mode|mould shape"]`
  and `SLICE-ROWS-INSIDE` on the hint's two lines. The other six checks stayed OK.
- **`verify-scale3d.mjs`** — the 3D half of the v5.0 length-anchor change, on its own so it
  does not need the full 30-check volume suite to re-run: both solvers carry one resolution,
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
  diffuse interface was made. Eleven checks: `QPF-EQUIL` (equilibrium profile width and a flat
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
  homogenization against the discrete stencil eigenvalue, Σ3 annealing twins, the two
  end-to-end panel gates `HT-PANEL` / `HT3-PANEL`, and v7.0 C3a's seven `HT3-SE-*` gates for the
  stored-energy field and the strain-induced drive it feeds.

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
  the first of the fourteen browser-free scripts CI can gate (`verify-heattreat.mjs` joined it in v6.0, the v7.1 arc added six more and v8 added `verify-hero-manifest.mjs`). Nine checks: that kelvin-per-unit really is the heat
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
  machinery and two numbers. Since v8 U1b the refusals are terse on-screen lines (the long
  explanations moved to a `learn` field beside them) in American spelling, so the oxide case's
  required word is "not modeled" (was "not modelled"). Proved able to fail: the gate run through
  a vite config whose transform put "not modelled" back in memory (logged as landed) FAILed
  `HT-REFUSE` alone.
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

**v7.0 C3a — stored energy and recovery.** Cold work is a PER-GRAIN field — one f32 per grain
id, 4096 of them, 16 KB in a storage buffer bound `read`, not a per-voxel texture — and the
reason is an identity rather than an approximation: h(x) ≡ H(id(x)). The only thing the anneal
kernel does to a voxel is adopt a neighbour's grain id, so it adopts that neighbour's stored
energy with it, and the identity holds after every flip because it held before. A per-voxel
field would have been 28.3 MB at 192³, 56.6 MB for the ping-pong pair; the per-grain buffer
deletes the ping-pong, the lockstep, the parity argument and the out-of-memory refusal path
along with the texture, and nothing on the GPU ever writes it. The drive is strain-induced
boundary migration, one term added to the acceptance line — `dE = eNew - eNow` becomes
`dE = eNew - eNow + (hOf(cand) - hOf(mineId))` — so a voxel adopting `cand` adopts cand's stored
energy and the move costs their DIFFERENCE, negative when the candidate is the LESS deformed
grain, which is to say the boundary sweeps INTO the more deformed one. The field is in BOND
ENERGIES, written `J_b`: this app deliberately has no SI-to-Potts energy bridge — the material
law sets the endpoint and the measured lattice constants (`M_MODEL_3D`, `K_MC_3D`) spend the
sweeps — and C3a adds none. Recovery is second-order dislocation annihilation, dH/dS = −k·H²,
integrated EXACTLY as H_S = H₀/(1 + rec·H₀) with rec = `HT_RECOVER_3D`·S and evaluated in the
shader from one scalar the uniform already carries: there is no recovery PASS, so recovery
cannot be applied twice, applied per-colour instead of per-sweep, or land one sweep stale,
because it is never applied at all — and three properties fall out with no clamp anywhere,
H_S ≥ 0, H_S ≤ H₀, and H_S strictly decreasing in S. Nine gates:

- **`HT3-SE-OFF-IDENTITY`** — the keystone, `GG-PIN-OFF-IDENTITY`'s idiom on the new mode: a
  zero-valued field driven through the STORED pipeline and the stored bind-group layout must be
  bit-identical to the pre-C3a kernel. THREE arms on ONE cast, the grain volume restored into
  each — the pre-C3a path, the stored pipeline at a zero field, and the mode genuinely on, which
  is required to DIFFER so the identity cannot be satisfied by a kernel that ignores the field.
  The mode selector is `hOn` and never `work > 0`: an off-arm built from `work === 0` would run
  the old path and prove nothing about the new one. Liveness clauses sit beside the identity,
  because two arms that each did nothing agree perfectly; both flip hundreds of thousands of
  voxels. The counts themselves are cast-dependent — `cast3`'s freeze loop stops on a
  wall-clock-sensitive stats poll — so they are reported and not asserted.
- **`HT3-SE-FRONT`** — the headline, and its anchor is DERIVED rather than fitted. A voxel on a
  flat {100} boundary sees 26 neighbours, 9 across the interface and 17 on its own side, so
  adopting the neighbouring grain swaps those counts and the boundary term of the move is
  ΔE = +8; the gate enumerates that +8 in JS from the same 26 offsets, independently of the
  shader, and requires the shipped `H_FLAT_3D` to BE the counted number. At the shipped kT = 0.6
  a flat front costs exp(−8/0.6) ≈ 1.62e-6 per attempt — very nearly immobile, which is why this
  model coarsens at kinks and curvature instead — and at ΔH = 8 exactly the move is
  energy-NEUTRAL, this kernel takes flat moves unconditionally, and a FLAT front would advance at
  whatever its candidate draw offers: 9/26 = 0.3462 cells per sweep. That equality is REPORTED
  and not gated, because two effects move the measurement off it in opposite directions and
  neither is noise. A sweep is EIGHT sequential sublattice passes, so the front roughens inside
  its own first sweep and the later colours see a raised unlike-neighbour count — the one-sweep
  velocity is 0.3918, ABOVE the draw. And recovery is LIVE throughout: `setStored` turns the
  stored mode on and `anneal` banks `HT_RECOVER_3D` every sweep, so a nominal ΔH = 8 has decayed
  to an effective 5.4 by sweep 60 and the velocity falls with window length — 0.3918, 0.3170,
  0.2137 at 1, 5 and 60 sweeps. There is no recovery-free arm to measure against; recovery is
  intrinsic to the stored mode, and an earlier version of this entry quoted a "static" ladder
  that was not one, at numbers that no longer reproduce. The gate measures on a 5-sweep window
  where the sag is 3.8 %, and asserts direction on the rungs that HAVE one, monotonicity, the
  v ≤ 1 ceiling, and two BRACKETS that pin the barrier from both sides: v(8) = 0.92·draw, where a
  barrier of 10 would predict 0.035·draw, and v(6) = 0.44·draw, where a barrier of 6 would
  predict the full draw. The onset is a smooth Boltzmann tail and its knee sits nearer 5–6 than
  8 — 4 → 5 is ×47 and 5 → 6 is ×11, but 6 → 7 is only ×1.4 where a pure tail at kT = 0.6 would
  keep multiplying by 5.3 — because a moving front is a kinked one and a kink is cheaper than the
  flat face. So 8 is an upper bound on the barrier that gates migration, and no sharp unpinning
  value is named. And the zeros at the bottom of the ladder are small
  numbers, not exact ones: a sub-barrier move costs exp(−(8 − ΔH)/kT), so over a 40-sweep window
  on 128² boundary cells the expected count is ~0.4 flips at ΔH = 0 and ~10 at ΔH = 2 — Poisson,
  and two runs of the gate on identical code read (0, 0) and (0, 2). The assertion is creep three
  orders below the neutral-point rate, never `v === 0`.
- **`HT3-SE-RECOVERY-STALL`** — recovery is real, and it is the closed form. Driven from
  ΔH₀ = 20 on the bicrystal at 128³, the front's velocity per 100-sweep window runs
  0.3996 → 0.1050 → 0.0144 and is under a thousandth of its opening value by 800 sweeps, at
  H_S = 1.18 — inside the band the ladder above measures immobile, and comfortably inside
  `SWEEP_CAP_3D = 2000`, so a panel-legal treatment can actually reach it. That relation is the
  gate's cross-check and it is computed rather than quoted: `HT3-SE-FRONT` hands over the largest
  drive its own ladder measured below the creep floor, in the same run on the same GPU, and this
  gate requires the front to start above that band and stall inside it. Every run so far has
  measured a net displacement of exactly zero voxels in the last window, and the gate first
  shipped asserting that equality; it now asserts the same three-order SEPARATION the ladder
  does, because the residual is the same Poisson quantity — at H_S ≈ 1 the flat-front cost is
  exp(−7/0.6) ≈ 8.5e-6 per attempt, an isolated voxel on a flat {100} face carries 17 unlike
  neighbours and re-dissolves within a sweep, and the standing population is a few hundredths of
  a voxel: exactly zero about nineteen runs in twenty. The banked `rec` is still asserted exactly,
  against rate × sweeps. What makes the run a measurement rather than a restatement of the
  integral is where the stall LANDS, measured against a band this run measured. A STRONGER
  correspondence was claimed here and in three other documents, and it is retracted: that each
  window's velocity falls between the ladder's velocities at that window's H_S endpoints. It does
  not — windows 300 through 700 read 0.0144 down to 0.0003 where the ladder reads 0.0000 at the
  same drives, one to two orders out. Neither measurement is wrong. A front that has been
  migrating for hundreds of sweeps is ROUGH, and a rough front moves at drives a flat one cannot;
  it is the same effect that puts the ladder's own onset near 5–6. Two experiments that differ in
  front morphology cannot bracket each other window by window, and nothing ever asserted that
  they did — which is the part that should have been caught before it reached four documents.
- **`HT3-SE-SELECTION`** — the physics claim rather than the plumbing: a deposited field must
  SELECT, and the less deformed grains must win volume. It is the one gate the work fabric is
  load-bearing for, so it is the one carrying a PRE-REGISTERED kill criterion, fixed and approved
  before the measurement ran — the driven share shift must be positive and at least 3× the
  magnitude of the undriven control's, on every one of three pours. The control is not ceremony:
  coarsening removes small grains whatever drives it, so ANY partition of a shrinking population
  drifts, and the 3× is a ratio against that measured drift rather than an absolute. Measured at
  6 `J_b` mean over 90 sweeps: +0.495 to +0.501 of volume share against control drifts of ±0.007,
  a factor of 73 to 6238. Beside the verdict the gate runs a LADDER, because the share metric
  saturates — 0.294 of a possible 0.500 already at a 0.75 `J_b` mean — and a single point at
  mid-dial cannot tell a working coupling from one weakened fourfold. The ladder's second
  reading, the volume-weighted mean of the dimensionless fabric over the surviving structure,
  does not saturate: 1.015 as deposited, then 0.607, 0.378 and 0.229 at 0.75, 1.5 and 3 `J_b`.
- **`HT3-SE-UNIFORM-INERT`** — the gate a zero-arm identity cannot be: a UNIFORM field is exactly
  inert, because the term the acceptance line gained is a DIFFERENCE and hOf(cand) − hOf(mineId)
  is 0 everywhere. Every nonzero uniform value passes `HT3-SE-OFF-IDENTITY` as well, and must
  still move boundaries exactly as the pre-C3a kernel does — heterogeneity, not magnitude, is
  what makes a stored field visible at all. It is the one arm that catches a coupling wrong in a
  way that is ASYMMETRIC and still cancels at an empty field: `−H(mine)` alone, `+H(cand)` alone,
  or `rec` applied to one side of the difference. What it cannot catch — and an earlier version
  of this entry claimed it could — is anything still zero when the difference is zero: `abs(ΔH)`,
  a clamp, a rescale. Those are `HT3-SE-FRONT`'s, where the difference is not zero.
- **`HT3-SE-COHERENCE`** — the witness that nothing on the GPU writes H: the buffer is read back
  after a real anneal and must equal the CPU mirror in all 4096 entries, with `MC3-COHERENCE`'s
  whole invariant set re-asserted on the new kernel. `SE-STRUCTURE` asserts that same guarantee
  as text (`read`, not `read_write`); this asserts it as a number, on the hardware, after
  thousands of flips have had their chance to break it.
- **`HT3-SE-PANEL`** — the sixth dial and the withdrawal it triggers. Cold work runs 0 to 10
  `J_b` in steps of 0.5 and is rendered ONLY in 3D — a dimension switch closes the panel, so the
  dial set is stable for a panel's lifetime and the 2D operator surface is byte-identical to
  before, `HT-PIN-PANEL` still counting five dials there. Above zero the panel WITHDRAWS THE
  ENDPOINT: the sourced grain-growth coefficients price curvature-driven growth alone, and a
  stored-energy field is a second driving force the calibration that turns them into sweeps was
  never fitted against. The schedule still buys its sweeps — that is a time conversion — but no d̄
  endpoint is predicted, the pre-run Hall–Petch spec sentence is withdrawn with it, and the report
  card's law-endpoint row says withdrawn and prints no micron figure. The gate drives that in both
  directions: an endpoint arrow before the dial moves, NO `→ N µm` anywhere in the note while it
  is up, and the arrow back when it returns to zero — a withdrawal that cannot be undone is a
  broken panel wearing an honest sentence. The revert arm then RUNS A SECOND TREATMENT and reads
  `storedOn` off the sim, because the mode selector lives in the solver and the note is the one
  surface that never touches it: an earlier cut of this gate checked only the note and was green
  on a build where dialling to zero stopped depositing without stopping driving. It runs on copper on purpose, one of the two materials —
  cobalt is the other — where `canTreat("twins")` says yes, so the same treatment also exercises
  the twin hold-back. The
  card's measured before/after rows and the post-run spec verdict STAND, because they stand on a
  census.

  v8 U1b made the note and the card terse (each long sentence is now a learn-mode slot, empty
  while learn mode is off) and kept every phrase this gate and `HT-PANEL`/`HT-PIN-PANEL`/
  `HT3-PANEL` read, with one spelling change: the hold-back row reads "twins held back while
  cold work is dialed" (was "dialled"), and the clause was re-pinned with it. Proved able to
  fail: a second vite server served the tree with that one word put back in memory (logged as
  landed) and this script ran against it on its spare port. `HT3-SE-PANEL` FAILed with the
  other 25 checks OK, and on the gate's own logged output the hold-back clause was the only
  false one ("dialled" on the card).

  The revert arm flaked until the U1b review, by construction. Its second treatment only arms
  while the first worked anneal leaves d̄ under the 125 µm specimen's domain limit (125.4 / ∛25
  = 42.9 µm), and the arm used to walk the hold down only until the law endpoint fit under that
  limit. The stored-energy drive grows grains past the law's endpoint (the endpoint prices
  curvature-driven growth alone), so the worked d̄ landed at the limit: 42.2, 43.4 and 40.9 µm
  on identical code, and at 43.4 the 100 °C near-noop refused to arm and the gate failed on
  `rearmed` alone. The arm now picks a schedule WITH headroom: it walks the hold down (30, 15,
  8, 4, 2 min), then the temperature dial in 50 °C steps if no hold qualifies, until the law
  endpoint is at most 0.65 of the panel's own limit (`HT.domainLimitUm` on the specimen as the
  panel sees it) and the schedule still buys ≥ 50 sweeps. 0.65 was measured, not guessed: the
  review's first suggestion, 0.8, kept the same 30 min rung (endpoint 33.2 µm against a 42.7 µm
  limit, 0.777), and the worked anneal still reached 40.9 µm, the drive adding 7.7 µm (23 %)
  over the endpoint. At 0.65 it arms at 8 min (25.1 µm, 0.587, 969 sweeps) and the worked
  anneal leaves 33.6 and 34.7 µm in two runs, about 8 µm under the limit. Every rung tried,
  the chosen endpoint, the limit, their ratio and the worked d̄ are in the gate's output, and
  `headroom ≤ 0.65` is part of the verdict, so a panel whose endpoints drift up past every rung
  fails by name instead of flaking on the rearm: run with the bound at 0.3 (a copy of the script
  piped to node with that one constant changed), `HT3-SE-PANEL` FAILed with `armed: false` and
  all 25 rungs listed, 880 °C down to 680 °C (where the endpoints reach 11.4 µm but buy only 6
  to 20 sweeps), and the other 25 checks stayed OK.

  The same review found the arm reading the card too early: `run()` clears `busy` before its
  after-census and the card, so a read the moment `busy` drops could land before the card
  existed (an empty `report` on a run that did anneal), and the second run's read could land
  on the FIRST run's card, which carries a cold-work row. Both reads now wait for `#htReport`
  to change from what it held at the click.
- **`SE-STRUCTURE` / `HT-TEMP-SENSITIVITY`** (browser-free, in CI) — the halves that survive
  where there is no GPU. `SE-STRUCTURE` is `PIN-STRUCTURE`'s idiom applied to the one thing C3a
  cannot witness with a number: the PLAIN variant carries no stored text at all and still carries
  the acceptance line it has always had, the STORED variant claims binding 5 and stops there,
  nothing anywhere assigns `hs` — the binding is `read`, not `read_write` — both acceptance lines
  are pinned so the stored one adds exactly the SIBM difference and nothing else, `H2U.BYTES`
  stays 32 with `rec` reusing the dead `twinProb` slot, and the 2D kernel stays stored-free,
  because the Moore-8 stencil's flat front is 3 → 5, a barrier of +2, and borrowing a number
  across a stencil change is the mistake `M_MODEL_3D` exists to remember. It also holds the
  shipped `recovered()` helper — the closed form the report card prints — against a MEASURED row
  rather than against itself: H₀ = 20 driven 800 sweeps must arrive at 1.18.
  `HT-TEMP-SENSITIVITY` holds the line the furnace may not cross, and it is a gate two shipping
  docblocks had been citing as fact since v7.0 without it existing anywhere. Two schedules
  differing only in hold temperature must drive the model differently — the liveness half, which
  fails if the temperature → sweeps path ever breaks — while the two knobs they drive it through,
  the shipped kT and `HT_RECOVER_3D`, stay byte-identical, declared as plain literals and
  unreachable from any °C (`heatpanel.ts` owns every temperature in this app and must not name
  either identifier in code). Its sharp form is a ratio: recovery banked over a treatment is
  `HT_RECOVER_3D` × the sweeps it bought, so rec(hot)/rec(cold) must equal sweeps(hot)/sweeps(cold)
  exactly. Make either knob a function of temperature — the physically tempting edit, since real
  recovery is thermally activated — and that equality breaks while every other number in the
  script still looks right.

Which grain stores how much is `WORK_SALT`, a fixed constant like `PIN_SALT`, so replicates at
different seeds anneal different microstructures against ONE fixed work fabric. It is a DECLARED
FICTION and is called one: a hash over grain ids is not a Taylor factor. Predicting which grain
stores more deformation needs a slip-system set and the orientation's relation to the loading
axis, and the quaternions here describe orientation without slip geometry — so the model has no
basis to prefer one grain over another and does not pretend to. The fabric exists because a
uniform field is exactly inert, which is `HT3-SE-UNIFORM-INERT` as a sentence; the deposit
spreads h uniform on [0, 2·work], so the dial reads as the MEAN stored energy.

Three limits belong beside these gates rather than inside them. Cold work here is a DRIVING
FORCE, not a strength: Hall–Petch in this app still prices grain size alone, so the
work-hardening increment real cold work would add to σ_y is absent. The strength sentence the
documents have carried since v6.0 — grain-size strengthening alone, without precipitate kinetics
or hardening — is still true of σ_y and now has to say so differently, because as written it
reads as "cold work is not modelled at all", which after C3a is false. The sweep budget is bought
by the GRAIN-GROWTH law's Arrhenius integral, so this furnace cannot yet price a
recrystallization anneal below the grain-growth window: a low-temperature recrystallization
schedule buys ~0 sweeps and nothing happens. And Σ3 annealing twinning is HELD BACK whenever cold
work is dialed. Since v8 U1b the card names the hold-back in one line ("twins held back while
cold work is dialed: twinning in deformed grains is not modeled yet", the phrase `HT3-SE-PANEL`
pins) and learn mode gives the reason in plain words: a new twin could start with the wrong
stored energy and be consumed by its parent grain. The mechanism behind that sentence, no longer
on screen: a twin plate's id is allocated GPU-side mid-anneal, so it would be born carrying
whatever the work fabric had assigned to an id nobody had used yet, and a plate that draws less
than the parent it sits inside eats that parent instead of twinning it. Nucleation of new
strain-free grains is C3b and is not in this milestone — C3a is the FIELD and the DRIVE.

**A note on `GG3-KMC`'s tolerance.** The calibration pours are now seeded LCGs rather than
`Math.random()`, which made the 2D `GG-KMC` byte-identical run to run. The 3D one still moves,
because its freeze loop stops on a measured threshold: six consecutive runs on identical code
spread K/K_shipped over 0.886–1.186, so `K_MC_TOL_3D` was re-measured from 15 % to 25 % with
that evidence recorded in the constant's own docblock. The drift prints on every run, and
`HT3-PANEL` gates the same constant a second way — on an integral rather than a fit.

`npm run build` (Vite + `tsc`) plus the fourteen browser-free scripts — `verify-units.mjs`,
`verify-rng.mjs`, `verify-heattreat.mjs`, `verify-thermal.mjs`, `verify-fade.mjs`,
`verify-porosity.mjs`, `verify-experiment.mjs`, `verify-phasedata.mjs`,
`verify-alloy.mjs`, `verify-phasediagram.mjs`, `verify-regimes.mjs`, `verify-elements.mjs`,
`verify-composer-grid.mjs` and `verify-hero-manifest.mjs` — are the checks anyone on any OS can run
without a GPU, and are what CI actually gates on (`.github/workflows/ci.yml`).
