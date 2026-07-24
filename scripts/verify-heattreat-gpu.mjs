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
// The H2b half runs the same doctrine in the volume: MC3-COHERENCE /
// MC3-RNG-DECORRELATION / GG3-EXPONENT / GG3-KMC / GG3-STAGNATION measure the
// 26-neighbour 8-colour pass and its own (M_MODEL_3D, K_MC_3D) pair, and
// HT3-PANEL drives a treatment end-to-end at 128³ — where the domain-limit
// refusal is the COMMON case, and is asserted as such. H3 adds
// HT-TWIN-SIGMA3: spawned annealing twins must be exact Σ3 crystallography
// against their real neighbours and must survive further annealing (the
// cusp), while HT3-PANEL's aluminium run must not move the twin allocator.
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
  // The fit window is FIXED IN SWEEPS, and that is the load-bearing decision.
  //
  // The first version selected points by measured quantities - grains >= 100
  // (saturation) and d >= 1.5 d0 (early transient) - and that made the POINT SET
  // itself stochastic: on the suite's second run a cast landed 102 grains at the
  // S = 5200 rung, one grain-count over the floor, and a saturation-shoulder
  // point entered the fit. The exponent bent 2.85 -> 3.61 and K at the shipped m
  // fell 17 % - a FAIL produced entirely by which points got fitted, not by any
  // change in the pass. A threshold keyed to a stochastic measurement is a knife
  // edge; three runs cut it three ways. So the window is [300, 3200] sweeps -
  // the same regime every run, chosen once from the measured ladder shape:
  //
  //   S = 300 is ~1.5 d0 (past the early transient, where an as-cast boundary
  //   network is still smoothing its own solidification roughness), and
  //   S = 3200 keeps ~120 grains in a 512 domain (~11 across), comfortably
  //   clear of the shoulder where the specimen starts running out of room.
  //
  // The rungs beyond the window still run and still print: saturation is the
  // wall domainLimitUm() refuses schedules against, demonstrated empirically.
  const FLOOR = 100;
  const S_FIT = [300, 3200];
  const d0 = out[0].d;
  const saturated = out.filter(p => p.grains < FLOOR);
  if (saturated.length) {
    console.log("GG-SATURATED  (excluded — the specimen ran out of grains)",
      JSON.stringify(saturated.map(p => ({ S: p.S, d: +p.d.toFixed(1), grains: p.grains }))));
  }
  const use = out.filter(p => p.S >= S_FIT[0] && p.S <= S_FIT[1]);
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
  // free-fit m that wanders 2.38 -> 2.85 across casts drags K 3.8 -> 21.8 with
  // it, which is not disagreeing measurements of K but one measurement of a
  // different quantity each time. Pin m, and K becomes a single stable number;
  // the free fit is printed alongside with a wide sanity rail (see below for
  // why its band cannot be a gate).
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
    // Band-containment is REPORTED, not gated — and that is a measured decision,
    // not a relaxation hidden in a diff. The first full-suite run measured a
    // fifth independent cast at band [2.65, 3.05] — excluding the shipped 2.44 —
    // while K at the shipped exponent moved 8 % and the fit at the shipped
    // exponent held r² 0.996. The band is an r²-window statistic WITHIN one
    // cast, and cast-to-cast variance of a 5-point exponent fit exceeds it, so
    // containment cannot be a reproducible assertion. What is reproducible, and
    // is the gate: the law fitted AT the shipped exponent stays tight and K
    // stays inside the drift tolerance — a pass whose kinetics actually changed
    // breaks both long before any band test would have said so. The free fit
    // keeps a wide sanity rail: a Potts pass measuring ideal-parabolic m ≈ 2 or
    // m > 3.5 is a different implementation, whatever K says.
    const drift = Math.abs(kAt / K_MC - 1);
    const mSane = best.m >= 2.0 && best.m <= 3.5;
    check("GG-KMC", mSane && r2 > 0.99 && kAt > 0 && drift <= HT.K_MC_TOL, {
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

// ---------------------------------------------------------------------------
// HT-PANEL — the panel drives a treatment end-to-end, through the DOM, the way
// a user would: open it, dial a schedule, run, read the report card. This is
// the check with teeth for the whole budget map — schedule → Arrhenius
// integral → law endpoint → sweepsFor → Potts pass → the CENSUS must land near
// the endpoint the material's own law predicted. It also asserts the
// solver-paused interlock (setRun(true) refused mid-treatment) and the
// incipient-melting refusal straight off the temperature dial.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setMaterial("al");                     // a material with an si block
    await window.__ht.cast(1600, 512);           // fresh fine cast: room to coarsen
    S.app.startHeat();
    const panel = document.getElementById("heattreat");
    if (!panel) return { opened: false };
    // open() takes its own fresh census; wait for the run button to arm
    const btn = document.getElementById("htRun");
    const note = () => document.getElementById("htNote").textContent;
    for (let i = 0; i < 40 && btn.disabled; i++) await new Promise(r => setTimeout(r, 100));
    if (btn.disabled) return { opened: true, armed: false, note: note() };

    const dials = panel.querySelectorAll('input[type="range"]');
    const set = (i, v) => {
      dials[i].value = String(v);
      dials[i].dispatchEvent(new Event("input", { bubbles: true }));
    };
    const t0 = parseFloat(dials[0].value);       // the 0.85 T_m default

    // the incipient-melting refusal, from the dial like a user would find it
    set(0, parseFloat(dials[0].max));
    const refuse = { note: note().slice(0, 120), disabled: btn.disabled };
    set(0, t0);

    // a 12 h full anneal — long enough that the run spans the interlock probe
    set(1, 720);
    const planNote = note();
    const dPred = parseFloat((planNote.match(/→\s*([\d.]+)\s*µm/) ?? [])[1] ?? "NaN");

    const before = await window.__ht.stats();
    btn.click();
    // run() measures first, then flags busy — wait for it rather than sleep
    for (let i = 0; i < 100 && !S.heat.busy; i++) await new Promise(r => setTimeout(r, 50));
    const busyDuring = S.heat.busy;
    S.app.setRun(true);                          // the interlock must refuse this
    const runDuring = S.app.isRunning();
    for (let i = 0; i < 1200 && S.heat.busy; i++) await new Promise(r => setTimeout(r, 100));
    const stillBusy = S.heat.busy;
    const after = await window.__ht.stats();
    const report = document.getElementById("htReport").textContent;
    S.heat.close();

    const um = S.app.getUmPerCell();
    const dOf = st => 2 * Math.sqrt(st.meanAreaPx / Math.PI) * um;
    return {
      opened: true, armed: true, refuse, busyDuring, runDuring, stillBusy,
      grainsBefore: before.grainCount, grainsAfter: after.grainCount,
      dBefore: +dOf(before).toFixed(1), dAfter: +dOf(after).toFixed(1), dPred,
      ratioToLaw: +(dOf(after) / dPred).toFixed(3),
      report: report.replace(/\s+/g, " ").slice(0, 220),
    };
  });
  const ok = out.opened && out.armed
    && out.refuse.disabled && /refused/.test(out.refuse.note)
    && out.busyDuring && !out.runDuring && !out.stillBusy
    && out.grainsAfter < out.grainsBefore * 0.8
    && out.ratioToLaw > 0.65 && out.ratioToLaw < 1.35
    && /before/.test(out.report) && /after/.test(out.report) && /law endpoint/.test(out.report);
  check("HT-PANEL", ok, out);
}

