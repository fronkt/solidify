# Contributing to SOLIDIFY

## Development setup

```bash
npm install
npm run dev      # local dev server (requires a WebGPU browser: Chrome, Edge, Safari 26+, or recent Firefox)
npm run build    # static build in dist/
npm test         # headless verification suite (see TESTING.md)
```

## Project layout

- `src/shaders.ts`, `src/shaders3d.ts`, `src/shaders3d-quant.ts`: WGSL compute and render pipelines.
- `src/`: UI controls, landing-page motion, material/alloy tables, heat treatment, and analysis plots.
- `science/index.html`: Equations, numerical methods, and model-limit documentation. Update this page if you change the physics or numerical constants.
- `tasks/todo.md`: Running build log and regression notes (checkerboard instability, scroll-trigger ordering, GPU backpressure). Worth checking before changing the solvers or scroll-driven landing page.

## Filing issues

Include what you expected, what happened, your browser and GPU, and a screenshot for visual or physics bugs. For numerical issues, list the lens, material, and scenario.

The quickest way to provide a repro is a `#set=` share link. Share links encode the run's RNG seed along with all control values, so opening the link reproduces the exact same cast. You can also copy the seed directly from the `ENGINE` section of the rail.

## Pull requests

Keep PRs small and focused. Run `npm test` (or the browser-free CI checks listed in `.github/workflows/ci.yml`) before opening a PR. If you modify compute or render shaders, inspect at least one lens interactively with `npm run dev`, since the headless suite covers UI state and regression gates rather than every visual detail.

## License

MIT. See [`LICENSE`](LICENSE).
