/**
 * 2D BINARY EUTECTIC PHASE-FIELD SOLVER (Folch & Plapp 2005 + Jackson & Hunt 1966)
 *
 * Pure CPU physics & diagnostics (zero DOM/WebGPU runtime dependencies) plus
 * WebGPU compute (`EutecticSim`) and full-canvas renderer (`EutecticRenderer`).
 *
 * Model summary:
 *   - Folch & Plapp (2005), Phys. Rev. E 72, 011602: three-phase order
 *     parameters (pA, pB, pL) constrained to the simplex pA + pB + pL = 1,
 *     exact Eq. (17) tilt functions g_i(p) (zero third-phase intrusion on every
 *     two-phase interface), symmetric triple-well potential sum_i p_i^2(1-p_i)^2,
 *     simplex-projected Allen-Cahn kinetics, and conservative face-flux solute
 *     diffusion dc/dt = div(D * pL * grad(mu)) with c = mu + gB - gA.
 *   - Jackson & Hunt (1966), Trans. Metall. Soc. AIME 236:1129-1142: exact
 *     analytical lamellar spacing / front-undercooling relation
 *     dT(lambda) = K1 * V * lambda + K2 / lambda with Fourier series P(f).
 *
 * Honest scope note:
 *   - The GPU solver runs the 2D isotropic diffuse-interface Folch-Plapp model
 *     with interface width W enlarged relative to the nanometer capillary length
 *     for interactive stepping, and maps dimensionless spacing/undercooling onto
 *     each alloy's Jackson-Hunt scale. Al-Si carries an explicit faceted-Si
 *     irregular-eutectic caveat.
 */

import { Units, scaleOf } from "./units";
import { bridgeOf, type Bridge } from "./plot/quantity";

export type EutecticAlloyId = "alcu" | "pbsn" | "alsi" | "symmetric";
export type EutecticLens = 0 | 1 | 2; // 0 = phases, 1 = solute, 2 = etch

export interface EutecticAlloy {
  id: EutecticAlloyId;
  label: string;
  teC: number;
  cE: number;
  cAlpha: number;
  cBeta: number;
  unitLabel: string;
  dLiqM2s: number;
  /** Magnitude |m_alpha| of alpha liquidus slope at T_E, K / unitLabel. */
  mAlpha: number;
  /** Magnitude |m_beta| of beta liquidus slope at T_E, K / unitLabel. */
  mBeta: number;
  /** Gibbs-Thomson coefficient Gamma_alpha, K*m (effective sin(theta)=0.5 at 120 deg triple junction). */
  gammaAlphaKm: number;
  /** Gibbs-Thomson coefficient Gamma_beta, K*m. */
  gammaBetaKm: number;
  /** Literature reference lambda^2 * V in um^3/s (for display & comparison). */
  lambda2VRefUm3s: number;
  note: string;
  caveat?: string;
  citation: string;
}

export const EUTECTIC_ALLOYS: Record<EutecticAlloyId, EutecticAlloy> = {
  alcu: {
    id: "alcu",
    label: "Al–33.2 wt% Cu (Al / Al₂Cu)",
    teC: 548.2,
    cE: 33.2,
    cAlpha: 5.65,
    cBeta: 52.5,
    unitLabel: "wt% Cu",
    dLiqM2s: 3.0e-9,
    mAlpha: 4.9,
    mBeta: 3.4,
    gammaAlphaKm: 2.4e-7,
    gammaBetaKm: 1.3e-7,
    lambda2VRefUm3s: 88.5,
    note: "Classic regular non-faceted lamellar eutectic (α-Al + θ-Al₂Cu, T_E 548.2 °C).",
    citation: "Jackson & Hunt (1966); Gunduz & Hunt (1985); Kurz & Fisher (1998) Table 5.1",
  },
  pbsn: {
    id: "pbsn",
    label: "Sn–38.1 wt% Pb (Sn / Pb)",
    teC: 183.0,
    cE: 38.1,
    cAlpha: 2.5,
    cBeta: 80.8,
    unitLabel: "wt% Pb",
    dLiqM2s: 1.9e-9,
    mAlpha: 1.28,
    mBeta: 2.33,
    gammaAlphaKm: 0.65e-7,
    gammaBetaKm: 0.9e-7,
    lambda2VRefUm3s: 32.0,
    note: "Canonical low-temperature solder lamellar eutectic (β-Sn + α-Pb, T_E 183 °C).",
    citation: "Jordan & Hunt (1971); Gunduz & Hunt (1985); Kurz & Fisher (1998) Table 5.1",
  },
  alsi: {
    id: "alsi",
    label: "Al–12.6 wt% Si (Al / Si)",
    teC: 577.0,
    cE: 12.6,
    cAlpha: 1.65,
    cBeta: 99.8,
    unitLabel: "wt% Si",
    dLiqM2s: 4.3e-9,
    mAlpha: 6.6,
    mBeta: 12.0,
    gammaAlphaKm: 2.4e-7,
    gammaBetaKm: 1.7e-7,
    lambda2VRefUm3s: 99.0,
    note: "Foundry casting eutectic (α-Al + diamond-cubic Si, T_E 577 °C).",
    caveat:
      "Silicon grows faceted in real Al–Si, producing an irregular flake eutectic whose operating spacing sits 2–3× wider than the regular Jackson–Hunt extremum shown here.",
    citation: "Toloui & Hellawell (1976); Gunduz & Hunt (1985); Kurz & Fisher (1998)",
  },
  symmetric: {
    id: "symmetric",
    label: "Symmetric eutectic (Folch–Plapp)",
    teC: 0,
    cE: 0,
    cAlpha: -1,
    cBeta: 1,
    unitLabel: "dimless",
    dLiqM2s: 1,
    mAlpha: 1,
    mBeta: 1,
    gammaAlphaKm: 1,
    gammaBetaKm: 1,
    lambda2VRefUm3s: 55.6,
    note: "Dimensionless symmetric benchmark (f_α = f_β = 0.5 at c₀ = 0, equal liquidus slopes and capillary lengths).",
    citation: "Folch & Plapp (2005), Phys. Rev. E 72, 011602",
  },
};

export interface EutecticParams {
  alloy: EutecticAlloyId;
  /** Pull speed V in µm/s for physical alloys (or scaled 0.05× in sim units). */
  pullV: number;
  /** Normalized off-eutectic liquid composition offset in [-0.25, 0.25]. */
  c0Off: number;
  /** Thermal gradient G in K/mm (scaled into sim gradient G_sim). */
  gradG: number;
  /** Initial alternating alpha/beta lamellar pairs seeded across the domain width (2..16). */
  seedPairs: number;
  /** Square grid resolution n × n (default 256). */
  n: number;
  /** Active visualization lens: 0 = phases, 1 = solute, 2 = etch. */
  lens: EutecticLens;
}

export const EUTECTIC_DEFAULTS: EutecticParams = {
  alloy: "alcu",
  pullV: 20,
  c0Off: 0,
  gradG: 10,
  seedPairs: 6,
  n: 256,
  lens: 0,
};

export interface JacksonHuntModel {
  fAlpha: number;
  fBeta: number;
  pSeries: number;
  /** K1 in K·s/µm² (physical) or dimless (symmetric). */
  k1Phys: number;
  /** K2 in K·µm (physical) or dimless (symmetric). */
  k2Phys: number;
  /** Constant lambda_min^2 * V in µm³/s (physical) or cells³/simTime (symmetric). */
  lambda2VPhys: number;
  lambdaMinUm: number;
  dTMinK: number;
  /** Solver dimensionless Jackson-Hunt parameters matching the GPU Folch-Plapp PDE. */
  k1Sim: number;
  k2Sim: number;
  lambda2VSim: number;
  lambdaMinCells: number;
  dTMinSim: number;
  dTPhys(lambdaUm: number): number;
  dTSim(lambdaCells: number): number;
}

