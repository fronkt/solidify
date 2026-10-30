// Each optimizer episode is a real casting on the current volume/grid.
// Search and applied recipes share the same fence-paced casting clock.
import type { Sim3D, Phys3DParams, StatsResult3D } from "./sim3d";
import type { Nucleation, NucState } from "./nucleation";
import { getSeed, stream } from "./rng";
import { SepCMAES } from "./optimizer";
import type { Units } from "./units";
import { chargeLiquidus, type Figure } from "./plot/figures";
import { bridgeOf, type Bridge } from "./plot/quantity";
import type { PlotMeta, Prov } from "./plot/csv";
import { extent } from "./plot/layout";
import { PlotView } from "./plot/view";
import { openFigure, type FigureHandle } from "./plot/modal";
import { panelHead, pill, kv, num } from "./design/panel";
import { paintRange } from "./design/tool";
import { LearnLayer, learnSlot, fillLearnSlots, onLearnChange } from "./learn";
import { OPT3_CAVEATS, panelText } from "./learn/panels";
import { CAST3_BATCH, CAST3_COMPLETE, CAST3_MAX_STEPS, OPT3_EPISODES,
  copyRecipe3, coolingAt3, genomeRecipe3, measureCasting3, type Recipe3D, type Casting3Measurement } from "./optimizer3d-model";
export type { Recipe3D } from "./optimizer3d-model";

export interface Opt3Host {
  sim(): Sim3D | null;
  nuc(): Nucleation;
  units(): Units;
  meta(): PlotMeta;
  contextKey(): string;
  renderOnce(): void;
  captureThumb(): HTMLCanvasElement;
  onChange(): void;
  restoreArmed(): void;
  applyRecipe(recipe: Recipe3D): void | Promise<void>;
  shareRecipeLink(recipe: Recipe3D): string;
}

export interface Opt3StartOpts { limit?: number; maxSteps?: number; target?: number }
export interface Opt3History extends Casting3Measurement {
  episode: number;
  deliveredSteps: number;
  target: number;
  best: number | null;
}
const stamp = (params: Phys3DParams) => JSON.stringify(params);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** One deterministic casting. It never schedules a frame or changes RNG seed. */
export class Casting3DClock {
  readonly recipe: Recipe3D;
  private canceled = false;
  private staged = false;
  private pending = false;
  private deliveredSteps = 0;
  private stats: StatsResult3D | null = null;
  private expected: Phys3DParams;
  private expectedNuc: NucState;
  private expectedFilm: number;
  private invalid: string | null = null;

  constructor(private sim: Sim3D, private nuc: Nucleation, recipe: Recipe3D,
    private isCurrent: () => boolean = () => true) {
    if (recipe.dimension !== "3d" || !Number.isSafeInteger(recipe.grid) || recipe.grid < 1
      || !(recipe.pitch > 0) || !Number.isFinite(recipe.pitch) || !Number.isSafeInteger(recipe.seed)
      || !Number.isSafeInteger(recipe.maxSteps) || recipe.maxSteps < 1 || recipe.maxSteps > 100_000
      || !Number.isSafeInteger(recipe.nmax) || recipe.nmax < 0 || recipe.nmax > 2000
      || !Number.isFinite(recipe.undercool) || recipe.undercool < .01 || recipe.undercool > .95
      || recipe.cool.length !== 3 || recipe.cool.some(v => !Number.isFinite(v) || v < 0)
      || Object.values(recipe.params).some(v => !Number.isFinite(v))) throw new Error("Invalid 3D casting recipe");
    this.recipe = copyRecipe3(recipe);
    this.expected = { ...sim.params };
    this.expectedNuc = { ...nuc.p }; this.expectedFilm = nuc.filmFraction;
  }

  private check() {
    if (this.canceled || !this.isCurrent()) throw new Error("Casting canceled because its setup changed");
    if (this.sim.n !== this.recipe.grid || this.sim.umPerCell !== this.recipe.pitch || getSeed() !== this.recipe.seed)
      throw new Error("Casting grid, pitch, or seed changed");
    if (stamp(this.sim.params) !== stamp(this.expected)) throw new Error("Casting parameters changed during optimization");
    if (JSON.stringify(this.nuc.p) !== JSON.stringify(this.expectedNuc) || this.nuc.filmFraction !== this.expectedFilm)
      throw new Error("Inoculant setup changed during optimization");
  }

