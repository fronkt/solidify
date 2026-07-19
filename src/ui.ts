import type { AppControl } from "./tour";
import { CHAPTERS } from "./tour";
import type { PhysParams } from "./sim";

export interface UIHost extends AppControl {
  simParams(): PhysParams;
  getUndercool(): number;
  setUndercool(v: number): void;
  getRain(): number;
  getSubsteps(): number;
  isRunning(): boolean;
  toggleRun(): void;
  isTurbo(): boolean;
  toggleTurbo(): void;
  getGrid(): number;
  setGrid(n: number): void;
  getView(): number;
  anneal(on: boolean): void;
  clearAll(): void;
}

const VIEW_NAMES = ["MELT", "ORIENT", "ETCH", "FIELD"];

interface SliderBind { update(): void }

export class UI {
  private binds: SliderBind[] = [];
  private viewBtns: HTMLButtonElement[] = [];
  private runBtn!: HTMLButtonElement;
  private turboBtn!: HTMLButtonElement;
  private symBtns: HTMLButtonElement[] = [];
  private gridBtns: HTMLButtonElement[] = [];
  private readouts = document.getElementById("readouts")!;

  constructor(private host: UIHost) {
    this.buildViews();
    this.buildRail();
    document.getElementById("railToggle")!.addEventListener("click", () => {
      document.getElementById("rail")!.classList.toggle("hidden");
      document.body.classList.toggle("railHidden");
    });
  }

  private buildViews() {
    const el = document.getElementById("views")!;
    VIEW_NAMES.forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.addEventListener("click", () => { this.host.setView(i); this.sync(); });
      el.append(b);
      this.viewBtns.push(b);
    });
  }

  private section(rail: HTMLElement, title: string): HTMLElement {
    const s = document.createElement("div");
    s.className = "sec";
    const h = document.createElement("h2");
    h.textContent = title;
    s.append(h);
    rail.append(s);
    return s;
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
    const update = () => { inp.value = String(get()); val.textContent = fmt(get()); };
    inp.addEventListener("input", () => { set(parseFloat(inp.value)); val.textContent = fmt(get()); });
    row.append(lab, inp, val);
    parent.append(row);
    update();
    this.binds.push({ update });
  }

  private button(parent: HTMLElement, label: string, fn: () => void, cls = ""): HTMLButtonElement {
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
    const pre = this.section(rail, "PRESETS");
    const prow = this.btnRow(pre);
    const preset = (label: string, chapterIdx: number) =>
      this.button(prow, label, () => { CHAPTERS[chapterIdx].apply(host); this.sync(); });
    preset("dendrite", 1);
    preset("snow", 2);
    preset("rain", 3);
    preset("casting", 4);

    // ---- melt / process
    const melt = this.section(rail, "MELT · PROCESS");
    this.slider(melt, "undercooling", 0.3, 1.0, 0.01, () => host.getUndercool(), v => host.setUndercool(v));
    this.slider(melt, "cooling rate", 0, 0.6, 0.005, () => p().coolRate, v => { p().coolRate = v; });
    this.slider(melt, "nucleation /s", 0, 30, 0.5, () => host.getRain(), v => host.setRain(v), v => v.toFixed(1));
    const mrow = this.btnRow(melt);
    this.button(mrow, "seed", () => host.seedCenter());
    this.button(mrow, "chill wall", () => host.chillWall());
    const annealBtn = this.button(mrow, "anneal ⌛", () => {});
    annealBtn.addEventListener("pointerdown", () => host.anneal(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"])
      annealBtn.addEventListener(ev, () => host.anneal(false));
    this.button(mrow, "clear", () => host.clearAll(), "warn");

    // ---- crystal
    const cr = this.section(rail, "CRYSTAL");
    this.slider(cr, "anisotropy δ", 0, 0.08, 0.001, () => p().delta, v => { p().delta = v; }, v => v.toFixed(3));
    const srow = this.btnRow(cr);
    const sym = (j: number, label: string) => {
      const b = this.button(srow, label, () => { p().aniMode = j; this.sync(); });
      this.symBtns.push(b);
      return b;
    };
    sym(4, "cubic ×4");
    sym(6, "hex ×6");
    this.slider(cr, "tip noise", 0, 0.04, 0.001, () => p().noiseAmp, v => { p().noiseAmp = v; }, v => v.toFixed(3));
    this.slider(cr, "latent heat K", 0.8, 2.2, 0.01, () => p().latent, v => { p().latent = v; });

    // ---- sim
    const sm = this.section(rail, "ENGINE");
    this.slider(sm, "speed", 1, 60, 1, () => host.getSubsteps(), v => host.setSpeed(v), v => `${v.toFixed(0)}×`);
    const erow = this.btnRow(sm);
    this.runBtn = this.button(erow, "pause", () => { host.toggleRun(); this.sync(); });
    this.turboBtn = this.button(erow, "turbo", () => { host.toggleTurbo(); this.sync(); });
    const grow = this.btnRow(sm);
    for (const n of [512, 1024, 2048]) {
      const b = this.button(grow, `${n}²`, () => { host.setGrid(n); this.sync(); });
      this.gridBtns.push(b);
    }
  }

  /** refresh all controls from state (after tour/preset changes) */
  sync() {
    for (const b of this.binds) b.update();
    this.viewBtns.forEach((b, i) => b.classList.toggle("on", i === this.host.getView()));
    const j = this.host.simParams().aniMode;
    this.symBtns[0]?.classList.toggle("on", j === 4);
    this.symBtns[1]?.classList.toggle("on", j === 6);
    this.runBtn.textContent = this.host.isRunning() ? "pause" : "run";
    this.turboBtn.classList.toggle("on", this.host.isTurbo());
    const grids = [512, 1024, 2048];
    this.gridBtns.forEach((b, i) => b.classList.toggle("on", grids[i] === this.host.getGrid()));
    document.getElementById("scalebar")!.style.display = this.host.getView() === 2 ? "flex" : "none";
  }

  setReadouts(rows: [string, string][]) {
    this.readouts.innerHTML = rows
      .map(([k, v]) => `<div>${k} <b>${v}</b></div>`)
      .join("");
  }
}
