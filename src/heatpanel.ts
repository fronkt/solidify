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
  canTreat, domainLimitUm, grainAfter, hallPetch, integrate, sweepsFor, frac,
  scaleThickness, decarbDepth, fmtMPa, shownMPa, zenerLimitCells, recovered,
  recoveredMeanUniform, H_FLAT_3D,
  ZENER_K, ZENER_R_EXP, ZENER_F_EXP,
  INCIPIENT_FRAC, K_MC, M_MODEL, K_MC_3D, M_MODEL_3D, ROOM_C,
  type HeatSchedule, type TreatContext, type Integrals,
} from "./heattreat";
import { K0, type MaterialSI } from "./units";
import { HOMOG_D2 } from "./shaders";
import { HOMOG_D3 } from "./shaders3d";
import { range } from "./formbits";

/**
 * The one definition of d̄ the H6 verdict stands on — ⟨A⟩-equivalent circle in
 * the plane, ⟨V⟩-equivalent sphere in the volume — exported so the lab's L4
 * verdict judges the same diameter. Two of these is how one census yields two
 * strengths on one screen.
 */
export function censusDbarUm(c: Census, mode: "2d" | "3d", umPerCell: number): number {
  if (mode === "3d") {
    const v = c.meanVolVox ?? 0;
    return v > 0 ? Math.cbrt((6 * v) / Math.PI) * umPerCell : 0;
  }
  return c.meanAreaPx > 0 ? 2 * Math.sqrt(c.meanAreaPx / Math.PI) * umPerCell : 0;
}

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

/**
 * M4: build a per-region Census from Sim3D.readRegion's raw per-grain voxel
 * counts — the JS-side reduction readStats already does on the GPU for the
 * global census (census3 in main.ts just maps its fields straight through).
 * grainCount/meanVolVox come from readRegion's own >=4-voxel floor (the
 * readStereo noise-floor precedent) — the section table's own grainCount<3
 * refusal below is the small-sample guard, so this doesn't invent a second,
 * unprecedented one scaled to the region's size.
 */
export function regionCensus(
  raw: { grains: { id: number; voxCount: number }[]; poreVox: number; solidVox: number },
  regionVoxTotal: number,
): Census {
  const volSum = raw.grains.reduce((s, g) => s + g.voxCount, 0);
  return {
    fracSolid: regionVoxTotal > 0 ? raw.solidVox / regionVoxTotal : 0,
    grainCount: raw.grains.length,
    meanAreaPx: 0,
    meanVolVox: raw.grains.length > 0 ? volSum / raw.grains.length : 0,
    astm: null,
  };
}

