import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { closeBrowser } from "./browser-cleanup.mjs";

const OUT = resolve(process.argv[2] ?? "verify-out");
const PORT = process.argv[3] ?? "5199";
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-gpu"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.setDefaultTimeout(60_000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
async function block(name, f) {
  try { await f(); console.log(name, "OK"); }
  catch (e) { failed++; console.error(name, "FAIL", e.stack); }
}
async function boot(url = `http://localhost:${PORT}/app/`) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!window.__solidify);
}
function unzip(bytes) {
  const b = Buffer.from(bytes), entries = new Map(); let at = 0;
  while (b.readUInt32LE(at) === 0x04034b50) {
    const n = b.readUInt16LE(at + 26), extra = b.readUInt16LE(at + 28), size = b.readUInt32LE(at + 18);
    const name = b.subarray(at + 30, at + 30 + n).toString("utf8");
    entries.set(name, b.subarray(at + 30 + n + extra, at + 30 + n + extra + size));
    at += 30 + n + extra + size;
  }
  return entries;
}
async function archive(name) {
  const bytes = await page.evaluate(async () => Array.from(await window.__solidify.exportRun()));
  writeFileSync(resolve(OUT, name), Buffer.from(bytes));
  const entries = unzip(bytes), manifest = JSON.parse(entries.get("run.json").toString());
  const png = entries.get("micrograph.png");
  assert(png?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  const image = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const c = document.createElement("canvas"); c.width = bitmap.width; c.height = bitmap.height;
    const ctx = c.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
    const p = ctx.getImageData(0, 0, c.width, Math.max(1, c.height - 132)).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < p.length; i += 4 * 31) { lo = Math.min(lo, p[i], p[i+1], p[i+2]); hi = Math.max(hi, p[i], p[i+1], p[i+2]); }
    return { width: c.width, height: c.height, contrast: hi - lo };
  }, Array.from(png));
  assert(image.width > 100 && image.height > 100 && image.contrast > 15, JSON.stringify(image));
  writeFileSync(resolve(OUT, name.replace(".zip", ".png")), png);
  return { entries, manifest, image };
}
try {
  await boot();
  await block("SESSION-CALIBRATION", async () => {
    const first = await page.evaluate(() => {
      const S = window.__solidify;
      S.app.setRun(false); S.app.setMaterial("steel");
      const refused = !S.app.canCalibrate() && !!S.app.calibrationIssue();
      S.app.setCalibrated(true);
      return { refused, solver: S.sim().params.solver, reason: S.app.calibrationIssue() };
    });
    assert(first.refused && first.solver === 0, JSON.stringify(first));
    const supported = await page.evaluate(() => {
      const S = window.__solidify;
      const applied = S.composer.applyHash("#alloy=fe:C0.1");
      S.app.setCalibrated(true);
      const wasQuant = S.sim().params.solver === 1;
      S.sim().params.c0 = .35; // the composition slider's direct-write path
      S.tick(1);
      return { applied, wasQuant, solver: S.sim().params.solver, eps: S.sim().params.epsBar };
    });
    assert(supported.applied && supported.wasQuant && supported.solver === 0 && supported.eps < .1, JSON.stringify(supported));
    const badLink = await page.evaluate(() => {
      const s = { p: { ...window.__solidify.sim().params, solver: 1, epsBar: 1, tau: 1, dTherm: 20 }, m: "steel", u: .8, v: 0, seed: 42 };
      return location.origin + location.pathname + "#set=" + btoa(JSON.stringify(s)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    });
    await boot(badLink);
    const fallback = await page.evaluate(() => ({ ...window.__solidify.sim().params }));
    assert(fallback.solver === 0 && fallback.epsBar < .1 && fallback.tau < .1 && fallback.dTherm === 1, JSON.stringify(fallback));
    const goodLink = await page.evaluate(() => {
      const S = window.__solidify; S.app.setMaterial("al"); S.app.setCalibrated(true);
      return S.app.shareLink();
    });
    await boot(goodLink);
    assert.equal(await page.evaluate(() => window.__solidify.sim().params.solver), 1);
    const restored = await page.evaluate(() => {
      const S = window.__solidify; S.app.setCalibrated(false); return { ...S.sim().params };
    });
    assert(restored.epsBar < .1 && restored.tau < .1 && restored.dTherm === 1);
  });
  await block("SESSION-SHARE-GRID", async () => {
    const link = await page.evaluate(() => {
      const S = window.__solidify;
      S.app.setMaterial("al"); S.app.setGrid(512); S.app.setUmPerCell(1.7); S.setSeed(0x1234abcd);
      return S.app.shareLink();
    });
    await boot(link);
    const actual = await page.evaluate(() => ({ n: window.__solidify.sim().n, pitch: window.__solidify.sim().umPerCell, seed: window.__solidify.seed() }));
    assert.deepEqual(actual, { n: 512, pitch: 1.7, seed: 0x1234abcd });
  });
  await block("SESSION-LIVE-EXPORT", async () => {
    await page.evaluate(() => {
      const S = window.__solidify;
      S.app.startLab(); S.lab.setup = { ...S.lab.setup, atmosphere: "argon", program: "quench", moldWalls: false, superheat: .04 };
      S.lab.start();
    });
    await page.waitForFunction(() => window.__solidify.lab.exportState().recorded >= 4);
    await page.evaluate(() => window.__solidify.app.setRun(false));
    // Let the final submitted GPU readback arrive (panel cadence is 250 ms).
    await sleep(1000);
    const n0 = await page.evaluate(() => window.__solidify.lab.exportState().recorded);
    await sleep(600);
    assert.equal(await page.evaluate(() => window.__solidify.lab.exportState().recorded), n0);
    const sample = await page.evaluate(() => window.__solidify.lab.exportFigures()[0].columns.map(c => ({ key: c.key, values: c.values })));
    assert(sample.find(c => c.key === "t").values.length >= 4);
    assert(sample.find(c => c.key === "T").values.some(Number.isFinite));
    await page.screenshot({ path: resolve(OUT, "completion-live-pour.png") });
    await page.click("#foundryLiveCurve");
    await page.waitForSelector(".tmodal table");
    assert(await page.$(".tmodal table"));
    await page.keyboard.press("Escape");
    const { manifest } = await archive("completion-run-2d.zip");
    assert.equal(manifest.mode, "2d"); assert.equal(manifest.grid, 512);
    assert.equal(manifest.seed, 0x1234abcd); assert(manifest.lab.recorded >= 4);
    assert(manifest.datasets.some(d => d.title === "Live pour cooling curve"));
    const downloadDir = resolve(OUT, "completion-download"); mkdirSync(downloadDir, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
    await page.evaluate(() => { window.__solidify.ui.reveal("ADVANCED"); document.getElementById("exportRun").click(); });
    await page.waitForFunction(() => document.getElementById("exportRunStatus").textContent.includes("ready"));
    await sleep(500);
    const downloads = readdirSync(downloadDir).filter(f => f.endsWith(".zip"));
    assert(downloads.length > 0);
    assert(unzip(readFileSync(resolve(downloadDir, downloads.at(-1)))).has("micrograph.png"));
  });
  await block("SESSION-OPTIMIZER-PLOT", async () => {
    await page.evaluate(() => {
      const S = window.__solidify;
      S.lab.close(); S.opt.targetASTM = 4; S.opt.start(S.sim().n); S.app.setRun(true);
    });
    await page.waitForFunction(() => window.__solidify.opt.exportFigures()[0]?.columns[0].values.length >= 2, { timeout: 120_000 });
    const values = await page.evaluate(() => {
      window.__solidify.app.setRun(false);
      const f = window.__solidify.opt.exportFigures()[0];
      return { title: f.title, episodes: f.columns[0].values, errors: f.columns[1].values, grid: f.prov.grid };
    });
    assert(values.episodes.length >= 2 && values.errors.some(Number.isFinite), JSON.stringify(values));
    await page.waitForFunction(() => !window.__solidify.opt.finishing);
    const reset = await page.evaluate(async () => {
      const S = window.__solidify, opt = S.opt, sim = S.sim();
      // Hold an old-target readback across the actual slider interaction.
      // A late census must not become the new objective's first observation.
      opt.setRunning(true); if (!opt.genome) opt.tick(); opt.setRunning(false);
      const originalRead = sim.readStats.bind(sim);
      let release;
      sim.readStats = () => new Promise(resolve => { release = resolve; });
      const oldFinish = opt.finishEpisode();
      const oldCMA = opt.cma;
      const slider = document.getElementById("labTarget");
      slider.value = "5"; slider.dispatchEvent(new Event("input", { bubbles: true }));
      const pausedPreserved = !opt.isRunning();
      const emptyPopulation = opt.queue.length === 0 && opt.scores.length === 0 && opt.genome === null && opt.cma !== oldCMA;
      release({ astm: 1 });
      await oldFinish;
      sim.readStats = originalRead;
      const noStaleRecord = opt.exportFigures().length === 0 && opt.scores.length === 0;
      opt.setRunning(true);
      slider.value = "4.5"; slider.dispatchEvent(new Event("input", { bubbles: true }));
      return { pausedPreserved, emptyPopulation, noStaleRecord, runningPreserved: opt.isRunning() };
    });
    assert(Object.values(reset).every(Boolean), JSON.stringify(reset));
    await page.waitForFunction(() => window.__solidify.opt.exportFigures()[0]?.columns[1].values.some(Number.isFinite), { timeout: 120_000 });
    const changed = await page.evaluate(() => {
      const opt = window.__solidify.opt; opt.setRunning(false);
      const f = opt.exportFigures()[0];
      const firstValid = f.columns[1].values.findIndex(Number.isFinite);
      return { episode: f.columns[0].values[0], error: f.columns[1].values[firstValid], best: f.columns[2].values[firstValid], extra: f.prov.extra };
    });
    assert.equal(changed.episode, 1); assert(Number.isFinite(changed.error)); assert.equal(changed.best, changed.error);
    assert(changed.extra.some(s => s.includes("G = 4.5")) && changed.extra.some(s => s.includes("Search-level initial setup")), JSON.stringify(changed));
    await page.screenshot({ path: resolve(OUT, "completion-optimizer.png") });
    await page.evaluate(() => window.__solidify.opt.stop());
    assert((await page.evaluate(() => window.__solidify.opt.exportFigures().length)) === 1);
  });
  await block("SESSION-FURNACE-PLOT", async () => {
    await page.evaluate(async () => {
      const S = window.__solidify;
      S.app.setMaterial("al"); S.app.setGrid(512); S.app.setRun(false);
      const s = S.sim(); Object.assign(s.params, { alloyOn: 0, coolRate: 2, latent: 1.4, scen: 0 }); s.reset(.1);
      for (let y = 12; y < 512; y += 25) for (let x = 12; x < 512; x += 25) s.addSeed(x, y, 3);
      for (let i = 0; i < 12; i++) await s.stepSync(0);
      for (let i = 0; i < 100; i++) {
        await s.stepSync(120);
        const st = await s.readStats(); if (st?.fracSolid > .995) break;
      }
      S.app.startHeat();
    });
    await page.waitForFunction(() => !!window.__solidify.heat.exportFigures().length);
    const p = await page.evaluate(() => window.__solidify.heat.exportFigures()[0]);
    assert(p.columns.some(c => c.key === "furnace_time"));
    assert(p.fig.x.title.includes("Furnace time"));
    await page.screenshot({ path: resolve(OUT, "completion-furnace.png") });
    await page.click("#htProcessPlot"); await page.waitForSelector(".tmodal table"); await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("htRun").disabled);
    await page.click("#htRun");
    await page.waitForFunction(() => !window.__solidify.heat.busy
      && window.__solidify.heat.exportFigures()[0]?.prov.extra?.some(s => s.includes("Treatment ended.")), { timeout: 120_000 });
    const measured = await page.evaluate(() => window.__solidify.heat.exportFigures()[0].columns.find(c => c.key === "measured_diameter").values.filter(Number.isFinite));
    assert(measured.length >= 2 && measured.every(d => d > 0), JSON.stringify(measured));
    const { manifest } = await archive("completion-run-heat.zip");
    assert(manifest.datasets.some(d => /heat.treatment/i.test(d.title)));
    await page.evaluate(() => window.__solidify.heat.close());
    // An edited composition retains its source without mislabelling it as
    // the active mix. Solver parameters remain the authoritative snapshot.
    await page.evaluate(() => {
      const S = window.__solidify;
      S.composer.applyHash("#alloy=al:Cu2");
      S.sim().params.c0 += .01;
    });
    const edited = await archive("completion-run-edited.zip");
    assert.equal(edited.manifest.material.mix, null);
    assert.equal(edited.manifest.material.compositionEdited, true);
    assert.equal(edited.manifest.material.sourceMix.base, "al");
  });
  await block("SESSION-3D-EXPORT", async () => {
    await page.evaluate(async () => { const S = window.__solidify; S.app.setGrid3(96); await S.app.setMode("3d"); S.app.setRun(false); });
    await page.waitForFunction(() => window.__solidify.mode() === "3d");
    await sleep(700);
    const { manifest } = await archive("completion-run-3d.zip");
    assert.equal(manifest.mode, "3d"); assert.equal(manifest.grid, 96);
    assert(manifest.image.perspective && manifest.image.umPerPixel > 0);
    assert(manifest.solver.includes("Kobayashi"));
    await page.screenshot({ path: resolve(OUT, "completion-3d.png") });
  });
  await block("SESSION-3D-CALIBRATION", async () => {
    const pure = await page.evaluate(async () => {
      const S = window.__solidify;
      await S.app.setMode("2d"); S.app.setRun(false);
      S.app.setMaterial("scn"); S.app.setUmPerCell(1.7);
      const before = { ...S.sim().params, pitch: S.sim().umPerCell };
      await S.app.setMode("3d"); S.app.setRun(false); S.app.setAlloyOn(false);
      S.sim3d().params.coolRate = 0;
      const kob = { ...S.sim3d().params, pitch: S.sim3d().umPerCell };
      const s3 = S.sim3d(), prepare = s3.enableQuant.bind(s3);
      s3.enableQuant = async () => { await new Promise(r => setTimeout(r, 80)); return prepare(); };
      try {
        const entering = S.app.setCalibrated(true);
        S.app.setLambda(2.5); S.app.setLambda(3.5);
        await entering;
      } finally { s3.enableQuant = prepare; }
      const q = S.app.calibration();
      const calibrated = { ...S.sim3d().params, pitch: S.sim3d().umPerCell };
      S.app.seedCenter();
      S.app.setRun(true);
      return { before, kob, q, calibrated, dormant2: { ...S.sim().params, pitch: S.sim().umPerCell } };
    });
    assert(pure.q && pure.calibrated.solver === 1 && pure.calibrated.frozenT === 0, JSON.stringify(pure));
    assert.equal(pure.calibrated.lambda, 3.5, "latest pending coupling was lost");
    assert(Math.abs(pure.calibrated.pitch / pure.q.umPerCell - 1) < 1e-12);
    assert.deepEqual(pure.dormant2, pure.before, "3D calibration changed the dormant 2D setup");
    await sleep(1000);
    const state = await page.evaluate(async () => {
      const S = window.__solidify; S.app.setRun(false);
      return { time: S.sim3d().simTime, status: await S.sim3d().readQuantitativeStatus(),
        solver: S.sim3d().params.solver, issue: S.app.calibrationIssue(), parameters: { ...S.sim3d().params } };
    });
    assert(state.time > 0 && state.solver === 1 && !state.status?.issue, JSON.stringify(state));
    const packed = await archive("completion-run-3d-calibrated.zip");
    assert(packed.manifest.solver.includes("TRUE 3D") && packed.manifest.solver.includes("coupled heat"));
    assert.equal(packed.manifest.parameters.solver, 1);
    const link = await page.evaluate(() => window.__solidify.app.shareLink());
    await boot(link);
    await page.waitForFunction(() => window.__solidify.mode() === "3d" && window.__solidify.sim3d()?.params.solver === 1);
    const restored = await page.evaluate(async () => {
      const S = window.__solidify;
      const q = S.app.calibration(); const pitch = S.app.getUmPerCell();
      await S.app.setCalibrated(false);
      const kob = { ...S.sim3d().params, pitch: S.sim3d().umPerCell };
      S.app.setMaterial("ice"); const reason = S.app.calibrationIssue(); await S.app.setCalibrated(true);
      return { q, pitch, kob, refused: S.sim3d().params.solver === 0, reason };
    });
    assert(restored.q && Math.abs(restored.pitch / restored.q.umPerCell - 1) < 1e-12);
    assert(restored.kob.epsBar < .1 && restored.kob.tau < .1 && restored.kob.dTherm === 1);
    assert(restored.refused && /cubic|symmetry/i.test(restored.reason), JSON.stringify(restored));
    await page.evaluate(async () => {
      const S = window.__solidify; S.app.setMaterial("al"); await S.app.setAlloyOn(true); await S.app.setCalibrated(true);
    });
    const alloy = await archive("completion-run-3d-alloy-calibrated.zip");
    assert.equal(alloy.manifest.parameters.solver, 1);
    assert.equal(alloy.manifest.parameters.frozenT, 1);
    assert(alloy.manifest.solver.includes("imposed temperature"));
    assert(Math.abs(alloy.manifest.parameters.kPart - .17) < 1e-6);
    await page.evaluate(() => {
      const S = window.__solidify; S.app.setCalibrated(false);
      S.composer.applyHash("#alloy=al:Si7,Mg0.35");
    });
    await page.waitForFunction(() => window.__solidify.sim3d().alloyActive);
    const composedLink = await page.evaluate(async () => {
      const S = window.__solidify; await S.app.setCalibrated(true); return S.app.shareLink();
    });
    await boot(composedLink);
    await page.waitForFunction(() => window.__solidify.mode() === "3d" && window.__solidify.sim3d()?.params.solver === 1);
    const roundTrip = await page.evaluate(async () => {
      const S = window.__solidify, q = S.app.calibration(), k = S.sim3d().params.kPart;
      await S.app.setCalibrated(false);
      const kobK = S.sim3d().params.kPart;
      await S.app.setCalibrated(true);
      return { q, next: S.app.calibration(), k, kobK };
    });
    assert(roundTrip.q && roundTrip.next && roundTrip.k === roundTrip.kobK, JSON.stringify(roundTrip));
    assert.equal(roundTrip.q.dT0, roundTrip.next.dT0);
    assert(!roundTrip.next.coefficientSource.includes("dials have moved"));
    const composedArchive = await archive("completion-run-3d-composed-calibrated.zip");
    assert(composedArchive.manifest.material.mix && !composedArchive.manifest.material.compositionEdited);
    const withdrawn = await page.evaluate(async () => {
      const S = window.__solidify;
      S.app.setMaterial("steel"); S.sim3d().params.c0 = .35; S.tick(1);
      await new Promise(r => setTimeout(r, 100));
      return { solver: S.sim3d().params.solver, reason: S.app.calibrationIssue() };
    });
    assert.equal(withdrawn.solver, 0, JSON.stringify(withdrawn));
    assert(withdrawn.reason, JSON.stringify(withdrawn));
  });
  assert.deepEqual(errors, [], errors.join(" | "));
} catch (e) { failed++; console.error(e.stack); }
finally { await closeBrowser(browser); }
console.log(failed ? `done: ${failed} completion checks FAILED` : "done: all completion checks passed");
process.exitCode = failed ? 1 : 0;
