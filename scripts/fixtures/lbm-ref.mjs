// A Float64 CPU reference of src/lbm.ts (D3.5): the same D2Q9 two-relaxation-
// time step with Guo forcing and Beckermann's drag treated implicitly, pull
// streaming, free-slip y walls (the mirror population of the boundary cell),
// a zero-gradient outlet, and either west inlet:
//
//   "velocity"     Zou & He 1997's velocity inlet (non-equilibrium bounce-back
//                  of the normal pair, the transverse correction on the
//                  diagonals): rho from the six known populations, then the
//                  three unknown ones so that the node's momentum is (rho U, 0).
//   "equilibrium"  the shipped inlet up to v7-experiments 3b3fbdd: the three
//                  unknown populations are feq(rho = 1, u = (U, 0)). It fixes
//                  the density as well as the velocity, so back-pressure from
//                  a blockage cuts the throughput (D3.4: 0.82 U at n 848).
//
// It mirrors the WGSL operation for operation (same population order, same
// moment sums, same collision), in double precision, so it predicts what the
// GPU gates read and proves the inlet algebra without a browser. Used by
// scripts/verify-flow.mjs (browser-free) and scripts/verify-flow-gpu.mjs
// (Node side, the predicted fluxes). Design: docs/D3-CONVECTION-DESIGN.md,
// addendum D3.5.

export const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
export const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
export const WT = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
/** the population with its y velocity reversed (free-slip mirror) */
export const MY = [0, 1, 4, 3, 2, 8, 7, 6, 5];
/** the TRT magic product (src/lbm.ts TRT_LAMBDA) */
export const TRT_LAMBDA = 0.25;

export function feq(i, rho, ux, uy) {
  const cu = CX[i] * ux + CY[i] * uy;
  return WT[i] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

/**
 * Zou-He velocity inlet on a WEST node. `f` holds the node's nine pulled
 * populations; the six known ones (cx <= 0: 0, 2, 3, 4, 6, 7) are read and the
 * three that would have come from outside (cx = +1: 1, 5, 8) are written so
 * that rho = sum f and (sum c f) = (rho U, 0). Returns that rho.
 *   rho (1 - U) = f0 + f2 + f4 + 2 (f3 + f6 + f7)
 *   f1 = f3 + (2/3) rho U                       (normal pair: f1neq = f3neq)
 *   f5 = f7 - (f2 - f4)/2 + (1/6) rho U         (diagonals: the transverse
 *   f8 = f6 + (f2 - f4)/2 + (1/6) rho U          correction zeroes rho u_y)
 */
export function zouHeWest(f, U) {
  const A = f[0] + f[2] + f[4], C = f[3] + f[6] + f[7];
  const rho = (A + 2 * C) / (1 - U);
  const j = rho * U, t = 0.5 * (f[2] - f[4]);
  f[1] = f[3] + (2 / 3) * j;
  f[5] = f[7] - t + j / 6;
  f[8] = f[6] + t + j / 6;
  return rho;
}

/** this repo's interface profile around a disk of radius R centred at (cx, cy),
 *  stored as the GPU texture stores it (f32): phi = (1 - tanh((r - R)/(sqrt2 W)))/2 */
export function diskPhi(n, cx, cy, R, W) {
  const phi = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - cx, y - cy);
    phi[y * n + x] = Math.fround(0.5 * (1 - Math.tanh((r - R) / (Math.SQRT2 * W))));
  }
  return phi;
}

export class LbmRef {
  /**
   * @param {number} n  square lattice side
   * @param {{nu:number,uIn?:number,channel?:boolean,width?:number,h?:number,
   *          force?:[number,number],phi?:Float64Array|null,inlet?:"velocity"|"equilibrium"}} cfg
   */
  constructor(n, cfg) {
    this.n = n;
    this.cfg = { uIn: 0, channel: false, width: 0, force: [0, 0], phi: null, inlet: "velocity", ...cfg };
    const c = this.cfg;
    if (c.width > 0 && !(c.h > 0)) throw new Error("LbmRef: pass the drag constant h (flow.ts deriveDragH)");
    const tauP = 0.5 + 3 * c.nu, tauM = 0.5 + TRT_LAMBDA / (tauP - 0.5);
    this.omegaP = 1 / tauP;
    this.omegaM = 1 / tauM;
    this.dragK = c.width > 0 ? (2 * c.h * c.nu) / (c.width * c.width) : 0;
    this.f = [new Float64Array(n * n * 9), new Float64Array(n * n * 9)];
    this.cur = 0;
    this.steps = 0;
    // the velocity texture: (u.x, u.y, rho, K) as of the last step
    this.ux = new Float64Array(n * n);
    this.uy = new Float64Array(n * n);
    this.rho = new Float64Array(n * n);
    this.K = new Float64Array(n * n);
    this.Kfield = new Float64Array(n * n);
    if (c.phi) for (let k = 0; k < n * n; k++) {
      const ph = Math.min(1, Math.max(0, c.phi[k]));
      this.Kfield[k] = this.dragK * ph * ph;
    }
    this.init(() => [c.channel ? c.uIn : 0, 0]);
  }

