// PD-* — the binary invariant table, checked without a browser.
//
// phasedata.ts is pure data, so it loads through vite's SSR loader and runs in
// CI alongside units / rng / heattreat / thermal / fade / porosity / experiment.
//
// These gates are about TOTALITY and BOTH POLARITIES, not about whether any one
// number is right — a number's correctness is the audit's job
// (docs/PHASE-AUDIT.md recomputes every row from an open CALPHAD database).
// What is checkable here is that the two tables cannot drift apart, that every
// row carries real provenance, and that the isomorphous branch is exercised in
// both directions.
//
//   node scripts/verify-phasedata.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const PD = await server.ssrLoadModule("/src/phasedata.ts");
const A = await server.ssrLoadModule("/src/alloy.ts");
const M = await server.ssrLoadModule("/src/materials.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

const rows = [];
for (const [baseKey, byEl] of Object.entries(PD.BINARY)) {
  for (const [el, row] of Object.entries(byEl)) rows.push({ baseKey, el, row });
}

// 1. PD-ROW-SOURCED — every row carries its own provenance, and the provenance
//    is not one sentence pasted everywhere. The distinct-set size is the half
//    that catches a blanket citation: 25 rows all citing "ASM Handbook" would
//    satisfy a length check and tell a reader nothing about any single row.
{
  const short = rows.filter(r => !r.row.source || r.row.source.length <= 30)
    .map(r => `${r.baseKey}-${r.el}`);
  const distinct = new Set(rows.map(r => r.row.source)).size;
  const ok = rows.length > 0 && short.length === 0 && distinct >= 5;
  check("PD-ROW-SOURCED", ok, { rows: rows.length, distinctSources: distinct, short });
}

// 2. PD-SECOND-PHASE-POLARITY — a non-isomorphous row must NAME the phase that
//    appears; an isomorphous row must not, because there is no second phase and
//    a filled field there is an invention. Asserted in BOTH directions, and
//    both branches asserted non-empty, so a table with no isomorphous systems
//    (or no invariant ones) cannot pass this vacuously.
{
  const iso = rows.filter(r => r.row.invariant === "isomorphous");
  const inv = rows.filter(r => r.row.invariant !== "isomorphous");
  const badInv = inv.filter(r => !r.row.second || !r.row.reaction)
    .map(r => `${r.baseKey}-${r.el}`);
  const badIso = iso.filter(r => r.row.second !== "" || r.row.Tinv !== null
    || r.row.Cinv !== null).map(r => `${r.baseKey}-${r.el}`);
  const ok = iso.length >= 1 && inv.length >= 1
    && badInv.length === 0 && badIso.length === 0;
  check("PD-SECOND-PHASE-POLARITY", ok,
    { isomorphous: iso.length, withInvariant: inv.length, badInv, badIso });
}

// 3. PD-TABLE-BIJECTION — neither table may drift ahead of the other. Every
//    (base, solute) pair the composer can actually pour resolves to a row, and
//    every row resolves to a pair. Without the second half a stale row for a
//    solute that was deleted from BASES sits here forever, quietly sourcing a
//    system nothing can select.
{
  const pairs = [];
  for (const [baseKey, base] of Object.entries(A.BASES)) {
    for (const el of Object.keys(base.solutes)) pairs.push(`${baseKey}-${el}`);
  }
  const rowKeys = rows.map(r => `${r.baseKey}-${r.el}`);
  const missingRow = pairs.filter(p => !rowKeys.includes(p));
  const orphanRow = rowKeys.filter(k => !pairs.includes(k));
  const ok = pairs.length > 0 && missingRow.length === 0 && orphanRow.length === 0;
  check("PD-TABLE-BIJECTION", ok,
    { pairs: pairs.length, rows: rowKeys.length, missingRow, orphanRow });
}

// 4. PD-ORDERING — the numbers must obey their own reaction's geometry.
//    For a base-rich EUTECTIC the primary solid solubility limit sits below the
//    eutectic liquid: Csm < Cinv. A row that violates this was transcribed from
//    the wrong side of the diagram, which is the single most likely
//    hand-entry error and one that no amount of sourcing would catch.
{
  const bad = rows.filter(r => {
    const { invariant, Csm, Cinv, Tinv } = r.row;
    if (invariant === "isomorphous") return false;
    if (!Number.isFinite(Csm) || !Number.isFinite(Cinv) || !Number.isFinite(Tinv)) return true;
    if (Cinv <= 0 || Csm < 0) return true;
    if (invariant === "eutectic" && !(Csm < Cinv)) return true;
    return false;
  }).map(r => `${r.baseKey}-${r.el}`);
  const eut = rows.filter(r => r.row.invariant === "eutectic").length;
  const per = rows.filter(r => r.row.invariant === "peritectic").length;
  const ok = bad.length === 0 && eut >= 1 && per >= 1;
  check("PD-ORDERING", ok, { eutectic: eut, peritectic: per, bad });
}

// 5. PD-SOLUTE-SOURCED — the coefficient table gains provenance in the same
//    commit as the invariant table, because "assessed" is later defined as
//    holding BOTH a cited coefficient row and a cited invariant row. Same
//    distinct-set trick, same reason.
{
  const solutes = [];
  for (const [baseKey, base] of Object.entries(A.BASES)) {
    for (const [el, s] of Object.entries(base.solutes)) solutes.push({ baseKey, el, s });
  }
  const short = solutes.filter(x => !x.s.source || x.s.source.length <= 30)
    .map(x => `${x.baseKey}-${x.el}`);
  const distinct = new Set(solutes.map(x => x.s.source)).size;
  const ok = solutes.length > 0 && short.length === 0 && distinct >= 5;
  check("PD-SOLUTE-SOURCED", ok, { solutes: solutes.length, distinctSources: distinct, short });
}

// 6. PD-SLOPE-CONSISTENT — a row must describe a diagram that can be drawn.
//
//    A liquidus that RISES from the pure base means the first solid is richer
//    in solute than the liquid (k > 1), and at the invariant that means
//    C_SM > C_inv. If a row says the invariant is above T_m but the LIQUID is
//    the richer phase, its solidus reaches T_inv at a smaller composition than
//    its liquidus, rises faster, and ends up ABOVE it — which is not a phase
//    diagram. PD-ORDERING checks C_SM < C_inv for eutectics; it cannot see this,
//    because this is a relation between the temperatures and the compositions.
//
//    Found in v7.1 P2 by drawing the rows rather than reading them. `ni-W` is
//    the single shipped violation and it is carried BY NAME rather than
//    repaired, because which of T_inv, the reaction type or the C_SM/C_inv pair
//    is wrong has not been resolved — the same doctrine as P0's four named
//    disagreements. The exception list is the assertion: a NEW inconsistent row
//    fails, and so does ni-W becoming consistent without this note being updated.
{
  const KNOWN_BAD = ["ni-W"];
  const rising = [], inconsistent = [];
  for (const { baseKey, el, row } of rows) {
    if (row.invariant === "isomorphous") continue;
    const base = A.BASES[baseKey];
    const si = M.MATERIALS[base.materialKey].si;
    const TmC = si.Tm - 273.15;
    const key = `${baseKey}-${el}`;
    const rises = row.Tinv > TmC;
    const solidRicher = row.Csm > row.Cinv;
    if (rises) rising.push(key);
    if (rises !== solidRicher) inconsistent.push(key);
  }
  const unexpected = inconsistent.filter(k => !KNOWN_BAD.includes(k));
  const repaired = KNOWN_BAD.filter(k => !inconsistent.includes(k));
  // the named exception must EXPLAIN itself where a reader will hit it
  const badSourced = KNOWN_BAD.filter(k => {
    const [b, e] = k.split("-");
    const src = (PD.BINARY[b]?.[e]?.source) ?? "";
    return !/INCONSISTENT/.test(src) || !/not repaired|NOT RESOLVED/i.test(src);
  });
  // liveness: the rising branch must be exercised, or this gate is vacuous on a
  // table where every invariant happens to sit below its base's melting point
  const ok = unexpected.length === 0 && repaired.length === 0
    && badSourced.length === 0 && rising.length >= 2;
  check("PD-SLOPE-CONSISTENT", ok, {
    checked: rows.filter(r => r.row.invariant !== "isomorphous").length,
    risingInvariants: rising, inconsistent, unexpected, repaired, badSourced,
  });
}

// ---------------------------------------------------------------------------
// PD-PRODUCT-SOURCED — the `Csecond` field v7.1 P3 added, and the claim it
// decides.
//
// It exists for exactly one job: on a peritectic whose base solid is a REACTANT
// the reaction consumes the phase this solver grows, and whether ANY of it
// survives depends on this number alone. 1045 at 0.45 wt% C and 4340 at 0.40
// are both past Fe–C's γ at 0.17, so their δ-ferrite is eaten entirely and the
// casting ends as austenite — which the app printed as "(Fe) beside
// gamma-austenite" until this field existed.
//
// EVERY VALUE IS ASSERTED TO APPEAR IN ITS OWN ROW'S PROSE. It was transcribed
// from the sentence that row's `second` and `source` fields already carry, so
// tying it back to that sentence is what makes it a citation rather than a
// number somebody typed. A field added without that link is exactly the drift
// docs/PHASE-AUDIT.md exists to prevent.
{
  const carried = [], bad = [], nulls = [];
  for (const [bk, byBase] of Object.entries(PD.BINARY)) {
    for (const [el, row] of Object.entries(byBase)) {
      const key = `${bk}-${el}`;
      if (!("Csecond" in row)) continue;
      const reactant = row.invariant === "peritectic" && row.Csm != null
        && row.Cinv != null && row.Csm < row.Cinv;
      if (!reactant) { bad.push({ key, why: "Csecond is carried on a row that is not a reactant-peritectic" }); continue; }
      if (row.Csecond == null) {
        // a null is an ANSWER here, and it has to say so in its own source
        if (!/4\.2-4\.7|bracket|could not be opened|DELIBERATELY NULL/i.test(row.source)) {
          bad.push({ key, why: "a null product composition with no explanation in the row's source" });
        }
        nulls.push(key);
        continue;
      }
      carried.push(key);
      // the ordering this class REQUIRES: the product sits between the solid
      // solubility limit and the invariant liquid, or the reaction it describes
      // is not the one the row says it is
      if (!(row.Csm < row.Csecond && row.Csecond < row.Cinv)) {
        bad.push({ key, why: `C_SM ${row.Csm} < C_second ${row.Csecond} < C_inv ${row.Cinv} does not hold` });
      }
      // and it must be the number the row's own prose already states
      const prose = `${row.second} ${row.source}`;
      if (!prose.includes(String(row.Csecond))) {
        bad.push({ key, why: `${row.Csecond} does not appear in this row's own second/source prose` });
      }
    }
  }
  // Liveness on both halves: the field is carried by real rows, AND at least
  // one row declines it for a stated reason, so "populate everything" and
  // "populate nothing" both fail.
  const ok = bad.length === 0 && carried.length >= 3 && nulls.length >= 1;
  check("PD-PRODUCT-SOURCED", ok, {
    rowsCarryingAProductComposition: carried, rowsDecliningIt: nulls, bad,
    note: "Fe-Ni declines: its literature value is a 4.2-4.7 wt% bracket rather than a number, and the row's source says so",
  });
}


// ---------------------------------------------------------------------------
// PD-DOC-CONSTANTS (v7.1 P6) — the documents must quote the numbers the modules
// ship, and must not still be making the claims those numbers retired.
//
// HT-DOC-CONSTANTS' mechanics, one layer over. That gate exists because a
// re-measured tolerance sat wrong in three documents for two releases; this one
// exists because the front door was animating a grain count to 369 against 46
// and captioning it "Composition alone refined the metal eight-fold" while the
// honesty page two clicks away recorded that the comparison was withdrawn in
// v4.0 AND that its inversion was an artefact too. Nothing checked either
// statement, so nothing noticed they were opposite.
//
// EXPECTED VALUES ARE DERIVED, NEVER TYPED. Every string below is built from a
// phasedata row, a derive() output or a module's own key count, so a table edit
// that moves the Al-Si eutectic breaks the documents that quote it rather than
// leaving them quietly wrong. The four numbers this milestone was written for —
// 0.821 and 0.993 on the science page, Q 71 K and Q 1 K on the front door — are
// literal derive() outputs and had no gate at all.
//
// SIX FILES, not the four the plan named. index.html is where the retracted
// claim actually lived and where both Q values are printed; a document list that
// excluded it could gate neither, and the ban would have been checked only in
// files that never said the banned thing. src/alloy.ts joined when the Scheil
// floor's justification turned out to quote a k-ratio span no set in the tree
// produces.
//
// A CLAIM THAT IS ONLY A NUMBER MUST BE UNIQUE IN THE FILE. The first cut of
// this gate claimed the bare string "1.65" against index.html and passed — on
// `line-height: 1.65` in a CSS rule THIS MILESTONE ADDED. The figure's own
// solubility limit, its aria-label, its axis tick and its caption could all be
// rewritten to 9.99 wt% with the gate green, because a typography value was
// answering for a phase-diagram number. Two rules now: a claim carries its units
// wherever units exist, and a claim that is nothing but digits and dots must
// occur EXACTLY ONCE in each file that must contain it, so the next accidental
// collision fails loudly instead of standing in.
//
// THE BANS SELF-TEST. Each carries a fixture that MUST fire and a real sentence
// from this tree that must NOT, both run through the same scanner the documents
// go through. That is deliberately not the per-ban negative lookahead the plan
// called for: this repo has twice shipped a ban that matched the sentence
// DESCRIBING it, and N hand-written lookaheads are N chances to make that
// mistake again. Instead the scanner strips once what is quotation rather than
// claim — backticked spans in markdown, HTML comments, TS comments — and the
// fixtures are what prove the stripping did not neuter the pattern.
{
  const { readFileSync } = await import("node:fs");
  const T = await server.ssrLoadModule("/src/tour.ts");
  const raw = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const NAMES = ["index.html", "science/index.html", "README.md", "TESTING.md", "src/tour.ts",
    "src/alloy.ts"];
  const DOC = Object.fromEntries(NAMES.map(p => [p, raw(p)]));

  // what a reader is actually shown, with the syntax that quotes rather than
  // asserts removed. A ban is a claim about what the page SAYS; a backticked
  // token in TESTING.md and a comment in tour.ts are neither.
  const CODESPAN = /`[^`]*`/g;
  const prose = (p, t) => t
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(p.endsWith(".md") ? CODESPAN : /(?!)/g, " ");
  const PROSE = Object.fromEntries(NAMES.map(p => [p, prose(p, DOC[p])]));

  const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty"];

  const alSi = PD.BINARY.al.Si, feC = PD.BINARY.fe.C;
  const A356TiB = A.derive({ base: "al", wt: { Si: 7, Mg: 0.35, Ti: 0.12 } });
  const A356 = A.derive({ base: "al", wt: { Si: 7, Mg: 0.35 } });
  const lean = A.derive({ base: "al", wt: { Zn: 1 } });
  // the app's own normalised liquidus, 1 - m*c0: the same expression analyze.ts
  // integrates against (analyze.ts:318) and the number the science page prints
  const tNorm = d => (1 - d.params.mLiq * d.params.c0).toFixed(3);

  // The two tables' disagreement about k, which the Scheil floor's justification
  // rests on and which was quoted as "0.68 to 3.30" in two places — a pair no
  // set in the tree produces. 3.30 is cu-Sn, a peritectic PD-CONSTRUCT-AGREE
  // excludes; 0.68 is the minimum of the fifteen rows it enters. Both spans are
  // recomputed here so the sentence cannot drift back.
  const kRatios = [];
  for (const [bk, byEl] of Object.entries(PD.BINARY)) {
    for (const [el, row] of Object.entries(byEl)) {
      if (row.invariant === "isomorphous") continue;
      const r = (row.Csm / row.Cinv) / A.BASES[bk].solutes[el].k;
      kRatios.push({ key: `${bk}-${el}`, r, entered: row.invariant === "eutectic" && row.Cinv <= 60 });
    }
  }
  const span = rows => [Math.min(...rows.map(x => x.r)).toFixed(2), Math.max(...rows.map(x => x.r)).toFixed(2)];
  const [kAllLo, kAllHi] = span(kRatios);
  const [kGateLo, kGateHi] = span(kRatios.filter(x => x.entered));

  // Each claim is a STRING WITH ITS UNITS, never a bare number: "1" as a claim
  // is satisfied by any page containing the digit one, and a gate that cannot
  // fail is worse than no gate. The floor below enforces it.
  const CLAIMS = [
    { s: PD.PHASE_TABLE_VERSION, in: ["science/index.html", "README.md"],
      why: "phasedata.ts's own docblock says these two documents quote the table version — and until this gate neither of them did" },
    { s: `${alSi.Csm} wt%`, in: ["index.html", "src/tour.ts"],
      why: "the Al-Si solid solubility limit: the line the landing figure's marker crosses, and the line the new tour chapter is named after" },
    { s: `data-csm="${alSi.Csm}"`, in: ["index.html"],
      why: "and the same number as the animation reads it — landing-motion.ts takes the crossing point off this attribute, so the prose and the marker cannot be checked separately" },
    { s: `${alSi.Cinv} wt% Si`, in: ["index.html"],
      why: "the Al-Si eutectic liquid, the right-hand end of the drawn frame" },
    { s: `${alSi.Tinv} °C`, in: ["index.html", "src/tour.ts"],
      why: "the Al-Si eutectic temperature" },
    { s: `${feC.Cinv} wt%`, in: ["README.md"],
      why: "the Fe-C peritectic liquid that removed cast iron from the composer at P3" },
    { s: `${Math.round(A356.dT0)} K`, in: ["science/index.html", "TESTING.md"],
      why: "A356's model freezing range, recomputed here through derive() rather than copied" },
    { s: `Q ≈ ${Math.round(A356TiB.Q)} K`, in: ["index.html"],
      why: "the refined charge's growth restriction factor, quoted as prose on the front door" },
    { s: `Q ≈ ${Math.round(lean.Q)} K`, in: ["index.html"],
      why: "the lean charge's growth restriction factor" },
    { s: tNorm(A356TiB), in: ["science/index.html"],
      why: "A356+TiB's normalised liquidus — the number the honesty page's first flaw turns on" },
    { s: tNorm(lean), in: ["science/index.html"],
      why: "Al-1Zn's normalised liquidus, the other half of that comparison" },
    { s: `${(-A356TiB.dTL).toFixed(1)} K`, in: ["index.html"],
      why: "the refined charge's liquidus depression, which replaced the retracted grain count" },
    { s: `${(-lean.dTL).toFixed(1)} K`, in: ["index.html"],
      why: "the lean charge's liquidus depression" },
    // THE ANIMATED VALUES, not just the static ones. Under html.anim — which is
    // every reader who has not asked for less motion — countUp overwrites the
    // shipped text with whatever these attributes say, so gating the prose alone
    // gates the fallback copy and leaves the copy almost everyone sees untyped.
    { s: `data-q="${Math.round(A356TiB.Q)}"`, in: ["index.html"],
      why: "the growth restriction factor the count-up actually lands on" },
    { s: `data-count="${(-A356TiB.dTL).toFixed(1)}"`, in: ["index.html"],
      why: "the refined charge's depression as the animation reads it" },
    { s: `data-count="${(-lean.dTL).toFixed(1)}"`, in: ["index.html"],
      why: "the lean charge's depression as the animation reads it" },
    { s: `data-w="${((lean.dTL / A356TiB.dTL) * 100).toFixed(1)}"`, in: ["index.html"],
      why: "the lean bar's length is the RATIO of the two depressions, and it was 12.5 when it was a ratio of grain counts" },
    { s: `${NUM[Object.keys(M.MATERIALS).length]} qualitative identities`, in: ["README.md"],
      why: "MATERIALS has eleven keys and the rail select offers every one of them; README said ten" },
    { s: `${NUM[Object.keys(M.MATERIALS).length]} material identities`, in: ["src/tour.ts"],
      why: "the same count, in the tour chapter that walks the MATERIAL dropdown" },
    { s: `from ${kAllLo} to ${kAllHi}`, in: ["science/index.html", "src/alloy.ts"],
      why: "the k-ratio span over every row with an invariant — the Scheil floor's justification, quoted for two releases as a pair no set in the tree produces" },
    { s: `from ${kGateLo} to ${kGateHi}`, in: ["science/index.html", "src/alloy.ts"],
      why: "the narrower span PD-CONSTRUCT-AGREE actually measures, which is the one the gate was being credited with" },
    { s: `${NUM[Object.keys(T.SCENES).length]} one-tap situations`, in: ["src/tour.ts"],
      why: "SCENES has nine entries and the preset row builds a button for each; the tour said eight and left the quasicrystal out of the list it then gave" },
  ];

  const missing = [];
  const count = (hay, needle) => hay.split(needle).length - 1;
  for (const c of CLAIMS) {
    if (c.s.length < 4) { missing.push({ claim: c.s, why: "expected string too short to be a real claim" }); continue; }
    const bare = /^[\d.]+$/.test(c.s);
    for (const f of c.in) {
      const n = count(DOC[f].toLowerCase(), c.s.toLowerCase());
      if (n === 0) { missing.push({ claim: c.s, file: f, why: c.why }); continue; }
      // a claim with no units is only a claim while nothing else in the file
      // says the same digits — see the docblock's line-height story
      if (bare && n !== 1) missing.push({ claim: c.s, file: f, occurrences: n, why: "a units-less claim must be unique in the file, or something unrelated can answer for it" });
    }
  }
  // no document may drop out of the list unnoticed
  const unclaimed = NAMES.filter(n => !CLAIMS.some(c => c.in.includes(n)));

  const BANS = [
    { name: "the eight-fold refinement, asserted",
      re: /refined the metal eight-fold/,
      fires: '<b>Composition alone refined the metal eight-fold</b>: the growth-restriction mechanism',
      spares: "call the gap between them an eight-fold refinement by composition" },
    { name: "the animated grain counts",
      re: /data-count="(?:369|46)"/,
      fires: '<div class="lab"><span>A356 + TiB</span><b data-count="369">0</b></div>',
      spares: '<b data-count="44.7" data-dec="1" data-suffix=" K">44.7 K</b>' },
    { name: "the tour repeating the retracted claim",
      re: /genuinely refines the grains/,
      fires: "mix your own: the growth restriction factor Q it reports genuinely refines the grains here.",
      spares: "Whether Q refines the grains in THIS instrument is a separate question" },
    { name: "the composer's solute set described as closed",
      re: /(?:six base metals|curated solutes|each base's [a-z ]{0,20}solutes)/,
      fires: "pick one of six base metals and one of each base's curated solutes",
      spares: "pick a base (Al/Fe/Ni/Mg/Cu/Zn), add" },
    { name: "the per-solute slider cap presented as physics",
      re: /\b(?:cap|caps)\b[^.]{0,40}\b(?:is|are|sets|set)\b[^.]{0,20}(?:solid )?solubility limit/,
      fires: "each solute's cap is the solubility limit for that pair",
      spares: "The composition ceiling now comes from the diagram rather than from a hand-picked" },
    // Two more front-door claims this milestone retracted, banned for the same
    // reason as the eight-fold one: a retraction with no gate under it is how
    // the eight-fold claim survived a withdrawal, an inversion and a second
    // withdrawal. Neither is a phase-diagram number, and they live here because
    // this is the gate that reads the documents.
    { name: "the hero wordmark claimed as a casting",
      re: /logo is cast by the solver/,
      fires: "A real-time phase-field solidification laboratory in your browser. The logo is cast by the solver.",
      spares: "every crystal on the page is solved live on your GPU" },
    { name: "twin nucleation listed as emergent",
      re: /emergent CET, recalescence, twinning/,
      fires: '<div class="stamp"><b>✓</b>emergent CET, recalescence, twinning</div>',
      spares: "emergent CET, recalescence, twin competition" },
    { name: "the superseded material count",
      re: /\bten (?:qualitative|material) identit/i,
      fires: "- **Materials** — ten qualitative identities (model metal, Al–Cu,",
      spares: "Eleven material identities. Crystal structure picks the dendrite symmetry" },
  ];

  const stale = [];
  const banBroken = [];
  for (const b of BANS) {
    // the fixtures run through the SAME scanner the documents do, so a pattern
    // that the stripping has quietly neutered fails here and not in six months.
    // ".md" is passed deliberately: it is the strictest of the three strippers.
    if (!b.re.test(prose("fixture.md", b.fires))) banBroken.push(`${b.name}: does not fire on its own positive fixture`);
    if (b.re.test(prose("fixture.md", b.spares))) banBroken.push(`${b.name}: fires on the sentence that replaced it`);
    for (const f of NAMES) if (b.re.test(PROSE[f])) stale.push(`${f}: ${b.name}`);
  }

  const ok = missing.length === 0 && stale.length === 0 && banBroken.length === 0
    && unclaimed.length === 0 && CLAIMS.length >= 12 && BANS.length >= 5;
  check("PD-DOC-CONSTANTS", ok, {
    files: NAMES.length, claims: CLAIMS.length, bans: BANS.length,
    quoted: {
      version: PD.PHASE_TABLE_VERSION, alSi: [alSi.Csm, alSi.Cinv, alSi.Tinv], feCinv: feC.Cinv,
      dT0A356: Math.round(A356.dT0), Q: [Math.round(A356TiB.Q), Math.round(lean.Q)],
      liquidusNorm: [tNorm(A356TiB), tNorm(lean)],
      depressionK: [(-A356TiB.dTL).toFixed(1), (-lean.dTL).toFixed(1)],
      materials: Object.keys(M.MATERIALS).length, scenes: Object.keys(T.SCENES).length,
      kRatioAllRows: [kAllLo, kAllHi], kRatioGateEnters: [kGateLo, kGateHi],
    },
    missing, staleClaims: stale, bansBroken: banBroken, filesWithNoClaim: unclaimed,
  });
}


// ---------------------------------------------------------------------------
// PD-LANDING-FIGURE (v7.1 P6, added by its own review) — the front door's Al-Si
// drawing has to BE the row, not merely quote it.
//
// PD-FIGURE-GEOMETRY does this for the composer's figure, where `layout()`
// returns vertices and a gate can compare them. The landing figure has no
// module: it is hand-typed SVG, deliberately, so that phasedata.ts stays out of
// the landing chunk. That decision moved the numbers out of reach of every gate
// — PD-DOC-CONSTANTS checks that "1.65 wt%" and "577 °C" APPEAR, and appearing
// is not placement. Measured on the review's own mutation: moving the marker to
// cx 340 / cy 60 — 10.2 wt% and 74 px off the liquidus it is supposed to sit on
// — left all thirteen browser-free gates green.
//
// So the drawing is re-derived here from the row, through the figure's OWN axis:
// the scale comes from the horizontal axis line's endpoints, never from a
// constant, so internal consistency and agreement with `phasedata.ts` fail
// separately and say which one broke.
//
// It self-tests, on the fires/spares pattern the bans use: the identical parser
// runs a second time over an in-memory copy with the marker displaced, and the
// gate fails if that fixture does NOT produce a violation.
{
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const row = PD.BINARY.al.Si;
  const TmC = M.MATERIALS[A.BASES.al.materialKey].si.Tm - 273.15;

  const audit = src => {
    const bad = [];
    const svg = src.match(/<svg id="pdFig"[\s\S]*?<\/svg>/)?.[0];
    if (!svg) return { bad: ["no <svg id=\"pdFig\"> in index.html"], n: 0 };
    const attr = (tag, name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`));
      return m ? parseFloat(m[1]) : NaN;
    };
    const tags = svg.match(/<(?:line|circle|rect|text)[^>]*>/g) ?? [];
    const byClass = c => tags.filter(t => new RegExp(`class="[^"]*\\b${c}\\b[^"]*"`).test(t));
    const one = c => { const g = byClass(c); if (g.length !== 1) bad.push(`${g.length} elements with class ${c}, expected 1`); return g[0] ?? ""; };

    const axes = byClass("ax");
    const xAxis = axes.find(t => attr(t, "y1") === attr(t, "y2")) ?? "";
    const xL = attr(xAxis, "x1"), xR = attr(xAxis, "x2");
    const liq = one("liq"), sol = one("sol"), csm = one("csm"), drop = one("drop"), dot = one("dot");
    const lean = one("lean"), rich = one("rich");
    const dataC = parseFloat(svg.match(/data-c="([^"]*)"/)?.[1] ?? "");
    const dataCsm = parseFloat(svg.match(/data-csm="([^"]*)"/)?.[1] ?? "");
    const n = tags.length;

    const near = (what, a, b, tol = 0.05) => {
      if (!(Number.isFinite(a) && Number.isFinite(b))) bad.push(`${what}: not a number (${a} vs ${b})`);
      else if (Math.abs(a - b) > tol) bad.push(`${what}: ${a} vs ${b} (${(a - b).toFixed(3)} px)`);
    };
    // the figure's own scale, from its own axis
    const x = c => xL + (xR - xL) * (c / row.Cinv);
    const yLiq = px => attr(liq, "y1") + (attr(liq, "y2") - attr(liq, "y1"))
      * (px - attr(liq, "x1")) / (attr(liq, "x2") - attr(liq, "x1"));

    // 1. the drawing's declared numbers ARE the row's
    if (dataCsm !== row.Csm) bad.push(`data-csm ${dataCsm} is not C_SM ${row.Csm}`);
    const ticks = byClass("tick");
    const tickNums = ticks.map(t => {
      const txt = src.slice(src.indexOf(t) + t.length).match(/^([^<]*)</)?.[1] ?? "";
      return { x: attr(t, "x"), y: attr(t, "y"), v: parseFloat(txt), txt: txt.trim() };
    });
    if (!tickNums.some(t => t.v === row.Cinv)) bad.push(`no axis tick reads C_inv ${row.Cinv}`);
    if (!tickNums.some(t => t.v === row.Tinv)) bad.push(`no axis tick reads T_inv ${row.Tinv}`);
    if (!tickNums.some(t => t.v === Math.round(TmC))) bad.push(`no axis tick reads the melting point ${Math.round(TmC)}`);

    // 2. the solubility line stands at C_SM, top and bottom
    near("solvus x1 at C_SM", attr(csm, "x1"), x(row.Csm));
    near("solvus x2 at C_SM", attr(csm, "x2"), x(row.Csm));
    // 3. the two bands tile the frame and meet exactly on that line
    near("lean band left edge", attr(lean, "x"), xL);
    near("lean band right edge", attr(lean, "x") + attr(lean, "width"), attr(csm, "x1"));
    near("rich band left edge", attr(rich, "x"), attr(csm, "x1"));
    near("rich band right edge", attr(rich, "x") + attr(rich, "width"), xR);
    // 4. THE MARKER. Its composition and its height are separate claims and the
    //    review's mutation broke both.
    near("marker abscissa at data-c", attr(dot, "cx"), x(dataC));
    near("marker sits on the liquidus", attr(dot, "cy"), yLiq(attr(dot, "cx")));
    // 5. the drop line hangs from the marker to the axis
    near("drop line x1 at the marker", attr(drop, "x1"), attr(dot, "cx"));
    near("drop line x2 at the marker", attr(drop, "x2"), attr(dot, "cx"));
    near("drop line starts at the marker", attr(drop, "y1"), attr(dot, "cy"));
    // 6. landing-motion.ts interpolates FROM the solidus origin, so if that
    //    origin ever leaves the liquidus the animated path stops being it
    near("solidus origin shares the liquidus origin (x)", attr(sol, "x1"), attr(liq, "x1"));
    near("solidus origin shares the liquidus origin (y)", attr(sol, "y1"), attr(liq, "y1"));
    near("liquidus starts at c = 0", attr(liq, "x1"), x(0));
    near("liquidus ends at C_inv", attr(liq, "x2"), x(row.Cinv));
    near("solidus ends at C_SM", attr(sol, "x2"), x(row.Csm));
    return { bad, n, dataC, dataCsm };
  };

  const real = audit(html);
  // 7. the three places this page states the pour must agree
  const cta = parseFloat(html.match(/#alloy=al:Si([\d.]+)/)?.[1] ?? "");
  const chip = parseFloat(html.match(/<span class="chip">Si <b>([\d.]+) wt%<\/b><\/span>/)?.[1] ?? "");
  const pourAgrees = real.dataC === cta && real.dataC === chip;
  if (!pourAgrees) real.bad.push(`the pour disagrees across the page: figure ${real.dataC}, chip ${chip}, CTA ${cta}`);

  // the self-test: the same parser, the same assertions, a displaced marker
  const fixture = audit(html.replace(/(<circle class="dot" )cx="[\d.]+" cy="[\d.]+"/, '$1cx="340.0" cy="60.0"'));
  const selfTestFires = fixture.bad.length > 0;

  const ok = real.bad.length === 0 && real.n > 10 && selfTestFires;
  check("PD-LANDING-FIGURE", ok, {
    elementsParsed: real.n, pour: { figure: real.dataC, chip, cta },
    row: { Csm: row.Csm, Cinv: row.Cinv, Tinv: row.Tinv, TmC: +TmC.toFixed(2) },
    violations: real.bad, selfTestFires, selfTestSaw: fixture.bad.slice(0, 2),
    note: "the scale is read off the figure's own axis, so a wrong drawing and a drawing of a wrong row fail separately",
  });
}

// ---------------------------------------------------------------------------
// CI-SCRIPT-COUNT (v7.1 P6) — TESTING.md's stated number of browser-free scripts
// equals the number CI actually runs.
//
// Nothing checked this, and the arc that just ended added six of them. The count
// is DERIVED from ci.yml's own run lines, so the failure mode it closes is the
// real one: a milestone adds a script to the workflow and leaves three sentences
// saying there are twelve.
//
// Liveness on both halves. The derived count must be > 0 — a renamed workflow
// step would otherwise make the comparison vacuous at zero — and the document
// must state it in at least three places, which is how many places state it
// today. A heading rewrite that dropped two of them fails here rather than
// silently reducing this to a one-site check.
{
  const { readFileSync } = await import("node:fs");
  const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty"];
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const testing = readFileSync(new URL("../TESTING.md", import.meta.url), "utf8");
  const runs = [...ci.matchAll(/^[ \t]*-[ \t]*run:[ \t]*node[ \t]+scripts\/(verify-[a-z0-9-]+\.mjs)[ \t]*\r?$/gm)]
    .map(m => m[1]);
  const word = NUM[runs.length];
  // NUMBER WORDS ONLY. A bare /([a-z]+) browser-free scripts/ also matches the
  // sentence in TESTING.md that DESCRIBES this gate, which is a report about the
  // count rather than a statement of it. Both failure modes stay covered: a site
  // left saying "twelve" is a number word and fails on disagreement, and a site
  // reworded out of its number entirely drops the found count under the floor of
  // three, which is how many places state it today.
  const SITE = new RegExp(String.raw`\b(${NUM.join("|")})\s+browser-free\s+scripts\b`, "g");
  const sites = [...testing.matchAll(SITE)].map(m => m[1]);
  const wrong = sites.filter(w => w !== word);
  // FOUR, not three: the tree states it in four places today, and a floor set
  // below what exists lets a site be deleted without anything noticing. The
  // sentence in TESTING.md that used to say "three places" has been changed to
  // stop naming a number this gate already derives.
  const ok = runs.length > 0 && word !== undefined && sites.length >= 4 && wrong.length === 0
    && new Set(runs).size === runs.length;
  check("CI-SCRIPT-COUNT", ok, {
    ciRunLines: runs.length, expectedWord: word, sitesFound: sites.length,
    sitesDisagreeing: wrong, duplicatedRunLines: runs.length - new Set(runs).size,
  });
}


// ---------------------------------------------------------------------------
// TESTING-CHECK-COUNT (v7.1 P6) — where TESTING.md states how many checks a
// script has, it must be how many that script has.
//
// CI-SCRIPT-COUNT one level down, and it exists because the level down was
// where the rot was. An audit of this document during P6 found eight stated
// counts wrong at once: `verify-units.mjs` said eight and had nine,
// `verify-quant.mjs` said ten and had eleven, `verify-3d.mjs` was cited as a
// 23-check suite and prints 30, `EL-DOC-CLAIMS` was described as sixteen claims
// and checks seventeen, `ALLOY-REFUSE-NAMED` as eight input shapes and drives
// fifteen, the element reasons as 31 skeletons and there are 32. Every one of
// those was hand-corrected in this milestone, and hand-correcting eight numbers
// with nothing under them is how there came to be eight.
//
// It counts DISTINCT gate NAMES, not `check(` call sites: `PD-FIGURE-CURSOR`
// appears twice in verify-phasediagram.mjs because one early-return branch
// reports its own failure, and a count of call sites would make the document
// wrong for being right.
//
// Attribution is by BULLET HEADER, not by proximity. `verify-scale3d.mjs`'s
// entry contains the phrase "the full 30-check volume suite", which is a
// cross-reference to a different script; scanning for a nearby number would
// have attributed 29 to scale3d. A bullet is scanned only for the first
// verify-*.mjs named in its own first 160 characters, and only when it states a
// count in words — most entries do not, and silence is not a failure here.
{
  const { readFileSync, existsSync } = await import("node:fs");
  const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty"];
  const testing = readFileSync(new URL("../TESTING.md", import.meta.url), "utf8");
  const RE = new RegExp(String.raw`\b(${NUM.join("|")})\s+checks?\b`, "i");
  const rows = [], bad = [], uncountable = [];
  for (const b of testing.split(/\r?\n- \*\*/).slice(1)) {
    const head = b.slice(0, 160).match(/`(verify-[a-z0-9-]+\.mjs)`/);
    if (!head) continue;
    const cm = b.match(RE);
    if (!cm) continue;
    const script = head[1];
    const url = new URL(`../scripts/${script}`, import.meta.url);
    if (!existsSync(url)) { bad.push({ script, why: "TESTING names a script that does not exist" }); continue; }
    const src = readFileSync(url, "utf8");
    const names = new Set([...src.matchAll(/(?:check|block)\(\s*"([A-Z][A-Z0-9_.\-]*)"/g)].map(x => x[1]));
    const stated = NUM.indexOf(cm[1].toLowerCase());
    // a script that reports through some other helper cannot be counted this
    // way; recorded rather than silently skipped, so the exemption is visible
    if (names.size === 0) { uncountable.push(script); continue; }
    rows.push({ script, stated, actual: names.size });
    if (stated !== names.size) bad.push({ script, stated, actual: names.size });
  }
  // Liveness: this must be reading real entries. Six is below today's ten and
  // above any accident, so a heading rewrite that broke the bullet split fails
  // here rather than passing on an empty list.
  const ok = bad.length === 0 && rows.length >= 6;
  check("TESTING-CHECK-COUNT", ok, {
    sites: rows.length, rows, bad, uncountableByThisIdiom: uncountable,
    note: "distinct gate NAMES, not call sites — PD-FIGURE-CURSOR reports from two branches",
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all phasedata checks passed");
if (failures) process.exitCode = 1;
