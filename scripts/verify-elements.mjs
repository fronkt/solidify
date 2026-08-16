// EL-TABLE-SHAPE / EL-TIER-TOTAL / EL-TROUTON-CROSSCHECK / EL-VAPOUR-ADVISORY /
// ALLOY-MOVES-THE-PHYSICS — v7.1 P4's element dataset and tier classifier.
//
// WHAT THIS MILESTONE CLAIMS, AND THEREFORE WHAT IS CHECKED HERE.
//   1. All 118 rows are present, in Z order, and the places where the table
//      looks wrong — a mass that DROPS with Z, a boiling point BELOW a melting
//      point — are the real ones and are enumerated by name.
//   2. Every one of the 6 x 118 = 708 pairs resolves to exactly one tier with a
//      sentence long enough to be a reason, and those sentences do not collapse
//      into one template wearing 708 different element names.
//   3. The vaporisation data is checked against a physical law rather than
//      against itself: Trouton's rule. A decimal slip that turned zinc's
//      115 kJ/mol into 11.5 would leave the vapour rule internally consistent
//      and silently reverse what it teaches, and the fixed-point check
//      originally planned for this slot — p(T_b) = 1 atm — CANNOT SEE IT,
//      because exp(0) = 1 for any enthalpy whatsoever.
//   4. The vapour rule reproduces foundry practice from two tabulated numbers,
//      and it ADVISES rather than refuses: Cu-30Zn computes 1.4 atm and brass
//      is real, so the line names the activity coefficient it does not have.
//   5. Every assessed pair actually moves the physics — and the ones the
//      shipped clamps make invisible to the solver are named rather than
//      quietly counted as passes.
//
// This milestone adds NO new pourable chemistry. ASSESSED is exactly the 25
// pairs that already had a cited coefficient row and a cited invariant row, so
// gate 2's liveness clause is what stops "everything is refused" from passing.
//
//   node scripts/verify-elements.mjs
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
const NAMES = ["EL-TABLE-SHAPE", "EL-TIER-TOTAL", "EL-TROUTON-CROSSCHECK", "EL-VAPOUR-ADVISORY", "ALLOY-MOVES-THE-PHYSICS", "EL-DOC-CLAIMS"];

/**
 * THE MODULE LOAD IS GUARDED, AND verify-regimes.mjs's IS NOT.
 *
 * v7.1 P3 learned that an unwrapped call inside a gate takes the whole file
 * down with zero lines of output, and wrapped every gate in `block()`. Run
 * against the pre-P4 tree this file found the level above: `ssrLoadModule`
 * itself throws when `src/elements.ts` does not exist, before any block runs,
 * and the result was a stack trace and not one gate name. A gate that cannot
 * report looks like a gate nobody ran — and that is precisely the tree a
 * non-vacuity proof is run against, so the hole was in the one place it
 * mattered. Every one of the five names is reported as a FAIL instead.
 */
let E, A, PD;
try {
  E = await server.ssrLoadModule("/src/elements.ts");
  A = await server.ssrLoadModule("/src/alloy.ts");
  PD = await server.ssrLoadModule("/src/phasedata.ts");
} catch (e) {
  for (const n of NAMES) check(n, false, { threw: String(e).split("\n")[0].slice(0, 160), note: "the modules this gate reads do not load on this tree" });
  await server.close();
  console.log(`done — ${failures} FAILED`);
  process.exitCode = 1;
}

const block = (name, fn) => {
  if (!E || !A || !PD) { return; }   // already reported above, once per gate name
  try { fn(); } catch (e) {
    check(name, false, { threw: String(e).slice(0, 160), note: "this gate could not run at all against this tree" });
  }
};
const BASES = Object.keys(A?.BASES ?? {});

