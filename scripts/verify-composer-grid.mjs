// ALLOY-OPEN-IDENTITY / ALLOY-SHARE-PRE-P5 / GRID-LAYOUT-TOTAL /
// GRID-REASON-LINE / LANDING-CLOSURE-CLEAN — v7.1 P5's periodic grid, without a
// browser.
//
// WHAT THIS MILESTONE CLAIMS, AND THEREFORE WHAT IS CHECKED HERE.
//   1. Opening the composer's element set changed NOTHING about the chemistry.
//      P5 adds no pourable pair — ASSESSED is the same 25 rows P4 measured — so
//      every preset and every legacy pair must derive a bit-identical params
//      bundle and an identical clamps array against a reference measured on the
//      pre-P5 tree. This is the keystone and it is a non-regression gate by
//      construction, which is honest: the new content is 93 elements of
//      computed refusal, not new physics.
//   2. Every link minted before this arc still restores to the same melt, and
//      `encodeMix` still emits the same tuple. A share link is an artefact a
//      user already has; breaking one is not a refactor, it is a broken promise.
//   3. All 118 elements have a place in the drawn table, no two share one, and
//      the drawing agrees with the block column the data already carries.
//   4. Every one of the 708 pairs has a one-line reason that was COMPOSED and
//      not cut from its paragraph, and those lines do not collapse into one
//      template wearing 708 element names.
//   5. The landing page's import closure does not reach the chemistry. 75 KB of
//      element table on the front door's first paint would be a real cost for
//      zero benefit, and the guard is structural rather than a build artefact.
//
//   node scripts/verify-composer-grid.mjs
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const NAMES = ["ALLOY-OPEN-IDENTITY", "ALLOY-SHARE-PRE-P5", "GRID-LAYOUT-TOTAL", "GRID-REASON-LINE", "LANDING-CLOSURE-CLEAN", "GRID-DOC-CLAIMS"];

// The guarded load, for the same reason verify-elements.mjs has one: run
// against a tree where one of these modules does not exist, an unguarded
// `ssrLoadModule` throws before any gate runs and prints a stack trace instead
// of a single gate name — and a gate that cannot report looks exactly like a
// gate nobody ran, which is precisely the tree a non-vacuity proof uses.
let E, A, C, MAT;
try {
  E = await server.ssrLoadModule("/src/elements.ts");
  A = await server.ssrLoadModule("/src/alloy.ts");
  C = await server.ssrLoadModule("/src/composer.ts");
  MAT = await server.ssrLoadModule("/src/materials.ts");
} catch (e) {
  for (const n of NAMES) check(n, false, { threw: String(e).split("\n")[0].slice(0, 160), note: "the modules this gate reads do not load on this tree" });
  await server.close();
  console.log(`done — ${failures} FAILED`);
  process.exitCode = 1;
}

const block = (name, fn) => {
  if (!E || !A || !C || !MAT) return;   // already reported above, once per gate name
  try { fn(); } catch (e) {
    check(name, false, { threw: String(e).slice(0, 160), note: "this gate could not run at all against this tree" });
  }
};

