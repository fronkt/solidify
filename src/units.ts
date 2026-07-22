/**
 * SCALE — the one owner of the map between the solver's dimensionless numbers
 * and real SI units.
 *
 * The phase field is written in dimensionless form, so printing °C or K/s needs
 * three conversion factors: kelvin per unit, seconds per unit, and µm per cell.
 * Only one of them is a free choice. The other two are pinned by the equations:
 *
 *   kelvin per unit  = (L/c_p) / K      the heat equation's own latent-heat
 *                                       coupling. `T += dt·∇²T + K·dφ` IS the
 *                                       statement that one dimensionless degree
 *                                       is (L/c_p)/K kelvin — not a guess, and
 *                                       different for every material
 *   µm per cell      = you set it       the model's physical resolution
 *   seconds per unit = l₀² / D          forced: the diffusion term carries a
 *                                       dimensionless diffusivity of 1
 *
 * **µm per cell is the anchor, not the domain width.** This is the subtle part,
 * and getting it backwards was a real bug: the old code fixed a 1 mm domain and
 * derived the cell pitch as `1000/n`, so the same physics at 512² and 2048²
 * reported grain diameters four times apart. The phase-field interface is a
 * fixed number of CELLS wide, so the cell pitch is what carries physical
 * meaning; a larger grid buys you a larger domain at the same resolution, which
 * is what a larger grid is actually for. Domain width is derived here.
 *
 * A scale model cannot match every dimensionless group at once — the same bind a
 * wind tunnel is in when it matches Reynolds but not Mach. So this module also
 * reports which groups it matches and which it does not, and every factor
 * carries a provenance saying whether it was chosen, forced, or mismatched.
 * Nothing here prints an authoritative-looking number with the mismatch hidden.
 *
 * The load-bearing mismatch under the Kobayashi solver is the Lewis number: the
 * model runs heat and solute at comparable diffusivities where a real alloy
 * separates them by four orders of magnitude. That is stated, not buried.
 */

/** kelvin ↔ celsius */
export const K0 = 273.15;
/** gas constant, J/mol/K — the heat-treatment Arrhenius laws use it */
export const R_GAS = 8.314462618;

/**
 * Default model resolution, µm per cell. Chosen so every readout in the app is
 * unchanged at the default grids: 2D ran a 1 mm domain at 1024², and 3D used a
 * hardcoded 1 mm / 1024 pitch, which happen to be the same number. Fixing the
 * anchor therefore costs no visible regression and makes the two dimensions
 * agree for the first time.
 */
export const DEFAULT_UM_PER_CELL = 1000 / 1024;

/**
 * Real properties of a material, in SI, near the melting point. Liquid-state
 * values are used where solid and liquid differ, since that is the phase the
 * transport terms act in.
 */
export interface MaterialSI {
  /** melting point, K */
  Tm: number;
  /** latent heat of fusion, J/kg */
  L: number;
  /** specific heat (liquid), J/kg/K */
  cp: number;
  /** density (liquid), kg/m³ */
  rho: number;
  /** thermal diffusivity (liquid), m²/s */
  alphaTh: number;
  /** solute diffusivity in the liquid, m²/s */
  Dl: number;
  /** solute diffusion in the solid: D = Ds0·exp(−Qs/RT) — m²/s, J/mol */
  Ds0: number;
  Qs: number;
  /** liquidus slope, K per wt% (negative: solute depresses the liquidus) */
  mL: number;
  /** equilibrium partition coefficient */
  kPart: number;
  /** Gibbs–Thomson coefficient γ·T_m/L_v, K·m */
  Gamma: number;
  /** measured interface-energy anisotropy strength ε₄ */
  eps4: number;
  /** grain growth D^n − D₀^n = ggA0·exp(−ggQ/RT)·t, exponent ggN */
  ggA0: number;
  ggQ: number;
  ggN: number;
  /** parabolic oxidation x = √(k_p·t), k_p = oxA0·exp(−oxQ/RT) — m²/s, J/mol */
  oxA0: number;
  oxQ: number;
  /** Hall–Petch σ_y = s0 + kHP/√d — MPa, MPa·√m */
  s0: number;
  kHP: number;
  /** provenance, shown in the scale panel */
  source: string;
}

// ------------------------------------------------------------- the scaling

/** why a factor has the value it has — rendered as a badge beside every row */
export type Prov =
  | "you set it"
  | "forced by latent heat"
  | "forced by heat diffusion"
  | "forced by solute diffusion"
  | "derived from d₀ and D"
  | "not defined";

/** one dimensionless group, and whether the model gets it right */
export interface Group {
  name: string;
  model: number | null;
  real: number | null;
  ok: boolean;
  note: string;
}