// ---------------------------------------------------------------------------
// 1. EL-TABLE-SHAPE — the dataset's own integrity, before anything is computed
//    from it.
//
//    NOT IN THE MILESTONE PLAN'S GATE LIST, and added because the plan's other
//    four all consume this table and none of them would notice a row inserted
//    in the wrong place. The three "this looks like a bug" patterns are all
//    real chemistry and are pinned BY NAME, measured on this tree first: a mass
//    that falls as Z rises (four natural cases and one among the transactinides),
//    a boiling point below a melting point (arsenic, which sublimes), and a
//    missing melting point (carbon and helium, for opposite reasons).
block("EL-TABLE-SHAPE", () => {
  const rows = E.ELEMENTS;
  const why = [];
  if (rows.length !== 118) why.push(`${rows.length} rows, expected 118`);
  const zBad = rows.filter((e, i) => e.Z !== i + 1).map(e => e.symbol);
  if (zBad.length) why.push(`Z out of order at ${zBad.join(",")}`);
  if (Object.keys(E.BY_SYMBOL).length !== 118) why.push(`BY_SYMBOL holds ${Object.keys(E.BY_SYMBOL).length}`);
  if (rows.some(e => !e.source || e.source.length < 40)) why.push("a row carries no usable source");

  // measured, then pinned. Every one is a longest-lived-isotope mass number
  // against a natural-abundance mass, or two isotope mass numbers.
  const MASS_INVERSIONS = ["Ar->K", "Co->Ni", "Te->I", "Th->Pa", "U->Np", "Pu->Am", "Bh->Hs"];
  const inv = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].mass < rows[i - 1].mass) inv.push(`${rows[i - 1].symbol}->${rows[i].symbol}`);
  if (JSON.stringify(inv) !== JSON.stringify(MASS_INVERSIONS)) why.push(`mass inversions moved: ${JSON.stringify(inv)}`);

  // arsenic sublimes at 887 K and only melts at 1090 K under ~3.6 MPa of its
  // own vapour, so this is the one row where Tb < Tm and it is not a typo.
  const tbLt = rows.filter(e => e.Tm != null && e.Tb != null && e.Tb < e.Tm).map(e => e.symbol);
  if (JSON.stringify(tbLt) !== JSON.stringify(["As"])) why.push(`Tb<Tm set moved: ${JSON.stringify(tbLt)}`);
  // carbon has no melting point at 1 atm (it sublimes); helium has none at any
  // temperature below ~2.5 MPa. Both are null on purpose and both say so.
  const noTm = rows.filter(e => e.Tm == null && e.Z <= 99).map(e => e.symbol);
  if (JSON.stringify(noTm) !== JSON.stringify(["He", "C"])) why.push(`null-Tm set below Z=100 moved: ${JSON.stringify(noTm)}`);

  const prim = rows.filter(e => e.primordial).length;
  if (prim !== 83) why.push(`${prim} primordial rows, expected 83`);
  if (rows.some(e => e.Z > 92 && e.primordial)) why.push("a transuranic row claims to be primordial");
  const blocks = rows.reduce((a, e) => (a[e.block] = (a[e.block] || 0) + 1, a), {});
  if (blocks.s !== 14 || blocks.p !== 36 || blocks.d !== 38 || blocks.f !== 30) why.push(`block census ${JSON.stringify(blocks)}`);
  // radiusKind and radiusCN12 must agree about whether there is a radius at all
  const rk = rows.filter(e => (e.radiusCN12 == null) !== (e.radiusKind === "none")).map(e => e.symbol);
  if (rk.length) why.push(`radiusKind disagrees with radiusCN12 at ${rk.join(",")}`);
  // the six bases must all be IN the table, or every size note is null
  const missing = BASES.filter(bk => !E.BY_SYMBOL[A.BASES[bk].symbol]);
  if (missing.length) why.push(`base not in the element table: ${missing.join(",")}`);
  // and the masses the two tables carry for the same element must agree
  const massGap = [];
  for (const bk of BASES) {
    const b = A.BASES[bk];
    const be = E.BY_SYMBOL[b.symbol];
    if (be && Math.abs(be.mass - b.mass) > 0.05) massGap.push(`${b.symbol} ${b.mass} vs ${be.mass}`);
    for (const [el, s] of Object.entries(b.solutes)) {
      const ee = E.BY_SYMBOL[el];
      if (ee && Math.abs(ee.mass - s.mass) > 0.05) massGap.push(`${bk}-${el} ${s.mass} vs ${ee.mass}`);
    }
  }
  if (massGap.length) why.push(`alloy.ts and elements.ts disagree on atomic mass: ${massGap.join("; ")}`);

  // THE RADIUS COLUMN AGAINST A SECOND PHYSICAL QUANTITY, and this check exists
  // because the milestone's own review found a defect that all six gates missed:
  // the CN12 correction was applied to the s-block bcc rows and forgotten on the
  // d-block ones, so V, Cr, Nb, Mo, Ta, W and Ra carried the CN8 nearest-
  // neighbour radius a·√3/4 while the file's source string said they did not.
  // Nothing could see it, because the radii were only ever checked against
  // themselves. This is EL-TROUTON-CROSSCHECK's doctrine applied one column
  // over: tie the number to an independent measurement.
  //
  // The close-packed-equivalent radius from the density,
  //   r = (0.7405 · 3M / (4π · ρ · N_A))^(1/3),
  // reproduces a CN12 metallic radius to a fraction of a per cent for any metal
  // that is actually close-packed, and misses by several per cent for the ones
  // with open or distorted structures — which are enumerated below by name and
  // by measured value rather than exempted as a class. The densities are
  // GATE-LOCAL, the same idiom verify-regimes.mjs uses to carry Pb–Sn: they are
  // a check on the shipped table, not part of it, and they have no business
  // riding in the bundle.
  const RHO = {
    Li: 0.534, Be: 1.85, Na: 0.968, Mg: 1.738, Al: 2.70, K: 0.862, Ca: 1.55,
    Sc: 2.985, Ti: 4.506, V: 6.11, Cr: 7.19, Mn: 7.21, Fe: 7.874, Co: 8.90,
    Ni: 8.908, Cu: 8.96, Zn: 7.14, Ga: 5.91, Rb: 1.532, Sr: 2.64, Y: 4.472,
    Zr: 6.52, Nb: 8.57, Mo: 10.28, Tc: 11.0, Ru: 12.45, Rh: 12.41, Pd: 12.023,
    Ag: 10.49, Cd: 8.65, In: 7.31, Sn: 7.265, Sb: 6.697, Cs: 1.93, Ba: 3.51,
    La: 6.162, Ce: 6.770, Pr: 6.77, Nd: 7.01, Pm: 7.26, Sm: 7.52, Eu: 5.264,
    Gd: 7.90, Tb: 8.23, Dy: 8.540, Ho: 8.79, Er: 9.066, Tm: 9.32, Yb: 6.90,
    Lu: 9.841, Hf: 13.31, Ta: 16.69, W: 19.25, Re: 21.02, Os: 22.59, Ir: 22.56,
    Pt: 21.45, Au: 19.3, Hg: 13.534, Tl: 11.85, Pb: 11.34, Bi: 9.78, Po: 9.20,
    Ra: 5.5, Ac: 10.07, Th: 11.7, Pa: 15.37, U: 19.1, Np: 20.45, Pu: 19.85,
    Am: 12.0, Cm: 13.51, Bk: 14.78, Cf: 15.1, Es: 8.84,
  };
  const NA = 6.02214076e23, PACK = 0.7405;
  const rFromRho = (M, rho) => Math.cbrt(3 * PACK * M / (4 * Math.PI * rho * NA)) * 1e10;
  // measured on this tree, then pinned: every row whose two radii disagree by
  // more than 2 %, with the structural reason. Values are the measured gap in %.
  const OPEN_STRUCTURE = {
    Mn: -3.1,   // alpha-Mn, 58 atoms per cell on four inequivalent sites
    Ga: 7.2,    // orthorhombic alpha-Ga, Ga2 dimers - the least close-packed metal here
    Sn: 4.1,    // white tin, body-centred tetragonal with a 6+2 coordination
    Sb: 9.9,    // rhombohedral A7, puckered layers
    Hg: 3.8,    // the density is the LIQUID's; mercury has no solid at room temperature
    Bi: 8.5,    // rhombohedral A7, the same layered structure as antimony
    Po: 12.7,   // alpha-Po is the only element with a SIMPLE CUBIC structure, packing 0.52 against 0.74
    Pa: 2.1,    // body-centred tetragonal
    Pu: -6.5,   // alpha-Pu, monoclinic with 16 atoms per cell - the least symmetric metal known
    Am: 4.7,    // dhcp; the tabulated radius and density are mutually inconsistent at this level and both are estimates
  };
  const radGap = [], radBad = [];
  for (const e of rows) {
    if (e.radiusKind !== "teatum-cn12" || !Object.hasOwn(RHO, e.symbol)) continue;
    const pct = +(((rFromRho(e.mass, RHO[e.symbol]) / e.radiusCN12) - 1) * 100).toFixed(1);
    radGap.push([e.symbol, pct]);
    if (Math.abs(pct) <= 2) {
      if (Object.hasOwn(OPEN_STRUCTURE, e.symbol)) why.push(`${e.symbol} is pinned as an open-structure outlier but now agrees to ${pct} %`);
      continue;
    }
    if (!Object.hasOwn(OPEN_STRUCTURE, e.symbol)) radBad.push(`${e.symbol} ${pct}% (r ${e.radiusCN12} vs ${rFromRho(e.mass, RHO[e.symbol]).toFixed(1)} from density)`);
    else if (Math.abs(pct - OPEN_STRUCTURE[e.symbol]) > 1.5) radBad.push(`${e.symbol} moved to ${pct}% from a pinned ${OPEN_STRUCTURE[e.symbol]}%`);
  }
  if (radBad.length) why.push(`radius disagrees with the density-derived close-packed radius: ${radBad.join("; ")}`);
  if (radGap.length < 60) why.push(`only ${radGap.length} rows carry both a Teatum radius and a gate-local density`);

  check("EL-TABLE-SHAPE", why.length === 0, {
    rows: rows.length, primordial: prim, blocks,
    massInversions: inv, tbBelowTm: tbLt, noMeltingPoint: noTm,
    why: why.slice(0, 8),
  });
});