export interface EutecticStats {
  step: number;
  simTime: number;
  frontY: number;
  shifts: number;
  lambdaCells: number | null;
  lambdaUm: number | null;
  pairs: number;
  fAlpha: number;
  fBeta: number;
  fLiquid: number;
  dTFrontSim: number;
  dTFrontK: number;
  lambda2VUm3s: number | null;
  meanC: number;
  maxSimplexErr: number;
  valid: boolean;
}

// ------------------------------------------------ solver dimensionless anchor

/**
 * Dimensionless Folch-Plapp PDE constants chosen for:
 *  - strict explicit parabolic CFL safety (diffusion CFL <= 0.72, phase CFL <= 0.56)
 *  - isotropic triple-junction dihedral balance (sin theta = 0.5, 120 deg angles)
 *  - interactive lamellar spacing lambda_min ~ 30-45 cells on 256^2 (6-8 pairs)
 *  - low Peclet number Pe = V*lambda / (2*D) < 0.25 so Jackson-Hunt scaling holds.
 */
export const FP_SIM = {
  dx: 1.0,
  dt: 0.045,
  W: 1.2,
  tau: 0.5,
  lambdaCoup: 0.6,
  dLiq: 4.0,
  vRefPhysUmS: 20.0,
  vRefSim: 0.045,
  gRefPhysKmm: 10.0,
  gRefSim: 0.004,
} as const;

/** Exact capillary length d_0 = sqrt(2) * W / (3 * lambdaCoup) for triple-well sum p_i^2(1-p_i)^2. */
export const FP_D0_SIM = (Math.SQRT2 * FP_SIM.W) / (3 * FP_SIM.lambdaCoup);

/** Map physical pull speed (µm/s) to stable Folch-Plapp dimensionless pull speed V_sim. */
export function pullVToSim(pullVUmS: number): number {
  const v = Number.isFinite(pullVUmS) ? Math.max(1, pullVUmS) : FP_SIM.vRefPhysUmS;
  const raw = FP_SIM.vRefSim * (v / FP_SIM.vRefPhysUmS);
  return Math.min(0.16, Math.max(0.004, raw));
}

/** Map physical thermal gradient (K/mm) to dimensionless Folch-Plapp gradient G_sim (per cell). */
export function gradGToSim(gradGKmm: number): number {
  const g = Number.isFinite(gradGKmm) ? Math.max(0.5, gradGKmm) : FP_SIM.gRefPhysKmm;
  const raw = FP_SIM.gRefSim * (g / FP_SIM.gRefPhysKmm);
  return Math.min(0.025, Math.max(0.001, raw));
}

// ------------------------------------------------ Jackson-Hunt (1966) math

/**
 * Jackson & Hunt (1966) Fourier series:
 *   P(f) = sum_{n=1}^{terms} sin^2(n * pi * f) / (n * pi)^3
 * Exact symmetry P(f) = P(1 - f), P(0) = P(1) = 0, maximum P(0.5) = 7*zeta(3)/(8*pi^3) ≈ 0.0339224.
 */
export function jacksonHuntSeriesP(f: number, terms = 256): number {
  if (!Number.isFinite(f) || f <= 0 || f >= 1) return 0;
  const nMax = Math.max(1, Math.floor(terms));
  let sum = 0;
  for (let n = 1; n <= nMax; n++) {
    const npi = n * Math.PI;
    const s = Math.sin(npi * f);
    sum += (s * s) / (npi * npi * npi);
  }
  return sum;
}

/**
 * Binary eutectic lever rule for solid phase fractions at composition `c0`
 * between solidus endpoints `cAlpha` and `cBeta`.
 */
export function leverRule(
  c0: number,
  cAlpha: number,
  cBeta: number,
): { fAlpha: number; fBeta: number } {
  const span = cBeta - cAlpha;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-12) {
    return { fAlpha: 0.5, fBeta: 0.5 };
  }
  const raw = (cBeta - c0) / span;
  const fAlpha = Math.max(0, Math.min(1, raw));
  return { fAlpha, fBeta: 1 - fAlpha };
}

/**
 * Exact Jackson & Hunt (1966) analytical model for both physical alloy units
 * and the dimensionless Folch-Plapp solver at `(alloyId, pullVUmS, c0Off)`.
 */
export function jacksonHuntModel(
  alloyId: EutecticAlloyId,
  pullVUmS: number,
  c0Off = 0,
): JacksonHuntModel {
  const alloy = EUTECTIC_ALLOYS[alloyId] ?? EUTECTIC_ALLOYS.alcu;
  const vPhys = Number.isFinite(pullVUmS) && pullVUmS > 0 ? pullVUmS : FP_SIM.vRefPhysUmS;
  const off = Number.isFinite(c0Off) ? Math.max(-0.25, Math.min(0.25, c0Off)) : 0;

  const dc = alloy.cBeta - alloy.cAlpha;
  const c0Phys = Math.max(
    alloy.cAlpha + 0.04 * dc,
    Math.min(alloy.cBeta - 0.04 * dc, alloy.cE + off * 0.5 * dc),
  );
  const { fAlpha, fBeta } = leverRule(c0Phys, alloy.cAlpha, alloy.cBeta);
  const pSeries = jacksonHuntSeriesP(fAlpha);

  // Dimensionless Folch-Plapp solver JH constants (symmetric phase diagram at c0Off)
  const simLever = leverRule(off, -1, 1);
  const fASim = Math.max(0.05, Math.min(0.95, simLever.fAlpha));
  const fBSim = 1 - fASim;
  const pSim = jacksonHuntSeriesP(fASim);
  const vSim = pullVToSim(vPhys);
  // Symmetric Folch-Plapp: m_a = m_b = 1 (mBar = 0.5), dC = 2, Gamma = d0, sin(theta) = 0.5
  const k1Sim = pSim / (FP_SIM.dLiq * fASim * fBSim);
  const k2Sim = FP_D0_SIM / (2 * fASim * fBSim);
  const lambda2VSim = k2Sim / k1Sim;
  const lambdaMinCells = Math.sqrt(lambda2VSim / vSim);
  const dTMinSim = 2 * Math.sqrt(k1Sim * k2Sim * vSim);

  let k1Phys: number;
  let k2Phys: number;
  let lambda2VPhys: number;
  let lambdaMinUm: number;
  let dTMinK: number;

  if (alloy.id === "symmetric") {
    k1Phys = k1Sim;
    k2Phys = k2Sim;
    lambda2VPhys = lambda2VSim;
    lambdaMinUm = lambdaMinCells;
    dTMinK = dTMinSim;
  } else {
    // Convert SI to µm / s / K for Jackson-Hunt curve & readouts
    const dLiqUm2s = alloy.dLiqM2s * 1e12;
    const gammaAlphaKUm = alloy.gammaAlphaKm * 1e6;
    const gammaBetaKUm = alloy.gammaBetaKm * 1e6;
    const mBar = (alloy.mAlpha * alloy.mBeta) / (alloy.mAlpha + alloy.mBeta);
    // Isotropic 120 deg triple junction: sin(theta_alpha) = sin(theta_beta) = 0.5
    const sinTheta = 0.5;
    k1Phys = ((mBar * dc) / dLiqUm2s) * (pSeries / (fAlpha * fBeta));
    k2Phys =
      2 *
      mBar *
      ((gammaAlphaKUm * sinTheta) / (alloy.mAlpha * fAlpha) +
        (gammaBetaKUm * sinTheta) / (alloy.mBeta * fBeta));
    lambda2VPhys = k2Phys / k1Phys;
    lambdaMinUm = Math.sqrt(lambda2VPhys / vPhys);
    dTMinK = 2 * Math.sqrt(k1Phys * k2Phys * vPhys);
  }

  return {
    fAlpha,
    fBeta,
    pSeries,
    k1Phys,
    k2Phys,
    lambda2VPhys,
    lambdaMinUm,
    dTMinK,
    k1Sim,
    k2Sim,
    lambda2VSim,
    lambdaMinCells,
    dTMinSim,
    dTPhys(lambdaUm: number): number {
      const lam = Math.max(1e-6, lambdaUm);
      return k1Phys * (alloy.id === "symmetric" ? vSim : vPhys) * lam + k2Phys / lam;
    },
    dTSim(lambdaCells: number): number {
      const lam = Math.max(1e-6, lambdaCells);
      return k1Sim * vSim * lam + k2Sim / lam;
    },
  };
}

