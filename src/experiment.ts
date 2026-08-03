/**
 * THE COMPARATOR LAYER — controlled experiments, or nothing renders.
 *
 * This repo has now paid five times for the same measurement mistake, and the
 * five postmortems (tasks/todo.md, v4.0–v7.0) are this module's spec:
 *
 *   1. equal bath temperature is not equal undercooling   (REFINE, v5.0)
 *   2. equal time is not equal progress                    (REFINE, v5.0)
 *   3. equal distance is not equal progress                (QPF-CONVERGE, v5.0)
 *   4. equal substep count is not equal progress           (AT-WIDTH, v5.0)
 *   5. a feedback-coupled same-seed A/B measures its own
 *      divergence, not the change under test                (C0c, v7.0)
 *
 * The rule they all point at: before comparing two runs, name the variable
 * being held fixed and check it is the one the physics is measured against.
 * This module makes both halves structural rather than aspirational:
 *
 *   - a `SweepSpec` cannot be RUN without naming what it holds fixed
 *     (`controlled.name`) and what it sweeps — an undeclared comparison is a
 *     programmer error and throws;
 *   - every cast must return not just its measurement `y` but `ctrl`, the
 *     value of the matching variable it actually achieved, and the bench
 *     REFUSES to render means or bands when the achieved values disagree by
 *     more than the stated tolerance. Naming a proxy no longer helps: if the
 *     arms were matched on wall-clock while claiming matched solid fraction,
 *     the `ctrl` spread says so and the comparison does not render.
 *
 * The answer to postmortem #5 is the replicate axis: instead of differencing
 * one feedback-coupled pair, N seeded replicates per arm give each arm a
 * distribution, and the honest comparison is band against band.
 *
 * Everything here is pure and DOM-free (the `thermal.ts` precedent), so the
 * browser-free CI gate loads it through vite's SSR loader, the GPU gate calls
 * it through `window.__solidify.experiment`, and `verify-heattreat-gpu.mjs`
 * imports the fit instead of inlining it four times.
 */

import { A1, A2, DT_SAFETY } from "./quant";
import { MAX_SEEDS, SOLVER } from "./shaders";
import type { Simulation, StatsResult } from "./sim";
import type { Nucleation } from "./nucleation";
import { seedHex } from "./rng";

// ---------------------------------------------------------------------------
// The through-origin power-law fit and its r²-window band.
//
// Extracted verbatim from scripts/verify-heattreat-gpu.mjs, where it was
// inlined four times (2D scan, 2D fit-at-shipped-m, 3D scan, 3D
// fit-at-shipped-m). The arithmetic is deliberately IDENTICAL to the inline
// original — same accumulation order, same admissibility rule, same rounding —
// so the extraction is a zero-movement refactor of the suite's own estimator
// (EXP-FIT-PARITY holds a verbatim copy of the old inline code against this
// implementation, the PASSSPLIT doctrine applied to statistics).

/** one rung of a growth ladder: `d` (cells) measured after `S` sweeps */
export interface LadderPoint {
  S: number;
  d: number;
}

export interface PowerFit {
  K: number;
  r2: number;
}

/**
 * Fit d^m − d0^m = K·S through the origin at a PINNED exponent m.
 * r² is computed against the law, not against the mean (a through-origin fit
 * has no mean to explain), so ssTot is uncentred.
 */
