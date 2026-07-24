/**
 * HEAT TREAT — the panel that drives the second clock.
 *
 * `heattreat.ts` owns the physics: a real schedule in seconds and °C, the
 * Arrhenius integrals over its whole trajectory, and the budget→sweeps map
 * through the measured `K_MC` and `M_MODEL`. This panel owns nothing but the
 * conversation: read the casting's own census for the starting grain size,
 * show what the material's sourced law predicts for the dialled schedule,
 * refuse the schedules the model cannot honestly run — with the analytic
 * answer still printed — and, when the run is legal, spend the sweeps and
 * report the measured before/after against the prediction.
 *
 * Three rules inherited from the plan, all load-bearing:
 *
 * 1. **The solidification loop is stopped for the duration.** φ frozen is the
 *    definition of solid state; the interlock lives in the host's `setRun`,
 *    which refuses to restart while `busy` is set.
 * 2. **The Monte Carlo temperature is never shown.** It is a numerical
 *    parameter, not the furnace — the furnace enters only through the sweep
 *    count. A panel that printed kT next to °C would be inviting exactly the
 *    confusion the model exists to avoid.
 * 3. **The hold is isothermal by construction.** The solver's T field is the
 *    as-cast record, not the furnace, so a thermal lens during a treatment
 *    would show a cold casting labelled 540 °C. The panel parks the view on
 *    ETCH — which is also where boundary migration is visible — and says why.
 */

import {
  canTreat, domainLimitUm, grainAfter, integrate, sweepsFor, frac,
  scaleThickness, decarbDepth,
  INCIPIENT_FRAC, K_MC, M_MODEL, K_MC_3D, M_MODEL_3D, ROOM_C,
  type HeatSchedule, type TreatContext, type Integrals,
} from "./heattreat";
import { K0, type MaterialSI } from "./units";
import { HOMOG_D2 } from "./shaders";
import { HOMOG_D3 } from "./shaders3d";
import { range } from "./formbits";

/** the slice of a stats readback the panel needs — both dimensions can fill it */
export interface Census {
  fracSolid: number;
  grainCount: number;
  /** 2D: mean grain area, px² — the ⟨A⟩-equivalent diameter comes from this */
  meanAreaPx: number;
  /** 3D: mean grain volume, vox³ — the ⟨V⟩-equivalent diameter comes from this */
  meanVolVox?: number;
  astm: number | null;
}

export interface HeatHost {
  getMode(): "2d" | "3d";
  materialKey(): string;
  materialLabel(): string;
  si(): MaterialSI | null;
  alloyOn(): boolean;
  /** does the material grow on a cubic lattice in 3D? (the Σ3 gate) */
  cubic(): boolean;
  gridN(): number;
  umPerCell(): number;
  /** a guaranteed-fresh census (retries until the readback wins) */
  measure(): Promise<Census | null>;
  /**
   * run Monte Carlo sweeps on the grain field; `onProgress` returning false
   * aborts at the next drain. Resolves to the sweeps actually delivered.
   */
  anneal(sweeps: number, onProgress: (done: number) => boolean): Promise<number>;
  /**
   * 3D only: the same sweeps with Σ3 annealing-twin spawning enabled — the
   * host budgets the per-flip probability from the remaining id range and
   * reports what was actually delivered, including allocator saturation.
   */
  annealTwins?(sweeps: number, onProgress: (done: number) => boolean):
    Promise<{ delivered: number; spawned: number; saturated: boolean }>;
  /** masked solute diffusion at frozen φ; resolves iterations delivered */
  homogenize(iters: number, onProgress: (done: number) => boolean): Promise<number>;
  /** RMS deviation of the solute field over solid — the measured segregation */
  segregation(): Promise<{ rms: number; mean: number } | null>;
  setRun(on: boolean): void;
  getView(): number;
  setView(v: number): void;
  syncUI(): void;
}

/**
 * The computational ceiling, 2D. A sweep is four sublattice dispatches and its
 * own submit (the RNG must differ between sweeps — see `sim.anneal`), so the
 * cost is submit overhead, not arithmetic: ~20 000 sweeps is a few seconds of
 * wall clock. A schedule that asks for more is run to the cap and the card
 * says it was truncated and at what fraction — never silently clipped.
 */
export const SWEEP_CAP_2D = 20_000;

