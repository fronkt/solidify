// LANDING-* (browser, WebGPU) — the three live acts below the hero, the
// composer and science acts, and the footer, held to docs/DESIGN.md section 6:
// a live canvas on one side (square-edged, no card), a spec column on the
// other, and every number in that column REAL: a live readout of the running
// melt, a constant the page hands its sim, or a field of materials.ts. Run by
// scripts/run-tests.mjs against the vite server (port 5199 unless given).
//
// The acts are driven the way a visitor drives them, by scrolling, and the
// expected values are the gate's own: the materials rows are recomputed here
// from materials.ts (imported into the page as a module, not read off the
// rail), the live rows are compared against the sim's own stats read at the
// same frozen moment, and the copy against docs/COPY-STYLE.md's bans.
//
// Nine checks, each in its own try/catch so an exception reports as a FAIL:
//   LANDING-LENS-SPEC   all ten lens stops: the name is LENS_NAMES[i] in order,
//                       the counter and the lit segment follow it, the two word
//                       rows change with the lens (ten distinct pairs, ten
//                       distinct lines), and the live rows are present
//   LANDING-LENS-LIVE   with the melt frozen, the rail's own read writes the
//                       rail, and the rail must print exactly the solid
//                       fraction and grain count of the GATE's own read of the
//                       lens sim; the grid row is the sim's side; left running,
//                       the solid fraction on screen changes by itself
//   LANDING-MAT-SPEC    all four melt stops: name, and a rail that is exactly the
//                       rows materials.ts supports (melting point from si.Tm,
//                       noted "pure Fe" / "pure Al" where si.source names an
//                       alloy system; structure from the note's first segment;
//                       symmetry from params.aniMode; the glow scale from
//                       params.meltGlow, labeled a display setting), no others
//   LANDING-3D-SPEC     the TRUE 3D rail: grid is the volume's own side cubed,
//                       the symmetry the gate words from the volume's own
//                       aniMode3, raymarched, and, with the volume frozen, a
//                       live solid fraction of at least 1 % equal to the gate's
//                       own read of the volume
//   LANDING-ACT-LAYOUT  1440 x 900, 1366 x 657 and 390 x 844: every canvas
//                       square, radius 0, no border or shadow on it or its box;
//                       desktop media and column side by side (lens and TRUE
//                       3D media right, melts left), phone media above the
//                       column; at every lens and melt stop of a pinned act the
//                       media and the column sit wholly between the header and
//                       the screen's bottom; one filled pill on screen (the
//                       header's); no sideways scroll. 844 x 390 (a phone
//                       sideways): no act pinned, the hero still, each act's
//                       content inside its section, and the lens and melt
//                       names still stepping first to last with the scroll
//   LANDING-FOOTER      the footer matrix: a 1 px --rule top border, at least
//                       three groups under nav-style labels, 40 px between
//                       groups on desktop, every link reachable
//   LANDING-COPY        the text of every act at every stop and of the footer:
//                       no prose em dash (a lone "—" value is the empty glyph),
//                       no British spelling
//   LANDING-STILL       prefers-reduced-motion (no sims): the lens and TRUE 3D
//                       rails carry no number and no empty glyph, the melt rail
//                       still carries materials.ts's; the stills shown, the
//                       counters and segments gone, and the lens the column
//                       names is the one its image was captured through (the
//                       <img>'s data-lens); the same with no script at all
//   LANDING-A11Y        a link parked under the fixed header and tabbed to ends
//                       wholly below it (landing, science, contact); on a fresh
//                       landing the four links the composer and science
//                       reveals hide are fully opaque the moment Tab reaches
//                       them; at 320 px the science and contact headers stay on
//                       screen; the live canvases are named images, the recipe
//                       a group, the hero's feature list hidden and read only
//                       through the picture, the contact copy control a button
//                       with a status region
//
//   node scripts/verify-landing-acts.mjs [outDir] [port]
import puppeteer from "puppeteer-core";

