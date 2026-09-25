// verify-plot.mjs — the plot core (src/plot, U2), checked without a browser.
//
// Every figure in the instrument is laid out by a pure function before a
// canvas sees it (src/plot/layout.ts), titled by one units resolver
// (src/plot/quantity.ts) and exported by one CSV writer (src/plot/csv.ts), so
// all of it can be gated here, in CI, the way verify-units.mjs gates the
// scaling layer: the TypeScript is loaded through vite's SSR loader, never
// re-implemented. Thirteen checks (the last four since U2's second half, which
// moved the analysis columns, the polar plots and the phase diagram onto the
// core; PLOT-WIRING since the U2 review, which found the fixes above gated
// only as pure functions, never where the app calls them):
//
//   PLOT-TICKS        the ported d3-array tick algorithm: exact decimals, round
//                     1-2-5 steps inside the domain, the label formatter
//   PLOT-LAYOUT       margins sized to the labels (nothing off the canvas or
//                     overlapping), stacked panels sharing x, a plotted point
//                     re-derived from its own axis ticks, every tick label
//                     read back through its axis's factored power of ten, no
//                     label on a trace, and the enlarged view's card fitting
//                     the window
//   PLOT-UNIT-TITLES  every axis title carries a unit or says "dimensionless";
//                     a material with no SI identity prints no °C, K or s
//                     anywhere; a real one names its clock's anchor on every
//                     time axis, the small panel's short form included
//   PLOT-CSV          the export's provenance header (material, seed, grid,
//                     solver, share link, build, the unit bridge's numbers, the
//                     chemistry) and its rows, SI beside dimensionless, each SI
//                     value the bridge's conversion; every figure's column keys;
//                     the table's time column in the axis's unit; file names
//   PLOT-LIQUIDUS     the drawn liquidus is the charge's as the solver runs it
//                     (1 − m·c₀ under Kobayashi, T̃ = 1 under the calibrated
//                     solver), named "model" where it is not the material's own,
//                     and the provenance prints both (charts-audit 8.2)
//   PLOT-HUD-GAP      no interface is a gap in the ΔT strip, not its maximum
//                     (charts-audit 8.1)
//   PLOT-HUD-RECORD   the HUD records only while sim time advances, and a new
//                     unit bridge starts a new series
//   PLOT-CONTRAST     every chrome role ≥ 4.5:1 on every surface it is drawn
//                     on (tokens.css), every data slot ≥ 3:1 on screen and on
//                     print paper (translucent fills composited), the slots
//                     read from design/plot.ts, text ≥ 11 px
//   PLOT-SCHEIL       the Scheil figure's prediction through the bridge, in the
//                     solver's own temperature scale (Kobayashi and calibrated),
//                     its table carries the prediction and the gap at each
//                     measured point, its axis is the data's, and a pure melt
//                     refuses by name
//   PLOT-SERIES-CAP   the probe and Scheil records (2D and TRUE 3D) keep only
//                     advancing sim time and stay under their cap, first and
//                     latest kept, the export saying it was decimated; a new
//                     bridge OR a new chemistry starts a new series; both
//                     analysis modules record through them
//   PLOT-POLAR        the rose and the pole figures: every label on the canvas
//                     and clear of the others at every size they are shown at,
//                     a wedge's radius re-derived from its table row and the
//                     outer ring's value, the rim always a labelled ring, a
//                     known rotation's pole on the ring its tilt names, round
//                     angle labels, the caption naming the radius, the
//                     reference direction and the projection
//   PLOT-PD-AXES      the phase diagram's axes for every drawable binary at the
//                     composer's frame (desktop and phone type) and at the
//                     enlarged view's REAL frames (pdBigSize / pdBigFrame, three
//                     windows and the tour's inset): round ticks inside the
//                     frame's own domain, the invariant's own tick, labels apart
//                     on both axes, each at toPx of its value, titles with units,
//                     INNER derived from FRAME; its table and CSV hold every
//                     drawn vertex
//   PLOT-WIRING       the call sites: the lab's pour latches the chemistry and
//                     the figure draws it, the HUD's ΔT takes the interface
//                     count and the charge's liquidus, main.ts records with sim
//                     time and measures undercooling from chargeLiquidus, the
//                     2D interface reduction reads below T̃ = 0
//
//   node scripts/verify-plot.mjs
import { createServer } from "vite";
import { readFileSync } from "node:fs";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const T = await server.ssrLoadModule("/src/plot/ticks.ts");
const L = await server.ssrLoadModule("/src/plot/layout.ts");
const Qm = await server.ssrLoadModule("/src/plot/quantity.ts");
const F = await server.ssrLoadModule("/src/plot/figures.ts");
const C = await server.ssrLoadModule("/src/plot/csv.ts");
const TH = await server.ssrLoadModule("/src/plot/theme.ts");
const DP = await server.ssrLoadModule("/src/design/plot.ts");
const PT = await server.ssrLoadModule("/src/plot/paint.ts");
const V = await server.ssrLoadModule("/src/plot/view.ts");
const U = await server.ssrLoadModule("/src/units.ts");
const QU = await server.ssrLoadModule("/src/quant.ts");
const M = await server.ssrLoadModule("/src/materials.ts");
const TA = await server.ssrLoadModule("/src/thermal.ts");
const AN = await server.ssrLoadModule("/src/plot/analysis.ts");
const PO = await server.ssrLoadModule("/src/plot/polar.ts");
const PD = await server.ssrLoadModule("/src/phasediagram.ts");
const AL = await server.ssrLoadModule("/src/alloy.ts");
const PDATA = await server.ssrLoadModule("/src/phasedata.ts");
const SH = await server.ssrLoadModule("/src/shaders.ts");
const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

// ------------------------------------------------------------------ fixtures
/** a Units for a material as main.ts builds one (unitsNow) under Kobayashi */
const unitsFor = (key, over = {}) => {
  const mat = M.MATERIALS[key];
  const si = mat.si ?? null;
  const p = mat.params;
  return new U.Units(U.scaleOf({
    si, n: 1024, dx: 0.03, latent: p.latent ?? 1.6, dSol: p.dSol ?? 0.9,
    alloy: (p.alloyOn ?? 0) === 1, umPerCell: U.DEFAULT_UM_PER_CELL, ...over,
  }), si);
};
/** a Units as main.ts builds one under the CALIBRATED solver with the solute
 *  field on (setSolver's params, unitsNow's quantAnchor) */
const WT = AL.WT_PER_C0;
const unitsQuant = key => {
  const mat = M.MATERIALS[key], si = mat.si;
  const q = QU.calibrate({ si, alloy: true, c0wt: mat.params.c0 * WT, lambda: 30 });
  return new U.Units(U.scaleOf({
    si, n: 1024, dx: q.dx, latent: q.latent, dSol: q.dTilde, alloy: true, umPerCell: q.umPerCell,
    dTherm: q.dTilde, lambda: q.lambda, oneShiftK: q.liquidusShiftK, oneSource: q.liquidusSource,
  }), si);
};
const bridge = key => Qm.bridgeOf(unitsFor(key), M.MATERIALS[key].label);
const bridgeQ = key => Qm.bridgeOf(unitsQuant(key), M.MATERIALS[key].label);
/** the chemistry main.ts chemNow reports: the solver's m̃, c̃₀, k, and the
 *  material's own liquidus (T_m + m_L·c₀,wt; T_m for a pure melt), computed
 *  here from materials.ts, not read back */
const chemFor = (key, over = {}) => {
  const mat = M.MATERIALS[key], si = mat.si ?? null;
  const p = { ...mat.params, ...over };
  const alloy = (p.alloyOn ?? 0) === 1;
  const c0wt = si ? (p.c0 ?? 0) * WT : null;
  const liqC = si ? si.Tm - U.K0 + (alloy ? si.mL * c0wt : 0) : null;
  return F.chemOf(p, { c0wt, liqC, liqSource: si ? `fixture: T_m + m_L·c₀ (${si.source.split(" · ")[0]})` : "" });
};
const chemQ = key => ({ ...chemFor(key), solver: SH.SOLVER.QUANT });
const PROV = { material: "fixture", seed: "1337c0de", grid: "1024² cells (2D)", solver: "Kobayashi (1993) phase field, 2D",
  share: "https://solidify.example/app/#s=fixture", build: "abc1234" };

/** a synthetic cast-cup record: liquid cooling, an arrest with recalescence
 *  at the liquidus, a freezing plateau, then the solidus (no liquid left).
 *  `tk` scales its clock (a fast record: dT/dt past 10⁴, t in the 10⁻⁵) */
function castRecord(tl, n = 400, tk = 1) {
  const s = [];
  for (let i = 0; i < n; i++) {
    const t = i * 0.05;
    let T, fs;
    if (t < 4) { T = tl + 0.12 - 0.05 * t; fs = 0; }
    else if (t < 5) { T = tl - 0.08 + 0.05 * (t - 4) + 0.002 * Math.sin(t * 9); fs = 0.1 * (t - 4); }
    else if (t < 17) { T = tl - 0.03 - 0.012 * (t - 5); fs = 0.1 + 0.85 * (t - 5) / 12; }
    else { T = 0; fs = 1; }
    s.push({ t: t * tk, T, fs });
  }
  return s;
}
const coolFig = (key, full, { quant = false, tk = 1 } = {}) => {
  const b = quant ? bridgeQ(key) : bridge(key);
  const chem = quant ? chemQ(key) : chemFor(key);
  const series = castRecord(F.chargeLiquidus(chem), 400, tk);
  return F.coolingFigure({ series, ta: TA.analyseCurve(series), bridge: b, chem, full, prov: { ...PROV, material: b.material, recorded: series.length } });
};
/** HUD samples: an interface only between i = 20 and 150 */
const hudSamples = n => Array.from({ length: n }, (_, i) => ({
  t: i * 0.3, fs: Math.min(1, i / 160), grains: Math.floor(i / 4), pore: i * 0.01,
  dt: F.hudDeltaT(i >= 20 && i < 150 ? 300 : 0, i >= 20 && i < 150 ? 0.8 - 0.0002 * i : 0, 0.85),
}));
/** a TRUE 3D porosity strip early in a cast: 0 to 0.002 % (its axis factors
 *  out 10⁻³) */
const poreSamples = n => Array.from({ length: n }, (_, i) => ({ t: i * 0.2, fs: 0, dt: NaN, grains: 0, pore: (0.002 * i) / (n - 1) }));
/** a probe cell cooling through its liquidus, a small recalescence, frozen
 *  (φ past ½) from i = 120 (n = 80: a record still at its liquidus, whose
 *  latest samples sit right where a right-end label would go) */
const probeRec = (tl, n = 200) => Array.from({ length: n }, (_, i) => ({
  t: 0.5 + i * 0.04, T: tl + 0.1 - 0.0012 * i + (i > 110 && i < 130 ? 0.004 : 0), phi: i >= 120 ? 1 : 0,
}));
const probeFig = (key, three = false, n = 200) => {
  const b = bridge(key), chem = chemFor(key);
  return AN.probeFigure({ samples: probeRec(F.chargeLiquidus(chem), n), bridge: b, chem, three, prov: { ...PROV, material: b.material } });
};
/** Scheil: the charge's own chemistry when it has a solute field, a
 *  fixture's otherwise (the model metal with ALLOY switched on) */
