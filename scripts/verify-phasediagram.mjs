// PD-FIGURE-* — the drawn phase diagram, checked without a browser.
//
// `src/phasediagram.ts` splits deliberately: `layout()` returns vertices in
// DATA space (wt%, °C) and knows nothing about pixels, so everything below is
// an assertion about the DRAWING rather than about the DOM. The renderer is
// then only `toPx`, which is exported for exactly one reason — a transform
// exercised solely by the renderer is a transform no gate can see, so the pour
// marker is round-tripped through it and back.
//
// Explicitly NOT "the SVG contains more than N paths". Every check below ties a
// drawn vertex to the phasedata.ts row it was built from, with Object.is.
//
//   node scripts/verify-phasediagram.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const A = await server.ssrLoadModule("/src/alloy.ts");
const PD = await server.ssrLoadModule("/src/phasedata.ts");
const M = await server.ssrLoadModule("/src/materials.ts");
const F = await server.ssrLoadModule("/src/phasediagram.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const K2C = 273.15;
const r3 = x => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));

// ---------------------------------------------------------------------------
// 1. PD-FIGURE-GEOMETRY — the drawn geometry IS the row.
{
  const bad = [];
  let invariantRows = 0, isoRows = 0, refusedRows = 0;

  for (const [bk, base] of Object.entries(A.BASES)) {
    const si = M.MATERIALS[base.materialKey].si;
    const TmC = si.Tm - K2C;
    for (const [el, sol] of Object.entries(base.solutes)) {
      const row = PD.BINARY[bk][el];
      const key = `${bk}-${el}`;
      // a composition inside the drawable range for this pair
      const c = Math.max(1e-3, Math.min(sol.cap, (row.Cinv ?? sol.cap) * 0.5));
      const fig = F.layout({ base: bk, wt: { [el]: c } }, null);
      if (!fig.ok) { refusedRows++; continue; }

      const line = id => fig.polylines.find(l => l.id === id);
      const liq = line("liquidus"), sld = line("solidus");
      const inv = line("invariant"), svs = line("solvus");
      const why = [];

      // both chords START at the pure base's melting point, exactly
      for (const [nm, L] of [["liquidus", liq], ["solidus", sld]]) {
        if (!L) { why.push(`${nm} missing`); continue; }
        if (!Object.is(L.pts[0].c, 0) || !Object.is(L.pts[0].T, TmC)) why.push(`${nm} origin`);
      }

      if (row.invariant === "isomorphous") {
        isoRows++;
        // no invariant to terminate on, so no horizontal and no solvus — and
        // the ABSENCE is asserted, not merely unchecked
        if (inv || svs) why.push("isomorphous drew an invariant or a solvus");
        if (fig.kind !== "ISOMORPHOUS") why.push("kind");
        // THE SAME ORDERING THE INVARIANT BRANCH CHECKS, and its absence here
        // was a hole a real bug walked through: the isomorphous solidus clamped
        // k to 0.999, so Cu–Ni's k = 1.35 drew a solidus 0.04 K ABOVE its own
        // liquidus — the geometry this file refuses ni-W over — and this gate
        // said OK because it only sampled the invariant branch.
        if (liq && sld) {
          for (let i = 0; i <= 40; i++) {
            const cc = (fig.xMax * i) / 40;
            const L = liq.pts[0].T + ((liq.pts[1].T - liq.pts[0].T) / liq.pts[1].c) * cc;
            const S = sld.pts[0].T + ((sld.pts[1].T - sld.pts[0].T) / sld.pts[1].c) * cc;
            if (S > L + 1e-9) { why.push(`solidus above liquidus at ${cc.toFixed(4)} wt% (isomorphous)`); break; }
          }
          // and it must be a real two-phase lens, not two coincident lines
          const gap = Math.abs(sld.pts[1].T - liq.pts[1].T);
          if (!(gap > 1e-6)) why.push("isomorphous chords are coincident — no two-phase field at all");
        }
      } else {
        invariantRows++;
        // ...and END exactly on the row's own invariant
        if (liq && (!Object.is(liq.pts[1].c, row.Cinv) || !Object.is(liq.pts[1].T, row.Tinv))) why.push("liquidus endpoint != (Cinv, Tinv)");
        if (sld && (!Object.is(sld.pts[1].c, row.Csm) || !Object.is(sld.pts[1].T, row.Tinv))) why.push("solidus endpoint != (Csm, Tinv)");
        if (!inv) why.push("no invariant horizontal");
        else if (!Object.is(inv.pts[0].T, row.Tinv) || !Object.is(inv.pts[1].T, row.Tinv)) why.push("invariant is not horizontal at Tinv");
        else if (!Object.is(Math.min(inv.pts[0].c, inv.pts[1].c), Math.min(row.Csm, row.Cinv))
              || !Object.is(Math.max(inv.pts[0].c, inv.pts[1].c), Math.max(row.Csm, row.Cinv))) why.push("invariant does not span Csm..Cinv");
        if (!svs) why.push("no solvus");
        else if (!Object.is(svs.pts[0].c, row.Csm) || !Object.is(svs.pts[1].c, row.Csm)) why.push("solvus is not vertical at Csm");

        // the solidus lies at or below the liquidus everywhere both exist
        if (liq && sld) {
          const hi = Math.min(row.Cinv, row.Csm);
          for (let i = 0; i <= 40; i++) {
            const cc = (hi * i) / 40;
            const L = TmC + ((row.Tinv - TmC) / row.Cinv) * cc;
            const S = TmC + ((row.Tinv - TmC) / row.Csm) * cc;
            if (S > L + 1e-9) { why.push(`solidus above liquidus at ${cc.toFixed(4)} wt%`); break; }
          }
        }
        if (fig.polylines.length < 4) why.push(`only ${fig.polylines.length} polylines`);
      }

      // liveness: nothing drawn may be non-finite, and something must be drawn
      if (!fig.polylines.every(l => l.pts.length >= 2
        && l.pts.every(p => Number.isFinite(p.c) && Number.isFinite(p.T)))) why.push("non-finite vertex");
      if (fig.fields.length < 1) why.push("no phase-field label at all");
      if (!(fig.xMax > 0) || !(fig.yMax > fig.yMin)) why.push("degenerate frame");
      // THE FRAME MUST BE TIGHT AROUND WHAT IT DRAWS. A non-degenerate frame is
      // not enough: the first version sized the box on the chords' value at the
      // axis edge, which extrapolates the solidus far past C_SM and put A356's
      // y-axis at −96 °C with the whole diagram crushed into the top third.
      // Everything drawn must occupy most of the box, and no drawn vertex may
      // fall outside it.
      const span = fig.yMax - fig.yMin;
      const Ts = fig.polylines.flatMap(l => l.pts.map(pt => pt.T))
        .concat(fig.markers.map(m => m.T));
      const used = Math.max(...Ts) - Math.min(...Ts);
      if (used / span < 0.60) why.push(`content fills only ${(100 * used / span).toFixed(0)} % of the frame height`);
      if (Math.min(...Ts) < fig.yMin - 1e-9 || Math.max(...Ts) > fig.yMax + 1e-9) why.push("a drawn vertex is outside the frame");
      const Cs = fig.polylines.flatMap(l => l.pts.map(pt => pt.c)).concat(fig.markers.map(m => m.c));
      if (Math.max(...Cs) > fig.xMax + 1e-9 || Math.min(...Cs) < -1e-9) why.push("a drawn vertex is outside the composition axis");

      if (why.length) bad.push({ key, why });
    }
  }

  // ---- the pour marker: its ordinate is the MIX's liquidus, and it survives
  //      the px transform. The round-trip is what makes the renderer checkable.
  const markerBad = [];
  for (const p of A.FAMOUS) {
    const fig = F.layout(p.mix, null);
    if (!fig.ok) { markerBad.push({ preset: p.label, why: "refused" }); continue; }
    const d = A.derive(p.mix);
    const si = M.MATERIALS[A.BASES[p.mix.base].materialKey].si;
    const TLmix = si.Tm - K2C + d.dTL;
    const m = fig.markers.find(x => x.id === "pour");
    if (!m) { markerBad.push({ preset: p.label, why: "no pour marker" }); continue; }
    if (Math.abs(m.T - TLmix) > 1e-9) markerBad.push({ preset: p.label, why: `ordinate ${m.T} != derive()'s liquidus ${TLmix}` });
    if (Math.abs(m.c - p.mix.wt[d.dominant]) > 1e-12) markerBad.push({ preset: p.label, why: "abscissa is not the dominant solute's wt%" });
    const px = F.toPx(fig, { c: m.c, T: m.T });
    const back = F.fromPx(fig, px.x, px.y);
    if (Math.abs(back.c - m.c) > 1e-9 || Math.abs(back.T - m.T) > 1e-9) {
      markerBad.push({ preset: p.label, why: `px round-trip drifted: ${back.c} / ${back.T}` });
    }
    if (!(px.x >= F.FRAME.ml - 1e-9 && px.x <= F.FRAME.w - F.FRAME.mr + 1e-9
       && px.y >= F.FRAME.mt - 1e-9 && px.y <= F.FRAME.h - F.FRAME.mb + 1e-9)) {
      markerBad.push({ preset: p.label, why: `marker falls outside the frame at ${px.x.toFixed(1)},${px.y.toFixed(1)}` });
    }
  }

  // ---- the residual runs from the line that is DRAWN to the marker, and it
  //      decomposes into two causes that are different facts. Asserting only
  //      "drawn iff multi-solute" was the wrong claim and hid a real defect:
  //      tin bronze is single-solute, so that test said "absent" and passed,
  //      while its marker floated 30.8 K above the orange line because Cu–Sn's
  //      dilute slope and its invariant chord disagree by a factor of 1.5.
  const resid = A.FAMOUS.map(p => {
    const fig = F.layout(p.mix, null);
    if (!fig.ok) return null;
    const d = A.derive(p.mix);
    const base = A.BASES[p.mix.base];
    const row = PD.BINARY[p.mix.base][d.dominant];
    const TmC = M.MATERIALS[base.materialKey].si.Tm - K2C;
    const cDom = p.mix.wt[d.dominant];
    const TLmix = TmC + d.dTL;
    const TLbin = TmC + base.solutes[d.dominant].m * cDom;
    const TLdrawn = row.invariant === "isomorphous"
      ? TLbin : TmC + ((row.Tinv - TmC) / row.Cinv) * cDom;
    const line = fig.polylines.find(l => l.id === "residual");
    const n = Object.keys(p.mix.wt).filter(el => p.mix.wt[el] > 0).length;
    return {
      preset: p.label, solutes: n, drawn: !!line,
      startsOnDrawnLiquidus: line ? Math.abs(line.pts[0].T - TLdrawn) < 1e-9 : null,
      endsOnMarker: line ? Math.abs(line.pts[1].T - TLmix) < 1e-9 : null,
      fromOthers: r3(TLbin - TLmix), fromChord: r3(TLdrawn - TLbin),
      total: r3(TLdrawn - TLmix),
    };
  }).filter(Boolean);
  const residBad = resid.filter(r =>
    (Math.abs(r.total) > 1e-9) !== r.drawn
    || (r.drawn && !(r.startsOnDrawnLiquidus && r.endsOnMarker))
    || (r.drawn && Math.abs(r.fromOthers + r.fromChord - r.total) > 2e-3));
  // BOTH CAUSES exercised by shipped presets: one dominated by the other
  // solutes, one dominated by the chord-vs-dilute disagreement
  const othersDominant = resid.filter(r => Math.abs(r.fromOthers) > Math.abs(r.fromChord) * 2).map(r => r.preset);
  const chordDominant = resid.filter(r => Math.abs(r.fromChord) > Math.abs(r.fromOthers) * 2).map(r => r.preset);

  // ---- BOTH clamp branches exercised by shipped presets, or the second line
  //      could never be drawn and this gate would not notice
  const withSolver = A.FAMOUS.filter(p => {
    const f = F.layout(p.mix, null);
    return f.ok && f.polylines.some(l => l.id === "solver");
  }).map(p => p.label);
  const withoutSolver = A.FAMOUS.filter(p => {
    const f = F.layout(p.mix, null);
    return f.ok && !f.polylines.some(l => l.id === "solver");
  }).map(p => p.label);

  const ok = bad.length === 0 && markerBad.length === 0 && residBad.length === 0
    && withSolver.length >= 1 && withoutSolver.length >= 1
    && invariantRows >= 15 && isoRows >= 1
    && othersDominant.length >= 1 && chordDominant.length >= 1;
  check("PD-FIGURE-GEOMETRY", ok, {
    invariantRows, isoRows, refusedRows, bad, markerBad,
    residual: resid, residBad, othersDominant, chordDominant,
    solverLineDrawnFor: withSolver, solverLineAbsentFor: withoutSolver,
  });
}

