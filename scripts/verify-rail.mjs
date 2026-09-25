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
// Every rail sample is measured twice since v8 U1a: with learn mode off, and
// with it on and every section's explanation expanded, so the learn text is
// held to the same no-sideways-scroll and wrap rules as the instrument. Since
// the v8 U1b review the same holds OUTSIDE the rail: every mode panel is
// sampled again with learn mode on and its "i" open, and so are the analysis
// columns (one explanation open per column) and the SECTION PLANE popup, plus
// a heat treat panel carrying a real 4 h anneal's report. Learn mode is what
// made those grow: the first cut of U1b let the heat treat panel run off the
// top of the window and the lab panel, the columns and the popup climb over
// the learn toggle, CONTROLS, the TRUE 3D switch and the readouts.
//
// Ten checks:
//   RAIL-NO-HSCROLL     rail.scrollWidth <= rail.clientWidth, every sample,
//                       the phone's 270px rail included (v8 D2 review)
//   RAIL-ROWS-INSIDE    every slider row is a grid, and its label, slider and
//                       value sit inside the rail's content box; no value cell
//                       has zero width; enough value cells were measured
//   RAIL-TEXT-WRAPS     every rendered element in the rail (notes, buttons,
//                       selects, the SCALE table) AND every rendered line of
//                       text stays inside the content box: long text wraps, it
//                       never widens the rail; and (v8 D2 review) no word on a
//                       control (a pill, a label, a section header) breaks
//                       inside itself ("bridgma/n"), measured on the desktop
//                       viewports and on a 390x844 phone, whose 270px rail is
//                       the narrowest the rail gets
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
//                       the learn toggle, CONTROLS, the TRUE 3D switch, the
//                       view cube and the scale bar never overlap one
//                       another, and (v8 U1b review) none of them is
//                       overlapped by an open mode panel, an analysis column
//                       or the SECTION PLANE popup, all of which grow upward
//                       and must stop under the top chrome, nor does any of
//                       those three start above the window's top edge;
//                       every open mode
//                       panel holds its content (no sideways scroll, nothing
//                       past its content box) and no slider in it is under
//                       60px. All of it with the rail shown AND hidden, and
//                       every mode panel with learn mode off AND on. Since the
//                       v8 D2 review: the THERM legend is sampled too (2D and
//                       3D), the gesture hint never overlaps an open analysis
//                       column, and on a 390x844 phone: its first screen (the
//                       rail hidden, as ui.ts boots a phone) has every top
//                       item clear of every other, the head plate, its lines,
//                       the readouts and the lens bar included; with the rail
//                       open nothing that is shown overlaps the rail or
//                       another top item (the rail leaves 120px: the top
//                       chrome folds away, learn and controls stay); and lab
//                       mode opened there hides the rail and clears the learn
//                       toggle, CONTROLS, the lens bar and the TRUE 3D switch.
//   RAIL-HIDE           the hide toggle moves the whole rail off screen and
//                       every rail-anchored element (CONTROLS, the switch, the
//                       view cube, the HUD, both analysis columns, and the lens
//                       bar's center) back to the edge, and showing it again
//                       restores all of them; at 1280x720, at 1024x768 (where
//                       the lens bar has a row of its own, right-aligned under
//                       the column beside the rail) and on a 390px phone,
//                       where CONTROLS must stay on screen in both states; the
//                       learn toggle stays on screen beside CONTROLS, or just
//                       under it exactly where the CSS rule says the row has
//                       no room (a phone with the rail open); both placements
//                       must have been expected in some sample
//   SLICE-ROWS-INSIDE   the SECTION PLANE popup shares the .row grid; its rows
//                       stay inside its own box, learn mode off and on, and
//                       with learn on its hint is shown and one line
//   RAIL-LEARN          (v8 U1a) learn mode is off for a new viewer and then
//                       renders nothing in the rail; the top bar's toggle
//                       (aria-pressed) turns it on; every section header then
//                       has an "i" button that is a focusable button with
//                       aria-expanded/aria-controls, opens its explanation
//                       from the keyboard without opening or closing the
//                       section, and every explanation is 1 to 2 sentences;
//                       the header's title is a button too (aria-expanded,
//                       aria-controls on the body) that Enter and Space open
//                       and close; Space still runs and pauses with nothing
//                       focused and after a mouse click on a button, without
//                       pressing that button again; (v8 D2 review) a
//                       keyboard-focused learn toggle (off and pressed) and
//                       TRUE 3D switch show their focus ring over the
//                       near-white ETCH lens, as pixels that change;
//                       every hint is one line and shows exactly when its
//                       control does; every hint the rail's entries declare
//                       found its control; the setting survives a reload; and
//                       with localStorage throwing, the page still boots and
//                       the toggle and the section headers still work. The
//                       panels' side (v8 U1b review): every hint the panel
//                       entries declare was bound by some panel, matched by
//                       the label its control prints; in every learn-on panel
//                       sample learn text rendered, and each panel hint is
//                       one line and shows exactly when its control does; and
//                       every panel learn string is 1 to 2 sentences
//   RAIL-NO-EMDASH      (v8 U1a) no em dash in the rail's rendered prose or
//                       tooltips, learn mode off and on, in every sampled
//                       state and with a composer mix poured in calibrated
//                       mode, nor in any rail learn string, material note or
//                       source, SCALE group line in any material, the
//                       calibration line of any famous preset poured, or any
//                       panel learn string, hint or caveat line; the
//                       exact "—" empty-value glyph is allowed. Both copies
//                       of the detector are self-tested on a fixture first
//   RAIL-ACHROMATIC     (v8 D2) every color the chrome paints (the head
//                       plate and readouts, the lens bar, the top toggles,
//                       the rail, the HUD's cards, the transport, ARMED, the
//                       hint, the lens legends, the tour) is a gray and
//                       nothing glows, as computed on every element and its
//                       ::before/::after, in every rail and chrome sample and
//                       with the tour open; and the view cube's pixels carry
//                       no hue with a face hovered. The detector is
//                       self-tested on a planted amber line and glow.
//                       Since D2's second half also every panel built in
//                       script (the mode panels, the lab report, the
//                       SECTION PLANE popup, both analysis columns, the
//                       alloy composer with its phase diagram's SVG chrome,
//                       an enlarged plot, the probe / ruler marks), each
//                       required to have been read, learn off and on; only
//                       a plot's `data-mark` curves are skipped, and an SVG
//                       fixture (the diagram's frame stroked amber) must be
//                       caught beside an amber data curve that is not.
//                       Since the v8 D2 review: the THERM legend is read (2D
//                       and 3D), and a fixture shows its strip's exemption
//                       covers the strip alone (an amber label and an amber
//                       plate edge are caught); the tour is read with a
//                       chapter's highlight ring on screen; and the rail's
//                       own PIXELS are read (a slider's thumb and track are
//                       pseudo-elements getComputedStyle cannot reach), with
//                       a planted amber thumb and track that must be caught
//
// It also saves twelve screenshots (rail scrolled to top, middle and bottom,
// 2D and 3D, learn mode off and on, 1440x900) to the output directory, for a
// person to look at.
//
//   node scripts/verify-rail.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? ".";
const PORT = process.argv[3] ?? "5199";
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [[1280, 720], [1440, 900], [1920, 1080], [1024, 768], [960, 1000]];
// 1024x768 (v8 D2 review): the lens bar has a row of its own there with the
// rail open, right-aligned under the column beside the rail
const HIDE_VIEWPORTS = [[1280, 720], [1024, 768], [390, 844]];
// the phone (v8 D2 review): its 270px rail and, with the rail open, the
// cramped layout (app/index.html .railCramped)
const PHONE = [390, 844];
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
// a function, not an inline evaluate, because the learn-mode block reloads the
// page and has to install it again
const PROBE = LONG => {
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

  /** an em dash used as punctuation; a lone "—" is the empty-value glyph, and
   *  the rail always renders that glyph as an exact "—" text node (a slider's
   *  value, drawScale's dim("—")), so " — " standing alone between two inline
   *  elements is prose and is caught. Run on RAIL-NO-EMDASH's fixture too. */
  const proseDash = s => typeof s === "string" && s.includes("—") && s !== "—";
  const learnIsOn = () => document.getElementById("learnToggle")?.getAttribute("aria-pressed") === "true";
  const infos = () => [...rail().querySelectorAll(".lrnInfo")];
  /** (v8 U1b review) learn mode inside a panel or the popup: every hint shows
   *  exactly when learn is on and its control (the element right before it)
   *  shows, on one line; and how much learn text is on screen */
  const hintAudit = root => {
    const learn = learnIsOn();
    const hintBad = [];
    let hints = 0;
    const rg = document.createRange();
    for (const h of root.querySelectorAll(".lrnHint")) {
      const ctrl = h.previousElementSibling;
      const shown = vis(h), ctrlShown = !!ctrl && vis(ctrl);
      if (shown !== (learn && ctrlShown)) hintBad.push({ hint: h.textContent, shown, ctrlShown });
      if (!shown) continue;
      hints++;
      rg.selectNodeContents(h);
      const n = new Set([...rg.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
      if (n !== 1) hintBad.push({ hint: h.textContent, lines: n });
    }
    const lrnVisible = [...root.querySelectorAll(".lrnInfo, .lrnText, .lrnHint")].filter(vis).length;
    return { learn, hints, hintBad, lrnVisible };
  };

  window.__railProbe = {
    vis, proseDash,
    /** learn mode on or off through the top bar's toggle, as a visitor turns
     *  it; on, every section's explanation is expanded too */
    learnSet(on) {
      if (learnIsOn() !== on) document.getElementById("learnToggle").click();
      if (on) for (const b of infos()) if (vis(b) && b.getAttribute("aria-expanded") !== "true") b.click();
      window.__solidify.ui.sync();
      return learnIsOn();
    },
    /** (v8 U1b review) open learn mode's "i" everywhere outside the rail: all
     *  of them in the open mode panels and the SECTION PLANE popup, the FIRST
     *  visible one in each analysis column (their layers are exclusive, one
     *  explanation at a time); returns how many explanations are then shown */
    openPanelInfos() {
      const roots = [...document.querySelectorAll("#app > .modepanel, #slicePop")].filter(vis);
      for (const root of roots)
        for (const b of root.querySelectorAll(".lrnInfo")) if (vis(b) && b.getAttribute("aria-expanded") !== "true") b.click();
      for (const id of ["apanels", "apanels3"]) {
        const b = [...document.querySelectorAll(`#${id} .lrnInfo`)].find(vis);
        if (b && b.getAttribute("aria-expanded") !== "true") b.click();
      }
      window.__solidify.ui.sync();
      return [...document.querySelectorAll("#app > .modepanel .lrnSec, #slicePop .lrnSec, #apanels .lrnSec, #apanels3 .lrnSec")]
        .filter(vis).length;
    },
    /** what learn mode shows right now, per section header and per hint */
    learnState() {
      const secs = [...rail().querySelectorAll(":scope > .sec")].filter(vis);
      const heads = secs.map(s => {
        const h = s.querySelector(":scope > h2");
        const b = h.querySelector(".lrnInfo");
        const body = b ? document.getElementById(b.getAttribute("aria-controls") ?? "") : null;
        // the section's own open/close control: a button whose aria-expanded
        // and aria-controls describe the section body, so a keyboard reaches it
        const hb = h.querySelector(":scope > button.secHead");
        const secBody = s.querySelector(":scope > .secbody");
        return {
          title: h.firstChild?.textContent ?? "?",
          info: !!b, infoVisible: !!b && vis(b), tag: b?.tagName, tabIndex: b?.tabIndex ?? -1,
          expanded: b?.getAttribute("aria-expanded") ?? null,
          bodyExists: !!body, bodyVisible: !!body && vis(body), bodyUnderHeader: !!body && body.previousElementSibling === h,
          text: body?.textContent ?? "",
          headOk: !!hb && hb.tabIndex >= 0 && hb.getAttribute("aria-controls") === secBody.id
            && hb.getAttribute("aria-expanded") === String(secBody.style.display !== "none"),
        };
      });
      return {
        aria: document.getElementById("learnToggle").getAttribute("aria-pressed"),
        stored: (() => { try { return localStorage.getItem("sol.learn"); } catch { return "THROWS"; } })(),
        sections: secs.length, heads,
        visibleLearn: [...rail().querySelectorAll(".lrnInfo, .lrnText, .lrnHint")].filter(vis).length,
      };
    },
    /** focus the first control in the body of the section whose "i" is the
     *  i-th visible one, so a Shift+Tab has to land on that "i" */
    focusAfterInfo(i) {
      const b = infos().filter(vis)[i];
      const first = [...b.closest(".sec").querySelectorAll(":scope > .secbody button, :scope > .secbody input, :scope > .secbody select")]
        .find(vis);
      first.focus();
      return document.activeElement === first;
    },
    /** the i-th visible "i" button and its section, and whether it has focus */
    infoAt(i) {
      const b = infos().filter(vis)[i];
      const sec = b.closest(".sec");
      const hb = sec.querySelector(":scope > h2 > .secHead");
      return {
        focused: document.activeElement === b, disabled: b.disabled,
        open: sec.querySelector(":scope > .secbody").style.display,
        expanded: b.getAttribute("aria-expanded"),
        bodyVisible: vis(document.getElementById(b.getAttribute("aria-controls"))),
        // the section header's button, just before the "i" in the tab order
        headFocused: !!hb && document.activeElement === hb,
        headExpanded: hb?.getAttribute("aria-expanded") ?? null,
      };
    },
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
      // (v8 D2 review) and no word on a control breaks inside itself: a pill,
      // a label or a section header whose word is split over two lines
      // ("bridgma/n") stays inside the box and passes the line check above.
      // A word's range spanning two line tops is the split
      const splitWords = [];
      let words = 0;
      const wr = document.createRange();
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        if (!t.textContent.trim() || !vis(t.parentElement)) continue;
        rg.selectNodeContents(t);
        for (const b of rg.getClientRects()) {
          if (b.width === 0) continue;
          lines++;
          if (outside(b, box)) textBad.push({ textLine: t.textContent.trim().slice(0, 48), left: r1(b.left), right: r1(b.right) });
        }
        if (!t.parentElement.closest("button, label, h2")) continue;
        for (const w of t.textContent.matchAll(/\S+/g)) {
          wr.setStart(t, w.index);
          wr.setEnd(t, w.index + w[0].length);
          const tops = new Set([...wr.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)));
          if (!tops.size) continue;
          words++;
          if (tops.size > 1) splitWords.push({ word: w[0], in: t.textContent.trim().slice(0, 32), lines: tops.size });
        }
      }
      // learn mode (v8 U1a): a hint shows exactly when learn is on and its
      // control (the element right before it) shows, on one line
      const learn = learnIsOn();
      const lrnVisible = [...el.querySelectorAll(".lrnInfo, .lrnText, .lrnHint")].filter(vis).length;
      const hintBad = [];
      let hints = 0;
      for (const h of el.querySelectorAll(".lrnHint")) {
        const ctrl = h.previousElementSibling;
        const shown = vis(h), ctrlShown = !!ctrl && vis(ctrl);
        if (shown !== (learn && ctrlShown)) hintBad.push({ hint: h.textContent, shown, ctrlShown });
        if (!shown) continue;
        hints++;
        rg.selectNodeContents(h);
        const n = new Set([...rg.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
        if (n !== 1) hintBad.push({ hint: h.textContent, lines: n });
      }
      // prose em dashes in the rendered text and in every tooltip
      const dashes = [];
      let chars = 0;
      const walk2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = walk2.nextNode(); t; t = walk2.nextNode()) {
        if (!t.textContent.trim() || !vis(t.parentElement)) continue;
        chars += t.textContent.length;
        if (proseDash(t.textContent)) dashes.push({ text: t.textContent.trim().slice(0, 60) });
      }
      for (const e of [...el.querySelectorAll("[title]"), document.getElementById("learnToggle")])
        if (proseDash(e.title)) dashes.push({ title: e.title.slice(0, 60) });
      return {
        width: el.offsetWidth, client: el.clientWidth, scroll: el.scrollWidth,
        scrollbar: el.offsetWidth - el.clientWidth - el.clientLeft - parseFloat(getComputedStyle(el).borderRightWidth),
        tall: el.scrollHeight > el.clientHeight,
        box: [r1(box.x0), r1(box.x1)], ...rows, elems, lines, textBad: textBad.slice(0, 8), nTextBad: textBad.length,
        words, splitWords: splitWords.slice(0, 8), nSplit: splitWords.length,
        learn, lrnVisible, hints, hintBad: hintBad.slice(0, 6), nHintBad: hintBad.length,
        chars, dashes: dashes.slice(0, 6), nDashes: dashes.length,
      };
    },
    /** every visible child of #app that is not the canvas, the rail, the
     *  full-screen SVG overlay or a modal: its box, and whether it overlaps
     *  the rail. Plus the top chrome's pairwise overlaps: the lens bar, the
     *  readouts, CONTROLS, the TRUE 3D switch, the view cube, the scale bar
     *  and #head's three text lines, measured as rendered text with a long
     *  alloy name in #matline (since v8 D2 also the head plate that holds
     *  them and the readouts, and the SEM and THERM legends that share the
     *  scale bar's slot under it); and since the v8 U1b review the bottom-anchored
     *  items that grow up into that chrome: the open mode panels, the analysis
     *  columns and the SECTION PLANE popup (the columns were left out before:
     *  with all three 3D panels on a short window they climbed into the view
     *  cube, 134px against its bottom at 188 at 1180x800; app/index.html now
     *  caps all of them at --top-band and they scroll) */
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
      // (and no ui.sync) runs in between. Since v8 D2 EVERYTHING below is
      // measured with the long name in: the readouts sit on the head plate
      // under the name and the lens legends are anchored under the plate, so
      // the name moves them, and a box read before the name went in would
      // clash with a line read after it (or miss a real clash)
      const mat = document.getElementById("matline");
      const matWas = mat.textContent;
      mat.textContent = LONG;
      const top = {
        "head h1": textBox(document.querySelector("#head h1")),
        "head .sub": textBox(document.querySelector("#head .sub")),
        "#matline": textBox(mat),
      };
      // by id, not among #app's children: the readouts are inside #head. The
      // head plate itself and the two legends that share the scale bar's
      // slot (v8 D2) are held to the same rule. A found item counts as seen
      const byId = el => { const b = el.getBoundingClientRect(); return b.width >= 1 && b.height >= 1 ? [r1(b.left), r1(b.top), r1(b.right), r1(b.bottom)] : null; };
      for (const n of ["head", "views", "readouts", "learnToggle", "railToggle", "dimSwitch", "viewcube", "scalebar", "sembar", "thermbar"]) {
        const el = document.getElementById(n);
        if (!vis(el) || !byId(el)) continue;
        top[n] = byId(el);
        if (!seen.includes(n)) seen.push(n);
      }
      // (v8 U1b review) the bottom-anchored items that grow upward: every
      // open mode panel, both analysis columns and the SECTION PLANE popup.
      // Each is held against everything above, never against another of them
      // (a mode panel paints over an analysis column by design), and none may
      // start above the window. Their box is their clipped scroll box, so a
      // capped item that scrolls is measured where it is drawn
      const BOTTOM = new Set();
      const scrolls = {};
      const bottomItems = [...document.querySelectorAll("#app > .modepanel")].filter(vis)
        .map(p => [`panel ${p.id || "challenge"}`, p]);
      for (const id of ["apanels", "apanels3", "slicePop"]) if (boxes[id]) bottomItems.push([id, document.getElementById(id)]);
      for (const [n, el] of bottomItems) {
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        top[n] = [r1(b.left), r1(b.top), r1(b.right), r1(b.bottom)];
        BOTTOM.add(n);
        scrolls[n] = el.scrollHeight > el.clientHeight + 1;
      }
      mat.textContent = matWas;
      const offTop = [...BOTTOM].filter(n => top[n][1] < -TOL).map(n => ({ name: n, top: top[n][1] }));
      // #head's text lines are not compared with each other, and the head
      // plate (v8 D2) not with what it holds: its lines and the readouts. The
      // readouts are still compared with the lines, as before the plate
      const HEAD = new Set(["head h1", "head .sub", "#matline"]);
      const ON_PLATE = new Set([...HEAD, "readouts"]);
      const names = Object.keys(top).filter(n => top[n]);
      const clash = [];
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        const [a, b] = [names[i], names[j]];
        if (HEAD.has(a) && HEAD.has(b)) continue;
        if (BOTTOM.has(a) && BOTTOM.has(b)) continue;
        if ((a === "head" && ON_PLATE.has(b)) || (b === "head" && ON_PLATE.has(a))) continue;
        if (hit(top[a], top[b])) clash.push({ a, b, boxA: top[a], boxB: top[b] });
      }
      return { seen, hits, boxes, top: names, clash, bottom: [...BOTTOM], offTop, scrolls };
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
        out.push({ name: p.id || "(challenge)", width: r1(p.getBoundingClientRect().width), nBad: bad.length, bad: bad.slice(0, 4), sliders,
          ...hintAudit(p) });
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
      return { visible: true, ...rowAudit(sp, contentBox(sp)), ...hintAudit(sp) };
    },
    /** (v8 D2) every color the chrome under `items` paints, as computed, on
     *  every rendered element and its ::before / ::after: achromatic (r, g
     *  and b within 2 of each other, or fully transparent), and no glow (a
     *  text-shadow or a box-shadow). An item is an element id, or a selector
     *  when it starts with "#" or "." (the mode panels share one class, and
     *  the challenge's has no id). Canvases are imagery and are not read
     *  here; the THERM legend's strip is a data key, the one gradient the
     *  chrome carries on purpose (tokens.css --legend-therm). Since D2's
     *  second half an SVG is read too, its fill and stroke with the rest:
     *  the phase diagram's frame, ticks, field labels and cursor and the
     *  probe and ruler marks are chrome; a plot's curves and markers are
     *  data and carry `data-mark`, which is all that skips them. `nSvg`
     *  counts the SVG chrome elements read */
    achroma(items) {
      const PROPS = ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
        "outlineColor", "textDecorationColor", "backgroundImage", "fill", "stroke", "accentColor"];
      const chroma = v => {
        for (const m of String(v).matchAll(/rgba?\(([^)]*)\)/g)) {
          const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
          if (a === 0) continue;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 2) return true;
        }
        return /(?:hsla?|oklch|oklab|lch|lab|color)\(/.test(String(v));
      };
      const bad = [];
      const per = {};
      // the first offender under each item, so a report names every surface
      // that failed, not only the first eight elements of the first one
      const badPer = {};
      let n = 0, nSvg = 0;
      for (const item of items) {
        const roots = /^[#.]/.test(item) ? [...document.querySelectorAll(item)] : [document.getElementById(item)];
        for (const root of roots) {
          if (!vis(root)) continue;
          for (const el of [root, ...root.querySelectorAll("*")]) {
            if (!vis(el) || el instanceof HTMLCanvasElement || el.closest("[data-mark]")) continue;
            n++;
            per[item] = (per[item] ?? 0) + 1;
            if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) nSvg++;
            for (const pseudo of [null, "::before", "::after"]) {
              const cs = getComputedStyle(el, pseudo);
              if (pseudo && (cs.content === "none" || cs.content === "normal")) continue;
              if (pseudo === "::before" && el.id === "thermbar") continue;
              const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "";
              const what = `${item} ${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls.split(" ")[0] : ""}${pseudo ?? ""}`;
              const hit = (p, v) => {
                const b = { what, p, v: String(v).slice(0, 60) };
                bad.push(b);
                badPer[item] ??= { n: 0, first: b };
                badPer[item].n++;
              };
              for (const p of PROPS) if (chroma(cs[p])) hit(p, cs[p]);
              for (const p of ["textShadow", "boxShadow"]) if (cs[p] !== "none") hit(p, cs[p]);
            }
          }
        }
      }
      return { n, nSvg, per, badPer, bad: bad.slice(0, 8), nBad: bad.length };
    },
    /** (v8 D2 review) a screenshot's pixels, decoded here: how many there
     *  are, and how many carry a hue, max(r,g,b) - min(r,g,b) over `margin`.
     *  The margin is for what the page paints through the rail's --overlay:
     *  the live canvas shows through at 10% (0.90 alpha), so a fully
     *  saturated lens tints the rail by at most 25.5; font antialiasing is
     *  gray. An amber thumb (255, 180, 84) is 171 */
    async huedPixels(b64, margin) {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, img.width, img.height).data;
      let hued = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > margin) hued++;
      return { px: d.length / 4, hued };
    },
    /** (v8 D2 review) two screenshots of one clip: how many pixels changed
     *  by more than 64 in some channel (a focus ring drawn, or not) */
    async pixelDiff(a64, b64) {
      const load = async s => {
        const img = new Image();
        img.src = "data:image/png;base64," + s;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height);
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, img.width, img.height).data;
      };
      const [a, b] = [await load(a64), await load(b64)];
      let changed = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i += 4)
        if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 64) changed++;
      return changed;
    },
    /** (v8 D2) the view cube's pixels, a face hovered so its highlight is
     *  drawn too: how many are painted and how many carry any hue */
    cubePixels() {
      const c = document.getElementById("viewcube");
      if (!vis(c)) return null;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      // bright: the hover zone's --fg edge (the resting letters are --fg-2,
      // 189), so the highlight is known to have been drawn
      let painted = 0, hued = 0, bright = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        painted++;
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 2) hued++;
        if (d[i + 3] > 200 && Math.min(d[i], d[i + 1], d[i + 2]) > 220) bright++;
      }
      return { painted, hued, bright };
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
      const l = document.getElementById("learnToggle").getBoundingClientRect();
      return {
        vw: innerWidth, railLeft: r1(r.left), railWidth: r1(r.width),
        toggle: [r1(t.left), r1(t.right)], anchored, viewsCenter: r1((v.left + v.right) / 2),
        toggleBox: [r1(t.left), r1(t.top), r1(t.right), r1(t.bottom)],
        learnBox: [r1(l.left), r1(l.top), r1(l.right), r1(l.bottom)],
        hidden: document.body.classList.contains("railHidden"),
      };
    },
  };
};
await page.evaluate(PROBE, LONG_NAME);

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
// RAIL-ACHROMATIC (v8 D2): the chrome D2 restyled, read for color in every
// rail state (learn off and on) and every chrome sample. D2's second half
// adds the panels built in script: every open mode panel (lab mode, heat
// treat, optimizer, challenge: one class), the lab's run report, the
// SECTION PLANE popup, both analysis columns, the alloy composer (its phase
// diagram's chrome included), an enlarged plot and the probe / ruler marks
// on the melt (#overlay); an item that is not on screen reads nothing
const CHROME_IDS = ["head", "views", "transport", "armed", "learnToggle", "railToggle", "dimSwitch", "rail", "hud",
  "hint", "sembar", "scalebar", "thermbar", "tourBtn", "tour",
  "#app > .modepanel", "foundryResults", "slicePop", "apanels", "apanels3", "composer", ".tmodal", "overlay"];
