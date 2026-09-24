// HERO-* (browser-free) — the landing hero's frame set against its contract.
//
// The hero (src/hero.ts) scrubs a PRE-RENDERED image sequence, and both the
// renderer (hero/dendrite_gen.py, Blender) and the page are written against one
// contract. This gate holds the files to it without a browser, so CI can run it:
//
//   public/hero/{1200,600}/f000.webp .. f179.webp, public/hero/poster-{1200,600}.webp,
//   public/hero/manifest.json — 180 square OPAQUE frames on #0a0b0d, chapters
//   seed 0-11 / grow 12-95 / cool 96-119 / tour 120-179, five feature windows
//   inside the tour, and per frame one anchor row per feature:
//   point -> [x, y, visible], pair -> [x1, y1, x2, y2, visible], x/y in [0, 1].
//
// Six checks, each in its own try/catch so a gate that cannot run reports a FAIL
// carrying the exception instead of printing nothing (tasks/lessons.md).
//   HERO-MANIFEST-SCHEMA   the top-level shape, the chapters and the feature
//                          windows, EXACTLY the contract's (the page's copy is
//                          keyed to them), the poster frame inside the tour
//   HERO-MANIFEST-ANCHORS  180 rows per feature, row shapes, [0,1], 0/1 flags,
//                          every feature visible for at least half its window
//                          and never under the page's 6 % edge fade, and the
//                          poster's anchors all five VISIBLE (reduced motion
//                          shows every callout at once) and equal to its
//                          frame's own rows
//   HERO-FILES             both sizes' 180 frames and both posters on disk, and
//                          nothing else in the frame directories
//   HERO-WEBP-HEADERS      every file parsed from its RIFF header: WEBP, the
//                          RIFF length equal to the file length (truncation),
//                          the size's own square dimensions, no alpha, no
//                          animation — VP8 / VP8L / VP8X all read
//   HERO-BUDGET            each frame set's total bytes under its budget
//   HERO-PAGE-KEYS         every manifest feature has words in src/hero.ts and
//                          the page has a block for every chapter it keys to
//
// A manifest whose `source` says PLACEHOLDER (hero/make_placeholder_frames.py)
// honors the contract and passes locally, with a notice on every run. Under CI
// (process.env.CI, which GitHub Actions sets) it FAILS HERO-MANIFEST-SCHEMA,
// so a push to main or a PR cannot carry the stand-ins toward a deploy;
// HERO_ALLOW_PLACEHOLDER=1 lets a feature-branch run through on purpose.
//
//   node scripts/verify-hero-manifest.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERO = fileURLToPath(new URL("../public/hero/", import.meta.url));
const SRC = p => fileURLToPath(new URL(`../${p}`, import.meta.url));

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const block = (name, fn) => {
  try { fn(); } catch (e) { check(name, false, { threw: String(e).slice(0, 200) }); }
};

