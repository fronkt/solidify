import { closeBrowser } from "./browser-cleanup.mjs";
// FLOW3-* — D3.1, the standalone lattice Boltzmann solver, on a real GPU.
// Fluid only: nothing here couples into the phase field (that is D3.2).
// Design: docs/D3-CONVECTION-DESIGN.md section 4.
//
//   FLOW-SHEAR-DECAY   a cos shear wave between free-slip walls decays as
//                      exp(-nu k^2 t): the measured viscosity equals the set
//                      one within 1 % (analytic).
//   FLOW-DRAG-PROFILE  body-force-driven flow over a diffuse solid (this repo's
//                      tanh profile, W = 1.25 cells) at tau ~ 10.4: the
//                      apparent no-slip plane, read off a parabola fitted to
//                      the drag-free liquid, sits within 0.1 W of phi = 0.5;
//                      the profile matches an independent CPU solve of
//                      u'' = 2h phi^2 u / W^2 - F / nu within 2 % of the peak
//                      and is near zero deep in the solid. Must-miss arms
//                      (S0 review, pre-registered in tasks/todo.md): h x 2 and
//                      h / 2 each move the plane >= 0.1 W, on a steady,
//                      bounded profile. The old h = 0 arm is gone: with no
//                      drag a periodic body-forced channel has no steady
//                      state and failed by accelerating (Mach 0.6), and a 2x
//                      drag error stayed inside the 2 % profile band.
//   FLOW-FREESTREAM    a uniform inlet stream through an empty free-slip
//                      channel stays uniform (inlet/outlet boundaries).
//
//   node scripts/verify-flow-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { captureFlowOffCases, runFlowCase } from "./fixtures/flow-off-cases.mjs";
import { INLET_GATES, inletReference, inletStats, inletVerdicts, fieldOfTexture } from "./fixtures/lbm-ref.mjs";
// D3.2 (coupling) adds:
//   FLOW-OFF-IDENTITY   with flow off, seven 2D cases hash exactly as they did
//                       at the commit before advection existed
//                       (scripts/fixtures/flow-off-baseline.json).
//   FLOW-INERT-ARMS     flow on at zero inlet speed, and flow on with the
//                       coupling set to 0, both reproduce the flow-off split
//                       pass bit for bit (the LBM ran; advection added nothing).
//   FLOW-UNIFORM-MELT   an all-liquid melt at the far-field temperature stays
//                       uniform under flow (the advection operator and its
//                       inlet/outlet faces are consistent), with the flow
//                       read back moving at the inlet speed (liveness). A
//                       consistency check: a uniform field's fluxes cancel
//                       under either coupling sign, so the sign is
//                       FLOW-DIRECTION's (its reversed arm). A zero-bound
//                       velocity texture IS seen here: the inlet face flux is
//                       the params' u_in tFar, which would then heat the
//                       first column by u_in tFar every substep.
//   FLOW-RECONFIGURE    (S0 review, pre-registered) the running flow follows
//                       the dials: a Kobayashi-to-calibrated switch
//                       re-configures the lattice viscosity and drag width on
//                       the next submit, and a dt that breaks the envelope
//                       keeps the last passing setting until the app frame
//                       switches the flow off with the Peclet reason. Arm: the
//                       latched setting (flowNow patched) fails the switch.
//   FLOW-DIRECTION      Kobayashi, qualitative: with flow from the west the
//                       upstream arm outgrows the no-flow arm by > 5 % and the
//                       downstream arm falls short by > 5 %; with the coupling
//                       reversed (-1) the upstream arm falls short instead.
// D3.5 (the velocity inlet; pre-registered in tasks/todo.md, "D3.5 velocity
// inlet - 2026-11-07", da91d87). Setting nu 3.465, u_lat 0.011404 (D3.4's
// n 848 arm). Each gate runs the default (Zou-He) inlet and a MUST-MISS arm
// with the pre-D3.5 equilibrium inlet (FlowConfig.inlet, test harness only);
// both fields go through the same statistics as a Float64 CPU reference of the
// same step (scripts/fixtures/lbm-ref.mjs), run here on the Node side.
//   FLOW-INLET-EMPTY    an empty 64^2 channel started at U/2 (a speed change):
//                       the column-mean velocity is U within 1e-3 at every
//                       column; the old inlet stays short (CPU: 0.873 U).
//   FLOW-INLET-BLOCKED  a 128^2 channel with a disk of radius 9.6 cells
//                       (blockage 0.15): the column-mean velocity is within
//                       2 % of U at every column, steady, mass-conserving and
//                       within 2e-3 of the CPU reference; the old inlet
//                       delivers 0.83 U, as predicted, on an equally valid run.
//   FLOW-INLET-COLUMN   every inlet node, corners included, carries (U, 0)
//                       within 1e-4 of U; the old inlet's do not.
//   FLOW-INLET-APP      the app's own path (sim.ts, no inlet named), Kobayashi
//                       with a growing crystal, after the rail's speed dial:
//                       the inlet column carries the dialled speed.
const BASELINE = new URL("./fixtures/flow-off-baseline.json", import.meta.url);