const achromaSamples = [];
// the surfaces and fixtures no rail or chrome sample reaches, read on their own
const extraAchroma = {};
const achroma = async (mode, state) =>
  achromaSamples.push({ mode, state, ...(await page.evaluate(ids => window.__railProbe.achroma(ids), CHROME_IDS)) });
// (v8 D2 review) the rail's pixels, read from a screenshot of it: a slider's
// thumb and track are ::-webkit-slider-* pseudo-elements, which computed
// style cannot reach, so an amber thumb (the old rail's most common amber)
// passed the computed-color read above. Hued means over HUE_MARGIN (see
// PROBE huedPixels: the live canvas tints the rail by at most 25.5)
const HUE_MARGIN = 40;
const railPixelSamples = [];
const railHued = async () => {
  const clip = await S(() => {
    const b = document.getElementById("rail").getBoundingClientRect();
    return { x: b.x, y: 0, width: Math.min(b.width, innerWidth - b.x), height: innerHeight };
  });
  const b64 = await page.screenshot({ clip, encoding: "base64" });
  return page.evaluate((s, m) => window.__railProbe.huedPixels(s, m), b64, HUE_MARGIN);
};
const railPixels = async (mode, state) => railPixelSamples.push({ mode, state, ...(await railHued()) });

// the phone's rail (v8 D2 review): 270px, the narrowest the rail gets, where
// the pills' words used to break inside themselves. Kept apart from
// railSamples (whose counts the clauses below pin) and held to the
// no-sideways-scroll, text-inside and whole-word rules
const phoneRail = [];

