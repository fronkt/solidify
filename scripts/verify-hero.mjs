// HERO-* (browser) — the landing hero driven the way a visitor drives it: by
// scrolling. puppeteer-core against the vite server (port 5199 unless given),
// like the rest of the suite; run by scripts/run-tests.mjs.
//
// navigator.gpu is taken away on every page this script opens. The hero must
// not depend on WebGPU (landing.ts boots it above the GPU gate), and with no
// GPU the lens and materials sims stay off, so nothing here competes with them.
//
// The expectations are the gate's OWN: hero/timeline.json and
// public/hero/manifest.json are read from disk here, and the contract numbers
// (the spring's rate, the set rule, the cache cap, the skip point) are written
// below from docs/HERO-DELIVERY.md and the A5 plan, not read off the page.
//
// Eighteen checks, each in its own try/catch so an exception reports as a FAIL:
//   HERO-BOOT           live mode with no WebGPU, the "heroAct" pin, its length
//                       (N - 1) x px per frame + the hold from the timeline file,
//                       the page's manifest the one on disk and made for this
//                       timeline (sha1), only the first-pass segment fetched until
//                       the first scroll and then every segment of the picked set
//                       once and nothing of another set, the set by the rule, the
//                       backing store CSS x min(DPR, 2); on a throttled phone
//                       link frame 0 drawn after the first pass's first bytes
//                       and well before its last (the segment read as a stream)
//   HERO-NONBLANK       canvas pixels differ from #0a0a0a at pin progress 0, 0.5
//                       and 0.95
//   HERO-FRAME-FOLLOWS  scrolling (forward through all six chapters and the hold,
//                       then back) lands the drawn frame on the playhead at rest,
//                       and the canvas PIXELS are that frame's: the gate slices
//                       the segment itself, decodes and compares, with a frame six
//                       away as the control
//   HERO-CALLOUTS       the tour's spec rail: inside a feature's window its row
//                       is the one lit row (--fg, the rest --fg-3) and its mark
//                       is shown at its manifest anchor mapped through the
//                       canvas's drawn rect, with a leader from the mark to the
//                       row's left edge, the row in the copy column right of
//                       the frame; outside the window the row is unlit and the
//                       mark hidden; where the anchor is occluded (the
//                       manifest's own flags, and one flag the gate flips in the
//                       page) the mark and leader are hidden and the row stays
//                       lit; in the hold nothing is lit or shown
//   HERO-CHAPTERS       each chapter's text is on screen in its chapter and only
//                       there, the rail only in the tour, with the copy as
//                       written (and the retracted wording banned: "locked in",
//                       "one grain of the metal", the cool chapter's coarsening
//                       the render does not show; no prose em dash, no British
//                       spelling), revealed by opacity and translate only: never
//                       split into lines, never blurred, and a real fade rather
//                       than a cut; the whole pin walked frame by frame: at most
//                       one block in the column at a time, and the cool chapter
//                       never while the render still grows (growth "stops" is
//                       banned: the render stops, not the metal); before the
//                       landing module runs no heading shows and the end link
//                       EXISTS and is not hit-testable; with the manifest held
//                       back the column is already right
//   HERO-CTA            the opening's links reachable at the top (hit-tested, not
//                       just visible) and unreachable once faded, the end's CTA
//                       reachable in the hold, and ONE filled pill on screen at
//                       every stop: the header's "Open the instrument"
//   HERO-CAPTION        the caption present, linked, directly under the render
//                       and hit-testable at progress 0, 0.5 and 0.95
//   HERO-REDUCED        prefers-reduced-motion: no pin, the poster (the AVIF
//                       <source>, the WebP <img>), all five marks at the poster's
//                       anchors numbered like their rows, no two numbers on each
//                       other, each by its own mark; the chapter text stacked
//   HERO-NOJS           JavaScript off: the 1200 poster <picture> with alt
//   HERO-MOBILE         390 x 844 @3: the 720 set, no rendered text or link past
//                       either edge of the screen at any stop of the pin or in the
//                       still, frame centered with the copy under it, every
//                       feature's row lit and shown in its window with its line in
//                       the slot under the rail and that slot visible, titles only
//                       in the rows, nothing shown below the screen, the still's
//                       numbers apart; turned sideways after it loaded live, the
//                       still (as loaded sideways), at the hero's top
//   HERO-FIT            the live column at 1024 x 768 and 1366 x 657: the
//                       opening, the rail at every tour stop and the end
//                       chapter inside the column beside the frame, on screen;
//                       844 x 390 (a phone sideways) gets the unpinned still
//                       with both opening links reachable; at 320 x 640 the
//                       fixed header's children stay on screen
//   HERO-FALLBACK       the still the comments promise, served broken six ways,
//                       and a seventh, transient, that it rides out:
//                       no manifest (the poster alone), segments missing in every
//                       set (the still with its five labels and nothing of live
//                       mode left behind), the picked set missing (live on the next
//                       set, its pixels checked), a manifest for another timeline
//                       and one with another N (the still, no segment fetched),
//                       and no AVIF decoder (the still, no segment fetched); the
//                       first pass and one segment answered 503 once (both tried
//                       again: live on the picked set, every frame, none failed)
//   HERO-FLING          a scripted 3,000 px/s fling and a single 100 px wheel step:
//                       every step of the playhead is the critically damped
//                       spring's (w = 15/s, dt from rAF clamped to 1/30 s, no speed
//                       cap) replayed on the page's own targets; p95 |frame -
//                       target| within the spring's own free-running response;
//                       the canvas never blank
//   HERO-SETPICK        a viewport x DPR matrix -> the set (the rule and the
//                       delivery table), the backing store CSS x min(DPR, 2); a
//                       DPR change and a window resize trade up with no blank
//                       frame, and never back down; a browser zoom (125 %, 150 %)
//                       keeps the set the settled canvas needs; two trade-ups in
//                       a row with the middle set's files held back: never blank
//   HERO-BLEND          a slow scroll through blend and cut steps: alpha > 0 only
//                       on steps the manifest marks, drawn as i + 1 over i at the
//                       playhead's own fraction while moving, and the canvas that
//                       composite (copies taken mid-blend against the gate's own,
//                       the lower frame alone as the control); at rest between two
//                       frames, alpha exactly 0 after an ease of about 150 ms, and
//                       the canvas a real frame's pixels
//   HERO-CACHE          through a full scroll down and back on the 1200 set, the
//                       decoded bitmaps the gate counts itself (createImageBitmap
//                       and close() wrapped) stay at most 48 and 300 MB, and the
//                       page's own count is honest; where the skip link lands the
//                       frames are let go (at most 1 held) and, with the segments
//                       slow, none is requested once the picture has left
//   HERO-SKIP           "Skip to the instrument": hidden (and not hit-testable)
//                       before 1,000 px of the pin, shown after through the last
//                       frame, hidden once the end chapter arrives; in the
//                       caption's style beside it; stacked (390, 768) on the copy
//                       column's left edge with the caption, 20 px above the
//                       column; reached by Tab from the top and shown on focus;
//                       Enter lands past the hero; absent in the still
//   HERO-NO-ERRORS      no page error, console error or failed same-origin
//                       request on any page this script opened, except the
//                       failures HERO-FALLBACK and HERO-SETPICK cause on purpose
//
//   node scripts/verify-hero.mjs [outDir] [port]
//   HERO_ONLY=HERO-FLING,HERO-BLEND HERO_ONLY_OK=1 node scripts/verify-hero.mjs . 5314
//     (HERO-BOOT, HERO-NO-ERRORS and the named checks only; an unknown name
//     fails, and without HERO_ONLY_OK=1 a partial run exits 1)
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const PORT = process.argv[3] ?? "5199";
const BASE = `http://localhost:${PORT}/`;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// HERO_ONLY runs a subset (HERO-BOOT and HERO-NO-ERRORS always run). It fails
// CLOSED: a name that is not a check stops the run, and a partial run exits
// non-zero unless HERO_ONLY_OK=1 says the subset is on purpose, so a stale
// HERO_ONLY in a shell cannot pass the suite with checks skipped
// (scripts/run-tests.mjs also drops it from the gate's environment).
const CHECKS = ["HERO-BOOT", "HERO-NONBLANK", "HERO-FRAME-FOLLOWS", "HERO-CALLOUTS", "HERO-CHAPTERS", "HERO-CTA", "HERO-CAPTION",
  "HERO-REDUCED", "HERO-NOJS", "HERO-MOBILE", "HERO-FIT", "HERO-FALLBACK", "HERO-FLING", "HERO-SETPICK", "HERO-BLEND", "HERO-CACHE",
  "HERO-SKIP", "HERO-NO-ERRORS"];
const ONLY = process.env.HERO_ONLY ? new Set(process.env.HERO_ONLY.split(",").map(s => s.trim()).filter(Boolean)) : null;
if (ONLY) {
  const unknown = [...ONLY].filter(n => !CHECKS.includes(n));
  if (unknown.length) {
    console.log("HERO-ONLY FAIL", JSON.stringify({ unknown, checks: CHECKS }));
    process.exit(1);
  }
  console.log(`NOTICE: HERO_ONLY: HERO-BOOT, HERO-NO-ERRORS and ${[...ONLY].join(", ")} only`);
}
const ran = new Set();

// ---- the contract, read and written here ---------------------------------------
const TL_RAW = readFileSync(new URL("../hero/timeline.json", import.meta.url));
const TL = JSON.parse(TL_RAW.toString("utf8"));
const TL_SHA1 = createHash("sha1").update(TL_RAW.toString("utf8").replace(/\r\n/g, "\n")).digest("hex");
const M = JSON.parse(readFileSync(new URL("../public/hero/manifest.json", import.meta.url), "utf8"));
const N = TL.frames, PPF = TL.px_per_frame, FRAME_PX = (N - 1) * PPF, HOLD_PX = TL.hold_px, TOTAL_PX = FRAME_PX + HOLD_PX;
const CH = Object.fromEntries(TL.chapters.map(c => [c.id, c]));
const BLEND = M.steps.blend;
// the spring (A5 plan): a = w^2 (X - x) - 2 w v, w about 15/s, dt from rAF
// timestamps clamped to 1/30 s, settled inside 0.2 px and 2 px/s
const W = 15, DT_MAX = 1 / 30, SETTLE_PX = 0.2, SETTLE_V = 2;
// the set pick (docs/HERO-DELIVERY.md): need = CSS width x min(DPR, 2), the
// smallest set at least 0.9 x need, else the largest
const DPR_CAP = 2, SLACK = 0.9;
const SET_WIDTHS = M.sets.map(s => s.width).sort((a, b) => a - b);
const ruleFor = (cssW, dpr) => SET_WIDTHS.find(w => w >= SLACK * cssW * Math.min(dpr, DPR_CAP)) ?? SET_WIDTHS.at(-1);
// the decoded cache: at most 48 bitmaps, at most about 300 MB at 1200
const MAX_BITMAPS = 48, CACHE_BYTES = 300e6;
const SKIP_AT = 1000;
const BG = [10, 10, 10];
// the copy as written; the page is checked against these, not against itself
const COPY = {
  primary: ["PRIMARY ARM ⟨100⟩", "Grows along a cube axis of the crystal."],
  tip: ["TIP", "A paraboloid, rounded by surface tension."],
  lambda2: ["SECONDARY ARM SPACING λ₂", "Finer spacing usually means a stronger casting."],
  tertiary: ["TERTIARY ARM", "A branch on a branch."],
  // the render shows no waist to point at (hero/README.md: 0.915 of the
  // section above): the line is about a real casting, not "here"
  neck: ["NECKED ROOT", "In a real casting side arms thin where they join, and some melt off."],
};
const CHAPTER_COPY = {
  grow: ["It grows in branches.", "A metal crystal freezing out of its melt does not stay a ball. It sends arms out along the directions its lattice prefers."],
  branch: ["Arms grow on arms.", "Side arms sprout along each main arm, and smaller arms branch off the side arms, all along the same cube axes."],
  cool: ["Then it cools.", "The render stops growing here. In a real casting the arms keep thickening and coarsening while melt remains."],
  pullback: ["One seed, one crystal.", "Every arm grew from the first speck, and all of them share one lattice."],
  end: ["Grow your own.", "The instrument solves the phase-field equations on your GPU. Change the melt and the branches change."],
};
const CHAPTER_IDS = Object.keys(CHAPTER_COPY);
// Retracted: the arms keep coarsening while the crystal cools, so its shape is
// not "locked in" (v8 D1); "one grain of the metal" is false for steel; the
// v4 render shows no coarsening in the cool chapter (A3 left it out), so the
// copy may neither show it happening nor say the shape freezes (A5); and
// cooling does not stop growth (while melt remains, cooling is what drives
// it): the render stops, not the metal (A5 review).
const RETRACTED = [/locked in/i, /one grain of the metal/i, /melt back and thick ones grow/i, /coarsens as it cools/i,
  /shape (is |stays )?(frozen|fixed|set)\b/i, /growth stops/i, /stops growing as it cools/i];
const ALT_BANNED = /steel/i;
// docs/COPY-STYLE.md, as verify-landing-acts.mjs reads it
const BRITISH = /aluminium|vapour|vaporis|modelled|labelled|colour|behaviour|favour|sulphur|centre|\bgrey|mould|programme|artefact|polaris|analys(?:e|ing)\b/i;
const CAPTION = ["Rendered model, not a simulation frame.", "https://github.com/fronkt/solidify/blob/main/hero/README.md"];
// DESIGN.md section 2: the lit rail row in --fg, the rest in --fg-3; a filled
// pill is an --fg background
const FG = "rgb(242, 242, 242)", FG3 = "rgb(138, 138, 138)";

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const block = async (name, fn) => {
  if (ONLY && name !== "HERO-BOOT" && name !== "HERO-NO-ERRORS" && !ONLY.has(name)) return;
  ran.add(name);
  try { await fn(); } catch (e) { check(name, false, { threw: String(e).split("\n")[0].slice(0, 220) }); }
};
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r3 = v => Math.round(v * 1000) / 1000;
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] : NaN; };

