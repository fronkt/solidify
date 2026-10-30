// Long 3D operating-state benchmark. Default: geometry self-check, unchanged-
// production specialization check, then throughput only. --run executes all
// pre-registered arms; --arms=base (or named subsets) is diagnostic only.
// Throughput is never reported as tip acceptance.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { closeBrowser } from "./browser-cleanup.mjs";
import { installQuant3TipDriver } from "./fixtures/quant3d-tip-driver.mjs";
import { localTip, operatingState, selfTestTipGeometry } from "./fixtures/quant3d-tip-analysis.mjs";
import { fixedTerminalSchedule, terminalOperatingState, terminalReferenceAssessment,
  selectTipArms, tipOverallAcceptance, TIP_TERMINAL_PHYSICAL_TIME,
  TIP_SAMPLE_PERIOD_PHYSICAL, TIP_TERMINAL_SAMPLE_COUNT } from "./fixtures/quant3d-tip-protocol.mjs";
import { selfTestTipTerminalProtocol } from "./fixtures/quant3d-tip-protocol-controls.mjs";

const args = process.argv.slice(2), positional = args.filter(s => !s.startsWith("--"));
const OUT = resolve(positional[0] ?? "verify-out/q3-tip"), PORT = positional[1] ?? "5199";
const runLong = args.includes("--run"), selfOnly = args.includes("--self-test");
const reference = JSON.parse(readFileSync(new URL("./fixtures/quant3d-tip-reference.json", import.meta.url), "utf8"));
const target = reference.rows.find(r => r.epsilon4 === .0171), A1 = .8839, A2 = .6267, lambda = 4;
const D = A2 * lambda, d0 = A1 / lambda, rhoExpected = d0 / (target.full3D.P * target.full3D.sigmaStar);
const velocityExpected = 2 * target.full3D.sigmaStar * target.full3D.P ** 2 * D / d0;
const diffusionExpected = D / velocityExpected;
// Geometry and time cover the PRE-EXISTING P/sigma target band, using their
// exact physical identities. They are not selected from transient tip output.
const referenceLower = 1 - reference.acceptance.relativeTarget;
const referenceUpper = 1 + reference.acceptance.relativeTarget;
const velocityMinimum = velocityExpected * referenceLower ** 3;
const velocityMaximum = velocityExpected * referenceUpper ** 3;
const radiusMaximum = rhoExpected / referenceLower ** 2;
const maximumTime = TIP_TERMINAL_PHYSICAL_TIME;
const baseDt = (dx, coupling = lambda) => Math.min(dx * dx / (12 * A2 * coupling), .02 * (1 - 3 * target.epsilon4) ** 2 * Math.min(1, (dx / .8) ** 2));
const common = { lambda, epsilon4: target.epsilon4, undercooling: reference.undercooling, radius: 8 };
const arms = [
  { name: "base", dims: [270, 270, 612], dx: .8, dt: baseDt(.8) },
  { name: "domain", dims: [300, 300, 680], dx: .8, dt: baseDt(.8) },
  { name: "dx", dims: [360, 360, 816], dx: .6, dt: baseDt(.6) },
  { name: "dt", dims: [270, 270, 612], dx: .8, dt: baseDt(.8) / 2 },
  { name: "width", dims: [300, 300, 680], dx: .8, lambda: 3.6, dt: baseDt(.8, 3.6) },
].map(arm => {
  const coupling = arm.lambda ?? lambda, timeScale = (lambda / coupling) ** 3;
  return { ...common, ...arm, D: A2 * coupling, d0: A1 / coupling,
    radius: common.radius * lambda / coupling, physicalTimeScale: timeScale,
    maximumTimeTau0: maximumTime * timeScale,
    samplePeriodTau0: TIP_SAMPLE_PERIOD_PHYSICAL * timeScale };
});
const selection = selectTipArms(arms, args);
const observationPlans = new Map(arms.map(arm => [arm.name, fixedTerminalSchedule({ dt: arm.dt,
  physicalTimeScale: arm.physicalTimeScale })]));
