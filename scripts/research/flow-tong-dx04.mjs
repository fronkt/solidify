/**
 * Tong et al. (2001, PRE 63:061601) Table II D2 Benchmark at dx = 0.4 W0 on 2048^2
 *
 * Implements the missing experiment identified in PR #12 commit 81da644 (reading item 4):
 * run Tong D2 (Delta = 0.55, eps4 = 0.05, Pr = 23.1, lambda = 3.19, U d0 / D = 0.035)
 * at dx = 0.4 W0 on a 2048 x 2048 grid (physical box 819.2 W0 = 2956.5 d0) with BOTH
 * no-flow (NF2048) and Zou-He forced melt flow (FL2048), enabled by the split-buffer
 * 2D D2Q9 LBM solver (src/lbm.ts, src/flow.ts).
 *
 * Pre-registered acceptance rule (frozen before running):
 *   CALIBRATED_BAND_PASS iff ALL of the following hold simultaneously:
 *     1. |V_flow - V_flow_tong| / V_flow_tong <= 0.05   (V_flow_tong = 0.0247)
 *     2. |R - R_tong| / R_tong <= 0.05                  (R_tong = 1.372, R = V_flow / V_noflow)
 *     3. |drift_noflow| <= 0.02 AND |drift_flow| <= 0.02 (stationarity = vLast / vMid - 1)
 *     4. tau * V / W <= 0.2 for both arms
 *     5. Zero GPU/console/page/NaN errors, full substep delivery, Zou-He inlet |inletUx - 1| <= 1e-4,
 *        no stop-rule trip, hardware WebGPU adapter
 *   Otherwise: QUALITATIVE_STANDS (2D melt flow remains labeled qualitative).
 *
 * Usage:
 *   node scripts/research/flow-tong-dx04.mjs --selftest
 *   node scripts/research/flow-tong-dx04.mjs --plan [--chunks=33]
 *   node scripts/research/flow-tong-dx04.mjs --run [--port=5297] [--chunks=33] [--out=docs/validation/flow-tong-dx04-YYYY-MM-DD.json] [--arms=NF2048,FL2048]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};

// ------------------------------------------------------------ constants & rules

/** Exact Tong et al. (2001, PRE 63:061601) Table I & II row D2 staging constants */
export const K = deepFreeze({
  A1: 0.8839,
  A2: 0.6267,
  DELTA: 0.55,
  EPS4: 0.05,
  PR: 23.1,
  UD0D: 0.035,
  LAMBDA: 3.19,
  DX: 0.4,
  DX_COARSE: 0.8,
  N: 2048,
  SEED_X: 1024,
  SEED_Y: 1024,
  SEED_R_W0: 8.0,
  DIFFUSION_NUMBER: 0.15,
  TRAVEL_LD: 8,
  DEFAULT_CHUNKS: 33,
  /** Exact 4 x 671 = 2684 substeps/chunk (bit-identical sample times to PR #12 R1024/H2048) */
  CHUNK_COARSE: 671,
  CHUNK_FINE: 2684,
  STOP_CELLS: 32,
});

/** Published Tong et al. (2001, PRE 63:061601) Table I & II row D2 reference numbers */
export const TONG_D2 = deepFreeze({
  citation: "X. Tong, C. Beckermann, A. Karma, and Q. Li, Phase-field simulations of dendritic crystal growth in a forced flow, Phys. Rev. E 63 (2001) 061601, Tables I & II (row D2).",
  rowId: "D2",
  D: 2,
  lambda: 3.19,
  tongBoxD0: 1479,
  exactNoflowVd0D: 0.0170,
  tongNoflowVd0D: 0.0180,
  tongFlowVd0D: 0.0247,
  tongRatio: 1.372,
});

/** Prior PR #12 measurements for side-by-side comparison (recorded in commits 22f3c7d, 81da644) */
export const PR12_BASELINE = deepFreeze({
  commit: "81da644ad62fe39524459fae73257bb18d6b29b5",
  dx08_tong3_P768_flowVd0D: 0.021946,
  dx08_R1024_m33_noflowVd0D: 0.016273,
  dx08_R1024_m33_drift: -0.04454,
  dx08_R1024_lateL_noflowVd0D: 0.015519,
  dx08_R1024_lateL_drift: -0.0128,
  dx08_descriptiveRatio: 0.021946 / 0.015519,
  dx04_H2048_m33_noflowVd0D: 0.017153,
  dx04_H2048_m33_drift: -0.03657,
  dx04_H2048_lateL_noflowVd0D: 0.016531,
  dx04_H2048_lateL_drift: -0.0087,
});

/** Pre-registered acceptance gates (frozen before any GPU run) */
export const RULES = deepFreeze({
  flowSpeedRelTol: 0.05,
  ratioRelTol: 0.05,
  driftMax: 0.02,
  tauVWMax: 0.2,
  inletTol: 1e-4,
  mirrorTol: 0.05,
});

/** Local Arc 140V wall-time model (NF2048: 81da644 2.54 ms/substep; FL2048 Planar SoA: 49.0 s / 2684 = 18.26 ms/substep) */
export const COST = deepFreeze({
  noflowMsPerSubstep2048: 552000 / 217404,
  flowMsPerSubstep2048: 49000 / 2684,
});

// ------------------------------------------------------------ staging arithmetic

/** Compute exact Tong D2 staging at dx = 0.4 W0 (or dx = 0.8 W0 for comparison) */
export function stagingDx(dx = K.DX, n = K.N, chunks = K.DEFAULT_CHUNKS) {
  const { A1, A2, LAMBDA, DIFFUSION_NUMBER, PR, UD0D, SEED_R_W0, TRAVEL_LD, CHUNK_COARSE, CHUNK_FINE } = K;
  const sideW0 = n * dx;
  const dTilde = A2 * LAMBDA;
  const dt = (DIFFUSION_NUMBER * dx * dx) / Math.max(1, dTilde);
  const vKR = (TONG_D2.exactNoflowVd0D * dTilde * LAMBDA) / A1; // W0 / tau0
  const lD = dTilde / vKR;                                     // W0
  const tTravel = (TRAVEL_LD * lD) / vKR;                      // 8 l_D / V_KR
  const chunk = Math.abs(dx - K.DX) < 1e-12
    ? CHUNK_FINE
    : Math.abs(dx - K.DX_COARSE) < 1e-12
      ? CHUNK_COARSE
      : Math.round(tTravel / K.DEFAULT_CHUNKS / dt);
  const substeps = chunk * chunks;
  const tTotal = substeps * dt;
  const uLat = UD0D * (LAMBDA / A1) * DIFFUSION_NUMBER * dx;   // cells / substep
  const d = (dTilde * dt) / (dx * dx);                         // exact 0.15
  const nuLat = d * PR;
  const tau = 0.5 + 3 * nuLat;
  const mach = uLat * Math.sqrt(3);
  const peCell = uLat / d;
  const cellD0 = (dx * LAMBDA) / A1;
  const boxD0 = n * cellD0;
  const seedRCells = SEED_R_W0 / dx;
  const vTongW0 = (TONG_D2.tongFlowVd0D * dTilde * LAMBDA) / A1;
  const predictedFlowTravelCells = (vTongW0 * tTotal) / dx;
  const predictedNoflowTravelCells = (vKR * tTotal) / dx;
  const seedX = n / 2;
  const seedY = n / 2;
  return {
    lambda: LAMBDA,
    dx,
    n,
    seedX,
    seedY,
    sideW0,
    cellD0,
    boxD0,
    dTilde,
    dt,
    vKR,
    lD,
    lDCells: lD / dx,
    tTravel,
    chunks,
    chunk,
    substeps,
    tTotal,
    tTotalInLD: (tTotal * vKR) / lD,
    uLat,
    diffusionNumber: d,
    nuLat,
    tau,
    mach,
    peCell,
    nuOverUCells: nuLat / uLat,
    seedRCells,
    predictedFlowEndGapCells: seedX - seedRCells - predictedFlowTravelCells,
    predictedNoflowEndGapCells: seedX - seedRCells - predictedNoflowTravelCells,
  };
}

