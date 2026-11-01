// FLOW-* — D3 melt flow arithmetic (slice D3.0), checked without a browser.
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
    big: F.flowRefusal({ ...base, grid: 2048 }),
    busy: F.flowRefusal({ ...base, busyMode: "heat treatment" }),
  };
  const ok = cases.allowed === null && cases.frozenAlloy === null
    && [cases.dim3, cases.scenario, cases.frozenPure, cases.big, cases.busy].every(s => typeof s === "string" && s.length > 20);
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

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
