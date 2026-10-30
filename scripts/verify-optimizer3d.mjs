// Genuine 3D optimizer acceptance. No physics result or passing score is faked.
// Root must schedule this script under a source freeze and a single GPU owner.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { closeBrowser } from "./browser-cleanup.mjs";
import { installOptimizer3DAudit } from "./fixtures/optimizer3d-audit.mjs";

const OUT = resolve(process.argv[2] ?? "verify-out/optimizer3d"), PORT = process.argv[3] ?? "5199";
mkdirSync(OUT, { recursive: true });
const paths = ["src/main.ts", "src/optimizer.ts", "src/optimizer3d.ts", "src/optimizer3d-model.ts", "src/sim3d.ts", "src/nucleation.ts",
  "src/ui.ts", "src/share.ts", "src/rng.ts", "src/shaders3d.ts", "src/shaders3d-quant.ts", "src/shaders.ts",
  "scripts/verify-optimizer3d.mjs", "scripts/fixtures/optimizer3d-audit.mjs"];
const hashes = () => Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const result = { started: new Date().toISOString(), checks: [], errors: [], passed: false, deviceErrorLedgerRead: false, sourceHashes: hashes() };
const save = () => writeFileSync(resolve(OUT, "optimizer3d-result.json"), JSON.stringify(result, null, 2));
const extra = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
assert(Array.isArray(extra) && extra.every(value => typeof value === "string"), "CHROME_ARGS must be a string array");
let browser = null, page = null;
const gate = async (name, run) => {
  try { const evidence = await run(); result.checks.push({ name, passed: true, evidence }); save(); console.log(name, "OK", JSON.stringify(evidence)); }
  catch (error) { result.checks.push({ name, passed: false, error: error.stack ?? String(error) }); save(); throw error; }
};
const snap = () => page.evaluate(() => {
  const S = window.__solidify;
  return { mode: S.mode(), grid: S.sim3d()?.n, time: S.sim3d()?.simTime, frame: S.sim3d()?.frame,
    appRunning: S.app.isRunning(), engineering: S.app.isEngineering(), ...S.opt3.snapshot() };
});
async function settle() {
  await page.waitForFunction(() => !window.__solidify.opt3.snapshot().pending, { timeout: 120_000 });
  await page.evaluate(async () => { const sim = window.__solidify.sim3d(); if (sim) await sim.device.queue.onSubmittedWorkDone(); });
}
async function boot(url = `http://localhost:${PORT}/app/`) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!window.__solidify?.opt3, { timeout: 60_000 });
}
async function deviceErrors() {
  return await page.evaluate(() => {
    if (!Array.isArray(window.__opt3DeviceErrors)) throw new Error("3D optimizer GPU error ledger is unavailable");
    return [...window.__opt3DeviceErrors];
  });
}
function closeEnough(actual, expected, label, relative = 1e-8) {
  assert(Number.isFinite(actual) && Number.isFinite(expected), `${label}: finite numbers required`);
  assert(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);
}