/**
 * Physical conversion factors anchoring the dimensionless Folch-Plapp GPU grid
 * to the alloy's exact Jackson-Hunt minimum-undercooling scale at V_ref.
 */
export function eutecticScales(alloyId: EutecticAlloyId, c0Off = 0): {
  umPerCell: number;
  kelvinPerSimT: number;
} {
  if (alloyId === "symmetric") return { umPerCell: 1, kelvinPerSimT: 1 };
  const ref = jacksonHuntModel(alloyId, FP_SIM.vRefPhysUmS, c0Off);
  return {
    umPerCell: ref.lambdaMinUm / Math.max(1e-6, ref.lambdaMinCells),
    kelvinPerSimT: ref.dTMinK / Math.max(1e-6, ref.dTMinSim),
  };
}

/**
 * Explicit 2D finite-difference parabolic CFL check for both the conservative
 * 5-point solute diffusion stencil (`dt <= dx^2 / (4 * D)`) and the phase-field
 * Allen-Cahn stencil (`dt <= dx^2 / (4 * W^2 / tau)`).
 */
export function eutecticStability(
  dx: number,
  dt: number,
  dDiff: number,
  w2OverTau: number,
): {
  stable: boolean;
  diffusionCfl: number;
  phaseCfl: number;
  maxDt: number;
} {
  if (!(dx > 0) || !(dt > 0) || !Number.isFinite(dx) || !Number.isFinite(dt)) {
    return { stable: false, diffusionCfl: Infinity, phaseCfl: Infinity, maxDt: 0 };
  }
  const dx2 = dx * dx;
  const diffusionCfl = (4 * Math.max(0, dDiff) * dt) / dx2;
  const phaseCfl = (4 * Math.max(0, w2OverTau) * dt) / dx2;
  const maxRate = Math.max(dDiff, w2OverTau, 1e-12);
  const maxDt = dx2 / (4 * maxRate);
  return {
    stable: diffusionCfl < 1 && phaseCfl < 1,
    diffusionCfl,
    phaseCfl,
    maxDt,
  };
}

// ------------------------------------------------ Folch-Plapp Eq. (17) helpers

/**
 * Exact Folch & Plapp (2005) Eq. (17) tilt function g_i(p_i, p_j, p_k):
 *   g_i = (1/4) * p_i^2 * [15*(1 - p_i)*(1 + p_i - (p_k - p_j)^2) + p_i*(9*p_i^2 - 5)]
 * Satisfies g_A + g_B + g_L === 1 identically on the simplex, reduces to the
 * quintic polynomial p^3*(10 - 15p + 6p^2) on every two-phase edge, and has
 * zero projected derivative for the absent third phase.
 */
export function fpTilt(pi: number, pj: number, pk: number): number {
  const diff = pk - pj;
  return 0.25 * pi * pi * (15 * (1 - pi) * (1 + pi - diff * diff) + pi * (9 * pi * pi - 5));
}

/** Exact partial derivatives (dg_i/dp_i, dg_i/dp_j, dg_i/dp_k) of `fpTilt`. */
export function fpTiltGrad(pi: number, pj: number, pk: number): [number, number, number] {
  const diff = pk - pj;
  const om = 1 - pi;
  const dSelf = 3.75 * pi * (om * om * (2 + 3 * pi) - (2 - 3 * pi) * diff * diff);
  const cross = 7.5 * pi * pi * om * diff;
  return [dSelf, cross, -cross];
}

// ------------------------------------------------ CPU diagnostics & step (CI)

export interface LamellaMeasurement {
  frontY: number;
  lambdaCells: number | null;
  pairs: number;
  fAlpha: number;
  fBeta: number;
  fLiquid: number;
  meanC: number;
  maxSimplexErr: number;
  valid: boolean;
}

/**
 * Measure lamellar spacing (1D DFT dominant peak with parabolic refinement +
 * zero-crossing fallback), front position, solid phase fractions, mean solute,
 * and simplex error directly from an RGBA float `(pA, pB, pL, mu)` field.
 */
