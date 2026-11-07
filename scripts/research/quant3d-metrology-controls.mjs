// CPU research diagnostic. Exit zero means the measurements completed;
// known-truth coverage failures remain failures in the saved report.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localTip, phaseCrossing, operatingState } from '../fixtures/quant3d-tip-analysis.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(process.argv[2] ?? 'verify-out/q3-metrology-controls');
mkdirSync(out, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['scripts/research/quant3d-metrology-controls.mjs', 'scripts/fixtures/quant3d-tip-analysis.mjs'];
const hashes = () => Object.fromEntries(paths.map(path => [path, sha(readFileSync(resolve(repo, path)))]));
const sourceHashes = hashes();
const rho = 13, offsets = Array.from({ length: 10 }, (_, i) => i / 10);
const models = [
  { name: 'paraboloid', A: 0, alpha: 1.68 },
  { name: 'KR-weak', epsilon4: .0066, A: 1 / 13, alpha: 1.78 },
  { name: 'KR-epsilon0171', epsilon4: .0171, A: 1 / 10.1, alpha: 1.68 },
  { name: 'KR-strong', epsilon4: .047, A: 1 / 4, alpha: 1.54 },
  // A direct Cartesian height makes this entire surface smooth, including
  // its fourfold term. B is a synthetic stress coefficient, not a KR datum.
  { name: 'smooth-A0-stress', direct: true, A: 1 / 10.1, alpha: 1.68,
    B: .5, beta: 1.25, crossover4: .01, crossover0: .001 },
];

function height(model, x, y, tip) {
  const X = x / rho, Y = y / rho, r2 = X * X + Y * Y;
  const h4 = X ** 4 - 6 * X * X * Y * Y + Y ** 4;
  if (model.direct) {
    // h4*(r2+c)^(alpha-2) and r2^2*(r2+c)^(beta-2) are smooth for c>0.
    // Both start at fourth order, so the exact principal radii are rho.
    return tip + rho * (-r2 / 2
      + model.A / 2 ** (model.alpha + 1) * h4 * (r2 + 2 * model.crossover4) ** (model.alpha - 2)
      + model.B / 2 ** (model.beta + 1) * r2 * r2 * (r2 + 2 * model.crossover0) ** (model.beta - 2));
  }
  // Published-style morphology: r²=2s+A*s^alpha*cos(4theta), s=(tip-z)/rho.
  // alpha>1 makes its exact local curvature 1/rho; no target radius is fitted.
  const cos4 = h4 / (r2 * r2), f = s => 2 * s + model.A * s ** model.alpha * cos4;
  let lo = 0, hi = Math.max(r2, 1e-10);
  for (let i = 0; f(hi) < r2 && i < 30; i++) hi *= 1.5;
  assert(f(hi) >= r2, 'manufactured surface must be single-valued in the measured region');
  for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (f(mid) < r2) lo = mid; else hi = mid; }
  return tip - rho * (lo + hi) / 2;
}

function sample(model, dx, offset) {
  const points = [], raw = [], tip = 100 + offset * dx, limit = Math.max(8 * dx, .65 * rho);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const X = (x + .5) * dx, Y = (y + .5) * dx;
    if (X * X + Y * Y > limit * limit) continue;
    const z = height(model, X, Y, tip);
    let j = Math.floor(z / dx - .5);
    const phase = k => Math.fround(.5 * (1 - Math.tanh(((j + k + .5) * dx - z) / Math.SQRT2)));
    // Match the real driver's Float32 crossing scan, including psi=.5 ties.
    for (let i = 0; phase(1) >= .5 && i < 6; i++) j++;
    for (let i = 0; phase(0) < .5 && i < 6; i++) j--;
    assert(phase(0) >= .5 && phase(1) < .5, 'Float32 phase crossing must be bracketed');
    const values = [-2, -1, 0, 1, 2, 3].map(phase);
    points.push({ x: X, y: Y, z: (j + .5 + phaseCrossing(values)) * dx,
      zCoarse: (j + .5 + phaseCrossing(values.slice(1, 5), [-1, 0, 1, 2])) * dx,
      zRaw: (j + .5 + phaseCrossing(values, [-2, -1, 0, 1, 2, 3], 'raw')) * dx });
    raw.push({ xCell: x, yCell: y, zCell: j, trueHeight: z, phaseBracket: values });
  }
  return { points, raw, tip };
}

