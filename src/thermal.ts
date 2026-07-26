/**
 * THERMAL ANALYSIS — reading a cooling curve the way a foundry reads one.
 *
 * The lab already records the whole experiment: a series of (time, mean-liquid
 * temperature, solid fraction) samples. Until now it read exactly one thing off
 * that record — the deepest local minimum, labelled "recalescence" — and it read
 * it with a three-point comparison that finds a minimum in ANY noisy curve,
 * including quenches that never recalesce at all. This module replaces that with
 * the extraction a real thermal-analysis rig performs on a cast cup:
 *
 *   T_L  liquidus arrest   — where latent heat first bends the curve off its
 *                            pure-liquid cooling slope
 *   T_N  nucleation nadir  — the deepest undercooling before the melt recovers
 *   T_G  growth plateau    — the recalescence recovery peak (T_G − T_N = ΔT_r)
 *   T_S  solidus           — where the last liquid disappears
 *   plus the freezing range, the local solidification time, and the liquid
 *   cooling rate — all in the model's dimensionless temperature, which units.ts
 *   turns into °C, K and K/s for the report card.
 *
 * TWO honesty facts are baked in rather than papered over:
 *
 *   1. The "thermocouple" is the MEAN temperature of the remaining liquid, not a
 *      fixed probe. When a cold cell freezes it leaves the liquid set, so the
 *      mean of what remains can rise even with no latent heat — part of any
 *      recalescence measured here is that selection effect. And the record ENDS
 *      at the solidus, because past it there is no liquid left to average. A real
 *      thermocouple keeps reading into the solid; this one cannot, so the
 *      post-solidus branch a full Newtonian analysis needs is simply absent.
 *
 *   2. Every landmark this routine cannot find honestly is returned as `null`
 *      with a note saying why. It never invents a point to fill a slot.
 *
 * And one thing a foundry cannot do: the zero-curve method below DERIVES solid
 * fraction from the latent-heat deviation, while the solver MEASURES it in the
 * same series. So `fsRms` reports how far the foundry's own method missed the
 * truth — the method's error, measured, not asserted.
 *
 * References (single-sided Newtonian baseline; the full two-sided form needs the
 * solid-cooling tail this probe does not have):
 *   E. Fras, W. Kapturkiewicz, A. Burbielko, H.F. Lopez, "A new concept in
 *     thermal analysis of castings," AFS Trans. 101 (1993) 505–511.
 *   D.M. Stefanescu, "Thermal analysis — theory and applications in metalcasting,"
 *     Int. J. Metalcast. 9 (2015) 7–22.
 *
 * Pure TypeScript, no DOM, no imports from the app — so scripts/verify-thermal.mjs
 * loads it browser-free through vite's SSR loader and it runs in CI, the third
 * gate that can (units and heattreat are the other two).
 */

export interface TASample {
  t: number;
  /** mean liquid temperature, dimensionless (T = 1 is the equilibrium liquidus).
   *  A non-positive value is the "no liquid left" sentinel the lab already stores. */
  T: number;
  /** solid fraction measured by the solver, 0..1 */
  fs: number;
}

export interface Landmark {
  t: number;
  T: number;
}

export interface ThermalAnalysis {
  liquidus: Landmark | null;
  nadir: Landmark | null;
  growth: Landmark | null;
  solidus: Landmark | null;
  /** T_L − T_N, the nucleation undercooling (dimensionless) */
  undercoolN: number | null;
  /** T_G − T_N, the recalescence (dimensionless) */
  recalR: number | null;
  /** T_L − T_S, the freezing range (dimensionless) */
  freezeRange: number | null;
  /** t(T_S) − t(T_L), the local solidification time (dimensionless) */
  tf: number | null;
  /** dT/dt fitted in the pure-liquid region before T_L (negative, dimensionless/time) */
  rateLiquid: number | null;
  /** smoothed derivative trace, for the report-card overlay */
  deriv: { t: number; dTdt: number }[];
  /** solid fraction reconstructed from the single-sided Newtonian zero curve */
  fsDerived: { t: number; fs: number }[];
  /** RMS of (derived fs − measured fs) over the freezing interval — the method's error */
  fsRms: number | null;
  /** why any of the above is null, in plain words */
  notes: string[];
}

