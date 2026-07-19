// "Engineer it" mode: separable CMA-ES tunes the casting schedule to hit a
// target ASTM grain number. Every episode is a full casting, snapshotted into
// a lab-notebook strip so you can watch the optimizer learn.

import type { Simulation } from "./sim";

export interface OptHost {
  swapSim(n: number): Simulation;
  getSim(): Simulation;
  renderOnce(view: number): void;
  captureThumb(): HTMLCanvasElement;
  onOptimizerDone(): void;
}

// ---------------------------------------------------------- separable CMA-ES
class SepCMAES {
  dim: number; lambda: number; mu: number;
  mean: number[]; sigma: number; C: number[]; ps: number[]; pc: number[];
  weights: number[]; mueff: number; cs: number; cc: number; c1: number; cmu: number; damps: number;
  private pop: number[][] = [];

  constructor(dim: number, lambda = 8, sigma0 = 0.8) {
    this.dim = dim; this.lambda = lambda; this.mu = Math.floor(lambda / 2);
    this.mean = new Array(dim).fill(0);
    this.sigma = sigma0;
    this.C = new Array(dim).fill(1);
    this.ps = new Array(dim).fill(0);
    this.pc = new Array(dim).fill(0);
    const w = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
    const ws = w.reduce((a, b) => a + b, 0);
    this.weights = w.map(x => x / ws);
    this.mueff = 1 / this.weights.reduce((a, b) => a + b * b, 0);
    this.cs = (this.mueff + 2) / (dim + this.mueff + 5);
    this.cc = (4 + this.mueff / dim) / (dim + 4 + 2 * this.mueff / dim);
    this.c1 = 2 / ((dim + 1.3) ** 2 + this.mueff);
    this.cmu = Math.min(1 - this.c1, 2 * (this.mueff - 2 + 1 / this.mueff) / ((dim + 2) ** 2 + this.mueff));
    this.damps = 1 + 2 * Math.max(0, Math.sqrt((this.mueff - 1) / (dim + 1)) - 1) + this.cs;
  }

  private randn(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  ask(): number[][] {
    this.pop = [];
    for (let k = 0; k < this.lambda; k++) {
      const x = this.mean.map((m, i) => m + this.sigma * Math.sqrt(this.C[i]) * this.randn());
      this.pop.push(x);
    }
    return this.pop;
  }

  tell(scores: number[]) {
    if (scores.length !== this.pop.length) {
      console.warn("[cma] score/pop mismatch:", scores.length, "vs", this.pop.length);
    }
    const idx = scores.map((s, i) => [s, i] as const)
      .filter(p => p[1] < this.pop.length)
      .sort((a, b) => a[0] - b[0]).map(p => p[1]);
    if (idx.length < this.mu) return;
    const old = this.mean.slice();
    this.mean = new Array(this.dim).fill(0);
    for (let m = 0; m < this.mu; m++)
      for (let i = 0; i < this.dim; i++)
        this.mean[i] += this.weights[m] * this.pop[idx[m]][i];

    const invSqrtC = this.C.map(c => 1 / Math.sqrt(c));
    for (let i = 0; i < this.dim; i++) {
      const y = (this.mean[i] - old[i]) / this.sigma;
      this.ps[i] = (1 - this.cs) * this.ps[i] + Math.sqrt(this.cs * (2 - this.cs) * this.mueff) * invSqrtC[i] * y;
    }
    const psn = Math.sqrt(this.ps.reduce((a, b) => a + b * b, 0));
    const chiN = Math.sqrt(this.dim) * (1 - 1 / (4 * this.dim) + 1 / (21 * this.dim ** 2));
    const hsig = psn / Math.sqrt(1 - (1 - this.cs) ** (2)) / chiN < 1.4 + 2 / (this.dim + 1) ? 1 : 0;
    for (let i = 0; i < this.dim; i++) {
      const y = (this.mean[i] - old[i]) / this.sigma;
      this.pc[i] = (1 - this.cc) * this.pc[i] + hsig * Math.sqrt(this.cc * (2 - this.cc) * this.mueff) * y;
      let rankMu = 0;
      for (let m = 0; m < this.mu; m++) {
        const z = (this.pop[idx[m]][i] - old[i]) / this.sigma;
        rankMu += this.weights[m] * z * z;
      }
      this.C[i] = (1 - this.c1 - this.cmu) * this.C[i] + this.c1 * this.pc[i] * this.pc[i] + this.cmu * rankMu;
      this.C[i] = Math.max(this.C[i], 1e-8);
    }
    this.sigma *= Math.exp((this.cs / this.damps) * (psn / chiN - 1));
    this.sigma = Math.min(this.sigma, 3);
  }
}

// --------------------------------------------------------------- the episode
// genome (z-space, mapped through logistic bounds):
//   cool0, cool1, cool2 : cooling rate in early / mid / late solidification
//   rain               : nucleation seeds per second
//   undercool          : initial melt undercooling
const BOUNDS: [number, number][] = [
  [0.0, 0.5], [0.0, 0.5], [0.0, 0.5],
  [10.0, 600.0],   // nucleation seeds per unit sim-time
  [0.45, 0.95],
];
const map = (z: number, i: number) => {
  const [lo, hi] = BOUNDS[i];
  return lo + (hi - lo) / (1 + Math.exp(-z));
};

const EP_GRID = 256;
const EP_MAX_STEPS = 9000;
const STEPS_PER_TICK = 300;

export interface OptStartOpts {
  limit?: number;                                    // stop after N castings
  target?: number;                                   // fixed target (locks slider)
  onDone?: (bestScore: number, bestG: number | null) => void;
}

export class Optimizer {
  active = false;
  targetASTM = 4;
  private limit = 0;
  private lockTarget = false;
  private onDone: OptStartOpts["onDone"] = undefined;
  private cma = new SepCMAES(5);
  private queue: number[][] = [];
  private scores: number[] = [];
  private genome: number[] | null = null;
  private stepsUsed = 0;
  private rainAcc = 0;
  private polling = false;
  private episode = 0;
  private best = Infinity;
  private bestASTM: number | null = null;
  private savedGrid = 1024;
  private panel!: HTMLElement;
  private strip!: HTMLElement;
  private status!: HTMLElement;
  private finishing = false;

