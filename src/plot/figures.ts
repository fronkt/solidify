// The figures the instrument draws, built from their owners' data (U2).
//
// Each builder takes stored (solver) values and the unit bridge latched when
// the series started, and returns a `Figure`: the spec layout.ts lays out (in
// display units, every axis titled by quantity.ts), the columns the data
// table and the CSV carry, and the provenance. Pure, so verify-plot.mjs
// drives the same builders the app calls: the lab report's cooling curve and
// the HUD's glance plots and their full versions.
import type { ThermalAnalysis } from "../thermal";
import { SOLVER } from "../shaders";
import { resolve, type Bridge, type Column, type Quantity } from "./quantity";
import { extent, bins, type FigSpec, type PanelSpec, type SeriesSpec } from "./layout";
import type { PolarSpec } from "./polar";
import { MINUS, fmtValue } from "./ticks";
import type { Prov } from "./csv";

export interface Figure {
  /** the modal's header and the CSV's first line */
  title: string;
  /** an XY figure (layout.ts) or a polar one (polar.ts) */
  fig: FigSpec | PolarSpec;
  columns: Column[];
  bridge: Bridge;
  prov: Prov;
}

/** the quantities the figures plot */
export const Q = {
  time: { kind: "time", sym: "t", name: "Time" },
  temp: { kind: "temp", sym: "T", name: "Temperature" },
  rate: { kind: "rate", sym: "dT/dt", symDim: "dT̃/dt̃", name: "" },
  fs: { kind: "fraction", sym: "f_{s}", name: "Solid fraction" },
  fsPct: { kind: "percent", sym: "f_{s}", name: "Solid fraction" },
  fsDerived: { kind: "fraction", sym: "f_{s,zc}", name: "Zero-curve solid fraction" },
  fsProgress: { kind: "fraction", sym: "f_{s}", name: "Freezing progress" },
  fsProgressMeasured: { kind: "fraction", sym: "f_{s}*", name: "Solver solid fraction, rescaled" },
  /** a pure melt's: the mean interface cell's undercooling below T_m */
  dT: { kind: "dtemp", sym: "ΔT", name: "Interface undercooling" },
  /** an alloy's: how far the mean interface cell sits under the liquidus of
   *  the NOMINAL composition, which late in freezing is mostly the liquidus
   *  shift of the enriched interface liquid (the Scheil path), not a kinetic
   *  undercooling, so it is named for what it is (dTOf) */
  dTAlloy: { kind: "dtemp", sym: "T_{liq}(c_{0}) − T_{i}", symDim: "T̃_{liq}(c_{0}) − T̃_{i}", name: "" },
  grains: { kind: "count", sym: "N", name: "Grains" },
  pore: { kind: "percent", sym: "φ_{p}", name: "Porosity" },
  diam: { kind: "length", sym: "d", name: "Diameter" },
  binLo: { kind: "length", sym: "d_{lo}", name: "" },
  binHi: { kind: "length", sym: "d_{hi}", name: "" },
} satisfies Record<string, Quantity>;

// ------------------------------------------------------- the chemistry

/**
 * The chemistry a series ran under, latched with it like its unit bridge
 * (LatchedRecord): which kernel, whether the solute field runs, and the
 * solver's dimensionless m̃, c̃₀ and k. A liquidus line or a Scheil
 * prediction drawn from the LIVE dials against points measured under older
 * ones would be a different alloy's; a change of any of these starts a new
 * series instead (the lab latches the same at its pour).
 */
export interface Chem {
  /** SOLVER.KOB or SOLVER.QUANT (shaders.ts): which kernel's liquidus rule */
  solver: number;
  /** the solute field is running */
  alloy: boolean;
  mLiq: number;
  c0: number;
  kPart: number;
  /** c̃₀ in wt% (alloy.ts WT_PER_C0), null for a material with no SI identity */
  c0wt: number | null;
  /**
   * The material's OWN liquidus at this composition, °C: T_m + m_L·c₀ (its
   * SI slope), or a poured mix's T_m + ΔT_L; T_m for a pure melt; null with
   * no SI identity. The solver's liquidus (chargeLiquidus) is compared with
   * it by name, because under the Kobayashi kernel the two are not the same
   * number (Al–Cu: 623 °C against 645 °C).
   */
  liqC: number | null;
  /** where liqC came from, one line */
  liqSource: string;
}

