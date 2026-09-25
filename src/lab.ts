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
import { check, range, select } from "./formbits";
import type { MaterialSI, Units } from "./units";
import { analyseCurve, cscClyneDavies, retain, type ThermalAnalysis } from "./thermal";
import { fadeFactor } from "./nucleation";
import { hydrogenPorosity, type PorosityResult } from "./porosity";
import { hallPetch, fmtMPa, shownMPa } from "./heattreat";
import { censusDbarUm, type Census } from "./heatpanel";
import type { MoldKind } from "./sim3d";
import { LearnLayer, learnSlot, fillLearnSlots, onLearnChange } from "./learn";
import { LAB_CAVEATS, LAB_CARDS, panelHintFor, panelText } from "./learn/panels";
import { THERMAL_LEARN } from "./thermal";
import { token } from "./design/tool";
import { series } from "./design/plot";
import { kv, num, panelHead, pill, quiet, warnWord } from "./design/panel";

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
  /** which mould geometry to rasterize when walls are on — 3D only */
  setMold(kind: MoldKind): void;
  /** sites that have fired, and the deepest undercooling reached */
  nucFired(): number;
  nucMax(): number;
  maxUndercool(): number;
  /** atmosphere proxy: the fraction of sites that are wall oxide films */
  setFilmSites(frac: number): void;
  labShareLink(): string;
  /** a guaranteed-fresh grain census (retries until the readback wins) — the
   *  same measurement the heat-treat panel's verdict stands on */
  measureCensus(): Promise<Census | null>;
  /** M4: step mould only — one Census per section, thinnest first; null for
   *  any other mould */
  measureSections(): Promise<{ heightVox: number; census: Census }[] | null>;
}

export interface LabSetup {
  atmosphere: "air" | "argon" | "vacuum";
  inoculant: number;
  /** minutes the charge is held above its liquidus before pouring — the refiner
   *  fades over this time (nucleation.ts:fadeFactor) */
  holdMin: number;
  superheat: number;
  moldT: number;
  moldWalls: boolean;
  /** which geometry the mould rasterizes when moldWalls is on — 3D only,
   *  meaningful only once poured (Sim3D.setMold) */
  mold: MoldKind;
  program: string;
  /** the pre-pour spec: the yield strength the casting must make as-cast, MPa.
   *  0 means no spec was dialled, and the card then prints measurements without
   *  a verdict — a pass/fail against a spec nobody set would be an invented
   *  judgement (the H6 doctrine, shared with the furnace's dial). */
  specMPa: number;
}

export const LAB_DEFAULT: LabSetup = {
  atmosphere: "argon",
  inoculant: 600,
  holdMin: 0,
  superheat: 0.12,
  moldT: 0.06,
  moldWalls: true,
  mold: "shell",
  program: "air",
  specMPa: 0,
};

interface Sample { t: number; T: number; fs: number; fired: number }

