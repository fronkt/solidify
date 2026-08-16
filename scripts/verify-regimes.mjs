// PD-REGIME-* / ALLOY-PHASES-NAMED / PD-CAP-CEILING / ALLOY-SHARE-CLAMP —
// v7.1 P3's composition regimes, the invariant fraction, and the ceiling that
// now comes from the diagram instead of from a hand-picked slider bound.
//
// WHAT THIS MILESTONE CLAIMS, AND THEREFORE WHAT IS CHECKED HERE.
//   1. Every composition lands in exactly one named regime, and the boundaries
//      are the row's own two compositions — tested from BOTH sides of each.
//   2. Across the invariant the NAME of the first phase to freeze changes, and
//      both names come out of the table rather than out of this gate.
//   3. The share of the casting that freezes at the invariant is printed for a
//      EUTECTIC and refused for a peritectic - not because the lever rule and
//      Gulliver-Scheil "do not describe a peritectic", which is false on both
//      halves and is the retired explanation this file now BANS, but because
//      the quantity is different: at a eutectic every drop of remaining liquid
//      freezes AT T_inv, while a peritectic consumes only part of it and the
//      rest freezes BELOW T_p on the product's own solidus.
//   3b. What a peritectic prints instead is sharper than a fraction - whether
//      the reaction consumes the phase this solver grows. 1045 and 4340 both
//      sit above Fe-C's product at 0.17 wt% C, so their delta-ferrite is eaten
//      entirely and the casting ends as austenite while the solver grows delta.
//   3c. Below the equilibrium solubility limit the readout still gives
//      Gulliver-Scheil its say: AZ91 at 9 wt% Al is inside Mg-Al's 12.9 wt%
//      limit and Scheil still puts 11.9 % of the casting through the eutectic.
//   4. No composition at or past the invariant liquid is reachable by ANY
//      route: not the slider, not a share link, not window.__solidify.alloy.
//   5. Every pre-arc share link still restores to a melt.
//
// The ceiling is an INTENDED break of a shipped range and the largest one this
// arc makes: the Fe-C slider stops at 0.52 wt% C, one step below the 0.53 wt%
// peritectic it must not reach, so cast iron leaves the composer. Past
// that peritectic the first phase to freeze is austenite and this solver grows
// one solid phase which materials.ts models as bcc delta-ferrite, so what the
// app drew for a 3 wt% C melt was not an approximation of cast iron, it was a
// different casting. Frank approved the removal explicitly.
//
//   node scripts/verify-regimes.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const A = await server.ssrLoadModule("/src/alloy.ts");
const PD = await server.ssrLoadModule("/src/phasedata.ts");
const F = await server.ssrLoadModule("/src/phasediagram.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const r4 = x => (x == null || !Number.isFinite(x) ? null : +x.toFixed(4));
const safe = (fn, fallback = null) => { try { return fn(); } catch (e) { return { threw: String(e).slice(0, 80), ...(fallback ?? {}) }; } };
/**
 * Each of the five gates runs inside one of these, and it is not decoration.
 * Run against the pre-P3 tree — which is how every gate in this arc is proven
 * non-vacuous — `A.phasesFor` and `PD.shortPhase` do not exist, and the first
 * unwrapped call to one took the whole file down with ZERO lines of output. A
 * gate that cannot report is worse than one that fails: it looks like a gate
 * nobody ran. This is lessons.md's rule from v7.1 P1 applied one level up, from
 * the individual driver to the block.
 */
const block = (name, fn) => {
  try { fn(); } catch (e) {
    check(name, false, { threw: String(e).slice(0, 160), note: "this gate could not run at all against this tree" });
  }
};

// ---------------------------------------------------------------------------
// 1. PD-REGIME-EXACT — one regime per composition, boundaries exact from both
//    sides, and the primary phase's NAME changes across the invariant.
//
//    Deliberately NOT "A356 comes out two-phase", which one hardcoded branch
//    satisfies. Every row in the table is driven at four sampled compositions
//    and at both sides of both of its boundaries.
block("PD-REGIME-EXACT", () => {
  const EPS = 1e-9;
  const bad = [];
  const counts = {};
  let productPeritectics = 0, isoRows = 0, invariantRows = 0;
  const nameChanges = [], unplaceable = [];
  // measured, then pinned: exactly one shipped row fails the geometric
  // consistency test, and a NEW one appearing here must fail this gate
  const KNOWN_UNPLACEABLE = ["ni-W"];

  for (const [bk, base] of Object.entries(A.BASES)) {
    for (const el of Object.keys(base.solutes)) {
      const row = PD.BINARY[bk][el];
      const key = `${bk}-${el}`;
      const P = `(${base.symbol})`;
      const at = w => safe(() => A.phasesFor(bk, el, w));
      const why = [];

      if (row.invariant === "isomorphous") {
        isoRows++;
        // no invariant to cross, at any composition, so the branch is asserted
        // over the whole axis rather than at one convenient point
        for (const w of [0.01, 1, 5, 50, 99]) {
          const p = at(w);
          if (p?.regime !== "SINGLE-PHASE-ALL-COMPOSITIONS") why.push(`iso at ${w}: ${p?.regime ?? p?.threw}`);
          if (p?.primary !== P) why.push(`iso primary at ${w}: ${p?.primary}`);
          if (p?.fraction !== null) why.push(`iso returned a fraction at ${w}`);
          if (p?.notGrown !== null) why.push(`iso named an ungrown phase at ${w}`);
          counts[p?.regime] = (counts[p?.regime] ?? 0) + 1;
        }
        if (why.length) bad.push({ key, why });
        continue;
      }

      // THE ONE ROW THAT CANNOT BE PLACED, carried as a named exception in the
      // idiom PD-SLOPE-CONSISTENT established for it in v7.1 P2. Ni-W asserts
      // both a rising liquidus and a liquid-richer invariant, and v7.1 P3
      // extended P2's refusal from the DRAWING to the CLAIM: an app that will
      // not draw a row should not narrate it either. Asserted refused, and
      // asserted refused for the GEOMETRY rather than for a missing field, so
      // this exception cannot quietly become "the row went away".
      if (KNOWN_UNPLACEABLE.includes(key)) {
        unplaceable.push(key);
        const p = at((row.Csm + row.Cinv) / 2);
        if (p?.regime !== "UNASSESSED") why.push(`${key} is ${p?.regime}, but its geometry is impossible`);
        if (!/cannot be placed/.test(p?.source ?? "")) why.push(`${key} refused without naming the geometry`);
        if (!/C_SM/.test(p?.source ?? "") || !/C_inv/.test(p?.source ?? "")) why.push(`${key}'s refusal does not name both compositions`);
        if (p?.fraction) why.push(`${key} returned a fraction from an impossible row`);
        if (why.length) bad.push({ key, why });
        continue;
      }

      invariantRows++;
      const { Tinv, Cinv, Csm } = row;
      const second = PD.shortPhase(row.second);

      // ---- BOTH SIDES OF THE INVARIANT LIQUID
      const below = at(Cinv - EPS), atInv = at(Cinv), above = at(Cinv + EPS);
      if (below?.regime === "PAST-THE-INVARIANT") why.push(`C_inv-eps classified past the invariant`);
      if (atInv?.regime !== "PAST-THE-INVARIANT") why.push(`C_inv itself is ${atInv?.regime ?? atInv?.threw}, not PAST-THE-INVARIANT`);
      if (above?.regime !== "PAST-THE-INVARIANT") why.push(`C_inv+eps is ${above?.regime}`);

      // ---- THE NAME OF THE FIRST PHASE TO FREEZE CHANGES ACROSS IT, and both
      //      names are drawn from the table so two empty strings cannot pass as
      //      "different".
      const nBelow = below?.primary, nAbove = above?.primary;
      if (nBelow !== P) why.push(`primary below the invariant is "${nBelow}", not the base's own ${P}`);
      if (nAbove !== second) why.push(`primary above the invariant is "${nAbove}", not the row's own second phase "${second}"`);
      if (!nBelow || nBelow.length < 2) why.push("primary name below is empty");
      if (!nAbove || nAbove.length < 2) why.push("primary name above is empty");
      if (nBelow === nAbove) why.push("the primary phase name does not change across the invariant");
      else nameChanges.push({ key, below: nBelow, above: nAbove });

      // ---- BOTH SIDES OF THE MAXIMUM SOLID SOLUBILITY. Which pair of regimes
      //      that is depends on the row's own topology, and BOTH topologies are
      //      asserted rather than one being skipped.
      const sBelow = at(Csm - EPS), sAt = at(Csm), sAbove = at(Csm + EPS);
      if (Csm < Cinv) {
        if (sBelow?.regime !== "SINGLE-PHASE") why.push(`C_SM-eps is ${sBelow?.regime}, not SINGLE-PHASE`);
        if (sAt?.regime !== "SINGLE-PHASE") why.push(`C_SM itself is ${sAt?.regime} — the limit dissolves, so it is single-phase`);
        if (sAbove?.regime !== "TWO-PHASE-TERMINATION") why.push(`C_SM+eps is ${sAbove?.regime}, not TWO-PHASE-TERMINATION`);
        if (sAbove?.equilibrium?.join("|") !== [P, second].join("|")) why.push(`two-phase equilibrium set is [${sAbove?.equilibrium}]`);
      } else {
        // THE PRODUCT-PERITECTIC CLASS (Al-Ti, Mg-Zr): the invariant liquid is
        // LEANER than the maximum solid solubility, so the whole two-phase band
        // lies past the invariant and both sides of C_SM are refused ground.
        // Classified in the other order these rows report SINGLE-PHASE for a
        // melt whose first solid is Al3Ti, which is why C_inv is tested first.
        productPeritectics++;
        for (const [lbl, p] of [["C_SM-eps", sBelow], ["C_SM", sAt], ["C_SM+eps", sAbove]]) {
          if (p?.regime !== "PAST-THE-INVARIANT") why.push(`${lbl} on a product-peritectic row is ${p?.regime}, not PAST-THE-INVARIANT`);
        }
      }

      // ---- one regime, never two, and always one
      for (const w of [Csm / 2, (Csm + Cinv) / 2, Cinv * 0.99, Cinv * 1.5]) {
        const p = at(w);
        if (!p || !p.regime) { why.push(`no regime at ${w}`); continue; }
        counts[p.regime] = (counts[p.regime] ?? 0) + 1;
        if (!p.source || p.source.length < 40) why.push(`thin source at ${w} wt%`);
        if (/NaN|undefined|Infinity/.test(p.source)) why.push(`NaN/undefined in the source at ${w} wt%`);
        if (!p.equilibrium?.length) why.push(`no equilibrium phase list at ${w} wt%`);
        if (p.equilibrium.some(x => !x || x.length < 2)) why.push(`empty phase name at ${w} wt%`);
      }
      if (Tinv == null) why.push("row has an invariant type but no temperature");
      if (why.length) bad.push({ key, why });
    }
  }

  // ---- the DRAWN half: the shaded band's edges are the row's own numbers.
  const bandBad = [];
  for (const p of A.FAMOUS) {
    const fig = safe(() => F.layout(p.mix, null));
    if (!fig?.ok) { bandBad.push({ preset: p.label, why: "figure refused" }); continue; }
    const d = A.derive(p.mix);
    const row = PD.BINARY[p.mix.base][d.dominant];
    const band = fig.band;
    if (!band) { bandBad.push({ preset: p.label, why: "no band" }); continue; }
    if (band.regime !== d.regime) bandBad.push({ preset: p.label, why: `band ${band.regime} != derived ${d.regime}` });
    if (band.regime === "TWO-PHASE-TERMINATION") {
      if (!Object.is(band.c0, row.Csm) || !Object.is(band.c1, row.Cinv)) bandBad.push({ preset: p.label, why: `band [${band.c0}, ${band.c1}] != [C_SM ${row.Csm}, C_inv ${row.Cinv}]` });
      if (!band.label.includes(PD.shortPhase(row.second))) bandBad.push({ preset: p.label, why: "band label does not name the second phase" });
    } else if (band.regime === "SINGLE-PHASE") {
      if (!Object.is(band.c0, 0) || !Object.is(band.c1, Math.min(row.Csm, row.Cinv))) bandBad.push({ preset: p.label, why: `single-phase band [${band.c0}, ${band.c1}] != [0, ${Math.min(row.Csm, row.Cinv)}]` });
    }
    if (!(band.c1 > band.c0)) bandBad.push({ preset: p.label, why: "degenerate band" });
    if (band.c1 > fig.xMax + 1e-9) bandBad.push({ preset: p.label, why: "band runs off the axis" });
    // the pour is INSIDE its own band, which is the claim the shading makes
    const cDom = p.mix.wt[d.dominant];
    if (!(cDom >= band.c0 - 1e-9 && cDom <= band.c1 + 1e-9)) bandBad.push({ preset: p.label, why: `the pour at ${cDom} wt% is outside its own band [${band.c0}, ${band.c1}]` });
  }
  // both band shapes drawn by shipped presets, or one branch is never exercised
  const bandRegimes = A.FAMOUS.map(p => { const f = safe(() => F.layout(p.mix, null)); return f?.ok ? f.band?.regime : null; }).filter(Boolean);

  const ok = bad.length === 0 && bandBad.length === 0
    && invariantRows >= 20 && isoRows >= 1 && productPeritectics >= 2
    && (counts["SINGLE-PHASE"] ?? 0) >= 1 && (counts["TWO-PHASE-TERMINATION"] ?? 0) >= 1
    && (counts["PAST-THE-INVARIANT"] ?? 0) >= 1
    && (counts["SINGLE-PHASE-ALL-COMPOSITIONS"] ?? 0) >= 1
    && !counts["UNASSESSED"] && !counts["NONE"]
    && unplaceable.length === KNOWN_UNPLACEABLE.length
    && new Set(bandRegimes).size >= 2;
  check("PD-REGIME-EXACT", ok, {
    invariantRows, isoRows, productPeritectics, bad, bandBad,
    geometricallyUnplaceableRows: unplaceable,
    regimeCensus: counts,
    bandRegimesOverPresets: [...new Set(bandRegimes)],
    primaryPhaseChangesAcrossTheInvariant: nameChanges.length,
    sample: nameChanges.slice(0, 4),
    note: "UNASSESSED is asserted UNREACHABLE from the shipped table: every pair in BASES has a row in BINARY, which PD-ROW-SOURCED proves is a bijection",
  });
});

// ---------------------------------------------------------------------------
// 2. PD-INVARIANT-BAND — the two closed forms, recomputed here, plus the
//    properties that a transposed formula cannot satisfy.
//
//    Pinning the module's own output against the module's own formula would be
//    a definition checked against itself, so the anchors below are INDEPENDENT
//    statements about what these numbers mean:
//      - as k -> 0 the solid takes nothing, so mass balance alone says the
//        eutectic share is c0/C_inv. Gulliver-Scheil must approach it.
//      - the lever rule is linear in c0, so a quarter of the way across the
//        band it is exactly 0.25. A flipped lever gives 0.75.
//      - at c0 = C_SM the lever is exactly 0 while Scheil is strictly positive,
//        which is the whole physical point: Scheil says a real fraction freezes
//        as eutectic even at the solubility limit, and this solver grows none.
//      - at c0 = C_inv both are exactly 1.
//    Pb-Sn (61.9 wt% Sn, 183 C, 18.3 wt% max solubility) drives all four on a
//    system this app does not ship, as GATE-LOCAL data — a row for it in
//    phasedata.ts would break PD-ROW-SOURCED's bijection, since Pb is not a base.
block("PD-INVARIANT-BAND", () => {
  const lever = (c, Csm, Cinv) => (c - Csm) / (Cinv - Csm);
  const scheil = (c, Csm, Cinv) => Math.pow(Cinv / c, 1 / (Csm / Cinv - 1));
  const bad = [], rows = [];

  // ---- the gate's own arithmetic, on Pb-Sn
  const PBSN = { Csm: 18.3, Cinv: 61.9, Tinv: 183 };
  const pb = {
    quarterLever: lever(PBSN.Csm + 0.25 * (PBSN.Cinv - PBSN.Csm), PBSN.Csm, PBSN.Cinv),
    atCsmLever: lever(PBSN.Csm, PBSN.Csm, PBSN.Cinv),
    atCsmScheil: scheil(PBSN.Csm, PBSN.Csm, PBSN.Cinv),
    atCinvLever: lever(PBSN.Cinv, PBSN.Csm, PBSN.Cinv),
    atCinvScheil: scheil(PBSN.Cinv, PBSN.Csm, PBSN.Cinv),
    // k -> 0 by mass balance: with nothing entering the solid the eutectic
    // share is exactly c0/C_inv. Driven at a vanishing C_SM on the same axis.
    massBalance: scheil(30, 1e-9, PBSN.Cinv), massBalanceWant: 30 / PBSN.Cinv,
    at30: { lever: lever(30, PBSN.Csm, PBSN.Cinv), scheil: scheil(30, PBSN.Csm, PBSN.Cinv) },
  };
  if (Math.abs(pb.quarterLever - 0.25) > 1e-12) bad.push({ anchor: "Pb-Sn quarter lever", got: pb.quarterLever });
  if (pb.atCsmLever !== 0) bad.push({ anchor: "Pb-Sn lever at C_SM is not exactly 0", got: pb.atCsmLever });
  if (!(pb.atCsmScheil > 0 && pb.atCsmScheil < 1)) bad.push({ anchor: "Pb-Sn Scheil at C_SM not in (0,1)", got: pb.atCsmScheil });
  if (Math.abs(pb.atCinvLever - 1) > 1e-12 || Math.abs(pb.atCinvScheil - 1) > 1e-12) bad.push({ anchor: "Pb-Sn endpoints at C_inv", got: [pb.atCinvLever, pb.atCinvScheil] });
  if (Math.abs(pb.massBalance - pb.massBalanceWant) > 1e-6) bad.push({ anchor: "Pb-Sn k->0 mass balance", got: pb.massBalance, want: pb.massBalanceWant });
  if (!(pb.at30.scheil > pb.at30.lever)) bad.push({ anchor: "Pb-Sn Scheil <= lever at 30 wt%", got: pb.at30 });

  // ---- the module's numbers, over every eutectic row it ships
  let eutecticRows = 0, peritecticExclusions = 0, sampled = 0;
  const excl = [], consumedRows = [], scheilOnly = [], unplaceable = [];
  for (const [bk, base] of Object.entries(A.BASES)) {
    for (const el of Object.keys(base.solutes)) {
      const row = PD.BINARY[bk][el];
      if (row.invariant === "isomorphous" || row.Cinv == null || row.Csm == null) continue;
      if (!(row.Csm < row.Cinv)) continue;          // no reachable two-phase band
      const key = `${bk}-${el}`;
      // ni-W is refused whole by phasesFor for the geometry PD-REGIME-EXACT
      // pins; there is no fraction to check on a row this app declines to place
      if (key === "ni-W") { unplaceable.push(key); continue; }
      const k = row.Csm / row.Cinv;

      if (row.invariant !== "eutectic") {
        // PERITECTIC ROWS ARE ASSERTED EXCLUSIONS. A predicate that silently
        // swallowed them would pass a gate that only looked at eutectics.
        const p = A.phasesFor(bk, el, (row.Csm + row.Cinv) / 2);
        peritecticExclusions++;
        const named = p.fraction === null
          && p.source.includes(PD.reactionText(row))
          && p.notGrown != null && p.notGrown.includes(PD.shortPhase(row.second));
        if (!named) bad.push({ key, why: "peritectic did not refuse the fraction by name", source: p.source.slice(0, 120) });
        // AND IT MUST REFUSE FOR THE RIGHT REASON. The first version of this
        // refusal said the lever rule and Gulliver–Scheil "describe a liquid
        // freezing to two solids and neither describes a liquid and a solid
        // reacting to make a third phase". That is false metallurgy on both
        // halves — the lever rule is a tie-line mass balance that knows nothing
        // about reaction type and is exactly how the extent of a peritectic is
        // computed, and Scheil is the standard tool for hypo- and
        // hyper-peritectic steel. Refusing the number is right; that reason was
        // a wrong statement rather than an absent one, and this gate now pins
        // the correct one and BANS the wrong one from coming back.
        const realReason = /freezes below|freeze below/i.test(p.source)
          && /lever arm|difference of two lever/i.test(p.source);
        if (!realReason) bad.push({ key, why: "the peritectic refusal does not give the datum-based reason (the share that freezes AT a peritectic is not the liquid fraction there)", source: p.source.slice(0, 160) });
        if (/neither describes|does not model (a |one)/i.test(p.source)) {
          bad.push({ key, why: "the retired, false explanation is back in the refusal", source: p.source.slice(0, 160) });
        }
        // THE PRIMARY'S FATE, which is the sharpest thing this milestone says.
        // A reactant-peritectic melt RICHER than the reaction's own product
        // ends with none of the phase this solver grows.
        if (row.Csecond != null) {
          const rich = A.phasesFor(bk, el, (row.Csecond + row.Cinv) / 2);
          const lean = A.phasesFor(bk, el, (row.Csm + row.Csecond) / 2);
          if (!rich.consumesPrimary) bad.push({ key, why: `a melt richer than the product ${row.Csecond} wt% does not report the primary consumed` });
          if (rich.equilibrium.includes(`(${A.BASES[bk].symbol})`)) bad.push({ key, why: "a consumed primary is still in the equilibrium set" });
          if (lean.consumesPrimary) bad.push({ key, why: `a melt leaner than the product ${row.Csecond} wt% reports the primary consumed` });
          if (!lean.equilibrium.includes(`(${A.BASES[bk].symbol})`)) bad.push({ key, why: "a retained primary is missing from the equilibrium set" });
          consumedRows.push(key);
        } else if (!/not carry it as a number|does not carry as a number|bracket/i.test(p.source)) {
          bad.push({ key, why: "a row with no product composition does not say so" });
        }
        excl.push(key);
        continue;
      }

      eutecticRows++;
      let minL = 1, maxL = 0, prevL = -1, prevS = -1, monotone = true;
      for (let i = 1; i < 40; i++) {
        const c = row.Csm + ((row.Cinv - row.Csm) * i) / 40;
        const p = A.phasesFor(bk, el, c);
        sampled++;
        if (!p.fraction) { bad.push({ key, why: `no fraction at ${r4(c)} wt%` }); break; }
        const wantL = lever(c, row.Csm, row.Cinv), wantS = scheil(c, row.Csm, row.Cinv);
        if (Math.abs(p.fraction.lever - wantL) > 1e-9) bad.push({ key, why: `lever ${p.fraction.lever} != ${wantL} at ${r4(c)}` });
        if (Math.abs(p.fraction.scheil - wantS) > 1e-9) bad.push({ key, why: `scheil ${p.fraction.scheil} != ${wantS} at ${r4(c)}` });
        // THE ORDERING INVARIANT: no back-diffusion leaves MORE liquid to
        // freeze at the invariant than equilibrium does, everywhere in the band
        if (p.fraction.lever > p.fraction.scheil + 1e-12) bad.push({ key, why: `lever ${r4(p.fraction.lever)} > scheil ${r4(p.fraction.scheil)} at ${r4(c)} wt%` });
        if (!(p.fraction.lever >= 0 && p.fraction.lever <= 1)) bad.push({ key, why: `lever outside [0,1] at ${r4(c)}` });
        if (!(p.fraction.scheil > 0 && p.fraction.scheil <= 1 + 1e-12)) bad.push({ key, why: `scheil outside (0,1] at ${r4(c)}` });
        if (p.fraction.lever < prevL - 1e-12 || p.fraction.scheil < prevS - 1e-12) monotone = false;
        prevL = p.fraction.lever; prevS = p.fraction.scheil;
        minL = Math.min(minL, p.fraction.lever); maxL = Math.max(maxL, p.fraction.lever);
      }
      if (!monotone) bad.push({ key, why: "the invariant share does not rise monotonically with composition" });
      // THE C_SM ENDPOINT, and it is where this gate's own stated principle
      // finally holds in the code. At the equilibrium solubility limit the
      // lever is exactly 0 — nothing is left to freeze at the invariant — while
      // Gulliver–Scheil is strictly positive, because with no back-diffusion
      // the last liquid enriches to the invariant however lean the melt was.
      // The first version of this gate asserted the module returned NO fraction
      // there, which pinned the very gap the milestone plan asked to close:
      // regime I was supposed to be honest that Scheil disagrees with it.
      const atLimit = A.phasesFor(bk, el, row.Csm);
      if (atLimit.regime !== "SINGLE-PHASE") bad.push({ key, why: `the solubility limit itself is ${atLimit.regime}` });
      if (atLimit.fraction) {
        if (atLimit.fraction.lever !== 0) bad.push({ key, why: `lever at C_SM is ${atLimit.fraction.lever}, not exactly 0` });
        if (!(atLimit.fraction.scheil > 0)) bad.push({ key, why: "Scheil at C_SM is not strictly positive" });
        if (Math.abs(atLimit.fraction.scheil - scheil(row.Csm, row.Csm, row.Cinv)) > 1e-9) bad.push({ key, why: "Scheil at C_SM is not the closed form" });
        if (!(atLimit.fraction.scheil >= A.SCHEIL_FLOOR)) bad.push({ key, why: "a fraction was attached below the floor" });
        if (!atLimit.notGrown) bad.push({ key, why: "a non-equilibrium fraction above the floor with no line naming it" });
        scheilOnly.push(key);
      } else if (scheil(row.Csm, row.Csm, row.Cinv) >= A.SCHEIL_FLOOR) {
        bad.push({ key, why: `Scheil at C_SM is ${scheil(row.Csm, row.Csm, row.Cinv)} — above the floor — but no fraction was attached` });
      }
      rows.push({ key, k: r4(k), scheilAtCsm: r4(scheil(row.Csm * (1 + 1e-12), row.Csm, row.Cinv)), leverRange: [r4(minL), r4(maxL)] });
    }
  }

  // ---- liveness on the alloy the milestone was written for
  const a356 = A.derive(A.FAMOUS[0].mix);
  const live = a356.invariantFraction != null
    && a356.invariantFraction.lever > 0 && a356.invariantFraction.lever < 1
    && a356.invariantFraction.scheil > 0 && a356.invariantFraction.scheil < 1
    && a356.invariantFraction.scheil > a356.invariantFraction.lever + 1e-6;

  // Liveness on the two branches this review added: at least one row must
  // report the primary CONSUMED by its own peritectic, and at least one must
  // carry a Scheil fraction on the equilibrium-single-phase side. Without both,
  // the repairs are unexercised code.
  const ok = bad.length === 0 && eutecticRows >= 8 && peritecticExclusions >= 3
    && sampled >= 200 && live && consumedRows.length >= 1 && scheilOnly.length >= 1;
  check("PD-INVARIANT-BAND", ok, {
    eutecticRows, peritecticExclusions, sampled, bad,
    peritecticsExcludedByName: excl,
    rowsWhoseReactionConsumesTheGrownPhase: consumedRows,
    rowsRefusedWholeForImpossibleGeometry: unplaceable,
    rowsCarryingANonEquilibriumFractionAtCsm: scheilOnly.length,
    scheilFloor: A.SCHEIL_FLOOR,
    pbSnAnchor: {
      note: "gate-local test data: Pb is not a base metal in this app and a phasedata.ts row for it would break PD-ROW-SOURCED's bijection",
      quarterLever: r4(pb.quarterLever), leverAtCsm: pb.atCsmLever,
      scheilAtCsm: r4(pb.atCsmScheil), atCinv: [r4(pb.atCinvLever), r4(pb.atCinvScheil)],
      kToZeroGivesMassBalance: [r4(pb.massBalance), r4(pb.massBalanceWant)],
      pb30Sn: { lever: r4(pb.at30.lever), scheil: r4(pb.at30.scheil) },
    },
    a356: a356.invariantFraction ? { lever: r4(a356.invariantFraction.lever), scheil: r4(a356.invariantFraction.scheil) } : null,
    rows,
  });
});

// ---------------------------------------------------------------------------
// 3. ALLOY-PHASES-NAMED — both polarities over the nine shipped presets.
//
//    A preset with a solute past its solubility limit emits exactly one line
//    per such solute, each containing that row's OWN second-phase token; a
//    preset with none emits none. Liveness: at least one preset lands in each
//    of the first two regimes, or the classifier is a constant function.
block("ALLOY-PHASES-NAMED", () => {
  const bad = [], census = [];
  let withLines = 0, withoutLines = 0;
  const allLines = [];

  for (const p of A.FAMOUS) {
    const d = A.derive(p.mix);
    const base = A.BASES[p.mix.base];
    // recomputed from the table, not read back from derive(). TWO kinds of line
    // now, and the second was a plan requirement this milestone missed on its
    // first pass: a solute past the equilibrium solubility limit leaves a phase
    // equilibrium itself predicts, and a solute INSIDE that limit can still
    // leave one that only Gulliver-Scheil predicts.
    const over = Object.entries(p.mix.wt).filter(([el, w]) => {
      const row = PD.BINARY[p.mix.base][el];
      return row && row.invariant !== "isomorphous" && row.Csm != null && w > row.Csm;
    });
    const scheilOnly = Object.entries(p.mix.wt).filter(([el, w]) => {
      const row = PD.BINARY[p.mix.base][el];
      if (!row || row.invariant !== "eutectic" || row.Csm == null || !(w > 0) || w > row.Csm) return false;
      const k = row.Csm / row.Cinv;
      if (!(k > 0 && k < 1)) return false;
      return Math.pow(row.Cinv / w, 1 / (k - 1)) >= A.SCHEIL_FLOOR;
    });
    const why = [];
    if (d.notGrown.length !== over.length + scheilOnly.length) why.push(`${d.notGrown.length} lines for ${over.length} over-solubility + ${scheilOnly.length} Scheil-only solutes`);
    for (const [el] of scheilOnly) {
      const second = PD.shortPhase(PD.BINARY[p.mix.base][el].second);
      if (!d.notGrown.some(n => n.includes(second) && /Scheil/.test(n))) why.push(`no non-equilibrium line names ${el}'s ${second}`);
    }
    for (const [el] of over) {
      const second = PD.shortPhase(PD.BINARY[p.mix.base][el].second);
      if (!d.notGrown.some(n => n.includes(second))) why.push(`no line names ${el}'s second phase "${second}"`);
      if (!d.notGrown.some(n => n.includes(el))) why.push(`no line names ${el} itself`);
    }
    if (new Set(d.notGrown).size !== d.notGrown.length) why.push("two identical lines");
    for (const n of d.notGrown) {
      if (n.length < 60) why.push("a thin notGrown line");
      if (/NaN|undefined|Infinity/.test(n)) why.push("NaN in a notGrown line");
      // the claim that makes it a caveat rather than a caption
      if (!/grow/.test(n)) why.push("a line that does not say the solver does not grow it");
      allLines.push(n);
    }
    // the two columns must agree with the lines: a phase equilibrium predicts
    // and the solver does not grow is exactly a phase in the left column and
    // not in the right
    // The gap is measured against the EQUILIBRIUM lines only: a Scheil-only
    // phase is by definition not one equilibrium predicts, so it must NOT
    // appear in the left column.
    // Compared as a SET of phase names, not as two counts: two solutes in one
    // melt can leave the same second phase, and then one gap entry is correct
    // for two lines. Counting would have failed that mix for being right.
    const gap = d.phasesEquilibrium.filter(x => !d.phasesGrown.includes(x));
    const wantGap = [...new Set(over.map(([el]) => PD.shortPhase(PD.BINARY[p.mix.base][el].second)))];
    if ([...gap].sort().join("|") !== wantGap.sort().join("|")) why.push(`the two columns differ by [${gap}] but the over-solubility solutes leave [${wantGap}]`);
    for (const [el] of scheilOnly) {
      const second = PD.shortPhase(PD.BINARY[p.mix.base][el].second);
      if (d.phasesEquilibrium.includes(second)) why.push(`${second} is a Scheil-only phase and must not be in the equilibrium column`);
    }
    // AND THE CONSUMED CASE: if any solute's reaction eats the base-rich
    // primary, the phase this solver grows must be absent from the left column
    // entirely, whatever the other binaries say about it.
    if (d.phases.some(x => x.consumesPrimary) && d.phasesEquilibrium.includes(`(${base.symbol})`)) {
      why.push("a consumed primary is still listed as a phase equilibrium predicts");
    }
    if (d.totalWt > 0 && d.phasesGrown.length !== 1) why.push(`the solver grows ${d.phasesGrown.length} phases`);
    if (d.totalWt > 0 && d.phasesGrown[0] !== `(${base.symbol})`) why.push("the grown phase is not the base's own");
    if (d.notGrown.length) withLines++; else withoutLines++;
    census.push({ preset: p.label, regime: d.regime, lines: d.notGrown.length, equilibrium: d.phasesEquilibrium, grows: d.phasesGrown });
    if (why.length) bad.push({ preset: p.label, why });
  }

  // LIVENESS, both halves. A classifier that answered SINGLE-PHASE for
  // everything would emit no lines at all and satisfy every per-preset check
  // above; one that answered TWO-PHASE for everything would emit nine.
  const regimes = new Set(A.FAMOUS.map(p => A.derive(p.mix).regime));
  // and the lines are not one sentence repeated: the peritectic presets and the
  // eutectic ones must say measurably different things
  const distinctLines = new Set(allLines).size;
  const hasFraction = allLines.some(n => /%/.test(n));
  const hasRefusal = allLines.some(n => /peritectic/.test(n) && /No fraction is put on it/.test(n));
  const hasConsumed = allLines.some(n => /consumes the .* ENTIRELY|ends as .* and the solver grows/.test(n));
  const hasScheilOnly = allLines.some(n => /Gulliver–Scheil|Gulliver-Scheil/.test(n) && /within the/.test(n));

  const ok = bad.length === 0 && withLines >= 1 && withoutLines >= 1
    && regimes.has("SINGLE-PHASE") && regimes.has("TWO-PHASE-TERMINATION")
    && distinctLines >= 2 && hasFraction && hasRefusal && hasConsumed && hasScheilOnly;
  check("ALLOY-PHASES-NAMED", ok, {
    presetsWithUngrownPhases: withLines, presetsWithout: withoutLines,
    distinctLines, carriesAFraction: hasFraction, carriesAPeritecticRefusal: hasRefusal,
    carriesAConsumedPrimary: hasConsumed, carriesANonEquilibriumOnlyPhase: hasScheilOnly,
    regimesOverPresets: [...regimes], bad, census,
    sample: allLines.slice(0, 2),
  });
});

// ---------------------------------------------------------------------------
// 4. PD-CAP-CEILING — no composition at or past the invariant liquid is
//    reachable by any route, and derive() itself refuses, naming the phase and
//    the number.
//
//    THE POSTCONDITION IS WHAT IS ASSERTED, not the implementation: for any
//    input, the solutes derive() actually USED carry no composition at or past
//    their own ceiling. That formulation fails on the pre-P3 tree, which is the
//    only way to know this gate is not vacuous.
block("PD-CAP-CEILING", () => {
  const bad = [];
  // measured on this tree first, then pinned — five pairs where the hand-picked
  // cap reached past the invariant. The milestone plan had found four; zn-Al is
  // the fifth and the sharpest, because its cap of 5 wt% IS the eutectic.
  const PINNED = {
    "al-Fe": { cap: 2, ceiling: 1.8, max: 1.75 },
    "al-Ti": { cap: 0.5, ceiling: 0.15, max: 0.14 },
    "fe-C": { cap: 2, ceiling: 0.53, max: 0.52 },
    "mg-Zr": { cap: 0.8, ceiling: 0.58, max: 0.57 },
    "zn-Al": { cap: 5, ceiling: 5, max: 4.95 },
  };
  const binding = {};

  for (const [bk, base] of Object.entries(A.BASES)) {
    for (const [el, sol] of Object.entries(base.solutes)) {
      const key = `${bk}-${el}`;
      const row = PD.BINARY[bk][el];
      const why = [];
      const secondName = safe(() => PD.shortPhase(row.second));
      const second = typeof secondName === "string" ? secondName : "";

      // ROUTE 3 FIRST, and deliberately: it is the only clause here that can be
      // stated WITHOUT any export this milestone adds, so it is the one that
      // still means something when this gate is pointed at the pre-P3 tree.
      // THE POSTCONDITION: whatever comes back, the solute is not in the
      // derivation, and the refusal names the phase and the number.
      //
      // ...at the invariant itself and past it. Capped at 100 wt%, because a
      // weight percent cannot exceed one and Al–Zn's invariant is 95: 114 wt%
      // is refused one guard EARLIER, by the mechanism that says it is not a
      // composition at all, and asserting the ceiling's wording there would be
      // demanding the wrong refusal.
      const ceilingRaw = row.invariant === "isomorphous" ? null : row.Cinv;
      for (const w of [ceilingRaw, ceilingRaw == null ? null : Math.min(100, ceilingRaw * 1.2)].filter(x => x != null)) {
        const d = safe(() => A.derive({ base: bk, wt: { [el]: w } }));
        if (!d || d.threw) { why.push(`derive threw at ${w}`); continue; }
        if (Object.keys(d.atPct ?? {}).includes(el)) why.push(`${w} wt% ${el} survived into the derivation`);
        if (d.totalWt !== 0) why.push(`${w} wt% ${el} left totalWt ${d.totalWt}`);
        if (d.phases?.some(p => p.el === el)) why.push(`${w} wt% ${el} survived into the phase list`);
        // WHICH PHASE THE REFUSAL MUST NAME DEPENDS ON WHERE IT FIRED, and
        // asserting one blanket answer was wrong at the boundary. Past the
        // invariant the first solid IS the second phase, so the refusal names
        // it. AT the invariant the melt freezes on the horizontal: a eutectic
        // puts both phases there together, while a peritectic forms the BASE
        // phase and consumes it at once — so demanding the second phase's name
        // there would be demanding a sentence that is not true.
        const atExactly = w === ceilingRaw;
        const mustName = atExactly && row.invariant !== "eutectic"
          ? `(${base.symbol})` : second;
        const named = (d.refusals ?? []).some(x => x.includes(el)
          && x.includes(String(ceilingRaw)) && mustName && x.includes(mustName));
        if (!named) why.push(`the refusal at ${w} wt% does not name the element, the invariant composition and "${mustName}": ${(d.refusals ?? [])[0]?.slice(0, 110)}`);
        // and the wording must match the case rather than being generic
        const refusal = (d.refusals ?? [])[0] ?? "";
        if (atExactly && !/exactly at/.test(refusal)) why.push("the refusal at the invariant itself does not say so");
        if (!atExactly && /exactly at/.test(refusal)) why.push("a refusal past the invariant claims to be at it");
      }

      const b = safe(() => A.soluteBound(bk, el));
      if (!b || b.threw) { bad.push({ key, why: [...why, `soluteBound threw or is missing: ${b?.threw}`] }); continue; }
      if (!b.source || b.source.length < 40) why.push("thin bound source");

      const ceiling = row.invariant === "isomorphous" ? null : row.Cinv;
      if (!Object.is(b.ceiling, ceiling)) why.push(`ceiling ${b.ceiling} is not the row's C_inv ${ceiling}`);

      // ROUTE 1 — the slider cannot reach it, and its max is a real step
      if (ceiling != null && !(b.max < ceiling)) why.push(`slider max ${b.max} reaches the ${ceiling} wt% invariant`);
      if (!(b.max > 0)) why.push(`slider max is ${b.max}`);
      if (b.max > sol.cap) why.push("the derived bound is looser than the hand-picked cap");
      if (b.boundBy === "invariant") {
        binding[key] = { cap: sol.cap, ceiling: b.ceiling, max: b.max };
        if (!(sol.cap >= ceiling)) why.push("marked invariant-bound while the cap is tighter");
      }

      // ROUTE 2 — a share link restores CLAMPED and says so
      if (ceiling != null) {
        const ref = [];
        const mix = A.decodeMix(`alloy=${bk}:${el}${+(ceiling * 1.5).toFixed(3)}`, ref);
        if (!mix || !(mix.wt[el] < ceiling)) why.push(`a link past the invariant restored ${mix?.wt[el]}`);
        if (!ref.some(x => x.includes(el))) why.push("the clamped link said nothing");
      }

      if (why.length) bad.push({ key, why });
    }
  }

  // the pinned regression cases, exactly
  const pinBad = Object.entries(PINNED).filter(([k, v]) =>
    !binding[k] || binding[k].ceiling !== v.ceiling || binding[k].max !== v.max
    || A.BASES[k.split("-")[0]].solutes[k.split("-")[1]].cap !== v.cap);
  const unexpected = Object.keys(binding).filter(k => !(k in PINNED));

  // LIVENESS, and it is the clause that stops a ceiling of zero from passing:
  // all nine shipped presets must still pour, with every solute surviving.
  const presetBad = A.FAMOUS.filter(p => {
    const d = A.derive(p.mix);
    return d.totalWt <= 0 || d.refusals.length > 0
      || Object.keys(d.atPct).length !== Object.keys(p.mix.wt).length;
  }).map(p => p.label);
  // and the two presets that sit closest to a ceiling are named, because they
  // are what a future tightening would break first
  const margins = A.FAMOUS.flatMap(p => Object.entries(p.mix.wt).map(([el, w]) => {
    const row = PD.BINARY[p.mix.base]?.[el];
    const ceiling = row && row.invariant !== "isomorphous" ? row.Cinv : null;
    return ceiling == null ? null : { preset: p.label, el, w, ceiling, marginWt: r4(ceiling - w) };
  })).filter(Boolean).sort((a, b) => a.marginWt - b.marginWt).slice(0, 3);

  const ok = bad.length === 0 && pinBad.length === 0 && unexpected.length === 0
    && presetBad.length === 0 && Object.keys(binding).length === 5;
  check("PD-CAP-CEILING", ok, {
    pairsWhereTheDiagramBinds: binding, pinMismatches: pinBad, unexpectedlyBinding: unexpected,
    allNinePresetsStillPour: presetBad.length === 0, presetsRefused: presetBad,
    tightestMargins: margins, bad,
    castIron: "Fe-C stops at 0.52 wt% C against a 0.53 wt% peritectic — an INTENDED removal, approved: past it the primary phase is austenite and this solver grows one solid, modelled as bcc delta-ferrite",
  });
});

// ---------------------------------------------------------------------------
// 5. ALLOY-SHARE-CLAMP — every pre-arc link still restores to a melt.
//
//    The non-negotiable of this arc. A whole-link rejection would have been the
//    simpler policy and it would have broken every deep link ever minted with a
//    composition this milestone tightened, so instead: restore, clamp to the
//    ceiling, and push a named entry into the channel P1 built.
block("ALLOY-SHARE-CLAMP", () => {
  const bad = [];
  // the corpus: exactly what encodeMix mints for the nine presets, plus the
  // landing page's own literal link at index.html:485
  const corpus = A.FAMOUS.map(p => ({ label: p.label, hash: A.encodeMix(p.mix), mix: p.mix }));
  corpus.push({ label: "index.html:485", hash: "alloy=al:Si7,Mg0.35,Ti0.12", mix: { base: "al", wt: { Si: 7, Mg: 0.35, Ti: 0.12 } } });

  for (const c of corpus) {
    const ref = [];
    const back = A.decodeMix(c.hash, ref);
    if (!back) { bad.push({ link: c.hash, why: "did not restore at all" }); continue; }
    if (ref.length) bad.push({ link: c.hash, why: `restored with ${ref.length} refusals: ${ref[0].slice(0, 70)}` });
    for (const [el, w] of Object.entries(c.mix.wt)) {
      if (!Object.is(back.wt[el], w)) bad.push({ link: c.hash, why: `${el} restored as ${back.wt[el]}, not ${w}` });
    }
    if (Object.keys(back.wt).length !== Object.keys(c.mix.wt).length) bad.push({ link: c.hash, why: "solute count changed" });
    // and it re-mints to the same payload, so a round trip is stable
    if (A.encodeMix(back) !== `alloy=${c.mix.base}:${Object.entries(c.mix.wt).map(([e, w]) => `${e}${+w.toFixed(3)}`).join(",")}`) {
      bad.push({ link: c.hash, why: `re-encoded as ${A.encodeMix(back)}` });
    }
    const d = A.derive(back);
    if (!(d.totalWt > 0) || d.refusals.length) bad.push({ link: c.hash, why: "restored to a mix derive() will not pour" });
  }

  // ---- over-ceiling links: restored, CLAMPED, and named
  const clamped = [];
  for (const [hash, el, ceiling] of [
    ["alloy=fe:C1.5", "C", 0.53], ["alloy=al:Ti0.5", "Ti", 0.15],
    ["alloy=mg:Zr0.8", "Zr", 0.58], ["alloy=al:Fe2", "Fe", 1.8],
    ["alloy=zn:Al5", "Al", 5],
  ]) {
    const ref = [];
    const back = A.decodeMix(hash, ref);
    const w = back?.wt[el];
    const named = ref.some(x => x.includes(String(ceiling)) && x.includes("invariant"));
    const pours = back ? (() => { const d = A.derive(back); return d.totalWt > 0 && d.refusals.length === 0; })() : false;
    clamped.push({ hash, restoredAt: w, named, pours });
    if (!(w > 0 && w < ceiling)) bad.push({ link: hash, why: `restored at ${w} against a ${ceiling} wt% ceiling` });
    if (!named) bad.push({ link: hash, why: "clamped silently" });
    if (!pours) bad.push({ link: hash, why: "clamped to something derive() still refuses" });
  }

  // ---- THE STRUCTURED CLAMP SIGNAL, which main.ts's own repair depends on.
  //
  // A pre-P3 `#set=` link restores its mix through decodeMix AND its solver
  // params through `Object.assign(sim.params, shared.p)` — so a link minted
  // from a 3 wt% carbon melt showed 0.52 wt% in every readout and handed the
  // kernel the cast iron anyway. main.ts now re-derives the chemistry, but ONLY
  // when the decoder actually clamped, and it learns that from this list rather
  // than by matching on a sentence. If the list silently stopped being
  // populated, the condition would never fire and the hole would reopen with
  // every string in the app still reading correctly.
  const clampSignal = [];
  for (const [hash, el, shouldClamp] of [
    ["alloy=fe:C1.5", "C", true], ["alloy=al:Ti0.5", "Ti", true],
    ["alloy=fe:C0.45", "C", false], ["alloy=al:Si7,Mg0.35", "Si", false],
  ]) {
    const ref = [], cl = [];
    A.decodeMix(hash, ref, cl);
    clampSignal.push({ hash, clamped: cl });
    if (cl.includes(el) !== shouldClamp) bad.push({ link: hash, why: `clamped list ${JSON.stringify(cl)} disagrees with the clamp` });
    // the two channels must agree: a clamp reports BOTH a sentence and a name
    if (shouldClamp && !ref.length) bad.push({ link: hash, why: "clamped structurally but said nothing" });
    if (!shouldClamp && cl.length) bad.push({ link: hash, why: "reported a clamp that did not happen" });
  }

  // ---- malformed terms are rejected WHOLE and named, never silently reduced
  const malformed = [];
  for (const [hash, token, mustNotHave] of [
    ["alloy=al:Si1.2.3", "Si1.2.3", "Si"],
    ["alloy=al:Cu.", "Cu.", "Cu"],
    ["alloy=al:Si7,Qq3", "Qq", "Qq"],
    ["alloy=al:Si7,notanelement", "notanelement", null],
    ["alloy=al:Si-3", "Si-3", "Si"],
  ]) {
    const ref = [];
    const back = A.decodeMix(hash, ref);
    const named = ref.some(x => x.includes(token));
    const leaked = mustNotHave ? Object.hasOwn(back?.wt ?? {}, mustNotHave) : false;
    malformed.push({ hash, named, leaked, restored: back?.wt });
    if (!named) bad.push({ link: hash, why: `the malformed term "${token}" was not named` });
    if (leaked) bad.push({ link: hash, why: `"${token}" was silently reduced to ${back.wt[mustNotHave]}` });
  }
  // the rest of a link with one bad term still restores — dropping the term is
  // not the same as dropping the link
  const partial = (() => { const ref = []; const m = A.decodeMix("alloy=al:Si7,Qq3", ref); return m?.wt.Si === 7; })();
  // ...and an unknown base is the one case that IS rejected whole
  const wholeReject = (() => { const ref = []; return A.decodeMix("alloy=zz:Si7", ref) === null && ref.length === 1; })();

  const ok = bad.length === 0 && corpus.length === 10 && partial && wholeReject;
  check("ALLOY-SHARE-CLAMP", ok, {
    preArcLinksRestored: `${corpus.length - bad.filter(b => corpus.some(c => c.hash === b.link)).length}/${corpus.length}`,
    clamped, malformed, restOfLinkStillRestores: partial, unknownBaseRejectedWhole: wholeReject,
    structuredClampSignal: clampSignal,
    bad,
    note: "Si1.2.3 is the case v7.1 P1 named and did not close: parseFloat('1.2.3') is 1.2, so the finite-check passed and the link silently restored 1.2 wt% Si",
  });
});

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all regime/ceiling checks passed");
if (failures) process.exitCode = 1;