const scheilChem = key => ((M.MATERIALS[key].params.alloyOn ?? 0) === 1
  ? chemFor(key) : chemFor(key, { alloyOn: 1, mLiq: 0.45, c0: 0.3, kPart: 0.2 }));
/** what the solver measures: the interface held under the liquidus, drifting
 *  down as it freezes (it does not follow Scheil into the eutectic) */
const scheilRec = (chem, n = 120) => Array.from({ length: n }, (_, i) => {
  const fs = 0.01 + (0.9 * i) / n;
  return { t: i * 0.1, fs, Ti: F.chargeLiquidus(chem) - 0.02 - 0.03 * fs };
});
const scheilFig = (key, three = false) => {
  const chem = scheilChem(key), b = bridge(key);
  return AN.scheilFigure({ samples: scheilRec(chem), bridge: b, chem, three, prov: { ...PROV, material: b.material } });
};
const allFigures = key => {
  const b = bridge(key);
  const s = hudSamples(180);
  return [
    ["cooling report", coolFig(key, false)], ["cooling full", coolFig(key, true)],
    ...["fs", "dt", "grains", "pore"].map(k => [`hud ${k}`, F.hudFigure(k, s, b, PROV, k === "dt" ? chemFor(key) : null)]),
    ["hist", F.histFigure([12, 14, 18, 22, 25, 25, 31, 40, 55], b, PROV, false)],
    // U2 second half: the analysis columns' XY figures, 2D and TRUE 3D
    ["probe", probeFig(key)], ["probe 3d", probeFig(key, true)], ["probe n80", probeFig(key, false, 80)], ["probe n100", probeFig(key, false, 100)],
    ["scheil", scheilFig(key)], ["scheil 3d", scheilFig(key, true)],
  ];
};
/** figures whose axes MUST factor a power of ten out (the U2 review found no
 *  fixture that did, so the path that writes "(10⁻³ %)" was never checked
 *  against the labels under it) */
const powerFigures = () => [
  ["hud pore 0-0.002 %", F.hudFigure("pore", poreSamples(50), bridge("al"), PROV)],
  ["cooling fast (dT/dt past 10⁴)", coolFig("generic", true, { tk: 1e-6 })],
];
/** a figure label must keep clear of: every series path (segments; dots as
 *  5 px boxes), independent of layout.ts's own test */
const segBox = (x0, y0, x1, y1, b) => {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - b.x0], [dx, b.x1 - x0], [-dy, y0 - b.y0], [dy, b.y1 - y0]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
};
const labelOnData = (lay, t) => lay.panels.some(p => p.series.some(s => s.paths.some(path => {
  if (s.kind === "dots" || path.length === 2) {
    for (let i = 0; i + 1 < path.length; i += 2) if (path[i] + 2.5 > t.box.x0 && path[i] - 2.5 < t.box.x1 && path[i + 1] + 2.5 > t.box.y0 && path[i + 1] - 2.5 < t.box.y1) return true;
    return false;
  }
  for (let i = 0; i + 3 < path.length; i += 2) if (segBox(path[i], path[i + 1], path[i + 2], path[i + 3], t.box)) return true;
  return false;
})));
const SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** a tick label read back as a number: the true minus, "a×10ⁿ" */
const parseTick = s => {
  const t = s.replace(/−/g, "-");
  const m = /^(-?[\d.]+)×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(t);
  if (m) return Number(m[1]) * 10 ** Number([...m[2]].map(c => (c === "⁻" ? "-" : SUPS.indexOf(c))).join(""));
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};
const WINDOWS = [[1440, 900], [1024, 768], [390, 844]];

