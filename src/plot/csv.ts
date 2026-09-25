// A figure's data as CSV, with where it came from (U2).
//
// Every export carries a "#" provenance header: the material, the seed, the
// grid, the solver that ran, a share link that reopens the setup (every dial,
// not just the seed), the build, the unit bridge in force when the series
// started (how T̃ and t̃ became °C and s, each factor's provenance from
// units.ts, and the time anchor with its Lewis caveat), the chemistry the
// series ran under, then one row per sample with the stored dimensionless
// value AND, where a bridge exists, its SI value beside it. Pure: no DOM
// (verify-plot.mjs parses what this writes).
import { outColumns, timeUnit, type Bridge, type Column } from "./quantity";
import { columnFormat } from "./ticks";
import type { Chem, Figure } from "./figures";

/**
 * What a figure's provenance names about the run (main.ts plotMeta): enough
 * to reproduce it. The seed alone does not fix the dials, so the share link
 * (app.shareLink: every dial, the material, the seed) is part of it.
 */
export interface PlotMeta {
  /** the melt's name, as the head plate prints it */
  material: string;
  /** the run's seed, as the rail prints it */
  seed: string;
  /** "1024² cells (2D)", "160³ cells (TRUE 3D)" */
  grid: string;
  /** "Kobayashi (1993)", "Karma–Rappel quantitative, λ = 30 (W₀/d₀ = 33.9)" */
  solver: string;
  /** the share link that reopens this setup */
  share: string;
  /** the build that drew it (vite.config.ts __SOLIDIFY_BUILD__) */
  build: string;
}

export interface Prov extends PlotMeta {
  /** samples recorded before any decimation (more than the rows: decimated) */
  recorded?: number;
  /** the chemistry the series ran under (figures.ts Chem, latched with it) */
  chem?: Chem | null;
  /** anything else the owner wants on record (the pour's setup) */
  extra?: string[];
}

const num = (v: number, sig = 6): string => Number(v.toPrecision(sig)).toString();

/** how the stored numbers became SI, one line each */
export function bridgeLines(b: Bridge): string[] {
  const s = b.units.scale;
  if (!b.known) {
    return [
      "unit bridge: none; this material has no SI identity, so T and t are dimensionless (T_m = 1)",
      `length: ${num(s.umPerCell)} µm per cell (${s.prov.umPerCell}); lengths are real`,
    ];
  }
  const lewis = b.lewisMatched === false
    ? (b.timeAnchor === "solute-diffusion"
      ? "; Lewis number not matched on one grid, so the temperature field is imposed"
      : "; Lewis number not matched, exact for a pure melt (no solute field)")
    : "";
  // T̃ = 1 is T_m, except under the calibrated alloy solver, whose reference
  // state is the nominal alloy's liquidus (units.ts oneShiftK)
  const temp = s.oneShiftK
    ? `unit bridge: T[°C] = T_1 − (1 − T̃)·ΔT_ref; T̃ = 1 is T_liq(c0) = ${num(b.units.oneC)} °C, not T_m (${s.oneSource}; `
      + `the calibrated solver's T̃ = 1 is the nominal alloy's liquidus and T̃ = 0 its solidus); T_m = ${num(b.units.meltC)} °C; `
      + `ΔT_ref = ${num(s.kelvinPerUnit)} K per unit (${s.prov.kelvinPerUnit})`
    : `unit bridge: T[°C] = T_m − (1 − T̃)·ΔT_ref; T_m = ${num(b.units.meltC)} °C; ΔT_ref = ${num(s.kelvinPerUnit)} K per unit (${s.prov.kelvinPerUnit})`;
  return [
    temp,
    `time: t[s] = t̃·τ; τ = ${num(s.secondsPerUnit)} s per unit (${s.prov.secondsPerUnit}; ${b.timeAnchor} anchor${lewis})`,
    `length: ${num(s.umPerCell)} µm per cell (${s.prov.umPerCell})`,
  ];
}

