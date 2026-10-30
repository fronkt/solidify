// App-only admission policy. Keep phase data out of quant.ts: the landing
// imports its arithmetic through units.ts but does not carry the composer.
import { BINARY } from "./phasedata";

/** Admission for a preset's SI calibration, separate from its illustrative
 * morphology. The steel preset's c̃₀ is tuned for visible segregation; using
 * the composer's 15 wt% per unit mapping makes it 5.25 wt% C, outside the
 * primary δ-ferrite branch. A composed charge has its own assessed interval
 * and regime caveats, so this preset check must not replace that path. */
export function materialCalibrationIssue(
  material: string, alloy: boolean, c0wt: number, hasPouredMix = false,
): string | null {
  if (!alloy || hasPouredMix || material !== "steel") return null;
  const limit = BINARY.fe.C.Cinv!;
  if (!Number.isFinite(c0wt) || c0wt < 0) return "Carbon concentration must be a finite, non-negative weight percent.";
  if (c0wt > limit) {
    return `This steel preset has illustrative chemistry (${c0wt.toFixed(2)} wt% C under the composition scale). `
      + `The primary δ-ferrite model ends at ${limit.toFixed(2)} wt% C. Use the alloy composer for a supported steel charge.`;
  }
  return null;
}
