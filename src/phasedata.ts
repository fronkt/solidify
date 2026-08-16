// Binary invariant data for the alloy composer's phase readout.
//
// WHAT THIS IS. For each (base, solute) pair the composer already ships in
// alloy.ts, the first invariant reaction on the BASE-RICH side of the binary
// diagram: its type, its temperature, the liquid composition there, the maximum
// solid solubility in the base-rich primary phase, and the name of the second
// phase that appears. Four numbers and a name per pair.
//
// WHAT THIS IS NOT. It is not a phase diagram, and it is not a thermodynamic
// model. There is no Gibbs energy here, no solvus curvature, no ternary
// interaction. The figure the app draws from these rows is a STRAIGHT-CHORD
// linearisation between the pure-base melting point and the invariant — which
// is exactly the dilute chord the solver integrates, so the drawing is a
// picture of the model rather than a picture of a textbook. The real boundaries
// are curved and the app says so.
//
// AND THE SOLVER GROWS NONE OF IT. sim.ts / sim3d.ts carry one solute field and
// one solid phase. Every phase named below the liquidus here — the eutectic
// included — is a phase the casting beside the diagram will never grow. That
// separation is the whole reason this file is data and not physics.
//
// PROVENANCE. Every row carries its own `source` sentence, in the same idiom
// materials.ts already uses for Γ, ε₄, the Murr stacking-fault energies and the
// Ransley–Neufeld hydrogen solubilities. Facts are not copyrightable expression
// and no figure is reproduced: the app draws its own from the numbers.
// docs/PHASE-AUDIT.md records, per row, an INDEPENDENT recomputation of these
// numbers from openly-licensed CALPHAD databases (MatCalc mc_al/mc_fe/mc_ni,
// ODbL 1.0; NIST solder, US Government work) through pycalphad, so a reader can
// check any row without taking this file's word for it.
//
// Bump PHASE_TABLE_VERSION whenever a row changes. PD-DOC-CONSTANTS gates the
// documents that quote these numbers against the module itself, so a document
// quoting a retired invariant fails the build rather than sitting there wrong.

/** Bump on any row change. Quoted by science/index.html and README.md. */
export const PHASE_TABLE_VERSION = "1.1.0";

export type InvariantKind = "eutectic" | "peritectic" | "isomorphous";

export interface BinaryRow {
  /**
   * The reaction type on the base-rich side. `isomorphous` means complete
   * solid solubility and NO invariant — Tinv/Cinv/Csm are null and `second` is
   * empty, because there is no second phase and a name there would be an
   * invention.
   */
  invariant: InvariantKind;
  /** invariant temperature, °C; null for isomorphous */
  Tinv: number | null;
  /** liquid composition at the invariant, wt% solute; null for isomorphous */
  Cinv: number | null;
  /** max solid solubility in the base-rich primary phase, wt% solute */
  Csm: number | null;
  /**
   * The composition of the second phase itself, wt% solute (v7.1 P3).
   *
   * CARRIED ONLY WHERE IT DECIDES A CLAIM THIS APP PRINTS, which is the
   * peritectic rows whose base solid is a REACTANT. There the reaction consumes
   * the primary the solver grows, and WHETHER ANY OF IT SURVIVES depends on
   * this number and nothing else: a melt leaner than the product retains some
   * primary, a melt richer than it ends with none. Fe–C is the case that
   * matters — L(0.53) + δ(0.09) → γ(0.17) — because 1045 at 0.45 wt% C and
   * 4340 at 0.40 both sit ABOVE the product, so their δ-ferrite is entirely
   * consumed and the casting ends as austenite alone. Without this field the
   * app printed "(Fe) beside gamma-austenite" for both, which is false.
   *
   * `null` means THIS ROW DOES NOT CARRY IT, not that the phase has no
   * composition. Every value here is transcribed from the same cited sentence
   * that row's own `second` and `source` fields already state; a row whose
   * literature value is a bracket rather than a number is left null and says so
   * (Fe–Ni), and the eutectic rows are null because the classifier never
   * consults it for them — for a eutectic the two solids appear together and no
   * reaction consumes either one. Filling in the remaining rows is data entry
   * with its own audit and is deliberately not done half-way here.
   */
  Csecond?: number | null;
  /** the reaction as written, e.g. "L + δ → γ"; empty for isomorphous */
  reaction: string;
  /** name of the second phase, e.g. "θ-Al2Cu"; EMPTY for isomorphous */
  second: string;
  /** where these numbers came from, and anything that makes the row tricky */
  source: string;
}

/**
 * The first token of a `second` field, for a phase name on a figure or in a
 * readout. The strings are written for a reader — "theta-Al2Cu (CuAl2, tI12,
 * C16)", "(Si) diamond cubic, elemental silicon (cF8)" — so a plain split on
 * separators returns an empty string for every one that starts with a
 * parenthesised symbol.
 *
 * It lives HERE rather than in phasediagram.ts, where v7.1 P2 first wrote it,
 * because v7.1 P3 names phases in `alloy.ts` too and phasediagram.ts already
 * imports alloy.ts. A helper about this file's own data belongs beside it, and
 * the alternative was an import cycle.
 */