save();
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true, protocolTimeout: 300_000, defaultViewport: { width: 1440, height: 1000 },
    args: ["--enable-unsafe-webgpu", "--enable-gpu", ...extra] });
  page = await browser.newPage(); page.setDefaultTimeout(120_000);
  page.on("pageerror", error => result.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") result.errors.push(message.text()); });
  await boot();
  await gate("OPT3-ADMISSION", async () => {
    const evidence = await page.evaluate(async () => {
      const S = window.__solidify; S.app.setRun(false); S.app.setMaterial("al"); S.app.setGrid3(96);
      S.setSeed(0x51d3cafe); await S.app.setMode("3d"); S.app.setRun(false); S.app.setUmPerCell(1.25);
      S.app.setCalibrated(false); await S.app.setAlloyOn(false); S.app.setUndercool(.65); S.app.setInoculant(128); S.app.resetArmed();
      const sim = S.sim3d(), info = sim.device.adapterInfo;
      return { mode: S.mode(), n: sim.n, pitch: sim.umPerCell, seed: S.seed(), material: S.app.getMaterial(),
        adapter: { vendor: info.vendor, architecture: info.architecture, isFallbackAdapter: info.isFallbackAdapter ?? null } };
    });
    assert.equal(evidence.mode, "3d"); assert.equal(evidence.n, 96); assert.equal(evidence.adapter.isFallbackAdapter, false);
    await page.evaluate(installOptimizer3DAudit); result.setup = evidence; return evidence;
  });
  await gate("OPT3-ENTER-PAUSED", async () => {
    const evidence = await page.evaluate(() => {
      const S = window.__solidify; S.app.startOptimizer(); S.ui.sync();
      return { snapshot: S.opt3.snapshot(), appRunning: S.app.isRunning(), engineering: S.app.isEngineering(),
        panel: !!document.querySelector("#optimizer3d[data-dimension='3d']"),
        targetLabel: document.getElementById("opt3Target")?.getAttribute("aria-label") };
    });
    assert(evidence.snapshot.active && !evidence.snapshot.running && !evidence.appRunning && evidence.engineering && evidence.panel);
    assert(/diameter/i.test(evidence.targetLabel) && /cells|µm/i.test(evidence.targetLabel));
    assert(!/ASTM|target\s+G\b/i.test(evidence.targetLabel), "The actual 3D target label must name diameter");
    evidence.hostInterlocks = await page.evaluate(async () => {
      const S = window.__solidify;
      const context = () => ({ params: { ...S.sim3d().params }, material: S.app.getMaterial(), seed: S.seed(),
        grid: S.sim3d().n, undercool: S.app.getUndercool() });
      const before = context();
      const materialTook = S.app.setMaterial("ni"); S.app.setGrid3(128); S.setSeed(before.seed ^ 0x54321);
      S.app.setParams({ coolRate: before.params.coolRate + .137, delta: before.params.delta + .01 });
      S.app.setUndercool(.37); await S.sim3d().device.queue.onSubmittedWorkDone(); await new Promise(requestAnimationFrame);
      return { before, after: context(), materialTook, active: S.opt3.snapshot().active };
    });
    assert.equal(evidence.hostInterlocks.materialTook, false); assert(evidence.hostInterlocks.active);
    assert.deepEqual(evidence.hostInterlocks.after, evidence.hostInterlocks.before, "Host controls must not change an owned search setup");
    const initial = await snap(); await page.evaluate(() => window.__solidify.tick(20));
    const after = await snap(); assert.equal(after.totalSteps, initial.totalSteps); assert.equal(after.time, initial.time);
    await page.screenshot({ path: resolve(OUT, "optimizer3d-enter-paused.png") }); return evidence;
  });
  await gate("OPT3-MOBILE-CONTROLS", async () => {
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => window.__solidify.ui.sync());
    const evidence = await page.evaluate(() => {
      const panel = document.getElementById("optimizer3d"), rect = panel.getBoundingClientRect();
      const run = document.querySelector("#transport .run"), box = run.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const exit = [...panel.querySelectorAll("button")].find(button => button.textContent.trim() === "exit");
      return { panel: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth }, viewport: { width: innerWidth, height: innerHeight },
        runReachable: hit === run || run.contains(hit), exitPresent: !!exit };
    });
    assert(evidence.panel.left >= -1 && evidence.panel.right <= evidence.viewport.width + 1);
    assert(evidence.panel.top >= -1 && evidence.panel.bottom <= evidence.viewport.height + 1);
    assert(evidence.panel.scrollWidth <= evidence.panel.clientWidth + 1 && evidence.runReachable && evidence.exitPresent);
    await page.screenshot({ path: resolve(OUT, "optimizer3d-mobile.png") });
    await page.setViewport({ width: 1440, height: 1000 }); return evidence;
  });
  await gate("OPT3-PAUSE-STEPS", async () => {
    await page.evaluate(async () => {
      const S = window.__solidify; await S.opt3.stop();
      if (!S.opt3.start({ limit: 2 })) throw new Error("3D bounded search did not start");
      S.app.setRun(true); S.tick(1);
    });
    await page.waitForFunction(() => window.__solidify.opt3.snapshot().totalSteps > 0);
    await page.evaluate(() => window.__solidify.app.setRun(false)); await settle();
    const before = await snap(); assert(before.totalSteps > 0, "Pause proof requires delivered physics");
    const pausedField = await page.evaluate(() => window.__optimizer3DAudit.snapshot());
    await page.evaluate(() => window.__solidify.tick(30)); await new Promise(resolve => setTimeout(resolve, 300));
    const after = await snap();
    assert.equal(after.totalSteps, before.totalSteps); assert.equal(after.time, before.time);
    assert.equal(after.history.length, before.history.length); assert.equal(after.running, false);
    result.pausedField = await page.evaluate(() => window.__optimizer3DAudit.snapshot());
    assert.equal(result.pausedField.stateSha256, pausedField.stateSha256);
    assert.equal(result.pausedField.grainSha256, pausedField.grainSha256);
    return { before, after };
  });
  let winner, recipeLink;
  await gate("OPT3-REAL-CAST-OBJECTIVE", async () => {
    await page.evaluate(() => { const S = window.__solidify; S.app.setRun(true); S.tick(1); });
    await page.waitForFunction(() => {
      const s = window.__solidify.opt3.snapshot(); return s.active && !s.running && !s.pending && s.history.length === 2;
    }, { timeout: 300_000 });
    const state = await snap(), field = await page.evaluate(() => window.__optimizer3DAudit.snapshot());
    assert.equal(state.grid, 96); assert(state.totalSteps > 0); assert(state.history.every(row => row.valid));
    const last = state.history.at(-1); assert(last.deliveredSteps > 0 && last.fracSolid >= .92);
    assert.equal(field.nonFinite, 0); assert(field.solid > 0 && field.grainCount > 0);
    assert.equal(field.stats.grainCount, field.grainCount); assert.equal(last.grainCount, field.grainCount);
    closeEnough(field.stats.meanVolVox, field.meanVolVox, "GPU/CPU mean grain volume");
    closeEnough(field.stats.eqDiamUm, field.eqDiamUm, "GPU/CPU diameter");
    closeEnough(last.meanVolVox, field.meanVolVox, "optimizer/direct mean volume");
    closeEnough(last.diameterCells, field.diameterCells, "optimizer/direct cell diameter");
    closeEnough(last.diameter, state.bestRecipe.known ? field.eqDiamUm : field.diameterCells, "optimizer shown metric");
    assert.notEqual(field.stateSha256, result.pausedField.stateSha256, "A completed casting must evolve actual voxel state");
    for (let i = 1; i < state.history.length; i++) assert(state.history[i].best <= state.history[i - 1].best + 1e-12);
    winner = state.bestRecipe; assert(winner && winner.dimension === "3d" && winner.grid === 96 && winner.seed === result.setup.seed);
    result.directCensus = field; result.boundedSearch = state; return { state, direct: field };
  });
  await gate("OPT3-REPORT-AND-CURVE", async () => {
    const evidence = await page.evaluate(() => {
      const S = window.__solidify, report = document.getElementById("opt3Report"), figures = S.opt3.exportFigures();
      return { reportVisible: !!report && getComputedStyle(report).display !== "none", reportText: report?.textContent,
        targetLabel: document.getElementById("opt3Target")?.getAttribute("aria-label"),
        figures: figures.map(f => ({ title: f.title, columns: f.columns, prov: f.prov, axes: [f.fig.x.title, ...f.fig.panels.map(panel => panel.y.title)] })) };
    });
    assert(evidence.reportVisible && evidence.figures.length > 0);
    assert(evidence.figures.some(figure => /3D|volume/i.test(figure.title) && /96/.test(figure.prov.grid)));
    assert(/diameter/i.test(evidence.targetLabel) && !/ASTM|target\s+G\b/i.test(evidence.targetLabel));
    assert(evidence.figures.every(figure => figure.axes.some(axis => /diameter/i.test(axis))
      && figure.axes.every(axis => !/ASTM|target\s+G\b/i.test(axis))), "3D curve axes must describe diameter error, not ASTM G");
    await page.screenshot({ path: resolve(OUT, "optimizer3d-result.png") }); return evidence;
  });
  await gate("OPT3-APPLY-AND-SCHEDULE", async () => {
    recipeLink = await page.evaluate(() => window.__solidify.opt3.shareBestLink()); assert(recipeLink?.includes("#set="));
    const applied = await page.evaluate(async () => {
      const S = window.__solidify, button = [...document.querySelectorAll("#opt3Report button")]
        .find(button => /apply/i.test(button.textContent));
      if (!button) throw new Error("3D apply recipe control was missing"); button.click();
      while (S.opt3.snapshot().active || S.opt3.snapshot().pending) await new Promise(requestAnimationFrame);
      await S.sim3d().device.queue.onSubmittedWorkDone();
      const share = S.app.shareLink(), payload = share.split("#set=")[1].replaceAll("-", "+").replaceAll("_", "/");
      const shared = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0))));
      return { mode: S.mode(), grid: S.sim3d().n, pitch: S.sim3d().umPerCell, seed: S.seed(), material: S.app.getMaterial(),
        running: S.app.isRunning(), undercool: S.app.getUndercool(), nmax: S.app.getInoculant(), params: { ...S.sim3d().params }, shared };
    });
    assert.equal(applied.mode, "3d"); assert.equal(applied.grid, winner.grid); assert.equal(applied.pitch, winner.pitch);
    assert.equal(applied.seed, winner.seed); assert.equal(applied.material, result.setup.material); assert.equal(applied.running, false);
    closeEnough(applied.undercool, winner.undercool, "applied undercooling"); closeEnough(applied.nmax, winner.nmax, "applied inoculant");
    closeEnough(applied.params.coolRate, winner.cool[0], "applied first cooling stage");
    assert.equal(applied.shared.d, 1); assert.equal(applied.shared.g3, winner.grid); assert.deepEqual(applied.shared.sched, winner.cool);
    result.applied = applied; return applied;
  });
  await gate("OPT3-SHARE-RESTORE", async () => {
    result.errors.push(...await deviceErrors());
    await boot(recipeLink); await page.waitForFunction(() => window.__solidify.mode() === "3d" && window.__solidify.sim3d());
    await page.waitForFunction(() => window.__solidify.app.canSwitchMode());
    await page.evaluate(installOptimizer3DAudit);
    const restored = await page.evaluate(() => {
      const S = window.__solidify;
      return { mode: S.mode(), n: S.sim3d().n, pitch: S.sim3d().umPerCell, material: S.app.getMaterial(),
        seed: S.seed(), running: S.app.isRunning(), undercool: S.app.getUndercool(), nmax: S.app.getInoculant(), share: S.app.shareLink() };
    });
    assert.equal(restored.mode, "3d"); assert.equal(restored.n, winner.grid); assert.equal(restored.pitch, winner.pitch);
    assert.equal(restored.seed, winner.seed); assert.equal(restored.material, result.setup.material); assert.equal(restored.running, false);
    closeEnough(restored.undercool, winner.undercool, "shared undercooling"); closeEnough(restored.nmax, winner.nmax, "shared inoculant");
    result.restored = restored; return restored;
  });
  await gate("OPT3-WINNING-RECIPE-REPLAY", async () => {
    const staged = await page.evaluate(() => window.__solidify.recipe3dState());
    assert(staged?.recipe && staged.schedule, "The winning recipe must carry a real 3D replay schedule");
    await page.evaluate(() => { const S = window.__solidify; S.app.setRun(true); S.tick(1); });
    await page.waitForFunction(() => {
      const clock = window.__solidify.recipe3dState()?.clock;
      return clock?.completed || clock?.exhausted || clock?.invalid;
    }, { timeout: 300_000 });
    await page.waitForFunction(() => !window.__solidify.app.isRunning());
    const replay = await page.evaluate(() => window.__solidify.recipe3dState());
    const field = await page.evaluate(() => window.__optimizer3DAudit.snapshot());
    assert(replay.clock.completed && !replay.clock.invalid && replay.clock.deliveredSteps > 0);
    assert(replay.clock.deliveredSteps <= winner.maxSteps); assert(field.fracSolid >= .92 && field.grainCount > 0);
    closeEnough(winner.known ? field.eqDiamUm : field.diameterCells, winner.diameter, "winning recipe live replay");
    result.replay = { state: replay, field }; return result.replay;
  });
  await gate("OPT3-REPLAY-DETERMINISM", async () => {
    await page.evaluate(() => {
      const S = window.__solidify; S.app.resetArmed(); S.app.setRun(true); S.tick(1);
    });
    await page.waitForFunction(() => {
      const clock = window.__solidify.recipe3dState()?.clock;
      return clock?.completed || clock?.exhausted || clock?.invalid;
    }, { timeout: 300_000 });
    await page.waitForFunction(() => !window.__solidify.app.isRunning());
    const state = await page.evaluate(() => window.__solidify.recipe3dState());
    const field = await page.evaluate(() => window.__optimizer3DAudit.snapshot());
    assert(state.clock.completed && !state.clock.invalid);
    assert.equal(state.clock.deliveredSteps, result.replay.state.clock.deliveredSteps);
    assert.equal(field.stateSha256, result.replay.field.stateSha256);
    assert.equal(field.grainSha256, result.replay.field.grainSha256);
    return { clock: state.clock, stateSha256: field.stateSha256, grainSha256: field.grainSha256 };
  });
  await gate("OPT3-INVALID-CAST-REFUSED", async () => {
    const started = await page.evaluate(() => {
      const S = window.__solidify; S.app.setMaterial("generic");
      const ok = S.opt3.start({ limit: 1, maxSteps: 1 }); S.app.setRun(true); S.tick(1); return ok;
    });
    assert(started); await page.waitForFunction(() => {
      const s = window.__solidify.opt3.snapshot(); return !s.running && !s.pending && s.history.length === 1;
    });
    const state = await snap(); assert.equal(state.history[0].valid, false); assert.equal(state.bestRecipe, null);
    assert.equal(state.known, false); assert.equal(state.unit, "cells");
    if (Number.isFinite(state.history[0].diameter)) closeEnough(state.history[0].diameter, state.history[0].diameterCells, "unknown-SI metric in cells");
    assert.equal(state.history[0].deliveredSteps, 1); assert(state.history[0].fracSolid < .92);
    assert.equal(await page.evaluate(() => window.__solidify.opt3.shareBestLink()), null);
    assert.equal(await page.evaluate(() => window.__solidify.opt3.applyBest()), false);
    await page.evaluate(async () => { await window.__solidify.opt3.stop(); }); return state;
  });
  await gate("OPT3-LATE-CENSUS-TARGET", async () => {
    await page.evaluate(() => {
      const S = window.__solidify; if (!S.opt3.start({ limit: 2 })) throw new Error("Target race search did not start");
      const sim = S.sim3d(), read = sim.readStats.bind(sim), held = { entered: false };
      window.__opt3Held = held;
      sim.readStats = async function () {
        const stats = await read();
        if (stats && !held.entered) { held.entered = true; return await new Promise(resolve => { held.release = () => resolve(stats); }); }
        return stats;
      };
      held.restore = () => { sim.readStats = read; }; S.app.setRun(true); S.tick(1);
    });
    await page.waitForFunction(() => window.__opt3Held.entered && typeof window.__opt3Held.release === "function");
    const evidence = await page.evaluate(async () => {
      const S = window.__solidify; S.app.setRun(false);
      const target = document.getElementById("opt3Target"), oldTarget = S.opt3.snapshot().target, next = Number(target.value) * 1.1;
      target.value = String(next); target.dispatchEvent(new Event("input", { bubbles: true }));
      const before = S.opt3.snapshot(); window.__opt3Held.restore(); window.__opt3Held.release();
      while (S.opt3.snapshot().pending) await new Promise(requestAnimationFrame);
      return { before, after: S.opt3.snapshot(), oldTarget, target: Number(target.value) };
    });
    assert.equal(evidence.after.history.length, 0); assert.equal(evidence.after.bestRecipe, null); assert.equal(evidence.after.running, false);
    assert.notEqual(evidence.after.target, evidence.oldTarget); closeEnough(evidence.after.target, evidence.target, "new objective target");
    await page.evaluate(async () => { await window.__solidify.opt3.stop(); }); return evidence;
  });
  await gate("OPT3-LATE-CENSUS-STOP-RESTART", async () => {
    await page.evaluate(() => {
      const S = window.__solidify; if (!S.opt3.start({ limit: 2 })) throw new Error("Stop race search did not start");
      const sim = S.sim3d(), read = sim.readStats.bind(sim), held = { entered: false };
      window.__opt3Held = held;
      sim.readStats = async function () {
        const stats = await read();
        if (stats && !held.entered) { held.entered = true; return await new Promise(resolve => { held.release = () => resolve(stats); }); }
        return stats;
      };
      held.restore = () => { sim.readStats = read; }; S.app.setRun(true); S.tick(1);
    });
    await page.waitForFunction(() => window.__opt3Held.entered && typeof window.__opt3Held.release === "function");
    const evidence = await page.evaluate(async () => {
      const S = window.__solidify, stopping = S.opt3.stop();
      const immediateStart = S.opt3.start({ limit: 1, maxSteps: 1 });
      window.__opt3Held.restore(); window.__opt3Held.release(); await stopping;
      const afterOldStop = S.opt3.snapshot();
      if (S.opt3.snapshot().active) await S.opt3.stop();
      const restarted = S.opt3.start({ limit: 1 }); S.app.setRun(false);
      while (S.opt3.snapshot().pending) await new Promise(requestAnimationFrame);
      return { immediateStart, afterOldStop, restarted, state: S.opt3.snapshot() };
    });
    if (evidence.immediateStart) {
      assert(evidence.afterOldStop.active, "Old stop completion canceled a newly admitted search");
      assert.equal(evidence.afterOldStop.history.length, 0);
      assert.equal(evidence.afterOldStop.bestRecipe, null);
    }
    assert(evidence.restarted); assert.equal(evidence.state.history.length, 0); assert.equal(evidence.state.bestRecipe, null);
    assert.equal(evidence.state.running, false); await page.evaluate(async () => { await window.__solidify.opt3.stop(); }); return evidence;
  });
  await gate("OPT3-QUANTITATIVE-MODE-REFUSAL", async () => {
    await page.evaluate(async () => {
      const S = window.__solidify; await S.opt3.stop(); S.app.setRun(false); S.app.setMaterial("al");
      await S.app.setAlloyOn(false); S.app.setUndercool(.2); S.app.setParams({ coolRate: 0 });
      await S.app.setCalibrated(true);
    });
    await page.waitForFunction(() => window.__solidify.sim3d().params.solver === 1 && !window.__solidify.app.calibrationBusy?.());
    const evidence = await page.evaluate(() => {
      const S = window.__solidify; S.app.startOptimizer(); S.ui.sync();
      return { solver: S.sim3d().params.solver, active: S.opt3.snapshot().active, status: S.opt3.snapshot().status,
        visibleReason: document.getElementById("optimizer3d")?.textContent, calibrated: S.app.isCalibrated() };
    });
    assert.equal(evidence.solver, 1); assert.equal(evidence.active, false); assert.equal(evidence.calibrated, true);
    assert(/Kobayashi/i.test(evidence.status) && /Kobayashi/i.test(evidence.visibleReason));
    await page.evaluate(async () => {
      const S = window.__solidify, close = [...document.querySelectorAll("#optimizer3d button")].find(button => button.textContent.trim() === "close");
      if (close) close.click(); await S.opt3.stop(); await S.app.setCalibrated(false);
    });
    await page.waitForFunction(() => window.__solidify.sim3d().params.solver === 0); return evidence;
  });
  await gate("OPT3-LEGACY-2D-COMPATIBILITY", async () => {
    const entered = await page.evaluate(async () => {
      const S = window.__solidify; await S.app.setMode("2d"); S.app.setRun(false); const grid = S.sim().n;
      S.app.startOptimizer(); const entered = { active: S.opt.active, running: S.opt.running, panel: !!document.getElementById("lab"), grid };
      S.app.setRun(true); S.tick(8); return entered;
    });
    assert(entered.active && !entered.running && entered.panel);
    await page.waitForFunction(() => window.__solidify.sim().simTime > 0);
    const ended = await page.evaluate(() => {
      const S = window.__solidify; S.app.setRun(false); S.opt.stop();
      return { active: S.opt.active, engineering: S.app.isEngineering(), grid: S.sim().n, mode: S.mode() };
    });
    assert.equal(ended.mode, "2d"); assert.equal(ended.active, false); assert.equal(ended.engineering, false); assert.equal(ended.grid, entered.grid);
    return { entered, ended };
  });
} catch (error) { result.exception = error.stack ?? String(error); console.error(result.exception); }
finally {
  if (page) {
    try { await page.evaluate(async () => { const S = window.__solidify; if (S?.opt3) await S.opt3.stop(); if (S?.opt?.active) S.opt.stop(); S?.app.setRun(false); }); }
    catch (error) { result.errors.push(`optimizer cleanup: ${error.message}`); }
    try {
      result.errors.push(...await deviceErrors()); result.deviceErrorLedgerRead = true;
    } catch (error) { result.errors.push(`device error evidence: ${error.message}`); }
  }
  if (browser) { try { await closeBrowser(browser); } catch (error) { result.errors.push(`browser cleanup: ${error.message}`); } }
  result.finalHashes = hashes(); result.sourceStable = JSON.stringify(result.sourceHashes) === JSON.stringify(result.finalHashes);
  result.finished = new Date().toISOString();
  result.passed = !result.exception && result.errors.length === 0 && result.sourceStable && result.deviceErrorLedgerRead
    && result.checks.length === 15 && result.checks.every(check => check.passed); save();
}
console.log("OPT3-ACCEPTANCE", result.passed ? "OK" : "FAIL", JSON.stringify({ passed: result.passed, checks: result.checks.length,
  sourceStable: result.sourceStable, errors: result.errors, exception: result.exception }));
process.exitCode = result.passed ? 0 : 1;
