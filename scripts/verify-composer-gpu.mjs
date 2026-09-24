// COMPOSER-GRID-PANEL — v7.1 P5's periodic grid, driven through the DOM the
// way a visitor drives it.
//
// ITS OWN FILE, on the verify-phasediagram-gpu.mjs precedent: this is the first
// gate in the suite that CLICKS the composer, and a panel gate that shares a
// page with kernels other gates have staged is a gate testing whatever they
// left behind. verify-composer-grid.mjs settles the classifier and the layout
// without a browser; what it cannot see is whether a click reaches them.
//
// BOTH POLARITIES EVERYWHERE, which is the whole design of this file:
//   - an ASSESSED cell adds a solute row AT THE CEILING-AWARE DEFAULT ... and a
//     refused cell adds nothing. A presence-only check passes on a grid that
//     adds everything.
//   - switching Al -> Fe changes at least one cell's tier ... AND leaves at
//     least one unchanged. A grid that refused the whole table on every base
//     would satisfy the first clause perfectly.
//   - the reason panel fills with the classifier's OWN line for the cell that
//     was clicked, not with any line: the text is compared against the string
//     `admit()` returns for that exact pair, loaded from the module rather than
//     retyped here.
//
// COMPOSER-LEARN (v8 U1c) reads the same modal in its two registers: learn
// mode off shows each caveat's one line and none of its learn text, learn mode
// on adds the text from the same producer, and neither shows a prose em dash.
// COMPOSER-DIALOG (the U1c review) drives it as a modal dialog with real key
// presses: focus in and back out, the page inert, Tab wrapping, Escape.
//
//   node scripts/verify-composer-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

// the expected reasons come from the module that ships them — a gate that
// retypes the sentence it is testing proves only that two humans agreed
const viteServer = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const E = await viteServer.ssrLoadModule("/src/elements.ts");
const C = await viteServer.ssrLoadModule("/src/composer.ts");
const EXPECT = {
  alHg: E.admit("al", "Hg", E.probeWt("al", "Hg")).line,
  feHg: E.admit("fe", "Hg", E.probeWt("fe", "Hg")).line,
  alZn: E.admit("al", "Zn", E.probeWt("al", "Zn")).line,
  znDefault: C.defaultWt("al", "Zn"),
  // ONE REFUSED CELL PER NON-ASSESSED TIER, not one cell of one tier. The first
  // draft clicked only mercury, which is REFUSED-PAIR, so NOT-A-SOLUTE and
  // OUTSIDE-THE-MODEL were never tapped at all — and `pick()` branches on the
  // single predicate `tier === "ASSESSED"`, which one negative sample cannot
  // separate from `tier !== "REFUSED-PAIR"`. Under that weaker predicate a click
  // on argon reaches `defaultWt`, whose fall-through is
  // `BASES[base].solutes[el].cap` on a solute that does not exist, and the panel
  // throws. The tiers are derived from the module so the clause cannot go
  // vacuous if a pair is ever reclassified.
  refused: [["al", "Hg"], ["al", "Ar"], ["al", "Pb"]].map(([b, e]) => {
    const a = E.admit(b, e, E.probeWt(b, e));
    return { el: e, tier: a.tier, line: a.line };
  }),
  // the three pairs a flat 1 wt% would have painted as refusals
  ceilingPairs: [["al", "Ti"], ["fe", "C"], ["mg", "Zr"]].map(([b, e]) => ({
    base: b, el: e, tierAtProbe: E.admit(b, e, E.probeWt(b, e)).tier,
    tierAtOne: E.admit(b, e, 1).tier, def: C.defaultWt(b, e),
  })),
};

const PORT = process.argv[3] ?? "5199";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1200, height: 800 },
});
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const check = (name, ok, detail) =>
  console.log(name, ok ? "OK" : FAIL(), detail === undefined ? "" : JSON.stringify(detail));

const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
await new Promise(r => setTimeout(r, 700));

