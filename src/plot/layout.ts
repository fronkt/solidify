// Figure geometry, from data to pixels, with no browser (U2).
//
// `layoutFigure` takes a figure spec in DISPLAY units (quantity.ts converted
// it) and a size in CSS px, and returns everything the painter draws: the
// plot rectangles, tick positions and labels, axis titles, series polylines,
// reference lines, labelled marks and legend entries, each text item with its
// box. The painter (paint.ts) only strokes and fills what this returns, so the
// geometry is gated in CI by scripts/verify-plot.mjs: margins sized to the
// tick labels and titles, nothing outside the canvas, a plotted point
// re-derived from its own axis ticks (the "presence is not placement" lesson).
//
// Style (docs/DESIGN.md 5, plots): left and bottom axes with outward ticks,
// no gridlines, tick labels Inter 11 px, axis titles 12 px; stacked panels
// share the x axis and label it once, at the bottom; a panel with a legend
// or a tag gets a header band. Text may carry `_{...}` subscripts.
import { ticks, tickStep, fmtTick, axisPower, pow10Text, decimalsFor } from "./ticks";

/** type sizes, CSS px (DESIGN.md: 11 px for ticks, the 12 px floor for the rest) */
export const FONT = { tick: 11, title: 12, label: 11, legend: 11, tag: 11, empty: 12, value: 11 } as const;
const TICK = 4;          // tick length
const PAD = 6;           // canvas edge padding
const BAND = 16;         // a panel's header band (legend, tag)
const GAP = 12;          // between stacked panels

/** width of `text` set at `px`: ctx.measureText in the browser */
export type Measure = (text: string, px: number, mono?: boolean) => number;

/**
 * A deterministic stand-in for the browser's measurement, used by the
 * browser-free gate. It errs wide (Inter's digits are 0.57 em, capitals up to
 * 0.72 em), so a layout that fits under it fits on screen.
 */
export const approxMeasure: Measure = (text, px, mono = false) => {
  let w = 0;
  for (const ch of text) {
    if (/[̀-ͯ]/.test(ch)) continue;            // combining marks take no width
    if (mono) { w += 0.6; continue; }
    w += /[0-9]/.test(ch) ? 0.6 : /[A-ZΔ]/.test(ch) ? 0.72 : /[ .,:;·|'()]/.test(ch) ? 0.34 : 0.58;
  }
  return w * px;
};

/** a text run: plain, or a subscript */
export interface Run { text: string; sub: boolean }
/** parse figure markup: `_{...}` is a subscript, as is `_x` (one character) */
export function runs(s: string): Run[] {
  const out: Run[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "_" && i + 1 < s.length) {
      if (buf) { out.push({ text: buf, sub: false }); buf = ""; }
      if (s[i + 1] === "{") {
        const j = s.indexOf("}", i + 2);
        const end = j < 0 ? s.length : j;
        out.push({ text: s.slice(i + 2, end), sub: true });
        i = end;
      } else {
        out.push({ text: s[i + 1], sub: true });
        i += 1;
      }
      continue;
    }
    buf += s[i];
  }
  if (buf) out.push({ text: buf, sub: false });
  return out;
}
/** a subscript's size relative to its line */
export const SUB = 0.78;
/** the width of markup text */
export const richWidth = (m: Measure, s: string, px: number, mono = false): number =>
  runs(s).reduce((w, r) => w + m(r.text, r.sub ? px * SUB : px, mono), 0);
/** markup as plain text (a subscript joined on: T_{L} -> TL), for a search */
export const plain = (s: string): string => runs(s).map(r => r.text).join("");

// ------------------------------------------------------------------ specs

export interface AxisSpec {
  /** the full title, unit last in parentheses (quantity.ts resolve) */
  title: string;
  /** a shorter title (symbol and unit) used when the full one does not fit */
  short?: string;
  lo: number;
  hi: number;
  /** the readout's symbol and unit for the value at the cursor */
  sym?: string;
  unit?: string;
  /** extend `hi` to the next round tick (a count axis) */
  niceHi?: boolean;
}

