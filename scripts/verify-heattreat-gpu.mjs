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
// the homogenization gates test against the DISCRETE stencil eigenvalue at
// the shipped numerical diffusivities — loaded, not retyped
const SH = await viteServer.ssrLoadModule("/src/shaders.ts");
const SH3 = await viteServer.ssrLoadModule("/src/shaders3d.ts");
// H6: the panel gates re-derive the card's σ_y from the same census they read,
// so the Hall–Petch constants come from the table that ships them
const MAT = await viteServer.ssrLoadModule("/src/materials.ts");
const AL_HP = { s0: MAT.MATERIALS.al.si.s0, kHP: MAT.MATERIALS.al.si.kHP };
// v7.0 C1: the through-origin power-law fit + r²-window band that used to be
// inlined here four times now lives in the comparator layer — loaded, not
// retyped, and EXP-FIT-PARITY (verify-experiment.mjs, CI) holds the extracted
// arithmetic bit-for-bit against a verbatim copy of the old inline code
const EXP = await viteServer.ssrLoadModule("/src/experiment.ts");

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
      // seeded for the same reason cast3 is: the measured Potts constants are
      // read off whatever cast this produces, so the pour must be the same
      // pour every run
      let rs2 = 0x9e3779b9 >>> 0;
      const rnd2 = () => { rs2 = (rs2 * 1664525 + 1013904223) >>> 0; return rs2 / 4294967296; };
      Object.assign(s.params, {
        scen: 0, heatIn: 0, coolRate: 0.6, alloyOn: 0, twinProb: 0,
        noiseAmp: 0.01, aniMode: 4, delta: 0.04, latent: 1.4,
      });
      s.reset(1 - 0.9);
      for (let i = 0; i < seeds; i++) {
        s.addSeed(rnd2() * s.n, rnd2() * s.n, 2.5, rnd2() * Math.PI * 2);
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
  // the scan (m over [1.0, 4.5] by 0.005, best admissible K > 0) and the
  // r²-window band (all m within 0.0005 of the best — the constant carries its
  // own uncertainty instead of a spurious three decimals) both live in the
  // comparator layer now; the GATE POLICY (r² floors, sanity rails) stays here
  const best = EXP.scanPower(use, d0);

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
    const { K: kAt, r2 } = EXP.fitPowerAt(use, d0, M_MODEL);
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
// GG-PIN-OFF-IDENTITY (v7.0 C2) — the keystone: the Zener mode at zero is the
// pre-C2 anneal, bit for bit. Two same-binary arms from byte-identical casts:
// the pre-C2 call shape (no pin argument) against the mode dialled to zero.
// The pre-C2 ANCHOR is GG-KMC just above — the unpinned kinetics must keep
// measuring the shipped constants — so this gate carries the other half: the
// plumbing itself (a uniform slot written, a mask-shader branch guarded at
// f = 0) moved nothing. Full-field element-exact on readGrainRows, compared
// IN the page (typed arrays do not survive evaluate serialization).
//
// Liveness beside identity (lessons.md): the arms must have FLIPPED cells —
// two frozen fields comparing equal is the vacuous pass this repo has already
// shipped once — and the third arm, the mode ON, must both differ from the
// plain arm and flip strictly fewer cells: pinning that changes nothing, or
// pinning that does not pin, are each a broken mode wearing a green gate.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    const arm = async (pin) => {
      await window.__ht.cast(1600, 512);
      const s = S.sim();
      const pre = await s.readGrainRows(0, s.n);
      await s.anneal(120, undefined, undefined, pin);
      const post = await s.readGrainRows(0, s.n);
      let flips = 0;
      for (let i = 0; i < pre.length; i++) if (pre[i] !== post[i]) flips++;
      return { post, flips };
    };
    const a = await arm(undefined);
    const b = await arm({ f: 0, r: 0 });
    const c = await arm({ f: 0.06, r: 2 });
    let identical = a.post.length === b.post.length;
    if (identical) {
      for (let i = 0; i < a.post.length; i++) {
        if (a.post[i] !== b.post[i]) { identical = false; break; }
      }
    }
    let diffOn = 0;
    for (let i = 0; i < a.post.length; i++) if (a.post[i] !== c.post[i]) diffOn++;
    return {
      identical, diffOn, cells: a.post.length,
      flipsPlain: a.flips, flipsZero: b.flips, flipsPinned: c.flips,
    };
  });
  const ok = out.identical && out.flipsPlain > 0 && out.flipsZero > 0
    && out.diffOn > 0 && out.flipsPinned < out.flipsPlain;
  check("GG-PIN-OFF-IDENTITY", ok, out);
}

