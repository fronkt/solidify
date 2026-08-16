// ALLOY-* / CALIB-MIX-* / PD-CONSTRUCT-AGREE / PD-VANTHOFF-CROSSCHECK —
// the composer's chemistry and the calibration it now feeds, without a browser.
//
// alloy.ts, phasedata.ts, quant.ts and materials.ts are all pure, so they load
// through vite's SSR loader and run in CI beside units / rng / heattreat /
// thermal / fade / porosity / experiment / phasedata.
//
// WHAT THESE GATES ARE FOR. v7.1 P1 changed what `calibrate()` measures
// temperature in: pour an alloy and the freezing range is now that alloy's own,
// not the base material's default. The claim has two halves and both are
// checkable here — the poured path computes the regime-appropriate interval and
// says which regime it used, and the NO-POUR path is bit-identical to the
// implementation that shipped before. The second half is the one that protects
// every existing gate in the suite, because none of them pour.
//
//   node scripts/verify-alloy.mjs
import { createServer } from "vite";
import { readFile } from "node:fs/promises";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const A = await server.ssrLoadModule("/src/alloy.ts");
const PD = await server.ssrLoadModule("/src/phasedata.ts");
const Q = await server.ssrLoadModule("/src/quant.ts");
const M = await server.ssrLoadModule("/src/materials.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

const K2C = 273.15;
const R_GAS = 8.314462618;
const r4 = x => (x == null || !Number.isFinite(x) ? null : +x.toFixed(4));

// ---------------------------------------------------------------------------
// 1. ALLOY-SUMS-EXACT — the superposition's own algebra, recomputed here from
//    BASES rather than read back from derive().
//
//    Deliberately NOT "k_eff = 1 - Q/|dTL|" against the shipped `kPart`: that
//    identity is false for A356+TiB (0.120 vs -0.593) because kRaw is clamped,
//    and checked against the new `kEff` field it would be asserting a
//    definition against itself. Deliberately NOT "dT0 >= Q", which is false for
//    any k > 1 solute.
{
  const cases = [];
  for (const p of A.FAMOUS) cases.push({ label: p.label, mix: p.mix });
  for (const [bk, base] of Object.entries(A.BASES)) {
    for (const [el, s] of Object.entries(base.solutes)) {
      cases.push({ label: `${bk}-${el}`, mix: { base: bk, wt: { [el]: Math.min(1, s.cap) } } });
    }
  }

  const bad = [];
  const kEffs = [];
  let allFinite = true;
  for (const c of cases) {
    const base = A.BASES[c.mix.base];
    const d = A.derive(c.mix);
    const entries = Object.entries(c.mix.wt).filter(([el, w]) => w > 0 && base.solutes[el]);

    let dTL = 0, Qg = 0, totalWt = 0;
    for (const [el, w] of entries) {
      const s = base.solutes[el];
      dTL += s.m * w; Qg += s.m * w * (s.k - 1); totalWt += w;
    }
    // the base-inclusive mole balance, and the guard alloy.ts:151 never had
    const molBase = (100 - totalWt) / base.mass;
    const molAll = entries.reduce((s, [el, w]) => s + w / base.solutes[el].mass, molBase);
    const why = [];
    if (Math.abs(d.dTL - dTL) > 1e-12) why.push(`dTL ${d.dTL} vs ${dTL}`);
    if (Math.abs(d.Q - Qg) > 1e-12) why.push(`Q ${d.Q} vs ${Qg}`);
    if (Math.abs(d.totalWt - totalWt) > 1e-12) why.push("totalWt");
    if (!(molBase > 0)) why.push(`molBase ${molBase} not > 0`);
    for (const [el, w] of entries) {
      const at = (w / base.solutes[el].mass / molAll) * 100;
      if (Math.abs((d.atPct[el] ?? NaN) - at) > 1e-12) why.push(`at% ${el}`);
    }
    // mSI is exactly dTL/c_inf, so mSI * c_inf must reproduce the shift
    if (totalWt > 0 && Math.abs(d.mSI * totalWt - dTL) > 1e-9) why.push("mSI*c != dTL");
    // kEff is the m*c-weighted mean partition: 1 - Q/depression
    const depression = Math.max(0, -dTL);
    const kExp = depression > 1e-6 ? 1 - Qg / depression : null;
    if (kExp == null ? d.kEff !== null : Math.abs(d.kEff - kExp) > 1e-12) why.push("kEff");
    if (![d.dTL, d.Q, d.totalWt, d.mSI].every(Number.isFinite)) allFinite = false;
    if (d.kEff != null) kEffs.push(d.kEff);
    if (why.length) bad.push({ case: c.label, why });
  }

  // Liveness. A collapse returning one constant for every alloy would satisfy
  // every identity above, so the spread is asserted against a floor measured on
  // this tree first: over the 9 presets kEff runs -0.593 (A356+TiB) to 0.553
  // (IN718), a spread of 1.147.
  const presetK = A.FAMOUS.map(p => A.derive(p.mix).kEff).filter(x => x != null);
  const spread = Math.max(...presetK) - Math.min(...presetK);
  const ok = bad.length === 0 && cases.length >= 30 && allFinite && spread > 0.5;
  check("ALLOY-SUMS-EXACT", ok, {
    cases: cases.length, bad, allFinite,
    kEffSpreadOver9Presets: r4(spread), floor: 0.5,
    kEffMin: r4(Math.min(...presetK)), kEffMax: r4(Math.max(...presetK)),
  });
}

// ---------------------------------------------------------------------------
// 2. ALLOY-CLAMP-REPORT — which of the shipped clamps BOUND for each preset,
//    and on which side. A fact about the tree that no definition can satisfy
//    trivially. It is also where the c0-floor finding lives: every addition
//    below 0.75 wt% total is invisible to the solver's c0.
//
//    Note the distinction between a clamp that pushed a STRING and a bound that
//    merely BOUND: 1045 and 4340 push only the depression-cap string, but the
//    mLiq ceiling binds for both as well, and only this census sees it.
{
  const WT_PER_C0 = A.WT_PER_C0;
  const DEPR_CAP = 0.22;
  const census = {};
  for (const p of A.FAMOUS) {
    const base = A.BASES[p.mix.base];
    const mat = M.MATERIALS[base.materialKey];
    const tScale = mat.si && mat.params.latent ? (mat.si.L / mat.si.cp) / mat.params.latent : 100;
    const d = A.derive(p.mix);
    const depression = Math.max(0, -d.dTL);
    const c0raw = d.totalWt / WT_PER_C0;
    const deprDim = depression / tScale;
    const mRaw = Math.min(deprDim, DEPR_CAP) / Math.min(0.7, Math.max(0.05, c0raw));
    const kRaw = depression > 1e-6 ? 1 - d.Q / depression : 0.9;
    const bounds = [];
    if (d.dTL > 0.5) bounds.push("liquidusRaised");
    if (c0raw > 0.7) bounds.push("c0ceil");
    if (c0raw < 0.05) bounds.push("c0floor");
    if (deprDim > DEPR_CAP) bounds.push("deprCap");
    if (mRaw > 0.8) bounds.push("mLiqCeil");
    if (mRaw < 0.1) bounds.push("mLiqFloor");
    if (kRaw < 0.12) bounds.push("kFloor");
    if (kRaw > 0.9) bounds.push("kCeil");
    census[p.label] = bounds;
  }
  // measured on this tree, then pinned
  const EXPECT = {
    "A356": [],
    "A356+TiB": ["kFloor"],
    "AA2024": [],
    // 1045's total solute is 1.45 wt%, so c0raw is 0.097 and the c0 FLOOR does
    // not bind — the first draft of this table said it did, from memory rather
    // than from the tree, and this gate caught it on its first run
    "1045 steel": ["deprCap", "mLiqCeil"],
    "4340 steel": ["deprCap", "mLiqCeil"],
    "IN718 (lite)": ["deprCap"],
    "AZ91": ["deprCap"],
    "tin bronze": ["deprCap"],
    "galv. bath": ["c0floor", "kFloor"],
  };
  const diff = Object.keys(EXPECT).filter(k =>
    (census[k] ?? []).join(",") !== EXPECT[k].join(","));
  // both polarities: at least one preset clamps nothing, at least one clamps
  const clean = Object.values(census).filter(v => v.length === 0).length;
  const dirty = Object.values(census).filter(v => v.length > 0).length;
  check("ALLOY-CLAMP-REPORT", diff.length === 0 && clean >= 1 && dirty >= 1, {
    census, diff, unclamped: clean, clamped: dirty,
    c0FloorMeans: `every addition below ${(0.05 * WT_PER_C0).toFixed(2)} wt% total is invisible to the solver's c0`,
  });
}

// ---------------------------------------------------------------------------
// 3. ALLOY-REFUSE-NAMED — every drop that used to be silent now says what it
//    dropped, in a string containing the offending key, and the DISTINCT set
//    size equals the number of shapes driven. A function that always returned
//    six strings would fail the control arm.
//
//    The plan named six sites. This gate drives the four that are reachable
//    without a DOM, and it names the other two rather than pretending: the
//    composer's own render-time delete needs a DOM, `setMaterial`'s refusal
//    needs the app (CALIB-POUR-WIRED drives it), and the sixth — the 3D
//    `if (k in P)` filter — was measured to drop NOTHING, because every key
//    derive() emits is a declared Phys3DParams field.
{
  const shapes = [];
  // the channel's EXISTENCE is the first assertion, and it fails rather than
  // throws: a gate that crashes on a missing field cannot report the other
  // gates in the same run, which is exactly what happened the first time this
  // file was run against the pre-change tree
  const push = (label, refusals, needle) =>
    shapes.push({ label, n: Array.isArray(refusals) ? refusals.length : "NO SUCH CHANNEL",
      first: Array.isArray(refusals) ? refusals[0] ?? null : null, needle,
      ok: Array.isArray(refusals) && refusals.length >= 1
        && refusals.some(r => r.length > 20 && r.includes(needle)) });

  // derive() must not THROW on anything window.__solidify.alloy can be handed —
  // an exception is a refusal nobody can read. It threw on an unknown base
  // before v7.1 P1, one line before the filter that names every other drop.
  const der = mix => { try { return A.derive(mix).refusals; } catch (e) { return { threw: String(e).slice(0, 60) }; } };
  push("derive: unknown element", der({ base: "al", wt: { Cu: 4.4, Xx: 3 } }), "Xx");
  push("derive: NaN weight", der({ base: "al", wt: { Cu: NaN } }), "Cu");
  push("derive: negative weight", der({ base: "al", wt: { Si: -2 } }), "Si");
  push("derive: unknown base", der({ base: "unobtanium", wt: { Cu: 1 } }), "unobtanium");
  // INHERITED KEYS. `base.solutes.constructor` is truthy, so a truthiness test
  // let {constructor: 5} through every guard and propagated NaN into dTL, Q,
  // mLiq and dSol with refusals EMPTY — a silent drop of exactly the kind this
  // channel exists to close, and one the shapes above cannot see because they
  // only drive keys that correctly fail the check.
  for (const k of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
    push(`derive: inherited key ${k}`, der({ base: "al", wt: { [k]: 5 } }), k);
  }
  push("derive: inherited BASE key", der({ base: "constructor", wt: { Cu: 1 } }), "constructor");
  {
    const r = []; A.decodeMix("alloy=al:Cu.", r);
    push("decodeMix: unreadable weight", r, "Cu.");
  }
  {
    const r = []; A.decodeMix("alloy=al:Si7,Qq3", r);
    push("decodeMix: unknown element", r, "Qq");
  }
  {
    const r = []; A.decodeMix("alloy=al:Si7,notanelement", r);
    push("decodeMix: malformed term", r, "notanelement");
  }
  {
    const r = []; A.decodeMix("alloy=al:Si99", r);
    push("decodeMix: past the cap", r, "Si");
  }
  {
    const r = []; A.decodeMix("alloy=zz:Si7", r);
    push("decodeMix: unknown base", r, "zz");
  }

  // the control: a clean mix and a clean link raise nothing at all, and still
  // produce a full params bundle — so a function that always refuses fails here
  const clean = A.derive({ base: "al", wt: { Si: 7, Mg: 0.35 } });
  const cleanLink = []; A.decodeMix("alloy=al:Si7,Mg0.35", cleanLink);
  // and the empty solute list is well-formed, not a drop
  const emptyLink = []; A.decodeMix("alloy=al:", emptyLink);
  const controlOk = Array.isArray(clean.refusals) && clean.refusals.length === 0
    && cleanLink.length === 0
    && emptyLink.length === 0 && Object.keys(clean.params).length === 5;
  // NO NaN ESCAPES. Every driven shape must leave a params bundle whose numbers
  // are all finite — naming a bad input is only half the job if the bundle it
  // produced would still be assigned onto sim.params.
  const nanEscapes = [];
  for (const mix of [
    { base: "al", wt: { constructor: 5 } }, { base: "al", wt: { toString: 1 } },
    { base: "al", wt: { Cu: 4.4, Xx: 3 } }, { base: "al", wt: { Cu: NaN } },
    { base: "al", wt: { Si: -2 } }, { base: "constructor", wt: { Cu: 1 } },
    { base: "al", wt: { Si: 1e308 } }, { base: "al", wt: {} },
  ]) {
    let d; try { d = A.derive(mix); } catch (e) { nanEscapes.push({ mix: JSON.stringify(mix), threw: String(e).slice(0, 50) }); continue; }
    const bad = Object.entries(d.params).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k);
    if (bad.length) nanEscapes.push({ mix: JSON.stringify(mix), nonFinite: bad });
    if (/NaN|undefined|Infinity/.test(d.dT0Source)) nanEscapes.push({ mix: JSON.stringify(mix), why: "NaN in dT0Source" });
  }

  const distinct = new Set(shapes.map(s => s.first)).size;
  const ok = shapes.every(s => s.ok) && distinct === shapes.length && controlOk
    && nanEscapes.length === 0;
  check("ALLOY-REFUSE-NAMED", ok, {
    shapesDriven: shapes.length, distinctRefusals: distinct, controlOk, nanEscapes,
    failed: shapes.filter(s => !s.ok).map(s => s.label),
    notDrivenHere: [
      "composer.render()'s delete — needs a DOM; unreachable from any UI path, the key can only arrive from decodeMix which filters it first",
      "setMaterial()'s unknown key — needs the app; driven by CALIB-POUR-WIRED",
      "the 3D `if (k in P)` filter — drops NOTHING: all five keys derive() emits are declared Phys3DParams fields, so no input can trigger it",
    ],
  });
}

