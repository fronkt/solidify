/**
 * HEAT TREATMENT — the second clock.
 *
 * Everything else in this instrument runs on the solidification clock. Under the
 * calibrated solver a timestep for Al–4.5Cu is of order 10⁻⁷ s, so a long run is
 * a few milliseconds of physical time. A heat treatment is four hours. The
 * phase-field solver cannot be integrated through one — not slowly, not on a
 * bigger GPU, not ever — and pretending otherwise would be the same category of
 * claim this project spends its releases removing.
 *
 * So heat treatment is a **separate model on a separate clock**, and this module
 * owns the map between them, exactly as `units.ts` owns the dimensionless↔SI map:
 *
 *     real schedule       Arrhenius integral        a budget          a GPU pass
 *     (seconds, °C)  ──►  over the WHOLE      ──►   (µm² of grain ──► consumes
 *                         schedule                  growth, Dt)       the budget
 *
 * φ is frozen for the duration — that is what "solid state" means — so the
 * solidification loop does not run at all while a treatment is in progress, and
 * the two clocks never have to be reconciled. That is the whole trick.
 *
 * **There is no process switch.** The user sets an environment (a temperature
 * schedule and an atmosphere) and the model reports what happened: grains
 * coarsened this much, solute homogenised that much, this thickness of scale
 * grew. "Stress relief" is not a mode — it is what you get when you pick 200 °C
 * and every integral comes back negligible, and the report card says so because
 * the arithmetic said so. This is the same move v4.0 made when it deleted the
 * "nucleation per second" slider: the dependent quantity stops being a dial.
 * `SCHEDULES` below are *presets that fill in a schedule*, not switches that
 * select a physics.
 *
 * Every rate law here reads coefficients that have been sitting in `MaterialSI`
 * unread since v5.0's U1 milestone, each with its own `source:` provenance. This
 * module invents no material data. Where a coefficient is absent or zero, the
 * process is refused by name rather than run on a guessed number — see
 * `canTreat`.
 */

import { K0, R_GAS, type MaterialSI } from "./units";

// ---------------------------------------------------------------- the schedule

/**
 * A stage of a real heat-treatment schedule, in REAL seconds and °C.
 *
 * Deliberately NOT `program.ts`'s `Stage`. That one advances in *sim* time and
 * drives a set-point the solver chases, which is exactly right for a pour and
 * exactly wrong for a soak. Keeping them separate types is what stops the two
 * clocks from ever being handed to each other's executor.
 */
export type HeatStage =
  /** drive the temperature to `toC` at `cPerMin` °C per minute */
  | { kind: "ramp"; toC: number; cPerMin: number }
  /** hold wherever the schedule currently is, for `minutes` */
  | { kind: "hold"; minutes: number }
  /** drop to `toC` at `cPerSec` °C per second — a quench is a ramp in a hurry */
  | { kind: "quench"; toC: number; cPerSec: number };

export interface HeatSchedule {
  name: string;
  /** the temperature the specimen starts at — room temperature unless stated */
  startC: number;
  stages: HeatStage[];
}

export const ROOM_C = 20;

/**
 * Schedule presets. These fill in a schedule; they do not select a physics.
 * Temperatures are given as a fraction of the material's melting point, because
 * "600 °C" means something completely different to aluminium and to steel, and
 * a preset that is a solution treatment for one must not be a melt for the other.
 */