/** Build the two pre-registered 2048^2 dx = 0.4 arms: NF2048 and FL2048 */
export function buildArms(chunks = K.DEFAULT_CHUNKS) {
  const s = stagingDx(K.DX, K.N, chunks);
  return [
    {
      id: "NF2048",
      kind: "noflow",
      flowScale: null,
      n: K.N,
      dx: K.DX,
      seedX: s.seedX,
      seedY: s.seedY,
      staging: s,
      estWallS: (COST.noflowMsPerSubstep2048 * s.substeps) / 1000,
    },
    {
      id: "FL2048",
      kind: "flow",
      flowScale: 1,
      n: K.N,
      dx: K.DX,
      seedX: s.seedX,
      seedY: s.seedY,
      staging: s,
      estWallS: (COST.flowMsPerSubstep2048 * s.substeps) / 1000,
    },
  ];
}

// ------------------------------------------------------------ tip & drift math

/** West tip (upstream): first phi = 0.5 crossing scanning west from `from` */
export function westTip(row, from) {
  for (let i = from; i > 0; i--) {
    if (row[i] >= 0.5 && row[i - 1] < 0.5) {
      const a = row[i - 1];
      const b = row[i];
      return (i - 1) + (0.5 - a) / (b - a);
    }
  }
  return NaN;
}

/** East tip (downstream): first phi = 0.5 crossing scanning east from `from` */
export function eastTip(row, from) {
  for (let i = from; i < row.length - 1; i++) {
    if (row[i] >= 0.5 && row[i + 1] < 0.5) {
      const a = row[i];
      const b = row[i + 1];
      return i + (a - 0.5) / (a - b);
    }
  }
  return NaN;
}

/** North/south crossings on a column through seedX and mirror defect yN + yS - (n - 1) */
export function columnMirror(col, from) {
  const n = col.length;
  let yN = NaN;
  let yS = NaN;
  for (let j = from; j < n - 1; j++) {
    if (col[j] >= 0.5 && col[j + 1] < 0.5) {
      yN = j + (col[j] - 0.5) / (col[j] - col[j + 1]);
      break;
    }
  }
  for (let j = from - 1; j > 0; j--) {
    if (col[j] >= 0.5 && col[j - 1] < 0.5) {
      yS = j - (col[j] - 0.5) / (col[j] - col[j - 1]);
      break;
    }
  }
  const mirror = yN + yS - (n - 1);
  return {
    yN: Number.isFinite(yN) ? yN : null,
    yS: Number.isFinite(yS) ? yS : null,
    mirror: Number.isFinite(mirror) ? mirror : null,
  };
}

/** Ordinary least-squares slope dx/dt */
export function slope(points) {
  if (!points || points.length < 2) return NaN;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) {
    sx += p.t;
    sy += p.x;
    sxy += p.t * p.x;
    sxx += p.t * p.t;
  }
  const denom = points.length * sxx - sx * sx;
  return denom === 0 ? NaN : (points.length * sxy - sx * sy) / denom;
}

/** Split trace into middle third and final third (exact Tong comparison window) */
export function windows(trace) {
  const third = Math.floor(trace.length / 3);
  return {
    mid: trace.slice(third, 2 * third),
    last: trace.slice(2 * third),
  };
}

/** Convert W0/tau0 tip velocity to dimensionless V d0 / D */
export function toVd0D(vW0, lambda = K.LAMBDA) {
  return Number.isFinite(vW0) ? (vW0 * K.A1) / (K.A2 * lambda * lambda) : null;
}

/** Thin-interface kinetic ratio tau * V / W (with tau0 = W0 = 1, equals v in W0 / tau0) */
export function tauVWFromVd0D(vd0D, lambda = K.LAMBDA) {
  return Number.isFinite(vd0D) ? vd0D * (K.A2 * lambda) * (lambda / K.A1) : null;
}

/** Compute tip speed, stationarity drift, per-chunk series, and late-window slope drift */
export function summarizeTrace(trace, lambda = K.LAMBDA, dx = K.DX) {
  const validPts = trace.filter(p => Number.isFinite(p.t) && Number.isFinite(p.xWest));
  const { mid, last } = windows(validPts);
  const west = (w) => w.map(p => ({ t: p.t, x: p.xWest }));
  const east = (w) => w.filter(p => Number.isFinite(p.xEast)).map(p => ({ t: p.t, x: p.xEast }));

  const vLast = -slope(west(last)) * dx;
  const vMid = -slope(west(mid)) * dx;
  const vEastLast = east(last).length >= 2 ? slope(east(last)) * dx : NaN;
  const drift = Number.isFinite(vLast) && Number.isFinite(vMid) && vMid !== 0 ? vLast / vMid - 1 : null;
  const vd0D = toVd0D(vLast, lambda);
  const vd0DMid = toVd0D(vMid, lambda);
  const tauVW = Number.isFinite(vLast) ? vLast : null;

  // Per-chunk instantaneous speed series v_k = -(x_k - x_{k-1}) * dx / (t_k - t_{k-1})
  const perChunk = [];
  for (let i = 1; i < trace.length; i++) {
    const prev = trace[i - 1];
    const cur = trace[i];
    if (Number.isFinite(prev.xWest) && Number.isFinite(cur.xWest) && cur.t > prev.t) {
      const vW0 = (-(cur.xWest - prev.xWest) * dx) / (cur.t - prev.t);
      perChunk.push({ k: cur.k, t: cur.t, vW0, vd0D: toVd0D(vW0, lambda) });
    }
  }

  // Late-third per-chunk slope drift (comparable to PR #12 statistic L)
  const third = Math.floor(trace.length / 3);
  const lateChunkStart = Math.max(1, 2 * third);
  const lateSeries = perChunk.filter(p => p.k >= lateChunkStart && Number.isFinite(p.vd0D));
  let latePerChunkMean = null;
  let latePerChunkDrift = null;
  if (lateSeries.length >= 3) {
    latePerChunkMean = lateSeries.reduce((a, p) => a + p.vd0D, 0) / lateSeries.length;
    const b = slope(lateSeries.map(p => ({ t: p.k, x: p.vd0D })));
    const span = lateSeries[lateSeries.length - 1].k - lateSeries[0].k;
    if (Number.isFinite(b) && latePerChunkMean !== 0) {
      latePerChunkDrift = (span * b) / latePerChunkMean;
    }
  }

  const endX = trace.length ? trace[trace.length - 1].xWest : null;
  const endGapCells = Number.isFinite(endX) ? endX + 0.5 : null;
  const endGapW0 = endGapCells != null ? endGapCells * dx : null;
  const delivered = trace.reduce((s, p) => s + (p.delivered ?? 0), 0);

  return {
    vLast: Number.isFinite(vLast) ? vLast : null,
    vMid: Number.isFinite(vMid) ? vMid : null,
    vEastLast: Number.isFinite(vEastLast) ? vEastLast : null,
    vd0D,
    vd0DMid,
    drift,
    tauVW,
    latePerChunkMean,
    latePerChunkDrift,
    samples: trace.length,
    delivered,
    midRange: mid.length ? [mid[0].k, mid[mid.length - 1].k] : null,
    lastRange: last.length ? [last[0].k, last[last.length - 1].k] : null,
    endX: Number.isFinite(endX) ? endX : null,
    endGapCells,
    endGapW0,
    perChunk,
  };
}

// ------------------------------------------------------------ pre-registered verdict