const contract = {
  protocolVersion: 4,
  previousStudy: { pin: "ad96166", artifact: "verify-out/q3-cloud-full-progress.json",
    outcome: "all five arms stopped during startup on D/V side-clearance proxy; no steady operating state accepted",
    change: "reference-band-derived geometry/time, no startup proxy abort, conservative retained-steady-window clearance and direct far-field patches; no physical parameter or accuracy threshold changed" },
  previousProtocol3: { pin: "12ce78b", artifact: "q3-validation-2026-10-30 draft evidence release",
    outcome: "all five fixed-parameter reference arms failed; first-qualifying observation times and the full raw study remain preserved",
    change: "run every arm to the predeclared common physical endpoint and evaluate only its declared terminal samples; no physical coefficient, reference value, or error band changed" },
  target: target.full3D, relativeTarget: reference.acceptance.relativeTarget,
  expected: { rhoW0: rhoExpected, velocityW0PerTau0: velocityExpected, diffusionLengthW0: diffusionExpected },
  arms, minimumTravelDiffusionLengths: 6, minimumBoundaryDiffusionLengths: 8,
  maximumTimeTau0: maximumTime,
  referenceBandGeometry: { velocityMinimum, velocityMaximum, radiusMaximum,
    minimumSideW0: 8 * D / velocityMinimum + .5 * radiusMaximum,
    minimumAxialW0AtMaximumSpeedAndHorizon: common.radius + velocityMaximum * maximumTime + 8 * D / velocityMaximum,
    derivation: "rho/d0=1/(P*sigma), V*d0/D=2*sigma*P^2; Vmin=(1-r)^3 Vref, rhomax=rhoref/(1-r)^2. The inherited v3 horizon/cadence are now frozen constants, not recomputed from reference values or observations. Actual terminal-window clearance remains mandatory." },
  samplePeriodTau0: TIP_SAMPLE_PERIOD_PHYSICAL,
  terminalObservation: { terminalPhysicalTime: TIP_TERMINAL_PHYSICAL_TIME,
    samplePeriodPhysical: TIP_SAMPLE_PERIOD_PHYSICAL, retainedSampleCount: TIP_TERMINAL_SAMPLE_COUNT,
    timeUnit: "base-arm tau0; arm solver time is physical time times (lambda_base/lambda_arm)^3",
    schedule: "cadence anchored at the fixed terminal time; every requested checkpoint is rounded upward with ceil(requested solver time/dt), independently, to an integer substep",
    selection: "only the final ten declared checkpoints are evaluated; missing, unresolved, duplicated, mis-timed, or unfinished endpoints are refused; earlier qualifying/reference-matching windows cannot substitute",
    firstQualification: "diagnostic only; it never changes a checkpoint, terminal time, or acceptance window",
    clock: "exact integer substep identity; reported FP64 clock may differ only by its sequential arithmetic accumulation bound; fits use steps*dt",
    caveat: "a fixed endpoint prevents outcome-selected observation timing; it does not establish asymptotic convergence or repair failed stationarity, boundary, metrology, or reference checks",
    armSchedules: [...observationPlans].map(([name, plan]) => ({ name, ...plan })) },
  metrology: "quintic roots in the monotone atanh(1-2psi) ordinate checked against cubic roots in the same ordinate; raw-phase quintic sensitivity reported separately; even quadratic and quartic local surfaces over .25-.5 rho, extrapolated against window^4",
  stationarity: "last three four-sample windows overlap within independently estimated geometry/linear-fit uncertainty; retained-sample rho variation and variation/trend among the three fitted four-sample velocities each <=one quarter of the reference target, independently of geometric uncertainty; propagated P and sigma uncertainty below the target; this does not bound every adjacent-interval or sub-cadence velocity",
  note: "Raw cubic epsilon4 is refined with dx; no unpublished grid-anisotropy correction is inserted to match the paper.",
  widthMatching: "W0 scales with lambda; tau0 scales with lambda^3. Extents and initial radius/d0 match; compare P, sigma, rho/d0 and Vd0/D, never unscaled solver rho or velocity across lambda.",
  boundaryAssessment: "D/V is a startup diagnostic, not an early contamination verdict. Final clearance must exceed eight conservative D/V lengths at every sample of the retained stationary window; conservative speed is min(V-error) over its fitted windows and geometry uses upper uncertainty bounds.",
  controlComparison: "pointwise P, sigma, rho/d0 and Vd0/D changes retain the original reference-target band; control convergence is reported separately and cannot establish overall literature acceptance",
};

