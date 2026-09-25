// HERO-* (browser-free) — the landing hero's frame sets against their contract,
// docs/HERO-DELIVERY.md (manifest version 3).
//
// The hero (src/hero.ts) scrubs PRE-RENDERED frames. hero/timeline.json is the
// frame contract (N, chapters, feature windows, px per frame, the budgets), the
// renderer and hero/encode_frames.py write to it, and this gate holds the
// shipped files to it without a browser, so CI can run it:
//
//   public/hero/manifest.json            stable, revalidated on every visit
//   public/hero/poster-1200.{avif,webp}  stable poster = the last frame
//   public/hero/v<k>-<hash>/<w>/*.bin    immutable, content-hashed: per set a
//        sparse first-pass segment (first.bin: every 16th frame plus 0 and
//        N-1) and contiguous segments of K frames; a segment is AVIF files back
//        to back, indexed [offset, length] per frame in the manifest
//
// Ten checks, each in its own try/catch so a gate that cannot run reports a FAIL
// carrying the exception instead of printing nothing (tasks/lessons.md).
//   HERO-MANIFEST-SCHEMA   the keys; version 3; N, px per frame, hold, the
//                          chapters and the features EQUAL hero/timeline.json and
//                          its sha1 is the manifest's digest; background
//                          #0a0a0a; chapter ids and the feature order primary,
//                          tip, lambda2, tertiary, neck; windows inside the tour,
//                          holds inside their windows, no overlap; the poster is
//                          the LAST frame; the sets are 1200 / 900 / 720 AVIF
//   HERO-MANIFEST-ANCHORS  N rows per feature, row shapes, [0,1], 0/1 flags,
//                          each feature visible for at least half its window and
//                          for EVERY frame of its hold, never under the page's
//                          edge fade (6 %, 18 % on the right), and the poster's
//                          five anchors visible
//                          and equal to the last frame's rows
//   HERO-STEPS             per-step flow and the blend gate: N-1 of each, flow
//                          finite and >= 0, blend 0/1, some steps blend and some
//                          do not, measured for this timeline
//   HERO-SEGMENTS          per set: the first-pass segment holds exactly every
//                          16th frame plus 0 and N-1; the contiguous segments
//                          cover 0..N-1 exactly once, in order, K frames each
//                          (the last may be short), one K for every set; every
//                          index runs from 0 without gaps to the file's length;
//                          a first-pass slice is byte-identical to its frame's
//                          contiguous slice; mean segment 0.5-1.5 MB
//   HERO-FILES             public/hero holds the manifest, the two posters and
//                          the one hashed directory, nothing else; the directory
//                          holds exactly the files the manifest names; the
//                          posters are this encode's (sha256 and bytes)
//   HERO-IMAGE-HEADERS     every slice parsed from its ISOBMFF boxes: brand
//                          avif (not an image sequence), boxes that sum to the
//                          slice's length (truncation), the set's own square
//                          size, three channels, no alpha; the AVIF poster the
//                          same at 1200; the WebP poster from its RIFF header
//   HERO-HASH              the directory name is v<timeline version>-<first 10
//                          hex of sha256(the set files in manifest order, then
//                          the manifest with "dir":"")>
//   HERO-BUDGET            each set's bytes on disk equal the manifest's and fit
//                          timeline.budget_bytes[<width>]; each poster fits
//                          budget_bytes.poster; no budget for a set that is not
//                          shipped
//   HERO-CACHE-HEADERS     vercel.json: every file of the hashed directory gets
//                          "public, max-age=31536000, immutable"; the manifest
//                          and the posters "public, max-age=0, must-revalidate"
//                          and never immutable; one Cache-Control rule each
//   HERO-PAGE-KEYS         every manifest feature has words in src/hero.ts;
//                          index.html has one block for every chapter src/hero.ts
//                          keys to (its chap("<id>") calls) and none it never
//                          shows; the <picture> holding #heroStill has the stable
//                          WebP poster in its <img> and exactly one <source>, the
//                          stable AVIF poster with no media (attributes read in
//                          any order)
//
// A manifest whose `source` says PLACEHOLDER honors the contract and passes
// locally, with a notice on every run. Under CI (process.env.CI, which GitHub
// Actions sets) it FAILS HERO-MANIFEST-SCHEMA, so a push to main or a PR cannot
// carry stand-ins toward a deploy; HERO_ALLOW_PLACEHOLDER=1 lets a feature-branch
// run through on purpose.
//
//   node scripts/verify-hero-manifest.mjs
//   HERO_VERIFY_ROOT=<a copy of the repo's files> node scripts/verify-hero-manifest.mjs   (planted-defect runs)
import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const ROOT = process.env.HERO_VERIFY_ROOT ? resolve(process.env.HERO_VERIFY_ROOT) : fileURLToPath(new URL("../", import.meta.url));
const HERO = join(ROOT, "public", "hero");
const at = p => join(ROOT, p);

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const block = (name, fn) => {
  try { fn(); } catch (e) { check(name, false, { threw: String(e).slice(0, 300) }); }
};