/** `real`: the material has SI units, so values print in K, K/s and µm.
 *  `shots`: save the screenshots in this state, BEFORE the sweep, whose
 *  restore cannot return a derived dial that sat outside its slider range */
async function sampleState(mode, state, setup, { real = false, shots: shotsAs = null } = {}) {
  await page.evaluate(setup);
  await sleep(500);
  expands.push({ mode, state, ...(await S(() => window.__railProbe.expandAll())) });
  // the phone first, with the rail open (the gate never hides it here), so
  // the loop below leaves the sweep at the last desktop viewport
  await setVP(...PHONE);
  for (const on of [false, true]) {
    await page.evaluate(b => window.__railProbe.learnSet(b), on);
    const m = await S(() => window.__railProbe.measure());
    phoneRail.push({ mode, state, vp: PHONE.join("x"), learn: on, railShown: await railState() === "shown", ...m });
  }
  await S(() => window.__railProbe.learnSet(false));
  for (const [w, h] of VIEWPORTS) {
    await setVP(w, h);
    // learn mode off (the instrument), then on with every explanation open
    for (const on of [false, true]) {
      await page.evaluate(b => window.__railProbe.learnSet(b), on);
      const m = await S(() => window.__railProbe.measure());
      railSamples.push({ mode, state, vp: `${w}x${h}`, ...m });
      // color does not depend on the viewport: once per state and learn mode
      if (w === VIEWPORTS[0][0]) {
        await achroma(mode, `${state}${on ? " · learn" : ""}`);
        await railPixels(mode, `${state}${on ? " · learn" : ""}`);
      }
    }
    await S(() => window.__railProbe.learnSet(false));
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
/** `learn`: this sample has learn mode on, with the explanations outside the
 *  rail open (`opened` of them, from openPanelInfos) */
async function sampleChrome(mode, what, { learn = false, opened = 0 } = {}) {
  const rail = await railState();
  await achroma(mode, `${what} · rail ${rail}`);
  for (const [w, h] of VIEWPORTS) {
    await setVP(w, h);
    const c = await S(() => window.__railProbe.chrome());
    const panels = await S(() => window.__railProbe.panels());
    c.seen.forEach(n => seenChrome.add(n));
    const t = c.boxes.transport;
    const meets = (a, b) => a[2] > b[0] && a[0] < b[2] && a[3] > b[1] && a[1] < b[3];
    const overTransport = !t ? [] : Object.entries(c.boxes)
      .filter(([n, b]) => clearOfTransport.has(n) && meets(b, t))
      .map(([n, b]) => ({ name: n, box: b, transport: t }));
    // (v8 D2 review) the gesture hint and the analysis columns share a band
    // (both 88px up, the columns painted over it): the hint shown under an
    // open column was cut mid-word, so it must never overlap one
    const hb = c.boxes.hint;
    const hintUnder = !hb ? [] : ["apanels", "apanels3"].filter(n => c.boxes[n] && meets(hb, c.boxes[n]))
      .map(n => ({ column: n, hint: hb, box: c.boxes[n] }));
    chromeSamples.push({ mode, what, rail, vp: `${w}x${h}`, learn, opened, hits: c.hits, overTransport, transportSeen: !!t,
      top: c.top, clash: c.clash, bottom: c.bottom, offTop: c.offTop, scrolls: c.scrolls, panels, hintUnder });
  }
}
/** learn mode on and every explanation outside the rail open, sample, learn off */
async function sampleLearnChrome(mode, what) {
  await S(() => window.__railProbe.learnSet(true));
  const opened = await S(() => window.__railProbe.openPanelInfos());
  await sleep(200);
  await sampleChrome(mode, `${what} · learn`, { learn: true, opened });
  await S(() => window.__railProbe.learnSet(false));
}
/** open a mode panel, sample it with learn mode off and then on, close it;
 *  the panel must actually have appeared. `open` may be async; what it
 *  returns is kept as `ret` (the treated heat treat state's liveness) */
async function samplePanel(mode, what, open, close) {
  const before = new Set((await S(() => window.__railProbe.chrome())).seen);
  const ret = await page.evaluate(open);
  await sleep(600);
  const fresh = (await S(() => window.__railProbe.chrome())).seen.filter(n => !before.has(n));
  fresh.forEach(n => clearOfTransport.add(n));
  panelOpened.push({ mode, what, rail: await railState(), appeared: fresh.length > 0, names: fresh, ret: ret ?? null });
  await sampleChrome(mode, what);
  await sampleLearnChrome(mode, what);
  await page.evaluate(close);
  await sleep(400);
}

// the lens bar's center as app/index.html places it, W being the width the
// rail leaves (the whole window while it is hidden): a 424px floor (the head
// plate's right edge 248 + 20 + half the 312px bar) and 16px off the rail
// (172 = 16 + 156), both since v8 D2 (were 424 and 14 + 143); and since the
// D2 review, on a row of its own (W under 784: the bar at its floor, the
// column beside the rail and their gaps, 580 + 20 + 168 + 16) right-aligned
// under that column, W - 172, the way the view cube stacks
const viewsCenterFor = W => Math.min(Math.max(424, W / 2, W < 784 ? W - 172 : -Infinity), W - 172);
// the chrome's inset from the window and the rail (tokens.css --tool-edge),
// and the gap between the learn toggle and CONTROLS (v8 D2; were 14 and 6)
const EDGE = 16, PILL_GAP = 8;
const hideSamples = [];
const learnPlacement = [];   // RAIL-HIDE: where the learn toggle was expected, per state
const r1n = v => Math.round(v * 10) / 10;
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
    if (!near(hidden.toggle[1], hidden.vw - EDGE)) why.push("CONTROLS not at the edge");
    for (const [id, right] of Object.entries(hidden.anchored))
      if (!near(right, hidden.vw - EDGE)) why.push(`${id} not at the edge`);
    if (!near(hidden.viewsCenter, viewsCenterFor(hidden.vw))) why.push("lens bar not centered on the window");
    if (back.hidden || !near(back.railLeft, back.vw - back.railWidth) || back.railLeft !== shown.railLeft) why.push("rail not back");
    if (!near(back.toggle[1], back.railLeft - EDGE)) why.push("CONTROLS not back beside the rail");
    for (const [id, right] of Object.entries(back.anchored))
      if (!near(right, back.railLeft - EDGE)) why.push(`${id} not back beside the rail`);
    if (!near(back.viewsCenter, viewsCenterFor(back.railLeft))) why.push("lens bar not back in the space the rail leaves");
    // the one control that moves the rail must be reachable in both states,
    // phone included
    for (const [state, g] of [["shown", shown], ["hidden", hidden], ["back", back]])
      if (g.toggle[0] < 0 || g.toggle[1] > g.vw) why.push(`CONTROLS off screen (${state})`);
    // the learn toggle (v8 U1a) rides with CONTROLS: PILL_GAP to its left on
    // the same row, or directly under it only where that row has no room.
    // Which one is expected comes from the same rule the CSS uses
    // (--learn-drop: CONTROLS' right offset + the row's width + EDGE > the
    // window, today only a phone with the rail open), the row's width summed
    // from the two pills as measured (since v8 D2; it was a literal 155, now
    // 184 in the CSS), so a CSS constant that drifts from the pills' real
    // widths fails here too, and a drop at a desktop width fails instead of
    // passing as "under" (the TRUE 3D switch drops by the same 36px, so
    // RAIL-CLEAR's overlap check could not see it). "Under" is bounded: the
    // 36px drop less CONTROLS' own 28px height leaves an 8px gap, so a toggle
    // anywhere further down than 12px does not count
    for (const [state, g] of [["shown", shown], ["hidden", hidden], ["back", back]]) {
      const [l, c] = [g.learnBox, g.toggleBox];
      const ctlRight = g.vw - g.toggle[1];
      const rowW = (l[2] - l[0]) + PILL_GAP + (c[2] - c[0]) + EDGE;
      const expectUnder = ctlRight + rowW > g.vw;
      const beside = near(l[2], c[0] - PILL_GAP) && near(l[1], c[1]);
      const under = near(l[2], c[2]) && l[1] >= c[3] - 0.5 && l[1] - c[3] <= 12;
      if (expectUnder ? !under : !beside)
        why.push(`learn toggle not ${expectUnder ? "under" : "beside"} CONTROLS (${state}, gap ${r1n(l[1] - c[3])})`);
      if (l[0] < 0 || l[2] > g.vw || l[1] < 0) why.push(`learn toggle off screen (${state})`);
    }
    learnPlacement.push(...[shown, hidden, back].map((g, i) => ({
      vp: `${w}x${h}`, state: ["shown", "hidden", "back"][i],
      under: g.vw - g.toggle[1] + (g.learnBox[2] - g.learnBox[0]) + PILL_GAP + (g.toggleBox[2] - g.toggleBox[0]) + EDGE > g.vw,
      gap: r1n(g.learnBox[1] - g.toggleBox[3]),
    })));
    hideSamples.push({ mode, vp: `${w}x${h}`, ok: why.length === 0, why, shown, hidden, back });
  }
}