// ---------------------------------------------------------------------------
// 1. ALLOY-OPEN-IDENTITY — the keystone.
//
//    THE REFERENCE BELOW WAS MEASURED ON da16b5f, THE COMMIT BEFORE P5, and it
//    was not measured by trusting that the derive() closure was untouched: a
//    pre-P5 worktree was checked out, the same generator run against both
//    trees, and the two JSON payloads compared byte for byte. That is the
//    difference between "I did not change alloy.ts" and "alloy.ts does not
//    behave differently", and only the second is a gate.
//
//    THREE CLAUSES, AND THE SECOND AND THIRD ARE WHAT MAKE THE FIRST MEAN
//    ANYTHING. Equality is trivially satisfiable — two zeros are equal, an
//    empty case list has no failures, and a comparator that always returns true
//    passes an identity check perfectly. So: every arm is separately proven
//    ALIVE (c0 > 0, kPart inside (0,1), dSol > 0, a name, real solute entries),
//    a deliberately PERTURBED mix is required to produce a DIFFERENT bundle so
//    a broken comparator fails, and at least one refusal is proven to have
//    fired somewhere in the open set — otherwise "nothing was refused" and
//    "the refusal path never ran" are the same passing gate.
{
  const REF = {
    "A356": [1, 0.49, 0.39610039582583667, 0.13749638205499282, 0.8761904761904763, []],
    "A356+TiB": [1, 0.498, 0.3600538071682195, 0.12, 0.8711111111111113, ["Q saturates the model (k floored) — refinement still shows"]],
    "AA2024": [1, 0.39333333333333337, 0.24748866498740554, 0.30033800494641383, 0.8, []],
    "1045 steel": [1, 0.09666666666666666, 0.8, 0.23965580823601718, 1.5, ["strong alloy — model depression capped so growth stays watchable"]],
    "4340 steel": [1, 0.26333333333333336, 0.8, 0.36400089806915126, 0.9660759493670886, ["strong alloy — model depression capped so growth stays watchable"]],
    "IN718 (lite)": [1, 0.6333333333333333, 0.3473684210526316, 0.55343294640652, 0.6560000000000001, ["strong alloy — model depression capped so growth stays watchable"]],
    "AZ91": [1, 0.6466666666666666, 0.3402061855670103, 0.35416289592760175, 0.8, ["strong alloy — model depression capped so growth stays watchable"]],
    "tin bronze": [1, 0.5333333333333333, 0.41250000000000003, 0.16000000000000003, 0.7200000000000001, ["strong alloy — model depression capped so growth stays watchable"]],
    "galv. bath": [1, 0.05, 0.1344, 0.12, 0.8, ["Q saturates the model (k floored) — refinement still shows"]],
    "al-Cu": [1, 0.6666666666666666, 0.20464231738035266, 0.17000000000000004, 0.8, []],
    "al-Si": [1, 0.7, 0.31428571428571433, 0.1200000000000001, 0.8800000000000001, ["composition saturates the model solute field", "strong alloy — model depression capped so growth stays watchable"]],
    "al-Mg": [1, 0.6666666666666666, 0.33, 0.51, 0.8, ["strong alloy — model depression capped so growth stays watchable"]],
    "al-Zn": [1, 0.6666666666666666, 0.1, 0.43999999999999995, 0.8, []],
    "al-Fe": [1, 0.11666666666666667, 0.18056675062972294, 0.12, 0.6400000000000001, ["Q saturates the model (k floored) — refinement still shows"]],
    "al-Ti": [1, 0.05, 0.1, 0.9, 0.5599999999999999, ["liquidus raised (peritectic-dominated) — model runs it as a weak depressant"]],
    "fe-C": [1, 0.05, 0.8, 0.17000000000000004, 1.5, ["strong alloy — model depression capped so growth stays watchable"]],
    "fe-Mn": [1, 0.6666666666666666, 0.33, 0.76, 0.7200000000000001, ["strong alloy — model depression capped so growth stays watchable"]],
    "fe-Si": [1, 0.3333333333333333, 0.66, 0.52, 0.8, ["strong alloy — model depression capped so growth stays watchable"]],
    "fe-Ni": [1, 0.6666666666666666, 0.33, 0.83, 0.7200000000000001, ["strong alloy — model depression capped so growth stays watchable"]],
    "fe-Cr": [1, 0.6666666666666666, 0.1, 0.9, 0.7200000000000001, []],
    "fe-Mo": [1, 0.3333333333333333, 0.23305263157894737, 0.8, 0.6400000000000001, []],
    "ni-Nb": [1, 0.4, 0.5499999999999999, 0.48, 0.6400000000000001, ["strong alloy — model depression capped so growth stays watchable"]],
    "ni-Ti": [1, 0.3333333333333333, 0.66, 0.6000000000000001, 0.7200000000000001, ["strong alloy — model depression capped so growth stays watchable"]],
    "ni-Al": [1, 0.4, 0.31447147651006707, 0.87, 0.8, []],
    "ni-Cr": [1, 0.6666666666666666, 0.1, 0.9, 0.7200000000000001, []],
    "ni-Mo": [1, 0.4, 0.20755117449664426, 0.8, 0.6400000000000001, []],
    "ni-W": [1, 0.4, 0.1, 0.9, 0.5599999999999999, ["liquidus raised (peritectic-dominated) — model runs it as a weak depressant"]],
    "mg-Al": [1, 0.6666666666666666, 0.33, 0.37, 0.8, ["strong alloy — model depression capped so growth stays watchable"]],
    "mg-Zn": [1, 0.4, 0.5260744985673351, 0.12, 0.8, []],
    "mg-Zr": [1, 0.05, 0.1, 0.9, 0.5599999999999999, ["liquidus raised (peritectic-dominated) — model runs it as a weak depressant"]],
    "cu-Sn": [1, 0.6666666666666666, 0.33, 0.16000000000000003, 0.7200000000000001, ["strong alloy — model depression capped so growth stays watchable"]],
    "cu-Zn": [1, 0.7, 0.25722488038277513, 0.86, 0.8, ["composition saturates the model solute field"]],
    "cu-Ni": [1, 0.6666666666666666, 0.1, 0.9, 0.7200000000000001, ["liquidus raised (peritectic-dominated) — model runs it as a weak depressant"]],
    "zn-Al": [1, 0.33, 0.504, 0.12, 0.8, ["Q saturates the model (k floored) — refinement still shows"]],
  };

  block("ALLOY-OPEN-IDENTITY", () => {
    const bundleOf = mix => {
      const d = A.derive(mix);
      const p = d.params;
      return { tuple: [p.alloyOn, p.c0, p.mLiq, p.kPart, p.dSol], clamps: d.clamps, name: d.name, mix };
    };
    const cases = [];
    for (const f of A.FAMOUS) cases.push({ label: f.label, got: bundleOf(f.mix) });
    for (const [bk, b] of Object.entries(A.BASES)) {
      for (const el of Object.keys(b.solutes)) {
        const w = A.soluteBound(bk, el).max;
        cases.push({ label: `${bk}-${el}`, got: bundleOf({ base: bk, wt: { [el]: w } }) });
      }
    }

    const bad = [];
    let alive = 0, refusalsFired = 0;
    for (const c of cases) {
      const ref = REF[c.label];
      if (!ref) { bad.push({ label: c.label, why: "no pre-P5 reference for this case" }); continue; }
      // Object.is, not ===, so a sign-flipped zero is a difference rather than
      // a match. "Byte-identical" is the claim; -0 === 0 would not hold it.
      const refTuple = ref.slice(0, 5);
      for (let i = 0; i < 5; i++) {
        if (!Object.is(c.got.tuple[i], refTuple[i])) {
          bad.push({ label: c.label, why: `${["alloyOn", "c0", "mLiq", "kPart", "dSol"][i]} ${c.got.tuple[i]} vs ${refTuple[i]}` });
        }
      }
      if (JSON.stringify(c.got.clamps) !== JSON.stringify(ref[5])) {
        bad.push({ label: c.label, why: `clamps ${JSON.stringify(c.got.clamps)} vs ${JSON.stringify(ref[5])}` });
      }
      // LIVENESS, per arm. Two zeros are equal; a bundle of zeros would satisfy
      // every comparison above and mean nothing.
      const [, c0, mLiq, kPart, dSol] = c.got.tuple;
      const live = c0 > 0 && mLiq > 0 && kPart > 0 && kPart < 1 && dSol > 0
        && c.got.name.length > 0 && Object.keys(c.got.mix.wt).length > 0;
      if (live) alive++; else bad.push({ label: c.label, why: `arm not alive: ${JSON.stringify(c.got.tuple)} name="${c.got.name}"` });
      if (c.got.clamps.length > 0) refusalsFired++;
    }

    // THE DIFFERENCE HALF, which catches the harness rather than the code. A
    // comparator stuck at "equal" passes every clause above; it cannot pass
    // this one. The perturbation is deliberately small — A356 with its silicon
    // moved by a tenth of a per cent — so it also proves the comparison is
    // sensitive at the precision the reference is written to.
    const control = bundleOf({ base: "al", wt: { Si: 7.1, Mg: 0.35 } });
    const a356 = REF["A356"].slice(0, 5);
    const controlDiffers = control.tuple.some((v, i) => !Object.is(v, a356[i]));

    // ...and one that must NOT differ, driven through the same comparator: the
    // same mix built with its keys in the other order. If the comparator were
    // sensitive to something other than the numbers, this would fail.
    const reordered = bundleOf({ base: "al", wt: { Mg: 0.35, Si: 7 } });
    const reorderMatches = reordered.tuple.every((v, i) => Object.is(v, a356[i]));

    const ok = bad.length === 0 && cases.length === 34 && alive === 34
      && refusalsFired >= 1 && controlDiffers && reorderMatches;
    check("ALLOY-OPEN-IDENTITY", ok, {
      cases: cases.length, bad, armsAlive: alive,
      casesCarryingAClamp: refusalsFired,
      perturbedControlDiffers: controlDiffers,
      reorderedMixStillMatches: reorderMatches,
      reference: "measured on da16b5f (pre-P5) and compared byte-for-byte against this tree",
    });
  });
}

