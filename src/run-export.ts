import type { Figure } from "./plot/figures";
import { bridgeLines, slug, toCSV } from "./plot/csv";
import type { GuidedLabReport } from "./labs/types";

export interface ArchiveEntry { name: string; data: Uint8Array }
const utf8 = new TextEncoder();

/** Standard ZIP CRC-32 (IEEE), shared by the local and central headers. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A small, dependency-free ZIP writer. PNGs are already compressed; CSVs
 * are stored verbatim. UTF-8 names, checksums, and standard directory records
 * let the package open in Explorer, macOS Archive Utility, and unzip. */
export function zipStore(entries: ArchiveEntry[]): Uint8Array<ArrayBuffer> {
  const names = new Set<string>();
  const files = entries.map(e => {
    if (!e.name || e.name.startsWith("/") || e.name.includes("\\") || e.name.split("/").includes("..") || names.has(e.name))
      throw new Error("Archive file names must be unique relative paths.");
    names.add(e.name);
    const name = utf8.encode(e.name);
    if (name.length > 65535) throw new Error("Archive file name is too long.");
    return { ...e, name, crc: crc32(e.data) };
  });
  if (files.length > 65535) throw new Error("Too many archive files.");
  const localSize = files.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = files.reduce((n, e) => n + 46 + e.name.length, 0);
  if (localSize + centralSize + 22 >= 0xffffffff) throw new Error("Run export is too large.");
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let at = 0, dir = localSize;
  for (const e of files) {
    v.setUint32(at, 0x04034b50, true);
    v.setUint16(at + 4, 20, true);
    v.setUint16(at + 6, 0x800, true); // UTF-8
    v.setUint16(at + 12, 0x21, true); // 1980-01-01
    v.setUint32(at + 14, e.crc, true);
    v.setUint32(at + 18, e.data.length, true);
    v.setUint32(at + 22, e.data.length, true);
    v.setUint16(at + 26, e.name.length, true);
    out.set(e.name, at + 30);
    out.set(e.data, at + 30 + e.name.length);
    v.setUint32(dir, 0x02014b50, true);
    v.setUint16(dir + 4, 20, true);
    v.setUint16(dir + 6, 20, true);
    v.setUint16(dir + 8, 0x800, true);
    v.setUint16(dir + 14, 0x21, true);
    v.setUint32(dir + 16, e.crc, true);
    v.setUint32(dir + 20, e.data.length, true);
    v.setUint32(dir + 24, e.data.length, true);
    v.setUint16(dir + 28, e.name.length, true);
    v.setUint32(dir + 42, at, true);
    out.set(e.name, dir + 46);
    at += 30 + e.name.length + e.data.length;
    dir += 46 + e.name.length;
  }
  v.setUint32(dir, 0x06054b50, true);
  v.setUint16(dir + 8, files.length, true);
  v.setUint16(dir + 10, files.length, true);
  v.setUint32(dir + 12, centralSize, true);
  v.setUint32(dir + 16, localSize, true);
  return out;
}

export interface RunSnapshot {
  exportedAt: string;
  build: string;
  solver: string;
  mode: "2d" | "3d";
  material: { key: string; name: string; constants: unknown; mix: unknown; sourceMix?: unknown; compositionEdited?: boolean; caveats: string[] };
  seed: number;
  grid: number;
  simulationTime: number;
  parameters: Record<string, number>;
  setupLink: string;
  units: unknown;
  camera: unknown;
  image: { lens: number; lensName?: string; umPerPixel: number; perspective: boolean };
  statistics: unknown;
  lab?: unknown;
  /** Recorded search/replay metadata, with its own latched objective and setup. */
  optimizer3d?: unknown;
}

export interface RunAgingCurvePoint {
  timeMin: number;
  sigmaTotalMPa: number;
  sigmaPptMPa: number;
  sigmaSsMPa?: number;
  pBar?: number;
}

export interface RunAgingExport {
  alloy: string;
  tC: number;
  holdMin: number;
  temper: string;
  hpMPa: number;
  ssMPa: number;
  pptMPa: number;
  totalMPa: number;
  curve: RunAgingCurvePoint[];
}

export function hasFigureData(f: Figure): boolean {
  return f.columns.some(c => c.values.some(Number.isFinite));
}

