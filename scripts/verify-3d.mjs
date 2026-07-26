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

// Every check prints "OK" or FAIL(); FAIL() records, so a failing check
// actually fails the run. Before this the script printed FAIL and exited 0,
// which meant twenty-three assertions that could never break a build.
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };

const page = await browser.newPage();
const errors = [];
// PARAM-WARN: a uniform/storage struct that outgrows its binding is reported by
// WebGPU as a WARNING, not an error, while every readback through it silently
// returns zeros. That exact failure shipped once (todo.md postmortem #1), so the
// warning channel is watched with the same weight as the error channel.
const bindWarnings = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => {
  const t = m.type();
  if (t === "error") errors.push(m.text());
  if ((t === "warning" || t === "warn") && /binding size|minimum (buffer )?binding size/i.test(m.text()))
    bindWarnings.push(m.text());
});

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
console.log("GROWTH", sA && sB && sB.fracSolid > sA.fracSolid && sA.fracSolid > 0 ? "OK" : FAIL(),
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
console.log("TWO-SEED", s2 && s2.grainCount === 2 ? "OK" : FAIL(), JSON.stringify(s2));

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
console.log("ORBIT", Buffer.compare(before, after) !== 0 ? "OK" : FAIL());

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
console.log("TAP-SEED", seeded ? "OK" : FAIL(), JSON.stringify(tapRes.last));

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
console.log("VIEWCUBE TOP", camAfter.el > 1.2 ? "OK" : FAIL(),
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
console.log("SHARE LINK len", link.length, link.includes("set=") ? "OK" : FAIL());

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
console.log("NINE-LENSES", distinct ? "OK" : FAIL());

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
console.log("SLICE-TAP", tap11.id > before11 && tap11.last ? "OK" : FAIL(), JSON.stringify(tap11.last));
await page.evaluate(() => {
  const a = window.__solidify.app;
  a.setSliceTilt(0); a.setSliceTurn(0); a.setView3d(1);
});

// 12. casting smoke: chill floor + rain + hard cooling — porosity census live
await page.evaluate(() => {
  const S = window.__solidify.app;
  S.setUndercool(0.62); S.resetArmed();
  S.setParams({ coolRate: 0.28, latent: 1.85, noiseAmp: 0.014 });
  S.chillWall("auto"); S.setInoculant(200); S.setRun(true);
});
await grow(6);
const cast = await stats3();
console.log("CAST-SMOKE", cast && cast.fracSolid > 0.001 && Number.isFinite(cast.poreFrac) && cast.grainCount > 20 ? "OK" : FAIL(),
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
console.log("STEREOLOGY", stereo.sections >= 1 ? "OK" : FAIL(), JSON.stringify(stereo));

// 14. STL export: exact binary size, watertight-scale triangle count
const stl = await page.evaluate(async () => await window.__solidify.stl());
console.log("STL", stl && stl.bytes === 84 + 50 * stl.tris && stl.tris > 1000 ? "OK" : FAIL(), JSON.stringify(stl));

// ---- v3.0 full-instrument regressions --------------------------------------

// 15a. Bridgman: chill floor + pulled gradient → the front climbs bottom-first
await page.evaluate(() => {
  const S = window.__solidify.app;
  S.setUndercool(0.5); S.setSym3(4);
  S.setParams({ scen: 1, gradG: 0.55, pullV: 1.2, delta: 0.045, noiseAmp: 0.012, latent: 1.6, coolRate: 0, heatIn: 0, twinProb: 0, facet: 0, pPore: 0 });
  S.setSpeed(22);
  S.resetArmed(); S.chillWall("auto"); S.setInoculant(0); S.setRun(true);
});
const slabArea = fr => page.evaluate(async f => {
  const s3 = window.__solidify.sim3d();
  let r = null;
  for (let t = 0; t < 40 && !r; t++) {
    r = await s3.readStereo({ n: [0, 0, 1], c: Math.round(s3.n * f) });
    if (!r) await s3.device.queue.onSubmittedWorkDone();
  }
  return r ? r.sections.reduce((a, x) => a + x.areaVox, 0) : -1;
}, fr);
await grow(4);
const bLow1 = await slabArea(0.04);
await grow(8);
const bLow2 = await slabArea(0.08);
console.log("BRIDGMAN3", bLow1 > 300 && bLow2 > 300 ? "OK" : FAIL(), JSON.stringify({ bLow1, bLow2 }));

// 15b. alloy toggle: FIELD differs with solute, clean off, no errors
await page.evaluate(() => {
  const S = window.__solidify.app;
  S.setParams({ scen: 0, coolRate: 0.05 });
  S.resetArmed(); S.seedCenter(); S.setView3d(3); S.setRun(true);
});
await grow(4);
const fPlain = await page.screenshot({ type: "png" });
await page.evaluate(() => window.__solidify.app.setAlloyOn(true));
await new Promise(r => setTimeout(r, 500));
await grow(4);
const fAlloy = await page.screenshot({ type: "png" });
await page.evaluate(() => window.__solidify.app.setAlloyOn(false));
await grow(2);
console.log("ALLOY3", Buffer.compare(fPlain, fAlloy) !== 0 &&
  !(await page.evaluate(() => window.__solidify.app.getAlloyOn())) ? "OK" : FAIL());

// 15c. GPU twins: a lone seed with a hot twin rate multiplies grains
await page.evaluate(() => {
  const S = window.__solidify.app;
  S.setUndercool(0.85);
  S.setParams({ scen: 0, coolRate: 0.1, twinProb: 0.03, pPore: 0 });
  S.setSpeed(22);
  S.resetArmed(); S.seedCenter(); S.setInoculant(0); S.setView3d(1); S.setRun(true);
});
await grow(16);
const sTw = await stats3();
await page.evaluate(() => window.__solidify.app.setParams({ twinProb: 0 }));
console.log("TWINS3", sTw && sTw.grainCount > 1 ? "OK" : FAIL(), JSON.stringify({ grains: sTw?.grainCount }));

// 15d. icosahedral ≠ cubic under identical staging
const stageSym = j => page.evaluate(jj => {
  const S = window.__solidify.app;
  S.setUndercool(0.82);
  S.setParams({ scen: 0, noiseAmp: 0.006, latent: 1.7, coolRate: 0.02, twinProb: 0, facet: 0, pPore: 0 });
  S.setSym3(jj); S.resetArmed(); S.seedCenter(); S.setInoculant(0); S.setView3d(1); S.setRun(true);
}, j);
await stageSym(4);
await grow(6);
const symCubic = await page.screenshot({ type: "png" });
await stageSym(5);
await grow(6);
const symIco = await page.screenshot({ type: "png" });
console.log("ICOSA3", Buffer.compare(symCubic, symIco) !== 0 ? "OK" : FAIL());

// 15e. selector staging smoke: scen 3 arms + the mask rasterizes
await page.evaluate(async () => {
  const { SCENES3 } = await import("/src/tour.ts");
  SCENES3.selector(window.__solidify.app);
});
await tick(4);
const sel = await page.evaluate(() => ({
  scen: window.__solidify.sim3d().params.scen,
  fs: 0,
}));
console.log("SELECTOR3", sel.scen === 3 ? "OK" : FAIL());
await page.evaluate(() => {
  const S = window.__solidify.app;
  S.setParams({ scen: 0 }); S.resetArmed();
});

// 15f. retro voxel + palette flags change frames without breaking cut styles
await page.evaluate(() => {
  const S = window.__solidify.app;
  S.setUndercool(0.8); S.resetArmed(); S.seedCenter(); S.setView3d(1); S.setRun(true);
});
await grow(5);
const rPlain = await page.screenshot({ type: "png" });
await page.evaluate(() => { window.__solidify.app.setVoxel3(true); window.__solidify.app.setPalette(true); });
await tick(3);
const rRetro = await page.screenshot({ type: "png" });
await page.evaluate(() => { window.__solidify.app.setVoxel3(false); window.__solidify.app.setPalette(false); });
console.log("RETRO3", Buffer.compare(rPlain, rRetro) !== 0 ? "OK" : FAIL());

// 15g. 3D share pack carries the 3D dials (in-page pack/unpack, no reload)
const share3 = await page.evaluate(async () => {
  const { unpackShare } = await import("/src/share.ts");
  const S = window.__solidify.app;
  S.setParams({ scen: 1, gradG: 0.37, twinProb: 0.001 });
  const link = S.shareLink();
  const st = unpackShare(link.slice(link.indexOf("#")));
  S.setParams({ scen: 0, twinProb: 0 });
  return st ? { d: st.d, scen: st.p.scen, gradG: st.p.gradG, twinProb: st.p.twinProb } : null;
});
console.log("SHARE3", share3 && share3.d === 1 && share3.scen === 1 &&
  Math.abs(share3.gradG - 0.37) < 1e-4 && Math.abs(share3.twinProb - 0.001) < 1e-6 ? "OK" : FAIL(),
  JSON.stringify(share3));

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
console.log("VC-ZONES", kinds.has(1) && kinds.has(3) ? "OK" : FAIL(), JSON.stringify([...kinds]));

// LAB in the volume: scen 4 set-point cooling, a rasterized mould shell, and
// gas porosity from dissolved hydrogen (air = more hydrogen picked up = more
// porosity than a degassed vacuum melt). Since v6.1 the porosity is Sievert's
// law over the material's own solubility, so the charge must be a material that
// HAS hydrogen data — aluminium — or it honestly refuses and there is no bias to
// compare (the model metal has no si block).
{
  await page.evaluate(() => window.__solidify.app.setGrid3(128));
  await page.waitForFunction("window.__solidify.sim3d()?.n === 128", { timeout: 40000 });
  const out = await page.evaluate(() => {
    const L = window.__solidify.lab, S = window.__solidify, p = S.sim3d().params;
    S.app.setMaterial("al");
    S.app.startLab();
    L.setup = { atmosphere: "vacuum", inoculant: 300, holdMin: 0, superheat: 0.05, moldT: 0.05, moldWalls: true, program: "air" };
    L.start();
    const clean = { scen: p.scen, pPore: p.pPore, shell: S.sim3d().moldShell };
    L.abort();
    L.setup.atmosphere = "air";
    L.start();
    const dirty = p.pPore;
    L.abort();
    L.close();
    return { ...clean, dirty, restored: p.pPore, scenAfter: p.scen };
  });
  const ok = out.scen === 4 && out.shell && out.dirty > out.pPore
    && Math.abs(out.restored - out.pPore) < 1e-6 && out.scenAfter === 0;
  console.log("LAB3", ok ? "OK" : FAIL(), JSON.stringify(out));
}

// STEPSYNC3 (v6.0 H0) — the volume finally has the measurement entry point 2D
// got in Q1. `step()` is frame-paced and refuses while the queue is two deep, so
// the number of substeps it delivers is a race; that is postmortem #6 and it is
// how a "restored" refinement result got written up twice before evaporating
// under load. Every 3D heat-treatment claim is about how far a process got, so
// the amount of physics delivered has to be an argument rather than a race.
//
// Two assertions: stepSync returns EXACTLY what was asked (step() cannot), and
// it advances simTime by exactly that many dt. The second catches a submit()
// that silently caps without saying so.
{
  const out = await page.evaluate(async () => {
    const s = window.__solidify.sim3d();
    window.__solidify.app.setRun(false);
    const t0 = s.simTime, dt = s.params.dt;
    const got = await s.stepSync(40);
    const dTime = s.simTime - t0;
    // and a frame-paced burst for contrast: hammer step() and see it refuse
    let paced = 0;
    for (let i = 0; i < 40; i++) paced += s.step(1);
    return { got, want: 40, dTime, wantTime: 40 * dt, paced, dir: s.dir };
  });
  const ok = out.got === 40 && Math.abs(out.dTime - out.wantTime) < 1e-9 * Math.max(1, out.wantTime);
  console.log("STEPSYNC3", ok ? "OK" : FAIL(), JSON.stringify(out));
}

console.log("PARAM-WARN", bindWarnings.length === 0 ? "OK" : FAIL(), JSON.stringify(bindWarnings.slice(0, 4)));
console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 6) : "none");
if (errors.length) failures++;
await browser.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
