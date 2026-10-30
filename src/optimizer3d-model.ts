// The 3D objective is a volume census, not a 2D ASTM grain-number conversion.
import type { Phys3DParams, StatsResult3D } from "./sim3d";
import type { NucState } from "./nucleation";

export const CAST3_BATCH = 16;
export const CAST3_COMPLETE = .92;
export const CAST3_MAX_STEPS = 9000;
export const OPT3_EPISODES = 16;

export interface Recipe3D {
  dimension: "3d";
  grid: number;
  pitch: number;
  seed: number;
  known: boolean;
  unit: "µm" | "cells";
  params: Phys3DParams;
  nuc: NucState;
  undercool: number;
  nmax: number;
  cool: [number, number, number];
  target: number;
  diameter: number | null;
  maxSteps: number;
}

export interface Casting3Measurement {
  valid: boolean;
  reason: string | null;
  diameter: number | null;
  diameterCells: number | null;
  meanVolVox: number | null;
  grainCount: number;
  fracSolid: number;
  error: number | null;
  score: number;
}

const BOUNDS3: readonly (readonly [number, number])[] = [[0, .5], [0, .5], [0, .5], [8, 2000], [.45, .95]];
export function genomeRecipe3(genome: readonly number[], nuc: Pick<NucState, "dTN" | "dTsig"> = { dTN: .15, dTsig: .045 }, liquidus = 1): { cool: Recipe3D["cool"]; nmax: number; undercool: number } {
  if (genome.length !== BOUNDS3.length || genome.some(v => !Number.isFinite(v))) throw new Error("Invalid 3D search genome");
  const g = genome.map((z, i) => BOUNDS3[i][0] + (BOUNDS3[i][1] - BOUNDS3[i][0]) / (1 + Math.exp(-z)));
  const depression = 1 - liquidus;
  const lo = Math.max(.01, Math.min(.94, depression + nuc.dTN - 2 * nuc.dTsig));
  const hi = Math.min(.95, Math.max(lo + .01, depression + nuc.dTN + 2 * nuc.dTsig));
  return { cool: [g[0], g[1], g[2]], nmax: Math.round(g[3]), undercool: lo + (hi - lo) / (1 + Math.exp(-genome[4])) };
}

export const coolingAt3 = (fraction: number, cool: readonly [number, number, number]): number =>
  fraction < .33 ? cool[0] : fraction < .66 ? cool[1] : cool[2];

export function copyRecipe3(recipe: Recipe3D): Recipe3D {
  return { ...recipe, params: { ...recipe.params }, nuc: { ...recipe.nuc }, cool: [...recipe.cool] };
}

export function measureCasting3(stats: StatsResult3D | null, recipe: Pick<Recipe3D, "target" | "known" | "pitch">): Casting3Measurement {
  const fracSolid = stats?.fracSolid ?? 0, grainCount = stats?.grainCount ?? 0;
  const meanVolVox = stats && Number.isFinite(stats.meanVolVox) && stats.meanVolVox > 0 ? stats.meanVolVox : null;
  const diameterCells = meanVolVox != null ? Math.cbrt(6 * meanVolVox / Math.PI) : null;
  const diameter = diameterCells != null ? diameterCells * (recipe.known ? recipe.pitch : 1) : null;
  const reason = !stats ? "No grain census was available"
    : !Number.isFinite(fracSolid) || fracSolid < CAST3_COMPLETE || fracSolid > 1 ? "Casting did not reach the declared solid fraction"
    : !Number.isSafeInteger(grainCount) || grainCount <= 0 || diameter == null || !Number.isFinite(diameter) || diameter <= 0 ? "No finite censused grain diameter"
    : !Number.isFinite(recipe.target) || recipe.target <= 0 || !(recipe.pitch > 0) || !Number.isFinite(recipe.pitch) ? "Invalid target or cell pitch"
    : null;
  const error = reason == null && diameter != null ? Math.abs(diameter / recipe.target - 1) : null;
  return { valid: reason == null, reason, diameter, diameterCells, meanVolVox, grainCount, fracSolid,
    error, score: error ?? 1e6 };
}
