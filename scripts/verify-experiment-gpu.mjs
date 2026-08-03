// EXP-* (GPU half) — the comparator layer running REAL casts.
//
// v7.0 C1. The browser-free half (verify-experiment.mjs) proves the bench's
// doctrine on fake casts; this half proves the bench MEASURES. Three checks,
// cheap Kobayashi casts first so they run on page-load defaults, the
// QPF-polluting tip cast last:
//
//   EXP-REPRO-LIVE    a nucleation-LIVE cast is deterministic per seed. This
//                     is the cast the science page said could not exist: the
//                     interactive harness fires sites off frame-loop stats
//                     readbacks, so RNG-REPRO had to bypass nucleation with
//                     scatterSeeds. castCensus drives the model synchronously
//                     between fence-paced chunks — update → stepSync →
//                     readStats → observe — with the app's wall-clock
//                     nuc.observe held off for the duration.
//   EXP-SWEEP-CONTROLLED  a real two-arm × two-seed sweep of coolRate, read
//                     at matched solid fraction, rendered with the controlled
//                     variable named — and the v4.0 physics direction (faster
//                     cooling ⇒ finer) as the liveness of the whole bench.
//   EXP-TIP-ANCHOR    the bench anchored on a constant this arc does not
//                     touch: one castTip arm must reproduce the KR-1998
//                     solvability tip velocity V·d₀/D ≈ 0.017 — deliberately
//                     NOT K_MC, which C2/C3 are designed to move. castTip is
//                     an independent implementation of verify-quant.mjs's
//                     measurement; both asserting the same published number
//                     every build is the cross-check.
//
//   node scripts/verify-experiment-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";

const PORT = process.argv[3] ?? "5199";
const REF = Number(process.env.QPF_REF_VD0D || "0.017");   // KR 1998, Table II — same env override as verify-quant

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
page.on("console", m => {
  const t = m.type();
  if (t === "error") errors.push(m.text());
  if ((t === "warning" || t === "warn") && /binding size|minimum (buffer )?binding size/i.test(m.text()))
    errors.push("WARN " + m.text());
});

await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
await new Promise(r => setTimeout(r, 700));

// Kobayashi census-cast staging shared by the first two checks. RNG-REPRO's
// parameter set, at 256² for cheap replicates; undercool 0.10 keeps most of
// the charge ABOVE its activation undercooling at the pour, so the swept
// cooling rate — not the initial plunge — decides how many sites fire.
const CENSUS = {
  n: 256, inoculant: 1200, undercool: 0.10,
  params: {
    scen: 0, heatIn: 0, alloyOn: 0, twinProb: 0,
    noiseAmp: 0.01, aniMode: 4, delta: 0.04, latent: 1.4,
  },
  // maxChunks sized from measurement: the slow arm (coolRate 0.2) reached
  // fs 0.447 in 100 chunks on the first run, so 100 was a budget exit dressed
  // as a read — 160 lets both arms actually reach the matched state
  cast: { undercool: 0.10, fsRead: 0.5, chunk: 200, maxChunks: 160 },
};

await page.evaluate(async (C) => {
  const S = window.__solidify;
  S.app.setRun(false);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (S.sim().n !== C.n) S.app.setGrid(C.n);
  S.app.setInoculant(C.inoculant);
}, CENSUS);

