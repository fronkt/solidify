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
// LIVE (motion allowed, html.hero-live): #heroAct is pinned for FRAME_PX +
// HOLD_PX of scroll. The frame is round(frame progress x 179); chapter text is
// revealed line by line (SplitText, blur-in, scrubbed); a feature's callout is
// shown only inside its frame window and only while its anchor is visible.
// STILL (reduced motion, Save-Data, or the frames failing to load): the poster
// with all five callouts from manifest.poster.anchors and the chapter text
// stacked. A frame set is failed when its first frame or more than a tenth of
// it does not arrive; the other set is tried once before the still.
// No JS at all: the poster <img> in index.html, nothing else.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);

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
const BG = "#0a0b0d";
/** Must match the stacked-layout media query in index.html (the still layout's
 *  and the live one's are the same query). */
const STACKED = "(max-width: 759px), (orientation: portrait)";
/** What tells the page the visitor is moving: until one of these, only the
 *  skeleton of the frame set is fetched. */
const RELEASE = ["scroll", "wheel", "touchstart", "keydown", "pointerdown"] as const;

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
const COPY: Record<string, { title: string; line: string; side: "left" | "right"; mark: Mark }> = {
  tip: { title: "TIP", line: "A paraboloid, rounded by surface tension.", side: "left", mark: "dot" },
  primary: { title: "PRIMARY ARM ⟨100⟩", line: "Grows along a cube axis of the crystal.", side: "left", mark: "arrow" },
  lambda2: { title: "SECONDARY ARM SPACING λ₂", line: "Finer spacing usually means a stronger casting.", side: "right", mark: "bracket" },
  tertiary: { title: "TERTIARY ARM", line: "A branch on a branch.", side: "right", mark: "dot" },
  neck: { title: "NECKED ROOT", line: "Side arms thin here, and some melt off.", side: "right", mark: "dot" },
};

interface Rect { x: number; y: number; w: number; h: number }
type Pt = [number, number];

