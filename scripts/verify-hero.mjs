// HERO-* (browser) — the landing hero driven the way a visitor drives it: by
// scrolling. puppeteer-core against the vite server on 5199, like the rest of
// the suite; run by scripts/run-tests.mjs.
//
// navigator.gpu is taken away on every page this script opens. The hero must
// not depend on WebGPU (landing.ts boots it above the GPU gate), and with no
// GPU the lens and materials sims stay off, so nothing here competes with them.
//
// Thirteen checks, each in its own try/catch so an exception reports as a FAIL:
//   HERO-BOOT           live mode with no WebGPU, the "heroAct" pin, its length,
//                       only the skeleton fetched until the first scroll and then
//                       every frame, the set chosen by the rule (the smallest one
//                       at least as wide as the canvas in device px)
//   HERO-NONBLANK       canvas pixels differ from #0a0b0d at pin progress 0, 0.5
//                       and 0.95
//   HERO-FRAME-FOLLOWS  scrolling (forward through all four chapters, then back)
//                       lands the drawn frame on round(p x 179), and the canvas
//                       PIXELS are that frame's: the gate decodes the expected
//                       file itself and compares, with a frame six away as the
//                       control
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
//                       written (the cool chapter's physics corrected, and the
//                       retracted "shape locked in" / "one grain" / steel-alt
//                       wording banned), revealed by opacity and translate
//                       only: never split into lines, never blurred, and a real
//                       fade rather than a cut; before the text timeline exists
//                       no heading shows and the end link EXISTS and is not
//                       hit-testable
//   HERO-CTA            the opening's links reachable at the top (hit-tested, not
//                       just visible) and unreachable once faded, the end's CTA
//                       reachable in the hold, and ONE filled pill on screen at
//                       every stop: the header's "Open the instrument"
//   HERO-CAPTION        the caption present, linked, directly under the render
//                       and hit-testable at progress 0, 0.5 and 0.95
//   HERO-REDUCED        prefers-reduced-motion: no pin, the poster, all five
//                       marks at the poster's anchors numbered like their rows,
//                       the chapter text stacked
//   HERO-NOJS           JavaScript off: the 1200 poster as a plain <img> with alt
//   HERO-MOBILE         390 x 844 @3: the 1200 set, no rendered text or link
//                       past either edge of the screen at any stop of the pin or
//                       in the still, frame centered with the copy under it,
//                       every feature's row lit and shown in its window with
//                       its line in the slot under the rail and that slot
//                       visible, titles only in the rows
//   HERO-FIT            the live column at 1024 x 768 and 1366 x 657: the
//                       opening, the rail at every tour stop and the end
//                       chapter inside the column beside the frame, on screen;
//                       844 x 390 (a phone sideways) gets the unpinned still
//                       with both opening links reachable; at 320 x 640 the
//                       fixed header's children stay on screen
//   HERO-FALLBACK       the still the comments promise, served broken three
//                       ways: no manifest (the poster alone), frames missing in
//                       both sets (the still with its five labels and nothing
//                       of live mode left behind), the 1200 set missing (live on
//                       the 600 set, its pixels checked)
//   HERO-NO-ERRORS      no page error, console error or failed same-origin
//                       request on any page this script opened, except the
//                       failures HERO-FALLBACK causes on purpose
//
//   node scripts/verify-hero.mjs        (vite must be serving on 5199)
import puppeteer from "puppeteer-core";

