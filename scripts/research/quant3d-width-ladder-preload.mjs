// CPU-only synthetic browser for quant3d-width-ladder.mjs --run. It returns
// exact paraboloid tips whose operating state follows a declared truth, so the
// real CLI's schedule, metrology, boundary, verdict and evidence plumbing can
// be exercised without Chrome or a GPU. Values here are never physics evidence.
import puppeteer from 'puppeteer-core';
import { ARCHIVED, IVANTSOV_PECLET, ladderPredictions } from './quant3d-width-ladder-model.mjs';

const mode = process.env.Q3C_LADDER_MOCK ?? 'quadratic';
if (!['quadratic', 'flat', 'gpu-error', 'unstable'].includes(mode)) throw new Error(`unknown ladder mock mode ${mode}`);
const predictions = ladderPredictions();
let config = null, steps = 0;
const truth = lambda => {
  const pick = key => mode === 'flat' || mode === 'unstable' ? ARCHIVED.base[key] : predictions[key].at[lambda].quadratic;
  const Vd0OverD = pick('Vd0OverD'), ratio = pick('rhoOverRhoIv');
  const D = .6267 * lambda, d0 = .8839 / lambda;
  return { V: Vd0OverD * D / d0, rho: ratio * 2 * D * IVANTSOV_PECLET / (Vd0OverD * D / d0) };
};
const fixture = {
  stage(c) { config = c; steps = 0; return { bytesPerVoxel: 61, shaderHashes: ['CPU-only synthetic'] }; },
  advance(count) { steps += count; return { steps, time: steps * config.dt, count, seconds: .001, minTau: 1 }; },
  sample() {
    const time = steps * config.dt, { V, rho } = truth(config.lambda);
    // The unstable mode drifts the radius 30% over the run: stationarity must refuse it.
    const r = mode === 'unstable' ? rho * (1 + .3 * time / config.maximumTimeTau0) : rho;
    const tip = steps === 0 ? config.radius : config.radius + V * time, points = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const X = (x + .5) * config.dx, Y = (y + .5) * config.dx, z = tip - (X * X + Y * Y) / (2 * r);
      points.push({ x: X, y: Y, xCell: x, yCell: y, z, zCoarse: z, zRaw: z });
    }
    return { steps, time, points };
  },
  equivalence() {
    return { checkpoints: [1, 17, 64].map(target => ({ target, comparisons: ['state', 'grain', 'age'].map(field =>
      ({ field, mismatches: 0, productionHash: 'CPU-only', specializedHash: 'CPU-only' })) })) };
  },
  destroy() {},
};
globalThis.window = { __q3tip: fixture, __solidify: { app: { meta: () => ({ build: 'CPU-only synthetic' }) } },
  __solidifyTipDevice: { destroy() {} }, __solidifyTipDeviceErrors: mode === 'gpu-error' ? ['manufactured GPU error'] : [] };
const page = {
  on() {}, async goto() {}, async waitForFunction() {},
  async evaluate(fn, arg) { if (fn.name === 'installQuant3TipDriver') return; return await fn(arg); },
};
puppeteer.launch = async () => ({ async newPage() { return page; }, process() { return null; }, async close() {}, async disconnect() {} });
