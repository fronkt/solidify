# Lab 2: Alloy Chemistry, Growth Restriction, Phase Diagrams, and Scheil Segregation

**Estimated time:** 35–50 minutes  
**Prerequisites:** Binary phase diagrams (eutectic & peritectic reactions, lever rule, Gulliver–Scheil equation)  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=2](https://solidify.frankcai.dev/app/#lab=2)

> **In-app Guided Labs tracker:** Opening `#lab=2` launches the live Guided Labs panel beside the Alloy Composer and canvas. Every preset audit, element refusal, and controlled pour auto-verifies into the `DATA` tab and exports as `lab-report.json` via **`export lab ZIP`**.

## Goals
1. Compute dilute-limit liquidus depression ($\Delta T_L$) and the Easton–StJohn growth restriction factor ($Q$) for multicomponent alloys.
2. Distinguish between equilibrium solidification (lever rule) and non-equilibrium dendritic freezing (Gulliver–Scheil) both above and below the solid solubility limit $C_{\text{SM}}$.
3. Identify thermodynamic and physical reasons why candidate elements fail to form pourable dilute alloys (vapor boiling/fuming, immiscibility, interstitial size criteria).
4. Design a controlled simulation experiment that matches undercooling below each alloy's own liquidus rather than confounding bath temperature and solid fraction.

---

## Part A: Multicomponent Alloy Composition & Phase-Diagram Reading (15 min)

1. Open [solidify.frankcai.dev/app/#lab=2](https://solidify.frankcai.dev/app/#lab=2), expand **ALLOY**, and click **`alloy composer…`**.
2. Click the preset **`A356`** (`Al–7.0Si–0.35Mg`). Record:
   - Liquidus depression $\Delta T_L$ (K) and growth restriction factor $Q$ (K)
   - Dominant binary drawn on the phase diagram, maximum solid solubility $C_{\text{SM}}$, and eutectic composition/temperature
   - **Equilibrium leaves** vs. **Solver grows**
   - Reported **Lever** vs. **Gulliver–Scheil** eutectic fraction (%)
3. Click the preset **`AZ91`** (`Mg–9.0Al–0.7Zn`).
   - Notice that 9.0 wt% Al is **below** Mg–Al's equilibrium solid solubility limit (12.9 wt%).
   - Why does SOLIDIFY still report **11.9 %** eutectic $\beta\text{-Mg}_{17}\text{Al}_{12}$ under Gulliver–Scheil?
4. Click the preset **`1045 steel`** (`Fe–0.45C–0.75Mn–0.25Si`).
   - Examine the Fe–C peritectic diagram. Notice that 0.45 wt% C exceeds both the $\delta$-ferrite limit (0.09 wt%) and the peritectic product composition (0.17 wt%).
   - What final phase does equilibrium predict, what single phase does the solver actually grow, and why does SOLIDIFY refuse a simple single-tie-line fraction here?

## Part B: 118-Element Thermodynamic Screening (15 min)

Still inside `alloy composer…`, inspect the 18-column periodic table (**`element screen · this melt`**):

1. With base **`Al aluminum`** selected, tap **`Bi`** (or **`Pb`**) and **`Hg`**. Record each element's classification tier and the exact physical reason/number printed below the grid.
2. Switch the base metal from **`Al aluminum`** to **`Fe iron / steel`**.
   - Observe the vapor-fume underlines shifting across the alkali/alkaline-earth/post-transition elements (e.g., Na, K, Ca, Cd, Zn, Mg).
   - Tap **`Zn`** and **`Mg`** over liquid iron. Record their computed vapor pressures (atm) and explain the real steelmaking practice each number reflects (galvanized scrap fuming; plunging Mg for ductile iron).
   - Tap **`C`** in iron and read the atomic-size note. Why is Hume–Rothery's substitutional 15 % rule replaced by Hägg's interstitial ratio $r/R < 0.59$ here?
3. Switch the base to **`Cu copper`** and tap **`Zn`**. Explain why vapor pressure is printed as an *advisory* rather than a hard refusal (hint: what happens to brass if ideal Raoult's law is used as a refusal?).

## Part C: Controlled Growth-Restriction Experiment (20 min)

1. Select **`A356`** (`Al–7.0Si–0.35Mg`) in `alloy composer…` and click **`pour`**. Open **ANALYZE**, enable **`Scheil overlay`**, switch the lens bar to **XRAY**, click **`seed`**, and press **▶ run** to **30 % solid**. Observe solute rejection between secondary arms and compare the measured interface temperature curve against the dashed analytical Scheil trajectory.
2. Now test growth restriction cleanly: compare **`A356`** ($Q \approx 41\text{ K}$) against **`Al–1.0Zn`** ($Q \approx 1\text{ K}$).
   - First, keep `A356` poured, set `inoculant n_max = 600` (with identical `cooling rate`), click **`reset`** so the new nuclei and bath temperature bake into the melt, and press **▶ run** past **20 % solid**. Record elapsed time and grain count at 20 % solid plus the Guided Labs live `ΔT below T_L` readout.
   - Next, open `alloy composer…`, select **`Al aluminum`**, tap **`Zn`** (`1.0 wt%`), and click **`pour`**.
   - Explain why starting both pours at the same absolute bath temperature $T_0$ is an invalid comparison (`A356` has a much lower liquidus than `Al–1.0Zn`).
   - Adjust `undercooling` so `ΔT below T_L` matches your `A356` run within `±10 K`, click **`reset`** to apply the updated bath temperature to the GPU grid, and press **▶ run** to **20 % solid**. Record elapsed time and grain count at 20 % solid for `Al–1.0Zn`.

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** in the Guided Labs panel to save your Run-Export ZIP (`lab-report.json` + `run.json` + CSVs + `micrograph.png`), and answer the questions below:

1. **Non-equilibrium eutectic:** Using the Gulliver–Scheil equation $C_L = C_0 (1 - f_s)^{k - 1}$, show algebraically why an alloy with $C_0 < C_{\text{SM}}$ (such as AZ91 at 9 wt% Al) still forms eutectic liquid when solid-state back-diffusion is zero.
2. **Model boundaries:** In Part A, A356 shows two different freezing intervals in calibrated mode (`EXTRAPOLATED GAUGE`: 303 K model reference interval vs. 35 K primary freezing range). Explain why the steady-state planar reference liquid $C_\infty / k$ overshoots the eutectic at 7 wt% Si.
3. **Steelmaking & foundry chemistry:** Explain the physical meaning of the vapor pressures you observed for Zn over Fe (59 atm), Mg over Fe (16 atm), and Cu–30Zn (1.4 atm ideal vs. real brass).
4. **Experimental control:** In Part C, what happens to the solidification rate when $Q$ increases from ~1 K to ~41 K? Why must grain counts be compared at matched undercooling below each alloy's liquidus and matched solid fraction rather than at equal bath temperature or equal wall-clock time?
5. **Single-phase caveat:** If a colleague used SOLIDIFY to model the eutectic silicon flake morphology in A356 or pearlitic steel transformations in 1045 steel, what would you tell them based on the composer's two-column phase readout?