// ===========================================================================
// H2b — the volume. Same physics doctrine, different lattice: 26 neighbours,
// 8 sublattice colours, and a domain only 125 µm across at 128³ — which makes
// the domain-limit refusal the COMMON case in 3D, and the panel test asserts
// it as such. The model constants are measured HERE (GG3-EXPONENT / GG3-KMC),
// separately from 2D, because the neighbourhood, the colouring and the
// lattice-pinning geometry all differ.

await page.evaluate(() => window.__solidify.app.setMode("3d"));
await page.waitForFunction("window.__solidify.mode() === '3d'", { timeout: 30000 });
await page.evaluate(() => window.__solidify.app.setGrid3(128));
await page.waitForFunction("window.__solidify.sim3d()?.n === 128", { timeout: 40000 });
console.log("ENTERED 3D at 128³");

await page.evaluate(() => {
  const S = window.__solidify;
  window.__ht3 = {
    stats: async () => {
      for (let i = 0; i < 40; i++) {
        const st = await S.sim3d().readStats();
        if (st) return st;
        await new Promise(r => setTimeout(r, 25));
      }
      return null;
    },
    // equivalent-SPHERE diameter in cells, from the same census the panel reads
    dCells: st => Math.cbrt((6 * st.meanVolVox) / Math.PI),
    async cast3(seeds = 2600, pPore = 0) {
      S.app.setRun(false);
      const s3 = S.sim3d();
      Object.assign(s3.params, {
        scen: 0, heatIn: 0, coolRate: 0.5, alloyOn: 0, twinProb: 0,
        pPore, noiseAmp: 0.01, aniMode3: 1, facet: 0,
      });
      s3.reset(1 - 0.9);
      for (let i = 0; i < seeds; i++)
        s3.addSeed3D(Math.random() * s3.n, Math.random() * s3.n, Math.random() * s3.n, 2.5);
      // drain the seed queue first: submit() stamps at most MAX_SEEDS3 = 128
      // per command buffer, and a seed stamped into half-frozen melt is a
      // different experiment from one stamped into the pour
      for (let i = 0; i < Math.ceil(seeds / 128) + 2; i++) await s3.stepSync(0);
      // freeze FULLY — an 80 %-solid cast leaves liquid films between grains
      // that pin the Potts boundaries and contaminate the calibration. Quench
      // pulses hurry the tail (the v3.0 harness lesson: quench hard rather
      // than wait out cooling that recalescence keeps un-doing).
      for (let k = 0; k < 250; k++) {
        await s3.stepSync(76);
        if (k % 10 === 9) s3.quench(0.15);
        const st = await window.__ht3.stats();
        if (st && st.fracSolid > 0.985) break;
      }
      return await window.__ht3.stats();
    },
  };
});

