// WGSL reference capture for the fp32/fp64 port faithfulness gate (short GPU job).
// Runs the UNMODIFIED tip fixture (installQuant3TipDriver, latticeKinetics on)
// in headless Chrome. The only addition is a page-side hook that records the
// textures the fixture creates on its own device, so its state/flux/aux
// textures can be copied out after advance(); no shader, uniform or pass is
// changed. Writes raw little-endian Float32 volumes in texture order (z, y, x,
// channel) plus the fixture's own sample() JSON at each stop.
//   node scripts/research/quant3d-fp64-port-capture.mjs OUT_DIR [PORT=5297]
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { closeBrowser } from '../browser-cleanup.mjs';
import { installQuant3TipDriver } from '../fixtures/quant3d-tip-driver.mjs';
import { LADDER_ARMS } from './quant3d-width-ladder-model.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [outArg, portArg] = process.argv.slice(2);
const OUT = resolve(outArg ?? 'verify-out/fp64-port-capture'), PORT = portArg ?? '5297';
const STOPS = [0, 1, 17, 64, 256, 1024, 4096];
const n = 32, eqDx = LADDER_ARMS[0].dx;
const FIXTURES = [
  // the driver's own equivalence() configuration (w50 physics, centred r=5 seed)
  { name: 'eq32', stops: STOPS, config: { ...LADDER_ARMS[0], dims: [n, n, n], radius: 5, center: [n * eqDx / 2, n * eqDx / 2, n * eqDx / 2] } },
  // base (w40-anchor) physics, corner seed, rectangular box (tests the rect specialisation)
  { name: 'corner', stops: STOPS, config: { ...LADDER_ARMS[2], dims: [24, 28, 36] } },
  // base physics, corner seed, longer horizon in a larger box (difference growth once the tip develops)
  { name: 'corner-long', stops: [0, 1, 1024, 4096, 8192, 16384], config: { ...LADDER_ARMS[2], dims: [40, 40, 64] } },
];
// Modules the page imports from Vite. The driver itself is serialised from this
// node process's local copy by page.evaluate, so it is local by construction.
const SERVED = ['src/shaders3d.ts', 'src/shaders3d-quant.ts', 'src/sim3d.ts',
  'scripts/fixtures/rect3d-specialize.mjs', 'scripts/fixtures/quant3d-tip-analysis.mjs'];
const sha = b => createHash('sha256').update(b).digest('hex');