/**
 * Evaluate the pre-registered acceptance rule.
 * Returns CALIBRATED_BAND_PASS iff EVERY pre-registered gate passes;
 * otherwise QUALITATIVE_STANDS with full diagnostic breakdown.
 */
export function classifyVerdict(input) {
  const {
    nfSummary,
    flSummary,
    nfEnd,
    flEnd,
    nfStopped = false,
    flStopped = false,
    nfFlowOn = false,
    flFlowOn = true,
    flFlowLost = false,
    expectedSubsteps = null,
    errors = [],
    hardwareOk = true,
  } = input;

  const vd0DNoflow = nfSummary?.vd0D ?? null;
  const vd0DFlow = flSummary?.vd0D ?? null;
  const vNoflow = nfSummary?.vLast ?? null;
  const vFlow = flSummary?.vLast ?? null;
  const R = Number.isFinite(vNoflow) && Number.isFinite(vFlow) && vNoflow > 0 ? vFlow / vNoflow : null;

  const flowSpeedRelErr = Number.isFinite(vd0DFlow)
    ? (vd0DFlow - TONG_D2.tongFlowVd0D) / TONG_D2.tongFlowVd0D
    : null;
  const ratioRelErr = Number.isFinite(R)
    ? (R - TONG_D2.tongRatio) / TONG_D2.tongRatio
    : null;
  const noflowExactRelErr = Number.isFinite(vd0DNoflow)
    ? (vd0DNoflow - TONG_D2.exactNoflowVd0D) / TONG_D2.exactNoflowVd0D
    : null;

  const driftNoflow = nfSummary?.drift ?? null;
  const driftFlow = flSummary?.drift ?? null;
  const tauVWNoflow = nfSummary?.tauVW ?? null;
  const tauVWFlow = flSummary?.tauVW ?? null;
  const inletUx = flEnd?.vel?.inletUx ?? null;

  const integrityIssues = [];
  if (!hardwareOk) integrityIssues.push("fallback/software WebGPU adapter");
  if (errors.length > 0) integrityIssues.push(`${errors.length} page/console/WebGPU errors`);
  if (nfStopped) integrityIssues.push("NF2048 tripped inlet stop rule");
  if (flStopped) integrityIssues.push("FL2048 tripped inlet stop rule");
  if (nfFlowOn !== false) integrityIssues.push("NF2048 had flow active");
  if (flFlowOn !== true || flFlowLost) integrityIssues.push("FL2048 flow inactive or lost mid-run");
  if (expectedSubsteps != null) {
    if (nfSummary?.delivered !== expectedSubsteps) integrityIssues.push(`NF2048 delivered ${nfSummary?.delivered}/${expectedSubsteps}`);
    if (flSummary?.delivered !== expectedSubsteps) integrityIssues.push(`FL2048 delivered ${flSummary?.delivered}/${expectedSubsteps}`);
  }
  if (!nfEnd || nfEnd.nonFinite !== 0) integrityIssues.push(`NF2048 non-finite cells: ${nfEnd?.nonFinite ?? "missing"}`);
  if (!flEnd || flEnd.nonFinite !== 0) integrityIssues.push(`FL2048 non-finite cells: ${flEnd?.nonFinite ?? "missing"}`);
  if (!flEnd?.vel || flEnd.vel.nonFinite !== 0) integrityIssues.push(`FL2048 velocity non-finite: ${flEnd?.vel?.nonFinite ?? "missing"}`);
  const inletLive = Number.isFinite(inletUx) && Math.abs(inletUx - 1) <= RULES.inletTol;
  if (!inletLive) integrityIssues.push(`FL2048 inletUx=${inletUx} outside 1 +/- ${RULES.inletTol}`);

  const gates = {
    zeroErrors: {
      pass: integrityIssues.length === 0,
      issues: integrityIssues,
    },
    flowSpeedBand: {
      pass: flowSpeedRelErr != null && Math.abs(flowSpeedRelErr) <= RULES.flowSpeedRelTol,
      measured: vd0DFlow,
      target: TONG_D2.tongFlowVd0D,
      relErr: flowSpeedRelErr,
      tol: RULES.flowSpeedRelTol,
    },
    ratioBand: {
      pass: ratioRelErr != null && Math.abs(ratioRelErr) <= RULES.ratioRelTol,
      measured: R,
      target: TONG_D2.tongRatio,
      relErr: ratioRelErr,
      tol: RULES.ratioRelTol,
    },
    settledDrift: {
      pass:
        Number.isFinite(driftNoflow) &&
        Number.isFinite(driftFlow) &&
        Math.abs(driftNoflow) <= RULES.driftMax &&
        Math.abs(driftFlow) <= RULES.driftMax,
      driftNoflow,
      driftFlow,
      tol: RULES.driftMax,
    },
    thinInterfaceBound: {
      pass:
        Number.isFinite(tauVWNoflow) &&
        Number.isFinite(tauVWFlow) &&
        tauVWNoflow <= RULES.tauVWMax &&
        tauVWFlow <= RULES.tauVWMax,
      tauVWNoflow,
      tauVWFlow,
      max: RULES.tauVWMax,
    },
  };

  const failedGates = Object.entries(gates)
    .filter(([, g]) => !g.pass)
    .map(([name]) => name);

  const verdict = failedGates.length === 0 ? "CALIBRATED_BAND_PASS" : "QUALITATIVE_STANDS";

  const comparisonVsPr12Dx08 = {
    pr12FlowVd0D_dx08: PR12_BASELINE.dx08_tong3_P768_flowVd0D,
    flowResolutionStepPct: Number.isFinite(vd0DFlow)
      ? ((vd0DFlow / PR12_BASELINE.dx08_tong3_P768_flowVd0D) - 1) * 100
      : null,
    pr12NoflowVd0D_dx08_m33: PR12_BASELINE.dx08_R1024_m33_noflowVd0D,
    noflowResolutionStepM33Pct: Number.isFinite(vd0DNoflow)
      ? ((vd0DNoflow / PR12_BASELINE.dx08_R1024_m33_noflowVd0D) - 1) * 100
      : null,
    pr12NoflowVd0D_dx04_m33: PR12_BASELINE.dx04_H2048_m33_noflowVd0D,
    noflowReplicaVsPr12H2048M33Pct: Number.isFinite(vd0DNoflow)
      ? ((vd0DNoflow / PR12_BASELINE.dx04_H2048_m33_noflowVd0D) - 1) * 100
      : null,
    descriptiveRatioVsExactNoflow: Number.isFinite(vd0DFlow)
      ? vd0DFlow / TONG_D2.exactNoflowVd0D
      : null,
    descriptiveRatioVsPr12H2048LateL: Number.isFinite(vd0DFlow)
      ? vd0DFlow / PR12_BASELINE.dx04_H2048_lateL_noflowVd0D
      : null,
    pr12DescriptiveRatio_dx08: PR12_BASELINE.dx08_descriptiveRatio,
  };

  return {
    verdict,
    appMayCallQuantitative: verdict === "CALIBRATED_BAND_PASS",
    failedGates,
    metrics: {
      V_noflow_vd0D: vd0DNoflow,
      V_flow_vd0D: vd0DFlow,
      V_noflow_W0: vNoflow,
      V_flow_W0: vFlow,
      R,
      flowSpeedRelErr,
      ratioRelErr,
      noflowExactRelErr,
      drift_noflow: driftNoflow,
      drift_flow: driftFlow,
      latePerChunkDrift_noflow: nfSummary?.latePerChunkDrift ?? null,
      latePerChunkDrift_flow: flSummary?.latePerChunkDrift ?? null,
      tauVW_noflow: tauVWNoflow,
      tauVW_flow: tauVWFlow,
      endGapCells_noflow: nfSummary?.endGapCells ?? null,
      endGapW0_noflow: nfSummary?.endGapW0 ?? null,
      endGapCells_flow: flSummary?.endGapCells ?? null,
      endGapW0_flow: flSummary?.endGapW0 ?? null,
      inletUx,
      mirror_noflow: nfEnd?.mirror ?? null,
      mirror_flow: flEnd?.mirror ?? null,
    },
    gates,
    comparisonVsPr12Dx08,
  };
}

