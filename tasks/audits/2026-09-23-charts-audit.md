# SOLIDIFY chart and readout audit (read-only)

Date 2026-09-23 · branch `v7-experiments` @ 6ec93a1 · no repo files were edited and git state was not changed.

**Scope.** `app/index.html` and `src/*.ts`, plus every `scripts/verify-*.mjs` and `TESTING.md` for
test couplings. I found the drawing sites by searching all of `src/` for `getContext`,
`createElementNS`, `fillText`, `fillRect`, `viewBox` and `<svg`. Only eight files draw anything:
hud, analyze, analyze3d, lab, experiment, phasediagram, viewcube (a navigation widget, not a plot)
and dive (landing-page art).

**Plots the brief expected that do not exist.** There is **no heat-treat plot**: `heatpanel.ts` is
text only. There is **no optimizer or challenge chart**: a thumbnail strip and text. There is **no
live lab curve**: the lab curve is drawn once, when the report is built. The slice panel, the SDAS
ruler and stereology are text readouts, not plots.

---

## 1. Inventory

Legend: Ax = axis lines · Tk = tick marks · TL = tick labels · Ti = axis titles · U = units ·
Lg = legend · Gr = gridlines · Hv = hover readout · Ex = expand · CSV/PNG = export · Tb = data table.
Y = present · ~ = partial · — = absent.

| # | Plot | Drawing code | Renderer · size (CSS px) | Ax | Tk | TL | Ti | U | Lg | Gr | Hv | Ex | CSV/PNG | Tb |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | HUD sparkline FRACTION SOLID | hud.ts:89-105 (panel hud.ts:21-36) | canvas 2D, DPR-scaled · 110×30 | — | — | — | panel title only | — | — | — | — | — | — | — |
| 2 | HUD sparkline INTERFACE ΔT (3D: POROSITY %) | hud.ts:89-105, relabel hud.ts:39-41 | same | — | — | — | title | 3D only (%) | — | — | — | — | — | — |
| 3 | HUD sparkline GRAINS | hud.ts:89-105 | same | — | — | — | title | n/a (count) | — | — | — | — | — | — |
| 4 | HUD histogram GRAIN SIZE µm | hud.ts:107-126 | same | — | — | — | title | µm in title | — | — | — | — | — | — |
| 5 | 2D cooling curve · probe | analyze.ts:314-355 (panel :52-70) | canvas 2D, DPR · 252×128; modal ≤920×560 (analyze.ts:219-243) | — | — | — | — | — | ~ (inline "T liquidus", "solid") | — | — | Y | — | — |
| 6 | 2D Scheil fs–T | analyze.ts:357-388 | same | — | — | — | — | — | ~ (footer sentence) | — | — | Y | — | — |
| 7 | 2D texture rose | analyze.ts:274-312 | canvas 2D polar, DPR · 252×128 | — | — | — | — | — | ~ (caption) | ~ (2 unlabelled rings) | — | Y | — | — |
| 8 | 3D cooling curve · probe | analyze3d.ts:248-286 (canvas :105-107) | canvas 2D, **not DPR** · 236×128 | — | — | — | — | — | ~ | — | — | — | — | — |
| 9 | 3D Scheil fs–T | analyze3d.ts:289-318 (canvas :109-111) | same | — | — | — | — | — | ~ | — | — | — | — | — |
| 10 | 3D "IPF" texture | analyze3d.ts:367-401 (canvas :117-119) | canvas 2D polar, not DPR · 236×190; modal 640×560 non-DPR (:179-201) | ~ (circle + cross) | — | — | — | — | — | — | — | Y | — | — |
| 11 | 3D pole figure ⟨100⟩/(0001)/5-fold | analyze3d.ts:321-365 (canvas :121-123) | same · 236×190 | ~ | — | — | — | — | ~ (corner caption) | — | — | — | — | — |
| 12 | 3D stereology | analyze3d.ts:225-245 | HTML text · 236 wide | n/a | | | | µm, ASTM G | | | | — | — | — |
| 13 | Lab report COOLING CURVE | lab.ts:764-825 (canvas lab.ts:691-695, `#foundryCurve`) | canvas 2D, **not DPR, 520×168 backing stretched to ~343×168 CSS** | — | — | — | top-left caption | — | ~ (landmark tags T_L/T_N/T_G/T_S) | — | — | — | — | — (a text table of landmarks sits beside it, lab.ts:705-721) |
| 14 | Sweep band painter | experiment.ts:309-341 (pure layout :284-306) | canvas 2D · 252×128 · **not mounted in the app**; used only by verify-experiment-gpu.mjs:149-158 | — | — | — | ~ ("swept →") | inside spec.name string | — | — | — | — | — | — |
| 15 | Composer phase diagram | phasediagram.ts:486-664 (pure `layout()` :142-433) | SVG viewBox 300×190 at width 100% (≈462 px desktop, ≈300 px phone) | ~ (frame rect) | — | ~ (ends + T_inv only) | ~ ("0 wt% Si", "°C" inside tick labels) | Y (wt%, °C) | — (prose in notes) | — | ~ (`<title>` on pour/solver/band) | — | — | — |