export function fitPowerAt(pts: LadderPoint[], d0: number, m: number): PowerFit {
  const y0 = Math.pow(d0, m);
  let sxy = 0, sxx = 0;
  for (const p of pts) { const y = Math.pow(p.d, m) - y0; sxy += p.S * y; sxx += p.S * p.S; }
  const K = sxy / sxx;
  let ssRes = 0, ssTot = 0;
  for (const p of pts) {
    const y = Math.pow(p.d, m) - y0;
    ssRes += (y - K * p.S) ** 2;
    ssTot += y * y;
  }
  return { K, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

export interface PowerScan extends PowerFit {
  m: number;
  /** the band of m whose fit is within `r2Tol` of the best — the constant
   *  carries its own uncertainty instead of a spurious three decimals */
  band: [number, number];
}

/**
 * Scan m over [1.0, 4.5] by 0.005, keep the best admissible (K > 0) fit, and
 * report the r²-window band around it. Returns null when no admissible fit
 * exists (all-K-negative data — a shrinking "growth" ladder).
 */
export function scanPower(
  pts: LadderPoint[],
  d0: number,
  opts: { mLo?: number; mHi?: number; step?: number; r2Tol?: number } = {},
): PowerScan | null {
  const { mLo = 1.0, mHi = 4.5, step = 0.005, r2Tol = 0.0005 } = opts;
  let best: PowerScan | null = null;
  for (let m = mLo; m <= mHi; m += step) {
    const f = fitPowerAt(pts, d0, m);
    if (f.K > 0 && (!best || f.r2 > best.r2)) best = { m: +m.toFixed(3), ...f, band: [0, 0] };
  }
  if (!best) return null;
  let lo = best.m, hi = best.m;
  for (let m = mLo; m <= mHi; m += step) {
    const f = fitPowerAt(pts, d0, m);
    if (f.K > 0 && f.r2 >= best.r2 - r2Tol) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  }
  best.band = [+lo.toFixed(2), +hi.toFixed(2)];
  return best;
}

// ---------------------------------------------------------------------------
// Replicate bands.

export interface Band {
  mean: number;
  lo: number;
  hi: number;
  /** hi − lo, in the measurement's own units — what tolerances compare against */
  width: number;
  /** width / |mean|, for printing; 0 when the mean is 0 */
  rel: number;
}

/**
 * The band of N replicates is the RANGE, not a standard deviation: at the
 * N = 2..5 this instrument can afford, a σ is noise dressed as rigour (the
 * GG3-KMC tolerance postmortem reports six-run spreads as ranges for the same
 * reason). The mean is the centre the range brackets.
 */
export function bandOf(ys: number[]): Band {
  if (!ys.length) return { mean: NaN, lo: NaN, hi: NaN, width: NaN, rel: NaN };
  let s = 0, lo = ys[0], hi = ys[0];
  for (const y of ys) { s += y; lo = Math.min(lo, y); hi = Math.max(hi, y); }
  const mean = s / ys.length;
  const width = hi - lo;
  return { mean, lo, hi, width, rel: mean !== 0 ? Math.abs(width / mean) : 0 };
}

// ---------------------------------------------------------------------------
// The sweep bench.

export interface SweepSpec {
  /** what is being measured — the y axis's name, with units in the string */
  name: string;
  /** the ONE swept parameter's name */
  swept: string;
  values: number[];
  /** explicit seeds, one replicate per seed per value — recorded in the
   *  result, because a measurement whose seed is not recorded cannot be
   *  reproduced (C0a doctrine). The CAST callback owns applying the seed
   *  (`setSeed(seed)` before staging), exactly as RNG-REPRO does — that is
   *  the only call that also rewinds the operator's `scatter` stream. */
  seeds: number[];
  /**
   * The matching rule: the variable every run is held fixed on, and the
   * absolute tolerance its achieved values may spread across ALL runs of ALL
   * arms. This is the postmortems' rule made mechanical — the cast returns
   * the achieved value (`ctrl`) and the bench checks it, so matching on a
   * proxy while naming the real variable is caught, not trusted.
   */
  controlled: { name: string; tol: number };
}

export interface Replicate {
  seed: number;
  y: number;
  /** the matching variable's achieved value in this run */
  ctrl: number;
}

export interface SweepRow {
  value: number;
  runs: Replicate[];
  band: Band;
  ctrl: Band;
}

export interface SweepResult {
  spec: SweepSpec;
  rows: SweepRow[];
  /** achieved spread of the controlled variable across every run of every arm */
  ctrlWidth: number;
  /** false ⇒ the comparison refuses to render means or bands */
  ok: boolean;
  refusal: string | null;
}

/**
 * Run every (value × seed) cast sequentially and judge the matched state.
 * An undeclared comparison throws (programmer error); an unmatched or dead
 * one returns `ok: false` with the refusal sentence (physics refusal, the
 * `canTreat`/`domainLimitUm` idiom — refuse while saying exactly why).
 */
export async function runSweep(
  spec: SweepSpec,
  cast: (value: number, seed: number) => Promise<{ y: number; ctrl: number }>,
): Promise<SweepResult> {
  if (!spec.swept?.trim()) throw new TypeError("SweepSpec.swept: a sweep must name the ONE parameter it varies");
  if (!spec.controlled?.name?.trim())
    throw new TypeError("SweepSpec.controlled.name: a comparison that cannot state what it held fixed does not run");
  if (!(spec.controlled.tol > 0))
    throw new TypeError("SweepSpec.controlled.tol: the matching rule needs a stated tolerance, not a vibe");
  if (!spec.values?.length) throw new TypeError("SweepSpec.values: nothing to sweep");
  if (!spec.seeds?.length) throw new TypeError("SweepSpec.seeds: replicates need recorded seeds");

  const rows: SweepRow[] = [];
  let refusal: string | null = null;
  for (const value of spec.values) {
    const runs: Replicate[] = [];
    for (const seed of spec.seeds) {
      const r = await cast(value, seed);
      runs.push({ seed, y: r.y, ctrl: r.ctrl });
      if (!Number.isFinite(r.y) || !Number.isFinite(r.ctrl)) {
        refusal ??= `run (${spec.swept}=${value}, seed ${seedHex(seed)}) returned a non-measurement ` +
          `(y=${r.y}, ${spec.controlled.name}=${r.ctrl}) — a dead run cannot be averaged over`;
      }
    }
    rows.push({ value, runs, band: bandOf(runs.map(r => r.y)), ctrl: bandOf(runs.map(r => r.ctrl)) });
  }
  const all = rows.flatMap(r => r.runs.map(x => x.ctrl));
  const ctrlWidth = bandOf(all).width;
  if (!refusal && !(ctrlWidth <= spec.controlled.tol)) {
    refusal = `controlled variable '${spec.controlled.name}' spread ${fmt(ctrlWidth)} across arms exceeds the ` +
      `stated tolerance ±${fmt(spec.controlled.tol)} — the arms are not matched, so there is nothing to compare`;
  }
  return { spec, rows, ctrlWidth, ok: refusal === null, refusal };
}

/** compact number for report lines: 4 significant digits, no exponent noise */
const fmt = (x: number): string =>
  !Number.isFinite(x) ? String(x)
    : Math.abs(x) !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5) ? x.toExponential(3)
    : +x.toPrecision(4) + "";

/**
 * The text report. The controlled variable is NAMED in the output — that line
 * is the whole point of the layer — and a refused result prints its refusal
 * and the per-run achieved values (the evidence), never the means.
 */
export function sweepText(res: SweepResult): string {
  const s = res.spec;
  const head = `EXPERIMENT  ${s.name}\n` +
    `swept ${s.swept} over [${s.values.map(v => fmt(v)).join(", ")}] · ` +
    `${s.seeds.length} seeded replicates [${s.seeds.map(x => seedHex(x)).join(", ")}]`;
  if (!res.ok) {
    const runs = res.rows.flatMap(r =>
      r.runs.map(x => `  ${s.swept}=${fmt(r.value)}  seed ${seedHex(x.seed)}  ${s.controlled.name}=${fmt(x.ctrl)}`));
    return `${head}\nREFUSED — ${res.refusal}\n${runs.join("\n")}`;
  }
  const lines = res.rows.map(r =>
    `  ${s.swept}=${fmt(r.value)}   ${fmt(r.band.mean)}  [${fmt(r.band.lo)}, ${fmt(r.band.hi)}]` +
    (r.band.rel > 0 ? `  (±${fmt(r.band.rel * 50)}%)` : ""));
  return `${head}\n` +
    `controlled ${s.controlled.name}: spread ${fmt(res.ctrlWidth)} within ±${fmt(s.controlled.tol)}\n` +
    lines.join("\n");
}

// ---------------------------------------------------------------------------
// The scatter band, as geometry first and paint second — `bandLayout` is pure
// and browser-free-testable; `drawBand` is the thin painter over it, in the
// analyze-panel idiom of draw functions that take their ctx.

export interface BandLayout {
  w: number;
  h: number;
  /** every label the panel must carry; a layout with no "controlled" label is
   *  the defect this layer exists to make impossible */
  labels: { kind: "title" | "controlled" | "refusal" | "axis"; text: string }[];
  /** per-arm band spans, in canvas coordinates */
  band: { x: number; yLo: number; yHi: number }[];
  /** per-arm means (polyline) */
  means: { x: number; y: number }[];
  /** every replicate as a scatter point */
  pts: { x: number; y: number }[];
}

export function bandLayout(res: SweepResult, w: number, h: number): BandLayout {
  const s = res.spec;
  const out: BandLayout = { w, h, labels: [{ kind: "title", text: s.name }], band: [], means: [], pts: [] };
  if (!res.ok) {
    out.labels.push({ kind: "refusal", text: `REFUSED — ${res.refusal ?? "unmatched"}` });
    return out;
  }
  out.labels.push({ kind: "controlled", text: `controlled ${s.controlled.name} · spread ${fmt(res.ctrlWidth)} ≤ ±${fmt(s.controlled.tol)}` });
  out.labels.push({ kind: "axis", text: `${s.swept} →` });
  const xs = res.rows.map(r => r.value);
  const ys = res.rows.flatMap(r => r.runs.map(x => x.y));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padL = 34, padR = 10, padT = 22, padB = 18;
  const sx = (v: number) => x1 === x0 ? (w + padL - padR) / 2 : padL + ((v - x0) / (x1 - x0)) * (w - padL - padR);
  const sy = (v: number) => y1 === y0 ? (h + padT - padB) / 2 : h - padB - ((v - y0) / (y1 - y0)) * (h - padT - padB);
  for (const r of res.rows) {
    out.band.push({ x: sx(r.value), yLo: sy(r.band.lo), yHi: sy(r.band.hi) });
    out.means.push({ x: sx(r.value), y: sy(r.band.mean) });
    for (const run of r.runs) out.pts.push({ x: sx(r.value), y: sy(run.y) });
  }
  return out;
}

/** paint a BandLayout — amber band, mean polyline, replicate dots, labels */
export function drawBand(ctx: CanvasRenderingContext2D, res: SweepResult, w: number, h: number): void {
  const L = bandLayout(res, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(15,17,21,0.88)";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "10px ui-monospace, Consolas, monospace";
  ctx.textBaseline = "top";
  let ty = 4;
  for (const lab of L.labels) {
    ctx.fillStyle = lab.kind === "refusal" ? "#e0a050" : lab.kind === "controlled" ? "#9ab8d0" : "#c8d2dc";
    for (const line of wrap(lab.text, Math.max(8, Math.floor((w - 8) / 6)))) {
      ctx.fillText(line, 4, ty);
      ty += 12;
    }
  }
  if (!res.ok) return;
  if (L.band.length > 1) {
    ctx.beginPath();
    for (let i = 0; i < L.band.length; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, L.band[i].x, L.band[i].yHi);
    for (let i = L.band.length - 1; i >= 0; i--) ctx.lineTo(L.band[i].x, L.band[i].yLo);
    ctx.closePath();
    ctx.fillStyle = "rgba(224,160,80,0.18)";
    ctx.fill();
  } else if (L.band.length === 1) {
    ctx.strokeStyle = "rgba(224,160,80,0.5)";
    ctx.beginPath(); ctx.moveTo(L.band[0].x, L.band[0].yLo); ctx.lineTo(L.band[0].x, L.band[0].yHi); ctx.stroke();
  }
  ctx.strokeStyle = "#e0a050";
  ctx.beginPath();
  L.means.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, p.x, p.y));
  ctx.stroke();
  ctx.fillStyle = "#c8d2dc";
  for (const p of L.pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 2 * Math.PI); ctx.fill(); }
}