export interface HeatHost {
  getMode(): "2d" | "3d";
  materialKey(): string;
  materialLabel(): string;
  /**
   * Clamps and refusals the poured melt is carrying. Optional so a host that
   * predates v7.1 P1 still satisfies the interface; the panel renders nothing
   * when it is absent. It belongs HERE because the heat-treatment laws are the
   * material's — pour an alloy onto a base metal this build does not have and
   * the grain-growth law running is still the previous material's.
   */
  alloyCaveats?(): string[];
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
  anneal(sweeps: number, onProgress: (done: number) => boolean,
    pin?: { f: number; r: number }): Promise<number>;
  /**
   * 3D only: the same sweeps with Σ3 annealing-twin spawning enabled — the
   * host budgets the per-flip probability from the remaining id range and
   * reports what was actually delivered, including allocator saturation.
   */
  annealTwins?(sweeps: number, onProgress: (done: number) => boolean,
    pin?: { f: number; r: number }):
    Promise<{ delivered: number; spawned: number; saturated: boolean }>;
  /**
   * 3D only (v7.0 C3a): lay down a cold-work stored-energy field before the
   * sweeps are spent, mean in BOND ENERGIES. Optional in the same sense
   * `annealTwins` is — a host with no volume never renders the dial that calls
   * it, and the plane has no stored-energy kernel to call into.
   */
  deposit?(workJb: number): void;
  /**
   * Drop the stored-energy field and return to the pre-C3a anneal (v7.0 C3a).
   *
   * The counterpart `deposit` needs and would be broken without: the mode
   * selector lives in the solver, so a dial that stops DEPOSITING has not
   * stopped DRIVING. Called on every legal run that is not cold-worked,
   * including in the plane, where it is a no-op.
   */
  clearWork?(): void;
  /** the recovery ordinate the volume has banked — `rec` in H_S = H₀/(1 + rec·H₀).
   *  The panel reads this rather than the RATE, so the furnace's °C and the
   *  lattice's dimensionless knobs stay on opposite sides of one wall. */
  storedRec?(): number;
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
 * The cold-work dial's ceiling and step, in BOND ENERGIES (v7.0 C3a).
 *
 * Both are set against `H_FLAT_3D = 8`, the flat-front barrier this lattice
 * derives from its own 26-neighbour stencil — the only scale a stored-energy
 * drive can honestly be read against, since the app has no SI↔Potts energy
 * bridge and this dial is not a route to one.
 *
 * The deposit spreads the field uniform on [0, 2·work], so the ceiling of 10
 * puts the most-deformed grains at 20 J_b — which is exactly the drive
 * `HT_RECOVER_3D`'s stall table was measured at, so the top of the dial is a
 * number the repository has a measured trajectory for rather than an
 * extrapolation. The 0.5 step's smallest non-zero setting spreads 0–1 J_b,
 * comfortably under the ~3 J_b where the Boltzmann tail first makes a flat
 * front measurably mobile: the first click of the dial is honestly almost
 * nothing, which is what a first click should be.
 */
const WORK_MAX = 10;
const WORK_STEP = 0.5;

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
      /** v7.0 C2: the dispersion as dialled (undefined = off), and — in the
       *  plane, where the law is measured — the pinned limit in µm */
      pin?: { f: number; r: number };
      dLimUm?: number;
      /** v7.0 C3a: the cold work as dialled, in bond energies (undefined = as
       *  cast). Its presence is what WITHDRAWS the endpoint — see `workNote`. */
      work?: number;
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
  private caveatEl: HTMLElement | null = null;
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
  /**
   * The pre-treatment spec, MPa — the yield strength the part must still make
   * when it leaves the furnace. 0 means no spec was set, and the card then
   * reports σ_y without sitting in judgement. It is a dial rather than a
   * constant because a spec is an engineering requirement, not a material
   * property: the same anneal passes a 25 MPa spec and fails a 40 MPa one.
   */
  private specMPa = 0;
  /**
   * The Zener dispersion dials (v7.0 C2): a second-phase particle fabric the
   * anneal's boundaries must drag through. Operator dials rather than material
   * constants — no material in the table carries sourced dispersion data, and
   * a dispersion is a processing choice (how the charge was inoculated or
   * mechanically alloyed), like the spec. f = 0 is the pre-C2 furnace, bit for
   * bit. The radius is in CELLS, the model's honest unit; the label prints the
   * µm equivalent beside it.
   */
  private pinF = 0;
  private pinR = 2;
  /**
   * Cold work, as a MEAN stored energy in bond energies (v7.0 C3a). 0 is the
   * as-cast specimen and the pre-C3a furnace, bit for bit.
   *
   * The volume's dial only. The plane's kernel has no stored-energy term, and
   * the number would not transfer if it did: `H_FLAT_3D` is the 26-neighbour
   * stencil's flat-front barrier, and the Moore-8 plane's is +2. Rather than
   * ship a control that does nothing in one dimension, `buildPanel` renders
   * this dial in 3D only — which also leaves the plane's operator surface, and
   * every gate that drives it positionally, byte-identical to v7.1.
   */
  private workJb = 0;
  private abortReq = false;
  /** exit pressed mid-run: abort first, close when the run loop hands back */
  private closeReq = false;
  /**
   * A share link's dialled setup, consumed by the next buildPanel() exactly
   * once. It has to be a handoff rather than a plain assignment because
   * buildPanel() re-derives the dial defaults from the material — the right
   * behaviour on every open and material swap, and exactly the clobber that
   * would silently discard a restored link.
   */
  private restore: [number, number, number, number?, number?, number?] | null = null;

  constructor(host: HeatHost) { this.host = host; }

  /** the dialled setup, for the share link: temperature °C, hold min, spec MPa,
   *  and (v7.0 C2, optional tail per the lab-tuple doctrine) the dispersion's
   *  fraction and radius in cells, then (v7.0 C3a) the cold work in bond
   *  energies. An UNPINNED, UNWORKED setup packs the three-element pre-C2 shape
   *  on purpose: those links keep restoring on any deployed page, and each tail
   *  appears exactly when the mode it carries is in use. The work element rides
   *  BEHIND the dispersion pair rather than replacing it, so a worked link with
   *  no dispersion still spells that pair out at its off defaults — a tail with
   *  a hole in it is a tail nothing can decode positionally. */
  setup(): [number, number, number, number?, number?, number?] {
    if (this.workJb > 0) return [this.tC, this.holdMin, this.specMPa, this.pinF, this.pinR, this.workJb];
    return this.pinF > 0
      ? [this.tC, this.holdMin, this.specMPa, this.pinF, this.pinR]
      : [this.tC, this.holdMin, this.specMPa];
  }

  open(restore?: [number, number, number, number?, number?, number?]) {
    if (this.active) return;
    this.active = true;
    this.restore = restore ?? null;
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
    return censusDbarUm(c, this.host.getMode(), this.host.umPerCell());
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
    // the dispersion, as dialled. The d_lim law is measured in the plane only
    // (zenerLimitCells' docblock says why the volume does not borrow it), so
    // dLimUm exists only in 2D — the 3D note and card say the mechanism runs
    // but decline to print a number nothing has measured.
    const pin = this.pinF > 0 ? { f: this.pinF, r: this.pinR } : undefined;
    const dLimUm = pin && this.host.getMode() !== "3d"
      ? zenerLimitCells(pin.f, pin.r) * this.host.umPerCell()
      : undefined;
    // the cold work, as dialled (v7.0 C3a). Gated on the dimension as well as
    // the dial: the dial only exists in the volume, and a plan is the one place
    // a stale value from a mode switch could still reach `run`.
    const work = this.workJb > 0 && this.host.getMode() === "3d" ? this.workJb : undefined;
    return { ok: true, sch, ints, d0Um, dPredUm, sweeps, capped, dCapUm, pin, dLimUm, work };
  }