// THE CONTRACT (docs/HERO-DELIVERY.md). The frame counts, chapters and windows
// come from hero/timeline.json; what the page and the delivery depend on beyond
// it is fixed here.
const VERSION = 3;
const BACKGROUND = "#0a0a0a";
const CHAPTER_IDS = ["seed", "grow", "branch", "cool", "tour", "pullback"];
const FEATURE_ORDER = ["primary", "tip", "lambda2", "tertiary", "neck"];
const SETS = [{ width: 1200, format: "avif" }, { width: 900, format: "avif" }, { width: 720, format: "avif" }];
const FIRST_EVERY = 16;
const SEGMENT_MB = [0.5e6, 1.5e6];
// index.html's mask on the live frame: a 6 % fade at the left, top and bottom
// and 18 % at the right, the side the render's tour runs off (a mark on a
// faded arm would point at nothing)
const EDGE_FADE = { left: 0.06, right: 0.18, top: 0.06, bottom: 0.06 };
const POSTERS = [{ file: "poster-1200.avif", format: "avif", width: 1200 }, { file: "poster-1200.webp", format: "webp", width: 1200 }];
const STABLE = ["manifest.json", ...POSTERS.map(p => p.file)];
const KEYS = ["version", "dir", "frames", "timeline", "px_per_frame", "hold_px", "background", "chapters", "features",
  "anchors", "poster", "steps", "sets", "masters", "encoder", "source"];
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = buf => createHash("sha256").update(buf).digest("hex");

// ---- inputs ------------------------------------------------------------------
let m = null, manifestText = null, loadErr = null;
try { manifestText = readFileSync(join(HERO, "manifest.json"), "utf8"); m = JSON.parse(manifestText); }
catch (e) { loadErr = String(e).slice(0, 200); }
let tl = null, tlRaw = null, tlErr = null;
try { tlRaw = readFileSync(at("hero/timeline.json")); tl = JSON.parse(tlRaw.toString("utf8")); }
catch (e) { tlErr = String(e).slice(0, 200); }
const NAMES = ["HERO-MANIFEST-SCHEMA", "HERO-MANIFEST-ANCHORS", "HERO-STEPS", "HERO-SEGMENTS", "HERO-FILES",
  "HERO-IMAGE-HEADERS", "HERO-HASH", "HERO-BUDGET", "HERO-CACHE-HEADERS", "HERO-PAGE-KEYS"];