// ---------------------------------------------------------------- harness
// A visitor's tab is in the foreground. Headless, Chrome treats its renderers
// as backgrounded and lowers their priority (on Windows 11 that includes
// EcoQoS), which roughly doubles AVIF decode latency here: the three flags keep
// the renderer at a foreground tab's priority, so HERO-FLING measures the
// page, not the backgrounding.
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--hide-scrollbars", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
});

/** `missing`: same-origin URLs answered with a 404 on purpose; `expect`: URLs
 *  whose 404s and aborted requests are that purpose and not an error;
 *  `respond`: [re, body] served in place of a URL; `init`: a function run in
 *  every document before its scripts; `noWait`: return once navigation has
 *  started (page.nav is its promise); `failOnce`: { re, seen: new Set() },
 *  the first request of each matching URL answered 503 (a transient failure);
 *  `setup`: run on the page before it navigates (network throttling).
 *  page.bins lists every frame segment requested, in order. */
async function open(tag, viewport, { reduced = false, js = true, missing = null, expect = null, delay = null, respond = null,
  init = null, waitUntil = "networkidle0", noWait = false, failOnce = null, setup = null } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  if (setup) await setup(page);
  if (!js) await page.setJavaScriptEnabled(false);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(Navigator.prototype, "gpu", { configurable: true, get() { return undefined; } });
  });
  if (init) await page.evaluateOnNewDocument(init);
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const expected = u => !!expect && expect.test(u);
  page.bins = [];
  // the page counter is third-party and says so on the console; stub it
  await page.setRequestInterception(true);
  page.on("request", r => {
    const u = r.url();
    if (u.includes("gc.zgo.at")) return r.respond({ status: 200, contentType: "application/javascript", body: "" });
    if (u.startsWith(BASE) && /\.bin$/.test(u)) page.bins.push(u.slice(BASE.length));
    if (missing && u.startsWith(BASE) && missing.test(u)) return r.respond({ status: 404, contentType: "text/plain", body: "gone on purpose" });
    // a transient failure: the first request of each matching URL answered 503
    if (failOnce && u.startsWith(BASE) && failOnce.re.test(u) && !failOnce.seen.has(u)) {
      failOnce.seen.add(u);
      return r.respond({ status: 503, contentType: "text/plain", body: "busy on purpose" });
    }
    if (respond && respond[0].test(u)) return r.respond({ status: 200, contentType: "application/json", body: respond[1] });
    if (delay && delay.re.test(u)) return void setTimeout(() => r.continue().catch(() => {}), delay.ms);
    return r.continue();
  });
  page.on("pageerror", e => errors.push(`${tag}: pageerror ${e.message}`));
  page.on("console", msg => {
    if (msg.type() === "error" && !expected(msg.location()?.url ?? "")) errors.push(`${tag}: console.error ${msg.text()}`);
  });
  page.on("requestfailed", r => { if (r.url().startsWith(BASE) && !expected(r.url())) errors.push(`${tag}: requestfailed ${r.url()}`); });
  page.on("response", r => { if (r.url().startsWith(BASE) && r.status() >= 400 && !expected(r.url())) errors.push(`${tag}: HTTP ${r.status()} ${r.url()}`); });
  const nav = page.goto(BASE, { waitUntil, timeout: 30000 });
  if (noWait) { page.nav = nav; return page; }
  await nav;
  return page;
}

/** The hero fetches only its first-pass segment until the visitor moves; a
 *  one-pixel scroll is that move. Then every frame of the set in use. */
const loaded = async page => {
  await page.evaluate(() => window.scrollBy(0, 1));
  await page.waitForFunction(n => window.__hero?.manifest && window.__hero.loaded >= n, { timeout: 30000 }, N);
};

/** the canvas's CSS width, the DPR, and the set the gate's own rule gives */
const ruleOf = page => page.evaluate(() => {
  const cv = document.getElementById("heroCanvas");
  return { set: window.__hero.set, css: cv.getBoundingClientRect().width, cssH: cv.getBoundingClientRect().height, dpr: devicePixelRatio,
    backing: [cv.width, cv.height] };
}).then(r => ({ ...r, rule: ruleFor(r.css, r.dpr), want: [Math.round(r.css * Math.min(r.dpr, DPR_CAP)), Math.round(r.cssH * Math.min(r.dpr, DPR_CAP))] }));

/** scroll to px of pin travel and wait until the page has SEEN the scroll, the
 *  spring has settled on it, the rest ease is over and the frame the playhead
 *  asks for is drawn */
async function goPx(page, px) {
  const want = await page.evaluate(px => {
    const st = window.__hero.st;
    const y = Math.round(st.start + px);
    window.scrollTo(0, y);
    return y - st.start;
  }, px);
  await page.waitForFunction((want, total) => {
    const h = window.__hero;
    const w = Math.min(total, Math.max(0, want));
    return Math.abs(h.st.progress - w / total) < 1e-3 && Math.abs(h.pTarget * total - w) < 0.5 && h.rest
      && Math.abs(h.p * total - w) < 0.5 && h.frame === Math.round(h.target) && h.over === -1;
  }, { timeout: 10000 }, want, TOTAL_PX);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
const pxOfFrame = f => f * PPF;

/** the independent mapping: anchor (0..1 frame coords) -> viewport px, through
 *  the element's box with object-fit: contain of a square frame */
const mapper = rect => {
  const s = Math.min(rect.width, rect.height);
  const x0 = rect.left + (rect.width - s) / 2, y0 = rect.top + (rect.height - s) / 2;
  return ([x, y]) => [x0 + x * s, y0 + y * s];
};
const pairsOf = row => { const o = []; for (let k = 0; k + 1 < row.length - 1; k += 2) o.push([row[k], row[k + 1]]); return o; };
const near = (a, b, tol = 1.5) => !!a && !!b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const visAt = (id, f) => M.anchors[id][f].at(-1) === 1;
/** the visible frame nearest a feature window's middle */
const midVisible = feat => {
  const mid = (feat.from + feat.to) / 2;
  return range(feat.from, feat.to).filter(x => visAt(feat.id, x)).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
};
const midOf = id => Math.round((CH[id].from + CH[id].to) / 2);

/** everything the callout gates read, in one round trip */
const readCallouts = page => page.evaluate(() => {
  const sec = document.getElementById("heroAct").getBoundingClientRect();
  const cv = document.getElementById("heroCanvas");
  const cvr = (getComputedStyle(cv).display === "none" ? document.getElementById("heroStill") : cv).getBoundingClientRect();
  const out = {};
  for (const el of document.querySelectorAll(".callout")) {
    const id = el.dataset.f;
    const cs = getComputedStyle(el);
    const g = document.querySelector(`#heroMarks g.mark[data-f="${id}"]`);
    const svg = document.getElementById("heroMarks").getBoundingClientRect();
    const dots = [...g.querySelectorAll("circle.dot")].filter(d => d.style.display !== "none")
      .map(d => [svg.left + +d.getAttribute("cx"), svg.top + +d.getAttribute("cy")]);
    const path = (g.querySelector("path.shape").getAttribute("d") || "").match(/-?[\d.]+/g)?.map(Number) ?? [];
    const pathPts = [];
    for (let k = 0; k + 1 < path.length; k += 2) pathPts.push([svg.left + path[k], svg.top + path[k + 1]]);
    const r = el.getBoundingClientRect();
    const line = el.querySelector(".coLine");
    const leader = (g.querySelector("polyline.leader")?.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean)
      .map(p => p.split(",").map(Number)).map(([x, y]) => [svg.left + x, svg.top + y]);
    const num = g.querySelector("text.num");
    out[id] = {
      opacity: +cs.opacity, visibility: cs.visibility, gOpacity: +getComputedStyle(g).opacity,
      gVisibility: getComputedStyle(g).visibility,
      on: el.classList.contains("is-on"), titleColor: getComputedStyle(el.querySelector(".coTitle")).color,
      idx: el.querySelector(".coIdx")?.textContent,
      title: el.querySelector(".coTitle")?.textContent, line: line?.textContent,
      lineShown: !!line && getComputedStyle(line).display !== "none",
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height },
      dots, pathPts, leader,
      num: num ? { text: num.textContent, shown: num.style.display !== "none" && getComputedStyle(num).display !== "none",
        rect: (({ left, top, right, bottom }) => ({ left, top, right, bottom }))(num.getBoundingClientRect()) } : null,
    };
  }
  const note = document.querySelector(".railNote");
  const tour = document.querySelector(".heroTour");
  return { out, canvas: { left: cvr.left, top: cvr.top, width: cvr.width, height: cvr.height, right: cvr.right, bottom: cvr.bottom },
    section: { left: sec.left, top: sec.top }, vw: innerWidth, vh: innerHeight,
    note: note && getComputedStyle(note).display !== "none" ? note.textContent : null,
    tourShown: !!tour && getComputedStyle(tour).visibility === "visible" && +getComputedStyle(tour).opacity > 0.99,
    calloutEls: document.querySelectorAll(".callout").length, markEls: document.querySelectorAll("#heroMarks g.mark").length };
});

/** each row and mark on the manifest's poster anchors, shown, with its copy,
 *  and the mark numbered like its row (the still: five marks, no leaders) */
const stillLabels = co => {
  const map = mapper(co.canvas);
  return M.features.map((f, k) => {
    const id = f.id, [title, line] = COPY[id];
    const c = co.out[id];
    const want = pairsOf(M.poster.anchors[id]).map(map);
    const onAnchor = !!c && (id === "primary" ? near(c.dots[0], want[0]) && c.pathPts.some(p => near(p, want[1]))
      : want.every((w, k) => near(c.dots[k], w)));
    const n = String(k + 1).padStart(2, "0");
    // the number sits by its own mark: its box within 40 px of an anchor point
    const r = c?.num?.rect;
    const gap = r ? Math.min(...want.map(([x, y]) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)))) : Infinity;
    return { id, shown: !!c && c.opacity > 0.99 && c.visibility === "visible" && c.gVisibility === "visible",
      words: !!c && c.title === title && c.line === line, lineShown: !!c && c.lineShown, onAnchor,
      numbered: !!c && c.idx === n && !!c.num && c.num.shown && c.num.text === n && gap <= 40, numGap: +gap.toFixed(1) };
  });
};
/** DESIGN.md section 5: no label on another. The shown marks' number boxes,
 *  pairwise: every pair that intersects. */
const numOverlaps = co => {
  const nums = Object.entries(co.out).filter(([, c]) => c.num?.shown && c.gVisibility === "visible").map(([id, c]) => [id, c.num.rect]);
  const bad = [];
  for (let a = 0; a < nums.length; a++) for (let b = a + 1; b < nums.length; b++) {
    const [p, q] = [nums[a][1], nums[b][1]];
    if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) bad.push([nums[a][0], nums[b][0]]);
  }
  return { numbers: nums.length, overlapping: bad };
};

/** where frame f sits in set `width`: its contiguous segment and byte slice */
const sliceOf = (width, f) => {
  const set = M.sets.find(s => s.width === width);
  const seg = set.segments.find(s => s.frames.includes(f));
  const k = seg.frames.indexOf(f);
  return { url: `hero/${M.dir}/${seg.file}`, off: seg.index[k][0], len: seg.index[k][1], type: set.type };
};

/** The canvas against a frame the gate slices out of its segment, decodes and
 *  draws itself the way the page does, and against a control frame: mean
 *  absolute difference per channel over every 2nd pixel of the region where
 *  either the expected or the control picture has crystal. A whole-canvas
 *  mean would divide every difference by the background's share, which is
 *  almost all of a seed frame, so the control could not tell a nucleus from
 *  its neighbor. */
const pixels = (page, f, g, width) => page.evaluate(async (sf, sg, bg) => {
  const h = window.__hero;
  const c = document.getElementById("heroCanvas");
  const live = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const draw = async s => {
    const buf = await (await fetch(s.url)).arrayBuffer();
    const bmp = await createImageBitmap(new Blob([new Uint8Array(buf, s.off, s.len)], { type: s.type }));
    const oc = new OffscreenCanvas(c.width, c.height);
    const x = oc.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.fillStyle = `rgb(${bg.join(",")})`; x.fillRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / bmp.width, c.height / bmp.height);
    x.drawImage(bmp, (c.width - bmp.width * k) / 2, (c.height - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    bmp.close();
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const exp = await draw(sf), ctl = await draw(sg);
  const W = c.width, H = c.height;
  const lit = (d, k) => Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    if (lit(exp, k) || lit(ctl, k)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const base = { drawn: h.frame, over: h.over, alpha: h.blendAlpha, target: h.target, set: h.set };
  if (x1 < 0) return { ...base, same: null, control: null, region: 0 };
  const mad = d => {
    let s = 0, n = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      const k = (y * W + x) * 4;
      s += Math.abs(d[k] - live[k]) + Math.abs(d[k + 1] - live[k + 1]) + Math.abs(d[k + 2] - live[k + 2]); n += 3;
    }
    return s / n;
  };
  return { ...base, same: +mad(exp).toFixed(3), control: +mad(ctl).toFixed(3), region: +(((x1 - x0 + 1) * (y1 - y0 + 1)) / (W * H)).toFixed(3) };
}, sliceOf(width, f), sliceOf(width, g), BG);
// a match is the same browser's decode and draw on both sides, so near
// bit-identical in practice; 0.1 leaves room for nothing else, and the
// control has to clear both a floor and three times the match
const pixelsOk = (r, f) => r.drawn === f && Math.round(r.target) === f && r.over === -1 && r.alpha === 0 && r.same !== null
  && r.same < 0.1 && r.control > Math.max(0.5, 3 * r.same);

/** is the link reachable at its own center (a visibility check cannot see paint order) */
const hit = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return { exists: false };
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { exists: true, reachable: !!at && (at === el || el.contains(at)), text: el.textContent.trim(), href: el.getAttribute("href"),
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, vw: innerWidth, vh: innerHeight, opacity: +getComputedStyle(el).opacity };
}, sel);

/** Every rendered piece of hero text and every link on screen, measured
 *  directly: the section clips its own overflow (#heroAct is overflow: hidden)
 *  and #topnav is fixed, so neither ever reaches the document's scrollWidth.
 *  An element counts when it is visible, has a box and an effective opacity
 *  above 0.01; both its box and its text's own extent must sit on screen. */
