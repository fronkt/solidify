/**
 * EUTECTIC — 2D binary lamellar eutectic mode (Folch–Plapp 2005 + Jackson–Hunt 1966).
 *
 * Rail-swapped inspector (`#eutectic.railmode` mounted inside `#railModeHost`)
 * following Figure-03 conventions: pure achromatic chrome, shared `#views` top
 * lens bar and `#transport` bottom-left playback bar, live Jackson–Hunt `ΔT(λ)`
 * plot via `PlotView` + `openFigure`, live lamellar diagnostics, CSV export,
 * and honest model caveats.
 */

import {
  EUTECTIC_ALLOYS,
  EUTECTIC_DEFAULTS,
  EutecticRenderer,
  EutecticSim,
  jacksonHuntModel,
  type EutecticAlloy,
  type EutecticAlloyId,
  type EutecticLens,
  type EutecticParams,
  type EutecticStats,
  type JacksonHuntModel,
} from "./eutectic";
import { jacksonHuntFigure } from "./plot/eutectic";
import type { Figure } from "./plot/figures";
import { PlotView } from "./plot/view";
import { download, openFigure, type FigureHandle } from "./plot/modal";
import { formatEutecticCsv, type RunEutecticExport } from "./run-export";
import { range, select } from "./formbits";
import { panelHead, pill } from "./design/panel";
import { LearnLayer, onLearnChange } from "./learn";
import { panelHintFor, panelText } from "./learn/panels";

export interface EutecticHost {
  device: GPUDevice;
  canvas: HTMLCanvasElement;
  onClose(): void;
  onSync(): void;
  getMaterial(): string;
}

const ALLOY_ORDER: readonly EutecticAlloyId[] = ["alcu", "pbsn", "alsi", "symmetric"];
const SUBSTEPS_PER_FRAME = 48;
const DIAG_INTERVAL_MS = 240;

const MINUS = "\u2212";

function fmtGradVal(v: number, sym: boolean): string {
  const num = Math.abs(v - Math.round(v)) < 1e-6 ? v.toFixed(0) : v.toFixed(1);
  return sym ? `${num} sim` : `${num} K/mm`;
}

function fmtNum(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(digits);
}

function fmtSigned(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.5 * Math.pow(10, -digits)) return (0).toFixed(digits);
  return `${v < 0 ? MINUS : "+"}${Math.abs(v).toFixed(digits)}`;
}

function defaultAlloyForMaterial(matKey: string): EutecticAlloyId {
  const k = (matKey || "").trim().toLowerCase();
  if (k === "al") return "alcu";
  return EUTECTIC_DEFAULTS.alloy;
}

export class EutecticPanel {
  private host: EutecticHost;
  private params: EutecticParams;
  private explicitInitial: boolean;
  private _open = false;
  private _running = false;
  private speedMult = 1;
  private simInst: EutecticSim | null = null;
  private rendererInst: EutecticRenderer | null = null;
  private stats: EutecticStats | null = null;
  private diagPending = false;
  private lastDiagMs = 0;

  private panel: HTMLElement | null = null;
  private metaAlloyEl: HTMLElement | null = null;
  private alloySelect: HTMLSelectElement | null = null;
  private pullValEl: HTMLElement | null = null;
  private gradValEl: HTMLElement | null = null;
  private statEls: Record<string, HTMLElement> = {};
  private alloyCaveatEl: HTMLElement | null = null;
  private jhPlot: PlotView | null = null;
  private jhModal: FigureHandle | null = null;
  private jhFigure: Figure | null = null;

  private learn = new LearnLayer(() => this.syncLearn());

  constructor(host: EutecticHost, initialAlloy?: EutecticAlloyId) {
    this.host = host;
    this.explicitInitial = initialAlloy !== undefined;
    this.params = {
      ...EUTECTIC_DEFAULTS,
      ...(initialAlloy ? { alloy: initialAlloy } : {}),
    };
    onLearnChange(() => this.syncLearn());
  }

  get running(): boolean {
    return this._running;
  }

  setRunning(on: boolean): void {
    if (!this._open) return;
    this._running = on;
    if (this._running) this.requestDiagnostics(false);
    this.host.onSync();
  }

