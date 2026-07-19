import type { Simulation, StatsResult, PhysParams } from "./sim";
import { DOMAIN_MM } from "./sim";
import type { Renderer } from "./render";

// Foundry-style analysis instruments:
//  - cooling-curve probe: T(t) at one cell, straight off the stats reduction —
//    a thermal-analysis cup test (recalescence arrest shows as the dip-rise)
//  - Scheil overlay: analytic Scheil path T(fs) = 1 − m·c0·(1−fs)^(k−1) for the
//    current pseudo-binary, against the measured (fraction solid, interface T)
//  - SDAS ruler: drag a line across secondary arms; linear-intercept count of
//    solid segments gives λ2 — exactly how metallographers measure it

export interface AnalyzeHost {
  getSim(): Simulation;
  renderer: Renderer;
  simParams(): PhysParams;
}

interface CurvePt { t: number; T: number; phi: number }
interface ScheilPt { fs: number; Ti: number }

export class Analyze {
  probeOn = false;
  scheilOn = false;
  rulerOn = false;
  textureOn = false;

  private fx = 0.5;             // probe position, fraction of domain
  private fy = 0.5;
  private curve: CurvePt[] = [];
  private scheil: ScheilPt[] = [];
  private ruler: { ax: number; ay: number; bx: number; by: number } | null = null;
  private measuring = false;

  private probePanel: HTMLElement;
  private scheilPanel: HTMLElement;
  private texPanel: HTMLElement;
  private probeCtx: CanvasRenderingContext2D;
  private scheilCtx: CanvasRenderingContext2D;
  private texCtx: CanvasRenderingContext2D;
  private lastRose: number[] | null = null;
  private svg: SVGSVGElement;
  private probeMark: SVGGElement;
  private rulerLine: SVGLineElement;
  private rulerText: SVGTextElement;
  private resultEl: HTMLElement | null = null;

  constructor(private host: AnalyzeHost) {
    const mkPanel = (id: string, title: string) => {
      const p = document.createElement("div");
      p.className = "apanel";
      p.id = id;
      p.innerHTML = `<div class="t">${title}</div>`;
      const c = document.createElement("canvas");
      const W = 252, H = 128;
      c.width = W * devicePixelRatio;
      c.height = H * devicePixelRatio;
      c.style.width = W + "px";
      c.style.height = H + "px";
      p.append(c);
      document.getElementById("apanels")!.append(p);
      return { p, ctx: c.getContext("2d")! };
    };
    const a = mkPanel("probePanel", "COOLING CURVE · PROBE");
    const b = mkPanel("scheilPanel", "SCHEIL fs–T · PREDICTED vs MEASURED");
    const c = mkPanel("texPanel", "TEXTURE · GRAIN ORIENTATION ROSE");
    this.probePanel = a.p; this.probeCtx = a.ctx;
    this.scheilPanel = b.p; this.scheilCtx = b.ctx;
    this.texPanel = c.p; this.texCtx = c.ctx;

    this.svg = document.getElementById("overlay") as unknown as SVGSVGElement;
    this.svg.innerHTML = `
      <g id="probeMark" style="display:none">
        <circle r="7" fill="none" stroke="#ffb454" stroke-width="1.4"/>
        <line x1="-11" y1="0" x2="11" y2="0" stroke="#ffb454" stroke-width="1"/>
        <line x1="0" y1="-11" x2="0" y2="11" stroke="#ffb454" stroke-width="1"/>
      </g>
      <line id="rulerLine" x1="0" y1="0" x2="0" y2="0" stroke="#56d4dd" stroke-width="1.6" stroke-dasharray="6 4" style="display:none"/>
      <text id="rulerText" fill="#56d4dd" font-size="11" style="display:none"></text>`;
    this.probeMark = this.svg.querySelector("#probeMark")!;
    this.rulerLine = this.svg.querySelector("#rulerLine")!;
    this.rulerText = this.svg.querySelector("#rulerText")!;
  }

  attachResultEl(el: HTMLElement) { this.resultEl = el; }

