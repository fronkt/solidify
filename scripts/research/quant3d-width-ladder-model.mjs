// Pure model of the Q3c interface-width ladder: registered arms, archived
// inputs, frozen predictions and the verdict rule with its known-truth and
// negative controls. No browser, GPU or file I/O. Protocol:
// scripts/research/quant3d-width-ladder.md.
import assert from 'node:assert/strict';
import { fixedTerminalSchedule, TIP_TERMINAL_PHYSICAL_TIME,
  TIP_SAMPLE_PERIOD_PHYSICAL } from '../fixtures/quant3d-tip-protocol.mjs';

const A1 = .8839, A2 = .6267, BASE_LAMBDA = 4, EPSILON4 = .0171, UNDERCOOLING = .45;
// Delta = P exp(P) E1(P) at 0.45, solved in Float64 (quant3d-q3c-tip-replay.py).
export const IVANTSOV_PECLET = 0.47098022998684475;
const w = lambda => lambda / A1; // W0/d0

// Archived a11a814 lattice-kinetics candidate arms (NVIDIA RTX 5090), terminal
// ten-checkpoint states recomputed from raw samples in
// solidify-q3-candidate-2026-10-30.tar.gz (SHA256 ceea1d7c...cbb23f).
export const ARCHIVED = Object.freeze({
  archiveSha256: 'ceea1d7c64943a37fb3d8ba723249a274db2bdaa7fb0b40e768ed52191cbb23f',
  source: 'a11a814af369eff32261ef80aaece6915b338c4d',
  base: Object.freeze({ lambda: 4, P: 0.3302933866906667, sigma: 0.052696234408671036,
    Vd0OverD: 0.011497656619391736, rhoOverRhoIv: 0.7012892806559893, velocitySpread: 0.000700151719678334, terminalSteps: 108282 }),
  width: Object.freeze({ lambda: 3.6, P: 0.326610466575313, sigma: 0.054522300383126096,
    Vd0OverD: 0.01163226701938344, rhoOverRhoIv: 0.6934695891257172, velocitySpread: 0.0008319355550452701, terminalSteps: 148535 }),
});

const baseDt = (dx, lambda) => Math.min(dx * dx / (12 * A2 * lambda), .02 * (1 - 3 * EPSILON4) ** 2 * Math.min(1, (dx / .8) ** 2));
// Physical extents and seed radius in d0 match the five-arm base (270x270x612
// cells at lambda 4); cell counts round upward.
export const LADDER_ARMS = Object.freeze([5, 4.4, 4].map(lambda => {
  const scale = BASE_LAMBDA / lambda, timeScale = scale ** 3, dx = .8;
  return Object.freeze({ name: lambda === 4 ? 'w40-anchor' : `w${Math.round(lambda * 10)}`, lambda,
    epsilon4: EPSILON4, undercooling: UNDERCOOLING, radius: 8 * scale,
    dims: [270, 270, 612].map(n => Math.ceil(n * scale - 1e-9)), dx, dt: baseDt(dx, lambda),
    D: A2 * lambda, d0: A1 / lambda, physicalTimeScale: timeScale,
    maximumTimeTau0: TIP_TERMINAL_PHYSICAL_TIME * timeScale, samplePeriodTau0: TIP_SAMPLE_PERIOD_PHYSICAL * timeScale,
    latticeKinetics: true });
}));
// Declared rules (frozen in quant3d-width-ladder.md before any GPU run).
export const RULES = Object.freeze({ anchorVelocity: .0025, anchorSigma: .01, monotoneSpreadFactor: 2,
  formTolerance: .002, formDominance: .5, followUpLambdas: Object.freeze([3.2, 2.8, 2.4, 2.0]), followUpVelocityError: .025,
  minimumTravelDiffusionLengths: 6, minimumBoundaryDiffusionLengths: 8 });
export const MEASURED_INTEL_VOXEL_SUBSTEPS_PER_SECOND = 1.0989442793488558e9; // verify-out/q3-tip-throughput, Arc 140V, 2026-10-30

