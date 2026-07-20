// Verifies "Engineer it" enters ML mode PAUSED, that the transport run/pause
// gates the optimization loop, and that exit restores. Drives the exposed
// __solidify hooks under headless Chrome + WebGPU.
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

// 3. press PAUSE — let the in-flight casting settle, then confirm no new ones
await page.evaluate(() => { window.__solidify.app.setRun(false); window.__solidify.ui.sync(); });
await new Promise(r => setTimeout(r, 600));           // in-flight casting finishes
const before = (await snap()).episodes;
for (let i = 0; i < 30; i++) { await page.evaluate(() => window.__solidify.tick(4)); await new Promise(r => setTimeout(r, 40)); }
const paused = await snap();
console.log(`after PAUSE: thumbs ${before} -> ${paused.episodes} (frozen=${before === paused.episodes}) running=${paused.running}`, JSON.stringify(paused));
await page.screenshot({ path: `${OUT}/opt-3-paused.png` });

// 4. exit — back to normal melt
await page.evaluate(() => { document.querySelector("#lab button")?.click(); window.__solidify.ui.sync(); });
await new Promise(r => setTimeout(r, 400));
console.log("after EXIT:", JSON.stringify(await snap()));

console.log("ERRORS:", errs.length ? errs.join(" | ") : "none");
await browser.close();
