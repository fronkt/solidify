/**
 * LAB MODE — set up an experiment, run it, read the result.
 *
 * The rest of the instrument is a sandbox: you drag sliders and watch the melt
 * answer. That is good for learning what each term does, but it is not how the
 * science is actually done. In a lab you decide the charge, the mould, the
 * superheat and the cooling programme BEFORE anything is poured, then you run
 * it and you get what you get — and the report card at the end is the whole
 * point of the exercise.
 *
 * Nothing here is a new solver. The lab drives the same phase-field the
 * sandbox does, through the set-point cooling scenario (2D scen 3 / 3D scen 4)
 * and the same heterogeneous-nucleation model. What it adds is the discipline
 * of a real experiment: fix the conditions, record the cooling curve, report
 * the microstructure honestly, and say so if the operator interfered.
 */

import { PROGRAMS, ProgramRun, type Program } from "./program";
import type { Units } from "./units";

export interface LabHost {
  getMode(): "2d" | "3d";
  /** the live dimensionless<->SI scaling (units.ts) */
  units(): Units;
  /** the active solver's params — same field names in both dimensions */
  simParams(): Record<string, number>;
  simTimeNow(): number;
  clearMelt(undercool: number): void;
  setInoculant(nmax: number): void;
  setRun(on: boolean): void;
  setView(v: number): void;
  setView3d(v: number): void;
  resetArmed(): void;
  syncUI(): void;
  /** grid edge of the active solver */
  gridN(): number;
  /** mould walls on/off (3D rasterizes a shell; 2D has no mould geometry yet) */
  setMoldWalls(on: boolean): void;
  /** sites that have fired, and the deepest undercooling reached */
  nucFired(): number;
  nucMax(): number;
  maxUndercool(): number;
  /** atmosphere proxy: the fraction of sites that are wall oxide films */
  setFilmSites(frac: number): void;
  labShareLink(): string;
}

export interface LabSetup {
  atmosphere: "air" | "argon" | "vacuum";
  inoculant: number;
  superheat: number;
  moldT: number;
  moldWalls: boolean;
  program: string;
}

export const LAB_DEFAULT: LabSetup = {
  atmosphere: "argon",
  inoculant: 600,
  superheat: 0.12,
  moldT: 0.06,
  moldWalls: true,
  program: "air",
};

interface Sample { t: number; T: number; fs: number; fired: number }

/** `three` gates the porosity clause — porosity is a 3D field only */
const atmoNote = (atmo: string, three: boolean): string => {
  if (atmo === "air") {
    return "oxide films on the melt surface — extra wall nucleation sites"
      + (three ? ", and more porosity" : "");
  }
  return atmo === "argon" ? "clean cover gas: no oxide films" : "clean melt: no oxide films";
};

export class Lab {
  active = false;
  running = false;
  /** the operator changed something mid-run — the report card says so */
  intervened = false;
  setup: LabSetup = { ...LAB_DEFAULT };

  private host: LabHost;
  private panel: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  /** mould-walls row — only the volume has mould geometry, so it hides in 2D */
  private moldRow: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private run = new ProgramRun();
  private series: Sample[] = [];
  private t0 = 0;
  private fingerprint = "";
  private lastFs = 0;
  private plateau = 0;
  /** the sandbox's porosity setting, restored when the lab closes */
  private porePrev: number | null = null;

  constructor(host: LabHost) { this.host = host; }

  /** how strongly a dirty (air) melt seeds its own walls */
  get filmFraction(): number { return this.setup.atmosphere === "air" ? 0.25 : 0; }

  open() {
    if (this.active) return;
    this.active = true;
    this.buildPanel();
  }

  close() {
    this.active = false;
    this.running = false;
    this.run.stop();
    this.panel?.remove();
    this.panel = null;
    this.card?.remove();
    this.card = null;
    const p = this.host.simParams();
    p.scen = 0;
    p.holdRate = 0;
    if (this.porePrev !== null) { p.pPore = this.porePrev; this.porePrev = null; }
    this.host.setFilmSites(0);
    this.host.setMoldWalls(false);
    this.host.syncUI();
  }