if (!m || !tl) {
  for (const n of NAMES)
    check(n, false, { manifest: m ? "loaded" : "public/hero/manifest.json did not load", timeline: tl ? "loaded" : "hero/timeline.json did not load", error: loadErr ?? tlErr });
  console.log(`done — ${failures} FAILED`);
  process.exit(1);
}
const N = tl.frames;
const sets = Array.isArray(m.sets) ? m.sets : [];
const dirPath = typeof m.dir === "string" && m.dir ? join(HERO, m.dir) : null;
const setFiles = s => [s?.first, ...(Array.isArray(s?.segments) ? s.segments : [])].filter(Boolean);
// one read of every set file, shared by the checks below (the sets are ~70 MB)
const fileCache = new Map();
const readSetFile = f => {
  const p = join(dirPath, f);
  if (!fileCache.has(p)) fileCache.set(p, existsSync(p) ? readFileSync(p) : null);
  return fileCache.get(p);
};
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
  if (m.version !== VERSION) bad.push({ version: m.version, want: VERSION });
  // the digest path_plan.py and render_sequence.py record: sha1 of the file's
  // bytes, defined over the LF file (a core.autocrlf checkout would change it)
  if (tlRaw.includes(Buffer.from("\r\n"))) bad.push({ timeline: "hero/timeline.json has CRLF line endings; the digest is defined over the LF file" });
  const tlSha = createHash("sha1").update(tlRaw).digest("hex");
  if (m.timeline?.sha1 !== tlSha) bad.push({ timelineSha1: m.timeline?.sha1, want: tlSha });
  if (m.timeline?.file !== "hero/timeline.json" || m.timeline?.version !== tl.version) bad.push({ timeline: m.timeline });
  if (!Number.isInteger(N) || N < 2 || m.frames !== N) bad.push({ frames: m.frames, timeline: N });
  if (m.px_per_frame !== tl.px_per_frame || m.hold_px !== tl.hold_px) bad.push({ px_per_frame: m.px_per_frame, hold_px: m.hold_px, timeline: [tl.px_per_frame, tl.hold_px] });
  if (m.background !== BACKGROUND) bad.push({ background: m.background, want: BACKGROUND });
  const tlCh = (tl.chapters ?? []).map(c => ({ id: c.id, from: c.from, to: c.to }));
  if (!same(m.chapters, tlCh)) bad.push({ chapters: m.chapters, timeline: tlCh });
  const ch = Array.isArray(m.chapters) ? m.chapters : [];
  if (!same(ch.map(c => c.id), CHAPTER_IDS)) bad.push({ chapterIds: ch.map(c => c.id), want: CHAPTER_IDS });
  const gaps = ch.filter((c, k) => c.from !== (k === 0 ? 0 : ch[k - 1].to + 1));
  if (!ch.length || gaps.length || ch.at(-1)?.to !== N - 1) bad.push({ chaptersNotContiguous: gaps.map(c => c.id) });
  const tlFe = (tl.features ?? []).map(f => ({ id: f.id, kind: f.kind, from: f.from, to: f.to, hold: f.hold, label: f.label }));
  if (!same(m.features, tlFe)) bad.push({ features: "differ from hero/timeline.json" });
  const fs = Array.isArray(m.features) ? m.features : [];
  if (!same(fs.map(f => f.id), FEATURE_ORDER)) bad.push({ featureOrder: fs.map(f => f.id), want: FEATURE_ORDER });
  const tour = ch.find(c => c.id === "tour");
  const outside = fs.filter(f => !tour || f.from < tour.from || f.to > tour.to).map(f => f.id);
  if (outside.length) bad.push({ featuresOutsideTour: outside });
  const overlap = fs.filter((f, k) => k > 0 && f.from <= fs[k - 1].to).map(f => f.id);
  if (overlap.length) bad.push({ featureWindowsOverlap: overlap });
  const badHold = fs.filter(f => !Array.isArray(f.hold) || !(f.from <= f.hold[0] && f.hold[0] <= f.hold[1] && f.hold[1] <= f.to)).map(f => f.id);
  if (badHold.length) bad.push({ holdOutsideWindow: badHold });
  const badLabel = fs.filter(f => f.label !== "left" && f.label !== "right").map(f => f.id);
  if (badLabel.length) bad.push({ labelSide: badLabel });
  // the last frame IS the poster: the pull-back lands on it and the hold rests on it
  if (m.poster?.frame !== N - 1 || tl.poster !== N - 1) bad.push({ posterFrame: m.poster?.frame, timelinePoster: tl.poster, want: N - 1 });
  if (!same(sets.map(s => ({ width: s.width, format: s.format })), SETS)) bad.push({ sets: sets.map(s => [s.width, s.format]), want: SETS.map(s => [s.width, s.format]) });
  const badQ = sets.filter(s => !Number.isInteger(s.quality) || s.quality < 1 || s.quality > 100 || s.type !== "image/avif").map(s => s.width);
  if (badQ.length) bad.push({ setQualityOrType: badQ });
  if (typeof m.source !== "string" || !m.source.startsWith("hero/")) bad.push({ source: m.source });
  if (placeholderBlocked) bad.push({ source: m.source, why: "PLACEHOLDER frames under CI" });
  check("HERO-MANIFEST-SCHEMA", bad.length === 0, { frames: m.frames, timelineSha1: tlSha.slice(0, 12), chapters: ch.length, features: fs.length, bad });
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
    if (!Array.isArray(rows) || rows.length !== N) { bad.push({ feature: f.id, rows: rows?.length, want: N }); continue; }
    const badRows = rows.map((r, i) => (rowOk(r, f.kind) ? -1 : i)).filter(i => i >= 0);
    if (badRows.length) bad.push({ feature: f.id, malformedRows: badRows.slice(0, 8), count: badRows.length });
    // LIVENESS: a callout hidden for most of its window is a callout the
    // visitor mostly does not see; and the hold is where the page rests on it
    const win = rows.slice(f.from, f.to + 1);
    const vis = win.filter(r => Array.isArray(r) && r.at(-1) === 1).length;
    const hold = Array.isArray(f.hold) ? rows.slice(f.hold[0], f.hold[1] + 1) : [];
    const holdHidden = hold.map((r, k) => (Array.isArray(r) && r.at(-1) === 1 ? -1 : f.hold[0] + k)).filter(i => i >= 0);
    // a visible in-window point inside the page's edge fade (transparent at the
    // edge, opaque at EDGE_FADE in from it) would have its unmasked dot
    // pointing at faded crystal: each side against its own fade
    const pts = win.filter(r => Array.isArray(r) && r.at(-1) === 1)
      .flatMap(r => { const o = []; for (let k = 0; k + 1 < r.length - 1; k += 2) o.push([r[k], r[k + 1]]); return o; });
    const margin = pts.length ? Math.min(...pts.map(([x, y]) => Math.min(x - EDGE_FADE.left, 1 - x - EDGE_FADE.right, y - EDGE_FADE.top, 1 - y - EDGE_FADE.bottom))) : null;
    perFeature[f.id] = { visibleInWindow: `${vis}/${win.length}`, visibleInHold: `${hold.length - holdHidden.length}/${hold.length}`,
      clearOfEdgeFade: margin === null ? null : +margin.toFixed(4) };
    if (vis * 2 < win.length) bad.push({ feature: f.id, visibleInWindow: `${vis}/${win.length}` });
    if (!hold.length || holdHidden.length) bad.push({ feature: f.id, hiddenInHold: holdHidden.slice(0, 8) });
    if (margin !== null && margin < 0) bad.push({ feature: f.id, anchorInEdgeFade: +margin.toFixed(4), fade: EDGE_FADE });
  }
  const pa = m.poster?.anchors ?? {};
  if (!same(Object.keys(pa).sort(), [...ids].sort())) bad.push({ posterAnchorKeys: Object.keys(pa) });
  for (const f of feats) {
    const r = pa[f.id];
    if (!rowOk(r, f.kind)) bad.push({ posterAnchor: f.id, row: r });
    else if (r.at(-1) !== 1) bad.push({ posterAnchor: f.id, why: "reduced motion shows all five callouts on the poster, so all five must be visible there" });
    else if (!same(r, m.anchors?.[f.id]?.[N - 1])) bad.push({ posterAnchor: f.id, row: r, lastFrameRow: m.anchors?.[f.id]?.[N - 1] ?? null });
  }
  check("HERO-MANIFEST-ANCHORS", bad.length === 0 && feats.length === FEATURE_ORDER.length, { perFeature, bad });
});