export interface Scale {
  /** kelvin per dimensionless degree */
  kelvinPerUnit: number;
  /** seconds per dimensionless time unit */
  secondsPerUnit: number;
  /** microns per grid cell — the anchor */
  umPerCell: number;
  /** metres per dimensionless LENGTH unit (a cell is `dx` of these) */
  metresPerUnit: number;
  /** derived: how wide the whole domain actually is, µm */
  domainUm: number;
  prov: { kelvinPerUnit: Prov; secondsPerUnit: Prov; umPerCell: Prov };
  groups: Group[];
  /** true when the material has no SI identity (the model metal, the QC) */
  abstract: boolean;
  note: string;
}

export interface ScaleInput {
  si: MaterialSI | null;
  /** grid edge in cells */
  n: number;
  /** dimensionless cell spacing (PhysParams.dx) */
  dx: number;
  /** dimensionless latent-heat coupling K (PhysParams.latent) */
  latent: number;
  /** dimensionless solute diffusivity (PhysParams.dSol) */
  dSol: number;
  /** is the solute field live? picks which diffusivity anchors time */
  alloy: boolean;
  /** the anchor: model resolution in µm per cell */
  umPerCell: number;
}

/**
 * Build the scaling. Two factors come from the equations, one from the declared
 * resolution; the groups table then says what that costs.
 */
export function scaleOf(inp: ScaleInput): Scale {
  const { si, n, dx, latent, dSol, alloy, umPerCell } = inp;
  const metresPerUnit = (umPerCell * 1e-6) / Math.max(1e-9, dx);
  const domainUm = umPerCell * Math.max(1, n);

  if (!si) {
    return {
      kelvinPerUnit: NaN, secondsPerUnit: NaN, umPerCell, metresPerUnit, domainUm,
      prov: {
        kelvinPerUnit: "not defined",
        secondsPerUnit: "not defined",
        umPerCell: "you set it",
      },
      groups: [],
      abstract: true,
      note: "no SI identity — this is the dimensionless reference crystal every phase-field "
        + "paper grows first, not a substance. Lengths are real because you set the "
        + "resolution; temperatures and times are not, and nothing here will pretend "
        + "otherwise. Pick a real material to put the clock and the thermometer on.",
    };
  }

  // The heat equation reads T += dt·∇²T + K·dφ, and that K is L/(c_p·ΔT_ref) —
  // so the reference interval follows directly. No fitting anywhere.
  const kelvinPerUnit = (si.L / si.cp) / Math.max(0.05, latent);

  // The diffusion term carries a dimensionless diffusivity of 1 for heat and
  // dSol for solute, so once a length is set the time unit is forced. WHICH
  // field anchors it is a real modelling choice: an alloy dendrite is set by
  // solute, and anchoring there errs toward a near-isothermal cell — which is
  // what every micro-scale casting model assumes anyway. A pure melt has no
  // solute, so heat is the only transport there is and the anchor is exact.
  const secondsPerUnit = alloy
    ? (Math.max(1e-6, dSol) * metresPerUnit * metresPerUnit) / si.Dl
    : (metresPerUnit * metresPerUnit) / si.alphaTh;

  const leModel = 1 / Math.max(1e-6, dSol);
  const leReal = si.alphaTh / si.Dl;
  const leRatio = Math.max(leReal / leModel, leModel / leReal);

  const groups: Group[] = [
    {
      name: "Stefan  c_p·ΔT/L",
      model: 1 / latent, real: 1 / latent, ok: true,
      note: "matched by construction — the kelvin scale is DERIVED from this group, so it "
        + "cannot disagree. It is the one thing the dimensionless model gets exactly right.",
    },
    {
      name: "Lewis  α/D",
      model: leModel, real: leReal, ok: leRatio < 3,
      note: leRatio >= 3
        ? "NOT matched, and it cannot be: a real alloy separates heat and solute by four "
          + "orders of magnitude, and one explicit grid at one timestep cannot carry both. "
          + (alloy
            ? "Time is anchored on solute here, so the temperature field diffuses far too "
              + "slowly — read it as the imposed macroscopic temperature, not as real heat "
              + "conduction at this scale. That is the direction a micro-model errs in anyway."
            : "Time is anchored on heat here, which is exact for a pure melt — there is no "
              + "solute field to disagree with.")
        : "close to matched at these settings",
    },
    {
      name: "capillary  d₀/W",
      model: null, real: null, ok: false,
      note: "not defined — the Kobayashi interface has no calibrated surface energy, so "
        + "there is no capillary length to compare a width against. This is exactly why "
        + "tip radius and arm spacing are shapes rather than predictions here.",
    },
  ];

  return {
    kelvinPerUnit, secondsPerUnit, umPerCell, metresPerUnit, domainUm,
    prov: {
      kelvinPerUnit: "forced by latent heat",
      umPerCell: "you set it",
      secondsPerUnit: alloy ? "forced by solute diffusion" : "forced by heat diffusion",
    },
    groups,
    abstract: false,
    note: si.source,
  };
}

/**
 * What a cooling rate is called in practice. These bands are how a foundry or a
 * process engineer would name the process, not a model classification.
 */
