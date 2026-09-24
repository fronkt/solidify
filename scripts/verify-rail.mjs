// verify-rail.mjs (v8 U0): the control rail never scrolls sideways, every
// slider's value is on screen, and nothing sits under the rail.
//
// The defect this exists for: `input[type=range]` kept Chrome's ~129 px
// intrinsic width, so label + slider + value came to 305 px of content in a
// 268 px rail (scrollWidth 305 against clientWidth 257), and every value cell,
// the one part of a row a reader actually needs, was off the right edge. No
// gate looked, because nothing had ever measured the rail at all.
//
// Everything here is measured in the real app, at five viewports (a default
// viewport is a test condition, not a neutral one; 960 wide is a half-screen
// window on a 1920 display), in 2D and in TRUE 3D, with every rail section
// opened the way a visitor opens it (by clicking its heading), and with the
// rail's real scrollbar: puppeteer hides scrollbars in headless mode by
// default, which hands the rail 10 px no visitor gets.
//
// Seven checks:
//   RAIL-NO-HSCROLL     rail.scrollWidth <= rail.clientWidth, every sample
//   RAIL-ROWS-INSIDE    every slider row is a grid, and its label, slider and
//                       value sit inside the rail's content box; no value cell
//                       has zero width; enough value cells were measured
//   RAIL-TEXT-WRAPS     every rendered element in the rail (notes, buttons,
//                       selects, the SCALE table) AND every rendered line of
//                       text stays inside the content box: long text wraps, it
//                       never widens the rail
//   RAIL-VAL-FITS       each slider driven to its min and then its max (in a
//                       real material, so values print in K, K/s, µm): every
//                       value stays on one line inside the rail; the widest
//                       readouts the value column is sized for were printed
//   RAIL-CLEAR          no chrome and no mode panel (lab, heat treat, optimizer,
//                       challenge) overlaps the rail, with every lens legend and
//                       analysis panel that can appear beside it switched on;
//                       the items sized against the transport bar (the mode
//                       panels, the hint, the SEM bar, the HUD) stay clear of
//                       it; the lens bar, #head's text lines, the readouts,
//                       CONTROLS, the TRUE 3D switch, the view cube and the
//                       scale bar never overlap one another; every open mode
//                       panel holds its content (no sideways scroll, nothing
//                       past its content box) and no slider in it is under
//                       60px. All of it with the rail shown AND hidden.
//   RAIL-HIDE           the hide toggle moves the whole rail off screen and
//                       every rail-anchored element (CONTROLS, the switch, the
//                       view cube, the HUD, both analysis columns, and the lens
//                       bar's center) back to the edge, and showing it again
//                       restores all of them; at 1280x720 and on a 390px phone,
//                       where CONTROLS must stay on screen in both states
//   SLICE-ROWS-INSIDE   the SECTION PLANE popup shares the .row grid; its rows
//                       stay inside its own box
//
// It also saves six screenshots (rail scrolled to top, middle and bottom, 2D
// and 3D, 1440x900) to the output directory, for a person to look at.
//
//   node scripts/verify-rail.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? ".";
const PORT = process.argv[3] ?? "5199";
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [[1280, 720], [1440, 900], [1920, 1080], [1024, 768], [960, 1000]];
const HIDE_VIEWPORTS = [[1280, 720], [390, 844]];
// what #matline prints for the composer's 4340 steel in the volume (a share
// link's name can be longer still): the top-chrome clause measures #matline
// with this in it, so the lens bar is checked against a long name, not the
// boot material's short one
const LONG_NAME = "Fe–1.8Ni–0.8Cr–0.7Mn–0.4C–0.25Mo · 3D 192³";
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--enable-unsafe-webgpu", "--enable-gpu"],
  // real scrollbars: see the header
  ignoreDefaultArgs: ["--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
try { await page.waitForFunction("!!window.__solidify", { timeout: 15000 }); }
catch { await page.reload({ waitUntil: "networkidle0" }); await page.waitForFunction("!!window.__solidify", { timeout: 20000 }); }
await sleep(800);

// ---------------------------------------------------------------- in-page probes
await page.evaluate(LONG => {
  const TOL = 0.5;
  const vis = el => {
    if (!el || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && Number(cs.opacity) > 0;
  };
  const rail = () => document.getElementById("rail");
  /** the rail's content box, in viewport x: inside the border, the padding and the scrollbar */
  const contentBox = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const x0 = r.left + el.clientLeft + parseFloat(cs.paddingLeft);
    const x1 = r.left + el.clientLeft + el.clientWidth - parseFloat(cs.paddingRight);
    return { x0, x1 };
  };
  const outside = (b, box) => b.left < box.x0 - TOL || b.right > box.x1 + TOL;
  const r1 = v => Math.round(v * 10) / 10;
  const label = row => row.querySelector("label")?.textContent ?? "?";
  const hit = (a, b) => a[2] > b[0] + TOL && a[0] < b[2] - TOL && a[3] > b[1] + TOL && a[1] < b[3] - TOL;
  /** the union of a text element's rendered line boxes (its ink, not its block) */
  const textBox = el => {
    if (!vis(el)) return null;
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rs = [...rg.getClientRects()].filter(r => r.width > 0);
    if (!rs.length) return null;
    return [r1(Math.min(...rs.map(r => r.left))), r1(Math.min(...rs.map(r => r.top))),
      r1(Math.max(...rs.map(r => r.right))), r1(Math.max(...rs.map(r => r.bottom)))];
  };
  /** true when something between `el` and `root` clips it sideways (the
   *  optimizer's tile strip scrolls; what it clips is not painted) */
  const clippedBelow = (el, root) => {
    for (let p = el.parentElement; p && p !== root; p = p.parentElement)
      if (getComputedStyle(p).overflowX !== "visible") return true;
    return false;
  };

  /** rows of `root` whose parts leave `box`, plus the rows that are not grids */
  const rowAudit = (root, box) => {
    const rows = [...root.querySelectorAll(".row")].filter(vis);
    const bad = [];
    let vals = 0, zeroVals = 0;
    for (const row of rows) {
      if (getComputedStyle(row).display !== "grid") bad.push({ row: label(row), display: getComputedStyle(row).display });
      for (const [part, el] of [["label", row.querySelector("label")], ["slider", row.querySelector("input")], ["value", row.querySelector(".val")]]) {
        if (!el) { bad.push({ row: label(row), missing: part }); continue; }
        const b = el.getBoundingClientRect();
        if (outside(b, box)) bad.push({ row: label(row), part, left: r1(b.left), right: r1(b.right), box: [r1(box.x0), r1(box.x1)] });
      }
      const v = row.querySelector(".val");
      if (v) { vals++; if (v.getBoundingClientRect().width < 1) { zeroVals++; bad.push({ row: label(row), zeroWidthValue: true }); } }
    }
    return { rows: rows.length, vals, zeroVals, bad };
  };

  window.__railProbe = {
    /** open every collapsed section by clicking its heading, as a visitor does */
    expandAll() {
      let n = 0, open = 0;
      for (const s of rail().querySelectorAll(":scope > .sec")) {
        n++;
        const body = s.querySelector(":scope > .secbody");
        if (body.style.display === "none") s.querySelector(":scope > h2").click();
        if (body.style.display !== "none") open++;
      }
      window.__solidify.ui.sync();
      return { sections: n, open };
    },
    measure() {
      const el = rail();
      const box = contentBox(el);
      const rows = rowAudit(el, box);
      const textBad = [];
      let elems = 0, lines = 0;
      for (const e of el.querySelectorAll("*")) {
        if (!vis(e)) continue;
        const b = e.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        elems++;
        if (outside(b, box)) textBad.push({ tag: e.tagName.toLowerCase(), cls: String(e.className || ""), text: (e.textContent || "").trim().slice(0, 48), left: r1(b.left), right: r1(b.right) });
      }
      // Element boxes alone miss the commonest case: a note whose one text
      // line runs past its own block, which leaves the block's box where it
      // was. So every rendered line of text is measured too.
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const rg = document.createRange();
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        if (!t.textContent.trim() || !vis(t.parentElement)) continue;
        rg.selectNodeContents(t);
        for (const b of rg.getClientRects()) {
          if (b.width === 0) continue;
          lines++;
          if (outside(b, box)) textBad.push({ textLine: t.textContent.trim().slice(0, 48), left: r1(b.left), right: r1(b.right) });
        }
      }
      return {
        width: el.offsetWidth, client: el.clientWidth, scroll: el.scrollWidth,
        scrollbar: el.offsetWidth - el.clientWidth - el.clientLeft - parseFloat(getComputedStyle(el).borderRightWidth),
        tall: el.scrollHeight > el.clientHeight,
        box: [r1(box.x0), r1(box.x1)], ...rows, elems, lines, textBad: textBad.slice(0, 8), nTextBad: textBad.length,
      };
    },
    /** every visible child of #app that is not the canvas, the rail, the
     *  full-screen SVG overlay or a modal: its box, and whether it overlaps
     *  the rail. Plus the top chrome's pairwise overlaps: the lens bar, the
     *  readouts, CONTROLS, the TRUE 3D switch, the view cube, the scale bar
     *  and #head's three text lines, measured as rendered text with a long
     *  alloy name in #matline (the analysis columns are left out: they are
     *  bottom-anchored, and with all three 3D panels on a short window they
     *  climb into the view cube, from 134px against its bottom at 188 at
     *  1180x800, which paints over them at z-index 5; that predates the rail
     *  change) */
    chrome() {
      const rb = rail().getBoundingClientRect();
      const SKIP = new Set(["canvas", "rail", "overlay", "gate", "composer"]);
      const seen = [], hits = [], boxes = {};
      for (const el of document.getElementById("app").children) {
        if (SKIP.has(el.id) || !vis(el)) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        const name = el.id || `(${(el.textContent || "").trim().slice(0, 24)})`;
        seen.push(name);
        boxes[name] = [r1(b.left), r1(b.top), r1(b.right), r1(b.bottom)];
        if (b.right > rb.left + TOL && b.left < rb.right - TOL && b.bottom > rb.top && b.top < rb.bottom)
          hits.push({ name, left: r1(b.left), right: r1(b.right), railLeft: r1(rb.left) });
      }
      // measured and restored inside this one synchronous call, so no frame
      // (and no ui.sync) runs in between
      const mat = document.getElementById("matline");
      const matWas = mat.textContent;
      mat.textContent = LONG;
      const top = {
        "head h1": textBox(document.querySelector("#head h1")),
        "head .sub": textBox(document.querySelector("#head .sub")),
        "#matline": textBox(mat),
      };
      mat.textContent = matWas;
      for (const n of ["views", "readouts", "railToggle", "dimSwitch", "viewcube", "scalebar"]) if (boxes[n]) top[n] = boxes[n];
      const HEAD = new Set(["head h1", "head .sub", "#matline"]);
      const names = Object.keys(top).filter(n => top[n]);
      const clash = [];
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        const [a, b] = [names[i], names[j]];
        if (HEAD.has(a) && HEAD.has(b)) continue;
        if (hit(top[a], top[b])) clash.push({ a, b, boxA: top[a], boxB: top[b] });
      }
      return { seen, hits, boxes, top: names, clash };
    },
    /** every open mode panel: sideways scroll, anything painted outside its
     *  content box, and the width of each slider in it */
    panels() {
      const out = [];
      for (const p of document.querySelectorAll("#app > .modepanel")) {
        if (!vis(p)) continue;
        const box = contentBox(p);
        const bad = [];
        if (p.scrollWidth > p.clientWidth + 1) bad.push({ scrollWidth: p.scrollWidth, clientWidth: p.clientWidth });
        for (const e of p.querySelectorAll("*")) {
          if (!vis(e) || clippedBelow(e, p)) continue;
          const b = e.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) continue;
          if (outside(b, box)) bad.push({ tag: e.tagName.toLowerCase(), text: (e.textContent || "").trim().slice(0, 32), left: r1(b.left), right: r1(b.right), box: [r1(box.x0), r1(box.x1)] });
        }
        const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const rg = document.createRange();
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          if (!t.textContent.trim() || !vis(t.parentElement) || clippedBelow(t, p)) continue;
          rg.selectNodeContents(t);
          for (const b of rg.getClientRects())
            if (b.width > 0 && outside(b, box)) bad.push({ textLine: t.textContent.trim().slice(0, 32), left: r1(b.left), right: r1(b.right), box: [r1(box.x0), r1(box.x1)] });
        }
        const sliders = [...p.querySelectorAll("input[type=range]")].filter(vis).map(i => r1(i.getBoundingClientRect().width));
        out.push({ name: p.id || "(challenge)", width: r1(p.getBoundingClientRect().width), nBad: bad.length, bad: bad.slice(0, 4), sliders });
      }
      return out;
    },
    /** drive every visible rail slider to its min, then to its max, reading
     *  every value cell after every step; restores the dials afterwards */
    sweep() {
      const S = window.__solidify;
      const el = rail();
      const box = contentBox(el);
      const inputs = [...el.querySelectorAll(".row input[type=range]")].filter(vis);
      const orig = inputs.map(i => i.value);
      const set = (inp, v) => { inp.value = String(v); inp.dispatchEvent(new Event("input", { bubbles: true })); };
      const bad = [];
      const labels = new Set();
      let samples = 0, longest = "", widestRate = "";
      const look = step => {
        S.ui.sync();
        for (const v of el.querySelectorAll(".row .val")) {
          if (!vis(v)) continue;
          samples++;
          labels.add(label(v.parentElement));
          const t = v.textContent ?? "";
          if (t.length > longest.length) longest = t;
          if (/e[+-]\d+ K\/s$/.test(t) && t.length > widestRate.length) widestRate = t;
          const rg = document.createRange();
          rg.selectNodeContents(v);
          const lines = new Set([...rg.getClientRects()].map(r => Math.round(r.top))).size;
          const b = v.getBoundingClientRect();
          if (lines > 1 || outside(b, box) || b.width < 1 || v.scrollWidth > v.clientWidth + 1)
            bad.push({ step, row: label(v.parentElement), text: t, lines, left: r1(b.left), right: r1(b.right), box: [r1(box.x0), r1(box.x1)] });
        }
      };
      inputs.forEach((inp, i) => { set(inp, inp.min); look(`${label(inp.parentElement)} min`); });
      inputs.forEach((inp, i) => { set(inp, inp.max); look(`${label(inp.parentElement)} max`); });
      for (let i = inputs.length - 1; i >= 0; i--) set(inputs[i], orig[i]);
      S.ui.sync();
      return { sliders: inputs.length, samples, longest, widestRate, labels: [...labels], nBad: bad.length, bad: bad.slice(0, 8) };
    },
    slicePop() {
      const sp = document.getElementById("slicePop");
      if (!vis(sp)) return { visible: false };
      return { visible: true, ...rowAudit(sp, contentBox(sp)) };
    },
    /** the rail, CONTROLS, and every other visible element anchored beside
     *  the rail (its right edge), plus the lens bar's center */
    railGeom() {
      const r = rail().getBoundingClientRect();
      const t = document.getElementById("railToggle").getBoundingClientRect();
      const anchored = {};
      for (const id of ["dimSwitch", "viewcube", "hud", "apanels", "apanels3"]) {
        const el = document.getElementById(id);
        if (!vis(el)) continue;
        const b = el.getBoundingClientRect();
        if (b.width >= 1 && b.height >= 1) anchored[id] = r1(b.right);
      }
      const v = document.getElementById("views").getBoundingClientRect();
      return {
        vw: innerWidth, railLeft: r1(r.left), railWidth: r1(r.width),
        toggle: [r1(t.left), r1(t.right)], anchored, viewsCenter: r1((v.left + v.right) / 2),
        hidden: document.body.classList.contains("railHidden"),
      };
    },
  };
}, LONG_NAME);