// ---------------------------------------------------------------------------
// 4. CALIB-MIX-OWN — the poured mix's freezing range equals an independent
//    recomputation of the REGIME-APPROPRIATE formula, and the regime is the one
//    the physics picks.
//
//    Not "A356 differs from Al-4Cu": two different wrong numbers also differ.
{
  const bad = [], regimes = {};
  for (const p of A.FAMOUS) {
    const d = A.derive(p.mix);
    const base = A.BASES[p.mix.base];
    const si = M.MATERIALS[base.materialKey].si;
    const TmC = si.Tm - K2C;
    const TL = TmC + d.dTL;
    const depression = Math.max(0, -d.dTL);
    const kEff = d.kEff;
    const row = d.dominant ? PD.BINARY[p.mix.base][d.dominant] : null;
    regimes[d.dT0Regime] = (regimes[d.dT0Regime] ?? 0) + 1;

    // the independent recomputation — ONE formula, |m|c(1-k)/k, with the branch
    // deciding only whether it is labelled valid or extrapolated
    let want = null;
    const kOk = kEff != null && kEff > 0 && kEff < 1;
    if (depression > 1e-6 && row && kOk) {
      const TS = TmC + (d.mSI / kEff) * d.totalWt;
      if (row.invariant === "isomorphous" || (row.Tinv != null && TS >= row.Tinv)
          || (row.Tinv != null && TS < row.Tinv)) {
        want = Math.abs(d.mSI) * d.totalWt * (1 - kEff) / kEff;
      }
    }
    if (want == null ? d.dT0 !== null : Math.abs(d.dT0 - want) > 1e-9) {
      bad.push({ preset: p.label, got: d.dT0, want, regime: d.dT0Regime });
    }
    // the identity that ties the two printed numbers together: the growth
    // restriction factor IS |m|c(1-k), so dT0 = Q/k in every non-refused branch
    if (d.dT0 != null && Math.abs(d.dT0 * kEff - d.Q) > 1e-9) {
      bad.push({ preset: p.label, why: `dT0*kEff != Q (${d.dT0 * kEff} vs ${d.Q})` });
    }
    // and the branch label must match the temperature test, both directions
    if (row && row.Tinv != null && kOk) {
      const TS = TmC + (d.mSI / kEff) * d.totalWt;
      const wantRegime = TS >= row.Tinv ? "DILUTE" : "PAST-REFERENCE";
      if (d.dT0Regime !== wantRegime) bad.push({ preset: p.label, why: `regime ${d.dT0Regime} != ${wantRegime} (TS ${TS}, Tinv ${row.Tinv})` });
    }
    // An extrapolated gauge must SAY it is one, and must not print a negative
    // freezing range or a ratio against one. The first draft of this arm was
    // `d.dT0 > primary`, which 4340 satisfied with 77.8 > -1.7 while its source
    // string read "freezes over only -1.7 K ... 77822335467.5x the real one" —
    // a vacuous pass on a shipped preset, and the reason the comparison is now
    // conditioned on the primary range existing at all.
    if (d.dT0Regime === "PAST-REFERENCE") {
      const primary = TL - row.Tinv;
      if (!d.dT0Source.includes("EXTRAPOLATED GAUGE")) bad.push({ preset: p.label, why: "extrapolated gauge not labelled" });
      if (primary > 0) {
        if (!d.dT0Source.includes(primary.toFixed(1))) bad.push({ preset: p.label, why: `real primary range ${primary.toFixed(1)} K not printed` });
        if (!(d.dT0 > primary)) bad.push({ preset: p.label, why: "model interval is not wider than the real primary range" });
        if (!/x the real one/.test(d.dT0Source)) bad.push({ preset: p.label, why: "ratio not printed" });
      } else {
        if (/x the real one/.test(d.dT0Source)) bad.push({ preset: p.label, why: "printed a ratio against a non-existent primary range" });
        if (!/no primary freezing range left/.test(d.dT0Source)) bad.push({ preset: p.label, why: "did not say the primary range is absent" });
      }
      // no source string may ever carry a negative kelvin figure or a NaN
      if (/-\d+(\.\d+)? K/.test(d.dT0Source)) bad.push({ preset: p.label, why: "negative kelvin figure in the source string" });
    }
    if (/NaN|undefined|Infinity/.test(d.dT0Source)) bad.push({ preset: p.label, why: "NaN/undefined/Infinity in the source string" });
    if (!d.dT0Source || d.dT0Source.length < 40) bad.push({ preset: p.label, why: "thin dT0Source" });
  }

  // A356 — the case the milestone exists for. Pinned on the MECHANISM: the
  // interval is built from A356's own coefficients (m_eff -6.581, k_eff 0.1375)
  // rather than materials.ts's Al-4Cu -3.4/0.17, it is flagged extrapolated
  // because Si at 7 wt% puts the reference liquid at 53 wt% against a 12.6 wt%
  // eutectic, and the alloy's REAL primary freezing range is printed beside it.
  const a356 = A.derive(A.FAMOUS[0].mix);
  const a356Ok = a356.dT0Regime === "PAST-REFERENCE"
    && Math.abs(a356.dT0 - 303.4211) < 1e-3
    && Math.abs(a356.mSI - (-6.581)) < 1e-3
    && Math.abs(a356.kEff - 0.1375) < 1e-4;

  // Liveness and both polarities: every branch reached, three of them by
  // SHIPPED presets, so a classifier that collapsed to one answer cannot pass.
  const branchOk = (regimes["PAST-REFERENCE"] ?? 0) >= 1 && (regimes.DILUTE ?? 0) >= 1
    && (regimes.REFUSED ?? 0) >= 1;
  const iso = A.derive({ base: "fe", wt: { Cr: 10 } });
  const isoOk = iso.dT0Regime === "ISOMORPHOUS" && iso.dT0 > 0;

  // and the whole point: every preset that calibrates now uses ITS OWN
  // coefficients, not materials.ts's. Asserted as a difference from the
  // material default for every non-refused preset.
  const usesOwn = A.FAMOUS.map(p => {
    const d = A.derive(p.mix);
    if (d.dT0 == null) return null;
    const si = M.MATERIALS[A.BASES[p.mix.base].materialKey].si;
    const def = Q.referenceInterval(si, true, d.params.c0 * A.WT_PER_C0);
    return { label: p.label, own_K: r4(d.dT0, 2), materialDefault_K: r4(def, 2), differs: Math.abs(d.dT0 - def) > 1e-6 };
  }).filter(Boolean);

  check("CALIB-MIX-OWN", bad.length === 0 && a356Ok && branchOk && isoOk
    && usesOwn.every(u => u.differs), {
    bad, regimes, branchOk, isoOk,
    isoCase: { mix: "Fe-10Cr", dT0: r4(iso.dT0), regime: iso.dT0Regime },
    a356: {
      dT0_K: r4(a356.dT0, 2), regime: a356.dT0Regime,
      mSI: r4(a356.mSI), kEff: r4(a356.kEff, 5),
      materialDefaultWouldBe_K: r4(Q.referenceInterval(M.MATERIALS.al.si, true, a356.params.c0 * A.WT_PER_C0), 2),
      realPrimaryRange_K: r4(M.MATERIALS.al.si.Tm - K2C + a356.dTL - PD.BINARY.al.Si.Tinv, 2),
    },
    everyCalibratedPresetUsesItsOwn: usesOwn,
  });
}