  // -------------------------------------------------------------- the panel

  private buildPanel() {
    this.panel?.remove();
    const si = this.host.si();
    const tmC = si ? si.Tm - K0 : 1000;
    const tMax = Math.round(tmC);
    // the dial floor is material-relative where it has to be: a hard 100 °C
    // floor inverts the control for the two identities that melt below it
    // (ice at 0 °C, succinonitrile at 58 °C), and an inverted range is a
    // broken slider, not a refusal. Every metal keeps the 100 °C floor
    // byte-identical; ice and SCN get 25 °C of dial under their own melting
    // points, which leaves each a legal band below the incipient gate.
    const tMin = Math.min(100, Math.round((tMax - 25) / 5) * 5);
    this.builtFor = this.host.materialKey();
    // default: the classic full anneal, 0.85 T_m (absolute) — hot enough that
    // boundaries actually move, comfortably under the incipient-melting gate
    this.tC = Math.max(tMin, Math.min(tMax, Math.round(frac(tmC, 0.85) / 5) * 5));

    const p = document.createElement("div");
    p.id = "heattreat";
    p.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(700px,88vw);" +
      "background:rgba(15,17,21,0.93);border:1px solid #262b33;border-radius:8px;padding:10px 14px;" +
      "backdrop-filter:blur(6px);z-index:6;font-size:11px;";

    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:6px;";
    // materialLabel() is `alloyName`, and a share link's `n` field lands in it
    // verbatim — so this is a user-controlled string reaching innerHTML. The
    // name goes in through textContent on its own element instead. (Found by
    // an adversarial review of v7.1 P1: every other user-reachable string in
    // that milestone was routed to textContent, and this sink, five lines above
    // the new #htCaveat in the same function, was the one left raw.)
    head.innerHTML = `<span style="letter-spacing:.2em;color:#ffb454">♨ HEAT TREAT</span>
      <span style="color:#8891a0">the second clock — solid state, real hours, on <b id="htMat" style="color:#cfd6df"></b></span>`;
    head.querySelector("#htMat")!.textContent = this.host.materialLabel();
    const exit = document.createElement("button");
    exit.textContent = "exit";
    exit.addEventListener("click", () => this.close());
    head.append(exit);

    const form = document.createElement("div");
    form.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px 16px;margin-bottom:8px;";
    // the spec dial's ceiling is material-relative for the same reason the
    // temperature's is: σ_y at a 4 µm grain — finer than any casting this
    // instrument pours — is the strongest number Hall–Petch can honestly ask
    // for here, and it spans SCN's 1 MPa to a superalloy's ~600
    const specMax = si ? Math.ceil(hallPetch(si, 4e-6)) : 100;
    const specStep = specMax <= 5 ? 0.1 : specMax <= 100 ? 1 : 5;
    this.specMPa = 0;
    // the dispersion resets with the spec on every open — the docblock calls
    // it a processing choice LIKE the spec, and a panel that silently
    // remembered last session's fabric would pin a run nobody dialled
    this.pinF = 0;
    this.pinR = 2;
    // and the cold work with them, for the same reason and one more: a stored
    // field belongs to the specimen that was deformed, and the panel cannot
    // know that the casting under it is still that one
    this.workJb = 0;
    // a share link's setup lands here, once, clamped to this material's own
    // dial ranges — a hand-built link does not get to dial 2000 °C (and the
    // decoder's Number.isFinite whitelist already rejected non-numbers whole)
    if (this.restore) {
      const [t, h, s, pf, pr, wk] = this.restore;
      this.tC = Math.min(tMax, Math.max(tMin, Math.round(t)));
      this.holdMin = Math.min(720, Math.max(1, Math.round(h)));
      this.specMPa = Math.min(specMax, Math.max(0, s));
      // the optional dispersion tail (v7.0 C2) — same clamp doctrine; an old
      // three-element link decodes pf/pr as undefined and keeps the defaults.
      // pf snaps to the dial's own step: a hand-built 0.0004 would otherwise
      // latch the pin ON while every surface prints "0.0 vol %" — a lying
      // label on exactly the hand-built-link surface the clamp defends
      if (typeof pf === "number" && Number.isFinite(pf))
        this.pinF = Math.min(0.12, Math.max(0, Math.round(pf / 0.005) * 0.005));
      if (typeof pr === "number" && Number.isFinite(pr)) this.pinR = Math.min(5, Math.max(1, Math.round(pr)));
      // the cold-work element (v7.0 C3a), applied in the VOLUME only. A link
      // carrying work but opened in the plane drops it rather than holding it
      // silently: there is no dial to show it and no kernel to spend it, and a
      // dialled value no surface prints is the lying-label case the pf clamp
      // above was written for. Snapped to the dial's own step for the same
      // reason pf is — a hand-built 0.004 must not latch the mode on while
      // every surface reads "as cast".
      if (typeof wk === "number" && Number.isFinite(wk) && this.host.getMode() === "3d")
        this.workJb = Math.min(WORK_MAX, Math.max(0, Math.round(wk / WORK_STEP) * WORK_STEP));
      this.restore = null;
    }
    const umPC = this.host.umPerCell();
    form.append(
      range("temperature", tMin, tMax, 5, this.tC,
        v => { this.tC = v; this.refresh(); }, 0,
        v => si ? `${v.toFixed(0)} °C · ${((v + K0) / si.Tm).toFixed(2)} T_m` : `${v.toFixed(0)} °C`),
      range("hold time", 1, 720, 1, this.holdMin,
        v => { this.holdMin = v; this.refresh(); }, 0,
        v => v < 120 ? `${v.toFixed(0)} min` : `${(v / 60).toFixed(1)} h`),
      range("spec σ_y", 0, specMax, specStep, this.specMPa,
        v => { this.specMPa = v; this.refresh(); }, 0,
        v => v > 0 ? `≥ ${fmtMPa(v)} MPa` : "no spec"),
      // the Zener dispersion (v7.0 C2) — appended AFTER spec on purpose: the
      // panel gates drive the first three dials positionally
      range("dispersion", 0, 0.12, 0.005, this.pinF,
        v => { this.pinF = v; this.refresh(); }, 3,
        v => v > 0 ? `${(v * 100).toFixed(1)} vol %` : "no dispersion"),
      range("particle radius", 1, 5, 1, this.pinR,
        v => { this.pinR = v; this.refresh(); }, 0,
        v => `${v.toFixed(0)} cells · ${(v * umPC).toFixed(1)} µm`),
    );
    // the cold work (v7.0 C3a) — SIXTH, and in the volume only. Appended last
    // for the same positional reason C2's pair was, and rendered conditionally
    // because the plane has no stored-energy kernel: HT-PIN-PANEL still counts
    // five dials there, on a surface this milestone did not touch.
    //
    // The unit printed is J_b, the Potts bond energy. Never a bare J and never
    // J/m³: this app has no SI↔Potts energy bridge, deliberately (heattreat.ts
    // says why), and a dial labelled in joules would be claiming one.
    if (this.host.getMode() === "3d") {
      form.append(range("cold work", 0, WORK_MAX, WORK_STEP, this.workJb,
        v => { this.workJb = v; this.refresh(); }, 1,
        v => v > 0
          ? `${v.toFixed(1)} J_b mean · 0–${(2 * v).toFixed(1)} across grains`
          : "as cast (no cold work)"));
    }

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

    // The melt's own clamps and refusals. A SIBLING of #htNote rather than part
    // of it, deliberately: four gates read #htNote's textContent and one reads
    // #htReport byte-for-byte, and a caveat line folded into either would move
    // a pinned string. This element is new, so nothing pins it yet.
    const caveat = document.createElement("div");
    caveat.id = "htCaveat";
    caveat.style.cssText = "display:none;color:#d9985a;line-height:1.5;margin-bottom:8px;";

    p.append(head, form, caveat, note, row, report);
    document.getElementById("app")!.append(p);
    this.panel = p;
    this.noteEl = note;
    this.caveatEl = caveat;
    this.runBtn = go;
    this.statusEl = status;
    this.reportEl = report;
    this.refresh();
  }

