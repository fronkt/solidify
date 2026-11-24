/**
 * 2D / 3D CAHN–HILLIARD SPINODAL DECOMPOSITION SOLVER & NIST PFHUB BENCHMARK 1
 *
 * Pure CPU physics, exact analytical dispersion & stability formulas, NIST PFHub
 * Benchmark 1a (2D) & 1c (3D) initial conditions, free-energy / domain-length
 * diagnostics, and LSW coarsening fit (zero DOM/WebGPU runtime imports at load)
 * plus WebGPU 2D/3D compute (`SpinodalSim`) and raymarched 3D / 2D renderer
 * (`SpinodalRenderer`).
 *
 * Governing equation (Cahn & Hilliard 1958; Jokisaari et al. 2017):
 *   dc/dt = div( M * grad(mu) ),    mu = f'(c) - kappa * lap(c)
 *   f(c)  = rho_s * (c - c_alpha)^2 * (c_beta - c)^2
 *   f'(c) = 2 * rho_s * (c - c_alpha) * (c_beta - c) * (c_alpha + c_beta - 2*c)
 *   f''(c)= 2 * rho_s * [ (c_alpha + c_beta - 2*c)^2 - 2*(c - c_alpha)*(c_beta - c) ]
 *
 * Discretization:
 *   - 2D: periodic 9-point Mehrstellen Laplacian (4*cardinal + diag - 20*center)/(6*dx^2)
 *     for both mu and dc/dt -> exact discrete zero sum (mass conservation),
 *     rotational isotropy, and 2.25x larger biharmonic explicit CFL (lambda_max = 16/(3*dx^2)).
 *   - 3D: periodic 19-point isotropic Laplacian (2*face + edge - 24*center)/(6*dx^2)
 *     in r32float storage buffers -> exact discrete zero sum, isotropic 3D bicontinuous
 *     morphology, and 5.06x larger biharmonic CFL than 7-point (lambda_max = 16/(3*dx^2)).
 *
 * Honest scope note:
 *   Explicit periodic Cahn–Hilliard model with isotropic gradient energy kappa;
 *   elastic coherency strain and thermal fluctuations are omitted.
 */

import { Units, scaleOf } from "./units";
import { bridgeOf, type Bridge } from "./plot/quantity";

export type SpinodalPresetId = "pfhub1" | "fecr" | "alzn" | "offcrit";
export type SpinodalDim = "2d" | "3d";
export type SpinodalLens = 0 | 1 | 2;

export interface SpinodalPreset {
  id: SpinodalPresetId;
  label: string;
  cAlpha: number;
  cBeta: number;
  rhoS: number;
  kappa: number;
  mobility: number;
  c0: number;
  eps: number;
  domain2d: number;
  domain3d: number;
  deterministic: boolean;
  note: string;
  citation: string;
}

export const SPINODAL_PRESETS: Record<SpinodalPresetId, SpinodalPreset> = {
  pfhub1: {
    id: "pfhub1",
    label: "NIST PFHub B1",
    cAlpha: 0.3,
    cBeta: 0.7,
    rhoS: 5.0,
    kappa: 2.0,
    mobility: 5.0,
    c0: 0.5,
    eps: 0.01,
    domain2d: 200,
    domain3d: 100,
    deterministic: true,
    note: "Exact NIST PFHub Benchmark 1a (200² on [0, 200]²) and 1c (64³ on [0, 100]³) deterministic cosine initial condition.",
    citation: "Jokisaari et al., Comput. Mater. Sci. 126 (2017) 139–151",
  },
  fecr: {
    id: "fecr",
    label: "Fe–Cr (475 °C)",
    cAlpha: 0.18,
    cBeta: 0.82,
    rhoS: 3.5,
    kappa: 1.8,
    mobility: 6.0,
    c0: 0.5,
    eps: 0.025,
    domain2d: 200,
    domain3d: 100,
    deterministic: false,
    note: "Ferritic stainless steel miscibility gap (Fe-rich α + Cr-rich α') showing bicontinuous spinodal coarsening.",
    citation: "Cahn & Hilliard (1958); Lifshitz & Slyozov (1961); Xiong et al. (2011)",
  },
  alzn: {
    id: "alzn",
    label: "Al–Zn",
    cAlpha: 0.22,
    cBeta: 0.78,
    rhoS: 4.2,
    kappa: 1.5,
    mobility: 7.0,
    c0: 0.46,
    eps: 0.025,
    domain2d: 200,
    domain3d: 100,
    deterministic: false,
    note: "Rapidly coarsening Al–Zn spinodal decomposition near the coherent miscibility gap.",
    citation: "Cahn (1961), Acta Metall. 9:795–801; Rundman & Hilliard (1967)",
  },
  offcrit: {
    id: "offcrit",
    label: "Off-critical droplets",
    cAlpha: 0.3,
    cBeta: 0.7,
    rhoS: 5.0,
    kappa: 2.0,
    mobility: 5.0,
    c0: 0.42,
    eps: 0.02,
    domain2d: 200,
    domain3d: 100,
    deterministic: false,
    note: "Asymmetric composition inside the spinodal (30 % minority phase) breaking into isolated droplets that coarsen via Ostwald ripening.",
    citation: "Lifshitz & Slyozov (1961), J. Phys. Chem. Solids 19:35–50",
  },
};

export interface SpinodalParams {
  preset: SpinodalPresetId;
  dim: SpinodalDim;
  c0: number;
  kappa: number;
  mobility: number;
  n2d: number;
  n3d: number;
  lens: SpinodalLens;
}

export const SPINODAL_DEFAULTS: SpinodalParams = {
  preset: "pfhub1",
  dim: "2d",
  c0: 0.5,
  kappa: 2.0,
  mobility: 5.0,
  n2d: 200,
  n3d: 64,
  lens: 0,
};

export interface SpinodalSample {
  t: number;
  F: number;
  chemF: number;
  gradF: number;
  L: number;
  meanC: number;
  minC: number;
  maxC: number;
}

export interface SpinodalStats {
  dim: SpinodalDim;
  step: number;
  simTime: number;
  freeEnergy: number;
  chemEnergy: number;
  gradEnergy: number;
  meanC: number;
  minC: number;
  maxC: number;
  domainL: number;
  lswSlope: number | null;
  massDrift: number;
  valid: boolean;
}

// ------------------------------------------------ double-well & dispersion

/** Double-well chemical free-energy density f(c) = rho_s * (c - c_alpha)^2 * (c_beta - c)^2. */
export function doubleWellEnergy(
  c: number,
  cAlpha = 0.3,
  cBeta = 0.7,
  rhoS = 5.0,
): number {
  const a = c - cAlpha;
  const b = cBeta - c;
  return rhoS * a * a * b * b;
}

/** First derivative f'(c) = 2 * rho_s * (c - c_alpha) * (c_beta - c) * (c_alpha + c_beta - 2*c). */
export function doubleWellDeriv(
  c: number,
  cAlpha = 0.3,
  cBeta = 0.7,
  rhoS = 5.0,
): number {
  const a = c - cAlpha;
  const b = cBeta - c;
  return 2 * rhoS * a * b * (b - a);
}

/** Second derivative f''(c) = 2 * rho_s * [ (c_alpha + c_beta - 2*c)^2 - 2*(c - c_alpha)*(c_beta - c) ]. */
export function doubleWellSecondDeriv(
  c: number,
  cAlpha = 0.3,
  cBeta = 0.7,
  rhoS = 5.0,
): number {
  const a = c - cAlpha;
  const b = cBeta - c;
  const d = b - a;
  return 2 * rhoS * (d * d - 2 * a * b);
}

/**
 * Cahn–Hilliard linear amplification rate omega(k) = -M * k^2 * (f''(c0) + kappa * k^2).
 * Positive for 0 < k < k_c inside the spinodal (f''(c0) < 0), negative otherwise.
 */
export function cahnHilliardAmplification(
  k: number,
  c0: number,
  cAlpha = 0.3,
  cBeta = 0.7,
  rhoS = 5.0,
  kappa = 2.0,
  mobility = 5.0,
): number {
  const f2 = doubleWellSecondDeriv(c0, cAlpha, cBeta, rhoS);
  const k2 = k * k;
  return -mobility * k2 * (f2 + kappa * k2);
}

/**
 * Fastest-growing wavenumber k_max = sqrt(-f''(c0)/(2*kappa)), cutoff k_c = sqrt(2)*k_max,
 * fastest wavelength lambda_max = 2*pi/k_max, and peak growth rate omega_max.
 */