/** the params a chemistry is read from (sim.params, sim3d.params, a preset) */
export interface ChemParams { solver?: number; alloyOn?: number; mLiq?: number; c0?: number; kPart?: number }

/** a Chem from solver params; `alloy` overrides alloyOn (TRUE 3D's
 *  alloyActive: the field the solver is RUNNING, not the request) */
export function chemOf(p: ChemParams, opt: { alloy?: boolean; c0wt?: number | null; liqC?: number | null; liqSource?: string } = {}): Chem {
  return {
    solver: p.solver ?? SOLVER.KOB,
    alloy: opt.alloy ?? (p.alloyOn ?? 0) === 1,
    mLiq: p.mLiq ?? 0, c0: p.c0 ?? 0, kPart: p.kPart ?? 1,
    c0wt: opt.c0wt ?? null, liqC: opt.liqC ?? null, liqSource: opt.liqSource ?? "",
  };
}

/** the identity of a chemistry: equal sigs, the same liquidus and Scheil path */
export const chemSig = (c: Chem): string => [c.solver, c.alloy ? 1 : 0, c.mLiq, c.c0, c.kPart, c.liqC ?? ""].join(",");

const isChem = (p: Chem | ChemParams): p is Chem => typeof (p as Chem).alloy === "boolean";

/**
 * The liquidus of the charge the SOLVER is running, T̃. The Kobayashi kernel
 * freezes a cell below T_eq = 1 − m̃·c (shaders.ts), so a melt of composition
 * c₀ has its liquidus at 1 − m̃·c₀, a pure melt at T_m = 1. The calibrated
 * (Karma–Rappel) kernel's drive is U + T, and U = −1 in liquid at c∞: its
 * reference state puts T̃ = 1 ON the nominal alloy's liquidus (and 0 on its
 * solidus), so there the liquidus is 1 whatever the chemistry. The lab
 * latches it at the pour; main.ts's tEq2 / tEq3 (the nucleation model's
 * undercooling reference and the HUD's) are this function.
 */
export function chargeLiquidus(p: Chem | ChemParams): number {
  const c = isChem(p) ? p : chemOf(p);
  if (c.solver === SOLVER.QUANT) return 1;
  return c.alloy ? 1 - c.mLiq * c.c0 : 1;
}

/** the reference line's name: a pure melt's T_m; an alloy's T_liq(c₀), and
 *  ", model" where the solver's sits more than 1 K off the material's own */
export function liquidusLabel(c: Chem, b: Bridge): string {
  if (!c.alloy) return "T_{m}";
  const off = b.known && c.liqC != null ? Math.abs(b.units.celsius(chargeLiquidus(c)) - c.liqC) : 0;
  return off > 1 ? "T_{liq}(c_{0}), model" : "T_{liq}(c_{0})";
}

/**
 * The provenance of a drawn liquidus: the solver's, by its rule, in T̃ and °C;
 * and the material's own from its chemistry, with the difference named when
 * it is over a kelvin (the composer names its clamps the same way).
 */
