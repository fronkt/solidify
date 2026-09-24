// The landing hero: ONE rendered metal dendrite that grows, cools and turns
// as the visitor scrolls.
//
// The frames are PRE-RENDERED (Blender, hero/dendrite_gen.py), not solved: the
// caption in #heroAct says so and links the recipe. They live in public/hero/
// under a fixed contract that scripts/verify-hero-manifest.mjs checks without a
// browser: 180 square, opaque WebP frames at 1200 and 600 px, a poster at each
// size, and manifest.json carrying the chapters, the five feature windows and,
// per frame, each feature's 2D anchor with an occlusion flag.
//
// This module never touches WebGPU. landing.ts boots it BEFORE the GPU gate, so
// the hero works on every browser, and its pin is created synchronously so it
// exists before the lens and materials pins (a pin created after a later one
// computes its start without the earlier spacer; verify-scroll-order.mjs).
//
// Layout (index.html, docs/DESIGN.md section 6): the render on the left, one
// copy column on the right. The opening, the grow / cool / end chapters and
// the tour's spec rail of the five features share that column.
//
// LIVE (motion allowed, html.hero-live): #heroAct is pinned for FRAME_PX +
// HOLD_PX of scroll. The frame is round(frame progress x 179); each chapter
// block fades and rises into the column (opacity and translate only, scrubbed)
// and leaves before the next arrives. During the tour the rail row of the
// feature in view is bright, the rest dim; its mark and a 1 px leader from the
// row to its anchor show only inside the feature's frame window and only while
// the anchor is visible. Stacked (phones, portrait), the rail sits under the
// frame and the mark carries the row's number instead of a leader.
// STILL (reduced motion, Save-Data, or the frames failing to load): the poster
// with all five numbered marks from manifest.poster.anchors beside the rail,
// and the chapters in a row below. A frame set is failed when its first frame
// or more than a tenth of it does not arrive; the other set is tried once
// before the still.
// No JS at all: the poster <img> in index.html, the opening and the chapters.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/** Scroll distance over which frames 0..N-1 play. */
export const FRAME_PX = 3200;
/** After the last frame the pin holds while the finished crystal and the last
 *  chapter land; without it the "grow your own" CTA would share the screen
 *  with the last feature's callout. */
export const HOLD_PX = 560;
const TOTAL_PX = FRAME_PX + HOLD_PX;
/** Inside the hold: frame N-1 cross-fades to the poster over this distance. */
const TO_POSTER_PX = 260;
const DIR = "hero/";
const MAX_FETCH = 6;
/** createImageBitmap calls in flight at once; the rest wait, and a frame the
 *  scrub has already left behind is never started. */
const MAX_DECODE = 3;
/** Must match the stacked-layout media query in index.html (the still layout's
 *  and the live one's are the same query). */
const STACKED = "(max-width: 759px), (orientation: portrait)";
/** What tells the page the visitor is moving: until one of these, only the
 *  skeleton of the frame set is fetched. */
const RELEASE = ["scroll", "wheel", "touchstart", "keydown", "pointerdown"] as const;

/** The page canvas color, the --bg token (src/design/tokens.css): the canvas
 *  paints it behind each frame, so the frame's masked edge fades into the
 *  page. Read when first painted, once the stylesheet has applied. */
let bgColor = "";
const pageBg = () => (bgColor ||= getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()) || "black";

type Row = number[];
interface Span { id: string; from: number; to: number }
interface Feature extends Span { kind: "point" | "pair" }
export interface HeroManifest {
  version: number;
  frames: number;
  pattern: string;
  sizes: number[];
  background: string;
  chapters: Span[];
  features: Feature[];
  anchors: Record<string, Row[]>;
  poster: { frame: number; anchors: Record<string, Row> };
  source: string;
}

type Mark = "dot" | "arrow" | "bracket";
const COPY: Record<string, { title: string; line: string; mark: Mark }> = {
  tip: { title: "TIP", line: "A paraboloid, rounded by surface tension.", mark: "dot" },
  primary: { title: "PRIMARY ARM ⟨100⟩", line: "Grows along a cube axis of the crystal.", mark: "arrow" },
  lambda2: { title: "SECONDARY ARM SPACING λ₂", line: "Finer spacing usually means a stronger casting.", mark: "bracket" },
  tertiary: { title: "TERTIARY ARM", line: "A branch on a branch.", mark: "dot" },
  neck: { title: "NECKED ROOT", line: "Side arms thin here, and some melt off.", mark: "dot" },
};

interface Rect { x: number; y: number; w: number; h: number }
type Pt = [number, number];

interface Callout {
  f: Feature;
  /** the feature's row in the rail */
  el: HTMLElement;
  g: SVGGElement;
  dots: SVGCircleElement[];
  shape: SVGPathElement;
  leader: SVGPolylineElement;
  num: SVGTextElement;
  /** the mark's opacity: inside the window, anchor visible, outside the hold */
  alpha: number;
  /** the row is the one in view (bright) */
  on: boolean;
}

