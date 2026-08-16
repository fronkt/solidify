import { BASES, derive, type Mix } from "./alloy";
import { BINARY, type BinaryRow } from "./phasedata";
import { MATERIALS } from "./materials";

/**
 * THE DRAWN DIAGRAM (v7.1 P2).
 *
 * A phase diagram for the poured mix's DOMINANT binary, built from the cited
 * invariants in phasedata.ts and drawn as STRAIGHT CHORDS. The straightness is
 * not a compromise and it is the reason this file exists: the chords ARE the
 * linearised diagram sim.ts integrates, so the figure is a picture of the model
 * rather than a picture of a textbook, and the real curvature becomes a caveat
 * the panel prints instead of a feature it silently lacks.
 *
 * WHAT IS DRAWN, AND FROM WHAT.
 *   liquidus  (0, T_m) → (C_inv, T_inv)      both endpoints are row data
 *   solidus   (0, T_m) → (C_SM,  T_inv)      both endpoints are row data
 *   invariant the horizontal at T_inv between them
 *   solvus    the vertical at C_SM below T_inv
 *   pour      the marker, at the mix's OWN liquidus — not the binary's
 *   residual  the labelled gap between the two, when the mix has other solutes
 *   solver    the depression the solver actually integrates, when a clamp bound
 *   cursor    the melt's live temperature, when it is on this diagram
 *
 * THREE GEOMETRIES, ONE CONSTRUCTION. The same two chords cover every row:
 *   - a base-rich EUTECTIC falls to T_inv, and C_SM < C_inv puts the solidus to
 *     the left, so it falls faster and stays below the liquidus;
 *   - a PERITECTIC whose base solid is the PRODUCT (Al–Ti, Mg–Zr) has
 *     T_inv ABOVE the base's melting point and C_inv < C_SM, so both chords
 *     RISE and the solidus rises more slowly — still below the liquidus;
 *   - and Ni–W is a eutectic whose invariant is also above T_m (1495 against
 *     nickel's 1455), because the Ni-rich liquidus rises with tungsten all the
 *     way to it. Nothing here assumes a falling diagram.
 * Isomorphous rows (Fe–Cr, Cu–Ni) have no invariant to terminate on, so the two
 * chords run to the axis edge and there is no horizontal and no solvus.
 *
 * PURE ON PURPOSE. `layout()` returns vertices in DATA space — wt% and °C — and
 * knows nothing about pixels, so `PD-FIGURE-GEOMETRY` can assert the drawing
 * against the row it was built from without a browser. The renderer below is
 * then only a coordinate transform, and it mutates path `d` attributes rather
 * than rebuilding the tree, because it redraws on every slider input.
 */

/** a point in DATA space: wt% of the dominant solute, °C */
export interface Pt { c: number; T: number }

export type LineId = "liquidus" | "solidus" | "invariant" | "solvus" | "solver" | "residual";
export type MarkerId = "pour" | "solver" | "cursor";

export interface Polyline {
  id: LineId;
  pts: Pt[];
  /** intent, not appearance — the renderer owns colour */
  role: "data" | "model" | "offset";
  label: string;
}

export interface Marker { id: MarkerId; c: number; T: number; label: string }
/** a phase-field name and where to write it */
export interface FieldLabel { c: number; T: number; text: string }

export interface Figure {
  ok: true;
  kind: "INVARIANT" | "ISOMORPHOUS";
  baseSymbol: string;
  solute: string;
  /** data-space frame */
  xMax: number; yMin: number; yMax: number;
  polylines: Polyline[];
  markers: Marker[];
  fields: FieldLabel[];
  /** what this figure claims to be, in one sentence */
  caption: string;
  /** every simplification this drawing makes, named */
  notes: string[];
  /** the row's own citation, so the figure carries its provenance */
  source: string;
}

export interface FigureRefusal { ok: false; reason: string }

const C_PER_K = 273.15;

/**
 * Can this MATERIAL be drawn at all? Separate from `layout()` because the
 * question is asked one level up — the composer only offers alloy bases, but
 * the material picker offers succinonitrile, ice and a quasicrystal, and each
 * needs its own sentence rather than a shared blank panel.
 */
export function diagramForMaterial(materialKey: string):
{ ok: true; base: string } | FigureRefusal {
  const m = MATERIALS[materialKey];
  if (!m) return { ok: false, reason: `there is no material called "${materialKey}" in this build, so there is no diagram to draw.` };
  const entry = Object.entries(BASES).find(([, b]) => b.materialKey === materialKey);
  if (entry) return { ok: true, base: entry[0] };
  if (!m.si) {
    return { ok: false, reason: `${m.label} is a model material rather than a substance — it has no melting point and no assessed binaries, so there is nothing to draw a diagram from.` };
  }
  return { ok: false, reason: `${m.label} has real SI properties but is not an alloy base in this composer, so no binary invariants have been assessed for it and there is no diagram to draw.` };
}