// ---------------------------------------------------------------------------
// 2. EL-TIER-TOTAL — totality over 708 pairs.
block("EL-TIER-TOTAL", () => {
  const TIERS = ["ASSESSED", "OUTSIDE-THE-MODEL", "REFUSED-PAIR", "NOT-A-SOLUTE"];
  const why = [];
  const tally = {}, reasonCount = {}, byReasonSkel = {};
  const skelCount = {};
  let pairs = 0, nulls = 0, shortest = Infinity;

  const SYMS = E.ELEMENTS.map(e => e.symbol);
  const LABELS = Object.values(A.BASES).map(b => b.label).sort((a, b) => b.length - a.length);
  /**
   * THE NAIVE DISTINCT-SENTENCE COUNT IS VACUOUS AND THE PLAN ASKED FOR IT.
   * Every refusal interpolates its own element and its own base, so 708 pairs
   * produce 708 distinct strings whether they came from eighteen templates or
   * from one. Measured on this tree the naive count is 422 and the check would
   * pass on a file that said "X is not available in Y" seven hundred times.
   * What is counted instead is the SKELETON: base labels, element symbols and
   * every number replaced, so what survives is the shape of the sentence.
   */
  const skeleton = s => {
    let t = s;
    for (const l of LABELS) t = t.split(l).join("@base");
    t = t.replace(/[A-Z][a-z]?/g, m => (SYMS.includes(m) ? "@el" : m));
    t = t.replace(/-?\d[\d.]*(e[+-]?\d+)?/gi, "#");
    t = t.replace(/@base( and @base)+/g, "@base").replace(/@el([–-]@el)+/g, "@el");
    t = t.replace(/(@base, )+@base/g, "@base").replace(/(@el, )+@el/g, "@el");
    return t.replace(/\s+/g, " ").trim();
  };

  for (const bk of BASES) {
    for (const e of E.ELEMENTS) {
      pairs++;
      const w = E.probeWt(bk, e.symbol);
      const a = E.admit(bk, e.symbol, w);
      if (!a) { nulls++; continue; }
      // exactly one tier: the type is a union, so the test that means something
      // is that the tier is one of the four AND is the one its reason maps to
      if (!TIERS.includes(a.tier)) why.push(`${bk}-${e.symbol} tier ${a.tier}`);
      const t2 = E.admit(bk, e.symbol, w)?.tier;
      if (t2 !== a.tier) why.push(`${bk}-${e.symbol} is not deterministic`);
      tally[a.tier] = (tally[a.tier] || 0) + 1;
      reasonCount[a.reason] = (reasonCount[a.reason] || 0) + 1;
      const sk = skeleton(a.sentence);
      skelCount[sk] = (skelCount[sk] || 0) + 1;
      (byReasonSkel[a.reason] ??= new Set()).add(sk);
      if (a.tier !== "ASSESSED") {
        if (!a.sentence || a.sentence.length <= 25) why.push(`${bk}-${e.symbol} reason is ${a.sentence?.length ?? 0} chars`);
        shortest = Math.min(shortest, a.sentence.length);
      }
      // Every advisory line carries its own computed pressure in atm — and a
      // line that has NO pressure must say which of the four reasons applies
      // and must not print a number anyway. The four: the element has no
      // measured Tb/ΔH_vap; its vapour is molecular, so the per-atom enthalpy
      // this table stores is the wrong basis for Clausius–Clapeyron; the weight
      // handed in was not a composition; or the base's melting point is above
      // the element's CRITICAL temperature, where no liquid–vapour equilibrium
      // exists to have a pressure (mercury over liquid iron, the one such cell).
      if (a.vapour && a.vapour.band !== "NO-DATA") {
        if (!/ atm/.test(a.vapour.text)) why.push(`${bk}-${e.symbol} vapour line has no atm`);
      } else if (a.vapour) {
        const says = /has been measured|molecular rather than monatomic|is not a number|is not a composition|that weight is infinite|no melting point|critical temperature/.test(a.vapour.text);
        if (!says) why.push(`${bk}-${e.symbol} NO-DATA vapour line does not say why: ${a.vapour.text.slice(0, 60)}`);
        if (/ atm/.test(a.vapour.text)) why.push(`${bk}-${e.symbol} prints a pressure it could not compute`);
      }
    }
  }
  if (nulls) why.push(`${nulls} pairs returned null`);
  if (pairs !== 708) why.push(`${pairs} pairs, expected 708`);

  const distinct = Object.keys(skelCount).length;
  if (distinct < 12) why.push(`only ${distinct} distinct sentence skeletons`);
  // A FLOOR ON THE COUNT IS NOT A CEILING ON THE CONCENTRATION. 31 skeletons
  // still permits one of them to own the grid, so the share of the largest is
  // bounded too: measured at 294 of 708 (41.5 %), pinned at half.
  const biggest = Math.max(...Object.values(skelCount));
  if (biggest > pairs * 0.5) why.push(`one sentence shape covers ${biggest} of ${pairs} pairs`);
  // A refusal naming the WRONG mechanism is a wrong statement, not an absent
  // one, so two different reasons may never print the same sentence shape.
  const shared = [];
  for (const [r1, s1] of Object.entries(byReasonSkel))
    for (const [r2, s2] of Object.entries(byReasonSkel))
      if (r1 < r2) for (const s of s1) if (s2.has(s)) shared.push(`${r1}/${r2}`);
  if (shared.length) why.push(`reasons share a sentence shape: ${[...new Set(shared)].join(",")}`);
  // named explicitly by the plan, because these two are the pair most likely to
  // be collapsed by someone tidying up
  const na = E.admit("cu", "Nb", 1), nc = E.admit("cu", "Pb", 1) && E.admit("ni", "Pb", 1);
  if (!na || !nc || na.sentence === nc.sentence) why.push("NO-ASSESSMENT and NOT-CHECKED-FOR-DEMIXING are the same string");
  if (na.reason !== "NO-ASSESSMENT" || nc.reason !== "NOT-CHECKED-FOR-DEMIXING") why.push(`reason probe landed wrong: ${na.reason}/${nc.reason}`);

  // NOT-A-SOLUTE is claimed to be base-independent — assert it rather than
  // trusting the comment, across all six bases and both fields.
  const varies = E.ELEMENTS.filter(e => {
    const rs = new Set(BASES.map(bk => E.admit(bk, e.symbol, 1)?.reason));
    const ts = new Set(BASES.map(bk => E.admit(bk, e.symbol, 1)?.tier));
    return ts.has("NOT-A-SOLUTE") && (ts.size > 1 || rs.size > 1);
  }).map(e => e.symbol);
  if (varies.length) why.push(`NOT-A-SOLUTE varies with the base at ${varies.join(",")}`);

  // LIVENESS. Without this the gate passes on a classifier that refuses
  // everything, which is the failure mode a milestone whose content is 683
  // refusals is most exposed to.
  const cited = [];
  for (const bk of BASES) for (const [el, s] of Object.entries(A.BASES[bk].solutes))
    if (s.source && s.source.trim() && PD.BINARY[bk]?.[el]) cited.push(`${bk}-${el}`);
  if ((tally.ASSESSED ?? 0) !== cited.length) why.push(`${tally.ASSESSED} assessed against ${cited.length} pairs holding both a cited coefficient row and a cited invariant row`);
  for (const bk of BASES) {
    const n = E.ELEMENTS.filter(e => E.admit(bk, e.symbol, E.probeWt(bk, e.symbol))?.tier === "ASSESSED").length;
    if (n <= 0) why.push(`base ${bk} admits nothing`);
  }
  // and the other three tiers are non-empty too, or a tier is a comment
  for (const t of TIERS) if (!(tally[t] > 0)) why.push(`tier ${t} has no members`);

  // ADMISSION AND POUR MAY NOT DISAGREE. Every one of the 708 is driven through
  // derive() as well: a pair is ASSESSED here if and only if derive() accepts
  // it there, over the whole table rather than at one convenient point.
  const disagree = [];
  for (const bk of BASES) for (const e of E.ELEMENTS) {
    const w = E.probeWt(bk, e.symbol);
    const a = E.admit(bk, e.symbol, w);
    const d = A.derive({ base: bk, wt: { [e.symbol]: w } });
    const poured = d.refusals.length === 0 && d.totalWt > 0;
    if (poured !== (a?.tier === "ASSESSED")) disagree.push(`${bk}-${e.symbol} admit=${a?.tier} poured=${poured}`);
  }
  if (disagree.length) why.push(`admit and derive disagree: ${disagree.slice(0, 5).join("; ")}`);

  // PAST-THE-INVARIANT is unreachable at the probe compositions by design, so
  // it is driven at the boundary as well, and every line must carry its own
  // wt% and its own ceiling.
  let pastSeen = 0;
  for (const bk of BASES) for (const el of Object.keys(A.BASES[bk].solutes)) {
    const b = A.soluteBound(bk, el);
    if (b?.ceiling == null) continue;
    for (const w of [b.ceiling, +(b.ceiling + b.step).toFixed(4)]) {
      const a = E.admit(bk, el, w);
      pastSeen++;
      if (a?.reason !== "PAST-THE-INVARIANT") { why.push(`${bk}-${el} at ${w} is ${a?.reason}`); continue; }
      if (!a.sentence.includes(`${w} wt%`)) why.push(`${bk}-${el} past-the-invariant line omits its own ${w} wt%`);
      if (!a.sentence.includes(`${b.ceiling} wt%`)) why.push(`${bk}-${el} past-the-invariant line omits the ceiling`);
    }
  }
  if (pastSeen < 40) why.push(`only ${pastSeen} boundary probes`);

  // A WEIGHT THAT IS NOT A COMPOSITION. derive() refuses a non-finite, a
  // negative and an over-100 weight by name, and the first version of this
  // classifier carried only the ceiling test while its docblock promised
  // agreement with derive() — so admit("fe","Cr",NaN) came back ASSESSED and
  // its advisory read "Cr at NaN wt% exerts 0.0e+0 atm, which is negligible".
  // Found by review, not by this gate, because this gate drove only the probe
  // weights. It drives the bad ones now.
  for (const [bk, el] of [["fe", "Cr"], ["al", "Si"], ["cu", "Sn"]]) {
    for (const w of [NaN, Infinity, -1, 101]) {
      const a = E.admit(bk, el, w);
      if (a?.reason !== "NOT-A-COMPOSITION") why.push(`${bk}-${el} at ${w} is ${a?.reason}`);
      if (a && /NaN|undefined|Infinity/.test(a.vapour?.text ?? "")) why.push(`${bk}-${el} at ${w} prints a non-number in its advisory`);
      const d = A.derive({ base: bk, wt: { [el]: w } });
      if (Number.isFinite(w) && w !== 0 && d.refusals.length === 0) why.push(`derive accepted ${w} wt% ${el}`);
    }
  }

  check("EL-TIER-TOTAL", why.length === 0, {
    pairs, tally, reasons: reasonCount,
    distinctSkeletons: distinct, largestSkeleton: Math.max(...Object.values(skelCount)),
    shortestReason: shortest, boundaryProbes: pastSeen,
    why: why.slice(0, 8),
  });
});

