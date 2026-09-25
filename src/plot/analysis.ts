// The analysis columns' figures (U2, second half): the cooling-curve probe
// and the Scheil path in 2D and TRUE 3D, the 2D growth-direction rose and the
// 3D pole figures. Each builder takes stored (solver) values and the unit
// bridge latched when its series started, and returns a `Figure` (figures.ts)
// that the panel, the enlarged view, the data table and the CSV all read.
// Pure, so scripts/verify-plot.mjs drives the same builders the app calls.
import { SOLVER } from "../shaders";
import { resolve, type Bridge, type Column, type Quantity } from "./quantity";
import { extent, type FigSpec } from "./layout";
import type { PolarSpec, PolePoint, Wedge } from "./polar";
import { tickStep, fmtTick, fmtValue } from "./ticks";
import { LatchedRecord, Q, chargeLiquidus, liquidusLabel, liquidusProv, type Chem, type Figure } from "./figures";
import type { Prov } from "./csv";

/** the quantities these figures add to figures.ts's */
export const QA = {
  phi: { kind: "fraction", sym: "φ", name: "Phase field at the probe" },
  Ti: { kind: "temp", sym: "T_{i}", symDim: "T̃_{i}", name: "Interface temperature" },
  Tscheil: { kind: "temp", sym: "T_{Scheil}", symDim: "T̃_{Scheil}", name: "Scheil prediction" },
  dTscheil: { kind: "dtemp", sym: "T_{i} − T_{Scheil}", symDim: "T̃_{i} − T̃_{Scheil}", name: "" },
  thetaLo: { kind: "angle", sym: "θ_{lo}", name: "" },
  thetaHi: { kind: "angle", sym: "θ_{hi}", name: "" },
  area: { kind: "percent", sym: "A", name: "Area fraction" },
  grain: { kind: "id", sym: "grain", name: "" },
  pole: { kind: "id", sym: "pole", name: "" },
  X: { kind: "dimless", sym: "X", name: "" },
  Y: { kind: "dimless", sym: "Y", name: "" },
  chi: { kind: "angle", sym: "χ", name: "" },
  az: { kind: "angle", sym: "φ", name: "" },
  d: { kind: "length", sym: "d", name: "" },
} satisfies Record<string, Quantity>;

// ------------------------------------------------------------- the records

export interface ProbeSample { t: number; T: number; phi: number }
export interface ScheilSample { t: number; fs: number; Ti: number }
/** the probe's T(t), 900 samples at most (figures.ts TimedRecord's rule) */
export class ProbeRecord extends LatchedRecord<ProbeSample> { constructor() { super(900); } }
/** the measured Scheil points, 900 at most, in 2D and TRUE 3D alike */
export class ScheilRecord extends LatchedRecord<ScheilSample> { constructor() { super(900); } }

/**
 * A stats poll's probe reading, or null. The reduction writes the probe
 * cell's (T̃ + 1)·1000 into a counter that starts every poll at 0, so a poll
 * dispatched before the probe was placed reads exactly T̃ = −1: no reading
 * (the solver's melt never goes near it). The first 3D sample was one, and
 * stretched the probe's axis down to it.
 */
export function probeSample(t: number, probeT: number | null, probePhi: number | null): ProbeSample | null {
  return probeT != null && Number.isFinite(probeT) && probeT > -1 + 1e-6 ? { t, T: probeT, phi: probePhi ?? 0 } : null;
}

/**
 * A stats poll's Scheil point, or null: only inside the freezing range, and
 * only while an interface exists (the solver reports 0 for the interface
 * temperature when there is none, which is not a temperature).
 */
export function scheilSample(t: number, fracSolid: number, interfaceT: number, hasInterface: boolean): ScheilSample | null {
  return hasInterface && fracSolid > 0.005 && fracSolid < 0.995 && Number.isFinite(interfaceT)
    ? { t, fs: fracSolid, Ti: interfaceT } : null;
}