export const SCHEDULES: Record<string, { label: string; note: string; build: (tmC: number) => HeatSchedule }> = {
  stressRelief: {
    label: "stress relief",
    note: "Low and slow. Relieves residual stress — which this model does not carry, so expect the report to say nothing microstructural happened.",
    build: tmC => ({
      name: "stress relief",
      startC: ROOM_C,
      stages: [
        { kind: "ramp", toC: frac(tmC, 0.35), cPerMin: 5 },
        { kind: "hold", minutes: 120 },
        { kind: "ramp", toC: ROOM_C, cPerMin: 3 },
      ],
    }),
  },
  anneal: {
    label: "full anneal",
    note: "Hot enough and long enough that boundaries move. This is the one that coarsens the grain and softens the metal.",
    build: tmC => ({
      name: "full anneal",
      startC: ROOM_C,
      stages: [
        { kind: "ramp", toC: frac(tmC, 0.85), cPerMin: 10 },
        { kind: "hold", minutes: 60 },
        { kind: "ramp", toC: ROOM_C, cPerMin: 2 },
      ],
    }),
  },
  solution: {
    label: "solution + quench",
    note: "Just below the solidus to dissolve the segregation, then straight into water so nothing has time to come back out.",
    build: tmC => ({
      name: "solution + quench",
      startC: ROOM_C,
      stages: [
        { kind: "ramp", toC: frac(tmC, 0.92), cPerMin: 12 },
        { kind: "hold", minutes: 240 },
        { kind: "quench", toC: ROOM_C, cPerSec: 150 },
      ],
    }),
  },
  homogenize: {
    label: "long homogenization",
    note: "The industrial ingot soak: high and very long, to flatten microsegregation before working.",
    build: tmC => ({
      name: "long homogenization",
      startC: ROOM_C,
      stages: [
        { kind: "ramp", toC: frac(tmC, 0.9), cPerMin: 8 },
        { kind: "hold", minutes: 720 },
        { kind: "ramp", toC: ROOM_C, cPerMin: 2 },
      ],
    }),
  },
};

/** a fraction of the melting point, expressed in °C (the fraction is of ABSOLUTE T) */
export function frac(tmC: number, f: number): number {
  return (tmC + K0) * f - K0;
}

// --------------------------------------------------------------- the integrals

/**
 * What a schedule did, integrated over its whole trajectory.
 *
 * Each is ∫k(T(t))dt for one rate law, so a ramp through a hot region counts for
 * exactly as much as it should — which matters more than it sounds. Arrhenius
 * rates vary by orders of magnitude over a ramp, and charging a schedule only for
 * its hold would under-count a slow furnace ramp and over-count a fast one.
 */
export interface Integrals {
  /** total schedule length, seconds */
  seconds: number;
  /** ∫ggA0·e^(−ggQ/RT)dt — units of m^ggN, the grain-growth budget */
  gg: number;
  /** ∫Ds0·e^(−Qs/RT)dt — m², the "Dt product" every homogenization is measured in */
  dt: number;
  /** ∫oxA0·e^(−oxQ/RT)dt — m², the parabolic oxidation budget */
  ox: number;
  /** hottest point of the schedule, °C */
  peakC: number;
  /** peak as a fraction of the melting point — the incipient-melting check */
  peakFracTm: number;
}

/** Arrhenius rate. `a0` and `q` come from the material; nothing here is fitted. */
export function rate(a0: number, q: number, tK: number): number {
  if (!(a0 > 0) || !(tK > 0)) return 0;
  return a0 * Math.exp(-q / (R_GAS * tK));
}

/**
 * Walk the schedule and integrate every rate law over it.
 *
 * Simpson over each stage. A hold is exact under any quadrature (the integrand is
 * constant); a ramp is not — ∫e^(−Q/RT(t))dt through a linear ramp has no
 * elementary form — so the sample count is what buys the accuracy, and it is
 * cheap because this runs once per treatment on the CPU. `HT-ARRH` checks both
 * arms: the hold against its closed form, the ramp against a far finer
 * quadrature computed in the test.
 */
