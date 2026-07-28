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
    window.__solidify.setSeed(0x1337c0de);
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
      delta: +p.delta.toFixed(3), noise: +p.noiseAmp.toFixed(3), facet: p.facet, ani: p.aniMode,
      seed: window.__solidify.seed() >>> 0 };
  });
  // the seed rides the link (v7.0), and it has to survive a REAL reload: it is
  // applied first in the boot applier, ahead of setMaterial and applyNucShare,
  // both of which redraw. A seed restored after them would be a seed the
  // restored cast never actually used.
  const ok = got.m === "mg" && got.u === 0.83 && got.v === 4 && got.delta === 0.061 && got.facet === 1
    && got.seed === 0x1337c0de;
  console.log("SHARE ROUND-TRIP", ok ? "OK" : "MISMATCH", JSON.stringify(got));
  if (!ok) process.exitCode = 1;
  await p2.close();
}

// 2b. HT-SHARE: the heat-treat setup rides the link and lands field-exact —
// and it must go through boot(), not an in-page pack/unpack, because the
// clobber this gate exists to catch lives in the applier: buildPanel()
// re-derives the dial defaults from the material on every open, which is
// exactly what would silently discard a restored link.
{
  const page = await browser.newPage();
  await boot(page);
  const link = await page.evaluate(() => {
    const S = window.__solidify;
    S.app.setMaterial("cu");
    S.app.startHeat();
    const dials = document.getElementById("heattreat").querySelectorAll('input[type="range"]');
    const set = (i, v) => { dials[i].value = String(v); dials[i].dispatchEvent(new Event("input", { bubbles: true })); };
    set(0, 655); set(1, 240); set(2, 33);        // temperature, hold, spec σ_y
    return S.app.shareLink();
  });
  await page.close();
  const p2 = await browser.newPage();
  await boot(p2, link.slice(link.indexOf("#")));
  const got = await p2.evaluate(() => {
    const panel = document.getElementById("heattreat");
    if (!panel) return { open: false };
    const dials = panel.querySelectorAll('input[type="range"]');
    return {
      open: true, m: window.__solidify.app.getMaterial(),
      t: +dials[0].value, h: +dials[1].value, s: +dials[2].value,
      // the staged link has nothing solid yet — the panel must refuse
      // honestly rather than pretend, and the dialled schedule must survive
      note: document.getElementById("htNote").textContent.slice(0, 80),
    };
  });
  const ok = got.open && got.m === "cu" && got.t === 655 && got.h === 240 && got.s === 33;
  console.log("HT-SHARE", ok ? "OK" : "FAIL", JSON.stringify(got));
  if (!ok) process.exitCode = 1;
  await p2.close();

  // the malformed arm: a hand-built ht carrying non-numbers must not open the
  // panel at all. Without the decoder's Number.isFinite whitelist this link
  // sailed through the clamp as NaN and opened a panel whose note read
  // "hold NaN h at NaN °C" with an enabled run button — a lying label on
  // exactly the hand-built-link surface the clamp claims to defend.
  const bad = JSON.stringify({ p: { delta: 0.05 }, u: 0.8, v: 1, m: "cu", ht: ["x", "y", 0] });
  const badHash = "#set=" + Buffer.from(bad).toString("base64")
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const p3 = await browser.newPage();
  await boot(p3, badHash);
  const gotBad = await p3.evaluate(() => ({
    open: !!document.getElementById("heattreat"),
    m: window.__solidify.app.getMaterial(),
  }));
  const ok2 = !gotBad.open && gotBad.m === "cu";   // the rest of the link still applies
  console.log("HT-SHARE-MALFORMED", ok2 ? "OK" : "FAIL", JSON.stringify(gotBad));
  if (!ok2) process.exitCode = 1;
  await p3.close();
}

