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

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
await viteServer.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
