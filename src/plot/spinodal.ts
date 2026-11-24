// Spinodal decomposition figure builder (v8.5, Cahn–Hilliard 1958 + LSW 1961 + PFHub B1):
// supports two plot modes on the shared src/plot/ core:
//   - "energy":     total free energy F(t) vs. dimensionless time t (--data-1)
//   - "coarsening": log10 L(t) vs. log10 t (--data-1) + dashed t^(1/3) LSW reference (--data-2)
// Pure (zero DOM, zero hex colors, zero prose em dashes).

import {
  spinodalPlotBridge,
  type SpinodalSample,
} from "../spinodal";
import type { Figure } from "./figures";
import { extent, type PanelSpec, type RefSpec, type SeriesSpec } from "./layout";
import type { Column, Quantity } from "./quantity";
import type { Prov } from "./csv";

export type SpinodalPlotMode = "energy" | "coarsening";

const TIME_Q: Quantity = { kind: "id", sym: "t (dimless)", name: "Dimensionless time" };
const LOG_T_Q: Quantity = { kind: "id", sym: "log_{10}(t) (dimless)", name: "Log time" };
const FREE_E_Q: Quantity = { kind: "id", sym: "F (dimless)", name: "Total free energy" };
const CHEM_E_Q: Quantity = { kind: "id", sym: "F_{chem} (dimless)", name: "Chemical energy" };
const GRAD_E_Q: Quantity = { kind: "id", sym: "F_{grad} (dimless)", name: "Gradient energy" };
const LOG_L_Q: Quantity = { kind: "id", sym: "log_{10}(L) (dimless)", name: "Log domain length" };
const DOM_L_Q: Quantity = { kind: "id", sym: "L (dimless)", name: "Domain length" };

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Build a Figure-03 `PlotView` specification for Cahn–Hilliard free-energy decay
 * (`mode === "energy"`) or log-log LSW domain coarsening (`mode === "coarsening"`).
 */