/**
 * The first token of a `second` field, for a field label. The strings are
 * written for a reader — "theta-Al2Cu (CuAl2, tI12, C16)", "(Si) diamond cubic,
 * elemental silicon (cF8)" — so a plain split on separators returns an empty
 * string for every one that starts with a parenthesised symbol.
 */
export function shortPhase(second: string): string {
  const m = /^\(?[A-Za-z0-9αβγδθηπ'_-]+\)?/.exec(second.trim());
  return m ? m[0] : second.trim().slice(0, 12);
}

/** the chord through (0, T0) reaching (cEnd, T1), evaluated at c */
function chordAt(T0: number, cEnd: number, T1: number, c: number): number {
  if (!(cEnd > 0)) return T0;
  return T0 + ((T1 - T0) / cEnd) * c;
}

/**
 * Build the figure for a poured mix, with the melt's live temperature in °C
 * (or null when there is no liquid left, or no thermometer).
 *
 * `meltMaterialKey` is which material that temperature actually belongs to, and
 * it is not decoration. The composer's staged mix and the LOADED material can
 * disagree by one click: press the AZ91 preset while aluminium is in the
 * crucible and this function is asked to draw Mg–Al while `meltC` reports the
 * aluminium melt. Aluminium at 600 °C sits comfortably inside the Mg–Al frame
 * of 416–671 °C, so the cursor drew, labelled "melt 600 °C", on a magnesium
 * diagram — a wrong statement rather than a missing one. Pass the key and the
 * cursor is withheld with a sentence; omit it and the check is skipped, which
 * is what the browser-free gates that only care about geometry do.
 */
export function layout(mix: Mix, meltC: number | null,
  meltMaterialKey?: string | null): Figure | FigureRefusal {
  const base = Object.hasOwn(BASES, mix.base) ? BASES[mix.base] : undefined;
  if (!base) return { ok: false, reason: `no base metal named "${mix.base}" — the composer draws ${Object.keys(BASES).join(", ")}.` };
  const si = MATERIALS[base.materialKey]?.si;
  if (!si) return { ok: false, reason: `${base.label} carries no melting point, so a temperature axis cannot be drawn.` };

  const d = derive(mix);
  const dominant = d.dominant;
  if (!dominant) return { ok: false, reason: `a pure ${base.label} melt has no second component, so there is no binary diagram to draw — add a solute.` };

  const byBase = Object.hasOwn(BINARY, mix.base) ? BINARY[mix.base] : {};
  const row: BinaryRow | undefined = Object.hasOwn(byBase, dominant) ? byBase[dominant] : undefined;
  if (!row) return { ok: false, reason: `no assessed invariant for ${base.symbol}–${dominant}, so this pair has no diagram in this build.` };

  const sol = base.solutes[dominant];
  const TmC = si.Tm - C_PER_K;

  if (row.invariant === "isomorphous" && !(sol.k > 0) ) {
    return { ok: false, reason: `${base.symbol}–${dominant} is isomorphous, so its solidus is drawn from the partition coefficient alone — and k = ${sol.k} is not a positive number, so there is no solidus to draw.` };
  }

  // THE ROW HAS TO BE DRAWABLE, and one shipped row is not. A liquidus that
  // RISES from the pure base means the first solid is richer in solute than the
  // liquid (k > 1), which at the invariant means C_SM > C_inv — otherwise the
  // solidus reaches T_inv at a SMALLER composition, rises faster, and ends up
  // ABOVE the liquidus, which is not a phase diagram. Ni-W asserts both a
  // rising invariant (1495 °C over nickel's 1455) and a liquid-richer
  // invariant (C_SM 39.9 < C_inv 45). Found here, when the row was first drawn;
  // recorded in its own `source` and in PD-SLOPE-CONSISTENT; not repaired,
  // because which of the three numbers is wrong has not been resolved.
  if (row.invariant !== "isomorphous" && row.Tinv != null
      && row.Cinv != null && row.Csm != null) {
    const rises = row.Tinv > TmC;
    const solidRicher = row.Csm > row.Cinv;
    if (rises !== solidRicher) {
      return { ok: false, reason: `${base.symbol}–${dominant}'s row cannot be drawn: its invariant at ${row.Tinv} °C is ${rises ? "above" : "below"} pure ${base.symbol}'s ${TmC.toFixed(0)} °C, so the liquidus ${rises ? "rises" : "falls"} — but C_SM ${row.Csm} wt% against C_inv ${row.Cinv} wt% says the ${solidRicher ? "solid" : "liquid"} is the richer phase, which is the opposite. Drawn, the solidus would cross above the liquidus. The row's own source records this; nothing here invents a repair.` };
    }
  }
  const cDom = mix.wt[dominant];
  const TLmix = TmC + d.dTL;                 // the MELT's own liquidus
  const TLbin = TmC + sol.m * cDom;          // the DILUTE binary liquidus (not drawn)

  // The dominant solute's share, computed on the SAME quantity that picked it.
  // It used to be measured on depression alone while `derive()` picks the
  // dominant by |m·c| including liquidus RAISERS, so a titanium-dominant mix
  // read "chosen because Ti carries 0 % of the depression" — a reason that
  // refutes itself — and an all-raiser mix quoted a percentage of 0.0 K.
  let totalShift = 0, domShift = 0, totalDep = 0;
  for (const [el, w] of Object.entries(mix.wt)) {
    if (!Object.hasOwn(base.solutes, el) || !(w > 0)) continue;
    const mag = Math.abs(base.solutes[el].m * w);
    totalShift += mag;
    totalDep += Math.max(0, -base.solutes[el].m * w);
    if (el === dominant) domShift = mag;
  }
  const share = totalShift > 0 ? domShift / totalShift : 1;

  const polylines: Polyline[] = [];
  const markers: Marker[] = [];
  const fields: FieldLabel[] = [];
  const notes: string[] = [];

  const iso = row.invariant === "isomorphous";
  const Tinv = row.Tinv, Cinv = row.Cinv, Csm = row.Csm;

  // ---- the frame, sized to everything that has to fit inside it
  const xCandidates = [cDom, iso ? sol.cap : Math.max(Cinv ?? 0, Csm ?? 0)];
  const xMax = Math.max(...xCandidates) * 1.08;
  const liqAt = (c: number) => iso ? TmC + sol.m * c : chordAt(TmC, Cinv!, Tinv!, c);
  // k is NOT clamped to 0.999 here, and clamping it was a real bug. That guard
  // belongs in `referenceInterval`, where k divides into a freezing range; here
  // it silently turned Cu–Ni's k = 1.35 into 0.999, so the drawn solidus used
  // m/0.999 instead of m/1.35 and ended 0.04 K ABOVE the liquidus — the exact
  // impossible geometry this file refuses ni-W over, thirty lines up. Only a
  // non-positive or non-finite k is guarded, and that is a refusal below.
  const solAt = (c: number) => iso
    ? TmC + (sol.m / sol.k) * c
    : chordAt(TmC, Csm!, Tinv!, c);
  // The model's own depression, computed HERE rather than after the frame,
  // because whatever it draws has to fit inside it. Cu–Ni caught this: nickel
  // RAISES copper's liquidus, so the melt has no depression at all, but the
  // model floors mLiq at 0.1 and integrates a fabricated 8.9 K one — whose
  // endpoint sat below the frame the first time round.
  const mat = MATERIALS[base.materialKey];
  const tScale = mat.params.latent ? (si.L / si.cp) / mat.params.latent : 100;
  const solverDep = (d.params.mLiq ?? 0) * (d.params.c0 ?? 0) * tScale;
  const meltDep = Math.max(0, -d.dTL);
  const drawSolver = Math.abs(solverDep - meltDep) > 1e-9 && cDom > 0;
  const Tsolver = TmC - solverDep;

  // The frame is sized on the chords' ENDPOINTS, not on their value at xMax.
  // Evaluating them at xMax extrapolates a boundary past where it exists: the
  // Al–Si solidus falls 50.5 K per wt% and only reaches C_SM = 1.65 wt%, so
  // reading it at the axis edge of 13.6 wt% put A356's y-axis at −96 °C and
  // squashed the whole diagram into the top third of the box. Only the
  // isomorphous branch, whose chords genuinely do run to the edge, uses xMax.
  const yCand = iso
    ? [TmC, TLmix, TLbin, liqAt(xMax), solAt(xMax)]
    : [TmC, TLmix, TLbin, Tinv!];
  if (drawSolver) yCand.push(Tsolver);
  let yMax = Math.max(...yCand), yMin = Math.min(...yCand);
  // Asymmetric padding: the band BELOW the invariant is where the second phase
  // lives, and a symmetric 10 % left it too thin to write "(Al) + (Si)" into.
  const raw = yMax - yMin;
  yMax += Math.max(2, raw * 0.08);
  yMin -= Math.max(4, raw * (iso ? 0.08 : 0.20));
  const span = yMax - yMin;

  // ---- the two chords, both endpoints straight off the row
  if (iso) {
    polylines.push({ id: "liquidus", role: "data", label: "liquidus",
      pts: [{ c: 0, T: TmC }, { c: xMax, T: liqAt(xMax) }] });
    polylines.push({ id: "solidus", role: "data", label: "solidus",
      pts: [{ c: 0, T: TmC }, { c: xMax, T: solAt(xMax) }] });
    notes.push(`${base.symbol}–${dominant} is isomorphous: the two metals are soluble in each other in all proportions, so there is no invariant, no second phase and no eutectic to reach — the chords simply run off this axis.`);
  } else {
    polylines.push({ id: "liquidus", role: "data", label: "liquidus",
      pts: [{ c: 0, T: TmC }, { c: Cinv!, T: Tinv! }] });
    polylines.push({ id: "solidus", role: "data", label: `(${base.symbol}) solidus`,
      pts: [{ c: 0, T: TmC }, { c: Csm!, T: Tinv! }] });
    polylines.push({ id: "invariant", role: "data",
      label: `${row.invariant} ${Tinv!} °C`,
      pts: [{ c: Math.min(Csm!, Cinv!), T: Tinv! }, { c: Math.max(Csm!, Cinv!), T: Tinv! }] });
    polylines.push({ id: "solvus", role: "data", label: "solvus (drawn vertical)",
      pts: [{ c: Csm!, T: Tinv! }, { c: Csm!, T: yMin }] });
    notes.push(`the solvus is drawn vertical: this table carries the maximum solid solubility ${Csm!} wt% at the invariant and no lower-temperature solubility curve, so its real slope is not known here.`);
  }

  // ---- the pour, at the MIX's own liquidus rather than the binary's
  markers.push({ id: "pour", c: cDom, T: TLmix,
    label: `${d.name} — liquidus ${TLmix.toFixed(1)} °C` });

  // ---- the residual: the gap between the marker and the line actually DRAWN,
  //      decomposed, because it has TWO causes and they are different facts.
  //
  //      The bar used to run from the DILUTE binary liquidus, which is not on
  //      the figure: the drawn liquidus is the invariant CHORD, and P0 measured
  //      that the two disagree for 10 of the 22 pairs. Tin bronze is the
  //      sharpest case — a single-solute mix, so the old "other solutes" gap
  //      was exactly zero and no bar was drawn at all, while its marker floated
  //      30.8 K above the orange line with nothing to explain it.
  const TLdrawn = iso ? liqAt(cDom) : chordAt(TmC, Cinv!, Tinv!, cDom);
  const fromOthers = TLbin - TLmix;          // what the rest of the mix does
  const fromChord = TLdrawn - TLbin;         // dilute slope vs invariant chord
  const residual = TLdrawn - TLmix;          // = fromOthers + fromChord
  if (Math.abs(residual) > 1e-9) {
    const others = Object.keys(mix.wt).filter(el =>
      el !== dominant && Object.hasOwn(base.solutes, el) && mix.wt[el] > 0);
    polylines.push({ id: "residual", role: "offset",
      label: `${Math.abs(residual).toFixed(1)} K`,
      pts: [{ c: cDom, T: TLdrawn }, { c: cDom, T: TLmix }] });
    const parts: string[] = [];
    if (Math.abs(fromOthers) > 5e-3) {
      parts.push(`${Math.abs(fromOthers).toFixed(1)} K of it is the other ${others.length === 1 ? `solute (${others[0]})` : `${others.length} solutes (${others.join(", ")})`}, which ${fromOthers > 0 ? "depress" : "raise"}${others.length === 1 ? "es" : ""} this melt and ${others.length === 1 ? "is" : "are"} in the solver but not on this diagram`);
    }
    if (Math.abs(fromChord) > 5e-3) {
      // the two parts can have OPPOSITE signs, and then "13.3 K of it" plus
      // "1.1 K of it" summing to 12.2 K reads as an arithmetic error unless the
      // direction of each is stated
      parts.push(`${Math.abs(fromChord).toFixed(1)} K goes the ${Math.sign(fromChord) === Math.sign(fromOthers) || Math.abs(fromOthers) < 5e-3 ? "same way" : "other way"}, from ${base.symbol}–${dominant}'s own dilute slope (${sol.m} K/wt%, what the solver integrates) disagreeing with the invariant chord this line is drawn from — docs/PHASE-AUDIT.md records that ratio per pair`);
    }
    notes.push(`the marker sits ${Math.abs(residual).toFixed(1)} K ${residual > 0 ? "below" : "above"} the drawn liquidus: ${parts.join("; and ")}.`);
  }

  // ---- the line the solver actually integrates, when a clamp moved it
  if (drawSolver) {
    polylines.push({ id: "solver", role: "model",
      label: `the solver's own depression, ${solverDep.toFixed(1)} K`,
      pts: [{ c: 0, T: TmC }, { c: cDom, T: Tsolver }] });
    markers.push({ id: "solver", c: cDom, T: Tsolver,
      label: `solver: ${solverDep.toFixed(1)} K` });
    notes.push(`DASHED: the model's own clamps have moved the depression it integrates to ${solverDep.toFixed(1)} K, against this melt's ${meltDep.toFixed(1)} K. The dashed line is a chord to that point, not a second liquidus — the solver's slope is per unit of TOTAL solute, and this axis is ${dominant} alone.`);
    for (const c of d.clamps) notes.push(`clamp: ${c}`);
  }

  // ---- the thermometer, drawn only where it is really on this diagram AND
  //      only when it is this diagram's own metal
  const wrongMetal = meltMaterialKey != null && meltMaterialKey !== base.materialKey;
  if (meltC != null && Number.isFinite(meltC) && wrongMetal) {
    notes.push(`the melt in the crucible is ${MATERIALS[meltMaterialKey]?.label ?? meltMaterialKey}, not ${base.label} — this diagram is for a mix you have staged but not poured, so its thermometer is not drawn on it.`);
  } else if (meltC != null && Number.isFinite(meltC)) {
    if (meltC <= yMax && meltC >= yMin) {
      markers.push({ id: "cursor", c: 0, T: meltC, label: `melt ${meltC.toFixed(0)} °C` });
    } else {
      notes.push(`the melt is at ${meltC.toFixed(0)} °C, off this diagram (${yMin.toFixed(0)}–${yMax.toFixed(0)} °C) — the cursor is not drawn rather than pinned to an edge.`);
    }
  }

  // ---- phase-field names, placed at the MIDPOINT OF THE FIELD'S OWN WIDTH at
  //      the chosen temperature, and skipped when the field is narrower than
  //      the text. Anchoring on a data point alone is not enough: the first
  //      version put "L + (Al)" and "(Al)" at fractions of C_SM, which for
  //      Al–Si is 1.65 wt% out of a 13.6 wt% axis — both labels rendered
  //      centred on a field two characters wide and lay across the solidus.
  const inFrame = (T: number) => T > yMin + span * 0.03 && T < yMax - span * 0.03;
  //  a label needs roughly 0.55 px per character in a 300-unit viewBox at 7.5px
  const INNER = 250;                       // FRAME.w - FRAME.ml - FRAME.mr
  const fitsIn = (widthC: number, text: string) =>
    (widthC / xMax) * INNER > text.length * 4.6;
  const push = (c: number, T: number, text: string, widthC: number, why: string) => {
    if (inFrame(T) && fitsIn(widthC, text) && c > 0 && c < xMax) fields.push({ c, T, text });
    else notes.push(why);
  };

  // L — everything above the liquidus. Widest near the invariant end.
  {
    const cRef = (iso ? xMax : Cinv!) * 0.62;
    const T = liqAt(cRef) + span * 0.10;
    push(cRef, T, "L", xMax - cRef * 0.5, `the liquid field has no room for a label at this scale.`);
  }
  // L + (base) — between the chords, and its width is MEASURED at the label's
  // own height rather than assumed. The isomorphous arm used to take a
  // hardcoded 5 % of the axis, which suppressed Cu–Ni's genuinely 10.6 K-wide
  // lens and then printed "Ni in copper barely partitions (k 1.35)" — false on
  // both halves, since 1.35 partitions strongly and the field was only narrow
  // because the test was. Both chords are straight through (0, T_m), so a point
  // at composition c on one meets the same temperature on the other at a fixed
  // ratio: k for an isomorphous pair, C_SM/C_inv for a row with an invariant.
  {
    const f = 0.55;
    const cLiq = (iso ? xMax : Cinv!) * f;
    const cSol = iso ? cLiq * sol.k : Csm! * f;
    const lo = Math.min(cLiq, cSol), hi = Math.max(cLiq, cSol);
    const T = iso ? TmC + sol.m * cLiq : TmC + f * (Tinv! - TmC);
    push((lo + hi) / 2, T, `L + (${base.symbol})`, hi - lo,
      `the two-phase field between the liquidus and the solidus is only ${(hi - lo).toFixed(2)} wt% wide at this height, too narrow to write a label into on a ${xMax.toFixed(1)} wt% axis (k = ${sol.k}).`);
  }
  // (base) — the single-phase solid solution. Which SIDE of the solidus that is
  // depends on the sign: for a falling diagram the solid is leaner than the
  // liquid and the field lies left of the solidus, but for a k > 1 peritectic
  // the solid is RICHER and it lies to the right, so anchoring at a fraction of
  // the way up to T_inv put "(Al)" on top of "L + (Al)" in Al–Ti. Anchored
  // instead below BOTH the melting point and the invariant, where the field is
  // unambiguously 0..C_SM in either topology.
  {
    const hi = iso ? xMax : Csm!;
    const T = iso ? solAt(hi * 0.5) - span * 0.12
                  : Math.min(TmC, Tinv!) - span * 0.10;
    push(hi / 2, T, `(${base.symbol})`, hi,
      `the primary ${base.symbol} field is too narrow to label at this scale: it reaches only ${hi.toFixed(2)} wt% on a ${xMax.toFixed(1)} wt% axis.`);
  }
  // (base) + second — below the invariant, right of the solvus
  if (!iso && row.second) {
    const lo = Csm!, hi = xMax;
    push((lo + hi) / 2, Tinv! - span * 0.09, `(${base.symbol}) + ${shortPhase(row.second)}`, hi - lo,
      `there is no room below the ${row.invariant} to name the two solid phases it produces; they are ${base.symbol} and ${shortPhase(row.second)}.`);
  }

  // ---- the standing caveats, whatever the row
  notes.push(`straight chords: the real boundaries are curved, and these are the linearised ones this solver integrates. Where the shipped dilute slope and the invariant chord disagree, docs/PHASE-AUDIT.md records by how much.`);
  if (Object.keys(mix.wt).length > 1) {
    notes.push(`this is the ${base.symbol}–${dominant} binary, chosen because ${dominant} carries ${(share * 100).toFixed(0)} % of this melt's ${totalShift.toFixed(1)} K of liquidus shift (of which ${totalDep.toFixed(1)} K is depression). It is NOT this alloy's own diagram: a multicomponent melt has its own surfaces, and the phases they add — Laves in a Nb-bearing nickel alloy, π and β in an iron-bearing Al–Si–Mg — appear on neither this drawing nor in the solver.`);
  }

  return {
    ok: true, kind: iso ? "ISOMORPHOUS" : "INVARIANT",
    baseSymbol: base.symbol, solute: dominant,
    xMax, yMin, yMax, polylines, markers, fields,
    caption: `${base.symbol}–${dominant}, ${iso ? "isomorphous — no invariant" : `${row.invariant} at ${Tinv} °C`}`,
    notes, source: row.source,
  };
}

// ---------------------------------------------------------------------------
// THE RENDERER. Only a coordinate transform — every number it draws came out of
// `layout()` above, which is why the gate can check the drawing without a DOM.

/** px frame of the drawing area inside the SVG */
export interface Frame { w: number; h: number; ml: number; mr: number; mt: number; mb: number }
export const FRAME: Frame = { w: 300, h: 190, ml: 40, mr: 10, mt: 10, mb: 24 };

/**
 * Data space to px. Exported because `PD-FIGURE-GEOMETRY` round-trips the pour
 * marker through it and back: a transform exercised only by the renderer is a
 * transform no gate can see.
 */
export function toPx(fig: Figure, p: Pt, fr: Frame = FRAME): { x: number; y: number } {
  const iw = fr.w - fr.ml - fr.mr, ih = fr.h - fr.mt - fr.mb;
  return {
    x: fr.ml + (fig.xMax > 0 ? (p.c / fig.xMax) * iw : 0),
    y: fr.mt + ((fig.yMax - p.T) / (fig.yMax - fig.yMin)) * ih,
  };
}
/** the exact inverse, so the round-trip is a real round-trip */
export function fromPx(fig: Figure, x: number, y: number, fr: Frame = FRAME): Pt {
  const iw = fr.w - fr.ml - fr.mr, ih = fr.h - fr.mt - fr.mb;
  return {
    c: fig.xMax > 0 ? ((x - fr.ml) / iw) * fig.xMax : 0,
    T: fig.yMax - ((y - fr.mt) / ih) * (fig.yMax - fig.yMin),
  };
}

const SVGNS = "http://www.w3.org/2000/svg";
function el(n: string, attrs: Record<string, string> = {}): SVGElement {
  const e = document.createElementNS(SVGNS, n);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const STROKE: Record<LineId, { c: string; w: string; dash: string }> = {
  liquidus:  { c: "#ffb454", w: "1.6", dash: "" },
  solidus:   { c: "#7fd18b", w: "1.4", dash: "" },
  invariant: { c: "#8891a0", w: "1.2", dash: "" },
  solvus:    { c: "#8891a0", w: "1",   dash: "3 3" },
  solver:    { c: "#56d4dd", w: "1.3", dash: "5 3" },
  residual:  { c: "#c96a5b", w: "1.6", dash: "2 2" },
};
const LINE_ORDER: LineId[] = ["invariant", "solvus", "solidus", "liquidus", "solver", "residual"];

/**
 * The figure as a mounted, mutable SVG, built ONCE and updated in place.
 * `composer.renderOut()` replaces its own `.derived` innerHTML on every slider
 * frame, so the figure lives in its own container and is never rebuilt by it.
 */
export class PhaseFigureView {
  readonly root: HTMLElement;
  private svg: SVGElement;
  private paths = new Map<LineId, SVGElement>();
  private pour: SVGElement;
  private solverDot: SVGElement;
  private cursor: SVGElement;
  private cursorTx: SVGElement;
  private fieldTx: SVGElement[] = [];
  private axis: SVGElement[] = [];
  private capEl: HTMLElement;
  private noteEl: HTMLElement;
  private srcEl: HTMLElement;
  private lastKey = "";

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "pdfig";
    this.capEl = document.createElement("div");
    this.capEl.className = "pdcap";
    this.svg = el("svg", { viewBox: "0 0 " + FRAME.w + " " + FRAME.h, class: "pdsvg" });
    this.svg.append(el("rect", {
      x: String(FRAME.ml), y: String(FRAME.mt),
      width: String(FRAME.w - FRAME.ml - FRAME.mr),
      height: String(FRAME.h - FRAME.mt - FRAME.mb),
      fill: "none", stroke: "#262b33", "stroke-width": "1",
    }));
    for (const id of LINE_ORDER) {
      const s = STROKE[id];
      const p = el("path", {
        fill: "none", stroke: s.c, "stroke-width": s.w,
        "stroke-dasharray": s.dash, "stroke-linejoin": "round",
      });
      this.paths.set(id, p);
      this.svg.append(p);
    }
    // ids so PD-CURSOR-LIVE can read the drawn cursor rather than a mirror of it
    this.cursor = el("line", { id: "pdCursorLine", stroke: "#eef1f5", "stroke-width": "1", "stroke-dasharray": "1 3" });
    this.cursorTx = el("text", { id: "pdCursor", fill: "#eef1f5", "font-size": "7", "text-anchor": "end" });
    this.pour = el("circle", { r: "3.4", fill: "#ffb454", stroke: "#0a0b0d", "stroke-width": "1" });
    this.solverDot = el("circle", { r: "2.6", fill: "none", stroke: "#56d4dd", "stroke-width": "1.2" });
    this.svg.append(this.cursor, this.cursorTx, this.solverDot, this.pour);
    for (let i = 0; i < 5; i++) {
      const t = el("text", { fill: "#6b7280", "font-size": "7.5", "text-anchor": "middle" });
      this.fieldTx.push(t); this.svg.append(t);
    }
    for (let i = 0; i < 5; i++) {
      const t = el("text", { fill: "#6b7280", "font-size": "7" });
      this.axis.push(t); this.svg.append(t);
    }
    this.noteEl = document.createElement("div");
    this.noteEl.className = "pdnotes";
    this.srcEl = document.createElement("div");
    this.srcEl.className = "pdsrc";
    this.root.append(this.capEl, this.svg, this.noteEl, this.srcEl);
  }

  /** the whole figure, or a named refusal in its place */
  update(mix: Mix, meltC: number | null, meltMaterialKey?: string | null) {
    const fig = layout(mix, meltC, meltMaterialKey);
    if (!fig.ok) {
      this.svg.setAttribute("style", "display:none");
      this.capEl.textContent = "no diagram";
      this.noteEl.textContent = fig.reason;
      this.srcEl.textContent = "";
      this.lastKey = "";
      return;
    }
    this.svg.removeAttribute("style");
    this.capEl.textContent = fig.caption;

    for (const [id, path] of this.paths) {
      const line = fig.polylines.find(l => l.id === id);
      if (!line) { path.setAttribute("d", ""); continue; }
      path.setAttribute("d", line.pts.map((pt, i) => {
        const q = toPx(fig, pt);
        return (i ? "L" : "M") + q.x.toFixed(2) + " " + q.y.toFixed(2);
      }).join(" "));
    }

    const place = (c: SVGElement, m: Marker | undefined) => {
      if (!m) { c.setAttribute("display", "none"); return; }
      c.removeAttribute("display");
      const q = toPx(fig, { c: m.c, T: m.T });
      c.setAttribute("cx", q.x.toFixed(2));
      c.setAttribute("cy", q.y.toFixed(2));
      // querySelector("title") is typed as HTMLTitleElement — inside an SVG it
      // is not one, so the node is tracked by hand rather than re-queried
      let t = c.firstElementChild as SVGElement | null;
      if (!t) { t = el("title"); c.append(t); }
      t.textContent = m.label;
    };
    place(this.pour, fig.markers.find(m => m.id === "pour"));
    place(this.solverDot, fig.markers.find(m => m.id === "solver"));

    const cur = fig.markers.find(m => m.id === "cursor");
    if (cur) {
      const q = toPx(fig, { c: 0, T: cur.T });
      this.cursor.removeAttribute("display");
      this.cursorTx.removeAttribute("display");
      this.cursor.setAttribute("x1", String(FRAME.ml));
      this.cursor.setAttribute("x2", String(FRAME.w - FRAME.mr));
      this.cursor.setAttribute("y1", q.y.toFixed(2));
      this.cursor.setAttribute("y2", q.y.toFixed(2));
      this.cursorTx.setAttribute("x", String(FRAME.w - FRAME.mr - 2));
      this.cursorTx.setAttribute("y", (q.y - 2).toFixed(2));
      this.cursorTx.textContent = cur.label;
    } else {
      this.cursor.setAttribute("display", "none");
      this.cursorTx.setAttribute("display", "none");
      // cleared, not just hidden: #pdCursor is the node PD-CURSOR-LIVE reads,
      // and a hidden element still holding "melt 581 °C" reports a temperature
      // that is no longer true to anyone who queries it
      this.cursorTx.textContent = "";
    }

    this.fieldTx.forEach((t, i) => {
      const fl = fig.fields[i];
      if (!fl) { t.setAttribute("display", "none"); return; }
      t.removeAttribute("display");
      const q = toPx(fig, { c: fl.c, T: fl.T });
      t.setAttribute("x", q.x.toFixed(2));
      t.setAttribute("y", q.y.toFixed(2));
      t.textContent = fl.text;
    });

    // axis ticks: the two composition ends, the two temperature ends, and the
    // invariant's own temperature where the horizontal sits
    const inv = fig.polylines.find(l => l.id === "invariant");
    const ticks: { x: number; y: number; s: string; anchor: string }[] = [
      { x: FRAME.ml, y: FRAME.h - FRAME.mb + 9, s: "0 wt% " + fig.solute, anchor: "start" },
      { x: FRAME.w - FRAME.mr, y: FRAME.h - FRAME.mb + 9, s: fig.xMax.toFixed(fig.xMax < 2 ? 2 : 0), anchor: "end" },
      { x: FRAME.ml - 3, y: FRAME.mt + 3, s: fig.yMax.toFixed(0) + " °C", anchor: "end" },
      { x: FRAME.ml - 3, y: FRAME.h - FRAME.mb, s: fig.yMin.toFixed(0) + " °C", anchor: "end" },
    ];
    if (inv) {
      const q = toPx(fig, inv.pts[0]);
      ticks.push({ x: FRAME.ml - 3, y: q.y + 2.5, s: inv.pts[0].T + " °C", anchor: "end" });
    }
    this.axis.forEach((t, i) => {
      const k = ticks[i];
      if (!k) { t.setAttribute("display", "none"); return; }
      t.removeAttribute("display");
      t.setAttribute("x", String(k.x)); t.setAttribute("y", String(k.y));
      t.setAttribute("text-anchor", k.anchor);
      t.textContent = k.s;
    });

    // the prose only changes when the MIX does, not on every cursor tick
    const key = fig.baseSymbol + "-" + fig.solute + "|" + fig.notes.join("~");
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.noteEl.textContent = fig.notes.join("  ·  ");
      this.srcEl.textContent = fig.source.length > 240 ? fig.source.slice(0, 240) + "…" : fig.source;
    }
  }
}
