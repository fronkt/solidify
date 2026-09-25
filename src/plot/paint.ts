// The canvas painter (U2): strokes and fills what layout.ts computed, in the
// theme's colors, at any scale (the device pixel ratio on screen, 2 or 3 for
// an exported PNG). No geometry is decided here beyond snapping 1 px lines to
// the device grid so axes stay crisp.
import { runs, SUB, type Layout, type Measure, type TextItem } from "./layout";
import type { PolarLayout } from "./polar";
import type { Theme } from "./theme";

const font = (px: number, family: string) => `400 ${px}px ${family}`;

/** the background ring around each pole (outside its radius, so the
 *  smallest dot keeps its color): what separates two overlapping poles */
export const POLE_RING = 0.75;
/** the rose's wedge fill alpha. Opaque: at 0.78 slot 2 over the overlay's
 *  worst case came to 2.98:1 and the print slot 2 to 2.49:1, under the 3:1 a
 *  data mark needs (the palette is validated opaque); the wedges are told
 *  apart by their 6 % gap, not by transparency. PLOT-CONTRAST composites it
 *  on every surface a figure sits on */
export const WEDGE_ALPHA = 1;

/** a Measure backed by the browser's own text metrics */
export function canvasMeasure(ctx: CanvasRenderingContext2D, th: Theme): Measure {
  return (text, px, mono = false) => {
    ctx.font = font(px, mono ? th.mono : th.font);
    return ctx.measureText(text).width;
  };
}

/**
 * Draw figure markup at (x, y), its middle line on y: plain runs at `px`,
 * `_{...}` runs smaller and lowered. `rotate` runs it bottom to top, centered
 * on (x, y), the way a y-axis title reads.
 */
export function drawRich(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, family: string,
  align: TextItem["align"], color: string, rotate = false): void {
  const rs = runs(text);
  const widths = rs.map(r => { ctx.font = font(r.sub ? px * SUB : px, family); return ctx.measureText(r.text).width; });
  const total = widths.reduce((a, b) => a + b, 0);
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let cx: number;
  if (rotate) {
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    cx = -total / 2;
    y = 0;
  } else {
    cx = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  }
  rs.forEach((r, i) => {
    ctx.font = font(r.sub ? px * SUB : px, family);
    ctx.fillText(r.text, cx, r.sub ? y + px * 0.26 : y);
    cx += widths[i];
  });
  ctx.restore();
}

/** stroke a polyline given as flat [x0, y0, x1, y1, ...] */
function poly(ctx: CanvasRenderingContext2D, p: number[]): void {
  ctx.beginPath();
  for (let i = 0; i < p.length; i += 2) (i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]));
  ctx.stroke();
}

/**
 * Paint a laid-out figure. The context is reset to `scale` (CSS px -> device
 * px), cleared, and filled with the theme's background when it has one.
 */