  /** pour the charge and start the programme */
  start() {
    const three = this.host.getMode() === "3d";
    const p = this.host.simParams();
    this.card?.remove();
    this.card = null;
    // the lab owns the thermal boundary: set-point cooling, no constant sink
    p.scen = three ? 4 : 3;
    p.coolRate = 0;
    p.heatIn = 0;
    p.weldPow = 0;
    p.moldT = this.setup.moldT;
    this.host.setMoldWalls(this.setup.moldWalls);
    // atmosphere: a melt poured in air entrains oxide films. They give the
    // walls extra (potent, shallow) nucleation sites and they raise the
    // porosity — they do NOT make the bulk liquid easier to nucleate.
    this.host.setFilmSites(this.filmFraction);
    if (this.porePrev === null) this.porePrev = p.pPore ?? null;
    if (this.porePrev !== null) {
      p.pPore = Math.min(1, this.porePrev + (this.setup.atmosphere === "air" ? 0.1 : 0));
    }
    this.host.setInoculant(this.setup.inoculant);
    // pour ABOVE the liquidus: nothing can freeze until the programme cools it
    this.host.clearMelt(-this.setup.superheat);
    const prog: Program = (PROGRAMS[this.setup.program] ?? PROGRAMS.air)(0.55);
    this.t0 = this.host.simTimeNow();
    this.run.start(prog, 1 + this.setup.superheat, this.t0);
    p.holdRate = this.run.coupling;
    p.holdT = 1 + this.setup.superheat;
    this.host.setView(3);        // FIELD: watch the heat leave
    this.host.setView3d(3);
    this.series = [];
    this.lastFs = 0;
    this.plateau = 0;
    this.intervened = false;
    this.fingerprint = this.snapshot();
    this.running = true;
    this.host.setRun(true);
    this.host.syncUI();
    this.refresh();
  }

  abort() {
    if (!this.running) return;
    this.running = false;
    this.run.stop();
    this.host.setRun(false);
    this.refresh();
  }

  /** params the operator is not supposed to touch while an experiment runs */
  private snapshot(): string {
    const p = this.host.simParams();
    const keys = ["latent", "delta", "noiseAmp", "gamma", "alpha", "tau", "epsBar",
      "alloyOn", "c0", "mLiq", "kPart", "dSol", "coolRate", "heatIn", "scen", "twinProb", "facet"];
    return keys.map(k => `${k}=${(p[k] ?? 0).toFixed(4)}`).join(",");
  }

  /** drive the programme; called once per frame with the sim-time delta */
  tick(dtSim: number) {
    if (!this.running) return;
    const p = this.host.simParams();
    const t = this.host.simTimeNow();
    p.holdT = this.run.update(t, dtSim);
    p.holdRate = this.run.coupling;
    if (this.snapshot() !== this.fingerprint) {
      this.intervened = true;
      this.fingerprint = this.snapshot();
    }
  }

  /** a stats readback landed */
  onStats(meanLiqT: number | null, fracSolid: number) {
    if (!this.running) return;
    const t = this.host.simTimeNow() - this.t0;
    this.series.push({ t, T: meanLiqT ?? 0, fs: fracSolid, fired: this.host.nucFired() });
    if (this.series.length > 1200) this.series.splice(0, 400);
    // finished when the casting is solid, or when the programme has run out and
    // the solid fraction has stopped moving
    const still = Math.abs(fracSolid - this.lastFs) < 2e-4;
    this.plateau = still ? this.plateau + 1 : 0;
    this.lastFs = fracSolid;
    if (fracSolid > 0.995 || (this.run.done && this.plateau > 24 && fracSolid > 0.05)) this.finish();
    else this.refresh();
  }

  private finish() {
    this.running = false;
    this.host.setRun(false);
    this.refresh();
    this.showCard();
  }

