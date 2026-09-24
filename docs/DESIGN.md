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
| `--overlay` | `rgba(10,10,10,0.86)` + `backdrop-filter: blur(12px)` | panels floating over a live canvas |
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
- Toggled or active: inverted (`--fg` fill, `--bg` text).
- Disabled: `--fg-4` text on a `--rule` border.
- Pressed: 0.96 scale, 120 ms.
- The tool drops emoji-like glyph icons (⚗ ⚙ ●). Monochrome ▶ ❚❚ for run/pause are fine.

**Spec rail (Figure's "technical specification rail").**
- Rows stacked, each with a 1 px `--rule` top border and 16–20 px padding.
- Label: Inter 13–14px `--fg-3`, left. It may carry a second, smaller line.
- Value: `stat`, right-aligned, `--fg`. The unit follows at 0.45em in `--fg-3`.
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

**Plots (U2 builds on this).**
- Chrome: axes, ticks, grid and titles in `--fg-3` / `--rule`; tick labels in Inter 11px.
- Data marks may use color, one categorical palette defined in the plot module and nowhere
  else.

**Links.** `--fg` with a 1 px underline at 3 px offset; hover drops the underline.

**Scrollbars.** Thin; thumb `--rule-strong`, track transparent.

**Selection.** `--fg` background, `--bg` text.

## 6. Landing layout

- **Hero (pinned, scroll-scrubbed render; `src/hero.ts`).**
  - Two columns: the render frame on the left (square, contained, about 52% of the width), and
    one copy column on the right.
  - The copy column holds: kicker (nav style, `--fg-3`), display title, body-l in `--fg-2`
    (at most 36ch), CTAs.
  - The chapters (grow, cool, end) replace each other in that same column as you scroll.
  - During the tour, the right column becomes a spec rail of the five features: `01 TIP`,
    `02 PRIMARY ARM ⟨100⟩`, `03 λ₂`, `04 TERTIARY ARM`, `05 NECKED ROOT`, each with its one
    line of copy. The active row is `--fg` and the rest `--fg-3`. A 1 px `--fg-3` leader runs
    from the active row to its anchor on the render.
  - The caption sits under the render in nav style `--fg-3`.
  - Stacked (narrow screens): render on top, copy below.
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
