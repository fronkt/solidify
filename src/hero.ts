// The landing hero: ONE rendered metal dendrite that grows, cools and turns
// as the visitor scrolls.
//
// The frames are PRE-RENDERED (Blender, hero/dendrite_gen.py), not solved: the
// caption in #heroAct says so and links the recipe. Two files are the contract:
// - hero/timeline.json, imported here at build time: N frames, px of scroll per
//   frame, the hold, the six chapters and the five feature windows. The pin's
//   length and every text cue come from it, so the page lays itself out before
//   anything is fetched.
// - public/hero/manifest.json (manifest version 3, docs/HERO-DELIVERY.md): the
//   content-hashed directory of AVIF frame sets (1200, 900, 720), each packed
//   into a sparse first-pass segment and 32-frame segments with a byte index,
//   the per-frame anchors of the five features, and the per-step blend flags.
//   A manifest encoded for another timeline (its sha1 or N differ from the
//   import) is refused: the page shows the still.
//
// This module never touches WebGPU. landing.ts boots it BEFORE the GPU gate, so
// the hero works on every browser, and its pin is created synchronously so it
// exists before the lens and materials pins (a pin created after a later one
// computes its start without the earlier spacer; verify-scroll-order.mjs).
//
// Layout (index.html, docs/DESIGN.md section 6): the render on the left, one
// copy column on the right. The opening, the chapters and the tour's numbered
// spec rail of the five features share that column.
//
// LIVE (motion allowed, html.hero-live): #heroAct is pinned for FRAME_PX +
// HOLD_PX of scroll, FRAME_PX = (N - 1) x px per frame. The scroll position is
// the TARGET of a critically damped spring (a = w^2 (X - x) - 2 w v, w = 15/s,
// stepped exactly per animation frame, dt clamped to 1/30 s, no speed cap);
// the frame, the chapter text, the callouts, the rail and the skip link all
// read the spring's position. Between frames i and i+1 the picture is frame i
// with i+1 drawn over it at the fraction, but only on steps the manifest marks
// blendable (slow, crystal-masked flow); elsewhere it cuts to the nearer frame.
// At rest the fraction eases to 0 or 1 in 150 ms, so a still picture is always
// a real render. The last frame is the poster: the hold rests on it.
// Frames: the set is picked by the canvas's CSS width x min(DPR, 2) (the
// smallest set at least 0.9 of that, else 1200; up once a resize, zoom or
// screen change has settled, never down); the first-pass segment loads
// first, the rest after the visitor moves, nearest the playhead first in the
// direction of travel, each read as a stream so a frame is decodable as soon
// as its bytes are in; a fetch that fails for a reason that can pass is tried
// again after 1, 2 and 4 s; nothing new is fetched or decoded while the
// picture is off screen, and the decoded frames are let go; decoding runs ahead of the
// playhead by clamp(|v| x 0.25 s, 3, 20) frames and 3 behind, 4 at a time;
// at speed, along the spring's predicted path from where the playhead will be
// when a decode lands, one frame per display frame (every stride-th frame);
// into a cache of at most 48 bitmaps (the farthest closed first). A frame not yet decoded is drawn as the nearest one
// that is, so the canvas is never blank once anything has arrived.
// STILL (reduced motion, Save-Data, no AVIF decode, a manifest for another
// timeline, the frames failing to load, or a screen under 560 px tall, also
// one that becomes so after load): the poster with all five numbered marks
// from manifest.poster.anchors beside the rail, and the chapters in rows
// below. A set is failed when its first pass, or more than a tenth of its
// frames, does not arrive after the retries; the other sets are tried before
// the still.
// No JS at all: the poster <picture> in index.html, the opening and the
// chapters.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import TIMELINE from "../hero/timeline.json";
import TIMELINE_TEXT from "../hero/timeline.json?raw";

gsap.registerPlugin(ScrollTrigger);

/** Frames in the sequence (hero/timeline.json). */
const N: number = TIMELINE.frames;
/** Scroll px per frame (hero/timeline.json). */
const PX_PER_FRAME: number = TIMELINE.px_per_frame;
/** Scroll distance over which frames 0..N-1 play. */
export const FRAME_PX = (N - 1) * PX_PER_FRAME;
/** After the last frame (the poster) the pin holds while the last chapter
 *  lands; without it the "grow your own" CTA would arrive with the pin gone. */
export const HOLD_PX: number = TIMELINE.hold_px;
const TOTAL_PX = FRAME_PX + HOLD_PX;
const DIR = "hero/";
/** The spring: rate (1/s), the longest step it takes (s), and where it
 *  counts as settled (px of scroll, px/s). */
const W = 15;
const DT_MAX = 1 / 30;
const SETTLE_PX = 0.2;
const SETTLE_V = 2;
/** At rest between the two frames of a blend step, the fraction eases to the
 *  nearer real render over this long (ms). */
const EASE_MS = 150;
/** Segment fetches and createImageBitmap calls in flight at once. */
const MAX_FETCH = 3;
const MAX_DECODE = 4;
/** A segment fetch that fails for a reason that can pass (the network, a
 *  5xx, 408, 429) is tried again after each of these waits (ms) before it
 *  counts as failed; a failed segment is tried again when the playhead is
 *  inside it, at most once per REQUEUE_MS. */
const RETRY_MS = [1000, 2000, 4000];
const REQUEUE_MS = 10000;
/** A trade up to a larger set waits until the layout has settled this long
 *  (ms) after the last resize, zoom or screen change. */
const SETTLE_MS = 300;
/** Decode-ahead: seconds of travel ahead, clamped to [min, max] frames, and
 *  frames kept behind. */
const AHEAD_S = 0.25;
const AHEAD_MIN = 3;
const AHEAD_MAX = 20;
const BEHIND = 3;
/** Decoded bitmaps held at once: 48 x 1200^2 x 4 B = 276 MB at 1200, 155 MB
 *  at 900, 100 MB at 720. */
const MAX_BITMAPS = 48;
/** The set pick: need = CSS width x min(DPR, DPR_CAP); the smallest set at
 *  least SET_SLACK x need (docs/HERO-DELIVERY.md). */
const DPR_CAP = 2;
const SET_SLACK = 0.9;
/** The skip link shows once the pin is this far along (px), until the end
 *  chapter arrives (END_AT_PX), where the pin is nearly over and the end
 *  chapter's own link leads on. */
const SKIP_AT_PX = 1000;
const END_AT_PX = FRAME_PX + 40;
/** Must match the stacked-layout media query in index.html (the still layout's
 *  and the live one's are the same query). */
const STACKED = "(max-width: 759px), (orientation: portrait)";
/** index.html's head gate: a screen this short gets the still, and so does a
 *  live page whose screen becomes this short (a phone turned sideways). */
const SHORT = "(max-height: 560px)";
/** What tells the page the visitor is moving: until one of these, only the
 *  first-pass segment of the frame set is fetched. */
const RELEASE = ["scroll", "wheel", "touchstart", "keydown", "pointerdown"] as const;
/** A 1 x 1 AVIF (308 B, Pillow 12 / libavif 1.4.1): decoded once before any
 *  frame is fetched. Without an AVIF decoder the page shows the still. */
