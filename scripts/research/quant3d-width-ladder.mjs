// Q3c interface-width ladder (research diagnostic; never Q3 acceptance).
// Protocol: scripts/research/quant3d-width-ladder.md (frozen before any run).
// Default and --self-test: CPU controls only (predictions, verdict known-truth
// and negative controls, ladder metrology). --run starts the three registered
// GPU arms through the existing tip driver with the opt-in lattice-kinetics
// research option. No shader, coefficient, estimator or reference band changes.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { closeBrowser } from '../browser-cleanup.mjs';
import { installQuant3TipDriver } from '../fixtures/quant3d-tip-driver.mjs';
import { localTip } from '../fixtures/quant3d-tip-analysis.mjs';
import { fixedTerminalSchedule, terminalOperatingState } from '../fixtures/quant3d-tip-protocol.mjs';
import { captureTranslationSources } from './quant3d-equilibrium-translation.mjs';
import { runLadderMetrology } from './quant3d-width-ladder-metrology.mjs';
import { IVANTSOV_PECLET, LADDER_ARMS, RULES, ladderContract, ladderVerdict,
  selfTestLadderVerdict } from './quant3d-width-ladder-model.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function retainedBoundary(samples, state, arm, initialTip) {
  if (!state?.ready) return { assessed: false, boundaryClear: false };
  const lower = Math.min(...state.windows.map(win => win.velocity - win.velocityError));
  if (!(lower > 0)) return { assessed: false, boundaryClear: false };
  const L = arm.D / lower, last = samples.at(-1);
  const checks = samples.map(s => ({ ahead: (arm.dims[2] * arm.dx - (s.tip + s.tipError)) / L,
    side: (Math.min(arm.dims[0], arm.dims[1]) * arm.dx - .5 * (s.rho + s.rhoError)) / L }));
  return { assessed: true, boundaryClear: checks.every(c => c.ahead >= RULES.minimumBoundaryDiffusionLengths
      && c.side >= RULES.minimumBoundaryDiffusionLengths),
    minimumAhead: Math.min(...checks.map(c => c.ahead)), minimumSide: Math.min(...checks.map(c => c.side)),
    conservativeTravelDiffusionLengths: (last.tip - last.tipError - Math.max(initialTip, arm.radius)) / L };
}

