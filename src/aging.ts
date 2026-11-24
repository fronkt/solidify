/**
 * PRECIPITATION HARDENING (T6 AGE-HARDENING KINETICS)
 *
 * Implements the cited Shercliff & Ashby (1990, Acta Metall. Mater. 38:1789–1802)
 * process model for age-hardenable aluminum alloys on SOLIDIFY's furnace clock:
 *
 *   1. Temperature-corrected kinetic parameter integrated across the full
 *      ramp + hold + cool schedule (same Simpson quadrature as heattreat.ts):
 *
 *        P = ∫ (dt / T) · exp(−Q_A / (R · T))          [s / K]
 *
 *      normalized against each alloy's peak-aging kinetic constant:
 *
 *        P_p = (t_{p,ref} / T_ref) · exp(−Q_A / (R · T_ref))
 *        P̄   = P / P_p
 *
 *      For an isothermal hold at T < T_solvus, peak aging (P̄ = 1) occurs at
 *
 *        t_peak(T) = P_p · T · exp(Q_A / (R · T))
 *                  = t_{p,ref} · (T / T_ref) · exp((Q_A / R) · (1/T − 1/T_ref))
 *
 *   2. Solvus dissolution / reversion:
 *      If the schedule's peak temperature T_peak >= T_solvus (or isothermal
 *      T >= T_solvus), precipitates dissolve back into solid solution:
 *      Δσ_ppt = 0, Δσ_ss = Δσ_{ss,0}, temper = "solutionized (T4)".
 *
 *   3. Strength superposition (Shercliff & Ashby 1990):
 *        f_r(P̄)    = 1 − exp(−P̄)
 *        Δσ_ss(P̄)  = Δσ_{ss,0} · (1 − f_r(P̄))^(2/3) = Δσ_{ss,0} · exp(−2 P̄ / 3)
 *        Δσ_ppt(P̄) = 2 · Δσ_peak · √P̄ / (1 + P̄)
 *        σ_y       = σ_HP(d̄) + Δσ_ss(P̄) + Δσ_ppt(P̄)
 *
 *      This normalized peak combines Friedel shearing (rising arm, P̄ < 1) and
 *      Orowan bypassing (overaging arm, P̄ > 1) with exact analytical guarantees:
 *      Δσ_ppt(0) = 0, strict unique maximum Δσ_peak at P̄ = 1, monotone rise
 *      for P̄ < 1, and monotone overaging decay for P̄ > 1.
 *
 * Scope & honesty:
 *   Modeled strictly for three cited age-hardenable aluminum systems (Al–Cu,
 *   A356 Al–Si–Mg, and AA2024 Al–Cu–Mg). Every other material (Cu, Fe–C, Ni,
 *   Co, Mg, Zn, ice, SCN, abstract model metal, or non-heat-treatable Al mixes)
 *   is explicitly refused with a named reason rather than fitted to a guess.
 *
 * Zero DOM or WebGPU imports so Node CI (`scripts/verify-aging.mjs`) can verify
 * every analytical invariant directly.
 */

import { K0, R_GAS } from "./units";
import type { Mix } from "./alloy";
import type { HeatSchedule } from "./heattreat";

export const AGING_CITATION = "Shercliff & Ashby (1990), Acta Metall. Mater. 38:1789–1802";

export type AgingAlloyId = "al-cu" | "a356" | "aa2024";

export type AgingTemper =
  | "as-cast"
  | "underaged"
  | "peak-aged (T6)"
  | "overaged (T7)"
  | "solutionized (T4)";

export interface AgingAlloySpec {
  readonly id: AgingAlloyId;
  /** Short system name shown in tables and CSV headers. */
  readonly name: string;
  /** Human-readable alloy class label. */
  readonly label: string;
  /** Strengthening precipitate sequence represented by the model. */
  readonly precipitates: string;
  /** Effective activation energy Q_A for precipitate growth and coarsening, J/mol. */
  readonly qA_Jmol: number;
  /** Solvus temperature T_solvus, °C; above this precipitates redissolve into solid solution. */
  readonly solvusC: number;
  /** Reference isothermal aging temperature T_ref, °C, anchoring P_p. */
  readonly refTempC: number;
  /** Reference isothermal peak aging time t_{p,ref} at refTempC, hours. */
  readonly refPeakHours: number;
  /** Peak precipitation yield-strength increment Δσ_peak at P̄ = 1, MPa. */
  readonly deltaSigmaPeakMPa: number;
  /** As-quenched solid-solution yield-strength increment Δσ_{ss,0} at P̄ = 0, MPa. */
  readonly deltaSigmaSs0MPa: number;
  /** Literature provenance for this parameter set. */
  readonly source: string;
}