function agingCurveCSV(snapshot: RunSnapshot, aging: RunAgingExport): string {
  const fmt = (v: number | undefined) => (v != null && Number.isFinite(v) ? Number(v.toPrecision(8)).toString() : "");
  const seedHex = snapshot.seed.toString(16).padStart(8, "0");
  const hasSs = aging.curve.some(p => typeof p.sigmaSsMPa === "number" && Number.isFinite(p.sigmaSsMPa));
  const hasPBar = aging.curve.some(p => typeof p.pBar === "number" && Number.isFinite(p.pBar));
  const lines = [
    "# SOLIDIFY figure data: Precipitation age-hardening curve (Shercliff-Ashby 1990)",
    `# alloy: ${aging.alloy}`,
    `# material: ${snapshot.material.name}`,
    `# seed: ${seedHex}`,
    `# grid: ${snapshot.grid}${snapshot.mode === "3d" ? "³" : "²"} cells (${snapshot.mode === "3d" ? "TRUE 3D" : "2D"})`,
    `# solver: ${snapshot.solver}`,
    `# aging_temperature_C: ${fmt(aging.tC)}`,
    `# aging_hold_min: ${fmt(aging.holdMin)}`,
    `# temper: ${aging.temper}`,
    `# sigma_HP_MPa: ${fmt(aging.hpMPa)}`,
    `# delta_sigma_ss_MPa: ${fmt(aging.ssMPa)}`,
    `# delta_sigma_ppt_MPa: ${fmt(aging.pptMPa)}`,
    `# sigma_total_MPa: ${fmt(aging.totalMPa)}`,
    `# units: time_min (min), time_s (s), sigma_total_MPa (MPa), delta_sigma_ppt_MPa (MPa)${hasSs ? ", delta_sigma_ss_MPa (MPa)" : ""}${hasPBar ? ", P_bar (dimensionless)" : ""}`,
    `# share: ${snapshot.setupLink}`,
    `# build: ${snapshot.build}`,
    `# rows: ${aging.curve.length}`,
  ];
  const cols = [
    "time_min",
    "time_s",
    "sigma_total_MPa",
    "delta_sigma_ppt_MPa",
    ...(hasSs ? ["delta_sigma_ss_MPa"] : []),
    ...(hasPBar ? ["P_bar"] : []),
  ];
  lines.push(cols.join(","));
  for (const pt of aging.curve) {
    const row = [
      fmt(pt.timeMin),
      fmt(pt.timeMin * 60),
      fmt(pt.sigmaTotalMPa),
      fmt(pt.sigmaPptMPa),
      ...(hasSs ? [fmt(pt.sigmaSsMPa)] : []),
      ...(hasPBar ? [fmt(pt.pBar)] : []),
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

/** Freeze every series and its own conversion before the asynchronous PNG
 * read. Separate datasets keep separate clocks and prior-run identities. */
export function runEntries(
  snapshot: RunSnapshot,
  figures: Figure[],
  labReport?: GuidedLabReport | null,
  aging?: RunAgingExport | null,
): ArchiveEntry[] {
  const datasets = figures.filter(hasFigureData).map((f, i) => ({
    file: `data/${String(i + 1).padStart(2, "0")}-${slug(f.title) || "series"}.csv`,
    title: f.title,
    provenance: f.prov,
    units: bridgeLines(f.bridge),
    scale: f.bridge.units.scale,
    columns: f.columns.map(c => ({ ...c, values: c.values.map(x => Number.isFinite(x) ? x : null) })),
    csv: toCSV(f.title, f.columns, f.bridge, f.prov),
  }));
  const agingSummary = aging
    ? {
        alloy: aging.alloy,
        tC: aging.tC,
        holdMin: aging.holdMin,
        temper: aging.temper,
        hpMPa: aging.hpMPa,
        ssMPa: aging.ssMPa,
        pptMPa: aging.pptMPa,
        totalMPa: aging.totalMPa,
        file: "data/aging-curve.csv",
        points: aging.curve.length,
      }
    : undefined;
  const manifest = {
    format: "solidify-run", version: 1, ...snapshot,
    ...(agingSummary ? { aging: agingSummary } : {}),
    reproducibility: "The setup link restores the initial setup and seed. This archive records observations and an image; it does not restore the current GPU field or an in-progress anneal.",
    datasets: datasets.map(({ csv: _csv, ...d }) => d),
    notes: [
      "Each dataset retains its own material, seed, solver, unit bridge, and clock. Lab, heat-treatment, or optimizer results may belong to an earlier run; consult their provenance.",
      "Empty instruments are omitted. Enable probes before running to record their time series. Missing or non-finite values are null in JSON and blank in CSV.",
      "The PNG shows the current camera and lens with no interface panels. Perspective scales are approximate at the camera target.",
    ],
  };
  const readme = [
    "SOLIDIFY run export", "",
    "run.json: versioned setup, material constants, units, provenance, and recorded data.",
    "micrograph.png: current rendered view, scale, material, seed, and solver.",
    "data/*.csv: every available instrument dataset with its own provenance and units.",
    ...(aging ? ["data/aging-curve.csv: precipitation age-hardening strength curve and temper summary."] : []),
    ...(labReport ? ["lab-report.json: guided lab progress, latched measurements, and summary table."] : []),
    "",
    manifest.reproducibility, "", ...manifest.notes,
    ...(datasets.length ? [] : ["", "No series were recorded yet. The setup and current image are included."]),
    "", snapshot.setupLink, "",
  ].join("\n");
  return [
    { name: "README.txt", data: utf8.encode(readme) },
    { name: "run.json", data: utf8.encode(JSON.stringify(manifest, null, 2) + "\n") },
    ...datasets.map(d => ({ name: d.file, data: utf8.encode(d.csv) })),
    ...(aging ? [{ name: "data/aging-curve.csv", data: utf8.encode(agingCurveCSV(snapshot, aging)) }] : []),
    ...(labReport ? [{ name: "lab-report.json", data: utf8.encode(JSON.stringify(labReport, null, 2) + "\n") }] : []),
  ];
}

/** A scale printed on the image follows the renderer's current zoom. The
 * perspective case explicitly locates it at the camera target. */
export function imageScale(umPerPixel: number, width: number): { microns: number; pixels: number } | null {
  if (!(umPerPixel > 0) || !Number.isFinite(umPerPixel) || width < 1) return null;
  const target = Math.min(150, width * 0.24) * umPerPixel;
  const power = 10 ** Math.floor(Math.log10(target));
  const microns = [1, 2, 5, 10].map(n => n * power).reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
  return { microns, pixels: microns / umPerPixel };
}

export async function micrographPNG(source: HTMLCanvasElement, snapshot: RunSnapshot): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = source.width;
  const scale = Math.max(1, c.width / 1100);
  const footer = Math.ceil(132 * scale);
  c.height = source.height + footer;
  const ctx = c.getContext("2d");
  if (!ctx || !source.width || !source.height) throw new Error("The simulation image is not ready yet.");
  // drawImage must precede the first await: WebGPU discards presented images.
  ctx.drawImage(source, 0, 0);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, source.height, c.width, footer);
  ctx.fillStyle = "#f1f1f1";
  ctx.font = `${16 * scale}px sans-serif`;
  const pad = 18 * scale;
  const line = (s: string, y: number) => {
    let text = s;
    while (text.length > 1 && ctx.measureText(text).width > c.width - 2 * pad) text = text.slice(0, -1);
    ctx.fillText(text, pad, source.height + y * scale);
  };
  line(`SOLIDIFY | ${snapshot.material.name} | seed ${snapshot.seed.toString(16).padStart(8, "0")} | ${snapshot.mode.toUpperCase()} | ${snapshot.grid}${snapshot.mode === "3d" ? "³" : "²"}`, 25);
  line(`${snapshot.solver} | ${snapshot.build} | ${snapshot.image.lensName ?? `lens ${snapshot.image.lens}`}`, 49);
  const bar = imageScale(snapshot.image.umPerPixel, c.width - 2 * pad);
  if (bar) {
    const y = source.height + 77 * scale;
    ctx.fillRect(pad, y, bar.pixels, 4 * scale);
    const length = bar.microns >= 1000 ? `${Number((bar.microns / 1000).toPrecision(4))} mm` : `${Number(bar.microns.toPrecision(4))} µm`;
    line(`${snapshot.image.perspective ? "≈ " : ""}${length}${snapshot.image.perspective ? " at camera target; perspective varies with depth" : " (model resolution)"}`, 110);
  } else line("Image scale unavailable; see run.json for model resolution.", 100);
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error("Could not encode the micrograph.")), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export function downloadRun(filename: string, bytes: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
