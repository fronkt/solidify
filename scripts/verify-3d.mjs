// Verifies the TRUE-3D mode end-to-end on real headless WebGPU:
// mode entry, growth, grain claiming, all four lenses, orbit + ViewCube snap,
// tap-at-depth seeding, and fps probes at both grid sizes.
//   node scripts/verify-3d.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

// STEP3 (Phase D M): the shared contract numbers, loaded from the module that
// ships them rather than retyped here — a test that re-implements the thing
// it is testing proves nothing.
const viteServer = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const SIM3 = await viteServer.ssrLoadModule("/src/sim3d.ts");
const { moldWallThickness, stepSectionBounds } = SIM3;
const SH3 = await viteServer.ssrLoadModule("/src/shaders3d.ts");
const { PORE_ID } = SH3;

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

// 15a-ny. NY3 (Phase D N0/N3) — the Niyama record against a DISCRETE recount
// of its own definition. In this racing-Bridgman state (the columns outrun the
// pulled isotherm — BRIDGMAN3's own claim) the front freezes into shallow
// gradients, so no locked-isotherm analytic applies; what CAN be checked
// exactly is that the record IS what it claims: for voxels frozen in the last
// short burst, ny must equal |∇T|/√(−lapT − envRate) recomputed on the CPU
// from the same paused state (coolRate = heatIn = 0 here, envRate =
// −gradG·pullV by construction). A missing scenario term, a wrong √, a wrong
// stencil scale or a dropped envRate all blow the median ratio by orders.
// Also gated: seed voxels carry the −1 sentinel (never a fabricated benign
// number), and the stats pass risk/measured counters agree with the same
// readback counted on the CPU.
{
  // a short, slow burst first: freshly-frozen voxels then carry at most a few
  // dozen substeps of post-freeze field drift between the record and the read
  await page.evaluate(() => { window.__solidify.app.setSpeed(2); });
  await grow(2);
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    const s3 = S.sim3d();
    S.app.setRun(false);
    await s3.device.queue.onSubmittedWorkDone();
    const age = await s3.readAgeVolume();
    const st8 = await s3.readStateVolume();
    let st = null;
    for (let t = 0; t < 40 && !st; t++) { st = await s3.readStats(); if (!st) await s3.device.queue.onSubmittedWorkDone(); }
    if (!age || !st8 || !st) return { ok: false, why: "readback failed" };
    const n = s3.n, p = s3.params;
    const dx = p.dx, inv2dx = 1 / (2 * dx);
    const envRate = -(p.gradG * p.pullV);
    const idx = (x, y, z) => (z * n + y) * n + x;
    // the freshest frame stamp on record
    let tMax = 0;
    for (let i = 0; i < age.time.length; i++) if (age.ny[i] > 0 && age.time[i] > tMax) tMax = age.time[i];
    const ratios = [];
    let sentinels = 0, measured = 0, risk = 0;
    for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = idx(x, y, z);
      if (st8.phi[i] <= 0.5) continue;
      const ny = age.ny[i];
      if (ny < 0) sentinels++;
      if (ny > 0) {
        measured++;
        if (ny < p.nyCrit) risk++;
        if (age.time[i] < tMax) continue;      // only the freshest burst
        const T = st8.T;
        const gx = (T[idx(x + 1, y, z)] - T[idx(x - 1, y, z)]) * inv2dx;
        const gy = (T[idx(x, y + 1, z)] - T[idx(x, y - 1, z)]) * inv2dx;
        const gz = (T[idx(x, y, z + 1)] - T[idx(x, y, z - 1)]) * inv2dx;
        const lap = (T[idx(x + 1, y, z)] + T[idx(x - 1, y, z)] + T[idx(x, y + 1, z)]
          + T[idx(x, y - 1, z)] + T[idx(x, y, z + 1)] + T[idx(x, y, z - 1)] - 6 * T[i]) / (dx * dx);
        const tdot = lap + envRate;
        if (tdot >= 0) continue;               // recount says warming — skip
        const nyCpu = Math.hypot(gx, gy, gz) / Math.sqrt(Math.max(-tdot, 1e-6));
        if (nyCpu > 0) ratios.push(ny / nyCpu);
      }
    }
    ratios.sort((a, b) => a - b);
    const medianRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : NaN;
    return {
      ok: true, medianRatio, fresh: ratios.length, sentinels,
      cpuRisk: measured > 0 ? risk / measured : null,
      statRiskFrac: st.nyRiskFrac, nyCrit: p.nyCrit,
    };
  });
  let ok = out.ok && out.fresh > 50 && out.sentinels > 0;
  if (ok) {
    // the post-freeze drift between record and readback is a few substeps of
    // conduction; the band is generous for that and still fails a missing term
    // (pre-fix, the lapT-only denominator sat ORDERS off this ratio)
    ok = out.medianRatio > 0.6 && out.medianRatio < 1.7;
    ok = ok && out.statRiskFrac != null && out.cpuRisk != null
      && Math.abs(out.statRiskFrac - out.cpuRisk) < 0.02;
  }
  console.log("NY3", ok ? "OK" : FAIL(), JSON.stringify({
    medianRatio: +(+out.medianRatio).toFixed(3), fresh: out.fresh,
    sentinels: out.sentinels, statRisk: out.statRiskFrac, cpuRisk: out.cpuRisk,
  }));
  await page.evaluate(() => { window.__solidify.app.setSpeed(22); window.__solidify.app.setRun(true); });
}

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