// ---------------------------------------------------------------------------
// 5. CALIB-MIX-REFUSE — a mix with no usable freezing range says so, and says
//    WHICH clause fired. A refusal that names the wrong mechanism is a wrong
//    statement rather than an absent one.
{
  const CASES = [
    { label: "Mg-0.8Zr", mix: { base: "mg", wt: { Zr: 0.8 } }, clause: "raises this melt's liquidus", needle: "Zr" },
    { label: "Al-0.5Ti", mix: { base: "al", wt: { Ti: 0.5 } }, clause: "raises this melt's liquidus", needle: "Ti" },
    { label: "A356+TiB", mix: A.FAMOUS[1].mix, clause: "outside (0,1)", needle: "-0.593" },
    { label: "Al-0.5Si-0.1Ti", mix: { base: "al", wt: { Si: 0.5, Ti: 0.1 } }, clause: "outside (0,1)", needle: "k_eff" },
    { label: "pure Al", mix: { base: "al", wt: {} }, clause: "no solute", needle: "no solute" },
    { label: "unknown base", mix: { base: "unobtanium", wt: { Cu: 1 } }, clause: "no base metal named", needle: "unobtanium" },
  ];
  const bad = [];
  for (const c of CASES) {
    let d;
    try { d = A.derive(c.mix); } catch (e) { bad.push({ label: c.label, why: `derive threw: ${String(e).slice(0, 60)}` }); continue; }
    if (d.dT0Regime !== "REFUSED") { bad.push({ label: c.label, why: `regime ${d.dT0Regime}, expected REFUSED` }); continue; }
    if (d.dT0 !== null) bad.push({ label: c.label, why: "refused but still returned a number" });
    if (!d.dT0Source.includes(c.clause)) bad.push({ label: c.label, why: `clause not named: ${d.dT0Source.slice(0, 90)}` });
    if (!d.dT0Source.includes(c.needle)) bad.push({ label: c.label, why: `offending value not named (${c.needle})` });
  }
  // the three clauses are genuinely different mechanisms, not one string
  const clauses = new Set(CASES.map(c => { try { return A.derive(c.mix).dT0Source; } catch { return "threw:" + c.label; } }));
  // POSITIVE POLARITY, and it is what stops this gate from being satisfied by a
  // function that refuses everything: 8 of the 9 shipped presets DO calibrate,
  // and every one of them on its own chemistry.
  const calibrates = A.FAMOUS.filter(p => A.derive(p.mix).dT0 != null);
  const positive = calibrates.length >= 8
    && calibrates.every(p => A.derive(p.mix).dT0 > 0);
  // a refused mix still calibrates - on the material's own numbers, finite and
  // positive, never a negative dT0
  const si = M.MATERIALS.al.si;
  const refusedStill = Q.calibrate({ si, alloy: true, c0wt: 7.47, lambda: 30, dT0Override: null });

  check("CALIB-MIX-REFUSE", bad.length === 0 && clauses.size === CASES.length
    && positive && refusedStill.dT0 > 0 && Number.isFinite(refusedStill.dT0), {
    driven: CASES.length, bad, distinctReasons: clauses.size,
    presetsThatCalibrate: `${calibrates.length}/9`,
    onlyRefusedPreset: A.FAMOUS.filter(p => A.derive(p.mix).dT0 == null).map(p => p.label),
    fallbackStillFinite: r4(refusedStill.dT0),
  });
}