const S = fn => page.evaluate(fn);
/** wait out the CSS transitions a resize or a rail toggle starts (the chrome
 *  beside the rail slides, and the lens bar and the TRUE 3D switch move
 *  between rows): a box read mid-transition is neither layout */
const settle = () => page.evaluate(() => Promise.race([
  Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => {}))),
  new Promise(r => setTimeout(r, 2000)),
]));
const setVP = async (w, h) => { await page.setViewport({ width: w, height: h }); await sleep(350); await settle(); };
const toggleRail = async () => { await S(() => document.getElementById("railToggle").click()); await sleep(300); await settle(); };

// ------------------------------------------------------------- the rail itself
const railSamples = [];   // RAIL-NO-HSCROLL, RAIL-ROWS-INSIDE, RAIL-TEXT-WRAPS
const sweeps = [];        // RAIL-VAL-FITS
const expands = [];

/** `real`: the material has SI units, so values print in K, K/s and µm.
 *  `shots`: save the screenshots in this state, BEFORE the sweep, whose
 *  restore cannot return a derived dial that sat outside its slider range */
async function sampleState(mode, state, setup, { real = false, shots: shotsAs = null } = {}) {
  await page.evaluate(setup);
  await sleep(500);
  expands.push({ mode, state, ...(await S(() => window.__railProbe.expandAll())) });
  for (const [w, h] of VIEWPORTS) {
    await setVP(w, h);
    const m = await S(() => window.__railProbe.measure());
    railSamples.push({ mode, state, vp: `${w}x${h}`, ...m });
  }
  if (shotsAs) await shots(shotsAs);
  sweeps.push({ mode, state, real, ...(await S(() => window.__railProbe.sweep())) });
}

