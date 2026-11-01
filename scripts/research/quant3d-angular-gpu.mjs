import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {plane3dSpecialize} from '../fixtures/plane3d-specialize.mjs';
import {angularKineticPhase, kineticTauProbe} from './quant3d-angular-shader.mjs';
import {installAngularGpuDriver} from './quant3d-angular-gpu-driver.mjs';
import {installObliqueGpuDriver} from './quant3d-oblique-gpu-driver.mjs';
import {closeBrowser} from '../browser-cleanup.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NORMALS = [[1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 1, 0], [2, 1, 1], [3, 2, 1]];
const sha = b => createHash('sha256').update(b).digest('hex');
const finiteVector = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const maxError = (a, b) => {
  assert.ok(finiteVector(a, b.length));
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
};

export async function angularGpuCpuControls() {
  const built = await build({entryPoints: [resolve(ROOT, 'src/shaders3d.ts')], bundle: true, write: false, platform: 'node', format: 'esm'});
  const M = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  const principal = M.phi3dWgsl(false, true), angular = angularKineticPhase(principal);
  const sources = [angular.code, kineticTauProbe(angular.code).code, kineticTauProbe(principal, false).code];
  let geometryRoundtrips = 0;
  for (const normal of NORMALS) for (const boundary of ['periodic', 'clamp']) for (const source of sources) {
    assert.equal(plane3dSpecialize(source, [128, 4, 4], normal, {count: 257, boundary}).geometryOnlyRoundtrip, true);
    geometryRoundtrips++;
  }
  assert.throws(() => angularKineticPhase(M.phi3dWgsl(false)));
  assert.throws(() => angularKineticPhase(M.phi3dWgsl(true, true)));
  assert.throws(() => angularKineticPhase(principal + principal));
  assert.throws(() => kineticTauProbe('unreviewed shader'));
  return {localTauOnlyRoundtrip: true, captureOnlyRoundtrips: 2, geometryRoundtrips,
    invalidSourceRefused: true, shaderHashes: sources.map(sha), productionPrincipalSha256: sha(principal)};
}