export const AGING_ALLOYS: Readonly<Record<AgingAlloyId, AgingAlloySpec>> = {
  "al-cu": {
    id: "al-cu",
    name: "Al–Cu",
    label: "Al–Cu (2014/2219-class)",
    precipitates: "θ'' / θ' (Al₂Cu)",
    qA_Jmol: 130_000,
    solvusC: 505,
    refTempC: 170,
    refPeakHours: 12,
    deltaSigmaPeakMPa: 190,
    deltaSigmaSs0MPa: 45,
    source: `${AGING_CITATION} · 2014/2219-class Al–Cu (Q_A 130 kJ/mol, T_solvus 505 °C, peak 170 °C × 12 h)`,
  },
  a356: {
    id: "a356",
    name: "A356",
    label: "A356 (Al–Si–Mg)",
    precipitates: "β'' / β' (Mg₂Si)",
    qA_Jmol: 130_000,
    solvusC: 515,
    refTempC: 165,
    refPeakHours: 8,
    deltaSigmaPeakMPa: 155,
    deltaSigmaSs0MPa: 30,
    source: `${AGING_CITATION} · Al–Si–Mg / 6xxx-class Mg₂Si (Q_A 130 kJ/mol, T_solvus 515 °C, peak 165 °C × 8 h)`,
  },
  aa2024: {
    id: "aa2024",
    name: "AA2024",
    label: "AA2024 (Al–Cu–Mg)",
    precipitates: "S' (Al₂CuMg) / θ'",
    qA_Jmol: 130_000,
    solvusC: 495,
    refTempC: 190,
    refPeakHours: 10,
    deltaSigmaPeakMPa: 240,
    deltaSigmaSs0MPa: 55,
    source: `${AGING_CITATION} · 2024-class Al–Cu–Mg (Q_A 130 kJ/mol, T_solvus 495 °C, peak 190 °C × 10 h)`,
  },
};

export type AgingAlloyResolution =
  | { supported: true; alloyId: AgingAlloyId; spec: AgingAlloySpec }
  | { supported: false; alloyId: null; spec: null; reason: string };

export interface AgingStrength {
  /** Normalized kinetic parameter P̄ = P / P_p (0 when dissolved above solvus). */
  pBar: number;
  /** Transformed precipitate fraction f_r = 1 − exp(−P̄) in [0, 1] (0 when dissolved). */
  fTransformed: number;
  /** Hall–Petch baseline yield strength σ_HP(d̄), MPa. */
  sigmaHpMPa: number;
  /** Solid-solution yield-strength increment Δσ_ss(P̄), MPa. */
  sigmaSsMPa: number;
  /** Precipitation yield-strength increment Δσ_ppt(P̄), MPa. */
  sigmaPptMPa: number;
  /** Total yield strength σ_y = σ_HP + Δσ_ss + Δσ_ppt, MPa. */
  sigmaTotalMPa: number;
  /** Classified temper state. */
  temper: AgingTemper;
  /** True when peak temperature reached or exceeded T_solvus. */
  dissolved: boolean;
}

export interface AgingResult extends AgingStrength {
  supported: true;
  alloyId: AgingAlloyId;
  spec: AgingAlloySpec;
  /** Integrated temperature-corrected kinetic parameter P, s/K (0 if dissolved). */
  kineticP: number;
  /** Alloy peak kinetic constant P_p, s/K. */
  peakP: number;
  /** Peak temperature reached during the schedule, °C. */
  peakC: number;
  /** Isothermal time to peak at the schedule's peak temperature, minutes (null if dissolved). */
  tPeakAtHoldMin: number | null;
  /** Terse on-screen note (non-empty when precipitates dissolve above solvus). */
  note: string;
}

export interface AgingUnsupported {
  supported: false;
  alloyId: null;
  spec: null;
  reason: string;
}

export type AgingEvaluation = AgingResult | AgingUnsupported;

export interface AgingCurvePoint {
  timeMin: number;
  timeHours: number;
  pBar: number;
  sigmaHpMPa: number;
  sigmaSsMPa: number;
  sigmaPptMPa: number;
  sigmaTotalMPa: number;
  temper: AgingTemper;
}

export interface AgingCurve {
  spec: AgingAlloySpec;
  tempC: number;
  hpSigmaMPa: number;
  dissolved: boolean;
  /** Isothermal time to peak strength at tempC, minutes (null when tempC >= solvusC). */
  tPeakMin: number | null;
  /** Total yield strength at P̄ = 1 (or T4 solutionized value if dissolved), MPa. */
  peakTotalMPa: number;
  /** Peak precipitation increment Δσ_peak (0 when dissolved), MPa. */
  peakPptMPa: number;
  points: AgingCurvePoint[];
}

