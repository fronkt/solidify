# Lab 4: Solid-State Heat Treatment, Grain Growth, Zener Pinning, and Hall–Petch Design

**Estimated time:** 40–50 minutes  
**Prerequisites:** Arrhenius kinetics, curvature-driven grain growth, Hall–Petch relation, stacking-fault energy  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=4](https://solidify.frankcai.dev/app/#lab=4)

> **In-app Guided Labs tracker:** Opening `#lab=4` stages a fine-grained 2D `aluminum · Al–Cu` melt (`inoculant n_max = 1800`, `coolRate = 0.45`) and launches the live Guided Labs panel beside `heat treat`. Every treatment, refusal, Zener-pinned spec pass, and 3D twin comparison records into the `DATA` tab and exports as `lab-report.json` via **`export lab ZIP`**.

## Goals
1. Explain why solid-state heat treatment runs on an Arrhenius-integrated hours clock separate from the microsecond solidification clock.
2. Predict grain coarsening and Hall–Petch yield strength evolution across thermal ramps and isothermal soaks.
3. Quantify how second-phase particle dispersions (Zener pinning) stall grain coarsening at a finite limiting grain diameter to satisfy a strength specification.
4. Contrast annealing-twin formation across metals of different stacking-fault energy (Cu vs. Al vs. BCC steel).

---

## Part A: Casting a Fine Baseline Polycrystal & Arrhenius Coarsening (15 min)

1. Open [solidify.frankcai.dev/app/#lab=4](https://solidify.frankcai.dev/app/#lab=4). The guided lab stages a fine **`aluminum · Al–Cu`** polycrystal (`inoculant n_max = 1800`, `coolRate = 0.45`, lens **ORIENT**). Press **▶ run** until solid fraction passes **95 %** (`d_0 ≈ 28–34 µm`, `σ_y ≈ 32–34 MPa`), then click **❚❚ pause**.
2. Open **MODES** → **`heat treat`**.
3. Record the starting as-cast grain diameter $\bar{d}_0$ ($\mu\text{m}$) and Hall–Petch strength $\sigma_{y,0}$ (MPa).
4. Run two unpinned schedules (`dispersion` set to `none`):
   - **Schedule 1 (low-T stress relief):** `200 °C` (or `≤ 250 °C`), hold `4 h` (`≥ 120 min`). Record the predicted and measured grain growth, homogenization progress, and oxide scale thickness.
   - **Schedule 2 (high-T anneal):** `550–570 °C`, hold `6–12 h` (`≥ 360 min`; stays cleanly below the 2D sweep cap). Record before/after $\bar{d}$, before/after $\sigma_y$, homogenization fraction, and passive oxide scale thickness (nm).
5. Note the solid-state lens banner: why does SOLIDIFY park the thermal lenses during heat treatment instead of displaying the furnace temperature over the frozen solidification temperature field?

## Part B: Incipient Melting, Strength Ceiling, and Zener Particle Pinning (15 min)

1. Still inside **`heat treat`**, raise `temperature` to at least **`635 °C`** (`≥ 0.97 T_m`) to trigger the incipient melting refusal and record the panel warning.
2. Lower `temperature` below `600 °C` and dial `spec σ_y` slightly **above** the casting's current yield strength. Read the panel's immediate pre-run refusal explaining why pure coarsening cannot raise strength above the as-cast value.
3. Click **`exit`** to leave `heat treat`, recast a fresh fine **`aluminum · Al–Cu`** polycrystal (click **`reset`**, then **▶ run** past **95 % solid**, pause), and reopen **`heat treat`**.
4. Configure the same high-T anneal (`550–570 °C`, `6–12 h`), set a target **`spec σ_y ≥ 30 MPa`**, and dial in a Zener **`dispersion`** (e.g., `2–4 vol %`, particle radius `r = 2 cells`).
5. Click **`▶ run treatment`** and verify a **met / PASS** verdict against your pre-committed strength specification. Compare the pinned final grain diameter $\bar{d}$ and yield strength $\sigma_y$ against your unpinned Schedule 2 run, and note how particle radius $r$ and fraction $f$ shift the pinning limit $d_{\lim} \propto r^{0.205} / f^{0.356}$.

## Part C: Stacking-Fault Energy & 3D Annealing Twins (10 min)

1. Click **`exit`** to close `heat treat`, then switch **`TRUE 3D`** ON (top right).
2. Pick **`copper · bronze`** in **MATERIAL**, select **`rain`** in **PRESETS**, and run past **85 % solid**. Switch lens to **ORIENT**, open **`heat treat`**, set **`780–800 °C`**, hold **`30–60 min`**, `dispersion` `none` (safe across `96³`, `128³`, and `192³` grids), and click **`▶ run treatment`**. Observe planar **Σ3 annealing twins** (60° about $\langle 111 \rangle$) nucleating and surviving inside coarsening grains.
3. Stay in **`TRUE 3D`**, switch **MATERIAL** to **`aluminum · Al–Cu`** or **`steel · Fe–C`**, run a fresh **`rain`** cast (to clear copper's twin plates and avoid `96³` domain-limit refusal), and run a **`30 min`** anneal (`500 °C` for Al or `900 °C` for steel) in **`heat treat`**. Record the exact reason printed by SOLIDIFY for why neither aluminum nor BCC $\delta$-ferrite steel forms annealing twins here.

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** in the Guided Labs panel to save your Run-Export ZIP (`lab-report.json` + `run.json` + CSVs + `micrograph.png`), and answer the questions below:

1. **Two clocks:** Why can SOLIDIFY not simply keep stepping the phase-field PDE for 4 hours to simulate a furnace anneal? Estimate the order of magnitude of timesteps required if $\Delta t \sim 10^{-7}\text{ s}$.
2. **Ramp integration:** Why does integrating the Arrhenius rate law only over the isothermal hold temperature undercount total coarsening during a slow furnace ramp?
3. **Zener pinning & Hall–Petch:** Quantify how much Hall–Petch yield strength (in MPa) Zener pinning preserved in Part B relative to unpinned coarsening. In real industrial alloys, what microstructural feature provides Zener drag (e.g., dispersoids, carbides)?
4. **Annealing twins:** Explain why copper (SFE $\approx 78\text{ mJ/m}^2$) forms abundant annealing twins while aluminum (SFE $\approx 166\text{ mJ/m}^2$) does not. Why did steel refuse annealing twins in SOLIDIFY despite austenitic steels twinning in practice?
5. **Engineering design & model limits:** Why can no pure-coarsening furnace schedule raise $\sigma_y$ above the as-cast Hall–Petch value in SOLIDIFY? What strengthening mechanism in real heat-treatable Al alloys (such as 6061-T6 or A356-T6) *does* raise strength during aging, and how does SOLIDIFY's report card handle that missing mechanism?
