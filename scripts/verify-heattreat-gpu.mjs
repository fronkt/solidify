// HT GPU gates — grain-boundary migration, measured rather than assumed.
//
// The arithmetic half of Phase H is checked without a browser in
// verify-heattreat.mjs. This is the half that needs a real GPU, and its job is
// mostly to catch the ways a Monte Carlo Potts pass can look completely right
// and be completely wrong:
//
//   MC-COHERENCE          a sweep must not invent an id, delete one, or leave
//                         `dir` moved. `dir` indexes the STATE ping-pong too, and
//                         this pass never writes state — so an odd dispatch count
//                         would pair a current state field with a stale grain
//                         field, which renders as nothing visible at all.
//   MC-RNG-DECORRELATION  the sweep that catches the trap this whole pass shape
//                         exists to avoid. `queue.writeBuffer` is ordered against
//                         `submit()`, not interleaved with dispatches, so many
//                         sweeps in one command buffer would share one salt and
//                         freeze the dynamics in a way that looks exactly like
//                         lattice pinning. Consecutive sweeps must flip DIFFERENT
//                         cells.
//   GG-MASK               liquid, mould and sub-threshold cells are never touched.
//   GG-EXPONENT           **measures m and K_MC** in D^m - D0^m = K_MC*S. It does
//                         not assume m = 2: ideal curvature-driven growth is
//                         parabolic, Monte Carlo Potts is not, and assuming
//                         otherwise costs a 4.8x error in the sweep budget.
//   GG-STAGNATION         flips per boundary cell must not decay to zero, which
//                         is what a pinned lattice does while looking finished.
//
//   node scripts/verify-heattreat-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

// The constants under test, loaded from the module that ships them rather than
// retyped here - a test that re-implements the thing it is testing proves nothing.
const viteServer = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const HT = await viteServer.ssrLoadModule("/src/heattreat.ts");
const { M_MODEL, K_MC } = HT;

const PORT = process.argv[3] ?? "5199";
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const check = (name, ok, detail) =>
  console.log(name, ok ? "OK" : FAIL(), detail === undefined ? "" : JSON.stringify(detail));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1200, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => {
  const t = m.type();
  if (t === "error") errors.push(m.text());
  // ALL warnings, not just the binding-size one. An r8uint storage texture is a
  // validation failure Chrome reports on the warning channel, and a filter tuned
  // to one known phrase let it through as "zero flips, no errors" - which cost a
  // debugging round. The lesson from v5.0 stands: make the channel loud.
  // Loud by default: an r8uint storage texture is a validation failure Chrome
  // reports on the warning channel, and a filter tuned to one known phrase let it
  // through as "zero flips, no errors", which cost a debugging round. Two
  // warnings are named and ignored because they are environmental, not ours.
  const BENIGN = /powerPreference option is currently ignored|goatcounter: not counting/;
  if ((t === "warning" || t === "warn") && !BENIGN.test(m.text())) errors.push("WARN " + m.text());
});

await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
await new Promise(r => setTimeout(r, 700));

// A deterministic polycrystal to anneal: quench a seeded melt hard and drive it
// to full solid through stepSync, so every run starts from the same amount of
// physics rather than from however many frames happened to land.
await page.evaluate(async () => {
  const S = window.__solidify;
  S.app.setRun(false);
  const sim = S.sim();
  window.__ht = {
    async cast(seeds = 1600, n = 512) {
      S.app.setGrid(n);
      await new Promise(r => setTimeout(r, 400));
      const s = S.sim();
      Object.assign(s.params, {
        scen: 0, heatIn: 0, coolRate: 0.6, alloyOn: 0, twinProb: 0,
        noiseAmp: 0.01, aniMode: 4, delta: 0.04, latent: 1.4,
      });
      s.reset(1 - 0.9);
      for (let i = 0; i < seeds; i++) {
        s.addSeed(Math.random() * s.n, Math.random() * s.n, 2.5, Math.random() * Math.PI * 2);
      }
      // drain the seed queue before growing: submit() stamps at most MAX_SEEDS
      // per command buffer, and a seed stamped into half-frozen melt is a
      // different experiment from one stamped into the pour
      for (let i = 0; i < 12; i++) await s.stepSync(0);
      // grow to essentially full solid
      for (let k = 0; k < 60; k++) {
        await s.stepSync(120);
        const st = await window.__ht.stats();
        if (st && st.fracSolid > 0.985) break;
      }
      return await window.__ht.stats();
    },
    grain: async () => Array.from((await S.sim().readGrainRows(0, S.sim().n)) ?? []),
    // readStats() returns null while another read is in flight, and the app's own
    // 4 Hz panel poll races every call from here. Retry rather than propagate a
    // null that would read as "the measurement failed".
    stats: async () => {
      for (let i = 0; i < 40; i++) {
        const st = await S.sim().readStats();
        if (st) return st;
        await new Promise(r => setTimeout(r, 25));
      }
      return null;
    },
  };
  return sim.n;
});

