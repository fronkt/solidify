import { BASES, derive, phasesFor, type CompositionRegime, type Mix } from "./alloy";
import { BINARY, shortPhase, type BinaryRow } from "./phasedata";
import { MATERIALS } from "./materials";
import { learnSlot, fillLearnSlots, type Caveat } from "./learn";
import { seriesVar, SLOTS, PRINT_SLOTS } from "./design/plot";
import { token } from "./design/tool";
import { ticks, fmtTick, decimalsFor, columnFormat } from "./plot/ticks";
import { runs, modalPlotRoom } from "./plot/layout";
import { openModal, type FigureHandle } from "./plot/modal";

// shortPhase moved to phasedata.ts in v7.1 P3 — alloy.ts names phases now too,
// and this module already imports alloy.ts, so the helper had to sit below both
// or the import would be a cycle. Re-exported because it was exported here.
export { shortPhase };

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

/**
 * The composition band the poured mix sits in (v7.1 P3), shaded across the full
 * height of the frame. Its EDGES are row data — 0 and C_SM for a single-phase
 * melt, C_SM and C_inv for one that terminates two-phase — so the shading is
 * the same claim the readout makes in words, drawn from the same two numbers.
 */
export interface RegimeBand {
  c0: number; c1: number;
  regime: CompositionRegime;
  /** the phases that band leaves, e.g. "(Al) + (Si)" */
  label: string;
}

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
  /** the composition regime this pour sits in, or null when the row has none */
  band: RegimeBand | null;
  /** what this figure claims to be, in one sentence */
  caption: string;
  /**
   * every simplification this drawing makes, named: each an on-screen `line`
   * with the `learn` text behind it (v8 U1c), computed here beside the number
   * it is about
   */
  notes: Caveat[];
  /** the row's audit record (phasedata.ts `source`), not printed */
  source: string;
  /** the row's short citation, printed as the figure's source line */
  cite: string;
}

