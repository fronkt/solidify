// FLOW-* — D3 melt flow arithmetic (slice D3.0, and the setting the running
// flow re-derives from the dials), checked without a browser. D3.5 adds the
// velocity inlet: its algebra, a Float64 reference of the lattice step on the
// GPU gates' two channels with both inlets (about a minute of CPU), and the
// default the app runs.
// Design and citations: docs/D3-CONVECTION-DESIGN.md.
//
//   node scripts/verify-flow.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const F = await server.ssrLoadModule("/src/flow.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

// 1. FLOW-H-PLANAR — integrated across this repo's own interface profile, the
//    planar shear equation puts the apparent no-slip plane at phi = 0.5 within
//    1e-3 W for the derived h, and the derived h agrees with Tong et al.'s
//    published 2.757 to its quoted precision. Falsification arm: h = 2 misses
//    by more than 0.1 W, so the gate can fail.
{
  const h = F.deriveDragH();
  const atDerived = F.noSlipOffset(h), atPublished = F.noSlipOffset(F.DRAG_H_PUBLISHED), atTwo = F.noSlipOffset(2);
  // a coarser integration must agree: the offset is a property of the ODE, not of dx
  const coarse = F.noSlipOffset(F.DRAG_H_PUBLISHED, F.calibratedProfile, 12, 4e-3);
  const ok = Math.abs(atDerived) < 1e-3 && Math.abs(h - F.DRAG_H_PUBLISHED) < 5e-3
    && Math.abs(atPublished) < 1e-3 && Math.abs(atTwo) > 0.1 && Math.abs(coarse - atPublished) < 1e-4;
  check("FLOW-H-PLANAR", ok, {
    derivedH: +h.toFixed(4), published: F.DRAG_H_PUBLISHED,
    offsetW: { derived: +atDerived.toExponential(2), published: +atPublished.toExponential(2), hTwo: +atTwo.toFixed(4) },
  });
}

// 2. FLOW-PARAMS — the lattice mapping at the design's benchmark (d = 0.15,
//    Pr = 23.1, U d0/D = 0.035 at d0/dx ~ 0.554 -> u_lat ~ 0.0095) and the
//    stability envelope driven on the inputs it must refuse.
{
  const l = F.latticeOf(0.15, 23.1, 0.0095);
  const safe = F.flowLimitIssues(l).length === 0;
  const lowNu = F.flowLimitIssues(F.latticeOf(0.15, 0.01, 0.001));
  const fast = F.flowLimitIssues(F.latticeOf(0.15, 23.1, 0.2));
  const pe = F.flowLimitIssues(F.latticeOf(0.01, 400, 0.05));
  const ok = Math.abs(l.tau - 10.895) < 1e-3 && l.mach < 0.1 && l.peCell < 2 && safe
    && lowNu.some(s => /relaxation/.test(s)) && fast.some(s => /Mach/.test(s)) && pe.some(s => /Peclet/.test(s));
  check("FLOW-PARAMS", ok, {
    benchmark: { tau: +l.tau.toFixed(3), mach: +l.mach.toFixed(4), peCell: +l.peCell.toFixed(3) },
    refusals: { lowViscosity: lowNu.length, fast: fast.length, highPeclet: pe.length },
  });
}

// 3. FLOW-REFUSAL — the one predicate, driven on every input it refuses and
//    on the one configuration it must allow.
{
  const base = { dim3: false, scenario: 0, frozenTemperature: false, alloy: false, grid: 512, busyMode: null };
  const cases = {
    allowed: F.flowRefusal(base),
    dim3: F.flowRefusal({ ...base, dim3: true }),
    scenario: F.flowRefusal({ ...base, scenario: 2 }),
    frozenPure: F.flowRefusal({ ...base, frozenTemperature: true }),
    frozenAlloy: F.flowRefusal({ ...base, frozenTemperature: true, alloy: true }),
    calibratedAlloy: F.flowRefusal({ ...base, calibrated: true, alloy: true }),
    calibratedPure: F.flowRefusal({ ...base, calibrated: true }),
    big: F.flowRefusal({ ...base, grid: 2048 }),
    busy: F.flowRefusal({ ...base, busyMode: "heat treatment" }),
  };
  const ok = cases.allowed === null && cases.frozenAlloy === null && cases.calibratedPure === null
    && [cases.dim3, cases.scenario, cases.frozenPure, cases.big, cases.busy, cases.calibratedAlloy].every(s => typeof s === "string" && s.length > 20);
  check("FLOW-REFUSAL", ok, Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v === null ? "allowed" : "refused"])));
}

