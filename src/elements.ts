// The periodic table, and the question the composer has never been able to ask:
// what happens if you put THIS element into THIS melt?
//
// WHAT THIS FILE IS. One row per element, Z = 1 to 118, carrying atomic mass, a
// radius, a Pauling electronegativity, a melting point, a boiling point and an
// enthalpy of vaporisation, plus whether the element is primordial and which
// block it sits in. Beside it, `admit(base, element, wt)`: the classifier that
// places every one of the 6 x 118 = 708 (base, element) pairs into exactly one
// of four tiers and hands back the sentence saying why.
//
// FOUR OF THOSE SIX NUMBERS ARE READ BY A REFUSAL; TWO ARE CARRIED AND NOT.
// Mass, radius, T_b and ΔH_vap are consulted. `chiPauling` is not read anywhere
// in this repo, and neither is a row's own `Tm` — the vapour rule takes its
// temperature from the BASE's `MATERIALS[...].si.Tm`, not from the element's.
// They are recorded rather than used, and the electronegativity is worth a
// sentence: the difference in it is the OTHER Hume-Rothery rule, the
// electrochemical factor, and this file deliberately applies neither as a gate.
// Saying so here is cheaper than a reader discovering that a tabulated column
// decides nothing.
//
// WHAT THIS FILE IS NOT. It is not a thermodynamic model of anything, and it
// adds NO new pourable chemistry: the ASSESSED tier is exactly the 25 pairs
// alloy.ts already ships with a cited coefficient row and phasedata.ts already
// ships with a cited invariant row. Everything else this file can say about the
// other 683 pairs is a refusal, and the whole design intent is that a refusal
// carrying its own computed number teaches more than an element the user simply
// cannot see. "Mercury boils at 39 atm over liquid aluminium" is metallurgy;
// a greyed-out cell is nothing.
//
// SOURCES. Melting points, boiling points and enthalpies of vaporisation are
// the standard tabulated values — the CRC Handbook of Chemistry and Physics
// element tables and the WebElements pages that restate the same compilations.
// THOSE TWO DO NOT ALWAYS AGREE: gold's ΔH_vap is quoted as 324 and as 342
// kJ/mol and holmium's as 251 and as 265, spreads of about 6 %, and the rows
// concerned say which value they carry and what the alternative is rather than
// implying a single authority. Metallic radii are Teatum, Gschneidner & Waber
// CN12 (LA-4003, 1968) — the coordination-12 convention, so a bcc metal's radius
// here is the CN12-corrected one and NOT the nearest-neighbour a·√3/4. That
// distinction is not decorative: the first draft of this table applied the
// correction to the alkali and alkaline-earth bcc rows and not to the rest, so
// V, Cr, Nb, Mo, Ta and W — and radium, which is an s-block row that was missed
// along with them, so "the d-block ones" is not the right description of the
// group — all carried CN8 values while the file's own source string said they
// did not. Electronegativities are Pauling. Every row carries a
// per-block `source` naming the same, plus a row-specific clause wherever the
// row is tricky.
//
// THE ENTHALPY CONVENTION IS PER MOLE OF ATOMS. That is the natural basis for a
// table indexed by element, and it is exactly the basis Trouton's rule is NOT
// stated on — Trouton is about the entropy of vaporising one mole of the species
// that actually leaves the liquid. Nitrogen's 2.79 kJ/mol is half of N2's 5.58.
//
// AND THE CONVENTION IS NOT THE WHOLE EXPLANATION FOR THE LOW OUTLIERS, which
// the first draft of this comment claimed. Per mole of N2 nitrogen's ratio is
// 72 J/mol·K, still well below the window; the same is true of H2 (45), O2 (76)
// and F2 (77). The rest is that Trouton's 85–110 J/mol·K band was fitted to
// liquids boiling near 300–400 K, and the entropy of vaporisation rises with
// boiling point: the Trouton–Hildebrand–Everett form ΔS ≈ 36.6 + R·ln T_b
// returns 72.8 J/mol·K for nitrogen against a measured 72.1. Two mechanisms, and
// the rows name whichever one applies to them.
//
// `EL-TROUTON-CROSSCHECK` enumerates every row outside the window, pins its
// value, and requires each one to say in its own source string why — so this
// cannot rot into an unexamined allow-list.

import { BASES } from "./alloy";
import { BINARY } from "./phasedata";
import { MATERIALS } from "./materials";
import { soluteBound, phasesFor } from "./alloy";

export type Block = "s" | "p" | "d" | "f";

/**
 * Which convention the `radiusCN12` number was measured in.
 *
 * NOT DECORATION, AND NOT IN THE MILESTONE PLAN'S FIELD LIST. The plan's own
 * worked example is the reason it is here: Hume-Rothery's 15 % size rule returns
 * −39.6 % for Fe–C, which reads as a violent size mismatch and is in fact a
 * comparison between a metallic radius and a covalent one. Carbon has no
 * metallic form to measure a CN12 radius in. A size rule that does not know
 * which convention each of its two radii came from is not a rule, it is a
 * subtraction, and this field is what lets `sizeNote` say so out loud instead of
 * printing the number as though it meant something.
 */
export type RadiusKind = "teatum-cn12" | "covalent" | "none";

export interface ElementRow {
  symbol: string;
  Z: number;
  /** g/mol; for elements with no stable isotope, the mass number of the longest-lived one */
  mass: number;
  /** pm — see `radiusKind` for which convention, null when neither is tabulated */
  radiusCN12: number | null;
  radiusKind: RadiusKind;
  /** Pauling electronegativity; null where none is defined or measured */
  chiPauling: number | null;
  /** K at 1 atm; null where the element has no melting point at 1 atm or none is measured */
  Tm: number | null;
  /** K at 1 atm; null where unmeasured. For carbon and arsenic this is a SUBLIMATION point. */
  Tb: number | null;
  /** kJ per mole of ATOMS; null where unmeasured */
  dHvap: number | null;
  /** present on Earth since its formation — the operational test of "can you buy it" */
  primordial: boolean;
  block: Block;
  /** always non-empty */
  source: string;
}

const SRC: Record<Block, string> = {
  s: "s-block. Tm, Tb and ΔH_vap from the standard element tables (CRC Handbook and WebElements, which restate the same compilations and occasionally disagree; ΔH_vap per mole of atoms); metallic radius Teatum, Gschneidner & Waber CN12 (LA-4003, 1968), CN12-corrected and not the bcc nearest-neighbour a·√3/4; electronegativity Pauling.",
  p: "p-block. Tm, Tb and ΔH_vap from the standard element tables (CRC Handbook and WebElements; ΔH_vap per mole of atoms); radius as flagged by radiusKind — the non-metals of this block have no metallic form and carry a covalent radius from the classic Pauling set instead; electronegativity Pauling.",
  d: "d-block. Tm, Tb and ΔH_vap from the standard element tables (CRC Handbook and WebElements, which do not always agree — see the gold row; ΔH_vap per mole of atoms); metallic radius Teatum, Gschneidner & Waber CN12 (LA-4003, 1968), the coordination-12 convention — a bcc metal's number here is the CN12-corrected radius and NOT the nearest-neighbour a·√3/4, a correction the first draft of this table applied to the alkali and alkaline-earth rows and forgot on the rest; electronegativity Pauling.",
  f: "f-block, taken as the fifteen rows La to Lu and the fifteen Ac to Lr — the metallurgical grouping, which puts La and Ac here rather than in the d-block where their configurations belong, and leaves Hf and Rf in the d-block where theirs do. Tm, Tb and ΔH_vap from the CRC Handbook 97th ed. element tables (ΔH_vap per mole of atoms); metallic radius Teatum, Gschneidner & Waber CN12 (LA-4003, 1968); electronegativity Pauling. Beyond einsteinium the thermophysical properties are unmeasured and are carried as null rather than as a prediction.",
};

const el = (
  symbol: string, Z: number, mass: number,
  radiusCN12: number | null, radiusKind: RadiusKind,
  chiPauling: number | null,
  Tm: number | null, Tb: number | null, dHvap: number | null,
  primordial: boolean, block: Block, note?: string,
): ElementRow => ({
  symbol, Z, mass, radiusCN12, radiusKind, chiPauling, Tm, Tb, dHvap,
  primordial, block, source: note ? `${SRC[block]} ${note}` : SRC[block],
});

/** TROUTON: prefix marks a row whose ΔH_vap/T_b falls outside 85–110 J/mol·K, and says why. */
const T_ALKALI = "TROUTON: below the window, by amounts that run from under a joule for lithium and sodium — which sit at 84.2 and 84.3 against a lower edge of 85, and need no mechanism at all — to twenty for caesium, which does. This file does NOT claim to know the caesium one in a sentence: vapour dimerisation is the usual explanation and it is real, but the measured dimer fraction in saturated alkali vapour at the boiling point is a few per cent, which moves ΔS by a few J/mol·K and not by twenty. Carried as measured, with the deficit recorded rather than explained, because a refusal naming the wrong mechanism is a wrong statement rather than an absent one.";
const T_MOLEC = "TROUTON: this element vaporises as a MOLECULE and ΔH_vap is carried per mole of atoms here, so the ratio is a molecule's divided by its atom count. That accounts for part of the gap and not all of it — per mole of the vaporising species Cl2, Br2, I2 and P4 land inside the window while H2, N2, O2 and F2 stay below it, because Trouton's band was fitted to liquids boiling far higher (the Trouton–Hildebrand–Everett form 36.6 + R·ln T_b reproduces them).";
const T_QUANTUM = "TROUTON: a quantum liquid. Helium is the one row in this table that no correction reaches — the Trouton–Hildebrand–Everett form predicts 48.6 J/mol·K against a measured 19.6 — because liquid helium is dominated by zero-point motion rather than by cohesion. Neon was carried here in a first draft and does not belong: its 63.2 is within 1 J/mol·K of what the boiling-point correction alone predicts.";
const T_LOWBOIL = "TROUTON: below the window because it BOILS LOW, not because of anything exotic. Liquid argon is the textbook CLASSICAL Lennard-Jones liquid; the 85–110 J/mol·K band was fitted near 300–400 K and the entropy of vaporisation rises with boiling point (36.6 + R·ln T_b reproduces these rows).";
const T_HIGHBOIL = "TROUTON: above the window, and this row does NOT claim the boiling-point trend explains it. Trouton's 85–110 J/mol·K band was fitted to molecular liquids and metals systematically exceed it; the Trouton–Hildebrand–Everett correction 36.6 + R·ln T_b accounts for only part of the rise, topping out at 108.75 J/mol·K for rhenium, the highest-boiling row in this table, against a measured 138 for tungsten. The excess above that is real, is not a transcription error, and is not explained here.";
const T_SUBLIMES = "TROUTON: the ratio here is a SUBLIMATION entropy, not a vaporisation entropy — this element has no liquid at 1 atm — so Trouton's rule, which is a statement about liquid–vapour equilibrium, does not apply to it at all rather than being violated by it.";
const T_ESTIMATE = "TROUTON: outside the window on a value that is itself an estimate rather than a measurement; carried because a null here would hide the element from the vapour rule entirely, and flagged rather than trusted.";

