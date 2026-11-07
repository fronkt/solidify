/**
 * THE REPLAY LEDGER: whether the solid's stored history can be replayed.
 *
 * Both solvers keep exactly one piece of history per cell: the sim time it
 * crossed phi = 0.5 (2D state.a, 3D age.r). The solid at an earlier time t is
 * therefore rebuilt as "solid now AND froze before t" (shaders.ts loadState,
 * render3d.ts scrub pass). That rebuild is exact only while no solid has
 * melted back and no grain has changed identity after it froze:
 *
 *   - a remelted cell is liquid now, so the rebuild never shows it, even at
 *     times it was solid;
 *   - a heat treatment moves grain boundaries in solid metal, so the rebuild
 *     would paint today's grains onto yesterday's solid.
 *
 * Nothing in the stored fields says whether either happened, so this ledger
 * keeps the record: the first reason it is given sticks until the melt is
 * reset (sim time running backward is a reset; it only advances otherwise),
 * and a measured fall in the solid fraction counts as remelting whatever
 * caused it. The replay is offered only while the ledger is clean.
 */

/** a fall in solid fraction larger than this (absolute, 0..1) is remelting.
 *  Interface noise moves the census by far less: Kobayashi's noise term
 *  flickers single interface cells, a few 1e-5 of a 512^2 field. */
export const FS_DROP = 0.005;

export const REASON = {
  remelt: "Part of the solid remelted (the solid fraction fell). Remelted cells keep no history, so the replay would be wrong.",
  reheat: "Reheat remelts solid, and remelted cells keep no history, so the replay would be wrong.",
  weld: "The weld pass remelts what it crosses, and remelted cells keep no history, so the replay would be wrong.",
  anneal: "A heat treatment moved grain boundaries after the metal froze, so the replay would show today's grains.",
} as const;

export class ReplayLedger {
  private why: string | null = null;
  private lastT = 0;
  private fsMax = 0;
  private gen = 0;

  /** why the history cannot be replayed, or null when it can */
  get reason(): string | null { return this.why; }

  /**
   * How many resets this ledger has seen. A census read is asynchronous: one
   * issued before a reset can resolve after it, carrying the OLD cast's solid
   * fraction, and observed as if it were the new one's it seeds fsMax so high
   * that the fresh pour reads as remelted. Callers capture this when they
   * issue the read and hand it to `observe`, which drops a stale one.
   */
  get generation(): number { return this.gen; }

  /** call every frame with the solver's clock: running backward is a reset */
  clock(simTime: number) {
    if (simTime < this.lastT) this.clear();
    this.lastT = simTime;
  }

  /**
   * A measured solid fraction (0..1) at sim time t. `gen` is `generation` as
   * it was when the measurement was issued; a reset since then makes it the
   * old cast's, and it is dropped. Omitted, the reading is taken as current.
   */
  observe(simTime: number, fracSolid: number, gen?: number) {
    this.clock(simTime);
    if (gen !== undefined && gen !== this.gen) return;
    if (!Number.isFinite(fracSolid)) return;
    if (fracSolid > this.fsMax) this.fsMax = fracSolid;
    else if (fracSolid < this.fsMax - FS_DROP) this.mark(REASON.remelt);
  }

  /** record a cause; the first one stands until the next reset */
  mark(reason: string) { if (this.why == null) this.why = reason; }

  clear() { this.why = null; this.lastT = 0; this.fsMax = 0; this.gen++; }

  /** a requested replay time, clamped to the recorded span [0, now] */
  clamp(t: number, now: number): number {
    if (!Number.isFinite(t)) return now;
    return Math.min(Math.max(t, 0), Math.max(now, 0));
  }
}
