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
//   HT-VERDICT  the MPa formatter's three bands, and the printed-precision
//               doctrine: a miss the display rounds away judges as met.
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
  // H3 landed a real sfe on al — strip it so this case still tests the
  // "never looked up" path rather than silently becoming a duplicate of the
  // too-high case below
  want("twins, no SFE", "twins", { ...base, si: { ...AL, sfe: undefined } }, false, "stacking-fault");
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
// 6b. The SHIPPED material data drives the intended twin matrix (H3).
//
// HT-REFUSE above tests the refusal machinery on synthetic contexts; this one
// tests the DATA — the sfe/twinNote values looked up in H3, with sources named
// in materials.ts, must land each material on the right side of the gate. The
// teaching contrast is the whole point: annealed copper is full of Σ3 twins
// and annealed aluminium has none, from the same machinery and two numbers.
{
  const expect = [
    ["cu", true, ""],                  // SFE 78 (Murr 1975) — twins
    ["co", true, ""],                  // SFE ~20 — twins profusely
    ["al", false, "too high"],         // SFE 166 — the textbook refusal
    ["ni", false, "too high"],         // SFE 128
    ["steel", false, "ferrite"],       // modelled as delta-ferrite, no gamma phase
    ["scn", false, "FCC phenomenon"],  // BCC plastic crystal
    ["mg", false, "cubic"],            // HCP — refused before SFE is even consulted
    ["zn", false, "cubic"],
  ];
  const rows = [];
  let ok = true;
  for (const [key, shouldPass, mustSay] of expect) {
    const m = M.MATERIALS[key];
    const v = H.canTreat("twins", {
      si: m.si ?? null, key, alloy: true, dim: "3d",
      cubic: M.to3D(m).aniMode3 === 1, solidFraction: 0.8,
    });
    const good = v.ok === shouldPass && (shouldPass || v.why.includes(mustSay));
    ok = ok && good;
    rows.push({ key, ok: v.ok, why: v.ok ? "" : v.why.slice(0, 44) });
  }
  check("HT-TWIN-MATRIX", ok, rows);
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
// 7b. HT-VERDICT — the verdict is judged at the PRINTED precision.
//
// fmtMPa/shownMPa moved into heattreat.ts when L4 gave the lab card the same
// verdict as the furnace's, which is what makes them gateable here. Two claims:
// the formatter's three bands (a superalloy's hundreds, a casting's tens, and
// succinonitrile's fractions each get the digits Hall–Petch on a census
// deserves), and the doctrine itself — a spec missed by less than the display's
// own rounding must judge as met, because "missed" beside two identical printed
// numbers is a label lying about a difference the card declines to show.
{
  const bands = H.fmtMPa(250.4) === "250" && H.fmtMPa(45.67) === "45.7" && H.fmtMPa(1.234) === "1.2";
  // 30.04 prints "30.0" — a miss the display rounded away, judged met.
  // 29.94 prints "29.9" — a real printed shortfall, judged missed.
  // 29.96 prints "30.0" — rounding recovers it, judged met.
  const met = H.shownMPa(30.04) >= H.shownMPa(30);
  const missed = !(H.shownMPa(29.94) >= H.shownMPa(30));
  const rounded = H.shownMPa(29.96) >= H.shownMPa(30);
  check("HT-VERDICT", bands && met && missed && rounded, {
    bands: [H.fmtMPa(250.4), H.fmtMPa(45.67), H.fmtMPa(1.234)],
    at30: [H.shownMPa(30.04), H.shownMPa(29.94), H.shownMPa(29.96)],
  });
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

// HT-DOC-CONSTANTS (v7.0, C0b) — the prose must quote the constant the code ships.
//
// K_MC_TOL_3D was re-measured 15 % -> 25 % in v6.2, and three documents kept the
// old number for two releases: TESTING.md said the volume "keeps 15 %, earned by
// a measured 1.8 % spread", README said "K stable to 1.8 % across casts", and
// science/index.html — the honesty page, whose entire job is to be true — printed
// "drift gated at 15 %". The constant's own docblock had meanwhile recorded the
// real six-run spread (1.186, 0.924, 1.057, 0.886, 0.934, 0.937) and explained
// that the 1.8 % had been read off two casts that happened to agree.
//
// Deliberately narrow: it reads the tolerances from the module and requires each
// document to quote THAT number, and it bans the two specific superseded claims
// by text. It does not try to parse the prose around them — a rewrite that keeps
// the numbers right still passes. A gate that policed the wording would be
// abandoned the first time someone edited a sentence.
{
  const { readFileSync } = await import("node:fs");
  const doc = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const pct3 = Math.round(H.K_MC_TOL_3D * 100);
  const pct2 = Math.round(H.K_MC_TOL * 100);

  const science = doc("science/index.html");
  const testing = doc("TESTING.md");
  const readme = doc("README.md");

  // the science page states both tolerances in its measurement table
  const sciQuotes3D = new RegExp(`drift gated at ${pct3}\\s*%`).test(science);
  const sciQuotes2D = new RegExp(`drift gated at ${pct2}\\s*%`).test(science);
  // the shipped pair, wherever it is quoted
  const pairQuoted = [science, testing, readme].every(t =>
    t.includes(String(H.M_MODEL_3D)) && t.includes(String(H.K_MC_3D)));
  // the two claims the re-measurement retired. "1.8 %" was the spread that was
  // never real; a bare "gated at 15 %" is the tolerance that never held.
  const stale = [];
  for (const [name, text] of [["science", science], ["TESTING", testing], ["README", readme]]) {
    if (/1\.8\s*%\s*(spread|across casts)/.test(text)) stale.push(`${name}: 1.8 % spread`);
    if (/drift gated at 15\s*%/.test(text)) stale.push(`${name}: drift gated at 15 %`);
  }

  // v7.0 C2: the Zener limit law's measured constants, same doctrine — the
  // science page must quote the triple the code ships, and the retired claim
  // ("grain growth here is unpinned", stated as a present-tense absolute) must
  // be gone from all three documents now that the mode exists.
  const zenerQuoted = [science].every(t =>
    t.includes(String(H.ZENER_K)) && t.includes(String(H.ZENER_R_EXP)) && t.includes(String(H.ZENER_F_EXP)));
  // the retired claim is the ABSOLUTE ("is unpinned — no particles…"); the
  // honest v7.0 sentence is "unpinned by default", which must keep passing
  for (const [name, text] of [["science", science], ["TESTING", testing], ["README", readme]]) {
    if (/[Gg]rain growth (here )?is unpinned(?! by default)/.test(text)) stale.push(`${name}: grain growth is unpinned (absolute)`);
  }

  check("HT-DOC-CONSTANTS", sciQuotes3D && sciQuotes2D && pairQuoted && zenerQuoted && stale.length === 0, {
    shipped: { K_MC_TOL: H.K_MC_TOL, K_MC_TOL_3D: H.K_MC_TOL_3D, M_MODEL_3D: H.M_MODEL_3D, K_MC_3D: H.K_MC_3D },
    scienceQuotes: { "2D": sciQuotes2D, "3D": sciQuotes3D }, pairQuoted, zenerQuoted, staleClaims: stale,
  });
}

// HT-ZENER (v7.0 C2) — the measured limit law's arithmetic, browser-free.
//
// zenerLimitCells is the number the panel pre-judges pinned schedules with, so
// its shape is gated where CI can see it: off-states answer Infinity (the
// unpinned law survives a min()), the limit falls with f and rises with r —
// the two directions the GPU ladders measure — and one spot recomputed HERE
// from the exported constants must match the function exactly. The spot is a
// FORMULA-shape check, not a constants check (it recomputes from the same
// exports, so a wrong triple passes it): the constants' VALUES are gated by
// GG-PIN-LIMIT against real ladders; this check pins the formula between
// those runs — a swapped exponent, a dropped power or an inverted ratio
// fails it while every monotonicity clause still holds.
{
  const z = H.zenerLimitCells;
  const spot = H.ZENER_K * Math.pow(2, H.ZENER_R_EXP) / Math.pow(0.06, H.ZENER_F_EXP);
  const ok = z(0, 2) === Infinity && z(-1, 2) === Infinity && z(0.06, 0) === Infinity
    && z(0.06, 2) === spot && Number.isFinite(spot) && spot > 0
    && z(0.12, 2) < z(0.06, 2) && z(0.03, 2) > z(0.06, 2)
    && z(0.06, 3) > z(0.06, 2);
  check("HT-ZENER", ok, {
    spot: +spot.toFixed(2),
    f: [+z(0.03, 2).toFixed(2), +z(0.06, 2).toFixed(2), +z(0.12, 2).toFixed(2)],
    r: [+z(0.06, 1).toFixed(2), +z(0.06, 3).toFixed(2), +z(0.06, 5).toFixed(2)],
  });
}

// PIN-STRUCTURE (v7.0 C2) — the mode's structural invariants, browser-free.
//
// The POR-PORE-SOLUTE idiom: assert the SHAPE of the shader text where no
// numeric witness is cheap. Three invariants: (1) the particle test lives in
// BOTH dims' mask shaders, each behind the f<=0 guard that makes zero the
// pre-C2 mask arithmetic; (2) the ANNEAL shaders are particle-free — the
// whole design is that pinning is mask-only wall semantics, and a particle
// term leaking into the acceptance arithmetic would re-open the K_MC
// calibration exactly the way the Σ3 docblock warns; (3) one fabric salt,
// interpolated into both dims from the one constant — two salts would be two
// fabrics wearing one pair of dials.
{
  const SH = await server.ssrLoadModule("/src/shaders.ts");
  const S3 = await server.ssrLoadModule("/src/shaders3d.ts");
  // the eligibility expression must CALL the test (!inParticle), not merely
  // contain its definition — dead text satisfies a presence regex (review
  // catch: the first cut of this gate would have passed a mask that never
  // consulted the fabric)
  const guard2 = /&&\s*!inParticle\(/.test(SH.HTMASK_WGSL) && /H\.pinF <= 0\.0/.test(SH.HTMASK_WGSL);
  const guard3 = /&&\s*!inParticle3\(/.test(S3.HTMASK3_WGSL) && /H\.pinF <= 0\.0/.test(S3.HTMASK3_WGSL);
  // the shared HT struct DECLARES pinF in every heat-treat shader — that
  // declaration doubles as the liveness anchor (a renamed export would make
  // a bare negative regex test the string "undefined" and pass vacuously);
  // what must not appear in the anneal bodies is a READ (H.pinF) or the test
  const annealClean = /\bpinF\b/.test(SH.ANNEAL_WGSL) && /\bpinF\b/.test(S3.ANNEAL3_WGSL)
    && !/inParticle|H\.pinF/.test(SH.ANNEAL_WGSL) && !/inParticle|H\.pinF/.test(S3.ANNEAL3_WGSL);
  // declared at the exported value AND used at the hash call site — either
  // alone lets a second hardcoded salt slip through
  const saltShared = SH.HTMASK_WGSL.includes(`${SH.PIN_SALT}u`) && S3.HTMASK3_WGSL.includes(`${SH.PIN_SALT}u`)
    && /htHash\(hx, hy, PIN_SALT\)/.test(SH.HTMASK_WGSL) && /hz \^ PIN_SALT/.test(S3.HTMASK3_WGSL);
  check("PIN-STRUCTURE", guard2 && guard3 && annealClean && saltShared,
    { guard2, guard3, annealClean, saltShared, salt: SH.PIN_SALT });
}

// SE-STRUCTURE (v7.0 C3a) — the stored-energy kernel's text invariants.
//
// PIN-STRUCTURE's idiom, applied to the one thing C3a cannot witness with a
// number: that the stored field is READ-ONLY on the GPU and that turning the
// mode off returns the pre-C3a text rather than a text that merely behaves like
// it. HT3-SE-COHERENCE proves hBuf === hCPU after a real anneal, which is the
// runtime witness; this is the structural one, and it is the half that survives
// in CI where there is no GPU.
//
// Five clauses, each with a liveness anchor beside it so no negative test can
// pass against a renamed export (the "undefined" trap PIN-STRUCTURE's docblock
// records):
//   1. the PLAIN variant carries no stored text at all, and still carries the
//      acceptance line it has always had;
//   2. the STORED variant claims binding 5 and stops there — a binding 6 would
//      be a second field arriving without a milestone;
//   3. nothing anywhere assigns hs. The binding is `read`, not `read_write`;
//      this is the text half of that guarantee;
//   4. the acceptance lines are pinned in BOTH variants — the stored one adds
//      exactly the SIBM difference and nothing else;
//   5. the struct did not outgrow its binding: `rec` reuses slot 5 and BYTES
//      stays 32, which is the whole reason postmortem #1 cannot recur here.
// And the 2D kernel must stay stored-free: the Moore-8 stencil's flat-front
// barrier is +2, not H_FLAT_3D's +8, and a stored term borrowed across that
// stencil change is the mistake M_MODEL_3D exists to remember.
{
  const SH = await server.ssrLoadModule("/src/shaders.ts");
  const S3 = await server.ssrLoadModule("/src/shaders3d.ts");
  const plain = S3.ANNEAL3_WGSL;
  const stored = S3.anneal3Wgsl(true);

  // 1. plain is stored-free — with the acceptance line as its liveness anchor
  const plainLive = /let dE = eNew - eNow;/.test(plain);
  const plainClean = !/\bhs\b|H\.rec|hOf\(/.test(plain);
  // 2. binding 5 claimed, binding 6 absent (the plain variant claims neither)
  const binds = /@binding\(5\) var<storage, read> hs: array<f32>;/.test(stored)
    && !/@binding\(6\)/.test(stored) && !/@binding\(5\)/.test(plain);
  // 3. read-only: no assignment to hs in either variant, in any form
  const readOnly = !/hs\s*\[[^\]]*\]\s*=/.test(stored) && !/var<storage, read_write> hs/.test(stored);
  // 4. both acceptance lines pinned. The stored one is the plain one plus the
  //    SIBM difference — the term whose SIGN is the physics: negative when the
  //    candidate is the LESS deformed grain
  const accept = /let dE = eNew - eNow \+ \(hOf\(cand\) - hOf\(mineId\)\);/.test(stored)
    && /return h \/ \(1\.0 \+ H\.rec \* h\);/.test(stored)
    && /hs\[min\(id, PORE\)\]/.test(stored);
  // 5. the slot reuse, the reason the struct still fits its declared binding
  const struct = SH.H2U.BYTES === 32 && SH.H2U.rec === 5 && !("twinProb" in SH.H2U)
    && /\brec: f32,/.test(SH.HT_COMMON ?? plain) && !/twinProb/.test(plain);
  // 3D-only: the plane's anneal has no stored term, and still has its own dE
  const twoD = /let dE = /.test(SH.ANNEAL_WGSL) && !/\bhs\b|H\.rec|hOf\(/.test(SH.ANNEAL_WGSL);

  // 6. one closed form, three consumers. `hOf` evaluates it in the shader,
  //    `recovered()` is what the report card prints, and `recoveredMeanUniform`
  //    is what the card prints for the deposited MEAN.
  //
  //    The 1.18 below is NOT an independent measurement and is not labelled as
  //    one: H_S = 20/(1 + 0.8·20) is this same closed form on this same
  //    constant, so the clause pins the ALGEBRA and the shipped rate jointly —
  //    rewrite the law as first-order, or move HT_RECOVER_3D, and it fails —
  //    but it cannot corroborate either. The docblock's 1.18 is where a
  //    MEASURED front was observed to stop, and the gate that checks THAT
  //    against something else is HT3-SE-RECOVERY-STALL, on a GPU.
  //
  //    `recoveredMeanUniform` is different: its closed form is checked against
  //    numeric quadrature of the same integral, which is a genuinely separate
  //    computation, and against the Jensen inequality that motivates it.
  const stall = H.recovered(20, H.HT_RECOVER_3D * 800);
  const quad = (w, r) => {
    let acc = 0; const N = 20000;
    for (let i = 0; i < N; i++) { const h = 2 * w * (i + 0.5) / N; acc += h / (1 + r * h); }
    return acc / N;
  };
  const meanOK = [[4, 0.5], [6, 0.09], [10, 0.002]].every(([w, r]) =>
    Math.abs(H.recoveredMeanUniform(w, r) - quad(w, r)) / quad(w, r) < 1e-6
    && H.recoveredMeanUniform(w, r) < H.recovered(w, r));   // strictly, by Jensen
  const closedForm = Math.abs(stall - 20 / (1 + H.HT_RECOVER_3D * 800 * 20)) < 1e-12
    && Math.abs(stall - 1.18) < 0.005
    && H.recovered(20, 0) === 20 && H.recovered(0, 5) === 0
    && H.recovered(20, 1) < H.recovered(20, 0.5) && H.recovered(20, 1) > 0
    && H.recoveredMeanUniform(4, 0) === 4 && meanOK;

  check("SE-STRUCTURE", plainLive && plainClean && binds && readOnly && accept && struct && twoD && closedForm,
    { plainLive, plainClean, binds, readOnly, accept, struct, twoD, closedForm,
      stallAt800: +stall.toFixed(3), measured: 1.18,
      BYTES: SH.H2U.BYTES, recSlot: SH.H2U.rec, storedChars: stored.length - plain.length,
      meanVsRecoveredAt4x0p5: [+H.recoveredMeanUniform(4, 0.5).toFixed(4), +H.recovered(4, 0.5).toFixed(4)] });
}

// HT-TEMP-SENSITIVITY (v7.0 C3a) — the furnace enters through the sweep count,
// and nowhere else.
//
// This gate is OWED. `HT_KT_DEFAULT`'s docblock and `WORK_SALT`'s both cite it
// as the thing that holds the line between the furnace's °C and the lattice's
// dimensionless knobs, and until C3a it existed in neither script. C3a adds a
// SECOND such knob — `HT_RECOVER_3D` — whose entire honesty claim is that same
// argument, and a third citation to a gate that does not exist is not an option.
//
// The claim, stated so it can fail: two schedules that differ ONLY in hold
// temperature must drive the model differently — that is the liveness half, and
// it fails if the temperature -> sweeps path ever breaks — while the two knobs
// they drive it THROUGH, the shipped kT and HT_RECOVER_3D, stay byte-identical.
//
// The second half is STRUCTURAL, and deliberately so. An earlier cut asserted a
// "sharp form": rec(hot)/rec(cold) === sweeps(hot)/sweeps(cold), float-exact.
// That clause was worth nothing and cost something. Worth nothing, because both
// sides were this script's own `HT_RECOVER_3D * s` lambda — no value the model
// produced was ever read, so the thermally-activated edit it advertised
// catching (multiplying the accumulator in sim3d.ts by f(T)) left it true. Cost
// something, because (k*a)/(k*b) === a/b is not an IEEE identity: it holds at
// the shipped constant by luck and fails for roughly a third of nearby values,
// so any legal retune of the rate, of K_MC_3D, of a ramp, or of this gate's own
// schedule turns CI red with a message naming the wrong culprit.
//
// What actually catches the tempting edit is the text: the accumulator line and
// the per-sweep line must be EXACTLY the rate times a sweep count, and the rate
// must appear nowhere else in sim3d.ts but those two lines and its import. Add
// an f(T) factor to either and the regex stops matching; add a third use and the
// count check fails.
{
  const { readFileSync } = await import("node:fs");
  const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const SH = await server.ssrLoadModule("/src/shaders.ts");

  const sch = (tC) => ({
    name: "t", startC: H.ROOM_C,
    stages: [{ kind: "ramp", toC: tC, cPerMin: 10 }, { kind: "hold", minutes: 60 },
             { kind: "ramp", toC: H.ROOM_C, cPerMin: 5 }],
  });
  const umPC = 0.5, d0 = 8;
  const sweepsAt = (tC) => {
    const I = H.integrate(sch(tC), AL);
    const dPred = H.grainAfter(d0 * 1e-6, I.gg, AL) * 1e6;
    return H.sweepsFor(d0, dPred, umPC, H.K_MC_3D, H.M_MODEL_3D);
  };
  const cold = sweepsAt(400), hot = sweepsAt(520);
  // liveness: 120 °C of furnace has to MOVE the model, or this gate is testing
  // nothing but two constants against themselves
  const enters = hot > cold * 2 && cold > 0 && Number.isFinite(hot);
  const rec = (s) => H.HT_RECOVER_3D * s;
  // both knobs are plain numbers, declared as literals — not getters, not
  // functions of anything
  const literals = typeof SH.HT_KT_DEFAULT === "number" && typeof H.HT_RECOVER_3D === "number"
    && /export const HT_RECOVER_3D = [0-9.e+-]+;/.test(src("src/heattreat.ts"))
    && /export const HT_KT_DEFAULT = [0-9.e+-]+;/.test(src("src/shaders.ts"));
  // the wiring: the panel's host hands the sims NO temperature (the kT
  // parameter is passed `undefined` at both call sites, so the default is the
  // only kT this app ever anneals at), and the recovery the volume banks is a
  // function of DELIVERED SWEEPS with no other term in it
  const main = src("src/main.ts"), s3 = src("src/sim3d.ts");
  // Comments stripped before counting, for the reason `panelClean` strips them
  // below: this repository's docblocks name constants they must not call, and
  // `writeHt`'s explains what happens at `HT_RECOVER_3D = 0`. Three uses in the
  // CODE and no more — the import, the per-sweep ordinate, and the accumulator.
  // A fourth is a factor that came from somewhere.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const recUses = (strip(s3).match(/HT_RECOVER_3D/g) ?? []).length;
  const wiring = /sim3d\.anneal\(sweeps, undefined,/.test(main) && /sim\.anneal\(sweeps, undefined,/.test(main)
    && /s3\.anneal\(share, undefined,/.test(main)
    && /this\.recAcc \+= HT_RECOVER_3D \* delivered;/.test(s3)
    && /HT_RECOVER_3D \* \(s \+ 1\)/.test(s3)
    && recUses === 3;
  // …and neither knob is REACHABLE from a temperature: heatpanel owns every °C
  // in this app, and must not import or name either one as an identifier. The
  // comments are stripped before the test on purpose — this repository's
  // docblocks cross-reference constants they must not call, and a gate that
  // banned the mention along with the use would be a gate someone deletes the
  // first time they write an honest comment. What survives the strip is code.
  const panel = src("src/heatpanel.ts");
  const code = strip(panel);
  const panelClean = /this\.tC/.test(code) && !/HT_KT_DEFAULT|HT_RECOVER_3D/.test(code)
    && /HT_RECOVER_3D/.test(panel);   // liveness: the strip must not have eaten the file

  check("HT-TEMP-SENSITIVITY", enters && literals && wiring && panelClean, {
    enters, literals, wiring, panelClean, recUsesInSim3d: recUses,
    sweeps: { cold: +cold.toFixed(1), hot: +hot.toFixed(1) },
    rec: { cold: +rec(cold).toFixed(6), hot: +rec(hot).toFixed(6) },
    kT: SH.HT_KT_DEFAULT, recRate: H.HT_RECOVER_3D,
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