interface HeroHook {
  mode: "live" | "still" | "failed";
  manifest: HeroManifest | null;
  size: number;
  frame: number;
  target: number;
  posterMix: number;
  /** the scrubbed (smoothed) pin progress the frame is read off */
  p: number;
  loaded: number;
  failed: string[];
  decoded: number;
  framePx: number;
  holdPx: number;
  st: ScrollTrigger | null;
  callouts(): { id: string; alpha: number; on: boolean }[];
}
declare global { interface Window { __hero?: HeroHook } }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/** "f{i:03d}.webp" -> "f007.webp" */
function frameName(pattern: string, i: number): string {
  return pattern.replace(/\{i(?::0(\d+)d)?\}/, (_, w?: string) => (w ? String(i).padStart(+w, "0") : String(i)));
}

/** The rect an image of natW x natH occupies inside a box, object-fit: contain. */
function contain(box: Rect, natW: number, natH: number): Rect {
  const s = Math.min(box.w / natW, box.h / natH);
  const w = natW * s, h = natH * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** row -> its points; the last entry of a row is the visible flag */
function points(row: Row): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k + 1 < row.length - 1; k += 2) out.push([row[k], row[k + 1]]);
  return out;
}

async function loadManifest(): Promise<HeroManifest> {
  const r = await fetch(`${DIR}manifest.json`);
  if (!r.ok) throw new Error(`hero manifest: HTTP ${r.status}`);
  const m = (await r.json()) as HeroManifest;
  if (!m || !Array.isArray(m.features) || !m.anchors || !(m.frames > 0) || typeof m.pattern !== "string"
    || !Array.isArray(m.sizes) || !m.sizes.length) throw new Error("hero manifest: malformed");
  return m;
}

// ------------------------------------------------------------------ callouts

const SVGNS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  e.setAttribute("class", cls);
  return e;
}

/** One rail row and one mark per feature the page has words for, numbered in
 *  manifest order. */
function makeCallouts(features: Feature[], rail: HTMLElement, marks: SVGSVGElement): Callout[] {
  const out: Callout[] = [];
  for (const f of features) {
    const c = COPY[f.id];
    if (!c) continue;   // a feature the page has no words for is not drawn
    const n = String(out.length + 1).padStart(2, "0");
    const el = document.createElement("li");
    el.className = "callout";
    el.dataset.f = f.id;
    // read once, from #heroFeatures: the rail is only on screen during the
    // tour, which would leave a screen reader nothing most of the time
    el.setAttribute("aria-hidden", "true");
    const i = document.createElement("span");
    i.className = "coIdx";
    i.textContent = n;
    const t = document.createElement("span");
    t.className = "coTitle";
    t.textContent = c.title;
    const l = document.createElement("span");
    l.className = "coLine";
    l.textContent = c.line;
    el.append(i, t, l);
    rail.append(el);
    const g = svg("g", "mark");
    g.dataset.f = f.id;
    const leader = svg("polyline", "leader");
    const shape = svg("path", "shape");
    const dots = [svg("circle", "dot"), svg("circle", "dot")];
    for (const d of dots) d.setAttribute("r", "3.6");
    const num = svg("text", "num");
    num.textContent = n;
    num.style.display = "none";
    g.append(leader, shape, ...dots, num);
    marks.append(g);
    out.push({ f, el, g, dots, shape, leader, num, alpha: 0, on: false });
  }
  return out;
}

/** The five feature explanations as one static list that the picture points
 *  at (aria-describedby), so they can be read at any scroll position and on a
 *  phone, where the rail shows titles only. HIDDEN, not visually hidden:
 *  aria-describedby still resolves hidden content, so the image keeps its
 *  description, and the reading order does not read the five items a second
 *  time as loose text. */
function describe(section: HTMLElement, features: Feature[]): void {
  document.getElementById("heroFeatures")?.remove();
  const ul = document.createElement("ul");
  ul.id = "heroFeatures";
  ul.hidden = true;
  for (const f of features) {
    const c = COPY[f.id];
    if (!c) continue;
    const li = document.createElement("li");
    li.textContent = `${c.title}: ${c.line}`;
    ul.append(li);
  }
  section.querySelector(".heroFrame")?.after(ul);
  for (const id of ["heroCanvas", "heroStill"]) document.getElementById(id)?.setAttribute("aria-describedby", "heroFeatures");
}