/**
 * The volume's ceiling is 10× lower: a 3D sweep is eight dispatches over up to
 * 7 M voxels, so arithmetic — not submit overhead — is the cost, and 2 000
 * sweeps is the same few seconds of wall clock. The truncation doctrine is
 * identical. In practice the DOMAIN limit bites first: the 192³ specimen is
 * 188 µm across, so most real anneal schedules are refused with their analytic
 * answer printed rather than truncated.
 */
export const SWEEP_CAP_3D = 2_000;

/**
 * Homogenization iteration ceilings. The explicit-diffusion cost wall the plan
 * names: iterations go as Dt/(cell²·D_h), which is thousands at the Kobayashi
 * pitch and millions under calibrated mode's 0.087 µm cell. Run what fits and
 * report the achieved fraction beside the requested — never silently fewer.
 */
export const HOMOG_CAP_2D = 40_000;
export const HOMOG_CAP_3D = 4_000;

/** heating and cooling ramps the panel's schedule uses, °C/min — furnace-realistic */
const RAMP_UP = 10;
const RAMP_DOWN = 5;

/**
 * Lenses parked during a treatment, per dimension — rule 3. 2D: MELT/FIELD/
 * THERM read the T field, which is the as-cast record, not the furnace; the
 * treatment parks them on ETCH, where boundary migration is visible anyway.
 * 3D: MELT's surface ember and THERM's emission are the thermal readouts
 * (FIELD is x-ray transmittance there, not temperature); parked to ORIENT,
 * where the grains carry their id hues and migration is visible.
 */
const THERMAL_LENSES_2D = [0, 3, 5];
const ETCH = 2;
const THERMAL_LENSES_3D = [0, 6];
const ORIENT3 = 1;

type Plan =
  | { ok: false; why: string }
  | {
      ok: true;
      sch: HeatSchedule;
      ints: Integrals;
      d0Um: number;
      /** the material law's endpoint for this schedule */
      dPredUm: number;
      sweeps: number;
      /** the cap bit: sweeps actually runnable, and the model endpoint they reach */
      capped: boolean;
      dCapUm: number;
    };

export class HeatPanel {
  active = false;
  /**
   * A treatment is consuming the GPU. The host's `setRun` refuses to restart
   * the solidification loop while this is set — that refusal IS the
   * solver-paused interlock, and it catches the space bar and the transport
   * button as well as this panel's own controls.
   */
  busy = false;

  private host: HeatHost;
  private panel: HTMLElement | null = null;
  private noteEl: HTMLElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private reportEl: HTMLElement | null = null;
  /** which material the form's dial ranges were built for */
  private builtFor = "";
  /**
   * the panel's own census cache: seeded by a fresh measurement on open,
   * refreshed by the frame loop's 4 Hz poll while the panel sits idle — so the
   * prediction tracks a casting that is still being poured, and the panel does
   * not depend on the animation loop to become usable
   */
  private census: Census | null = null;
  private tC = 500;
  private holdMin = 60;
  private abortReq = false;
  /** exit pressed mid-run: abort first, close when the run loop hands back */
  private closeReq = false;

  constructor(host: HeatHost) { this.host = host; }

  open() {
    if (this.active) return;
    this.active = true;
    this.buildPanel();
    void this.host.measure().then(c => {
      if (c) this.census = c;
      this.refresh();
    });
  }

  close() {
    // mid-run the exit is an abort request; the run loop closes up afterwards
    if (this.busy) { this.abortReq = true; this.closeReq = true; return; }
    this.active = false;
    this.panel?.remove();
    this.panel = null;
    // the cache dies with the panel: a census outliving a close can belong to
    // the OTHER dimension after a mode switch, and a 3D plan reading a 2D
    // census computes d₀ = 0 µm with a straight face (caught by HT3-PANEL)
    this.census = null;
    this.host.syncUI();
  }

  /** the frame loop's 4 Hz census lands here — keeps the prediction honest */
  onCensus(c: Census) {
    if (!this.active || this.busy) return;
    this.census = c;
    // the dial ranges are material-relative; a material swap rebuilds the form
    if (this.host.materialKey() !== this.builtFor) this.buildPanel();
    else this.refresh();
  }

  // -------------------------------------------------------------- the plan

  /**
   * Mean grain diameter, µm, in the measure each dimension's census reports:
   * ⟨A⟩-equivalent circle in the plane, ⟨V⟩-equivalent sphere in the volume.
   * The two differ by an O(1) stereological factor from the mean linear
   * intercept the tabulated laws use — the honesty row the plan names.
   */
  private dBar(c: Census): number {
    if (this.host.getMode() === "3d") {
      const v = c.meanVolVox ?? 0;
      return v > 0 ? Math.cbrt((6 * v) / Math.PI) * this.host.umPerCell() : 0;
    }
    return c.meanAreaPx > 0 ? 2 * Math.sqrt(c.meanAreaPx / Math.PI) * this.host.umPerCell() : 0;
  }