/** `learn`: what the refusal means, for learn mode (v8 U1c); the reason stays the line */
export interface FigureRefusal { ok: false; reason: string; learn?: string }

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
    return { ok: false, reason: `${m.label} is a model material rather than a substance: it has no melting point and no assessed binaries, so there is nothing to draw a diagram from.` };
  }
  return { ok: false, reason: `${m.label} has real SI properties but is not an alloy base in this composer, so no binary invariants have been assessed for it and there is no diagram to draw.` };
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
  meltMaterialKey?: string | null, fieldScale = 1): Figure | FigureRefusal {
  const base = Object.hasOwn(BASES, mix.base) ? BASES[mix.base] : undefined;
  if (!base) return { ok: false, reason: `no diagram: no base metal named "${mix.base}" (bases: ${Object.keys(BASES).join(", ")})` };
  const si = MATERIALS[base.materialKey]?.si;
  if (!si) return { ok: false, reason: `no diagram: ${base.label} has no melting point, so there is no temperature axis` };

  const d = derive(mix);
  const dominant = d.dominant;
  if (!dominant) return { ok: false, reason: `no diagram: a pure ${base.label} melt has no second component. Add a solute.`,
    learn: "A binary phase diagram maps a base metal against one added element, so it needs a solute to draw. Add one and its diagram appears here." };

  const byBase = Object.hasOwn(BINARY, mix.base) ? BINARY[mix.base] : {};
  const row: BinaryRow | undefined = Object.hasOwn(byBase, dominant) ? byBase[dominant] : undefined;
  if (!row) return { ok: false, reason: `no diagram: no assessed ${base.symbol}–${dominant} invariant in this build` };

  const sol = base.solutes[dominant];
  const TmC = si.Tm - C_PER_K;

  if (row.invariant === "isomorphous" && !(sol.k > 0) ) {
    return { ok: false, reason: `no diagram: ${base.symbol}–${dominant} is isomorphous and k = ${sol.k} is not positive, so there is no solidus to draw` };
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
      return { ok: false,
        reason: `no diagram: the ${base.symbol}–${dominant} row cannot be drawn (T_inv ${row.Tinv} °C is ${rises ? "above" : "below"} T_m ${TmC.toFixed(0)} °C, yet C_SM ${row.Csm} vs C_inv ${row.Cinv} wt% makes the ${solidRicher ? "solid" : "liquid"} richer; the solidus would cross the liquidus)`,
        learn: `A liquidus that ${rises ? "rises" : "falls"} from the pure metal needs a first solid ${rises ? "richer" : "leaner"} than the liquid, and the cited ${base.symbol}–${dominant} numbers say the reverse, so one of the three numbers is wrong. The app has not resolved which, so it draws nothing rather than invent a repair.` };
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
  // Counted over the solutes derive() actually USED, not over `mix.wt`. Those
  // differ from v7.1 P3 on: a solute past its own invariant is refused and
  // dropped, and reading the raw mix here put the dropped weight back into the
  // denominator, so the dominant solute's share was quoted against a melt the
  // app had declined to pour.
  let totalShift = 0, domShift = 0, totalDep = 0;
  for (const ph of d.phases) {
    const so = base.solutes[ph.el];
    if (!so || !(ph.wt > 0)) continue;
    const mag = Math.abs(so.m * ph.wt);
    totalShift += mag;
    totalDep += Math.max(0, -so.m * ph.wt);
    if (ph.el === dominant) domShift = mag;
  }
  const share = totalShift > 0 ? domShift / totalShift : 1;

  const polylines: Polyline[] = [];
  const markers: Marker[] = [];
  const fields: FieldLabel[] = [];
  const notes: Caveat[] = [];
  const note = (line: string, learn: string) => notes.push({ line, learn });

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
    note(`${base.symbol}–${dominant} isomorphous: no invariant, no second phase`,
      "These two metals dissolve in each other at every composition, so there is no eutectic, no second solid and no invariant line, and the two boundaries simply run off the edge of the plot.");
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
    note("solvus drawn vertical (no solubility data below the invariant)",
      `The table stores the maximum solid solubility (${Csm!} wt%) only at the invariant temperature, not how it changes on cooling, so the solvus is drawn straight down.`);
  }

  // ---- the pour, at the MIX's own liquidus rather than the binary's
  markers.push({ id: "pour", c: cDom, T: TLmix,
    label: `${d.name} · liquidus ${TLmix.toFixed(1)} °C` });

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
    // THE NOTE. Each part states its OWN direction, "down" (it puts the marker
    // below the drawn line, a positive part) or "up": the two parts can have
    // opposite signs, and "the same way" / "the other way" left the first part
    // with no direction at all, so Ni–5Nb–1W's 1.0 K from W (which RAISES the
    // liquidus) read as "below" and the parts summed to the wrong side. A part
    // or a total that rounds to 0.0 K prints nothing: the bar's own label
    // carries the number, and al–Fe at 0.175 wt% used to print "pour marker
    // 0.0 K below the drawn liquidus: " with nothing after the colon.
    const shown = (x: number) => Math.abs(x) >= 0.05;
    const way = (x: number) => (x > 0 ? "down" : "up");
    const parts: string[] = [];
    if (shown(fromOthers)) {
      parts.push(`${Math.abs(fromOthers).toFixed(1)} K ${way(fromOthers)} from other solute${others.length === 1 ? "" : "s"} (${others.join(", ")}), in the solver, not drawn`);
    }
    if (shown(fromChord)) {
      parts.push(`${Math.abs(fromChord).toFixed(1)} K ${way(fromChord)}: dilute slope ${sol.m} K/wt% vs the drawn chord`);
    }
    // the audit notes are named, not their repo path (docs/COPY-STYLE.md)
    if (shown(residual) && parts.length) {
      note(`pour marker ${Math.abs(residual).toFixed(1)} K ${residual > 0 ? "below" : "above"} the drawn liquidus: ${parts.join("; ")}`,
        "The marker sits at this melt's own liquidus, which can differ from the drawn line for two reasons: other solutes shift the melting point too, and the solver uses the dilute slope while the line is drawn straight to the invariant. The project's audit notes record that second disagreement for each pair.");
    }
  }

  // ---- the line the solver actually integrates, when a clamp moved it
  if (drawSolver) {
    polylines.push({ id: "solver", role: "model",
      label: `the solver's own depression, ${solverDep.toFixed(1)} K`,
      pts: [{ c: 0, T: TmC }, { c: cDom, T: Tsolver }] });
    markers.push({ id: "solver", c: cDom, T: Tsolver,
      label: `solver: ${solverDep.toFixed(1)} K` });
    note(`dashed: the solver's depression ${solverDep.toFixed(1)} K vs this melt's ${meltDep.toFixed(1)} K (moved by a clamp)`,
      `The simulation's safety clamps changed how far it lowers the melting point, and the dashed line points to what the solver really uses. It is not a second liquidus: the solver's slope counts all the solute, while this axis shows ${dominant} alone.`);
    for (const c of d.clamps) note(`clamp: ${c}`, d.learn[c] ?? "");
  }

  // ---- the thermometer, drawn only where it is really on this diagram AND
  //      only when it is this diagram's own metal
  const wrongMetal = meltMaterialKey != null && meltMaterialKey !== base.materialKey;
  if (meltC != null && Number.isFinite(meltC) && wrongMetal) {
    note(`cursor hidden: the melt in the crucible is ${MATERIALS[meltMaterialKey]?.label ?? meltMaterialKey}, not ${base.label}`,
      "This diagram is for a mix you have staged but not poured, so the temperature of the melt that is actually in the crucible is not drawn on it.");
  } else if (meltC != null && Number.isFinite(meltC)) {
    if (meltC <= yMax && meltC >= yMin) {
      markers.push({ id: "cursor", c: 0, T: meltC, label: `melt ${meltC.toFixed(0)} °C` });
    } else {
      note(`cursor hidden: the melt at ${meltC.toFixed(0)} °C is off this diagram (${yMin.toFixed(0)}–${yMax.toFixed(0)} °C)`,
        "The melt's temperature is outside this plot's range, so the cursor is left off rather than pinned to an edge.");
    }
  }

  // ---- phase-field names, placed at the MIDPOINT OF THE FIELD'S OWN WIDTH at
  //      the chosen temperature, and skipped when the field is narrower than
  //      the text. Anchoring on a data point alone is not enough: the first
  //      version put "L + (Al)" and "(Al)" at fractions of C_SM, which for
  //      Al–Si is 1.65 wt% out of a 13.6 wt% axis — both labels rendered
  //      centred on a field two characters wide and lay across the solidus.
  const inFrame = (T: number) => T > yMin + span * 0.03 && T < yMax - span * 0.03;
  //  a label needs roughly 0.55 px per character in a 300-unit viewBox at 7.5px.
  //  The frame's inner width is DERIVED (U2): it was the literal 250, which a
  //  change to FRAME's margins would have silently desynced from the drawing
  //  `fieldScale`: the view's field type over PD_FONT's (a narrow card sets
  //  it larger in the frame's units to keep 11.5 px on screen, pdFontFor)
  const INNER = FRAME.w - FRAME.ml - FRAME.mr;
  const fitsIn = (widthC: number, text: string) =>
    (widthC / xMax) * INNER > text.length * 4.6 * Math.max(1, fieldScale);
  // A label that does not fit is skipped. v8 U1c dropped the three notes that
  // only apologized for a missing label (the field is still drawn, so they
  // told a reader nothing about the model); the one that NAMES information the
  // skipped label carried, the two solids below the invariant, keeps its note.
  const push = (c: number, T: number, text: string, widthC: number, why?: Caveat) => {
    if (inFrame(T) && fitsIn(widthC, text) && c > 0 && c < xMax) fields.push({ c, T, text });
    else if (why) notes.push(why);
  };

  // L — everything above the liquidus. Widest near the invariant end.
  {
    const cRef = (iso ? xMax : Cinv!) * 0.62;
    const T = liqAt(cRef) + span * 0.10;
    push(cRef, T, "L", xMax - cRef * 0.5);
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
    push((lo + hi) / 2, T, `L + (${base.symbol})`, hi - lo);
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
    push(hi / 2, T, `(${base.symbol})`, hi);
  }
  // (base) + second — below the invariant, right of the solvus
  if (!iso && row.second) {
    const lo = Csm!, hi = xMax;
    push((lo + hi) / 2, Tinv! - span * 0.09, `(${base.symbol}) + ${shortPhase(row.second)}`, hi - lo,
      { line: `below the ${row.invariant}: (${base.symbol}) + ${shortPhase(row.second)} (no room for the label)`,
        learn: `Below the ${row.invariant} line the casting is two solids, (${base.symbol}) and ${shortPhase(row.second)}; that field is too narrow to label at this scale.` });
  }

  // ---- the standing caveats, whatever the row
  // Only the isomorphous branch draws the solver's own m and k. An invariant
  // row's chords join the pure metal to the cited invariant point, and the
  // solver integrates the dilute slope instead (tin bronze: 30.8 K apart at the
  // pour), so saying "the boundaries the solver uses" there was false; the pour
  // marker's note gives the gap.
  if (iso) {
    note("straight chords: the linearized boundaries the solver uses",
      "Real phase boundaries are curved; for this pair the straight lines are drawn from the same dilute slope and partition coefficient the solver integrates.");
  } else {
    note("straight chords between cited points (real boundaries curve)",
      "Real phase boundaries are curved; these straight lines join the pure metal to the cited invariant point. The solver integrates the dilute slope instead, and the pour marker note gives the gap when the two differ.");
  }
  if (d.phases.length > 1) {
    note(`${base.symbol}–${dominant} binary (${(share * 100).toFixed(0)} % of the ${totalShift.toFixed(1)} K liquidus shift): not this alloy's own multicomponent diagram`,
      `A melt with several elements has its own, more complex diagram; this one shows the binary of the element that shifts the melting point most (${totalDep.toFixed(1)} K of the shift is depression). Phases the other elements add, such as Laves in a Nb-bearing nickel alloy or π and β in an iron-bearing Al–Si–Mg, appear neither here nor in the simulation.`);
  }

  // ---- the regime band (v7.1 P3): where on this axis the pour sits, and what
  //      equilibrium leaves there. Edges are row data, never a fraction of the
  //      frame, so the shading cannot drift away from the words beside it.
  const ph = phasesFor(mix.base, dominant, cDom);
  let band: RegimeBand | null = null;
  if (ph) {
    const P = `(${base.symbol})`;
    if (iso) {
      band = { c0: 0, c1: xMax, regime: ph.regime, label: `${P} at every composition` };
    } else if (ph.regime === "SINGLE-PHASE") {
      // dissolved AT the invariant temperature: the table has no solvus below
      // it, and a precipitation-hardened alloy is two-phase when cold
      band = { c0: 0, c1: Math.min(Csm!, Cinv!), regime: ph.regime,
        label: `${P}, dissolved at ${Tinv!} °C` };
    } else if (ph.regime === "TWO-PHASE-TERMINATION") {
      band = { c0: Csm!, c1: Cinv!, regime: ph.regime,
        label: `${P} + ${shortPhase(row.second)}` };
    }
    // PAST-THE-INVARIANT draws no band, and cannot arrive here anyway: derive()
    // refuses that composition, so it never becomes the dominant solute of a
    // mix this function is handed. Left unhandled rather than given a band that
    // would be a picture of a melt the instrument declines to pour.
    // the readout above the figure already prints the regime line, so the
    // figure's own note says what equilibrium leaves at THIS pour (not the
    // band's generic label: 1045 sits in the (Fe) + γ band and ends as γ
    // alone) and what the solver grows
    note(band ? `shaded band: equilibrium leaves ${ph.equilibrium.join(" + ")} here${ph.regime === "SINGLE-PHASE" ? ` at ${Tinv!} °C (no solvus below)` : ""}; the solver grows ${P} only`
      : `${ph.line} · the solver grows ${P} only`,
      ph.source);
  }

  return {
    ok: true, kind: iso ? "ISOMORPHOUS" : "INVARIANT",
    baseSymbol: base.symbol, solute: dominant,
    xMax, yMin, yMax, polylines, markers, fields, band,
    caption: `${base.symbol}–${dominant}, ${iso ? "isomorphous (no invariant)" : `${row.invariant} at ${Tinv} °C`}`,
    notes, source: row.source, cite: row.cite,
  };
}

