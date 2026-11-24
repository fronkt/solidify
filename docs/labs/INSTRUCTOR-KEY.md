# Instructor Solution Key & Grading Rubric: SOLIDIFY Classroom Lab Pack

This guide summarizes expected observations, reference numerical outputs (v8 calibrated builds), and common student misconceptions for Labs 1–7.

---

## Lab 1: Dendrites, Symmetry & Calibration

- **Part A (Instability & Symmetry):**
  - *FIELD lens:* Isotherms crowd tightly ahead of advancing dendrite tips (steep thermal gradient $\implies$ rapid heat rejection) and spread out inside concave interdendritic grooves (trapped latent heat slows groove advance).
  - *CURV lens:* Positive high curvature at tips lowers the local equilibrium temperature via Gibbs–Thomson ($\Delta T_r = \Gamma \kappa$), preventing infinite tip sharpening and selecting a finite tip radius.
  - *Snow vs. Seaweed:* `snow` changes symmetry index $j$ from 4 to 6 in $\varepsilon(\theta) = \bar{\varepsilon}(1 + \delta \cos j(\theta - \theta_0))$. `seaweed` reduces anisotropy strength $\delta \to 0$ (e.g., $\sim 0.002$), removing preferred growth axes so tips repeatedly split isotropically.
- **Part B (Calibration):**
  - *Kobayashi mode:* `d_0 / W` is reported as **not defined** because Kobayashi has no calibrated interfacial energy linking grid width to physical capillary length; domain size equals $n \times (\mu\text{m/cell})$ as declared by the user.
  - *Calibrated Al–4Cu:* Karma–Rappel thin-interface relations ($d_0 = a_1 W_0 / \lambda$, $\tau_0 = a_2 \lambda W_0^2 / D$) lock $d_0 \approx 3.2\text{ nm}$, $W_0 \approx 109\text{ nm}$, cell pitch $\approx 0.087\ \mu\text{m}$, and a $1024^2$ domain to $\approx 89\ \mu\text{m}$. Anisotropy $\delta$ and timing become derived rather than free dials.
  - *Lewis number mismatch:* Liquid alloys have $Le = \alpha / D \sim 10^4$. On an explicit uniform grid, stepping stably on thermal diffusion would require $10^4\times$ more substeps per solute diffusion time. SOLIDIFY anchors 2D alloy time on solute diffusion and flags $Le$ explicitly in `SCALE`.
