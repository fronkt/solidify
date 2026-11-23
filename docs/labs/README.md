# SOLIDIFY Classroom Labs (Undergraduate MSE)

Four 50-minute lab worksheets for introductory materials science, phase transformations, physical metallurgy, and foundry courses. Everything runs in a WebGPU browser (Chrome, Edge, Safari 26+, or recent Firefox) at [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/) with no install or account required.

## Course mapping

| Lab | Topic | Target courses | Core concepts |
|---|---|---|---|
| [Lab 1](lab-01-dendrites-and-calibration.md) | Dendrites, Symmetry & Calibration | Intro MSE, Phase Transformations | Mullins-Sekerka instability, anisotropy ($j=4$ vs. $6$ vs. seaweed), Karma-Rappel thin-interface calibration, anti-trapping $k_{\text{eff}}$ |
| [Lab 2](lab-02-alloys-and-scheil.md) | Alloy Chemistry & Scheil Segregation | Physical Metallurgy, Phase Diagrams | Liquidus depression $\Delta T_L$, growth restriction $Q$, 118-element screening, lever rule vs. Gulliver-Scheil |
| [Lab 3](lab-03-3d-casting-and-niyama.md) | 3D Casting, Cooling Curves & Porosity | Foundry / Solidification Processing | Rappaz/Greer nucleation & recalescence, cooling-curve landmarks ($T_L, T_N, \Delta T_r, T_S$), step-block section effect, Niyama & Sievert porosity |
| [Lab 4](lab-04-heat-treatment-and-hall-petch.md) | Heat Treatment & Hall-Petch Specs | Physical Metallurgy, Mechanical Behavior | Arrhenius ramp+hold integration, Potts grain coarsening, Zener pinning, $\Sigma 3$ annealing twins (SFE), Hall-Petch specification design |

## Student submissions and reproducibility

Each run carries a deterministic RNG seed and a **Run Export (ZIP)** button (under `ADVANCED` or figure modals) containing:
- `manifest.json` (material, composition, seed, solver mode, grid size, and build ID)
- Raw CSV time series (cooling curve, solid fraction, grain census, Scheil profile)
- Light-background figure PNGs

Instructors can replay any student run by opening their `#set=` share link or checking the exported `manifest.json` seed and intervention flags (Lab Mode records whether sliders were changed mid-pour).

## Instructor resources

- [Instructor Solution Key & Grading Rubric](INSTRUCTOR-KEY.md)
- Equations and model limits: [solidify.frankcai.dev/science/](https://solidify.frankcai.dev/science/)
- Citation metadata: [CITATION.cff](../../CITATION.cff) (MIT License; free to copy and adapt for course packets or LMS modules)