export function integrate(sch: HeatSchedule, si: MaterialSI, samplesPerStage = 2048): Integrals {
  let tC = sch.startC;
  let seconds = 0, gg = 0, dt = 0, ox = 0, peakC = tC;

  for (const st of sch.stages) {
    let dur: number, endC: number;
    if (st.kind === "hold") {
      dur = st.minutes * 60;
      endC = tC;
    } else if (st.kind === "ramp") {
      endC = st.toC;
      const rpm = Math.max(1e-6, Math.abs(st.cPerMin));
      dur = (Math.abs(endC - tC) / rpm) * 60;
    } else {
      endC = st.toC;
      const rps = Math.max(1e-6, Math.abs(st.cPerSec));
      dur = Math.abs(endC - tC) / rps;
    }
    if (!(dur > 0)) { tC = endC; continue; }

    // Simpson needs an even sample count
    const m = Math.max(2, samplesPerStage + (samplesPerStage % 2));
    const h = dur / m;
    let sGG = 0, sDT = 0, sOX = 0;
    for (let i = 0; i <= m; i++) {
      const f = i / m;
      const T = (tC + (endC - tC) * f) + K0;
      const w = i === 0 || i === m ? 1 : (i % 2 ? 4 : 2);
      sGG += w * rate(si.ggA0, si.ggQ, T);
      sDT += w * rate(si.Ds0, si.Qs, T);
      sOX += w * rate(si.oxA0, si.oxQ, T);
    }
    gg += (h / 3) * sGG;
    dt += (h / 3) * sDT;
    ox += (h / 3) * sOX;
    seconds += dur;
    peakC = Math.max(peakC, tC, endC);
    tC = endC;
  }

  return { seconds, gg, dt, ox, peakC, peakFracTm: (peakC + K0) / si.Tm };
}

// ------------------------------------------------------------------- the laws

/**
 * Grain size after the treatment, metres.
 *
 * `D^n − D₀^n = ∫k dt` with the material's own exponent. All nine materials in
 * the app ship `ggN = 2`, which is ideal parabolic growth and is also what the
 * Potts model reproduces — but the general form is kept because an exponent of
 * 3 or 4 (solute drag, particle pinning) is what a real alloy usually shows, and
 * a model that silently assumed 2 would be wrong in a way nothing would catch.
 */
export function grainAfter(d0m: number, gg: number, si: MaterialSI): number {
  const n = si.ggN > 0 ? si.ggN : 2;
  return Math.pow(Math.pow(Math.max(0, d0m), n) + Math.max(0, gg), 1 / n);
}

/** Hall–Petch yield strength, MPa, from a grain diameter in metres. */
export function hallPetch(si: MaterialSI, dm: number): number {
  if (!(dm > 0)) return si.s0;
  return si.s0 + si.kHP / Math.sqrt(dm);
}

/**
 * Oxide scale thickness, metres, from the parabolic budget. `x = √(k_p t)` with
 * the integral standing in for `k_p t`, so a ramp is charged correctly.
 *
 * Returns 0 for materials whose `oxA0` is zero — but a zero here means "this
 * material does not have an oxidation constant in the table", not "it grew no
 * scale", and `canTreat` refuses the readout rather than letting the panel draw
 * a confident 0 µm. Ice and succinonitrile are the two.
 */
export function scaleThickness(ox: number): number {
  return Math.sqrt(Math.max(0, ox));
}

/**
 * Decarburized depth, metres — `x ≈ 2√(D_C t)`, the standard diffusion depth.
 *
 * Only meaningful where the solute IS carbon, which among this app's materials is
 * steel alone; `canTreat` gates it there rather than reporting a "decarburized"
 * depth for the copper in a bronze. The 2 is the conventional prefactor for the
 * depth at which the error-function profile has substantially recovered, not a
 * fitted number.
 */
export function decarbDepth(dtProduct: number): number {
  return 2 * Math.sqrt(Math.max(0, dtProduct));
}

/**
 * Fourier number for homogenization: how far the Dt product has gone against the
 * segregation wavelength it has to erase.
 *
 * A sinusoidal composition of wavelength λ decays as exp(−4π²Dt/λ²), so this
 * group IS the decay exponent divided by 4π². It is exact — there is no fitted
 * constant anywhere in the homogenization path, which is why `HT-HOMOG` can be
 * an equality test rather than a tolerance band.
 */