const cast3 = await page.evaluate(async () => {
  const st = await window.__ht3.cast3(2600, 0.85);
  return st ? { fs: +st.fracSolid.toFixed(4), grains: st.grainCount, pore: +st.poreFrac.toFixed(4) } : null;
});
console.log("CAST3", JSON.stringify(cast3));
if (!cast3 || cast3.grains < 100) { console.log("3D cast produced too few grains to anneal"); FAIL(); }

// ---------------------------------------------------------------------------
// MC3-COHERENCE — the invariants, asserted against full volume readbacks: the
// pass must move boundaries and must not invent an id, heal a pore, touch
// liquid, move φ, or leave `dir` flipped (8 colours is even by construction,
// and must stay so).
{
  const out = await page.evaluate(async () => {
    const s3 = window.__solidify.sim3d();
    const PORE = 4095;   // MAX_GRAINS3 - 1, the reserved shrinkage-pore id
    const before = await s3.readGrainVolume();
    const phiB = await s3.readPhiVolume();
    const dirBefore = s3.dir;
    await s3.anneal(4);
    const after = await s3.readGrainVolume();
    const phiA = await s3.readPhiVolume();
    const ids = new Set(before);
    let changed = 0, invented = 0, zeroed = 0, movedLiquid = 0, movedPore = 0, poreVox = 0;
    for (let i = 0; i < before.length; i++) {
      const a = before[i], b = after[i];
      if (a === PORE) poreVox++;
      if (a !== b) {
        changed++;
        if (b === 0) zeroed++;
        if (!ids.has(b)) invented++;
        if (phiB[i] < 0.5) movedLiquid++;
        if (a === PORE) movedPore++;
      }
    }
    let phiDiff = 0;
    for (let i = 0; i < phiB.length; i++)
      if (phiB[i] !== phiA[i]) { phiDiff++; if (phiDiff > 4) break; }
    return {
      changed, invented, zeroed, movedLiquid, movedPore, poreVox, phiDiff,
      dirBefore, dirAfter: s3.dir, cells: before.length,
    };
  });
  const ok = out.changed > 0 && out.invented === 0 && out.zeroed === 0
    && out.movedLiquid === 0 && out.movedPore === 0
    && out.phiDiff === 0 && out.dirBefore === out.dirAfter;
  check("MC3-COHERENCE", ok, { ...out, changedPct: +((out.changed / out.cells) * 100).toFixed(3) });
}