- **Part C (Anti-Trapping):**
  - With zero solid diffusivity, an artificially thick diffuse interface traps solute atoms inside the advancing solid, producing an inflated apparent $k_{\text{eff}}$ (+24% to +40% high in SOLIDIFY's 2D benchmark) that worsens with wider $W_0/d_0$. The Karma–Echebarria anti-trapping current cancels that spurious flux, holding $k_{\text{eff}} \in [0.135, 0.150]$ against true $k = 0.15$.

---

## Lab 2: Alloy Chemistry & Scheil Segregation

- **Part A (Phase Diagrams & Scheil):**
  - *A356 (`Al–7.0Si–0.35Mg`):* Dominant binary Al–Si ($C_{\text{SM}} = 1.65\text{ wt\%}$, eutectic $12.6\text{ wt\%}$ at $577\ ^\circ\text{C}$). Equilibrium leaves `(Al) + (Si)`, solver grows `(Al)` only. Lever eutectic $\approx 49\%$, Scheil eutectic $\approx 51\%$. In calibrated mode, A356 shows `EXTRAPOLATED GAUGE` ($303\text{ K}$ planar reference interval vs. $35\text{ K}$ primary freezing range, factor $8.7\times$) because the planar steady-state reference liquid $C_\infty / k \approx 53\text{ wt\% Si}$ lies far past the $12.6\text{ wt\%}$ eutectic.
  - *AZ91 (`Mg–9.0Al–0.7Zn`):* Although $9.0 < 12.9\text{ wt\%}$ ($C_{\text{SM}}$), zero solid back-diffusion causes the remaining interdendritic liquid to enrich along $C_L = C_0 (1 - f_s)^{k-1}$ until it hits the $32.3\text{ wt\%}$ eutectic at $f_L = (C_0 / C_{\text{eut}})^{1/(1-k)} \approx 11.9\%$, forming as-cast $\beta\text{-Mg}_{17}\text{Al}_{12}$.
  - *1045 Steel (`Fe–0.45C–...`):* $0.45\text{ wt\% C}$ exceeds both $\delta$-ferrite solubility ($0.09\text{ wt\%}$) and peritectic product $\gamma$ ($0.17\text{ wt\%}$), so equilibrium ends as $\gamma$-austenite while the single-phase solver grows $\delta$-ferrite. A single tie-line fraction is refused because peritectic freezing consumes only part of the remaining liquid at $T_p = 1495\ ^\circ\text{C}$, with the balance freezing below $T_p$ on the austenite solidus.
- **Part B (118-Element Screen):**
  - *Hg in Al:* Refused (unassessed pair) with boiling vapor advisory (~39 atm over liquid Al). *Bi in Al:* Refused as a checked monotectic immiscibility gap (`al-Bi`).
  - *Zn & Mg over Fe:* ~59 atm (Zn) and ~16 atm (Mg) at Fe $T_m = 1538\ ^\circ\text{C}$, explaining ZnO baghouse fuming from galvanized scrap in EAFs and why Mg nodularization of ductile iron requires plunging/covered ladles.
  - *C in Fe:* Hume–Rothery substitutional size difference gives $-39.6\%$ (wrong test for an interstitial). Hägg's interstitial ratio $r/R = 0.604$ sits just past the $0.59$ simple-interstitial limit, matching why $\text{Fe}_3\text{C}$ forms a complex orthorhombic carbide.
  - *Cu–30Zn:* Ideal Raoult's law predicts $1.4\text{ atm}$, yet brass is routinely cast because Zn has strong negative activity deviation in Cu, illustrating why vapor pressure must advise rather than hard-refuse.
- **Part C (Controlled $Q$ Comparison):**
  - Higher $Q$ slows solidification (A356 takes ~2x longer than Al-1Zn to reach 20% solid at matched undercooling). Comparing at equal bath temperature confounds the liquidus shift ($0.821$ vs. $0.993$), and comparing at equal elapsed time confounds solid fraction.

---

## Lab 3: 3D Foundry Casting, Cooling Curves & Porosity

- **Part A (Recalescence Ratchet):**
  - Faster cooling (`quench` vs `furnace`) extracts heat faster than early nuclei can release latent heat, driving $\Delta T_{\max}$ deeper before recalescence occurs. Because sites activate permanently whenever $\Delta T$ hits a new maximum, `quench` fires significantly more of the 600 sites, yielding finer $\bar{d}$ and higher $\sigma_y$. Once latent heat raises $T$ (recalescence), $\Delta T < \Delta T_{\max}$, so nucleation halts immediately.
  - Holding 45 min before pour reduces active site count via empirical refiner-settling fade ($\text{TiB}_2/\text{Al}_3\text{Ti}$ agglomeration/settling).
- **Part B (Step Block & Stereology):**
  - Thinnest step has the largest wall-area-to-volume ratio $\implies$ steepest heat extraction toward cold mold walls $\implies$ finest $\bar{d}$ and highest $\sigma_y$; thickest step cools slowest and freezes coarsest.
  - *Stereology:* A 2D random slice intersects 3D grains off-equator on average, systematically underestimating true 3D equivalent sphere diameter ($\bar{d}_{\text{2D}} < \bar{d}_{\text{3D}}$).
  - *Al H₂ gas porosity:* Liquid Al dissolves ~19× more hydrogen than solid Al (Ransley–Neufeld: $0.69$ vs $0.036\text{ cm}^3/100\text{ g}$ at 1 atm), rejecting gas across the freezing front via Sievert's $\sqrt{p}$ law.
- **Part C (Steel Niyama & Shrinkage):**
  - Shrinkage cavities appear in last-to-freeze pockets isolated from the top riser by solid bridging (feed-path cut-off). Low local Niyama ($Ny < 0.775\text{ K}^{1/2}\text{s}^{1/2}\text{mm}^{-1}$ in steel) concentrates at the thermal centerline / hot spots. The threshold is steel-specific radiography; aluminum porosity is dominated by hydrogen gas rather than Niyama shrinkage, so non-steel metals show relative Niyama maps only.

---

## Lab 4: Heat Treatment & Hall–Petch Design

- **Part A (Two Clocks & Arrhenius Coarsening):**
  - $4\text{ h} = 1.44 \times 10^4\text{ s}$; at $\Delta t \sim 10^{-7}\text{ s}$, direct phase-field integration would require $\sim 1.4 \times 10^{11}$ timesteps.
  - At `200 °C` (4 h), Arrhenius integrals are negligible (stress-relief regime, near-zero coarsening). At `520 °C` (12 h), grains coarsen (roughly 3x from fine as-cast sizes, $\sigma_y$ drops), solute homogenizes, and the Al passive oxide stays ~2 nm thick.
  - Thermal lenses are parked during heat treatment because the stored temperature array $T$ is the as-cast solidification record, not the isothermal furnace temperature.
- **Part B (Zener Pinning):**
  - Particle dispersions pin grain boundaries at $d_{\lim} = 7.24 \cdot r^{0.205} / f^{0.356}$ cells in 2D, preserving fine $\bar{d}$ and significantly higher Hall–Petch $\sigma_y$ after a 12 h soak. Smaller particle radius $r$ and higher area fraction $f$ tighten the pinning limit.
- **Part C (SFE & Annealing Twins):**
  - Copper (SFE $78\text{ mJ/m}^2$) readily nucleates and retains coherent $\Sigma 3$ twins (protected by low coherent boundary energy and mobility gate). Aluminum ($166\text{ mJ/m}^2$) has too high an SFE; steel is modeled as BCC $\delta$-ferrite, whereas annealing twins are an FCC austenite phenomenon.
- **Part D (Hall–Petch Spec & Aging Limit):**
  - Pure grain-growth annealing only increases $\bar{d}$, which lowers $\sigma_y = \sigma_0 + k_{\text{HP}}/\sqrt{\bar{d}}$. Meeting a higher strength spec requires a finer as-cast pour (more inoculant / faster quench) plus pinning or a milder anneal. Real heat-treatable Al alloys (A356-T6, 6061-T6) gain strength through **precipitation hardening** ($\text{Mg}_2\text{Si}$ / $\theta'$ precipitates), which SOLIDIFY does not model.

---

## Lab 5: Cold Work, Recovery & Recrystallization (3D)

- **Part A (Sub-Barrier vs. Active SIBM):**
  - On the 26-neighbor simple-cubic Potts lattice, advancing a flat `{100}` face swaps 9 unlike neighbors for 17, giving a theoretical flat-front barrier of $\Delta H = 8\,J_b$. Curved, kinked boundaries turn on near $5\text{–}6\,J_b$.
  - At `cold work = 1.0–2.5 J_b` (peak $2\text{–}5\,J_b$), boundaries remain nearly pinned against stored energy; at `≥ 6.0 J_b`, low-strain grains actively consume high-strain neighbors (SIBM). Whenever `cold work > 0`, SOLIDIFY withdraws the curvature-only grain-growth prediction and withholds $\Sigma 3$ annealing twins so newly allocated twin IDs cannot inherit unrelated stored energies.
- **Part B (Second-Order Recovery):**
  - Analytical second-order dislocation recovery $H_S = H_0 / (1 + \text{rec}\cdot H_0)$ (with $\text{rec} = 10^{-3} S$) drains high-$H_0$ grains proportionally fastest, collapsing the driving-force spread $\Delta H$ across boundaries until migration stalls inside the immobile band.
  - Schedules of `500–520 °C` for `60–90 min` on 3D `aluminum · Al–Cu` safely deliver $\ge 180$ sweeps while staying below the `96³` domain-limit cap.
- **Part C (Primary Recrystallization & Avrami $n$):**
  - Ideal constant-velocity 3D JMAK limits are $n = 3$ for site-saturated random sites (`random, at once`) and $n = 4$ for constant-rate random sites (`random, steady`).
  - Staggering births across batches (`random, steady`) raises the fitted slope $n$ relative to `random, at once`, whereas restricting sites to grain boundaries (`boundaries, at once` or `boundaries, steady`) causes earlier impingement along 2D boundary sheets and lowers $n$.
  - *Common misconception:* Students often quote Avrami $n$ as a real-time furnace-seconds exponent. Emphasize that SOLIDIFY fits $n$ on the **Monte Carlo sweep clock** $S$ (not linear in furnace seconds across ramps) and assigns per-grain stored energy from a deterministic hash fabric rather than crystal-plasticity slip mechanics.

---

## Lab 6: Directional Growth, Melt Flow & Selection

- **Part A (Bridgman $G$ vs. $V$):**
  - High $G/V$ (`gradient ≥ 0.12`, `pull speed ≤ 1.5`) maintains a tight, steeper thermal front where favorably oriented columns crowd out misaligned grains; low $G/V$ (`gradient ≤ 0.10`, `pull speed ≥ 3.5`) raises $G \cdot V$ and produces finer, heavily side-branched dendrites.
- **Part B (Qualitative 2D LBM Melt Flow):**
  - Left-to-right forced flow (`flow speed ≥ 0.02`, `show flow` ON) compresses the thermal boundary layer ahead of the upstream tip (speeding windward growth) and advects latent heat into the downstream wake (slowing leeward growth). Beckermann's diffuse drag ($h \approx 2.7571$ vs. Tong's $2.757$) places the effective no-slip wall at $\phi = 0.5$.
  - *Model boundary:* SOLIDIFY's 2D D2Q9 channel flow is explicitly **qualitative** (upstream speedup magnitude 1.26–1.36 vs. Tong et al. 1.37–1.43) and omits thermal/solutal buoyancy and 3D convection.
- **Part C (3D Helical Grain Selector & `[001]` Pole Figure):**
  - The 3D `selector` preset stages 64 chill-floor grains (`8 × 8` jittered grid) racing into a helical pigtail under directional pull. Competitive geometry progressively filters misaligned orientations upward through the spiral, visible in serial **`SLICE`** sections and in the tightening cluster near the center of **`pole figure [001]`** (dot diameter scaled by grain size).
  - *Honesty check:* SOLIDIFY guarantees competitive staging of the 64 chill-floor grains, not that every run exits as a single crystal.

---

## Lab 7: Inverse Process Design & Optimization

- **Part A (Human vs. CMA-ES Challenge):**
  - Nonlinear coupling between `cooling rate`, `inoculant n_max`, and the recalescence ratchet causes manual steering to overshoot or undershoot target ASTM $G$; separable CMA-ES adapts its mean and diagonal covariance across ten `256²` castings to minimize $|\Delta G|$.
- **Part B (2D CMA-ES & Full-Grid Verification):**
  - The 2D optimizer searches 5 coupled genes (`undercooling`, `inoculant n_max`, and early/mid/late 3-stage `cooling rate`) on `256²` proxy castings (`≥ 12` episodes).
  - Clicking **`apply recipe`** transfers that schedule to the full `1024²` grid. Differences between `256²` search $G$ and live `1024²` verification $G$ highlight finite-domain statistics, boundary-to-area ratio changes, and stochastic nucleation scatter.
- **Part C (Current-Grid 3D Volume Optimization):**
  - Unlike 2D proxy optimization, 3D `optimizer` executes every episode directly on the active 3D grid (`96³` recommended for speed, `calibrated solver` OFF / Kobayashi model) with locked rail controls to guarantee deterministic comparability across episodes, minimizing relative error on sphere-equivalent diameter $\bar{d}$.

---

## Suggested Grading Rubric (20 pts per lab)

| Criterion | Points | Evidence |
|---|---|---|
| Reproducible data, printable report & Run-Export ZIP | 4 | Valid seed, no unintended mid-pour intervention flag, complete measurements |
| Quantitative calculations / plots | 6 | Correct units, Scheil / Hall–Petch / Avrami / scale-transfer comparisons |
| Physical mechanism explanations | 6 | Clear causal link between governing PDEs / thermodynamics and observations |
| Awareness of model boundaries | 4 | Accurate identification of what the solver models vs. omits (e.g., $Le$, single phase, T6, sweep clock, qualitative LBM) |
