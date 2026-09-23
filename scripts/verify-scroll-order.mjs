// Asserts the pinned acts never overlap: the lens act's pin range must END
// before the materials act's begins, and both pins must exist. Exits 1 on a
// missing pin, a wrong order or an overlap. Pins created out of order compute
// their starts without an earlier pin's spacer and interleave; that happened
// twice with the scroll dive, which was removed from the landing in v8 U4.
// Needs WebGPU (so the sim triggers exist); tries headless-with-GPU first,
// then a headed run.
import puppeteer from "puppeteer-core";

const URL = "http://localhost:5199/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function attempt(headless) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless,
    args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars",
      ...(headless ? [] : ["--window-position=2600,50"])],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
  // wait for boot to finish (sims + triggers)
  const gotSims = await page.waitForFunction("!!window.__landing", { timeout: 12000 }).then(() => true).catch(() => false);
  if (!gotSims) { await browser.close(); return null; }

  const report = await page.evaluate(() => {
    const w = window;
    const pins = w.__landing.ST.getAll()
      .filter(t => t.vars.pin)
      .map(t => ({ id: t.vars.id ?? t.trigger.id, start: Math.round(t.start), end: Math.round(t.end) }))
      .sort((a, b) => a.start - b.start);
    const overlaps = [];
    for (let i = 1; i < pins.length; i++)
      if (pins[i].start < pins[i - 1].end - 1) overlaps.push(`${pins[i - 1].id} [${pins[i - 1].start}..${pins[i - 1].end}] overlaps ${pins[i].id} [${pins[i].start}..${pins[i].end}]`);
    return { pins, overlaps };
  });

  await browser.close();
  return report;
}

let rep = await attempt("new");
if (!rep) { console.log("headless had no WebGPU; going headed"); rep = await attempt(false); }
if (!rep) { console.log("FAIL: no WebGPU in either mode — cannot verify"); process.exit(1); }
console.log("PINS", JSON.stringify(rep.pins, null, 1));
// A gate, not a report: every required pin must exist (an empty pin list is
// not "no overlap"), they must start in this order, and no pin may start
// inside the one before it. A new pinned act (e.g. the v8 H4 hero above the
// lens act) adds its trigger id here, in scroll order.
const REQUIRED = ["lensAct", "matAct"];
const ids = rep.pins.map(p => p.id);
const missing = REQUIRED.filter(id => !ids.includes(id));
const at = REQUIRED.map(id => ids.indexOf(id));
const outOfOrder = missing.length === 0 && at.some((v, i) => i > 0 && v < at[i - 1]);
if (missing.length || outOfOrder || rep.overlaps.length) {
  console.log("FAIL", JSON.stringify({ missing, outOfOrder, overlaps: rep.overlaps }, null, 1));
  process.exit(1);
}
console.log(`PASS: NO OVERLAP — pinned acts are sequential (${REQUIRED.join(" → ")})`);
