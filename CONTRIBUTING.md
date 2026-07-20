# Contributing to SOLIDIFY

## Development setup

```bash
npm install
npm run dev      # local dev server (needs a WebGPU browser: Chrome/Edge, Safari 26+, recent Firefox)
npm run build    # static build in dist/
npm test         # headless verification suite — see TESTING.md
```

## Where things live

- `src/shaders.ts` — the WGSL compute/render pipeline (the physics).
- `src/` — everything else: UI panels, landing-page motion, the scroll dive, materials/alloy
  data, analysis instruments.
- `science/index.html` — the equations/numerics/honesty page. If you change the model, update
  this too — the whole point of the page is that it stays accurate.
- `tasks/todo.md` — the build log and a running list of bugs found + fixed, with root causes.
  Read it before touching the numerics or the scroll-driven landing; several subtle regressions
  (checkerboard instability, pinned-scroll-trigger ordering, GPU submission backpressure) are
  documented there so they don't get reintroduced.

## Filing issues

Open a GitHub issue with: what you expected, what happened, your browser/GPU, and (if it's a
rendering or physics bug) a screenshot. If it's a numerics bug, note which lens/material/scenario
reproduces it — the simulation is deterministic given a seed, so exact repro steps matter.

## Pull requests

Keep changes scoped — this is a from-scratch WebGPU/WGSL codebase with no framework, so small,
reviewable diffs matter more than usual. Run `npm test` before opening a PR; if you're touching
the compute shaders, sanity-check at least one lens by eye with `npm run dev` since the automated
suite checks behavior (scroll order, UI state, fallback paths) rather than pixel-level physics
correctness.

## License

MIT — see `LICENSE`.
