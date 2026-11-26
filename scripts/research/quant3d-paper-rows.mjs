// Q3d paper campaign runner: KR96 rows eps4 0.0123 and 0.0265 plus the
// eps4-definition sensitivity arm. Protocol: scripts/research/quant3d-paper-rows.md.
// Default: CPU model self-test and plan only. --preflight: hardware adapter,
// 9/9 slabbed-driver equivalence and a VRAM smoke test of the largest arm.
// --run: equivalence, then every registered arm (or --arms a,b). Adapted from the
// 2026-11-25 Option B cloud runner; no shader, coefficient or estimator change.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { closeBrowser } from '../browser-cleanup.mjs';
import { installQuant3TipDriver } from '../fixtures/quant3d-tip-driver-slabbed.mjs';
import { localTip } from '../fixtures/quant3d-tip-analysis.mjs';
import { fixedTerminalSchedule, terminalOperatingState, terminalReferenceAssessment } from '../fixtures/quant3d-tip-protocol.mjs';
import { IVANTSOV_PECLET } from './quant3d-width-ladder-model.mjs';
import { ARMS, KR96, RULES, W28, contract, selfTest } from './quant3d-paper-rows-model.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const SOURCE_PATHS = ['src/sim3d.ts', 'src/shaders3d.ts', 'src/shaders3d-quant.ts', 'scripts/browser-cleanup.mjs',
  'scripts/fixtures/quant3d-tip-driver.mjs', 'scripts/fixtures/quant3d-tip-driver-slabbed.mjs',
  'scripts/fixtures/quant3d-tip-analysis.mjs', 'scripts/fixtures/rect3d-specialize.mjs', 'scripts/fixtures/quant3d-tip-protocol.mjs',
  'scripts/research/quant3d-paper-rows.mjs', 'scripts/research/quant3d-paper-rows-model.mjs', 'scripts/research/quant3d-paper-rows.md',
  'scripts/research/quant3d-width-ladder-model.mjs'];
const hashes = () => Object.fromEntries(SOURCE_PATHS.map(p => [p, sha(readFileSync(resolve(ROOT, p)))]));

function boundary(samples, state, arm, initialTip) {
  if (!state?.ready || !(state.velocity > 0)) return { assessed: false, boundaryClear: false };
  const L = arm.D / state.velocity, last = samples.at(-1);
  const travel = (last.tip - last.tipError - Math.max(initialTip, arm.radius)) / L;
  return { assessed: true, diffusionLength: L, aheadDiffusionLengths: state.aheadDiffusionLengths,
    sideDiffusionLengths: state.sideDiffusionLengths, travelDiffusionLengths: travel,
    boundaryClear: state.aheadDiffusionLengths >= RULES.minimumBoundaryDiffusionLengths
      && state.sideDiffusionLengths >= RULES.minimumBoundaryDiffusionLengths,
    travelEnough: travel >= RULES.minimumTravelDiffusionLengths };
}

export function postprocess(arm, data, plan, observed, initialTip, refs) {
  const options = { D: arm.D, d0: arm.d0, dims: arm.dims, dx: arm.dx, relativeTarget: RULES.referenceBudget };
  const term = terminalOperatingState(data.samples, plan, options, observed), s = term.state;
  data.terminal = { complete: term.complete, reason: term.reason ?? null, state: s };
  if (s.ready) {
    data.derived = { Vd0OverD: s.velocity * arm.d0 / arm.D, sigma: s.sigmaStar, P: s.P, rhoOverD0: s.rho / arm.d0,
      rhoOverRhoIv: s.rho * s.velocity / (2 * arm.D * IVANTSOV_PECLET) };
    data.assessmentPF = terminalReferenceAssessment(term, refs.pf, RULES.referenceBudget);
    data.assessmentSolv = terminalReferenceAssessment(term, refs.solv, RULES.referenceBudget);
    data.boundary = boundary(data.samples, s, arm, initialTip);
  }
  data.valid = !!(term.complete && s.ready && s.stationary && s.resolved && data.boundary?.boundaryClear && data.boundary?.travelEnough);
  return data;
}

