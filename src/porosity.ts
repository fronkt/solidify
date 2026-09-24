/**
 * HYDROGEN POROSITY — dissolved gas rejected on freezing, via Sievert's law.
 *
 * The atmosphere→porosity link used to be a single admitted hack in the lab:
 * "poured in air? add 0.1 to the pore field." This replaces it with the actual
 * mechanism. A molten metal dissolves diatomic hydrogen in proportion to the
 * square root of its partial pressure (Sievert's law, C = S·√p), and the
 * solubility S collapses on freezing — liquid aluminium holds ~19× the hydrogen
 * the solid can. The rejected difference is what nucleates gas pores, which is
 * why aluminium is the textbook gas-porosity casting and why foundries degas.
 *
 * What is real here and what is a proxy, stated plainly (the science page carries
 * the same split):
 *   - REAL: the solubilities hL, hS (Ransley–Neufeld values on `MaterialSI`), the
 *     √p dependence, and the liquid→solid drop that drives the whole effect.
 *   - PROXY: how much hydrogen each atmosphere presents. Air is humid and water
 *     vapour charges the melt (2Al + 3H₂O → Al₂O₃ + 3H₂); a cover gas leaves
 *     residual moisture; a vacuum degasses. The numbers below are an ordering,
 *     not measured partial pressures. And the map from rejected hydrogen to the
 *     pore-field value is a calibration, tuned so a dirty aluminium melt lands
 *     near the old hard-coded bias — but now ordered by atmosphere and zeroed by
 *     a clean one, instead of a flat constant.
 *
 * A material with no solubility data refuses gas-porosity modelling by name,
 * exactly as the heat-treatment refusals do, rather than inventing a number.
 *
 * Pure TypeScript, no DOM — loads browser-free for scripts/verify-porosity.mjs.
 */

import type { MaterialSI } from "./units";

export type Atmosphere = "air" | "argon" | "vacuum";

/** effective hydrogen partial pressure, relative to 1 atm, each atmosphere
 *  presents to the melt (a proxy ordering, not a measurement) */
export const PH2: Record<Atmosphere, number> = { air: 1.0, argon: 0.06, vacuum: 0.0 };

/** hydrogen below this rejected level stays in solution or diffuses out at the
 *  local pressure without nucleating a pore — cm³/100 g */
export const C_ESCAPE = 0.10;
/** maps rejected-hydrogen supersaturation (cm³/100 g) onto the [0,1] pore field */
export const PORE_GAIN = 0.22;

export interface PorosityResult {
  /** pore-field value in [0,1] the lab adds to the 3D pore model */
  pPore: number;
  /** dissolved hydrogen in the liquid at pour — cm³/100 g */
  cLiquid: number;
  /** hydrogen the solid can retain — cm³/100 g */
  cSolid: number;
  /** rejected on freezing (cLiquid − cSolid), the porosity driver */
  cRejected: number;
  /** non-null when the material has no solubility data and porosity is refused */
  note: string | null;
  /** the refusal's learn-mode sentence, beside its line (v8 U1b) */
  noteLearn?: string;
}

/**
 * Gas porosity from dissolved hydrogen for a charge of material `si` poured under
 * atmosphere `atmo`. Returns a zeroed result with a note when the material has no
 * hydrogen-solubility data.
 */
export function hydrogenPorosity(si: MaterialSI | null | undefined, atmo: Atmosphere): PorosityResult {
  if (!si || si.hL == null || si.hS == null) {
    return {
      pPore: 0, cLiquid: 0, cSolid: 0, cRejected: 0,
      note: "not modeled (no hydrogen-solubility data for this material)",
      noteLearn: "Gas pores form when hydrogen dissolved in the liquid is pushed out as it freezes. Without "
        + "this material's hydrogen solubility there is nothing to compute, so no number is invented.",
    };
  }
  const root = Math.sqrt(Math.max(0, PH2[atmo] ?? 0));
  const cLiquid = si.hL * root;                       // Sievert: C = S·√p
  const cSolid = si.hS * root;
  const cRejected = Math.max(0, cLiquid - cSolid);
  const pPore = Math.min(1, PORE_GAIN * Math.max(0, cRejected - C_ESCAPE));
  return { pPore, cLiquid, cSolid, cRejected, note: null };
}
