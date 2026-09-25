// What a plotted number IS, and the unit it is shown in (U2).
//
// The solver stores everything dimensionless. A plot shows SI only when the
// material has an SI identity (units.ts `Units.known`); otherwise its axis
// says "dimensionless", with T_m = 1 named for temperatures. Every axis title
// the plots draw comes from `resolve` below, so "a claim carries its units"
// (tasks/lessons.md) is one function, gated browser-free in verify-plot.mjs.
//
// A `Bridge` is the Units object in force when a series STARTED, latched: the
// solver can be re-anchored mid-run (a material swap, the solute field turned
// on, the latent-heat dial moved), and a series converted with two different
// bridges is two series. Owners compare `sig` and start a new series when it
// changes (charts-audit section 3, "Latching").
//
// Text here may carry the figure markup the painter understands: `_{...}` is
// a subscript (T_{L}), and U+0303 after a letter is the tilde of a
// dimensionless symbol (T̃). Pure: no DOM.
import type { Units } from "../units";

/** the dimensionless symbols (a combining tilde on the letter) */
export const T_DIM = "T̃";
export const t_DIM = "t̃";

export interface Bridge {
  /** the converter in force when the series started. Units is immutable
   *  (its scale is readonly), and main.ts builds a fresh one per call */
  units: Units;
  /** the melt's name as the head plate prints it */
  material: string;
  known: boolean;
  /** which diffusivity anchors the clock, or null with no SI identity */
  timeAnchor: "solute-diffusion" | "heat-diffusion" | null;
  /** is the Lewis number matched at these settings (units.ts groups) */
  lewisMatched: boolean | null;
  /** identity of the conversion: equal sigs convert identically */
  sig: string;
}

export function bridgeOf(u: Units, material: string): Bridge {
  const known = u.known;
  const anchor = !known ? null
    : u.scale.prov.secondsPerUnit === "forced by solute diffusion" ? "solute-diffusion" as const
      : "heat-diffusion" as const;
  const lewis = u.scale.groups.find(g => g.name.startsWith("Lewis"));
  return {
    units: u, material, known, timeAnchor: anchor,
    lewisMatched: lewis ? lewis.ok : null,
    // oneC: what T̃ = 1 is (T_m, or the calibrated alloy's liquidus)
    sig: [material, u.scale.kelvinPerUnit, u.scale.secondsPerUnit, u.meltC, u.oneC, u.scale.umPerCell, anchor].join("|"),
  };
}

/** `angle` is in degrees, `volume` in µm³ (real, like a length), `dimless` a
 *  pure number that is not a fraction (a projection coordinate), `id` a label
 *  that is a number (a grain's id) */
export type QKind = "temp" | "dtemp" | "time" | "rate" | "length" | "fraction" | "percent" | "count"
  | "angle" | "volume" | "dimless" | "id";

/** a plotted quantity: its kind, its symbol (markup allowed) and a name for
 *  the axis title ("" for a symbol-only title) */
export interface Quantity {
  kind: QKind;
  sym: string;
  /** the symbol of its dimensionless form; defaults to `sym` with the tilde
   *  on its first T or t */
  symDim?: string;
  name: string;
}

/** a quantity resolved against a bridge: how an axis, a readout and a table
 *  column print it */
export interface Resolved {
  /** the full axis title, unit last in parentheses */
  title: string;
  /** the short form (symbol and unit) for a small panel */
  short: string;
  /** the symbol a readout prints ("T", "T̃") */
  sym: string;
  /** the display unit ("°C", "ms", "dimensionless") */
  unit: string;
  /** true when converted to SI */
  si: boolean;
  /** stored value -> display value */
  conv: (v: number) => number;
}

const tilde = (s: string): string => {
  const i = s.search(/[Tt]/);
  return i < 0 ? s : s.slice(0, i + 1) + "̃" + s.slice(i + 1);
};

/** a time prefix that keeps the labels between 1 and 1000: µs, ms, s, min, h */
export function timeUnit(maxSeconds: number): { unit: string; perSecond: number } {
  const a = Math.abs(maxSeconds);
  if (!(a > 0) || !Number.isFinite(a)) return { unit: "s", perSecond: 1 };
  if (a < 1e-3) return { unit: "µs", perSecond: 1e6 };
  if (a < 1) return { unit: "ms", perSecond: 1e3 };
  if (a < 180) return { unit: "s", perSecond: 1 };
  if (a < 3 * 3600) return { unit: "min", perSecond: 1 / 60 };
  return { unit: "h", perSecond: 1 / 3600 };
}

const title = (name: string, sym: string, unit: string): string =>
  `${name ? name + " " : ""}${sym} (${unit})`;

/**
 * Resolve a quantity for display. `span` is the largest |stored value| the
 * axis will show; only time uses it, to pick a prefix (ms, s, min).
 */