// ---------------------------------------------------------------------------
{
  const out = await page.evaluate(async expect => {
    const S = window.__solidify;
    S.app.setRun(false);
    S.app.setMaterial("al");
    // a KNOWN mix rather than whatever the last gate left: the composer's
    // constructor default is AA2024, and a gate that assumes it would be
    // asserting the constructor rather than the grid
    S.composer.applyHash("#alloy=al:Si7,Mg0.35");
    S.app.openComposer();
    await new Promise(r => requestAnimationFrame(r));

    const grid = document.querySelector("#composer .grid");
    const why = document.querySelector("#composer .gwhy");
    const cellOf = sym => document.querySelector(`#composer .gcell[data-el="${sym}"]`);
    const rowSyms = () => [...document.querySelectorAll("#composer .crow b")].map(b => b.textContent);
    const tiers = () => {
      const t = {};
      for (const c of document.querySelectorAll("#composer .gcell")) t[c.dataset.el] = c.dataset.tier;
      return t;
    };
    const vaps = () => [...document.querySelectorAll("#composer .gcell[data-vap]")].map(c => c.dataset.el);
    const sliderOf = sym => {
      const rows = [...document.querySelectorAll("#composer .crow")];
      const r = rows.find(x => x.querySelector("b")?.textContent === sym);
      return r ? { value: +r.querySelector("input").value, max: +r.querySelector("input").max } : null;
    };

    // PAINTED cells, not nodes. The first draft counted `.gcell`, which
    // buildGrid creates and paintGrid never touches, so a paintGrid that
    // silently skipped 70 of the 118 was indistinguishable from one that
    // painted them: an unpainted cell stores `undefined` on both bases, and
    // `undefined !== undefined` is false, so it counted as UNCHANGED and
    // actively helped the both-polarities clause. `data-tier` is written in
    // exactly one place, inside the paint loop.
    const cells = document.querySelectorAll("#composer .gcell[data-tier]").length;
    const tiersAl = tiers();
    const vapsAl = vaps();
    const rowsBefore = rowSyms();

    // --- REFUSED CELLS, one per non-ASSESSED tier: each must ANSWER with its
    //     own line and none may pour.
    const refused = [];
    for (const r of expect.refused) {
      cellOf(r.el).click();
      refused.push({
        el: r.el, rows: rowSyms(), tier: why.dataset.tier,
        why: why.textContent.replace(/\s+/g, " ").trim(),
        addedARow: document.querySelector(`#composer .gcell[data-el="${r.el}"]`).dataset.in ?? null,
      });
    }
    // mercury last so the panel is still answering about it below
    cellOf("Hg").click();
    const afterRefused = {
      rows: rowSyms(), why: why.textContent.replace(/\s+/g, " ").trim(),
      el: why.dataset.el, tier: why.dataset.tier,
      selected: cellOf("Hg").classList.contains("sel"),
    };

    // --- AN ASSESSED CELL: it must join the melt at the ceiling-aware default.
    cellOf("Zn").click();
    const afterAssessed = {
      rows: rowSyms(), slider: sliderOf("Zn"),
      inMix: cellOf("Zn").dataset.in, why: why.textContent.replace(/\s+/g, " ").trim(),
      el: why.dataset.el, tier: why.dataset.tier,
    };

    // --- clicking it AGAIN must not double it or reset it
    cellOf("Zn").click();
    const afterSecond = { rows: rowSyms(), slider: sliderOf("Zn") };

    // --- THE BASE SWITCH, which is the demo: Al -> Fe.
    const inCellsAl = [...document.querySelectorAll("#composer .gcell[data-in]")].map(c => c.dataset.el);
    document.querySelector('#composer .bases button[data-base="fe"]').click();
    await new Promise(r => requestAnimationFrame(r));
    const tiersFe = tiers();
    const vapsFe = vaps();
    const cellsFe = document.querySelectorAll("#composer .gcell[data-tier]").length;
    // THE CLEARING HALF OF THE REPAINT, which no set-difference can show. The
    // base buttons replace the mix wholesale, so after Al -> Fe no cell may
    // still claim to be in the melt; and mercury must LOSE its fume stripe,
    // because over iron the advisory refuses at mercury's critical point. A
    // gate that only ever asks what APPEARED cannot see an attribute that was
    // never deleted, and `[data-in]` outranks every tier rule in the stylesheet.
    const inCellsFe = [...document.querySelectorAll("#composer .gcell[data-in]")].map(c => c.dataset.el);
    const changed = Object.keys(tiersAl).filter(k => tiersAl[k] !== tiersFe[k]);
    const unchanged = Object.keys(tiersAl).filter(k => tiersAl[k] === tiersFe[k]);
    // the reason panel is still answering about mercury, now for a different melt
    document.querySelector("#composer .gcell[data-el='Hg']").click();
    const whyFe = why.textContent.replace(/\s+/g, " ").trim();
    // the base's own cell moved with the base
    const selfCells = [...document.querySelectorAll("#composer .gcell[data-self]")].map(c => c.dataset.el);

    // --- THE THREE CEILING PAIRS, added by click, must land under their
    //     ceiling rather than on it.
    const ceiling = [];
    for (const p of expect.ceilingPairs) {
      document.querySelector(`#composer .bases button[data-base="${p.base}"]`).click();
      await new Promise(r => requestAnimationFrame(r));
      const cell = cellOf(p.el);
      const tierPainted = cell.dataset.tier;
      cell.click();
      ceiling.push({ pair: `${p.base}-${p.el}`, tierPainted, slider: sliderOf(p.el), expectedDefault: p.def });
    }

    S.composer.close();
    S.app.setMaterial("generic");
    return {
      cells, cellsFe, gridPresent: !!grid, whyPresent: !!why,
      rowsBefore, refused, afterRefused, afterAssessed, afterSecond,
      inCellsAl, inCellsFe,
      tierCountsAl: Object.values(tiersAl).reduce((a, t) => (a[t] = (a[t] ?? 0) + 1, a), {}),
      tierCountsFe: Object.values(tiersFe).reduce((a, t) => (a[t] = (a[t] ?? 0) + 1, a), {}),
      changed, unchangedCount: unchanged.length,
      vapsAl, vapsFe, whyFe, selfCells, ceiling,
    };
  }, EXPECT);

  // THE REASON PANEL CARRIES THE CLASSIFIER'S OWN LINE, for that exact pair —
  // not merely "some text appeared", and not the same text on both bases.
  const answeredAl = out.afterRefused.why.includes(EXPECT.alHg);
  const answeredFe = out.whyFe.includes(EXPECT.feHg);
  const answersDiffer = EXPECT.alHg !== EXPECT.feHg && out.afterRefused.why !== out.whyFe;
  // a refused click pours NOTHING — for one cell of EVERY non-assessed tier
  const refusedAddedNothing = JSON.stringify(out.afterRefused.rows) === JSON.stringify(out.rowsBefore)
    && out.refused.length === 3
    && out.refused.every((r, i) =>
      JSON.stringify(r.rows) === JSON.stringify(out.rowsBefore)
      && r.addedARow === null
      && r.tier === EXPECT.refused[i].tier
      && r.why.includes(EXPECT.refused[i].line))
    && new Set(out.refused.map(r => r.tier)).size === 3
    && !out.refused.some(r => r.tier === "ASSESSED");
  // an assessed click pours EXACTLY one row, at the ceiling-aware default
  const assessedAdded = out.afterAssessed.rows.length === out.rowsBefore.length + 1
    && out.afterAssessed.rows.includes("Zn")
    && out.afterAssessed.slider?.value === EXPECT.znDefault
    && out.afterAssessed.inMix === "1"
    && out.afterAssessed.why.includes(EXPECT.alZn);
  const idempotent = JSON.stringify(out.afterSecond.rows) === JSON.stringify(out.afterAssessed.rows)
    && out.afterSecond.slider?.value === out.afterAssessed.slider?.value;
  // BOTH polarities of the base switch
  const switchBothWays = out.changed.length >= 1 && out.unchangedCount >= 1;
  // the vapour channel is a SECOND channel and it moves too: Al -> Fe puts a
  // fume stripe on sodium, potassium, calcium and cadmium, none of which
  // changed tier — so a grid wired to tier alone cannot pass this
  const vapGained = out.vapsFe.filter(e => !out.vapsAl.includes(e));
  const vapMovedIndependently = ["Na", "K", "Ca", "Cd"].every(e =>
    vapGained.includes(e) && !out.changed.includes(e));
  // the three ceiling pairs paint as ASSESSED and arrive UNDER their ceiling
  const ceilingOk = out.ceiling.length === 3 && out.ceiling.every((c, i) =>
    c.tierPainted === "ASSESSED" && c.slider != null
    && c.slider.value === EXPECT.ceilingPairs[i].def
    && c.slider.value === c.slider.max
    && EXPECT.ceilingPairs[i].tierAtOne === "OUTSIDE-THE-MODEL");

  // the repaint CLEARS as well as sets
  const clearedOnSwitch = out.inCellsAl.length >= 1 && out.inCellsFe.length === 0;
  const vapLost = out.vapsAl.filter(e => !out.vapsFe.includes(e));
  const vapClearedToo = vapLost.includes("Hg");

  const ok = out.gridPresent && out.whyPresent && out.cells === 118 && out.cellsFe === 118
    && answeredAl && answeredFe && answersDiffer
    && refusedAddedNothing && assessedAdded && idempotent
    && switchBothWays && vapMovedIndependently
    && clearedOnSwitch && vapClearedToo
    && out.selfCells.length === 1 && ceilingOk
    && out.tierCountsAl.ASSESSED === 6 && out.tierCountsFe.ASSESSED === 6;
  check("COMPOSER-GRID-PANEL", ok, {
    cellsPaintedAl: out.cells, cellsPaintedFe: out.cellsFe,
    refusedTiersExercised: out.refused.map(r => `${r.el}:${r.tier}`),
    inMeltClearedOnSwitch: { al: out.inCellsAl, fe: out.inCellsFe },
    vapourStripesLost: vapLost,
    refusedClickAddedNothing: refusedAddedNothing,
    assessedClickAddedARow: assessedAdded,
    clickingItAgainChangedNothing: idempotent,
    znSlider: out.afterAssessed.slider, znExpectedDefault: EXPECT.znDefault,
    reasonIsTheClassifiersOwnLine: { al: answeredAl, fe: answeredFe, andTheyDiffer: answersDiffer },
    baseSwitch: { changed: out.changed, unchanged: out.unchangedCount,
      tiersAl: out.tierCountsAl, tiersFe: out.tierCountsFe },
    vapourStripeGainedOnAlToFe: vapGained,
    vapourMovedWhereTierDidNot: vapMovedIndependently,
    baseOwnCell: out.selfCells,
    ceilingPairs: out.ceiling,
    reasonAl: out.afterRefused.why.slice(0, 150),
    reasonFe: out.whyFe.slice(0, 150),
  });
}