  // ------------------------------------------------------------------ panel
  private buildPanel() {
    this.panel?.remove();
    const p = document.createElement("div");
    p.id = "foundry";
    p.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(760px,88vw);" +
      "background:rgba(15,17,21,0.93);border:1px solid #262b33;border-radius:8px;padding:10px 14px;" +
      "backdrop-filter:blur(6px);z-index:6;font-size:11px;";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:6px;";
    head.innerHTML = `<span style="letter-spacing:.2em;color:#56d4dd">⚗ LAB MODE</span>
      <span style="color:#8891a0">set the experiment up, then run it</span>`;
    const exit = document.createElement("button");
    exit.textContent = "exit";
    exit.addEventListener("click", () => this.close());
    head.append(exit);

    const u = this.host.units();
    const form = document.createElement("div");
    form.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px 16px;margin-bottom:8px;";
    form.append(
      this.select("atmosphere", ["argon", "vacuum", "air"], this.setup.atmosphere, v => { this.setup.atmosphere = v as LabSetup["atmosphere"]; this.refresh(); }),
      this.range("inoculant (sites)", 0, 3000, 10, this.setup.inoculant, v => { this.setup.inoculant = v; }),
      // shown in real units: a superheat is kelvin above the liquidus and a mould
      // sits at a temperature, and neither means anything as a bare 0.12
      this.range("pour superheat", 0, 0.35, 0.01, this.setup.superheat, v => { this.setup.superheat = v; }, 2,
        v => u.known ? `${u.kelvin(v).toFixed(0)} K` : v.toFixed(2)),
      this.range("mould temperature", -0.2, 0.6, 0.02, this.setup.moldT, v => { this.setup.moldT = v; }, 2,
        v => u.known ? `${u.celsius(v).toFixed(0)} °C` : v.toFixed(2)),
      this.select("cooling programme", ["furnace", "air", "quench", "soak"], this.setup.program, v => { this.setup.program = v; this.refresh(); }),
      this.moldRow = this.check("mould walls", this.setup.moldWalls, v => { this.setup.moldWalls = v; }),
    );

    const note = document.createElement("div");
    note.id = "foundryNote";
    note.style.cssText = "color:#8891a0;line-height:1.55;margin-bottom:8px;";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:center;";
    const go = document.createElement("button");
    go.id = "foundryRun";
    go.textContent = "▶ pour and run";
    go.addEventListener("click", () => (this.running ? this.abort() : this.start()));
    row.append(go);

    const status = document.createElement("div");
    status.id = "foundryStatus";
    status.style.cssText = "margin-top:6px;color:#6b7280;";

    p.append(head, form, note, row, status);
    document.getElementById("app")!.append(p);
    this.panel = p;
    this.statusEl = status;
    this.refresh();
  }

  private refresh() {
    if (!this.panel) return;
    const note = this.panel.querySelector("#foundryNote") as HTMLElement;
    const go = this.panel.querySelector("#foundryRun") as HTMLButtonElement;
    // Two of the setup fields only mean anything in the volume: the mould shell
    // is rasterized 3D geometry, and porosity is a 3D field. Rather than leave
    // a checkbox that does nothing and a note promising porosity that cannot
    // change, the panel says which half of the atmosphere model is live.
    const three = this.host.getMode() === "3d";
    if (this.moldRow) this.moldRow.style.display = three ? "" : "none";
    const atmoScope = three
      ? "only what the walls and the porosity look like."
      : "only what the walls look like — porosity is a 3D field, so in 2D the atmosphere "
        + "changes wall nucleation and nothing else.";
    note.innerHTML =
      `<b style="color:#cfd6df">${this.setup.atmosphere}</b> — ${atmoNote(this.setup.atmosphere, three)}. ` +
      "Atmosphere is a melt-cleanliness proxy here, not a nucleation control: it cannot change how " +
      "readily the bulk liquid nucleates, " + atmoScope;
    go.textContent = this.running ? "■ abort" : "▶ pour and run";
    if (!this.statusEl) return;
    if (!this.running) {
      this.statusEl.textContent = this.series.length
        ? "run finished — read the report card"
        : "ready: the charge is set up but nothing has been poured yet";
      return;
    }
    const last = this.series[this.series.length - 1];
    const uu = this.host.units();
    const T = (v: number) => (uu.known ? uu.fmtC(v) : v.toFixed(2));
    this.statusEl.innerHTML =
      `<b style="color:#cfd6df">${this.run.name}</b> · stage ${this.run.stageIndex + 1}/${this.run.stageCount} ` +
      `(${this.run.stageLabel}) · set-point <b style="color:#cfd6df">${T(this.run.setpoint)}</b>` +
      (last ? ` · melt <b style="color:#cfd6df">${T(last.T)}</b> · solid ${(last.fs * 100).toFixed(1)} %` : "") +
      ` · sites <b style="color:#cfd6df">${this.host.nucFired()}</b>/${this.host.nucMax().toFixed(0)}` +
      ` · ΔT max ${uu.known ? uu.fmtK(this.host.maxUndercool()) : this.host.maxUndercool().toFixed(3)}` +
      (this.intervened ? " · <span style=\"color:#ffb454\">operator intervened</span>" : "");
  }