export function liquidusProv(c: Chem, b: Bridge): string[] {
  const liq = chargeLiquidus(c);
  const f4 = (v: number) => fmtValue(v, 4);
  const rule = !c.alloy ? "T_m, T̃ = 1 (a pure melt)"
    : c.solver === SOLVER.QUANT
      ? "T̃ = 1 (the calibrated solver's reference state: the nominal alloy's liquidus, T̃ = 0 its solidus)"
      : `1 − m̃·c̃₀ = 1 − ${f4(c.mLiq)}·${f4(c.c0)} = ${liq.toFixed(4)} (the Kobayashi kernel's T_eq = 1 − m̃·c at c₀)`;
  const solverC = b.known ? b.units.celsius(liq) : NaN;
  const lines = [`liquidus of the charge, the solver's: ${rule}${b.known ? ` = ${solverC.toFixed(1)} °C` : ", dimensionless"}`];
  if (b.known && c.liqC != null) {
    const d = solverC - c.liqC;
    lines.push(`liquidus of the charge, the material's: ${c.liqC.toFixed(1)} °C (${c.liqSource})`
      + (Math.abs(d) > 1
        ? `; the solver's sits ${Math.abs(d).toFixed(1)} K ${d < 0 ? "below" : "above"} it: the model's depression m̃·c̃₀ is its own (materials.ts), not calibrated to this alloy`
        : "; the two agree to within 1 K"));
  }
  return lines;
}

// ------------------------------------------------------ the cooling curve

export interface CoolingInput {
  /** the lab's record: time since the pour, the mean liquid temperature
   *  (a non-positive value is "no liquid left"), the measured solid fraction */
  series: { t: number; T: number; fs: number }[];
  ta: ThermalAnalysis;
  /** latched at the pour */
  bridge: Bridge;
  /** the charge's chemistry, latched at the pour: its liquidus is drawn */
  chem: Chem;
  /** the full figure (the enlarged view): a third panel, measured vs derived f_s */
  full: boolean;
  prov: Prov;
}

/**
 * The run report's cooling curve, as a thermal-analysis figure: (a) the melt
 * temperature against time with the charge's liquidus and the extracted
 * landmarks, (b) its derivative dT/dt on its own axis (never a second y scale
 * on one plot), and in the full figure (c) the solid fraction the solver
 * measured against the one the Newtonian zero curve reconstructs.
 *
 * The liquidus line is the CHARGE's as the solver runs it (chargeLiquidus):
 * 1 − m̃·c̃₀ for a Kobayashi alloy, T̃ = 1 under the calibrated solver (its
 * reference state is the nominal alloy's liquidus), T_m for a pure melt.
 * Before U2 it was drawn at T̃ = 1 for every melt, which for a Kobayashi
 * Al–Cu put the line labelled "liquidus" at pure Al's melting point
 * (charts-audit 8.2). Where the solver's liquidus is not the material's own
 * (the Kobayashi kernel's depression is its own, not calibrated) the line
 * says "model" and the provenance prints both.
 */
