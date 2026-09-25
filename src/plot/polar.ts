// Polar figures (U2): the 2D growth-direction rose and the TRUE 3D pole
// figures. Like the XY figures (layout.ts) they are laid out by one pure
// function, data to pixels with no browser, and painted by a thin painter, so
// scripts/verify-plot.mjs checks their geometry in CI: every label on the
// canvas and clear of the others, the rings where their values say, and a
// pole re-derived from its own stereographic projection.
//
// Style (docs/DESIGN.md 5, plots): the rim and its ticks are the axis, in the
// chrome gray; the radial scale is a few labelled dashed rings; the angle
// labels sit outside the rim at the plot spec's 11 px; the data (the rose's
// wedges, the poles) take the palette's slot. What the radius means, the
// reference direction and the projection are named in a caption under the
// figure, never left to the reader.
import { approxMeasure, modalPlotRoom, FONT, type Box, type Measure, type TextItem } from "./layout";

/** one rose wedge: [a0, a1) degrees, its radius as a fraction of the rim,
 *  and the value it stands for (in the spec's valueUnit) */
export interface Wedge { a0: number; a1: number; rf: number; v: number }
/** one pole: stereographic (x, y) in the unit disc (y up), a size weight in
 *  [0, 1], and what the readout prints for it */
export interface PolePoint { x: number; y: number; w: number; rows: [string, string][] }

export interface PolarSpec {
  polar: true;
  /** "cw": angles grow clockwise on screen from +x (a micrograph, whose y
   *  axis points down); "ccw": the math convention (a pole figure, Y up) */
  sense: "cw" | "ccw";
  wedges: Wedge[];
  points: PolePoint[];
  /** the radial scale: dashed rings at a fraction of the rim, labelled */
  rings: { rf: number; label: string }[];
  /** labelled ticks around the rim, degrees */
  angles: { deg: number; label: string }[];
  /** the X and Y axes drawn through the center (a pole figure) */
  cross: boolean;
  /** a label at the center (a pole figure's out-of-plane axis) */
  center?: string;
  /** under the figure: what the radius means, the reference direction, the
   *  projection; one line each */
  caption: string[];
  slot: 0 | 1 | 2 | 3;
  empty?: string | null;
  /** the hover readout of a wedge: the angle's symbol, the value's symbol
   *  and unit */
  angleSym: string;
  valueSym: string;
  valueUnit: string;
}

export const isPolar = (f: unknown): f is PolarSpec => !!f && (f as PolarSpec).polar === true;

export interface PolarLayout {
  polar: true;
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** the rim's radius, px */
  R: number;
  /** the dashed rings' radii, px */
  rings: number[];
  /** rim ticks and the cross, px segments [x0, y0, x1, y1] */
  lines: number[][];
  /** wedges in canvas angles (radians, clockwise from +x on screen) */
  wedges: { t0: number; t1: number; r: number }[];
  points: { x: number; y: number; r: number }[];
  texts: TextItem[];
  slot: 0 | 1 | 2 | 3;
  empty: string | null;
}

const PAD = 6, TICK = 4, GAP = 4, LINE = 14;

/** degrees on the figure -> the canvas angle (radians, clockwise on screen) */
export const canvasAngle = (deg: number, sense: "cw" | "ccw"): number => ((sense === "cw" ? deg : -deg) * Math.PI) / 180;

const boxOf = (cx: number, cy: number, w: number, h: number): Box => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
const meets = (a: Box, b: Box, m = 0): boolean => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;

/** a pole's marker radius, px, for a rim of radius R: proportional to its
 *  weight (the grain's diameter over the largest's), 3.5 px at most on the
 *  column's figure, a little more on a larger rim (not in proportion: a
 *  figure of hundreds of poles must stay a scatter, not a blot), 0.9 px at
 *  least so the smallest grain still shows */
export const poleRadius = (w: number, R: number): number =>
  Math.max(0.9, 3.5 * Math.max(0, Math.min(1, w)) * Math.pow(Math.max(1, R / 85), 0.4));

/**
 * Lay a polar figure out at `w` x `h` CSS px: the rim as large as the angle
 * labels around it and the caption under it allow, centered.
 */