  setProbeOn(on: boolean) {
    this.probeOn = on;
    this.curve = [];
    this.applyProbe();
    this.layout();
  }

  setScheilOn(on: boolean) {
    this.scheilOn = on;
    if (on) this.scheil = [];
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
    this.curve = [];
    this.applyProbe();
  }

  /** push probe coords into the (possibly swapped) sim; called each frame */
  applyProbe() {
    const sim = this.host.getSim();
    sim.probe = this.probeOn ? { x: this.fx * sim.n, y: this.fy * sim.n } : null;
  }

  reset() {
    this.curve = [];
    this.scheil = [];
    this.lastRose = null;
    this.draw();
  }

  onStats(s: StatsResult, simTime: number) {
    if (this.probeOn && s.probeT != null) {
      this.curve.push({ t: simTime, T: s.probeT, phi: s.probePhi ?? 0 });
      if (this.curve.length > 900) this.curve = this.curve.filter((_, i) => i % 2 === 0);
    }
    if (this.scheilOn && s.fracSolid > 0.005 && s.fracSolid < 0.995 && s.interfaceT > 0) {
      this.scheil.push({ fs: s.fracSolid, Ti: s.interfaceT });
      if (this.scheil.length > 900) this.scheil = this.scheil.filter((_, i) => i % 2 === 0);
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
    const umPerCell = (DOMAIN_MM * 1000) / sim.n;
    const lenUm = lenCells * umPerCell;
    const label = arms >= 2
      ? `λ₂ ≈ ${(lenUm / arms).toFixed(1)} µm  ·  ${arms} arms over ${lenUm.toFixed(0)} µm`
      : `${arms} intercept over ${lenUm.toFixed(0)} µm — cross more arms`;
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
      this.rulerLine.style.display = "block";
      this.rulerLine.setAttribute("x1", String(a.x));
      this.rulerLine.setAttribute("y1", String(a.y));
      this.rulerLine.setAttribute("x2", String(b.x));
      this.rulerLine.setAttribute("y2", String(b.y));
      this.rulerText.style.display = "block";
      this.rulerText.setAttribute("x", String(Math.max(a.x, b.x) + 10));
      this.rulerText.setAttribute("y", String((a.y + b.y) / 2));
    } else {
      this.rulerLine.style.display = "none";
      this.rulerText.style.display = "none";
    }
  }

  private layout() {
    this.probePanel.style.display = this.probeOn ? "block" : "none";
    this.scheilPanel.style.display = this.scheilOn ? "block" : "none";
    this.texPanel.style.display = this.textureOn ? "block" : "none";
    this.draw();
  }