const PORT = process.argv[3] ?? "5199";
const URL = `http://localhost:${PORT}/`;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// the melts the materials act steps through, by name; the page is checked
// against these and materials.ts, not against itself
const MELTS = [["steel", "Steel"], ["al", "Aluminum"], ["zn", "Zinc"], ["ice", "Ice"]];
const FG = "rgb(242, 242, 242)", FG3 = "rgb(138, 138, 138)", RULE = "rgb(38, 38, 38)";
// docs/COPY-STYLE.md: American spelling (the COMPOSER-COPY list), no prose em dash
const BRITISH = /aluminium|vapour|vaporis|modelled|labelled|colour|behaviour|favour|sulphur|centre|\bgrey|mould|programme|artefact|polaris|analys(?:e|ing)\b/i;
const proseDash = s => s.includes("—") && s.trim() !== "—";

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const block = async (name, fn) => {
  try { await fn(); } catch (e) { check(name, false, { threw: String(e).split("\n")[0].slice(0, 220) }); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- harness
// WebGPU is the point here: headless first, then a headed window (the same
// fallback verify-scroll-order.mjs uses)
async function launch(headless) {
  return puppeteer.launch({
    executablePath: CHROME, headless,
    args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars", ...(headless ? [] : ["--window-position=2600,50"])],
  });
}

async function open(browser, viewport, { reduced = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setRequestInterception(true);
  page.on("request", r => r.url().includes("gc.zgo.at")
    ? r.respond({ status: 200, contentType: "application/javascript", body: "" }) : r.continue());
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
  return page;
}

async function openLive(browser, viewport) {
  const page = await open(browser, viewport);
  const ok = await page.waitForFunction("!!window.__landing", { timeout: 15000 }).then(() => true).catch(() => false);
  if (!ok) { await page.close(); return null; }
  return page;
}

let browser = await launch("new");
let desk = await openLive(browser, { width: 1440, height: 900, deviceScaleFactor: 1 });
if (!desk) {
  await browser.close();
  console.log("headless had no WebGPU; going headed");
  browser = await launch(false);
  desk = await openLive(browser, { width: 1440, height: 900, deviceScaleFactor: 1 });
}
if (!desk) {
  console.log("LANDING-BOOT FAIL: no WebGPU in either mode, cannot verify the live acts");
  await browser.close();
  process.exit(1);
}

const pinOf = (page, id) => page.evaluate(id => {
  const t = window.__landing.ST.getAll().find(t => t.vars.pin && t.trigger.id === id);
  return t ? { start: t.start, end: t.end } : null;
}, id);
const topOf = (page, sel) => page.evaluate(sel => document.querySelector(sel).getBoundingClientRect().top + scrollY, sel);
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

/** scroll to stop k of n inside a pin and wait until the act shows it */
async function goStop(page, id, k, n, nameSel, want) {
  const pin = await pinOf(page, id);
  await page.evaluate(y => window.scrollTo(0, y), Math.round(pin.start + ((k + 0.5) / n) * (pin.end - pin.start)));
  await page.waitForFunction((sel, w) => document.querySelector(sel)?.textContent === w, { timeout: 8000 }, nameSel, want);
  await sleep(600);   // the name's own 0.35 s fade and the rows' 0.45 s one
  await frames(page);
}

/** a spec rail as rows of { label, sub, value, unit, text, live } */
const readRail = (page, sel) => page.evaluate(sel => [...document.querySelectorAll(`${sel} .spec__row`)].map(r => {
  const dd = r.querySelector(".spec__value");
  const unit = dd.querySelector(".spec__unit");
  return {
    label: r.querySelector(".spec__label").firstChild.textContent.trim(),
    sub: r.querySelector(".spec__label small")?.textContent.trim() ?? null,
    value: (dd.querySelector(".spec__v") ?? dd).firstChild.textContent.trim(),
    unit: unit && getComputedStyle(unit).display !== "none" ? unit.textContent : null,
    text: dd.classList.contains("spec__value--text"),
    live: r.dataset.live ?? null,
  };
}), sel);

/** DESIGN.md's one primary action per view: links or buttons on screen whose
 *  own background is the --fg fill */
const filledOnScreen = page => page.evaluate(fg => {
  const eff = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  return [...document.querySelectorAll("a, button")].filter(el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      && cs.visibility === "visible" && eff(el) > 0.01 && cs.backgroundColor === fg;
  }).map(el => el.textContent.trim());
}, FG);

/** the act's media box and spec column, and whether the media is flat */
const readAct = (page, id) => page.evaluate(id => {
  const sec = document.getElementById(id);
  const media = sec.querySelector(".simBox");
  const col = sec.querySelector(".specCol");
  const hdr = document.getElementById("topnav").getBoundingClientRect();
  const r = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
  const shown = [...media.querySelectorAll("canvas, img")].find(e => getComputedStyle(e).display !== "none");
  const flat = [shown, media, media.parentElement].map(e => {
    const cs = getComputedStyle(e);
    return { radius: cs.borderTopLeftRadius === "0px" && cs.borderBottomRightRadius === "0px",
      border: ["Top", "Right", "Bottom", "Left"].every(s => cs[`border${s}Width`] === "0px"), shadow: cs.boxShadow === "none" };
  });
  return { media: r(media), shown: shown ? r(shown) : null, col: r(col), header: hdr.bottom, vh: innerHeight, vw: innerWidth,
    flat: flat.every(f => f.radius && f.border && f.shadow), flatDetail: flat };
}, id);

const LENS_NAMES = await desk.evaluate(async () => (await import("/src/shaders.ts")).LENS_NAMES);
const copyBad = [];
const scanCopy = async (page, where) => {
  const texts = await page.evaluate(() => {
    const out = [];
    for (const root of document.querySelectorAll("#lensAct, #matAct, #threeDAct, #composeAct, #sciAct, footer")) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim()) out.push(n.textContent.trim());
      const aria = root.querySelectorAll("[aria-label], [alt]");
      for (const el of aria) out.push(el.getAttribute("aria-label") ?? el.getAttribute("alt"));
    }
    return out;
  });
  for (const t of texts) if (proseDash(t) || BRITISH.test(t)) copyBad.push({ where, text: t.slice(0, 120) });
  return texts.length;
};

