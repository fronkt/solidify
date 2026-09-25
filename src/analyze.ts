import type { Simulation, StatsResult, PhysParams } from "./sim";
import type { Renderer } from "./render";
import type { Units } from "./units";
import { LearnLayer, onLearnChange } from "./learn";
import { panelText } from "./learn/panels";
import { bridgeOf, type Bridge } from "./plot/quantity";
import type { Chem, Figure } from "./plot/figures";
import { ProbeRecord, ScheilRecord, probeSample, scheilSample, probeFigure, scheilFigure, roseFigure } from "./plot/analysis";
import { PlotView } from "./plot/view";
import { openFigure, type FigureHandle } from "./plot/modal";
import type { Prov } from "./plot/csv";
import type { PlotMeta } from "./hud";

// Foundry-style analysis instruments:
//  - cooling-curve probe: T(t) at one cell, straight off the stats reduction —
//    a thermal-analysis cup test (recalescence arrest shows as the dip-rise)
//  - Scheil overlay: analytic Scheil path T(fs) = 1 − m·c0·(1−fs)^(k−1) for the
//    current pseudo-binary, against the measured (fraction solid, interface T)
//  - growth-direction rose: each grain's growth direction, area-weighted
//  - SDAS ruler: drag a line across secondary arms; linear-intercept count of
//    solid segments gives λ2 — exactly how metallographers measure it
//
// The three plots are figures of the plot core (src/plot, U2): axes with
// round ticks, titles in the melt's own units (°C and seconds for a real
// material, dimensionless for the model metal), a hover readout, and a click
// or the ⤢ opens the figure large with its data table and exports.

export interface AnalyzeHost {
  getSim(): Simulation;
  renderer: Renderer;
  simParams(): PhysParams;
  /** the live unit bridge (main.ts unitsNow) */
  units(): Units;
  /** the melt, the seed and the grid, for a figure's provenance */
  meta(): PlotMeta;
  /** the chemistry the 2D solver runs now (main.ts chemNow), latched with
   *  each series: its liquidus and its Scheil path */
  chem(): Chem;
}

type Which = "probe" | "scheil" | "tex";
/** each plot's size in the column, CSS px */
const SIZE: Record<Which, [number, number]> = { probe: [252, 168], scheil: [252, 168], tex: [252, 212] };

export class Analyze {
  probeOn = false;
  scheilOn = false;
  rulerOn = false;
  textureOn = false;

  private fx = 0.5;             // probe position, fraction of domain
  private fy = 0.5;
  /** the series, each with the unit bridge it started under (plot/figures.ts
   *  TimedRecord: kept only while sim time advances, 900 samples at most) */
  private curve = new ProbeRecord();
  private scheil = new ScheilRecord();
  private ruler: { ax: number; ay: number; bx: number; by: number } | null = null;
  private measuring = false;

  private probePanel: HTMLElement;
  private scheilPanel: HTMLElement;
  private texPanel: HTMLElement;
  private views: Record<Which, PlotView>;
  private lastRose: number[] | null = null;
  private svg: SVGSVGElement;
  private probeMark: SVGGElement;
  private rulerLine: SVGLineElement;
  /** the ruler's --bg casing, under its --fg dashes, moved with it */
  private rulerCase: SVGLineElement;
  private rulerText: SVGTextElement;
  private resultEl: HTMLElement | null = null;

  /** the enlarged figure, when one is open */
  private modal: { which: Which; h: FigureHandle } | null = null;

  /** learn mode's "i" on each panel's title bar; one explanation open at a
   *  time, so the column cannot climb under the top bar */
  private learn = new LearnLayer(() => this.learn.apply(), true);