const AVIF_1PX = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAIQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAKW1kYXQSAAoIGAAGiAhoNCAyExlHh4Yhh5555oJIAJBAyRxhQo4=";

/** The page canvas color, the --bg token (src/design/tokens.css): the canvas
 *  paints it behind each frame, the frames' own background. Read when first
 *  painted, once the stylesheet has applied. */
let bgColor = "";
const pageBg = () => (bgColor ||= getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()) || "black";

type Row = number[];
interface Span { id: string; from: number; to: number }
interface Feature extends Span { kind: "point" | "pair"; hold?: number[]; label?: string }
interface Slices { file: string; bytes?: number; frames: number[]; index: [number, number][] }
interface FrameSet {
  width: number;
  format: string;
  type: string;
  quality: number;
  bytes: number;
  segment_frames: number;
  first: Slices & { every: number };
  segments: Slices[];
}
export interface HeroManifest {
  version: number;
  dir: string;
  frames: number;
  timeline: { file: string; version: number; sha1: string };
  px_per_frame: number;
  hold_px: number;
  background: string;
  chapters: Span[];
  features: Feature[];
  anchors: Record<string, Row[]>;
  poster: { frame: number; anchors: Record<string, Row> };
  steps: { flow_p90: number[]; blend: number[] };
  sets: FrameSet[];
}

type Mark = "dot" | "arrow" | "bracket";
// in the manifest's feature order, which numbers the rail
const COPY: Record<string, { title: string; line: string; mark: Mark }> = {
  primary: { title: "PRIMARY ARM ⟨100⟩", line: "Grows along a cube axis of the crystal.", mark: "arrow" },
  tip: { title: "TIP", line: "A paraboloid, rounded by surface tension.", mark: "dot" },
  lambda2: { title: "SECONDARY ARM SPACING λ₂", line: "Finer spacing usually means a stronger casting.", mark: "bracket" },
  tertiary: { title: "TERTIARY ARM", line: "A branch on a branch.", mark: "dot" },
  neck: { title: "NECKED ROOT", line: "In a real casting side arms thin where they join, and some melt off.", mark: "dot" },
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
  /** the mark's opacity: inside the window and the anchor visible */
  alpha: number;
  /** the row is the one in view (bright) */
  on: boolean;
}

/** What the gates read (scripts/verify-hero.mjs). */
interface HeroHook {
  mode: "live" | "still" | "failed";
  manifest: HeroManifest | null;
  /** width of the frame set in use, 0 for none */
  set: number;
  /** the frame drawn (the lower one of a blend), -1 before the first draw */
  frame: number;
  /** the frame drawn over it at blendAlpha, -1 when none */
  over: number;
  blendAlpha: number;
  /** the spring's playhead and where the scroll puts it, in frames */
  frameFloat: number;
  target: number;
  /** the playhead's speed, frames per second */
  velocity: number;
  /** the same two positions as pin progress, 0..1 */
  p: number;
  pTarget: number;
  /** the spring has settled, the rest ease is over and the frame drawn is the
   *  playhead's own, from the set in use */
  rest: boolean;
  /** the animation-frame count, its timestamp (ms) and the step it took (s) */
  tick: number;
  t: number;
  dt: number;
  /** frames with their bytes in hand, this set */
  loaded: number;
  /** segment fetches tried again after a failure that could pass */
  retries: number;
  failed: string[];
  decodedCount: number;
  cacheBytes: number;
  cacheCap: number;
  framePx: number;
  holdPx: number;
  pxPerFrame: number;
  st: ScrollTrigger | null;
  callouts(): { id: string; alpha: number; on: boolean }[];
}
declare global { interface Window { __hero?: HeroHook } }

/** A response the server refused, with its status. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
/** Whether a failed fetch may succeed if tried again: the network, a
 *  truncated body, a 5xx, 408 or 429. A 404 is the file not being there. */
const passing = (err: unknown) => !(err instanceof HttpError) || err.status >= 500 || err.status === 408 || err.status === 429;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/** SHA-1 of bytes as hex: the digest path_plan.py, render_sequence.py and the
 *  encoder record for hero/timeline.json. Written out rather than taken from
 *  crypto.subtle, which exists only in secure contexts. */