  /** equilibrium populations at rho = 1 and the given velocity (FlowSolver.init) */
  init(vel) {
    const n = this.n, a = this.f[0];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const [ux, uy] = vel(x, y);
      for (let i = 0; i < 9; i++) a[(y * n + x) * 9 + i] = feq(i, 1, ux, uy);
    }
    this.f[1].set(a);
    this.cur = 0;
    this.steps = 0;
  }

  /**
   * Where each population is pulled from: idx[node * 9 + i] is an index into
   * the population array, or -1 for a population that enters through the
   * west inlet. Built once from exactly the rule of lbm.ts pull(): a source
   * row outside [0, n) takes the mirror population of the cell itself (free
   * slip), x wraps when periodic, x >= n reads column n - 1 (zero-gradient
   * outlet) and x < 0 is the inlet.
   */
  pullTable() {
    if (this.idx) return this.idx;
    const n = this.n, chan = this.cfg.channel, idx = new Int32Array(n * n * 9);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let i = 0; i < 9; i++) {
      let sx = x - CX[i], sy = y - CY[i], j = i, v;
      if (sy < 0 || sy >= n) { sy = y; j = MY[i]; }
      if (!chan) sx = (sx + n) % n;
      else if (sx >= n) sx = n - 1;
      v = chan && sx < 0 ? -1 : (sy * n + sx) * 9 + j;
      idx[(y * n + x) * 9 + i] = v;
    }
    return (this.idx = idx);
  }

  /** advance k lattice steps */
  step(k) {
    const n = this.n, c = this.cfg, chan = c.channel, U = c.uIn;
    const velInlet = chan && c.inlet === "velocity";
    const eqIn = Array.from({ length: 9 }, (_, i) => feq(i, 1, U, 0));
    const wP = this.omegaP, wM = this.omegaM, sP = 1 - 0.5 * wP, sM = 1 - 0.5 * wM;
    const [Fbx, Fby] = c.force;
    const idx = this.pullTable(), Kf = this.Kfield;
    const UX = this.ux, UY = this.uy, RH = this.rho, KK = this.K;
    const fl = new Float64Array(9);
    const w0 = WT[0], w1 = WT[1], w5 = WT[5];
    const nn = n * n;
    for (let s = 0; s < k; s++) {
      const src = this.f[this.cur], dst = this.f[1 - this.cur];
      for (let node = 0; node < nn; node++) {
        const base = node * 9;
        let f0, f1, f2, f3, f4, f5, f6, f7, f8;
        if (chan && node % n === 0) {
          for (let i = 0; i < 9; i++) { const v = idx[base + i]; fl[i] = v >= 0 ? src[v] : eqIn[i]; }
          if (velInlet) zouHeWest(fl, U);
          f0 = fl[0]; f1 = fl[1]; f2 = fl[2]; f3 = fl[3]; f4 = fl[4]; f5 = fl[5]; f6 = fl[6]; f7 = fl[7]; f8 = fl[8];
        } else {
          f0 = src[idx[base]]; f1 = src[idx[base + 1]]; f2 = src[idx[base + 2]];
          f3 = src[idx[base + 3]]; f4 = src[idx[base + 4]]; f5 = src[idx[base + 5]];
          f6 = src[idx[base + 6]]; f7 = src[idx[base + 7]]; f8 = src[idx[base + 8]];
        }
        // moments in the WGSL's order (i = 0..8)
        const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
        const mx = f1 - f3 + f5 - f6 - f7 + f8;
        const my = f2 - f4 + f5 + f6 - f7 - f8;
        const K = Kf[node], den = rho * (1 + 0.5 * K);
        const ux = (mx + 0.5 * Fbx) / den, uy = (my + 0.5 * Fby) / den;
        const Fx = Fbx - rho * K * ux, Fy = Fby - rho * K * uy;
        UX[node] = ux; UY[node] = uy; RH[node] = rho; KK[node] = K;
        const uu = 1.5 * (ux * ux + uy * uy), uF = ux * Fx + uy * Fy;
        // feq_i = w rho (1 + 3 cu + 4.5 cu^2 - 1.5 u.u); a pair (i, o = OPP[i]) has
        // cu of opposite sign, so ep = w rho (1 + 4.5 cu^2 - 1.5 u.u) and em = 3 w rho cu.
        // Guo's source: sA = 3 w c.F (odd in c), sS = w (9 (c.u)(c.F) - 3 u.F) (even).
        // For o, fm - em and sA flip sign. The rest population has fm = em = sA = 0.
        dst[base] = f0 - wP * (f0 - w0 * rho * (1 - uu)) + sP * (w0 * (-3 * uF));
        let cu, cF, ep, em, fp, fm, sA, sS;
        // (1, 3): c = (1, 0)
        cu = ux; cF = Fx;
        ep = w1 * rho * (1 + 4.5 * cu * cu - uu); em = w1 * rho * 3 * cu;
        fp = 0.5 * (f1 + f3); fm = 0.5 * (f1 - f3); sA = w1 * 3 * cF; sS = w1 * (9 * cu * cF - 3 * uF);
        dst[base + 1] = f1 - wP * (fp - ep) - wM * (fm - em) + sM * sA + sP * sS;
        dst[base + 3] = f3 - wP * (fp - ep) + wM * (fm - em) - sM * sA + sP * sS;
        // (2, 4): c = (0, 1)
        cu = uy; cF = Fy;
        ep = w1 * rho * (1 + 4.5 * cu * cu - uu); em = w1 * rho * 3 * cu;
        fp = 0.5 * (f2 + f4); fm = 0.5 * (f2 - f4); sA = w1 * 3 * cF; sS = w1 * (9 * cu * cF - 3 * uF);
        dst[base + 2] = f2 - wP * (fp - ep) - wM * (fm - em) + sM * sA + sP * sS;
        dst[base + 4] = f4 - wP * (fp - ep) + wM * (fm - em) - sM * sA + sP * sS;
        // (5, 7): c = (1, 1)
        cu = ux + uy; cF = Fx + Fy;
        ep = w5 * rho * (1 + 4.5 * cu * cu - uu); em = w5 * rho * 3 * cu;
        fp = 0.5 * (f5 + f7); fm = 0.5 * (f5 - f7); sA = w5 * 3 * cF; sS = w5 * (9 * cu * cF - 3 * uF);
        dst[base + 5] = f5 - wP * (fp - ep) - wM * (fm - em) + sM * sA + sP * sS;
        dst[base + 7] = f7 - wP * (fp - ep) + wM * (fm - em) - sM * sA + sP * sS;
        // (6, 8): c = (-1, 1)
        cu = -ux + uy; cF = -Fx + Fy;
        ep = w5 * rho * (1 + 4.5 * cu * cu - uu); em = w5 * rho * 3 * cu;
        fp = 0.5 * (f6 + f8); fm = 0.5 * (f6 - f8); sA = w5 * 3 * cF; sS = w5 * (9 * cu * cF - 3 * uF);
        dst[base + 6] = f6 - wP * (fp - ep) - wM * (fm - em) + sM * sA + sP * sS;
        dst[base + 8] = f8 - wP * (fp - ep) + wM * (fm - em) - sM * sA + sP * sS;
      }
      this.cur = 1 - this.cur;
      this.steps++;
    }
  }

  /**
   * Column statistics of the velocity field, normalised by U:
   *   V[x] = mean_y u_x / U        (the column-mean velocity advection reads)
   *   Q[x] = mean_y rho u_x / U    (the mass flux, D3.4's statistic)
   *   R[x] = mean_y rho
   */
  columns() {
    const n = this.n, U = this.cfg.uIn;
    const V = new Float64Array(n), Q = new Float64Array(n), R = new Float64Array(n);
    for (let x = 0; x < n; x++) {
      let v = 0, q = 0, r = 0;
      for (let y = 0; y < n; y++) { const k = y * n + x; v += this.ux[k]; q += this.rho[k] * this.ux[k]; r += this.rho[k]; }
      V[x] = v / n / U; Q[x] = q / n / U; R[x] = r / n;
    }
    return { V, Q, R };
  }

  /** the domain-mean density (sum of every population / n^2) */
  meanRho() {
    const a = this.f[this.cur];
    let s = 0;
    for (let k = 0; k < a.length; k++) s += a[k];
    return s / (this.n * this.n);
  }
}