export interface AnalyseOpt {
  /** derivative half-window, as a fraction of the valid-region time span */
  window?: number;
  /** baseline-fit region for T_L, as a fraction of the valid span from the start */
  baseFrac?: number;
  /** T_L departure threshold, in units of the baseline-fit residual σ */
  arrestSigma?: number;
  /** recalescence must exceed this many σ to count as real, not noise */
  recalSigma?: number;
}

const DEF: Required<AnalyseOpt> = {
  window: 0.02,
  baseFrac: 0.22,
  arrestSigma: 4,
  recalSigma: 3,
};

/** ordinary least-squares line y = a + b·x over paired arrays; returns slope,
 *  intercept and the RMS residual. Used for the local derivative and the
 *  liquid-cooling baseline both. */
function lsLine(xs: number[], ys: number[]): { a: number; b: number; rms: number } {
  const n = xs.length;
  if (n < 2) return { a: ys[0] ?? 0, b: 0, rms: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const d = n * sxx - sx * sx;
  const b = Math.abs(d) < 1e-30 ? 0 : (n * sxy - sx * sy) / d;
  const a = (sy - b * sx) / n;
  let ss = 0;
  for (let i = 0; i < n; i++) { const r = ys[i] - (a + b * xs[i]); ss += r * r; }
  return { a, b, rms: Math.sqrt(ss / n) };
}

/**
 * Windowed least-squares derivative IN TIME, not in sample index. The lab
 * samples ~20 Hz while sites are still firing and ~4 Hz afterwards, so a filter
 * keyed to the sample index would mis-scale dT/dt by ~5× at the exact moment the
 * arrest happens. A time window includes however many samples fall inside it and
 * gets the slope right on both cadences.
 */
function smooth(t: number[], T: number[], half: number): { Ts: number[]; dT: number[] } {
  const n = t.length;
  const Ts = new Array<number>(n);
  const dT = new Array<number>(n);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && t[i] - t[lo] > half) lo++;
    while (hi < n - 1 && t[hi + 1] - t[i] <= half) hi++;
    // guarantee at least three points so the slope is defined even in a sparse tail
    let a = lo, b = hi;
    while (b - a < 2 && (a > 0 || b < n - 1)) { if (a > 0) a--; if (b < n - 1) b++; }
    const xs: number[] = [], ys: number[] = [];
    for (let k = a; k <= b; k++) { xs.push(t[k]); ys.push(T[k]); }
    const f = lsLine(xs, ys);
    Ts[i] = f.a + f.b * t[i];
    dT[i] = f.b;
  }
  return { Ts, dT };
}

/**
 * Analyse a cooling curve. `s` is the raw lab series; only the leading run of
 * samples with a valid (positive) liquid temperature is used for the temperature
 * landmarks, and the solidus is where that run ends.
 */