Non-plot readouts and legends, covered in §4: `#readouts` (main.ts:1705, :1792 → ui.ts:1007),
the scale bar (main.ts:1560-1582), the THERM colour bar (`#thermbar`, index.html:275-277, :348),
the SEM bar (index.html:278, :349), the SDAS ruler (analyze.ts:155-180, analyze3d.ts:149-167,
main.ts:957-968), slice depth (slicepanel.ts:77-80, :141), the optimizer strip
(optimizer.ts:263-264, :351-367), the lab TA grid and status (lab.ts:705-721, :482-491), the lab
section table (lab.ts:616-644), and heat-treat `#htNote`/`#htReport` (heatpanel.ts:600-628).

---

## 2. Per-plot detail

### 1–4 HUD (hud.ts; CSS index.html:264-268)
- **What.** fs uses a fixed 0–1 scale (hud.ts:95, `fixedMax=1`). ΔT (2D) = `max(0, 1 − interfaceT)`
  (hud.ts:60) and is dimensionless. In 3D the same strip carries porosity % (hud.ts:70). GRAINS is a
  count. The histogram has 14 bins over [min, max] of the current census, normalised to the tallest
  bin (hud.ts:112-125).
- **The x axis is not time.** It is the sample index in a 160-deep ring (hud.ts:11, :100). Samples
  come from the 4 Hz stats poll, which **runs while paused** (main.ts:1768-1786 is not gated on
  `running`), so the strip scrolls flat lines during a pause. No sim-time stamp is stored.
- **Scale.** Everything but fs auto-scales to its own max with a 0 baseline, and no number is
  printed. A jump from 3 to 300 grains looks identical.
- **Data.** `Hud.series` {fs, dt, grains}, private, with no timestamps (hud.ts:7). The histogram's
  diameters are passed in and discarded: 2D `s.diamsUm` (sim.ts:836-848, circle-equivalent, floor
  minPx); 3D sphere-equivalent recomputed in hud.ts:75.
- **Bug.** 2D `interfaceT` is 0 when there are no interface cells (sim.ts:828), so the ΔT strip
  plots **1.0, its maximum**, before nucleation and after full solidification.
- **Mislabel.** "INTERFACE ΔT" is the distance below the base's T_m (T̃ = 1). For an alloy it
  includes the solute depression m·c0, so it is not an undercooling.
