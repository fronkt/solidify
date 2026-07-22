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

**Requirements**: a WebGPU-capable Chrome/Chromium at the path hardcoded in each verify script
(`C:\Program Files\Google\Chrome\Application\chrome.exe`) — Windows with a real GPU, or the
`--use-angle=swiftshader` software-rendering path the scripts themselves fall back to for
GPU-less environments. **This is not portable to a generic hosted CI runner as-is** — the
executable path and WebGPU/ANGLE availability are both host-specific, which is why CI only
runs the OS-agnostic build/typecheck step (see `.github/workflows/ci.yml`) rather than this
suite. If you want to run the physics/UI verification yourself, do it locally.

## What each script checks

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
  the analysis-panel enlarge modal, the specimen-tilt view) plus the v4.0 physics checks below.
- **`verify-scale3d.mjs`** — the 3D half of the v5.0 length-anchor change, on its own so it
  does not need the full 23-check volume suite to re-run: both solvers carry one resolution,
  the volume's `eqDiamUm` actually follows it (doubling the pitch doubles the reported diameter
  for the same voxel count — the check the old hardcoded `1 mm / 1024` could never pass), and
  the SCALE panel reports the volume's derived domain rather than the 2D grid's.
- **`verify-3d.mjs`** — the TRUE-3D mode end to end: entry, growth, grain claiming, all nine
  lenses, orbit + ViewCube, tap-at-depth seeding, alloy, twins, icosahedral symmetry, the grain
  selector, stereology, STL export, the share round-trip and the 3D lab.

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
  the one part of the suite CI can gate. Eight checks: that kelvin-per-unit really is the heat
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

The rest are behavioural/regression checks on the UI and scroll choreography, which is where
nearly every bug in this codebase has actually occurred (see `tasks/todo.md` for the
postmortems). Morphology correctness is still checked by eye against the published Kobayashi
figures and documented in `tasks/todo.md`'s M1 verification note.

`npm run build` (Vite + `tsc`) is the one check anyone on any OS can run without a GPU, and is
what CI actually gates on.