// ---------------------------------------------------------------------------
// MC3-RNG-DECORRELATION — same trap, bigger lattice: one submit per sweep or
// every sweep shares its random numbers and the dynamics freeze.
{
  const out = await page.evaluate(async () => {
    const s3 = window.__solidify.sim3d();
    const a = await s3.readGrainVolume();
    await s3.anneal(1);
    const b = await s3.readGrainVolume();
    await s3.anneal(1);
    const c = await s3.readGrainVolume();
    const set1 = [], set2 = new Set();
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) set1.push(i);
      if (b[i] !== c[i]) set2.add(i);
    }
    let overlap = 0;
    for (const i of set1) if (set2.has(i)) overlap++;
    return { flips1: set1.length, flips2: set2.size, overlap };
  });
  const frac = out.flips1 > 0 ? out.overlap / out.flips1 : 1;
  const ok = out.flips1 > 0 && out.flips2 > 0 && frac < 0.9;
  check("MC3-RNG-DECORRELATION", ok, { ...out, overlapFrac: +frac.toFixed(3) });
}

// ---------------------------------------------------------------------------
// GG3-EXPONENT / GG3-KMC — measure the volume's m and K_MC. The estimator is
// the one the 2D gate earned through two wrong versions and a flaky point set:
// intercept PINNED to the measured d0 (at S = 0 the grain size IS d0), the
// early transient excluded by a fit window FIXED IN SWEEPS, saturation rungs
// printed rather than silently dropped, and K measured at the SHIPPED
// exponent because its units are coupled to m.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s3 = S.sim3d();
    await window.__ht3.cast3(2600, 0);   // clean cast: no pores in the census
    const pts = [];
    const measure = async sweeps => {
      const st = await window.__ht3.stats();
      pts.push({ S: sweeps, d: window.__ht3.dCells(st), grains: st.grainCount });
    };
    await measure(0);
    let done = 0;
    for (const target of [15, 40, 90, 180, 320, 550, 900, 1400, 2000, 2800, 3800]) {
      await s3.anneal(target - done);
      done = target;
      await measure(done);
    }
    return pts;
  });
  console.log("GG3-LADDER", JSON.stringify(out.map(p => ({ S: p.S, d: +p.d.toFixed(2), grains: p.grains }))));

  // The fit window, fixed in sweeps — the knife-edge lesson from the 2D gate —
  // and chosen once from three measured ladders (probe, 2026-07-24). It is NOT
  // the 2D window's shape: at 128³ the domain limit sits at ~44 cells, so the
  // specimen's whole legal dial range is d ≈ 11 → 44 cells and the window
  // covers exactly that band. The lower bound clears the as-cast smoothing
  // transient (d ≳ 1.65·d0, same phenomenon 2D excludes); the upper bound is
  // the wall itself, INCLUDED on purpose: `domainLimitUm` allows treatments to
  // run to ~47 grains, so the calibration must be honest exactly as far as the
  // panel's dials can legally reach. The cost, measured across three casts:
  // the free-fit exponent alone is poorly determined over so short a lever
  // (2.25 / 1.89 / 2.77) while K at a pinned m is stable to ~2 % — which is
  // why the shipped constant is the PAIR, gated by K-drift and HT3-PANEL's
  // endpoint check rather than by exponent-band containment.
  const S_FIT3 = [550, 3800];
  const d0 = out[0].d;
  const wallD = 128 / Math.cbrt(25);   // the domainLimitUm geometry, in cells
  const atWall = out.filter(p => p.d > wallD * 0.95);
  if (atWall.length) {
    console.log("GG3-WALL  (rungs at the domain limit — inside the fit on purpose, see above)",
      JSON.stringify(atWall.map(p => ({ S: p.S, d: +p.d.toFixed(1), grains: p.grains }))));
  }
  const use = out.filter(p => p.S >= S_FIT3[0] && p.S <= S_FIT3[1]);
  const fitAt = m => {
    const y0 = Math.pow(d0, m);
    let sxy = 0, sxx = 0;
    for (const p of use) { const y = Math.pow(p.d, m) - y0; sxy += p.S * y; sxx += p.S * p.S; }
    const K = sxy / sxx;
    let ssRes = 0, ssTot = 0;
    for (const p of use) {
      const y = Math.pow(p.d, m) - y0;
      ssRes += (y - K * p.S) ** 2; ssTot += y * y;
    }
    return { K, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
  };
  let best = null;
  for (let m = 1.0; m <= 4.5; m += 0.005) {
    const f = fitAt(m);
    if (f.K > 0 && (!best || f.r2 > best.r2)) best = { m: +m.toFixed(3), ...f };
  }
  let lo = best.m, hi = best.m;
  for (let m = 1.0; m <= 4.5; m += 0.005) {
    const f = fitAt(m);
    if (f.K > 0 && f.r2 >= best.r2 - 0.0005) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  }
  best.band = [+lo.toFixed(2), +hi.toFixed(2)];

  const ok = best !== null && best.r2 >= 0.97 && best.m > 1.05 && best.m < 4.45 && best.K > 0;
  check("GG3-EXPONENT", ok, {
    m: best?.m, K_MC: best ? +best.K.toExponential(4) : null, r2: best ? +best.r2.toFixed(4) : null,
    mBand: best?.band, d0: +d0.toFixed(2), points: use.length,
    dRange: [+out[0].d.toFixed(1), +out[out.length - 1].d.toFixed(1)],
  });
  {
    const M3 = HT.M_MODEL_3D;
    const f = fitAt(M3);
    const drift = Math.abs(f.K / HT.K_MC_3D - 1);
    // the same gate shape as GG-KMC: the free fit is printed with a sanity
    // rail, and the assertion is the law fitted AT the shipped exponent plus
    // K-drift. The rail is [1.6, 3.2] rather than 2D's [2.0, 3.5] and the r²
    // floor 0.985 rather than 0.99 — both measured, not relaxed on a diff:
    // three probe casts free-fitted 1.89–2.77 and held r² 0.993–0.997 at the
    // shipped m, because the window deliberately spans to the domain wall
    // (see above) where the trajectory bends off the pure law.
    const mSane = best.m >= 1.6 && best.m <= 3.2;
    check("GG3-KMC", mSane && f.r2 > 0.985 && f.K > 0 && drift <= HT.K_MC_TOL_3D, {
      shippedM: M3, freeFitBand: best.band,
      K_MC_at_shipped_m: +f.K.toFixed(4), shippedK: HT.K_MC_3D,
      ratioToShipped: +(f.K / HT.K_MC_3D).toFixed(3), driftTol: HT.K_MC_TOL_3D, r2: +f.r2.toFixed(5),
    });
  }
}