const leafOverflow = page => page.evaluate(() => {
  const SEL = "#heroOpen *, .chap .kicker, .chapHead, .chapBody, .chapSide .cta a, .heroTour .kicker, .callout, .railNote, .heroCaption, .heroSkip, #topnav .hdr__mark, #topnav a, #topnav summary";
  const eff = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const bad = [];
  let leaves = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (getComputedStyle(el).visibility !== "visible" || el.getClientRects().length === 0 || eff(el) <= 0.01) continue;
    leaves++;
    const rects = [el.getBoundingClientRect()];
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const tr = rg.getBoundingClientRect();
    if (tr.width > 0) rects.push(tr);
    const q = rects.find(r => r.left < -0.5 || r.right > innerWidth + 0.5);
    if (q) bad.push({ el: el.id || String(el.className?.baseVal ?? el.className) || el.tagName, text: (el.textContent || "").trim().slice(0, 30), left: +q.left.toFixed(1), right: +q.right.toFixed(1) });
  }
  return { leaves, bad: bad.slice(0, 6), badCount: bad.length, vw: innerWidth };
});

/** Records every animation frame from now on: the hook's state (the tick it
 *  last ran and what it read) and how much of a 64 x 64 copy of the canvas is
 *  crystal. stopRec returns the rows. `capture`: also keep full copies of the
 *  canvas on up to that many ticks mid-blend (alpha between 0.3 and 0.7, a
 *  different lower frame each), in window.__caps, for blendPixels. */
