// CPU arithmetic contracts for the production 3D optimizer model.
// Synthetic censuses below verify formulas and refusal rules; real casts,
// voxel readback, lifecycle, and replay remain verify-optimizer3d.mjs gates.
//
//   node scripts/verify-optimizer3d-model.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom", logLevel: "error",
});
let failures = 0;
let checks = 0;
const check = (name, run) => {
  checks++;
  try { run(); console.log(name, "OK"); }
  catch (error) { failures++; console.error(name, "FAIL", error.message); }
};
const close = (actual, expected, label = "value") => {
  assert.ok(Number.isFinite(actual), `${label} must be finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`);
};

try {
  const M = await server.ssrLoadModule("/src/optimizer3d-model.ts");
  const { chargeLiquidus } = await server.ssrLoadModule("/src/plot/figures.ts");
  const { SOLVER } = await server.ssrLoadModule("/src/shaders.ts");
  const diameterCells = 12;
  // This is a sphere's independently constructed volume, not the production
  // inverse formula copied into the expected result.
  const sphereVolume = 4 / 3 * Math.PI * (diameterCells / 2) ** 3;
  const stats = { fracSolid: 1, grainCount: 17, meanVolVox: sphereVolume };
  const recipe = { target: diameterCells, known: false, pitch: 2.5 };

  check("OPT3-MODEL-VOLUME", () => {
    const cells = M.measureCasting3(stats, recipe);
    assert.equal(cells.valid, true); assert.equal(cells.reason, null);
    close(cells.diameterCells, diameterCells, "sphere diameter in cells");
    close(cells.diameter, diameterCells, "unknown-SI objective in cells");
    close(cells.meanVolVox, sphereVolume, "mean grain volume");
    assert.equal(cells.grainCount, 17); assert.equal(cells.fracSolid, 1);
    close(cells.error, 0, "exact-target error"); close(cells.score, 0, "exact-target score");
    const known = M.measureCasting3(stats, { ...recipe, known: true, target: 24 });
    assert.equal(known.valid, true);
    close(known.diameterCells, 12, "pitch leaves voxel census unchanged");
    close(known.diameter, 30, "known-SI objective in micrometres");
    close(known.error, .25, "relative diameter error");
    close(known.score, .25, "relative error score");
  });

  check("OPT3-MODEL-REFUSALS", () => {
    assert.equal(M.measureCasting3({ ...stats, fracSolid: M.CAST3_COMPLETE }, recipe).valid, true,
      "the declared completion threshold is inclusive");
    const refused = [
      ["missing census", null, recipe],
      ...[M.CAST3_COMPLETE - Number.EPSILON, 1 + Number.EPSILON, NaN, Infinity, -Infinity]
        .map(value => [`solid fraction ${value}`, { ...stats, fracSolid: value }, recipe]),
      ...[0, -1, .5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]
        .map(value => [`grain count ${value}`, { ...stats, grainCount: value }, recipe]),
      ...[0, -1, NaN, Infinity]
        .map(value => [`mean grain volume ${value}`, { ...stats, meanVolVox: value }, recipe]),
      ...[0, -1, NaN, Infinity]
        .map(value => [`target ${value}`, stats, { ...recipe, target: value }]),
      ...[0, -1, NaN, Infinity]
        .map(value => [`pitch ${value}`, stats, { ...recipe, pitch: value }]),
      ["diameter conversion overflow", stats, { ...recipe, known: true, pitch: Number.MAX_VALUE }],
    ];
    for (const [label, census, candidate] of refused) {
      const result = M.measureCasting3(census, candidate);
      assert.equal(result.valid, false, label);
      assert.equal(result.error, null, `${label}: invalid census has no plotted error`);
      assert.ok(typeof result.reason === "string" && result.reason.length > 0, `${label}: refusal reason`);
      assert.ok(Number.isFinite(result.score), `${label}: finite rejection score`);
    }
  });

  check("OPT3-MODEL-SCORE-ORDER", () => {
    const tinyTarget = { ...recipe, target: 1e-9 };
    const valid = M.measureCasting3(stats, tinyTarget);
    const invalid = M.measureCasting3({ ...stats, fracSolid: 0 }, tinyTarget);
    assert.equal(valid.valid, true, "a large but finite relative error remains a valid measurement");
    assert.ok(Number.isFinite(valid.error) && valid.error > 1e6);
    close(valid.score, diameterCells / tinyTarget.target - 1, "large finite fitness");
    assert.equal(invalid.valid, false);
    assert.equal(invalid.score, Number.MAX_VALUE, "invalid casts reserve the finite worst-score sentinel");
    assert.ok(valid.score < invalid.score, "every accepted score must outrank an unfinished cast");
  });

  check("OPT3-MODEL-NONFINITE-FITNESS", () => {
    const underflow = M.measureCasting3(stats, { ...recipe, target: Number.MIN_VALUE });
    assert.equal(underflow.valid, false, "division overflow must not be labelled a valid cast");
    assert.equal(underflow.error, null, "nonfinite error cannot enter a plot or best recipe");
    assert.equal(underflow.score, Number.MAX_VALUE);
    assert.ok(typeof underflow.reason === "string" && underflow.reason.length > 0);
    const hugeTarget = M.measureCasting3(stats, { ...recipe, target: Number.MAX_VALUE });
    assert.equal(hugeTarget.valid, true, "finite relative errors do not require a UI-range target");
    close(hugeTarget.score, 1, "large-target finite error");
  });

  check("OPT3-MODEL-GENOME", () => {
    const nuc = { dTN: .18, dTsig: .04 };
    const pure = chargeLiquidus({ solver: SOLVER.KOB, alloyOn: 0, mLiq: .8, c0: .5 });
    const alloy = chargeLiquidus({ solver: SOLVER.KOB, alloyOn: 1, mLiq: .8, c0: .5 });
    close(pure, 1, "pure charge liquidus"); close(alloy, .6, "alloy charge liquidus");
    const zero = [0, 0, 0, 0, 0];
    const pureCenter = M.genomeRecipe3(zero, nuc, pure);
    const alloyCenter = M.genomeRecipe3(zero, nuc, alloy);
    close(pure - (1 - pureCenter.undercool), nuc.dTN, "pure activation band centre");
    close(alloy - (1 - alloyCenter.undercool), nuc.dTN, "alloy activation band centre");
    assert.deepEqual(pureCenter.cool, [.25, .25, .25]);
    assert.equal(pureCenter.nmax, 1004);
    for (const liquidus of [pure, alloy, .02]) for (const genome of [
      zero, [-1000, -1000, -1000, -1000, -1000], [1000, 1000, 1000, 1000, 1000], [-3, 4, 0, 2, -1],
    ]) {
      const candidate = M.genomeRecipe3(genome, nuc, liquidus);
      assert.ok(candidate.cool.every(value => Number.isFinite(value) && value >= 0 && value <= .5));
      assert.ok(Number.isSafeInteger(candidate.nmax) && candidate.nmax >= 8 && candidate.nmax <= 2000);
      assert.ok(Number.isFinite(candidate.undercool) && candidate.undercool >= .01 && candidate.undercool <= .95);
    }
    close(M.genomeRecipe3([0, 0, 0, 0, -1000], nuc, alloy).undercool, .5, "alloy activation band lower bound");
    close(M.genomeRecipe3([0, 0, 0, 0, 1000], nuc, alloy).undercool, .66, "alloy activation band upper bound");
    for (const invalid of [[], [0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, NaN], [0, Infinity, 0, 0, 0]]) {
      assert.throws(() => M.genomeRecipe3(invalid, nuc, pure), /genome/i);
    }
  });

  check("OPT3-MODEL-COOLING", () => {
    const cooling = [.1, .2, .3];
    for (const [fraction, expected] of [
      [0, .1], [.33 - Number.EPSILON, .1], [.33, .2], [.5, .2], [.66 - Number.EPSILON, .2], [.66, .3], [1, .3],
    ]) assert.equal(M.coolingAt3(fraction, cooling), expected, `cooling at solid fraction ${fraction}`);
    assert.deepEqual(cooling, [.1, .2, .3], "reading the schedule cannot mutate it");
  });

  check("OPT3-MODEL-COPY", () => {
    const original = {
      dimension: "3d", grid: 96, pitch: 1.25, seed: 0x51d3cafe, known: true, unit: "µm",
      params: { solver: 0, coolRate: .1 }, nuc: { nmax: 128, dTN: .15, dTsig: .045 },
      undercool: .2, nmax: 128, cool: [.1, .2, .3], target: 20, diameter: 21, maxSteps: 60000,
    };
    const copy = M.copyRecipe3(original);
    assert.deepEqual(copy, original);
    assert.notEqual(copy, original); assert.notEqual(copy.params, original.params);
    assert.notEqual(copy.nuc, original.nuc); assert.notEqual(copy.cool, original.cool);
    copy.params.coolRate = 999; copy.nuc.nmax = 999; copy.cool[0] = 999; copy.grid = 128;
    assert.equal(original.params.coolRate, .1); assert.equal(original.nuc.nmax, 128);
    assert.deepEqual(original.cool, [.1, .2, .3]); assert.equal(original.grid, 96);
    original.params.solver = 1; original.nuc.dTN = .9; original.cool[2] = .4;
    assert.equal(copy.params.solver, 0); assert.equal(copy.nuc.dTN, .15); assert.equal(copy.cool[2], .3);
  });
} finally {
  await server.close();
}

console.log(failures ? `done — ${failures}/${checks} 3D model checks FAILED` : `done — all ${checks} 3D model checks passed`);
if (failures) process.exitCode = 1;