// ---------------------------------------------------------------------------
// 6. CALIB-MIX-OFF-IDENTITY — with no poured mix, calibrate() is the function
//    that shipped before v7.1 P1, to Object.is. The reference is TRANSCRIBED
//    here rather than quoted as literals, so it cannot go stale and cannot be
//    re-baselined by editing a number.
//
//    Two nulls compare equal, which is exactly the failure lessons.md:25-42
//    exists to prevent, so the materials WITHOUT an si block are asserted by
//    NAME and by count rather than by both sides returning null.
{
  const A1 = 0.8839, A2 = 0.6267, DX = 0.8, SAFE = 0.15;
  const pre = (si, alloy, c0wt, lambda) => {
    const dT0 = alloy
      ? (Math.abs(si.mL) * Math.max(1e-6, c0wt)
         * (1 - Math.min(0.999, Math.max(1e-3, si.kPart)))) / Math.min(0.999, Math.max(1e-3, si.kPart))
      : si.L / si.cp;
    const d0 = si.Gamma / dT0;
    const W0 = (lambda * d0) / A1;
    const D = alloy ? si.Dl : si.alphaTh;
    const dTilde = A2 * lambda;
    return {
      dT0, d0, W0, tau0: (A2 * lambda * W0 * W0) / D, dTilde,
      latent: si.L / si.cp / dT0, umPerCell: W0 * DX * 1e6,
      dx: DX, dt: (SAFE * DX * DX) / Math.max(1, dTilde),
    };
  };

  const withSi = Object.entries(M.MATERIALS).filter(([, m]) => !!m.si).map(([k]) => k);
  const withoutSi = Object.entries(M.MATERIALS).filter(([, m]) => !m.si).map(([k]) => k);
  const FIELDS = ["dT0", "d0", "W0", "tau0", "dTilde", "latent", "umPerCell", "dx", "dt"];
  const bad = [];
  for (const key of withSi) {
    const si = M.MATERIALS[key].si;
    const c0wt = (M.MATERIALS[key].params.c0 ?? 0.3) * A.WT_PER_C0;
    for (const alloy of [true, false]) {
      for (const lambda of [3, 30]) {
        const got = Q.calibrate({ si, alloy, c0wt, lambda });
        const want = pre(si, alloy, c0wt, lambda);
        for (const f of FIELDS) {
          if (!Object.is(got[f], want[f])) bad.push({ key, alloy, lambda, field: f, got: got[f], want: want[f] });
        }
        // an explicit null override must also be inert
        const nulled = Q.calibrate({ si, alloy, c0wt, lambda, dT0Override: null });
        for (const f of FIELDS) if (!Object.is(nulled[f], want[f])) bad.push({ key, alloy, lambda, field: f, why: "null override moved it" });
        if (!got.coefficientSource || got.coefficientSource.length < 20) bad.push({ key, alloy, why: "empty coefficientSource" });
      }
    }
  }
  // and the source string CHANGES when a mix is supplied, so it is not a constant
  const alSi = M.MATERIALS.al.si;
  const plain = Q.calibrate({ si: alSi, alloy: true, c0wt: 4.5, lambda: 30 });
  const poured = Q.calibrate({ si: alSi, alloy: true, c0wt: 4.5, lambda: 30, dT0Override: 34.98 });
  const sourceMoved = plain.coefficientSource !== poured.coefficientSource
    && poured.dT0 === 34.98 && plain.dT0 !== 34.98;

  // the two abstract materials, by name — `si: {` appears 9 times against 11 keys
  const namesOk = withSi.length === 9 && withoutSi.length === 2
    && withoutSi.includes("generic") && withoutSi.includes("qc")
    && Object.keys(M.MATERIALS).length === 11;

  check("CALIB-MIX-OFF-IDENTITY", bad.length === 0 && namesOk && sourceMoved, {
    materialsWithSi: withSi, materialsWithoutSi: withoutSi,
    comparisons: withSi.length * 2 * 2 * FIELDS.length, mismatches: bad.slice(0, 6),
    sourceMovedWithPour: sourceMoved,
  });
}