export function measureLamellae(
  data: Float32Array,
  nx: number,
  ny: number,
  dx = 1,
  frontBand = 12,
): LamellaMeasurement {
  const total = nx * ny;
  if (total <= 0 || data.length < total * 4) {
    return {
      frontY: 0,
      lambdaCells: null,
      pairs: 0,
      fAlpha: 0.5,
      fBeta: 0.5,
      fLiquid: 1,
      meanC: 0,
      maxSimplexErr: 0,
      valid: false,
    };
  }

  let valid = true;
  let maxSimplexErr = 0;
  let sumC = 0;
  let sumL = 0;
  const sRow = new Float64Array(ny);

  for (let y = 0; y < ny; y++) {
    let rowSolid = 0;
    const rowOff = y * nx * 4;
    for (let x = 0; x < nx; x++) {
      const i = rowOff + x * 4;
      const pA = data[i];
      const pB = data[i + 1];
      const pL = data[i + 2];
      const mu = data[i + 3];
      if (!Number.isFinite(pA) || !Number.isFinite(pB) || !Number.isFinite(pL) || !Number.isFinite(mu)) {
        valid = false;
        continue;
      }
      const err = Math.abs(pA + pB + pL - 1);
      if (err > maxSimplexErr) maxSimplexErr = err;
      const gA = fpTilt(pA, pB, pL);
      const gB = fpTilt(pB, pL, pA);
      sumC += mu + gB - gA;
      sumL += pL;
      rowSolid += pA + pB;
    }
    sRow[y] = rowSolid / nx;
  }

  // Locate solid-liquid front where row-averaged solid fraction crosses 0.5
  let frontY = 0;
  let foundCrossing = false;
  for (let y = ny - 2; y >= 0; y--) {
    if (sRow[y] >= 0.5 && sRow[y + 1] < 0.5) {
      const denom = sRow[y] - sRow[y + 1];
      frontY = denom > 1e-9 ? y + (sRow[y] - 0.5) / denom : y;
      foundCrossing = true;
      break;
    }
  }
  if (!foundCrossing) {
    frontY = sRow[ny - 1] >= 0.5 ? ny - 1 : 0;
  }

  // Solid phase fractions in a clean band just behind the front
  const band = Math.max(4, Math.floor(frontBand));
  const yFrontInt = Math.floor(frontY);
  const yHi = yFrontInt >= 6 ? yFrontInt - 4 : Math.max(0, yFrontInt - 1);
  const yLo = Math.max(1, yHi - band + 1);
  let sumA = 0;
  let sumB = 0;
  if (yFrontInt >= 2) {
    for (let y = yLo; y <= yHi; y++) {
      const rowOff = y * nx * 4;
      for (let x = 0; x < nx; x++) {
        const i = rowOff + x * 4;
        const pA = data[i];
        const pB = data[i + 1];
        if (pA + pB > 0.5) {
          sumA += Math.max(0, pA);
          sumB += Math.max(0, pB);
        }
      }
    }
  }
  const solidTot = sumA + sumB;
  const fAlpha = solidTot > 1e-6 ? sumA / solidTot : 0.5;
  const fBeta = solidTot > 1e-6 ? sumB / solidTot : 0.5;

  // 1D contrast profile behind the front for FFT dominant wavelength + zero-crossing fallback
  let lambdaCells: number | null = null;
  let pairs = 0;
  if (yFrontInt >= 3 && nx >= 8) {
    const syLo = Math.max(1, yHi - 2);
    const syHi = Math.max(syLo, yHi);
    const rowsUsed = syHi - syLo + 1;
    const sig = new Float64Array(nx);
    let meanSig = 0;
    for (let x = 0; x < nx; x++) {
      let acc = 0;
      for (let y = syLo; y <= syHi; y++) {
        const i = (y * nx + x) * 4;
        acc += data[i] - data[i + 1];
      }
      sig[x] = acc / rowsUsed;
      meanSig += sig[x];
    }
    meanSig /= nx;
    let varAcc = 0;
    for (let x = 0; x < nx; x++) {
      sig[x] -= meanSig;
      varAcc += sig[x] * sig[x];
    }
    const rms = Math.sqrt(varAcc / nx);

    if (rms > 0.05) {
      const kMax = Math.max(2, Math.floor(nx / 4));
      const power = new Float64Array(kMax + 1);
      let kPeak = 1;
      let pPeak = -1;
      const twoPiOverN = (2 * Math.PI) / nx;
      for (let k = 1; k <= kMax; k++) {
        let re = 0;
        let im = 0;
        const w = twoPiOverN * k;
        for (let x = 0; x < nx; x++) {
          const ang = w * x;
          re += sig[x] * Math.cos(ang);
          im -= sig[x] * Math.sin(ang);
        }
        const pw = re * re + im * im;
        power[k] = pw;
        if (pw > pPeak) {
          pPeak = pw;
          kPeak = k;
        }
      }

      // Parabolic refinement on log-power when peak is interior
      let kEst = kPeak;
      if (kPeak > 1 && kPeak < kMax && power[kPeak - 1] > 0 && power[kPeak + 1] > 0) {
        const a = Math.log(power[kPeak - 1]);
        const b = Math.log(power[kPeak]);
        const c = Math.log(power[kPeak + 1]);
        const denom = a - 2 * b + c;
        if (Math.abs(denom) > 1e-12) {
          const delta = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom));
          kEst = kPeak + delta;
        }
      }

      // Count upward zero-crossings as cross-check / fallback
      let crossings = 0;
      for (let x = 0; x < nx; x++) {
        const next = (x + 1) % nx;
        if (sig[x] <= 0 && sig[next] > 0) crossings++;
      }

      if (pPeak > 1e-6 && kEst >= 0.5) {
        lambdaCells = (nx / kEst) * dx;
        pairs = Math.max(1, Math.round(kEst));
      } else if (crossings >= 1) {
        lambdaCells = (nx / crossings) * dx;
        pairs = crossings;
      }
    }
  }

  return {
    frontY,
    lambdaCells,
    pairs,
    fAlpha,
    fBeta,
    fLiquid: sumL / total,
    meanC: sumC / total,
    maxSimplexErr,
    valid,
  };
}

export interface CpuFolchPlappConfig {
  dx: number;
  dt: number;
  W: number;
  tau: number;
  lambdaCoup: number;
  dLiq: number;
  gradG: number;
  yE: number;
  c0Off: number;
  /** When false (default in CPU step for CI conservation gate), top row is zero-flux Neumann. */
  topDirichlet: boolean;
}

export const CPU_FP_DEFAULTS: CpuFolchPlappConfig = {
  dx: FP_SIM.dx,
  dt: FP_SIM.dt,
  W: FP_SIM.W,
  tau: FP_SIM.tau,
  lambdaCoup: FP_SIM.lambdaCoup,
  dLiq: FP_SIM.dLiq,
  gradG: FP_SIM.gRefSim,
  yE: 32,
  c0Off: 0,
  topDirichlet: false,
};

/**
 * Pure CPU Folch-Plapp (2005) single explicit step on an `nx × ny` RGBA float
 * array `(pA, pB, pL, mu)` — exact discrete twin of the WGSL compute kernel.
 *
 * Periodic in x; zero-flux Neumann at y = 0 (and at y = ny - 1 when
 * `topDirichlet` is false, guaranteeing exact discrete solute conservation
 * sum(mu + gB - gA) = const and simplex sum pA + pB + pL = 1).
 */