export function spinodalFigure(
  history: readonly SpinodalSample[],
  mode: SpinodalPlotMode,
  lswSlope: number | null,
  presetLabel: string,
): Figure {
  const bridge = spinodalPlotBridge(presetLabel);
  const last = history.length > 0 ? history[history.length - 1] : null;

  if (mode === "energy") {
    const xs = history.map(s => s.t);
    const ys = history.map(s => s.F);
    const xLo = xs.length > 0 ? xs[0] : 0;
    const xHi = xs.length > 1 ? Math.max(xs[xs.length - 1], xLo + 1) : 100;
    const [rawLo, yHi] = ys.length > 0 ? extent([ys], { pad: 0.1 }) : [0, 350];
    const yLo = Math.max(0, rawLo);

    const series: SeriesSpec[] = [
      {
        key: "free_energy",
        label: "total F(t)",
        slot: 0,
        xs,
        ys,
        sym: "F",
        unit: "dimless",
      },
    ];

    const panel: PanelSpec = {
      y: {
        title: "Total free energy F (dimensionless)",
        short: "F (dimless)",
        lo: yLo,
        hi: yHi,
      },
      series,
      refs: [],
      live: last ? `t ${fmtNum(last.t)} · F ${fmtNum(last.F)}` : "press run to record F(t)",
    };

    const columns: Column[] = [
      { key: "t", q: TIME_Q, values: xs },
      { key: "F_total", q: FREE_E_Q, values: ys },
      { key: "F_chem", q: CHEM_E_Q, values: history.map(s => s.chemF) },
      { key: "F_grad", q: GRAD_E_Q, values: history.map(s => s.gradF) },
      { key: "L", q: DOM_L_Q, values: history.map(s => s.L) },
    ];

    const prov: Prov = {
      material: presetLabel,
      seed: "deterministic",
      grid: "periodic Cahn–Hilliard",
      solver: "Cahn–Hilliard (1958) / NIST PFHub B1",
      share: "#spinodal",
      build: "v8.5",
      recorded: history.length,
      extra: [
        "Model: conserved periodic Cahn–Hilliard (Cahn & Hilliard 1958; Jokisaari et al. 2017).",
        "Lyapunov functional: F(t) = int [f_chem(c) + 0.5*kappa*|grad c|^2] dV decays monotonically.",
      ],
    };

    return {
      title: `Spinodal free energy · ${presetLabel}`,
      bridge,
      fig: {
        x: {
          title: "Dimensionless time t (dimensionless)",
          short: "t (dimless)",
          sym: "t",
          unit: "dimless",
          lo: xLo,
          hi: xHi,
        },
        panels: [panel],
        empty: history.length < 2 ? "run to trace free energy decay F(t)" : null,
      },
      columns,
      prov,
    };
  }

  // Coarsening mode: log10 L(t) vs. log10 t with dashed t^(1/3) LSW reference
  const valid = history.filter(s => s.t > 0 && s.L > 0 && Number.isFinite(s.t) && Number.isFinite(s.L));
  const xs = valid.map(s => Math.log10(s.t));
  const ys = valid.map(s => Math.log10(s.L));

  const xLo = xs.length > 0 ? xs[0] : 0;
  const xHi = xs.length > 1 ? Math.max(xs[xs.length - 1], xLo + 0.5) : 3;

  // Anchor a dashed t^(1/3) reference line at the midpoint of the post-spinodal window
  const refXs: number[] = [];
  const refYs: number[] = [];
  if (valid.length >= 2) {
    const post = valid.filter(s => s.maxC - s.minC > 0.25);
    const anchor = post.length > 0 ? post[Math.floor(post.length / 2)] : valid[Math.floor(valid.length / 2)];
    const ax = Math.log10(anchor.t);
    const ay = Math.log10(anchor.L);
    refXs.push(xLo, xHi);
    refYs.push(ay + (1 / 3) * (xLo - ax), ay + (1 / 3) * (xHi - ax));
  }

  const allYs = refYs.length > 0 ? [ys, refYs] : [ys];
  const [yLo, yHi] = ys.length > 0 ? extent(allYs, { pad: 0.14 }) : [0, 2];

  const series: SeriesSpec[] = [
    {
      key: "domain_L",
      label: "log_{10} L(t)",
      slot: 0,
      xs,
      ys,
      sym: "log_{10} L",
      unit: "dimless",
    },
    ...(refXs.length === 2
      ? [
          {
            key: "lsw_ref",
            label: "LSW t^(1/3)",
            slot: 1 as const,
            xs: refXs,
            ys: refYs,
            dash: true,
            sym: "log_{10} L",
            unit: "dimless",
          },
        ]
      : []),
  ];

  const refs: RefSpec[] = [];
  const slopeBadge =
    lswSlope != null && Number.isFinite(lswSlope)
      ? `LSW slope α ${lswSlope.toFixed(2)} (theory 0.33)`
      : valid.length >= 2
        ? `L ${fmtNum(valid[valid.length - 1].L)} · coarsening`
        : "run to measure L(t) ~ t^(1/3)";

  const panel: PanelSpec = {
    y: {
      title: "Domain length log_{10}(L) (dimensionless)",
      short: "log_{10} L (dimless)",
      lo: yLo,
      hi: yHi,
    },
    series,
    refs,
    live: slopeBadge,
  };

  const columns: Column[] = [
    { key: "log10_t", q: LOG_T_Q, values: xs },
    { key: "log10_L", q: LOG_L_Q, values: ys },
    { key: "t", q: TIME_Q, values: valid.map(s => s.t) },
    { key: "L", q: DOM_L_Q, values: valid.map(s => s.L) },
  ];

  const prov: Prov = {
    material: presetLabel,
    seed: "deterministic",
    grid: "periodic Cahn–Hilliard",
    solver: "Cahn–Hilliard (1958) / Lifshitz–Slyozov (1961)",
    share: "#spinodal",
    build: "v8.5",
    recorded: valid.length,
    extra: [
      "Coarsening law: Lifshitz & Slyozov (1961), J. Phys. Chem. Solids 19:35–50 (L(t) ~ t^(1/3)).",
      `Measured LSW slope alpha: ${lswSlope != null && Number.isFinite(lswSlope) ? lswSlope.toFixed(3) : "n/a (pending coarsening window)"}.`,
    ],
  };

  return {
    title: `Spinodal coarsening · ${presetLabel}`,
    bridge,
    fig: {
      x: {
        title: "Time log_{10}(t) (dimensionless)",
        short: "log_{10} t (dimless)",
        sym: "log_{10} t",
        unit: "dimless",
        lo: xLo,
        hi: xHi,
      },
      panels: [panel],
      empty: valid.length < 2 ? "run to trace log-log coarsening L(t)" : null,
    },
    columns,
    prov,
  };
}