  /** the model constants and the compute ceilings for the dimension on stage */
  private consts() {
    const m3 = this.host.getMode() === "3d";
    return m3
      ? { kMC: K_MC_3D, mModel: M_MODEL_3D, cap: SWEEP_CAP_3D, dH: HOMOG_D3, iterCap: HOMOG_CAP_3D }
      : { kMC: K_MC, mModel: M_MODEL, cap: SWEEP_CAP_2D, dH: HOMOG_D2, iterCap: HOMOG_CAP_2D };
  }

  private schedule(): HeatSchedule {
    return {
      name: "panel schedule",
      startC: ROOM_C,
      stages: [
        { kind: "ramp", toC: this.tC, cPerMin: RAMP_UP },
        { kind: "hold", minutes: this.holdMin },
        { kind: "ramp", toC: ROOM_C, cPerMin: RAMP_DOWN },
      ],
    };
  }

  /**
   * Everything the run button needs to know, computed fresh from the live
   * census and the current dials. Refusals come back as sentences because
   * every one of them is a teaching point, not an error code.
   */
  /** the refusal context, built the same way for every process */
  private ctx(c: Census): TreatContext {
    return {
      si: this.host.si(),
      key: this.host.materialKey(),
      alloy: this.host.alloyOn(),
      dim: this.host.getMode(),
      cubic: this.host.cubic(),
      solidFraction: c.fracSolid,
    };
  }

  private plan(c: Census | null): Plan {
    // no census yet is NOT "nothing solid" — before the first measurement
    // lands, the panel does not know what is on stage and must not claim to
    if (!c) return { ok: false, why: "waiting for the first grain census…" };
    const si = this.host.si();
    const ctx = this.ctx(c);
    const v = canTreat("grain", ctx);
    if (!v.ok) return { ok: false, why: v.why };
    if (!si) return { ok: false, why: "no SI identity." }; // canTreat already said it better
    if (c.grainCount < 3) {
      return {
        ok: false,
        why: `a starting grain size needs at least three grains to mean anything, and this `
          + `casting has ${c.grainCount}. Pour a finer casting (add inoculant) first.`,
      };
    }

    const sch = this.schedule();
    const ints = integrate(sch, si);
    if (ints.peakFracTm >= INCIPIENT_FRAC) {
      return {
        ok: false,
        why: `${this.tC.toFixed(0)} °C is ${(ints.peakFracTm * 100).toFixed(0)} % of the melting point. `
          + `Past ${(INCIPIENT_FRAC * 100).toFixed(0)} % the grain boundaries liquate — incipient melting — `
          + `and a model that holds φ frozen cannot honestly integrate a schedule that would have melted the specimen.`,
      };
    }

    const d0Um = this.dBar(c);
    const dPredUm = grainAfter(d0Um * 1e-6, ints.gg, si) * 1e6;
    const limUm = domainLimitUm(this.host.gridN(), this.host.umPerCell());
    if (dPredUm > limUm) {
      return {
        ok: false,
        why: `the law says ${fmtUm(dPredUm)}: `
          + `D^n − D₀^n = ∫k·dt with this material's sourced coefficients predicts `
          + `${fmtUm(d0Um)} → ${fmtUm(dPredUm)} over ${fmtDur(ints.seconds)}. But grain statistics on this `
          + `${fmtUm(this.host.gridN() * this.host.umPerCell())} specimen stop meaning anything past ~${fmtUm(limUm)} `
          + `— the model refuses to pretend otherwise. Shorten the schedule or cool it down.`,
      };
    }

    const { kMC, mModel, cap } = this.consts();
    const sweepsExact = sweepsFor(d0Um, dPredUm, this.host.umPerCell(), kMC, mModel);
    const sweeps = Math.round(sweepsExact);
    const capped = sweeps > cap;
    // the model endpoint the truncated run reaches — its own law, inverted
    const d0Cells = d0Um / this.host.umPerCell();
    const dCapUm = capped
      ? Math.pow(Math.pow(d0Cells, mModel) + kMC * cap, 1 / mModel) * this.host.umPerCell()
      : dPredUm;
    return { ok: true, sch, ints, d0Um, dPredUm, sweeps, capped, dCapUm };
  }

