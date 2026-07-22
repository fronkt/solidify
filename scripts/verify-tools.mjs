// Verifies the v1.8 tool batch: faceted growth, share-link round-trip,
// analysis-panel enlargement, and the specimen-tilt view.
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1400, height: 950 },
});

// PARAM-WARN: a uniform/storage struct that outgrows its binding surfaces as a
// WebGPU WARNING while every readback through it silently returns zeros — the
// shape of todo.md postmortem #1. Watched on every page this suite opens.
const bindWarnings = [];

async function boot(page, hash = "") {
  page.on("console", m => {
    const t = m.type();
    if ((t === "warning" || t === "warn") && /binding size|minimum (buffer )?binding size/i.test(m.text()))
      bindWarnings.push(m.text());
  });
  await page.goto("http://localhost:5199/app/" + hash, { waitUntil: "networkidle0", timeout: 30000 });
  try { await page.waitForFunction("!!window.__solidify", { timeout: 15000 }); }
  catch { await page.reload({ waitUntil: "networkidle0" }); await page.waitForFunction("!!window.__solidify", { timeout: 20000 }); }
  await new Promise(r => setTimeout(r, 1000));
}
const grow = async (page, k) => { for (let i = 0; i < k; i++) { await page.evaluate(() => window.__solidify.tick(60)); await new Promise(r => setTimeout(r, 80)); } };
const hideChrome = p => p.evaluate(() => { for (const el of document.getElementById("app").children) if (el.tagName !== "CANVAS") el.style.display = "none"; });

// 1. faceted growth: hexagonal facets at gentle undercool
{
  const page = await browser.newPage();
  await boot(page);
  await page.evaluate(() => {
    const a = window.__solidify.app;
    a.setParams({ scen: 0, heatIn: 0, facet: 1, delta: 0.05, aniMode: 6, noiseAmp: 0.004, latent: 1.6, coolRate: 0, alloyOn: 0 });
    a.setInoculant(0); a.clearMelt(0.65); a.seedCenter(); a.setView(0); a.setRun(true);
  });
  await grow(page, 30);
  await hideChrome(page);
  await page.screenshot({ path: `${OUT}/tool-facet.jpg`, type: "jpeg", quality: 85, clip: { x: 325, y: 125, width: 750, height: 750 } });
  console.log("shot tool-facet");
  await page.close();
}

// 2. share link: build on one page, open on a fresh one, compare state
{
  const page = await browser.newPage();
  await boot(page);
  const link = await page.evaluate(() => {
    const a = window.__solidify.app;
    a.setMaterial("mg"); a.setUndercool(0.83);
    a.setParams({ delta: 0.061, noiseAmp: 0.017, facet: 1 });
    a.setView(4);
    return a.shareLink();
  });
  console.log("LINK len", link.length);
  await page.close();
  const p2 = await browser.newPage();
  await boot(p2, link.slice(link.indexOf("#")));
  const got = await p2.evaluate(() => {
    const a = window.__solidify.app;
    const p = a.simParams();
    return { m: a.getMaterial(), u: +a.getUndercool().toFixed(2), v: a.getView(),
      delta: +p.delta.toFixed(3), noise: +p.noiseAmp.toFixed(3), facet: p.facet, ani: p.aniMode };
  });
  const ok = got.m === "mg" && got.u === 0.83 && got.v === 4 && got.delta === 0.061 && got.facet === 1;
  console.log("SHARE ROUND-TRIP", ok ? "OK" : "MISMATCH", JSON.stringify(got));
  await p2.close();
}