// ---------------------------------------------------------------------------
// THE RENDERER. Only a coordinate transform — every number it draws came out of
// `layout()` above, which is why the gate can check the drawing without a DOM.
//
// Since v8 U2 the figure carries a paper's axes: round ticks from the plot
// core (plot/ticks.ts) inside the frame's own domain (never widened, so
// PD-FIGURE-GEOMETRY's frame-tightness check still holds), the invariant's
// temperature as a tick of its own, both axis titles with their units, a key
// of the drawn lines, a hover readout (the composition and temperature under
// the pointer, and both boundaries there, through `fromPx`), and an enlarged
// view with the figure's vertices as a data table and the plot core's exports
// (plot/modal.ts). `axesOf` and `figureRows` are pure: verify-plot.mjs checks
// the axes and the table without a browser. It stays SVG (the audit's call:
// it redraws on every slider frame by mutating attributes), and the landing
// page's #pdFig is hand-typed markup that none of this touches.

/** px frame of the drawing area inside the SVG */
export interface Frame { w: number; h: number; ml: number; mr: number; mt: number; mb: number }
/** the composer's figure, in viewBox units: the same 250 x 156 plot as before
 *  U2, inside margins that now hold the tick labels and both axis titles (it
 *  was 190 tall with a 24 bottom margin, when the ticks were the frame's ends) */
export const FRAME: Frame = { w: 300, h: 196, ml: 40, mr: 10, mt: 10, mb: 30 };

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

/** type sizes, in the frame's units: tick labels, field labels, axis titles */
export interface PdFont { tick: number; field: number; title: number }
/** the composer draws its 300-unit figure about 1.55x (466 px on a desktop
 *  or a laptop), so these land on the plot spec's 11 px ticks and 12 px
 *  titles there. The view re-sizes them to its rendered width
 *  (pdFontFor), so a narrower card (a phone, the tour's inset) keeps 11 and
 *  12 px too */
export const PD_FONT: PdFont = { tick: 7.1, field: 7.5, title: 7.8 };
/** the enlarged view's type: its frame is its px size, so these are px */
export const PD_BIG_FONT: PdFont = { tick: 11, field: 11.5, title: 12 };
/** the composer figure's type for the width, CSS px, its SVG renders at:
 *  the plot spec's 11 px ticks, 11.5 px field labels and 12 px titles on
 *  screen, in the frame's own units (fr.w / renderedWidth per px) */
export function pdFontFor(renderedW: number, fr: Frame = FRAME): PdFont {
  const k = fr.w / Math.max(1, renderedW);
  return { tick: 11 * k, field: 11.5 * k, title: 12 * k };
}

/**
 * The enlarged view's plot size, CSS px, for a window of vw x vh: up to 860
 * wide in the room the window leaves, and no taller than the card holds beside
 * its exports and table (plot/layout.ts modalPlotRoom). `tour`: the tour's
 * column is showing, which the composer (and so this view, inside it) gives
 * up 362 px of the width to (app/index.html) — sized on the whole window, the
 * card ran under the tour panel, its y axis and csv / png pills with it.
 */
export function pdBigSize(vw: number, vh: number, tour = false): [number, number] {
  const room = tour && vw > 760 ? vw - 386 : vw;
  const w = Math.max(300, Math.min(860, Math.round(room * 0.86) - 40));
  const h = Math.max(260, Math.min(560, Math.round(vh * 0.56), modalPlotRoom(vh)));
  return [w, h];
}
/** the room under the enlarged plot its key takes: a row of 18 px per
 *  ~800 px of entries (all eight swatches and words) the width has to wrap
 *  into, and 12 px of margin: one row at 860, two beside the tour at 1024,
 *  three on a phone (a fixed 30 px let the third row run into the exports) */
export const pdKeyRoom = (w: number): number => 12 + 18 * Math.max(1, Math.ceil(800 / Math.max(1, w)));
/** the enlarged view's frame for its plot size, the key's room under it */
export const pdBigFrame = (w: number, h: number): Frame => ({ w, h: h - pdKeyRoom(w), ml: 66, mr: 18, mt: 14, mb: 42 });
/** a print figure's plot, fixed like the canvas figures' (layout.ts
 *  printSize: a journal column, 640 wide), whatever the window */
export const PD_PRINT_SIZE: [number, number] = [640, 450];

export interface PdTick { v: number; px: number; label: string; inv?: boolean }
export interface PdAxes { x: PdTick[]; y: PdTick[]; xTitle: string; yTitle: string }

/**
 * The axes of a drawn figure in a frame: round ticks (plot/ticks.ts) inside
 * the data domain, the invariant's own temperature as a tick of its own (the
 * round ticks too close to it give way), and both titles with their units.
 */
export function axesOf(fig: Figure, fr: Frame = FRAME, font: PdFont = PD_FONT): PdAxes {
  const iw = fr.w - fr.ml - fr.mr, ih = fr.h - fr.mt - fr.mb;
  const nx = Math.max(2, Math.min(8, Math.round(iw / (font.tick * 7))));
  const ny = Math.max(2, Math.min(7, Math.round(ih / (font.tick * 4.5))));
  const xv = ticks(0, fig.xMax, nx);
  const xstep = xv.length > 1 ? xv[1] - xv[0] : fig.xMax || 1;
  const x = xv.map(v => ({ v, px: toPx(fig, { c: v, T: fig.yMin }, fr).x, label: fmtTick(v, xstep) }));
  const yv = ticks(fig.yMin, fig.yMax, ny);
  const ystep = yv.length > 1 ? yv[1] - yv[0] : 1;
  let y: PdTick[] = yv.map(v => ({ v, px: toPx(fig, { c: 0, T: v }, fr).y, label: fmtTick(v, ystep) }));
  const inv = fig.polylines.find(l => l.id === "invariant");
  if (inv) {
    const T = inv.pts[0].T;
    const py = toPx(fig, { c: 0, T }, fr).y;
    y = y.filter(t => Math.abs(t.px - py) >= font.tick * 1.3);
    const d = decimalsFor(T);
    y.push({ v: T, px: py, label: fmtTick(T, Math.pow(10, -d)), inv: true });
    y.sort((a, b) => b.px - a.px);
  }
  return { x, y, xTitle: `Composition c_{${fig.solute}} (wt%)`, yTitle: "Temperature T (°C)" };
}