  // -------------------------------------------------------------- the panel

  private buildPanel() {
    this.panel?.remove();
    const si = this.host.si();
    const tmC = si ? si.Tm - K0 : 1000;
    this.builtFor = this.host.materialKey();
    // default: the classic full anneal, 0.85 T_m (absolute) — hot enough that
    // boundaries actually move, comfortably under the incipient-melting gate
    this.tC = Math.round(frac(tmC, 0.85) / 5) * 5;

    const p = document.createElement("div");
    p.id = "heattreat";
    p.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(700px,88vw);" +
      "background:rgba(15,17,21,0.93);border:1px solid #262b33;border-radius:8px;padding:10px 14px;" +
      "backdrop-filter:blur(6px);z-index:6;font-size:11px;";

    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:6px;";
    head.innerHTML = `<span style="letter-spacing:.2em;color:#ffb454">♨ HEAT TREAT</span>
      <span style="color:#8891a0">the second clock — solid state, real hours, on <b style="color:#cfd6df">${this.host.materialLabel()}</b></span>`;
    const exit = document.createElement("button");
    exit.textContent = "exit";
    exit.addEventListener("click", () => this.close());
    head.append(exit);

    const form = document.createElement("div");
    form.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px 16px;margin-bottom:8px;";
    form.append(
      range("temperature", 100, Math.round(tmC), 5, this.tC,
        v => { this.tC = v; this.refresh(); }, 0,
        v => si ? `${v.toFixed(0)} °C · ${((v + K0) / si.Tm).toFixed(2)} T_m` : `${v.toFixed(0)} °C`),
      range("hold time", 1, 720, 1, this.holdMin,
        v => { this.holdMin = v; this.refresh(); }, 0,
        v => v < 120 ? `${v.toFixed(0)} min` : `${(v / 60).toFixed(1)} h`),
    );

    const note = document.createElement("div");
    note.id = "htNote";
    note.style.cssText = "color:#8891a0;line-height:1.55;margin-bottom:8px;";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:center;";
    const go = document.createElement("button");
    go.id = "htRun";
    go.textContent = "♨ run treatment";
    go.addEventListener("click", () => (this.busy ? (this.abortReq = true) : void this.run()));
    const status = document.createElement("span");
    status.id = "htStatus";
    status.style.cssText = "color:#6b7280;";
    row.append(go, status);

    const report = document.createElement("div");
    report.id = "htReport";
    report.style.cssText = "margin-top:6px;color:#8891a0;line-height:1.55;";

    p.append(head, form, note, row, report);
    document.getElementById("app")!.append(p);
    this.panel = p;
    this.noteEl = note;
    this.runBtn = go;
    this.statusEl = status;
    this.reportEl = report;
    this.refresh();
  }

  private refresh() {
    if (!this.panel || !this.noteEl || !this.runBtn) return;
    this.runBtn.textContent = this.busy ? "■ abort" : "♨ run treatment";
    if (this.busy) return; // the run loop owns the status line
    const plan = this.plan(this.census);
    if (!plan.ok) {
      this.noteEl.innerHTML = `<span style="color:#c96a5b">refused</span> — ${plan.why}`;
      this.runBtn.disabled = true;
      return;
    }
    this.runBtn.disabled = false;
    const { ints, d0Um, dPredUm, sweeps, capped, dCapUm } = plan;
    const grew = dPredUm - d0Um > 0.05;
    const head =
      `ramp ${RAMP_UP} °C/min → hold ${fmtDur(this.holdMin * 60)} at ${this.tC.toFixed(0)} °C `
      + `→ furnace-cool ${RAMP_DOWN} °C/min · ${fmtDur(ints.seconds)} of real time.`;
    if (!grew) {
      // the stress-relief case: the arithmetic says nothing happens, so the
      // panel says it BEFORE the run rather than selling a dud treatment
      this.noteEl.innerHTML = `${head}<br>predicts <b style="color:#cfd6df">no measurable grain growth</b> `
        + `(${fmtUm(d0Um)} → ${fmtUm(dPredUm)}) — at this temperature every Arrhenius integral is negligible. `
        + `Run it if you want the report card to say so.`;
      return;
    }
    this.noteEl.innerHTML = `${head}<br>the sourced law predicts d̄ `
      + `<b style="color:#cfd6df">${fmtUm(d0Um)} → ${fmtUm(dPredUm)}</b>`
      + ` · ${sweeps.toLocaleString()} MC sweeps`
      + (capped
        ? ` — <span style="color:#ffb454">past the ${this.consts().cap.toLocaleString()}-sweep budget: the run will be `
        + `truncated at ${((this.consts().cap / sweeps) * 100).toFixed(0)} % and reach ~${fmtUm(dCapUm)}</span>`
        : "");
  }

