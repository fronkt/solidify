# Lab 1: Mullins–Sekerka Instability, Crystal Symmetry, and Quantitative Calibration

**Estimated time:** 50 minutes  
**Prerequisites:** Basic solidification thermodynamics (undercooling, latent heat, Gibbs–Thomson effect)  
**App link:** [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/)

## Learning Objectives
By the end of this lab, you will be able to:
1. Explain how latent-heat rejection drives the Mullins–Sekerka instability and sets dendritic morphology.
2. Predict how crystal symmetry ($j = 4$ cubic vs. $j = 6$ hexagonal) and anisotropy strength ($\delta \to 0$) govern primary trunk angles and seaweed branching.
3. Distinguish a qualitative similarity phase-field model (Kobayashi) from a thin-interface calibrated model (Karma–Rappel) where physical length and time scales are locked to $d_0$ and $D$.
4. Explain solute trapping and verify how an anti-trapping current restores width-independent partitioning.

---

## Part A: Instability and Crystal Symmetry (15 min)

1. Open [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/). Click the chevron next to **SOLIDIFY** (top left) to open the live readout panel, and click **learn** (top right) if you want inline hints.
2. Press **▶ run** on the default `dendrite` preset. Let solid fraction reach ~15%, then click **❚❚ pause**.
3. Switch across the top lens bar: **MELT** → **FIELD** → **CURV** → **RINGS**.
   - Record what the **FIELD** isotherms show immediately ahead of the four advancing tips compared to the grooves between arms.
   - Record what **CURV** shows at sharp dendrite tips versus concave interdendritic grooves.
4. Click `snow` in **PRESETS** and run to ~15% solid. Switch to **ORIENT**. Why are there six primary arms instead of four, even though the governing PDE is unchanged?
5. Click `seaweed` in **PRESETS** and open the **CRYSTAL** rail section to inspect the anisotropy strength $\delta$. Run to ~20% solid and sketch or capture a screenshot showing how tip splitting replaces straight primary trunks.

## Part B: Qualitative vs. Calibrated Scaling (20 min)

1. Click `dendrite` in **PRESETS**, then open **MATERIAL** and select **Al–4Cu (FCC)**.
2. Open **SCALE** in the right rail and record the three conversion factors (`K / unit`, `s / unit`, `µm / cell`), the domain width, and the **SCALE** dimensionless-group flags (specifically note the Lewis number and capillary ratio status).
3. Open **ENGINE** and toggle **calibrated solver** ON.
4. Return to **SCALE** and record how `µm / cell`, domain width, $d_0$, and $W_0$ changed.
   - Note which parameters in **CRYSTAL** are now locked/derived rather than user-adjustable.
5. Keep the calibrated solver ON and open **ANALYZE**. Turn on the **SDAS ruler**, grow a dendrite to ~25% solid, pause, and drag the ruler across at least 5 consecutive secondary arms. Record the measured secondary dendrite arm spacing $\lambda_2$ in $\mu\text{m}$.
6. Now change the convergence knob **coupling $\lambda$** in **ENGINE** (compare a lower and higher $\lambda$ setting) and reset/grow for the same physical time. Record whether the arm spacing scales physically or drifts.

## Part C: Anti-Trapping & Solute Partitioning (10 min)

1. With **Al–4Cu** still selected, open **ALLOY**, confirm **solute field** is ON, and switch the lens to **XRAY**.
2. Run to ~25% solid and pause. Observe the dark interdendritic channels in **XRAY** (rejected copper).
3. Open **ANALYZE** → enable **Scheil overlay** and click the plot to enlarge it. Inspect how the simulated interface concentration tracks the analytical Scheil curve.

---

## Deliverables & Analysis Questions

Submit a short report (or exported SOLIDIFY Run-Export ZIP + answers below):

1. **Physical mechanism:** Using your observations from **FIELD** and **CURV** in Part A, explain why a bump on a solid–liquid interface grows faster than a flat front, and why it cannot sharpen to zero tip radius.
2. **Symmetry & anisotropy:** Compare the microstructures of `dendrite`, `snow`, and `seaweed`. What single parameter changed between `dendrite` and `seaweed`, and why does $\delta \to 0$ destroy directional locking?
3. **Similarity vs. quantitative modeling:** In Part B, why did **SCALE** mark $d_0 / W$ as undefined in Kobayashi mode, and why did enabling the calibrated solver lock the domain size to ~89 µm (for 1024² Al–4Cu)?
4. **Lewis number mismatch:** Read the **SCALE** warning about the Lewis number $\alpha / D$. Why can a single explicit uniform grid not resolve thermal and solute diffusion simultaneously in a real liquid alloy?
5. **Anti-trapping:** Why does a diffuse phase-field interface without an anti-trapping current overestimate the effective partition coefficient $k_{\text{eff}}$? (Refer to [solidify.frankcai.dev/science/#s-calibrated](https://solidify.frankcai.dev/science/#s-calibrated).)