/**
 * Z = 1 to 118, in order. The order IS the data: `ELEMENTS[i].Z === i + 1` is
 * asserted by `EL-TIER-TOTAL`, so a row inserted in the wrong place fails the
 * build rather than silently shifting the grid P5 draws from this array.
 */
export const ELEMENTS: ElementRow[] = [
  el("H", 1, 1.008, 37, "covalent", 2.20, 13.99, 20.27, 0.452, true, "s", `Radius is the covalent one; hydrogen has no metallic form at any pressure a foundry reaches. ${T_MOLEC}`),
  el("He", 2, 4.003, null, "none", null, null, 4.22, 0.0829, true, "s", `No melting point at 1 atm — helium stays liquid to 0 K unless compressed to ~2.5 MPa — so Tm is null rather than zero. ${T_QUANTUM}`),
  el("Li", 3, 6.94, 156, "teatum-cn12", 0.98, 453.7, 1615, 136, true, "s", T_ALKALI),
  el("Be", 4, 9.012, 113, "teatum-cn12", 1.57, 1560, 2742, 292, true, "s"),
  el("B", 5, 10.81, 87, "covalent", 2.04, 2349, 4200, 480, true, "p", `Radius is covalent: boron is a metalloid — β-rhombohedral boron is a wide-gap semiconductor, not a semimetal in the band-overlap sense that As, Sb and Bi are — with no CN12 metallic form. It is one of the FOUR elements this file screens with Hägg's interstitial criterion rather than with Hume-Rothery's 15 %, the others being C, N and H. ${T_HIGHBOIL}`),
  el("C", 6, 12.011, 77, "covalent", 2.55, null, 3915, 715, true, "p", `Tm is null on purpose: carbon has no melting point at 1 atm, it SUBLIMES at 3915 K, and the 4600 K figure often quoted is a triple point near 10 MPa. ΔH_vap is therefore the enthalpy of sublimation. Radius is covalent — the number that makes Hume-Rothery return a meaningless −39.6 % against iron. ${T_SUBLIMES}`),
  el("N", 7, 14.007, 75, "covalent", 3.04, 63.15, 77.36, 2.79, true, "p", `Radius covalent. ${T_MOLEC}`),
  el("O", 8, 15.999, 73, "covalent", 3.44, 54.36, 90.20, 3.41, true, "p", `Radius covalent. ${T_MOLEC}`),
  el("F", 9, 18.998, 71, "covalent", 3.98, 53.53, 85.03, 3.27, true, "p", `Radius covalent. ${T_MOLEC}`),
  el("Ne", 10, 20.180, null, "none", null, 24.56, 27.07, 1.71, true, "p", `No metallic or covalent radius is meaningful for a closed-shell monatomic gas. ${T_LOWBOIL}`),
  el("Na", 11, 22.990, 191, "teatum-cn12", 0.93, 370.9, 1156, 97.4, true, "s", T_ALKALI),
  el("Mg", 12, 24.305, 160, "teatum-cn12", 1.31, 923, 1363, 128, true, "s"),
  el("Al", 13, 26.982, 143, "teatum-cn12", 1.61, 933.5, 2792, 284, true, "p"),
  el("Si", 14, 28.085, 117, "covalent", 1.90, 1687, 3538, 359, true, "p", "Radius is covalent: silicon's diamond-cubic structure has coordination 4, not 12, so a CN12 metallic radius would be an extrapolation. The size note for Al–Si and Fe–Si says which convention it is subtracting."),
  el("P", 15, 30.974, 110, "covalent", 2.19, 317.3, 553.7, 12.4, true, "p", `Values are for white phosphorus, the form these tables are quoted in. ${T_MOLEC} Here the vapour is P4, so the per-atom ratio is a quarter of the molecular one.`),
  el("S", 16, 32.06, 104, "covalent", 2.58, 388.4, 717.8, 45.0, true, "p", `${T_MOLEC} Sulphur's vapour is a mixture of S8, S6 and S2 that shifts with temperature, so no single atom count converts it cleanly — the ratio here is indicative rather than exact.`),
  el("Cl", 17, 35.45, 99, "covalent", 3.16, 171.6, 239.11, 10.2, true, "p", `Radius covalent. ${T_MOLEC}`),
  el("Ar", 18, 39.948, null, "none", null, 83.80, 87.30, 6.43, true, "p", T_LOWBOIL),
  el("K", 19, 39.098, 238, "teatum-cn12", 0.82, 336.5, 1032, 79.1, true, "s", T_ALKALI),
  el("Ca", 20, 40.078, 197, "teatum-cn12", 1.00, 1115, 1757, 154.7, true, "s"),
  el("Sc", 21, 44.956, 164, "teatum-cn12", 1.36, 1814, 3109, 333, true, "d"),
  el("Ti", 22, 47.867, 146.2, "teatum-cn12", 1.54, 1941, 3560, 425, true, "d", T_HIGHBOIL),
  el("V", 23, 50.942, 134.6, "teatum-cn12", 1.63, 2183, 3680, 453, true, "d", T_HIGHBOIL),
  el("Cr", 24, 51.996, 128.2, "teatum-cn12", 1.66, 2180, 2944, 339, true, "d", T_HIGHBOIL),
  el("Mn", 25, 54.938, 135.0, "teatum-cn12", 1.55, 1519, 2334, 221, true, "d", "THE LEAST CERTAIN RADIUS IN THIS TABLE: α-Mn has 58 atoms per cell across four inequivalent sites with radii spanning roughly 1.24 to 1.45 Å, so there is no single CN12 radius to tabulate. 135 pm is the TGW value; equivalent-sphere estimates from the density give 129-131 pm and other compilations quote 127. Carried with the spread named rather than silently averaged."),
  el("Fe", 26, 55.845, 127.4, "teatum-cn12", 1.83, 1811, 3134, 340, true, "d"),
  el("Co", 27, 58.933, 125.2, "teatum-cn12", 1.88, 1768, 3200, 377, true, "d", T_HIGHBOIL),
  el("Ni", 28, 58.693, 124.6, "teatum-cn12", 1.91, 1728, 3186, 379, true, "d", T_HIGHBOIL),
  el("Cu", 29, 63.546, 127.8, "teatum-cn12", 1.90, 1358, 2835, 300, true, "d"),
  el("Zn", 30, 65.38, 139.4, "teatum-cn12", 1.65, 692.7, 1180, 115, true, "d"),
  el("Ga", 31, 69.723, 141.1, "teatum-cn12", 1.81, 302.9, 2477, 254, true, "p"),
  el("Ge", 32, 72.630, 122, "covalent", 2.01, 1211, 3106, 334, true, "p", "Radius covalent, for the same diamond-cubic reason as silicon."),
  el("As", 33, 74.922, 119, "covalent", 2.18, 1090, 887, 34.76, true, "p", `Tb here is a SUBLIMATION point and is BELOW Tm, which is not a transposition: arsenic sublimes at 887 K at 1 atm and only melts at 1090 K under its own vapour pressure of about 3.6 MPa. ${T_SUBLIMES} Its vapour is As4 rather than As as well, so neither basis brings it into the window.`),
  el("Se", 34, 78.971, 117, "covalent", 2.55, 494, 958, 95.48, true, "p", "Radius covalent."),
  el("Br", 35, 79.904, 114, "covalent", 2.96, 265.8, 332.0, 14.8, true, "p", `Radius covalent. ${T_MOLEC}`),
  el("Kr", 36, 83.798, null, "none", 3.00, 115.8, 119.9, 9.08, true, "p", T_LOWBOIL),
  el("Rb", 37, 85.468, 254.6, "teatum-cn12", 0.82, 312.5, 961, 69, true, "s", T_ALKALI),
  el("Sr", 38, 87.62, 215.1, "teatum-cn12", 0.95, 1050, 1655, 141, true, "s"),
  el("Y", 39, 88.906, 180.1, "teatum-cn12", 1.22, 1799, 3609, 390, true, "d"),
  el("Zr", 40, 91.224, 160.2, "teatum-cn12", 1.33, 2128, 4682, 591, true, "d", T_HIGHBOIL),
  el("Nb", 41, 92.906, 146.8, "teatum-cn12", 1.60, 2750, 5017, 690, true, "d", T_HIGHBOIL),
  el("Mo", 42, 95.95, 140.0, "teatum-cn12", 2.16, 2896, 4912, 598, true, "d", T_HIGHBOIL),
  el("Tc", 43, 98, 135.2, "teatum-cn12", 1.90, 2430, 4538, 660, false, "d", `The lightest element with no stable isotope: everything terrestrial is a fission product. ${T_HIGHBOIL}`),
  el("Ru", 44, 101.07, 133.9, "teatum-cn12", 2.20, 2607, 4423, 595, true, "d", T_HIGHBOIL),
  el("Rh", 45, 102.906, 134.5, "teatum-cn12", 2.28, 2237, 3968, 493, true, "d", T_HIGHBOIL),
  el("Pd", 46, 106.42, 137.6, "teatum-cn12", 2.20, 1828, 3236, 358, true, "d", T_HIGHBOIL),
  el("Ag", 47, 107.868, 144.5, "teatum-cn12", 1.93, 1235, 2435, 255, true, "d"),
  el("Cd", 48, 112.414, 156.8, "teatum-cn12", 1.69, 594.2, 1040, 100, true, "d"),
  el("In", 49, 114.818, 166.3, "teatum-cn12", 1.78, 429.7, 2345, 232, true, "p"),
  el("Sn", 50, 118.710, 162.0, "teatum-cn12", 1.96, 505.1, 2875, 296, true, "p"),
  el("Sb", 51, 121.760, 159, "teatum-cn12", 2.05, 903.8, 1860, 193.4, true, "p"),
  el("Te", 52, 127.60, 137, "covalent", 2.10, 722.7, 1261, 114.1, true, "p", "Radius covalent — tellurium's chain structure is not close-packed."),
  el("I", 53, 126.904, 133, "covalent", 2.66, 386.9, 457.4, 20.9, true, "p", `Radius covalent. ${T_MOLEC}`),
  el("Xe", 54, 131.293, null, "none", 2.60, 161.4, 165.1, 12.57, true, "p", T_LOWBOIL),
  el("Cs", 55, 132.905, 273.1, "teatum-cn12", 0.79, 301.6, 944, 66, true, "s", T_ALKALI),
  el("Ba", 56, 137.327, 224.3, "teatum-cn12", 0.89, 1000, 2118, 140, true, "s", "TROUTON: below the window at 66 J/mol·K, on a ΔH_vap that is among the less well constrained of the alkaline earths — which is the honest half of the explanation and the only half this row now makes. A first draft also blamed vapour dimerisation; Ba2 is a van der Waals dimer rather than a chemically bonded one, and at 2118 K its equilibrium concentration is negligible, so that mechanism cannot supply a 20 J/mol·K deficit."),
  el("La", 57, 138.905, 187.7, "teatum-cn12", 1.10, 1193, 3737, 400, true, "f"),
  el("Ce", 58, 140.116, 182.4, "teatum-cn12", 1.12, 1068, 3716, 398, true, "f"),
  el("Pr", 59, 140.908, 182.8, "teatum-cn12", 1.13, 1208, 3793, 331, true, "f"),
  el("Nd", 60, 144.242, 182.1, "teatum-cn12", 1.14, 1297, 3347, 289, true, "f"),
  el("Pm", 61, 145, 181.0, "teatum-cn12", 1.13, 1315, 3273, 289, false, "f", "No stable isotope and no primordial survivor; terrestrial promethium is a fission product."),
  el("Sm", 62, 150.36, 180.4, "teatum-cn12", 1.17, 1345, 2067, 192, true, "f"),
  el("Eu", 63, 151.964, 204.2, "teatum-cn12", 1.20, 1099, 1802, 176, true, "f"),
  el("Gd", 64, 157.25, 180.1, "teatum-cn12", 1.20, 1585, 3546, 301, true, "f", "TROUTON: 84.9 J/mol·K, one tenth of a unit under the window's lower edge. Recorded as measured rather than nudged inside — the window is a soft empirical band and this row is sitting on it, which is a different statement from an outlier with a mechanism."),
  el("Tb", 65, 158.925, 178.3, "teatum-cn12", 1.10, 1629, 3503, 391, true, "f", T_HIGHBOIL),
  el("Dy", 66, 162.500, 177.5, "teatum-cn12", 1.22, 1680, 2840, 280, true, "f"),
  el("Ho", 67, 164.930, 176.7, "teatum-cn12", 1.23, 1734, 2993, 265, true, "f", "COMPILATION SPLIT: ΔH_vap is quoted as 265 kJ/mol and as 251, about 6 % apart. 265 is carried, and here the difference is not cosmetic: on 251 the Trouton ratio is 83.9 J/mol·K, just OUTSIDE the window, so the choice of compilation decides whether this row is an outlier at all. Recorded rather than resolved."),
  el("Er", 68, 167.259, 175.8, "teatum-cn12", 1.24, 1802, 3141, 280, true, "f"),
  el("Tm", 69, 168.934, 174.7, "teatum-cn12", 1.25, 1818, 2223, 191, true, "f"),
  el("Yb", 70, 173.045, 194.0, "teatum-cn12", 1.10, 1097, 1469, 129, true, "f"),
  el("Lu", 71, 174.967, 173.5, "teatum-cn12", 1.27, 1925, 3675, 414, true, "f", T_HIGHBOIL),
  el("Hf", 72, 178.486, 158.0, "teatum-cn12", 1.30, 2506, 4876, 648, true, "d", T_HIGHBOIL),
  el("Ta", 73, 180.948, 146.7, "teatum-cn12", 1.50, 3290, 5731, 743, true, "d", T_HIGHBOIL),
  el("W", 74, 183.84, 140.8, "teatum-cn12", 2.36, 3695, 5828, 806, true, "d", T_HIGHBOIL),
  el("Re", 75, 186.207, 137.1, "teatum-cn12", 1.90, 3459, 5869, 704, true, "d", T_HIGHBOIL),
  el("Os", 76, 190.23, 135.3, "teatum-cn12", 2.20, 3306, 5285, 678, true, "d", T_HIGHBOIL),
  el("Ir", 77, 192.217, 135.7, "teatum-cn12", 2.20, 2719, 4701, 564, true, "d", T_HIGHBOIL),
  el("Pt", 78, 195.084, 138.7, "teatum-cn12", 2.28, 2041, 4098, 510, true, "d", T_HIGHBOIL),
  el("Au", 79, 196.967, 144.2, "teatum-cn12", 2.54, 1337, 3129, 342, true, "d", "COMPILATION SPLIT: ΔH_vap is quoted as 342 kJ/mol in some compilations and as 324 in others (WebElements gives 330), a spread of about 6 %. 342 is carried; on 324 the Trouton ratio moves from 109.3 to 103.6 J/mol·K and stays inside the window either way, so nothing downstream distinguishes them and neither is presented as the authority."),
  el("Hg", 80, 200.592, 157.3, "teatum-cn12", 2.00, 234.3, 629.9, 59.1, true, "d"),
  el("Tl", 81, 204.38, 171.6, "teatum-cn12", 1.62, 577, 1746, 165, true, "p"),
  el("Pb", 82, 207.2, 175.0, "teatum-cn12", 2.33, 600.6, 2022, 179.5, true, "p"),
  el("Bi", 83, 208.980, 170.0, "teatum-cn12", 2.02, 544.6, 1837, 179, true, "p", "The heaviest element with a quasi-stable nuclide: Bi-209 is formally radioactive with a half-life around 2·10^19 years, a billion times the age of the universe, which is why this row is primordial and polonium's is not. It is NOT the heaviest primordial element — thorium and uranium are both primordial and both heavier, as their own rows in this table say."),
  el("Po", 84, 209, 167, "teatum-cn12", 2.00, 527, 1235, 102.9, false, "p", `Not primordial: polonium exists on Earth only as a short-lived member of the natural decay chains — Po-218/214/210 in the U-238 series, Po-216/212 in the Th-232 series, Po-215/211 in the U-235 series. ${T_ESTIMATE}`),
  el("At", 85, 210, 150, "covalent", 2.20, 575, null, null, false, "p", "Not primordial, and essentially unweighable — the total terrestrial inventory is estimated at under a gram. Tb and ΔH_vap are carried as null rather than as the extrapolations sometimes quoted; the melting point is an extrapolation as well, kept only because nothing in this app reads an element's own Tm."),
  el("Rn", 86, 222, null, "none", 2.20, 202, 211.5, 16.4, false, "p", `Not primordial: a decay-chain gas with a 3.8-day half-life. ${T_LOWBOIL}`),
  el("Fr", 87, 223, 260, "teatum-cn12", 0.70, 300, null, null, false, "s", "Not primordial and never seen in bulk — francium's longest-lived isotope has a 22-minute half-life, so the radius is an extrapolation and Tb and ΔH_vap are null. THE MELTING POINT IS AN EXTRAPOLATION TOO, down the alkali trend, and it is kept where the other two are nulled for a reason: nothing in this app reads an element's own Tm, while Tb and ΔH_vap feed the vapour rule directly — an extrapolated Tm is inert, an extrapolated ΔH_vap would print a number."),
  el("Ra", 88, 226, 229, "teatum-cn12", 0.90, 973, 2010, 113, false, "s", `Not primordial: a decay-chain member with a 1600-year half-life. ${T_ESTIMATE}`),
  el("Ac", 89, 227, 187.8, "teatum-cn12", 1.10, 1323, 3471, 400, false, "f", `Not primordial: a decay-chain member with a 22-year half-life. ${T_HIGHBOIL}`),
  el("Th", 90, 232.038, 179.8, "teatum-cn12", 1.30, 2115, 5061, 514, true, "f", "Primordial: Th-232 has a half-life of 1.4·10^10 years and thorium is more abundant in the crust than tin."),
  el("Pa", 91, 231.036, 160.6, "teatum-cn12", 1.50, 1841, 4300, 481, false, "f", `Not primordial: protactinium is a U-235 decay-chain member with a 33,000-year half-life. Its mass is LOWER than thorium's despite the higher Z, because these are the masses of the longest-lived isotopes and not of a natural abundance mixture. ${T_HIGHBOIL}`),
  el("U", 92, 238.029, 156.0, "teatum-cn12", 1.38, 1405, 4404, 417, true, "f", "Primordial: U-238's half-life is 4.5·10^9 years, about the age of the Earth."),
  el("Np", 93, 237, 153, "teatum-cn12", 1.36, 917, 4273, 336, false, "f", T_ESTIMATE),
  el("Pu", 94, 244, 164, "teatum-cn12", 1.28, 913, 3501, 325, false, "f"),
  el("Am", 95, 243, 173, "teatum-cn12", 1.13, 1449, 2880, 238.5, false, "f", T_ESTIMATE),
  el("Cm", 96, 247, 174, "teatum-cn12", 1.28, 1613, 3383, 320, false, "f"),
  el("Bk", 97, 247, 170, "teatum-cn12", 1.30, 1259, 2900, 310, false, "f", "Mass equal to curium's: both rows carry the mass number of the longest-lived isotope, and those happen to coincide at 247."),
  el("Cf", 98, 251, 169.5, "teatum-cn12", 1.30, 1173, 1743, 196, false, "f", `Radius derived from the reported dhcp lattice (a ≈ 339 pm, so r = a/2), because no CN12 tabulation exists this far up. The first draft carried 186 pm, which is the empirical ATOMIC radius and broke the actinide metallic series. ${T_ESTIMATE}`),
  el("Es", 99, 252, 203, "teatum-cn12", 1.30, 1133, null, null, false, "f", "The last actinide with a measured melting point; Tb and ΔH_vap are null because no measurement exists. The radius is derived from the reported fcc lattice (a ≈ 575 pm) and the jump above californium is REAL and diagnostic — einsteinium is divalent in the metallic state, the actinide analogue of europium and ytterbium, which is why its metal is so much less dense than its neighbours."),
  el("Fm", 100, 257, null, "none", null, null, null, null, false, "f", "From fermium on, nothing thermophysical has been measured: these elements have been produced atom at a time. Every physical field is null rather than a prediction."),
  el("Md", 101, 258, null, "none", null, null, null, null, false, "f"),
  el("No", 102, 259, null, "none", null, null, null, null, false, "f"),
  el("Lr", 103, 266, null, "none", null, null, null, null, false, "f"),
  el("Rf", 104, 267, null, "none", null, null, null, null, false, "d", "Transactinide: produced in single-atom quantities with half-lives measured in seconds. Every physical field is null."),
  el("Db", 105, 268, null, "none", null, null, null, null, false, "d"),
  el("Sg", 106, 269, null, "none", null, null, null, null, false, "d"),
  el("Bh", 107, 270, null, "none", null, null, null, null, false, "d", "Mass HIGHER than hassium's below it: these are longest-lived-isotope mass numbers, and Bh-270 outlives Hs-269."),
  el("Hs", 108, 269, null, "none", null, null, null, null, false, "d"),
  el("Mt", 109, 278, null, "none", null, null, null, null, false, "d"),
  el("Ds", 110, 281, null, "none", null, null, null, null, false, "d"),
  el("Rg", 111, 282, null, "none", null, null, null, null, false, "d"),
  el("Cn", 112, 285, null, "none", null, null, null, null, false, "d"),
  el("Nh", 113, 286, null, "none", null, null, null, null, false, "p"),
  el("Fl", 114, 289, null, "none", null, null, null, null, false, "p"),
  el("Mc", 115, 290, null, "none", null, null, null, null, false, "p"),
  el("Lv", 116, 293, null, "none", null, null, null, null, false, "p"),
  el("Ts", 117, 294, null, "none", null, null, null, null, false, "p", "Group 17 by position, and this file deliberately does NOT refuse it as a halogen: a few dozen atoms of tennessine have ever existed and no chemistry of it has been measured. The refusal it gets is the one that needs no inference."),
  el("Og", 118, 294, null, "none", null, null, null, null, false, "p", "Group 18 by position, and refused for availability rather than as a noble gas, for the same reason as tennessine — and with the added wrinkle that relativistic calculations suggest oganesson may not be a gas at all."),
];