// (v8 D2 review) a 390x844 phone, the layouts no desktop viewport reaches.
// Its first screen: ui.ts boots a phone with the rail hidden, where the head
// plate used to run under the learn toggle, CONTROLS and the TRUE 3D switch
// and the lens bar over the readouts; now the plate gives way to the column
// and the bar goes under the plate, and every top item (the plate, its text
// lines, the readouts, the lens bar, the toggles, the switch, the view cube)
// must clear every other. Then the rail open: it leaves 120px, and the
// plate, the lens bar, the switch and the readouts used to stay placed
// there, the switch and the bar running off the left edge and LEARN printed
// over the plate's subtitle; now what shows must clear the rail and each
// other. Then lab mode opened from that state: the rail gives way (hidden),
// and the panel clears the controls that must stay reachable. The analysis
// columns are closed for these, as a new page has them (with a column open a
// phone's legend slot and the column can meet: U3, tasks/todo.md)
const phoneSamples = [];
const MUST_REACH = new Set(["learnToggle", "railToggle", "views", "dimSwitch"]);
async function samplePhone(mode, columns) {
  await setVP(...PHONE);
  await page.evaluate(columns, false);
  await sleep(200);
  if (await railState() === "shown") await toggleRail();
  const c0 = await S(() => window.__railProbe.chrome());
  phoneSamples.push({ mode, what: "rail hidden", rail: await railState(), hits: c0.hits, clash: c0.clash, top: c0.top });
  await toggleRail();
  const c = await S(() => window.__railProbe.chrome());
  phoneSamples.push({ mode, what: "rail open", rail: await railState(), hits: c.hits, clash: c.clash, top: c.top });
  await S(() => window.__solidify.app.startLab());
  await sleep(600);
  await settle();
  const c2 = await S(() => window.__railProbe.chrome());
  const reach = c2.clash.filter(x => (x.a.startsWith("panel ") && MUST_REACH.has(x.b)) || (x.b.startsWith("panel ") && MUST_REACH.has(x.a)));
  phoneSamples.push({ mode, what: "lab mode opened", rail: await railState(), hits: c2.hits, clash: reach, top: c2.top,
    panel: c2.bottom.some(n => n.startsWith("panel ")) });
  await S(() => window.__solidify.lab.close());
  await sleep(300);
  if (await railState() === "hidden") await toggleRail();
  await page.evaluate(columns, true);
  await sleep(200);
}

const slices = [];
async function shots(mode) {
  await setVP(1440, 900);
  for (const on of [false, true]) {
    await page.evaluate(b => window.__railProbe.learnSet(b), on);
    const name = on ? `${mode}-learn` : mode;
    for (const [tag, f] of [["top", 0], ["mid", 0.5], ["bottom", 1]]) {
      await page.evaluate(f => { const r = document.getElementById("rail"); r.scrollTop = f * (r.scrollHeight - r.clientHeight); }, f);
      await sleep(200);
      await page.screenshot({ path: `${OUT}/rail-${name}-${tag}.png` });
    }
    console.log(`shot rail-${name}-{top,mid,bottom}.png`);
  }
  await S(() => window.__railProbe.learnSet(false));
  await S(() => { document.getElementById("rail").scrollTop = 0; });
}

// a new viewer (puppeteer's fresh profile has no storage): learn mode must be
// off, stored nowhere, and render nothing, even with every section open
const learnBoot = await S(() => { window.__railProbe.expandAll(); return window.__railProbe.learnState(); });

// ================================================================= 2D
await sampleState("2d", "boot: model metal", () => {});
// RAIL-ACHROMATIC's detector on a planted fixture first: an amber line and a
// glow in the rail must both be caught, the line by its color and the glow by
// its text-shadow (a detector that caught nothing would pass every page)
const achromaFixture = await S(() => {
  const r = document.getElementById("rail");
  const a = document.createElement("span");
  a.textContent = "amber";
  a.style.color = "rgb(255, 180, 84)";
  const b = document.createElement("span");
  b.textContent = "glow";
  b.style.textShadow = "0 0 8px rgb(0, 0, 0)";
  r.prepend(a, b);
  const got = window.__railProbe.achroma(["rail"]);
  a.remove(); b.remove();
  return { nBad: got.nBad, props: got.bad.map(x => x.p).sort() };
});
// (v8 D2 review) and the pixel read on its own fixture: the old rail's amber
// slider thumb and track, planted as a stylesheet, must be caught by the
// pixels (and, a witness that the computed read cannot see it, it is missed
// by that); then removed, the rail reads clean again
await setVP(...VIEWPORTS[0]);
await S(() => { document.getElementById("rail").scrollTop = 0; });
const pixelFixture = {};
pixelFixture.before = await railHued();
pixelFixture.computedBefore = await S(() => window.__railProbe.achroma(["rail"]).nBad);
await S(() => {
  const s = document.createElement("style");
  s.id = "railPlant";
  s.textContent = `:where(.tool) input[type="range"]::-webkit-slider-thumb { background: rgb(255, 180, 84) !important; }
    :where(.tool) input[type="range"]::-webkit-slider-runnable-track { background: rgb(255, 180, 84) !important; }`;
  document.head.append(s);
});
await sleep(200);
pixelFixture.planted = await railHued();
pixelFixture.computedPlanted = await S(() => window.__railProbe.achroma(["rail"]).nBad);
await S(() => document.getElementById("railPlant").remove());
await sleep(200);
pixelFixture.after = await railHued();
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
// learn on, one explanation open in the column: it grows upward
await sampleLearnChrome("2d", "ETCH lens + analysis panels");
await page.evaluate(() => { window.__solidify.app.setView(6); window.__solidify.ui.sync(); });   // SEM bar
await sampleChrome("2d", "SEM lens + analysis panels");
// (v8 D2 review) THERM: its legend shares the slot under the head plate and
// is 176px tall, and no sample switched to it before, so nothing had read
// it. With the analysis columns closed, so the gesture hint (which steps out
// while a column is open) is measured against the chrome too
await page.evaluate(() => {
  const S = window.__solidify;
  S.analyze.setProbeOn(false); S.analyze.setScheilOn(false); S.analyze.setTextureOn(false);
  S.app.setView(5); S.ui.sync();
});
await sampleChrome("2d", "THERM lens, columns closed");
// the legend's strip is the one gradient the chrome may carry, exempted by
// its ::before: that exemption must cover the strip and nothing else. Clean,
// the legend reads gray with its strip on screen; an amber label, and an
// amber edge on the legend's own plate, are each caught, on that element
extraAchroma.thermFixture = await S(() => {
  const P = window.__railProbe;
  const bar = document.getElementById("thermbar");
  const read = () => {
    const r = P.achroma(["thermbar"]);
    return { n: r.n, nBad: r.nBad, props: [...new Set(r.bad.map(b => b.p))], what: [...new Set(r.bad.map(b => b.what))] };
  };
  const clean = read();
  const lo = bar.querySelector(".lo");
  lo.style.color = "rgb(255, 180, 84)";
  const label = read();
  lo.style.color = "";
  bar.style.borderColor = "rgb(255, 180, 84)";
  const plate = read();
  bar.style.borderColor = "";
  return { shown: P.vis(bar), strip: getComputedStyle(bar, "::before").backgroundImage.startsWith("linear-gradient"), clean, label, plate };
});
await page.evaluate(() => {
  const S = window.__solidify;
  S.analyze.setProbeOn(true); S.analyze.setScheilOn(true); S.analyze.setTextureOn(true);
  S.app.setView(6); S.ui.sync();
});
await samplePanel("2d", "lab", () => window.__solidify.app.startLab(), () => window.__solidify.lab.close());
await samplePanel("2d", "heat treat", () => window.__solidify.app.startHeat(), () => window.__solidify.heat.close());
await samplePanel("2d", "optimizer", () => window.__solidify.app.startOptimizer(), () => window.__solidify.opt.stop());
await samplePanel("2d", "challenge", () => window.__solidify.app.startChallenge(), () => window.__solidify.challenge.stop());
// (v8 U1b review) a heat treat panel carrying a real report: a 4 h anneal of
// a seeded 512² aluminum casting (verify-heattreat-gpu's pour). With learn
// mode on its card took the uncapped panel to -48px at 1024x768, header and
// exit button off screen; `ret` proves the card was really there
await samplePanel("2d", "heat treat after a 4 h anneal", async () => {
  const S = window.__solidify;
  S.app.setRun(false);
  S.app.setGrid(512);
  await new Promise(r => setTimeout(r, 400));
  const s = S.sim();
  let rs = 0x9e3779b9 >>> 0;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  Object.assign(s.params, { scen: 0, heatIn: 0, coolRate: 0.6, alloyOn: 0, twinProb: 0, noiseAmp: 0.01, aniMode: 4, delta: 0.04, latent: 1.4 });
  s.reset(1 - 0.9);
  for (let i = 0; i < 1600; i++) s.addSeed(rnd() * s.n, rnd() * s.n, 2.5, rnd() * Math.PI * 2);
  for (let i = 0; i < 12; i++) await s.stepSync(0);
  let fs = 0;
  for (let k = 0; k < 60; k++) {
    await s.stepSync(120);
    const st = await s.readStats();
    if (st) fs = st.fracSolid;
    if (fs > 0.985) break;
  }
  S.app.startHeat();
  const panel = document.getElementById("heattreat");
  const btn = document.getElementById("htRun");
  const note = () => document.getElementById("htNote").textContent;
  for (let i = 0; i < 40 && /waiting/.test(note()); i++) await new Promise(r => setTimeout(r, 100));
  const hold = panel.querySelectorAll('input[type="range"]')[1];
  hold.value = "240";
  hold.dispatchEvent(new Event("input", { bubbles: true }));
  for (let i = 0; i < 40 && btn.disabled; i++) await new Promise(r => setTimeout(r, 100));
  const armed = !btn.disabled;
  btn.click();
  for (let i = 0; i < 100 && !S.heat.busy; i++) await new Promise(r => setTimeout(r, 50));
  for (let i = 0; i < 1200 && S.heat.busy; i++) await new Promise(r => setTimeout(r, 100));
  // run() clears `busy` BEFORE its after-census and the card (heatpanel.ts;
  // verify-heattreat-gpu waits for the card the same way): a read the moment
  // busy drops can land before the card exists (card 0 in one D2 review run)
  const card = () => document.getElementById("htReport").textContent.length;
  for (let i = 0; i < 100 && card() === 0; i++) await new Promise(r => setTimeout(r, 100));
  return { fs: +fs.toFixed(3), armed, card: card() };
}, () => window.__solidify.heat.close());