// ------------------------------------------------------------ in-page helpers

export function mirrorAsymmetry(data, n, stride, channel) {
  let max = 0;
  let sum = 0;
  let over = 0;
  for (let y = 0; y < (n >> 1); y++) {
    const ym = n - 1 - y;
    for (let x = 0; x < n; x++) {
      const d = Math.abs(data[(y * n + x) * stride + channel] - data[(ym * n + x) * stride + channel]);
      sum += d;
      if (d > 1e-3) over++;
      if (d > max) max = d;
    }
  }
  return { max, mean: sum / ((n >> 1) * n), cellsOver1e3: over };
}

export function velocityDiagnostics(vel, n, U, seedY, xTip) {
  const at = (x, y, c) => vel[(y * n + x) * 4 + c];
  const col = (x, f) => {
    let s = 0;
    for (let y = 0; y < n; y++) s += f(x, y);
    return s / n;
  };
  const ux = (x, y) => at(x, y, 0);
  const rho = (x, y) => at(x, y, 2);
  const flux = (x, y) => at(x, y, 0) * at(x, y, 2);
  const ahead = {};
  if (Number.isFinite(xTip)) {
    for (const d of [2, 5, 10, 20, 50, 100, 200]) {
      const x = Math.floor(xTip) - d;
      if (x >= 0) ahead[d] = (0.5 * (ux(x, seedY) + ux(x, seedY - 1))) / U;
    }
  }
  let maxSpeed = 0;
  let rhoMin = Infinity;
  let rhoMax = -Infinity;
  let uxMirror = 0;
  let uyMirror = 0;
  let nonFinite = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = at(x, y, 0);
      const b = at(x, y, 1);
      const r = at(x, y, 2);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(r)) {
        nonFinite++;
        continue;
      }
      maxSpeed = Math.max(maxSpeed, Math.hypot(a, b));
      rhoMin = Math.min(rhoMin, r);
      rhoMax = Math.max(rhoMax, r);
      if (y < (n >> 1)) {
        const ym = n - 1 - y;
        uxMirror = Math.max(uxMirror, Math.abs(a - at(x, ym, 0)));
        uyMirror = Math.max(uyMirror, Math.abs(b + at(x, ym, 1)));
      }
    }
  }
  return {
    inletUx: col(0, ux) / U,
    x1Ux: col(1, ux) / U,
    x8Ux: col(8, ux) / U,
    outletUx: col(n - 1, ux) / U,
    inletRho: col(0, rho),
    outletRho: col(n - 1, rho),
    inletMassFlux: col(0, flux) / U,
    outletMassFlux: col(n - 1, flux) / U,
    ahead,
    maxSpeedOverU: maxSpeed / U,
    rhoMin,
    rhoMax,
    uxMirrorOverU: uxMirror / U,
    uyMirrorOverU: uyMirror / U,
    nonFinite,
  };
}

const HELPER_SRC = {
  mirrorAsymmetry: mirrorAsymmetry.toString(),
  velocityDiagnostics: velocityDiagnostics.toString(),
};

function installDriver(helperSrc) {
  const S = window.__solidify;
  if (!S) throw new Error("window.__solidify missing");
  const H = {};
  for (const [name, src] of Object.entries(helperSrc)) H[name] = (0, eval)(`(${src})`);

  const errors = [];
  const watched = new WeakSet();
  const watch = (device) => {
    if (!device || watched.has(device)) return;
    watched.add(device);
    device.addEventListener?.("uncapturederror", (e) => {
      errors.push({ kind: "device", message: String(e?.error?.message ?? e) });
    });
    device.lost?.then((info) => {
      if (info?.reason !== "destroyed") {
        errors.push({ kind: "device-lost", reason: info?.reason ?? null, message: info?.message ?? null });
      }
    });
  };

  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let armed = null;

  async function readTexture(device, texture, n) {
    const bpr = n * 16;
    const buf = device.createBuffer({
      size: bpr * n,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture }, { buffer: buf, bytesPerRow: bpr }, [n, n]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(buf.getMappedRange().slice(0));
      buf.unmap();
      return out;
    } finally {
      buf.destroy();
    }
  }

  window.__ftd4 = {
    errors: () => errors.slice(),
    async metadata() {
      const device = S.sim().device;
      watch(device);
      let info = device.adapterInfo ?? {};
      if (!info.vendor && !info.architecture && navigator.gpu) {
        try {
          const ad = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
          if (ad?.info) info = ad.info;
        } catch {}
      }
      return {
        hardware: {
          vendor: info.vendor ?? null,
          architecture: info.architecture ?? null,
          device: info.device ?? null,
          description: info.description ?? null,
          isFallbackAdapter: info.isFallbackAdapter ?? false,
        },
        limits: {
          maxStorageBufferBindingSize: device.limits?.maxStorageBufferBindingSize ?? null,
          maxStorageBuffersPerShaderStage: device.limits?.maxStorageBuffersPerShaderStage ?? null,
          maxBufferSize: device.limits?.maxBufferSize ?? null,
          maxTextureDimension2D: device.limits?.maxTextureDimension2D ?? null,
        },
        userAgent: navigator.userAgent,
      };
    },
    async stage(c) {
      if (armed) throw new Error("stage: previous run not finished");
      S.app.setRun(false);
      await frames();
      if (S.sim().n !== c.n) S.app.setGrid(c.n);
      const sim = S.sim();
      if (sim.n !== c.n) throw new Error(`stage: grid is ${sim.n}, wanted ${c.n}`);
      watch(sim.device);
      const origStep = sim.step;
      sim.step = () => 0;
      armed = { sim, origStep, c };
      await sim.device.queue.onSubmittedWorkDone();

      S.app.setInoculant(0);
      Object.assign(sim.params, {
        solver: 1,
        lambda: c.lambda,
        dx: c.dx,
        dt: c.dt,
        epsBar: 1,
        tau: 1,
        delta: c.eps4,
        aniMode: 4,
        noiseAmp: 0,
        latent: 1,
        dTherm: c.dTilde,
        dSol: c.dTilde,
        alloyOn: 0,
        coolRate: 0,
        heatIn: 0,
        scen: 0,
        twinProb: 0,
        facet: 0,
        frozenT: 0,
      });

      if (c.flowScale !== null) {
        Object.assign(sim.flowCfg, { u: c.uLat, pr: c.pr, scale: c.flowScale });
        const why = sim.setFlow(true);
        if (why) throw new Error(`stage: setFlow(true) refused: ${why}`);
      } else {
        sim.setFlow(false);
      }

      sim.reset(1 - c.delta);
      sim.addSeed(c.seedX, c.seedY, c.seedR, 0);
      await sim.stepSync(0);
      return {
        n: sim.n,
        flowOn: sim.flowOn,
        flowCfg: { ...sim.flowCfg },
        params: {
          solver: sim.params.solver,
          lambda: sim.params.lambda,
          dx: sim.params.dx,
          dt: sim.params.dt,
          dTherm: sim.params.dTherm,
          delta: sim.params.delta,
          tFar: sim.params.tFar,
        },
      };
    },
    async advance(k) {
      if (!armed) throw new Error("advance: not staged");
      const { sim, c } = armed;
      const t0 = performance.now();
      // Break each 2684-step chunk into <= 336-step sub-batches with a brief 100 ms
      // cooldown between sub-batches so integrated GPU drivers stay thermally/VRAM clean.
      const subBatchMax = 336;
      let got = 0;
      let rem = k;
      while (rem > 0) {
        const take = Math.min(subBatchMax, rem);
        const stepGot = await sim.stepSync(take);
        got += stepGot;
        rem -= take;
        if (stepGot < take) break;
        if (rem > 0) await new Promise((r) => setTimeout(r, 100));
      }
      const d = await sim.readRows(c.seedY, 1);
      if (!d) throw new Error("advance: readRows failed");
      const row = new Array(sim.n);
      for (let i = 0; i < sim.n; i++) row[i] = d[i * 4];
      return { got, row, flowOn: sim.flowOn, ms: performance.now() - t0 };
    },
    async end(xWest) {
      if (!armed) throw new Error("end: not staged");
      const { sim, c } = armed;
      const n = sim.n;
      const all = await sim.readRows(0, n);
      if (!all) throw new Error("end: readRows(0, n) failed");
      const column = new Array(n);
      for (let y = 0; y < n; y++) column[y] = all[(y * n + c.seedX) * 4];
      let nonFinite = 0;
      for (let i = 0; i < n * n * 4; i++) if (!Number.isFinite(all[i])) nonFinite++;
      const asymPhi = H.mirrorAsymmetry(all, n, 4, 0);
      const asymT = H.mirrorAsymmetry(all, n, 4, 1);
      const vel = sim.flowVelocity
        ? H.velocityDiagnostics(await readTexture(sim.device, sim.flowVelocity, n), n, c.uLat, c.seedY, xWest)
        : null;
      return { column, nonFinite, asymPhi, asymT, vel, flowOn: sim.flowOn };
    },
    async finish() {
      if (!armed) return false;
      const { sim, origStep } = armed;
      try {
        await sim.device.queue.onSubmittedWorkDone();
        sim.setFlow(false);
        Object.assign(sim.flowCfg, { u: 0.02, pr: 23.1, scale: 1 });
      } finally {
        sim.step = origStep;
        armed = null;
      }
      return true;
    },
  };
  return true;
}

