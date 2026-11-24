# NIST PFHub Benchmark 3 (Dendritic Growth)

This directory contains SOLIDIFY's setup and results for **NIST Phase Field Community Hub (PFHub) Benchmark Problem 3: Dendritic Growth** ([pages.nist.gov/pfhub/benchmarks/benchmark3.ipynb/](https://pages.nist.gov/pfhub/benchmarks/benchmark3.ipynb/)).

## Benchmark setup

- **Model:** Karma-Rappel thin-interface phase-field solver (`solver = 1` in `src/sim.ts`, 9-point explicit stencil in WGSL `f32`).
- **Domain and symmetry:** Target quadrant $[0, 960]^2$, solved on the full 4-fold symmetric domain $[-960, +960]^2$ centered at $(n/2, n/2)$ so $x = 0$ and $y = 0$ are exact mirror planes (even for $\phi$ and $U$; odd for the anisotropic cross fluxes $W W' \nabla\phi$), avoiding corner-clamp bias. All reported quantities are extracted over $[0, 960]^2$.
- **Parameters:** $W_0 = 1$, $\tau_0 = 1$, $D = 10$ ($\lambda = D / 0.6267 = 15.9566$), $m = 4$, $\varepsilon_4 = 0.05$, $\theta_0 = 0$, $\Delta = -0.3$, initial solid seed radius $R_0 = 8$ at $(0, 0)$, target time $t = 1500$.
- **Free energy and contour:** Computes the Benchmark 3 free-energy integral
  $$\mathcal{F} = \int_{[0,960]^2}\left[\frac{1}{2} W(\mathbf{n})^2 |\nabla\phi|^2 - \frac{1}{2}\phi^2 + \frac{1}{4}\phi^4 + \lambda U\phi\left(1 - \frac{2}{3}\phi^2 + \frac{1}{5}\phi^4\right)\right]\,dV$$
  and extracts the ordered zero level set ($\phi = 0$, $\psi = 0.5$) at $t = 1500$ via marching squares.

## Running the exporter

Run the headless WebGPU exporter from the repository root:

```bash
# Short smoke run
node scripts/export-pfhub-b3.mjs --grid=512 --tmax=50 --sample-dt=25 --out=verify-out/pfhub-smoke

# Full Benchmark 3 run (t = 1500 on 2048x2048 -> 1024x1024 quadrant [0,960]^2)
node scripts/export-pfhub-b3.mjs --grid=2048 --tmax=1500 --sample-dt=50 --out=pfhub/results-b3-2048
```

Output files:
1. `bm3_results.csv` (`time,free_energy,tip_position,solid_fraction`)
2. `free_energy.csv`, `solid_fraction.csv`, `tip_position.csv`
3. `phase_field_1500.csv` (ordered `x,y` contour of $\phi = 0$ at $t = 1500$)
4. `meta.yaml` (PFHub metadata manifest)
5. `pfhub.json` (hardware, provenance, and comparison summary)

## Results (`results-b3-2048`, $t = 1500$)

Run in headless Chrome WebGPU on an integrated laptop GPU (`2048x2048` full symmetric domain $[-960, +960]^2$, `1024x1024` quadrant $[0, 960]^2$, $dx = 0.9375\,W_0$, $dt = 0.012742\,\tau_0$, `117,720` explicit steps, `507.2 s` solver time / `551.8 s` total wall time including 31 readbacks):

| Code / Submission | Free Energy $\mathcal{F}(1500)$ | Solid Fraction $f_s(1500)$ | Tip Position $x_{\text{tip}}(1500)$ | Notes |
|---|---|---|---|---|
| **SOLIDIFY v8.0.0 (WebGPU)** | **1,991,161** | **0.016931** | **258.07** | Browser WGSL `f32`, 507 s (`results-b3-2048/`) |
| `moose_itg_3a` (Penn State MOOSE) | 1,988,326 (+0.14%) | 0.016984 (-0.31%) | 264.00 (-2.25%) | Adaptive FEM (8 cores, 228 s) |
| `inl_moose_3a` (INL MOOSE) | 1,976,212 (+0.76%) | 0.018780 (-9.85%) | 280.94 (-8.14%) | Adaptive FEM (6 cores, 67.5 s) |
| `PRISMS_PF_3a_cubic` (UMich) | 1,972,025 (+0.97%) | 0.019309 (-12.31%) | 294.14 (-12.26%) | Cubic adaptive FEM (6 cores, 178 s) |
| `memphis_3a` (Sandia MEMPHIS) | n/a | n/a | 216.84 (+19.01%) | Explicit Euler FD (16 cores, 8,215 s) |

![NIST PFHub Benchmark 3 comparison](results-b3-2048/pfhub_b3_comparison.png)

## Dataset and submission links

1. Code release: [`v8.0.0`](https://github.com/fronkt/solidify/releases/tag/v8.0.0) and [`codemeta.json`](../codemeta.json).
2. Zenodo dataset (all 8 files in `pfhub/results-b3-2048/`): [10.5281/zenodo.24437743](https://doi.org/10.5281/zenodo.24437743) (`https://zenodo.org/records/24437743`).
3. PFHub submission: `pfhub/pfhub-benchmarks#22` and the `pfhub` Zenodo Community.

---

# NIST PFHub Benchmark 1a (Spinodal Decomposition)

SOLIDIFY v8.5 also implements **NIST PFHub Benchmark Problem 1a: 2D Periodic Spinodal Decomposition** ([pages.nist.gov/pfhub/benchmarks/benchmark1.ipynb/](https://pages.nist.gov/pfhub/benchmarks/benchmark1.ipynb/); Jokisaari et al., *Comput. Mater. Sci.* 126 (2017) 139–151).

## Benchmark 1a setup

- **Model:** Conserved periodic 2D Cahn–Hilliard solver (`SpinodalSim` in `src/spinodal.ts`, 9-point Mehrstellen isotropic Laplacian for both $\mu$ and $\partial c/\partial t$, centered WGSL `f32` storage $u = c - c_{\text{mid}}$).
- **Domain and parameters:** Periodic square $[0, 200]^2$ on a $200 \times 200$ grid ($dx = 1.0$, $dt = 0.003363$), $c_\alpha = 0.3$, $c_\beta = 0.7$, $\rho_s = 5.0$, $\kappa = 2.0$, $M = 5.0$, $c_0 = 0.5$, $\varepsilon = 0.01$, target time $t = 1000$.
- **Initial condition (Jokisaari et al. 2017, Eq. 5):**
  $$c(x,y,0) = c_0 + \varepsilon\left[\cos(0.105x)\cos(0.11y) + \bigl(\cos(0.13x)\cos(0.087y)\bigr)^2 + \cos(0.025x - 0.15y)\cos(0.07x - 0.02y)\right]$$
- **Free energy and domain length:**
  $$\mathcal{F}(t) = \int_{[0,200]^2}\left[\rho_s(c - c_\alpha)^2(c_\beta - c)^2 + \frac{\kappa}{2}|\nabla c|^2\right]\,dA, \qquad L(t) = \frac{V(c_\beta - c_\alpha)}{\int |\nabla c|\,dA}$$

## Running the Benchmark 1a exporter

```bash
node scripts/export-pfhub-b1.mjs --grid=200 --tmax=1000 --sample-dt=25 --port=5297 --out=pfhub/results-b1-200
```

Output files in `pfhub/results-b1-200/`:
1. `bm1_results.csv` (`time,free_energy,chem_energy,grad_energy,domain_L,mean_c,mass_drift`)
2. `free_energy.csv` (`time,free_energy`)
3. `meta.yaml` (PFHub Benchmark 1a metadata manifest)
4. `pfhub_b1.json` (provenance, hardware, conservation, and monotonicity report)

## Results (`results-b1-200`, $t = 0 \dots 1000$)

Run in headless Chrome WebGPU on an integrated Intel Xe2-LPG GPU (`200x200` periodic $[0, 200]^2$, $dx = 1.0$, $dt = 0.003363$, `297,374` explicit steps, `4.09 s` GPU solver time / `15.39 s` total wall time including 41 readbacks). Free energy decayed strictly monotonically at all 41 checkpoints (`strictly_monotone_F: true`, `max_energy_increase: 0`), maximum mass drift stayed at $1.84 \times 10^{-6}$, late-stage chemical and gradient energies approached exact equipartition ($F_{\text{chem}} \approx F_{\text{grad}}$), and domain length coarsened monotonically ($L(25) = 10.72 \to L(1000) = 22.31$, log-log slope $\alpha = 0.196$ over the finite periodic box):

| Time $t$ | Free Energy $\mathcal{F}(t)$ | Chemical $\mathcal{F}_{\text{chem}}$ | Gradient $\mathcal{F}_{\text{grad}}$ | Domain Length $L(t)$ | Mean $\langle c \rangle$ | Mass Drift $\Delta\langle c \rangle$ |
|---:|---:|---:|---:|---:|---:|---:|
| 0.0 | 319.094 | 318.969 | 0.125 | 308.05 | 0.502548 | 0 |
| 25.0 | 200.528 | 116.168 | 84.360 | 10.72 | 0.502548 | +3.30e-9 |
| 100.0 | 135.062 | 70.062 | 64.999 | 14.33 | 0.502548 | -1.17e-7 |
| 250.0 | 110.790 | 56.134 | 54.656 | 17.09 | 0.502548 | +1.22e-7 |
| 500.0 | 96.591 | 48.659 | 47.931 | 19.51 | 0.502548 | +2.87e-7 |
| 750.0 | 89.768 | 45.185 | 44.583 | 20.98 | 0.502547 | -7.34e-7 |
| 1000.0 | 84.370 | 42.480 | 41.890 | 22.31 | 0.502546 | -1.84e-6 |
