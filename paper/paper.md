---
title: 'SOLIDIFY: A Real-Time, Browser-Native WebGPU Phase-Field Laboratory for Solidification, Alloy Chemistry, and Heat Treatment'
tags:
  - materials science
  - phase-field modeling
  - solidification
  - dendritic growth
  - metallurgy education
  - WebGPU
authors:
  - name: Frank Cai
    orcid: 0009-0003-0041-1459
    affiliation: 1
affiliations:
  - name: Purdue University, West Lafayette, IN, USA
    index: 1
date: 22 November 2026
bibliography: paper.bib
---

# Summary

`SOLIDIFY` is a free, open-source, zero-install browser instrument for real-time two- and three-dimensional phase-field solidification, dilute-alloy microsegregation, foundry thermal analysis, and solid-state heat treatment ([solidify.frankcai.dev](https://solidify.frankcai.dev/)). Built in TypeScript and WGSL compute shaders on WebGPU, it solves both the classical multi-grain Kobayashi anisotropic phase-field model [@Kobayashi1993] and a quantitative thin-interface Karma–Rappel solver [@KarmaRappel1998] with an Echebarria–Folch–Karma–Plapp anti-trapping current [@Echebarria2004] directly on a student's or researcher's local GPU.

Rather than hiding equations behind scripted animations or restricting access to cluster-bound research codes, `SOLIDIFY` renders the live PDE state through ten simultaneous characterization lenses (incandescent melt, polarized grain orientation, etched optical micrograph, thermal camera, scanning electron relief, synchrotron solute radiography, curvature, isotherms, and 3D serial sectioning). It pairs the solver with a 118-element periodic alloy composer backed by CALPHAD-reconciled binary invariants, a controlled foundry Lab Mode with cooling-curve analysis and 3D rasterized molds, an Arrhenius-integrated Monte Carlo Potts heat-treatment engine, and a 47-script automated verification suite.

# Statement of Need

Solidification microstructure evolution sits at the core of undergraduate materials science, physical metallurgy, and foundry engineering curricula, covering the Mullins–Sekerka instability [@MullinsSekerka1964], constitutional undercooling, Gulliver–Scheil microsegregation [@Scheil1942], heterogeneous nucleation and recalescence [@Thevoz1989; @Greer2000], shrinkage and gas porosity [@Niyama1982; @Ransley1948], and solid-state grain coarsening [@Anderson1984]. In practice, however, these topics are taught almost exclusively through static textbook diagrams or through offline research codes such as MOOSE/MARMOT [@SchwenMOOSEMARMOT2017], FiPy, or PRISMS-PF, which require compilation, meshing, and post-processing before a learner can observe a single dendrite arm form.

At the same time, simplified classroom animations often blur the line between physically solved PDE behavior and decorative graphics, leaving students unable to tell which numbers are quantitative predictions and which are qualitative visual analogies. `SOLIDIFY` bridges this gap by combining interactive, zero-install WebGPU execution with an itemized verification standard: quantitative features are checked against published analytical and microscopic-solvability benchmarks, unmodeled physics (such as non-unit Lewis numbers, secondary eutectic growth, or precipitate aging) are explicitly flagged in the UI, and deterministic share links plus Run-Export ZIP archives let instructors assign and grade reproducible 50-minute virtual laboratories.

# Architecture and Physical Models

## 1. Dual 2D and 3D WebGPU Phase-Field Solvers

In 2D (`512^2` to `2048^2` cells), `SOLIDIFY` integrates coupled phase-field ($\phi$), thermal ($T$), dilute solute ($c$), solidification-age, and grain-ID fields using compact 9-point Laplacians and flux-form anisotropy passes over ping-pong storage textures with GPU fence backpressure. Switching on **TRUE 3D** runs a full volumetric solver (up to `192^3` $\approx 7.1 \times 10^6$ voxels) with per-grain orientation quaternions supporting cubic $\langle 100 \rangle$, hexagonal basal/$c$-axis, icosahedral five-fold, and cusped $\{100\}$ interface energies, rendered live via bisection-refined raymarching, free serial sectioning, stereology comparison, and STL mesh export.

Two solver modes coexist cleanly:

- **Similarity mode (Kobayashi + Warren–Boettinger):** Rapid interactive exploration of 4-fold and 6-fold dendrites, seaweed morphology ($\delta \to 0$), columnar-to-equiaxed transitions, Bridgman directional growth, moving Beer–Lambert laser welding, helical single-crystal grain selectors, and forced 2D D2Q9 lattice-Boltzmann melt convection [@WarrenBoettinger1995; @Tong2001].
- **Quantitative calibrated mode (Karma–Rappel + Anti-Trapping):** Enforces thin-interface asymptotics $d_0 = a_1 W_0 / \lambda$ and $\tau_0 = a_2 \lambda W_0^2 / D$ ($a_1 = 0.8839$, $a_2 = 0.6267$), locking cell pitch, timestep, and physical length scale to material capillary length $d_0$ and diffusivity $D$ (e.g., $d_0 = 3.2\text{ nm}$, $W_0 = 109\text{ nm}$, $0.087\ \mu\text{m/cell}$ for Al–4.5Cu). For alloys, an anti-trapping current eliminates finite-interface solute trapping so the effective partition coefficient stays width-independent.

## 2. Alloy Composer and 118-Element Thermodynamic Screening

The Alloy Composer computes dilute-limit liquidus depression $\Delta T_L = \sum m_i c_i$ and the Easton–StJohn growth restriction factor $Q = \sum m_i c_i (k_i - 1)$ [@EastonStJohn1999; @KurzFisher1998], collapsing multicomponent recipes into the solver's pseudo-binary solute field ($k_{\text{eff}} = 1 - Q/|\Delta T_L|$) while drawing the linearized dominant binary phase diagram from 25 cited, CALPHAD-reconciled binary invariant rows (table version `1.2.0`).

Across six base metals (Al, Fe, Ni, Mg, Cu, Zn) and all 118 elements (708 pairs), `SOLIDIFY` classifies 25 pairs as pourable (`ASSESSED`) and converts the remaining 683 pairs into quantitative teaching refusals backed by Clausius–Clapeyron vapor-pressure advisories (e.g., 59 atm for Zn over Fe, 16 atm for Mg over Fe, 39 atm for Hg over Al, and 1.4 atm ideal advisory for Cu–30Zn brass), Hume–Rothery substitutional size checks, Hägg's interstitial ratio $r/R < 0.59$ for C/N/B/H (0.604 for Fe–C), and five checked monotectic immiscibility gaps. For compositions crossing solid solubility (such as A356 at 7 wt% Si) or peritectic boundaries (1045 steel at 0.45 wt% C), the composer explicitly prints equilibrium phases and Gulliver–Scheil fractions alongside the single primary phase the solver grows.

## 3. Nucleation Ratchet, Foundry Lab Mode, and Heat Treatment

Heterogeneous nucleation uses a Rappaz–Greer Gaussian site-distribution ratchet [@Thevoz1989; @Greer2000]: each inoculant particle activates once upon reaching a new maximum undercooling, so latent-heat recalescence automatically shuts off further nucleation. **Lab Mode** locks pre-pour conditions (atmosphere, inoculant count, refiner-fade hold time, superheat, cooling program, 3D mold geometry including shell, plate, wedge, and a four-thickness step block, and an optional Hall–Petch yield strength target), then generates a post-pour report card extracting cooling-curve landmarks ($T_L, T_N, \Delta T_r, T_S$) [@Stefanescu2015], Newtonian zero-curve solid fraction [@Fras1993], Ransley–Neufeld Sievert hydrogen rejection [@Ransley1948], local 3D Niyama porosity risk [@Niyama1982], Clyne–Davies cracking susceptibility [@ClyneDavies1981], and per-section grain censuses.

Because hour-scale furnace anneals span $\sim 10^{11}$ calibrated solidification timesteps, **Heat Treat** runs on a separate solid-state hours clock with $\phi$ frozen. Simpson quadrature integrates material Arrhenius laws through ramps and soaks into budgets for a sublattice GPU Monte Carlo Potts grain-growth pass (calibrated per dimension: 2D $m = 2.44$, 3D $m = 2.25$), Zener particle pinning ($d_{\lim} = 7.24\, r^{0.205} / f^{0.356}$ cells in 2D), stacking-fault-energy-gated 3D $\Sigma 3$ annealing twins [@Murr1975], masked solid-state homogenization, analytical parabolic oxidation [@Wagner1933], 3D stored-energy strain-induced boundary migration with analytical second-order dislocation recovery, and Hall–Petch yield strength evaluation [@Hall1951; @Petch1953].

# Quantitative Verification

`SOLIDIFY` ships with 47 automated browser-free and headless WebGPU verification scripts. Key benchmark results are summarized below:

| Benchmark | Published / Analytical Reference | SOLIDIFY Measurement | Agreement |
|---|---|---|---|
| 2D steady tip velocity $V d_0 / D$ | Karma & Rappel (1998): `0.0170` ($\Delta=0.55, \varepsilon_4=0.05$) | `0.01679` | `1.2 %` |
| 2D parabolic tip radius $\rho / d_0$ | Tong et al. (2001): `27.6` | `28.8` | `4.4 %` |
| 2D critical nucleus radius $R^*$ | Gibbs–Thomson $d_0/\Delta = 22.10\,W_0$ | `22.21 W_0` (profile `0.997 W_0`) | `0.5 %` |
| Anti-trapping effective partition $k_{\text{eff}}$ | True $k = 0.15$ across $W_0/d_0$ | `0.135–0.150` ON (`0.186–0.209` OFF) | Width-independent |
| Solute conservation (20,000 steps) | Constant total solute | `1.6e-3` drift | Conserved |
| Arrhenius ramp quadrature | 64$\times$ refined reference | `3e-8` relative error | Exact |
| Solute homogenization decay | Exact discrete DCT-II eigenmode | `9e-7` relative error (2D & 3D) | Exact |
| 2D Al anneal end-to-end (12 h, 520 °C) | Material law endpoint `50.4 µm` | `14.0 -> 48.6 µm` | `0.96–1.00` |
| 3D stored-energy barrier (128³ bicrystal) | Exact 26-neighbor flat-face $\Delta H = 8\,J_b$ | $v(8)=0.317$, $v(6)=0.152$ cells/sweep | Brackets barrier |

Equally important for classroom reliability, `SOLIDIFY` documents and tests its own known limits: 2D coupled alloys do not match physical Lewis numbers ($\sim 10^4$), the phase-field solver grows only one primary solid phase (no eutectic lamellae or T6 precipitates), 2D melt convection remains qualitative in magnitude, and 3D moving-needle calibration against @KarmaRappel1998 remains an active open study.

# Classroom Adoption, Reproducibility, and Availability

`SOLIDIFY` is distributed under the MIT License at [solidify.frankcai.dev](https://solidify.frankcai.dev/) with source code at [github.com/fronkt/solidify](https://github.com/fronkt/solidify). Four turnkey 50-minute undergraduate MSE lab modules with deterministic share links, Run-Export ZIP submission checklists, and an instructor solution key are provided in `docs/labs/`, alongside a Purdue nanoHUB Jupyter analysis companion (`nanohub/`) and a reproducible NIST PFHub Benchmark 3 export script (`scripts/export-pfhub-b3.mjs`). Formal classroom pre/post learning-gain assessment is planned with university partner courses.

# References