export function coolingFigure(c: CoolingInput): Figure {
  const b = c.bridge;
  const s = c.series;
  const tMax = s.length ? s[s.length - 1].t : 0;
  const X = resolve(Q.time, b, tMax);
  const Tq = resolve(Q.temp, b);
  const R = resolve(Q.rate, b);
  const xs = s.map(p => X.conv(p.t));
  const Ts = s.map(p => (p.T > 0 ? Tq.conv(p.T) : NaN));
  const liq = Tq.conv(chargeLiquidus(c.chem));
  const [tlo, thi] = extent([Ts], { pad: 0.08, include: [liq] });
  const lm = (l: { t: number; T: number } | null, label: string) =>
    l ? [{ x: X.conv(l.t), y: Tq.conv(l.T), label }] : [];
  const temp: PanelSpec = {
    y: { title: Tq.title, short: Tq.short, lo: tlo, hi: thi },
    series: [{ key: "T", slot: 0, xs, ys: Ts, sym: Tq.sym, unit: Tq.unit }],
    refs: [{ y: liq, label: liquidusLabel(c.chem, b) }],
    marks: [...lm(c.ta.liquidus, "T_{L}"), ...lm(c.ta.nadir, "T_{N}"), ...lm(c.ta.growth, "T_{G}"), ...lm(c.ta.solidus, "T_{S}")],
    tag: "(a)",
    weight: 1.5,
  };
  const dx = c.ta.deriv.map(d => X.conv(d.t));
  const dy = c.ta.deriv.map(d => R.conv(d.dTdt));
  const [rlo, rhi] = extent([dy], { pad: 0.1, include: [0] });
  const rate: PanelSpec = {
    y: { title: R.title, short: R.short, lo: rlo, hi: rhi },
    series: [{ key: "dTdt", slot: 0, xs: dx, ys: dy, sym: R.sym, unit: R.unit }],
    refs: [{ y: 0 }],
    tag: "(b)",
    weight: 1,
  };
  const panels = [temp, rate];
  // (c) the two as FREEZING PROGRESS over [t_L, t_S]: the zero curve's f_s is
  // normalised by construction (0 at T_L, 1 at T_S, thermal.ts), so the
  // solver's f_s is rescaled over the same interval, exactly as the report's
  // "f_s curve vs census (RMS)" compares them; the raw f_s against a
  // normalised curve showed a gap that is not the method's error
  const prog = progressOf(s, c.ta);
  if (c.full) {
    const F = resolve(Q.fsProgress, b);
    panels.push({
      y: { title: F.title, short: F.short, lo: -0.04, hi: 1.04 },
      series: [
        { key: "fs_zc", label: "zero curve", slot: 0, xs: c.ta.fsDerived.map(d => X.conv(d.t)), ys: c.ta.fsDerived.map(d => d.fs), sym: "f_{s,zc}", unit: F.unit },
        { key: "fs", label: "solver, rescaled", slot: 1, xs, ys: prog, sym: "f_{s}*", unit: F.unit },
      ],
      tag: "(c)",
      weight: 1.2,
    });
  }
  // time since the pour: the axis starts at the pour, t = 0
  const [xlo, xhi] = s.length > 1 ? [Math.min(0, xs[0]), xs[xs.length - 1]] : [0, 1];
  const fig: FigSpec = {
    x: { title: X.title, short: X.short, lo: xlo, hi: xhi > xlo ? xhi : xlo + 1, sym: X.sym, unit: X.unit },
    panels,
    empty: s.filter(p => p.T > 0).length < 2 ? "no cooling record: pour and let it freeze" : null,
  };
  // the table and the CSV: one row per recorded sample. The derivative is
  // defined on the liquid prefix (thermal.ts), index for index; the
  // reconstructed f_s on the freezing interval, matched by time
  const zc = new Map(c.ta.fsDerived.map(d => [d.t, d.fs]));
  const columns: Column[] = [
    { key: "t", q: Q.time, values: s.map(p => p.t) },
    { key: "T", q: Q.temp, values: s.map(p => (p.T > 0 ? p.T : NaN)) },
    { key: "dTdt", q: Q.rate, values: s.map((_, i) => c.ta.deriv[i]?.dTdt ?? NaN) },
    { key: "fs_measured", q: Q.fs, values: s.map(p => p.fs) },
    { key: "fs_measured_rescaled", q: Q.fsProgressMeasured, values: prog },
    { key: "fs_zero_curve", q: Q.fsDerived, values: s.map(p => zc.get(p.t) ?? NaN) },
  ];
  return {
    title: "Cooling curve · run report", fig, columns, bridge: b,
    prov: { ...c.prov, chem: c.chem, extra: [...(c.prov.extra ?? []), ...liquidusProv(c.chem, b),
      "(c) freezing progress over [t_L, t_S]: the zero curve's f_s is 0 at T_L and 1 at T_S by construction; "
        + "the solver's f_s is rescaled over the same interval, (f_s − f_s(t_L))/(f_s(t_S) − f_s(t_L)), as the report's f_s RMS compares them"] },
  };
}

/** the solver's f_s as freezing progress over the zero curve's interval
 *  [t_L, t_S] (thermal.ts fsRms's rescaling), NaN outside it */