// ------------------------------------------------------------ PLOT-TICKS
{
  const bad = [];
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // golden cases, d3-array's documented output; exactness is the point of the
  // negative-power branch (0.1 * 3 would be 0.30000000000000004)
  const gold = [
    [[0, 1, 10], [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]],
    [[0, 1, 5], [0, 0.2, 0.4, 0.6, 0.8, 1]],
    [[-0.2, 1.3, 5], [-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1, 1.2]],
    [[0, 1000, 4], [0, 200, 400, 600, 800, 1000]],
    [[577.3, 663.9, 5], [580, 600, 620, 640, 660]],
    [[1, 0, 5], [1, 0.8, 0.6, 0.4, 0.2, 0]],
    [[0.0012, 0.0031, 4], [0.0015, 0.002, 0.0025, 0.003]],
  ];
  for (const [[a, b, n], want] of gold) {
    const got = T.ticks(a, b, n);
    if (!eq(got, want)) bad.push({ case: [a, b, n], got, want });
  }
  // a property sweep: inside the domain, evenly spaced, a 1-2-5 step, a
  // sensible count, and never a label with float noise in it
  let cases = 0;
  const rnd = (() => { let x = 12345; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  for (let k = 0; k < 400; k++) {
    const e = Math.floor(rnd() * 12) - 6;
    const a = (rnd() - 0.5) * Math.pow(10, e + 1), span = rnd() * Math.pow(10, e + 1) + Math.pow(10, e - 2);
    const b = a + span, n = 2 + Math.floor(rnd() * 8);
    const ts = T.ticks(a, b, n);
    cases++;
    if (ts.length < 1 || ts.length > 2.6 * n + 2) { bad.push({ a, b, n, count: ts.length }); continue; }
    if (ts.some(v => v < a - 1e-12 * Math.abs(a) || v > b + 1e-12 * Math.abs(b))) bad.push({ a, b, n, outside: ts });
    if (ts.length > 1) {
      const st = T.tickStep(a, b, n);
      const m = st / Math.pow(10, Math.floor(Math.log10(st) + 1e-9));
      if (![1, 2, 5, 10].some(f => Math.abs(m - f) < 1e-9)) bad.push({ a, b, n, step: st });
      for (let i = 1; i < ts.length; i++) if (Math.abs(ts[i] - ts[i - 1] - st) > 1e-9 * Math.max(1, Math.abs(st))) { bad.push({ a, b, n, uneven: ts }); break; }
      const labels = ts.map(v => T.fmtTick(v, st));
      if (labels.some(l => /\d{7,}|e[+-]/.test(l)) || new Set(labels).size !== labels.length) bad.push({ a, b, n, labels });
    }
  }
  const fmt = {
    minus: T.fmtTick(-0.5, 0.25) === "−0.50",
    step1: T.fmtTick(3, 1) === "3",
    sci: T.fmtTick(25000, 5000) === "2.5×10⁴",
    zero: T.fmtTick(1e-17, 0.1) === "0",
    power: T.axisPower([0, 1000, 20000]) === 3 && T.axisPower([0, 0.5, 1]) === 0 && T.axisPower([0.001, 0.002]) === -3,
    title: L.titleWithPower("dT/dt (K·s⁻¹)", 3) === "dT/dt (10³ K·s⁻¹)"
      && L.titleWithPower("T̃ (dimensionless)", -3) === "T̃ (×10⁻³, dimensionless)",
    // a data table's column: counts as integers, one decimal count per
    // column, least-squares noise as zero, the true minus
    column: T.columnFormat([1, 8, 95])(8) === "8" && T.columnFormat([7.5, 8, 12.5])(8) === "8.0"
      && T.columnFormat([3.17e-14, -4972, 12.3456])(3.17e-14) === "0.0" && T.columnFormat([3.17e-14, -4972, 12.3456])(-4972) === "−4972.0",
    parse: parseTick("2.5×10⁴") === 25000 && parseTick("−0.50") === -0.5 && parseTick("5×10⁻⁴") === 5e-4,
  };
  const fmtBad = Object.entries(fmt).filter(([, v]) => !v).map(([k]) => k);
  check("PLOT-TICKS", bad.length === 0 && fmtBad.length === 0 && cases === 400,
    { gold: gold.length, sweep: cases, bad: bad.slice(0, 4), nBad: bad.length, fmtBad });
}

// ------------------------------------------------------------ PLOT-LAYOUT
{
  const bad = [];
  let pointsChecked = 0, ticksSeen = 0, labelsSeen = 0, layouts = 0, labelsRead = 0, poweredPanels = 0, poweredAxes = 0;
  let expectPoints = 0, expectBars = 0, barsChecked = 0, cardsChecked = 0;
  const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const inCanvas = (b, w, h) => b.x0 >= -0.5 && b.y0 >= -0.5 && b.x1 <= w + 0.5 && b.y1 <= h + 0.5;
  const figs = [...allFigures("al"), ...allFigures("generic"), ...powerFigures(), ["cooling quant", coolFig("al", true, { quant: true })]];
  // each figure at the sizes it is shown at (a default size is a test
  // condition): the run report's inline figure at the report's width (400px
  // panel, 368 inside it; 343 on a 390 phone, 92vw) and its 320px height
  // (app/index.html .rplot); every enlarged figure at the modal's size for a
  // desktop, a laptop and a phone window; the print figure at its own size
  // (U2 second half) the probe and Scheil figures also at their size in the
  // analysis column (analyze.ts, analyze3d.ts: 252 x 168)
  const modal = f => [...WINDOWS.map(([vw, vh]) => L.modalPlotSize(f.fig, vw, vh)), L.printSize(f.fig)];
  const sizesOf = (name, f) => name === "cooling report"
    ? [[368, 320], [343, 320]]
    : /^(probe|scheil)/.test(name) ? [[252, 168], ...modal(f)] : modal(f);
  /** every tick's label, read back and multiplied by its axis's factored
   *  power, is its value: a label written without dividing by 10^power (a
   *  0.002 % series labelled 5×10⁻⁴ under "(10⁻³ %)") is a 1000x misreading */
  const readBack = (tag, ticks, power, title) => {
    const st = ticks.length > 1 ? Math.abs(ticks[1].v - ticks[0].v) : 1;
    for (const t of ticks) {
      labelsRead++;
      const got = parseTick(t.label) * 10 ** power;
      if (!(Math.abs(got - t.v) <= 1e-7 * Math.max(Math.abs(t.v), st))) bad.push({ tag, tick: t.v, label: t.label, power });
    }
    if (power && !L.plain(title).includes(T.pow10Text(power))) bad.push({ tag, power, title });
  };
  for (const [name, f] of figs) {
    for (const [w, h] of sizesOf(name, f)) {
      const lay = L.layoutFigure(f.fig, w, h);
      layouts++;
      const tag = `${name} @${w}x${h}`;
      if (lay.empty) { bad.push({ tag, empty: lay.empty }); continue; }
      for (const t of lay.texts) if (!inCanvas(t.box, w, h)) bad.push({ tag, off: t.text, box: t.box });
      // no two texts overlap (a title on a tick label, a mark label on a
      // ref label, two x tick labels)
      for (let i = 0; i < lay.texts.length; i++) for (let j = i + 1; j < lay.texts.length; j++) {
        const [a, b] = [lay.texts[i], lay.texts[j]];
        if (meets(a.box, b.box)) bad.push({ tag, overlap: [a.text, b.text] });
      }
      // no label on a trace: a reference line's or a landmark's label that a
      // series path crosses (the probe's liquidus label under its latest
      // samples, the report's T_S on its descending curve)
      for (const t of lay.texts.filter(q => q.role === "label")) if (labelOnData(lay, t)) bad.push({ tag, labelOnTrace: t.text, knock: !!t.knock });
      readBack(tag, lay.x.ticks, lay.x.power, lay.x.title);
      if (lay.x.power) poweredAxes++;
      const x0 = lay.panels[0].rect.x0, x1 = lay.panels[0].rect.x1;
      lay.panels.forEach((p, i) => {
        readBack(`${tag} y${i}`, p.y.ticks, p.y.power, p.y.title);
        if (p.y.power) poweredPanels++;
        if (p.rect.x0 !== x0 || p.rect.x1 !== x1) bad.push({ tag, panel: i, notShared: p.rect });
        if (i && p.rect.y0 < lay.panels[i - 1].rect.y1) bad.push({ tag, panel: i, stackedOverlap: true });
        if (!(p.rect.y1 - p.rect.y0 > 20)) bad.push({ tag, panel: i, tooShort: p.rect });
        // y tick labels sit left of the plot, x tick labels under the bottom panel
        for (const t of p.y.ticks) {
          ticksSeen++;
          if (t.px < p.rect.y0 - 0.5 || t.px > p.rect.y1 + 0.5) bad.push({ tag, yTickOutside: t });
        }
        // a plotted point re-derived from its own axis: the two y ticks and
        // two x ticks nearest the point give the scale, independently of the
        // layout's own map
        const s = f.fig.panels[i].series.find(q => q.xs.filter(Number.isFinite).length > 3);
        if (s && p.y.ticks.length >= 2 && lay.x.ticks.length >= 2) {
          const k = s.xs.findIndex((x, j) => j > s.xs.length / 3 && Number.isFinite(x) && Number.isFinite(s.ys[j]));
          if (k >= 0) {
            const [ya, yb] = p.y.ticks, [xa, xb] = lay.x.ticks;
            const py = ya.px + ((s.ys[k] - ya.v) / (yb.v - ya.v)) * (yb.px - ya.px);
            const px = xa.px + ((s.xs[k] - xa.v) / (xb.v - xa.v)) * (xb.px - xa.px);
            const path = p.series.find(q => q.key === s.key).paths.flat();
            let hit = false;
            for (let j = 0; j + 1 < path.length; j += 2) if (Math.abs(path[j] - px) < 0.01 && Math.abs(path[j + 1] - py) < 0.01) hit = true;
            pointsChecked++;
            if (!hit) bad.push({ tag, rederived: [px, py], point: [s.xs[k], s.ys[k]] });
          }
        }
        if (s) expectPoints++;
        if (s && !(p.y.ticks.length >= 2 && lay.x.ticks.length >= 2)) bad.push({ tag, panel: i, tooFewTicks: [p.y.ticks.length, lay.x.ticks.length] });
        // a histogram's bar re-derived the same way: its left edge and its top
        const bs = f.fig.panels[i].bars;
        if (bs && p.bars.length) {
          expectBars++;
          const k = bs.counts.findIndex(c => c > 0);
          const [ya, yb] = p.y.ticks, [xa, xb] = lay.x.ticks;
          const bx = xa.px + ((bs.edges[k] - xa.v) / (xb.v - xa.v)) * (xb.px - xa.px) + 1;
          const by = ya.px + ((bs.counts[k] - ya.v) / (yb.v - ya.v)) * (yb.px - ya.px);
          const box = p.bars.find(q => Math.abs(q.box.x0 - bx) < 0.01);
          if (box && Math.abs(box.box.y0 - by) < 0.01) barsChecked++;
          else bad.push({ tag, bar: k, rederived: [bx, by], got: p.bars[0]?.box });
        }
        for (const m of p.marks) if (m.x < p.rect.x0 - 0.5 || m.x > p.rect.x1 + 0.5 || m.y < p.rect.y0 - 0.5 || m.y > p.rect.y1 + 0.5) bad.push({ tag, markOutside: m });
      });
      const yb = lay.panels[lay.panels.length - 1].rect.y1;
      for (const t of lay.texts.filter(q => q.role === "tick" && q.align === "center")) if (t.box.y0 < yb) bad.push({ tag, xLabelAbovePlot: t.text });
      for (const t of lay.texts.filter(q => q.role === "tick" && q.align === "right")) if (t.box.x1 > x0 + 0.5) bad.push({ tag, yLabelInPlot: t.text });
      labelsSeen += lay.texts.filter(q => q.role === "label").length;
    }
    // the enlarged view's card holds the plot, its header, exports and table
    // inside the window at each size (it scrolled at 1024x768, the table under
    // the fold)
    for (const [vw, vh] of WINDOWS) {
      cardsChecked++;
      const [, ph] = L.modalPlotSize(f.fig, vw, vh);
      if (ph + L.MODAL_CHROME > vh - 32 && ph > 220) bad.push({ name, window: [vw, vh], plot: ph, chrome: L.MODAL_CHROME });
    }
  }
  // the fallback: a label with no spot clear of the data is drawn on a
  // backing (knock), never left under a trace
  const zig = { x: { title: "t (s)", lo: 0, hi: 1 }, panels: [{ y: { title: "T (°C)", lo: 0, hi: 1 },
    series: [{ key: "z", slot: 0, xs: Array.from({ length: 401 }, (_, i) => i / 400), ys: Array.from({ length: 401 }, (_, i) => (i % 2 ? 1 : 0)) }],
    refs: [{ y: 0.5, label: "T_{m}" }] }] };
  const zl = L.layoutFigure(zig, 300, 200).texts.find(t => t.role === "label");
  const knockOk = !!zl && zl.knock === true;
  // the empty state: a figure with nothing to draw is its message, alone
  const empty = L.layoutFigure({ x: { title: "t (s)", lo: 0, hi: 1 }, panels: [{ y: { title: "T (°C)", lo: 0, hi: 1 }, series: [] }] }, 300, 200);
  const emptyOk = empty.empty === "no data yet" && empty.texts.length === 1 && empty.panels.length === 0;
  // liveness: real layouts, real ticks, the landmark and liquidus labels placed
  // every panel with a series had a point re-derived (and every histogram a
  // bar), and there were many of them; at least two panels and one x axis
  // factored a power of ten out and read back (today 7 and 6)
  check("PLOT-LAYOUT", bad.length === 0 && emptyOk && knockOk && layouts >= 100 && pointsChecked === expectPoints && expectPoints >= 60
    && barsChecked === expectBars && expectBars >= 8 && ticksSeen >= 300 && labelsSeen >= 40 && labelsRead >= 1000
    && poweredPanels >= 2 && poweredAxes >= 1 && cardsChecked >= 60,
    { layouts, pointsChecked, expectPoints, barsChecked, ticksSeen, labelsSeen, labelsRead, poweredPanels, poweredAxes, cardsChecked,
      emptyOk, knockOk, bad: bad.slice(0, 5), nBad: bad.length });
}

// ------------------------------------------------------------ PLOT-UNIT-TITLES
{
  const bad = [];
  const UNIT = /\(([^()]*)\)$/;
  // the WHOLE unit, anchored: an SI unit (a factored power allowed) with the
  // clock's anchor named in full or in the small panel's one word, or the
  // word dimensionless (T_m = 1 allowed); nothing else, so "K, dimensionless"
  // or "furlongs dimensionless" fails
  // (read through plain(): T_{m} is "Tm" there)
  const OKUNIT = /^(?:(?:10\S+ |×10\S+, )?(?:°C|K|K·s⁻¹|µs|ms|s|min|h|%|count|µm)(?:, (?:solute|heat)(?:-diffusion)? anchor)?|(?:×10\S+, )?dimensionless(?:, Tm = 1)?)$/;
  let titles = 0, timeAxes = 0;
  const seen = {};
  const cases = [["generic", bridge], ["al", bridge], ["ice", bridge], ["qc", bridge], ["al", bridgeQ]];
  for (const [key, bfn] of cases) {
    const b = bfn(key);
    const figs = bfn === bridgeQ ? [["cooling quant", coolFig(key, true, { quant: true })]] : allFigures(key);
    const texts = [];
    for (const [name, f] of figs) {
      const sizes = [[343, 280], [880, 460], ...(/^(probe|scheil)/.test(name) ? [[252, 168]] : [])];
      for (const [w, h] of sizes) {
        const lay = L.layoutFigure(f.fig, w, h);
        const ts = [lay.x.title, ...lay.panels.map(p => p.y.title)];
        for (const t of ts) {
          titles++;
          const m = L.plain(t).match(UNIT);
          if (!m || !OKUNIT.test(m[1])) bad.push({ key, name, title: t });
        }
        // every time axis of a real material names its clock's anchor, per
        // figure and at every size (a 252 px panel falls back to the short
        // form, and the anchor used to go with the long one)
        if (b.known && /^Time t /.test(f.fig.x.title)) {
          timeAxes++;
          const want = w >= 800 ? /, (?:solute|heat)-diffusion anchor\)$/ : /, (?:solute|heat)(?:-diffusion)? anchor\)$/;
          if (!want.test(L.plain(lay.x.title))) bad.push({ key, name, size: [w, h], timeTitle: lay.x.title });
        }
        texts.push(...lay.texts.map(q => q.text));
      }
      for (const p of f.fig.panels) for (const s of p.series) texts.push(s.unit ?? "");
      texts.push(f.fig.x.unit ?? "", ...Qm.outColumns(f.columns, f.bridge).map(c => c.head + " " + c.key));
      seen[key] ??= [];
      seen[key].push(...f.fig.panels.map(p => p.y.title));
    }
    const all = texts.join(" | ");
    if (!b.known) {
      // a material with no SI identity: no SI unit of temperature or time
      // anywhere the reader can see or the CSV writes
      const leak = all.match(/°C|\((?:K|µs|ms|s|min|h)[,)]|K·s|(?<![A-Za-z])(?:ms|µs|min)(?![A-Za-z])|_(?:C|s|K)\b/u);
      if (leak) bad.push({ key, leak: leak[0] });
      if (!all.includes("T̃ (dimensionless, T_{m} = 1)")) bad.push({ key, missing: "T̃ (dimensionless, T_m = 1)" });
    } else {
      if (!/Temperature T \(°C\)/.test(all)) bad.push({ key, missing: "Temperature T (°C)" });
      const anchor = key === "al" ? "solute-diffusion anchor" : "heat-diffusion anchor";
      if (!all.includes(anchor)) bad.push({ key, missing: anchor });
      // the plotted value IS the bridge's conversion (not a second formula)
      const quant = bfn === bridgeQ;
      const f = coolFig(key, false, { quant });
      const s = f.fig.panels[0].series[0];
      const u = quant ? unitsQuant(key) : unitsFor(key);
      const srcRec = castRecord(F.chargeLiquidus(quant ? chemQ(key) : chemFor(key)));
      if (Math.abs(s.ys[10] - u.celsius(srcRec[10].T)) > 1e-9) bad.push({ key, conv: [s.ys[10], u.celsius(srcRec[10].T)] });
    }
  }
  check("PLOT-UNIT-TITLES", bad.length === 0 && titles >= 150 && timeAxes >= 40 && M.MATERIALS.generic.si == null,
    { titles, timeAxes, bad: bad.slice(0, 6), nBad: bad.length, sample: { generic: seen.generic?.[0], al: seen.al?.[0] } });
}

