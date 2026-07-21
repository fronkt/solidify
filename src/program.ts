/**
 * Thermal programs: the cooling schedule an experiment is run under.
 *
 * A real casting is not "cool at rate X forever" — it is a *program*. You pour
 * at some superheat, the mould pulls heat out at a rate set by what the mould
 * is made of, and you may hold at a temperature before letting it go cold.
 * That is what this executor drives: a set-point trajectory that the solver
 * follows with Newtonian shell coupling (scen 3 in 2D, scen 4 in 3D), rather
 * than the sandbox's constant heat sink.
 *
 * Stages advance in SIM time, so fast-forwarding never changes the schedule
 * the casting actually experienced.
 */

export type Stage =
  /** drive the set-point toward `to` at `rate` set-point units per unit sim-time */
  | { kind: "ramp"; to: number; rate: number }
  /** hold the current set-point for `dwell` units of sim time */
  | { kind: "hold"; dwell: number };

export interface Program {
  name: string;
  /** how tightly the charge follows the set-point (Newtonian coupling) */
  coupling: number;
  stages: Stage[];
}

/**
 * The three ways to get heat out of a casting, coarsely: leave it in the
 * furnace, stand it in air, or plunge it. Real cooling rates span three orders
 * of magnitude (~0.2 K/s furnace, ~1-10 K/s air, ~100-400 K/s quench); these
 * keep that ordering in the model's dimensionless temperature.
 */
export const PROGRAMS: Record<string, (soak: number) => Program> = {
  furnace: soak => ({
    name: "furnace cool",
    coupling: 6,
    stages: [{ kind: "hold", dwell: 0.05 }, { kind: "ramp", to: 0.1, rate: 0.35 }],
  }),
  air: soak => ({
    name: "air cool",
    coupling: 18,
    stages: [{ kind: "hold", dwell: 0.02 }, { kind: "ramp", to: 0.05, rate: 1.6 }],
  }),
  quench: soak => ({
    name: "water quench",
    coupling: 90,
    stages: [{ kind: "ramp", to: -0.15, rate: 12 }],
  }),
  // hold above the solidus, then cool — the isothermal-arrest experiment
  soak: soak => ({
    name: "soak then air cool",
    coupling: 20,
    stages: [
      { kind: "ramp", to: soak, rate: 3 },
      { kind: "hold", dwell: 0.35 },
      { kind: "ramp", to: 0.05, rate: 1.2 },
    ],
  }),
};

export class ProgramRun {
  private stages: Stage[] = [];
  private idx = 0;
  private stageStart = 0;
  /** the set-point being driven */
  setpoint = 1;
  coupling = 10;
  done = true;
  name = "";

  /** start a program from the pour temperature `from`, at sim-time `t0` */
  start(p: Program, from: number, t0: number) {
    this.stages = p.stages.slice();
    this.coupling = p.coupling;
    this.name = p.name;
    this.idx = 0;
    this.stageStart = t0;
    this.setpoint = from;
    this.done = this.stages.length === 0;
  }

  stop() { this.done = true; }

  /** label of the stage currently running, for the live status line */
  get stageLabel(): string {
    if (this.done) return "complete";
    const s = this.stages[this.idx];
    return s.kind === "ramp" ? `ramp → ${s.to.toFixed(2)}` : "hold";
  }

  get stageIndex(): number { return this.idx; }
  get stageCount(): number { return this.stages.length; }

  /**
   * Advance the set-point to sim-time `t`. Returns the set-point to write into
   * the solver's holdT.
   */
  update(t: number, dtSim: number): number {
    if (this.done) return this.setpoint;
    const s = this.stages[this.idx];
    if (s.kind === "ramp") {
      const step = s.rate * dtSim;
      if (this.setpoint > s.to) this.setpoint = Math.max(s.to, this.setpoint - step);
      else this.setpoint = Math.min(s.to, this.setpoint + step);
      if (Math.abs(this.setpoint - s.to) < 1e-4) this.next(t);
    } else if (t - this.stageStart >= s.dwell) {
      this.next(t);
    }
    return this.setpoint;
  }

  private next(t: number) {
    this.idx++;
    this.stageStart = t;
    if (this.idx >= this.stages.length) { this.idx = this.stages.length - 1; this.done = true; }
  }
}
