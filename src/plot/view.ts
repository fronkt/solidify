// A plot on the page (U2): a wrapper div holding the figure's canvas and a
// second canvas over it for the hover crosshair, so a pointer move repaints
// only the overlay. Both canvases are backed at the device pixel ratio and
// re-laid-out when the wrapper changes size. The wrapper, not a canvas, is
// what joins the page, so the screenshot gates' `hideChrome` (which hides
// every non-canvas child of #app) still hides a plot (charts-audit 7).
//
// A view that can open its full figure is a button: a click, Enter or Space
// calls `onOpen`. Its text is drawn, not written into the DOM, so a report
// that hosts it keeps the text its gates read (#foundryResultsBody).
import { layoutFigure, fromPx, type FigSpec, type Layout, type Measure } from "./layout";
import { paint, paintPolar, canvasMeasure, drawReadout, type ReadoutLine } from "./paint";
import { layoutPolar, polarHit, isPolar, type PolarSpec, type PolarLayout } from "./polar";
import { screenTheme, type Theme } from "./theme";
import { fmtValue } from "./ticks";

/** a figure of either family: XY (layout.ts) or polar (polar.ts) */
export type AnySpec = FigSpec | PolarSpec;
export type AnyLayout = Layout | PolarLayout;

export function layoutAny(f: AnySpec, w: number, h: number, m: Measure): AnyLayout {
  return isPolar(f) ? layoutPolar(f, w, h, m) : layoutFigure(f, w, h, m);
}
export function paintAny(ctx: CanvasRenderingContext2D, L: AnyLayout, th: Theme, scale: number): void {
  if ("polar" in L) paintPolar(ctx, L, th, scale);
  else paint(ctx, L, th, scale);
}

export interface PlotViewOpts {
  /** the id of the figure's canvas (the lab keeps #foundryCurve) */
  id?: string;
  /** the accessible name */
  label: string;
  /** open the full figure; absent: the view is an image */
  onOpen?: () => void;
}

/** nearest index to `x` among `xs` whose y is finite (xs ascending, or not) */
export function nearest(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (!n) return -1;
  let i: number;
  if (xs[0] <= xs[n - 1]) {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m; else hi = m; }
    i = Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
  } else {
    i = 0;
    for (let k = 1; k < n; k++) if (Math.abs(xs[k] - x) < Math.abs(xs[i] - x)) i = k;
  }
  if (Number.isFinite(ys[i]) && Number.isFinite(xs[i])) return i;
  // a gap: the closest finite sample on either side
  for (let d = 1; d < n; d++) {
    for (const k of [i - d, i + d]) if (k >= 0 && k < n && Number.isFinite(ys[k]) && Number.isFinite(xs[k])) return k;
  }
  return -1;
}

const unitOf = (u?: string) => (u && u !== "dimensionless" ? ` ${u}` : "");

/**
 * The sample a readout may report at `x`: the nearest finite one, but only
 * where the series is actually drawn. Off either end of it, or across a gap,
 * there is no sample to report: the zero-curve f_s before the liquidus and
 * the HUD's ΔT before the first nucleus say nothing there, rather than a value
 * from elsewhere in the run. (Only for a series in time order; a scatter
 * reports its nearest point.)
 */
export function sampleAt(xs: number[], ys: number[], x: number): number {
  const i = nearest(xs, ys, x);
  if (i < 0 || xs[i] === x || !(xs[0] <= xs[xs.length - 1])) return i;
  const j = i + (x > xs[i] ? 1 : -1);
  if (j < 0 || j >= xs.length || !Number.isFinite(xs[j]) || !Number.isFinite(ys[j])) return -1;
  return i;
}

export class PlotView {
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private over: HTMLCanvasElement;
  private fig: AnySpec | null = null;
  private L: AnyLayout | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  private hover: [number, number] | null = null;