// 3. panel enlarge: texture rose big viewer
{
  const page = await browser.newPage();
  await boot(page);
  await page.evaluate(() => {
    const S = window.__solidify;
    S.app.setParams({ scen: 0, heatIn: 0, facet: 0, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.5, coolRate: 0.12, alloyOn: 0 });
    S.app.clearMelt(0.85); S.app.setInoculant(700); S.app.setView(1); S.app.setRun(true);
    S.analyze.setTextureOn(true);
  });
  await grow(page, 14);
  const state = await page.evaluate(() => {
    document.querySelector("#texPanel .zoomBtn").click();
    return { big: !!document.querySelector("#app > div[style*='fixed']") };
  });
  await grow(page, 4);
  console.log("ENLARGE opened:", JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/tool-bigrose.png` });
  await page.close();
}

// 4. specimen tilt on a grown dendrite
{
  const page = await browser.newPage();
  await boot(page);
  await grow(page, 22);
  await page.evaluate(() => { window.__solidify.app.setTilt(true); window.__solidify.app.setView(1); });
  await grow(page, 3);
  await hideChrome(page);
  await page.screenshot({ path: `${OUT}/tool-tilt.jpg`, type: "jpeg", quality: 85 });
  console.log("shot tool-tilt");
  await page.close();
}

// 5. transport speed multiplier: the button cycles ×1 → ×2 → ×4 and the melt
//    really advances faster (sublinear at ×4 is correct — heavier frames trip
//    the >=2-fence backpressure guard more often)
{
  const page = await browser.newPage();
  await boot(page);
  const cyc = await page.evaluate(() => {
    const a = window.__solidify.app;
    const btn = [...document.querySelectorAll("#transport button")].find(b => /^×/.test(b.textContent));
    const seen = [];
    for (let i = 0; i < 4; i++) { seen.push(a.getSpeedMult() + btn.textContent); btn.click(); }
    return seen.join(",");
  });
  // the multiplier's whole job is to scale the substeps the frame asks the
  // solver for. Record that directly — measuring elapsed sim-time instead
  // would be at the mercy of the fence-backpressure guard skipping frames.
  const asked = await page.evaluate(() => {
    const a = window.__solidify.app, S = window.__solidify, s = S.sim();
    a.setParams({ scen: 0, heatIn: 0, coolRate: 0, alloyOn: 0 });
    a.setInoculant(0); a.clearMelt(0.7); a.setSpeed(10); a.setRun(true);
    const real = s.step.bind(s);
    let seen = [];
    s.step = (n) => { seen.push(n); return real(n); };
    const out = {};
    for (const m of [1, 2, 4]) {
      while (a.getSpeedMult() !== m) a.cycleSpeedMult();
      seen = [];
      S.tick(1);
      out[m] = seen[0] ?? null;
    }
    s.step = real;
    return out;
  });
  const ok = cyc === "1×1,2×2,4×4,1×1" && asked["1"] === 10 && asked["2"] === 20 && asked["4"] === 40;
  console.log("SPEEDMULT", ok ? "OK" : "FAIL", JSON.stringify({ cyc, asked }));
  if (!ok) process.exitCode = 1;
  await page.close();
}

// 6. seeds gate on activation UNDERCOOLING measured against the LOCAL liquidus:
//    in an alloy, sites offered above tEq = 1 - m*c0 must not fire at all
//    (they used to stamp into above-liquidus melt and quietly remelt)
{
  const page = await browser.newPage();
  await boot(page);
  const read = () => page.evaluate(async () => {
    const s = window.__solidify.sim();
    for (let t = 0; t < 80; t++) { const st = await s.readStats(); if (st) return st; await s.device.queue.onSubmittedWorkDone(); }
    return null;
  });
  const settle = async (k) => { for (let i = 0; i < k; i++) { await page.evaluate(() => window.__solidify.tick(3)); await new Promise(r => setTimeout(r, 90)); } };
  const offer = (u) => page.evaluate((uu) => {
    const a = window.__solidify.app, s = window.__solidify.sim();
    a.clearMelt(uu);
    for (let i = 0; i < 30; i++) s.addSeed(Math.random() * s.n, Math.random() * s.n, 3.5, undefined, 0.05);
  }, u);

  await page.evaluate(() => {
    const a = window.__solidify.app;
    a.setParams({ scen: 0, heatIn: 0, coolRate: 0, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.6 });
    a.setInoculant(0); a.setRun(false);
  });
  await offer(0.07);                    // T = 0.93, above the alloy liquidus 0.865
  await settle(4);
  const hot = await read();
  await offer(0.25);                    // T = 0.75, undercooled 0.115 > 0.05
  await settle(4);
  const cold = await read();
  const ok = hot && cold && hot.fracSolid < 1e-5 && cold.fracSolid > 1e-4;
  console.log("NUC-GATE", ok ? "OK" : "FAIL",
    JSON.stringify({ aboveLiquidus: hot && +hot.fracSolid.toFixed(6), belowLiquidus: cold && +cold.fracSolid.toFixed(6) }));
  if (!ok) process.exitCode = 1;
  await page.close();
}

// 7. nucleation is a DEPENDENT quantity. Same inoculant charge, faster heat
//    extraction -> the melt reaches a deeper undercooling before recalescence
//    -> more sites activate -> finer casting. And nucleation must stall while
//    the casting is still liquid once latent heat re-warms the melt.
{
  const page = await browser.newPage();
  await boot(page);
  const read = () => page.evaluate(async () => {
    const s = window.__solidify.sim();
    for (let t = 0; t < 60; t++) { const st = await s.readStats(); if (st) return st; await s.device.queue.onSubmittedWorkDone(); }
    return null;
  });
  const fired = () => page.evaluate(() => window.__solidify.app.getNucFired());
  const cast = async (coolRate, latent = 1.5, nmax = 600) => {
    await page.evaluate(([c, L, nm]) => {
      const a = window.__solidify.app;
      a.setParams({ scen: 0, heatIn: 0, alloyOn: 0, coolRate: c, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: L });
      a.setInoculant(nm); a.clearMelt(0.15); a.setSpeed(24); a.setRun(true);
    }, [coolRate, latent, nmax]);
    for (let i = 0; i < 34; i++) { await page.evaluate(() => window.__solidify.tick(10)); await new Promise(r => setTimeout(r, 45)); }
    const s = await read();
    return { grains: s ? s.grainCount : -1, fs: s ? s.fracSolid : -1, fired: await fired() };
  };
  const slow = await cast(0.08);
  const fast = await cast(0.45);
  const coolOK = fast.grains > slow.grains && fast.fired <= 600 && slow.fired <= 600;
  console.log("NUC-COUPLING", coolOK ? "OK" : "FAIL", JSON.stringify({ slow, fast }));

  // recalescence arrest: heavy latent heat leaves part of the charge unfired
  const hot = await cast(0.10, 2.6, 900);
  const arrestOK = hot.fired < 900;
  console.log("NUC-ARREST", arrestOK ? "OK" : "FAIL", JSON.stringify({ fired: hot.fired, nmax: 900 }));
  if (!coolOK || !arrestOK) process.exitCode = 1;
  await page.close();
}

// 8. lab mode: set the experiment up, pour it, and get a report card — plus
//    the soft-lockdown flag when the operator changes the conditions mid-run
{
  const page = await browser.newPage();
  await boot(page);
  const run = async (k, per = 10) => { for (let i = 0; i < k; i++) { await page.evaluate(p => window.__solidify.tick(p), per); await new Promise(r => setTimeout(r, 35)); } };

  const opened = await page.evaluate(() => {
    window.__solidify.app.startLab();
    return !!document.getElementById("foundry") && window.__solidify.lab.active;
  });
  await page.evaluate(() => {
    const L = window.__solidify.lab, a = window.__solidify.app;
    L.setup = { atmosphere: "argon", inoculant: 700, superheat: 0.12, moldT: 0.05, moldWalls: false, program: "quench" };
    a.setSpeed(40);
    L.start();
  });
  const poured = await page.evaluate(() => {
    const p = window.__solidify.app.simParams();
    return p.scen === 3 && p.coolRate === 0 && window.__solidify.lab.running;
  });
  let card = false;
  for (let i = 0; i < 60 && !card; i++) {
    await run(4, 10);
    card = await page.evaluate(() => !!document.getElementById("foundryCard"));
  }
  const done = await page.evaluate(() => ({
    curve: !!document.getElementById("foundryCurve"),
    running: window.__solidify.lab.running,
    text: document.getElementById("foundryCard")?.textContent ?? "",
  }));

  // the dimension switch is blocked while a pour is in progress
  const gate = await page.evaluate(() => {
    const L = window.__solidify.lab, a = window.__solidify.app;
    L.setup.program = "air";
    L.start();
    const blocked = !a.canSwitchMode();
    return { blocked, freeAfter: (L.abort(), a.canSwitchMode()) };
  });
  // touching a physics dial mid-run flags the report
  await page.evaluate(() => { const L = window.__solidify.lab; L.setup.program = "air"; L.start(); });
  await run(5, 10);
  await page.evaluate(() => { window.__solidify.app.simParams().latent = 2.4; });
  await run(5, 10);
  const flagged = await page.evaluate(() => { const f = window.__solidify.lab.intervened; window.__solidify.lab.abort(); return f; });

  const ok = opened && poured && card && done.curve && !done.running
    && done.text.includes("inoculant used") && gate.blocked && gate.freeAfter && flagged;
  console.log("LAB", ok ? "OK" : "FAIL",
    JSON.stringify({ opened, poured, card, curve: done.curve, gate, flagged }));
  if (!ok) process.exitCode = 1;
  await page.close();
}

// 9. atmosphere is a melt-CLEANLINESS proxy, not a nucleation control: a melt
//    poured in air carries oxide films, which are shallow wall sites, so they
//    activate long before a clean charge's own (deep) sites ever can
{
  const page = await browser.newPage();
  await boot(page);
  const run = async (k) => { for (let i = 0; i < k; i++) { await page.evaluate(() => window.__solidify.tick(10)); await new Promise(r => setTimeout(r, 30)); } };
  await page.evaluate(() => window.__solidify.app.startLab());
  const pour = async (atm) => {
    await page.evaluate((a) => {
      const L = window.__solidify.lab, app = window.__solidify.app;
      app.setNucPotency(0.5); app.setNucSpread(0.04);
      L.setup = { atmosphere: a, inoculant: 600, superheat: 0.05, moldT: 0.05, moldWalls: false, program: "air" };
      app.setSpeed(40);
      L.start();
    }, atm);
    const trace = [];
    for (let i = 0; i < 26; i++) { await run(2); trace.push(await page.evaluate(() => window.__solidify.app.getNucFired())); }
    await page.evaluate(() => { window.__solidify.lab.abort(); document.getElementById("foundryCard")?.remove(); });
    return trace;
  };
  const vac = await pour("vacuum"), air = await pour("air");
  let lead = 0;
  for (let i = 0; i < vac.length; i++) lead = Math.max(lead, air[i] - vac[i]);
  await page.evaluate(() => window.__solidify.lab.close());
  // (the porosity half of the proxy is 3D-only — verify-3d covers it)
  const ok = lead >= 40;
  console.log("ATMOSPHERE", ok ? "OK" : "FAIL", JSON.stringify({ maxLead: lead }));
  if (!ok) process.exitCode = 1;
  await page.close();
}

{
  const ok = bindWarnings.length === 0;
  console.log("PARAM-WARN", ok ? "OK" : "FAIL", JSON.stringify(bindWarnings.slice(0, 4)));
  if (!ok) process.exitCode = 1;
}

await browser.close();
console.log("done");
