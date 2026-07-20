---
title: 'SOLIDIFY: A Real-Time WebGPU Instrument for Interactive Phase-Field Solidification'
tags:
  - WebGPU
  - phase-field
  - solidification
  - materials science education
  - dendritic growth
  - scientific visualization
authors:
  - name: Frank Cai
    orcid: 0009-0003-0041-1459
    affiliation: 1
affiliations:
  - name: Purdue University, West Lafayette, IN, USA
    index: 1
date: DRAFT — not yet submitted
bibliography: paper.bib
---

## Summary

SOLIDIFY is a browser-based, real-time simulation instrument for the Kobayashi anisotropic
phase-field model of dendritic solidification [@Kobayashi1993], extended to many grains, a
Warren–Boettinger-type dilute alloy solute field [@WarrenBoettinger1995], and stochastic growth
twinning. The entire solver runs as WGSL compute shaders on the GPU via the WebGPU API: two
coupled fields (an order parameter and a temperature, plus a solute concentration and a
solidification-age channel) are integrated with explicit Euler time-stepping on a compact
9-point Laplacian stencil, sustaining roughly 10^9 cell-updates per second on a mid-range
discrete GPU with no installation beyond a WebGPU-capable browser.

Around the solver, SOLIDIFY provides ten simultaneous rendering "lenses" that reinterpret the
same state fields the way different real characterization instruments would — an incandescent
melt view, cross-polarized grain orientation, an etched metallographic micrograph with a scale
bar, isotherms, solidification-time isochrones, a thermal-camera palette, a secondary-electron
SEM look, and a synchrotron-radiograph absorption view sensitive to solute segregation — plus
free-growth, directional (Bridgman-type pulled-gradient) and laser-remelt scenarios, ten
qualitative material identities whose crystal structure sets dendrite symmetry, an alloy
composer that maps user-entered compositions onto real dilute-limit liquidus-slope and
partition-coefficient chemistry (reporting the liquidus depression and growth-restriction
factor of Easton and StJohn [@EastonStJohn1999]), and foundry-style analysis instruments
(a cooling-curve probe, a Scheil-path overlay [@Scheil1942], and a linear-intercept secondary
dendrite arm spacing ruler). A separable CMA-ES process optimizer searches cooling schedules
against a target ASTM E112 grain number [@ASTM_E112], exposing an interactive "engineer it" /
challenge mode. Software and a live deployment are available at
<https://solidify.frankcai.dev>; source is at <https://github.com/fronkt/solidify>.

## Statement of need

Phase-field solidification is a canonical topic across materials science, physics, and
mechanical engineering curricula, but the tools that actually solve the governing equations —
MOOSE/MARMOT [@SchwenMOOSEMARMOT2017], OpenPhase, MICRESS — are HPC- or desktop-oriented
research codes aimed at producing publication-grade microstructure data, not classroom
interaction: they require installation, meshing/solver expertise, and offline post-processing
before a single dendrite can be seen growing. The pedagogical alternative is usually a static
textbook figure or a pre-rendered video, which cannot be perturbed, re-parameterized, or
explored by a student in real time. SOLIDIFY closes that gap: because the solver is native
WebGPU compute running client-side, a browser tab *is* the interactive instrument — a student
or instructor can change undercooling, symmetry, alloy composition, or cooling schedule and
watch the Mullins–Sekerka instability [@MullinsSekerka1964], dendrite tip selection, the
columnar-to-equiaxed transition, or solute-driven grain refinement emerge from the same
equations in the same session, with no install step and no separate visualization pipeline.

A second need this addresses is transparency about simulation fidelity. Interactive science
demonstrations are prone to silently substituting scripted or stylized behavior for the
underlying model wherever real physics would be too slow or too subtle to render — a
particular risk for anything targeting a general or student audience rather than domain
specialists who could catch the substitution. SOLIDIFY's `/science` page enumerates, item by
item, what is dimensionless-but-canonical (dendrite/seaweed/snowflake morphology, matched
against the published Kobayashi figures), what is emergent-and-qualitative (grain impingement,
CET, weld epitaxy), what is real dilute-limit chemistry (the alloy composer's liquidus shift
and growth-restriction factor), and what is purely a display choice (per-material melt
incandescence). This labeling is verified in one instrumented, in-app measurement: under
identical nucleation and cooling, a grain-refined A356+TiB composition
(growth-restriction factor Q ≈ 71 K) froze into 369 grains at ASTM G 6.2, versus 46 coarse
grains at G 2.8 for nearly pure Al–1Zn (Q ≈ 0.9 K) — the Easton–StJohn grain-refinement
mechanism [@EastonStJohn1999] emerging from the phase-field rather than being scripted, and
reported as a number rather than an unverified visual impression.

SOLIDIFY is intended for use as a lecture demonstration and self-directed learning tool in
materials science and engineering courses covering solidification, casting, and
microstructure evolution, and as a reference implementation of the numerical practices
(compact-stencil anisotropic Laplacians, divergence-form flux textures, GPU-fence backpressure)
needed to run this class of phase-field model interactively rather than offline.

## References
