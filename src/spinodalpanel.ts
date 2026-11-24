/**
 * SPINODAL — 2D/3D conserved Cahn–Hilliard spinodal decomposition mode
 * (Cahn & Hilliard 1958 + Lifshitz & Slyozov 1961 + NIST PFHub Benchmark 1).
 *
 * Rail-swapped inspector (`#spinodal.railmode` mounted inside `#railModeHost`)
 * following Figure-03 conventions: pure achromatic chrome, shared `#views` top
 * lens bar and `#transport` bottom-left playback bar, 2D / 3D toggle with
 * canvas pointer-drag orbit in 3D, live `F(t)` and `L(t)` diagnostics via
 * `PlotView` + `openFigure`, CSV export, and honest caveats.
 */

import {
  SPINODAL_DEFAULTS,
  SPINODAL_PRESETS,
  SpinodalRenderer,
  SpinodalSim,
  type SpinodalDim,
  type SpinodalLens,
  type SpinodalParams,
  type SpinodalPreset,
  type SpinodalPresetId,
  type SpinodalStats,
} from "./spinodal";
import { spinodalFigure, type SpinodalPlotMode } from "./plot/spinodal";
import type { Figure } from "./plot/figures";
import { PlotView } from "./plot/view";
import { download, openFigure, type FigureHandle } from "./plot/modal";
import { formatSpinodalCsv, type RunSpinodalExport } from "./run-export";
import { range, select } from "./formbits";
import { paintRange } from "./design/tool";
import { panelHead, pill } from "./design/panel";
import { LearnLayer, onLearnChange } from "./learn";
import { panelHintFor, panelText } from "./learn/panels";

export interface SpinodalHost {
  device: GPUDevice;
  canvas: HTMLCanvasElement;
  onClose(): void;
  onSync(): void;
  getMaterial(): string;
}

const PRESET_ORDER: readonly SpinodalPresetId[] = ["pfhub1", "fecr", "alzn", "offcrit"];
const SUBSTEPS_2D = 64;
const SUBSTEPS_3D = 24;
const DIAG_INTERVAL_MS = 260;

function fmtNum(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(digits);
}

function fmtEnergy(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e5 || (a > 0 && a < 1e-2)) return v.toExponential(3);
  if (a >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtDrift(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a === 0) return "Δ 0";
  if (a < 1e-3) return `Δ ${a.toExponential(1)}`;
  return `Δ ${a.toFixed(4)}`;
}

function defaultPresetForMaterial(matKey: string): SpinodalPresetId {
  const k = (matKey || "").trim().toLowerCase();
  if (k === "steel") return "fecr";
  if (k === "al" || k === "zn") return "alzn";
  return SPINODAL_DEFAULTS.preset;
}

export class SpinodalPanel {
  private host: SpinodalHost;
  private params: SpinodalParams;
  private explicitInitial: boolean;
  private _open = false;
  private _running = false;
  private speedMult = 1;
  private plotMode: SpinodalPlotMode = "energy";
  private simInst: SpinodalSim | null = null;
  private rendererInst: SpinodalRenderer | null = null;
  private stats: SpinodalStats | null = null;
  private diagPending = false;
  private lastDiagMs = 0;

  private panel: HTMLElement | null = null;
  private metaEl: HTMLElement | null = null;
  private presetSelect: HTMLSelectElement | null = null;
  private c0Input: HTMLInputElement | null = null;
  private c0ValEl: HTMLElement | null = null;
  private kappaInput: HTMLInputElement | null = null;
  private kappaValEl: HTMLElement | null = null;
  private mobInput: HTMLInputElement | null = null;
  private mobValEl: HTMLElement | null = null;
  private dimBtns: Record<SpinodalDim, HTMLButtonElement | null> = { "2d": null, "3d": null };
  private plotBtns: Record<SpinodalPlotMode, HTMLButtonElement | null> = { energy: null, coarsening: null };
  private statEls: Record<string, HTMLElement> = {};
  private noteEl: HTMLElement | null = null;
  private plotView: PlotView | null = null;
  private plotModal: FigureHandle | null = null;
  private currentFigure: Figure | null = null;

  private learn = new LearnLayer(() => this.syncLearn());