function sha1Hex(bytes: Uint8Array): string {
  const len = bytes.length;
  const blocks = ((len + 8) >>> 6) + 1;
  const w = new Uint32Array(blocks * 16);
  for (let i = 0; i < len; i++) w[i >>> 2] |= bytes[i] << (24 - (i & 3) * 8);
  w[len >>> 2] |= 0x80 << (24 - (len & 3) * 8);
  w[blocks * 16 - 1] = len * 8;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const x = new Uint32Array(80);
  for (let o = 0; o < w.length; o += 16) {
    for (let t = 0; t < 80; t++) {
      if (t < 16) x[t] = w[o + t];
      else { const s = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16]; x[t] = (s << 1) | (s >>> 31); }
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const n = (((a << 5) | (a >>> 27)) + f + e + k + x[t]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = n;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(v => v.toString(16).padStart(8, "0")).join("");
}
/** The digest is defined over the LF file; a CRLF checkout is read as LF. */
let timelineDigest = "";
const timelineSha1 = () => (timelineDigest ||= sha1Hex(new TextEncoder().encode(TIMELINE_TEXT.replace(/\r\n/g, "\n"))));

/** The chapter of that id in hero/timeline.json. */
const chapter = (id: string): Span => TIMELINE.chapters.find(c => c.id === id) ?? { id, from: 0, to: 0 };

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

/** The manifest, with what both modes read (the features, their anchors, the
 *  poster's anchors) checked. */
async function loadManifest(): Promise<HeroManifest> {
  const r = await fetch(`${DIR}manifest.json`);
  if (!r.ok) throw new Error(`hero manifest: HTTP ${r.status}`);
  const m = (await r.json()) as HeroManifest;
  if (!m || !Array.isArray(m.features) || !m.anchors || !(m.frames > 0) || !m.poster?.anchors)
    throw new Error("hero manifest: malformed");
  return m;
}

/** Why the live hero cannot run on this manifest, or null. */
function liveProblem(m: HeroManifest): string | null {
  if (m.version !== 3) return `manifest version ${m.version}, the page reads 3`;
  if (m.frames !== N) return `the manifest has ${m.frames} frames, hero/timeline.json ${N}`;
  if (m.timeline?.sha1 !== timelineSha1()) return `the manifest was encoded for timeline ${m.timeline?.sha1}, the page has ${timelineSha1()}`;
  if (m.px_per_frame !== PX_PER_FRAME || m.hold_px !== HOLD_PX) return "px per frame or the hold differ from hero/timeline.json";
  if (typeof m.dir !== "string" || !/^v\d+-[0-9a-f]+$/.test(m.dir)) return `bad frame directory ${m.dir}`;
  if (!Array.isArray(m.steps?.blend) || m.steps.blend.length !== N - 1) return "steps.blend is not N - 1 long";
  if (!Array.isArray(m.sets) || !m.sets.length) return "no frame sets";
  for (const s of m.sets)
    if (!(s.width > 0) || !s.first?.frames?.length || !Array.isArray(s.segments) || !s.segments.length) return `frame set ${s.width} malformed`;
  for (const f of m.features) if (m.anchors[f.id]?.length !== N) return `anchors for ${f.id}: not ${N} rows`;
  return null;
}

/** Decodes a 1 x 1 AVIF; false where the browser cannot. */
async function probeAvif(): Promise<boolean> {
  try {
    const bytes = Uint8Array.from(atob(AVIF_1PX), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/avif" }));
    const ok = bmp.width === 1 && bmp.height === 1;
    bmp.close();
    return ok;
  } catch {
    return false;
  }
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
 *  no leader is drawn), beside the mark's root dot, or the bracket's
 *  dimension line, which would otherwise run through it. It takes the first
 *  spot clear of the boxes in `avoid` (DESIGN.md section 5: a label takes the
 *  first spot clear of the other labels): up and right, down and right, up
 *  and left, down and left, then the same twice and three times as far. With
 *  no clear spot it stays up and right, on its --bg stroke. Returns its box. */
function drawNum(c: Callout, pts: Pt[], start: Pt | null, avoid: Rect[] = []): Rect | null {
  const at = start && COPY[c.f.id].mark === "bracket" ? start : pts[0];
  c.num.style.display = start && at ? "" : "none";
  if (!start || !at) return null;
  // the number's box about its baseline origin (measured once it is shown;
  // a box for two 11 px digits where it cannot be)
  let bb = { x: 0, y: -9, width: 14, height: 11 };
  try {
    c.num.setAttribute("x", "0");
    c.num.setAttribute("y", "0");
    const b = c.num.getBBox();
    if (b.width > 0 && b.height > 0) bb = { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch { /* not rendered: the estimate */ }
  const boxAt = (p: Pt): Rect => ({ x: p[0] + bb.x, y: p[1] + bb.y, w: bb.width, h: bb.height });
  const spots: Pt[] = [];
  for (const d of [9, 18, 27]) {
    // baseline origins: the box's bottom-left d up and right of the mark, its
    // top-left d down and right, and the same two mirrored to the left
    spots.push([at[0] + d, at[1] - d], [at[0] + d, at[1] + d - bb.y],
      [at[0] - d - bb.width, at[1] - d], [at[0] - d - bb.width, at[1] + d - bb.y]);
  }
  const clear = (r: Rect) => avoid.every(a => r.x + r.w + 2 <= a.x || a.x + a.w + 2 <= r.x || r.y + r.h + 2 <= a.y || a.y + a.h + 2 <= r.y);
  const p = spots.find(q => clear(boxAt(q))) ?? spots[0];
  c.num.setAttribute("x", p[0].toFixed(1));
  c.num.setAttribute("y", p[1].toFixed(1));
  return boxAt(p);
}

function setLeader(c: Callout, pts: Pt[] | null) {
  c.leader.setAttribute("points", pts ? pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") : "");
}

function setOn(c: Callout, on: boolean) {
  if (c.on === on) return;
  c.on = on;
  c.el.classList.toggle("is-on", on);
}

/** A feature's anchor row while frame o is drawn over frame b at alpha a: the
 *  two rows interpolated when both are visible, else the row of the frame the
 *  picture mostly is. */
function anchorAt(rows: Row[] | undefined, b: number, o: number, a: number): Row | null {
  if (!rows) return null;
  const rb = rows[b];
  if (o < 0 || a <= 0) return rb ?? null;
  const ro = rows[o];
  if (!rb || !ro || rb.length !== ro.length) return (a >= 0.5 ? ro : rb) ?? null;
  const vis = (r: Row) => r[r.length - 1] === 1;
  if (!vis(rb) || !vis(ro)) return a >= 0.5 ? ro : rb;
  return rb.map((v, k) => (k === rb.length - 1 ? 1 : v + (ro[k] - v) * a));
}

// --------------------------------------------------------------------- boot

export function bootHero(): void {
  const section = document.getElementById("heroAct");
  if (!section) return;
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // a visitor who asked for less data gets the poster, not a frame set
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (!reduced && !saveData && root.classList.contains("hero-live")) bootLive(section);
  else void bootStill(section);
}

function hook(partial: Partial<HeroHook>): HeroHook {
  const h: HeroHook = {
    mode: "still", manifest: null, set: 0, frame: -1, over: -1, blendAlpha: 0, frameFloat: 0, target: 0, velocity: 0,
    p: 0, pTarget: 0, rest: false, tick: 0, t: 0, dt: 0, loaded: 0, retries: 0, failed: [], decodedCount: 0, cacheBytes: 0,
    cacheCap: 0, framePx: FRAME_PX, holdPx: HOLD_PX, pxPerFrame: PX_PER_FRAME, st: null, callouts: () => [],
    ...partial,
  };
  window.__hero = h;
  return h;
}

// --------------------------------------------------------------- still mode

/** `known`: the manifest, when live mode already has it and is falling back. */
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
    const drawn: { c: Callout; pts: Pt[]; start: Pt }[] = [];
    for (const c of cs) {
      const row = m.poster.anchors[c.f.id];
      const pts = row ? points(row).map(([x, y]) => [R.x + x * R.w, R.y + y * R.h] as Pt) : [];
      const show = !!row && row[row.length - 1] === 1 && pts.length > 0;
      c.alpha = show ? 1 : 0;
      setOn(c, show);
      c.el.style.visibility = c.g.style.visibility = show ? "" : "hidden";
      setLeader(c, null);
      if (!show) { drawNum(c, pts, null); continue; }
      drawn.push({ c, pts, start: drawMark(c, pts) });
    }
    // on the poster two roots can sit a few px apart (the tertiary and the
    // neck): each number takes a spot clear of the other marks' points and of
    // the numbers placed before it
    const dotBox = (p: Pt): Rect => ({ x: p[0] - 5, y: p[1] - 5, w: 10, h: 10 });
    const nums: Rect[] = [];
    for (const { c, pts, start } of drawn) {
      const others = drawn.filter(d => d.c !== c).flatMap(d => d.pts.map(dotBox));
      const box = drawNum(c, pts, start, [...others, ...nums]);
      if (box) nums.push(box);
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
  const skip = document.getElementById("heroSkip");
  const note = section.querySelector<HTMLElement>(".railNote");

  let m: HeroManifest | null = null;
  let blend: number[] = [];
  let cs: Callout[] = [];
  let text: gsap.core.Timeline | null = null;
  let dead = false;         // fell back to the still: every callback below is a no-op
  let onScreen = true;
  let stacked = false;
  let rect: Rect = { x: 0, y: 0, w: 1, h: 1 };   // the drawn frame's rect, section px
  let css = { w: 0, h: 0 };                     // the canvas's CSS size

  // ------------------------------------------------------------- the spring
  // Position px and velocity v in px of pin travel; the target is the scroll.
  let px = 0, v = 0, pxT = 0;
  let x = 0;                // the playhead in frames: px / PX_PER_FRAME, clamped
  let dir = 1;              // the last direction of travel
  let hz = 60;              // the display's rate, measured from the steps
  let started = false;
  let raf = 0, tPrev = 0, moving = false;
  /** The critically damped spring's closed form: position and velocity s
   *  seconds on, the target held. Stepping by it is exact at any dt (no
   *  integrator damping or blow-up), and it predicts where the playhead goes. */
  const springAt = (s: number): [number, number] => {
    const e0 = px - pxT, c2 = v + W * e0, ex = Math.exp(-W * s);
    return [pxT + (e0 + c2 * s) * ex, (c2 - W * (e0 + c2 * s)) * ex];
  };

  // ----------------------------------------------------------- frame store
  // One frame SET at a time. `gen` names it: a fetch or a decode begun for an
  // earlier set is dropped when it lands.
  let sets: FrameSet[] = [];
  let cur: FrameSet | null = null;
  let gen = 0;
  let ac = new AbortController();
  let blobs: (Blob | null)[] = [];
  /** per segment file: in flight, arrived, waiting to be tried again (at
   *  `due`, after `tries` failures), or failed (at `failedAt`) */
  interface Seg { state: "pending" | "done" | "retry" | "failed"; tries: number; due: number; failedAt: number }
  let segs = new Map<string, Seg>();
  let bitmaps = new Map<number, ImageBitmap>();
  /** a few earlier sets' bitmaps near the playhead: what the canvas draws
   *  after a set switch until the new set has the frame */
  let old = new Map<number, ImageBitmap>();
  const decoding = new Set<number>();
  const broken = new Set<number>();
  let active = 0;
  let loaded = 0;
  /** frames of the set in use whose segment failed and has not arrived since */
  let lost = new Set<number>();
  let released = false;     // the contiguous segments wait for the visitor to move

  /** The set for the canvas: need = CSS width x min(DPR, 2); the smallest
   *  working set at least 0.9 of it, else the largest. The width is measured
   *  now, not taken from the last resize. */
  const pick = (): FrameSet | undefined => {
    const ok = sets.filter(s => !broken.has(s.width));
    const need = canvas.getBoundingClientRect().width * Math.min(devicePixelRatio, DPR_CAP);
    return ok.find(s => s.width >= SET_SLACK * need) ?? ok[ok.length - 1];
  };

  const bytesOf = () => {
    let b = 0;
    for (const bmp of bitmaps.values()) b += bmp.width * bmp.height * 4;
    for (const bmp of old.values()) b += bmp.width * bmp.height * 4;
    return b;
  };
  /** What is drawn now: the lower frame, the one over it, its alpha, and
   *  whether they came from the current set ("c") or the previous one ("o"). */
  let shown = { frame: -1, over: -1, alpha: 0, src: "c" };
  const evict = () => {
    while (bitmaps.size + old.size > MAX_BITMAPS) {
      // the previous set's stand-ins go first, then the current set's frame
      // farthest from the playhead; never one on the canvas now
      const from = old.size ? old : bitmaps;
      const src = from === old ? "o" : "c";
      let far = -1, fd = -1;
      for (const k of from.keys()) {
        if (src === shown.src && (k === shown.frame || k === shown.over)) continue;
        const d = Math.abs(k - x);
        if (d > fd) { fd = d; far = k; }
      }
      if (far < 0) break;
      from.get(far)!.close();
      from.delete(far);
    }
  };
  const closeOld = () => { for (const b of old.values()) b.close(); old.clear(); };

  /** how long a decode takes here (ms, a running mean), and so how far the
   *  playhead travels while one runs */
  let decodeMs = 16;
  const leadOf = () => Math.round((Math.abs(v) / PX_PER_FRAME) * decodeMs / 1000);
  /** where the spring puts the playhead s seconds from now if the scroll
   *  stays where it is, in frames */
  const predict = (s: number) => clamp(springAt(s)[0] / PX_PER_FRAME, 0, N - 1);
  /** Frames to decode, in order. Slow or at rest: the playhead's own (both of
   *  a blend), a stand-in while its bytes are missing, then ahead in the
   *  direction of travel and 3 behind. Fast (the playhead moves a frame or
   *  more while one decode runs): the frames the display will show once a
   *  decode begun now has landed, one per display frame along the spring's
   *  own predicted path (so every stride-th frame at speed, closing up as it
   *  slows), as far as the window ahead reaches past that lead, then the
   *  frame it will come to rest on. A frame decoded for where the playhead
   *  was is stale on arrival. */
  const wanted = (): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    const push = (i: number) => { if (i >= 0 && i < N && !seen.has(i)) { seen.add(i); out.push(i); } };
    const r = Math.round(x), b = Math.min(Math.floor(x), N - 1);
    const fps = Math.abs(v) / PX_PER_FRAME;
    const ahead = clamp(fps * AHEAD_S, AHEAD_MIN, AHEAD_MAX);
    const stride = Math.max(1, Math.ceil(fps / hz));
    const lead = leadOf();
    if (lead >= 1) {
      const L = decodeMs / 1000;
      for (let n = 0; n < 120; n++) {
        const p = predict(L + n / hz);
        if (Math.abs(p - x) > lead + ahead + 0.5) break;
        push(Math.round(p));
      }
      const rest = Math.round(clamp(pxT / PX_PER_FRAME, 0, N - 1));
      push(rest);
      if (rest < N - 1 && blend[rest] === 1) push(rest + 1);
      push(r);
      return out;
    }
    push(r);
    push(b);
    if (b < N - 1 && blend[b] === 1) push(b + 1);
    if (!blobs[r]) {
      for (let d = 1; d < N; d++) {
        if (r - d >= 0 && blobs[r - d]) { push(r - d); break; }
        if (r + d < N && blobs[r + d]) { push(r + d); break; }
      }
    }
    for (let k = stride; k <= ahead; k += stride) push(r + dir * k);
    for (let k = 1; k <= BEHIND; k++) push(r - dir * k);
    return out;
  };
  /** worth holding once decoded: near the playhead (ahead as far as the
   *  decode lead reaches), or where it will come to rest */
  const keep = (i: number) => Math.abs(i - x) <= leadOf() + AHEAD_MAX + BEHIND + 2
    || Math.abs(i - clamp(pxT / PX_PER_FRAME, 0, N - 1)) <= 1.5;
  const startDecode = (i: number) => {
    const g = gen;
    const t0 = performance.now();
    decoding.add(i);
    createImageBitmap(blobs[i]!).then(bmp => {
      if (dead || g !== gen) { bmp.close(); return; }
      decodeMs = decodeMs * 0.8 + 0.2 * (performance.now() - t0);
      decoding.delete(i);
      // the playhead has moved on, or the hero is off screen: close it now
      if (!keep(i) || !onScreen) bmp.close();
      else { bitmaps.set(i, bmp); evict(); wake(); }
      pumpDecode();
    }, err => {
      if (dead || g !== gen) return;
      decoding.delete(i);
      blobs[i] = null;
      framesFailed(`decode ${i}: ${err}`, [i]);
      pumpDecode();
    });
  };
  /** Starts decodes, at most MAX_DECODE in flight, in the order `wanted`
   *  gives. Nothing is queued, so nothing stale waits in front of the
   *  playhead. */
  const pumpDecode = () => {
    if (dead || !cur || !onScreen) return;
    for (const i of wanted()) {
      if (decoding.size >= MAX_DECODE) return;
      if (blobs[i] && !bitmaps.has(i) && !decoding.has(i)) startDecode(i);
    }
  };

  /** Whether a segment is up for fetching: never tried, waiting for a retry
   *  that is due, or failed a while ago with the playhead inside it. */
  const due = (s: Slices, now: number, inside: boolean) => {
    const g = segs.get(s.file);
    if (!g) return true;
    if (g.state === "retry") return now >= g.due;
    return g.state === "failed" && inside && now - g.failedAt >= REQUEUE_MS;
  };
  /** The next segment to fetch: the first pass, then (once the visitor has
   *  moved) the contiguous segments nearest the playhead, ahead of it in the
   *  direction of travel before those behind it. */
  const nextSegment = (): Slices | null => {
    if (!cur) return null;
    const now = performance.now();
    if (due(cur.first, now, false)) return cur.first;
    if (!released) return null;
    const r = Math.round(x);
    let best: Slices | null = null, score = Infinity;
    for (const s of cur.segments) {
      const lo = s.frames[0], hi = s.frames[s.frames.length - 1];
      if (!due(s, now, r >= lo && r <= hi)) continue;
      const d = x < lo ? lo - x : x > hi ? x - hi : 0;
      const ahead = d === 0 || (x < lo) === (dir > 0);
      const sc = ahead ? d : 16 + 2 * d;
      if (sc < score) { score = sc; best = s; }
    }
    return best;
  };
  /** Fetches one segment and hands each frame on as soon as its bytes are
   *  in: the body is read as a stream, so frame 0 (the first pass's first
   *  slice, about a kilobyte) is decoded and drawn long before the rest of the
   *  segment arrives (docs/HERO-DELIVERY.md). Frames an earlier try or the
   *  first pass delivered are kept. */
  const fetchSegment = async (s: Slices, set: FrameSet, g: number, signal: AbortSignal) => {
    const u = `${DIR}${m!.dir}/${s.file}`;
    if (s.index.length !== s.frames.length || !s.index.every(([off, len]) => off >= 0 && len > 0))
      throw new Error(`${u}: malformed index`);
    const size = s.index.reduce((e, [off, len]) => Math.max(e, off + len), 0);
    const r = await fetch(u, { signal });
    if (!r.ok) throw new HttpError(r.status, `${u}: HTTP ${r.status}`);
    const buf = new Uint8Array(size);
    let got = 0, k = 0;
    const order = s.index.map((_, j) => j).sort((a, b) => s.index[a][0] - s.index[b][0]);
    const take = () => {
      let more = false;
      for (; k < order.length; k++) {
        const j = order[k], [off, len] = s.index[j];
        if (off + len > got) break;
        const i = s.frames[j];
        if (blobs[i]) continue;
        blobs[i] = new Blob([buf.subarray(off, off + len)], { type: set.type });
        loaded++;
        more = true;
      }
      if (more) { h.loaded = loaded; pumpDecode(); wake(); }
    };
    const put = (bytes: Uint8Array) => {
      if (got + bytes.length > size) throw new Error(`${u}: longer than its index (${size} B)`);
      buf.set(bytes, got);
      got += bytes.length;
    };
    const reader = r.body?.getReader();
    if (!reader) {
      const all = new Uint8Array(await r.arrayBuffer());
      if (dead || g !== gen) return;
      put(all);
      take();
    } else {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (dead || g !== gen) return;
          if (done) break;
          put(value);
          take();
        }
      } finally {
        if (got !== size || dead || g !== gen) reader.cancel().catch(() => {});
      }
    }
    if (got !== size) throw new Error(`${u}: ${got} of ${size} bytes`);
  };
  const pumpFetch = () => {
    // off screen nothing more is fetched: the acts below want the network.
    // The observer calls this again when the hero is back.
    while (!dead && cur && onScreen && active < MAX_FETCH) {
      const s = nextSegment();
      if (!s) return;
      const set = cur, g = gen, signal = ac.signal;
      const seg: Seg = segs.get(s.file) ?? { state: "pending", tries: 0, due: 0, failedAt: 0 };
      seg.state = "pending";
      segs.set(s.file, seg);
      active++;
      fetchSegment(s, set, g, signal).then(() => {
        if (dead || g !== gen) return;
        seg.state = "done";
        for (const i of s.frames) lost.delete(i);
      }, err => {
        if (dead || g !== gen) return;
        // a failure that can pass is tried again, after 1, 2 and 4 s
        if (seg.tries < RETRY_MS.length && passing(err)) {
          const wait = RETRY_MS[seg.tries++];
          seg.state = "retry";
          seg.due = performance.now() + wait;
          h.retries++;
          setTimeout(pumpFetch, wait);
          return;
        }
        seg.state = "failed";
        seg.failedAt = performance.now();
        seg.tries = 0;
        // the first pass holds frame 0 and the skeleton: without it the set is broken
        if (s === set.first) breakSet(err);
        else {
          framesFailed(String(err), s.frames.filter(i => !blobs[i]));
          // tried again if the playhead is inside it by then
          setTimeout(pumpFetch, REQUEUE_MS);
        }
      }).finally(() => { if (g === gen) { active--; pumpFetch(); } });
    }
  };
  /** Frames that did not arrive or decode. More than a tenth of the set
   *  missing at once, and the set is BROKEN. */
  const framesFailed = (why: string, frames: number[]) => {
    h.failed.push(why);
    for (const i of frames) lost.add(i);
    if (lost.size > N / 10) breakSet(why);
  };
  /** the next working set by the rule, or with none left, the still */
  const breakSet = (err: unknown) => {
    if (!cur) return;
    h.failed.push(`set ${cur.width} broken: ${String(err)}`);
    broken.add(cur.width);
    const s = pick();
    if (s) useSet(s); else fail(err);
  };
  const useSet = (s: FrameSet) => {
    gen++;
    ac.abort();
    ac = new AbortController();
    // Keep the 8 decoded frames nearest the playhead, drawn until the new set
    // has the frame: a switch never shows a blank canvas. They come from the
    // set in use AND the stand-ins it still holds: after two switches in a
    // row the set in use may have none of its own yet (a frame in both keeps
    // the newer set's copy).
    const pool = new Map(old);
    for (const [k, b] of bitmaps) { pool.get(k)?.close(); pool.set(k, b); }
    const near = new Set([...pool.keys()].sort((a, b) => Math.abs(a - x) - Math.abs(b - x)).slice(0, 8));
    old = new Map();
    for (const [k, b] of pool) if (near.has(k)) old.set(k, b); else b.close();
    bitmaps = new Map();
    shown = { ...shown, src: "o" };
    decoding.clear();
    cur = s;
    h.set = s.width;
    blobs = new Array<Blob | null>(N).fill(null);
    segs = new Map();
    lost = new Set();
    active = 0;
    loaded = 0;
    h.loaded = 0;
    drawnKey = "";
    pumpFetch();
    wake();
  };
  const release = () => {
    if (released) return;
    released = true;
    for (const t of RELEASE) removeEventListener(t, release);
    pumpFetch();
  };

  // ------------------------------------------------------------- drawing
  let drawnKey = "";
  /** the rest ease of a blend step: from the fraction to the nearer frame */
  let ease: { base: number; from: number; goal: number; t0: number; done: boolean } | null = null;
  const paintBg = () => { ctx.fillStyle = pageBg(); ctx.fillRect(0, 0, canvas.width, canvas.height); };
  const bitmapOf = (i: number): [ImageBitmap, string] | null => {
    const c = bitmaps.get(i);
    if (c) return [c, "c"];
    const o = old.get(i);
    return o ? [o, "o"] : null;
  };
  /** the decoded frame nearest the playhead, the current set's on a tie */
  const nearestDecoded = (): number => {
    let best = -1, bd = Infinity;
    for (const k of bitmaps.keys()) { const d = Math.abs(k - x); if (d < bd) { bd = d; best = k; } }
    for (const k of old.keys()) { const d = Math.abs(k - x); if (d < bd) { bd = d; best = k; } }
    return best;
  };
  /** What the playhead asks for: a cut to the nearer frame, or frame i with
   *  i+1 over it at the fraction on a blend step; at rest the fraction eases
   *  to 0 or 1, so a still picture is a real render. */
  const asked = (now: number): { b: number; o: number; a: number; easing: boolean } => {
    const base = Math.min(Math.floor(x), N - 1);
    const f = x - base;
    if (!(base < N - 1 && blend[base] === 1 && f > 0)) { ease = null; return { b: Math.round(x), o: -1, a: 0, easing: false }; }
    if (moving) { ease = null; return { b: base, o: base + 1, a: f, easing: false }; }
    if (!ease || ease.base !== base) ease = { base, from: f, goal: f >= 0.5 ? 1 : 0, t0: now, done: false };
    const u = (now - ease.t0) / EASE_MS;
    if (u >= 1) { ease.done = true; return { b: base + ease.goal, o: -1, a: 0, easing: false }; }
    return { b: base, o: base + 1, a: ease.from + (ease.goal - ease.from) * smooth(u), easing: true };
  };
  /** Draws what is asked, or the nearest decoded frame while it is not
   *  decoded; returns whether the rest ease is still running. */
  function draw(now: number): boolean {
    h.rest = false;
    if (dead || !m) return false;
    const want = asked(now);
    if (!onScreen) return want.easing;
    let b = want.b, o = want.o, a = want.a;
    if (!bitmapOf(b) || (o >= 0 && !bitmapOf(o))) {
      const dom = o >= 0 && a >= 0.5 ? o : b;
      b = bitmapOf(dom) ? dom : nearestDecoded();
      o = -1;
      a = 0;
      if (b < 0) return want.easing;   // nothing decoded yet: the canvas keeps what it has
    }
    let aq = o >= 0 ? Math.round(a * 64) / 64 : 0;
    if (aq >= 1) { b = o; o = -1; aq = 0; }
    if (aq <= 0) { o = -1; aq = 0; }
    const [bb, bs] = bitmapOf(b)!;
    const ob = o >= 0 ? bitmapOf(o) : null;
    const key = `${b}${bs}|${o}${ob?.[1] ?? ""}|${aq}|${gen}|${canvas.width}x${canvas.height}`;
    if (key !== drawnKey) {
      const box = { x: 0, y: 0, w: canvas.width, h: canvas.height };
      paintBg();
      const r = contain(box, bb.width, bb.height);
      ctx.drawImage(bb, r.x, r.y, r.w, r.h);
      if (ob && aq > 0) {
        const q = contain(box, ob[0].width, ob[0].height);
        ctx.globalAlpha = aq;
        ctx.drawImage(ob[0], q.x, q.y, q.w, q.h);
        ctx.globalAlpha = 1;
      }
      drawnKey = key;
    }
    shown = { frame: b, over: o, alpha: aq, src: bs };
    // the new set has the playhead's own picture: the stand-ins can go
    if (old.size && bs === "c" && b === want.b && o === want.o) closeOld();
    h.frame = b;
    h.over = o;
    h.blendAlpha = aq;
    // at rest: the spring settled, the ease over, and the frame on the canvas
    // the playhead's own, from the set in use (not a stand-in)
    h.rest = !moving && !want.easing && b === want.b && o === want.o && o < 0 && b === Math.round(x) && bs === "c";
    return want.easing;
  }

  // ------------------------------------------------------------ callouts
  const windowAlpha = (f: Feature) => {
    // eased on the playhead so a mark glides in and out
    const fin = smooth((x - (f.from - 0.5)) / 1.5);
    const fout = f.to >= N - 1 ? 1 : 1 - smooth((x - (f.to - 1)) / 1.5);
    return fin * fout;
  };
  function placeCallouts() {
    if (!m || shown.frame < 0) return;
    const sr = section.getBoundingClientRect();
    const { frame: b, over: o, alpha: a } = shown;
    // the frame the picture mostly is: its windows, its anchors' flags
    const dom = o >= 0 && a >= 0.5 ? o : b;
    let lit: Callout | null = null;
    for (const c of cs) {
      const inWindow = dom >= c.f.from && dom <= c.f.to;
      // the row stays lit through its whole window, the rail's place in the
      // tour; the mark and the leader go wherever the anchor is hidden
      setOn(c, inWindow);
      if (c.on) lit = c;
      const row = inWindow ? anchorAt(m.anchors[c.f.id], b, o, a) : null;
      const al = row && row[row.length - 1] === 1 ? windowAlpha(c.f) : 0;
      c.alpha = al;
      const vis = al > 0.001 ? "visible" : "hidden";
      c.g.style.opacity = al.toFixed(3);
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
    const pts = points(row).map(([ax, ay]) => [rect.x + ax * rect.w, rect.y + ay * rect.h] as Pt);
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
    const lx = c.el.getBoundingClientRect().left - sr.left - 14;
    const ly = t.top - sr.top + t.height / 2;
    setLeader(c, [start, [lx - 26, ly], [lx, ly]]);
  }

  // ---------------------------------------------------------------- text
  /** Each block of the copy column rises into place and leaves the same way:
   *  opacity and a short translate, positioned in px of pin travel and read
   *  off the spring. The kicker, heading and body stay in the accessibility
   *  tree at opacity 0; a CTA goes to visibility: hidden too, so it cannot be
   *  focused or hit while gone. Built from hero/timeline.json alone, so the
   *  column is right before the manifest arrives. Something new every
   *  ~1,000 px: the opening, grow (760), the skip link (1000), branch (1800),
   *  cool (2780), the rail (3360) and its five rows (3390-6020), pull back
   *  (6880), the end (7810). */
  function buildText() {
    const t0 = text ? text.time() : null;
    // revert, not kill: a killed timeline leaves its inline styles behind, and
    // the rebuilt one would record them as its starting state
    text?.revert();
    const tl = gsap.timeline({ paused: true });
    const at = (frame: number) => frame * PX_PER_FRAME;
    const grow = chapter("grow"), branch = chapter("branch"), cool = chapter("cool");
    const tour = chapter("tour"), pull = chapter("pullback");

    // The opening stays through the seed and the first arms, then leaves. It
    // fades by OPACITY, so the page's only <h1> stays in the accessibility
    // tree; only the links go to visibility: hidden once they are gone.
    const openOut = at(grow.from) + 200;
    tl.fromTo("#heroOpen", { opacity: 1, y: 0 }, { opacity: 0, y: -24, duration: 140, ease: "power1.in" }, openOut);
    tl.fromTo("#heroOpen .cta", { visibility: "inherit" }, { visibility: "hidden", duration: 1, ease: "none" }, openOut + 139);
    tl.fromTo("#scrollCue", { autoAlpha: 1 }, { autoAlpha: 0, duration: 120, ease: "none" }, 0);

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
    const chap = (id: string, inAt: number, outAt: number | null) =>
      block(section.querySelector<HTMLElement>(`.chap[data-chap="${id}"]`), inAt, outAt);
    // each block is gone (out + 92 px) before the next arrives in its place;
    // cool arrives only once growth has stopped (the timeline's growth.to)
    chap("grow", at(grow.from) + 400, at(branch.from) + 80);
    chap("branch", at(branch.from) + 240, at(cool.from) - 140);
    chap("cool", Math.max(at(cool.from), at(TIMELINE.growth.to) + 10) + 20, at(tour.from) - 130);
    // the rail arrives with the tour and stays into the pull-back, until the
    // pull-back's words take the column
    const tourBox = section.querySelector<HTMLElement>(".heroTour");
    if (tourBox) {
      tl.fromTo(tourBox, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 100, ease: "power2.out" }, at(tour.from) - 30);
      tl.to(tourBox, { autoAlpha: 0, y: -12, duration: 80, ease: "power1.in" }, at(pull.from) + 400);
    }
    chap("pullback", at(pull.from) + 490, FRAME_PX - 140);
    chap("end", END_AT_PX, null);
    tl.set({}, {}, TOTAL_PX);   // the timeline spans the whole pin, in px
    text = tl;
    tl.time(t0 ?? clamp(px, 0, TOTAL_PX));
    // every block now has its reveal state: index.html hides them until then
    section.classList.add("hero-ready");
  }

  // ---------------------------------------------------------------- tick
  const readPx = () => (st ? clamp(st.scroll() - st.start, 0, TOTAL_PX) : 0);
  const wake = () => { if (!raf && !dead) raf = requestAnimationFrame(tick); };
  /** One animation frame: step the spring toward the scroll, then everything
   *  that reads it. Runs while the playhead moves or the rest ease runs. */
  function tick(now: number) {
    raf = 0;
    if (dead) return;
    const dt = tPrev ? clamp((now - tPrev) / 1000, 0, DT_MAX) : 0;
    tPrev = now;
    pxT = readPx();
    if (!started || !onScreen) {
      // nothing on screen to glide: the playhead is where the scroll is
      px = pxT; v = 0; started = true;
    } else if (dt > 0) {
      [px, v] = springAt(dt);
      if (Math.abs(px - pxT) < SETTLE_PX && Math.abs(v) < SETTLE_V) { px = pxT; v = 0; }
      hz = hz * 0.8 + 0.2 * clamp(1 / dt, 30, 240);
    }
    moving = px !== pxT || v !== 0;
    if (v !== 0) dir = v > 0 ? 1 : -1;
    x = clamp(px / PX_PER_FRAME, 0, N - 1);
    const pinPx = clamp(px, 0, TOTAL_PX);
    text?.time(pinPx);
    skip?.classList.toggle("is-shown", pinPx >= SKIP_AT_PX && pinPx < END_AT_PX);
    pumpFetch();
    pumpDecode();
    const easing = draw(now);
    placeCallouts();
    h.tick++;
    h.t = now;
    h.dt = dt;
    h.frameFloat = x;
    h.target = clamp(pxT / PX_PER_FRAME, 0, N - 1);
    h.velocity = v / PX_PER_FRAME;
    h.p = pinPx / TOTAL_PX;
    h.pTarget = pxT / TOTAL_PX;
    h.decodedCount = bitmaps.size + old.size;
    h.cacheBytes = bytesOf();
    if (moving || easing) raf = requestAnimationFrame(tick);
    else tPrev = 0;
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
  /** The backing store to CSS size x min(DPR, 2), then everything that
   *  depends on it. Synchronous: resizing clears the backing store, and this
   *  runs after the frame's rAF callbacks, so the picture is put back before
   *  the frame is painted. */
  const fit = () => {
    if (dead) return;
    const k = Math.min(devicePixelRatio, DPR_CAP);
    const w = Math.round(css.w * k), hgt = Math.round(css.h * k);
    if (w > 0 && hgt > 0 && (canvas.width !== w || canvas.height !== hgt)) {
      canvas.width = w;
      canvas.height = hgt;
      ctx.imageSmoothingQuality = "high";
      paintBg();
      drawnKey = "";
    }
    measure();
    if (draw(performance.now())) wake();
    placeCallouts();
    repickSoon();
  };
  // A canvas that has outgrown its set (a narrow window maximized, a zoom, a
  // move to a denser screen) trades up; never down, so a drag cannot thrash.
  // Only once the layout has settled: while pinned, the section keeps the
  // size ScrollTrigger measured until its refresh, 0.2 s after the last
  // window resize, so the canvas reports its old CSS width against the new
  // DPR in between (a zoom in would look like a need for a larger set).
  let pickTimer = 0, resizedAt = -Infinity, refreshedAt = -Infinity;
  const repickSoon = () => { clearTimeout(pickTimer); pickTimer = window.setTimeout(repick, SETTLE_MS); };
  const repick = () => {
    pickTimer = 0;
    if (dead || !m || !cur) return;
    // a resize ScrollTrigger has not re-laid out yet: its refresh calls again
    // (one it ignores, a phone's URL bar, is waited out for a second)
    const wait = resizedAt > refreshedAt ? resizedAt + 1000 - performance.now() : 0;
    if (wait > 0) { pickTimer = window.setTimeout(repick, wait); return; }
    const s = pick();
    if (s && s.width > cur.width) useSet(s);
  };
  const ro = new ResizeObserver(entries => {
    const r = entries[entries.length - 1].contentRect;
    css = { w: r.width, h: r.height };
    fit();
  });
  ro.observe(canvas);
  // a change of devicePixelRatio alone (the window moved to another screen, a
  // zoom) resizes nothing the observer sees: a resolution query re-armed at
  // each ratio catches it
  let dprMq: MediaQueryList | null = null;
  const onDpr = () => { watchDpr(); fit(); };
  const watchDpr = () => {
    dprMq?.removeEventListener("change", onDpr);
    dprMq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprMq.addEventListener("change", onDpr);
  };
  watchDpr();
  // ON SCREEN means the picture can be seen: the canvas, below the fixed
  // header (the section's own bottom strip stays in view under the header
  // at the next act, where the skip link lands). The observer is remade when
  // the header's height changes with the breakpoint.
  const header = document.getElementById("topnav");
  let io: IntersectionObserver | null = null, ioTop = -1;
  const observe = () => {
    const top = Math.round(header?.getBoundingClientRect().height ?? 0);
    if (io && top === ioTop) return;
    io?.disconnect();
    ioTop = top;
    io = new IntersectionObserver(es => {
      // the LAST entry: an enter and a leave can arrive in one batch
      onScreen = es[es.length - 1].isIntersecting;
      if (onScreen) { pumpFetch(); wake(); return; }
      // scrolled past: the acts below want the memory and the network (no
      // new fetch starts). The canvas keeps its pixels, and pumpDecode refills
      // around the playhead when the hero is back.
      for (const [k, b] of bitmaps) if (!(shown.src === "c" && (k === shown.frame || k === shown.over))) { b.close(); bitmaps.delete(k); }
      closeOld();
      if (shown.src === "o") shown = { frame: -1, over: -1, alpha: 0, src: "c" };
      h.decodedCount = bitmaps.size;
      h.cacheBytes = bytesOf();
    }, { rootMargin: `-${top}px 0px 0px 0px` });
    io.observe(canvas);
  };
  observe();
  const onRefresh = () => { refreshedAt = performance.now(); measure(); repickSoon(); wake(); };
  ScrollTrigger.addEventListener("refresh", onRefresh);
  addEventListener("scroll", wake, { passive: true });
  let lastW = innerWidth;
  let rebuild = 0;
  const onResize = () => {
    resizedAt = performance.now();
    // a zoom changes devicePixelRatio and fires this; the observer sees only
    // CSS size, and the resolution query only a change of screen
    fit();
    clearTimeout(rebuild);
    rebuild = window.setTimeout(() => {
      if (dead) return;
      observe();
      if (innerWidth === lastW) return;   // a phone's URL bar, not a new line length
      lastW = innerWidth;
      buildText();
      measure();
    }, 160);
  };
  addEventListener("resize", onResize);
  // A live page whose screen becomes too short for the pinned column (a phone
  // turned sideways after it loaded) takes the still, as a page loaded that
  // way does. Turned back, it keeps the still: rebuilding the pin above the
  // acts' pins mid-visit would move every act under the visitor.
  const short = matchMedia(SHORT);
  const onShort = () => { if (short.matches) fail(new Error("the screen is under 560 px tall"), undefined, "still"); };
  short.addEventListener("change", onShort);

  // THE PIN, created here and synchronously: nothing about its geometry waits
  // on the manifest (its length is the timeline's), and it has to exist before
  // landing.ts creates the lens and materials pins below it. No scrub: the
  // spring above reads the scroll itself.
  const st: ScrollTrigger = ScrollTrigger.create({
    id: "heroAct",
    trigger: section,
    start: "top top",
    end: `+=${TOTAL_PX}`,
    pin: true,
    anticipatePin: 1,
    onUpdate: wake,
  });
  h.st = st;
  buildText();
  wake();

  /** The still, with everything live mode made taken down first: the pin, the
   *  text timeline, the live rail rows and marks, the observers and
   *  listeners, the fetches and the decoded frames. Runs once. `known`: a
   *  manifest the still can label the poster from. */
  const fail = (err: unknown, known?: HeroManifest, mode: "still" | "failed" = "failed") => {
    if (dead) return;
    dead = true;
    console.warn("[solidify] hero: showing the still:", err);
    h.failed.push(String(err));
    // Where the visitor is, kept across the pin's removal (the page gets
    // TOTAL_PX shorter): inside the pin, the hero's top; below it, the act
    // that fills most of the screen, at the same offset.
    const seen = (a: HTMLElement) => { const r = a.getBoundingClientRect(); return Math.min(r.bottom, innerHeight) - Math.max(r.top, 0); };
    const acts = [...document.querySelectorAll<HTMLElement>("main > section")].sort((a, b) => seen(b) - seen(a));
    const anchor = st.isActive ? section : acts[0] ?? null;
    const offset = anchor && anchor !== section ? anchor.getBoundingClientRect().top : 0;
    cancelAnimationFrame(raf);
    raf = 0;
    ac.abort();
    st.kill(true);
    text?.revert();
    text = null;
    for (const c of cs) { c.el.remove(); c.g.remove(); }
    cs = [];
    if (note) note.textContent = "";
    skip?.classList.remove("is-shown");
    ro.disconnect();
    io?.disconnect();
    dprMq?.removeEventListener("change", onDpr);
    short.removeEventListener("change", onShort);
    removeEventListener("resize", onResize);
    removeEventListener("scroll", wake);
    clearTimeout(rebuild);
    clearTimeout(pickTimer);
    for (const t of RELEASE) removeEventListener(t, release);
    ScrollTrigger.removeEventListener("refresh", onRefresh);
    for (const b of bitmaps.values()) b.close();
    bitmaps.clear();
    closeOld();
    blobs = [];
    section.classList.remove("hero-ready");
    root.classList.remove("hero-live");
    h.mode = mode;
    h.st = null;
    ScrollTrigger.refresh();
    // (with a manifest in hand, bootStill builds the rail before it returns)
    void bootStill(section, known ?? m ?? undefined, mode);
    // bootStill replaced the hook synchronously; keep the reasons on it
    if (window.__hero && window.__hero !== h) window.__hero.failed = h.failed;
    if (anchor) window.scrollTo(0, Math.max(0, scrollY + anchor.getBoundingClientRect().top - offset));
  };

  const setup = (man: HeroManifest, avif: boolean) => {
    if (dead) return;
    const why = liveProblem(man);
    if (why) { fail(new Error(`hero manifest: ${why}`), man); return; }
    if (!avif) { fail(new Error("this browser does not decode AVIF"), man); return; }
    m = man;
    h.manifest = man;
    blend = man.steps.blend;
    sets = [...man.sets].sort((a, b) => a.width - b.width);
    const widest = sets[sets.length - 1].width;
    h.cacheCap = MAX_BITMAPS * widest * widest * 4;
    cs = makeCallouts(man.features, rail, marks);
    describe(section, man.features);
    h.callouts = () => cs.map(c => ({ id: c.f.id, alpha: c.alpha, on: c.on }));
    measure();
    const s = pick();
    if (!s) { fail(new Error("hero manifest: no frame set")); return; }
    useSet(s);
    // the first pass loads now; the rest once the visitor moves, so a visit
    // that never scrolls costs a sixteenth of the set
    if (scrollY > 0) release();
    else for (const t of RELEASE) addEventListener(t, release, { passive: true });
    wake();
  };
  // only the manifest's own failure goes to the still here: an exception in
  // setup is a bug, and surfaces as one
  Promise.all([loadManifest(), probeAvif()]).then(([man, avif]) => setup(man, avif), err => fail(err));
}