function retainedBoundaryCheck(samples, state, arm, initialTipUpper) {
  if (!state?.ready || !state.stationary || !state.resolved) {
    return { assessed: false, boundaryClear: null, reason: "nonstationary or unresolved startup; D/V proxy alone does not diagnose contamination" };
  }
  const retained = samples.slice(-10);
  const lowerVelocity = Math.min(...state.windows.map(w => w.velocity - w.velocityError));
  if (retained.length !== 10 || !(lowerVelocity > 0) || !Number.isFinite(lowerVelocity)) {
    return { assessed: false, boundaryClear: null, reason: "a complete retained window with a positive conservative speed is required" };
  }
  const diffusionLengthUpper = arm.D / lowerVelocity;
  const checks = retained.map(sample => {
    const tipUpper = sample.tip + sample.tipError, rhoUpper = sample.rho + sample.rhoError;
    const fitRadius = Math.max(.5 * rhoUpper, ...((sample.windows ?? []).map(w => w.radius)));
    return { time: sample.time, tipUpper, rhoUpper, fitRadius,
      aheadDiffusionLengths: (arm.dims[2] * arm.dx - tipUpper) / diffusionLengthUpper,
      sideDiffusionLengths: (Math.min(arm.dims[0], arm.dims[1]) * arm.dx - fitRadius) / diffusionLengthUpper };
  });
  const latest = retained.at(-1);
  return { assessed: true, boundaryClear: checks.every(check =>
    check.aheadDiffusionLengths >= contract.minimumBoundaryDiffusionLengths
      && check.sideDiffusionLengths >= contract.minimumBoundaryDiffusionLengths),
    lowerVelocity, diffusionLengthUpper,
    minimumAheadDiffusionLengths: Math.min(...checks.map(check => check.aheadDiffusionLengths)),
    minimumSideDiffusionLengths: Math.min(...checks.map(check => check.sideDiffusionLengths)),
    conservativeTravelDiffusionLengths: (latest.tip - latest.tipError - initialTipUpper) / diffusionLengthUpper,
    checks, source: "retained-window lower velocity confidence bound and upper geometric bounds; every retained sample checked" };
}