/**
 * Scheil's interface temperature at solid fraction f_s, T̃, in the solver's
 * own temperature scale. Scheil puts the interface liquid at
 * c_l = c₀·(1 − f_s)^(k − 1); where that sits on the dimensionless axis is
 * the kernel's:
 * - Kobayashi: T_eq = 1 − m̃·c, so T̃ = 1 − m̃·c₀·(1 − f_s)^(k − 1);
 * - calibrated (Karma–Rappel): T̃ = 1 at the nominal liquidus (c_l = c₀) and
 *   0 at the solidus (c_l = c₀/k), linear in c_l between, so
 *   T̃ = 1 − (k/(1 − k))·((1 − f_s)^(k − 1) − 1), k clamped as the kernel
 *   clamps it (shaders.ts uSup). m̃ is not in that drive at all.
 * Both start at the charge's liquidus, chargeLiquidus(c), at f_s = 0.
 */
export function scheilT(fs: number, c: Chem): number {
  const liq = Math.max(1 - fs, 1e-3);
  if (c.solver === SOLVER.QUANT) {
    const k = Math.min(0.999, Math.max(1e-3, c.kPart));
    return 1 - (k / (1 - k)) * (Math.pow(liq, k - 1) - 1);
  }
  return 1 - c.mLiq * c.c0 * Math.pow(liq, c.kPart - 1);
}

/** the formula as the provenance prints it, for the solver that ran */
const scheilRule = (c: Chem): string => c.solver === SOLVER.QUANT
  ? `Scheil (calibrated solver: T̃ = 1 the nominal liquidus, 0 the solidus): T_i = 1 − (k/(1 − k))·((1 − f_s)^(k − 1) − 1), k = ${fmtValue(c.kPart, 4)} (dimensionless)`
  : `Scheil (Kobayashi kernel, T_eq = 1 − m·c): T_i = 1 − m·c0·(1 − f_s)^(k − 1), m·c0 = ${fmtValue(c.mLiq * c.c0, 4)}, k = ${fmtValue(c.kPart, 4)} (dimensionless)`;

// ------------------------------------------------------------ the probe

export interface ProbeInput {
  samples: ProbeSample[];
  bridge: Bridge;
  /** the chemistry the series ran under (latched with it): its liquidus */
  chem: Chem;
  three: boolean;
  prov: Prov;
}

/** the cooling curve at the probe's cell: T(t), the charge's liquidus, and
 *  the moment the cell froze (φ first past ½) as an event line */
export function probeFigure(c: ProbeInput): Figure {
  const b = c.bridge, s = c.samples;
  const tMax = s.length ? Math.max(Math.abs(s[0].t), Math.abs(s[s.length - 1].t)) : 0;
  const X = resolve(Q.time, b, tMax);
  const Tq = resolve(Q.temp, b);
  const xs = s.map(p => X.conv(p.t));
  const Ts = s.map(p => Tq.conv(p.T));
  const liq = Tq.conv(chargeLiquidus(c.chem));
  const [lo, hi] = extent([Ts], { pad: 0.1, include: [liq] });
  const solidAt = s.findIndex(p => p.phi > 0.5);
  const last = Ts.length ? Ts[Ts.length - 1] : NaN;
  const fig: FigSpec = {
    x: { title: X.title, short: X.short, lo: xs[0] ?? 0, hi: xs.length > 1 && xs[xs.length - 1] > xs[0] ? xs[xs.length - 1] : (xs[0] ?? 0) + 1, sym: X.sym, unit: X.unit },
    panels: [{
      y: { title: Tq.title, short: Tq.short, lo, hi },
      series: [{ key: "T", slot: 0, xs, ys: Ts, sym: Tq.sym, unit: Tq.unit }],
      refs: [
        { y: liq, label: liquidusLabel(c.chem, b) },
        ...(solidAt > 0 ? [{ x: xs[solidAt], label: "cell solid", slot: 1 as const }] : []),
      ],
      live: Number.isFinite(last) ? `${Tq.si ? "T" : "T̃"} ${fmtValue(last, 4)}${Tq.si ? " °C" : ""}` : undefined,
    }],
    empty: s.length < 2 ? "no data: run the melt" : null,
  };
  const columns: Column[] = [
    { key: "t", q: Q.time, values: s.map(p => p.t) },
    { key: "T", q: Q.temp, values: s.map(p => p.T) },
    { key: "phi", q: QA.phi, values: s.map(p => p.phi) },
  ];
  return {
    title: `Cooling curve · probe (${c.three ? "TRUE 3D" : "2D"})`, fig, columns, bridge: b,
    prov: { ...c.prov, chem: c.chem, extra: [...(c.prov.extra ?? []),
      "T: the temperature of one cell (a thermocouple in the melt); φ: its phase field (1 solid, 0 liquid)",
      ...liquidusProv(c.chem, b)] },
  };
}

