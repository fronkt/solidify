/**
 * D3, melt flow: the pure arithmetic of slice 1 (forced flow, 2D).
 *
 * Design and citations: docs/D3-CONVECTION-DESIGN.md. Nothing here runs on the
 * GPU; it is what the lattice Boltzmann pass and its gates will lean on, and
 * it is checked by verify-flow.mjs without a browser.
 *
 * The solid enters the flow as Beckermann's diffuse-interface drag, in Tong,
 * Beckermann, Karma & Li 2001 (PRE 63:061601, Eq. 6) form: on the
 * superficial velocity u = (1 - phi) V the drag is -nu 2h phi^2 u / W^2. The
 * constant h is chosen so that plane shear flow past the diffuse interface
 * behaves as if a sharp no-slip wall sat at phi = 0.5; Tong quotes h = 2.757
 * from Beckermann et al. 1999's asymptotic analysis. Here h is DERIVED, not
 * typed: the steady planar shear equation u'' = 2h phi(x)^2 u / W^2 is
 * integrated across this repo's own interface profile and h is solved for the
 * far-field line to extrapolate to zero exactly at phi = 0.5.
 */

/** the calibrated solver's interface: phi = (1 - tanh(x / (sqrt2 W))) / 2, x
 *  measured into the liquid from phi = 0.5 (shaders.ts STAMP, solver 1) */
export const calibratedProfile = (x: number): number => 0.5 * (1 - Math.tanh(x / Math.SQRT2));

/**
 * Where plane shear flow past the profile appears to stop, in units of W,
 * relative to the phi = 0.5 plane (negative = inside the solid). RK4 from
 * deep in the solid, where u decays as exp(sqrt(2h) x), out to the
 * drag-free liquid, where u is linear and its zero is read off directly.
 */
export function noSlipOffset(h: number, profile = calibratedProfile, span = 12, dx = 1e-3): number {
  const f = (x: number, u: number) => 2 * h * profile(x) ** 2 * u;
  let x = -span, u = 1e-12, v = Math.sqrt(2 * h) * u;
  while (x < span) {
    const k1u = v, k1v = f(x, u);
    const k2u = v + 0.5 * dx * k1v, k2v = f(x + 0.5 * dx, u + 0.5 * dx * k1u);
    const k3u = v + 0.5 * dx * k2v, k3v = f(x + 0.5 * dx, u + 0.5 * dx * k2u);
    const k4u = v + dx * k3v, k4v = f(x + dx, u + dx * k3u);
    u += (dx / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    v += (dx / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    x += dx;
  }
  return x - u / v;
}

/** the drag constant that puts the apparent no-slip plane at phi = 0.5 on
 *  `profile` (bisection on noSlipOffset, which rises with h) */
export function deriveDragH(profile = calibratedProfile): number {
  let lo = 1, hi = 6;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (noSlipOffset(mid, profile, 12, 2e-3) < 0) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Tong et al. 2001's published value, kept only to be compared against */
export const DRAG_H_PUBLISHED = 2.757;

/**
 * The lattice Boltzmann numbers for one LBM step per phase-field substep.
 * `d` is the diffusion number D dt / dx^2 the solver runs at (the calibrated
 * solver's 0.15, Kobayashi's 0.133), `Pr` the Prandtl (pure melt) or Schmidt
 * (alloy) number, and `uLat` the inflow speed in lattice units (dx / dt).
 */
export function latticeOf(d: number, Pr: number, uLat: number) {
  const nu = d * Pr;                       // kinematic viscosity, lattice units
  return {
    nu,
    tau: 0.5 + 3 * nu,                     // BGK/TRT symmetric relaxation time
    mach: uLat * Math.sqrt(3),             // u / c_s, c_s = 1 / sqrt(3)
    peCell: uLat / d,                      // u dx / D
  };
}

/** the stability envelope (docs/D3-CONVECTION-DESIGN.md section 2) */
export const FLOW_LIMITS = { tauMin: 0.51, machMax: 0.1, peCellMax: 2 } as const;

/** the limits a lattice setting breaks, as sentences; empty when it is safe */
export function flowLimitIssues(l: ReturnType<typeof latticeOf>): string[] {
  const out: string[] = [];
  if (!(l.tau >= FLOW_LIMITS.tauMin)) out.push(`relaxation time ${l.tau.toFixed(3)} is under ${FLOW_LIMITS.tauMin}: the lattice viscosity is too small to be stable`);
  if (!(l.mach <= FLOW_LIMITS.machMax)) out.push(`lattice Mach number ${l.mach.toFixed(3)} is over ${FLOW_LIMITS.machMax}: compressibility error`);
  if (!(l.peCell <= FLOW_LIMITS.peCellMax)) out.push(`cell Peclet number ${l.peCell.toFixed(2)} is over ${FLOW_LIMITS.peCellMax}: central advection would oscillate`);
  return out;
}

export interface FlowContext {
  dim3: boolean;
  scenario: number;          // 0 = free growth; others impose temperature
  frozenTemperature: boolean;
  alloy: boolean;
  grid: number;
  busyMode: string | null;   // "heat treatment" | "optimizer" | "challenge" | null
}

/**
 * Why melt flow cannot run here, or null when it can. One predicate, so the
 * control, the share-link applier and the solver refuse for the same reasons.
 */
export function flowRefusal(c: FlowContext): string | null {
  if (c.dim3) return "Melt flow is 2D only in this version.";
  if (c.busyMode) return `Melt flow is off while the ${c.busyMode} owns the melt; its model assumes still liquid.`;
  if (c.scenario !== 0) return "This scenario imposes its own temperature field, so there is nothing for the flow to carry. Use free growth.";
  if (c.frozenTemperature && !c.alloy) return "With the temperature field frozen, a pure melt has nothing for the flow to transport.";
  if (c.grid > 1024) return "At 2048² the flow's populations exceed the GPU's default storage-buffer limit. Use 1024² or smaller.";
  return null;
}

/** the 2D Ivantsov relation for a parabolic needle: undercooling from the
 *  growth Peclet number, Delta = sqrt(pi P) e^P erfc(sqrt P) */
export function ivantsov2D(P: number): number {
  return Math.sqrt(Math.PI * P) * Math.exp(P) * erfc(Math.sqrt(P));
}

/** the growth Peclet number for a 2D undercooling (bisection; Delta < 1) */
export function ivantsov2DPeclet(delta: number): number {
  let lo = 1e-9, hi = 50;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (ivantsov2D(mid) < delta) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** complementary error function (W. J. Cody's rational approximations are
 *  overkill here; this continued-fraction/series pair is good to ~1e-12) */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) {
    // series for erf
    let sum = x, term = x;
    for (let n = 1; n < 80; n++) { term *= -x * x / n; sum += term / (2 * n + 1); }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // continued fraction (Lentz) for erfc at larger x
  let f = 0;
  for (let k = 60; k >= 1; k--) f = (k / 2) / (x + f);
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
}
