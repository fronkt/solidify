// HT-* — the heat-treatment rate laws, checked without a browser.
//
// Like verify-units.mjs and for the same reason: this half of Phase H is pure
// arithmetic over src/heattreat.ts, so it runs anywhere Node does and IS wired
// into the GitHub workflow. It loads the TypeScript through vite's SSR loader
// rather than re-implementing the formulas in JS — a test that re-implements the
// thing it is testing proves nothing.
//
// What is checked here, and what deliberately is not:
//   HT-ARRH     the Arrhenius integral, both arms — a hold against its exact
//               closed form, a ramp against a 64x finer quadrature. A ramp has no
//               elementary integral, so the fine quadrature IS the reference.
//   HT-RAMP-COUNTS  a schedule's ramps must contribute; charging only the hold is
//               a plausible-looking bug that would under-report every treatment.
//   HT-LAWS     grain growth, Hall-Petch, parabolic scale, decarb depth, and the
//               ggN != 2 endpoint path, each against its closed form.
//   HT-HOMOG-ANALYTIC  the segregation decay this app's GPU pass is measured
//               against. Checked here so that when the GPU gate disagrees, the
//               analytic side is already known good.
//   HT-SWEEPS   the budget -> sweeps inversion round-trips. NOT the value of
//               K_MC, which is measured on the GPU by HT-GROWTH-N2 (H2); this
//               only checks that the arithmetic inverts.
//   HT-REFUSE   every refusal path fires, and names its own reason.
//   HT-INCIPIENT  a schedule that would melt the specimen is caught.
//
//   node scripts/verify-heattreat.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const H = await server.ssrLoadModule("/src/heattreat.ts");
const U = await server.ssrLoadModule("/src/units.ts");
const M = await server.ssrLoadModule("/src/materials.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const rel = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? Math.abs(a - b) / Math.abs(b) : Infinity);

const AL = M.MATERIALS.al.si;
const STEEL = M.MATERIALS.steel.si;
const CU = M.MATERIALS.cu.si;

// ---------------------------------------------------------------------------
// 1. The Arrhenius integral.
//
// A hold is exact under any quadrature: the integrand is constant, so the
// integral is k(T)*t and any disagreement is a bug in the walker, not the
// quadrature. A ramp has no elementary form, so its reference is the same
// routine at 64x the sample count — which tests convergence, the only thing a
// quadrature can honestly be tested for.
{
  const holdC = H.frac(AL.Tm - U.K0, 0.85);
  const minutes = 60;
  const sch = { name: "t", startC: holdC, stages: [{ kind: "hold", minutes }] };
  const got = H.integrate(sch, AL);
  const wantGG = H.rate(AL.ggA0, AL.ggQ, holdC + U.K0) * minutes * 60;
  const wantDT = H.rate(AL.Ds0, AL.Qs, holdC + U.K0) * minutes * 60;
  const ok = rel(got.gg, wantGG) < 1e-12 && rel(got.dt, wantDT) < 1e-12
    && rel(got.seconds, minutes * 60) < 1e-12;
  check("HT-ARRH-HOLD", ok, {
    gg: got.gg.toExponential(6), closedForm: wantGG.toExponential(6), relErr: rel(got.gg, wantGG).toExponential(2),
  });
}
{
  // a real ramp through a hot region, where the integrand moves by orders
  const sch = {
    name: "t", startC: 20,
    stages: [{ kind: "ramp", toC: H.frac(AL.Tm - U.K0, 0.9), cPerMin: 10 }],
  };
  const coarse = H.integrate(sch, AL, 256);
  const fine = H.integrate(sch, AL, 256 * 64);
  const e = rel(coarse.gg, fine.gg);
  check("HT-ARRH-RAMP", e < 1e-6, {
    coarse: coarse.gg.toExponential(6), fine: fine.gg.toExponential(6), relErr: e.toExponential(2),
  });
}

// ---------------------------------------------------------------------------
// 2. The ramps must actually contribute.
//
// Charging a schedule only for its hold is the exact shape of a bug that would
// look right in every readout and under-report every treatment — the same class
// as "equal wall-clock is not equal physics" from v5.0. A slow ramp to
// temperature spends real time hot; assert it counts for something.
{
  const hot = H.frac(AL.Tm - U.K0, 0.9);
  const holdOnly = H.integrate({ name: "t", startC: hot, stages: [{ kind: "hold", minutes: 60 }] }, AL);
  const slowRamp = H.integrate({
    name: "t", startC: 20,
    stages: [{ kind: "ramp", toC: hot, cPerMin: 2 }, { kind: "hold", minutes: 60 }],
  }, AL);
  const fastRamp = H.integrate({
    name: "t", startC: 20,
    stages: [{ kind: "ramp", toC: hot, cPerMin: 200 }, { kind: "hold", minutes: 60 }],
  }, AL);
  // slow ramp spends longer hot than a fast one, and both beat the hold alone
  const ok = slowRamp.gg > fastRamp.gg && fastRamp.gg > holdOnly.gg
    && slowRamp.seconds > fastRamp.seconds;
  check("HT-RAMP-COUNTS", ok, {
    holdOnly: holdOnly.gg.toExponential(3),
    fastRamp: fastRamp.gg.toExponential(3),
    slowRamp: slowRamp.gg.toExponential(3),
    slowRampExtraPct: +(((slowRamp.gg / holdOnly.gg) - 1) * 100).toFixed(1),
  });
}

// ---------------------------------------------------------------------------
// 3. The closed-form laws.
{
  const rows = [];
  let ok = true;

  // grain growth: D^n = D0^n + budget, at the material's own exponent
  const d0 = 12e-6, gg = 1.9e-10;
  const dAl = H.grainAfter(d0, gg, AL);
  const wantAl = Math.sqrt(d0 * d0 + gg);           // ggN = 2
  ok = ok && rel(dAl, wantAl) < 1e-12;
  rows.push({ law: "grainAfter n=2", got: +(dAl * 1e6).toFixed(4), want: +(wantAl * 1e6).toFixed(4) });

  // the ggN != 2 path, which no shipped material exercises but the code carries
  const cubic = { ...AL, ggN: 3 };
  const d3 = H.grainAfter(d0, gg, cubic);
  const want3 = Math.cbrt(d0 ** 3 + gg);
  ok = ok && rel(d3, want3) < 1e-12;
  rows.push({ law: "grainAfter n=3", got: +(d3 * 1e6).toFixed(4), want: +(want3 * 1e6).toFixed(4) });

  // Hall-Petch, and its direction: coarser grain MUST be weaker
  const fine = H.hallPetch(AL, 8e-6), coarse = H.hallPetch(AL, 60e-6);
  ok = ok && rel(fine, AL.s0 + AL.kHP / Math.sqrt(8e-6)) < 1e-12 && fine > coarse;
  rows.push({ law: "hallPetch", fineMPa: +fine.toFixed(1), coarseMPa: +coarse.toFixed(1) });

  // parabolic scale and decarb depth
  const ox = 4e-12;
  ok = ok && rel(H.scaleThickness(ox), Math.sqrt(ox)) < 1e-12;
  ok = ok && rel(H.decarbDepth(ox), 2 * Math.sqrt(ox)) < 1e-12;
  rows.push({ law: "scale/decarb", scaleUm: +(H.scaleThickness(ox) * 1e6).toFixed(3), decarbUm: +(H.decarbDepth(ox) * 1e6).toFixed(3) });

  check("HT-LAWS", ok, rows);
}

// ---------------------------------------------------------------------------
// 4. The analytic segregation decay the GPU pass will be measured against.
//
// exp(-4*pi^2*Dt/lambda^2). Checked here so that if HT-HOMOG (H4, on the GPU)
// ever disagrees, the analytic side is already known good and the argument is
// about the solver rather than about the reference.
{
  const lambda = 20e-6;
  const Dt = (lambda * lambda) / (4 * Math.PI * Math.PI);   // exactly one e-fold
  const got = H.segregationDecay(Dt, lambda);
  const ok = rel(got, Math.E ** -1) < 1e-12
    && H.segregationDecay(0, lambda) === 1
    && rel(H.fourier(Dt, lambda), Dt / (lambda * lambda)) < 1e-12;
  check("HT-HOMOG-ANALYTIC", ok, { oneEFold: +got.toFixed(9), want: +(1 / Math.E).toFixed(9) });
}

// ---------------------------------------------------------------------------
// 5. The budget -> sweeps inversion.
//
// NOT a test of K_MC. That constant is measured on the GPU by HT-GROWTH-N2 in
// H2; this only asserts that given one, the arithmetic inverts — and that a
// target at or below the starting size costs nothing rather than going negative.
{
  const kMC = 0.4, pitch = 0.977, m = 2.44;
  const s = H.sweepsFor(12, 30, pitch, kMC, m);
  const d0c = 12 / pitch, d1c = 30 / pitch;
  const want = (d1c ** m - d0c ** m) / kMC;
  const ok = rel(s, want) < 1e-12
    && H.sweepsFor(30, 12, pitch, kMC, m) === 0
    && H.sweepsFor(12, 30, pitch, 0, m) === 0
    // and the model exponent must actually be USED — an implementation that
    // silently assumed m = 2 would pass every check above if m were 2, so make
    // the two exponents disagree and require the answers to differ
    && Math.abs(H.sweepsFor(12, 30, pitch, kMC, 2) - s) / s > 0.2;
  check("HT-SWEEPS", ok, {
    sweeps: Math.round(s), want: Math.round(want),
    ifExponentWere2: Math.round(H.sweepsFor(12, 30, pitch, kMC, 2)),
  });
}

// ---------------------------------------------------------------------------
// 5b. The domain limit, which the HT-DEMO numbers below make a REACHABLE case.
//
// Steel's own sourced coefficients predict ~296 um after a 1 h anneal. A 1 mm 2D
// domain holds three such grains; the 188 um volume at 192^3 holds less than one.
// The law is still printed — the model just declines to simulate it.
{
  const twoD = H.domainLimitUm(1024, 1000 / 1024);
  const vol = H.domainLimitUm(192, 0.977);
  const ok = twoD > 100 && twoD < 400 && vol < twoD
    && H.domainLimitUm(1024, 1000 / 1024, 1000) < twoD;   // stricter floor, smaller limit
  check("HT-DOMAIN-LIMIT", ok, {
    domain2dUm: 1000, limit2dUm: +twoD.toFixed(1),
    domain3dUm: +(192 * 0.977).toFixed(1), limit3dUm: +vol.toFixed(1),
    steelPredictedUm: 295.9, refused2d: 295.9 > twoD, refused3d: 295.9 > vol,
  });
}

// ---------------------------------------------------------------------------
// 6. Every refusal path fires, and each one says something specific.
//
// Frank's data policy: a process with no data behind it is not offered and the
// refusal names what is missing. A generic "not available" would be the dead-knob
// class in a different costume, so this also asserts the reasons are distinct.
{
  const base = { si: AL, key: "al", alloy: true, dim: "3d", cubic: true, solidFraction: 0.8 };
  const rows = [];
  let ok = true;
  const want = (label, p, ctx, shouldPass, mustSay) => {
    const v = H.canTreat(p, ctx);
    const good = v.ok === shouldPass && (shouldPass || (v.why.length > 20 && (!mustSay || v.why.includes(mustSay))));
    ok = ok && good;
    rows.push({ label, ok: v.ok, why: v.ok ? "" : v.why.slice(0, 58) });
  };

  want("no melt yet", "grain", { ...base, solidFraction: 0 }, false, "pour");
  want("abstract material", "grain", { ...base, si: null, key: "generic" }, false, "abstract");
  want("grain growth, Al", "grain", base, true);
  want("homogenize, no alloy", "homogenize", { ...base, alloy: false }, false, "solute field");
  want("homogenize, alloy", "homogenize", base, true);
  want("twins in 2D", "twins", { ...base, dim: "2d" }, false, "3D");
  want("twins, non-cubic", "twins", { ...base, cubic: false }, false, "cubic");
  want("twins, no SFE", "twins", base, false, "stacking-fault");
  want("twins, high SFE (Al)", "twins", { ...base, si: { ...AL, sfe: 166 } }, false, "too high");
  want("twins, low SFE (Cu)", "twins", { ...base, si: { ...CU, sfe: 45 }, key: "cu" }, true);
  want("twins, structural veto", "twins", { ...base, si: { ...STEEL, sfe: 20, twinNote: "modelled as delta-ferrite here." }, key: "steel" }, false, "ferrite");
  want("oxide, no constant", "oxide", { ...base, si: { ...AL, oxA0: 0 } }, false, "not modelled");
  want("oxide, Al", "oxide", base, true);
  want("decarb, not steel", "decarb", base, false, "carbon");
  want("decarb, steel", "decarb", { ...base, si: STEEL, key: "steel" }, true);

  // the refusals must not all be the same sentence
  const reasons = new Set(rows.filter(r => !r.ok).map(r => r.why));
  const distinct = reasons.size === rows.filter(r => !r.ok).length;
  ok = ok && distinct;
  check("HT-REFUSE", ok, { cases: rows.length, refusals: reasons.size, distinct });
}

// ---------------------------------------------------------------------------
// 7. A schedule hot enough to melt the specimen is caught.
//
// The model holds phi frozen, so a schedule above the melting point is not a
// treatment it can honestly integrate — and in a real shop, overshooting the
// solidus causes incipient melting and ruins the casting. Same limit, two
// reasons.
{
  const shipped = Object.keys(H.SCHEDULES).map(k => {
    const s = H.SCHEDULES[k].build(AL.Tm - U.K0);
    return { k, peakFracTm: +H.integrate(s, AL).peakFracTm.toFixed(4) };
  });
  const allSafe = shipped.every(s => s.peakFracTm < H.INCIPIENT_FRAC);
  const tooHot = H.integrate({
    name: "t", startC: 20, stages: [{ kind: "ramp", toC: AL.Tm - U.K0 + 50, cPerMin: 50 }],
  }, AL);
  const caught = tooHot.peakFracTm > H.INCIPIENT_FRAC;
  check("HT-INCIPIENT", allSafe && caught, { shipped, tooHotFracTm: +tooHot.peakFracTm.toFixed(4), limit: H.INCIPIENT_FRAC });
}

// ---------------------------------------------------------------------------
// 8. The headline number, printed rather than asserted.
//
// Not a pass/fail: the point of Phase H is that a real schedule on real
// coefficients produces a watchable amount of coarsening, and if that ever stops
// being true the panel is pointless even though every formula is still correct.
// Printed so a regression is visible in the log.
{
  const rows = [];
  for (const key of ["al", "cu", "steel"]) {
    const si = M.MATERIALS[key].si;
    const sch = H.SCHEDULES.anneal.build(si.Tm - U.K0);
    const I = H.integrate(sch, si);
    const d0 = 12e-6;
    const d1 = H.grainAfter(d0, I.gg, si);
    rows.push({
      key,
      holdC: Math.round(H.frac(si.Tm - U.K0, 0.85)),
      hours: +(I.seconds / 3600).toFixed(2),
      umBefore: 12,
      umAfter: +(d1 * 1e6).toFixed(1),
      MPaBefore: Math.round(H.hallPetch(si, d0)),
      MPaAfter: Math.round(H.hallPetch(si, d1)),
    });
  }
  console.log("HT-DEMO   (informational)", JSON.stringify(rows));
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