// ------------------------------------------------------------ the Scheil path

export interface ScheilInput {
  samples: ScheilSample[];
  bridge: Bridge;
  /** the chemistry the series ran under (latched with it): the solver's
   *  m̃·c̃₀, k and which kernel's temperature scale the path is drawn in */
  chem: Chem;
  three: boolean;
  prov: Prov;
}

/**
 * Scheil's prediction T_i(f_s) against what the solver measured, the global
 * solid fraction against the mean interface temperature. Below the measured
 * points the prediction runs off the bottom of the axis (toward the eutectic),
 * as it does in a paper's figure; the axis is the data's, not the formula's.
 */
export function scheilFigure(c: ScheilInput): Figure {
  const b = c.bridge;
  const F = resolve(Q.fs, b);
  const Tq = resolve(QA.Ti, b);
  const s = c.samples;
  const N = 120;
  const pfs = Array.from({ length: N + 1 }, (_, i) => (i / N) * 0.98);
  const pT = pfs.map(f => Tq.conv(scheilT(f, c.chem)));
  const mfs = s.map(p => p.fs);
  const mT = s.map(p => Tq.conv(p.Ti));
  const liq = Tq.conv(chargeLiquidus(c.chem));
  const [lo, hi] = mT.length
    ? extent([mT], { pad: 0.12, include: [liq] })
    : extent([[Tq.conv(scheilT(0.9, c.chem)), liq]], { pad: 0.1 });
  const fig: FigSpec = {
    x: { title: F.title, short: F.short, lo: 0, hi: 1, sym: "f_{s}", unit: F.unit },
    panels: [{
      y: { title: Tq.title, short: Tq.short, lo, hi },
      series: [
        { key: "scheil", label: "Scheil", slot: 0, xs: pfs, ys: pT, sym: "T_{Scheil}", unit: Tq.unit },
        { key: "measured", label: "solver", slot: 1, kind: "dots", xs: mfs, ys: mT, sym: "T_{i}", unit: Tq.unit },
      ],
    }],
    empty: c.chem.alloy ? null : "needs the solute field (ALLOY)",
  };
  const pred = s.map(p => scheilT(p.fs, c.chem));
  const columns: Column[] = [
    { key: "fs", q: Q.fs, values: mfs },
    { key: "T_interface", q: QA.Ti, values: s.map(p => p.Ti) },
    { key: "T_scheil", q: QA.Tscheil, values: pred },
    { key: "dT_scheil", q: QA.dTscheil, values: s.map((p, i) => p.Ti - pred[i]) },
  ];
  return {
    title: `Scheil path · predicted vs measured (${c.three ? "TRUE 3D" : "2D"})`, fig, columns, bridge: b,
    prov: { ...c.prov, chem: c.chem, extra: [...(c.prov.extra ?? []),
      scheilRule(c.chem),
      "measured: the global solid fraction against the mean temperature of the interface cells",
      ...(c.chem.alloy ? liquidusProv(c.chem, b) : [])] },
  };
}

// ------------------------------------------------------------ the rose

/** the angle ticks for a j-fold rose: every period boundary, split so no
 *  step is over 45° */
export function roseAngles(j: number): number[] {
  const period = 360 / Math.max(1, j);
  const k = Math.ceil(period / 45 - 1e-9);
  const step = period / k;
  const out: number[] = [];
  for (let a = 0; a < 360 - 1e-6; a += step) out.push(Number(a.toFixed(6)));
  return out;
}

export interface RoseInput {
  /** area per orientation bin over one period [0, 360°/j), px² (sim.ts oriRose) */
  rose: number[] | null;
  /** the crystal's symmetry fold */
  j: number;
  umPerCell: number;
  bridge: Bridge;
  prov: Prov;
}

/**
 * The 2D growth-direction rose: each grain's growth direction θ (from the
 * micrograph's +x axis, clockwise as the micrograph's y points down), binned
 * over one symmetry period and weighted by grain area, drawn repeated around
 * the circle for the j equivalent directions. Radius ∝ √(area fraction), so a
 * wedge's AREA is proportional to what it counts (a radius ∝ value rose
 * exaggerates its peaks).
 */