/** symbol -> row. Built once; `EL-TIER-TOTAL` asserts it holds all 118. */
export const BY_SYMBOL: Record<string, ElementRow> = Object.fromEntries(
  ELEMENTS.map(e => [e.symbol, e]),
);

// ---------------------------------------------------------------------------
// THE TIERS
//
// Four, and every one of the 708 pairs lands in exactly one. The two REFUSED
// tiers are not the same statement and the difference is the whole point:
//
//   REFUSED-PAIR       we have nothing to say about this pair. Epistemic.
//   OUTSIDE-THE-MODEL  we know exactly what this melt does and this solver
//                      structurally cannot carry it. Not ignorance — a
//                      named limit of a one-solute-field, one-solid-phase code.
//
// The milestone plan listed DEMIXES and PAST-THE-INVARIANT under REFUSED-PAIR
// and then defined OUTSIDE-THE-MODEL as "monotectics, intermetallic refiners
// past their invariant" — which is the same two things. Grouped the plan's way,
// OUTSIDE-THE-MODEL has no members at all and is a tier that exists only in a
// comment. They are placed by the definition rather than by the list.

export type AdmitTier =
  /** a cited coefficient row AND a cited invariant row, at a composition this solver can pour */
  | "ASSESSED"
  /** real casting chemistry, named, that a one-phase one-solute-field solver cannot carry */
  | "OUTSIDE-THE-MODEL"
  /** this model has entered nothing about this pair */
  | "REFUSED-PAIR"
  /**
   * Excluded from this composer's solute set for an ELEMENT-level reason, one
   * that does not depend on which melt you are standing over.
   *
   * IT IS A MODELLING DECISION AND NOT A CLAIM ABOUT NATURE, and the honest
   * sentences underneath it make the difference visible: oxygen in copper is a
   * deliberate compositional variable — tough-pitch copper carries 0.02–0.05
   * wt% of it, and "oxygen-free" versus "tough pitch" is a grade distinction —
   * and this tier still refuses it, because the composer does not admit H, N or
   * O and because nothing here carries an oxide phase. The tier is uniform; the
   * reason a user is shown is not, and that cell is the one that tests it.
   */
  | "NOT-A-SOLUTE";

