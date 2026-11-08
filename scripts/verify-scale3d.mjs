import { closeBrowser } from "./browser-cleanup.mjs";
// SCALE3D — the 3D half of the length-anchor change, checked on its own.
//
// verify-3d covers the whole volume in 23 checks and takes long enough that it
// is awkward to re-run for one thing. This targets exactly what v5.0 altered in
// 3D: the volume used to measure microns against a hardcoded 1 mm / 1024 while
// the 2D side divided by its own grid, so the two dimensions disagreed about the
// size of a micron at every grid but the default. Both now read `umPerCell`.
//
//   node scripts/verify-scale3d.mjs [outDir] [port]
import puppeteer from "puppeteer-core";

const PORT = process.argv[3] ?? "5205";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1200, height: 800 },
});
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
await new Promise(r => setTimeout(r, 700));

await page.evaluate(async () => {
  const S = window.__solidify.app;
  S.setRun(false);
  S.setUmPerCell(1.25);
  await S.setMode("3d");
  S.setRun(false);
});
await new Promise(r => setTimeout(r, 1200));

// 1. Each dimension retains its own resolution. The active host follows mode
//    switches without overwriting the other dimension's manual pitch.
{
  const got = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setUmPerCell(2.5);
    const read = () => ({ two: S.sim().umPerCell, three: S.sim3d()?.umPerCell ?? null, host: S.app.getUmPerCell() });
    const in3d = read();
    await S.app.setMode("2d");
    const in2d = read();
    S.app.setUmPerCell(1.75);
    const edited2d = read();
    await S.app.setMode("3d");
    S.app.setRun(false);
    return { in3d, in2d, edited2d, back3d: read() };
  });
  const ok = got.in3d.two === 1.25 && got.in3d.three === 2.5 && got.in3d.host === 2.5
    && got.in2d.two === 1.25 && got.in2d.three === 2.5 && got.in2d.host === 1.25
    && got.edited2d.two === 1.75 && got.edited2d.three === 2.5 && got.edited2d.host === 1.75
    && got.back3d.two === 1.75 && got.back3d.three === 2.5 && got.back3d.host === 2.5;
  console.log("SCALE3D-INDEPENDENT", ok ? "OK" : FAIL(), JSON.stringify(got));
}

// 2. the volume's own measurements follow it. eqDiamUm is computed in sim3d from
//    umPerCell, so doubling the resolution must double the reported diameter for
//    the SAME voxel count — the check the hardcoded /1024 could never pass.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    const s3 = S.sim3d();
    const read = async () => {
      for (let t = 0; t < 60; t++) { const st = await s3.readStats(); if (st) return st; await s3.device.queue.onSubmittedWorkDone(); }
      return null;
    };
    S.app.setUmPerCell(1.0);
    S.app.clearMelt(0.5);
    S.app.seedCenter();
    S.app.setRun(true);
    for (let i = 0; i < 12; i++) S.tick(10);
    S.app.setRun(false);
    await s3.device.queue.onSubmittedWorkDone();
    const a = await read();
    S.app.setUmPerCell(2.0);
    const b = await read();
    return { vox: a?.meanVolVox ?? null, d1: a?.eqDiamUm ?? null, d2: b?.eqDiamUm ?? null,
      vox2: b?.meanVolVox ?? null, grains: a?.grainCount ?? null, grains2: b?.grainCount ?? null };
  });
  // same structure, twice the micron pitch -> twice the diameter (volume is
  // paused and queue-drained, so the voxel census must agree exactly)
  const ratio = out.d1 && out.d2 ? out.d2 / out.d1 : 0;
  const ok = out.vox > 0 && out.vox2 === out.vox && out.grains > 0 && out.grains2 === out.grains
    && out.d1 > 0 && Math.abs(ratio - 2) < 1e-6;
  console.log("SCALE3D-FOLLOWS", ok ? "OK" : FAIL(),
    JSON.stringify({ ...out, ratio: +ratio.toFixed(3) }));
}

// 3. the SCALE panel reports the volume's derived domain, not the 2D grid's
{
  const out = await page.evaluate(() => {
    const S = window.__solidify;
    S.app.setUmPerCell(1.5);
    const u = S.app.units();
    return { n: S.sim3d().n, domainUm: u.scale.domainUm, umPerCell: u.scale.umPerCell };
  });
  const ok = Math.abs(out.domainUm - out.n * 1.5) < 1e-6;
  console.log("SCALE3D-DOMAIN", ok ? "OK" : FAIL(), JSON.stringify(out));
}

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await closeBrowser(browser);
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