  reset(): void {
    if (!this._open || !this.simInst) return;
    this.stats = null;
    this.simInst.reset(this.params);
    this.rendererInst?.rebind(this.simInst);
    this.rendererInst?.render(this.simInst);
    this.requestDiagnostics(true);
    this.updateReadouts();
    this.updatePlot();
    this.host.onSync();
  }

  setLens(lens: EutecticLens): void {
    const next: EutecticLens = lens === 1 || lens === 2 ? lens : 0;
    this.params = { ...this.params, lens: next };
    if (this.rendererInst) {
      this.rendererInst.lens = next;
      if (this.simInst) this.rendererInst.render(this.simInst);
    }
    this.host.onSync();
  }

  getLens(): EutecticLens {
    return this.params.lens;
  }

  setSpeedMult(mult: number): void {
    this.speedMult = Math.max(1, Math.min(4, Math.round(mult) || 1));
  }

  getAlloyLabel(): string {
    return this.currentAlloy().label;
  }

  isOpen(): boolean {
    return this._open;
  }

  sim(): EutecticSim | null {
    return this.simInst;
  }

  getStats(): EutecticStats | null {
    return this.stats;
  }

  exportFigures(): Figure[] {
    return this._open && this.jhFigure ? [this.jhFigure] : [];
  }

  syncLearn(): void {
    if (!this.panel) return;
    this.learn.apply();
  }

  setAlloy(id: EutecticAlloyId): void {
    if (!(id in EUTECTIC_ALLOYS)) return;
    this.explicitInitial = true;
    this.params = { ...this.params, alloy: id };
    if (this.alloySelect) this.alloySelect.value = EUTECTIC_ALLOYS[id].label;
    if (this.metaAlloyEl) this.metaAlloyEl.textContent = EUTECTIC_ALLOYS[id].label;
    if (this.simInst) {
      this.stats = null;
      this.simInst.reset(this.params);
      this.rendererInst?.rebind(this.simInst);
      this.rendererInst?.render(this.simInst);
      this.requestDiagnostics(true);
    }
    this.updateCaveats();
    this.updateReadouts();
    this.updatePlot();
    if (this._open) this.host.onSync();
  }

  open(): void {
    if (this._open) return;
    if (!this.explicitInitial) {
      this.params = {
        ...this.params,
        alloy: defaultAlloyForMaterial(this.host.getMaterial()),
      };
    }
    this._open = true;
    this._running = true;
    this.stats = null;
    this.diagPending = false;
    this.lastDiagMs = 0;

    this.simInst = new EutecticSim(this.host.device, this.params);
    this.rendererInst = new EutecticRenderer(this.host.device, this.host.canvas, this.simInst);
    this.rendererInst.lens = this.params.lens;

    this.buildPanel();
    this.rendererInst.render(this.simInst);
    this.requestDiagnostics(true);
    this.host.onSync();
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this._running = false;
    this.diagPending = false;
    this.jhModal?.close();
    this.jhModal = null;
    this.jhPlot?.destroy();
    this.jhPlot = null;
    this.jhFigure = null;
    this.rendererInst?.dispose();
    this.rendererInst = null;
    this.simInst?.dispose();
    this.simInst = null;
    this.panel?.remove();
    this.panel = null;
    this.metaAlloyEl = null;
    this.alloySelect = null;
    this.pullValEl = null;
    this.gradValEl = null;
    this.statEls = {};
    this.alloyCaveatEl = null;
    this.host.onClose();
    this.host.onSync();
  }

  tick(): void {
    if (!this._open || !this.simInst || !this.rendererInst) return;
    if (this._running) {
      this.simInst.step(SUBSTEPS_PER_FRAME * this.speedMult);
    }
    this.rendererInst.render(this.simInst);
    const now = performance.now();
    if (!this.diagPending && (now - this.lastDiagMs >= DIAG_INTERVAL_MS || !this.stats)) {
      this.requestDiagnostics(false);
    }
  }