export function resolve(q: Quantity, b: Bridge, span = 0): Resolved {
  const u = b.units;
  const dim = q.symDim ?? tilde(q.sym);
  const same = (unit: string, sym = q.sym): Resolved =>
    ({ title: title(q.name, sym, unit), short: title("", sym, unit), sym, unit, si: false, conv: v => v });
  switch (q.kind) {
    case "temp":
      // the full title names the scale's anchor; a short panel keeps the word
      if (!b.known) return { ...same("dimensionless, T_{m} = 1", dim), short: title("", dim, "dimensionless"), unit: "dimensionless" };
      return { title: title(q.name, q.sym, "°C"), short: title("", q.sym, "°C"), sym: q.sym, unit: "°C", si: true, conv: v => u.celsius(v) };
    case "dtemp":
      if (!b.known) return same("dimensionless", dim);
      return { title: title(q.name, q.sym, "K"), short: title("", q.sym, "K"), sym: q.sym, unit: "K", si: true, conv: v => u.kelvin(v) };
    case "time": {
      if (!b.known) return same("dimensionless", dim);
      const tu = timeUnit(u.seconds(span));
      // the clock's anchor is named on the axis: under the solute anchor the
      // Lewis number is not matched and the seconds carry that (units.ts).
      // The short form, which a 252 px panel falls back to, keeps it too in
      // one word ("t (s, solute anchor)"): a small panel is where the
      // seconds are read (charts-audit section 3)
      const unit = `${tu.unit}, ${b.timeAnchor} anchor`;
      const brief = `${tu.unit}, ${b.timeAnchor === "solute-diffusion" ? "solute" : "heat"} anchor`;
      return { title: title(q.name, q.sym, unit), short: title("", q.sym, brief), sym: q.sym, unit: tu.unit, si: true, conv: v => u.seconds(v) * tu.perSecond };
    }
    case "rate":
      if (!b.known) return same("dimensionless", dim);
      return { title: title(q.name, q.sym, "K·s⁻¹"), short: title("", q.sym, "K·s⁻¹"), sym: q.sym, unit: "K·s⁻¹", si: true, conv: v => u.kPerSec(v) };
    case "length":
      // lengths are always real: µm per cell is set, never derived (units.ts)
      return { ...same("µm"), si: true };
    case "fraction": return same("dimensionless");
    case "percent": return same("%");
    case "count": return same("count");
    case "angle": return same("°");
    case "volume": return { ...same("µm³"), si: true };
    case "dimless": return same("dimensionless");
    case "id": return same("id");
  }
}

/** one column of a figure's data, in stored (solver) values */
export interface Column {
  /** ASCII stem for the CSV header ("t", "T", "dTdt", "fs_measured") */
  key: string;
  q: Quantity;
  values: number[];
}

/** a CSV / table column: its header (markup) and its values; `si` marks the
 *  SI column of a time (base seconds), which a table may re-express */
export interface OutColumn { key: string; head: string; values: number[]; si?: "time" }

/**
 * The columns a figure's data table and CSV carry: the stored dimensionless
 * value always, and beside it the SI value where a bridge exists (base SI
 * units: s, not ms). Lengths, fractions, percents and counts have one form.
 */
export function outColumns(cols: Column[], b: Bridge): OutColumn[] {
  const u = b.units;
  const out: OutColumn[] = [];
  for (const c of cols) {
    const dim = c.q.symDim ?? tilde(c.q.sym);
    switch (c.q.kind) {
      case "temp": case "dtemp": case "time": case "rate": {
        out.push({ key: `${c.key}_dimensionless`, head: `${dim} (dimensionless)`, values: c.values });
        if (!b.known) break;
        const [suffix, unit, f] =
          c.q.kind === "temp" ? ["C", "°C", (v: number) => u.celsius(v)] as const
            : c.q.kind === "dtemp" ? ["K", "K", (v: number) => u.kelvin(v)] as const
              : c.q.kind === "time" ? ["s", "s", (v: number) => u.seconds(v)] as const
                : ["K_per_s", "K·s⁻¹", (v: number) => u.kPerSec(v)] as const;
        out.push({ key: `${c.key}_${suffix}`, head: `${c.q.sym} (${unit})`, values: c.values.map(f), ...(c.q.kind === "time" ? { si: "time" as const } : {}) });
        break;
      }
      case "length": out.push({ key: `${c.key}_um`, head: `${c.q.sym} (µm)`, values: c.values }); break;
      case "fraction": out.push({ key: c.key, head: `${c.q.sym} (dimensionless)`, values: c.values }); break;
      case "percent": out.push({ key: `${c.key}_percent`, head: `${c.q.sym} (%)`, values: c.values }); break;
      case "count": out.push({ key: c.key, head: `${c.q.sym} (count)`, values: c.values }); break;
      case "angle": out.push({ key: `${c.key}_deg`, head: `${c.q.sym} (°)`, values: c.values }); break;
      case "volume": out.push({ key: `${c.key}_um3`, head: `${c.q.sym} (µm³)`, values: c.values }); break;
      case "dimless": out.push({ key: c.key, head: `${c.q.sym} (dimensionless)`, values: c.values }); break;
      case "id": out.push({ key: c.key, head: c.q.sym, values: c.values }); break;
    }
  }
  return out;
}
