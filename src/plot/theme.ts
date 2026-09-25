// The two looks a figure is painted in (U2): the instrument's dark screen and
// a light print figure. Every value is a token (tokens.css); this module only
// names which token plays which role, so the gate (verify-plot.mjs) can read
// the same map and check each text role's contrast against each background.
//
// Chrome (axes, ticks, tick labels, titles, reference lines, the readout's
// frame) is gray and at least 4.5:1 on the surface it sits on; data marks take
// the palette's slots (design/plot.ts on screen, --print-data-* in print).
import { token } from "../design/tool";
import { SLOTS, PRINT_SLOTS } from "../design/plot";

export interface Roles {
  /** the figure's own background ("" = transparent: the panel shows through) */
  bg: string;
  /** tick labels, the tag, the legend's words, an empty plot's message */
  tick: string;
  /** axis titles */
  title: string;
  /** axis lines and tick marks */
  axis: string;
  /** reference lines (a liquidus, a zero) and their labels */
  ref: string;
  /** labelled landmark dots, and their labels */
  mark: string;
  markLabel: string;
  /** the hover readout's box, frame and text */
  readoutBg: string;
  readoutRule: string;
  readoutText: string;
  readoutValue: string;
  /** the data slots */
  data: [string, string, string, string];
}

/** the backgrounds a screen figure's text must read on: the modal card
 *  (--surface), the page (--bg), and the panels over the live canvas
 *  (--overlay, checked by the gate over a white pixel, its worst case) */
export const SCREEN_SURFACES = ["--bg", "--surface", "--overlay"] as const;

export const SCREEN: Roles = {
  bg: "", tick: "--fg-3", title: "--fg-3", axis: "--fg-3", ref: "--fg-3", mark: "--fg", markLabel: "--fg-2",
  readoutBg: "--bg", readoutRule: "--rule-strong", readoutText: "--fg-3", readoutValue: "--fg",
  // by slot, from the one place a plot picks its data colors (design/plot.ts)
  data: [SLOTS[0], SLOTS[1], SLOTS[2], SLOTS[3]],
};

export const PRINT: Roles = {
  bg: "--print-bg", tick: "--print-fg-2", title: "--print-fg", axis: "--print-fg", ref: "--print-fg-2",
  mark: "--print-fg", markLabel: "--print-fg", readoutBg: "--print-bg", readoutRule: "--print-fg-2",
  readoutText: "--print-fg-2", readoutValue: "--print-fg",
  data: [PRINT_SLOTS[0], PRINT_SLOTS[1], PRINT_SLOTS[2], PRINT_SLOTS[3]],
};

/** a theme with its tokens read: what the painter uses */
export interface Theme {
  bg: string | null;
  tick: string; title: string; axis: string; ref: string; mark: string; markLabel: string;
  readoutBg: string; readoutRule: string; readoutText: string; readoutValue: string;
  data: [string, string, string, string];
  font: string;
  mono: string;
  /** line weight multiplier: print figures are drawn heavier */
  weight: number;
}

export function themeOf(r: Roles, opt: { bg?: string | null; weight?: number } = {}): Theme {
  const t = (n: string) => token(n);
  return {
    bg: opt.bg !== undefined ? opt.bg : r.bg ? t(r.bg) : null,
    tick: t(r.tick), title: t(r.title), axis: t(r.axis), ref: t(r.ref), mark: t(r.mark), markLabel: t(r.markLabel),
    readoutBg: t(r.readoutBg), readoutRule: t(r.readoutRule), readoutText: t(r.readoutText), readoutValue: t(r.readoutValue),
    data: r.data.map(t) as Theme["data"],
    font: t("--font-body"),
    mono: t("--font-mono"),
    weight: opt.weight ?? 1,
  };
}

/** the instrument's figure: transparent over its panel */
export const screenTheme = (): Theme => themeOf(SCREEN);
/** a screen PNG: the modal card's --surface behind it */
export const screenPngTheme = (): Theme => themeOf(SCREEN, { bg: token("--surface") });
/** a print figure: light, heavier lines */
export const printTheme = (): Theme => themeOf(PRINT, { weight: 1.5 });
