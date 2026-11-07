/**
 * C3b, primary static recrystallization: the pure arithmetic.
 *
 * Design and citations: docs/C3B-RECRYSTALLIZATION-DESIGN.md. This module
 * holds only what can be checked without a GPU (verify-recrystallize.mjs):
 *
 *   - avramiFit: the JMAK exponent n from ln(-ln(1-X)) against ln S over a
 *     declared window of X. S is the MONTE CARLO SWEEP clock. A linear
 *     rescaling of S moves only the intercept, so n is clock-invariant in
 *     that sense, but sweeps are not linear in furnace seconds (ramps, the
 *     model's own growth exponent), so n must never be labelled a real-time
 *     exponent;
 *   - sweepSchedule: log-spaced sample sweeps, so an Avrami plot gets points
 *     across decades instead of crowding the late, saturated end;
 *   - growthBarrier / revertBarrier: Potts bond counting. At T = 0 a matrix
 *     cell joins an H = 0 nucleus when the stored energy it releases, H (in
 *     bond energies J_b), exceeds the bonds the flip breaks; a nucleus cell
 *     reverts when the bonds it would heal exceed H. The classic triangular
 *     lattice thresholds (one-site nucleus grows above H/J = 4, three-site
 *     above 2; Anderson, Grest & Srolovitz, LA-UR-86-421, OSTI 6050460) and
 *     the 26-neighbour flat-front barrier H_FLAT_3D = 8 all come out of the
 *     same counter.
 */

/** the X window an Avrami fit uses by default: past 0.95 the late-time
 *  impingement and finite-size tail bend the line, below 0.05 one nucleus's
 *  discreteness does */
export const AVRAMI_WINDOW: [number, number] = [0.05, 0.95];

export interface AvramiFit {
  /** the Avrami exponent: the slope of ln(-ln(1-X)) against ln S */
  n: number;
  /** the intercept, ln k in X = 1 - exp(-k S^n) */
  lnK: number;
  r2: number;
  /** points inside the window that the fit used */
  used: number;
  /** points outside the window (or with S <= 0), excluded and counted */
  excluded: number;
  window: [number, number];
}

/**
 * Fit X(S) = 1 - exp(-k S^n) on the points with window[0] <= X <= window[1].
 * `x0`, the fraction already recrystallized at S = 0 (the inserted nuclei'
 * own volume), raises the lower bound to max(window[0], 3 x0): the nuclei's
 * starting volume is a constant offset the JMAK form does not have, and near
 * X ~ x0 it dominates the left end of the line. The raised bound REDUCES that
 * bias, it does not remove it (RX-AVRAMI-FIT: n = 3 data with x0 = 0.04 fits
 * 2.25 with the plain window and 2.72 with the raised one), which is why the
 * GPU acceptance gate fits against one nucleus's own volume, not against S.
 * Refuses with a sentence when
 * fewer than four points fall in the window or the window holds X = 1.
 */
export function avramiFit(S: number[], X: number[], window: [number, number] = AVRAMI_WINDOW, x0 = 0):
  AvramiFit | { why: string } {
  const lo = Math.max(window[0], 3 * Math.max(x0, 0)), hi = window[1];
  if (!(hi > lo)) return { why: `the nuclei start at X = ${x0.toFixed(3)}, too close to the window's top for a fit` };
  const xs: number[] = [], ys: number[] = [];
  let excluded = 0;
  for (let i = 0; i < Math.min(S.length, X.length); i++) {
    const s = S[i], x = X[i];
    if (!(s > 0) || !Number.isFinite(x) || x < lo || x > hi) { excluded++; continue; }
    if (x >= 1) return { why: "the window holds a fully recrystallized point (X = 1), where ln(-ln(1-X)) is infinite" };
    xs.push(Math.log(s));
    ys.push(Math.log(-Math.log(1 - x)));
  }
  if (xs.length < 4) return { why: `only ${xs.length} point${xs.length === 1 ? "" : "s"} fall between X = ${lo.toFixed(2)} and ${hi.toFixed(2)}; an Avrami fit needs four` };
  const m = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / m, my = ys.reduce((a, b) => a + b, 0) / m;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < m; i++) {
    sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2;
  }
  if (!(sxx > 0)) return { why: "every point in the window sits at one sweep count" };
  const n = sxy / sxx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  return { n, lnK: my - n * mx, r2, used: m, excluded, window: [lo, hi] };
}