mkdirSync(OUT, { recursive: true });
const meta = { started: new Date().toISOString(), stops: STOPS, fixtures: [], errors: [] };
const save = () => writeFileSync(resolve(OUT, 'capture.json'), JSON.stringify(meta, null, 1));
let browser = null, page = null;
const t0 = Date.now();
try {
  meta.source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  meta.dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).trim();
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, protocolTimeout: 120_000, args: ['--enable-unsafe-webgpu', '--enable-gpu'] });
  meta.browser = await browser.version();
  page = await browser.newPage();
  page.on('pageerror', e => meta.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') meta.errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/app/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__solidify);
  // The served modules must be this worktree's files byte for byte.
  meta.served = {};
  for (const path of SERVED) {
    const text = await page.evaluate(async p => (await import(`/${p}?raw`)).default, path);
    const local = readFileSync(resolve(ROOT, path), 'utf8');
    meta.served[path] = { sameAsWorktree: text === local, sha256: sha(local) };
    if (text !== local) throw new Error(`served ${path} differs from ${ROOT}`);
  }
  await page.evaluate(() => {
    window.__capTex = [];
    const original = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
      const device = await original.call(this, descriptor);
      const create = device.createTexture.bind(device);
      device.createTexture = d => { const t = create(d); window.__capTex.push({ t, format: d.format }); return t; };
      window.__capDevice = device;
      return device;
    };
    window.__capRead = async (which, dims, bpp) => {
      const device = window.__capDevice, list = window.__capTex;
      const rg = list.filter(e => e.format === 'rg32float').map(e => e.t);
      const rgba = list.filter(e => e.format === 'rgba32float').map(e => e.t);
      const texture = { state0: rg[0], state1: rg[1], aux: rg[2], flux: rgba[0] }[which];
      const row = Math.ceil(dims[0] * bpp / 256) * 256;
      const staging = device.createBuffer({ size: row * dims[1] * dims[2], usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: row, rowsPerImage: dims[1] }, dims);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(staging.getMappedRange()), out = new Uint8Array(dims[0] * dims[1] * dims[2] * bpp);
      for (let i = 0; i < dims[1] * dims[2]; i++) out.set(padded.subarray(i * row, i * row + dims[0] * bpp), i * dims[0] * bpp);
      staging.unmap(); staging.destroy();
      let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(s);
    };
  });
  await page.evaluate(installQuant3TipDriver, { latticeKinetics: true });
  meta.adapter = await page.evaluate(() => { const a = window.__solidifyTipAdapter?.info;
    return a ? { vendor: a.vendor, architecture: a.architecture, device: a.device, description: a.description } : null; });
  // The harness' own rect-vs-native gate, unchanged.
  const eq = await page.evaluate(c => window.__q3tip.equivalence(c), LADDER_ARMS[0]);
  meta.nativeEquivalence = eq.checkpoints.map(p => ({ target: p.target, mismatches: p.comparisons.map(c => [c.field, c.mismatches]) }));
  for (const fixture of FIXTURES) {
    const dir = resolve(OUT, fixture.name); mkdirSync(dir, { recursive: true });
    await page.evaluate(() => { window.__capTex = []; });
    const setup = await page.evaluate(c => window.__q3tip.stage(c), fixture.config);
    const record = { name: fixture.name, config: fixture.config, setup, stopList: fixture.stops, stops: [] };
    meta.fixtures.push(record);
    let observed = 0;
    for (const stop of fixture.stops) {
      let adv = null;
      if (stop > observed) adv = await page.evaluate(k => window.__q3tip.advance(k), stop - observed);
      observed = stop;
      const d = fixture.config.dims, tag = String(stop).padStart(9, '0');
      const st = await page.evaluate((w, dm) => window.__capRead(w, dm, 8), `state${stop % 2}`, d);
      writeFileSync(resolve(dir, `state-${tag}.f32`), Buffer.from(st, 'base64'));
      if (stop > 0) {
        writeFileSync(resolve(dir, `flux-${tag}.f32`), Buffer.from(await page.evaluate((dm) => window.__capRead('flux', dm, 16), d), 'base64'));
        writeFileSync(resolve(dir, `aux-${tag}.f32`), Buffer.from(await page.evaluate((dm) => window.__capRead('aux', dm, 8), d), 'base64'));
      }
      const sample = await page.evaluate(() => window.__q3tip.sample());
      writeFileSync(resolve(dir, `sample-${tag}.json`), JSON.stringify({ source: 'direct GPU state snapshot; fp64-port capture', config: fixture.config, ...sample }));
      record.stops.push({ stop, advance: adv, sampleSteps: sample.steps, sampleTime: sample.time, points: sample.points.length });
      save();
    }
  }
} catch (error) { meta.exception = error.stack ?? String(error); process.exitCode = 1; }
finally {
  if (page) {
    try { await page.evaluate(async () => { await window.__q3tip?.destroy(); }); } catch (e) { meta.errors.push(`cleanup: ${e.message}`); }
    try { meta.deviceErrors = await page.evaluate(() => [...(window.__solidifyTipDeviceErrors ?? [])]); } catch (e) { meta.errors.push(e.message); }
    try { await page.evaluate(() => { window.__solidifyTipDevice?.destroy(); }); } catch (e) { meta.errors.push(e.message); }
  }
  if (browser) { try { await closeBrowser(browser); } catch (e) { meta.errors.push(`browser cleanup: ${e.message}`); } }
  meta.seconds = (Date.now() - t0) / 1000; meta.finished = new Date().toISOString(); save();
  console.log('CAPTURE', JSON.stringify({ seconds: meta.seconds, errors: meta.errors.length, exception: meta.exception ?? null,
    nativeEquivalence: meta.nativeEquivalence, deviceErrors: meta.deviceErrors }));
}