// 15b-k. KPART3 (Phase D P) — partition k reaches the volume. Two claims: a
// material swap in 3D lands the material's own alloy constants in the solver
// (they were never mirrored — the previous charge's chemistry stayed behind),
// and the constant does real work: with the alloy field on, the solid front
// rejects solute, so max(c) must rise above the far-field c0. The dial itself
// shares p() with 2D, so the param path is the same object either way.
{
  const kp = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setMaterial("al");
    const s3 = S.sim3d();
    const landed = {
      kPart: s3.params.kPart, c0: s3.params.c0, mLiq: s3.params.mLiq, dSol: s3.params.dSol,
    };
    S.app.setParams({ scen: 0, coolRate: 0.05, kPart: landed.kPart });
    S.app.resetArmed(); S.app.setAlloyOn(true); S.app.seedCenter(); S.app.setRun(true);
    return landed;
  });
  await grow(5);
  const rej = await page.evaluate(async () => {
    const s3 = window.__solidify.sim3d();
    const c = await s3.readSoluteVolume();
    if (!c) return null;
    let mx = 0;
    for (let i = 0; i < c.length; i++) if (c[i] > mx) mx = c[i];
    return { cMax: mx, c0: s3.params.c0 };
  });
  // al ships kPart 0.14 / c0 0.3 / mLiq 0.5 / dSol 0.9 (materials.ts params —
  // the model constants, not the si table's thermodynamic k)
  const ok = kp.kPart === 0.14 && kp.c0 === 0.3 && kp.mLiq === 0.5 && kp.dSol === 0.9
    && rej && rej.cMax > rej.c0 * 1.15;
  console.log("KPART3", ok ? "OK" : FAIL(), JSON.stringify({ ...kp, cMax: rej && +rej.cMax.toFixed(3) }));
  await page.evaluate(() => {
    const S = window.__solidify.app;
    S.setAlloyOn(false); S.setMaterial("generic"); S.setRun(false);
  });
  await grow(1);
}

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
    L.setup = { atmosphere: "vacuum", inoculant: 300, holdMin: 0, superheat: 0.05, moldT: 0.05, moldWalls: true, mold: "shell", program: "air", specMPa: 0 };
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