const wrap = (t: string, cols: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += cols) out.push(t.slice(i, i + cols));
  return out;
};

// ---------------------------------------------------------------------------
// Standard controlled casts. The split of labour: the SPEC stages (params,
// seed, nucleation charge — the caller's job, applied before the cast), the
// CAST runs (reset → advance → measure) and returns { y, ctrl }. Both casts
// drive the solver exclusively through `stepSync` — a frame-paced arm receives
// an unpredictable amount of physics (postmortem #6, v4.0).

/** φ along one row, as a plain array (state texture is (φ, T, c, age)) */
export async function phiRow(sim: Simulation, y: number): Promise<number[] | null> {
  const d = await sim.readRows(y, 1);
  if (!d) return null;
  const out = new Array<number>(sim.n);
  for (let i = 0; i < sim.n; i++) out[i] = d[i * 4];
  return out;
}

/**
 * Sub-cell x where φ crosses 0.5 going right from `from`, or −1.
 * NOTE: `verify-quant.mjs` keeps its own private copy of this crossing on
 * purpose — two independent witnesses asserting the same published constant
 * cross-check each other, where sharing one implementation would let a bug
 * assert itself. Q3b extracts THIS one into the 3D tracker.
 */
export function phiCross(row: number[], from: number): number {
  for (let i = from; i < row.length - 1; i++) {
    if (row[i] >= 0.5 && row[i + 1] < 0.5) {
      return i + (row[i] - 0.5) / (row[i] - row[i + 1]);
    }
  }
  return -1;
}