export function analyseCurve(s: TASample[], opt: AnalyseOpt = {}): ThermalAnalysis {
  const o = { ...DEF, ...opt };
  const notes: string[] = [];
  const empty: ThermalAnalysis = {
    liquidus: null, nadir: null, growth: null, solidus: null,
    undercoolN: null, recalR: null, freezeRange: null, tf: null,
    rateLiquid: null, deriv: [], fsDerived: [], fsRms: null, notes,
  };

  // the valid (liquid present) prefix — the temperature record proper
  let end = 0;
  while (end < s.length && s[end].T > 0) end++;
  const v = s.slice(0, end);
  if (v.length < 8) {
    notes.push("cooling curve too short to analyse — fewer than eight liquid samples recorded");
    return empty;
  }

  const t = v.map(p => p.t);
  const T = v.map(p => p.T);
  const span = t[t.length - 1] - t[0];
  if (span <= 0) { notes.push("no time elapsed across the recorded samples"); return empty; }

  const { Ts, dT } = smooth(t, T, Math.max(o.window * span, 1e-6));
  const deriv = t.map((tt, i) => ({ t: tt, dTdt: dT[i] }));

  // solidus: the last liquid the probe saw. If the series was cut off with liquid
  // still present (fs never reached ~1), say so rather than calling the cutoff a
  // solidus.
  const solidReached = end < s.length || v[v.length - 1].fs > 0.97;
  const solidus: Landmark | null = solidReached
    ? { t: t[v.length - 1], T: Ts[v.length - 1] }
    : null;
  if (!solidus) notes.push("the run ended with liquid still present — no solidus recorded");

  // baseline: fit the pure-liquid cooling over the first baseFrac of the span. Its
  // residual σ sets the bar both the arrest and the recalescence must clear.
  const tBase = t[0] + o.baseFrac * span;
  const bx: number[] = [], by: number[] = [];
  for (let i = 0; i < v.length && t[i] <= tBase; i++) { bx.push(t[i]); by.push(T[i]); }
  const base = bx.length >= 4 ? lsLine(bx, by) : null;
  const sigma = base ? Math.max(base.rms, 1e-6) : Infinity;

  // nadir + growth: recalescence is a local minimum the melt RECOVERS from, i.e. a
  // point where the smoothed derivative crosses from cooling (< 0) to warming
  // (> 0) and then back again, with the recovery clearing the noise floor. The
  // GLOBAL minimum of the curve is the solidus, which is colder than any
  // undercooling nadir — so the search is for a sign change in dT/dt, never the
  // coldest sample. A monotonic quench never crosses upward, so it reports no
  // nadir rather than fishing a noise minimum out of the tail.
  let nadir: Landmark | null = null;
  let growth: Landmark | null = null;
  const thr = o.recalSigma * sigma;
  for (let i = 1; i < v.length && base; i++) {
    if (dT[i - 1] <= 0 && dT[i] > 0) {                       // up-crossing → a local min
      let j = i + 1;
      while (j < v.length && dT[j] > 0) j++;                 // climb to the following local max
      const gi = Math.min(j, v.length - 1);
      const ni = Ts[i - 1] <= Ts[i] ? i - 1 : i;
      if (Ts[gi] - Ts[ni] > thr) {
        nadir = { t: t[ni], T: Ts[ni] };
        growth = { t: t[gi], T: Ts[gi] };
        break;
      }
    }
  }
  if (!nadir) notes.push("no recalescence arrest — the melt cooled through freezing without "
    + "recovering, so there is no nucleation nadir to report");

  // liquidus arrest: the first sustained departure of the curve above the
  // extrapolated pure-liquid baseline (latent heat makes the real curve warmer
  // than the line it was following).
  let liquidus: Landmark | null = null;
  if (base) {
    for (let i = 0; i < v.length; i++) {
      const dep = Ts[i] - (base.a + base.b * t[i]);
      const nxt = i + 1 < v.length ? Ts[i + 1] - (base.a + base.b * t[i + 1]) : dep;
      if (dep > o.arrestSigma * sigma && nxt > o.arrestSigma * sigma) {
        liquidus = { t: t[i], T: Ts[i] };
        break;
      }
    }
    if (!liquidus) notes.push("no liquidus arrest resolved — the curve never departed its "
      + "liquid-cooling slope by the detection threshold (a strong quench can look like this)");
  } else {
    notes.push("too few pre-arrest samples to fit a liquid-cooling baseline");
  }

  const rateLiquid = base ? base.b : null;
  const undercoolN = liquidus && nadir ? liquidus.T - nadir.T : null;
  const recalR = growth && nadir ? growth.T - nadir.T : null;
  const freezeRange = liquidus && solidus ? liquidus.T - solidus.T : null;
  const tf = liquidus && solidus ? solidus.t - liquidus.t : null;

  // ---- derived solid fraction via a single-sided Newtonian zero curve.
  // Fit Newton's law dT/dt = −k·(T − T_amb) to the pre-arrest liquid, where the
  // curve has no latent-heat term, by regressing the measured derivative on the
  // measured temperature there. The zero curve is then the derivative the sample
  // WOULD have with no freezing; the excess is the latent-heat rate, and its
  // running integral over the freezing interval is fs.
  let fsDerived: { t: number; fs: number }[] = [];
  let fsRms: number | null = null;
  if (liquidus && solidus && base) {
    const nx: number[] = [], ny: number[] = [];
    for (let i = 0; i < v.length && t[i] <= tBase; i++) { nx.push(T[i]); ny.push(dT[i]); }
    const newton = lsLine(nx, ny); // dT/dt = newton.a + newton.b·T  (b = −k)
    const iL = v.findIndex(p => p.t >= liquidus!.t);
    const iS = v.length - 1;
    const excess: number[] = new Array(v.length).fill(0);
    for (let i = iL; i <= iS; i++) {
      const zc = newton.a + newton.b * Ts[i];      // Newtonian (no-latent) derivative
      excess[i] = Math.max(0, dT[i] - zc);         // latent heat can only slow cooling
    }
    let total = 0;
    for (let i = iL + 1; i <= iS; i++) total += 0.5 * (excess[i] + excess[i - 1]) * (t[i] - t[i - 1]);
    if (total > 0) {
      let acc = 0;
      const meas: number[] = [], der: number[] = [];
      for (let i = iL; i <= iS; i++) {
        if (i > iL) acc += 0.5 * (excess[i] + excess[i - 1]) * (t[i] - t[i - 1]);
        const f = acc / total;
        fsDerived.push({ t: t[i], fs: f });
        der.push(f); meas.push(v[i].fs);
      }
      // rescale the measured fs across the same interval to a 0..1 progress so the
      // two are compared as fraction-of-freezing, which is what the method predicts
      const f0 = meas[0], f1 = meas[meas.length - 1];
      const denom = Math.abs(f1 - f0) > 1e-6 ? f1 - f0 : 1;
      let ss = 0;
      for (let i = 0; i < der.length; i++) {
        const m = (meas[i] - f0) / denom;
        ss += (der[i] - m) * (der[i] - m);
      }
      fsRms = Math.sqrt(ss / der.length);
      if (fsRms > 0.15) notes.push("the solid fraction reconstructed from the curve misses the "
        + "measured census by a wide margin — the single-sided Newtonian method assumes a point "
        + "thermocouple, and this probe is the mean of the shrinking liquid, so the disagreement is "
        + "the method's, not the solver's");
    } else {
      notes.push("the curve showed no latent-heat excess over the Newtonian baseline, so solid "
        + "fraction could not be reconstructed from it");
    }
  }

  return {
    liquidus, nadir, growth, solidus,
    undercoolN, recalR, freezeRange, tf, rateLiquid,
    deriv, fsDerived, fsRms, notes,
  };
}

/**
 * Keep a streaming cooling curve within `cap` samples WITHOUT throwing away its
 * head. The old code spliced off the oldest 400 samples on overflow, which on a
 * long run deletes the liquidus arrest — the single most important feature of the
 * curve — silently. This decimates instead: uniform stride across the whole span,
 * but the first sample, the last sample and the running temperature minimum are
 * always kept, so the span and the nadir survive every thinning.
 */
export function retain<S extends TASample>(s: S[], cap: number): S[] {
  if (s.length <= cap) return s;
  const stride = Math.ceil(s.length / Math.max(1, Math.floor(cap * 0.6)));
  let iMin = 0;
  for (let i = 1; i < s.length; i++) if (s[i].T > 0 && (s[iMin].T <= 0 || s[i].T < s[iMin].T)) iMin = i;
  const keep = new Set<number>([0, s.length - 1, iMin]);
  for (let i = 0; i < s.length; i += stride) keep.add(i);
  const out: S[] = [];
  for (let i = 0; i < s.length; i++) if (keep.has(i)) out.push(s[i]);
  return out;
}