function boundaryProtocolControls() {
  // These are the eleven shared base/domain observations from the first
  // unchanged cloud study (ad96166). The tip histories were byte-for-byte
  // identical while the old instantaneous D/V rule stopped the smaller box.
  const common = [
    [32.383140206199876,19.488690444384176,16.04140793832292,.22673455840597612,.002265791762503966],
    [64.76628041239958,25.71285357316288,19.034142025971274,.2555956776613826,.0028994847308752014],
    [97.14942061859928,30.813971492111925,20.68789241382687,.39844939726533823,.003969281850125128],
    [129.532560824799,35.30588072756459,21.811647405042848,.32217296232975556,.003846654778378422],
    [161.9157010309987,39.40567131541356,22.359327928126845,.3266259342795941,.0037946896052218904],
    [194.2988412371984,43.23230373725032,22.51999021998526,.33330075959009875,.003908772170724717],
    [226.6819814433981,46.85819309258273,22.373108384788587,.41314577648853756,.004013988875236407],
    [259.0651216495978,50.335018075817125,22.155989135827365,.35791200712812454,.003989117053137647],
    [291.4482618557975,53.69799191139388,21.86460466508879,.2630201705190629,.00332674422541146],
    [323.8314020619972,56.97685154547282,21.414877578930465,.21353903099521432,.0026179087323967565],
    [356.2145422681969,60.19420748131622,20.89162197814095,.19945852050903312,.0024579319274664613],
  ].map(([time, tip, rho, rhoError, tipError]) => ({ time, tip, rho, rhoError, tipError, rhoX: rho, rhoY: rho }));
  const checks = [[216,216,432],[240,240,480]].map(dims => {
    const arm = { dims, dx: .8, D: A2 * 4, d0: A1 / 4 };
    const state = operatingState(common, { ...arm, relativeTarget: contract.relativeTarget });
    return { oldProxySide: state.sideDiffusionLengths, ...retainedBoundaryCheck(common, state, arm, 8) };
  });
  if (!(checks[0].oldProxySide < 8 && checks[1].oldProxySide > 8 && checks.every(c => !c.assessed && c.boundaryClear == null))) {
    throw new Error("identical startup histories were misclassified by the steady diffusion-length proxy");
  }
  const steady = Array.from({ length: 10 }, (_, j) => ({ time: 20 * j, tip: 10 + .13 * 20 * j,
    tipError: 1e-4, rho: 12.2 - .2 * j / 9, rhoError: .15, rhoX: 12, rhoY: 12 }));
  const roomyArm = { dims: [256,256,512], dx: .8, D: 2.5, d0: .2 };
  const roomyState = operatingState(steady, { ...roomyArm, relativeTarget: contract.relativeTarget });
  const positive = retainedBoundaryCheck(steady, roomyState, roomyArm, 8);
  const marginalArm = { ...roomyArm, dims: [200,200,400] };
  const marginal = retainedBoundaryCheck(steady, roomyState, marginalArm, 8);
  const onlyLast = marginal.checks.at(-1).sideDiffusionLengths;
  if (!positive.assessed || !positive.boundaryClear || !marginal.assessed || marginal.boundaryClear || !(onlyLast > 8)) {
    throw new Error("retained-window boundary check did not reject an earlier unclearance despite a clear endpoint");
  }
  return { identicalStartupHistories: checks, steadyPositive: positive.boundaryClear,
    fullWindowNegative: { minimumSide: marginal.minimumSideDiffusionLengths, endpointSide: onlyLast, accepted: marginal.boundaryClear } };
}
mkdirSync(OUT, { recursive: true });
mkdirSync(resolve(OUT, "samples"), { recursive: true });
function saveRawSample(label, config, raw) {
  const path = `samples/${label}-${String(raw.steps).padStart(9, "0")}.json`;
  const text = JSON.stringify({ source: "direct GPU state snapshot; phase reconstruction inputs retained for independent reprocessing", config, ...raw });
  writeFileSync(resolve(OUT, path), text);
  return { path, sha256: createHash("sha256").update(text).digest("hex"), points: raw.points.length };
}
const geometry = selfTestTipGeometry();
const boundaryControls = boundaryProtocolControls();
const terminalControls = selfTestTipTerminalProtocol(observationPlans);
writeFileSync(resolve(OUT, "tip-contract.json"), JSON.stringify({ source: reference.source, contract, geometry, boundaryControls, terminalControls }, null, 2));
console.log("QPF3-TIP-METROLOGY OK", JSON.stringify({ rho: geometry.measured.rho, quarticControl: true,
  interpolationControls: geometry.interpolationControls, driftingControlRefused: !geometry.driftingControl,
  uncertainDriftControl: geometry.uncertainDriftControl, acceleratingControlRefused: !geometry.acceleratingControl,
  oscillatingControlRefused: !geometry.oscillatingControl }));
console.log("QPF3-TIP-BOUNDARY-PROTOCOL OK", JSON.stringify(boundaryControls));
console.log("QPF3-TIP-TERMINAL-PROTOCOL OK", JSON.stringify(terminalControls));
console.log("QPF3-TIP-EXECUTION-MODE", JSON.stringify({ diagnostic: selection.diagnostic, selectedArms: selection.names }));
if (selfOnly) process.exit(0);

const sourcePaths = ["src/sim3d.ts", "src/shaders3d.ts", "src/shaders3d-quant.ts",
  "scripts/verify-quant3d-tip.mjs", "scripts/fixtures/quant3d-tip-reference.json",
  "scripts/fixtures/quant3d-tip-driver.mjs", "scripts/fixtures/quant3d-tip-analysis.mjs", "scripts/fixtures/rect3d-specialize.mjs",
  "scripts/fixtures/quant3d-tip-protocol.mjs", "scripts/fixtures/quant3d-tip-protocol-controls.mjs", "scripts/browser-cleanup.mjs"];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const errors = [], result = { reference, contract, started: new Date().toISOString(),
  execution: { mode: selection.diagnostic ? "diagnostic subset" : "full five-arm study", selectedArms: selection.names,
    requested: selection.requested, fullRegistrationPreserved: true },
  metadata: null, equivalence: null, throughput: [], arms: [], errors, accepted: false,
  deviceErrorLedgerRead: false, sourceStable: false, status: "initializing" };