export function progressOf(s: { t: number; fs: number }[], ta: ThermalAnalysis): number[] {
  const d = ta.fsDerived;
  if (d.length < 2) return s.map(() => NaN);
  const t0 = d[0].t, t1 = d[d.length - 1].t;
  const i0 = s.findIndex(p => p.t === t0), i1 = s.findIndex(p => p.t === t1);
  if (i0 < 0 || i1 < 0) return s.map(() => NaN);
  const f0 = s[i0].fs, f1 = s[i1].fs;
  const den = Math.abs(f1 - f0) > 1e-6 ? f1 - f0 : 1;
  return s.map(p => (p.t >= t0 && p.t <= t1 ? (p.fs - f0) / den : NaN));
}

// --------------------------------------------------------------- the HUD

export interface HudSample {
  /** sim time, stored */
  t: number;
  fs: number;
  /** 2D: T_liq(c₀) − T_interface, stored; NaN while no interface exists */
  dt: number;
  grains: number;
  /** TRUE 3D: pore fraction, % */
  pore: number;
}
export type HudKey = "fs" | "dt" | "grains" | "pore";

/**
 * The HUD's ΔT: how far the mean interface temperature sits under the
 * charge's liquidus. With no interface cells the solver reports 0 for the
 * interface temperature, and the old strip plotted 1 − 0 = 1, its maximum,
 * before the first nucleus and after the last liquid (charts-audit 8.1); a
 * missing interface is a gap, NaN, never a number.
 */
export function hudDeltaT(interfaceCells: number, interfaceT: number, liquidus: number): number {
  return interfaceCells > 0 && Number.isFinite(interfaceT) ? liquidus - interfaceT : NaN;
}

/**
 * A live record: one series since it started, sampled at the stats poll but
 * kept only when SIM TIME has moved on (the poll runs while paused, and a
 * paused melt has nothing new to say). A new unit bridge, or time going
 * backwards (a reset solver), starts a new series. Past `cap` samples every
 * other one is dropped, the first and the latest always kept, and `recorded`
 * counts what was taken so the export can say it was decimated. The HUD, the
 * probes and the Scheil panels (2D and TRUE 3D) all record through this one
 * rule, so no series grows without bound (the 3D Scheil array did, until U2).
 */
export class TimedRecord<T extends { t: number }> {
  samples: T[] = [];
  recorded = 0;
  sig: string | null = null;
  constructor(readonly cap = 1200) {}
  clear(): void { this.samples = []; this.recorded = 0; this.sig = null; }
  /** true when the sample was kept */
  add(p: T, bridgeSig: string): boolean {
    const last = this.samples[this.samples.length - 1];
    if (this.sig !== bridgeSig || (last && p.t < last.t)) {
      this.samples = [];
      this.recorded = 0;
      this.sig = bridgeSig;
    } else if (last && !(p.t > last.t)) {
      return false;
    }
    this.samples.push(p);
    this.recorded++;
    if (this.samples.length > this.cap) {
      const end = this.samples[this.samples.length - 1];
      this.samples = this.samples.filter((_, i) => i % 2 === 0);
      if (this.samples[this.samples.length - 1] !== end) this.samples.push(end);
    }
    return true;
  }
}

/**
 * A record that also keeps the unit bridge and the chemistry its series
 * started under: a new bridge, or a new chemistry (the solver, the solute
 * field, m̃, c̃₀, k), starts a new series and is latched with it, so every
 * sample in a series converts one way and is compared with one alloy's
 * liquidus and Scheil path (an ALLOY toggle on the model metal changes no
 * bridge, and used to keep the series).
 */
export class LatchedRecord<T extends { t: number }> extends TimedRecord<T> {
  bridge: Bridge | null = null;
  chem: Chem | null = null;
  push(p: T, b: Bridge, chem?: Chem): boolean {
    const had = this.sig;
    const kept = this.add(p, chem ? `${b.sig}#${chemSig(chem)}` : b.sig);
    if (this.sig !== had || !this.bridge) { this.bridge = b; this.chem = chem ?? null; }
    return kept;
  }
  override clear(): void { super.clear(); this.bridge = null; this.chem = null; }
}

