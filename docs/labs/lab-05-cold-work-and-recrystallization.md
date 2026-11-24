# Lab 5: Cold Work, Recovery, and Primary Static Recrystallization (3D)

**Estimated time:** 40 minutes  
**Prerequisites:** Stored deformation energy, dislocation recovery, strain-induced boundary migration (SIBM), Johnson–Mehl–Avrami–Kolmogorov (JMAK) kinetics  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=5](https://solidify.frankcai.dev/app/#lab=5)

> **In-app Guided Labs tracker:** Opening `#lab=5` stages a 3D `aluminum · Al–Cu` melt (`inoculant n_max = 600`, `coolRate = 0.35`, lens **ORIENT**) and opens the Guided Labs panel alongside `heat treat`. Every sub-barrier vs. active SIBM anneal, recovery drop, and JMAK Avrami fit logs into the `DATA` tab and exports via **`export lab ZIP`** or **`print report`**.

## Goals
1. Measure the 3D 26-neighbor Potts lattice threshold for strain-induced boundary migration (flat `{100}` barrier $\Delta H = 8\,J_b$, kink-assisted onset near $5\text{–}6\,J_b$).
2. Explain how second-order dislocation recovery $H_S = H_0 / (1 + \text{rec}\cdot H_0)$ preferentially drains the highest-energy grains and stalls boundary migration.
3. Fit the JMAK Avrami exponent $n$ for site-saturated primary static recrystallization on the Monte Carlo sweep clock and contrast it against steady-rate and grain-boundary nucleation.
4. Identify the exact model boundaries of SOLIDIFY's stored-energy fabric, curvature-law withdrawal, and sweep-clock kinetics.

---

## Part A: Sub-Barrier vs. Active Cold Work (3D SIBM) (15 min)

1. Open [solidify.frankcai.dev/app/#lab=5](https://solidify.frankcai.dev/app/#lab=5) (confirm **`TRUE 3D`** is ON and **MATERIAL** is **`aluminum · Al–Cu`**).
2. Press **▶ run** (tip: use **`×2`** or **`×4`** in transport) until solid fraction passes **90 %**, then click **❚❚ pause**.
3. Open **MODES** -> **`heat treat`**. Set `temperature` to **`490–520 °C`** and `hold` to **`45–90 min`** (safe below the `96³`/`128³`/`192³` domain-limit cap), with `dispersion` set to `none` and `nuclei` set to `none`.
4. Run two cold-work treatments (recording initial/final $\bar{d}$, sweeps delivered, and recovery from the report card):
   - **Sub-barrier run:** set `cold work` to **`1.0–2.5 J_b`** (mean deposited; per-grain spread $0\text{–}2\bar{H}$) and click **`▶ run treatment`**.
   - **Active SIBM run:** set `cold work` to **`≥ 6.0 J_b`** (for example `6.5` or `7.0 J_b`, `nuclei` still `none`) and click **`▶ run treatment`**.
5. Inspect the report card notice showing that SOLIDIFY withdraws the curvature-only grain-growth law prediction (and holds back $\Sigma 3$ annealing twins) whenever `cold work > 0`.

## Part B: Second-Order Recovery & Endpoint Withdrawal (10 min)

1. Still inside 3D **`heat treat`** (`aluminum · Al–Cu`, `nuclei` `none`), raise `cold work` to **`8.0–10.0 J_b`**.
2. Set `temperature` to **`500–520 °C`** and `hold` to **`60–90 min`** so the schedule delivers at least **180 Monte Carlo sweeps** (`recovery ≥ 0.15`), then click **`▶ run treatment`**.
3. Record from the `cold work` row on the report card:
   - Mean deposited stored energy $\bar{H}_0$ and starting peak grain energy $2\bar{H}_0$ (in $J_b$)
   - Recovered mean stored energy and recovered peak grain energy after $S$ sweeps
   - Total sweeps delivered and whether the curvature-only $\bar{d}$ prediction stayed withdrawn

## Part C: Primary Static Recrystallization & Avrami Exponent $n$ (15 min)

1. Keep 3D **`heat treat`** at `cold work` **`8.0–10.0 J_b`**, `temperature` **`500–520 °C`**, and `hold` **`60–90 min`** (re-cast a fresh 3D polycrystal if prior runs coarsened your volume near the domain cap).
2. **Site-saturated baseline:** set `nuclei` to **`150–400`**, set `nucleation` to **`random, at once`**, and click **`▶ run treatment`**. Inspect both recrystallization plots (`X(S)` and the Avrami log-log plot) and record final fraction $X$, fitted Avrami exponent $n$, $r^2$, and point count inside the fit window.
3. **Steady-rate nucleation:** keep `cold work` (`8.0–10.0 J_b`) and `nuclei` (`150–400`), switch `nucleation` to **`random, steady`**, and click **`▶ run treatment`**. Record $X$, $n$, and $r^2$.
4. **Grain-boundary nucleation:** switch `nucleation` to **`boundaries, at once`** (or **`boundaries, steady`**) and click **`▶ run treatment`**. Record $X$, $n$, and $r^2$, and compare the spatial distribution of recrystallized grains in **ORIENT** / **SLICE**.

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** (for `lab-report.json` + `run.json` + CSVs + `micrograph.png`) or **`print report`** (for a light-mode PDF summary) in the Guided Labs panel, and answer the questions below:

1. **Lattice barrier & kink onset:** On a 3D 26-neighbor simple-cubic Potts lattice, why is the flat `{100}` advance barrier equal to $8\,J_b$ (swapping 9 unlike neighbors for 17)? Why do real curved boundaries begin advancing near $5\text{–}6\,J_b$?
2. **Second-order recovery:** Using $H_S = H_0 / (1 + \text{rec}\cdot H_0)$, show why a high-energy grain ($H_0 = 20\,J_b$) loses a much larger fraction of its stored energy than a lightly deformed grain ($H_0 = 2\,J_b$) over the same sweep count. How does this narrow the driving force for boundary migration?
3. **Avrami exponents across modes:** Compare your fitted $n$ values for `random, at once`, `random, steady`, and `boundaries, at once` (or `boundaries, steady`) against the ideal 3D JMAK constant-speed limits ($n = 3$ for site-saturated random sites, $n = 4$ for constant-rate random sites). Why does concentrating nuclei on grain boundaries reduce $n$?
4. **Clock & mechanics boundaries:** Why does SOLIDIFY explicitly label Avrami $n$ as a **Monte Carlo sweep-clock** exponent rather than a real-time furnace exponent, and why is per-grain stored energy described as a deterministic hash fabric rather than a crystal-plasticity Taylor-factor solve?
