# SOLIDIFY — watch metal freeze

**Live: [solidify.frankcai.dev](https://solidify.frankcai.dev/)** (needs WebGPU — Chrome/Edge, Safari 26+, recent Firefox)

A real-time **phase-field solidification instrument** that runs entirely in your browser on WebGPU.
Undercool a melt, tap to nucleate crystals, and watch dendrites grow, branch, collide, and become
grains — then read the result like a metallographer: etched micrograph view, grain-size histogram,
live ASTM grain number.

![Four-fold dendrite growing in an undercooled melt](docs/hero-dendrite.jpg)

Switch the crystal symmetry from cubic (×4) to hexagonal (×6) and the same equations grow a
snowflake — shown here in cross-polarised (orientation) view:

![Six-fold dendritic snowflake in orientation view](docs/hero-snowflake.jpg)

The landing page opens with a scroll-driven descent — from the GPU running the solver, down
through the die, an electron column, the specimen, and out to a synchrotron — every scene a live
3D wireframe:

![Exploded electron-microscope column from the landing dive](docs/dive-column.jpg)

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

## TRUE 3D mode

Flip one switch and the instrument solves the **full volumetric phase-field** — up to
**192³ ≈ 7.1 million voxels** — and raymarches it live:

![Six-armed dendrite grown by the volumetric solver, orientation view](docs/hero-3d.jpg)

- **Real 3D crystallography** — per-grain quaternion orientations; cubic ⟨100⟩ anisotropy grows
  six-armed dendrites, the hexagonal K₆ + c-axis form grows plates or needles (habit slider).
  Shift-tap seeds a Σ3 twin pair (60° about a shared ⟨111⟩).
- **CAD-style camera** — orbit/dolly/pan plus a Fusion-style ViewCube with face/edge/corner
  snapping, tap-to-nucleate at depth.
- **Nine lenses** on the volume — MELT, ORIENT, SLICE, FIELD (x-ray), SEM, RINGS, THERM, NEON,
  CURV.
- **Serial sectioning** — a free section plane (depth/tilt/turn) with a CT sweep mode; the cut
  face renders as Nital/Klemm's/Beraha's etches, an EBSD IPF map, or a Niyama porosity-risk map.
- **Shrinkage porosity** — a generation-stamped feed flood from the riser marks starved liquid;
  pockets that solidify unfed become pores that x-ray dark in FIELD, with live porosity % and the
  Niyama criterion recorded at every freezing voxel.
- **Stereology + IPF panels** — grain size measured on the section plane vs the true 3D census
  (the classic stereological underestimate, live), and an inverse-pole-figure texture scatter.
- **Take it home** — export the crystal as a watertight **STL** (surface-nets mesh, printable),
  record a 6-second **360° turntable** webm, or share the whole setup as a link.
- **Guided tour part III** — "Into the volume": five chapters from the first six-armed dendrite
  to porosity NDT and the STL export.
- **The full instrument** (v3.0) — everything from 2D now runs in the volume: the dilute-alloy
  solute field + composer (lazily-allocated solute textures, +57 MB only while on), Bridgman
  directional growth up the z-axis, a steerable top-surface laser weld, stochastic **Σ3 growth
  twins spawned GPU-side at the moving front**, cusped {100} **faceted growth**, the
  **icosahedral quasicrystal** answer to the forbidden 5-fold, all nine presets, the cooling
  probe / Scheil overlay / SDAS ruler / pole figure instruments, retro voxel + 8-bit looks, and
  3D share links that carry the whole setup.
- **The grain selector** (3D-only showpiece) — a helical pigtail channel under the Bridgman
  pull: dozens of chill-floor grains race in, **exactly one** exits into the blade cavity —
  the real mechanism behind single-crystal turbine blades, verified headlessly (64 grains → 1).

Budget: 57 B/voxel over seven textures — ~403 MB VRAM at 192³ (+57 MB solute while alloy is on),
with an OOM ladder down through 160³/128³/96³, all four selectable in the ENGINE row;
2D mode is untouched at 60 fps.

## The instrument

- **Ten lenses** — MELT (incandescent blackbody), ORIENT (cross-polarized grains), ETCH
  (micrograph + scale bar), FIELD (T + isotherms), RINGS (solidification-time isochrones),
  THERM (FLIR ironbow), SEM (secondary-electron look), NEON (glowing contours), XRAY
  (synchrotron-radiograph absorption, shows solute), CURV (Gibbs–Thomson curvature).
- **Scenarios** — free growth, Bridgman directional solidification (pulled gradient frame),
  and a steerable/auto-raster laser weld that remelts and resolidifies the microstructure.
- **Alloy mode** — Warren–Boettinger-type dilute solute (qualitative): constitutional
  undercooling, solute halos, frozen-in microsegregation, composition/partition/liquidus sliders.
- **Materials** — ten qualitative identities (model metal, Al–Cu, Fe–C steel, Ni superalloy,
  Co alloy, copper, Mg AZ91, Zn spangle, ice, succinonitrile). Crystal structure picks the
  dendrite symmetry (FCC/BCC → 4-fold, HCP → 6-fold — and yes, cobalt freezes FCC), and each
  material sets anisotropy, latent heat, alloy bundle, and how brightly its melt actually
  glows: steel pours white-hot, zinc at 420 °C is just liquid silver.
- **Alloy composer** — build your own composition: pick a base (Al/Fe/Ni/Mg/Cu/Zn), add
  elements in wt% with live at% conversion, using approximate textbook dilute-limit binary
  coefficients (liquidus slope m, partition k per element). The composer reports the real
  chemistry — liquidus shift ΔT_L = Σmᵢcᵢ and growth restriction factor Q = Σmᵢcᵢ(kᵢ−1) —
  then collapses the mix onto the model's pseudo-binary solute field (k_eff = the mᵢcᵢ-weighted
  mean partition), with every clamp labelled. Famous-alloy quick-fills (A356, AA2024, 4340,
  IN718, AZ91, bronze…) and shareable `#alloy=…` deep links.