export interface SeriesSpec {
  key: string;
  /** the legend's word for it; absent: not in the legend */
  label?: string;
  /** the data palette slot (design/plot.ts) */
  slot: 0 | 1 | 2 | 3;
  xs: number[];
  ys: number[];
  kind?: "line" | "dots";
  dash?: boolean;
  /** readout symbol and unit */
  sym?: string;
  unit?: string;
}

/** a reference line (a liquidus, a zero): chrome, dashed, labelled at its
 *  end. With a `slot` it is an EVENT on the data (the moment the probe's cell
 *  froze): a solid line in that data color, labelled the same way */
export interface RefSpec { y?: number; x?: number; label?: string; slot?: 0 | 1 | 2 | 3 }
/** a labelled landmark on the data (T_L, T_N): an --fg dot with its label */
export interface MarkSpec { x: number; y: number; label: string }
/** a histogram's bars: bin edges (n + 1) and counts (n) */
export interface BarsSpec { edges: number[]; counts: number[]; slot: 0 | 1 | 2 | 3 }

export interface PanelSpec {
  y: AxisSpec;
  series: SeriesSpec[];
  refs?: RefSpec[];
  marks?: MarkSpec[];
  bars?: BarsSpec;
  /** a panel letter, "(a)" */
  tag?: string;
  /** relative height among stacked panels (default 1) */
  weight?: number;
  /** the latest value, printed in the header band's right end in the mono
   *  ("T 612.4 °C"): a live panel's number, as the HUD's card prints its own */
  live?: string;
}

export interface FigSpec {
  x: AxisSpec;
  panels: PanelSpec[];
  /** shown instead of the plot when there is nothing to draw */
  empty?: string | null;
}

// ----------------------------------------------------------------- output

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Tick { v: number; px: number; label: string }
export type Role = "tick" | "title" | "label" | "legend" | "tag" | "empty" | "value";
export interface TextItem {
  text: string;
  role: Role;
  px: number;
  /** anchor point; `rotate` texts run bottom to top, centered on it */
  x: number;
  y: number;
  align: "left" | "center" | "right";
  /** vertical placement of the anchor: the text's middle line */
  rotate?: boolean;
  /** the drawn extent, for the gate's containment and overlap checks */
  box: Box;
  /** a label that found no spot clear of the data: drawn on a backing in the
   *  figure's background (the painter), so a trace never runs through it */
  knock?: boolean;
}
export interface PathOut { key: string; slot: 0 | 1 | 2 | 3; kind: "line" | "dots"; dash: boolean; label?: string;
  /** polylines in px, split where the data has a gap (a non-finite value) */
  paths: number[][] }
export interface PanelOut {
  rect: Box;
  y: { lo: number; hi: number; ticks: Tick[]; power: number; title: string };
  series: PathOut[];
  refs: { x0: number; y0: number; x1: number; y1: number; slot?: 0 | 1 | 2 | 3 }[];
  marks: { x: number; y: number }[];
  bars: { box: Box; slot: 0 | 1 | 2 | 3 }[];
  legend: { slot: 0 | 1 | 2 | 3; dash: boolean; kind: "line" | "dots"; x: number; y: number }[];
}
export interface Layout {
  w: number;
  h: number;
  x: { lo: number; hi: number; ticks: Tick[]; power: number; title: string };
  panels: PanelOut[];
  texts: TextItem[];
  /** axis lines and tick marks, px */
  lines: number[][];
  empty: string | null;
}

// ------------------------------------------------------------------ helpers

/** a data extent with `pad` of its span on each side (never zero-width) */
export function extent(arrays: number[][], opt: { pad?: number; include?: number[] } = {}): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) for (const v of a) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (const v of opt.include ?? []) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi === lo) { const d = Math.abs(lo) * 0.05 || 0.5; lo -= d; hi += d; }
  const p = (hi - lo) * (opt.pad ?? 0.06);
  return [lo - p, hi + p];
}

/** insert a factored power of ten into a title's unit: "(K·s⁻¹)" ->
 *  "(10³ K·s⁻¹)", "(dimensionless)" -> "(×10⁻³, dimensionless)" */
