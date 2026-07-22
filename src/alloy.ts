import type { PhysParams } from "./sim";
import { MATERIALS } from "./materials";

// Alloy composer chemistry: approximate textbook dilute-limit binary
// coefficients (liquidus slope m in K/wt%, equilibrium partition k), Kurz &
// Fisher-style. In the dilute limit liquidus effects superpose:
//   dT_L = sum(m_i c_i)                (liquidus shift)
//   Q    = sum(m_i c_i (k_i - 1))      (growth restriction factor)
// and the mix maps onto an equivalent pseudo-binary for the one solute field
// the model carries: k_eff is the m_i*c_i-weighted mean partition.
//
// The kelvin-per-unit conversion is the base metal's OWN scale, from units.ts.
// It used to be a hardcoded, material-independent 100 K per unit, which
// contradicted the solver: the heat equation's latent coupling makes that number
// (L/c_p)/K, and for aluminium that is ~249 K. Every composed aluminium alloy was
// therefore carrying about 2.5x too much liquidus depression, and the error was a
// different size for every base metal.

export interface Solute {
  m: number;      // liquidus slope, K per wt% (negative = depression)
  k: number;      // partition coefficient (k>1 = peritectic, enriches solid)
  dRel: number;   // liquid diffusivity relative to the model default
  mass: number;   // atomic mass, g/mol
  cap: number;    // slider max, wt%
  note?: string;
}

export interface AlloyBase {
  symbol: string;
  label: string;
  materialKey: string;  // ties into MATERIALS for symmetry + melt glow
  mass: number;
  solutes: Record<string, Solute>;
}

export const BASES: Record<string, AlloyBase> = {
  al: {
    symbol: "Al", label: "aluminum", materialKey: "al", mass: 26.98,
    solutes: {
      Cu: { m: -3.4, k: 0.15, dRel: 1.0, mass: 63.55, cap: 10 },
      Si: { m: -6.6, k: 0.12, dRel: 1.1, mass: 28.09, cap: 12 },
      Mg: { m: -6.2, k: 0.51, dRel: 1.0, mass: 24.31, cap: 10 },
      Zn: { m: -1.6, k: 0.44, dRel: 1.0, mass: 65.38, cap: 10 },
      Fe: { m: -3.0, k: 0.03, dRel: 0.8, mass: 55.85, cap: 2, note: "impurity — nearly all rejected" },
      Ti: { m: 30.7, k: 9.0, dRel: 0.7, mass: 47.87, cap: 0.5, note: "grain refiner: tiny additions, huge Q" },
    },
  },
  fe: {
    symbol: "Fe", label: "iron / steel", materialKey: "steel", mass: 55.85,
    solutes: {
      C:  { m: -78, k: 0.17, dRel: 4.0, mass: 12.01, cap: 2, note: "interstitial — dominates everything" },
      Mn: { m: -4.9, k: 0.76, dRel: 0.9, mass: 54.94, cap: 10 },
      Si: { m: -7.6, k: 0.52, dRel: 1.0, mass: 28.09, cap: 5 },
      Ni: { m: -4.7, k: 0.83, dRel: 0.9, mass: 58.69, cap: 10 },
      Cr: { m: -1.0, k: 0.95, dRel: 0.9, mass: 52.0, cap: 10, note: "barely segregates" },
      Mo: { m: -2.6, k: 0.8, dRel: 0.8, mass: 95.95, cap: 5 },
    },
  },
  ni: {
    symbol: "Ni", label: "nickel", materialKey: "ni", mass: 58.69,
    solutes: {
      Nb: { m: -10.5, k: 0.48, dRel: 0.8, mass: 92.91, cap: 6, note: "the IN718 segregator — freckles, Laves" },
      Ti: { m: -16.7, k: 0.6, dRel: 0.9, mass: 47.87, cap: 5 },
      Al: { m: -5.0, k: 0.87, dRel: 1.0, mass: 26.98, cap: 6 },
      Cr: { m: -1.5, k: 1.0, dRel: 0.9, mass: 52.0, cap: 10, note: "k ≈ 1: no segregation" },
      Mo: { m: -3.3, k: 0.8, dRel: 0.8, mass: 95.95, cap: 6 },
      W:  { m: 1.0, k: 1.3, dRel: 0.7, mass: 183.84, cap: 6, note: "k > 1: enriches the dendrite core" },
    },
  },
  mg: {
    symbol: "Mg", label: "magnesium", materialKey: "mg", mass: 24.31,
    solutes: {
      Al: { m: -6.9, k: 0.37, dRel: 1.0, mass: 26.98, cap: 10 },
      Zn: { m: -6.0, k: 0.12, dRel: 1.0, mass: 65.38, cap: 6 },
      Zr: { m: 6.9, k: 6.5, dRel: 0.7, mass: 91.22, cap: 0.8, note: "grain refiner (peritectic)" },
    },
  },
  cu: {
    symbol: "Cu", label: "copper", materialKey: "cu", mass: 63.55,
    solutes: {
      Sn: { m: -7.4, k: 0.16, dRel: 0.9, mass: 118.71, cap: 10, note: "bronze" },
      Zn: { m: -4.0, k: 0.86, dRel: 1.0, mass: 65.38, cap: 12, note: "brass" },
      Ni: { m: 3.8, k: 1.35, dRel: 0.9, mass: 58.69, cap: 10, note: "isomorphous — raises the liquidus" },
    },
  },
  zn: {
    symbol: "Zn", label: "zinc", materialKey: "zn", mass: 65.38,
    solutes: {
      Al: { m: -4.9, k: 0.1, dRel: 1.0, mass: 26.98, cap: 5, note: "galvanizing baths carry ~0.2 %" },
    },
  },
};