// 15c. STEP3 (Phase D M) — the step block is the hero: one pour, four section
// thicknesses in the SAME cavity. Four independent checks, calibrated against
// a real furnace-programme pour before being fixed here (a "quench" programme
// couples the melt to its set-point so strongly it swamps the geometric
// wall-conduction effect between sections — furnace's weak coupling is what
// actually lets thickness show up in the freeze record):
// (1) rasterization is EXACT — the geometry is deterministic integer voxel
// math, so an independent classification from the shared contract functions
// (stepSectionBounds — NOT the shipped rasterizer, which is private) must
// match a real GPU mask readback voxel-for-voxel;
// (2) readRegion's per-grain GPU counts agree with an independent CPU
// recount over the identical bbox from raw grain/state volumes, same noise
// floor on both sides;
// (3) the thinnest section's last freeze event predates the thickest's
// (freeze-time ordering via the age record, the same field NY3 reads);
// (4) the thinnest section's regional d̄ is smaller than the thickest's — the
// teaching claim. (3) and (4) compare ENDPOINTS, not adjacent sections: the
// two middle sections carry small grain counts and can tie or invert against
// each other on pure sampling noise, but thinnest-vs-thickest held clean in
// calibration (0.295 vs 0.495 sim-time; d̄ 20.1 vs 22.6 vox) and is the actual
// claim a step-block casting makes.
{
  await page.evaluate(() => window.__solidify.app.setMode("3d"));
  await page.waitForFunction("window.__solidify.mode() === '3d'", { timeout: 30000 });
  await page.evaluate(() => window.__solidify.app.setGrid3(128));
  await page.waitForFunction("window.__solidify.sim3d()?.n === 128", { timeout: 40000 });
  const n = 128, t = moldWallThickness(n), secs = stepSectionBounds(n, t);

  await page.evaluate(() => {
    const S = window.__solidify;
    S.app.setMaterial("al");
    S.app.startLab();
    S.lab.setup = {
      atmosphere: "vacuum", inoculant: 500, holdMin: 0, superheat: 0.08,
      moldT: 0.05, moldWalls: true, mold: "step", program: "furnace", specMPa: 0,
    };
    S.app.setSpeed(40);
    S.lab.start();
  });
  // one tick to force submit()'s lazy rasterization before reading the mask
  await tick(20);

  const rast = await page.evaluate(async (secsArg, tArg, nArg) => {
    const s3 = window.__solidify.sim3d();
    const mask = await s3.readMaskVolume();
    if (!mask) return { ok: false, why: "mask readback failed" };
    const sectionAt = x => secsArg.find(s => x >= s.xlo && x < s.xhi) ?? secsArg[secsArg.length - 1];
    let mismatches = 0, expectWall = 0;
    for (let z = 0; z < nArg; z++) for (let y = 0; y < nArg; y++) for (let x = 0; x < nArg; x++) {
      const sideWall = y < tArg || y >= nArg - tArg || x < tArg || x >= nArg - tArg;
      const wantWall = (sideWall || z < sectionAt(x).floorZ) ? 1 : 0;
      const i = (z * nArg + y) * nArg + x;
      if (wantWall) expectWall++;
      if (wantWall !== mask[i]) mismatches++;
    }
    return { ok: true, mismatches, expectWall, totalVox: nArg * nArg * nArg };
  }, secs, t, n);
  console.log("STEP3-RASTER", rast.ok && rast.mismatches === 0 ? "OK" : FAIL(), JSON.stringify(rast));

  // run to (near-)completion — the same fracSolidOpen the lab's own card
  // trigger and the N4 fix use, polled rather than a guessed tick count
  let fracSolidOpen = 0;
  for (let i = 0; i < 150 && fracSolidOpen < 0.99; i++) {
    await tick(20);
    const s = await stats3();
    fracSolidOpen = s ? s.fracSolidOpen : fracSolidOpen;
  }
  console.log("STEP3-FINISH", fracSolidOpen >= 0.99 ? "OK" : FAIL(), JSON.stringify({ fracSolidOpen }));

  const out = await page.evaluate(async (secsArg, nArg) => {
    const s3 = window.__solidify.sim3d();
    let age = null, grn = null, st = null;
    for (let i = 0; i < 40 && !(age && grn && st); i++) {
      age = age ?? await s3.readAgeVolume();
      grn = grn ?? await s3.readGrainVolume();
      st = st ?? await s3.readStateVolume();
      if (!age || !grn || !st) await s3.device.queue.onSubmittedWorkDone();
    }
    if (!age || !grn || !st) return { ok: false, why: "readback failed" };
    const idx = (x, y, z) => (z * nArg + y) * nArg + x;
    const perSection = secsArg.map(s => {
      let maxFreeze = 0;
      const grains = new Map();
      for (let z = s.floorZ; z < nArg; z++) for (let y = s.ylo; y < s.yhi; y++) for (let x = s.xlo; x < s.xhi; x++) {
        const i = idx(x, y, z);
        if (st.phi[i] > 0.5) {
          const id = grn[i];
          if (id > 0) grains.set(id, (grains.get(id) ?? 0) + 1);
          if (age.time[i] > maxFreeze) maxFreeze = age.time[i];
        }
      }
      // the same >=4-voxel noise floor readRegion/readStereo already use
      const real = [...grains.entries()].filter(([, v]) => v >= 4);
      const volSum = real.reduce((a, [, v]) => a + v, 0);
      const dbarVox = real.length ? Math.cbrt((6 * (volSum / real.length)) / Math.PI) : 0;
      return { heightVox: s.heightVox, maxFreeze, grainCount: real.length, dbarVox, grains: real };
    });
    // readRegion vs an independent CPU recount, thinnest section: same bbox,
    // same floor, so a mismatch means the GPU pass and this recount disagree
    // about the SAME data, not about tuning
    const s0 = secsArg[0];
    const reg = await s3.readRegion([s0.xlo, s0.ylo, s0.floorZ], [s0.xhi, s0.yhi, nArg]);
    const cpu = new Map(perSection[0].grains);
    let regionOk = !!reg;
    if (reg) {
      if (reg.grains.length !== cpu.size) regionOk = false;
      for (const g of reg.grains) if (cpu.get(g.id) !== g.voxCount) regionOk = false;
    }
    return {
      ok: true, regionOk, regionCount: reg ? reg.grains.length : null, cpuCount: cpu.size,
      perSection: perSection.map(({ grains, ...rest }) => rest),
    };
  }, secs, n);

  const ps = out.perSection ?? [];
  const orderOk = out.ok && ps.length === 4 && ps[0].maxFreeze > 0 && ps[0].maxFreeze < ps[3].maxFreeze;
  const dbarOk = out.ok && ps.every(s => s.grainCount >= 3) && ps[0].dbarVox < ps[3].dbarVox;
  console.log("STEP3-ORDER", orderOk ? "OK" : FAIL(), JSON.stringify(ps.map(s => [s.heightVox, s.maxFreeze])));
  console.log("STEP3-DBAR", dbarOk ? "OK" : FAIL(), JSON.stringify(ps.map(s => [s.heightVox, s.grainCount, s.dbarVox])));
  console.log("STEP3-REGION", out.ok && out.regionOk ? "OK" : FAIL(),
    JSON.stringify({ regionCount: out.regionCount, cpuCount: out.cpuCount }));

  await page.evaluate(() => { window.__solidify.app.setRun(false); window.__solidify.lab.close(); });
}