export function cpuFolchPlappStep(
  state: Float32Array,
  nx: number,
  ny: number,
  cfg?: Partial<CpuFolchPlappConfig>,
): Float32Array {
  const c: CpuFolchPlappConfig = { ...CPU_FP_DEFAULTS, ...(cfg ?? {}) };
  const out = new Float32Array(state.length);
  const invDx2 = 1 / (c.dx * c.dx);
  const w2 = c.W * c.W;
  const dtOverTau = c.dt / c.tau;

  const idx = (x: number, y: number) => (y * nx + x) * 4;

  for (let y = 0; y < ny; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y + 1 < ny ? y + 1 : ny - 1;
    const theta = c.gradG * (y - c.yE);

    for (let x = 0; x < nx; x++) {
      const xm = x > 0 ? x - 1 : nx - 1;
      const xp = x + 1 < nx ? x + 1 : 0;
      const o = idx(x, y);

      if (c.topDirichlet && y >= ny - 2) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 1;
        out[o + 3] = c.c0Off;
        continue;
      }

      const pA = state[o];
      const pB = state[o + 1];
      const pL = state[o + 2];
      const mu = state[o + 3];

      const oW = idx(xm, y);
      const oE = idx(xp, y);
      const oS = idx(x, ym);
      const oN = idx(x, yp);
      const oSW = idx(xm, ym);
      const oSE = idx(xp, ym);
      const oNW = idx(xm, yp);
      const oNE = idx(xp, yp);

      // Isotropic 9-point Laplacian for phase fields (reduces lattice anisotropy)
      const lapA =
        (4 * (state[oW] + state[oE] + state[oS] + state[oN]) +
          (state[oSW] + state[oSE] + state[oNW] + state[oNE]) -
          20 * pA) *
        (invDx2 / 6);
      const lapB =
        (4 * (state[oW + 1] + state[oE + 1] + state[oS + 1] + state[oN + 1]) +
          (state[oSW + 1] + state[oSE + 1] + state[oNW + 1] + state[oNE + 1]) -
          20 * pB) *
        (invDx2 / 6);
      const lapL =
        (4 * (state[oW + 2] + state[oE + 2] + state[oS + 2] + state[oN + 2]) +
          (state[oSW + 2] + state[oSE + 2] + state[oNW + 2] + state[oNE + 2]) -
          20 * pL) *
        (invDx2 / 6);

      // Triple-well derivative d/dp_i [ p_i^2 (1 - p_i)^2 ]
      const dwA = 2 * pA * (1 - pA) * (1 - 2 * pA);
      const dwB = 2 * pB * (1 - pB) * (1 - 2 * pB);
      const dwL = 2 * pL * (1 - pL) * (1 - 2 * pL);

      // Bulk grand-potential derivative: omega_bulk = lambda * (mu*gA - mu*gB - theta*gL)
      const [gAa, gAb, gAl] = fpTiltGrad(pA, pB, pL);
      const [gBb, gBl, gBa] = fpTiltGrad(pB, pL, pA);
      const [gLl, gLa, gLb] = fpTiltGrad(pL, pA, pB);

      const dOmA = c.lambdaCoup * (mu * gAa - mu * gBa - theta * gLa);
      const dOmB = c.lambdaCoup * (mu * gAb - mu * gBb - theta * gLb);
      const dOmL = c.lambdaCoup * (mu * gAl - mu * gBl - theta * gLl);

      const psiA = w2 * lapA - dwA - dOmA;
      const psiB = w2 * lapB - dwB - dOmB;
      const psiL = w2 * lapL - dwL - dOmL;
      const avg = (psiA + psiB + psiL) / 3;

      let pA1 = pA + dtOverTau * (psiA - avg);
      let pB1 = pB + dtOverTau * (psiB - avg);
      let pL1 = pL + dtOverTau * (psiL - avg);

      // Simplex safeguard: clamp tiny rounding overshoot and renormalize to sum === 1
      if (pA1 < 0) pA1 = 0;
      if (pB1 < 0) pB1 = 0;
      if (pL1 < 0) pL1 = 0;
      const pSum = pA1 + pB1 + pL1;
      if (pSum > 1e-12) {
        pA1 /= pSum;
        pB1 /= pSum;
        pL1 /= pSum;
      } else {
        pA1 = 0;
        pB1 = 0;
        pL1 = 1;
      }

      // Conservative 5-point face-flux solute diffusion: dc/dt = div(D * pL * grad(mu))
      const mE = 0.5 * c.dLiq * (pL + state[oE + 2]);
      const mW = 0.5 * c.dLiq * (pL + state[oW + 2]);
      const mN = y + 1 < ny ? 0.5 * c.dLiq * (pL + state[oN + 2]) : 0;
      const mS = y > 0 ? 0.5 * c.dLiq * (pL + state[oS + 2]) : 0;

      const divFlux =
        (mE * (state[oE + 3] - mu) -
          mW * (mu - state[oW + 3]) +
          mN * (state[oN + 3] - mu) -
          mS * (mu - state[oS + 3])) *
        invDx2;

      const cOld = mu + fpTilt(pB, pL, pA) - fpTilt(pA, pB, pL);
      const cNew = cOld + c.dt * divFlux;
      const mu1 = cNew - (fpTilt(pB1, pL1, pA1) - fpTilt(pA1, pB1, pL1));

      out[o] = pA1;
      out[o + 1] = pB1;
      out[o + 2] = pL1;
      out[o + 3] = mu1;
    }
  }

  return out;
}

/** Build a clean initial alternating alpha/beta lamellar seed slab for both CPU and GPU. */
export function buildInitialEutecticField(
  nx: number,
  ny: number,
  seedPairs: number,
  c0Off: number,
  frontFrac = 0.44,
): Float32Array {
  const data = new Float32Array(nx * ny * 4);
  const pairs = Math.max(2, Math.min(16, Math.round(seedPairs)));
  const off = Number.isFinite(c0Off) ? Math.max(-0.25, Math.min(0.25, c0Off)) : 0;
  const fAlpha0 = Math.max(0.15, Math.min(0.85, (1 - off) * 0.5));
  const yFront = Math.max(8, Math.min(ny - 20, Math.round(ny * frontFrac)));
  const period = nx / pairs;
  const wInv = 1 / (Math.SQRT2 * FP_SIM.W);

  for (let y = 0; y < ny; y++) {
    // Smooth solid-liquid transition at yFront (with tiny sinusoidal ripple to break symmetry cleanly)
    for (let x = 0; x < nx; x++) {
      const ripple = 0.6 * Math.cos((2 * Math.PI * pairs * x) / nx);
      const solid = 0.5 * (1 - Math.tanh((y - (yFront + ripple)) * wInv));
      const pL = 1 - solid;

      // Smooth alternating alpha / beta lamellae across each period, honoring lever fraction
      const phase = ((x % period) + period) % period;
      const frac = phase / period;
      const d1 = Math.min(Math.abs(frac), Math.abs(frac - 1)) * period;
      const d2 = Math.abs(frac - fAlpha0) * period;
      const insideA = frac < fAlpha0;
      const signedDist = (insideA ? 1 : -1) * Math.min(d1, d2);
      const alphaShare = 0.5 * (1 + Math.tanh(signedDist * wInv));

      let pA = solid * alphaShare;
      let pB = solid * (1 - alphaShare);
      const sum = pA + pB + pL;
      pA /= sum;
      pB /= sum;
      const pLn = pL / sum;

      // Initialize mu smoothly at off-eutectic liquid far-field c0Off
      const i = (y * nx + x) * 4;
      data[i] = pA;
      data[i + 1] = pB;
      data[i + 2] = pLn;
      data[i + 3] = off;
    }
  }
  return data;
}

// ------------------------------------------------ WGSL compute & render code