export function regimeOf(kPerSec: number): string {
  const r = Math.abs(kPerSec);
  if (!Number.isFinite(r) || r <= 0) return "isothermal";
  if (r < 1) return "furnace · heavy sand casting";
  if (r < 1e2) return "sand & investment casting";
  if (r < 1e4) return "permanent mould · die casting";
  if (r < 1e6) return "rapid solidification";
  return "melt spinning · laser AM";
}

/**
 * Deepest undercooling a real melt reaches before it nucleates on its own,
 * however clean it is — roughly 0.2·T_m (Turnbull). Used to mark a dial driven
 * somewhere no experiment goes.
 */
export function maxRealUndercoolK(si: MaterialSI | null): number {
  return si ? 0.2 * si.Tm : Infinity;
}

// --------------------------------------------------------- the converters
//
// Every call site in the app goes through one of these. They are deliberately
// total: with an abstract material the temperature and time converters return
// NaN and the formatters render an em dash, so "we do not know" stays visibly
// different from "zero".

export class Units {
  readonly scale: Scale;
  readonly props: MaterialSI | null;
  /** °C the anchor T = 1 maps to */
  private tmC: number;

  constructor(scale: Scale, si: MaterialSI | null) {
    this.scale = scale;
    this.props = si;
    this.tmC = si ? si.Tm - K0 : NaN;
  }

  /** false when the material has no SI identity */
  get known(): boolean { return !this.scale.abstract; }
  /** melting point in °C, or NaN */
  get meltC(): number { return this.tmC; }

  // ---- temperature. T = 1 is the melting point; T = 0 sits one reference
  // interval below it, which is what makes the interval itself meaningful.
  celsius(t: number): number { return this.tmC - (1 - t) * this.scale.kelvinPerUnit; }
  fromCelsius(c: number): number { return 1 - (this.tmC - c) / this.scale.kelvinPerUnit; }
  /** a dimensionless temperature DIFFERENCE (undercooling, superheat) → K */
  kelvin(dt: number): number { return dt * this.scale.kelvinPerUnit; }
  fromKelvin(k: number): number { return k / this.scale.kelvinPerUnit; }

  // ---- time
  seconds(t: number): number { return t * this.scale.secondsPerUnit; }
  fromSeconds(s: number): number { return s / this.scale.secondsPerUnit; }

  // ---- rates
  kPerSec(rate: number): number {
    return (rate * this.scale.kelvinPerUnit) / this.scale.secondsPerUnit;
  }
  fromKPerSec(kps: number): number {
    return (kps * this.scale.secondsPerUnit) / this.scale.kelvinPerUnit;
  }

  // ---- length and velocity
  micron(cells: number): number { return cells * this.scale.umPerCell; }
  fromMicron(um: number): number { return um / this.scale.umPerCell; }
  /** dimensionless length units per time unit → µm/s */
  umPerSec(v: number): number {
    return (v * this.scale.metresPerUnit * 1e6) / this.scale.secondsPerUnit;
  }

  /** the process regime the current cooling rate corresponds to */
  regime(coolRate: number): string { return regimeOf(this.kPerSec(coolRate)); }

  /**
   * Is this undercooling reachable in a real melt? Past ≈0.2·T_m the liquid
   * nucleates homogeneously no matter what you do, so a dial beyond it is
   * modelling territory and the UI marks it as such.
   */
  beyondReal(dtDimensionless: number): boolean {
    return this.known && this.kelvin(dtDimensionless) > maxRealUndercoolK(this.props);
  }

  // ---- formatters, in one place so every panel reads the same
  fmtC(t: number): string { return this.known ? `${this.celsius(t).toFixed(0)} °C` : "—"; }
  fmtK(dt: number): string { return this.known ? `${this.kelvin(dt).toFixed(1)} K` : "—"; }

  fmtRate(r: number): string {
    if (!this.known) return "—";
    const v = this.kPerSec(r);
    if (v === 0) return "0 K/s";
    const a = Math.abs(v);
    if (a >= 1e4) return `${v.toExponential(1)} K/s`;
    if (a >= 10) return `${v.toFixed(0)} K/s`;
    return `${v.toFixed(2)} K/s`;
  }

  fmtTime(t: number): string {
    if (!this.known) return "—";
    const s = this.seconds(t);
    const a = Math.abs(s);
    if (a < 1e-3) return `${(s * 1e6).toFixed(0)} µs`;
    if (a < 1) return `${(s * 1e3).toFixed(1)} ms`;
    if (a < 90) return `${s.toFixed(2)} s`;
    if (a < 5400) return `${(s / 60).toFixed(1)} min`;
    return `${(s / 3600).toFixed(2)} h`;
  }

  /** µm with a sensible number of digits for a grain or an arm spacing */
  fmtLen(cells: number): string {
    const um = this.micron(cells);
    return Math.abs(um) < 10 ? `${um.toFixed(2)} µm` : `${um.toFixed(0)} µm`;
  }
}