export function spinodalMaxWave(
  c0: number,
  cAlpha = 0.3,
  cBeta = 0.7,
  rhoS = 5.0,
  kappa = 2.0,
  mobility = 5.0,
): {
  unstable: boolean;
  f2: number;
  kMax: number;
  kCut: number;
  lambdaMax: number;
  omegaMax: number;
} {
  const f2 = doubleWellSecondDeriv(c0, cAlpha, cBeta, rhoS);
  if (!(f2 < 0) || !(kappa > 0) || !(mobility > 0)) {
    return { unstable: false, f2, kMax: 0, kCut: 0, lambdaMax: Infinity, omegaMax: 0 };
  }
  const kCut = Math.sqrt(-f2 / kappa);
  const kMax = kCut / Math.SQRT2;
  const lambdaMax = (2 * Math.PI) / kMax;
  const omegaMax = (mobility * f2 * f2) / (4 * kappa);
  return { unstable: true, f2, kMax, kCut, lambdaMax, omegaMax };
}

/**
 * Explicit forward-Euler biharmonic CFL check for periodic Cahn–Hilliard:
 *   - 2D 9-pt Mehrstellen: lambda_max = 16 / (3 * dx^2)
 *   - 3D 19-pt isotropic:  lambda_max = 16 / (3 * dx^2)
 *   - (optional 5-pt 2D: 8/dx^2; 7-pt 3D: 12/dx^2)
 *   dt_max = 2 / (M * lambda_max * (kappa * lambda_max + max(0, f2Well)))
 */
export function spinodalStability(
  dx: number,
  dt: number,
  kappa: number,
  mobility: number,
  dim: SpinodalDim = "2d",
  f2Well = 1.6,
  isotropic = true,
): {
  stable: boolean;
  cfl: number;
  dtMax: number;
  dtSafe: number;
  lambdaMax: number;
} {
  if (!(dx > 0) || !(dt > 0) || !(kappa > 0) || !(mobility > 0)) {
    return { stable: false, cfl: Infinity, dtMax: 0, dtSafe: 0, lambdaMax: 0 };
  }
  const invDx2 = 1 / (dx * dx);
  const lambdaMax = isotropic
    ? (16 / 3) * invDx2
    : dim === "3d"
      ? 12 * invDx2
      : 8 * invDx2;
  const wellTerm = Number.isFinite(f2Well) && f2Well > 0 ? f2Well : 0;
  const denom = mobility * lambdaMax * (kappa * lambdaMax + wellTerm);
  const dtMax = 2 / denom;
  const dtSafe = 0.55 * dtMax;
  const cfl = dt / dtMax;
  return {
    stable: cfl < 1,
    cfl,
    dtMax,
    dtSafe,
    lambdaMax,
  };
}

/** Choose a safe explicit timestep for the active grid, preset, kappa, and mobility. */
export function chooseSpinodalDt(
  dx: number,
  kappa: number,
  mobility: number,
  dim: SpinodalDim,
  preset: SpinodalPreset,
): number {
  const f2Well = doubleWellSecondDeriv(preset.cAlpha, preset.cAlpha, preset.cBeta, preset.rhoS);
  const st = spinodalStability(dx, 1e-4, kappa, mobility, dim, f2Well, true);
  // Slightly conservative 0.55x of exact well-inclusive biharmonic limit -> strict Lyapunov decay
  return st.dtSafe;
}

// ------------------------------------------------ initial conditions (PFHub 1)

/**
 * Exact NIST PFHub Benchmark 1a deterministic 2D cosine initial condition
 * (Jokisaari et al., Comput. Mater. Sci. 126 (2017) 139–151, Eq. 5):
 *   c(x,y) = c0 + eps * [ cos(0.105 x)cos(0.11 y)
 *                       + (cos(0.13 x)cos(0.087 y))^2
 *                       + cos(0.025 x - 0.15 y)cos(0.07 x - 0.02 y) ]
 */
export function pfhubB1Init2D(
  nx: number,
  ny: number,
  domainL = 200,
  c0 = 0.5,
  eps = 0.01,
): Float32Array {
  const out = new Float32Array(nx * ny);
  const dx = domainL / nx;
  const dy = domainL / ny;
  for (let iy = 0; iy < ny; iy++) {
    const y = iy * dy;
    const rowOff = iy * nx;
    for (let ix = 0; ix < nx; ix++) {
      const x = ix * dx;
      const t1 = Math.cos(0.105 * x) * Math.cos(0.11 * y);
      const t2b = Math.cos(0.13 * x) * Math.cos(0.087 * y);
      const t3 = Math.cos(0.025 * x - 0.15 * y) * Math.cos(0.07 * x - 0.02 * y);
      out[rowOff + ix] = c0 + eps * (t1 + t2b * t2b + t3);
    }
  }
  return out;
}

/**
 * Deterministic NIST PFHub Benchmark 1c-style 3D cosine initial condition on [0, domainL]^3.
 * Reduces identically to PFHub 1a on the z = 0 plane.
 */
export function pfhubB1Init3D(
  nx: number,
  ny: number,
  nz: number,
  domainL = 100,
  c0 = 0.5,
  eps = 0.01,
): Float32Array {
  const out = new Float32Array(nx * ny * nz);
  const dx = domainL / nx;
  const dy = domainL / ny;
  const dz = domainL / nz;
  for (let iz = 0; iz < nz; iz++) {
    const z = iz * dz;
    const cz1 = Math.cos(0.095 * z);
    const cz2 = Math.cos(0.115 * z);
    const zOff = iz * nx * ny;
    for (let iy = 0; iy < ny; iy++) {
      const y = iy * dy;
      const yOff = zOff + iy * nx;
      for (let ix = 0; ix < nx; ix++) {
        const x = ix * dx;
        const t1 = Math.cos(0.105 * x) * Math.cos(0.11 * y) * cz1;
        const t2b = Math.cos(0.13 * x) * Math.cos(0.087 * y) * cz2;
        const t3 =
          Math.cos(0.025 * x - 0.15 * y + 0.06 * z) *
          Math.cos(0.07 * x - 0.02 * y - 0.08 * z);
        out[yOff + ix] = c0 + eps * (t1 + t2b * t2b + t3);
      }
    }
  }
  return out;
}

/** Deterministic seeded Mulberry32 PRNG for reproducible random-noise alloy presets. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zero-mean seeded random initial condition for non-PFHub alloy presets (2D or 3D). */
export function buildSeededNoiseInit(
  total: number,
  c0: number,
  eps: number,
  seed: number,
): Float32Array {
  const out = new Float32Array(total);
  const rand = mulberry32(seed);
  let sum = 0;
  for (let i = 0; i < total; i++) {
    const v = (rand() * 2 - 1) * eps;
    out[i] = v;
    sum += v;
  }
  const avg = sum / Math.max(1, total);
  for (let i = 0; i < total; i++) {
    out[i] = c0 + (out[i] - avg);
  }
  return out;
}

// ------------------------------------------------ diagnostics & LSW fit

export interface SpinodalMeasure {
  F: number;
  chemF: number;
  gradF: number;
  L: number;
  meanC: number;
  minC: number;
  maxC: number;
  valid: boolean;
}

/**
 * Exact 2D PFHub Benchmark 1 free energy and gradient-based interfacial length L(t):
 *   F = sum [ f_chem(c) + 0.5 * kappa * |grad c|^2 ] * dx^2
 *   L = V * (cBeta - cAlpha) / sum( |grad c| * dx^2 )
 */
export function measureSpinodal2D(
  c: Float32Array,
  nx: number,
  ny: number,
  dx: number,
  kappa = 2.0,
  cAlpha = 0.3,
  cBeta = 0.7,
  rhoS = 5.0,
): SpinodalMeasure {
  const total = nx * ny;
  if (total <= 0 || c.length < total) {
    return { F: 0, chemF: 0, gradF: 0, L: 0, meanC: 0, minC: 0, maxC: 0, valid: false };
  }
  const inv2dx = 1 / (2 * dx);
  const dV = dx * dx;
  let chemAcc = 0;
  let gradAcc = 0;
  let gradMagAcc = 0;
  let sumC = 0;
  let minC = Infinity;
  let maxC = -Infinity;
  let valid = true;

  for (let y = 0; y < ny; y++) {
    const ym = y === 0 ? ny - 1 : y - 1;
    const yp = y === ny - 1 ? 0 : y + 1;
    const row = y * nx;
    const rowM = ym * nx;
    const rowP = yp * nx;
    for (let x = 0; x < nx; x++) {
      const v = c[row + x];
      if (!Number.isFinite(v)) {
        valid = false;
        continue;
      }
      sumC += v;
      if (v < minC) minC = v;
      if (v > maxC) maxC = v;

      const xm = x === 0 ? nx - 1 : x - 1;
      const xp = x === nx - 1 ? 0 : x + 1;
      const gx = (c[row + xp] - c[row + xm]) * inv2dx;
      const gy = (c[rowP + x] - c[rowM + x]) * inv2dx;
      const g2 = gx * gx + gy * gy;

      chemAcc += doubleWellEnergy(v, cAlpha, cBeta, rhoS);
      gradAcc += 0.5 * kappa * g2;
      gradMagAcc += Math.sqrt(g2);
    }
  }

  const chemF = chemAcc * dV;
  const gradF = gradAcc * dV;
  const F = chemF + gradF;
  const vol = total * dV;
  const gradInt = gradMagAcc * dV;
  const span = Math.abs(cBeta - cAlpha);
  const L = gradInt > 1e-12 ? (vol * span) / gradInt : 0;

  return {
    F,
    chemF,
    gradF,
    L,
    meanC: sumC / total,
    minC: Number.isFinite(minC) ? minC : 0,
    maxC: Number.isFinite(maxC) ? maxC : 0,
    valid,
  };
}