// ---------------------------------------------------------------------------
// 2. ALLOY-SHARE-PRE-P5 — every link minted before this arc still restores to
//    the same melt.
//
//    The corpus includes the LANDING PAGE'S OWN link, `#alloy=al:Si7,Mg0.35,
//    Ti0.12` at index.html:485, which is not a hypothetical share but a URL
//    this site publishes. It also includes the three that CLAMP — a pre-P3
//    link asking for 1.5 wt% carbon — because a clamp is part of the contract
//    now and silently widening it would be as much a break as narrowing it.
{
  const CORPUS = [
    // the landing page's own published link
    { hash: "#alloy=al:Si7,Mg0.35,Ti0.12", base: "al", wt: { Si: 7, Mg: 0.35, Ti: 0.12 }, refusals: 0, clamped: [], re: "alloy=al:Si7,Mg0.35,Ti0.12" },
    { hash: "#alloy=al:Cu4.4,Mg1.5", base: "al", wt: { Cu: 4.4, Mg: 1.5 }, refusals: 0, clamped: [], re: "alloy=al:Cu4.4,Mg1.5" },
    { hash: "#alloy=fe:C0.45,Mn0.75,Si0.25", base: "fe", wt: { C: 0.45, Mn: 0.75, Si: 0.25 }, refusals: 0, clamped: [], re: "alloy=fe:C0.45,Mn0.75,Si0.25" },
    { hash: "#alloy=fe:C0.4,Mn0.7,Ni1.8,Cr0.8,Mo0.25", base: "fe", wt: { C: 0.4, Mn: 0.7, Ni: 1.8, Cr: 0.8, Mo: 0.25 }, refusals: 0, clamped: [], re: "alloy=fe:C0.4,Mn0.7,Ni1.8,Cr0.8,Mo0.25" },
    { hash: "#alloy=ni:Nb5.1,Mo3,Ti0.9,Al0.5", base: "ni", wt: { Nb: 5.1, Mo: 3, Ti: 0.9, Al: 0.5 }, refusals: 0, clamped: [], re: "alloy=ni:Nb5.1,Mo3,Ti0.9,Al0.5" },
    { hash: "#alloy=mg:Al9,Zn0.7", base: "mg", wt: { Al: 9, Zn: 0.7 }, refusals: 0, clamped: [], re: "alloy=mg:Al9,Zn0.7" },
    { hash: "#alloy=cu:Sn8", base: "cu", wt: { Sn: 8 }, refusals: 0, clamped: [], re: "alloy=cu:Sn8" },
    { hash: "#alloy=zn:Al0.2", base: "zn", wt: { Al: 0.2 }, refusals: 0, clamped: [], re: "alloy=zn:Al0.2" },
    { hash: "#alloy=al:Si7,Mg0.35", base: "al", wt: { Si: 7, Mg: 0.35 }, refusals: 0, clamped: [], re: "alloy=al:Si7,Mg0.35" },
    // the three that CLAMP against a v7.1 P3 ceiling — cast iron, the Al–Ti
    // peritectic and the Mg–Zr one
    { hash: "#alloy=fe:C1.5", base: "fe", wt: { C: 0.52 }, refusals: 1, clamped: ["C"], re: "alloy=fe:C0.52" },
    { hash: "#alloy=al:Ti0.5", base: "al", wt: { Ti: 0.14 }, refusals: 1, clamped: ["Ti"], re: "alloy=al:Ti0.14" },
    { hash: "#alloy=mg:Zr0.6", base: "mg", wt: { Zr: 0.57 }, refusals: 1, clamped: ["Zr"], re: "alloy=mg:Zr0.57" },
    // and the malformed ones, whose refusals are part of the contract too
    { hash: "#alloy=al:Xx3,Si7", base: "al", wt: { Si: 7 }, refusals: 1, clamped: [], re: "alloy=al:Si7" },
    { hash: "#alloy=al:", base: "al", wt: {}, refusals: 0, clamped: [], re: "alloy=al:" },
    { hash: "#alloy=xx:Si7", base: null, wt: null, refusals: 1, clamped: [], re: null },
  ];

  block("ALLOY-SHARE-PRE-P5", () => {
    const bad = [];
    let restored = 0, refused = 0;
    for (const c of CORPUS) {
      const refusals = [], clamped = [];
      const mix = A.decodeMix(c.hash, refusals, clamped);
      if (c.base === null) {
        if (mix !== null) bad.push({ hash: c.hash, why: "a link naming an unknown base restored something" });
      } else if (!mix) {
        bad.push({ hash: c.hash, why: "did not restore at all" });
      } else {
        if (mix.base !== c.base) bad.push({ hash: c.hash, why: `base ${mix.base} vs ${c.base}` });
        if (JSON.stringify(mix.wt) !== JSON.stringify(c.wt)) bad.push({ hash: c.hash, why: `wt ${JSON.stringify(mix.wt)} vs ${JSON.stringify(c.wt)}` });
        // THE TUPLE SHAPE, and it is the clause the milestone plan asked for by
        // name: no element outside the pre-P5 solute sets can enter a mix, so
        // encodeMix must still mint exactly the string it minted before.
        const re = A.encodeMix(mix);
        if (re !== c.re) bad.push({ hash: c.hash, why: `re-encoded as ${re} vs ${c.re}` });
        restored++;
      }
      if (refusals.length !== c.refusals) bad.push({ hash: c.hash, why: `${refusals.length} refusals vs ${c.refusals}` });
      if (JSON.stringify(clamped) !== JSON.stringify(c.clamped)) bad.push({ hash: c.hash, why: `clamped ${JSON.stringify(clamped)} vs ${JSON.stringify(c.clamped)}` });
      refused += refusals.length;
    }

    // A GRID CELL CANNOT PUT A NEW SYMBOL INTO A LINK, proven rather than
    // asserted: every element the grid classifies as ASSESSED for some base is
    // already in that base's solute set, so the encoder's alphabet is unchanged.
    const newSymbols = [];
    for (const bk of Object.keys(A.BASES)) {
      for (const row of E.ELEMENTS) {
        const a = E.admit(bk, row.symbol, E.probeWt(bk, row.symbol));
        if (a?.tier === "ASSESSED" && !Object.hasOwn(A.BASES[bk].solutes, row.symbol)) {
          newSymbols.push(`${bk}-${row.symbol}`);
        }
      }
    }
    // ...and the same statement in the other direction, so "assessed is empty"
    // cannot pass it: the assessed set is exactly the 25 shipped pairs.
    const assessedCount = Object.keys(A.BASES).reduce((n, bk) =>
      n + E.ELEMENTS.filter(r => E.admit(bk, r.symbol, E.probeWt(bk, r.symbol))?.tier === "ASSESSED").length, 0);
    const shippedPairs = Object.values(A.BASES).reduce((n, b) => n + Object.keys(b.solutes).length, 0);

    const ok = bad.length === 0 && restored === 14 && refused >= 4
      && newSymbols.length === 0 && assessedCount === shippedPairs && shippedPairs === 25;
    check("ALLOY-SHARE-PRE-P5", ok, {
      links: CORPUS.length, restored, bad, refusalsRaised: refused,
      elementsTheGridCouldAddThatEncodeMixHasNeverSeen: newSymbols,
      assessedPairs: assessedCount, shippedSolutePairs: shippedPairs,
    });
  });
}