async function main() {
  const args = process.argv.slice(2), pos = args.filter(a => !a.startsWith('--'));
  const OUT = resolve(pos[0] ?? 'verify-out/q3c-width-ladder'), PORT = pos[1] ?? '5199', run = args.includes('--run');
  mkdirSync(resolve(OUT, 'samples'), { recursive: true });
  const resultPath = resolve(OUT, 'width-ladder-result.json');
  const result = { purpose: 'Q3c interface-width ladder; diagnostic hypothesis test, never Q3 acceptance',
    started: new Date().toISOString(), contract: ladderContract(), completed: false, q3Accepted: false, status: 'self-test' };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2));
  save();
  result.verdictControls = selfTestLadderVerdict();
  const metrology = runLadderMetrology();
  result.metrologyControls = { passed: metrology.passed, failures: metrology.failures.length, summary: metrology.summary };
  assert.ok(metrology.passed, 'ladder metrology known-truth controls failed');
  console.log('Q3C-LADDER-VERDICT-CONTROLS OK', JSON.stringify(result.verdictControls.map(c => [c.truth, c.verdict])));
  console.log('Q3C-LADDER-METROLOGY OK', JSON.stringify({ failures: 0 }));
  console.log('Q3C-LADDER-PLAN', JSON.stringify(result.contract.arms.map(a => ({ name: a.name, dims: a.dims, dt: a.dt,
    terminalSteps: a.terminalSteps, estimatedIntelMinutes: +a.estimatedIntelMinutes.toFixed(1) }))));
  if (!run) { result.status = 'CPU controls complete; GPU ladder not run'; result.completed = true; save(); return; }

  const sourcePaths = ['src/sim3d.ts', 'src/shaders3d.ts', 'src/shaders3d-quant.ts', 'scripts/browser-cleanup.mjs',
    'scripts/fixtures/quant3d-tip-driver.mjs', 'scripts/fixtures/quant3d-tip-analysis.mjs', 'scripts/fixtures/rect3d-specialize.mjs',
    'scripts/fixtures/quant3d-tip-protocol.mjs', 'scripts/research/quant3d-width-ladder.mjs', 'scripts/research/quant3d-width-ladder-model.mjs',
    'scripts/research/quant3d-width-ladder.md',
    'scripts/research/quant3d-width-ladder-metrology.mjs', 'scripts/research/quant3d-equilibrium-translation.mjs'];
  const hashes = () => Object.fromEntries(sourcePaths.map(p => [p, sha(readFileSync(resolve(ROOT, p)))]));
  const errors = [];
  result.errors = errors; result.status = 'initializing'; result.arms = []; result.deviceErrorLedgerRead = false;
  let browser = null, page = null, exception = null;
  try {
    result.source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    result.sourceHashes = hashes(); save();
    result.sourceCapture = captureTranslationSources({ root: ROOT, out: OUT, sourceHashes: result.sourceHashes,
      source: result.source, started: result.started }); save();
    const extra = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
    if (!Array.isArray(extra) || extra.some(v => typeof v !== 'string')) throw new Error('CHROME_ARGS must be a JSON string array');
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true, protocolTimeout: 3_600_000, args: ['--enable-unsafe-webgpu', '--enable-gpu', ...extra] });
    page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' || /binding size/.test(m.text())) errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.__solidify);
    await page.evaluate(installQuant3TipDriver, { latticeKinetics: true });
    result.metadata = await page.evaluate(async () => {
      const adapter = window.__solidifyTipAdapter;
      return { capturedAt: new Date().toISOString(), build: window.__solidify.app.meta().build,
        adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
          isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null } : null };
    });
    result.equivalence = await page.evaluate(c => window.__q3tip.equivalence(c), LADDER_ARMS[0]);
    const pairs = result.equivalence.checkpoints.flatMap(p => p.comparisons);
    if (!(pairs.length === 9 && pairs.every(c => c.mismatches === 0 && c.productionHash === c.specializedHash))) {
      throw new Error('rectangular harness differs from native Sim3D on a cube');
    }
    save();
    for (const arm of LADDER_ARMS) {
      const plan = fixedTerminalSchedule({ dt: arm.dt, physicalTimeScale: arm.physicalTimeScale });
      const options = { D: arm.D, d0: arm.d0, dims: arm.dims, dx: arm.dx, relativeTarget: .1 };
      const data = { config: arm, setup: await page.evaluate(c => window.__q3tip.stage(c), arm), samples: [], unresolved: [], raw: [] };
      result.arms.push(data); save();
      const zero = await page.evaluate(() => window.__q3tip.sample());
      const initialTip = Math.max(...zero.points.map(p => p.z));
      let observed = 0, time = 0;
      const started = Date.now();
      for (const checkpoint of plan.checkpoints) {
        await page.evaluate(n => window.__q3tip.advance(n), checkpoint.steps - observed);
        const raw = await page.evaluate(() => window.__q3tip.sample()); observed = raw.steps; time = raw.time;
        if (observed !== checkpoint.steps) throw new Error('GPU fixture missed a declared observation substep');
        const text = JSON.stringify({ source: 'direct GPU state snapshot; Q3c width ladder', config: arm, ...raw });
        const path = `samples/${arm.name}-${String(raw.steps).padStart(9, '0')}.json`;
        writeFileSync(resolve(OUT, path), text); data.raw.push({ path, sha256: sha(text) });
        try { data.samples.push({ time, steps: raw.steps, ...localTip(raw.points, arm.dx) }); }
        catch (error) { data.unresolved.push({ steps: raw.steps, reason: String(error) }); }
        console.log('Q3C-LADDER-PROGRESS', JSON.stringify({ arm: arm.name, steps: raw.steps, of: plan.terminalSteps,
          minutes: +((Date.now() - started) / 60000).toFixed(2) }));
      }
      const terminal = terminalOperatingState(data.samples, plan, options, observed);
      const s = terminal.state;
      data.terminal = { complete: terminal.complete, reason: terminal.reason ?? null, state: s, wallMinutes: (Date.now() - started) / 60000 };
      if (s.ready) {
        data.boundary = retainedBoundary(terminal.samples, s, arm, initialTip);
        data.derived = { Vd0OverD: s.velocity * arm.d0 / arm.D, sigma: s.sigmaStar, P: s.P,
          rhoOverRhoIv: s.rho * s.velocity / (2 * arm.D * IVANTSOV_PECLET),
          velocitySpread: (Math.max(...s.windows.map(x => x.velocity)) - Math.min(...s.windows.map(x => x.velocity))) / s.velocity };
      }
      data.valid = !!(terminal.complete && s.ready && s.stationary && s.resolved && data.boundary?.boundaryClear
        && data.boundary.conservativeTravelDiffusionLengths >= RULES.minimumTravelDiffusionLengths);
      console.log('Q3C-LADDER-ARM', JSON.stringify({ arm: arm.name, valid: data.valid, derived: data.derived ?? null })); save();
    }
  } catch (error) { exception = error; result.exception = error.stack ?? String(error); }
  finally {
    if (page) {
      try { await page.evaluate(async () => { await window.__q3tip?.destroy(); }); } catch (e) { errors.push(`fixture cleanup failed: ${e.message}`); }
      try {
        const ledger = await page.evaluate(() => {
          if (!Array.isArray(window.__solidifyTipDeviceErrors)) throw new Error('GPU error ledger is unavailable');
          return [...window.__solidifyTipDeviceErrors];
        });
        errors.push(...ledger); result.deviceErrorLedgerRead = true;
      } catch (e) { errors.push(`GPU error ledger read failed: ${e.message}`); }
      try { await page.evaluate(() => { window.__solidifyTipDevice?.destroy(); }); } catch (e) { errors.push(`device cleanup failed: ${e.message}`); }
    }
    if (browser) { try { await closeBrowser(browser); } catch (e) { errors.push(`browser cleanup failed: ${e.message}`); } }
    if (result.sourceHashes) {
      try { result.sourceStable = JSON.stringify(hashes()) === JSON.stringify(result.sourceHashes); }
      catch (e) { result.sourceStable = false; errors.push(`final source verification failed: ${e.message}`); }
      if (!result.sourceStable) errors.push('ladder source changed during execution');
    }
    const byName = Object.fromEntries((result.arms ?? []).map(a => [a.config.name, a]));
    const complete = ['w50', 'w44', 'w40-anchor'].every(n => byName[n]?.derived);
    const executionClean = !exception && errors.length === 0 && result.deviceErrorLedgerRead && result.sourceStable === true;
    result.verdict = complete ? ladderVerdict({ executionClean,
      valid: ['w50', 'w44', 'w40-anchor'].every(n => byName[n].valid),
      anchor: byName['w40-anchor'].derived, w44: byName.w44.derived, w50: byName.w50.derived })
      // Protocol rules 1-2: a failed execution refuses first; otherwise an arm
      // without a resolved terminal state is an invalid arm.
      : { verdict: exception || !executionClean ? 'refused-execution' : 'refused-validity', q3Accepted: false };
    result.completed = complete && executionClean;
    result.status = result.verdict.verdict; result.finished = new Date().toISOString(); save();
    console.log('Q3C-LADDER-VERDICT', JSON.stringify(result.verdict));
    if (exception || errors.length) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pos = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const out = resolve(pos[0] ?? 'verify-out/q3c-width-ladder'), path = resolve(out, 'width-ladder-result.json');
  try {
    mkdirSync(out, { recursive: true });
    writeFileSync(path, JSON.stringify({ completed: false, q3Accepted: false, status: 'preflight pending' }, null, 2));
    await main();
  } catch (error) {
    let result = {}; try { result = JSON.parse(readFileSync(path, 'utf8')); } catch {}
    Object.assign(result, { completed: false, q3Accepted: false, status: 'preflight or artifact failure',
      exception: error.stack ?? String(error), finished: new Date().toISOString() });
    try { writeFileSync(path, JSON.stringify(result, null, 2)); } catch (e) { console.error(e); }
    console.error(result.exception); process.exitCode = 1;
  }
}
