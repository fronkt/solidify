// Pure model of the Q3d paper campaign: KR96 Table I rows beyond eps4 0.0171,
// one anisotropy-definition sensitivity arm, their sizing rule, references,
// predictions and gates. No browser, GPU or file I/O. Protocol:
// scripts/research/quant3d-paper-rows.md (frozen before any GPU run).
import assert from 'node:assert/strict';
import { fixedTerminalSchedule, TIP_TERMINAL_PHYSICAL_TIME,
  TIP_SAMPLE_PERIOD_PHYSICAL } from '../fixtures/quant3d-tip-protocol.mjs';

const A1 = .8839, A2 = .6267, BASE_LAMBDA = 4, UNDERCOOLING = .45, LAMBDA = 2.8;
const BASE_DIMS = Object.freeze([270, 270, 612]); // lambda 4 five-arm base, dx 0.8

// Karma & Rappel, PRL 77, 4050 (1996), Table I, Delta = 0.45. Transcribed from
// arXiv patt-sol/9607005v1 and re-checked 2026-11-26 against the arXiv text.
// KR96 state their PF values are independent of d0/W0 "within an accuracy of 10%".
export const KR96 = Object.freeze({
  0.0123: Object.freeze({ pf: { P: .360, sigmaStar: .036 }, solv: { P: .367, sigmaStar: .0329 } }),
  0.0171: Object.freeze({ pf: { P: .312, sigmaStar: .063 }, solv: { P: .324, sigmaStar: .0578 } }),
  0.0265: Object.freeze({ pf: { P: .236, sigmaStar: .16 }, solv: { P: .247, sigmaStar: .142 } }),
});
export const vd0 = ref => 2 * ref.P ** 2 * ref.sigmaStar; // V d0 / D = 2 P^2 sigma*

// The converged-width base already run (Option A w28, AWS L40S, frozen ab2b45c,
// docs/validation/quant3d-q3c-narrow-ladder-2026-11-24.json on main).
export const W28 = Object.freeze({ P: 0.3231711954755784, sigmaStar: 0.05697669753858748,
  Vd0OverD: 0.011901249460199199, rhoOverRhoIv: 0.6861672208292162, terminalSteps: 315690 });

// Equilibrium-measured effective anisotropy of raw 0.0171 at dx 0.8, R20, lambda 4
// (docs/reviews/quant3d-independent-diagnostics-2026-10-30.md; scripts/research/README.md).
export const EPS_EFF_RAW_0171_DX08 = 0.0166019492;
// Sensitivity arm: raw eps4 scaled so eps_eff would equal KR96's 0.0171 if the
// grid correction is proportional to eps4 (measured eps 0 -> -0.0001, so nearly so).
export const EPS_CALIBRATED_0171 = 0.0171 * 0.0171 / EPS_EFF_RAW_0171_DX08;
// Amendment v1.3 (session 2): the same one-step calibration for the other two rows, from the
// session-1 equilibrium matrix at dx 0.8, R20, lambda 4
// (docs/validation/quant3d-q3d-equilibrium-2026-11-26.json). Raw 0.017613 reached 0.017103 there.
export const EPS_EFF_DX08_S1 = Object.freeze({ 0.0123: 0.011860820321762569, 0.0265: 0.02561456889586917 });
export const EPS_CALIBRATED_0123 = 0.0123 * 0.0123 / EPS_EFF_DX08_S1[0.0123]; // 0.01275544152055055
export const EPS_CALIBRATED_0265 = 0.0265 * 0.0265 / EPS_EFF_DX08_S1[0.0265]; // 0.0274160382263256
// Session-1 e265base terminal state (raw 0.0265), docs/validation/quant3d-q3d-rows-2026-11-26.json.
export const E265BASE_S1 = Object.freeze({ P: 0.25647704018034373, sigmaStar: 0.13025659658652147, Vd0OverD: 0.01713668084553573 });

// Stability dt rule of the five-arm base, evaluated at a given eps4.
const baseDt = (dx, lambda, eps) => Math.min(dx * dx / (12 * A2 * lambda),
  .02 * (1 - 3 * eps) ** 2 * Math.min(1, (dx / .8) ** 2));