// ------------------------------------------------------------- the lens act
const layoutBad = [];
const layoutRows = [];
const layoutAt = async (page, id, where, side) => {
  const a = await readAct(page, id);
  const bad = [];
  if (!a.shown || Math.abs(a.shown.w - a.shown.h) > 1 || Math.abs(a.media.w - a.media.h) > 1) bad.push("media not square");
  if (!a.flat) bad.push({ notFlat: a.flatDetail });
  if (side === "right" && !(a.media.left >= a.col.right)) bad.push("media not right of the column");
  if (side === "left" && !(a.media.right <= a.col.left)) bad.push("media not left of the column");
  if (side === "above" && !(a.col.top >= a.media.bottom)) bad.push("media not above the column");
  // wholly on screen, under the header
  for (const [k, b] of [["media", a.media], ["column", a.col]])
    if (b.top < a.header - 1 || b.bottom > a.vh + 1 || b.left < -1 || b.right > a.vw + 1) bad.push(`${k} off screen ${JSON.stringify(b)}`);
  const pills = await filledOnScreen(page);
  if (pills.length !== 1 || pills[0] !== "Open the instrument") bad.push({ filledPills: pills });
  layoutRows.push({ where, ok: bad.length === 0 });
  if (bad.length) layoutBad.push({ where, bad });
};

await block("LANDING-LENS-SPEC", async () => {
  const stops = [];
  for (let i = 0; i < LENS_NAMES.length; i++) {
    await goStop(desk, "lensAct", i, LENS_NAMES.length, "#lensName", LENS_NAMES[i]);
    const s = await desk.evaluate(() => ({
      name: document.getElementById("lensName").textContent,
      desc: document.getElementById("lensDesc").textContent,
      count: document.getElementById("lensCount").textContent,
      lit: [...document.querySelectorAll("#lensRail > i")].findIndex(x => x.classList.contains("is-on")),
      segs: document.querySelectorAll("#lensRail > i").length,
    }));
    const rail = await readRail(desk, "#lensSpec");
    stops.push({ i, ...s, rail });
    await layoutAt(desk, "lensAct", `1440 lens ${i}`, "right");
    await scanCopy(desk, `lens ${LENS_NAMES[i]}`);
  }
  const pairs = new Set(stops.map(s => `${s.rail[0]?.value}|${s.rail[1]?.value}`));
  const descs = new Set(stops.map(s => s.desc));
  const bad = stops.filter(s => {
    const want = `${String(s.i + 1).padStart(2, "0")} / ${String(LENS_NAMES.length).padStart(2, "0")}`;
    const labels = s.rail.map(r => r.label);
    return s.name !== LENS_NAMES[s.i] || s.count !== want || s.lit !== s.i || s.segs !== LENS_NAMES.length
      || !s.desc.trim() || s.rail.length !== 5
      || labels[0] !== "shows" || labels[1] !== "instrument" || !s.rail[0].value || !s.rail[1].value
      || !s.rail[0].text || !s.rail[1].text
      || s.rail[2].live !== "solid" || s.rail[3].live !== "grains" || labels[4] !== "grid"
      || !/live/.test(labels[2]) || !/live/.test(labels[3]);
  }).map(s => ({ i: s.i, name: s.name, count: s.count, lit: s.lit, rail: s.rail }));
  check("LANDING-LENS-SPEC", bad.length === 0 && pairs.size === LENS_NAMES.length && descs.size === LENS_NAMES.length,
    { stops: stops.length, distinctPairs: pairs.size, distinctLines: descs.size, bad,
      sample: stops.slice(0, 3).map(s => ({ name: s.name, shows: s.rail[0]?.value, instrument: s.rail[1]?.value })) });
});