export function fourier(dtProduct: number, lambdaM: number): number {
  if (!(lambdaM > 0)) return 0;
  return dtProduct / (lambdaM * lambdaM);
}

/** the analytic amplitude decay a sinusoidal segregation profile must follow */
export function segregationDecay(dtProduct: number, lambdaM: number): number {
  return Math.exp(-4 * Math.PI * Math.PI * fourier(dtProduct, lambdaM));
}

// ------------------------------------------------------- the budget → GPU map

/**
 * Monte Carlo sweeps needed to take the grain from `d0` to `dTarget`.
 *
 * **There are two exponents here and conflating them is a real error, which an
 * earlier draft of this module made.**
 *
 *   n — the MATERIAL's exponent, `si.ggN`, in `D^n − D₀^n = ∫k dt`. Every
 *       material shipped here carries n = 2, and a real alloy with solute drag
 *       or particle pinning carries 3 or 4.
 *   m — the MODEL's exponent, in `D^m − D₀^m = K_MC · S` with D in cells.
 *
 * It is tempting to assume m = 2 on the grounds that curvature-driven growth is
 * parabolic. Ideal curvature-driven growth is; **Monte Carlo Potts is not.** The
 * lattice pins, the state count is finite, and the measured growth law comes out
 * meaningfully slower than the theoretical `R ∝ t^½`. So m is a *measured*
 * property of this implementation, exactly like `K_MC` — both come from
 * `GG-EXPONENT`, and that test is their provenance.
 *
 * The two exponents meet at the ENDPOINT and nowhere else: the material law says
 * where the grain finishes, and the model spends whatever sweeps its own kinetics
 * need to get there. The trajectory in between is the model's, not the material's,
 * and the report card says so. Matching the endpoint is the honest half; claiming
 * the path would not be.
 */
export function sweepsFor(
  d0Um: number, dTargetUm: number, umPerCell: number, kMC: number, mModel: number,
): number {
  if (!(kMC > 0) || !(umPerCell > 0) || !(mModel > 0)) return 0;
  const d0 = Math.max(0, d0Um) / umPerCell;
  const d1 = Math.max(0, dTargetUm) / umPerCell;
  if (d1 <= d0) return 0;
  return (Math.pow(d1, mModel) - Math.pow(d0, mModel)) / kMC;
}

/**
 * Largest grain this specimen can honestly carry, µm.
 *
 * Grain statistics stop meaning anything when there are only a handful of grains
 * in the frame: the ASTM estimator already gives up below three
 * (`sim.ts:623`), boundary-truncated grains bias the mean area low by an amount
 * that grows as the grains do, and a Potts calibration measured at hundreds of
 * grains does not hold at five.
 *
 * This is not a hypothetical limit. A one-hour anneal of steel at 0.85·T_m
 * predicts ≈296 µm from its own sourced coefficients — three grains across a
 * 1 mm 2D domain, and *wider than the entire 188 µm volume* at 192³. So a
 * schedule past this limit is **refused while its analytic answer is still
 * printed**: the law says 296 µm, the specimen is 188 µm across, and the model
 * declines to pretend otherwise.
 */
export function domainLimitUm(gridN: number, umPerCell: number, minGrains = 25): number {
  const across = Math.max(1, Math.cbrt(minGrains));
  return (gridN * umPerCell) / Math.max(2, across);
}

// ------------------------------------------------------------- what is allowed

export type Process = "grain" | "homogenize" | "twins" | "oxide" | "decarb";

export interface TreatContext {
  /** the material's SI block — absent for the abstract identities */
  si: MaterialSI | null;
  /** material key, for the two rules that are genuinely about a specific system */
  key: string;
  /** is the solute field live? nothing to homogenize without one */
  alloy: boolean;
  /** "2d" | "3d" — a Σ3 is a three-dimensional rotation */
  dim: "2d" | "3d";
  /** 3D anisotropy class: 1 = cubic. Σ3 twinning means nothing off a cubic lattice */
  cubic: boolean;
  /** is there anything solid on screen to treat? */
  solidFraction: number;
}

