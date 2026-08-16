import type { PhysParams } from "./sim";
import { MATERIALS } from "./materials";
import { BINARY, type BinaryRow } from "./phasedata";

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
  /**
   * Where this pair's m and k come from, and how they stand against the
   * invariant chord reconstructed from the same pair's row in phasedata.ts.
   * Two tables, one physics: PD-SOLUTE-SOURCED requires every pair to carry
   * this, and requires the set of sources to be genuinely distinct.
   */
  source: string;
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
      Cu: {
        m: -3.4, k: 0.17, dRel: 1.0, mass: 63.55, cap: 10,
        source: "Dilute-limit binary coefficients for Cu in Al, from the Kurz & Fisher-style textbook compilation this table was built on. k was 0.15 in this table and 0.17 in materials.ts si.kPart for the same physical system; reconciled to 0.17, which is what the invariant chord independently reconstructs. The retired value was 0.15. Invariant chord from this pair's phasedata.ts row reconstructs m -3.38 K/wt% and k 0.170 against the shipped -3.4 / 0.17 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Si: {
        m: -6.6, k: 0.12, dRel: 1.1, mass: 28.09, cap: 12,
        source: "Dilute-limit binary coefficients for Si in Al, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -6.62 K/wt% and k 0.131 against the shipped -6.6 / 0.12 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Mg: {
        m: -6.2, k: 0.51, dRel: 1.0, mass: 24.31, cap: 10,
        source: "Dilute-limit binary coefficients for Mg in Al, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -6.01 K/wt% and k 0.497 against the shipped -6.2 / 0.51 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Zn: {
        m: -1.6, k: 0.44, dRel: 1.0, mass: 65.38, cap: 10,
        source: "Dilute-limit binary coefficients for Zn in Al, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -2.94 K/wt% and k 0.875 against the shipped -1.6 / 0.44 — ratio 1.84 / 1.99. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
      Fe: {
        m: -3, k: 0.03, dRel: 0.8, mass: 55.85, cap: 2,
        note: "impurity — nearly all rejected",
        source: "Dilute-limit binary coefficients for Fe in Al, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -2.97 K/wt% and k 0.029 against the shipped -3 / 0.03 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Ti: {
        m: 30.7, k: 9, dRel: 0.7, mass: 47.87, cap: 0.5,
        note: "grain refiner: tiny additions, huge Q",
        source: "Dilute-limit binary coefficients for Ti in Al, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m 31.00 K/wt% and k 8.800 against the shipped 30.7 / 9 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
    },
  },
  fe: {
    symbol: "Fe", label: "iron / steel", materialKey: "steel", mass: 55.85,
    solutes: {
      C: {
        m: -78, k: 0.17, dRel: 4.0, mass: 12.01, cap: 2,
        note: "interstitial — dominates everything",
        source: "Dilute-limit binary coefficients for C in Fe, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -81.13 K/wt% and k 0.170 against the shipped -78 / 0.17 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Mn: {
        m: -4.9, k: 0.76, dRel: 0.9, mass: 54.94, cap: 10,
        source: "Dilute-limit binary coefficients for Mn in Fe, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -5.28 K/wt% and k 0.724 against the shipped -4.9 / 0.76 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Si: {
        m: -7.6, k: 0.52, dRel: 1.0, mass: 28.09, cap: 5,
        source: "Dilute-limit binary coefficients for Si in Fe, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -17.60 K/wt% and k 0.927 against the shipped -7.6 / 0.52 — ratio 2.32 / 1.78. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
      Ni: {
        m: -4.7, k: 0.83, dRel: 0.9, mass: 58.69, cap: 10,
        source: "Dilute-limit binary coefficients for Ni in Fe, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -1.69 K/wt% and k 0.322 against the shipped -4.7 / 0.83 — ratio 0.36 / 0.39. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
      Cr: {
        m: -1, k: 0.95, dRel: 0.9, mass: 52.0, cap: 10,
        note: "barely segregates",
        source: "Dilute-limit binary coefficients for Cr in Fe, from the Kurz & Fisher-style textbook compilation this table was built on. This system is isomorphous — no invariant, so there is no chord to check the coefficient against. Chromium barely segregates in iron (k 0.95, m −1 K/wt%), which is why a ferritic stainless freezes over almost no range at all. A P0-era version of this sentence ended 'k > 1 here because the solute raises the liquidus' — that clause belongs to Cu–Ni and is false here on both halves: this k is 0.95 and this m is negative. Corrected in v7.1 P1.",
      },
      Mo: {
        m: -2.6, k: 0.8, dRel: 0.8, mass: 95.95, cap: 5,
        source: "Dilute-limit binary coefficients for Mo in Fe, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -2.42 K/wt% and k 0.956 against the shipped -2.6 / 0.8 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
    },
  },
  ni: {
    symbol: "Ni", label: "nickel", materialKey: "ni", mass: 58.69,
    solutes: {
      Nb: {
        m: -10.5, k: 0.48, dRel: 0.8, mass: 92.91, cap: 6,
        note: "the IN718 segregator — freckles, Laves",
        source: "Dilute-limit binary coefficients for Nb in Ni, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -8.01 K/wt% and k 0.847 against the shipped -10.5 / 0.48 — ratio 0.76 / 1.77. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
      Ti: {
        m: -16.7, k: 0.6, dRel: 0.9, mass: 47.87, cap: 5,
        source: "Dilute-limit binary coefficients for Ti in Ni, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -10.94 K/wt% and k 0.826 against the shipped -16.7 / 0.6 — ratio 0.66 / 1.38. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
      Al: {
        m: -5, k: 0.87, dRel: 1.0, mass: 26.98, cap: 6,
        source: "Dilute-limit binary coefficients for Al in Ni, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -6.03 K/wt% and k 0.856 against the shipped -5 / 0.87 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Cr: {
        m: -1.5, k: 1, dRel: 0.9, mass: 52.0, cap: 10,
        note: "k ≈ 1: no segregation",
        source: "Dilute-limit binary coefficients for Cr in Ni, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -2.16 K/wt% and k 0.920 against the shipped -1.5 / 1 — ratio 1.44 / 0.92. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
      Mo: {
        m: -3.3, k: 0.8, dRel: 0.8, mass: 95.95, cap: 6,
        source: "Dilute-limit binary coefficients for Mo in Ni, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -3.19 K/wt% and k 0.858 against the shipped -3.3 / 0.8 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      W: {
        m: 1, k: 1.3, dRel: 0.7, mass: 183.84, cap: 6,
        note: "k > 1: enriches the dendrite core",
        source: "Dilute-limit binary coefficients for W in Ni, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m 0.89 K/wt% and k 0.887 against the shipped 1 / 1.3 — ratio 0.89 / 0.68. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
    },
  },
  mg: {
    symbol: "Mg", label: "magnesium", materialKey: "mg", mass: 24.31,
    solutes: {
      Al: {
        m: -6.9, k: 0.37, dRel: 1.0, mass: 26.98, cap: 10,
        source: "Dilute-limit binary coefficients for Al in Mg, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -6.59 K/wt% and k 0.399 against the shipped -6.9 / 0.37 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Zn: {
        m: -6, k: 0.12, dRel: 1.0, mass: 65.38, cap: 6,
        source: "Dilute-limit binary coefficients for Zn in Mg, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -6.00 K/wt% and k 0.120 against the shipped -6 / 0.12 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Zr: {
        m: 6.9, k: 6.5, dRel: 0.7, mass: 91.22, cap: 0.8,
        note: "grain refiner (peritectic)",
        source: "Dilute-limit binary coefficients for Zr in Mg, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m 6.21 K/wt% and k 4.448 against the shipped 6.9 / 6.5 — ratio 0.90 / 0.68. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
    },
  },
  cu: {
    symbol: "Cu", label: "copper", materialKey: "cu", mass: 63.55,
    solutes: {
      Sn: {
        m: -7.4, k: 0.16, dRel: 0.9, mass: 118.71, cap: 10,
        note: "bronze",
        source: "Dilute-limit binary coefficients for Sn in Cu, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -11.25 K/wt% and k 0.528 against the shipped -7.4 / 0.16 — ratio 1.52 / 3.30. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
      Zn: {
        m: -4, k: 0.86, dRel: 1.0, mass: 65.38, cap: 12,
        note: "brass",
        source: "Dilute-limit binary coefficients for Zn in Cu, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -4.86 K/wt% and k 0.868 against the shipped -4 / 0.86 — agreement within 25 % on both, so the two tables corroborate each other here.",
      },
      Ni: {
        m: 3.8, k: 1.35, dRel: 0.9, mass: 58.69, cap: 10,
        note: "isomorphous — raises the liquidus",
        source: "Dilute-limit binary coefficients for Ni in Cu, from the Kurz & Fisher-style textbook compilation this table was built on. This system is isomorphous — no invariant, so there is no chord to check the coefficient against; k > 1 here because the solute raises the liquidus.",
      },
    },
  },
  zn: {
    symbol: "Zn", label: "zinc", materialKey: "zn", mass: 65.38,
    solutes: {
      Al: {
        m: -4.9, k: 0.1, dRel: 1.0, mass: 26.98, cap: 5,
        note: "galvanizing baths carry ~0.2 %",
        source: "Dilute-limit binary coefficients for Al in Zn, from the Kurz & Fisher-style textbook compilation this table was built on. Invariant chord from this pair's phasedata.ts row reconstructs m -7.70 K/wt% and k 0.234 against the shipped -4.9 / 0.1 — ratio 1.57 / 2.34. They are NOT expected to match: this system's invariant sits far from the dilute limit, so a chord drawn across the whole diagram is not the dilute slope. The shipped value is the dilute-limit coefficient and is what the solver integrates.",
      },
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

/**
 * How the poured mix's own reference interval was arrived at — or why it was not.
 *
 * `DILUTE` is the Karma–Rappel interval ΔT₀ = |m|c∞(1−k)/k, valid while the
 * linearised solidus it extrapolates is still a real phase boundary.
 * `ISOMORPHOUS` is the same formula where no invariant exists to bound it, and
 * `PAST-REFERENCE` is the same formula flagged as extrapolated.
 * `REGAUGED` is what replaces DILUTE once that solidus has passed below the
 * invariant isotherm — see `referenceIntervalFor` for why it is NOT the
 * truncated interval T_L − T_inv. `REFUSED` is a first-class answer, not a
 * failure: the mix is handed back with a named reason and the calibration keeps
 * the material's own numbers.
 */
export type IntervalRegime = "DILUTE" | "PAST-REFERENCE" | "ISOMORPHOUS" | "REFUSED";

export interface Derived {
  name: string;
  totalWt: number;
  dTL: number;          // liquidus shift, K (negative = depression)
  Q: number;            // growth restriction factor, K
  atPct: Record<string, number>;
  params: Partial<PhysParams>;   // c0, mLiq, kPart, dSol (+ alloyOn)
  clamps: string[];
  /**
   * The wt%-weighted mean liquidus slope, K/wt%, signed. Exactly ΔT_L/c∞, so
   * m_SI·c∞ reproduces the superposed liquidus shift by construction. This is
   * the slope of the pseudo-binary the mix collapses onto — NOT any one
   * solute's coefficient.
   */
  mSI: number;
  /**
   * The m·c-weighted mean partition coefficient, 1 − Q/depression. Null when
   * the melt has no depression to weight with (every solute raises the
   * liquidus), which is a refusal rather than a zero. It can fall outside
   * [0,1] when depressants and liquidus-raisers are mixed — that is not a bug,
   * it is the mix failing to be a pseudo-binary, and it is reported as such.
   */
  kEff: number | null;
  /** the solute carrying the largest |m·c|, i.e. the binary the mix most nearly is */
  dominant: string | null;
  /** the poured mix's own freezing range in K, or null when refused */
  dT0: number | null;
  dT0Regime: IntervalRegime;
  /** always non-empty: how ΔT₀ was built, or the named reason it was not */
  dT0Source: string;
  /**
   * Inputs this function DECLINED, each named. Empty for a clean mix. The
   * channel exists because every one of these was a silent `continue` or a
   * silent `delete` before v7.1 P1 — a composed alloy could quietly lose a
   * solute and still print a confident number.
   */
  refusals: string[];
}

const C_PER_K = 273.15;

/**
 * The poured mix's own reference interval, and the reason for it.
 *
 * THE BRANCH IS DECIDED IN TEMPERATURE, NOT IN COMPOSITION. "Is c∞ past the
 * maximum solid solubility" says the same thing in principle — the algebra
 * closes, c∞ ≤ C_SM ⟺ c∞/k ≤ C_inv — but only when the shipped dilute m and k
 * reconstruct the invariant chord, and docs/PHASE-AUDIT.md measured that they
 * do so for 12 of 22 pairs and not for the other 10. Testing the extrapolated
 * solidus TEMPERATURE against the invariant isotherm uses the same m and k the
 * solver integrates, so the branch and the arithmetic agree by construction
 * even where the two tables disagree. For Al–Si the gap is real and visible:
 * k·C_inv = 1.512 wt% against C_SM = 1.65 wt%.
 *
 * PAST THAT BOUND THERE IS NO SUBSTITUTE FORMULA, AND THIS IS THE ONE PLACE
 * THE MILESTONE PLAN WAS WRONG ON PHYSICS RATHER THAN ON ARITHMETIC.
 *
 * The plan specified the truncated interval T_L − T_inv: the primary freezes
 * from its own liquidus to the invariant and no further, so that IS the
 * freezing range. But ΔT₀ in d₀ = Γ/ΔT₀ is not a thermal quantity. Writing the
 * Gibbs–Thomson condition in the Karma–Rappel supersaturation
 * U = (c_l − c_ref)/[c_ref(1−k)] gives d₀ = Γ/[|m|(1−k)·c_ref], which collapses
 * to Γ/ΔT₀ for exactly ONE choice: c_ref = c∞/k, the steady-state planar-front
 * liquid. ΔT₀ is a composition scale wearing a temperature's clothes, and
 * substituting a different interval re-picks c_ref without renormalising U —
 * while d₀ carries on into W₀, the cell pitch and the anti-trapping magnitude.
 *
 * The obvious repair is to regauge onto the liquid the dendrite actually grows
 * into, c_ref = c∞, dropping the 1/k and leaving |m|c∞(1−k) — which is exactly
 * Q, the growth restriction factor this composer has printed since v5.
 * `shaders.ts` forecloses it. Its own comment above `uSup` states the reference
 * state as c_l⁰ = c∞/k and says why: gauging on the liquidus instead "stretches
 * the freezing range to 1/k ≈ 6 dimensionless degrees, which does not fit the
 * solver's own [−1, 2] clamp". The solver IS gauged on c∞/k. Handing it a d₀
 * built on any other reference would put a capillary length in front of a
 * supersaturation the kernel does not compute.
 *
 * So past the bound there is no replacement formula available, and the branch
 * keeps the model's own gauge while saying out loud that it is extrapolated.
 * That is `PAST-REFERENCE`: the interval is still |m|c∞(1−k)/k, because that is
 * what the kernel measures in, but c∞/k is named, the invariant it has passed
 * is named, and the alloy's REAL primary freezing range T_L − T_inv is printed
 * beside it with the ratio. For A356 that reads 303 K of model interval against
 * 35 K of real primary freezing — a factor of 8.7, stated rather than buried.
 *
 * The alternative considered and rejected was to refuse the poured coefficients
 * here and fall back to the material default. That is worse, and it is worse in
 * exactly the way this milestone exists to fix: A356's fallback is Al–4Cu's
 * 122 K, which is the same invalid gauge applied to a DIFFERENT ALLOY. A number
 * in the right gauge for the wrong alloy is not more honest than a number in an
 * extrapolated gauge for the right one. Refusal is kept for the cases where
 * there is genuinely nothing to compute.
 */
function referenceIntervalFor(
  baseKey: string, dTL: number, Q: number, totalWt: number,
  dominant: string | null, mixWt: Record<string, number>,
): { dT0: number | null; regime: IntervalRegime; source: string } {
  const base = Object.hasOwn(BASES, baseKey) ? BASES[baseKey] : undefined;
  const si = MATERIALS[base?.materialKey ?? ""]?.si;
  const R = (regime: IntervalRegime, source: string, dT0: number | null = null) =>
    ({ dT0, regime, source });

  if (totalWt <= 0) return R("REFUSED", "no solute in this melt — a pure base metal has no freezing range, and the calibration keeps the pure-melt interval L/c_p.");
  if (!base) return R("REFUSED", `no base metal named "${baseKey}" — nothing to build a freezing range from.`);
  if (!si) return R("REFUSED", `${base.label} carries no SI identity, so there is no melting point to measure a freezing range down from.`);
  if (!dominant) return R("REFUSED", "no solute dominates this melt — nothing to name a binary against.");

  const byBase = Object.hasOwn(BINARY, baseKey) ? BINARY[baseKey] : {};
  const row: BinaryRow | undefined = Object.hasOwn(byBase, dominant) ? byBase[dominant] : undefined;
  if (!row) return R("REFUSED", `no invariant row for ${base.symbol}–${dominant}, so this melt's freezing range cannot be bounded; the calibration keeps ${base.label}'s own numbers.`);

  const depression = Math.max(0, -dTL);
  const TmC = si.Tm - C_PER_K;
  const TL = TmC + dTL;
  if (depression <= 1e-6) {
    // `dominant` is the largest |m·c| term and can perfectly well be a
    // DEPRESSANT in a mix whose raisers just outweigh it, so the sentence names
    // the solute that actually raised the liquidus rather than assuming.
    let raiser: string | null = null, raiseW = 0;
    for (const [el, w] of Object.entries(mixWt)) {
      const so = Object.hasOwn(base.solutes, el) ? base.solutes[el] : undefined;
      if (!so || !(w > 0) || so.m <= 0) continue;
      if (so.m * w > raiseW) { raiseW = so.m * w; raiser = el; }
    }
    const who = raiser ?? dominant;
    return R("REFUSED", dTL > 0
      ? `${who} raises this melt's liquidus to ${TL.toFixed(1)} °C, above pure ${base.symbol}'s ${TmC.toFixed(1)} °C. A peritectic-dominated mix has no dilute freezing range and the calibrated thermometer declines to invent one.`
      : `this melt's solutes cancel to within ${depression.toExponential(1)} K of pure ${base.symbol}'s liquidus at ${TmC.toFixed(1)} °C — ${who}'s ${raiser ? "rise" : "depression"} is offset almost exactly — so there is no depression to build a freezing range on.`);
  }

  const kEff = 1 - Q / depression;
  const mSI = dTL / totalWt;
  // Q = depression·(1−k_eff) identically, so this is the same number the
  // composer prints as the growth restriction factor, recomputed from the
  // weighted means rather than re-summed.
  const gauge = Math.abs(mSI) * totalWt * (1 - kEff);

  if (!(kEff > 0 && kEff < 1)) {
    // BOTH branches need a physical k — DILUTE divides by it and REGAUGED needs
    // (1−k) to mean a partition. A mix of depressants and liquidus-raisers can
    // put the m·c-weighted mean anywhere: A356+TiB reads −0.593, and its `gauge`
    // would come out 71 K against plain A356's 42 K, so 0.12 wt% of grain
    // refiner would move the thermometer by 71 %. That is the mix failing to be
    // a pseudo-binary, and the honest answer is to say so.
    // k = 1 exactly is a different statement from k outside [0,1], and Ni–Cr
    // ships with k = 1, so the composer's "+ add element -> Cr" default reaches
    // it on the first click. Saying "outside the physical range" there would be
    // false: the partition is perfectly physical, it is the freezing range that
    // is zero-width, and ΔT₀ = |m|c(1−k)/k is 0 rather than undefined.
    if (kEff === 1) {
      return R("REFUSED", `k_eff = 1 exactly: ${dominant} does not partition between solid and liquid at all (Q = 0), so this melt's solidus and liquidus coincide and its freezing range is zero. There is no interval to measure temperature in. The calibration keeps ${base.label}'s own numbers.`);
    }
    return R("REFUSED", `k_eff = ${kEff.toFixed(3)} is outside (0,1): with ${dominant} dominant, the m·c-weighted mean partition falls outside the physical range, so this mix does not collapse onto a pseudo-binary and has no reference interval. The calibration keeps ${base.label}'s own numbers.`);
  }

  if (row.invariant === "isomorphous") {
    return R("ISOMORPHOUS", `${base.symbol}–${dominant} is isomorphous — complete solid solubility, no invariant, nothing for the solidus to terminate on — so ΔT₀ = |m|c∞(1−k)/k is valid at every composition. m_eff ${mSI.toFixed(3)} K/wt%, k_eff ${kEff.toFixed(3)}, c∞ ${totalWt.toFixed(2)} wt%.`,
    gauge / kEff);
  }

  if (row.Tinv == null) {
    return R("REFUSED", `${base.symbol}–${dominant} has an invariant of type ${row.invariant} but no temperature for it, so the dilute solidus cannot be tested against anything.`);
  }

  const TS = TmC + (mSI / kEff) * totalWt;
  if (TS >= row.Tinv) {
    return R("DILUTE", `the linearised solidus reaches ${TS.toFixed(1)} °C, still above the ${base.symbol}–${dominant} ${row.invariant} at ${row.Tinv} °C, so the solver's reference liquid c∞/k = ${(totalWt / kEff).toFixed(2)} wt% is a state this alloy actually reaches and ΔT₀ = |m|c∞(1−k)/k is a real freezing range. m_eff ${mSI.toFixed(3)} K/wt%, k_eff ${kEff.toFixed(3)}, c∞ ${totalWt.toFixed(2)} wt%, liquidus ${TL.toFixed(1)} °C.`,
    gauge / kEff);
  }

  // Past the bound. c∞/k is the supersaturation reference the WGSL kernel is
  // built on, so it is not negotiable here; what IS negotiable is whether the
  // app admits that the state it names has been left behind.
  const cRef = totalWt / kEff;
  const cInvChord = (row.Tinv - TmC) / mSI;
  const model = gauge / kEff;
  const primary = TL - row.Tinv;
  const head = `EXTRAPOLATED GAUGE — this melt is past the ${base.symbol}–${dominant} ${row.invariant} at ${row.Tinv} °C. The solver's reference liquid c∞/k = ${cRef.toFixed(1)} wt% sits beyond the invariant liquid near ${cInvChord.toFixed(1)} wt%, and the linearised solidus extrapolates to ${TS.toFixed(0)} °C, below the isotherm. ΔT₀ = |m|c∞(1−k)/k = ${model.toFixed(1)} K is still what this solver measures in, and it is built from THIS alloy's coefficients`;
  // The mix's liquidus can fall BELOW the dominant binary's invariant, and a
  // shipped preset does it: 4340's four other solutes pull the melt 13 K under
  // the Fe–C liquidus, to 1493.3 °C against a 1495 °C peritectic. There is then
  // no primary field on THIS diagram at all, and the first draft of this string
  // printed "freezes over only -1.7 K" and a ratio of 7.8e10 — a negative range
  // and a meaningless multiple. The comparison is only made when there is
  // something to compare with. (The gate that was supposed to catch this
  // asserted dT0 > primary, which 77.8 > -1.7 satisfies: a vacuous pass, fixed
  // beside this.)
  if (!(primary > 0)) {
    return R("PAST-REFERENCE", `${head} — and this melt's own liquidus, ${TL.toFixed(1)} °C, is already at or below that isotherm, because its other solutes depress it a further ${(row.Tinv - TL).toFixed(1)} K past where ${dominant} alone would put it. On this binary there is no primary freezing range left to compare against at all.`,
    model);
  }
  return R("PAST-REFERENCE", `${head} — but the primary actually freezes over only ${primary.toFixed(1)} K, from ${TL.toFixed(1)} °C to the isotherm, so the model interval is ${(model / primary).toFixed(1)}x the real one.`,
  model);
}

export function derive(mix: Mix): Derived {
  const refusals: string[] = [];
  // Object.hasOwn, not a truthiness test: `BASES.constructor` and
  // `base.solutes.toString` are inherited and TRUTHY, so a hand-built mix
  // like {constructor: 5} used to sail past every guard here and propagate
  // NaN into dTL, Q, mLiq and dSol with `refusals` left empty — the exact
  // silent drop this channel exists to close, and one ALLOY-REFUSE-NAMED
  // could not see because it only drove keys that fail the check.
  const base = Object.hasOwn(BASES, mix.base) ? BASES[mix.base] : undefined;
  if (!base) {
    // Reachable only through window.__solidify.alloy — the composer's base list
    // is closed and decodeMix rejects an unknown base outright. It threw here
    // before v7.1 P1, one line before the filter that names every other drop.
    return {
      name: "?", totalWt: 0, dTL: 0, Q: 0, atPct: {}, clamps: [],
      mSI: 0, kEff: null, dominant: null, dT0: null, dT0Regime: "REFUSED",
      dT0Source: `no base metal named "${mix.base}" — the composer ships ${Object.keys(BASES).join(", ")}.`,
      refusals: [`base "${mix.base}" is not a base metal this composer carries — nothing was poured`],
      params: { alloyOn: 0 },
    };
  }
  const entries = Object.entries(mix.wt).filter(([el, w]) => {
    if (!Object.hasOwn(base.solutes, el)) {
      // a zero-weight unknown key lost nothing, so there is nothing to report
      if (w > 0) refusals.push(`${el} is not a solute this model carries in ${base.label} — dropped from the melt, and none of the numbers below include it`);
      return false;
    }
    if (!Number.isFinite(w)) {
      refusals.push(`${el} was handed a weight that is not a number — dropped rather than propagated as NaN through every readout`);
      return false;
    }
    if (w < 0) {
      refusals.push(`${el} was handed a negative weight (${w} wt%) — dropped; a melt cannot contain less than none of something`);
      return false;
    }
    if (w > 100) {
      // A weight PERCENT cannot exceed 100, and the failure past it is not
      // graceful: 1e308 wt% overflows the m·c sums to ±Infinity, k_eff comes
      // out NaN, and the NaN reaches the params bundle and the refusal string
      // alike. It also closes the mole-balance hole one block down, where
      // molBase = (100 − totalWt)/mass goes negative past 100 wt% with no guard.
      refusals.push(`${el} was handed ${w} wt% — dropped; a weight percent cannot exceed 100`);
      return false;
    }
    return w > 0;
  });
  const totalWt = entries.reduce((s, [, w]) => s + w, 0);

  let dTL = 0, Q = 0, dSum = 0;
  for (const [el, w] of entries) {
    const s = base.solutes[el];
    dTL += s.m * w;
    Q += s.m * w * (s.k - 1);
    dSum += s.dRel * w;
  }

  // at% via atomic masses (base included)
  // Individually capped at 100 above, but a SUM can still pass 100 and take the
  // mole balance negative. The excess is named and the whole mix is treated as
  // pure base, because there is no defensible way to decide which solute to
  // trim.
  if (totalWt > 100) {
    refusals.push(`this mix totals ${totalWt.toFixed(1)} wt% of solute — dropped whole; there is no base metal left to dissolve it in, and no defensible way to choose which addition to trim`);
    return {
      name: base.symbol, totalWt: 0, dTL: 0, Q: 0, atPct: {}, clamps: [],
      mSI: 0, kEff: null, dominant: null, dT0: null, dT0Regime: "REFUSED",
      dT0Source: `this mix totals ${totalWt.toFixed(1)} wt% of solute, which is not a composition; nothing was derived from it.`,
      refusals, params: { alloyOn: 0 },
    };
  }

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

  // the binary this mix most nearly IS: the solute carrying the largest |m·c|
  let dominant: string | null = null, domW = -1;
  for (const [el, w] of entries) {
    const contrib = Math.abs(base.solutes[el].m * w);
    if (contrib > domW) { domW = contrib; dominant = el; }
  }

  const mSI = totalWt > 0 ? dTL / totalWt : 0;
  const kEff = depression > 1e-6 ? 1 - Q / depression : null;
  const iv = referenceIntervalFor(mix.base, dTL, Q, totalWt, dominant, mix.wt);

  return {
    name, totalWt, dTL, Q, atPct, clamps, refusals,
    mSI, kEff, dominant,
    dT0: iv.dT0, dT0Regime: iv.regime, dT0Source: iv.source,
    params: { alloyOn: totalWt > 0 ? 1 : 0, c0, mLiq, kPart, dSol },
  };
}

// -------- shareable hash: #alloy=al:Si7,Mg0.35 ----------------------------
export function encodeMix(mix: Mix): string {
  const parts = Object.entries(mix.wt).filter(([, w]) => w > 0)
    .map(([el, w]) => `${el}${+w.toFixed(3)}`);
  return `alloy=${mix.base}:${parts.join(",")}`;
}

/**
 * Restore a shared mix. `refusals` is an optional sink: pass one and every
 * token this decoder declines is named into it. Both drops used to be bare
 * `continue`s, so `#alloy=al:Si7,Xx3` restored as plain Al–7Si and printed a
 * confident derived readout for an alloy the link did not describe.
 *
 * The empty-token case is deliberately NOT a refusal: the hash grammar allows
 * an empty solute list, so `#alloy=al:` and a trailing comma are syntactically
 * fine and lose nothing.
 */
export function decodeMix(hash: string, refusals?: string[]): Mix | null {
  const m = /alloy=([a-z]+):([A-Za-z0-9.,]*)/.exec(hash);
  if (!m) return null;
  if (!Object.hasOwn(BASES, m[1])) {
    refusals?.push(`this link names "${m[1]}" as its base metal, which this composer does not carry — the link was not applied`);
    return null;
  }
  const wt: Record<string, number> = {};
  for (const p of m[2].split(",")) {
    if (p === "") continue;   // an empty solute list is well-formed, not a drop
    const pm = /^([A-Z][a-z]?)([\d.]+)$/.exec(p);
    if (!pm) {
      refusals?.push(`"${p}" in this link is not an element followed by a weight — that term was dropped and the rest of the link was restored`);
      continue;
    }
    const s = Object.hasOwn(BASES[m[1]].solutes, pm[1]) ? BASES[m[1]].solutes[pm[1]] : undefined;
    if (!s) {
      refusals?.push(`this link asks for ${pm[1]}, which this model does not carry in ${BASES[m[1]].label} — that term was dropped and the rest of the link was restored`);
      continue;
    }
    const raw = parseFloat(pm[2]);
    // `([\d.]+)` matches a bare "." and a "1.2.3", both of which parseFloat
    // turns into something the clamp cannot fix. NaN !== NaN also made the
    // cap-violation branch below fire and name the wrong mechanism, while
    // still writing NaN into the mix.
    if (!Number.isFinite(raw)) {
      refusals?.push(`"${p}" in this link does not carry a readable weight — that term was dropped and the rest of the link was restored`);
      continue;
    }
    const clamped = Math.min(s.cap, Math.max(0, raw));
    if (clamped !== raw) {
      refusals?.push(`this link asks for ${raw} wt% ${pm[1]}, past the ${s.cap} wt% this model admits in ${BASES[m[1]].label} — restored at ${clamped} wt%`);
    }
    wt[pm[1]] = clamped;
  }
  return { base: m[1], wt };
}
