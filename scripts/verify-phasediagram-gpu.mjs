// PD-CURSOR-LIVE — the composer's phase-diagram cursor, against a real cast.
//
// ITS OWN FILE, AND THAT IS THE POINT. It was written inside verify-quant.mjs
// first, and could not pass there: every QPF-* block above it stages the solver
// by writing `solver`, `lambda`, `dx`, `dt` and `frozenT` straight onto
// sim.params, and none of them puts anything back. With `frozenT: 1` inherited
// the melt sat at exactly its staged temperature forever and both reads agreed;
// with it cleared, the inherited dimensionless `dt` advanced sim time so fast
// that 90 frames cooled the melt past the shader's own [-1, 2] readout clamp to
// 162 C, three hundred degrees below the diagram. Neither failure was in the
// code under test. A gate that needs a pristine app should open a pristine app
// — the same reason verify-experiment-gpu.mjs is not inside verify-experiment.
//
//   node scripts/verify-phasediagram-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

// v7.1 P6: TOUR-PD-STEP finds its chapter BY TITLE, out of the module that
// ships it, rather than by an index this file would have to keep in step with
// CHAPTERS. An inserted chapter renames nothing and breaks nothing here; a
// deleted one fails loudly instead of testing whichever chapter slid into its
// slot.
const viteServer = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

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
// PD-CURSOR-LIVE — the drawn temperature cursor against the app's OWN
// thermometer.
//
// verify-phasediagram.mjs settles the geometry without a browser. What it
// cannot see is whether the cursor tracks the melt: the composer is otherwise
// input-driven only, and before P2 nothing re-rendered it while it was open, so
// a temperature drawn at open() would sit frozen over a casting that kept
// solidifying. This drives the real modal against the real solver.
//
// The cursor's label is compared against `units.fmtC(meanLiqT)` — the SAME
// formatter the corner readout uses — at TWO separate reads, and the two reads
// must DIFFER. "It moved downward" would be the PIN3-LIVE directional-proxy
// mistake in a new costume: a cursor wired to fracSolid would also move
// downward. Equality with the app's own formatter is the mechanism.
{
  const r = await page.evaluate(async () => {
    const S = window.__solidify;
    const readCursor = () => {
      const t = document.getElementById("pdCursor");
      if (!t) return { present: false, text: null };
      const hidden = t.getAttribute("display") === "none";
      return { present: !hidden, text: hidden ? null : t.textContent };
    };
    S.app.setRun(false);
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    S.app.setMaterial("al");
    S.composer.applyHash("#alloy=al:Si7,Mg0.35");
    S.app.openComposer();
    // A PHYSICALLY PLAUSIBLE undercooling, and the first draft of this gate did
    // not use one. `applyAlloy` raises undercool to 0.9 on every pour, and 0.9
    // dimensionless is 224 K below aluminium's melting point under Kobayashi
    // scaling — the melt lands at 436 °C, two hundred degrees under the Al–Si
    // eutectic and clean off the diagram, so the cursor was correctly absent
    // and the gate correctly failed. 0.30 is 75 K, which lands inside the
    // Al–Si frame, and it has to clear the LOCAL liquidus too: the depression
    // is mLiq*c0 = 0.194, so 0.2 left an effective undercooling of 0.006 and
    // the seed never grew. Cooling is set explicitly because the default is
    // 0.0 and `applyAlloy`'s min(coolRate, 0.2) therefore leaves it at zero —
    // a melt that neither freezes nor cools has a constant temperature, and
    // this gate's whole claim is that the two reads DIFFER.
    S.app.setUndercool(0.30);
    // Cooling is set explicitly because the default is 0.0 and `applyAlloy`'s
    // min(coolRate, 0.2) therefore leaves it there — a melt that neither
    // freezes nor cools has a constant temperature, and this gate's whole
    // claim is that the two reads DIFFER.
    S.app.setParams({ coolRate: 0.12 });
    S.app.resetArmed();
    S.app.seedCenter();
    S.app.setRun(true);

    // let the cast run and the 4 Hz panel stats land, then sample twice
    const settle = async (frames) => {
      for (let i = 0; i < frames; i++) await new Promise(res => requestAnimationFrame(res));
    };
    await settle(90);
    const a = { cursor: readCursor(), melt: S.app.meltC() };
    await settle(150);
    const b = { cursor: readCursor(), melt: S.app.meltC() };

    // OFF THE DIAGRAM: the same melt driven to a Kobayashi undercooling that no
    // casting reaches. The cursor must be absent AND the panel must SAY so —
    // an absent cursor with no sentence is indistinguishable from a broken one.
    S.app.setUndercool(0.9);
    S.app.resetArmed();
    S.app.seedCenter();
    await settle(60);
    const notes = () => document.querySelector("#composer .pdnotes")?.textContent ?? "";
    const off = { cursor: readCursor(), melt: S.app.meltC(), named: /off this diagram/.test(notes()) };

    // ABSTRACT MATERIAL: no SI identity, so the thermometer is not defined and
    // the cursor must be ABSENT rather than plotted at zero
    S.app.setRun(false);
    S.app.setMaterial("generic");
    S.composer.tick();
    const abstract = { cursor: readCursor(), melt: S.app.meltC() };

    // FULLY SOLID: meanLiqT is null (sim.ts returns null, never 0) and the
    // cursor must refuse rather than fall to the bottom of the axis
    S.app.setMaterial("al");
    S.composer.applyHash("#alloy=al:Si7,Mg0.35");
    // a SMALL grid, MANY seeds and a hard quench, because this arm needs the
    // casting genuinely finished: one centre seed on a 1024 grid reached only
    // fracSolid 0.33 in 900 frames and the arm timed out rather than testing
    // anything. The claim is about what happens when there is no liquid LEFT.
    S.app.setGrid(512);
    S.app.setUndercool(0.95);
    // pPore: 0 because a shrinkage pore PINS its cell's phi below 0.5 and never
    // freezes (PORE_ID 4095), so the stats kernel counts it as liquid forever
    // and meanLiqT never becomes null however long the cast runs. With pores
    // off the casting reaches fracSolid 1.0 and the thermometer goes null,
    // which is the state this arm exists to test.
    S.app.setParams({ coolRate: 0.45, pPore: 0 });
    S.app.resetArmed();
    S.app.scatterSeeds(220);
    S.app.setRun(true);
    // Run until the READBACK says there is no liquid, which is the condition the
    // code under test actually keys on. Chasing fracSolid to 0.999 chases the
    // wrong number: the last percent is thin film between grains, and the
    // shader's liquid count is sampled every other cell on each axis, so it
    // reaches zero slightly before the final odd-indexed cell freezes.
    // fracSolid is asserted below as EVIDENCE the melt got here by solidifying.
    let fs = 0;
    for (let i = 0; i < 2100; i++) {
      await new Promise(res => requestAnimationFrame(res));
      fs = S.app.fracSolidNow();
      if (fs > 0.9 && S.app.meltC() === null) break;
    }
    await settle(20);
    const solid = { cursor: readCursor(), melt: S.app.meltC(), fracSolid: fs };

    S.app.setRun(false);
    S.composer.close();
    S.app.setMaterial("generic");
    return { a, b, off, abstract, solid };
  });

  const num = s => {
    const m = /(-?\d+)\s*°C/.exec(s ?? "");
    return m ? +m[1] : null;
  };
  // the cursor's own label equals the app's own thermometer, both reads
  const agrees = x => x.cursor.present && x.melt != null
    && num(x.cursor.text) === Math.round(x.melt);
  const live = agrees(r.a) && agrees(r.b)
    && num(r.a.cursor.text) !== num(r.b.cursor.text);
  // ...and both absences are absences, not zeros
  // off-scale is NAMED; the other two absences are silent, and that difference
  // is the point — "no liquid left" is not the same fact as "below the axis"
  const offOk = !r.off.cursor.present && r.off.melt != null && r.off.named;
  const abstractOk = !r.abstract.cursor.present && r.abstract.melt === null;
  const solidOk = r.solid.fracSolid > 0.999 && r.solid.melt === null
    && !r.solid.cursor.present;

  check("PD-CURSOR-LIVE", live && offOk && abstractOk && solidOk, {
    read1: { label: r.a.cursor.text, appThermometerC: r.a.melt == null ? null : +r.a.melt.toFixed(2) },
    read2: { label: r.b.cursor.text, appThermometerC: r.b.melt == null ? null : +r.b.melt.toFixed(2) },
    readsDiffer: num(r.a.cursor.text) !== num(r.b.cursor.text),
    offDiagram: { cursorDrawn: r.off.cursor.present, thermometerC: r.off.melt == null ? null : +r.off.melt.toFixed(1), named: r.off.named },
    abstractMaterial: { cursorDrawn: r.abstract.cursor.present, thermometer: r.abstract.melt },
    fullySolid: { fracSolid: +r.solid.fracSolid.toFixed(4), cursorDrawn: r.solid.cursor.present, thermometer: r.solid.melt },
    note: "equality with units.fmtC's own conversion, not 'it went down' — a cursor wired to fracSolid would also go down",
  });
}