// ---------------------------------------------------------------------------
// 7. DEPR-CONSISTENT — the composer prints a liquidus depression in kelvin, and
//    the solver integrates mLiq*c0 in dimensionless units. This gate states the
//    exact relation between them: they agree EXACTLY when no bound bound, and
//    they differ whenever one did. Measured, 1045 is the worst case - it prints
//    40.7 K and the solver integrates 12.9 K, a factor of 3.1.
{
  const DEPR_CAP = 0.22;
  const rows = [], bad = [];
  const probe = [
    ...A.FAMOUS.map(p => ({ label: p.label, mix: p.mix })),
    { label: "al-Cu0.1 (mLiq floor)", mix: { base: "al", wt: { Cu: 0.1 } } },
    { label: "al-Si1", mix: { base: "al", wt: { Si: 1 } } },
  ];
  for (const p of probe) {
    const base = A.BASES[p.mix.base];
    const mat = M.MATERIALS[base.materialKey];
    const tScale = mat.si && mat.params.latent ? (mat.si.L / mat.si.cp) / mat.params.latent : 100;
    const d = A.derive(p.mix);
    const printed = Math.max(0, -d.dTL);
    const solver = d.params.mLiq * d.params.c0 * tScale;
    const ratio = printed > 0 ? solver / printed : null;
    const c0raw = d.totalWt / A.WT_PER_C0;
    const c0 = Math.min(0.7, Math.max(0.05, c0raw));
    const deprDim = printed / tScale;
    const mRaw = Math.min(deprDim, DEPR_CAP) / c0;
    // THE EXACT PREDICATE, and its first draft was wrong in an instructive way.
    // It also required c0 to survive unclamped, and galv. bath failed the gate
    // by agreeing exactly while sitting on the c0 floor. The reason is algebra:
    // mLiq is DERIVED as depression/c0, so mLiq*c0 puts the same c0 back and the
    // clamp cancels. Only the depression cap and the mLiq bounds can move what
    // the solver integrates. Recorded rather than quietly repaired, because the
    // c0 floor genuinely does bite elsewhere — on the SOLUTE FIELD, not here.
    const unbound = deprDim <= DEPR_CAP && mRaw >= 0.1 && mRaw <= 0.8;
    const agrees = ratio != null && Math.abs(ratio - 1) < 1e-9;
    if (ratio != null && unbound !== agrees) {
      bad.push({ label: p.label, unbound, agrees, ratio });
    }
    rows.push({ label: p.label, printed_K: r4(printed, 3), solver_K: r4(solver, 3), ratio: r4(ratio), unbound });
  }
  const exact = rows.filter(r => r.unbound).length;
  const diverged = rows.filter(r => r.ratio != null && !r.unbound).length;
  check("DEPR-CONSISTENT", bad.length === 0 && exact >= 1 && diverged >= 1, {
    rows, bad, exactAgreement: exact, diverged,
    worst: rows.reduce((w, r) => (r.ratio != null && (w == null || Math.abs(r.ratio - 1) > Math.abs(w.ratio - 1)) ? r : w), null),
  });
}