/** the chemistry line: the solver's own dimensionless m̃, c̃₀ and k */
export function chemLine(c: Chem): string {
  if (!c.alloy) return "chemistry: a pure melt (no solute field)";
  const wt = c.c0wt != null ? ` (${num(c.c0wt, 4)} wt%)` : "";
  return `chemistry (the solver's, dimensionless): solute field on, m̃ = ${num(c.mLiq, 4)}, c̃₀ = ${num(c.c0, 4)}${wt}, k = ${num(c.kPart, 4)}`;
}

/** the provenance header, without the leading "# " */
export function provLines(title: string, b: Bridge, prov: Prov, rows: number): string[] {
  const dec = prov.recorded != null && prov.recorded > rows ? ` (decimated from ${prov.recorded} samples)` : "";
  return [
    `SOLIDIFY figure data: ${title}`,
    `material: ${prov.material}`,
    `seed: ${prov.seed}`,
    `grid: ${prov.grid}`,
    `solver: ${prov.solver}`,
    ...bridgeLines(b),
    ...(prov.chem ? [chemLine(prov.chem)] : []),
    ...(prov.extra ?? []),
    `share: ${prov.share}`,
    `build: ${prov.build}`,
    `rows: ${rows}${dec}`,
  ];
}

/** the table a modal shows: header cells (figure markup), rows of formatted
 *  cells, and the provenance (its last line is shown, all of it on hover).
 *  `text`: how many leading columns are words (set left, the numbers right) */
export interface TableData { head: string[]; rows: string[][]; prov: string[]; text?: number }

/** a figure's table: one format per column (its decimals from its largest
 *  value), so the digits line up down the column the way a paper sets them */
export function figureTable(f: Figure): TableData {
  // the SI time column in the unit the plot's axis and readout use (ms, s,
  // min: timeUnit over the column's span, the rule resolve() applies to the
  // axis), so a readout checks against its row without converting; the CSV
  // keeps base SI seconds, as its header states
  const cols = outColumns(f.columns, f.bridge).map(c => {
    if (c.si !== "time") return c;
    const span = Math.max(0, ...c.values.filter(Number.isFinite).map(Math.abs));
    const tu = timeUnit(span);
    return tu.perSecond === 1 ? c : { ...c, head: c.head.replace(/\(s\)$/, `(${tu.unit})`), values: c.values.map(v => v * tu.perSecond) };
  });
  const n = Math.max(0, ...cols.map(c => c.values.length));
  const fmts = cols.map(c => columnFormat(c.values, 5));
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) rows.push(cols.map((c, k) => fmts[k](c.values[i] ?? NaN)));
  return { head: cols.map(c => c.head), rows, prov: provLines(f.title, f.bridge, f.prov, n) };
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * An export's file name stem: the figure, the melt and when, ASCII only.
 * A crystal direction's brackets are read as words first, since slug()
 * drops them and the family went with them ("Pole figure ⟨100⟩" saved as
 * solidify-pole-figure, and [001] and (0001) became 001 and 0001): ⟨100⟩ a
 * family, [001] an axis, (0001) a basal plane. The melt and a minute stamp
 * keep exports of different runs from all taking one name.
 */
export function fileStem(title: string, material: string, at = new Date()): string {
  const words = title
    .replace(/⟨([^⟩]+)⟩/g, " $1 family ")
    .replace(/\[([0-9̄-]+)\]/g, " $1 axis ")
    .replace(/\((\d{4})\)/g, " $1 basal ");
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p2(at.getMonth() + 1)}${p2(at.getDate())}-${p2(at.getHours())}${p2(at.getMinutes())}`;
  return ["solidify", slug(words), slug(material), stamp].filter(Boolean).join("-");
}

/** CSV text: the provenance as "#" lines, a header row of ASCII keys, then
 *  one row per sample (an empty cell where a column has no value) */
export function toCSV(title: string, cols: Column[], b: Bridge, prov: Prov): string {
  const out = outColumns(cols, b);
  const rows = Math.max(0, ...out.map(c => c.values.length));
  const lines = provLines(title, b, prov, rows).map(l => `# ${l}`);
  lines.push(out.map(c => c.key).join(","));
  for (let i = 0; i < rows; i++)
    lines.push(out.map(c => { const v = c.values[i]; return v != null && Number.isFinite(v) ? num(v, 8) : ""; }).join(","));
  return lines.join("\n") + "\n";
}