export type AdmitReason =
  | "CITED-PAIR"
  | "PAST-THE-INVARIANT" | "DEMIXES"
  | "NO-ASSESSMENT" | "NOT-CHECKED-FOR-DEMIXING" | "IS-THE-BASE" | "NOT-A-COMPOSITION"
  | "NOBLE-GAS" | "HALOGEN" | "GAS-SPECIES" | "NOT-PRIMORDIAL";

const TIER_OF: Record<AdmitReason, AdmitTier> = {
  "CITED-PAIR": "ASSESSED",
  "PAST-THE-INVARIANT": "OUTSIDE-THE-MODEL",
  "DEMIXES": "OUTSIDE-THE-MODEL",
  "NO-ASSESSMENT": "REFUSED-PAIR",
  "NOT-CHECKED-FOR-DEMIXING": "REFUSED-PAIR",
  "IS-THE-BASE": "REFUSED-PAIR",
  "NOT-A-COMPOSITION": "REFUSED-PAIR",
  "NOBLE-GAS": "NOT-A-SOLUTE",
  "HALOGEN": "NOT-A-SOLUTE",
  "GAS-SPECIES": "NOT-A-SOLUTE",
  "NOT-PRIMORDIAL": "NOT-A-SOLUTE",
};

/** `a`, `a and b`, `a, b and c` — not `a and b and c`, which three joins gave. */
const serial = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * The systems that have been CHECKED for a liquid miscibility gap, and found to
 * have one. THIS LIST IS NOT THE SET OF MONOTECTICS — it is the set this app has
 * looked at, it was hand-entered, and it fails open. Everything downstream of it
 * is worded so that an unlisted system is refused for an UNCHECKED mechanism and
 * never for an asserted one, because a refusal naming the wrong mechanism is a
 * wrong statement rather than an absent one.
 *
 * Miedema's ΔH_mix was considered as the way to close the list and rejected: its
 * sign gives neither a gap temperature nor a gap composition, and the scheme
 * overestimates dilute liquid excess enthalpies by roughly a quarter, so it
 * would put an INFERRED refusal on screen in a file whose whole claim is that
 * every refusal is computed from a cited number.
 */
export const DEMIX_CHECKED: Record<string, string> = {
  "cu-Pb": "Cu–Pb has a liquid miscibility gap with a monotectic at 955 °C: the melt separates into a copper-rich and a lead-rich liquid, which is exactly what leaded bronzes exploit and exactly what a solver carrying ONE liquid cannot represent.",
  "al-Bi": "Al–Bi has a liquid miscibility gap with a monotectic at 657 °C, a few degrees above pure aluminium's melting point — two liquids, and this solver has one.",
  "al-In": "Al–In has a liquid miscibility gap with a monotectic at 639 °C — two liquids, and this solver has one.",
  "al-Pb": "Al–Pb has a liquid miscibility gap with a monotectic at 659 °C; the lead-rich liquid is what makes free-machining aluminium free-machining, and it is a second liquid phase this solver does not carry.",
  "fe-Ag": "Fe–Ag is one of the widest liquid miscibility gaps among the transition metals — iron and silver are very nearly immiscible as liquids — so there is no single melt for this solver to freeze.",
};

/** every element that appears on at least one side of DEMIX_CHECKED */
const DEMIX_ELEMENTS = [...new Set(Object.keys(DEMIX_CHECKED).map(k => k.split("-")[1]))];

const NOBLE = ["He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"];
const HALOGEN = ["F", "Cl", "Br", "I", "At", "Ts"];
/** H, N and O ONLY — see `gasSentence` for why S and P are deliberately not here */
const GAS_SPECIES = ["H", "N", "O"];
/** screened by Hägg's r/R criterion instead of by Hume-Rothery's 15 % */
const INTERSTITIAL = ["C", "N", "B", "H"];
/**
 * Hägg's r/R limit for a simple interstitial structure. EXPORTED so the doc gate
 * can hold the number the honesty page prints against the one the code screens
 * with — review found that moving it to 0.90 left all six gates green, because
 * the page carried the literal 0.59 and nothing tied the two together.
 */
