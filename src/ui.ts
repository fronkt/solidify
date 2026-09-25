import type { AppControl, TourHost } from "./tour";
import { SCENES, SCENES3 } from "./tour";
import { LENS_NAMES } from "./shaders";
import { LENS3_NAMES, ICOSA_DELTA_MAX } from "./shaders3d";
import { MATERIALS, to3D } from "./materials";
import type { PhysParams } from "./sim";
import type { Units } from "./units";
import type { Analyze } from "./analyze";
import {
  LearnLayer, learnEntry, learnIds, isLearnOn, onLearnChange, bindLearnToggle, storeGet, storeSet,
  type LearnEntry, type Caveat,
} from "./learn";
// importing the rail's entries registers them
import { RAIL_CAVEATS, RAIL_NOTES } from "./learn/rail";
import { STATUS_LEARN, panelLearnAudit } from "./learn/panels";
import { bindRangeFills, paintRange, paintRanges, setPressed } from "./design/tool";

/** for strings interpolated into innerHTML */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The width the canvas needs for the lens bar beside the head plate: its
 *  424px floor for its center plus 172 (half its 312 and 16 off the rail),
 *  app/index.html #views and --lens-under-head. Under it the bar goes under
 *  the plate (.narrow); a window that narrow with the rail open boots with the
 *  rail hidden, and while the rail is open there the top chrome folds away
 *  (.railCramped) */
const RAIL_ROOM = 596;
/** the transport bar's right edge (282) + 16: under this the open rail
 *  would cover the bottom-left group too (.railPhone) */
const RAIL_ROOM_PHONE = 298;

export interface UIHost extends AppControl {
  simParams(): PhysParams;
  /** the live dimensionless<->SI scaling (units.ts) */
  units(): Units;
  /** the run's RNG seed, and a fresh draw — every stochastic choice descends from it */
  seedHex(): string;
  reseed(): void;
  /** model resolution — the one free factor of the three */
  getUmPerCell(): number;
  /** calibrated (Karma–Rappel) mode: available, on, and its one knob */
  canCalibrate(): boolean;
  isCalibrated(): boolean;
  setCalibrated(on: boolean): void;
  getLambda(): number;
  setLambda(v: number): void;
  /** what the calibration works out to, or null when it is not running */
  calibration(): { d0: number; W0: number; tau0: number; wOverD0: number; dT0: number;
    umPerCell: number; coefficientSource: string } | null;
  setUmPerCell(v: number): void;
  getUndercool(): number;
  setUndercool(v: number): void;
  getInoculant(): number;
  getNucPotency(): number;
  setNucPotency(v: number): void;
  getNucSpread(): number;
  setNucSpread(v: number): void;
  getNucFired(): number;
  startLab(): void;
  isLabOpen(): boolean;
  /** open the HEAT TREAT panel — the second clock, in either dimension */
  startHeat(): void;
  getSubsteps(): number;
  isRunning(): boolean;
  isEngineering(): boolean;
  shareLink(): string;
  getSpeedMult(): number;
  cycleSpeedMult(): void;
  getMaterial(): string;
  /** true if the key named a real material; false is a refusal the caller must honour */
  setMaterial(key: string): boolean;
  openComposer(): void;
  getGrid(): number;
  setGrid(n: number): void;
  getView(): number;
  /** hold to pour heat back in — a remelt brush, NOT a heat treatment */
  reheat(on: boolean): void;
  quench(): void;
  resetArmed(): void;
  getBrush(): number;
  setBrush(v: number): void;
  getWeldAuto(): boolean;
  getWeldSweep(): number;
  setWeldSweep(v: number): void;
  getPixel(): number;
  setPixel(v: number): void;
  getPalette(): boolean;
  setPalette(b: boolean): void;
  getVoxel3(): boolean;
  setVoxel3(b: boolean): void;
  getStain(): number;
  setStain(v: number): void;
  getEbsd(): boolean;
  setEbsd(b: boolean): void;
  getTilt(): boolean;
  setTilt(b: boolean): void;
  resetZoom(): void;
  simTimeNow(): number;
  isRecording(): boolean;
  toggleRec(): void;
  /**
   * The melt's temperature in °C, or null when there is no liquid left, no SI
   * identity, or no stats yet. Lives on the host rather than being recomputed
   * per panel so the composer's diagram cursor and the corner readout cannot
   * drift apart.
   */
  meltC(): number | null;
  /** solid fraction from the last stats readback, 0 when there is none */
  fracSolidNow(): number;
  getAlloyName(): string;
  /**
   * Clamps and refusals the current melt is carrying, rendered beside the
   * alloy name. Empty for a clean pour. This is the channel that makes
   * science/index.html's "labels every clamp it has to make" true for an
   * `#alloy=` deep link, which never opens the composer at all.
   */
  getAlloyCaveats(): string[];
  // TRUE-3D mode
  getMode(): "2d" | "3d";
  setMode(m: "2d" | "3d"): void | Promise<void>;
  canSwitchMode(): boolean;
  closeTour(): void;
  caps3dSizes(): number[];
  getGrid3(): number;
  setGrid3(n: number): void;
  getView3d(): number;
  setView3d(v: number): void;
  getSubsteps3(): number;
  setSpeed3(v: number): void;
  getSliceAxis(): number;
  setSliceAxis(a: number): void;
  getSliceOff(): number;
  setSliceOff(v: number): void;
  getSliceTilt(): number;
  setSliceTilt(v: number): void;
  getSliceTurn(): number;
  setSliceTurn(v: number): void;
  getSliceSweep(): boolean;
  setSliceSweep(b: boolean): void;
  getCutStyle(): number;
  setCutStyle(v: number): void;
  /** the Niyama cut style's legend (threshold + provenance, or the honest
   *  refusal) as a terse line and its learn sentence; null while any other
   *  style is on the saw */
  niyamaLegend(): Caveat | null;
  getSym3(): number;
  setSym3(j: number): void;
  getHabit(): number;
  setHabit(v: number): void;
  getAlloyOn(): boolean;
  setAlloyOn(b: boolean): void;
  getStereoOn(): boolean;
  setStereoOn(b: boolean): void;
  getIpfOn(): boolean;
  setIpfOn(b: boolean): void;
  getPoleOn(): boolean;
  setPoleOn(b: boolean): void;
  getProbe3On(): boolean;
  setProbe3On(b: boolean): void;
  getScheil3On(): boolean;
  setScheil3On(b: boolean): void;
  getRuler3On(): boolean;
  setRuler3On(b: boolean): void;
  exportSTL(): void;
  startTurntable(): void;
}

interface SliderBind { update(): void }