/** a field accessor over this reference's arrays */
export const fieldOfRef = L => ({ ux: k => L.ux[k], uy: k => L.uy[k], rho: k => L.rho[k], K: k => L.K[k] });
/** a field accessor over a FlowSolver velocity texture read back (u.x, u.y, rho, K per cell) */
export const fieldOfTexture = v => ({ ux: k => v[4 * k], uy: k => v[4 * k + 1], rho: k => v[4 * k + 2], K: k => v[4 * k + 3] });

/**
 * The statistics the D3.5 inlet gates read, from a GPU texture or this
 * reference alike (scripts/verify-flow.mjs FLOW-INLET-CPU and
 * scripts/verify-flow-gpu.mjs FLOW-INLET-*), all normalised by U:
 *   V[x]   column-mean velocity mean_y u_x / U (the pass statistic)
 *   Q[x]   column-mean mass flux mean_y rho u_x / U; conserve = max |Q/Q[0] - 1|
 *   inletX / inletY  max over the inlet nodes (x = 0, every y) of
 *          |u_x / U - 1| and |u_y| / U
 *   mirror max |u_x(x, y) - u_x(x, n-1-y)| and |u_y(x, y) + u_y(x, n-1-y)|, / U
 *   with opts.probe = [x, y] and opts.dragK: the probe node's |u| / U and
 *   K / dragK; with opts.gapColumn: the largest u_x / U on that column.
 */
