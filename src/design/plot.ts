// The plots' one categorical data palette (docs/DESIGN.md 5, plots). The
// values are tokens (tokens.css --data-1 ... --data-4, like every color);
// this module is the one place a plot picks its data colors, by slot, so the
// same kind of mark is the same color in every plot:
//
//   slot 0  a plot's primary series: the probe's cooling curve (2D, 3D and
//           the lab report), the Scheil prediction, the orientation rose,
//           a sweep's band and mean, the phase diagram's liquidus, the pour
//   slot 1  what is measured against it: the solidification moment on a
//           cooling curve, the measured (f_s, T_interface) points, the
//           phase diagram's solidus
//   slot 2  the phase diagram's solver reading (its line and its dot)
//   slot 3  the phase diagram's residual-liquid path
//
// Slots are used in this fixed order and never cycled. Everything else on a
// plot is chrome and reads the gray tokens directly (token("--fg-3") ...);
// a gray data mark (the invariant and solvus lines, a sweep's replicate
// dots, the lab curve's labeled landmarks) is a gray token too. Only data
// marks carry a hue, and no module spells one.
//
// Nothing here touches the document at import time: the browser-free gates
// load modules that import this one.
import { token, tokenRGBA } from "./tool";

const SLOTS = ["--data-1", "--data-2", "--data-3", "--data-4"] as const;

/** a slot's color for a canvas (the token's value) */
export const series = (slot: 0 | 1 | 2 | 3): string => token(SLOTS[slot]);
/** a slot's color at an alpha, for a canvas fill (a translucent band) */
export const seriesAlpha = (slot: 0 | 1 | 2 | 3, alpha: number): string => tokenRGBA(SLOTS[slot], alpha);
/** a slot's color as a CSS reference, for an SVG mark's style */
export const seriesVar = (slot: 0 | 1 | 2 | 3): string => `var(${SLOTS[slot]})`;