async function main(out) {
  const args = process.argv.slice(2), pos = args.filter(a => !a.startsWith('--'));
  for (const a of args.filter(a => a.startsWith('--'))) if (!['--run', '--self-test'].includes(a) && !a.startsWith('--fixtures=')) throw new Error('unknown option ' + a);
  assert.ok(pos.length <= 2, 'usage: quant3d-angular-gpu.mjs OUT PORT --fixtures=PATH [--run]');
  const cpu = await angularGpuCpuControls(), run = args.includes('--run') && !args.includes('--self-test');
  writeFileSync(resolve(out, 'cpu-controls.json'), JSON.stringify(cpu, null, 2));
  if (!run) {
    writeFileSync(resolve(out, 'angular-result.json'), JSON.stringify({completed: true, cpuOnly: true, accepted: false, q3Accepted: false, cpu}, null, 2));
    console.log('Q3-ANGULAR-CPU', JSON.stringify(cpu)); return;
  }
  const fixtureOption = args.find(a => a.startsWith('--fixtures=')); assert.ok(fixtureOption, 'explicit independent CPU fixture required');
  const inputPath = resolve(fixtureOption.slice(11)), inputBytes = readFileSync(inputPath), input = JSON.parse(inputBytes);
  assert.equal(input.format, 'solidify-oblique-angular-fp32-input-fixtures-v1'); assert.equal(input.period, 257);
  assert.equal(input.wgslIntermediateRoundingEmulated, false);
  assert.deepEqual(input.fixtures.map(f => f.geometry.normal), NORMALS);
  for (const [key, value] of Object.entries({dx: .8, dt: .004, delta: .0171, lambda: 4, dTherm: 2.5068, tau: 1, epsBar: 1})) assert.equal(input.uniforms[key], Math.fround(value));
  assert.ok(finiteVector(input.psiStored, 257) && input.psiStored.every(v => v === Math.fround(v) && v >= 0 && v <= 1));
  assert.ok(finiteVector(input.temperatureStored, 257) && input.temperatureStored.every(v => v === Math.fround(v) && v >= -1 && v <= 2));
  for (const f of input.fixtures) {
    assert.equal(f.geometry.sub, 1); assert.equal(f.geometry.physicalDx, input.uniforms.dx);
    for (const key of ['tau', 'eulerPsiReal', 'eulerTemperatureReal']) assert.ok(finiteVector(f.controls.Angular[key], 257));
    for (const key of ['w', 'gammaFD']) assert.ok(finiteVector(f.fields[key], 257));
    assert.ok(f.fields.correctionQ.length === 257 && f.fields.correctionQ.every(v => finiteVector(v, 3)));
  }
  const paths = ['src/sim3d.ts', 'src/shaders3d.ts', 'src/shaders3d-quant.ts', 'scripts/browser-cleanup.mjs',
    'scripts/fixtures/rect3d-specialize.mjs', 'scripts/fixtures/plane3d-specialize.mjs',
    'scripts/research/quant3d-oblique-gpu-driver.mjs', 'scripts/research/quant3d-angular-shader.mjs',
    'scripts/research/quant3d-angular-gpu-driver.mjs', 'scripts/research/quant3d-angular-gpu.mjs', 'scripts/research/quant3d-angular-gpu.md'];
  for (const [p, checksum] of Object.entries(input.sourceHashes)) {
    const relative = p.includes('/') ? p : 'scripts/research/' + p;
    assert.equal(sha(readFileSync(resolve(ROOT, relative))), checksum, 'CPU fixture source changed'); paths.push(relative);
  }
  const uniquePaths = [...new Set(paths)];
  const hashes = () => Object.fromEntries(uniquePaths.map(p => [p, sha(readFileSync(resolve(ROOT, p)))]));
  const result = {purpose: 'research-only angular local-tau capture and actual response; no adoption or kinetic/Q3 acceptance',
    source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(), started: new Date().toISOString(),
    completed: false, accepted: false, q3Accepted: false, sourceStable: false, inputsStable: false, deviceErrorLedgerRead: false,
    sourceHashes: hashes(), inputSha256: sha(inputBytes), cpu, cases: [], errors: [],
    contract: {normals: NORMALS, responseAbsoluteTolerance: 2e-6, tauAbsoluteTolerance: 2e-6, gammaAbsoluteTolerance: 2e-7,
      omissionMinimumTauError: 2e-5, storedInputExact: true, diagnosticCaptureDoesNotAdvance: true}};
  mkdirSync(resolve(out, 'raw'), {recursive: true}); mkdirSync(resolve(out, 'exact-source'), {recursive: true});
  for (const p of uniquePaths) {mkdirSync(resolve(out, 'exact-source', p, '..'), {recursive: true}); writeFileSync(resolve(out, 'exact-source', p), readFileSync(resolve(ROOT, p)));}
  writeFileSync(resolve(out, 'cpu-input.json'), inputBytes);
  const save = () => writeFileSync(resolve(out, 'angular-result.json'), JSON.stringify(result, null, 2));
  const fail = (kind, e) => result.errors.push({kind, message: e?.message ?? String(e)});
  let browser, page, warm; save();
  try {
    const extra = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
    assert.ok(Array.isArray(extra) && extra.every(a => typeof a === 'string'));
    browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      protocolTimeout: 3_600_000, args: ['--enable-unsafe-webgpu', '--enable-gpu', ...extra]});
    warm = await browser.newPage(); await warm.setRequestInterception(true);
    warm.once('request', r => r.respond({status: 200, contentType: 'text/html', body: '<!doctype html><link rel="icon" href="data:,"><title>Angular admission</title>'}));
    await warm.goto(`http://localhost:${pos[1] ?? '5209'}/__angular_admission__`, {waitUntil: 'domcontentloaded'}); await warm.setRequestInterception(false);
    await warm.waitForFunction(async () => {try {const a = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
      if (!a || a.info.isFallbackAdapter !== false) return false; window.__angularWarm = await a.requestDevice(); return true;} catch {return false;}}, {timeout: 60000, polling: 500});
    page = await browser.newPage(); page.on('pageerror', e => fail('page', e)); page.on('console', m => {if (m.type() === 'error') fail('console', m.text());});
    await page.goto(`http://localhost:${pos[1] ?? '5209'}/app/`, {waitUntil: 'networkidle0'}); await page.waitForFunction(() => !!window.__solidify, {timeout: 60000});
    await page.evaluate(installObliqueGpuDriver); await page.evaluate(installAngularGpuDriver);
    result.metadata = await page.evaluate(async () => ({...await window.__q3oblique.metadata(), angular: await window.__q3angular.metadata()}));
    assert.equal(result.metadata.hardware.isFallbackAdapter, false); assert.deepEqual(result.metadata.angular.shaderHashes, cpu.shaderHashes);
    assert.equal(result.metadata.shaderHashes[3], cpu.productionPrincipalSha256);
    assert.equal(result.metadata.angular.localTauOnlyRoundtrip, true); assert.ok(result.metadata.angular.captureOnlyRoundtrips.every(Boolean));
    const packed = new Float32Array(257 * 2); for (let i = 0; i < 257; i++) {packed[2 * i] = input.psiStored[i]; packed[2 * i + 1] = input.temperatureStored[i];}
    for (const [i, fixture] of input.fixtures.entries()) {
      const data = await page.evaluate((v, f) => window.__q3angular.response(v, f), input, fixture);
      const raw = Buffer.from(JSON.stringify(data)), compressed = gzipSync(raw), path = `raw/case-${i}.json.gz`; writeFileSync(resolve(out, path), compressed);
      const row = {normal: fixture.geometry.normal, raw: {path, sha256: sha(compressed), uncompressedSha256: sha(raw)}, passed: false}; result.cases.push(row); save();
      assert.equal(data.probes.length, 2);
      for (const p of data.probes) {
        assert.equal(p.inputSha256, sha(Buffer.from(packed.buffer))); assert.equal(p.clock.steps, 0); assert.equal(p.stateUnchanged, true);
        assert.equal(p.clock.diagnosticOnly, true); assert.equal(p.clock.time, 0); assert.equal(p.clock.declaredTime, 0);
        assert.equal(p.clock.uniformDt, input.uniforms.dt); assert.ok(p.tau.every(v => Number.isFinite(v) && v > 0));
        assert.ok(p.specialization.every(s => s.geometryOnlyRoundtrip && s.geometry.count === 257 && s.geometry.boundary === 'periodic'));
        for (const s of p.specialization) assert.deepEqual(s.geometry.normal, fixture.geometry.normal);
      }
      const reference = fixture.controls.Angular, probe = data.probes[0], omission = data.probes[1], response = data.response;
      assert.equal(probe.label, 'angular'); assert.equal(omission.label, 'principal-omission');
      row.tauError = maxError(probe.tau, reference.tau); row.gammaError = maxError(probe.gamma, fixture.fields.gammaFD);
      row.omissionTauError = maxError(omission.tau, reference.tau);
      row.phaseError = maxError(response.psi, reference.eulerPsiReal); row.temperatureError = maxError(response.temperature, reference.eulerTemperatureReal);
      const expectedFlux = []; for (let j = 0; j < 257; j++) expectedFlux.push(...fixture.fields.correctionQ[j].map(v => v / 2), fixture.fields.w[j]);
      row.fluxError = maxError(response.flux, expectedFlux);
      assert.equal(response.inputSha256, sha(Buffer.from(packed.buffer))); assert.ok(response.phaseChanged > 0);
      assert.equal(response.clock.steps, 1); assert.equal(response.clock.time, input.uniforms.dt);
      assert.equal(response.clock.uniformDt, input.uniforms.dt); assert.equal(response.clock.declaredTime, input.uniforms.dt);
      assert.ok(response.specialization.every(s => s.geometryOnlyRoundtrip));
      for (const s of response.specialization) assert.deepEqual(s.geometry, {dims: [128, 4, 4], normal: fixture.geometry.normal, count: 257, boundary: 'periodic'});
      row.omissionRejected = i < 3 ? null : row.omissionTauError > result.contract.omissionMinimumTauError;
      row.passed = row.tauError <= 2e-6 && row.gammaError <= 2e-7 && Math.max(row.phaseError, row.temperatureError, row.fluxError) <= 2e-6
        && (i < 3 || row.omissionRejected);
      save(); assert.ok(row.passed, 'angular capture or response comparison failed'); console.log('Q3-ANGULAR-CASE', JSON.stringify(row));
    }
  } catch (e) {result.exception = e.stack ?? String(e);}
  finally {
    if (page) {
      try {await page.evaluate(async () => {if (!window.__q3oblique) throw new Error('fixture missing'); await window.__q3oblique.dispose();});} catch (e) {fail('fixture cleanup', e);}
      try {const errors = await page.evaluate(() => window.__q3oblique?.errors()); if (!Array.isArray(errors)) throw new Error('GPU ledger missing'); result.errors.push(...errors); result.deviceErrorLedgerRead = true;} catch (e) {fail('GPU ledger', e);}
      try {await page.evaluate(() => {const d = window.__solidify?.sim()?.device; if (!d) throw new Error('application device missing'); d.destroy();});} catch (e) {fail('application cleanup', e);}
    }
    if (warm) try {await warm.evaluate(() => {if (!window.__angularWarm) throw new Error('warm device missing'); window.__angularWarm.destroy();});} catch (e) {fail('warm cleanup', e);}
    if (browser) try {await closeBrowser(browser);} catch (e) {fail('browser cleanup', e);}
    try {result.finalHashes = hashes(); result.sourceStable = JSON.stringify(result.finalHashes) === JSON.stringify(result.sourceHashes);} catch (e) {fail('source', e);}
    try {result.inputsStable = sha(readFileSync(inputPath)) === result.inputSha256;} catch (e) {fail('input', e);}
    result.completed = !result.exception && !result.errors.length && result.sourceStable && result.inputsStable && result.deviceErrorLedgerRead
      && result.cases.length === 6 && result.cases.every(c => c.passed);
    result.finished = new Date().toISOString(); result.status = result.completed ? 'research angular capture and Euler controls complete; scientific acceptance not evaluated' : 'research angular controls refused'; save();
  }
  console.log('Q3-ANGULAR-FINAL', JSON.stringify({completed: result.completed, errors: result.errors, exception: result.exception})); process.exitCode = result.completed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pos = process.argv.slice(2).filter(a => !a.startsWith('--')), out = resolve(pos[0] ?? 'verify-out/q3-angular-gpu'); mkdirSync(out, {recursive: true});
  writeFileSync(resolve(out, 'angular-result.json'), JSON.stringify({completed: false, accepted: false, q3Accepted: false, status: 'preflight pending'}));
  main(out).catch(e => {writeFileSync(resolve(out, 'angular-result.json'), JSON.stringify({completed: false, accepted: false, q3Accepted: false, exception: e.stack ?? String(e)}, null, 2)); console.error(e); process.exitCode = 1;});
}
