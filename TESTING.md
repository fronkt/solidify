# Testing

```bash
npm test
```

runs the headless verification suite: starts `vite` on port 5199, then drives each script in
`scripts/verify-*.mjs` against a real WebGPU browser via `puppeteer-core`, and tears the server
down afterward (`scripts/run-tests.mjs`).

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

The rest are behavioural/regression checks on the UI and scroll choreography, which is where
nearly every bug in this codebase has actually occurred (see `tasks/todo.md` for the
postmortems). Morphology correctness is still checked by eye against the published Kobayashi
figures and documented in `tasks/todo.md`'s M1 verification note.

`npm run build` (Vite + `tsc`) is the one check anyone on any OS can run without a GPU, and is
what CI actually gates on.