/**
 * Exact 3D PFHub Benchmark 1c free energy and gradient-based interfacial length L(t):
 *   F = sum [ f_chem(c) + 0.5 * kappa * |grad c|^2 ] * dx^3
 *   L = V * (cBeta - cAlpha) / sum( |grad c| * dx^3 )
 */
export function measureSpinodal3D(
  c: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  kappa = 2.0,
  cAlpha = 0.3,
  cBeta = 0.7,
  rhoS = 5.0,
): SpinodalMeasure {
  const xy = nx * ny;
  const total = xy * nz;
  if (total <= 0 || c.length < total) {
    return { F: 0, chemF: 0, gradF: 0, L: 0, meanC: 0, minC: 0, maxC: 0, valid: false };
  }
  const inv2dx = 1 / (2 * dx);
  const dV = dx * dx * dx;
  let chemAcc = 0;
  let gradAcc = 0;
  let gradMagAcc = 0;
  let sumC = 0;
  let minC = Infinity;
  let maxC = -Infinity;
  let valid = true;

  for (let z = 0; z < nz; z++) {
    const zm = z === 0 ? nz - 1 : z - 1;
    const zp = z === nz - 1 ? 0 : z + 1;
    const zOff = z * xy;
    const zmOff = zm * xy;
    const zpOff = zp * xy;
    for (let y = 0; y < ny; y++) {
      const ym = y === 0 ? ny - 1 : y - 1;
      const yp = y === ny - 1 ? 0 : y + 1;
      const yOff = zOff + y * nx;
      const ymOff = zOff + ym * nx;
      const ypOff = zOff + yp * nx;
      for (let x = 0; x < nx; x++) {
        const v = c[yOff + x];
        if (!Number.isFinite(v)) {
          valid = false;
          continue;
        }
        sumC += v;
        if (v < minC) minC = v;
        if (v > maxC) maxC = v;

        const xm = x === 0 ? nx - 1 : x - 1;
        const xp = x === nx - 1 ? 0 : x + 1;
        const gx = (c[yOff + xp] - c[yOff + xm]) * inv2dx;
        const gy = (c[ypOff + x] - c[ymOff + x]) * inv2dx;
        const gz = (c[zpOff + y * nx + x] - c[zmOff + y * nx + x]) * inv2dx;
        const g2 = gx * gx + gy * gy;
        const g3 = g2 + gz * gz;

        chemAcc += doubleWellEnergy(v, cAlpha, cBeta, rhoS);
        gradAcc += 0.5 * kappa * g3;
        gradMagAcc += Math.sqrt(g3);
      }
    }
  }

  const chemF = chemAcc * dV;
  const gradF = gradAcc * dV;
  const F = chemF + gradF;
  const vol = total * dV;
  const gradInt = gradMagAcc * dV;
  const span = Math.abs(cBeta - cAlpha);
  const L = gradInt > 1e-12 ? (vol * span) / gradInt : 0;

  return {
    F,
    chemF,
    gradF,
    L,
    meanC: sumC / total,
    minC: Number.isFinite(minC) ? minC : 0,
    maxC: Number.isFinite(maxC) ? maxC : 0,
    valid,
  };
}

/**
 * Log-log OLS fit of the LSW coarsening exponent alpha in L(t) ~ t^alpha over the
 * post-spinodal coarsening window (t > 0, L > 0, maxC - minC > 0.25, starting
 * from the minimum of L inside that window when >= 3 points remain).
 */
export function fitLswSlope(samples: readonly SpinodalSample[]): number | null {
  const elig = samples.filter(
    s =>
      Number.isFinite(s.t) &&
      s.t > 0 &&
      Number.isFinite(s.L) &&
      s.L > 0 &&
      Number.isFinite(s.maxC) &&
      Number.isFinite(s.minC) &&
      s.maxC - s.minC > 0.25,
  );
  if (elig.length < 3) return null;

  // Exclude early spinodal amplification dip (while L is still falling before interfaces saturate)
  let minIdx = 0;
  for (let i = 1; i < elig.length; i++) {
    if (elig[i].L < elig[minIdx].L) minIdx = i;
  }
  const win = elig.length - minIdx >= 3 ? elig.slice(minIdx) : elig;
  const n = win.length;
  if (n < 3) return null;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += Math.log10(win[i].t);
    sy += Math.log10(win[i].L);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = Math.log10(win[i].t) - mx;
    const dy = Math.log10(win[i].L) - my;
    sxx += dx * dx;
    sxy += dx * dy;
  }
  if (!(sxx > 1e-12)) return null;
  const slope = sxy / sxx;
  return Number.isFinite(slope) ? slope : null;
}

// ------------------------------------------------ pure CPU 2D step (CI twin)

export interface CpuCahnHilliardConfig {
  dx: number;
  dt: number;
  kappa: number;
  mobility: number;
  cAlpha: number;
  cBeta: number;
  rhoS: number;
}

export const CPU_CH_DEFAULTS: CpuCahnHilliardConfig = {
  dx: 1.0,
  dt: 0.0033,
  kappa: 2.0,
  mobility: 5.0,
  cAlpha: 0.3,
  cBeta: 0.7,
  rhoS: 5.0,
};

/**
 * Pure CPU 2D periodic Cahn–Hilliard step using the exact 9-point Mehrstellen
 * Laplacian for both mu and dc/dt (exact twin of the 2D WGSL compute passes).
 * Discrete zero-sum stencil guarantees exact mass conservation sum(c) = const.
 */
export function cpuCahnHilliardStep2D(
  c: Float32Array,
  nx: number,
  ny: number,
  cfg?: Partial<CpuCahnHilliardConfig>,
): Float32Array {
  const p: CpuCahnHilliardConfig = { ...CPU_CH_DEFAULTS, ...(cfg ?? {}) };
  const total = nx * ny;
  const mu = new Float32Array(total);
  const out = new Float32Array(total);
  const lapScale = 1 / (6 * p.dx * p.dx);

  // Pass 1: mu = f'(c) - kappa * lap9(c) (pairwise difference form eliminates 20*c cancellation)
  for (let y = 0; y < ny; y++) {
    const ym = y === 0 ? ny - 1 : y - 1;
    const yp = y === ny - 1 ? 0 : y + 1;
    const rC = y * nx;
    const rM = ym * nx;
    const rP = yp * nx;
    for (let x = 0; x < nx; x++) {
      const xm = x === 0 ? nx - 1 : x - 1;
      const xp = x === nx - 1 ? 0 : x + 1;
      const v = c[rC + x];
      const dCard =
        (c[rC + xm] - v) + (c[rC + xp] - v) + (c[rM + x] - v) + (c[rP + x] - v);
      const dDiag =
        (c[rM + xm] - v) + (c[rM + xp] - v) + (c[rP + xm] - v) + (c[rP + xp] - v);
      const lapC = (4 * dCard + dDiag) * lapScale;
      mu[rC + x] = doubleWellDeriv(v, p.cAlpha, p.cBeta, p.rhoS) - p.kappa * lapC;
    }
  }

  // Pass 2: c_next = c + dt * M * lap9(mu) (exact pairwise anti-symmetric fluxes -> f32 mass conservation)
  const dtM = p.dt * p.mobility;
  for (let y = 0; y < ny; y++) {
    const ym = y === 0 ? ny - 1 : y - 1;
    const yp = y === ny - 1 ? 0 : y + 1;
    const rC = y * nx;
    const rM = ym * nx;
    const rP = yp * nx;
    for (let x = 0; x < nx; x++) {
      const xm = x === 0 ? nx - 1 : x - 1;
      const xp = x === nx - 1 ? 0 : x + 1;
      const mC = mu[rC + x];
      const dCard =
        (mu[rC + xm] - mC) + (mu[rC + xp] - mC) + (mu[rM + x] - mC) + (mu[rP + x] - mC);
      const dDiag =
        (mu[rM + xm] - mC) + (mu[rM + xp] - mC) + (mu[rP + xm] - mC) + (mu[rP + xp] - mC);
      const lapMu = (4 * dCard + dDiag) * lapScale;
      out[rC + x] = c[rC + x] + dtM * lapMu;
    }
  }

  return out;
}

// ------------------------------------------------ WGSL compute shaders (2D/3D)