// ---------------------------------------------------------------------------
// 2. PD-NO-ROW-REFUSES — everything that cannot be drawn says why, by name, and
//    NO empty axis frame is ever emitted in its place.
{
  const cases = [];
  // materials with no alloy base at all
  for (const k of Object.keys(M.MATERIALS)) {
    const r = F.diagramForMaterial(k);
    cases.push({ label: `material ${k}`, ok: r.ok, reason: r.ok ? null : r.reason });
  }
  cases.push({ label: "material nosuch", ...(() => {
    const r = F.diagramForMaterial("nosuchmaterial");
    return { ok: r.ok, reason: r.ok ? null : r.reason };
  })() });
  // mixes that cannot be drawn
  for (const [label, mix] of [
    ["pure base", { base: "al", wt: {} }],
    ["unknown base", { base: "unobtanium", wt: { Cu: 1 } }],
    ["inherited base key", { base: "constructor", wt: { Cu: 1 } }],
    ["zero weights", { base: "fe", wt: { C: 0 } }],
    ["geometrically impossible row", { base: "ni", wt: { W: 2 } }],
  ]) {
    const r = F.layout(mix, null);
    cases.push({ label, ok: r.ok, reason: r.ok ? null : r.reason });
  }

  const refused = cases.filter(c => !c.ok);
  const drawn = cases.filter(c => c.ok);
  const thin = refused.filter(c => !c.reason || c.reason.length < 40).map(c => c.label);
  const distinct = new Set(refused.map(c => c.reason)).size;
  // a refusal that names the wrong mechanism is a wrong statement, not an
  // absent one — so the ni-W refusal must name the geometry, not "no row"
  const niW = cases.find(c => c.label === "geometrically impossible row");
  const niWNamed = !niW.ok && /cannot be drawn/.test(niW.reason)
    && /C_SM/.test(niW.reason) && /C_inv/.test(niW.reason);
  // BOTH polarities: a layout() that refused everything cannot pass
  const ok = thin.length === 0 && refused.length >= 6 && drawn.length >= 5
    && distinct >= 5 && niWNamed;
  check("PD-NO-ROW-REFUSES", ok, {
    refused: refused.length, drawn: drawn.length, distinctReasons: distinct,
    thin, niWNamed,
    reasons: refused.map(c => `${c.label}: ${c.reason.slice(0, 80)}`),
  });
}