// 4. IVANTSOV-2D — the no-flow limit the Tong comparison starts from: the 2D
//    Ivantsov relation inverts to itself, and at Delta = 0.55 gives the growth
//    Peclet number 0.257 that Tong et al. 2001's Fig. 4 starts at (read-off
//    precision +-0.01); erfc is checked at known values.
{
  const P = F.ivantsov2DPeclet(0.55);
  const round = Math.abs(F.ivantsov2D(P) - 0.55) < 1e-10;
  const erfcOk = Math.abs(F.erfc(0) - 1) < 1e-12 && Math.abs(F.erfc(1) - 0.157299207050285) < 1e-11
    && Math.abs(F.erfc(3) - 2.20904969985854e-5) < 1e-14;
  check("IVANTSOV-2D", round && erfcOk && Math.abs(P - 0.257) <= 0.01, { P: +P.toFixed(5), roundTrip: round, erfc: erfcOk });
}

// 5. FLOW-SETTING — the lattice setting the flow runs at is a function of the
//    dials as they are NOW (flowSetting; sim.ts re-derives it every submit).
//    At the dials setFlow saw it is the rule setFlow used to latch, so a flow
//    whose dials never move writes the same bytes. Across the solver switch it
//    MUST move: the stale Kobayashi setting under calibrated dials has the drag
//    3.1x too strong, the no-slip plane +0.5 W off (noSlipOffset, the same ODE
//    FLOW-H-PLANAR pins at 0), and a different Prandtl number. A dial that
//    breaks the envelope mid-flow is reported (the frame loop's reason). With
//    solute advected (Kobayashi alloy) its own cell Peclet number u / (D_s d)
//    is held to the limit too: at the rail's corner (u 0.05, solute D 0.2) it
//    is 1.88 and allowed; at D_s 0.15 it is 2.5 and refused, where the thermal
//    check alone passed it.
{
  const { DEFAULTS } = await server.ssrLoadModule("/src/sim.ts");
  const { A2, DT_SAFETY } = await server.ssrLoadModule("/src/quant.ts");
  const f = { u: 0.02, pr: 23.1 };
  const kob = { dTherm: DEFAULTS.dTherm, dt: DEFAULTS.dt, dx: DEFAULTS.dx, epsBar: DEFAULTS.epsBar, calibrated: false };
  // calibrated staging as QPF-TIP-KR / FLOW-TIP-TONG: lambda 2.4, dx = 0.8 W0, epsBar = 1
  const dTilde = A2 * 2.4, dxQ = 0.8;
  const cal = { dTherm: dTilde, dt: DT_SAFETY * dxQ * dxQ / Math.max(1, dTilde), dx: dxQ, epsBar: 1, calibrated: true };
  const latched = p => {   // the rule setFlow latched before the fix, verbatim
    const d = p.dTherm * p.dt / (p.dx * p.dx);
    return { nu: d * f.pr, width: (p.calibrated ? p.epsBar : 2 * p.epsBar) / p.dx };
  };
  const sK = F.flowSetting(kob, f), sQ = F.flowSetting(cal, f);
  const same = [kob, cal].every((p, i) => { const s = i ? sQ : sK, l = latched(p); return s.nu === l.nu && s.width === l.width && s.uIn === f.u; });
  const K = s => s.nu / (s.width * s.width);           // drag K / (2 h), per phi^2
  const ratio = K(sK) / K(sQ);
  const h = F.deriveDragH(), staleOffsetW = F.noSlipOffset(h * ratio);
  const prStale = sK.nu / (cal.dTherm * cal.dt / (cal.dx * cal.dx));
  const moved = sK.nu !== sQ.nu && sK.width !== sQ.width && Math.abs(ratio - 3.125) < 0.01 && staleOffsetW > 0.4;
  // the dt dial taken far down mid-flow: d falls, the cell Peclet number rises past 2
  const broken = F.flowSetting({ ...kob, dt: DEFAULTS.dt / 200 }, f).issues;
  const fast = { u: 0.05, pr: 23.1 };
  const corner = F.flowSetting({ ...kob, soluteD: 0.2 }, fast).issues;
  const thin = F.flowSetting({ ...kob, soluteD: 0.15 }, fast).issues;
  const heatOnly = F.flowSetting(kob, fast).issues;
  const solute = corner.length === 0 && thin.some(s => /solute cell Peclet/.test(s)) && heatOnly.length === 0;
  const ok = same && moved && sK.issues.length === 0 && sQ.issues.length === 0 && broken.some(s => /Peclet/.test(s)) && solute;
  check("FLOW-SETTING", ok, {
    sameAsLatchedRuleAtItsDials: same,
    kobayashi: { nu: +sK.nu.toFixed(4), width: +sK.width.toFixed(4) }, calibrated: { nu: +sQ.nu.toFixed(4), width: +sQ.width.toFixed(4) },
    staleDragRatio: +ratio.toFixed(4), staleNoSlipOffsetW: +staleOffsetW.toFixed(3), staleEffectivePr: +prStale.toFixed(2),
    brokenDialRefused: broken.length,
    solutePeclet: { railCornerAllowed: corner.length === 0, belowRailRefused: thin.length, thermalAloneAllowed: heatOnly.length === 0 },
  });
}