// 3. HERO-STEPS
block("HERO-STEPS", () => {
  const bad = [];
  const st = m.steps ?? {};
  const flow = st.flow_p90, blend = st.blend;
  if (!Array.isArray(flow) || flow.length !== N - 1) bad.push({ flowSteps: flow?.length, want: N - 1 });
  else {
    const off = flow.map((v, i) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? -1 : i)).filter(i => i >= 0);
    if (off.length) bad.push({ flowNotFiniteOrNegative: off.slice(0, 8) });
  }
  let nBlend = 0;
  if (!Array.isArray(blend) || blend.length !== N - 1) bad.push({ blendSteps: blend?.length, want: N - 1 });
  else {
    const off = blend.map((v, i) => (v === 0 || v === 1 ? -1 : i)).filter(i => i >= 0);
    if (off.length) bad.push({ blendNot01: off.slice(0, 8) });
    nBlend = blend.filter(v => v === 1).length;
    // liveness: a gate that blends every step, or none, is not a gate
    if (!(nBlend > 0 && nBlend < N - 1)) bad.push({ blendCount: nBlend, want: `between 1 and ${N - 2}` });
  }
  if (st.source?.timeline_sha1 !== m.timeline?.sha1) bad.push({ measuredForTimeline: st.source?.timeline_sha1, manifestTimeline: m.timeline?.sha1 });
  if (typeof st.rule !== "string" || !st.rule.length) bad.push({ rule: st.rule });
  const blendFlow = Array.isArray(flow) && Array.isArray(blend) ? flow.filter((_, i) => blend[i] === 1) : [];
  check("HERO-STEPS", bad.length === 0, { steps: flow?.length, blend: nBlend, maxFlowBlended: blendFlow.length ? Math.max(...blendFlow) : null, bad });
});

// 4. HERO-SEGMENTS
const firstWant = [...new Set([...Array.from({ length: Math.ceil(N / FIRST_EVERY) }, (_, k) => k * FIRST_EVERY), 0, N - 1])].sort((a, b) => a - b);
block("HERO-SEGMENTS", () => {
  const bad = [];
  const report = {};
  const Ks = new Set();
  for (const s of sets) {
    const w = s.width;
    const segs = Array.isArray(s.segments) ? s.segments : [];
    const K = s.segment_frames;
    Ks.add(K);
    if (!Number.isInteger(K) || K < 2) { bad.push({ set: w, segment_frames: K }); continue; }
    if (!same(s.first?.frames, firstWant)) bad.push({ set: w, firstFrames: s.first?.frames?.slice(0, 6), count: s.first?.frames?.length, want: `every ${FIRST_EVERY}th plus 0 and ${N - 1} (${firstWant.length} frames)` });
    const cover = segs.flatMap(g => (Array.isArray(g.frames) ? g.frames : []));
    if (!same(cover, Array.from({ length: N }, (_, i) => i))) {
      const seen = new Map();
      for (const i of cover) seen.set(i, (seen.get(i) ?? 0) + 1);
      bad.push({ set: w, coverage: "contiguous segments must cover 0..N-1 exactly once, in order",
        missing: Array.from({ length: N }, (_, i) => i).filter(i => !seen.has(i)).slice(0, 8),
        twice: [...seen].filter(([, c]) => c > 1).map(([i]) => i).slice(0, 8), outOfOrder: cover.some((v, k) => k && v <= cover[k - 1]) });
    }
    segs.forEach((g, k) => {
      const fr = g.frames ?? [];
      const last = k === segs.length - 1;
      if (!(last ? fr.length >= 1 && fr.length <= K : fr.length === K)) bad.push({ set: w, segment: g.file, frames: fr.length, K });
    });
    const full = [];
    for (const g of setFiles(s)) {
      const idx = Array.isArray(g.index) ? g.index : [];
      if (idx.length !== (g.frames?.length ?? -1)) { bad.push({ set: w, file: g.file, indexEntries: idx.length, frames: g.frames?.length }); continue; }
      let off = 0, ok = true;
      for (const e of idx) {
        if (!Array.isArray(e) || e[0] !== off || !Number.isInteger(e[1]) || e[1] <= 0) { ok = false; break; }
        off += e[1];
      }
      if (!ok) { bad.push({ set: w, file: g.file, index: "offsets must start at 0 and run without gaps, lengths > 0" }); continue; }
      const buf = dirPath ? readSetFile(g.file) : null;
      if (!buf) { bad.push({ set: w, file: g.file, why: "missing" }); continue; }
      if (off !== buf.length || g.bytes !== buf.length) bad.push({ set: w, file: g.file, indexEnd: off, manifestBytes: g.bytes, fileBytes: buf.length });
      if (g !== s.first && g.frames.length === K) full.push(buf.length);
    }
    // the first pass is a copy of frames the contiguous segments also hold:
    // the same encode, byte for byte, or the page would show two pictures
    const slice = (g, k) => { const b = readSetFile(g.file); const [o, l] = g.index[k]; return b ? b.subarray(o, o + l) : null; };
    const where = new Map();
    segs.forEach(g => (g.frames ?? []).forEach((i, k) => where.set(i, [g, k])));
    const differ = [];
    (s.first?.frames ?? []).forEach((i, k) => {
      const hit = where.get(i);
      try { if (!hit || !slice(s.first, k)?.equals(slice(...hit))) differ.push(i); } catch { differ.push(i); }
    });
    if (differ.length) bad.push({ set: w, firstPassDiffersFromSegments: differ.slice(0, 8) });
    const mean = full.length ? full.reduce((a, b) => a + b, 0) / full.length : 0;
    if (!(mean >= SEGMENT_MB[0] && mean <= SEGMENT_MB[1])) bad.push({ set: w, meanSegmentMB: +(mean / 1e6).toFixed(3), want: "0.5-1.5" });
    report[w] = { K, segments: segs.length, meanSegmentMB: +(mean / 1e6).toFixed(3), firstPassFrames: s.first?.frames?.length };
  }
  if (Ks.size !== 1) bad.push({ segmentFrames: [...Ks], why: "one K for every set, so a set switch maps frames to the same segments" });
  check("HERO-SEGMENTS", bad.length === 0 && sets.length === SETS.length, { ...report, bad: bad.slice(0, 10), badCount: bad.length });
});

