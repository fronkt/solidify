import type { PhysParams } from "./sim";
import { MATERIALS } from "./materials";
import { BINARY, shortPhase, reactionText, type BinaryRow } from "./phasedata";

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

// ---------------------------------------------------------------------------
// COMPOSITION REGIMES, THE INVARIANT FRACTION, AND THE CEILING (v7.1 P3)
//
// P0 entered the invariants, P1 measured the freezing range in them and P2 drew
// them. What none of the three did was ask the question a founder asks first:
// at THIS composition, which phases does equilibrium say the casting ends with,
// and which of them does this solver actually grow? The answer is always
// "exactly one, the base-rich primary" — sim.ts and sim3d.ts carry one φ field —
// so every phase named below is a phase the casting beside the diagram will
// never grow, and the honest thing is to name them rather than to let the
// picture imply they are in the model.
//
// THE REGIMES ARE NOT CALLED HYPOEUTECTIC. SEVEN of the shipped rows are
// peritectics — Fe–C, Fe–Mn, Fe–Ni, Cu–Sn, Cu–Zn, Al–Ti, Mg–Zr — and
// "hypoeutectic" is simply false for all of them. The names are type-neutral
// and the reaction type is carried separately, where it is load-bearing rather
// than decorative. (The count was five in this comment's first draft, copied
// from the plan rather than counted from the table, and the two it omitted —
// Fe–Mn and Fe–Ni — are precisely the rows where the reactant-peritectic
// classification below had to be repaired. PD-REGIME-EXACT now counts them.)

export type CompositionRegime =
  /** at or below the maximum solid solubility: everything dissolves */
  | "SINGLE-PHASE"
  /** past it: a second phase appears when freezing terminates on the invariant */
  | "TWO-PHASE-TERMINATION"
  /** at or past the invariant liquid: the FIRST phase to freeze is no longer the base's */
  | "PAST-THE-INVARIANT"
  /** an isomorphous pair — no invariant, no second phase, at any composition */
  | "SINGLE-PHASE-ALL-COMPOSITIONS"
  /** no solute to classify */
  | "NONE"
  /** a pair with no assessed row; structurally unreachable from the shipped table */
  | "UNASSESSED";

/** the two closed forms, as fractions of the whole casting in [0,1] */
export interface InvariantFraction { lever: number; scheil: number }

/**
 * The Gulliver–Scheil fraction below which this readout does not call the
 * result a phase, as a fraction of the casting.
 *
 * MEASURED BEFORE IT WAS CHOSEN, over every eutectic pair at its shipped preset
 * composition on the equilibrium-single-phase side: AZ91's aluminium gives
 * 11.9 %, AA2024's copper 8.8 %, the galvanising bath's aluminium 1.5 %, then a
 * gap to Mg–Zn's 0.75 %, Al–Mg's 0.011 %, Ni–Nb's 0.008 % and eight pairs at
 * 0.000 %. The floor sits in that gap.
 *
 * The justification is not roundness. The two shipped tables disagree about k
 * by ratios from 0.39 to 3.30 over all twenty-three rows with an invariant, and
 * from 0.68 to 2.34 over the fifteen `PD-CONSTRUCT-AGREE` actually enters (it
 * takes eutectics with C_inv <= 60 wt%, so the 3.30 is cu-Sn, a peritectic it
 * excludes, and the 0.39 is fe-Ni). The gate was cited for the whole span here
 * until v7.1 P6; it measures the narrower one. Either way a
 * predicted fraction of a few thousandths is far below what the inputs can
 * support; calling it a phase present in the casting would be claiming more
 * precision than the coefficients have. Above it, the numbers are the textbook
 * as-cast constituents — β-Mg17Al12 in AZ91 is the canonical one.
 */
export const SCHEIL_FLOOR = 0.01;

export interface SolutePhases {
  el: string;
  wt: number;
  regime: CompositionRegime;
  /** the FIRST solid to form from this binary at this composition */
  primary: string;
  /** every phase equilibrium leaves once this binary has finished freezing */
  equilibrium: string[];
  /**
   * Whether the invariant reaction CONSUMES the base-rich primary entirely —
   * i.e. whether the phase this solver grows is still there when freezing ends.
   *
   * True only on the peritectic rows whose base solid is a REACTANT, and only
   * above the reaction's product composition. It is the sharpest thing this
   * milestone can say: 1045 and 4340 both sit above Fe–C's γ at 0.17 wt% C, so
   * their δ-ferrite is entirely eaten by L + δ → γ and the casting ends as
   * austenite — while the solver grows δ-ferrite from first frame to last.
   */
  consumesPrimary: boolean;
  /** the share of the casting that freezes at the invariant — EUTECTIC rows only */
  fraction: InvariantFraction | null;
  /** one sentence for a phase this solver will not grow, or null when there is none */
  notGrown: string | null;
  /** always non-empty: how the above was arrived at, or the named reason it was not */
  source: string;
}

