// Fallback matrix for the dive: WebGL blocked (old SVG camera must engage),
// prefers-reduced-motion (static stage), and a phone viewport on the 3D path.
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
const URL = "http://localhost:5199/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function run(name, { args = [], reduced = false, viewport = { width: 1440, height: 900 }, scrollP = 0.4 }) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--hide-scrollbars", ...args],
    defaultViewport: viewport,
  });
  const page = await browser.newPage();
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise(r => setTimeout(r, 2200));
  const state = await page.evaluate(() => ({
    live3d: document.getElementById("diveAct")?.classList.contains("live3d") ?? false,
    stageShown: [...document.querySelectorAll("#diveAct .stage")].some(s => getComputedStyle(s).display !== "none"),
  }));
  await page.evaluate(pp => {
    const act = document.getElementById("diveAct");
    const sp = act.closest(".pin-spacer") || act;
    scrollTo(0, sp.getBoundingClientRect().top + scrollY + pp * 8200);
  }, scrollP);
  await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, JSON.stringify(state), "errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
}

await run("fb-nowebgl", { args: ["--disable-webgl", "--disable-webgl2"] });
await run("fb-reduced", { reduced: true });
await run("fb-mobile", { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], viewport: { width: 390, height: 844 }, scrollP: 0.44 });
console.log("done");