// --------------------------------------------------------------- the chrome
const chromeSamples = [];
const seenChrome = new Set();
const panelOpened = [];
// Sized against the transport bar, so they get the transport-bar clause: the
// first cut of this change centered the bottom-center items in the space the
// rail leaves, which slid the optimizer's panel over the run button its own
// status line tells you to press, and the HUD, anchored beside a wider rail,
// spread its cards over the same buttons. The mode panels join this set as
// they open.
const clearOfTransport = new Set(["hint", "sembar", "hud"]);
const railState = () => S(() => document.body.classList.contains("railHidden") ? "hidden" : "shown");
async function sampleChrome(mode, what) {
  const rail = await railState();
  for (const [w, h] of VIEWPORTS) {
    await setVP(w, h);
    const c = await S(() => window.__railProbe.chrome());
    const panels = await S(() => window.__railProbe.panels());
    c.seen.forEach(n => seenChrome.add(n));
    const t = c.boxes.transport;
    const overTransport = !t ? [] : Object.entries(c.boxes)
      .filter(([n, b]) => clearOfTransport.has(n) && b[2] > t[0] && b[0] < t[2] && b[3] > t[1] && b[1] < t[3])
      .map(([n, b]) => ({ name: n, box: b, transport: t }));
    chromeSamples.push({ mode, what, rail, vp: `${w}x${h}`, hits: c.hits, overTransport, transportSeen: !!t, top: c.top, clash: c.clash, panels });
  }
}
/** open a mode panel, sample, close it; the panel must actually have appeared */
async function samplePanel(mode, what, open, close) {
  const before = new Set((await S(() => window.__railProbe.chrome())).seen);
  await page.evaluate(open);
  await sleep(600);
  const fresh = (await S(() => window.__railProbe.chrome())).seen.filter(n => !before.has(n));
  fresh.forEach(n => clearOfTransport.add(n));
  panelOpened.push({ mode, what, rail: await railState(), appeared: fresh.length > 0, names: fresh });
  await sampleChrome(mode, what);
  await page.evaluate(close);
  await sleep(400);
}

