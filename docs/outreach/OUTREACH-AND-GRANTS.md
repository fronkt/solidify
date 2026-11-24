# Outreach & Grant Drafts for SOLIDIFY v8.6.0 (Review & Send Manually)

All templates below are **drafts for your review**. Do not send without confirming links, dates, and recipient details.

---

## 1. Purdue MSE Faculty / Prof. Xiaoming Wang: Classroom Pilot & NSF Broader Impacts Pitch

**To:** Prof. Xiaoming Wang / Purdue MSE Solidification & Phase Transformations Faculty  
**Subject:** Zero-install browser phase-field lab (SOLIDIFY v8.6, Purdue nanoHUB DOI) for MSE courses + NSF Broader Impacts

Dear Professor [Name],

I wanted to share a zero-install WebGPU phase-field and physical-metallurgy laboratory I built, **SOLIDIFY** (https://solidify.frankcai.dev/, MIT License, now published on **Purdue nanoHUB** as 1 of 1,005 published tools with DOI `10.21981/C2CG-F533`: https://nanohub.org/resources/solidify).

It runs natively on student laptops in any WebGPU browser with no installs or cluster accounts, and now includes **9 interactive in-app Guided Labs (40 auto-verified live physics checks)** plus printable lab reports and Run-Export ZIP datasets covering the full undergraduate solidification and phase-transformations syllabus:
- 2D & 3D (`192^3`) dendritic solidification (Kobayashi + calibrated Karma–Rappel thin-interface + anti-trapping solver)
- 118-element Alloy Composer with CALPHAD-reconciled binary phase diagrams and Gulliver–Scheil segregation
- 3D step-block casting with cooling-curve recalescence landmarks and Niyama porosity
- Arrhenius-coupled Monte Carlo Potts grain growth, Zener pinning, 3D cold work & JMAK recrystallization, Hall–Petch yield strength, and **Shercliff–Ashby (1990) T6 precipitation hardening** (Al–Cu, A356, AA2024)
- **2D Folch–Plapp binary lamellar eutectic** with live Jackson–Hunt $\Delta T(\lambda)$ operating-point plot
- **2D (`200^2`) & 3D (`64^3` raymarched) Cahn–Hilliard spinodal decomposition** with Lyapunov free-energy decay and Lifshitz–Slyozov coarsening

On the verification side, SOLIDIFY has **two published NIST PFHub benchmark datasets** on Zenodo:
- **PFHub Benchmark 3a (Dendritic Growth, `t = 1500`):** `+0.14%` free energy, `-0.31%` solid fraction, `-2.25%` tip position vs. Penn State MOOSE (`10.5281/zenodo.24437743`, `pfhub/pfhub-benchmarks#22`)
- **PFHub Benchmark 1a (2D Periodic Spinodal Decomposition, `t = 1000` in 4.09 s GPU):** strictly monotone free-energy decay `319.09 -> 84.37` and `1.84e-6` mass conservation over 297,374 explicit steps (`10.5281/zenodo.24516519`, `pfhub/pfhub-benchmarks#23`)

Two ways this could fit cleanly into Purdue MSE:
1. **Classroom pilot:** If you or a colleague teaching introductory MSE, solidification, or phase transformations would like to try one of the 9 guided labs (or a 10-minute live lecture demo), I am happy to customize a deep link (`#lab=1..9`, `#eutectic`, `#spinodal`) for your syllabus.
2. **NSF Broader Impacts / IUSE / nanoHUB:** Since SOLIDIFY is already live on Purdue nanoHUB (`doi:10.21981/C2CG-F533`) with 30 automated CI verification suites and an explicit quantitative-vs-qualitative `/science/` guide, I would be glad to collaborate on embedding it as an already-verified interactive cyberinfrastructure deliverable in an NSF DMR, CAREER, or IUSE proposal.

Happy to walk through a 5-minute demo whenever convenient.

Best regards,  
Frank Cai  
Purdue University | cai485@purdue.edu | https://orcid.org/0009-0003-0041-1459

---

## 2. Emergent Ventures / 1517 Medici Grant Memo (Short-Form Application Pitch)

**Project:** SOLIDIFY (+ Browser-Native WebGPU Scientific Instruments Suite)  
**Builder:** Frank Cai (high school senior, paid Purdue University RA, NSF ACCESS PI `CHE260157`)  
**Live app:** https://solidify.frankcai.dev/ | **Code (MIT):** https://github.com/fronkt/solidify | **Purdue nanoHUB DOI:** `10.21981/C2CG-F533`

**What I built:**  
Most computational materials science lives either behind cluster-bound HPC codes (MOOSE, PRISMS-PF) or inaccurate toy animations. I built **SOLIDIFY**, a zero-install browser WebGPU phase-field and physical-metallurgy instrument running 3 coupled GPU PDE engines at interactive frame rates in a single unified workspace:
1. **2D (`2048^2`) & 3D (`192^3`, 7.1M voxels) Dendritic Solidification:** Kobayashi multi-grain solver + quantitative Karma–Rappel thin-interface solver with anti-trapping, Planar SoA `2048^2` D2Q9 LBM melt flow, 118-element Alloy Composer (708 pairs screened against CALPHAD invariants), 3D foundry step-block casting & Niyama porosity, and Arrhenius Potts heat treatment (Zener pinning, 3D JMAK recrystallization, Shercliff–Ashby T6 precipitation aging).
2. **2D Binary Lamellar Eutectic (Folch–Plapp 2005):** 3-phase directional solidification with moving frame, conservative solute diffusion, and live Jackson–Hunt $\Delta T(\lambda)$ curve.
3. **2D (`200^2`) & 3D (`64^3` raymarched) Cahn–Hilliard Spinodal Decomposition:** Conserved centered-`f32` solver tracking Lyapunov free energy and Lifshitz–Slyozov coarsening.

Unlike classroom animations, SOLIDIFY passes **30 automated CI verification suites**, is published on **Purdue nanoHUB** (1 of 1,005 published tools, DOI `10.21981/C2CG-F533`), has a manuscript under review at *Journal of Materials Education*, and has **two published NIST PFHub benchmark datasets on Zenodo**: Benchmark 3a dendritic growth (`+0.14%` free energy vs. Penn State MOOSE, `10.5281/zenodo.24437743`) and Benchmark 1a spinodal decomposition (`4.09 s` GPU to `t = 1000`, `1.84e-6` mass conservation, `10.5281/zenodo.24516519`).

**What this grant funds (concrete 6-month milestones):**
1. Run controlled classroom pilots across 5–10 undergraduate MSE courses using our 9 in-app Guided Labs (40 live physics checks + printable lab reports + nanoHUB Jupyter notebook).
2. Close remaining 3D quantitative thin-interface benchmarks (`Q3c`) and expand NIST PFHub benchmark coverage to 3D spinodal (1c) and eutectic growth.
3. Extend the same zero-install WebGPU scientific-instrument architecture to companion quantum and computational-chemistry labs (`Orbital`) so students anywhere can run benchmarked PDE simulations on a standard laptop.

**Ask:** $5,000–$15,000 (Emergent Ventures) / $1,000 (1517 Medici microgrant) for infrastructure, open-access dissemination (TMS/ASEE student travel), GPU testing hardware, and university pilot support.

---

## 3. Show HN / MatSci.org Launch Draft

**Title (Show HN):** `Show HN: Solidify – Real-time 2D/3D WebGPU phase-field metallurgy lab in the browser`

**Body:**  
Hi HN, I built **SOLIDIFY** (https://solidify.frankcai.dev/), an open-source, zero-install browser lab that solves coupled phase-field solidification, eutectic, and spinodal PDEs natively on your GPU via WebGPU compute shaders (TypeScript + WGSL, MIT: https://github.com/fronkt/solidify, published on Purdue nanoHUB with DOI `10.21981/C2CG-F533`).

What is under the hood beyond a visual demo:
- **Three unified GPU PDE engines in one workspace (`SOLIDIFY | EUTECTIC | SPINODAL`):**
  1. **2D (`2048^2`) & 3D (`192^3`) dendritic solidification:** Kobayashi multi-grain growth + quantitative Karma–Rappel thin-interface solver with anti-trapping, plus Planar SoA `2048^2` D2Q9 lattice Boltzmann melt convection.
  2. **2D Folch–Plapp binary lamellar eutectic:** 3-phase directional solidification with a moving frame, conservative face-flux solute diffusion, triple-junction grooves, and a live Jackson–Hunt $\Delta T(\lambda)$ curve.
  3. **2D (`200^2`) & 3D (`64^3` raymarched) Cahn–Hilliard spinodal decomposition:** Conserved 9-pt/19-pt Mehrstellen solver with centered-`f32` storage (`1.84e-6` mass drift over 297,374 explicit steps) and an orbitable 3D bicontinuous sponge.
- **Two published NIST PFHub benchmarks directly from browser WebGPU:**
  - **Benchmark 3a (Dendritic Growth, `t = 1500`):** matches Penn State MOOSE within `+0.14%` on free energy, `-0.31%` on solid fraction, and `-2.25%` on tip position in 507 s on a laptop iGPU (`10.5281/zenodo.24437743`).
  - **Benchmark 1a (Spinodal Decomposition, `t = 1000`):** completes 297,374 steps in 4.09 s on a laptop iGPU with strictly monotone Lyapunov decay (`319.09 -> 84.37`) and `1.84e-6` mass conservation (`10.5281/zenodo.24516519`).
- **Full physical-metallurgy workflow:** 118-element Alloy Composer (708 pairs screened against CALPHAD binary invariants & Scheil segregation), 3D foundry step-block casting & Niyama porosity, Arrhenius Potts heat treatment (Zener pinning, 3D JMAK recrystallization, Shercliff–Ashby T6 precipitation hardening), and **9 in-app Guided Labs** with 40 auto-verified live physics checks.
- **Explicit honesty about scope:** `/science/` (https://solidify.frankcai.dev/science/) documents exactly what is quantitatively benchmarked vs. qualitative (for example, why 2D melt flow remains labeled qualitative despite matching Tong et al.'s speed within `-2.15%` at `2048^2` `dx = 0.4`, and where 3D quantitative `Q3c` remains open).

Requires a WebGPU browser (Chrome, Edge, Safari 26+, recent Firefox). Happy to answer questions on WGSL compute shaders, phase-field numerics, or metallurgy!
