/**
 * CALIBRATED MODE — the Karma–Rappel thin-interface calibration.
 *
 * Under the Kobayashi solver the interface width and the relaxation time are
 * free dials: you pick ε̄ and τ, a dendrite appears, and its tip radius is a
 * shape rather than a prediction. `units.ts` says so out loud — the capillary
 * group d₀/W is reported as *not defined*, because there is no calibrated
 * surface energy anywhere in that model to define it with.
 *
 * The quantitative model closes that hole. Karma & Rappel's thin-interface
 * asymptotics relate the phase-field parameters to the two real numbers a
 * material actually has — the capillary length d₀ = Γ/ΔT₀ and the diffusivity
 * D — through
 *
 *     d₀ = a₁ W₀ / λ                      (capillary)
 *     τ₀ = a₂ λ W₀² / D                   (zero interface kinetics, β = 0)
 *
 * so once λ is chosen, W₀ and τ₀ are *forced*, and with them the physical size
 * of a cell and the physical length of a timestep. Nothing is left to taste.
 * That is what turns tip velocity, tip radius and arm spacing from decoration
 * into predictions, and it is why the SDAS ruler starts reading 10–40 µm — the
 * number a micrograph of the same alloy would give — instead of whatever a
 * declared 1 mm domain happened to imply.
 *
 * **λ is the only knob, and it is a convergence knob, not a physics knob.**
 * λ sets W₀/d₀ = λ/a₁: how many capillary lengths wide the diffuse interface
 * is. The asymptotics are exact as W₀/d₀ → 0, so every result must be checked
 * for independence of λ — that is `QPF-CONVERGE`, and it is the test that a
 * pretty dendrite cannot pass by looking pretty.
 *
 * The upper bound on λ is physical, not numerical: the thin-interface limit
 * needs W₀ ≪ ℓ_D = D/V, the diffusion length at the tip. Deeply undercooled
 * pure melts grow fast and have a short ℓ_D, so they need a *small* λ; alloys
 * at realistic undercooling have ℓ_D of many microns and tolerate λ in the tens,
 * which is exactly why alloy phase-field papers can afford interfaces that a
 * pure-melt paper cannot. `feasibleLambda` states that bound rather than leaving
 * it to be discovered as a wrong answer.
 */

import type { MaterialSI } from "./units";

/**
 * Thin-interface constants for the double-well + (1−φ²)² coupling used here.
 * These are properties of the chosen interpolation functions, not of any
 * material, and they are the same for the pure and the dilute-alloy model.
 */
export const A1 = 0.8839;          // 5√2/8 — capillary:  d₀ = a₁W₀/λ
export const A2 = 0.6267;          // kinetics:  τ₀ = a₂λW₀²/D  ⇒  β = 0
/** anti-trapping current coefficient, 1/(2√2) */
export const A_T = 0.35355339059;

/** cells per W₀. 0.8 resolves the tanh profile; 0.4 is the accuracy setting. */
export const DX_PER_W0 = 0.8;
/**
 * Explicit-Euler margin. The 9-point Laplacian's diagonal weight is 20/6, so
 * the stability edge is dt = (6/20)·dx²/D̃ = 0.3·dx²/D̃; half of it is the
 * margin every other timestep in this app already carries.
 */
export const DT_SAFETY = 0.15;

/** what one dimensionless degree means, and why */
export interface QuantSetup {
  /** the coupling — the one thing chosen */
  lambda: number;
  /** W₀/d₀: how many capillary lengths wide the model interface is */
  wOverD0: number;
  /** capillary length, m */
  d0: number;
  /** interface width, m */
  W0: number;
  /** relaxation time, s */
  tau0: number;
  /** dimensionless diffusivity of the transporting field, = a₂λ */
  dTilde: number;
  /** the diffusivity that anchors time, m²/s (D_l for an alloy, α for a pure melt) */
  D: number;
  /** kelvin one dimensionless degree is worth: L/c_p pure, the freezing range ΔT₀ alloy */
  dT0: number;
  /** latent coupling the solver must run so that (L/c_p)/latent == dT0 */
  latent: number;
  /** derived, not chosen: µm per cell */
  umPerCell: number;
  dx: number;
  dt: number;
  /** diffusion length at which the thin-interface limit stops being thin */
  maxLambdaAt(velocity: number): number;
  warnings: string[];
}