  private refresh() {
    if (!this.panel || !this.noteEl || !this.runBtn) return;
    // rendered on every refresh, not built once into the head: the composition
    // can change while this panel is open, and a stale caveat is a false one
    if (this.caveatEl) {
      const cav = this.host.alloyCaveats?.() ?? [];
      // textContent: these strings quote element keys that reached derive()
      // from a hand-built mix or hash
      this.caveatEl.textContent = cav.length ? `⚠ ${cav.join(" · ")}` : "";
      this.caveatEl.style.display = cav.length ? "block" : "none";
    }
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
    // v7.0 C3a: cold work WITHDRAWS the endpoint, so it takes its own branch
    // before either of the two that print one. Both of those sentences are
    // predictions from the sourced coefficients, and the coefficients price
    // curvature-driven growth alone.
    if (plan.work) {
      this.noteEl.innerHTML = `${head}<br>`
        + `${sweeps.toLocaleString()} MC sweeps`
        + (capped
          ? ` — <span style="color:#ffb454">past the ${this.consts().cap.toLocaleString()}-sweep budget: the run will be `
          + `truncated at ${((this.consts().cap / sweeps) * 100).toFixed(0)} %</span>`
          : "")
        + this.workNote(plan)
        + this.pinNote(plan)
        + this.specWithdrawn();
      return;
    }
    if (!grew) {
      // the stress-relief case: the arithmetic says nothing happens, so the
      // panel says it BEFORE the run rather than selling a dud treatment
      this.noteEl.innerHTML = `${head}<br>predicts <b style="color:#cfd6df">no measurable grain growth</b> `
        + `(${fmtUm(d0Um)} → ${fmtUm(dPredUm)}) — at this temperature every Arrhenius integral is negligible. `
        + `Run it if you want the report card to say so.`
        // the dispersion's sentence rides this branch too — a pinned near-noop
        // run latches the fabric and the card will print it, so the note must
        // not be silent about it (review catch). The spec endpoint stays the
        // UN-clipped law here: dPred ≈ d0, and clipping to a d_lim below d0
        // would pre-judge a refinement the furnace cannot produce.
        + this.pinNote(plan)
        + this.specNote(d0Um, dPredUm);
      return;
    }
    this.noteEl.innerHTML = `${head}<br>the sourced law predicts d̄ `
      + `<b style="color:#cfd6df">${fmtUm(d0Um)} → ${fmtUm(dPredUm)}</b>`
      + ` · ${sweeps.toLocaleString()} MC sweeps`
      + (capped
        ? ` — <span style="color:#ffb454">past the ${this.consts().cap.toLocaleString()}-sweep budget: the run will be `
        + `truncated at ${((this.consts().cap / sweeps) * 100).toFixed(0)} % and reach ~${fmtUm(dCapUm)}</span>`
        : "")
      + this.pinNote(plan)
      + this.specNote(d0Um, this.endUm(plan));
  }