  constructor(parent: HTMLElement, opts: PlotViewOpts) {
    const root = document.createElement("div");
    root.className = "plot";
    if (opts.onOpen) {
      root.tabIndex = 0;
      root.setAttribute("role", "button");
      root.classList.add("plot--open");
    } else root.setAttribute("role", "img");
    root.setAttribute("aria-label", opts.label);
    const base = document.createElement("canvas");
    if (opts.id) base.id = opts.id;
    const over = document.createElement("canvas");
    over.className = "plot__over";
    root.append(base, over);
    parent.append(root);
    this.root = root;
    this.canvas = base;
    this.over = over;
    const at = (e: PointerEvent): [number, number] => {
      const r = root.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    root.addEventListener("pointermove", e => { this.hover = at(e); this.drawHover(); });
    root.addEventListener("pointerdown", e => { this.hover = at(e); this.drawHover(); });
    root.addEventListener("pointerleave", () => { this.hover = null; this.drawHover(); });
    if (opts.onOpen) {
      root.addEventListener("click", () => opts.onOpen!());
      root.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); opts.onOpen!(); }
      });
    }
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(root);
    // a device-ratio change (a zoom, another monitor) re-backs the canvases:
    // the ResizeObserver does not see it, the CSS size being the same
    // (kept on the view: an unreferenced MediaQueryList may be collected
    // with its listener. drawHover re-backs as well, for a change no media
    // query reports: CDP's device-metrics emulation fires none)
    const watchDpr = () => {
      if (this.dead) return;
      this.mq = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
      this.mq.addEventListener("change", () => { this.schedule(); watchDpr(); }, { once: true });
    };
    watchDpr();
  }
  private dead = false;
  private mq: MediaQueryList | null = null;

  /** a new figure (coalesced to one paint per frame) */
  set(fig: AnySpec): void { this.fig = fig; this.schedule(); }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  /** lay out and paint now, at the wrapper's size and the device's ratio */
  render(): void {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!this.fig || w < 2 || h < 2) return;
    const dpr = devicePixelRatio || 1;
    for (const c of [this.canvas, this.over]) {
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      if (c.width !== bw) c.width = bw;
      if (c.height !== bh) c.height = bh;
    }
    const th = screenTheme();
    const ctx = this.canvas.getContext("2d")!;
    this.L = layoutAny(this.fig, w, h, canvasMeasure(ctx, th));
    paintAny(ctx, this.L, th, dpr);
    this.drawHover();
  }

  /** the layout last painted (for a gate or a screenshot's check) */
  get layout(): AnyLayout | null { return this.L; }

  private drawHover(): void {
    const dpr = devicePixelRatio || 1;
    // a zoom or a move to another monitor changes the ratio without firing
    // the ResizeObserver (the CSS size is the same): a static figure (the
    // lab report's, after its run) would draw its crosshair scaled off the
    // pointer over a blurry base. Re-back and repaint first (render ends by
    // calling here again, with the backing right)
    if (this.fig && this.over.width !== Math.round(this.root.clientWidth * dpr)) { this.render(); return; }
    const ctx = this.over.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.over.width / dpr, this.over.height / dpr);
    const L0 = this.L, fig0 = this.fig;
    if (!this.hover || !L0 || !fig0 || L0.empty) return;
    if ("polar" in L0 && isPolar(fig0)) {
      // a wedge's angle range and value, or the pole under the pointer
      const [px, py] = this.hover;
      const hit = polarHit(fig0, L0, px, py);
      if (!hit) return;
      const th = screenTheme();
      if (hit.pole) {
        const [x, y, r] = hit.pole;
        ctx.strokeStyle = th.readoutValue;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
      }
      const lines: ReadoutLine[] = hit.rows.map(([label, value], i) =>
        ({ slot: (hit.pole ? i === 0 : i === hit.rows.length - 1) ? L0.slot : null, label, value }));
      drawReadout(ctx, lines, px, py, L0.w, L0.h, th);
      return;
    }
    if ("polar" in L0 || isPolar(fig0) || !L0.panels.length) return;
    const L = L0, fig = fig0;
    const [px, py] = this.hover;
    const r0 = L.panels[0].rect;
    if (px < r0.x0 || px > r0.x1 || py < r0.y0 - 16 || py > L.panels[L.panels.length - 1].rect.y1) return;
    const th = screenTheme();
    const xData = fromPx(L, 0, px, 0)[0];
    // snap to the first series' nearest sample, so the x printed is a real one
    let xSnap = xData;
    const first = fig.panels.flatMap(p => p.series).find(s => s.xs.length);
    if (first) { const i = nearest(first.xs, first.ys, xData); if (i >= 0) xSnap = first.xs[i]; }
    const lines: ReadoutLine[] = [];
    const dots: [number, number, 0 | 1 | 2 | 3][] = [];
    const sx = L.panels[0].rect.x0 + ((xSnap - L.x.lo) / (L.x.hi - L.x.lo || 1)) * (r0.x1 - r0.x0);
    let barLine: ReadoutLine[] = [];
    fig.panels.forEach((p, pi) => {
      const po = L.panels[pi];
      for (const s of p.series) {
        const i = sampleAt(s.xs, s.ys, xSnap);
        if (i < 0) continue;
        const y = s.ys[i];
        lines.push({ slot: s.slot, label: s.sym ?? s.key, value: fmtValue(y, 4) + unitOf(s.unit) });
        const yy = po.rect.y1 - ((y - po.y.lo) / (po.y.hi - po.y.lo || 1)) * (po.rect.y1 - po.rect.y0);
        const xx = po.rect.x0 + ((s.xs[i] - L.x.lo) / (L.x.hi - L.x.lo || 1)) * (po.rect.x1 - po.rect.x0);
        if (yy >= po.rect.y0 - 1 && yy <= po.rect.y1 + 1) dots.push([xx, yy, s.slot]);
      }
      if (p.bars) {
        const e = p.bars.edges;
        for (let k = 0; k + 1 < e.length; k++) {
          if (xData >= e[k] && xData <= e[k + 1]) {
            barLine = [
              { slot: null, label: fig.x.sym ?? "x", value: `${fmtValue(e[k], 3)}–${fmtValue(e[k + 1], 3)}${unitOf(fig.x.unit)}` },
              { slot: p.bars.slot, label: p.y.sym ?? "N", value: `${p.bars.counts[k]}${unitOf(p.y.unit)}` },
            ];
          }
        }
      }
    });
    if (barLine.length) {
      drawReadout(ctx, barLine, px, py, L.w, L.h, th);
      return;
    }
    if (!lines.length) return;
    // the crosshair through every panel, a ringed dot on each series
    ctx.strokeStyle = th.axis;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    const cx = Math.round(sx * dpr) / dpr + 0.5 / dpr;
    for (const p of L.panels) { ctx.beginPath(); ctx.moveTo(cx, p.rect.y0); ctx.lineTo(cx, p.rect.y1); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const [x, y, slot] of dots) {
      ctx.fillStyle = th.readoutBg;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = th.data[slot];
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    lines.unshift({ slot: null, label: fig.x.sym ?? "x", value: fmtValue(xSnap, 4) + unitOf(fig.x.unit) });
    drawReadout(ctx, lines, sx, py, L.w, L.h, th);
  }

  destroy(): void {
    this.dead = true;
    this.ro.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.root.remove();
  }
}