export class UI {
  private binds: SliderBind[] = [];
  private sections: Record<string, { root: HTMLElement; setOpen: (b: boolean) => void }> = {};
  private viewBtns: HTMLButtonElement[] = [];
  private viewBtns3: HTMLButtonElement[] = [];
  private runBtn!: HTMLButtonElement;
  private multBtn!: HTMLButtonElement;
  private recBtn!: HTMLButtonElement;
  private symBtns: HTMLButtonElement[] = [];
  private gridBtns: HTMLButtonElement[] = [];
  private grid3Btns: HTMLButtonElement[] = [];
  private scenBtns: HTMLButtonElement[] = [];
  private bridgePanel!: HTMLElement;
  private weldPanel!: HTMLElement;
  private alloyPanel!: HTMLElement;
  private pixelRow!: HTMLElement;
  private habitRow!: HTMLElement;
  private facetRow!: HTMLElement;
  private undercoolRow!: HTMLElement;
  private unrealNote!: HTMLElement;
  private sitesUnitNote!: HTMLElement;
  private regimeNote!: HTMLElement;
  private regimeLearn!: HTMLElement;
  private scheilNote!: HTMLElement;
  private scaleBody!: HTMLElement;
  private calSwitch!: HTMLElement;
  private calNote!: HTMLElement;
  private lamRow!: HTMLElement;
  private umRow!: HTMLElement;
  /** rows the calibrated solver DERIVES — greyed, never deleted */
  private derived: HTMLElement[] = [];
  private only2d: HTMLElement[] = [];
  private only3d: HTMLElement[] = [];
  private readouts = document.getElementById("readouts")!;
  private lastPixel = 6;
  /** learn mode's explanations and hints in the rail (src/learn) */
  private learn = new LearnLayer(() => this.sync());
  /** the section being built, so a control can find its hint by its label */
  private secId = "";
  private secEntry: LearnEntry | null = null;
  private hintsBound = new Set<string>();

  constructor(private host: UIHost, private analyze: Analyze) {
    // every slider on the page, rail or panel, fills to its thumb as it is
    // dragged (tokens.css draws the fill from --fill)
    bindRangeFills();
    this.buildViews();
    this.buildTransport();
    this.buildRail();
    this.buildDimSwitch();
    document.getElementById("railToggle")!.addEventListener("click", () => {
      this.setRailHidden(!document.body.classList.contains("railHidden"));
    });
    // A window that cannot hold the rail beside the chrome (a phone, a
    // tablet held upright) opens on the melt: the rail starts hidden, and
    // CONTROLS brings it in as a drawer (app/index.html .railCramped)
    const rail = document.getElementById("rail")!;
    this.setRailHidden(innerWidth - rail.offsetWidth < RAIL_ROOM);
    addEventListener("resize", () => this.railRoom());
    // and a mode panel opened on such a window takes the screen from the
    // drawer: the panel needs 300px the rail does not leave. The panels are
    // built in script, each appended to #app as a .modepanel
    new MutationObserver(recs => {
      if (!document.body.classList.contains("railCramped")) return;
      const opened = recs.some(r => [...r.addedNodes].some(n => n instanceof HTMLElement && n.classList.contains("modepanel")));
      if (opened) this.setRailHidden(true);
    }).observe(document.getElementById("app")!, { childList: true });
    bindLearnToggle(document.getElementById("learnToggle") as HTMLButtonElement);
    onLearnChange(() => this.sync());
  }

  /** show or hide the rail (CONTROLS, the tour's reveal, a narrow boot) */
  private setRailHidden(hide: boolean) {
    document.getElementById("rail")!.classList.toggle("hidden", hide);
    document.body.classList.toggle("railHidden", hide);
    this.railRoom();
  }

  /** whether the canvas is narrow (the lens bar under the head plate,
   *  app/index.html .narrow, the CSS's --lens-under-head), and whether the
   *  open rail leaves the chrome beside it too little room (.railCramped,
   *  .railPhone) */
  private railRoom() {
    const open = !document.body.classList.contains("railHidden");
    const free = innerWidth - (open ? document.getElementById("rail")!.offsetWidth : 0);
    document.body.classList.toggle("narrow", free < RAIL_ROOM);
    document.body.classList.toggle("railCramped", open && free < RAIL_ROOM);
    document.body.classList.toggle("railPhone", open && free < RAIL_ROOM_PHONE);
  }

  private buildViews() {
    // the lens bar: the pill tabs of tokens.css, the active one inverted
    // (aria-pressed, set in sync)
    const el = document.getElementById("views")!;
    LENS_NAMES.forEach((name, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tabs__tab";
      b.textContent = name;
      b.title = `lens ${(i + 1) % 10}`;
      b.addEventListener("click", () => { this.host.setView(i); this.sync(); });
      el.append(b);
      this.viewBtns.push(b);
    });
    LENS3_NAMES.forEach((name, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tabs__tab";
      b.textContent = name;
      b.title = `3D lens ${i + 1}`;
      b.style.display = "none";
      b.addEventListener("click", () => { this.host.setView3d(i); this.sync(); });
      el.append(b);
      this.viewBtns3.push(b);
    });
  }

  /** the 2D ↔ 3D activation switch, floating just below the CONTROLS button */
  private buildDimSwitch() {
    const mount = document.getElementById("dimSwitch")!;
    const row = this.actSwitch(mount, "TRUE 3D", "VOLUME",
      () => this.host.getMode() === "3d",
      b => {
        // flipping the switch by hand is the user taking over — end the tour
        this.host.closeTour();
        void this.host.setMode(b ? "3d" : "2d");
      });
    this.binds.push({
      update: () => {
        const ok = this.host.canSwitchMode() || this.host.getMode() === "3d";
        row.classList.toggle("disabled", !ok);
        row.setAttribute("aria-disabled", String(!ok));
        // canSwitchMode: a capable GPU, and no pour, treatment, optimizer or
        // challenge in progress
        row.title = ok
          ? "3D phase-field volume · orbit camera · heavier GPU load"
          : "unavailable: needs a capable GPU, and no pour, treatment, optimizer or challenge running";
      },
    });
  }

  /** reset, run, the speed multiplier and rec as pills; run/pause is the
   *  instrument's one filled primary, the other three outline, and the
   *  multiplier and rec take an emphasized outline while they are on, so the
   *  fill stays run/pause's alone (DESIGN.md 5, buttons; app/index.html) */
  private buildTransport() {
    const el = document.getElementById("transport")!;
    this.button(el, "reset", () => { this.host.resetArmed(); this.sync(); }, "reset");
    this.runBtn = this.button(el, "▶ run", () => { this.host.setRun(!this.host.isRunning()); this.sync(); }, "run accent");
    this.multBtn = this.button(el, "×1", () => { this.host.cycleSpeedMult(); this.sync(); }, "mult");
    this.recBtn = this.button(el, "rec", () => this.host.toggleRec(), "recbtn");
  }

  /**
   * collapsible rail section; open state persists in localStorage (when there
   * is one). With learn mode on, an "i" in the header expands the section's
   * explanation under it, independently of opening the section.
   *
   * The title is a real button (aria-expanded, aria-controls) so a keyboard
   * can open a section: most of the rail, hints included, lives in collapsed
   * bodies. The click handler stays on the whole header, which the button's
   * own activation bubbles to, so a click anywhere on it still toggles.
   */
  private section(rail: HTMLElement, title: string, open = false): HTMLElement {
    const s = document.createElement("div");
    s.className = "sec";
    const h = document.createElement("h2");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "secHead";
    head.textContent = title;
    const tog = document.createElement("span");
    tog.className = "tog";
    tog.setAttribute("aria-hidden", "true");
    h.append(head, tog);
    h.style.cursor = "pointer";
    const body = document.createElement("div");
    body.className = "secbody";
    body.id = `secbody-${Object.keys(this.sections).length + 1}`;
    head.setAttribute("aria-controls", body.id);
    const key = "sol.sec." + title;
    const stored = storeGet(key);
    let isOpen = stored != null ? stored === "1" : open;
    const apply = () => {
      body.style.display = isOpen ? "block" : "none";
      // Figure's expander marks: − open, + closed (U+2212, not a hyphen)
      tog.textContent = isOpen ? "−" : "+";
      head.setAttribute("aria-expanded", String(isOpen));
    };
    h.addEventListener("click", () => {
      isOpen = !isOpen;
      storeSet(key, isOpen ? "1" : "0");
      apply();
    });
    apply();
    s.append(h);
    this.secId = `sec:${title}`;
    this.secEntry = learnEntry(this.secId) ?? null;
    if (this.secEntry)
      s.append(this.learn.explain(h, `about ${title.toLowerCase()}`, this.secEntry.text, tog).body);
    s.append(body);
    rail.append(s);
    this.sections[title] = {
      root: s,
      setOpen: b => { isOpen = b; apply(); },
    };
    return body;
  }

