# SOLIDIFY design system (v8 D, 2026-09-24)

Binding for every page (landing, app, science, contact) and every new component. It replaces
the monospace + amber look. Copy rules stay in `docs/COPY-STYLE.md`.

**Reference:** Figure AI's Figure 03 page (figure.ai; Refero style
`2997507c-ba60-4653-b217-3eca4858dec8`), inverted to dark mode. Secondary reference for
restraint: desktop.fm (Refero `cb266ff9-…`): the render is the only source of color.

**Owner decisions (Frank, 2026-09-24):**
- Figure 03 leads, in dark mode.
- What he took from Figure: the nav buttons at the top, and the landing laid out cleanly
  with the title on the right.
- Keep the rendered dendrite, the lenses act and the melt-types act. Give them
  Figure-style metrics to the side.
- The UI is fully achromatic.
- Typefaces: Space Grotesk + Inter, with a tabular mono for numeric values only.

## 1. Principles

1. **Achromatic chrome.** Every button, label, rule, panel and nav item is white, gray or
   black. Color exists only inside rendered or simulated imagery: the hero render, the
   simulation canvases and lenses, plot data marks, phase-diagram curves and orientation
   maps. No amber, no cyan, no colored status.
2. **Flat.**
   - No box shadows, glows, gradients or ornamental backdrops. That removes the landing's
     `#grain` Voronoi backdrop, `.heroGlow` and the amber scrollbars.
   - Depth comes from 1 px rules, whitespace and the edge between media and canvas.
   - The one allowed blur is a backdrop blur on overlays that sit on moving imagery: the
     header and the tool panels over the sim.
3. **Media is square-edged.** Canvases, renders and images have radius 0 and no card or
   border around them.
4. **Metrics are specs.** A number the page shows is a row in a spec rail: a label left, the
   value right in large type, rows split by 1 px rules. The value is real: read live from a
   simulation, or from `materials.ts` / a cited source. Never decorative.
5. **One primary action per view.** It is a filled white pill. Everything else is an outline
   pill or an underlined text control.