/** the guaranteed-fresh stats read: readStats returns null while a reduction
 *  is in flight (the app's 4 Hz panel poll races every bench), so retry on
 *  the fence — the measureNow/finishEpisode/measureCensus idiom */
export async function statsRetry(sim: Simulation, tries = 60): Promise<StatsResult | null> {
  for (let t = 0; t < tries; t++) {
    const s = await sim.readStats();
    if (s) return s;
    await sim.device.queue.onSubmittedWorkDone();
  }
  return null;
}

export interface TipCastResult {
  /** V·d₀/D — the dimensionless tip velocity, the KR-1998 anchor's units */
  y: number;
  /** achieved front travel in diffusion lengths ℓ_D = D̃/V (measured V) —
   *  the matching rule of QPF-CONVERGE made explicit */
  ctrl: number;
  vW0: number;
  vMid: number;
  /** last-third velocity over middle-third velocity — 1 at a true plateau */
  plateau: number;
  samples: number;
  tipX: number;
}

/**
 * One steady-tip QPF cast at a given λ: the QPF-CONVERGE arm as a controlled
 * cast. Preconditions (the caller's, all app-level): frame transport stopped,
 * grid at the wanted n, inoculant 0. Everything staged here is the
 * dimensionless benchmark state of `verify-quant.mjs` — solver = QUANT,
 * lengths in W₀, times in τ₀, solved thermal field (frozen T would let the
 * tip accelerate forever).
 */