  private async census(): Promise<StatsResult3D> {
    for (let tries = 0; tries < 12; tries++) {
      this.check();
      const stats = await this.sim.readStats();
      this.check();
      if (stats) return stats;
      await this.sim.device.queue.onSubmittedWorkDone();
      this.check();
      // A competing mapAsync callback releases its lock on a later task.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.check();
    }
    throw new Error("The 3D grain census is unavailable; no result was ranked");
  }

  async stage(): Promise<void> {
    if (this.pending) throw new Error("A casting operation is already pending");
    this.pending = true;
    try {
      this.check();
      if (this.recipe.params.solver !== 0) throw new Error("3D optimization currently requires the Kobayashi model");
      if (this.recipe.params.alloyOn === 1 && !this.sim.alloyActive) throw new Error("The 3D alloy field is not ready");
      Object.assign(this.sim.params, this.recipe.params, { solver: 0, scen: 0, twinProb: 0, coolRate: this.recipe.cool[0] });
      this.expected = { ...this.sim.params };
      Object.assign(this.nuc.p, this.recipe.nuc, { nmax: this.recipe.nmax });
      this.nuc.stage(this.sim.n, true, 0);
      this.expectedNuc = { ...this.nuc.p }; this.expectedFilm = 0;
      this.sim.reset(1 - this.recipe.undercool);
      this.expected = { ...this.sim.params };
      this.deliveredSteps = 0;
      this.stats = await this.census();
      this.nuc.observe(this.sim.simTime, this.stats.meanLiqT, chargeLiquidus(this.sim.params));
      this.staged = true;
    } catch (error) { this.invalid = message(error); throw error; }
    finally { this.pending = false; }
  }

  async advance(): Promise<StatsResult3D | null> {
    if (this.pending || !this.staged || this.canceled || this.invalid) return null;
    if (this.completed || this.exhausted) return this.stats;
    this.pending = true;
    try {
      this.check();
      const rate = coolingAt3(this.stats?.fracSolid ?? 0, this.recipe.cool);
      this.sim.params.coolRate = rate;
      this.expected = { ...this.sim.params };
      this.nuc.update(this.sim.simTime, rate, (x, y, z, d) => this.sim.addSeed3D(x, y, z, 3, undefined, d));
      // Stamp every currently activated site before advancing physics. Otherwise
      // the 128-seed upload limit changes activation timing with inoculant count.
      while (this.sim.pendingSeedCount > 0) {
        const before = this.sim.pendingSeedCount;
        await this.sim.stepSync(0);
        this.check();
        if (this.sim.pendingSeedCount >= before) throw new Error("3D seed queue did not drain");
      }
      const requested = Math.min(CAST3_BATCH, this.recipe.maxSteps - this.deliveredSteps);
      const got = await this.sim.stepSync(requested);
      this.check();
      if (got !== requested) throw new Error(`3D casting delivered ${got} of ${requested} requested steps`);
      this.deliveredSteps += got;
      this.stats = await this.census();
      this.nuc.observe(this.sim.simTime, this.stats.meanLiqT, chargeLiquidus(this.sim.params));
      return this.stats;
    } catch (error) { this.invalid = message(error); throw error; }
    finally { this.pending = false; }
  }

  get completed() { return this.stats != null && Number.isFinite(this.stats.fracSolid) && this.stats.fracSolid >= CAST3_COMPLETE; }
  get exhausted() { return this.deliveredSteps >= this.recipe.maxSteps; }
  expectedParams(): Phys3DParams { return { ...this.expected }; }
  cancel() { this.canceled = true; }
  snapshot() {
    return { pending: this.pending, deliveredSteps: this.deliveredSteps,
      stats: this.stats ? { ...this.stats, grains: this.stats.grains.map(grain => ({ ...grain })) } : null,
      completed: this.completed, exhausted: this.exhausted, invalid: this.invalid };
  }
}

