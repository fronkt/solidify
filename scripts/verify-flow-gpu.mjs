import { closeBrowser } from "./browser-cleanup.mjs";
// FLOW3-* — D3.1, the standalone lattice Boltzmann solver, on a real GPU.
// Fluid only: nothing here couples into the phase field (that is D3.2).
// Design: docs/D3-CONVECTION-DESIGN.md section 4.
//
//   FLOW-SHEAR-DECAY   a cos shear wave between free-slip walls decays as
//                      exp(-nu k^2 t): the measured viscosity equals the set
//                      one within 1 % (analytic).
//   FLOW-DRAG-PROFILE  body-force-driven flow over a diffuse solid (this repo's
//                      tanh profile, W = 1.25 cells) at tau ~ 10.4 matches an
//                      independent CPU solve of the same continuum equation,
//                      u'' = 2h phi^2 u / W^2 - F / nu, within 2 % of the peak,
//                      and is near zero deep in the solid. Falsification arm:
//                      h = 0 (no drag) must miss by more than 20 %.
//   FLOW-FREESTREAM    a uniform inlet stream through an empty free-slip
//                      channel stays uniform (inlet/outlet boundaries).
//
//   node scripts/verify-flow-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { captureFlowOffCases, runFlowCase } from "./fixtures/flow-off-cases.mjs";
// D3.2 (coupling) adds:
//   FLOW-OFF-IDENTITY   with flow off, seven 2D cases hash exactly as they did
//                       at the commit before advection existed
//                       (scripts/fixtures/flow-off-baseline.json).
//   FLOW-INERT-ARMS     flow on at zero inlet speed, and flow on with the
//                       coupling set to 0, both reproduce the flow-off split
//                       pass bit for bit (the LBM ran; advection added nothing).
//   FLOW-UNIFORM-MELT   an all-liquid melt at the far-field temperature stays
//                       uniform under flow (the advection operator and its
//                       inlet/outlet faces are consistent).
//   FLOW-DIRECTION      Kobayashi, qualitative: with flow from the west the
//                       upstream arm outgrows the no-flow arm by > 5 % and the
//                       downstream arm falls short by > 5 %; with the coupling
//                       reversed (-1) the upstream arm falls short instead.
const BASELINE = new URL("./fixtures/flow-off-baseline.json", import.meta.url);

const PORT = process.argv[3] ?? "5199";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const F = await vite.ssrLoadModule("/src/flow.ts");
await vite.close();

let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const check = (name, ok, detail) =>
  console.log(name, ok ? "OK" : FAIL(), detail === undefined ? "" : JSON.stringify(detail));

/** the steady profile of u'' = 2 h phi(y)^2 u / W^2 - Fb/nu, free-slip at the
 *  top cell face, decaying into the solid: two RK4 shots combined */