  // ------------------------------------------------------------ report card
  private showCard() {
    this.card?.remove();
    const c = document.createElement("div");
    c.id = "foundryCard";
    c.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,90vw);" +
      "background:rgba(12,14,18,0.97);border:1px solid rgba(86,212,221,0.4);border-radius:10px;" +
      "padding:16px 18px;z-index:9;font-size:11.5px;line-height:1.7;";
    const arrest = this.arrestPoint();
    const last = this.series[this.series.length - 1];
    const p = this.host.simParams();
    const rows: string[] = [];
    rows.push(`<div style="letter-spacing:.2em;color:#56d4dd;margin-bottom:8px">⚗ RUN REPORT</div>`);
    const uu = this.host.units();
    rows.push(`<div style="color:#8891a0">${this.setup.program} · ${this.setup.atmosphere} · superheat `
      + `${uu.known ? uu.kelvin(this.setup.superheat).toFixed(0) + " K" : this.setup.superheat.toFixed(2)}`
      + ` · mould ${uu.known ? uu.fmtC(this.setup.moldT) : this.setup.moldT.toFixed(2)}</div>`);
    const canvas = document.createElement("canvas");
    canvas.id = "foundryCurve";
    canvas.width = 520; canvas.height = 150;
    canvas.style.cssText = "width:100%;height:150px;margin:10px 0;background:#0b0d11;border:1px solid #1d222a;border-radius:5px;";
    const stats = document.createElement("div");
    stats.innerHTML =
      `<div>deepest undercooling <b style="color:#ffb454">`
      + `${uu.known ? uu.fmtK(this.host.maxUndercool()) : "ΔT " + this.host.maxUndercool().toFixed(3)}</b>` +
      (arrest
        ? ` · recalescence arrest at ${uu.known ? uu.fmtTime(arrest.t) : "t " + arrest.t.toFixed(2)}`
        : " · no recalescence arrest recorded") + `</div>` +
      `<div>inoculant used <b style="color:#cfd6df">${this.host.nucFired()}</b> of ${this.host.nucMax().toFixed(0)} sites ` +
      `(${this.host.nucMax() > 0 ? ((this.host.nucFired() / this.host.nucMax()) * 100).toFixed(0) : "0"} %)</div>` +
      `<div>final solid fraction <b style="color:#cfd6df">${last ? (last.fs * 100).toFixed(1) : "—"} %</b>` +
      (p.scen === 4 ? " · volume census in the VOLUME · 3D panels" : "") + `</div>` +
      (this.intervened
        ? `<div style="color:#ffb454">⚠ the operator changed the conditions while this run was in progress — treat it as a demonstration, not a measurement</div>`
        : `<div style="color:#6b7280">conditions held for the whole run</div>`);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:10px;";
    const copy = document.createElement("button");
    copy.textContent = "⎘ copy this experiment";
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.host.labShareLink()).then(() => {
        copy.textContent = "copied ✓";
        setTimeout(() => { copy.textContent = "⎘ copy this experiment"; }, 1400);
      });
    });
    const done = document.createElement("button");
    done.textContent = "close";
    done.addEventListener("click", () => { this.card?.remove(); this.card = null; });
    row.append(copy, done);
    c.innerHTML = rows.join("");
    c.append(canvas, stats, row);
    document.getElementById("app")!.append(c);
    this.card = c;
    this.drawCurve(canvas);
  }

  /** the temperature minimum the melt recovers from — recalescence */
  private arrestPoint(): Sample | null {
    let best: Sample | null = null;
    for (let i = 2; i < this.series.length - 2; i++) {
      const s = this.series[i];
      if (s.T <= 0) continue;
      if (s.T < this.series[i - 1].T && s.T < this.series[i + 1].T) {
        if (!best || s.T < best.T) best = s;
      }
    }
    return best;
  }

  private drawCurve(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx || this.series.length < 2) return;
    const W = canvas.width, H = canvas.height, pad = 22;
    const ts = this.series.map(s => s.t);
    const tMin = Math.min(...ts), tMax = Math.max(...ts) || 1;
    const temps = this.series.filter(s => s.T > 0).map(s => s.T);
    const yMin = Math.min(0, ...temps), yMax = Math.max(1.15, ...temps);
    const X = (t: number) => pad + ((t - tMin) / (tMax - tMin || 1)) * (W - pad * 2);
    const Y = (v: number) => H - pad - ((v - yMin) / (yMax - yMin || 1)) * (H - pad * 2);
    ctx.clearRect(0, 0, W, H);
    // liquidus
    ctx.strokeStyle = "rgba(255,180,84,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad, Y(1)); ctx.lineTo(W - pad, Y(1)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8891a0";
    ctx.font = "9px ui-monospace,monospace";
    ctx.fillText("liquidus", pad + 3, Y(1) - 4);
    // the cooling curve itself
    ctx.strokeStyle = "#56d4dd";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const s of this.series) {
      if (s.T <= 0) continue;
      const x = X(s.t), y = Y(s.T);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // the arrest
    const a = this.arrestPoint();
    if (a) {
      ctx.fillStyle = "#ffb454";
      ctx.beginPath(); ctx.arc(X(a.t), Y(a.T), 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillText("recalescence", Math.min(W - 74, X(a.t) + 5), Y(a.T) + 12);
    }
    ctx.fillStyle = "#6b7280";
    ctx.fillText("melt temperature vs time", pad, 12);
  }

  // ------------------------------------------------------------- form bits
  private field(label: string): [HTMLElement, HTMLElement] {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;align-items:center;gap:8px;color:#8891a0;";
    const l = document.createElement("span");
    l.textContent = label;
    l.style.cssText = "flex:0 0 118px;";
    row.append(l);
    return [row, row];
  }

  private range(label: string, min: number, max: number, step: number, val: number,
    set: (v: number) => void, digits = 0, fmt?: (v: number) => string) {
    const [row] = this.field(label);
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
    inp.style.cssText = "flex:1;min-width:60px;";
    const out = document.createElement("span");
    const show = (v: number) => (fmt ? fmt(v) : v.toFixed(digits));
    out.textContent = show(val);
    out.style.cssText = "flex:0 0 58px;text-align:right;color:#cfd6df;";
    inp.addEventListener("input", () => {
      const v = parseFloat(inp.value);
      out.textContent = show(v);
      set(v);
    });
    row.append(inp, out);
    return row;
  }

  private select(label: string, opts: string[], val: string, set: (v: string) => void) {
    const [row] = this.field(label);
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;background:#12151a;color:#cfd6df;border:1px solid #262b33;border-radius:4px;padding:2px 4px;";
    for (const o of opts) {
      const op = document.createElement("option");
      op.value = o; op.textContent = o;
      if (o === val) op.selected = true;
      sel.append(op);
    }
    sel.addEventListener("change", () => set(sel.value));
    row.append(sel);
    return row;
  }

  private check(label: string, val: boolean, set: (v: boolean) => void) {
    const [row] = this.field(label);
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = val;
    inp.addEventListener("change", () => set(inp.checked));
    row.append(inp);
    return row;
  }
}