export function roseFigure(c: RoseInput): Figure {
  const j = Math.max(1, Math.round(c.j));
  const rose = c.rose ?? [];
  const total = rose.reduce((a, v) => a + v, 0);
  const n = rose.length || 18;
  const period = 360 / j, binW = period / n;
  const frac = rose.map(v => (total > 0 ? (100 * v) / total : 0));
  const maxV = Math.max(0, ...frac);
  const st = maxV > 0 ? Math.abs(tickStep(0, maxV, 2)) : 1;
  const vMax = maxV > 0 ? Math.ceil(maxV / st - 1e-9) * st : 1;
  const wedges: Wedge[] = [];
  for (let k = 0; k < j; k++)
    frac.forEach((v, bIdx) => {
      const a0 = k * period + bIdx * binW;
      wedges.push({ a0, a1: a0 + binW, rf: Math.sqrt(v / vMax), v });
    });
  // the rings from the SAME step that set the rim, so the rim is always a
  // labelled ring (ticks(0, vMax, 2) took a step of its own: a 12 % peak got
  // a rim of 15 and one ring at 10); at most three, every other one dropped
  // from the inside when there are more, the rim always kept
  let rv: number[] = [];
  for (let k = 1; k * st <= vMax + 1e-9 * st; k++) rv.push(Number((k * st).toPrecision(12)));
  while (rv.length > 3) rv = rv.filter((_, i) => (rv.length - 1 - i) % 2 === 0);
  const rings = rv.map(v => ({ rf: Math.sqrt(v / vMax), label: `${fmtTick(v, st)} %` }));
  const deg = (d: number) => `${Number(d.toFixed(2))}°`;
  const spec: PolarSpec = {
    polar: true, sense: "cw", wedges, points: [], rings,
    angles: roseAngles(j).map(d => ({ deg: d, label: deg(d) })),
    cross: false,
    caption: [`radius ∝ √(area fraction) · ${n} bins per ${deg(period)}`, `θ from +x, clockwise · ${j}-fold`],
    slot: 0, empty: total > 0 ? null : "no grains yet",
    angleSym: "θ", valueSym: "A", valueUnit: "%",
  };
  const um2 = c.umPerCell * c.umPerCell;
  const columns: Column[] = [
    { key: "theta_lo", q: QA.thetaLo, values: frac.map((_, i) => i * binW) },
    { key: "theta_hi", q: QA.thetaHi, values: frac.map((_, i) => (i + 1) * binW) },
    { key: "area_fraction", q: QA.area, values: frac },
  ];
  return {
    title: "Growth-direction rose · area-weighted", fig: spec, columns, bridge: c.bridge,
    prov: { ...c.prov, extra: [...(c.prov.extra ?? []),
      `θ: each grain's growth direction from the micrograph's +x axis, clockwise; ${j}-fold, so one period is ${fmtValue(period, 4)}° and the rose repeats it`,
      `weights: grain area; total ${fmtValue(total * um2, 4)} µm² over ${n} bins`] },
  };
}

// ------------------------------------------------------------ the pole figures

export type Quat = [number, number, number, number];

/** rotate v by the unit quaternion q = (x, y, z, w) */
export function qrotV(q: Quat, v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** a direction's pole: flipped into the upper hemisphere (an axis and its
 *  opposite are one pole), projected stereographically from −Z */
export function stereo(v: [number, number, number]): { X: number; Y: number; chi: number; az: number } {
  let [x, y, z] = v;
  const n = Math.hypot(x, y, z) || 1;
  x /= n; y /= n; z /= n;
  if (z < 0) { x = -x; y = -y; z = -z; }
  const az = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { X: x / (1 + z), Y: y / (1 + z), chi: (Math.acos(Math.min(1, z)) * 180) / Math.PI, az };
}

/** the crystal directions a pole figure plots, for the 3D symmetry mode:
 *  cubic ⟨100⟩, hexagonal (0001), icosahedral 5-fold */