/** the HUD's record (the rule above, over the HUD's four quantities) */
export class HudRecord extends LatchedRecord<HudSample> {}

/** the ΔT card's quantity: an undercooling for a pure melt, the depth under
 *  the nominal liquidus for an alloy (Q.dTAlloy) */
export const dTOf = (chem: Chem | null): Quantity => (chem?.alloy ? Q.dTAlloy : Q.dT);
const qOf = (k: HudKey, chem: Chem | null): Quantity =>
  k === "fs" ? Q.fsPct : k === "dt" ? dTOf(chem) : k === "grains" ? Q.grains : Q.pore;
const valueOf = (k: HudKey, p: HudSample): number => (k === "fs" ? p.fs * 100 : p[k]);

/** a glance plot's content: what the card prints and what it draws */
export interface SparkModel {
  /** the latest value, formatted ("—" when there is none) */
  value: string;
  unit: string;
  /** the plotted y range, formatted: the card's min and max */
  range: string;
  lo: number;
  hi: number;
  xs: number[];
  ys: number[];
}

const signed = (s: string): string => (s.startsWith("-") ? MINUS + s.slice(1) : s);

export function hudSpark(k: HudKey, samples: HudSample[], b: Bridge, chem: Chem | null = null): SparkModel {
  const R = resolve(qOf(k, chem), b);
  const ys = samples.map(p => { const v = valueOf(k, p); return Number.isFinite(v) ? R.conv(v) : NaN; });
  const xs = samples.map(p => p.t);
  const dec = k === "fs" ? 1 : k === "grains" ? 0 : k === "pore" ? 2 : R.si ? 1 : 3;
  const fin = ys.filter(Number.isFinite);
  let lo = 0, hi = k === "fs" ? 100 : Math.max(0, ...fin);
  if (k !== "fs") lo = Math.min(0, ...fin);
  if (!(hi > lo)) hi = lo + (k === "grains" ? 1 : k === "dt" && !R.si ? 0.01 : 1);
  const last = ys.length ? ys[ys.length - 1] : NaN;
  const rdec = k === "fs" ? 0 : dec;
  const fmt = (v: number, d: number) => signed(v.toFixed(d));
  return {
    value: Number.isFinite(last) ? fmt(last, dec) : "—",
    unit: R.unit,
    range: `${fmt(lo, rdec)}–${fmt(hi, rdec)}`,
    lo, hi, xs, ys,
  };
}

/** the full plot's title; the ΔT one says what it is for an alloy */
export function hudTitle(k: HudKey, chem: Chem | null): string {
  if (k === "dt") return chem?.alloy ? "Interface temperature below the liquidus" : "Interface undercooling";
  return { fs: "Solid fraction", grains: "Grain count", pore: "Porosity" }[k];
}

/** the full plot a HUD card opens: the whole series against sim time.
 *  `chem` is the chemistry the series was recorded under (the ΔT card's
 *  liquidus and its name follow it) */