const URL = "http://localhost:5199/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BG = [10, 11, 13];
// the copy as the spec wrote it; the page is checked against these, not against itself
const COPY = {
  tip: ["TIP", "A paraboloid, rounded by surface tension."],
  primary: ["PRIMARY ARM ⟨100⟩", "Grows along a cube axis of the crystal."],
  lambda2: ["SECONDARY ARM SPACING λ₂", "Finer spacing usually means a stronger casting."],
  tertiary: ["TERTIARY ARM", "A branch on a branch."],
  neck: ["NECKED ROOT", "Side arms thin here, and some melt off."],
};
const CHAPTER_COPY = {
  grow: ["It grows in branches.", "A metal crystal freezing out of its melt does not stay a ball. It sends arms out along the directions its lattice prefers."],
  cool: ["It coarsens as it cools.", "While melt remains between the arms, thin ones melt back and thick ones grow. The slower it cools, the coarser the spacing it keeps."],
  end: ["Grow your own.", "The instrument solves the phase-field equations on your GPU. Change the melt and the branches change."],
};
// Retracted by the physics review (v8 D1): the arms keep coarsening while the
// crystal cools, so its shape is not "locked in"; "one grain of the metal" is
// false for steel, whose solidification grains transform on cooling; and the
// render is a satin finish, not a steel. None may come back in the hero's text
// or its poster's alt.
const RETRACTED = [/locked in/i, /one grain of the metal/i];
const ALT_BANNED = /steel/i;
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
  try { await fn(); } catch (e) { check(name, false, { threw: String(e).split("\n")[0].slice(0, 220) }); }
};
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- harness
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new", args: ["--hide-scrollbars"],
});

/** `missing`: same-origin URLs this page answers with a 404 on purpose;
 *  `expect`: URLs whose 404s and aborted requests are that purpose and not an
 *  error (a set that fails aborts the fetches it still had in flight). */
