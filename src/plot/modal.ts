// The full view of any figure (U2): the panel spec's modal (design/panel.ts
// plotModal) holding the figure large, with the hover readout, its data as a
// table, and three exports: the data as CSV (dimensionless and SI columns and
// a provenance header, csv.ts), the plot as a PNG as it looks here, and a
// print figure (light background, heavier lines, sized for a page).
//
// It is live: the owner calls update() when its data moves, and the plot
// follows at once and the table at most once a second.
//
// The core (`openModal`) does not know how the plot is drawn: a canvas figure
// (`openFigure`, every XY and polar figure) and the SVG phase diagram
// (phasediagram.ts) mount their own plot in it and hand it their table and
// exports, so every enlarged view in the instrument is the same modal.
import { plotModal, pill } from "../design/panel";
import { PlotView, layoutAny, paintAny, type AnySpec } from "./view";
import { modalPlotSize, printSize, runs } from "./layout";
import { isPolar, polarModalSize, polarPrintSize } from "./polar";
import { canvasMeasure } from "./paint";
import { screenPngTheme, printTheme, type Theme } from "./theme";
import { toCSV, slug, fileStem, figureTable, type TableData } from "./csv";
import type { Figure } from "./figures";

export interface FigureHandle {
  /** the owner's data moved: redraw (the table at most once a second) */
  update(): void;
  close(): void;
  readonly open: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** figure markup as HTML: `_{...}` becomes <sub> */
export const richHtml = (s: string): string =>
  runs(s).map(r => (r.sub ? `<sub>${esc(r.text)}</sub>` : esc(r.text))).join("");
// the pure halves (the file names, the table) live in csv.ts, where the
// browser-free gate reaches them
export { slug, fileStem, figureTable, type TableData };

export function download(name: string, blob: Blob): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** a figure's size in the enlarged view, for a window of vw x vh */
export const figureSize = (f: AnySpec, vw: number, vh: number): [number, number] =>
  isPolar(f) ? polarModalSize(vw, vh) : modalPlotSize(f, vw, vh);
/** a figure's size as a print figure */
export const figurePrintSize = (f: AnySpec): [number, number] => (isPolar(f) ? polarPrintSize() : printSize(f));

/** render a figure off screen at `w` x `h` CSS px and `scale`, as a PNG blob */
export function renderPng(f: Figure, w: number, h: number, scale: number, th: Theme): Promise<Blob | null> {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d")!;
  const L = layoutAny(f.fig, w, h, canvasMeasure(ctx, th));
  paintAny(ctx, L, th, scale);
  return new Promise(res => c.toBlob(res, "image/png"));
}

export interface ModalSpec {
  title: string;
  /** the plot's size, CSS px */
  size: [number, number];
  /** build the plot in `holder` (already sized) */
  mount(holder: HTMLElement): { update(): void; destroy(): void };
  table(): TableData;
  csv(): string;
  png(): Promise<Blob | null>;
  figurePng(): Promise<Blob | null>;
  /** the modal's parent (default #app); a modal opened over another modal
   *  goes inside it */
  host?: HTMLElement;
  /** the melt (or the mix), for the exports' file names (fileStem) */
  material: string;
}

export function openModal(spec: ModalSpec, onClosed?: () => void): FigureHandle {
  let open = true;
  let lastTable = 0;
  let tableTimer = 0;
  let plot: { update(): void; destroy(): void } | null = null;
  const handle: FigureHandle = {
    update() {
      if (!open) return;
      plot?.update();
      const now = performance.now();
      if (now - lastTable >= 1000) fillTable();
      else if (!tableTimer) tableTimer = window.setTimeout(() => { tableTimer = 0; if (open) fillTable(); }, 1000 - (now - lastTable));
    },
    close() { if (open) closeB(); },
    get open() { return open; },
  };
  const { wrap, card } = plotModal(spec.title, () => {
    open = false;
    if (tableTimer) clearTimeout(tableTimer);
    plot?.destroy();
    wrap.remove();
    onClosed?.();
  }, spec.host);
  card.classList.add("figmodal");
  const closeB = () => card.querySelector<HTMLButtonElement>("#bigClose")?.click();
  const [wide, tall] = spec.size;
  const holder = document.createElement("div");
  holder.className = "figmodal__plot";
  holder.style.width = `${wide}px`;
  holder.style.height = `${tall}px`;
  card.append(holder);
  plot = spec.mount(holder);

  // the exports, then what the data is: its rows and where it came from
  const bar = document.createElement("div");
  bar.className = "pactions figmodal__bar";
  // the stem at the moment of the export: a minute stamp tells runs apart
  const stem = () => fileStem(spec.title, spec.material);
  const csv = pill("csv", () => download(`${stem()}.csv`, new Blob(["﻿" + spec.csv()], { type: "text/csv;charset=utf-8" })));
  csv.title = "download the data: dimensionless and SI columns, with its provenance";
  const png = pill("png", () => { const s = stem(); void spec.png().then(b => b && download(`${s}.png`, b)); });
  png.title = "download this plot as shown";
  const fig = pill("figure png", () => { const s = stem(); void spec.figurePng().then(b => b && download(`${s}-figure.png`, b)); });
  fig.title = "download a print figure: light background, heavier lines";
  const meta = document.createElement("span");
  meta.className = "figmodal__meta q";
  bar.append(csv, png, fig, meta);
  card.append(bar);

  const tbox = document.createElement("div");
  tbox.className = "figmodal__table";
  tbox.tabIndex = 0;
  tbox.setAttribute("role", "region");
  tbox.setAttribute("aria-label", `${spec.title}: data table`);
  card.append(tbox);
  card.style.width = `${wide + 34}px`;

  function fillTable() {
    lastTable = performance.now();
    const t = spec.table();
    meta.textContent = t.prov[t.prov.length - 1] ?? "";
    meta.title = t.prov.join("\n");
    const tx = (i: number) => (i < (t.text ?? 0) ? ` class="txt"` : "");
    const head = `<tr>${t.head.map((h, i) => `<th scope="col"${tx(i)}>${richHtml(h)}</th>`).join("")}</tr>`;
    const body = t.rows.map(r => `<tr>${r.map((c, i) => `<td${tx(i)}>${esc(c)}</td>`).join("")}</tr>`).join("");
    tbox.innerHTML = `<table class="dtable"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }
  fillTable();
  return handle;
}

/** the enlarged view of a canvas figure (XY or polar), live through `get` */
export function openFigure(get: () => Figure, onClosed?: () => void, host?: HTMLElement): FigureHandle {
  let f = get();
  const [wide, tall] = figureSize(f.fig, innerWidth, innerHeight);
  return openModal({
    title: f.title,
    size: [wide, tall],
    host,
    material: f.prov.material,
    mount(holder) {
      const view = new PlotView(holder, { label: `${f.title}: plot` });
      view.root.classList.add("plot--fill");
      view.set(f.fig);
      return {
        update() { f = get(); view.set(f.fig); },
        destroy() { view.destroy(); },
      };
    },
    table: () => figureTable(f),
    csv: () => toCSV(f.title, f.columns, f.bridge, f.prov),
    png: () => renderPng(f, wide, tall, 2, screenPngTheme()),
    figurePng: () => { const [w, h] = figurePrintSize(f.fig); return renderPng(f, w, h, 3, printTheme()); },
  }, onClosed);
}