/** Draws the dot(s) and the arrow or bracket; returns where the leader starts. */
function drawMark(c: Callout, pts: Pt[]): Pt {
  const kind = COPY[c.f.id].mark;
  const [a, b] = pts;
  const put = (d: SVGCircleElement, p: Pt | null) => {
    d.style.display = p ? "" : "none";
    if (p) { d.setAttribute("cx", p[0].toFixed(1)); d.setAttribute("cy", p[1].toFixed(1)); }
  };
  if (kind === "dot" || !b) {
    put(c.dots[0], a); put(c.dots[1], null);
    c.shape.setAttribute("d", "");
    return a;
  }
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  if (kind === "arrow") {
    // root dot, shaft along the arm, head at the tip-side point
    put(c.dots[0], a); put(c.dots[1], null);
    const hx = b[0] - ux * 9, hy = b[1] - uy * 9;
    const nx = -uy * 4.5, ny = ux * 4.5;
    c.shape.setAttribute("d", `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`
      + `M${(hx + nx).toFixed(1)} ${(hy + ny).toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}L${(hx - nx).toFixed(1)} ${(hy - ny).toFixed(1)}`);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  // bracket: a dimension line offset from the two roots, toward the rail (right)
  put(c.dots[0], a); put(c.dots[1], b);
  let nx = -uy, ny = ux;
  if (Math.abs(nx) > 0.2 ? nx < 0 : ny > 0) { nx = -nx; ny = -ny; }
  const o = 11;
  const p = (q: Pt, k: number) => `${(q[0] + nx * k).toFixed(1)} ${(q[1] + ny * k).toFixed(1)}`;
  c.shape.setAttribute("d", `M${p(a, 4)}L${p(a, o + 4)}M${p(b, 4)}L${p(b, o + 4)}M${p(a, o)}L${p(b, o)}`);
  return [(a[0] + b[0]) / 2 + nx * o, (a[1] + b[1]) / 2 + ny * o];
}

/** The row's number beside the mark (the still and the stacked layouts, where
 *  no leader is drawn): up and right of the mark's root dot, or of the
 *  bracket's dimension line, which would otherwise run through it. */
function drawNum(c: Callout, pts: Pt[], start: Pt | null) {
  const at = start && COPY[c.f.id].mark === "bracket" ? start : pts[0];
  c.num.style.display = start && at ? "" : "none";
  if (!start || !at) return;
  c.num.setAttribute("x", (at[0] + 9).toFixed(1));
  c.num.setAttribute("y", (at[1] - 9).toFixed(1));
}

function setLeader(c: Callout, pts: Pt[] | null) {
  c.leader.setAttribute("points", pts ? pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") : "");
}

function setOn(c: Callout, on: boolean) {
  if (c.on === on) return;
  c.on = on;
  c.el.classList.toggle("is-on", on);
}

// --------------------------------------------------------------------- boot

export function bootHero(): void {
  const section = document.getElementById("heroAct");
  if (!section) return;
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // a visitor who asked for less data gets the poster, not 180 frames
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (!reduced && !saveData && root.classList.contains("hero-live")) bootLive(section);
  else void bootStill(section);
}

function hook(partial: Partial<HeroHook>): HeroHook {
  const h: HeroHook = {
    mode: "still", manifest: null, size: 0, frame: -1, target: 0, posterMix: 0, p: 0, loaded: 0,
    failed: [], decoded: 0, framePx: FRAME_PX, holdPx: HOLD_PX, st: null, callouts: () => [],
    ...partial,
  };
  window.__hero = h;
  return h;
}

// --------------------------------------------------------------- still mode

/** `known`: the manifest, when live mode already has it and is falling back
 *  because its frames failed. */
async function bootStill(section: HTMLElement, known?: HeroManifest, mode: "still" | "failed" = "still"): Promise<void> {
  document.documentElement.classList.remove("hero-live");
  const h = hook({ mode });
  const img = document.getElementById("heroStill") as HTMLImageElement | null;
  const stage = document.getElementById("heroStage");
  const marks = document.getElementById("heroMarks") as SVGSVGElement | null;
  const rail = section.querySelector<HTMLElement>(".heroRail");
  if (!img || !stage || !marks || !rail) return;
  let m: HeroManifest;
  if (known) m = known;
  else {
    try { m = await loadManifest(); } catch { return; }   // the poster alone, as with no JS
  }
  h.manifest = m;
  const cs = makeCallouts(m.features, rail, marks);
  describe(section, m.features);
  h.callouts = () => cs.map(c => ({ id: c.f.id, alpha: c.alpha, on: c.on }));
  // the rail changes the section's height, and any pin below was measured
  // without it
  ScrollTrigger.refresh();
  const place = () => {
    const sr = stage.getBoundingClientRect();
    marks.setAttribute("width", String(sr.width));
    marks.setAttribute("height", String(sr.height));
    const ir = img.getBoundingClientRect();
    const R = contain({ x: ir.left - sr.left, y: ir.top - sr.top, w: ir.width, h: ir.height },
      img.naturalWidth || 1, img.naturalHeight || 1);
    // every feature at once: all five rows bright, each mark numbered like
    // its row (five leaders across the poster would cross each other)
    for (const c of cs) {
      const row = m.poster.anchors[c.f.id];
      const pts = row ? points(row).map(([x, y]) => [R.x + x * R.w, R.y + y * R.h] as Pt) : [];
      const show = !!row && row[row.length - 1] === 1 && pts.length > 0;
      c.alpha = show ? 1 : 0;
      setOn(c, show);
      c.el.style.visibility = c.g.style.visibility = show ? "" : "hidden";
      setLeader(c, null);
      if (!show) { drawNum(c, pts, null); continue; }
      drawNum(c, pts, drawMark(c, pts));
    }
  };
  const run = () => requestAnimationFrame(place);
  if (img.complete && img.naturalWidth) run(); else img.addEventListener("load", run, { once: true });
  new ResizeObserver(run).observe(stage);
}

// ---------------------------------------------------------------- live mode

function bootLive(section: HTMLElement): void {
  const canvas = document.getElementById("heroCanvas") as HTMLCanvasElement | null;
  const marks = document.getElementById("heroMarks") as SVGSVGElement | null;
  const rail = section.querySelector<HTMLElement>(".heroRail");
  const ctx = canvas?.getContext("2d", { alpha: false });
  if (!canvas || !marks || !rail || !ctx) { void bootStill(section); return; }
  live(section, canvas, ctx, marks, rail);
}

function live(section: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D,
  marks: SVGSVGElement, rail: HTMLElement): void {
  const root = document.documentElement;
  const h = hook({ mode: "live" });

  const proxy = { p: 0 };
  let m: HeroManifest | null = null;
  let N = 180;
  let size = 0;
  let cs: Callout[] = [];
  let text: gsap.core.Timeline | null = null;
  let targetF = 0;          // smoothed frame position, float
  let target = 0;           // round(targetF)
  let dir = 1;              // which way the scrub last moved: its neighbors decode first
  let hold = 0;             // 0..1 across the hold's cross-fade
  let drawn = -1;
  let drawnKey = "";
  let blank = true;         // the backing store holds only the background
  let onScreen = true;
  let dead = false;         // fell back to the still: every callback below is a no-op
  let rect: Rect = { x: 0, y: 0, w: 1, h: 1 };   // drawn frame rect, section px
  let stacked = false;

  // ----------------------------------------------------------- frame store
  // One frame SET (a size) at a time. `gen` names it: a fetch or a decode
  // begun for an earlier set is dropped when it lands.
  let gen = 0;
  let ac = new AbortController();
  let blobs: (Blob | null)[] = [];
  const bitmaps = new Map<number, ImageBitmap>();
  const decoding = new Set<number>();
  let poster: ImageBitmap | null = null;
  let maxDecoded = 16;
  let win = 6;
  let fallback = -1;        // the nearest fetched frame while the target is not fetched
  const broken = new Set<number>();
  let setFails = 0;

  /** the smallest working set at least as wide as the canvas in device px,
   *  else the largest: a 600 set drawn 835 px wide is visibly soft */
  const pick = (dev: number): number | undefined => {
    const ok = m!.sizes.filter(s => !broken.has(s)).sort((a, b) => a - b);
    return ok.find(s => s >= Math.floor(dev)) ?? ok[ok.length - 1];
  };
  const devPx = () => canvas.getBoundingClientRect().width * devicePixelRatio;

  const nearest = (t: number, has: (i: number) => boolean): number => {
    for (let d = 0; d < N; d++) {
      if (t - d >= 0 && has(t - d)) return t - d;
      if (t + d < N && has(t + d)) return t + d;
    }
    return -1;
  };
  const evict = () => {
    while (bitmaps.size > maxDecoded) {
      let far = -1, fd = -1;
      for (const k of bitmaps.keys()) {
        if (k === drawn) continue;
        const d = Math.abs(k - target);
        if (d > fd) { fd = d; far = k; }
      }
      if (far < 0) break;
      bitmaps.get(far)!.close();
      bitmaps.delete(far);
    }
    h.decoded = bitmaps.size;
  };
  /** worth holding decoded: inside the window around the target, or the
   *  stand-in for a target that has not arrived */
  const keep = (i: number) => Math.abs(i - target) <= win || i === fallback;
  const startDecode = (i: number) => {
    const g = gen;
    decoding.add(i);
    createImageBitmap(blobs[i]!).then(bmp => {
      if (dead || g !== gen) { bmp.close(); return; }
      decoding.delete(i);
      // the scrub has moved on: close it now rather than insert and evict
      if (!keep(i) || !onScreen) bmp.close();
      else { bitmaps.set(i, bmp); evict(); requestDraw(); }
      pumpDecode();
    }, err => {
      if (dead || g !== gen) return;
      decoding.delete(i);
      blobs[i] = null;
      frameFailed(i, err);
      pumpDecode();
    });
  };
  /** Starts decodes, at most MAX_DECODE in flight: the target first (or the
   *  nearest fetched frame while it is missing), then its neighbors by
   *  distance, the ones ahead in the scroll direction before the ones behind.
   *  Nothing is queued, so nothing stale waits in front of the target. */
  const pumpDecode = () => {
    if (dead || !m || !onScreen) return;
    fallback = blobs[target] ? -1 : nearest(target, i => !!blobs[i]);
    const want = fallback >= 0 ? [fallback, target] : [target];
    for (let d = 1; d <= win; d++) want.push(target + d * dir, target - d * dir);
    for (const i of want) {
      if (decoding.size >= MAX_DECODE) return;
      if (i >= 0 && i < N && blobs[i] && !bitmaps.has(i) && !decoding.has(i)) startDecode(i);
    }
  };

  /** frame 0, the poster and every 8th frame first (the skeleton the scrub can
   *  always find something near in), then every 4th, 2nd and the rest */
  const loadOrder = (n: number): { order: number[]; skeleton: number } => {
    const seen = new Set<number>();
    const out: number[] = [];
    const push = (i: number) => { if (i >= -1 && i < n && !seen.has(i)) { seen.add(i); out.push(i); } };
    push(0);
    push(-1);   // the poster
    for (let i = 0; i < n; i += 8) push(i);
    push(n - 1);
    const skeleton = out.length;
    for (const step of [4, 2, 1]) for (let i = 0; i < n; i += step) push(i);
    return { order: out, skeleton };
  };
  let order: number[] = [];
  let skeleton = 0;
  let next = 0, active = 0;
  let released = false;     // the rest of the set waits for the visitor to move
  const url = (i: number, s: number) => (i < 0 ? `${DIR}poster-${s}.webp` : `${DIR}${s}/${frameName(m!.pattern, i)}`);
  const one = async (i: number, g: number, s: number, signal: AbortSignal) => {
    const u = url(i, s);
    const r = await fetch(u, { signal });
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    const b = await r.blob();
    if (dead || g !== gen) return;
    if (i < 0) {
      const p = await createImageBitmap(b);
      if (dead || g !== gen) { p.close(); return; }
      poster = p;
      requestDraw();
      return;
    }
    blobs[i] = b;
    h.loaded++;
    pumpDecode();
    if (drawn < 0) requestDraw();
  };
  const pump = () => {
    const end = released ? order.length : skeleton;
    while (!dead && active < MAX_FETCH && next < end) {
      const i = order[next++];
      const g = gen, s = size, signal = ac.signal;
      active++;
      one(i, g, s, signal).catch(err => { if (!dead && g === gen) frameFailed(i, err); })
        .finally(() => { if (g === gen) { active--; pump(); } });
    }
  };
  /** A frame (not the poster) that did not arrive. The set is BROKEN when its
   *  first frame is missing or more than a tenth of it is: then the other set,
   *  once, and with none left the still. A missing poster only costs the hold
   *  its cross-fade. */
  const frameFailed = (i: number, err: unknown) => {
    h.failed.push(String(err));
    if (i < 0) return;
    setFails++;
    if (i !== 0 && setFails <= N / 10) return;
    broken.add(size);
    const s = pick(devPx());
    if (s === undefined) fail(err); else useSize(s);
  };
  const useSize = (s: number) => {
    gen++;
    ac.abort();
    ac = new AbortController();
    size = s;
    h.size = s;
    // ~96 MB of decoded frames at most: 16 at 1200 px, 64 at 600 px
    maxDecoded = s >= 1200 ? 16 : 64;
    win = s >= 1200 ? 6 : 12;
    for (const b of bitmaps.values()) b.close();
    bitmaps.clear();
    decoding.clear();
    poster?.close();
    poster = null;
    blobs = new Array<Blob | null>(N).fill(null);
    h.loaded = 0;
    h.decoded = 0;
    h.frame = -1;
    setFails = 0;
    drawn = -1;       // the canvas keeps the old set's picture until the new one draws
    drawnKey = "";
    ({ order, skeleton } = loadOrder(N));
    next = 0;
    active = 0;
    pump();
  };
  const release = () => {
    if (released) return;
    released = true;
    for (const t of RELEASE) removeEventListener(t, release);
    pump();
  };

  // ------------------------------------------------------------- drawing
  let rafPending = false;
  const requestDraw = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(drawNow);
  };
  const paintBg = () => { ctx.fillStyle = pageBg(); ctx.fillRect(0, 0, canvas.width, canvas.height); };
  function drawNow() {
    rafPending = false;
    if (dead || !m || !onScreen) return;
    pumpDecode();
    const have = bitmaps.has(target) ? target : nearest(target, i => bitmaps.has(i));
    const box = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    if (have < 0) {
      // nothing decoded, and frames have gone missing: the finished crystal
      // rather than an empty square (not at a normal start, where frame 0 is
      // on its way and the poster would flash up ahead of the seed)
      if (poster && blank && setFails > 0) {
        const q = contain(box, poster.width, poster.height);
        paintBg();
        ctx.drawImage(poster, q.x, q.y, q.w, q.h);
        blank = false;
      }
      return;
    }
    const mix = poster ? hold : 0;
    const key = `${have}|${mix.toFixed(3)}|${canvas.width}x${canvas.height}`;
    if (key === drawnKey) return;
    const bmp = bitmaps.get(have)!;
    paintBg();
    const r = contain(box, bmp.width, bmp.height);
    ctx.drawImage(bmp, r.x, r.y, r.w, r.h);
    if (mix > 0 && poster) {
      const q = contain(box, poster.width, poster.height);
      ctx.globalAlpha = mix;
      ctx.drawImage(poster, q.x, q.y, q.w, q.h);
      ctx.globalAlpha = 1;
    }
    drawnKey = key;
    blank = false;
    drawn = have;
    h.frame = have;
    h.posterMix = mix;
    placeCallouts();
  }

  // ------------------------------------------------------------ callouts
  const note = section.querySelector<HTMLElement>(".railNote");
  const windowAlpha = (f: Feature) => {
    // eased on the smoothed position so a mark glides in and out; the last
    // window runs to the final frame and hands its fade to the hold instead
    const fin = smooth((targetF - (f.from - 0.5)) / 1.5);
    const fout = f.to >= N - 1 ? 1 : 1 - smooth((targetF - (f.to - 1)) / 1.5);
    return fin * fout;
  };
  function placeCallouts() {
    if (!m || drawn < 0) return;
    const sr = section.getBoundingClientRect();
    let lit: Callout | null = null;
    for (const c of cs) {
      const row = m.anchors[c.f.id]?.[drawn];
      const inWindow = drawn >= c.f.from && drawn <= c.f.to;
      // the row stays lit through its whole window, the rail's place in the
      // tour; the mark and the leader go wherever the anchor is hidden
      setOn(c, inWindow && hold < 0.5);
      if (c.on) lit = c;
      const a = row && inWindow && row[row.length - 1] === 1 ? windowAlpha(c.f) * (1 - hold) : 0;
      c.alpha = a;
      const vis = a > 0.001 ? "visible" : "hidden";
      c.g.style.opacity = a.toFixed(3);
      c.g.style.visibility = vis;
      if (vis === "hidden" || !row) continue;
      placeOne(c, row, sr);
    }
    // a phone's rail shows titles only: the lit row's line goes under it
    // (index.html hides this slot wherever the rows carry their own lines)
    const line = lit ? COPY[lit.f.id].line : "";
    if (note && note.textContent !== line) note.textContent = line;
  }
  function placeOne(c: Callout, row: Row, sr: DOMRect) {
    const pts = points(row).map(([x, y]) => [rect.x + x * rect.w, rect.y + y * rect.h] as Pt);
    const start = drawMark(c, pts);
    if (stacked) {
      // under the frame the rail is a list, not a column beside it: the mark
      // carries the row's number instead of a leader across the crystal
      setLeader(c, null);
      drawNum(c, pts, start);
      return;
    }
    drawNum(c, pts, null);
    // a 1 px leader from the mark to the row's left edge, level with its title
    const t = (c.el.querySelector(".coTitle") ?? c.el).getBoundingClientRect();
    const x = c.el.getBoundingClientRect().left - sr.left - 14;
    const y = t.top - sr.top + t.height / 2;
    setLeader(c, [start, [x - 26, y], [x, y]]);
  }

  // ---------------------------------------------------------------- text
  /** Each block of the copy column rises into place and leaves the same way:
   *  opacity and a short translate, scrubbed by the pin. The kicker, heading
   *  and body stay in the accessibility tree at opacity 0; a CTA goes to
   *  visibility: hidden too, so it cannot be focused or hit while gone. */
  function buildText() {
    if (!m) return;
    const t0 = text ? text.time() : 0;
    // revert, not kill: a killed timeline leaves its inline styles behind, and
    // the rebuilt one would record them as its starting state
    text?.revert();
    const tl = gsap.timeline({ paused: true });
    const at = (frame: number) => (frame / (N - 1)) * FRAME_PX;
    const ch = Object.fromEntries(m.chapters.map(c => [c.id, c]));
    const grow = ch.grow ?? { from: 12, to: 95 }, cool = ch.cool ?? { from: 96, to: 119 };
    const tour = ch.tour ?? { from: 120, to: 179 };

    // The opening leaves as the nucleus appears. It fades by OPACITY, so the
    // page's only <h1> stays in the accessibility tree; only the links go to
    // visibility: hidden (unfocusable, not hit-testable) once they are gone.
    tl.fromTo("#heroOpen", { opacity: 1, y: 0 }, { opacity: 0, y: -24, duration: 200, ease: "power1.in" }, 30);
    tl.fromTo("#heroOpen .cta", { visibility: "inherit" }, { visibility: "hidden", duration: 1, ease: "none" }, 229);
    tl.fromTo("#scrollCue", { autoAlpha: 1 }, { autoAlpha: 0, duration: 120, ease: "none" }, 0);

    // Positions are in px of pin travel. The cool chapter is only 24 frames
    // (~430 px), so the reveals are quick (~140 px in, ~100 px out) and the
    // grow text is fully gone before the cool text arrives in the same place.
    const block = (box: HTMLElement | null, inAt: number, outAt: number | null) => {
      if (!box) return;
      const words = [...box.querySelectorAll<HTMLElement>(".kicker, .chapHead, .chapBody")];
      const cta = box.querySelector<HTMLElement>(".cta");
      if (words.length) {
        tl.fromTo(words, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 100, stagger: 14, ease: "power2.out" }, inAt);
        if (outAt !== null) tl.to(words, { opacity: 0, y: -12, duration: 80, stagger: 6, ease: "power1.in" }, outAt);
      }
      if (cta) {
        tl.fromTo(cta, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 100, ease: "power2.out" }, inAt + 14 * words.length);
        if (outAt !== null) tl.to(cta, { autoAlpha: 0, y: -12, duration: 80, ease: "power1.in" }, outAt + 6 * words.length);
      }
    };
    const chapter = (id: string, inAt: number, outAt: number | null) =>
      block(section.querySelector<HTMLElement>(`.chap[data-chap="${id}"]`), inAt, outAt);
    chapter("grow", at(grow.from) + 120, at(grow.to) - 230);
    chapter("cool", at(cool.from) - 40, at(cool.to) - 90);
    // the rail arrives with the tour and leaves as the hold begins; the end
    // chapter waits for it, since they share the column
    const tourBox = section.querySelector<HTMLElement>(".heroTour");
    if (tourBox) {
      tl.fromTo(tourBox, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 100, ease: "power2.out" }, at(tour.from) - 20);
      tl.to(tourBox, { autoAlpha: 0, y: -12, duration: 80, ease: "power1.in" }, FRAME_PX + 10);
    }
    chapter("end", FRAME_PX + 120, null);
    tl.set({}, {}, TOTAL_PX);   // the timeline spans the whole pin, in px
    text = tl;
    tl.time(t0 || proxy.p * TOTAL_PX);
    // every block now has its reveal state: index.html hides them until then
    section.classList.add("hero-ready");
  }

  // -------------------------------------------------------------- render
  function render() {
    const px = proxy.p * TOTAL_PX;
    targetF = clamp(px / FRAME_PX, 0, 1) * (N - 1);
    const t = Math.round(targetF);
    if (t !== target) dir = t > target ? 1 : -1;
    target = t;
    hold = smooth((px - FRAME_PX) / TO_POSTER_PX);
    h.target = target;
    h.p = proxy.p;
    text?.time(px);
    requestDraw();
    placeCallouts();
  }

  // -------------------------------------------------------------- layout
  function measure() {
    const sr = section.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    stacked = matchMedia(STACKED).matches;
    rect = contain({ x: cr.left - sr.left, y: cr.top - sr.top, w: cr.width, h: cr.height }, 1, 1);
    marks.setAttribute("width", String(sr.width));
    marks.setAttribute("height", String(sr.height));
    placeCallouts();
  }

  /** the backing store to w x h device px, then everything that depends on it */
  let css = { w: 0, h: 0 };
  const fit = (w: number, hgt: number) => {
    if (dead) return;
    if (w > 0 && hgt > 0 && (canvas.width !== w || canvas.height !== hgt)) {
      canvas.width = w;
      canvas.height = hgt;
      ctx.imageSmoothingQuality = "high";
      paintBg();
      blank = true;
      drawnKey = "";
    }
    measure();
    // a canvas that has outgrown its set (a narrow window maximized, a zoom, a
    // move to a denser screen) trades up; never down, so a drag cannot thrash
    if (m) { const s = pick(canvas.width); if (s !== undefined && s > size) useSize(s); }
    // synchronously: resizing cleared the backing store, and this callback
    // runs after the frame's rAF callbacks, so a requested draw would leave
    // this frame blank
    drawNow();
  };
  const ro = new ResizeObserver(entries => {
    const e = entries[0];
    const dp = e.devicePixelContentBoxSize?.[0];
    css = { w: e.contentRect.width, h: e.contentRect.height };
    fit(dp ? dp.inlineSize : Math.round(css.w * devicePixelRatio), dp ? dp.blockSize : Math.round(css.h * devicePixelRatio));
  });
  let dpBox = true;
  try { ro.observe(canvas, { box: "device-pixel-content-box" }); } catch { ro.observe(canvas); dpBox = false; }
  // Without device-pixel-content-box (Safari) a change of devicePixelRatio
  // alone, say the window moved to another screen, resizes nothing the
  // observer sees: a resolution query re-armed at each ratio catches it.
  let dprMq: MediaQueryList | null = null;
  const onDpr = () => {
    watchDpr();
    if (css.w > 0) fit(Math.round(css.w * devicePixelRatio), Math.round(css.h * devicePixelRatio));
  };
  const watchDpr = () => {
    dprMq?.removeEventListener("change", onDpr);
    dprMq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprMq.addEventListener("change", onDpr);
  };
  if (!dpBox) watchDpr();
  const io = new IntersectionObserver(es => {
    // the LAST entry: an enter and a leave can arrive in one batch
    onScreen = es[es.length - 1].isIntersecting;
    if (onScreen) { requestDraw(); return; }
    // scrolled past: the acts below want the memory. The canvas keeps its
    // pixels, and pumpDecode refills the window when the hero comes back.
    for (const [k, b] of bitmaps) if (k !== drawn) { b.close(); bitmaps.delete(k); }
    h.decoded = bitmaps.size;
  });
  io.observe(section);
  ScrollTrigger.addEventListener("refresh", measure);
  let lastW = innerWidth;
  let rebuild = 0;
  const onResize = () => {
    clearTimeout(rebuild);
    rebuild = window.setTimeout(() => {
      if (dead || innerWidth === lastW) return;   // a phone's URL bar, not a new line length
      lastW = innerWidth;
      buildText();
      measure();
    }, 160);
  };
  addEventListener("resize", onResize);

  // THE PIN, created here and synchronously (every piece of state render()
  // touches is declared above, since the pin renders once as it is created):
  // nothing about its geometry waits on the manifest, and it has to exist
  // before landing.ts creates the lens and materials pins below it. scrub
  // smooths a wheel notch (~6 frames) into a glide; the frame index is read off
  // the smoothed progress.
  const tween = gsap.to(proxy, {
    p: 1,
    ease: "none",
    onUpdate: () => render(),
    scrollTrigger: {
      id: "heroAct",
      trigger: section,
      start: "top top",
      end: `+=${TOTAL_PX}`,
      pin: true,
      scrub: 0.5,
      anticipatePin: 1,
    },
  });
  const st = tween.scrollTrigger!;
  h.st = st;

  /** The still, with everything live mode made taken down first: the pin and
   *  its tween, the text timeline, the live rail rows and marks, the
   *  observers and listeners, the fetches and the decoded frames. Runs once. */
  const fail = (err: unknown) => {
    if (dead) return;
    dead = true;
    console.warn("[solidify] hero frames unavailable, showing the still:", err);
    ac.abort();
    st.kill(true);
    tween.kill();
    text?.revert();
    text = null;
    for (const c of cs) { c.el.remove(); c.g.remove(); }
    cs = [];
    if (note) note.textContent = "";
    ro.disconnect();
    io.disconnect();
    dprMq?.removeEventListener("change", onDpr);
    removeEventListener("resize", onResize);
    clearTimeout(rebuild);
    for (const t of RELEASE) removeEventListener(t, release);
    ScrollTrigger.removeEventListener("refresh", measure);
    for (const b of bitmaps.values()) b.close();
    bitmaps.clear();
    poster?.close();
    poster = null;
    blobs = [];
    section.classList.remove("hero-ready");
    root.classList.remove("hero-live");
    h.mode = "failed";
    h.st = null;
    ScrollTrigger.refresh();
    void bootStill(section, m ?? undefined, "failed");
    // bootStill replaced the hook synchronously; keep the reason on it
    if (window.__hero && window.__hero !== h) window.__hero.failed = h.failed;
  };

  const setup = (man: HeroManifest) => {
    if (dead) return;
    m = man;
    h.manifest = man;
    N = man.frames;
    cs = makeCallouts(man.features, rail, marks);
    describe(section, man.features);
    h.callouts = () => cs.map(c => ({ id: c.f.id, alpha: c.alpha, on: c.on }));
    buildText();
    measure();
    useSize(pick(devPx())!);
    // the skeleton loads now; the rest once the visitor moves, so a visit
    // that never scrolls costs an eighth of the set
    if (scrollY > 0) release();
    else for (const t of RELEASE) addEventListener(t, release, { passive: true });
    render();
  };
  // only the manifest's own failure goes to the still here: an exception in
  // setup is a bug, and surfaces as one
  loadManifest().then(setup, fail);
}
