// Jackson-Hunt (1966) binary eutectic spacing / undercooling figure (v8.4):
// plots front undercooling ΔT(λ) = K₁Vλ + K₂/λ (--data-1), extremum references
// (λ_min, ΔT_min), and the live GPU operating point (--data-2) on the shared
// src/plot/ core. Pure (zero DOM, zero hex colors, zero prose em dashes).

import {
  eutecticPlotBridge,
  type EutecticAlloy,
  type JacksonHuntModel,
} from "../eutectic";
import type { Figure } from "./figures";
import { extent, type PanelSpec, type RefSpec, type SeriesSpec } from "./layout";
import type { Column, Quantity } from "./quantity";
import type { Prov } from "./csv";

const LAMBDA_UM: Quantity = { kind: "id", sym: "λ (µm)", name: "Lamellar spacing" };
const LAMBDA_CELLS: Quantity = { kind: "id", sym: "λ (cells)", name: "Lamellar spacing" };
const DT_K: Quantity = { kind: "id", sym: "ΔT (K)", name: "Front undercooling" };
const DT_SIM: Quantity = { kind: "id", sym: "ΔT (dimless)", name: "Front undercooling" };

function fmtSig(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Build a Figure-03 Jackson–Hunt ΔT(λ) curve for the active eutectic alloy and
 * pull speed, with the minimum-undercooling extremum and optional live GPU point.
 */
export function jacksonHuntFigure(
  alloy: EutecticAlloy,
  jh: JacksonHuntModel,
  pullVUmS: number,
  live?: { lambdaUm: number | null; dTK: number | null },
): Figure {
  const isSym = alloy.id === "symmetric";
  const xUnit = isSym ? "cells" : "µm";
  const yUnit = isSym ? "dimless" : "K";
  const vLabel = isSym ? `V ${fmtSig(pullVUmS)} (scale)` : `V ${fmtSig(pullVUmS)} µm/s`;

  const lamMin = Math.max(1e-4, jh.lambdaMinUm);
  const dTMin = Math.max(1e-6, jh.dTMinK);

  const hasLive =
    live != null &&
    live.lambdaUm != null &&
    live.dTK != null &&
    Number.isFinite(live.lambdaUm) &&
    Number.isFinite(live.dTK) &&
    live.lambdaUm > 0 &&
    live.dTK >= 0;

  // Span [0.35 * lamMin, 3.0 * lamMin], widened if the live GPU point lies outside
  let xLo = lamMin * 0.35;
  let xHi = lamMin * 3.0;
  if (hasLive) {
    const lx = live!.lambdaUm!;
    if (lx < xLo * 1.05) xLo = Math.max(lamMin * 0.15, lx * 0.8);
    if (lx > xHi * 0.95) xHi = lx * 1.18;
  }

  const nPts = 96;
  const xs: number[] = [];
  const ys: number[] = [];
  const ratio = xHi / xLo;
  for (let i = 0; i < nPts; i++) {
    const lam = xLo * Math.pow(ratio, i / (nPts - 1));
    xs.push(lam);
    ys.push(jh.dTPhys(lam));
  }

  const includeY = [dTMin];
  if (hasLive) includeY.push(live!.dTK!);
  // Cap extreme left-tail capillary spike so the minimum bowl stays clear
  const yCap = Math.max(dTMin * 3.2, hasLive ? live!.dTK! * 1.25 : 0);
  const ysClipped = ys.map(y => Math.min(y, yCap));
  const [rawLo, yHi] = extent([ysClipped], { pad: 0.12, include: includeY });
  const yLo = Math.max(0, Math.min(rawLo, dTMin * 0.45));

  const series: SeriesSpec[] = [
    {
      key: "jh",
      label: "Jackson–Hunt ΔT(λ)",
      slot: 0,
      xs,
      ys,
      sym: "ΔT",
      unit: yUnit,
    },
    ...(hasLive
      ? [
          {
            key: "live",
            label: "live GPU",
            slot: 1 as const,
            xs: [live!.lambdaUm!],
            ys: [live!.dTK!],
            kind: "dots" as const,
            sym: "ΔT",
            unit: yUnit,
          },
        ]
      : []),
  ];

  const refs: RefSpec[] = [
    { x: lamMin, label: `λ_{min} ${fmtSig(lamMin)} ${xUnit}` },
    { y: dTMin, label: `ΔT_{min} ${fmtSig(dTMin)} ${yUnit}` },
  ];

  const liveBadge = hasLive
    ? `live λ ${fmtSig(live!.lambdaUm!)} ${xUnit} · ΔT ${fmtSig(live!.dTK!)} ${yUnit}`
    : `λ_{min} ${fmtSig(lamMin)} ${xUnit} · ΔT_{min} ${fmtSig(dTMin)} ${yUnit}`;

  const panel: PanelSpec = {
    y: {
      title: isSym ? "Front undercooling ΔT (dimensionless)" : "Front undercooling ΔT (K)",
      short: isSym ? "ΔT (dimless)" : "ΔT (K)",
      lo: yLo,
      hi: yHi,
    },
    series,
    refs,
    live: liveBadge,
  };

  const columns: Column[] = [
    { key: isSym ? "lambda_cells" : "lambda_um", q: isSym ? LAMBDA_CELLS : LAMBDA_UM, values: xs },
    { key: isSym ? "dT_sim" : "dT_K", q: isSym ? DT_SIM : DT_K, values: ys },
  ];

  const extra: string[] = [
    `Analytical curve: Jackson & Hunt (1966), Trans. Metall. Soc. AIME 236:1129–1142.`,
    `Phase-field solver: Folch & Plapp (2005), Phys. Rev. E 72, 011602 (2D isotropic diffuse-interface model).`,
    `Alloy: ${alloy.label}; ${vLabel}; f_alpha = ${jh.fAlpha.toFixed(3)}, P(f_alpha) = ${jh.pSeries.toFixed(5)}.`,
    `Extremum: lambda_min = ${fmtSig(lamMin)} ${xUnit}, dT_min = ${fmtSig(dTMin)} ${yUnit}, lambda^2*V = ${fmtSig(jh.lambda2VPhys)} ${isSym ? "cells^3/t" : "um^3/s"}.`,
  ];
  if (alloy.caveat) extra.push(`Caveat: ${alloy.caveat}`);

  const prov: Prov = {
    material: alloy.label,
    seed: "deterministic",
    grid: "256² cells (2D eutectic)",
    solver: "Folch–Plapp (2005) 3-phase binary eutectic",
    share: `#eutectic=${alloy.id}`,
    build: "v8.4",
    recorded: xs.length,
    extra,
  };

  return {
    title: `Jackson–Hunt curve · ${alloy.label} (${vLabel})`,
    bridge: eutecticPlotBridge(alloy),
    fig: {
      x: {
        title: isSym ? "Lamellar spacing λ (cells)" : "Lamellar spacing λ (µm)",
        short: isSym ? "λ (cells)" : "λ (µm)",
        sym: "λ",
        unit: xUnit,
        lo: xLo,
        hi: xHi,
      },
      panels: [panel],
      empty: xs.length < 2 ? "select a eutectic alloy" : null,
    },
    columns,
    prov,
  };
}
