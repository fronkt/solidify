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
const baseDt = (dx, coupling = lambda) => Math.min(dx * dx / (12 * A2 * coupling), .02 * (1 - 3 * target.epsilon4) ** 2 * Math.min(1, (dx / .8) ** 2));
const common = { lambda, epsilon4: target.epsilon4, undercooling: reference.undercooling, radius: 8 };
const arms = [
  { name: "base", dims: [216, 216, 432], dx: .8, dt: baseDt(.8) },
  { name: "domain", dims: [240, 240, 480], dx: .8, dt: baseDt(.8) },
  { name: "dx", dims: [288, 288, 576], dx: .6, dt: baseDt(.6) },
  { name: "dt", dims: [216, 216, 432], dx: .8, dt: baseDt(.8) / 2 },
  { name: "width", dims: [240, 240, 480], dx: .8, lambda: 3.6, dt: baseDt(.8, 3.6) },
].map(arm => {
  const coupling = arm.lambda ?? lambda, timeScale = (lambda / coupling) ** 3;
  return { ...common, ...arm, D: A2 * coupling, d0: A1 / coupling,
    radius: common.radius * lambda / coupling, physicalTimeScale: timeScale,
    maximumTimeTau0: 8 * diffusionExpected / velocityExpected * timeScale,
    samplePeriodTau0: .25 * diffusionExpected / velocityExpected * timeScale };
});
const contract = {
  target: target.full3D, relativeTarget: reference.acceptance.relativeTarget,
  expected: { rhoW0: rhoExpected, velocityW0PerTau0: velocityExpected, diffusionLengthW0: diffusionExpected },
  arms, minimumTravelDiffusionLengths: 6, minimumBoundaryDiffusionLengths: 8,
  maximumTimeTau0: 8 * diffusionExpected / velocityExpected,
  samplePeriodTau0: .25 * diffusionExpected / velocityExpected,
  metrology: "quintic roots in the monotone atanh(1-2psi) ordinate checked against cubic roots in the same ordinate; raw-phase quintic sensitivity reported separately; even quadratic and quartic local surfaces over .25-.5 rho, extrapolated against window^4",
  stationarity: "last three four-sample windows overlap within independently estimated geometry/linear-fit uncertainty; full retained-window rho and velocity variation each <=one quarter of the reference target, independently of geometric uncertainty; propagated P and sigma uncertainty below the target",
  note: "Raw cubic epsilon4 is refined with dx; no unpublished grid-anisotropy correction is inserted to match the paper.",
  widthMatching: "W0 scales with lambda; tau0 scales with lambda^3. Extents and initial radius/d0 match; compare P, sigma, rho/d0 and Vd0/D, never unscaled solver rho or velocity across lambda.",
};
mkdirSync(OUT, { recursive: true });
const geometry = selfTestTipGeometry();
writeFileSync(resolve(OUT, "tip-contract.json"), JSON.stringify({ source: reference.source, contract, geometry }, null, 2));
console.log("QPF3-TIP-METROLOGY OK", JSON.stringify({ rho: geometry.measured.rho, quarticControl: true,
  interpolationControls: geometry.interpolationControls, driftingControlRefused: !geometry.driftingControl,
  uncertainDriftControl: geometry.uncertainDriftControl, acceleratingControlRefused: !geometry.acceleratingControl,
  oscillatingControlRefused: !geometry.oscillatingControl }));
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
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    const { PHASE_TABLE_VERSION } = await import("/src/phasedata.ts");
    return { capturedAt: new Date().toISOString(), build: window.__solidify.app.meta().build, phaseTable: PHASE_TABLE_VERSION,
      seed: "deterministic sphere; no stochastic source", adapter: adapter?.info ? { vendor: adapter.info.vendor,
        architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null,
      boundary: "cell-centered first octant; reflected zero-normal-gradient faces via production clamping; distant faces tested by enlargement" };
  });
  result.metadata.equationUnits = { length: "W0", time: "tau0", thermalDiffusivity: D, capillaryLength: d0 };
  result.metadata.sourceHashes = Object.fromEntries(["src/sim3d.ts", "src/shaders3d.ts", "src/shaders3d-quant.ts",
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
      let time = 0;
      while (time < arm.maximumTimeTau0) {
        const count = Math.max(1, Math.ceil(Math.min(arm.samplePeriodTau0, arm.maximumTimeTau0 - time) / arm.dt));
        const advanced = await page.evaluate(n => window.__q3tip.advance(n), count);
        const raw = await page.evaluate(() => window.__q3tip.sample()); time = raw.time;
        try {
          const local = localTip(raw.points, arm.dx), sample = { time, steps: raw.steps, ...local, aheadBoundaryTemperature: raw.aheadBoundaryTemperature };
          data.samples.push(sample);
          data.state = operatingState(data.samples, { D: arm.D, d0: arm.d0, dims: arm.dims, dx: arm.dx, relativeTarget: contract.relativeTarget });
          const s = data.state;
          if (s.ready) {
            s.travelDiffusionLengths = (s.tip - initialTip) / s.diffusionLength;
            s.boundaryClear = s.aheadDiffusionLengths >= contract.minimumBoundaryDiffusionLengths
              && s.sideDiffusionLengths >= contract.minimumBoundaryDiffusionLengths;
            if (!s.boundaryClear) { data.stop = "diffusion field too close to a non-symmetry face"; break; }
            if (s.stationary && s.resolved && s.travelDiffusionLengths >= contract.minimumTravelDiffusionLengths
                && (matchedTime == null || time / arm.physicalTimeScale >= matchedTime)) { data.stop = "resolved stationary window"; break; }
          }
        } catch (error) { data.unresolvedSamples.push({ time, reason: String(error) }); }
        console.log("QPF3-TIP-PROGRESS", JSON.stringify({ arm: arm.name, timeTau0: time, steps: raw.steps,
          seconds: advanced.seconds, tip: data.state?.tip, P: data.state?.P, sigmaStar: data.state?.sigmaStar,
          stationary: data.state?.stationary, resolved: data.state?.resolved })); save();
      }
      if (arm.name === "base") matchedTime = time;
      const s = data.state;
      data.relativeError = s?.ready ? { P: Math.abs(s.P / target.full3D.P - 1), sigmaStar: Math.abs(s.sigmaStar / target.full3D.sigmaStar - 1) } : null;
      data.referenceErrorBudget = s?.ready ? Object.fromEntries(["P", "sigmaStar"].map(key => [key,
        (1 + data.relativeError[key]) * (1 + s.uncertainty[key]) * (1 + s.drift[key]) - 1])) : null;
      data.accepted = !!(data.samples.at(-1)?.time === time && s?.ready && s.stationary && s.resolved && s.boundaryClear
        && s.travelDiffusionLengths >= contract.minimumTravelDiffusionLengths
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
  result.errors = errors; result.failures = failures; save();
  await closeBrowser(browser);
}
if (errors.length || failures) process.exitCode = 1;