export function titleWithPower(t: string, p: number): string {
  if (!p) return t;
  const i = t.lastIndexOf("(");
  if (i < 0 || !t.endsWith(")")) return `${t} (×${pow10Text(p)})`;
  const unit = t.slice(i + 1, -1);
  const f = pow10Text(p);
  return unit.startsWith("dimensionless")
    ? `${t.slice(0, i + 1)}×${f}, ${unit})`
    : `${t.slice(0, i + 1)}${f} ${unit})`;
}

const lerp = (v: number, lo: number, hi: number, a: number, b: number): number =>
  a + ((v - lo) / (hi - lo || 1)) * (b - a);

/** ticks of an axis, their labels (with a factored power) and positions */
function axisTicks(lo: number, hi: number, count: number, a: number, b: number) {
  // at least two labelled ticks, or the axis has no scale a reader can take
  // off it (a short stacked panel asked for two got one: the rate panel of
  // a three-panel figure at 1024x768)
  let vs = ticks(lo, hi, count);
  for (let c = count + 1; vs.length < 2 && c <= count + 4; c++) vs = ticks(lo, hi, c);
  const step = vs.length > 1 ? vs[1] - vs[0] : Math.abs(tickStep(lo, hi, count)) || 1;
  const power = axisPower(vs);
  const f = Math.pow(10, power);
  return {
    power,
    ticks: vs.map(v => ({ v, px: lerp(v, lo, hi, a, b), label: fmtTick(v / f, step / f) })),
  };
}

const boxAt = (x: number, y: number, w: number, h: number, align: TextItem["align"]): Box => {
  const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  return { x0, y0: y - h / 2, x1: x0 + w, y1: y + h / 2 };
};
const overlaps = (a: Box, b: Box, m = 0): boolean =>
  a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
const inside = (a: Box, r: Box): boolean => a.x0 >= r.x0 && a.x1 <= r.x1 && a.y0 >= r.y0 && a.y1 <= r.y1;

/** does the segment (x0, y0)-(x1, y1) meet the box (Liang–Barsky clipping) */
export function segMeetsBox(x0: number, y0: number, x1: number, y1: number, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - b.x0], [dx, b.x1 - x0], [-dy, y0 - b.y0], [dy, b.y1 - y0]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/** a series' marks as px geometry a label must keep clear of: a line's
 *  segments, a dot series' dots (as boxes) */
export interface DataInk { kind: "line" | "dots"; paths: number[][] }
/** does a box meet any drawn data: a segment of a line, a dot's box, or an
 *  extra obstacle (a reference line's segment, a landmark's dot) */
export function boxMeetsData(b: Box, ink: DataInk[], segs: number[][] = [], dots: Box[] = []): boolean {
  for (const s of ink) for (const p of s.paths) {
    if (s.kind === "dots" || p.length === 2) {
      for (let i = 0; i + 1 < p.length; i += 2) if (overlaps(b, { x0: p[i] - 2.5, y0: p[i + 1] - 2.5, x1: p[i] + 2.5, y1: p[i + 1] + 2.5 })) return true;
      continue;
    }
    for (let i = 0; i + 3 < p.length; i += 2) if (segMeetsBox(p[i], p[i + 1], p[i + 2], p[i + 3], b)) return true;
  }
  for (const [x0, y0, x1, y1] of segs) if (segMeetsBox(x0, y0, x1, y1, b)) return true;
  return dots.some(d => overlaps(b, d));
}

// ------------------------------------------------------------------ layout

/**
 * Lay a figure out at `w` x `h` CSS px. Everything returned is in CSS px from
 * the canvas's top left; the painter scales by the device pixel ratio.
 */