const startRec = (page, capture = 0) => page.evaluate((bg, capture) => {
  const cv = document.getElementById("heroCanvas");
  const oc = new OffscreenCanvas(64, 64);
  const x = oc.getContext("2d", { willReadFrequently: true });
  const rec = window.__rec = { on: true, rows: [] };
  window.__caps = [];
  const loop = () => {
    if (!rec.on) return;
    const h = window.__hero;
    // the hook and the canvas are the last tick's, together: a callback runs whole
    if (window.__caps.length < capture && h.over >= 0 && h.blendAlpha > 0.3 && h.blendAlpha < 0.7
      && !window.__caps.some(c => c.frame === h.frame))
      window.__caps.push({ frame: h.frame, over: h.over, alpha: h.blendAlpha, set: h.set, w: cv.width, h: cv.height,
        data: cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data });
    x.fillStyle = "#000"; x.fillRect(0, 0, 64, 64);
    x.drawImage(cv, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    let lit = 0;
    for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24) lit++;
    const T = h.framePx + h.holdPx;
    rec.rows.push({ now: performance.now(), tick: h.tick, t: h.t, dt: h.dt, px: h.p * T, pxT: h.pTarget * T, x: h.frameFloat, X: h.target,
      v: h.velocity, frame: h.frame, over: h.over, alpha: h.blendAlpha, rest: h.rest, set: h.set, lit, cw: cv.width,
      dec: h.decodedCount, bytes: h.cacheBytes, bmp: window.__bmp ? { ...window.__bmp } : null });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}, BG, capture);
const stopRec = page => page.evaluate(() => { window.__rec.on = false; return window.__rec.rows; });
/** Each canvas copy startRec kept mid-blend against the gate's own composite:
 *  the lower frame sliced from its segment, decoded and drawn the way the page
 *  draws it, the upper one over it at the alpha the page reported; and against
 *  the lower frame alone as the control. Mean absolute difference per channel
 *  over every 2nd pixel of the region where either frame has crystal. */
const blendPixels = page => page.evaluate(async (bg, slices) => {
  const out = [];
  for (const cap of window.__caps) {
    const bmpOf = async s => { const buf = await (await fetch(s.url)).arrayBuffer(); return createImageBitmap(new Blob([new Uint8Array(buf, s.off, s.len)], { type: s.type })); };
    const sl = slices[`${cap.set}/${cap.frame}`], so = slices[`${cap.set}/${cap.over}`];
    if (!sl || !so) { out.push({ frame: cap.frame, why: "no slice" }); continue; }
    const [lo, up] = [await bmpOf(sl), await bmpOf(so)];
    const draw = withOver => {
      const oc = new OffscreenCanvas(cap.w, cap.h);
      const x = oc.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.fillStyle = `rgb(${bg.join(",")})`; x.fillRect(0, 0, cap.w, cap.h);
      const put = b => { const k = Math.min(cap.w / b.width, cap.h / b.height); x.drawImage(b, (cap.w - b.width * k) / 2, (cap.h - b.height * k) / 2, b.width * k, b.height * k); };
      put(lo);
      if (withOver) { x.globalAlpha = cap.alpha; put(up); x.globalAlpha = 1; }
      return x.getImageData(0, 0, cap.w, cap.h).data;
    };
    const exp = draw(true), ctl = draw(false), live = cap.data, W = cap.w, H = cap.h;
    lo.close(); up.close();
    const lit = (d, k) => Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      if (lit(exp, k) || lit(ctl, k)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // the mean difference, and the share of samples more than 4 levels off:
    // once Chrome has moved a canvas read back more than twice off the GPU,
    // its alpha blend rounds differently from the gate's by up to 2 levels
    // (measured: max 2, mean 0.16), which a wrong alpha or a missing layer
    // exceeds everywhere the two frames differ
    const mad = d => { let s = 0, n = 0, far = 0; for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { const k = (y * W + x) * 4;
      for (let j = 0; j < 3; j++) { const v = Math.abs(d[k + j] - live[k + j]); s += v; if (v > 4) far++; } n += 3; } return n ? [s / n, far / n] : [NaN, NaN]; };
    const [same, far] = mad(exp), [control, farCtl] = mad(ctl);
    out.push({ frame: cap.frame, over: cap.over, alpha: cap.alpha, same: +same.toFixed(3), far: +far.toFixed(5), control: +control.toFixed(3), farControl: +farCtl.toFixed(4) });
  }
  return out;
}, BG, Object.fromEntries(M.sets.flatMap(s => range(0, N - 1).map(f => [`${s.width}/${f}`, sliceOf(s.width, f)]))));
/** scrolls the page at a steady speed from one pin position to another, one
 *  step per animation frame */
const drive = (page, a, b, pxPerS) => page.evaluate((a, b, s) => new Promise(res => {
  const st = window.__hero.st;
  const t0 = performance.now(), dur = (Math.abs(b - a) / s) * 1000;
  const f = now => {
    const u = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, Math.round(st.start + a + (b - a) * u));
    if (u < 1) requestAnimationFrame(f); else res();
  };
  requestAnimationFrame(f);
}), a, b, pxPerS);
const waitRest = page => page.waitForFunction(() => window.__hero.rest, { timeout: 10000 });
/** one row per page tick, in order */
const perTick = rows => { const out = []; for (const r of rows) if (!out.length || r.tick !== out.at(-1).tick) out.push(r); return out; };
/** the critically damped spring's exact step, and its settle snap */
const springStep = (px, v, pxT, dt) => {
  const e0 = px - pxT, c2 = v + W * e0, ex = Math.exp(-W * dt);
  let p = pxT + (e0 + c2 * dt) * ex, u = (c2 - W * (e0 + c2 * dt)) * ex;
  if (Math.abs(p - pxT) < SETTLE_PX && Math.abs(u) < SETTLE_V) { p = pxT; u = 0; }
  return [p, u];
};
/** The page's ticks against the spring: each step replayed from the page's
 *  own previous state and target (deviation in px); the dt each tick took
 *  against its rAF timestamps; and a free run of the ideal spring on the same
 *  targets from the first tick's state, whose lag is the reference. */
function springAudit(ticks) {
  let maxDev = 0, maxDevV = 0, dtBad = 0, pairs = 0, restarts = 0;
  let ip = ticks[0].px, iv = ticks[0].v * PPF;
  const lagPage = [], lagIdeal = [], lagDrawn = [];
  for (let k = 1; k < ticks.length; k++) {
    const a = ticks[k - 1], b = ticks[k];
    if (b.tick !== a.tick + 1) { ip = b.px; iv = b.v * PPF; continue; }
    pairs++;
    if (b.dt === 0) restarts++;
    else if (Math.abs(b.dt - Math.min(DT_MAX, Math.max(0, (b.t - a.t) / 1000))) > 1e-9) dtBad++;
    const [p, u] = springStep(a.px, a.v * PPF, b.pxT, b.dt);
    // inside the frame range the px the hook reports is unclamped; a speed
    // cap shows in the velocity first
    if (b.pxT > 0 && b.pxT < FRAME_PX && a.px > 0 && a.px < FRAME_PX) {
      maxDev = Math.max(maxDev, Math.abs(p - b.px));
      maxDevV = Math.max(maxDevV, Math.abs(u - b.v * PPF));
    }
    [ip, iv] = b.dt > 0 ? springStep(ip, iv, b.pxT, b.dt) : [ip, iv];
    lagIdeal.push(Math.abs(b.pxT - ip) / PPF);
    lagPage.push(Math.abs(b.X - b.x));
    lagDrawn.push(Math.abs(b.X - b.frame));
  }
  return { pairs, restarts, dtBad, maxDevPx: r3(maxDev), maxDevPxPerS: r3(maxDevV), p95Page: r3(pct(lagPage, 0.95)), p95Ideal: r3(pct(lagIdeal, 0.95)),
    p95Drawn: r3(pct(lagDrawn, 0.95)),
    maxPage: r3(Math.max(...lagPage)), maxIdeal: r3(Math.max(...lagIdeal)) };
}

// ------------------------------------------------------------- the live page
// the desktop page times every decode itself (HERO-FLING's allowance)
const desk = await open("desktop", { width: 1440, height: 900, deviceScaleFactor: 1 }, { init: () => {
  const orig = window.createImageBitmap.bind(window);
  window.__decodeMs = [];
  window.createImageBitmap = (...a) => {
    const t0 = performance.now();
    return orig(...a).then(b => { if (window.__decodeMs.length < 5000) window.__decodeMs.push(performance.now() - t0); return b; });
  };
} });
let SIZE = 0;

await block("HERO-BOOT", async () => {
  // before the visitor moves: the first-pass segment and nothing more,
  // measured after the network has gone quiet and stayed quiet
  await desk.waitForFunction(() => window.__hero?.manifest && window.__hero.set > 0 && window.__hero.frame >= 0, { timeout: 15000 });
  await sleep(700);
  const r = await ruleOf(desk);
  const set = M.sets.find(s => s.width === r.rule);
  const before = { bins: [...desk.bins], loaded: await desk.evaluate(() => window.__hero.loaded) };
  await loaded(desk);
  await sleep(300);
  const s = await desk.evaluate(() => {
    const h = window.__hero;
    return {
      gpu: typeof navigator.gpu, mode: h.mode, id: h.st?.vars?.id, pin: !!h.st?.vars?.pin,
      len: h.st ? Math.round(h.st.end - h.st.start) : null, spacer: document.getElementById("heroAct").parentElement.classList.contains("pin-spacer"),
      loaded: h.loaded, failed: h.failed, framePx: h.framePx, holdPx: h.holdPx, pxPerFrame: h.pxPerFrame, set: h.set,
      dir: h.manifest.dir, sha1: h.manifest.timeline.sha1, frames: h.manifest.frames,
    };
  });
  SIZE = s.set;
  const firstOnly = before.bins.length === 1 && before.bins[0] === `hero/${M.dir}/${set.first.file}` && before.loaded === new Set(set.first.frames).size;
  const after = desk.bins.slice(before.bins.length);
  const want = set.segments.map(g => `hero/${M.dir}/${g.file}`);
  const everyOnce = after.length === want.length && want.every(u => after.filter(a => a === u).length === 1);
  const ok = s.gpu === "undefined" && s.mode === "live" && s.id === "heroAct" && s.pin && s.spacer
    && s.len === TOTAL_PX && s.framePx === FRAME_PX && s.holdPx === HOLD_PX && s.pxPerFrame === PPF
    && s.dir === M.dir && s.sha1 === TL_SHA1 && M.timeline.sha1 === TL_SHA1 && s.frames === N
    && s.loaded === N && s.failed.length === 0 && firstOnly && everyOnce
    && r.set === r.rule && r.backing[0] === r.want[0] && r.backing[1] === r.want[1];
  // FRAME 0 BEFORE THE FIRST PASS HAS ARRIVED: on a phone's link (9 Mbit/s,
  // 40 ms) the 720 first pass takes about a second, and its first slice is
  // frame 0 (about a kilobyte). The page reads the segment as a stream and
  // draws frame 0 from its own bytes (docs/HERO-DELIVERY.md): the first draw
  // comes after the first pass's first bytes and well before its last.
  const slow = await open("boot-slow", { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, {
    waitUntil: "domcontentloaded",
    setup: async page => {
      const cdp = await page.createCDPSession();
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
    },
    init: () => {
      window.__firstDraw = null;
      const poll = () => {
        const h = window.__hero;
        if (h && h.frame >= 0) window.__firstDraw = { t: performance.now(), frame: h.frame };
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    } });
  await slow.waitForFunction(() => window.__firstDraw !== null, { timeout: 30000 });
  await slow.waitForFunction(() => performance.getEntriesByType("resource").some(e => /\/first\.bin$/.test(e.name)), { timeout: 30000 });
  const stream = await slow.evaluate(() => {
    const e = performance.getEntriesByType("resource").find(x => /\/first\.bin$/.test(x.name));
    return { firstDraw: Math.round(window.__firstDraw.t), frame: window.__firstDraw.frame, file: e.name.split("/").slice(-2).join("/"),
      responseStart: Math.round(e.responseStart), responseEnd: Math.round(e.responseEnd), set: window.__hero.set };
  });
  // (closed once quiet: a request cut off by the close would count as an error)
  await slow.waitForNetworkIdle({ idleTime: 500, timeout: 60000 }).catch(() => {});
  await slow.close();
  const streamOk = stream.frame === 0 && stream.file === `${stream.set}/first.bin` && stream.responseEnd - stream.responseStart >= 500
    && stream.firstDraw >= stream.responseStart && stream.firstDraw <= stream.responseEnd - 250;
  check("HERO-BOOT", ok && streamOk, { ...s, pinWant: TOTAL_PX, beforeScroll: before, firstOnly, afterScroll: after.length, segmentsWant: want.length, everyOnce,
    set: r, stream: { ...stream, ok: streamOk } });
});

await block("HERO-NONBLANK", async () => {
  const rows = [];
  for (const p of [0, 0.5, 0.95]) {
    await goPx(desk, p * TOTAL_PX);
    const r = await desk.evaluate((bg) => {
      const c = document.getElementById("heroCanvas");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24) n++;
      return { frame: window.__hero.frame, lit: n, total: d.length / 4 };
    }, BG);
    // progress 0 is the seed: a small nucleus, so only a handful of pixels;
    // past it the crystal covers a real share of the frame
    const need = p === 0 ? 12 : 0.01 * r.total;
    rows.push({ p, ...r, need: Math.round(need), ok: r.lit >= need });
  }
  check("HERO-NONBLANK", rows.every(r => r.ok), rows);
});

await block("HERO-FRAME-FOLLOWS", async () => {
  const rows = [];
  // forward through all six chapters (the middle of each) and the last frame,
  // then BACK: a playhead that only advances would pass a forward-only walk.
  // Each stop names its control, six frames away.
  const stops = ["seed", "grow", "branch", "cool", "tour", "pullback"].map(id => [midOf(id), midOf(id) - 6]);
  for (const [f, g] of [...stops, [N - 1, N - 7], [60, 54]]) {
    await goPx(desk, pxOfFrame(f));
    const r = await pixels(desk, f, g, SIZE);
    rows.push({ want: f, controlFrame: g, ...r, ok: pixelsOk(r, f) });
  }
  check("HERO-FRAME-FOLLOWS", rows.every(r => r.ok), rows);
});

await block("HERO-CALLOUTS", async () => {
  const rows = [];
  for (const feat of M.features) {
    const id = feat.id;
    const inWin = range(feat.from, feat.to);
    const f = midVisible(feat);
    await goPx(desk, pxOfFrame(f));
    const s = await readCallouts(desk);
    const c = s.out[id];
    const map = mapper(s.canvas);
    const want = pairsOf(M.anchors[id][f]).map(map);
    // pair marks: primary has a dot at the root and its arrow shaft ends on the
    // tip-side point; lambda2 has a dot on each root
    const onAnchor = feat.kind === "point" ? near(c.dots[0], want[0])
      : id === "primary" ? near(c.dots[0], want[0]) && c.pathPts.some(p => near(p, want[1]))
      : c.dots.length === 2 && near(c.dots[0], want[0]) && near(c.dots[1], want[1]);
    // alone: no other row lit and no other mark on screen
    const others = Object.entries(s.out).filter(([k, v]) => k !== id && (v.on || v.gOpacity > 0.01 || v.gVisibility === "visible")).map(([k]) => k);
    // lit in --fg, every other row in --fg-3 (the rail is a spec rail, not a
    // list of equals)
    const tones = { lit: c.titleColor, dim: Object.entries(s.out).filter(([k]) => k !== id).map(([, v]) => v.titleColor) };
    const tone = tones.lit === FG && tones.dim.length === 4 && tones.dim.every(t => t === FG3);
    // the row sits in the copy column, right of the frame: the canvas IS the
    // frame square in live mode, so this also keeps it off every crystal pixel
    const beside = c.rect.left >= s.canvas.right;
    // the leader runs from the mark to the row: its last point just short of
    // the row's left edge and level with the row
    const end = c.leader.at(-1);
    const leader = c.leader.length >= 2 && !!end && end[0] <= c.rect.left && end[0] >= c.rect.left - 24
      && end[1] >= c.rect.top && end[1] <= c.rect.bottom;
    const inView = c.rect.left >= 0 && c.rect.right <= s.vw && c.rect.top >= 0 && c.rect.bottom <= s.vh;
    const shown = c.on && c.gOpacity > 0.99 && c.gVisibility === "visible" && s.tourShown;
    // numbered in the manifest's order, with its copy as written
    const words = c.title === COPY[id][0] && c.line === COPY[id][1] && c.lineShown
      && c.idx === String(M.features.indexOf(feat) + 1).padStart(2, "0");
    // unlit and unmarked outside the window, on both sides
    const outside = [];
    for (const g of [feat.from - 3, feat.to + 3]) {
      if (g < 0 || g > N - 1) continue;
      await goPx(desk, pxOfFrame(g));
      const o = (await readCallouts(desk)).out[id];
      outside.push({ frame: g, hidden: !o.on && o.gOpacity === 0 && o.gVisibility === "hidden" });
    }
    // and wherever the manifest says the point is occluded: no mark, no
    // leader, while the row keeps its place in the tour
    const occluded = [];
    for (const g of inWin.filter(x => !visAt(id, x))) {
      await goPx(desk, pxOfFrame(g));
      const o = (await readCallouts(desk)).out[id];
      occluded.push({ frame: g, hidden: o.gOpacity === 0 && o.gVisibility === "hidden" && o.on });
    }
    const ok = shown && tone && words && onAnchor && others.length === 0 && beside && leader
      && inView && outside.length > 0 && outside.every(o => o.hidden) && occluded.every(o => o.hidden);
    rows.push({ id, frame: f, shown, tone, tones, words, onAnchor, alone: others.length === 0 ? true : others, besideFrame: beside,
      leader, leaderEnd: end, row: c.rect, inView, outside, occluded, ok });
  }
  // The visible flag, tested whatever the render happens to occlude: one
  // interior frame of the first window has its flag flipped to 0 in the page's
  // own manifest object. There the mark must be hidden, and on the frames
  // either side (flags untouched) fully shown.
  const feat = M.features[0], id = feat.id, mid = (feat.from + feat.to) / 2;
  const f = range(feat.from + 2, feat.to - 2).filter(x => visAt(id, x - 1) && visAt(id, x) && visAt(id, x + 1))
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  const flip = v => desk.evaluate((id, f, v) => { const r = window.__hero.manifest.anchors[id][f]; r[r.length - 1] = v; }, id, f, v);
  const synthetic = { id, frame: f };
  await flip(0);
  try {
    for (const [k, g] of [["hiddenAt", f], ["shownBefore", f - 1], ["shownAfter", f + 1]]) {
      await goPx(desk, pxOfFrame(g));
      const o = (await readCallouts(desk)).out[id];
      // hidden: no mark, and the row still lit (its place in the tour does
      // not flicker with the anchor)
      synthetic[k] = k === "hiddenAt" ? o.gOpacity === 0 && o.gVisibility === "hidden" && o.on
        : o.gOpacity > 0.99 && o.gVisibility === "visible";
    }
  } finally { await flip(1); }
  const syntheticOk = synthetic.hiddenAt && synthetic.shownBefore && synthetic.shownAfter;
  // the hold: nothing lit, nothing marked
  await goPx(desk, TOTAL_PX - 4);
  const hold = Object.entries((await readCallouts(desk)).out).filter(([, v]) => v.on || v.gOpacity > 0 || v.gVisibility !== "hidden").map(([k]) => k);
  const occludedTested = rows.reduce((n, r) => n + r.occluded.length, 0) + (synthetic.hiddenAt !== undefined ? 1 : 0);
  check("HERO-CALLOUTS", rows.length === 5 && rows.every(r => r.ok) && syntheticOk && hold.length === 0 && occludedTested > 0,
    { rows, synthetic, litOrShownInHold: hold, occludedFramesTested: occludedTested });
});

/** the reveal state of every chapter's text at the current scroll */
const readChapters = page => page.evaluate(() => {
  const vis = el => { const cs = getComputedStyle(el); return cs.visibility === "visible" && +cs.opacity > 0.99; };
  const gone = el => { const cs = getComputedStyle(el); return cs.visibility === "hidden" || +cs.opacity < 0.01; };
  const out = {};
  for (const box of document.querySelectorAll(".chap")) {
    // every part the column shows: kicker, heading, body and the CTA if any
    const all = [...box.querySelectorAll(".kicker, .chapHead, .chapBody, .cta")];
    out[box.dataset.chap] = {
      parts: all.length, split: box.querySelectorAll(".ln").length,
      shown: all.length > 0 && all.every(vis), hidden: all.length > 0 && all.every(gone),
      // what the reveal is doing to the heading right now
      headOpacity: +getComputedStyle(box.querySelector(".chapHead")).opacity,
      filters: [...new Set(all.map(p => getComputedStyle(p).filter))],
      // textContent, not innerText: innerText drops visibility:hidden text
      head: box.querySelector(".chapHead").textContent.replace(/\s+/g, " ").trim(),
      body: box.querySelector(".chapBody").textContent.replace(/\s+/g, " ").trim(),
    };
  }
  const open = document.getElementById("heroOpen");
  out.open = { shown: vis(open), hidden: gone(open) };
  const tour = document.querySelector(".heroTour");
  out.tour = { shown: !!tour && vis(tour), hidden: !tour || gone(tour) };
  // the hero's whole text and the poster's alt, for the retracted wording
  out.text = document.getElementById("heroAct").textContent.replace(/\s+/g, " ");
  out.alt = document.getElementById("heroStill").alt;
  return out;
});

await block("HERO-CHAPTERS", async () => {
  // the middle of every chapter and the hold: the one block in the column
  const stops = [
    { at: "seed", px: pxOfFrame(midOf("seed")), want: "open" },
    { at: "grow", px: pxOfFrame(midOf("grow")), want: "grow" },
    { at: "branch", px: pxOfFrame(midOf("branch")), want: "branch" },
    { at: "cool", px: pxOfFrame(midOf("cool")), want: "cool" },
    { at: "tour", px: pxOfFrame(midOf("tour")), want: "tour" },
    { at: "pullback", px: pxOfFrame(midOf("pullback")), want: "pullback" },
    { at: "hold", px: TOTAL_PX - 4, want: "end" },
  ];
  const rows = [];
  let copy = null;
  for (const s of stops) {
    await goPx(desk, s.px);
    const r = await readChapters(desk);
    copy ??= r;
    const ok = CHAPTER_IDS.every(id => (id === s.want ? r[id].shown : r[id].hidden))
      && (s.want === "open" ? r.open.shown : r.open.hidden) && (s.want === "tour" ? r.tour.shown : r.tour.hidden);
    rows.push({ at: s.at, want: s.want, shown: CHAPTER_IDS.filter(id => r[id].shown), open: r.open.shown, tour: r.tour.shown, ok });
  }
  // the copy as written (exact case: the display face is sentence case), in
  // whole blocks: the line splitter and its blur-in are gone (v8 D1)
  const words = Object.entries(CHAPTER_COPY).map(([id, [h, b]]) => ({
    id, head: copy[id]?.head === h, body: copy[id]?.body === b, parts: copy[id]?.parts, unsplit: copy[id]?.split === 0,
  }));
  const retracted = RETRACTED.filter(re => re.test(copy.text)).map(String);
  const style = { emDash: copy.text.includes("—"), british: copy.text.match(BRITISH)?.[0] ?? null };
  const altOk = !ALT_BANNED.test(copy.alt) && /satin/i.test(copy.alt);
  // THE REVEAL IS RESTRAINED: walk the grow chapter's arrival in 12 px steps.
  // Every part of every chapter carries no filter at every step (no blur-in),
  // and the heading passes through partial opacity on the way (a fade, not a
  // cut, so the restraint is not bought by deleting the motion).
  const g0 = pxOfFrame(CH.grow.from) + 340;
  const reveal = { steps: 0, filters: new Set(), partial: 0 };
  for (let px = g0; px <= g0 + 300; px += 12) {
    await goPx(desk, px);
    const r = await readChapters(desk);
    reveal.steps++;
    for (const id of CHAPTER_IDS) for (const f of r[id].filters) reveal.filters.add(f);
    if (r.grow.headOpacity > 0.05 && r.grow.headOpacity < 0.95) reveal.partial++;
  }
  const revealOk = reveal.steps >= 20 && [...reveal.filters].every(f => f === "none") && reveal.partial >= 1;
  // THE WHOLE PIN, walked at 700 px/s and read on every animation frame (the
  // stops above sample only the middles): the opening, the five chapters and
  // the rail share one place, so at most one of them may show at a time (a
  // block's alpha is its most visible part's effective opacity), and the cool
  // chapter never shows while the playhead is on a frame that still grows
  // (the timeline's growth.to)
  await goPx(desk, 0);
  await desk.evaluate(() => {
    const eff = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility !== "visible" || cs.display === "none") return 0; o *= +cs.opacity; } return o; };
    const boxes = [["open", document.getElementById("heroOpen")], ...[...document.querySelectorAll(".chap")].map(b => [b.dataset.chap, b]), ["tour", document.querySelector(".heroTour")]];
    const alpha = box => Math.max(0, ...[...box.querySelectorAll(".kicker, .heroTitle, .heroBody, .chapHead, .chapBody, .cta a, .heroRail")].map(eff));
    const walk = window.__walk = { on: true, rows: [] };
    const loop = () => {
      if (!walk.on) return;
      const h = window.__hero;
      const a = Object.fromEntries(boxes.map(([id, b]) => [id, alpha(b)]));
      walk.rows.push({ tick: h.tick, x: h.frameFloat, px: Math.round(h.p * (h.framePx + h.holdPx)), shown: Object.keys(a).filter(k => a[k] > 0.01), cool: a.cool });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await drive(desk, 0, TOTAL_PX, 700);
  await waitRest(desk);
  const walked = perTick(await desk.evaluate(() => { window.__walk.on = false; return window.__walk.rows; }));
  const overlap = walked.filter(r => r.shown.length > 1).slice(0, 6).map(r => ({ px: r.px, shown: r.shown }));
  const coolEarly = walked.filter(r => r.x <= TL.growth.to && r.cool > 0.01).slice(0, 6).map(r => ({ px: r.px, x: r3(r.x), cool: r3(r.cool) }));
  const seenBlocks = [...new Set(walked.flatMap(r => r.shown))];
  const walkOk = walked.length >= 200 && walked.at(-1).px >= TOTAL_PX - 1 && overlap.length === 0 && coolEarly.length === 0
    && ["open", ...CHAPTER_IDS, "tour"].every(id => seenBlocks.includes(id));
  // BEFORE the landing module runs (held back 2.5 s), the head gate has set
  // the live layout and every chapter shares one place, so none may show (they
  // would print over each other) and the end chapter's link must EXIST and not
  // take a click
  const early = {};
  {
    const page = await open("chapters-early", { width: 1440, height: 900, deviceScaleFactor: 1 },
      { delay: { re: /\/src\/landing\.ts(\?|$)/, ms: 2500 }, waitUntil: "load", noWait: true });
    await page.waitForSelector('.chap[data-chap="end"] .cta a', { timeout: 15000 });
    await sleep(300);
    Object.assign(early, await page.evaluate(() => ({
      live: document.documentElement.classList.contains("hero-live"), booted: !!window.__hero,
      heads: [...document.querySelectorAll(".chap .chapHead")].map(h => getComputedStyle(h).visibility),
    })));
    const endCta = await hit(page, '.chap[data-chap="end"] .cta a');
    early.endCtaExists = endCta.exists;
    early.endCtaReachable = endCta.reachable;
    await page.nav;
    await page.close();
  }
  const earlyOk = early.live && !early.booted && early.heads.length === CHAPTER_IDS.length && early.heads.every(v => v === "hidden")
    && early.endCtaExists && !early.endCtaReachable;
  // with the MANIFEST held back instead, the text is the timeline's alone: the
  // column shows the opening and nothing else, before any frame exists
  const noManifest = {};
  {
    const page = await open("chapters-no-manifest", { width: 1440, height: 900, deviceScaleFactor: 1 },
      { delay: { re: /\/hero\/manifest\.json$/, ms: 2500 }, waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__hero?.mode === "live", { timeout: 15000 });
    await sleep(400);
    const r = await readChapters(page);
    Object.assign(noManifest, await page.evaluate(() => ({ manifest: !!window.__hero.manifest,
      ready: document.getElementById("heroAct").classList.contains("hero-ready") })),
    { open: r.open.shown, chaptersHidden: CHAPTER_IDS.every(id => r[id].hidden), tourHidden: r.tour.hidden });
    await page.close();
  }
  const noManifestOk = !noManifest.manifest && noManifest.ready && noManifest.open && noManifest.chaptersHidden && noManifest.tourHidden;
  check("HERO-CHAPTERS", rows.every(r => r.ok) && words.every(w => w.head && w.body && w.unsplit && w.parts >= 3)
    && retracted.length === 0 && !style.emDash && !style.british && altOk && revealOk && walkOk && earlyOk && noManifestOk,
    { rows, words, retracted, style, altOk, reveal: { ...reveal, filters: [...reveal.filters], ok: revealOk },
      walk: { ticks: walked.length, lastPx: walked.at(-1)?.px, blocksSeen: seenBlocks, overlap, coolWhileGrowing: coolEarly, ok: walkOk },
      beforeModule: { ...early, ok: earlyOk }, beforeManifest: { ...noManifest, ok: noManifestOk } });
});

/** DESIGN.md: one primary action per view, a filled pill. Every link or button
 *  on screen whose own background is the --fg fill, and effectively visible. */
const filledOnScreen = page => page.evaluate(fg => {
  const eff = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  return [...document.querySelectorAll("a, button")].filter(el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      && cs.visibility === "visible" && eff(el) > 0.01 && cs.backgroundColor === fg;
  }).map(el => el.textContent.trim());
}, FG);

await block("HERO-CTA", async () => {
  await goPx(desk, 0);
  const links = await desk.evaluate(() => [...document.querySelectorAll("#heroOpen .cta a")]
    .map(a => ({ text: a.textContent.trim(), href: a.getAttribute("href"), cls: a.className })));
  const linksOk = JSON.stringify(links) === JSON.stringify([
    { text: "Take the tour", href: "app/?tour=1", cls: "btn" },
    { text: "Read the science", href: "science/", cls: "btn btn--text" }]);
  const openReach = [];
  for (let k = 1; k <= links.length; k++) openReach.push((await hit(desk, `#heroOpen .cta a:nth-child(${k})`)).reachable);
  // the view's one filled pill: the header's, reachable at every stop
  const pill = [], filled = [];
  pill.push(await hit(desk, "#topnav .btn--primary"));
  filled.push(await filledOnScreen(desk));
  // mid-growth, past the opening (and with the skip link shown)
  await goPx(desk, pxOfFrame(midOf("grow")));
  const faded = [];
  for (let k = 1; k <= links.length; k++) faded.push((await hit(desk, `#heroOpen .cta a:nth-child(${k})`)).reachable);
  pill.push(await hit(desk, "#topnav .btn--primary"));
  filled.push(await filledOnScreen(desk));
  await goPx(desk, TOTAL_PX - 4);
  const end = await hit(desk, '.chap[data-chap="end"] .cta a');
  const endLinks = await desk.evaluate(() => document.querySelectorAll('.chap[data-chap="end"] .cta a').length);
  pill.push(await hit(desk, "#topnav .btn--primary"));
  filled.push(await filledOnScreen(desk));
  const pillOk = pill.every(p => p.reachable && p.text === "Open the instrument" && p.href === "app/");
  const oneFilled = filled.every(f => f.length === 1 && f[0] === "Open the instrument");
  const ok = linksOk && openReach.every(Boolean) && !faded.some(Boolean) && pillOk && oneFilled
    && end.reachable && end.text === "Open the instrument" && end.href === "app/" && endLinks === 1;
  check("HERO-CTA", ok, { links, linksOk, openReach, fadedStillReachable: faded, pillOk, filledPerStop: filled, end, endLinks });
});

await block("HERO-CAPTION", async () => {
  const rows = [];
  for (const p of [0, 0.5, 0.95]) {
    await goPx(desk, p * TOTAL_PX);
    const c = await hit(desk, ".heroCaption");
    const cv = await desk.evaluate(() => { const r = document.getElementById("heroCanvas").getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; });
    // under the render: starts at its left half, its top within 48 px below
    // the frame's bottom edge, and inside the screen
    const ok = c.exists && c.reachable && c.text === CAPTION[0] && c.href === CAPTION[1] && c.opacity >= 0.8
      && c.rect.top >= cv.bottom - 1 && c.rect.top <= cv.bottom + 48
      && c.rect.left >= cv.left - 1 && c.rect.left < (cv.left + cv.right) / 2
      && c.rect.left >= 0 && c.rect.right <= c.vw && c.rect.bottom <= c.vh;
    rows.push({ p, ok, ...c, frame: cv });
  }
  check("HERO-CAPTION", rows.every(r => r.ok), rows);
});

// ------------------------------------------------------------- new: motion
await block("HERO-FLING", async () => {
  // from rest in the grow chapter, a 3,000 px/s fling for one second, then the
  // spring's own catch-up, recorded frame by frame
  await goPx(desk, 400);
  await desk.evaluate(() => { window.__decodeMs.length = 0; });
  await startRec(desk);
  await sleep(100);
  await drive(desk, 400, 3400, 3000);
  await waitRest(desk);
  await sleep(200);
  const flingRows = await stopRec(desk);
  const decodeMs = await desk.evaluate(() => window.__decodeMs.slice());
  // then one wheel notch of 100 px over the frame, from rest
  const box = await desk.evaluate(() => { const r = document.getElementById("heroCanvas").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await desk.mouse.move(box[0], box[1]);
  const y0 = await desk.evaluate(() => scrollY);
  await startRec(desk);
  await sleep(100);
  await desk.mouse.wheel({ deltaY: 100 });
  await sleep(300);
  await waitRest(desk);
  await sleep(200);
  const wheelRows = await stopRec(desk);
  const y1 = await desk.evaluate(() => scrollY);
  const audit = rows => {
    const ticks = perTick(rows.filter(r => r.tick > 0));
    const a = springAudit(ticks);
    const fr = ticks.map(t => Math.abs(t.frame - Math.round(t.x)));
    return { ...a, ticks: ticks.length, frames: rows.length, blank: rows.filter(r => r.lit < 3 || r.frame < 0).length,
      minLit: Math.min(...rows.map(r => r.lit)), p95DrawnVsPlayhead: pct(fr, 0.95), maxDrawnVsPlayhead: Math.max(...fr),
      peakV: r3(Math.max(...ticks.map(t => Math.abs(t.v)))) };
  };
  const fa = audit(flingRows), wa = audit(wheelRows);
  // the fling's own speed, off the targets the page read while it was driven
  const moving = perTick(flingRows).filter(r => r.pxT > 400.5 && r.pxT < 3399.5);
  const speed = moving.length > 1 ? (moving.at(-1).pxT - moving[0].pxT) / ((moving.at(-1).t - moving[0].t) / 1000) : 0;
  // the analytic ceiling for a ramp input: lag -> 2 V / w, V the target's speed in frames/s
  const ceiling = r3((2 * (speed / PPF)) / W);
  // |frame - target| for the frame DRAWN: the spring's own lag plus what
  // display-rate decoding may add, the travel during one decode (the median
  // the gate timed on this page during the fling) and one display frame (60
  // Hz), plus a frame of rounding
  const L50 = pct(decodeMs, 0.5) / 1000;
  const allow = a => a.peakV * (L50 + 1 / 60) + 1;
  const springOk = a => a.pairs >= 20 && a.maxDevPx <= 0.5 && a.maxDevPxPerS <= 2 && a.dtBad === 0 && a.p95Page <= a.p95Ideal + 0.5
    && a.p95Drawn <= a.p95Ideal + allow(a) && a.blank === 0;
  // (the ceiling holds only while no step is clamped to 1/30 s: it is
  // reported, and the replay above is the bound)
  const ok = springOk(fa) && springOk(wa) && speed >= 2700 && speed <= 3300 && Math.abs(y1 - y0 - 100) <= 1;
  check("HERO-FLING", ok && decodeMs.length >= 10, { decodes: decodeMs.length, decodeMsP50: r3(L50 * 1000), decodeMsP90: r3(pct(decodeMs, 0.9)),
    fling: { speedPxPerS: Math.round(speed), lagCeilingFrames: ceiling, drawnAllowance: r3(allow(fa)), ...fa },
    wheel: { scrolled: y1 - y0, drawnAllowance: r3(allow(wa)), ...wa } });
});

await block("HERO-BLEND", async () => {
  // a slow scroll (60 px/s, 6 frames/s) across a run of blend steps with cut
  // steps on either side
  const runs = [];
  for (let i = 0, s = -1; i <= BLEND.length; i++) {
    if (BLEND[i] === 1 && s < 0) s = i;
    if (BLEND[i] !== 1 && s >= 0) { runs.push([s, i - 1]); s = -1; }
  }
  const run = runs.filter(r => r[0] > CH.tour.from).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  const a = run[0] - 6, b = run[1] + 7;
  await goPx(desk, pxOfFrame(a));
  await startRec(desk, 3);
  await drive(desk, pxOfFrame(a), pxOfFrame(b), 60);
  await waitRest(desk);
  await sleep(250);
  const rows = perTick(await stopRec(desk)).filter(r => r.tick > 0);
  const blended = rows.filter(r => r.alpha > 0);
  const wrong = blended.filter(r => !(r.over === r.frame + 1 && BLEND[r.frame] === 1 && r.alpha < 1)).slice(0, 6)
    .map(r => ({ frame: r.frame, over: r.over, alpha: r.alpha, x: r3(r.x) }));
  // WHILE MOVING the picture is frame floor(x) with the next over it at the
  // playhead's own fraction (quantized to 1/64): a reversed or stale alpha
  // judders on every step while every flag above still looks right
  const moving = blended.filter(r => r.v !== 0);
  const offFraction = moving.filter(r => r.frame !== Math.floor(r.x) || Math.abs(r.alpha - (r.x - Math.floor(r.x))) > 1 / 64 + 1e-6).slice(0, 6)
    .map(r => ({ frame: r.frame, alpha: r.alpha, x: r3(r.x) }));
  // and the canvas IS that composite: copies taken mid-blend against the
  // gate's own, with the lower frame alone as the control
  const caps = await blendPixels(desk);
  await desk.evaluate(() => { window.__caps = []; });
  const capsOk = caps.length >= 2 && caps.every(c => c.same < 0.5 && c.far < 0.001 && c.control > Math.max(0.5, 3 * c.same) && c.farControl > 10 * c.far + 0.01);
  // fractional positions on cut steps: none may blend
  const cutFrac = rows.filter(r => { const i = Math.floor(r.x), f = r.x - i; return i < N - 1 && BLEND[i] !== 1 && f > 0.05 && f < 0.95; });
  const cutBlended = cutFrac.filter(r => r.alpha !== 0 || r.over !== -1).length;
  const midBlend = blended.filter(r => r.alpha > 0.1 && r.alpha < 0.9).length;
  // AT REST between two frames: the ease runs to a real frame. On a blend
  // step from both sides of the half, and on a cut step
  const bf = Math.round((run[0] + run[1]) / 2);
  // a cut step: the cool chapter has none that blend
  const cut = midOf("cool");
  const rests = [];
  for (const [pos, want] of [[bf + 0.3, bf], [bf + 0.7, bf + 1], [cut + 0.6, cut + 1]]) {
    await goPx(desk, pxOfFrame(bf + 12));
    await startRec(desk);
    await goPx(desk, pxOfFrame(pos));
    await sleep(100);
    const rr = perTick(await stopRec(desk)).filter(r => r.tick > 0);
    // the ease: from the tick the spring settled to the tick the frame is whole
    const s0 = rr.findIndex(r => r.v === 0 && Math.abs(r.x - pos) < 0.01);
    const s1 = rr.findIndex((r, k) => k >= s0 && r.rest);
    const easeMs = s0 >= 0 && s1 >= 0 ? Math.round(rr[s1].t - rr[s0].t) : null;
    const between = s0 >= 0 && s1 >= 0 ? rr.slice(s0, s1).filter(r => r.alpha > 0 && r.alpha < 1).length : 0;
    const px = await pixels(desk, want, want + 6, SIZE);
    const onBlend = BLEND[Math.floor(pos)] === 1;
    rests.push({ pos, want, onBlend, frame: px.drawn, over: px.over, alpha: px.alpha, easeMs, easeSteps: between, same: px.same, control: px.control,
      ok: px.drawn === want && px.over === -1 && (px.alpha === 0 || px.alpha === 1) && px.same < 0.1 && px.control > Math.max(0.5, 3 * px.same)
        && (!onBlend || (easeMs !== null && easeMs >= 100 && easeMs <= 300 && between >= 2)) });
  }
  const ok = wrong.length === 0 && blended.length >= 15 && midBlend >= 5 && moving.length >= 10 && offFraction.length === 0 && capsOk
    && cutFrac.length >= 10 && cutBlended === 0 && rests.every(r => r.ok);
  check("HERO-BLEND", ok, { run, walked: [a, b], ticks: rows.length, blendedTicks: blended.length, midBlend, wrong,
    movingBlendTicks: moving.length, offFraction, blendPixels: caps, cutStepFractionalTicks: cutFrac.length, cutBlended, rests });
});

await block("HERO-SKIP", async () => {
  const read = page => page.evaluate(() => {
    const el = document.getElementById("heroSkip"), cap = document.querySelector(".heroCaption");
    if (!el) return { exists: false };
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), c = cap.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { exists: true, text: el.textContent.trim(), href: el.getAttribute("href"), display: cs.display, opacity: +cs.opacity,
      reachable: !!at && (at === el || el.contains(at)), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      caption: { left: c.left, top: c.top, right: c.right, bottom: c.bottom }, vw: innerWidth, vh: innerHeight,
      font: cs.fontFamily, size: cs.fontSize, transform: cs.textTransform, color: cs.color, bg: cs.backgroundColor,
      underline: cs.textDecorationLine.includes("underline"), colRight: document.querySelector(".heroCopy").getBoundingClientRect().right,
      colLeft: document.querySelector(".heroCopy").getBoundingClientRect().left,
      copyTop: Math.min(...[...document.querySelectorAll(".heroCopy .heroBlock")].filter(b => +getComputedStyle(b).opacity > 0.01 && getComputedStyle(b).visibility === "visible")
        .map(b => b.getBoundingClientRect().top)) };
  });
  const disjoint = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const onScreen = s => s.rect.left >= 0 && s.rect.right <= s.vw && s.rect.top >= 0 && s.rect.bottom <= s.vh;
  // desktop: hidden at the top and just short of the mark, shown past it and
  // through the pull-back, hidden again once the end chapter arrives with its
  // own link on (skipping there saves nothing, and three "instrument" links
  // with two destinations would share the screen)
  const at = {};
  for (const [k, px] of [["top", 0], ["before", SKIP_AT - 10], ["after", SKIP_AT + 10], ["lastFrame", FRAME_PX + 20], ["endHold", TOTAL_PX - 4]]) {
    await goPx(desk, px);
    await sleep(300);   // the 0.2 s opacity transition
    at[k] = await read(desk);
  }
  const hidden = s => s.exists && s.opacity < 0.01 && !s.reachable;
  const a = at.after;
  const lateOk = at.lastFrame.opacity > 0.99 && at.lastFrame.reachable && hidden(at.endHold);
  const styled = /Space Grotesk/.test(a.font) && a.size === "13px" && a.transform === "uppercase" && a.color === FG3
    && a.bg === "rgba(0, 0, 0, 0)" && a.underline;
  // level with the caption, at the page's right inset (the copy column's edge)
  const placed = Math.abs(a.rect.top + 3 - a.caption.top) <= 2 && Math.abs(a.rect.right - a.colRight) <= 2 && disjoint(a.rect, a.caption);
  const desktopOk = hidden(at.top) && hidden(at.before) && a.opacity > 0.99 && a.reachable && onScreen(a) && a.text === "Skip to the instrument"
    && a.href === "#lensAct" && styled && placed && lateOk;
  // the keyboard: from the top of a fresh page, Tab reaches it (shown on
  // focus, before the 1,000 px mark), and Enter lands past the hero
  const page = await open("skip-keyboard", { width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.waitForFunction(() => window.__hero?.frame >= 0, { timeout: 15000 });
  let tabs = 0, focused = null;
  for (; tabs < 40; tabs++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.id);
    if (id === "heroSkip") { await sleep(300); focused = await read(page); break; }
  }
  let landed = null;
  if (focused) {
    await page.keyboard.press("Enter");
    await sleep(600);
    landed = await page.evaluate(() => {
      const st = window.__hero.st, lens = document.getElementById("lensAct").getBoundingClientRect();
      const hdr = document.getElementById("topnav").getBoundingClientRect().height;
      return { scrollY, pinEnd: st.end, lensTop: lens.top, header: hdr, heroBottom: document.getElementById("heroAct").getBoundingClientRect().bottom, hash: location.hash };
    });
  }
  await page.close();
  const keyOk = !!focused && focused.opacity > 0.99 && onScreen(focused) && !!landed && landed.scrollY >= landed.pinEnd
    && landed.lensTop >= 0 && landed.lensTop <= landed.header + 16 + 2 && landed.heroBottom <= landed.header + 16 + 2;
  // stacked (a phone, and a tablet held upright, where the frame is centered
  // and narrower than the column): under the caption, on screen, clear of
  // it, the caption and the link on the copy column's left edge (one left
  // edge for the stack), and the column's first line at least --s-5 (20 px)
  // below the link, so the three small gray lines do not read as one block
  const stackedAt = async (tag, vp) => {
    const page = await open(tag, vp);
    await loaded(page);
    await goPx(page, SKIP_AT + 10);
    await sleep(300);
    const r = await read(page);
    await page.close();
    return { ...r, ok: r.opacity > 0.99 && r.reachable && onScreen(r) && disjoint(r.rect, r.caption) && r.rect.top >= r.caption.bottom - 1
      && r.copyTop - r.rect.bottom >= 20 - 0.5 && Math.abs(r.rect.left - r.colLeft) <= 1 && Math.abs(r.caption.left - r.colLeft) <= 1 };
  };
  const p = await stackedAt("skip-phone", { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const tab = await stackedAt("skip-tablet", { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phoneOk = p.ok && tab.ok;
  // the still has no pin to skip: not rendered
  const still = await open("skip-still", { width: 1440, height: 900, deviceScaleFactor: 1 }, { reduced: true });
  const sd = await still.evaluate(() => getComputedStyle(document.getElementById("heroSkip")).display);
  await still.close();
  check("HERO-SKIP", desktopOk && keyOk && phoneOk && sd === "none",
    { desktop: { top: { opacity: at.top.opacity, reachable: at.top.reachable }, before: { opacity: at.before.opacity, reachable: at.before.reachable }, after: a, styled, placed,
      lastFrame: { opacity: at.lastFrame.opacity, reachable: at.lastFrame.reachable }, endHold: { opacity: at.endHold.opacity, reachable: at.endHold.reachable }, ok: desktopOk },
      keyboard: { tabs: tabs + 1, focused: focused && { opacity: focused.opacity, rect: focused.rect }, landed, ok: keyOk },
      stacked: [["390x844", p], ["768x1024", tab]].map(([vp, r]) => ({ vp, rect: r.rect, caption: r.caption, colLeft: r.colLeft, copyTop: r.copyTop,
        gap: +(r.copyTop - r.rect.bottom).toFixed(1), opacity: r.opacity, reachable: r.reachable, ok: r.ok })), stillDisplay: sd });
});

await block("HERO-SETPICK", async () => {
  // the delivery study's viewports (docs/HERO-DELIVERY.md, v4/a5/delivery.md)
  // and the set each gets; the rule is also recomputed from the measured canvas
  const MATRIX = [
    [390, 844, 3, 720], [430, 932, 3, 720], [360, 800, 3, 720], [412, 915, 2.625, 720], [768, 1024, 2, 900],
    [1280, 800, 1, 720], [1366, 768, 1, 720], [1440, 900, 1, 720], [1280, 720, 1.5, 900], [1536, 864, 1.25, 900],
    [1920, 1080, 1, 900], [2560, 1440, 1, 900], [1440, 900, 2, 1200], [1728, 1117, 2, 1200],
  ];
  const rows = [];
  for (const [w, hgt, dpr, want] of MATRIX) {
    const phone = w < 760;
    const page = await open(`setpick-${w}x${hgt}@${dpr}`, { width: w, height: hgt, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
    await page.waitForFunction(() => window.__hero?.set > 0 && window.__hero.frame >= 0, { timeout: 15000 });
    const r = await ruleOf(page);
    const firstOf = page.bins.filter(u => u.endsWith("/first.bin"));
    await page.close();
    rows.push({ vp: `${w}x${hgt}@${dpr}`, css: r3(r.css), set: r.set, rule: r.rule, want, backing: r.backing, backingWant: r.want, first: firstOf,
      ok: r.set === r.rule && r.set === want && r.backing[0] === r.want[0] && r.backing[1] === r.want[1]
        && firstOf.length === 1 && firstOf[0] === `hero/${M.dir}/${want}/first.bin` });
  }
  // A DPR change (the window moved to a denser screen) and a window resize:
  // trade up with no blank frame on the way, then never back down
  const swaps = [];
  // (headless Chrome changes devicePixelRatio under emulation without firing
  // the resolution query, resize or the observer, which a real screen change
  // or zoom fires; the 1 px width nudge makes it deliver a resize)
  for (const [from, to, stop] of [[{ width: 1440, height: 900, deviceScaleFactor: 1 }, { width: 1441, height: 900, deviceScaleFactor: 2 }, "dpr"],
    [{ width: 1024, height: 768, deviceScaleFactor: 1 }, { width: 1920, height: 1080, deviceScaleFactor: 1 }, "resize"]]) {
    const page = await open(`setpick-${stop}`, from);
    await loaded(page);
    const f = midOf("cool");
    await goPx(page, pxOfFrame(f));
    const s0 = await ruleOf(page);
    await startRec(page);
    await page.setViewport(to);
    await page.waitForFunction(w => { const h = window.__hero; return h.set > w && h.rest && h.frame === Math.round(h.target); }, { timeout: 20000 },
      s0.set).catch(() => {});
    await sleep(200);
    const rows2 = await stopRec(page);
    const s1 = await ruleOf(page);
    const px1 = await pixels(page, f, f - 6, s1.set);
    // and back: the set stays
    await page.setViewport(from);
    await sleep(600);
    const s2 = await ruleOf(page);
    await page.close();
    swaps.push({ stop, before: s0.set, after: s1.set, rule: s1.rule, back: s2.set, backing: [s0.backing[0], s1.backing[0], s2.backing[0]],
      samples: rows2.length, blank: rows2.filter(r => r.lit < 3).length, frame: px1.drawn, same: px1.same, control: px1.control,
      ok: s1.set > s0.set && s1.set === s1.rule && s2.set === s1.set && rows2.length >= 5 && rows2.every(r => r.lit >= 3)
        && s1.backing[0] === s1.want[0] && s2.backing[0] === s2.want[0] && pixelsOk(px1, f) });
  }
  // A BROWSER ZOOM (Ctrl +: the CSS size shrinks and the DPR grows in one
  // step): the set is picked for the canvas once the layout has settled. The
  // pinned section keeps its old size until ScrollTrigger's refresh, and the
  // old width at the new DPR would ask for a set the rule does not give.
  const zooms = [];
  for (const z of [{ width: 1152, height: 720, deviceScaleFactor: 1.25 }, { width: 960, height: 600, deviceScaleFactor: 1.5 }]) {
    const page = await open(`setpick-zoom-${z.deviceScaleFactor}`, { width: 1440, height: 900, deviceScaleFactor: 1 });
    await loaded(page);
    await goPx(page, pxOfFrame(midOf("cool")));
    const s0 = await ruleOf(page), n0 = page.bins.length;
    await page.setViewport(z);
    await sleep(1500);
    const s1 = await ruleOf(page);
    const other = page.bins.slice(n0).filter(u => !u.includes(`/${s0.set}/`));
    await page.close();
    zooms.push({ zoom: `${z.width}x${z.height}@${z.deviceScaleFactor}`, before: s0.set, after: s1.set, rule: s1.rule, css: r3(s1.css), otherSetRequests: other.length,
      ok: s1.set === s1.rule && s1.set === s0.set && other.length === 0 && s1.backing[0] === s1.want[0] });
  }
  // TWO TRADE-UPS IN A ROW, the second before any of the intermediate set's
  // frames has arrived (its files held back 3 s): the stand-ins carry over
  // from the first set, so the canvas is never blank on the way to the set the
  // rule gives
  const twice = {};
  {
    const g = [[1280, 720], [1664, 936], [2048, 1152]].map(([width, height]) => ({ width, height, deviceScaleFactor: 1.25 }));
    const held = /\/hero\/v\d+-[0-9a-f]+\/900\/[^/]+\.bin$/;
    const page = await open("setpick-twice", g[0], { delay: { re: held, ms: 3000 }, expect: held });
    await loaded(page);
    const f = midOf("cool");
    await goPx(page, pxOfFrame(f));
    twice.path = [(await ruleOf(page)).set];
    await startRec(page);
    await page.setViewport(g[1]);
    await page.waitForFunction(s => window.__hero.set > s, { timeout: 10000 }, twice.path[0]).catch(() => {});
    twice.mid = await page.evaluate(() => ({ set: window.__hero.set, loaded: window.__hero.loaded, decoded: window.__hero.decodedCount }));
    await page.setViewport(g[2]);
    await page.waitForFunction(s => { const h = window.__hero; return h.set > s && h.rest && h.frame === Math.round(h.target); }, { timeout: 20000 },
      twice.mid.set).catch(() => {});
    await sleep(200);
    const rows2 = await stopRec(page);
    const s2 = await ruleOf(page);
    const px2 = await pixels(page, f, f - 6, s2.set);
    await page.close();
    twice.path.push(twice.mid.set, s2.set);
    Object.assign(twice, { rule: s2.rule, samples: rows2.length, blank: rows2.filter(r => r.lit < 3).length, same: px2.same, control: px2.control,
      ok: twice.path[0] < twice.mid.set && twice.mid.set < s2.set && twice.mid.loaded === 0 && s2.set === s2.rule && rows2.length >= 10
        && rows2.every(r => r.lit >= 3) && pixelsOk(px2, f) });
  }
  check("HERO-SETPICK", rows.every(r => r.ok) && swaps.every(s => s.ok) && zooms.every(z => z.ok) && twice.ok,
    { rows: rows.filter(r => !r.ok).concat(rows.filter(r => r.ok).map(r => ({ vp: r.vp, set: r.set, ok: true }))), swaps, zooms, twice });
});

await block("HERO-CACHE", async () => {
  // the gate's own count of live bitmaps: every createImageBitmap that
  // resolved, less every close()
  const counter = () => {
    const orig = window.createImageBitmap.bind(window);
    const live = new Map();
    const b = window.__bmp = { open: 0, bytes: 0, made: 0, closed: 0 };
    window.createImageBitmap = (...a) => orig(...a).then(bmp => {
      live.set(bmp, bmp.width * bmp.height * 4);
      b.made++; b.open = live.size; b.bytes += bmp.width * bmp.height * 4;
      return bmp;
    });
    const close = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function () {
      if (live.has(this)) { b.bytes -= live.get(this); live.delete(this); b.closed++; b.open = live.size; }
      return close.call(this);
    };
  };
  const page = await open("cache", { width: 1440, height: 900, deviceScaleFactor: 2 }, { init: counter });
  await loaded(page);
  const set = await page.evaluate(() => window.__hero.set);
  await goPx(page, 0);
  await startRec(page);
  await drive(page, 0, TOTAL_PX, 2500);
  await waitRest(page);
  await drive(page, TOTAL_PX, 0, 2500);
  await waitRest(page);
  await sleep(300);
  const rows = await stopRec(page);
  const end = await page.evaluate(() => ({ dec: window.__hero.decodedCount, bytes: window.__hero.cacheBytes, cap: window.__hero.cacheCap, bmp: { ...window.__bmp } }));
  await page.close();
  // OFF SCREEN: where the skip link lands, the section's empty bottom strip
  // is still in view under the fixed header, but the picture is not: the
  // decoded frames are let go (the page's count and the gate's), and with the
  // segments answered 800 ms late, none is requested once it has left
  const off = await open("cache-offscreen", { width: 1440, height: 900, deviceScaleFactor: 2 }, { init: counter, delay: { re: /\/\d{3}-\d{3}\.bin$/, ms: 800 } });
  await off.waitForFunction(() => window.__hero?.frame >= 0, { timeout: 15000 });
  await goPx(off, SKIP_AT + 10);
  await sleep(300);
  await off.click("#heroSkip");
  await sleep(500);
  const leave = await off.evaluate(() => {
    const h = window.__hero, cv = document.getElementById("heroCanvas").getBoundingClientRect(), sec = document.getElementById("heroAct").getBoundingClientRect();
    return { canvasBottom: Math.round(cv.bottom), heroBottom: Math.round(sec.bottom), header: Math.round(document.getElementById("topnav").getBoundingClientRect().bottom),
      dec: h.decodedCount, gateOpen: window.__bmp.open, loaded: h.loaded };
  });
  const binsAtLeave = off.bins.length;
  await off.evaluate(() => window.scrollBy(0, 1000));
  await sleep(3000);
  const later = off.bins.slice(binsAtLeave);
  const afterDec = await off.evaluate(() => ({ dec: window.__hero.decodedCount, gateOpen: window.__bmp.open }));
  await off.close();
  const offOk = leave.canvasBottom <= leave.header && leave.heroBottom > leave.header && leave.dec <= 1 && leave.gateOpen <= 1
    && afterDec.dec <= 1 && afterDec.gateOpen <= 1 && leave.loaded < N && later.length === 0;
  // sampled every animation frame: what is held between frames (a decode that
  // lands is inserted and the farthest evicted in one task)
  const maxDec = Math.max(...rows.map(r => r.dec)), maxBytes = Math.max(...rows.map(r => r.bytes));
  const gateOpen = Math.max(...rows.map(r => r.bmp.open)), gateBytes = Math.max(...rows.map(r => r.bmp.bytes));
  const reach = [Math.min(...rows.map(r => r.x)), Math.max(...rows.map(r => r.x))];
  const ok = set === 1200 && gateOpen <= MAX_BITMAPS && gateBytes <= CACHE_BYTES && maxDec <= MAX_BITMAPS && maxBytes <= CACHE_BYTES
    && end.cap <= CACHE_BYTES && maxBytes <= end.cap
    // honest: at rest the page's count is the gate's (nothing decoded and dropped unclosed)
    && end.dec === end.bmp.open && end.bytes === end.bmp.bytes
    // and the cap was actually reached: a cache that never filled proves nothing
    && maxDec >= MAX_BITMAPS - 4 && end.bmp.closed >= 100 && reach[0] <= 1 && reach[1] >= N - 2;
  check("HERO-CACHE", ok && offOk, { set, samples: rows.length, playheadReach: reach.map(r3), pageMax: { decoded: maxDec, bytesMB: r3(maxBytes / 1e6) },
    gateMax: { open: gateOpen, bytesMB: r3(gateBytes / 1e6) }, capMB: r3(end.cap / 1e6), atRest: { page: [end.dec, end.bytes], gate: [end.bmp.open, end.bmp.bytes] },
    made: end.bmp.made, closed: end.bmp.closed,
    offScreen: { ...leave, after: afterDec, segmentsRequestedAfterLeaving: later.length, first: later.slice(0, 3), ok: offOk } });
});

// ---------------------------------------------------------- reduced motion
/** the still page: poster, labels, stacked text */
async function readStill(page) {
  return page.evaluate(() => {
    const img = document.getElementById("heroStill");
    const cs = getComputedStyle(img);
    const st = document.getElementById("heroAct");
    const y0 = st.getBoundingClientRect().top;
    const open = document.getElementById("heroOpen");
    const pic = img.closest("picture");
    return {
      mode: window.__hero?.mode ?? null, pinned: !!window.__hero?.st, hasLiveClass: document.documentElement.classList.contains("hero-live"),
      spacer: st.parentElement.classList.contains("pin-spacer"), spacers: document.querySelectorAll(".pin-spacer").length,
      ready: st.classList.contains("hero-ready"),
      img: { shown: cs.display !== "none" && cs.visibility === "visible", w: img.getBoundingClientRect().width, natural: img.naturalWidth,
        src: img.getAttribute("src"), current: img.currentSrc, alt: img.alt,
        sources: pic ? [...pic.querySelectorAll("source")].map(s => ({ type: s.type, srcset: s.getAttribute("srcset") })) : null },
      canvasShown: getComputedStyle(document.getElementById("heroCanvas")).display !== "none",
      chapters: [...document.querySelectorAll(".chap")].map(b => {
        const h = b.querySelector(".chapHead"), c = getComputedStyle(h);
        return { id: b.dataset.chap, shown: c.visibility === "visible" && +c.opacity > 0.99 && h.getBoundingClientRect().height > 0, split: !!b.querySelector(".ln") };
      }),
      // what the live timeline wrote inline, which a fallback has to take back
      openInline: ["opacity", "filter", "transform", "translate", "visibility"].filter(p => open.style[p] !== ""),
      srBodies: document.querySelectorAll(".chap .sr-only").length,
      y0,
    };
  });
}
/** the poster as index.html serves it: the stable WebP in the <img>, the one
 *  stable AVIF <source>, and Chrome showing the AVIF at 1200 */
const posterOk = img => img.shown && img.natural === 1200 && img.src === "hero/poster-1200.webp"
  && /hero\/poster-1200\.avif$/.test(img.current) && JSON.stringify(img.sources) === JSON.stringify([{ type: "image/avif", srcset: "hero/poster-1200.avif" }]);

await block("HERO-REDUCED", async () => {
  const page = await open("reduced", { width: 1440, height: 900, deviceScaleFactor: 1 }, { reduced: true });
  await page.waitForFunction(() => document.querySelectorAll(".callout").length === 5
    && document.getElementById("heroStill").complete, { timeout: 15000 });
  await sleep(400);
  const s = await readStill(page);
  // not pinned: scrolling moves the section with the page
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(200);
  const moved = await page.evaluate(() => document.getElementById("heroAct").getBoundingClientRect().top);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const co = await readCallouts(page);
  const labels = stillLabels(co);
  // on the poster the tertiary and neck roots sit a few px apart: their
  // numbers must still not print over each other
  const nums = numOverlaps(co);
  const ok = s.mode === "still" && !s.pinned && !s.spacer && !s.hasLiveClass && Math.abs(moved - (s.y0 - 400)) < 2
    && posterOk(s.img) && !s.canvasShown
    && labels.every(l => l.shown && l.words && l.lineShown && l.onAnchor && l.numbered)
    && nums.numbers === 5 && nums.overlapping.length === 0
    && s.chapters.length === CHAPTER_IDS.length && s.chapters.every(c => c.shown && !c.split);
  check("HERO-REDUCED", ok, { ...s, movedWithPage: moved - s.y0, labels, nums });
  await page.close();
});

await block("HERO-NOJS", async () => {
  const page = await open("nojs", { width: 1440, height: 900, deviceScaleFactor: 1 }, { js: false });
  const s = await readStill(page);
  const ok = posterOk(s.img) && s.img.alt.length >= 40 && /dendrite/i.test(s.img.alt) && !s.canvasShown && !s.hasLiveClass
    && s.chapters.length === CHAPTER_IDS.length && s.chapters.every(c => c.shown);
  check("HERO-NOJS", ok, { img: s.img, canvasShown: s.canvasShown, liveClass: s.hasLiveClass, chapters: s.chapters });
  await page.close();
});

// ------------------------------------------------------------------ phone
await block("HERO-MOBILE", async () => {
  const vp = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const page = await open("mobile", vp);
  await loaded(page);
  // 358 CSS px x min(3, 2) = 716 px needed: the 720 set, by the rule
  const set = await ruleOf(page);
  const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw: innerWidth }));
  const rows = [];
  const stops = [["start", 0], ["grow", pxOfFrame(midOf("grow"))], ["branch", pxOfFrame(midOf("branch"))], ["cool", pxOfFrame(midOf("cool"))],
    ...M.features.map(f => [f.id, pxOfFrame(midVisible(f))]), ["pullback", pxOfFrame(midOf("pullback"))], ["hold", TOTAL_PX - 4]];
  let stacked = null;
  const labels = [];
  // the copy column is pinned: nothing shown in it may sit below the screen,
  // where no scroll reaches it
  const lowest = () => page.evaluate(() => {
    const eff = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility !== "visible") return 0; o *= +cs.opacity; } return o; };
    let b = 0;
    for (const el of document.querySelectorAll(".heroCopy .kicker, .heroCopy .heroTitle, .heroCopy .heroBody, .chapHead, .chapBody, .heroCopy .cta a, .callout, .railNote"))
      if (el.getClientRects().length && eff(el) > 0.01 && el.textContent.trim()) b = Math.max(b, el.getBoundingClientRect().bottom);
    return { bottom: Math.round(b), vh: innerHeight };
  });
  for (const [at, px] of stops) {
    await goPx(page, px);
    const o = await overflow();
    const lo = await leafOverflow(page);
    const low = await lowest();
    // the document's own width for anything outside the hero, the leaves for
    // everything inside it and the fixed bar
    rows.push({ at, over: o.sw - o.cw, leaves: lo.leaves, offScreen: lo.bad, copyBottom: low.bottom,
      ok: o.sw <= o.cw && o.cw <= o.iw && lo.leaves > 0 && lo.badCount === 0 && low.bottom <= low.vh });
    if (at === "grow") {
      stacked = await page.evaluate(() => {
        const c = document.getElementById("heroCanvas").getBoundingClientRect();
        const h = document.querySelector('.chap[data-chap="grow"] .chapHead').getBoundingClientRect();
        const b = document.querySelector('.chap[data-chap="grow"] .chapBody').getBoundingClientRect();
        return { centered: Math.abs(c.left + c.width / 2 - innerWidth / 2) <= 1, headBelow: h.top >= c.bottom - 2, bodyBelowHead: b.top >= h.bottom - 2 };
      });
    }
    if (M.features.some(f => f.id === at)) {
      // the row lit AND shown (the rail block faded in), titles only, its line
      // in the slot under the rail and that slot actually visible (its
      // effective opacity, the product up its ancestors), and the mark
      // numbered like the row instead of a leader across the crystal
      const co = await readCallouts(page);
      const c = co.out[at];
      const noteAlpha = await page.evaluate(() => {
        let o = 1;
        for (let e = document.querySelector(".railNote"); e && e.nodeType === 1; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.visibility !== "visible" || cs.display === "none") return 0;
          o *= +cs.opacity;
        }
        return o;
      });
      labels.push({ id: at, on: c.on, shown: c.on && co.tourShown, lineHidden: !c.lineShown, inView: c.rect.left >= 0 && c.rect.right <= co.vw,
        note: co.note === COPY[at][1], noteAlpha: +noteAlpha.toFixed(3), numbered: !!c.num && c.num.shown && c.num.text === c.idx, noLeader: c.leader.length === 0 });
    }
  }
  await page.close();
  // the still layout at phone width as well
  const still = await open("mobile-reduced", vp, { reduced: true });
  await still.waitForFunction(() => document.querySelectorAll(".callout").length === 5, { timeout: 15000 });
  await sleep(400);
  const so = await still.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  const slo = await leafOverflow(still);
  const sco = await readCallouts(still);
  const sl = Object.values(sco.out).map(c => ({ shown: c.visibility === "visible", lineHidden: !c.lineShown, inView: c.rect.left >= 0 && c.rect.right <= 390 }));
  const snums = numOverlaps(sco);
  await still.close();
  // TURNED SIDEWAYS after it loaded live, inside the pin: the still, as a
  // page loaded sideways gets from the head gate (a pinned column cannot fit
  // 390 px), with the visitor at the hero's top, nothing of live mode left
  // and no hero text past an edge; turned back, it stays the still
  const rot = await open("mobile-rotate", vp);
  await loaded(rot);
  await goPx(rot, pxOfFrame(midVisible(M.features[3])));
  await rot.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
  await rot.waitForFunction(() => window.__hero?.mode === "still" && document.querySelectorAll(".callout").length === 5, { timeout: 10000 }).catch(() => {});
  await sleep(600);
  const rs = await readStill(rot);
  const rlo = await leafOverflow(rot);
  const rtop = await rot.evaluate(() => Math.round(document.getElementById("heroAct").getBoundingClientRect().top));
  await rot.setViewport(vp);
  await sleep(600);
  const back = await readStill(rot);
  await rot.close();
  const rotate = { mode: rs.mode, pinned: rs.pinned, liveClass: rs.hasLiveClass, heroSpacer: rs.spacer, poster: rs.img.shown, canvas: rs.canvasShown,
    heroTop: rtop, offScreen: rlo.bad, back: { mode: back.mode, liveClass: back.hasLiveClass, poster: back.img.shown } };
  const rotateOk = rs.mode === "still" && !rs.pinned && !rs.hasLiveClass && !rs.spacer && rs.img.shown && !rs.canvasShown && Math.abs(rtop) <= 1
    && rlo.leaves > 0 && rlo.badCount === 0 && back.mode === "still" && !back.hasLiveClass && back.img.shown;
  const ok = set.set === set.rule && set.set === 720
    && rows.every(r => r.ok) && stacked?.centered && stacked.headBelow && stacked.bodyBelowHead
    && labels.length === M.features.length
    && labels.every(l => l.on && l.shown && l.lineHidden && l.inView && l.note && l.noteAlpha > 0.99 && l.numbered && l.noLeader)
    && so.sw <= so.cw && slo.leaves > 0 && slo.badCount === 0 && sl.length === 5 && sl.every(l => l.shown && l.lineHidden && l.inView)
    && snums.numbers === 5 && snums.overlapping.length === 0 && rotateOk;
  check("HERO-MOBILE", ok, { set, rows, stacked, labels, still: { overflow: so.sw - so.cw, leaves: slo.leaves, offScreen: slo.bad, labels: sl, nums: snums },
    rotate: { ...rotate, ok: rotateOk } });
});

// -------------------------------------------------------- the other screens
await block("HERO-FIT", async () => {
  const rows = [];
  // 1. The live copy column where it is tight: a tablet (1024 x 768, where
  // the column is ~400 px wide) and a 1366 x 768 laptop under its browser
  // chrome (657 px tall). At the opening, at every tour stop and in the hold,
  // the block in view is shown and sits inside the column (the column is the
  // frame's height, beside it), on screen, with no hero text or link past an
  // edge.
  for (const vp of [{ width: 1024, height: 768 }, { width: 1366, height: 657 }]) {
    const page = await open(`fit-${vp.width}`, { ...vp, deviceScaleFactor: 1 });
    await loaded(page);
    const stops = [["open", 0, "#heroOpen"], ...M.features.map(f => [f.id, pxOfFrame(midVisible(f)), ".heroTour"]),
      ["hold", TOTAL_PX - 4, '.chap[data-chap="end"]']];
    for (const [at, px, sel] of stops) {
      await goPx(page, px);
      const r = await page.evaluate(sel => {
        const el = document.querySelector(sel), b = el.getBoundingClientRect(), cs = getComputedStyle(el);
        const cv = document.getElementById("heroCanvas").getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, right: b.right, colTop: cv.top, colBottom: cv.bottom, vw: innerWidth, vh: innerHeight,
          shown: +cs.opacity > 0.99 && cs.visibility === "visible" };
      }, sel);
      const lo = await leafOverflow(page);
      const inside = r.top >= r.colTop - 1 && r.bottom <= r.colBottom + 1;
      const ok = r.shown && inside && r.bottom <= r.vh && r.right <= r.vw + 0.5 && lo.leaves > 0 && lo.badCount === 0;
      rows.push({ vp: `${vp.width}x${vp.height}`, at, block: [Math.round(r.top), Math.round(r.bottom)], column: [Math.round(r.colTop), Math.round(r.colBottom)],
        shown: r.shown, offScreen: lo.bad, ok });
    }
    await page.close();
  }
  // 2. A phone held sideways (844 x 390): no pinned column fits 390 px, so
  // the head gate gives it the still, which scrolls like a page, and both
  // opening links can be scrolled to and clicked.
  {
    const page = await open("fit-844", { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    // whichever mode it booted in (the row reports a live one as a failure
    // rather than timing out on it), once its rail is built
    await page.waitForFunction(() => !!window.__hero?.mode && document.querySelectorAll(".callout").length === 5, { timeout: 15000 });
    const s = await readStill(page);
    const links = [];
    for (let k = 1; k <= 2; k++) {
      await page.evaluate(k => document.querySelector(`#heroOpen .cta a:nth-child(${k})`).scrollIntoView({ block: "center" }), k);
      await sleep(250);
      links.push((await hit(page, `#heroOpen .cta a:nth-child(${k})`)).reachable);
    }
    const lo = await leafOverflow(page);
    rows.push({ vp: "844x390", mode: s.mode, pinned: s.pinned, liveClass: s.hasLiveClass, spacers: s.spacers, links, offScreen: lo.bad,
      ok: s.mode === "still" && !s.pinned && !s.hasLiveClass && s.spacers === 0 && links.length === 2 && links.every(Boolean) && lo.badCount === 0 });
    await page.close();
  }
  // 3. 320 px, the width WCAG 1.4.10 reflows to: the fixed header's wordmark,
  // MENU and pill all inside the screen (the leaves include #topnav's
  // children, which never reach scrollWidth), the pill's name still whole.
  {
    const page = await open("fit-320", { width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const lo = await leafOverflow(page);
    const o = await page.evaluate(() => {
      const p = document.querySelector("#topnav .btn--primary");
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, pillRight: p.getBoundingClientRect().right,
        name: p.getAttribute("aria-label"), shows: p.innerText.trim() };
    });
    rows.push({ vp: "320x640", ...o, leaves: lo.leaves, offScreen: lo.bad,
      ok: lo.leaves > 0 && lo.badCount === 0 && o.sw <= o.cw && o.pillRight <= 320 && o.name === "Open the instrument" && o.name.startsWith(o.shows) });
    await page.close();
  }
  check("HERO-FIT", rows.length === 2 * (M.features.length + 2) + 2 && rows.every(r => r.ok), { rows: rows.filter(r => !r.ok).concat(rows.filter(r => r.ok).map(r => ({ vp: r.vp, at: r.at, ok: true }))) });
});

// --------------------------------------------------------------- fallback
await block("HERO-FALLBACK", async () => {
  const vp = { width: 1440, height: 900, deviceScaleFactor: 1 };
  const cases = {};
  /** the still with its five labels on the poster's anchors, and nothing of
   *  live mode left behind */
  const labelledStill = async page => {
    await page.waitForFunction(() => window.__hero?.mode === "failed" && document.querySelectorAll(".callout").length === 5
      && document.getElementById("heroStill").complete && document.getElementById("heroStill").naturalWidth > 0, { timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    const s = await readStill(page);
    const co = await readCallouts(page);
    const labels = stillLabels(co);
    const nums = numOverlaps(co);
    const why = await page.evaluate(() => window.__hero.failed.length);
    return { ...s, failuresRecorded: why, calloutEls: co.calloutEls, markEls: co.markEls, labels, nums,
      ok: !s.hasLiveClass && s.spacers === 0 && !s.pinned && !s.ready && s.img.shown && !s.canvasShown
        && co.calloutEls === 5 && co.markEls === 5 && labels.every(l => l.shown && l.words && l.onAnchor && l.numbered)
        && nums.numbers === 5 && nums.overlapping.length === 0
        && s.chapters.every(c => c.shown && !c.split) && s.openInline.length === 0 && s.srBodies === 0 && why > 0 };
  };

  // 1. no manifest: nothing to draw callouts from, so the poster alone, as
  // with no JavaScript; the pin made before the fetch is gone
  {
    const re = /\/hero\/manifest\.json$/;
    const page = await open("fallback-manifest", vp, { missing: re, expect: re });
    await page.waitForFunction(() => window.__hero?.mode === "failed" && document.getElementById("heroStill").complete
      && document.getElementById("heroStill").naturalWidth > 0, { timeout: 15000 });
    await sleep(400);
    const s = await readStill(page);
    const callouts = await page.evaluate(() => document.querySelectorAll(".callout").length);
    cases.manifest = { ...s, callouts, bins: page.bins.length, ok: !s.hasLiveClass && s.spacers === 0 && !s.pinned && s.img.shown && !s.canvasShown
      && callouts === 0 && s.chapters.every(c => c.shown && !c.split) && page.bins.length === 0 };
    await page.close();
  }

  // 2. every segment from frame 128 on missing from EVERY set: the first
  // passes arrive (frame 0 draws), so each set is failed by count (more than a
  // tenth), the next set is tried after each, and then the still
  {
    const page = await open("fallback-frames", vp,
      { missing: /\/hero\/v\d+-[0-9a-f]+\/\d+\/(?!000-|032-|064-|096-)\d{3}-\d{3}\.bin$/, expect: /\/hero\/v\d+-[0-9a-f]+\// });
    await page.evaluate(() => window.scrollBy(0, 1));   // past the first pass
    const s = await labelledStill(page);
    const firsts = [...new Set(page.bins.filter(u => u.endsWith("/first.bin")))].sort();
    cases.frames = { ...s, firstPassesTried: firsts, ok: s.ok && firsts.length === M.sets.length };
    await page.close();
  }

  // 3. the set the rule picks here missing (720 at 1440 x 900): live on the
  // next one up, and the canvas holds that set's pixels, not merely its index
  {
    const picked = ruleFor(701, 1), next = SET_WIDTHS.find(w => w > picked);
    const re = new RegExp(`/hero/v\\d+-[0-9a-f]+/${picked}/`);
    const page = await open("fallback-size", vp, { missing: re, expect: re });
    await loaded(page);
    const f = 60;
    await goPx(page, pxOfFrame(f));
    const r = await pixels(page, f, f - 6, next);
    const s = await page.evaluate(() => ({ mode: window.__hero.mode, set: window.__hero.set, pinned: !!window.__hero.st, failed: window.__hero.failed.length }));
    cases.size = { picked, next, ...s, frame: r, ok: s.mode === "live" && s.set === next && s.pinned && s.failed > 0 && pixelsOk(r, f) };
    await page.close();
  }

  // 4. a manifest made for another timeline, and one for another N: the still
  // (its poster labelled from that manifest), and no frame fetched
  const text = readFileSync(new URL("../public/hero/manifest.json", import.meta.url), "utf8");
  // (keyed otherTimeline / otherN: "frames" is case 2's, which this loop
  // used to overwrite, so case 2's result was never checked)
  for (const [k, body] of [["otherTimeline", text.replace(M.timeline.sha1, "0".repeat(40))],
    ["otherN", text.replace(`"frames":${N},`, `"frames":${N - 1},`)]]) {
    if (body === text) { cases[k] = { ok: false, why: "could not alter the manifest" }; continue; }
    const page = await open(`fallback-${k}`, vp, { respond: [/\/hero\/manifest\.json$/, body] });
    const s = await labelledStill(page);
    const why = await page.evaluate(() => window.__hero.failed.join(" | "));
    cases[k] = { ...s, why: why.slice(0, 160), bins: page.bins.length, ok: s.ok && page.bins.length === 0 };
    await page.close();
  }

  // 5. no AVIF decoder: every AVIF decode refused, as in a browser without it;
  // the page finds out from its probe before fetching a frame
  {
    const page = await open("fallback-avif", vp, { init: () => {
      const orig = window.createImageBitmap.bind(window);
      window.createImageBitmap = (src, ...a) => (src instanceof Blob && src.type === "image/avif"
        ? Promise.reject(new DOMException("no AVIF here", "InvalidStateError")) : orig(src, ...a));
    } });
    const s = await labelledStill(page);
    cases.avif = { ...s, bins: page.bins.length, ok: s.ok && page.bins.length === 0 };
    await page.close();
  }

  // 6. a TRANSIENT failure (the cases above are permanent 404s): the first
  // request of the first pass and of one contiguous segment answered 503. Both
  // are tried again: the page stays live on the set the rule picks, every
  // frame arrives, nothing is recorded as failed, and inside that segment the
  // canvas holds the frame's own pixels, not a first-pass stand-in
  {
    const picked = ruleFor(701, 1);
    const seg = M.sets.find(s => s.width === picked).segments[13];
    // (a segment's file is relative to the hashed directory: "720/416-447.bin")
    const re = new RegExp(`/hero/v\\d+-[0-9a-f]+/${picked}/(first|${seg.file.split("/").pop().replace(/\.bin$/, "")})\\.bin$`);
    // (the browser's cache off: an earlier page's copy of the first pass would
    // be served without a request, and nothing would fail)
    const page = await open("fallback-transient", vp, { failOnce: { re, seen: new Set() }, expect: re, setup: p => p.setCacheEnabled(false) });
    await loaded(page);
    const f = seg.frames[Math.floor(seg.frames.length / 2) - 1];
    await goPx(page, pxOfFrame(f));
    // the page's own requests (the gate's pixel check fetches the segment too)
    const hits = page.bins.filter(u => re.test(`/${u}`)), tries = hits.length;
    const r = await pixels(page, f, f - 6, picked);
    const s = await page.evaluate(() => { const h = window.__hero; return { mode: h.mode, set: h.set, failed: h.failed, retries: h.retries, loaded: h.loaded }; });
    cases.transient = { picked, segment: seg.file, ...s, requests: tries, requested: hits.map(u => u.split("/").pop()), frame: r,
      ok: s.mode === "live" && s.set === picked && s.failed.length === 0 && s.retries === 2 && s.loaded === N && tries === 4 && pixelsOk(r, f) };
    await page.close();
  }

  check("HERO-FALLBACK", Object.values(cases).every(c => c.ok), cases);
});

// ------------------------------------------------------------------ errors
await desk.close();
ran.add("HERO-NO-ERRORS");
check("HERO-NO-ERRORS", errors.length === 0, { errors: errors.slice(0, 12), count: errors.length });

await browser.close();
const partial = ran.size < CHECKS.length;
if (partial) console.log(`PARTIAL: ${ran.size} of ${CHECKS.length} checks run${process.env.HERO_ONLY_OK === "1" ? " (HERO_ONLY_OK=1)" : "; set HERO_ONLY_OK=1 for a subset on purpose"}`);
console.log(failures ? `done — ${failures} FAILED` : partial ? "done — the checks run passed" : "done — all hero checks passed");
process.exitCode = failures || (partial && process.env.HERO_ONLY_OK !== "1") ? 1 : 0;