// ---------------------------------------------------------------------------
// 1. EXP-REPRO-LIVE
{
  const cast = async (seed, coolRate) => await page.evaluate(async ([C, seed, coolRate]) => {
    const S = window.__solidify;
    S.setSeed(seed);                       // rewinds EVERY stream, incl. the host's own "scatter"
    Object.assign(S.sim().params, C.params, { coolRate });
    const r = await S.experiment.castCensus(C.cast);
    return {
      grainCount: r.grainCount,
      fracSolid: +r.fracSolid.toFixed(9),
      meanAreaPx: +r.meanAreaPx.toFixed(6),
      diams: r.diamsUm.map(d => +d.toFixed(6)),
      fired: r.fired, substeps: r.substeps, ctrl: r.ctrl,
    };
  }, [CENSUS, seed, coolRate]);

  const SEED = 0x51105d1f;
  const a1 = await cast(SEED, 0.6);
  const a2 = await cast(SEED, 0.6);      // same seed, from scratch — must be the same casting
  const b1 = await cast(0x0be5eed5, 0.6);
  const arr = (x, y) => !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]);
  // the cast has to have HAPPENED, with the nucleation model actually firing —
  // "nothing happened twice" reads as success without this (lessons.md)
  const grew = !!a1 && !!b1 && a1.fracSolid >= CENSUS.cast.fsRead && a1.fired > 50
    && a1.grainCount > 20 && b1.fired > 50 && b1.grainCount > 20;
  // the FULL per-grain census, element-wise, at RNG-REPRO's own precisions —
  // not just the aggregates: two runs can agree on how many grains formed
  // while disagreeing about every one of them
  const repeats = !!a1 && !!a2
    && a1.grainCount === a2.grainCount && a1.fracSolid === a2.fracSolid
    && a1.meanAreaPx === a2.meanAreaPx && a1.fired === a2.fired && a1.substeps === a2.substeps
    && arr(a1.diams, a2.diams);
  const differs = !!b1 && !arr(b1.diams, a1.diams);
  check("EXP-REPRO-LIVE", grew && repeats && differs, {
    castGrew: grew, sameSeedRepeats: repeats, differentSeedDiffers: differs,
    a1: { ...a1, diams: a1?.diams?.length }, b1: { ...b1, diams: b1?.diams?.length },
  });
}

// ---------------------------------------------------------------------------
// 2. EXP-SWEEP-CONTROLLED (+ EXP-DRAW smoke)
{
  const r = await page.evaluate(async (C) => {
    const S = window.__solidify;
    const spec = {
      name: "grain count at matched solid fraction",
      swept: "coolRate",
      values: [0.2, 0.8],
      seeds: [0x51105d1f, 0x0be5eed5],
      // the tolerance covers CHUNK OVERSHOOT only (a 200-substep chunk lands
      // ≤ ~0.01 past the 0.5 read point, measured 0.5002–0.5067) — a
      // budget-exhausted arm that never reached the matched state must land
      // OUTSIDE it and refuse, which is the first run of this gate caught
      // doing exactly (slow arm read at 0.447 under a lazy 0.08)
      controlled: { name: "solid fraction at read", tol: 0.03 },
    };
    const res = await S.experiment.runSweep(spec, async (value, seed) => {
      S.setSeed(seed);
      Object.assign(S.sim().params, C.params, { coolRate: value });
      const c = await S.experiment.castCensus(C.cast);
      return { y: c.grainCount, ctrl: c.ctrl };
    });
    const text = S.experiment.sweepText(res);
    // the painter, smoke-tested on a real canvas: the ok result and a refused
    // one must both actually put pixels down (the layout's content is gated
    // browser-free; this is the ctx path)
    const paint = (rr) => {
      const c = document.createElement("canvas");
      c.width = 252; c.height = 128;
      const ctx = c.getContext("2d");
      S.experiment.drawBand(ctx, rr, 252, 128);
      const d = ctx.getImageData(0, 0, 252, 128).data;
      // count pixels that differ from the backdrop AS PAINTED (bottom-right
      // corner — nothing draws there): comparing against the literal fill
      // colour counts every pixel, because the 0.88-alpha fill blends, and a
      // check that counts everything has checked nothing
      const bx = (127 * 252 + 251) * 4;
      const bg = [d[bx], d[bx + 1], d[bx + 2], d[bx + 3]];
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] !== bg[0] || d[i + 1] !== bg[1] || d[i + 2] !== bg[2] || d[i + 3] !== bg[3]) n++;
      return n;
    };
    const refused = { spec, rows: [], ctrlWidth: NaN, ok: false, refusal: "synthetic refusal for the painter" };
    return {
      ok: res.ok, refusal: res.refusal, ctrlWidth: res.ctrlWidth,
      rows: res.rows.map(x => ({
        value: x.value, mean: x.band.mean, lo: x.band.lo, hi: x.band.hi, width: x.band.width,
        ys: x.runs.map(q => q.y), ctrls: x.runs.map(q => +q.ctrl.toFixed(4)),
      })),
      text, painted: paint(res), paintedRefusal: paint(refused),
    };
  }, CENSUS);

  const slow = r.rows[0], fast = r.rows[1];
  const live = r.ok && slow.ys.every(y => y > 20) && fast.ys.every(y => y > 20);
  // attainment: every run must actually REACH the declared read point. castCensus
  // returns ctrl = NaN on a budget exit now, which runSweep refuses — this
  // clause additionally pins the read point itself, so the declared 0.5 cannot
  // silently drift in the cast config without this gate noticing
  const attained = r.rows.every(x => x.ctrls.every(c => c >= CENSUS.cast.fsRead));
  // the replicate axis must be alive: seeds have to matter somewhere, or the
  // band machinery is decorating a constant
  const bandLive = r.rows.some(x => x.width > 0);
  // v4.0's asserted physics, direction only: faster cooling ⇒ more grains
  const direction = fast.mean > slow.mean;
  const rendered = r.text.includes("controlled solid fraction at read")
    && !/REFUSED/.test(r.text) && r.painted > 100 && r.paintedRefusal > 100;
  check("EXP-SWEEP-CONTROLLED", live && attained && bandLive && direction && rendered, {
    ok: r.ok, attained, refusal: r.refusal, ctrlWidth: +r.ctrlWidth.toFixed(4),
    rows: r.rows, painted: r.painted, paintedRefusal: r.paintedRefusal,
  });
  console.log("EXP-SWEEP-TEXT\n" + r.text);
}