// ---------------------------------------------------------------------------
// COMPOSER-LEARN (v8 U1c) — the composer's two registers, as rendered.
//
// With learn mode off the modal is the instrument: every caveat is its one
// line, and none of the learn text is on screen (the slots are EMPTY, not
// hidden, so the panel's text is exactly the instrument's). With learn mode on
// each line gains its explanation from the same producer, the three "i"
// buttons appear and open their panels' text, and the readout rows show their
// hints. Both states are read as VISIBLE text (innerText), and in both no
// prose em dash is on screen or in a tooltip (the lone "—" empty-value glyph
// is allowed). The expected strings come from the modules, not retyped.
{
  const A = await viteServer.ssrLoadModule("/src/alloy.ts");
  const LC = await viteServer.ssrLoadModule("/src/learn/composer.ts");
  const hg = E.admit("fe", "Hg", E.probeWt("fe", "Hg"));
  const d = A.derive(A.FAMOUS[3].mix);   // 1045 steel: an extrapolated gauge, a consumed primary, a clamp
  const a356 = A.derive(A.FAMOUS[0].mix);
  const X = {
    line: hg.line, sentence: hg.sentence, vapLine: hg.vapour.line, vapText: hg.vapour.text,
    dT0Line: d.dT0Line, dT0Source: d.dT0Source,
    notGrown: d.notGrown[0], notGrownLearn: d.learn[d.notGrown[0]],
    clamp: d.clamps[0], clampLearn: d.learn[d.clamps[0]],
    headText: LC.composerText("alloy composer"),
    // EXACT hint counts per rendered state, not "at least four": 1045 is a
    // peritectic, so its readout has no "freezes at T_inv" row and binds five
    // of the six declared hints; A356 is a eutectic and binds all six
    hintKeys: LC.composerHintKeys(),
    hints1045: LC.composerHintKeys().length - (d.invariantFraction ? 0 : 1),
    hintsA356: LC.composerHintKeys().length - (a356.invariantFraction ? 0 : 1),
    // the ASSESSED cell already in the 1045 melt: the tier chip and the
    // in-melt call to action are the composer's own literals, which no other
    // gate renders (the U1c em dash was in exactly that chip)
    mnWt: A.FAMOUS[3].mix.wt.Mn,
  };
  const r = await page.evaluate(async x => {
    const S = window.__solidify;
    const raf = () => new Promise(res => requestAnimationFrame(() => res()));
    const root = document.getElementById("composer");
    const top = document.getElementById("learnToggle");
    // THE MODAL'S OWN LEARN SWITCH, pressed through a hit test. The top bar's
    // toggle is under this overlay (z-index 5 against 30), so a real click on
    // it landed on the backdrop and closed the modal, and a scripted
    // toggle.click() skipped the hit test and hid that. `press` clicks only
    // what is really on top at the button's own centre.
    const modalToggle = root.querySelector(".chead .lrnToggle");
    const hitAt = el => {
      if (!el) return "absent";
      const q = el.getBoundingClientRect();
      const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return !e ? "offscreen" : e === el || el.contains(e) ? "reachable" : (e.id || String(e.className) || e.tagName);
    };
    const press = async el => { const h = hitAt(el); if (h === "reachable") el.click(); await raf(); return h; };
    const shown = el => el.getClientRects().length > 0;
    const proseDash = s => s.includes("—") && s.trim() !== "—";
    const sample = () => {
      const visibleLearn = [...root.querySelectorAll(".lrnText, .lrnHint")].filter(e => shown(e) && e.textContent.trim()).length;
      const infos = [...root.querySelectorAll(".lrnInfo")].filter(shown).length;
      const hints = [...root.querySelectorAll(".derived .lrnHint")].filter(e => shown(e) && e.textContent.trim()).length;
      // every visible text node and every tooltip in the modal
      const dashes = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement && shown(n.parentElement) && proseDash(n.nodeValue)) dashes.push(n.nodeValue.trim().slice(0, 80));
      }
      for (const el of root.querySelectorAll("[title]")) if (proseDash(el.getAttribute("title"))) dashes.push(`title: ${el.getAttribute("title").slice(0, 80)}`);
      // ONE PARAGRAPH ONCE: no learn text is shown twice in the modal, and the
      // duplicates the figure carries (its clamp and shaded-band notes repeat
      // the readout's) are counted as held back, so the dedupe is seen working
      // rather than passing on a modal that happened to have no repeats
      const slots = [...root.querySelectorAll("[data-lrn]")];
      const shownTexts = slots.filter(e => shown(e) && e.textContent.trim()).map(e => e.textContent);
      const dupShown = shownTexts.length - new Set(shownTexts).size;
      const heldBack = slots.filter(e => !e.textContent && e.dataset.lrn && shownTexts.includes(e.dataset.lrn)).length;
      return {
        aria: top.getAttribute("aria-pressed"), modalAria: modalToggle?.getAttribute("aria-pressed") ?? null,
        why: root.querySelector(".gwhy").innerText.replace(/\s+/g, " "),
        // textContent: the chip is uppercase by CSS, and innerText reports that
        whyRaw: root.querySelector(".gwhy").textContent.replace(/\s+/g, " "),
        derived: root.querySelector(".derived").innerText.replace(/\s+/g, " "),
        visibleLearn, infos, hints, dashes, dupShown, heldBack,
      };
    };
    const pick = async sym => { root.querySelector(`.gcell[data-el='${sym}']`).click(); await raf(); };
    S.app.setRun(false);
    S.app.setMaterial("steel");
    S.composer.applyHash("#alloy=fe:C0.45,Mn0.75,Si0.25");
    S.app.openComposer();
    await raf();
    const hits = { modalToggle: hitAt(modalToggle), topToggle: hitAt(top) };
    await pick("Hg");
    if (modalToggle.getAttribute("aria-pressed") === "true") await press(modalToggle);
    const off = sample();
    await pick("Mn");
    const offMn = sample();
    await pick("Hg");
    const pressedOn = await press(modalToggle);
    const on = sample();
    await pick("Mn");
    const onMn = sample();
    await pick("Hg");
    // the header's "i" opens the composer's own explanation, and only it
    const info = root.querySelector(".chead .lrnInfo");
    info.click(); await raf();
    const body = document.getElementById(info.getAttribute("aria-controls"));
    const opened = { expanded: info.getAttribute("aria-expanded"), shown: !!body && shown(body), text: body?.textContent ?? "" };
    info.click(); await raf();
    // A356 through its quick-fill button: a eutectic, so all six hint rows print
    [...root.querySelectorAll(".famous button")].find(b => b.textContent.trim() === "A356").click();
    await raf();
    const onA356 = sample();
    const audit = S.composer.learnAudit();
    const pressedOff = await press(modalToggle);
    const offAgain = sample();
    S.app.closeComposer();
    return { hits, pressedOn, pressedOff, off, offMn, on, onMn, opened, onA356, audit, offAgain };
  }, X);

  const n = s => s.replace(/\s+/g, " ");
  const mnCta = `in the melt at ${X.mnWt} wt% · move it with its slider`;
  const offOk = r.off.aria === "false" && r.off.modalAria === "false" && r.off.visibleLearn === 0 && r.off.infos === 0
    && r.off.why.includes(n(X.line)) && !r.off.why.includes(n(X.sentence))
    && r.off.why.includes(n(X.vapLine)) && !r.off.why.includes(n(X.vapText))
    && r.off.derived.includes(n(X.dT0Line)) && !r.off.derived.includes(n(X.dT0Source))
    && r.off.derived.includes(n(X.notGrown)) && !r.off.derived.includes(n(X.notGrownLearn))
    && r.off.derived.includes(n(X.clamp)) && !r.off.derived.includes(n(X.clampLearn));
  // the modal's switch is on top at its own centre, and it drives the one
  // state: both toggles report it
  const switchOk = r.hits.modalToggle === "reachable" && r.pressedOn === "reachable" && r.pressedOff === "reachable";
  const onOk = r.on.aria === "true" && r.on.modalAria === "true" && r.on.infos === 3
    && r.on.hints === X.hints1045 && r.on.visibleLearn >= 10
    && r.on.why.includes(n(X.line)) && r.on.why.includes(n(X.sentence)) && r.on.why.includes(n(X.vapText))
    && r.on.derived.includes(n(X.dT0Source)) && r.on.derived.includes(n(X.notGrownLearn))
    && r.on.derived.includes(n(X.clampLearn));
  // the in-melt ASSESSED cell, learn off and on: its chip and call to action
  const mnOk = [r.offMn, r.onMn].every(s => s.whyRaw.includes("assessed · pourable") && s.whyRaw.includes(mnCta));
  // every declared hint bound by the two states, six on A356
  const hintsOk = r.onA356.hints === X.hintsA356 && X.hintsA356 === X.hintKeys.length
    && r.audit.hintsDeclared === X.hintKeys.length && r.audit.hintsUnbound.length === 0;
  const dedupeOk = [r.on, r.onMn, r.onA356].every(s => s.dupShown === 0) && r.on.heldBack >= 2;
  const infoOk = r.opened.expanded === "true" && r.opened.shown && r.opened.text === X.headText;
  const backOff = r.offAgain.aria === "false" && r.offAgain.modalAria === "false" && r.offAgain.visibleLearn === 0 && r.offAgain.infos === 0;
  const noDash = [r.off, r.offMn, r.on, r.onMn, r.onA356].every(s => s.dashes.length === 0);
  check("COMPOSER-LEARN", offOk && switchOk && onOk && mnOk && hintsOk && dedupeOk && infoOk && backOff && noDash, {
    learnSwitch: { hits: r.hits, pressedOn: r.pressedOn, pressedOff: r.pressedOff, ok: switchOk },
    learnOff: { visibleLearn: r.off.visibleLearn, infos: r.off.infos, linesOnly: offOk },
    learnOn: { visibleLearn: r.on.visibleLearn, infos: r.on.infos, readoutHints: r.on.hints, want: X.hints1045, explained: onOk },
    a356Hints: { shown: r.onA356.hints, want: X.hintsA356, audit: r.audit, ok: hintsOk },
    inMeltCell: { ok: mnOk, off: r.offMn.whyRaw.slice(0, 120) },
    oneParagraphOnce: { dupShown: [r.on.dupShown, r.onMn.dupShown, r.onA356.dupShown], heldBack1045: r.on.heldBack, ok: dedupeOk },
    headerInfo: { expanded: r.opened.expanded, shown: r.opened.shown, matches: r.opened.text === X.headText },
    offAgain: backOff,
    proseDashes: { off: r.off.dashes.slice(0, 4), offMn: r.offMn.dashes.slice(0, 4), on: r.on.dashes.slice(0, 4), onMn: r.onMn.dashes.slice(0, 4), a356: r.onA356.dashes.slice(0, 4) },
    whyOff: r.off.why.slice(0, 160),
  });
}