// ---------------------------------------------------------------------------
// GG-PIN-LIMIT (v7.0 C2) — the pinned arm gets a LAW, not an exemption.
//
// Three (f, r) ladders from byte-identical casts, each required to (1) reach
// a real plateau (last-rung growth < 1.2 % — the unpinned lattice grows 4.4 %
// over the same late window, so the criterion discriminates by ~4×), (2) sit
// within 8 % of the shipped limit law d_lim = ZENER_K·r^ZENER_R_EXP/f^ZENER_F_EXP
// (fitted over nine plateaued ladders, worst residual 5.4 % — the ladders are
// LCG-seeded and the anneal is salt-deterministic, so a re-run is the same
// measurement and the tolerance is headroom for legitimate lattice changes,
// not for noise), and (3) order correctly in f at shared r. The A-vs-C
// ordering is deliberately NOT asserted: the law itself puts those two arms
// within its own residual of each other, and asserting a coin-flip is how a
// gate trains people to ignore it. A fourth unpinned mini-arm is the
// contrast: at matched sweeps the pinned specimen must sit far below it, or
// "pinning" is a word on a slider. Grain floors are the census liveness.
{
  const ladder = async (pin, rungs) => await page.evaluate(async ([pin, rungs]) => {
    await window.__ht.cast(1600, 512);
    const s = window.__solidify.sim();
    const pts = [];
    const meas = async () => {
      const st = await window.__ht.stats();
      const area = (st.fracSolid * s.n * s.n) / Math.max(1, st.grainCount);
      pts.push({ d: 2 * Math.sqrt(area / Math.PI), grains: st.grainCount });
    };
    await meas();
    let done = 0;
    for (const t of rungs) {
      await s.anneal(t - done, undefined, undefined, pin ?? undefined);
      done = t;
      await meas();
    }
    return pts;
  }, [pin, rungs]);

  const ARMS = [
    { f: 0.03, r: 2, rungs: [1000, 2500, 4500, 7000, 9500] },
    { f: 0.12, r: 2, rungs: [500, 1500, 3000, 4500, 6000] },
    { f: 0.05, r: 5, rungs: [500, 1500, 3000, 4500, 6000] },
  ];
  const arms = [];
  for (const a of ARMS) {
    const pts = await ladder({ f: a.f, r: a.r }, a.rungs);
    const dLim = pts[pts.length - 1].d;
    const lastGap = (dLim - pts[pts.length - 2].d) / dLim;
    const law = HT.zenerLimitCells(a.f, a.r);
    arms.push({
      f: a.f, r: a.r,
      dLim: +dLim.toFixed(2), law: +law.toFixed(2),
      ratioToLaw: +(dLim / law).toFixed(3),
      lastGapPct: +(lastGap * 100).toFixed(2),
      grains: pts[pts.length - 1].grains,
      d0: +pts[0].d.toFixed(2),
    });
  }
  const un = await ladder(null, [3000]);
  const unpinned = +un[un.length - 1].d.toFixed(2);

  const plateaued = arms.every(a => a.lastGapPct < 1.2);
  const onLaw = arms.every(a => Math.abs(a.ratioToLaw - 1) <= 0.08);
  const fOrder = arms[0].dLim > arms[1].dLim;              // f = 0.03 above f = 0.12 at r = 2
  // pinned d_lim (6 000 sweeps, at its plateau) against the unpinned arm at
  // 3 000 — deliberately DIFFERENT horizons, and the strict direction: the
  // unpinned specimen only grows past 3 000, so the true matched-sweep ratio
  // is even smaller than the one measured here (0.37)
  const pins = arms[1].dLim < 0.45 * unpinned;
  const grew = arms.every(a => a.dLim > a.d0 * 1.15 && a.grains > 300);
  check("GG-PIN-LIMIT", plateaued && onLaw && fOrder && pins && grew, {
    arms, unpinnedAtS3000: unpinned,
    shipped: { K: HT.ZENER_K, rExp: HT.ZENER_R_EXP, fExp: HT.ZENER_F_EXP },
  });
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
  const out = await page.evaluate(async hp => {
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
    const um = S.app.getUmPerCell();
    const dOf = st => 2 * Math.sqrt(st.meanAreaPx / Math.PI) * um;
    // the card's own law, from the shipped constants — what the σ_y row must BE
    const sigOf = st => hp.s0 + hp.kHP / Math.sqrt(dOf(st) * 1e-6);

    // the incipient-melting refusal, from the dial like a user would find it
    set(0, parseFloat(dials[0].max));
    const refuse = { note: note().slice(0, 120), disabled: btn.disabled };
    set(0, t0);

    // a 12 h full anneal — long enough that the run spans the interlock probe
    set(1, 720);
    const planNote = note();
    const dPred = parseFloat((planNote.match(/→\s*([\d.]+)\s*µm/) ?? [])[1] ?? "NaN");

    const before = await window.__ht.stats();
    // H6: a pre-treatment spec this anneal must MISS. A full anneal softens —
    // that is its point — so a spec 2 MPa under the as-cast strength is
    // committed before the run, census-relative rather than hardcoded, and
    // the card is required to say "missed" about it afterwards
    const spec = Math.round(sigOf(before) - 2);
    set(2, spec);
    const specNote = note();
    btn.click();
    // run() measures first, then flags busy — wait for it rather than sleep
    for (let i = 0; i < 100 && !S.heat.busy; i++) await new Promise(r => setTimeout(r, 50));
    const busyDuring = S.heat.busy;
    S.app.setRun(true);                          // the interlock must refuse this
    const runDuring = S.app.isRunning();
    for (let i = 0; i < 1200 && S.heat.busy; i++) await new Promise(r => setTimeout(r, 100));
    const stillBusy = S.heat.busy;
    const after = await window.__ht.stats();
    const report = document.getElementById("htReport").textContent.replace(/\s+/g, " ");
    // the σ_y row parsed off the card, to be matched against hallPetch on the
    // same census this gate reads
    const sig = report.match(/σ_y\s+([\d.]+)\s*→\s*([\d.]+)\s*MPa/);

    // H6, the other verdict: a near-noop treatment (1 min at the dial floor —
    // the stress-relief case) leaves the strength standing, so a spec dialled
    // under it must come back "met". Nearly free: zero sweeps are spent.
    set(0, 100);
    set(1, 1);
    const specPass = Math.max(1, Math.floor(sigOf(after) - 2));
    set(2, specPass);
    btn.click();
    // a zero-sweep run can finish between two polls of `busy`, so wait on the
    // card itself: it still says "missed" until the second report() lands
    for (let i = 0; i < 200; i++) {
      if (/met: the treated casting/.test(document.getElementById("htReport").textContent)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const report2 = document.getElementById("htReport").textContent.replace(/\s+/g, " ");
    S.heat.close();

    return {
      opened: true, armed: true, refuse, busyDuring, runDuring, stillBusy,
      grainsBefore: before.grainCount, grainsAfter: after.grainCount,
      dBefore: +dOf(before).toFixed(1), dAfter: +dOf(after).toFixed(1), dPred,
      ratioToLaw: +(dOf(after) / dPred).toFixed(3),
      spec, specPass,
      specNoteMiss: /misses the ≥/.test(specNote),
      sigRow: sig ? { b: +sig[1], a: +sig[2] } : null,
      sigBExp: +sigOf(before).toFixed(1), sigAExp: +sigOf(after).toFixed(1),
      missedInFirst: /missed: the treated casting/.test(report),
      metInSecond: /met: the treated casting/.test(report2),
      report: report.slice(0, 1400),
      report2: report2.slice(0, 500),
    };
  }, AL_HP);
  const ok = out.opened && out.armed
    && out.refuse.disabled && /refused/.test(out.refuse.note)
    && out.busyDuring && !out.runDuring && !out.stillBusy
    && out.grainsAfter < out.grainsBefore * 0.8
    && out.ratioToLaw > 0.65 && out.ratioToLaw < 1.35
    // H4/H5 wiring on the 2D card: alloy is off in this cast so the homog
    // line is the canTreat hint, and Al's oxide line is passive-film nm
    && /solute field/.test(out.report) && /scale .*nm/.test(out.report)
    && /before/.test(out.report) && /after/.test(out.report) && /law endpoint/.test(out.report)
    // H6: the card's σ_y row must BE hallPetch on the measured d̄ (0.2 MPa
    // covers the one-decimal formatting), the note must pre-judge the doomed
    // spec, the anneal must miss it, and the near-noop run must meet its own
    && out.sigRow && Math.abs(out.sigRow.b - out.sigBExp) < 0.2 && Math.abs(out.sigRow.a - out.sigAExp) < 0.2
    && out.specNoteMiss && out.missedInFirst && out.metInSecond;
  check("HT-PANEL", ok, out);
}

// ---------------------------------------------------------------------------
// HT-PIN-PANEL (v7.0 C2) — the dispersion's operator surface, end to end but
// cheap: the pinned RUN here is a near-noop schedule (dial-floor temperature,
// one minute — zero sweeps), because the pinned PHYSICS is GG-PIN-LIMIT's job
// and this gate's job is the wiring: the dials exist AFTER the three the
// other panel gates drive positionally, the note pre-judges with the measured
// law and never introduces an arrow before the law prediction (the dPred
// parse hazard), the latched card carries the pinned row with d_lim, and
// dialling the dispersion back to zero returns the note to its unpinned text.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.startHeat();
    await new Promise(r => setTimeout(r, 300));
    const panel = document.getElementById("heattreat");
    if (!panel) return null;
    const dials = panel.querySelectorAll('input[type="range"]');
    const set = (i, v) => { dials[i].value = String(v); dials[i].dispatchEvent(new Event("input", { bubbles: true })); };
    const note = () => document.getElementById("htNote").textContent;
    // the note's FIRST arrow must still be the law prediction after pinning —
    // capture it BEFORE the dispersion dials move, and require it UNCHANGED:
    // asserting mere existence would pass a pinned sentence that introduced
    // its own earlier arrow (review catch — the exact dPred parse hazard this
    // gate advertises guarding)
    const arrowOf = s => (s.match(/→\s*([\d.]+)\s*µm/) ?? [])[1] ?? null;
    const arrowBefore = arrowOf(note());
    set(3, 0.06); set(4, 3);
    const notePinned = note();
    const firstArrow = arrowOf(notePinned);
    set(0, 100); set(1, 1);            // dial-floor near-noop schedule
    document.getElementById("htRun").click();
    for (let t = 0; t < 200; t++) {
      await new Promise(r => setTimeout(r, 100));
      if (!window.__solidify.heat.busy) break;
    }
    const report = document.getElementById("htReport").textContent;
    set(3, 0);
    const noteOff = note();
    S.heat.close();
    return {
      dialCount: dials.length,
      notePinned: notePinned.slice(0, 400),
      firstArrow, arrowBefore,
      pinnedRow: /pinned/.test(report) && /d_lim/.test(report),
      reportTail: report.slice(-260),
      offReverts: !/dispersion \d/.test(noteOff),
    };
  });
  const ok = !!out && out.dialCount === 5
    && /dispersion 6\.0 vol %/.test(out.notePinned) && /pins boundaries near d_lim/.test(out.notePinned)
    && out.firstArrow !== null && out.firstArrow === out.arrowBefore
    && out.pinnedRow && out.offReverts;
  check("HT-PIN-PANEL", ok, out);
}