## 2. Tokens (`src/design/tokens.css`, the only place these values are written)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0a0a` | page canvas; hero render background (hero.ts paints the same value) |
| `--bg-media` | `#000000` | full-bleed media fields, if a section wants true black |
| `--surface` | `#111111` | solid panel, modal body |
| `--overlay` | `rgba(10,10,10,0.90)` + `backdrop-filter: blur(12px)` | panels floating over a live canvas (0.90 keeps `--fg-3` at 4.5:1 over a white pixel) |
| `--fg` | `#f2f2f2` | primary text, filled button, active state |
| `--fg-2` | `#bdbdbd` | long-form body copy (Figure's rule: gray is never used for long copy on black) |
| `--fg-3` | `#8a8a8a` | labels, units, metadata, inactive nav (5.7:1 on `--bg`) |
| `--fg-4` | `#5c5c5c` | disabled and decorative only, never informative text |
| `--rule` | `#262626` | 1 px dividers, spec-rail rules |
| `--rule-strong` | `#3a3a3a` | input underline, slider track, outline-button border |
| `--focus` | `#f2f2f2` | 2 px focus ring, 2 px offset |

Contrast floor: any informative text is at least 4.5:1 against the surface it actually sits on,
including over a live canvas (hence `--overlay`).

## 3. Type

Self-hosted from npm (`@fontsource/space-grotesk`, `@fontsource-variable/inter`,
`@fontsource/jetbrains-mono`); no Google Fonts request, `font-display: swap`.

| Role | Family | Size / line | Tracking | Notes |
|---|---|---|---|---|
| display | Space Grotesk 400 | `clamp(56px, 7.5vw, 112px)` / 1.0 | -0.01em | landing hero title, one per view |
| display-2 | Space Grotesk 400 | `clamp(40px, 5vw, 72px)` / 1.02 | -0.01em | act titles (lens name, material name) |
| stat | Space Grotesk 400 | `clamp(32px, 3.6vw, 52px)` / 1.11 | 0 | spec-rail values; unit at 0.45em in `--fg-3` |
| media-heading | Space Grotesk 400, UPPERCASE | 28px / 1.11 | 0 | headings over imagery |
| nav | Space Grotesk 400, UPPERCASE | 13px / 1 | +0.02em | top nav, kickers, tab labels, section labels in the tool (12px there) |
| heading | Inter 400 | 22px / 1.1 | -0.01em | sentence-case section titles |
| body-l | Inter 400 | 17px / 1.6 | -0.01em | landing paragraphs |
| body | Inter 400 | 16px / 1.5 | -0.01em | science page body, contact |
| ui | Inter 400 / 500 | 13px / 1.35 | 0 | tool labels, controls; 12px minimum, 11px only for axis ticks |
| button | Inter 500 | 14px / 1.2 (tool: 12.5px) | 0 | all buttons |
| value | JetBrains Mono 400, `tabular-nums` | 12.5–13px | 0 | numeric readouts in the tool (HUD, rail values, tables) |

Weights: display faces stay 400 (Figure's rule: no bold display). Inter 500 is for buttons and
the active item only. No other weights.

## 4. Spacing, radii

- 4 px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.
- Landing rhythm (Figure): 20 element gap, 32 panel padding, 40 section gap, 80–96 between acts.
- Tool rhythm: denser, 8 / 12 / 16.
- Radii are binary, sharp or round. Exact values:
  - buttons: 24 px (a pill at 40 px height; tool buttons at 28 px height use 14 px);
  - panels: 12 px;
  - tags: 9999 px;
  - canvases, images and inputs: 0.

## 5. Components

**Header (landing, science, contact).**
- 72 px tall, transparent over the hero. It gains `--overlay` plus a 1 px bottom rule once
  the page scrolls.
- Left: the wordmark `SOLIDIFY` (Space Grotesk 400, 15px, +0.08em, `--fg`, one color).
- Right: nav labels `INSTRUMENT`, `SCIENCE`, `CONTACT`, `GITHUB` (nav style, `--fg-3`,
  `--fg` on hover and for the current page), then the primary pill `Open the instrument ›`.
- Phones: the labels collapse to the pill plus a `MENU` text control.

**Buttons.**
- `.btn`: outline pill, 1 px `--rule-strong` border, `--fg` text; hover border `--fg`.
- `.btn--primary`: `--fg` fill, `--bg` text, trailing `›`.
- `.btn--text`: no box, 1 px underline at 3 px offset.
- Toggled or active: inverted (`--fg` fill, `--bg` text), set as `aria-pressed` so a screen
  reader hears the state too (`src/design/tool.ts setPressed`).
- A toggle that sits next to the view's primary (the transport's ×2/×4 and rec, beside
  `▶ run` / `❚❚ pause`) shows "on" as an emphasized outline instead: `--fg` border and text on a
  transparent fill, so the fill stays the primary's alone.
- Disabled: `--fg-4` text on a `--rule` border.
- Pressed: 0.96 scale, 120 ms.
- The tool drops emoji-like glyph icons (⚗ ⚙ ●). Monochrome ▶ ❚❚ for run/pause are fine.

**Spec rail (Figure's "technical specification rail").**
- Rows stacked, each with a 1 px `--rule` top border and 16–20 px padding.
- Label: Inter 13–14px `--fg-3`, left. It may carry a second, smaller line.
- Value: `stat`, right-aligned, `--fg`. The unit follows at 0.45em in `--fg-3`. A value that
  is a word or phrase rather than a number (a crystal structure, an instrument name) uses the
  `heading` role instead (`.spec__value--text`), since `stat` size would not fit beside its label.
- A live value updates in place with no animation beyond a 150 ms opacity tick, and its
  label says what it is (for example "solid fraction · live").
- Values whose true unit is model units say so.

**Tabs / lens bar.**
- Uppercase nav-style labels, `--fg-3`.
- The active label is `--fg` with a 1 px underline, or an inverted pill in the tool's
  lens bar.

**Inputs.**
- Text and select: transparent, radius 0, a 1 px `--rule-strong` underline that becomes
  `--fg` on focus.
- Slider:
  - track: 2 px `--rule-strong`, with the filled part in `--fg`;
  - thumb: a 12 px `--fg` circle;
  - on focus, the thumb gets the focus ring.
- Switch:
  - track: 28×16 with a 1 px border;
  - checked: filled `--fg`, knob `--bg`.

**Tags and status.**
- 1 px bordered pill, nav style at 11px.
- A warning or refusal has no color: it leads with `!` and sets the text in `--fg` at 500.
  A running state leads with `●` or `▶`.

**Panels (tool overlays, modals).**
- Background: `--overlay` when over a canvas, otherwise `--surface`.
- 1 px `--rule` border, radius 12, padding 16–20.
- No shadow.
- The header row uses the nav style, with a 1 px rule under it.

**The instrument's chrome (v8 D2; `tokens.css` "tool" section, `app/index.html`).**
- `<body class="tool">`: bare buttons are 28 px outline pills, checkboxes are switches,
  sliders are the 2 px track (`src/design/tool.ts` sets `--fill`), selects are underlined with a
  drawn chevron. Everything floating over the canvas sits on a `.plate` (`--overlay`), so it reads
  over every lens, the bright FIELD, ETCH and NEON ones included.
- Top left, one plate: the wordmark, `PHASE-FIELD SOLIDIFICATION · LIVE`, the melt's name and its
  caveats, then the live readouts as a compact spec rail (`.spec--tool`: label `--fg-3`, value in
  the tabular mono). The lens legends (scale bar, THERM colormap, SEM data bar) share one slot
  anchored under it.
- Top right: `learn` and `controls` pills (Inter 500 in their own lowercase, like every
  button), the `TRUE 3D` switch pill under them at their joint width; the lens bar is
  `.tabs--pill.tabs--tool`, a 5 x 2 grid of 312 x 64 (so it ends on the switch's line), the active
  lens inverted. When the canvas is too narrow for the bar beside that column, the bar takes a
  row of its own under it, right-aligned with it the way the view cube stacks.
- The focus ring of a control over the canvas is drawn inside its backing (a 2 px `--focus`
  ring inset 4 px; `--bg` on a pressed pill), never 2 px out on the live canvas.
- Bottom left: the transport as one pill plate, `▶ run` / `❚❚ pause` the one filled pill. While
  a mode panel is open, the panel's own primary is the view's and run / pause steps down to an
  outline pill; the HUD's cards fold away under the panel. The glyph pills' spoken names are
  their words (`pause`, `stop recording`).
- A narrow canvas (under 596 px, the lens bar's floor beside the head plate: a phone, a tablet
  held upright): the head plate gives way to the toggle column, the lens bar goes under the
  plate, and the legends and analysis columns follow it down. Such a window opens with the
  rail hidden; opened there, the rail is a drawer: the top chrome folds away until it closes
  (learn and controls stay), and a mode panel opened from it hides it. While a mode panel is
  open on a narrow canvas it has the screen: the plate, the lens bar and the legends step out.
- The view cube: gray faces shaded between `--surface` and `--rule-strong`, each lettered with
  the axis it faces (`+X` … `−Z`); the letters carry the orientation, so there is no colored axis.
- Inset 16 px (`--tool-edge`) from the window and the rail; tool rhythm 8 / 12 / 16.

**The panels built in script (v8 D2, second half; `tokens.css` "panels built in script",
`src/design/panel.ts`).**
- The mode panels (lab mode, heat treat, optimizer, challenge) are `.modepanel.plate.tpanel`: the
  panel spec over the canvas, 16 px padding, Inter 13. The header row is `.phead`: the title in
  the nav style (written in capitals where it is a name, `LAB MODE`; a plot's title keeps its
  case), quiet metadata after it, the "i", and `exit` / `close` pushed to the far end, over a
  1 px rule. `design/panel.ts` writes the class names (`panelHead`, `pill`, `kv`, `num`, `quiet`,
  `warnWord`, `warnLine`, `plotModal`), so no panel spells a color or a size.
- One filled pill per panel: `▶ pour and run`, `▶ run treatment`, `apply recipe`, `▶ start` /
  `rematch`, the composer's `pour`. Everything else is an outline pill; a destructive action is
  never the filled one (`■ abort` is an outline pill while a pour runs).
- Form rows (`.fbrow`, `src/formbits.ts`) stack: the label left and the value right in the
  tabular mono, the slider under the two at the row's width, so a long value keeps one line; a
  select or a switch sits on the label's line. `.fbform` lays them in 220 px columns.
- Reports are spec rails. `.kv`: the label in `--fg-3` on the left, what it says on the right, one
  label column for all rows (a subgrid), 1 px rules. The label and the value are separated by
  one literal space, so the text the gates parse is the sentence the card always printed.
  Label/value readouts with short values (the lab's cooling-curve analysis) use
  `.spec.spec--tool.spec--panel`.
- A number inside running text is `.v` (bright, tabular mono), every number in the line, the
  words around it Inter; a quiet label or caveat is `.q` (`--fg-3`), a quiet number `.v.q`;
  emphasis is brightness (`<b>` is `--fg` at 400 in the tool).
- Warnings carry no color. A verdict or refusal word is `.status--warn` (`--fg` at 500, a CSS
  `!`); a warning that is a whole sentence is `.warnline` (`--fg` at 400, the `!` at 500). The
  `!` is generated content, so it is never in the text a gate reads. The ⚠, ✕, ◇, ⚑ marks are
  gone; the composer's refusals and clamps are warning lines, a phase not grown a `.cinfo` note.
- The lab's run report is a panel down the left edge: sections are a `.psub` title over a 1 px
  rule, never a box inside the panel; the cooling curve is square-edged media, drawn at the
  size it is shown.
- The enlarged plots are `plotModal`: a `--surface` card on `--scrim`, the title and a `close`
  pill in its header, a modal for the keyboard too (focus in, Tab wraps, Escape closes, focus
  back to the ⤢ that opened it). The plot's type stays at its 11 px there; only its marks scale.
- Plots (U2 builds on this): the chrome reads the tokens through `token()`; tick and label text
  is Inter 11 px (`--fg-3`), a live number on a plot the mono in `--fg`, reference lines
  `--fg-4` or `--rule-strong`; the traces and markers take the data palette (below), and a
  legend is a swatch of each data color beside its word (never a color's name in the words). A
  mark that carries its own label (the cooling curve's `T_L`, `T_N`, `T_G`, `T_S`) needs no hue:
  `--fg` dots.
- The composer's tier key draws each tier as a small cell in the grid's own terms (edge, fill
  and an "Aa" in the tier's text color), with a key for the solutes in the mix; the refused
  tier's dotted edge is what separates it from "not a solute", past 3:1.
- The phase diagram (SVG): the frame, ticks, field labels and melt cursor are chrome, styled
  through the `.pd*` classes in `app/index.html`; its curves, regime band and markers are data,
  each with a `data-mark` attribute (how `RAIL-ACHROMATIC` tells the two apart).
- The probe crosshair and the SDAS ruler on the melt (2D and 3D) are `--fg` over a `--bg`
  casing (`#overlay .mk`), flat, legible over the white-hot MELT and the near-white ETCH.
- Type in these panels never goes under 12 px (`--t-ui-min`), 11 px only for plot ticks; the
  periodic grid's symbols are 12 px, and so are the activation switches' tags (`RENDER MODE`,
  `KARMA–RAPPEL`, `VOLUME`).

**Plots (U2 builds on this).**
- Chrome: axes, ticks, grid and titles in `--fg-3` / `--rule`; tick labels in Inter 11px.
- Data marks may use color, one categorical palette: its values are tokens (`--data-1` blue,
  `--data-2` orange, `--data-3` aqua, `--data-4` yellow, validated on `--bg`), and
  `src/design/plot.ts` is the one place a plot picks them, by slot in that fixed order: slot 1
  a plot's primary series (a cooling curve, the Scheil prediction, the rose, a sweep's band,
  the liquidus), slot 2 what is measured against it (the solidification moment, the measured
  points, the solidus), slots 3 and 4 the phase diagram's solver reading and residual path.
  Gray data marks (the invariant and solvus lines, a sweep's replicates) use the gray tokens.
- The plot core (U2, `src/plot/`): every canvas figure is laid out by one pure function
  (`layout.ts`) and painted by one painter in one of two themes (`theme.ts`). On screen: left
  and bottom axes with outward ticks and no gridlines, all chrome (axes, ticks, tick labels,
  titles, reference lines, the hover readout's frame) in `--fg-3` or brighter, so at least
  4.5:1 on `--bg`, `--surface` and `--overlay`; tick labels Inter 11 px, axis titles 12 px;
  stacked panels share their x axis, are lettered (a), (b), (c), and never share a y axis
  between two scales. An axis title always ends in its unit or says "dimensionless"
  (`quantity.ts`, over `src/units.ts`). A figure opens (click, Enter) into the enlarged view:
  the figure large with a hover readout, its data as a table, and CSV, PNG and "figure png"
  exports. The print figure is light: `--print-bg`, `--print-fg`, `--print-fg-2` and the
  palette's light steps `--print-data-1..4`, in the same slot order (both themes read the slots
  from `src/design/plot.ts`), with heavier lines; slots 3 and 4 are a step darker than the
  reference palette's light steps so every data mark is at least 3:1 on the paper, as on screen.
  A data mark is drawn opaque (the rose's wedges, the poles), so its 3:1 holds as validated. A
  label on a plot (a reference line's, a landmark's) takes the first spot clear of the data and
  of the other labels, and one with no clear spot sits on a `--bg` backing, never under a trace.
- The HUD's glance plots: a sparkline against sim time on its plate, the latest value in the
  mono on the title row, the plotted range and its unit under it at 11 px (the card's axis);
  the card is a button that opens its full plot.
- The analysis columns (U2, second half; `plot/analysis.ts`): every plot is a figure of the
  core at the column's width, 252 px (probe and Scheil 168 tall, the rose 212, the pole
  figures 236), a button (click, Enter) as well as the ⤢, and the 3D column's plots are the 2D
  one's twins. A live panel may print its latest value at the right end of its header band in
  the mono in `--fg` (the probe's `T 597.0 °C`). An event on the data (the moment the probe's
  cell froze) is a solid line in the slot of what is measured against the curve (slot 2),
  labelled beside it; a reference (a liquidus, a zero) stays a dashed chrome line.
- Polar figures (`plot/polar.ts`): the rim and its outward ticks are the axis, labelled
  outside the rim at 11 px; the radial scale is two or three dashed rings, each labelled just
  inside its own ring on a `--bg` backing (a label sits on the data there); what the radius
  means, the reference direction and the projection are named in a caption under the figure,
  never left to the reader. The rose is area-true (radius ∝ √(area fraction)), its angles in
  whole degrees clockwise from the micrograph's +x (its y axis points down), every symmetry
  period boundary a tick. A pole figure is stereographic, upper hemisphere, X right, Y up, Z
  at the center, rings at 30° and 60° of tilt; its poles are one data slot (the per-grain
  ORIENT hue they carried was a second encoding of position, from outside the palette), dot
  diameter proportional to the grain's, each dot opaque on a thin `--bg` ring so overlapping
  poles stay apart. The rose's radial rings share the step that set its rim, so the rim is
  always a labelled ring.
- The phase diagram (SVG, `phasediagram.ts`): round ticks from the core's generator inside the
  frame's own domain (never widened), plus the invariant's exact temperature as a tick of its
  own in `--fg-2`; the left and bottom edges are the axes in `--fg-3`, the box's other two sides
  stay `--rule-strong`; titles `Temperature T (°C)` and `Composition c_Si (wt%)`; a key under it
  (each drawn mark's swatch, a `data-mark` element, beside its word); a crosshair readout of
  the composition, the temperature, and where the liquidus and solidus cross that composition;
  the ⤢ opens the shared enlarged view inside the composer, with every drawn vertex as the data
  table and the same three exports (the PNGs are painted from the SVG's computed styles, so
  they use the page's own fonts; the print figure maps each token to its `--print-*` twin).
  Its type is in the figure's units, re-sized to the width the SVG is drawn at (`pdFontFor`),
  so the ticks are 11 px and the titles 12 px at every width: the composer on a desktop, a
  phone or beside the tour, and the enlarged view.
- A data table's word columns (the diagram's element and label) are set left in the body face
  in `--fg-2`; numbers stay right, in the mono.

**Links.** `--fg` with a 1 px underline at 3 px offset; hover drops the underline.

**Scrollbars.** Thin; thumb `--rule-strong`, track transparent.

**Selection.** `--fg` background, `--bg` text.

## 6. Landing layout

- **Hero (pinned, scroll-scrubbed render; `src/hero.ts`).**
  - Two columns: the render frame on the left (square, contained, about 52% of the width), and
    one copy column on the right.
  - The copy column holds: kicker (nav style, `--fg-3`), display title, body-l in `--fg-2`
    (at most 36ch), CTAs.
  - The chapters (grow, branch, cool, pull back, end) replace each other in that same column as
    you scroll, one at a time.
  - During the tour, the right column becomes a spec rail of the five features, numbered in the
    manifest's order: `01 PRIMARY ARM ⟨100⟩`, `02 TIP`, `03 SECONDARY ARM SPACING λ₂`,
    `04 TERTIARY ARM`, `05 NECKED ROOT`, each with its one line of copy. The active row is `--fg`
    and the rest `--fg-3`. A 1 px `--fg-3` leader runs from the active row to its anchor on the
    render.
  - The caption sits under the render in nav style `--fg-3`; the skip link, in the same style, sits
    level with it at the page's right inset, from 1,000 px into the pin until the end chapter.
  - The render's square fades 6% at its edges (18% at the right, live, where the tour's framing
    runs the crystal off the side facing the copy).
  - Stacked (narrow screens): render on top, copy below; the caption and the skip link sit on the
    copy column's left edge, with `--s-5` between the skip link and the column.
  - The still (no JS, reduced motion, a short screen): all five marks on the poster, each number
    at the first spot clear of the others.
- **Lens act, melt-types act, TRUE 3D act.**
  - Live canvas on one side (square-edged, no card), a spec column on the other.
  - The spec column holds: kicker, display-2 name, one line of body-l, then a spec rail.
  - A lens row set says: what the lens shows, the real instrument it imitates, and live
    readouts from the running melt (solid fraction, grains, grid).
  - A material row set says: melting point, crystal structure, dendrite symmetry and glow
    at pour, all read from `materials.ts`.
  - The progress rail is a row of thin segments, the current one `--fg`.
- **Footer.** Figure's footer matrix: grouped links, nav-style group labels, 40 px between
  groups, 1 px top rule.

## 7. Don't

- Chromatic UI tokens, or color used to mean status.
- Bold display type.
- Rounded media.
- Cards around canvases.
- Shadows.
- Gray long copy on black.
- A second filled button in one view.
- Numbers without a source.
- Any value outside `tokens.css` (grep for hex colors in `src/` and the HTML when reviewing).