// Sizing rule (self-similar in diffusion units): lengths scale with the row's
// diffusion length 2D/V and physical time with D/V^2, both from KR96 numerical
// solvability; r = 1 for eps4 0.0171 reproduces the w28 arm exactly.
export const diffusionRatio = row => vd0(KR96[0.0171].solv) / vd0(KR96[row].solv);
function arm(name, { row, epsilon4 = row, lambda = LAMBDA, dx = .8, dtEpsilon = epsilon4 }) {
  const r = diffusionRatio(row), scale = BASE_LAMBDA / lambda, grid = .8 / dx;
  const timeScale = scale ** 3 * r * r;
  return Object.freeze({ name, row, lambda, epsilon4, undercooling: UNDERCOOLING, radius: 8 * scale * r,
    dims: BASE_DIMS.map(n => Math.ceil(n * scale * r * grid - 1e-9)), dx, dt: baseDt(dx, lambda, dtEpsilon),
    D: A2 * lambda, d0: A1 / lambda, physicalTimeScale: timeScale,
    maximumTimeTau0: TIP_TERMINAL_PHYSICAL_TIME * timeScale, samplePeriodTau0: TIP_SAMPLE_PERIOD_PHYSICAL * timeScale,
    latticeKinetics: true, diffusionRatio: r });
}

// Run order: cheap and decisive first, largest last.
export const ARMS = Object.freeze([
  // Definition sensitivity at the published row: only eps4 changes (dt pinned to w28).
  arm('e171cal', { row: 0.0171, epsilon4: EPS_CALIBRATED_0171, dtEpsilon: 0.0171 }),
  arm('e265base', { row: 0.0265 }),
  arm('e265width', { row: 0.0265, lambda: LAMBDA * .9 }),
  arm('e265dx', { row: 0.0265, dx: .6 }),
  arm('e123base', { row: 0.0123 }),
  // v1.3 (session 2): calibrated rows; only eps4 changes from the row base (dt pinned to it).
  arm('e265cal', { row: 0.0265, epsilon4: EPS_CALIBRATED_0265, dtEpsilon: 0.0265 }),
  arm('e123cal', { row: 0.0123, epsilon4: EPS_CALIBRATED_0123, dtEpsilon: 0.0123 }),
]);

export const RULES = Object.freeze({
  referenceBudget: .10,               // unchanged multiplicative budget (terminalReferenceAssessment)
  controlChange: .10,                 // Option B convergence rule for width/dx controls
  minimumBoundaryDiffusionLengths: 8, // width-ladder RULES
  minimumTravelDiffusionLengths: 6,
  maximumTextureGiB: 4,               // Vulkan single-allocation cap (flux split keeps each texture under it)
});

// Frozen predictions for the sensitivity arm (not gates): local KR96 solvability
// slopes d ln y / d ln eps4 around 0.0171 (mean of the two neighbouring secants).
function solvSlope(key) {
  const s = (a, b) => Math.log(KR96[b].solv[key] / KR96[a].solv[key]) / Math.log(b / a);
  return (s(0.0123, 0.0171) + s(0.0171, 0.0265)) / 2;
}
// v1.3: 0.0265 is the last row, so its slope is the one secant 0.0171 -> 0.0265.
const secant = (key, a, b) => Math.log(KR96[b].solv[key] / KR96[a].solv[key]) / Math.log(b / a);
export function predictions() {
  const dlnEps = Math.log(0.0171 / EPS_EFF_RAW_0171_DX08);
  const sigma = W28.sigmaStar * Math.exp(solvSlope('sigmaStar') * dlnEps);
  const P = W28.P * Math.exp(solvSlope('P') * dlnEps);
  const d265 = Math.log(0.0265 / EPS_EFF_DX08_S1[0.0265]);
  const s265 = { sigmaStar: secant('sigmaStar', 0.0171, 0.0265), P: secant('P', 0.0171, 0.0265) };
  const sigma265 = E265BASE_S1.sigmaStar * Math.exp(s265.sigmaStar * d265), P265 = E265BASE_S1.P * Math.exp(s265.P * d265);
  return { e171cal: { sigmaStar: sigma, P, Vd0OverD: 2 * P * P * sigma, slopes: { sigmaStar: solvSlope('sigmaStar'), P: solvSlope('P') },
    note: 'first-order KR96-slope prediction of moving eps_eff 0.01660 -> 0.0171; a miss means the definition effect is not just anisotropy strength' },
    e265cal: { sigmaStar: sigma265, P: P265, Vd0OverD: 2 * P265 * P265 * sigma265, slopes: s265,
      note: 'v1.3: same first-order prediction from session-1 e265base, moving eps_eff 0.025615 -> 0.0265 (one secant, 0.0171 -> 0.0265)' } };
}