export const HAGG_LIMIT = 0.59;
const R_GAS = 8.314462618;   // J/mol·K
/**
 * Elements whose saturated vapour is molecular rather than monatomic, so the
 * per-atom ΔH_vap this table stores is the wrong basis for Clausius–Clapeyron.
 * Every metal is monatomic in the vapour and is absent from this list; none of
 * these is an assessed solute, so no pinned advisory depends on it.
 */
const MOLECULAR_VAPOUR = ["H", "N", "O", "F", "Cl", "Br", "I", "P", "S", "As", "Se"];
/**
 * Hägg's criterion is a statement about TRANSITION-METAL interstitial compounds
 * — the hydrides, carbides, nitrides and borides of Ti, V, Cr, Fe and their
 * neighbours. It does not transfer to a base outside that group — and "sp-metal"
 * is the wrong words for that group, since copper and zinc are d-block rows in
 * this same table — where the same ratio
 * would cheerfully imply that aluminium forms a simple interstitial carbide.
 * It does not: Al4C3 is a salt-like carbide and carbon's solubility in liquid
 * aluminium is negligible.
 */
const HAGG_BASES = ["fe", "ni"];

// ---------------------------------------------------------------------------
// THE VAPOUR RULE — AN ADVISORY, NEVER A REFUSAL.
//
//   p_i = x_i · exp(−ΔH_vap/R · (1/T − 1/T_b))
//
// Clausius–Clapeyron anchored at the boiling point, where p = 1 atm by
// definition, times Raoult's law for the mole fraction. Two tabulated numbers
// per element and the base's own melting point, and it reproduces foundry
// practice: zinc reads 59 atm over liquid iron, which is why zinc-coated scrap
// fumes off as ZnO in a steel charge — a yield loss, a fume hazard and a
// baghouse-dust problem, and NOT a prohibition, because coated scrap is normal
// EAF feedstock and an entire zinc-recovery industry exists downstream of it;
// magnesium reads 16 atm, which is why nodularising ductile iron is a plunge and
// not a stir; manganese reads 0.037 atm, which is a welding-fume hazard and
// correctly NOT a reason to refuse manganese steel.
//
// THE ENTHALPY MUST BE PER MOLE OF THE VAPOUR SPECIES, which is not always the
// per-atom basis this table stores. p° obeys d(ln p)/d(1/T) = −ΔH/R with ΔH per
// mole of the gaseous molecule — for phosphorus that is P4, four times the
// per-atom number — while Raoult's x is expressed on whatever basis you like,
// and the two are independent. So the rule DECLINES to print a pressure for the
// elements whose vapour is molecular rather than monatomic, instead of printing
// one that is wrong by a factor of the atom count. Every element that can reach
// a real melt through this composer has a monatomic vapour, so where the rule
// runs the two bases coincide exactly.
//
// AND IT IS NOT A REFUSAL, because as a refusal it is wrong. Cu–30Zn computes
// 1.4 atm and brass exists: zinc's activity in copper is far below ideal
// (ΔH_mix ≈ −6 kJ/mol), and the activity coefficient that would fix the number
// is exactly what this app does not have. Every line at or above the fume band
// says that out loud rather than letting an ideal-solution number pass as a
// prediction.
//
// THE TEMPERATURE IS THE PURE BASE'S MELTING POINT, not the mix's liquidus. For
// 93 of the 118 columns there is no coefficient row to depress a liquidus with,
// and a rule whose temperature basis changed from column to column would not be
// comparable across the grid it is drawn on. The size of what that costs is
// measured rather than asserted: EL-VAPOUR-ADVISORY recomputes every assessed
// pair at its own depressed liquidus and records the largest shift.

export type VapourBand = "NO-DATA" | "NEGLIGIBLE" | "FUME" | "BOILS";

/**
 * The pressure at which an addition stops being a curiosity and starts being a
 * fume hazard, in atm, and the activity-coefficient headroom the NEGLIGIBLE
 * band's sentence claims for itself.
 *
 * BOTH ARE EXPORTED BECAUSE THE SENTENCE IS AN ARITHMETIC CLAIM ABOUT THEM. The
 * NEGLIGIBLE band is the one place this rule drops its ideality caveat, and what
 * replaces it is "even a hundredfold activity-coefficient correction leaves this
 * under the 0.01 atm fume threshold" — true only while the cutoff IS the
 * threshold divided by the headroom. Carried as a bare 1e-4 it was a magic
 * number that could be moved to 1e-3 without any gate noticing, at which point
 * the app printed a sentence that its own arithmetic contradicts by a factor of
 * eight. EL-VAPOUR-ADVISORY now asserts the relation rather than the value.
 */
export const FUME_ATM = 0.01;
export const GAMMA_HEADROOM = 100;

export interface VapourAdvisory {
  base: string;
  el: string;
  wt: number;
  /** mole fraction of the element in this binary at `wt` */
  x: number;
  /** K — the pure base's melting point */
  T: number;
  /** atm at x = 1: the pair's headline number, independent of composition */
  pPure: number;
  /** atm at this composition */
  p: number;
  band: VapourBand;
  /** always non-empty; contains the computed pressure and the word "atm" whenever there is one */
  text: string;
}

/**
 * A weight that cannot be poured, described rather than echoed. Interpolating
 * the value directly put the literal string "NaN" in front of a user — which is
 * the one thing a readout should never do, and which `EL-TIER-TOTAL` now bans
 * across every advisory line. A real number is still quoted, because "-1 wt%"
 * and "101 wt%" are informative in a way that "not a number" is not.
 */
const describeWt = (wt: number): string =>
  Number.isNaN(wt) ? "that weight is not a number at all"
    : wt === Infinity || wt === -Infinity ? "that weight is infinite"
      : `${wt} wt% is not a composition`;

const fmtP = (p: number): string =>
  p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p >= 1e-3 ? p.toFixed(3) : p.toExponential(1);

/** mole fraction of `wt` wt% of an element of mass `mEl` in a base of mass `mBase` */
export function moleFraction(wt: number, mEl: number, mBase: number): number {
  const n = wt / mEl, nb = (100 - wt) / mBase;
  return n + nb > 0 ? n / (n + nb) : 0;
}

/**
 * The vapour pressure this element would exert over this melt, ideally.
 * `null` when the base is unknown, the element is unknown, or the element
 * carries no boiling point and no enthalpy of vaporisation — three different
 * reasons, and the last one is reported rather than silently skipped.
 */