// ------------------------------------------------------------ src/flow.ts loader

async function loadFlowModule() {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: REPO,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
  try {
    return await vite.ssrLoadModule("/src/flow.ts");
  } finally {
    await vite.close();
  }
}

// ------------------------------------------------------------ --selftest

export async function runSelfTest() {
  const F = await loadFlowModule();
  let failures = 0;
  const check = (name, ok, detail) => {
    if (!ok) failures++;
    console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
  };

  // 1. TONG-D2-STAGING
  {
    const sFine = stagingDx(0.4, 2048, 33);
    const sCoarse = stagingDx(0.8, 1024, 33);
    const sampleTimeRel = Math.abs((sFine.chunk * sFine.dt) / (sCoarse.chunk * sCoarse.dt) - 1);
    const ok =
      Math.abs(sFine.sideW0 - 819.2) < 1e-9 &&
      Math.abs(sCoarse.sideW0 - 819.2) < 1e-9 &&
      sFine.chunk === 2684 &&
      sFine.substeps === 88572 &&
      sampleTimeRel < 1e-12 &&
      Math.abs(sFine.diffusionNumber - 0.15) < 1e-12 &&
      Math.abs(sFine.seedRCells - 20) < 1e-12 &&
      sFine.predictedFlowEndGapCells > 400 &&
      Math.abs(sFine.boxD0 - 2956.497) < 0.01;
    check("TONG-D2-STAGING", ok, {
      sideW0: sFine.sideW0,
      boxD0: +sFine.boxD0.toFixed(2),
      dt: +sFine.dt.toFixed(9),
      chunk: sFine.chunk,
      substeps: sFine.substeps,
      sampleTimeRel,
      uLat: +sFine.uLat.toFixed(7),
      predictedFlowEndGapCells: +sFine.predictedFlowEndGapCells.toFixed(1),
    });
  }

  // 2. FLOW-REFUSAL-2048
  {
    const baseCtx = {
      dim3: false,
      scenario: 0,
      frozenTemperature: false,
      alloy: false,
      calibrated: true,
      grid: 2048,
      busyMode: null,
    };
    const r2048 = F.flowRefusal(baseCtx);
    const r4096 = F.flowRefusal({ ...baseCtx, grid: 4096 });
    check("FLOW-REFUSAL-2048", r2048 === null && typeof r4096 === "string" && r4096.length > 0, {
      grid2048: r2048,
      grid4096: r4096,
    });
  }

  // 3. LBM-BUFFER-LAYOUT-2048
  {
    const hasFn = typeof F.lbmBufferLayout === "function";
    const lay = hasFn ? F.lbmBufferLayout(2048) : null;
    const MIB128 = 128 * 1024 * 1024;
    const expectedPopBytes = 9 * 2048 * 2048 * 4;
    const sumSizes = Array.isArray(lay?.sizesBytes)
      ? lay.sizesBytes.reduce((a, b) => a + b, 0)
      : 0;
    const ok =
      hasFn &&
      lay.bindingsPerStep === 6 &&
      lay.bindingsPerStep <= 8 &&
      Array.isArray(lay.sizesBytes) &&
      lay.sizesBytes.length === 3 &&
      lay.sizesBytes.every((b) => Number.isInteger(b) && b > 0 && b <= MIB128) &&
      lay.maxBindingBytes === Math.max(...lay.sizesBytes) &&
      lay.maxBindingBytes <= MIB128 &&
      lay.totalBytes === sumSizes &&
      lay.totalBytes === expectedPopBytes;
    check("LBM-BUFFER-LAYOUT-2048", ok, lay);
  }

  // 4. FLOW-SETTING-ENVELOPE
  {
    const s = stagingDx(0.4, 2048, 33);
    const fs = F.flowSetting(
      { dTherm: s.dTilde, dt: s.dt, dx: s.dx, epsBar: 1.0, calibrated: true },
      { u: s.uLat, pr: K.PR },
    );
    const lat = F.latticeOf(s.diffusionNumber, K.PR, s.uLat);
    const ok =
      fs.issues.length === 0 &&
      Math.abs(fs.width - 2.5) < 1e-12 &&
      Math.abs(fs.nu - 3.465) < 1e-12 &&
      lat.tau >= 0.51 &&
      lat.mach <= 0.1 &&
      lat.peCell <= 2.0;
    check("FLOW-SETTING-ENVELOPE", ok, {
      nu: +fs.nu.toFixed(4),
      width: fs.width,
      tau: +lat.tau.toFixed(3),
      mach: +lat.mach.toFixed(5),
      peCell: +lat.peCell.toFixed(5),
      issues: fs.issues,
    });
  }

  // 5. TIP-SPEED-AND-DRIFT
  {
    // Exact linear crossing + synthetic constant-speed and decelerating traces
    const row = new Float32Array(128);
    for (let x = 40; x <= 88; x++) row[x] = 1;
    row[39] = 0.25;
    row[40] = 0.75; // crossing at 39 + (0.5 - 0.25)/(0.75 - 0.25) = 39.5
    row[88] = 0.75;
    row[89] = 0.25; // crossing at 88 + (0.75 - 0.5)/(0.75 - 0.25) = 88.5
    const xW = westTip(row, 64);
    const xE = eastTip(row, 64);

    const s = stagingDx(0.4, 2048, 33);
    const dtChunk = s.chunk * s.dt;
    const vExactW0 = (TONG_D2.tongFlowVd0D * s.dTilde * K.LAMBDA) / K.A1;
    const constTrace = [];
    const decelTrace = [];
    for (let k = 0; k < 33; k++) {
      const t = (k + 1) * dtChunk;
      const xLin = 1004 - (vExactW0 * t) / K.DX;
      // Decelerating trajectory: dx/dt = -v0 * (1 - 0.08 * k / 32)
      const xDec = 1004 - (vExactW0 * t * (1 - 0.04 * (k / 32))) / K.DX;
      constTrace.push({ k, t, xWest: xLin, xEast: 1044 + (vExactW0 * t) / K.DX, delivered: s.chunk });
      decelTrace.push({ k, t, xWest: xDec, xEast: 1044 + (vExactW0 * t) / K.DX, delivered: s.chunk });
    }
    const sumConst = summarizeTrace(constTrace, K.LAMBDA, K.DX);
    const sumDecel = summarizeTrace(decelTrace, K.LAMBDA, K.DX);
    const ok =
      Math.abs(xW - 39.5) < 1e-12 &&
      Math.abs(xE - 88.5) < 1e-12 &&
      Math.abs(sumConst.vd0D - TONG_D2.tongFlowVd0D) < 1e-12 &&
      Math.abs(sumConst.drift) < 1e-12 &&
      sumConst.delivered === s.substeps &&
      sumDecel.drift < -0.02;
    check("TIP-SPEED-AND-DRIFT", ok, {
      xW,
      xE,
      constVd0D: +sumConst.vd0D.toFixed(6),
      constDrift: sumConst.drift,
      decelDrift: +sumDecel.drift.toFixed(5),
    });
  }

  // 6. VERDICT-CLASSIFIER (adversarial matrix)
  {
    const mkSum = (vd0D, drift, delivered = 88572) => {
      const vW0 = tauVWFromVd0D(vd0D, K.LAMBDA);
      return {
        vLast: vW0,
        vMid: vW0 / (1 + drift),
        vd0D,
        drift,
        tauVW: vW0,
        delivered,
        endGapCells: 520,
        endGapW0: 208,
      };
    };
    const okNfEnd = { nonFinite: 0, mirror: 0.001 };
    const okFlEnd = { nonFinite: 0, mirror: 0.002, vel: { inletUx: 1.00001, nonFinite: 0 } };
    const base = {
      nfSummary: mkSum(0.0180, -0.008),
      flSummary: mkSum(0.0247, -0.005),
      nfEnd: okNfEnd,
      flEnd: okFlEnd,
      expectedSubsteps: 88572,
      errors: [],
      hardwareOk: true,
    };

    const vPass = classifyVerdict(base);
    const vMissSpeed = classifyVerdict({ ...base, nfSummary: mkSum(0.0160, -0.005), flSummary: mkSum(0.02195, -0.005) });
    const vMissRatio = classifyVerdict({ ...base, nfSummary: mkSum(0.0155, -0.005), flSummary: mkSum(0.0247, -0.005) });
    const vDrift = classifyVerdict({ ...base, nfSummary: mkSum(0.0180, -0.036) });
    const vTau = classifyVerdict({ ...base, flSummary: { ...mkSum(0.0247, -0.005), tauVW: 0.25 } });
    const vErr = classifyVerdict({ ...base, errors: [{ kind: "device", message: "boom" }] });
    const vNan = classifyVerdict({ ...base, flEnd: { ...okFlEnd, nonFinite: 3 } });
    const vInlet = classifyVerdict({ ...base, flEnd: { ...okFlEnd, vel: { inletUx: 0.85, nonFinite: 0 } } });
    const vStopped = classifyVerdict({ ...base, flStopped: true });

    const ok =
      vPass.verdict === "CALIBRATED_BAND_PASS" &&
      vPass.failedGates.length === 0 &&
      vMissSpeed.verdict === "QUALITATIVE_STANDS" &&
      vMissSpeed.failedGates.includes("flowSpeedBand") &&
      vMissRatio.verdict === "QUALITATIVE_STANDS" &&
      vMissRatio.failedGates.includes("ratioBand") &&
      vDrift.verdict === "QUALITATIVE_STANDS" &&
      vDrift.failedGates.includes("settledDrift") &&
      vTau.verdict === "QUALITATIVE_STANDS" &&
      vTau.failedGates.includes("thinInterfaceBound") &&
      vErr.verdict === "QUALITATIVE_STANDS" &&
      vErr.failedGates.includes("zeroErrors") &&
      vNan.verdict === "QUALITATIVE_STANDS" &&
      vNan.failedGates.includes("zeroErrors") &&
      vInlet.verdict === "QUALITATIVE_STANDS" &&
      vInlet.failedGates.includes("zeroErrors") &&
      vStopped.verdict === "QUALITATIVE_STANDS" &&
      vStopped.failedGates.includes("zeroErrors");

    check("VERDICT-CLASSIFIER", ok, {
      pass: vPass.verdict,
      missSpeed: vMissSpeed.failedGates,
      missRatio: vMissRatio.failedGates,
      drift: vDrift.failedGates,
      tau: vTau.failedGates,
      err: vErr.failedGates,
      nan: vNan.failedGates,
      inlet: vInlet.failedGates,
      stopped: vStopped.failedGates,
    });
  }

  // 7. DIAGNOSTIC-HELPERS
  {
    const n = 16;
    const vel = new Float32Array(n * n * 4);
    const U = 0.0075;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        vel[i] = U;
        vel[i + 1] = 0;
        vel[i + 2] = 1.0;
      }
    }
    const vd = velocityDiagnostics(vel, n, U, 8, 12);
    const sym = mirrorAsymmetry(vel, n, 4, 0);
    const ok =
      Math.abs(vd.inletUx - 1) < 1e-6 &&
      Math.abs(vd.outletUx - 1) < 1e-6 &&
      vd.nonFinite === 0 &&
      sym.max === 0;
    check("DIAGNOSTIC-HELPERS", ok, { inletUx: vd.inletUx, symMax: sym.max, ahead2: vd.ahead[2] });
  }

  console.log(failures === 0 ? "FLOW-TONG-DX04 SELFTEST: ALL PASS (7/7)" : `FLOW-TONG-DX04 SELFTEST: ${failures} FAILED`);
  return failures === 0;
}