  /** the endpoint THIS run will actually reach: the capped law endpoint,
   *  further clipped by the pinned limit where the limit is measured (2D) —
   *  and FLOORED at the starting size: a fabric whose d_lim sits below the
   *  casting's own d₀ stalls the furnace where it stands, it does not refine
   *  the grain (the anneal only coarsens; predicting strengthening from a
   *  dispersion would be a verdict the card then contradicts) */
  private endUm(plan: Plan & { ok: true }): number {
    const law = plan.capped ? plan.dCapUm : plan.dPredUm;
    const clipped = plan.dLimUm !== undefined ? Math.min(law, plan.dLimUm) : law;
    return Math.max(plan.d0Um, clipped);
  }

  /**
   * The dispersion's own sentence (v7.0 C2). In the plane it pre-judges with
   * the measured limit law; in the volume it declines to print a number —
   * the mechanism runs there, the law is only measured here. Deliberately
   * arrow-free: the panel gates parse the note's FIRST "→ N µm" as the law
   * prediction, and a sentence that introduced an earlier arrow would
   * silently corrupt what they measure.
   */
  private pinNote(plan: Plan & { ok: true }): string {
    if (!plan.pin) return "";
    const pct = (plan.pin.f * 100).toFixed(1);
    if (plan.dLimUm === undefined) {
      return `<br><span style="color:#8891a0">dispersion ${pct} vol % · r ${plan.pin.r} cells: the particle `
        + `fabric pins boundaries in the volume too, but its limit law is only measured in the plane — `
        + `no d_lim is claimed here.</span>`;
    }
    // a fabric already finer than the casting: the boundaries are loaded from
    // the first sweep and the treatment does nothing — said before the run,
    // in the one direction this mode cannot be mistaken for (refinement)
    if (plan.dLimUm <= plan.d0Um) {
      return `<br><span style="color:#ffb454">dispersion ${pct} vol % · r ${plan.pin.r} cells `
        + `pins boundaries near d_lim ≈ ${fmtUm(plan.dLimUm)} (measured on this lattice: `
        + `d_lim = ${ZENER_K}·r^${ZENER_R_EXP}/f^${ZENER_F_EXP} cells) — at or below this casting's own `
        + `${fmtUm(plan.d0Um)}, so the furnace stalls where it stands. A dispersion cannot refine a `
        + `grain that already grew past it.</span>`;
    }
    const clips = plan.dLimUm < (plan.capped ? plan.dCapUm : plan.dPredUm);
    return `<br><span style="color:${clips ? "#ffb454" : "#8891a0"}">dispersion ${pct} vol % · r ${plan.pin.r} cells `
      + `pins boundaries near d_lim ≈ ${fmtUm(plan.dLimUm)} (measured on this lattice: `
      + `d_lim = ${ZENER_K}·r^${ZENER_R_EXP}/f^${ZENER_F_EXP} cells)`
      + (clips ? ` — the schedule's law endpoint will not be reached; the furnace stalls at the fabric` : "")
      + `.</span>`;
  }

  /**
   * The cold work's own sentence, and the withdrawal it forces (v7.0 C3a).
   *
   * The endpoint this panel prints everywhere else is the SOURCED law's:
   * D^n − D₀^n = ∫k·dt, with coefficients fitted to curvature-driven grain
   * growth in a real furnace. A stored-energy field is a second driving force,
   * and `K_MC_3D`/`M_MODEL_3D` — the measured lattice constants that turn that
   * endpoint into a sweep count — were measured on the undriven kernel. So the
   * schedule still buys its sweeps, which is a conversion of TIME and survives
   * intact, but nothing here can say where they land. The card measures it.
   *
   * The other half is the one a visitor is likelier to get wrong: this model's
   * cold work is a DRIVE, not a strength. Hall–Petch here prices grain size and
   * nothing else, so the work-hardening increment a real deformation would add
   * to σ_y is simply absent — dialling this up and annealing makes the casting
   * SOFTER on the card, by coarsening it, which is the opposite of what a
   * cold-worked bar does before it recrystallizes.
   */
  private workNote(plan: Plan & { ok: true }): string {
    const w = plan.work!;
    return `<br><span style="color:#ffb454">cold work ${w.toFixed(1)} J_b mean `
      + `(0–${(2 * w).toFixed(1)} J_b across grains, against this lattice's ${H_FLAT_3D} J_b `
      + `flat-front barrier) — the law endpoint is withdrawn.</span> `
      + `<span style="color:#8891a0">The sourced coefficients price curvature-driven growth alone, and the `
      + `stored energy is a second driving force neither they nor the sweep calibration were fitted `
      + `against. The schedule still buys its sweeps; where they land is measured afterwards, not `
      + `predicted here. Cold work in this model is a drive, not a strength — σ_y prices grain size `
      + `only, so the work hardening a real deformation would add is absent.`
      + (plan.sweeps < 2
        ? ` And at this temperature the schedule buys almost no sweeps: this furnace prices them from `
          + `the GRAIN-GROWTH law's Arrhenius integral, so it cannot yet price a recrystallization `
          + `anneal below the grain-growth window. Nucleation of new strain-free grains is not modelled.`
        : "")
      + `</span>`;
  }