export function vapourAt(baseKey: string, elSym: string, wt: number, TOverride?: number): VapourAdvisory | null {
  const base = Object.hasOwn(BASES, baseKey) ? BASES[baseKey] : undefined;
  const row = Object.hasOwn(BY_SYMBOL, elSym) ? BY_SYMBOL[elSym] : undefined;
  if (!base || !row) return null;
  const T = TOverride ?? MATERIALS[base.materialKey]?.si?.Tm ?? NaN;
  // OUT OF RANGE IS NOT CLAMPED, IT IS REFUSED. The first repair caught only a
  // non-finite weight, and `Math.max(0, Math.min(100, wt))` then quietly turned
  // −1 wt% into 0 and printed "Cr at −1 wt% (x = 0.000) exerts 0.0e+0 atm,
  // which is negligible" — the same floored-zero advisory, reached by the other
  // door. A weight this function cannot use is named, never floored.
  const held = Number.isFinite(wt) && wt >= 0 && wt <= 100 ? wt : NaN;
  const x = Number.isFinite(held) ? moleFraction(held, row.mass, base.mass) : NaN;
  // A NON-FINITE WEIGHT USED TO PRINT A CLEAN ZERO. `moleFraction`'s
  // `n + nb > 0 ? … : 0` guard swallowed a NaN into x = 0, so the advisory
  // computed 0 atm and the NEGLIGIBLE band, and the only trace left was the
  // literal word in the prose — "Cr at NaN wt% exerts 0.0e+0 atm, which is
  // negligible". A number this app cannot compute is refused, not floored.
  if (!Number.isFinite(held)) {
    return { base: baseKey, el: elSym, wt, x: NaN, T, pPure: NaN, p: NaN, band: "NO-DATA",
      text: `${describeWt(wt)}, so there is no composition to evaluate ${elSym}'s vapour pressure at — nothing is computed rather than a zero being printed.` };
  }
  // ONE CELL OF THE GRID EXTRAPOLATES PAST A CRITICAL POINT, and it is named
  // rather than modelled. Clausius–Clapeyron with a temperature-independent
  // ΔH_vap describes a liquid in equilibrium with its vapour, and above the
  // element's critical temperature there is no such equilibrium and no vapour
  // pressure to compute. Mercury's critical point is about 1750 K; liquid iron
  // melts at 1811 K. Every other pairing in this grid stays below the element's
  // critical temperature, so this is the single cell affected, and it prints a
  // refusal rather than a large confident number.
  if (elSym === "Hg" && T > 1750) {
    return { base: baseKey, el: elSym, wt, x, T, pPure: NaN, p: NaN, band: "NO-DATA",
      text: `${base.label} melts at ${(T - 273.15).toFixed(0)} °C, above mercury's critical temperature of about 1477 °C. Past a critical point there is no liquid in equilibrium with a vapour and therefore no vapour pressure at all, so this rule does not extrapolate into it — mercury and molten iron do not coexist as two phases in the sense this number would describe.` };
  }
  if (MOLECULAR_VAPOUR.includes(elSym)) {
    return { base: baseKey, el: elSym, wt, x, T, pPure: NaN, p: NaN, band: "NO-DATA",
      text: `${elSym}'s vapour is molecular rather than monatomic, and Clausius–Clapeyron needs an enthalpy per mole of the species that leaves the liquid. This table stores ΔH_vap per mole of ATOMS, so the exponent would be wrong by the atom count — no pressure is printed rather than one that is off by a factor of two, four or eight.` };
  }
  if (!Number.isFinite(T) || row.Tb == null || row.dHvap == null) {
    return {
      base: baseKey, el: elSym, wt, x, T, pPure: NaN, p: NaN, band: "NO-DATA",
      text: row.Tb == null || row.dHvap == null
        ? `no boiling point or enthalpy of vaporisation has been measured for ${elSym}, so no vapour pressure over liquid ${base.label} is computed — the two numbers the rule needs do not exist for this element.`
        : `${base.label} carries no melting point in this build, so there is no temperature to evaluate ${elSym}'s vapour pressure at.`,
    };
  }
  const pPure = Math.exp(-(row.dHvap * 1000) / R_GAS * (1 / T - 1 / row.Tb));
  const p = x * pPure;
  const band: VapourBand = p >= 1 ? "BOILS" : p >= FUME_ATM ? "FUME" : "NEGLIGIBLE";
  const head = `at ${base.label}'s ${(T - 273.15).toFixed(0)} °C melting point, ${elSym} at ${wt} wt% (x = ${x.toFixed(3)}) exerts ${fmtP(p)} atm`;
  const pure = `pure ${elSym} would exert ${fmtP(pPure)} atm at that temperature`;
  // The ideality caveat rides every line that could change a decision, and is
  // replaced by the reason it cannot matter on the lines that could not.
  // AND WHERE THE APP ALREADY KNOWS THE SOLUTION IS NOT IDEAL, IT SAYS SO. A
  // pair on the checked-monotectic list has a liquid miscibility gap, which is
  // an activity coefficient far above one by definition — so handing it a
  // Raoult number with the generic "this app does not carry that correction"
  // caveat would be two statements about the same melt that do not agree.
  const knownNonIdeal = Object.hasOwn(DEMIX_CHECKED, `${baseKey}-${elSym}`);
  const ideal = knownNonIdeal
    ? `This is Raoult's law times Clausius–Clapeyron and it assumes an IDEAL solution, which for THIS pair is known to be false: ${base.symbol}–${elSym} has a liquid miscibility gap, and a miscibility gap IS an activity coefficient far above one. The number above is what an ideal solution would do and this pair is not one, so read it as an ordering rather than as a pressure.`
    : `This is Raoult's law times Clausius–Clapeyron: it assumes an IDEAL solution, and the activity coefficient that would correct it is a number this app does not carry. Cu–30Zn computes 1.4 atm by this rule and brass is real, so the rule advises and never refuses.`;
  // THE NEGLIGIBLE BAND IS THE ONE PLACE THE IDEALITY CAVEAT IS DROPPED, so the
  // claim that replaces it has to be true. "No activity coefficient could lift a
  // number this small" is not: strongly positive-deviation systems reach γ° of
  // 10-100 and more, and this app contains a counterexample — lead in iron at
  // 1 wt% computes 7.8e-4 atm here while γ°(Pb in liquid Fe) is of order 100 to
  // 1000, which puts the corrected pressure in or above the fume band. The
  // claim is therefore made only where a hundredfold correction still cannot
  // cross the 0.01 atm threshold, and the caveat rides every line above that.
  const safeFromGamma = p * GAMMA_HEADROOM < FUME_ATM;
  const text = band === "BOILS"
    ? `${head}, above one atmosphere — ${pure}, so this addition would boil out of the melt as fast as it went in unless the melt is held under pressure or the element is plunged. ${ideal}`
    : band === "FUME"
      ? `${head} — ${pure}. Below a boil and well above nothing: this is the fume band, where the addition survives the melt and the fume is a hazard rather than a loss. ${ideal}`
      : safeFromGamma
        ? `${head}, which is negligible — ${pure}. Even a ${GAMMA_HEADROOM}-fold activity-coefficient correction leaves this under the ${FUME_ATM} atm fume threshold, which is why this line does not carry the ideality caveat the others do.`
        : `${head}, which is under the ${FUME_ATM} atm fume threshold — ${pure} — but only just, and this rule assumes an IDEAL solution. A strongly positive-deviation system can carry an activity coefficient of ten or a hundred, which would put a number this close to the threshold across it. Treat it as unresolved rather than as clean.`;
  return { base: baseKey, el: elSym, wt, x, T, pPure, p, band, text };
}

// ---------------------------------------------------------------------------
// THE SIZE NOTE — also an advisory, and it knows which rule applies.

export interface SizeNote {
  /** Hume-Rothery's (r_solute − r_base)/r_base as a percentage; null when it does not apply */
  dRpct: number | null;
  /** Hägg's r_solute/r_base for the interstitial screen; null when it does not apply */
  hagg: number | null;
  interstitial: boolean;
  text: string;
}

export function sizeNote(baseKey: string, elSym: string): SizeNote | null {
  const base = Object.hasOwn(BASES, baseKey) ? BASES[baseKey] : undefined;
  const row = Object.hasOwn(BY_SYMBOL, elSym) ? BY_SYMBOL[elSym] : undefined;
  const bRow = base ? BY_SYMBOL[base.symbol] : undefined;
  if (!base || !row) return null;
  if (row.radiusCN12 == null || bRow?.radiusCN12 == null) {
    return { dRpct: null, hagg: null, interstitial: false,
      text: `no radius is tabulated for ${row.radiusCN12 == null ? elSym : base.symbol}, so no size comparison is made — an absent number is not a zero.` };
  }
  const ratio = row.radiusCN12 / bRow.radiusCN12;
  const dR = (ratio - 1) * 100;
  if (INTERSTITIAL.includes(elSym)) {
    // HÄGG, NOT HUME-ROTHERY. Hume-Rothery's 15 % rule is about SUBSTITUTIONAL
    // solubility — whether one atom can stand where another stood — and carbon
    // does not stand where iron stood, it sits in an octahedral hole. Applied to
    // Fe–C it returns −39.6 %, which reads as a violent mismatch and is in fact
    // the whole reason carbon dissolves at all.
    //
    // TWO THINGS THE FIRST DRAFT GOT WRONG, both found by review. It hardcoded
    // "which is why Fe3C is a complex orthorhombic carbide" into the
    // outside-the-limit clause, so a BORON addition to aluminium was answered
    // with a sentence about cementite. And it blamed the meaningless
    // substitutional number on the two radii coming from different conventions —
    // which cannot be the reason, because the Hägg ratio one clause earlier
    // divides exactly the same covalent radius by exactly the same metallic one
    // and is the number this branch trusts. The reason is interstitial versus
    // substitutional, and nothing else.
    const fits = ratio < HAGG_LIMIT;
    const inScope = HAGG_BASES.includes(baseKey);
    const isFeC = baseKey === "fe" && elSym === "C";
    const scope = inScope
      ? ""
      : ` Hägg's criterion is a rule for TRANSITION-METAL interstitial compounds — the hydrides, carbides, nitrides and borides of titanium, vanadium, chromium, iron and their neighbours — and ${base.label} is not one of those, so the ratio is reported and not read as a prediction. Being inside it is a necessary structural condition for a simple interstitial phase and never a sufficient one: what an sp-metal base forms with ${elSym} is a salt-like or covalent compound, or nothing that dissolves at all.`;
    const cementite = isFeC && !fits
      ? " That is why Fe3C is a complex orthorhombic carbide rather than a simple interstitial phase — the canonical case, and the one this criterion is usually quoted for."
      : "";
    const boron = elSym === "B"
      ? " Boron is the awkward one of the four: in iron it is documented on BOTH substitutional and interstitial sites, which is exactly why it segregates to austenite grain boundaries and why hardenability boron is dosed in tens of ppm."
      : "";
    return { dRpct: dR, hagg: ratio, interstitial: true,
      text: `${elSym} in ${base.symbol} is screened by Hägg's interstitial criterion, not by Hume-Rothery's 15 %: r/R = ${ratio.toFixed(3)} against Hägg's ${HAGG_LIMIT} limit for a simple interstitial structure, so it is ${fits ? "inside" : ratio < HAGG_LIMIT * 1.05 ? "just outside" : "well outside"} it.${cementite}${scope} The substitutional number would be ${dR.toFixed(1)} %, and it is meaningless here — not because the two radii come from different conventions, which the ratio above shares, but because an interstitial atom never occupies a substitutional site.${boron}` };
  }
  const mixed = row.radiusKind !== bRow.radiusKind;
  // "every casting solute this app carries is limited by an invariant" was
  // wrong by two: Cu–Ni and Fe–Cr are isomorphous, and those two are precisely
  // the pairs where extensive substitutional solubility IS the physics and the
  // Hume-Rothery question is the relevant one rather than the dismissed one.
  const iso = Object.entries(BINARY).flatMap(([bk, r]) => Object.entries(r).map(([e, row2]) => ({ bk, e, row2 })))
    .filter(x => x.row2.invariant === "isomorphous");
  const total = Object.values(BINARY).reduce((n, r) => n + Object.keys(r).length, 0);
  const isIso = iso.some(x => x.bk === baseKey && x.e === elSym);
  return { dRpct: dR, hagg: null, interstitial: false,
    text: `Hume-Rothery size factor for ${elSym} in ${base.symbol}: ${dR.toFixed(1)} % (${Math.abs(dR) <= 15 ? "inside" : "outside"} the ±15 % band that favours extensive substitutional solubility)${mixed ? `, computed across two different radius conventions — ${elSym}'s is ${row.radiusKind}, ${base.symbol}'s is ${bRow.radiusKind} — so it is indicative and not a measurement` : ""}. ${isIso
      ? `And here it is the relevant question rather than a note: ${base.symbol}–${elSym} is one of the ${iso.length} isomorphous pairs in this table, soluble in each other in every proportion, which is what extensive substitutional solubility looks like.`
      : `This is a note, not a gate: the casting solutes this app carries are DILUTE, and ${total - iso.length} of the ${total} are bounded by an invariant — a different question from whether the two form an extensive solid solution. The ${iso.length} that are not bounded are the isomorphous pairs, where this rule is the relevant one.`}` };
}

// ---------------------------------------------------------------------------
// THE CLASSIFIER

