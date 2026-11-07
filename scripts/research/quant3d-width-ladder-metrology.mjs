// CPU-only known-truth controls for the Q3c interface-width ladder.
// The unchanged local-tip estimator (scripts/fixtures/quant3d-tip-analysis.mjs)
// is applied to manufactured Float32 phase brackets at the tip resolutions the
// ladder arms are predicted to reach at dx/W0 = 0.8. Exit status is nonzero
// only if a declared control fails its declared bound; every measurement is
// written to the report either way.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localTip, phaseCrossing, operatingState } from '../fixtures/quant3d-tip-analysis.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Predicted local tip radii in W0 for the ladder (rho/d0 = 57.454 from the
// archived a11a814 candidate base arm, held fixed; d0/W0 = 0.8839/lambda).
// These set sampling resolution only; no measured outcome enters a verdict.
export const LADDER_RESOLUTION = Object.freeze({ dx: .8, rhoOverD0: 57.45403565690062,
  lambdas: Object.freeze([5, 4.4, 4, 3.6]) });
export const ladderRadii = () => LADDER_RESOLUTION.lambdas.map(lambda =>
  ({ lambda, rho: LADDER_RESOLUTION.rhoOverD0 * .8839 / lambda }));

// Axisymmetric secant profile A0(s)/(2s) = 1 + (a s + b s^2)/(1 + c s), fitted
// on 2026-11-07 to the archived candidate base terminal checkpoints (depths
// 0.05-2.25 rho, max residual 0.0029) by quant3d-q3c-tip-replay.py. Its apex
// curvature is exactly 1/rho, so the declared truth is rho.
const MEASURED = Object.freeze({ a: .69486, b: .05737, c: 2.2991, A: 1 / 10.51, alpha: 1.679 });
export const LADDER_MODELS = Object.freeze([
  Object.freeze({ name: 'paraboloid', a: 0, b: 0, c: 0, A: 0, alpha: 1.68 }),
  Object.freeze({ name: 'KR-epsilon0171', a: 0, b: 0, c: 0, A: 1 / 10.1, alpha: 1.68 }),
  Object.freeze({ name: 'measured-apex-profile', ...MEASURED }),
  // Twice the measured axisymmetric distortion: a declared stress input.
  Object.freeze({ name: 'doubled-apex-distortion', stress: true, ...MEASURED, a: 2 * MEASURED.a, b: 2 * MEASURED.b }),
]);
// Declared bounds (fixed before the first run of this file): for every
// non-stress model each static sample must resolve and recover rho within 1%,
// and the moving sequence must recover V within 0.25% and sigma within 2.5%
// (one quarter of the 10% reference band). The stress model is reported only.
export const LADDER_BOUNDS = Object.freeze({ staticRho: .01, motionVelocity: .0025, motionSigma: .025 });

function height(model, x, y, tip, rho) {
  const X = x / rho, Y = y / rho, r2 = X * X + Y * Y;
  if (r2 === 0) return tip;
  const cos4 = (X ** 4 - 6 * X * X * Y * Y + Y ** 4) / (r2 * r2);
  const f = s => 2 * s * (1 + (model.a * s + model.b * s * s) / (1 + model.c * s)) + model.A * s ** model.alpha * cos4;
  let lo = 0, hi = Math.max(r2, 1e-10);
  for (let i = 0; f(hi) < r2 && i < 40; i++) hi *= 1.5;
  assert(f(hi) >= r2, 'manufactured surface must be single-valued');
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) < r2) lo = mid; else hi = mid; }
  return tip - rho * (lo + hi) / 2;
}

export function ladderSample(model, rho, dx, offset) {
  const points = [], tip = 100 + offset * dx, limit = Math.max(8 * dx, .65 * rho);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const X = (x + .5) * dx, Y = (y + .5) * dx;
    if (X * X + Y * Y > limit * limit) continue;
    const z = height(model, X, Y, tip, rho);
    let j = Math.floor(z / dx - .5);
    const phase = k => Math.fround(.5 * (1 - Math.tanh(((j + k + .5) * dx - z) / Math.SQRT2)));
    for (let i = 0; phase(1) >= .5 && i < 6; i++) j++;
    for (let i = 0; phase(0) < .5 && i < 6; i++) j--;
    assert(phase(0) >= .5 && phase(1) < .5, 'Float32 phase crossing must be bracketed');
    const values = [-2, -1, 0, 1, 2, 3].map(phase);
    points.push({ x: X, y: Y, xCell: x, yCell: y, z: (j + .5 + phaseCrossing(values)) * dx,
      zCoarse: (j + .5 + phaseCrossing(values.slice(1, 5), [-1, 0, 1, 2])) * dx });
  }
  return { points, tip };
}