  // ---------------------------------------------------------------- charts
  private frame(ctx: CanvasRenderingContext2D) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    return { w, h, m: 8 * devicePixelRatio };
  }

  private draw() {
    const p = this.host.simParams();
    if (this.probeOn) this.drawCurve(p);
    if (this.scheilOn) this.drawScheil(p);
    if (this.textureOn) this.drawRose(p);
  }

  /** area-weighted orientation rose, replicated by the crystal's j-fold symmetry */
  private drawRose(p: PhysParams) {
    const ctx = this.texCtx;
    const { w, h, m } = this.frame(ctx);
    const dpr = devicePixelRatio;
    const rose = this.lastRose;
    ctx.font = `${9 * dpr}px monospace`;
    if (!rose || rose.reduce((a, b) => a + b, 0) === 0) {
      ctx.fillStyle = "#5b6675";
      ctx.fillText("no grains yet — grow something", m, h / 2);
      return;
    }
    const j = Math.max(1, Math.round(p.aniMode));
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - m;
    ctx.strokeStyle = "#2a303b";
    ctx.lineWidth = dpr;
    for (const f of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    const max = Math.max(...rose);
    const period = (2 * Math.PI) / j;
    const binW = period / rose.length;
    ctx.fillStyle = "rgba(255,180,84,0.75)";
    for (let k = 0; k < j; k++) {
      for (let b = 0; b < rose.length; b++) {
        const r = R * Math.sqrt(rose[b] / max);
        if (r < 1) continue;
        const a0 = k * period + b * binW;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a0 + binW * 0.9);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.fillStyle = "#5b6675";
    ctx.fillText(`area-weighted · ×${j} symmetry`, m, h - 2 * dpr);
  }

  private drawCurve(p: PhysParams) {
    const ctx = this.probeCtx;
    const { w, h, m } = this.frame(ctx);
    const d = this.curve;
    const dpr = devicePixelRatio;
    const TL = p.alloyOn ? 1 - p.mLiq * p.c0 : 1; // liquidus of the melt
    if (d.length < 2) {
      ctx.fillStyle = "#5b6675";
      ctx.font = `${10 * dpr}px monospace`;
      ctx.fillText("waiting for the melt to run…", m, h / 2);
      return;
    }
    const t0 = d[0].t, t1 = d[d.length - 1].t;
    let lo = Math.min(...d.map(q => q.T), TL), hi = Math.max(...d.map(q => q.T), TL);
    const pad = Math.max(0.05, (hi - lo) * 0.12);
    lo -= pad; hi += pad;
    const X = (t: number) => m + ((t - t0) / Math.max(t1 - t0, 1e-9)) * (w - 2 * m);
    const Y = (T: number) => h - m - ((T - lo) / (hi - lo)) * (h - 2 * m);
    // liquidus reference
    ctx.strokeStyle = "#3d4654";
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(m, Y(TL)); ctx.lineTo(w - m, Y(TL)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#5b6675";
    ctx.font = `${9 * dpr}px monospace`;
    ctx.fillText("T liquidus", w - m - 62 * dpr, Y(TL) - 3 * dpr);
    // trace
    ctx.strokeStyle = "#ffb454";
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    d.forEach((q, i) => { const x = X(q.t), y = Y(q.T); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    // solidification moment at the probe
    const si = d.findIndex(q => q.phi > 0.5);
    if (si > 0) {
      ctx.strokeStyle = "#56d4dd";
      ctx.beginPath(); ctx.moveTo(X(d[si].t), m); ctx.lineTo(X(d[si].t), h - m); ctx.stroke();
      ctx.fillStyle = "#56d4dd";
      ctx.fillText("solid", X(d[si].t) + 3 * dpr, m + 9 * dpr);
    }
    ctx.fillStyle = "#ffb454";
    ctx.fillText(`T ${d[d.length - 1].T.toFixed(3)}`, m, m + 9 * dpr);
  }

  private drawScheil(p: PhysParams) {
    const ctx = this.scheilCtx;
    const { w, h, m } = this.frame(ctx);
    const dpr = devicePixelRatio;
    if (!p.alloyOn) {
      ctx.fillStyle = "#5b6675";
      ctx.font = `${10 * dpr}px monospace`;
      ctx.fillText("enable ALLOY (or pour one) for Scheil", m, h / 2);
      return;
    }
    // analytic Scheil path of the pseudo-binary
    const T = (fs: number) => 1 - p.mLiq * p.c0 * Math.pow(Math.max(1 - fs, 1e-3), p.kPart - 1);
    let lo = T(0.98), hi = 1 - p.mLiq * p.c0;
    for (const q of this.scheil) { lo = Math.min(lo, q.Ti); hi = Math.max(hi, q.Ti); }
    const pad = Math.max(0.03, (hi - lo) * 0.1);
    lo -= pad; hi += pad;
    const X = (fs: number) => m + fs * (w - 2 * m);
    const Y = (t: number) => h - m - ((t - lo) / (hi - lo)) * (h - 2 * m);
    ctx.strokeStyle = "#ffb454";
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const fs = (i / 120) * 0.98;
      const x = X(fs), y = Y(T(fs));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#56d4dd";
    for (const q of this.scheil) ctx.fillRect(X(q.fs) - dpr, Y(q.Ti) - dpr, 2 * dpr, 2 * dpr);
    ctx.fillStyle = "#5b6675";
    ctx.font = `${9 * dpr}px monospace`;
    ctx.fillText("fs 0→1  ·  amber Scheil  ·  cyan measured T_interface", m, h - 2 * dpr);
  }
}