// (v8 D2) RAIL-ACHROMATIC's surfaces that no sample above opens, each read
// learn off and then on with its explanations open: the lab's run report
// (built on the casting in the mold, flagged as intervened so its warning
// line renders; `ret` proves the report was on screen with its rows), the
// alloy composer on 1045 steel with zinc picked (a clamp, a phase not grown,
// a fume warning and the drawn phase diagram, whose SVG chrome must be
// read), and an enlarged plot. Then the SVG half of the detector on a
// planted defect: the diagram's frame stroked amber must be caught, by its
// stroke, while the amber liquidus (a data mark) is not
const achromaBoth = async (what, sel) => {
  await achroma("2d", what);
  await S(() => window.__railProbe.learnSet(true));
  await S(`(() => { for (const b of document.querySelectorAll("${sel} .lrnInfo")) if (window.__railProbe.vis(b) && b.getAttribute("aria-expanded") !== "true") b.click(); })()`);
  await sleep(200);
  await achroma("2d", `${what} · learn`);
  await S(() => window.__railProbe.learnSet(false));
};
extraAchroma.labReport = await S(async () => {
  const S = window.__solidify, L = S.lab;
  S.app.startLab();
  L.intervened = true;
  await L.buildReport();
  L.toggleResults(true);
  const r = document.getElementById("foundryResults");
  return { shown: !!r && !r.classList.contains("hidden"), rows: r.querySelectorAll(".spec__row, .kv__row").length,
    warn: r.querySelectorAll(".warnline").length };
});
await sleep(400);
await achromaBoth("lab report", "#foundryResults");
await S(() => window.__solidify.lab.close());
extraAchroma.composer = await S(async () => {
  const c = window.__solidify.composer;
  c.open();
  await new Promise(r => setTimeout(r, 200));
  [...document.querySelectorAll("#composer .famous button")].find(b => b.textContent.trim() === "1045 steel").click();
  // zinc over iron: an unassessed pair that is also a 59 atm fume
  document.querySelector('#composer .gcell[data-el="Zn"]').click();
  await new Promise(r => setTimeout(r, 200));
  const q = s => document.querySelectorAll(`#composer ${s}`).length;
  return { open: c.isOpen(), clamps: q(".clamp"), notGrown: q(".cinfo"), fume: q(".gwhy .warnline"), svgChrome: q(".pdsvg :not([data-mark])") };
});
await achromaBoth("composer", "#composer");
extraAchroma.svgFixture = await S(() => {
  const frame = document.querySelector("#composer .pdframe");
  frame.style.stroke = "rgb(255, 180, 84)";
  const got = window.__railProbe.achroma(["composer"]);
  frame.style.stroke = "";
  const liquidusAmber = getComputedStyle(document.querySelector('#composer [data-mark="liquidus"]')).stroke;
  return { nBad: got.nBad, props: got.bad.map(x => x.p), what: got.bad.map(x => x.what), liquidusAmber, nSvg: got.nSvg };
});
await S(() => window.__solidify.composer.close());
extraAchroma.enlarged = await S(async () => {
  document.querySelector("#texPanel .zoomBtn").click();
  await new Promise(r => setTimeout(r, 300));
  return !!document.querySelector("#app > .tmodal");
});
await achroma("2d", "enlarged plot");
await S(() => document.getElementById("bigClose")?.click());
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
await samplePhone("2d", on => {
  const S = window.__solidify;
  S.analyze.setProbeOn(on); S.analyze.setScheilOn(on); S.analyze.setTextureOn(on);
  S.ui.sync();
});
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
// (v8 D2) the view cube is lettered on gray faces, its hover zone --fg: a
// hovered face, so the highlight is drawn, and then every painted pixel read
await page.evaluate(() => { window.__solidify.vc().hoverDir = [0, 0, 1]; });
await sleep(300);
const cubeRead = await S(() => window.__railProbe.cubePixels());
await page.evaluate(() => { window.__solidify.vc().hoverDir = null; });
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
// learn on: the popup's explanation and hint, and one explanation open in the
// column, the popup measured for its rows and hint at every viewport too. On
// the Niyama cut style, the popup's tallest state (its legend line and that
// line's learn sentence), which is what took it over the readouts and the
// scale bar before it was capped; the style goes back to the default after
const setCutStyle = last => S(`(() => {
  const sel = document.querySelector("#slicePop select");
  sel.value = String(${last} ? sel.options.length - 1 : 0);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  window.__solidify.ui.sync();
  return sel.selectedOptions[0]?.textContent ?? null;
})()`);
const niyamaStyle = await setCutStyle(true);
await sleep(300);
await S(() => window.__railProbe.learnSet(true));
await S(() => window.__railProbe.openPanelInfos());
for (const [w, h] of VIEWPORTS) {
  await setVP(w, h);
  slices.push({ vp: `${w}x${h}`, style: niyamaStyle, ...(await S(() => window.__railProbe.slicePop())) });
}
await S(() => window.__railProbe.learnSet(false));
await sampleLearnChrome("3d", "SLICE lens (Niyama style) + analysis panels");
await setCutStyle(false);
// (v8 D2 review) the volume's THERM lens (LENS3 6) and its legend, with the
// columns closed so the gesture hint is measured too, as in 2D
await page.evaluate(() => {
  const a = window.__solidify.app;
  a.setStereoOn(false); a.setIpfOn(false); a.setPoleOn(false);
  a.setView3d(6);
  window.__solidify.ui.sync();
});
await sleep(300);
await sampleChrome("3d", "THERM lens, columns closed");
await page.evaluate(() => {
  const a = window.__solidify.app;
  a.setStereoOn(true); a.setIpfOn(true); a.setPoleOn(true);
  a.setView3d(4);   // SEM bar
  window.__solidify.ui.sync();
});
await sleep(300);
await sampleChrome("3d", "SEM lens + analysis panels");
await samplePanel("3d", "lab", () => window.__solidify.app.startLab(), () => window.__solidify.lab.close());
await samplePanel("3d", "heat treat", () => window.__solidify.app.startHeat(), () => window.__solidify.heat.close());
await toggleRail();
await sampleChrome("3d", "rail hidden: SEM lens + analysis panels");
await samplePanel("3d", "lab, rail hidden", () => window.__solidify.app.startLab(), () => window.__solidify.lab.close());
await samplePanel("3d", "heat treat, rail hidden", () => window.__solidify.app.startHeat(), () => window.__solidify.heat.close());
await toggleRail();
await sampleHide("3d");
await samplePhone("3d", on => {
  const a = window.__solidify.app;
  a.setStereoOn(on); a.setIpfOn(on); a.setPoleOn(on);
  window.__solidify.ui.sync();
});

// ================================================================= learn mode
// (v8 U1a) Behavior, driven the way a visitor drives it: a real click on the
// top bar's toggle and real key presses. Last, because it reloads the page.
await setVP(1440, 900);
const learnRun = { boot: learnBoot };
learnRun.audit = await S(() => window.__solidify.ui.learnAudit());
// the panels' hints (v8 U1b review), read with the rail's audit above and so
// before the reload below resets the record: every panel has been built by
// now, lab mode and heat treat in both modes and the SECTION PLANE popup, so
// every declared hint must be bound. (Through the app's own module, not a
// page-side import of learn/panels.ts, which vite can serve as a second,
// empty instance.)
learnRun.panelAudit = learnRun.audit.panelHints;
// a freshly loaded page, learn stored off: the samples above expanded every
// explanation, and an explanation stays expanded while learn is toggled
const reloadPage = async () => {
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
  await sleep(800);
  await page.evaluate(PROBE, LONG_NAME);
};
await S(() => window.__railProbe.learnSet(false));
await reloadPage();
await S(() => window.__railProbe.expandAll());
await page.click("#learnToggle");
await sleep(200);
learnRun.on = await S(() => window.__railProbe.learnState());
// From the keyboard: Shift+Tab from a section's first control must land on
// its "i" (it is in the tab order), and Enter on the first, Space on the
// fourth, must each open its explanation, neither opening nor closing the
// section (the "i" sits inside a clickable header). Space is also the app's
// run/pause shortcut, which used to swallow it on every focused button.
learnRun.keys = [];
for (const [i, key] of [[0, "Enter"], [3, "Space"]]) {
  const startFocused = await page.evaluate(i => window.__railProbe.focusAfterInfo(i), i);
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  const before = await page.evaluate(i => window.__railProbe.infoAt(i), i);
  const running = await S(() => window.__solidify.app.isRunning());
  await page.keyboard.press(key);
  await sleep(150);
  const after = await page.evaluate(i => window.__railProbe.infoAt(i), i);
  const runningAfter = await S(() => window.__solidify.app.isRunning());
  learnRun.keys.push({ i, key, startFocused, before, after, runToggled: running !== runningAfter });
}
// The section header itself, one more Shift+Tab back from the "i": Enter
// closes the (open) section and Space opens it again, aria-expanded following
// both times. Before the header was a button, a keyboard could reach every
// explanation but open no collapsed section.
{
  const i = 1;
  const startFocused = await page.evaluate(i => window.__railProbe.focusAfterInfo(i), i);
  for (let n = 0; n < 2; n++) {
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
  }
  const s0 = await page.evaluate(i => window.__railProbe.infoAt(i), i);
  const running = await S(() => window.__solidify.app.isRunning());
  await page.keyboard.press("Enter");
  await sleep(150);
  const s1 = await page.evaluate(i => window.__railProbe.infoAt(i), i);
  await page.keyboard.press("Space");
  await sleep(150);
  const s2 = await page.evaluate(i => window.__railProbe.infoAt(i), i);
  const runToggled = running !== await S(() => window.__solidify.app.isRunning());
  learnRun.headKeys = { startFocused, s0, s1, s2, runToggled };
}
// Space as run/pause must still work where no control has the keyboard: the
// positive control for `runToggled` above (a handler that swallowed Space
// everywhere would pass that clause), and the mouse case the first cut got
// wrong. It read :focus-visible, which Chrome sets on a mouse-clicked button
// on the Space keydown itself, so after any click on a rail or top-bar button
// Space pressed that button again instead of running or pausing.
learnRun.space = [];
{
  await S(() => document.activeElement?.blur());
  const r0 = await S(() => window.__solidify.app.isRunning());
  await page.keyboard.press("Space");
  await sleep(150);
  const r1 = await S(() => window.__solidify.app.isRunning());
  await page.keyboard.press("Space");
  await sleep(150);
  const r2 = await S(() => window.__solidify.app.isRunning());
  learnRun.space.push({ where: "nothing focused", flipped: r0 !== r1, restored: r2 === r0, pressed: false });
}
// each clicked by the mouse, then Space twice: the run flips and flips back,
// and the button's own state (what a second press would change) holds
for (const [where, sel, read] of [
  ["learn toggle", "#learnToggle", () => document.getElementById("learnToggle").getAttribute("aria-pressed")],
  ["an \"i\"", "#rail > .sec:first-child .lrnInfo", () => document.querySelector("#rail > .sec:first-child .lrnInfo").getAttribute("aria-expanded")],
  ["ETCH lens", "#views button:nth-child(3)", () => String(window.__solidify.app.getView())],
]) {
  await page.click(sel);
  await sleep(150);
  const before = await page.evaluate(read);
  const r0 = await S(() => window.__solidify.app.isRunning());
  await page.keyboard.press("Space");
  await sleep(150);
  const r1 = await S(() => window.__solidify.app.isRunning());
  const mid = await page.evaluate(read);
  await page.keyboard.press("Space");
  await sleep(150);
  const r2 = await S(() => window.__solidify.app.isRunning());
  const after = await page.evaluate(read);
  learnRun.space.push({ where, flipped: r0 !== r1, restored: r2 === r0, pressed: mid !== before || after !== before, before, mid, after });
  // undo the click itself, so the state below is the one the run left
  await page.click(sel);
  await sleep(150);
}
await S(() => { window.__solidify.app.setView(0); window.__solidify.ui.sync(); });
await S(() => window.__railProbe.learnSet(true));
learnRun.expanded = await S(() => window.__railProbe.learnState());
await page.click("#learnToggle");
await sleep(200);
learnRun.off = await S(() => window.__railProbe.learnState());
// remembered per viewer: on, reload, still on
await page.click("#learnToggle");
await sleep(200);
await reloadPage();
learnRun.reloaded = await S(() => { window.__railProbe.expandAll(); return window.__railProbe.learnState(); });
await S(() => window.__railProbe.learnSet(false));

// Storage that throws on access (a private window, blocked site data): the
// page must still boot, and the toggle and the section headers still work.
{
  const p2 = await browser.newPage();
  const p2errors = [];
  p2.on("pageerror", e => p2errors.push(String(e.stack ?? e)));
  p2.on("console", m => { if (m.type() === "error") p2errors.push(m.text()); });
  await p2.evaluateOnNewDocument(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("storage blocked by verify-rail", "SecurityError"); },
    });
  });
  await p2.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  let booted = true;
  try { await p2.waitForFunction("!!window.__solidify", { timeout: 20000 }); } catch { booted = false; }
  await sleep(600);
  const got = !booted ? {} : await p2.evaluate(async () => {
    // did the perturbation land? (without this the clause could pass on a
    // page whose storage works)
    let throws = false;
    try { void window.localStorage; } catch { throws = true; }
    const h = document.querySelector("#rail > .sec:nth-child(2) > h2");
    const body = h.parentElement.querySelector(":scope > .secbody");
    const openBefore = body.style.display;
    h.click();
    const headerToggles = body.style.display !== openBefore;
    const btn = document.getElementById("learnToggle");
    btn.click();
    await new Promise(r => requestAnimationFrame(() => r()));
    const infosShown = [...document.querySelectorAll("#rail .lrnInfo")].filter(b => b.getClientRects().length).length;
    return { throws, headerToggles, aria: btn.getAttribute("aria-pressed"), infosShown };
  });
  // the analytics beacon is a third-party script that reads storage itself;
  // its errors are reported, not held against the instrument
  const ownErrors = p2errors.filter(e => !/zgo\.at|goatcounter/i.test(e));
  learnRun.blocked = { booted, ...got, ownErrors, thirdPartyErrors: p2errors.length - ownErrors.length };
  await p2.close();
}