export interface Admission {
  base: string;
  el: string;
  wt: number;
  tier: AdmitTier;
  reason: AdmitReason;
  /** always non-empty, and longer than 25 characters for every non-ASSESSED pair */
  sentence: string;
  /** null when the pair carries no coefficient row */
  bound: ReturnType<typeof soluteBound>;
  /** never null for a known base and element; carries its own NO-DATA state */
  vapour: VapourAdvisory | null;
  size: SizeNote | null;
}

/**
 * Why sulphur and phosphorus are NOT in the gas tier, written where the decision
 * is made rather than in a design document.
 *
 * THE DICHOTOMY THE FIRST DRAFT DREW WAS FALSE, and review caught it. It said
 * sulphur and phosphorus "obey dilute-solution thermodynamics" as against
 * Sieverts' law, as though those were alternatives. They are not: Sieverts' law
 * IS Henrian dilute-solution thermodynamics applied to a diatomic gas
 * equilibrium, and ½S2 = [S] is standard steelmaking thermodynamics with the
 * same √p form. The conclusion survives the repair and the reason changes.
 *
 * What actually separates them is WHERE THE CONTENT COMES FROM. Hydrogen,
 * nitrogen and oxygen arrive from the furnace atmosphere, so their content is
 * set by what is over the melt and not by a weight anyone adds — which is why
 * this app models hydrogen through an ATMOSPHERE control and a porosity layer.
 * Sulphur and phosphorus arrive in the charge and leave through the slag; they
 * are compositional, they have well-measured partition coefficients in iron
 * (k_S ≈ 0.02-0.05, k_P ≈ 0.06-0.13), and they are the canonical low-k
 * segregators behind hot shortness and centreline enrichment — the physics this
 * solver models best. Sending a user to `porosity.ts` for sulphur would send
 * them to a layer that models hydrogen and nothing else.
 *
 * So they are refused for the honest reason: no coefficient row has been entered
 * for them. Adding Fe–S and Fe–P as cited solutes is the single best future
 * addition this file can name.
 */
const NONMETAL_SOLUTE = ["S", "P"];

/** where Sieverts' law has a usable constant for nitrogen: it dissolves atomically */
const N_DISSOLVES = ["fe", "ni"];

function gasSentence(baseKey: string, base: { symbol: string; label: string; materialKey: string }, elSym: string): string {
  const si = MATERIALS[base.materialKey]?.si;
  const carriesH = si != null && si.hL != null && si.hS != null;
  if (elSym === "H") {
    return carriesH
      ? `Hydrogen is not a composer solute: it dissolves atomically and obeys Sieverts' law, C = S·√p, so its content is set by the atmosphere over the melt and not by a weight you add. In ${base.label} it is already modelled — `
        + `the hydrogen porosity layer carries this material's own liquid and solid solubilities and the collapse between them on freezing, which is the mechanism, and the atmosphere control is where you change it.`
      : `Hydrogen is not a composer solute: it dissolves atomically and obeys Sieverts' law, C = S·√p, so its content is set by the atmosphere over the melt rather than by a weight you add. The hydrogen porosity layer that models it carries no solubility data for ${base.label} — only aluminium's Ransley–Neufeld values are entered — so for this base there is nothing to point at either.`;
  }
  if (elSym === "N") {
    // AND THE PHYSICS IS NOT BASE-INDEPENDENT EVEN THOUGH THE TIER IS. In iron
    // and nickel nitrogen genuinely dissolves atomically with a usable Sieverts
    // constant. In aluminium and magnesium it does not dissolve at all — it
    // REACTS, to AlN and Mg3N2 — so telling a user there that nitrogen content
    // "follows the partial pressure over the melt" would name a mechanism that
    // does not happen. In copper and zinc its solubility is essentially nil,
    // which is why nitrogen is a purge gas for copper rather than an addition.
    return N_DISSOLVES.includes(baseKey)
      ? `Nitrogen is not a composer solute: in ${base.label} it dissolves atomically from a diatomic gas and obeys Sieverts' law, so its content follows the partial pressure over the melt rather than a weight you add. That is not the whole story and this refusal says so — nitrogen is a DELIBERATE addition in nitrogen-strengthened austenitic stainless, charged as a nitrided ferroalloy and behaving as a solute — but this composer carries no nitrogen coefficient row and the porosity layer models hydrogen only.`
      : `Nitrogen is not a composer solute, and in ${base.label} not for the Sieverts reason that applies in steel: ${baseKey === "al" || baseKey === "mg" ? `it does not dissolve here, it REACTS — to ${baseKey === "al" ? "AlN" : "Mg3N2"} — so the equilibrium is nitride formation rather than a Henrian dissolution and there is no meaningful Sieverts constant to quote` : `its solubility here is essentially nil${baseKey === "cu" ? ", which is why nitrogen serves as a purge and stirring gas for copper rather than as an addition" : ", and this table has no nitrogen practice to report for it either way"}`}. Nothing in this model carries a nitride phase.`;
  }
  // OXYGEN IS THE ONE THIS FILE GOT FLATLY WRONG FOR COPPER. "It does not stay
  // dissolved" is true for aluminium and magnesium, where oxygen reports to
  // dross and an oxide skin. For copper it inverts real practice: tough-pitch
  // copper carries 0.02-0.05 wt% oxygen ON PURPOSE, the Cu-Cu2O eutectic sits
  // at 1066 °C, and "oxygen-free" versus "tough pitch" is a compositional grade
  // distinction. For iron, dissolved oxygen is measured in-ladle with a probe
  // precisely because it stays dissolved until an Al or Si addition takes it.
  if (baseKey === "cu") {
    return `Oxygen is not a composer solute here, and copper is the base where that is least obvious: tough-pitch copper carries 0.02-0.05 wt% oxygen deliberately, "oxygen-free" versus "tough pitch" is a compositional grade distinction, and the Cu-Cu2O eutectic at 1066 °C is a real invariant on a real binary. It is refused because this model has no oxide phase and no cited Cu-O coefficient row — an absence of data, not an absence of chemistry, and it is the one oxygen cell in this grid where a user would be right to expect a number.`;
  }
  if (baseKey === "fe" || baseKey === "ni") {
    return `Oxygen is not a composer solute: in ${base.label} it does dissolve — dissolved oxygen is measured in-ladle with an oxygen probe precisely because it stays in solution until an aluminium or silicon addition takes it out — but what happens next is deoxidation and a slag, and this model carries no oxide phase, no activity and no slag. It is refused for having nowhere to go in this solver rather than for being insoluble.`;
  }
  return `Oxygen is not a composer solute: in ${base.label} it does not stay dissolved at all — it reports to the dross and to the oxide skin, which is melt handling rather than composition. Nothing in this model carries an oxide phase or an activity.`;
}

/**
 * Which tier this (base, element, wt) lands in, and the sentence saying why.
 *
 * Returns null only for an unknown base or an unknown element symbol — every
 * real pair gets an answer. `wt` matters for exactly one boundary: an assessed
 * pair at or past its invariant liquid is OUTSIDE-THE-MODEL rather than
 * ASSESSED, and that test uses the SAME ceiling `derive()` enforces, so the two
 * cannot drift apart.
 *
 * THE ORDER OF THE TESTS IS LOAD-BEARING, and it is not the plan's order.
 * NOT-PRIMORDIAL is tested FIRST, ahead of the noble-gas and halogen rules,
 * because for the elements where the two overlap — Rn, At, Og, Ts — the
 * availability statement is a measurement and the chemical one is an inference
 * from a position in the table. Fewer than a dozen atoms of tennessine have
 * existed; "tennessine forms ionic salts and volatile halides" is a claim
 * nobody has tested. "It is not primordial and cannot be obtained" is simply
 * true. Ordered the plan's way, four cells would carry a sentence this file
 * cannot stand behind.
 */
