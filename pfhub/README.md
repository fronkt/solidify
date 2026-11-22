# NIST PFHub Benchmark 3 (Dendritic Growth) Submission Package

This folder holds SOLIDIFY's reproducible submission setup for **NIST Phase Field Community Hub (PFHub) Benchmark Problem 3: Dendritic Growth** ([pages.nist.gov/pfhub/benchmarks/benchmark3.ipynb/](https://pages.nist.gov/pfhub/benchmarks/benchmark3.ipynb/)).

## Benchmark Specification Implemented
- **Model:** Quantitative Karma–Rappel thin-interface phase-field solver (`solver = 1` in `src/sim.ts`)
- **Domain:** $960 \times 960$ quarter-symmetry domain with zero-flux Neumann boundary conditions and initial solid seed radius $R_0 = 8$ at $(0, 0)$
- **Parameters:** $W_0 = 1$, $\tau_0 = 1$, $D = 10$ ($\lambda = D / a_2 = 15.9566$), $\varepsilon_4 = 0.05$, $\Delta = 0.3$, target time $t = 1500$

## Generating the Submission Dataset

Run the reproducible WebGPU exporter from the repository root:

```bash
# Quick smoke check (short horizon)
node scripts/export-pfhub-b3.mjs --grid=512 --tmax=50

# Full Benchmark 3 export (t = 1500 on 1024x1024 or 2048x2048)
node scripts/export-pfhub-b3.mjs --grid=1024 --tmax=1500
```

This writes the exact required files into `pfhub/out/`:
1. `solid_fraction.csv` (`time,solid_fraction`)
2. `free_energy.csv` (`time,free_energy`)
3. `tip_position.csv` (`time,tip_position`)
4. `phase_field_1500.csv` (`x,y` ordered $\phi = 0.5$ level-set contour at $t = 1500$)
5. `pfhub.json` (provenance, hardware, and column mapping metadata)

## Uploading to Zenodo & PFHub
1. Ensure [`codemeta.json`](../codemeta.json) is live on the public GitHub repository (`main`).
2. Create a new Zenodo dataset deposit containing the 5 files generated in `pfhub/out/` (plus a screenshot/video of the growing dendrite) and publish to mint a permanent **Zenodo DOI**.
3. Submit the Zenodo DOI and `https://github.com/fronkt/solidify` via the official [PFHub Upload Portal](https://pages.nist.gov/pfhub/simulations/upload_form/).
