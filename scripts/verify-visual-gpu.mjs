import { closeBrowser } from "./browser-cleanup.mjs";
// VIS-* — the visual layer on a real GPU (feature/visual, 2026-11-01).
//
//   VIS-SHADERS        every 3D lens renders with the studio look on and off,
//                      and every 2D lens renders while replaying, with zero
//                      WGSL/validation errors on the console.
//   VIS-PHOTO          photo mode accumulates to its cap while the scene is
//                      still and restarts when the camera moves.
//   VIS-STUDIO-COST    render-only GPU cost of the studio look, on / off <= 1.8,
//                      40 frames per queue wait, with a liveness witness: the
//                      bench must resolve a doubled workload (on-twice / on in
//                      [1.7, 2.3]; S0 GPU run). (S0
//                      review: the running fps sat at the vsync cap in both
//                      arms, where its <= 15 % drop clause cannot fail; kept,
//                      reported with the cap flag).
//   VIS-REPLAY-2D      a seeded 2D growth: masks captured live at three times
//                      equal the replay rule applied to the final field
//                      (IoU >= 0.97; >= 0.99 at the last frame); rendering a
//                      replay never changes the field; a replay frame differs
//                      from the live frame at an early time and matches it at
//                      "now"; the strip drives the replay through the UI.
//   VIS-REPLAY-REFUSAL reheat marks the ledger; the strip is disabled with the
//                      reason, and a replay request is refused.
//   VIS-REPLAY-SCRUB-END (S0) a strip scrub stands until a mode panel takes the
//                      stage or the melt resets, and ends on each.
//   VIS-REPLAY-TREAT   (S0) a heat treatment marks the ledger at the call, with
//                      no frame in between.
//   VIS-REPLAY-3D      the 3D replay renders, never changes the field, and a
//                      replay frame differs from live at an early time; (S0)
//                      masks captured live during the growth equal the replay
//                      rule on the final field (2D's IoU bands), and the strip
//                      drives scrub3 and its live button clears it.
//   VIS-DECLUTTER      on a fresh page the head plate and the plots are folded
//                      (only the wordmark, its chevron and the plots pill);
//                      each opens and folds from its own button, the choice
//                      survives a reload, and a caveat on the melt marks the
//                      folded chevron so a warning is never hidden silently.
//   VIS-PICK           GPU picks equal an independent CPU voxel traversal of the
//                      same camera ray (>= 90 % of solid-hitting pixels: the GPU
//                      samples at half-voxel steps and can skip a voxel a ray
//                      clips by less than that); alt-tap isolates through the
//                      UI and its volume equals a raw recount.
//
// Screenshots for inspection land in the out dir.
//   node scripts/verify-visual-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "verify-out";
const PORT = process.argv[3] ?? "5199";
mkdirSync(OUT, { recursive: true });
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const check = (name, ok, detail) =>
  console.log(name, ok ? "OK" : FAIL(), detail === undefined ? "" : JSON.stringify(detail));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => {
  const t = m.type();
  if (t === "error") errors.push(m.text());
  const BENIGN = /powerPreference option is currently ignored|goatcounter: not counting/;
  if ((t === "warning" || t === "warn") && !BENIGN.test(m.text())) errors.push("WARN " + m.text());
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => page.screenshot({ path: `${OUT}/visual-${name}.png` });
// this page measures the open chrome (the strip lives in the plots, the
// isolation rows in the head plate); the folded defaults are VIS-DECLUTTER's
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem("sol.head", "1"); localStorage.setItem("sol.plots", "1"); } catch { /* no storage */ }
});

