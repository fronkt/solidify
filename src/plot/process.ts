// Process plots use their owners' recorded data. The furnace has its own
// physical clock; it never passes through the solidification unit bridge.
import { chargeLiquidus, liquidusLabel, liquidusProv, Q, type Chem, type Figure } from "./figures";
import { extent, type PanelSpec } from "./layout";
import { resolve, type Bridge, type Column, type Quantity } from "./quantity";
import type { Prov } from "./csv";
import { grainAfter, integrate, type HeatSchedule } from "../heattreat";
import type { MaterialSI } from "../units";

export function livePourFigure(c: {
  series: readonly { t: number; T: number | null; fs: number; fired?: number }[];
  bridge: Bridge; chem: Chem; prov: Prov;
}): Figure {
  const { bridge: b, series: s } = c;
  const X = resolve(Q.time, b, s.at(-1)?.t ?? 0), T = resolve(Q.temp, b);
  const xs = s.map(p => X.conv(p.t));
  const ys = s.map(p => p.T != null && Number.isFinite(p.T) ? T.conv(p.T) : NaN);
  const liq = T.conv(chargeLiquidus(c.chem));
  const [lo, hi] = extent([ys], { pad: 0.08, include: [liq] });
  return {
    title: "Live pour cooling curve", bridge: b,
    fig: {
      x: { title: X.title, short: X.short, sym: X.sym, unit: X.unit, lo: 0, hi: Math.max(xs.at(-1) ?? 0, 1e-9) },
      panels: [
        { y: { title: T.title, short: T.short, lo, hi }, series: [{ key: "T", slot: 0, xs, ys, sym: T.sym, unit: T.unit }], refs: [{ y: liq, label: liquidusLabel(c.chem, b) }], tag: "(a)" },
        { y: { title: "Solid fraction f_{s} (dimensionless)", short: "f_{s} (dimensionless)", lo: 0, hi: 1 }, series: [{ key: "fs", slot: 1, xs, ys: s.map(p => p.fs), sym: "f_{s}", unit: "dimensionless" }], tag: "(b)" },
      ],
      empty: s.length < 2 ? "pour and run to record the cooling curve" : null,
    },
    columns: [
      { key: "t", q: Q.time, values: s.map(p => p.t) },
      { key: "T", q: Q.temp, values: s.map(p => p.T ?? NaN) },
      { key: "fs_measured", q: Q.fs, values: s.map(p => p.fs) },
      { key: "sites_fired", q: { kind: "count", sym: "N_{fired}", name: "Activated sites" }, values: s.map(p => p.fired ?? NaN) },
    ],
    prov: { ...c.prov, chem: c.chem, extra: [...(c.prov.extra ?? []), ...liquidusProv(c.chem, b), "Temperature is the mean over liquid cells; a blank temperature means no liquid remained."] },
  };
}

export interface ConvergenceSample { episode: number; error: number | null; best: number | null; score: number }
const EP: Quantity = { kind: "count", sym: "n", name: "Casting" };
const ERR: Quantity = { kind: "dimless", sym: "|ΔG|", name: "Grain-number error" };
const SCORE: Quantity = { kind: "dimless", sym: "S", name: "Search score" };

export function convergenceFigure(series: readonly ConvergenceSample[], b: Bridge, prov: Prov, target: number, recorded = series.length): Figure {
  const xs = series.map(s => s.episode), err = series.map(s => s.error ?? NaN), best = series.map(s => s.best ?? NaN);
  const [lo, hi] = extent([err, best], { include: [0], pad: 0.1 });
  return {
    title: "Optimizer convergence", bridge: b,
    fig: {
      x: { title: "Casting n (count)", short: "n (count)", sym: "n", unit: "count", lo: 0, hi: Math.max(1, xs.at(-1) ?? 0) },
      panels: [{ y: { title: "Grain-number error |ΔG| (dimensionless)", short: "|ΔG| (dimensionless)", lo, hi }, series: [
        { key: "error", label: "casting", slot: 1, xs, ys: err, kind: "dots", sym: "|ΔG|", unit: "dimensionless" },
        { key: "best", label: "best so far", slot: 0, xs, ys: best, sym: "|ΔG|", unit: "dimensionless" },
      ], refs: [{ y: 0, label: "target" }] }],
      empty: series.length ? null : "run the optimizer to record completed castings",
    },
    columns: [
      { key: "casting", q: EP, values: xs },
      { key: "error", q: ERR, values: err },
      { key: "best_error", q: ERR, values: best },
      { key: "score", q: SCORE, values: series.map(s => s.score) },
    ],
    prov: { ...prov, recorded, extra: [...(prov.extra ?? []), `Target ASTM grain number G = ${target}.`, "Each point is a completed 256² model casting. Error is |G − target|; score also includes 0.15 × used step budget. Blank error means no valid grain-size census."] },
  };
}

export interface HeatPoint { seconds: number; tempC: number; lawUm: number }
export interface HeatMeasurement { seconds: number; diameterUm: number }
const HTIME: Quantity = { kind: "seconds", sym: "t", name: "Furnace time" };
const HTEMP: Quantity = { kind: "celsius", sym: "T", name: "Scheduled temperature" };