export interface QuantInput {
  si: MaterialSI;
  /** solute field live? picks d₀'s reference interval and which D anchors time */
  alloy: boolean;
  /** nominal solute, wt% — only read when `alloy` */
  c0wt: number;
  /** the coupling */
  lambda: number;
  /** cells per W₀ */
  dxPerW0?: number;
}

/**
 * The reference temperature interval: what "one dimensionless degree" buys.
 *
 * For a pure melt it is the unit undercooling L/c_p — the same interval the
 * Kobayashi heat equation was implicitly using all along (see units.ts). For an
 * alloy it is the **freezing range** ΔT₀ = |m|c∞(1−k)/k, which is a far smaller
 * number: 66 K for Al–4Cu against 336 K for pure aluminium. That single swap is
 * why calibrated alloy undercoolings land in the 1–10 K band a foundry would
 * recognise without anyone touching the nucleation model.
 */
export function referenceInterval(si: MaterialSI, alloy: boolean, c0wt: number): number {
  if (!alloy) return si.L / si.cp;
  const k = Math.min(0.999, Math.max(1e-3, si.kPart));
  return (Math.abs(si.mL) * Math.max(1e-6, c0wt) * (1 - k)) / k;
}

/**
 * Build the calibration. Everything except λ and the resolution-per-W₀ is
 * forced; the caller does not get to disagree with any of it.
 */
export function calibrate(inp: QuantInput): QuantSetup {
  const { si, alloy, c0wt } = inp;
  const lambda = Math.max(0.05, inp.lambda);
  const dxPerW0 = inp.dxPerW0 ?? DX_PER_W0;
  const warnings: string[] = [];

  const dT0 = referenceInterval(si, alloy, c0wt);
  const d0 = si.Gamma / dT0;
  const W0 = (lambda * d0) / A1;
  // an alloy dendrite is set by solute; a pure melt has no solute to be set by
  const D = alloy ? si.Dl : si.alphaTh;
  const tau0 = (A2 * lambda * W0 * W0) / D;
  const dTilde = A2 * lambda;

  const dx = dxPerW0;
  const dt = (DT_SAFETY * dx * dx) / Math.max(1, dTilde);
  const umPerCell = W0 * dx * 1e6;
  // (L/c_p)/latent is the kelvin scale units.ts derives from the heat equation,
  // so asking for a reference interval of dT0 IS asking for this latent
  const latent = si.L / si.cp / dT0;

  if (alloy && c0wt <= 0) warnings.push("alloy calibration with no solute — ΔT₀ is undefined");
  if (si.Gamma <= 0) warnings.push("no Gibbs–Thomson coefficient for this material");
  if (dxPerW0 > 1.0) warnings.push(`dx = ${dxPerW0}·W₀ under-resolves the tanh profile`);

  return {
    lambda, wOverD0: lambda / A1, d0, W0, tau0, dTilde, D, dT0, latent,
    umPerCell, dx, dt,
    maxLambdaAt: (v: number) => feasibleLambda(D, v, d0),
    warnings,
  };
}

/**
 * The physical ceiling on λ at a given growth velocity.
 *
 * The thin-interface asymptotics assume the interface is thin compared with the
 * diffusion length ℓ_D = D/V. Taking W₀ ≤ ℓ_D/10 as the working rule and
 * substituting W₀ = λd₀/a₁ gives λ ≤ a₁·D/(10·V·d₀). Deeply undercooled pure
 * melts grow fast, so this can be a small number — which is the real reason a
 * pure-melt validation runs at λ ≈ 3 while an alloy runs at λ ≈ 30, and not a
 * matter of taste.
 */
export function feasibleLambda(D: number, velocity: number, d0: number): number {
  if (!(velocity > 0) || !(d0 > 0)) return Infinity;
  return (A1 * D) / (10 * velocity * d0);
}

/**
 * Critical nucleus radius in CELLS: below it a stamped seed correctly dissolves.
 *
 * Gibbs–Thomson says a curved interface is in equilibrium at ΔT = Γκ, so in
 * dimensionless form R* = d₀/Δ, which in units of W₀ is (a₁/λ)/Δ. This is a
 * real behaviour change the quantitative solver brings: under Kobayashi a
 * 3-cell seed always survived, and under KR it will vanish at shallow
 * undercooling unless it is born above critical — which is what a heterogeneous
 * nucleus on a substrate actually is.
 */
export function criticalRadiusCells(lambda: number, undercool: number, dx: number): number {
  if (!(undercool > 0)) return Infinity;
  return A1 / (lambda * undercool * Math.max(1e-9, dx));
}
