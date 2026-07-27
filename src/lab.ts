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

  constructor(host: LabHost) { this.host = host; }

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
    r.classList.add("hidden");
    const head = document.createElement("div");
    head.className = "frHead";
    const title = document.createElement("span");
    title.textContent = "⚗ RUN REPORT";
    const copy = document.createElement("button");
    copy.textContent = "⎘ copy";
    copy.title = "copy this experiment as a share link";
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.host.labShareLink()).then(() => {
        copy.textContent = "copied ✓";
        setTimeout(() => { copy.textContent = "⎘ copy"; }, 1400);
      });
    });
    const close = document.createElement("button");
    close.textContent = "✕";
    close.addEventListener("click", () => this.toggleResults(false));
    head.append(title, copy, close);
    const body = document.createElement("div");
    body.id = "foundryResultsBody";
    r.append(head, body);
    document.getElementById("app")!.append(r);
    this.resultsPanel = r;
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
    p.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(320px,90vw);" +
      "max-height:calc(100vh - 28px);overflow-y:auto;" +
      "background:rgba(15,17,21,0.93);border:1px solid #262b33;border-radius:8px;padding:14px 16px 12px;" +
      "backdrop-filter:blur(6px);z-index:6;font-size:11px;";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:10px;";
    head.innerHTML = `<span style="letter-spacing:.25em;font-size:10px;font-weight:600;color:#8891a0">⚗ LAB MODE</span>
      <span style="color:#6b7280;font-size:10.5px">set the experiment up, then run it</span>`;
    const exit = document.createElement("button");
    exit.textContent = "exit";
    exit.addEventListener("click", () => this.close());
    head.append(exit);

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
    form.style.cssText = "display:flex;flex-direction:column;gap:9px;margin-bottom:12px;";
    form.append(
      select("atmosphere", ["argon", "vacuum", "air"], this.setup.atmosphere, v => { this.setup.atmosphere = v as LabSetup["atmosphere"]; this.refresh(); }),
      range("inoculant (sites)", 0, 3000, 10, this.setup.inoculant, v => { this.setup.inoculant = v; }),
      // hold above the liquidus fades the refiner: the live readout is the
      // fraction of the added sites that survive settling to the pour
      range("hold before pour", 0, 120, 5, this.setup.holdMin, v => { this.setup.holdMin = v; }, 0,
        v => v <= 0 ? "0 min" : `${v} min · ${(fadeFactor(v) * 100).toFixed(0)} %`),
      // shown in real units: a superheat is kelvin above the liquidus and a mould
      // sits at a temperature, and neither means anything as a bare 0.12
      range("pour superheat", 0, 0.35, 0.01, this.setup.superheat, v => { this.setup.superheat = v; }, 2,
        v => u.known ? `${u.kelvin(v).toFixed(0)} K` : v.toFixed(2)),
      range("mould temperature", -0.2, 0.6, 0.02, this.setup.moldT, v => { this.setup.moldT = v; }, 2,
        v => u.known ? `${u.celsius(v).toFixed(0)} °C` : v.toFixed(2)),
      select("cooling programme", ["furnace", "air", "quench", "soak"], this.setup.program, v => { this.setup.program = v; this.refresh(); }),
      // L4: the pre-pour spec — 0 means no spec, and the card then measures
      // without judging (a verdict against a spec nobody set would be invented)
      range("spec σ_y (as-cast)", 0, specMax, specStep, this.setup.specMPa,
        v => { this.setup.specMPa = v; this.refresh(); }, 0,
        v => v > 0 ? `≥ ${fmtMPa(v)} MPa` : "no spec"),
      this.moldRow = check("mould walls", this.setup.moldWalls, v => { this.setup.moldWalls = v; }),
      this.moldKindRow = select("mould shape", ["shell", "plate", "step", "wedge"], this.setup.mold,
        v => { this.setup.mold = v as MoldKind; }),
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
    const results = document.createElement("button");
    results.id = "foundryResultsBtn";
    results.textContent = "▤ results";
    results.disabled = !this.hasResults;
    results.addEventListener("click", () => this.toggleResults());
    results.addEventListener("animationend", () => results.classList.remove("pulse"));
    this.resultsBtn = results;
    row.append(go, results);

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
    if (this.moldRow) this.moldRow.style.display = three ? "" : "none";
    if (this.moldKindRow) this.moldKindRow.style.display = three ? "" : "none";
    const atmoScope = three
      ? "only what the walls and the porosity look like."
      : "only what the walls look like — porosity is a 3D field, so in 2D the atmosphere "
        + "changes wall nucleation and nothing else.";
    note.innerHTML =
      `<b style="color:#cfd6df">${this.setup.atmosphere}</b> — ${atmoNote(this.setup.atmosphere, three)}. ` +
      "Atmosphere is a melt-cleanliness proxy here, not a nucleation control: it cannot change how " +
      "readily the bulk liquid nucleates, " + atmoScope + this.specNote();
    go.textContent = this.running ? "■ abort" : "▶ pour and run";
    if (!this.statusEl) return;
    if (!this.running) {
      this.statusEl.textContent = this.hasResults
        ? "run finished — ▤ results has the report"
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

  /** the report-card line for hydrogen gas porosity — the real chemistry always,
   *  plus the note that the resulting pore field only appears in the volume */
  private porosityLine(three: boolean): string {
    const por = this.porosity;
    if (!por) return "";
    if (por.note) return `<div style="color:#8891a0">gas porosity: ${por.note}</div>`;
    const cav = three
      ? ""
      : " <span style=\"color:#6b7280\">— the pore field itself is 3D, so run this in the volume to see it</span>";
    return `<div>dissolved hydrogen <b style="color:#cfd6df">${por.cLiquid.toFixed(2)}</b> `
      + `cm³/100 g (Sievert √p, ${this.setup.atmosphere}) → `
      + `<b style="color:#ffb454">${por.cRejected.toFixed(2)}</b> rejected on freezing`
      + (por.pPore > 0.005 ? `, pore bias <b style="color:#cfd6df">${por.pPore.toFixed(3)}</b>` : ", below the pore threshold")
      + cav + `</div>`;
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
      return `<div style="color:#8891a0">hot-tear susceptibility (Clyne–Davies): ${r.notes[0] ?? "not resolvable"}</div>`;
    }
    return `<div>hot-tear susceptibility (Clyne–Davies) CSC <b style="color:#cfd6df">${r.csc.toFixed(2)}</b> `
      + `<span style="color:#6b7280">— t_v ${ms(r.tV!)} / t_r ${ms(r.tR!)} off the global f_s record; a timing ratio, `
      + `not a stress prediction (RDG needs mechanics this solver does not carry)</span></div>`;
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
      return `<br>A spec of ≥ ${fmtMPa(spec)} MPa is dialled, but this material carries no strength `
        + `constants (σ₀, k_HP) — the card will refuse the verdict rather than judge from invented numbers.`;
    }
    if (shownMPa(spec) <= shownMPa(si.s0)) {
      return `<br>The ≥ ${fmtMPa(spec)} MPa spec sits at or under the friction stress σ₀ = `
        + `${fmtMPa(si.s0)} MPa — any grain size meets it.`;
    }
    const dNeedUm = ((si.kHP / (spec - si.s0)) ** 2) * 1e6;
    const fine = dNeedUm < u.micron(2)
      ? ` — finer than this grid resolves (2 cells = ${u.fmtLen(2)}), so at this resolution the spec cannot honestly be met`
      : "";
    return `<br>The ≥ ${fmtMPa(spec)} MPa spec needs d̄ ≤ ${u.fmtLen(u.fromMicron(dNeedUm))} `
      + `(Hall–Petch inverted) — more inoculant, a shorter hold and a faster programme all push finer${fine}.`;
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
    const dim = (s: string) => `<span style="color:#6b7280">${s}</span>`;
    if (!si) {
      // canTreat doctrine: refuse by name rather than judge from invented numbers
      return spec > 0
        ? `<div style="color:#8891a0">spec σ_y ≥ ${fmtMPa(spec)} MPa — this material carries no strength `
          + `constants (σ₀, k_HP), so a Hall–Petch verdict is not modelled here</div>`
        : "";
    }
    const dUm = census ? censusDbarUm(census, three ? "3d" : "2d", this.umAtPour) : 0;
    if (!(dUm > 0)) {
      return spec > 0
        ? `<div style="color:#8891a0">spec σ_y ≥ ${fmtMPa(spec)} MPa — no grain census landed, so there `
          + `is nothing measured to judge it against</div>`
        : "";
    }
    const sig = hallPetch(si, dUm * 1e-6);
    const est = three ? "⟨V⟩-equivalent" : "⟨A⟩-equivalent";
    const u = this.host.units();
    const rows: string[] = [];
    rows.push(`<div>as-cast census: <b style="color:#cfd6df">${census!.grainCount}</b> grains · `
      + `d̄ <b style="color:#cfd6df">${u.fmtLen(u.fromMicron(dUm))}</b>`
      + (census!.astm != null ? ` · ASTM <b style="color:#cfd6df">G ${census!.astm.toFixed(1)}</b>` : "")
      + `</div>`);
    rows.push(`<div>σ_y (Hall–Petch) <b style="color:#cfd6df">${fmtMPa(sig)} MPa</b> `
      + dim(`— grain-size strengthening alone on the measured ${est} d̄: no precipitates, no work `
        + `hardening, and the µm under the √d̄ are the declared resolution`) + `</div>`);
    if (spec > 0) {
      rows.push(shownMPa(sig) >= shownMPa(spec)
        ? `<div>spec σ_y ≥ ${fmtMPa(spec)} MPa — <b style="color:#8fe38f">met</b>: the casting stands at ${fmtMPa(sig)} MPa</div>`
        : `<div>spec σ_y ≥ ${fmtMPa(spec)} MPa — <span style="color:#c96a5b">missed</span>: the casting stands at `
          + `${fmtMPa(sig)} MPa ` + dim(`— a finer pour closes it (more inoculant, a shorter hold, a faster `
            + `programme), and the furnace can only move it further away`) + `</div>`);
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
        return `<tr><td>${label}</td><td colspan="2" style="color:#8891a0">too few grains `
          + `(${s.census.grainCount}) to report d̄</td></tr>`;
      }
      if (!si) {
        return `<tr><td>${label}</td><td colspan="2" style="color:#8891a0">material carries no `
          + `strength constants</td></tr>`;
      }
      const dUm = censusDbarUm(s.census, "3d", this.umAtPour);
      if (!(dUm > 0)) {
        return `<tr><td>${label}</td><td colspan="2" style="color:#8891a0">no census landed</td></tr>`;
      }
      const sig = hallPetch(si, dUm * 1e-6);
      return `<tr><td>${label}</td><td>${u.fmtLen(u.fromMicron(dUm))}</td><td>${fmtMPa(sig)} MPa</td></tr>`;
    }).join("");
    return `<div style="margin:6px 0 8px;padding:8px 10px;border:1px solid #1d222a;border-radius:6px;`
      + `background:rgba(255,255,255,0.015)">`
      + `<div style="letter-spacing:.15em;color:#56d4dd;margin-bottom:5px;font-size:10px">SECTION TABLE — thinnest first</div>`
      + `<div style="color:#6b7280;margin-bottom:5px">one pour, four section thicknesses — a grain `
      + `spanning two sections counts in both, the same thing a metallographer's per-field measurement does</div>`
      + `<table style="width:100%;border-collapse:collapse"><tr style="color:#8891a0">`
      + `<th style="text-align:left">thickness</th><th style="text-align:left">local d̄</th>`
      + `<th style="text-align:left">σ_y</th></tr>${rows}</table></div>`;
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
    head.className = "t";
    head.textContent = title;
    el.append(head);
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
      `<div style="color:#8891a0;margin-bottom:8px">${this.setup.program} · ${this.setup.atmosphere} · superheat `
      + `${uu.known ? uu.kelvin(this.setup.superheat).toFixed(0) + " K" : this.setup.superheat.toFixed(2)}`
      + ` · mould ${uu.known ? uu.fmtC(this.setup.moldT) : this.setup.moldT.toFixed(2)}</div>`);

    const canvas = document.createElement("canvas");
    canvas.id = "foundryCurve";
    canvas.width = 520; canvas.height = 168;
    canvas.style.cssText = "width:100%;height:168px;display:block;background:#0b0d11;border:1px solid #1d222a;border-radius:5px;";
    body.append(Lab.rcard("COOLING CURVE", canvas));

    // ---- thermal analysis, the way a foundry reads the cast-cup curve. Absolute
    // temperatures in °C, intervals in K; everything the routine could not resolve
    // honestly is shown as a dash, never a filled-in guess.
    const Tc = (v: number) => uu.known ? uu.fmtC(v) : "T " + v.toFixed(3);
    const dK = (v: number) => uu.known ? uu.fmtK(v) : "ΔT " + v.toFixed(3);
    const em = "<span style=\"color:#5b636e\">not resolved</span>";
    const cell = (label: string, val: string) =>
      `<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:#8891a0">${label}</span><b style="color:#cfd6df">${val}</b></div>`;
    const ta2 = [
      cell("liquidus arrest T<sub>L</sub>", ta.liquidus ? Tc(ta.liquidus.T) : em),
      cell("nucleation nadir T<sub>N</sub>", ta.nadir ? Tc(ta.nadir.T) : em),
      cell("nucleation undercooling ΔT<sub>N</sub>", ta.undercoolN != null ? `<span style="color:#ffb454">${dK(ta.undercoolN)}</span>` : em),
      cell("recalescence ΔT<sub>r</sub>", ta.recalR != null ? dK(ta.recalR) : em),
      cell("solidus T<sub>S</sub>", ta.solidus ? Tc(ta.solidus.T) : em),
      cell("freezing range T<sub>L</sub>−T<sub>S</sub>", ta.freezeRange != null ? dK(ta.freezeRange) : em),
      cell("local solidification time t<sub>f</sub>", ta.tf != null ? (uu.known ? uu.fmtTime(ta.tf) : "Δt " + ta.tf.toFixed(2)) : em),
      cell("liquid cooling rate", ta.rateLiquid != null ? uu.fmtRate(ta.rateLiquid) : em),
      cell("f<sub>s</sub> from the curve vs the census", ta.fsRms != null ? `±${(ta.fsRms * 100).toFixed(1)} %` : em),
    ].join("");
    body.append(Lab.rcard("COOLING-CURVE ANALYSIS",
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 18px">${ta2}</div>`
      + ta.notes.map(n => `<div style="color:#8891a0;margin-top:5px">— ${n}</div>`).join("")
      + `<div style="color:#6b7280;margin-top:6px;line-height:1.5">The "thermocouple" is the mean temperature of the <i>remaining liquid</i>, not a `
      + `fixed probe: as cold cells freeze they leave the average, so part of any recalescence shown is that selection effect. `
      + `The trace ends at the solidus — past it there is no liquid left to read.</div>`));

    // L4: census, strength and — if a spec was dialled at the pour — the verdict
    const strengthHtml = this.strengthBlock(census, p.scen === 4);
    if (strengthHtml) body.append(Lab.rcard("AS-CAST STRENGTH", strengthHtml));

    if (sections) body.append(Lab.rcard("SECTION TABLE — thinnest first", this.sectionTable(sections)));

    const summaryHtml =
      `<div>nucleation-model ratchet: deepest undercooling <b style="color:#ffb454">`
      + `${uu.known ? uu.fmtK(this.host.maxUndercool()) : "ΔT " + this.host.maxUndercool().toFixed(3)}</b>` +
      ` <span style="color:#6b7280">(the site model's own global measure, alongside the curve's ΔT<sub>N</sub> above)</span></div>` +
      (this.setup.holdMin > 0
        ? `<div>grain refiner: <b style="color:#cfd6df">${this.setup.inoculant}</b> sites added, held `
          + `<b style="color:#cfd6df">${this.setup.holdMin} min</b> above the liquidus → `
          + `<b style="color:#ffb454">${(this.fadeF * 100).toFixed(0)} %</b> survived settling `
          + `(<b style="color:#cfd6df">${this.effInoc}</b> active at pour)</div>`
        : "") +
      `<div>inoculant used <b style="color:#cfd6df">${this.host.nucFired()}</b> of ${this.host.nucMax().toFixed(0)} sites ` +
      `(${this.host.nucMax() > 0 ? ((this.host.nucFired() / this.host.nucMax()) * 100).toFixed(0) : "0"} %)</div>` +
      `<div>final solid fraction <b style="color:#cfd6df">${last ? (last.fs * 100).toFixed(1) : "—"} %</b>` +
      (p.scen === 4 ? " · volume census in the VOLUME · 3D panels" : "") + `</div>` +
      this.cscLine() +
      this.porosityLine(p.scen === 4);
    body.append(Lab.rcard("RUN SUMMARY", summaryHtml));

    body.insertAdjacentHTML("beforeend", this.intervened
      ? `<div style="color:#ffb454">⚠ the operator changed the conditions while this run was in progress — treat it as a demonstration, not a measurement</div>`
      : `<div style="color:#6b7280">conditions held for the whole run</div>`);

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
    const W = canvas.width, H = canvas.height, pad = 22;
    const ts = this.series.map(s => s.t);
    const tMin = Math.min(...ts), tMax = Math.max(...ts) || 1;
    const temps = this.series.filter(s => s.T > 0).map(s => s.T);
    const yMin = Math.min(0, ...temps), yMax = Math.max(1.15, ...temps);
    const X = (t: number) => pad + ((t - tMin) / (tMax - tMin || 1)) * (W - pad * 2);
    const Y = (v: number) => H - pad - ((v - yMin) / (yMax - yMin || 1)) * (H - pad * 2);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "9px ui-monospace,monospace";
    // liquidus
    ctx.strokeStyle = "rgba(255,180,84,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad, Y(1)); ctx.lineTo(W - pad, Y(1)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8891a0";
    ctx.fillText("liquidus", pad + 3, Y(1) - 4);

    // the smoothed derivative trace on its own zeroed axis (right half of the
    // range), so the arrest reads as the moment dT/dt bends toward zero
    if (ta.deriv.length > 2) {
      const ds = ta.deriv.map(d => d.dTdt);
      const dMax = Math.max(1e-6, ...ds.map(Math.abs));
      const Yd = (v: number) => H - pad - ((v / (2 * dMax)) + 0.5) * (H - pad * 2);
      ctx.strokeStyle = "rgba(120,130,145,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ta.deriv.forEach((d, i) => { const x = X(d.t), y = Yd(d.dTdt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.fillText("dT/dt", W - pad - 30, Yd(0) - 3);
    }

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

    // the extracted landmarks
    const mark = (lm: { t: number; T: number } | null, colour: string, label: string, dy: number) => {
      if (!lm) return;
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(X(lm.t), Y(lm.T), 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(label, Math.min(W - pad - 42, X(lm.t) + 5), Y(lm.T) + dy);
    };
    mark(ta.liquidus, "#ffd089", "T_L", -5);
    mark(ta.nadir, "#ff6b6b", "T_N", 12);
    mark(ta.growth, "#8fe38f", "T_G", -5);
    mark(ta.solidus, "#9aa4b2", "T_S", 12);

    ctx.fillStyle = "#6b7280";
    ctx.fillText("melt temperature vs time", pad, 12);
  }

}
