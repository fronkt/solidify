# SOLIDIFY — watch metal freeze

**Live: [fronkt.github.io/solidify](https://fronkt.github.io/solidify/)** (needs WebGPU — Chrome/Edge, Safari 26+, recent Firefox)

A real-time **phase-field solidification instrument** that runs entirely in your browser on WebGPU.
Undercool a melt, tap to nucleate crystals, and watch dendrites grow, branch, collide, and become
grains — then read the result like a metallographer: etched micrograph view, grain-size histogram,
live ASTM grain number.

![Four-fold dendrite growing in an undercooled melt](docs/hero-dendrite.jpg)

Switch the crystal symmetry from cubic (×4) to hexagonal (×6) and the same equations grow a snowflake:

![Six-fold dendritic snowflake](docs/hero-snowflake.jpg)

## What it simulates

The Kobayashi (1993) anisotropic phase-field model for a pure undercooled melt, extended to
many grains:

- **φ (order parameter)** — anisotropic Allen–Cahn dynamics with a j-fold surface-energy
  anisotropy ε(θ) = ε̄(1 + δ cos j(θ − θ₀)) and stochastic interface noise for side-branching.
- **T (temperature)** — heat diffusion with latent-heat release K·∂φ/∂t. The glowing halo around
  every growing tip *is* the latent heat; growth stalls when recalescence warms the interface back
  to the melting point.
- **Grains** — each nucleus carries its own crystallographic orientation θ₀ in a grain-ID field
  that propagates just ahead of the front; grain boundaries appear where fronts collide, with no
  extra model terms.

Numerics: explicit Euler on a 512²–2048² grid, compact 9-point Laplacians (checkerboard-free),
divergence-form anisotropy, all in WGSL compute shaders — roughly a billion cell-updates per
second on a mid-range discrete GPU, with GPU-fence backpressure so slow devices throttle
gracefully instead of freezing.

## The instrument

- **Four views** — MELT (incandescent blackbody rendering), ORIENT (cross-polarized orientation
  colours), ETCH (etched-specimen micrograph with scale bar), FIELD (temperature field + isotherms
  + interface contour).
- **Process controls** — undercooling, cooling rate, stochastic nucleation rain, chill-wall
  seeding, anneal-to-remelt, 4-fold/6-fold symmetry, anisotropy strength, tip noise, latent heat.
- **Live metallography** — fraction solid, interface undercooling, grain count, grain-size
  histogram, ASTM G number, computed by GPU reduction while the sim runs.
- **Guided tour** — six chapters: Mullins–Sekerka instability, why dendrites have arms, snow,
  nucleation & impingement, the casting (columnar-to-equiaxed transition), and…
- **Engineer it** — a separable CMA-ES optimizer that runs casting after casting, measures the
  ASTM grain number of each, and learns a cooling + inoculation schedule that hits your target —
  every attempt pinned to a lab-notebook strip as a micrograph thumbnail.

## Running

Needs a browser with WebGPU (Chrome/Edge, Safari 26+, recent Firefox).

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/
```

No frameworks, no external assets: Vite + TypeScript + raw WebGPU, ~2.5k lines.

## Physics sanity checks

- Single-crystal morphology reproduces the canonical Kobayashi '93 figures (parabolic tips,
  side-branches only with noise, arm count follows j).
- Liquid is metastable: no growth without a nucleus; homogeneous noise cannot freeze the melt.
- Slider ranges are clamped to the numerically stable envelope of the explicit scheme.
- ASTM G from mean grain area (E112), on a nominal 1 mm domain scale, honestly labelled.
