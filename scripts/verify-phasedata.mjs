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

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all phasedata checks passed");
if (failures) process.exitCode = 1;