await block("LANDING-LENS-LIVE", async () => {
  await goStop(desk, "lensAct", 0, LENS_NAMES.length, "#lensName", LENS_NAMES[0]);
  // left running: the solid fraction on screen changes by itself
  const readLive = () => readRail(desk, "#lensSpec").then(r => r.find(x => x.live === "solid")?.value);
  const v0 = await readLive();
  let v1 = v0;
  for (let t = 0; t < 40 && v1 === v0; t++) { await sleep(250); v1 = await readLive(); }
  // frozen: no stepping, no poll of its own; then the rail's own read, once,
  // which writes the rail, and then the GATE's own read of the sim the rail
  // sits beside. The melt is frozen, so both reads see one state, and the
  // page must print exactly what the lens sim reports: a pollLens that read
  // another sim or another stats object would agree with itself, not with
  // this. (It must not have re-poured on that read either: past 0.93 solid
  // pollLens resets the melt.)
  await desk.evaluate(() => { window.__landing.active.lens = false; });
  await sleep(300);
  let poll = null;
  for (let t = 0; t < 20 && !poll; t++) poll = await desk.evaluate(() => window.__landing.pollLens().then(x => x && { fracSolid: x.fracSolid }));
  const rail = await readRail(desk, "#lensSpec");
  let s = null;
  for (let t = 0; t < 20 && !s; t++) s = await desk.evaluate(() => window.__landing.sims.lensSim.readStats().then(x => x && { fracSolid: x.fracSolid, grainCount: x.grainCount }));
  const side = await desk.evaluate(() => window.__landing.sims.lensSim.n);
  await desk.evaluate(() => { window.__landing.active.lens = true; });
  const solid = rail.find(x => x.live === "solid"), grains = rail.find(x => x.live === "grains"), grid = rail.find(x => x.label === "grid");
  const ok = !!poll && !!s && poll.fracSolid <= 0.93 && solid?.value === (s.fracSolid * 100).toFixed(0) && solid.unit === "%"
    && grains?.value === String(s.grainCount) && s.grainCount >= 1
    && grid?.value === `${side}²` && grid.unit === "cells"
    && /^\d+$/.test(v0 ?? "") && /^\d+$/.test(v1 ?? "") && v1 !== v0;
  check("LANDING-LENS-LIVE", ok, { pollRead: poll, independentRead: s, rail, side, running: { before: v0, after: v1 } });
});

// -------------------------------------------------------- the materials act
await block("LANDING-MAT-SPEC", async () => {
  const M = await desk.evaluate(async () => {
    const { MATERIALS } = await import("/src/materials.ts");
    return JSON.parse(JSON.stringify(MATERIALS));
  });
  const rows = [], bad = [];
  for (let i = 0; i < MELTS.length; i++) {
    const [key, name] = MELTS[i];
    await goStop(desk, "matAct", i, MELTS.length, "#matName", name);
    const rail = await readRail(desk, "#matSpec");
    const m = M[key];
    // the rows materials.ts supports, recomputed here. si.Tm is the pure base
    // metal's melting point; where si.source names an ALLOY system (an en
    // dash: "Fe–C", "Al–4Cu") the row must say whose it is, "pure Fe",
    // "pure Al". The glow row is a display setting and says so.
    const sys = m.si?.source?.split(" · ")[0] ?? "";
    const tmSub = /–/.test(sys) ? `pure ${sys.match(/^[A-Z][a-z]?/)[0]}` : null;
    const want = [];
    if (m.si) want.push({ label: "melting point", sub: tmSub, value: String(Math.round(m.si.Tm - 273.15)), unit: "°C" });
    want.push({ label: "crystal structure", sub: null, value: m.note.split(" · ")[0], unit: null });
    if (m.params.aniMode) want.push({ label: "dendrite symmetry", sub: "in a 2D section", value: String(m.params.aniMode), unit: "-fold" });
    if (m.params.meltGlow !== undefined) want.push({ label: "glow scale", sub: "MELT lens display, not a measurement", value: m.params.meltGlow.toFixed(2), unit: null });
    const got = rail.map(r => ({ label: r.label, sub: r.sub, value: r.value, unit: r.unit }));
    const same = JSON.stringify(got) === JSON.stringify(want);
    rows.push({ key, name, same, got });
    if (!same) bad.push({ key, want, got });
    await layoutAt(desk, "matAct", `1440 melt ${key}`, "left");
    await scanCopy(desk, `melt ${key}`);
  }
  check("LANDING-MAT-SPEC", bad.length === 0 && rows.length === MELTS.length, { rows, bad });
});