const EUTECTIC_STEP_WGSL = /* wgsl */ `
struct EutParams {
  nx: u32,
  ny: u32,
  shiftRows: u32,
  pad0: u32,
  dx: f32,
  dt: f32,
  w2: f32,
  dtOverTau: f32,
  lambdaCoup: f32,
  dLiq: f32,
  gradG: f32,
  yE: f32,
  c0Off: f32,
  pad1: f32,
  pad2: f32,
  pad3: f32,
};

@group(0) @binding(0) var<uniform> P: EutParams;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var dstTex: texture_storage_2d<rgba32float, write>;

fn fpTilt(pi: f32, pj: f32, pk: f32) -> f32 {
  let diff = pk - pj;
  return 0.25 * pi * pi * (15.0 * (1.0 - pi) * (1.0 + pi - diff * diff) + pi * (9.0 * pi * pi - 5.0));
}

fn fpTiltGrad(pi: f32, pj: f32, pk: f32) -> vec3<f32> {
  let diff = pk - pj;
  let om = 1.0 - pi;
  let dSelf = 3.75 * pi * (om * om * (2.0 + 3.0 * pi) - (2.0 - 3.0 * pi) * diff * diff);
  let cross = 7.5 * pi * pi * om * diff;
  return vec3<f32>(dSelf, cross, -cross);
}

fn loadCell(x: i32, y: i32) -> vec4<f32> {
  let nx = i32(P.nx);
  let ny = i32(P.ny);
  let wx = ((x % nx) + nx) % nx;
  let cy = clamp(y, 0, ny - 1);
  return textureLoad(srcTex, vec2<i32>(wx, cy), 0);
}

@compute @workgroup_size(16, 16)
fn stepMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let ny = i32(P.ny);

  // Far-field liquid Dirichlet top boundary (mu = c0Off)
  if (y >= ny - 2) {
    textureStore(dstTex, vec2<i32>(x, y), vec4<f32>(0.0, 0.0, 1.0, P.c0Off));
    return;
  }

  let sC  = loadCell(x, y);
  let sW  = loadCell(x - 1, y);
  let sE  = loadCell(x + 1, y);
  let sS  = loadCell(x, y - 1);
  let sN  = loadCell(x, y + 1);
  let sSW = loadCell(x - 1, y - 1);
  let sSE = loadCell(x + 1, y - 1);
  let sNW = loadCell(x - 1, y + 1);
  let sNE = loadCell(x + 1, y + 1);

  let pA = sC.x;
  let pB = sC.y;
  let pL = sC.z;
  let mu = sC.w;

  let invDx2 = 1.0 / (P.dx * P.dx);
  let lap = (4.0 * (sW.xyz + sE.xyz + sS.xyz + sN.xyz) + (sSW.xyz + sSE.xyz + sNW.xyz + sNE.xyz) - 20.0 * sC.xyz) * (invDx2 / 6.0);

  let dw = 2.0 * sC.xyz * (1.0 - sC.xyz) * (1.0 - 2.0 * sC.xyz);
  let theta = P.gradG * (f32(y) - P.yE);

  let gA = fpTiltGrad(pA, pB, pL); // (dA, dB, dL)
  let gB = fpTiltGrad(pB, pL, pA); // (dB, dL, dA)
  let gL = fpTiltGrad(pL, pA, pB); // (dL, dA, dB)

  let dOmA = P.lambdaCoup * (mu * gA.x - mu * gB.z - theta * gL.y);
  let dOmB = P.lambdaCoup * (mu * gA.y - mu * gB.x - theta * gL.z);
  let dOmL = P.lambdaCoup * (mu * gA.z - mu * gB.y - theta * gL.x);

  let psi = P.w2 * lap - dw - vec3<f32>(dOmA, dOmB, dOmL);
  let avg = (psi.x + psi.y + psi.z) / 3.0;

  var p1 = max(vec3<f32>(0.0), sC.xyz + P.dtOverTau * (psi - vec3<f32>(avg)));
  let pSum = p1.x + p1.y + p1.z;
  if (pSum > 1e-12) {
    p1 = p1 / pSum;
  } else {
    p1 = vec3<f32>(0.0, 0.0, 1.0);
  }

  // Conservative 5-point face-flux solute diffusion (zero-flux at y = 0)
  let mE = 0.5 * P.dLiq * (pL + sE.z);
  let mW = 0.5 * P.dLiq * (pL + sW.z);
  let mN = 0.5 * P.dLiq * (pL + sN.z);
  let mS = select(0.0, 0.5 * P.dLiq * (pL + sS.z), y > 0);

  let divFlux = (
    mE * (sE.w - mu) - mW * (mu - sW.w) +
    mN * (sN.w - mu) - mS * (mu - sS.w)
  ) * invDx2;

  let cOld = mu + fpTilt(pB, pL, pA) - fpTilt(pA, pB, pL);
  let cNew = cOld + P.dt * divFlux;
  let mu1 = cNew - (fpTilt(p1.y, p1.z, p1.x) - fpTilt(p1.x, p1.y, p1.z));

  textureStore(dstTex, vec2<i32>(x, y), vec4<f32>(p1, mu1));
}

@compute @workgroup_size(16, 16)
fn shiftMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let srcY = y + i32(P.shiftRows);
  var val = vec4<f32>(0.0, 0.0, 1.0, P.c0Off);
  if (srcY < i32(P.ny)) {
    val = textureLoad(srcTex, vec2<i32>(x, srcY), 0);
  }
  textureStore(dstTex, vec2<i32>(x, y), val);
}
`;

const EUTECTIC_RENDER_WGSL = /* wgsl */ `
struct RenderU {
  lens: u32,
  nx: u32,
  ny: u32,
  pad0: u32,
  width: f32,
  height: f32,
  c0Off: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> R: RenderU;
@group(0) @binding(1) var stateTex: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vmain(@builtin(vertex_index) vi: u32) -> VSOut {
  var pts = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out: VSOut;
  let p = pts[vi];
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv = 0.5 * p + vec2<f32>(0.5, 0.5);
  return out;
}

fn fpTilt(pi: f32, pj: f32, pk: f32) -> f32 {
  let diff = pk - pj;
  return 0.25 * pi * pi * (15.0 * (1.0 - pi) * (1.0 + pi - diff * diff) + pi * (9.0 * pi * pi - 5.0));
}

fn sampleBilinear(gx: f32, gy: f32) -> vec4<f32> {
  let nx = i32(R.nx);
  let ny = i32(R.ny);
  let x0 = i32(floor(gx));
  let y0 = i32(floor(gy));
  let fx = gx - f32(x0);
  let fy = gy - f32(y0);
  let wx0 = ((x0 % nx) + nx) % nx;
  let wx1 = (wx0 + 1) % nx;
  let cy0 = clamp(y0, 0, ny - 1);
  let cy1 = clamp(y0 + 1, 0, ny - 1);

  let v00 = textureLoad(stateTex, vec2<i32>(wx0, cy0), 0);
  let v10 = textureLoad(stateTex, vec2<i32>(wx1, cy0), 0);
  let v01 = textureLoad(stateTex, vec2<i32>(wx0, cy1), 0);
  let v11 = textureLoad(stateTex, vec2<i32>(wx1, cy1), 0);
  return mix(mix(v00, v10, fx), mix(v01, v11, fx), fy);
}

@fragment
fn fmain(in: VSOut) -> @location(0) vec4<f32> {
  // Cover-fit centered on y = 0.52 so the growing lamellar front stays centered on all viewports
  let scale = max(R.width, R.height);
  let px = in.uv.x * R.width;
  let py = in.uv.y * R.height;
  let offX = (R.width - scale) * 0.5;
  let offY = (R.height - scale) * 0.5;
  let u = (px - offX) / scale;
  let v = (py - offY) / scale;

  let gx = u * f32(R.nx) - 0.5;
  let gy = v * f32(R.ny) - 0.5;
  let s = sampleBilinear(gx, gy);

  let pA = clamp(s.x, 0.0, 1.0);
  let pB = clamp(s.y, 0.0, 1.0);
  let pL = clamp(s.z, 0.0, 1.0);
  let mu = s.w;

  let ifaceSL = clamp(4.0 * pL * (pA + pB), 0.0, 1.0);
  let ifaceAB = clamp(4.0 * pA * pB, 0.0, 1.0);
  let triple  = clamp(27.0 * pA * pB * pL, 0.0, 1.0);

  var col = vec3<f32>(0.05, 0.06, 0.08);

  if (R.lens == 0u) {
    // Phases: warm metallic ivory-gold alpha, cool steel-blue beta, deep dark melt
    let cA = vec3<f32>(0.84, 0.78, 0.64);
    let cB = vec3<f32>(0.27, 0.45, 0.66);
    let cL = vec3<f32>(0.05, 0.06, 0.08);
    // Subtle solute glow in the melt ahead of the tips
    let meltTint = clamp(mu - R.c0Off, -0.35, 0.35);
    let cLMelt = cL + vec3<f32>(0.04, 0.06, 0.09) * max(0.0, meltTint * 2.5)
                    + vec3<f32>(0.08, 0.06, 0.02) * max(0.0, -meltTint * 2.5);
    col = pA * cA + pB * cB + pL * cLMelt;
    // Crisp solid-liquid interface & alpha/beta grain boundary contours
    col = mix(col, vec3<f32>(0.96, 0.96, 0.97), 0.36 * ifaceSL);
    col = mix(col, vec3<f32>(0.10, 0.11, 0.14), 0.42 * ifaceAB);
    col = mix(col, vec3<f32>(1.0, 0.95, 0.80), 0.50 * triple);
  } else if (R.lens == 1u) {
    // Solute: diverging c = mu + gB - gA with boosted liquid diffusion boundary-layer contrast
    let comp = mu + fpTilt(pB, pL, pA) - fpTilt(pA, pB, pL);
    let solidW = pA + pB;
    let tSolid = clamp(comp, -1.0, 1.0);
    let tLiq = clamp((comp - R.c0Off) * 3.8, -1.0, 1.0);
    let t = mix(tLiq, tSolid, solidW);

    let lo = vec3<f32>(0.18, 0.42, 0.76);
    let mid = vec3<f32>(0.14, 0.15, 0.17);
    let hi = vec3<f32>(0.86, 0.48, 0.22);
    col = select(mix(mid, hi, t), mix(mid, lo, -t), t < 0.0);
    // Crisp white contour marking the solid-liquid front
    col = mix(col, vec3<f32>(0.95, 0.96, 0.98), 0.65 * ifaceSL);
  } else {
    // Etch: bright-field optical pearlite/lamellar metallography grayscale
    let cA = vec3<f32>(0.84, 0.83, 0.80);
    let cB = vec3<f32>(0.24, 0.25, 0.27);
    let cL = vec3<f32>(0.10, 0.10, 0.11);
    col = pA * cA + pB * cB + pL * cL;
    col = mix(col, vec3<f32>(0.06, 0.06, 0.07), 0.68 * ifaceAB);
    col = mix(col, vec3<f32>(0.92, 0.92, 0.92), 0.25 * ifaceSL);
  }

  return vec4<f32>(col, 1.0);
}
`;