// ---------------------------------------------------------------------------
// COMPOSER-DIALOG (v8 U1c review) — the composer behaves as a modal dialog,
// driven with real key presses.
//
// Opened from the rail's own button with keyboard focus on it: focus must move
// INTO the dialog (it stayed on the rail button behind the backdrop, with 62
// tab stops before the modal's first), the page behind must be inert, Tab must
// wrap inside the card both ways, Space must not run the melt behind it, the
// reason panel must be a live region that describes the picked cell, and
// Escape must close it and put focus back on the button that opened it. The
// negative half: with the modal closed, the page is not inert and Space runs.
{
  const q = sel => page.evaluate(s => {
    const a = document.activeElement;
    return { tag: a?.tagName ?? null, cls: a?.className ?? "", text: (a?.textContent ?? "").trim().slice(0, 30),
      inCard: !!a && !!document.querySelector("#composer .card")?.contains(a), inHead: !!a?.closest?.(".chead"), sel: s };
  }, sel);
  await page.evaluate(() => { window.__solidify.app.setRun(false); window.__solidify.app.setMaterial("al"); });
  const opened = await page.evaluate(async () => {
    const raf = () => new Promise(res => requestAnimationFrame(() => res()));
    // the ALLOY section is collapsed by default, and a collapsed button cannot
    // hold focus; opened here and closed again after the close below
    const sec = [...document.querySelectorAll("#rail .secHead")].find(h => h.textContent === "ALLOY");
    const secWasOpen = sec?.getAttribute("aria-expanded") === "true";
    if (sec && !secWasOpen) { sec.click(); await raf(); }
    window.__composerDialogSec = !secWasOpen;
    const btn = [...document.querySelectorAll("#rail button")].find(b => b.textContent.includes("alloy composer"));
    if (!btn) return { btn: false };
    btn.focus();
    btn.click();
    await raf();
    const card = document.querySelector("#composer .card");
    const title = document.getElementById(card?.getAttribute("aria-labelledby") ?? "");
    const app = document.getElementById("app");
    const kids = [...app.children];
    return {
      btn: true, open: document.getElementById("composer").classList.contains("show"),
      role: card?.getAttribute("role"), modal: card?.getAttribute("aria-modal"), title: title?.textContent ?? null,
      inertExceptTour: kids.filter(k => k.id !== "tour").every(k => k.inert), tourInert: !!document.getElementById("tour")?.inert,
      railInert: !!document.getElementById("rail")?.inert,
    };
  });
  const focusOnOpen = await q("open");
  // Tab past the card's last stop wraps to its first, Shift+Tab from the first to the last
  const stops = await page.evaluate(() => {
    const card = document.querySelector("#composer .card");
    const list = [...card.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
      .filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length > 0);
    list[list.length - 1].focus();
    return { count: list.length, first: list[0].textContent.trim().slice(0, 20), last: list[list.length - 1].textContent.trim().slice(0, 20) };
  });
  await page.keyboard.press("Tab");
  const afterWrap = await page.evaluate(() => {
    const card = document.querySelector("#composer .card");
    const list = [...card.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
      .filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length > 0);
    return { isFirst: document.activeElement === list[0] };
  });
  await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift");
  const afterBack = await page.evaluate(() => {
    const card = document.querySelector("#composer .card");
    const list = [...card.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
      .filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length > 0);
    return { isLast: document.activeElement === list[list.length - 1] };
  });
  // Space with nothing focused must not run the melt behind the modal
  await page.evaluate(() => document.activeElement?.blur());
  const runBefore = await page.evaluate(() => window.__solidify.app.isRunning());
  await page.keyboard.press("Space");
  const runAfterSpace = await page.evaluate(() => window.__solidify.app.isRunning());
  // the reason panel is a live region describing the picked cell
  const live = await page.evaluate(async () => {
    const raf = () => new Promise(res => requestAnimationFrame(() => res()));
    document.querySelector("#composer .gcell[data-el='Hg']").click();
    await raf();
    const why = document.querySelector("#composer .gwhy");
    const hg = document.querySelector("#composer .gcell[data-el='Hg']");
    const others = [...document.querySelectorAll("#composer .gcell[aria-describedby]")].map(c => c.dataset.el);
    return { live: why.getAttribute("aria-live"), id: why.id, describedBy: hg.getAttribute("aria-describedby"), describedCells: others };
  });
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => {
    const app = document.getElementById("app");
    const a = document.activeElement;
    return {
      open: document.getElementById("composer").classList.contains("show"),
      anyInert: [...app.children].some(k => k.inert),
      focusBack: !!a && a.tagName === "BUTTON" && a.textContent.includes("alloy composer"),
    };
  });
  // the negative half: closed, Space runs the melt again (and is put back)
  await page.evaluate(() => document.activeElement?.blur());
  const runClosedBefore = await page.evaluate(() => window.__solidify.app.isRunning());
  await page.keyboard.press("Space");
  const runClosedAfter = await page.evaluate(() => window.__solidify.app.isRunning());
  await page.evaluate(() => {
    window.__solidify.app.setRun(false); window.__solidify.app.setMaterial("generic");
    if (window.__composerDialogSec) [...document.querySelectorAll("#rail .secHead")].find(h => h.textContent === "ALLOY")?.click();
  });

  const why = [];
  if (!opened.btn) why.push("no rail button labeled alloy composer");
  if (!opened.open) why.push("the rail button did not open the composer");
  if (opened.role !== "dialog" || opened.modal !== "true") why.push(`card role ${opened.role}, aria-modal ${opened.modal}`);
  if (opened.title !== "ALLOY COMPOSER") why.push(`aria-labelledby names "${opened.title}"`);
  if (!opened.inertExceptTour || opened.tourInert || !opened.railInert) why.push(`inert: page ${opened.inertExceptTour}, rail ${opened.railInert}, tour ${opened.tourInert}`);
  if (!focusOnOpen.inHead) why.push(`focus on open is ${focusOnOpen.tag}.${focusOnOpen.cls} "${focusOnOpen.text}", not the dialog header`);
  if (!(stops.count >= 10)) why.push(`only ${stops.count} tab stops in the card`);
  if (!afterWrap.isFirst) why.push("Tab from the last stop did not wrap to the first");
  if (!afterBack.isLast) why.push("Shift+Tab from the first stop did not wrap to the last");
  if (runAfterSpace !== runBefore) why.push("Space ran or paused the melt behind the open modal");
  if (live.live !== "polite" || live.describedBy !== live.id || !live.id || live.describedCells.join() !== "Hg") why.push(`live region ${JSON.stringify(live)}`);
  if (closed.open) why.push("Escape did not close the modal");
  if (closed.anyInert) why.push("the page stayed inert after close");
  if (!closed.focusBack) why.push("focus did not return to the rail button");
  if (runClosedAfter === runClosedBefore) why.push("with the modal closed Space no longer runs the melt (the gate's positive control)");
  check("COMPOSER-DIALOG", why.length === 0, { opened, focusOnOpen, stops, afterWrap, afterBack,
    spaceWhileOpen: { before: runBefore, after: runAfterSpace }, live, closed,
    spaceWhileClosed: { before: runClosedBefore, after: runClosedAfter }, why });
}

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
await viteServer.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
