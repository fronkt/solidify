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
fade and Sievert gas porosity — bringing the CI-runnable set to five. They run first in the
suite for the same reason the first two do: they are instant, and a failure there means the
GPU half is not worth starting.

**Requirements**: a WebGPU-capable Chrome/Chromium at the path hardcoded in each verify script
(`C:\Program Files\Google\Chrome\Application\chrome.exe`) — Windows with a real GPU, or the
`--use-angle=swiftshader` software-rendering path the scripts themselves fall back to for
GPU-less environments. **This is not portable to a generic hosted CI runner as-is** — the
executable path and WebGPU/ANGLE availability are both host-specific, which is why CI gates
only the OS-agnostic steps — typecheck, build, and the five browser-free scripts
(`verify-units.mjs`, `verify-heattreat.mjs`, `verify-thermal.mjs`, `verify-fade.mjs`,
`verify-porosity.mjs`; see `.github/workflows/ci.yml`) — rather than
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

**A note on `GG3-KMC`'s tolerance.** The calibration pours are now seeded LCGs rather than
`Math.random()`, which made the 2D `GG-KMC` byte-identical run to run. The 3D one still moves,
because its freeze loop stops on a measured threshold: six consecutive runs on identical code
spread K/K_shipped over 0.886–1.186, so `K_MC_TOL_3D` was re-measured from 15 % to 25 % with
that evidence recorded in the constant's own docblock. The drift prints on every run, and
`HT3-PANEL` gates the same constant a second way — on an integral rather than a fit.

`npm run build` (Vite + `tsc`) plus the six browser-free scripts — `verify-units.mjs`,
`verify-rng.mjs`, `verify-heattreat.mjs`, `verify-thermal.mjs`, `verify-fade.mjs` and
`verify-porosity.mjs` — are the checks anyone on any OS can run without a GPU, and are what CI
actually gates on (`.github/workflows/ci.yml`).