// (v8 D2 review) The focus ring of the controls that float over the canvas,
// read as pixels over the near-white ETCH lens at t = 0: the tool's ring
// sits 2px outside a pill, which there is white on white. Each control is
// shot unfocused and then focused from the keyboard (:focus-visible
// asserted), and the ring must change enough pixels: the learn toggle off,
// the learn toggle pressed (its white fill takes a --bg ring), and the TRUE 3D
// switch. On a page of its own, and learn put back off, so the main page's
// state and the stored setting are as they were
{
  const p3 = await browser.newPage();
  await p3.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  await p3.waitForFunction("!!window.__solidify", { timeout: 20000 });
  await sleep(800);
  await p3.evaluate(PROBE, LONG_NAME);
  await p3.evaluate(() => {
    const a = window.__solidify.app;
    a.setRun(false);
    a.resetArmed();
    a.setView(2);   // ETCH
    window.__solidify.ui.sync();
  });
  await sleep(600);
  const clipOf = sel => p3.evaluate(sel => {
    const b = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.round(b.x) - 6, y: Math.round(b.y) - 6, width: Math.round(b.width) + 12, height: Math.round(b.height) + 12 };
  }, sel);
  const ring = async (what, sel, press) => {
    await p3.evaluate(() => document.activeElement?.blur());
    const clip = await clipOf(sel);
    // keyboard modality, then focus: Tab onto the control from the one before it
    await p3.evaluate(sel => {
      const el = document.querySelector(sel);
      const all = [...document.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
        .filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
      all[all.indexOf(el) - 1]?.focus();
    }, sel);
    await p3.keyboard.press("Tab");
    if (press) await p3.keyboard.press("Enter");
    await sleep(250);
    const st = await p3.evaluate(sel => {
      const el = document.querySelector(sel);
      return { focused: document.activeElement === el, visible: el.matches(":focus-visible"), pressed: el.getAttribute("aria-pressed") };
    }, sel);
    const on = await p3.screenshot({ clip, encoding: "base64" });
    await p3.evaluate(() => document.activeElement?.blur());
    await sleep(250);
    const off = await p3.screenshot({ clip, encoding: "base64" });
    const changed = await p3.evaluate((a, b) => window.__railProbe.pixelDiff(a, b), on, off);
    return { what, ...st, changed, px: clip.width * clip.height };
  };
  const rings = [];
  rings.push(await ring("learn toggle", "#learnToggle", false));
  rings.push(await ring("learn toggle pressed", "#learnToggle", true));
  rings.push(await ring("TRUE 3D switch", "#dimSwitch .actswitch", false));
  // learn back off, from the keyboard like it went on
  await p3.evaluate(() => { const b = document.getElementById("learnToggle"); if (b.getAttribute("aria-pressed") === "true") b.click(); });
  learnRun.rings = { rings, learnAfter: await p3.evaluate(() => document.getElementById("learnToggle").getAttribute("aria-pressed")) };
  await p3.close();
}

// A composer mix poured in calibrated mode, the state verify-quant's
// CALIB-POUR-WIRED drives: the SCALE calibration readout then carries the
// mix's own source line (main.ts coefficientSource), which no rail sample
// above reaches. Its first cut printed alloy.ts's dT0Source there, prose with
// em dashes for four of the nine famous presets. Measured once, learn off and
// on, for RAIL-NO-EMDASH, and kept out of railSamples so their counts hold.
const pourRun = await S(() => {
  const S = window.__solidify;
  S.app.setMaterial("al");
  const poured = S.composer.applyHash("#alloy=al:Si7,Mg0.35");
  S.app.setCalibrated(true);
  S.ui.sync();
  window.__railProbe.expandAll();
  const src = S.app.calibration()?.coefficientSource ?? null;
  const out = {
    poured, src, name: S.app.getAlloyName(),
    inRail: !!src && document.getElementById("rail").textContent.includes(src), samples: [],
  };
  for (const on of [false, true]) {
    window.__railProbe.learnSet(on);
    const m = window.__railProbe.measure();
    out.samples.push({ learn: on, nDashes: m.nDashes, dashes: m.dashes, chars: m.chars });
  }
  window.__railProbe.learnSet(false);
  return out;
});
// (v8 D2) the tour card, which no sample above opens, for RAIL-ACHROMATIC:
// its first chapter, learn off; `shown` proves the card was on screen
const tourOpen = await S(async () => {
  await window.__solidify.tour.goto(0);
  return document.getElementById("tour").classList.contains("show");
});
await sleep(300);
await achroma("2d", "tour open");
// (v8 D2 review) and a chapter with a highlight ring on screen: chapter 0
// has none, so the ring (amber before D2) was never read. The Material
// chapter rings a rail section and the head plate; `hl` proves they carry it
const tourHl = await S(async () => {
  const T = await import("/src/tour.ts");
  const i = T.CHAPTERS.findIndex(c => c.title === "Material");
  if (i < 0) return { i, hl: 0 };
  await window.__solidify.tour.goto(i);
  return { i, shown: document.getElementById("tour").classList.contains("show"),
    hl: [...document.querySelectorAll(".hl")].filter(e => window.__railProbe.vis(e)).length };
});
await sleep(300);
await achroma("2d", "tour open · highlight");
await S(() => window.__solidify.tour.close());

// the in-page detector (PROBE's copy, which reads every rendered sample) on
// the same fixture as the Node one below
const fixtureDom = await S(() => {
  const d = window.__railProbe.proseDash;
  return ["a — b", "—x", "x—", " — "].every(d) && !["—", "5–10 K", "Al–Cu"].some(d);
});

// Every string the rail's learn layer can show, from the modules that own
// them, including every material's (only one material is on screen at a
// time) and every branch of the SCALE group lines
const sources = await S(async () => {
  const R = await import("/src/learn/rail.ts");
  const M = await import("/src/materials.ts");
  const U = await import("/src/units.ts");
  const A = await import("/src/alloy.ts");
  const Q = await import("/src/quant.ts");
  const out = [];   // [kind, where, text]; kind: learn | line | hint
  // the calibration readout's line for every famous preset poured onto its
  // own base (only one can be on screen at a time; pourRun reads one live)
  for (const p of A.FAMOUS) {
    const si = M.MATERIALS[A.BASES[p.mix.base].materialKey].si;
    out.push(["line", `pour ${p.label}`, Q.pouredMixSource(A.derive(p.mix), si)]);
  }
  for (const e of R.RAIL_LEARN) {
    out.push(["learn", e.id, e.text]);
    for (const [k, h] of Object.entries(e.hints ?? {})) out.push(["hint", `${e.id} ${k}`, h]);
  }
  for (const [k, t] of Object.entries(R.RAIL_NOTES)) out.push(["learn", `note ${k}`, t]);
  for (const [k, c] of Object.entries(R.RAIL_CAVEATS)) out.push(["line", `caveat ${k}`, c.line], ["learn", `caveat ${k}`, c.learn]);
  // what learn mode shows outside the rail (v8 U1b review): the panel
  // entries and their hints, the panels' caveat pairs, the report cards' and
  // status lines' sentences, and the lab report's thermal notes
  const P = await import("/src/learn/panels.ts");
  const TH = await import("/src/thermal.ts");
  for (const e of P.PANEL_LEARN) {
    out.push(["learn", e.id, e.text]);
    for (const [k, h] of Object.entries(e.hints ?? {})) out.push(["hint", `${e.id} ${k}`, h]);
  }
  for (const [group, caveats] of [["lab", P.LAB_CAVEATS], ["heat", P.HEAT_CAVEATS], ["opt", P.OPT_CAVEATS]])
    for (const [k, c] of Object.entries(caveats)) {
      if (c.line) out.push(["line", `${group} ${k}`, c.line]);
      out.push(["learn", `${group} ${k}`, c.learn]);
    }
  for (const [k, t] of Object.entries(P.LAB_CARDS)) out.push(["learn", `card ${k}`, t]);
  for (const [k, t] of Object.entries(P.STATUS_LEARN)) out.push(["learn", `status ${k}`, t]);
  for (const [k, t] of Object.entries(TH.THERMAL_LEARN)) out.push(["line", `thermal ${k.slice(0, 24)}`, k], ["learn", `thermal ${k.slice(0, 24)}`, t]);
  const m3 = M.to3D({ label: "", note: "", learn: "", params: { aniMode: 2 } });
  out.push(["line", "note3d", m3.note3d], ["learn", "learn3d", m3.learn3d]);
  for (const r of [0, 0.5, 50, 5e3, 5e5, 5e7]) out.push(["line", `regime ${r}`, U.regimeOf(r)]);
  for (const [k, m] of Object.entries(M.MATERIALS)) {
    out.push(["line", `${k} note`, m.note], ["learn", `${k} learn`, m.learn]);
    const base = { n: 1024, dx: 0.03, latent: m.params.latent ?? 1.6, dSol: 0.9, umPerCell: 1 };
    if (!m.si) {
      const s = U.scaleOf({ ...base, si: null, alloy: false });
      out.push(["line", `${k} scale`, s.note], ["learn", `${k} scale`, s.learn]);
      continue;
    }
    out.push(["line", `${k} source`, m.si.source], ["learn", `${k} sourceLearn`, m.si.sourceLearn]);
    // the last case matches the model's Lewis ratio to the real one, the
    // "close to matched" branch
    for (const [alloy, lambda, dSol] of [[true, null], [false, null], [true, 10], [false, 10], [true, 60], [false, 60],
      [false, null, m.si.Dl / m.si.alphaTh]]) {
      const s = U.scaleOf({ ...base, si: m.si, alloy, lambda, ...(dSol ? { dSol } : {}) });
      out.push(["line", `${k} scale`, s.note], ["learn", `${k} scale`, s.learn]);
      for (const g of s.groups) out.push(["line", `${k} ${g.name}`, g.note], ["learn", `${k} ${g.name}`, g.learn]);
    }
  }
  return [...new Map(out.map(o => [o.join("|"), o])).values()];
});

// ================================================================= verdicts
const brief = s => ({ mode: s.mode, state: s.state, vp: s.vp });