/** a table row: what it is (a line's id, or a marker's), its label on the
 *  figure, which point, composition (wt%), temperature (°C; NaN for a band
 *  edge, which spans every temperature) */
export type PdRow = [string, string, string, number, number];

/** the figure's data: every vertex drawn, every marker, the band's edges */
export function figureRows(fig: Figure): PdRow[] {
  const rows: PdRow[] = [];
  for (const id of ["liquidus", "solidus", "invariant", "solvus", "solver", "residual"] as LineId[]) {
    const l = fig.polylines.find(q => q.id === id);
    if (!l) continue;
    l.pts.forEach((p, i) => rows.push([id, l.label, i === 0 ? "start" : i === l.pts.length - 1 ? "end" : String(i), p.c, p.T]));
  }
  for (const m of fig.markers) rows.push([m.id === "pour" ? "pour marker" : m.id === "solver" ? "solver dot" : "melt cursor", m.label, "", m.c, m.T]);
  if (fig.band) {
    rows.push(["regime band", fig.band.label, "left edge", fig.band.c0, NaN]);
    rows.push(["regime band", fig.band.label, "right edge", fig.band.c1, NaN]);
  }
  return rows;
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const mixText = (mix: Mix): string => {
  const base = Object.hasOwn(BASES, mix.base) ? BASES[mix.base].symbol : mix.base;
  const parts = Object.entries(mix.wt).filter(([, w]) => w > 0).map(([el, w]) => `${Number(w.toPrecision(4))} wt% ${el}`);
  return [base, ...parts].join(" + ");
};

/** the provenance lines of a figure's export (the modal shows the last) */
export function figureProv(fig: Figure, mix: Mix, rows: number): string[] {
  return [
    `SOLIDIFY figure data: Phase diagram · ${fig.baseSymbol}–${fig.solute}`,
    `mix: ${mixText(mix)}`,
    `diagram: ${fig.caption}; the ${fig.solute} axis only (the dominant solute's binary)`,
    `source: ${fig.cite}`,
    ...fig.notes.map(n => `note: ${n.line}`),
    `rows: ${rows}`,
  ];
}

/** the figure's data as CSV: the provenance as "#" lines, then its rows */
export function figureCsv(fig: Figure, mix: Mix): string {
  const rows = figureRows(fig);
  const n = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(8))) : "");
  return [
    ...figureProv(fig, mix, rows.length).map(l => `# ${l}`),
    `element,label,point,c_wt_pct_${fig.solute},T_C`,
    ...rows.map(r => [csvCell(r[0]), csvCell(r[1]), csvCell(r[2]), n(r[3]), n(r[4])].join(",")),
  ].join("\n") + "\n";
}