// ---------------------------------------------------------------------------
// D3.5 velocity inlet (tasks/todo.md, "D3.5 velocity inlet - 2026-11-07",
// pre-registered in da91d87 before any run of the new inlet). The reference is
// scripts/fixtures/lbm-ref.mjs, a Float64 copy of src/lbm.ts's step.
const R = await import("./fixtures/lbm-ref.mjs");

// 6. FLOW-INLET-ALGEBRA — the Zou-He reconstruction gives sum f = rho and
//    sum c f = (rho U, 0) exactly, on 2000 seeded non-equilibrium nodes, and
//    never reads the three populations it replaces (they are NaN going in). It
//    returns an equilibrium node unchanged. Must-miss arm: without the
//    transverse correction the y momentum is not zero.
{
  let s = 0x5eed1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const uni = (a, b) => a + (b - a) * rnd();
  const mom = f => f.reduce((a, v, i) => [a[0] + v, a[1] + R.CX[i] * v, a[2] + R.CY[i] * v], [0, 0, 0]);
  const worst = { mass: 0, jx: 0, jy: 0, normalPair: 0 };
  let missY = 0;
  for (let k = 0; k < 2000; k++) {
    const rho0 = uni(0.95, 1.05), ux = uni(-0.05, 0.05), uy = uni(-0.05, 0.05), U = uni(0, 0.05);
    const known = Array.from({ length: 9 }, (_, i) => R.feq(i, rho0, ux, uy) * (1 + uni(-0.05, 0.05)));
    for (const i of [1, 5, 8]) known[i] = NaN;
    const f = known.slice(), rho = R.zouHeWest(f, U), [m, jx, jy] = mom(f);
    worst.mass = Math.max(worst.mass, Math.abs(m - rho));
    worst.jx = Math.max(worst.jx, Math.abs(jx - rho * U));
    worst.jy = Math.max(worst.jy, Math.abs(jy));
    worst.normalPair = Math.max(worst.normalPair, Math.abs((f[1] - f[3]) - (2 / 3) * rho * U));
    // the arm: the same, minus the transverse correction on the diagonals
    const g = known.slice(), r2 = (g[0] + g[2] + g[4] + 2 * (g[3] + g[6] + g[7])) / (1 - U), j2 = r2 * U;
    g[1] = g[3] + (2 / 3) * j2; g[5] = g[7] + j2 / 6; g[8] = g[6] + j2 / 6;
    missY = Math.max(missY, Math.abs(mom(g)[2]));
  }
  let fixed = 0;
  for (const [rho0, U] of [[1, 0.011404004977938682], [0.97, 0.05], [1.03, 0], [1, 0.02]]) {
    const eq = Array.from({ length: 9 }, (_, i) => R.feq(i, rho0, U, 0));
    const f = eq.slice();
    for (const i of [1, 5, 8]) f[i] = NaN;
    const rho = R.zouHeWest(f, U);
    fixed = Math.max(fixed, Math.abs(rho - rho0), ...[1, 5, 8].map(i => Math.abs(f[i] - eq[i])));
  }
  const ok = Object.values(worst).every(v => v <= 1e-14) && fixed <= 1e-15 && missY > 1e-4;
  check("FLOW-INLET-ALGEBRA", ok, {
    worst: Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toExponential(2)])),
    fixedPoint: +fixed.toExponential(2), noTransverseMissY: +missY.toExponential(3),
  });
}