// ---------------------------------------------------------------------------
// TOUR-PD-STEP (v7.1 P6) — the chapter that opens the composer, driven through
// the DOM.
//
// The pure layer settles what the chapter CLAIMS (PD-CHAPTER-PURE). What only a
// browser can settle is whether the chapter is reachable at all, and there the
// interesting number is a z-index. `#composer` is `position: fixed; inset: 0;
// z-index: 30` with a backdrop whose pointerdown closes it; `#tour` had no
// z-index, so a chapter that opened the composer buried its own "next ▸" under
// that backdrop and the only way out of the chapter was to dismiss the thing it
// had just opened. So the assertion is not "the panel is visible" — it is
// ELEMENT-FROM-POINT AT THE BUTTON'S OWN CENTRE, which is the property that was
// false before and which a visibility check cannot see.
//
// BOTH POLARITIES, and no optimizer. Leaving the chapter must CLOSE the modal —
// otherwise it sits over the next chapter's melt, and the "watch" line describes
// a canvas nobody can see — and coming back must reopen it. The walk goes
// backwards first (to "The alloy") and then forwards, deliberately: the chapter
// after this one starts the CMA-ES optimizer, `openComposer` refuses while that
// is running, and a gate that stepped through it would be measuring the
// optimizer's guard rather than the tour's.
//
// AND IT MUST NOT CROSS-DRIVE. A mix is staged through the composer's own hash
// decoder first; after the chapter has opened the panel, those solute rows must
// still be the ones staged. The chapter opens the composer and its prose names
// the slider to move — that is the whole extent of the coupling, and a chapter
// that had begun writing the composer's state would show up here.
{
  const CH = await viteServer.ssrLoadModule("/src/tour.ts");
  const TITLE = "The line you can cross";
  const IDX = CH.CHAPTERS.findIndex(c => c.title === TITLE);
  const PREV = IDX > 0 ? CH.CHAPTERS[IDX - 1].title : null;

  const r = IDX < 0 ? null : await page.evaluate(async (idx, hash) => {
    const S = window.__solidify;
    const settle = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const comp = () => document.getElementById("composer");
    const tour = () => document.getElementById("tour");
    const shown = el => !!el && el.classList.contains("show")
      && getComputedStyle(el).display !== "none";
    const chapterTitle = () => tour()?.querySelector("h3")?.textContent ?? null;
    const navBtn = label => [...(tour()?.querySelectorAll(".nav button") ?? [])]
      .find(b => (b.textContent ?? "").includes(label)) ?? null;
    const rows = () => [...document.querySelectorAll("#composer .rows .crow b")]
      .map(b => b.textContent);
    // is the button the topmost thing at its own centre, or is a backdrop?
    const topmostAt = el => {
      if (!el) return null;
      const q = el.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      if (!hit) return null;
      return hit === el ? "self" : el.contains(hit) ? "descendant" : (hit.id || hit.className || hit.tagName);
    };

    S.app.setRun(false);
    await settle();
    // Stage a mix the chapter has no way to know about, and READ IT BACK
    // THROUGH A RENDER. applyHash pours and closes without re-rendering the
    // rows, so reading them straight afterwards returns whatever the previous
    // gate on this page left in the DOM — which is how the first cut of this
    // check reported a cross-drive that was its own stale fixture.
    S.composer.applyHash(hash);
    S.app.openComposer();
    await settle();
    const staged = rows();
    S.app.closeComposer();
    await settle();

    await S.tour.goto(idx);
    await settle();
    const onChapter = {
      composerOpen: shown(comp()), tourOpen: shown(tour()), title: chapterTitle(),
      rows: rows(), nextHit: topmostAt(navBtn("next")), backHit: topmostAt(navBtn("back")),
    };

    navBtn("back")?.click();
    await settle();
    const onPrev = { composerOpen: shown(comp()), tourOpen: shown(tour()), title: chapterTitle() };

    navBtn("next")?.click();
    await settle();
    const back = { composerOpen: shown(comp()), tourOpen: shown(tour()), title: chapterTitle() };

    navBtn("close")?.click();
    await settle();
    const closed = { composerOpen: shown(comp()), tourOpen: shown(tour()) };

    return { staged, onChapter, onPrev, back, closed };
  }, IDX, "#alloy=al:Cu4.4,Mg1.5");

  const why = [];
  if (IDX < 0) why.push(`no chapter titled "${TITLE}"`);
  else {
    if (!r.onChapter.composerOpen) why.push("the chapter did not open the composer");
    if (!r.onChapter.tourOpen) why.push("the tour panel is not shown on the chapter");
    if (r.onChapter.title !== TITLE) why.push(`the panel shows "${r.onChapter.title}"`);
    // THE Z-INDEX CLAIM. Before P6 this read "composer" — the modal's own
    // backdrop, whose pointerdown handler closes it.
    if (!["self", "descendant"].includes(r.onChapter.nextHit))
      why.push(`"next ▸" is buried under ${r.onChapter.nextHit}`);
    if (!["self", "descendant"].includes(r.onChapter.backHit))
      why.push(`"◂ back" is buried under ${r.onChapter.backHit}`);
    // no cross-drive
    if (r.staged.length === 0) why.push("the staged mix produced no solute rows — the fixture is vacuous");
    if (JSON.stringify(r.onChapter.rows) !== JSON.stringify(r.staged))
      why.push(`the chapter rewrote the composer's mix: ${JSON.stringify(r.staged)} -> ${JSON.stringify(r.onChapter.rows)}`);
    // leaving closes it, returning reopens it
    if (r.onPrev.composerOpen) why.push("leaving the chapter left the composer open over the next melt");
    if (r.onPrev.title !== PREV) why.push(`"◂ back" landed on "${r.onPrev.title}", not "${PREV}"`);
    if (!r.back.composerOpen) why.push("returning to the chapter did not reopen the composer");
    if (r.back.title !== TITLE) why.push(`"next ▸" landed on "${r.back.title}"`);
    // and closing the tour puts the modal back too
    if (r.closed.composerOpen || r.closed.tourOpen) why.push("closing the tour left a panel open");
  }

  check("TOUR-PD-STEP", why.length === 0, {
    chapter: IDX, title: TITLE, previous: PREV,
    hitTest: r && { next: r.onChapter.nextHit, back: r.onChapter.backHit },
    stagedMix: r && r.staged, mixOnChapter: r && r.onChapter.rows,
    composerOpen: r && [r.onChapter.composerOpen, r.onPrev.composerOpen, r.back.composerOpen, r.closed.composerOpen],
    why,
    note: "elementFromPoint at the button's own centre, not visibility — the pre-P6 defect was a paint order, and the panel was 'visible' throughout it",
  });
}

await viteServer.close();

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