// 5. HERO-FILES
const listTree = (dir, pre = "") => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? listTree(join(dir, e.name), `${pre}${e.name}/`) : [`${pre}${e.name}`]);
block("HERO-FILES", () => {
  const bad = [];
  const top = existsSync(HERO) ? readdirSync(HERO) : [];
  const wantTop = [...STABLE, m.dir];
  const strays = top.filter(f => !wantTop.includes(f));
  const absent = wantTop.filter(f => !top.includes(f));
  if (strays.length) bad.push({ strayInPublicHero: strays });
  if (absent.length) bad.push({ missingInPublicHero: absent });
  if (dirPath && existsSync(dirPath) && statSync(dirPath).isDirectory()) {
    const have = listTree(dirPath);
    const want = sets.flatMap(s => setFiles(s).map(g => g.file));
    const extra = have.filter(f => !want.includes(f)), missing = want.filter(f => !have.includes(f));
    if (extra.length) bad.push({ strayInDir: extra.slice(0, 8), count: extra.length });
    if (missing.length) bad.push({ missingInDir: missing.slice(0, 8), count: missing.length });
    if (new Set(want).size !== want.length) bad.push({ fileNamedTwice: want.filter((f, k) => want.indexOf(f) !== k) });
  } else bad.push({ dir: m.dir, why: "not a directory in public/hero" });
  const pf = Array.isArray(m.poster?.files) ? m.poster.files : [];
  if (!same(pf.map(p => [p.file, p.format]), POSTERS.map(p => [p.file, p.format]))) bad.push({ posterFiles: pf.map(p => p.file), want: POSTERS.map(p => p.file) });
  for (const p of pf) {
    const path = join(HERO, String(p.file));
    if (!existsSync(path)) continue;   // reported above
    const buf = readFileSync(path);
    // the stable poster must be THIS encode's last frame, not a leftover
    if (buf.length !== p.bytes || sha256(buf) !== p.sha256) bad.push({ poster: p.file, bytes: buf.length, manifestBytes: p.bytes, why: "not the poster this manifest was encoded with" });
  }
  check("HERO-FILES", bad.length === 0, { dir: m.dir, top, bad });
});

