import type { AppControl } from "./tour";
import { SCENES } from "./tour";
import { LENS_NAMES } from "./shaders";
import { LENS3_NAMES } from "./shaders3d";
import { MATERIALS, to3D } from "./materials";
import type { PhysParams } from "./sim";
import type { Analyze } from "./analyze";

export interface UIHost extends AppControl {
  simParams(): PhysParams;
  getUndercool(): number;
  setUndercool(v: number): void;
  getRain(): number;
  getSubsteps(): number;
  isRunning(): boolean;
  isEngineering(): boolean;
  shareLink(): string;
  isTurbo(): boolean;
  toggleTurbo(): void;
  getMaterial(): string;
  setMaterial(key: string): void;
  openComposer(): void;
  getGrid(): number;
  setGrid(n: number): void;
  getView(): number;
  anneal(on: boolean): void;
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
  getAlloyName(): string;
  // TRUE-3D mode
  getMode(): "2d" | "3d";
  setMode(m: "2d" | "3d"): void;
  canSwitchMode(): boolean;
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
  getSym3(): number;
  setSym3(j: number): void;
}

interface SliderBind { update(): void }

export class UI {
  private binds: SliderBind[] = [];
  private sections: Record<string, { root: HTMLElement; setOpen: (b: boolean) => void }> = {};
  private viewBtns: HTMLButtonElement[] = [];
  private viewBtns3: HTMLButtonElement[] = [];
  private runBtn!: HTMLButtonElement;
  private turboBtn!: HTMLButtonElement;
  private recBtn!: HTMLButtonElement;
  private symBtns: HTMLButtonElement[] = [];
  private gridBtns: HTMLButtonElement[] = [];
  private grid3Btns: HTMLButtonElement[] = [];
  private scenBtns: HTMLButtonElement[] = [];
  private bridgePanel!: HTMLElement;
  private weldPanel!: HTMLElement;
  private alloyPanel!: HTMLElement;
  private pixelRow!: HTMLElement;
  private only2d: HTMLElement[] = [];
  private only3d: HTMLElement[] = [];
  private readouts = document.getElementById("readouts")!;
  private lastPixel = 6;

  constructor(private host: UIHost, private analyze: Analyze) {
    this.buildViews();
    this.buildTransport();
    this.buildRail();
    this.buildDimSwitch();
    document.getElementById("railToggle")!.addEventListener("click", () => {
      document.getElementById("rail")!.classList.toggle("hidden");
      document.body.classList.toggle("railHidden");
    });
  }