// ---------------------------------------------------------------------------
// 8. PD-CONSTRUCT-AGREE — owed by P0 and specified there: the invariant chord
//    reconstructs the shipped dilute coefficients, per row, against a baseline
//    measured on this tree before anything was pinned.
//
//    It CANNOT be a global band, and that is measured rather than asserted:
//    across the 22 non-isomorphous pairs only 12 agree within 25 % on both m
//    and k, and the misses are physics - Cu-Sn, Al-Zn, Fe-Si and Zn-Al all have
//    invariants far from the dilute limit, where a chord drawn across the whole
//    diagram is simply not the dilute slope. materials.ts:127 said exactly that
//    about Cu-Sn before it was measured. So each row is pinned to its own ratio.
{
  const BASELINE = {
    "al-Cu": [0.9935, 1.0011], "al-Si": [1.0023, 1.0913], "al-Mg": [0.9694, 0.9748],
    "al-Fe": [0.9907, 0.9630], "fe-Si": [2.3153, 1.7829], "fe-Mo": [0.9283, 1.1951],
    "ni-Nb": [0.7621, 1.7650], "ni-Ti": [0.6546, 1.3768], "ni-Al": [1.2043, 0.9836],
    "ni-Cr": [1.4359, 0.9196], "ni-Mo": [0.9671, 1.0722], "ni-W": [0.8922, 0.6821],
    "mg-Al": [0.9550, 1.0794], "mg-Zn": [0.9995, 1.0032], "zn-Al": [1.5735, 2.3400],
  };
  const seen = [], excluded = [], bad = [];
  for (const [bk, base] of Object.entries(A.BASES)) {
    const TmC = M.MATERIALS[base.materialKey].si.Tm - K2C;
    for (const [el, s] of Object.entries(base.solutes)) {
      const row = PD.BINARY[bk][el];
      const key = `${bk}-${el}`;
      if (!(row.invariant === "eutectic" && row.Cinv != null && row.Cinv <= 60)) {
        excluded.push(key); continue;
      }
      const mRatio = ((row.Tinv - TmC) / row.Cinv) / s.m;
      const kRatio = (row.Csm / row.Cinv) / s.k;
      seen.push({ key, mRatio: r4(mRatio), kRatio: r4(kRatio) });
      const want = BASELINE[key];
      if (!want) { bad.push({ key, why: "row entered the comparison with no recorded baseline" }); continue; }
      if (Math.abs(mRatio - want[0]) > 5e-4 || Math.abs(kRatio - want[1]) > 5e-4) {
        bad.push({ key, got: [r4(mRatio), r4(kRatio)], want });
      }
    }
  }
  const missing = Object.keys(BASELINE).filter(k => !seen.some(s => s.key === k));
  // the anti-derivation clause: if every ratio were exactly 1, phasedata.ts was
  // generated from alloy.ts and this gate is comparing a table with itself
  const allOne = seen.every(s => Math.abs(s.mRatio - 1) < 1e-9 && Math.abs(s.kRatio - 1) < 1e-9);
  const within25 = seen.filter(s =>
    Math.abs(Math.log(Math.abs(s.mRatio))) <= Math.log(1.25)
    && Math.abs(Math.log(s.kRatio)) <= Math.log(1.25)).length;
  check("PD-CONSTRUCT-AGREE",
    bad.length === 0 && missing.length === 0 && seen.length >= 7
    && excluded.length >= 1 && !allOne, {
    entered: seen.length, excluded: excluded.length, excludedRows: excluded,
    bad, missingBaseline: missing, allRatiosExactlyOne: allOne,
    agreeWithin25pct: `${within25}/${seen.length}`,
    namedDisagreements: seen.filter(s => Math.abs(s.mRatio) > 1.25 || s.kRatio > 1.25
      || Math.abs(s.mRatio) < 0.8 || s.kRatio < 0.8).map(s => s.key),
  });
}