/** Sample each physical stage, integrating the same material law as the panel. */
export function heatTrajectory(sch: HeatSchedule, si: MaterialSI, d0Um: number): HeatPoint[] {
  const out: HeatPoint[] = [{ seconds: 0, tempC: sch.startC, lawUm: d0Um }];
  let temp = sch.startC, seconds = 0, gg = 0;
  for (const stage of sch.stages) {
    const end = stage.kind === "hold" ? temp : stage.toC;
    const dur = stage.kind === "hold" ? stage.minutes * 60
      : Math.abs(end - temp) / Math.max(1e-6, Math.abs(stage.kind === "ramp" ? stage.cPerMin / 60 : stage.cPerSec));
    if (!(dur > 0)) { temp = end; continue; }
    const steps = 48;
    for (let i = 1; i <= steps; i++) {
      const next = temp + (end - temp) * i / steps;
      const prev = temp + (end - temp) * (i - 1) / steps;
      const sub: HeatSchedule = { name: sch.name, startC: prev, stages: stage.kind === "hold"
        ? [{ kind: "hold", minutes: dur / steps / 60 }]
        : [{ kind: "ramp", toC: next, cPerMin: Math.abs(end - temp) / dur * 60 }] };
      gg += integrate(sub, si, 64).gg;
      out.push({ seconds: seconds + dur * i / steps, tempC: next, lawUm: grainAfter(d0Um * 1e-6, gg, si) * 1e6 });
    }
    seconds += dur;
    temp = end;
  }
  return out;
}

/** Locate the physical time whose material-law grain growth buys this budget. */
export function equivalentHeatTime(points: readonly HeatPoint[], diameterUm: number): number {
  if (!points.length || diameterUm <= points[0].lawUm) return 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], z = points[i];
    if (z.lawUm >= diameterUm) {
      const f = z.lawUm > a.lawUm ? (diameterUm - a.lawUm) / (z.lawUm - a.lawUm) : 0;
      return a.seconds + Math.max(0, Math.min(1, f)) * (z.seconds - a.seconds);
    }
  }
  return points.at(-1)!.seconds;
}

export function heatProcessFigure(c: {
  points: readonly HeatPoint[]; measured: readonly HeatMeasurement[]; bridge: Bridge; prov: Prov;
  lawAvailable: boolean; progressSeconds?: number; planned?: boolean;
}): Figure {
  const s = c.points, b = c.bridge, X = resolve(HTIME, b, s.at(-1)?.seconds ?? 0);
  const xs = s.map(p => X.conv(p.seconds)), ts = s.map(p => p.tempC), ds = s.map(p => c.lawAvailable ? p.lawUm : NaN);
  const measured = new Map(c.measured.map(p => [p.seconds, p.diameterUm]));
  const [tlo, thi] = extent([ts], { pad: 0.1 }), [dlo, dhi] = extent([ds, c.measured.map(p => p.diameterUm)], { pad: 0.1 });
  const refs = c.progressSeconds != null ? [{ x: X.conv(c.progressSeconds), label: "delivered budget", slot: 0 as const }] : [];
  const panels: PanelSpec[] = [
    { y: { title: "Scheduled temperature T (°C)", short: "T (°C)", lo: tlo, hi: thi }, series: [{ key: "T", slot: 0, xs, ys: ts, sym: "T", unit: "°C" }], refs, tag: "(a)" },
    { y: { title: "Grain diameter d (µm)", short: "d (µm)", lo: dlo, hi: dhi }, series: [
      { key: "law", label: "material law", slot: 1, xs, ys: ds, sym: "d_{law}", unit: "µm", dash: true },
      { key: "measured", label: "census", slot: 0, xs: c.measured.map(p => X.conv(p.seconds)), ys: c.measured.map(p => p.diameterUm), kind: "dots", sym: "d", unit: "µm" },
    ], refs, tag: "(b)" },
  ];
  // An outer join keeps measured endpoints at their actual equivalent time.
  const allTimes = [...new Set([...s.map(p => p.seconds), ...measured.keys()])].sort((a, z) => a - z);
  const at = new Map(s.map(p => [p.seconds, p]));
  const columns: Column[] = [
    { key: "furnace_time", q: HTIME, values: allTimes },
    { key: "scheduled_temperature", q: HTEMP, values: allTimes.map(t => at.get(t)?.tempC ?? NaN) },
    { key: "law_diameter", q: Q.diam, values: allTimes.map(t => c.lawAvailable ? at.get(t)?.lawUm ?? NaN : NaN) },
    { key: "measured_diameter", q: Q.diam, values: allTimes.map(t => measured.get(t) ?? NaN) },
  ];
  return {
    title: c.planned ? "Planned heat treatment" : "Heat-treatment schedule and grain size", bridge: b, columns,
    fig: { x: { title: X.title, short: X.short, sym: X.sym, unit: X.unit, lo: 0, hi: Math.max(xs.at(-1) ?? 0, 1) }, panels, empty: !s.length ? "select a material and measure its grains" : null },
    prov: { ...c.prov, extra: [...(c.prov.extra ?? []), "Furnace time is real schedule time in seconds, separate from the solidification clock. Scheduled temperatures are °C directly.",
      "The dashed curve is a material-law prediction; dots are measured before/after grain censuses. The delivered endpoint uses equivalent Arrhenius-budget time, not wall time.",
      ...(c.lawAvailable ? [] : ["The grain-growth law is withdrawn for pinning or stored energy; only the schedule and measured endpoints are shown."]),
      ...(c.planned ? ["Planned schedule only; no treatment has been delivered."] : []),
    ] },
  };
}
