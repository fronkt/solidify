/**
 * Learn mode for the alloy composer (v8 U1c): the modal's three explanations
 * (the composer itself, the element screen, the phase diagram), one-line
 * hints under the readout rows, and the caveat pairs the composer writes
 * itself.
 *
 * Same rules as `learn/rail.ts` (docs/COPY-STYLE.md): 1 to 2 sentences, plain
 * words, for a student reading once; what the thing is and why it matters,
 * the physics last; no em dashes; American spelling. A hint is one line
 * under its row, under about 45 characters.
 *
 * Most of what the composer prints is computed by the chemistry modules, and
 * their learn halves stay beside the line in the module that computes them
 * (the U1a doctrine): `admit()`'s `line` and `sentence` and the vapor and size
 * notes' `line` and `text` in elements.ts; `derive()`'s `dT0Line`/`dT0Source`,
 * `regimeLine`/`regimeSource` and the `learn` record for its caveat lines in
 * alloy.ts; the phase diagram's notes in phasediagram.ts. Entries here are
 * keyed `panel:<name>` and registered with the rest.
 */
import { registerLearn, type Caveat, type LearnEntry } from "./index";

export const COMPOSER_LEARN: readonly LearnEntry[] = [
  {
    id: "panel:alloy composer",
    text: "Build a real alloy: pick a base metal, add elements by weight, and read what they do to its melting "
      + "and freezing before you pour it. The element screen answers for every element in the table, and the "
      + "phase diagram shows the two-element system nearest your mix.",
    // keyed by the readout row's label exactly as it prints (composer.ts renderOut)
    hints: {
      "liquidus shift ΔT_L": "how far the solutes move the melting point",
      "growth restriction Q": "solute slowing growth; more Q, finer grains",
      "freezing range ΔT₀": "the interval the calibrated thermometer uses",
      "EQUILIBRIUM LEAVES": "equilibrium's phases vs the one the solver grows",
      "freezes at T_inv · lever / Scheil": "share frozen at the invariant, two models",
      "solver mapping · dimensionless": "the one equivalent solute the solver runs",
    },
  },
  {
    id: "panel:element screen",
    // "its own stated reason", not "reason and number": many refusals carry no
    // number (a halogen, an unchecked monotectic)
    // brightness and edge, not a hue, since v8 D2: the grid is achromatic
    text: "Every element in the periodic table, answered for this melt: the bright cells with a solid edge have "
      + "cited data and can be poured, and every other cell is refused with its own stated reason. An underline marks an element "
      + "that fumes or boils at this melt's melting point.",
  },
  {
    id: "panel:phase diagram",
    text: "A phase diagram shows which phases are stable at each temperature and composition: above the liquidus "
      + "the metal is all liquid, and below the solidus it is all solid. The dot is your pour and the shaded band "
      + "is the composition range it sits in; the lines are straight chords between cited points.",
  },
];

registerLearn(COMPOSER_LEARN);

/** the text of a composer `panel:` entry */
export function composerText(name: string): string {
  return COMPOSER_LEARN.find(e => e.id === `panel:${name}`)?.text ?? "";
}

/** the readout row hints, keyed by the label the row prints */
export function composerHint(label: string): string {
  return COMPOSER_LEARN.find(e => e.id === "panel:alloy composer")?.hints?.[label] ?? "";
}

/**
 * Every readout label that declares a hint. The composer records the labels
 * it actually rendered a hint slot for, and `Composer.learnAudit()` reports the
 * declared ones that never bound (COMPOSER-LEARN), the idiom of
 * `panelLearnAudit()`: a row label that drifts from its key loses its hint
 * silently otherwise, since `composerHint` returns "" for an unknown label.
 */
export function composerHintKeys(): string[] {
  return Object.keys(COMPOSER_LEARN.find(e => e.id === "panel:alloy composer")?.hints ?? {});
}

/** the caveats the composer writes itself; the line is on screen, the learn text in learn mode */
export const COMPOSER_CAVEATS = {
  coefficients: {
    line: "dilute-limit m, k (approximate textbook values) · the mix is mapped to one solute field",
    // "shifts", not "lowers": Ti in Al (+30.7), Ni in Cu, W in Ni and Zr in Mg raise it
    learn: "The composer uses approximate textbook values for how much each element shifts the melting point "
      + "(m, in K per wt%; most lower it, a few such as Ti raise it) and how it splits between solid and liquid "
      + "(k). The simulation carries one solute field, so the whole mix is converted into one equivalent solute, "
      + "shown in the solver mapping row.",
  },
  pickACell: {
    line: "",
    learn: "Tap any element to see what it does in this melt: only pairs with cited data can be poured, and "
      + "every other one is refused with its own stated reason.",
  },
  removed: {
    line: "",
    learn: "Only solutes with a cited data row for this base can be in the melt, so this one was removed and "
      + "nothing in the readout includes it.",
  },
} as const satisfies Record<string, Caveat>;