// ---------------------------------------------------------- the TRUE 3D act
// sim3d's anisotropy modes (Sim3DParams.aniMode3: 0 isotropic, 1 cubic, 2
// hex, 3 icosahedral) as the rail must word them; the gate's own table, keyed
// by the mode the page's volume actually runs
const SYM3 = { 0: "isotropic", 1: "cubic ⟨100⟩", 2: "hexagonal", 3: "icosahedral" };

await block("LANDING-3D-SPEC", async () => {
  await desk.evaluate(y => window.scrollTo(0, y), await topOf(desk, "#threeDAct"));
  const has3d = await desk.evaluate(() => !!window.__landing.d3());
  let rail = [], stats = null, side = null, mode = null, poll = null;
  if (has3d) {
    // a volume that has grown: a live value of at least 1 %, not the first 0
    await desk.waitForFunction(() => +(document.querySelector('#d3Spec [data-live="solid"] .spec__v')?.textContent ?? "") >= 1, { timeout: 30000 });
    // frozen, as LENS-LIVE does: no stepping and no poll of its own; the
    // rail's own read writes the rail once, then the gate reads the volume
    await desk.evaluate(() => { window.__landing.active.d3 = false; });
    await sleep(300);
    for (let t = 0; t < 20 && !poll; t++) poll = await desk.evaluate(() => window.__landing.pollD3().then(x => x && { fracSolid: x.fracSolid }));
    rail = await readRail(desk, "#d3Spec");
    ({ stats, side, mode } = await desk.evaluate(async () => {
      const d = window.__landing.d3();
      let s = null;
      for (let t = 0; t < 20 && !s; t++) s = await d.sim.readStats();
      return { stats: s && { fracSolid: s.fracSolid }, side: d.sim.n, mode: d.sim.params.aniMode3 };
    }));
    await desk.evaluate(() => { window.__landing.active.d3 = true; });
  }
  await layoutAt(desk, "threeDAct", "1440 TRUE 3D", "right");
  await scanCopy(desk, "TRUE 3D");
  const by = l => rail.find(r => r.label === l);
  const solid = rail.find(r => r.live === "solid");
  const ok = has3d && by("grid")?.value === `${side}³` && by("grid")?.unit === "voxels"
    && SYM3[mode] !== undefined && by("symmetry")?.value === SYM3[mode] && by("render")?.value === "raymarched"
    && !!poll && !!stats && solid?.value === (stats.fracSolid * 100).toFixed(0) && +solid.value >= 1 && solid?.unit === "%";
  check("LANDING-3D-SPEC", ok, { has3d, side, mode, wantSymmetry: SYM3[mode], pollRead: poll, independentRead: stats, rail });
});

// -------------------------------------------------- compose, science, footer
await block("LANDING-FOOTER", async () => {
  for (const id of ["composeAct", "sciAct"]) {
    await desk.evaluate(y => window.scrollTo(0, y), await topOf(desk, `#${id}`));
    await sleep(2500);
    await scanCopy(desk, id);
    const pills = await filledOnScreen(desk);
    if (pills.length !== 1) layoutBad.push({ where: id, filledPills: pills });
  }
  await desk.evaluate(() => window.scrollTo(0, 1e7));
  await sleep(600);
  await scanCopy(desk, "footer");
  const f = await desk.evaluate(() => {
    const ft = document.querySelector("footer.ftr");
    const cs = getComputedStyle(ft);
    const grid = ft.querySelector(".ftr__grid");
    const groups = [...ft.querySelectorAll(".ftr__grid > nav")].map(n => {
      const l = n.querySelector(".ftr__label"), lc = getComputedStyle(l);
      return { label: l.textContent, upper: lc.textTransform === "uppercase", face: /Space Grotesk/.test(lc.fontFamily), color: lc.color,
        links: [...n.querySelectorAll("a")].map(a => a.textContent) };
    });
    const hit = [...ft.querySelectorAll("a")].map(a => {
      a.scrollIntoView({ block: "center" });
      const r = a.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: a.textContent, reachable: !!top && (top === a || a.contains(top)) };
    });
    return { borderTop: cs.borderTopWidth, borderColor: cs.borderTopColor, gap: getComputedStyle(grid).columnGap, groups, hit };
  });
  const ok = f.borderTop === "1px" && f.borderColor === RULE && f.gap === "40px" && f.groups.length >= 3
    && f.groups.every(g => g.upper && g.face && g.color === FG3 && g.links.length >= 1)
    && f.hit.length >= 7 && f.hit.every(h => h.reachable);
  check("LANDING-FOOTER", ok, f);
});