  // ---------------------------------------------------------------- the run

  private async run() {
    if (this.busy) return;
    // latch busy BEFORE the awaits below: a second click during the fresh
    // census would otherwise start a second treatment on the same casting
    this.busy = true;
    this.abortReq = false;
    this.host.setRun(false);
    // the on-screen census may be a quarter second stale — a run decision
    // deserves a fresh one (equal panel-cadence is not equal state), and the
    // loop is already stopped so it measures a still field
    const before = await this.host.measure();
    if (before) this.census = before;
    const plan = this.plan(before);
    if (!plan.ok || !before) {
      this.busy = false;
      this.refresh();
      return;
    }
    // rule 3: the T field is the as-cast record, not the furnace — park the
    // view where the treatment is actually visible
    const m3 = this.host.getMode() === "3d";
    if ((m3 ? THERMAL_LENSES_3D : THERMAL_LENSES_2D).includes(this.host.getView()))
      this.host.setView(m3 ? ORIENT3 : ETCH);
    this.host.syncUI();
    this.refresh();

    const total = Math.min(plan.sweeps, this.consts().cap);
    const setStatus = (s: string) => { if (this.statusEl) this.statusEl.textContent = s; };
    // annealing twins are not a dial: the environment decides. Boundaries are
    // about to migrate; on a low-SFE cubic lattice in the volume they deposit
    // Σ3 twins as they go. The card explains a refusal only in 3D — in the
    // plane the question does not arise, and repeating "a Σ3 is a 3D rotation"
    // on every 2D report card would be noise, not teaching.
    const twinV = m3 ? canTreat("twins", this.ctx(before)) : null;
    const wantTwins = twinV?.ok === true && !!this.host.annealTwins;
    let delivered = 0;
    let twinLine = twinV && !twinV.ok ? twinV.why : "";
    let homogLine = "";
    try {
      if (total > 0) {
        const onProg = (done: number) => {
          setStatus(`sweep ${done.toLocaleString()} / ${total.toLocaleString()} — hold is isothermal by construction`);
          return !this.abortReq;
        };
        if (wantTwins) {
          const r = await this.host.annealTwins!(total, onProg);
          delivered = r.delivered;
          twinLine = r.spawned > 0
            ? `${r.spawned.toLocaleString()} Σ3 annealing twins nucleated on migrating boundaries`
              + (r.saturated ? " — the grain-id range ran out mid-anneal, so this is the delivered count, not the requested rate" : "")
            : "no annealing twins this run — boundaries migrated too little to deposit any";
        } else {
          delivered = await this.host.anneal(total, onProg);
        }
      }
      // homogenization rides the same treatment: the schedule's Dt product,
      // spent as masked diffusion iterations through the solid skeleton
      const hv = canTreat("homogenize", this.ctx(before));
      if (!hv.ok) {
        homogLine = hv.why;
      } else if (!this.abortReq) {
        const { dH, iterCap } = this.consts();
        const cellM = this.host.umPerCell() * 1e-6;
        const need = Math.round(plan.ints.dt / (cellM * cellM * dH));
        if (need < 2) {
          homogLine = `Dt ${fmtDt(plan.ints.dt)} — under one cell² of diffusion; nothing measurable at this resolution`;
        } else {
          const run = Math.min(need, iterCap);
          const segB = await this.host.segregation();
          const gotI = await this.host.homogenize(run, done => {
            setStatus(`diffusion ${done.toLocaleString()} / ${run.toLocaleString()} iterations — solute through the solid skeleton`);
            return !this.abortReq;
          });
          const segA = await this.host.segregation();
          homogLine = `Dt ${fmtDt(plan.ints.dt)} · ${gotI.toLocaleString()} iterations`
            + (need > iterCap
              ? ` — the schedule asked ${need.toLocaleString()}, the budget allows ${iterCap.toLocaleString()} `
                + `(${((iterCap / need) * 100).toFixed(0)} % of the requested Dt delivered)`
              : "")
            + (segB && segA
              ? ` · segregation RMS ${segB.rms.toPrecision(3)} → ${segA.rms.toPrecision(3)}`
              : "");
        }
      }
    } finally {
      this.busy = false;
    }
    const after = await this.host.measure();
    if (after) this.census = after;
    setStatus("");
    this.host.syncUI();
    if (this.closeReq) { this.closeReq = false; this.close(); return; }
    this.report(plan, before, after, delivered, total, twinLine, homogLine);
    this.refresh();
  }