  constructor(private host: OptHost) {}

  start(currentGrid: number, opts: OptStartOpts = {}) {
    if (this.active) return;
    this.active = true;
    this.savedGrid = currentGrid;
    this.limit = opts.limit ?? 0;
    this.lockTarget = opts.target !== undefined;
    if (opts.target !== undefined) this.targetASTM = opts.target;
    this.onDone = opts.onDone;
    this.cma = new SepCMAES(5);
    this.queue = [];
    this.scores = [];
    this.genome = null;
    this.episode = 0;
    this.best = Infinity;
    this.bestASTM = null;
    this.host.swapSim(EP_GRID);
    this.buildPanel();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.panel?.remove();
    this.host.swapSim(this.savedGrid);
    this.host.onOptimizerDone();
  }

  private buildPanel() {
    this.panel?.remove();
    const p = document.createElement("div");
    p.id = "lab";
    p.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(720px,86vw);" +
      "background:rgba(15,17,21,0.93);border:1px solid #262b33;border-radius:8px;padding:10px 14px;backdrop-filter:blur(6px);z-index:6;";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:8px;font-size:11px;";
    head.innerHTML = `<span style="letter-spacing:.2em;color:#56d4dd">LAB NOTEBOOK</span>
      <span>target ASTM <b style="color:#ffb454">G ${this.targetASTM}</b></span>
      <input id="labTarget" type="range" min="1" max="6" step="0.5" value="${this.targetASTM}" style="width:110px">
      <span id="labStatus" style="color:#6b7280;flex:1"></span>`;
    const stop = document.createElement("button");
    stop.textContent = "stop";
    stop.addEventListener("click", () => this.stop());
    head.append(stop);
    const strip = document.createElement("div");
    strip.style.cssText = "display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;min-height:86px;align-items:flex-end;";
    p.append(head, strip);
    document.getElementById("app")!.append(p);
    this.panel = p;
    this.strip = strip;
    this.status = p.querySelector("#labStatus")!;
    const slider = p.querySelector("#labTarget") as HTMLInputElement;
    if (this.lockTarget) {
      slider.disabled = true;
      slider.style.opacity = "0.35";
      slider.value = String(this.targetASTM);
      (head.querySelector("b") as HTMLElement).textContent = `G ${this.targetASTM}`;
    } else {
      slider.addEventListener("input", () => {
        this.targetASTM = parseFloat(slider.value);
        (head.querySelector("b") as HTMLElement).textContent = `G ${this.targetASTM}`;
      });
    }
    this.status.textContent = "casting #1 …";
  }