export function inletStats(n, U, g, opts = {}) {
  const V = new Float64Array(n), Q = new Float64Array(n), Rm = new Float64Array(n);
  let uyMax = 0, inletX = 0, inletY = 0, mirror = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x, m = (n - 1 - y) * n + x;
    V[x] += g.ux(k); Q[x] += g.rho(k) * g.ux(k); Rm[x] += g.rho(k);
    uyMax = Math.max(uyMax, Math.abs(g.uy(k)) / U);
    mirror = Math.max(mirror, Math.abs(g.ux(k) - g.ux(m)) / U, Math.abs(g.uy(k) + g.uy(m)) / U);
    if (x === 0) { inletX = Math.max(inletX, Math.abs(g.ux(k) / U - 1)); inletY = Math.max(inletY, Math.abs(g.uy(k)) / U); }
  }
  for (let x = 0; x < n; x++) { V[x] /= n * U; Q[x] /= n * U; Rm[x] /= n; }
  const Vs = Array.from(V), Qs = Array.from(Q);
  const out = {
    V: Vs, Q: Qs, Vmin: Math.min(...Vs), Vmax: Math.max(...Vs), V0: Vs[0], Vout: Vs[n - 1],
    conserve: Math.max(...Qs.map(q => Math.abs(q / Qs[0] - 1))), Q0: Qs[0],
    rhoIn: Rm[0], rhoOut: Rm[n - 1], uyMax, inletX, inletY, mirror,
  };
  if (opts.probe) {
    const c = opts.probe[1] * n + opts.probe[0];
    out.centreSpeed = Math.hypot(g.ux(c), g.uy(c)) / U;
    if (opts.dragK) out.centreK = g.K(c) / opts.dragK;
  }
  if (opts.gapColumn !== undefined) {
    let gm = -Infinity;
    for (let y = 0; y < n; y++) gm = Math.max(gm, g.ux(y * n + opts.gapColumn) / U);
    out.gapMax = gm;
  }
  return out;
}

/** FLOW-INLET-BLOCKED's validity on one arm: steady between the two reads,
 *  mass-conserving, the disk blocking and the flow going round it */
export function blockedValidity(mid, end) {
  const steady = Math.max(...end.V.map((v, x) => Math.abs(v - mid.V[x])));
  return { steady, ok: steady <= 1e-4 && end.conserve <= 2e-3 && end.centreSpeed <= 0.01 && end.centreK >= 0.99 && end.gapMax >= 1.05 };
}

/** the D3.5 gate geometries (tasks/todo.md, "D3.5 velocity inlet - 2026-11-07") */
export const INLET_GATES = {
  nu: 0.15 * 23.1, U: 0.011404004977938682, W: 1.25,
  A: { n: 64, start: 0.5, steps: 8000 },
  B: { n: 128, cx: 64, cy: 63.5, R: 9.6, mid: 14000, steps: 16000, probe: [64, 63], gapColumn: 64 },
};