export function layoutPolar(spec: PolarSpec, w: number, h: number, measure: Measure = approxMeasure): PolarLayout {
  const texts: TextItem[] = [];
  const add = (t: Omit<TextItem, "box">, tw: number, th: number): TextItem => {
    const item = { ...t, box: boxOf(t.align === "left" ? t.x + tw / 2 : t.align === "right" ? t.x - tw / 2 : t.x, t.y, tw, th) };
    texts.push(item);
    return item;
  };
  const base: PolarLayout = { polar: true, w, h, cx: w / 2, cy: h / 2, R: 0, rings: [], lines: [], wedges: [], points: [], texts, slot: spec.slot, empty: null };
  const empty = spec.empty ?? (spec.wedges.some(q => q.v > 0) || spec.points.length ? null : "no data yet");
  if (empty) {
    add({ text: empty, role: "empty", px: FONT.empty, x: w / 2, y: h / 2, align: "center" }, measure(empty, FONT.empty), FONT.empty);
    return { ...base, empty };
  }
  // a caption line too wide for the canvas breaks at its " · " separators
  const caption: string[] = [];
  for (const c of spec.caption) {
    let cur = "";
    for (const part of c.split(" · ")) {
      const next = cur ? `${cur} · ${part}` : part;
      if (cur && measure(next, FONT.legend) > w - 2 * PAD) { caption.push(cur); cur = part; } else cur = next;
    }
    if (cur) caption.push(cur);
  }
  const capH = caption.length * LINE;
  const labW = Math.max(0, ...spec.angles.map(a => measure(a.label, FONT.tick)));
  const labH = FONT.tick;
  const R = Math.max(12, Math.min(
    (w - 2 * PAD - 2 * (TICK + GAP + labW)) / 2,
    (h - 2 * PAD - capH - 4 - 2 * (TICK + GAP + labH)) / 2,
  ));
  const cx = w / 2;
  const cy = PAD + TICK + GAP + labH + R;
  const at = (deg: number, r: number): [number, number] => {
    const t = canvasAngle(deg, spec.sense);
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  };
  const lines: number[][] = [];
  // the rim's ticks, outward, at every labelled angle; each label just past
  // its tick, its box's near edge on the tick's line
  for (const a of spec.angles) {
    const [x0, y0] = at(a.deg, R), [x1, y1] = at(a.deg, R + TICK);
    lines.push([x0, y0, x1, y1]);
    const t = canvasAngle(a.deg, spec.sense);
    const tw = measure(a.label, FONT.tick);
    const [ax, ay] = at(a.deg, R + TICK + GAP);
    add({ text: a.label, role: "tick", px: FONT.tick, x: ax + (Math.cos(t) * tw) / 2, y: ay + (Math.sin(t) * labH) / 2, align: "center" }, tw, labH);
  }
  if (spec.cross) lines.push([cx - R, cy, cx + R, cy], [cx, cy - R, cx, cy + R]);
  // the rings, and their labels along one ray between two angle ticks: each
  // label just INSIDE its ring (its outer corner on it), so it never meets
  // the angle labels outside the rim. The gap nearest the upper right first;
  // the next gaps when a label there would meet another (rings close together)
  const rings = spec.rings.filter(q => q.rf > 0 && q.rf < 1 + 1e-9).map(q => q.rf * R);
  const ticksDeg = spec.angles.map(a => a.deg).sort((p, q) => p - q);
  const want = spec.sense === "cw" ? 308 : 52;
  const dist = (m: number) => Math.abs(((m - want + 540) % 360) - 180);
  const rays = ticksDeg.length >= 2
    ? ticksDeg.map((d, i) => (d + (i + 1 < ticksDeg.length ? ticksDeg[i + 1] : ticksDeg[0] + 360)) / 2 % 360).sort((p, q) => dist(p) - dist(q))
    : [want];
  // the center's label first, so the ring labels keep clear of it too
  if (spec.center) {
    const tw = measure(spec.center, FONT.tick);
    add({ text: spec.center, role: "tick", px: FONT.tick, x: cx + 5, y: cy - labH / 2 - 3, align: "left" }, tw, labH);
  }
  const placed0: Box[] = texts.map(t => t.box);
  const ringLabels = (ray: number) => spec.rings.filter(q => q.rf > 0).map(q => {
    const tw = measure(q.label, FONT.tick);
    const t = canvasAngle(ray, spec.sense);
    const back = Math.abs(Math.cos(t)) * tw / 2 + Math.abs(Math.sin(t)) * labH / 2 + 2;
    const [px, py] = at(ray, q.rf * R - back);
    return { it: { text: q.label, role: "tick" as const, px: FONT.tick, x: px, y: py, align: "center" as const }, tw, box: boxOf(px, py, tw, labH) };
  });
  // one ray for all when they fit there; otherwise each label takes the
  // first gap where it fits on its own
  const ok = (bx: Box, placed: Box[]) => bx.x0 >= 0 && bx.x1 <= w && bx.y0 >= 0 && !placed.some(p => meets(bx, p, 1));
  const fits = (ls: ReturnType<typeof ringLabels>) => ls.every((l, i) => ok(l.box, [...placed0, ...ls.slice(0, i).map(o => o.box)]));
  const perRay = rays.map(ringLabels);
  const together = perRay.find(fits);
  const placed = [...placed0];
  const n = perRay[0]?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const l = together ? together[i] : perRay.map(ls => ls[i]).find(c => ok(c.box, placed));
    if (!l || !ok(l.box, placed)) continue;
    placed.push(add(l.it, l.tw, labH).box);
  }
  caption.forEach((c, i) => {
    add({ text: c, role: "legend", px: FONT.legend, x: w / 2, y: h - PAD - capH + LINE / 2 + i * LINE, align: "center" }, measure(c, FONT.legend), FONT.legend);
  });
  // each wedge drawn 6 % short of its bin's far edge, so neighbours read as
  // bars (the readout still reports the whole bin)
  const wedges = spec.wedges.filter(q => q.rf * R >= 0.5).map(q => {
    const t0 = canvasAngle(q.a0, spec.sense), t1 = canvasAngle(q.a0 + (q.a1 - q.a0) * 0.94, spec.sense);
    return { t0: Math.min(t0, t1), t1: Math.max(t0, t1), r: q.rf * R };
  });
  const points = spec.points.map(p => ({
    x: cx + p.x * R,
    y: cy + (spec.sense === "cw" ? p.y : -p.y) * R,
    r: poleRadius(p.w, R),
  }));
  return { ...base, cx, cy, R, rings, lines, wedges, points };
}

