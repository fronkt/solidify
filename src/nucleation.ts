/**
 * Heterogeneous nucleation as a dependent quantity.
 *
 * The instrument used to expose "nucleation per second" as a free slider next
 * to undercooling and cooling rate, which is not a thing you can set: the
 * nucleation rate is a *consequence* of how deeply the melt is undercooled and
 * how fast it is losing heat. This is the standard casting-simulation fix
 * (Thevoz-Desbiolles-Rappaz 1989; Rappaz & Gandin; Greer's free-growth model):
 *
 *   - the charge carries a population of `nmax` potential sites (that IS the
 *     inoculant knob — the grain refiner you add to the ladle),
 *   - each site has its own activation undercooling drawn from a Gaussian
 *     N(dTN, dTsig) — big potent particles fire early, small ones need a
 *     colder melt,
 *   - a site fires exactly once, when the melt first gets that cold.
 *
 * Because sites only fire on a *new* maximum undercooling, recalescence stops
 * nucleation for free: latent heat warms the melt, the ratchet stalls, no
 * further sites activate. Cool faster and the melt reaches a deeper undercooling
 * before recalescence, so more sites fire and the casting comes out finer —
 * the textbook coupling, now emergent rather than dialled in.
 *
 * The rate per second is never specified anywhere. It falls out.
 */

import { stream } from "./rng";

export interface NucState {
  /** total available sites in the domain (the inoculant addition) */
  nmax: number;
  /** mean activation undercooling of the population */
  dTN: number;
  /** spread of activation undercoolings */
  dTsig: number;
}

export const NUC_DEFAULT: NucState = { nmax: 0, dTN: 0.15, dTsig: 0.045 };

/**
 * Grain-refiner fade. An inoculated charge held above its liquidus loses
 * effective nucleant sites over time: the refining particles (TiB₂ and Al₃Ti in
 * the Al–Ti–B system) are denser than the melt and settle out of it — and they
 * do it FASTER than Stokes' law alone predicts, because they agglomerate and get
 * caught on oxide films. Most of the loss happens in the first ~30 min of
 * holding, after which the settled fraction is roughly constant, so the model is
 * a short potent plateau followed by an exponential decay to a residual floor of
 * heterogeneous sites that are always present.
 *
 * This is empirical, not derived — the timescale is the Al–Ti–B holding picture,
 * applied to whatever inoculant the charge carries, and the science page says so.
 * At zero hold the factor is exactly 1, so a charge poured immediately behaves
 * identically to before this existed: no shipped result moves.
 *
 * Sources: settling faster than Stokes by agglomeration — "Grain refiner settling
 * and its effect on the melt quality of aluminium casting alloys," Materials 15
 * (2022) 7679; M. Easton & D. StJohn, Metall. Mater. Trans. A 30 (1999) 1613.
 */
export const FADE = { lagMin: 2, halfMin: 15, floor: 0.15 };

/**
 * Fraction of the added inoculant still active after `holdMin` minutes held
 * above the liquidus. 1 during the initial plateau, decaying toward FADE.floor.
 * Monotonically non-increasing, and exactly 1 at zero hold.
 */
export function fadeFactor(holdMin: number): number {
  if (!(holdMin > FADE.lagMin)) return 1;
  const tau = FADE.halfMin / Math.LN2;
  return FADE.floor + (1 - FADE.floor) * Math.exp(-(holdMin - FADE.lagMin) / tau);
}

interface Site { d: number; x: number; y: number; z: number }

export class Nucleation {
  readonly p: NucState = { ...NUC_DEFAULT };

  private sites: Site[] = [];
  private ptr = 0;
  /** deepest undercooling the melt has reached (the ratchet) */
  private dTMax = 0;
  /** last stats arrival: sim-time and the undercooling measured then */
  private measT = 0;
  private measDT = 0;
  private dim3 = false;
  private n = 0;
  private filmFrac = 0;
  /**
   * Its own stream, so the site population a charge draws is the same one every
   * time that seed is poured — and is unaffected by how many grains the solver
   * happened to claim, or whether the optimizer is searching alongside.
   */
  private rng = stream("nucleation");

  /** sites that have fired so far */
  get fired(): number { return this.ptr; }
  /** deepest undercooling reached this run — the report card's headline number */
  get maxUndercool(): number { return this.dTMax; }