// Throughput measured on the AWS L40S (g6e, Chrome Vulkan): 7.25e9 voxel-steps/s at
// 130M voxels (w28), 6.63e9 at 179M (domain), 6.15e9 at 309M (dx). Interpolated in log voxels.
export function estimateMinutes(voxels, steps) {
  const pts = [[1.304e8, 7.25e9], [1.789e8, 6.63e9], [3.093e8, 6.15e9]];
  const x = Math.log(voxels);
  let rate = voxels <= pts[0][0] ? pts[0][1] : voxels >= pts[2][0] ? pts[2][1] : null;
  for (let i = 0; rate === null && i < 2; i++) if (voxels <= pts[i + 1][0]) {
    const t = (x - Math.log(pts[i][0])) / (Math.log(pts[i + 1][0]) - Math.log(pts[i][0]));
    rate = pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
  }
  return voxels * steps / rate / 60;
}

export function contract() {
  const arms = ARMS.map(a => {
    const plan = fixedTerminalSchedule({ dt: a.dt, physicalTimeScale: a.physicalTimeScale });
    const voxels = a.dims.reduce((x, y) => x * y, 1);
    return { ...a, terminalSteps: plan.terminalSteps, checkpoints: plan.checkpoints.length, voxels,
      textureGiB: voxels * 61 / 2 ** 30, largestTextureGiB: voxels * 8 / 2 ** 30,
      estimatedL40SMinutes: estimateMinutes(voxels, plan.terminalSteps),
      references: { pf: KR96[a.row].pf, solv: KR96[a.row].solv,
        Vd0OverD: { pf: vd0(KR96[a.row].pf), solv: vd0(KR96[a.row].solv) } } };
  });
  return { protocol: 'scripts/research/quant3d-paper-rows.md', protocolVersion: 1, rules: RULES, arms,
    estimatedL40SMinutesTotal: arms.reduce((s, a) => s + a.estimatedL40SMinutes, 0), predictions: predictions(),
    w28: W28, epsilonCalibrated0171: EPS_CALIBRATED_0171,
    endpoints: 'fixed terminal physical time (scaled by the sizing rule) and ten retained checkpoints; primary P and sigma* vs both KR96 rows' };
}

// Known-truth checks of the model itself.
export function selfTest() {
  const w = arm('check', { row: 0.0171 });
  assert.deepEqual(w.dims, [386, 386, 875], 'r = 1 must reproduce the w28 grid');
  assert.ok(Math.abs(w.dt - 0.0180006338) < 1e-9, 'r = 1 must reproduce the w28 dt');
  assert.ok(Math.abs(w.radius - 11.428571428571429) < 1e-12 && Math.abs(w.physicalTimeScale - 2.915451895043732) < 1e-12);
  assert.equal(fixedTerminalSchedule({ dt: w.dt, physicalTimeScale: w.physicalTimeScale }).terminalSteps, W28.terminalSteps);
  assert.ok(Math.abs(vd0(KR96[0.0171].solv) - 0.012135) < 1e-6 && Math.abs(vd0(KR96[0.0171].pf) - 0.012264) < 2e-6);
  const c = contract();
  for (const a of c.arms) assert.ok(a.largestTextureGiB < RULES.maximumTextureGiB, `${a.name} texture over the cap`);
  assert.equal(c.arms[0].dt, w.dt, 'sensitivity arm must keep the w28 dt');
  assert.deepEqual(c.arms[0].dims, w.dims, 'sensitivity arm must keep the w28 grid');
  const by = Object.fromEntries(c.arms.map(a => [a.name, a]));
  for (const [cal, base] of [['e265cal', 'e265base'], ['e123cal', 'e123base']]) {
    for (const k of ['dims', 'dt', 'radius', 'terminalSteps', 'maximumTimeTau0', 'lambda', 'dx'])
      assert.deepEqual(by[cal][k], by[base][k], `${cal} must keep the ${base} ${k}`);
    assert.ok(by[cal].epsilon4 > by[base].epsilon4 * 1.02 && by[cal].epsilon4 < by[base].epsilon4 * 1.05, `${cal} eps4 out of range`);
  }
  assert.ok(Math.abs(EPS_CALIBRATED_0123 - 0.01275544152055055) < 1e-17 && Math.abs(EPS_CALIBRATED_0265 - 0.0274160382263256) < 1e-17);
  return { ok: true, arms: c.arms.length };
}