const SVGNS = "http://www.w3.org/2000/svg";
function el(n: string, attrs: Record<string, string> = {}): SVGElement {
  const e = document.createElementNS(SVGNS, n);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
/** figure markup into an SVG text element: `_{...}` as a lowered, smaller tspan */
function setRich(t: SVGElement, s: string): void {
  t.textContent = "";
  for (const r of runs(s)) {
    const sp = el("tspan");
    if (r.sub) { sp.setAttribute("baseline-shift", "sub"); sp.setAttribute("font-size", "78%"); }
    sp.textContent = r.text;
    t.append(sp);
  }
}

// The diagram's curves are data (DESIGN.md 5, plots), drawn in the plot
// palette's slots in their fixed order (src/design/plot.ts; the values are
// tokens) and the two reference-like curves, the invariant isotherm and the
// solvus, in a gray, told apart by dash; everything else on the figure (the
// frame, the axes, the field labels, the melt-temperature cursor, the hover
// readout) is chrome and takes the tokens through app/index.html's .pd*
// classes. The colors are CSS references set as style, never written here.
// Every data element carries `data-mark`, which is how the achromatic gate
// (verify-rail RAIL-ACHROMATIC) tells the two apart.
const STROKE: Record<LineId, { c: string; w: number; dash: string }> = {
  liquidus:  { c: seriesVar(0), w: 1.6, dash: "" },
  solidus:   { c: seriesVar(1), w: 1.4, dash: "" },
  invariant: { c: "var(--fg-3)", w: 1.2, dash: "" },
  solvus:    { c: "var(--fg-3)", w: 1,   dash: "3 3" },
  solver:    { c: seriesVar(2), w: 1.3, dash: "5 3" },
  residual:  { c: seriesVar(3), w: 1.6, dash: "2 2" },
};
const LINE_ORDER: LineId[] = ["invariant", "solvus", "solidus", "liquidus", "solver", "residual"];
/** the key's word for each line (a legend names what a mark is, never its color) */
const KEY_WORD: Record<LineId, string> = {
  liquidus: "liquidus", solidus: "solidus", invariant: "invariant", solvus: "solvus",
  solver: "solver's depression", residual: "pour offset",
};

export interface PdViewOpts {
  /** the frame, in the SVG's own units (the enlarged view's is its px size) */
  frame?: Frame;
  font?: PdFont;
  /** markers and line widths, relative to the composer's figure */
  scale?: number;
  /** the composer's own figure: the ids the gates read (#pdCursor), the
   *  caption row with the ⤢, the notes and the source line */
  primary?: boolean;
}

/**
 * The figure as a mounted, mutable SVG, built ONCE and updated in place.
 * `composer.renderOut()` replaces its own `.derived` innerHTML on every slider
 * frame, so the figure lives in its own container and is never rebuilt by it.
 */
export class PhaseFigureView {
  readonly root: HTMLElement;
  /** the caption's row: the composer puts its learn-mode "i" in here (v8 U1c) */
  readonly head: HTMLElement;
  /** the enlarge control, in the caption's row (the composer puts its "i"
   *  before it, the analysis panels' order) */
  readonly zoom: HTMLButtonElement | null = null;
  private svg: SVGElement;
  private bandEl: SVGElement;
  private paths = new Map<LineId, SVGElement>();
  private pour: SVGElement;
  private solverDot: SVGElement;
  private cursor: SVGElement;
  private cursorTx: SVGElement;
  private fieldTx: SVGElement[] = [];
  private axesG: SVGElement;
  private hoverG: SVGElement;
  private keyEl: HTMLElement;
  private capEl: HTMLElement;
  private noteEl: HTMLElement | null = null;
  private srcEl: HTMLElement | null = null;
  private lastKey = "";
  private axesKey = "";
  private keyKey = "";
  private readonly fr: Frame;
  /** the type in the frame's units; the composer's own view re-sizes it to
   *  its rendered width (fitType), the enlarged view's is 1:1 already */
  private font: PdFont;
  private readonly primary: boolean;
  private readonly k: number;
  /** the figure last drawn, and what it was drawn from (for the hover
   *  readout and the enlarged view) */
  private fig: Figure | null = null;
  private args: [Mix, number | null, string | null | undefined] | null = null;
  private big: FigureHandle | null = null;

  constructor(opts: PdViewOpts = {}) {
    const primary = opts.primary ?? true;
    this.primary = primary;
    this.fr = opts.frame ?? FRAME;
    this.font = opts.font ?? PD_FONT;
    this.k = opts.scale ?? 1;
    const fr = this.fr;
    this.root = document.createElement("div");
    this.root.className = "pdfig";
    this.root.style.setProperty("--pd-tick", `${this.font.tick}px`);
    this.root.style.setProperty("--pd-field", `${this.font.field}px`);
    this.root.style.setProperty("--pd-title", `${this.font.title}px`);
    this.head = document.createElement("div");
    this.head.className = "pdhead";
    this.capEl = document.createElement("span");
    this.capEl.className = "pdcap";
    this.head.append(this.capEl);
    if (primary) {
      const z = document.createElement("button");
      z.type = "button";
      z.className = "zoomBtn iconbtn";
      z.textContent = "⤢";
      z.title = "enlarge";
      z.setAttribute("aria-label", "enlarge the phase diagram");
      z.addEventListener("click", () => this.openBig());
      this.head.append(z);
      this.zoom = z;
    }
    this.svg = el("svg", { viewBox: `0 0 ${fr.w} ${fr.h}`, class: "pdsvg" });
    // the regime band goes in FIRST so every line draws over it
    this.bandEl = el("rect", {
      y: String(fr.mt), height: String(fr.h - fr.mt - fr.mb),
      style: `fill: ${seriesVar(0)}`, "fill-opacity": "0.07", stroke: "none", "data-mark": "band",
    });
    this.bandEl.append(el("title"));
    this.svg.append(this.bandEl);
    this.svg.append(el("rect", {
      x: String(fr.ml), y: String(fr.mt),
      width: String(fr.w - fr.ml - fr.mr),
      height: String(fr.h - fr.mt - fr.mb),
      class: "pdframe",
    }));
    // the axes: ticks, their labels and both titles, rebuilt only when the
    // frame's domain moves
    this.axesG = el("g", { class: "pdaxes" });
    this.svg.append(this.axesG);
    for (const id of LINE_ORDER) {
      const s = STROKE[id];
      const p = el("path", {
        fill: "none", style: `stroke: ${s.c}`, "stroke-width": String(s.w * this.k),
        "stroke-dasharray": s.dash, "stroke-linejoin": "round", "data-mark": id,
      });
      this.paths.set(id, p);
      this.svg.append(p);
    }
    // ids so PD-CURSOR-LIVE can read the drawn cursor rather than a mirror of
    // it; the enlarged view's copy carries none (an id is the composer's)
    this.cursor = el("line", { ...(primary ? { id: "pdCursorLine" } : {}), class: "pdcursor" });
    this.cursorTx = el("text", { ...(primary ? { id: "pdCursor" } : {}), class: "pdtick pdcurtx", "text-anchor": "end" });
    // the pour's composition and the solver's reading are data marks
    this.pour = el("circle", { r: String(3.4 * this.k), style: `fill: ${seriesVar(0)}`, class: "pdpour", "data-mark": "pour" });
    this.solverDot = el("circle", { r: String(2.6 * this.k), fill: "none", style: `stroke: ${seriesVar(2)}`, "stroke-width": String(1.2 * this.k), "data-mark": "solver" });
    this.svg.append(this.cursor, this.cursorTx, this.solverDot, this.pour);
    // field labels in --fg-3 (Inter, at about 11.6 px rendered in the composer)
    for (let i = 0; i < 5; i++) {
      const t = el("text", { class: "pdfield", "text-anchor": "middle" });
      this.fieldTx.push(t); this.svg.append(t);
    }
    // the hover readout: a crosshair and a small box of values, chrome
    this.hoverG = el("g", { class: "pdhover", display: "none" });
    this.hoverG.append(el("line", { class: "pdhair" }), el("line", { class: "pdhair" }),
      el("rect", { class: "pdreadout" }), el("text", { class: "pdrtext" }));
    this.svg.append(this.hoverG);
    this.svg.addEventListener("pointermove", e => this.hover(e as PointerEvent));
    this.svg.addEventListener("pointerleave", () => this.hoverG.setAttribute("display", "none"));
    this.keyEl = document.createElement("div");
    this.keyEl.className = "pdkey";
    if (primary) {
      this.noteEl = document.createElement("div");
      this.noteEl.className = "pdnotes";
      this.srcEl = document.createElement("div");
      this.srcEl.className = "pdsrc";
      this.root.append(this.head, this.svg, this.keyEl, this.noteEl, this.srcEl);
    } else {
      this.root.append(this.svg, this.keyEl);
    }
    // The composer's figure sets its type in the viewBox's units, which only
    // come out at 11 / 12 px where the SVG renders ~466 px wide: with the
    // tour's inset at an 800 px window its ticks were ~9 px, on a phone ~7.8.
    // Re-size them to the width it renders at, so every width reads at the
    // plot spec's 11 px ticks and 12 px titles (DESIGN.md, plots)
    if (primary) new ResizeObserver(() => this.fitType()).observe(this.svg);
  }

  /** the composer view's type for its rendered width (pdFontFor); the axes
   *  and the field labels are redrawn with it when it changes */
  private fitType() {
    const w = this.svg.getBoundingClientRect().width;
    if (w < 2) return;
    const f = pdFontFor(w, this.fr);
    if (Math.abs(f.tick - this.font.tick) < 0.02) return;
    this.font = f;
    this.root.style.setProperty("--pd-tick", `${f.tick}px`);
    this.root.style.setProperty("--pd-field", `${f.field}px`);
    this.root.style.setProperty("--pd-title", `${f.title}px`);
    this.axesKey = "";
    if (this.args) this.update(...this.args);
  }

  /**
   * The notes, one terse line each with its learn text in an empty slot under
   * it (v8 U1c): with learn mode off `.pdnotes` reads exactly the lines, which
   * PD-CURSOR-LIVE reads for "off this diagram".
   */
  private writeNotes(notes: Caveat[]) {
    if (!this.noteEl) return;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    this.noteEl.innerHTML = notes.map(n => `<div class="pdnote">${esc(n.line)}</div>${learnSlot(n.learn)}`).join("");
    fillLearnSlots(this.noteEl);
  }

  /** the whole figure, or a named refusal in its place */
  update(mix: Mix, meltC: number | null, meltMaterialKey?: string | null) {
    this.args = [mix, meltC, meltMaterialKey];
    const fr = this.fr;
    // the composer's field labels fit their fields at the type it draws them
    // in (fitType); the enlarged view's frame is ~3x wider than the fit test's
    const fig = layout(mix, meltC, meltMaterialKey, this.primary ? this.font.field / PD_FONT.field : 1);
    if (!fig.ok) {
      this.fig = null;
      this.svg.setAttribute("style", "display:none");
      this.keyEl.style.display = "none";
      if (this.zoom) this.zoom.hidden = true;
      this.big?.close();
      this.capEl.textContent = "no diagram";
      this.writeNotes([{ line: fig.reason, learn: fig.learn ?? "" }]);
      if (this.srcEl) this.srcEl.textContent = "";
      this.lastKey = "";
      return;
    }
    this.fig = fig;
    this.svg.removeAttribute("style");
    this.keyEl.style.display = "";
    if (this.zoom) this.zoom.hidden = false;
    this.capEl.textContent = fig.caption;

    if (fig.band) {
      const a = toPx(fig, { c: fig.band.c0, T: fig.yMax }, fr);
      const b = toPx(fig, { c: fig.band.c1, T: fig.yMax }, fr);
      this.bandEl.removeAttribute("display");
      this.bandEl.setAttribute("x", Math.min(a.x, b.x).toFixed(2));
      this.bandEl.setAttribute("width", Math.abs(b.x - a.x).toFixed(2));
      this.bandEl.firstElementChild!.textContent =
        `${fig.band.regime.toLowerCase().replace(/-/g, " ")}: ${fig.band.label}`;
    } else {
      this.bandEl.setAttribute("display", "none");
      this.bandEl.setAttribute("width", "0");
      this.bandEl.firstElementChild!.textContent = "";
    }

    for (const [id, path] of this.paths) {
      const line = fig.polylines.find(l => l.id === id);
      if (!line) { path.setAttribute("d", ""); continue; }
      path.setAttribute("d", line.pts.map((pt, i) => {
        const q = toPx(fig, pt, fr);
        return (i ? "L" : "M") + q.x.toFixed(2) + " " + q.y.toFixed(2);
      }).join(" "));
    }

    const place = (c: SVGElement, m: Marker | undefined) => {
      if (!m) { c.setAttribute("display", "none"); return; }
      c.removeAttribute("display");
      const q = toPx(fig, { c: m.c, T: m.T }, fr);
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
      const q = toPx(fig, { c: 0, T: cur.T }, fr);
      this.cursor.removeAttribute("display");
      this.cursorTx.removeAttribute("display");
      this.cursor.setAttribute("x1", String(fr.ml));
      this.cursor.setAttribute("x2", String(fr.w - fr.mr));
      this.cursor.setAttribute("y1", q.y.toFixed(2));
      this.cursor.setAttribute("y2", q.y.toFixed(2));
      this.cursorTx.setAttribute("x", String(fr.w - fr.mr - 2));
      this.cursorTx.setAttribute("y", (q.y - 2 * this.k).toFixed(2));
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
      const q = toPx(fig, { c: fl.c, T: fl.T }, fr);
      t.setAttribute("x", q.x.toFixed(2));
      t.setAttribute("y", q.y.toFixed(2));
      t.textContent = fl.text;
    });

    // the axes, only when the frame's domain moved (a slider frame usually
    // leaves it; the cursor never moves it)
    const ak = `${fig.xMax}|${fig.yMin}|${fig.yMax}|${fig.solute}|${fig.polylines.find(l => l.id === "invariant")?.pts[0].T ?? ""}`;
    if (ak !== this.axesKey) { this.axesKey = ak; this.drawAxes(fig); }
    const kk = fig.polylines.map(l => l.id).join() + (fig.band ? "|band" : "") + (fig.markers.some(m => m.id === "pour") ? "|pour" : "");
    if (kk !== this.keyKey) { this.keyKey = kk; this.drawKey(fig); }

    // the prose only changes when the MIX does, not on every cursor tick
    // keyed on the learn texts as well: the shaded-band note's line can stay
    // the same while its learn text (which quotes the wt%) moves with a slider,
    // and a line-only key left the old paragraph in the slot
    const key = fig.baseSymbol + "-" + fig.solute + "|" + fig.notes.map(n => `${n.line}\u0001${n.learn}`).join("~");
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.writeNotes(fig.notes);
      // the row's short citation, whole: it used to print the first 240
      // characters of the audit record and stop mid-sentence (v8 U1c)
      if (this.srcEl) this.srcEl.textContent = `source: ${fig.cite}`;
    }
    this.big?.update();
  }

  /** ticks outward from the frame's left and bottom edges, their labels, and
   *  the two titles (plot/ticks.ts values; axesOf is the pure half) */
  private drawAxes(fig: Figure) {
    const fr = this.fr, f = this.font, T = 3 * this.k;
    const A = axesOf(fig, fr, f);
    const g = this.axesG;
    g.textContent = "";
    const bottom = fr.h - fr.mb;
    // the left and bottom edges are the axes (--fg-3); the frame's other two
    // sides stay the quiet box
    g.append(el("line", { class: "pdaxis", x1: String(fr.ml), x2: String(fr.ml), y1: String(fr.mt), y2: String(bottom) }),
      el("line", { class: "pdaxis", x1: String(fr.ml), x2: String(fr.w - fr.mr), y1: String(bottom), y2: String(bottom) }));
    for (const t of A.x) {
      g.append(el("line", { class: "pdaxis", x1: t.px.toFixed(2), x2: t.px.toFixed(2), y1: String(bottom), y2: String(bottom + T) }));
      const tx = el("text", { class: "pdtick", x: t.px.toFixed(2), y: (bottom + T + 2 + f.tick * 0.78).toFixed(2), "text-anchor": "middle" });
      tx.textContent = t.label;
      g.append(tx);
    }
    for (const t of A.y) {
      g.append(el("line", { class: "pdaxis", x1: String(fr.ml - T), x2: String(fr.ml), y1: t.px.toFixed(2), y2: t.px.toFixed(2) }));
      const tx = el("text", { class: t.inv ? "pdtick pdinv" : "pdtick", x: String(fr.ml - T - 2), y: (t.px + f.tick * 0.36).toFixed(2), "text-anchor": "end" });
      tx.textContent = t.label;
      g.append(tx);
    }
    // the baseline a quarter of the title's size above the old one, so the
    // subscript (c_Si) stays inside the viewBox at a phone's larger type
    const xt = el("text", { class: "pdtitle", x: ((fr.ml + fr.w - fr.mr) / 2).toFixed(2), y: (fr.h - 3 * this.k - f.title * 0.28).toFixed(2), "text-anchor": "middle" });
    setRich(xt, A.xTitle);
    const cy = (fr.mt + fr.h - fr.mb) / 2;
    const yt = el("text", { class: "pdtitle", x: "0", y: "0", "text-anchor": "middle", transform: `translate(${(f.title * 0.95).toFixed(2)} ${cy.toFixed(2)}) rotate(-90)` });
    setRich(yt, A.yTitle);
    g.append(xt, yt);
  }

  /** the key: a swatch of each drawn mark beside its word (the swatches are
   *  data and carry data-mark; the words are chrome) */
  private drawKey(fig: Figure) {
    const items: string[] = [];
    const sw = (id: string, style: string, cls = "") => `<span class="pdkey__sw ${cls}" data-mark="${id}" style="${style}"></span>`;
    for (const id of ["liquidus", "solidus", "invariant", "solvus", "solver", "residual"] as LineId[]) {
      if (!fig.polylines.some(l => l.id === id)) continue;
      const s = STROKE[id];
      const word = id === "invariant" ? (fig.polylines.find(l => l.id === id)!.label.split(" ")[0]) : KEY_WORD[id];
      items.push(`<span class="pdkey__i">${sw(id, `border-top-color: ${s.c}; border-top-style: ${s.dash ? "dashed" : "solid"}`)}${word}</span>`);
    }
    if (fig.markers.some(m => m.id === "pour")) items.push(`<span class="pdkey__i">${sw("pour", `background: ${seriesVar(0)}`, "pdkey__dot")}pour</span>`);
    if (fig.band) items.push(`<span class="pdkey__i">${sw("band", `background: ${seriesVar(0)}`, "pdkey__band")}this pour's regime</span>`);
    this.keyEl.innerHTML = items.join("");
  }

  /** the hover readout: the composition and temperature under the pointer,
   *  and where the liquidus and the solidus cross that composition */
  private hover(e: PointerEvent) {
    const fig = this.fig, fr = this.fr;
    if (!fig) return;
    const r = this.svg.getBoundingClientRect();
    if (r.width < 1) return;
    const x = ((e.clientX - r.left) / r.width) * fr.w, y = ((e.clientY - r.top) / r.height) * fr.h;
    if (x < fr.ml || x > fr.w - fr.mr || y < fr.mt || y > fr.h - fr.mb) { this.hoverG.setAttribute("display", "none"); return; }
    const p = fromPx(fig, x, y, fr);
    const at = (id: LineId): number | null => {
      const l = fig.polylines.find(q => q.id === id);
      if (!l) return null;
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1], b = l.pts[i];
        if (b.c === a.c) continue;
        if (p.c >= Math.min(a.c, b.c) && p.c <= Math.max(a.c, b.c)) return a.T + ((p.c - a.c) / (b.c - a.c)) * (b.T - a.T);
      }
      return null;
    };
    const cdec = fig.xMax < 2 ? 3 : fig.xMax < 20 ? 2 : 1;
    const lines = [`c ${p.c.toFixed(cdec)} wt% ${fig.solute}`, `T ${p.T.toFixed(0)} °C`];
    const L = at("liquidus"), S = at("solidus");
    if (L != null) lines.push(`liquidus ${L.toFixed(0)} °C`);
    if (S != null) lines.push(`solidus ${S.toFixed(0)} °C`);
    const [v, h, box, tx] = [...this.hoverG.children] as SVGElement[];
    v.setAttribute("x1", x.toFixed(2)); v.setAttribute("x2", x.toFixed(2)); v.setAttribute("y1", String(fr.mt)); v.setAttribute("y2", String(fr.h - fr.mb));
    h.setAttribute("x1", String(fr.ml)); h.setAttribute("x2", String(fr.w - fr.mr)); h.setAttribute("y1", y.toFixed(2)); h.setAttribute("y2", y.toFixed(2));
    const fs = this.font.tick, lh = fs * 1.35, pad = fs * 0.5;
    // the mono's advance is 0.6 em (JetBrains Mono), a little over for safety
    const bw = Math.max(...lines.map(l => l.length)) * fs * 0.62 + 2 * pad, bh = lines.length * lh + 2 * pad - (lh - fs);
    let bx = x + fs, by = y - bh - fs * 0.6;
    if (bx + bw > fr.w - fr.mr) bx = x - fs - bw;
    if (by < fr.mt) by = y + fs;
    box.setAttribute("x", bx.toFixed(2)); box.setAttribute("y", by.toFixed(2));
    box.setAttribute("width", bw.toFixed(2)); box.setAttribute("height", bh.toFixed(2));
    tx.textContent = "";
    lines.forEach((l, i) => {
      const s = el("tspan", { x: (bx + pad).toFixed(2), y: (by + pad + fs * 0.8 + i * lh).toFixed(2) });
      s.textContent = l;
      tx.append(s);
    });
    this.hoverG.removeAttribute("display");
  }

  /** close the enlarged view, if it is open (the composer closing) */
  closeBig() { this.big?.close(); }

  /** the enlarged figure (plot/modal.ts): the diagram large in its own SVG,
   *  its vertices as the data table, and the three exports; it follows every
   *  update of this one. Opened over the composer, inside it */
  openBig() {
    if (!this.fig || !this.args) return;
    this.big?.close();
    const host = (this.root.closest(".tmodal, #composer") as HTMLElement | null) ?? undefined;
    // the tour's column takes the left of the window while it shows, and the
    // composer (this view's host) is inset by it (app/index.html)
    const [w, h] = pdBigSize(innerWidth, innerHeight, !!document.querySelector("#tour.show"));
    const self = this;
    let view: PhaseFigureView | null = null;
    /** a print figure drawn off screen at the fixed print size, inside the
     *  composer so its .pd* styles apply, then removed */
    const printPng = async (): Promise<Blob | null> => {
      if (!self.args) return null;
      const [pw, ph] = PD_PRINT_SIZE;
      const off = document.createElement("div");
      off.style.cssText = `position:absolute; left:-10000px; top:0; width:${pw}px; pointer-events:none;`;
      off.setAttribute("aria-hidden", "true");
      (host ?? document.body).append(off);
      const pv = new PhaseFigureView({ frame: pdBigFrame(pw, ph), font: PD_BIG_FONT, scale: 1.4, primary: false });
      pv.root.classList.add("pdfig--big");
      off.append(pv.root);
      pv.update(...self.args);
      try { return await svgToPng(pv.svg, 3, true, pv.keyEl); } finally { off.remove(); }
    };
    const handle = openModal({
      title: `Phase diagram · ${this.fig.baseSymbol}–${this.fig.solute}`,
      size: [w, h],
      host,
      material: mixText(this.args[0]),
      mount(holder) {
        view = new PhaseFigureView({ frame: pdBigFrame(w, h), font: PD_BIG_FONT, scale: 1.4, primary: false });
        view.root.classList.add("pdfig--big");
        holder.append(view.root);
        if (self.args) view.update(...self.args);
        return {
          update() { if (self.args && view) view.update(...self.args); },
          destroy() { view?.root.remove(); view = null; },
        };
      },
      table() {
        const fig = self.fig;
        if (!fig || !self.args) return { head: [], rows: [], prov: [] };
        const rows = figureRows(fig);
        // six significant figures: a cited invariant (797.85 °C) prints as
        // cited, where five printed it 797.9
        const fc = columnFormat(rows.map(r => r[3]), 6), ft = columnFormat(rows.map(r => r[4]).filter(Number.isFinite), 6);
        return {
          head: ["element", "label", "point", `c_{${fig.solute}} (wt%)`, "T (°C)"],
          rows: rows.map(r => [r[0], r[1], r[2], fc(r[3]), Number.isFinite(r[4]) ? ft(r[4]) : "—"]),
          prov: figureProv(fig, self.args[0], rows.length),
          text: 3,
        };
      },
      csv: () => (self.fig && self.args ? figureCsv(self.fig, self.args[0]) : ""),
      png: () => (view ? svgToPng(view.svg, 2, false, view.keyEl) : Promise.resolve(null)),
      // the print figure at its own fixed size, not the window's (it came out
      // 300 wide on a phone, 648 at 800, with its key cut off)
      figurePng: printPng,
    }, () => { if (this.big === handle) this.big = null; });
    this.big = handle;
  }
}