  exportPayload(): RunEutecticExport | null {
    if (!this._open && !this.stats) return null;
    const alloy = EUTECTIC_ALLOYS[this.params.alloy];
    const jh = this.currentJh();
    const st = this.stats;
    return {
      alloy: alloy.label,
      pullVUmS: this.params.pullV,
      c0Off: this.params.c0Off,
      gradGKmm: this.params.gradG,
      lambdaUm: st?.lambdaUm ?? null,
      lambdaMinUm: alloy.id === "symmetric" ? jh.lambdaMinCells : jh.lambdaMinUm,
      lambda2VUm3s: st?.lambda2VUm3s ?? null,
      fAlpha: st?.fAlpha ?? jh.fAlpha,
      fAlphaLever: jh.fAlpha,
      dTFrontK: st ? (alloy.id === "symmetric" ? st.dTFrontSim : st.dTFrontK) : 0,
      dTMinK: alloy.id === "symmetric" ? jh.dTMinSim : jh.dTMinK,
      meanC: st?.meanC ?? this.params.c0Off,
      step: st?.step ?? 0,
    };
  }

  exportCsv(): string {
    const payload = this.exportPayload();
    if (!payload) {
      const alloy = EUTECTIC_ALLOYS[this.params.alloy];
      const jh = this.currentJh();
      return formatEutecticCsv({
        alloy: alloy.label,
        pullVUmS: this.params.pullV,
        c0Off: this.params.c0Off,
        gradGKmm: this.params.gradG,
        lambdaUm: null,
        lambdaMinUm: alloy.id === "symmetric" ? jh.lambdaMinCells : jh.lambdaMinUm,
        lambda2VUm3s: null,
        fAlpha: jh.fAlpha,
        fAlphaLever: jh.fAlpha,
        dTFrontK: 0,
        dTMinK: alloy.id === "symmetric" ? jh.dTMinSim : jh.dTMinK,
        meanC: this.params.c0Off,
        step: 0,
      });
    }
    return formatEutecticCsv(payload);
  }

  // ---------------------------------------------------------------- internals

  private currentAlloy(): EutecticAlloy {
    return EUTECTIC_ALLOYS[this.params.alloy];
  }

  private currentJh(): JacksonHuntModel {
    return jacksonHuntModel(this.params.alloy, this.params.pullV, this.params.c0Off);
  }

  private requestDiagnostics(force: boolean): void {
    if (!this._open || !this.simInst) return;
    if (this.diagPending && !force) return;
    const targetSim = this.simInst;
    this.diagPending = true;
    this.lastDiagMs = performance.now();
    void targetSim
      .readDiagnostics()
      .then(st => {
        if (!this._open || this.simInst !== targetSim) return;
        this.stats = st;
        this.updateReadouts();
        this.updatePlot();
      })
      .catch(() => {
        // ignore transient readback cancellation on close/reset
      })
      .finally(() => {
        if (this.simInst === targetSim) this.diagPending = false;
      });
  }