// the lens bar's center as app/index.html places it, W being the width the
// rail leaves (the whole window while it is hidden)
const viewsCenterFor = W => Math.min(Math.max(W / 2, 424), W - 157);
const hideSamples = [];
async function sampleHide(mode) {
  for (const [w, h] of HIDE_VIEWPORTS) {
    await setVP(w, h);
    const shown = await S(() => window.__railProbe.railGeom());
    await toggleRail();
    const hidden = await S(() => window.__railProbe.railGeom());
    await toggleRail();
    const back = await S(() => window.__railProbe.railGeom());
    const near = (a, b) => Math.abs(a - b) < 1;
    const why = [];
    if (!hidden.hidden || hidden.railLeft < hidden.vw - 0.5) why.push("rail not off screen");
    if (!near(hidden.toggle[1], hidden.vw - 14)) why.push("CONTROLS not at the edge");
    for (const [id, right] of Object.entries(hidden.anchored))
      if (!near(right, hidden.vw - 14)) why.push(`${id} not at the edge`);
    if (!near(hidden.viewsCenter, viewsCenterFor(hidden.vw))) why.push("lens bar not centered on the window");
    if (back.hidden || !near(back.railLeft, back.vw - back.railWidth) || back.railLeft !== shown.railLeft) why.push("rail not back");
    if (!near(back.toggle[1], back.railLeft - 14)) why.push("CONTROLS not back beside the rail");
    for (const [id, right] of Object.entries(back.anchored))
      if (!near(right, back.railLeft - 14)) why.push(`${id} not back beside the rail`);
    if (!near(back.viewsCenter, viewsCenterFor(back.railLeft))) why.push("lens bar not back in the space the rail leaves");
    // the one control that moves the rail must be reachable in both states,
    // phone included
    for (const [state, g] of [["shown", shown], ["hidden", hidden], ["back", back]])
      if (g.toggle[0] < 0 || g.toggle[1] > g.vw) why.push(`CONTROLS off screen (${state})`);
    hideSamples.push({ mode, vp: `${w}x${h}`, ok: why.length === 0, why, shown, hidden, back });
  }
}