  // 3D canvas pointer-drag orbit state (bound on open, removed on close)
  private orbitAttached = false;
  private orbitDragging = false;
  private orbitPointerId = -1;
  private orbitLastX = 0;
  private orbitLastY = 0;

  private onCanvasPointerDown = (e: PointerEvent): void => {
    if (!this._open || this.params.dim !== "3d" || e.button !== 0) return;
    this.orbitDragging = true;
    this.orbitPointerId = e.pointerId;
    this.orbitLastX = e.clientX;
    this.orbitLastY = e.clientY;
    try {
      this.host.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer events without active capture
    }
    e.preventDefault();
  };

  private onCanvasPointerMove = (e: PointerEvent): void => {
    if (!this.orbitDragging || !this._open || this.params.dim !== "3d") return;
    if (this.orbitPointerId >= 0 && e.pointerId !== this.orbitPointerId) return;
    const dx = e.clientX - this.orbitLastX;
    const dy = e.clientY - this.orbitLastY;
    this.orbitLastX = e.clientX;
    this.orbitLastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    this.rendererInst?.orbitBy(dx, dy);
    if (!this._running && this.simInst) this.rendererInst?.render(this.simInst);
    e.preventDefault();
  };

  private onCanvasPointerUp = (e: PointerEvent): void => {
    if (!this.orbitDragging) return;
    if (this.orbitPointerId >= 0 && e.pointerId !== this.orbitPointerId) return;
    this.orbitDragging = false;
    this.orbitPointerId = -1;
    try {
      if (this.host.canvas.hasPointerCapture(e.pointerId)) {
        this.host.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };

  private onCanvasDblClick = (): void => {
    if (!this._open || this.params.dim !== "3d") return;
    this.rendererInst?.resetView();
    if (!this._running && this.simInst) this.rendererInst?.render(this.simInst);
  };

  constructor(
    host: SpinodalHost,
    initialPreset?: SpinodalPresetId,
    initialDim?: SpinodalDim,
  ) {
    this.host = host;
    this.explicitInitial = initialPreset !== undefined;
    const presetId = initialPreset && initialPreset in SPINODAL_PRESETS ? initialPreset : SPINODAL_DEFAULTS.preset;
    const preset = SPINODAL_PRESETS[presetId];
    this.params = {
      ...SPINODAL_DEFAULTS,
      preset: presetId,
      dim: initialDim ?? SPINODAL_DEFAULTS.dim,
      c0: preset.c0,
      kappa: preset.kappa,
      mobility: preset.mobility,
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

  setLens(lens: SpinodalLens): void {
    const next: SpinodalLens = lens === 1 || lens === 2 ? lens : 0;
    this.params = { ...this.params, lens: next };
    if (this.rendererInst) {
      this.rendererInst.lens = next;
      if (this.simInst) this.rendererInst.render(this.simInst);
    }
    this.host.onSync();
  }

  getLens(): SpinodalLens {
    return this.params.lens;
  }

  setSpeedMult(mult: number): void {
    this.speedMult = Math.max(1, Math.min(4, Math.round(mult) || 1));
  }

  getDim(): SpinodalDim {
    return this.params.dim;
  }

  getPresetLabel(): string {
    return this.currentPreset().label;
  }

  getGridN(): number {
    return this.params.dim === "3d" ? this.params.n3d : this.params.n2d;
  }

  isOpen(): boolean {
    return this._open;
  }

  sim(): SpinodalSim | null {
    return this.simInst;
  }

  getStats(): SpinodalStats | null {
    return this.stats;
  }

  exportFigures(): Figure[] {
    return this._open && this.currentFigure ? [this.currentFigure] : [];
  }

  syncLearn(): void {
    if (!this.panel) return;
    this.learn.apply();
  }

  setPreset(id: SpinodalPresetId): void {
    if (!(id in SPINODAL_PRESETS)) return;
    this.explicitInitial = true;
    const preset = SPINODAL_PRESETS[id];
    this.params = {
      ...this.params,
      preset: id,
      c0: preset.c0,
      kappa: preset.kappa,
      mobility: preset.mobility,
    };
    this.syncControls();
    if (this.simInst) {
      this.stats = null;
      this.simInst.reset(this.params);
      this.rendererInst?.rebind(this.simInst);
      this.rendererInst?.render(this.simInst);
      this.requestDiagnostics(true);
    }
    this.updateMetaAndNote();
    this.updateReadouts();
    this.updatePlot();
    if (this._open) this.host.onSync();
  }

  setDim(dim: SpinodalDim): void {
    if (dim !== "2d" && dim !== "3d") return;
    if (this.params.dim === dim && this._open) return;
    this.params = { ...this.params, dim };
    this.orbitDragging = false;
    this.orbitPointerId = -1;
    this.syncDimButtons();
    this.updateCanvasCursor();
    if (this.simInst) {
      this.stats = null;
      this.simInst.reset(this.params);
      if (this.rendererInst) {
        this.rendererInst.lens = this.params.lens;
        this.rendererInst.rebind(this.simInst);
        this.rendererInst.render(this.simInst);
      }
      this.requestDiagnostics(true);
    }
    this.updateMetaAndNote();
    this.updateReadouts();
    this.updatePlot();
    this.host.onSync();
  }

  open(): void {
    if (this._open) return;
    if (!this.explicitInitial) {
      const id = defaultPresetForMaterial(this.host.getMaterial());
      const preset = SPINODAL_PRESETS[id];
      this.params = {
        ...this.params,
        preset: id,
        c0: preset.c0,
        kappa: preset.kappa,
        mobility: preset.mobility,
      };
    }
    this._open = true;
    this._running = true;
    this.stats = null;
    this.diagPending = false;
    this.lastDiagMs = 0;

    this.simInst = new SpinodalSim(this.host.device, this.params);
    this.rendererInst = new SpinodalRenderer(this.host.device, this.host.canvas, this.simInst);
    this.rendererInst.lens = this.params.lens;

    this.buildPanel();
    this.attachCanvasOrbit();
    this.updateCanvasCursor();
    this.rendererInst.render(this.simInst);
    this.requestDiagnostics(true);
    this.host.onSync();
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this._running = false;
    this.diagPending = false;
    this.detachCanvasOrbit();
    this.host.canvas.style.cursor = "";
    this.plotModal?.close();
    this.plotModal = null;
    this.plotView?.destroy();
    this.plotView = null;
    this.currentFigure = null;
    this.rendererInst?.dispose();
    this.rendererInst = null;
    this.simInst?.dispose();
    this.simInst = null;
    this.panel?.remove();
    this.panel = null;
    this.metaEl = null;
    this.presetSelect = null;
    this.c0Input = null;
    this.c0ValEl = null;
    this.kappaInput = null;
    this.kappaValEl = null;
    this.mobInput = null;
    this.mobValEl = null;
    this.dimBtns = { "2d": null, "3d": null };
    this.plotBtns = { energy: null, coarsening: null };
    this.statEls = {};
    this.noteEl = null;
    this.host.onClose();
    this.host.onSync();
  }

  tick(): void {
    if (!this._open || !this.simInst || !this.rendererInst) return;
    if (this._running) {
      const base = this.params.dim === "3d" ? SUBSTEPS_3D : SUBSTEPS_2D;
      this.simInst.step(base * this.speedMult);
    }
    this.rendererInst.render(this.simInst);
    const now = performance.now();
    if (!this.diagPending && (now - this.lastDiagMs >= DIAG_INTERVAL_MS || !this.stats)) {
      this.requestDiagnostics(false);
    }
  }

  exportPayload(): RunSpinodalExport | null {
    if (!this._open && !this.stats) return null;
    const preset = this.currentPreset();
    const st = this.stats;
    const hist = this.simInst?.history ?? [];
    return {
      preset: preset.label,
      dim: this.params.dim,
      n: this.simInst?.n ?? (this.params.dim === "3d" ? this.params.n3d : this.params.n2d),
      c0: this.params.c0,
      kappa: this.params.kappa,
      mobility: this.params.mobility,
      simTime: st?.simTime ?? 0,
      freeEnergy: st?.freeEnergy ?? 0,
      meanC: st?.meanC ?? this.params.c0,
      massDrift: st?.massDrift ?? 0,
      domainL: st?.domainL ?? 0,
      lswSlope: st?.lswSlope ?? null,
      samples: hist.map(s => ({ t: s.t, F: s.F, L: s.L, meanC: s.meanC })),
    };
  }

  exportCsv(): string {
    const payload = this.exportPayload();
    if (payload) return formatSpinodalCsv(payload);
    const preset = this.currentPreset();
    return formatSpinodalCsv({
      preset: preset.label,
      dim: this.params.dim,
      n: this.params.dim === "3d" ? this.params.n3d : this.params.n2d,
      c0: this.params.c0,
      kappa: this.params.kappa,
      mobility: this.params.mobility,
      simTime: 0,
      freeEnergy: 0,
      meanC: this.params.c0,
      massDrift: 0,
      domainL: 0,
      lswSlope: null,
      samples: [],
    });
  }

  // ---------------------------------------------------------------- internals

  private currentPreset(): SpinodalPreset {
    return SPINODAL_PRESETS[this.params.preset];
  }

  private attachCanvasOrbit(): void {
    if (this.orbitAttached) return;
    this.orbitAttached = true;
    this.host.canvas.addEventListener("pointerdown", this.onCanvasPointerDown);
    window.addEventListener("pointermove", this.onCanvasPointerMove);
    window.addEventListener("pointerup", this.onCanvasPointerUp);
    window.addEventListener("pointercancel", this.onCanvasPointerUp);
    this.host.canvas.addEventListener("dblclick", this.onCanvasDblClick);
  }

  private detachCanvasOrbit(): void {
    if (!this.orbitAttached) return;
    this.orbitAttached = false;
    this.orbitDragging = false;
    this.orbitPointerId = -1;
    this.host.canvas.removeEventListener("pointerdown", this.onCanvasPointerDown);
    window.removeEventListener("pointermove", this.onCanvasPointerMove);
    window.removeEventListener("pointerup", this.onCanvasPointerUp);
    window.removeEventListener("pointercancel", this.onCanvasPointerUp);
    this.host.canvas.removeEventListener("dblclick", this.onCanvasDblClick);
  }

  private updateCanvasCursor(): void {
    if (!this._open) return;
    this.host.canvas.style.cursor = this.params.dim === "3d" ? "grab" : "";
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
    this.plotModal?.close();
    this.plotModal = null;
    this.plotView?.destroy();
    this.plotView = null;
    this.panel?.remove();

    const p = document.createElement("div");
    p.id = "spinodal";
    p.className = "railmode";

    const meta = document.createElement("span");
    meta.id = "spinMeta";
    this.metaEl = meta;

    const exitBtn = pill("exit", () => this.close());
    const head = panelHead("SPINODAL", exitBtn, meta);
    this.learn = new LearnLayer(() => this.syncLearn());
    const ex = this.learn.explain(head, "about spinodal", panelText("spinodal"), meta);

    // 4 controls in .fbform (single-column inside #rail)
    const form = document.createElement("div");
    form.className = "fbform";
    const cell = (row: HTMLElement): HTMLElement => {
      const w = document.createElement("div");
      w.append(row);
      panelHintFor(this.learn, "spinodal", row);
      return w;
    };

    const preset = this.currentPreset();
    const presetLabels = PRESET_ORDER.map(id => SPINODAL_PRESETS[id].label);
    const presetRow = select("preset", presetLabels, preset.label, label => {
      const next = PRESET_ORDER.find(id => SPINODAL_PRESETS[id].label === label);
      if (next) this.setPreset(next);
    });
    this.presetSelect = presetRow.querySelector<HTMLSelectElement>("select");

    const c0Row = range(
      "composition c₀",
      0.2,
      0.8,
      0.01,
      this.params.c0,
      v => {
        this.params = { ...this.params, c0: v };
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
      2,
      v => v.toFixed(2),
    );
    this.c0Input = c0Row.querySelector<HTMLInputElement>("input");
    this.c0ValEl = c0Row.querySelector<HTMLElement>(".fbval");

    const kappaRow = range(
      "gradient κ",
      0.5,
      8.0,
      0.1,
      this.params.kappa,
      v => {
        this.params = { ...this.params, kappa: v };
        this.simInst?.setParams({ kappa: v });
        this.updateReadouts();
      },
      1,
      v => v.toFixed(1),
    );
    this.kappaInput = kappaRow.querySelector<HTMLInputElement>("input");
    this.kappaValEl = kappaRow.querySelector<HTMLElement>(".fbval");

    const mobRow = range(
      "mobility M",
      1.0,
      10.0,
      0.5,
      this.params.mobility,
      v => {
        this.params = { ...this.params, mobility: v };
        this.simInst?.setParams({ mobility: v });
        this.updateReadouts();
      },
      1,
      v => v.toFixed(1),
    );
    this.mobInput = mobRow.querySelector<HTMLInputElement>("input");
    this.mobValEl = mobRow.querySelector<HTMLElement>(".fbval");

    form.append(cell(presetRow), cell(c0Row), cell(kappaRow), cell(mobRow));

    // Action bar: 2D/3D dim toggle + export csv (#transport owns run/pause/reset; #views owns lenses)
    const bar = document.createElement("div");
    bar.className = "spin__bar railmode__bar";

    const dims = document.createElement("div");
    dims.className = "spin__grp";
    dims.setAttribute("role", "group");
    dims.setAttribute("aria-label", "Spinodal dimension");
    const dim2 = pill("2D", () => this.setDim("2d"));
    dim2.id = "spinDim2d";
    const dim3 = pill("3D", () => this.setDim("3d"));
    dim3.id = "spinDim3d";
    this.dimBtns = { "2d": dim2, "3d": dim3 };
    dims.append(dim2, dim3);

    const csvBtn = pill("export csv", () => {
      const csv = this.exportCsv();
      download(
        `solidify-spinodal-${this.params.preset}-${this.params.dim}.csv`,
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
    });
    bar.append(dims, csvBtn);

    // Single-column live spec-rail readouts
    const statsGrid = document.createElement("div");
    statsGrid.id = "spinStats";
    statsGrid.className = "spin__stats";
    this.statEls = {};
    const statDefs: readonly [string, string][] = [
      ["time", "time t"],
      ["energy", "free energy F"],
      ["meanC", "mean ⟨c⟩"],
      ["domainL", "domain L"],
      ["lsw", "LSW slope α"],
      ["rangeC", "c range"],
    ];
    for (const [key, label] of statDefs) {
      const row = document.createElement("div");
      row.className = "spin__stat";
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

    // Plot mode toggle (F(t) / L(t)) above embedded clickable PlotView
    const plotBar = document.createElement("div");
    plotBar.className = "spin__plotbar";
    const plotCap = document.createElement("span");
    plotCap.className = "spin__plotcap";
    plotCap.textContent = "DIAGNOSTICS";
    const modeGrp = document.createElement("div");
    modeGrp.className = "spin__grp";
    modeGrp.setAttribute("role", "group");
    modeGrp.setAttribute("aria-label", "Spinodal plot mode");
    const btnF = pill("F(t)", () => this.setPlotMode("energy"));
    btnF.id = "spinPlotF";
    const btnL = pill("L(t)", () => this.setPlotMode("coarsening"));
    btnL.id = "spinPlotL";
    this.plotBtns = { energy: btnF, coarsening: btnL };
    modeGrp.append(btnF, btnL);
    plotBar.append(plotCap, modeGrp);

    const plotWrap = document.createElement("div");
    plotWrap.className = "spin__plot";
    this.plotView = new PlotView(plotWrap, {
      id: "spinPlot",
      label: "Cahn–Hilliard free energy and coarsening plot; open figure and data",
      onOpen: () => {
        if (!this.currentFigure) return;
        this.plotModal?.close();
        this.plotModal = openFigure(() => this.currentFigure!);
      },
    });

    // Preset provenance note + honest model caveat
    const note = document.createElement("div");
    note.id = "spinNote";
    note.className = "spin__caveat q";
    this.noteEl = note;

    const caveat = document.createElement("div");
    caveat.className = "spin__caveat q";
    caveat.textContent =
      "Explicit periodic Cahn–Hilliard model; isotropic gradient energy; elastic coherency strain omitted.";

    p.append(head, ex.body, form, bar, statsGrid, plotBar, plotWrap, note, caveat);
    const mount = document.getElementById("railModeHost") ?? document.getElementById("rail") ?? document.getElementById("app")!;
    mount.append(p);
    this.panel = p;

    this.syncControls();
    this.syncDimButtons();
    this.syncPlotButtons();
    this.updateMetaAndNote();
    this.updateReadouts();
    this.updatePlot();
    this.syncLearn();
  }

  private setPlotMode(mode: SpinodalPlotMode): void {
    if (this.plotMode === mode) return;
    this.plotMode = mode;
    this.syncPlotButtons();
    this.updatePlot();
  }

  private syncControls(): void {
    const preset = this.currentPreset();
    if (this.presetSelect) this.presetSelect.value = preset.label;
    if (this.c0Input) {
      this.c0Input.value = String(this.params.c0);
      paintRange(this.c0Input);
    }
    if (this.c0ValEl) this.c0ValEl.textContent = this.params.c0.toFixed(2);
    if (this.kappaInput) {
      this.kappaInput.value = String(this.params.kappa);
      paintRange(this.kappaInput);
    }
    if (this.kappaValEl) this.kappaValEl.textContent = this.params.kappa.toFixed(1);
    if (this.mobInput) {
      this.mobInput.value = String(this.params.mobility);
      paintRange(this.mobInput);
    }
    if (this.mobValEl) this.mobValEl.textContent = this.params.mobility.toFixed(1);
  }

  private syncDimButtons(): void {
    this.dimBtns["2d"]?.setAttribute("aria-pressed", String(this.params.dim === "2d"));
    this.dimBtns["3d"]?.setAttribute("aria-pressed", String(this.params.dim === "3d"));
  }

  private syncPlotButtons(): void {
    this.plotBtns.energy?.setAttribute("aria-pressed", String(this.plotMode === "energy"));
    this.plotBtns.coarsening?.setAttribute("aria-pressed", String(this.plotMode === "coarsening"));
  }

  private updateMetaAndNote(): void {
    const preset = this.currentPreset();
    if (this.metaEl) {
      const grid = this.params.dim === "3d" ? `${this.params.n3d}³` : `${this.params.n2d}²`;
      const dimTag = this.params.dim === "3d" ? "3D" : "2D";
      this.metaEl.textContent = "";
      this.metaEl.append(document.createTextNode(`${dimTag} ${grid} · `));
      const b = document.createElement("b");
      b.textContent = preset.label;
      this.metaEl.append(b);
    }
    if (this.noteEl) {
      const orbitHint = this.params.dim === "3d" ? " Drag canvas to orbit; double-click to reset view." : "";
      this.noteEl.textContent = `${preset.note}${orbitHint}`;
    }
  }

  private updateReadouts(): void {
    if (!this.panel) return;
    const st = this.stats;

    const set = (k: string, text: string) => {
      const el = this.statEls[k];
      if (el) el.textContent = text;
    };

    if (!st || !st.valid) {
      set("time", "—");
      set("energy", "—");
      set("meanC", `${this.params.c0.toFixed(4)}`);
      set("domainL", "—");
      set("lsw", "—");
      set("rangeC", "—");
      return;
    }

    set("time", `${fmtNum(st.simTime, 2)} · step ${st.step.toLocaleString()}`);
    set("energy", fmtEnergy(st.freeEnergy));
    set("meanC", `${st.meanC.toFixed(4)} (${fmtDrift(st.massDrift)})`);
    set("domainL", fmtNum(st.domainL, 2));
    set("lsw", st.lswSlope != null && Number.isFinite(st.lswSlope) ? `${st.lswSlope.toFixed(3)} (LSW 0.333)` : "—");
    set("rangeC", `${st.minC.toFixed(3)}–${st.maxC.toFixed(3)}`);
  }

  private updatePlot(): void {
    if (!this.plotView) return;
    const preset = this.currentPreset();
    const hist = this.simInst?.history ?? [];
    const slope = this.stats?.lswSlope ?? null;
    const fig = spinodalFigure(hist, this.plotMode, slope, preset.label);
    this.currentFigure = fig;
    this.plotView.set(fig.fig);
    this.plotModal?.update();
  }
}