// ------------------------------------------------------------------- phone
await block("LANDING-ACT-LAYOUT", async () => {
  const phone = await openLive(browser, { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  if (!phone) throw new Error("the phone page never booted its sims");
  for (let i = 0; i < LENS_NAMES.length; i++) {
    await goStop(phone, "lensAct", i, LENS_NAMES.length, "#lensName", LENS_NAMES[i]);
    await layoutAt(phone, "lensAct", `390 lens ${i}`, "above");
  }
  for (let i = 0; i < MELTS.length; i++) {
    await goStop(phone, "matAct", i, MELTS.length, "#matName", MELTS[i][1]);
    await layoutAt(phone, "matAct", `390 melt ${MELTS[i][0]}`, "above");
  }
  // a 1366 x 768 laptop under its browser chrome (657 px): every stop of both
  // pinned acts still fits between the header and the bottom edge
  const lap = await openLive(browser, { width: 1366, height: 657, deviceScaleFactor: 1 });
  if (!lap) throw new Error("the 1366 x 657 page never booted its sims");
  for (let i = 0; i < LENS_NAMES.length; i++) {
    await goStop(lap, "lensAct", i, LENS_NAMES.length, "#lensName", LENS_NAMES[i]);
    await layoutAt(lap, "lensAct", `1366x657 lens ${i}`, "right");
  }
  for (let i = 0; i < MELTS.length; i++) {
    await goStop(lap, "matAct", i, MELTS.length, "#matName", MELTS[i][1]);
    await layoutAt(lap, "matAct", `1366x657 melt ${MELTS[i][0]}`, "left");
  }
  // a phone held sideways (844 x 390): no pinned column fits 390 px, so no
  // act is pinned (they scroll like a page, so nothing is out of reach), the
  // hero is the still, each act's content stays inside its own section, and
  // the lens and melt steps still follow the scroll through each act, first
  // to last
  const side = await openLive(browser, { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  if (!side) throw new Error("the 844 x 390 page never booted its sims");
  const sd = await side.evaluate(() => ({ short: window.__landing.short, heroLive: document.documentElement.classList.contains("hero-live"),
    pins: window.__landing.ST.getAll().filter(t => t.vars.pin).map(t => t.vars.id ?? t.trigger.id) }));
  const walk = async (id, nameSel) => {
    const seen = [];
    const top = await topOf(side, `#${id}`);
    const h = await side.evaluate(id => document.getElementById(id).offsetHeight, id);
    for (let y = Math.max(0, top - 390); y <= top + h; y += 24) {
      await side.evaluate(y => window.scrollTo(0, y), y);
      await sleep(90);
      const n = await side.evaluate(sel => document.querySelector(sel).textContent, nameSel);
      if (seen.at(-1) !== n) seen.push(n);
    }
    return seen;
  };
  const lensSeen = await walk("lensAct", "#lensName"), matSeen = await walk("matAct", "#matName");
  const contained = await side.evaluate(() => ["lensAct", "matAct", "threeDAct"].map(id => {
    const s = document.getElementById(id), b = s.getBoundingClientRect();
    const inner = [s.querySelector(".simBox"), s.querySelector(".specCol")].map(e => e.getBoundingClientRect());
    return { id, ok: inner.every(r => r.top >= b.top - 1 && r.bottom <= b.bottom + 1) };
  }));
  const sideOk = sd.short === true && !sd.heroLive && !sd.pins.includes("lensAct") && !sd.pins.includes("matAct") && !sd.pins.includes("heroAct")
    && JSON.stringify(lensSeen) === JSON.stringify(LENS_NAMES) && JSON.stringify(matSeen) === JSON.stringify(MELTS.map(m => m[1]))
    && contained.every(c => c.ok);
  layoutRows.push({ where: "844x390", ok: sideOk });
  if (!sideOk) layoutBad.push({ where: "844x390", ...sd, lensSeen, matSeen, contained });
  const over = [];
  for (const [page, w] of [[desk, 1440], [phone, 390], [lap, 1366], [side, 844]]) {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (o.sw > o.cw) over.push({ w, ...o });
  }
  await phone.close();
  await lap.close();
  await side.close();
  check("LANDING-ACT-LAYOUT", layoutBad.length === 0 && over.length === 0 && layoutRows.length >= 3 * (LENS_NAMES.length + MELTS.length) + 2,
    { stops: layoutRows.length, bad: layoutBad, overflow: over });
});

check("LANDING-COPY", copyBad.length === 0, { bad: copyBad });

// -------------------------------------------------------- reduced motion
/** what a still act shows: which of canvas and image is displayed, whether
 *  the counters and segments are, and the lens the column names against the
 *  lens its image was captured through (the <img>'s data-lens) */
const readStills = page => page.evaluate(() => ({
  media: ["lensAct", "matAct", "threeDAct"].map(id => {
    const s = document.getElementById(id);
    return { id, canvas: getComputedStyle(s.querySelector("canvas")).display, img: getComputedStyle(s.querySelector("img.fb")).display };
  }),
  counters: [...document.querySelectorAll("#lensAct .specCount, #lensRail, #matAct .specCount, #matRail")].map(e => getComputedStyle(e).display),
  lensName: document.getElementById("lensName").textContent,
  lensDesc: document.getElementById("lensDesc").textContent,
  dataLens: document.querySelector("#lensAct img.fb").dataset.lens ?? null,
}));
const stillOk = s => s.media.every(m => m.canvas === "none" && m.img !== "none") && s.counters.length === 4
  && s.counters.every(d => d === "none") && !!s.dataLens && s.lensName === s.dataLens;

await block("LANDING-STILL", async () => {
  const page = await open(browser, { width: 1440, height: 900, deviceScaleFactor: 1 }, { reduced: true });
  await page.waitForFunction(() => document.querySelectorAll("#lensSpec .spec__row").length > 0, { timeout: 10000 });
  const lens = await readRail(page, "#lensSpec");
  const d3 = await readRail(page, "#d3Spec");
  const mat = await readRail(page, "#matSpec");
  const still = await readStills(page);
  // no readout of a melt that is not running: no live row, no empty glyph, no
  // grid (a Miller index in a word value is not a readout)
  const readout = r => r.live !== null || r.value === "—" || r.label === "grid" || (!r.text && /\d/.test(r.value));
  await page.close();
  // and with no script at all (no html.js from the head gate): the stills
  // shown, the counters gone, and the markup's lens the image's lens
  const nojs = await browser.newPage();
  await nojs.setJavaScriptEnabled(false);
  await nojs.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await nojs.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
  const bare = await readStills(nojs);
  await nojs.close();
  const ok = lens.length === 2 && d3.length === 2 && !lens.some(readout) && !d3.some(readout)
    && mat.some(r => r.label === "melting point" && /^\d+$/.test(r.value)) && stillOk(still) && stillOk(bare)
    && bare.lensDesc === still.lensDesc;
  check("LANDING-STILL", ok, { lens, d3, mat: mat.map(r => `${r.label}: ${r.value}`), reduced: still, noScript: bare });
});

// ------------------------------------------------------------ accessibility
/** Tab onto `sel` the way a keyboard does: a zero-size focusable parked just
 *  before it in the DOM takes focus without scrolling, then one Tab. */
const tabOnto = async (page, sel) => {
  await page.evaluate(sel => {
    const s = document.createElement("span");
    s.tabIndex = 0;
    s.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0";
    document.querySelector(sel).before(s);
    s.focus({ preventScroll: true });
    s.addEventListener("blur", () => s.remove(), { once: true });
  }, sel);
  await page.keyboard.press("Tab");
};
/** a link's effective opacity: the product up its ancestors */
const alphaOf = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  let o = 1;
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity;
  return { focused: document.activeElement === el, alpha: +o.toFixed(3) };
}, sel);

await block("LANDING-A11Y", async () => {
  const vp = { width: 1440, height: 900, deviceScaleFactor: 1 };
  const open2 = async (path, v = vp) => {
    const p = await browser.newPage();
    await p.setViewport(v);
    await p.setRequestInterception(true);
    p.on("request", r => r.url().includes("gc.zgo.at") ? r.respond({ status: 200, contentType: "application/javascript", body: "" }) : r.continue());
    await p.goto(URL + path, { waitUntil: "networkidle0", timeout: 30000 });
    return p;
  };
  // 1. FOCUS NOT OBSCURED (2.4.11): on each page a link is parked 20 px from
  // the top, under the fixed header, then tabbed to; it must end up wholly
  // below the header's bottom edge
  const clear = [];
  for (const [path, sel, pre] of [["", '#composeAct .cta a[href^="app/#alloy"]', "#composeAct"],
    ["science/", '.doc a[href*="PHASE-AUDIT"]', null], ["contact/", '.ways a[href$="issues/new"]', null]]) {
    const page = await open2(path);
    if (pre) {   // the act's reveal run first, so only the header can hide it
      await page.evaluate(sel => document.querySelector(sel).scrollIntoView(), pre);
      await sleep(3500);
    }
    const parked = await page.evaluate(sel => {
      const t = document.querySelector(sel);
      window.scrollTo(0, t.getBoundingClientRect().top + scrollY - 20);
      return { top: t.getBoundingClientRect().top, header: document.getElementById("topnav").getBoundingClientRect().bottom };
    }, sel);
    await sleep(200);
    await tabOnto(page, sel);
    await sleep(500);
    const r = await page.evaluate(sel => {
      const t = document.querySelector(sel), b = t.getBoundingClientRect();
      return { focused: document.activeElement === t, top: b.top, bottom: b.bottom, header: document.getElementById("topnav").getBoundingClientRect().bottom, vh: innerHeight };
    }, sel);
    clear.push({ page: path || "/", parkedUnder: parked.top < parked.header, ...r,
      ok: parked.top < parked.header && r.focused && r.top >= r.header - 0.5 && r.bottom <= r.vh });
    await page.close();
  }
  // 2. FOCUS SHOWN (2.4.7): on a fresh landing, where the composer and
  // science reveals have not run, Tab through the four links they hide,
  // 120 ms apart; each must be fully opaque the moment it has focus
  const shown = [];
  {
    const page = await open2("");
    const seq = ["#composeAct .after a", '#composeAct .cta a[href^="app/#alloy"]', "#composeAct .cta a.btn--text", "#sciAct .cta a.btn--more"];
    await tabOnto(page, seq[0]);
    for (let k = 0; k < seq.length; k++) {
      if (k > 0) await page.keyboard.press("Tab");
      await sleep(120);
      shown.push({ sel: seq[k], ...(await alphaOf(page, seq[k])) });
    }
    await page.close();
  }
  // 3. REFLOW at 320 px (1.4.10) on the other two pages (HERO-FIT has the
  // landing): the fixed header's wordmark, MENU and pill inside the screen
  const narrow = [];
  for (const path of ["science/", "contact/"]) {
    const page = await open2(path, { width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const o = await page.evaluate(() => {
      const kids = [...document.querySelectorAll("#topnav .hdr__mark, #topnav summary, #topnav .btn--primary")].map(e => e.getBoundingClientRect());
      const p = document.querySelector("#topnav .btn--primary");
      return { n: kids.length, left: Math.min(...kids.map(r => r.left)), right: Math.max(...kids.map(r => r.right)),
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, name: p.getAttribute("aria-label"), shows: p.innerText.trim() };
    });
    narrow.push({ page: path, ...o, ok: o.n === 3 && o.left >= 0 && o.right <= 320 && o.sw <= o.cw && o.name === "Open the instrument" && o.name.startsWith(o.shows) });
    await page.close();
  }
  // 4. NAMES: the live canvases are images named after what they show (the
  // lens and the melt on screen now), the recipe is a group, the hero's
  // feature list is read once (hidden, and only through the picture's
  // description), and the contact page's copy control is a button whose
  // result lands in a status region
  const names = await desk.evaluate(() => {
    const c = id => { const e = document.getElementById(id); return { role: e.getAttribute("role"), label: e.getAttribute("aria-label") }; };
    const feats = document.getElementById("heroFeatures");
    return { lens: c("lensSim"), lensName: document.getElementById("lensName").textContent, mat: c("matSim"), matName: document.getElementById("matName").textContent,
      d3: c("d3Sim"), chips: { role: document.querySelector(".chips").getAttribute("role"), label: document.querySelector(".chips").getAttribute("aria-label") },
      feats: { hidden: !!feats?.hidden, items: feats?.children.length ?? 0, describes: document.getElementById("heroCanvas").getAttribute("aria-describedby") } };
  });
  const contact = await open2("contact/");
  const cn = await contact.evaluate(() => ({ copy: document.getElementById("copyBtn").tagName, type: document.getElementById("copyBtn").type, addr: document.getElementById("addr").getAttribute("role") }));
  await contact.close();
  const namesOk = names.lens.role === "img" && names.lens.label === `Live simulation, ${names.lensName} lens`
    && names.mat.role === "img" && names.mat.label === `Live simulation, ${names.matName} melt` && names.d3.role === "img" && !!names.d3.label
    && names.chips.role === "group" && !!names.chips.label && names.feats.hidden && names.feats.items === 5 && names.feats.describes === "heroFeatures"
    && cn.copy === "BUTTON" && cn.type === "button" && cn.addr === "status";
  const ok = clear.length === 3 && clear.every(c => c.ok) && shown.length === 4 && shown.every(s => s.focused && s.alpha >= 0.99)
    && narrow.every(n => n.ok) && namesOk;
  check("LANDING-A11Y", ok, { focusNotObscured: clear, focusShown: shown, reflow320: narrow, names: { ...names, contact: cn, ok: namesOk } });
});

await browser.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all landing act checks passed");
if (failures) process.exitCode = 1;