  private buildPanel(): void {
    this.jhModal?.close();
    this.jhModal = null;
    this.jhPlot?.destroy();
    this.jhPlot = null;
    this.panel?.remove();

    const p = document.createElement("div");
    p.id = "eutectic";
    p.className = "railmode";

    const alloy = this.currentAlloy();
    const meta = document.createElement("span");
    meta.append(document.createTextNode("2D Folch–Plapp · "));
    const metaAlloy = document.createElement("b");
    metaAlloy.id = "eutAlloyMeta";
    metaAlloy.textContent = alloy.label;
    meta.append(metaAlloy);
    this.metaAlloyEl = metaAlloy;

    const exitBtn = pill("exit", () => this.close());
    const head = panelHead("EUTECTIC", exitBtn, meta);
    this.learn = new LearnLayer(() => this.syncLearn());
    const ex = this.learn.explain(head, "about eutectic", panelText("eutectic"), meta);

    // Controls form (single-column inside #rail)
    const form = document.createElement("div");
    form.className = "fbform";
    const cell = (row: HTMLElement): HTMLElement => {
      const w = document.createElement("div");
      w.append(row);
      panelHintFor(this.learn, "eutectic", row);
      return w;
    };

    const alloyLabels = ALLOY_ORDER.map(id => EUTECTIC_ALLOYS[id].label);
    const alloyRow = select("alloy", alloyLabels, alloy.label, label => {
      const next = ALLOY_ORDER.find(id => EUTECTIC_ALLOYS[id].label === label);
      if (next) this.setAlloy(next);
    });
    this.alloySelect = alloyRow.querySelector<HTMLSelectElement>("select");

    const pullRow = range(
      "pull speed V",
      1,
      200,
      1,
      this.params.pullV,
      v => {
        this.params = { ...this.params, pullV: v };
        this.simInst?.setParams({ pullV: v });
        this.updateReadouts();
        this.updatePlot();
      },
      0,
      v => (this.params.alloy === "symmetric" ? `${v.toFixed(0)} sim` : `${v.toFixed(0)} µm/s`),
    );
    this.pullValEl = pullRow.querySelector<HTMLElement>(".fbval");

    const compRow = range(
      "composition c₀",
      -0.25,
      0.25,
      0.01,
      this.params.c0Off,
      v => {
        this.params = { ...this.params, c0Off: v };
        this.simInst?.setParams({ c0Off: v });
        this.updateReadouts();
        this.updatePlot();
      },
      2,
      v => fmtSigned(v, 2),
    );

    const gradRow = range(
      "gradient G",
      0.5,
      100,
      0.5,
      this.params.gradG,
      v => {
        this.params = { ...this.params, gradG: v };
        this.simInst?.setParams({ gradG: v });
        this.updateReadouts();
        this.updatePlot();
      },
      1,
      v => fmtGradVal(v, this.params.alloy === "symmetric"),
    );
    this.gradValEl = gradRow.querySelector<HTMLElement>(".fbval");

    const pairsRow = range(
      "seed pairs",
      2,
      16,
      1,
      this.params.seedPairs,
      v => {
        const seedPairs = Math.round(v);
        this.params = { ...this.params, seedPairs };
        if (this.simInst) {
          this.stats = null;
          this.simInst.reset(this.params);
          this.rendererInst?.rebind(this.simInst);
          this.rendererInst?.render(this.simInst);
          this.requestDiagnostics(true);
        }
        this.updateReadouts();
        this.updatePlot();
      },
      0,
      v => `${Math.round(v)} pairs`,
    );

    form.append(cell(alloyRow), cell(pullRow), cell(compRow), cell(gradRow), cell(pairsRow));

    // Action bar: outline export csv (#transport owns run/pause/reset; #views owns lenses)
    const bar = document.createElement("div");
    bar.className = "eut__bar railmode__bar";
    const csvBtn = pill("export csv", () => {
      const csv = this.exportCsv();
      download(`solidify-eutectic-${this.params.alloy}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
    });
    bar.append(csvBtn);

    // Single-column live spec-rail readouts
    const statsGrid = document.createElement("div");
    statsGrid.id = "eutStats";
    statsGrid.className = "eut__stats";
    this.statEls = {};
    const statDefs: readonly [string, string][] = [
      ["lambda", "spacing λ"],
      ["jhMin", "JH λ_min"],
      ["lambda2V", "λ²V"],
      ["fAlpha", "phase f_α"],
      ["dTFront", "front ΔT"],
      ["meanC", "solute ⟨c⟩"],
    ];
    for (const [key, label] of statDefs) {
      const row = document.createElement("div");
      row.className = "eut__stat";
      const k = document.createElement("span");
      k.className = "q";
      k.textContent = label;
      const v = document.createElement("span");
      v.className = "v";
      v.textContent = "—";
      row.append(k, v);
      statsGrid.append(row);
      this.statEls[key] = v;
    }

    // Embedded Jackson–Hunt ΔT(λ) PlotView (clickable to open enlarged modal)
    const plotWrap = document.createElement("div");
    plotWrap.className = "eut__plot";
    this.jhPlot = new PlotView(plotWrap, {
      id: "eutJhPlot",
      label: "Jackson–Hunt eutectic spacing curve; open figure and data",
      onOpen: () => {
        if (!this.jhFigure) return;
        this.jhModal?.close();
        this.jhModal = openFigure(() => this.jhFigure!);
      },
    });

    // Honest model caveats (base isotropic diffuse-interface note + alloy-specific caveat)
    const baseCaveat = document.createElement("div");
    baseCaveat.className = "eut__caveat q";
    baseCaveat.textContent =
      "Folch–Plapp (2005) 2D isotropic diffuse-interface model; interface width is enlarged for interactive GPU stepping.";

    const alloyCaveat = document.createElement("div");
    alloyCaveat.id = "eutCaveat";
    alloyCaveat.className = "eut__caveat warnline";
    this.alloyCaveatEl = alloyCaveat;

    p.append(head, ex.body, form, bar, statsGrid, plotWrap, baseCaveat, alloyCaveat);
    const mount = document.getElementById("railModeHost") ?? document.getElementById("rail") ?? document.getElementById("app")!;
    mount.append(p);
    this.panel = p;

    this.updateCaveats();
    this.updateReadouts();
    this.updatePlot();
    this.syncLearn();
  }

  private updateCaveats(): void {
    if (!this.alloyCaveatEl) return;
    const alloy = this.currentAlloy();
    if (alloy.caveat) {
      this.alloyCaveatEl.textContent = alloy.caveat;
      this.alloyCaveatEl.style.display = "block";
    } else {
      this.alloyCaveatEl.textContent = "";
      this.alloyCaveatEl.style.display = "none";
    }
  }

  private updateReadouts(): void {
    if (!this.panel) return;
    const alloy = this.currentAlloy();
    const sym = alloy.id === "symmetric";
    const jh = this.currentJh();
    const st = this.stats;

    if (this.pullValEl) {
      this.pullValEl.textContent = sym ? `${this.params.pullV.toFixed(0)} sim` : `${this.params.pullV.toFixed(0)} µm/s`;
    }
    if (this.gradValEl) {
      this.gradValEl.textContent = fmtGradVal(this.params.gradG, sym);
    }

    const set = (k: string, text: string) => {
      const el = this.statEls[k];
      if (el) el.textContent = text;
    };

    const lamVal = sym ? st?.lambdaCells ?? null : st?.lambdaUm ?? null;
    const lamUnit = sym ? "cells" : "µm";
    set("lambda", lamVal != null && Number.isFinite(lamVal) ? `${fmtNum(lamVal)} ${lamUnit}` : "—");

    const minVal = sym ? jh.lambdaMinCells : jh.lambdaMinUm;
    set("jhMin", `${fmtNum(minVal)} ${lamUnit}`);

    if (st && st.lambda2VUm3s != null && Number.isFinite(st.lambda2VUm3s)) {
      set("lambda2V", sym ? `${fmtNum(st.lambda2VUm3s)} sim` : `${fmtNum(st.lambda2VUm3s, 1)} µm³/s`);
    } else {
      set("lambda2V", "—");
    }

    if (st && st.valid) {
      set("fAlpha", `${(st.fAlpha * 100).toFixed(1)} % (lever ${(jh.fAlpha * 100).toFixed(1)} %)`);
    } else {
      set("fAlpha", `lever ${(jh.fAlpha * 100).toFixed(1)} %`);
    }

    if (st && st.valid) {
      const dtVal = sym ? st.dTFrontSim : st.dTFrontK;
      set("dTFront", `${fmtNum(dtVal)} ${sym ? "sim" : "K"}`);
      set("meanC", `${fmtSigned(st.meanC, 3)} · step ${st.step.toLocaleString()}`);
    } else {
      set("dTFront", "—");
      set("meanC", "—");
    }
  }

  private updatePlot(): void {
    if (!this.jhPlot) return;
    const alloy = this.currentAlloy();
    const sym = alloy.id === "symmetric";
    const jh = this.currentJh();
    const st = this.stats;
    const live = st && st.valid
      ? {
          lambdaUm: sym ? st.lambdaCells : st.lambdaUm,
          dTK: sym ? st.dTFrontSim : st.dTFrontK,
        }
      : undefined;
    const fig = jacksonHuntFigure(alloy, jh, this.params.pullV, live);
    this.jhFigure = fig;
    this.jhPlot.set(fig.fig);
    this.jhModal?.update();
  }
}