  constructor(private host: AnalyzeHost) {
    const mkPanel = (id: string, title: string, learnKey: string, which: Which) => {
      const p = document.createElement("div");
      p.className = "apanel";
      p.id = id;
      p.innerHTML = `<div class="t"><span>${title}</span>` +
        `<button class="zoomBtn iconbtn" type="button" title="enlarge" aria-label="enlarge ${title.toLowerCase()}">⤢</button></div>`;
      // the "i" right after the title; its text under the title bar, no
      // wider than the plot (the column is as wide as its widest child)
      const t = p.querySelector(".t") as HTMLElement;
      const ex = this.learn.explain(t, `about ${title.toLowerCase()}`, panelText(learnKey), t.querySelector(".zoomBtn"));
      ex.body.style.maxWidth = `${SIZE[which][0]}px`;
      t.after(ex.body);
      // the figure: a wrapper at the plot's size holding the canvas and its
      // hover overlay (plot/view.ts), a button that opens the full figure
      const holder = document.createElement("div");
      holder.className = "aplot";
      holder.style.width = `${SIZE[which][0]}px`;
      holder.style.height = `${SIZE[which][1]}px`;
      p.append(holder);
      document.getElementById("apanels")!.append(p);
      const view = new PlotView(holder, { label: `${title.toLowerCase()}: open the full figure`, onOpen: () => this.openBig(which) });
      p.querySelector(".zoomBtn")!.addEventListener("click", () => this.openBig(which));
      return { p, view };
    };
    const a = mkPanel("probePanel", "COOLING CURVE · PROBE", "COOLING CURVE · PROBE", "probe");
    const b = mkPanel("scheilPanel", "SCHEIL fs–T · PREDICTED vs MEASURED", "SCHEIL", "scheil");
    const c = mkPanel("texPanel", "TEXTURE · GRAIN ORIENTATION ROSE", "TEXTURE · GRAIN ORIENTATION ROSE", "tex");
    onLearnChange(() => this.learn.apply());
    this.learn.apply();
    this.probePanel = a.p;
    this.scheilPanel = b.p;
    this.texPanel = c.p;
    this.views = { probe: a.view, scheil: b.view, tex: c.view };

    this.svg = document.getElementById("overlay") as unknown as SVGSVGElement;
    // the probe crosshair and the SDAS ruler are the instrument's marks on the
    // melt, so achromatic (app/index.html .mk: --fg over a --bg casing that
    // keeps them legible over the white-hot MELT and ETCH lenses alike)
    this.svg.innerHTML = `
      <g id="probeMark" class="mk" style="display:none">
        <g class="mk__case"><circle r="7"/><line x1="-11" y1="0" x2="11" y2="0"/><line x1="0" y1="-11" x2="0" y2="11"/></g>
        <g class="mk__ink"><circle r="7"/><line x1="-11" y1="0" x2="11" y2="0"/><line x1="0" y1="-11" x2="0" y2="11"/></g>
      </g>
      <line id="rulerCase" class="mk mk__lcase" x1="0" y1="0" x2="0" y2="0" style="display:none"/>
      <line id="rulerLine" class="mk mk__line" x1="0" y1="0" x2="0" y2="0" style="display:none"/>
      <text id="rulerText" class="mk mk__text" style="display:none"></text>`;
    this.probeMark = this.svg.querySelector("#probeMark")!;
    this.rulerCase = this.svg.querySelector("#rulerCase")!;
    this.rulerLine = this.svg.querySelector("#rulerLine")!;
    this.rulerText = this.svg.querySelector("#rulerText")!;
  }

  attachResultEl(el: HTMLElement) { this.resultEl = el; }

  setProbeOn(on: boolean) {
    this.probeOn = on;
    this.curve.clear();
    this.applyProbe();
    this.layout();
  }

  setScheilOn(on: boolean) {
    this.scheilOn = on;
    if (on) this.scheil.clear();
    this.layout();
  }

  setTextureOn(on: boolean) {
    this.textureOn = on;
    this.layout();
  }

  setRulerOn(on: boolean) {
    this.rulerOn = on;
    if (!on) { this.ruler = null; if (this.resultEl) this.resultEl.textContent = ""; }
  }

  setProbe(gx: number, gy: number) {
    const n = this.host.getSim().n;
    this.fx = gx / n;
    this.fy = gy / n;
    this.curve.clear();
    this.applyProbe();
  }

  /** push probe coords into the (possibly swapped) sim; called each frame */
  applyProbe() {
    const sim = this.host.getSim();
    sim.probe = this.probeOn ? { x: this.fx * sim.n, y: this.fy * sim.n } : null;
  }

  reset() {
    this.curve.clear();
    this.scheil.clear();
    this.lastRose = null;
    this.draw();
  }

  /** the units in force now, latched by a series when it starts */
  private bridgeNow(): Bridge { return bridgeOf(this.host.units(), this.host.meta().material); }

  onStats(s: StatsResult, simTime: number) {
    const b = this.bridgeNow(), chem = this.host.chem();
    const pr = this.probeOn ? probeSample(simTime, s.probeT, s.probePhi) : null;
    if (pr) this.curve.push(pr, b, chem);
    if (this.scheilOn) {
      const q = scheilSample(simTime, s.fracSolid, s.interfaceT, s.interfaceCells > 0);
      if (q) this.scheil.push(q, b, chem);
    }
    if (this.textureOn) this.lastRose = s.oriRose;
    this.draw();
  }

  // ---------------------------------------------------------------- ruler
  beginRuler(g: { x: number; y: number }) { this.ruler = { ax: g.x, ay: g.y, bx: g.x, by: g.y }; }
  dragRuler(g: { x: number; y: number }) { if (this.ruler) { this.ruler.bx = g.x; this.ruler.by = g.y; } }

