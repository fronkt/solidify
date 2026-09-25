import type { StatsResult } from "./sim";
import type { StatsResult3D } from "./sim3d";
import type { Units } from "./units";
import { series as dataColor, seriesAlpha } from "./design/plot";
import { bridgeOf, type Bridge } from "./plot/quantity";
import { layoutSpark } from "./plot/layout";
import {
  hudSpark, hudFigure, histSpark, histFigure, hudDeltaT, chargeLiquidus, HudRecord,
  type HudKey, type HudSample, type Figure, type Chem,
} from "./plot/figures";
import { openFigure, type FigureHandle } from "./plot/modal";
import type { PlotMeta, Prov } from "./plot/csv";

/** what a figure's provenance names (plot/csv.ts; re-exported for the hosts) */
export type { PlotMeta };

export interface HudHost {
  /** the live unit bridge (main.ts unitsNow) */
  units(): Units;
  meta(): PlotMeta;
  /** the chemistry the solver runs now (main.ts chemNow): the ΔT card's
   *  liquidus (plot/figures.ts chargeLiquidus), latched with each series */
  chem(): Chem;
}

type CardKey = HudKey | "hist";

interface Card {
  key: CardKey;
  box: HTMLElement;
  name: HTMLElement;
  val: HTMLElement;
  range: HTMLElement;
  unit: HTMLElement;
  canvas: HTMLCanvasElement;
}

/** the glance plot's size, CSS px (app/index.html .spark) */
const SPARK_W = 150, SPARK_H = 24;

const TITLE: Record<CardKey, string> = {
  fs: "FRACTION SOLID", dt: "INTERFACE ΔT", grains: "GRAINS", pore: "POROSITY", hist: "GRAIN SIZE",
};
const NAME: Record<CardKey, string> = {
  fs: "fraction solid", dt: "interface undercooling", grains: "grain count", pore: "porosity", hist: "grain size",
};
/** the ΔT card's spoken name follows what it measures (plot/figures.ts dTOf) */
const nameOf = (k: CardKey, chem: Chem | null): string =>
  k === "dt" && chem?.alloy ? "interface temperature below the liquidus" : NAME[k];

/**
 * The HUD's four glance plots (2D and TRUE 3D), each on its own plate
 * (app/index.html .spark): the latest value, the plotted range and its unit
 * in type, the series as a sparkline against SIM TIME. Samples are recorded
 * only while sim time advances, so a pause records nothing (the strips used
 * to scroll flat lines through one). A card is a button: it opens the full
 * plot, with axes, the data table and the exports (plot/modal.ts).
 *
 * Every series starts with the unit bridge and the chemistry in force
 * (plot/quantity.ts, plot/figures.ts Chem); a change of either (a material
 * swap, the solute field, the latent-heat dial, the composition) starts a new
 * series, because one converted two ways, or measured against two liquidi, is
 * two series.
 */
export class Hud {
  private cards: Record<CardKey, Card>;
  /** the series since the melt started, kept while sim time advances
   *  (plot/figures.ts HudRecord: the rule the gate drives), with the bridge
   *  and the chemistry it started under */
  private rec = new HudRecord(1200);
  private diams: number[] = [];
  private mode3 = false;
  private modal: { key: CardKey; h: FigureHandle } | null = null;

  constructor(private root: HTMLElement, private host: HudHost) {
    this.cards = {
      fs: this.mkCard("fs"), dt: this.mkCard("dt"), grains: this.mkCard("grains"), hist: this.mkCard("hist"),
    } as Record<CardKey, Card>;
    // the 3D porosity strip shares the ΔT card's slot
    this.cards.pore = this.cards.dt;
    // nothing is recorded yet, and the host's units are not built until
    // main.ts has finished booting: the cards start empty
    for (const c of Object.values(this.cards)) { c.val.textContent = "—"; c.box.setAttribute("aria-label", `${NAME[c.key]}: open the full plot`); }
    // A folded HUD (app/index.html #hud: max-height 0 on a window too narrow
    // for one card) still has visible, focusable cards inside it: Tab landed
    // on four buttons nobody could see. `inert` takes them out of the tab
    // order and the accessibility tree while it is folded
    const fold = () => { this.root.inert = this.root.clientHeight < 1; };
    new ResizeObserver(fold).observe(this.root);
    fold();
  }