const KEYS = ['Vd0OverD', 'sigma', 'rhoOverRhoIv'];
export function ladderPredictions(anchor = ARCHIVED.base) {
  const out = {};
  for (const key of KEYS) {
    const l4 = Math.log(ARCHIVED.base[key]), l36 = Math.log(ARCHIVED.width[key]);
    const a = (l36 - l4) / (w(3.6) ** 2 - w(4) ** 2), b = (l36 - l4) / (w(3.6) - w(4));
    out[key] = { quadraticSlope: a, linearSlope: b,
      at: Object.fromEntries([5, 4.4, 4, 3.6, 3.2, 2.8, 2.4, 2.0, 0].map(lambda => [lambda, {
        quadratic: anchor[key] * Math.exp(a * (w(lambda) ** 2 - w(4) ** 2)),
        linear: anchor[key] * Math.exp(b * (w(lambda) - w(4))) }])) };
  }
  return out;
}

export function ladderVerdict({ valid, anchor, w44, w50, executionClean = true }) {
  const result = { q3Accepted: false, acceptanceScope: 'diagnostic hypothesis test only; Q3 acceptance requires the unchanged five-arm reference gate' };
  if (!executionClean) return { ...result, verdict: 'refused-execution' };
  if (!valid) return { ...result, verdict: 'refused-validity' };
  const anchorChange = { Vd0OverD: anchor.Vd0OverD / ARCHIVED.base.Vd0OverD - 1, sigma: anchor.sigma / ARCHIVED.base.sigma - 1 };
  result.anchorChange = anchorChange;
  const ladder = [{ lambda: 3.6, ...ARCHIVED.width }, { lambda: 4, ...anchor }, { lambda: 4.4, ...w44 }, { lambda: 5, ...w50 }];
  const steps = ladder.slice(1).map((arm, i) => {
    const previous = ladder[i], decrease = 1 - arm.Vd0OverD / previous.Vd0OverD;
    const noise = RULES.monotoneSpreadFactor * Math.max(arm.velocitySpread, previous.velocitySpread);
    return { from: previous.lambda, to: arm.lambda, relativeDecrease: decrease, required: noise, passed: decrease > noise };
  });
  result.monotone = steps;
  const predictions = ladderPredictions(anchor);
  const residuals = Object.fromEntries(KEYS.map(key => [key, Object.fromEntries(['quadratic', 'linear'].map(form => {
    const r = [4.4, 5].map(lambda => Math.log((lambda === 5 ? w50 : w44)[key] / predictions[key].at[lambda][form]));
    return [form, { residuals: r, rms: Math.sqrt((r[0] ** 2 + r[1] ** 2) / 2) }];
  }))]));
  result.residuals = residuals;
  if (Math.abs(anchorChange.Vd0OverD) > RULES.anchorVelocity || Math.abs(anchorChange.sigma) > RULES.anchorSigma) {
    return { ...result, verdict: 'refused-platform-anchor' };
  }
  if (!steps.every(step => step.passed)) return { ...result, verdict: 'width-trend-refuted' };
  const q = residuals.Vd0OverD.quadratic.rms, l = residuals.Vd0OverD.linear.rms;
  const form = q <= RULES.formTolerance && q <= RULES.formDominance * l ? 'quadratic'
    : l <= RULES.formTolerance && l <= RULES.formDominance * q ? 'linear' : null;
  result.verdict = form ? `width-trend-${form}-supported` : 'width-trend-form-unresolved';
  result.diagnosticExtrapolation = form ? Object.fromEntries(KEYS.map(key => [key, predictions[key].at[0][form]])) : null;
  if (form) {
    // Reference-blind follow-up: the widest registered lambda whose predicted
    // remaining width error in Vd0/D is within 2.5%; null means none qualifies.
    const v0 = predictions.Vd0OverD.at[0][form];
    result.followUpLambda = RULES.followUpLambdas.find(lambda =>
      Math.abs(predictions.Vd0OverD.at[lambda][form] / v0 - 1) <= RULES.followUpVelocityError) ?? null;
  }
  return result;
}