// ------------------------------------------------------------ --plan

export async function printPlan(chunks = K.DEFAULT_CHUNKS) {
  const F = await loadFlowModule();
  const arms = buildArms(chunks);
  const s = arms[0].staging;
  const lay = F.lbmBufferLayout(K.N);
  const mib = (b) => (b / (1024 * 1024)).toFixed(1);
  const pfTexturesMiB = (2 * 64 + 2 * 16 + 64 + 32); // 2x state (64), 2x grain (16), flux (64), phiAux (32)
  const lbmVramMiB = (2 * lay.totalBytes + K.N * K.N * 16) / (1024 * 1024);

  console.log("=== Tong et al. (2001, PRE 63:061601) D2 at dx = 0.4 W0 / 2048^2 ===");
  console.log(`Reference: Delta=${K.DELTA}, eps4=${K.EPS4}, Pr=${K.PR}, lambda=${K.LAMBDA}, U d0/D=${K.UD0D}`);
  console.log(`           V_noflow_exact=${TONG_D2.exactNoflowVd0D}, V_noflow_tong=${TONG_D2.tongNoflowVd0D}, V_flow_tong=${TONG_D2.tongFlowVd0D}, R_tong=${TONG_D2.tongRatio}`);
  console.log(`Grid:      n=${K.N}, dx=${K.DX} W0, box=${s.sideW0.toFixed(1)} W0 (${s.boxD0.toFixed(1)} d0), seed=(${s.seedX},${s.seedY}), seedR=${s.seedRCells} cells`);
  console.log(`Time:      dt=${s.dt.toFixed(9)} tau0, chunks=${s.chunks} x ${s.chunk} = ${s.substeps} substeps, T=${s.tTotal.toFixed(2)} tau0 (${s.tTotalInLD.toFixed(2)} l_D/V_KR)`);
  console.log(`LBM:       uLat=${s.uLat.toFixed(7)}, nu=${s.nuLat.toFixed(3)}, tau=${s.tau.toFixed(3)}, Ma=${s.mach.toFixed(5)}, Pe_cell=${s.peCell.toFixed(5)}`);
  console.log(`Buffers:   split-SoA ${lay.bindingsPerStep} bindings/step, sizes=[${lay.sizesBytes.map(mib).join(", ")}] MiB (max ${mib(lay.maxBindingBytes)} <= 128.0 MiB)`);
  console.log(`VRAM est:  LBM ping-pong + velTex ~${lbmVramMiB.toFixed(0)} MiB + phase-field ~${pfTexturesMiB} MiB = ~${(lbmVramMiB + pfTexturesMiB).toFixed(0)} MiB`);
  console.log("");
  console.log("arm     kind    n     dx   chunks x chunk = substeps  pred_end_gap_cells  est_wall_min");
  let totalS = 0;
  for (const a of arms) {
    totalS += a.estWallS;
    const gap = a.kind === "flow" ? a.staging.predictedFlowEndGapCells : a.staging.predictedNoflowEndGapCells;
    console.log(
      `${a.id.padEnd(7)} ${a.kind.padEnd(7)} ${String(a.n).padStart(4)}  ${a.dx.toFixed(1)}  ${String(a.staging.chunks).padStart(6)} x ${String(a.staging.chunk).padStart(4)} = ${String(a.staging.substeps).padStart(8)}  ${gap.toFixed(1).padStart(18)}  ${(a.estWallS / 60).toFixed(1).padStart(12)}`,
    );
  }
  console.log(`Total estimated local Arc 140V wall time: ~${(totalS / 60).toFixed(1)} min`);
  console.log("");
  console.log("Pre-registered gate (CALIBRATED_BAND_PASS iff ALL pass, else QUALITATIVE_STANDS):");
  console.log(`  1. |V_flow - ${TONG_D2.tongFlowVd0D}| / ${TONG_D2.tongFlowVd0D} <= ${(RULES.flowSpeedRelTol * 100).toFixed(0)}%`);
  console.log(`  2. |R - ${TONG_D2.tongRatio}| / ${TONG_D2.tongRatio} <= ${(RULES.ratioRelTol * 100).toFixed(0)}%`);
  console.log(`  3. |drift_noflow| <= ${(RULES.driftMax * 100).toFixed(0)}% AND |drift_flow| <= ${(RULES.driftMax * 100).toFixed(0)}%`);
  console.log(`  4. tau*V/W <= ${RULES.tauVWMax} for both arms`);
  console.log(`  5. Zero GPU/console/page/NaN errors, full substep delivery, |inletUx - 1| <= ${RULES.inletTol}, no stop-rule trip`);
}