function odeProfile(n, y0, W, h, Fb, nu) {
  const phi = y => 0.5 * (1 - Math.tanh((y - y0) / (Math.SQRT2 * W)));
  const shoot = (u0, v0, force) => {
    const dx = 1e-3, out = new Map();
    let y = -0.5, u = u0, v = v0;
    const f = (yy, uu) => 2 * h * phi(yy) ** 2 * uu / (W * W) - (force ? Fb / nu : 0);
    const want = Array.from({ length: n }, (_, j) => j);
    let k = 0;
    while (y < n - 0.5 - 1e-12) {
      if (k < want.length && y >= want[k] - 1e-9) { out.set(want[k], u); k++; }
      const k1u = v, k1v = f(y, u);
      const k2u = v + 0.5 * dx * k1v, k2v = f(y + 0.5 * dx, u + 0.5 * dx * k1u);
      const k3u = v + 0.5 * dx * k2v, k3v = f(y + 0.5 * dx, u + 0.5 * dx * k2u);
      const k4u = v + dx * k3v, k4v = f(y + dx, u + dx * k3u);
      u += (dx / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
      v += (dx / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      y += dx;
    }
    return { u: want.map(j => out.get(j) ?? u), uTop: u, vTop: v };
  };
  // the free-slip bottom face sits deep in solid; both shots start with u' = 0
  const p = shoot(Fb * W * W / (2 * h * nu), 0, true);   // particular, starts at the drag balance
  const q = shoot(1, 0, false);                         // homogeneous
  const a = -p.vTop / q.vTop;                           // u'(top) = 0
  return p.u.map((v, j) => v + a * q.u[j]);
}

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

try {
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
  await page.evaluate(() => window.__solidify.app.setRun(false));

  // FLOW-SHEAR-DECAY
  {
    const out = await page.evaluate(async () => {
      const { FlowSolver } = await import("/src/lbm.ts");
      const device = window.__solidify.sim().device;
      const n = 64, nu = 0.1, U = 0.01, k = Math.PI / n;
      const fs = new FlowSolver(device, n, { nu, uIn: 0, channel: false, width: 0 });
      fs.init((x, y) => [U * Math.cos(k * (y + 0.5)), 0]);
      const amp = async () => {
        const v = await fs.readVelocity();
        let s = 0, w = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const c = Math.cos(k * (y + 0.5)); s += v[(y * n + x) * 4] * c; w += c * c; }
        return s / w;
      };
      fs.step(200); const a0 = await amp(); const t0 = fs.steps;
      fs.step(2000); const a1 = await amp(); const t1 = fs.steps;
      fs.destroy();
      const nuMeas = -Math.log(a1 / a0) / (k * k * (t1 - t0));
      return { nuSet: nu, nuMeas, relErr: Math.abs(nuMeas / nu - 1), a0, a1 };
    });
    check("FLOW-SHEAR-DECAY", out.relErr <= 0.01 && out.a1 > 0 && out.a1 < out.a0, out);
  }

  // FLOW-DRAG-PROFILE (+ the h = 0 arm)
  const n = 64, y0 = 16, W = 1.25, nu = 3.3, Fb = 2.9e-5;
  const prof = await page.evaluate(async (n, y0, W, nu, Fb) => {
    const { FlowSolver } = await import("/src/lbm.ts");
    const device = window.__solidify.sim().device;
    const tex = device.createTexture({ size: [n, n], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const d = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) d[(y * n + x) * 4] = 0.5 * (1 - Math.tanh((y - y0) / (Math.SQRT2 * W)));
    device.queue.writeTexture({ texture: tex }, d, { bytesPerRow: n * 16 }, [n, n]);
    const run = async h => {
      const fs = new FlowSolver(device, n, { nu, uIn: 0, channel: false, width: W, h, force: [Fb, 0] });
      fs.setPhi(tex);
      fs.init(() => [0, 0]);
      for (let i = 0; i < 12; i++) { fs.step(1000); await device.queue.onSubmittedWorkDone(); }
      const v = await fs.readVelocity();
      fs.destroy();
      return Array.from({ length: n }, (_, y) => { let s = 0; for (let x = 0; x < n; x++) s += v[(y * n + x) * 4]; return s / n; });
    };
    const drag = await run(undefined), none = await run(0);
    tex.destroy();
    return { drag, none };
  }, n, y0, W, nu, Fb);
  {
    const h = F.deriveDragH();
    const ref = odeProfile(n, y0, W, h, Fb, nu);
    const peak = Math.max(...ref);
    const err = arr => Math.max(...arr.map((v, j) => Math.abs(v - ref[j]))) / peak;
    const solid = prof.drag.slice(0, y0 - 6).map(Math.abs);
    const ok = err(prof.drag) <= 0.02 && Math.max(...solid) <= 0.01 * peak && err(prof.none) > 0.2;
    check("FLOW-DRAG-PROFILE", ok, {
      h: +h.toFixed(4), tau: +(0.5 + 3 * nu).toFixed(2), peak: +peak.toExponential(3),
      maxErrOfPeak: +err(prof.drag).toFixed(4), deepSolidOfPeak: +(Math.max(...solid) / peak).toExponential(2),
      noDragArmErrOfPeak: +err(prof.none).toFixed(3),
    });
  }

  // FLOW-FREESTREAM
  {
    const out = await page.evaluate(async () => {
      const { FlowSolver } = await import("/src/lbm.ts");
      const device = window.__solidify.sim().device;
      const n = 64, U = 0.02;
      const fs = new FlowSolver(device, n, { nu: 0.2, uIn: U, channel: true, width: 0 });
      for (let i = 0; i < 4; i++) { fs.step(1000); await device.queue.onSubmittedWorkDone(); }
      const v = await fs.readVelocity();
      fs.destroy();
      let dev = 0;
      for (let i = 0; i < n * n; i++) dev = Math.max(dev, Math.hypot(v[i * 4] - U, v[i * 4 + 1]));
      return { U, maxDeviationOfU: dev / U };
    });
    check("FLOW-FREESTREAM", out.maxDeviationOfU <= 1e-3, out);
  }
  // -------------------------------------------------------------------------
  // FLOW-OFF-IDENTITY
  let baseline = null;
  {
    if (!existsSync(BASELINE)) check("FLOW-OFF-IDENTITY", false, { why: "no baseline: run scripts/capture-flow-baseline.mjs on the pre-advection commit" });
    else {
      baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
      const now = await captureFlowOffCases(page);
      const diff = Object.keys(baseline.cases).filter(k => now[k]?.state !== baseline.cases[k].state || now[k]?.grain !== baseline.cases[k].grain);
      check("FLOW-OFF-IDENTITY", diff.length === 0 && Object.keys(baseline.cases).length === 7, { baselineCommit: baseline.commit, cases: Object.keys(now).length, differ: diff });
    }
  }

  // FLOW-INERT-ARMS
  {
    const zero = await runFlowCase(page, { split: true, flow: { u: 0 } });
    const off0 = await runFlowCase(page, { split: true, flow: { u: 0.02, scale: 0 } });
    const ref = baseline?.cases["kobayashi-split"];
    check("FLOW-INERT-ARMS", !!ref && zero.state === ref.state && zero.grain === ref.grain && off0.state === ref.state && off0.grain === ref.grain,
      { zeroSpeed: zero.state === ref?.state, couplingZero: off0.state === ref?.state });
  }

  // FLOW-UNIFORM-MELT
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, sim = S.sim(), f = sim.step; sim.step = () => 0;
      try {
        S.setSolver(0); sim.splitPasses = false;
        Object.assign(sim.params, { scen: 0, heatIn: 0, coolRate: 0, alloyOn: 0 });
        sim.flowCfg.u = 0.02; sim.flowCfg.scale = 1;
        const why = sim.setFlow(true); if (why) return { why };
        sim.reset(0.4);
        for (let k = 0; k < 20; k++) await sim.stepSync(100);
        const n = sim.n, r = await sim.readRows(0, n);
        let dev = 0, bad = 0;
        for (let i = 0; i < n * n; i++) { const T = r[i * 4 + 1]; if (!Number.isFinite(T)) bad++; else dev = Math.max(dev, Math.abs(T - 0.4)); }
        return { maxDeviation: dev, nonFinite: bad, steps: 2000 };
      } finally { sim.setFlow(false); sim.step = f; }
    });
    check("FLOW-UNIFORM-MELT", !out.why && out.nonFinite === 0 && out.maxDeviation <= 1e-4, out);
  }

  // FLOW-DIRECTION
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, sim = S.sim(), f = sim.step; sim.step = () => 0;
      const reach = async () => {
        const n = sim.n, y = n / 2, row = await sim.readRows(y, 1);
        let west = 0, east = 0;
        for (let x = n / 2; x >= 0 && row[x * 4] >= 0.5; x--) west = n / 2 - x;
        for (let x = n / 2; x < n && row[x * 4] >= 0.5; x++) east = x - n / 2;
        return { west, east };
      };
      const run = async (flow) => {
        S.setSeed(0x51f0); S.setSolver(0);
        Object.assign(sim.params, { scen: 0, heatIn: 0, coolRate: 0, alloyOn: 0, twinProb: 0, noiseAmp: 0 });
        if (flow) { Object.assign(sim.flowCfg, flow); const why = sim.setFlow(true); if (why) throw new Error(why); }
        else { sim.setFlow(false); sim.splitPasses = true; }
        sim.reset(1 - 0.65);
        sim.addSeed(sim.n / 2, sim.n / 2, 4, 0);
        for (let i = 0; i < 3; i++) await sim.stepSync(0);
        for (let k = 0; k < 40; k++) await sim.stepSync(50);
        const r = await reach();
        sim.setFlow(false); sim.splitPasses = false; Object.assign(sim.flowCfg, { u: 0.02, scale: 1 });
        return r;
      };
      try {
        const none = await run(null), fwd = await run({ u: 0.03, scale: 1 }), rev = await run({ u: 0.03, scale: -1 });
        return { none, fwd, rev,
          upstream: +(fwd.west / none.west).toFixed(3), downstream: +(fwd.east / none.east).toFixed(3),
          reversedUpstream: +(rev.west / none.west).toFixed(3) };
      } finally { sim.step = f; }
    });
    const ok = out.none.west > 20 && out.upstream > 1.05 && out.downstream < 0.95 && out.reversedUpstream < 1;
    check("FLOW-DIRECTION", ok, out);
  }

  // FLOW-UI — the operator surface: the rail's "melt flow" checkbox starts the
  // flow; the overlay changes pixels but never the field; a refused scenario
  // (weld) stops it with its sentence on screen; a share link restarts it at
  // the same inlet speed through the same predicate.
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, sim = () => S.sim();
      S.setSolver(0); sim().params.scen = 0; sim().params.alloyOn = 0;
      const label = [...document.querySelectorAll("#rail label.checkrow")].find(l => l.textContent.trim() === "melt flow");
      if (!label) return { found: false };
      const box = label.querySelector("input");
      box.click();
      await new Promise(r => setTimeout(r, 200));
      const started = sim().flowOn;
      S.app.setRun(true);
      await new Promise(r => setTimeout(r, 1500));
      S.app.setRun(false);
      await new Promise(r => setTimeout(r, 200));
      // overlay on vs off: pixels differ, the field does not
      const grab = () => { const c = document.getElementById("canvas"), o = document.createElement("canvas"); o.width = 200; o.height = 150;
        const x = o.getContext("2d"); x.drawImage(c, 0, 0, 200, 150); return x.getImageData(0, 0, 200, 150).data; };
      const fnv = a => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
      const n = sim().n, h0 = fnv(await sim().readRows(0, n));
      const r = S.r2();
      r.flowView = true; r.render(sim(), 0, 1.0); const on = grab();
      r.flowView = false; r.render(sim(), 0, 1.0); const off = grab();
      r.flowView = true;
      await sim().device.queue.onSubmittedWorkDone();
      const h1 = fnv(await sim().readRows(0, n));
      let diff = 0; for (let i = 0; i < on.length; i += 4) diff += Math.abs(on[i] - off[i]) + Math.abs(on[i + 2] - off[i + 2]);
      // the share link carries the inlet speed
      const link = S.app.shareLink();
      const u = sim().flowCfg.u;
      // a refused scenario stops the flow with its reason
      sim().params.scen = 2; S.ui.sync();
      await new Promise(r => setTimeout(r, 300));
      const stopped = !sim().flowOn, why = S.ui ? document.querySelector("#rail .subpanel .hint:not([style*='none'])")?.textContent ?? "" : "";
      sim().params.scen = 0;
      return { found: true, started, overlayPixelDiff: diff / (on.length / 4), fieldUnchanged: h0 === h1, stopped, why, link, u };
    });
    let restored = null;
    if (out.found && out.link) {
      const p2 = await browser.newPage();
      await p2.goto(out.link.startsWith("http") ? out.link : `http://localhost:${PORT}/app/${out.link}`, { waitUntil: "networkidle0" });
      await p2.waitForFunction("!!window.__solidify", { timeout: 20000 });
      await new Promise(r => setTimeout(r, 800));
      restored = await p2.evaluate(() => ({ on: window.__solidify.sim().flowOn, u: window.__solidify.sim().flowCfg.u }));
      await p2.close();
    }
    const ok = out.found && out.started && out.overlayPixelDiff > 0.5 && out.fieldUnchanged && out.stopped && /scenario/i.test(out.why)
      && restored?.on && Math.abs(restored.u - out.u) < 1e-9;
    check("FLOW-UI", ok, { ...out, link: undefined, restored });
  }

  // FLOW-TIP-TONG (pre-registered protocol: tasks/todo.md "FLOW-TIP-TONG")
  {
    const A1 = 0.8839, A2 = 0.6267, DELTA = 0.55, EPS4 = 0.05, REF = 0.017, PR = 23.1, UD0D = 0.035;
    const arm = (lambda, flow) => page.evaluate(async ([lambda, flow, A1, A2, DELTA, EPS4, REF, PR, UD0D]) => {
      const S = window.__solidify;
      S.app.setRun(false);
      if (S.sim().n !== 1024) { S.app.setGrid(1024); for (let i = 0; i < 200 && S.sim().n !== 1024; i++) await new Promise(r => setTimeout(r, 50)); }
      const sim = S.sim(), f = sim.step; sim.step = () => 0;
      try {
        await sim.device.queue.onSubmittedWorkDone();
        S.app.setInoculant(0);
        const dx = 0.8, dTilde = A2 * lambda, dt = (0.15 * dx * dx) / Math.max(1, dTilde);
        Object.assign(sim.params, { solver: 1, lambda, dx, dt, epsBar: 1, tau: 1, delta: EPS4, aniMode: 4, noiseAmp: 0,
          latent: 1, dTherm: dTilde, dSol: dTilde, alloyOn: 0, coolRate: 0, heatIn: 0, scen: 0, twinProb: 0, facet: 0, frozenT: 0 });
        if (flow) {
          Object.assign(sim.flowCfg, { u: UD0D * (lambda / A1) * 0.15 * dx, pr: PR, scale: flow.scale });
          const why = sim.setFlow(true);
          if (why) return { why };
        } else sim.setFlow(false);
        sim.reset(1 - DELTA);
        sim.addSeed(sim.n / 2, sim.n / 2, 8 / dx, 0);
        await sim.stepSync(0);
        const mid = sim.n / 2;
        const westTip = async () => {
          const d = await sim.readRows(mid, 1);
          for (let i = mid; i > 0; i--) if (d[i * 4] >= 0.5 && d[(i - 1) * 4] < 0.5) {
            const a = d[(i - 1) * 4], b = d[i * 4];
            return (i - 1) + (0.5 - a) / (b - a);
          }
          return NaN;
        };
        const vGuess = (REF * dTilde * lambda) / A1, travel = (8 * dTilde) / vGuess, NS = 33;
        const chunk = Math.max(50, Math.round(travel / vGuess / NS / dt));
        const trace = [];
        let t = 0;
        for (let k = 0; k < NS; k++) {
          await sim.stepSync(chunk);
          t += chunk * dt;
          const x = await westTip();
          trace.push({ t, x });
          if (!(x > sim.n * 0.12)) break;
        }
        const third = trace.slice(2 * Math.floor(trace.length / 3));
        let sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (const p of third) { sx += p.t; sy += p.x; sxy += p.t * p.x; sxx += p.t * p.t; }
        const slope = (third.length * sxy - sx * sy) / (third.length * sxx - sx * sx);   // cells per tau0, negative (westward)
        return { lambda, v: -slope * dx, chunk, samples: trace.length, tipX: trace.at(-1)?.x, trace: trace.map(p => +p.x.toFixed(2)) };
      } finally { sim.setFlow(false); Object.assign(sim.flowCfg, { u: 0.02, pr: 23.1, scale: 1 }); sim.step = f; }
    }, [lambda, flow, A1, A2, DELTA, EPS4, REF, PR, UD0D]);
    const rows = [];
    for (const lambda of [2.0, 2.4, 3.2]) {
      const none = await arm(lambda, null), fwd = await arm(lambda, { scale: 1 });
      rows.push({ lambda, vNoFlow: none.v, vFlow: fwd.v, ratio: fwd.v / none.v, samples: [none.samples, fwd.samples],
        Vd0overD: (none.v * A1) / (A2 * lambda * lambda), why: none.why ?? fwd.why });
    }
    const zero = await arm(2.4, { scale: 0 }), rev = await arm(2.4, { scale: -1 });
    const base24 = rows.find(r => r.lambda === 2.4);
    const ratios = rows.map(r => r.ratio), mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const spread = (Math.max(...ratios) - Math.min(...ratios)) / mean;
    const inBand = rows.every(r => r.ratio >= 1.26 && r.ratio <= 1.54);
    const zeroExact = zero.v === base24?.vNoFlow, revBelow = rev.v / base24.vNoFlow < 1;
    check("FLOW-TIP-TONG", inBand && spread < 0.05 && zeroExact && revBelow, {
      band: "[1.26, 1.54] every lambda, spread < 5 %", rows: rows.map(r => ({ lambda: r.lambda, ratio: +r.ratio.toFixed(3),
        Vd0overD_noflow: +r.Vd0overD.toExponential(3), samples: r.samples, why: r.why })),
      spread: +spread.toFixed(4), couplingZeroRatio: +(zero.v / base24.vNoFlow).toFixed(6), couplingReversedRatio: +(rev.v / base24.vNoFlow).toFixed(3),
    });
  }
} catch (e) {
  console.log("FLOW harness error", String(e?.stack ?? e));
  FAIL();
} finally {
  console.log("PAGE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 6)) : "none");
  if (errors.length) FAIL();
  await closeBrowser(browser);
}
console.log(failures ? `done — ${failures} FAILED` : "done");
process.exit(failures ? 1 : 0);