  private buildViews() {
    const el = document.getElementById("views")!;
    LENS_NAMES.forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.title = `lens ${(i + 1) % 10}`;
      b.addEventListener("click", () => { this.host.setView(i); this.sync(); });
      el.append(b);
      this.viewBtns.push(b);
    });
    LENS3_NAMES.forEach((name, i) => {
      const b = document.createElement("button");
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
      b => this.host.setMode(b ? "3d" : "2d"));
    this.binds.push({
      update: () => {
        const ok = this.host.canSwitchMode() || this.host.getMode() === "3d";
        row.classList.toggle("disabled", !ok);
        row.title = ok
          ? "volumetric phase-field — heavier render, orbit camera"
          : "3D needs an idle instrument (finish the optimizer / challenge) and a capable GPU";
      },
    });
  }

  private buildTransport() {
    const el = document.getElementById("transport")!;
    this.button(el, "⟲ reset", () => { this.host.resetArmed(); this.sync(); }, "warn");
    this.runBtn = this.button(el, "▶ run", () => { this.host.setRun(!this.host.isRunning()); this.sync(); });
    this.turboBtn = this.button(el, "turbo", () => { this.host.toggleTurbo(); this.sync(); });
    this.recBtn = this.button(el, "⏺ rec", () => this.host.toggleRec());
  }

  /** collapsible rail section; open state persists in localStorage */
  private section(rail: HTMLElement, title: string, open = false): HTMLElement {
    const s = document.createElement("div");
    s.className = "sec";
    const h = document.createElement("h2");
    h.textContent = title;
    const tog = document.createElement("span");
    tog.className = "tog";
    h.append(tog);
    h.style.cursor = "pointer";
    const body = document.createElement("div");
    body.className = "secbody";
    const key = "sol.sec." + title;
    const stored = localStorage.getItem(key);
    let isOpen = stored != null ? stored === "1" : open;
    const apply = () => {
      body.style.display = isOpen ? "block" : "none";
      tog.textContent = isOpen ? "▾" : "▸";
    };
    h.addEventListener("click", () => {
      isOpen = !isOpen;
      localStorage.setItem(key, isOpen ? "1" : "0");
      apply();
    });
    apply();
    s.append(h, body);
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
    document.getElementById("rail")!.classList.remove("hidden");
    document.body.classList.remove("railHidden");
    sec.setOpen(true);
    sec.root.scrollIntoView({ block: "nearest", behavior: "smooth" });
    sec.root.classList.add("hl");
  }

  private slider(
    parent: HTMLElement, label: string, min: number, max: number, step: number,
    get: () => number, set: (v: number) => void, fmt: (v: number) => string = v => v.toFixed(2),
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
      const v = get();
      inp.value = String(Number.isFinite(v) ? v : min);
      val.textContent = Number.isFinite(v) ? fmt(v) : "—";
    };
    inp.addEventListener("input", () => { set(parseFloat(inp.value)); update(); });
    row.append(lab, inp, val);
    parent.append(row);
    update();
    this.binds.push({ update });
    return row;
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
    return inp;
  }

  /** activation switch: a render-mode toggle that reads as "this costs GPU" */
  private actSwitch(parent: HTMLElement, label: string, tag: string, get: () => boolean, set: (b: boolean) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = "actswitch";
    row.innerHTML = `<span class="track"><span class="knob"></span></span><span>${label}</span><span class="tag">${tag}</span>`;
    const apply = () => row.classList.toggle("on", get());
    row.addEventListener("click", () => { set(!get()); apply(); this.sync(); });
    parent.append(row);
    apply();
    this.binds.push({ update: apply });
    return row;
  }

  private button(parent: Element, label: string, fn: () => void, cls = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", fn);
    parent.append(b);
    return b;
  }

  private btnRow(parent: HTMLElement): HTMLElement {
    const r = document.createElement("div");
    r.className = "btnrow";
    parent.append(r);
    return r;
  }

  private buildRail() {
    const rail = document.getElementById("rail")!;
    const host = this.host;
    const p = () => host.simParams();

    // ---- presets
    const pre = this.section(rail, "PRESETS", true);
    const prow = this.btnRow(pre);
    for (const name of ["dendrite", "snow", "seaweed", "quasi", "rain", "casting", "bridgman", "weld", "alloy"]) {
      this.button(prow, name, () => { SCENES[name](host); this.sync(); });
    }
    this.only2d.push(this.sections.PRESETS.root);

    // ---- material identity (qualitative parameter bundles)
    const mat = this.section(rail, "MATERIAL");
    const sel = document.createElement("select");
    for (const [key, m] of Object.entries(MATERIALS)) {
      const o = document.createElement("option");
      o.value = key;
      o.textContent = m.label;
      sel.append(o);
    }
    const matNote = document.createElement("div");
    matNote.className = "matnote";
    sel.addEventListener("change", () => { host.setMaterial(sel.value); this.sync(); });
    mat.append(sel, matNote);
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
        matNote.textContent = m3 && map && !map.supported
          ? (map.note3d ?? "")
          : mm?.note ?? "";
      },
    });

    // ---- modes
    const modes = this.section(rail, "MODES");
    const mrow0 = this.btnRow(modes);
    this.button(mrow0, "engineer it (optimizer)", () => { host.startOptimizer(); this.sync(); });
    this.button(mrow0, "⚔ challenge", () => host.startChallenge());
    this.only2d.push(this.sections.MODES.root);

    // ---- melt / process
    const melt = this.section(rail, "MELT · PROCESS", true);
    this.slider(melt, "undercooling", 0.3, 1.0, 0.01, () => host.getUndercool(), v => host.setUndercool(v));
    this.slider(melt, "cooling rate", 0, 0.6, 0.005, () => p().coolRate, v => { p().coolRate = v; });
    this.slider(melt, "nucleation /s", 0, 30, 0.5, () => host.getRain(), v => host.setRain(v), v => v.toFixed(1));
    const mrow = this.btnRow(melt);
    this.button(mrow, "seed", () => host.seedCenter());
    this.only2d.push(this.button(mrow, "twin seed", () => host.twinSeedCenter()));
    this.only2d.push(this.button(mrow, "chill wall", () => host.chillWall("auto")));
    this.button(mrow, "quench ⚡", () => host.quench());
    const annealBtn = this.button(mrow, "anneal ⌛", () => {});
    annealBtn.addEventListener("pointerdown", () => host.anneal(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"])
      annealBtn.addEventListener(ev, () => host.anneal(false));

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
    this.bridgePanel = document.createElement("div");
    this.bridgePanel.className = "subpanel";
    scen.append(this.bridgePanel);
    this.slider(this.bridgePanel, "gradient", 0.02, 0.25, 0.005, () => p().gradG, v => { p().gradG = v; }, v => v.toFixed(3));
    this.slider(this.bridgePanel, "pull speed", 0.3, 5, 0.1, () => p().pullV, v => { p().pullV = v; }, v => v.toFixed(1));
    this.weldPanel = document.createElement("div");
    this.weldPanel.className = "subpanel";
    scen.append(this.weldPanel);
    this.slider(this.weldPanel, "laser power", 150, 1600, 10, () => p().weldPow, v => { p().weldPow = v; }, v => v.toFixed(0));
    this.slider(this.weldPanel, "spot size", 2, 9, 0.5, () => p().weldSig, v => { p().weldSig = v; }, v => v.toFixed(1));
    this.check(this.weldPanel, "auto raster (click melt to steer)", () => host.getWeldAuto(), b => host.setWeldAuto(b));
    this.slider(this.weldPanel, "sweep speed", 10, 140, 2, () => host.getWeldSweep(), v => host.setWeldSweep(v), v => v.toFixed(0));
    this.only2d.push(this.sections.SCENARIO.root);

    // ---- alloy
    const alloy = this.section(rail, "ALLOY");
    this.check(alloy, "dilute alloy (solute field)", () => p().alloyOn === 1, b => {
      p().alloyOn = b ? 1 : 0;
    });
    const arow = this.btnRow(alloy);
    this.button(arow, "⚗ compose alloy…", () => host.openComposer());
    this.alloyPanel = document.createElement("div");
    this.alloyPanel.className = "subpanel";
    alloy.append(this.alloyPanel);
    this.slider(this.alloyPanel, "composition c₀", 0.05, 0.7, 0.01, () => p().c0, v => { p().c0 = v; });
    this.slider(this.alloyPanel, "liquidus slope", 0.1, 0.8, 0.01, () => p().mLiq, v => { p().mLiq = v; });
    this.slider(this.alloyPanel, "solute D", 0.2, 1.5, 0.05, () => p().dSol, v => { p().dSol = v; });
    this.only2d.push(this.sections.ALLOY.root);

    // ---- crystal
    const cr = this.section(rail, "CRYSTAL");
    this.slider(cr, "anisotropy δ", 0, 0.08, 0.001, () => p().delta, v => { p().delta = v; }, v => v.toFixed(3));
    // in 2D, a periodic lattice permits exactly 2-, 3-, 4- and 6-fold rotational
    // symmetry (the crystallographic restriction theorem); 5- and 10-fold are the
    // "forbidden" symmetries only quasicrystals achieve
    const srow = this.btnRow(cr);
    const sym = (j: number, label: string, in3d = false) => {
      const b = this.button(srow, label, () => {
        if (host.getMode() === "3d") host.setSym3(j);
        else p().aniMode = j;
        this.sync();
      });
      b.dataset.j = String(j);
      this.symBtns.push(b);
      if (!in3d) this.only2d.push(b);
    };
    sym(2, "×2");
    sym(3, "×3");
    sym(4, "cubic ×4", true);
    sym(6, "hex ×6", true);
    sym(5, "×5 quasi");
    sym(10, "×10 quasi");
    const symNote = document.createElement("div");
    symNote.className = "matnote";
    symNote.textContent = "2·3·4·6 are the only symmetries a periodic lattice allows — 5 and 10 are quasicrystal territory";
    cr.append(symNote);
    const facetChk = this.check(cr, "faceted growth (cusped ε)", () => p().facet > 0.5, b => { p().facet = b ? 1 : 0; });
    this.only2d.push(facetChk.parentElement as HTMLElement);
    const facNote = document.createElement("div");
    facNote.className = "matnote";
    facNote.textContent = "cusped interface energy pins flat facets — silicon and intermetallics grow this way";
    cr.append(facNote);
    this.only2d.push(facNote);
    this.slider(cr, "tip noise", 0, 0.04, 0.001, () => p().noiseAmp, v => { p().noiseAmp = v; }, v => v.toFixed(3));
    this.slider(cr, "latent heat K", 0.8, 2.2, 0.01, () => p().latent, v => { p().latent = v; });
    this.only2d.push(this.slider(cr, "twin rate", 0, 0.004, 0.0001, () => p().twinProb, v => { p().twinProb = v; },
      v => v > 0 ? `${(v * 1000).toFixed(1)}‰` : "off"));

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
    const palChk = this.check(look, "8-bit palette + dither", () => host.getPalette(), b => host.setPalette(b));
    this.only2d.push(palChk.parentElement as HTMLElement);
    const tiltRow = this.actSwitch(look, "2.5D RELIEF", "RENDER MODE", () => host.getTilt(), b => host.setTilt(b));
    this.only2d.push(tiltRow);
    const tiltNote = document.createElement("div");
    tiltNote.className = "matnote";
    tiltNote.textContent = "raking-light oblique view — same 2D physics, extruded by solidification age · true 3D: flip the TRUE 3D switch";
    look.append(tiltNote);
    this.only2d.push(tiltNote);
    // metallographic staining: tint etchants colour grains by orientation (ETCH lens)
    const stainNote = document.createElement("div");
    stainNote.className = "matnote";
    stainNote.textContent = "grain stain · shows in the ETCH lens";
    look.append(stainNote);
    this.only2d.push(stainNote);
    const stainSel = document.createElement("select");
    ["no stain (plain Nital)", "Klemm's tint etch", "Beraha's tint etch", "anodize + crossed polars"].forEach((label, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = label;
      stainSel.append(o);
    });
    stainSel.addEventListener("change", () => { host.setStain(parseInt(stainSel.value, 10)); this.sync(); });
    look.append(stainSel);
    this.only2d.push(stainSel);
    this.binds.push({ update: () => { stainSel.value = String(host.getStain()); } });
    const ebsdChk = this.check(look, "EBSD flat map (ORIENT lens)", () => host.getEbsd(), b => host.setEbsd(b));
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
    const grow = this.btnRow(sm);
    for (const n of [512, 1024, 2048]) {
      const b = this.button(grow, `${n}²`, () => { host.setGrid(n); this.sync(); });
      this.gridBtns.push(b);
    }
    this.only2d.push(grow);
    const grow3 = this.btnRow(sm);
    for (const n of host.caps3dSizes()) {
      const b = this.button(grow3, `${n}³`, () => { host.setGrid3(n); this.sync(); });
      b.dataset.n = String(n);
      this.grid3Btns.push(b);
    }
    const gridNote3 = document.createElement("div");
    gridNote3.className = "matnote";
    gridNote3.textContent = "192³ = 7.1M voxels — expect ~30 fps; drop to 128³ for full speed";
    sm.append(gridNote3);
    this.only3d.push(grow3, gridNote3);

    // ---- analyze: foundry instruments
    const an = this.section(rail, "ANALYZE");
    this.check(an, "cooling probe (ctrl-tap moves it)", () => this.analyze.probeOn, b => this.analyze.setProbeOn(b));
    this.check(an, "Scheil overlay (needs alloy)", () => this.analyze.scheilOn, b => this.analyze.setScheilOn(b));
    this.check(an, "texture rose (grain orientations)", () => this.analyze.textureOn, b => this.analyze.setTextureOn(b));
    const anrow = this.btnRow(an);
    const rulerBtn = this.button(anrow, "SDAS ruler — drag a line", () => {
      this.analyze.setRulerOn(!this.analyze.rulerOn);
      this.sync();
    });
    this.binds.push({ update: () => rulerBtn.classList.toggle("on", this.analyze.rulerOn) });
    const rres = document.createElement("div");
    rres.className = "matnote";
    an.append(rres);
    this.analyze.attachResultEl(rres);
    this.only2d.push(this.sections.ANALYZE.root);

    // ---- advanced
    const adv = this.section(rail, "ADVANCED");
    this.slider(adv, "interface ε̄", 0.006, 0.016, 0.0005, () => p().epsBar, v => { p().epsBar = v; }, v => v.toFixed(4));
    this.slider(adv, "kinetics γ", 4, 25, 0.5, () => p().gamma, v => { p().gamma = v; }, v => v.toFixed(1));
    this.slider(adv, "driving α", 0.6, 1.0, 0.01, () => p().alpha, v => { p().alpha = v; });
    this.slider(adv, "relax τ ×10⁻⁴", 1.5, 8, 0.1, () => p().tau * 1e4, v => { p().tau = v * 1e-4; }, v => v.toFixed(1));
    this.only2d.push(this.slider(adv, "partition k", 0.05, 0.9, 0.01, () => p().kPart, v => { p().kPart = v; }));
    const shareB = this.button(this.btnRow(adv), "⎘ copy setup link", () => {
      void navigator.clipboard.writeText(host.shareLink()).then(() => {
        shareB.textContent = "copied ✓";
        setTimeout(() => { shareB.textContent = "⎘ copy setup link"; }, 1400);
      });
    });
    const shareNote = document.createElement("div");
    shareNote.className = "matnote";
    shareNote.textContent = "the link restores this exact setup — material, physics dials, lens, even an applied ML recipe";
    adv.append(shareNote);

    // ---- science + contact links
    const sci = document.createElement("a");
    sci.className = "scilink";
    sci.href = "../science/";
    sci.textContent = "the science behind it ↗";
    rail.append(sci);
    const con = document.createElement("a");
    con.className = "scilink";
    con.href = "../contact/";
    con.textContent = "questions · feedback ↗";
    rail.append(con);
  }

  /** refresh all controls + conditional panels from state */
  sync() {
    for (const b of this.binds) b.update();
    const host = this.host;
    const p = host.simParams();
    const m3 = host.getMode() === "3d";

    // mode gating: 2D-only vs 3D-only rows, sections and buttons
    for (const el of this.only2d) el.style.display = m3 ? "none" : "";
    for (const el of this.only3d) el.style.display = m3 ? "" : "none";

    this.viewBtns.forEach((b, i) => {
      b.style.display = m3 ? "none" : "";
      b.classList.toggle("on", !m3 && i === host.getView());
    });
    this.viewBtns3.forEach((b, i) => {
      b.style.display = m3 ? "" : "none";
      b.classList.toggle("on", m3 && i === host.getView3d());
    });
    for (const b of this.symBtns) {
      const j = Number(b.dataset.j);
      b.classList.toggle("on", m3 ? host.getSym3() === j : p.aniMode === j);
    }
    this.grid3Btns.forEach(b => b.classList.toggle("on", Number(b.dataset.n) === host.getGrid3()));
    this.scenBtns.forEach((b, i) => b.classList.toggle("on", i === p.scen));
    this.bridgePanel.style.display = !m3 && p.scen === 1 ? "block" : "none";
    this.weldPanel.style.display = !m3 && p.scen === 2 ? "block" : "none";
    this.alloyPanel.style.display = !m3 && p.alloyOn === 1 ? "block" : "none";
    this.pixelRow.style.display = !m3 && host.getPixel() > 0 ? "flex" : "none";

    this.runBtn.textContent = host.isRunning() ? "⏸ pause" : "▶ run";
    this.runBtn.classList.toggle("accent", !host.isRunning());
    this.turboBtn.classList.toggle("on", host.isTurbo());
    this.recBtn.textContent = host.isRecording() ? "⏹ stop" : "⏺ rec";
    this.recBtn.classList.toggle("rec", host.isRecording());
    document.getElementById("matline")!.textContent =
      host.getAlloyName() + (m3 ? ` · 3D ${host.getGrid3()}³` : "");
    const grids = [512, 1024, 2048];
    this.gridBtns.forEach((b, i) => b.classList.toggle("on", grids[i] === host.getGrid()));

    // armed / paused indicator (the ML mode shows its own status instead)
    const armed = document.getElementById("armed")!;
    if (!host.isRunning() && !host.isEngineering()) {
      armed.style.display = "block";
      armed.textContent = host.simTimeNow() < 1e-9 ? "ARMED — stage your melt, then run" : "PAUSED";
    } else {
      armed.style.display = "none";
    }

    // lens overlays
    const v = host.getView();
    document.getElementById("scalebar")!.style.display = v === 2 ? "flex" : "none";
    document.getElementById("thermbar")!.style.display = v === 5 ? "block" : "none";
    document.getElementById("sembar")!.style.display = v === 6 ? "block" : "none";
  }

  setReadouts(rows: [string, string][]) {
    this.readouts.innerHTML = rows
      .map(([k, v]) => `<div>${k} <b>${v}</b></div>`)
      .join("");
  }
}