const SPINODAL_2D_WGSL = /* wgsl */ `
struct CH2Params {
  nx: u32,
  ny: u32,
  pad0: u32,
  pad1: u32,
  lapScale: f32,
  dtM: f32,
  kappa: f32,
  rhoS: f32,
  cAlpha: f32,
  cBeta: f32,
  pad2: f32,
  pad3: f32,
};

@group(0) @binding(0) var<uniform> P: CH2Params;
@group(0) @binding(1) var<storage, read> cIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> muBuf: array<f32>;
@group(0) @binding(3) var<storage, read_write> cOut: array<f32>;

fn idx2(x: u32, y: u32) -> u32 {
  return y * P.nx + x;
}

@compute @workgroup_size(16, 16)
fn muMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let x = gid.x;
  let y = gid.y;
  let xm = select(x - 1u, P.nx - 1u, x == 0u);
  let xp = select(x + 1u, 0u, x + 1u == P.nx);
  let ym = select(y - 1u, P.ny - 1u, y == 0u);
  let yp = select(y + 1u, 0u, y + 1u == P.ny);

  let cC = cIn[idx2(x, y)];
  let dCard =
    (cIn[idx2(xm, y)] - cC) + (cIn[idx2(xp, y)] - cC) +
    (cIn[idx2(x, ym)] - cC) + (cIn[idx2(x, yp)] - cC);
  let dDiag =
    (cIn[idx2(xm, ym)] - cC) + (cIn[idx2(xp, ym)] - cC) +
    (cIn[idx2(xm, yp)] - cC) + (cIn[idx2(xp, yp)] - cC);
  let lapC = (4.0 * dCard + dDiag) * P.lapScale;

  let a = cC - P.cAlpha;
  let b = P.cBeta - cC;
  let dfdc = 2.0 * P.rhoS * a * b * (b - a);
  muBuf[idx2(x, y)] = dfdc - P.kappa * lapC;
}

@compute @workgroup_size(16, 16)
fn stepMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let x = gid.x;
  let y = gid.y;
  let xm = select(x - 1u, P.nx - 1u, x == 0u);
  let xp = select(x + 1u, 0u, x + 1u == P.nx);
  let ym = select(y - 1u, P.ny - 1u, y == 0u);
  let yp = select(y + 1u, 0u, y + 1u == P.ny);

  let i = idx2(x, y);
  let mC = muBuf[i];
  let dCard =
    (muBuf[idx2(xm, y)] - mC) + (muBuf[idx2(xp, y)] - mC) +
    (muBuf[idx2(x, ym)] - mC) + (muBuf[idx2(x, yp)] - mC);
  let dDiag =
    (muBuf[idx2(xm, ym)] - mC) + (muBuf[idx2(xp, ym)] - mC) +
    (muBuf[idx2(xm, yp)] - mC) + (muBuf[idx2(xp, yp)] - mC);
  let lapMu = (4.0 * dCard + dDiag) * P.lapScale;

  cOut[i] = cIn[i] + P.dtM * lapMu;
}
`;

const SPINODAL_3D_WGSL = /* wgsl */ `
struct CH3Params {
  n: u32,
  n2: u32,
  pad0: u32,
  pad1: u32,
  lapScale: f32,
  dtM: f32,
  kappa: f32,
  rhoS: f32,
  cAlpha: f32,
  cBeta: f32,
  pad2: f32,
  pad3: f32,
};

@group(0) @binding(0) var<uniform> P: CH3Params;
@group(0) @binding(1) var<storage, read> cIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> muBuf: array<f32>;
@group(0) @binding(3) var<storage, read_write> cOut: array<f32>;

fn idx3(x: u32, y: u32, z: u32) -> u32 {
  return z * P.n2 + y * P.n + x;
}

@compute @workgroup_size(4, 4, 4)
fn muMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  let xm = select(x - 1u, P.n - 1u, x == 0u);
  let xp = select(x + 1u, 0u, x + 1u == P.n);
  let ym = select(y - 1u, P.n - 1u, y == 0u);
  let yp = select(y + 1u, 0u, y + 1u == P.n);
  let zm = select(z - 1u, P.n - 1u, z == 0u);
  let zp = select(z + 1u, 0u, z + 1u == P.n);

  let i = idx3(x, y, z);
  let cC = cIn[i];
  let dFaces =
    (cIn[idx3(xm, y, z)] - cC) + (cIn[idx3(xp, y, z)] - cC) +
    (cIn[idx3(x, ym, z)] - cC) + (cIn[idx3(x, yp, z)] - cC) +
    (cIn[idx3(x, y, zm)] - cC) + (cIn[idx3(x, y, zp)] - cC);
  let dEdges =
    (cIn[idx3(xm, ym, z)] - cC) + (cIn[idx3(xp, ym, z)] - cC) + (cIn[idx3(xm, yp, z)] - cC) + (cIn[idx3(xp, yp, z)] - cC) +
    (cIn[idx3(xm, y, zm)] - cC) + (cIn[idx3(xp, y, zm)] - cC) + (cIn[idx3(xm, y, zp)] - cC) + (cIn[idx3(xp, y, zp)] - cC) +
    (cIn[idx3(x, ym, zm)] - cC) + (cIn[idx3(x, yp, zm)] - cC) + (cIn[idx3(x, ym, zp)] - cC) + (cIn[idx3(x, yp, zp)] - cC);
  let lapC = (2.0 * dFaces + dEdges) * P.lapScale;

  let a = cC - P.cAlpha;
  let b = P.cBeta - cC;
  let dfdc = 2.0 * P.rhoS * a * b * (b - a);
  muBuf[i] = dfdc - P.kappa * lapC;
}

@compute @workgroup_size(4, 4, 4)
fn stepMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  let xm = select(x - 1u, P.n - 1u, x == 0u);
  let xp = select(x + 1u, 0u, x + 1u == P.n);
  let ym = select(y - 1u, P.n - 1u, y == 0u);
  let yp = select(y + 1u, 0u, y + 1u == P.n);
  let zm = select(z - 1u, P.n - 1u, z == 0u);
  let zp = select(z + 1u, 0u, z + 1u == P.n);

  let i = idx3(x, y, z);
  let mC = muBuf[i];
  let dFaces =
    (muBuf[idx3(xm, y, z)] - mC) + (muBuf[idx3(xp, y, z)] - mC) +
    (muBuf[idx3(x, ym, z)] - mC) + (muBuf[idx3(x, yp, z)] - mC) +
    (muBuf[idx3(x, y, zm)] - mC) + (muBuf[idx3(x, y, zp)] - mC);
  let dEdges =
    (muBuf[idx3(xm, ym, z)] - mC) + (muBuf[idx3(xp, ym, z)] - mC) + (muBuf[idx3(xm, yp, z)] - mC) + (muBuf[idx3(xp, yp, z)] - mC) +
    (muBuf[idx3(xm, y, zm)] - mC) + (muBuf[idx3(xp, y, zm)] - mC) + (muBuf[idx3(xm, y, zp)] - mC) + (muBuf[idx3(xp, y, zp)] - mC) +
    (muBuf[idx3(x, ym, zm)] - mC) + (muBuf[idx3(x, yp, zm)] - mC) + (muBuf[idx3(x, ym, zp)] - mC) + (muBuf[idx3(x, yp, zp)] - mC);
  let lapMu = (2.0 * dFaces + dEdges) * P.lapScale;

  cOut[i] = cIn[i] + P.dtM * lapMu;
}
`;

// ------------------------------------------------ WGSL render shaders (2D/3D)