// 7. FLOW-INLET-CPU — the GPU gates' two geometries on the Float64 reference,
//    both inlets, at the D3.4 setting (nu 3.465, u_lat 0.011404, W 1.25 cells).
//    A: an empty 64^2 channel started at U/2 (a speed change), 8000 steps. B: a
//    128^2 channel with a disk of radius 9.6 cells (blockage 0.15) centred at
//    (64, 63.5), 14000 and 16000 steps. The statistic is the column-mean
//    velocity V(x) = mean_y u_x / U, the velocity transport reads; the mass
//    flux Q(x) carries the free density level of the zero-gradient outlet and
//    is a conservation witness only. The equilibrium arms are the inlet that
//    shipped before D3.5; they must miss, and must miss with a valid run.
{
  const NU = 0.15 * 23.1, U = 0.011404004977938682, W = 1.25, H = F.deriveDragH();
  const max = a => a.reduce((m, v) => Math.max(m, v), -Infinity), min = a => a.reduce((m, v) => Math.min(m, v), Infinity);
  const runA = inlet => {
    const L = new R.LbmRef(64, { nu: NU, uIn: U, channel: true, inlet });
    L.init(() => [U / 2, 0]);
    L.step(8000);
    const c = L.columns();
    return { Vmin: min(c.V), Vmax: max(c.V), dev: max(Array.from(c.V, v => Math.abs(v - 1))), uy: max(Array.from(L.uy, v => Math.abs(v))) / U, level: L.meanRho() };
  };
  const n = 128, phi = R.diskPhi(n, 64, 63.5, 9.6, W);
  const runB = inlet => {
    const L = new R.LbmRef(n, { nu: NU, uIn: U, channel: true, width: W, h: H, phi, inlet });
    L.step(14000);
    const c14 = L.columns();
    L.step(2000);
    const c = L.columns(), V = Array.from(c.V), centre = 63 * n + 64;
    let gapMax = -Infinity, inletX = 0, inletY = 0, mirror = 0;
    for (let y = 0; y < n; y++) {
      gapMax = Math.max(gapMax, L.ux[y * n + 64] / U);
      inletX = Math.max(inletX, Math.abs(L.ux[y * n] / U - 1));
      inletY = Math.max(inletY, Math.abs(L.uy[y * n]) / U);
      for (let x = 0; x < n; x++) {
        const a = y * n + x, b = (n - 1 - y) * n + x;
        mirror = Math.max(mirror, Math.abs(L.ux[a] - L.ux[b]) / U, Math.abs(L.uy[a] + L.uy[b]) / U);
      }
    }
    const st = {
      Vmin: min(V), Vmax: max(V), V0: c.V[0], Vout: c.V[n - 1],
      steady: max(V.map((v, x) => Math.abs(v - c14.V[x]))),
      conserve: max(Array.from(c.Q, q => Math.abs(q / c.Q[0] - 1))),
      centreSpeed: Math.hypot(L.ux[centre], L.uy[centre]) / U, centreK: L.K[centre] / L.dragK, gapMax,
      inletX, inletY, mirror, Q0: c.Q[0], rhoIn: c.R[0], rhoOut: c.R[n - 1], level: L.meanRho(),
    };
    st.valid = st.steady <= 1e-4 && st.conserve <= 2e-3 && st.centreSpeed <= 0.01 && st.centreK >= 0.99 && st.gapMax >= 1.05;
    return st;
  };
  const aV = runA("velocity"), aE = runA("equilibrium"), bV = runB("velocity"), bE = runB("equilibrium");
  const okA = aV.dev <= 1e-6 && aV.uy <= 1e-6 && aE.Vmax < 0.98;
  const okB = bV.Vmin >= 0.98 && bV.Vmax <= 1.02 && bV.valid && bV.inletX <= 1e-12 && bV.inletY <= 1e-12 && bV.mirror <= 1e-9;
  const okArm = bE.Vmax < 0.98 && Math.abs(bE.V0 - 0.83152) <= 1e-4 && bE.rhoIn > bE.rhoOut && bE.valid;
  const r = (o, d = 6) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? +v.toPrecision(d) : v]));
  check("FLOW-INLET-CPU", okA && okB && okArm, {
    emptyAfterSpeedChange: { velocity: r(aV), equilibrium: r(aE) },
    blocked: { velocity: r(bV), equilibrium: r(bE) }, verdicts: { okA, okB, okArm },
  });
}