export function layoutFigure(fig: FigSpec, w: number, h: number, measure: Measure = approxMeasure): Layout {
  const texts: TextItem[] = [];
  const lines: number[][] = [];
  const addText = (t: Omit<TextItem, "box">, width: number, height: number) => {
    const box = t.rotate ? boxAt(t.x, t.y, height, width, "center") : boxAt(t.x, t.y, width, height, t.align);
    const item = { ...t, box };
    texts.push(item);
    return item;
  };
  const hasData = fig.panels.some(p => (p.bars && p.bars.counts.length > 0)
    || p.series.some(s => s.xs.filter((x, i) => Number.isFinite(x) && Number.isFinite(s.ys[i])).length >= (s.kind === "dots" ? 1 : 2)));
  const emptyMsg = fig.empty ?? (hasData ? null : "no data yet");
  if (emptyMsg) {
    const tw = measure(emptyMsg, FONT.empty);
    addText({ text: emptyMsg, role: "empty", px: FONT.empty, x: w / 2, y: h / 2, align: "center" }, tw, FONT.empty);
    return { w, h, x: { lo: fig.x.lo, hi: fig.x.hi, ticks: [], power: 0, title: fig.x.title }, panels: [], texts, lines, empty: emptyMsg };
  }

  // -- vertical budget: header bands, the shared x axis at the bottom
  const bottom = TICK + 3 + FONT.tick + 7 + FONT.title + PAD;
  const n = fig.panels.length;
  const wsum = fig.panels.reduce((a, p) => a + (p.weight ?? 1), 0);
  const budget = (bands: number[]) => {
    const avail = h - PAD - bottom - GAP * (n - 1) - bands.reduce((a, b) => a + b, 0);
    return fig.panels.map(p => Math.max(24, (avail * (p.weight ?? 1)) / wsum));
  };
  let bands: number[] = fig.panels.map(p => (p.tag || p.live || p.series.some(s => s.label)) ? BAND : 0);
  let heights = budget(bands);
  // the y titles run up the left side, each centered on its panel, unless one
  // (even in its short form) is longer than its panel is tall: then EVERY
  // panel's title is set level in its header band, over its axis, so a figure
  // never mixes the two
  const fitsUp = (p: PanelSpec, i: number) =>
    richWidth(measure, p.y.short ?? p.y.title, FONT.title) <= heights[i] + 4;
  const level = !fig.panels.every(fitsUp);
  // a level title shares its band with the legend; where the two do not fit
  // side by side (a phone's width) the legend takes a row of its own above
  // it. The plot's width is not known yet: 96 px is more than any left and
  // right margin these figures get, so the estimate errs toward two rows
  const liveW = (p: PanelSpec) => (p.live ? measure(p.live, FONT.value, true) + 12 : 0);
  const legendW = (p: PanelSpec) => p.series.filter(s => s.label)
    .reduce((a, s, i) => a + richWidth(measure, s.label!, FONT.legend) + 18 + (i ? 12 : 0), liveW(p));
  const twoRows = fig.panels.map(p => level && legendW(p) > 0
    && richWidth(measure, p.y.short ?? p.y.title, FONT.title) + 8 + legendW(p) > w - 96);
  if (level) { bands = twoRows.map(t => (t ? 2 * BAND : BAND)); heights = budget(bands); }

  // -- y ticks per panel (their count follows the panel's height), then the
  //    left margin from the widest y label and, when titles run up the side,
  //    the rotated title
  let top = PAD;
  const yAx = fig.panels.map((p, i) => {
    top += bands[i];
    const y0 = top, y1 = top + heights[i];
    top = y1 + GAP;
    let hi = p.y.hi;
    const count = Math.max(2, Math.min(6, Math.round(heights[i] / 34)));
    if (p.y.niceHi) {
      const st = Math.abs(tickStep(p.y.lo, hi, count));
      if (st > 0) hi = Math.ceil(hi / st - 1e-9) * st;
    }
    const t = axisTicks(p.y.lo, hi, count, y1, y0);
    return { y0, y1, lo: p.y.lo, hi, ...t };
  });
  const yLabelW = Math.max(0, ...yAx.flatMap(a => a.ticks.map(t => measure(t.label, FONT.tick))));
  // (a level title and the panel tag need the left edge too: the tag sits at
  // PAD, the title starts over the axis)
  const tagW = Math.max(0, ...fig.panels.map(p => (p.tag ? measure(p.tag, FONT.tag) + 8 : 0)));
  const left = PAD + (level ? Math.max(0, tagW - yLabelW - 8) : FONT.title + 6) + yLabelW + 4 + TICK;

  // -- x ticks: as many as fit without their labels touching; the right
  //    margin makes room for half the last label
  let right = PAD + 4;
  let xt: ReturnType<typeof axisTicks> | null = null;
  for (let count = Math.max(2, Math.min(9, Math.round((w - left - right) / 64))); count >= 2 && !xt; count--) {
    for (let pass = 0; pass < 2; pass++) {
      const t = axisTicks(fig.x.lo, fig.x.hi, count, left, w - right);
      const ws = t.ticks.map(k => measure(k.label, FONT.tick));
      // the last label may not run past the canvas: widen the right margin
      // once and lay the ticks out again
      const k = t.ticks.length - 1;
      const over = k >= 0 ? t.ticks[k].px + ws[k] / 2 - (w - PAD) : 0;
      if (over > 0 && pass === 0) { right += over + 1; continue; }
      let ok = true;
      for (let i = 1; i < t.ticks.length; i++)
        if (t.ticks[i].px - ws[i] / 2 < t.ticks[i - 1].px + ws[i - 1] / 2 + 8) ok = false;
      if (ok) xt = t;
      break;
    }
  }
  xt ??= axisTicks(fig.x.lo, fig.x.hi, 2, left, w - right);
  const x0 = left, x1 = w - right;
  const X = (v: number) => lerp(v, fig.x.lo, fig.x.hi, x0, x1);

  // -- panels
  const panels: PanelOut[] = [];
  const placed: Box[] = [];
  fig.panels.forEach((p, i) => {
    const a = yAx[i];
    const rect: Box = { x0, y0: a.y0, x1, y1: a.y1 };
    const Y = (v: number) => lerp(v, a.lo, a.hi, a.y1, a.y0);
    // axes: left and bottom, ticks outward
    lines.push([x0, a.y0, x0, a.y1], [x0, a.y1, x1, a.y1]);
    for (const t of a.ticks) {
      lines.push([x0 - TICK, t.px, x0, t.px]);
      const tw = measure(t.label, FONT.tick);
      placed.push(addText({ text: t.label, role: "tick", px: FONT.tick, x: x0 - TICK - 3, y: t.px, align: "right" }, tw, FONT.tick).box);
    }
    for (const t of xt.ticks) lines.push([t.px, a.y1, t.px, a.y1 + TICK]);

    // the header band: the tag at the figure's left edge, the legend
    // right-aligned over the plot
    const legend: PanelOut["legend"] = [];
    const bandY = a.y0 - BAND / 2 - 1;
    const legendY = twoRows[i] ? bandY - BAND : bandY;
    if (p.tag) addText({ text: p.tag, role: "tag", px: FONT.tag, x: PAD, y: bandY, align: "left" }, measure(p.tag, FONT.tag), FONT.tag);
    let lx = x1;
    // the live value at the band's right end, then the legend left of it
    if (p.live) {
      const tw = measure(p.live, FONT.value, true);
      addText({ text: p.live, role: "value", px: FONT.value, x: lx, y: legendY, align: "right" }, tw, FONT.value);
      lx -= tw + 12;
    }
    for (const s of [...p.series].reverse()) {
      if (!s.label) continue;
      const tw = richWidth(measure, s.label, FONT.legend);
      addText({ text: s.label, role: "legend", px: FONT.legend, x: lx, y: legendY, align: "right" }, tw, FONT.legend);
      lx -= tw + 4 + 14;
      legend.push({ slot: s.slot, dash: !!s.dash, kind: s.kind ?? "line", x: lx, y: legendY });
      lx -= 12;
    }

    // the y title: rotated and centered on the panel, or level in the band
    // over the axis (see `level`); the short form when the full one does not
    // fit the panel's height, or the band's width left of the legend
    const full = titleWithPower(p.y.title, a.power);
    const short = p.y.short ? titleWithPower(p.y.short, a.power) : full;
    const room = level ? (twoRows[i] ? x1 : lx) - x0 - 4 : a.y1 - a.y0 + 4;
    const yTitle = richWidth(measure, full, FONT.title) <= room ? full : short;
    if (level) {
      addText({ text: yTitle, role: "title", px: FONT.title, x: x0, y: bandY, align: "left" }, richWidth(measure, yTitle, FONT.title), FONT.title);
    } else {
      addText({ text: yTitle, role: "title", px: FONT.title, x: PAD + FONT.title / 2, y: (a.y0 + a.y1) / 2, align: "center", rotate: true },
        richWidth(measure, yTitle, FONT.title), FONT.title);
    }

    const series: PathOut[] = p.series.map(s => {
      const paths: number[][] = [];
      let cur: number[] = [];
      for (let k = 0; k < s.xs.length; k++) {
        const xv = s.xs[k], yv = s.ys[k];
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) { if (cur.length) paths.push(cur); cur = []; continue; }
        cur.push(X(xv), Y(yv));
      }
      if (cur.length) paths.push(cur);
      return { key: s.key, slot: s.slot, kind: s.kind ?? "line", dash: !!s.dash, label: s.label, paths };
    });
    const bars = (p.bars ? p.bars.counts.map((c, k) => ({
      // a 2 px gap between neighbours: 1 px off each edge
      box: { x0: X(p.bars!.edges[k]) + 1, x1: X(p.bars!.edges[k + 1]) - 1, y0: Y(c), y1: Y(Math.max(a.lo, 0)) },
      slot: p.bars!.slot,
    })) : []).filter(b => b.box.y1 - b.box.y0 > 0);

    // Reference lines and landmarks, then their labels. A label goes to the
    // first of its candidate spots that stays in the panel, clear of every
    // label placed so far AND of the data: no segment of any series path, no
    // other reference line, no landmark's dot may cross it (a liquidus label
    // at the right end sat exactly where the latest sample of a cell near
    // its liquidus is drawn, and the trace ran through it). Where no spot is
    // clear of the data the label keeps the first spot clear of the other
    // labels and is drawn on a backing (`knock`), never under a trace.
    const refs: PanelOut["refs"] = [];
    const refSegs: { r: RefSpec; seg: number[] }[] = [];
    for (const r of p.refs ?? []) {
      if (r.y != null && Number.isFinite(r.y) && r.y >= a.lo && r.y <= a.hi) {
        const y = Y(r.y);
        refs.push({ x0, y0: y, x1, y1: y, slot: r.slot });
        refSegs.push({ r, seg: [x0, y, x1, y] });
      } else if (r.x != null && Number.isFinite(r.x) && r.x >= fig.x.lo && r.x <= fig.x.hi) {
        const x = X(r.x);
        refs.push({ x0: x, y0: a.y0, x1: x, y1: a.y1, slot: r.slot });
        refSegs.push({ r, seg: [x, a.y0, x, a.y1] });
      }
    }
    const marks: PanelOut["marks"] = [];
    for (const m of p.marks ?? []) if (Number.isFinite(m.x) && Number.isFinite(m.y)) marks.push({ x: X(m.x), y: Y(m.y) });
    const dotBoxes = marks.map(m => ({ x0: m.x - 3.5, y0: m.y - 3.5, x1: m.x + 3.5, y1: m.y + 3.5 }));
    const place = (text: string, spots: [number, number, TextItem["align"]][], own: number[] | null) => {
      const tw = richWidth(measure, text, FONT.label), th = FONT.label;
      const segs = refSegs.map(q => q.seg).filter(s => s !== own);
      const fits = ([sx, sy, al]: [number, number, TextItem["align"]]) => {
        const b = boxAt(sx, sy, tw, th, al);
        return inside(b, rect) && !placed.some(q => overlaps(b, q, 1));
      };
      const clean = spots.find(s => fits(s) && !boxMeetsData(boxAt(s[0], s[1], tw, th, s[2]), series, segs, dotBoxes));
      const pick = clean ?? spots.find(fits) ?? spots.find(([sx, sy, al]) => inside(boxAt(sx, sy, tw, th, al), rect)) ?? spots[0];
      const knock = !clean && boxMeetsData(boxAt(pick[0], pick[1], tw, th, pick[2]), series, segs, dotBoxes);
      placed.push(addText({ text, role: "label", px: FONT.label, x: pick[0], y: pick[1], align: pick[2], ...(knock ? { knock } : {}) }, tw, th).box);
    };
    // horizontal lines' labels first, so a vertical line's can step around
    // theirs: at the right end, then the left, then along the line, above
    // it or below it
    const th = FONT.label;
    for (const { r, seg } of [...refSegs].sort((q, s) => Number(q.r.y == null) - Number(s.r.y == null))) {
      if (!r.label) continue;
      if (r.y != null) {
        const y = seg[1], up = y - 3 - th / 2, dn = y + 3 + th / 2;
        const xs: [number, TextItem["align"]][] = [[x1 - 2, "right"], [x0 + 3, "left"],
          [x0 + (x1 - x0) * 0.75, "center"], [x0 + (x1 - x0) * 0.5, "center"], [x0 + (x1 - x0) * 0.25, "center"]];
        place(r.label, xs.flatMap(([sx, al]) => [[sx, up, al], [sx, dn, al]] as [number, number, TextItem["align"]][]), seg);
      } else {
        // beside the line at the panel's top, its bottom or its middle, on
        // either side
        const x = seg[0];
        const top = a.y0 + th / 2 + 1, bot = a.y1 - th / 2 - 2, mid = (a.y0 + a.y1) / 2;
        place(r.label, [[x + 3, top, "left"], [x - 3, top, "right"], [x + 3, bot, "left"], [x - 3, bot, "right"],
          [x + 3, mid, "left"], [x - 3, mid, "right"]], seg);
      }
    }
    // labelled marks: around the dot, nearest first
    (p.marks ?? []).filter(m => Number.isFinite(m.x) && Number.isFinite(m.y)).forEach((m, k) => {
      const { x: mx, y: my } = marks[k];
      const spots: [number, number, TextItem["align"]][] = [];
      for (const d of [4, 14, 26]) {
        spots.push([mx + 5, my - d - th / 2, "left"], [mx + 5, my + d + th / 2, "left"],
          [mx - 5, my - d - th / 2, "right"], [mx - 5, my + d + th / 2, "right"]);
      }
      spots.push([mx + 7, my, "left"], [mx - 7, my, "right"]);
      place(m.label, spots, null);
    });

    panels.push({ rect, y: { lo: a.lo, hi: a.hi, ticks: a.ticks, power: a.power, title: yTitle }, series, refs, marks, bars, legend });
  });

  // -- the shared x axis: labels and title under the bottom panel
  const yb = panels[panels.length - 1].rect.y1;
  for (const t of xt.ticks) {
    const tw = measure(t.label, FONT.tick);
    addText({ text: t.label, role: "tick", px: FONT.tick, x: t.px, y: yb + TICK + 3 + FONT.tick / 2, align: "center" }, tw, FONT.tick);
  }
  const xFull = titleWithPower(fig.x.title, xt.power);
  const xShort = fig.x.short ? titleWithPower(fig.x.short, xt.power) : xFull;
  const xTitle = richWidth(measure, xFull, FONT.title) <= x1 - x0 ? xFull : xShort;
  addText({ text: xTitle, role: "title", px: FONT.title, x: (x0 + x1) / 2, y: h - PAD - FONT.title / 2, align: "center" },
    richWidth(measure, xTitle, FONT.title), FONT.title);

  return { w, h, x: { lo: fig.x.lo, hi: fig.x.hi, ticks: xt.ticks, power: xt.power, title: xTitle }, panels, texts, lines, empty: null };
}

