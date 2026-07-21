// Verifies the v1.8 tool batch: faceted growth, share-link round-trip,
// analysis-panel enlargement, and the specimen-tilt view.
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? ".";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1400, height: 950 },
});

async function boot(page, hash = "") {
  await page.goto("http://localhost:5199/app/" + hash, { waitUntil: "networkidle0", timeout: 30000 });
  try { await page.waitForFunction("!!window.__solidify", { timeout: 15000 }); }
  catch { await page.reload({ waitUntil: "networkidle0" }); await page.waitForFunction("!!window.__solidify", { timeout: 20000 }); }
  await new Promise(r => setTimeout(r, 1000));
}
const grow = async (page, k) => { for (let i = 0; i < k; i++) { await page.evaluate(() => window.__solidify.tick(60)); await new Promise(r => setTimeout(r, 80)); } };
const hideChrome = p => p.evaluate(() => { for (const el of document.getElementById("app").children) if (el.tagName !== "CANVAS") el.style.display = "none"; });

// 1. faceted growth: hexagonal facets at gentle undercool
{
  const page = await browser.newPage();
  await boot(page);
  await page.evaluate(() => {
    const a = window.__solidify.app;
    a.setParams({ scen: 0, heatIn: 0, facet: 1, delta: 0.05, aniMode: 6, noiseAmp: 0.004, latent: 1.6, coolRate: 0, alloyOn: 0 });
    a.setRain(0); a.clearMelt(0.65); a.seedCenter(); a.setView(0); a.setRun(true);
  });
  await grow(page, 30);
  await hideChrome(page);
  await page.screenshot({ path: `${OUT}/tool-facet.jpg`, type: "jpeg", quality: 85, clip: { x: 325, y: 125, width: 750, height: 750 } });
  console.log("shot tool-facet");
  await page.close();
}

// 2. share link: build on one page, open on a fresh one, compare state
{
  const page = await browser.newPage();
  await boot(page);
  const link = await page.evaluate(() => {
    const a = window.__solidify.app;
    a.setMaterial("mg"); a.setUndercool(0.83);
    a.setParams({ delta: 0.061, noiseAmp: 0.017, facet: 1 });
    a.setView(4);
    return a.shareLink();
  });
  console.log("LINK len", link.length);
  await page.close();
  const p2 = await browser.newPage();
  await boot(p2, link.slice(link.indexOf("#")));
  const got = await p2.evaluate(() => {
    const a = window.__solidify.app;
    const p = a.simParams();
    return { m: a.getMaterial(), u: +a.getUndercool().toFixed(2), v: a.getView(),
      delta: +p.delta.toFixed(3), noise: +p.noiseAmp.toFixed(3), facet: p.facet, ani: p.aniMode };
  });
  const ok = got.m === "mg" && got.u === 0.83 && got.v === 4 && got.delta === 0.061 && got.facet === 1;
  console.log("SHARE ROUND-TRIP", ok ? "OK" : "MISMATCH", JSON.stringify(got));
  await p2.close();
}

// 3. panel enlarge: texture rose big viewer
{
  const page = await browser.newPage();
  await boot(page);
  await page.evaluate(() => {
    const S = window.__solidify;
    S.app.setParams({ scen: 0, heatIn: 0, facet: 0, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.5, coolRate: 0.12, alloyOn: 0 });
    S.app.clearMelt(0.85); S.app.setRain(14); S.app.setView(1); S.app.setRun(true);
    S.analyze.setTextureOn(true);
  });
  await grow(page, 14);
  const state = await page.evaluate(() => {
    document.querySelector("#texPanel .zoomBtn").click();
    return { big: !!document.querySelector("#app > div[style*='fixed']") };
  });
  await grow(page, 4);
  console.log("ENLARGE opened:", JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/tool-bigrose.png` });
  await page.close();
}

// 4. specimen tilt on a grown dendrite
{
  const page = await browser.newPage();
  await boot(page);
  await grow(page, 22);
  await page.evaluate(() => { window.__solidify.app.setTilt(true); window.__solidify.app.setView(1); });
  await grow(page, 3);
  await hideChrome(page);
  await page.screenshot({ path: `${OUT}/tool-tilt.jpg`, type: "jpeg", quality: 85 });
  console.log("shot tool-tilt");
  await page.close();
}

// 5. transport speed multiplier: the button cycles ×1 → ×2 → ×4 and the melt
//    really advances faster (sublinear at ×4 is correct — heavier frames trip
//    the >=2-fence backpressure guard more often)
{
  const page = await browser.newPage();
  await boot(page);
  const cyc = await page.evaluate(() => {
    const a = window.__solidify.app;
    const btn = [...document.querySelectorAll("#transport button")].find(b => /^×/.test(b.textContent));
    const seen = [];
    for (let i = 0; i < 4; i++) { seen.push(a.getSpeedMult() + btn.textContent); btn.click(); }
    return seen.join(",");
  });
  const advance = async (m) => {
    await page.evaluate((mm) => {
      const a = window.__solidify.app;
      a.setParams({ scen: 0, heatIn: 0, coolRate: 0, alloyOn: 0 });
      a.setRain(0); a.clearMelt(0.7); a.seedCenter(); a.setSpeed(10); a.setRun(true);
      while (a.getSpeedMult() !== mm) a.cycleSpeedMult();
    }, m);
    const t0 = await page.evaluate(() => window.__solidify.app.simTimeNow());
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__solidify.tick(5)); await new Promise(r => setTimeout(r, 60)); }
    return (await page.evaluate(() => window.__solidify.app.simTimeNow())) - t0;
  };
  const d1 = await advance(1), d2 = await advance(2), d4 = await advance(4);
  const ok = cyc === "1×1,2×2,4×4,1×1" && d2 > d1 * 1.4 && d4 > d2 && d4 / d1 > 2.2;
  console.log("SPEEDMULT", ok ? "OK" : "FAIL", JSON.stringify({ cyc, d1: +d1.toFixed(4), d2: +d2.toFixed(4), d4: +d4.toFixed(4) }));
  if (!ok) process.exitCode = 1;
  await page.close();
}

await browser.close();
console.log("done");
