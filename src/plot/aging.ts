// Precipitation age-hardening figure (v8.3, Shercliff & Ashby 1990):
// plots total yield strength σ_y (MPa) against log10 aging time (min) on the
// shared src/plot/ core, using only the categorical data palette slots.
import {
  AGING_CITATION,
  type AgingCurve,
  type AgingResult,
} from "../aging";
import type { Figure } from "./figures";
import { extent, type PanelSpec, type RefSpec, type SeriesSpec } from "./layout";
import type { Bridge, Column, Quantity } from "./quantity";
import type { Prov } from "./csv";

const AGING_TIME: Quantity = { kind: "seconds", sym: "t", name: "Aging time" };
const LOG_TIME: Quantity = { kind: "dimless", sym: "log_{10}(t / min)", name: "Log aging time" };
const SIGMA_Y: Quantity = { kind: "id", sym: "σ_{y} (MPa)", name: "Yield strength" };
const SIGMA_PPT: Quantity = { kind: "id", sym: "Δσ_{ppt} (MPa)", name: "Precipitate increment" };
const SIGMA_SS: Quantity = { kind: "id", sym: "Δσ_{ss} (MPa)", name: "Solid-solution increment" };
const P_BAR: Quantity = { kind: "dimless", sym: "P̄", name: "Normalized kinetic parameter" };

/**
 * Build an isothermal σ_y vs. log10(t / min) age-hardening figure with the
 * dialed hold marker and dashed chrome references for Hall–Petch baseline and
 * peak T6 strength. Pure (zero DOM) so CI and modal print exports share it.
 */
export function agingFigure(c: {
  curve: AgingCurve;
  result: AgingResult;
  holdMin: number;
  specMPa?: number;
  bridge: Bridge;
  prov: Prov;
}): Figure {
  const { curve, result, holdMin, bridge } = c;
  const pts = curve.points;
  const xs = pts.map(p => Math.log10(Math.max(1e-6, p.timeMin)));
  const ys = pts.map(p => p.sigmaTotalMPa);
  const xLo = xs.length ? xs[0] : 0;
  const xHi = xs.length ? xs[xs.length - 1] : Math.log10(60_000);
  const holdX = Math.log10(Math.max(1e-3, holdMin));
  const holdInRange = Number.isFinite(holdX) && holdX >= xLo && holdX <= xHi;

  const includeY = [curve.hpSigmaMPa, curve.peakTotalMPa, result.sigmaTotalMPa];
  if (c.specMPa && c.specMPa > 0) includeY.push(c.specMPa);
  const [rawLo, yHi] = extent([ys], { pad: 0.12, include: includeY });
  const yLo = Math.max(0, rawLo);

  const series: SeriesSpec[] = [
    {
      key: "total",
      label: "total σ_{y}",
      slot: 0,
      xs,
      ys,
      sym: "σ_{y}",
      unit: "MPa",
    },
    ...(holdInRange
      ? [{
          key: "hold",
          label: "dialed hold",
          slot: 1 as const,
          xs: [holdX],
          ys: [result.sigmaTotalMPa],
          kind: "dots" as const,
          sym: "σ_{y}",
          unit: "MPa",
        }]
      : []),
  ];

  const refs: RefSpec[] = [
    { y: curve.hpSigmaMPa, label: "Hall–Petch" },
  ];
  if (!curve.dissolved && curve.peakTotalMPa > curve.hpSigmaMPa + 1) {
    refs.push({ y: curve.peakTotalMPa, label: "peak T6" });
  }
  if (holdInRange) {
    refs.push({ x: holdX, label: "hold", slot: 1 });
  }

  const panel: PanelSpec = {
    y: {
      title: "Yield strength σ_{y} (MPa)",
      short: "σ_{y} (MPa)",
      lo: yLo,
      hi: yHi,
    },
    series,
    refs,
    live: `${result.temper} · ${result.sigmaTotalMPa.toFixed(0)} MPa`,
  };

  const columns: Column[] = [
    { key: "aging_time", q: AGING_TIME, values: pts.map(p => p.timeMin * 60) },
    { key: "log10_t_min", q: LOG_TIME, values: xs },
    { key: "sigma_total_MPa", q: SIGMA_Y, values: ys },
    { key: "delta_sigma_ppt_MPa", q: SIGMA_PPT, values: pts.map(p => p.sigmaPptMPa) },
    { key: "delta_sigma_ss_MPa", q: SIGMA_SS, values: pts.map(p => p.sigmaSsMPa) },
    { key: "p_bar", q: P_BAR, values: pts.map(p => p.pBar) },
  ];

  const extra: string[] = [
    ...(c.prov.extra ?? []),
    `Aging model: ${AGING_CITATION}.`,
    `Alloy: ${curve.spec.label} (${curve.spec.precipitates}), Q_A = ${(curve.spec.qA_Jmol / 1000).toFixed(0)} kJ/mol, T_solvus = ${curve.spec.solvusC} °C.`,
    `Isothermal curve at ${curve.tempC.toFixed(0)} °C on Hall–Petch baseline ${curve.hpSigmaMPa.toFixed(1)} MPa.`,
    `Dialed schedule (${holdMin.toFixed(0)} min hold, full ramp+hold+cool): ${result.temper}, total σ_y = ${result.sigmaTotalMPa.toFixed(1)} MPa (Δσ_ss = ${result.sigmaSsMPa.toFixed(1)} MPa, Δσ_ppt = ${result.sigmaPptMPa.toFixed(1)} MPa).`,
  ];
  if (result.dissolved) {
    extra.push(`Peak temperature (${result.peakC.toFixed(0)} °C) reached or exceeded T_solvus (${curve.spec.solvusC} °C): precipitates dissolved into solid solution (T4).`);
  } else if (curve.tPeakMin != null && Number.isFinite(curve.tPeakMin)) {
    const peakStr = curve.tPeakMin < 120
      ? `${curve.tPeakMin.toFixed(1)} min`
      : `${(curve.tPeakMin / 60).toFixed(1)} h`;
    extra.push(`Isothermal time to peak T6 at ${curve.tempC.toFixed(0)} °C: ${peakStr}.`);
  }

  return {
    title: `Age-hardening curve · ${curve.spec.name} (${curve.tempC.toFixed(0)} °C)`,
    bridge,
    fig: {
      x: {
        title: "Aging time log_{10}(t / min) (dimensionless)",
        short: "log_{10}(t/min) (dimensionless)",
        sym: "log_{10}(t/min)",
        unit: "dimensionless",
        lo: xLo,
        hi: xHi,
      },
      panels: [panel],
      empty: pts.length < 2 ? "select an age-hardenable Al alloy" : null,
    },
    columns,
    prov: { ...c.prov, recorded: pts.length, extra },
  };
}