- **Readability.** 9 px title in `--dim` #6b7280 (≈3.9:1 on the panel background). The 3D porosity
  trace is red (#e06c60, hud.ts:77) where 2D draws cyan in the same slot (hud.ts:84). `#hud` is
  `pointer-events:none` (index.html:264), so nothing is clickable.

### 5–7 2D analysis panels (analyze.ts)
- **Probe.** x = sim time t̃; y = probe-cell T̃ (sim.ts:829). There is a dashed liquidus
  TL = 1 − m·c0 (analyze.ts:318) and a cyan "solid" line at the first φ > 0.5 (:346-352). The last
  value is printed as `T 0.953`, **dimensionless even when a real material is loaded**
  (analyze.ts:354). Data: `Analyze.curve` {t, T, phi}, halved when over 900 points (:141).
- **Scheil.** The analytic path T̃(fs) = 1 − m·c0·(1−fs)^(k−1) is drawn as an amber line against
  measured (fs, T̃_interface) cyan 2 px dots (:367-384). The y axis is auto-scaled, the colours are
  explained only by a footer sentence, and the local name `fs` shadows the font-scale `fs`
  (:358 vs :378). Data: `Analyze.scheil` {fs, Ti}, capped at 900.
- **Rose.** 18 bins over one symmetry period, replicated j times. Radius ∝ √(count/max), which is
  area-true and good, but it is not stated on the plot. Two unlabelled rings (0.5, 1). There are no
  angle labels and no reference direction, so it is not clear that 0° is the grid +x axis.
  Data: `lastRose` (18 numbers) plus `p.aniMode`.
- **Units.** `AnalyzeHost` has no `Units` (analyze.ts:12-16, built at main.ts:940), so **all three
  panels are dimensionless in every mode**, while the corner readout prints °C for the same melt.
- **Geometry.** An 8 px margin (`frame()` :253-259) leaves no room for tick labels. The ⤢ modal
  redraws the same code larger through `fs` scaling. It is the only expand path in 2D and has no
  export.

### 8–12 3D analysis panels (analyze3d.ts)
- **Probe and Scheil** are ports of the 2D panels with the same honesty gaps. They also have
  **no DPR scaling** (the backing store equals the CSS size, so they blur on HiDPI) and **no
  expand**: `mk(title, null)` at :104 and :108.
- **The 3D Scheil series is unbounded.** analyze3d.ts:175-176 pushes with no cap or decimation.
  2D caps at 900. The array grows for the whole session and is redrawn in full at 4 Hz.
- **The "IPF" is mislabelled.** It projects each grain's crystal z-axis (`qrotZ`, :388)
  stereographically into the sample frame. That is a **[001] pole figure**, not an inverse pole
  figure: an IPF plots a sample direction in the crystal frame, inside the standard triangle. It
  also duplicates one of the pole-figure panel's three ⟨100⟩ axes. Marker area ∝ ∛vox with no size
  key, the only annotation is "z ⊙", and there are no X/Y sample-axis labels. Its expand modal is a
  640×560 non-DPR canvas.
- **Pole figure.** It does not say whether the projection is stereographic or equal-area, has no
  X/Y labels and no expand.
- **Stereology** prints d̄₂, ASTM G, d̄₃ and the ratio as text. The data for the plot it is really
  teaching (a section-size vs true-3D size distribution, i.e. Saltykov) is already in hand:
  `lastStereo.sections[].areaVox` and `lastStats().grains[].vox`.
- **Data.** `Analyze3D.curve`/`.scheil` (private); quaternions from `sim3d.quats`; census from
  `host.lastStats()`.

### 13 Lab report cooling curve (lab.ts:691-695, :764-825)
- **Distortion.** The canvas is **520×168 backing but `width:100%`**. Inside `#foundryResults`
  (min(400px, 92vw), padding 16) and `.rcard` (padding 10) that is ≈343 CSS px wide, a horizontal
  squash of about 0.66×. The 9 px glyphs and the 3.2 px landmark dots come out anisotropic, and the
  canvas is not DPR-scaled either.
- **What.** x = time since pour t̃. y = mean remaining-liquid T̃ (it is not a probe, as the card
  itself says at lab.ts:719-721), on a fixed range [min(0, T), max(1.15, T)] (lab.ts:771). With
  that range the arrest detail near T̃ ≈ 1 is squeezed into a thin band.
- **dT/dt overlay** (:786-797) runs on its own zero-centred scale with **no scale at all**.
- **Probable bug: the "liquidus" line is T_m for alloys.** The dashed line is drawn at T̃ = 1
  (:777-782). The pour sits at 1 + superheat (lab.ts:280, main.ts:454-469). For an alloy the
  liquidus is 1 − m·c0 (analyze.ts:318 uses exactly that), so the line labelled "liquidus" is the
  base's T_m. It will disagree with the extracted T_L marker (:818), which comes from the curve.
- **Units.** The adjacent TA grid prints °C/K/s through `units` (lab.ts:700-713), but the plot
  itself has no axes or units.
- **Unused data.** `ta.fsDerived` (fs reconstructed from the Newtonian zero curve, thermal.ts:82)
  and `ta.fsRms` are computed and never plotted.
- **Static.** There is no live T(t) during the pour. The set-point programme exists
  (`ProgramRun`) and would overlay naturally.
- **Data.** `Lab.series` {t, T, fs, fired} (lab.ts:95, :136), span-preserving decimation to 1200
  (`retain`, lab.ts:341). `ta` is local to `buildReport` (lab.ts:679) and has to be kept for export.

### 14 Sweep band (experiment.ts)
- **Not mounted anywhere in the app.** It exists as a tested painter only.
- `padL = 34` reserves a y-tick gutter that is never drawn (:297). The only axis text is
  "`swept` →". `SweepSpec.name` carries the y units inside a string (experiment.ts:150) and
  `swept` has no unit field.
- Its pure-layout / thin-painter split is the right pattern for the shared module.

### 15 Phase diagram (phasediagram.ts)
- **The best-structured figure.** Pure `layout()` in data space (wt%, °C), exported
  `FRAME`/`toPx`/`fromPx`, and in-place SVG updates.
- **Axes.** Tick labels are only the domain ends plus T_inv (:634-654), and they are data-driven,
  not rounded numbers (e.g. "547 °C", "13.6"). There are no tick marks. The x title is fused into a
  tick ("0 wt% Si") and there is no y title. The frame stroke #262b33 is barely visible.
- **Legend.** Line colours and dashes (:471-478) are explained only inside the notes prose
  ("DASHED: …").
- **Size.** Text is 7–7.5 user units, about 11 px on desktop but ~7 px on a 360 px phone. Axis
  text is #6b7280.
- **Hover.** Only SVG `<title>` on the pour marker, the solver dot and the band. A crosshair
  readout (c, T at the pointer) is nearly free because `fromPx` already exists.
- **Units.** Always SI. It refuses abstract materials by name (:146-147), which is correct.

---

## 3. Units honesty: what each axis would need

The solver stores everything dimensionless. `Units` (units.ts:327-437) converts only when
`u.known` (the material has an SI identity). Lengths are always real, because µm/cell is always
set (units.ts:14, :201-215).

| Quantity | Stored | Abstract material ("generic") | Real material | Plots affected | Axis must switch? |
|---|---|---|---|---|---|
| absolute T | T̃ (T_m = 1) | T̃ only; label "T̃ (dimensionless, T_m = 1)" | °C via `u.celsius` | 5, 6, 8, 9, 13 | **yes** |
| ΔT (undercooling, recalescence) | ΔT̃ | ΔT̃ | K via `u.kelvin` | 2 (2D), 13 landmarks | **yes** |
| time | t̃ | t̃ | s via `u.seconds`. The anchor differs: solute diffusion if alloy, heat diffusion if pure (units.ts:228-230, :289), and the title or tooltip must name it (Lewis mismatch, units.ts:244-255) | 1–3 (once time-stamped), 5, 8, 13 | **yes** |
| dT/dt | T̃/t̃ | same | K/s via `u.kPerSec` | 13 overlay | **yes** |
| length | µm | µm (real: resolution is declared) | µm | 4, 12, ruler, scale bar | no |
| f_s, %, counts, G | dimensionless | same | same | 1, 3, 6, 9, 14 | no |
| composition | wt% | refused | wt% | 15 | no |
| heat-treat time/T | s, °C (real clock) | refused by `canTreat` | s, °C | (new plot) | no, SI only |
| orientation | rad/deg | same | same | 7, 10, 11 | no |

**Latching.** A material swap mid-series silently changes the conversion. The lab already latches
`siAtPour`/`umAtPour` (lab.ts:273-275). Plots should latch a Units snapshot per series and reset,
or refuse by name, on a swap. `clearMelt` already resets the HUD and analyze series
(main.ts:460-471).

---

## 4. Other readouts and legends

- **`#readouts`** (main.ts:1705-1713 3D, :1792-1799 2D; ui.ts:1007-1011). Text key/value. It uses
  `u.fmtC/fmtTime/fmtK`, so an abstract material shows "—" for t and melt. That is honest, but the
  dimensionless value is then shown nowhere. ΔT max is in the 2D list and absent from 3D.
- **Scale bar** (main.ts:1560-1582). Candidates run 5–500 µm, so there is no mm option. If none
  fits the 30–160 px band it falls back to 100 µm at whatever width results.
- **THERM colour bar** (`#thermbar`). It carries static "T_m"/"cold" labels, but the shader maps
  T̃ ∈ [−0.25, 1.10] (shaders.ts:1318-1319), so T_m actually sits at 93% of the bar, not the top.
  It needs real ticks (°C when known).
- **FIELD lens** (inferno over T̃ ∈ [−0.2, 1.1], isotherms every 1/18 T̃, shaders.ts:1302-1305)
  has **no legend at all**.
- **SEM bar.** "×240 · WD 10.2 mm" is static decoration (index.html:349), not computed from the
  zoom, and it sits beside a real scale bar. Either compute it or mark it as decoration.
- **Slice depth** is shown as % of the domain (slicepanel.ts:78, :141). It could print µm.
- **Optimizer.** 64 px thumbnails with "G x.x" labels (optimizer.ts:351-362) and a status line.
  There is no |ΔG|-vs-casting chart, and per-episode scores are **not retained**: `scores` is
  per-generation (optimizer.ts:337).
- **Heat-treat.** Prose only (#htNote, #htReport). `HeatSchedule` stages (heattreat.ts:59) and
  `integrate()` (:175) could drive a T(t) schedule plot with the law's predicted d̄(t) and the
  measured before/after points.
- **Stereology and the lab grid** are text. Their formatting is consistent with `units`.

---

## 5. Cross-cutting visual issues

1. **Fonts.** 9 px canvas text everywhere (analyze.ts:278/:337/:386, analyze3d.ts:254/:294/:334,
   lab.ts:775, hud title CSS 9 px) and 7–7.5 user units in the SVG. That is below what a figure
   needs; the floor should be about 10–11 px in panels and 12–13 px in the modal.
2. **Contrast.** Label greys #5b6675 (≈3.2:1) and #6b7280 (≈3.9:1) on the rgba(15,17,21) panel
   are below 4.5:1 for small text.
3. **DPR.** 2D analyze and the HUD are DPR-correct. The 3D panels, the IPF modal and the lab curve
   are not.
4. **Aspect.** The lab curve is stretched (see §2, item 13).
5. **Colour semantics are inconsistent.** Amber means "measured probe trace" in 5/8 but
   "model/prediction" in 6/9 and the phase-diagram liquidus. Cyan means "measured" in 6/9 but "the
   curve itself" in 13 and "solver line" in 15. Needed: one semantic palette (measured, model,
   reference, event, grid, axis, label) read from the existing `:root` tokens (index.html:10-20).
6. **No shared frame code.** Four separate ad-hoc margin and scale implementations (analyze
   `frame()`, analyze3d literal 6/12, lab pad 22, experiment pads).
7. **Enlarge is inconsistent.** Three 2D panels and the 3D IPF have it; the 3D probe, Scheil and
   pole figure, the lab curve, the HUD and the phase diagram do not. No plot has export or a table.

---

## 6. Recommended architecture

### Decision: hand-rolled canvas plot core, no new dependency; SVG kept for the phase diagram

Weighing the three options:

- **uPlot** (~46 KB min, ~21 KB gz; the app chunk is ~318 KB).
  - For: best-in-class live time series, cursor/legend/zoom built in.
  - Against: it fits only the time-series and xy-scatter families here (plots 1–3, 5, 6, 8, 9, 13).
    It does not do polar plots (7, 10, 11), the phase diagram (15) or the band/refusal painter (14),
    so those stay hand-rolled and you end up with **two styling systems**, which defeats "consistent
    styling across every plot".
  - Against: its internals are not a pure data→geometry function, so the repo's gate doctrine
    (verify gates re-derive geometry in CI without a browser, as in `layout()`/`toPx`,
    `bandLayout`/`drawBand`, and the "Presence is not placement" lesson in tasks/lessons.md) cannot
    reach it.
  - Against: 110×30 sparklines need a separate mode anyway.
  - Against: no CSV/PNG/modal/table; you build those regardless.
  - Series are capped at 900–1200 points, far below where uPlot's speed matters.
- **d3-scale + d3-axis.**
  - `d3-delaunay` shares no code with them (its only dependency is `delaunator`), so "already have
    d3" saves nothing.
  - d3-scale pulls d3-array, d3-format, d3-interpolate, d3-time and d3-time-format.
  - d3-axis renders into SVG through a selection, which is wrong for 4 Hz canvas panels.
  - The one piece worth having is the nice-tick algorithm, which is ~30 lines.
- **Hand-rolled (recommended).**
  - About 700–900 lines, ~10 KB min.
  - One theme, one tick generator, one units resolver and one modal for every family.
  - A pure layout layer gated in CI.
  - Refusal and empty states stay first-class, as the app already does ("enable ALLOY…").
  - Borrow d3-array's `tickIncrement` logic (ISC licence, credit it) rather than depend on it.
  - Revisit uPlot only if histories grow past ~10⁴ points or drag-zoom becomes a requirement.

### Module layout (`src/plot/`)

- **`ticks.ts`** (pure)
  - `niceStep(span, target)` with 1-2-5×10^k steps.
  - `ticks(lo, hi, n≈5)` returns values inside the domain.
  - `fmtTick(v, step)` sets decimals from the step, switches to scientific when |v| ≥ 1e4 or < 1e-3,
    and uses a true minus sign.
  - Do **not** nice-round domains by default: the phase diagram's frame-tightness gate
    (verify-phasediagram.mjs:117-121, content ≥ 60% of the height) would fail if domains were
    expanded outward.
- **`quantity.ts`**
  - `Quantity` kinds: temp, dtemp, time, rate, length, fraction, percent, count, wt, angle,
    dimless.
  - `resolve(q, units)` returns {title, unit, conv, prov}. Abstract materials get "T̃ (dimensionless,
    T_m = 1)"; real ones get "T (°C)". Time carries its anchor ("s · solute-diffusion anchor").
  - Every axis title carries its unit or the word "dimensionless", per the lessons.md rule "a claim
    carries its units".