export function poleFamily(mode3: number): { family: string; axes: [number, number, number][] } {
  const phi = 0.85065081, sg = 0.52573111;
  if (mode3 === 2) return { family: "(0001)", axes: [[0, 0, 1]] };
  if (mode3 === 3) return { family: "5-fold", axes: [[0, sg, phi], [0, -sg, phi], [sg, phi, 0], [-sg, phi, 0], [phi, 0, sg], [phi, 0, -sg]] };
  return { family: "⟨100⟩", axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
}

export interface PoleInput {
  grains: { id: number; vox: number }[];
  /** 4 floats per grain id (sim3d.quats) */
  quats: ArrayLike<number>;
  /** the crystal directions to plot, and their family's name */
  axes: [number, number, number][];
  family: string;
  umPerVox: number;
  bridge: Bridge;
  prov: Prov;
}

const AXIS_NAMES: Record<string, string[]> = {
  "⟨100⟩": ["[100]", "[010]", "[001]"],
  "[001]": ["[001]"],
  "(0001)": ["[0001]"],
};

/**
 * A pole figure: every grain's crystal directions in the SAMPLE frame,
 * stereographic, upper hemisphere, sample Z at the center, X right and Y up;
 * the dashed rings are 30° and 60° of tilt from Z (at tan(χ/2) of the rim).
 * Dot diameter is proportional to the grain's equivalent-sphere diameter
 * (polar.ts poleRadius; a floor keeps the smallest visible).
 */
export function poleFigure(c: PoleInput): Figure {
  const rows: { id: number; pole: number; X: number; Y: number; chi: number; az: number; d: number }[] = [];
  const ds = c.grains.map(g => Math.cbrt((6 * g.vox) / Math.PI) * c.umPerVox);
  const dMax = Math.max(1e-9, ...ds);
  const points: PolePoint[] = [];
  const names = AXIS_NAMES[c.family] ?? c.axes.map((_, i) => `axis ${i + 1}`);
  c.grains.forEach((g, gi) => {
    const b = g.id * 4;
    const q: Quat = [c.quats[b], c.quats[b + 1], c.quats[b + 2], c.quats[b + 3]];
    c.axes.forEach((a, ai) => {
      const p = stereo(qrotV(q, a));
      rows.push({ id: g.id, pole: ai + 1, X: p.X, Y: p.Y, chi: p.chi, az: p.az, d: ds[gi] });
      points.push({
        x: p.X, y: p.Y, w: ds[gi] / dMax,
        rows: [["grain", `${g.id} · ${names[ai] ?? ""}`], ["χ", `${p.chi.toFixed(1)}°`], ["φ", `${p.az.toFixed(1)}°`], ["d", `${fmtValue(ds[gi], 3)} µm`]],
      });
    });
  });
  const spec: PolarSpec = {
    polar: true, sense: "ccw", wedges: [], points,
    rings: [30, 60].map(chi => ({ rf: Math.tan((chi * Math.PI) / 360), label: `${chi}°` })),
    angles: [{ deg: 0, label: "X" }, { deg: 90, label: "Y" }],
    cross: true, center: "Z",
    caption: ["stereographic · upper hemisphere", `rings: tilt χ from Z · dot diameter ∝ d · ${c.grains.length} grains`],
    slot: 0, empty: c.grains.length ? null : "no grains yet",
    angleSym: "φ", valueSym: "", valueUnit: "",
  };
  const columns: Column[] = [
    { key: "grain", q: QA.grain, values: rows.map(r => r.id) },
    { key: "pole", q: QA.pole, values: rows.map(r => r.pole) },
    { key: "X", q: QA.X, values: rows.map(r => r.X) },
    { key: "Y", q: QA.Y, values: rows.map(r => r.Y) },
    { key: "chi", q: QA.chi, values: rows.map(r => r.chi) },
    { key: "phi", q: QA.az, values: rows.map(r => r.az) },
    { key: "d", q: QA.d, values: rows.map(r => r.d) },
  ];
  return {
    title: `Pole figure ${c.family}`, fig: spec, columns, bridge: c.bridge,
    prov: { ...c.prov, extra: [...(c.prov.extra ?? []),
      `poles: each grain's crystal ${c.family} directions (${names.join(", ")}) in the sample frame; an axis and its opposite are one pole (upper hemisphere)`,
      "projection: stereographic from −Z, X = x/(1 + z), Y = y/(1 + z); χ = tilt from Z, φ = azimuth from X",
      "d: equivalent-sphere diameter (6V/π)^(1/3)"] },
  };
}