  /**
   * The spec's pre-run sentence, withdrawn (v7.0 C3a).
   *
   * `specNote` judges the dialled spec against the endpoint the schedule
   * predicts. With the endpoint withdrawn there is nothing to judge against,
   * and inventing one from the undriven law would be exactly the prediction
   * `workNote` just retracted. The spec itself survives — the card judges it on
   * the measured census, which is where a spec verdict was always strongest.
   */
  private specWithdrawn(): string {
    if (!(this.specMPa > 0) || !this.host.si()) return "";
    return `<br><span style="color:#8891a0">the ≥ ${fmtMPa(this.specMPa)} MPa spec will be judged on the `
      + `measured census when the run finishes — its pre-run prediction goes with the endpoint.</span>`;
  }

  /**
   * The pre-run half of the H6 verdict: what the dialled spec demands against
   * what the schedule's own endpoint predicts — judged BEFORE any sweeps are
   * spent, because a spec you can only check after the furnace is a spec you
   * find out about too late. The endpoint used is the one THIS run will reach
   * (the capped one when the budget bites), and the card then judges the
   * measurement rather than the prediction.
   *
   * One direction deserves its own sentence: this model's furnace can only
   * coarsen, and Hall–Petch says coarser is softer, so a spec above the
   * casting's current strength is unreachable by any schedule — the honest
   * advice is a finer pour, not a hotter furnace.
   */
  private specNote(d0Um: number, dEndUm: number): string {
    const si = this.host.si();
    if (!(this.specMPa > 0) || !si) return "";
    const s = this.specMPa;
    const s0 = hallPetch(si, d0Um * 1e-6);
    const s1 = hallPetch(si, dEndUm * 1e-6);
    if (shownMPa(s) > shownMPa(s0)) {
      return `<br><span style="color:#c96a5b">the ≥ ${fmtMPa(s)} MPa spec is above the casting's current `
        + `${fmtMPa(s0)} MPa — an anneal only coarsens, and coarser is softer, so no schedule meets it. `
        + `A finer casting would.</span>`;
    }
    return shownMPa(s1) >= shownMPa(s)
      ? `<br>σ_y (Hall–Petch) ${fmtMPa(s0)} → ~${fmtMPa(s1)} MPa — the predicted endpoint meets the ≥ ${fmtMPa(s)} MPa spec.`
      : `<br><span style="color:#ffb454">σ_y (Hall–Petch) ${fmtMPa(s0)} → ~${fmtMPa(s1)} MPa — the predicted endpoint `
      + `misses the ≥ ${fmtMPa(s)} MPa spec.</span>`;
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
    // the spec as dialled when the run STARTED — a PRE-treatment spec. The
    // dials stay live during a run, and a spec moved after the sweeps are
    // spent must not rewrite the verdict the schedule was committed to.
    const spec = this.specMPa;
    // the dispersion latches with it, for the same reason: the fabric the
    // boundaries dragged through is the one the card must describe, not the
    // one the dials show when the report renders (plan() read the same dials
    // this run() did, so plan.pin IS the latched dispersion)
    const pin = plan.pin;
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
    // Σ3 twinning and cold work do not run together in C3a, and the card says
    // so rather than quietly picking one. A twin plate's id is allocated on the
    // GPU mid-anneal, so the deposit — which writes every id in range precisely
    // so a later-born twin cannot inherit a stale value — hands it whatever the
    // work fabric assigned to an id nobody had used yet. A thin Σ3 plate that
    // draws a LOWER stored energy than the parent it sits inside then eats that
    // parent, and the plate stops being a twin. Twinning inside a deformed and
    // recovering grain is a measurement C3b owes, not one this milestone made.
    const workHoldsTwins = !!plan.work && twinV?.ok === true;
    const wantTwins = twinV?.ok === true && !!this.host.annealTwins && !plan.work;
    let delivered = 0;
    let twinLine = twinV && !twinV.ok ? twinV.why : "";
    if (workHoldsTwins) {
      twinLine = "held back while cold work is dialled — a Σ3 plate is allocated GPU-side mid-anneal, so it "
        + "would be born carrying a stored energy the work fabric assigned to an id nobody had used yet, and "
        + "a plate that draws less than its parent eats the parent instead of twinning it. Twinning inside a "
        + "deformed grain is C3b's measurement, not this one's.";
    }
    // The field goes down BEFORE the sweeps, on the LATCHED plan's value — the
    // dial stays live during a run, and the specimen must carry the deformation
    // the card is about to describe rather than a later one.
    //
    // The else is not tidiness, it is the bug this pair exists to close: the
    // mode selector is `hOn` in the solver, so a dial returned to zero stops
    // DEPOSITING without stopping DRIVING. Landing only the `if` leaves the
    // next treatment running the stored kernel on a field the operator dialled
    // away — and because `plan.work` is then undefined, the note prints a law
    // endpoint and the card omits the cold-work row, so every surface describes
    // an undriven run that did not happen. Found by reading the run path after
    // the gates were green; `HT3-SE-PANEL` now drives the dial back to zero and
    // RUNS AGAIN, because a revert that is only checked in the note is a revert
    // checked on the one surface that never touches the solver.
    //
    // Each run re-deposits, which is the dial's meaning: it says how deformed
    // the specimen is when it ENTERS the furnace, so two treatments at 4 J_b
    // are two treatments on a specimen deformed to 4 J_b, not one specimen
    // deformed twice. `deposit` therefore re-zeroes the recovery ordinate.
    if (plan.work) this.host.deposit?.(plan.work);
    else this.host.clearWork?.();
    let homogLine = "";
    try {
      if (total > 0) {
        const onProg = (done: number) => {
          setStatus(`sweep ${done.toLocaleString()} / ${total.toLocaleString()} — hold is isothermal by construction`);
          return !this.abortReq;
        };
        if (wantTwins) {
          const r = await this.host.annealTwins!(total, onProg, pin);
          delivered = r.delivered;
          twinLine = r.spawned > 0
            ? `${r.spawned.toLocaleString()} Σ3 annealing twins nucleated on migrating boundaries`
              + (r.saturated ? " — the grain-id range ran out mid-anneal, so this is the delivered count, not the requested rate" : "")
            : "no annealing twins this run — boundaries migrated too little to deposit any";
        } else {
          delivered = await this.host.anneal(total, onProg, pin);
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
    this.report(plan, before, after, delivered, total, twinLine, homogLine, spec);
    this.refresh();
  }

  private report(plan: Plan & { ok: true }, before: Census, after: Census | null, delivered: number, total: number, twinLine = "", homogLine = "", spec = 0) {
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
    // v7.0 C3a: a driven run has no law endpoint to print. The sourced
    // coefficients price curvature-driven growth, and this run carried a second
    // driving force they were never fitted against — so the row says withdrawn
    // and prints no micron figure. A number beside the word "withdrawn" is a
    // number a visitor reads and the word they skip.
    rows.push(plan.work
      ? `${dim("law endpoint")} ${strong("withdrawn")} `
        + dim("— the sourced coefficients price curvature-driven growth alone, and this run carried a "
          + "stored-energy drive they were never fitted against. The before and after rows above are "
          + "measured; nothing here predicted them")
      : `${dim("law endpoint")} ${fmtUm(plan.dPredUm)} ${dim("— the trajectory between endpoints is the Potts model's, not the material's")}`);
    // H6: Hall–Petch on the MEASURED grain sizes — the same σ_y = s0 + k_HP/√d̄
    // the note predicted from the law endpoint, now standing on the census.
    // The row names its own limits, because this number is the one a visitor
    // is most tempted to over-read: it is grain-size strengthening alone
    // (precipitates and work hardening are not modelled and the science page
    // says why), d̄ is the census's equivalent diameter rather than E112's
    // mean intercept, and the µm under the √d are the declared resolution —
    // "you set it" is the anchor's provenance, and √d inherits it.
    const si = this.host.si();
    if (si) {
      const est = this.host.getMode() === "3d" ? "⟨V⟩-equivalent" : "⟨A⟩-equivalent";
      const sb = hallPetch(si, this.dBar(before) * 1e-6);
      if (after) {
        const sa = hallPetch(si, this.dBar(after) * 1e-6);
        rows.push(`${dim("σ_y")} ${strong(fmtMPa(sb))} → ${strong(fmtMPa(sa) + " MPa")} `
          + dim(plan.work
            ? `— Hall–Petch on the measured ${est} d̄, grain-size strengthening alone: no precipitates, and `
              + `no work-hardening term either — the cold work this run carried is a driving force for `
              + `boundary migration, not a strength, so the increment a real deformation would add to σ_y `
              + `is absent. The µm under the √d̄ are the declared resolution`
            : `— Hall–Petch on the measured ${est} d̄, grain-size strengthening alone: no precipitates, `
              + `no work hardening, and the µm under the √d̄ are the declared resolution`));
        if (spec > 0) {
          rows.push(shownMPa(sa) >= shownMPa(spec)
            ? `${dim("spec")} σ_y ≥ ${fmtMPa(spec)} MPa — ${strong("met")}: the treated casting stands at ${fmtMPa(sa)} MPa`
            : `${dim("spec")} σ_y ≥ ${fmtMPa(spec)} MPa — <span style="color:#c96a5b">missed</span>: the treated casting stands at ${fmtMPa(sa)} MPa`
            + dim(shownMPa(sb) < shownMPa(spec)
              ? " — it was under the spec before the furnace too, and an anneal only softens: meeting it takes a finer pour, not a schedule"
              : " — the anneal traded this strength for its grain size, which is exactly the trade Hall–Petch prices"));
        }
      } else if (spec > 0) {
        rows.push(`${dim("spec")} σ_y ≥ ${fmtMPa(spec)} MPa — no after-census landed, so there is nothing measured to judge it against`);
      }
    }
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
    // the dispersion's row (v7.0 C2) — printed only when the run was pinned,
    // AFTER the oxide row on purpose: the panel gates slice the card and
    // require late rows to survive, and an unpinned card must be byte-what it
    // was before this mode existed
    if (plan.pin) {
      rows.push(plan.dLimUm !== undefined
        ? `${dim("pinned")} dispersion ${(plan.pin.f * 100).toFixed(1)} vol % · r ${plan.pin.r} cells `
          + dim(`— the fabric pins boundaries near d_lim ≈ ${fmtUm(plan.dLimUm)} `
            + `(measured on this lattice: d_lim = ${ZENER_K}·r^${ZENER_R_EXP}/f^${ZENER_F_EXP} cells)`)
        : `${dim("pinned")} dispersion ${(plan.pin.f * 100).toFixed(1)} vol % · r ${plan.pin.r} cells `
          + dim("— the fabric pins in the volume too, but its limit law is only measured in the plane; no d_lim is claimed here"));
    }
    // the cold work's row (v7.0 C3a) — LAST of the mode rows, after C2's
    // pinned row, for the same reason that one went after oxide: the panel
    // gates slice the card and require the late rows to survive, and an
    // as-cast card must be byte-what it was before this mode existed.
    if (plan.work) {
      const rec = this.host.storedRec?.() ?? 0;
      // the MEAN of the recovered field, not `recovered` of the mean: the law
      // is concave, so the second is larger by Jensen — over 10 % at a
      // treatment's worth of sweeps — and this row names its number as what
      // recovery did to the deposited mean. The top of the fabric is a single
      // grain's value and so is exact under `recovered` itself.
      const hEnd = recoveredMeanUniform(plan.work, rec);
      const worst = recovered(2 * plan.work, rec);
      rows.push(`${dim("cold work")} ${plan.work.toFixed(1)} J_b mean deposited `
        + `${dim(`(0–${(2 * plan.work).toFixed(1)} J_b across grains, against this lattice's ${H_FLAT_3D} J_b `
          + `flat-front barrier)`)} `
        + dim(`— recovery ran it to ${hEnd.toFixed(2)} J_b over ${delivered.toLocaleString()} sweeps `
          + `(H_S = H₀/(1 + rec·H₀), rec = ${rec.toPrecision(3)}), and the most-deformed grains from `
          + `${(2 * plan.work).toFixed(1)} to ${worst.toFixed(2)}: second-order annihilation takes the `
          + `highest first, so the SPREAD that drives migration narrows faster than the mean falls`));
    }
    if (delivered < total) {
      rows.push(`<span style="color:#ffb454">aborted at sweep ${delivered.toLocaleString()} / ${total.toLocaleString()} — the microstructure is wherever the boundaries were</span>`);
    } else if (plan.capped) {
      // the truncation's own endpoint is the same withdrawn prediction, one row
      // further down: `dCapUm` is the sourced law inverted for the delivered
      // sweeps, so printing it on a worked run contradicts the law-endpoint row
      // above it. The truncation FRACTION is not a prediction and stays.
      rows.push(`<span style="color:#ffb454">truncated: the schedule asked for ${plan.sweeps.toLocaleString()} sweeps, the budget allows ${this.consts().cap.toLocaleString()} `
        + `(${((total / plan.sweeps) * 100).toFixed(0)} %)`
        + (plan.work
          ? `</span>`
          : ` — the model endpoint for the delivered sweeps is ~${fmtUm(plan.dCapUm)}</span>`));
    } else if (after && this.dBar(after) - this.dBar(before) < 0.05) {
      // "what the arithmetic predicted" is a claim about a prediction, and a
      // worked run withdrew it — so the same observation gets the honest
      // sentence for a run nothing predicted
      rows.push(dim(plan.work
        ? "nothing microstructural happened. Nothing here predicted that it would: with the stored drive live "
          + "the endpoint was withdrawn before the sweeps were spent, and this row reports the census, not a hit."
        : "nothing microstructural happened — which is what the arithmetic predicted. That is what a stress relief is."));
    }
    this.reportEl.innerHTML = rows.join("<br>");
  }
}

// -------------------------------------------------------------- formatting

function fmtUm(um: number): string {
  return um >= 100 ? `${um.toFixed(0)} µm` : `${um.toFixed(1)} µm`;
}

// fmtMPa and shownMPa moved to heattreat.ts (pure, browser-free-gated) when
// L4 gave the lab card the same verdict: one formatter, one printed precision.

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