const slices = [];
async function shots(mode) {
  await setVP(1440, 900);
  for (const [tag, f] of [["top", 0], ["mid", 0.5], ["bottom", 1]]) {
    await page.evaluate(f => { const r = document.getElementById("rail"); r.scrollTop = f * (r.scrollHeight - r.clientHeight); }, f);
    await sleep(200);
    await page.screenshot({ path: `${OUT}/rail-${mode}-${tag}.png` });
  }
  await S(() => { document.getElementById("rail").scrollTop = 0; });
  console.log(`shot rail-${mode}-{top,mid,bottom}.png`);
}

// ================================================================= 2D
await sampleState("2d", "boot: model metal", () => {});
// the widest rail there is: real units, both sub-panels that can open, the
// pixel row, and the calibrated solver's coupling readout
await sampleState("2d", "Al, Bridgman, alloy, pixel mode, calibrated", () => {
  const a = window.__solidify.app;
  a.setMaterial("al");
  a.simParams().scen = 1;
  a.setAlloyOn(true);
  a.setPixel(6);
  a.setCalibrated(true);
  window.__solidify.ui.sync();
}, { real: true, shots: "2d" });
// Kobayashi, so the cell pitch is a free dial again and the sweep drives it
// through its whole range (the calibrated solver derives it). This sweep is
// not where the widest rate comes from: it printed "1.6e+6 K/s" in a recent
// run, the calibrated sweep above "1.1e+7 K/s", and the first TRUE 3D sweep
// below "2.9e+9 K/s", the largest seen, all 10 characters
await sampleState("2d", "Al, weld, Kobayashi", () => {
  const a = window.__solidify.app;
  a.setCalibrated(false);
  a.setPixel(0);
  a.simParams().scen = 2;
  window.__solidify.ui.sync();
}, { real: true });