// Offline check of the post-processing on archived checkpoints (no GPU):
// node quant3d-paper-rows.mjs --offline=<dir> --offline-arm=<name> --row=<eps4>
function offline(dir, name, row) {
  const files = readdirSync(dir).filter(f => f.startsWith(name + '-') && /-\d{9}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('no checkpoints for ' + name);
  const docs = files.map(f => JSON.parse(readFileSync(resolve(dir, f), 'utf8')));
  const arm = docs[0].config, plan = fixedTerminalSchedule({ dt: arm.dt, physicalTimeScale: arm.physicalTimeScale });
  const data = { config: arm, samples: docs.map(d => ({ time: d.time, steps: d.steps, ...localTip(d.points, arm.dx) })) };
  const refs = { pf: KR96[row].pf, solv: KR96[row].solv };
  postprocess(arm, data, plan, docs.at(-1).steps, arm.radius, refs);
  return { files: files.length, terminalSteps: plan.terminalSteps, lastSteps: docs.at(-1).steps, valid: data.valid, derived: data.derived,
    boundary: data.boundary, pf: data.assessmentPF, solv: data.assessmentSolv, complete: data.terminal.complete, reason: data.terminal.reason };
}

function launchOptions() {
  const extra = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
  const ignore = process.env.Q3_IGNORE_DEFAULT_ARGS ? JSON.parse(process.env.Q3_IGNORE_DEFAULT_ARGS) : null;
  if (!Array.isArray(extra) || extra.some(v => typeof v !== 'string')) throw new Error('CHROME_ARGS must be a JSON string array');
  return { executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: process.env.Q3_HEADLESS !== '0', protocolTimeout: 7_200_000,
    ...(ignore ? { ignoreDefaultArgs: ignore } : {}), args: ['--enable-unsafe-webgpu', '--enable-gpu', ...extra] };
}

function summarize(result) {
  const by = Object.fromEntries(result.arms.map(a => [a.config.name, a]));
  const rel = (a, b, k) => (a?.terminal?.state?.ready && b?.terminal?.state?.ready) ? Math.abs(a.terminal.state[k] / b.terminal.state[k] - 1) : null;
  const controls = ['e265width', 'e265dx'].map(n => ({ arm: n,
    changes: Object.fromEntries(['P', 'sigmaStar', 'Vd0OverD'].map(k => [k, rel(by[n], by.e265base, k)])) }));
  const converged265 = controls.every(c => Object.values(c.changes).every(v => v != null && v <= RULES.controlChange));
  const clean = result.errors.length === 0 && result.deviceErrors.length === 0 && result.sourceStable === true;
  const row = names => ({ arms: names, valid: names.every(n => by[n]?.valid),
    acceptedPF: names.every(n => by[n]?.assessmentPF?.accepted), acceptedSolvability: names.every(n => by[n]?.assessmentSolv?.accepted) });
  const cal = by.e171cal?.terminal?.state;
  return { executionClean: clean,
    row0265: { ...row(['e265base', 'e265width', 'e265dx']), controls, controlsConverged: converged265 },
    row0123: row(['e123base']),
    definitionSensitivity: cal?.ready ? { calibrated: { P: cal.P, sigmaStar: cal.sigmaStar, Vd0OverD: cal.Vd0OverD },
      raw: W28, change: Object.fromEntries(['P', 'sigmaStar', 'Vd0OverD'].map(k => [k, cal[k] / W28[k] - 1])),
      predicted: result.contract.predictions.e171cal } : null };
}

async function main() {
  const args = process.argv.slice(2), pos = args.filter(a => !a.startsWith('--'));
  const opt = k => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  if (opt('offline')) { console.log('Q3D-OFFLINE', JSON.stringify(offline(opt('offline'), opt('offline-arm'), Number(opt('row'))))); return; }
  const OUT = resolve(pos[0] ?? 'verify-out/q3d-paper-rows'), PORT = pos[1] ?? '5199';
  const preflight = args.includes('--preflight'), run = args.includes('--run');
  const only = args.find(a => a.startsWith('--arms='))?.slice(7).split(',');
  mkdirSync(resolve(OUT, 'samples'), { recursive: true }); mkdirSync(resolve(OUT, 'arms'), { recursive: true });
  const result = { purpose: 'Q3d paper rows: KR96 eps4 0.0123/0.0265 and eps4-definition sensitivity', started: new Date().toISOString(),
    contract: contract(), modelSelfTest: selfTest(), arms: [], errors: [], deviceErrors: [], completed: false, status: 'self-test' };
  const resultPath = resolve(OUT, preflight ? 'preflight-result.json' : 'paper-rows-result.json');
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2));
  save();
  console.log('Q3D-PLAN', JSON.stringify(result.contract.arms.map(a => ({ name: a.name, dims: a.dims, steps: a.terminalSteps,
    GiB: +a.textureGiB.toFixed(2), estMin: +a.estimatedL40SMinutes.toFixed(0) }))));
  if (!run && !preflight) { result.status = 'CPU model self-test complete; GPU not run'; result.completed = true; save(); return; }

  const arms = only ? ARMS.filter(a => only.includes(a.name)) : ARMS;
  if (only && arms.length !== only.length) throw new Error('unknown arm in --arms');
  let browser = null, page = null, exception = null;
  try {
    result.source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    result.sourceHashes = hashes(); save();
    browser = await puppeteer.launch(launchOptions());
    page = await browser.newPage();
    page.on('pageerror', e => result.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' || /binding size/.test(m.text())) result.errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.__solidify, { timeout: 60000 });
    await page.evaluate(installQuant3TipDriver, { latticeKinetics: true });
    result.adapter = await page.evaluate(() => {
      const ad = window.__solidifyTipAdapter;
      return ad?.info ? { vendor: ad.info.vendor, architecture: ad.info.architecture, device: ad.info.device,
        isFallbackAdapter: !!(ad.info.isFallbackAdapter ?? ad.isFallbackAdapter),
        maxBufferSizeGiB: +(ad.limits.maxBufferSize / 2 ** 30).toFixed(2), maxTextureDimension3D: ad.limits.maxTextureDimension3D } : null;
    });
    if (!result.adapter || result.adapter.isFallbackAdapter) throw new Error('No hardware adapter: ' + JSON.stringify(result.adapter));
    result.equivalence = await page.evaluate(c => window.__q3tip.equivalence(c), ARMS[0]);
    const pairs = result.equivalence.checkpoints.flatMap(p => p.comparisons);
    if (!(pairs.length === 9 && pairs.every(c => c.mismatches === 0 && c.productionHash === c.specializedHash)))
      throw new Error('slabbed driver differs from native Sim3D on a cube');
    console.log('Q3D-EQUIVALENCE-OK', JSON.stringify({ pairs: pairs.length, adapter: result.adapter }));
    save();
    if (preflight) {
      const big = [...arms].sort((a, b) => b.dims.reduce((x, y) => x * y) - a.dims.reduce((x, y) => x * y))[0];
      await page.evaluate(c => window.__q3tip.stage(c), big);
      const adv = await page.evaluate(() => window.__q3tip.advance(2));
      const smp = await page.evaluate(() => window.__q3tip.sample());
      await page.evaluate(() => window.__q3tip.destroy());
      result.vramSmoke = { arm: big.name, dims: big.dims, seconds: adv.seconds, points: smp.points.length };
      console.log('Q3D-VRAM-SMOKE-OK', JSON.stringify(result.vramSmoke));
    } else for (const arm of arms) {
      const plan = fixedTerminalSchedule({ dt: arm.dt, physicalTimeScale: arm.physicalTimeScale });
      const refs = result.contract.arms.find(a => a.name === arm.name).references;
      console.log('ARM_START', arm.name, JSON.stringify({ epsilon4: arm.epsilon4, lambda: arm.lambda, dx: arm.dx, dims: arm.dims, terminalSteps: plan.terminalSteps }));
      const data = { config: arm, setup: await page.evaluate(c => window.__q3tip.stage(c), arm), samples: [], unresolved: [], raw: [] };
      result.arms.push(data); save();
      const zero = await page.evaluate(() => window.__q3tip.sample());
      const initialTip = Math.max(...zero.points.map(p => p.z));
      let observed = 0; const t0 = Date.now();
      for (const cp of plan.checkpoints) {
        await page.evaluate(n => window.__q3tip.advance(n), cp.steps - observed);
        const raw = await page.evaluate(() => window.__q3tip.sample());
        observed = raw.steps;
        if (observed !== cp.steps) throw new Error('GPU fixture missed a declared observation substep');
        const text = JSON.stringify({ source: 'direct GPU state snapshot; Q3d paper rows', config: arm, ...raw });
        const path = `samples/${arm.name}-${String(raw.steps).padStart(9, '0')}.json`;
        writeFileSync(resolve(OUT, path), text); data.raw.push({ path, sha256: sha(text) });
        try { data.samples.push({ time: raw.time, steps: raw.steps, ...localTip(raw.points, arm.dx) }); }
        catch (e) { data.unresolved.push({ steps: raw.steps, reason: String(e) }); }
        if (data.raw.length === 1 || data.raw.length % 10 === 0 || observed === plan.terminalSteps)
          console.log('PROGRESS', JSON.stringify({ arm: arm.name, steps: observed, of: plan.terminalSteps, min: +((Date.now() - t0) / 60000).toFixed(2) }));
      }
      postprocess(arm, data, plan, observed, initialTip, refs);
      data.terminal.wallMinutes = +((Date.now() - t0) / 60000).toFixed(2);
      await page.evaluate(() => window.__q3tip.destroy());
      save();
      execFileSync('tar', ['-czf', resolve(OUT, `arms/${arm.name}-samples.tar.gz`), '-C', resolve(OUT, 'samples'),
        ...data.raw.map(r => r.path.replace(/^samples\//, ''))]);
      console.log('ARM_DONE', arm.name, JSON.stringify({ valid: data.valid, derived: data.derived ?? null, wallMin: data.terminal.wallMinutes,
        boundary: data.boundary ?? null, pf: data.assessmentPF ?? null, solv: data.assessmentSolv ?? null }));
    }
  } catch (error) { exception = error; result.exception = error.stack ?? String(error); }
  finally {
    if (page) {
      try { await page.evaluate(async () => { await window.__q3tip?.destroy(); }); } catch (e) { result.errors.push(`fixture cleanup failed: ${e.message}`); }
      try { result.deviceErrors = await page.evaluate(() => { if (!Array.isArray(window.__solidifyTipDeviceErrors)) throw new Error('GPU error ledger is unavailable'); return [...window.__solidifyTipDeviceErrors]; }); }
      catch (e) { result.errors.push(`GPU error ledger read failed: ${e.message}`); }
      try { await page.evaluate(() => { window.__solidifyTipDevice?.destroy(); }); } catch (e) { result.errors.push(`device cleanup failed: ${e.message}`); }
    }
    if (browser) { try { await closeBrowser(browser); } catch (e) { result.errors.push(`browser cleanup failed: ${e.message}`); } }
    if (result.sourceHashes) {
      try { result.sourceStable = JSON.stringify(hashes()) === JSON.stringify(result.sourceHashes); } catch { result.sourceStable = false; }
      if (!result.sourceStable) result.errors.push('campaign source changed during execution');
    }
    if (!preflight) result.summary = summarize(result);
    result.completed = !exception && result.errors.length === 0 && result.deviceErrors.length === 0 && result.sourceStable === true
      && (preflight || result.arms.length === arms.length);
    result.status = exception ? 'refused or failed' : result.completed ? (preflight ? 'preflight passed' : 'campaign complete') : 'execution evidence failed';
    result.finished = new Date().toISOString(); save();
    console.log(preflight ? 'Q3D-PREFLIGHT' : 'Q3D-SUMMARY', JSON.stringify(preflight ? { status: result.status, vramSmoke: result.vramSmoke ?? null } : result.summary));
    if (!result.completed) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
}