// ---------------------------------------------------------------------------
// 3. PD-FIGURE-CURSOR — the cursor's three absences, browser-free.
//
//    The live half is PD-CURSOR-LIVE in verify-quant.mjs; this is the part that
//    can be settled without a GPU: a temperature ON the diagram is drawn, one
//    OFF it is not drawn AND is named, and null is silent.
{
  const mix = A.FAMOUS[0].mix;               // A356
  const base = F.layout(mix, null);
  if (!base.ok) { check("PD-FIGURE-CURSOR", false, { why: "A356 refused" }); }
  else {
    const mid = (base.yMin + base.yMax) / 2;
    const on = F.layout(mix, mid);
    const below = F.layout(mix, base.yMin - 50);
    const above = F.layout(mix, base.yMax + 50);
    const none = F.layout(mix, null);
    const nan = F.layout(mix, NaN);
    const cur = f => f.ok ? f.markers.find(m => m.id === "cursor") : null;
    const named = f => f.ok && f.notes.some(n => /off this diagram/.test(n));

    // THE WRONG-METAL CASE. The composer's staged mix and the material actually
    // in the crucible disagree after a single click — press the AZ91 preset
    // while aluminium is loaded and the figure is asked to draw Mg–Al while the
    // thermometer reports the aluminium melt. 600 °C sits inside the Mg–Al
    // frame of 416–671 °C, so the cursor drew, labelled "melt 600 °C", on a
    // magnesium diagram. A wrong statement, not a missing one.
    const az91 = { base: "mg", wt: { Al: 9, Zn: 0.7 } };
    const wrongMetal = F.layout(az91, 600, "al");
    const rightMetal = F.layout(az91, 600, "mg");
    const noKey = F.layout(az91, 600);
    const crucible = f => f.ok && f.notes.some(n => /in the crucible is/.test(n));
    const ok =
      !!cur(on) && Math.abs(cur(on).T - mid) < 1e-9
      && !cur(below) && named(below)
      && !cur(above) && named(above)
      && !cur(none) && !named(none)
      && !cur(nan) && !named(nan)
      // withheld AND named when the metals disagree; drawn when they agree;
      // and the check is skipped entirely when no key is supplied, which is
      // what the geometry-only callers above rely on
      && !cur(wrongMetal) && crucible(wrongMetal)
      && !!cur(rightMetal) && !crucible(rightMetal)
      && !!cur(noKey) && !crucible(noKey);
    check("PD-FIGURE-CURSOR", ok, {
      frame: [r3(base.yMin), r3(base.yMax)],
      onDiagram: !!cur(on), belowDrawn: !!cur(below), belowNamed: named(below),
      aboveDrawn: !!cur(above), aboveNamed: named(above),
      nullDrawn: !!cur(none), nullNamed: named(none),
      nanDrawn: !!cur(nan),
      wrongMetal: { drawn: !!cur(wrongMetal), named: crucible(wrongMetal) },
      rightMetal: { drawn: !!cur(rightMetal) },
      noMaterialKey: { drawn: !!cur(noKey) },
      note: "null is SILENT, off-scale is NAMED — a fully-solid casting has no melt temperature and that is not the same fact as one that fell off the axis",
    });
  }
}