  private mkCard(key: CardKey): Card {
    const box = document.createElement("div");
    box.className = "spark plate";
    box.tabIndex = 0;
    box.setAttribute("role", "button");
    const head = document.createElement("div");
    head.className = "t";
    const name = document.createElement("span");
    name.className = "t__name";
    name.textContent = TITLE[key];
    const val = document.createElement("span");
    val.className = "t__val";
    head.append(name, val);
    // backed at the device's ratio on every draw (spark / histBars), so a
    // zoom or a move to another monitor never draws past the backing
    const c = document.createElement("canvas");
    c.style.width = `${SPARK_W}px`;
    c.style.height = `${SPARK_H}px`;
    const foot = document.createElement("div");
    foot.className = "r";
    const range = document.createElement("span");
    range.className = "r__range";
    const unit = document.createElement("span");
    unit.className = "r__unit";
    foot.append(range, unit);
    box.append(head, c, foot);
    this.root.append(box);
    const card: Card = { key, box, name, val, range, unit, canvas: c };
    const open = () => this.open(this.keyOf(card));
    box.addEventListener("click", open);
    box.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); open(); }
    });
    return card;
  }

  /** the ΔT card is porosity in TRUE 3D */
  private keyOf(c: Card): CardKey { return c.key === "dt" && this.mode3 ? "pore" : c.key; }

  /** relabel the ΔT strip for TRUE-3D (it carries porosity % there) */
  setMode3(on: boolean) {
    // an open full plot belongs to the dimension it was opened in
    if (on !== this.mode3) this.modal?.h.close();
    this.mode3 = on;
    this.cards.dt.name.textContent = on ? TITLE.pore : TITLE.dt;
    this.drawAll();
  }

  reset() {
    this.rec.clear();
    this.diams = [];
    this.drawAll();
  }

  /** a new sample, kept only if sim time moved on since the last one; the
   *  series latches the bridge and the chemistry it started under */
  private record(p: HudSample, chem: Chem) {
    this.rec.push(p, bridgeOf(this.host.units(), this.host.meta().material), chem);
  }

  private get samples(): HudSample[] { return this.rec.samples; }

  push(s: StatsResult, simTime: number) {
    const chem = this.host.chem();
    this.record({
      t: simTime, fs: s.fracSolid, grains: s.grainCount, pore: NaN,
      dt: hudDeltaT(s.interfaceCells, s.interfaceT, chargeLiquidus(chem)),
    }, chem);
    this.diams = s.diamsUm;
    this.drawAll();
  }

  /** TRUE-3D mode: fs, porosity %, grain count, eq-diameter histogram */
  push3(s: StatsResult3D, umPerVox: number, simTime: number) {
    this.record({ t: simTime, fs: s.fracSolid, grains: s.grainCount, pore: s.poreFrac * 100, dt: NaN }, this.host.chem());
    // resolution is passed in from the solver — units.ts owns the anchor
    this.diams = s.grains.map(g => Math.cbrt((6 * g.vox) / Math.PI) * umPerVox);
    this.drawAll();
  }

  /** the series' provenance: the run's identity and how many samples it took */
  private prov(): Prov {
    return { ...this.host.meta(), recorded: this.rec.recorded };
  }

  private bridgeNow(): Bridge {
    return this.rec.bridge ?? bridgeOf(this.host.units(), this.host.meta().material);
  }

  /** the full figure a card opens */
  figure(key: CardKey): Figure {
    const b = this.bridgeNow();
    // the histogram's rows are bins over one census, not samples: its
    // provenance carries no sample count (histFigure drops one regardless)
    return key === "hist"
      ? histFigure(this.diams, b, { ...this.host.meta() }, this.mode3)
      : hudFigure(key, this.samples, b, this.prov(), this.rec.chem);
  }

  private open(key: CardKey) {
    this.modal?.h.close();
    const h = openFigure(() => this.figure(key), () => { if (this.modal?.h === h) this.modal = null; });
    this.modal = { key, h };
  }

  private drawAll() {
    const b = this.bridgeNow();
    const chem = this.rec.chem;
    const keys: HudKey[] = ["fs", this.mode3 ? "pore" : "dt", "grains"];
    for (const k of keys) {
      const card = k === "pore" ? this.cards.dt : this.cards[k];
      const m = hudSpark(k, this.samples, b, chem);
      card.val.textContent = m.value;
      card.range.textContent = m.range;
      card.unit.textContent = m.unit;
      card.box.setAttribute("aria-label", `${nameOf(k, chem)} ${m.value} ${m.unit}: open the full plot`);
      this.spark(card.canvas, m.xs, m.ys, m.lo, m.hi);
    }
    const h = histSpark(this.diams);
    const hc = this.cards.hist;
    hc.val.textContent = h.value;
    hc.range.textContent = h.range;
    hc.unit.textContent = h.unit;
    hc.box.setAttribute("aria-label", `grain size, mean ${h.value} ${h.unit}: open the distribution`);
    this.histBars(hc.canvas, h.counts);
    if (this.modal) this.modal.h.update();
  }

  /** the canvas backed at the device's ratio NOW (PlotView.render's rule),
   *  its context scaled to CSS px */
  private backed(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; dpr: number } {
    const dpr = devicePixelRatio || 1;
    const bw = Math.round(SPARK_W * dpr), bh = Math.round(SPARK_H * dpr);
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(bw / SPARK_W, 0, 0, bh / SPARK_H, 0, 0);
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    return { ctx, dpr };
  }

  /** the line, a dot on its latest point, a faint baseline at zero */
  private spark(c: HTMLCanvasElement, xs: number[], ys: number[], lo: number, hi: number) {
    const { ctx, dpr } = this.backed(c);
    const s = layoutSpark(xs, ys, lo, hi, SPARK_W, SPARK_H, 2);
    if (s.base != null) {
      ctx.fillStyle = seriesAlpha(0, 0.28);
      ctx.fillRect(0, Math.round(s.base * dpr) / dpr - 0.5 / dpr, SPARK_W, 1 / dpr);
    }
    ctx.strokeStyle = ctx.fillStyle = dataColor(0);
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    for (const p of s.paths) {
      if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], 1.2, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) (i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]));
      ctx.stroke();
    }
    if (s.last) { ctx.beginPath(); ctx.arc(s.last[0], s.last[1], 2, 0, Math.PI * 2); ctx.fill(); }
  }

  /** the census's bins (round edges, plot/layout.ts bins) as bars */
  private histBars(c: HTMLCanvasElement, counts: number[]) {
    const { ctx } = this.backed(c);
    if (this.diams.length < 3 || !counts.length) return;
    const max = Math.max(...counts);
    const bw = SPARK_W / counts.length;
    ctx.fillStyle = dataColor(0);
    counts.forEach((n, i) => {
      const bh = (n / max) * (SPARK_H - 2);
      if (bh > 0) ctx.fillRect(i * bw + 0.5, SPARK_H - bh, Math.max(0.5, bw - 1), bh);
    });
  }
}