/** `count` sample sweeps, log-spaced over [first, last], strictly increasing
 *  integers (duplicates from rounding at the low end are dropped) */
export function sweepSchedule(first: number, last: number, count: number): number[] {
  const a = Math.max(1, Math.round(first)), b = Math.max(a, Math.round(last));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const s = Math.round(a * Math.pow(b / a, count === 1 ? 1 : i / (count - 1)));
    if (!out.length || s > out[out.length - 1]) out.push(s);
  }
  return out;
}

/** neighbour offsets: the triangular lattice (axial coordinates, 6) and the
 *  simple-cubic 26-neighbour stencil the 3D anneal uses */
export const TRIANGULAR: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, -1, 0], [-1, 1, 0]];
export const CUBIC26: number[][] = (() => {
  const o: number[][] = [];
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++)
    if (x || y || z) o.push([x, y, z]);
  return o;
})();

const key = (p: number[]) => p.join(",");

/** unlike-neighbour count of `p` if it carried `inNucleus`, given the set */
function unlike(p: number[], nb: number[][], set: Set<string>, inNucleus: boolean): number {
  let u = 0;
  for (const d of nb) {
    const q = key([p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
    if (set.has(q) !== inNucleus) u++;
  }
  return u;
}

/**
 * The smallest bond cost (in J_b) for a matrix cell adjacent to the nucleus
 * to flip into it: min over those cells of (unlike after - unlike before).
 * At T = 0 the nucleus can grow when the released stored energy H exceeds it.
 */
export function growthBarrier(nucleus: number[][], nb: number[][]): number {
  const set = new Set(nucleus.map(key));
  let best = Infinity;
  const seen = new Set<string>();
  for (const p of nucleus) for (const d of nb) {
    const q = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
    const k = key(q);
    if (set.has(k) || seen.has(k)) continue;
    seen.add(k);
    best = Math.min(best, unlike(q, nb, set, true) - unlike(q, nb, set, false));
  }
  return best;
}

/**
 * The largest bond gain (in J_b) any nucleus cell would collect by reverting
 * to the matrix: max over nucleus cells of (unlike now - unlike reverted). At
 * T = 0 that cell reverts unless the stored energy it would take back on, H,
 * exceeds it.
 */
export function revertBarrier(nucleus: number[][], nb: number[][]): number {
  const set = new Set(nucleus.map(key));
  let worst = -Infinity;
  for (const p of nucleus) worst = Math.max(worst, unlike(p, nb, set, true) - unlike(p, nb, set, false));
  return worst;
}

/** a digital sphere: every cell whose centre lies within r of the origin */
export function digitalSphere(r: number): number[][] {
  const out: number[][] = [];
  const R = Math.ceil(r);
  for (let z = -R; z <= R; z++) for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++)
    if (x * x + y * y + z * z <= r * r) out.push([x, y, z]);
  return out;
}

/**
 * The flat-front barrier: the bond cost for the matrix cell just outside a
 * flat nucleus face to join it. The face is z <= 0 for a 3D stencil and
 * y <= 0 for a planar one (all offsets with z = 0), patched wide enough that
 * the test cell sees no edge.
 */
export function flatFrontBarrier(nb: number[][]): number {
  const planar = nb.every(d => d[2] === 0);
  const set = new Set<string>();
  for (let a = -2; a <= 0; a++) for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++)
    set.add(key(planar ? [c, a, 0] : [c, b, a]));
  const q = planar ? [0, 1, 0] : [0, 0, 1];
  return unlike(q, nb, set, true) - unlike(q, nb, set, false);
}

/**
 * Free ids on the volume's grain-id down-counter (sim3d.ts), which annealing
 * twins, growth twins and recrystallization nuclei all draw from. It starts at
 * `top` (MAX_GRAINS3 - 2; the id above is the pore census) and counts down
 * toward the cast's own ids below `nextId`, keeping `margin` ids clear of them.
 *
 * The GPU growth-twin pass `atomicSub`s on EVERY twin attempt, refused or not,
 * so a long cast with twinning on can carry the counter past 0 and wrap the
 * u32 to ~4.29e9. Read naively that wrapped value is "four billion free ids":
 * the range a caller then allocates starts far past the end of every per-id
 * buffer. A counter above `top` has wrapped and has no free ids at all.
 */
export function freeGrainIds(ctr: number, nextId: number, top: number, margin = 2): number {
  if (!Number.isFinite(ctr) || ctr > top) return 0;
  return Math.max(0, ctr - nextId - margin);
}
