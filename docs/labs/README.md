# SOLIDIFY Classroom Labs (Undergraduate MSE)

Four hands-on labs for introductory materials science, phase transformations, physical metallurgy, and foundry courses. Everything runs directly in a WebGPU browser (Chrome, Edge, Safari 26+, or recent Firefox) at [solidify.frankcai.dev/app/#labs](https://solidify.frankcai.dev/app/#labs) with no install or account required.

Each lab opens the in-app **Guided Labs** tracker (also available from `guided labs` under `MODES` in the right rail or the bottom-left quick pill), which checks experimental milestones against live simulation state, logs paired measurements into a `DATA` table, and exports a reproducible ZIP archive (`export lab ZIP`) carrying `lab-report.json`.

## Course mapping

| Lab | Direct launch | Topic | Target courses | Time | Core concepts |
|---|---|---|---|---|---|
| [Lab 1](lab-01-dendrites-and-calibration.md) | [Launch Lab 1](https://solidify.frankcai.dev/app/#lab=1) | Dendrites, Symmetry & Calibration | Intro MSE, Phase Transformations | 35 min | Mullins–Sekerka instability, anisotropy ($j=4$ vs. $6$ vs. seaweed), Karma–Rappel thin-interface calibration, SDAS convergence, anti-trapping $k_{\text{eff}}$ |
| [Lab 2](lab-02-alloys-and-scheil.md) | [Launch Lab 2](https://solidify.frankcai.dev/app/#lab=2) | Alloys, Screening & Scheil | Physical Metallurgy, Phase Diagrams | 35 min | Liquidus depression $\Delta T_L$, growth restriction $Q$, 118-element screening, lever rule vs. Gulliver–Scheil, controlled $Q$ pair |
| [Lab 3](lab-03-3d-casting-and-niyama.md) | [Launch Lab 3](https://solidify.frankcai.dev/app/#lab=3) | 3D Casting, Cooling & Niyama | Foundry, Solidification Processing | 40 min | Rappaz/Greer nucleation & recalescence, refiner fade, step-block section effect, 2D-vs-3D stereology, Niyama & Sievert porosity |
| [Lab 4](lab-04-heat-treatment-and-hall-petch.md) | [Launch Lab 4](https://solidify.frankcai.dev/app/#lab=4) | Heat Treat & Hall–Petch Specs | Physical Metallurgy, Mechanical Behavior | 40 min | Arrhenius ramp+hold integration, Potts grain coarsening, Zener pinning, $\Sigma 3$ annealing twins (SFE), Hall–Petch specification design |

## Student submissions and reproducibility

Each run carries a deterministic RNG seed and an **`export lab ZIP`** button inside the Guided Labs panel (extending SOLIDIFY's Run Export ZIP under `ADVANCED`) containing:
- `lab-report.json` (`format: "solidify-lab-report"`, `version: 1`: completed/skipped step statuses, captured comparison tables, deterministic seed, setup link, and intervention flags)
- `run.json` (material, composition, seed, solver mode, grid size, unit bridge, and build ID)
- `data/*.csv` (cooling curve, solid fraction, grain census, Scheil profile)
- `micrograph.png` (current rendered view with scale bar, material, seed, and solver metadata)

Instructors can replay any student setup via its `#set=` / `#lab=` link or load the student's Run-Export ZIP in Python using `load_lab_report()` inside [nanohub/notebooks/Solidify_Interactive_Lab.ipynb](../../nanohub/notebooks/Solidify_Interactive_Lab.ipynb) to inspect completed steps (`X/5`), deterministic seed, intervention flags (`anyIntervened`), and captured comparison tables.

## Instructor resources

- [Instructor Solution Key & Grading Rubric](INSTRUCTOR-KEY.md)
- Companion Python / nanoHUB analysis notebook: [Solidify_Interactive_Lab.ipynb](../../nanohub/notebooks/Solidify_Interactive_Lab.ipynb)
- Equations and model limits: [solidify.frankcai.dev/science/](https://solidify.frankcai.dev/science/)
- Citation metadata: [CITATION.cff](../../CITATION.cff) (MIT License; free to copy and adapt for course packets or LMS modules)
