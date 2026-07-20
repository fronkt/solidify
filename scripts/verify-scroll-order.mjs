// Asserts the pinned acts never overlap: the dive's pin range must END
// before the lens act's begins, and lens before materials. This is the
// regression Frank hit twice ("GPU → lens act → die → …"): the dive trigger
// was created async after the sim triggers, so their starts were computed
// without its 8200px pin spacer. Needs WebGPU (so the sim triggers exist);
// tries headless-with-GPU first, then a headed run.
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
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
  // wait for boot to finish (dive awaited first, then sims + triggers)
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

  // walk the page like a reader: shots at dive-end−300, +600, mat start+300
  const dive = report.pins.find(p => p.id === "dive");
  if (dive) {
    for (const [name, y] of [["order-dive-tail", dive.end - 300], ["order-after-dive", dive.end + 600], ["order-mat", (report.pins[2]?.start ?? dive.end + 4000) + 300]]) {
      await page.evaluate(yy => scrollTo(0, yy), y);
      await new Promise(r => setTimeout(r, 2300));
      await page.screenshot({ path: `${OUT}/${name}.png` });
    }
  }
  await browser.close();
  return report;
}

let rep = await attempt("new");
if (!rep) { console.log("headless had no WebGPU; going headed"); rep = await attempt(false); }
if (!rep) { console.log("FAIL: no WebGPU in either mode — cannot verify"); process.exit(1); }
console.log("PINS", JSON.stringify(rep.pins, null, 1));
console.log(rep.overlaps.length ? "OVERLAPS!\n" + rep.overlaps.join("\n") : "NO OVERLAP — pinned acts are sequential");