export async function castTip(
  sim: Simulation,
  opts: { lambda: number; undercool?: number; eps4?: number; dx?: number; noise?: number; vd0dGuess?: number },
): Promise<TipCastResult> {
  const { lambda, undercool = 0.55, eps4 = 0.05, dx = 0.8, noise = 0, vd0dGuess = 0.017 } = opts;
  const dTilde = A2 * lambda;
  const dt = (DT_SAFETY * dx * dx) / Math.max(1, dTilde);
  Object.assign(sim.params, {
    solver: SOLVER.QUANT, lambda, dx, dt,
    epsBar: 1, tau: 1,
    delta: eps4, aniMode: 4, noiseAmp: noise,
    latent: 1, dTherm: dTilde, dSol: dTilde,
    alloyOn: 0, coolRate: 0, heatIn: 0, scen: 0, twinProb: 0, facet: 0,
    frozenT: 0,
  });
  sim.reset(1 - undercool);
  // θ₀ = 0 EXPLICITLY: addSeed's random default puts the groove between two
  // arms on the tracked row and reads exactly like a solver that fails to
  // converge in λ (the QPF-CONVERGE postmortem, measured 0.0129 → 0.0171)
  sim.addSeed(sim.n / 2, sim.n / 2, 8 / dx, 0);
  await sim.stepSync(0);

  const mid = sim.n / 2;
  const x0 = phiCross((await phiRow(sim, mid)) ?? [], mid);
  // distance-scheduled, ℓ_D-normalised: eight diffusion lengths for every arm
  // puts them all at the same place on their own transient (postmortem #3) —
  // the guess only sets the schedule, it never enters the answer
  const vGuess = (vd0dGuess * dTilde * lambda) / A1;
  const travel = (8 * dTilde) / vGuess;
  const NS = 33;
  const chunk = Math.max(50, Math.round(travel / vGuess / NS / dt));
  const trace: { t: number; x: number }[] = [];
  let t = 0;
  for (let k = 0; k < NS; k++) {
    await sim.stepSync(chunk);
    t += chunk * dt;
    const x = phiCross((await phiRow(sim, mid)) ?? [], mid);
    trace.push({ t, x });
    if (x > sim.n * 0.88) break;      // tip is feeling the wall
  }
  const fit = (pts: { t: number; x: number }[]): number => {
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of pts) { sx += p.t; sy += p.x; sxy += p.t * p.x; sxx += p.t * p.t; }
    return ((pts.length * sxy - sx * sy) / (pts.length * sxx - sx * sx)) * dx;
  };
  const third = Math.floor(trace.length / 3);
  const vW0 = fit(trace.slice(2 * third));
  const vMid = fit(trace.slice(third, 2 * third));
  const xEnd = trace.length ? trace[trace.length - 1].x : -1;
  const lD = dTilde / vW0;                       // measured ℓ_D, in W₀
  return {
    y: (vW0 * A1) / (A2 * lambda * lambda),
    // a melting-back front has no diffusion-length travel: with vW0 < 0 both
    // (xEnd − x0) and ℓ_D flip sign and the two flips CANCEL into a plausible
    // positive "travel" — the one shape of wrong ctrl the spread check could
    // not see, so it is refused here at the source
    ctrl: x0 >= 0 && xEnd >= 0 && vW0 > 0 ? ((xEnd - x0) * dx) / lD : NaN,
    vW0, vMid, plateau: vMid !== 0 ? vW0 / vMid : NaN,
    samples: trace.length, tipX: xEnd / sim.n,
  };
}