// ---------------------------------------------------------------------------
// 4. PD-CHAPTER-PURE (v7.1 P6) — the claim the new tour chapter makes, gated
//    where it can be gated.
//
// The chapter ("The line you can cross") opens the composer and tells the reader
// to drag SI across 1.65 wt%. It cannot step the reader THROUGH the composer —
// the modal owns the screen and turning it into a dock is not in this arc — so
// what the tour asserts has to be true of the pure layer, and this is where that
// is settled: crossing C_SM changes the regime, moves BOTH vertices of the
// shaded band, and changes what the app says it will not grow.
//
// BOTH POLARITIES, ON TWO PAIRS, BECAUSE ONE PAIR CANNOT SHOW BOTH.
//
// The plan for this milestone said the crossing "flips notGrown from absent to
// present". Measured, that is FALSE for Al–Si: at 1.60 wt% Si notGrown already
// carries a line, because Gulliver–Scheil puts 9.3 % of a lean charge through
// the eutectic even though equilibrium leaves it single-phase, and a dendritic
// solidifier that called that single-phase would be hiding the as-cast
// structure. What actually flips at 1.65 is the KIND of line — a Scheil-only
// caveat below, an equilibrium second phase above — and that is the stronger
// claim, because a presence check passes on a line that was always there.
//
// Fe–C is where the absent-to-present polarity is real: at 0.09 wt% C notGrown
// is empty and at 0.10 wt% it is not, so both shapes are asserted rather than
// one being assumed of the other.
{
  const T = await server.ssrLoadModule("/src/tour.ts");
  const why = [];

  const at = (base, el, w) => {
    const mix = { base, wt: { [el]: w } };
    const d = A.derive(mix);
    const f = F.layout(mix, null);
    return { d, f, p: d.phases[0], band: f.ok ? f.band : null, nG: d.notGrown };
  };

  // ---- Al–Si, the pair the chapter is written about
  const row = PD.BINARY.al.Si;
  const lean = at("al", "Si", row.Csm - 0.05);
  const rich = at("al", "Si", row.Csm + 0.05);

  if (lean.p.regime !== "SINGLE-PHASE") why.push(`al-Si below C_SM reads ${lean.p.regime}`);
  if (rich.p.regime !== "TWO-PHASE-TERMINATION") why.push(`al-Si above C_SM reads ${rich.p.regime}`);
  // both vertices move, and they move to the row's own numbers
  if (!(lean.band && lean.band.c0 === 0 && lean.band.c1 === row.Csm))
    why.push(`lean band is ${JSON.stringify(lean.band)}, not [0, ${row.Csm}]`);
  if (!(rich.band && rich.band.c0 === row.Csm && rich.band.c1 === row.Cinv))
    why.push(`rich band is ${JSON.stringify(rich.band)}, not [${row.Csm}, ${row.Cinv}]`);
  if (lean.band && rich.band && lean.band.c1 === rich.band.c1)
    why.push("the band's right edge did not move across C_SM");
  // the label the shading carries is the phase list, and only the rich side
  // names the second phase
  const second = PD.shortPhase(row.second);
  if (lean.band && lean.band.label.includes(second)) why.push("the lean band names the second phase");
  if (rich.band && !rich.band.label.includes(second)) why.push("the rich band does not name the second phase");
  // the KIND of caveat flips, and both sides still name the eutectic they are
  // about — that is the sentence the chapter's "watch" line describes
  const leanLine = lean.nG.join(" ");
  const richLine = rich.nG.join(" ");
  if (!/that dissolves/.test(leanLine) || !/Scheil/.test(leanLine))
    why.push("the lean side's caveat is not the Scheil-only one");
  if (!/second phase equilibrium leaves/.test(richLine))
    why.push("the rich side's caveat does not name an equilibrium second phase");
  if (/second phase equilibrium leaves/.test(leanLine))
    why.push("the lean side claims an equilibrium second phase");
  for (const [side, line] of [["lean", leanLine], ["rich", richLine]]) {
    if (!line.includes(String(row.Tinv))) why.push(`the ${side} caveat does not name the ${row.Tinv} °C invariant`);
    if (!line.includes(second)) why.push(`the ${side} caveat does not name ${second}`);
  }

  // ---- Fe–C, where notGrown really is absent below the limit
  const fRow = PD.BINARY.fe.C;
  const fLean = at("fe", "C", fRow.Csm);
  const fRich = at("fe", "C", fRow.Csm + 0.01);
  if (fLean.nG.length !== 0) why.push(`fe-C at C_SM already carries ${fLean.nG.length} ungrown-phase lines`);
  if (fRich.nG.length !== 1) why.push(`fe-C just past C_SM carries ${fRich.nG.length} lines, not one`);
  if (fLean.p.regime !== "SINGLE-PHASE" || fRich.p.regime !== "TWO-PHASE-TERMINATION")
    why.push(`fe-C regimes read ${fLean.p.regime} / ${fRich.p.regime}`);
  if (!(fLean.band && fRich.band && fLean.band.c1 === fRow.Csm && fRich.band.c0 === fRow.Csm))
    why.push("the fe-C band does not hinge on C_SM");

  // ---- "about half the casting", at the pour the chapter names. The lever rule
  //      here gives the share of LIQUID left at the invariant, which freezes as
  //      the eutectic CONSTITUENT — (Al) and (Si) together — and not as silicon.
  //      The chapter's first draft said "the silicon ... about half the casting",
  //      which reads as a silicon fraction and is wrong by roughly the eutectic's
  //      own aluminium content; the sentence now names the constituent and this
  //      check is the number it is allowed to describe.
  const a356 = at("al", "Si", 7);
  const lever = a356.p.fraction?.lever;
  if (!(typeof lever === "number" && lever > 0.4 && lever < 0.6))
    why.push(`the eutectic share at 7 wt% Si is ${lever}, which "about half" does not describe`);

  // ---- and the chapter itself: it exists, it opens the composer, and the two
  //      numbers its prose turns on are the row's. A chapter that quietly lost
  //      its apply() would leave the whole gate above testing nothing anyone reads.
  const ch = T.CHAPTERS.find(c => c.title === "The line you can cross");
  if (!ch) why.push("no chapter titled \"The line you can cross\"");
  else {
    if (!/openComposer/.test(String(ch.apply))) why.push("the chapter does not open the composer");
    const prose = `${ch.body} ${ch.watch}`;
    if (!prose.includes(String(row.Csm))) why.push(`the chapter's prose does not name C_SM ${row.Csm}`);
    if (!prose.includes(String(row.Tinv))) why.push(`the chapter's prose does not name the ${row.Tinv} °C invariant`);
    if (!prose.includes(second)) why.push(`the chapter's prose does not name ${second}`);
    // and it must attribute the lever-rule half to the CONSTITUENT, not to the
    // silicon: the first draft read "the silicon ... about half the casting",
    // which is the eutectic's own aluminium counted as silicon
    if (!/eutectic constituent/.test(prose))
      why.push("the chapter's prose does not say the half is the eutectic constituent rather than the silicon");
  }

  check("PD-CHAPTER-PURE", why.length === 0, {
    alSi: {
      csm: row.Csm,
      leanBand: lean.band && [lean.band.c0, lean.band.c1],
      richBand: rich.band && [rich.band.c0, rich.band.c1],
      regimes: [lean.p.regime, rich.p.regime],
      caveats: [lean.nG.length, rich.nG.length],
    },
    feC: { csm: fRow.Csm, caveats: [fLean.nG.length, fRich.nG.length] },
    leverAt7: r3(lever),
    chapter: ch ? T.CHAPTERS.indexOf(ch) : null,
    why,
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all phase-diagram checks passed");
if (failures) process.exitCode = 1;