/**
 * The size of a figure in its enlarged view (plot/modal.ts) for a window of
 * `vw` x `vh`: up to 880 px wide, taller per stacked panel, and leaving room
 * in the card for the exports and the data table. Here, not in the modal, so
 * the gate lays each figure out at the sizes it is really shown at.
 */
export function modalPlotSize(fig: FigSpec, vw: number, vh: number): [number, number] {
  const wide = Math.max(280, Math.min(880, Math.round(vw * 0.86) - 40));
  const wsum = fig.panels.reduce((a, p) => a + (p.weight ?? 1), 0) || 1;
  const tall = Math.max(220, Math.min(Math.round(vh * (wsum > 2 ? 0.55 : 0.46)), 120 + 150 * wsum, modalPlotRoom(vh)));
  return [wide, tall];
}

/**
 * The enlarged view's card around its plot, CSS px: the header row, the
 * export bar and the 220 px data table with their gaps and paddings, 359
 * measured (a 270 px plot made a 629 px card). The card stops at the window
 * less its 16 px edges (tokens.css .tmodal__card max-height), so a plot
 * taller than what is left made the card scroll and put the table under the
 * fold at 1024x768 (a scroll inside a scroll).
 */
export const MODAL_CHROME = 360;
/** the tallest plot the enlarged view's card holds without scrolling */
export const modalPlotRoom = (vh: number): number => vh - 2 * 16 - MODAL_CHROME;