export interface CensusCastResult {
  grainCount: number;
  meanAreaPx: number;
  fracSolid: number;
  /** the per-grain diameter census, at readStats' own precision — what
   *  "the same casting" means (two runs can agree on how MANY grains formed
   *  while disagreeing about every one of them — the RNG-REPRO doctrine) */
  diamsUm: number[];
  /**
   * Solid fraction at the read IF the cast reached the declared read point;
   * NaN on a budget exit. A cast that ran out of `maxChunks` below `fsRead`
   * did not measure at its declared state, and returning the achieved
   * fraction here would let two arms that both budget-exited at similar
   * fractions render as "matched" at a state nobody declared — the achieved
   * value is still in `fracSolid` for the refusal to print.
   */
  ctrl: number;
  /** sites the nucleation model fired — the liveness witness */
  fired: number;
  substeps: number;
}

/**
 * One nucleation-LIVE cast read at a matched solid fraction. This is the cast
 * the science page said could not exist yet: the interactive harness fires
 * sites off frame-loop stats readbacks, so a `stepSync`-driven run used to
 * mean a nucleation-dead run (the RNG-REPRO first-draft lesson). Here the
 * bench drives the model synchronously between fence-paced chunks — update →
 * stepSync → readStats → observe, the frame loop's own order — so a cast with
 * emergent nucleation is deterministic per seed and its physics budget is
 * exact.
 *
 * Caller stages params (coolRate, aniMode, …), `nuc.p` (nmax, ΔT_N, ΔT_σ) and
 * the seed; this cast owns reset → advance → measure. Run it through
 * `__solidify.experiment`, whose host wrapper raises `benchHold` for the
 * duration — that flag holds off both the frame loop's transport (a live
 * `running` would inject frame-paced nuc.update + sim.step around these
 * chunks) and the 4 Hz panel poll's wall-clock-timed `nuc.observe`, which
 * would poison the ratchet.
 */
export async function castCensus(
  sim: Simulation,
  nuc: Nucleation,
  opts: { undercool: number; fsRead?: number; chunk?: number; maxChunks?: number; tEq?: number },
): Promise<CensusCastResult> {
  const { undercool, fsRead = 0.5, chunk = 120, maxChunks = 80, tEq = 1 } = opts;
  sim.reset(1 - undercool);
  nuc.stage(sim.n, false);
  const fired0 = nuc.fired;
  let st: StatsResult | null = null;
  let substeps = 0;
  for (let k = 0; k < maxChunks; k++) {
    let emitted = 0;
    nuc.update(sim.simTime, Math.max(0, sim.params.coolRate),
      (x, y, _z, d) => { sim.addSeed(x, y, 3.5, undefined, d); emitted++; });
    // drain the stamp queue BEFORE growing: a submit stamps at most MAX_SEEDS,
    // so a burst larger than one batch would otherwise split at a point set by
    // whether the frame loop's idle step(0) got a rAF in — wall clock deciding
    // where in the cast a seed lands is exactly the irreproducibility this
    // bench exists to remove (the RNG-REPRO drain, sized to the burst)
    for (let i = 0; i < Math.ceil(emitted / MAX_SEEDS) + 1; i++) await sim.stepSync(0);
    substeps += await sim.stepSync(chunk);
    st = await statsRetry(sim);
    if (st) nuc.observe(sim.simTime, st.meanLiqT, tEq);
    if (st && st.fracSolid >= fsRead) break;
  }
  const fs = st?.fracSolid ?? NaN;
  return {
    grainCount: st?.grainCount ?? NaN,
    meanAreaPx: st?.meanAreaPx ?? NaN,
    fracSolid: fs,
    diamsUm: st?.diamsUm ?? [],
    ctrl: fs >= fsRead ? fs : NaN,
    fired: nuc.fired - fired0,
    substeps,
  };
}