  async endRuler() {
    const r = this.ruler;
    if (!r || this.measuring) return;
    const sim = this.host.getSim();
    const lenCells = Math.hypot(r.bx - r.ax, r.by - r.ay);
    if (lenCells < 8) { this.ruler = null; return; }
    this.measuring = true;
    const phi = await sim.readLine(r.ax, r.ay, r.bx, r.by);
    this.measuring = false;
    if (!phi) return;
    // linear intercept with hysteresis: count solid segments along the trace
    let arms = 0;
    let inSolid = phi[0] > 0.5;
    for (let i = 1; i < phi.length; i++) {
      if (!inSolid && phi[i] > 0.6) { inSolid = true; arms++; }
      else if (inSolid && phi[i] < 0.4) { inSolid = false; }
    }
    if (inSolid && arms === 0) arms = 1;
    const umPerCell = sim.umPerCell;
    const lenUm = lenCells * umPerCell;
    const label = arms >= 2
      ? `λ₂ ≈ ${(lenUm / arms).toFixed(1)} µm · ${arms} arms / ${lenUm.toFixed(0)} µm`
      : `${arms} intercept / ${lenUm.toFixed(0)} µm · need ≥ 2 arms`;
    if (this.resultEl) this.resultEl.textContent = label;
    this.rulerText.textContent = arms >= 2 ? `λ₂ ≈ ${(lenUm / arms).toFixed(1)} µm` : "";
  }

  /** reposition SVG overlay marks through the current zoom/pan; every frame */
  updateOverlay() {
    const sim = this.host.getSim();
    const r = this.host.renderer;
    if (this.probeOn) {
      const p = r.gridToClient(this.fx * sim.n, this.fy * sim.n, sim.n);
      this.probeMark.style.display = "block";
      this.probeMark.setAttribute("transform", `translate(${p.x},${p.y})`);
    } else {
      this.probeMark.style.display = "none";
    }
    if (this.ruler && this.rulerOn) {
      const a = r.gridToClient(this.ruler.ax, this.ruler.ay, sim.n);
      const b = r.gridToClient(this.ruler.bx, this.ruler.by, sim.n);
      for (const l of [this.rulerCase, this.rulerLine]) {
        l.style.display = "block";
        l.setAttribute("x1", String(a.x));
        l.setAttribute("y1", String(a.y));
        l.setAttribute("x2", String(b.x));
        l.setAttribute("y2", String(b.y));
      }
      this.rulerText.style.display = "block";
      this.rulerText.setAttribute("x", String(Math.max(a.x, b.x) + 10));
      this.rulerText.setAttribute("y", String((a.y + b.y) / 2));
    } else {
      this.rulerCase.style.display = "none";
      this.rulerLine.style.display = "none";
      this.rulerText.style.display = "none";
    }
  }

  private layout() {
    this.probePanel.style.display = this.probeOn ? "block" : "none";
    this.scheilPanel.style.display = this.scheilOn ? "block" : "none";
    this.texPanel.style.display = this.textureOn ? "block" : "none";
    // the gesture hint shares the column's band: it steps out while the
    // column shows a panel (app/index.html .cols2d)
    document.body.classList.toggle("cols2d", this.probeOn || this.scheilOn || this.textureOn);
    this.draw();
  }

  // ------------------------------------------------------------ the figures
  /** what a figure's provenance names, plus what this panel adds */
  private prov(recorded: number | undefined, extra: string[] = []): Prov {
    return { ...this.host.meta(), recorded, extra };
  }

  /** a panel's figure (plot/analysis.ts), from its series and the bridge
   *  and the chemistry the series started under (a dial moved since started
   *  a new series; before any sample, the live ones) */
  figure(which: Which): Figure {
    const p = this.host.simParams();
    const sim = this.host.getSim();
    if (which === "probe") {
      return probeFigure({
        samples: this.curve.samples, bridge: this.curve.bridge ?? this.bridgeNow(),
        chem: this.curve.chem ?? this.host.chem(), three: false,
        prov: this.prov(this.curve.recorded, [`probe at cell (${Math.round(this.fx * sim.n)}, ${Math.round(this.fy * sim.n)})`]),
      });
    }
    if (which === "scheil") {
      return scheilFigure({
        samples: this.scheil.samples, bridge: this.scheil.bridge ?? this.bridgeNow(),
        chem: this.scheil.chem ?? this.host.chem(), three: false, prov: this.prov(this.scheil.recorded),
      });
    }
    return roseFigure({ rose: this.lastRose, j: p.aniMode, umPerCell: sim.umPerCell, bridge: this.bridgeNow(), prov: this.prov(undefined) });
  }

  /** the enlarged figure (plot/modal.ts): large, with its data table and
   *  exports; live, it follows the melt */
  private openBig(which: Which) {
    this.modal?.h.close();
    const h = openFigure(() => this.figure(which), () => { if (this.modal?.h === h) this.modal = null; });
    this.modal = { which, h };
  }

  private draw() {
    if (this.probeOn) this.views.probe.set(this.figure("probe").fig);
    if (this.scheilOn) this.views.scheil.set(this.figure("scheil").fig);
    if (this.textureOn) this.views.tex.set(this.figure("tex").fig);
    this.modal?.h.update();
  }
}