const cast0 = await page.evaluate(async () => {
  const st = await window.__ht.cast();
  const s = window.__solidify.sim();
  return { fs: st?.fracSolid ?? 0, grains: st?.grainCount ?? 0, n: s.n, dir: s.dir };
});
console.log("CAST", JSON.stringify({ ...cast0, fs: +cast0.fs.toFixed(4) }));
if (cast0.grains < 20) { console.log("cast produced too few grains to anneal"); FAIL(); }

// ---------------------------------------------------------------------------
// MC-COHERENCE + GG-MASK — the invariants, asserted exactly.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s = S.sim();
    const before = await s.readGrainRows(0, s.n);
    const stateBefore = await s.readRows(0, s.n);
    const dirBefore = s.dir;
    await s.anneal(8);
    const after = await s.readGrainRows(0, s.n);
    const stateAfter = await s.readRows(0, s.n);

    const idsBefore = new Set(before);
    let invented = 0, zeroed = 0, changed = 0, movedLiquid = 0, movedMould = 0;
    for (let i = 0; i < before.length; i++) {
      const a = before[i], b = after[i];
      if (a !== b) {
        changed++;
        if (b === 0) zeroed++;
        if (!idsBefore.has(b)) invented++;
        // state layout is (phi, T, c, age); liquid or mould must never move
        const phi = stateBefore[i * 4], age = stateBefore[i * 4 + 3];
        if (phi < 0.5) movedLiquid++;
        if (age < -0.5) movedMould++;
      }
    }
    let stateDiff = 0;
    for (let i = 0; i < stateBefore.length; i++) {
      if (stateBefore[i] !== stateAfter[i]) { stateDiff++; if (stateDiff > 4) break; }
    }
    return {
      changed, invented, zeroed, movedLiquid, movedMould, stateDiff,
      dirBefore, dirAfter: s.dir, cells: before.length,
    };
  });
  // the pass must DO something, and must do only what it is allowed to
  const ok = out.changed > 0 && out.invented === 0 && out.zeroed === 0
    && out.movedLiquid === 0 && out.movedMould === 0
    && out.stateDiff === 0 && out.dirBefore === out.dirAfter;
  check("MC-COHERENCE", ok, { ...out, changedPct: +((out.changed / out.cells) * 100).toFixed(3) });
}

// ---------------------------------------------------------------------------
// MC-RNG-DECORRELATION — the trap.
//
// If every sweep shared a salt, sweep k and sweep k+1 would propose the same
// move at every cell and the flip set would repeat. Assert three things: sweeps
// flip cells at all, consecutive sweeps flip DIFFERENT sets, and the overlap is
// nowhere near total.
{
  const out = await page.evaluate(async () => {
    const s = window.__solidify.sim();
    const snap = async () => await s.readGrainRows(0, s.n);
    const a = await snap();
    await s.anneal(1);
    const b = await snap();
    await s.anneal(1);
    const c = await snap();
    const set1 = [], set2 = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) set1.push(i);
      if (b[i] !== c[i]) set2.push(i);
    }
    const s2 = new Set(set2);
    let overlap = 0;
    for (const i of set1) if (s2.has(i)) overlap++;
    return { flips1: set1.length, flips2: set2.length, overlap };
  });
  const frac = out.flips1 > 0 ? out.overlap / out.flips1 : 1;
  // identical streams would give flips2 == flips1 with near-total overlap
  const ok = out.flips1 > 0 && out.flips2 > 0 && frac < 0.9;
  check("MC-RNG-DECORRELATION", ok, { ...out, overlapFrac: +frac.toFixed(3) });
}

