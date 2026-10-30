// Long 3D operating-state benchmark. Default: geometry self-check, unchanged-
// production specialization check, then throughput only. --run executes all
// pre-registered arms. Throughput is never reported as tip acceptance.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { closeBrowser } from "./browser-cleanup.mjs";
import { installQuant3TipDriver } from "./fixtures/quant3d-tip-driver.mjs";
import { localTip, operatingState, selfTestTipGeometry } from "./fixtures/quant3d-tip-analysis.mjs";

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
const maximumTime = 8 * D / velocityMinimum ** 2;
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
    samplePeriodTau0: .25 * diffusionExpected / velocityExpected * timeScale };
});
const contract = {
  protocolVersion: 3,
  previousStudy: { pin: "ad96166", artifact: "verify-out/q3-cloud-full-progress.json",
    outcome: "all five arms stopped during startup on D/V side-clearance proxy; no steady operating state accepted",
    change: "reference-band-derived geometry/time, no startup proxy abort, conservative retained-steady-window clearance and direct far-field patches; no physical parameter or accuracy threshold changed" },
  target: target.full3D, relativeTarget: reference.acceptance.relativeTarget,
  expected: { rhoW0: rhoExpected, velocityW0PerTau0: velocityExpected, diffusionLengthW0: diffusionExpected },
  arms, minimumTravelDiffusionLengths: 6, minimumBoundaryDiffusionLengths: 8,
  maximumTimeTau0: maximumTime,
  referenceBandGeometry: { velocityMinimum, velocityMaximum, radiusMaximum,
    minimumSideW0: 8 * D / velocityMinimum + .5 * radiusMaximum,
    minimumAxialW0AtMaximumSpeedAndHorizon: common.radius + velocityMaximum * maximumTime + 8 * D / velocityMaximum,
    derivation: "rho/d0=1/(P*sigma), V*d0/D=2*sigma*P^2; Vmin=(1-r)^3 Vref, rhomax=rhoref/(1-r)^2, horizon=8D/Vmin^2. Actual retained-window clearance remains mandatory." },
  samplePeriodTau0: .25 * diffusionExpected / velocityExpected,
  metrology: "quintic roots in the monotone atanh(1-2psi) ordinate checked against cubic roots in the same ordinate; raw-phase quintic sensitivity reported separately; even quadratic and quartic local surfaces over .25-.5 rho, extrapolated against window^4",
  stationarity: "last three four-sample windows overlap within independently estimated geometry/linear-fit uncertainty; full retained-window rho and velocity variation each <=one quarter of the reference target, independently of geometric uncertainty; propagated P and sigma uncertainty below the target",
  note: "Raw cubic epsilon4 is refined with dx; no unpublished grid-anisotropy correction is inserted to match the paper.",
  widthMatching: "W0 scales with lambda; tau0 scales with lambda^3. Extents and initial radius/d0 match; compare P, sigma, rho/d0 and Vd0/D, never unscaled solver rho or velocity across lambda.",
  boundaryAssessment: "D/V is a startup diagnostic, not an early contamination verdict. Final clearance must exceed eight conservative D/V lengths at every sample of the retained stationary window; conservative speed is min(V-error) over its fitted windows and geometry uses upper uncertainty bounds.",
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
writeFileSync(resolve(OUT, "tip-contract.json"), JSON.stringify({ source: reference.source, contract, geometry, boundaryControls }, null, 2));
console.log("QPF3-TIP-METROLOGY OK", JSON.stringify({ rho: geometry.measured.rho, quarticControl: true,
  interpolationControls: geometry.interpolationControls, driftingControlRefused: !geometry.driftingControl,
  uncertainDriftControl: geometry.uncertainDriftControl, acceleratingControlRefused: !geometry.acceleratingControl,
  oscillatingControlRefused: !geometry.oscillatingControl }));
console.log("QPF3-TIP-BOUNDARY-PROTOCOL OK", JSON.stringify(boundaryControls));
if (selfOnly) process.exit(0);

const extraChromeArgs = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
if (!Array.isArray(extraChromeArgs) || extraChromeArgs.some(v => typeof v !== "string")) throw new Error("CHROME_ARGS must be a JSON string array");
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  protocolTimeout: 3_600_000, args: ["--enable-unsafe-webgpu", "--enable-gpu", ...extraChromeArgs], defaultViewport: { width: 800, height: 700 } });
const page = await browser.newPage(), errors = [], result = { reference, contract, metadata: null, equivalence: null, throughput: [], arms: [], errors, accepted: false };
let failures = 0;
const save = () => writeFileSync(resolve(OUT, "quant3d-tip-result.json"), JSON.stringify(result, null, 2));
const report = (name, ok, data) => { if (!ok) failures++; console.log(name, ok ? "OK" : "FAIL", JSON.stringify(data)); };
page.on("pageerror", e => errors.push(e.message));
page.on("console", msg => {
  if (msg.type() === "error" || /binding size|minimum.*binding size/.test(msg.text())) errors.push(msg.text());
});
try {
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
  result.metadata.sourceHashes = Object.fromEntries(["src/sim3d.ts", "src/shaders3d.ts", "src/shaders3d-quant.ts",
    "scripts/verify-quant3d-tip.mjs", "scripts/fixtures/quant3d-tip-reference.json",
    "scripts/fixtures/quant3d-tip-driver.mjs", "scripts/fixtures/quant3d-tip-analysis.mjs", "scripts/fixtures/rect3d-specialize.mjs"].map(path =>
    [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
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
    let matchedTime = null;
    for (const arm of arms) {
      const data = { config: arm, setup: await page.evaluate(c => window.__q3tip.stage(c), arm), samples: [], unresolvedSamples: [], state: null };
      result.arms.push(data); save();
      const zero = await page.evaluate(() => window.__q3tip.sample()), initialTip = Math.max(...zero.points.map(p => p.z));
      data.initialRaw = saveRawSample(`${arm.name}-initial`, arm, zero);
      const initialTipUpper = Math.max(initialTip, arm.radius);
      data.initialFarFieldDiagnostics = zero.farFieldDiagnostics;
      let time = 0;
      while (time < arm.maximumTimeTau0) {
        const count = Math.max(1, Math.ceil(Math.min(arm.samplePeriodTau0, arm.maximumTimeTau0 - time) / arm.dt));
        const advanced = await page.evaluate(n => window.__q3tip.advance(n), count);
        const raw = await page.evaluate(() => window.__q3tip.sample()); time = raw.time;
        const rawSample = saveRawSample(arm.name, arm, raw);
        try {
          const local = localTip(raw.points, arm.dx), sample = { time, steps: raw.steps, ...local,
            aheadBoundaryTemperature: raw.aheadBoundaryTemperature, farFieldDiagnostics: raw.farFieldDiagnostics, rawSample };
          data.samples.push(sample);
          data.state = operatingState(data.samples, { D: arm.D, d0: arm.d0, dims: arm.dims, dx: arm.dx, relativeTarget: contract.relativeTarget });
          const s = data.state;
          if (s.ready) {
            s.travelDiffusionLengths = (s.tip - initialTip) / s.diffusionLength;
            s.boundaryAssessment = retainedBoundaryCheck(data.samples, s, arm, initialTipUpper);
            s.boundaryClear = s.boundaryAssessment.assessed && s.boundaryAssessment.boundaryClear;
            if (s.stationary && s.resolved && s.boundaryClear
                && s.boundaryAssessment.conservativeTravelDiffusionLengths >= contract.minimumTravelDiffusionLengths
                && (matchedTime == null || time / arm.physicalTimeScale >= matchedTime)) { data.stop = "resolved stationary window"; break; }
          }
        } catch (error) { data.unresolvedSamples.push({ time, reason: String(error), rawSample }); }
        console.log("QPF3-TIP-PROGRESS", JSON.stringify({ arm: arm.name, timeTau0: time, steps: raw.steps,
          seconds: advanced.seconds, tip: data.state?.tip, P: data.state?.P, sigmaStar: data.state?.sigmaStar,
          stationary: data.state?.stationary, resolved: data.state?.resolved })); save();
      }
      if (arm.name === "base") matchedTime = time;
      data.stop ??= "fixed registered horizon; no qualifying stationary and boundary-clear window";
      const s = data.state;
      data.relativeError = s?.ready ? { P: Math.abs(s.P / target.full3D.P - 1), sigmaStar: Math.abs(s.sigmaStar / target.full3D.sigmaStar - 1) } : null;
      data.referenceErrorBudget = s?.ready ? Object.fromEntries(["P", "sigmaStar"].map(key => [key,
        (1 + data.relativeError[key]) * (1 + s.uncertainty[key]) * (1 + s.drift[key]) - 1])) : null;
      data.accepted = !!(data.samples.at(-1)?.time === time && s?.ready && s.stationary && s.resolved && s.boundaryClear
        && s.boundaryAssessment.conservativeTravelDiffusionLengths >= contract.minimumTravelDiffusionLengths
        && data.referenceErrorBudget.P <= contract.relativeTarget && data.referenceErrorBudget.sigmaStar <= contract.relativeTarget);
      report(`QPF3-TIP-${arm.name.toUpperCase()}`, data.accepted, { state: data.state, relativeError: data.relativeError,
        referenceErrorBudget: data.referenceErrorBudget, stop: data.stop, timeTau0: time }); save();
    }
    const base = result.arms[0].state;
    result.convergence = result.arms.slice(1).map(a => ({ arm: a.config.name, changes: Object.fromEntries(["P", "sigmaStar", "rhoOverD0", "Vd0OverD"].map(key =>
      [key, a.state?.ready && base?.ready ? Math.abs(a.state[key] / base[key] - 1) : null])) }));
    const converged = result.convergence.length === 4 && result.convergence.every(r => Object.values(r.changes).every(v => v != null && v <= contract.relativeTarget));
    result.accepted = result.arms.length === 5 && result.arms.every(a => a.accepted) && converged && errors.length === 0;
    report("QPF3-TIP-CONVERGENCE", result.accepted, result.convergence);
    result.status = result.accepted ? "long 3D tip accepted" : "long 3D tip not accepted"; save();
  }
} catch (error) {
  failures++; result.exception = error.stack ?? String(error); result.status = "refused or failed";
  console.error(result.exception);
} finally {
  await page.evaluate(async () => { await window.__q3tip?.destroy(); }).catch(() => {});
  const deviceErrors = await page.evaluate(() => window.__solidifyTipDeviceErrors ?? []).catch(() => []);
  errors.push(...deviceErrors);
  if (deviceErrors.length) { result.accepted = false; result.status = "device validation failed"; }
  await page.evaluate(() => { window.__solidifyTipDevice?.destroy(); }).catch(() => {});
  result.errors = errors; result.failures = failures; save();
  await closeBrowser(browser);
}
if (errors.length || failures) process.exitCode = 1;