const SPINODAL_RENDER_2D_WGSL = /* wgsl */ `
struct R2U {
  lens: u32,
  nx: u32,
  ny: u32,
  pad0: u32,
  width: f32,
  height: f32,
  cAlpha: f32,
  cBeta: f32,
};

@group(0) @binding(0) var<uniform> R: R2U;
@group(0) @binding(1) var<storage, read> cField: array<f32>;
@group(0) @binding(2) var<storage, read> muField: array<f32>;

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

fn loadC(x: i32, y: i32) -> f32 {
  let nx = i32(R.nx);
  let ny = i32(R.ny);
  let wx = ((x % nx) + nx) % nx;
  let wy = ((y % ny) + ny) % ny;
  return cField[u32(wy * nx + wx)];
}

fn loadMu(x: i32, y: i32) -> f32 {
  let nx = i32(R.nx);
  let ny = i32(R.ny);
  let wx = ((x % nx) + nx) % nx;
  let wy = ((y % ny) + ny) % ny;
  return muField[u32(wy * nx + wx)];
}

fn bilerpC(gx: f32, gy: f32) -> f32 {
  let x0 = i32(floor(gx));
  let y0 = i32(floor(gy));
  let fx = gx - f32(x0);
  let fy = gy - f32(y0);
  return mix(
    mix(loadC(x0, y0), loadC(x0 + 1, y0), fx),
    mix(loadC(x0, y0 + 1), loadC(x0 + 1, y0 + 1), fx),
    fy,
  );
}

fn bilerpMu(gx: f32, gy: f32) -> f32 {
  let x0 = i32(floor(gx));
  let y0 = i32(floor(gy));
  let fx = gx - f32(x0);
  let fy = gy - f32(y0);
  return mix(
    mix(loadMu(x0, y0), loadMu(x0 + 1, y0), fx),
    mix(loadMu(x0, y0 + 1), loadMu(x0 + 1, y0 + 1), fx),
    fy,
  );
}

@fragment
fn fmain(in: VSOut) -> @location(0) vec4<f32> {
  // Periodic cover-fit tile centered cleanly on the viewport
  let scale = max(R.width, R.height);
  let px = in.uv.x * R.width;
  let py = in.uv.y * R.height;
  let offX = (R.width - scale) * 0.5;
  let offY = (R.height - scale) * 0.5;
  let u = (px - offX) / scale;
  let v = (py - offY) / scale;

  let gx = u * f32(R.nx) - 0.5;
  let gy = v * f32(R.ny) - 0.5;
  let c = bilerpC(gx, gy);
  let span = max(0.05, R.cBeta - R.cAlpha);
  let cMid = 0.5 * (R.cAlpha + R.cBeta);
  let t = clamp((c - cMid) / (0.5 * span), -1.0, 1.0);

  let cx = (bilerpC(gx + 0.6, gy) - bilerpC(gx - 0.6, gy)) / (1.2 * span);
  let cy = (bilerpC(gx, gy + 0.6) - bilerpC(gx, gy - 0.6)) / (1.2 * span);
  let gmag = clamp(sqrt(cx * cx + cy * cy) * 3.4, 0.0, 1.0);

  var col = vec3<f32>(0.08, 0.09, 0.11);

  if (R.lens == 0u) {
    // Diverging composition: deep slate-blue (alpha) -> charcoal -> warm amber-ivory (beta)
    let lo = vec3<f32>(0.16, 0.34, 0.58);
    let mid = vec3<f32>(0.11, 0.12, 0.15);
    let hi = vec3<f32>(0.88, 0.66, 0.36);
    col = select(mix(mid, hi, t), mix(mid, lo, -t), t < 0.0);
    // Subtle luminous interfacial rim
    col = mix(col, vec3<f32>(0.96, 0.96, 0.98), 0.16 * gmag);
  } else if (R.lens == 1u) {
    // Chemical potential mu: highlights coarsening curvature & diffusive flux
    let mu = bilerpMu(gx, gy);
    let m = clamp(mu * 4.5, -1.0, 1.0);
    let lo = vec3<f32>(0.18, 0.54, 0.72);
    let mid = vec3<f32>(0.09, 0.10, 0.12);
    let hi = vec3<f32>(0.88, 0.44, 0.22);
    col = select(mix(mid, hi, m), mix(mid, lo, -m), m < 0.0);
    col = mix(col, vec3<f32>(0.90, 0.91, 0.94), 0.22 * gmag);
  } else {
    // Etch / micrograph: bright-field grayscale with crisp etched phase boundaries
    let base = mix(0.20, 0.84, 0.5 * (t + 1.0));
    let etched = base * (1.0 - 0.68 * gmag);
    col = vec3<f32>(etched, etched, etched * 1.01);
  }

  return vec4<f32>(col, 1.0);
}
`;

const SPINODAL_RENDER_3D_WGSL = /* wgsl */ `
struct R3U {
  lens: u32,
  n: u32,
  pad0: u32,
  pad1: u32,
  width: f32,
  height: f32,
  cAlpha: f32,
  cBeta: f32,
  ro: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  fwd: vec4<f32>,
};

@group(0) @binding(0) var<uniform> R: R3U;
@group(0) @binding(1) var<storage, read> cField: array<f32>;

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

fn load3(x: i32, y: i32, z: i32) -> f32 {
  let n = i32(R.n);
  let wx = ((x % n) + n) % n;
  let wy = ((y % n) + n) % n;
  let wz = ((z % n) + n) % n;
  return cField[u32((wz * n + wy) * n + wx)];
}

fn sample3(p: vec3<f32>) -> f32 {
  let nf = f32(R.n);
  let g = p * nf - vec3<f32>(0.5);
  let i0 = vec3<i32>(floor(g));
  let f = g - vec3<f32>(i0);

  let c000 = load3(i0.x, i0.y, i0.z);
  let c100 = load3(i0.x + 1, i0.y, i0.z);
  let c010 = load3(i0.x, i0.y + 1, i0.z);
  let c110 = load3(i0.x + 1, i0.y + 1, i0.z);
  let c001 = load3(i0.x, i0.y, i0.z + 1);
  let c101 = load3(i0.x + 1, i0.y, i0.z + 1);
  let c011 = load3(i0.x, i0.y + 1, i0.z + 1);
  let c111 = load3(i0.x + 1, i0.y + 1, i0.z + 1);

  let c00 = mix(c000, c100, f.x);
  let c10 = mix(c010, c110, f.x);
  let c01 = mix(c001, c101, f.x);
  let c11 = mix(c011, c111, f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

fn grad3(p: vec3<f32>) -> vec3<f32> {
  let e = 0.75 / f32(R.n);
  return vec3<f32>(
    sample3(p + vec3<f32>(e, 0.0, 0.0)) - sample3(p - vec3<f32>(e, 0.0, 0.0)),
    sample3(p + vec3<f32>(0.0, e, 0.0)) - sample3(p - vec3<f32>(0.0, e, 0.0)),
    sample3(p + vec3<f32>(0.0, 0.0, e)) - sample3(p - vec3<f32>(0.0, 0.0, e)),
  );
}

fn boxNormal(p: vec3<f32>) -> vec3<f32> {
  let d = p - vec3<f32>(0.5);
  let a = abs(d);
  if (a.x >= a.y && a.x >= a.z) { return vec3<f32>(sign(d.x), 0.0, 0.0); }
  if (a.y >= a.x && a.y >= a.z) { return vec3<f32>(0.0, sign(d.y), 0.0); }
  return vec3<f32>(0.0, 0.0, sign(d.z));
}

fn shadeSurface(p: vec3<f32>, nrm: vec3<f32>, viewDir: vec3<f32>, baseCol: vec3<f32>, isoVal: f32) -> vec3<f32> {
  let l1 = normalize(vec3<f32>(0.55, 0.65, 0.85));
  let l2 = normalize(vec3<f32>(-0.75, -0.35, 0.45));
  let diff1 = max(dot(nrm, l1), 0.0);
  let diff2 = max(dot(nrm, l2), 0.0);
  let h1 = normalize(l1 + viewDir);
  let spec = pow(max(dot(nrm, h1), 0.0), 36.0);
  let fres = pow(1.0 - max(dot(nrm, viewDir), 0.0), 3.0);

  // 4-tap local ambient occlusion along the surface normal
  let stepA = 1.6 / f32(R.n);
  var occ = 0.0;
  for (var k = 1; k <= 4; k = k + 1) {
    let q = p + nrm * (f32(k) * stepA);
    if (all(q >= vec3<f32>(0.0)) && all(q <= vec3<f32>(1.0))) {
      let s = sample3(q) - isoVal;
      occ += clamp(s * 6.0, 0.0, 1.0) * (1.0 / f32(k));
    }
  }
  let ao = clamp(1.0 - 0.34 * occ, 0.35, 1.0);

  let hemi = mix(vec3<f32>(0.16, 0.19, 0.24), vec3<f32>(0.34, 0.36, 0.40), 0.5 * (nrm.z + 1.0));
  return baseCol * (hemi * ao + (0.72 * diff1 + 0.24 * diff2) * ao) + vec3<f32>(0.24) * spec * ao + vec3<f32>(0.14, 0.18, 0.24) * fres;
}

@fragment
fn fmain(in: VSOut) -> @location(0) vec4<f32> {
  let aspect = R.width / max(R.height, 1.0);
  // R.ro.w / R.right.w carry optional NDC framing offsets so the 3D sponge sits unobstructed beside #spinodal
  let ndc = in.uv * 2.0 - vec2<f32>(1.0) - vec2<f32>(R.ro.w, R.right.w);
  let fov = 0.62;
  let rd = normalize(R.fwd.xyz + R.right.xyz * (ndc.x * aspect * fov) + R.up.xyz * (ndc.y * fov));
  let ro = R.ro.xyz;

  // Clean dark-slate studio background
  let bg = mix(vec3<f32>(0.035, 0.04, 0.05), vec3<f32>(0.065, 0.072, 0.088), in.uv.y);

  // Ray-box intersection with [0, 1]^3
  let inv = 1.0 / rd;
  let t0 = (vec3<f32>(0.0) - ro) * inv;
  let t1 = (vec3<f32>(1.0) - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tEnter = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  let tExit = min(min(tmax.x, tmax.y), tmax.z);

  if (tExit <= tEnter) {
    return vec4<f32>(bg, 1.0);
  }

  let cMid = 0.5 * (R.cAlpha + R.cBeta);
  let span = max(0.05, R.cBeta - R.cAlpha);
  let viewDir = -rd;

  if (R.lens == 0u) {
    // Lens 0: sculpted 3D bicontinuous spinodal sponge isosurface (c = cMid)
    let pEntry = ro + rd * (tEnter + 0.0005);
    let cEntry = sample3(pEntry);
    if (cEntry >= cMid) {
      // Capped cross-section where the high-c sponge meets the periodic cube boundary
      let nBox = boxNormal(pEntry);
      let normC = clamp((cEntry - cMid) / (0.5 * span), 0.0, 1.0);
      let capCol = mix(vec3<f32>(0.68, 0.52, 0.30), vec3<f32>(0.88, 0.68, 0.38), normC);
      return vec4<f32>(shadeSurface(pEntry, nBox, viewDir, capCol, cMid), 1.0);
    }

    let dt = 0.72 / f32(R.n);
    var t = tEnter + 0.0005;
    var prevC = cEntry;
    var hit = false;
    var hitP = pEntry;

    for (var s = 0; s < 220; s = s + 1) {
      t += dt;
      if (t >= tExit) { break; }
      let p = ro + rd * t;
      let c = sample3(p);
      if (c >= cMid) {
        // 4-step bisection for crisp sub-voxel isosurface placement
        var loT = t - dt;
        var hiT = t;
        for (var b = 0; b < 4; b = b + 1) {
          let midT = 0.5 * (loT + hiT);
          let mc = sample3(ro + rd * midT);
          if (mc >= cMid) { hiT = midT; } else { loT = midT; }
        }
        hitP = ro + rd * (0.5 * (loT + hiT));
        hit = true;
        break;
      }
      prevC = c;
    }

    if (hit) {
      let g = grad3(hitP);
      let gl = length(g);
      let nrm = select(viewDir, -g / gl, gl > 1e-6);
      let surfCol = vec3<f32>(0.82, 0.80, 0.75);
      return vec4<f32>(shadeSurface(hitP, nrm, viewDir, surfCol, cMid), 1.0);
    }

    // Subtle bounding cube edge cue when ray passes through empty void
    let pOut = ro + rd * tExit;
    let eIn = min(min(min(pEntry.x, 1.0 - pEntry.x), min(pEntry.y, 1.0 - pEntry.y)), min(pEntry.z, 1.0 - pEntry.z));
    let eOut = min(min(min(pOut.x, 1.0 - pOut.x), min(pOut.y, 1.0 - pOut.y)), min(pOut.z, 1.0 - pOut.z));
    let edge = 1.0 - smoothstep(0.0, 0.008, min(eIn, eOut));
    return vec4<f32>(mix(bg, vec3<f32>(0.24, 0.26, 0.30), 0.35 * edge), 1.0);
  }

  if (R.lens == 1u) {
    // Lens 1: mid-plane cross-section slice (z = 0.5) + translucent upper sponge context
    var col = bg;
    var sliceHit = false;
    var sliceT = tExit;
    if (abs(rd.z) > 1e-5) {
      let ts = (0.5 - ro.z) / rd.z;
      if (ts > tEnter && ts < tExit) {
        let ps = ro + rd * ts;
        if (ps.x >= 0.0 && ps.x <= 1.0 && ps.y >= 0.0 && ps.y <= 1.0) {
          let cs = sample3(ps);
          let tv = clamp((cs - cMid) / (0.5 * span), -1.0, 1.0);
          let lo = vec3<f32>(0.16, 0.34, 0.58);
          let mid = vec3<f32>(0.12, 0.13, 0.16);
          let hi = vec3<f32>(0.88, 0.66, 0.36);
          col = select(mix(mid, hi, tv), mix(mid, lo, -tv), tv < 0.0);
          sliceHit = true;
          sliceT = ts;
        }
      }
    }
    // Translucent 3D sponge context in front of the slice plane
    let dt = 1.2 / f32(R.n);
    var acc = vec3<f32>(0.0);
    var alpha = 0.0;
    var t = tEnter + 0.001;
    let tStop = select(tExit, sliceT, sliceHit);
    for (var s = 0; s < 120; s = s + 1) {
      if (t >= tStop || alpha > 0.72) { break; }
      let p = ro + rd * t;
      let c = sample3(p);
      let d = clamp((c - cMid) / (0.5 * span), 0.0, 1.0);
      if (d > 0.05) {
        let a = d * 0.045;
        let tint = mix(vec3<f32>(0.55, 0.62, 0.74), vec3<f32>(0.90, 0.72, 0.44), d);
        acc += (1.0 - alpha) * tint * a;
        alpha += (1.0 - alpha) * a;
      }
      t += dt;
    }
    return vec4<f32>(acc + (1.0 - alpha) * col, 1.0);
  }

  // Lens 2: volume emission-absorption phase projection
  let dt = 1.1 / f32(R.n);
  var acc = vec3<f32>(0.0);
  var alpha = 0.0;
  var t = tEnter + 0.001;
  for (var s = 0; s < 140; s = s + 1) {
    if (t >= tExit || alpha > 0.96) { break; }
    let p = ro + rd * t;
    let c = sample3(p);
    let tv = clamp((c - cMid) / (0.5 * span), -1.0, 1.0);
    let hiW = max(0.0, tv);
    let loW = max(0.0, -tv);
    let dens = hiW * 0.095 + loW * 0.022;
    if (dens > 0.001) {
      let tint = select(vec3<f32>(0.22, 0.45, 0.74), vec3<f32>(0.92, 0.68, 0.36), tv >= 0.0);
      acc += (1.0 - alpha) * tint * dens;
      alpha += (1.0 - alpha) * dens;
    }
    t += dt;
  }
  return vec4<f32>(acc + (1.0 - alpha) * bg, 1.0);
}
`;