// ---------------------------------------------------------------------------
// 3. GRID-LAYOUT-TOTAL — 118 elements, 118 places, no two the same.
//
//    A layout table is exactly the kind of thing that looks right and is off by
//    one: put lutetium in column 18 and it lands on hafnium, one cell covers
//    the other, and the only symptom is an element nobody can click. Every
//    position is required to be unique, inside the 18-column frame, and to
//    agree with the `block` column the data already carries.
block("GRID-LAYOUT-TOTAL", () => {
  // The columns each block occupies in the 18-column medium form. Helium is the
  // one row this does not describe — an s-block element drawn at group 18,
  // which is the layout's single genuine exception and is pinned by name below
  // rather than widened into the s band, since widening it to [1, 18] would
  // stop the band constraining anything at all.
  const BLOCK_BAND = { s: [1, 2], d: [3, 12], p: [13, 18], f: [3, 17] };
  const seen = new Map();
  const bad = [];
  const cols = new Set(), rows = new Set();
  for (const row of E.ELEMENTS) {
    const p = E.tablePos(row.Z);
    if (!p) { bad.push({ el: row.symbol, why: "no position" }); continue; }
    if (!(p.col >= 1 && p.col <= 18)) bad.push({ el: row.symbol, why: `col ${p.col} outside 1-18` });
    if (!(p.row >= 1 && p.row <= 9)) bad.push({ el: row.symbol, why: `row ${p.row} outside 1-9` });
    const key = `${p.col},${p.row}`;
    if (seen.has(key)) bad.push({ el: row.symbol, why: `shares ${key} with ${seen.get(key)}` });
    seen.set(key, row.symbol);
    cols.add(p.col); rows.add(p.row);
    // THE DRAWING AGREES WITH THE DATA. `SRC.f` says this table takes the
    // f-block as La-Lu and Ac-Lr, the metallurgical grouping rather than the
    // configuration one, and rows 8 and 9 are where the drawing puts them. If
    // someone later moves La into the d-block census without moving the
    // drawing, these two disagree and this fires.
    const drawnAsF = p.row >= 8;
    if (drawnAsF !== (row.block === "f")) bad.push({ el: row.symbol, why: `drawn in row ${p.row} but block is "${row.block}"` });
    // AND THE COLUMN IS TIED TO THE BLOCK TOO, which uniqueness cannot do.
    // Review found the hole by exploiting it: uniqueness, range, the row/block
    // agreement and nineteen spot pins all constrain the SET of occupied cells
    // and never which element sits in which one. Two mutations passed every
    // clause — drawing aluminium, this app's flagship base, in group 3 instead
    // of group 13 (the cell under scandium is empty, so nothing collides), and
    // drawing the whole of period 5 right-to-left with rubidium at group 18
    // (a permutation of a row is still a bijection onto 1-18). Tying each
    // element's column to the band its own `block` implies is a per-element
    // constraint over all 118 rather than nineteen hand-picked ones, and it
    // fails on both: Al is p-block and 3 is not in [13,18]; Rb is s-block and
    // 18 is not in [1,2].
    const [lo, hi] = BLOCK_BAND[row.block];
    if (row.symbol !== "He" && (p.col < lo || p.col > hi)) bad.push({ el: row.symbol, why: `${row.block}-block drawn at column ${p.col}, outside [${lo}, ${hi}]` });
  }
  // out-of-range inputs get nothing rather than a wrong cell
  const outside = [0, 119, -1, 1.5, NaN, Infinity].map(z => E.tablePos(z));

  // SPOT-PINS, because "unique and in range" is satisfied by a scramble. These
  // are the six corners of the layout's own logic: the two ends of period 1,
  // the p-block jump that skips ten empty columns in period 2, the f-block's
  // first and last, and the element that resumes the main table after it.
  const PINS = {
    H: [1, 1], He: [18, 1], Be: [2, 2], B: [13, 2], Ne: [18, 2], Ar: [18, 3],
    K: [1, 4], Kr: [18, 4], Cs: [1, 6], Ba: [2, 6],
    La: [3, 8], Lu: [17, 8], Hf: [4, 6], Rn: [18, 6],
    Ac: [3, 9], Lr: [17, 9], Rf: [4, 7], Og: [18, 7], U: [6, 9],
  };
  const pinBad = [];
  for (const [sym, [col, row]] of Object.entries(PINS)) {
    const z = E.BY_SYMBOL[sym]?.Z;
    const p = z ? E.tablePos(z) : null;
    if (!p || p.col !== col || p.row !== row) pinBad.push({ sym, got: p, want: { col, row } });
  }

  // the two sockets under scandium and yttrium are deliberately EMPTY
  const socketsEmpty = !seen.has("3,6") && !seen.has("3,7");

  const ok = bad.length === 0 && pinBad.length === 0 && seen.size === 118
    && E.ELEMENTS.length === 118 && cols.size === 18 && rows.size === 9
    && outside.every(p => p === null) && socketsEmpty;
  check("GRID-LAYOUT-TOTAL", ok, {
    placed: seen.size, distinctColumns: cols.size, distinctRows: rows.size,
    bad, pinBad, socketsUnderScAndYAreEmpty: socketsEmpty,
    outOfRangeAllNull: outside.every(p => p === null),
    fBlockRows: E.ELEMENTS.filter(r => E.tablePos(r.Z).row >= 8).length,
  });
});