// ---------------------------------------------------------------------------
// 3. EXP-TIP-ANCHOR — last, because castTip re-stages the params for the
// dimensionless QPF benchmark and nothing after it here needs Kobayashi back.
{
  const r = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setRun(false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (S.sim().n !== 1024) S.app.setGrid(1024);
    S.app.setInoculant(0);
    return await S.experiment.castTip({ lambda: 2.4 });
  });
  const relErr = Math.abs(r.y - REF) / REF;
  // same anchor and tolerance as QPF-TIP-KR; the plateau and the achieved
  // ℓ_D-travel are the matched-state witnesses — without them a transient
  // could sit inside the tolerance by luck. The plateau band is measured, not
  // aspirational: at 8 ℓ_D a 2D dendrite is still closing on its steady state
  // from the fast side, and this arm measures vW0/vMid = 0.9416 while landing
  // 1.3 % off the published number — the first cut of this gate demanded
  // |plateau − 1| < 0.05 (a tolerance written before measuring, the exact
  // Phase-Q lesson) and failed its own honest arm. QPF-CONVERGE's real
  // assertion is arms IN STEP with each other; a single arm gets the band a
  // true seed transient sits far outside (first-third fits read ~0.8).
  const ok = Number.isFinite(r.y) && relErr < 0.15
    && r.plateau > 0.9 && r.plateau < 1.02
    && r.ctrl > 5 && r.ctrl < 11
    && r.samples > 10;
  check("EXP-TIP-ANCHOR", ok, {
    Vd0overD: +r.y.toFixed(5), ref: REF, relErr: +relErr.toFixed(3),
    plateau: r.plateau, travelInDiffusionLengths: +r.ctrl.toFixed(2),
    samples: r.samples, tipX: +r.tipX.toFixed(3),
  });
}

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