/** `three` gates the porosity clause: porosity is a 3D field only */
const atmoNote = (atmo: string, three: boolean): string => {
  if (atmo === "air") return three ? "oxide films add wall sites and porosity" : "oxide films add wall sites";
  return atmo === "argon" ? "clean cover gas, no oxide films" : "clean melt, no oxide films";
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
  /** the Results button in the setup panel — disabled until a run finishes */
  private resultsBtn: HTMLButtonElement | null = null;
  /** true once a finished run's report has been measured and written into
   *  resultsPanel — gates the Results button, independent of whether the
   *  panel is currently open */
  private hasResults = false;
  /** mould-walls row — only the volume has mould geometry, so it hides in 2D */
  private moldRow: HTMLElement | null = null;
  /** mould-shape row, beside moldRow — same 3D-only visibility */
  private moldKindRow: HTMLElement | null = null;
  /** the mould shape as it stood at the last pour — latched like specAtPour,
   *  so a mid-run shape change (impossible via the UI, but a stale share
   *  link decode shouldn't retroactively relabel a poured casting's card) */
  private moldAtPour: MoldKind = "shell";
  /** the slide-in results panel (#foundryResults) — built once when Lab Mode
   *  opens and persists across pours, mirroring #rail's own lifecycle:
   *  the element stays in the DOM, only its content and a `.hidden` class
   *  change. Never auto-shown; see finish() and the Results button. */
  private resultsPanel: HTMLElement | null = null;
  private run = new ProgramRun();
  private series: Sample[] = [];
  private t0 = 0;
  /** grain-refiner fade applied at the last pour, and the sites it left active */
  private fadeF = 1;
  private effInoc = 0;
  /** hydrogen porosity computed at the last pour */
  private porosity: PorosityResult | null = null;
  /** L4: the spec and the material's strength identity as they stood AT THE
   *  POUR. The dials stay live during a run, and a spec moved after the metal
   *  is in the mould must not rewrite the verdict this charge was committed
   *  to — the same latch H6 gives the furnace. */
  private specAtPour = 0;
  private siAtPour: MaterialSI | null = null;
  private umAtPour = 0;
  /** the material identity the panel's dial ranges were derived from — a swap
   *  while the panel is open rebuilds it, so the spec ceiling is never another
   *  material's (the H7 buildPanel doctrine) */
  private propsAtBuild: MaterialSI | null = null;
  /** last tick's set-point, for the programme-slope the Niyama record needs */
  private envPrev: { t: number; holdT: number } | null = null;
  private fingerprint = "";
  private lastFs = 0;
  private plateau = 0;
  /** the sandbox's porosity setting, restored when the lab closes */
  private porePrev: number | null = null;
  /** learn mode's "i" and hints on the setup panel (rebuilt with it) and the report's */
  private learn = new LearnLayer(() => this.applyLearn());
  private reportLearn = new LearnLayer(() => this.applyLearn());

  constructor(host: LabHost) {
    this.host = host;
    onLearnChange(() => this.applyLearn());
  }

  /** show or hide everything learn mode adds, on both panels */
  private applyLearn() {
    this.learn.apply();
    this.reportLearn.apply();
    fillLearnSlots(this.panel);
    fillLearnSlots(this.resultsPanel);
  }

  /** how strongly a dirty (air) melt seeds its own walls */
  get filmFraction(): number { return this.setup.atmosphere === "air" ? 0.25 : 0; }

  open() {
    if (this.active) return;
    this.active = true;
    this.buildPanel();
    this.buildResultsPanel();
  }

  /**
   * The slide-in report panel — built once per Lab Mode session (open()
   * always runs after a full close()'s teardown, so this never double-
   * builds) and left in the DOM for the rest of the session, mirroring
   * #rail's own lifecycle: the element persists, buildReport() replaces its
   * content, and only a `.hidden` class toggles visibility. Never opened by
   * this method — that is the Results button's job (toggleResults).
   */
  private buildResultsPanel() {
    const r = document.createElement("div");
    r.id = "foundryResults";
    r.className = "tpanel hidden";
    // the header: RUN REPORT, its "i", then copy link and close at the end
    const copy = pill("copy link", () => {
      void navigator.clipboard.writeText(this.host.labShareLink()).then(() => {
        copy.textContent = "copied";
        setTimeout(() => { copy.textContent = "copy link"; }, 1400);
      });
    });
    copy.title = "copy a share link to this setup";
    const close = pill("close", () => this.toggleResults(false));
    const end = document.createElement("span");
    end.className = "pactions";
    end.append(copy, close);
    const head = panelHead("RUN REPORT", end);
    const body = document.createElement("div");
    body.id = "foundryResultsBody";
    // the "i" sits right after the title, and its text between the header and
    // the report body, never inside #foundryResultsBody
    this.reportLearn = new LearnLayer(() => this.applyLearn());
    const ex = this.reportLearn.explain(head, "about the run report", panelText("run report"), end);
    r.append(head, ex.body, body);
    document.getElementById("app")!.append(r);
    this.resultsPanel = r;
    this.applyLearn();
  }

  /** open (default: flip) the results panel — a plain class toggle, the
   *  same mechanism #rail's own hide/show button uses. */
  private toggleResults(open?: boolean) {
    if (!this.resultsPanel) return;
    const willOpen = open ?? this.resultsPanel.classList.contains("hidden");
    this.resultsPanel.classList.toggle("hidden", !willOpen);
  }

  close() {
    this.active = false;
    this.running = false;
    this.run.stop();
    this.panel?.remove();
    this.panel = null;
    this.resultsPanel?.remove();
    this.resultsPanel = null;
    this.hasResults = false;
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
    // a new pour supersedes any previous run's report — showing it here would
    // be exactly the kind of stale-data dishonesty the intervened flag already
    // guards against, so close it and make the Results button earn itself again
    this.resultsPanel?.classList.add("hidden");
    this.hasResults = false;
    // the lab owns the thermal boundary: set-point cooling, no constant sink
    p.scen = three ? 4 : 3;
    p.coolRate = 0;
    p.heatIn = 0;
    p.weldPow = 0;
    p.moldT = this.setup.moldT;
    this.host.setMoldWalls(this.setup.moldWalls);
    this.host.setMold(this.setup.mold);
    this.moldAtPour = this.setup.mold;
    // atmosphere: a melt poured in air entrains oxide films. They give the
    // walls extra (potent, shallow) nucleation sites and they raise the
    // porosity — they do NOT make the bulk liquid easier to nucleate.
    this.host.setFilmSites(this.filmFraction);
    // gas porosity from dissolved hydrogen, via Sievert's law — the atmosphere
    // sets the hydrogen the melt picks up, the liquid→solid solubility drop sets
    // what is rejected on freezing (porosity.ts). Replaces a flat +0.1 air bias.
    if (this.porePrev === null) this.porePrev = p.pPore ?? null;
    this.porosity = hydrogenPorosity(this.host.units().props, this.setup.atmosphere);
    if (this.porePrev !== null) {
      p.pPore = Math.min(1, this.porePrev + this.porosity.pPore);
    }
    // grain-refiner fade: a charge held above its liquidus loses effective
    // nucleant sites to settling and agglomeration before it is even poured
    this.fadeF = fadeFactor(this.setup.holdMin);
    this.effInoc = Math.round(this.setup.inoculant * this.fadeF);
    this.host.setInoculant(this.effInoc);
    // L4: latch the spec and the strength identity of the charge being poured
    const u0 = this.host.units();
    this.specAtPour = this.setup.specMPa > 0 ? this.setup.specMPa : 0;
    this.siAtPour = u0.props;
    this.umAtPour = u0.micron(1);
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
    this.envPrev = null;
    p.envRate = 0;
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
    const prevHold = this.envPrev;
    p.holdT = this.run.update(t, dtSim);
    p.holdRate = this.run.coupling;
    // the set-point's own slope: the CONTINUOUS cooling the programme imposes,
    // which is what the volume's Niyama record uses as its Ṫ — the discrete
    // per-substep relax is bursty because holdT only moves once per frame
    if (prevHold && t > prevHold.t) p.envRate = (p.holdT - prevHold.holdT) / (t - prevHold.t);
    this.envPrev = { t, holdT: p.holdT };
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
    // keep the record within a cap by DECIMATING the whole span, never dropping
    // its head — the old splice threw away the oldest samples, which on a long
    // run silently deleted the liquidus arrest (thermal.ts:retain)
    this.series = retain(this.series, 1200);
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
    // measured now, once, while the sim is paused — never auto-shown; see
    // buildReport() and the Results button
    void this.buildReport();
  }

  // ------------------------------------------------------------------ panel
  private buildPanel() {
    this.panel?.remove();
    const p = document.createElement("div");
    p.id = "foundry";
    // placed and sized by .modepanel (app/index.html), so it can reach neither
    // the rail nor the transport bar, and capped in height under the top
    // chrome (it scrolls past that)
    p.className = "modepanel plate tpanel";
    const exit = pill("exit", () => this.close());
    const head = panelHead("LAB MODE", exit);
    this.learn = new LearnLayer(() => this.applyLearn());
    const ex = this.learn.explain(head, "about lab mode", panelText("lab mode"), exit);

    const u = this.host.units();
    this.propsAtBuild = u.props;
    // L4: the spec dial's ceiling is material-relative at the strength of a
    // 4 µm casting — the furnace dial's own reasoning (a fixed 100 MPa cap is
    // 3× short for steel and 50× too coarse for succinonitrile). A spec dialled
    // under another material's ceiling is clamped into this one's, the H7
    // restore doctrine.
    const specMax = u.props ? Math.ceil(hallPetch(u.props, 4e-6)) : 100;
    const specStep = specMax <= 5 ? 0.1 : specMax <= 100 ? 1 : 5;
    this.setup.specMPa = Math.min(this.setup.specMPa, specMax);
    const form = document.createElement("div");
    form.className = "fbform";
    const rows: HTMLElement[] = [
      select("atmosphere", ["argon", "vacuum", "air"], this.setup.atmosphere, v => { this.setup.atmosphere = v as LabSetup["atmosphere"]; this.refresh(); }),
      range("inoculant sites", 0, 3000, 10, this.setup.inoculant, v => { this.setup.inoculant = v; }),
      // hold above the liquidus fades the refiner: the live readout is the
      // fraction of the added sites that survive settling to the pour
      range("hold before pour", 0, 120, 5, this.setup.holdMin, v => { this.setup.holdMin = v; }, 0,
        v => v <= 0 ? "0 min" : `${v} min · ${(fadeFactor(v) * 100).toFixed(0)} %`),
      // shown in real units: a superheat is kelvin above the liquidus and a mold
      // sits at a temperature, and neither means anything as a bare 0.12
      range("pour superheat", 0, 0.35, 0.01, this.setup.superheat, v => { this.setup.superheat = v; }, 2,
        v => u.known ? `${u.kelvin(v).toFixed(0)} K` : v.toFixed(2)),
      range("mold temperature", -0.2, 0.6, 0.02, this.setup.moldT, v => { this.setup.moldT = v; }, 2,
        v => u.known ? `${u.celsius(v).toFixed(0)} °C` : v.toFixed(2)),
      select("cooling program", ["furnace", "air", "quench", "soak"], this.setup.program, v => { this.setup.program = v; this.refresh(); }),
      // L4: the pre-pour spec. 0 means no spec, and the card then measures
      // without judging (a verdict against a spec nobody set would be invented)
      range("spec σ_y (as-cast)", 0, specMax, specStep, this.setup.specMPa,
        v => { this.setup.specMPa = v; this.refresh(); }, 0,
        v => v > 0 ? `≥ ${fmtMPa(v)} MPa` : "no spec"),
      this.moldRow = check("mold walls", this.setup.moldWalls, v => { this.setup.moldWalls = v; }),
      this.moldKindRow = select("mold shape", ["shell", "plate", "step", "wedge"], this.setup.mold,
        v => { this.setup.mold = v as MoldKind; }),
    ];
    // each row in a grid cell of its own with its learn hint under it (a hint
    // loose in the grid would take a cell of its own), the heat treat form's
    // idiom; the mold rows (3D only) hide with their cell
    for (const el of rows) {
      const cell = document.createElement("div");
      cell.append(el);
      form.append(cell);
      // learn mode: one hint under each control, shown only while it is,
      // matched by the label the row prints
      panelHintFor(this.learn, "lab mode", el);
    }

    const note = document.createElement("div");
    note.id = "foundryNote";
    note.className = "pnote q";

    const row = document.createElement("div");
    row.className = "pactions";
    // the panel's one primary action
    const go = pill("▶ pour and run", () => (this.running ? this.abort() : this.start()), "accent");
    go.id = "foundryRun";
    const results = pill("results", () => this.toggleResults());
    results.id = "foundryResultsBtn";
    results.disabled = !this.hasResults;
    results.addEventListener("animationend", () => results.classList.remove("pulse"));
    this.resultsBtn = results;
    row.append(go, results);

    const status = document.createElement("div");
    status.id = "foundryStatus";
    status.className = "pstatus q";

    p.append(head, ex.body, form, note, row, status);
    document.getElementById("app")!.append(p);
    this.panel = p;
    this.statusEl = status;
    this.refresh();
  }

  private refresh() {
    if (!this.panel) return;
    // L4: the spec ceiling is material-relative, and the lab panel — unlike the
    // furnace's, which rebuilds on every open — stays open across a material
    // swap. Rebuild it so the dial ranges are the new material's. Never
    // mid-run: dials must not jump under the operator, and the verdict is
    // latched at the pour anyway.
    if (this.host.units().props !== this.propsAtBuild && !this.running) {
      this.buildPanel();
      return;
    }
    const note = this.panel.querySelector("#foundryNote") as HTMLElement;
    const go = this.panel.querySelector("#foundryRun") as HTMLButtonElement;
    if (this.resultsBtn) this.resultsBtn.disabled = !this.hasResults;
    // Two of the setup fields only mean anything in the volume: the mould shell
    // is rasterized 3D geometry, and porosity is a 3D field. Rather than leave
    // a checkbox that does nothing and a note promising porosity that cannot
    // change, the panel says which half of the atmosphere model is live.
    const three = this.host.getMode() === "3d";
    // a row and its grid cell hide together: an empty cell would still take
    // a place in the form's grid
    for (const r of [this.moldRow, this.moldKindRow]) {
      if (!r) continue;
      r.style.display = three ? "" : "none";
      if (r.parentElement) r.parentElement.style.display = three ? "" : "none";
    }
    // the atmosphere is a melt-cleanliness proxy, not a nucleation control; the
    // caveat line says so on screen, with its scope in this dimension
    const cav = three ? LAB_CAVEATS.atmosphere3d : LAB_CAVEATS.atmosphere2d;
    note.innerHTML =
      `<b>${this.setup.atmosphere}</b>: ${atmoNote(this.setup.atmosphere, three)}` +
      `<br>${cav.line}${learnSlot(cav.learn)}` + this.specNote();
    fillLearnSlots(note);
    this.learn.apply();
    go.textContent = this.running ? "■ abort" : "▶ pour and run";
    // the filled pill is the panel's primary, never a destructive action:
    // while a pour runs, abort is an outline pill
    go.classList.toggle("accent", !this.running);
    if (!this.statusEl) return;
    if (!this.running) {
      this.statusEl.textContent = this.hasResults ? "done · results ready" : "ready · nothing poured";
      return;
    }
    const last = this.series[this.series.length - 1];
    const uu = this.host.units();
    const T = (v: number) => (uu.known ? uu.fmtC(v) : v.toFixed(2));
    this.statusEl.innerHTML =
      `<b>${this.run.name}</b> · stage ${num(`${this.run.stageIndex + 1}/${this.run.stageCount}`)} ` +
      // the stage's target in the same units as the set-point beside it
      `(${this.run.stageLabel(T)}) · set-point ${num(T(this.run.setpoint))}` +
      (last ? ` · melt ${num(T(last.T))} · solid ${num(`${(last.fs * 100).toFixed(1)} %`)}` : "") +
      ` · sites ${num(`${this.host.nucFired()}/${this.host.nucMax().toFixed(0)}`)}` +
      ` · ΔT max ${num(uu.known ? uu.fmtK(this.host.maxUndercool()) : this.host.maxUndercool().toFixed(3))}` +
      (this.intervened ? ` · ${warnWord("operator intervened")}` : "");
  }

  /** the report-card line for hydrogen gas porosity: the real chemistry always,
   *  plus the note that the resulting pore field only appears in the volume */
  private porosityLine(three: boolean): string {
    const por = this.porosity;
    if (!por) return "";
    if (por.note) return kv("gas porosity", quiet(por.note), learnSlot(por.noteLearn ?? ""));
    const cav = three
      ? ""
      : ` ${quiet(`· ${LAB_CAVEATS.pores2d.line}`)}`;
    return kv("dissolved H", `${num(por.cLiquid.toFixed(2))} `
      + `cm³/100 g (Sievert √p, ${this.setup.atmosphere}) → `
      + `${num(por.cRejected.toFixed(2))} rejected on freezing`
      + (por.pPore > 0.005 ? ` · pore bias ${num(por.pPore.toFixed(3))}` : " · below pore threshold")
      + cav, three ? "" : learnSlot(LAB_CAVEATS.pores2d.learn));
  }

  /**
   * The hot-tearing timing index (Phase D, N5) — Clyne–Davies CSC off the
   * pour's own f_s(t) record. The honest framing is baked into the line: it is
   * a TIMING ratio computed on the GLOBAL record (the index is defined on a
   * local volume element), not a stress prediction — the RDG criterion the
   * roadmap once named needs a strain rate and a Darcy feeding term this
   * solver does not carry, and saying so here is the deliverable.
   */
  private cscLine(): string {
    const r = cscClyneDavies(this.series);
    const uu = this.host.units();
    const ms = (t: number) => uu.known ? uu.fmtTime(t) : `Δt ${t.toFixed(2)}`;
    if (r.csc == null) {
      return kv("hot-tear CSC (Clyne–Davies)", quiet(r.notes[0] ?? "not resolvable"));
    }
    // the two times are numbers, so the mono, inside the quiet caveat line
    return kv("hot-tear CSC (Clyne–Davies)", `${num(r.csc.toFixed(2))} `
      + `${quiet("· t_v")} ${num(ms(r.tV!))} ${quiet("/ t_r")} ${num(ms(r.tR!))} ${quiet(`· ${LAB_CAVEATS.hotTear.line}`)}`,
    learnSlot(LAB_CAVEATS.hotTear.learn));
  }

  /**
   * L4, the pre-pour half of the verdict: what the dialled spec demands, said
   * BEFORE any metal is poured. The furnace's specNote pre-judges an endpoint
   * its law predicts; the lab cannot predict its own census, so it states the
   * requirement instead — Hall–Petch inverted is a target grain size, and
   * every dial that reaches it is in this panel. A spec no honest grain size
   * can meet is named now, not after the charge is spent.
   */
  private specNote(): string {
    const spec = this.setup.specMPa;
    if (!(spec > 0)) return "";
    const u = this.host.units();
    const si = u.props;
    if (!si) {
      const c = LAB_CAVEATS.specNoConstants;
      return `<br>spec ≥ ${fmtMPa(spec)} MPa · ${c.line}${learnSlot(c.learn)}`;
    }
    if (shownMPa(spec) <= shownMPa(si.s0)) {
      return `<br>spec ≥ ${fmtMPa(spec)} MPa: at or under σ₀ ${fmtMPa(si.s0)} MPa, met at any grain size`;
    }
    const dNeedUm = ((si.kHP / (spec - si.s0)) ** 2) * 1e6;
    const tooFine = dNeedUm < u.micron(2);
    const fine = tooFine ? ` · ${LAB_CAVEATS.specTooFine.line} (2 cells = ${u.fmtLen(2)})` : "";
    return `<br>spec ≥ ${fmtMPa(spec)} MPa needs d̄ ≤ ${u.fmtLen(u.fromMicron(dNeedUm))} (Hall–Petch)${fine}`
      + learnSlot(tooFine ? LAB_CAVEATS.specTooFine.learn : LAB_CAVEATS.specNeeds.learn);
  }

  /**
   * L4: the lab finally judges. σ_y = σ₀ + k_HP/√d̄ on the MEASURED census —
   * the same hallPetch, the same ⟨A⟩/⟨V⟩-equivalent d̄ and the same
   * printed-precision verdict the furnace card stands on (heattreat.ts /
   * heatpanel.ts), so one casting can never carry two strengths. The verdict
   * only appears when a spec was dialled at the pour; the arrow on a miss is
   * the lab's own — the furnace can only soften a casting, so a missed as-cast
   * spec is closed by a finer pour, and every lever that pours finer is a dial
   * on this panel.
   */
  private strengthBlock(census: Census | null, three: boolean): string {
    const si = this.siAtPour;
    const spec = this.specAtPour;
    if (!si) {
      // canTreat doctrine: refuse by name rather than judge from invented numbers
      return spec > 0
        ? kv("spec", quiet(`σ_y ≥ ${fmtMPa(spec)} MPa · no strength constants (σ₀, k_HP): no Hall–Petch verdict`),
          learnSlot(LAB_CAVEATS.specNoConstants.learn))
        : "";
    }
    const dUm = census ? censusDbarUm(census, three ? "3d" : "2d", this.umAtPour) : 0;
    if (!(dUm > 0)) {
      return spec > 0 ? kv("spec", quiet(`σ_y ≥ ${fmtMPa(spec)} MPa · no census: not judged`)) : "";
    }
    const sig = hallPetch(si, dUm * 1e-6);
    const est = three ? "⟨V⟩-equivalent" : "⟨A⟩-equivalent";
    const u = this.host.units();
    const rows: string[] = [];
    rows.push(kv("census", `${num(census!.grainCount)} grains · `
      + `d̄ ${num(u.fmtLen(u.fromMicron(dUm)))} ${quiet(`(${est})`)}`
      + (census!.astm != null ? ` · ASTM ${num(`G ${census!.astm.toFixed(1)}`)}` : "")));
    // verify-tools LAB4 parses "σ_y (Hall–Petch) N MPa": the row's label, its
    // one space, then the value
    rows.push(kv("σ_y (Hall–Petch)", `${num(`${fmtMPa(sig)} MPa`)} `
      + quiet(`· ${LAB_CAVEATS.hallPetch.line}`), learnSlot(LAB_CAVEATS.hallPetch.learn)));
    // the verdict word follows " · ", which verify-tools LAB4 keys on; "met"
    // is bright, "missed" a warning (its "!" is CSS, not text)
    if (spec > 0) {
      const specV = num(`${fmtMPa(spec)} MPa`), sigV = num(`${fmtMPa(sig)} MPa`);
      rows.push(shownMPa(sig) >= shownMPa(spec)
        ? kv("spec", `σ_y ≥ ${specV} · <b>met</b>: casting at ${sigV}`)
        : kv("spec", `σ_y ≥ ${specV} · ${warnWord("missed")}: casting at `
          + `${sigV} ` + quiet(`· ${LAB_CAVEATS.missedAsCast.line}`),
        learnSlot(LAB_CAVEATS.missedAsCast.learn)));
    }
    return rows.join("");
  }

  /**
   * M4: the step block's own table — thickness | local d̄ | σ_y, thinnest
   * first. Reuses censusDbarUm/hallPetch verbatim (the L4 machinery above,
   * applied four times) and mirrors heatpanel.ts's own small-N refusal
   * (grainCount < 3) per section rather than inventing a second threshold.
   * A grain spanning two sections counts in both — the same thing a
   * metallographer's per-field measurement does.
   */
  private sectionTable(sections: { heightVox: number; census: Census }[]): string {
    const u = this.host.units();
    const si = this.siAtPour;
    const rows = sections.map(s => {
      const label = u.fmtLen(u.fromMicron(s.heightVox * this.umAtPour));
      if (s.census.grainCount < 3) {
        return `<tr><td class="v">${label}</td><td colspan="2" class="q">too few grains `
          + `(${s.census.grainCount})</td></tr>`;
      }
      if (!si) {
        return `<tr><td class="v">${label}</td><td colspan="2" class="q">no strength constants</td></tr>`;
      }
      const dUm = censusDbarUm(s.census, "3d", this.umAtPour);
      if (!(dUm > 0)) {
        return `<tr><td class="v">${label}</td><td colspan="2" class="q">no census</td></tr>`;
      }
      const sig = hallPetch(si, dUm * 1e-6);
      return `<tr><td class="v">${label}</td><td class="v">${u.fmtLen(u.fromMicron(dUm))}</td><td class="v">${fmtMPa(sig)} MPa</td></tr>`;
    }).join("");
    // the card's own title names it (buildReport); what the table means and
    // why a grain can count twice is the card's learn text
    return `<table class="ptable"><tr><th>thickness</th><th>local d̄</th><th>σ_y</th></tr>${rows}</table>`;
  }

  // ------------------------------------------------------------ report
  /** wrap a titled block of content in the app's existing small-panel card
   *  idiom (.apanel's look, under its own name so it isn't display:none by
   *  default like .apanel is) — the shared unit every report section below
   *  is built from, instead of five different ad hoc boxes. */
  private static rcard(title: string, body: HTMLElement | string): HTMLElement {
    const el = document.createElement("div");
    el.className = "rcard";
    const head = document.createElement("div");
    head.className = "psub";
    head.textContent = title;
    el.append(head);
    // what the card is, for learn mode: an empty slot until it is on
    el.insertAdjacentHTML("beforeend", learnSlot(LAB_CARDS[title] ?? ""));
    if (typeof body === "string") el.insertAdjacentHTML("beforeend", body);
    else el.append(body);
    return el;
  }

  /**
   * Builds the report into #foundryResults (never auto-shown — finish()
   * calls this, then lights up the Results button; the panel itself only
   * opens on a click). Same content as the old showCard(), now split across
   * named cards instead of one concatenated block: Cooling Curve,
   * Cooling-Curve Analysis, As-Cast Strength, Section Table (step mould
   * only), Run Summary — plus a plain-text operator-note footer, which
   * stays a one-line caveat rather than a card of its own.
   */
  private async buildReport() {
    if (!this.resultsPanel) return;
    // L4: the census the verdict stands on — measured now, once, the same
    // guaranteed-fresh readback the furnace card uses
    const census = await this.host.measureCensus();
    // M4: the step block's own per-section census — null for any other mould
    const sections = this.moldAtPour === "step" ? await this.host.measureSections() : null;
    const ta = analyseCurve(this.series);
    const last = this.series[this.series.length - 1];
    const p = this.host.simParams();
    const uu = this.host.units();

    const body = this.resultsPanel.querySelector("#foundryResultsBody") as HTMLElement;
    body.innerHTML = "";
    body.insertAdjacentHTML("beforeend",
      `<div class="psetup q">${this.setup.program} · ${this.setup.atmosphere} · superheat `
      + `${uu.known ? uu.kelvin(this.setup.superheat).toFixed(0) + " K" : this.setup.superheat.toFixed(2)}`
      + ` · mold ${uu.known ? uu.fmtC(this.setup.moldT) : this.setup.moldT.toFixed(2)}</div>`);

    // the plot is media: square-edged, no box around it (DESIGN.md 1.3)
    const canvas = document.createElement("canvas");
    canvas.id = "foundryCurve";
    canvas.width = 520; canvas.height = 168;
    body.append(Lab.rcard("COOLING CURVE", canvas));

    // ---- thermal analysis, the way a foundry reads the cast-cup curve. Absolute
    // temperatures in °C, intervals in K; everything the routine could not resolve
    // honestly is shown as a dash, never a filled-in guess. A spec rail: the
    // label left in --fg-3, the value right in the tabular mono
    const Tc = (v: number) => uu.known ? uu.fmtC(v) : "T " + v.toFixed(3);
    const dK = (v: number) => uu.known ? uu.fmtK(v) : "ΔT " + v.toFixed(3);
    const em = `<span class="q">not resolved</span>`;
    const cell = (label: string, val: string) =>
      `<div class="spec__row"><span class="spec__label">${label}</span> <span class="spec__value">${val}</span></div>`;
    const ta2 = [
      cell("liquidus arrest T<sub>L</sub>", ta.liquidus ? Tc(ta.liquidus.T) : em),
      cell("nucleation nadir T<sub>N</sub>", ta.nadir ? Tc(ta.nadir.T) : em),
      cell("nucleation undercooling ΔT<sub>N</sub>", ta.undercoolN != null ? dK(ta.undercoolN) : em),
      cell("recalescence ΔT<sub>r</sub>", ta.recalR != null ? dK(ta.recalR) : em),
      cell("solidus T<sub>S</sub>", ta.solidus ? Tc(ta.solidus.T) : em),
      cell("freezing range T<sub>L</sub>−T<sub>S</sub>", ta.freezeRange != null ? dK(ta.freezeRange) : em),
      cell("local solidification time t<sub>f</sub>", ta.tf != null ? (uu.known ? uu.fmtTime(ta.tf) : "Δt " + ta.tf.toFixed(2)) : em),
      cell("liquid cooling rate", ta.rateLiquid != null ? uu.fmtRate(ta.rateLiquid) : em),
      cell("f<sub>s</sub> curve vs census (RMS)", ta.fsRms != null ? `±${(ta.fsRms * 100).toFixed(1)} %` : em),
    ].join("");
    const probe = LAB_CAVEATS.probeIsLiquidMean;
    body.append(Lab.rcard("COOLING-CURVE ANALYSIS",
      `<div class="spec spec--tool spec--panel">${ta2}</div>`
      + ta.notes.map(n => `<div class="pline q">· ${n}</div>${learnSlot(THERMAL_LEARN[n] ?? "")}`).join("")
      + `<div class="pline q">${probe.line}</div>${learnSlot(probe.learn)}`));

    // L4: census, strength and, if a spec was dialed at the pour, the verdict
    const strengthHtml = this.strengthBlock(census, p.scen === 4);
    if (strengthHtml) body.append(Lab.rcard("AS-CAST STRENGTH", `<div class="kv">${strengthHtml}</div>`));

    if (sections) body.append(Lab.rcard("SECTION TABLE · THINNEST FIRST", this.sectionTable(sections)));

    // a spec rail: each row's label, one space, then what it says (the gates
    // read the text, which is the sentence the rows always printed)
    const fired = this.host.nucFired(), nMax = this.host.nucMax();
    const summaryHtml =
      kv("ΔT max (site model)",
        num(uu.known ? uu.fmtK(this.host.maxUndercool()) : "ΔT " + this.host.maxUndercool().toFixed(3)),
        learnSlot(LAB_CAVEATS.siteModel.learn)) +
      (this.setup.holdMin > 0
        ? kv("refiner", `${num(this.setup.inoculant)} sites · hold ${num(`${this.setup.holdMin} min`)} → `
          + `${num(`${(this.fadeF * 100).toFixed(0)} %`)} survive (${num(this.effInoc)} active at pour)`,
        learnSlot(LAB_CAVEATS.refinerFade.learn))
        : "") +
      kv("inoculant used", `${num(fired)} of ${num(nMax.toFixed(0))} sites `
        + `(${num(`${nMax > 0 ? ((fired / nMax) * 100).toFixed(0) : "0"} %`)})`) +
      kv("final solid fraction", num(last ? `${(last.fs * 100).toFixed(1)} %` : "—")
        + (p.scen === 4 ? " · 3D census: VOLUME · 3D panels" : "")) +
      this.cscLine() +
      this.porosityLine(p.scen === 4);
    body.append(Lab.rcard("RUN SUMMARY", `<div class="kv">${summaryHtml}</div>`));

    body.insertAdjacentHTML("beforeend", this.intervened
      ? `<div class="pline warnline">${LAB_CAVEATS.intervened.line}</div>${learnSlot(LAB_CAVEATS.intervened.learn)}`
      : `<div class="pline q">conditions held for the whole run</div>`);
    fillLearnSlots(body);

    this.drawCurve(canvas, ta);
    this.hasResults = true;
    // finish() already called refresh() before this measurement landed (it's
    // async), so the status line and the button's disabled state are still
    // showing the pre-finish state until this second pass
    this.refresh();
    if (this.resultsBtn) {
      this.resultsBtn.classList.remove("pulse");
      void this.resultsBtn.offsetWidth;   // restart the animation even if it never finished last time
      this.resultsBtn.classList.add("pulse");
    }
  }

  private drawCurve(canvas: HTMLCanvasElement, ta: ThermalAnalysis) {
    const ctx = canvas.getContext("2d");
    if (!ctx || this.series.length < 2) return;
    // drawn at the size it is shown, in CSS px (the backing store at the
    // device's pixel ratio), so the labels are the 11 px the plot spec asks
    // for rather than a 520 px drawing squeezed into the panel
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth || 368, H = canvas.clientHeight || 168, pad = 22;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ts = this.series.map(s => s.t);
    const tMin = Math.min(...ts), tMax = Math.max(...ts) || 1;
    const temps = this.series.filter(s => s.T > 0).map(s => s.T);
    const yMin = Math.min(0, ...temps), yMax = Math.max(1.15, ...temps);
    const X = (t: number) => pad + ((t - tMin) / (tMax - tMin || 1)) * (W - pad * 2);
    const Y = (v: number) => H - pad - ((v - yMin) / (yMax - yMin || 1)) * (H - pad * 2);
    ctx.clearRect(0, 0, W, H);
    // chrome from the tokens (tick labels Inter 11 px in --fg-3, reference
    // lines --rule-strong); the curve is data, from the plot palette
    ctx.font = `400 11px ${token("--font-body")}`;
    // liquidus: a reference line, chrome
    ctx.strokeStyle = token("--fg-4");
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad, Y(1)); ctx.lineTo(W - pad, Y(1)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = token("--fg-3");
    ctx.fillText("liquidus", pad + 3, Y(1) - 4);

    // the smoothed derivative trace on its own zeroed axis (right half of the
    // range), so the arrest reads as the moment dT/dt bends toward zero
    if (ta.deriv.length > 2) {
      const ds = ta.deriv.map(d => d.dTdt);
      const dMax = Math.max(1e-6, ...ds.map(Math.abs));
      const Yd = (v: number) => H - pad - ((v / (2 * dMax)) + 0.5) * (H - pad * 2);
      ctx.strokeStyle = token("--rule-strong");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ta.deriv.forEach((d, i) => { const x = X(d.t), y = Yd(d.dTdt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = token("--fg-3");
      ctx.fillText("dT/dt", W - pad - 30, Yd(0) - 3);
    }

    // the cooling curve itself (data: the palette's first slot, the same
    // color as the probe's curve in the analysis column)
    ctx.strokeStyle = series(0);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const s of this.series) {
      if (s.T <= 0) continue;
      const x = X(s.t), y = Y(s.T);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // the extracted landmarks: each dot is labeled (T_L, T_N, T_G, T_S), so
    // it needs no hue of its own: --fg dots on the trace, --fg-2 labels (a
    // red nadir would read as an error)
    const mark = (lm: { t: number; T: number } | null, label: string, dy: number) => {
      if (!lm) return;
      ctx.fillStyle = token("--fg");
      ctx.beginPath(); ctx.arc(X(lm.t), Y(lm.T), 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = token("--fg-2");
      ctx.fillText(label, Math.min(W - pad - 42, X(lm.t) + 5), Y(lm.T) + dy);
    };
    mark(ta.liquidus, "T_L", -5);
    mark(ta.nadir, "T_N", 12);
    mark(ta.growth, "T_G", -5);
    mark(ta.solidus, "T_S", 12);

    ctx.fillStyle = token("--fg-3");
    ctx.fillText("melt temperature vs time", pad, 12);
  }

}