{
  const bad = railSamples.filter(s => s.scroll > s.client).map(s => ({ ...brief(s), scrollWidth: s.scroll, clientWidth: s.client }));
  // the test condition must be the visitor's: a real scrollbar on a rail
  // whose opened sections are taller than the window
  const scrollbarSeen = railSamples.some(s => s.tall && s.scrollbar > 0);
  // five states x five viewports, each with learn mode off and on
  const learnSamples = railSamples.filter(s => s.learn).length;
  // (v8 D2 review) and the phone's 270px rail, open, in every state, learn
  // off and on
  const phoneBad = phoneRail.filter(s => s.scroll > s.client).map(s => ({ ...brief(s), scrollWidth: s.scroll, clientWidth: s.client }));
  const phoneLive = phoneRail.length === 2 * 5 && phoneRail.every(s => s.railShown && s.width <= 271);
  const ok = bad.length === 0 && scrollbarSeen && railSamples.length === 2 * 5 * VIEWPORTS.length
    && learnSamples === 5 * VIEWPORTS.length && phoneBad.length === 0 && phoneLive;
  check("RAIL-NO-HSCROLL", ok, {
    samples: railSamples.length, learnSamples, scrollbarSeen,
    railWidth: railSamples[0]?.width, clientWidth: [...new Set(railSamples.map(s => s.client))],
    phone: { samples: phoneRail.length, live: phoneLive, railWidth: phoneRail[0]?.width }, bad: bad.slice(0, 8), phoneBad: phoneBad.slice(0, 4),
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
  // and the learn text was really on screen in every learn-mode sample, so
  // this clause covers it (explanations, hints and "i" buttons rendered)
  const fewestLearn = Math.min(...railSamples.filter(s => s.learn).map(s => s.lrnVisible));
  // liveness floors below today's minima (214 elements and 121 text lines,
  // both in the model-metal boot rail with learn off, down from 218 and 148
  // before v8 U1a cut the descriptors; 64 learn elements): an empty walk would
  // pass everything
  // (v8 D2 review) the phone's rail: its text inside too, and in every
  // sample, desktop and phone, no word on a control split over two lines.
  // Liveness: the controls' words were read in every sample (the boot rail
  // has over 100 on its pills, labels and headers)
  const phoneTextBad = phoneRail.filter(s => s.nTextBad).map(s => ({ ...brief(s), n: s.nTextBad, first: s.textBad.slice(0, 3) }));
  const split = [...railSamples, ...phoneRail].filter(s => s.nSplit)
    .map(s => ({ ...brief(s), learn: s.learn, n: s.nSplit, first: s.splitWords.slice(0, 4) }));
  const fewestWords = Math.min(...[...railSamples, ...phoneRail].map(s => s.words));
  check("RAIL-TEXT-WRAPS", bad.length === 0 && fewest >= 150 && fewestLines >= 100 && fewestLearn >= 30
    && phoneTextBad.length === 0 && split.length === 0 && fewestWords >= 60 && phoneRail.length === 10, {
    fewestElementsInOneSample: fewest, fewestTextLinesInOneSample: fewestLines,
    fewestLearnElementsInALearnSample: fewestLearn, fewestControlWordsInOneSample: fewestWords,
    bad: bad.slice(0, 6), phoneBad: phoneTextBad.slice(0, 4), splitWords: split.slice(0, 6),
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
  // (v8 U1b review) a bottom-anchored item that starts above the window
  const offTop = chromeSamples.filter(s => s.offTop.length).map(s => ({ ...where(s), offTop: s.offTop }));
  const audits = chromeSamples.flatMap(s => s.panels.map(p => ({ ...where(s), ...p })));
  const panelBad = audits.filter(p => p.nBad).map(p => ({ ...where(p), panel: p.name, width: p.width, bad: p.bad }));
  const thinSliders = audits.filter(p => p.sliders.some(w => w < 60)).map(p => ({ ...where(p), panel: p.name, sliders: p.sliders }));
  // Liveness: every element that is positioned against the rail, or sized
  // against its inset or the transport bar, must have been on screen in at
  // least one sample; each mode panel must actually have opened, with the
  // rail shown and hidden; the audits must have found the panels and their
  // sliders; and every chrome sample must have measured the lens bar, the
  // learn toggle, CONTROLS, the switch and #head's lines, with the view cube
  // and the scale bar each in at least one.
  const EXPECT = ["views", "railToggle", "learnToggle", "dimSwitch", "viewcube", "hud", "apanels", "apanels3", "scalebar",
    "sembar", "hint", "transport", "slicePop", "foundry", "heattreat", "lab", "readouts"];
  const missing = EXPECT.filter(n => !seenChrome.has(n));
  const notOpened = panelOpened.filter(p => !p.appeared);
  const hiddenOpened = panelOpened.filter(p => p.rail === "hidden").length;
  const hiddenSamples = chromeSamples.filter(s => s.rail === "hidden").length;
  // (v8 D2) the head plate in every sample, and the SEM data bar, which moved
  // up under the plate, in at least one
  const ALWAYS = ["views", "railToggle", "learnToggle", "dimSwitch", "readouts", "head", "head h1", "head .sub", "#matline"];
  const topMissing = [...new Set(chromeSamples.flatMap(s => ALWAYS.filter(n => !s.top.includes(n))))];
  // (v8 D2 review) the THERM legend too: it shares the slot, and no sample
  // had switched to its lens
  const topSomewhere = ["viewcube", "scalebar", "sembar", "thermbar"].filter(n => !chromeSamples.some(s => s.top.includes(n)));
  // (v8 D2 review) the gesture hint never under an open analysis column;
  // and the phone with the rail open: what shows clears the rail and every
  // other top item, learn and controls among them, and lab mode opened there
  // hides the rail and clears the controls that must stay reachable
  const hintUnder = chromeSamples.filter(s => s.hintUnder.length).map(s => ({ ...where(s), under: s.hintUnder }));
  // each phone state's liveness: the first screen measured the whole top
  // chrome with the rail hidden (the cube in the volume); the open rail
  // measured learn and controls with the rail shown; lab mode's panel was
  // on screen with the rail gone
  const FIRST = ["head", "head h1", "head .sub", "#matline", "readouts", "views", "learnToggle", "railToggle", "dimSwitch"];
  const phoneLive = s => s.what === "rail hidden"
    ? s.rail === "hidden" && FIRST.every(n => s.top.includes(n)) && (s.mode !== "3d" || s.top.includes("viewcube"))
    : s.what === "rail open" ? s.rail === "shown" && s.top.includes("learnToggle") && s.top.includes("railToggle")
      : s.rail === "hidden" && s.panel;
  const phoneBad = phoneSamples.filter(s => s.hits.length || s.clash.length || !phoneLive(s))
    .map(s => ({ mode: s.mode, what: s.what, rail: s.rail, panel: s.panel, hits: s.hits.slice(0, 3), clash: s.clash.slice(0, 3), top: s.top }));
  const slidersMeasured = audits.reduce((n, p) => n + p.sliders.length, 0);
  // Liveness for the learn-on half (v8 U1b review): every mode panel opened
  // (13, the treated heat treat included) was sampled with learn off and on
  // at every viewport, the learn-on samples really had explanations open,
  // and the states tall enough to need the cap were reached: each of the
  // bottom-anchored items was capped (it scrolled) in some learn-on sample,
  // and the treated heat treat's card was really on screen. Without these a
  // learn toggle that never turned on, or a short panel, would pass the
  // clash clause for free.
  const learnSamples = chromeSamples.filter(s => s.learn);
  const learnUnopened = learnSamples.filter(s => !(s.opened > 0)).map(where);
  const cappedSomewhere = name => learnSamples.some(s => s.scrolls?.[name]);
  const uncapped = ["apanels", "apanels3", "slicePop"].filter(n => !cappedSomewhere(n));
  const panelCapped = learnSamples.some(s => Object.entries(s.scrolls ?? {}).some(([n, v]) => n.startsWith("panel ") && v));
  const treated = panelOpened.find(p => p.what === "heat treat after a 4 h anneal");
  const treatedOk = !!treated?.ret && treated.ret.armed === true && treated.ret.fs > 0.9 && treated.ret.card > 100;
  const ok = bad.length === 0 && overTransport.length === 0 && clash.length === 0 && offTop.length === 0 && panelBad.length === 0
    && thinSliders.length === 0 && missing.length === 0 && notOpened.length === 0
    && panelOpened.length === 13 && hiddenOpened === 6 && hiddenSamples === 14 * VIEWPORTS.length
    && audits.length === 26 * VIEWPORTS.length && slidersMeasured >= 100
    && audits.filter(p => p.learn).length === 13 * VIEWPORTS.length && learnUnopened.length === 0
    && uncapped.length === 0 && panelCapped && treatedOk
    && topMissing.length === 0 && topSomewhere.length === 0 && chromeSamples.every(s => s.transportSeen)
    && hintUnder.length === 0 && phoneSamples.length === 6 && phoneBad.length === 0;
  check("RAIL-CLEAR", ok, {
    samples: chromeSamples.length, learnSamples: learnSamples.length, hiddenSamples, panelAudits: audits.length, slidersMeasured,
    phone: phoneSamples.map(s => `${s.mode} ${s.what}: rail ${s.rail}, top ${s.top.join(" ")}`), phoneBad, hintUnder: hintUnder.slice(0, 4),
    panels: panelOpened.map(p => `${p.mode} ${p.what}: ${p.names.join(", ")}`),
    treated: treated?.ret ?? null, cappedInLearn: { uncapped, panelCapped }, learnUnopened: learnUnopened.slice(0, 4),
    missing, notOpened, topMissing, topSomewhere, underRail: bad.slice(0, 8), overTransport: overTransport.slice(0, 8),
    clash: clash.slice(0, 6), offTop: offTop.slice(0, 6), panelOverflow: panelBad.slice(0, 6), thinSliders: thinSliders.slice(0, 6),
  });
}

{
  // Liveness: each rail-anchored element was measured with the rail hidden
  // in at least one sample (the HUD folds away on the phone, the analysis
  // columns are one per mode, the cube is 3D only)
  const anchoredSeen = new Set(hideSamples.flatMap(h => Object.keys(h.hidden.anchored)));
  const unmeasured = ["dimSwitch", "viewcube", "hud", "apanels", "apanels3"].filter(n => !anchoredSeen.has(n));
  // and both learn-toggle placements were expected somewhere, so neither
  // branch of that clause is vacuous (under: the phone with the rail open)
  const bothPlacements = learnPlacement.some(p => p.under) && learnPlacement.some(p => !p.under);
  check("RAIL-HIDE", hideSamples.length === 2 * HIDE_VIEWPORTS.length && hideSamples.every(h => h.ok) && unmeasured.length === 0
    && bothPlacements, {
    unmeasured, bothPlacements,
    learnUnder: learnPlacement.filter(p => p.under).map(p => `${p.vp} ${p.state} gap ${p.gap}`),
    samples: hideSamples.map(h => ({ mode: h.mode, vp: h.vp, ok: h.ok, why: h.why, toggle: [h.shown.toggle, h.hidden.toggle], hiddenAnchored: h.hidden.anchored })),
  });
}

{
  const bad = slices.filter(s => !s.visible || s.bad.length || s.rows < 3);
  // learn on (v8 U1b review): the CT sweep hint shown, on one line, and shown
  // exactly when its control is; learn off: no learn text at all
  const learnBad = slices.filter(s => s.learn ? (s.hints < 1 || s.hintBad.length || !(s.lrnVisible >= 3)) : (s.hints || s.lrnVisible))
    .map(s => ({ vp: s.vp, learn: s.learn, hints: s.hints, hintBad: s.hintBad, lrnVisible: s.lrnVisible }));
  const nLearn = slices.filter(s => s.learn).length;
  check("SLICE-ROWS-INSIDE", slices.length === 2 * VIEWPORTS.length && nLearn === VIEWPORTS.length && bad.length === 0
    && learnBad.length === 0, { rows: slices[0]?.rows, learnSamples: nLearn, bad: bad.slice(0, 4), learnBad: learnBad.slice(0, 4) });
}

// sentence count of a learn text: a sentence ends at . ! or ? before a space
// or the end ("0.2·T_m" and "6.48e-8" are not endings)
const sentences = t => (String(t).match(/[.!?](?=\s|$)/g) ?? []).length;
// the same rule as PROBE's in-page copy; RAIL-NO-EMDASH runs both on one fixture
const proseDash = s => typeof s === "string" && s.includes("—") && s !== "—";

{
  const r = learnRun;
  const why = [];
  // a new viewer: off, nothing stored, nothing rendered
  if (r.boot.aria !== "false" || r.boot.stored != null || r.boot.visibleLearn !== 0)
    why.push({ newViewer: { aria: r.boot.aria, stored: r.boot.stored, visibleLearn: r.boot.visibleLearn } });
  // the rail's entries and the rail agree: a section per entry, an entry per
  // section, and every declared hint found its control
  const a = r.audit;
  if (a.sections < 13 || a.sectionsWithoutEntry.length || a.entriesWithoutSection.length
    || a.hintsUnbound.length || a.hintsDeclared < 30) why.push({ audit: a });
  // on: every visible section has an "i" that is a focusable button, collapsed,
  // wired by aria-controls to a hidden explanation right under its header
  const headBad = h => !h.infoVisible || h.tag !== "BUTTON" || h.tabIndex < 0 || !h.bodyExists || !h.bodyUnderHeader
    || !h.headOk;
  if (r.on.aria !== "true" || r.on.stored !== "1") why.push({ on: { aria: r.on.aria, stored: r.on.stored } });
  const onBad = r.on.heads.filter(h => headBad(h) || h.expanded !== "false" || h.bodyVisible);
  if (r.on.heads.length < 12 || onBad.length) why.push({ onHeads: r.on.heads.length, bad: onBad.slice(0, 3) });
  // the keyboard reaches the "i", opens its explanation, and leaves the
  // section (and the run) as they were
  for (const k of r.keys) {
    const b = k.before, af = k.after;
    if (!k.startFocused || !b.focused || b.disabled || b.expanded !== "false" || b.bodyVisible
      || af.expanded !== "true" || !af.bodyVisible || af.open !== b.open || k.runToggled) why.push({ key: k });
  }
  // the section header from the keyboard: reached, Enter closes, Space
  // reopens, aria-expanded following, the run untouched
  {
    const { startFocused, s0, s1, s2, runToggled } = r.headKeys;
    if (!startFocused || !s0.headFocused || s0.open !== "block" || s0.headExpanded !== "true"
      || s1.open !== "none" || s1.headExpanded !== "false" || s2.open !== "block" || s2.headExpanded !== "true"
      || runToggled) why.push({ headKeys: r.headKeys });
  }
  // Space is run/pause with nothing focused and after a mouse click on a
  // button, and never presses that button again
  if (r.space.length !== 4 || r.space.some(s => !s.flipped || !s.restored || s.pressed)) why.push({ space: r.space });
  // every explanation, open: shown, 1 to 2 sentences
  const exBad = r.expanded.heads.filter(h => headBad(h) || h.expanded !== "true" || !h.bodyVisible
    || sentences(h.text) < 1 || sentences(h.text) > 2);
  if (exBad.length) why.push({ explanations: exBad.map(h => ({ title: h.title, expanded: h.expanded, visible: h.bodyVisible, sentences: sentences(h.text) })) });
  // off: nothing renders, in this state and in every learn-off layout sample
  if (r.off.aria !== "false" || r.off.stored !== "0" || r.off.visibleLearn !== 0)
    why.push({ off: { aria: r.off.aria, stored: r.off.stored, visibleLearn: r.off.visibleLearn } });
  const offLeak = railSamples.filter(s => !s.learn && s.lrnVisible > 0).map(s => ({ ...brief(s), lrnVisible: s.lrnVisible }));
  if (offLeak.length) why.push({ learnOffLeak: offLeak.slice(0, 4) });
  // hints: one line, shown exactly when their control is, in every sample;
  // at least 15 on screen in every learn sample (29 is today's fewest)
  const hintBad = railSamples.filter(s => s.nHintBad).map(s => ({ ...brief(s), learn: s.learn, bad: s.hintBad.slice(0, 3) }));
  const fewestHints = Math.min(...railSamples.filter(s => s.learn).map(s => s.hints));
  if (hintBad.length || !(fewestHints >= 15)) why.push({ fewestHints, hintBad: hintBad.slice(0, 4) });
  // remembered across a reload
  if (r.reloaded.aria !== "true" || r.reloaded.stored !== "1" || r.reloaded.heads.some(h => !h.infoVisible))
    why.push({ reloaded: { aria: r.reloaded.aria, stored: r.reloaded.stored } });
  // storage that throws: the perturbation landed, the page booted clean, and
  // the toggle and the headers work
  const b = r.blocked;
  if (!b.booted || b.throws !== true || b.aria !== "true" || !(b.infosShown >= 12) || !b.headerToggles || b.ownErrors.length)
    why.push({ storageBlocked: b });
  // the panels (v8 U1b review): every hint the panel entries declare was
  // bound, matched by the label its control prints (a label that drifted
  // from its entry's key would drop its hint silently); in every learn-on
  // panel sample learn text rendered, and in every learn-off one none did;
  // every panel hint shown is one line and shows exactly with its control
  const pa = r.panelAudit;
  if (!pa || pa.hintsDeclared < 16 || pa.hintsUnbound.length) why.push({ panelAudit: pa });
  const pAudits = chromeSamples.flatMap(s => s.panels.map(p => ({ what: s.what, vp: s.vp, rail: s.rail, ...p })));
  const pHintBad = pAudits.filter(p => p.hintBad.length).map(p => ({ what: p.what, vp: p.vp, panel: p.name, bad: p.hintBad.slice(0, 3) }));
  const pDark = pAudits.filter(p => p.learn && !(p.lrnVisible > 0)).map(p => `${p.what} ${p.vp}`);
  const pLeak = pAudits.filter(p => !p.learn && p.lrnVisible > 0).map(p => `${p.what} ${p.vp}`);
  const pHints = pAudits.filter(p => p.learn).reduce((n, p) => n + p.hints, 0);
  if (pHintBad.length || pDark.length || pLeak.length || !(pHints >= 100))
    why.push({ panelHints: pHints, hintBad: pHintBad.slice(0, 4), learnDark: pDark.slice(0, 4), learnLeak: pLeak.slice(0, 4) });
  // every learn string any material or state can show is 1 to 2 sentences,
  // and every hint is short enough for one line
  const shape = sources.filter(([k, , t]) => (k === "learn" && (sentences(t) < 1 || sentences(t) > 2))
    || (k === "hint" && (t.length > 48 || /\.$/.test(t))));
  if (shape.length) why.push({ shape: shape.slice(0, 6) });
  // (v8 D2 review) the focus ring over the ETCH lens: each control focused
  // from the keyboard (:focus-visible), the pressed state really pressed,
  // and the ring changed at least 120 pixels (the inset ring's perimeter is
  // over 300); learn left off afterwards
  const rings = r.rings?.rings ?? [];
  const ringBad = rings.filter(g => !g.focused || !g.visible || g.changed < 120
    || (g.what === "learn toggle pressed" ? g.pressed !== "true" : false));
  if (rings.length !== 3 || ringBad.length || r.rings?.learnAfter !== "false") why.push({ focusRings: r.rings });
  check("RAIL-LEARN", why.length === 0, {
    focusRings: rings.map(g => `${g.what}: ${g.visible ? "focus-visible" : "NOT focus-visible"}, ${g.changed} px changed`),
    sections: a.sections, hintsDeclared: a.hintsDeclared, fewestHints,
    panelHintsDeclared: pa?.hintsDeclared, panelHintsUnbound: pa?.hintsUnbound, panelHintsShown: pHints,
    keys: r.keys.map(k => `Shift+Tab ${k.before.focused ? "reached" : "MISSED"} the "i"; ${k.key}: ${k.before.expanded} -> ${k.after.expanded}, section ${k.after.open === k.before.open ? "unchanged" : "TOGGLED"}${k.runToggled ? ", RUN TOGGLED" : ""}`),
    header: `Shift+Tab x2 ${r.headKeys.s0.headFocused ? "reached" : "MISSED"} the header; Enter: ${r.headKeys.s0.open} -> ${r.headKeys.s1.open}, Space: -> ${r.headKeys.s2.open}`,
    space: r.space.map(s => `${s.where}: run ${s.flipped ? "flipped" : "NOT FLIPPED"}${s.restored ? "" : ", NOT RESTORED"}${s.pressed ? ", BUTTON PRESSED AGAIN" : ""}`),
    storageBlocked: { booted: b.booted, throws: b.throws, aria: b.aria, infosShown: b.infosShown, headerToggles: b.headerToggles, thirdPartyErrors: b.thirdPartyErrors },
    learnStrings: sources.filter(s => s[0] !== "line").length, why: why.slice(0, 6),
  });
}

{
  // the detectors first, BOTH copies (this Node one reads the module strings,
  // PROBE's in-page one every rendered sample): a prose dash is caught, a
  // lone " — " between two elements included, and the exact empty-value
  // glyph and an en dash are not (a detector that caught nothing would pass
  // every page)
  const fixtureNode = ["a — b", "—x", "x—", " — "].every(proseDash) && !["—", "5–10 K", "Al–Cu"].some(proseDash);
  const fixture = fixtureNode && fixtureDom;
  const dom = railSamples.filter(s => s.nDashes).map(s => ({ ...brief(s), learn: s.learn, first: s.dashes.slice(0, 3) }))
    .concat(pourRun.samples.filter(s => s.nDashes).map(s => ({ state: "poured mix, calibrated", learn: s.learn, first: s.dashes.slice(0, 3) })));
  const src = sources.filter(([, , t]) => proseDash(t)).map(([k, w, t]) => ({ kind: k, where: w, text: t.slice(0, 70) }));
  // liveness: the rendered text read, learn text included, and the strings
  // read; the poured state really reached the rail (the pour took, and its
  // source line is in the rail's text), and every famous preset's line was read
  const chars = railSamples.reduce((n, s) => n + s.chars, 0);
  const learnChars = railSamples.filter(s => s.learn).reduce((n, s) => n + s.chars, 0)
    - railSamples.filter(s => !s.learn).reduce((n, s) => n + s.chars, 0);
  const pourLive = pourRun.poured === true && pourRun.inRail && pourRun.samples.length === 2;
  const pourLines = sources.filter(([, w]) => w.startsWith("pour ")).length;
  const ok = fixture && dom.length === 0 && src.length === 0 && learnChars > 0 && sources.length >= 150
    && pourLive && pourLines >= 9;
  check("RAIL-NO-EMDASH", ok, {
    fixtureCaught: { node: fixtureNode, dom: fixtureDom }, charsRead: chars, extraLearnChars: learnChars,
    stringsRead: sources.length, pourLines, poured: { live: pourLive, name: pourRun.name, line: pourRun.src },
    rendered: dom.slice(0, 6), strings: src.slice(0, 8),
  });
}

{
  // (v8 D2) the chrome is achromatic: every color it paints is a gray and
  // nothing glows, in every rail state (learn off and on, 2D and TRUE 3D),
  // every chrome sample (the ETCH, SEM and SLICE legends up, the analysis
  // panels open, the rail hidden, each mode panel open) and with the tour
  // open; and the view cube's own pixels, a face hovered, carry no hue.
  // Liveness: the detector caught its fixture by both properties, every
  // sample read enough elements, the tour sample really had the card on
  // screen, and the cube painted and drew its hover highlight
  const bad = achromaSamples.filter(s => s.nBad).map(s => ({ mode: s.mode, state: s.state, n: s.nBad, first: s.bad.slice(0, 3) }));
  const fewest = Math.min(...achromaSamples.map(s => s.n));
  const tourSample = achromaSamples.find(s => s.state === "tour open");
  // the amber line is caught on its color (and on every currentColor edge
  // it tints, which is right: those paint amber too), the glow on its shadow
  const fixtureOk = achromaFixture.nBad >= 2 && achromaFixture.props.includes("color") && achromaFixture.props.includes("textShadow");
  const cubeOk = !!cubeRead && cubeRead.painted > 2000 && cubeRead.bright > 0 && cubeRead.hued === 0;
  // (v8 D2, second half) every surface built in script was really read, in
  // some sample, with enough elements that it cannot have been an empty
  // shell: the mode panels, the lab report, the popup, both columns, the
  // composer (and its diagram's SVG chrome), an enlarged plot and the probe
  // mark on the melt. The SVG fixture: the frame stroked amber is caught on
  // its stroke and nothing else is, while the liquidus beside it is amber
  // (a data mark, skipped)
  const most = item => Math.max(0, ...achromaSamples.map(s => s.per?.[item] ?? 0));
  // (v8 D2 review) thermbar: the legend, its two labels and T_m's <sub>
  const FLOORS = { "#app > .modepanel": 40, foundryResults: 60, slicePop: 20, apanels: 12, apanels3: 12, composer: 200,
    ".tmodal": 4, overlay: 4, thermbar: 3 };
  const thin = Object.entries(FLOORS).filter(([item, f]) => most(item) < f).map(([item, f]) => ({ item, read: most(item), floor: f }));
  const E = extraAchroma;
  const composerSample = achromaSamples.find(s => s.state === "composer");
  const amber = v => { const m = /rgba?\(([^)]*)\)/.exec(v ?? ""); if (!m) return false; const [r, g, b] = m[1].split(/[\s,]+/).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) > 2; };
  const extraOk = E.labReport?.shown && E.labReport.rows >= 10 && E.labReport.warn >= 1
    && E.composer?.open && E.composer.clamps >= 1 && E.composer.notGrown >= 1 && E.composer.fume >= 1 && E.composer.svgChrome >= 5
    && (composerSample?.nSvg ?? 0) >= 5 && E.enlarged === true
    && E.svgFixture.nBad >= 1 && E.svgFixture.props.every(p => p === "stroke") && E.svgFixture.what.every(w => /pdframe/.test(w))
    && amber(E.svgFixture.liquidusAmber);
  // (v8 D2 review) the THERM legend's fixture: read clean with its strip on
  // screen, an amber label caught on that label (its color among the
  // props), an amber edge on the legend's own plate caught on the plate,
  // never on its ::before; so the strip's exemption is the strip alone
  const T = E.thermFixture;
  const thermOk = !!T && T.shown && T.strip && T.clean.nBad === 0 && T.clean.n >= 3
    && T.label.nBad >= 1 && T.label.props.includes("color") && T.label.what.every(w => w === "thermbar span.lo")
    && T.plate.nBad >= 1 && T.plate.props.every(p => /^border/.test(p)) && T.plate.what.every(w => w === "thermbar div#thermbar.plate");
  // the rail's pixels: none hued in any sample, and the pixel read caught the
  // planted amber thumb and track and read clean on both sides of the plant
  // (the computed read's count with the plant in, `computedPlanted`, is
  // reported: it is why this read exists)
  const P = pixelFixture;
  const pixBad = railPixelSamples.filter(s => s.hued > 0).map(s => ({ mode: s.mode, state: s.state, hued: s.hued }));
  const pixelOk = pixBad.length === 0 && railPixelSamples.length === 10 && railPixelSamples.every(s => s.px > 50000)
    && P.before.hued === 0 && P.planted.hued > 200 && P.after.hued === 0;
  // the tour's highlight ring was on screen when the tour was read
  const hlSample = achromaSamples.find(s => s.state === "tour open · highlight");
  const hlOk = !!hlSample && tourHl.shown && tourHl.hl >= 1;
  const ok = fixtureOk && bad.length === 0 && achromaSamples.length >= 30 && fewest >= 150 && tourOpen && !!tourSample && cubeOk
    && thin.length === 0 && extraOk && thermOk && pixelOk && hlOk;
  // every surface that painted a color, over all samples: in how many
  // samples, and its first offender
  const byItem = {};
  for (const s of achromaSamples) for (const [item, b] of Object.entries(s.badPer ?? {})) {
    byItem[item] ??= { samples: 0, first: b.first, firstState: `${s.mode} ${s.state}` };
    byItem[item].samples++;
  }
  check("RAIL-ACHROMATIC", ok, {
    therm: { ok: thermOk, fixture: T }, pixels: { ok: pixelOk, samples: railPixelSamples.length, fixture: P, bad: pixBad.slice(0, 4) },
    tourHighlight: { ok: hlOk, ...tourHl },
    samples: achromaSamples.length, fewestElements: fewest, fixture: achromaFixture, tourOpen,
    tourElements: tourSample?.n ?? null, cube: cubeRead, read: Object.fromEntries(Object.keys(FLOORS).map(k => [k, most(k)])),
    thin, extra: E, composerSvg: composerSample?.nSvg ?? null, badSamples: bad.length, byItem, bad: bad.slice(0, 3),
  });
}

if (errors.length) {
  failures++;
  console.log("PAGE ERRORS", JSON.stringify(errors.slice(0, 6)));
}

await browser.close();
console.log(failures ? `done: ${failures} FAILED` : "done: all rail checks passed");
if (failures) process.exitCode = 1;