// THE CONTRACT, as the renderer and the page were both given it.
const FRAMES = 180;
const PATTERN = "f{i:03d}.webp";
const SIZES = [1200, 600];
const BACKGROUND = "#0a0b0d";
const CHAPTERS = [
  { id: "seed", from: 0, to: 11 }, { id: "grow", from: 12, to: 95 },
  { id: "cool", from: 96, to: 119 }, { id: "tour", from: 120, to: 179 },
];
const FEATURES = [
  { id: "tip", kind: "point", from: 122, to: 133 }, { id: "primary", kind: "pair", from: 134, to: 145 },
  { id: "lambda2", kind: "pair", from: 146, to: 157 }, { id: "tertiary", kind: "point", from: 158, to: 167 },
  { id: "neck", kind: "point", from: 168, to: 179 },
];
const KEYS = ["version", "frames", "pattern", "sizes", "background", "chapters", "features", "anchors", "poster", "source"];
// "<= ~12 MB" and "<= ~3.5 MB": read as MiB, which is the headroom the "~" gives
const BUDGET = { 1200: 12 * 1024 * 1024, 600: 3.5 * 1024 * 1024 };
const POSTER_MAX = 400 * 1024;
const name = i => PATTERN.replace("{i:03d}", String(i).padStart(3, "0"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let m = null;
let loadErr = null;
try { m = JSON.parse(readFileSync(HERO + "manifest.json", "utf8")); } catch (e) { loadErr = String(e).slice(0, 200); }
if (!m) {
  for (const n of ["HERO-MANIFEST-SCHEMA", "HERO-MANIFEST-ANCHORS", "HERO-FILES", "HERO-WEBP-HEADERS", "HERO-BUDGET", "HERO-PAGE-KEYS"])
    check(n, false, { manifest: "public/hero/manifest.json did not load", error: loadErr });
  console.log(`done — ${failures} FAILED`);
  process.exit(1);
}
const placeholder = typeof m.source === "string" && /PLACEHOLDER/.test(m.source);
const placeholderBlocked = placeholder && !!process.env.CI && process.env.HERO_ALLOW_PLACEHOLDER !== "1";
if (placeholder)
  console.log(`NOTICE: public/hero holds PLACEHOLDER frames (${m.source}); the real render overwrites them`
    + (placeholderBlocked ? ". This is CI, so it fails (HERO_ALLOW_PLACEHOLDER=1 to allow)" : ""));

// 1. HERO-MANIFEST-SCHEMA
block("HERO-MANIFEST-SCHEMA", () => {
  const bad = [];
  const keys = Object.keys(m);
  const extra = keys.filter(k => !KEYS.includes(k)), absent = KEYS.filter(k => !keys.includes(k));
  if (extra.length || absent.length) bad.push({ keys: { extra, absent } });
  if (m.version !== 1) bad.push({ version: m.version });
  if (m.frames !== FRAMES) bad.push({ frames: m.frames });
  if (m.pattern !== PATTERN) bad.push({ pattern: m.pattern });
  if (!same(m.sizes, SIZES)) bad.push({ sizes: m.sizes });
  if (String(m.background).toLowerCase() !== BACKGROUND) bad.push({ background: m.background });
  if (!same(m.chapters, CHAPTERS)) bad.push({ chapters: m.chapters });
  // contiguity is implied by equality with the contract, and asserted on its
  // own so the message says WHICH property broke
  const ch = Array.isArray(m.chapters) ? m.chapters : [];
  const gaps = ch.filter((c, k) => c.from !== (k === 0 ? 0 : ch[k - 1].to + 1));
  if (!ch.length || gaps.length || ch.at(-1)?.to !== FRAMES - 1) bad.push({ chaptersNotContiguous: gaps.map(c => c.id) });
  if (!same(m.features, FEATURES)) bad.push({ features: m.features });
  const tour = ch.find(c => c.id === "tour");
  const outside = (m.features ?? []).filter(f => !tour || f.from < tour.from || f.to > tour.to).map(f => f.id);
  if (outside.length) bad.push({ featuresOutsideTour: outside });
  const fs = m.features ?? [];
  const overlap = fs.filter((f, k) => k > 0 && f.from <= fs[k - 1].to).map(f => f.id);
  if (overlap.length) bad.push({ featureWindowsOverlap: overlap });
  // "poster names a TOUR frame in which all five features are visible"
  // (hero/README.md): the finished, frozen crystal, not a growth or cooling one
  if (!Number.isInteger(m.poster?.frame) || !tour || m.poster.frame < tour.from || m.poster.frame > tour.to)
    bad.push({ posterFrame: m.poster?.frame, want: tour ? `${tour.from}..${tour.to} (the tour)` : "a tour chapter" });
  if (typeof m.source !== "string" || !m.source.startsWith("hero/")) bad.push({ source: m.source });
  if (placeholderBlocked) bad.push({ source: m.source, why: "PLACEHOLDER frames under CI" });
  check("HERO-MANIFEST-SCHEMA", bad.length === 0, { chapters: ch.length, features: fs.length, bad });
});

// 2. HERO-MANIFEST-ANCHORS
block("HERO-MANIFEST-ANCHORS", () => {
  const bad = [];
  const feats = Array.isArray(m.features) ? m.features : [];
  const ids = feats.map(f => f.id);
  const akeys = Object.keys(m.anchors ?? {});
  if (!same([...akeys].sort(), [...ids].sort())) bad.push({ anchorKeys: akeys, featureIds: ids });
  const rowOk = (row, kind) => Array.isArray(row) && row.length === (kind === "pair" ? 5 : 3)
    && row.slice(0, -1).every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)
    && (row.at(-1) === 0 || row.at(-1) === 1);
  const perFeature = {};
  for (const f of feats) {
    const rows = m.anchors?.[f.id];
    if (!Array.isArray(rows) || rows.length !== FRAMES) { bad.push({ feature: f.id, rows: rows?.length }); continue; }
    const badRows = rows.map((r, i) => (rowOk(r, f.kind) ? -1 : i)).filter(i => i >= 0);
    if (badRows.length) bad.push({ feature: f.id, malformedRows: badRows.slice(0, 8), count: badRows.length });
    // LIVENESS: a callout whose point is hidden for most of its own window is a
    // callout the visitor mostly does not see; the contract says the camera
    // frames each feature well inside its window
    const win = rows.slice(f.from, f.to + 1);
    const vis = win.filter(r => Array.isArray(r) && r.at(-1) === 1).length;
    // a visible in-window point inside the page's edge fade (the frame's mask
    // ramps from transparent at the edge to opaque at 6 %, index.html) would
    // have its dot, which is not masked, pointing at crystal faded to a third
    // of itself at 3 %; so the whole ramp fails, not just its outer edge
    const edge = win.filter(r => Array.isArray(r) && r.at(-1) === 1)
      .flatMap(r => r.slice(0, -1)).map(v => Math.min(v, 1 - v));
    const minEdge = edge.length ? Math.min(...edge) : null;
    perFeature[f.id] = { visibleInWindow: `${vis}/${win.length}`, minEdgeDistance: minEdge };
    if (vis * 2 < win.length) bad.push({ feature: f.id, visibleInWindow: `${vis}/${win.length}` });
    if (minEdge !== null && minEdge < 0.06) bad.push({ feature: f.id, anchorInEdgeFade: minEdge });
  }
  const pa = m.poster?.anchors ?? {};
  if (!same(Object.keys(pa).sort(), [...ids].sort())) bad.push({ posterAnchorKeys: Object.keys(pa) });
  for (const f of feats) {
    const r = pa[f.id];
    if (!rowOk(r, f.kind)) bad.push({ posterAnchor: f.id, row: r });
    else if (r.at(-1) !== 1) bad.push({ posterAnchor: f.id, why: "reduced motion shows all five callouts on the poster, so all five must be visible there" });
    // the poster IS its frame (encode_frames.py writes anchors[id][poster.frame]):
    // anchors that disagree with that frame's rows point at the wrong crystal
    else if (!same(r, m.anchors?.[f.id]?.[m.poster?.frame])) bad.push({ posterAnchor: f.id, row: r, frameRow: m.anchors?.[f.id]?.[m.poster?.frame] ?? null });
  }
  check("HERO-MANIFEST-ANCHORS", bad.length === 0 && feats.length === FEATURES.length, { perFeature, bad });
});

// 3. HERO-FILES
block("HERO-FILES", () => {
  const bad = [];
  let found = 0;
  for (const s of SIZES) {
    const dir = HERO + String(s);
    const have = existsSync(dir) ? readdirSync(dir) : [];
    const want = Array.from({ length: FRAMES }, (_, i) => name(i));
    const missing = want.filter(f => !have.includes(f));
    const extra = have.filter(f => !want.includes(f));
    found += want.length - missing.length;
    if (missing.length) bad.push({ size: s, missing: missing.slice(0, 6), count: missing.length });
    if (extra.length) bad.push({ size: s, unexpected: extra.slice(0, 6), count: extra.length });
    if (!existsSync(HERO + `poster-${s}.webp`)) bad.push({ size: s, poster: "missing" });
  }
  check("HERO-FILES", bad.length === 0 && found === FRAMES * SIZES.length, { framesFound: found, bad });
});

// 4. HERO-WEBP-HEADERS
// The RIFF container and the three bitstream headers, read by hand:
//   "VP8 " lossy:     frame tag (3 bytes), start code 9d 01 2a, 14-bit width, 14-bit height
//   "VP8L" lossless:  signature 0x2f, then width-1 and height-1 in 14 bits each,
//                     then the alpha_is_used bit
//   "VP8X" extended:  flags (0x10 alpha, 0x02 animation), 3 reserved bytes, then
//                     canvas width-1 and height-1 in 24 bits each
function webp(buf) {
  if (buf.length < 30 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP")
    return { err: "not a RIFF/WEBP file" };
  const lengthOk = buf.readUInt32LE(4) + 8 === buf.length;
  const fourcc = buf.toString("latin1", 12, 16);
  if (fourcc === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return { err: "VP8 start code missing" };
    return { fourcc, lengthOk, w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff,
      alpha: false, anim: false, key: (buf[20] & 1) === 0 };
  }
  if (fourcc === "VP8L") {
    if (buf[20] !== 0x2f) return { err: "VP8L signature missing" };
    const b = buf.readUInt32LE(21);
    return { fourcc, lengthOk, w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1,
      alpha: ((b >>> 28) & 1) === 1, anim: false, key: true };
  }
  if (fourcc === "VP8X") {
    const flags = buf[20];
    return { fourcc, lengthOk, w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1,
      alpha: (flags & 0x10) !== 0, anim: (flags & 0x02) !== 0, key: true };
  }
  return { err: `unknown first chunk "${fourcc}"` };
}
const sizesOnDisk = {};
block("HERO-WEBP-HEADERS", () => {
  const bad = [];
  const kinds = {};
  let parsed = 0;
  const files = [];
  for (const s of SIZES) {
    for (let i = 0; i < FRAMES; i++) files.push({ s, p: `${s}/${name(i)}`, frame: true });
    files.push({ s, p: `poster-${s}.webp`, frame: false });
  }
  for (const f of files) {
    const path = HERO + f.p;
    if (!existsSync(path)) continue;   // HERO-FILES reports absences
    const buf = readFileSync(path);
    if (f.frame) sizesOnDisk[f.s] = (sizesOnDisk[f.s] ?? 0) + buf.length;
    else sizesOnDisk[`poster-${f.s}`] = buf.length;
    const w = webp(buf);
    if (w.err) { bad.push({ file: f.p, err: w.err }); continue; }
    parsed++;
    kinds[w.fourcc] = (kinds[w.fourcc] ?? 0) + 1;
    const why = [];
    if (!w.lengthOk) why.push("RIFF length disagrees with the file length (truncated?)");
    if (w.w !== f.s || w.h !== f.s) why.push(`${w.w}x${w.h}, expected ${f.s}x${f.s}`);
    if (w.alpha) why.push("has alpha; the contract says opaque on #0a0b0d");
    if (w.anim) why.push("animated");
    if (!w.key) why.push("VP8 frame is not a key frame");
    if (why.length) bad.push({ file: f.p, why });
  }
  check("HERO-WEBP-HEADERS", bad.length === 0 && parsed === files.length,
    { parsed, expected: files.length, bitstreams: kinds, bad: bad.slice(0, 10), badCount: bad.length });
});

// 5. HERO-BUDGET
block("HERO-BUDGET", () => {
  const bad = [];
  const report = {};
  for (const s of SIZES) {
    const total = sizesOnDisk[s] ?? 0;
    report[s] = `${(total / 1048576).toFixed(2)} MiB of ${(BUDGET[s] / 1048576).toFixed(1)}`;
    if (!(total > 0)) bad.push({ size: s, why: "no bytes counted" });
    if (total > BUDGET[s]) bad.push({ size: s, total, budget: BUDGET[s] });
    const p = sizesOnDisk[`poster-${s}`] ?? statSync(HERO + `poster-${s}.webp`, { throwIfNoEntry: false })?.size ?? 0;
    report[`poster-${s}`] = `${(p / 1024).toFixed(0)} KiB`;
    if (!(p > 0) || p > POSTER_MAX) bad.push({ poster: s, bytes: p, max: POSTER_MAX });
  }
  check("HERO-BUDGET", bad.length === 0, { ...report, bad });
});

// 6. HERO-PAGE-KEYS
// The page is keyed to the manifest by id in two places, and a renamed id on
// either side would silently drop a callout or leave a chapter with no text.
block("HERO-PAGE-KEYS", () => {
  const bad = [];
  const heroTs = readFileSync(SRC("src/hero.ts"), "utf8");
  const copyBlock = heroTs.match(/const COPY[^=]*=\s*\{([\s\S]*?)\n\};/);
  const copyIds = copyBlock ? [...copyBlock[1].matchAll(/^\s*(\w+):\s*\{\s*title:/gm)].map(x => x[1]) : [];
  const ids = (m.features ?? []).map(f => f.id);
  const noWords = ids.filter(id => !copyIds.includes(id));
  const orphanWords = copyIds.filter(id => !ids.includes(id));
  if (!copyIds.length) bad.push({ copy: "COPY table not found in src/hero.ts" });
  if (noWords.length) bad.push({ featuresWithNoCopy: noWords });
  if (orphanWords.length) bad.push({ copyWithNoFeature: orphanWords });
  const html = readFileSync(SRC("index.html"), "utf8");
  const blocks = [...html.matchAll(/class="chap" data-chap="([\w-]+)"/g)].map(x => x[1]);
  // the page's text chapters: grow (seed + grow), cool, and end (after the
  // last frame); the tour speaks through the callouts alone
  const chIds = (m.chapters ?? []).map(c => c.id);
  const needs = ["grow", "cool"].filter(id => chIds.includes(id));
  const missing = [...needs, "end"].filter(id => !blocks.includes(id));
  if (missing.length) bad.push({ chapterBlocksMissing: missing });
  const posterSrc = html.match(/id="heroStill"\s+src="([^"]+)"/)?.[1];
  if (posterSrc !== "hero/poster-1200.webp") bad.push({ noJsPoster: posterSrc ?? null, want: "hero/poster-1200.webp" });
  check("HERO-PAGE-KEYS", bad.length === 0, { copyIds, chapterBlocks: blocks, bad });
});

console.log(failures ? `done — ${failures} FAILED` : "done — all hero manifest checks passed");
if (failures) process.exitCode = 1;