const observations = [], rawControls = [];
for (const model of models) for (const dx of [.8, .6, .4]) for (const offset of offsets) {
  const input = sample(model, dx, offset), q = localTip(input.points, dx);
  observations.push({ model: model.name, dx, offset, trueRho: rho, rho: q.rho, rhoError: q.rhoError,
    radiusRelativeError: q.rho / rho - 1, sigmaRelativeErrorAtFixedSpeed: (rho / q.rho) ** 2 - 1,
    truthCovered: Math.abs(q.rho - rho) <= q.rhoError, windows: q.windows,
    interpolation: q.interpolation });
  if (offset === 0) rawControls.push({ model: model.name, dx, offset, trueRho: rho, trueTip: input.tip, points: input.raw });
}
const summaries = models.map(model => {
  const rows = observations.filter(row => row.model === model.name);
  return { model, samples: rows.length, covered: rows.filter(row => row.truthCovered).length,
    radiusRelativeError: [Math.min(...rows.map(row => row.radiusRelativeError)), Math.max(...rows.map(row => row.radiusRelativeError))],
    sigmaRelativeErrorAtFixedSpeed: [Math.min(...rows.map(row => row.sigmaRelativeErrorAtFixedSpeed)), Math.max(...rows.map(row => row.sigmaRelativeErrorAtFixedSpeed))],
    largestAdvertisedRelativeRadiusError: Math.max(...rows.map(row => row.rhoError / row.rho)) };
});
const motion = [];
for (const model of models.filter(model => ['KR-epsilon0171', 'smooth-A0-stress'].includes(model.name))) {
  const dx = .8, V = .11, samples = [];
  for (let i = 0; i < 12; i++) {
    const time = i * 20, travel = V * time, offset = travel / dx % 1;
    const q = localTip(sample(model, dx, offset).points, dx);
    samples.push({ ...q, tip: q.tip + Math.floor(travel / dx) * dx, time });
  }
  const state = operatingState(samples, { D: 2.5, d0: .2, dims: [256, 256, 512], dx, relativeTarget: .1 });
  const trueSigma = 2 * 2.5 * .2 / (rho * rho * V), trueSigmaRelativeError = state.sigmaStar / trueSigma - 1;
  motion.push({ model: model.name, trueRho: rho, trueVelocity: V, trueSigma,
    state, trueSigmaRelativeError,
    advertisedSigmaIntervalMiss: Math.abs(trueSigmaRelativeError) > state.uncertainty.sigmaStar,
    falseResolved: state.resolved && Math.abs(trueSigmaRelativeError) > .1 });
}
const rawBytes = Buffer.from(JSON.stringify({ source: 'deterministic manufactured Float32 phase brackets; no evolved GPU state',
  coordinates: 'voxel centers, first-octant x/y; six z offsets [-2,-1,0,1,2,3]', models, rawControls }, null, 2) + '\n');
writeFileSync(resolve(out, 'raw-controls.json'), rawBytes);
const report = {
  purpose: 'Known-truth model-form coverage diagnostic; completion is not numerical acceptance',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceHashes,
  reference: { url: 'https://arxiv.org/pdf/patt-sol/9607005', location: 'Eq.8, Table I and morphology discussion',
    distinction: 'Published alpha/A define fourfold controls; B/beta/crossovers are declared synthetic stress inputs, never fitted to a desired P or sigma' },
  exactCurvature: 'Each correction is higher than quadratic at the axis; the Hessian is -I/rho, so both local principal radii equal rho',
  smoothControlScope: 'Mathematically smooth direct height; its axisymmetric crossover radius is sqrt(2*.001)*13=.581 W0, below the diffuse width. This is not evidence that an evolved dendrite has that crossover.',
  sampling: { rho, dx: [.8, .6, .4], offsets, profile: 'Float32 .5*(1-tanh((z-height)/sqrt(2)))', grid: '40x40 voxel centers, local radius cap' },
  raw: { path: 'raw-controls.json', bytes: rawBytes.length, sha256: sha(rawBytes), representativeSnapshots: rawControls.length },
  summaries, motion, observations, sourceStable: JSON.stringify(sourceHashes) === JSON.stringify(hashes()),
};
assert(report.sourceStable, 'metrology source changed during CPU controls');
writeFileSync(resolve(out, 'metrology-controls.json'), JSON.stringify(report, null, 2) + '\n');
for (const row of summaries) console.log('METROLOGY-COVERAGE', row.covered === row.samples ? 'COVERED' : 'UNDERCOVERED', JSON.stringify(row));
for (const row of motion) console.log('METROLOGY-MOTION', JSON.stringify({ model: row.model, stationary: row.state.stationary,
  resolved: row.state.resolved, advertisedSigmaUncertainty: row.state.uncertainty.sigmaStar,
  actualSigmaRelativeError: row.trueSigmaRelativeError, falseResolved: row.falseResolved }));
console.log('Measurements saved:', resolve(out, 'metrology-controls.json'));