export function admit(baseKey: string, elSym: string, wt: number): Admission | null {
  const base = Object.hasOwn(BASES, baseKey) ? BASES[baseKey] : undefined;
  const row = Object.hasOwn(BY_SYMBOL, elSym) ? BY_SYMBOL[elSym] : undefined;
  if (!base || !row) return null;

  const bound = soluteBound(baseKey, elSym);
  const vapour = vapourAt(baseKey, elSym, wt);
  const size = sizeNote(baseKey, elSym);
  const out = (reason: AdmitReason, sentence: string): Admission =>
    ({ base: baseKey, el: elSym, wt, tier: TIER_OF[reason], reason, sentence, bound, vapour, size });

  // --- A WEIGHT THAT IS NOT A COMPOSITION, tested first because none of the
  // sentences below can be written about it. `derive()` refuses a non-finite, a
  // negative and an over-100 weight by name, and this classifier claimed to
  // agree with `derive()` while carrying only the ceiling test — so
  // admit("fe","Cr",NaN) came back ASSESSED with an advisory reading "Cr at NaN
  // wt%". The docblock's promise is now kept for every input rather than for
  // the ones the gate happened to drive. A weight of exactly zero is NOT here:
  // derive() does not refuse it either, it simply has nothing to add.
  if (!Number.isFinite(wt) || wt < 0 || wt > 100) {
    return out("NOT-A-COMPOSITION", `For ${elSym} in ${base.label}, ${describeWt(wt)}${wt < 0 ? " — a melt cannot contain less than none of something" : wt > 100 ? " — a weight percent cannot exceed 100" : ""}. Nothing is claimed about this pair from it, and the solver refuses the same input for the same reason rather than propagating it into every readout.`);
  }

  // --- NOT-A-SOLUTE: base-independent, and asserted to be so by EL-TIER-TOTAL.
  if (!row.primordial) {
    // THREE POPULATIONS, NOT TWO, and the first draft collapsed them into a
    // sentence that was false for most of the actinides. "Only ever made in
    // accelerators, in quantities from a few atoms to a few micrograms" is
    // wrong about plutonium three ways over: trace Pu-239 occurs naturally in
    // uranium ore, essentially all of it is REACTOR-bred, and the world holds
    // it by the tonne. δ-phase Pu–Ga is a documented casting alloy, so "there
    // is no melt to add it to" was a metallurgical claim and a false one, in a
    // metallurgy file.
    const synthetic = row.Z >= 104
      ? `${elSym} (Z ${row.Z}) is a transactinide: it has only ever existed as single atoms, produced one at a time in an accelerator, with half-lives from hours at the lightest of them down to milliseconds at the heaviest. There is no melt to add it to and nothing thermophysical about it has been measured, so this table carries nulls rather than predictions.`
      : row.Z >= 99
        ? `${elSym} (Z ${row.Z}) does not occur on Earth and is made in atom-to-microgram quantities by irradiation. It has no bulk metallurgy to model — where a property has been measured at all this table carries it, and nulls the rest rather than predicting.`
        : row.Z > 92
          ? `${elSym} (Z ${row.Z}) is transuranic: not primordial, but not exotic either — it is bred in reactors rather than accelerators, and the ones just past uranium exist in quantity (plutonium by the tonne, americium by the kilogram, and δ-phase Pu–Ga is a real casting alloy). It is refused here because this composer carries no coefficient row for it and because it is not something a foundry charges, not because there is no melt.`
          : `${elSym} (Z ${row.Z}) is not primordial: every terrestrial atom of it is a decay-chain member or a fission product, and it is radioactive on a timescale short enough that none survived the Earth's formation. It is not something a foundry charges, whatever its metallurgy would be.`;
    return out("NOT-PRIMORDIAL", synthetic);
  }
  if (NOBLE.includes(elSym)) {
    // "No measurable solubility" is the wrong register for a file whose rule is
    // that an absent number is not a zero: the Henry's-law constants for He, Ne
    // and Ar in liquid Al, Cu, Ag and Fe HAVE been measured, at mole fractions
    // of order 1e-9 to 1e-6, and entrapped argon is a real porosity mechanism.
    return out("NOBLE-GAS", `${elSym} is a noble gas: a closed shell and no metallic bond to form. Its solubility in a metal melt has been measured and is of order a part per billion to a part per million by mole — a laboratory number rather than a foundry variable, and not a zero. Argon and helium are what a foundry covers a melt WITH rather than what it adds, and the atmosphere control is where they belong in this app; entrapped argon is a porosity mechanism, which is a bubble and not a solute.`);
  }
  if (HALOGEN.includes(elSym)) {
    return out("HALOGEN", `${elSym} is a halogen: with a metal it makes an ionic salt or a volatile halide, not a solid solution. Halide chemistry is real foundry practice on the OUTSIDE of the melt — chloride-fluoride salts are the flux that covers and cleans it, and modern magnesium melting is mostly fluxless under a cover gas (SF6, SO2 or a fluorinated replacement) that works by growing a protective MgF2 film, so fluorine is still what protects a magnesium melt even where the salt has gone. A flux and a film sit on the melt; this composer describes what is dissolved in it.`);
  }
  if (GAS_SPECIES.includes(elSym)) {
    return out("GAS-SPECIES", gasSentence(baseKey, base, elSym));
  }

  // --- from here the answer depends on the base.
  if (elSym === base.symbol) {
    const asSolute = Object.values(BASES).filter(b => Object.hasOwn(b.solutes, elSym)).map(b => b.label);
    return out("IS-THE-BASE", `${elSym} IS the base metal here — the melt is already ${base.label}, and "add ${elSym} to ${base.label}" is not a composition. ${asSolute.length
      ? `Pick another base to see ${elSym} as a solute: this composer carries it as one in ${serial(asSolute)}.`
      : `This composer carries ${elSym} only as a base metal, never as a solute in another one.`}`);
  }

  const key = `${baseKey}-${elSym}`;
  if (Object.hasOwn(DEMIX_CHECKED, key)) {
    return out("DEMIXES", `${DEMIX_CHECKED[key]} This is not a gap in the data — the system is well assessed and this app has read it. It is a limit of the solver: one liquid field, one solid field, and a monotectic needs two of the first.`);
  }

  const solute = Object.hasOwn(base.solutes, elSym) ? base.solutes[elSym] : undefined;
  const pdRow = Object.hasOwn(BINARY, baseKey) && Object.hasOwn(BINARY[baseKey], elSym) ? BINARY[baseKey][elSym] : undefined;

  if (solute && solute.source.trim().length > 0 && pdRow) {
    // ASSESSED — unless the composition itself is past the one boundary this
    // instrument refuses to cross. The test is `>=` and it reads the SAME
    // `soluteBound` ceiling `derive()` enforces, so an admission and a pour can
    // never disagree about whether a composition is pourable.
    if (bound?.ceiling != null && wt >= bound.ceiling) {
      const at = wt === bound.ceiling;
      return out("PAST-THE-INVARIANT", `${elSym} at ${wt} wt% is ${at ? "exactly at" : "past"} the ${bound.ceiling} wt% ${base.symbol}–${elSym} invariant liquid (${pdRow.invariant} at ${pdRow.Tinv} °C). ${at
        ? `A melt at that composition freezes ON the horizontal, and this solver grows one solid phase.`
        : `Past it the first phase to freeze is no longer the base-rich one, and this solver grows exactly one solid — the base-rich primary.`} This is real chemistry the model cannot carry, not missing data: the slider reaches ${bound.max} wt% and the pair is assessed everywhere below that.`);
    }
    // AND ONE ASSESSED ROW IS KNOWN TO BE GEOMETRICALLY IMPOSSIBLE. v7.1 P2
    // found Ni–W: its invariant at 1495 °C sits above pure nickel's 1455 °C, so
    // the liquidus rises and the first solid must be the richer phase, while
    // C_SM 39.9 against C_inv 45 says the liquid is. The figure refuses to draw
    // it and `phasesFor` refuses to place it. The pair still POURS — P3
    // established that a composition bound and a phase claim are different
    // questions — so it stays ASSESSED, and the flat claim that "everything the
    // readout says is derived from those two sources" would be false for it.
    const placed = phasesFor(baseKey, elSym, Math.max(wt, 1e-6));
    const contradicts = placed?.regime === "UNASSESSED";
    return out("CITED-PAIR", `${base.symbol}–${elSym} is assessed: a cited dilute coefficient row (m ${solute.m} K/wt%, k ${solute.k}) and a cited ${pdRow.invariant} row from the same binary, so this addition can be poured${contradicts
      ? `. But this row does not survive its own geometry check — the invariant temperature and the two compositions in it cannot all be right at once, and the phase readout and the drawn diagram both refuse it for that reason. What is poured here is the coefficient row; nothing about which phases the casting ends with is claimed.`
      : ` and everything the readout says about it is derived from those two sources.`}`);
  }

  if (DEMIX_ELEMENTS.includes(elSym)) {
    const where = Object.keys(DEMIX_CHECKED).filter(k => k.endsWith(`-${elSym}`))
      .map(k => { const b = k.split("-")[0]; return `${Object.hasOwn(BASES, b) ? BASES[b].symbol : b}–${elSym}`; });
    return out("NOT-CHECKED-FOR-DEMIXING", `${base.symbol}–${elSym} has NOT been checked for a liquid miscibility gap in this build. ${elSym} forms one with a base this app does carry (${serial(where)}), and the list of checked systems here is hand-entered and short — so the honest answer is that this pair's liquid behaviour is unknown to this model, not that it demixes. An unchecked system is refused for being unchecked.`);
  }

  if (NONMETAL_SOLUTE.includes(elSym)) {
    const inIron = baseKey === "fe";
    return out("NO-ASSESSMENT", `${elSym} in ${base.label} has no coefficient row in this build, and that is the whole reason it is refused — deliberately, rather than as a dissolved gas. ${elSym} is compositional: it arrives in the charge and leaves through the slag, unlike hydrogen, nitrogen and oxygen, whose content is set by the atmosphere over the melt. In iron it is one of the canonical low-k segregators, the physics this solver models best. ${inIron
      ? `Entering Fe–${elSym} as a cited solute is the single best addition this table could take.`
      : `Its behaviour in ${base.label} is a different question again, and this build has not assessed ${base.symbol}–${elSym} either; the iron pair is the one worth entering first.`}`);
  }

  const alsoIn = Object.values(BASES).filter(b => b !== base && Object.hasOwn(b.solutes, elSym)).map(b => b.label);
  if (alsoIn.length > 0) {
    return out("NO-ASSESSMENT", `${elSym} is a solute this composer carries — in ${serial(alsoIn)} — but no ${base.symbol}–${elSym} coefficient row has been entered, so there is no m, no k and no invariant to place a composition against. The pair is not refused because the chemistry is impossible; it is refused because this build has not assessed it, and inventing a coefficient to fill the cell is the one thing this table will not do.`);
  }

  return out("NO-ASSESSMENT", `${base.symbol}–${elSym} has no assessed row in this build: no cited liquidus slope, no partition coefficient, and no invariant. ${size?.dRpct != null ? `The size factor is ${size.dRpct.toFixed(1)} %, which is a hint and not an assessment` : "There is not even a radius to compare"} — this table admits a pair only when a real source states its numbers, and it has 25 of those.`);
}

/**
 * The composition every tier scan is taken at: 1 wt%, or half the invariant
 * liquid where that is smaller.
 *
 * The milestone plan specified min(1 wt%, C_SM/2) and its own worked example —
 * Al–Ti at 0.075 wt% — is C_inv/2, not C_SM/2. C_SM settles it: Al–Ti's is
 * 1.32 wt%, so half of it is 0.66 wt%, which is four times PAST the 0.15 wt%
 * invariant this instrument refuses to cross. The number the plan quotes is the
 * one that can actually be poured.
 */
export function probeWt(baseKey: string, elSym: string): number {
  const b = soluteBound(baseKey, elSym);
  if (!b) return 1;
  return Math.min(1, b.ceiling != null ? b.ceiling / 2 : b.max);
}