interface Callout {
  f: Feature;
  el: HTMLElement;
  g: SVGGElement;
  dots: SVGCircleElement[];
  shape: SVGPathElement;
  leader: SVGPolylineElement;
  alpha: number;
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
  callouts(): { id: string; alpha: number }[];
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

function makeCallouts(features: Feature[], host: (side: "left" | "right") => HTMLElement,
  marks: SVGSVGElement): Callout[] {
  const out: Callout[] = [];
  for (const f of features) {
    const c = COPY[f.id];
    if (!c) continue;   // a feature the page has no words for is not drawn
    const el = document.createElement("div");
    el.className = "callout";
    el.dataset.f = f.id;
    el.dataset.side = c.side;
    // read once, from #heroFeatures: a live callout is hidden outside its
    // window, which would leave a screen reader nothing most of the time
    el.setAttribute("aria-hidden", "true");
    const t = document.createElement("span");
    t.className = "coTitle";
    t.textContent = c.title;
    const l = document.createElement("span");
    l.className = "coLine";
    l.textContent = c.line;
    el.append(t, l);
    host(c.side).append(el);
    const g = svg("g", "mark");
    g.dataset.f = f.id;
    const leader = svg("polyline", "leader");
    const shape = svg("path", "shape");
    const dots = [svg("circle", "dot"), svg("circle", "dot")];
    for (const d of dots) d.setAttribute("r", "3.6");
    g.append(leader, shape, ...dots);
    marks.append(g);
    out.push({ f, el, g, dots, shape, leader, alpha: 0 });
  }
  return out;
}

/** The five feature explanations as one static, visually hidden list that the
 *  picture points at, so they can be read at any scroll position and on a
 *  phone, where the callouts show titles only. */
function describe(section: HTMLElement, features: Feature[]): void {
  document.getElementById("heroFeatures")?.remove();
  const ul = document.createElement("ul");
  ul.id = "heroFeatures";
  ul.className = "sr-only";
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
  // bracket: a dimension line offset from the two roots, toward the label side
  put(c.dots[0], a); put(c.dots[1], b);
  let nx = -uy, ny = ux;
  const want = COPY[c.f.id].side === "right" ? 1 : -1;
  if (Math.abs(nx) > 0.2 ? Math.sign(nx) !== want : ny > 0) { nx = -nx; ny = -ny; }
  const o = 11;
  const p = (q: Pt, k: number) => `${(q[0] + nx * k).toFixed(1)} ${(q[1] + ny * k).toFixed(1)}`;
  c.shape.setAttribute("d", `M${p(a, 4)}L${p(a, o + 4)}M${p(b, 4)}L${p(b, o + 4)}M${p(a, o)}L${p(b, o)}`);
  return [(a[0] + b[0]) / 2 + nx * o, (a[1] + b[1]) / 2 + ny * o];
}

function setLeader(c: Callout, from: Pt, elbow: Pt, to: Pt) {
  c.leader.setAttribute("points", [from, elbow, to].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
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
  if (!img || !stage || !marks) return;
  let m: HeroManifest;
  if (known) m = known;
  else {
    try { m = await loadManifest(); } catch { return; }   // the poster alone, as with no JS
  }
  h.manifest = m;
  const hosts = {
    left: section.querySelector<HTMLElement>(".heroLabels.left")!,
    right: section.querySelector<HTMLElement>(".heroLabels.right")!,
  };
  const cs = makeCallouts(m.features, s => hosts[s], marks);
  describe(section, m.features);
  h.callouts = () => cs.map(c => ({ id: c.f.id, alpha: c.alpha }));
  // the labels change the section's height (bands above and below the poster
  // when stacked), and any pin below was measured without them
  ScrollTrigger.refresh();
  const place = () => {
    const sr = stage.getBoundingClientRect();
    marks.setAttribute("width", String(sr.width));
    marks.setAttribute("height", String(sr.height));
    const ir = img.getBoundingClientRect();
    const R = contain({ x: ir.left - sr.left, y: ir.top - sr.top, w: ir.width, h: ir.height },
      img.naturalWidth || 1, img.naturalHeight || 1);
    const stacked = matchMedia(STACKED).matches;
    const at = new Map<string, Pt[]>();
    for (const c of cs) {
      const row = m.poster.anchors[c.f.id];
      at.set(c.f.id, row ? points(row).map(([x, y]) => [R.x + x * R.w, R.y + y * R.h] as Pt) : []);
    }
    // order each column (or band) by where its anchors sit, so leaders cross less
    for (const host of [hosts.left, hosts.right]) {
      const kids = cs.filter(c => c.el.parentElement === host);
      const key = (c: Callout) => { const p = at.get(c.f.id)![0]; return p ? (stacked ? p[0] : p[1]) : 0; };
      kids.sort((a, b) => key(a) - key(b)).forEach(c => host.append(c.el));
    }
    for (const c of cs) {
      const row = m.poster.anchors[c.f.id];
      const pts = at.get(c.f.id)!;
      const show = !!row && row[row.length - 1] === 1 && pts.length > 0;
      c.alpha = show ? 1 : 0;
      c.el.style.visibility = c.g.style.visibility = show ? "" : "hidden";
      if (!show) continue;
      const start = drawMark(c, pts);
      const lr = c.el.getBoundingClientRect();
      const L = { x: lr.left - sr.left, y: lr.top - sr.top, w: lr.width, h: lr.height };
      const left = COPY[c.f.id].side === "left";
      if (stacked) {
        // bands above (left-side features) and below (right-side ones) the poster
        const ex = L.x + L.w / 2, ey = left ? L.y + L.h + 6 : L.y - 6;
        setLeader(c, start, [ex, ey + (left ? 10 : -10)], [ex, ey]);
      } else {
        const ex = left ? L.x + L.w + 10 : L.x - 10, ey = L.y + 9;
        setLeader(c, start, [ex + (left ? 22 : -22), ey], [ex, ey]);
      }
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
  const ctx = canvas?.getContext("2d", { alpha: false });
  if (!canvas || !marks || !ctx) { void bootStill(section); return; }
  live(section, canvas, ctx, marks);
}

function live(section: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D,
  marks: SVGSVGElement): void {
  const root = document.documentElement;
  const h = hook({ mode: "live" });
  const hosts = {
    left: section.querySelector<HTMLElement>(".heroLabels.left")!,
    right: section.querySelector<HTMLElement>(".heroLabels.right")!,
  };

  const proxy = { p: 0 };
  let m: HeroManifest | null = null;
  let N = 180;
  let size = 0;
  let cs: Callout[] = [];
  let text: gsap.core.Timeline | null = null;
  let splits: SplitText[] = [];
  let srBodies: HTMLElement[] = [];
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
  let W = 1, H = 1, gut = 20, stacked = false;

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
  const paintBg = () => { ctx.fillStyle = BG; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  /** The tour's close-ups fill the square, so the frame's edge fade widens into
   *  a soft ellipse as the camera moves in (the first 5 frames after the tour
   *  starts) and narrows again as the hold cross-fades to the wide poster. */
  const frameEl = canvas.parentElement as HTMLElement | null;
  let edgeKey = "";
  const setEdge = (f: number, mix: number) => {
    const tourFrom = m?.chapters.find(c => c.id === "tour")?.from ?? Infinity;
    const c = Math.min(1, Math.max(0, (f - tourFrom - 1) / 5)) * (1 - mix);
    const k = c.toFixed(2);
    if (!frameEl || k === edgeKey) return;
    edgeKey = k;
    frameEl.style.setProperty("--edge", `${(6 + 12 * c).toFixed(1)}%`);
    frameEl.style.setProperty("--vin", `${(100 - 48 * c).toFixed(1)}%`);
  };
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
    setEdge(have, mix);
    placeCallouts();
  }

  // ------------------------------------------------------------ callouts
  const windowAlpha = (f: Feature) => {
    // eased on the smoothed position so a label glides in and out; the last
    // window runs to the final frame and hands its fade to the hold instead
    const fin = smooth((targetF - (f.from - 0.5)) / 1.5);
    const fout = f.to >= N - 1 ? 1 : 1 - smooth((targetF - (f.to - 1)) / 1.5);
    return fin * fout;
  };
  function placeCallouts() {
    if (!m || drawn < 0) return;
    for (const c of cs) {
      const row = m.anchors[c.f.id]?.[drawn];
      const inWindow = drawn >= c.f.from && drawn <= c.f.to;
      const a = row && inWindow && row[row.length - 1] === 1 ? windowAlpha(c.f) * (1 - hold) : 0;
      c.alpha = a;
      const vis = a > 0.001 ? "visible" : "hidden";
      c.el.style.opacity = c.g.style.opacity = a.toFixed(3);
      c.el.style.visibility = c.g.style.visibility = vis;
      if (vis === "hidden" || !row) continue;
      placeOne(c, row, a);
    }
  }
  function placeOne(c: Callout, row: Row, a: number) {
    const pts = points(row).map(([x, y]) => [rect.x + x * rect.w, rect.y + y * rect.h] as Pt);
    const start = drawMark(c, pts);
    const left = COPY[c.f.id].side === "left";
    const w = c.el.offsetWidth, hh = c.el.offsetHeight;
    const slide = stacked ? 0 : (1 - a) * 10 * (left ? -1 : 1);
    let lx: number, ly: number;
    if (!stacked) {
      // in the void beside the frame, never over it: the label's inner edge
      // stops GAP px short of the drawn rect
      const GAP = 20;
      ly = clamp(start[1] - 9, H * 0.18, H * 0.84 - hh);
      lx = left ? rect.x - GAP - w : rect.x + rect.w + GAP;
      const ex = left ? lx + w + 10 : lx - 10, ey = ly + 9;
      setLeader(c, start, [ex + (left ? 26 : -26), ey], [ex, ey]);
    } else {
      // stacked: in the band above or below the frame, whichever is nearer the
      // anchor, and under it, so the leader runs short and nearly vertical
      // instead of across the whole crystal
      const above = start[1] < rect.y + rect.h / 2;
      ly = above ? rect.y - 16 - hh : rect.y + rect.h + 16;
      lx = clamp(start[0] - w / 2, gut, W - gut - w);
      const ex = clamp(start[0], lx + 8, lx + w - 8), ey = above ? ly + hh + 6 : ly - 6;
      setLeader(c, start, [ex, ey + (above ? 10 : -10)], [ex, ey]);
    }
    c.el.style.transform = `translate(${(lx + slide).toFixed(1)}px, ${ly.toFixed(1)}px)`;
  }

  // ---------------------------------------------------------------- text
  function buildText() {
    if (!m) return;
    const t0 = text ? text.time() : 0;
    // revert, not kill: a killed timeline leaves its inline styles behind, and
    // the rebuilt one would record them as its starting state
    text?.revert();
    splits.forEach(s => s.revert());
    splits = [];
    // the chapter bodies, once, as plain text for screen readers: the split
    // lines below are aria-hidden, and hidden outright outside their chapter
    if (!srBodies.length) {
      for (const p of section.querySelectorAll<HTMLElement>(".chap .chapBody")) {
        const s = document.createElement("span");
        s.className = "sr-only";
        s.textContent = (p.textContent ?? "").replace(/\s+/g, " ").trim();
        p.before(s);
        srBodies.push(s);
      }
    }
    const tl = gsap.timeline({ paused: true });
    const at = (frame: number) => (frame / (N - 1)) * FRAME_PX;
    const ch = Object.fromEntries(m.chapters.map(c => [c.id, c]));
    const grow = ch.grow ?? { from: 12, to: 95 }, cool = ch.cool ?? { from: 96, to: 119 };

    // The opening (wordmark, tagline, CTAs) leaves as the nucleus appears. It
    // fades by OPACITY, so the page's only <h1> stays in the accessibility
    // tree; only the links go to visibility: hidden (unfocusable, not
    // hit-testable) once they are gone.
    tl.fromTo("#heroOpen", { opacity: 1, y: 0, filter: "blur(0px)" },
      { opacity: 0, y: -46, filter: "blur(10px)", duration: 260, ease: "power1.in" }, 30);
    tl.fromTo("#heroOpen .cta", { visibility: "inherit" }, { visibility: "hidden", duration: 1, ease: "none" }, 289);
    tl.fromTo("#scrollCue", { autoAlpha: 1 }, { autoAlpha: 0, duration: 120, ease: "none" }, 0);

    // Positions are in px of pin travel. The cool chapter is only 24 frames
    // (~430 px), so the reveals are quick (~190 px in, ~140 px out) and the grow
    // text is fully gone before the cool text arrives in the same place: the
    // cool block then reads in full from about frame 104 to frame 114.
    const chapter = (id: string, inAt: number, outAt: number | null) => {
      const box = section.querySelector<HTMLElement>(`.chap[data-chap="${id}"]`);
      if (!box) return;
      const head = box.querySelector<HTMLElement>(".chapHead");
      const body = box.querySelector<HTMLElement>(".chapBody");
      const cta = box.querySelector<HTMLElement>(".cta");
      const lines: Element[] = [];
      if (head) {
        // aria "auto": the heading keeps its name while its lines are hidden
        const s = new SplitText(head, { type: "lines", tag: "span", linesClass: "ln" });
        splits.push(s);
        lines.push(...s.lines);
        tl.fromTo(s.lines, { autoAlpha: 0, yPercent: 45, filter: "blur(16px)" },
          { autoAlpha: 1, yPercent: 0, filter: "blur(0px)", duration: 110, stagger: 30, ease: "power2.out" }, inAt);
      }
      if (body) {
        // aria "hidden", not "auto": a <p> cannot be named, and screen readers
        // would read nothing; the sr-only copy above carries the sentence
        const s = new SplitText(body, { type: "lines", tag: "span", linesClass: "ln", aria: "hidden" });
        splits.push(s);
        lines.push(...s.lines);
        tl.fromTo(s.lines, { autoAlpha: 0, y: 14, filter: "blur(8px)" },
          { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 100, stagger: 22, ease: "power2.out" }, inAt + 50);
      }
      if (cta) {
        tl.fromTo(cta, { autoAlpha: 0, y: 14, filter: "blur(6px)" },
          { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 110, ease: "power2.out" }, inAt + 130);
        lines.push(cta);
      }
      if (outAt !== null)
        tl.to(lines, { autoAlpha: 0, yPercent: -30, filter: "blur(10px)", duration: 90, stagger: 8, ease: "power1.in" }, outAt);
    };
    chapter("grow", at(grow.from) + 120, at(grow.to) - 230);
    chapter("cool", at(cool.from) - 40, at(cool.to) - 90);
    // Stacked, the end body lands in the band under the frame where the last
    // callout is still fading, so it waits for the hold's cross-fade to finish
    chapter("end", FRAME_PX + (matchMedia(STACKED).matches ? TO_POSTER_PX : 40), null);
    tl.set({}, {}, TOTAL_PX);   // the timeline spans the whole pin, in px
    text = tl;
    tl.time(t0 || proxy.p * TOTAL_PX);
    // every chapter now has its reveal state: index.html hides them until then
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
    W = sr.width; H = sr.height;
    gut = parseFloat(getComputedStyle(section).getPropertyValue("--gut")) || 20;
    stacked = matchMedia(STACKED).matches;
    rect = contain({ x: cr.left - sr.left, y: cr.top - sr.top, w: cr.width, h: cr.height }, 1, 1);
    marks.setAttribute("width", String(W));
    marks.setAttribute("height", String(H));
    // a label may only be as wide as the void it sits in
    for (const c of cs) {
      const room = stacked ? W - 2 * gut : (COPY[c.f.id].side === "left" ? rect.x : W - rect.x - rect.w) - gut - 20;
      c.el.style.maxWidth = `${Math.max(120, Math.floor(room))}px`;
    }
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
   *  its tween, the text timeline and its splits, the live callouts, the
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
    splits.forEach(s => s.revert());
    splits = [];
    for (const s of srBodies) s.remove();
    srBodies = [];
    for (const c of cs) { c.el.remove(); c.g.remove(); }
    cs = [];
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
    cs = makeCallouts(man.features, s => hosts[s], marks);
    describe(section, man.features);
    h.callouts = () => cs.map(c => ({ id: c.f.id, alpha: c.alpha }));
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
