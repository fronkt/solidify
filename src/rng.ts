/**
 * Seeded randomness, so a cast can be poured twice.
 *
 * Everything stochastic in this instrument used to call `Math.random()` directly
 * — grain orientations, the 3D Marsaglia quaternions, nucleation site placement
 * and their activation Gaussian, chill-wall jitter, the twin probe. That made a
 * run unrepeatable, which is a problem for an instrument whose gates *measure*
 * things: `K_MC_TOL_3D` had to be widened from 15 % to 25 % precisely because an
 * unseeded 2600-site pour moved the measured constant cast to cast (the six runs
 * in its docblock spread 0.886-1.186 on identical code). The three verify scripts
 * that needed determinism each grew their own hand-rolled LCG in `scripts/`,
 * which fixed the harness and left the app itself irreproducible.
 *
 * `CONTRIBUTING.md` already told contributors "the simulation is deterministic
 * given a seed, so exact repro steps matter". This module makes that true.
 *
 * THE SEED IS DRAWN, NOT FIXED. A fresh visit gets a fresh cast — an instrument
 * that showed the identical snowflake on every reload would be a worse
 * instrument. What changes is that the seed is now *recorded*: it rides the share
 * link, so any cast can be handed to someone else exactly, and a gate can pin it.
 * That is how a real experiment logs a random number generator, and it is why the
 * one surviving `Math.random()` in `src/` is the one below, which draws the seed.
 *
 * STREAMS ARE DERIVED BY NAME, NOT BY SPLITTING. `stream("sim3d")` hashes the
 * name into the seed, so every subsystem draws from an independent sequence and —
 * the part that matters — *adding a new consumer never shifts an existing one's
 * draws*. A sequential split would renumber everybody the moment convection or a
 * recrystallization pass asked for a stream, silently moving every measured
 * constant in the suite. Named derivation costs one hash and removes that whole
 * class of breakage.
 */

/** FNV-1a (32-bit): mixes a stream name into the seed. */
function hashName(name: string, seed: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h = (h ^ name.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // final avalanche, so short names ("sim") do not sit next to each other
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * One stream. mulberry32 — the generator `scripts/gen-grain.mjs` already uses,
 * chosen over the plain `x*1664525 + 1013904223` LCG the verify scripts carry
 * because that LCG's low bits are poor and two of the consumers here
 * (Box-Muller, Marsaglia quaternions) pair consecutive draws, which is exactly
 * where a weak generator shows up as structure in the output.
 */
export class Rng {
  private s0: number;
  private s: number;

  constructor(seed: number) {
    this.s0 = seed >>> 0;
    this.s = this.s0;
  }

  /** back to the first draw: a re-pour at the same seed is the same pour */
  reset(): void {
    this.s = this.s0;
  }

  /**
   * Point this stream at a new seed, IN PLACE. Callers cache their stream
   * (`private rng = stream("sim3d")`), so `setSeed` has to mutate the object
   * they hold — swapping the registry entry for a fresh `Rng` would leave every
   * cached reference drawing from the old seed, i.e. a seed control that
   * visibly does nothing. Not exported: `setSeed` is the only legitimate caller.
   */
  rederive(seed: number): void {
    this.s0 = seed >>> 0;
    this.s = this.s0;
  }

  /** uniform [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** uniform [0, hi) */
  upto(hi: number): number {
    return this.next() * hi;
  }

  /** integer in [0, hi) */
  int(hi: number): number {
    return Math.floor(this.next() * hi);
  }

  /** -1 or +1, equally likely */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** standard normal, Box-Muller */
  gauss(): number {
    const u = Math.max(1e-9, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

/**
 * The run's seed. Drawn at load — this is the one `Math.random()` that survives
 * in `src/`, and it is the right one: it supplies entropy, it never enters a
 * measurement, and every draw that DOES enter a measurement descends from it
 * reproducibly.
 */
function drawSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

let runSeed = drawSeed();

const streams = new Map<string, Rng>();

/** the seed this run is using — shown in the UI, packed into share links */
export function getSeed(): number {
  return runSeed;
}

/**
 * Re-seed every stream. Existing `Rng` objects are re-derived in place, so a
 * caller that cached `stream("sim3d")` keeps working and starts drawing from the
 * new seed rather than silently holding the old one.
 */
export function setSeed(seed: number): void {
  runSeed = seed >>> 0;
  for (const [name, r] of streams) r.rederive(hashName(name, runSeed));
}

/** Draw fresh entropy and re-seed every stream. Returns the new seed. */
export function reseed(): number {
  setSeed(drawSeed());
  return runSeed;
}

/** the seed as the UI and the share link spell it: eight lower-case hex digits */
export function seedHex(seed = runSeed): string {
  return (seed >>> 0).toString(16).padStart(8, "0");
}

/**
 * The named stream. Independent of every other name, so one subsystem's draws
 * can never perturb another's — the optimizer searching does not move the pour,
 * and a landing-page animation does not move a gate.
 */
export function stream(name: string): Rng {
  let r = streams.get(name);
  if (!r) {
    r = new Rng(hashName(name, runSeed));
    streams.set(name, r);
  }
  return r;
}