// 2c. MOULD-SHARE (Phase D M): the mould kind is the lab tuple's 9th, optional
// element — a valid kind round-trips, and a missing or garbage one (an old
// link, or a hand-built one) must default to "shell" rather than decode as
// undefined and reach setMold with a value MOLD_KIND_ID has no entry for.
{
  const page = await browser.newPage();
  await boot(page);
  const link = await page.evaluate(() => {
    const S = window.__solidify;
    S.app.startLab();
    S.lab.setup.mold = "step";
    S.lab.setup.moldWalls = true;
    return S.app.shareLink();
  });
  await page.close();
  const p2 = await browser.newPage();
  await boot(p2, link.slice(link.indexOf("#")));
  const got = await p2.evaluate(() => ({ open: window.__solidify.lab.active, mold: window.__solidify.lab.setup.mold }));
  const ok = got.open && got.mold === "step";
  console.log("MOULD-SHARE", ok ? "OK" : "FAIL", JSON.stringify(got));
  if (!ok) process.exitCode = 1;
  await p2.close();

  // the malformed arm: a hand-built lab tuple with a garbage 9th element
  const bad = JSON.stringify({ p: {}, u: 0.8, v: 1, m: "cu", lab: ["argon", 600, 0.1, 0.05, 1, "air", 0, 0, "not-a-shape"] });
  const badHash = "#set=" + Buffer.from(bad).toString("base64")
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const p3 = await browser.newPage();
  await boot(p3, badHash);
  const gotBad = await p3.evaluate(() => ({ open: window.__solidify.lab.active, mold: window.__solidify.lab.setup.mold }));
  const ok2 = gotBad.open && gotBad.mold === "shell";
  console.log("MOULD-SHARE-MALFORMED", ok2 ? "OK" : "FAIL", JSON.stringify(gotBad));
  if (!ok2) process.exitCode = 1;
  await p3.close();
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
    L.setup = { atmosphere: "argon", inoculant: 700, holdMin: 0, superheat: 0.12, moldT: 0.05, moldWalls: false, mold: "shell", program: "quench", specMPa: 0 };
    a.setSpeed(40);
    L.start();
  });
  const poured = await page.evaluate(() => {
    const p = window.__solidify.app.simParams();
    return p.scen === 3 && p.coolRate === 0 && window.__solidify.lab.running;
  });
  // v6.3: the report no longer pops up on its own — hasResults (Results
  // button enabled) is the "finished" signal now, and the report text lives
  // in #foundryResultsBody (built hidden, shown only on a Results click)
  let card = false;
  for (let i = 0; i < 60 && !card; i++) {
    await run(4, 10);
    card = await page.evaluate(() => !!window.__solidify.lab.hasResults);
  }
  const done = await page.evaluate(() => ({
    curve: !!document.getElementById("foundryCurve"),
    running: window.__solidify.lab.running,
    text: document.getElementById("foundryResultsBody")?.textContent ?? "",
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

// 8b. LAB4 — the lab judges (L4). Three requirements, through the DOM on a
//     material with strength constants: the card's σ_y row must BE hallPetch
//     on the gate's OWN census (the HT-PANEL doctrine — same d̄ definition,
//     same law, one verdict logic for both cards); the pass/fail must be the
//     printed-precision comparison against the spec AS DIALLED AT THE POUR —
//     the dial is shoved to 999 the moment the metal is in, and the card must
//     not notice; and a pour with no spec must measure WITHOUT a verdict row,
//     because a pass/fail against a spec nobody set is an invented judgement.
{
  const page = await browser.newPage();
  await boot(page);
  const run = async (k, per = 10) => { for (let i = 0; i < k; i++) { await page.evaluate(p => window.__solidify.tick(p), per); await new Promise(r => setTimeout(r, 35)); } };
  // Al's shipped strength constants — anchors, not a second source of truth:
  // drift in the table is caught browser-free by HT-LAWS/HT-DEMO
  const AL = { s0: 20, kHP: 0.07 };
  const fmtMPa = m => (m >= 100 ? m.toFixed(0) : m >= 3 ? m.toFixed(1) : m.toPrecision(2));
  const shown = m => Number(fmtMPa(m));

  const pour = async (spec, mat = "al") => {
    await page.evaluate(([s, m]) => {
      const S = window.__solidify, L = S.lab;
      S.app.setMaterial(m);
      if (!L.active) S.app.startLab();
      // a shallow superheat and a heavy charge: the gate's business is the
      // verdict, not a marathon freeze, and a pour that outlives the poll
      // budget reads as a flake (it did once — dUm 0 with the run still going)
      L.setup = { atmosphere: "argon", inoculant: 1200, holdMin: 0, superheat: 0.06, moldT: 0.05, moldWalls: false, mold: "shell", program: "quench", specMPa: s };
      S.app.setSpeed(40);
      L.start();
      if (s > 0) L.setup.specMPa = 999;   // the latch probe: moved AFTER the pour
    }, [spec, mat]);
    // v6.3: no auto-popup — poll the lab's own hasResults flag instead of a
    // card appearing; the report lives in #foundryResultsBody (built hidden)
    let card = false;
    for (let i = 0; i < 140 && !card; i++) {
      await run(4, 10);
      card = await page.evaluate(() => !!window.__solidify.lab.hasResults);
    }
    return page.evaluate(async () => {
      const S = window.__solidify, s = S.sim();
      let st = null;
      for (let t = 0; t < 60 && !st; t++) { st = await s.readStats(); if (!st) await s.device.queue.onSubmittedWorkDone(); }
      const um = S.app.getUmPerCell();
      const d = st && st.meanAreaPx > 0 ? 2 * Math.sqrt(st.meanAreaPx / Math.PI) * um : 0;
      const el = document.getElementById("foundryResultsBody");
      const text = (el ? el.textContent : "").replace(/\s+/g, " ");
      // #foundryResultsBody persists across pours (unlike the old #foundryCard,
      // which was removed/recreated each time) — the NEXT L.start() call clears
      // hasResults and hides the panel, so there's nothing to clean up here
      return { text, dUm: d };
    });
  };

  const a = await pour(30);
  const sigA = (a.text.match(/σ_y \(Hall–Petch\) ([\d.]+) MPa/) ?? [])[1];
  const sigExp = a.dUm > 0 ? AL.s0 + AL.kHP / Math.sqrt(a.dUm * 1e-6) : NaN;
  const rowOK = sigA != null && Math.abs(Number(sigA) - sigExp) < 0.2;
  const estOK = a.text.includes("⟨A⟩-equivalent");
  // the card prints the spec through fmtMPa — assert with the same formatter
  const latchOK = a.text.includes(`spec σ_y ≥ ${fmtMPa(30)} MPa`) && !a.text.includes("≥ 999 MPa");
  const verdictWord = / — met: /.test(a.text) ? "met" : /missed/.test(a.text) ? "missed" : "none";
  const verdictOK = sigA != null && verdictWord === (shown(Number(sigA)) >= shown(30) ? "met" : "missed");

  const b = await pour(0);
  const sigRowB = /σ_y \(Hall–Petch\)/.test(b.text);
  const noSpecRowB = !/spec σ_y/.test(b.text);

  // the model metal has no si block: a dialled spec must come back refused by
  // name — a Hall–Petch verdict from invented constants would be worse than none
  const c = await pour(30, "generic");
  const refuseC = /no strength\s?constants/.test(c.text) && !/ — met: |missed: /.test(c.text);

  const ok = rowOK && estOK && latchOK && verdictOK && sigRowB && noSpecRowB && refuseC;
  console.log("LAB4", ok ? "OK" : "FAIL", JSON.stringify({
    dUm: +a.dUm.toFixed(1), sigRow: sigA ?? null, sigExp: Number.isFinite(sigExp) ? +sigExp.toFixed(2) : null,
    verdictWord, latchOK, estOK, sigRowB, noSpecRowB, refuseC,
  }));
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
      L.setup = { atmosphere: a, inoculant: 600, holdMin: 0, superheat: 0.05, moldT: 0.05, moldWalls: false, mold: "shell", program: "air", specMPa: 0 };
      app.setSpeed(40);
      L.start();
    }, atm);
    const trace = [];
    for (let i = 0; i < 26; i++) { await run(2); trace.push(await page.evaluate(() => window.__solidify.app.getNucFired())); }
    await page.evaluate(() => { window.__solidify.lab.abort(); });
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

// 9. REFINE-Q — growth restriction refines the casting, and it does so through
//    nucleation rather than around it. A high-Q alloy grows slower, so it
//    recalesces less, so the melt keeps undercooling and activates MORE of its
//    inoculant. This is the claim the science page makes, so it is checked.
//
//    The comparison has to be fair in two ways that an earlier version of this
//    experiment was not: both charges start at the same undercooling BELOW THEIR
//    OWN liquidus (equal bath temperature is not equal undercooling when one
//    liquidus is depressed 170 K further), and they are read at the same SOLID
//    FRACTION (equal time is not equal progress when one grows twice as slowly).
//    Get either wrong and the result inverts.
{
  const page = await browser.newPage();
  await boot(page);
  const read = () => page.evaluate(async () => {
    const s = window.__solidify.sim();
    for (let t = 0; t < 60; t++) { const st = await s.readStats(); if (st) return st; await s.device.queue.onSubmittedWorkDone(); }
    return null;
  });
  const cast = async (mix, nmax) => {
    const pp = await page.evaluate(m => window.__solidify.alloy(m).params, mix);
    const tEq = 1 - pp.mLiq * pp.c0;
    await page.evaluate(([p, u, nm]) => {
      const a = window.__solidify.app;
      a.setParams({ scen: 0, heatIn: 0, coolRate: 0.25, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.35, ...p });
      a.setInoculant(nm); a.clearMelt(u); a.setSpeed(24); a.setRun(true);
    }, [pp, 1 - (tEq - 0.15), nmax]);
    let s = null;
    for (let i = 0; i < 160; i++) {
      await page.evaluate(() => window.__solidify.tick(10));
      await new Promise(r => setTimeout(r, 40));
      s = await read();
      if (s && s.fracSolid >= 0.20) break;
    }
    return { grains: s?.grainCount ?? -1, fs: +(s?.fracSolid ?? -1).toFixed(3), fired: await page.evaluate(() => window.__solidify.app.getNucFired()) };
  };
  const A356 = { base: "al", wt: { Si: 7, Mg: 0.35, Ti: 0.12 } };
  const lean = { base: "al", wt: { Zn: 1 } };
  const rHi = await cast(A356, 3000);
  const lHi = await cast(lean, 3000);
  const rLo = await cast(A356, 600);
  const lLo = await cast(lean, 600);
  const dev = (a, b) => Math.abs(a - b) / Math.max(1, b);
  const matched = Math.abs(rHi.fs - lHi.fs) < 0.03 && Math.abs(rLo.fs - lLo.fs) < 0.03;
  const ok = matched && dev(rHi.grains, lHi.grains) < 0.15 && dev(rLo.grains, lLo.grains) < 0.15;
  console.log("REFINE-FAIR", ok ? "OK" : "FAIL", JSON.stringify({
    at3000: { refined: rHi, lean: lHi }, at600: { refined: rLo, lean: lLo }, matchedFs: matched,
  }));
  if (!ok) process.exitCode = 1;
  await page.close();
}

// RNG-REPRO: the seeded stream, end to end through the real solver.
//
// verify-rng.mjs gates the module's own contract without a browser; this gates
// that the SWEEP actually took — that no consumer still reaches for
// Math.random() behind the seed's back. An inoculated pour is the right probe
// because it exercises all three of the paths the sweep touched at once: the
// nucleation site population and its activation Gaussian (nucleation.ts), the
// per-grain orientations (sim.ts addSeed), and the ratchet that decides which
// sites fire. The comparison is the full per-grain census, not just a count —
// two runs can easily agree on how MANY grains formed while disagreeing about
// every one of them.
//
// Fence-paced via stepSync throughout: step() is frame-paced and skips under
// backpressure, so a frame-paced arm would be comparing two different substep
// budgets and calling the difference irreproducibility.
{
  const page = await browser.newPage();
  await boot(page);
  await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setRun(false);
    S.app.setGrid(512);
    await new Promise(r => setTimeout(r, 400));
  });

  const cast = async (seed) => await page.evaluate(async (s) => {
    const S = window.__solidify;
    S.app.setRun(false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // rewinds EVERY stream, including the host's own "scatter" — which nothing
    // else resets, so without this the second cast would continue the first's
    // position sequence and differ for a reason that is not the seed
    S.setSeed(s);
    const sim = S.sim();
    Object.assign(sim.params, {
      scen: 0, heatIn: 0, coolRate: 0.6, alloyOn: 0, twinProb: 0,
      noiseAmp: 0.01, aniMode: 4, delta: 0.04, latent: 1.4,
    });
    sim.reset(1 - 0.9);
    // Positions come from stream("scatter"), orientations from stream("sim2d").
    // scatterSeeds deliberately, and addSeed WITHOUT an explicit theta0: the
    // canonical cast helper in verify-heattreat-gpu passes its own seeded angle,
    // which is right there and wrong here — passing theta0 would bypass the very
    // draw this gate exists to check.
    S.app.scatterSeeds(400);
    // submit() stamps at most MAX_SEEDS per command buffer; drain before growing
    for (let i = 0; i < 12; i++) await sim.stepSync(0);
    const stats = async () => {
      // readStats returns null while another read is in flight and the app's own
      // 4 Hz poll races every call from here — retry rather than report a null
      for (let i = 0; i < 40; i++) {
        const st = await S.sim().readStats();
        if (st) return st;
        await new Promise(r => setTimeout(r, 25));
      }
      return null;
    };
    let st = null;
    for (let k = 0; k < 60; k++) {
      await sim.stepSync(120);
      st = await stats();
      if (st && st.fracSolid > 0.985) break;
    }
    return st && {
      seedHex: S.seed().toString(16).padStart(8, "0"),
      grainCount: st.grainCount,
      fracSolid: +st.fracSolid.toFixed(9),
      meanAreaPx: +st.meanAreaPx.toFixed(6),
      diams: st.diamsUm.map(d => +d.toFixed(6)),
    };
  }, seed);

  const SEED = 0x51105d1f;
  const a1 = await cast(SEED);
  const a2 = await cast(SEED);            // same seed, from scratch
  const b1 = await cast(0x0be5eed5);      // a different cast entirely

  const arr = (x, y) => !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]);
  // the cast has to have HAPPENED: the first draft of this gate compared three
  // runs that had all produced zero solid and reported "reproducible"
  const grew = !!a1 && !!b1 && a1.fracSolid > 0.5 && a1.grainCount > 20 && b1.grainCount > 20;
  const repeats = !!a1 && !!a2
    && a1.grainCount === a2.grainCount && a1.fracSolid === a2.fracSolid
    && a1.meanAreaPx === a2.meanAreaPx && arr(a1.diams, a2.diams);
  // a seed that changes nothing would be a seed control that does nothing —
  // the identity half of this gate is only meaningful beside the difference half
  const differs = !!b1 && !arr(b1.diams, a1.diams);

  const ok = grew && repeats && differs;
  console.log("RNG-REPRO", ok ? "OK" : "FAIL", JSON.stringify({
    castGrew: grew, sameSeedRepeats: repeats, differentSeedDiffers: differs,
    run1: a1 && { seed: a1.seedHex, grains: a1.grainCount, fs: a1.fracSolid, area: a1.meanAreaPx },
    run2: a2 && { seed: a2.seedHex, grains: a2.grainCount, fs: a2.fracSolid, area: a2.meanAreaPx },
    other: b1 && { seed: b1.seedHex, grains: b1.grainCount, fs: b1.fracSolid, area: b1.meanAreaPx },
  }));
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