/** Bounded current-grid CMA-ES search with its own random sampling stream. */
export class Optimizer3D {
  active = false;
  running = false;
  private pending = false;
  private stopping = false;
  private version = 0;
  private work: Promise<void> | null = null;
  private stopTask: Promise<void> | null = null;
  private saved: { sim: Sim3D; params: Phys3DParams; nuc: NucState; film: number; key: string; seed: number; pitch: number } | null = null;
  private lastExpected: Phys3DParams | null = null;
  private clock: Casting3DClock | null = null;
  private cma = new SepCMAES(5, 8, .8, stream("optimizer3d"));
  private queue: number[][] = [];
  private scores: number[] = [];
  private candidate: Recipe3D | null = null;
  private currentRecipe: Recipe3D | null = null;
  private lastClock: ReturnType<Casting3DClock["snapshot"]> | null = null;
  private bestRecipe: Recipe3D | null = null;
  private best = Infinity;
  private episode = 0;
  private totalSteps = 0;
  private target = 0;
  private limit = OPT3_EPISODES;
  private maxSteps = CAST3_MAX_STEPS;
  private known = false;
  private unit: "µm" | "cells" = "cells";
  private history: Opt3History[] = [];
  private status = "closed";
  private panel: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private report: HTMLElement | null = null;
  private strip: HTMLElement | null = null;
  private slider: HTMLInputElement | null = null;
  private targetLabel: HTMLElement | null = null;
  private budgetSelect: HTMLSelectElement | null = null;
  private stepBudgetSelect: HTMLSelectElement | null = null;
  private applyButton: HTMLButtonElement | null = null;
  private moreButton: HTMLButtonElement | null = null;
  private copyButton: HTMLButtonElement | null = null;
  private plot: PlotView | null = null;
  private plotModal: FigureHandle | null = null;
  private bridge: Bridge | null = null;
  private prov: Prov | null = null;
  private learn = new LearnLayer(() => this.applyLearn());

  constructor(private host: Opt3Host) { onLearnChange(() => this.applyLearn()); }

  private applyLearn() {
    if (!this.active || !this.panel) return;
    this.learn.apply(); fillLearnSlots(this.panel);
  }

  private owned() {
    return this.saved != null && this.host.sim() === this.saved.sim && this.host.contextKey() === this.saved.key
      && getSeed() === this.saved.seed && this.saved.sim.umPerCell === this.saved.pitch;
  }