// ---------------------------------------------------------------------------
// HT-HOMOG-2D — homogenization against the DISCRETE stencil eigenvalue, exact.
//
// A fully synthetic solid block (φ = 1 everywhere — the gate writes the state
// textures directly, so no cast roughness pollutes the mode) seeded with a
// DCT-II mode cos(πM(x+0.5)/n), which is an exact eigenvector of the
// clamp-edge 5-point Laplacian: its amplitude after I iterations is
// (1 − 2D(1 − cos πM/n))^I to machine precision, no boundary artefacts, no
// free constant. The continuum exp(−Dk²I) is printed alongside with the gap —
// that gap is the model's own discretization error and belongs on the science
// page, not swept into a tolerance. Also asserted: solute is conserved (the
// masked exchange is antisymmetric pair-by-pair) and φ is untouched.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s = S.sim();
    const n = s.n;
    const M = 16;
    const data = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        data[i] = 1; data[i + 1] = 0.2;
        data[i + 2] = 0.3 + 0.1 * Math.cos(Math.PI * M * (x + 0.5) / n);
        data[i + 3] = 0.1;
      }
    for (const dir of [0, 1])
      s.device.queue.writeTexture({ texture: s.stateTexture(dir) }, data, { bytesPerRow: n * 16 }, [n, n]);
    const read = async () => {
      let r = null;
      for (let t = 0; t < 40 && !r; t++) { r = await s.readRows(0, n); if (!r) await s.device.queue.onSubmittedWorkDone(); }
      return r;
    };
    const proj = rows => {
      let a = 0, mean = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const c = rows[(y * n + x) * 4 + 2];
          a += c * Math.cos(Math.PI * M * (x + 0.5) / n);
          mean += c;
        }
      return { a, mean: mean / (n * n) };
    };
    const r0 = await read();
    const p0 = proj(r0);
    const I = 400;
    const got = await s.homogenize(I);
    const r1 = await read();
    const p1 = proj(r1);
    let phiDiff = 0;
    for (let i = 0; i < r0.length; i += 4) if (r0[i] !== r1[i]) { phiDiff++; break; }
    return { n, M, I, got, a0: p0.a, a1: p1.a, mean0: p0.mean, mean1: p1.mean, phiDiff };
  });
  const k = Math.PI * out.M / out.n;
  const mu = 1 - 2 * SH.HOMOG_D2 * (1 - Math.cos(k));
  const discrete = Math.pow(mu, out.I);
  const continuum = Math.exp(-SH.HOMOG_D2 * k * k * out.I);
  const meas = out.a1 / out.a0;
  const err = Math.abs(meas - discrete) / discrete;
  const consErr = Math.abs(out.mean1 - out.mean0) / out.mean0;
  check("HT-HOMOG-2D", out.got === out.I && err < 2e-3 && consErr < 1e-6 && out.phiDiff === 0, {
    measured: +meas.toFixed(6), discrete: +discrete.toFixed(6), continuum: +continuum.toFixed(6),
    discretizationGapPct: +((continuum / discrete - 1) * 100).toFixed(3),
    relErr: +err.toExponential(2), consErr: +consErr.toExponential(2), phiDiff: out.phiDiff,
  });
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
    // `seed` (v7.0 C3a): the LCG's start, defaulted to the value every gate
    // before HT3-SE-SELECTION was measured against — so those casts stay
    // byte-identical while the selection gate can pour three DIFFERENT
    // specimens against the one fixed work fabric, which is the replicate
    // design WORK_SALT's docblock argues for.
    async cast3(seeds = 2600, pPore = 0, seed = 0x2f6e2b1) {
      S.app.setRun(false);
      const s3 = S.sim3d();
      // a SEEDED lattice, not Math.random(): K_MC is measured off whatever
      // cast this helper produces, and an unseeded 2600-seed pour moves the
      // measured constant cast to cast — enough to fail the 15 % drift gate on
      // a good build (seen: 1.186 then 0.924 on identical code). A gate that
      // fails at random is the mirror of the U0 lesson about a gate that
      // cannot fail at all. Plain LCG so the pour is byte-identical run to run.
      let rs = seed >>> 0;
      const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
      Object.assign(s3.params, {
        scen: 0, heatIn: 0, coolRate: 0.5, alloyOn: 0, twinProb: 0,
        pPore, noiseAmp: 0.01, aniMode3: 1, facet: 0,
      });
      s3.reset(1 - 0.9);
      for (let i = 0; i < seeds; i++)
        s3.addSeed3D(rnd() * s3.n, rnd() * s3.n, rnd() * s3.n, 2.5);
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
  // same estimator as the 2D gate, from the same one home (v7.0 C1)
  const best = EXP.scanPower(use, d0);

  const ok = best !== null && best.r2 >= 0.97 && best.m > 1.05 && best.m < 4.45 && best.K > 0;
  check("GG3-EXPONENT", ok, {
    m: best?.m, K_MC: best ? +best.K.toExponential(4) : null, r2: best ? +best.r2.toFixed(4) : null,
    mBand: best?.band, d0: +d0.toFixed(2), points: use.length,
    dRange: [+out[0].d.toFixed(1), +out[out.length - 1].d.toFixed(1)],
  });
  {
    const M3 = HT.M_MODEL_3D;
    const f = EXP.fitPowerAt(use, d0, M3);
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
// PIN3-LIVE (v7.0 C2) — the volume's Zener fabric actually pins, asserted as
// the WALL GUARANTEE rather than a flip count.
//
// The first cut of this gate compared pinned-arm flips against a plain arm
// and demanded fewer — and failed on a correct build, because the premise is
// wrong: excluding particle cells from the energy sum flattens the local
// landscape (flat moves are always taken), so at 10 % coverage the extra flat
// moves near particle surfaces OUTWEIGH the migration suppression over a
// short window. The flip count is not monotone in pinning. What pinning
// actually guarantees is exact and structural: a fabric cell can NEVER change
// id (mask 0 cells copy themselves through, every sweep, by construction).
// So: replicate the fabric in JS (the WGSL hash is pure u32 arithmetic —
// Math.imul wraps identically) and require the pinned arm's flipped cells to
// avoid it. The tolerance of 50 is for the f32-vs-f64 threshold boundary
// (the shader compares in f32; a handful of candidate centres per volume can
// round across pC) — a mask that ignored the fabric would flip ~10 % of the
// arm, three orders of magnitude more. Liveness: the fabric must be nonempty
// at these dials (~10 % of a lattice sample) and the arm must have flipped —
// zero fabric flips over an empty fabric or a frozen field proves nothing.
{
  const out = await page.evaluate(async (SALT) => {
    const s3 = window.__solidify.sim3d();
    const F = 0.10, R = 2;
    const a = await s3.readGrainVolume();
    await s3.anneal(24, undefined, undefined, { f: F, r: R });
    const b = await s3.readGrainVolume();
    if (!a || !b) return null;
    const n = s3.n;
    const hash = (x, y, z) => {
      let v = (Math.imul(x, 747796405) + Math.imul(y, 2891336453) + Math.imul(z, 3546859427) + 2654435769) >>> 0;
      v = (v ^ (v >>> 16)) >>> 0; v = Math.imul(v, 2246822519) >>> 0;
      v = (v ^ (v >>> 13)) >>> 0; v = Math.imul(v, 3266489917) >>> 0;
      v = (v ^ (v >>> 16)) >>> 0;
      return v / 4294967295;
    };
    const pC = F / (4.18879020 * R * R * R);
    const inFab = (x, y, z) => {
      for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        if (hash((x + dx) >>> 0, (y + dy) >>> 0, ((z + dz) >>> 0) ^ SALT) < pC) return true;
      }
      return false;
    };
    let flips = 0, fabricFlips = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        flips++;
        const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
        if (inFab(x, y, z)) fabricFlips++;
      }
    }
    // fabric liveness on a lattice sample (every 131st voxel ≈ 16k tests)
    let sampled = 0, inFabric = 0;
    for (let i = 0; i < a.length; i += 131) {
      sampled++;
      const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
      if (inFab(x, y, z)) inFabric++;
    }
    return { flips, fabricFlips, sampled, inFabric, fabricFrac: +(inFabric / sampled).toFixed(4) };
  }, SH.PIN_SALT >>> 0);
  const ok = !!out && out.flips > 0 && out.fabricFlips < 50 && out.fabricFrac > 0.05;
  check("PIN3-LIVE", ok, out);
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
// STORED ENERGY (v7.0 C3a) — the field, the drive and the recovery.
//
// The bicrystal fixture the front gates run on: a flat {100} interface at
// x = n/2, solid everywhere, two grain ids, written straight into both
// ping-pong slots. Deliberately synthetic and deliberately NOT a cast:
//   * every quaternion on a fresh reset is identity and sigma3(I, I) is false,
//     so every unlike bond costs exactly 1.0 and the Σ3 mobility veto never
//     fires — this is precisely the unweighted lattice the eNow = 9 / eNew = 17
//     derivation describes, so the measurement tests the derivation rather than
//     a cusp-weighted approximation of it;
//   * a flat front is immobile at zero drive (measured: exactly 0 voxels over
//     60 sweeps), which is what gives the ladder a real floor to clear.
// Both textures in the pair are painted because `anneal` reads grainTex[dir]
// and writes grainTex[1-dir], and `reset()` leaves dir at 0.
await page.evaluate(() => {
  const S = window.__solidify;
  window.__se = {
    paint() {
      const s3 = S.sim3d(), n = s3.n, vox = n * n * n;
      const ids = new Uint32Array(vox);
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        ids[(z * n + y) * n + x] = x < n / 2 ? 1 : 2;
      const st = new Float32Array(vox * 2);
      for (let i = 0; i < vox; i++) { st[i * 2] = 1.0; st[i * 2 + 1] = 0.0; }
      for (const dir of [0, 1]) {
        s3.device.queue.writeTexture({ texture: s3.grainTexture(dir) }, ids,
          { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
        s3.device.queue.writeTexture({ texture: s3.stateTexture(dir) }, st,
          { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n]);
      }
      return n;
    },
    async ones() {
      const g = await S.sim3d().readGrainVolume();
      let k = 0; for (let i = 0; i < g.length; i++) if (g[i] === 1) k++;
      return k;
    },
    /** front speed in cells/sweep, positive = the LOW-H grain 1 is growing */
    async front(dH, sweeps) {
      const s3 = S.sim3d();
      s3.reset();
      const n = this.paint();
      s3.setStored(1, 0); s3.setStored(2, dH);
      const a = await this.ones();
      await s3.anneal(sweeps);
      const b = await this.ones();
      return { dH, v: (b - a) / (n * n) / sweeps, gained: b - a };
    },
  };
});

// The largest drive HT3-SE-FRONT measures immobile, handed to
// HT3-SE-RECOVERY-STALL so the stall is checked against a band measured on this
// GPU in this run. Null until FRONT has run; the stall gate fails closed on it.
let immobileTop = null;

// HT3-SE-FRONT — the headline. Does a stored-energy difference drive a boundary,
// in the right DIRECTION, at a rate the lattice's own geometry predicts?
//
// The external anchor is not a fit: a voxel on a flat {100} boundary has 9 of
// its 26 neighbours across the interface and 17 on its own side, so adopting the
// other grain swaps 9 → 17 and the boundary term of the move is ΔE = +8. That
// number is enumerated HERE in JS from the same 26 offsets, independently of the
// shader. At ΔH = 8 the move is therefore energy-neutral, this kernel takes flat
// moves unconditionally, and the front should advance at whatever its candidate
// draw offers — 9/26 = 0.346 cells/sweep for a flat front.
//
// What is ASSERTED is what the measurement supports: the SEPARATION below
// threshold — sub-barrier creep three orders under the neutral-point rate, not
// an exact zero, for the Poisson reason spelled out at the assertion itself —
// monotonicity, direction on the rungs that HAVE one, the v ≤ 1 ceiling, and
// two BRACKETS that exclude the neighbouring barriers.
//
// The 8 ↔ 9/26 agreement is REPORTED and not gated, and the reason is stronger
// than "roughening makes it approximate". Two effects push it in opposite
// directions and neither is noise. A sweep is EIGHT sequential sublattice
// passes, so the front roughens inside its own first sweep and the later colours
// see a raised unlike-neighbour count — which puts the one-sweep velocity ABOVE
// the flat draw. And recovery is LIVE throughout: `setStored` turns the stored
// mode on and `anneal` banks `HT_RECOVER_3D` every sweep, so a nominal ΔH = 8
// has decayed to an effective 5.4 by sweep 60 — which puts the long-window
// velocity below it. Measured here, at 1, 5 and 60 sweeps, and both departures
// asserted by DIRECTION rather than by size, because their sizes are what the
// window length happens to be.
//
// The brackets are what actually pin the barrier, and they cut both ways: a
// barrier of 10 would leave ΔH = 8 uphill by 2 and put v(8) near
// pick·exp(−2/0.6) ≈ 0.035·pick; a barrier of 6 would make ΔH = 6 the neutral
// point and put v(6) near the full pick. Measured: 0.92·pick and 0.44·pick.
{
  // the barrier, counted from the stencil rather than quoted from the source
  // A voxel in grain 1 on the last plane before the interface: the dx = +1
  // offsets (9 of them) land in grain 2, the other 17 stay in grain 1.
  //   eNow  = neighbours unlike ITS OWN id            = 9   (the far side)
  //   eNew  = neighbours unlike the CANDIDATE's id    = 17  (its own side)
  // so the boundary cost of adopting grain 2 is eNew − eNow = 17 − 9 = +8.
  let sameSide = 0, farSide = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0 && dz === 0) continue;
    if (dx > 0) farSide++; else sameSide++;
  }
  const dEflat = sameSide - farSide;    // 17 − 9 = +8
  const pick = farSide / 26;            // 9/26 — the flat front's draw

  // A SHORT window, because recovery is live and the drive decays across it:
  // 5 sweeps banks rec = 0.005, which takes a nominal 8 to 7.69, a 3.8 % sag.
  // At the 40 sweeps this gate first used it is 8 -> 6.06, and the ladder stops
  // being a ladder in the quantity it is labelled by.
  const W = 5;
  const rungs = [0, 2, 6, 8, 20];
  const got = [];
  for (const dH of rungs) {
    got.push(await page.evaluate(async (d, w) => await window.__se.front(d, w), dH, W));
  }
  // the same rung at the two ends of the window range, for the two named effects
  const one = await page.evaluate(async () => await window.__se.front(8, 1));
  const sixty = await page.evaluate(async () => await window.__se.front(8, 60));
  const v = got.map(r => r.v);
  const idx = d => rungs.indexOf(d);
  const out = {
    dEflatCounted: dEflat, shippedH_FLAT_3D: HT.H_FLAT_3D, pickFlat: +pick.toFixed(4), window: W,
    ladder: got.map(r => ({ dH: r.dH, v: +r.v.toFixed(4), gained: r.gained })),
    vAt8_vs_pick: +(v[idx(8)] / pick).toFixed(3),
    vAt6_vs_pick: +(v[idx(6)] / pick).toFixed(3),
    windowEffect: { s1: +one.v.toFixed(4), s5: +v[idx(8)].toFixed(4), s60: +sixty.v.toFixed(4) },
  };
  // The sub-threshold rungs are asserted NEGLIGIBLE, not zero, and the
  // difference is not pedantry. kT = 0.6 buys sub-barrier moves at
  // exp(-(8-dH)/kT), so over this window the expected count is a small fraction
  // of a flip at dH = 0 and about one at dH = 2, out of 16384 boundary cells x
  // W sweeps. Exact zero is a Poisson draw coming up empty — runs of this gate
  // on identical code have read both 0 and 2. An `=== 0` here is a flake with a
  // physical explanation, so the assertion is the SEPARATION: sub-threshold
  // creep three orders below the neutral-point rate. It fails the moment the
  // barrier stops being a barrier, which is the claim being made.
  const floor = v[idx(8)] * 1e-3;
  const ok =
    dEflat === HT.H_FLAT_3D             // the source's constant IS the counted one
    && v[idx(0)] < floor                // no drive: creep is noise, not motion
    && v[idx(2)] < floor                // still far under the Boltzmann tail
    && v[idx(8)] > 0 && v[idx(20)] > 0  // liveness: the drive drives
    && v[idx(6)] > v[idx(2)] && v[idx(8)] > v[idx(6)] && v[idx(20)] > v[idx(8)]
    // DIRECTION, on the rungs that HAVE one. The dH = 0 rung is excluded on
    // purpose: with both grains at h = 0 the move costs +8 in BOTH directions,
    // so `gained` there is the difference of two equal-rate Poisson streams
    // with mean zero, and demanding it be non-negative asserts a direction the
    // physics does not have — the same flake class this gate's own creep floor
    // exists to avoid. (Measured: 12 repeats of the 40-sweep window all read
    // exactly 0, so the risk is small; it is still a claim about noise.)
    && got.filter(r => r.dH > 0).every(r => r.gained >= 0)
    // the two brackets that exclude the neighbouring barriers
    && v[idx(8)] > 0.25 * pick          // a barrier of 10 would put this at 0.035*pick
    && v[idx(6)] < 0.60 * pick          // a barrier of 6 would put this near pick
    // and the two named window effects, asserted by direction only: roughening
    // inside the first sweep puts it ABOVE the flat draw, live recovery puts
    // the long window below the short one
    && one.v > pick && one.v > v[idx(8)] && v[idx(8)] > sixty.v
    && v.every(x => x <= 1.0);          // one flip per site per sweep, at most
  out.creepFloor = +floor.toExponential(2);
  out.creepRatios = [0, 2].map(d => +(v[idx(d)] / v[idx(8)]).toExponential(2));
  // handed to HT3-SE-RECOVERY-STALL: the largest drive this ladder measured
  // IMMOBILE, so the stall can be checked against a band measured in the same
  // run rather than against a number written into a docblock
  immobileTop = rungs.filter(d => v[idx(d)] < floor).reduce((a, b) => Math.max(a, b), 0);
  out.immobileTop = immobileTop;
  check("HT3-SE-FRONT", ok, out);
}

