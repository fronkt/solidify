// Headless verification of the 3D dive: boots the landing, confirms the
// Three.js path engaged, scrubs to a set of scroll progresses, and captures
// screenshots + console errors. Runs Frank's installed Chrome via CDP.
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
const URL = "http://localhost:5199/";
const PROGRESS = [0.03, 0.12, 0.2, 0.3, 0.38, 0.47, 0.56, 0.68, 0.85, 0.97];

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--window-size=1440,900", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", e => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));

const state = await page.evaluate(() => {
  const act = document.getElementById("diveAct");
  return {
    live3d: act?.classList.contains("live3d") ?? false,
    canvasW: document.getElementById("dive3d")?.width ?? 0,
    labels: document.querySelectorAll(".dlab").length,
  };
});
console.log("STATE", JSON.stringify(state));

async function shotAt(p, name) {
  await page.evaluate(pp => {
    const act = document.getElementById("diveAct");
    const sp = act.closest(".pin-spacer") || act;
    const top = sp.getBoundingClientRect().top + scrollY;
    scrollTo(0, top + pp * 6800);
  }, p);
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}

for (const p of PROGRESS) await shotAt(p, `dive-p${String(p).replace(".", "")}`);
// fan-motion check: two frames at the same progress, 1.2 s apart
await shotAt(0.03, "fan-a");
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/fan-b.png` });
console.log("shot fan-b");

// fps probe at a mid-dive point
await page.evaluate(() => {
  const act = document.getElementById("diveAct");
  const sp = act.closest(".pin-spacer") || act;
  scrollTo(0, sp.getBoundingClientRect().top + scrollY + 0.47 * 6800);
});
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res((n / (performance.now() - t0)) * 1000); };
  requestAnimationFrame(tick);
}));
console.log("FPS", fps.toFixed(1));
console.log("ERRORS", errors.length ? errors.join("\n") : "none");
await browser.close();
