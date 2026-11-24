# Lab 8: Binary Eutectic Lamellar Growth and Jackson–Hunt Scaling

**Estimated time:** 50 minutes  
**Prerequisites:** Binary eutectic phase diagrams, lever rule, coupled solute diffusion, Gibbs–Thomson capillary undercooling, Jackson–Hunt lamellar growth theory  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=8](https://solidify.frankcai.dev/app/#lab=8)

> **In-app Guided Labs tracker:** Opening `#lab=8` launches the Guided Labs panel on the left alongside the **`EUTECTIC`** inspector inside the right rail (`Al–33.2 wt% Cu`), using the shared top lens bar (`PHASES`, `SOLUTE`, `ETCH`) and bottom-left transport (`▶ run` / `❚❚ pause`, `reset`, `×2` / `×4`). Every lamellar spacing, undercooling, and phase-fraction check logs into the `DATA` tab and exports via **`export lab ZIP`**, **`export csv`**, or **`print report`**.

## Goals
1. Grow steady alternating $\alpha$-Al and $\theta$-$\text{Al}_2\text{Cu}$ lamellae in the 2D three-phase Folch–Plapp simplex solver ($p_\alpha + p_\beta + p_L = 1$) and compare measured spacing $\lambda$ and front undercooling $\Delta T$ against Jackson–Hunt (1966) theory.
2. Visualize the alternating lateral solute diffusion boundary layer ahead of the $\alpha/\beta/L$ triple junctions using the **`SOLUTE`** lens.
3. Perturb lamellar spacing off the Jackson–Hunt extremum by varying **`seed pairs`** (and `pull speed V`) to map both the constitutional ($K_1 V \lambda$) and capillary ($K_2 / \lambda$) branches of the $\Delta T(\lambda)$ U-curve.
4. Shift liquid **`composition c₀`** off the eutectic point and verify that solid phase fraction $f_\alpha$ obeys the binary lever rule while identifying explicit diffuse-interface and faceting model boundaries.

---

## Part A: Steady Al–Cu Lamellar Growth & Simplex Conservation (15 min)

1. Open [solidify.frankcai.dev/app/#lab=8](https://solidify.frankcai.dev/app/#lab=8). Confirm the right-rail engine tab is **`EUTECTIC`** with `alloy` set to **`Al–33.2 wt% Cu (Al / Al₂Cu)`**, `pull speed V = 20 µm/s`, `composition c₀ = +0.00`, `gradient G = 10 K/mm`, and `seed pairs = 6 pairs`.
2. Let the coupled eutectic front advance in **`PHASES`** past **400 steps** (tip: click **`×2`** or **`×4`** in the bottom-left transport bar to accelerate directional pulling).
3. Observe how the moving directional frame shifts downward as the $\alpha/\beta$ lamellae grow upward into the liquid, preserving 120° isotropic triple-junction angles with zero spurious third-phase intrusion ($p_\alpha + p_\beta + p_L = 1$, simplex error $< 10^{-4}$).
4. Switch briefly to **`ETCH`** (top lens bar) to inspect the metallographic lamellar contrast, then return to **`PHASES`**. Record **`spacing λ`**, **`JH λ_min`**, **`λ²V`**, **`front ΔT`**, and **`phase f_α`** from the right-rail readouts (also captured in the Guided Labs `DATA` tab).

## Part B: Solute Boundary Layer Ahead of Triple Junctions (10 min)

1. Without resetting, switch the top lens bar to **`SOLUTE`** and let the front advance past **600 steps**.
2. Examine the liquid directly ahead of each lamella: $\alpha$-Al ($5.65\text{ wt\% Cu}$) rejects excess copper into the liquid, while $\theta$-$\text{Al}_2\text{Cu}$ ($52.5\text{ wt\% Cu}$) depletes copper from the liquid.
3. Measure qualitatively how far ahead of the front the alternating solute oscillations decay into the uniform bulk liquid (the characteristic decay depth scales as $\sim \lambda / (2\pi)$ in the low-Peclet Jackson–Hunt regime).
4. Explain to yourself why lateral solute exchange between neighboring $\alpha$ and $\beta$ lamellae lets a eutectic freeze much faster than a single-phase planar front at the same undercooling.

## Part C: Jackson–Hunt $\Delta T(\lambda)$ U-Curve & $\lambda^2 V = \text{const}$ (15 min)

1. Click the embedded **Jackson–Hunt $\Delta T(\lambda)$** plot in the right rail to inspect the analytical curve $\Delta T(\lambda) = K_1 V \lambda + K_2 / \lambda$ alongside your live operating point, then close the enlarged figure.
2. **Coarse-spacing branch ($\lambda > \lambda_{\min}$):** drag **`seed pairs`** from `6 pairs` down to **`3 pairs`** or **`4 pairs`** (this resets the seed row at a wider spacing). Run past **400 steps** and observe the live operating point move right and upward onto the solute-diffusion-limited branch ($K_1 V \lambda$). Record `spacing λ`, `front ΔT`, and `λ²V`.
3. **Fine-spacing branch ($\lambda < \lambda_{\min}$):** drag **`seed pairs`** up to **`9 pairs`** or **`10 pairs`**. Run past **400 steps** and observe the operating point climb the curvature-limited branch ($K_2 / \lambda$), noting whether very fine lamellae begin pinching off (lamellar termination) to relax spacing back toward $\lambda_{\min}$. Record `spacing λ` and `front ΔT`.
4. **Pull-speed scaling check (optional exploration):** return `seed pairs` to **`6 pairs`** and increase **`pull speed V`** from `20 µm/s` to **`80 µm/s`**. Confirm that analytical **`JH λ_min`** drops by a factor of $\sqrt{4} = 2$ (from $2.10\ \mu\text{m}$ to $1.05\ \mu\text{m}$) while $\lambda_{\min}^2 V = K_2 / K_1 \approx 88.5\ \mu\text{m}^3/\text{s}$ remains constant.
5. **Model honesty check:** switch `alloy` briefly to **`Al–12.6 wt% Si (Al / Si)`** and read the on-screen warning line explaining why real Al–Si forms an irregular faceted flake eutectic rather than regular Jackson–Hunt lamellae, then switch back to **`Al–33.2 wt% Cu (Al / Al₂Cu)`** for Part D.

## Part D: Off-Eutectic Composition & the Lever Rule (10 min)

1. Confirm `alloy` is **`Al–33.2 wt% Cu (Al / Al₂Cu)`**, `pull speed V = 20 µm/s`, and `seed pairs = 6 pairs`.
2. Shift **`composition c₀`** off the eutectic by at least **`0.10`** in magnitude (for example, **`−0.15`** on the Al-rich hypoeutectic side or **`+0.15`** on the Cu-rich hypereutectic side) and press **`reset`** in transport if needed so the shifted melt enters cleanly.
3. Run past **300 steps** in **`PHASES`** and watch the lamella widths adjust asymmetrically to conserve global solute mass.
4. Record `composition c₀`, live **`phase f_α`**, and the printed analytical **lever fraction** (`f_α` should shift by at least `0.04` away from `0.50` as the richer phase widens). Optionally click **`export csv`** inside `EUTECTIC` to save the spacing and undercooling summary.

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** or **`print report`** in the Guided Labs panel to save your recorded dataset, and answer the questions below:

1. **Jackson–Hunt extremum derivation:** Starting from $\Delta T(\lambda) = K_1 V \lambda + K_2 / \lambda$, differentiate with respect to $\lambda$ to derive $\lambda_{\min}^2 V = K_2 / K_1$ and $\Delta T_{\min} = 2\sqrt{K_1 K_2 V}$. Using SOLIDIFY's Al–33.2 wt% Cu constants ($K_1 = 0.00417\text{ K}\cdot\text{s}/\mu\text{m}^2$, $K_2 = 0.369\text{ K}\cdot\mu\text{m}$), calculate $\lambda_{\min}$, $\Delta T_{\min}$, and $\lambda_{\min}^2 V$ at $V = 20\ \mu\text{m/s}$ and $V = 80\ \mu\text{m/s}$, and compare against your recorded **`JH λ_min`** and **`front ΔT`**.
2. **Physical meaning of both U-curve branches:** Using your **`SOLUTE`** lens observation (Part B) and your **`seed pairs`** sweep (Part C), explain physically why front undercooling rises both when lamellae are too wide ($\lambda > \lambda_{\min}$) and when they are too narrow ($\lambda < \lambda_{\min}$).
3. **Off-eutectic lever rule:** For Al–Cu ($c_\alpha = 5.65\text{ wt\% Cu}$, $c_E = 33.2\text{ wt\% Cu}$, $c_\beta = 52.5\text{ wt\% Cu}$), compute the equilibrium lever-rule fraction $f_\alpha = (c_\beta - c_0)/(c_\beta - c_\alpha)$ at $c_0 = c_E$ and at your shifted Part D composition $c_0 = c_E + \delta c_0 \cdot \frac{1}{2}(c_\beta - c_\alpha)$. How closely did the 2D Folch–Plapp phase fraction track the lever rule?
4. **Model boundaries:** What two simplifications distinguish SOLIDIFY's interactive 2D Folch–Plapp solver from a real industrial eutectic casting, and why does real Al–12.6 wt% Si operate at a spacing $2\text{–}3\times$ wider than the regular Jackson–Hunt minimum?