export function runLadderMetrology() {
  const { dx } = LADDER_RESOLUTION, offsets = Array.from({ length: 10 }, (_, i) => i / 10);
  const statics = [], motion = [];
  for (const { lambda, rho } of ladderRadii()) for (const model of LADDER_MODELS) {
    for (const offset of offsets) {
      let q = null, refusal = null;
      try { q = localTip(ladderSample(model, rho, dx, offset).points, dx); } catch (error) { refusal = error.message; }
      statics.push({ lambda, model: model.name, rho, rhoOverDx: rho / dx, offset, refusal,
        rhoRelativeError: q ? q.rho / rho - 1 : null, advertisedRelative: q ? q.rhoError / q.rho : null,
        covered: q ? Math.abs(q.rho - rho) <= q.rhoError : false });
    }
    // Moving tip: twelve checkpoints at the protocol cadence in base units.
    const D = .6267 * lambda, d0 = .8839 / lambda;
    const V = 2 * .052696 * .330293 ** 2 * D / d0; // archived candidate base selection, rescaled
    const period = 32.370331090315965 * (4 / lambda) ** 3, samples = [];
    let refusal = null;
    try {
      for (let i = 0; i < 12; i++) {
        const time = 1000 + i * period, travel = V * time, cells = Math.floor(travel / dx);
        const q = localTip(ladderSample(model, rho, dx, travel / dx - cells).points, dx);
        samples.push({ ...q, tip: q.tip + cells * dx, time, steps: i });
      }
    } catch (error) { refusal = error.message; }
    const state = refusal ? null : operatingState(samples, { D, d0, dims: [400, 400, 900], dx, relativeTarget: .1 });
    const trueSigma = 2 * D * d0 / (rho * rho * V);
    motion.push({ lambda, model: model.name, rho, V, refusal,
      velocityRelativeError: state ? state.velocity / V - 1 : null,
      sigmaRelativeError: state ? state.sigmaStar / trueSigma - 1 : null,
      resolved: state?.resolved ?? false, stationary: state?.stationary ?? false });
  }
  const stress = new Set(LADDER_MODELS.filter(model => model.stress).map(model => model.name));
  const failures = [
    ...statics.filter(row => !stress.has(row.model)).filter(row => row.refusal || Math.abs(row.rhoRelativeError) > LADDER_BOUNDS.staticRho)
      .map(row => ({ kind: 'static', ...row })),
    ...motion.filter(row => !stress.has(row.model)).filter(row => row.refusal || Math.abs(row.velocityRelativeError) > LADDER_BOUNDS.motionVelocity
      || Math.abs(row.sigmaRelativeError) > LADDER_BOUNDS.motionSigma).map(row => ({ kind: 'motion', ...row })),
  ];
  const summary = ladderRadii().map(({ lambda, rho }) => ({ lambda, rhoOverDx: rho / dx,
    models: LADDER_MODELS.map(model => {
      const rows = statics.filter(row => row.lambda === lambda && row.model === model.name && !row.refusal);
      const m = motion.find(row => row.lambda === lambda && row.model === model.name);
      const err = rows.map(row => row.rhoRelativeError);
      return { model: model.name, resolved: rows.length, covered: rows.filter(row => row.covered).length,
        rhoRelativeError: err.length ? [Math.min(...err), Math.max(...err)] : null,
        motionVelocityRelativeError: m.velocityRelativeError, motionSigmaRelativeError: m.sigmaRelativeError,
        motionResolved: m.resolved };
    }) }));
  return { bounds: LADDER_BOUNDS, resolution: LADDER_RESOLUTION, models: LADDER_MODELS, summary, statics, motion,
    failures, passed: failures.length === 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'verify-out/q3c-width-ladder-metrology');
  mkdirSync(out, { recursive: true });
  const paths = ['scripts/research/quant3d-width-ladder-metrology.mjs', 'scripts/fixtures/quant3d-tip-analysis.mjs'];
  const hashes = () => Object.fromEntries(paths.map(p => [p, sha(readFileSync(resolve(ROOT, p)))]));
  const sourceHashes = hashes(), report = runLadderMetrology();
  report.sourceHashes = sourceHashes;
  report.sourceStable = JSON.stringify(sourceHashes) === JSON.stringify(hashes());
  writeFileSync(resolve(out, 'width-ladder-metrology.json'), JSON.stringify(report, null, 2) + '\n');
  for (const row of report.summary) for (const m of row.models) console.log('LADDER-METROLOGY', JSON.stringify({ lambda: row.lambda,
    rhoOverDx: +row.rhoOverDx.toFixed(2), ...m }));
  console.log('LADDER-METROLOGY', report.passed && report.sourceStable ? 'PASS' : 'FAIL', JSON.stringify({ failures: report.failures.length }));
  if (!report.passed || !report.sourceStable) process.exitCode = 1;
}