// ------------------------------------------------------------ PLOT-CSV
{
  const bad = [];
  const parse = text => {
    const lines = text.trimEnd().split("\n");
    const head = lines.filter(l => l.startsWith("# ")).map(l => l.slice(2));
    const rows = lines.filter(l => !l.startsWith("#"));
    return { head, keys: rows[0].split(","), data: rows.slice(1).map(r => r.split(",")) };
  };
  // a real alloy: both columns, the bridge's own numbers in the header, the
  // run's identity (solver, share link, build) and the chemistry
  const al = coolFig("al", true);
  const u = al.bridge.units;
  const prov = { ...al.prov, recorded: 1000 };
  const a = parse(C.toCSV(al.title, al.columns, al.bridge, prov));
  const need = [
    `material: ${M.MATERIALS.al.label}`, "seed: 1337c0de", "grid: 1024² cells (2D)",
    `solver: ${PROV.solver}`, `share: ${PROV.share}`, `build: ${PROV.build}`,
    `T_m = ${Number(u.meltC.toPrecision(6))} °C`, `ΔT_ref = ${Number(u.scale.kelvinPerUnit.toPrecision(6))} K per unit (forced by latent heat)`,
    `τ = ${Number(u.scale.secondsPerUnit.toPrecision(6))} s per unit (forced by solute diffusion; solute-diffusion anchor`,
    `chemistry (the solver's, dimensionless): solute field on, m̃ = ${M.MATERIALS.al.params.mLiq}, c̃₀ = ${M.MATERIALS.al.params.c0} (${M.MATERIALS.al.params.c0 * WT} wt%), k = ${M.MATERIALS.al.params.kPart}`,
    `rows: ${al.columns[0].values.length} (decimated from 1000 samples)`,
  ];
  for (const n of need) if (!a.head.some(h => h.includes(n))) bad.push({ missing: n });
  for (const k of ["t_dimensionless", "t_s", "T_dimensionless", "T_C", "dTdt_dimensionless", "dTdt_K_per_s", "fs_measured", "fs_measured_rescaled", "fs_zero_curve"])
    if (!a.keys.includes(k)) bad.push({ missingColumn: k });
  if (a.data.length !== al.columns[0].values.length) bad.push({ rows: a.data.length, want: al.columns[0].values.length });
  const ix = k => a.keys.indexOf(k);
  let conv = 0;
  for (const r of a.data) {
    const td = r[ix("T_dimensionless")], tc = r[ix("T_C")];
    if (td === "" ? tc !== "" : Math.abs(Number(tc) - u.celsius(Number(td))) > 1e-5 * Math.max(1, Math.abs(Number(tc)))) { bad.push({ row: r }); break; }
    const ts = Number(r[ix("t_s")]), tdim = Number(r[ix("t_dimensionless")]);
    if (Math.abs(ts - u.seconds(tdim)) > 1e-6 * Math.max(1e-12, Math.abs(ts))) { bad.push({ tRow: r }); break; }
    if (td !== "") conv++;
  }
  // no SI identity: the dimensionless columns only, and the header says why
  const gen = coolFig("generic", true);
  const g = parse(C.toCSV(gen.title, gen.columns, gen.bridge, gen.prov));
  if (g.keys.some(k => /_(C|s|K|K_per_s)$/.test(k))) bad.push({ genericSI: g.keys });
  if (!g.head.some(h => h.startsWith("unit bridge: none"))) bad.push({ generic: "no 'unit bridge: none' line" });
  if (g.head.some(h => /decimated/.test(h))) bad.push({ generic: "claims decimation it did not do" });
  // the calibrated alloy solver: T̃ = 1 is the nominal alloy's liquidus, and
  // the bridge line says so with its number (T_m + m_L·c₀,wt, derived here)
  const qf = coolFig("al", false, { quant: true });
  const si = M.MATERIALS.al.si;
  const tl = si.Tm - U.K0 + si.mL * M.MATERIALS.al.params.c0 * WT;
  const qh = parse(C.toCSV(qf.title, qf.columns, qf.bridge, qf.prov)).head;
  if (!qh.some(h => h.includes(`T̃ = 1 is T_liq(c0) = ${Number(tl.toPrecision(6))} °C`))) bad.push({ quantBridge: qh.find(h => h.startsWith("unit bridge")) });
  // every figure's CSV: one key per output column, each a clean ASCII stem
  // with no unit suffix doubled ("fs_percent_percent" was the HUD's)
  let figsKeyed = 0;
  for (const key of ["al", "generic"]) for (const [name, f] of allFigures(key)) {
    const out = Qm.outColumns(f.columns, f.bridge);
    const p = parse(C.toCSV(f.title, f.columns, f.bridge, f.prov));
    figsKeyed++;
    if (p.keys.length !== out.length) bad.push({ key, name, keys: p.keys.length, cols: out.length });
    for (const k of p.keys) if (!/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/.test(k) || /(_[A-Za-z0-9]+)\1$/.test(k)) bad.push({ key, name, badKey: k });
  }
  // a histogram's rows are bins, not samples: nothing was decimated, even
  // when the caller's provenance carried a series' sample count
  const hf = F.histFigure([12, 14, 18, 22, 25, 25, 31, 40, 55], bridge("al"), { ...PROV, recorded: 530 }, false);
  if (/decimated/.test(C.toCSV(hf.title, hf.columns, hf.bridge, hf.prov))) bad.push("the histogram claims decimation");
  // the table's time column is in the unit its axis uses (ms for ice's
  // probe), the CSV's in base seconds
  const ice = probeFig("ice");
  const tab = C.figureTable(ice);
  const ti = tab.head.findIndex(h => /^t \(/.test(h));
  const tsec = ice.bridge.units.seconds(ice.columns[0].values[5]);
  if (ice.fig.x.unit !== "ms" || tab.head[ti] !== "t (ms)" || Math.abs(Number(tab.rows[5][ti].replace("−", "-")) - tsec * 1e3) > 1e-3 * Math.abs(tsec * 1e3))
    bad.push({ tableTime: tab.head[ti], axis: ice.fig.x.unit, row: tab.rows[5][ti], want: tsec * 1e3 });
  // the export's file name keeps the family, the melt and the minute
  const at = new Date(2026, 8, 25, 2, 45);
  const stems = [C.fileStem("Pole figure ⟨100⟩", "aluminum · Al–Cu", at), C.fileStem("Pole figure [001]", "ice", at), C.fileStem("Pole figure (0001)", "magnesium", at)];
  if (stems.join() !== "solidify-pole-figure-100-family-aluminum-al-cu-20260925-0245,solidify-pole-figure-001-axis-ice-20260925-0245,solidify-pole-figure-0001-basal-magnesium-20260925-0245")
    bad.push({ stems });
  check("PLOT-CSV", bad.length === 0 && conv >= 200 && a.head.length >= 12 && figsKeyed >= 20,
    { headLines: a.head.length, columns: a.keys, rowsConverted: conv, figsKeyed, bad: bad.slice(0, 6), nBad: bad.length });
}

// ------------------------------------------------------------ PLOT-LIQUIDUS
{
  const bad = [];
  const rows = [];
  const K0 = U.K0;
  for (const [key, quant] of [["al", false], ["steel", false], ["ice", false], ["generic", false], ["al", true]]) {
    const mat = M.MATERIALS[key], p = mat.params, si = mat.si;
    const alloy = (p.alloyOn ?? 0) === 1;
    // derived here from the kernel's rule, not read back: Kobayashi's
    // T_eq = 1 − m·c at c₀, the calibrated kernel's T̃ = 1 (its reference
    // state IS the nominal alloy's liquidus), a pure melt's T_m = 1
    const want = quant ? 1 : alloy ? 1 - p.mLiq * p.c0 : 1;
    const chem = quant ? chemQ(key) : chemFor(key);
    const got = F.chargeLiquidus(chem);
    const u = quant ? unitsQuant(key) : unitsFor(key);
    const wantDrawn = u.known ? u.celsius(want) : want;
    // the material's own liquidus, and whether the solver's is it
    const matC = si ? si.Tm - K0 + (alloy ? si.mL * p.c0 * WT : 0) : null;
    const off = matC != null ? Math.abs(wantDrawn - matC) : 0;
    const wantLabel = !alloy ? "T_{m}" : off > 1 ? "T_{liq}(c_{0}), model" : "T_{liq}(c_{0})";
    for (const [fname, f] of [["cooling", coolFig(key, false, { quant })], ["probe", AN.probeFigure({ samples: probeRec(got), bridge: quant ? bridgeQ(key) : bridge(key), chem, three: false, prov: PROV })]]) {
      const ref = f.fig.panels[0].refs[0];
      const lay = L.layoutFigure(f.fig, 343, 280);
      const [, py] = L.toPx(lay, 0, 0, wantDrawn);
      if (Math.abs(got - want) > 1e-12 || Math.abs(ref.y - wantDrawn) > 1e-9 || Math.abs(lay.panels[0].refs[0].y0 - py) > 1e-6) bad.push({ key, quant, fname, got, want, drawn: ref.y, wantDrawn });
      if (ref.label !== wantLabel) bad.push({ key, quant, fname, label: ref.label, wantLabel });
      // the provenance prints the solver's liquidus and, for a real material,
      // the material's own, with the gap named when it is over a kelvin
      const head = C.provLines(f.title, f.bridge, f.prov, 1).join("\n");
      if (!head.includes("liquidus of the charge, the solver's:")) bad.push({ key, fname, prov: "no solver liquidus line" });
      if (matC != null) {
        if (!head.includes(`the material's: ${matC.toFixed(1)} °C`)) bad.push({ key, quant, fname, prov: "no material liquidus", matC });
        if (off > 1 && !head.includes(`sits ${off.toFixed(1)} K`)) bad.push({ key, fname, prov: "gap not named", off });
      }
    }
    rows.push({ key, quant, liquidus: +want.toFixed(4), drawn: +wantDrawn.toFixed(2), material: matC == null ? null : +matC.toFixed(2), label: wantLabel });
  }
  // liveness: the Kobayashi Al–Cu line is not T̃ = 1 and not the alloy's own
  // (the "model" case); the calibrated one IS the alloy's own liquidus
  const kob = rows.find(r => r.key === "al" && !r.quant), qr = rows.find(r => r.key === "al" && r.quant);
  check("PLOT-LIQUIDUS", bad.length === 0 && kob.liquidus < 0.99 && kob.label.endsWith("model") && qr.liquidus === 1 && Math.abs(qr.drawn - qr.material) < 0.01,
    { rows, bad: bad.slice(0, 6), nBad: bad.length });
}

// ------------------------------------------------------------ PLOT-HUD-GAP
{
  const bad = [];
  if (!Number.isNaN(F.hudDeltaT(0, 0, 0.85))) bad.push("no interface is not NaN");
  if (Math.abs(F.hudDeltaT(120, 0.8, 0.85) - 0.05) > 1e-12) bad.push("interface undercooling not T_liq − T_i");
  const b = bridge("generic");
  const s = hudSamples(180);
  // the latest sample has no interface: the card prints the empty glyph
  const m = F.hudSpark("dt", s, b);
  if (m.value !== "—") bad.push({ value: m.value });
  const sp = L.layoutSpark(m.xs, m.ys, m.lo, m.hi, 150, 24, 2);
  // one path of exactly the 130 samples with an interface (20..149): the 50
  // without one are not drawn at all (before U2 each was 1 − 0 = 1, the
  // strip's maximum)
  if (sp.paths.length !== 1 || sp.paths[0].length !== 2 * 130) bad.push({ paths: sp.paths.map(p => p.length / 2) });
  // a gap in the middle splits the line in two
  const mid = s.map((p, i) => (i === 80 ? { ...p, dt: NaN } : p));
  const m2 = F.hudSpark("dt", mid, b);
  if (L.layoutSpark(m2.xs, m2.ys, m2.lo, m2.hi, 150, 24).paths.length !== 2) bad.push("a middle gap did not split the line");
  // the full plot carries the gap too: a split path, empty CSV cells
  const f = F.hudFigure("dt", s, b, PROV);
  const lay = L.layoutFigure(f.fig, 600, 300);
  const csv = C.toCSV(f.title, f.columns, f.bridge, f.prov).split("\n").filter(l => l && !l.startsWith("#"));
  const emptyCells = csv.slice(1).filter(l => l.endsWith(",")).length;
  if (lay.panels[0].series[0].paths.length !== 1 || emptyCells !== 50) bad.push({ fullPaths: lay.panels[0].series[0].paths.length, emptyCells });
  // the range printed is the finite data's, and zero is in it
  if (!(m.lo <= 0 && Math.abs(m.hi - Math.max(...s.map(q => q.dt).filter(Number.isFinite))) < 1e-12)) bad.push({ lo: m.lo, hi: m.hi });
  // the hover readout reports nothing in a gap or off the series' end, and
  // the sample under the cursor inside it
  const ser = f.fig.panels[0].series[0];
  const at = x => V.sampleAt(ser.xs, ser.ys, x);
  const inGap = at(ser.xs[5]), offEnd = at(ser.xs[170]), inside = at((ser.xs[60] + ser.xs[61]) / 2);
  if (inGap !== -1 || offEnd !== -1 || !(inside === 60 || inside === 61)) bad.push({ readout: { inGap, offEnd, inside } });
  // for an alloy the card measures from the NOMINAL liquidus, and says so:
  // it is not titled an undercooling, and its provenance names the Scheil
  // shift of the enriched interface liquid
  const fa = F.hudFigure("dt", s, bridge("al"), PROV, chemFor("al"));
  const ha = C.provLines(fa.title, fa.bridge, fa.prov, 1).join("\n");
  if (/undercooling/i.test(fa.title + fa.fig.panels[0].y.title) || !/T_\{liq\}\(c_\{0\}\) − T_\{i\}/.test(fa.fig.panels[0].y.title) || !/Scheil path/.test(ha)) bad.push({ alloyTitle: fa.title, y: fa.fig.panels[0].y.title });
  const fp = F.hudFigure("dt", s, bridge("ice"), PROV, chemFor("ice"));
  if (!/Interface undercooling/.test(fp.fig.panels[0].y.title)) bad.push({ pureTitle: fp.fig.panels[0].y.title });
  check("PLOT-HUD-GAP", bad.length === 0, { value: m.value, range: m.range, bad });
}

// ------------------------------------------------------------ PLOT-HUD-RECORD
{
  const bad = [];
  const r = new F.HudRecord(8);
  const smp = t => ({ t, fs: 0, dt: 0, grains: 0, pore: 0 });
  const kept = [0, 1, 1, 1, 2, 2, 3].map(t => r.add(smp(t), "A"));
  // a pause: the poll keeps landing at one sim time, only the first is kept
  if (kept.join() !== "true,true,false,false,true,false,true" || r.samples.length !== 4) bad.push({ kept, n: r.samples.length });
  // time going backwards (a reset solver) starts over
  r.add(smp(0.5), "A");
  if (r.samples.length !== 1 || r.recorded !== 1) bad.push({ afterReset: r.samples.length });
  // a new unit bridge starts over
  r.add(smp(0.6), "A");
  r.add(smp(0.7), "B");
  if (r.samples.length !== 1 || r.sig !== "B") bad.push({ afterBridge: r.samples.length, sig: r.sig });
  // past the cap: halved, the first and the latest kept, the count says so
  for (let t = 1; t <= 20; t++) r.add(smp(t), "B");
  const ts = r.samples.map(p => p.t);
  if (r.samples.length > 8 || ts[0] !== 0.7 || ts[ts.length - 1] !== 20 || r.recorded !== 21) bad.push({ ts, recorded: r.recorded });
  // the HUD's record latches the chemistry with the bridge: the same bridge
  // and a new c₀ is a new series (its ΔT is against another liquidus)
  const h = new F.HudRecord(100), bb = bridge("al");
  h.push(smp(1), bb, chemFor("al"));
  h.push(smp(2), bb, chemFor("al"));
  h.push(smp(3), bb, chemFor("al", { c0: 0.36 }));
  if (h.samples.length !== 1 || h.chem.c0 !== 0.36 || h.bridge !== bb) bad.push({ chemLatch: h.samples.length });
  check("PLOT-HUD-RECORD", bad.length === 0, { bad });
}

// ------------------------------------------------------------ PLOT-CONTRAST
{
  const css = readFileSync(new URL("../src/design/tokens.css", import.meta.url), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const tok = {};
  for (const m of root.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tok[m[1]] = m[2].trim();
  const rgb = v => {
    let m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
    m = /^rgba?\(([^)]+)\)$/.exec(v);
    if (m) { const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).map(Number); return [r, g, b, a]; }
    return null;
  };
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
  const bad = [], rows = [];
  // screen: the modal card, the page, and a panel over the live canvas at its
  // worst (the overlay composited over a white pixel) and its best (black)
  const surfaces = {};
  for (const s of TH.SCREEN_SURFACES) {
    const c = rgb(tok[s]);
    if (!c) { bad.push({ unreadable: s }); continue; }
    if (c[3] < 1) { surfaces[`${s} over white`] = over(c, [255, 255, 255]); surfaces[`${s} over black`] = over(c, [0, 0, 0]); }
    else surfaces[s] = c;
  }
  const CHROME = ["tick", "title", "axis", "ref", "mark", "markLabel", "readoutText", "readoutValue"];
  for (const role of CHROME) {
    const c = rgb(tok[TH.SCREEN[role]]);
    for (const [sn, sc] of Object.entries(surfaces)) {
      const r = c ? ratio(c, sc) : 0;
      rows.push({ role, on: sn, r: +r.toFixed(2) });
      if (r < 4.5) bad.push({ screen: role, token: TH.SCREEN[role], on: sn, r: +r.toFixed(2) });
    }
  }
  // the readout box is its own surface
  for (const role of ["readoutText", "readoutValue"]) {
    const r = ratio(rgb(tok[TH.SCREEN[role]]), rgb(tok[TH.SCREEN.readoutBg]));
    if (r < 4.5) bad.push({ readout: role, r });
  }
  // the data slots are design/plot.ts's, in its order, on screen and in print
  // (the plot core and the phase diagram's print map spelled them out)
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!same(TH.SCREEN.data, DP.SLOTS) || !same(TH.PRINT.data, DP.PRINT_SLOTS)) bad.push({ slots: { screen: TH.SCREEN.data, print: TH.PRINT.data, design: DP.SLOTS } });
  if (!/SLOTS\.map\(/.test(src("phasediagram.ts")) || /\["--data-1", "--print-data-1"\]/.test(src("phasediagram.ts"))) bad.push("the phase diagram's print map spells its slots");
  // data marks: 3:1 against every surface a figure sits on (graphics, WCAG
  // 1.4.11), the rose's translucent wedges composited at their alpha
  const paper = rgb(tok[TH.PRINT.bg]);
  for (const d of TH.SCREEN.data) {
    const c = rgb(tok[d]);
    for (const [sn, sc] of Object.entries(surfaces)) {
      const r = ratio(c, sc), rw = ratio(over([...c.slice(0, 3), PT.WEDGE_ALPHA], sc), sc);
      rows.push({ data: d, on: sn, r: +r.toFixed(2), wedge: +rw.toFixed(2) });
      if (r < 3 || rw < 3) bad.push({ data: d, on: sn, r: +r.toFixed(2), wedge: +rw.toFixed(2) });
    }
  }
  // print: every chrome role and every data slot on the paper
  for (const role of CHROME) {
    const c = rgb(tok[TH.PRINT[role]]);
    const r = c && paper ? ratio(c, paper) : 0;
    rows.push({ print: role, r: +r.toFixed(2) });
    if (r < 4.5) bad.push({ print: role, token: TH.PRINT[role], r: +r.toFixed(2) });
  }
  for (const d of TH.PRINT.data) {
    const c = rgb(tok[d]);
    const r = c && paper ? ratio(c, paper) : 0, rw = c && paper ? ratio(over([...c.slice(0, 3), PT.WEDGE_ALPHA], paper), paper) : 0;
    rows.push({ printData: d, r: +r.toFixed(2), wedge: +rw.toFixed(2) });
    if (r < 3 || rw < 3) bad.push({ printData: d, r: +r.toFixed(2), wedge: +rw.toFixed(2) });
  }
  // the poles are drawn opaque (a pole is the figure's only data; at 0.6
  // alpha it sat at 2.6:1), ringed in the background to keep overlaps apart
  const paintSrc = src("plot/paint.ts");
  const polar = paintSrc.slice(paintSrc.indexOf("export function paintPolar"), paintSrc.indexOf("export interface ReadoutLine"));
  const poleBlock = polar.slice(polar.indexOf("ctx.globalAlpha = 1;"), polar.indexOf("// the radial scale's rings"));
  if (!/for \(const p of L\.points\)/.test(poleBlock) || /globalAlpha/.test(poleBlock.slice(20)) || !(PT.POLE_RING > 0)) bad.push("poles translucent");
  // type: the plot spec's 11 px floor, 12 for titles (DESIGN.md 3)
  const small = Object.entries(L.FONT).filter(([k, v]) => v < 11 || (k === "title" && v < 12));
  // liveness: 60 rows today (8 chrome roles and 4 slots on 4 screen
  // surfaces, and all 12 on the paper)
  check("PLOT-CONTRAST", bad.length === 0 && small.length === 0 && rows.length >= 60 && Object.keys(surfaces).length >= 4,
    { surfaces: Object.keys(surfaces), rows: rows.length, worst: rows.sort((a, b) => a.r - b.r).slice(0, 3), small, bad: bad.slice(0, 6) });
}

// ------------------------------------------------------------ PLOT-SCHEIL
{
  const bad = [];
  let points = 0;
  for (const [key, quant] of [["al", false], ["generic", false], ["al", true]]) {
    const chem = quant ? chemQ(key) : scheilChem(key), b = quant ? bridgeQ(key) : bridge(key), u = quant ? unitsQuant(key) : unitsFor(key);
    const conv = v => (u.known ? u.celsius(v) : v);
    // Scheil's interface liquid c_l = c₀(1 − f_s)^(k − 1), put on the solver's
    // own temperature axis, derived here: Kobayashi T = 1 − m·c_l; the
    // calibrated kernel T = 1 at c_l = c₀ and 0 at c₀/k, linear between
    const k = chem.kPart;
    const law = fs => quant ? 1 - (k / (1 - k)) * (Math.pow(Math.max(1 - fs, 1e-3), k - 1) - 1) : 1 - chem.mLiq * chem.c0 * Math.pow(Math.max(1 - fs, 1e-3), k - 1);
    const rec = scheilRec(chem);
    const f = AN.scheilFigure({ samples: rec, bridge: b, chem, three: false, prov: PROV });
    const P = f.fig.panels[0];
    const pred = P.series.find(s => s.key === "scheil"), meas = P.series.find(s => s.key === "measured");
    pred.xs.forEach((fs, i) => {
      const want = conv(law(fs));
      if (Math.abs(pred.ys[i] - want) > 1e-9 * Math.max(1, Math.abs(want))) bad.push({ key, quant, pred: i, got: pred.ys[i], want });
    });
    // it starts on the charge's liquidus: the calibrated one at T̃ = 1, the
    // nominal alloy's own (T_m + m_L·c₀,wt)
    if (quant && Math.abs(pred.ys[0] - (M.MATERIALS.al.si.Tm - U.K0 + M.MATERIALS.al.si.mL * M.MATERIALS.al.params.c0 * WT)) > 1e-6) bad.push({ quantStart: pred.ys[0] });
    if (pred.xs[0] !== 0 || Math.abs(pred.xs[pred.xs.length - 1] - 0.98) > 1e-12 || pred.xs.length < 100) bad.push({ key, predRange: [pred.xs[0], pred.xs.at(-1)] });
    // the measured points are the record, through the same bridge
    rec.forEach((p, i) => { points++; if (meas.xs[i] !== p.fs || Math.abs(meas.ys[i] - conv(p.Ti)) > 1e-9 * Math.max(1, Math.abs(conv(p.Ti)))) bad.push({ key, meas: i }); });
    // the table: at each measured f_s, the prediction and the gap to it
    const col = Object.fromEntries(f.columns.map(c => [c.key, c.values]));
    rec.forEach((p, i) => {
      const want = law(p.fs);
      if (Math.abs(col.T_scheil[i] - want) > 1e-12 || Math.abs(col.dT_scheil[i] - (p.Ti - want)) > 1e-12 || col.fs[i] !== p.fs) bad.push({ key, row: i });
    });
    // the axis is the data's: every measured point and the liquidus inside
    // it, and not stretched to where the prediction runs off (the eutectic)
    const liq = conv(F.chargeLiquidus(chem));
    if (!meas.ys.every(v => v >= P.y.lo && v <= P.y.hi) || liq < P.y.lo || liq > P.y.hi) bad.push({ key, axis: [P.y.lo, P.y.hi], liq });
    if (!(pred.ys[pred.ys.length - 1] < P.y.lo)) bad.push({ key, stretched: { end: pred.ys.at(-1), lo: P.y.lo } });
    // a real alloy's axis in °C, the model metal's dimensionless
    if (u.known ? !/\(°C\)$/.test(P.y.title) : !/dimensionless/.test(P.y.title)) bad.push({ key, title: P.y.title });
    // the provenance names the rule for the kernel that ran
    const head = C.provLines(f.title, f.bridge, f.prov, 1).join("\n");
    if (!(quant ? /calibrated solver/ : /Kobayashi kernel/).test(head)) bad.push({ key, quant, rule: "not named" });
  }
  // a melt with no solute field: refused by name, nothing drawn
  const pure = AN.scheilFigure({ samples: [], bridge: bridge("ice"), chem: chemFor("ice"), three: true, prov: PROV });
  const lay = L.layoutFigure(pure.fig, 252, 168);
  if (lay.empty !== "needs the solute field (ALLOY)" || lay.panels.length) bad.push({ pure: lay.empty });
  check("PLOT-SCHEIL", bad.length === 0 && points >= 300, { points, bad: bad.slice(0, 6), nBad: bad.length });
}

// ------------------------------------------------------------ PLOT-SERIES-CAP
{
  const bad = [];
  const b = bridge("al"), b2 = bridge("generic"), ca = chemFor("al");
  // 5000 samples of a long cast: capped, first and latest kept, counted
  const r = new AN.ScheilRecord();
  for (let i = 0; i < 5000; i++) r.push({ t: i * 0.01, fs: i / 5000, Ti: 0.8 }, b, ca);
  const last = r.samples[r.samples.length - 1];
  if (r.samples.length > 900 || r.samples.length < 400 || r.samples[0].t !== 0 || last.t !== 49.99 || r.recorded !== 5000 || r.bridge !== b)
    bad.push({ scheil: { n: r.samples.length, first: r.samples[0].t, last: last.t, recorded: r.recorded } });
  // its export says it was decimated, from how many
  const f = AN.scheilFigure({ samples: r.samples, bridge: r.bridge, chem: r.chem, three: true, prov: { ...PROV, recorded: r.recorded } });
  if (!C.toCSV(f.title, f.columns, f.bridge, f.prov).includes(`rows: ${r.samples.length} (decimated from 5000 samples)`)) bad.push("the export does not say it was decimated");
  // a pause (the poll landing at one sim time) records nothing
  const n0 = r.samples.length;
  r.push({ t: 49.99, fs: 0.5, Ti: 0.8 }, b, ca);
  if (r.samples.length !== n0 || r.recorded !== 5000) bad.push("recorded through a pause");
  // a new unit bridge starts a new series, and it is latched with it
  r.push({ t: 50, fs: 0.5, Ti: 0.8 }, b2, ca);
  if (r.samples.length !== 1 || r.bridge !== b2) bad.push({ newBridge: r.samples.length });
  // the SAME bridge with a new chemistry starts a new series too, latched:
  // the composition dial (c₀), the liquidus slope, the partition k, and the
  // ALLOY switch on a material whose bridge does not change with it
  for (const [what, c1, c2, bb] of [
    ["c0", chemFor("al"), chemFor("al", { c0: 0.36 }), b], ["mLiq", chemFor("al"), chemFor("al", { mLiq: 0.6 }), b],
    ["kPart", chemFor("al"), chemFor("al", { kPart: 0.3 }), b], ["alloy on the model metal", chemFor("generic"), chemFor("generic", { alloyOn: 1 }), b2],
    ["solver", chemFor("al"), chemQ("al"), b],
  ]) {
    const q = new AN.ScheilRecord();
    q.push({ t: 0, fs: 0.1, Ti: 0.8 }, bb, c1); q.push({ t: 1, fs: 0.2, Ti: 0.8 }, bb, c1); q.push({ t: 2, fs: 0.3, Ti: 0.8 }, bb, c2);
    if (q.samples.length !== 1 || q.chem !== c2) bad.push({ chemChange: what, n: q.samples.length });
  }
  const pr = new AN.ProbeRecord();
  for (let i = 0; i < 3000; i++) pr.push({ t: i, T: 1, phi: 0 }, b, ca);
  if (pr.samples.length > 900 || pr.recorded !== 3000 || pr.samples[pr.samples.length - 1].t !== 2999) bad.push({ probe: pr.samples.length });
  // a poll with no probe reading (the reduction's counter still at 0, which
  // decodes to exactly T̃ = −1) is not a sample; a real one is kept as read
  const none = AN.probeSample(0, -1, 0), off = AN.probeSample(0, null, null), real = AN.probeSample(2, 0.7, 0.4);
  if (none !== null || off !== null || !real || real.T !== 0.7 || real.phi !== 0.4 || real.t !== 2) bad.push({ probeSample: { none, off, real } });
  for (const file of ["analyze.ts", "analyze3d.ts"]) {
    const s = src(file);
    // both modules take their probe samples through it
    if (!/probeSample\(simTime, s\.probeT, s\.probePhi\)/.test(s)) bad.push({ file, probeSample: "not used" });
    // both record through these (the 3D Scheil series was a bare array
    // pushed at 4 Hz for the whole session), latching the chemistry, and
    // draw from the latched one; the old ad-hoc arrays and their halving are
    // gone: no `curve` or `scheil` is ever assigned an array literal
    if (!/new ProbeRecord\(\)/.test(s) || !/new ScheilRecord\(\)/.test(s)) bad.push({ file, records: "not constructed" });
    if (!/this\.curve\.push\(pr, b, chem\)/.test(s) || !/this\.scheil\.push\(q, b, chem\)/.test(s)) bad.push({ file, push: "without the chemistry" });
    if (!/chem: this\.curve\.chem \?\? this\.host\.chem\(\)/.test(s) || !/chem: this\.scheil\.chem \?\? this\.host\.chem\(\)/.test(s)) bad.push({ file, figure: "not from the latched chemistry" });
    const adHoc = s.match(/\b(?:curve|scheil)\b[^=\n]*=\s*\[\]|i % 2 === 0/);
    if (adHoc) bad.push({ file, adHoc: adHoc[0] });
  }
  check("PLOT-SERIES-CAP", bad.length === 0, { scheil: n0, recorded: 5000, probe: pr.samples.length, bad });
}

// ------------------------------------------------------------ PLOT-POLAR
{
  const bad = [];
  let layouts = 0, wedges = 0, poles = 0, rims = 0;
  const meets = (a, q) => a.x0 < q.x1 && q.x0 < a.x1 && a.y0 < q.y1 && q.y0 < a.y1;
  const inCanvas = (q, w, h) => q.x0 >= -0.5 && q.y0 >= -0.5 && q.x1 <= w + 0.5 && q.y1 <= h + 0.5;
  const sizes = panel => [panel, ...WINDOWS.map(([vw, vh]) => PO.polarModalSize(vw, vh)), PO.polarPrintSize()];
  const textsOk = (tag, lay) => {
    for (const t of lay.texts) if (!inCanvas(t.box, lay.w, lay.h)) bad.push({ tag, off: t.text });
    for (let i = 0; i < lay.texts.length; i++) for (let k = i + 1; k < lay.texts.length; k++)
      if (meets(lay.texts[i].box, lay.texts[k].box)) bad.push({ tag, overlap: [lay.texts[i].text, lay.texts[k].text] });
  };
  // the enlarged view's card holds the square plot beside its chrome
  for (const [vw, vh] of WINDOWS) { const [, ph] = PO.polarModalSize(vw, vh); if (ph + L.MODAL_CHROME > vh - 32 && ph > 260) bad.push({ polarCard: [vw, vh], plot: ph }); }
  const b = bridge("al");
  const roseData = Array.from({ length: 18 }, (_, i) => 40 + 30 * Math.cos(i / 3) ** 2 + (i === 7 ? 120 : 0));
  for (const j of [4, 6]) {
    const f = AN.roseFigure({ rose: roseData, j, umPerCell: 2, bridge: b, prov: PROV });
    const col = Object.fromEntries(f.columns.map(c => [c.key, c.values]));
    const sum = col.area_fraction.reduce((a, v) => a + v, 0);
    if (Math.abs(sum - 100) > 1e-9) bad.push({ j, sum });
    // angle labels: every period boundary is a tick, and each label is a round
    // number of degrees ("45°", never "45.0°")
    const period = 360 / j;
    for (let k = 0; k < j; k++) if (!f.fig.angles.some(a => Math.abs(a.deg - k * period) < 1e-9)) bad.push({ j, boundary: k * period });
    if (f.fig.angles.some(a => !/^\d+(\.\d+)?°$/.test(a.label) || /\.0+°$/.test(a.label))) bad.push({ j, labels: f.fig.angles.map(a => a.label) });
    if (!f.fig.caption.some(c => c.includes("√(area fraction)")) || !f.fig.caption.some(c => /θ from \+x, clockwise/.test(c))) bad.push({ j, caption: f.fig.caption });
    // the outer ring's value, read off its own label
    const ring = f.fig.rings[f.fig.rings.length - 1];
    const vMax = parseFloat(ring.label) / ring.rf ** 2;
    for (const [w, h] of sizes([252, 212])) {
      const lay = PO.layoutPolar(f.fig, w, h);
      layouts++;
      textsOk(`rose j${j} @${w}x${h}`, lay);
      // every wedge re-derived from its table row: radius √(A / A_max) of the
      // rim, starting at its bin's angle (clockwise on screen)
      if (lay.wedges.length !== 18 * j) bad.push({ j, wedges: lay.wedges.length });
      lay.wedges.forEach((q, i) => {
        const bin = i % 18;
        const r = Math.sqrt(col.area_fraction[bin] / vMax) * lay.R;
        const t0 = ((Math.floor(i / 18) * period + col.theta_lo[bin]) * Math.PI) / 180;
        wedges++;
        if (Math.abs(q.r - r) > 1e-6 || Math.abs(q.t0 - t0) > 1e-9) bad.push({ j, wedge: i, r: [q.r, r], t0: [q.t0, t0] });
      });
      // the ring labels are drawn, each ON its ring: inside the circle, its
      // outer corner within 4 px of it (a label off its ring names nothing)
      const rl = lay.texts.filter(t => f.fig.rings.some(q => q.label === t.text));
      if (rl.length !== f.fig.rings.length) bad.push({ j, size: [w, h], ringLabels: rl.map(t => t.text), rings: f.fig.rings.map(q => q.label) });
      for (const t of rl) {
        const r = f.fig.rings.find(q => q.label === t.text).rf * lay.R;
        const far = Math.max(...[[t.box.x0, t.box.y0], [t.box.x1, t.box.y0], [t.box.x0, t.box.y1], [t.box.x1, t.box.y1]].map(([x, y]) => Math.hypot(x - lay.cx, y - lay.cy)));
        if (far > r + 0.5 || far < r - 4) bad.push({ j, size: [w, h], ringLabelOff: t.text, far: +far.toFixed(2), r: +r.toFixed(2) });
      }
    }
  }
  // the rim is always a labelled ring, whatever the peak (a 12 % peak got a
  // rim of 15 with its only ring at 10), two or three rings, each label its
  // own value on the √ scale
  for (const peak of [7, 9.2, 12, 14, 18, 26, 40]) {
    const rest = (100 - peak) / 17;
    const f = AN.roseFigure({ rose: Array.from({ length: 18 }, (_, i) => (i === 3 ? peak : rest)), j: 4, umPerCell: 1, bridge: b, prov: PROV });
    const rg = f.fig.rings, top = rg[rg.length - 1];
    rims++;
    const vTop = parseFloat(top.label);
    if (rg.length < 2 || rg.length > 3 || Math.abs(top.rf - 1) > 1e-12 || !(vTop >= peak) || rg.some(q => Math.abs(parseFloat(q.label) - vTop * q.rf ** 2) > 1e-9 * vTop))
      bad.push({ peak, rings: rg.map(q => `${q.label}@${q.rf.toFixed(3)}`) });
  }
  // a pole figure of two known grains: identity (its [001] is sample Z, the
  // center) and 60° about Y (its [001] tilts 60° toward +X, onto the ring
  // labelled 60°); the second grain is 8x the volume, so twice the diameter
  const h30 = Math.PI / 6;
  const quats = [0, 0, 0, 0, 0, 0, 0, 1, 0, Math.sin(h30), 0, Math.cos(h30)];
  const grains = [{ id: 1, vox: 1000 }, { id: 2, vox: 8000 }];
  const f1 = AN.poleFigure({ grains, quats, axes: [[0, 0, 1]], family: "[001]", umPerVox: 2, bridge: b, prov: PROV });
  const col = Object.fromEntries(f1.columns.map(c => [c.key, c.values]));
  if (Math.abs(col.chi[0]) > 1e-9 || Math.abs(col.chi[1] - 60) > 1e-9 || Math.abs(col.phi[1]) > 1e-9 || Math.abs(col.X[1] - Math.tan(h30)) > 1e-12)
    bad.push({ poleTable: { chi: col.chi, phi: col.phi, X: col.X } });
  if (Math.abs(col.d[1] / col.d[0] - 2) > 1e-9) bad.push({ diameters: col.d });
  if (!f1.fig.caption.some(c => /stereographic/.test(c)) || !f1.fig.caption.some(c => /tilt χ from Z/.test(c))) bad.push({ caption: f1.fig.caption });
  for (const [w, h] of sizes([252, 236])) {
    const lay = PO.layoutPolar(f1.fig, w, h);
    layouts++;
    textsOk(`pole @${w}x${h}`, lay);
    for (const lbl of ["X", "Y", "Z", "30°", "60°"]) if (!lay.texts.some(t => t.text === lbl)) bad.push({ size: [w, h], missing: lbl });
    const [p0, p1] = lay.points;
    const ring60 = lay.rings[f1.fig.rings.findIndex(q => q.label === "60°")];
    poles += 2;
    if (Math.abs(p0.x - lay.cx) > 1e-9 || Math.abs(p0.y - lay.cy) > 1e-9) bad.push({ size: [w, h], center: [p0.x - lay.cx, p0.y - lay.cy] });
    if (Math.abs(Math.hypot(p1.x - lay.cx, p1.y - lay.cy) - ring60) > 1e-6 || Math.abs(p1.y - lay.cy) > 1e-9 || !(p1.x > lay.cx)) bad.push({ size: [w, h], tilt60: [p1.x - lay.cx, p1.y - lay.cy, ring60] });
    // dot diameter ∝ d, as the caption says: twice the diameter, twice the dot
    if (!(Math.abs(p1.r / p0.r - 2) < 1e-9)) bad.push({ size: [w, h], sizes: [p0.r, p1.r] });
  }
  // the ⟨100⟩ family: three poles a grain; the identity's [100] and [010]
  // sit on the rim at X and at Y (Y up: the ccw sense)
  const f3 = AN.poleFigure({ grains: [grains[0]], quats, ...AN.poleFamily(1), umPerVox: 2, bridge: b, prov: PROV });
  const lay3 = PO.layoutPolar(f3.fig, 252, 236);
  const [a, bb] = lay3.points;
  if (lay3.points.length !== 3 || Math.abs(a.x - (lay3.cx + lay3.R)) > 1e-9 || Math.abs(bb.y - (lay3.cy - lay3.R)) > 1e-9) bad.push({ family: lay3.points });
  // liveness: 15 layouts, 900 wedges re-derived (18 bins x (4 + 6) folds x 5
  // sizes), 10 poles placed, 7 rims
  check("PLOT-POLAR", bad.length === 0 && layouts >= 15 && wedges >= 900 && poles >= 10 && rims === 7,
    { layouts, wedges, poles, rims, bad: bad.slice(0, 6), nBad: bad.length });
}

// ------------------------------------------------------------ PLOT-PD-AXES
{
  const bad = [];
  let figs = 0, invTicks = 0, vertices = 0, frames = 0;
  const srcPd = src("phasediagram.ts");
  // the field-fit width is FRAME's own (it was a literal 250 that a margin
  // change would have silently desynced)
  if (/INNER\s*=\s*\d/.test(srcPd) || !/INNER\s*=\s*FRAME\.w\s*-\s*FRAME\.ml\s*-\s*FRAME\.mr/.test(srcPd)) bad.push("INNER is not derived from FRAME");
  // the enlarged view is sized and framed by the exported functions checked
  // below, not by numbers of its own
  if (!/pdBigSize\(innerWidth, innerHeight, /.test(srcPd) || !/frame: pdBigFrame\(w, h\), font: PD_BIG_FONT/.test(srcPd)) bad.push("openBig does not use pdBigSize / pdBigFrame / PD_BIG_FONT");
  const round = step => { const m = step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)); return [1, 2, 5, 10].some(q => Math.abs(m - q) < 1e-9); };
  const parseCsv = text => text.trimEnd().split("\n").filter(l => !l.startsWith("#")).map(l => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  });
  // the frames the app really draws: the composer's at desktop type and at a
  // phone's (pdFontFor: 11 px ticks on a 334 px SVG), and the enlarged
  // view's own frame at 1440x900, 1024x768 (bare and with the tour's inset)
  // and a 390x844 phone. (It was a hand-copied 760 x 440 stand-in.)
  const BIGS = [[1440, 900, false], [1024, 768, false], [1024, 768, true], [390, 844, false]];
  const frameSet = [[PD.FRAME, PD.PD_FONT, "composer"], [PD.FRAME, PD.pdFontFor(334), "composer phone"],
    ...BIGS.map(([vw, vh, tour]) => { const [w, h] = PD.pdBigSize(vw, vh, tour); return [PD.pdBigFrame(w, h), PD.PD_BIG_FONT, `big ${vw}x${vh}${tour ? " tour" : ""}`]; })];
  for (const [vw, vh, tour] of BIGS) {
    const [w, h] = PD.pdBigSize(vw, vh, tour);
    frames++;
    // its card fits the window beside its chrome, and with the tour showing
    // it fits the room the tour's 362 px column leaves (the card ran under it)
    const room = tour ? vw - 362 : vw;
    if (h + L.MODAL_CHROME > vh - 32 || w + 34 > room - 32) bad.push({ big: [vw, vh, tour], size: [w, h], room });
  }
  for (const [bk, base] of Object.entries(AL.BASES)) for (const [el, sol] of Object.entries(base.solutes)) {
    const row = PDATA.BINARY[bk][el];
    const c = Math.max(1e-3, Math.min(sol.cap, (row.Cinv ?? sol.cap) * 0.5));
    const mix = { base: bk, wt: { [el]: c } };
    const fig = PD.layout(mix, null);
    if (!fig.ok) continue;
    figs++;
    const key = `${bk}-${el}`;
    const dom = [fig.xMax, fig.yMin, fig.yMax];
    const inv = fig.polylines.find(l => l.id === "invariant");
    for (const [fr, font, fname] of frameSet) {
      const A = PD.axesOf(fig, fr, font);
      if (A.x.length < 3 || A.y.length < 3) bad.push({ key, fname, few: [A.x.length, A.y.length] });
      const xs = A.x.map(t => t.v), ys = A.y.filter(t => !t.inv).map(t => t.v).sort((p, q) => p - q);
      const invPx = inv ? PD.toPx(fig, { c: 0, T: inv.pts[0].T }, fr).y : null;
      for (const [nm, vs, lo, hi] of [["x", xs, 0, fig.xMax], ["y", ys, fig.yMin, fig.yMax]]) {
        if (vs.some(v => v < lo - 1e-9 || v > hi + 1e-9)) bad.push({ key, fname, [nm]: "tick outside the domain" });
        if (vs.length > 1) {
          // one round step, every tick a multiple of it; the only missing
          // multiples are the ones that gave way to the invariant's tick
          const st = Math.min(...vs.slice(1).map((v, i) => v - vs[i]));
          if (!round(st) || vs.some(v => Math.abs(v / st - Math.round(v / st)) > 1e-6)) bad.push({ key, fname, [nm]: vs });
          for (let i = 1; i < vs.length; i++) for (let m = vs[i - 1] + st; m < vs[i] - st / 2; m += st) {
            const mpx = nm === "y" ? PD.toPx(fig, { c: 0, T: m }, fr).y : null;
            if (mpx == null || invPx == null || Math.abs(mpx - invPx) >= font.tick * 1.3) bad.push({ key, fname, [nm]: vs, gapAt: m });
          }
        }
      }
      for (const t of A.x) if (Math.abs(t.px - PD.toPx(fig, { c: t.v, T: fig.yMin }, fr).x) > 1e-9) bad.push({ key, fname, xpx: t });
      for (const t of A.y) if (Math.abs(t.px - PD.toPx(fig, { c: 0, T: t.v }, fr).y) > 1e-9) bad.push({ key, fname, ypx: t });
      // the invariant's own tick, at its exact temperature, labelled with it
      const it = A.y.filter(t => t.inv);
      if (inv) {
        invTicks++;
        if (it.length !== 1 || !Object.is(it[0].v, inv.pts[0].T) || Number(it[0].label.replace("−", "-")) !== inv.pts[0].T) bad.push({ key, fname, inv: it, Tinv: inv.pts[0].T });
      } else if (it.length) bad.push({ key, fname, invWithoutInvariant: it });
      // labels never closer than a line of type, up the y axis; along the x
      // axis each label's centered width (0.6 em a character) clear of the next
      const py = A.y.map(t => t.px).sort((p, q) => p - q);
      for (let i = 1; i < py.length; i++) if (py[i] - py[i - 1] < font.tick * 1.1) bad.push({ key, fname, crowded: A.y.map(t => t.label) });
      const halfW = t => (t.label.length * 0.6 * font.tick) / 2;
      for (let i = 1; i < A.x.length; i++) if (A.x[i].px - halfW(A.x[i]) < A.x[i - 1].px + halfW(A.x[i - 1]) + font.tick * 0.3) bad.push({ key, fname, xCrowded: A.x.map(t => t.label) });
      if (A.yTitle !== "Temperature T (°C)" || A.xTitle !== `Composition c_{${el}} (wt%)`) bad.push({ key, fname, titles: [A.xTitle, A.yTitle] });
    }
    // the axes never widened the frame (PD-FIGURE-GEOMETRY's tightness)
    if (fig.xMax !== dom[0] || fig.yMin !== dom[1] || fig.yMax !== dom[2]) bad.push({ key, widened: true });
    // the table holds every drawn vertex, exactly, and the pour marker
    const rows = PD.figureRows(fig);
    for (const l of fig.polylines) for (const p of l.pts) {
      vertices++;
      if (!rows.some(r => r[0] === l.id && r[1] === l.label && Object.is(r[3], p.c) && Object.is(r[4], p.T))) bad.push({ key, vertex: [l.id, p] });
    }
    const pour = fig.markers.find(m => m.id === "pour");
    if (!rows.some(r => r[0] === "pour marker" && Object.is(r[3], pour.c) && Object.is(r[4], pour.T))) bad.push({ key, pour: "missing" });
    // the CSV: its provenance names the source and the mix, and its rows are
    // the table's (labels with commas quoted), numbers to 8 significant figures
    const csv = PD.figureCsv(fig, mix);
    const parsed = parseCsv(csv);
    if (!csv.includes(`# source: ${fig.cite}`) || !csv.includes(`wt% ${el}`)) bad.push({ key, csvHead: csv.split("\n").slice(0, 3) });
    if (parsed.length !== rows.length + 1 || parsed[0].join() !== `element,label,point,c_wt_pct_${el},T_C`) bad.push({ key, csvRows: parsed.length, want: rows.length + 1 });
    rows.forEach((r, i) => {
      const q = parsed[i + 1];
      if (!q || q.length !== 5 || q[0] !== r[0] || q[1] !== r[1] || Math.abs(Number(q[3]) - r[3]) > 1e-7 * Math.max(1, Math.abs(r[3]))
        || (Number.isFinite(r[4]) ? Math.abs(Number(q[4]) - r[4]) > 1e-7 * Math.abs(r[4]) : q[4] !== "")) bad.push({ key, csvRow: i, q, r });
    });
  }
  check("PLOT-PD-AXES", bad.length === 0 && figs >= 20 && invTicks >= 90 && vertices >= 150 && frames === 4,
    { figs, invTicks, vertices, frames: frameSet.map(f => f[2]), bad: bad.slice(0, 6), nBad: bad.length });
}

