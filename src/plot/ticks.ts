// Tick values and their labels for every plot in the instrument (U2).
//
// The tick generator is a port of d3-array's `ticks` / `tickIncrement` /
// `tickStep` (d3-array 3.2, src/ticks.js; ISC licence, Copyright 2010-2023
// Mike Bostock). It is ported rather than depended on because it is the one
// piece of d3-scale worth having (charts-audit section 6), and because its
// negative-power branch is what makes ticks exact: 0.1 * 3 is
// 0.30000000000000004, while 3 / 10 is 0.3, and a tick label printed from the
// first is wrong in its last digit.
//
// Pure: no DOM, no imports, so scripts/verify-plot.mjs loads it without a
// browser.

const E10 = Math.sqrt(50), E5 = Math.sqrt(10), E2 = Math.sqrt(2);

function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(step));
  const error = step / Math.pow(10, power);
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  let i1: number, i2: number, inc: number;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

/**
 * About `count` round values (1, 2 or 5 times a power of ten apart) inside
 * [start, stop], inclusive. The domain is never widened: a plot's frame is
 * its data's extent, and the phase diagram's frame-tightness gate depends on
 * that (charts-audit section 6).
 */
export function ticks(start: number, stop: number, count: number): number[] {
  if (!(count > 0) || !Number.isFinite(start) || !Number.isFinite(stop)) return [];
  if (start === stop) return [start];
  const reverse = stop < start;
  const [i1, i2, inc] = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1;
  const out = new Array<number>(n);
  if (reverse) {
    if (inc < 0) for (let i = 0; i < n; ++i) out[i] = (i2 - i) / -inc;
    else for (let i = 0; i < n; ++i) out[i] = (i2 - i) * inc;
  } else {
    if (inc < 0) for (let i = 0; i < n; ++i) out[i] = (i1 + i) / -inc;
    else for (let i = 0; i < n; ++i) out[i] = (i1 + i) * inc;
  }
  return out;
}

/** d3's tickIncrement: the step as an integer, or its negative reciprocal */
export function tickIncrement(start: number, stop: number, count: number): number {
  return tickSpec(start, stop, count)[2];
}

/** the distance between two adjacent ticks of ticks(start, stop, count) */
export function tickStep(start: number, stop: number, count: number): number {
  const reverse = stop < start;
  const inc = reverse ? tickIncrement(stop, start, count) : tickIncrement(start, stop, count);
  return (reverse ? -1 : 1) * (inc < 0 ? 1 / -inc : inc);
}

/** the step alone, for a span and a target count (1-2-5 x 10^k) */
export const niceStep = (span: number, target: number): number => Math.abs(tickStep(0, Math.abs(span), target));

/** the typographic minus sign: a figure's negative numbers use it, not "-" */
export const MINUS = "−";

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
};
/** 10 to an integer power, as a figure writes it: 10³, 10⁻⁶ */
export const pow10Text = (n: number): string => "10" + String(n).split("").map(c => SUP[c] ?? c).join("");

/** decimals a tick label needs so every multiple of `step` prints exactly:
 *  0.2 needs one, 0.25 two, 5 none */
export function decimalsFor(step: number): number {
  const s = Math.abs(step);
  if (!(s > 0) || !Number.isFinite(s)) return 0;
  for (let d = 0; d <= 12; d++) {
    const x = s * Math.pow(10, d);
    if (Math.abs(x - Math.round(x)) < 1e-9 * Math.max(1, x)) return d;
  }
  return 12;
}

/**
 * A tick label. Decimals follow the step (0.25 steps print "0.25", "0.50");
 * negatives take the true minus sign; values past 1e4 or under 1e-3 switch to
 * scientific ("2.5×10⁴"). A plot that factors a power of ten out into its axis
 * title (layout.ts) never reaches the scientific branch.
 */
export function fmtTick(v: number, step: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a === 0 || Math.abs(v) < step * 1e-6) return "0";
  if (a >= 1e4 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = v / Math.pow(10, e);
    const ms = Number(m.toFixed(2)).toString();
    return `${(ms.startsWith("-") ? MINUS + ms.slice(1) : ms)}×${pow10Text(e)}`;
  }
  const s = v.toFixed(decimalsFor(step));
  return s.startsWith("-") ? MINUS + s.slice(1) : s;
}

/**
 * The power of ten an axis should factor out of its labels, in steps of
 * three (10³, 10⁻³): 0 when the largest label already reads well (between
 * 0.01 and 10 000). A figure writes "dT/dt (10³ K·s⁻¹)" and labels 1, 2, 3
 * rather than 1000, 2000, 3000.
 */
export function axisPower(values: number[]): number {
  let m = 0;
  for (const v of values) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  if (m === 0 || (m >= 0.01 && m < 1e4)) return 0;
  return 3 * Math.floor(Math.log10(m) / 3);
}

/**
 * A formatter for one table column: the decimals that give its largest value
 * `sig` significant digits, the same for every row, so the digits line up
 * (and a least-squares 3e-14 prints as 0.0000, not as noise). A column whose
 * values run past 1e6 or all sit under 1e-4 is printed in scientific form.
 */
export function columnFormat(values: number[], sig = 5): (v: number) => string {
  let m = 0, exact = 0;
  for (const v of values) if (Number.isFinite(v)) { m = Math.max(m, Math.abs(v)); exact = Math.max(exact, decimalsFor(v)); }
  if (m >= 1e6 || (m > 0 && m < 1e-4)) return v => fmtValue(v, sig);
  // never more decimals than the values carry: counts print as integers,
  // bin edges 7.5 and 8 as 7.5 and 8.0
  const d = m === 0 ? 0 : Math.min(exact, 8, Math.max(0, sig - 1 - Math.floor(Math.log10(m))));
  return v => {
    if (!Number.isFinite(v)) return "—";
    const s = v.toFixed(d);
    return /^-0\.?0*$/.test(s) ? s.slice(1) : s.startsWith("-") ? MINUS + s.slice(1) : s;
  };
}

/** a number for a readout or a table cell: `sig` significant digits, true
 *  minus, scientific past 1e5 or under 1e-4 */
export function fmtValue(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  let s: string;
  if (a >= 1e5 || a < 1e-4) {
    const e = Math.floor(Math.log10(a));
    s = `${Number((v / Math.pow(10, e)).toPrecision(Math.max(1, sig - 1)))}×${pow10Text(e)}`;
  } else {
    const d = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    s = v.toFixed(Math.min(d, 8));
  }
  return s.startsWith("-") ? MINUS + s.slice(1) : s;
}