// ---------------------------------------------------------------------------
// GG-EXPONENT — measure m and K_MC. This is the milestone's whole point.
//
// heattreat.ts consumes both, and neither may be assumed. The fit is over mean
// grain AREA from the census (grainCount is the reliable readout: mean area =
// solid cells / grains), converted to an equivalent-circle diameter in CELLS so
// K_MC is a pure lattice property with no length anchor in it.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s = S.sim();
    const pts = [];
    const measure = async (sweeps) => {
      const st = await window.__ht.stats();
      // equivalent-circle diameter, in cells
      const area = (st.fracSolid * s.n * s.n) / Math.max(1, st.grainCount);
      pts.push({ S: sweeps, d: 2 * Math.sqrt(area / Math.PI), grains: st.grainCount });
    };
    await measure(0);
    let done = 0;
    // A DECADE of lever arm, not a third of one. Fitting an exponent over a
    // 1.36x change in d is ill-conditioned - the r2 landscape is flat and the
    // best m wanders between casts and rails at the scan bounds, which is exactly
    // what the first version of this test did. Starting fine (~1600 grains) and
    // coarsening to ~60 gives d a ~4x range and pins m.
    for (const target of [60, 140, 300, 600, 1100, 1900, 3200, 5200, 8000, 11500, 16000]) {
      await s.anneal(target - done);
      done = target;
      await measure(done);
    }
    return pts;
  });
  console.log("GG-LADDER", JSON.stringify(out.map(p => ({ S: p.S, d: +p.d.toFixed(2), grains: p.grains }))));

  // Fit  d^m - d0^m = K*S  with the intercept PINNED to the measured d0, over
  // the asymptotic regime only.
  //
  // The previous version let the intercept float, on the theory that it would
  // absorb the early transient. It absorbed far more than that: across three
  // casts it returned m = 2.41, 3.41 and 2.905 with r2 > 0.99 every time and
  // BANDS THAT DID NOT OVERLAP, while the fitted d0 wandered 3.9 -> 13.6 against
  // a measured 14.5. Three free parameters on eight points is degenerate - the
  // intercept and the exponent trade off against each other, so a high r2 meant
  // nothing at all. That is the same lesson as v5.0's four wrong comparisons in a
  // new costume: the arithmetic was right and the estimator was wrong.
  //
  // The physics pins the intercept - at S = 0 the grain size IS d0 - which
  // removes the degeneracy. What is left is a genuine early transient (an as-cast
  // boundary network smoothing its own solidification roughness before any grain
  // can vanish), and the honest way to handle that is to fit where the law is
  // supposed to hold: d comfortably larger than d0, and the specimen still a
  // polycrystal.
  // Two exclusions, both stated rather than silent.
  //
  // (1) The ladder SATURATES at the end: d stops moving while sweeps keep being
  //     spent, because at ~70 grains in a 512 domain there are only ~8 across and
  //     the structure has run out of room. That is not the growth law failing, it
  //     is the specimen ending - the same wall domainLimitUm() refuses schedules
  //     against. 100 grains is ~10 across, comfortably inside stereological sanity.
  // (2) The first rungs are an early transient, where an as-cast boundary network
  //     is smoothing its own solidification roughness and no grain has vanished
  //     yet. The law is fitted where it is supposed to hold: d well clear of d0.
  const FLOOR = 100;
  const d0 = out[0].d;
  const saturated = out.filter(p => p.grains < FLOOR);
  if (saturated.length) {
    console.log("GG-SATURATED  (excluded — the specimen ran out of grains)",
      JSON.stringify(saturated.map(p => ({ S: p.S, d: +p.d.toFixed(1), grains: p.grains }))));
  }
  const use = out.filter(p => p.grains >= FLOOR && p.d >= 1.5 * d0 && p.S > 0);
  let best = null;
  for (let m = 1.0; m <= 4.5; m += 0.005) {
    const y0 = Math.pow(d0, m);
    let sxy = 0, sxx = 0;
    for (const p of use) { const y = Math.pow(p.d, m) - y0; sxy += p.S * y; sxx += p.S * p.S; }
    const K = sxy / sxx;
    // through-origin fit: residual against the law, not against the mean
    let ssRes = 0, ssTot = 0;
    for (const p of use) {
      const y = Math.pow(p.d, m) - y0;
      ssRes += (y - K * p.S) ** 2;
      ssTot += y * y;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    if (K > 0 && (!best || r2 > best.r2)) best = { m: +m.toFixed(3), K, r2, d0eff: d0 };
  }

  // How well-determined is m? The ladder spans a 1.37x change in d, so exponents
  // that differ by a few tenths are not wildly separated in residual. Report the
  // band of m whose fit is within 0.0005 r2 of the best, so the constant carries
  // its own uncertainty instead of a spurious three decimals.
  let lo = best.m, hi = best.m;
  for (let m = 1.0; m <= 4.5; m += 0.005) {
    const y0 = Math.pow(d0, m);
    let sxy = 0, sxx = 0;
    for (const p of use) { const y = Math.pow(p.d, m) - y0; sxy += p.S * y; sxx += p.S * p.S; }
    const K = sxy / sxx;
    let ssRes = 0, ssTot = 0;
    for (const p of use) { const y = Math.pow(p.d, m) - y0; ssRes += (y - K * p.S) ** 2; ssTot += y * y; }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    if (K > 0 && r2 >= best.r2 - 0.0005) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  }
  best.band = [+lo.toFixed(2), +hi.toFixed(2)];

  const ok = best !== null && best.r2 >= 0.97 && best.m > 1.05 && best.m < 4.45 && best.K > 0;
  check("GG-EXPONENT", ok, {
    m: best?.m, K_MC: best ? +best.K.toExponential(4) : null, r2: best ? +best.r2.toFixed(4) : null,
    mBand: best?.band, d0measured: +out[0].d.toFixed(2),
    d0pinned: +d0.toFixed(2), points: use.length,
    dRange: [+out[0].d.toFixed(1), +out[out.length - 1].d.toFixed(1)],
  });
  // K is measured at the SHIPPED exponent, not at the free-fit one.
  //
  // K carries units of cells^m per sweep, so it is violently coupled to m: a
  // free-fit m that wanders 2.38 -> 2.61 across casts drags K 3.8 -> 9.4 with it,
  // which is not three disagreeing measurements of K but one measurement of a
  // different quantity each time. Pin m, and K becomes a single stable number.
  // The free fit's job is then only to CHECK that its band still contains the
  // shipped exponent - which is the reproducible assertion.
  {
    const y0 = Math.pow(d0, M_MODEL);
    let sxy = 0, sxx = 0;
    for (const p of use) { const y = Math.pow(p.d, M_MODEL) - y0; sxy += p.S * y; sxx += p.S * p.S; }
    const kAt = sxy / sxx;
    let ssRes = 0, ssTot = 0;
    for (const p of use) {
      const y = Math.pow(p.d, M_MODEL) - y0;
      ssRes += (y - kAt * p.S) ** 2; ssTot += y * y;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const brackets = best.band[0] <= M_MODEL && M_MODEL <= best.band[1];
    // The shipped constant is now self-enforcing: change the pass and this fails.
    const drift = Math.abs(kAt / K_MC - 1);
    check("GG-KMC", brackets && r2 > 0.99 && kAt > 0 && drift <= HT.K_MC_TOL, {
      shippedM: M_MODEL, freeFitBand: best.band, bandContainsShippedM: brackets,
      K_MC_at_shipped_m: +kAt.toFixed(4), shippedK: K_MC,
      ratioToShipped: +(kAt / K_MC).toFixed(3), driftTol: HT.K_MC_TOL, r2: +r2.toFixed(5),
    });
  }
}

// ---------------------------------------------------------------------------
// GG-STAGNATION — a pinned lattice looks exactly like a finished anneal.
//
// Flips per boundary cell must not decay to zero over the run. Measured as the
// flip count of one sweep early vs one sweep late.
{
  const out = await page.evaluate(async () => {
    const s = window.__solidify.sim();
    const one = async () => {
      const a = await s.readGrainRows(0, s.n);
      await s.anneal(1);
      const b = await s.readGrainRows(0, s.n);
      let f = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) f++;
      return f;
    };
    const late = await one();
    await s.anneal(400);
    const later = await one();
    const st = await window.__ht.stats();
    return { late, later, grains: st?.grainCount ?? 0 };
  });
  // fewer flips later is correct (less boundary), zero is pinning
  const ok = out.later > 0 && out.late > 0;
  check("GG-STAGNATION", ok, out);
}

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
await viteServer.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