// ------------------------------------------------------------ PLOT-WIRING
{
  // The review's finding: the headline fixes were gated only as pure
  // functions, so a call site reverted (the lab drawing T̃ = 1 again, the HUD
  // measuring from 1, a push without sim time) passed every gate. These pin
  // each call site to the rule the clauses above check; the browser half
  // (verify-tools LAB-CURVE, HUD-LIVE) reads the running app.
  const bad = [];
  const need = (file, re, what) => { if (!re.test(src(file))) bad.push({ file, missing: what }); };
  // the lab: the pour latches the charge's chemistry, the figure draws it
  need("lab.ts", /this\.chemAtPour = this\.host\.chem\(\);/, "the pour latches chemAtPour from the host");
  need("lab.ts", /const chem = this\.chemAtPour \?\? this\.host\.chem\(\);/, "the figure reads the latched chemistry");
  need("lab.ts", /coolingFigure\(\{\s*series: rep\.series, ta: rep\.ta, bridge: b, chem, full,/, "coolingFigure gets that chemistry");
  // the HUD: ΔT from the interface COUNT and the charge's liquidus, the
  // chemistry latched with the series; the histogram without a sample count
  need("hud.ts", /const chem = this\.host\.chem\(\);\s*this\.record\(\{[\s\S]{0,120}dt: hudDeltaT\(s\.interfaceCells, s\.interfaceT, chargeLiquidus\(chem\)\),\s*\}, chem\);/, "push: hudDeltaT(interfaceCells, interfaceT, chargeLiquidus(chem)), recorded with chem");
  need("hud.ts", /this\.rec\.push\(p, bridgeOf\(this\.host\.units\(\), this\.host\.meta\(\)\.material\), chem\)/, "record latches bridge and chemistry");
  need("hud.ts", /histFigure\(this\.diams, b, \{ \.\.\.this\.host\.meta\(\) \}, this\.mode3\)/, "the histogram's provenance carries no sample count");
  // main.ts: the HUD records against sim time in both dimensions; the
  // undercooling and every host's chemistry come from chargeLiquidus / chemNow
  need("main.ts", /hud\.push\(s, sim\.simTime\)/, "hud.push(s, sim.simTime)");
  need("main.ts", /hud\.push3\(s, sim3d\.umPerCell, sim3d\.simTime\)/, "hud.push3(s, sim3d.umPerCell, sim3d.simTime)");
  need("main.ts", /const tEq2 = \(\) => chargeLiquidus\(sim\.params\);/, "tEq2 is chargeLiquidus (solver-aware)");
  need("main.ts", /const hud = new Hud\([^)]*\)!, \{[\s\S]{0,200}chem: \(\) => chemNow\(\),/, "the HUD host's chemistry");
  need("main.ts", /plotMeta: \(\) => plotMeta\(\),\s*chem: \(\) => chemNow\(\),/, "the lab host's chemistry");
  need("main.ts", /meta: \(\) => plotMeta\(\), chem: \(\) => chemNow\(false\)/, "the 2D analysis host's chemistry");
  need("main.ts", /meta: \(\) => plotMeta\(\), chem: \(\) => chemNow\(true\)/, "the 3D analysis host's chemistry");
  need("main.ts", /sim\.params\.solver === SOLVER\.QUANT && sim\.params\.alloyOn === 1 \? quantAnchor\(\)/, "unitsNow's calibrated T̃ = 1");
  // the 2D interface reduction reads under T̃ = 0 (offset like the probe's
  // and the 3D one), and TRUE 3D tests presence by the interface count
  need("shaders.ts", /atomicAdd\(&stats\.interfT, u32\(clamp\(s\.g \+ 1\.0, 0\.0, 3\.0\) \* 500\.0\)\)/, "the 2D interface sum offset by +1");
  need("sim.ts", /data\[2\] \/ 500 \/ interf - 1/, "the 2D interface decode");
  need("analyze3d.ts", /scheilSample\(simTime, s\.fracSolid, s\.interfaceT, s\.interfaceCells > 0\)/, "TRUE 3D interface presence by count");
  // the solver ids the figures branch on are the kernel's own
  const ok = bad.length === 0 && SH.SOLVER.QUANT === 1 && F.chargeLiquidus({ solver: SH.SOLVER.QUANT, alloyOn: 1, mLiq: 0.5, c0: 0.3 }) === 1;
  check("PLOT-WIRING", ok, { sites: 17, bad });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all plot checks passed");
if (failures) process.exitCode = 1;