- **Twinning** — stochastic growth twins nucleate at the front in twin registry (θ₀ + π/j) and
  must out-grow their parent to survive, like real feathery grains in aluminum DC casting;
  Shift+click stamps a twinned seed pair — in hexagonal mode that grows the rare
  12-branched snowflake. Twin boundaries etch faint, as in real metallography.
- **Nucleation you cannot cheat** — there is no "nuclei per second" slider, because that is not
  a thing you set. You charge the melt with an **inoculant**: n_max potential sites, each with
  its own activation undercooling drawn from a Gaussian, each firing once when the melt first
  gets that cold (Thévoz–Rappaz site distribution + Greer free-growth activation). Sites only
  fire on a *new* maximum undercooling, so recalescence stops nucleation by itself, and cooling
  the same charge faster reaches a deeper undercooling before that happens — more sites fire,
  finer casting. The test suite asserts exactly that coupling.
- **Lab mode** — the instrument's other half: instead of dragging sliders at a running melt, you
  specify the experiment first (charge + inoculant, atmosphere, pour superheat, mould temperature,
  and a furnace/air/quench/soak cooling programme), pour it, and read a **report card** —
  cooling curve with the recalescence arrest marked, deepest undercooling, and how much of the
  inoculant the run actually used. Change a dial mid-pour and the card says so.
- **Process controls** — undercooling, cooling rate, inoculant charge (+ potency and spread), chill
  wall, reheat-to-remelt, symmetry, anisotropy, noise, latent heat, brush size, and a pro panel
  (ε̄, γ, α, τ, k) for power users. Reset arms a staged melt; run/pause plus a ×1/×2/×4
  fast-forward multiplier on the transport.
- **Looks & navigation** — scroll-zoom + right-drag pan in any lens, pixel mode (chunky
  nearest-neighbour cells) and an 8-bit dithered palette toggle.
- **Live metallography** — fraction solid, interface undercooling, grain count, grain-size
  histogram, ASTM G number, computed by GPU reduction while the sim runs.
- **Analysis instruments** — a cooling-curve probe (foundry thermal analysis: watch the
  recalescence arrest at the liquidus; ctrl-tap moves the probe), a Scheil overlay
  (analytic T(fs) path vs the measured interface temperature), and an SDAS ruler that
  measures secondary-arm spacing by dragging a linear-intercept line, metallographer-style.