/**
 * How far this solute can be taken in this base, and why that is the bound.
 *
 * The hand-picked `cap` was doing two jobs at once — it is a slider ergonomic
 * AND it was the only thing standing between a user and a composition whose
 * primary phase this solver cannot grow. It keeps the first job. The second
 * moves here, where it is DERIVED from the same invariant table the figure is
 * drawn from, and is enforced inside `derive()` where `window.__solidify.alloy`
 * cannot walk around it.
 *
 * Measured on this tree, the ceiling BINDS for five of the twenty-five pairs,
 * and the plan that specified this milestone had found four of them: Fe–C
 * (cap 2 against a 0.53 wt% peritectic), Al–Fe (2 against 1.8), Al–Ti (0.5
 * against 0.15), Mg–Zr (0.8 against 0.58) — and Zn–Al, whose cap of 5 wt% IS
 * the eutectic composition exactly, so the slider's own maximum was the one
 * composition on the axis where the primary phase changes.
 */
export interface SoluteBound {
  /** the slider's max, wt%: the smaller of the hand-picked cap and the ceiling */
  max: number;
  /** the composition at which the primary phase changes, wt%; null when none is assessed */
  ceiling: number | null;
  /** which of the two is the binding one */
  boundBy: "cap" | "invariant";
  /** the slider's step, kept identical to the pre-P3 rule for every shipped pair */
  step: number;
  /** always non-empty */
  source: string;
}

export function soluteBound(baseKey: string, el: string): SoluteBound | null {
  const base = Object.hasOwn(BASES, baseKey) ? BASES[baseKey] : undefined;
  const sol = base && Object.hasOwn(base.solutes, el) ? base.solutes[el] : undefined;
  if (!base || !sol) return null;
  const byBase = Object.hasOwn(BINARY, baseKey) ? BINARY[baseKey] : {};
  const row: BinaryRow | undefined = Object.hasOwn(byBase, el) ? byBase[el] : undefined;
  const ceiling = row && row.invariant !== "isomorphous" && row.Cinv != null ? row.Cinv : null;
  // The step is computed from the SMALLER of the two bounds, so that tightening
  // a range can never leave it coarser than it deserves. Measured pair by pair
  // it matches the pre-P3 `cap <= 1 ? 0.01 : 0.05` for twenty-four of the
  // twenty-five, and changes for exactly one: Fe–C, whose cap of 2 wt% gave it
  // 0.05 steps and whose ceiling of 0.53 wt% now gives it 0.01. That is the
  // right direction — a 0.52 wt% carbon range in five-hundredths would have had
  // eleven positions on it, and 1045's 0.45 and 4340's 0.40 both land on a step.
  const step = Math.min(sol.cap, ceiling ?? sol.cap) <= 1 ? 0.01 : 0.05;
  if (ceiling == null) {
    return { max: sol.cap, ceiling: null, boundBy: "cap", step,
      source: row
        ? `${base.symbol}–${el} is isomorphous — there is no invariant and no composition at which the primary phase changes — so the ${sol.cap} wt% bound is the slider's own, not the diagram's.`
        : `no assessed invariant row for ${base.symbol}–${el}, so this model has nothing to derive a ceiling from and the ${sol.cap} wt% bound is the slider's own.` };
  }
  if (ceiling > sol.cap) {
    return { max: sol.cap, ceiling, boundBy: "cap", step,
      source: `the ${sol.cap} wt% bound is the slider's own; the ${base.symbol}–${el} invariant liquid is further out at ${ceiling} wt%, so the diagram does not bind here.` };
  }
  // The ceiling binds. One slider step below it, so the maximum the slider can
  // reach is a composition this instrument will actually pour rather than the
  // one composition on the axis where it refuses.
  const max = +Math.max(0, ceiling - step).toFixed(4);
  return { max, ceiling, boundBy: "invariant", step,
    source: `${base.symbol}–${el}'s primary phase stops being (${base.symbol}) at the ${ceiling} wt% invariant liquid, so this slider stops one step short at ${max} wt% — tighter than the ${sol.cap} wt% it used to allow, which reached a melt this solver cannot grow the first phase of.` };
}