/** Normalized P̄ window around unity classified as peak-aged (T6) (>= 97.7 % of Δσ_peak). */
export const T6_PBAR_MIN = 0.65;
export const T6_PBAR_MAX = 1.5;
/** Below this P̄, negligible precipitation has occurred ("as-cast"). */
export const AS_CAST_PBAR_MAX = 1e-3;

export const SOLVUS_DISSOLUTION_NOTE = "above solvus: precipitates dissolve (T4 solutionize)";

const NON_AL_LABELS: Record<string, string> = {
  generic: "model metal (pure)",
  steel: "steel · Fe–C",
  ni: "nickel superalloy",
  co: "cobalt alloy",
  cu: "copper · bronze",
  mg: "magnesium · AZ91",
  zn: "zinc · spangle",
  ice: "water · ice",
  scn: "succinonitrile (SCN)",
  qc: "Al–Co–Ni · quasicrystal",
};

/**
 * Resolve the active material + optional poured Alloy Composer mix to one of the
 * three cited age-hardenable aluminum specs, or return an explicit refusal.
 */
export function resolveAgingAlloy(
  materialKey: string,
  pouredMix?: Mix | null,
): AgingAlloyResolution {
  const key = (materialKey || "").trim().toLowerCase();

  // Direct aging alloy IDs (convenient for programmatic callers and CI tests)
  if (!pouredMix && (key === "al-cu" || key === "a356" || key === "aa2024")) {
    const spec = AGING_ALLOYS[key];
    return { supported: true, alloyId: key, spec };
  }

  // Poured mix on aluminum base takes precedence over generic Al–4Cu default
  if (pouredMix && pouredMix.base === "al" && (key === "al" || key === "")) {
    const wt = pouredMix.wt ?? {};
    const cu = Number.isFinite(wt.Cu) ? wt.Cu : 0;
    const si = Number.isFinite(wt.Si) ? wt.Si : 0;
    const mg = Number.isFinite(wt.Mg) ? wt.Mg : 0;
    if (cu >= 1.0 && mg >= 0.3) {
      return { supported: true, alloyId: "aa2024", spec: AGING_ALLOYS.aa2024 };
    }
    if (si >= 0.3 && mg >= 0.2) {
      return { supported: true, alloyId: "a356", spec: AGING_ALLOYS.a356 };
    }
    if (cu >= 1.0) {
      return { supported: true, alloyId: "al-cu", spec: AGING_ALLOYS["al-cu"] };
    }
    return {
      supported: false,
      alloyId: null,
      spec: null,
      reason:
        "poured Al chemistry lacks an age-hardenable Cu or Si+Mg system; precipitation aging is modeled for Al–Cu, A356, and AA2024 only",
    };
  }

  // Shipped aluminum preset (`materials.ts`: Al–4Cu)
  if (key === "al") {
    return { supported: true, alloyId: "al-cu", spec: AGING_ALLOYS["al-cu"] };
  }

  const name = NON_AL_LABELS[key] ?? (materialKey || "this material");
  return {
    supported: false,
    alloyId: null,
    spec: null,
    reason: `${name}: precipitation aging is modeled for age-hardenable Al alloys only (Al–Cu, A356, AA2024)`,
  };
}

/** Shercliff–Ashby kinetic integrand (1 / T) · exp(−Q_A / (R · T)), s⁻¹·K⁻¹·s = K⁻¹. */
export function agingRatePerSec(qA_Jmol: number, tK: number): number {
  if (!(qA_Jmol > 0) || !(tK > 0)) return 0;
  return (1 / tK) * Math.exp(-qA_Jmol / (R_GAS * tK));
}

/** Alloy peak-aging kinetic parameter P_p = (t_{p,ref} / T_ref) · exp(−Q_A / (R · T_ref)), s/K. */
export function peakKineticP(spec: AgingAlloySpec): number {
  const tRefK = spec.refTempC + K0;
  const tRefSec = spec.refPeakHours * 3600;
  return tRefSec * agingRatePerSec(spec.qA_Jmol, tRefK);
}

/**
 * Exact isothermal time to peak hardness t_peak(T) in seconds at temperature `tC`.
 * Returns `null` when `tC >= spec.solvusC` (precipitates dissolve) or `tC <= -273.15 °C`.
 *
 * Written relative to (T_ref, t_{p,ref}) to avoid exponent overflow and preserve
 * exact identity `isothermalPeakTimeSec(spec, spec.refTempC) === spec.refPeakHours * 3600`:
 *   t_peak(T) = t_{p,ref} · (T / T_ref) · exp((Q_A / R) · (1/T − 1/T_ref))
 */