/**
 * The verdicts of FLOW-INLET-EMPTY, -BLOCKED and -COLUMN (verify-flow-gpu.mjs)
 * from per-inlet statistics { stepsA, stepsB, A, Bmid, B } of the measured run
 * (`run`) and of this reference (`ref`), with the pre-registered bands. Pure,
 * so verify-flow.mjs exercises it without a browser.
 */
export function inletVerdicts(run, ref) {
  const G = INLET_GATES, rv = run.velocity, re = run.equilibrium, cv = ref.velocity, ce = ref.equilibrium;
  const maxAbs = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const brief = (st, d = 6) => Object.fromEntries(Object.entries(st).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, +v.toPrecision(d)]));
  const devV = Math.max(...rv.A.V.map(v => Math.abs(v - 1)));
  const empty = {
    ok: rv.stepsA === G.A.steps && re.stepsA === G.A.steps && devV <= 1e-3 && rv.A.uyMax <= 1e-4 && re.A.Vmax < 0.98,
    detail: {
      velocity: { maxAbsVminus1: +devV.toExponential(3), uyMaxOfU: +rv.A.uyMax.toExponential(3), refMaxAbsVminus1: +Math.max(...cv.A.V.map(v => Math.abs(v - 1))).toExponential(3) },
      equilibriumArm: { Vmax: +re.A.Vmax.toFixed(6), refVmax: +ce.A.Vmax.toFixed(6), misses: re.A.Vmax < 0.98 }, steps: rv.stepsA,
    },
  };
  const vv = blockedValidity(rv.Bmid, rv.B), ve = blockedValidity(re.Bmid, re.B);
  const refDiff = maxAbs(rv.B.V, cv.B.V), armRefDiff0 = Math.abs(re.B.V0 - ce.B.V0);
  const pass = rv.B.Vmin >= 0.98 && rv.B.Vmax <= 1.02 && vv.ok && refDiff <= 2e-3;
  const armMisses = re.B.Vmax < 0.98 && ve.ok && armRefDiff0 <= 0.01;
  const blocked = {
    ok: pass && armMisses && rv.stepsB === G.B.steps && re.stepsB === G.B.steps,
    detail: {
      velocity: { ...brief(rv.B), steady: +vv.steady.toExponential(2), valid: vv.ok, maxAbsVminusRef: +refDiff.toExponential(3), ref: brief(cv.B) },
      equilibriumArm: { ...brief(re.B), steady: +ve.steady.toExponential(2), valid: ve.ok, V0minusRef: +armRefDiff0.toExponential(3),
        refV0: +ce.B.V0.toFixed(6), backPressure: re.B.rhoIn > re.B.rhoOut, misses: re.B.Vmax < 0.98 },
      steps: rv.stepsB,
    },
  };
  const column = {
    ok: rv.B.inletX <= 1e-4 && rv.B.inletY <= 1e-4 && re.B.inletX > 1e-4,
    detail: {
      velocity: { maxAbsUxOverUminus1: +rv.B.inletX.toExponential(3), maxAbsUyOverU: +rv.B.inletY.toExponential(3) },
      equilibriumArm: { maxAbsUxOverUminus1: +re.B.inletX.toExponential(3), maxAbsUyOverU: +re.B.inletY.toExponential(3), misses: re.B.inletX > 1e-4 },
      ref: { velocity: +cv.B.inletX.toExponential(2), equilibrium: +ce.B.inletX.toExponential(3) },
    },
  };
  return { empty, blocked, column };
}

/** run one arm of each geometry on this reference: { A, Bmid, B } statistics */
export function inletReference(inlet, h) {
  const { nu, U, W, A: GA, B: GB } = INLET_GATES;
  const a = new LbmRef(GA.n, { nu, uIn: U, channel: true, inlet });
  a.init(() => [GA.start * U, 0]);
  a.step(GA.steps);
  const b = new LbmRef(GB.n, { nu, uIn: U, channel: true, width: W, h, phi: diskPhi(GB.n, GB.cx, GB.cy, GB.R, W), inlet });
  const opts = { probe: GB.probe, gapColumn: GB.gapColumn, dragK: b.dragK };
  b.step(GB.mid);
  const Bmid = inletStats(GB.n, U, fieldOfRef(b), opts);
  b.step(GB.steps - GB.mid);
  return { A: inletStats(GA.n, U, fieldOfRef(a)), Bmid, B: inletStats(GB.n, U, fieldOfRef(b), opts),
    levelA: a.meanRho(), levelB: b.meanRho(), stepsA: a.steps, stepsB: b.steps };
}