// Known-truth and negative controls for the frozen verdict logic.
export function selfTestLadderVerdict() {
  const synth = (truth, lambda) => {
    const base = ARCHIVED.base, row = {};
    for (const key of KEYS) {
      const l4 = Math.log(base[key]), l36 = Math.log(ARCHIVED.width[key]);
      const g = { quadratic: x => x * x, linear: x => x, 'power1.5': x => x ** 1.5 }[truth];
      row[key] = truth === 'flat' ? base[key] : g
        ? base[key] * Math.exp((l36 - l4) / (g(w(3.6)) - g(w(4))) * (g(w(lambda)) - g(w(4)))) : null;
    }
    return { ...row, velocitySpread: 7e-4 };
  };
  const cases = [];
  for (const [truth, expected] of [['quadratic', 'width-trend-quadratic-supported'], ['linear', 'width-trend-linear-supported'],
    ['power1.5', 'width-trend-form-unresolved'], ['flat', 'width-trend-refuted']]) {
    const v = ladderVerdict({ valid: true, anchor: synth(truth, 4), w44: synth(truth, 4.4), w50: synth(truth, 5) });
    cases.push({ truth, expected, verdict: v.verdict, followUpLambda: v.followUpLambda ?? null });
  }
  // Worst-case sign pattern of +-0.1% velocity noise (about 1.4x the archived
  // window-velocity spread) must not change a quadratic or linear truth verdict.
  for (const truth of ['quadratic', 'linear']) {
    const noisy = (lambda, f) => { const row = synth(truth, lambda); return { ...row, Vd0OverD: row.Vd0OverD * f }; };
    const v = ladderVerdict({ valid: true, anchor: synth(truth, 4), w44: noisy(4.4, 1.001), w50: noisy(5, .999) });
    cases.push({ truth: `${truth} with +-0.1% noise`, expected: `width-trend-${truth}-supported`, verdict: v.verdict });
  }
  const q = t => synth('quadratic', t);
  const reversed = ladderVerdict({ valid: true, anchor: q(4), w44: q(5), w50: q(4.4) });
  cases.push({ truth: 'nonmonotone (4.4/5 swapped)', expected: 'width-trend-refuted', verdict: reversed.verdict });
  const shifted = { ...q(4), Vd0OverD: q(4).Vd0OverD * 1.005 };
  cases.push({ truth: 'anchor +0.5%', expected: 'refused-platform-anchor',
    verdict: ladderVerdict({ valid: true, anchor: shifted, w44: q(4.4), w50: q(5) }).verdict });
  cases.push({ truth: 'invalid arm', expected: 'refused-validity', verdict: ladderVerdict({ valid: false, anchor: q(4), w44: q(4.4), w50: q(5) }).verdict });
  cases.push({ truth: 'execution evidence failed', expected: 'refused-execution',
    verdict: ladderVerdict({ valid: true, executionClean: false, anchor: q(4), w44: q(4.4), w50: q(5) }).verdict });
  for (const c of cases) assert.equal(c.verdict, c.expected, `verdict control ${c.truth}`);
  for (const c of cases) assert.ok(!('q3Accepted' in c) || c.q3Accepted === false);
  return cases;
}

export function ladderContract() {
  const predictions = ladderPredictions();
  const arms = LADDER_ARMS.map(arm => {
    const plan = fixedTerminalSchedule({ dt: arm.dt, physicalTimeScale: arm.physicalTimeScale });
    const voxels = arm.dims.reduce((a, b) => a * b, 1);
    return { ...arm, terminalSteps: plan.terminalSteps, checkpoints: plan.checkpoints.length, voxels,
      textureGiB: voxels * 61 / 2 ** 30,
      estimatedIntelMinutes: voxels * plan.terminalSteps / MEASURED_INTEL_VOXEL_SUBSTEPS_PER_SECOND / 60 };
  });
  return { protocol: 'scripts/research/quant3d-width-ladder.md', protocolVersion: 1, archived: ARCHIVED, rules: RULES,
    arms, estimatedIntelMinutesTotal: arms.reduce((s, a) => s + a.estimatedIntelMinutes, 0), predictions,
    ivantsovPeclet: IVANTSOV_PECLET,
    endpoints: 'fixed terminal physical time 1949.1356 base tau0 and ten retained checkpoints (protocol v4 schedule); primary Vd0/D, secondary sigma* and rho/rho_Iv',
    noAcceptance: 'No reference band, estimator, endpoint or coefficient is selected from these results; Q3 stays open in every branch.' };
}