/**
 * Paint a mounted figure's SVG onto a canvas, as a PNG: every element drawn
 * with its computed style (so the fonts are the page's own, which an SVG
 * rendered as an image cannot load), on the modal's --surface. `print` maps
 * each token the figure uses to its light print twin (tokens.css --print-*)
 * on --print-bg, with heavier lines: the same export the canvas figures have.
 */
export function svgToPng(svg: SVGElement, scale: number, print: boolean, key?: HTMLElement | null): Promise<Blob | null> {
  const vb = svg.getAttribute("viewBox")!.split(/\s+/).map(Number);
  const [W, H] = [vb[2], vb[3]];
  // the key (HTML under the figure) goes under the plot in the file too,
  // wrapped into rows that fit the width (one row lost its last entries off
  // the canvas: on a phone the solver's depression, the pour offset, the pour
  // and the regime), measured BEFORE the canvas is sized
  const items = key ? [...key.querySelectorAll<HTMLElement>(".pdkey__i")] : [];
  const keyFamily = key ? getComputedStyle(key).fontFamily : "";
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `400 11px ${keyFamily}`;
  const swW = (it: HTMLElement) => {
    const sw = it.querySelector<HTMLElement>(".pdkey__sw");
    return !sw ? 0 : sw.classList.contains("pdkey__dot") ? 12 : sw.classList.contains("pdkey__band") ? 18 : 22;
  };
  const placedKey: { it: HTMLElement; x: number; row: number }[] = [];
  {
    let x = 12, row = 0;
    for (const it of items) {
      const iw = swW(it) + probe.measureText((it.textContent ?? "").trim()).width;
      if (x > 12 && x + iw > W - 12) { row++; x = 12; }
      placedKey.push({ it, x, row });
      x += iw + 16;
    }
  }
  const keyRows = placedKey.length ? placedKey[placedKey.length - 1].row + 1 : 0;
  const keyH = keyRows ? keyRows * 16 + 10 : 0;
  const c = document.createElement("canvas");
  c.width = Math.round(W * scale); c.height = Math.round((H + keyH) * scale);
  const ctx = c.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const rgb = (v: string): string => {
    const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
    if (m) { const n = parseInt(m[1], 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }
    const r = /rgba?\(([^)]*)\)/.exec(v);
    return r ? r[1].split(/[\s,/]+/).slice(0, 3).map(Number).join(",") : v;
  };
  const MAP: [string, string][] = [
    // the data slots, in the order design/plot.ts gives them (one array)
    ...SLOTS.map((s, i): [string, string] => [s, PRINT_SLOTS[i]]),
    ["--fg", "--print-fg"], ["--fg-2", "--print-fg"], ["--fg-3", "--print-fg-2"], ["--fg-4", "--print-fg-2"],
    ["--rule-strong", "--print-fg-2"], ["--rule", "--print-fg-2"], ["--bg", "--print-bg"], ["--bg-media", "--print-bg"], ["--surface", "--print-bg"],
  ];
  const map = new Map(MAP.map(([a, b]) => [rgb(token(a)), token(b)]));
  const col = (v: string): string | null => {
    if (!v || v === "none" || /rgba\([^)]*,\s*0\)$/.test(v)) return null;
    return print ? (map.get(rgb(v)) ?? v) : v;
  };
  ctx.fillStyle = print ? token("--print-bg") : token("--surface");
  ctx.fillRect(0, 0, W, H + keyH);
  const wk = print ? 1.5 : 1;
  const stroke = (e: Element, cs: CSSStyleDeclaration, path: () => void) => {
    const s = col(cs.stroke);
    if (!s) return;
    ctx.save();
    ctx.globalAlpha = Number(cs.strokeOpacity || 1) * Number(cs.opacity || 1);
    ctx.strokeStyle = s;
    ctx.lineWidth = (parseFloat(cs.strokeWidth) || 1) * wk;
    const dash = cs.strokeDasharray && cs.strokeDasharray !== "none" ? cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite) : [];
    ctx.setLineDash(dash);
    ctx.lineJoin = "round";
    ctx.beginPath(); path(); ctx.stroke();
    ctx.restore();
  };
  const fill = (cs: CSSStyleDeclaration, path: () => void) => {
    const f = col(cs.fill);
    if (!f) return;
    ctx.save();
    ctx.globalAlpha = Number(cs.fillOpacity || 1) * Number(cs.opacity || 1);
    ctx.fillStyle = f;
    ctx.beginPath(); path(); ctx.fill();
    ctx.restore();
  };
  const visible = (e: Element) => {
    for (let p: Element | null = e; p && p !== svg; p = p.parentElement) {
      if (p.getAttribute("display") === "none" || getComputedStyle(p).display === "none") return false;
    }
    return true;
  };
  for (const e of svg.querySelectorAll("rect, path, line, circle, text")) {
    if (!visible(e) || e.closest(".pdhover")) continue;
    const cs = getComputedStyle(e);
    const n = (a: string) => parseFloat(e.getAttribute(a) ?? "0") || 0;
    const tag = e.tagName.toLowerCase();
    if (tag === "rect") {
      const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
      fill(cs, () => ctx.rect(x, y, w, h));
      stroke(e, cs, () => ctx.rect(x, y, w, h));
    } else if (tag === "line") {
      stroke(e, cs, () => { ctx.moveTo(n("x1"), n("y1")); ctx.lineTo(n("x2"), n("y2")); });
    } else if (tag === "circle") {
      const arc = () => ctx.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2);
      fill(cs, arc);
      stroke(e, cs, arc);
    } else if (tag === "path") {
      const d = e.getAttribute("d") ?? "";
      if (!d) continue;
      const seg = [...d.matchAll(/([ML])\s*([-\d.]+)[\s,]+([-\d.]+)/g)];
      stroke(e, cs, () => { for (const [, op, x, y] of seg) (op === "M" ? ctx.moveTo(+x, +y) : ctx.lineTo(+x, +y)); });
    } else if (tag === "text") {
      const f = col(cs.fill);
      if (!f) continue;
      ctx.save();
      const tr = e.getAttribute("transform");
      const m = tr ? /translate\(([-\d.]+)[\s,]+([-\d.]+)\)\s*rotate\(([-\d.]+)\)/.exec(tr) : null;
      if (m) { ctx.translate(+m[1], +m[2]); ctx.rotate((+m[3] * Math.PI) / 180); }
      const size = parseFloat(cs.fontSize) || 7;
      const anchor = e.getAttribute("text-anchor") ?? cs.textAnchor ?? "start";
      // a tspan with its own x and y (a readout's line) is placed there; the
      // text's own x and y are its anchor, placed by text-anchor below
      const spans = e.children.length ? [...e.children] : [e];
      const parts = spans.map(s => {
        const sub = s.getAttribute("baseline-shift") === "sub";
        const own = s !== e;
        return { text: s.textContent ?? "", size: sub ? size * 0.78 : size, dy: sub ? size * 0.26 : 0,
          x: own ? s.getAttribute("x") : null, y: own ? s.getAttribute("y") : null };
      });
      ctx.fillStyle = f;
      ctx.textBaseline = "alphabetic";
      const family = cs.fontFamily;
      const width = parts.reduce((a, p) => { ctx.font = `400 ${p.size}px ${family}`; return a + ctx.measureText(p.text).width; }, 0);
      let x = n("x") - (anchor === "middle" ? width / 2 : anchor === "end" ? width : 0);
      const y0 = n("y");
      for (const p of parts) {
        ctx.font = `400 ${p.size}px ${family}`;
        if (p.x != null && p.y != null) ctx.fillText(p.text, +p.x, +p.y);
        else { ctx.fillText(p.text, x, y0 + p.dy); x += ctx.measureText(p.text).width; }
      }
      ctx.restore();
    }
  }
  // the key: each swatch as it is styled (a line, dashed or solid; the pour's
  // dot; the band's tint), then its word
  for (const { it, x: kx, row } of placedKey) {
    const y = H + 14 + row * 16;
    let x = kx;
    const sw = it.querySelector<HTMLElement>(".pdkey__sw");
    if (!sw) continue;
    const cs = getComputedStyle(sw);
    if (sw.classList.contains("pdkey__dot")) {
      ctx.fillStyle = col(cs.backgroundColor) ?? "gray";
      ctx.beginPath(); ctx.arc(x + 4, y, 3.5, 0, Math.PI * 2); ctx.fill();
      x += 12;
    } else if (sw.classList.contains("pdkey__band")) {
      ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = col(cs.backgroundColor) ?? "gray"; ctx.fillRect(x, y - 5, 12, 10); ctx.restore();
      x += 18;
    } else {
      ctx.save();
      ctx.strokeStyle = col(cs.borderTopColor) ?? "gray";
      ctx.lineWidth = 2 * wk;
      ctx.setLineDash(cs.borderTopStyle === "dashed" ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.stroke();
      ctx.restore();
      x += 22;
    }
    ctx.font = `400 11px ${keyFamily}`;
    ctx.fillStyle = col(getComputedStyle(it).color) ?? "gray";
    ctx.textBaseline = "middle";
    ctx.fillText((it.textContent ?? "").trim(), x, y);
  }
  return new Promise(res => c.toBlob(res, "image/png"));
}
