# Lab 4: Solid-State Heat Treatment, Grain Growth, Zener Pinning, and Hall–Petch Design

**Estimated time:** 50 minutes  
**Prerequisites:** Arrhenius kinetics, curvature-driven grain growth, Hall–Petch relation, stacking-fault energy  
**App link:** [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/)

## Learning Objectives
By the end of this lab, you will be able to:
1. Explain why solid-state heat treatment operates on an Arrhenius-integrated hours clock separate from the microsecond solidification clock.
2. Predict grain coarsening and Hall–Petch yield strength evolution across thermal ramps and isothermal soaks.
3. Quantify how second-phase particle dispersions (Zener pinning) stall grain coarsening at a finite limiting grain diameter.
4. Contrast annealing-twin formation across metals of different stacking-fault energy (Cu vs. Al vs. BCC steel) and design a cast-plus-anneal route that satisfies a strength specification.

---

## Part A: Casting a Baseline Polycrystal & Arrhenius Coarsening (15 min)

1. Open [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/). Open **MATERIAL** and select **Al–4Cu (FCC)**.
2. Click `casting` in **PRESETS**, switch the lens to **ORIENT**, and run until the casting is fully solid (~95–100%). Pause the simulation.
3. Open **MODES** → **heat treat**.
4. Record the starting as-cast grain diameter $\bar{d}_0$ ($\mu\text{m}$) and Hall–Petch strength $\sigma_{y,0}$ (MPa).
5. Run two schedules (resetting or recording sequentially):
   - **Schedule 1 (low-T stress relief):** `200 °C`, hold `4 h`. Record the predicted and measured grain growth, homogenization progress, and oxide scale thickness.
   - **Schedule 2 (high-T anneal):** `520 °C`, hold `12 h`. Record before/after $\bar{d}$, before/after $\sigma_y$, homogenization fraction, and passive oxide scale thickness (nm).
6. Note the solid-state lens banner: why does SOLIDIFY park the thermal lenses during heat treatment instead of displaying `520 °C` over the frozen solidification temperature field?

## Part B: Zener Particle Pinning (15 min)

1. Cast a fresh fine-grained **Al–4Cu** polycrystal (`casting` preset, solid ~95%).
2. Open **MODES** → **heat treat** and configure the same `520 °C`, `12 h` anneal as Schedule 2, **except** dial in a **Zener particle dispersion** (e.g., area fraction $f = 0.06$, particle radius $r = 2\text{ cells}$).
3. Run the treatment and compare the final grain diameter $\bar{d}$ and yield strength $\sigma_y$ against your unpinned Schedule 2 run.
4. Increase particle radius $r$ at fixed fraction $f$, or increase fraction $f$ at fixed radius $r$, and note which direction produces a tighter pinning limit $d_{\lim} \propto r^{0.205} / f^{0.356}$.

## Part C: Stacking-Fault Energy & 3D Annealing Twins (10 min)

1. Flip **TRUE 3D · VOLUME** ON.
2. Cast a polycrystalline **Cu (copper)** specimen (`casting` preset, run to ~90% solid), switch lens to **ORIENT**, and open **heat treat** (`880 °C`, `6 h`). Run the treatment and observe planar **Σ3 annealing twins** (60° about $\langle 111 \rangle$) forming and surviving inside coarsening grains.
3. Repeat with **Al–4Cu** (`520 °C`, `6 h`) and **Steel (Fe–C)** (`900 °C`, `1 h`). Record the exact reason printed by SOLIDIFY for why neither aluminum nor BCC $\delta$-ferrite steel forms annealing twins here.

## Part D: Meeting a Pre-Committed Strength Specification (10 min)

1. Return to 2D **Al–4Cu**, cast a coarse specimen (low cooling rate / low inoculant), and open **heat treat**.
2. Dial a target **spec $\sigma_y$** slightly **above** the casting's current as-cast yield strength. Read the panel's immediate pre-run message.
3. Now cast a finer specimen (higher inoculant `n_max` and faster cooling in `Lab Mode` or `MELT · PROCESS`), choose a homogenization/anneal schedule (with or without Zener pinning), and verify a **PASS** verdict against your pre-committed strength specification. Export the **Run Export (ZIP)** as proof.

---

## Deliverables & Analysis Questions

1. **Two clocks:** Why can SOLIDIFY not simply keep stepping the phase-field PDE for 4 hours to simulate a furnace anneal? Estimate the order of magnitude of timesteps required if $\Delta t \sim 10^{-7}\text{ s}$.
2. **Ramp integration:** Why does integrating the Arrhenius rate law only over the isothermal hold temperature undercount total coarsening during a slow furnace ramp?
3. **Zener pinning & Hall–Petch:** Quantify how much Hall–Petch yield strength (in MPa) Zener pinning preserved in Part B relative to unpinned coarsening. In real industrial alloys, what microstructural feature provides Zener drag (e.g., dispersoids, carbides)?
4. **Annealing twins:** Explain why copper (SFE $\approx 78\text{ mJ/m}^2$) forms abundant annealing twins while aluminum (SFE $\approx 166\text{ mJ/m}^2$) does not. Why did steel refuse annealing twins in SOLIDIFY despite austenitic steels twinning in practice?
5. **Engineering design & model limits:** Why can no pure-coarsening furnace schedule raise $\sigma_y$ above the as-cast Hall–Petch value in SOLIDIFY? What strengthening mechanism in real heat-treatable Al alloys (such as 6061-T6 or A356-T6) *does* raise strength during aging, and how does SOLIDIFY's report card handle that missing mechanism?