// HT3-SE-RECOVERY-STALL — recovery is real, and it is the closed form.
//
// The spec proposed "stored energy monotonically non-increasing" and "recovery
// rate vs sweeps". Both are vacuous against this implementation: the code IS
// H₀/(1 + rec·H₀), so monotone decay is arithmetic and fitting a rate to the run
// that produced it is fitting, not measuring.
//
// What is not true by construction is that the recovering field reaches the
// SHADER at all, on the right sweep, applied once and to both sides. So the
// assertion is a correspondence between two independent experiments: a front
// driven from ΔH₀ = 20 with recovery live must slow monotonically, STALL, and
// stall at an effective drive inside the band HT3-SE-FRONT measured immobile in
// this same run. Recovery applied twice, per-colour, one sweep stale, or
// sign-flipped each moves where the stall lands while still producing a
// perfectly monotone decay curve.
//
// A STRONGER correspondence was claimed here and in four documents, and it is
// retracted: that each window's velocity falls between the ladder's velocities
// at that window's H_S endpoints. It does not. Windows 300 through 700 read
// 0.0144 down to 0.0003 where the ladder reads 0.0000 at the same drives, one
// to two orders out — and the cause is not an error in either measurement. A
// front that has been migrating for hundreds of sweeps is ROUGH, and a rough
// front moves at drives a flat one cannot; it is the same effect that puts the
// ladder's own onset near 5–6 rather than at the flat-front barrier of 8. Two
// experiments that differ in front morphology cannot bracket each other window
// by window, and nothing here ever asserted that they did — which is the part
// that should have been caught before it reached three documents as fact.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s3 = S.sim3d();
    s3.reset();
    const n = window.__se.paint();
    s3.setStored(1, 0); s3.setStored(2, 20);
    const rows = [];
    let prev = await window.__se.ones();
    // five windows, not four: at 200-sweep windows the 600→800 pane still
    // averages in the tail of the creep and reads 2e-4 rather than a clean stop.
    // The ladder runs one window past that, where every run so far has read a
    // net displacement of exactly zero voxels — see the assertion for why that
    // observation is REPORTED and a three-order separation is what is gated.
    for (let k = 0; k < 5; k++) {
      await s3.anneal(200);
      const now = await window.__se.ones();
      rows.push({
        S: (k + 1) * 200,
        v: (now - prev) / (n * n) / 200,
        rec: s3.storedRec,
        hEff: 20 / (1 + s3.storedRec * 20),
      });
      prev = now;
    }
    return { rows, recFinal: s3.storedRec, storedOn: s3.storedOn };
  });
  const r = out.rows;
  const last = r[r.length - 1];
  const expectRec = HT.HT_RECOVER_3D * 1000;
  // The stall is asserted as a SEPARATION, for the same reason HT3-SE-FRONT's
  // floor is and against the same physics. Every run of this gate so far has
  // measured a net displacement of exactly zero voxels in the last window, and
  // an `=== 0` was what it first shipped with — but that number is a Poisson
  // draw, not a constant. At hEff ≈ 1 the residual flat-front cost is
  // exp(-7/0.6) ≈ 8.5e-6 per attempt, which is ~0.05 flips per sweep across the
  // interface, and an isolated voxel on a flat {100} face carries 17 unlike
  // neighbours and re-dissolves within a sweep or two. So the standing
  // population is a few hundredths of a voxel and the window reads 0 about
  // nineteen times in twenty — a one-in-twenty flake, with a physical
  // explanation, in a gate whose whole subject is that exact zeros here are
  // luck. Three orders under the opening velocity IS "stalled dead", and it is
  // the standard the sibling gate already sets.
  const ok =
    r[0].v > 0.05                                    // liveness: it moved at first
    && r.every((x, i) => i === 0 || x.v <= r[i - 1].v) // monotone slowing
    && Math.abs(last.v) < r[0].v * 1e-3               // and it STALLED
    && last.v >= 0                                    // without reversing
    // the cross-gate correspondence: it started ABOVE the measured immobile
    // band and stalls INSIDE it. `immobileTop` comes off HT3-SE-FRONT's ladder
    // in this run, so neither end of this comparison is a written-down number.
    && immobileTop !== null && immobileTop > 0
    && r[0].hEff > immobileTop && last.hEff <= immobileTop
    && Math.abs(out.recFinal - expectRec) < 1e-9;     // rec banked per sweep, once
  check("HT3-SE-RECOVERY-STALL", ok, {
    stallRatio: +(Math.abs(last.v) / r[0].v).toExponential(2),
    immobileTop, stallAtHEff: +last.hEff.toFixed(2), startedAtHEff: +r[0].hEff.toFixed(2),
    rows: r.map(x => ({ S: x.S, v: +x.v.toFixed(4), hEff: +x.hEff.toFixed(2) })),
    recFinal: out.recFinal, expectRec, rate: HT.HT_RECOVER_3D,
  });
}