// ---------------------------------------------------------------------------
// 4. GRID-REASON-LINE — the one-line reason, over all 708 pairs.
//
//    P4 left this milestone an explicit note: `Admission` carried a paragraph
//    and the grid needs a line, and the line must be DERIVED IN THE CLASSIFIER
//    rather than cut from the paragraph, "or the sentence that gets cut will be
//    the half carrying the number". Every one of these sentences puts its
//    number in the middle, so that is not a stylistic preference — a
//    `.slice(0, 90)` keeps the throat-clearing and drops the measurement.
//
//    "Not a truncation" is checkable mechanically: no line may be a prefix of
//    its own sentence. Beside it, the same two structural checks EL-TIER-TOTAL
//    uses — a skeleton census so 708 lines are not one template, and cells
//    pinned by BRANCH with must/must-not markers, which is the shape P4's
//    second review proved a count cannot replace.
block("GRID-REASON-LINE", () => {
  const bases = Object.keys(A.BASES);
  const rows = [];
  const bad = [];
  const covered = new Set();
  // THE FIVE PER-LINE ASSERTIONS, LIFTED OUT OF THE 708-PAIR WALK so a second
  // pass can drive them over the branches that walk cannot reach. Review found
  // that hole by measuring it: `probeWt` is min(1 wt%, ceiling/2), which is
  // STRICTLY below every ceiling and always finite, so the grid's own scan
  // never produces PAST-THE-INVARIANT or NOT-A-COMPOSITION — two of the eleven
  // reasons, and precisely the two whose lines interpolate numbers. A line
  // reading "past 0.53 wt% at null °C" would have shipped with every gate
  // green, because no assertion in this file ever saw it.
  const lineOk = (tag, a) => {
    if (!a) { bad.push({ pair: tag, why: "no admission" }); return; }
    covered.add(a.reason);
    if (typeof a.line !== "string" || a.line.trim().length === 0) { bad.push({ pair: tag, why: "empty line" }); return; }
    // A LINE, not a paragraph. 190 characters is roughly two printed lines in
    // the panel's 9.5px type at the card's width; past that it is the
    // paragraph again and the field has stopped meaning anything.
    if (a.line.length > 190) bad.push({ pair: tag, why: `line is ${a.line.length} chars` });
    if (a.line.length < 40) bad.push({ pair: tag, why: `line is only ${a.line.length} chars` });
    // NOT A TRUNCATION. This is the mechanical form of P4's note.
    if (a.sentence.startsWith(a.line.slice(0, Math.min(a.line.length, 60)))) {
      bad.push({ pair: tag, why: "line is a prefix of its own sentence" });
    }
    // and never a raw NaN in front of a user, the ban EL-TIER-TOTAL set
    if (/\bNaN\b|\bundefined\b|\bnull\b|\[object/.test(a.line)) bad.push({ pair: tag, why: `line leaks a placeholder: ${a.line.slice(0, 60)}` });
  };
  for (const bk of bases) {
    for (const row of E.ELEMENTS) {
      const wt = E.probeWt(bk, row.symbol);
      const a = E.admit(bk, row.symbol, wt);
      lineOk(`${bk}-${row.symbol}`, a);
      if (a?.line) rows.push({ pair: `${bk}-${row.symbol}`, reason: a.reason, tier: a.tier, line: a.line });
    }
  }

  // THE TWO BRANCHES probeWt CANNOT REACH, driven at the compositions that do.
  let past = 0, notComp = 0;
  for (const bk of bases) {
    for (const el of Object.keys(A.BASES[bk].solutes)) {
      const b = A.soluteBound(bk, el);
      if (b?.ceiling == null) continue;
      for (const w of [b.ceiling, +(b.ceiling + b.step).toFixed(4)]) {
        const a = E.admit(bk, el, w);
        if (a?.reason !== "PAST-THE-INVARIANT") { bad.push({ pair: `${bk}-${el}@${w}`, why: `expected PAST-THE-INVARIANT, got ${a?.reason}` }); continue; }
        lineOk(`${bk}-${el}@${w}`, a);
        past++;
      }
    }
  }
  for (const [bk, el] of [["fe", "Cr"], ["al", "Si"], ["cu", "Sn"]]) {
    for (const w of [NaN, -1, 101, Infinity]) {
      const a = E.admit(bk, el, w);
      if (a?.reason !== "NOT-A-COMPOSITION") { bad.push({ pair: `${bk}-${el}@${w}`, why: `expected NOT-A-COMPOSITION, got ${a?.reason}` }); continue; }
      lineOk(`${bk}-${el}@${w}`, a);
      notComp++;
    }
  }

  // THE SKELETON CENSUS. Blank the element symbols, the base labels and every
  // number, and what is left is the template. 708 lines collapsing to three
  // templates would mean the classifier is answering one question in 708
  // costumes, which is exactly the failure this milestone exists to avoid.
  const symbols = E.ELEMENTS.map(r => r.symbol).sort((x, y) => y.length - x.length);
  const labels = Object.values(A.BASES).flatMap(b => [b.label, b.symbol]).sort((x, y) => y.length - x.length);
  const skeleton = s => {
    let t = s;
    for (const w of labels) t = t.split(w).join("~");
    for (const w of symbols) t = t.split(w).join("~");
    return t.replace(/-?\d[\d.]*/g, "#").replace(/~+/g, "~");
  };
  const skels = new Map();
  for (const r of rows) {
    const k = skeleton(r.line);
    if (!skels.has(k)) skels.set(k, []);
    skels.get(k).push(r);
  }
  // no skeleton may cover half the grid, and no two REASONS may share one —
  // two different mechanisms printing the same template is the same sentence
  // wearing two names
  const biggest = Math.max(...[...skels.values()].map(v => v.length));
  const skelReasonClash = [...skels.entries()]
    .filter(([, v]) => new Set(v.map(r => r.reason)).size > 1)
    .map(([k, v]) => ({ skeleton: k.slice(0, 70), reasons: [...new Set(v.map(r => r.reason))] }));

  // THE BRANCH PINS. P4's second review found that flipping one token in
  // `N_DISSOLVES` made iron print a self-contradicting sentence with all six
  // gates green, because a COUNT of shapes cannot see a swap between two
  // POPULATED branches. Every base-sensitive line here carries a marker it MUST
  // have and one it must NOT — and the must-not half is the half that matters,
  // because the wrong branch's text usually contains the right branch's words.
  const BRANCH = [
    ["fe", "N", /genuinely dissolves and follows Sieverts/, /REACTS|essentially nil/],
    ["ni", "N", /genuinely dissolves and follows Sieverts/, /REACTS|essentially nil/],
    ["al", "N", /does not dissolve, it REACTS — to AlN/, /genuinely dissolves|Mg3N2|essentially nil/],
    ["mg", "N", /does not dissolve, it REACTS — to Mg3N2/, /genuinely dissolves|AlN|essentially nil/],
    ["cu", "N", /essentially nil.*purge gas for copper/, /genuinely dissolves|REACTS/],
    ["zn", "N", /essentially nil, and this table has no practice/, /genuinely dissolves|REACTS|purge gas/],
    ["cu", "O", /Tough-pitch copper carries 0\.02-0\.05 wt% oxygen on purpose/, /does not stay dissolved|probed in-ladle/],
    ["fe", "O", /oxygen does dissolve — it is probed in-ladle/, /does not stay dissolved|Tough-pitch/],
    ["al", "O", /oxygen does not stay dissolved at all/, /probed in-ladle|Tough-pitch/],
    ["al", "H", /the porosity layer already models it/, /carries no solubility data/],
    ["fe", "H", /carries no solubility data for iron \/ steel/, /already models it/],
    // the tiers that are not gas species, pinned the same way
    // the Fe–C row this table carries is the δ-ferrite PERITECTIC at 1495 °C,
    // not the 1148 °C eutectic — that is the boundary v7.1 P3 derived the
    // 0.53 wt% carbon ceiling from, and a pin written from memory said eutectic
    ["fe", "C", /^Assessed: m -78 K\/wt%, k 0\.17, and a cited peritectic at 1495 °C/, /geometry check|every proportion|eutectic/],
    // carbon in ALUMINIUM takes the "carried elsewhere" branch, not the bare
    // no-row one — it is a solute this composer has, in another melt
    ["al", "C", /C is carried as a solute in iron \/ steel, but Al–C has no coefficient row/, /^Assessed|geometry check|will not invent one/],
    // the must-not is the OTHER assessed branch's marker: a row that survives
    // its geometry check says "and a cited <kind> at <T> °C", and this one says
    // "but the <kind> row at <T> °C fails its own geometry check"
    ["ni", "W", /fails its own geometry check/, /and a cited /],
    // the two isomorphous pairs, which have no invariant temperature to quote
    ["fe", "Cr", /soluble in every proportion, with no invariant to stop at/, /null|geometry check|°C/],
    ["cu", "Ni", /soluble in every proportion, with no invariant to stop at/, /null|geometry check|°C/],
    ["cu", "Pb", /monotectic at 955 °C/, /unchecked|no coefficient row/],
    ["al", "Pb", /monotectic at 659 °C/, /955|unchecked/],
    ["fe", "Pb", /refused for being unchecked, not for demixing/, /monotectic/],
    ["al", "Al", /IS this melt/, /no coefficient row/],
    ["fe", "Fe", /IS this melt/, /no coefficient row/],
    ["al", "Ar", /noble gas/, /halogen|Sieverts/],
    ["al", "Cl", /halogen/, /noble gas|Sieverts/],
    // all four rungs of the not-primordial ladder, one pin each. Curium is
    // deliberately NOT the decay-chain case — Z 96 is transuranic, so it takes
    // the reactor-bred rung, and a pin written from the periodic table rather
    // than from the code would have asserted the wrong branch here.
    ["al", "Tc", /is not primordial: a decay-chain member or a fission product/, /transactinide|reactor-bred|atom-to-microgram/],
    ["al", "Pu", /reactor-bred, and the ones just past uranium exist in quantity/, /transactinide|decay-chain|atom-to-microgram/],
    ["al", "Es", /made in atom-to-microgram quantities/, /transactinide|reactor-bred|decay-chain/],
    ["al", "Og", /has only ever existed as single atoms in an accelerator/, /reactor-bred|decay-chain|atom-to-microgram/],
    ["fe", "S", /canonical low-k segregator in iron/, /the iron pair is the one worth entering/],
    ["al", "S", /the iron pair is the one worth entering first/, /canonical low-k segregator in iron/],
  ];
  const branchBad = [];
  for (const [bk, sym, must, mustNot] of BRANCH) {
    const a = E.admit(bk, sym, E.probeWt(bk, sym));
    if (!a) { branchBad.push({ pair: `${bk}-${sym}`, why: "no admission" }); continue; }
    if (!must.test(a.line)) branchBad.push({ pair: `${bk}-${sym}`, why: `missing ${must}`, line: a.line.slice(0, 110) });
    if (mustNot.test(a.line)) branchBad.push({ pair: `${bk}-${sym}`, why: `carries the other branch's words ${mustNot}`, line: a.line.slice(0, 110) });
  }

  // THE COMPOSITION AT ISSUE, which is the other note P4 left. At a flat 1 wt%
  // three assessed pairs classify as OUTSIDE-THE-MODEL, because 1 wt% is past
  // all three of their invariants. `probeWt` is what stops the grid painting
  // carbon-in-steel as a refusal, and this clause is what stops someone
  // "simplifying" it back to a constant.
  const atOne = [], atProbe = [];
  for (const bk of bases) {
    for (const row of E.ELEMENTS) {
      if (E.admit(bk, row.symbol, 1)?.tier === "ASSESSED") atOne.push(`${bk}-${row.symbol}`);
      if (E.admit(bk, row.symbol, E.probeWt(bk, row.symbol))?.tier === "ASSESSED") atProbe.push(`${bk}-${row.symbol}`);
    }
  }
  const lostAtOne = atProbe.filter(p => !atOne.includes(p));

  // AND THE COVERAGE IS ITSELF A GATED CLAIM, not an accident of which
  // compositions this gate happens to drive: all eleven `AdmitReason` members
  // must have been exercised. A future edit that stops reaching one fails here
  // rather than silently narrowing the gate.
  const REASONS = ["CITED-PAIR", "PAST-THE-INVARIANT", "DEMIXES", "NO-ASSESSMENT",
    "NOT-CHECKED-FOR-DEMIXING", "IS-THE-BASE", "NOT-A-COMPOSITION",
    "NOBLE-GAS", "HALOGEN", "GAS-SPECIES", "NOT-PRIMORDIAL"];
  const uncovered = REASONS.filter(r => !covered.has(r));
  const extra = [...covered].filter(r => !REASONS.includes(r));

  const ok = bad.length === 0 && branchBad.length === 0 && rows.length === 708
    && skels.size >= 20 && biggest < 354 && skelReasonClash.length === 0
    && lostAtOne.length === 3 && atProbe.length === 25
    // 46 = the 23 pairs carrying a ceiling (25 assessed less the two
    // isomorphous ones, which have no invariant to be past) driven at two
    // compositions each. Measured, not guessed — the first draft of this line
    // said 10, which is the lesson this milestone wrote down two hours earlier.
    && uncovered.length === 0 && extra.length === 0 && past === 46 && notComp === 12;
  check("GRID-REASON-LINE", ok, {
    pairs: rows.length, bad: bad.slice(0, 8), badCount: bad.length,
    reasonsCovered: covered.size, uncovered, extra,
    pastTheInvariantDriven: past, notACompositionDriven: notComp,
    distinctSkeletons: skels.size, largestSkeleton: biggest, skelReasonClash,
    branchesPinned: BRANCH.length, branchBad,
    shortest: rows.reduce((m, r) => Math.min(m, r.line.length), 1e9),
    longest: rows.reduce((m, r) => Math.max(m, r.line.length), 0),
    assessedAtProbeWt: atProbe.length, assessedAtAFlat1wt: atOne.length,
    pairsAFlat1wtWouldPaintAsRefusals: lostAtOne,
  });
});

// ---------------------------------------------------------------------------
// 5. LANDING-CLOSURE-CLEAN — the front door does not download the chemistry.
//
//    The milestone plan names this risk by name: keep `phasedata.ts` and
//    `elements.ts` out of anything the landing page imports, "or ~25 KB of
//    chemistry rides the landing page's first paint for no reason". The
//    obvious check is to grep the built bundle, and it is the wrong one: `npm
//    test` does not build, so that gate would either fail on a fresh clone or
//    be allowed to skip, and a gate that can skip is not a gate.
//
//    So the SOURCE closure is walked instead — which is also the causal
//    mechanism rather than its symptom. Rollup hoists a module into a shared
//    chunk exactly when two entries can reach it; if the landing entry cannot
//    reach elements.ts through any chain of static imports, no bundler
//    arrangement can put it on the front page.
block("LANDING-CLOSURE-CLEAN", () => {
  const walk = entry => {
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      let src;
      try { src = readFileSync(`src/${f}.ts`, "utf8"); } catch { continue; }
      // static imports and re-exports only — a dynamic import() would be a
      // separate chunk by construction and is not what this gate is about
      for (const m of src.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+"\.\/([\w-]+)"/gm)) stack.push(m[1]);
      for (const m of src.matchAll(/^\s*import\s+"\.\/([\w-]+)"/gm)) stack.push(m[1]);
    }
    return seen;
  };
  const landing = walk("landing");
  const app = walk("main");
  const CHEMISTRY = ["elements", "alloy", "phasedata", "composer", "phasediagram"];
  const leaked = CHEMISTRY.filter(m => landing.has(m));

  // LIVENESS, both directions. A walker that returns an empty set would report
  // no leak forever, and a walker that never followed an edge would too — so
  // the landing closure is required to contain the modules it genuinely does,
  // and the APP closure is required to contain every chemistry module, which
  // proves the walker can reach them at all.
  const landingHas = ["sim", "render", "shaders", "materials", "dive", "rng"].filter(m => landing.has(m));
  const appMissing = CHEMISTRY.filter(m => !app.has(m));

  const ok = leaked.length === 0 && landing.size >= 8 && landingHas.length === 6 && appMissing.length === 0;
  check("LANDING-CLOSURE-CLEAN", ok, {
    landingModules: landing.size, appModules: app.size,
    chemistryReachableFromLanding: leaked,
    landingClosureSanity: landingHas,
    chemistryUnreachableFromApp: appMissing,
    note: "static-import closure from src/landing.ts, which is what decides Rollup's chunking",
  });
});