// every legend and panel that can appear beside the rail
await page.evaluate(() => {
  const S = window.__solidify;
  S.analyze.setProbeOn(true); S.analyze.setScheilOn(true); S.analyze.setTextureOn(true);
  S.app.setView(2);   // ETCH: the scale bar
  S.ui.sync();
});
await sampleChrome("2d", "ETCH lens + analysis panels");
await page.evaluate(() => { window.__solidify.app.setView(6); window.__solidify.ui.sync(); });   // SEM bar
await sampleChrome("2d", "SEM lens + analysis panels");
await samplePanel("2d", "lab", () => window.__solidify.app.startLab(), () => window.__solidify.lab.close());
await samplePanel("2d", "heat treat", () => window.__solidify.app.startHeat(), () => window.__solidify.heat.close());
await samplePanel("2d", "optimizer", () => window.__solidify.app.startOptimizer(), () => window.__solidify.opt.stop());
await samplePanel("2d", "challenge", () => window.__solidify.app.startChallenge(), () => window.__solidify.challenge.stop());
// and again with the rail hidden: --rail-inset drops to 0 there, and the
// transport-bar clause has to hold without the rail's width doing the work
await toggleRail();
await sampleChrome("2d", "rail hidden: SEM lens + analysis panels");
await samplePanel("2d", "lab, rail hidden", () => window.__solidify.app.startLab(), () => window.__solidify.lab.close());
await samplePanel("2d", "heat treat, rail hidden", () => window.__solidify.app.startHeat(), () => window.__solidify.heat.close());
await samplePanel("2d", "optimizer, rail hidden", () => window.__solidify.app.startOptimizer(), () => window.__solidify.opt.stop());
await samplePanel("2d", "challenge, rail hidden", () => window.__solidify.app.startChallenge(), () => window.__solidify.challenge.stop());
await toggleRail();
// with the analysis column still open, so RAIL-HIDE measures it too
await sampleHide("2d");
await page.evaluate(() => {
  const S = window.__solidify;
  S.analyze.setProbeOn(false); S.analyze.setScheilOn(false); S.analyze.setTextureOn(false);
  S.app.setView(0); S.ui.sync();
});

// ================================================================= TRUE 3D
await setVP(1440, 900);
await page.evaluate(() => window.__solidify.app.setMode("3d"));
await page.waitForFunction("window.__solidify.mode() === '3d'", { timeout: 60000 });
await sleep(1000);
await sampleState("3d", "entered (Al)", () => {}, { real: true });
await sampleState("3d", "Al, hex habit, Bridgman, alloy", () => {
  const a = window.__solidify.app;
  a.setSym3(6);
  a.simParams().scen = 1;
  a.setAlloyOn(true);   // async in the volume: a texture allocation
  window.__solidify.ui.sync();
}, { real: true, shots: "3d" });

await page.evaluate(() => {
  const a = window.__solidify.app;
  a.setStereoOn(true); a.setIpfOn(true); a.setPoleOn(true);
  a.setView3d(2);   // SLICE: the scale bar and the SECTION PLANE popup
  window.__solidify.ui.sync();
});
await sleep(400);
for (const [w, h] of VIEWPORTS) {
  await setVP(w, h);
  slices.push({ vp: `${w}x${h}`, ...(await S(() => window.__railProbe.slicePop())) });
}
await sampleChrome("3d", "SLICE lens + analysis panels");
await page.evaluate(() => { window.__solidify.app.setView3d(4); window.__solidify.ui.sync(); });   // SEM bar
await sampleChrome("3d", "SEM lens + analysis panels");
await samplePanel("3d", "lab", () => window.__solidify.app.startLab(), () => window.__solidify.lab.close());
await samplePanel("3d", "heat treat", () => window.__solidify.app.startHeat(), () => window.__solidify.heat.close());
await toggleRail();
await sampleChrome("3d", "rail hidden: SEM lens + analysis panels");
await samplePanel("3d", "lab, rail hidden", () => window.__solidify.app.startLab(), () => window.__solidify.lab.close());
await samplePanel("3d", "heat treat, rail hidden", () => window.__solidify.app.startHeat(), () => window.__solidify.heat.close());
await toggleRail();
await sampleHide("3d");