  private report(plan: Plan & { ok: true }, before: Census, after: Census | null, delivered: number, total: number, twinLine = "", homogLine = "") {
    if (!this.reportEl) return;
    const dim = (s: string) => `<span style="color:#6b7280">${s}</span>`;
    const strong = (s: string) => `<b style="color:#cfd6df">${s}</b>`;
    const astmNA = this.host.getMode() === "3d"
      ? "ASTM — (a plane-section statistic; see STEREOLOGY)"
      : "ASTM — (fewer than 3 grains)";
    const line = (label: string, c: Census) =>
      `${dim(label)} d̄ ${strong(fmtUm(this.dBar(c)))} · `
      + `${c.astm != null ? `ASTM ${strong("G " + c.astm.toFixed(1))}` : dim(astmNA)} · `
      + `${strong(String(c.grainCount))} grains`;

    const rows: string[] = [];
    rows.push(`${dim("schedule")} ${plan.sch.stages.length} stages · ${fmtDur(plan.ints.seconds)} · peak ${plan.ints.peakC.toFixed(0)} °C (${plan.ints.peakFracTm.toFixed(2)} T_m)`);
    rows.push(line("before", before));
    rows.push(after ? line("after ", after) : `${dim("after")} census readback failed`);
    rows.push(`${dim("law endpoint")} ${fmtUm(plan.dPredUm)} ${dim("— the trajectory between endpoints is the Potts model's, not the material's")}`);
    if (twinLine) rows.push(`${dim("twins")} ${twinLine}`);
    if (homogLine) rows.push(`${dim("homog")} ${homogLine}`);
    // oxidation and decarburization (H5): analytic parabolic laws over the
    // whole schedule. The scale is NOT painted into the fields — T/c/age are
    // the as-cast record — so the card is where the number lives.
    const ov = canTreat("oxide", this.ctx(before));
    if (ov.ok) {
      let ox = `scale ${fmtLen(scaleThickness(plan.ints.ox))} grew on the free surface (parabolic, ∫k_p·dt over the whole schedule)`;
      if (canTreat("decarb", this.ctx(before)).ok) {
        ox += ` · decarburized to ${fmtLen(decarbDepth(plan.ints.dt))} (x = 2√(D_C·t))`;
      }
      rows.push(`${dim("oxide")} ${ox}`);
    } else {
      rows.push(`${dim("oxide")} ${ov.why}`);
    }
    if (delivered < total) {
      rows.push(`<span style="color:#ffb454">aborted at sweep ${delivered.toLocaleString()} / ${total.toLocaleString()} — the microstructure is wherever the boundaries were</span>`);
    } else if (plan.capped) {
      rows.push(`<span style="color:#ffb454">truncated: the schedule asked for ${plan.sweeps.toLocaleString()} sweeps, the budget allows ${this.consts().cap.toLocaleString()} `
        + `(${((total / plan.sweeps) * 100).toFixed(0)} %) — the model endpoint for the delivered sweeps is ~${fmtUm(plan.dCapUm)}</span>`);
    } else if (after && this.dBar(after) - this.dBar(before) < 0.05) {
      rows.push(dim("nothing microstructural happened — which is what the arithmetic predicted. That is what a stress relief is."));
    }
    this.reportEl.innerHTML = rows.join("<br>");
  }
}

// -------------------------------------------------------------- formatting

function fmtUm(um: number): string {
  return um >= 100 ? `${um.toFixed(0)} µm` : `${um.toFixed(1)} µm`;
}

/** a length that honestly spans Al's nanometre passive film to steel's mm scale */
function fmtLen(m: number): string {
  if (!(m > 0)) return "0";
  if (m < 1e-6) return `${(m * 1e9).toPrecision(2)} nm`;
  if (m < 1e-3) return `${(m * 1e6).toPrecision(3)} µm`;
  return `${(m * 1e3).toPrecision(3)} mm`;
}

/** the Dt product, µm² — the group every homogenization is measured in */
function fmtDt(m2: number): string {
  const um2 = m2 * 1e12;
  return um2 >= 1 ? `${um2.toPrecision(3)} µm²` : `${um2.toExponential(1)} µm²`;
}

function fmtDur(s: number): string {
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
