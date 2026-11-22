# SOLIDIFY Classroom Lab Pack (Undergraduate MSE)

Four ready-to-assign, 50-minute laboratory modules for introductory materials science, phase transformations, physical metallurgy, and foundry engineering courses. Every lab runs directly in a WebGPU-capable browser (Chrome, Edge, Safari 26+, or recent Firefox) at [solidify.frankcai.dev](https://solidify.frankcai.dev/app/) with zero software installation, accounts, or license fees.

## Course Mapping

| Lab | Topic | Target Courses | Core Concepts |
|---|---|---|---|
| [Lab 1](lab-01-dendrites-and-calibration.md) | Dendrites, Symmetry & Calibration | Intro MSE, Phase Transformations | Mullins–Sekerka instability, anisotropy ($j=4$ vs $6$ vs seaweed), Karma–Rappel thin-interface calibration, anti-trapping $k_{\text{eff}}$ |
| [Lab 2](lab-02-alloys-and-scheil.md) | Alloy Chemistry & Scheil Segregation | Physical Metallurgy, Phase Diagrams | Liquidus depression $\Delta T_L$, growth restriction $Q$, 118-element thermodynamic screening, lever rule vs. Gulliver–Scheil |
| [Lab 3](lab-03-3d-casting-and-niyama.md) | 3D Casting, Cooling Curves & Porosity | Foundry / Solidification Processing | Rappaz/Greer nucleation & recalescence, cooling-curve landmarks ($T_L, T_N, \Delta T_r, T_S$), step-block section effect, Niyama & Sievert porosity |
| [Lab 4](lab-04-heat-treatment-and-hall-petch.md) | Heat Treatment & Hall–Petch Specs | Physical Metallurgy, Mechanical Behavior | Arrhenius ramp+hold integration, Potts grain coarsening, Zener pinning, Σ3 annealing twins (SFE), Hall–Petch specification design |

## Student Submission & Reproducibility

Every experiment in SOLIDIFY carries a deterministic RNG seed and a one-click **Run Export (ZIP)** (inside `ADVANCED` or figure modals) containing:
- `manifest.json` (exact material, composition, seed, solver mode, grid size, and build ID)
- Raw CSV time-series datasets (cooling curve, solid fraction, grain census, Scheil profile)
- Print-ready light-background figure PNGs

Instructors can verify any student run by pasting the student's `#set=` share link into a browser or checking the exported `manifest.json` seed and intervention flags (Lab Mode automatically flags whether a student altered physics sliders mid-pour).

## Instructor Resources

- [Instructor Solution Key & Grading Rubric](INSTRUCTOR-KEY.md)
- Companion physics & model-boundary reference: [solidify.frankcai.dev/science/](https://solidify.frankcai.dev/science/)
- Citation metadata: [CITATION.cff](../../CITATION.cff) (MIT License; free to copy, adapt, and redistribute in course packets or Canvas/LMS modules)