// ------------------------------------------------ WebGPU simulation class

export class SpinodalSim {
  readonly device: GPUDevice;
  params: SpinodalParams;

  private _dim: SpinodalDim;
  private _n: number;
  private _dx: number;
  private _dt: number;
  private _history: SpinodalSample[] = [];

  private cBuf!: [GPUBuffer, GPUBuffer];
  private muBuf!: GPUBuffer;
  private readBuf!: GPUBuffer;
  private ubuf!: GPUBuffer;
  private udata = new ArrayBuffer(48);

  private computeBGL: GPUBindGroupLayout;
  private pipeMu2d: GPUComputePipeline;
  private pipeStep2d: GPUComputePipeline;
  private pipeMu3d: GPUComputePipeline;
  private pipeStep3d: GPUComputePipeline;
  private bg!: [GPUBindGroup, GPUBindGroup];

  private dir: 0 | 1 = 0;
  private stepCount = 0;
  private simTime = 0;
  private initMeanC = 0.5;
  private reading = false;
  private disposed = false;
  private lastStats: SpinodalStats | null = null;
  private seedCounter = 1337;

  constructor(device: GPUDevice, params?: Partial<SpinodalParams>) {
    this.device = device;
    this.params = { ...SPINODAL_DEFAULTS, ...(params ?? {}) };
    this._dim = this.params.dim;
    this._n = this._dim === "3d" ? this.params.n3d : this.params.n2d;
    const preset = SPINODAL_PRESETS[this.params.preset] ?? SPINODAL_PRESETS.pfhub1;
    this._dx = (this._dim === "3d" ? preset.domain3d : preset.domain2d) / this._n;
    this._dt = chooseSpinodalDt(this._dx, this.params.kappa, this.params.mobility, this._dim, preset);

    // Explicit shared bind-group layout across muMain (reads 0..2) and stepMain (reads 0..3)
    this.computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const computeLayout = device.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] });

    const mod2d = device.createShaderModule({ code: SPINODAL_2D_WGSL });
    this.pipeMu2d = device.createComputePipeline({
      layout: computeLayout,
      compute: { module: mod2d, entryPoint: "muMain" },
    });
    this.pipeStep2d = device.createComputePipeline({
      layout: computeLayout,
      compute: { module: mod2d, entryPoint: "stepMain" },
    });

    const mod3d = device.createShaderModule({ code: SPINODAL_3D_WGSL });
    this.pipeMu3d = device.createComputePipeline({
      layout: computeLayout,
      compute: { module: mod3d, entryPoint: "muMain" },
    });
    this.pipeStep3d = device.createComputePipeline({
      layout: computeLayout,
      compute: { module: mod3d, entryPoint: "stepMain" },
    });

    this.ubuf = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.allocFieldBuffers();
    this.reset(this.params);
  }

  get dim(): SpinodalDim {
    return this._dim;
  }

  get n(): number {
    return this._n;
  }

  get dx(): number {
    return this._dx;
  }

  get dt(): number {
    return this._dt;
  }

  get history(): SpinodalSample[] {
    return this._history;
  }

  /** Internal buffer accessors for SpinodalRenderer bind groups. */
  get currentDir(): 0 | 1 {
    return this.dir;
  }

  cBufferAt(idx: 0 | 1): GPUBuffer {
    return this.cBuf[idx];
  }

  get muBuffer(): GPUBuffer {
    return this.muBuf;
  }

  private totalCells(): number {
    return this._dim === "3d" ? this._n * this._n * this._n : this._n * this._n;
  }

  private allocFieldBuffers(): void {
    this.cBuf?.[0]?.destroy();
    this.cBuf?.[1]?.destroy();
    this.muBuf?.destroy();
    this.readBuf?.destroy();

    const byteLen = this.totalCells() * 4;
    const usage =
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.cBuf = [
      this.device.createBuffer({ size: byteLen, usage }),
      this.device.createBuffer({ size: byteLen, usage }),
    ];
    this.muBuf = this.device.createBuffer({ size: byteLen, usage });
    this.readBuf = this.device.createBuffer({
      size: byteLen,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const mk = (src: 0 | 1, dst: 0 | 1) =>
      this.device.createBindGroup({
        layout: this.computeBGL,
        entries: [
          { binding: 0, resource: { buffer: this.ubuf } },
          { binding: 1, resource: { buffer: this.cBuf[src] } },
          { binding: 2, resource: { buffer: this.muBuf } },
          { binding: 3, resource: { buffer: this.cBuf[dst] } },
        ],
      });
    this.bg = [mk(0, 1), mk(1, 0)];
  }

  setParams(patch: Partial<SpinodalParams>): void {
    const next: SpinodalParams = { ...this.params, ...patch };
    next.c0 = Math.max(0.15, Math.min(0.85, Number.isFinite(next.c0) ? next.c0 : 0.5));
    next.kappa = Math.max(0.25, Math.min(10, Number.isFinite(next.kappa) ? next.kappa : 2.0));
    next.mobility = Math.max(0.5, Math.min(25, Number.isFinite(next.mobility) ? next.mobility : 5.0));
    next.n2d = Math.max(64, Math.min(256, Math.round(Number.isFinite(next.n2d) ? next.n2d : 200)));
    next.n3d = Math.max(32, Math.min(96, Math.round(Number.isFinite(next.n3d) ? next.n3d : 64)));
    this.params = next;

    const preset = SPINODAL_PRESETS[this.params.preset] ?? SPINODAL_PRESETS.pfhub1;
    this._dx = (this._dim === "3d" ? preset.domain3d : preset.domain2d) / this._n;
    this._dt = chooseSpinodalDt(this._dx, this.params.kappa, this.params.mobility, this._dim, preset);
    this.writeUniforms();
  }

  private writeUniforms(): void {
    const preset = SPINODAL_PRESETS[this.params.preset] ?? SPINODAL_PRESETS.pfhub1;
    const halfSpan = 0.5 * (preset.cBeta - preset.cAlpha);
    const u = new Uint32Array(this.udata);
    const f = new Float32Array(this.udata);
    if (this._dim === "3d") {
      u[0] = this._n;
      u[1] = this._n * this._n;
    } else {
      u[0] = this._n;
      u[1] = this._n;
    }
    u[2] = 0;
    u[3] = 0;
    f[4] = 1 / (6 * this._dx * this._dx);
    f[5] = this._dt * this.params.mobility;
    f[6] = this.params.kappa;
    f[7] = preset.rhoS;
    // GPU buffer stores centered u = c - cMid in [-halfSpan, +halfSpan] so both
    // equilibrium wells share the exact same IEEE-754 f32 exponent (cuts 300k-step mass drift ~800x!).
    f[8] = -halfSpan;
    f[9] = halfSpan;
    f[10] = 0;
    f[11] = 0;
    this.device.queue.writeBuffer(this.ubuf, 0, this.udata);
  }

  reset(params?: Partial<SpinodalParams>): void {
    if (this.disposed) return;
    if (params) this.params = { ...this.params, ...params };
    const nextDim = this.params.dim;
    const nextN = nextDim === "3d" ? this.params.n3d : this.params.n2d;
    const needRealloc = nextDim !== this._dim || nextN !== this._n;
    this._dim = nextDim;
    this._n = nextN;
    if (needRealloc) this.allocFieldBuffers();

    this.setParams(this.params);
    const preset = SPINODAL_PRESETS[this.params.preset] ?? SPINODAL_PRESETS.pfhub1;
    const cMid = 0.5 * (preset.cAlpha + preset.cBeta);

    let init: Float32Array;
    if (preset.deterministic) {
      init =
        this._dim === "3d"
          ? pfhubB1Init3D(this._n, this._n, this._n, preset.domain3d, this.params.c0, preset.eps)
          : pfhubB1Init2D(this._n, this._n, preset.domain2d, this.params.c0, preset.eps);
    } else {
      const seed = (this.seedCounter + (this._dim === "3d" ? 7919 : 0) + this.params.preset.charCodeAt(0) * 97) >>> 0;
      init = buildSeededNoiseInit(this.totalCells(), this.params.c0, preset.eps, seed);
    }

    const centered = new Float32Array(init.length);
    for (let i = 0; i < init.length; i++) centered[i] = init[i] - cMid;

    this.device.queue.writeBuffer(this.cBuf[0], 0, centered.buffer);
    this.device.queue.writeBuffer(this.cBuf[1], 0, centered.buffer);
    this.dir = 0;
    this.stepCount = 0;
    this.simTime = 0;

    // Seed muBuf immediately so lens 1 (chem mu) is valid on frame 0
    this.writeUniforms();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    if (this._dim === "3d") {
      const wg = Math.ceil(this._n / 4);
      pass.setPipeline(this.pipeMu3d);
      pass.setBindGroup(0, this.bg[0]);
      pass.dispatchWorkgroups(wg, wg, wg);
    } else {
      const wg = Math.ceil(this._n / 16);
      pass.setPipeline(this.pipeMu2d);
      pass.setBindGroup(0, this.bg[0]);
      pass.dispatchWorkgroups(wg, wg);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);

    const m0 =
      this._dim === "3d"
        ? measureSpinodal3D(init, this._n, this._n, this._n, this._dx, this.params.kappa, preset.cAlpha, preset.cBeta, preset.rhoS)
        : measureSpinodal2D(init, this._n, this._n, this._dx, this.params.kappa, preset.cAlpha, preset.cBeta, preset.rhoS);
    this.initMeanC = m0.meanC;
    this._history = [
      {
        t: 0,
        F: m0.F,
        chemF: m0.chemF,
        gradF: m0.gradF,
        L: m0.L,
        meanC: m0.meanC,
        minC: m0.minC,
        maxC: m0.maxC,
      },
    ];
    this.lastStats = {
      dim: this._dim,
      step: 0,
      simTime: 0,
      freeEnergy: m0.F,
      chemEnergy: m0.chemF,
      gradEnergy: m0.gradF,
      meanC: m0.meanC,
      minC: m0.minC,
      maxC: m0.maxC,
      domainL: m0.L,
      lswSlope: null,
      massDrift: 0,
      valid: m0.valid,
    };
  }

  step(substeps?: number): void {
    if (this.disposed) return;
    const defSteps = this._dim === "3d" ? 24 : 120;
    const count = Math.max(1, Math.min(2048, Math.round(substeps ?? defSteps)));
    this.writeUniforms();

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    if (this._dim === "3d") {
      const wg = Math.ceil(this._n / 4);
      for (let s = 0; s < count; s++) {
        pass.setPipeline(this.pipeMu3d);
        pass.setBindGroup(0, this.bg[this.dir]);
        pass.dispatchWorkgroups(wg, wg, wg);
        pass.setPipeline(this.pipeStep3d);
        pass.setBindGroup(0, this.bg[this.dir]);
        pass.dispatchWorkgroups(wg, wg, wg);
        this.dir = (1 - this.dir) as 0 | 1;
      }
    } else {
      const wg = Math.ceil(this._n / 16);
      for (let s = 0; s < count; s++) {
        pass.setPipeline(this.pipeMu2d);
        pass.setBindGroup(0, this.bg[this.dir]);
        pass.dispatchWorkgroups(wg, wg);
        pass.setPipeline(this.pipeStep2d);
        pass.setBindGroup(0, this.bg[this.dir]);
        pass.dispatchWorkgroups(wg, wg);
        this.dir = (1 - this.dir) as 0 | 1;
      }
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);

    this.stepCount += count;
    this.simTime += count * this._dt;
  }

  async readDiagnostics(): Promise<SpinodalStats> {
    if (this.disposed || this.reading) {
      return this.lastStats ?? this.emptyStats();
    }
    this.reading = true;
    try {
      const byteLen = this.totalCells() * 4;
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.cBuf[this.dir], 0, this.readBuf, 0, byteLen);
      this.device.queue.submit([enc.finish()]);

      await this.readBuf.mapAsync(GPUMapMode.READ);
      const view = new Float32Array(this.readBuf.getMappedRange());
      const preset = SPINODAL_PRESETS[this.params.preset] ?? SPINODAL_PRESETS.pfhub1;
      const cMid = 0.5 * (preset.cAlpha + preset.cBeta);
      const copy = new Float32Array(view.length);
      for (let i = 0; i < view.length; i++) copy[i] = view[i] + cMid;
      this.readBuf.unmap();
      const m =
        this._dim === "3d"
          ? measureSpinodal3D(copy, this._n, this._n, this._n, this._dx, this.params.kappa, preset.cAlpha, preset.cBeta, preset.rhoS)
          : measureSpinodal2D(copy, this._n, this._n, this._dx, this.params.kappa, preset.cAlpha, preset.cBeta, preset.rhoS);

      const sample: SpinodalSample = {
        t: this.simTime,
        F: m.F,
        chemF: m.chemF,
        gradF: m.gradF,
        L: m.L,
        meanC: m.meanC,
        minC: m.minC,
        maxC: m.maxC,
      };
      const prev = this._history[this._history.length - 1];
      if (!prev || sample.t > prev.t + 1e-9) {
        this._history.push(sample);
        if (this._history.length > 2000) this._history.shift();
      } else {
        this._history[this._history.length - 1] = sample;
      }

      const lswSlope = fitLswSlope(this._history);
      const stats: SpinodalStats = {
        dim: this._dim,
        step: this.stepCount,
        simTime: this.simTime,
        freeEnergy: m.F,
        chemEnergy: m.chemF,
        gradEnergy: m.gradF,
        meanC: m.meanC,
        minC: m.minC,
        maxC: m.maxC,
        domainL: m.L,
        lswSlope,
        massDrift: m.meanC - this.initMeanC,
        valid: m.valid,
      };
      this.lastStats = stats;
      return stats;
    } finally {
      this.reading = false;
    }
  }

  private emptyStats(): SpinodalStats {
    return {
      dim: this._dim,
      step: this.stepCount,
      simTime: this.simTime,
      freeEnergy: 0,
      chemEnergy: 0,
      gradEnergy: 0,
      meanC: this.initMeanC,
      minC: this.initMeanC,
      maxC: this.initMeanC,
      domainL: 0,
      lswSlope: null,
      massDrift: 0,
      valid: true,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cBuf[0].destroy();
    this.cBuf[1].destroy();
    this.muBuf.destroy();
    this.readBuf.destroy();
    this.ubuf.destroy();
  }
}

// ------------------------------------------------ WebGPU 2D/3D renderer

const HOME_AZ = -0.78;
const HOME_EL = 0.46;
const CAM_DIST = 2.05;

export class SpinodalRenderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private pipe2d: GPURenderPipeline;
  private pipe3d: GPURenderPipeline;
  private r2buf: GPUBuffer;
  private r3buf: GPUBuffer;
  private r2data = new ArrayBuffer(32);
  private r3data = new ArrayBuffer(96);
  private bg2d: [GPUBindGroup, GPUBindGroup] | null = null;
  private bg3d: [GPUBindGroup, GPUBindGroup] | null = null;
  private boundDim: SpinodalDim = "2d";
  private disposed = false;

  lens: SpinodalLens = 0;
  private az = HOME_AZ;
  private el = HOME_EL;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, sim: SpinodalSim) {
    this.device = device;
    this.canvas = canvas;
    this.ctx = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format, alphaMode: "opaque" });

    const mod2d = device.createShaderModule({ code: SPINODAL_RENDER_2D_WGSL });
    this.pipe2d = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: mod2d, entryPoint: "vmain" },
      fragment: { module: mod2d, entryPoint: "fmain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    const mod3d = device.createShaderModule({ code: SPINODAL_RENDER_3D_WGSL });
    this.pipe3d = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: mod3d, entryPoint: "vmain" },
      fragment: { module: mod3d, entryPoint: "fmain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    this.r2buf = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.r3buf = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.lens = sim.params.lens;
    this.rebind(sim);
  }

  orbitBy(dx: number, dy: number): void {
    this.az -= dx * 0.008;
    this.el = Math.max(-1.35, Math.min(1.35, this.el + dy * 0.008));
  }

  resetView(): void {
    this.az = HOME_AZ;
    this.el = HOME_EL;
  }

  rebind(sim: SpinodalSim): void {
    if (this.disposed) return;
    this.boundDim = sim.dim;
    if (sim.dim === "3d") {
      const layout = this.pipe3d.getBindGroupLayout(0);
      const mk = (d: 0 | 1) =>
        this.device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: this.r3buf } },
            { binding: 1, resource: { buffer: sim.cBufferAt(d) } },
          ],
        });
      this.bg3d = [mk(0), mk(1)];
      this.bg2d = null;
    } else {
      const layout = this.pipe2d.getBindGroupLayout(0);
      const mk = (d: 0 | 1) =>
        this.device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: this.r2buf } },
            { binding: 1, resource: { buffer: sim.cBufferAt(d) } },
            { binding: 2, resource: { buffer: sim.muBuffer } },
          ],
        });
      this.bg2d = [mk(0), mk(1)];
      this.bg3d = null;
    }
  }

  render(sim: SpinodalSim): void {
    if (this.disposed) return;
    if (sim.dim !== this.boundDim) this.rebind(sim);

    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const preset = SPINODAL_PRESETS[sim.params.preset] ?? SPINODAL_PRESETS.pfhub1;
    const halfSpan = 0.5 * (preset.cBeta - preset.cAlpha);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0.04, g: 0.045, b: 0.055, a: 1 },
          storeOp: "store",
        },
      ],
    });

    if (sim.dim === "3d" && this.bg3d) {
      // Center the 3D sponge cleanly in the unobstructed canvas left of #rail (or full screen when hidden)
      let ndcOffX = 0;
      let ndcOffY = 0;
      const camDist = CAM_DIST;
      if (typeof document !== "undefined") {
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        if (cw > 0 && ch > 0) {
          const railEl = document.getElementById("rail");
          const cramped = document.body.classList.contains("railCramped");
          const railVisible = !!railEl && !railEl.classList.contains("hidden") && !cramped;
          const railW = railVisible ? railEl.getBoundingClientRect().width : 0;
          const cxCss = railW > 0 ? (cw - railW) * 0.5 : cw * 0.5;
          const cyCss = railW > 0 ? ch * 0.52 : ch * 0.5;
          ndcOffX = 2 * (cxCss / cw) - 1;
          ndcOffY = 1 - 2 * (cyCss / ch);
        }
      }

      const ce = Math.cos(this.el);
      const se = Math.sin(this.el);
      const ca = Math.cos(this.az);
      const sa = Math.sin(this.az);
      // Camera orbiting [0.5, 0.5, 0.5] in z-up voxel space
      const roX = 0.5 + camDist * ce * ca;
      const roY = 0.5 + camDist * ce * sa;
      const roZ = 0.5 + camDist * se;

      const fx = 0.5 - roX;
      const fy = 0.5 - roY;
      const fz = 0.5 - roZ;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const fwdX = fx / fl;
      const fwdY = fy / fl;
      const fwdZ = fz / fl;

      // right = normalize(cross(fwd, worldUp(0, 0, 1)))
      let rx = fwdY;
      let ry = -fwdX;
      const rz = 0;
      const rl = Math.hypot(rx, ry) || 1;
      rx /= rl;
      ry /= rl;

      // up = cross(right, fwd)
      const ux = ry * fwdZ - rz * fwdY;
      const uy = rz * fwdX - rx * fwdZ;
      const uz = rx * fwdY - ry * fwdX;

      const u = new Uint32Array(this.r3data);
      const f = new Float32Array(this.r3data);
      u[0] = this.lens;
      u[1] = sim.n;
      u[2] = 0;
      u[3] = 0;
      f[4] = this.canvas.width;
      f[5] = this.canvas.height;
      f[6] = -halfSpan;
      f[7] = halfSpan;
      f[8] = roX;
      f[9] = roY;
      f[10] = roZ;
      f[11] = ndcOffX;
      f[12] = rx;
      f[13] = ry;
      f[14] = rz;
      f[15] = ndcOffY;
      f[16] = ux;
      f[17] = uy;
      f[18] = uz;
      f[19] = 0;
      f[20] = fwdX;
      f[21] = fwdY;
      f[22] = fwdZ;
      f[23] = 0;
      this.device.queue.writeBuffer(this.r3buf, 0, this.r3data);

      pass.setPipeline(this.pipe3d);
      pass.setBindGroup(0, this.bg3d[sim.currentDir]);
      pass.draw(3);
    } else if (this.bg2d) {
      const u = new Uint32Array(this.r2data);
      const f = new Float32Array(this.r2data);
      u[0] = this.lens;
      u[1] = sim.n;
      u[2] = sim.n;
      u[3] = 0;
      f[4] = this.canvas.width;
      f[5] = this.canvas.height;
      f[6] = -halfSpan;
      f[7] = halfSpan;
      this.device.queue.writeBuffer(this.r2buf, 0, this.r2data);

      pass.setPipeline(this.pipe2d);
      pass.setBindGroup(0, this.bg2d[sim.currentDir]);
      pass.draw(3);
    }

    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.r2buf.destroy();
    this.r3buf.destroy();
  }
}

/** Pure dimensionless unit bridge helper for spinodal plots and CSV exports. */
export function spinodalPlotBridge(presetLabel: string): Bridge {
  const units = new Units(
    scaleOf({
      si: null,
      n: 200,
      dx: 1,
      latent: 1,
      dSol: 1,
      alloy: false,
      umPerCell: 1,
    }),
    null,
  );
  return bridgeOf(units, presetLabel);
}