/**
 * What the hover readout reports at (px, py): the wedge under the pointer
 * (its angle range and value) or the nearest pole within 10 px (its rows).
 */
export interface PolarHit {
  rows: [string, string][];
  /** the pole under the pointer (its center and radius, px), for a ring */
  pole: [number, number, number] | null;
}
export function polarHit(spec: PolarSpec, L: PolarLayout, px: number, py: number): PolarHit | null {
  if (L.empty) return null;
  if (spec.points.length) {
    let best = -1, bd = Infinity;
    L.points.forEach((p, i) => { const d = Math.hypot(p.x - px, p.y - py); if (d <= Math.max(10, p.r + 2) && d < bd) { best = i; bd = d; } });
    if (best < 0) return null;
    const p = L.points[best];
    return { rows: spec.points[best].rows, pole: [p.x, p.y, p.r] };
  }
  const dx = px - L.cx, dy = py - L.cy;
  if (Math.hypot(dx, dy) > L.R + 2) return null;
  let deg = (Math.atan2(spec.sense === "cw" ? dy : -dy, dx) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const w = spec.wedges.find(q => deg >= q.a0 && deg < q.a1);
  if (!w) return null;
  const f = (v: number) => Number(v.toFixed(2)).toString();
  return { rows: [[spec.angleSym, `${f(w.a0)}–${f(w.a1)}°`], [spec.valueSym, `${Number(w.v.toPrecision(3))} ${spec.valueUnit}`]], pole: null };
}

/** the enlarged view's size: a square plot in the modal's width */
export function polarModalSize(vw: number, vh: number): [number, number] {
  const wide = Math.max(280, Math.min(880, Math.round(vw * 0.86) - 40));
  // no taller than the card holds beside its header, exports and table
  // (layout.ts modalPlotRoom): at 1024x768 the card scrolled 68 px
  const tall = Math.max(260, Math.min(620, Math.round(vh * 0.58), modalPlotRoom(vh)));
  return [Math.min(wide, tall + 160), tall];
}
/** a print figure: square, a journal column wide */
export const polarPrintSize = (): [number, number] => [560, 600];