async function open(tag, viewport, { reduced = false, js = true, missing = null, expect = null, delay = null, waitUntil = "networkidle0" } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  if (!js) await page.setJavaScriptEnabled(false);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(Navigator.prototype, "gpu", { configurable: true, get() { return undefined; } });
  });
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const expected = u => !!expect && expect.test(u);
  // the page counter is third-party and says so on the console; stub it
  await page.setRequestInterception(true);
  page.on("request", r => {
    if (r.url().includes("gc.zgo.at")) return r.respond({ status: 200, contentType: "application/javascript", body: "" });
    if (missing && r.url().startsWith(URL) && missing.test(r.url())) return r.respond({ status: 404, contentType: "text/plain", body: "gone on purpose" });
    if (delay && delay.re.test(r.url())) return void setTimeout(() => r.continue().catch(() => {}), delay.ms);
    return r.continue();
  });
  page.on("pageerror", e => errors.push(`${tag}: pageerror ${e.message}`));
  page.on("console", msg => {
    if (msg.type() === "error" && !expected(msg.location()?.url ?? "")) errors.push(`${tag}: console.error ${msg.text()}`);
  });
  page.on("requestfailed", r => { if (r.url().startsWith(URL) && !expected(r.url())) errors.push(`${tag}: requestfailed ${r.url()}`); });
  page.on("response", r => { if (r.url().startsWith(URL) && r.status() >= 400 && !expected(r.url())) errors.push(`${tag}: HTTP ${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil, timeout: 30000 });
  return page;
}

/** The hero fetches only its skeleton until the visitor moves; a one-pixel
 *  scroll is that move. Then every frame of the set in use. */
const loaded = async page => {
  await page.evaluate(() => window.scrollBy(0, 1));
  await page.waitForFunction(
    () => window.__hero && window.__hero.manifest && window.__hero.loaded >= window.__hero.manifest.frames,
    { timeout: 30000 });
};

/** the frame-size rule, computed independently: the smallest set at least as
 *  wide as the canvas in device px, else the largest */
const ruleOf = page => page.evaluate(() => {
  const dev = document.getElementById("heroCanvas").getBoundingClientRect().width * devicePixelRatio;
  const s = [...window.__hero.manifest.sizes].sort((a, b) => a - b);
  return { size: window.__hero.size, rule: s.find(x => x >= Math.floor(dev)) ?? s.at(-1), dev: Math.round(dev) };
});

/** scroll to px of pin travel and wait for the scrub to land and the frame to be drawn */
async function goPx(page, px) {
  const want = await page.evaluate(px => {
    const st = window.__hero.st;
    const y = Math.round(st.start + px);
    window.scrollTo(0, y);
    return Math.min(1, Math.max(0, (y - st.start) / (st.end - st.start)));
  }, px);
  // three things, in order: the trigger has SEEN the new scroll (otherwise a
  // stale progress equals a stale proxy and everything below is trivially
  // true), the scrub has caught up with it, and the frame it asks for is drawn
  await page.waitForFunction(want => {
    const h = window.__hero;
    return Math.abs(h.st.progress - want) < 1e-3 && Math.abs(h.p - h.st.progress) < 2e-4 && h.frame === h.target;
  }, { timeout: 8000 }, want);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
const pxOfFrame = (f, N, framePx) => (f / (N - 1)) * framePx;

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
      num: num ? { text: num.textContent, shown: num.style.display !== "none" && getComputedStyle(num).display !== "none" } : null,
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
const stillLabels = (co, poster) => {
  const map = mapper(co.canvas);
  return Object.entries(COPY).map(([id, [title, line]], k) => {
    const c = co.out[id];
    const want = pairsOf(poster.anchors[id]).map(map);
    const onAnchor = !!c && (id === "primary" ? near(c.dots[0], want[0]) && c.pathPts.some(p => near(p, want[1]))
      : want.every((w, k) => near(c.dots[k], w)));
    const n = String(k + 1).padStart(2, "0");
    return { id, shown: !!c && c.opacity > 0.99 && c.visibility === "visible" && c.gVisibility === "visible",
      words: !!c && c.title === title && c.line === line, lineShown: !!c && c.lineShown, onAnchor,
      numbered: !!c && c.idx === n && !!c.num && c.num.shown && c.num.text === n };
  });
};

/** The canvas against a frame file the gate fetches, decodes and draws itself
 *  the way the page does, and against a control frame: mean absolute
 *  difference per channel over every 4th pixel of the region where either the
 *  expected or the control picture has crystal. A whole-canvas mean would
 *  divide every difference by the background's share, which is almost all of
 *  a seed frame, so the control could not tell a nucleus from its neighbor. */
const pixels = (page, f, g, size, pattern) => page.evaluate(async (f, g, size, pattern) => {
  const h = window.__hero;
  const c = document.getElementById("heroCanvas");
  const live = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const name = i => pattern.replace(/\{i:0(\d+)d\}/, (_, w) => String(i).padStart(+w, "0"));
  const draw = async i => {
    const bmp = await createImageBitmap(await (await fetch(`hero/${size}/${name(i)}`)).blob());
    const oc = new OffscreenCanvas(c.width, c.height);
    const x = oc.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.fillStyle = "#0a0b0d"; x.fillRect(0, 0, c.width, c.height);
    const s = Math.min(c.width / bmp.width, c.height / bmp.height);
    x.drawImage(bmp, (c.width - bmp.width * s) / 2, (c.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const exp = await draw(f), ctl = await draw(g);
  const W = c.width, H = c.height;
  const lit = (d, k) => Math.abs(d[k] - 10) + Math.abs(d[k + 1] - 11) + Math.abs(d[k + 2] - 13) > 24;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    if (lit(exp, k) || lit(ctl, k)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { drawn: h.frame, target: h.target, mix: h.posterMix, size: h.size, same: null, control: null, region: 0 };
  const mad = d => {
    let s = 0, n = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      const k = (y * W + x) * 4;
      s += Math.abs(d[k] - live[k]) + Math.abs(d[k + 1] - live[k + 1]) + Math.abs(d[k + 2] - live[k + 2]); n += 3;
    }
    return s / n;
  };
  return { drawn: h.frame, target: h.target, mix: h.posterMix, size: h.size, same: +mad(exp).toFixed(3), control: +mad(ctl).toFixed(3),
    region: +(((x1 - x0 + 1) * (y1 - y0 + 1)) / (W * H)).toFixed(3) };
}, f, g, size, pattern);
// a match is the same browser's decode and draw on both sides, so near
// bit-identical in practice; 0.1 leaves room for nothing else, and the
// control has to clear both a floor and three times the match
const pixelsOk = (r, f) => r.drawn === f && r.target === f && r.mix === 0 && r.same !== null
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
  const SEL = "#heroOpen *, .chap .kicker, .chapHead, .chapBody, .chapSide .cta a, .heroTour .kicker, .callout, .railNote, .heroCaption, #topnav .hdr__mark, #topnav a, #topnav summary";
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

// ------------------------------------------------------------- the live page
const desk = await open("desktop", { width: 1440, height: 900, deviceScaleFactor: 1 });
let M = null, N = 180, FRAME_PX = 3200, HOLD_PX = 560, SIZE = 0;
const visAt = (id, f) => M.anchors[id][f].at(-1) === 1;
/** the visible frame nearest a feature window's middle */
const midVisible = feat => {
  const mid = (feat.from + feat.to) / 2;
  return range(feat.from, feat.to).filter(x => visAt(feat.id, x)).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
};

await block("HERO-BOOT", async () => {
  // before the visitor moves: the skeleton (frame 0, every 8th, the last) and
  // no more, measured after the network has gone quiet and stayed quiet
  await desk.waitForFunction(() => {
    const h = window.__hero;
    if (!h?.manifest) return false;
    const n = h.manifest.frames;
    return h.loaded >= Math.ceil(n / 8) + ((n - 1) % 8 ? 1 : 0);
  }, { timeout: 15000 });
  await sleep(700);
  const before = await desk.evaluate(() => {
    const n = window.__hero.manifest.frames;
    const want = new Set([0, n - 1]);
    for (let i = 0; i < n; i += 8) want.add(i);
    return { loaded: window.__hero.loaded, skeleton: want.size, frames: n };
  });
  await loaded(desk);
  const s = await desk.evaluate(() => {
    const h = window.__hero;
    const cv = document.getElementById("heroCanvas");
    return {
      gpu: typeof navigator.gpu, mode: h.mode, id: h.st?.vars?.id, pin: !!h.st?.vars?.pin,
      len: h.st ? Math.round(h.st.end - h.st.start) : null, spacer: document.getElementById("heroAct").parentElement.classList.contains("pin-spacer"),
      loaded: h.loaded, failed: h.failed, frames: h.manifest.frames, framePx: h.framePx, holdPx: h.holdPx,
      canvasDevicePx: cv.width, cssPx: cv.getBoundingClientRect().width * devicePixelRatio,
      manifest: h.manifest,
    };
  });
  const r = await ruleOf(desk);
  M = s.manifest; N = s.frames; FRAME_PX = s.framePx; HOLD_PX = s.holdPx; SIZE = r.size;
  delete s.manifest;
  const deferred = before.loaded === before.skeleton && before.skeleton < before.frames;
  const ok = s.gpu === "undefined" && s.mode === "live" && s.id === "heroAct" && s.pin && s.spacer
    && s.len === FRAME_PX + HOLD_PX && s.loaded === N && s.failed.length === 0 && deferred
    && r.size === r.rule && Math.abs(s.canvasDevicePx - s.cssPx) <= 1;
  check("HERO-BOOT", ok, { ...s, beforeScroll: before, deferred, set: r });
});

await block("HERO-NONBLANK", async () => {
  const rows = [];
  for (const p of [0, 0.5, 0.95]) {
    await goPx(desk, p * (FRAME_PX + HOLD_PX));
    const r = await desk.evaluate((bg) => {
      const c = document.getElementById("heroCanvas");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24) n++;
      return { frame: window.__hero.frame, lit: n, total: d.length / 4 };
    }, BG);
    // progress 0 is the seed: a tiny glowing nucleus, so only a handful of
    // pixels; past it the crystal covers a real share of the frame
    const need = p === 0 ? 12 : 0.01 * r.total;
    rows.push({ p, ...r, need: Math.round(need), ok: r.lit >= need });
  }
  check("HERO-NONBLANK", rows.every(r => r.ok), rows);
});

await block("HERO-FRAME-FOLLOWS", async () => {
  const rows = [];
  // forward through all four chapters (seed 8, grow 24 and 60, cool 100, tour
  // 150 and the last frame), then BACK: a scrubber that only advances would
  // pass a forward-only walk. Each stop names its control, six frames away.
  for (const [f, g] of [[8, 14], [24, 18], [60, 54], [100, 94], [150, 144], [N - 1, N - 7], [40, 34]]) {
    await goPx(desk, pxOfFrame(f, N, FRAME_PX));
    const r = await pixels(desk, f, g, SIZE, M.pattern);
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
    await goPx(desk, pxOfFrame(f, N, FRAME_PX));
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
    const words = c.title === COPY[id][0] && c.line === COPY[id][1] && c.lineShown;
    // unlit and unmarked outside the window, on both sides where there is a
    // frame to test
    const outside = [];
    for (const g of [feat.from - 3, feat.to + 3]) {
      if (g < 0 || g > N - 1) continue;
      await goPx(desk, pxOfFrame(g, N, FRAME_PX));
      const o = (await readCallouts(desk)).out[id];
      outside.push({ frame: g, hidden: !o.on && o.gOpacity === 0 && o.gVisibility === "hidden" });
    }
    // and wherever the manifest says the point is occluded: no mark, no
    // leader, while the row keeps its place in the tour
    const occluded = [];
    for (const g of inWin.filter(x => !visAt(id, x))) {
      await goPx(desk, pxOfFrame(g, N, FRAME_PX));
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
      await goPx(desk, pxOfFrame(g, N, FRAME_PX));
      const o = (await readCallouts(desk)).out[id];
      // hidden: no mark, and the row still lit (its place in the tour does
      // not flicker with the anchor)
      synthetic[k] = k === "hiddenAt" ? o.gOpacity === 0 && o.gVisibility === "hidden" && o.on
        : o.gOpacity > 0.99 && o.gVisibility === "visible";
    }
  } finally { await flip(1); }
  const syntheticOk = synthetic.hiddenAt && synthetic.shownBefore && synthetic.shownAfter;
  // the hold: the last window runs to the last frame, and the hold must clear it
  await goPx(desk, FRAME_PX + HOLD_PX - 4);
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
  const ch = Object.fromEntries(M.chapters.map(c => [c.id, c]));
  const stops = [
    { at: "start", px: 0, want: "open" },
    { at: "grow", px: pxOfFrame(Math.round((ch.grow.from + ch.grow.to) / 2), N, FRAME_PX), want: "grow" },
    { at: "cool", px: pxOfFrame(Math.round((ch.cool.from + ch.cool.to) / 2) - 2, N, FRAME_PX), want: "cool" },
    { at: "tour", px: pxOfFrame(Math.round((ch.tour.from + ch.tour.to) / 2), N, FRAME_PX), want: null },
    { at: "hold", px: FRAME_PX + HOLD_PX - 4, want: "end" },
  ];
  const rows = [];
  let copy = null;
  for (const s of stops) {
    await goPx(desk, s.px);
    const r = await readChapters(desk);
    copy ??= r;
    const ids = ["grow", "cool", "end"];
    // the rail is the tour's text: shown there and only there
    const ok = ids.every(id => (id === s.want ? r[id].shown : r[id].hidden))
      && (s.want === "open" ? r.open.shown : r.open.hidden)
      && (s.at === "tour" ? r.tour.shown : r.tour.hidden);
    rows.push({ at: s.at, want: s.want, shown: ids.filter(id => r[id].shown), open: r.open.shown, tour: r.tour.shown, ok });
  }
  // the copy as written (exact case: the display face is sentence case), in
  // whole blocks: the line splitter and its blur-in are gone (v8 D1)
  const words = Object.entries(CHAPTER_COPY).map(([id, [h, b]]) => ({
    id, head: copy[id].head === h, body: copy[id].body === b, parts: copy[id].parts, unsplit: copy[id].split === 0,
  }));
  const retracted = RETRACTED.filter(re => re.test(copy.text)).map(String);
  const altOk = !ALT_BANNED.test(copy.alt) && /satin/i.test(copy.alt);
  // THE REVEAL IS RESTRAINED: walk the grow chapter's arrival in 12 px steps.
  // Every part of every chapter carries no filter at every step (no blur-in),
  // and the heading passes through partial opacity on the way (a fade, not a
  // cut, so the restraint is not bought by deleting the motion).
  const ch0 = Object.fromEntries(M.chapters.map(c => [c.id, c]));
  const g0 = pxOfFrame(ch0.grow.from, N, FRAME_PX);
  const reveal = { steps: 0, filters: new Set(), partial: 0 };
  for (let px = g0; px <= g0 + 300; px += 12) {
    await goPx(desk, px);
    const r = await readChapters(desk);
    reveal.steps++;
    for (const id of ["grow", "cool", "end"]) for (const f of r[id].filters) reveal.filters.add(f);
    if (r.grow.headOpacity > 0.05 && r.grow.headOpacity < 0.95) reveal.partial++;
  }
  const revealOk = reveal.steps >= 20 && [...reveal.filters].every(f => f === "none") && reveal.partial >= 1;
  // BEFORE the timeline exists: the three chapters share one place, so with
  // the manifest held back 2.5 s, live mode must show none of them (they
  // would print over each other) and the end chapter's link must not take a
  // click; then, once the manifest lands, the timeline takes over
  const page = await open("chapters-early", { width: 1440, height: 900, deviceScaleFactor: 1 },
    { delay: { re: /\/hero\/manifest\.json$/, ms: 2500 }, waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hero?.mode === "live", { timeout: 15000 });
  await sleep(400);
  const early = await page.evaluate(() => ({
    live: document.documentElement.classList.contains("hero-live"), manifest: !!window.__hero.manifest,
    heads: [...document.querySelectorAll(".chap .chapHead")].map(h => getComputedStyle(h).visibility),
  }));
  // the end chapter's link by the selector HERO-CTA uses: it must EXIST and
  // be unreachable, so a selector that finds nothing fails instead of passing
  const endCta = await hit(page, '.chap[data-chap="end"] .cta a');
  await page.waitForFunction(() => document.getElementById("heroAct").classList.contains("hero-ready"), { timeout: 15000 });
  const after = await readChapters(page);
  await page.close();
  const earlyOk = early.live && !early.manifest && early.heads.length === 3 && early.heads.every(v => v === "hidden")
    && endCta.exists && !endCta.reachable && after.open.shown && ["grow", "cool", "end"].every(id => after[id].hidden);
  check("HERO-CHAPTERS", rows.every(r => r.ok) && words.every(w => w.head && w.body && w.unsplit && w.parts >= 3)
    && retracted.length === 0 && altOk && revealOk && earlyOk,
    { rows, words, retracted, altOk, reveal: { ...reveal, filters: [...reveal.filters], ok: revealOk },
      beforeTimeline: { ...early, endCtaExists: endCta.exists, endCtaReachable: endCta.reachable, ok: earlyOk } });
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
  await goPx(desk, pxOfFrame(50, N, FRAME_PX));
  const faded = [];
  for (let k = 1; k <= links.length; k++) faded.push((await hit(desk, `#heroOpen .cta a:nth-child(${k})`)).reachable);
  pill.push(await hit(desk, "#topnav .btn--primary"));
  filled.push(await filledOnScreen(desk));
  await goPx(desk, FRAME_PX + HOLD_PX - 4);
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
    await goPx(desk, p * (FRAME_PX + HOLD_PX));
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

// ---------------------------------------------------------- reduced motion
/** the still page: poster, labels, stacked text */
async function readStill(page) {
  return page.evaluate(() => {
    const img = document.getElementById("heroStill");
    const cs = getComputedStyle(img);
    const st = document.getElementById("heroAct");
    const y0 = st.getBoundingClientRect().top;
    const open = document.getElementById("heroOpen");
    return {
      mode: window.__hero?.mode ?? null, pinned: !!window.__hero?.st, hasLiveClass: document.documentElement.classList.contains("hero-live"),
      spacer: st.parentElement.classList.contains("pin-spacer"), spacers: document.querySelectorAll(".pin-spacer").length,
      ready: st.classList.contains("hero-ready"),
      img: { shown: cs.display !== "none" && cs.visibility === "visible", w: img.getBoundingClientRect().width, natural: img.naturalWidth,
        src: img.currentSrc || img.src, alt: img.alt },
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
  const labels = stillLabels(await readCallouts(page), M.poster);
  const ok = s.mode === "still" && !s.pinned && !s.spacer && !s.hasLiveClass && Math.abs(moved - (s.y0 - 400)) < 2
    && s.img.shown && s.img.natural > 0 && /hero\/poster-\d+\.webp$/.test(s.img.src) && !s.canvasShown
    && labels.every(l => l.shown && l.words && l.lineShown && l.onAnchor && l.numbered)
    && s.chapters.length === 3 && s.chapters.every(c => c.shown && !c.split);
  check("HERO-REDUCED", ok, { ...s, movedWithPage: moved - s.y0, labels });
  await page.close();
});

await block("HERO-NOJS", async () => {
  const page = await open("nojs", { width: 1440, height: 900, deviceScaleFactor: 1 }, { js: false });
  const s = await readStill(page);
  const ok = s.img.shown && s.img.natural === 1200 && s.img.src.endsWith("hero/poster-1200.webp")
    && s.img.alt.length >= 40 && /dendrite/i.test(s.img.alt) && !s.canvasShown && !s.hasLiveClass
    && s.chapters.every(c => c.shown);
  check("HERO-NOJS", ok, { img: s.img, canvasShown: s.canvasShown, liveClass: s.hasLiveClass, chapters: s.chapters });
  await page.close();
});

// ------------------------------------------------------------------ phone
await block("HERO-MOBILE", async () => {
  const vp = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const page = await open("mobile", vp);
  await loaded(page);
  // at DPR 3 the frame is ~1080 device px: the 1200 set, by the rule
  const set = await ruleOf(page);
  const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw: innerWidth }));
  const rows = [];
  const grow = M.chapters.find(c => c.id === "grow");
  const stops = [["start", 0], ["grow", pxOfFrame(Math.round((grow.from + grow.to) / 2), N, FRAME_PX)],
    ...M.features.map(f => [f.id, pxOfFrame(midVisible(f), N, FRAME_PX)]), ["hold", FRAME_PX + HOLD_PX - 4]];
  let stacked = null;
  const labels = [];
  for (const [at, px] of stops) {
    await goPx(page, px);
    const o = await overflow();
    const lo = await leafOverflow(page);
    // the document's own width for anything outside the hero, the leaves for
    // everything inside it and the fixed bar
    rows.push({ at, over: o.sw - o.cw, leaves: lo.leaves, offScreen: lo.bad, ok: o.sw <= o.cw && o.cw <= o.iw && lo.leaves > 0 && lo.badCount === 0 });
    if (at === "grow") {
      stacked = await page.evaluate(() => {
        const c = document.getElementById("heroCanvas").getBoundingClientRect();
        const h = document.querySelector('.chap[data-chap="grow"] .chapHead').getBoundingClientRect();
        const b = document.querySelector('.chap[data-chap="grow"] .chapBody').getBoundingClientRect();
        return { centered: Math.abs(c.left + c.width / 2 - innerWidth / 2) <= 1, headBelow: h.top >= c.bottom - 2, bodyBelowHead: b.top >= h.bottom - 2 };
      });
    }
    if (M.features.some(f => f.id === at)) {
      // the row lit AND shown (the rail block faded in: the rows carry no
      // opacity of their own, the .heroTour block does), titles only, its
      // line in the slot under the rail and that slot actually visible (its
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
  const sl = Object.values((await readCallouts(still)).out).map(c => ({ shown: c.visibility === "visible", lineHidden: !c.lineShown, inView: c.rect.left >= 0 && c.rect.right <= 390 }));
  await still.close();
  const ok = set.size === set.rule && set.size === 1200
    && rows.every(r => r.ok) && stacked?.centered && stacked.headBelow && stacked.bodyBelowHead
    && labels.length === M.features.length
    && labels.every(l => l.on && l.shown && l.lineHidden && l.inView && l.note && l.noteAlpha > 0.99 && l.numbered && l.noLeader)
    && so.sw <= so.cw && slo.leaves > 0 && slo.badCount === 0 && sl.length === 5 && sl.every(l => l.shown && l.lineHidden && l.inView);
  check("HERO-MOBILE", ok, { set, rows, stacked, labels, still: { overflow: so.sw - so.cw, leaves: slo.leaves, offScreen: slo.bad, labels: sl } });
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
    const stops = [["open", 0, "#heroOpen"], ...M.features.map(f => [f.id, pxOfFrame(midVisible(f), N, FRAME_PX), ".heroTour"]),
      ["hold", FRAME_PX + HOLD_PX - 4, '.chap[data-chap="end"]']];
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
    cases.manifest = { ...s, callouts, ok: !s.hasLiveClass && s.spacers === 0 && !s.pinned && s.img.shown && !s.canvasShown
      && callouts === 0 && s.chapters.every(c => c.shown && !c.split) };
    await page.close();
  }

  // 2. frames 100 on missing from BOTH sets: frame 0 arrives, so each set is
  // failed by count (more than a tenth), the 600 set is tried after the 1200,
  // and then the still, with the manifest it already has: five labels on the
  // poster's anchors, and nothing of live mode left in the page
  {
    const page = await open("fallback-frames", vp,
      { missing: /\/hero\/(600|1200)\/f1\d\d\.webp$/, expect: /\/hero\/(600\/|1200\/|poster-)/ });
    await page.evaluate(() => window.scrollBy(0, 1));   // past the skeleton
    await page.waitForFunction(() => window.__hero?.mode === "failed" && document.querySelectorAll(".callout").length === 5
      && document.getElementById("heroStill").complete && document.getElementById("heroStill").naturalWidth > 0, { timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    const s = await readStill(page);
    const co = await readCallouts(page);
    const labels = stillLabels(co, M.poster);
    const why = await page.evaluate(() => window.__hero.failed.length);
    cases.frames = { ...s, failuresRecorded: why, calloutEls: co.calloutEls, markEls: co.markEls, labels,
      ok: !s.hasLiveClass && s.spacers === 0 && !s.pinned && !s.ready && s.img.shown && !s.canvasShown
        && co.calloutEls === 5 && co.markEls === 5 && labels.every(l => l.shown && l.words && l.onAnchor && l.numbered)
        && s.chapters.every(c => c.shown && !c.split) && s.openInline.length === 0 && s.srBodies === 0 && why > 0 };
    await page.close();
  }

  // 3. the 1200 set missing (frames and poster): live on the 600 set, and the
  // canvas holds the 600 file's pixels, not merely its index
  {
    const re = /\/hero\/(1200\/|poster-1200)/;
    const page = await open("fallback-size", vp, { missing: re, expect: re });
    await loaded(page);
    const f = 60;
    await goPx(page, pxOfFrame(f, N, FRAME_PX));
    const r = await pixels(page, f, f - 6, 600, M.pattern);
    const s = await page.evaluate(() => ({ mode: window.__hero.mode, size: window.__hero.size, pinned: !!window.__hero.st, failed: window.__hero.failed.length }));
    cases.size = { ...s, frame: r, ok: s.mode === "live" && s.size === 600 && s.pinned && s.failed > 0 && pixelsOk(r, f) };
    await page.close();
  }

  check("HERO-FALLBACK", Object.values(cases).every(c => c.ok), cases);
});

// ------------------------------------------------------------------ errors
await desk.close();
check("HERO-NO-ERRORS", errors.length === 0, { errors: errors.slice(0, 12), count: errors.length });

await browser.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all hero checks passed");
process.exitCode = failures ? 1 : 0;