// ---------------------------------------------------------------------------
// 6. GRID-DOC-CLAIMS — this milestone's prose, gated in the commit that writes
//    it, on EL-DOC-CLAIMS' mechanics one layer over.
//
//    EVERY EXPECTED VALUE IS RECOMPUTED FROM THE MODULES, never a literal
//    retyped from the paragraph — a doc gate that hardcodes the number it is
//    checking asserts that a document agrees with itself. And no claim may be a
//    bare small integer: "14" is satisfied by any document containing those two
//    characters, which is the lesson P3 wrote down and P4 kept.
//
//    Writing this gate caught a claim of its own. The paragraph first said each
//    cell is classified "at half its own invariant composition", which is false
//    for most of the table: `probeWt` is min(1 wt%, ceiling/2), so Al–Cu with a
//    33.2 wt% invariant is asked at 1 wt% and not at 16.6.
block("GRID-DOC-CLAIMS", () => {
  const bases = Object.keys(A.BASES);
  const tierAt = (bk, sym, wt) => E.admit(bk, sym, wt)?.tier;
  const vapAt = (bk, sym) => {
    const v = E.admit(bk, sym, E.probeWt(bk, sym))?.vapour;
    return v && (v.band === "FUME" || v.band === "BOILS") ? v.band : null;
  };
  const changed = E.ELEMENTS.filter(r =>
    tierAt("al", r.symbol, E.probeWt("al", r.symbol)) !== tierAt("fe", r.symbol, E.probeWt("fe", r.symbol)));
  const unchanged = E.ELEMENTS.length - changed.length;
  // gained a fume/boil stripe on the base switch AND did not change tier — the
  // "second channel moves independently" claim, which is the whole reason the
  // vapour band is not folded into the tier
  const gainedStripeOnly = E.ELEMENTS.filter(r =>
    !vapAt("al", r.symbol) && vapAt("fe", r.symbol) && !changed.includes(r));
  const assessedAtProbe = bases.flatMap(bk => E.ELEMENTS.filter(r => tierAt(bk, r.symbol, E.probeWt(bk, r.symbol)) === "ASSESSED").map(r => `${bk}-${r.symbol}`));
  const lostAtOne = assessedAtProbe.filter(p => {
    const [bk, sym] = p.split("-");
    return tierAt(bk, sym, 1) !== "ASSESSED";
  });
  const cols = new Set(E.ELEMENTS.map(r => E.tablePos(r.Z).col));

  const pairs = Object.values(A.BASES).reduce((n, b) => n + Object.keys(b.solutes).length, 0);
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four", "twenty-five"];
  // the mercury numbers the README quotes, taken from the advisory that
  // computes them rather than retyped — this is the C0b failure mode (a
  // `derive()` output quoted as prose with no gate on it) one layer over, and
  // the README is where it usually happens
  const hg = E.vapourAt("al", "Hg", 1);
  const hgAtm = [...hg.text.matchAll(/([\d.]+) atm/g)].map(m => m[1]);

  const CLAIMS = [
    ["every element is drawn", `all ${E.ELEMENTS.length} elements`, "science"],
    ["the column count", `laid out in ${cols.size} columns`, "science"],
    ["the composition each cell is asked at", "at 1 wt%, or at half its own invariant composition where that is smaller", "science"],
    ["the pairs a flat 1 wt% would refuse", lostAtOne.sort().join(", ").replace(/, ([^,]*)$/, " and $1"), "science"],
    ["how many pourable pairs there are", `three of the ${words[assessedAtProbe.length] ?? "?"} pourable pairs`, "science"],
    ["cells that change tier on the base switch", `moves ${changed.length} of the ${E.ELEMENTS.length} cells`, "science"],
    ["cells that do not", `leaves ${unchanged} where they were`, "science"],
    ["the independent vapour channel", `a fume stripe appears under ${gainedStripeOnly.length} more elements whose tier does not change at all`, "science"],
    // AND THE MECHANISM, recomputed rather than asserted. The paragraph first
    // said the iron liquidus stands "hundreds of degrees" above these boiling
    // points; measured, caesium clears aluminium's melting point by 10 K and
    // calcium sits 54 K under iron's, so the true statement is a BRACKET and
    // not a magnitude — and it is checked as one below.
    ["the bracket the stripe comes from", `every one of their boiling points falls between aluminium's ${(MAT.MATERIALS.al.si.Tm - 273.15).toFixed(0)} °C and iron's ${(MAT.MATERIALS.steel.si.Tm - 273.15).toFixed(0)} °C`, "science"],
    ["the non-regression set", `all ${A.FAMOUS.length} presets and all ${pairs} legacy pairs`, "science"],
    // and the same numbers where the README states them, because a claim is
    // gated in every document that makes it or it is gated in none
    ["README: the cell count", `${E.ELEMENTS.length} cells coloured for the melt`, "readme"],
    ["README: pourable against refused", `${assessedAtProbe.length} of the ${bases.length * E.ELEMENTS.length} (base, element) pairs are pourable and the other ${bases.length * E.ELEMENTS.length - assessedAtProbe.length} are refusals`, "readme"],
    ["README: the mercury advisory's own numbers", `exerts ${hgAtm[0]} atm over liquid aluminium, and pure mercury would exert ${hgAtm[1]}`, "readme"],
    ["README: the base switch", `recolours ${changed.length} cells and puts a fume stripe under ${words[gainedStripeOnly.length] ?? "?"} more`, "readme"],
    ["README: the assessed tier did not grow", `exactly the ${pairs} pairs that already had both a cited coefficient row and a cited invariant`, "readme"],
  ];

  // tags stripped and typographic dashes flattened first, exactly as
  // EL-DOC-CLAIMS does it, so the gate cannot fail on typography
  const flatten = f => readFileSync(f, "utf8")
    .replace(/<[^>]+>/g, "").replace(/[‐-―]/g, "-").replace(/\s+/g, " ");
  const DOC = { science: flatten("science/index.html"), readme: flatten("README.md") };
  const flat = DOC.science;
  const missing = CLAIMS.filter(([, s, f]) => !DOC[f].includes(s.replace(/[‐-―]/g, "-"))).map(([k, s, f]) => ({ claim: k, file: f, wanted: s }));
  // liveness: no claim is a bare number, the four named elements really are in
  // the independent-stripe set, and the section is present at all
  const bareInteger = CLAIMS.filter(([, s]) => /^\d+$/.test(s.trim())).map(([k]) => k);
  const namedFour = ["Na", "K", "Ca", "Cd"].filter(s => !gainedStripeOnly.some(r => r.symbol === s));
  const sectionPresent = flat.includes("v7.1 P5 puts that table on screen");
  // the bracket claim, held against the data rather than against the sentence
  const tbs = gainedStripeOnly.map(r => r.Tb);
  const bracketHolds = tbs.length > 0 && tbs.every(t => t != null)
    && Math.min(...tbs) > MAT.MATERIALS.al.si.Tm && Math.max(...tbs) < MAT.MATERIALS.steel.si.Tm;
  // and the margins the prose names, so "10 K" and "54 K" cannot rot either
  const lowMargin = Math.round(Math.min(...tbs) - MAT.MATERIALS.al.si.Tm);
  const highMargin = Math.round(MAT.MATERIALS.steel.si.Tm - Math.max(...tbs));
  const marginsNamed = flat.includes(`caesium boils ${lowMargin} K above the aluminium melting point and calcium ${highMargin} K below the iron one`);

  const ok = missing.length === 0 && bareInteger.length === 0
    && namedFour.length === 0 && sectionPresent
    && bracketHolds && marginsNamed
    && changed.length > 0 && unchanged > 0 && gainedStripeOnly.length > 0;
  check("GRID-DOC-CLAIMS", ok, {
    claims: CLAIMS.length, missing, bareInteger, sectionPresent,
    namedButNotInTheSet: namedFour,
    bracketHolds, marginsNamed, lowMarginK: lowMargin, highMarginK: highMargin,
    measured: { changed: changed.length, unchanged, stripeOnly: gainedStripeOnly.map(r => r.symbol),
      assessedAtProbe: assessedAtProbe.length, lostAtOne },
  });
});

if (E && A && C && MAT) {
  await server.close();
  console.log(failures ? `done — ${failures} FAILED` : "done — all composer-grid checks passed");
  if (failures) process.exitCode = 1;
}
