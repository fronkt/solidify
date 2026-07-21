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

export interface NucState {
  /** total available sites in the domain (the inoculant addition) */
  nmax: number;
  /** mean activation undercooling of the population */
  dTN: number;
  /** spread of activation undercoolings */
  dTsig: number;
}

export const NUC_DEFAULT: NucState = { nmax: 0, dTN: 0.15, dTsig: 0.045 };

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

  /** sites that have fired so far */
  get fired(): number { return this.ptr; }
  /** deepest undercooling reached this run — the report card's headline number */
  get maxUndercool(): number { return this.dTMax; }

  /**
   * Draw a fresh site population for a new melt. `film` (0..1) biases that
   * fraction of sites onto the mould wall with shallow activation — oxide
   * films from a dirty (air) melt, per the atmosphere proxy.
   */
  stage(n: number, dim3: boolean, film = 0) {
    this.n = n;
    this.dim3 = dim3;
    this.filmFrac = film;
    this.sites = [];
    this.ptr = 0;
    this.dTMax = 0;
    this.measT = 0;
    this.measDT = 0;
    const total = Math.max(0, Math.round(this.p.nmax));
    const nFilm = Math.round(total * film);
    for (let i = 0; i < total; i++) {
      const wall = i < nFilm;
      // wall films are potent but few; bulk sites follow the inoculant Gaussian
      const d = wall
        ? Math.max(0.005, 0.06 + gauss() * 0.02)
        : Math.max(0.005, this.p.dTN + gauss() * this.p.dTsig);
      this.sites.push(wall ? this.wallSite(d) : this.bulkSite(d));
    }
    this.sites.sort((a, b) => a.d - b.d);
  }

  private bulkSite(d: number): Site {
    const n = this.n;
    return { d, x: Math.random() * n, y: Math.random() * n, z: this.dim3 ? Math.random() * n : 0 };
  }

  /** a site pinned into the band next to a wall (oxide film / mould contact) */
  private wallSite(d: number): Site {
    const n = this.n, band = Math.max(2, n * 0.04);
    const face = Math.floor(Math.random() * (this.dim3 ? 6 : 4));
    const along = () => Math.random() * n;
    const near = () => (Math.random() < 0.5 ? Math.random() * band : n - Math.random() * band);
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

/** standard normal, Box-Muller */
function gauss(): number {
  const u = Math.max(1e-9, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