export function isothermalPeakTimeSec(spec: AgingAlloySpec, tC: number): number | null {
  if (!Number.isFinite(tC) || tC >= spec.solvusC) return null;
  const tK = tC + K0;
  if (!(tK > 0)) return null;
  const tRefK = spec.refTempC + K0;
  const tRefSec = spec.refPeakHours * 3600;
  const expo = (spec.qA_Jmol / R_GAS) * (1 / tK - 1 / tRefK);
  const tSec = tRefSec * (tK / tRefK) * Math.exp(expo);
  return Number.isFinite(tSec) ? tSec : Infinity;
}

/** Exact isothermal time to peak hardness in minutes (`null` above solvus). */
export function isothermalPeakTimeMin(spec: AgingAlloySpec, tC: number): number | null {
  const s = isothermalPeakTimeSec(spec, tC);
  return s == null ? null : s / 60;
}

/** Classify the normalized kinetic state P̄ (and solvus reversion flag) into an explicit temper. */
export function classifyTemper(pBar: number, dissolved: boolean): AgingTemper {
  if (dissolved) return "solutionized (T4)";
  if (!Number.isFinite(pBar) || pBar < AS_CAST_PBAR_MAX) return "as-cast";
  if (pBar < T6_PBAR_MIN) return "underaged";
  if (pBar <= T6_PBAR_MAX) return "peak-aged (T6)";
  return "overaged (T7)";
}

/**
 * Exact Shercliff–Ashby strength superposition at normalized kinetic state `pBar`:
 *   f_r       = 1 − exp(−P̄)
 *   Δσ_ss(P̄)  = Δσ_{ss,0} · (1 − f_r)^(2/3) = Δσ_{ss,0} · exp(−2 P̄ / 3)
 *   Δσ_ppt(P̄) = 2 · Δσ_peak · √P̄ / (1 + P̄)
 *   σ_y       = σ_HP + Δσ_ss + Δσ_ppt
 */
export function agingStrengthAt(
  spec: AgingAlloySpec,
  pBar: number,
  hpSigmaMPa: number,
  dissolved = false,
): AgingStrength {
  const hp = Number.isFinite(hpSigmaMPa) ? Math.max(0, hpSigmaMPa) : 0;
  if (dissolved) {
    const ss = spec.deltaSigmaSs0MPa;
    return {
      pBar: 0,
      fTransformed: 0,
      sigmaHpMPa: hp,
      sigmaSsMPa: ss,
      sigmaPptMPa: 0,
      sigmaTotalMPa: hp + ss,
      temper: "solutionized (T4)",
      dissolved: true,
    };
  }
  const p = Number.isFinite(pBar) && pBar > 0 ? pBar : 0;
  const fTransformed = p > 0 ? 1 - Math.exp(-p) : 0;
  const sigmaSsMPa = spec.deltaSigmaSs0MPa * Math.exp((-2 / 3) * p);
  const sigmaPptMPa = p > 0 ? (2 * spec.deltaSigmaPeakMPa * Math.sqrt(p)) / (1 + p) : 0;
  return {
    pBar: p,
    fTransformed,
    sigmaHpMPa: hp,
    sigmaSsMPa,
    sigmaPptMPa,
    sigmaTotalMPa: hp + sigmaSsMPa + sigmaPptMPa,
    temper: classifyTemper(p, false),
    dissolved: false,
  };
}

/**
 * Integrate the Shercliff–Ashby kinetic parameter P = ∫(dt/T)·exp(−Q_A/(RT))
 * across a full `HeatSchedule` (ramps, holds, and quenches) using Simpson's rule.
 */
export function integrateKineticP(
  sch: HeatSchedule,
  qA_Jmol: number,
  samplesPerStage = 2048,
): { P: number; seconds: number; peakC: number } {
  let tC = sch.startC;
  let seconds = 0;
  let P = 0;
  let peakC = tC;

  for (const st of sch.stages) {
    let dur: number;
    let endC: number;
    if (st.kind === "hold") {
      dur = st.minutes * 60;
      endC = tC;
    } else if (st.kind === "ramp") {
      endC = st.toC;
      const rpm = Math.max(1e-6, Math.abs(st.cPerMin));
      dur = (Math.abs(endC - tC) / rpm) * 60;
    } else {
      endC = st.toC;
      const rps = Math.max(1e-6, Math.abs(st.cPerSec));
      dur = Math.abs(endC - tC) / rps;
    }
    if (!(dur > 0)) {
      tC = endC;
      continue;
    }

    const m = Math.max(2, samplesPerStage + (samplesPerStage % 2));
    const h = dur / m;
    let sum = 0;
    for (let i = 0; i <= m; i++) {
      const f = i / m;
      const tK = tC + (endC - tC) * f + K0;
      const w = i === 0 || i === m ? 1 : i % 2 ? 4 : 2;
      sum += w * agingRatePerSec(qA_Jmol, tK);
    }
    P += (h / 3) * sum;
    seconds += dur;
    peakC = Math.max(peakC, tC, endC);
    tC = endC;
  }

  return { P, seconds, peakC };
}