// ---------------------------------------------------------------------------
// 3. EL-TROUTON-CROSSCHECK — the vaporisation data against a physical law.
//
//    THE ORIGINALLY PLANNED CHECK FOR THIS SLOT WAS A TAUTOLOGY. p(T_b) = 1 atm
//    is exp(0) = 1 for ANY enthalpy, so a zinc row carrying 11.5 kJ/mol instead
//    of 115 would have passed it while turning 59 atm over liquid iron into
//    1.5 atm and reversing what the number teaches.
//
//    Trouton's rule — ΔH_vap/T_b ≈ 85-110 J/mol·K — is a real constraint that
//    ties the two numbers together, and it is not obeyed by everything: 53 of
//    the 96 rows carrying both fields fall outside the window, for four
//    reasons that are physics rather than error. They are pinned BY VALUE, not
//    merely by name, so a decimal slip inside the enumerated set fails too, and
//    every one of them is required to explain itself in its own source string.
block("EL-TROUTON-CROSSCHECK", () => {
  const LO = 85, HI = 110, TOL = 1.5;
  // measured on this tree at v7.1 P4, then pinned. J/mol·K.
  const OUTSIDE = {
    H: 22.3, He: 19.6, Li: 84.2, B: 114.3, C: 182.6, N: 36.1, O: 37.8, F: 38.5,
    Ne: 63.2, Na: 84.3, P: 22.4, S: 62.7, Cl: 42.7, Ar: 73.7, K: 76.6,
    Ti: 119.4, V: 123.1, Cr: 115.1, Co: 117.8, Ni: 119.0, As: 39.2, Br: 44.6,
    Kr: 75.7, Rb: 71.8, Zr: 126.2, Nb: 137.5, Mo: 121.7, Tc: 145.4, Ru: 134.5,
    Rh: 124.2, Pd: 110.6, I: 45.7, Xe: 76.1, Cs: 69.9, Ba: 66.1, Gd: 84.9,
    Tb: 111.6, Lu: 112.7, Hf: 132.9, Ta: 129.6, W: 138.3, Re: 120.0, Os: 128.3,
    Ir: 120.0, Pt: 124.5, Po: 83.3, Rn: 77.5, Ra: 56.2, Ac: 115.2, Pa: 111.9,
    Np: 78.6, Am: 82.8, Cf: 112.4,
  };
  const why = [];
  let carry = 0, inside = 0;
  const seen = new Set();
  for (const e of E.ELEMENTS) {
    if (e.Tb == null || e.dHvap == null) {
      if (e.Tb != null || e.dHvap != null) why.push(`${e.symbol} carries one of Tb/dHvap and not the other`);
      continue;
    }
    carry++;
    const s = e.dHvap * 1000 / e.Tb;
    const pinned = Object.hasOwn(OUTSIDE, e.symbol);
    if (pinned) seen.add(e.symbol);
    if (s >= LO && s <= HI) {
      inside++;
      if (pinned) why.push(`${e.symbol} is inside the window at ${s.toFixed(1)} but is pinned as an outlier`);
      continue;
    }
    if (!pinned) { why.push(`${e.symbol} is outside Trouton at ${s.toFixed(1)} and is not enumerated`); continue; }
    if (Math.abs(s - OUTSIDE[e.symbol]) > TOL) why.push(`${e.symbol} moved: ${s.toFixed(1)} against the pinned ${OUTSIDE[e.symbol]}`);
    // and it has to say why, in its own row, or the list rots into an unread
    // allow-list that swallows the next genuine error
    // NOT a bare substring test for the prefix: a row could carry "TROUTON:"
    // and nothing after it and pass. The clause must name a mechanism this file
    // recognises AND be long enough to be an explanation.
    const cl = /TROUTON:([\s\S]*)$/.exec(e.source);
    const body = cl ? cl[1] : "";
    if (!cl) why.push(`${e.symbol} is an enumerated outlier with no TROUTON: clause in its own source`);
    else if (body.trim().length < 80) why.push(`${e.symbol}'s TROUTON: clause is ${body.trim().length} chars — too short to be an explanation`);
    else if (!/quantum|boils low|BOILS LOW|molecule|molecular|dimer|sublimation|SUBLIMATION|estimate|window|compilation|constrained/i.test(body)) why.push(`${e.symbol}'s TROUTON: clause names no recognised mechanism`);
  }
  // THE SKIPPED ROWS ARE NAMED, not silently passed over: 22 rows carry neither
  // T_b nor dH_vap, and every one of them is an element with no bulk
  // metallurgy. If a row that DOES have measurements ever loses them, this
  // count moves and the gate says so rather than quietly checking less.
  const neither = E.ELEMENTS.filter(e => e.Tb == null && e.dHvap == null);
  if (neither.length !== 22) why.push(`${neither.length} rows carry neither Tb nor dHvap, expected 22`);
  if (neither.some(e => e.primordial)) why.push(`a PRIMORDIAL row carries no vaporisation data: ${neither.filter(e => e.primordial).map(e => e.symbol).join(",")}`);
  const stale = Object.keys(OUTSIDE).filter(s => !seen.has(s));
  if (stale.length) why.push(`pinned outliers no longer in the table: ${stale.join(",")}`);
  if (carry <= 80) why.push(`only ${carry} rows carry both Tb and dHvap`);
  if (inside < 20) why.push(`only ${inside} rows are inside the window — the check has stopped constraining anything`);
  check("EL-TROUTON-CROSSCHECK", why.length === 0, {
    carryBoth: carry, insideWindow: inside, enumeratedOutliers: Object.keys(OUTSIDE).length,
    window: [LO, HI], tolerance: TOL, why: why.slice(0, 8),
  });
});