/**
 * Which phases equilibrium leaves at this composition, and which of them this
 * solver grows. Pure, and exported because `PD-REGIME-EXACT` classifies both
 * sides of every boundary in the table with it.
 *
 * THE BOUNDARY ORDER IS LOAD-BEARING. C_inv is tested FIRST, and it has to be:
 * for the two rows whose base solid is the peritectic PRODUCT (Al–Ti, Mg–Zr)
 * the invariant liquid is LEANER than the maximum solid solubility — Al–Ti is
 * 0.15 against 1.32 — so `c > C_SM` is false right through the region where the
 * primary phase has already stopped being aluminium. Classified in the other
 * order those two rows report SINGLE-PHASE for compositions whose first solid
 * is Al3Ti. It also means TWO-PHASE-TERMINATION is structurally unreachable for
 * that class, which is correct rather than a gap: its whole two-phase band lies
 * past the invariant, where this instrument refuses.
 */
export function phasesFor(baseKey: string, el: string, w: number): SolutePhases | null {
  const base = Object.hasOwn(BASES, baseKey) ? BASES[baseKey] : undefined;
  const sol = base && Object.hasOwn(base.solutes, el) ? base.solutes[el] : undefined;
  if (!base || !sol) return null;
  const P = `(${base.symbol})`;
  const byBase = Object.hasOwn(BINARY, baseKey) ? BINARY[baseKey] : {};
  const row: BinaryRow | undefined = Object.hasOwn(byBase, el) ? byBase[el] : undefined;
  const R = (regime: CompositionRegime, primary: string, equilibrium: string[],
    source: string, fraction: InvariantFraction | null = null,
    notGrown: string | null = null, consumesPrimary = false): SolutePhases =>
    ({ el, wt: w, regime, primary, equilibrium, consumesPrimary, fraction, notGrown, source });

  if (!row) {
    return R("UNASSESSED", P, [P],
      `no assessed invariant row for ${base.symbol}–${el} in this build, so nothing is claimed about which phases this composition ends with.`);
  }
  if (row.invariant === "isomorphous") {
    return R("SINGLE-PHASE-ALL-COMPOSITIONS", P, [P],
      `${base.symbol}–${el} is isomorphous: the two are soluble in each other in every proportion, so there is no invariant, no second phase, and no composition at which either of those changes. Freezing ends single-phase ${P} at any ${el} content, and the ${w} wt% here is not near an edge because there is no edge.`);
  }
  const { Tinv, Cinv, Csm } = row;
  if (Tinv == null || Cinv == null || Csm == null) {
    return R("UNASSESSED", P, [P],
      `the ${base.symbol}–${el} row records a ${row.invariant} but not all three of its temperature, its liquid composition and the maximum solid solubility, so this composition cannot be placed against it.`);
  }

  // THE SAME GEOMETRIC TEST phasediagram.ts refuses to DRAW on, applied to the
  // claim as well as to the picture. One row fails it — Ni–W, whose invariant
  // at 1495 °C sits above nickel's 1455 °C (so the liquidus rises and the first
  // solid must be the RICHER phase) while its C_SM 39.9 against C_inv 45 says
  // the liquid is. v7.1 P2 found it and refused to draw it; until this check
  // the composer went on computing confident phase names, regimes and even a
  // lever fraction from the same contradictory numbers. An app that will not
  // draw a row should not narrate it either.
  const TmC = (MATERIALS[base.materialKey]?.si?.Tm ?? NaN) - C_PER_K;
  if (Number.isFinite(TmC) && (Tinv > TmC) !== (Csm > Cinv)) {
    return R("UNASSESSED", P, [P],
      `${base.symbol}–${el}'s row cannot be placed: its invariant at ${Tinv} °C is ${Tinv > TmC ? "above" : "below"} pure ${base.symbol}'s ${TmC.toFixed(0)} °C, so the liquidus ${Tinv > TmC ? "rises" : "falls"} and the first solid must be the ${Tinv > TmC ? "richer" : "leaner"} phase — but C_SM ${Csm} wt% against C_inv ${Cinv} wt% says the ${Csm > Cinv ? "solid" : "liquid"} is. The row's own source records the contradiction; nothing is claimed from it here, and the figure refuses to draw it for the same reason.`);
  }
  const second = shortPhase(row.second);

  // Which class of reaction this is, in the only terms the DATA can settle.
  // A peritectic whose base solid is the PRODUCT has its invariant liquid
  // LEANER than the maximum solid solubility (Al–Ti 0.15 against 1.32); one
  // whose base solid is a REACTANT has it the other way round (Fe–C 0.53
  // against 0.09). No string is parsed to decide this.
  const eutectic = row.invariant === "eutectic";
  const productPeritectic = !eutectic && Cinv < Csm;
  const reactantPeritectic = !eutectic && !productPeritectic;
  const Cb = row.Csecond ?? null;

  if (w >= Cinv) {
    // AT the invariant liquid exactly, the phase identity below is not what
    // happens and saying it would be a wrong statement rather than an absent
    // one: an Fe–0.53C melt meets the δ liquidus exactly at 1495 °C, so δ does
    // form first and is immediately consumed; at a eutectic composition neither
    // solid is first, both nucleate together on the horizontal. The refusal is
    // the same either way — this solver grows one solid phase — but the reason
    // is worded for the case that is actually true.
    const atExactly = w === Cinv;
    const head = `${w} wt% ${el} is ${atExactly ? "exactly at" : "past"} the ${base.symbol}–${el} invariant liquid of ${Cinv} wt% (${row.invariant}, ${Tinv} °C)`;
    if (atExactly) {
      return R("PAST-THE-INVARIANT", second, eutectic ? [P, second] : [second],
        `${head}: this melt freezes ON the horizontal — ${eutectic ? `at a eutectic composition neither solid is first, ${P} and ${second} nucleate together` : `${P} forms at the liquidus and the reaction ${reactionText(row)} consumes it at once`} — and this solver grows one solid phase, so the composition is declined rather than approximated.`);
    }
    // Past it. What equilibrium leaves depends on the class, and returning
    // [second, base] for all three was wrong for both peritectic ones.
    const leaves = eutectic
      // hypereutectic: primary `second`, then the eutectic gives both
      ? [second, P]
      : productPeritectic
        // L + second -> base. Below C_SM the `second` primary is entirely
        // consumed and the casting ends single-phase in the base — this is the
        // Al–Ti grain-refinement mechanism itself. Only past C_SM is any left.
        ? (w > Csm ? [second, P] : [P])
        // L + base -> second, and past the invariant liquid the base phase
        // never forms at all: an Fe–1.5C melt ends 100 % austenite.
        : [second];
    return R("PAST-THE-INVARIANT", second, leaves,
      `${head}: the FIRST phase to freeze from this melt is ${second}, not ${P}${leaves.includes(P) ? "" : `, and ${P} — the one phase this solver grows — is not in the frozen casting at all`}. This solver grows one solid phase and it is the base-rich primary, so there is nothing here for it to grow first.`);
  }

  if (w > Csm) {
    // Past the solubility limit and short of the invariant: the primary IS the
    // base's own phase. What happens to it at the invariant is the whole
    // difference between the two reaction types, and it was collapsed into one
    // answer until v7.1 P3's review.
    const k = Csm / Cinv;
    const lever = (w - Csm) / (Cinv - Csm);
    const scheil = k > 0 && k < 1 ? Math.pow(Cinv / w, 1 / (k - 1)) : NaN;
    const both = eutectic && Number.isFinite(scheil) && k > 0 && k < 1;
    if (both) {
      const head = `${w} wt% ${el} is past the ${Csm} wt% that dissolves in ${P} at ${Tinv} °C, so equilibrium ends this casting with ${second} beside the ${base.label}`;
      return R("TWO-PHASE-TERMINATION", P, [P, second],
        `${head}. The lever rule puts ${(lever * 100).toFixed(1)} % of the casting through the ${Tinv} °C ${row.invariant} as ${P} + ${second}; Gulliver–Scheil — constant partition, complete mixing in the liquid, and NO back-diffusion into the solid — gives ${(scheil * 100).toFixed(1)} %. Both use this row's own chord partition k = C_SM/C_inv = ${k.toFixed(3)}, not the shipped dilute k = ${sol.k}; docs/PHASE-AUDIT.md records where the two disagree.`,
        { lever, scheil },
        `${second} is the second phase equilibrium leaves in this casting — ${el} at ${w} wt% is past the ${Csm} wt% that dissolves in ${P} — and roughly ${(lever * 100).toFixed(0)} % of the casting freezes at the ${Tinv} °C ${row.invariant} as ${P} + ${second} (Gulliver–Scheil ${(scheil * 100).toFixed(0)} %). This solver has one solid phase and grows none of the ${second}.`);
    }

    // A EUTECTIC that could not produce the two closed forms is a different
    // fact from a peritectic, and it must not borrow the peritectic's sentence.
    // Unreachable from the shipped table — it needs C_SM = 0 exactly, and no
    // row has that — but the branch below is written for a reaction that
    // CONSUMES the primary, and printing that about a eutectic would name a
    // mechanism that did not happen.
    if (eutectic) {
      return R("TWO-PHASE-TERMINATION", P, [P, second],
        `${w} wt% ${el} is past the ${Csm} wt% that dissolves in ${P} at ${Tinv} °C, so equilibrium ends this casting with ${second} beside the ${base.label}. The share that freezes at the ${Tinv} °C eutectic is not computed here: this row's chord partition C_SM/C_inv = ${(Csm / Cinv).toFixed(3)} is not inside (0,1), and both closed forms need a partition that is.`,
        null,
        `${second} is the second phase equilibrium leaves in this casting — ${el} at ${w} wt% is past the ${Csm} wt% that dissolves in ${P} — and this solver has one solid phase and grows none of it. No fraction is put on it, because this row's chord partition is not inside (0,1).`);
    }

    // A PERITECTIC, where the reaction EATS the phase this solver grows.
    //
    // The number is refused, and the reason is not the one this file printed
    // first. "The lever rule and Gulliver–Scheil describe a liquid freezing to
    // two solids and neither describes a peritectic" is false metallurgy on
    // both halves: the lever rule is a tie-line mass balance that knows nothing
    // about reaction type and is exactly how the extent of a peritectic is
    // computed, and Scheil is the standard tool for hypo- and hyper-peritectic
    // steel. THE REAL REASON is that the quantity itself is different. At a
    // eutectic every drop of remaining liquid freezes AT T_inv, so the liquid
    // fraction there IS "the share that freezes at the invariant". At a
    // peritectic the reaction consumes only part of the liquid and the rest
    // freezes BELOW T_p on the product's own solidus, so the share is a
    // difference of two lever arms that needs the product's composition.
    const retained = Cb == null ? null : w <= Cb;
    const leaves = reactantPeritectic && retained === false ? [second] : [P, second];
    const consumed = reactantPeritectic && retained === false;
    const fate = Cb == null
      ? `whether any ${P} survives that reaction depends on the product's own composition, which this row does not carry as a number (its literature value is a bracket, and the row's source says so), so it is not decided here`
      : retained
        ? `at ${w} wt% this melt is leaner than the product's ${Cb} wt%, so some ${P} survives the reaction and the casting ends with both`
        : `at ${w} wt% this melt is RICHER than the product's ${Cb} wt%, so the reaction consumes the ${P} entirely and the casting ends as ${second} alone — while this solver grows ${P} from the first frame to the last`;
    return R("TWO-PHASE-TERMINATION", P, leaves,
      `${w} wt% ${el} is past the ${Csm} wt% that dissolves in ${P} at ${Tinv} °C, so what is left of this melt reaches the ${row.invariant} ${reactionText(row)} at ${Tinv} °C — and ${fate}. No fraction is put on it: at a eutectic the liquid remaining at the invariant all freezes there, so its fraction IS the share that freezes at the invariant, but a peritectic consumes only part of that liquid and the rest freezes below ${Tinv} °C on the ${second} solidus, which makes the share a difference of two lever arms this table cannot close.`,
      null,
      `${second} is what equilibrium leaves in this casting — ${el} at ${w} wt% is past the ${Csm} wt% that dissolves in ${P} — through the ${row.invariant} ${reactionText(row)} at ${Tinv} °C${consumed ? `, which consumes the ${P} this solver grows ENTIRELY: the casting ends as ${second} and the solver grows ${P}` : `; the solver grows one solid phase, ${P}, and grows none of the ${second}`}. No fraction is put on it, because the share that freezes at a peritectic is not the liquid fraction there.`,
      consumed);
  }

  // WITHIN the equilibrium solubility limit — and equilibrium is not the only
  // thing that has an opinion. Gulliver–Scheil is defined here too, and it is
  // strictly positive: with no back-diffusion the last liquid between the arms
  // enriches to the invariant however lean the melt started, which is why AZ91
  // has β-Mg17Al12 in its as-cast structure at 9 wt% Al against a 12.9 wt%
  // equilibrium limit. Printing SINGLE-PHASE and stopping would be the one
  // place this two-column device fails to fire, on a DENDRITIC solidification
  // simulator, where non-equilibrium freezing is the entire subject.
  const kEq = Csm / Cinv;
  const scheilHere = eutectic && kEq > 0 && kEq < 1 && w > 0
    ? Math.pow(Cinv / w, 1 / (kEq - 1)) : NaN;
  const solvus = `That limit is quoted AT the invariant temperature and this table carries no solvus below it, so whatever precipitates on further cooling is outside both the drawing and the solver.`;
  if (Number.isFinite(scheilHere) && scheilHere >= SCHEIL_FLOOR) {
    return R("SINGLE-PHASE", P, [P],
      `${w} wt% ${el} is within the ${Csm} wt% that dissolves in ${P} at the ${Tinv} °C ${row.invariant}, so EQUILIBRIUM freezes this binary to a single solid solution — but Gulliver–Scheil does not: with no back-diffusion the last liquid still enriches to the invariant, and it puts ${(scheilHere * 100).toFixed(1)} % of the casting through it as ${row.invariant} ${P} + ${second}. Equilibrium says one phase, Scheil says ${(scheilHere * 100).toFixed(1)} % of a second, and this solver grows neither. ${solvus}`,
      { lever: 0, scheil: scheilHere },
      `equilibrium leaves this casting single-phase ${P} — ${el} at ${w} wt% is within the ${Csm} wt% that dissolves — but Gulliver–Scheil, which assumes no back-diffusion into the solid, puts ${(scheilHere * 100).toFixed(1)} % of it through the ${Tinv} °C ${row.invariant} as ${second} anyway. That is the as-cast structure a real foundry gets; this solver grows neither phase of it.`);
  }
  return R("SINGLE-PHASE", P, [P],
    `${w} wt% ${el} is within the ${Csm} wt% that dissolves in ${P} at the ${Tinv} °C ${row.invariant}, so equilibrium freezes this binary to a single solid solution${Number.isFinite(scheilHere) ? `, and Gulliver–Scheil agrees to within ${(scheilHere * 100).toFixed(2)} % — below the ${(SCHEIL_FLOOR * 100).toFixed(0)} % this readout treats as a phase` : ""}. ${solvus}`);
}

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
  /**
   * The DOMINANT solute's composition regime — the same binary `dominant`
   * names and the same one the figure draws, so the shaded band on the drawing
   * and the word in the readout cannot disagree.
   */
  regime: CompositionRegime;
  /** always non-empty: which numbers placed the mix in that regime */
  regimeSource: string;
  /** one entry per solute that survived the filter, in mix order */
  phases: SolutePhases[];
  /** what equilibrium leaves when this casting is frozen, deduplicated */
  phasesEquilibrium: string[];
  /** what this solver grows: exactly one phase, or none for a pure melt */
  phasesGrown: string[];
  /**
   * One line per phase equilibrium predicts here that the solver does not grow.
   * The most important honesty channel this composer has: it is the difference
   * between a drawing of a diagram and a simulation of one.
   */
  notGrown: string[];
  /** the dominant solute's invariant share — EUTECTIC rows only, else null */
  invariantFraction: InvariantFraction | null;
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