try {
  // -------------------------------------------------------------------------
  // VIS-DECLUTTER, on its own fresh page (no stored choices)
  {
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1440, height: 900 });
    await p2.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
    await p2.waitForFunction("!!window.__solidify", { timeout: 20000 });
    await sleep(500);
    const vis = sel => p2.evaluate(q => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== "none" && r.width > 0 && r.height > 0; }, sel);
    const fresh = { headBody: await vis("#headBody"), chevron: await vis("#headToggle"), cards: await vis("#hud .spark"), pill: await vis("#plotsToggle"),
      headW: await p2.evaluate(() => Math.round(document.getElementById("head").getBoundingClientRect().width)) };
    await p2.click("#headToggle"); await sleep(150);
    await p2.click("#plotsToggle"); await sleep(150);
    const opened = { headBody: await vis("#headBody"), cards: await vis("#hud .spark"),
      aria: await p2.evaluate(() => [document.getElementById("headToggle").getAttribute("aria-expanded"), document.getElementById("plotsToggle").getAttribute("aria-expanded")]) };
    await p2.reload({ waitUntil: "networkidle0" });
    await p2.waitForFunction("!!window.__solidify", { timeout: 20000 });
    await sleep(400);
    const persisted = { headBody: await vis("#headBody"), cards: await vis("#hud .spark") };
    await p2.click("#headToggle"); await p2.click("#plotsToggle"); await sleep(150);
    const folded = { headBody: await vis("#headBody"), cards: await vis("#hud .spark") };
    // a caveat on the melt marks the folded chevron
    await p2.evaluate(() => { window.__solidify.app.setMaterial("no-such-metal"); window.__solidify.ui.sync(); });
    await sleep(150);
    const marked = await p2.evaluate(() => ({ warn: document.getElementById("headToggle").classList.contains("warn"),
      label: document.getElementById("headToggle").getAttribute("aria-label") }));
    await p2.screenshot({ path: `${OUT}/visual-declutter-folded.png` });
    await p2.close();
    const ok = fresh.headBody === false && fresh.chevron && fresh.cards === false && fresh.pill && fresh.headW < 200
      && opened.headBody && opened.cards && opened.aria[0] === "true" && opened.aria[1] === "true"
      && persisted.headBody && persisted.cards && folded.headBody === false && folded.cards === false
      && marked.warn && /caveat/.test(marked.label);
    check("VIS-DECLUTTER", ok, { fresh, opened, persisted, folded, marked });
  }

  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
  await page.evaluate(() => {
    const S = window.__solidify;
    // a canvas readback in the same task as the render (the WebGPU texture is
    // only guaranteed until the task ends); returns RGBA bytes
    window.__vis = {
      grab() {
        const c = document.getElementById("canvas");
        const w = 320, h = Math.round(320 * c.height / c.width);
        const o = document.createElement("canvas"); o.width = w; o.height = h;
        const x = o.getContext("2d"); x.drawImage(c, 0, 0, w, h);
        return x.getImageData(0, 0, w, h).data;
      },
      diff(a, b) {
        let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        return s / (a.length / 4) / 3;   // mean absolute channel difference, 0..255
      },
      fnv(a) {
        const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
        return h;
      },
      async hold2(fn) {
        const sim = S.sim(), f = sim.step; sim.step = () => 0;
        try { await sim.device.queue.onSubmittedWorkDone(); return await fn(sim); } finally { sim.step = f; }
      },
    };
  });

  // -------------------------------------------------------------------------
  // VIS-REPLAY-2D (first, in 2D at 512²)
  await page.evaluate(() => { const S = window.__solidify; S.app.setRun(false); S.app.setGrid(512); });
  await page.waitForFunction("window.__solidify.sim().n === 512", { timeout: 30000 });
  await sleep(400);
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, V = window.__vis;
      S.setSeed(0x7e57);
      return V.hold2(async sim => {
        Object.assign(sim.params, { scen: 0, heatIn: 0, coolRate: 0, alloyOn: 0 });
        sim.reset(1 - 0.62);
        sim.addSeed(256, 256, 4);
        for (let i = 0; i < 3; i++) await sim.stepSync(0);
        const n = sim.n, caps = [];
        const mask = rows => { const m = new Uint8Array(n * n); for (let i = 0; i < n * n; i++) m[i] = rows[i * 4] >= 0.5 ? 1 : 0; return m; };
        for (let k = 0; k < 3; k++) {
          for (let j = 0; j < 30; j++) await sim.stepSync(40);
          const rows = await sim.readRows(0, n);
          caps.push({ t: sim.simTime, m: mask(rows) });
        }
        const fin = await sim.readRows(0, n);
        const iou = caps.map(c => {
          const tF = Math.fround(c.t);
          let inter = 0, uni = 0;
          for (let i = 0; i < n * n; i++) {
            // compare in the precision the GPU stored and compares in: age is
            // f32(batch start), and f32(t) can sit BELOW the double t, which
            // would let the batch that starts exactly at t pass a double compare
            const re = fin[i * 4] >= 0.5 && fin[i * 4 + 3] >= -0.5 && fin[i * 4 + 3] < tF ? 1 : 0;
            inter += re & c.m[i]; uni += re | c.m[i];
          }
          return { t: +c.t.toFixed(5), solid: c.m.reduce((a, b) => a + b, 0), iou: uni ? inter / uni : 1 };
        });
        // render: a replay frame never touches the field; early differs, now matches
        const r = S.r2();
        const h0 = V.fnv(await sim.readRows(0, n));
        r.scrubT = null; r.render(sim, 2, 0); const live = V.grab();
        r.scrubT = caps[0].t; r.render(sim, 2, 0); const early = V.grab();
        r.scrubT = sim.simTime; r.render(sim, 2, 0); const now = V.grab();
        r.scrubT = null;
        await sim.device.queue.onSubmittedWorkDone();
        const h1 = V.fnv(await sim.readRows(0, n));
        return { iou, fieldUnchanged: h0 === h1, earlyVsLive: +V.diff(early, live).toFixed(3), nowVsLive: +V.diff(now, live).toFixed(3), tNow: sim.simTime };
      });
    });
    const iouOk = out.iou.slice(0, 2).every(c => c.iou >= 0.97) && out.iou[2].iou >= 0.99 && out.iou.every(c => c.solid > 50);
    const renderOk = out.fieldUnchanged && out.earlyVsLive > 1 && out.nowVsLive < 0.5;
    // the UI path: the strip appears paused, and dragging it engages the replay
    await page.evaluate(() => window.__solidify.app.setView(2));
    await sleep(300);
    const ui = await page.evaluate(async () => {
      const box = document.querySelector("#hud .replay"), input = box?.querySelector("input");
      if (!box || !input) return { strip: false };
      const shown = !box.hidden;
      input.value = "300"; input.dispatchEvent(new Event("input"));
      await new Promise(r => setTimeout(r, 250));
      const st = window.__solidify.replayState();
      const label = box.querySelector(".t__val")?.textContent;
      return { strip: true, shown, scrub2: st.scrub2, label, disabled: input.disabled };
    });
    await shot("replay-2d-early");
    await page.evaluate(() => document.querySelector("#hud .replay__live")?.click());
    await sleep(200);
    const uiLive = await page.evaluate(() => window.__solidify.replayState().scrub2);
    const uiOk = ui.strip && ui.shown && !ui.disabled && ui.scrub2 > 0 && ui.scrub2 < out.tNow && uiLive === null;
    check("VIS-REPLAY-2D", iouOk && renderOk && uiOk, { ...out, ui, liveButtonClears: uiLive === null });
  }

  // -------------------------------------------------------------------------
  // VIS-REPLAY-REFUSAL
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify;
      S.app.reheat(true);
      await new Promise(r => setTimeout(r, 200));
      S.app.reheat(false);
      await new Promise(r => setTimeout(r, 300));
      const st = S.replayState();
      const box = document.querySelector("#hud .replay"), input = box?.querySelector("input");
      input.value = "200"; input.dispatchEvent(new Event("input"));
      await new Promise(r => setTimeout(r, 200));
      return { reason: st.reason2, disabled: input.disabled, note: box.querySelector(".replay__why")?.textContent, scrub2: S.replayState().scrub2 };
    });
    check("VIS-REPLAY-REFUSAL", !!out.reason && /Reheat/.test(out.reason) && out.disabled && out.note === out.reason && out.scrub2 === null, out);
  }

  // S0 review (pre-registered in tasks/todo.md): a clean ledger and a grown
  // 2D field for each, since the refusal above marked the ledger
  const fresh2 = () => page.evaluate(async () => {
    const S = window.__solidify, V = window.__vis;
    const frames = async k => { for (let i = 0; i < k; i++) await new Promise(requestAnimationFrame); };
    S.app.setRun(false); S.app.resetArmed();
    await frames(2);
    await V.hold2(async sim => {
      sim.addSeed(256, 256, 4);
      for (let i = 0; i < 3; i++) await sim.stepSync(0);
      for (let j = 0; j < 20; j++) await sim.stepSync(40);
    });
    await frames(2);
    return { clean: S.replayState().reason2 === null, now: S.sim().simTime };
  });

  // VIS-REPLAY-SCRUB-END (F6) — a scrub ends when a mode panel takes the stage
  // (hiding the strip and its live button) and on a reset; nothing else ends it
  {
    const pre = await fresh2();
    const out = await page.evaluate(async () => {
      const S = window.__solidify;
      const frames = async k => { for (let i = 0; i < k; i++) await new Promise(requestAnimationFrame); };
      const strip = v => { const input = document.querySelector("#hud .replay input"); input.value = String(v); input.dispatchEvent(new Event("input")); };
      strip(300); await frames(2);
      const control = S.replayState().scrub2;
      S.app.startHeat(); await frames(2);
      const opened = !!S.heat.active, afterPanel = S.replayState().scrub2;
      S.heat.close(); await frames(2);
      strip(300); await frames(2);
      const again = S.replayState().scrub2;
      S.app.resetArmed(); await frames(2);
      return { control, opened, afterPanel, again, afterReset: S.replayState().scrub2 };
    });
    const ok = pre.clean && pre.now > 0 && out.control > 0 && out.opened && out.afterPanel === null && out.again > 0 && out.afterReset === null;
    check("VIS-REPLAY-SCRUB-END", ok, { ...pre, ...out });
  }

  // VIS-REPLAY-TREAT (F4) — a heat treatment marks the ledger at the call, with
  // no frame in between (the frame loop only ever saw heat.busy)
  {
    const pre = await fresh2();
    const out = await page.evaluate(async () => {
      const S = window.__solidify;
      const p = S.heat.host.anneal(4, () => true);
      const marked = S.replayState().reason2;      // same task as the call
      const delivered = await p;
      return { marked, delivered };
    });
    check("VIS-REPLAY-TREAT", pre.clean && pre.now > 0 && /heat treatment/i.test(out.marked ?? "") && out.delivered > 0, { ...pre, ...out });
  }

  // -------------------------------------------------------------------------
  // 3D: enter, grow a polycrystal at 128³
  await page.evaluate(() => { const S = window.__solidify; S.app.setMode("3d"); });
  await page.waitForFunction("window.__solidify.mode() === '3d'", { timeout: 30000 });
  await page.evaluate(() => window.__solidify.app.setGrid3(128));
  await page.waitForFunction("window.__solidify.sim3d()?.n === 128", { timeout: 40000 });
  await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setRun(false);
    S.setSeed(0x51de);
    const s3 = S.sim3d(), f = s3.step; s3.step = () => 0;
    try {
      await s3.device.queue.onSubmittedWorkDone();
      Object.assign(s3.params, { scen: 0, heatIn: 0, coolRate: 0.4, alloyOn: 0, twinProb: 0, pPore: 0 });
      s3.reset(1 - 0.85);
      let rs = 0x51de;
      const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
      for (let i = 0; i < 40; i++) s3.addSeed3D(16 + rnd() * 96, 16 + rnd() * 96, 16 + rnd() * 96, 3);
      for (let i = 0; i < 3; i++) await s3.stepSync(0);
      // VIS-REPLAY-3D's live masks (S0 review): phi >= 0.5 after batches 20,
      // 40 and 60, read back between batches (a readback, no physics)
      const caps = [];
      for (let k = 0; k < 60; k++) {
        await s3.stepSync(60);
        if (k === 19 || k === 39 || k === 59) {
          const phi = await s3.readPhiVolume(), m = new Uint8Array(phi.length);
          let solid = 0;
          for (let i = 0; i < phi.length; i++) if (phi[i] >= 0.5) { m[i] = 1; solid++; }
          caps.push({ t: s3.simTime, m, solid });
          // the pre-registered "final field" is the one at the end of THIS
          // growth: later sections run the cast on (VIS-STUDIO-COST), and a
          // cell that remelts or refreezes after the last capture cannot replay
          if (k === 59) window.__vis3final = { phi, age: (await s3.readAgeVolume())?.time, t: s3.simTime };
        }
      }
      window.__vis3caps = caps;
      await s3.device.queue.onSubmittedWorkDone();
    } finally { s3.step = f; }
  });
  await sleep(500);

  // VIS-SHADERS
  {
    const before = errors.length;
    const out = await page.evaluate(async () => {
      const S = window.__solidify, r3 = S.r3(), s3 = S.sim3d();
      const plane = { n: [1, 0, 0], c: 64 };
      for (const studio of [true, false]) {
        r3.studioOn = studio;
        for (let v = 0; v < 9; v++) { r3.render(s3, v, 0, plane, 0, false); r3.render(s3, v, 0, plane, 0, true); }
      }
      r3.studioOn = true;
      r3.scrubT = s3.simTime * 0.5;
      for (let v = 0; v < 9; v++) r3.render(s3, v, 0, plane, 0, false);
      r3.scrubT = null;
      const r2 = S.r2(), sim = S.sim();
      r2.scrubT = sim.simTime * 0.5;
      for (let v = 0; v < 10; v++) r2.render(sim, v, 0);
      r2.scrubT = null;
      await s3.device.queue.onSubmittedWorkDone();
      return { lenses3: 9, lenses2: 10 };
    });
    await sleep(300);
    const newErrors = errors.slice(before);
    check("VIS-SHADERS", newErrors.length === 0, { ...out, errors: newErrors.slice(0, 4) });
  }

  // VIS-PHOTO
  {
    await page.evaluate(() => { const S = window.__solidify; S.app.setView3d(0); S.app.setRun(false); });
    await sleep(300);
    await shot("3d-studio-live");
    const reached = await page.waitForFunction("window.__solidify.r3().photoSamples >= 48", { timeout: 20000 }).then(() => true, () => false);
    await shot("3d-photo-converged");
    const capped = await page.evaluate(async () => {
      const a = window.__solidify.r3().photoSamples; await new Promise(r => setTimeout(r, 400)); return [a, window.__solidify.r3().photoSamples];
    });
    await page.evaluate(() => window.__solidify.r3().orbitBy(80, 0));
    await sleep(60);
    const afterMove = await page.evaluate(() => window.__solidify.r3().photoSamples);
    const restarted = await page.waitForFunction("window.__solidify.r3().photoSamples >= 48", { timeout: 20000 }).then(() => true, () => false);
    await page.evaluate(() => { window.__solidify.r3().studioOn = false; });
    await sleep(400);
    await shot("3d-studio-off");
    await page.evaluate(() => { window.__solidify.r3().studioOn = true; });
    check("VIS-PHOTO", reached && capped[0] === 48 && capped[1] === 48 && afterMove < 12 && restarted,
      { reached, capped, afterMove, restarted });
  }

  // VIS-STUDIO-COST (criterion changed by the S0 review, pre-registered in
  // tasks/todo.md): the running fps sat at the vsync cap in both arms (55.7 /
  // 55.6), where a 15 % drop cannot show, so the gate is the render-only GPU
  // cost, which no cap hides; a planted 2x studio cost (every frame rendered
  // twice) must break it. The fps clause stays, reported with the cap flag.
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, r3 = S.r3(), s3 = S.sim3d();
      const plane = { n: [1, 0, 0], c: 64 };
      // 40 frames submitted back to back, one queue wait: a wait per frame
      // made a fixed round trip dominate (the first S0 run: a doubled workload
      // moved 7.26 -> 12.53 ms), so the bench could not resolve a 2x cost
      const bench = async (studio, perFrame = 1) => {
        r3.studioOn = studio;
        for (let i = 0; i < 5; i++) r3.render(s3, 0, 0, plane, 0, false);
        await s3.device.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        for (let i = 0; i < 40; i++)
          for (let j = 0; j < perFrame; j++) r3.render(s3, 0, 0, plane, 0, false);
        await s3.device.queue.onSubmittedWorkDone();
        return (performance.now() - t0) / 40;
      };
      const off = await bench(false), on = await bench(true), onTwice = await bench(true, 2);
      r3.studioOn = true;
      // the display's own frame rate, nothing else asked of it
      const rafHz = await new Promise(res => {
        let k = 0; const t0 = performance.now();
        const f = () => { k++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(k / ((performance.now() - t0) / 1000)); };
        requestAnimationFrame(f);
      });
      // running fps, studio on vs off (the frame loop's own fps readout)
      const fpsOf = async studio => {
        r3.studioOn = studio; S.app.setRun(true);
        await new Promise(r => setTimeout(r, 3500));
        const f = S.fps(); S.app.setRun(false); return f;
      };
      const fOff = await fpsOf(false), fOn = await fpsOf(true);
      r3.studioOn = true;
      return { renderMsOff: +off.toFixed(2), renderMsOn: +on.toFixed(2), renderMsOnTwice: +onTwice.toFixed(2),
        fpsOff: +fOff.toFixed(1), fpsOn: +fOn.toFixed(1), rafHz: +rafHz.toFixed(1) };
    });
    // liveness witness: the bench must resolve a doubled workload (on-twice /
    // on in [1.7, 2.3]) before its on / off ratio means anything
    const ratio = out.renderMsOn / out.renderMsOff, doubling = out.renderMsOnTwice / out.renderMsOn;
    const vsyncCapped = Math.min(out.fpsOn, out.fpsOff) >= 0.9 * out.rafHz;
    check("VIS-STUDIO-COST", ratio <= 1.8 && doubling >= 1.7 && doubling <= 2.3 && out.fpsOn >= 0.85 * out.fpsOff,
      { ...out, ratio: +ratio.toFixed(3), doubling: +doubling.toFixed(3), vsyncCapped });
  }

  // VIS-REPLAY-3D
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, V = window.__vis, r3 = S.r3(), s3 = S.sim3d();
      S.app.setRun(false);
      await s3.device.queue.onSubmittedWorkDone();
      const g0 = V.fnv(await s3.readGrainVolume()), p0 = V.fnv(await s3.readPhiVolume());
      const plane = { n: [1, 0, 0], c: 64 };
      r3.scrubT = null; r3.render(s3, 0, 0, plane, 0, false); const live = V.grab();
      r3.scrubT = s3.simTime * 0.3; r3.render(s3, 0, 0, plane, 0, false); const early = V.grab();
      r3.scrubT = null;
      await s3.device.queue.onSubmittedWorkDone();
      const g1 = V.fnv(await s3.readGrainVolume()), p1 = V.fnv(await s3.readPhiVolume());
      // masks captured live during the growth against the replay rule on the
      // final field of that growth (batch 60), in the GPU's f32 (S0 review;
      // 2D's bands); replay-only and live-only counts classify a mismatch
      const fin = window.__vis3final ?? null;
      const phiF = fin?.phi, age = fin?.age;
      const iou = (phiF && age ? window.__vis3caps ?? [] : []).map(c => {
        const tF = Math.fround(c.t);
        let inter = 0, uni = 0, replayOnly = 0, liveOnly = 0;
        for (let i = 0; i < c.m.length; i++) {
          const re = phiF[i] >= 0.5 && age[i] < tF ? 1 : 0;
          inter += re & c.m[i]; uni += re | c.m[i];
          if (re && !c.m[i]) replayOnly++; else if (!re && c.m[i]) liveOnly++;
        }
        return { t: +c.t.toFixed(5), solid: c.solid, iou: uni ? +(inter / uni).toFixed(5) : 1, replayOnly, liveOnly };
      });
      return { fieldUnchanged: g0 === g1 && p0 === p1, earlyVsLive: +V.diff(early, live).toFixed(3), iou,
        tFinal: fin ? +fin.t.toFixed(5) : null, tNow: s3.simTime };
    });
    const ui = await page.evaluate(async () => {
      const box = document.querySelector("#hud .replay"), input = box?.querySelector("input");
      if (!input) return { strip: false };
      input.value = "350"; input.dispatchEvent(new Event("input"));
      await new Promise(r => setTimeout(r, 400));
      // reason3 reported so a refusal from a real remelt (the cast ran during
      // VIS-STUDIO-COST) is legible as that, not as a scrub defect
      const st = window.__solidify.replayState();
      return { strip: true, scrub3: st.scrub3, reason3: st.reason3 };
    });
    await shot("replay-3d-early");
    await page.evaluate(() => document.querySelector("#hud .replay__live")?.click());
    await sleep(200);
    const uiLive = await page.evaluate(() => window.__solidify.replayState().scrub3);
    const iouOk = out.iou.length === 3 && out.iou.slice(0, 2).every(c => c.iou >= 0.97) && out.iou[2].iou >= 0.99 && out.iou.every(c => c.solid > 50);
    const uiOk = ui.strip && ui.scrub3 > 0 && ui.scrub3 < out.tNow && uiLive === null;
    check("VIS-REPLAY-3D", out.fieldUnchanged && out.earlyVsLive > 1 && iouOk && uiOk, { ...out, iouOk, ui, liveButtonClears: uiLive === null });
  }

  // VIS-PICK
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, r3 = S.r3(), s3 = S.sim3d();
      const n = s3.n, phi = await s3.readPhiVolume(), grain = await s3.readGrainVolume();
      const cam = S.cam3();
      const canvas = document.getElementById("canvas");
      const rect = canvas.getBoundingClientRect();
      const tanF = Math.tan((38 * Math.PI / 180) / 2), aspect = rect.width / rect.height;
      // the camera basis, re-derived from the published camera state
      const ce = Math.cos(cam.el), se = Math.sin(cam.el), ca = Math.cos(cam.az), sa = Math.sin(cam.az);
      const off = [ce * ca, ce * sa, se], d = cam.dist * n * 0.55;
      const eye = [0, 1, 2].map(i => cam.tgt[i] + off[i] * d), fwd = off.map(v => -v);
      const rl = Math.hypot(fwd[1], -fwd[0]) || 1, right = [fwd[1] / rl, -fwd[0] / rl, 0];
      const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
      // Amanatides-Woo voxel traversal: every voxel the ray enters, in order
      const traverse = (o, dir) => {
        const inv = dir.map(v => 1 / v);
        let tn = 0, tf = Infinity;
        for (let i = 0; i < 3; i++) { const a = (0 - o[i]) * inv[i], b = (n - o[i]) * inv[i]; tn = Math.max(tn, Math.min(a, b)); tf = Math.min(tf, Math.max(a, b)); }
        if (tn >= tf) return 0;
        const p = o.map((v, i) => v + dir[i] * (tn + 1e-6));
        const c = p.map(v => Math.min(n - 1, Math.max(0, Math.floor(v))));
        const step = dir.map(v => (v > 0 ? 1 : -1));
        const tMax = c.map((ci, i) => { const bnd = ci + (step[i] > 0 ? 1 : 0); return dir[i] !== 0 ? tn + (bnd - p[i]) / dir[i] : Infinity; });
        const tDelta = dir.map(v => (v !== 0 ? Math.abs(1 / v) : Infinity));
        for (let it = 0; it < 3 * n + 3; it++) {
          const idx = (c[2] * n + c[1]) * n + c[0];
          if (phi[idx] >= 0.5) return grain[idx];
          const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
          c[a] += step[a]; tMax[a] += tDelta[a];
          if (c[a] < 0 || c[a] >= n) return 0;
        }
        return 0;
      };
      let hits = 0, agree = 0, gpuOnly = 0, mismatches = [], clickAt = null;
      for (let iy = 1; iy <= 5; iy++) for (let ix = 1; ix <= 7; ix++) {
        const u = ix / 8, v = iy / 6;
        const sx = (u - 0.5) * 2 * tanF * aspect, sy = (0.5 - v) * 2 * tanF;
        let dir = [0, 1, 2].map(i => fwd[i] + sx * right[i] + sy * up[i]);
        const l = Math.hypot(...dir); dir = dir.map(x => x / l);
        const cpu = traverse(eye, dir);
        const gpu = await r3.pickGrain(s3, rect.left + u * rect.width, rect.top + v * rect.height, null);
        if (cpu === 0 && (!gpu || gpu.id === 0)) continue;
        if (cpu === 0) { gpuOnly++; continue; }
        hits++;
        if (gpu && gpu.id === cpu) { agree++; clickAt ??= [rect.left + u * rect.width, rect.top + v * rect.height]; }
        else mismatches.push([u, v, cpu, gpu?.id ?? null]);
      }
      return { hits, agree, gpuOnly, mismatches: mismatches.slice(0, 5), clickAt };
    });
    // alt-tap through the UI on the frame's centre, then compare the readout's
    // volume with a raw recount of that id
    await page.keyboard.down("Alt");
    if (out.clickAt) await page.mouse.click(out.clickAt[0], out.clickAt[1]);
    await page.keyboard.up("Alt");
    const iso = await page.waitForFunction("window.__solidify.iso3()?.vox != null", { timeout: 8000 })
      .then(() => page.evaluate(async () => {
        const S = window.__solidify, s3 = S.sim3d(), iso = S.iso3();
        const g = await s3.readGrainVolume(), ph = await s3.readPhiVolume();
        let raw = 0; for (let i = 0; i < g.length; i++) if (g[i] === iso.id && ph[i] > 0.5) raw++;
        await new Promise(r => setTimeout(r, 400));
        const readout = document.body.innerText.includes(`#${iso.id} isolated`);
        return { id: iso.id, vox: iso.vox, raw, rendererIso: S.r3().isoId, readout };
      }), () => null);
    await sleep(500);
    await shot("3d-isolated");
    await page.keyboard.press("Escape");
    await sleep(150);
    const cleared = await page.evaluate(() => window.__solidify.iso3() === null && window.__solidify.r3().isoId === 0);
    const pickOk = out.hits >= 8 && out.agree >= 0.9 * out.hits;
    const isoOk = !!iso && iso.vox === iso.raw && iso.rendererIso === iso.id && iso.readout && cleared;
    check("VIS-PICK", pickOk && isoOk, { ...out, iso, escapeClears: cleared });
  }
} catch (e) {
  console.log("VIS harness error", String(e?.stack ?? e));
  FAIL();
} finally {
  console.log("PAGE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 8)) : "none");
  if (errors.length) FAIL();
  await closeBrowser(browser);
}
console.log(failures ? `done — ${failures} FAILED` : "done");
process.exit(failures ? 1 : 0);