// ---------------------------------------------------------------------------
// 4. EL-VAPOUR-ADVISORY — the four foundry tripwires, and the direction that
//    would be a bug.
block("EL-VAPOUR-ADVISORY", () => {
  const why = [];
  // MEASURED ON THIS TREE FIRST, THEN PINNED — and every one reproduces the
  // number the milestone plan quoted from the literature before any of this
  // was written, which is the strongest thing that can be said for the two
  // tabulated numbers behind it.
  const PINNED = [
    ["fe", "Zn", 59.39, "zinc-coated scrap fumes off as ZnO in a steel charge"],
    ["fe", "Mg", 16.35, "nodularising ductile iron is a plunge, not a stir"],
    ["fe", "Mn", 0.0373, "a welding-fume hazard, and correctly not a refusal"],
    ["al", "Hg", 39.25, "mercury cannot be held in an aluminium melt"],
  ];
  for (const [bk, el, want, note] of PINNED) {
    const v = E.vapourAt(bk, el, 1);
    if (!v) { why.push(`${bk}-${el} has no vapour advisory at all`); continue; }
    const rel = Math.abs(v.pPure - want) / want;
    if (rel > 0.01) why.push(`${bk}-${el} pure-element pressure moved: ${v.pPure.toFixed(4)} against the pinned ${want} (${note})`);
    if (!/ atm/.test(v.text)) why.push(`${bk}-${el} advisory does not print a pressure`);
  }
  // The band boundaries are what turn a number into advice, so they are
  // asserted rather than assumed — at the COMPOSITION each claim is about,
  // which the first draft of this gate got wrong in a way worth recording.
  // "Zinc reads 59 atm over liquid iron" is the PURE element meeting the melt,
  // which is what a galvanised coating is; at 1 wt% dissolved the same rule
  // reads 0.51 atm, which is a fume and not a boil, and asserting BOILS there
  // failed correctly. Both are printed, because both are true and they teach
  // different things. wt = 100 is exactly x = 1 by construction.
  const bands = {
    "fe/Zn@100": E.vapourAt("fe", "Zn", 100).band,   // pure zinc into a steel charge
    "fe/Zn@1": E.vapourAt("fe", "Zn", 1).band,       // one per cent, dissolved
    "fe/Mn@100": E.vapourAt("fe", "Mn", 100).band,   // the welding-arc case
    "fe/Mn@1": E.vapourAt("fe", "Mn", 1).band,       // manganese steel, which is fine
    "ni/W@1": E.vapourAt("ni", "W", 1).band,
  };
  if (bands["fe/Zn@100"] !== "BOILS") why.push(`pure zinc over iron is ${bands["fe/Zn@100"]}`);
  if (bands["fe/Zn@1"] !== "FUME") why.push(`1 wt% zinc in iron is ${bands["fe/Zn@1"]}`);
  if (bands["fe/Mn@100"] !== "FUME") why.push(`pure manganese over iron is ${bands["fe/Mn@100"]}`);
  if (bands["fe/Mn@1"] !== "NEGLIGIBLE") why.push(`1 wt% manganese in iron is ${bands["fe/Mn@1"]}`);
  if (bands["ni/W@1"] !== "NEGLIGIBLE") why.push(`tungsten over nickel is ${bands["ni/W@1"]}`);
  // AND THE BOUNDARIES THEMSELVES, which five hand-picked points do not test.
  // Both thresholds are driven from each side by bisecting on composition, so a
  // moved band edge fails here rather than surviving because the five sample
  // points all sat comfortably inside their bands.
  const bandAt = (bk, el, w) => E.vapourAt(bk, el, w)?.band;
  for (const [bk, el, lo, hi, want, other] of [
    ["fe", "Zn", 0, 100, "FUME", "BOILS"],       // crosses 1 atm somewhere in between
    ["fe", "Mn", 0, 100, "NEGLIGIBLE", "FUME"],  // crosses 0.01 atm
  ]) {
    let a = lo, b = hi;
    for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (bandAt(bk, el, m) === want) a = m; else b = m; }
    if (bandAt(bk, el, a) !== want || bandAt(bk, el, b) !== other) why.push(`${bk}-${el} band edge did not bisect: ${bandAt(bk, el, a)}/${bandAt(bk, el, b)}`);
    const pa = E.vapourAt(bk, el, a).p, pb = E.vapourAt(bk, el, b).p;
    if (!(pb > pa)) why.push(`${bk}-${el} pressure is not monotone across its band edge`);
  }

  // THE DIRECTION THAT WOULD BE A BUG. Applied as a refusal this rule refuses
  // brass, so the assertion is that it does not: Cu-30Zn computes above one
  // atmosphere, is NOT refused, and its line names the missing number.
  const brass = E.vapourAt("cu", "Zn", 30);
  const adm = E.admit("cu", "Zn", 30);
  if (!(brass.p > 1)) why.push(`Cu-30Zn computes ${brass.p} atm, so the case the rule must survive is not live`);
  if (adm.tier !== "ASSESSED") why.push(`Cu-30Zn is ${adm.tier} — the vapour rule has become a refusal`);
  if (!/activity coefficient/.test(brass.text)) why.push("the Cu-30Zn line does not name the activity coefficient it lacks");
  if (!/1.4 atm/.test(brass.text)) why.push("the Cu-30Zn line does not carry its own computed pressure");
  // and no pair anywhere may be refused BECAUSE of vapour pressure: the tier
  // set contains no such reason, asserted over the whole table.
  const tiers = new Set();
  for (const bk of BASES) for (const e of E.ELEMENTS) tiers.add(E.admit(bk, e.symbol, 1)?.reason);
  if ([...tiers].some(r => /VAPOU?R|BOIL/i.test(String(r)))) why.push("a vapour-pressure refusal reason exists");

  // WHAT THE TEMPERATURE CHOICE COSTS, measured rather than asserted. The rule
  // evaluates at the pure base's melting point because 93 of the 118 columns
  // have no coefficient row to depress a liquidus with. Recomputing every
  // assessed pair at its own depressed liquidus bounds the error that costs.
  let worst = null, worstLive = null;
  for (const bk of BASES) for (const el of Object.keys(A.BASES[bk].solutes)) {
    const w = E.probeWt(bk, el);
    const d = A.derive({ base: bk, wt: { [el]: w } });
    const a = E.vapourAt(bk, el, w), b = E.vapourAt(bk, el, w, a.T + d.dTL);
    if (!Number.isFinite(a.p) || !Number.isFinite(b.p) || a.p <= 0) continue;
    const rel = Math.abs(b.p - a.p) / a.p;
    if (!worst || rel > worst.rel) worst = { pair: `${bk}-${el}`, rel: +rel.toFixed(3), p: a.p.toExponential(2) };
    if (a.p >= 0.01 && (!worstLive || rel > worstLive.rel)) worstLive = { pair: `${bk}-${el}`, rel: +rel.toFixed(3), p: a.p.toExponential(2) };
  }
  // MEASURED, THEN PINNED — and the first draft of this comment quoted 25 %
  // from a scratch probe that divided by max(p, 1e-12), which floors the
  // denominator and understates exactly the pairs where the shift is largest.
  // The honest numbers: the worst case is Fe-C at 42 %, because carbon's
  // 715 kJ/mol against a 20.7 K liquidus depression is a big exponent, and it
  // lands on a pressure of 1e-13 atm where a factor of two changes nothing.
  // Restricted to pairs the advisory could actually influence a decision about
  // — anything at or above the 0.01 atm fume threshold — the largest shift is
  // 3 %, on Cu-Zn. That is the number that matters and it is the tighter pin.
  if (!worst || worst.rel > 0.50) why.push(`the liquidus-vs-melting-point shift grew to ${worst?.rel}`);
  if (worstLive && worstLive.rel > 0.05) why.push(`the shift now reaches ${worstLive.rel} on a pair inside the fume band (${worstLive.pair})`);

  check("EL-VAPOUR-ADVISORY", why.length === 0, {
    pinned: PINNED.map(([b, e, p]) => `${b}-${e}=${p}atm`), bands,
    brass: { p: +brass.p.toFixed(3), tier: adm.tier },
    largestLiquidusShift: worst, largestInsideFumeBand: worstLive ?? "none above 0.01 atm",
    why: why.slice(0, 8),
  });
});