/** the fields P3 added, in their nothing-to-say state */
const NO_PHASES = {
  regime: "NONE" as CompositionRegime,
  regimeSource: "",
  phases: [] as SolutePhases[],
  phasesEquilibrium: [] as string[],
  phasesGrown: [] as string[],
  notGrown: [] as string[],
  invariantFraction: null as InvariantFraction | null,
};

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
      ...NO_PHASES,
      regimeSource: `there is no base metal named "${mix.base}", so there is no binary to place a composition on.`,
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
    // THE CEILING, and it is here rather than on the slider because the slider
    // is not the only way in. `window.__solidify.alloy({base:'fe',wt:{C:3}})`
    // walked straight past the hand-picked cap, and so did any hand-built
    // `#alloy=` hash before its own clamp was tightened beside this.
    //
    // Past the invariant liquid the FIRST phase to freeze is no longer the
    // base-rich one, and this solver carries exactly one solid phase. Drawing
    // 4-fold δ-ferrite dendrites for a melt whose primary phase is austenite is
    // not an approximation, it is a different casting. The refusal names the
    // phase and the number, because a slider range that silently shrank would
    // teach nothing.
    // The bound comes from `soluteBound`, NOT from the regime classifier, and
    // the two were the same call until the classifier learned to refuse a
    // geometrically contradictory row. Ni–W is that row: refusing to CLASSIFY
    // it also switched its ceiling off, so 45 wt% tungsten sailed into the
    // melt through the hole the repair opened. A composition bound and a phase
    // claim are different things, and only one of them is in doubt here — the
    // invariant liquid is still the composition past which this instrument
    // stops being able to say what freezes first, whatever else the row gets
    // wrong.
    const b = soluteBound(mix.base, el);
    if (b?.ceiling != null && w >= b.ceiling) {
      const row = BINARY[mix.base][el];
      // AT the invariant liquid exactly, "past it the first phase to freeze is
      // X" is a false sentence, and this refusal is reachable there: an
      // Al–12.6Si melt freezes ON the eutectic horizontal, where both solids
      // nucleate together, and an Fe–0.53C melt forms δ at the liquidus and has
      // it consumed at once. The composition is declined either way — this
      // solver grows one solid phase — but the reason is worded for the case
      // that is true, the same split `phasesFor` makes one file over.
      const at = w === b.ceiling;
      refusals.push(`${el} at ${w} wt% is ${at ? "exactly at" : "past"} the ${base.symbol}–${el} invariant liquid, ${row.Cinv} wt% (${row.invariant} at ${row.Tinv} °C): ${at ? `this melt freezes ON the horizontal, where ${row.invariant === "eutectic" ? `(${base.symbol}) and ${shortPhase(row.second)} appear together` : `(${base.symbol}) forms and the reaction consumes it at once`}` : `past it the first phase to freeze is ${shortPhase(row.second)}, not (${base.symbol})`}, and this solver grows exactly one solid — the base-rich primary. Dropped rather than poured as a melt this instrument cannot grow the first phase of.`);
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
      ...NO_PHASES,
      regimeSource: `this mix totals ${totalWt.toFixed(1)} wt% of solute, so there is no composition to place on a diagram.`,
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

  // `[...entries]`, because Array.sort is IN PLACE. Sorting `entries` itself to
  // build a display name silently reordered every consumer downstream of it —
  // harmless while the only one was this string, and no longer harmless now
  // that `phases` is built from the same array and its order is what the
  // readout prints. A cosmetic sort with a side effect on data.
  const name = base.symbol + [...entries]
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

  // ---- what equilibrium leaves, and what the solver actually grows.
  //
  // Every SURVIVING solute is classified, not just the dominant one: the mix
  // collapses onto one pseudo-binary for the SOLVER, but a casting does not
  // stop forming Al3Fe because iron is not the largest m·c term. The dominant's
  // regime is the one the readout and the drawn band name, because that is the
  // binary the figure is a picture of.
  const phases = entries.map(([el, w]) => phasesFor(mix.base, el, w))
    .filter((p): p is SolutePhases => p !== null);
  const dom = dominant ? phases.find(p => p.el === dominant) ?? null : null;
  const phasesGrown = totalWt > 0 ? [`(${base.symbol})`] : [];
  // A CONSUMED PRIMARY IS NOT PRESENT, whatever the other binaries say. Each
  // solute's row speaks only for its own binary, so the union across them is
  // how this app approximates a multicomponent melt — but if ANY of them says
  // the invariant reaction eats the base-rich phase, then it is gone, and no
  // other binary's "single-phase (Fe)" can put it back. 1045 is the case: its
  // manganese and silicon rows both end single-phase (Fe) while its carbon row
  // ends as austenite through a reaction that consumes every trace of the
  // δ-ferrite, so the honest left column is austenite alone.
  const eats = phases.some(p => p.consumesPrimary);
  const phasesEquilibrium = [...new Set(phases.flatMap(p => p.equilibrium))]
    .filter(x => !eats || x !== `(${base.symbol})`);
  const notGrown = phases.map(p => p.notGrown).filter((s): s is string => s !== null);

  return {
    name, totalWt, dTL, Q, atPct, clamps, refusals,
    mSI, kEff, dominant,
    dT0: iv.dT0, dT0Regime: iv.regime, dT0Source: iv.source,
    params: { alloyOn: totalWt > 0 ? 1 : 0, c0, mLiq, kPart, dSol },
    regime: dom?.regime ?? "NONE",
    regimeSource: dom?.source
      ?? `there is no solute in this melt, so there is no composition to place against an invariant — a pure ${base.label} casting freezes at one temperature.`,
    phases, phasesEquilibrium, phasesGrown, notGrown,
    invariantFraction: dom?.fraction ?? null,
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
export function decodeMix(hash: string, refusals?: string[], clamped?: string[]): Mix | null {
  // The payload runs to the end of the hash or to the next parameter, and NOT
  // to the first character the old class did not recognise. `[A-Za-z0-9.,]*`
  // silently TRUNCATED: `#alloy=al:Si7%20Mg0.35` matched only "Si7" and the
  // magnesium term vanished with nothing said, because the decoder never saw
  // it. Captured whole, every term reaches the shape test below and a malformed
  // one is named. This is the same defect class as the `1.2.3` weight above —
  // an input silently reduced rather than named — and it is the reason the
  // refusals now quote the token the LINK contains rather than a prefix of it.
  //
  // It does change one behaviour, deliberately: `#alloy=al:Si7%20Mg0.35` used
  // to restore Al–7Si and drop the magnesium in silence, and now restores
  // nothing and names the whole malformed token. Losing a solute quietly is the
  // worse of the two, and no link `encodeMix` mints can contain a character
  // that reaches this path.
  const m = /alloy=([a-z]+):([^&#]*)/.exec(hash);
  if (!m) return null;
  if (!Object.hasOwn(BASES, m[1])) {
    refusals?.push(`this link names "${m[1]}" as its base metal, which this composer does not carry — the link was not applied`);
    return null;
  }
  const wt: Record<string, number> = {};
  for (const p of m[2].split(",")) {
    if (p === "") continue;   // an empty solute list is well-formed, not a drop
    // `(\d*\.?\d+)` and not `([\d.]+)`, and the difference is a defect v7.1 P1
    // named without closing. P1's comment said `[\d.]+` "matches a bare '.' and
    // a '1.2.3', both of which parseFloat turns into something the clamp cannot
    // fix" — and then guarded on `Number.isFinite`, which catches the first and
    // NOT the second: parseFloat("1.2.3") is 1.2, perfectly finite, so
    // `#alloy=al:Si1.2.3` restored a silent 1.2 wt% Si and reported nothing.
    // A malformed weight is now rejected as a SHAPE, whole, and named. It
    // still accepts everything encodeMix mints and everything parseFloat would
    // have read correctly, including a leading-dot ".5".
    const pm = /^([A-Z][a-z]?)(\d*\.?\d+)$/.exec(p);
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
    // Now unreachable from the regex above, and kept deliberately: that regex
    // is about the token's SHAPE and this is about its VALUE, and the two were
    // conflated once already. A future loosening of the pattern must not
    // silently re-open a NaN path into the mix, which is what this caught when
    // the pattern was `[\d.]+` — NaN !== NaN also made the clamp branch below
    // fire and name the wrong mechanism while still writing NaN into the mix.
    if (!Number.isFinite(raw)) {
      refusals?.push(`"${p}" in this link does not carry a readable weight — that term was dropped and the rest of the link was restored`);
      continue;
    }
    // CLAMPED, not dropped, and that asymmetry with `derive()` is deliberate.
    // A link is a saved artefact and the non-negotiable for this arc is that
    // every pre-arc link still restores to a melt; a programmatic
    // `__solidify.alloy` call is not, and there dropping the term keeps derive()
    // a function of what it was actually handed rather than of a composition it
    // invented. Both routes name what they did, and neither lets a composition
    // at or past the invariant through.
    const b = soluteBound(m[1], pm[1]);
    const bound = b ? b.max : s.cap;
    const held = Math.min(bound, Math.max(0, raw));
    if (held !== raw) {
      // WHICH BOUND ACTUALLY BOUND, and the distinction is not pedantry. The
      // slider stops one step BELOW the invariant, so a link asking for
      // 0.525 wt% C is over the 0.52 bound while being under the 0.53
      // invariant: saying "at or past the invariant" there would name a
      // mechanism that did not fire. Three cases, three sentences.
      const overInvariant = b?.ceiling != null && raw >= b.ceiling;
      const invariantBound = b?.boundBy === "invariant";
      refusals?.push(
        overInvariant
          ? `this link asks for ${raw} wt% ${pm[1]}, at or past the ${b!.ceiling} wt% ${BASES[m[1]].symbol}–${pm[1]} invariant where the first phase to freeze stops being (${BASES[m[1]].symbol}) — restored at ${held} wt%, the most this instrument can grow the primary phase of`
          : invariantBound
            ? `this link asks for ${raw} wt% ${pm[1]}, past the ${held} wt% this slider reaches — one step short of the ${b!.ceiling} wt% ${BASES[m[1]].symbol}–${pm[1]} invariant, which it stops below rather than on — restored at ${held} wt%`
            : `this link asks for ${raw} wt% ${pm[1]}, past the ${bound} wt% this model admits in ${BASES[m[1]].label} — restored at ${held} wt%`);
      // A STRUCTURED signal beside the sentence, because a caller that has to
      // decide something needs a fact rather than a string to match on: main.ts
      // uses this to stop a pre-P3 share link's own params block from putting
      // the UNCLAMPED chemistry onto the solver behind the clamped mix.
      clamped?.push(pm[1]);
    }
    wt[pm[1]] = held;
  }
  return { base: m[1], wt };
}