export function hudFigure(k: HudKey, samples: HudSample[], b: Bridge, prov: Prov, chem: Chem | null = null): Figure {
  const tMax = samples.length ? samples[samples.length - 1].t : 0;
  const X = resolve(Q.time, b, tMax);
  const q = qOf(k, chem);
  const Y = resolve(q, b);
  const xs = samples.map(p => X.conv(p.t));
  const ys = samples.map(p => { const v = valueOf(k, p); return Number.isFinite(v) ? Y.conv(v) : NaN; });
  const [lo, hi] = k === "fs" ? [-2, 102] : extent([ys], { pad: 0.06, include: [0] });
  const series: SeriesSpec = { key: k, slot: 0, xs, ys, sym: Y.sym, unit: Y.unit };
  const refs = k === "dt" ? [{ y: 0 }] : [];
  const [xlo, xhi] = xs.length > 1 ? [xs[0], xs[xs.length - 1]] : [0, 1];
  const fig: FigSpec = {
    x: { title: X.title, short: X.short, lo: xlo, hi: xhi > xlo ? xhi : xlo + 1, sym: X.sym, unit: X.unit },
    panels: [{ y: { title: Y.title, short: Y.short, lo, hi, niceHi: k === "grains" }, series: [series], refs }],
    empty: samples.length < 2 ? "recording starts when the melt runs" : null,
  };
  // the stems: outColumns adds the unit's suffix ("fs" -> "fs_percent")
  const columns: Column[] = [
    { key: "t", q: Q.time, values: samples.map(p => p.t) },
    { key: k === "dt" ? "dT" : k, q, values: samples.map(p => valueOf(k, p)) },
  ];
  const extra = k === "dt"
    ? [
      "ΔT = T_liq(c0) − mean temperature of the interface cells; an empty cell: no interface existed at that time",
      ...(chem?.alloy
        ? ["for an alloy most of this late in freezing is the liquidus shift of the solute-enriched interface liquid "
          + "(the Scheil path), not a kinetic undercooling: T_liq(c0) is the NOMINAL composition's liquidus"]
        : []),
      ...(chem ? liquidusProv(chem, b) : []),
    ]
    : [];
  return { title: `${hudTitle(k, chem)} · live`, fig, columns, bridge: b, prov: { ...prov, chem: chem ?? prov.chem, extra: [...(prov.extra ?? []), ...extra] } };
}

/** the grain-size card: bins with round edges, the mean as its value */
export function histSpark(diamsUm: number[]): { edges: number[]; counts: number[]; value: string; unit: string; range: string } {
  const h = bins(diamsUm, 12);
  const mean = diamsUm.length ? diamsUm.reduce((a, v) => a + v, 0) / diamsUm.length : NaN;
  const d = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
  return {
    ...h,
    value: diamsUm.length >= 3 ? d(mean) : "—",
    unit: "µm",
    range: h.edges.length ? `${d(h.edges[0])}–${d(h.edges[h.edges.length - 1])}` : "—",
  };
}

export function histFigure(diamsUm: number[], b: Bridge, prov: Prov, three: boolean): Figure {
  const h = bins(diamsUm, 14);
  const D = resolve({ ...Q.diam, name: three ? "Sphere-equivalent diameter" : "Circle-equivalent diameter" }, b);
  const N = resolve(Q.grains, b);
  const maxC = Math.max(1, ...h.counts);
  const fig: FigSpec = {
    x: { title: D.title, short: D.short, lo: h.edges[0] ?? 0, hi: h.edges[h.edges.length - 1] ?? 1, sym: D.sym, unit: D.unit },
    panels: [{ y: { title: N.title, short: N.short, lo: 0, hi: maxC, niceHi: true, sym: N.sym, unit: N.unit }, series: [],
      bars: { edges: h.edges, counts: h.counts, slot: 0 } }],
    empty: diamsUm.length < 3 ? "fewer than 3 grains: no distribution yet" : null,
  };
  const columns: Column[] = [
    { key: "bin_lo", q: Q.binLo, values: h.edges.slice(0, -1) },
    { key: "bin_hi", q: Q.binHi, values: h.edges.slice(1) },
    { key: "grains", q: Q.grains, values: h.counts },
  ];
  return {
    title: `Grain size distribution · ${three ? "sphere" : "circle"}-equivalent`, fig, columns, bridge: b,
    // its rows are bins over one census, not samples of a series: nothing
    // was decimated, whatever a caller's prov carried (a HUD's sample count
    // printed "decimated from 530 samples" here)
    prov: { ...prov, recorded: undefined, extra: [...(prov.extra ?? []), `${diamsUm.length} grains in the census; ${three ? "d = (6V/π)^(1/3)" : "d = 2(A/π)^(1/2)"}`] },
  };
}
