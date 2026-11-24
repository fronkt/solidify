# Lab 7: Inverse Process Design and Multi-Parameter Casting Optimization

**Estimated time:** 40 minutes  
**Prerequisites:** Heterogeneous nucleation, ASTM E112 grain number $G$, black-box derivative-free optimization (CMA-ES), proxy-to-full-scale transfer  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=7](https://solidify.frankcai.dev/app/#lab=7)

> **In-app Guided Labs tracker:** Opening `#lab=7` stages a 2D `aluminum · Al–Cu` `rain` setup and launches the Guided Labs panel alongside `challenge`, 2D `optimizer`, and 3D `optimizer`. Every verdict, converged recipe, full-grid replay check, and 3D search logs into the `DATA` tab and exports via **`export lab ZIP`** or **`print report`**.

## Goals
1. Experience why nonlinear coupling between cooling rate, inoculant count, and recalescence makes manual trial-and-error targeting of ASTM grain number $G$ difficult.
2. Run a 5-parameter separable CMA-ES inverse search in 2D to discover a casting schedule meeting a target ASTM $G$.
3. Audit scale transfer by replaying a `256²` proxy-optimized recipe on the full `1024²` grid and measuring the live verification residual $|\Delta G|$.
4. Contrast proxy-grid 2D optimization against current-grid 3D volumetric diameter optimization ($\bar{d}$ in $\mu\text{m}$).

---

## Part A: Human vs. CMA-ES Challenge (2D) (10 min)

1. Open [solidify.frankcai.dev/app/#lab=7](https://solidify.frankcai.dev/app/#lab=7) (`aluminum · Al–Cu`, 2D mode).
2. Expand **MODES** in the right rail and click **`challenge`**.
3. Read the assigned target ASTM grain number $G$ and click **`▶ start`**.
4. During your single casting round, steer **`cooling rate`** and **`inoculant n_max`** in **MELT · PROCESS** to hit the target $G$ before the simulation-time limit expires.
5. Watch the CMA-ES optimizer execute 10 castings on the same `256²` grid and target. Record target $G$, your measured $G$ and $|\Delta G|$, the optimizer's best $G$ and $|\Delta G|$, and the verdict, then click **`close`** in `CHALLENGE`.

## Part B: 2D CMA-ES Schedule Optimization & Full-Grid Verification (15 min)

1. Still in 2D mode, open **MODES** -> **`optimizer`**.
2. Choose a target ASTM grain number $G$ on the panel slider and press **▶ run** in the bottom-left transport bar to start CMA-ES episodes on the `256²` proxy grid.
3. Watch the etched thumbnail strip and convergence plot until `OPTIMIZER` completes at least 12 castings and reports a best recipe (`undercooling`, `inoculant n_max`, and 3-stage `cooling rate`). Record target $G$, best search $G$, $|\Delta G|$, and episode count.
4. Click **`apply recipe`** inside `OPTIMIZER` to arm the converged 5-parameter schedule on the full-resolution `1024²` grid.
5. Press **▶ run** to solidify the full-grid casting past **85 % solid**. Compare the live full-grid ASTM $G$ (shown in the head plate and Guided Labs `DATA` tab) against the `256²` search result.

## Part C: Current-Grid 3D Volume Optimization (15 min)

1. Switch **`TRUE 3D`** ON (top right).
2. Confirm **MATERIAL** is **`aluminum · Al–Cu`** and `calibrated solver` is OFF in **SCALE** (the 3D optimizer runs under the qualitative Kobayashi model). In **ENGINE**, choose **`96³`** for faster episode turnaround (or `128³` on a fast GPU).
3. Open **MODES** -> **`optimizer`**. Set a target equivalent grain diameter $\bar{d}$ ($\mu\text{m}$), set the casting budget to **`4`** or **`8`** episodes, and press **▶ run** in transport (tip: use **`×2`** or **`×4`** to accelerate each 3D episode).
4. Notice that rail process controls lock during the search so every episode runs under an identical deterministic context. Wait until the 3D search finishes and record grid size, target $\bar{d}$, best achieved $\bar{d}$, valid episodes, and relative error (%).

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** or **`print report`** in the Guided Labs panel to save your optimization scorecard, and answer the questions below:

1. **Coupled process variables:** In Part A, why does doubling `inoculant n_max` alone not double the number of active grains if `cooling rate` is slow? Explain in terms of the recalescence ratchet.
2. **Why CMA-ES:** What five parameters compose the 2D optimizer's search genome, and why is a derivative-free evolutionary strategy (separable CMA-ES) suited to a stochastic, discrete-nucleation phase-field simulation where analytical gradients $\partial G / \partial \theta$ do not exist?
3. **Scale-transfer audit:** Compare your `256²` search $G$ from Part B against your live `1024²` verification $G$. List two physical or numerical reasons why a schedule tuned on a `256²` proxy grid can shift slightly when replayed on a `1024²` domain.
4. **2D proxy vs. 3D current-grid design:** Compare the computational cost and modeling fidelity of 2D proxy optimization (Part B) versus 3D current-grid optimization (Part C). Why does the 3D optimizer lock rail parameters during search and require the qualitative Kobayashi solver instead of calibrated thin-interface mode?
