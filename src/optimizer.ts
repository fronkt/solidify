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
  /** load a converged recipe into the real instrument (armed, full grid) */
  applyRecipe(r: Recipe): void;
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

/** the winning casting schedule, in mapped (physical, dimensionless) units */
export interface Recipe {
  undercool: number;               // initial melt undercooling (fraction of ΔT_melt)
  rain: number;                    // nucleation seeds per unit sim-time
  cool: [number, number, number];  // cooling rate early / mid / late solidification
  astm: number | null;             // grain size this recipe achieved
}

// free-play convergence: declare success once the best casting is close enough
// AND the search has stopped improving (or has clearly stalled)
const CONV_BEST = 0.3;           // |ΔG| considered "on target"
const CONV_MIN_EPISODES = 12;
const CONV_STALL = 6;            // castings without improvement (when on target)
const CONV_STALL_HARD = 18;      // castings without improvement (regardless)

export class Optimizer {
  active = false;
  running = false;   // the transport run/pause gates the optimization loop
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
  private bestRecipe: Recipe | null = null;
  private sinceImprove = 0;
  private converged = false;
  private savedGrid = 1024;
  private panel!: HTMLElement;
  private strip!: HTMLElement;
  private status!: HTMLElement;
  private report!: HTMLElement;
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
    this.bestRecipe = null;
    this.sinceImprove = 0;
    this.converged = false;
    // free-play "Engineer it" enters PAUSED so the user presses run to begin;
    // the bounded challenge AI (has a casting limit) auto-runs.
    this.running = this.limit > 0;
    this.host.swapSim(EP_GRID);
    this.host.renderOnce(1);   // show the fresh melt behind the intro panel
    this.buildPanel();
  }

  isRunning() { return this.running; }

  setRunning(on: boolean) {
    if (!this.active) return;
    // pressing run on a convergence report means "keep searching"
    if (on && this.converged) {
      this.converged = false;
      this.sinceImprove = 0;
      this.report.style.display = "none";
    }
    // always honour a pause — even mid-measurement; the in-flight casting
    // finishes, then the loop halts (tick() gates on `running`)
    this.running = on;
    if (!this.finishing) this.refreshStatus();
  }

  private refreshStatus() {
    if (!this.status) return;
    if (!this.running && this.episode === 0)
      this.status.innerHTML = 'paused — press <b style="color:#ffb454">▶ RUN</b> (bottom-left) to start optimizing';
    else if (!this.running)
      this.status.textContent = `paused at casting #${this.episode} · press ▶ run to resume`;
    else if (this.episode === 0)
      this.status.textContent = "casting #1 …";
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.running = false;
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
    head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:6px;font-size:11px;";
    head.innerHTML = `<span style="letter-spacing:.2em;color:#56d4dd">⚙ ENGINEERING · ML MODE</span>
      <span>target ASTM <b style="color:#ffb454">G ${this.targetASTM}</b></span>
      <input id="labTarget" type="range" min="1" max="6" step="0.5" value="${this.targetASTM}" style="width:110px;flex:1;max-width:150px">`;
    const stop = document.createElement("button");
    stop.textContent = "exit";
    stop.addEventListener("click", () => this.stop());
    head.append(stop);
    const desc = document.createElement("div");
    desc.style.cssText = "font-size:10.5px;color:#8891a0;line-height:1.55;margin-bottom:8px;";
    desc.innerHTML = "A <b style=\"color:#cfd6df\">CMA-ES optimizer</b> searches for a casting recipe " +
      "(cooling schedule + nucleation rate) that lands on your target grain size. Each tile below is " +
      "<b style=\"color:#cfd6df\">one full casting</b> it tried — early runs nucleate heavily and look chaotic while it explores; " +
      "watch <b style=\"color:#cfd6df\">|ΔG|</b> shrink as it learns. When it converges it stops and " +
      "<b style=\"color:#cfd6df\">reports the winning recipe</b>, which you can load into the instrument and run yourself.";
    const strip = document.createElement("div");
    strip.style.cssText = "display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;min-height:86px;align-items:flex-end;";
    const report = document.createElement("div");
    report.id = "labReport";
    report.style.cssText = "display:none;margin-top:8px;padding:9px 11px;border:1px solid rgba(255,180,84,0.45);" +
      "border-radius:6px;background:rgba(255,180,84,0.06);font-size:11px;line-height:1.7;";
    const status = document.createElement("div");
    status.id = "labStatus";
    status.style.cssText = "margin-top:6px;font-size:11px;color:#6b7280;";
    p.append(head, desc, strip, report, status);
    document.getElementById("app")!.append(p);
    this.panel = p;
    this.strip = strip;
    this.status = status;
    this.report = report;
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
        // new objective: past scores are stale, so re-arm the convergence watch
        this.best = Infinity;
        this.bestASTM = null;
        this.bestRecipe = null;
        this.sinceImprove = 0;
        this.converged = false;
        this.report.style.display = "none";
      });
    }
    this.refreshStatus();
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
    if (score < this.best) {
      this.best = score;
      this.bestASTM = astm;
      const g = this.genome!.map(map);
      this.bestRecipe = { undercool: g[4], rain: g[3], cool: [g[0], g[1], g[2]], astm };
      this.sinceImprove = 0;
    } else {
      this.sinceImprove++;
    }

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
    if (!this.running) this.refreshStatus();   // a pause landed mid-casting

    if (this.limit > 0 && this.episode >= this.limit) {
      const cb = this.onDone;
      const b = this.best;
      const g = this.bestASTM;
      this.stop();
      cb?.(b, g);
      return;
    }

    // free-play: declare convergence and hand over the recipe
    if (this.limit === 0 && !this.converged && this.bestRecipe && this.episode >= CONV_MIN_EPISODES &&
        ((this.best <= CONV_BEST && this.sinceImprove >= CONV_STALL) || this.sinceImprove >= CONV_STALL_HARD)) {
      this.showReport();
    }
  }

  private showReport() {
    this.converged = true;
    this.running = false;
    const r = this.bestRecipe!;
    const onTarget = this.best <= CONV_BEST;
    const f = (x: number) => x.toFixed(2);
    this.report.innerHTML =
      `<div style="letter-spacing:.18em;color:#ffb454;margin-bottom:4px">` +
      (onTarget ? "⚑ CONVERGED — RECIPE FOUND" : "⚑ SEARCH STALLED — BEST RECIPE SO FAR") + `</div>` +
      `<div style="color:#c9cdd4">Best casting: <b style="color:#ffb454">G ${r.astm !== null ? r.astm.toFixed(1) : "—"}</b>` +
      ` (target G ${this.targetASTM} · |ΔG| ${this.best.toFixed(2)}) after ${this.episode} castings.</div>` +
      `<div style="color:#8891a0">undercooling <b style="color:#c9cdd4">${f(r.undercool)}</b> · ` +
      `nucleation <b style="color:#c9cdd4">${r.rain.toFixed(0)}</b> seeds/unit-time · ` +
      `cooling early <b style="color:#c9cdd4">${f(r.cool[0])}</b> → mid <b style="color:#c9cdd4">${f(r.cool[1])}</b> → late <b style="color:#c9cdd4">${f(r.cool[2])}</b></div>`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:7px";
    const applyB = document.createElement("button");
    applyB.textContent = "⚗ apply recipe to the instrument";
    applyB.style.cssText = "border-color:#ffb454;color:#ffb454";
    applyB.addEventListener("click", () => {
      const rec = this.bestRecipe!;
      this.stop();
      this.host.applyRecipe(rec);
    });
    const moreB = document.createElement("button");
    moreB.textContent = "keep searching";
    moreB.addEventListener("click", () => {
      this.converged = false;
      this.sinceImprove = 0;      // re-arm: report again after the next stall
      this.report.style.display = "none";
      this.running = true;
      this.refreshStatus();
    });
    row.append(applyB, moreB);
    this.report.append(row);
    this.report.style.display = "block";
    this.status.textContent = "paused on the result · apply the recipe, keep searching, or move the target slider";
  }

  /** drive one animation frame while active (only when the transport is running) */
  tick() {
    if (!this.active || !this.running || this.finishing) return;
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
