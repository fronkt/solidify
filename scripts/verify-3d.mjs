// Verifies the TRUE-3D mode end-to-end on real headless WebGPU:
// mode entry, growth, grain claiming, all four lenses, orbit + ViewCube snap,
// tap-at-depth seeding, and fps probes at both grid sizes.
//   node scripts/verify-3d.mjs [outDir] [port]
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
const PORT = process.argv[3] ?? "5201";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1400, height: 950 },
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
try { await page.waitForFunction("!!window.__solidify", { timeout: 15000 }); }
catch { await page.reload({ waitUntil: "networkidle0" }); await page.waitForFunction("!!window.__solidify", { timeout: 20000 }); }
await new Promise(r => setTimeout(r, 800));

const tick = async k => { await page.evaluate(n => window.__solidify.tick(n), k); await new Promise(r => setTimeout(r, 60)); };
const grow = async k => { for (let i = 0; i < k; i++) await tick(30); };
const stats3 = () => page.evaluate(async () => {
  const S = window.__solidify;
  let s = null;
  for (let t = 0; t < 40 && !s; t++) {
    s = await S.sim3d().readStats();
    if (!s) await S.sim3d().device.queue.onSubmittedWorkDone();
  }
  return s;
});
const hideChrome = () => page.evaluate(() => {
  for (const el of document.getElementById("app").children)
    if (el.tagName !== "CANVAS") el.style.display = "none";
});

// 1. enter 3D mode
await page.evaluate(() => window.__solidify.app.setMode("3d"));
await page.waitForFunction("window.__solidify.mode() === '3d'", { timeout: 30000 });
const grid = await page.evaluate(() => window.__solidify.app.getGrid3());
console.log("ENTERED 3D at", `${grid}³`, "filterable:", await page.evaluate(() => window.__solidify.sim3d().device.features.has("float32-filterable")));

// 2. growth: fracSolid must rise monotonically
await grow(2);
const sA = await stats3();
await grow(4);
const sB = await stats3();
console.log("GROWTH", sA && sB && sB.fracSolid > sA.fracSolid && sA.fracSolid > 0 ? "OK" : "FAIL",
  JSON.stringify({ a: sA?.fracSolid?.toFixed(4), b: sB?.fracSolid?.toFixed(4) }));

// 3. two-seed claiming: distinct grains
await page.evaluate(() => {
  const S = window.__solidify;
  S.app.resetArmed();
  const s3 = S.sim3d();
  s3.addSeed3D(s3.n * 0.3, s3.n * 0.5, s3.n * 0.5, 4);
  s3.addSeed3D(s3.n * 0.7, s3.n * 0.5, s3.n * 0.5, 4);
  S.app.setRun(true);
});
await grow(5);
const s2 = await stats3();
console.log("TWO-SEED", s2 && s2.grainCount === 2 ? "OK" : "FAIL", JSON.stringify(s2));

// 4. four lenses
const LENS = ["melt", "orient", "slice", "field"];
for (let v = 0; v < 4; v++) {
  await page.evaluate(k => window.__solidify.app.setView3d(k), v);
  await tick(3);
  await hideChrome();
  await page.screenshot({ path: `${OUT}/3d-${LENS[v]}.jpg`, type: "jpeg", quality: 85 });
  console.log("shot 3d-" + LENS[v]);
}
await page.evaluate(() => window.__solidify.app.setView3d(1));

// 5. orbit: real mouse drag must change the frame
const before = await page.screenshot({ type: "png" });
await page.mouse.move(600, 480);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(600 + i * 22, 480 - i * 8);
await page.mouse.up();
await tick(20);
const after = await page.screenshot({ type: "png" });
console.log("ORBIT", Buffer.compare(before, after) !== 0 ? "OK" : "FAIL");

// 6. tap-at-depth: quick click seeds near the view-facing mid-plane
const tap = await page.evaluate(() => {
  const S = window.__solidify;
  const s3 = S.sim3d();
  const g0 = s3.nextId;
  return { g0, n: s3.n };
});
await page.mouse.click(500, 400);
await tick(4);
const tapRes = await page.evaluate(() => {
  const s3 = window.__solidify.sim3d();
  return { g1: s3.nextId, last: s3.lastSeed };
});
const seeded = tapRes.g1 > tap.g0 && tapRes.last != null;
console.log("TAP-SEED", seeded ? "OK" : "FAIL", JSON.stringify(tapRes.last));