// ---------------------------------------------------------------------------
// 9. PD-VANTHOFF-CROSSCHECK — a third opinion, and a TRANSCRIPTION TRIPWIRE
//    ONLY. It is not an estimator and this gate does not let it become one.
//
//    The ideal dilute liquidus is  |m_X| = (R*Tm^2/dH_fus)*(1-k)  per unit mole
//    fraction, so |m_X|/(1-k) over R*Tm^2/dH_fus should be O(1) for a strongly
//    rejected solute. CORRECTION TO THE P0 PLAN, which wrote the product
//    "|m_at|(1-k)" instead of the quotient: that is the wrong rearrangement of
//    the same relation, and the two differ by (1-k)^2. Both are printed below.
//
//    Measured over the 7 pairs with k <= 0.2 the quotient spans 0.41-2.20, a
//    factor of 5.3 - so as a BAND it would assert almost nothing. It is pinned
//    per pair instead, which is what catches a mistyped m, k, L, Tm or mass.
{
  const BASELINE = {
    "al-Cu": 1.4264, "al-Si": 1.1544, "al-Fe": 0.9465, "fe-C": 1.0223,
    "mg-Zn": 2.1963, "cu-Sn": 1.4255, "zn-Al": 0.4124,
  };
  const seen = [], bad = [], excluded = [];
  for (const [bk, base] of Object.entries(A.BASES)) {
    const si = M.MATERIALS[base.materialKey].si;
    const ideal = R_GAS * si.Tm * si.Tm / (si.L * (base.mass / 1000));
    for (const [el, s] of Object.entries(base.solutes)) {
      const key = `${bk}-${el}`;
      if (s.k > 0.2) { excluded.push(key); continue; }
      const mX = s.m / (base.mass / (100 * s.mass));   // K per unit mole fraction
      const q = Math.abs(mX) / (1 - s.k) / ideal;
      const prod = Math.abs(mX) * (1 - s.k) / ideal;
      seen.push({ key, k: s.k, quotient: r4(q), planProduct: r4(prod) });
      const want = BASELINE[key];
      if (want == null) { bad.push({ key, why: "no recorded baseline" }); continue; }
      if (Math.abs(q - want) > 5e-4) bad.push({ key, got: r4(q), want });
    }
  }
  const missing = Object.keys(BASELINE).filter(k => !seen.some(s => s.key === k));
  const qs = seen.map(s => s.quotient);
  // liveness clause sized AFTER counting: 7 of the 25 pairs have k <= 0.2, and
  // 18 are excluded. Both sides asserted non-empty.
  check("PD-VANTHOFF-CROSSCHECK",
    bad.length === 0 && missing.length === 0 && seen.length === 7 && excluded.length === 18, {
    entered: seen.length, excluded: excluded.length, bad, missingBaseline: missing, rows: seen,
    quotientSpan: `${Math.min(...qs).toFixed(3)}-${Math.max(...qs).toFixed(3)} (${(Math.max(...qs) / Math.min(...qs)).toFixed(1)}x)`,
    note: "a tripwire, not an estimator: the span is too wide to be a band and this gate never treats it as one",
  });
}