  /**
   * Fraction of the site population that sits on the mould wall as oxide film
   * rather than in the bulk. This is the atmosphere proxy: a melt poured in air
   * carries entrained oxide films, which are wall and defect features — NOT a
   * change in how readily the bulk liquid nucleates.
   */
  setFilm(frac: number) { this.filmFrac = Math.max(0, Math.min(1, frac)); }

  /**
   * Draw a fresh site population for a new melt. `film` (0..1) biases that
   * fraction of sites onto the mould wall with shallow activation — oxide
   * films from a dirty (air) melt, per the atmosphere proxy.
   */
  stage(n: number, dim3: boolean, film = this.filmFrac) {
    this.n = n;
    this.dim3 = dim3;
    this.filmFrac = film;
    this.sites = [];
    this.ptr = 0;
    this.dTMax = 0;
    this.measT = 0;
    this.measDT = 0;
    // a fresh melt redraws the same charge: staging is where the stream restarts,
    // so restage() after a knob move re-places the same particles rather than
    // shuffling the population every time a slider is touched
    this.rng.reset();
    const total = Math.max(0, Math.round(this.p.nmax));
    const nFilm = Math.round(total * film);
    for (let i = 0; i < total; i++) {
      const wall = i < nFilm;
      // wall films are potent but few; bulk sites follow the inoculant Gaussian
      const d = wall
        ? Math.max(0.005, 0.06 + this.rng.gauss() * 0.02)
        : Math.max(0.005, this.p.dTN + this.rng.gauss() * this.p.dTsig);
      this.sites.push(wall ? this.wallSite(d) : this.bulkSite(d));
    }
    this.sites.sort((a, b) => a.d - b.d);
  }

  private bulkSite(d: number): Site {
    const n = this.n, r = this.rng;
    return { d, x: r.upto(n), y: r.upto(n), z: this.dim3 ? r.upto(n) : 0 };
  }

  /** a site pinned into the band next to a wall (oxide film / mould contact) */
  private wallSite(d: number): Site {
    const n = this.n, band = Math.max(2, n * 0.04), r = this.rng;
    const face = r.int(this.dim3 ? 6 : 4);
    const along = () => r.upto(n);
    const near = () => (r.next() < 0.5 ? r.upto(band) : n - r.upto(band));
    if (face === 0) return { d, x: near(), y: along(), z: this.dim3 ? along() : 0 };
    if (face === 1) return { d, x: along(), y: near(), z: this.dim3 ? along() : 0 };
    return { d, x: along(), y: along(), z: near() };
  }

  /** re-draw after the knobs move, keeping already-swept sites spent */
  restage(n = this.n, dim3 = this.dim3) {
    const hist = this.dTMax, mt = this.measT, md = this.measDT;
    this.stage(n, dim3, this.filmFrac);
    this.dTMax = hist;
    this.measT = mt;
    this.measDT = md;
    while (this.ptr < this.sites.length && this.sites[this.ptr].d <= hist) this.ptr++;
  }

  /** a stats readback landed: the melt's mean temperature at that sim-time */
  observe(simTime: number, meanLiqT: number | null, tEq: number) {
    if (meanLiqT === null) return;
    this.measT = simTime;
    this.measDT = Math.max(0, tEq - meanLiqT);
  }

  /**
   * Fire every site the melt has swept past since the last call. `coolProxy`
   * is the current heat-extraction rate, used only to extrapolate between
   * stats arrivals (downward in temperature, never up, and never more than
   * two sigma past the last real measurement).
   */
  update(simTime: number, coolProxy: number, emit: (x: number, y: number, z: number, dTact: number) => void) {
    if (this.ptr >= this.sites.length) return;
    // the measured undercooling fires sites outright — if the melt really is
    // that cold, those particles really have activated. Only the extrapolated
    // part is rationed, and never further than two sigma past real data, so a
    // batch always waits for the next measurement to confirm it. That is what
    // makes recalescence stop nucleation: the melt warms, the next measurement
    // comes back shallower than the ratchet, and no more sites fire.
    const drift = Math.max(0, coolProxy) * Math.max(0, simTime - this.measT);
    const target = this.measDT + Math.min(drift, 2 * this.p.dTsig);
    if (target <= this.dTMax) return;
    while (this.ptr < this.sites.length && this.sites[this.ptr].d <= target) {
      const s = this.sites[this.ptr++];
      emit(s.x, s.y, s.z, s.d);
    }
    this.dTMax = target;
  }
}