// 7. ViewCube TOP snap: camera elevation must ease to +max
await page.evaluate(() => window.__solidify.app.resetZoom());   // home view: TOP visible
await tick(40);
const vc = await page.evaluate(() => {
  const r = document.getElementById("viewcube").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const elBefore = await page.evaluate(() => window.__solidify.cam3().el);
// click the TOP face centre (home elevation puts it in the widget's upper quarter)
await page.mouse.click(vc.x + vc.w / 2, vc.y + vc.h * 0.26);
await tick(40);
const camAfter = await page.evaluate(() => window.__solidify.cam3());
console.log("VIEWCUBE TOP", camAfter.el > 1.2 ? "OK" : "FAIL",
  JSON.stringify({ elBefore: +elBefore.toFixed(2), elAfter: +camAfter.el.toFixed(2) }));
await hideChrome();
await page.screenshot({ path: `${OUT}/3d-top.jpg`, type: "jpeg", quality: 85 });

// 8. fps probes
const fpsAt = async label => {
  await page.evaluate(() => window.__solidify.app.setRun(true));
  await new Promise(r => setTimeout(r, 4000));
  const f = await page.evaluate(() => window.__solidify.fps());
  console.log("FPS", label, f.toFixed(1));
};
await fpsAt(`${grid}³`);
if (grid > 128) {
  await page.evaluate(() => window.__solidify.app.setGrid3(128));
  await page.waitForFunction("window.__solidify.app.getGrid3() === 128 && window.__solidify.sim3d()?.n === 128", { timeout: 30000 });
  await fpsAt("128³");
}

// 9. share round-trip
const link = await page.evaluate(() => window.__solidify.app.shareLink());
console.log("SHARE LINK len", link.length, link.includes("set=") ? "OK" : "FAIL");

// ---- v2.0 characterization-lab regressions ---------------------------------

// 10. all nine lenses produce distinct frames
const shots = [];
for (let v = 0; v < 9; v++) {
  await page.evaluate(k => window.__solidify.app.setView3d(k), v);
  await tick(3);
  shots.push(await page.screenshot({ type: "png" }));
}
let distinct = true;
for (let v = 1; v < 9; v++) if (Buffer.compare(shots[0], shots[v]) === 0) distinct = false;
console.log("NINE-LENSES", distinct ? "OK" : "FAIL");

// 11. tilted slice plane still accepts a tap (pick lands on the plane)
await page.evaluate(() => {
  const a = window.__solidify.app;
  a.setView3d(2); a.setSliceTilt(30); a.setSliceTurn(45); a.setSliceOff(0.5);
});
await tick(3);
const before11 = await page.evaluate(() => window.__solidify.sim3d().nextId);
await page.mouse.click(700, 475);
await tick(3);
const tap11 = await page.evaluate(() => ({
  id: window.__solidify.sim3d().nextId, last: window.__solidify.sim3d().lastSeed }));
console.log("SLICE-TAP", tap11.id > before11 && tap11.last ? "OK" : "FAIL", JSON.stringify(tap11.last));
await page.evaluate(() => {
  const a = window.__solidify.app;
  a.setSliceTilt(0); a.setSliceTurn(0); a.setView3d(1);
});

// 12. casting smoke: chill floor + rain + hard cooling — porosity census live
await page.evaluate(() => {
  const S = window.__solidify.app;
  S.setUndercool(0.62); S.resetArmed();
  S.setParams({ coolRate: 0.28, latent: 1.85, noiseAmp: 0.014 });
  S.chillWall("auto"); S.setRain(3); S.setRun(true);
});
await grow(6);
const cast = await stats3();
console.log("CAST-SMOKE", cast && cast.fracSolid > 0.001 && Number.isFinite(cast.poreFrac) && cast.grainCount > 20 ? "OK" : "FAIL",
  JSON.stringify({ fs: cast?.fracSolid?.toFixed(4), pores: cast?.poreFrac, grains: cast?.grainCount }));

// 13. stereology: a z-mid section of that casting cuts real grains
const stereo = await page.evaluate(async () => {
  const s3 = window.__solidify.sim3d();
  let r = null;
  for (let t = 0; t < 40 && !r; t++) {
    r = await s3.readStereo({ n: [0, 0, 1], c: 4 });
    if (!r) await s3.device.queue.onSubmittedWorkDone();
  }
  return { sections: r?.sections.length ?? 0 };
});
console.log("STEREOLOGY", stereo.sections >= 1 ? "OK" : "FAIL", JSON.stringify(stereo));

// 14. STL export: exact binary size, watertight-scale triangle count
const stl = await page.evaluate(async () => await window.__solidify.stl());
console.log("STL", stl && stl.bytes === 84 + 50 * stl.tris && stl.tris > 1000 ? "OK" : "FAIL", JSON.stringify(stl));

// 15. ViewCube Fusion zones: hovering the widget yields face AND corner dirs
await page.evaluate(() => window.__solidify.app.resetZoom());
await tick(30);
const vcr = await page.evaluate(() => {
  const r = document.getElementById("viewcube").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const kinds = new Set();
for (let i = 1; i <= 4; i++)
  for (let j = 1; j <= 4; j++) {
    await page.mouse.move(vcr.x + vcr.w * i / 5, vcr.y + vcr.h * j / 5);
    await tick(1);
    const d = await page.evaluate(() => window.__solidify.vc().hoverDir);
    if (d) kinds.add(d.filter(c => Math.abs(c) > 0.01).length);
  }
console.log("VC-ZONES", kinds.has(1) && kinds.has(3) ? "OK" : "FAIL", JSON.stringify([...kinds]));

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 6) : "none");
await browser.close();
console.log("done");