// ------------------------------------------------ WebGPU simulation class

export class EutecticSim {
  readonly device: GPUDevice;
  readonly n: number;
  params: EutecticParams;

  private tex: [GPUTexture, GPUTexture];
  private dir = 0;
  private ubuf: GPUBuffer;
  private udata = new ArrayBuffer(64);
  private stepPipe: GPUComputePipeline;
  private shiftPipe: GPUComputePipeline;
  private stepBG: [GPUBindGroup, GPUBindGroup];
  private shiftBG: [GPUBindGroup, GPUBindGroup];
  private readBuf: GPUBuffer;
  private readBytesPerRow: number;
  private reading = false;
  private disposed = false;

  private stepCount = 0;
  private simTime = 0;
  private shifts = 0;
  private yE = 0;
  private lastFrontY = 0;
  private lastStats: EutecticStats | null = null;

  constructor(device: GPUDevice, params?: Partial<EutecticParams>) {
    this.device = device;
    this.params = { ...EUTECTIC_DEFAULTS, ...(params ?? {}) };
    this.n = Math.max(64, Math.min(512, Math.round(this.params.n)));
    this.params.n = this.n;

    const usage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST;
    this.tex = [
      device.createTexture({ size: [this.n, this.n], format: "rgba32float", usage }),
      device.createTexture({ size: [this.n, this.n], format: "rgba32float", usage }),
    ];

    this.ubuf = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const mod = device.createShaderModule({ code: EUTECTIC_STEP_WGSL });
    this.stepPipe = device.createComputePipeline({
      layout: "auto",
      compute: { module: mod, entryPoint: "stepMain" },
    });
    this.shiftPipe = device.createComputePipeline({
      layout: "auto",
      compute: { module: mod, entryPoint: "shiftMain" },
    });

    const makeBG = (pipe: GPUComputePipeline, src: number, dst: number) =>
      device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubuf } },
          { binding: 1, resource: this.tex[src].createView() },
          { binding: 2, resource: this.tex[dst].createView() },
        ],
      });

    this.stepBG = [makeBG(this.stepPipe, 0, 1), makeBG(this.stepPipe, 1, 0)];
    this.shiftBG = [makeBG(this.shiftPipe, 0, 1), makeBG(this.shiftPipe, 1, 0)];

    // Row pitch for rgba32float (16 bytes/texel) must be multiple of 256 bytes
    this.readBytesPerRow = Math.ceil((this.n * 16) / 256) * 256;
    this.readBuf = device.createBuffer({
      size: this.readBytesPerRow * this.n,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.reset(this.params);
  }

  get stateTex(): GPUTexture {
    return this.tex[this.dir];
  }

  /** Internal helper for EutecticRenderer bind-group caching. */
  stateTexAt(idx: 0 | 1): GPUTexture {
    return this.tex[idx];
  }

  get currentDir(): 0 | 1 {
    return this.dir as 0 | 1;
  }

  setParams(patch: Partial<EutecticParams>): void {
    const next: EutecticParams = { ...this.params, ...patch, n: this.n };
    next.c0Off = Math.max(-0.25, Math.min(0.25, Number.isFinite(next.c0Off) ? next.c0Off : 0));
    next.pullV = Math.max(1, Math.min(200, Number.isFinite(next.pullV) ? next.pullV : EUTECTIC_DEFAULTS.pullV));
    next.gradG = Math.max(0.5, Math.min(100, Number.isFinite(next.gradG) ? next.gradG : EUTECTIC_DEFAULTS.gradG));
    next.seedPairs = Math.max(2, Math.min(16, Math.round(Number.isFinite(next.seedPairs) ? next.seedPairs : 6)));
    this.params = next;
  }

  reset(params?: Partial<EutecticParams>): void {
    if (this.disposed) return;
    if (params) this.setParams(params);
    const frontFrac = 0.48;
    const init = buildInitialEutecticField(this.n, this.n, this.params.seedPairs, this.params.c0Off, frontFrac);
    this.device.queue.writeTexture(
      { texture: this.tex[0] },
      init.buffer,
      { bytesPerRow: this.n * 16, rowsPerImage: this.n },
      [this.n, this.n],
    );
    this.device.queue.writeTexture(
      { texture: this.tex[1] },
      init.buffer,
      { bytesPerRow: this.n * 16, rowsPerImage: this.n },
      [this.n, this.n],
    );
    this.dir = 0;
    this.stepCount = 0;
    this.simTime = 0;
    this.shifts = 0;
    const yFront0 = Math.round(this.n * frontFrac);
    this.lastFrontY = yFront0;
    // Place the eutectic isotherm ahead of the initial front by the JH operating lag
    const jh = jacksonHuntModel(this.params.alloy, this.params.pullV, this.params.c0Off);
    const lam0 = this.n / Math.max(2, this.params.seedPairs);
    const gSim = gradGToSim(this.params.gradG);
    const dT0 = Math.min(0.32, Math.max(jh.dTMinSim, jh.dTSim(lam0)));
    this.yE = yFront0 + dT0 / Math.max(1e-4, gSim);
    this.lastStats = null;
  }

  private writeUniforms(shiftRows: number): void {
    const u = new Uint32Array(this.udata);
    const f = new Float32Array(this.udata);
    u[0] = this.n;
    u[1] = this.n;
    u[2] = shiftRows;
    u[3] = 0;
    f[4] = FP_SIM.dx;
    f[5] = FP_SIM.dt;
    f[6] = FP_SIM.W * FP_SIM.W;
    f[7] = FP_SIM.dt / FP_SIM.tau;
    f[8] = FP_SIM.lambdaCoup;
    f[9] = FP_SIM.dLiq;
    f[10] = gradGToSim(this.params.gradG);
    f[11] = this.yE;
    f[12] = this.params.c0Off;
    f[13] = 0;
    f[14] = 0;
    f[15] = 0;
    this.device.queue.writeBuffer(this.ubuf, 0, this.udata);
  }

  step(substeps = 48): void {
    if (this.disposed) return;
    const count = Math.max(1, Math.min(512, Math.round(substeps)));
    const wg = Math.ceil(this.n / 16);
    const vSim = pullVToSim(this.params.pullV);
    const gSim = gradGToSim(this.params.gradG);
    const jh = jacksonHuntModel(this.params.alloy, this.params.pullV, this.params.c0Off);
    const expectedLag = Math.min(0.24 * this.n, Math.max(4, jh.dTMinSim / Math.max(1e-4, gSim)));

    // Keep solid-liquid front centered near 0.55 * n in the moving frame
    const estFrontY = Math.max(this.lastFrontY, this.yE - expectedLag);
    const shiftTrigger = 0.55 * this.n;
    const shiftRows = estFrontY > shiftTrigger ? Math.min(16, Math.max(2, Math.floor(estFrontY - shiftTrigger) + 2)) : 0;

    if (shiftRows > 0) {
      this.writeUniforms(shiftRows);
      const encShift = this.device.createCommandEncoder();
      const pass = encShift.beginComputePass();
      pass.setPipeline(this.shiftPipe);
      pass.setBindGroup(0, this.shiftBG[this.dir]);
      pass.dispatchWorkgroups(wg, wg);
      pass.end();
      this.device.queue.submit([encShift.finish()]);
      this.dir = 1 - this.dir;
      this.yE -= shiftRows;
      this.lastFrontY = Math.max(0, this.lastFrontY - shiftRows);
      this.shifts += shiftRows;
    }

    // Advance eutectic isotherm by the midpoint of the batch (tiny error < 0.05 cells)
    const batchDt = count * FP_SIM.dt;
    this.yE += 0.5 * vSim * batchDt;
    this.writeUniforms(0);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.stepPipe);
    for (let s = 0; s < count; s++) {
      pass.setBindGroup(0, this.stepBG[this.dir]);
      pass.dispatchWorkgroups(wg, wg);
      this.dir = 1 - this.dir;
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);

    this.yE += 0.5 * vSim * batchDt;
    this.stepCount += count;
    this.simTime += batchDt;
  }

  async readDiagnostics(): Promise<EutecticStats> {
    if (this.disposed) {
      return this.lastStats ?? this.emptyStats();
    }
    if (this.reading) {
      return this.lastStats ?? this.emptyStats();
    }
    this.reading = true;
    try {
      const enc = this.device.createCommandEncoder();
      enc.copyTextureToBuffer(
        { texture: this.tex[this.dir] },
        { buffer: this.readBuf, bytesPerRow: this.readBytesPerRow, rowsPerImage: this.n },
        [this.n, this.n],
      );
      this.device.queue.submit([enc.finish()]);
      await this.readBuf.mapAsync(GPUMapMode.READ);
      const mapped = this.readBuf.getMappedRange();
      const dense = new Float32Array(this.n * this.n * 4);
      const floatsPerRow = this.readBytesPerRow / 4;
      const src = new Float32Array(mapped);
      for (let y = 0; y < this.n; y++) {
        dense.set(src.subarray(y * floatsPerRow, y * floatsPerRow + this.n * 4), y * this.n * 4);
      }
      this.readBuf.unmap();

      const m = measureLamellae(dense, this.n, this.n, FP_SIM.dx, 12);
      this.lastFrontY = m.frontY;
      const gSim = gradGToSim(this.params.gradG);
      const dTFrontSim = Math.max(0, gSim * (this.yE - m.frontY));
      const { umPerCell, kelvinPerSimT } = eutecticScales(this.params.alloy, this.params.c0Off);
      const lambdaUm = m.lambdaCells != null ? m.lambdaCells * umPerCell : null;
      const dTFrontK = dTFrontSim * kelvinPerSimT;
      const vForProduct = this.params.alloy === "symmetric" ? pullVToSim(this.params.pullV) : this.params.pullV;
      const lambda2VUm3s = lambdaUm != null ? lambdaUm * lambdaUm * vForProduct : null;

      const stats: EutecticStats = {
        step: this.stepCount,
        simTime: this.simTime,
        frontY: m.frontY,
        shifts: this.shifts,
        lambdaCells: m.lambdaCells,
        lambdaUm,
        pairs: m.pairs,
        fAlpha: m.fAlpha,
        fBeta: m.fBeta,
        fLiquid: m.fLiquid,
        dTFrontSim,
        dTFrontK,
        lambda2VUm3s,
        meanC: m.meanC,
        maxSimplexErr: m.maxSimplexErr,
        valid: m.valid,
      };
      this.lastStats = stats;
      return stats;
    } finally {
      this.reading = false;
    }
  }

  private emptyStats(): EutecticStats {
    return {
      step: this.stepCount,
      simTime: this.simTime,
      frontY: this.lastFrontY,
      shifts: this.shifts,
      lambdaCells: null,
      lambdaUm: null,
      pairs: 0,
      fAlpha: 0.5,
      fBeta: 0.5,
      fLiquid: 1,
      dTFrontSim: 0,
      dTFrontK: 0,
      lambda2VUm3s: null,
      meanC: this.params.c0Off,
      maxSimplexErr: 0,
      valid: true,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tex[0].destroy();
    this.tex[1].destroy();
    this.ubuf.destroy();
    this.readBuf.destroy();
  }
}