  start(opts: Opt3StartOpts = {}): boolean {
    if (this.active || this.pending || this.stopping) return false;
    const sim = this.host.sim();
    if (!sim) { this.status = "A 3D volume is required"; return false; }
    if (sim.params.solver !== 0) {
      this.status = "3D optimizer uses the Kobayashi model. Turn calibration off to search; the solver was not changed.";
      this.buildRefusal(); return false;
    }
    if (sim.params.alloyOn === 1 && !sim.alloyActive) {
      this.status = "The 3D alloy field is not ready. Finish preparing it before starting the search.";
      this.buildRefusal(); return false;
    }
    const limit = opts.limit ?? OPT3_EPISODES, maxSteps = opts.maxSteps ?? CAST3_MAX_STEPS;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 || !Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 100_000)
      throw new Error("3D search needs 1–64 castings and a positive step budget up to 100000");
    this.saved = { sim, params: { ...sim.params }, nuc: { ...this.host.nuc().p }, film: this.host.nuc().filmFraction,
      key: this.host.contextKey(), seed: getSeed(), pitch: sim.umPerCell };
    this.lastExpected = { ...sim.params };
    this.known = this.host.units().known;
    this.unit = this.known ? "µm" : "cells";
    const scale = this.known ? sim.umPerCell : 1;
    const target = opts.target ?? .22 * sim.n * scale;
    if (!Number.isFinite(target) || target <= 0) throw new Error("A finite positive 3D diameter target is required");
    this.target = target; this.limit = limit; this.maxSteps = maxSteps;
    this.currentRecipe = null; this.lastClock = null;
    this.active = true; this.running = false; this.pending = false; this.version++;
    this.resetSearch();
    this.prov = { ...this.host.meta(), extra: [
      `TRUE 3D current-grid model search: ${sim.n}³ cells, cell pitch ${sim.umPerCell} µm; no proxy-grid transfer.`,
      "Volume-equivalent diameter of censused grains; census excludes small grain fragments. Not a 2D ASTM conversion or a validated manufacturing prediction.",
      `Free casting, twins disabled, fixed batches of ${CAST3_BATCH} delivered substeps; valid casting solid fraction >= ${CAST3_COMPLETE}.`,
    ] };
    this.bridge = bridgeOf(this.host.units(), this.prov.material);
    this.buildPanel(); this.updateStatus("paused · run to start 3D castings");
    this.host.onChange(); return true;
  }

  private resetSearch() {
    // Cancellation can happen after a batch wrote its next cooling stage but
    // before its census returned. Exit must still recognize that owned write.
    if (this.clock) this.lastExpected = this.clock.expectedParams();
    this.clock?.cancel(); this.clock = null; this.candidate = null;
    const rng = stream("optimizer3d"); rng.reset(); this.cma = new SepCMAES(5, 8, .8, rng);
    this.queue = []; this.scores = []; this.history = []; this.episode = 0; this.totalSteps = 0;
    this.best = Infinity; this.bestRecipe = null;
  }

  setTarget(value: number) {
    if (!this.active || this.stopping || !Number.isFinite(value) || value <= 0) return;
    this.version++; this.running = false; this.target = value;
    this.resetSearch(); this.strip?.replaceChildren();
    if (this.report) this.report.style.display = "none";
    if (this.slider) this.slider.value = String(value);
    this.paintTarget(); this.paintPlot(); this.syncControls(); this.updateStatus("search reset · paused · run to restart"); this.host.onChange();
  }

  isRunning() { return this.running; }
  setRunning(on: boolean) {
    if (!this.active || this.stopping) return;
    if (on && !this.owned()) { void this.stop(); return; }
    if (on && this.clock?.snapshot().invalid) { this.version++; this.resetSearch(); }
    if (on && this.episode >= this.limit && !this.clock) this.limit = Math.min(64, this.limit + OPT3_EPISODES);
    if (this.budgetSelect) {
      if (![...this.budgetSelect.options].some(option => option.value === String(this.limit))) {
        const option = document.createElement("option"); option.value = String(this.limit); option.textContent = String(this.limit);
        this.budgetSelect.append(option);
      }
      this.budgetSelect.value = String(this.limit);
    }
    this.running = on;
    this.syncControls();
    if (on && this.report) this.report.style.display = "none";
    this.updateStatus(on ? `casting #${this.episode || 1} · ${this.limit} casting budget` : "paused · run to resume");
    this.host.onChange();
  }

  tick(multiplier = 1) {
    if (!this.active || !this.running || this.pending || this.stopping) return;
    if (!this.owned()) { void this.stop(); return; }
    const version = this.version;
    this.pending = true;
    this.syncControls();
    this.work = this.advance(version, Math.max(1, Math.min(4, Math.floor(multiplier)))).catch(error => {
      if (!this.active || version !== this.version) return;
      this.running = false; this.clock?.cancel();
      this.updateStatus(`search stopped · ${message(error)}`); this.showReport(message(error)); this.host.onChange();
    }).finally(() => { this.pending = false; this.work = null; this.syncControls(); });
  }

  private async advance(version: number, batches: number) {
    const current = () => this.active && version === this.version && this.owned() && !this.stopping;
    if (!this.clock) {
      if (this.episode >= this.limit) { this.running = false; this.showReport(); this.host.onChange(); return; }
      if (!this.queue.length) {
        if (this.scores.length) this.cma.tell(this.scores);
        this.queue = [...this.cma.ask()]; this.scores = [];
      }
      const saved = this.saved!, genes = genomeRecipe3(this.queue.shift()!, saved.nuc, chargeLiquidus(saved.params));
      this.candidate = { dimension: "3d", grid: saved.sim.n, pitch: saved.pitch, seed: saved.seed,
        known: this.known, unit: this.unit, params: { ...saved.params, solver: 0, scen: 0, twinProb: 0 },
        nuc: { ...saved.nuc }, ...genes, target: this.target, diameter: null, maxSteps: this.maxSteps };
      this.episode++;
      this.clock = new Casting3DClock(saved.sim, this.host.nuc(), this.candidate, current);
      await this.clock.stage();
      if (!current()) return;
      this.lastExpected = this.clock.expectedParams();
      this.currentRecipe = copyRecipe3(this.candidate);
      this.lastClock = this.clock.snapshot();
      this.host.renderOnce();
      this.updateStatus(`casting #${this.episode}/${this.limit} · 0/${this.maxSteps} steps`);
      return;
    }
    for (let batch = 0; batch < batches && this.running && current(); batch++) {
      const clock: Casting3DClock | null = this.clock;
      if (!clock) break;
      const before = clock.snapshot().deliveredSteps;
      const stats = await clock.advance();
      if (!current() || clock !== this.clock) return;
      const state = clock.snapshot(); this.totalSteps += state.deliveredSteps - before;
      this.lastExpected = clock.expectedParams();
      this.lastClock = state;
      this.host.renderOnce();
      this.updateStatus(`casting #${this.episode}/${this.limit} · ${state.deliveredSteps}/${this.maxSteps} steps · solid ${((stats?.fracSolid ?? 0) * 100).toFixed(1)}%`);
      if (state.completed || state.exhausted) { this.finishEpisode(stats, state.deliveredSteps); break; }
    }
  }

  private finishEpisode(stats: StatsResult3D | null, deliveredSteps: number) {
    const recipe = this.candidate!;
    const measured = measureCasting3(stats, recipe);
    this.scores.push(measured.score);
    if (measured.valid && measured.score < this.best) {
      this.best = measured.score;
      this.bestRecipe = copyRecipe3({ ...recipe, diameter: measured.diameter });
    }
    this.history.push({ ...measured, episode: this.episode, target: recipe.target, deliveredSteps,
      best: Number.isFinite(this.best) ? this.best : null });
    this.paintPlot();
    const tile = document.createElement("div"); tile.className = "otile";
    if (measured.valid && measured.score === this.best) {
      this.strip?.querySelector(".best")?.classList.remove("best"); tile.classList.add("best");
    }
    const label = document.createElement("div");
    label.textContent = measured.valid && measured.diameter != null ? `${measured.diameter.toFixed(1)} ${this.unit}` : "incomplete";
    tile.append(this.host.captureThumb(), label); this.strip?.append(tile);
    if (this.strip) this.strip.scrollLeft = this.strip.scrollWidth;
    this.clock = null; this.candidate = null;
    if (this.episode >= this.limit) { this.running = false; this.showReport(); this.host.onChange(); }
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    if (!this.active) { this.panel?.remove(); this.panel = null; return Promise.resolve(); }
    this.stopTask = this.stopSearch().finally(() => { this.stopTask = null; });
    return this.stopTask;
  }

  private async stopSearch(): Promise<void> {
    this.stopping = true; this.running = false; this.version++;
    this.syncControls();
    const clock = this.clock, expected = clock?.expectedParams() ?? this.lastExpected; clock?.cancel();
    try {
      await this.work;
      const saved = this.saved;
      if (saved && this.owned()) {
        await saved.sim.device.queue.onSubmittedWorkDone();
        if (this.owned()) {
          const last = expected ?? saved.params;
          for (const key of Object.keys(saved.params) as (keyof Phys3DParams)[])
            if (saved.sim.params[key] === last[key]) saved.sim.params[key] = saved.params[key];
          Object.assign(this.host.nuc().p, saved.nuc);
          this.host.nuc().setFilm(saved.film);
          this.active = false;
          this.host.restoreArmed();
        }
      }
    } catch (error) { this.status = `exit error · ${message(error)}`; }
    finally {
      this.clock = null; this.candidate = null; this.pending = false; this.work = null;
      this.currentRecipe = null; this.lastClock = null;
      this.active = false; this.stopping = false;
      this.plotModal?.close(); this.plot?.destroy(); this.plotModal = null; this.plot = null;
      this.panel?.remove(); this.panel = null; this.statusEl = null;
      this.slider = null; this.targetLabel = null; this.budgetSelect = null; this.stepBudgetSelect = null;
      this.applyButton = null; this.moreButton = null; this.copyButton = null;
      this.host.onChange();
    }
  }

  async applyBest(): Promise<boolean> {
    if (!this.active || !this.bestRecipe || !this.owned() || this.pending) return false;
    const recipe = copyRecipe3(this.bestRecipe);
    await this.stop();
    if (!this.saved || this.host.sim() !== this.saved.sim || this.host.contextKey() !== this.saved.key || getSeed() !== recipe.seed) return false;
    try { await this.host.applyRecipe(recipe); return true; }
    catch (error) {
      this.status = `Recipe was not applied: ${message(error)}`;
      if (this.saved && this.host.sim() === this.saved.sim && this.host.contextKey() === this.saved.key) {
        this.buildRefusal(); this.host.onChange();
      }
      return false;
    }
  }

  shareBestLink(): string | null {
    return this.bestRecipe && this.owned() ? this.host.shareRecipeLink(copyRecipe3(this.bestRecipe)) : null;
  }

  private buildRefusal() {
    this.panel?.remove();
    const p = document.createElement("div"); p.id = "optimizer3d"; p.className = "modepanel plate tpanel";
    const note = document.createElement("div"); note.className = "pnote"; note.textContent = this.status;
    p.append(panelHead("3D OPTIMIZER", pill("close", () => { p.remove(); this.panel = null; })), note);
    document.getElementById("app")!.append(p); this.panel = p;
  }

  private buildPanel() {
    this.panel?.remove();
    const p = document.createElement("div"); p.id = "optimizer3d"; p.dataset.dimension = "3d"; p.className = "modepanel plate tpanel";
    const label = document.createElement("span"); this.targetLabel = label;
    const head = panelHead("3D OPTIMIZER", pill("exit", () => { void this.stop(); }), label);
    this.learn = new LearnLayer(() => this.applyLearn());
    const explain = this.learn.explain(head, "about the 3D optimizer", panelText("optimizer3d"), label);
    const slider = document.createElement("input"); slider.type = "range"; slider.id = "opt3Target";
    slider.setAttribute("aria-label", `Target volume-equivalent grain diameter in ${this.unit}`);
    const edge = this.saved!.sim.n * (this.known ? this.saved!.pitch : 1);
    slider.min = String(.08 * edge); slider.max = String(.55 * edge); slider.step = String(.005 * edge); slider.value = String(this.target);
    slider.addEventListener("input", () => this.setTarget(Number(slider.value)));
    head.insertBefore(slider, head.lastElementChild); this.slider = slider; paintRange(slider); this.paintTarget();
    const note = document.createElement("div"); note.className = "pnote q";
    note.innerHTML = `${this.saved!.sim.n}³ · ${esc(OPT3_CAVEATS.intro.line)} · twins off`
      + learnSlot(OPT3_CAVEATS.intro.learn)
      + `<br>${esc(OPT3_CAVEATS.metric.line)}` + learnSlot(OPT3_CAVEATS.metric.learn)
      + `<br>${esc(OPT3_CAVEATS.model.line)}` + learnSlot(OPT3_CAVEATS.model.learn);
    const budget = document.createElement("label"); budget.className = "pnote q"; budget.textContent = "casting budget ";
    const select = document.createElement("select"); select.id = "opt3Budget"; select.setAttribute("aria-label", "3D casting budget");
    this.budgetSelect = select;
    for (const n of [...new Set([4, 8, 16, 32, 64, this.limit])].sort((a, b) => a - b)) {
      const o = document.createElement("option"); o.value = String(n); o.textContent = String(n); select.append(o);
    }
    select.value = String(this.limit); select.addEventListener("change", () => {
      if (this.running || this.pending || this.stopping || this.episode > 0) { select.value = String(this.limit); return; }
      this.limit = Number(select.value);
    }); budget.append(select);
    const stepLabel = document.createElement("label"); stepLabel.className = "pnote q"; stepLabel.textContent = " steps per casting ";
    const stepSelect = document.createElement("select"); stepSelect.id = "opt3StepBudget"; stepSelect.setAttribute("aria-label", "3D substep budget per casting");
    this.stepBudgetSelect = stepSelect;
    for (const n of [...new Set([3000, 9000, 18000, 30000, 60000, 100000, this.maxSteps])].sort((a, b) => a - b)) {
      const o = document.createElement("option"); o.value = String(n); o.textContent = String(n); stepSelect.append(o);
    }
    stepSelect.value = String(this.maxSteps); stepSelect.addEventListener("change", () => {
      if (this.running || this.pending || this.stopping) { stepSelect.value = String(this.maxSteps); return; }
      this.maxSteps = Number(stepSelect.value); this.setTarget(this.target);
    }); stepLabel.append(stepSelect); budget.append(stepLabel);
    const strip = document.createElement("div"); strip.className = "ostrip"; this.strip = strip;
    const chart = document.createElement("div"); chart.className = "processplot"; chart.style.cssText = "width:100%;height:220px;min-width:0";
    this.plot = new PlotView(chart, { id: "opt3ConvergencePlot", label: "3D optimizer convergence; open figure and data", onOpen: () => {
      if (!this.figure()) return;
      this.plotModal?.close(); this.plotModal = openFigure(() => this.figure()!);
    } });
    const report = document.createElement("div"); report.id = "opt3Report"; report.className = "oreport"; report.style.display = "none"; this.report = report;
    const status = document.createElement("div"); status.id = "opt3Status"; status.className = "pstatus q"; this.statusEl = status;
    p.append(head, explain.body, note, budget, strip, chart, report, status);
    document.getElementById("app")!.append(p); this.panel = p; this.paintPlot(); this.applyLearn(); this.syncControls();
  }

  private paintTarget() {
    if (this.targetLabel) this.targetLabel.textContent = `target d ${this.target.toFixed(1)} ${this.unit}`;
    if (this.slider) paintRange(this.slider);
  }
  private updateStatus(value: string) { this.status = value; if (this.statusEl) this.statusEl.textContent = value; }

  private syncControls() {
    const busy = this.running || this.pending || this.stopping;
    if (this.budgetSelect) {
      this.budgetSelect.disabled = busy || this.episode > 0;
      this.budgetSelect.title = this.budgetSelect.disabled ? "Set the casting budget before the first casting." : "Maximum castings in this search.";
    }
    if (this.stepBudgetSelect) {
      this.stepBudgetSelect.disabled = busy;
      this.stepBudgetSelect.title = busy ? "Pause and wait for the current batch before changing its budget."
        : "Changing this budget starts a fresh search.";
    }
    if (this.applyButton) this.applyButton.disabled = !this.bestRecipe || this.pending || this.stopping;
    if (this.moreButton) this.moreButton.disabled = this.limit >= 64 || this.pending || this.stopping;
    if (this.copyButton) this.copyButton.disabled = !this.bestRecipe || this.pending || this.stopping;
  }

  private showReport(error?: string) {
    if (!this.report) return;
    const best = this.bestRecipe;
    this.report.innerHTML = `<div class="psub">${error ? "search stopped" : "casting budget complete"}</div>`
      + (error ? `<div class="pnote">${esc(error)}</div>` : "")
      + (best ? `<div class="kv">${kv("best", `${num(best.diameter!.toFixed(2))} ${best.unit} · target ${num(best.target.toFixed(2))} · error ${num((100 * this.best).toFixed(1))}%`)}${kv("recipe", `undercooling ${num(best.undercool.toFixed(3))} · ${num(best.nmax)} sites · cooling ${best.cool.map(v => num(v.toFixed(3))).join(" → ")}`)}</div>`
        : `<div class="pnote">No completed finite grain census was ranked. Increase the casting step budget or adjust the setup.</div>`);
    const actions = document.createElement("div"); actions.className = "pactions";
    const apply = pill("apply recipe", () => { void this.applyBest(); }, "accent"); apply.disabled = !best;
    this.applyButton = apply;
    const more = pill("keep searching", () => this.setRunning(true)); more.disabled = this.limit >= 64;
    this.moreButton = more;
    const link = pill("copy recipe link", () => {
      const url = this.shareBestLink(); if (!url) return;
      void navigator.clipboard.writeText(url).then(() => { link.textContent = "copied"; }, () => { link.textContent = "copy failed"; });
    }); link.disabled = !best;
    this.copyButton = link;
    actions.append(apply, more, link); this.report.append(actions); this.report.style.display = "block";
    this.updateStatus(error ? `paused · ${error}` : `paused on result · ${this.history.filter(r => r.valid).length}/${this.history.length} valid castings`);
    this.syncControls();
  }

  private figure(): Figure | null {
    if (!this.bridge || !this.prov) return null;
    const xs = this.history.map(r => r.episode), errors = this.history.map(r => r.error == null ? NaN : r.error * 100);
    const best = this.history.map(r => r.best == null ? NaN : r.best * 100), [lo, hi] = extent([errors, best], { include: [0], pad: .1 });
    return { title: "3D optimizer convergence", bridge: this.bridge,
      fig: { x: { title: "Casting n (count)", short: "n (count)", sym: "n", unit: "count", lo: 0, hi: Math.max(1, xs.at(-1) ?? 0) },
        panels: [{ y: { title: "Relative diameter error |Δd|/d_target (%)", short: "diameter error (%)", lo, hi }, series: [
          { key: "error", label: "casting", slot: 1, xs, ys: errors, kind: "dots", sym: "error", unit: "%" },
          { key: "best", label: "best so far", slot: 0, xs, ys: best, sym: "best", unit: "%" },
        ], refs: [{ y: 0, label: "target" }] }], empty: this.history.length ? null : "run to measure 3D castings" },
      columns: [
        { key: "casting", q: { kind: "count", sym: "n", name: "Casting" }, values: xs },
        { key: "relative_diameter_error", q: { kind: "dimless", sym: "|Δd|/d_target", name: "Relative diameter error" }, values: this.history.map(r => r.error ?? NaN) },
        { key: "best_relative_error", q: { kind: "dimless", sym: "best", name: "Best relative diameter error" }, values: this.history.map(r => r.best ?? NaN) },
        { key: "diameter_cells", q: { kind: "dimless", sym: "d_cells", name: "Volume-equivalent diameter in cells" }, values: this.history.map(r => r.diameterCells ?? NaN) },
        { key: "diameter", q: { kind: "length", sym: "d", name: "Volume-equivalent diameter" }, values: this.history.map(r => r.diameterCells == null ? NaN : r.diameterCells * this.saved!.pitch) },
        { key: "solid_fraction", q: { kind: "fraction", sym: "f_s", name: "Solid fraction" }, values: this.history.map(r => r.fracSolid) },
        { key: "grain_count", q: { kind: "count", sym: "N", name: "Censused grains" }, values: this.history.map(r => r.grainCount) },
        { key: "delivered_steps", q: { kind: "count", sym: "N_steps", name: "Delivered substeps" }, values: this.history.map(r => r.deliveredSteps) },
        { key: "valid_casting", q: { kind: "dimless", sym: "valid", name: "Valid completed census" }, values: this.history.map(r => r.valid ? 1 : 0) },
      ], prov: { ...this.prov, recorded: this.history.length, extra: [...(this.prov.extra ?? []),
        `Target volume-equivalent censused-grain diameter ${this.target} ${this.unit}; relative error is |d/target−1|.`,
        "Incomplete castings and missing/nonfinite censuses are not eligible best recipes. Their chart errors are blank; no manufacturing guarantee or 2D ASTM number is inferred.",
      ] } };
  }
  private paintPlot() { const fig = this.figure(); if (fig) this.plot?.set(fig.fig); this.plotModal?.update(); }
  exportFigures(): Figure[] { const figure = this.figure(); return figure && this.history.length ? [figure] : []; }

  snapshot() {
    return { active: this.active, running: this.running, pending: this.pending || this.stopping,
      episode: this.episode, stepsUsed: this.clock?.snapshot().deliveredSteps ?? this.history.at(-1)?.deliveredSteps ?? 0,
      totalSteps: this.totalSteps, target: this.target, known: this.known, unit: this.unit, grid: this.saved?.sim.n ?? null,
      pitch: this.saved?.pitch ?? null, seed: this.saved?.seed ?? null, limit: this.limit, maxSteps: this.maxSteps,
      candidate: this.candidate ? copyRecipe3(this.candidate) : null,
      currentRecipe: this.currentRecipe ? copyRecipe3(this.currentRecipe) : null,
      clock: this.clock?.snapshot() ?? (this.lastClock ? { ...this.lastClock,
        stats: this.lastClock.stats ? { ...this.lastClock.stats, grains: this.lastClock.stats.grains.map(grain => ({ ...grain })) } : null } : null),
      history: this.history.map(row => ({ ...row })), bestRecipe: this.bestRecipe ? copyRecipe3(this.bestRecipe) : null, status: this.status };
  }
}