// HT3-SE-OFF-IDENTITY — the keystone: the stored mode at zero IS the pre-C3a
// anneal, bit for bit. `GG-PIN-OFF-IDENTITY`'s three-arm shape, on a CAST.
//
// It has to be a cast and not the bicrystal, and the probe that built this gate
// is why: on a flat front the plain anneal moves exactly zero voxels, so two
// arms would compare equal because neither did anything — the vacuous pass
// lessons.md opens with. On a cast the plain anneal flips tens of thousands of
// voxels, and the liveness clauses below say so out loud.
//
// The mode selector is `hOn`, never `work > 0`: arm B runs the STORED pipeline,
// through the stored bind-group layout, with binding 5 claimed and `H.rec`
// written every sweep — and must still come out element-exact. An off-arm built
// from `work === 0` would run the pre-C3a path and prove nothing.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    // Cast ONCE and restore the snapshot into every arm.
    //
    // Not defensiveness: `cast3`'s freeze loop stops on a stats-poll threshold,
    // so it is wall-clock sensitive and two successive casts are NOT the same
    // specimen (the same wobble the C2 ledger records for GG3-KMC). Re-casting
    // per arm made this gate's first run read 587053 vs 587074 flips — arms that
    // differ by their CAST cannot witness anything about the kernel. `anneal`
    // never writes state, φ, T or age, so restoring the grain field alone is
    // enough to make the arms genuinely identical, and the quaternion table is
    // left untouched precisely because reset() would rewrite it.
    const s3 = S.sim3d();
    await window.__ht3.cast3(2600, 0);
    const snap = await s3.readGrainVolume();
    const n = s3.n;
    const restore = () => {
      for (const dir of [0, 1]) {
        s3.device.queue.writeTexture({ texture: s3.grainTexture(dir) }, snap,
          { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
      }
    };
    const arm = async (setup) => {
      restore();
      setup(s3);
      await s3.anneal(60);
      const post = await s3.readGrainVolume();
      let flips = 0;
      for (let i = 0; i < snap.length; i++) if (snap[i] !== post[i]) flips++;
      return { post, flips, on: s3.storedOn };
    };
    const a = await arm(s => { s.deposit(0); s.clearStored(); });  // pre-C3a path
    const b = await arm(s => s.deposit(0));        // stored pipeline, zero field
    const c = await arm(s => s.deposit(6));        // the mode ON
    let identical = a.post.length === b.post.length;
    if (identical) for (let i = 0; i < a.post.length; i++) {
      if (a.post[i] !== b.post[i]) { identical = false; break; }
    }
    let diffOn = 0;
    for (let i = 0; i < a.post.length; i++) if (a.post[i] !== c.post[i]) diffOn++;
    return {
      identical, diffOn, voxels: a.post.length,
      flipsPlain: a.flips, flipsZero: b.flips, flipsOn: c.flips,
      onPlain: a.on, onZero: b.on, onOn: c.on,
    };
  });
  const ok = out.identical
    && out.flipsPlain > 0 && out.flipsZero > 0   // liveness on BOTH identity arms
    && out.onZero === true                        // arm B really ran the new path
    && out.onPlain === false
    && out.diffOn > 0;                            // and the mode ON does something
  check("HT3-SE-OFF-IDENTITY", ok, out);
}

// HT3-SE-UNIFORM-INERT — the gate a zero-arm identity cannot be.
//
// dE_stored = H(cand) − H(mine), so a UNIFORM field must change nothing: every
// difference is zero however large the field is. That makes it the one assertion
// here that catches a coupling which is wrong ASYMMETRICALLY and still cancels
// at an empty field — `−H(mine)` alone, `+H(cand)` alone, or `rec` applied to
// one side of the difference. Each passes HT3-SE-OFF-IDENTITY and then moves
// boundaries plausibly enough to look like grain growth.
//
// What it does NOT catch, and an earlier version of this note claimed it did:
// anything that is still zero when the difference is zero. `abs(ΔH)`, a clamp,
// a rescale — all of them leave a uniform field inert, because the quantity
// they deform is already 0 everywhere. Those are HT3-SE-FRONT's to catch, where
// the difference is not zero: a sign or magnitude error there moves the ladder.
//
// It also turns "a uniform stored-energy field is inert" from an argument in a
// docblock into a measurement, for the cost of one arm.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s3 = S.sim3d();
    // one cast, restored into both arms — same reason as HT3-SE-OFF-IDENTITY
    await window.__ht3.cast3(2600, 0);
    const snap = await s3.readGrainVolume();
    const n = s3.n;
    const arm = async (h) => {
      for (const dir of [0, 1]) {
        s3.device.queue.writeTexture({ texture: s3.grainTexture(dir) }, snap,
          { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
      }
      // every id the same non-zero value — deliberately not `deposit`, whose
      // whole job is to make the field NON-uniform
      for (let id = 0; id < 4096; id++) s3.setStored(id, h);
      await s3.anneal(60);
      const post = await s3.readGrainVolume();
      let flips = 0;
      for (let i = 0; i < snap.length; i++) if (snap[i] !== post[i]) flips++;
      return { post, flips };
    };
    const zero = await arm(0);
    const flat = await arm(6);
    let identical = zero.post.length === flat.post.length;
    if (identical) for (let i = 0; i < zero.post.length; i++) {
      if (zero.post[i] !== flat.post[i]) { identical = false; break; }
    }
    return { identical, flipsZero: zero.flips, flipsFlat: flat.flips, voxels: zero.post.length };
  });
  const ok = out.identical && out.flipsZero > 0 && out.flipsFlat > 0;
  check("HT3-SE-UNIFORM-INERT", ok, out);
}