/** a print figure's size: a journal's single-column width, taller per panel */
export function printSize(fig: FigSpec): [number, number] {
  const wsum = fig.panels.reduce((a, p) => a + (p.weight ?? 1), 0) || 1;
  return [640, Math.round(Math.min(900, 120 + 170 * wsum))];
}

/** data -> px on a laid-out panel (the gate re-derives a point with it) */
export function toPx(L: Layout, panel: number, x: number, y: number): [number, number] {
  const p = L.panels[panel];
  return [lerp(x, L.x.lo, L.x.hi, p.rect.x0, p.rect.x1), lerp(y, p.y.lo, p.y.hi, p.rect.y1, p.rect.y0)];
}
/** px -> data: the hover readout's inverse of toPx */
export function fromPx(L: Layout, panel: number, px: number, py: number): [number, number] {
  const p = L.panels[panel];
  return [lerp(px, p.rect.x0, p.rect.x1, L.x.lo, L.x.hi), lerp(py, p.rect.y1, p.rect.y0, p.y.lo, p.y.hi)];
}

// ------------------------------------------------------------- sparklines

export interface Spark {
  /** polylines in px, split at gaps */
  paths: number[][];
  /** the last finite point, px (null: none) */
  last: [number, number] | null;
  /** the baseline (y = 0) in px when 0 is inside the range */
  base: number | null;
}

