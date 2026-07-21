// Regenerates the demo stills: README hero shots + the landing's no-WebGPU
// fallback images. Captured from the live app via headless Chrome with WebGPU
// (--enable-unsafe-webgpu --enable-gpu): hide the UI chrome, grow the crystal
// large with deterministic __solidify.tick() bursts at ×4 speed, then clip a
// centered region straight to JPEG so the frame is all simulation.
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
const PORT = process.argv[3] ?? "5199";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 1000 },
});

const HIDE = () => {
  // #app holds the canvas AND all chrome as siblings — hide everything but the canvas
  for (const el of document.getElementById("app").children) {
    if (el.tagName !== "CANVAS") el.style.display = "none";
  }
};

async function appShot(name, setup, { ticks = 22, clip } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  try {
    await page.waitForFunction("!!window.__solidify", { timeout: 15000 });
  } catch {
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
  }
  await new Promise(r => setTimeout(r, 1000));
  // fast-forward: max the speed slider, then stack the ×4 multiplier
  await page.evaluate(() => {
    const a = window.__solidify.app;
    a.setSpeed(60);
    while (a.getSpeedMult() !== 4) a.cycleSpeedMult();
  });
  if (setup) await page.evaluate(setup);
  for (let i = 0; i < ticks; i++) {
    await page.evaluate(() => window.__solidify.tick(60));
    await new Promise(r => setTimeout(r, 90));
  }
  await page.evaluate(HIDE);
  await page.evaluate(() => window.__solidify.app.renderOnce?.());
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality: 86, clip });
  console.log("shot", name);
  await page.close();
}

const CENTER = { x: 425, y: 125, width: 750, height: 750 };

// default four-fold dendrite, grown large (MELT glow)
await appShot("hero-dendrite.jpg", null, { ticks: 26, clip: CENTER });
// ice: six-fold snowflake in ORIENT view (MELT is near-black — ice has no glow)
await appShot("hero-snowflake.jpg", () => {
  const a = window.__solidify.app;
  a.setMaterial("ice"); a.setUndercool(0.92); a.resetArmed(); a.seedCenter(); a.setView(1); a.setRun(true);
}, { ticks: 30, clip: CENTER });
// steel: multi-grain white-hot pour, MELT glow, grown to a dense field
await appShot("hero-steel.jpg", () => {
  const a = window.__solidify.app;
  a.setMaterial("steel"); a.setUndercool(0.88); a.resetArmed(); a.scatterSeeds(16); a.setView(0); a.setRun(true);
}, { ticks: 55, clip: { x: 300, y: 100, width: 1000, height: 800 } });

// TRUE 3D: six-armed dendrite at 128³ — landing fallback (MELT) + README hero (ORIENT).
// A warm melt (undercool 0.7) keeps growth diffusion-limited so real arms form;
// ~4000 frames at speed 22 is where the star is fully expressed but not box-bound.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(async () => { await window.__solidify.app.setMode("3d"); });
  await page.evaluate(() => window.__solidify.app.setGrid3(128));
  await page.waitForFunction("window.__solidify.sim3d()?.n === 128", { timeout: 30000 });
  await page.evaluate(() => {
    const a = window.__solidify.app;
    a.setUndercool(0.7); a.setSym3(4);
    a.setParams({ delta: 0.05, noiseAmp: 0.016, latent: 1.8, coolRate: 0.015, heatIn: 0 });
    a.clearMelt(0.7); a.seedCenter(); a.setView3d(0); a.setSpeed(22); a.setRun(true);
  });
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => window.__solidify.tick(40));
    await new Promise(r => setTimeout(r, 60));
  }
  await page.evaluate(HIDE);
  // HIDE keeps canvases — the ViewCube is one, and it doesn't belong in a still
  await page.evaluate(() => { document.getElementById("viewcube").style.display = "none"; });
  const clip3 = { x: 500, y: 200, width: 600, height: 600 };
  await page.evaluate(() => window.__solidify.tick(2));
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: `${OUT}/dendrite3d.jpg`, type: "jpeg", quality: 86, clip: clip3 });
  console.log("shot dendrite3d.jpg");
  await page.evaluate(() => window.__solidify.app.setView3d(1));
  await page.evaluate(() => window.__solidify.tick(2));
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: `${OUT}/hero-3d.jpg`, type: "jpeg", quality: 86, clip: clip3 });
  console.log("shot hero-3d.jpg");
  await page.close();
}

// the dive: fully-exploded SEM column, full landing viewport
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  await page.evaluate(() => {
    const act = document.getElementById("diveAct");
    const sp = act.closest(".pin-spacer") || act;
    // THE MICROSCOPE explode is fully open at global progress ≈0.39
    // (stage weights are non-uniform; its span mid-point works out here)
    scrollTo(0, sp.getBoundingClientRect().top + scrollY + 0.39 * 19000);
  });
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT}/dive-column.jpg`, type: "jpeg", quality: 86 });
  console.log("shot dive-column.jpg");
  await page.close();
}

await browser.close();
console.log("done");