// ---------------------------------------------------------------------------
// 5. ALLOY-MOVES-THE-PHYSICS — every assessed pair changes something, and the
//    ones the shipped clamps swallow are NAMED rather than counted as passes.
//
//    The replacement for the bundle-delta metric this arc deleted. The claim is
//    about the UNCLAMPED sums, because that is where the chemistry is: c0,
//    mLiq and kPart are clamped into ranges that keep growth watchable, and a
//    trace addition can move the physics by 18 K of growth restriction while
//    moving all three of them by exactly zero. That is a finding about the
//    solver's ranges, not a failure of the addition, and printing it is the
//    honest form of this gate.
block("ALLOY-MOVES-THE-PHYSICS", () => {
  const why = [], swallowed = [], moved = [];
  // measured over the assessed set BEFORE the floor was chosen: the smallest
  // liquidus movement any assessed pair makes at its probe composition is
  // 1.0 K (Fe-Cr and Ni-W), and the smallest |Q| is exactly 0 (Ni-Cr, whose
  // k is 1 by construction — no partition, no growth restriction). So the
  // floor is on the liquidus, at half the measured minimum, and Q is checked
  // for being a number rather than for being large.
  const FLOOR_K = 0.5;
  let tested = 0;
  for (const bk of BASES) for (const el of Object.keys(A.BASES[bk].solutes)) {
    const a = E.admit(bk, el, E.probeWt(bk, el));
    if (a?.tier !== "ASSESSED") { why.push(`${bk}-${el} is not assessed at its own probe composition`); continue; }
    tested++;
    const w = a.wt;
    const s = A.BASES[bk].solutes[el];
    const d = A.derive({ base: bk, wt: { [el]: w } });
    const p0 = A.derive({ base: bk, wt: {} }).params, p1 = d.params;
    if (!(Math.abs(s.m * w) > 0)) why.push(`${bk}-${el} contributes |m·c| = 0`);
    if (!(Math.abs(d.dTL) >= FLOOR_K)) why.push(`${bk}-${el} moves the liquidus by ${d.dTL.toFixed(3)} K, under the ${FLOOR_K} K floor`);
    if (!Number.isFinite(d.Q)) why.push(`${bk}-${el} has a non-finite Q`);
    if (d.refusals.length) why.push(`${bk}-${el} was refused at its own probe composition`);
    // the solute field the solver actually integrates: c0, the dimensionless
    // liquidus slope, and the partition. dSol is deliberately NOT in this
    // triple — it moves for any solute whose dRel differs from 1 whatever its
    // m, k or c, so it would mask exactly the case this report exists to find.
    const triple = Math.max(Math.abs(p1.c0 - p0.c0), Math.abs(p1.mLiq - p0.mLiq), Math.abs(p1.kPart - p0.kPart));
    const rec = { pair: `${bk}-${el}`, wt: w, dTL: +d.dTL.toFixed(3), Q: +d.Q.toFixed(3), bundle: +triple.toFixed(4) };
    (triple === 0 ? swallowed : moved).push(rec);
  }
  // NOT a recount of the same predicate, which is what the first version did:
  // `tested` and `assessed` were both "pairs admit() calls ASSESSED", so the
  // comparison was a tautology that could not fire. The independent quantity is
  // the number of pairs holding a cited coefficient row AND a cited invariant
  // row, read straight out of the two shipped tables without asking admit().
  let cited = 0;
  for (const bk of BASES) for (const [el, so] of Object.entries(A.BASES[bk].solutes))
    if (so.source && so.source.trim() && PD.BINARY[bk]?.[el]) cited++;
  if (tested !== cited) why.push(`${tested} pairs tested against ${cited} carrying both a cited coefficient row and a cited invariant row`);
  if (tested !== 25) why.push(`${tested} assessed pairs, expected 25`);
  // measured, then pinned: exactly two pairs are invisible to the solver at
  // trace level, and both are grain refiners whose whole point is that a tiny
  // addition does something large. Al-Ti moves the liquidus 2.3 K and Q by
  // 18.4 K at 0.075 wt%, and moves c0, mLiq and kPart by 0.0000.
  // A NONZERO TEST PER PAIR IS NOT A DRIFT TRIPWIRE: every coefficient in
  // alloy.ts could move together and each pair would still be individually
  // nonzero. The TOTALS over the assessed set are pinned, measured on this
  // tree, so a change to any single m or k fails here as well as wherever else
  // it lands. 0.5 % either way, which is far tighter than any real edit.
  const SUM_DTL = 137.2735, SUM_Q = 103.8506;
  let sumDTL = 0, sumQ = 0;
  for (const r of [...moved, ...swallowed]) { sumDTL += Math.abs(r.dTL); sumQ += Math.abs(r.Q); }
  if (Math.abs(sumDTL - SUM_DTL) > SUM_DTL * 0.005) why.push(`sum |dTL| over the assessed set moved: ${sumDTL.toFixed(4)} against the pinned ${SUM_DTL}`);
  if (Math.abs(sumQ - SUM_Q) > SUM_Q * 0.005) why.push(`sum |Q| over the assessed set moved: ${sumQ.toFixed(4)} against the pinned ${SUM_Q}`);
  const SWALLOWED = ["al-Ti", "mg-Zr"];
  const got = swallowed.map(s => s.pair).sort();
  if (JSON.stringify(got) !== JSON.stringify(SWALLOWED)) why.push(`the clamp-swallowed set moved: ${JSON.stringify(got)}`);
  if (!(moved.length > 0)) why.push("no assessed pair moves the bundle at all — the comparator is dead");

  console.log("CLAMP-SWALLOWS", JSON.stringify(swallowed));
  check("ALLOY-MOVES-THE-PHYSICS", why.length === 0, {
    tested, floorK: FLOOR_K, clampSwallowed: got,
    smallestLiquidusMove: Math.min(...[...moved, ...swallowed].map(r => Math.abs(r.dTL))),
    why: why.slice(0, 8),
  });
});