  private beginEpisode() {
    if (this.queue.length === 0) {
      if (this.scores.length > 0) this.cma.tell(this.scores);
      // copy: ask() returns the CMA's own population array, and we shift() the queue
      this.queue = [...this.cma.ask()];
      this.scores = [];
    }
    this.genome = this.queue.shift()!;
    this.stepsUsed = 0;
    this.rainAcc = 0;
    this.episode++;
    const g = this.genome.map(map);
    const sim = this.host.getSim();
    sim.params.delta = 0.045;
    sim.params.aniMode = 4;
    sim.params.noiseAmp = 0.012;
    sim.params.latent = 1.5;
    sim.params.twinProb = 0;
    sim.params.coolRate = g[0];
    sim.reset(1 - g[4]);
  }

  private async finishEpisode() {
    if (this.finishing || !this.genome) return;
    this.finishing = true;
    const sim = this.host.getSim();
    let stats = null;
    for (let tries = 0; tries < 40 && !stats; tries++) {
      stats = await sim.readStats();
      // a concurrent poll may hold the staging buffer; give the GPU a beat
      if (!stats) await sim.device.queue.onSubmittedWorkDone();
    }
    let score = 8;
    let astm: number | null = null;
    if (stats && stats.astm !== null) {
      astm = stats.astm;
      score = Math.abs(stats.astm - this.targetASTM) + 0.15 * (this.stepsUsed / EP_MAX_STEPS);
    }
    this.scores.push(score);
    if (score < this.best) { this.best = score; this.bestASTM = astm; }

    // snapshot as etched micrograph
    this.host.renderOnce(2);
    const thumb = this.host.captureThumb();
    const cell = document.createElement("div");
    cell.style.cssText = "flex:0 0 auto;text-align:center;font-size:9px;color:#6b7280;";
    thumb.style.cssText = "width:64px;height:64px;border-radius:4px;border:1px solid " +
      (score === this.best ? "#ffb454" : "#262b33") + ";display:block;";
    const lab = document.createElement("div");
    lab.textContent = astm !== null ? `G ${astm.toFixed(1)}` : "—";
    if (score === this.best) lab.style.color = "#ffb454";
    cell.append(thumb, lab);
    this.strip.append(cell);
    this.strip.scrollLeft = this.strip.scrollWidth;

    this.status.textContent =
      `casting #${this.episode} done · best |ΔG| ${this.best === Infinity ? "—" : this.best.toFixed(2)}` +
      (this.bestASTM !== null ? ` (G ${this.bestASTM.toFixed(1)})` : "") +
      ` · σ ${this.cma.sigma.toFixed(2)}`;
    this.genome = null;
    this.finishing = false;

    if (this.limit > 0 && this.episode >= this.limit) {
      const cb = this.onDone;
      const b = this.best;
      const g = this.bestASTM;
      this.stop();
      cb?.(b, g);
    }
  }

  /** drive one animation frame while active */
  tick() {
    if (!this.active || this.finishing) return;
    if (!this.genome) { this.beginEpisode(); return; }

    const sim = this.host.getSim();
    const g = this.genome.map(map);

    // rain nucleation, paced by sim-time so episode speed doesn't bias it
    this.rainAcc += g[3] * STEPS_PER_TICK * sim.params.dt;
    while (this.rainAcc >= 1) {
      this.rainAcc -= 1;
      sim.addSeed(Math.random() * sim.n, Math.random() * sim.n, 3);
    }

    sim.step(STEPS_PER_TICK);
    this.stepsUsed += STEPS_PER_TICK;
    this.host.renderOnce(1);

    // phase-scheduled cooling + completion check (cheap poll);
    // tag with the episode so a stale result can't finish a fresh casting
    if (!this.polling) {
      this.polling = true;
      const ep = this.episode;
      sim.readStats().then(s => {
        this.polling = false;
        if (!s || !this.active || !this.genome || ep !== this.episode) return;
        sim.params.coolRate = s.fracSolid < 0.33 ? g[0] : s.fracSolid < 0.66 ? g[1] : g[2];
        if (s.fracSolid > 0.92 || this.stepsUsed >= EP_MAX_STEPS) void this.finishEpisode();
      });
    }
    if (this.stepsUsed >= EP_MAX_STEPS) void this.finishEpisode();
  }
}