- **`layout.ts`** (pure, browser-free)
  - `layoutXY(spec, w, h, theme)` returns the plot rect, x/y (and y2) ticks {v, px, label}, titles,
    legend boxes and series polylines in px.
  - `layoutPolar(spec, …)` does the same for rose and pole figures (angle ticks, radial scale,
    sample-axis labels, named projection).
  - `layoutHist`.
- **`canvas.ts`**
  - `paint(ctx, layout, dpr)`.
  - A crosshair layer (separate overlay canvas, so the base plot is not repainted on every
    pointermove).
  - Hit-test: binary search on sorted x; nearest point for scatter.
- **`view.ts`**
  - `PlotView`: `mount(parent, {w, h, compact})`, `setSpec()`, rAF-coalesced live updates,
    ResizeObserver, DPR.
  - Hover tooltip showing every series at the cursor with units.
  - A ⤢ button.
- **`modal.ts`**
  - One shared modal: a large PlotView plus a data table (head and tail rows, with "N rows,
    decimated from M"), CSV, PNG and copy-TSV.
  - CSV carries **both** dimensionless and SI columns, plus a `#` header with material, the unit
    anchors and their provenance, seed/share link and app version.
  - PNG via `canvas.toBlob` at 2×, with an optional light "print" theme.
  - The SVG phase diagram exports through XMLSerializer → Image → canvas.
- **Data contract.** Each owner exposes `plotData(): {columns: [{name, quantity, values}], meta}`.
  - Hud: needs sim-time stamps; `push(s, simTime)`. Only push when simTime advances.
  - Analyze / Analyze3D: add `units()` to both hosts (main.ts:940-941).
  - Lab: keep `ta`.
  - Experiment: `SweepResult`. Add unit fields to `SweepSpec`.
  - PhaseFigureView: `Figure`.
  - Optimizer: a new episode history.
- **HUD sparkline policy.** Keep 110×30 sparklines; an axis-less sparkline is legitimate at glance
  size. Add the current value with its unit, min/max labels and a subtle 0/1 baseline. Make each
  `.spark` `pointer-events:auto` (the v1.8.1 fall-through-to-seed lesson, tasks/todo.md:442-444)
  and open the full axis plot vs sim time in the modal on click.
- **Colour bars.** THERM gets ticks matching the shader's mapping (°C when known). FIELD gets a
  legend. Both go through `ticks.ts`/`quantity.ts`.

### Migration order

0. **Core plus a browser-free gate** (`verify-plot.mjs`: tick niceness and containment, every
   title carries a unit or "dimensionless", abstract material ⇒ no "°C"/"s" anywhere, CSV header
   and row count, and a plotted point re-derived from its own axis ticks). **Adding a CI script
   trips two meta-gates**: update `.github/workflows/ci.yml`, `scripts/run-tests.mjs` SUITE, and
   TESTING.md's three "thirteen browser-free scripts" sites and per-script check counts
   (CI-SCRIPT-COUNT verify-phasedata.mjs:569-611, TESTING-CHECK-COUNT :615-672).
1. **Lab report curve** (lab.ts:764).
   - Biggest payoff: it is the "report figure". It is static, so it is the easiest.
   - Fixes the aspect squash and the liquidus mislabel.
   - Adds a real dT/dt axis (y2 or a stacked panel) and a fs measured-vs-derived panel.
   - Keep `#foundryCurve`.
2. **2D probe + Scheil** (analyze.ts).
   - The live time series proves the crosshair.
   - The existing ⤢ becomes the shared modal. Keep `#texPanel .zoomBtn`.
3. **3D probe + Scheil** (analyze3d.ts). Same specs. Fixes DPR, adds the missing expand, caps the
   Scheil array.
4. **HUD.** Time stamps, the ΔT no-interface fix, sparkline plus modal, a histogram with rounded
   bin edges and a count axis.
5. **New plots.**
   - Optimizer |ΔG| vs casting # with a best-so-far step line.
   - Heat-treat schedule T(t) with predicted d̄(t) and measured points. It must be a sibling
     element, never inside #htNote/#htReport (heatpanel.ts:619-621).
   - A live lab T(t) with the set-point.
6. **Polar family.**
   - Rose: angle ticks per symmetry period, radial scale.
   - Pole figure.
   - Rename "IPF" to "[001] pole figure", or implement a true IPF triangle.
   - Stereology size-distribution histogram.
7. **Sweep band painter.** Keep the `bandLayout(res, w, h)` / `drawBand(ctx, res, w, h)` contract.
8. **Phase diagram last.** It is the most heavily gated. Adopt the shared ticks, titles, legend,
   hover (`fromPx`) and export. Keep its SVG.

---

## 7. Test-suite couplings that a migration can break

| Coupling | Where | What must be preserved |
|---|---|---|
| Lab curve element exists | verify-tools.mjs:377, used in the `LAB` verdict :397-398 | an element with id `foundryCurve` |
| Lab report text | verify-tools.mjs:379, :449, :459-470 (regexes `σ_y \(Hall–Petch\) ([\d.]+) MPa`, ` — met: `, `/missed/`, `/spec σ_y/`, "⟨A⟩-equivalent", "≥ 999 MPa" absent, "inoculant used") over `#foundryResultsBody.textContent` | any legend, tooltip text or data table placed inside `#foundryResultsBody` must not contain "missed", "spec σ_y", "σ_y (Hall–Petch)" or "≥ 999 MPa", and must not come before the σ_y row. Safest: plot text as canvas pixels, or the table in the modal (outside the body) |
| Texture enlarge | verify-tools.mjs:214-215 clicks `#texPanel .zoomBtn` and checks `#app > div[style*='fixed']` | keep `#texPanel` and `.zoomBtn`. A missing button **throws and crashes the script**. The modal check is **log-only** (:218): TESTING.md:484 claims the enlarge modal is gated but it would silently log `big:false`. Keep the modal a direct `#app` child with inline `position:fixed`, or better, turn the log into an assertion |
| Band painter | verify-experiment-gpu.mjs:149-158, :190 | `drawBand(ctx, res, 252, 128)` signature; it paints over the whole canvas; the pixel at (251,127) must stay **background** ("nothing draws there") or the diff count is wrong; >100 changed pixels for both an ok and a refused result |
| Band layout | verify-experiment.mjs:202-211, :234-243 | `bandLayout(res, 252, 128)` → `labels[]` with kinds refusal/controlled; `band`/`means`/`pts` empty on refusal; 2 bands and 4 finite pts on ok |
| Phase-diagram geometry | verify-phasediagram.mjs:46, :104-152 (+ other `F.layout` calls) | `layout()` Figure shape; exports `FRAME` {w, h, ml, mr, mt, mb}, `toPx`, `fromPx` exact inverses; marker in frame; ≥60% frame fill (no outward nice-rounding). Also phasediagram.ts:345 hard-codes `INNER = 250` = FRAME.w − ml − mr: **change FRAME's margins (for axis titles) and label fitting silently desyncs** |
| Regime band | verify-regimes.mjs:187, :207 | `layout().band.regime` |
| Live cursor | verify-phasediagram-gpu.mjs:63-66, :111 | element `#pdCursor`, hidden via the **`display` attribute** (not CSS) with textContent cleared (phasediagram.ts:616-621), text `melt N °C` equal to `units.fmtC`; `#composer .pdnotes` containing "off this diagram" |
| Landing figure | verify-phasedata.mjs:455-565 (PD-LANDING-FIGURE) parses `index.html` `<svg id="pdFig">`: `line.ax`, `text.tick` | out of scope for the app, but **do not migrate** the landing SVG to the module: it is hand-typed on purpose (keeps phasedata out of the landing chunk) and the gate reads its literal markup |
| Line-number citation | verify-phasedata.mjs:295-296 comment cites `analyze.ts:318` | comment only, but it goes stale once analyze.ts is refactored |
| Doc meta-gates | verify-phasedata.mjs:569-611, :615-672 | new CI scripts or new named checks must update ci.yml, run-tests.mjs and TESTING.md counts |
| Heat-treat pinned strings | verify-heattreat-gpu.mjs:522, 564, 580, 583, 636, 653, 1614, 1649, 1959, 1996, 2028; verify-tools.mjs:112 | never put plot DOM inside `#htNote` or `#htReport` (one gate reads it byte-for-byte, per heatpanel.ts:619-621) |
| Optimizer report | verify-optimizer.mjs:48-61 | `#labReport` display semantics, textContent and its "apply" button. Put a convergence chart outside `#labReport` |
| Screenshot diffs | verify-3d.mjs:62-65 `hideChrome` hides non-CANVAS `#app` children; must-differ checks at :113, :176, :344, :412, :441 (verify-tools.mjs:29 same idiom) | a plot or modal mounted as a bare `<canvas>` child of `#app`, or outside `#app` (e.g. `body`), survives `hideChrome`. If it animates (crosshair, live axes) every must-differ check passes vacuously. Mount plot canvases inside wrapper divs under `#app` |
| Tour | tour.ts:473 `hl: ["#hud"]`; prose tour.ts:379 (COOLING PROBE / SCHEIL / TEXTURE ROSE), :461 ("POROSITY % … in the HUD") | keep `#hud` and the panel names, or update the prose |

**No gate reads pixels from, or selectors inside,** the HUD canvases, the analyze or analyze3d
canvases, or `#readouts`. Those migrate with no test risk beyond the `hideChrome` note above.

---

## 8. Bugs and defects found along the way (for triage)

1. **hud.ts:60.** ΔT plots 1.0 (its maximum) whenever there is no interface (sim.ts:828 returns
   interfaceT = 0).
2. **lab.ts:777-782.** The "liquidus" line is drawn at T̃ = 1 (the base's T_m) even for alloys,
   where the liquidus is 1 − m·c0. It disagrees with the extracted T_L.
3. **lab.ts:693-694.** The 520 px backing is stretched to ~343 CSS px, distorting text and markers.
4. **analyze3d.ts:175-176.** The 3D Scheil series is unbounded.
5. **analyze3d.ts:116, :367-401.** The "IPF" panel is a [001] pole figure.
6. **analyze.ts:354, analyze3d.ts (all).** Values are dimensionless even for real materials,
   because the hosts carry no Units.
7. **HUD** records while paused (main.ts:1768-1786), so its x axis is poll count.
8. **THERM colour bar** labels "T_m" at the top while the mapping puts T_m at 93%
   (shaders.ts:1319). The FIELD lens has no legend.
9. **SEM bar** magnification and WD are static text (index.html:349).
10. **verify-tools ENLARGE** is log-only (verify-tools.mjs:217) while TESTING.md:484 lists it as
    covered.