// ================================================================= verdicts
const brief = s => ({ mode: s.mode, state: s.state, vp: s.vp });

{
  const bad = railSamples.filter(s => s.scroll > s.client).map(s => ({ ...brief(s), scrollWidth: s.scroll, clientWidth: s.client }));
  // the test condition must be the visitor's: a real scrollbar on a rail
  // whose opened sections are taller than the window
  const scrollbarSeen = railSamples.some(s => s.tall && s.scrollbar > 0);
  const ok = bad.length === 0 && scrollbarSeen && railSamples.length === 5 * VIEWPORTS.length;
  check("RAIL-NO-HSCROLL", ok, {
    samples: railSamples.length, scrollbarSeen,
    railWidth: railSamples[0]?.width, clientWidth: [...new Set(railSamples.map(s => s.client))],
    bad: bad.slice(0, 8),
  });
}

{
  const bad = railSamples.filter(s => s.bad.length).map(s => ({ ...brief(s), bad: s.bad.slice(0, 4) }));
  const vals = railSamples.reduce((n, s) => n + s.vals, 0);
  const zero = railSamples.reduce((n, s) => n + s.zeroVals, 0);
  // Liveness: the boot rail alone shows 17 value cells, and the five states
  // come to 520 across the five viewports today. Fewer than 15 in any sample,
  // or 300 in all, means a section never opened or the selector stopped
  // finding rows.
  const minPerSample = Math.min(...railSamples.map(s => s.vals));
  const allOpened = expands.every(e => e.open === e.sections && e.sections >= 10);
  const ok = bad.length === 0 && zero === 0 && minPerSample >= 15 && vals >= 300 && allOpened;
  check("RAIL-ROWS-INSIDE", ok, {
    valuesMeasured: vals, fewestInOneSample: minPerSample, zeroWidthValues: zero,
    sections: expands.map(e => `${e.mode} ${e.open}/${e.sections}`), bad: bad.slice(0, 6),
  });
}

{
  const bad = railSamples.filter(s => s.nTextBad).map(s => ({ ...brief(s), n: s.nTextBad, first: s.textBad.slice(0, 3) }));
  const fewest = Math.min(...railSamples.map(s => s.elems));
  const fewestLines = Math.min(...railSamples.map(s => s.lines));
  // liveness floors below today's minima (218 elements, 148 text lines, both
  // in the model-metal boot rail): an empty walk would pass everything
  check("RAIL-TEXT-WRAPS", bad.length === 0 && fewest >= 150 && fewestLines >= 100, {
    fewestElementsInOneSample: fewest, fewestTextLinesInOneSample: fewestLines, bad: bad.slice(0, 6),
  });
}

{
  const bad = sweeps.filter(s => s.nBad).map(s => ({ mode: s.mode, state: s.state, n: s.nBad, first: s.bad.slice(0, 4) }));
  // Liveness, per state rather than pooled: the two readouts the value column
  // is sized for must each actually have been printed and measured. The
  // calibrated sweep must have read the coupling λ row (17 characters with
  // its W₀/d₀; setCalibrated returns early when the material cannot be
  // calibrated, and ui.sync hides the row when calibration() is null, and
  // either would leave only short values), and some sweep must have printed
  // a K/s rate in exponent form (10 characters). Pooled, the 3D rate alone
  // met the old floor and the coupling readout could vanish unnoticed.
  const cal = sweeps.find(s => s.state.includes("calibrated"));
  const calOk = !!cal && cal.labels.includes("coupling λ") && cal.longest.length >= 17;
  const widestRate = sweeps.map(s => s.widestRate).reduce((a, b) => (b.length > a.length ? b : a), "");
  const ok = bad.length === 0 && sweeps.length === 5 && sweeps.every(s => s.sliders >= 10) && calOk && widestRate.length >= 10;
  check("RAIL-VAL-FITS", ok, {
    calibratedCouplingRead: calOk, widestRate,
    sweeps: sweeps.map(s => ({ mode: s.mode, state: s.state, sliders: s.sliders, samples: s.samples, longest: s.longest, widestRate: s.widestRate })),
    bad,
  });
}