export interface Mix { base: string; wt: Record<string, number> }

export const FAMOUS: { label: string; mix: Mix }[] = [
  { label: "A356", mix: { base: "al", wt: { Si: 7, Mg: 0.35 } } },
  { label: "A356+TiB", mix: { base: "al", wt: { Si: 7, Mg: 0.35, Ti: 0.12 } } },
  { label: "AA2024", mix: { base: "al", wt: { Cu: 4.4, Mg: 1.5 } } },
  { label: "1045 steel", mix: { base: "fe", wt: { C: 0.45, Mn: 0.75, Si: 0.25 } } },
  { label: "4340 steel", mix: { base: "fe", wt: { C: 0.4, Mn: 0.7, Ni: 1.8, Cr: 0.8, Mo: 0.25 } } },
  { label: "IN718 (lite)", mix: { base: "ni", wt: { Nb: 5.1, Mo: 3.0, Ti: 0.9, Al: 0.5 } } },
  { label: "AZ91", mix: { base: "mg", wt: { Al: 9, Zn: 0.7 } } },
  { label: "tin bronze", mix: { base: "cu", wt: { Sn: 8 } } },
  { label: "galv. bath", mix: { base: "zn", wt: { Al: 0.2 } } },
];

/**
 * Kelvin per dimensionless temperature unit for a base metal — the solver's own
 * factor, (L/c_p)/K, not a constant. Falls back to 100 only if a base ever ships
 * without SI properties, which none currently do.
 */
function tScaleFor(base: AlloyBase): number {
  const mat = MATERIALS[base.materialKey];
  const si = mat?.si;
  const latent = mat?.params.latent;
  return si && latent ? (si.L / si.cp) / latent : 100;
}
/**
 * wt% total solute mapping to c0 = 1. Exported because the quantitative
 * calibration needs the inverse: it reads a real c∞ in wt% out of the model's
 * dimensionless c0 to build the freezing range ΔT₀ = |m|c∞(1−k)/k.
 */
