# Lab 2: Alloy Chemistry, Growth Restriction, Phase Diagrams, and Scheil Segregation

**Estimated time:** 50 minutes  
**Prerequisites:** Binary phase diagrams (eutectic & peritectic reactions, lever rule, Gulliver–Scheil equation)  
**App link:** [solidify.frankcai.dev/app/#alloy=al:Si7,Mg0.35](https://solidify.frankcai.dev/app/#alloy=al:Si7,Mg0.35)

## Learning Objectives
By the end of this lab, you will be able to:
1. Compute dilute-limit liquidus depression ($\Delta T_L$) and the Easton–StJohn growth restriction factor ($Q$) for multicomponent alloys.
2. Distinguish between equilibrium solidification (lever rule) and non-equilibrium dendritic freezing (Gulliver–Scheil) both above and below the solid solubility limit $C_{\text{SM}}$.
3. Identify thermodynamic and physical reasons why candidate elements fail to form pourable dilute alloys (vapor boiling/fuming, immiscibility, interstitial size criteria).
4. Design a controlled simulation experiment that avoids confounding bath temperature and solid fraction.

---

## Part A: Multicomponent Alloy Composition & Phase-Diagram Reading (15 min)

1. Open SOLIDIFY at [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/), expand **ALLOY**, and click **alloy composer…**.
2. Click the preset **A356** (`Al–7.0Si–0.35Mg`). Record:
   - Liquidus depression $\Delta T_L$ (K) and growth restriction factor $Q$ (K)
   - Dominant binary drawn on the phase diagram, maximum solid solubility $C_{\text{SM}}$, and eutectic composition/temperature
   - **Equilibrium leaves** vs. **Solver grows**
   - Reported **Lever** vs. **Gulliver–Scheil** eutectic fraction (%)
3. Click the preset **AZ91** (`Mg–9.0Al–0.7Zn`).
   - Notice that 9.0 wt% Al is **below** Mg–Al's equilibrium solid solubility limit (12.9 wt%).
   - Why does SOLIDIFY still report **11.9 %** eutectic $\beta\text{-Mg}_{17}\text{Al}_{12}$ under Gulliver–Scheil?
4. Click the preset **1045 steel** (`Fe–0.45C–0.75Mn–0.25Si`).
   - Examine the Fe–C peritectic diagram. Notice that 0.45 wt% C exceeds both the $\delta$-ferrite limit (0.09 wt%) and the peritectic product composition (0.17 wt%).
   - What final phase does equilibrium predict, what single phase does the solver actually grow, and why does SOLIDIFY refuse a simple single-tie-line fraction here?

## Part B: 118-Element Thermodynamic Screening (15 min)

Still inside the **Alloy Composer**, inspect the 18-column periodic table (**ELEMENT SCREEN · THIS MELT**):

1. With base **Al (aluminum)** selected, tap **Hg (mercury)** and **Bi (bismuth)**. Record each element's classification tier and the exact physical reason/number printed below the grid.
2. Switch the base metal from **Al (aluminum)** to **Fe (iron / steel)**.
   - Observe the vapor-fume underlines shifting across the alkali/alkaline-earth/post-transition elements (e.g., Na, K, Ca, Cd, Zn, Mg).
   - Tap **Zn (zinc)** and **Mg (magnesium)** over liquid iron. Record their computed vapor pressures (atm) and explain the real steelmaking practice each number reflects (galvanized scrap fuming; plunging Mg for ductile iron).
   - Tap **C (carbon)** in iron and read the atomic-size note. Why is Hume–Rothery's substitutional 15% rule replaced by Hägg's interstitial ratio $r/R < 0.59$ here?
3. Switch the base to **Cu (copper)** and tap **Zn**. Explain why vapor pressure is printed as an *advisory* rather than a hard refusal (hint: what happens to brass if ideal Raoult's law is used as a refusal?).

## Part C: Controlled Growth-Restriction Experiment (20 min)

1. Pour **A356** (`Al–7Si–0.35Mg`) from the composer. Open **ANALYZE**, enable **Scheil overlay**, switch lens to **XRAY**, and run to ~50% solid. Observe solute rejection between secondary arms and compare the measured interface temperature curve against the dashed analytical Scheil trajectory.
2. Now test growth restriction cleanly: compare **A356** ($Q \approx 41\text{ K}$) against **Al–1Zn** ($Q \approx 1\text{ K}$).
   - Before running, record each alloy's liquidus temperature (or normalized liquidus).
   - Explain why starting both pours at the same absolute bath temperature $T_0$ is an invalid comparison.
   - Start each alloy at the **same undercooling below its own liquidus** with identical cooling rate and `inoculant n_max = 600`. Record the elapsed time to reach **20% solid** and the grain count at **20% solid** for both alloys.

---

## Deliverables & Analysis Questions

1. **Non-equilibrium eutectic:** Using the Gulliver–Scheil equation $C_L = C_0 (1 - f_s)^{k - 1}$, show algebraically why an alloy with $C_0 < C_{\text{SM}}$ (such as AZ91 at 9 wt% Al) still forms eutectic liquid when solid-state back-diffusion is zero.
2. **Model boundaries:** In Part A, A356 shows two different freezing intervals in calibrated mode (`EXTRAPOLATED GAUGE`: 303 K model reference interval vs. 35 K primary freezing range). Explain why the steady-state planar reference liquid $C_\infty / k$ overshoots the eutectic at 7 wt% Si.
3. **Steelmaking & foundry chemistry:** Explain the physical meaning of the vapor pressures you observed for Zn over Fe (59 atm), Mg over Fe (16 atm), and Cu–30Zn (1.4 atm ideal vs. real brass).
4. **Experimental control:** In Part C, what happens to the solidification rate when $Q$ increases from ~1 K to ~41 K? Why must grain counts be compared at matched undercooling and matched solid fraction rather than at equal wall-clock time?
5. **Single-phase caveat:** If a colleague used SOLIDIFY to model the eutectic silicon flake morphology in A356 or pearlitic steel transformations in 1045 steel, what would you tell them based on the composer's two-column phase readout?