// ---------------------------------------------------------------------------
// 6. EL-DOC-CLAIMS — the honesty page's new paragraphs, gated by the commit
//    that writes them.
//
//    PD-DOC-CALIBRATION's mechanics one file over: every value is RECOMPUTED
//    from the modules and then required to appear, as written, in the prose.
//    Two departures from that gate, both deliberate. HTML tags are stripped
//    first, because these claims are set with <b> inside them and a raw
//    substring test would fail on typography rather than on physics. And no
//    claim here is a bare small integer: "the ceiling binds for 5 pairs" is
//    satisfied by any document containing the character 5, a lesson this repo
//    already wrote down at P3 — so each claim below carries enough of its own
//    sentence to be evidence.
// EL-DOC-CLAIMS was the one gate NOT inside block(), which review pointed out
// is exactly backwards: it is the block most likely to throw, because it is the
// only one that touches the filesystem. A missing science/index.html would have
// taken the whole script down after five OKs.
block("EL-DOC-CLAIMS", () => {
  const raw = readFileSync(new URL("../science/index.html", import.meta.url), "utf8");
  // Tags out, entities back, typographic dashes flattened. The prose sets
  // en-dashes in "Cu–30Zn" and "solute–solute" and U+2212 minus signs in its
  // numbers, and the code emits ASCII hyphens; without this the gate would be a
  // typography check wearing a physics gate's name — which is the same note
  // PD-DOC-CALIBRATION carries, and it needed one more character class here.
  const html = raw
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ");
  const nEl = E.ELEMENTS.length, nB = BASES.length;
  const tierOf = (bk, sym) => E.admit(bk, sym, E.probeWt(bk, sym))?.tier;
  const assessed = BASES.reduce((n, bk) => n + E.ELEMENTS.filter(e => tierOf(bk, e.symbol) === "ASSESSED").length, 0);
  const notASolute = E.ELEMENTS.filter(e => tierOf("al", e.symbol) === "NOT-A-SOLUTE").length;
  const notPrim = E.ELEMENTS.filter(e => !e.primordial).length;
  const soluteSyms = new Set(BASES.flatMap(bk => Object.keys(A.BASES[bk].solutes)));
  const feC = E.sizeNote("fe", "C");
  const p = (bk, el, wt) => E.vapourAt(bk, el, wt).p;
  const fmt = x => (x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x >= 1e-3 ? x.toFixed(3) : x.toExponential(1));
  let liveShift = 0;
  for (const bk of BASES) for (const el of Object.keys(A.BASES[bk].solutes)) {
    const w = E.probeWt(bk, el), d = A.derive({ base: bk, wt: { [el]: w } });
    const a = E.vapourAt(bk, el, w), b = E.vapourAt(bk, el, w, a.T + d.dTL);
    if (a.p >= 0.01 && Number.isFinite(b.p)) liveShift = Math.max(liveShift, Math.abs(b.p - a.p) / a.p);
  }
  const CLAIMS = [
    ["pair count", `${nB} × ${nEl} = ${nB * nEl}`],
    ["assessed count", `Exactly ${assessed} are ASSESSED`],
    ["refusal count", `The other ${nB * nEl - assessed} are the content`],
    ["base-independent refusals", `${notASolute} elements are refused before the base is even consulted`],
    ["non-primordial count", `the ${notPrim} elements that are not primordial`],
    ["elements carrying a coefficient row", `only ${soluteSyms.size} of the ${nEl} elements carry a coefficient row`],
    ["Zn over liquid Fe", `zinc reads ${fmt(p("fe", "Zn", 100))} atm`],
    ["Mg over liquid Fe", `magnesium ${fmt(p("fe", "Mg", 100))} atm`],
    ["Hg over liquid Al", `mercury ${fmt(p("al", "Hg", 100))} atm`],
    ["Mn over liquid Fe", `manganese ${fmt(p("fe", "Mn", 100))} atm`],
    ["Cu-30Zn", `Cu-30Zn computes ${fmt(p("cu", "Zn", 30))} atm and brass is real`],
    ["liquidus-vs-Tm cost", `moves the answer by at most ${Math.round(liveShift * 100)} %`],
    ["Fe-C size factor", `it returns a meaningless ${feC.dRpct.toFixed(1)} %`],
    ["Hagg ratio for Fe-C", `Fe-C's ${feC.hagg.toFixed(3)} sits just`],
    ["Hagg limit", `r/R < ${E.HAGG_LIMIT}`],
    // BOUNDED ON BOTH SIDES, because a bare joined list is satisfied by any
    // PREFIX of itself: dropping fe-Ag from the table would leave
    // "cu-Pb, al-Bi, al-In, al-Pb", which `html.includes` still finds inside the
    // five-item sentence. The claim carries the words on either side of the
    // list, so a shortened list fails and a lengthened one fails too. The count
    // is gated as the word the prose actually sets.
    ["checked monotectics", `name - ${Object.keys(E.DEMIX_CHECKED).join(", ")} - and`],
    ["monotectic count", `${["zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][Object.keys(E.DEMIX_CHECKED).length] ?? "?"} monotectic systems have been`],
  ];
  const missing = CLAIMS.filter(([, v]) => !html.includes(v.replace(/\s+/g, " "))).map(([k, v]) => `${k}: "${v}"`);
  const sectionPresent = /opens onto the whole periodic table/.test(html)
    && /zero solute-solute interaction/.test(html);
  const allFinite = CLAIMS.every(([, v]) => !/NaN|Infinity|undefined|null/.test(v));
  check("EL-DOC-CLAIMS", missing.length === 0 && sectionPresent && allFinite && CLAIMS.length >= 12,
    { claimsChecked: CLAIMS.length, missing, sectionPresent, quoted: Object.fromEntries(CLAIMS) });
});

if (E && A && PD) {
  await server.close();
  console.log(failures ? `done — ${failures} FAILED` : "done — all element/tier checks passed");
  if (failures) process.exitCode = 1;
}