// ---------------------------------------------------------------------------
// GG3-STAGNATION — 3D lattice pinning is harsher than 2D (that is why the
// neighbourhood is 26 and not 6); flips per sweep must not decay to zero.
{
  const out = await page.evaluate(async () => {
    const s3 = window.__solidify.sim3d();
    const one = async () => {
      const a = await s3.readGrainVolume();
      await s3.anneal(1);
      const b = await s3.readGrainVolume();
      let f = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) f++;
      return f;
    };
    const late = await one();
    await s3.anneal(200);
    const later = await one();
    const st = await window.__ht3.stats();
    return { late, later, grains: st?.grainCount ?? 0 };
  });
  const ok = out.later > 0 && out.late > 0;
  check("GG3-STAGNATION", ok, out);
}

// ---------------------------------------------------------------------------
// HT-TWIN-SIGMA3 — annealing twins are real crystallography or they are noise.
//
// Copper cast, plate-nucleation events interleaved with sweeps (the
// annealTwins shape): the allocator must move by exactly the stamped count,
// every surviving twin must sit in exact Σ3 registry with at least one of its
// neighbours — 60° about a ⟨111⟩ axis, checked CPU-side from the refreshed
// quaternion mirror against the actual adjacency in the grain volume — the
// survivors must be metallographically visible plates rather than single-cell
// debris, and they must SURVIVE further annealing rather than be eaten at the
// general-boundary rate (the cusp + Σ3-mobility physics, which two dead
// in-pass spawn mechanisms taught this file the hard way). (The zero-twin arm
// for aluminium lives in HT3-PANEL below, where canTreat is what blocks it.)
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setMaterial("cu");
    await window.__ht3.cast3(1500, 0);
    const s3 = S.sim3d();
    const ctr0 = await s3.readTwinCtr();
    // the annealTwins shape: plate events stamped before each sweep chunk, so
    // every plate faces annealing — survival is the cusp+mobility physics
    let spawned = 0, noSite = 0;
    for (let round = 0; round < 6; round++) {
      for (let e = 0; e < 8; e++) {
        const r = await s3.twinEvent();
        if (r === 1) spawned++;
        else if (r === 0) noSite++;
        else break;
      }
      await s3.anneal(50);
    }
    const ctr1 = await s3.readTwinCtr();

    const q = s3.quats;
    const n = s3.n;
    const vol = await s3.readGrainVolume();
    const isTwin = id => id > ctr1 && id <= ctr0;

    // survivors and their adjacent grains, one linear pass over the volume
    const adj = new Map();   // twin id -> Set of neighbour ids
    const touch = (a, b) => {
      if (isTwin(a) && b !== 0 && b !== 4095 && b !== a) {
        if (!adj.has(a)) adj.set(a, new Set());
        adj.get(a).add(b);
      }
    };
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n - 1; x++) {
          const i = (z * n + y) * n + x;
          const a = vol[i], b = vol[i + 1];
          if (a !== b) { touch(a, b); touch(b, a); }
        }

    const qmul = (a, b) => [
      a[3] * b[0] + b[3] * a[0] + (a[1] * b[2] - a[2] * b[1]),
      a[3] * b[1] + b[3] * a[1] + (a[2] * b[0] - a[0] * b[2]),
      a[3] * b[2] + b[3] * a[2] + (a[0] * b[1] - a[1] * b[0]),
      a[3] * b[3] - (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]),
    ];
    const qrotInv = (Q, v) => {
      const c = [-Q[0], -Q[1], -Q[2]];
      const t = [2 * (c[1] * v[2] - c[2] * v[1]), 2 * (c[2] * v[0] - c[0] * v[2]), 2 * (c[0] * v[1] - c[1] * v[0])];
      return [
        v[0] + Q[3] * t[0] + (c[1] * t[2] - c[2] * t[1]),
        v[1] + Q[3] * t[1] + (c[2] * t[0] - c[0] * t[2]),
        v[2] + Q[3] * t[2] + (c[0] * t[1] - c[1] * t[0]),
      ];
    };
    const sigma3 = (idA, idB) => {
      const qa = Array.from(q.slice(idA * 4, idA * 4 + 4));
      const qb = Array.from(q.slice(idB * 4, idB * 4 + 4));
      const qr = qmul(qa, [-qb[0], -qb[1], -qb[2], qb[3]]);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(qr[3]))) * 180 / Math.PI;
      if (Math.abs(ang - 60) > 2) return false;
      const len = Math.hypot(qr[0], qr[1], qr[2]);
      if (len < 1e-6) return false;
      const ax = qrotInv(qb, [qr[0] / len, qr[1] / len, qr[2] / len]).map(Math.abs);
      return Math.min(...ax) > 0.5;
    };

    let checked = 0, withSigma3 = 0;
    for (const [tid, neigh] of adj) {
      if (checked >= 40) break;
      checked++;
      if ([...neigh].some(nb => sigma3(tid, nb))) withSigma3++;
    }
    const survivors0 = adj.size;
    // are the survivors metallographically VISIBLE, or single-cell debris?
    const voxOf = new Map();
    for (let i = 0; i < vol.length; i++)
      if (isTwin(vol[i])) voxOf.set(vol[i], (voxOf.get(vol[i]) ?? 0) + 1);
    const sizes = [...voxOf.values()].sort((a, b) => b - a);
    const medianVox = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;

    // the cusp+mobility payoff: more annealing, no fresh plates — the twins
    // must persist rather than evaporate at the general-boundary rate
    await s3.anneal(150);
    const vol2 = await s3.readGrainVolume();
    const alive = new Set();
    for (let i = 0; i < vol2.length; i++) if (isTwin(vol2[i])) alive.add(vol2[i]);

    return {
      ctr0, ctr1, spawned, noSite, survivors0, checked, withSigma3,
      medianVox, biggestVox: sizes[0] ?? 0, survivorsAfter: alive.size,
    };
  });
  // Rails, not knife edges (the GG-KMC lesson): first run measured 38 spawned
  // / 26 survivors (0.68) / 22 after more annealing (0.58) / median 107 vox /
  // sigma3Frac 0.962 — each bound sits at roughly half the measured value, far
  // above what a dead mechanism produces (the single-cell spawn measured
  // 3/512 ≈ 0.006 survival, and random misorientations give frac ≈ 0).
  const frac = out.checked > 0 ? out.withSigma3 / out.checked : 0;
  const ok = out.spawned >= 20 && out.spawned <= 60
    && out.survivors0 >= out.spawned * 0.4
    && out.checked >= 10 && frac >= 0.85
    && out.medianVox >= 25
    && out.survivorsAfter >= out.spawned * 0.25;
  check("HT-TWIN-SIGMA3", ok, { ...out, sigma3Frac: +frac.toFixed(3) });
}