export const WT_PER_C0 = 15;
const DEPR_CAP = 0.22; // max dimensionless liquidus depression (keeps growth watchable)

export interface Derived {
  name: string;
  totalWt: number;
  dTL: number;          // liquidus shift, K (negative = depression)
  Q: number;            // growth restriction factor, K
  atPct: Record<string, number>;
  params: Partial<PhysParams>;   // c0, mLiq, kPart, dSol (+ alloyOn)
  clamps: string[];
}

export function derive(mix: Mix): Derived {
  const base = BASES[mix.base];
  const entries = Object.entries(mix.wt).filter(([el, w]) => w > 0 && base.solutes[el]);
  const totalWt = entries.reduce((s, [, w]) => s + w, 0);

  let dTL = 0, Q = 0, dSum = 0;
  for (const [el, w] of entries) {
    const s = base.solutes[el];
    dTL += s.m * w;
    Q += s.m * w * (s.k - 1);
    dSum += s.dRel * w;
  }

  // at% via atomic masses (base included)
  const molBase = (100 - totalWt) / base.mass;
  const molAll = entries.reduce((s, [el, w]) => s + w / base.solutes[el].mass, molBase);
  const atPct: Record<string, number> = {};
  for (const [el, w] of entries) atPct[el] = (w / base.solutes[el].mass / molAll) * 100;

  const clamps: string[] = [];
  const depression = Math.max(0, -dTL);
  if (dTL > 0.5) clamps.push("liquidus raised (peritectic-dominated) — model runs it as a weak depressant");

  const c0raw = totalWt / WT_PER_C0;
  const c0 = Math.min(0.7, Math.max(0.05, c0raw));
  if (c0raw > 0.7) clamps.push("composition saturates the model solute field");

  const deprDim = depression / tScaleFor(base);
  if (deprDim > DEPR_CAP) clamps.push("strong alloy — model depression capped so growth stays watchable");
  const mRaw = Math.min(deprDim, DEPR_CAP) / c0;
  const mLiq = Math.min(0.8, Math.max(0.1, mRaw));

  const kRaw = depression > 1e-6 ? 1 - Q / depression : 0.9;
  const kPart = Math.min(0.9, Math.max(0.12, kRaw));
  if (kRaw < 0.12) clamps.push("Q saturates the model (k floored) — refinement still shows");

  const dSol = Math.min(1.5, Math.max(0.2, 0.8 * (totalWt > 0 ? dSum / totalWt : 1)));

  const name = base.symbol + entries
    .sort((a, b) => b[1] - a[1])
    .map(([el, w]) => `–${w < 1 ? w.toFixed(2).replace(/0$/, "") : w.toFixed(1)}${el}`)
    .join("");

  return {
    name, totalWt, dTL, Q, atPct, clamps,
    params: { alloyOn: totalWt > 0 ? 1 : 0, c0, mLiq, kPart, dSol },
  };
}

// -------- shareable hash: #alloy=al:Si7,Mg0.35 ----------------------------
export function encodeMix(mix: Mix): string {
  const parts = Object.entries(mix.wt).filter(([, w]) => w > 0)
    .map(([el, w]) => `${el}${+w.toFixed(3)}`);
  return `alloy=${mix.base}:${parts.join(",")}`;
}

export function decodeMix(hash: string): Mix | null {
  const m = /alloy=([a-z]+):([A-Za-z0-9.,]*)/.exec(hash);
  if (!m || !BASES[m[1]]) return null;
  const wt: Record<string, number> = {};
  for (const p of m[2].split(",")) {
    const pm = /^([A-Z][a-z]?)([\d.]+)$/.exec(p);
    if (!pm) continue;
    const s = BASES[m[1]].solutes[pm[1]];
    if (!s) continue;
    wt[pm[1]] = Math.min(s.cap, Math.max(0, parseFloat(pm[2])));
  }
  return { base: m[1], wt };
}
