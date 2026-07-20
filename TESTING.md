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
- **`verify-tools.mjs`** — the v1.8 tool batch: faceted growth, `#set=` share-link round-trip,
  the analysis-panel enlarge modal, and the specimen-tilt view.

None of these are physics-correctness tests in the numerical-PDE sense (no reference-solution
comparison) — they're behavioral/regression checks on the UI and scroll choreography, which is
where nearly every bug in this codebase has actually occurred (see `tasks/todo.md` for the
postmortems). Physics correctness is checked by eye against the published Kobayashi figures and
documented in `tasks/todo.md`'s M1 verification note, and by the one in-instrument measured
claim on the `/science/` page (A356+TiB vs. Al–1Zn grain count under identical nucleation).

`npm run build` (Vite + `tsc`) is the one check anyone on any OS can run without a GPU, and is
what CI actually gates on.