// ---------------------------------------------------------------------------
// HT3-PANEL — the panel in the volume, driven through the DOM. Two things are
// specific to 3D and both are asserted: the DOMAIN-LIMIT refusal is the common
// case (a 12 h anneal legal on the 500 µm 2D specimen is refused on the 125 µm
// volume, with the law's analytic answer still printed), and a modest schedule
// still runs end-to-end with the census landing near the law endpoint.
// Since H3, the report card must also carry the aluminium twin refusal — the
// SFE sentence — and the allocator must not have moved during an Al treatment.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setMaterial("al");
    await window.__ht3.cast3(2600, 0);
    S.app.startHeat();
    const panel = document.getElementById("heattreat");
    if (!panel) return { opened: false };
    const btn = document.getElementById("htRun");
    const note = () => document.getElementById("htNote").textContent;
    // open() fetches its own census async — wait for the plan to exist at all
    // (the panel keeps its dial state across open/close, so it may open
    // already-refused rather than armed: the 2D test left a 12 h hold dialled)
    for (let i = 0; i < 40 && /waiting/.test(note()); i++) await new Promise(r => setTimeout(r, 100));

    const dials = panel.querySelectorAll('input[type="range"]');
    const set = (i, v) => {
      dials[i].value = String(v);
      dials[i].dispatchEvent(new Event("input", { bubbles: true }));
    };

    // the domain-limit refusal — in the volume, the COMMON case: this exact
    // 12 h anneal ran legally on the 500 µm 2D specimen a moment ago
    set(1, 720);
    const refuse = { note: note().slice(0, 260), disabled: btn.disabled };

    // a modest anneal fits the 125 µm specimen
    set(1, 60);
    for (let i = 0; i < 40 && btn.disabled; i++) await new Promise(r => setTimeout(r, 100));
    if (btn.disabled) return { opened: true, armed: false, note: note() };
    const planNote = note();
    const dPred = parseFloat((planNote.match(/→\s*([\d.]+)\s*µm/) ?? [])[1] ?? "NaN");

    const before = await window.__ht3.stats();
    const twinCtrBefore = await S.sim3d().readTwinCtr();
    btn.click();
    for (let i = 0; i < 100 && !S.heat.busy; i++) await new Promise(r => setTimeout(r, 50));
    const busyDuring = S.heat.busy;
    S.app.setRun(true);                          // the interlock must refuse this
    const runDuring = S.app.isRunning();
    for (let i = 0; i < 1200 && S.heat.busy; i++) await new Promise(r => setTimeout(r, 100));
    const stillBusy = S.heat.busy;
    const after = await window.__ht3.stats();
    const twinCtrAfter = await S.sim3d().readTwinCtr();
    const report = document.getElementById("htReport").textContent;
    S.heat.close();

    const um = S.app.getUmPerCell();
    const dOf = st => window.__ht3.dCells(st) * um;
    return {
      opened: true, armed: true, refuse, busyDuring, runDuring, stillBusy,
      grainsBefore: before.grainCount, grainsAfter: after.grainCount,
      dBefore: +dOf(before).toFixed(1), dAfter: +dOf(after).toFixed(1), dPred,
      ratioToLaw: +(dOf(after) / dPred).toFixed(3),
      twinCtrBefore, twinCtrAfter,
      // 520: the volume's ASTM-n/a note AND the H3 twin-refusal sentence must
      // both survive the slice for the assertions below to see them
      report: report.replace(/\s+/g, " ").slice(0, 520),
    };
  });
  const ok = out.opened && out.armed
    && out.refuse.disabled && /refused/.test(out.refuse.note) && /law says/.test(out.refuse.note)
    && !/\b0\.0 µm/.test(out.refuse.note)
    && out.busyDuring && !out.runDuring && !out.stillBusy
    && out.grainsAfter < out.grainsBefore * 0.8
    && out.ratioToLaw > 0.65 && out.ratioToLaw < 1.35
    // the aluminium arm of HT-TWIN-SIGMA3: canTreat blocks twinning (the card
    // says why — the SFE sentence) and the allocator must not have moved
    && out.twinCtrBefore === out.twinCtrAfter
    && /stacking-fault/.test(out.report)
    && /before/.test(out.report) && /after/.test(out.report) && /law endpoint/.test(out.report);
  check("HT3-PANEL", ok, out);
}

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
await viteServer.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
