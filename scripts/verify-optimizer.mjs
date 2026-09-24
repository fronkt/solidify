// Verifies "Engineer it" enters ML mode PAUSED, that the transport run/pause
// gates the optimization loop, and that exit restores. Drives the exposed
// __solidify hooks under headless Chrome + WebGPU.
//
// Mostly logs. The one verdict (v8 U1b review): leaving the mode by the
// panel's own `exit` button, found by its text, must end the optimizer and
// the engineering transport, and it runs on BOTH paths (the search converging
// inside the burst budget, which re-enters the mode after the apply, or not).
// A missing button or a mode left open sets the exit code.
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1400, height: 950 },
});
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(e.message));
await page.goto("http://localhost:5199/app/", { waitUntil: "networkidle0", timeout: 30000 });
try { await page.waitForFunction("!!window.__solidify", { timeout: 15000 }); }
catch { await page.reload({ waitUntil: "networkidle0" }); await page.waitForFunction("!!window.__solidify", { timeout: 20000 }); }
await new Promise(r => setTimeout(r, 1200));

const snap = () => page.evaluate(() => {
  const S = window.__solidify;
  return {
    active: S.opt.active, running: S.opt.running,
    appRunning: S.app.isRunning(), engineering: S.app.isEngineering(),
    runBtn: document.querySelector("#transport button:nth-child(2)")?.textContent?.trim(),
    panel: !!document.getElementById("lab"),
    episodes: document.querySelectorAll("#lab canvas").length,
    status: document.getElementById("labStatus")?.textContent?.slice(0, 60),
  };
});

/** leave the mode by the panel's `exit` button, found by its text (since v8
 *  U1b the header's first button is learn mode's "i", which the old
 *  `#lab button` selector clicked instead, leaving the mode open) */
async function exitByButton(where) {
  const found = await page.evaluate(() => {
    const b = [...document.querySelectorAll("#lab button")].find(b => b.textContent.trim() === "exit");
    if (!b) return false;
    b.click();
    window.__solidify.ui.sync();
    return true;
  });
  await new Promise(r => setTimeout(r, 400));
  const s = await snap();
  // the liveness half: the mode was open before the click (the caller
  // asserts it), and after it the optimizer, its engineering transport and
  // its panel are all gone
  const ok = found && !s.active && !s.engineering && !s.panel;
  console.log(`EXIT (${where})`, ok ? "OK" : "FAIL", JSON.stringify({ exitButtonFound: found, ...s }));
  if (!ok) process.exitCode = 1;
}

// 1. enter ML mode via the button handler path
await page.evaluate(() => { window.__solidify.app.startOptimizer(); window.__solidify.ui.sync(); });
await new Promise(r => setTimeout(r, 400));
console.log("after ENGINEER IT:", JSON.stringify(await snap()));
await page.screenshot({ path: `${OUT}/opt-1-entered-paused.png` });

// 2. press RUN (transport) — optimizer should start ticking castings
await page.evaluate(() => { window.__solidify.app.setRun(true); window.__solidify.ui.sync(); });
for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__solidify.tick(4)); await new Promise(r => setTimeout(r, 60)); }
console.log("after RUN + ticks:", JSON.stringify(await snap()));
await page.screenshot({ path: `${OUT}/opt-2-running.png` });

// 2b. keep running until the convergence report appears (or 500 tick-bursts)
for (let i = 0; i < 500; i++) {
  await page.evaluate(() => window.__solidify.tick(6));
  await new Promise(r => setTimeout(r, 30));
  const rep = await page.evaluate(() => document.getElementById("labReport")?.style.display === "block");
  if (rep) break;
}
const conv = await page.evaluate(() => ({
  shown: document.getElementById("labReport")?.style.display === "block",
  text: document.getElementById("labReport")?.textContent?.slice(0, 200),
}));
console.log("CONVERGENCE:", JSON.stringify(conv));
await page.screenshot({ path: `${OUT}/opt-4-report.png` });

// 2c. apply the recipe — mode exits, recipe staged ARMED on the full grid
if (conv.shown) {
  await page.evaluate(() => {
    [...document.querySelectorAll("#labReport button")].find(b => b.textContent.includes("apply"))?.click();
  });
  await new Promise(r => setTimeout(r, 800));
  const applied = await page.evaluate(() => ({
    optActive: window.__solidify.opt.active,
    grid: window.__solidify.app.getGrid(),
    undercool: +window.__solidify.app.getUndercool().toFixed(2),
    coolRate: +window.__solidify.app.simParams().coolRate.toFixed(2),
    inoculant: +window.__solidify.app.getInoculant().toFixed(1),
    armedShown: document.getElementById("armed")?.style.display,
  }));
  console.log("APPLIED:", JSON.stringify(applied));
  await page.screenshot({ path: `${OUT}/opt-5-applied.png` });
  // the apply left the mode by its own path, so the exit button has not run
  // yet: re-enter the mode, and leave it by that button
  await page.evaluate(() => { window.__solidify.app.startOptimizer(); window.__solidify.ui.sync(); });
  await new Promise(r => setTimeout(r, 400));
  const reentered = await snap();
  console.log("RE-ENTERED:", JSON.stringify(reentered));
  if (!reentered.active || !reentered.panel) { console.log("EXIT (after apply) FAIL: the mode did not reopen"); process.exitCode = 1; }
  else await exitByButton("after apply");
} else {
  // 3. press PAUSE — let the in-flight casting settle, then confirm no new ones
  await page.evaluate(() => { window.__solidify.app.setRun(false); window.__solidify.ui.sync(); });
  await new Promise(r => setTimeout(r, 600));           // in-flight casting finishes
  const before = (await snap()).episodes;
  for (let i = 0; i < 30; i++) { await page.evaluate(() => window.__solidify.tick(4)); await new Promise(r => setTimeout(r, 40)); }
  const paused = await snap();
  console.log(`after PAUSE: thumbs ${before} -> ${paused.episodes} (frozen=${before === paused.episodes}) running=${paused.running}`, JSON.stringify(paused));
  await page.screenshot({ path: `${OUT}/opt-3-paused.png` });

  // 4. exit — back to normal melt
  if (!paused.active || !paused.panel) { console.log("EXIT (paused) FAIL: the mode was not open"); process.exitCode = 1; }
  else await exitByButton("paused");
}

console.log("ERRORS:", errs.length ? errs.join(" | ") : "none");
await browser.close();
