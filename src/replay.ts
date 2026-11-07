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
 *
 * It also owns the replay time being shown (the scrub), because every way a
 * scrub goes stale is ledger state or comes through the per-frame call: a
 * reset, a mark, or the strip that can end it leaving the screen (`frame`).
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
  private scrubT: number | null = null;

  /** why the history cannot be replayed, or null when it can */
  get reason(): string | null { return this.why; }

  /** call every frame with the solver's clock: running backward is a reset */
  clock(simTime: number) {
    if (simTime < this.lastT) this.clear();
    this.lastT = simTime;
  }

  /**
   * A measured solid fraction (0..1) at sim time t, of the CURRENT field: a
   * census issued before a reset describes the old cast and must be dropped
   * before it gets here (fieldstamp.ts), or its fraction seeds the baseline and
   * the fresh pour reads as remelted.
   */
  observe(simTime: number, fracSolid: number) {
    this.clock(simTime);
    if (!Number.isFinite(fracSolid)) return;
    if (fracSolid > this.fsMax) this.fsMax = fracSolid;
    else if (fracSolid < this.fsMax - FS_DROP) this.mark(REASON.remelt);
  }

  /** record a cause; the first one stands until the next reset. A marked
   *  history cannot be replayed, so a scrub in progress ends here too. */
  mark(reason: string) { if (this.why == null) this.why = reason; this.scrubT = null; }

  clear() { this.why = null; this.lastT = 0; this.fsMax = 0; this.scrubT = null; }

  /** ask for a replay time (null = live); refused while the ledger is marked,
   *  clamped to the recorded span [0, now] */
  scrub(t: number | null, now: number) {
    this.scrubT = t == null || this.why != null ? null : this.clamp(t, now);
  }

  /** the replay time asked for and still standing, or null for live */
  get scrubTime(): number | null { return this.scrubT; }

  /**
   * The replay time to draw THIS frame, or null for the live field. Call once
   * per frame with the solver's clock and whether the strip is offered (the
   * plain instrument, paused). Before this owned the scrub, a time survived a
   * reset, a grid swap, a 3D re-entry and a mode panel opening (which hides the
   * strip and its live button), and the canvas kept the replay's far-field
   * look over the real field with no control left to end it. A scrub ends on
   * a reset (the clock running back; a swapped solver starts at 0), a mark, or
   * the strip not being offered. (A time past now is refused as well, though
   * only a clock that ran back, already a reset, can produce one.)
   */
  frame(now: number, offered: boolean): number | null {
    this.clock(now);
    if (!offered || this.why != null || this.scrubT == null || !(this.scrubT <= now)) this.scrubT = null;
    return this.scrubT;
  }

  /** a requested replay time, clamped to the recorded span [0, now] */
  clamp(t: number, now: number): number {
    if (!Number.isFinite(t)) return now;
    return Math.min(Math.max(t, 0), Math.max(now, 0));
  }
}