/**
 * Evaluate Shercliff–Ashby precipitation aging for a resolved alloy spec across
 * a `HeatSchedule` (ramp + hold + cool), superposed on Hall–Petch `hpSigmaMPa`.
 */
export function evaluateAging(
  spec: AgingAlloySpec,
  sch: HeatSchedule,
  hpSigmaMPa: number,
  samplesPerStage = 2048,
): AgingResult {
  const { P, peakC } = integrateKineticP(sch, spec.qA_Jmol, samplesPerStage);
  const peakP = peakKineticP(spec);
  const dissolved = peakC >= spec.solvusC;
  const kineticP = dissolved ? 0 : P;
  const pBar = dissolved || !(peakP > 0) ? 0 : P / peakP;
  const strength = agingStrengthAt(spec, pBar, hpSigmaMPa, dissolved);
  return {
    supported: true,
    alloyId: spec.id,
    spec,
    kineticP,
    peakP,
    peakC,
    tPeakAtHoldMin: dissolved ? null : isothermalPeakTimeMin(spec, peakC),
    note: dissolved ? SOLVUS_DISSOLUTION_NOTE : "",
    ...strength,
  };
}

/**
 * Convenience entry point: resolve material + optional poured mix and evaluate
 * precipitation aging on `sch`, or return `{ supported: false, reason }`.
 */
export function evaluateAgingForMaterial(
  materialKey: string,
  pouredMix: Mix | null | undefined,
  sch: HeatSchedule,
  hpSigmaMPa: number,
  samplesPerStage = 2048,
): AgingEvaluation {
  const res = resolveAgingAlloy(materialKey, pouredMix);
  if (!res.supported) return res;
  return evaluateAging(res.spec, sch, hpSigmaMPa, samplesPerStage);
}

/**
 * Sample an isothermal age-hardening curve σ_y(t) on a logarithmic time grid
 * `[minS, maxS]` (default 1 min to 1000 h) for live plotting and CSV export.
 */
export function agingCurve(
  spec: AgingAlloySpec,
  tC: number,
  hpSigmaMPa: number,
  minS = 60,
  maxS = 3_600_000,
  nPts = 121,
): AgingCurve {
  const hp = Number.isFinite(hpSigmaMPa) ? Math.max(0, hpSigmaMPa) : 0;
  const dissolved = !Number.isFinite(tC) || tC >= spec.solvusC;
  const tPeakSec = dissolved ? null : isothermalPeakTimeSec(spec, tC);
  const tPeakMin = tPeakSec != null ? tPeakSec / 60 : null;

  const lo = Math.max(1e-3, minS);
  const hi = Math.max(lo, maxS);
  const count = Math.max(2, Math.floor(nPts));
  const ratio = hi / lo;
  const points: AgingCurvePoint[] = [];

  for (let i = 0; i < count; i++) {
    const frac = i / (count - 1);
    const tSec = lo * Math.pow(ratio, frac);
    const pBar = dissolved || tPeakSec == null || !(tPeakSec > 0) ? 0 : tSec / tPeakSec;
    const st = agingStrengthAt(spec, pBar, hp, dissolved);
    points.push({
      timeMin: tSec / 60,
      timeHours: tSec / 3600,
      pBar: st.pBar,
      sigmaHpMPa: st.sigmaHpMPa,
      sigmaSsMPa: st.sigmaSsMPa,
      sigmaPptMPa: st.sigmaPptMPa,
      sigmaTotalMPa: st.sigmaTotalMPa,
      temper: st.temper,
    });
  }

  const peakSt = agingStrengthAt(spec, 1, hp, dissolved);
  return {
    spec,
    tempC: tC,
    hpSigmaMPa: hp,
    dissolved,
    tPeakMin,
    peakTotalMPa: peakSt.sigmaTotalMPa,
    peakPptMPa: peakSt.sigmaPptMPa,
    points,
  };
}
