import { operatingState } from "./quant3d-tip-analysis.mjs";
import { fixedTerminalSchedule, terminalOperatingState, terminalReferenceAssessment,
  selectTipArms, tipOverallAcceptance, TIP_ARM_NAMES } from "./quant3d-tip-protocol.mjs";

export function selfTestTipTerminalProtocol(registeredPlans = new Map()) {
  const registered = TIP_ARM_NAMES.map(name => ({ name }));
  const fullSelection = selectTipArms(registered), baseSelection = selectTipArms(registered, ["--run", "--arms=base"]);
  const pairSelection = selectTipArms(registered, ["--arms=width,base"]);
  const malformed = ["--arms=", "--arms=base,", "--arms=base,base", "--arms=unknown", "--arms"];
  const refused = malformed.map(arg => {
    try { selectTipArms(registered, [arg]); return false; } catch { return true; }
  });
  try { selectTipArms(registered, ["--arms=base", "--arms=domain"]); refused.push(false); } catch { refused.push(true); }
  const allAccepted = registered.map(config => ({ config, accepted: true }));
  const fullVerdict = tipOverallAcceptance({ arms: allAccepted, controlsConverged: true });
  const partialVerdict = tipOverallAcceptance({ arms: allAccepted.slice(0, 1), controlsConverged: true });
  const failedReference = tipOverallAcceptance({ arms: allAccepted.map((arm, i) => ({ ...arm, accepted: i !== 0 })), controlsConverged: true });
  const errored = tipOverallAcceptance({ arms: allAccepted, controlsConverged: true, errors: ["manufactured device failure"] });
  if (fullSelection.diagnostic || !baseSelection.diagnostic || JSON.stringify(baseSelection.names) !== '["base"]'
      || JSON.stringify(pairSelection.names) !== '["base","width"]' || refused.some(value => !value)
      || !fullVerdict.accepted || partialVerdict.accepted || failedReference.accepted || errored.accepted
      || !failedReference.controlsConverged || partialVerdict.allFiveReferenceArmsAccepted) {
    throw new Error("diagnostic arm selection or partial overall acceptance control failed");
  }
  const options = { D: 2.5, d0: .2, dims: [1024, 1024, 2048], dx: .8, relativeTarget: .1 };
  const declared = { dt: .3, terminalPhysicalTime: 2000, samplePeriodPhysical: 20 };
  const schedule = fixedTerminalSchedule(declared);
  const manufacture = rhoAt => schedule.checkpoints.map(point => {
    const rho = rhoAt(point.timeTau0);
    return { steps: point.steps, time: point.timeTau0, tip: 10 + .13 * point.timeTau0,
      tipError: 1e-4, rho, rhoError: .07, rhoX: rho, rhoY: rho };
  });
  const steady = manufacture(() => 12);
  const exactTarget = { P: 12 * .13 / (2 * 2.5), sigmaStar: 2 * 2.5 * .2 / (12 ** 2 * .13) };
  const positive = terminalOperatingState(steady, schedule, options, schedule.terminalSteps);
  const positiveReference = terminalReferenceAssessment(positive, exactTarget, .1);
  if (!positive.complete || !positive.state.stationary || !positive.state.resolved || !positiveReference.accepted) {
    throw new Error("fixed-terminal steady positive control failed");
  }

  // Expected values can change the reference verdict, never the scheduled
  // observations or the actual operatingState input at the terminal time.
  const evaluate = target => {
    const plan = fixedTerminalSchedule(declared);
    const terminal = terminalOperatingState(steady, plan, options, plan.terminalSteps);
    return { steps: terminal.retainedSteps, times: terminal.samples.map(sample => sample.time),
      terminal: plan.terminalSteps, reference: terminalReferenceAssessment(terminal, target, .1) };
  };
  const matching = evaluate(exactTarget), altered = evaluate({ P: 2 * exactTarget.P, sigmaStar: 3 * exactTarget.sigmaStar });
  if (JSON.stringify(matching.steps) !== JSON.stringify(altered.steps)
      || JSON.stringify(matching.times) !== JSON.stringify(altered.times)
      || matching.terminal !== altered.terminal || !matching.reference.accepted || altered.reference.accepted) {
    throw new Error("reference values influenced observation timing or escaped the reference comparison");
  }

  const incomplete = terminalOperatingState(steady.slice(0, -1), schedule, options, schedule.checkpoints.at(-2).steps);
  const unresolved = terminalOperatingState(steady.slice(0, -1), schedule, options, schedule.terminalSteps);
  const missingInterior = terminalOperatingState(steady.filter(sample => sample.steps !== schedule.retained[3].steps), schedule, options, schedule.terminalSteps);
  const duplicated = terminalOperatingState([...steady, steady.at(-1)], schedule, options, schedule.terminalSteps);
  const badClock = terminalOperatingState(steady.map((sample, i) => i === steady.length - 1
    ? { ...sample, time: sample.time + declared.dt } : sample), schedule, options, schedule.terminalSteps);
  const overshot = terminalOperatingState(steady, schedule, options, schedule.terminalSteps + 1);
  if ([incomplete, unresolved, missingInterior, duplicated, badClock, overshot].some(terminal => terminal.complete || terminal.state.ready
      || terminalReferenceAssessment(terminal, exactTarget, .1).accepted)) {
    throw new Error("an incomplete, unresolved, mis-timed, or overshot endpoint was accepted");
  }

  const late = manufacture(time => 12 + .002 * Math.max(0, time - 1600));
  const early = operatingState(late.slice(0, 20), options);
  const final = terminalOperatingState(late, schedule, options, schedule.terminalSteps);
  const pointMatchingTarget = { P: final.state.P, sigmaStar: final.state.sigmaStar };
  const finalReference = terminalReferenceAssessment(final, pointMatchingTarget, .1);
  if (!early.stationary || !early.resolved || !final.complete || !final.state.resolved
      || !final.state.statisticallyConsistent || final.state.stationary
      || !(final.state.drift.rhoVariation > final.state.drift.inputBudget)
      || finalReference.referenceErrorBudget.P > .1 || finalReference.referenceErrorBudget.sigmaStar > .1
      || finalReference.accepted || JSON.stringify(final.retainedSteps) !== JSON.stringify(positive.retainedSteps)) {
    throw new Error("an earlier good window substituted for terminal drift, or the drift control failed on an unrelated clause");
  }

  const scale = (4 / 3.6) ** 3;
  const scaled = fixedTerminalSchedule({ ...declared, physicalTimeScale: scale });
  const rounding = [schedule, scaled].every(plan => plan.checkpoints.every(point => point.roundingTau0 >= 0
    && point.roundingTau0 < plan.dt && point.steps === Math.ceil(point.requestedTimeTau0 / plan.dt)));
  const matched = schedule.retained.every((point, i) => point.requestedPhysicalTime === scaled.retained[i].requestedPhysicalTime
    && Math.abs(point.physicalTime - scaled.retained[i].physicalTime) < Math.max(schedule.maximumPhysicalRounding, scaled.maximumPhysicalRounding));
  if (!rounding || !matched) throw new Error("lambda-scaled terminal observations do not obey the declared one-substep ceiling");
  const registeredArms = [...registeredPlans].map(([name, plan]) => {
    if (plan.checkpoints.some(point => !(point.roundingTau0 >= 0 && point.roundingTau0 < plan.dt))) {
      throw new Error("a registered arm exceeds its one-substep rounding bound");
    }
    return { name, steps: plan.terminalSteps, terminalPhysicalTime: plan.terminalPhysicalTimeRounded,
      requestedPhysicalTime: plan.terminalPhysicalTime, roundingBound: plan.maximumPhysicalRounding };
  });
  if (registeredArms.some(arm => arm.requestedPhysicalTime !== registeredArms[0].requestedPhysicalTime)) {
    throw new Error("registered arms do not share the declared physical endpoint");
  }
  return { armSelection: { defaultNames: fullSelection.names, baseDiagnostic: baseSelection.diagnostic,
      selectedPair: pairSelection.names, malformedRequestsRefused: refused.length,
      fullPositive: fullVerdict.accepted, partialOverallAccepted: partialVerdict.accepted,
      failedReferenceKeepsControlVerdict: failedReference.controlsConverged }, steadyPositive: positiveReference.accepted,
    referenceIndependent: { identicalSteps: true, identicalTimes: true, changedVerdict: true },
    endpointRefusals: { incomplete: incomplete.reason, unresolved: unresolved.reason, missingInterior: missingInterior.reason,
      duplicated: duplicated.reason, clock: badClock.reason, overshot: overshot.reason },
    lateDriftRefused: { earlyQualified: early.stationary && early.resolved, terminalResolved: final.state.resolved,
      terminalStatisticallyConsistent: final.state.statisticallyConsistent, rhoVariation: final.state.drift.rhoVariation,
      inputBudget: final.state.drift.inputBudget, pointError: finalReference.relativeError,
      referenceErrorBudget: finalReference.referenceErrorBudget, accepted: finalReference.accepted },
    lambdaRounding: { scale, sameRequestedPhysicalTimes: matched, ceilingVerified: rounding,
      baseTerminalSteps: schedule.terminalSteps, widthTerminalSteps: scaled.terminalSteps }, registeredArms };
}