// 8. FLOW-INLET-DEFAULT — the app runs the velocity inlet: the lattice uniform
//    (lbm.ts lbmUniform) writes inlet word 0 unless "equilibrium" is named,
//    and every other word exactly as FlowSolver packed it before D3.5; no
//    source file names the old inlet. Must-miss: the guard's pattern matches a
//    planted line, so a clean scan is not a blind one.
{
  const LB = await server.ssrLoadModule("/src/lbm.ts");
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const prior = (n, c, phiOn, h) => {   // FlowSolver.writeParams before D3.5, verbatim
    const tauP = 0.5 + 3 * c.nu, tauM = 0.5 + 0.25 / (tauP - 0.5);
    const buf = new ArrayBuffer(48), u = new Uint32Array(buf), f = new Float32Array(buf);
    u[0] = n; u[1] = c.channel ? 1 : 0; u[2] = phiOn && c.width > 0 ? 1 : 0;
    f[4] = 1 / tauP; f[5] = 1 / tauM; f[6] = c.uIn;
    f[7] = c.width > 0 ? (2 * h * c.nu) / (c.width * c.width) : 0;
    f[8] = c.force?.[0] ?? 0; f[9] = c.force?.[1] ?? 0;
    return Array.from(u);
  };
  const h = F.deriveDragH();
  const cfgs = [
    [64, { nu: 0.1, uIn: 0, channel: false, width: 0, force: [2.9e-5, 0] }, false],
    [128, { nu: 3.465, uIn: 0.011404, channel: true, width: 1.25 }, true],
    [64, { nu: 0.2, uIn: 0.02, channel: true, width: 0 }, false],
  ];
  const words = [];
  for (const [n, c, phiOn] of cfgs) {
    const old = prior(n, c, phiOn, h);
    for (const inlet of [undefined, "velocity", "equilibrium"]) {
      const now = Array.from(new Uint32Array(LB.lbmUniform(n, inlet ? { ...c, inlet } : c, phiOn, h)));
      words.push({ inlet: inlet ?? "default", word3: now[3], othersAsBefore: now.every((w, i) => i === 3 || w === old[i]), wholeAsBefore: now.every((w, i) => w === old[i]) });
    }
  }
  const packOk = words.every(w => (w.inlet === "equilibrium" ? w.word3 === 1 : w.word3 === 0 && w.wholeAsBefore) && w.othersAsBefore);
  const pattern = /inlet\s*:\s*["'`]equilibrium["'`]/;
  const files = [];
  const walk = d => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(e)) files.push(p); } };
  walk(fileURLToPath(new URL("../src/", import.meta.url)));
  const offenders = files.filter(p => pattern.test(readFileSync(p, "utf8"))).map(p => p.replace(/\\/g, "/").replace(/^.*\/src\//, "src/"));
  const planted = ['this.flow.configure({ ...cfg, inlet: "equilibrium" });', "new FlowSolver(d, n, { nu, uIn, channel: true, width, inlet:'equilibrium' })"].every(l => pattern.test(l));
  check("FLOW-INLET-DEFAULT", packOk && files.length > 20 && offenders.length === 0 && planted, {
    packing: words.map(w => `${w.inlet}:${w.word3}${w.othersAsBefore ? "" : " (other words moved)"}`), defaultBitIdenticalToPreD35: words.filter(w => w.inlet !== "equilibrium").every(w => w.wholeAsBefore),
    scanned: files.length, offenders, guardSeesPlanted: planted,
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