export function shortPhase(second: string): string {
  const t = second.trim();
  const m = /^\(?[A-Za-z0-9αβγδθηπ'_-]+\)?/.exec(t);
  if (!m) return t.slice(0, 12);
  // A BARE SINGLE-LETTER token is a real phase name in this table — Fe–Mo's
  // second phase is literally the R phase — but "R" on its own names nothing a
  // reader can look up, and "(Fe) + R" under a diagram is a worse label than no
  // label. A bare one-character phase therefore keeps the word after it.
  //
  // PARENTHESES ARE THE TEST, and the first version of this rule stripped them
  // before measuring the length, which caught Ni–W's "(W) bcc terminal solid
  // solution" as well and relabelled it "(W) bcc". A parenthesised symbol is
  // already a complete phase name by the convention this table writes in —
  // (Al), (Si), (Cr), (W) — so it needs no help, and the docblock's claim that
  // one row changed was written from a measurement taken BEFORE the rule
  // existed. Re-measured after it: 23 rows carry a `second` (25 pairs less the
  // two isomorphous ones), and exactly one, fe-Mo, is changed by this branch.
  if (!/[()]/.test(m[0]) && m[0].length <= 1) {
    const two = /^\(?[A-Za-z0-9αβγδθηπ'_-]+\)?\s+[A-Za-z]+/.exec(t);
    if (two) return two[0];
  }
  return m[0];
}

/**
 * The reaction as a reader should see it, with this table's own curator notes
 * cut off. `reaction` carries square-bracketed annotations written for whoever
 * audits the row next — "L + alpha (Cu, fcc A1) -> beta (bcc A2)   [base solid
 * is a REACTANT]" — and v7.1 P3 started interpolating that field into prose the
 * app prints, which shipped the annotation to the screen with it. The bracket
 * is where the row stops talking to a user and starts talking to an auditor.
 */
export function reactionText(row: BinaryRow): string {
  return row.reaction.split("[")[0].trim().replace(/\s+/g, " ");
}

/** BINARY[baseKey][elementSymbol] — keys match BASES in alloy.ts exactly. */
export const BINARY: Record<string, Record<string, BinaryRow>> = {
  al: {
    Cu: {
      invariant: "eutectic",
      Tinv: 548.2, Cinv: 33.2, Csm: 5.65,
      reaction: "L -> (Al) + theta-Al2Cu",
      second: "theta-Al2Cu (CuAl2, tI12, C16)",
      source: "J.L. Murray, 'The aluminium-copper system', Int. Metals Reviews 30 (1985) 211-233 (the assessment reproduced in Massalski 2nd ed. and ASM Vol.3): eutectic 548.2 C at 17.3-17.4 at.% Cu; (Al) solidus 2.48 at.% Cu. Re-measurement: Ponweiser/Gierlotka et al., Metall. Mater. Trans. A 50 (2019) 3394. Murray not read directly (paywalled); values via sources restating it. GEOMETRY OK: C_SM 5.65 < C_inv 33.2 < theta 53.3 wt% Cu. AUDIT: C_SM = 5.65 wt% is an exact conversion of 2.48 at.% (I reproduce 5.651) and is one of the two hardest numbers in the whole table. C_inv is the soft one: 17.3 at.%… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 553.4 °C / 32.27 wt% / C_SM 5.48 wt% (docs/PHASE-AUDIT.md).",
    },
    Si: {
      invariant: "eutectic",
      Tinv: 577, Cinv: 12.6, Csm: 1.65,
      reaction: "L -> (Al) + (Si)",
      second: "(Si) diamond cubic, elemental silicon (cF8)",
      source: "Asensio-Lozano & Vander Voort, 'The Al-Si Phase Diagram', Buehler Tech-Notes Vol.5 Iss.1, read in full: 'the eutectic reaction occurs at 12.6 wt.% Si and 577 +/- 1 C. The maximum solubility of Si in Al occurs at the eutectic temperature and is 1.65 wt.%'; their figure is 'based upon Murray and McAlister', Bull. Alloy Phase Diagrams 5(1) (1984) 74-84, as redrawn in Massalski (ASM, 1986) p.165. GEOMETRY OK: 1.65 < 12.6 < 100. MOST TRUSTWORTHY ROW IN THE TABLE - a directly-read source states all three numbers verbatim, and 12.2 at.% converts to 12.64 wt% (I reproduce it). Only soft spot: Murray & McAlister's max… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 577.1 °C / 12.51 wt% / C_SM 1.57 wt% (docs/PHASE-AUDIT.md).",
    },
    Mg: {
      invariant: "eutectic",
      Tinv: 450, Cinv: 35, Csm: 17.4,
      reaction: "L -> (Al) + beta-Al3Mg2",
      second: "beta-Al3Mg2 (= Al8Mg5 = Al140Mg89, cF1168) - three names, one phase",
      source: "J.L. Murray, 'The Al-Mg system', Bull. Alloy Phase Diagrams 3 (1982) 60-74: eutectic 450 C at 37.5 at.% Mg (= 35.09 wt%); (Al) solidus 18.9 at.% Mg (= 17.35 wt%). C_SM independently read out of Belov, Aksenov & Eskin, 'Multicomponent Phase Diagrams', Ch.2: '...17.45 in the binary Al-Mg system', Table 2.3 listing L => (Al) + Al8Mg5 over 450-449 C. Re-optimised by Chartrand & Pelton, J. Phase… GEOMETRY OK: 17.4 < 35.0 < beta 43.9 wt% Mg. C_inv IS THE WEAK NUMBER: Murray's 37.5 at.% = 35.09 wt%, but circulating assessments span ~34.0-35.5 wt% Mg and T is given as 450 C (Murray) or 451 C (some CALPHAD fits). A CALPHAD… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 451.2 °C / 34.83 wt% / C_SM 16.77 wt% (docs/PHASE-AUDIT.md). REACTION-TYPE DECISION: Al–Mg is a eutectic at 450 °C and the cited row is right. The recomputation returned 'peritectic' here, which is a limitation of the type test rather than of the data: past this eutectic the β-Al3Mg2 liquidus rises only shallowly, so the local-minimum test on a 15 % composition step does not see a minimum. Temperature and composition agree to 1.2 K and 0.5 %; only the label differed.",
    },
    Zn: {
      invariant: "eutectic",
      Tinv: 381, Cinv: 95, Csm: 83.1,
      reaction: "L -> (Al) + (Zn)",
      second: "(Zn) hcp terminal solid solution at 98.8 wt% Zn - NOT an intermetallic; the accepted Al-Zn diagram has no stable intermediate compound",
      source: "J.L. Murray, 'The Al-Zn system', Bull. Alloy Phase Diagrams 4 (1983) 55-73, as reproduced numerically in Chen & Chang, Calphad 17(2) (1993) 113-124, Sec.3.1 and Table 3 (PDF read in full): 'a eutectic reaction at 381 C with x_Zn^L = 0.887, x_Zn^fcc = 0.670 and x_Zn^hcp = 0.972 [83Mur]', T = 654.0 K. VALUE CORRECTED DURING CONSOLIDATION: the Al-base researcher reported C_inv = 94.9 wt% Zn from an IntechOpen chapter; the Zn-base researcher's Murray-derived x_Zn = 0.887 converts to 95.005 wt% Zn (I reproduce it). I adopt 95.0.… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 380.9 °C / 94.84 wt% / C_SM 83.29 wt% (docs/PHASE-AUDIT.md).",
    },
    Fe: {
      invariant: "eutectic",
      Tinv: 655, Cinv: 1.8, Csm: 0.052,
      reaction: "L -> (Al) + Al3Fe",
      second: "Al3Fe (monoclinic theta; modern stoichiometry Al13Fe4 = Fe4Al13, 38.9 wt% Fe)",
      source: "Kattner & Burton, 'Al-Fe', in Phase Diagrams of Binary Iron Alloys, ASM, 1993: 0.9 at.% Fe = 1.845 wt% at 655 C; (Al) 0.025 at.% = 0.052 wt%. Reaction/temperature read directly from Belov, Aksenov & Eskin Ch.1, Table 1.2 ('L => (Al) + Al3Fe', 655-629 C, 'the limit solubility of iron does not exceed 0.05%'); C_SM also stated verbatim in the Buehler Tech-Note ('maximum solubility of Fe in Al is… GEOMETRY OK: 0.052 < 1.8 < 38.9. C_inv disputed at the 0.1 wt% level (Mondolfo 1.7, ASM 1.8, some texts 'about 2') - use 1.8 with a 1.7-1.9 band. T disputed 654-655 C: 655 in Mondolfo/Belov/Massalski, 654 in Li, Scherf & Palm et… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 654.0 °C / 1.82 wt% / C_SM 0.05 wt% (docs/PHASE-AUDIT.md).",
    },
    Ti: {
      invariant: "peritectic",
      Tinv: 665, Cinv: 0.15, Csm: 1.32,
      reaction: "L + Al3Ti -> (Al)   [base solid is the PRODUCT; peritectic sits ABOVE pure Al's melting point]",
      second: "Al3Ti (TiAl3, tI8, D0_22) at 36.5 wt% Ti",
      source: "Schuster & Palm, 'Reassessment of the binary Aluminum-Titanium phase diagram', J. Phase Equilib. Diffus. 27(3) (2006) 255-277: accepted-invariant list 'L + TiAl3(l) <-> Al at 665 C and 99.92, 75.5, 99.2 at.% Al', i.e. L = 0.08 at.% Ti = 0.142 wt%, (Al) = 0.8 at.% Ti. Same paper's solubility text: 'maximum solid solubility 1.32 wt% (0.75 at%) at the peritectic temperature of 665.2 C' from Hori et… TRAP CONFIRMED AND HANDLED, EXACTLY AS THE BRIEF SAID. Expected ordering for this peritectic class (base solid is the product): C_inv < C_SM < C_second, i.e. 0.15 < 1.32 < 36.5 - SATISFIED. Consequence: k = C_SM/C_inv ~ 8.8 (k >>… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 665.5 °C / 0.15 wt% / C_SM 1.38 wt% (docs/PHASE-AUDIT.md).",
    },
  },
  fe: {
    C: {
      invariant: "peritectic",
      Tinv: 1495, Cinv: 0.53, Csm: 0.09, Csecond: 0.17,
      reaction: "L + delta -> gamma",
      second: "gamma-austenite (fcc Fe-C solid solution), the peritectic PRODUCT, at 0.17 wt% C",
      source: "Okamoto, 'The C-Fe (Carbon-Iron) System' ASM phase-diagram evaluation: T_p = 1493 C with delta 0.09 / gamma 0.17 / L 0.53 wt% C ('maximum C in delta-ferrite is 0.09% at 1493 C'). Cross-check: Alves, Rezende, Senk & Kundin, J. Mater. Res. Technol. 2018 (open access), Table 3, from Thermo-Calc TCFE7: C_delta = 0.093, C_gamma = 0.172, C_liquid = 0.528 wt% C, T_p = 1495 C. TRAP HANDLED EXPLICITLY: this is the DELTA-FERRITE PERITECTIC at ~1495 C, NOT the 1147 C / 4.30 wt% C eutectic L -> gamma + Fe3C cementite. A dilute Fe-C alloy (below ~0.51 wt% C) finishes freezing on this 1495 C horizontal, so… Independently recomputed from MatCalc mc_fe v2.062 through pycalphad 0.11.2: 1494.6 °C / 0.53 wt% / C_SM 0.09 wt% (docs/PHASE-AUDIT.md).",
    },
    Mn: {
      invariant: "peritectic",
      Tinv: 1473, Cinv: 12.3, Csm: 8.9, Csecond: 10.1,
      reaction: "L + delta -> gamma",
      second: "gamma-austenite (fcc Fe-Mn solid solution), the peritectic PRODUCT, at 10.1 wt% Mn",
      source: "Alves, Rezende, Senk & Kundin, J. Mater. Res. Technol. 2018 (open access), Table 2, values from Thermo-Calc TCFE7: Mn in delta 8.9 wt%, Mn in gamma 10.1 wt%, Mn in liquid 12.3 wt%, T_p = 1473 C; quoted k_delta = 0.724, k_gamma = 0.821. The primary assessment (Witusiewicz, Sommer & Mittemeijer, 'Reevaluation of the Fe-Mn phase diagram', J. Phase Equilib. Diffus. 25 (2004) 346) could not be opened;… DOWNGRADED FROM cited-found TO disputed. Geometry is a proper peritectic and SATISFIES the expected ordering (8.9 < 10.1 < 12.3, k < 1). But only ONE numeric source exists in this dataset - a single CALPHAD/TCFE7 table - and… Independently recomputed from MatCalc mc_fe v2.062 through pycalphad 0.11.2: 1473.6 °C / 12.72 wt% / C_SM 9.80 wt% (docs/PHASE-AUDIT.md).",
    },
    Si: {
      invariant: "eutectic",
      Tinv: 1200, Cinv: 19.2, Csm: 17.8,
      reaction: "L -> bcc Fe(Si) solid solution (D0_3-ordered) + beta-Fe2Si",
      second: "beta-Fe2Si (P-3m1, high-temperature silicide) at 20.1 wt% Si",
      source: "C_inv: Edmund et al., 'The Fe-FeSi phase diagram at Mercury's core conditions', Nat. Commun. 13:387 (2022): 'Eutectic liquid compositions are located at about 19.2 wt% Si and 21.5 wt% Si above the DO3 + beta, and beta + B20 mixed phase regions, respectively', citing Cui & Jung, 'Critical reassessment of the Fe-Si system', Calphad 56 (2017) 108-125. T_inv and C_SM: read off the 0 GPa T-X diagram,… ONLY C_inv IS A QUOTED NUMBER. T_inv = 1200 C (+/- 15) and C_SM = 17.8 wt% (+/- 1) are FIGURE READS. Geometry OK but tight: 17.8 < 19.2 < 20.1 wt% Si (k = 0.927), and the ordering only survives because the second eutectic (beta +… The recomputation returned NO_INVARIANT_IN_RANGE; see docs/PHASE-AUDIT.md.",
    },
    Ni: {
      invariant: "peritectic",
      Tinv: 1517, Cinv: 12.426, Csm: 4, Csecond: null,
      reaction: "L + delta -> gamma",
      second: "gamma-austenite (fcc Fe-Ni solid solution), the peritectic PRODUCT, at ~4.2-4.7 wt% Ni",
      source: "PARTLY CALPHAD-SOURCED: no cited value was found for the invariant liquid composition on this row, so that field is the MatCalc mc_fe v2.062 assessment via pycalphad 0.11.2 rather than a handbook reading; the remaining fields are cited. C_SM and T: Landolt-Boernstein binary summary for Fe-Ni, derived from Swartzendruber, Itkin & Alcock, 'The Fe-Ni (iron-nickel) system', J. Phase Equilib. 12 (1991) 288-312: '(delta-Fe) dissolves 3.8 at.% Ni at 1517 C' = 3.99 wt% Ni. Bracketing of the gamma point: Phelan, Reid & Dippenaar, Metall. Mater. Trans. A 34 (2003) 1931 call Fe-4.2 wt% Ni HYPOperitectic and Fe-4.7 wt% Ni HYPERperitectic. C_inv DELIBERATELY NULL - NOT A LAZY GAP. I re-attempted this during consolidation: Swartzendruber 1991, Cacciamani et al. Intermetallics 14 (2006) 1312, and the ASM Fe-Ni evaluation are all inaccessible (403/paywall), and the…",
    },
    Cr: {
      invariant: "isomorphous",
      Tinv: null, Cinv: null, Csm: null,
      reaction: "",
      second: "",
      source: "Sun, Shang, Lin, Li, Beese & Liu, 'Thermodynamic modeling of binaries in Cr-Fe-Mo-Nb-Ni supported by first-principles calculations', arXiv:2507.16627, Table 4 lists ALL Cr-Fe invariants and NONE involves the liquid (congruent fcc<->bcc at 7.5 at.% Cr / 1111 K; congruent bcc<->sigma at 47.2 at.% Cr / 1095 K; eutectoid sigma <-> bcc + bcc' at 772 K). Their Fig.4(a,b) shows liquidus and solidus… THE NULLS ARE THE ANSWER, NOT MISSING DATA. Fe(delta) and Cr are both bcc and mutually soluble in all proportions above ~830 C, so no invariant terminates the freezing of a dilute Fe-Cr alloy and C_SM is formally infinite. Any… The recomputation independently found no invariant across the scanned range, which is the same claim (docs/PHASE-AUDIT.md).",
    },
    Mo: {
      invariant: "eutectic",
      Tinv: 1450, Cinv: 36.4, Csm: 34.8,
      reaction: "L -> bcc (alpha/delta-Fe,Mo) + R",
      second: "R phase (rhombohedral Fe-Mo TCP phase, ~Fe63Mo37, written Fe5Mo3 / Fe3Mo2) at 51.0 wt% Mo",
      source: "Sun et al., arXiv:2507.16627, Table 5 'Predicted invariant reactions in the Fe-Mo system': lowest-temperature liquid-bearing Fe-rich reaction at 1723 K (1450 C) with 25.0 at.% Mo in liquid, 37.7 at.% in R, 23.7 at.% in bcc. Rajkumar & Hari Kumar, J. Alloys Compd. (2014): 23.7 / 35.8 / 23.2 at.% Mo at 1721 K. Experiment: Gibson, Lee & Hume-Rothery, J. Iron Steel Inst. 198 (1961), 1722 K. at.% ->… TYPE LABEL CONFLICTS WITH THE SOURCE'S OWN COMPOSITIONS - I UPHELD THE ORIGINAL RESEARCHER'S CALL AND REPORT EUTECTIC. Sun et al.'s table labels this row 'Peritectic, Liquid + R <-> BCC_A2', but the compositions it prints put the… Independently recomputed from MatCalc mc_fe v2.062 through pycalphad 0.11.2: 1453.2 °C / 36.02 wt% / C_SM 36.41 wt% (docs/PHASE-AUDIT.md).",
    },
  },
  ni: {
    Nb: {
      invariant: "eutectic",
      Tinv: 1282, Cinv: 21.6, Csm: 18.3,
      reaction: "L -> gamma (Ni, fcc) + delta-Ni3Nb",
      second: "delta-Ni3Nb (orthorhombic Pmmn, Cu3Ti-type; the 'delta' phase of alloy 718) at 31.7 wt% Nb",
      source: "Okamoto, 'Nb-Ni (Niobium-Nickel)', J. Phase Equilibria 19(3) (1998) 289, Fig.1, reproducing the calculated diagram of Bolcavage & Kattner, J. Phase Equilibria 17(2) (1996) 92-100. Numbers PRINTED ON the figure and read directly from the rendered PDF: eutectic horizontal at 1282 C from (Ni) = 12.4 at.% Nb through L = 14.8 at.% Nb to Ni3Nb = 22.7 at.% Nb. Independent C_SM: Goodall, Data in Brief 26… GEOMETRY OK: 18.3 < 21.6 < 31.7 wt% Nb. Both compositions are printed labels on an ASM-published figure, which is the strongest evidence class in this table short of a verbatim sentence. REAL ASSESSMENT SPREAD, both defensible:… Independently recomputed from MatCalc mc_ni v2.036 through pycalphad 0.11.2: 1362.0 °C / 27.24 wt% / C_SM 24.94 wt% (docs/PHASE-AUDIT.md).",
    },
    Ti: {
      invariant: "eutectic",
      Tinv: 1304, Cinv: 13.8, Csm: 11.4,
      reaction: "L -> gamma (Ni, fcc) + Ni3Ti",
      second: "Ni3Ti (eta, hexagonal D0_24, TiNi3) at 21.4 wt% Ti",
      source: "Temperature: multiple independent statements of the Ni-rich eutectic L -> Ni3Ti + (Ni) at 1304 C (Aalto Solid State Chemistry Ti-Ni page; MSIT Al-Ni-Ti evaluation using [Mas2] for the binary). Compositions: DIGITIZED from the Massalski-type Ti-Ni diagram reproduced as Fig.1 of IntechOpen ch.67513, frame-calibrated (the stoichiometric Ni3Ti line came out at 78.4 vs 78.63 wt% Ni theoretical).… WEAKEST ROW OF THE NICKEL SET AND ONE OF THE THREE WEAKEST OVERALL. T = 1304 C is solid and corroborated. BOTH COMPOSITIONS ARE A DIGITIZATION OF A REDRAWN (not ASM-original) DIAGRAM, +/- ~0.5 wt%, and C_SM disagrees with the… Independently recomputed from MatCalc mc_ni v2.036 through pycalphad 0.11.2: 1309.7 °C / 13.29 wt% / C_SM 12.32 wt% (docs/PHASE-AUDIT.md).",
    },
    Al: {
      invariant: "eutectic",
      Tinv: 1381.58, Cinv: 12.168, Csm: 10.413,
      reaction: "L -> (Ni) + beta-NiAl",
      second: "NIAL",
      source: "Okamoto, 'Al-Ni (Aluminum-Nickel)', J. Phase Equilibria and Diffusion 25(4) (2004) 394, Fig.1 (the [Massalski2]/[1991Nas] diagram as modified by Okamoto 1993); 1362 C and 1360 C horizontals labelled. Compositions measured from the figure rendered at 1200 dpi: horizontal runs 69.7 at.% Ni (beta-AlNi edge) to 78.2 at.% Ni ((Ni) solidus), liquidus vertex ~74.3 at.% Ni. Topology corroborated verbatim… TOPOLOGY IS THE IMPORTANT PART AND IT IS RIGHT: for a DILUTE Ni-Al alloy freezing ends at the PERITECTIC L + gamma -> gamma'-Ni3Al, because the invariant liquid (~25.5 at.% Al) is marginally Al-RICHER than gamma' (25 at.% Al),… Independently recomputed from MatCalc mc_ni v2.036 through pycalphad 0.11.2: 1381.6 °C / 12.17 wt% / C_SM 10.41 wt% (docs/PHASE-AUDIT.md). REACTION-TYPE DECISION: The cited row describes the γ′-Ni3Al peritectic at 1362 °C. That is not the first invariant a dilute Ni–Al melt meets on cooling: the Ni-rich liquidus terminates at the γ + β-NiAl EUTECTIC, which the recomputation puts at 1381.6 °C and 12.17 wt% Al against a published ~1385 °C. Since the composer models dilute alloys, the eutectic is the reaction that matters and it is what ships. The researcher's own confidence on this row was 'disputed'.",
    },
    Cr: {
      invariant: "eutectic",
      Tinv: 1345, Cinv: 51, Csm: 46.9,
      reaction: "L -> gamma (Ni, fcc) + (Cr) bcc",
      second: "(Cr) bcc terminal solid solution at 61.0 wt% Cr",
      source: "Ni-Cr diagram computed and published by calphad.com (2006), distributed as a VECTOR PDF (copy at psec.uchicago.edu/blogs/lappd/wp-content/uploads/2014/01/Ni_Cr_Phase_Diagram.pdf); tie-line coordinates extracted exactly: horizontal at 1344 C from 46.87 wt% Cr (fcc) to 60.95 wt% Cr (bcc), with printed labels '1345 C' and '51 wt.% Cr' for the liquid. Underlying ASM assessment: P. Nash, 'The Cr-Ni… GEOMETRY OK: 46.9 < 51.0 < 61.0 wt% Cr. Strong row: an exactly-extractable vector diagram plus a fully independent solubility dataset agreeing on C_SM to 0.1 wt%. CORRECTION TO A COMMON FIGURE: the eutectic liquid is 51 wt% Cr… Independently recomputed from MatCalc mc_ni v2.036 through pycalphad 0.11.2: 1344.9 °C / 50.92 wt% / C_SM 46.99 wt% (docs/PHASE-AUDIT.md).",
    },
    Mo: {
      invariant: "eutectic",
      Tinv: 1309, Cinv: 45.7, Csm: 39.2,
      reaction: "L -> gamma (Ni, fcc) + delta-NiMo",
      second: "delta-NiMo (orthorhombic, ~50 at.% Mo; labelled simply 'NiMo' on the ASM figure) at 60.8 wt% Mo",
      source: "Okamoto, 'Mo-Ni (Molybdenum-Nickel)', J. Phase Equilibria 12(6) (1991) 703, Fig.1 (diagram calculated by K. Frisk, Calphad 14(3) (1990) 311-320; Okamoto states the rest is very close to Singleton & Nash, Phase Diagrams of Binary Nickel Alloys, ASM 1991, i.e. the [Massalski2] diagram). 1309 C is a PRINTED label; compositions are NOT printed and were measured at 900 dpi against the figure axes:… T = 1309 C is a printed label and is reliable; BOTH COMPOSITIONS ARE DIGITIZED, +/- ~1 at.% (~1.5 wt%). Goodall's independent max solubility is 1.3 at.% lower, so TREAT C_SM AS 37.7-39.2 wt% Mo. Geometry OK: 39.2 < 45.7 < 60.8.… Independently recomputed from MatCalc mc_ni v2.036 through pycalphad 0.11.2: 1306.0 °C / 45.17 wt% / C_SM 37.45 wt% (docs/PHASE-AUDIT.md).",
    },
    W: {
      invariant: "eutectic",
      Tinv: 1495, Cinv: 45, Csm: 39.9,
      reaction: "L -> (Ni, fcc) + (W) bcc",
      second: "(W) bcc terminal solid solution (99.7 at.% W = 99.90 wt% W at the invariant)",
      source: "Okamoto, 'Ni-W (Nickel-Tungsten)', J. Phase Equilibria 12(6) (1991) 706, Fig.1 (diagram of Nagender Naidu, Sriramamurthy & Rama Rao, J. Alloy Phase Diagrams 2(1) (1986) 1-11, modified with the (Ni) solvus and peritectoid temperatures of Fernandez Guillermet & Ostlund, Metall. Trans. A 17(10) (1986) 1809-1823). ALL FOUR NUMBERS PRINTED ON the figure and read directly: congruent liquidus/solidus… THE NUMBERS ARE SOLID (every one a printed label) BUT THE ROW MUST BE FLAGGED IN THE READOUT. (1) It is a EUTECTIC, not a peritectic: the liquid (20.7 at.% W) lies BETWEEN the two solids (17.5 and 99.7 at.%), and there is no… Independently recomputed from MatCalc mc_ni v2.036 through pycalphad 0.11.2: 1497.9 °C / 44.53 wt% / C_SM 40.14 wt% (docs/PHASE-AUDIT.md). *** GEOMETRICALLY INCONSISTENT, FOUND BY v7.1 P2 WHEN THIS ROW WAS DRAWN, AND NOT REPAIRED HERE. *** T_inv 1495 C is ABOVE pure Ni's 1455 C, so this system's Ni-rich liquidus RISES with tungsten; a rising liquidus means the first solid is RICHER in solute than the liquid (k > 1), which requires C_SM > C_inv. This row has C_SM 39.9 < C_inv 45, i.e. the liquid richer, k = 0.887 at the invariant — the opposite. The two statements cannot both be true: with C_SM < C_inv the (Ni) solidus would reach 1495 C at a SMALLER composition than the liquidus and therefore sit ABOVE it, and a solidus above a liquidus is not a phase diagram. The shipped dilute k = 1.3 agrees with the rising liquidus and disagrees with the chord, which is the same disagreement PD-CONSTRUCT-AGREE already records for this pair (ratios 0.89 / 0.68). One of T_inv, the reaction type, or the C_SM/C_inv pair is wrong and THIS INSTRUMENT HAS NOT RESOLVED WHICH, so nothing is invented: the numbers stand as read from the ASM figure, PD-SLOPE-CONSISTENT carries ni-W as its single named exception, and phasediagram.ts REFUSES to draw this pair rather than render an impossible figure. Every other one of the 24 non-isomorphous rows passes the same test, including the two other rows whose invariant sits above the base's melting point (Al-Ti 665 C with C_SM 1.32 > C_inv 0.15, and Mg-Zr 653.6 C with 2.58 > 0.58) — both consistent, both k > 1.",
    },
  },
  mg: {
    Al: {
      invariant: "eutectic",
      Tinv: 437, Cinv: 32.3, Csm: 12.9,
      reaction: "L -> (Mg) hcp + beta-Mg17Al12",
      second: "beta-Mg17Al12 (= gamma-Al12Mg17), bcc I-43m, a ~ 1.06 nm, at 43.9 wt% Al",
      source: "T_inv and C_SM read directly from J.F. Nie, 'Precipitation and Hardening in Magnesium Alloys', Metall. Mater. Trans. A 43A (2012) 3891, p.3892: 'a eutectic temperature of 710 K (437 C)' and 'The equilibrium solid solubility of Al in alpha-Mg is 11.8 at. pct (12.9 wt pct) at the eutectic temperature'. Same 11.8 at.% at 710 K attributed to J.L. Murray, Bull. Alloy Phase Diagrams 3 (1982) 60 in… CONFIDENCE DOWNGRADED TO recalled BECAUSE OF C_inv, EVEN THOUGH T AND C_SM ARE CITED. 32.3 wt% Al (30.1 at.%) is the researcher's recollection of ASM Vol.3 / the ASM Magnesium Specialty Handbook; no openable primary source states… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 435.3 °C / 33.00 wt% / C_SM 10.15 wt% (docs/PHASE-AUDIT.md).",
    },
    Zn: {
      invariant: "eutectic",
      Tinv: 341, Cinv: 51.5, Csm: 6.2,
      reaction: "L + (Mg) hcp -> Mg51Zn20   (modern assessment). Classic ASM/Massalski-era form: L -> (Mg) + Mg7Zn3, eutectic, 340 C",
      second: "Mg51Zn20 at 51.34 wt% Zn (the phase formerly written Mg7Zn3; older diagrams and applied literature call the Mg-rich second phase MgZn = Mg12Zn13)",
      source: "Ghosh, Mezbahul-Islam & Medraj, 'Critical assessment and thermodynamic modeling of Mg-Zn, Mg-Sn, Sn-Zn and Mg-Sn-Zn systems', Calphad 36 (2012) 28-43, Table 2 read directly: PERITECTIC 'L + (Mg)-hcp <-> Mg51Zn20' at 28.3 at.% Zn, 341 C (this work); 28.3 at.%/342+/-1 C [Park & Wyman]; 346+/-2 C [Anderko]. Then EUTECTIC 'L <-> Mg51Zn20 + Mg12Zn13' at 28.7 at.%/342 C. Text p.31: 'The maximum… C_inv REVISED UPWARD DURING CONSOLIDATION from the researcher's 51.3 to 51.5 wt%, because their own cited value (28.3 at.% Zn, Ghosh Table 2) converts to 51.497 wt% - 51.3 was an internal inconsistency. THE TYPE IS GENUINELY… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 341.0 °C / 52.30 wt% / C_SM 7.55 wt% (docs/PHASE-AUDIT.md). REACTION-TYPE DECISION: The cited numbers (341 °C, 51.5 wt% Zn) are the standard Mg-rich invariant and the recomputation reproduces them (341.0 °C, 52.3 wt%). The cited row labels the reaction peritectic; the Mg-rich Mg–Zn invariant is a EUTECTIC, L → (Mg) + Mg51Zn20, and the recomputation independently returns eutectic. The label is corrected and the numbers are kept. The researcher's own confidence on this row was 'disputed'.",
    },
    Zr: {
      invariant: "peritectic",
      Tinv: 653.6, Cinv: 0.58, Csm: 2.58,
      reaction: "L + (alpha-Zr) -> (Mg) hcp   [base solid is the PRODUCT; peritectic sits ABOVE pure Mg's melting point]",
      second: "(alpha-Zr), hcp zirconium terminal solid solution -- there is NO intermetallic compound in the Mg-Zr system",
      source: "C_inv and T: Schaum & Burnett, 'Magnesium-Rich Side of the Magnesium-Zirconium Constitution Diagram', J. Res. Natl. Bur. Stand. 49(3) (1952) 155, RP2352, read directly at nvlpubs.nist.gov: 'The peritectic reaction was found to take place at 654 C, beginning at 0.58 percent of zirconium'. 653.6 C is the ASM/Massalski-assessed value quoted throughout the CALPHAD literature; Metals 2022, 12, 1388… SECOND k > 1 SYSTEM, STRUCTURALLY IDENTICAL TO Al-Ti. Expected ordering for this peritectic class: C_inv < C_SM < C_second, i.e. 0.58 < 2.58 < ~99 - SATISFIED; k ~ 4.5 (reported k = 6.55, m = +6.9 K/wt%). A comparator assuming k… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 651.9 °C / 0.20 wt% (docs/PHASE-AUDIT.md).",
    },
  },
  cu: {
    Sn: {
      invariant: "peritectic",
      Tinv: 797.85, Cinv: 25.52, Csm: 13.48, Csecond: 21.97,
      reaction: "L + alpha (Cu, fcc A1) -> beta (bcc A2)   [base solid is a REACTANT]",
      second: "beta -- disordered bcc (A2) Cu-rich intermediate solid solution at 21.97 wt% Sn, often written Cu17Sn3 or ~Cu5Sn (orders to D0_3 gamma on cooling); NOT a line compound",
      source: "Saunders & Miodownik, 'Cu-Sn (Copper-Tin)', in Phase Diagrams of Binary Copper Alloys, ASM, 1994, pp. 412-418 (same assessment in Massalski 2nd ed. vol.2, pp. 1481-1483), as tabulated in Table 2 ('Assessed results [16]') of Li, Franke, Fuertauer, Cupid & Flandorfer, 'The Cu-Sn phase diagram part II: New thermodynamic assessment', Intermetallics 34 (2013) 148-158, full text read: alpha + L <->… Expected ordering for this peritectic class: C_SM < C_second < C_inv, i.e. 13.48 < 21.97 < 25.52 - SATISFIED, k = 0.53. Source is in MOLE FRACTION; conversions (M_Cu 63.546, M_Sn 118.710) verified independently by me and… Independently recomputed from NIST solder (Kattner) through pycalphad 0.11.2: 796.0 °C / 26.76 wt% / C_SM 14.30 wt% (docs/PHASE-AUDIT.md).",
    },
    Zn: {
      invariant: "peritectic",
      Tinv: 903, Cinv: 37.46, Csm: 32.52, Csecond: 36.76,
      reaction: "L + alpha (Cu, fcc A1) -> beta (bcc A2)   [base solid is a REACTANT]",
      second: "beta -- bcc A2 solid solution near equiatomic CuZn at 36.76 wt% Zn (orders to beta' CsCl/B2 below ~454-470 C); NOT a stoichiometric compound at 903 C",
      source: "Miodownik, 'Cu-Zn', in Phase Diagrams of Binary Copper Alloys, ASM, 1994 (ref. [43]), as tabulated in Table 7 of Tang, Ma, Han, Wang, Qi & Jin, 'Critical Evaluation and Thermodynamic Optimization of the Cu-Zn, Cu-Se and Zn-Se Binary Systems', Metals 12 (2022) 1401, full text read: 'Liquid + fcc_A1 <-> beta(bcc_A2), Peritectic, 903 C, composition (Zn at.%): 36.8 / 31.9 / 36.1'. Expected ordering: C_SM < C_second < C_inv, i.e. 32.52 < 36.76 < 37.46 - SATISFIED, k = 0.868. Conversions verified. NASTY COINCIDENCE TO GUARD AGAINST: '36.8' is the liquid in at.% AND the beta phase in wt.% - the two scales… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 902.2 °C / 38.00 wt% / C_SM 32.39 wt% (docs/PHASE-AUDIT.md).",
    },
    Ni: {
      invariant: "isomorphous",
      Tinv: null, Cinv: null, Csm: null,
      reaction: "",
      second: "",
      source: "Chakrabarti, Laughlin, Chen & Chang, 'Cu-Ni (Copper-Nickel)', in P. Nash (ed.), Phase Diagrams of Binary Nickel Alloys, ASM, 1991, pp. 85-95 (the standard assessment, reproduced in Massalski 2nd ed.). Corroborated by Sarkar / Erdelyi et al., 'On the miscibility gap of Cu-Ni system', Acta Materialia 147 (2018) 122-133 (arXiv:1611.07068), read via WebFetch, which states complete solid solubility… THE NULLS ARE THE ANSWER. Cu and Ni are both fcc and the fcc field runs continuously 0-100% Ni: no eutectic, no peritectic, no invariant horizontal, no second phase. Any number printed here would be wrong by construction. Correct… The recomputation independently found no invariant across the scanned range, which is the same claim (docs/PHASE-AUDIT.md).",
    },
  },
  zn: {
    Al: {
      invariant: "eutectic",
      Tinv: 381, Cinv: 5, Csm: 1.17,
      reaction: "L -> (Zn) hcp + (Al) fcc",
      second: "(Al) fcc aluminium-rich solid solution, Zn-saturated (fcc2 in CALPHAD notation), at 16.89 wt% Al = 83.11 wt% Zn -- NOT an intermetallic; there is no stable AlZn compound in the accepted assessment",
      source: "J.L. Murray, 'The Al-Zn System', Bull. Alloy Phase Diagrams 4(1) (1983) 55-73 (the assessment printed in Massalski 2nd ed. and ASM Vol.3), reproduced numerically in Chen & Chang, Calphad 17(2) (1993) 113-124, Sec.3.1 and Table 3, PDF read in full: 'The liquid, fcc and hcp phases form a eutectic reaction at 381 C with x_Zn^L = 0.887, x_Zn^fcc = 0.670 and x_Zn^hcp = 0.972 [83Mur]'; Table 3 gives T… THIS IS THE SAME PHYSICAL HORIZONTAL AS THE Al-Zn ROW, read from the zinc end; every composition here is wt% Al in Zn. CROSS-CHECK PASSES: both rows give T = 381 C; C_SM here (1.175 wt% Al) and the Al-Zn second-phase composition,… Independently recomputed from MatCalc mc_al v2.037 through pycalphad 0.11.2: 380.9 °C / 5.16 wt% / C_SM 1.30 wt% (docs/PHASE-AUDIT.md).",
    },
  },
};