const PORT = process.argv[3] ?? "5199";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const F = await vite.ssrLoadModule("/src/flow.ts");
await vite.close();

// D3.5: the Float64 CPU reference of the two inlet geometries, both inlets,
// computed before the browser starts (about a minute). The GPU fields go
// through the same statistics (lbm-ref.mjs inletStats).
const G5 = INLET_GATES, H5 = F.deriveDragH(), DRAGK5 = (2 * H5 * G5.nu) / (G5.W * G5.W);
const OPTS5 = { probe: G5.B.probe, gapColumn: G5.B.gapColumn, dragK: DRAGK5 };
const b64f32 = s => new Float32Array(new Uint8Array(Buffer.from(s, "base64")).buffer);
const cpu5 = { velocity: inletReference("velocity", H5), equilibrium: inletReference("equilibrium", H5) };

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

  // FLOW-DRAG-PROFILE (+ the h x 2 and h / 2 must-miss arms)
  const n = 64, y0 = 16, W = 1.25, nu = 3.3, Fb = 2.9e-5;
  const hDrag = F.deriveDragH();
  const prof = await page.evaluate(async (n, y0, W, nu, Fb, hDrag) => {
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
    const drag = await run(hDrag), twice = await run(2 * hDrag), half = await run(hDrag / 2);
    tex.destroy();
    return { drag, twice, half };
  }, n, y0, W, nu, Fb, hDrag);
  {
    const h = hDrag;
    const ref = odeProfile(n, y0, W, h, Fb, nu);
    const peak = Math.max(...ref);
    const err = arr => Math.max(...arr.map((v, j) => Math.abs(v - ref[j]))) / peak;
    const solid = prof.drag.slice(0, y0 - 6).map(Math.abs);
    // the apparent no-slip plane: a least-squares parabola over the drag-free
    // liquid (phi < 4e-5 from y0 + 9; the top two rows next to the free-slip
    // wall left out), its root on the solid side, in W from phi = 0.5
    const offsetW = u => {
      const ys = [], us = [];
      for (let y = y0 + 9; y <= n - 3; y++) { ys.push(y); us.push(u[y]); }
      const yc = ys.reduce((a, b) => a + b, 0) / ys.length;
      const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
      ys.forEach((y, i) => {
        const x = [(y - yc) ** 2, y - yc, 1];
        for (let p = 0; p < 3; p++) { r[p] += x[p] * us[i]; for (let q = 0; q < 3; q++) M[p][q] += x[p] * x[q]; }
      });
      const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const d0 = det(M);
      const [a, b, c] = [0, 1, 2].map(k => det(M.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / d0);
      const disc = Math.sqrt(b * b - 4 * a * c);
      const yw = Math.min((-b - disc) / (2 * a), (-b + disc) / (2 * a)) + yc;
      return (yw - y0) / W;
    };
    const sane = arr => arr.every(Number.isFinite) && Math.abs(Math.max(...arr) / Math.max(...prof.drag) - 1) <= 0.05;
    const off = { h: offsetW(prof.drag), twice: offsetW(prof.twice), half: offsetW(prof.half) };
    const planeOk = Math.abs(off.h) < 0.1;
    const armsMiss = Math.abs(off.twice) >= 0.1 && Math.abs(off.half) >= 0.1 && sane(prof.twice) && sane(prof.half);
    const ok = planeOk && armsMiss && err(prof.drag) <= 0.02 && Math.max(...solid) <= 0.01 * peak;
    check("FLOW-DRAG-PROFILE", ok, {
      h: +h.toFixed(4), tau: +(0.5 + 3 * nu).toFixed(2), peak: +peak.toExponential(3),
      noSlipOffsetW: Object.fromEntries(Object.entries(off).map(([k, v]) => [k, +v.toFixed(4)])),
      planeOk, armsMiss, armsSane: [sane(prof.twice), sane(prof.half)],
      armPeakRatio: [Math.max(...prof.twice), Math.max(...prof.half)].map(p => +(p / Math.max(...prof.drag)).toFixed(4)),
      maxErrOfPeak: +err(prof.drag).toFixed(4), deepSolidOfPeak: +(Math.max(...solid) / peak).toExponential(2),
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
  // D3.5 FLOW-INLET-EMPTY / -BLOCKED / -COLUMN (pre-registered, da91d87). The
  // page runs the solver and ships the raw velocity textures (u.x, u.y, rho,
  // K) back; every statistic is computed here by inletStats, the function the
  // CPU reference's fields go through too.
  {
    const gpu = await page.evaluate(async (P) => {
      const { FlowSolver } = await import("/src/lbm.ts");
      const device = window.__solidify.sim().device;
      const b64 = a => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = "";
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
      const settle = async (fs, k) => { for (let i = 0; i < k / 1000; i++) { fs.step(1000); await device.queue.onSubmittedWorkDone(); } };
      const B = P.B, nB = B.n;
      // the disk as lbm-ref.mjs diskPhi builds it, stored f32 in .r
      const tex = device.createTexture({ size: [nB, nB], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const d = new Float32Array(nB * nB * 4);
      for (let y = 0; y < nB; y++) for (let x = 0; x < nB; x++)
        d[(y * nB + x) * 4] = 0.5 * (1 - Math.tanh((Math.hypot(x - B.cx, y - B.cy) - B.R) / (Math.SQRT2 * P.W)));
      device.queue.writeTexture({ texture: tex }, d, { bytesPerRow: nB * 16 }, [nB, nB]);
      const out = {};
      try {
        for (const inlet of ["velocity", "equilibrium"]) {
          // A: empty channel, started at U/2 with the inlet at U
          const a = new FlowSolver(device, P.A.n, { nu: P.nu, uIn: P.U, channel: true, width: 0, inlet });
          a.init(() => [P.A.start * P.U, 0]);
          await settle(a, P.A.steps);
          const vA = await a.readVelocity(), stepsA = a.steps;
          a.destroy();
          // B: the disk, from the app's uniform start
          const b = new FlowSolver(device, nB, { nu: P.nu, uIn: P.U, channel: true, width: P.W, inlet });
          b.setPhi(tex);
          await settle(b, B.mid);
          const vMid = await b.readVelocity();
          await settle(b, B.steps - B.mid);
          const vB = await b.readVelocity(), stepsB = b.steps;
          b.destroy();
          out[inlet] = { A: b64(vA), stepsA, Bmid: b64(vMid), B: b64(vB), stepsB };
        }
      } finally { tex.destroy(); }
      return out;
    }, G5);
    const g5 = {};
    for (const inlet of ["velocity", "equilibrium"]) {
      const r = gpu[inlet];
      g5[inlet] = { stepsA: r.stepsA, stepsB: r.stepsB,
        A: inletStats(G5.A.n, G5.U, fieldOfTexture(b64f32(r.A))),
        Bmid: inletStats(G5.B.n, G5.U, fieldOfTexture(b64f32(r.Bmid)), OPTS5),
        B: inletStats(G5.B.n, G5.U, fieldOfTexture(b64f32(r.B)), OPTS5) };
    }
    // the verdicts and their bands live in lbm-ref.mjs inletVerdicts (pure;
    // verify-flow.mjs runs it on the reference's own statistics)
    const v5 = inletVerdicts(g5, cpu5);
    check("FLOW-INLET-EMPTY", v5.empty.ok, v5.empty.detail);
    check("FLOW-INLET-BLOCKED", v5.blocked.ok, v5.blocked.detail);
    check("FLOW-INLET-COLUMN", v5.column.ok, v5.column.detail);
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
        // liveness (S0 review): the flow this melt stayed uniform under was
        // really moving, at the inlet speed, in the texture the sim exposes
        const tex = sim.flowVelocity, bpr = n * 16;
        const buf = sim.device.createBuffer({ size: bpr * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const enc = sim.device.createCommandEncoder();
        enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [n, n]);
        sim.device.queue.submit([enc.finish()]);
        await buf.mapAsync(GPUMapMode.READ);
        const v = new Float32Array(buf.getMappedRange().slice(0));
        buf.unmap(); buf.destroy();
        let ux = 0;
        for (let i = 0; i < n * n; i++) ux += v[i * 4];
        return { maxDeviation: dev, nonFinite: bad, steps: 2000, meanUxOfInlet: +(ux / (n * n) / sim.flowCfg.u).toFixed(4) };
      } finally { sim.setFlow(false); sim.step = f; }
    });
    const moving = Math.abs(out.meanUxOfInlet - 1) <= 0.02;
    check("FLOW-UNIFORM-MELT", !out.why && out.nonFinite === 0 && out.maxDeviation <= 1e-4 && moving, { ...out, moving });
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

  // FLOW-INLET-APP (D3.5, pre-registered): the inlet the APP runs, through
  // sim.ts (whose configure names no inlet), with a crystal in the channel and
  // after the rail's speed dial (S.app.setFlowU, which re-initialises the flow
  // at the new speed). Staged as FLOW-DIRECTION. Reported, not gating: the same
  // run with the solver's configure patched to the pre-D3.5 equilibrium inlet.
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify, sim = S.sim(), f = sim.step; sim.step = () => 0;
      const readVel = async () => {
        const n = sim.n, tex = sim.flowVelocity, bpr = n * 16;
        const buf = sim.device.createBuffer({ size: bpr * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const enc = sim.device.createCommandEncoder();
        enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [n, n]);
        sim.device.queue.submit([enc.finish()]);
        await buf.mapAsync(GPUMapMode.READ);
        const v = new Float32Array(buf.getMappedRange().slice(0));
        buf.unmap(); buf.destroy();
        return v;
      };
      const run = async (patchOld) => {
        S.setSeed(0x51f0); S.setSolver(0);
        Object.assign(sim.params, { scen: 0, heatIn: 0, coolRate: 0, alloyOn: 0, twinProb: 0, noiseAmp: 0 });
        Object.assign(sim.flowCfg, { u: 0.02, scale: 1 });
        const why = sim.setFlow(true);
        if (why) return { why };
        const fl = sim.flow;
        if (patchOld) { const c = fl.configure.bind(fl); fl.configure = cfg => c({ ...cfg, inlet: "equilibrium" }); fl.configure(fl.cfg); }
        sim.reset(1 - 0.65);
        sim.addSeed(sim.n / 2, sim.n / 2, 4, 0);
        for (let i = 0; i < 3; i++) await sim.stepSync(0);
        let substeps = 0;
        const lbm0 = fl.steps;
        for (let k = 0; k < 20; k++) substeps += await sim.stepSync(50);
        const lbmBefore = fl.steps - lbm0;
        S.app.setFlowU(0.03);                      // the rail's dial: re-initialises at 0.03
        if (sim.flow !== fl) return { why: "the dial replaced the solver" };
        const lbm1 = fl.steps;
        for (let k = 0; k < 20; k++) substeps += await sim.stepSync(50);
        const lbmAfter = fl.steps - lbm1, U = sim.flowCfg.u, n = sim.n;
        const v = await readVel();
        let inletX = 0, inletY = 0;
        const V = new Float64Array(n), Rm = new Float64Array(n);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const k = (y * n + x) * 4;
          V[x] += v[k] / n / U; Rm[x] += v[k + 2] / n;
          if (x === 0) { inletX = Math.max(inletX, Math.abs(v[k] / U - 1)); inletY = Math.max(inletY, Math.abs(v[k + 1]) / U); }
        }
        const row = await sim.readRows(n / 2, 1);
        let west = 0;
        for (let x = n / 2; x >= 0 && row[x * 4] >= 0.5; x--) west = n / 2 - x;
        sim.setFlow(false); sim.splitPasses = false; Object.assign(sim.flowCfg, { u: 0.02, scale: 1 });
        return { U, n, substeps, lbmSteps: lbmBefore + lbmAfter, inletX, inletY, west,
          Vmin: Math.min(...V), Vmax: Math.max(...V), rhoIn: Rm[0], rhoOut: Rm[n - 1] };
      };
      try {
        return { app: await run(false), oldInlet: await run(true) };
      } finally { sim.setFlow(false); sim.splitPasses = false; Object.assign(sim.flowCfg, { u: 0.02, scale: 1 }); sim.step = f; }
    });
    const a = out.app ?? {};
    const live = a.west > 20 && a.lbmSteps === 2000 && a.substeps === 2000;
    const ok = !a.why && Math.abs(a.U - 0.03) < 1e-12 && a.inletX <= 1e-4 && a.inletY <= 1e-4 && live;
    const r = o => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" && !Number.isInteger(v) ? +v.toPrecision(5) : v]));
    check("FLOW-INLET-APP", ok, { app: r(a), live, oldInletInfoOnly: r(out.oldInlet), oldInletMisses: (out.oldInlet?.inletX ?? 0) > 1e-4 });
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

  // FLOW-RECONFIGURE (S0 review; pre-registered in tasks/todo.md). LAST, on
  // purpose: it switches the material to "al" (the calibrated solver needs
  // one), which no earlier gate's numbers may inherit.
  {
    const out = await page.evaluate(async () => {
      const S = window.__solidify;
      S.app.setMaterial("al");
      const sim = S.sim(), f = sim.step;
      sim.step = () => 0;
      const { flowSetting } = await import("/src/flow.ts");
      const dials = () => ({ dTherm: sim.params.dTherm, dt: sim.params.dt, dx: sim.params.dx, epsBar: sim.params.epsBar,
        calibrated: sim.params.solver === 1 });
      const cfg = () => { const c = sim.flow?.cfg; return c ? { nu: c.nu, width: c.width } : null; };
      const want = () => { const s = flowSetting(dials(), sim.flowCfg); return { nu: s.nu, width: s.width, issues: s.issues.length }; };
      const sequence = async latched => {
        S.setSolver(0);
        Object.assign(sim.params, { scen: 0, heatIn: 0, coolRate: 0, alloyOn: 0 });
        Object.assign(sim.flowCfg, { u: 0.02, scale: 1 });
        const why = sim.setFlow(true);
        if (why) return { why };
        // the must-miss arm: the setting captured at setFlow, forever (pre-0de30b2)
        if (latched) { const s = sim.flowNow(); sim.flowNow = () => s; }
        sim.reset(0.4);
        await sim.stepSync(1);
        const kob = cfg(), wantKob = want();
        S.setSolver(1, 2.4);
        const calibrated = sim.params.solver === 1;
        await sim.stepSync(1);
        const cal = cfg(), wantCal = want();
        S.setSolver(0);
        await sim.stepSync(1);
        return { kob, wantKob, calibrated, cal, wantCal, back: cfg() };
      };
      let dtK = null;
      try {
        const live = await sequence(false);
        if (live.why) return { why: live.why };
        // a dt the envelope refuses: ONE submit, synchronously, so no frame can
        // switch the flow off in between; then one app frame
        dtK = sim.params.dt;
        sim.params.dt = dtK / 200;
        f.call(sim, 1);
        const held = cfg(), unchecked = want();
        await sim.device.queue.onSubmittedWorkDone();
        await S.tick(1);
        const stopped = !sim.flowOn, issue = S.app.flowIssue();
        sim.params.dt = dtK; dtK = null;
        sim.setFlow(false);
        const latchedArm = await sequence(true);
        return { live, held, unchecked, stopped, issue, latchedArm };
      } finally {
        if (dtK != null) sim.params.dt = dtK;
        delete sim.flowNow;
        sim.setFlow(false); S.setSolver(0); sim.step = f;
        Object.assign(sim.flowCfg, { u: 0.02, scale: 1 });
      }
    });
    const same = (a, b) => !!a && !!b && a.nu === b.nu && a.width === b.width;
    const L = out.live ?? {};
    const followsSwitch = a => same(a.cal, a.wantCal) && !!a.cal && !!a.kob && a.cal.nu !== a.kob.nu && a.cal.width !== a.kob.width;
    const ok = !out.why && L.calibrated && same(L.kob, L.wantKob) && followsSwitch(L) && same(L.back, L.wantKob)
      && same(out.held, L.back) && out.unchecked.issues >= 1 && out.stopped && /Peclet/.test(out.issue ?? "")
      && out.latchedArm?.calibrated && !followsSwitch(out.latchedArm);
    check("FLOW-RECONFIGURE", ok, { ...out, followsSwitch: !!out.live && followsSwitch(L), latchedArmFollows: !!out.latchedArm && followsSwitch(out.latchedArm) });
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
