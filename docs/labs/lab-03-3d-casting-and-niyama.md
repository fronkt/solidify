# Lab 3: 3D Foundry Casting, Cooling Curves, Step-Block Section Sensitivity, and Niyama Porosity

**Estimated time:** 50 minutes  
**Prerequisites:** Heterogeneous nucleation, thermal analysis cooling curves, solidification shrinkage  
**App link:** [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/)

## Goals
1. Extract solidification landmarks ($T_L$, $T_N$, recalescence $\Delta T_r$, $T_S$) from a casting cooling curve and explain how recalescence halts nucleation.
2. Measure how cooling rate controls final grain density and Hall–Petch yield strength from a fixed inoculant charge.
3. Quantify the casting section-thickness effect using a 3D step-block mold and compare 2D serial-section grain measurements against a true 3D volumetric census (stereology).
4. Contrast shrinkage porosity (feed-path cut-off & Niyama index in steel) with dissolved-hydrogen gas porosity (Sievert's law in aluminum).

---

## Part A: Cooling Curves & the Recalescence Ratchet (15 min)

1. Open [solidify.frankcai.dev/app/](https://solidify.frankcai.dev/app/). Open **MATERIAL** and select **Al–4Cu (FCC)**.
2. In **MODES** (right rail), click **lab mode**.
3. Configure Run 1 (slow cool):
   - `atmosphere`: `argon`
   - `inoculant sites`: `600`
   - `hold before pour`: `0 min`
   - `cooling program`: `furnace`
4. Click **▶ pour and run**. Watch the live cooling curve form until solidification finishes, then click **results** to open the **RUN REPORT**.
5. Record from the report card:
   - Liquidus arrest $T_L$, nucleation nadir $T_N$, recalescence $\Delta T_r$, and deepest undercooling $\Delta T_{\max}$
   - Inoculant sites fired (out of 600)
   - As-cast equivalent grain diameter $\bar{d}$ ($\mu\text{m}$) and Hall–Petch yield strength $\sigma_y$ (MPa)
6. Keep every setting identical except switch `cooling program` to **`quench`**. Click **▶ pour and run** and record the exact same metrics for Run 2.
7. Optional: test refiner fade by setting `hold before pour` to **`45 min`** under `air` cooling and observing how many inoculant sites survive settling before the pour.

## Part B: 3D Step-Block Casting & Stereology (20 min)

1. Exit Lab Mode, then flip the **TRUE 3D · VOLUME** switch (top right) ON.
2. Open **MODES** → **lab mode**. Configure a 3D step-block casting in **Al–4Cu**:
   - `atmosphere`: `air` (to observe dissolved hydrogen & oxide wall sites)
   - `inoculant sites`: `800`
   - `mold walls`: checked ON
   - `mold shape`: **`step`**
   - `cooling program`: **`air`**
3. Click **▶ pour and run**. While it freezes, drag to orbit the 3D volume and switch the top lens bar to **SLICE** to sweep a section plane through the four step thicknesses.
4. When complete, click **results** and record the **per-section table** (section thickness vs. local $\bar{d}$ vs. local $\sigma_y$, thinnest to thickest).
5. Also record the **dissolved hydrogen** Sievert readout (liquid solubility, rejected hydrogen on freezing, and pore bias) and the **Clyne–Davies CSC** hot-tearing timing index.
6. Close Lab Mode, stay in **TRUE 3D** with the **SLICE** lens active, open **VOLUME · 3D** in the rail, and enable **stereology (2D section vs 3D)**. Compare the 2D section-plane apparent grain size against the true 3D volumetric census.

## Part C: Steel Shrinkage & the Niyama Criterion (15 min)

1. In **TRUE 3D**, switch **MATERIAL** to **Steel (Fe–C)**.
2. Open **MODES** → **lab mode**, set `mold walls` ON, `mold shape` to `shell` or `wedge`, `cooling program` to `air`, and click **▶ pour and run**.
3. Once solidified, switch the top lens bar to **FIELD** (X-ray view) to inspect dark unfed shrinkage cavities where the riser feed path pinched off.
4. Switch to **SLICE**, open the floating **SECTION PLANE** panel, and change the cut style to **Niyama**. Sweep the plane through the casting core and inspect where $Ny = |\nabla T| / \sqrt{\dot{T}}$ drops below steel's radiographic threshold ($0.775\text{ K}^{1/2}\text{s}^{1/2}\text{mm}^{-1}$).

---

## Deliverables & Analysis Questions

1. **Recalescence physics:** Using your Run 1 (`furnace`) and Run 2 (`quench`) cooling curves, explain why faster cooling produced more grains even though the inoculant count (`600`) did not change. Why do remaining unfired sites stay dormant after the temperature begins rising?
2. **Step-block geometry:** Plot or tabulate $\bar{d}$ and $\sigma_y$ across the four sections of your 3D step block. No per-section cooling parameter was set in the software; explain physically why the thinnest step froze finest and strongest.
3. **Stereology bias:** Why did the 2D section plane underestimate the true 3D grain diameter? (Hint: a random plane rarely cuts a sphere through its equator.)
4. **Porosity mechanisms:** Contrast how porosity formed in Part B (aluminum poured in humid air) versus Part C (steel evaluated with the Niyama criterion). Why does SOLIDIFY evaluate steel against the $0.775\text{ K}^{1/2}\text{s}^{1/2}\text{mm}^{-1}$ threshold while keeping a relative Niyama map for aluminum?
5. **Thermal-analysis caveats:** Inspect the Newtonian zero-curve solid fraction reported on your Lab Mode card versus the solver's direct solid-fraction census. Name one physical limitation noted on the card (such as the liquid-average "thermocouple" or one-sided baseline).