export interface Verdict { ok: boolean; why: string }

const OK: Verdict = { ok: true, why: "" };

/**
 * The single place that decides whether a process may run, and the single place
 * that says why not.
 *
 * The rule Frank set: a process with no data behind it is not offered, and the
 * refusal names the missing coefficient rather than falling back to a plausible
 * generic number. Every branch here carries its own sentence — a generic "not
 * available" would be the dead-knob class in a different costume.
 */
export function canTreat(p: Process, c: TreatContext): Verdict {
  if (c.solidFraction < 0.02) {
    return { ok: false, why: "nothing solid to treat yet — pour a casting first." };
  }
  const si = c.si;
  if (!si) {
    return {
      ok: false,
      why: "this material is an abstract identity with no SI properties, so there is no "
        + "activation energy to put in an Arrhenius law. Pick a real material.",
    };
  }

  switch (p) {
    case "grain":
      if (!(si.ggA0 > 0) || !(si.ggQ > 0)) {
        return { ok: false, why: "no grain-growth coefficients (ggA0, ggQ) were looked up for this material." };
      }
      return OK;

    case "homogenize":
      if (!c.alloy) {
        return { ok: false, why: "no solute field to homogenize — turn the alloy on first." };
      }
      if (!(si.Ds0 > 0)) {
        return { ok: false, why: "no solid-state diffusion coefficient (Ds0) was looked up for this material." };
      }
      return OK;

    case "twins":
      if (c.dim !== "3d") {
        return {
          ok: false,
          why: "annealing twins are 3D only. A Σ3 is a rotation about a ⟨111⟩ axis, and the "
            + "2D solver carries a single orientation angle per grain rather than a lattice.",
        };
      }
      if (!c.cubic) {
        return { ok: false, why: "Σ3 annealing twins are an FCC phenomenon; this material does not grow on a cubic lattice here." };
      }
      if (si.twinNote) return { ok: false, why: si.twinNote };
      if (si.sfe === undefined) {
        return { ok: false, why: "no stacking-fault energy was looked up for this material, and it is what decides whether annealing twins form at all." };
      }
      if (si.sfe > SFE_TWIN_LIMIT) {
        return {
          ok: false,
          why: `stacking-fault energy is ${si.sfe.toFixed(0)} mJ/m² — too high. Annealing twins `
            + `form readily below about ${SFE_TWIN_LIMIT} mJ/m² and are essentially absent above it, `
            + `which is why annealed copper is full of them and annealed aluminium has none.`,
        };
      }
      return OK;

    case "oxide":
      if (!(si.oxA0 > 0)) {
        return { ok: false, why: "oxidation is not modelled for this material — there is no parabolic rate constant in the table." };
      }
      return OK;

    case "decarb":
      if (c.key !== "steel") {
        return {
          ok: false,
          why: "decarburization is a carbon phenomenon, and steel is the only material here "
            + "whose solute is carbon. The others lose a substitutional solute far too slowly to matter.",
        };
      }
      return OK;
  }
}

/**
 * Stacking-fault energy above which annealing twins stop forming, mJ/m².
 *
 * Not a sharp threshold in nature — twin density falls off steadily with rising
 * SFE rather than switching off — but the separation across this app's materials
 * is wide enough that a single number is honest: copper sits far below it and
 * aluminium far above, and that contrast IS the teaching point. The value and the
 * per-material energies are looked up in H3 with their sources named.
 */
export const SFE_TWIN_LIMIT = 80;

/**
 * Above this fraction of the melting point a "heat treatment" is a melt.
 *
 * Real solution treatments run within a few tens of kelvin of the solidus and
 * overshooting causes incipient melting — grain-boundary liquation that ruins the
 * casting. The model's premise breaks at the same place for the same reason: φ is
 * held frozen, so a schedule that would have melted the specimen is not a
 * treatment this module can honestly integrate.
 */
export const INCIPIENT_FRAC = 0.97;
