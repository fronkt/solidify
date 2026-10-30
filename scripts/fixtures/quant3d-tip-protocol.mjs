import { operatingState } from "./quant3d-tip-analysis.mjs";

// Inherited from the prospectively registered v3 horizon/cadence. Keep these
// fixed when reference values or observed histories are challenged. The terminal
// protocol changes when to observe; it does not fit a physical coefficient.
export const TIP_TERMINAL_PHYSICAL_TIME = 1949.1356423198636;
export const TIP_SAMPLE_PERIOD_PHYSICAL = 32.370331090315965;
export const TIP_TERMINAL_SAMPLE_COUNT = 10;
export const TIP_ARM_NAMES = Object.freeze(["base", "domain", "dx", "dt", "width"]);

export function selectTipArms(arms, args = []) {
  const flags = args.filter(arg => arg === "--arms" || arg.startsWith("--arms="));
  if (flags.length > 1 || flags[0] === "--arms") throw new Error("use one --arms=name,... argument");
  const requested = flags[0] == null ? null : flags[0].slice("--arms=".length);
  const names = requested == null ? [...TIP_ARM_NAMES] : requested.split(",").map(name => name.trim());
  if (names.some(name => !name || !TIP_ARM_NAMES.includes(name)) || new Set(names).size !== names.length) {
    throw new Error("arm requests must be nonempty, known, and unique");
  }
  if (arms.length !== TIP_ARM_NAMES.length || TIP_ARM_NAMES.some(name => arms.filter(arm => arm.name === name).length !== 1)) {
    throw new Error("the full five-arm registration must remain intact");
  }
  const selected = arms.filter(arm => names.includes(arm.name));
  return { selected, names: selected.map(arm => arm.name), requested,
    diagnostic: selected.length !== TIP_ARM_NAMES.length };
}

export function tipOverallAcceptance({ arms, controlsConverged, errors = [], executionFailed = false }) {
  const referenceArms = arms.map(arm => ({ name: arm.config.name, accepted: arm.accepted === true }));
  const missingArms = TIP_ARM_NAMES.filter(name => referenceArms.filter(arm => arm.name === name).length !== 1);
  const allFiveReferenceArmsAccepted = referenceArms.length === TIP_ARM_NAMES.length
    && missingArms.length === 0 && referenceArms.every(arm => arm.accepted);
  return { referenceArms, missingArms, allFiveReferenceArmsAccepted,
    controlsConverged: controlsConverged === true, errorCount: errors.length, executionFailed,
    accepted: allFiveReferenceArmsAccepted && controlsConverged === true && errors.length === 0 && !executionFailed };
}

function positive(value, label) {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be positive and finite`);
}

export function fixedTerminalSchedule({ dt, physicalTimeScale = 1,
  terminalPhysicalTime = TIP_TERMINAL_PHYSICAL_TIME,
  samplePeriodPhysical = TIP_SAMPLE_PERIOD_PHYSICAL }) {
  for (const [label, value] of Object.entries({ dt, physicalTimeScale, terminalPhysicalTime, samplePeriodPhysical })) positive(value, label);
  const count = Math.ceil(terminalPhysicalTime / samplePeriodPhysical);
  if (!Number.isSafeInteger(count) || count < TIP_TERMINAL_SAMPLE_COUNT) throw new Error("ten declared terminal samples are required");
  const checkpoints = Array.from({ length: count }, (_, index) => {
    // Anchor the cadence at the fixed endpoint, preserving the full nine-period
    // retained span instead of appending a shorter, outcome-dependent last gap.
    const physicalTime = terminalPhysicalTime - (count - index - 1) * samplePeriodPhysical;
    const requestedTimeTau0 = physicalTime * physicalTimeScale;
    const steps = Math.ceil(requestedTimeTau0 / dt);
    if (!Number.isSafeInteger(steps) || steps < 1) throw new Error("declared checkpoint exceeds safe integer substeps");
    const timeTau0 = steps * dt;
    return { index, steps, requestedPhysicalTime: physicalTime, requestedTimeTau0, timeTau0,
      physicalTime: timeTau0 / physicalTimeScale,
      roundingTau0: timeTau0 - requestedTimeTau0 };
  });
  if (checkpoints.some((point, i) => i > 0 && point.steps <= checkpoints[i - 1].steps)) {
    throw new Error("observation cadence must exceed one distinct substep");
  }
  const terminal = checkpoints.at(-1);
  return { terminalPhysicalTime, samplePeriodPhysical, physicalTimeScale, dt,
    terminalSteps: terminal.steps, terminalTimeTau0: terminal.timeTau0,
    terminalPhysicalTimeRounded: terminal.physicalTime,
    maximumPhysicalRounding: dt / physicalTimeScale,
    checkpoints, retained: checkpoints.slice(-TIP_TERMINAL_SAMPLE_COUNT) };
}

function clockRoundoffBound(steps, time) {
  // At most one product and one positive FP64 clock addition per substep.
  // This is a floating-point accumulation bound, not a physical time tolerance.
  const terms = (2 * steps + 4) * Number.EPSILON;
  return terms / (1 - terms) * Math.max(1, Math.abs(time));
}

export function terminalOperatingState(samples, schedule, options, observedSteps) {
  const refusal = reason => ({ complete: false, endpointReached: observedSteps === schedule.terminalSteps,
    reason, retainedSteps: schedule.retained.map(point => point.steps), samples: [], state: { ready: false, reason } });
  if (observedSteps !== schedule.terminalSteps) return refusal("registered terminal substep was not reached exactly");
  const expected = new Set(schedule.checkpoints.map(point => point.steps));
  if (samples.some(sample => !expected.has(sample.steps))) return refusal("an observation is outside the declared checkpoint schedule");
  const retained = [];
  for (const point of schedule.retained) {
    const matches = samples.filter(sample => sample.steps === point.steps);
    if (matches.length !== 1) return refusal("a declared terminal curvature sample is missing, unresolved, or duplicated");
    const sample = matches[0];
    if (!Number.isFinite(sample.time) || Math.abs(sample.time - point.timeTau0) > clockRoundoffBound(point.steps, point.timeTau0)) {
      return refusal("a declared terminal sample has an inconsistent solver clock");
    }
    retained.push({ ...sample, reportedTimeTau0: sample.time, time: point.timeTau0 });
  }
  return { complete: true, endpointReached: true, retainedSteps: retained.map(sample => sample.steps),
    samples: retained, state: operatingState(retained, options) };
}

export function terminalReferenceAssessment(terminal, target, relativeTarget) {
  const state = terminal.state;
  const valid = state?.ready && [target.P, target.sigmaStar].every(value => value > 0 && Number.isFinite(value));
  const relativeError = valid ? Object.fromEntries(["P", "sigmaStar"].map(key => [key, Math.abs(state[key] / target[key] - 1)])) : null;
  const referenceErrorBudget = valid ? Object.fromEntries(["P", "sigmaStar"].map(key => [key,
    (1 + relativeError[key]) * (1 + state.uncertainty[key]) * (1 + state.drift[key]) - 1])) : null;
  return { relativeError, referenceErrorBudget, accepted: !!(terminal.complete && valid && state.stationary && state.resolved
    && referenceErrorBudget.P <= relativeTarget && referenceErrorBudget.sigmaStar <= relativeTarget) };
}