  /** open a rail section, scroll it into view, and pulse a highlight (tour part II) */
  reveal(title: string) {
    const sec = this.sections[title];
    if (!sec) return;
    this.setRailHidden(false);
    sec.setOpen(true);
    sec.root.scrollIntoView({ block: "nearest", behavior: "smooth" });
    sec.root.classList.add("hl");
  }

  /**
   * `dynRange` lets a row narrow itself as state changes — the anisotropy δ
   * slider spans 0–0.08, but the icosahedral energy is only convex to ≈0.035
   * and the shader silently clamps there, so without this the dial reads a
   * value the solver is not using.
   */
  private slider(
    parent: HTMLElement, label: string, min: number, max: number, step: number,
    get: () => number, set: (v: number) => void, fmt: (v: number) => string = v => v.toFixed(2),
    dynRange?: () => [number, number],
  ) {
    const row = document.createElement("div");
    row.className = "row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min); inp.max = String(max); inp.step = String(step);
    const val = document.createElement("div");
    val.className = "val";
    // rows bound to params the other mode doesn't have read undefined — show a dash
    const update = () => {
      let lo = min, hi = max;
      if (dynRange) {
        [lo, hi] = dynRange();
        inp.min = String(lo); inp.max = String(hi);
      }
      const v = get();
      // show the value the SOLVER will use, not the one the param happens to
      // hold — a dial parked outside a narrowed range is clamped downstream
      const vc = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
      inp.value = String(vc);
      paintRange(inp);
      val.textContent = Number.isFinite(v) ? fmt(vc) : "—";
    };
    inp.addEventListener("input", () => { set(parseFloat(inp.value)); update(); });
    row.append(lab, inp, val);
    parent.append(row);
    update();
    this.binds.push({ update });
    this.hintFor(row, label);
    return row;
  }

  /**
   * The current section's learn hint for `key` (a control's printed label),
   * as one muted line right under `el`. Every hint a section declares must
   * find its control: `learnAudit()` lists the ones that did not.
   */
  private hintFor(el: HTMLElement, key: string) {
    const text = this.secEntry?.hints?.[key];
    if (!text) return;
    this.learn.hint(el, text);
    this.hintsBound.add(`${this.secId}|${key}`);
  }

  /** what learn mode declares for the rail against what the rail bound, and
   *  the same for the panels' hints (verify-rail RAIL-LEARN) */
  learnAudit() {
    const titles = Object.keys(this.sections);
    const ids = learnIds("sec:");
    const declared = ids.flatMap(id => Object.keys(learnEntry(id)?.hints ?? {}).map(k => `${id}|${k}`));
    return {
      sections: titles.length,
      sectionsWithoutEntry: titles.filter(t => !learnEntry(`sec:${t}`)),
      entriesWithoutSection: ids.filter(id => !this.sections[id.slice(4)]),
      hintsDeclared: declared.length,
      hintsUnbound: declared.filter(k => !this.hintsBound.has(k)),
      // read through the app's own module instance: a page-side dynamic
      // import of learn/panels.ts is a separate instance, with an empty record
      // once vite has timestamped the app's copy
      panelHints: panelLearnAudit(),
    };
  }

  private check(parent: HTMLElement, label: string, get: () => boolean, set: (b: boolean) => void): HTMLInputElement {
    const row = document.createElement("label");
    row.className = "checkrow";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = get();
    inp.addEventListener("change", () => { set(inp.checked); this.sync(); });
    const span = document.createElement("span");
    span.textContent = label;
    row.append(inp, span);
    parent.append(row);
    this.binds.push({ update: () => { inp.checked = get(); } });
    this.hintFor(row, label);
    return inp;
  }