// 15d. FEED-MASK (Phase D M) — two sealed chambers split by an internal
// wall, one wired to the riser and one not. Pre-fix, FEED3D_WGSL read a wall
// voxel's φ as "liquid" (it's pinned to 0 by the main pass) and propagated
// fed status across it with no exception, so "fed" could percolate through
// the dividing wall. Post-fix the wall cell is unconditionally re-zeroed
// every pass, so it can never be read back as fed by a neighbour. The gate
// is the differential this produces: the sealed chamber must show real
// porosity, the riser-connected one must not — calibrated at n=96 (0 % vs
// 3.4 % observed), with pPore deliberately amplified (0.9, unphysical) to
// force a clear signal from a short run rather than measure a realistic
// fraction. Built via a direct writeMask(m, 3) call reusing the pigtail's
// own kind number (so submit()'s scen===3 dispatch sees maskKind already
// matches and never re-rasterizes over it) — the same public seam a future
// CAD-import feature would call, exercised here by an ad-hoc caller.
{
  await page.evaluate(() => window.__solidify.app.setGrid3(96));
  await page.waitForFunction("window.__solidify.sim3d()?.n === 96", { timeout: 40000 });
  const setup = await page.evaluate(() => {
    const S = window.__solidify;
    S.app.setMaterial("al");
    const s3 = S.sim3d();
    const n = s3.n, t = 4;
    const m = new Uint8Array(n * n * n).fill(1);
    const open = (x0, x1, y0, y1, z0, z1) => {
      for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++)
        m[(z * n + y) * n + x] = 0;
    };
    const w = Math.floor((n - 3 * t) / 2);
    const aX = [t, t + w], bX = [aX[1] + t, aX[1] + t + w];
    const capGap = 8;
    open(aX[0], aX[1], t, n - t, t, n);             // chamber A: reaches z=n-1 — riser-connected
    open(bX[0], bX[1], t, n - t, t, n - capGap);     // chamber B: capped short of the top — sealed
    s3.writeMask(m, 3);
    S.app.setParams({ scen: 3, moldT: 0.05, coolRate: 0.15, heatIn: 0, pPore: 0.9, twinProb: 0, tFar: -0.6 });
    S.app.resetArmed();
    S.app.clearMelt(-0.05);
    const cy = n / 2;
    s3.addSeed3D((aX[0] + aX[1]) / 2, cy, t + 4, 4);
    s3.addSeed3D((bX[0] + bX[1]) / 2, cy, t + 4, 4);
    S.app.setRun(true);
    return { n, t, aX, bX, capGap };
  });
  for (let i = 0; i < 20; i++) await tick(30);

  const res = await page.evaluate(async (s, poreId) => {
    const s3 = window.__solidify.sim3d();
    const mask = await s3.readMaskVolume();
    const grn = await s3.readGrainVolume();
    if (!mask || !grn) return { ok: false };
    const n = s.n;
    // the mask must still be exactly what was written — proof submit()'s
    // dispatch never clobbered it because maskKind already matched scen 3
    const wantWall = (x, y, z) => {
      const sideWall = y < s.t || y >= n - s.t || x < s.t || x >= n - s.t;
      if (sideWall) return 1;
      const inA = x >= s.aX[0] && x < s.aX[1];
      const inB = x >= s.bX[0] && x < s.bX[1];
      if (inA) return z < s.t ? 1 : 0;
      if (inB) return (z < s.t || z >= n - s.capGap) ? 1 : 0;
      return 1;
    };
    let maskMismatch = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (mask[(z * n + y) * n + x] !== wantWall(x, y, z)) maskMismatch++;
    }
    const frac = (x0, x1) => {
      let pore = 0, total = 0;
      for (let z = s.t; z < n; z++) for (let y = s.t; y < n - s.t; y++) for (let x = x0; x < x1; x++) {
        const id = grn[(z * n + y) * n + x];
        if (id === 0) continue;
        total++;
        if (id === poreId) pore++;
      }
      return { pore, total, frac: total > 0 ? pore / total : 0 };
    };
    return { ok: true, maskMismatch, poreA: frac(s.aX[0], s.aX[1]), poreB: frac(s.bX[0], s.bX[1]) };
  }, setup, PORE_ID);

  const ok = res.ok && res.maskMismatch === 0 && res.poreA.frac < 0.01 && res.poreB.frac > 0.02
    && res.poreB.frac > res.poreA.frac * 5;
  console.log("FEED-MASK", ok ? "OK" : FAIL(), JSON.stringify(res));
  await page.evaluate(() => { window.__solidify.app.setRun(false); window.__solidify.app.setParams({ scen: 0 }); });
}

console.log("PARAM-WARN", bindWarnings.length === 0 ? "OK" : FAIL(), JSON.stringify(bindWarnings.slice(0, 4)));
console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 6) : "none");
if (errors.length) failures++;
await browser.close();
await viteServer.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