// HT3-SE-COHERENCE — MC3-COHERENCE's invariant set, re-asserted on the kernel
// that changed, plus the runtime witness that NOTHING ON THE GPU WRITES H.
//
// The buffer is bound `read`, and SE-STRUCTURE asserts that as text; this reads
// it back off the device and holds it element-exact against the CPU mirror,
// which is the claim the per-grain design actually rests on.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s3 = S.sim3d();
    const PORE = 4095;
    await window.__ht3.cast3(2600, 0);
    s3.deposit(6);
    const before = await s3.readGrainVolume();
    const phiB = await s3.readPhiVolume();
    const dirBefore = s3.dir;
    await s3.anneal(4);
    const after = await s3.readGrainVolume();
    const phiA = await s3.readPhiVolume();
    const ids = new Set(before);
    let changed = 0, invented = 0, zeroed = 0, movedLiquid = 0, movedPore = 0;
    for (let i = 0; i < before.length; i++) {
      const a = before[i], b = after[i];
      if (a !== b) {
        changed++;
        if (b === 0) zeroed++;
        if (!ids.has(b)) invented++;
        if (phiB[i] < 0.5) movedLiquid++;
        if (a === PORE) movedPore++;
      }
    }
    let phiDiff = 0;
    for (let i = 0; i < phiB.length; i++) if (phiB[i] !== phiA[i]) { phiDiff++; if (phiDiff > 4) break; }
    const back = await s3.readStored();
    const cpu = s3.storedCPU();
    let hMismatch = back ? 0 : -1;
    if (back) for (let i = 0; i < back.length; i++) if (back[i] !== cpu[i]) hMismatch++;
    return {
      changed, invented, zeroed, movedLiquid, movedPore, phiDiff,
      dirBefore, dirAfter: s3.dir, voxels: before.length,
      hMismatch, hLiquid: cpu[0], hPore: cpu[PORE], hSpread: Math.max(...cpu) > 0,
    };
  });
  const ok = out.changed > 0 && out.invented === 0 && out.zeroed === 0
    && out.movedLiquid === 0 && out.movedPore === 0 && out.phiDiff === 0
    && out.dirBefore === out.dirAfter
    && out.hMismatch === 0            // the GPU never wrote H
    && out.hLiquid === 0 && out.hPore === 0   // id 0 and the pore slot stay clean
    && out.hSpread === true;          // and the deposit actually deposited
  check("HT3-SE-COHERENCE", ok, out);
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
  const out = await page.evaluate(async hp => {
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
    const sigOf = st => hp.s0 + hp.kHP / Math.sqrt(dOf(st) * 1e-6);
    const rep = report.replace(/\s+/g, " ");
    // H6 in the volume: the σ_y row must ride the ⟨V⟩-equivalent d̄ — the
    // dimension switch is exactly where a cached 2D census once printed
    // d₀ = 0.0 µm with a straight face
    const sig = rep.match(/σ_y\s+([\d.]+)\s*→\s*([\d.]+)\s*MPa/);
    return {
      opened: true, armed: true, refuse, busyDuring, runDuring, stillBusy,
      grainsBefore: before.grainCount, grainsAfter: after.grainCount,
      dBefore: +dOf(before).toFixed(1), dAfter: +dOf(after).toFixed(1), dPred,
      ratioToLaw: +(dOf(after) / dPred).toFixed(3),
      twinCtrBefore, twinCtrAfter,
      sigRow: sig ? { b: +sig[1], a: +sig[2] } : null,
      sigBExp: +sigOf(before).toFixed(1), sigAExp: +sigOf(after).toFixed(1),
      vEquiv: /⟨V⟩-equivalent/.test(rep),
      // no spec was dialled, so the card must carry σ_y WITHOUT a verdict —
      // a pass/fail against a spec nobody set would be an invented judgement
      specRow: /spec σ_y/.test(rep),
      // 1600: the volume's ASTM-n/a note, the H3 twin-refusal sentence, the
      // H4/H5 homog + oxide rows AND the H6 strength row must all survive
      // the slice
      report: rep.slice(0, 1600),
    };
  }, AL_HP);
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
    // H4/H5 wiring: the alloy is off in this cast, so the homog line is the
    // canTreat hint, and aluminium's oxide line is its passive-film nanometres
    && /solute field/.test(out.report) && /scale .*nm/.test(out.report)
    && /before/.test(out.report) && /after/.test(out.report) && /law endpoint/.test(out.report)
    // H6: hallPetch on the measured ⟨V⟩ d̄, named as such, and no verdict row
    // for a spec nobody set (the verdict logic itself is gated in HT-PANEL —
    // report() is one code path for both dimensions)
    && out.sigRow && Math.abs(out.sigRow.b - out.sigBExp) < 0.2 && Math.abs(out.sigRow.a - out.sigAExp) < 0.2
    && out.vEquiv && !out.specRow;
  check("HT3-PANEL", ok, out);
}

// ---------------------------------------------------------------------------
// HT-HOMOG-3D — the same exact-eigenvalue check on the volume's solute pair:
// alloy enabled the UI way (lazy allocation), synthetic φ = 1 block, DCT-II
// mode along x (an exact eigenvector of the clamp-edge 7-point stencil, since
// the y/z terms vanish for an x-only field), decay (1 − 2D(1 − cos k))^I.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify, s3 = S.sim3d();
    const n = s3.n;
    S.app.setAlloyOn(true);
    for (let t = 0; t < 60 && !s3.soluteTexture(0); t++) await new Promise(r => setTimeout(r, 50));
    if (!s3.soluteTexture(0)) return { alloc: false };
    const M = 8;
    const st = new Float32Array(n * n * n * 2);
    for (let i = 0; i < n * n * n; i++) { st[i * 2] = 1; st[i * 2 + 1] = 0.2; }
    for (const dir of [0, 1])
      s3.device.queue.writeTexture({ texture: s3.stateTexture(dir) }, st, { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n]);
    const c = new Float32Array(n * n * n);
    for (let i = 0; i < c.length; i++)
      c[i] = 0.3 + 0.1 * Math.cos(Math.PI * M * ((i % n) + 0.5) / n);
    for (const dir of [0, 1])
      s3.device.queue.writeTexture({ texture: s3.soluteTexture(dir) }, c, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    const proj = vol => {
      let a = 0, mean = 0;
      for (let i = 0; i < vol.length; i++) {
        a += vol[i] * Math.cos(Math.PI * M * ((i % n) + 0.5) / n);
        mean += vol[i];
      }
      return { a, mean: mean / vol.length };
    };
    const v0 = await s3.readSoluteVolume();
    if (!v0) return { alloc: true, read: false };
    const p0 = proj(v0);
    const I = 120;
    const got = await s3.homogenize(I);
    const v1 = await s3.readSoluteVolume();
    const p1 = proj(v1);
    return { alloc: true, read: true, n, M, I, got, a0: p0.a, a1: p1.a, mean0: p0.mean, mean1: p1.mean };
  });
  if (!out.alloc || !out.read) {
    check("HT-HOMOG-3D", false, out);
  } else {
    const k = Math.PI * out.M / out.n;
    const mu = 1 - 2 * SH3.HOMOG_D3 * (1 - Math.cos(k));
    const discrete = Math.pow(mu, out.I);
    const continuum = Math.exp(-SH3.HOMOG_D3 * k * k * out.I);
    const meas = out.a1 / out.a0;
    const err = Math.abs(meas - discrete) / discrete;
    const consErr = Math.abs(out.mean1 - out.mean0) / out.mean0;
    check("HT-HOMOG-3D", out.got === out.I && err < 2e-3 && consErr < 1e-6, {
      measured: +meas.toFixed(6), discrete: +discrete.toFixed(6), continuum: +continuum.toFixed(6),
      discretizationGapPct: +((continuum / discrete - 1) * 100).toFixed(3),
      relErr: +err.toExponential(2), consErr: +consErr.toExponential(2),
    });
  }
}