  /**
   * activation switch: a render-mode toggle that reads as "this costs GPU".
   * A real button with role="switch" (v8 U1b review), so it is in the tab
   * order, Enter and Space flip it (main.ts's Space shortcut already yields to
   * a tabbed-to button) and a screen reader hears its state. A switch that
   * cannot flip right now carries `.disabled` and aria-disabled, not the
   * disabled attribute or pointer-events:none: it stays hoverable, so its
   * title can say why, and focusable, and a click does nothing
   */
  private actSwitch(parent: HTMLElement, label: string, tag: string, get: () => boolean, set: (b: boolean) => void): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "actswitch";
    row.setAttribute("role", "switch");
    row.innerHTML = `<span class="track"><span class="knob"></span></span><span>${label}</span><span class="tag">${tag}</span>`;
    const apply = () => {
      const on = get();
      row.classList.toggle("on", on);
      row.setAttribute("aria-checked", String(on));
    };
    row.addEventListener("click", () => {
      if (row.classList.contains("disabled")) return;
      set(!get()); apply(); this.sync();
    });
    parent.append(row);
    apply();
    this.binds.push({ update: apply });
    return row;
  }

  private button(parent: Element, label: string, fn: () => void, cls = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", fn);
    parent.append(b);
    return b;
  }

  /** a row of pills that fill it; with `cols`, lined up in that many equal
   *  columns (a set of peers: the presets, the modes, the symmetries) */
  private btnRow(parent: HTMLElement, cols = 0): HTMLElement {
    const r = document.createElement("div");
    r.className = cols ? "btnrow grid" : "btnrow";
    if (cols) r.style.setProperty("--cols", String(cols));
    parent.append(r);
    return r;
  }

  private buildRail() {
    const rail = document.getElementById("rail")!;
    const host = this.host;
    const p = () => host.simParams();

    // ---- presets
    const pre = this.section(rail, "PRESETS", true);
    const prow = this.btnRow(pre, 3);
    for (const name of ["dendrite", "snow", "seaweed", "quasi", "rain", "casting", "bridgman", "weld", "alloy"]) {
      this.button(prow, name, () => {
        if (host.getMode() === "3d") SCENES3[name](host as unknown as TourHost);
        else SCENES[name](host);
        this.sync();
      });
    }
    // 3D-only bonus preset: the single-crystal selector
    const selBtn = this.button(prow, "selector", () => { SCENES3.selector(host as unknown as TourHost); this.sync(); });
    this.only3d.push(selBtn);

    // ---- material identity (qualitative parameter bundles)
    const mat = this.section(rail, "MATERIAL");
    const sel = document.createElement("select");
    for (const [key, m] of Object.entries(MATERIALS)) {
      const o = document.createElement("option");
      o.value = key;
      o.textContent = m.label;
      sel.append(o);
    }
    // the material's spec line, and its learn-mode sentence under it
    const matNote = document.createElement("div");
    matNote.className = "matnote";
    sel.addEventListener("change", () => { host.setMaterial(sel.value); this.sync(); });
    mat.append(sel, matNote);
    const matLearn = this.learn.para(matNote, "", { needsAnchorText: true });
    this.binds.push({
      update: () => {
        const m3 = host.getMode() === "3d";
        for (const o of Array.from(sel.options)) {
          const mm = MATERIALS[o.value];
          const map = mm ? to3D(mm) : null;
          const off = m3 && map != null && !map.supported;
          o.disabled = off;
          const base = mm?.label ?? o.value;
          o.textContent = off ? `${base} · 2D only` : base;
        }
        sel.value = host.getMaterial();
        const mm = MATERIALS[host.getMaterial()];
        const map = mm ? to3D(mm) : null;
        const off3d = m3 && map && !map.supported;
        matNote.textContent = off3d ? (map.note3d ?? "") : mm?.note ?? "";
        matLearn.textContent = off3d ? (map.learn3d ?? "") : mm?.learn ?? "";
      },
    });

    // ---- modes (what each one does is the section's learn text)
    const modes = this.section(rail, "MODES");
    const mrow0 = this.btnRow(modes, 2);
    // the lab and (since H2b) the heat-treat panel run in both dimensions;
    // the ML modes are 2D-only. Plain names, no glyph icons (DESIGN.md)
    this.button(mrow0, "lab mode", () => { host.startLab(); this.sync(); });
    const heatBtn = this.button(mrow0, "heat treat", () => { host.startHeat(); this.sync(); });
    heatBtn.title = "solid-state heat treatment · real-hours clock · Arrhenius grain growth";
    this.only2d.push(this.button(mrow0, "optimizer", () => { host.startOptimizer(); this.sync(); }));
    this.only2d.push(this.button(mrow0, "challenge", () => host.startChallenge()));

    // ---- melt / process
    const melt = this.section(rail, "MELT · PROCESS", true);
    // These read in real units now. When the material has no SI identity (the
    // model metal, the quasicrystal) they fall back to the dimensionless value
    // rather than printing an em dash — the number the solver uses is still
    // worth seeing, it just is not a temperature.
    const uK = (v: number) => { const u = host.units(); return u.known ? u.fmtK(v) : v.toFixed(2); };
    const uRate = (v: number) => { const u = host.units(); return u.known ? u.fmtRate(v) : v.toFixed(3); };
    this.undercoolRow = this.slider(melt, "undercooling", 0.3, 1.0, 0.01,
      () => host.getUndercool(), v => host.setUndercool(v), uK);
    // the value leads with "!" past anything a real melt reaches, and this
    // line says why (empty and hidden otherwise), with its learn half under it
    this.unrealNote = document.createElement("div");
    this.unrealNote.className = "matnote";
    melt.append(this.unrealNote);
    this.learn.para(this.unrealNote, RAIL_CAVEATS.unreal.learn, { needsAnchorText: true });
    this.slider(melt, "cooling rate", 0, 0.6, 0.005, () => p().coolRate, v => { p().coolRate = v; }, uRate);
    // what that cooling rate is actually called in a shop
    this.regimeNote = document.createElement("div");
    this.regimeNote.className = "matnote";
    melt.append(this.regimeNote);
    this.regimeLearn = this.learn.para(this.regimeNote, "", { needsAnchorText: true });
    // The inoculant charge, NOT a nucleation rate. How many potential nuclei
    // the melt carries; how many actually fire is decided by how deeply the
    // melt undercools before recalescence, i.e. by the two sliders above.
    this.slider(melt, "inoculant n_max", 0, 3000, 10,
      () => host.getInoculant(), v => host.setInoculant(v), v => v.toFixed(0));
    const nucNote = document.createElement("div");
    nucNote.className = "matnote";
    melt.append(nucNote);
    const nucLearn = this.learn.para(nucNote, "", { needsAnchorText: true });
    this.binds.push({
      update: () => {
        const c = host.getInoculant() === 0 ? RAIL_CAVEATS.noRefiner : RAIL_CAVEATS.sitesFire;
        nucNote.textContent = c.line;
        nucLearn.textContent = c.learn;
      },
    });
    // three columns: seed, twin seed, chill wall; quench, then reheat over two
    const mrow = this.btnRow(melt, 3);
    this.button(mrow, "seed", () => host.seedCenter());
    this.button(mrow, "twin seed", () => host.twinSeedCenter());
    const chillBtn = this.button(mrow, "chill wall", () => host.chillWall("auto"));
    // in 3D the chill sits opposite the z=n−1 riser — directional feeding story
    this.binds.push({
      update: () => { chillBtn.textContent = host.getMode() === "3d" ? "chill floor" : "chill wall"; },
    });
    this.button(mrow, "quench", () => host.quench());
    // Called "anneal" until v6.0, which was simply the wrong word: it drives a
    // uniform volumetric heat source for as long as it is held, so it warms the
    // melt and REMELTS what has frozen. Nothing about it anneals — no time base,
    // no set-point, no solid-state physics. Real heat treatment is its own panel
    // on its own clock; this is a reheat brush, and it now says so.
    const reheatBtn = this.button(mrow, "reheat", () => {}, "span2");
    reheatBtn.title = RAIL_CAVEATS.reheat.line;
    this.learn.para(mrow, RAIL_CAVEATS.reheat.learn);
    reheatBtn.addEventListener("pointerdown", () => host.reheat(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"])
      reheatBtn.addEventListener(ev, () => host.reheat(false));

    // ---- scenario
    const scen = this.section(rail, "SCENARIO");
    const srow0 = this.btnRow(scen);
    const scenBtn = (v: number, label: string) => {
      const b = this.button(srow0, label, () => { p().scen = v; this.sync(); });
      this.scenBtns.push(b);
    };
    scenBtn(0, "free");
    scenBtn(1, "bridgman");
    scenBtn(2, "weld");
    scenBtn(3, "selector");   // 3D-only: the single-crystal pigtail
    this.only3d.push(this.scenBtns[3]);
    this.bridgePanel = document.createElement("div");
    this.bridgePanel.className = "subpanel";
    scen.append(this.bridgePanel);
    // the 3D domain is 5.76 physical units vs 30.7 in 2D — same steepness
    // needs a ~5× larger gradG, so the dial gets a mode-specific range
    this.only2d.push(
      this.slider(this.bridgePanel, "gradient", 0.02, 0.25, 0.005, () => p().gradG, v => { p().gradG = v; }, v => v.toFixed(3)));
    this.only3d.push(
      this.slider(this.bridgePanel, "gradient (3D)", 0.05, 0.9, 0.01, () => p().gradG, v => { p().gradG = v; }, v => v.toFixed(2)));
    this.slider(this.bridgePanel, "pull speed", 0.3, 5, 0.1, () => p().pullV, v => { p().pullV = v; }, v => v.toFixed(1));
    this.weldPanel = document.createElement("div");
    this.weldPanel.className = "subpanel";
    scen.append(this.weldPanel);
    this.slider(this.weldPanel, "laser power", 150, 1600, 10, () => p().weldPow, v => { p().weldPow = v; }, v => v.toFixed(0));
    this.slider(this.weldPanel, "spot size", 2, 9, 0.5, () => p().weldSig, v => { p().weldSig = v; }, v => v.toFixed(1));
    this.check(this.weldPanel, "auto raster", () => host.getWeldAuto(), b => host.setWeldAuto(b));
    this.slider(this.weldPanel, "sweep speed", 10, 140, 2, () => host.getWeldSweep(), v => host.setWeldSweep(v), v => v.toFixed(0));

    // ---- alloy
    const alloy = this.section(rail, "ALLOY");
    // routed through the host: in 3D "on" means allocating the solute textures
    this.check(alloy, "solute field", () => host.getAlloyOn(), b => host.setAlloyOn(b));
    const arow = this.btnRow(alloy);
    // the mode's one name (docs/COPY-STYLE.md): the modal is ALLOY COMPOSER;
    // the ellipsis says it opens a dialog
    this.button(arow, "alloy composer…", () => host.openComposer());
    this.hintFor(arow, "alloy composer…");
    this.alloyPanel = document.createElement("div");
    this.alloyPanel.className = "subpanel";
    alloy.append(this.alloyPanel);
    this.slider(this.alloyPanel, "composition c₀", 0.05, 0.7, 0.01, () => p().c0, v => { p().c0 = v; });
    this.slider(this.alloyPanel, "liquidus slope", 0.1, 0.8, 0.01, () => p().mLiq, v => { p().mLiq = v; });
    // dSol joins `derived`: calibrated mode overwrites it with the scaled
    // diffusivity (main.ts setSolver, `dSol: q.dTilde`), so leaving it live was
    // the dead-knob class — a dial the user can drag whose value is replaced on
    // the next calibration without anything saying so.
    this.derived.push(
      this.slider(this.alloyPanel, "solute D", 0.2, 1.5, 0.05, () => p().dSol, v => { p().dSol = v; }));

    // ---- crystal
    const cr = this.section(rail, "CRYSTAL");
    // δ joins `derived` too: calibrated mode sets it from the material's own
    // measured ε₄ (`delta: si.eps4`), which is precisely why the note below the
    // calibration switch already told the reader δ was "no longer a choice" —
    // the sentence was right and the dial had not been told.
    this.derived.push(
      this.slider(cr, "anisotropy δ", 0, 0.08, 0.001, () => p().delta, v => { p().delta = v; }, v => v.toFixed(3),
        // the icosahedral energy loses convexity well below the cubic range, and
        // the shader clamps there — so the dial narrows rather than reading a
        // value the solver is quietly ignoring
        () => [0, host.getMode() === "3d" && host.getSym3() === 5 ? ICOSA_DELTA_MAX : 0.08]));
    // in 2D, a periodic lattice permits exactly 2-, 3-, 4- and 6-fold rotational
    // symmetry (the crystallographic restriction theorem); 5- and 10-fold are the
    // "forbidden" symmetries only quasicrystals achieve
    const srow = this.btnRow(cr, 3);
    const sym = (j: number, label: string, where: "2d" | "3d" | "both" = "2d") => {
      const b = this.button(srow, label, () => {
        if (host.getMode() === "3d") host.setSym3(j);
        else p().aniMode = j;
        this.sync();
      });
      b.dataset.j = String(j);
      this.symBtns.push(b);
      if (where === "2d") this.only2d.push(b);
      if (where === "3d") this.only3d.push(b);
    };
    sym(2, "×2");
    sym(3, "×3");
    sym(4, "cubic ×4", "both");
    sym(6, "hex ×6", "both");
    sym(5, "×5 quasi");
    sym(10, "×10 quasi");
    sym(5, "icosa QC", "3d");   // the genuine 3D quasicrystal — six 5-fold axes
    // (why only 2, 3, 4 and 6 are lattice symmetries is the section's learn text)
    // the volume only implements the cusped energy for the cubic ⟨100⟩ family
    // (shaders3d.ts aniso3, aniMode3 == 1) — the hex and icosahedral branches
    // ignore `facet` entirely, so the control hides there rather than sitting
    // on screen doing nothing
    const facChk = this.check(cr, "faceted (cusped ε)", () => p().facet > 0.5, b => { p().facet = b ? 1 : 0; });
    this.facetRow = facChk.parentElement as HTMLElement;
    this.slider(cr, "tip noise", 0, 0.04, 0.001, () => p().noiseAmp, v => { p().noiseAmp = v; }, v => v.toFixed(3));
    this.slider(cr, "latent heat K", 0.8, 2.2, 0.01, () => p().latent, v => { p().latent = v; });
    this.slider(cr, "twin rate", 0, 0.004, 0.0001, () => p().twinProb, v => { p().twinProb = v; },
      v => v > 0 ? `${(v * 1000).toFixed(1)}‰` : "off");
    // hex 3D only: δz sign picks the growth habit (managed manually in sync —
    // visible iff 3D ∧ hex, so neither only2d nor only3d fits)
    // (the value cell names the habit; the sign convention is the learn hint)
    this.habitRow = this.slider(cr, "habit δz", -0.06, 0.06, 0.002,
      () => host.getHabit(), v => host.setHabit(v),
      v => v <= -0.005 ? "needles" : v >= 0.005 ? "plates" : "equant");

    // ---- look
    const look = this.section(rail, "LOOK");
    const pixChk = this.check(look, "pixel mode", () => host.getPixel() > 0, b => {
      host.setPixel(b ? this.lastPixel : 0);
    });
    this.only2d.push(pixChk.parentElement as HTMLElement);
    this.pixelRow = this.slider(look, "pixel size", 2, 24, 1,
      () => (host.getPixel() > 0 ? host.getPixel() : this.lastPixel),
      v => { this.lastPixel = v; if (host.getPixel() > 0) host.setPixel(v); },
      v => `${v.toFixed(0)}px`);
    this.check(look, "8-bit palette", () => host.getPalette(), b => host.setPalette(b));
    const voxRow = this.actSwitch(look, "VOXEL MODE", "RENDER MODE", () => host.getVoxel3(), b => host.setVoxel3(b));
    this.only3d.push(voxRow);
    this.hintFor(voxRow, "VOXEL MODE");
    const tiltRow = this.actSwitch(look, "2.5D RELIEF", "RENDER MODE", () => host.getTilt(), b => host.setTilt(b));
    this.only2d.push(tiltRow);
    // an honesty line: the relief is a picture of the 2D field, not a volume
    const tiltNote = document.createElement("div");
    tiltNote.className = "matnote";
    tiltNote.textContent = RAIL_CAVEATS.relief.line;
    look.append(tiltNote);
    this.only2d.push(tiltNote);
    this.learn.para(tiltNote, RAIL_CAVEATS.relief.learn);
    // metallographic staining: tint etchants color grains by orientation (ETCH lens)
    const stainNote = document.createElement("div");
    stainNote.className = "matnote";
    stainNote.textContent = "stain (ETCH lens)";
    look.append(stainNote);
    this.only2d.push(stainNote);
    const stainSel = document.createElement("select");
    ["none (Nital)", "Klemm's tint etch", "Beraha's tint etch", "anodize + crossed polars"].forEach((label, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = label;
      stainSel.append(o);
    });
    stainSel.addEventListener("change", () => { host.setStain(parseInt(stainSel.value, 10)); this.sync(); });
    look.append(stainSel);
    this.only2d.push(stainSel);
    this.hintFor(stainSel, "stain");
    this.binds.push({ update: () => { stainSel.value = String(host.getStain()); } });
    const ebsdChk = this.check(look, "EBSD map (ORIENT)", () => host.getEbsd(), b => host.setEbsd(b));
    this.only2d.push(ebsdChk.parentElement as HTMLElement);
    // (the SLICE section-plane controls live in the floating SECTION PLANE
    // popup — src/slicepanel.ts — shown with the SLICE lens)
    const lrow = this.btnRow(look);
    this.button(lrow, "reset view", () => host.resetZoom());

    // ---- engine
    const sm = this.section(rail, "ENGINE");
    this.only2d.push(
      this.slider(sm, "speed", 1, 60, 1, () => host.getSubsteps(), v => host.setSpeed(v), v => `${v.toFixed(0)}×`));
    this.only3d.push(
      this.slider(sm, "speed (3D)", 1, 22, 1, () => host.getSubsteps3(), v => host.setSpeed3(v), v => `${v.toFixed(0)}×`));
    this.slider(sm, "brush size", 2, 18, 0.5, () => host.getBrush(), v => host.setBrush(v), v => v.toFixed(1));
    const grow = this.btnRow(sm, 3);
    for (const n of [512, 1024, 2048]) {
      const b = this.button(grow, `${n}²`, () => { host.setGrid(n); this.sync(); });
      this.gridBtns.push(b);
    }
    this.only2d.push(grow);
    this.hintFor(grow, "grid");
    const grow3 = this.btnRow(sm);
    for (const n of host.caps3dSizes()) {
      const b = this.button(grow3, `${n}³`, () => { host.setGrid3(n); this.sync(); });
      b.dataset.n = String(n);
      this.grid3Btns.push(b);
    }
    const gridNote3 = document.createElement("div");
    gridNote3.className = "matnote";
    gridNote3.textContent = RAIL_CAVEATS.grid3d.line;
    sm.append(gridNote3);
    this.only3d.push(grow3, gridNote3);
    this.learn.para(gridNote3, RAIL_CAVEATS.grid3d.learn);

    // ---- the run's seed. Every stochastic choice in the cast descends from it:
    // grain orientations, where the nucleation sites sit, what undercooling each
    // one activates at. Showing it is what lets a result be handed to someone
    // else — a shared link carries the seed, so they pour the SAME casting
    // rather than a statistically similar one.
    const seedRow = this.btnRow(sm);
    this.button(seedRow, "new seed", () => { this.host.reseed(); this.sync(); });
    const seedNote = document.createElement("div");
    seedNote.className = "matnote";
    sm.append(seedNote);
    this.learn.para(seedNote, RAIL_NOTES.seed);
    this.binds.push({
      update: () => { seedNote.textContent = `seed ${this.host.seedHex()}`; },
    });

    // ---- analyze: foundry instruments (one home — dispatched per mode)
    const an = this.section(rail, "ANALYZE");
    const m3now = () => host.getMode() === "3d";
    this.check(an, "cooling probe",
      () => m3now() ? host.getProbe3On() : this.analyze.probeOn,
      b => { if (m3now()) host.setProbe3On(b); else this.analyze.setProbeOn(b); });
    this.check(an, "Scheil overlay",
      () => m3now() ? host.getScheil3On() : this.analyze.scheilOn,
      b => { if (m3now()) host.setScheil3On(b); else this.analyze.setScheilOn(b); });
    // what the overlay cannot do without a solute field, said next to it
    this.scheilNote = document.createElement("div");
    this.scheilNote.className = "matnote";
    an.append(this.scheilNote);
    this.learn.para(this.scheilNote, RAIL_CAVEATS.scheilNeedsAlloy.learn, { needsAnchorText: true });
    const roseChk = this.check(an, "texture rose", () => this.analyze.textureOn, b => this.analyze.setTextureOn(b));
    this.only2d.push(roseChk.parentElement as HTMLElement);
    const anrow = this.btnRow(an);
    const rulerBtn = this.button(anrow, "SDAS ruler", () => {
      if (m3now()) host.setRuler3On(!host.getRuler3On());
      else this.analyze.setRulerOn(!this.analyze.rulerOn);
      this.sync();
    });
    this.hintFor(anrow, "SDAS ruler");
    this.binds.push({
      update: () => setPressed(rulerBtn, m3now() ? host.getRuler3On() : this.analyze.rulerOn),
    });
    const rres = document.createElement("div");
    rres.className = "matnote";
    an.append(rres);
    this.analyze.attachResultEl(rres);
    this.only2d.push(rres);

    // ---- 3D characterization lab
    const vol = this.section(rail, "VOLUME · 3D");
    this.check(vol, "stereology (2D section vs 3D)", () => host.getStereoOn(), b => host.setStereoOn(b));
    // the panel projects each grain's crystal [001] axis into the sample
    // frame: a pole figure, not an inverse pole figure (analyze3d.ts, v8 U1b)
    this.check(vol, "pole figure [001]", () => host.getIpfOn(), b => host.setIpfOn(b));
    this.check(vol, "pole figure ⟨100⟩ / (0001)", () => host.getPoleOn(), b => host.setPoleOn(b));
    const vrow = this.btnRow(vol, 2);
    const STL = "export STL";
    const stlBtn = this.button(vrow, STL, () => {
      stlBtn.textContent = "meshing…";
      host.exportSTL();
      setTimeout(() => { stlBtn.textContent = STL; }, 3000);
    });
    this.button(vrow, "360° turntable", () => host.startTurntable());
    this.learn.para(vrow, RAIL_NOTES.export);
    this.only3d.push(this.sections["VOLUME · 3D"].root);

    // ---- advanced
    const adv = this.section(rail, "ADVANCED");
    // Every one of these is a free dial under Kobayashi and a DERIVED quantity
    // under the calibrated solver. They are greyed rather than removed: share
    // links, presets and every scene still write them, and a mode switch that
    // silently discarded a user's ε̄ would be a worse surprise than a dial that
    // says why it is locked.
    this.derived.push(
      this.slider(adv, "interface ε̄", 0.006, 0.016, 0.0005, () => p().epsBar, v => { p().epsBar = v; }, v => v.toFixed(4)),
      this.slider(adv, "kinetics γ", 4, 25, 0.5, () => p().gamma, v => { p().gamma = v; }, v => v.toFixed(1)),
      this.slider(adv, "driving α", 0.6, 1.0, 0.01, () => p().alpha, v => { p().alpha = v; }),
      this.slider(adv, "relax τ ×10⁻⁴", 1.5, 8, 0.1, () => p().tau * 1e4, v => { p().tau = v * 1e-4; }, v => v.toFixed(1)),
    );
    // v6.2 P: the volume has honoured kPart since its alloy pass shipped
    // (shaders3d.ts solute rejection), but the dial was 2D-only — the inverse
    // of a dead knob, a working control users could not reach. p() is the
    // ACTIVE solver's params, so the same slider now drives both dimensions.
    this.slider(adv, "partition k", 0.05, 0.9, 0.01, () => p().kPart, v => { p().kPart = v; });
    // the inoculant's potency distribution: where the site population sits and
    // how tightly it clusters. Potent refiners fire just below the liquidus.
    this.slider(adv, "site ΔT_N", 0.03, 0.6, 0.005,
      () => host.getNucPotency(), v => host.setNucPotency(v), uK);
    const spreadRow = this.slider(adv, "site spread σ", 0.01, 0.15, 0.005,
      () => host.getNucSpread(), v => host.setNucSpread(v), uK);
    const sitesLearn = this.learn.para(spreadRow, RAIL_NOTES.sites);
    // Without SI data the two values above fall back to bare solver numbers
    // (uK), which the hints and the note above would otherwise let a reader
    // take for kelvin: this line says they are not, and is empty otherwise.
    // It sits right under the row, before the learn paragraph about real melts.
    this.sitesUnitNote = document.createElement("div");
    this.sitesUnitNote.className = "matnote";
    sitesLearn.before(this.sitesUnitNote);
    this.learn.para(this.sitesUnitNote, RAIL_CAVEATS.sitesModelUnits.learn, { needsAnchorText: true });
    const SHARE = "copy setup link";
    const shareB = this.button(this.btnRow(adv), SHARE, () => {
      void navigator.clipboard.writeText(host.shareLink()).then(() => {
        shareB.textContent = "copied";
        setTimeout(() => { shareB.textContent = SHARE; }, 1400);
      });
    });
    this.hintFor(shareB.parentElement as HTMLElement, SHARE);

    // ---- scale
    // The whole dimensionless<->SI map, with its provenance and its mismatches,
    // in one place. It is a rail section rather than a tooltip because it is the
    // thing that makes every other number in the app either trustworthy or
    // decorative, and a reader deserves to see which.
    const sc = this.section(rail, "SCALE");
    // CALIBRATED MODE. Under Kobayashi the interface width and the relaxation
    // time are dials and the tip radius is a shape; here they are derived from
    // the material's own capillary length and diffusivity, and the tip radius
    // becomes a prediction. The switch lives beside the SCALE report because
    // that report is where the difference shows: the capillary row stops
    // reading "not defined".
    this.calSwitch = this.actSwitch(sc, "calibrated solver", "Karma–Rappel",
      () => host.isCalibrated(), b => host.setCalibrated(b));
    this.calNote = document.createElement("div");
    this.calNote.className = "matnote";
    sc.append(this.calNote);
    // λ is the ONLY free parameter left, and it is a convergence knob: every
    // quantitative claim has to be shown not to depend on it.
    this.lamRow = this.slider(sc, "coupling λ", 1, 40, 0.5,
      () => host.getLambda(), v => host.setLambda(v),
      v => `${v.toFixed(1)} · W₀/d₀ ${(v / 0.8839).toFixed(1)}`);
    this.scaleBody = document.createElement("div");
    this.scaleBody.className = "matnote scaletab";
    sc.append(this.scaleBody);
    // model resolution is the ONE free choice among the three factors — until
    // the calibrated solver takes it over, at which point it is derived from W₀
    this.umRow = this.slider(sc, "µm per cell", 0.05, 20, 0.05,
      () => host.getUmPerCell(), v => host.setUmPerCell(v),
      v => v < 1 ? `${v.toFixed(2)} µm` : `${v.toFixed(1)} µm`);
    this.derived.push(this.umRow);
    // no control built after this point belongs to a section
    this.secId = "";
    this.secEntry = null;

    // ---- science + contact links
    const sci = document.createElement("a");
    sci.className = "scilink";
    sci.href = "../science/";
    sci.textContent = "science ↗";
    rail.append(sci);
    const con = document.createElement("a");
    con.className = "scilink";
    con.href = "../contact/";
    con.textContent = "feedback ↗";
    rail.append(con);
  }

  /** refresh all controls + conditional panels from state */
  sync() {
    for (const b of this.binds) b.update();
    const host = this.host;
    const p = host.simParams();
    const m3 = host.getMode() === "3d";

    // ---- calibrated mode: what it takes over, and what it now knows
    const cal = host.calibration();
    const on = !!cal;
    this.calSwitch.style.display = host.canCalibrate() || on ? "" : "none";
    this.lamRow.style.display = on ? "" : "none";
    for (const el of this.derived) {
      el.style.opacity = on ? "0.42" : "";
      el.style.pointerEvents = on ? "none" : "";
      el.title = on ? RAIL_CAVEATS.derived.line : "";
    }
    const nm = (m: number) => (m < 1e-6 ? `${(m * 1e9).toFixed(1)} nm` : `${(m * 1e6).toFixed(2)} µm`);
    const learnOn = isLearnOn();
    const lrn = (t: string) => (learnOn ? `<div class="lrnText">${esc(t)}</div>` : "");
    const calCav = on ? RAIL_CAVEATS.calLocked
      : host.canCalibrate() ? RAIL_CAVEATS.calOff
        : m3 ? RAIL_CAVEATS.cal3d : RAIL_CAVEATS.calNoSI;
    this.calNote.innerHTML = on
      // the numbers a reader needs to judge the calibration, not just trust it:
      // d₀ is Γ over the reference interval — and since v7.1 P1 that interval is
      // the POURED MIX's whenever there is one, not the material's — W₀ follows
      // from λ, and W₀/d₀ is the thing every quantitative claim has to be shown
      // independent of
      ? `d₀ ${nm(cal.d0)} · W₀ ${nm(cal.W0)} · τ₀ ${cal.tau0 < 1e-3
          ? cal.tau0.toExponential(1) + " s" : cal.tau0.toPrecision(2) + " s"}`
        + `<br>1 degree = ${cal.dT0.toFixed(1)} K · cell ${cal.umPerCell.toFixed(3)} µm`
        // WHICH alloy that degree was measured for. It was the unstated half of
        // this readout until v7.1 P1, and it was wrong for every poured mix.
        + `<br><span class="calsrc">${esc(cal.coefficientSource)}</span>`
        // the locked-dials line in --fg: it is the state, brightness says so
        + `<br><span class="calok">${esc(calCav.line)}</span>${lrn(calCav.learn)}`
      : `${esc(calCav.line)}${lrn(calCav.learn)}`;

    // mode gating: 2D-only vs 3D-only rows, sections and buttons
    for (const el of this.only2d) el.style.display = m3 ? "none" : "";
    for (const el of this.only3d) el.style.display = m3 ? "" : "none";
    const hex3 = m3 && host.getSym3() === 6;
    this.habitRow.style.display = hex3 ? "" : "none";
    // faceting is implemented for every 2D symmetry, but in the volume only for
    // cubic — see the note where the control is built
    const facetOn = !m3 || host.getSym3() === 4;
    this.facetRow.style.display = facetOn ? "" : "none";
    // the Scheil overlay has nothing to plot without a solute field
    this.scheilNote.textContent = host.getAlloyOn() ? "" : RAIL_CAVEATS.scheilNeedsAlloy.line;
    this.scheilNote.style.display = host.getAlloyOn() ? "none" : "";

    const lensOn = (b: HTMLButtonElement, on: boolean) => {
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    };
    this.viewBtns.forEach((b, i) => {
      b.style.display = m3 ? "none" : "";
      lensOn(b, !m3 && i === host.getView());
    });
    this.viewBtns3.forEach((b, i) => {
      b.style.display = m3 ? "" : "none";
      lensOn(b, m3 && i === host.getView3d());
    });
    // every set of toggles says which one is on to a screen reader too
    // (aria-pressed, which tokens.css draws as the inverted pill)
    for (const b of this.symBtns) {
      const j = Number(b.dataset.j);
      setPressed(b, m3 ? host.getSym3() === j : p.aniMode === j);
    }
    this.grid3Btns.forEach(b => setPressed(b, Number(b.dataset.n) === host.getGrid3()));
    this.scenBtns.forEach((b, i) => setPressed(b, i === p.scen));
    this.bridgePanel.style.display = p.scen === 1 ? "block" : "none";
    this.weldPanel.style.display = p.scen === 2 ? "block" : "none";
    this.alloyPanel.style.display = host.getAlloyOn() ? "block" : "none";
    // "" rather than "flex": a slider row is a grid (app/index.html .row)
    this.pixelRow.style.display = !m3 && host.getPixel() > 0 ? "" : "none";

    // run/pause stays the filled primary in both states; ▶ and ❚❚ are the
    // two glyphs DESIGN.md keeps. The glyphs are for the eye: each pill's
    // spoken name is its word ("heavy vertical bar" is not a control)
    const running = host.isRunning();
    this.runBtn.textContent = running ? "❚❚ pause" : "▶ run";
    this.runBtn.setAttribute("aria-label", running ? "pause" : "run");
    const mult = host.getSpeedMult();
    this.multBtn.textContent = `×${mult}`;
    this.multBtn.title = mult === 1 ? "fast-forward: ×2, then ×4" : `speed ×${mult}`;
    setPressed(this.multBtn, mult > 1);
    // rec says its state in its name (record / stop recording), so it is not
    // also a pressed toggle; .recording draws the same emphasized outline
    const rec = host.isRecording();
    this.recBtn.textContent = rec ? "■ stop" : "rec";
    this.recBtn.setAttribute("aria-label", rec ? "stop recording" : "record");
    this.recBtn.classList.toggle("recording", rec);
    document.getElementById("matline")!.textContent =
      host.getAlloyName() + (m3 ? ` · 3D ${host.getGrid3()}³` : "");
    // the melt's own caveats, on the same surface as its name — textContent,
    // not innerHTML, because these strings quote user-supplied element keys
    const caveats = host.getAlloyCaveats();
    const cav = document.getElementById("matcaveat")!;
    cav.textContent = caveats.join(" · ");
    cav.style.display = caveats.length ? "block" : "none";
    const grids = [512, 1024, 2048];
    this.gridBtns.forEach((b, i) => setPressed(b, grids[i] === host.getGrid()));

    // armed / paused indicator (the ML mode shows its own status instead)
    const armed = document.getElementById("armed")!;
    if (!host.isRunning() && !host.isEngineering()) {
      armed.style.display = "block";
      // ARMED at t = 0 (the melt is staged, nothing has run); what that means
      // is a learn line under it
      const atZero = host.simTimeNow() < 1e-9;
      armed.textContent = atZero ? "ARMED · ▶ run to start" : "PAUSED";
      if (atZero && learnOn) {
        const l = document.createElement("div");
        l.className = "lrnText";
        l.textContent = STATUS_LEARN.armed;
        armed.append(l);
      }
    } else {
      armed.style.display = "none";
    }

    // Lens overlays. The two lens tables are ordered differently — 2D is
    // [MELT ORIENT ETCH FIELD RINGS THERM SEM …], 3D is
    // [MELT ORIENT SLICE FIELD SEM RINGS THERM …] — so every legend has to be
    // keyed off the lens index of the mode that is actually on screen. Keying
    // all three off the 2D index left the volume's THERM and SEM lenses
    // rendering with no scale beside them.
    // real-unit annotations: what the cooling rate is called in a shop (the
    // rate itself is the slider's value), or that there is no clock to call it
    // by, and whether the undercooling dial has been pushed past anything a
    // real melt reaches
    const u = host.units();
    this.regimeNote.textContent = u.known ? u.regime(p.coolRate) : RAIL_CAVEATS.rateDimensionless.line;
    this.regimeLearn.textContent = u.known ? RAIL_NOTES.regime : RAIL_CAVEATS.rateDimensionless.learn;
    this.drawScale(u);

    const past = u.beyondReal(host.getUndercool());
    this.undercoolRow.querySelector(".val")?.classList.toggle("unreal", past);
    this.unrealNote.textContent = past ? RAIL_CAVEATS.unreal.line : "";
    this.unrealNote.style.display = past ? "" : "none";
    // the site dials read in solver units without SI data (see where they are built)
    this.sitesUnitNote.textContent = u.known ? "" : RAIL_CAVEATS.sitesModelUnits.line;
    this.sitesUnitNote.style.display = u.known ? "none" : "";

    const v = m3 ? host.getView3d() : host.getView();
    const thermLens = m3 ? 6 : 5;
    const semLens = m3 ? 4 : 6;
    // lens 2 carries the scale bar in both tables: 3D SLICE, 2D ETCH
    document.getElementById("scalebar")!.style.display = v === 2 ? "flex" : "none";
    document.getElementById("thermbar")!.style.display = v === thermLens ? "block" : "none";
    document.getElementById("sembar")!.style.display = v === semLens ? "block" : "none";

    // last: every hint follows its control's display, set above
    this.learn.apply(learnOn);
    // and every slider on the page, the panels' included, fills to the value
    // script may have just set
    paintRanges();
  }

  /**
   * The SCALE report: the three conversion factors with their provenance, the
   * domain size they imply, and the dimensionless groups the model does and does
   * not match. A row that says "forced" is not a setting the reader can change,
   * and a group marked mismatched is a number they should not trust — saying so
   * here is the whole point of the panel.
   */
  private drawScale(u: Units) {
    if (!this.scaleBody) return;
    const s = u.scale;
    // app/index.html .scaletab: the key, its value in the tabular mono, the
    // provenance in --fg-3
    const dim = (t: string) => `<span class="dim">${t}</span>`;
    const row = (k: string, v: string, prov: string) =>
      `<div class="srow"><span class="k">${k}</span><span class="v">${v}</span>${dim(prov)}</div>`;
    // each caveat's learn half, under its line, while learn mode is on
    const lrn = (t: string) => (isLearnOn() ? `<div class="lrnText">${esc(t)}</div>` : "");

    if (!u.known) {
      this.scaleBody.innerHTML =
        row("µm / cell", `${s.umPerCell.toFixed(2)}`, s.prov.umPerCell)
        + row("domain", `${s.domainUm.toFixed(0)} µm`, "derived: n × µm/cell")
        + `<div class="grp">${esc(s.note)}</div>${lrn(s.learn)}`;
      return;
    }
    const groups = s.groups.map(g => {
      const val = g.model == null
        ? "—"
        : `${g.model < 0.01 || g.model > 1e3 ? g.model.toExponential(1) : g.model.toFixed(2)}`
          + (g.real != null && !g.ok ? ` vs ${g.real > 1e3 ? g.real.toExponential(1) : g.real.toFixed(2)}` : "");
      // matched: a quiet check; mismatched: the warning mark, no color. The
      // model-against-real figure is the number a reader scans for, so it
      // is the tabular mono (.scaletab .v), bright; the prose stays quiet
      const mark = g.ok ? "<span class=\"ok\">✓</span>" : "<span class=\"bad\">!</span>";
      return `<div class="grp">${mark} <b>${g.name}</b> ${dim(`<span class="v">${val}</span>`)}`
        + `<div class="gnote">${esc(g.note)}${lrn(g.learn)}</div></div>`;
    }).join("");

    this.scaleBody.innerHTML =
      row("K / unit", s.kelvinPerUnit.toFixed(1), s.prov.kelvinPerUnit)
      + row("s / unit", s.secondsPerUnit < 1e-3
        ? s.secondsPerUnit.toExponential(2)
        : s.secondsPerUnit.toPrecision(3), s.prov.secondsPerUnit)
      + row("µm / cell", s.umPerCell.toFixed(2), s.prov.umPerCell)
      + row("domain", `${s.domainUm < 1000 ? s.domainUm.toFixed(0) + " µm" : (s.domainUm / 1000).toFixed(2) + " mm"}`,
        "derived: n × µm/cell")
      // under the calibrated alloy solver T = 1 is the nominal alloy's
      // liquidus (units.ts oneShiftK), not the base metal's melting point
      + (s.oneShiftK
        ? row("liquidus c∞", `${u.oneC.toFixed(0)} °C`, "T = 1") + row("melting pt", `${u.meltC.toFixed(0)} °C`, "base metal")
        : row("melting pt", `${u.meltC.toFixed(0)} °C`, "T = 1"))
      + `<div class="grp">${groups}</div>`
      + `<div class="grp dim">${esc(s.note)}</div>${lrn(s.learn)}`;
  }

  /** the HUD: a compact spec rail on the head plate, label left in --fg-3,
   *  value right in the tabular mono (tokens.css .spec--tool) */
  setReadouts(rows: [string, string][]) {
    this.readouts.innerHTML = rows
      .map(([k, v]) => `<div class="spec__row"><span class="spec__label">${k}</span><span class="spec__value">${v}</span></div>`)
      .join("");
  }
}