/**
 * A HUD sparkline: no axes (an axis-less sparkline is legitimate at glance
 * size; its card prints the value, the range and the unit in type). x is sim
 * time, so a pause is a gap in time, not a flat line; y spans [lo, hi].
 */
export function layoutSpark(xs: number[], ys: number[], lo: number, hi: number, w: number, h: number, inset = 2): Spark {
  let xlo = Infinity, xhi = -Infinity;
  for (const x of xs) if (Number.isFinite(x)) { xlo = Math.min(xlo, x); xhi = Math.max(xhi, x); }
  const paths: number[][] = [];
  let cur: number[] = [];
  let last: [number, number] | null = null;
  const X = (x: number) => xhi > xlo ? lerp(x, xlo, xhi, inset, w - inset) : w - inset;
  const Y = (y: number) => lerp(y, lo, hi, h - inset, inset);
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) { if (cur.length) paths.push(cur); cur = []; continue; }
    const px = X(xs[i]), py = Y(ys[i]);
    cur.push(px, py);
    last = [px, py];
  }
  if (cur.length) paths.push(cur);
  return { paths, last, base: lo <= 0 && hi >= 0 ? Y(0) : null };
}

/** histogram bins with round edges: about `target` bins over [min, max] */
export function bins(values: number[], target = 12): { edges: number[]; counts: number[] } {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { edges: [], counts: [] };
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi === lo) { lo -= 0.5; hi += 0.5; }
  const st = Math.abs(tickStep(lo, hi, target)) || 1;
  const e0 = Math.floor(lo / st + 1e-9) * st;
  let e1 = Math.ceil(hi / st - 1e-9) * st;
  if (e1 <= e0) e1 = e0 + st;
  // a value exactly on the top edge falls in the last bin (the clamp below)
  const nB = Math.max(1, Math.round((e1 - e0) / st));
  const d = decimalsFor(st) + 2;
  const edges = Array.from({ length: nB + 1 }, (_, i) => Number((e0 + i * st).toFixed(d)));
  const counts = new Array<number>(nB).fill(0);
  for (const x of v) counts[Math.min(nB - 1, Math.max(0, Math.floor((x - e0) / st + 1e-9)))]++;
  return { edges, counts };
}