let browser = null, page = null, failures = 0;
const save = () => writeFileSync(resolve(OUT, "quant3d-tip-result.json"), JSON.stringify(result, null, 2));
const report = (name, ok, data) => { if (!ok) failures++; console.log(name, ok ? "OK" : "FAIL", JSON.stringify(data)); };
save();
try {
  result.sourceHashes = sourceHashes();
  const extraChromeArgs = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
  if (!Array.isArray(extraChromeArgs) || extraChromeArgs.some(v => typeof v !== "string")) throw new Error("CHROME_ARGS must be a JSON string array");
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    protocolTimeout: 3_600_000, args: ["--enable-unsafe-webgpu", "--enable-gpu", ...extraChromeArgs], defaultViewport: { width: 800, height: 700 } });
  page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", msg => {
    if (msg.type() === "error" || /binding size|minimum.*binding size/.test(msg.text())) errors.push(msg.text());
  });
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!window.__solidify);
  await page.evaluate(installQuant3TipDriver);
  result.metadata = await page.evaluate(async () => {
    const adapter = window.__solidifyTipAdapter;
    const { PHASE_TABLE_VERSION } = await import("/src/phasedata.ts");
    return { capturedAt: new Date().toISOString(), build: window.__solidify.app.meta().build, phaseTable: PHASE_TABLE_VERSION,
      seed: "deterministic sphere; no stochastic source", adapter: adapter?.info ? { vendor: adapter.info.vendor,
        architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null } : null,
      deviceLimits: { maxBufferSize: window.__solidifyTipDevice.limits.maxBufferSize,
        maxTextureDimension3D: window.__solidifyTipDevice.limits.maxTextureDimension3D },
      boundary: "cell-centered first octant; even scalar and odd normal correction-flux reflection; distant faces tested by enlargement" };
  });
  result.metadata.equationUnits = { length: "W0", time: "tau0", thermalDiffusivity: D, capillaryLength: d0 };
  result.metadata.sourceHashes = result.sourceHashes;
  result.equivalence = await page.evaluate(c => window.__q3tip.equivalence(c), arms[0]);
  const compared = result.equivalence.checkpoints.flatMap(p => p.comparisons);
  const identical = compared.length === 9 && compared.every(c => c.mismatches === 0 && c.productionHash === c.specializedHash);
  report("QPF3-TIP-PRODUCTION", identical, { fields: compared.length, comparisons: compared }); save();
  if (!identical) throw new Error("rectangular harness differs from production on a cube");

  const setup = await page.evaluate(c => window.__q3tip.stage(c), arms[0]);
  result.baseSetup = setup;
  const initial = await page.evaluate(() => window.__q3tip.sample());
  result.throughputInitialRaw = saveRawSample("throughput-initial", arms[0], initial);
  await page.evaluate(() => window.__q3tip.advance(4));
  for (const steps of [16, 32, 64]) {
    const timing = await page.evaluate(n => window.__q3tip.advance(n), steps);
    const voxels = arms[0].dims.reduce((a, b) => a * b, 1), stepsPerSecond = steps / timing.seconds;
    const estimatedSteps = Math.ceil(contract.maximumTimeTau0 / arms[0].dt);
    const row = { ...timing, stepsPerSecond, millionVoxelSubstepsPerSecond: voxels * stepsPerSecond / 1e6,
      projectedBaseMinutes: estimatedSteps / stepsPerSecond / 60, textureMiB: voxels * setup.bytesPerVoxel / 2 ** 20 };
    result.throughput.push(row); console.log("QPF3-TIP-THROUGHPUT", JSON.stringify(row)); save();
  }
  const after = await page.evaluate(() => window.__q3tip.sample());
  result.throughputFinalRaw = saveRawSample("throughput-final", arms[0], after);
  result.throughputFarFieldDiagnostics = { initial: initial.farFieldDiagnostics, final: after.farFieldDiagnostics };
  const axis = s => s.points.find(p => p.x === arms[0].dx / 2 && p.y === arms[0].dx / 2)?.z;
  report("QPF3-TIP-LIVENESS", Number.isFinite(axis(initial)) && axis(after) > axis(initial),
    { initialTipW0: axis(initial), finalTipW0: axis(after), timeTau0: after.time });
  if (failures || errors.length) throw new Error("throughput preparation failed");
  if (!runLong) {
    result.status = "throughput-only; long operating-state acceptance not run";
    console.log(result.status); save();
  } else {
    for (const arm of selection.selected) {
      const plan = observationPlans.get(arm.name);
      const options = { D: arm.D, d0: arm.d0, dims: arm.dims, dx: arm.dx, relativeTarget: contract.relativeTarget };
      const data = { config: arm, setup: await page.evaluate(c => window.__q3tip.stage(c), arm),
        samples: [], unresolvedSamples: [], state: null, firstQualified: null };
      result.arms.push(data); save();
      const zero = await page.evaluate(() => window.__q3tip.sample()), initialTip = Math.max(...zero.points.map(p => p.z));
      data.initialRaw = saveRawSample(`${arm.name}-initial`, arm, zero);
      const initialTipUpper = Math.max(initialTip, arm.radius);
      data.initialFarFieldDiagnostics = zero.farFieldDiagnostics;
      let time = 0, observedSteps = 0;
      for (const checkpoint of plan.checkpoints) {
        const count = checkpoint.steps - observedSteps;
        const advanced = await page.evaluate(n => window.__q3tip.advance(n), count);
        const raw = await page.evaluate(() => window.__q3tip.sample()); time = raw.time; observedSteps = raw.steps;
        if (observedSteps !== checkpoint.steps) throw new Error("GPU fixture missed a declared observation substep");
        const rawSample = saveRawSample(arm.name, arm, raw);
        try {
          const local = localTip(raw.points, arm.dx), sample = { time, steps: raw.steps, ...local,
            aheadBoundaryTemperature: raw.aheadBoundaryTemperature, farFieldDiagnostics: raw.farFieldDiagnostics, rawSample };
          data.samples.push(sample);
          data.state = operatingState(data.samples, options);
          const s = data.state;
          if (s.ready) {
            s.travelDiffusionLengths = (s.tip - initialTip) / s.diffusionLength;
            s.boundaryAssessment = retainedBoundaryCheck(data.samples, s, arm, initialTipUpper);
            s.boundaryClear = s.boundaryAssessment.assessed && s.boundaryAssessment.boundaryClear;
            if (data.firstQualified == null && s.stationary && s.resolved && s.boundaryClear
                && s.boundaryAssessment.conservativeTravelDiffusionLengths >= contract.minimumTravelDiffusionLengths) {
              data.firstQualified = { diagnosticOnly: true, timeTau0: time, physicalTime: time / arm.physicalTimeScale,
                steps: raw.steps, P: s.P, sigmaStar: s.sigmaStar };
            }
          }
        } catch (error) { data.unresolvedSamples.push({ time, reason: String(error), rawSample }); }
        console.log("QPF3-TIP-PROGRESS", JSON.stringify({ arm: arm.name, timeTau0: time, steps: raw.steps,
          seconds: advanced.seconds, tip: data.state?.tip, P: data.state?.P, sigmaStar: data.state?.sigmaStar,
          stationary: data.state?.stationary, resolved: data.state?.resolved, firstQualified: data.firstQualified })); save();
      }
      const terminal = terminalOperatingState(data.samples, plan, options, observedSteps);
      data.terminalObservation = { ...plan, complete: terminal.complete, endpointReached: terminal.endpointReached,
        reason: terminal.reason ?? null, observedSteps, reportedTimeTau0: time, retainedSteps: terminal.retainedSteps };
      data.state = terminal.state;
      const s = data.state;
      if (s.ready) {
        s.travelDiffusionLengths = (s.tip - initialTip) / s.diffusionLength;
        s.boundaryAssessment = retainedBoundaryCheck(terminal.samples, s, arm, initialTipUpper);
        s.boundaryClear = s.boundaryAssessment.assessed && s.boundaryAssessment.boundaryClear;
      }
      data.stop = terminal.complete ? "fixed declared terminal substep reached; declared terminal window evaluated"
        : "fixed declared terminal substep reached; terminal window refused";
      const assessment = terminalReferenceAssessment(terminal, target.full3D, contract.relativeTarget);
      data.relativeError = assessment.relativeError;
      data.referenceErrorBudget = assessment.referenceErrorBudget;
      data.accepted = !!(assessment.accepted && s.boundaryClear
        && s.boundaryAssessment.conservativeTravelDiffusionLengths >= contract.minimumTravelDiffusionLengths);
      report(`QPF3-TIP-${arm.name.toUpperCase()}`, data.accepted, { state: data.state, relativeError: data.relativeError,
        referenceErrorBudget: data.referenceErrorBudget, stop: data.stop, timeTau0: time,
        terminalObservation: data.terminalObservation, firstQualified: data.firstQualified }); save();
    }
    const base = result.arms.find(arm => arm.config.name === "base")?.state;
    result.convergence = result.arms.filter(arm => arm.config.name !== "base").map(a => ({ arm: a.config.name, changes: Object.fromEntries(["P", "sigmaStar", "rhoOverD0", "Vd0OverD"].map(key =>
      [key, a.state?.ready && base?.ready ? Math.abs(a.state[key] / base[key] - 1) : null])) }));
    const converged = selection.diagnostic ? null : result.convergence.length === 4
      && result.convergence.every(r => Object.values(r.changes).every(v => v != null && v <= contract.relativeTarget));
    result.controlsConverged = converged;
    if (selection.diagnostic) console.log("QPF3-TIP-CONVERGENCE NOT-EVALUATED", JSON.stringify({ reason: "diagnostic subset; full control matrix not run", comparisons: result.convergence }));
    else report("QPF3-TIP-CONVERGENCE", converged, { converged, comparisons: result.convergence });
    result.status = "terminal results collected; checking final execution evidence"; save();
  }
} catch (error) {
  failures++; result.exception = error.stack ?? String(error); result.status = "refused or failed";
  console.error(result.exception);
} finally {
  const failedEvidence = (label, error) => errors.push(`${label}: ${error?.message ?? String(error)}`);
  if (page) {
    try { await page.evaluate(async () => { await window.__q3tip?.destroy(); }); }
    catch (error) { failedEvidence("fixture cleanup failed", error); }
    try {
      const deviceErrors = await page.evaluate(() => {
        if (!Array.isArray(window.__solidifyTipDeviceErrors)) throw new Error("GPU error ledger is unavailable");
        return [...window.__solidifyTipDeviceErrors];
      });
      if (!Array.isArray(deviceErrors)) throw new Error("GPU error ledger did not return an array");
      errors.push(...deviceErrors); result.deviceErrorLedgerRead = true;
    } catch (error) { failedEvidence("GPU error ledger read failed", error); }
    try { await page.evaluate(() => { window.__solidifyTipDevice?.destroy(); }); }
    catch (error) { failedEvidence("device cleanup failed", error); }
  }
  if (browser) {
    try { await closeBrowser(browser); }
    catch (error) { failedEvidence("browser cleanup failed", error); }
  }
  if (result.sourceHashes) {
    try {
      result.finalHashes = sourceHashes();
      result.sourceStable = JSON.stringify(result.sourceHashes) === JSON.stringify(result.finalHashes);
      if (!result.sourceStable) errors.push("benchmark source changed during execution");
    } catch (error) { failedEvidence("final source verification failed", error); }
  }
  if (runLong) {
    result.overallAcceptance = tipOverallAcceptance({ arms: result.arms, controlsConverged: result.controlsConverged,
      errors, executionFailed: result.exception != null });
    result.overallAcceptance.deviceErrorLedgerRead = result.deviceErrorLedgerRead;
    result.overallAcceptance.sourceStable = result.sourceStable;
    result.accepted = result.overallAcceptance.accepted && result.deviceErrorLedgerRead && result.sourceStable;
    result.overallAcceptance.accepted = result.accepted;
    if (selection.diagnostic) console.log("QPF3-TIP-ACCEPTANCE NOT-EVALUATED", JSON.stringify(result.overallAcceptance));
    else report("QPF3-TIP-ACCEPTANCE", result.accepted, result.overallAcceptance);
  }
  result.status = result.exception ? "refused or failed" : errors.length ? "execution evidence failed"
    : !runLong ? "throughput-only; long operating-state acceptance not run"
    : selection.diagnostic ? "diagnostic subset complete; full Q3 acceptance not evaluated"
    : result.accepted ? "long 3D tip accepted" : "long 3D tip not accepted";
  result.finished = new Date().toISOString();
  result.errors = errors; result.failures = failures; save();
}
if (errors.length || failures) process.exitCode = 1;