// ------------------------------------------------ WebGPU full-canvas renderer

export class EutecticRenderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private pipe: GPURenderPipeline;
  private rbuf: GPUBuffer;
  private rdata = new ArrayBuffer(32);
  private bg: [GPUBindGroup, GPUBindGroup];
  private disposed = false;

  lens: EutecticLens = 0;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, sim: EutecticSim) {
    this.device = device;
    this.canvas = canvas;
    this.ctx = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format, alphaMode: "opaque" });

    const mod = device.createShaderModule({ code: EUTECTIC_RENDER_WGSL });
    this.pipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: mod, entryPoint: "vmain" },
      fragment: { module: mod, entryPoint: "fmain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.rbuf = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bg = this.makeBindGroups(sim);
    this.lens = sim.params.lens;
  }

  private makeBindGroups(sim: EutecticSim): [GPUBindGroup, GPUBindGroup] {
    const mk = (dir: 0 | 1) =>
      this.device.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.rbuf } },
          { binding: 1, resource: sim.stateTexAt(dir).createView() },
        ],
      });
    return [mk(0), mk(1)];
  }

  rebind(sim: EutecticSim): void {
    if (this.disposed) return;
    this.bg = this.makeBindGroups(sim);
  }

  render(sim: EutecticSim): void {
    if (this.disposed) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const u = new Uint32Array(this.rdata);
    const f = new Float32Array(this.rdata);
    u[0] = this.lens;
    u[1] = sim.n;
    u[2] = sim.n;
    u[3] = 0;
    f[4] = this.canvas.width;
    f[5] = this.canvas.height;
    f[6] = sim.params.c0Off;
    f[7] = 0;
    this.device.queue.writeBuffer(this.rbuf, 0, this.rdata);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0.05, g: 0.06, b: 0.08, a: 1 },
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bg[sim.currentDir]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rbuf.destroy();
  }
}

/** Convenience Bridge constructor for pure figure/CSV builders (zero DOM). */
export function eutecticPlotBridge(alloy: EutecticAlloy): Bridge {
  const units = new Units(
    scaleOf({
      si: null,
      n: 256,
      dx: 1,
      latent: 1,
      dSol: 1,
      alloy: false,
      umPerCell: 1,
    }),
    null,
  );
  return bridgeOf(units, alloy.label);
}
