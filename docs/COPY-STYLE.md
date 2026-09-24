# Copy style for SOLIDIFY

Set by the owner on 2026-09-23 (v8 U1). Applies to every user-facing string in the instrument, the
tour, learn mode and the landing page. Code comments and docs are not held to the length rules.

## The instrument is an instrument

- A control is a **label, a value and a unit**. No sentence under a control.
- Labels are short (aim for 1 to 3 words), lowercase, the way the rail already writes them
  (`cooling rate`, `inoculant sites`). Symbols follow the label when they help: `partition k`,
  `site ΔT_N`.
- Units: SI with a thin space before the unit (`586 °C`, `11.2 K`, `4.0 µm`, `1.8e3 K/s`).
  A dimensionless value says so once, in the unit slot or a column header (`dimensionless`),
  never in a sentence.
- A readout with no value shows `—` (a lone em dash is the empty-value glyph; it is the ONLY em
  dash allowed anywhere in the UI).
- Status lines are terse: `refused: nothing solid yet`, `ready`, `pouring · 42 %`.

## Words that stay on screen

- **Warnings stay.** When the model cannot do what a control implies, say so in one short line
  next to it (for example `dimensionless: pick a real material for units`). Honesty caveats are
  never deleted; they get a short on-screen line and a fuller learn-mode sentence.
- No build internals on screen: no milestone codes (`C3b`), no repo paths (`docs/...`), no
  function names.

## Learn mode

- Off by default. Turned on from the top bar. When on, each rail section and each panel shows a
  short explanation, and controls may show a one-line hint.
- 1 to 2 sentences, plain words, written for a student reading it once. Say what the thing is and
  why it matters. Put the number or the physics last, not first.
- No em dashes. Use periods, commas, colons or parentheses.

## Everywhere

- **American spelling:** aluminum (element and alloy names in prose: `aluminum`, but chemical
  symbols stay `Al`), mold, modeled, labeled, dialed, color, gray, vapor, program (for a cooling
  program), center, meter, fiber, analyze, homogenize, anodize, galvanized, sulfur.
- **No em dashes** in prose (see the empty-value exception above). En dashes stay where they are
  correct: ranges (`5–10 K`) and alloy systems (`Al–Cu`, `Fe–C`).
- **One name per mode**, identical in the rail, the panel title, the tour and learn mode:
  `lab mode`, `heat treat`, `optimizer`, `challenge`, `TRUE 3D`, `alloy composer`.
- Lens names are the uppercase words on the lens bar (`MELT`, `ORIENT`, `ETCH` ...), because that
  is how they appear on screen. Any other control named in prose is written exactly as it appears
  on screen, in the same case.
- Tour steps: at most 40 words each.