// ---------------------------------------------------------------------------
// 10. PD-DOC-CALIBRATION — the honesty page quotes numbers this module computes,
//     and nothing gated them before v7.1 P1 added more of them.
//
//     `HT-DOC-CONSTANTS` polices the heat-treatment constants the same way and
//     exists for the same reason: a document that quotes a retired number is
//     worse than one that quotes none, because a reader has no way to tell.
//     Every value below is recomputed here from BASES / MATERIALS / phasedata
//     and then required to appear, rounded as written, in the prose.
{
  // The prose sets minus signs as U+2212 and the code emits ASCII hyphens, so
  // both sides are normalised before comparison — otherwise this gate would be
  // a typography check wearing a physics gate's name.
  const norm = t => t.replace(/−/g, "-");
  const html = norm(await readFile(new URL("../science/index.html", import.meta.url), "utf8"));
  const d = m => A.derive(m);
  const matDefault = mix => {
    const dd = d(mix);
    return Q.referenceInterval(M.MATERIALS[A.BASES[mix.base].materialKey].si, true,
      dd.params.c0 * A.WT_PER_C0);
  };
  const a356 = d(A.FAMOUS[0].mix), tib = d(A.FAMOUS[1].mix);
  const in718 = d(A.FAMOUS[5].mix), az91 = d(A.FAMOUS[6].mix);
  const s4340 = d(A.FAMOUS[4].mix);
  const TmC = M.MATERIALS.al.si.Tm - K2C;
  const primary = TmC + a356.dTL - PD.BINARY.al.Si.Tinv;

  const CLAIMS = [
    ["4340 material-default dT0", `${Math.round(matDefault(A.FAMOUS[4].mix))} K`],
    ["4340 poured dT0", `${Math.round(s4340.dT0)} K`],
    ["IN718 poured dT0", `${Math.round(in718.dT0)} K`],
    ["AZ91 poured dT0", `${Math.round(az91.dT0)} K`],
    ["A356 poured dT0", `${Math.round(a356.dT0)} K`],
    ["A356 real primary range", `${Math.round(primary)} K`],
    ["A356 model/primary ratio", (a356.dT0 / primary).toFixed(1)],
    ["A356 reference liquid", `${Math.round(a356.totalWt / a356.kEff)} wt% Si`],
    ["Al-Si invariant liquid", `${PD.BINARY.al.Si.Cinv} wt%`],
    ["A356+TiB k_eff", tib.kEff.toFixed(2)],
    ["Al si.mL", `${M.MATERIALS.al.si.mL} K/wt%`],
    ["Al si.kPart", `${M.MATERIALS.al.si.kPart}`],
  ];
  const missing = CLAIMS.filter(([, v]) => !html.includes(norm(v))).map(([k, v]) => `${k}: "${v}"`);
  // liveness: the section must exist at all, and every claim must be a real
  // number rather than a NaN that trivially fails to appear
  const sectionPresent = /EXTRAPOLATED GAUGE/.test(html) && /Which alloy's freezing range/.test(html);
  const allFinite = CLAIMS.every(([, v]) => !/NaN|Infinity|undefined/.test(v));
  check("PD-DOC-CALIBRATION", missing.length === 0 && sectionPresent && allFinite
    && CLAIMS.length >= 10, {
    claimsChecked: CLAIMS.length, missing, sectionPresent,
    quoted: Object.fromEntries(CLAIMS),
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all alloy/calibration checks passed");
if (failures) process.exitCode = 1;
