import type { StatsResult } from "./sim";
import type { StatsResult3D } from "./sim3d";
import { token } from "./design/tool";

/**
 * Ring-buffer sparklines + grain-size histogram (2D and TRUE-3D modes), each
 * on its own plate (app/index.html .spark). One series per card and a title
 * that names it, so no hue is needed to tell them apart: the lines are --fg
 * and the histogram's bars --fg-2, read from tokens.css.
 */
export class Hud {
  private root: HTMLElement;
  private series: Record<string, number[]> = { fs: [], grains: [], dt: [] };
  private canvases: Record<string, CanvasRenderingContext2D> = {};
  private titles: Record<string, HTMLElement> = {};
  private histCtx!: CanvasRenderingContext2D;
  private cap = 160;

  constructor(root: HTMLElement) {
    this.root = root;
    this.add("fs", "FRACTION SOLID");
    this.add("dt", "INTERFACE ΔT");
    this.add("grains", "GRAINS");
    this.addHist("GRAIN SIZE µm");
  }

  private mkPanel(title: string): HTMLCanvasElement {
    const box = document.createElement("div");
    box.className = "spark plate";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = title;
    this.titles[title.split(" ")[0]] = t;
    const c = document.createElement("canvas");
    c.width = 110 * devicePixelRatio;
    c.height = 30 * devicePixelRatio;
    c.style.width = "110px";
    c.style.height = "30px";
    box.append(t, c);
    this.root.append(box);
    return c;
  }

  /** relabel the ΔT strip for TRUE-3D (it carries porosity % there) */
  setMode3(on: boolean) {
    this.titles.INTERFACE.textContent = on ? "POROSITY %" : "INTERFACE ΔT";
  }

  private add(key: string, title: string) {
    const c = this.mkPanel(title);
    this.canvases[key] = c.getContext("2d")!;
  }

  private addHist(title: string) {
    const c = this.mkPanel(title);
    this.histCtx = c.getContext("2d")!;
  }

  reset() {
    for (const k of Object.keys(this.series)) this.series[k] = [];
    this.drawAll(null);
  }

  push(s: StatsResult) {
    this.series.fs.push(s.fracSolid);
    this.series.dt.push(Math.max(0, 1 - s.interfaceT));
    this.series.grains.push(s.grainCount);
    for (const k of Object.keys(this.series))
      if (this.series[k].length > this.cap) this.series[k].shift();
    this.drawAll(s);
  }

  /** TRUE-3D mode: fs, porosity %, grain count, eq-diameter histogram */
  push3(s: StatsResult3D, umPerVox: number) {
    this.series.fs.push(s.fracSolid);
    this.series.dt.push(s.poreFrac * 100);
    this.series.grains.push(s.grainCount);
    for (const k of Object.keys(this.series))
      if (this.series[k].length > this.cap) this.series[k].shift();
    // resolution is passed in from the solver — units.ts owns the anchor
    const diams = s.grains.map(g => Math.cbrt((6 * g.vox) / Math.PI) * umPerVox);
    this.sparks();
    this.hist(diams);
  }

  private drawAll(s: StatsResult | null) {
    this.sparks();
    this.hist(s?.diamsUm ?? []);
  }

  /** the three lines; fraction solid on its fixed 0..1 scale */
  private sparks() {
    const line = token("--fg");
    this.spark("fs", line, 1);
    this.spark("dt", line);
    this.spark("grains", line);
  }

  private spark(key: string, color: string, fixedMax?: number) {
    const ctx = this.canvases[key];
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const data = this.series[key];
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const max = fixedMax ?? Math.max(...data, 1e-9);
    ctx.strokeStyle = color;
    ctx.lineWidth = devicePixelRatio;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (this.cap - 1)) * w;
      const y = h - 2 - (v / max) * (h - 5);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  private hist(diams: number[]) {
    const ctx = this.histCtx;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (diams.length < 3) return;
    const bins = 14;
    const lo = Math.min(...diams), hi = Math.max(...diams) + 1e-9;
    const counts = new Array(bins).fill(0);
    for (const d of diams) {
      const b = Math.min(bins - 1, Math.floor(((d - lo) / (hi - lo)) * bins));
      counts[b]++;
    }
    const max = Math.max(...counts);
    ctx.fillStyle = token("--fg-2");
    const bw = w / bins;
    counts.forEach((c, i) => {
      const bh = (c / max) * (h - 4);
      ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
    });
  }
}
