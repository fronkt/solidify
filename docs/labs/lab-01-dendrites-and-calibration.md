# Lab 1: Dendrites, Symmetry, and Quantitative Calibration

**Estimated time:** 35–50 minutes  
**Prerequisites:** Basic solidification thermodynamics (undercooling, latent heat, Gibbs–Thomson effect)  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=1](https://solidify.frankcai.dev/app/#lab=1)

> **In-app Guided Labs tracker:** Opening `#lab=1` launches the live Guided Labs panel beside the canvas. Each milestone auto-verifies against the running GPU solver, captures paired readings in the `DATA` tab, and attaches `lab-report.json` when you click **`export lab ZIP`**.

## Goals
1. Explain how latent-heat rejection drives the Mullins–Sekerka instability and sets dendrite shape.
2. Predict how crystal symmetry ($j = 4$ cubic vs. $j = 6$ hexagonal) and anisotropy strength ($\delta \to 0$) govern primary trunk angles and seaweed branching.
3. Distinguish a qualitative similarity phase-field model (Kobayashi) from a thin-interface calibrated model (Karma–Rappel) where physical length and time scales are locked to $d_0$ and $D$.
4. Verify interface-width convergence via `coupling λ` and inspect solute partitioning under the anti-trapping current.

---

## Part A: Instability and Crystal Symmetry (15 min)

1. Open [solidify.frankcai.dev/app/#lab=1](https://solidify.frankcai.dev/app/#lab=1). Click the chevron next to **SOLIDIFY** (top left) to view the live readout panel, and toggle **learn** (top right) if you want inline hints.
2. Let the 4-fold `dendrite` preset grow past **12 % solid** (press **▶ run** if paused), then switch across the top lens bar to inspect **FIELD** and **CURV** (plus **RINGS**).
   - Record what the **FIELD** isotherms show immediately ahead of the four advancing tips compared to the grooves between arms.
   - Record what **CURV** shows at sharp dendrite tips versus concave interdendritic grooves.
3. Click `snow` in **PRESETS** and run past **10 % solid**. Switch to **ORIENT**. Why are there six primary arms instead of four, even though the governing PDE is unchanged?
4. Click `seaweed` in **PRESETS** and open **CRYSTAL** in the right rail to inspect `anisotropy δ`. Run past **12 % solid** and note how tip splitting replaces straight primary trunks.

## Part B: Qualitative vs. Calibrated Scaling (20 min)

1. Click `dendrite` in **PRESETS** first, then open **MATERIAL** and select **`aluminum · Al–Cu`** (this restores the alloy solute field for Al–4Cu calibration).
2. Open **SCALE** in the right rail and record the three conversion factors (`K / unit`, `s / unit`, `µm / cell`), the domain width, and the dimensionless-group flags (specifically the Lewis number and capillary ratio `d_0 / W`).
3. Still in **SCALE**, switch **`calibrated solver`** ON.
4. Record how `µm / cell`, domain width, $d_0$, and $W_0$ changed, and note which parameters in **CRYSTAL** are now derived rather than user-adjustable.
5. Toggling `calibrated solver` ON resets to an unseeded liquid: dial `undercooling` near `0.65`, click **`seed`** (or tap the canvas), and press **▶ run**. Once solid fraction passes **20 %**, pause, open **ANALYZE**, enable **`SDAS ruler`**, and drag across at least 3 consecutive secondary arms (5+ where visible). Record $\lambda_2$ in $\mu\text{m}$.
6. Shift **`coupling λ`** in **SCALE** by at least `8` (staying within `18–40`, e.g., `30` to `22` or `38`), click **`seed`**, press **▶ run** past 18 % solid, and re-measure $\lambda_2$ with **`SDAS ruler`**. Record whether the physical arm spacing stays steady or drifts.

## Part C: Anti-Trapping & Solute Partitioning (10 min)

1. With calibrated **`aluminum · Al–Cu`** still active (`solute field` ON in **ALLOY**), switch the top lens bar to **XRAY**.
2. Open **ANALYZE**, enable **`Scheil overlay`**, and grow past **20 % solid** (click **`seed`** and **▶ run** if you reset).
3. Observe the dark interdendritic channels in **XRAY** (rejected copper) and click the Scheil plot to enlarge it. Inspect how the simulated interface temperature tracks the dashed analytical Scheil trajectory.

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** in the Guided Labs panel to save your Run-Export ZIP (including `lab-report.json`, `run.json`, CSVs, and `micrograph.png`), and answer the questions below:

1. **Physical mechanism:** Using your observations from **FIELD** and **CURV** in Part A, explain why a bump on a solid–liquid interface grows faster than a flat front, and why it cannot sharpen to zero tip radius.
2. **Symmetry & anisotropy:** Compare the microstructures of `dendrite`, `snow`, and `seaweed`. What single parameter changed between `dendrite` and `seaweed`, and why does $\delta \to 0$ destroy directional locking?
3. **Similarity vs. quantitative modeling:** In Part B, why did **SCALE** mark $d_0 / W$ as not defined in Kobayashi mode, and why did enabling `calibrated solver` lock the domain size to ~89 µm (for 1024² Al–4Cu)?
4. **Lewis number mismatch:** Read the **SCALE** warning about the Lewis number $\alpha / D$. Why can a single explicit uniform grid not resolve thermal and solute diffusion simultaneously in a real liquid alloy?
5. **Anti-trapping:** Why does a diffuse phase-field interface without an anti-trapping current overestimate the effective partition coefficient $k_{\text{eff}}$? (Refer to [solidify.frankcai.dev/science/#s-calibrated](https://solidify.frankcai.dev/science/#s-calibrated).)