{
  const where = s => ({ mode: s.mode, what: s.what, rail: s.rail, vp: s.vp });
  const bad = chromeSamples.filter(s => s.hits.length).map(s => ({ ...where(s), hits: s.hits }));
  const overTransport = chromeSamples.filter(s => s.overTransport.length).map(s => ({ ...where(s), over: s.overTransport }));
  const clash = chromeSamples.filter(s => s.clash.length).map(s => ({ ...where(s), clash: s.clash.slice(0, 3) }));
  const audits = chromeSamples.flatMap(s => s.panels.map(p => ({ ...where(s), ...p })));
  const panelBad = audits.filter(p => p.nBad).map(p => ({ ...where(p), panel: p.name, width: p.width, bad: p.bad }));
  const thinSliders = audits.filter(p => p.sliders.some(w => w < 60)).map(p => ({ ...where(p), panel: p.name, sliders: p.sliders }));
  // Liveness: every element that is positioned against the rail, or sized
  // against its inset or the transport bar, must have been on screen in at
  // least one sample; each mode panel must actually have opened, with the
  // rail shown and hidden; the audits must have found the panels and their
  // sliders; and every chrome sample must have measured the lens bar, CONTROLS,
  // the switch and #head's lines, with the view cube and the scale bar each
  // in at least one.
  const EXPECT = ["views", "railToggle", "dimSwitch", "viewcube", "hud", "apanels", "apanels3", "scalebar",
    "sembar", "hint", "transport", "slicePop", "foundry", "heattreat", "lab", "readouts"];
  const missing = EXPECT.filter(n => !seenChrome.has(n));
  const notOpened = panelOpened.filter(p => !p.appeared);
  const hiddenOpened = panelOpened.filter(p => p.rail === "hidden").length;
  const hiddenSamples = chromeSamples.filter(s => s.rail === "hidden").length;
  const ALWAYS = ["views", "railToggle", "dimSwitch", "readouts", "head h1", "head .sub", "#matline"];
  const topMissing = [...new Set(chromeSamples.flatMap(s => ALWAYS.filter(n => !s.top.includes(n))))];
  const topSomewhere = ["viewcube", "scalebar"].filter(n => !chromeSamples.some(s => s.top.includes(n)));
  const slidersMeasured = audits.reduce((n, p) => n + p.sliders.length, 0);
  const ok = bad.length === 0 && overTransport.length === 0 && clash.length === 0 && panelBad.length === 0
    && thinSliders.length === 0 && missing.length === 0 && notOpened.length === 0
    && panelOpened.length === 12 && hiddenOpened === 6 && hiddenSamples === 8 * VIEWPORTS.length
    && audits.length === 12 * VIEWPORTS.length && slidersMeasured >= 100
    && topMissing.length === 0 && topSomewhere.length === 0 && chromeSamples.every(s => s.transportSeen);
  check("RAIL-CLEAR", ok, {
    samples: chromeSamples.length, hiddenSamples, panelAudits: audits.length, slidersMeasured,
    panels: panelOpened.map(p => `${p.mode} ${p.what}: ${p.names.join(", ")}`),
    missing, notOpened, topMissing, topSomewhere, underRail: bad.slice(0, 8), overTransport: overTransport.slice(0, 8),
    clash: clash.slice(0, 6), panelOverflow: panelBad.slice(0, 6), thinSliders: thinSliders.slice(0, 6),
  });
}

{
  // Liveness: each rail-anchored element was measured with the rail hidden
  // in at least one sample (the HUD folds away on the phone, the analysis
  // columns are one per mode, the cube is 3D only)
  const anchoredSeen = new Set(hideSamples.flatMap(h => Object.keys(h.hidden.anchored)));
  const unmeasured = ["dimSwitch", "viewcube", "hud", "apanels", "apanels3"].filter(n => !anchoredSeen.has(n));
  check("RAIL-HIDE", hideSamples.length === 2 * HIDE_VIEWPORTS.length && hideSamples.every(h => h.ok) && unmeasured.length === 0, {
    unmeasured,
    samples: hideSamples.map(h => ({ mode: h.mode, vp: h.vp, ok: h.ok, why: h.why, toggle: [h.shown.toggle, h.hidden.toggle], hiddenAnchored: h.hidden.anchored })),
  });
}

{
  const bad = slices.filter(s => !s.visible || s.bad.length || s.rows < 3);
  check("SLICE-ROWS-INSIDE", slices.length === VIEWPORTS.length && bad.length === 0, { rows: slices[0]?.rows, bad: bad.slice(0, 4) });
}

if (errors.length) {
  failures++;
  console.log("PAGE ERRORS", JSON.stringify(errors.slice(0, 6)));
}

await browser.close();
console.log(failures ? `done: ${failures} FAILED` : "done: all rail checks passed");
if (failures) process.exitCode = 1;