// 6. HERO-IMAGE-HEADERS
// AVIF (ISOBMFF), read by hand: top-level boxes (32-bit size + type, a 64-bit
// size when the size is 1, "to the end" when 0) must tile the slice exactly;
// ftyp's major brand "avif" ("avis" is an image sequence); inside meta (a full
// box) iprp > ipco: ispe (width, height), pixi (channels), auxC (an alpha
// plane names urn:mpeg:mpegB:cicp:systems:auxiliary:alpha); an mdat.
function boxes(buf, start, end) {
  const out = [];
  let off = start;
  while (off < end) {
    if (off + 8 > end) return { err: `a box header runs past the end at ${off}` };
    let size = buf.readUInt32BE(off), hdr = 8;
    const type = buf.toString("latin1", off + 4, off + 8);
    if (size === 1) { if (off + 16 > end) return { err: "a 64-bit box size runs past the end" }; size = Number(buf.readBigUInt64BE(off + 8)); hdr = 16; }
    else if (size === 0) size = end - off;
    if (size < hdr || off + size > end) return { err: `box "${type}" at ${off} runs past the end (truncated?)` };
    out.push({ type, start: off + hdr, end: off + size });
    off += size;
  }
  return { list: out };
}
function avif(buf) {
  const top = boxes(buf, 0, buf.length);
  if (top.err) return { err: top.err };
  const ftyp = top.list[0];
  if (!ftyp || ftyp.type !== "ftyp") return { err: "no ftyp box first" };
  const major = buf.toString("latin1", ftyp.start, ftyp.start + 4);
  const brands = [];
  for (let o = ftyp.start + 8; o + 4 <= ftyp.end; o += 4) brands.push(buf.toString("latin1", o, o + 4));
  const meta = top.list.find(b => b.type === "meta");
  if (!meta) return { err: "no meta box" };
  const mb = boxes(buf, meta.start + 4, meta.end);
  if (mb.err) return { err: mb.err };
  const iprp = mb.list.find(b => b.type === "iprp");
  const ipco = iprp ? boxes(buf, iprp.start, iprp.end).list?.find(b => b.type === "ipco") : null;
  if (!ipco) return { err: "no iprp/ipco" };
  const props = boxes(buf, ipco.start, ipco.end);
  if (props.err) return { err: props.err };
  const ispe = props.list.filter(b => b.type === "ispe").map(b => [buf.readUInt32BE(b.start + 4), buf.readUInt32BE(b.start + 8)]);
  const pixi = props.list.filter(b => b.type === "pixi").map(b => buf[b.start + 4]);
  const aux = props.list.filter(b => b.type === "auxC").map(b => buf.toString("latin1", b.start + 4, b.end).replace(/\0.*$/s, ""));
  return { major, brands, ispe, pixi, alpha: aux.some(u => /auxiliary:alpha|auxid:1/.test(u)), mdat: top.list.some(b => b.type === "mdat") };
}
function avifWhy(a, w) {
  if (a.err) return [a.err];
  const why = [];
  if (a.major !== "avif" || a.brands.includes("avis")) why.push(`brand ${a.major} [${a.brands.join(",")}], expected avif (a still image)`);
  if (!a.ispe.length || a.ispe.some(([x, y]) => x !== w || y !== w)) why.push(`ispe ${JSON.stringify(a.ispe)}, expected ${w}x${w}`);
  if (a.pixi.length && a.pixi.some(c => c !== 3)) why.push(`${a.pixi} channels, expected 3`);
  if (a.alpha) why.push("has an alpha plane; the frames are opaque on #0a0a0a");
  if (!a.mdat) why.push("no mdat (no image data)");
  return why;
}
// WebP (the poster's <img> fallback): the RIFF container and the three
// bitstream headers (VP8 lossy, VP8L lossless, VP8X extended), as v1's gate read them
function webp(buf) {
  if (buf.length < 30 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP")
    return { err: "not a RIFF/WEBP file" };
  const lengthOk = buf.readUInt32LE(4) + 8 === buf.length;
  const fourcc = buf.toString("latin1", 12, 16);
  if (fourcc === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return { err: "VP8 start code missing" };
    return { fourcc, lengthOk, w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, alpha: false, anim: false, key: (buf[20] & 1) === 0 };
  }
  if (fourcc === "VP8L") {
    if (buf[20] !== 0x2f) return { err: "VP8L signature missing" };
    const b = buf.readUInt32LE(21);
    return { fourcc, lengthOk, w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1, alpha: ((b >>> 28) & 1) === 1, anim: false, key: true };
  }
  if (fourcc === "VP8X") {
    const flags = buf[20];
    return { fourcc, lengthOk, w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1, alpha: (flags & 0x10) !== 0, anim: (flags & 0x02) !== 0, key: true };
  }
  return { err: `unknown first chunk "${fourcc}"` };
}
block("HERO-IMAGE-HEADERS", () => {
  const bad = [];
  let parsed = 0, expected = 0;
  for (const s of sets) {
    for (const g of setFiles(s)) {
      const buf = dirPath ? readSetFile(g.file) : null;
      const idx = Array.isArray(g.index) ? g.index : [];
      expected += idx.length;
      if (!buf) continue;   // HERO-FILES / HERO-SEGMENTS report absences
      idx.forEach(([o, l], k) => {
        if (!(o >= 0 && l > 0 && o + l <= buf.length)) { bad.push({ file: g.file, frame: g.frames?.[k], why: "slice outside the file" }); return; }
        const why = avifWhy(avif(buf.subarray(o, o + l)), s.width);
        if (why.length) bad.push({ file: g.file, frame: g.frames?.[k], why });
        else parsed++;
      });
    }
  }
  for (const p of POSTERS) {
    const path = join(HERO, p.file);
    expected++;
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    if (p.format === "avif") {
      const why = avifWhy(avif(buf), p.width);
      if (why.length) bad.push({ file: p.file, why }); else parsed++;
    } else {
      const w = webp(buf);
      const why = w.err ? [w.err] : [];
      if (!w.err) {
        if (!w.lengthOk) why.push("RIFF length disagrees with the file length (truncated?)");
        if (w.w !== p.width || w.h !== p.width) why.push(`${w.w}x${w.h}, expected ${p.width}x${p.width}`);
        if (w.alpha) why.push("has alpha; the poster is opaque on #0a0a0a");
        if (w.anim) why.push("animated");
        if (!w.key) why.push("VP8 frame is not a key frame");
      }
      if (why.length) bad.push({ file: p.file, why }); else parsed++;
    }
  }
  check("HERO-IMAGE-HEADERS", bad.length === 0 && parsed === expected && expected > POSTERS.length,
    { parsed, expected, bad: bad.slice(0, 10), badCount: bad.length });
});

// 7. HERO-HASH
block("HERO-HASH", () => {
  const bad = [];
  const re = new RegExp(`^v${tl.version}-([0-9a-f]{10})$`);
  const mm = typeof m.dir === "string" ? m.dir.match(re) : null;
  if (!mm) bad.push({ dir: m.dir, want: `v${tl.version}-<10 hex>` });
  const tag = `"dir":"${m.dir}"`;
  const parts = manifestText.split(tag);
  if (parts.length !== 2) bad.push({ manifest: `must name its dir exactly once as ${tag}`, found: parts.length - 1 });
  let hex = null;
  if (!bad.length) {
    const h = createHash("sha256");
    let missing = 0;
    for (const s of sets) for (const g of setFiles(s)) { const b = readSetFile(g.file); if (b) h.update(b); else missing++; }
    h.update(Buffer.from(parts.join('"dir":""'), "utf8"));
    hex = h.digest("hex");
    if (missing) bad.push({ missingFiles: missing });
    if (hex.slice(0, 10) !== mm[1]) bad.push({ dir: m.dir, contentHash: hex.slice(0, 10), why: "the directory name is not its content's hash" });
  }
  check("HERO-HASH", bad.length === 0, { dir: m.dir, sha256: hex?.slice(0, 16), bad });
});

// 8. HERO-BUDGET
block("HERO-BUDGET", () => {
  const bad = [];
  const report = {};
  const budget = tl.budget_bytes ?? {};
  const wantKeys = [...SETS.map(s => String(s.width)), "poster"].sort();
  if (!same(Object.keys(budget).sort(), wantKeys)) bad.push({ budgetKeys: Object.keys(budget), want: wantKeys, why: "one budget per shipped set and one for a poster" });
  for (const s of sets) {
    let total = 0;
    for (const g of setFiles(s)) total += dirPath ? (readSetFile(g.file)?.length ?? 0) : 0;
    const b = budget[String(s.width)];
    report[s.width] = `${(total / 1048576).toFixed(2)} MiB of ${Number.isFinite(b) ? (b / 1048576).toFixed(2) : "?"}`;
    if (!(total > 0)) bad.push({ set: s.width, why: "no bytes counted" });
    if (total !== s.bytes) bad.push({ set: s.width, onDisk: total, manifest: s.bytes });
    if (!Number.isFinite(b) || total > b) bad.push({ set: s.width, total, budget: b ?? null });
  }
  for (const p of POSTERS) {
    const n = statSync(join(HERO, p.file), { throwIfNoEntry: false })?.size ?? 0;
    report[p.file] = `${(n / 1024).toFixed(0)} KiB`;
    if (!(n > 0) || !Number.isFinite(budget.poster) || n > budget.poster) bad.push({ poster: p.file, bytes: n, budget: budget.poster ?? null });
  }
  check("HERO-BUDGET", bad.length === 0, { ...report, bad });
});

// 9. HERO-CACHE-HEADERS
// vercel.json `headers[].source` is a path-to-regexp pattern (Vercel docs,
// project-configuration/vercel-json). This reads the subset the file uses:
// literal text, ":name", ":name(regex)" and the modifiers ? * + after a "/"
// prefix, matched case-insensitively with an optional trailing "/" (the
// library's defaults). Anything else fails the check rather than being guessed.
function compileSource(src) {
  let re = "^", i = 0;
  const lit = c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  while (i < src.length) {
    let prefix = "";
    if (src[i] === "/" && src[i + 1] === ":") { prefix = "/"; i++; }
    if (src[i] === ":") {
      const name = src.slice(i + 1).match(/^\w+/)?.[0];
      if (!name) throw new Error(`bad parameter at ${i} in ${src}`);
      i += 1 + name.length;
      let pat = "[^\\/#\\?]+?";
      if (src[i] === "(") {
        let depth = 0, j = i;
        for (; j < src.length; j++) {
          if (src[j] === "\\") { j++; continue; }
          if (src[j] === "(") { if (depth++ && src[j + 1] !== "?") throw new Error(`capturing group inside a parameter in ${src}`); }
          else if (src[j] === ")" && --depth === 0) break;
        }
        if (depth) throw new Error(`unbalanced ( in ${src}`);
        pat = src.slice(i + 1, j);
        i = j + 1;
      }
      const mod = "?*+".includes(src[i] ?? "") ? src[i++] : "";
      const p = prefix ? "\\/" : "";
      if (mod === "*" || mod === "+") re += `(?:${p}((?:${pat})(?:${p}(?:${pat}))*))${mod === "*" ? "?" : ""}`;
      else re += `(?:${p}(${pat}))${mod}`;
      continue;
    }
    if ("(){}*+?".includes(src[i])) throw new Error(`unsupported "${src[i]}" at ${i} in ${src}`);
    re += lit(src[i++]);
  }
  return new RegExp(re + "[\\/#\\?]?$", "i");
}
block("HERO-CACHE-HEADERS", () => {
  const bad = [];
  const path = at("vercel.json");
  if (!existsSync(path)) { check("HERO-CACHE-HEADERS", false, { vercelJson: "missing: the hashed directory would get Vercel's default max-age=0" }); return; }
  const vj = JSON.parse(readFileSync(path, "utf8"));
  const rules = (Array.isArray(vj.headers) ? vj.headers : []).map(r => ({ source: r.source, re: compileSource(String(r.source)), headers: r.headers ?? [], cond: !!(r.has || r.missing) }));
  const cacheControl = p => {
    const hits = rules.filter(r => r.re.test(p) && r.headers.some(h => String(h.key).toLowerCase() === "cache-control"));
    const v = hits.length ? hits.at(-1).headers.filter(h => String(h.key).toLowerCase() === "cache-control").at(-1).value : null;
    return { value: v, rules: hits.map(r => r.source), conditional: hits.some(r => r.cond) };
  };
  const probes = [];
  for (const s of sets) for (const g of setFiles(s)) probes.push({ path: `/hero/${m.dir}/${g.file}`, want: IMMUTABLE });
  for (const f of STABLE) probes.push({ path: `/hero/${f}`, want: REVALIDATE });
  const seen = {};
  for (const p of probes) {
    const cc = cacheControl(p.path);
    seen[p.want === IMMUTABLE ? "immutable" : p.path] = cc.value;
    if (cc.value !== p.want || cc.rules.length !== 1 || cc.conditional)
      bad.push({ path: p.path, cacheControl: cc.value, want: p.want, rules: cc.rules, conditional: cc.conditional || undefined });
    if (p.want === REVALIDATE && /immutable/i.test(cc.value ?? "")) bad.push({ path: p.path, why: "the stable files must be revalidated, never immutable" });
  }
  check("HERO-CACHE-HEADERS", bad.length === 0 && probes.length > STABLE.length, { probes: probes.length, seen, bad: bad.slice(0, 8), badCount: bad.length });
});

// 10. HERO-PAGE-KEYS
// The page is keyed to the manifest by id in two places, and a renamed id on
// either side would silently drop a callout or leave a chapter with no text.
block("HERO-PAGE-KEYS", () => {
  const bad = [];
  const heroTs = readFileSync(at("src/hero.ts"), "utf8");
  const copyBlock = heroTs.match(/const COPY[^=]*=\s*\{([\s\S]*?)\n\};/);
  const copyIds = copyBlock ? [...copyBlock[1].matchAll(/^\s*(\w+):\s*\{\s*title:/gm)].map(x => x[1]) : [];
  const ids = (m.features ?? []).map(f => f.id);
  const noWords = ids.filter(id => !copyIds.includes(id));
  const orphanWords = copyIds.filter(id => !ids.includes(id));
  if (!copyIds.length) bad.push({ copy: "COPY table not found in src/hero.ts" });
  if (noWords.length) bad.push({ featuresWithNoCopy: noWords });
  if (orphanWords.length) bad.push({ copyWithNoFeature: orphanWords });
  const html = readFileSync(at("index.html"), "utf8");
  // a tag's attributes, whatever their order
  const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(x => [x[1].toLowerCase(), x[2]]));
  const tags = (src, name) => [...src.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(x => attrs(x[0]));
  // the chapter blocks in index.html (`chap` as one class among any others,
  // never part of a longer class name) against the chapters src/hero.ts keys
  // its text to (every chap("<id>", ...) call): one block for each, and no
  // block the page never shows
  const blocks = [...html.matchAll(/<div\b[^>]*>/g)].map(x => attrs(x[0]))
    .filter(a => /(^|\s)chap(\s|$)/.test(a.class ?? "") && a["data-chap"]).map(a => a["data-chap"]);
  const keyed = [...new Set([...heroTs.matchAll(/\bchap\(\s*"([\w-]+)"/g)].map(x => x[1]))];
  if (!keyed.length) bad.push({ chapterKeys: "no chap(\"<id>\", ...) call found in src/hero.ts" });
  const missing = keyed.filter(id => !blocks.includes(id)), unkeyed = blocks.filter(id => !keyed.includes(id));
  if (missing.length) bad.push({ chapterBlocksMissing: missing });
  if (unkeyed.length) bad.push({ chapterBlocksNeverShown: unkeyed });
  if (new Set(blocks).size !== blocks.length) bad.push({ chapterBlockTwice: blocks.filter((b, k) => blocks.indexOf(b) !== k) });
  // No JS and the still: the <picture> that holds #heroStill. Its <img> is the
  // stable WebP poster every browser decodes (revalidated, so index.html never
  // changes per encode), and it has exactly ONE <source>: the stable AVIF
  // poster, for every screen (no media query that could send a phone to
  // another file)
  const picture = [...html.matchAll(/<picture\b[^>]*>([\s\S]*?)<\/picture>/gi)].map(x => x[1]).find(p => /id\s*=\s*"heroStill"/.test(p)) ?? null;
  const img = picture ? tags(picture, "img").find(a => a.id === "heroStill") : null;
  const sources = picture ? tags(picture, "source") : [];
  const posterSrc = img?.src ?? null;
  if (!picture) bad.push({ picture: "no <picture> holds #heroStill" });
  if (posterSrc !== "hero/poster-1200.webp") bad.push({ noJsPoster: posterSrc, want: "hero/poster-1200.webp" });
  const sourceOk = sources.length === 1 && sources[0].type === "image/avif" && sources[0].srcset === "hero/poster-1200.avif"
    && !("media" in sources[0]) && !("sizes" in sources[0]);
  if (!sourceOk) bad.push({ sources, want: [{ type: "image/avif", srcset: "hero/poster-1200.avif" }] });
  check("HERO-PAGE-KEYS", bad.length === 0, { copyIds, chapterKeys: keyed, chapterBlocks: blocks, noJsPoster: posterSrc, sources, bad });
});

console.log(failures ? `done — ${failures} FAILED` : "done — all hero manifest checks passed");
if (failures) process.exitCode = 1;