// ---------------------------------------------------------------------------
// HT3-SE-SELECTION (v7.0 C3a) — the physics claim, with a kill criterion that
// was written down and approved BEFORE the measurement ran.
//
// Every other SE gate asserts that the coupling is wired correctly: the barrier
// is the one the stencil derives, a uniform field is inert, the zero arm is
// bit-identical, the buffer nothing writes stays unwritten. None of them asserts
// that the mechanism DOES ANYTHING USEFUL to a real casting, and a milestone
// whose gates all pass on a bicrystal has measured a fixture, not a model.
//
// The claim: a heterogeneous stored-energy field must SELECT. Strain-induced
// boundary migration is defined by its direction — boundaries sweep INTO the
// more-deformed grain — so over a treatment the LESS-deformed half of the
// casting must take volume share from the more-deformed half. That is one
// number, it has a sign, and it has a null: the same cast annealed with no
// field at all, partitioned by the SAME labels, where the labels mean nothing.
//
// THE PRE-REGISTERED KILL CRITERION, approved before this ran: the driven
// share shift must be POSITIVE and at least 3x the magnitude of the undriven
// control's on EVERY replicate. Three casts, three different pours (the LCG
// seed moves; the work fabric does not, which is exactly what WORK_SALT is
// fixed for). If it holds on two of three, C3a's drive is noise dressed as a
// mechanism and this gate is supposed to say so — pre-registering the number is
// the only thing that stops a threshold from being chosen after the fact to fit
// whatever came out.
//
// The control is doing real work here and is not ceremony. Coarsening removes
// small grains whatever drives it, so ANY partition of a shrinking grain
// population drifts; without measuring that drift on the same cast with the
// same labels there is no way to know whether a positive shift is selection or
// arithmetic. The 3x is a ratio against the measured drift, not an absolute.
{
  const SEEDS = [0x2f6e2b1, 0x71c3d5f, 0x13a97e5];
  const WORK = 6, SWEEPS = 90;
  const reps = [];
  for (const seed of SEEDS) {
    const r = await page.evaluate(async (seed, WORK, SWEEPS) => {
      const S = window.__solidify, s3 = S.sim3d(), n = s3.n;
      S.app.setMaterial("al");
      await window.__ht3.cast3(2600, 0, seed);
      // one pour, restored into both arms — HT3-SE-OFF-IDENTITY's reason
      // verbatim: cast3's freeze loop stops on a wall-clock-sensitive stats
      // poll, so two successive casts are not the same specimen, and arms that
      // differ by their CAST cannot witness anything about the kernel
      const snap = await s3.readGrainVolume();
      const restore = () => {
        for (const dir of [0, 1]) {
          s3.device.queue.writeTexture({ texture: s3.grainTexture(dir) }, snap,
            { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
        }
      };
      // the labels: the fabric's own per-id values, read off the CPU mirror
      // AFTER a deposit. Both arms are partitioned by these, including the
      // control — where they are labels attached to nothing.
      s3.deposit(WORK);
      const h = Float32Array.from(s3.storedCPU());
      const PORE = 4095;
      const census = vol => {
        const cnt = new Uint32Array(4096);
        for (let i = 0; i < vol.length; i++) {
          const id = vol[i];
          if (id > 0 && id < PORE) cnt[id]++;
        }
        return cnt;
      };
      const c0 = census(snap);
      // the median h over the ids this cast actually owns — a median, not the
      // fabric's own mid-point, so the split is 50/50 by GRAIN COUNT on this
      // specimen rather than on the fabric in the abstract
      const live = [];
      for (let id = 1; id < PORE; id++) if (c0[id] > 0) live.push(id);
      const med = live.map(id => h[id]).sort((a, b) => a - b)[Math.floor(live.length / 2)];
      const lowShare = cnt => {
        let lo = 0, all = 0;
        for (const id of live) { all += cnt[id]; if (h[id] < med) lo += cnt[id]; }
        return all > 0 ? lo / all : 0;
      };
      // volume-weighted mean stored energy over the surviving structure — a
      // second, independent read of the same claim: selection must LOWER it
      const meanH = cnt => {
        let sum = 0, all = 0;
        for (const id of live) { sum += cnt[id] * h[id]; all += cnt[id]; }
        return all > 0 ? sum / all : 0;
      };
      const arm = async (setup) => {
        restore();
        setup(s3);
        await s3.anneal(SWEEPS);
        const post = await s3.readGrainVolume();
        let flips = 0;
        for (let i = 0; i < snap.length; i++) if (snap[i] !== post[i]) flips++;
        const c = census(post);
        let alive = 0;
        for (const id of live) if (c[id] > 0) alive++;
        return { share: lowShare(c), meanH: meanH(c), flips, alive };
      };
      const driven = await arm(s => s.deposit(WORK));
      const ctrl = await arm(s => { s.deposit(0); s.clearStored(); });
      // a fingerprint of the POUR itself. The first cut of this gate asked
      // whether the three casts had different GRAIN COUNTS — they never do,
      // because cast3 seeds exactly 2600 and every seed survives a full freeze,
      // so a clause meant to prove three specimens proved only that the helper
      // is deterministic. An FNV walk over the id volume is the thing that was
      // actually meant.
      let fp = 2166136261;
      for (let i = 0; i < snap.length; i++) { fp ^= snap[i]; fp = Math.imul(fp, 16777619); }
      // the ladder, on the default pour only: is the selection GRADED by the
      // drive, or is any field enough? A single point at mid-dial cannot tell
      // a working coupling from one weakened fourfold, because the share metric
      // saturates hard — 0.30 of a possible 0.50 already at a mean of 0.75 J_b.
      //
      // `uBar` is what stays sensitive when it does: the volume-weighted mean of
      // the DIMENSIONLESS fabric over the surviving structure. The labels `h`
      // are the WORK-scale field, and every rung's actual deposit is the same
      // fabric scaled — so dividing by WORK puts every rung in one unit whose
      // as-deposited value is 1, and selection is the distance below it.
      const ladder = [];
      if (seed === 0x2f6e2b1) {
        for (const w of [0.75, 1.5, 3]) {
          const a = await arm(s => s.deposit(w));
          ladder.push({ w, dShare: +(a.share - lowShare(c0)).toFixed(5), uBar: +(a.meanH / WORK).toFixed(4) });
        }
      }
      return {
        seed, grains: live.length, med: +med.toFixed(3), fp: fp >>> 0, ladder,
        share0: lowShare(c0), meanH0: meanH(c0),
        driven, ctrl,
      };
    }, seed, WORK, SWEEPS);
    reps.push(r);
  }
  const rows = reps.map(r => ({
    seed: "0x" + r.seed.toString(16),
    grains: r.grains,
    dDriven: +(r.driven.share - r.share0).toFixed(5),
    dCtrl: +(r.ctrl.share - r.share0).toFixed(5),
    ratio: Math.abs(r.ctrl.share - r.share0) > 0
      ? +((r.driven.share - r.share0) / Math.abs(r.ctrl.share - r.share0)).toFixed(2)
      : Infinity,
    meanH: { before: +r.meanH0.toFixed(3), driven: +r.driven.meanH.toFixed(3), ctrl: +r.ctrl.meanH.toFixed(3) },
    alive: { driven: r.driven.alive, ctrl: r.ctrl.alive },
    flips: { driven: r.driven.flips, ctrl: r.ctrl.flips },
  }));
  // liveness before verdict: every arm has to have actually annealed something,
  // and the three pours have to be three different specimens. A gate that
  // compares two frozen fields passes for the wrong reason (lessons.md:33).
  const live = reps.every(r => r.driven.flips > 1000 && r.ctrl.flips > 1000)
    && new Set(reps.map(r => r.fp)).size === 3;
  // THE PRE-REGISTERED CRITERION, applied exactly as written above
  const passes = rows.map(r => r.dDriven > 0 && r.ratio >= 3);
  const ok = live && passes.every(Boolean)
    // and the direction, on the independent read: the drive must LOWER the
    // volume-weighted stored energy, and the control must not
    && reps.every(r => r.driven.meanH < r.meanH0 && r.driven.meanH < r.ctrl.meanH);
  const ladder = reps.find(r => r.ladder.length)?.ladder ?? [];
  const uBar0 = (reps[0].meanH0 ?? 0) / WORK;
  // SENSITIVITY, with the band set after measuring and not before — the repo's
  // rule for a tolerance, and the opposite of the 3x above, which is
  // pre-registered precisely because it is a verdict rather than a range.
  // Measured: dShare 0.296 / 0.441 / 0.495 and uBar 0.606 / 0.377 / 0.227
  // against an as-deposited 1.0. Both must stay ordered, and the lowest rung —
  // the one furthest from the share metric's ceiling — must stay in its band,
  // which is where a coupling weakened by a constant factor shows up first.
  const graded = ladder.length === 3
    && ladder[0].dShare < ladder[1].dShare && ladder[1].dShare < ladder[2].dShare
    && ladder[2].dShare <= rows[0].dDriven + 0.01
    && ladder[0].uBar > ladder[1].uBar && ladder[1].uBar > ladder[2].uBar
    && ladder[0].uBar < uBar0
    && ladder[0].dShare > 0.18 && ladder[0].dShare < 0.40;
  check("HT3-SE-SELECTION", ok && graded, {
    criterion: "dDriven > 0 and >= 3x |dCtrl| on all three, pre-registered",
    live, passes, graded, work: WORK, sweeps: SWEEPS, rows,
    ladder, uBarAsDeposited: +uBar0.toFixed(4), fps: reps.map(r => r.fp.toString(16)),
  });
}

// ---------------------------------------------------------------------------
// HT3-SE-PANEL (v7.0 C3a) — the cold work's operator surface, and the one thing
// this milestone REMOVES from it.
//
// HT-PIN-PANEL's shape, with the opposite emphasis. C2 added a dial that made
// the panel say MORE (a pinned limit, a d_lim row); C3a adds one that makes it
// say LESS, and the withdrawal is the part that can rot silently: the endpoint
// sentence and the σ_y prediction are printed by code paths that do not know
// about stored energy, so the failure mode is a panel that keeps confidently
// predicting an endpoint for a run whose driving force its coefficients were
// never fitted against.
//
// Copper on purpose. It is one of the two materials — cobalt is the other, per
// HT-TWIN-MATRIX — where `canTreat("twins")` says yes, so this single run also
// exercises the hold-back: Σ3 plates are allocated GPU-side
// mid-anneal, which is precisely when the work fabric cannot tell them what
// they should have inherited, and C3a declines to invent it.
{
  const out = await page.evaluate(async () => {
    const S = window.__solidify;
    S.app.setMaterial("cu");
    await window.__ht3.cast3(2600, 0);
    S.app.startHeat();
    const panel = document.getElementById("heattreat");
    if (!panel) return { opened: false };
    const btn = document.getElementById("htRun");
    const note = () => document.getElementById("htNote").textContent;
    for (let i = 0; i < 40 && /waiting/.test(note()); i++) await new Promise(r => setTimeout(r, 100));
    const dials = panel.querySelectorAll('input[type="range"]');
    const set = (i, v) => { dials[i].value = String(v); dials[i].dispatchEvent(new Event("input", { bubbles: true })); };
    const arrowOf = s => (s.match(/→\s*([\d.]+)\s*µm/) ?? [])[1] ?? null;
    const sweepsOf = s => parseInt((s.match(/([\d,]+) MC sweeps/) ?? [])[1]?.replace(/,/g, "") ?? "0", 10);

    // a hold this 125 µm specimen will accept: copper coarsens fast, so the
    // domain limit refuses the schedules aluminium runs. Walk DOWN until the
    // run arms, and record which rung armed it — a gate that silently settles
    // on a one-minute no-op has measured the dial, not the treatment
    let hold = 0;
    for (const m of [30, 15, 8, 4, 2]) {
      set(1, m);
      for (let i = 0; i < 30 && btn.disabled; i++) await new Promise(r => setTimeout(r, 100));
      if (!btn.disabled) { hold = m; break; }
    }
    if (!hold) return { opened: true, armed: false, note: note().slice(0, 240) };

    set(2, 30);                                   // a spec, so its sentence can be withdrawn
    const asCastNote = note();                    // the endpoint, still printed
    set(5, 4);                                    // ♨ cold work, 4 J_b mean
    const workedNote = note();
    const sweeps = sweepsOf(workedNote);
    // wait for ARMED immediately before clicking, not just at the end of the
    // hold walk-down. The dials in between each re-run plan(), and the panel's
    // 4 Hz census poll can land in the same window — a click on a disabled
    // button is silently a no-op, and the gate then reads an empty card and
    // reports six regex failures instead of the one thing that went wrong.
    // (Seen: `report` empty, `revertedArrow` identical to `asCastArrow`, every
    // card clause false — a treatment that never started.)
    for (let i = 0; i < 40 && btn.disabled; i++) await new Promise(r => setTimeout(r, 100));
    const armedAtClick = !btn.disabled;
    btn.click();
    for (let i = 0; i < 100 && !S.heat.busy; i++) await new Promise(r => setTimeout(r, 50));
    const busyDuring = S.heat.busy;
    for (let i = 0; i < 1200 && S.heat.busy; i++) await new Promise(r => setTimeout(r, 100));
    const report = document.getElementById("htReport").textContent.replace(/\s+/g, " ");
    // and back to as cast: the endpoint must come BACK. A withdrawal that
    // cannot be undone is a broken panel wearing an honest sentence.
    const setupWorked = S.heat.setup();
    // …and back to as cast. The endpoint must come BACK — a withdrawal that
    // cannot be undone is a broken panel wearing an honest sentence — and,
    // more importantly, the SOLVER must come back with it. The mode selector
    // lives in `Sim3D.hOn`, so a dial returned to zero stops depositing without
    // stopping driving; the first cut of this gate checked only the note, which
    // is the one surface that never touches the solver, and would have passed a
    // build where the next treatment ran the stored kernel on a field the
    // operator had dialled away while every printed sentence described an
    // undriven run. So this arm RUNS AGAIN and reads `storedOn` off the sim.
    set(5, 0);
    const revertedNote = note();
    const setupReverted = S.heat.setup();
    // A DIAL-FLOOR near-noop for the second run, HT-PIN-PANEL's idiom: the
    // first treatment left this 125 mu-m specimen at ~40 mu-m, where the domain
    // limit refuses anything warm, and re-casting is not an option because
    // reset() clears the stored field and would hide the very thing this arm
    // exists to catch. Zero sweeps is fine here: the witness is the MODE
    // SELECTOR read straight off the solver, which run() sets before it looks
    // at the sweep count at all.
    set(0, 100); set(1, 2);
    for (let i = 0; i < 30 && btn.disabled; i++) await new Promise(r => setTimeout(r, 100));
    const rearmed = !btn.disabled;
    let storedOnAfter = null, report2 = "";
    if (rearmed) {
      btn.click();
      for (let i = 0; i < 100 && !S.heat.busy; i++) await new Promise(r => setTimeout(r, 50));
      for (let i = 0; i < 900 && S.heat.busy; i++) await new Promise(r => setTimeout(r, 100));
      storedOnAfter = S.sim3d().storedOn;
      report2 = document.getElementById("htReport").textContent.replace(/\s+/g, " ");
    }
    S.heat.close();
    return {
      opened: true, armed: true, hold, sweeps,
      dialCount: dials.length,
      asCastArrow: arrowOf(asCastNote),
      workedArrow: arrowOf(workedNote),
      revertedArrow: arrowOf(revertedNote),
      workedNote: workedNote.slice(0, 700),
      report: report.slice(0, 1700),
      setupWorked, setupReverted, armedAtClick, busyDuring, cardLen: report.length,
      rearmed, storedOnAfter, report2: report2.slice(0, 700),
    };
  });
  const rep = out.report ?? "";
  const ok = out.opened && out.armed
    // the treatment actually RAN — asserted before anything is read off the
    // card, so a click that landed on a disabled button names itself
    && out.armedAtClick && out.busyDuring && out.cardLen > 0
    && out.dialCount === 6                                   // the sixth dial, volume only
    && out.sweeps >= 50                                      // the armed schedule is a real treatment
    // THE WITHDRAWAL: an endpoint before, none while worked, and it comes back
    && out.asCastArrow !== null && out.workedArrow === null && out.revertedArrow !== null
    && /cold work 4\.0 J_b mean/.test(out.workedNote)
    && /0–8\.0 J_b across grains/.test(out.workedNote)
    && /law endpoint is withdrawn/.test(out.workedNote)
    && /a drive, not a strength/.test(out.workedNote)
    && /judged on the measured census/.test(out.workedNote)       // the spec sentence, withdrawn
    && !/J\/m³/.test(out.workedNote)                              // never an SI energy density
    // the card: withdrawn with NO micron figure, the cold-work row, the σ_y
    // clause that stops "no work hardening" reading as "cold work is absent",
    // and the twin hold-back, on a material that would otherwise twin
    && /law endpoint withdrawn/.test(rep) && !/law endpoint [\d.]+ µm/.test(rep)
    && /cold work 4\.0 J_b mean deposited/.test(rep)
    && /H_S = H₀\/\(1 \+ rec·H₀\)/.test(rep)
    && /not a strength/.test(rep)
    && /twins held back while cold work is dialled/.test(rep)
    // the share link: six long while worked, with the work BEHIND the
    // dispersion pair at its off defaults — and back to the three-element
    // pre-C2 shape the moment the dial returns to zero, so an as-cast link
    // minted today is byte-what it was before this mode existed
    && Array.isArray(out.setupWorked) && out.setupWorked.length === 6
    && out.setupWorked[3] === 0 && out.setupWorked[4] === 2 && out.setupWorked[5] === 4
    && Array.isArray(out.setupReverted) && out.setupReverted.length === 3
    // the revert reaches the SOLVER, not just the note: the second run leaves
    // the mode off, prints a law endpoint again, and carries no cold-work row
    && out.rearmed && out.storedOnAfter === false
    && /law endpoint [\d.]+ µm/.test(out.report2) && !/cold work/.test(out.report2);
  check("HT3-SE-PANEL", ok, out);
}

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
await viteServer.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