// ------------------------------------------------------------ --run (WebGPU)

async function isPortUp(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/app/`);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureViteServer(port) {
  if (await isPortUp(port)) {
    return { spawned: false, stop: () => {} };
  }
  const server = spawn(
    "node",
    ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: REPO, stdio: "ignore" },
  );
  for (let i = 0; i < 60; i++) {
    if (await isPortUp(port)) {
      return {
        spawned: true,
        stop: () => {
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
          } else {
            try { server.kill("SIGTERM"); } catch {}
          }
        },
      };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { server.kill("SIGTERM"); } catch {}
  }
  throw new Error(`Vite did not respond on port ${port}`);
}

async function runSingleArm(browser, port, arm, allErrors) {
  const s = arm.staging;
  const beforeErr = allErrors.length;
  const t0 = Date.now();
  const page = await browser.newPage();
  page.on("pageerror", (e) => allErrors.push({ arm: arm.id, kind: "page", message: String(e?.message ?? e) }));
  page.on("console", (m) => {
    if (m.type() === "error") allErrors.push({ arm: arm.id, kind: "console", message: m.text() });
  });

  const out = {
    id: arm.id,
    kind: arm.kind,
    flowScale: arm.flowScale,
    n: arm.n,
    dx: arm.dx,
    seedX: arm.seedX,
    seedY: arm.seedY,
    chunks: s.chunks,
    chunk: s.chunk,
    substeps: s.substeps,
    dt: s.dt,
    started: new Date().toISOString(),
    metadata: null,
    setup: null,
    trace: [],
    stopped: false,
    flowLost: false,
    summary: null,
    end: null,
    error: null,
  };

  try {
    await page.goto(`http://127.0.0.1:${port}/app/`, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.waitForFunction("!!window.__solidify", { timeout: 60_000 });
    await page.evaluate(installDriver, HELPER_SRC);

    out.metadata = await page.evaluate(() => window.__ftd4.metadata());
    const cfg = {
      lambda: s.lambda,
      n: arm.n,
      seedX: arm.seedX,
      seedY: arm.seedY,
      dx: s.dx,
      dt: s.dt,
      dTilde: s.dTilde,
      eps4: K.EPS4,
      delta: K.DELTA,
      uLat: s.uLat,
      pr: K.PR,
      seedR: s.seedRCells,
      flowScale: arm.flowScale,
    };
    out.setup = await page.evaluate((c) => window.__ftd4.stage(c), cfg);

    console.log(
      `[flow-tong-dx04] ${arm.id} staged n=${out.setup.n} dx=${s.dx} flowOn=${out.setup.flowOn} chunks=${s.chunks}x${s.chunk}=${s.substeps}`,
    );

    let t = 0;
    for (let k = 0; k < s.chunks; k++) {
      const a = await page.evaluate((m) => window.__ftd4.advance(m), s.chunk);
      t += s.chunk * s.dt;
      const xWest = westTip(a.row, arm.seedX);
      const xEast = eastTip(a.row, arm.seedX);
      const rec = {
        k,
        t,
        xWest: Number.isFinite(xWest) ? xWest : null,
        xEast: Number.isFinite(xEast) ? xEast : null,
        delivered: a.got,
        ms: Math.round(a.ms),
      };
      out.trace.push(rec);
      if (arm.flowScale !== null && !a.flowOn) out.flowLost = true;

      let vChunkStr = "n/a";
      if (k > 0) {
        const prev = out.trace[k - 1];
        if (prev.xWest != null && rec.xWest != null) {
          const vW0 = (-(rec.xWest - prev.xWest) * s.dx) / (rec.t - prev.t);
          const vd = toVd0D(vW0, s.lambda);
          vChunkStr = vd != null ? vd.toFixed(5) : "n/a";
        }
      }
      const elS = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[flow-tong-dx04] ${arm.id} chunk ${k + 1}/${s.chunks} (${elS}s, ${rec.ms}ms) xWest=${rec.xWest != null ? rec.xWest.toFixed(2) : "null"} vChunk=${vChunkStr} flowOn=${a.flowOn}`,
      );

      if (!(xWest > K.STOP_CELLS)) {
        out.stopped = true;
        console.log(`[flow-tong-dx04] ${arm.id} stopped early at chunk ${k + 1}: xWest=${xWest}`);
        break;
      }
    }

    out.summary = summarizeTrace(out.trace, s.lambda, s.dx);
    const lastXWest = out.trace.length ? out.trace[out.trace.length - 1].xWest : null;
    const e = await page.evaluate((x) => window.__ftd4.end(x), lastXWest);
    if (arm.flowScale !== null && !e.flowOn) out.flowLost = true;
    out.end = {
      ...columnMirror(e.column, arm.seedY),
      nonFinite: e.nonFinite,
      asymPhi: e.asymPhi,
      asymT: e.asymT,
      vel: e.vel,
    };
  } catch (err) {
    out.error = err?.stack ?? String(err);
  } finally {
    try {
      await page.evaluate(() => window.__ftd4.finish());
    } catch (err) {
      allErrors.push({ arm: arm.id, kind: "finish", message: String(err?.message ?? err) });
    }
    try {
      const devErrs = await page.evaluate(() => window.__ftd4.errors());
      for (const de of devErrs) allErrors.push({ arm: arm.id, ...de });
    } catch (err) {
      allErrors.push({ arm: arm.id, kind: "error-readback", message: String(err?.message ?? err) });
    }
    await page.close().catch(() => {});
    out.wallMs = Date.now() - t0;
    out.errors = allErrors.slice(beforeErr);
  }

  return out;
}

export async function runBenchmark({ port, outPath, chunks, armFilter }) {
  const F = await loadFlowModule();
  const refusal = F.flowRefusal({
    dim3: false,
    scenario: 0,
    frozenTemperature: false,
    alloy: false,
    calibrated: true,
    grid: K.N,
    busyMode: null,
  });
  if (refusal !== null) {
    throw new Error(`flowRefusal refuses 2048^2: ${refusal}`);
  }

  const allArms = buildArms(chunks);
  const selectedArms = armFilter
    ? allArms.filter((a) => armFilter.includes(a.id))
    : allArms;
  if (selectedArms.length === 0) {
    throw new Error(`No arms selected from filter: ${armFilter?.join(",")}`);
  }

  const resolvedOut = path.resolve(REPO, outPath);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });

  let gitCommit = "unknown";
  try {
    gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {}

  const lay = F.lbmBufferLayout(K.N);
  const result = {
    study: "Tong et al. (2001) Table II D2 at dx = 0.4 W0 / 2048^2 (no-flow NF2048 vs Zou-He forced melt flow FL2048)",
    reference: TONG_D2,
    pr12Baseline: PR12_BASELINE,
    constants: K,
    rules: RULES,
    staging: selectedArms[0].staging,
    lbmBufferLayout: lay,
    gitCommit,
    started: new Date().toISOString(),
    finished: null,
    port,
    chunks,
    selectedArms: selectedArms.map((a) => a.id),
    host: {
      platform: process.platform,
      arch: os.arch(),
      cores: os.cpus().length,
    },
    hardware: null,
    limits: null,
    arms: {},
    errors: [],
    decision: null,
    completed: false,
  };

  const save = () => {
    fs.writeFileSync(resolvedOut, JSON.stringify(result, null, 2) + "\n", "utf8");
  };
  save();

  const vite = await ensureViteServer(port);
  const { default: puppeteer } = await import("puppeteer-core");
  const { closeBrowser } = await import("../browser-cleanup.mjs");
  const extraArgs = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
  if (!Array.isArray(extraArgs) || extraArgs.some((a) => typeof a !== "string")) {
    throw new Error("CHROME_ARGS must be a JSON string array");
  }

  const tWall0 = Date.now();
  try {
    for (let ai = 0; ai < selectedArms.length; ai++) {
      const arm = selectedArms[ai];
      // Fresh Chrome GPU process per arm so FL2048 never inherits NF2048 VRAM/driver state.
      let browser = null;
      let armRes = null;
      try {
        browser = await puppeteer.launch({
          executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
          headless: "new",
          protocolTimeout: 600_000,
          args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-gpu", ...extraArgs],
        });
        armRes = await runSingleArm(browser, port, arm, result.errors);
      } finally {
        if (browser) await closeBrowser(browser);
      }
      result.arms[arm.id] = armRes;
      if (!result.hardware && armRes.metadata?.hardware) {
        result.hardware = armRes.metadata.hardware;
        result.limits = armRes.metadata.limits;
      }
      console.log(
        `[flow-tong-dx04] ${arm.id} DONE wall=${(armRes.wallMs / 1000).toFixed(1)}s vd0D=${armRes.summary?.vd0D?.toFixed(6) ?? "null"} drift=${armRes.summary?.drift != null ? (armRes.summary.drift * 100).toFixed(3) + "%" : "null"} tauVW=${armRes.summary?.tauVW?.toFixed(4) ?? "null"} endGap=${armRes.summary?.endGapCells?.toFixed(1) ?? "null"} cells inletUx=${armRes.end?.vel?.inletUx?.toFixed(6) ?? "n/a"} errs=${armRes.errors.length}`,
      );
      save();
      if (ai + 1 < selectedArms.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } finally {
    vite.stop();
  }

  const nf = result.arms.NF2048 ?? null;
  const fl = result.arms.FL2048 ?? null;
  const hardwareOk = result.hardware?.isFallbackAdapter !== true;

  if (nf && fl) {
    result.decision = classifyVerdict({
      nfSummary: nf.summary,
      flSummary: fl.summary,
      nfEnd: nf.end,
      flEnd: fl.end,
      nfStopped: nf.stopped,
      flStopped: fl.stopped,
      nfFlowOn: nf.setup?.flowOn ?? null,
      flFlowOn: fl.setup?.flowOn ?? null,
      flFlowLost: fl.flowLost,
      expectedSubsteps: selectedArms[0].staging.substeps,
      errors: result.errors,
      hardwareOk,
    });
  }

  const armsOk = selectedArms.every((a) => {
    const r = result.arms[a.id];
    return r && !r.error && r.errors.length === 0 && r.summary != null && r.end != null;
  });
  result.wallSec = Number(((Date.now() - tWall0) / 1000).toFixed(2));
  result.finished = new Date().toISOString();
  result.completed = armsOk && result.errors.length === 0 && hardwareOk;
  save();

  if (result.decision) {
    const m = result.decision.metrics;
    console.log(
      `FLOW_TONG_DX04_VERDICT verdict=${result.decision.verdict} V_noflow=${m.V_noflow_vd0D?.toFixed(6)} V_flow=${m.V_flow_vd0D?.toFixed(6)} R=${m.R?.toFixed(4)} drift_nf=${m.drift_noflow != null ? (m.drift_noflow * 100).toFixed(2) + "%" : "null"} drift_fl=${m.drift_flow != null ? (m.drift_flow * 100).toFixed(2) + "%" : "null"} tauVW_fl=${m.tauVW_flow?.toFixed(4)} failedGates=[${result.decision.failedGates.join(",")}] wall=${result.wallSec}s out=${resolvedOut}`,
    );
  } else {
    console.log(`FLOW_TONG_DX04_PARTIAL completed=${result.completed} wall=${result.wallSec}s out=${resolvedOut}`);
  }
  return result.completed ? 0 : 1;
}

// ------------------------------------------------------------ CLI parsing

function parseCli(argv) {
  const getVal = (flag) => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
      if (argv[i].startsWith(flag + "=")) return argv[i].slice(flag.length + 1);
    }
    return undefined;
  };
  const has = (flag) => argv.includes(flag);
  const chunksRaw = getVal("--chunks");
  const chunks = chunksRaw !== undefined ? Number(chunksRaw) : K.DEFAULT_CHUNKS;
  if (!Number.isInteger(chunks) || chunks < 3) {
    throw new Error(`--chunks=${chunksRaw} must be an integer >= 3`);
  }
  const portRaw = getVal("--port");
  const port = portRaw !== undefined ? Number(portRaw) : 5297;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port=${portRaw} must be a valid port`);
  }
  const date = new Date().toISOString().slice(0, 10);
  const outPath = getVal("--out") ?? `docs/validation/flow-tong-dx04-${date}.json`;
  const armsRaw = getVal("--arms");
  const armFilter = armsRaw ? armsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const mode = has("--run")
    ? "run"
    : has("--plan")
      ? "plan"
      : (has("--selftest") || has("--self-test") || argv.length === 0)
        ? "selftest"
        : "selftest";
  return { mode, port, chunks, outPath, armFilter };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli.mode === "plan") {
    await printPlan(cli.chunks);
    return 0;
  }
  if (cli.mode === "run") {
    return await runBenchmark(cli);
  }
  const ok = await runSelfTest();
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(err?.stack ?? err); process.exitCode = 1; },
  );
}