export function paint(ctx: CanvasRenderingContext2D, L: Layout, th: Theme, scale: number): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, L.w, L.h);
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, L.w, L.h); }
  const lw = (css: number) => Math.max(1, Math.round(css * th.weight * scale)) / scale;
  // a 1 px line on the device grid: odd device widths sit on half pixels
  const snap = (v: number, w: number) => { const dw = Math.round(w * scale); const off = (dw % 2) / 2; return (Math.round(v * scale - off) + off) / scale; };
  if (L.empty) {
    for (const t of L.texts) drawRich(ctx, t.text, t.x, t.y, t.px, th.font, t.align, th.tick);
    return;
  }
  for (const p of L.panels) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.rect.x0, p.rect.y0 - 1, p.rect.x1 - p.rect.x0 + 1, p.rect.y1 - p.rect.y0 + 2);
    ctx.clip();
    // reference lines first: chrome, dashed, under the data; an event on the
    // data (a ref with a slot) is a solid line in its data color
    ctx.lineWidth = lw(1);
    for (const r of p.refs) {
      const w = lw(1);
      ctx.strokeStyle = r.slot != null ? th.data[r.slot] : th.ref;
      ctx.setLineDash(r.slot != null ? [] : [4, 3]);
      poly(ctx, r.y0 === r.y1 ? [r.x0, snap(r.y0, w), r.x1, snap(r.y1, w)] : [snap(r.x0, w), r.y0, snap(r.x1, w), r.y1]);
    }
    ctx.setLineDash([]);
    for (const b of p.bars) {
      ctx.fillStyle = th.data[b.slot];
      ctx.fillRect(b.box.x0, b.box.y0, Math.max(0.5, b.box.x1 - b.box.x0), b.box.y1 - b.box.y0);
    }
    for (const s of p.series) {
      ctx.strokeStyle = ctx.fillStyle = th.data[s.slot];
      ctx.lineWidth = lw(1.5);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(s.dash ? [5, 3] : []);
      for (const path of s.paths) {
        if (s.kind === "dots" || path.length === 2) {
          for (let i = 0; i < path.length; i += 2) { ctx.beginPath(); ctx.arc(path[i], path[i + 1], 2 * th.weight, 0, Math.PI * 2); ctx.fill(); }
        } else poly(ctx, path);
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
    // labelled landmarks: gray dots, the label says what each is
    ctx.fillStyle = th.mark;
    for (const m of p.marks) { ctx.beginPath(); ctx.arc(m.x, m.y, 3 * Math.min(th.weight, 1.3), 0, Math.PI * 2); ctx.fill(); }
    // legend swatches: a short line (or a dot) in the series' color
    for (const g of p.legend) {
      ctx.strokeStyle = ctx.fillStyle = th.data[g.slot];
      ctx.lineWidth = lw(2);
      ctx.setLineDash(g.dash ? [4, 2] : []);
      if (g.kind === "dots") { ctx.beginPath(); ctx.arc(g.x + 7, g.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
      else poly(ctx, [g.x, g.y, g.x + 14, g.y]);
      ctx.setLineDash([]);
    }
  }
  // axes and ticks
  ctx.strokeStyle = th.axis;
  const aw = lw(1);
  ctx.lineWidth = aw;
  ctx.lineCap = "butt";
  for (const [x0, y0, x1, y1] of L.lines) {
    poly(ctx, x0 === x1 ? [snap(x0, aw), y0, snap(x1, aw), y1] : [x0, snap(y0, aw), x1, snap(y1, aw)]);
  }
  for (const t of L.texts) {
    if (t.role === "value") { drawRich(ctx, t.text, t.x, t.y, t.px, th.mono, t.align, th.readoutValue); continue; }
    // a label layout.ts could not place clear of the data sits on a backing
    // in the figure's own background (the readout's), so no trace runs
    // through its letters
    if (t.knock) {
      ctx.fillStyle = th.readoutBg;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(t.box.x0 - 2, t.box.y0 - 1, t.box.x1 - t.box.x0 + 4, t.box.y1 - t.box.y0 + 2);
      ctx.globalAlpha = 1;
    }
    const color = t.role === "title" ? th.title : t.role === "label" ? th.markLabel : th.tick;
    drawRich(ctx, t.text, t.x, t.y, t.px, th.font, t.align, color, t.rotate);
  }
}

/**
 * Paint a laid-out polar figure (polar.ts): the rose's wedges or the poles in
 * the data slot, then the chrome over them, the dashed rings, the rim and its
 * ticks, the cross, and the labels.
 */
export function paintPolar(ctx: CanvasRenderingContext2D, L: PolarLayout, th: Theme, scale: number): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, L.w, L.h);
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, L.w, L.h); }
  const lw = (css: number) => Math.max(1, Math.round(css * th.weight * scale)) / scale;
  if (L.empty) {
    for (const t of L.texts) drawRich(ctx, t.text, t.x, t.y, t.px, th.font, t.align, th.tick);
    return;
  }
  const color = th.data[L.slot];
  ctx.fillStyle = color;
  ctx.globalAlpha = WEDGE_ALPHA;
  for (const q of L.wedges) {
    ctx.beginPath();
    ctx.moveTo(L.cx, L.cy);
    ctx.arc(L.cx, L.cy, q.r, q.t0, q.t1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // poles OPAQUE, each ringed in the background so overlapping dots stay
  // apart: a pole is the figure's only data, and at 0.6 alpha it sat at
  // 2.6:1 on --surface, under the 3:1 a data mark needs (the palette is
  // validated opaque)
  for (const p of L.points) {
    ctx.fillStyle = th.readoutBg;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + POLE_RING, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  // the radial scale's rings: chrome, dashed
  ctx.strokeStyle = th.ref;
  ctx.lineWidth = lw(1);
  ctx.setLineDash([3, 3]);
  for (const r of L.rings) { ctx.beginPath(); ctx.arc(L.cx, L.cy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
  // the rim, its ticks and the cross: the axis
  ctx.strokeStyle = th.axis;
  ctx.beginPath(); ctx.arc(L.cx, L.cy, L.R, 0, Math.PI * 2); ctx.stroke();
  for (const [x0, y0, x1, y1] of L.lines) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  for (const t of L.texts) {
    // a label inside the rim (a ring's value, the center's axis) sits on
    // the data: it gets the readout's backing so it reads over the wedges
    const mx = (t.box.x0 + t.box.x1) / 2, my = (t.box.y0 + t.box.y1) / 2;
    if (Math.hypot(mx - L.cx, my - L.cy) < L.R - 2) {
      ctx.fillStyle = th.readoutBg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(t.box.x0 - 2, t.box.y0 - 1, t.box.x1 - t.box.x0 + 4, t.box.y1 - t.box.y0 + 2);
      ctx.globalAlpha = 1;
    }
    drawRich(ctx, t.text, t.x, t.y, t.px, th.font, t.align, t.role === "label" ? th.markLabel : th.tick);
  }
}

export interface ReadoutLine {
  /** the series' slot: a swatch before the line; null for the x value */
  slot: 0 | 1 | 2 | 3 | null;
  label: string;
  value: string;
}

/**
 * The hover readout: a box of lines ("t  1.24 ms", "T  612 °C"), each
 * series' line led by its color's swatch, placed beside (px, py) and flipped
 * to stay inside `w` x `h`. Labels in the tick gray, values in the mono.
 */
export function drawReadout(ctx: CanvasRenderingContext2D, lines: ReadoutLine[], px: number, py: number,
  w: number, h: number, th: Theme): void {
  const PX = 11, LH = 16, PADX = 8, PADY = 6, SW = 12;
  const lab = lines.map(l => { ctx.font = font(PX, th.font); return runs(l.label).reduce((a, r) => { ctx.font = font(r.sub ? PX * SUB : PX, th.font); return a + ctx.measureText(r.text).width; }, 0); });
  const val = lines.map(l => { ctx.font = font(PX, th.mono); return ctx.measureText(l.value).width; });
  const labW = Math.max(...lab), valW = Math.max(...val);
  const bw = PADX * 2 + SW + labW + 10 + valW, bh = PADY * 2 + LH * lines.length;
  let bx = px + 14, by = py - bh - 10;
  if (bx + bw > w - 2) bx = px - 14 - bw;
  if (bx < 2) bx = 2;
  if (by < 2) by = Math.min(h - bh - 2, py + 14);
  ctx.fillStyle = th.readoutBg;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = th.readoutRule;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw) - 1, Math.round(bh) - 1);
  lines.forEach((l, i) => {
    const y = by + PADY + LH * i + LH / 2;
    if (l.slot != null) {
      ctx.strokeStyle = th.data[l.slot];
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx + PADX, y); ctx.lineTo(bx + PADX + SW - 3, y); ctx.stroke();
    }
    drawRich(ctx, l.label, bx + PADX + SW, y, PX, th.font, "left", th.readoutText);
    ctx.font = font(PX, th.mono);
    ctx.fillStyle = th.readoutValue;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText(l.value, bx + bw - PADX, y);
    ctx.textAlign = "left";
  });
}
