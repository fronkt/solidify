# Lab 6: Directional Solidification, Melt Convection, and 3D Grain Selection

**Estimated time:** 40 minutes  
**Prerequisites:** Directional solidification ($G$ and $V$), constitutional/thermal boundary layers, convective heat transport, crystal texture and pole figures  
**Direct launch (in-app Guided Lab):** [solidify.frankcai.dev/app/#lab=6](https://solidify.frankcai.dev/app/#lab=6)

> **In-app Guided Labs tracker:** Opening `#lab=6` stages a 2D `nickel · superalloy` `bridgman` setup and launches the Guided Labs panel alongside `SCENARIO`, `VOLUME · 3D`, and `SECTION PLANE`. Every $G/V$ pass, LBM flow contrast, and 3D selector texture check records into the `DATA` tab and exports via **`export lab ZIP`** or **`print report`**.

## Goals
1. Contrast how the directional solidification ratio $G/V$ and local cooling rate $G \cdot V$ reshape columnar competition and dendrite branching in a Bridgman furnace.
2. Observe how forced 2D melt flow breaks dendritic symmetry by thinning the upstream boundary layer and sweeping latent heat into the downstream wake, while identifying the solver's qualitative caveats.
3. Stage competitive columnar growth in a 3D helical pigtail grain selector and evaluate crystallographic alignment using stereographic `[001]` pole figures and serial section planes.

---

## Part A: Bridgman Gradient $G$ vs. Pull Speed $V$ (15 min)

1. Open [solidify.frankcai.dev/app/#lab=6](https://solidify.frankcai.dev/app/#lab=6). Confirm **MATERIAL** is **`nickel · superalloy`** and **SCENARIO** is **`bridgman`** in 2D mode.
2. **High-$G/V$ pass:** in **SCENARIO**, set `gradient` **`≥ 0.12`** and `pull speed` **`≤ 1.5`**. Press **▶ run** until solid fraction passes **25 %**, then pause. Inspect **ORIENT** and **MELT** and record $G$, $V$, $G/V$, cooling product $G \cdot V$, and grain count.
3. Click **`reset`** and **`chill wall`** in **MELT · PROCESS** to stage a fresh columnar floor.
4. **Low-$G/V$ pass:** set `gradient` **`≤ 0.10`** and `pull speed` **`≥ 3.5`**, then press **▶ run** past **25 % solid**. Compare front thickness, secondary side-branching, and columnar survival against your high-$G/V$ run.

## Part B: Qualitative 2D Melt Flow & Upstream/Downstream Asymmetry (10 min)

1. Stay in 2D mode (grid `1024²` or `512²` in **ENGINE**; `calibrated solver` OFF). Click **`dendrite`** in **PRESETS** to stage a fresh free-growth melt (`SCENARIO` switches to `free`).
2. **Still-melt baseline:** confirm `melt flow` in **SCENARIO** is OFF and press **▶ run** past **10 % solid**. Inspect the symmetry between the left (upstream) and right (downstream) primary arms in **MELT** and **FIELD**, and record solid fraction and simulation time.
3. Click **`dendrite`** in **PRESETS** again for a fresh starting seed.
4. **Forced-flow run:** in **SCENARIO**, switch **`melt flow`** ON, set `flow speed` **`≥ 0.02`** (cells per substep), and enable **`show flow`** to overlay the velocity streaks. Press **▶ run** past **10 % solid**.
5. Compare the windward (left-pointing) arm, leeward (right-pointing) arm, and thermal plume in **FIELD** against your still baseline. Note the explicit model limit: SOLIDIFY's 2D D2Q9 lattice Boltzmann flow is qualitative (forced Zou–He inlet with Beckermann diffuse drag; no buoyancy or 3D convection).

## Part C: 3D Helical Pigtail Grain Selector & `[001]` Pole Figure (15 min)

1. Switch **`TRUE 3D`** ON (top right).
2. Click **`selector`** in **PRESETS** (this stages a helical pigtail mold with 64 chill-floor grains under directional pull). Press **▶ run** (tip: click **`×2`** or **`×4`** in transport to accelerate growth) until solid fraction passes **12 %**.
3. Orbit the 3D volume in **ORIENT** as favorably aligned columns outgrow misaligned neighbors entering the helical spiral. Note honestly that the preset demonstrates competitive channel geometry without guaranteeing that exactly one grain exits the top on every run.
4. Let the selector pass **15 % solid**, expand **VOLUME · 3D** in the right rail, and enable **`pole figure [001]`**.
5. Switch the top lens bar to **`SLICE`**, then drag **`depth`** inside **`SECTION PLANE`** (or enable `CT sweep`) from the chill starter block upward through the pigtail. Watch how the `[001]` stereographic pole cluster tightens around the vertical pull axis as fewer grains survive higher up the helix.

---

## Deliverables & Analysis Questions

Click **`export lab ZIP`** or **`print report`** in the Guided Labs panel to save your recorded dataset, and answer the questions below:

1. **Morphology & scale ($G/V$ vs. $G \cdot V$):** In directional solidification theory, $G/V$ controls interface morphology (planar -> cellular -> dendritic) while $G \cdot V$ sets the cooling rate and microstructure fineness. How did your two Part A runs illustrate both roles?
2. **Convective asymmetry:** Explain physically why left-to-right forced flow accelerated the upstream dendrite arm and stunted the downstream arm in Part B. What role does Beckermann diffuse drag play at the solid–liquid interface ($\phi = 0.5$)?
3. **Model honesty (flow):** Why does SOLIDIFY mark its 2D LBM `melt flow` as qualitative rather than a quantitative match to Tong et al. (2001), and what real foundry convection mechanism is omitted?
4. **Turbine-blade grain selection:** Explain geometrically why a helical pigtail narrows a 64-grain starter block toward a small set of `[001]`-aligned orientations, and explain how the stereographic **`pole figure [001]`** encodes both orientation tilt (radial distance from center) and grain diameter (dot size).