- **Recorder** — one-button ⏺ capture of the canvas to a .webm clip.
- **Touch** — pinch to zoom, two-finger pan, tap to nucleate.
- **The science page** — [/science/](https://solidify.frankcai.dev/science/) documents the
  equations, the numerics, what's quantitative vs qualitative, and the references.
- **Guided tour** — ten chapters from the Mullins–Sekerka instability through twinning,
  casting CET, directional growth, welding, and alloys.
- **Engineer it & challenge** — a separable CMA-ES optimizer runs casting after casting,
  measures each ASTM grain number, and learns the schedule — every attempt pinned to a
  lab-notebook strip. Challenge mode deals you the same target first and scores you against it.

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
- ASTM G from mean grain area (E112), measured against the model resolution set in the
  SCALE panel.

## Real units, and what they cost

The solver is dimensionless. Three factors convert it to SI, and only one of them is a
choice:

| factor | value | where it comes from |
|---|---|---|
| kelvin per unit | ≈249 K for Al, ≈44 K for water | **forced** — it is `(L/c_p)/K`, the heat equation's own latent coupling |
| µm per cell | you set it | the model's physical resolution; the domain is `n × µm/cell` |
| seconds per unit | derived | **forced** by whichever diffusivity is transporting |

So the app reads in °C, K, K/s, seconds and µm, and the SCALE panel shows each factor with
its provenance — nothing is presented as a result when it was a choice, or as a choice when
it was pinned. It also names the dimensionless groups the model *fails*: the Stefan number
is matched by construction, but the Lewis number is ~1 where a real alloy is ~10⁴, and the
capillary ratio is undefined because the Kobayashi interface has no calibrated surface
energy. That last one is why tip radius and arm spacing here are shapes rather than
predictions — under the default solver.

## The calibrated solver

There is a second solver, and you turn it on in the SCALE panel. Karma–Rappel thin-interface
asymptotics tie the phase-field parameters to two numbers the material actually has, the
capillary length `d0 = Γ/ΔT0` and the diffusivity `D`:

```
d0 = a1 · W0 / λ          a1 = 5√2/8 = 0.8839
τ0 = a2 · λ · W0² / D     a2 = 0.6267
```

Pick λ and everything else is *forced* — the interface width, the relaxation time, the physical
size of a cell, the length of a timestep. Seven dials grey out, because they are no longer
choices. For Al–4.5Cu that is `d0 = 3.2 nm`, `W0 = 109 nm`, a 0.087 µm cell and an 89 µm field
of view at 1024², so the SDAS ruler reports arm spacings a micrograph would give.

λ is the one control left, and it is a **convergence** knob rather than a physics one: it sets
how many capillary lengths wide the diffuse interface is, and the asymptotics are exact only as
that goes to zero. So the app prints `W0/d0` next to it, and the test suite checks that the
answer does not depend on it.

In an alloy the model also carries an **anti-trapping current**. Without it, an interface of
finite width traps solute it should have rejected, which looks exactly like a larger partition
coefficient and grows a completely convincing dendrite anyway. Measured here: with the current,
`k_eff` sits on the real `k` and does not care about the interface width; without it, `k_eff`
runs 24–40 % high and the excess *grows* with the width.

What it is checked against — real numbers from the literature, not self-consistency:

| measurement | reference | result |
|---|---|---|
| steady tip velocity `V·d0/D` | Karma–Rappel 1998, 2D solvability, Δ = 0.55, ε₄ = 0.05: **0.0170** | **0.01679** (1.2 %) |
| parabolic tip radius `ρ/d0` | Tong, Beckermann, Karma & Li 2001: 27.6 | 28.8 (4.4 %) |
| critical nucleus radius | Gibbs–Thomson `R* = d0/Δ` | 0.5 % |
| independence of interface width | same answer at `W0/d0` = 1.8 → 3.6 | 6.4 % spread |
| effective partition coefficient | the real `k`, width-independent | 0.135–0.150 vs `k` = 0.15 |

One consequence arrives free. Under the calibrated alloy path one dimensionless degree is the
alloy's **freezing range** instead of `L/c_p`, so the app's own shipped nucleation potency —
the same dial, untouched — reads 11 K where the Kobayashi scaling made it 37 K. That is the
band real castings occupy, reached by fixing the temperature scale rather than by tuning
nucleation.

Limits, stated: it is **2D only** (the volume still runs Kobayashi, and the switch says so
instead of appearing and doing nothing), the Lewis mismatch is unchanged, and the expansion has
its own validity bound `τ0·V/W0 ≲ 0.2` that a deeply undercooled *pure* melt reaches by λ ≈ 4.

Two consequences worth knowing. The undercooling slider's own maximum is deeper than any
real aluminium melt reaches (249 K against a Turnbull limit near 187 K) — it turns red
there. And the same dial on water tops out at 44 K, which is essentially exactly water's
homogeneous nucleation limit.
