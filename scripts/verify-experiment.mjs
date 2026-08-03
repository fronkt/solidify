// EXP-* — the comparator layer (src/experiment.ts), browser-free half.
//
// v7.0 C1. Two families of check:
//
//   EXP-FIT-*      the through-origin power-law fit + r²-window band that
//                  verify-heattreat-gpu.mjs used to inline four times. The
//                  parity check holds the extracted code bit-for-bit against
//                  a VERBATIM copy of the old inline arithmetic — the
//                  PASSSPLIT doctrine applied to statistics: an extraction
//                  that moved anything is not an extraction.
//   EXP-DECLARED / EXP-REFUSE-* / EXP-RENDERED
//                  the bench's doctrine, mechanical: an undeclared comparison
//                  throws, an unmatched or dead one refuses to render means,
//                  and a rendered one carries the controlled variable's name
//                  in its own output.
//
// Loads the TypeScript through vite's SSR loader rather than re-implementing
// it — a test that re-implements the thing it is testing proves nothing.
// Browser-free on purpose: this half IS wired into the GitHub workflow.
//
//   node scripts/verify-experiment.mjs [outDir]
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const EXP = await server.ssrLoadModule("/src/experiment.ts");
const { seedHex } = await server.ssrLoadModule("/src/rng.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

// ---------------------------------------------------------------------------
// The reference implementation for parity: the OLD inline code from
// verify-heattreat-gpu.mjs (pre-C1), copied VERBATIM — including the unused
// d0eff field and the two-pass band scan. Do not "improve" this copy; its
// whole value is that it is the code the shipped constants were measured with.
const inlineScan = (use, d0) => {
  let best = null;
  for (let m = 1.0; m <= 4.5; m += 0.005) {
    const y0 = Math.pow(d0, m);
    let sxy = 0, sxx = 0;
    for (const p of use) { const y = Math.pow(p.d, m) - y0; sxy += p.S * y; sxx += p.S * p.S; }
    const K = sxy / sxx;
    let ssRes = 0, ssTot = 0;
    for (const p of use) {
      const y = Math.pow(p.d, m) - y0;
      ssRes += (y - K * p.S) ** 2;
      ssTot += y * y;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    if (K > 0 && (!best || r2 > best.r2)) best = { m: +m.toFixed(3), K, r2, d0eff: d0 };
  }
  if (!best) return null;
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
  return best;
};
const inlineFitAt = (use, d0, m) => {
  const y0 = Math.pow(d0, m);
  let sxy = 0, sxx = 0;
  for (const p of use) { const y = Math.pow(p.d, m) - y0; sxy += p.S * y; sxx += p.S * p.S; }
  const kAt = sxy / sxx;
  let ssRes = 0, ssTot = 0;
  for (const p of use) {
    const y = Math.pow(p.d, m) - y0;
    ssRes += (y - kAt * p.S) ** 2; ssTot += y * y;
  }
  return { K: kAt, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
};

// Two ladders in the real gate's shape (S in the 2D fit window, d0 a real
// as-cast diameter). The exact ladder IS the law; the jittered one carries a
// fixed, hand-written ±0.6 % roughness — no RNG in a gate.
const M_TRUE = 2.44, K_TRUE = 3.7e-3, D0 = 3.2;
const S_RUNGS = [300, 800, 1400, 2100, 2800, 3200];
const law = S => Math.pow(Math.pow(D0, M_TRUE) + K_TRUE * S, 1 / M_TRUE);
const exact = S_RUNGS.map(S => ({ S, d: law(S) }));
const JIT = [1.004, 0.994, 1.002, 0.997, 1.005, 0.998];
const jittered = S_RUNGS.map((S, i) => ({ S, d: law(S) * JIT[i] }));

// ---------------------------------------------------------------------------
// 1. EXP-FIT-EXACT — synthetic exact law in, the law's own constants out.
{
  const scan = EXP.scanPower(exact, D0);
  const at = EXP.fitPowerAt(exact, D0, M_TRUE);
  const kErr = Math.abs(at.K / K_TRUE - 1);
  // scan grid is 0.005 wide, so the best m can only be pinned to a grid point;
  // the band must bracket the true exponent
  const ok = scan !== null && Math.abs(scan.m - M_TRUE) <= 0.011
    && scan.band[0] <= M_TRUE && M_TRUE <= scan.band[1]
    && kErr < 1e-6 && at.r2 > 1 - 1e-9
    && Number.isFinite(at.K) && at.K > 0;                 // liveness: a real fit, not NaN agreeing with NaN
  check("EXP-FIT-EXACT", ok, {
    m: scan?.m, band: scan?.band, K: at.K, kRelErr: +kErr.toExponential(2), r2: at.r2,
  });
}

// 2. EXP-FIT-PARITY — extracted vs verbatim-inline, bit-for-bit, both ladders.
//    Object.is(NaN, NaN) is true, so parity alone would pass on two broken
//    fits — the finiteness clause is the liveness half (lessons.md).
{
  let ok = true;
  const detail = {};
  for (const [tag, pts] of [["exact", exact], ["jittered", jittered]]) {
    const a = EXP.scanPower(pts, D0);
    const b = inlineScan(pts, D0);
    const fa = EXP.fitPowerAt(pts, D0, M_TRUE);
    const fb = inlineFitAt(pts, D0, M_TRUE);
    const same = a !== null && b !== null
      && a.m === b.m && Object.is(a.K, b.K) && Object.is(a.r2, b.r2)
      && a.band[0] === b.band[0] && a.band[1] === b.band[1]
      && Object.is(fa.K, fb.K) && Object.is(fa.r2, fb.r2);
    const live = a !== null && Number.isFinite(a.K) && a.K > 0 && Number.isFinite(fa.r2);
    ok = ok && same && live;
    detail[tag] = { same, live, m: a?.m, K: a?.K, band: a?.band };
  }
  check("EXP-FIT-PARITY", ok, detail);
}

// 3. EXP-FIT-INADMISSIBLE — a ladder whose grains sit BELOW the pinned d0
//    (an anneal that "shrank" its grains) makes every y negative, so no m has
//    an admissible K > 0 fit — and the scan must say so with null, not with a
//    least-bad number. (Rungs merely decreasing with S are not enough: while
//    they stay above d0 every S·y product is still positive and so is K.)
//    The difference half: the growing ladder fits fine.
{
  const shrink = S_RUNGS.map(S => ({ S, d: D0 * (1 - 0.02 * S / 3200) }));
  const grow = EXP.scanPower(exact, D0);
  const bad = EXP.scanPower(shrink, D0);
  check("EXP-FIT-INADMISSIBLE", bad === null && grow !== null && grow.K > 0,
    { shrinking: bad, growing: grow?.m });
}

// 4. EXP-BAND — the replicate band is the range, not a σ; degenerate inputs
//    answer honestly.
{
  const b = EXP.bandOf([3, 9, 6]);
  const one = EXP.bandOf([5]);
  const none = EXP.bandOf([]);
  const ok = b.mean === 6 && b.lo === 3 && b.hi === 9 && b.width === 6 && Math.abs(b.rel - 1) < 1e-12
    && one.width === 0 && one.mean === 5
    && Number.isNaN(none.mean) && Number.isNaN(none.width);
  check("EXP-BAND", ok, { b, one });
}

// ---------------------------------------------------------------------------
// The bench doctrine, on fake casts (the GPU half runs the real ones).
const SEEDS = [0x51105d1f, 0x0be5eed5];
const okSpec = () => ({
  name: "fake census",
  swept: "coolRate",
  values: [0.35, 0.7],
  seeds: SEEDS.slice(),
  controlled: { name: "solid fraction at read", tol: 0.05 },
});
// distinctive y values so their MEAN (222) can be asserted present/absent by
// arithmetic done here, not by the formatter under test (the LAB4 lesson: an
// assertion string that goes through the code under test proves nothing)
const fakeCast = async (value, seed) =>
  ({ y: value < 0.5 ? (seed === SEEDS[0] ? 111 : 333) : (seed === SEEDS[0] ? 444 : 446), ctrl: 0.51 + (seed % 7) * 1e-3 });

// 5. EXP-DECLARED — a sweep that cannot state its own experiment throws; the
//    fully declared twin runs. (The difference half is the liveness half.)
{
  const throws = async (mut) => {
    const s = okSpec(); mut(s);
    try { await EXP.runSweep(s, fakeCast); return false; } catch (e) { return e instanceof TypeError; }
  };
  const t1 = await throws(s => { s.controlled.name = "  "; });
  const t2 = await throws(s => { delete s.controlled; });
  const t3 = await throws(s => { s.controlled.tol = 0; });
  const t4 = await throws(s => { s.swept = ""; });
  const t5 = await throws(s => { s.values = []; });
  const t6 = await throws(s => { s.seeds = []; });
  const good = await EXP.runSweep(okSpec(), fakeCast);
  check("EXP-DECLARED", t1 && t2 && t3 && t4 && t5 && t6 && good.ok && good.rows.length === 2,
    { throws: [t1, t2, t3, t4, t5, t6], declaredRuns: good.ok });
}

// 6. EXP-REFUSE-UNMATCHED — arms that did not reach the same matched state do
//    not render: no means, no band geometry, the refusal names the variable,
//    the achieved spread and the stated tolerance.
{
  const drifting = async (value, seed) =>
    ({ y: seed === SEEDS[0] ? 111 : 333, ctrl: value < 0.5 ? 0.30 : 0.60 });   // ctrl spread 0.30 > tol 0.05
  const res = await EXP.runSweep(okSpec(), drifting);
  const text = EXP.sweepText(res);
  const lay = EXP.bandLayout(res, 252, 128);
  const ok = !res.ok
    && /REFUSED/.test(text)
    && text.includes("solid fraction at read")
    && text.includes("0.05")                       // the stated tolerance
    && !text.includes("222")                       // mean of 111/333 must NOT render
    && lay.labels.some(l => l.kind === "refusal")
    && lay.band.length === 0 && lay.means.length === 0 && lay.pts.length === 0
    && Number.isFinite(res.ctrlWidth) && res.ctrlWidth > 0.05;   // liveness: a real measured spread
  check("EXP-REFUSE-UNMATCHED", ok, { refusal: res.refusal, ctrlWidth: res.ctrlWidth });
}

// 7. EXP-REFUSE-DEAD — a NaN measurement is a dead run, and a dead run is
//    named (value, seed), never averaged over.
{
  const dead = async (value, seed) =>
    ({ y: value > 0.5 && seed === SEEDS[1] ? NaN : 100, ctrl: 0.5 });
  const res = await EXP.runSweep(okSpec(), dead);
  const text = EXP.sweepText(res);
  const ok = !res.ok
    && res.refusal.includes("non-measurement")
    && res.refusal.includes("0.7") && res.refusal.includes(seedHex(SEEDS[1]))
    && /REFUSED/.test(text);
  check("EXP-REFUSE-DEAD", ok, { refusal: res.refusal });
}

// 8. EXP-RENDERED — the rendered comparison carries its own provenance: the
//    controlled variable BY NAME with its achieved spread, every seed, and
//    the means the fake data implies (computed here, independently).
{
  const res = await EXP.runSweep(okSpec(), fakeCast);
  const text = EXP.sweepText(res);
  const lay = EXP.bandLayout(res, 252, 128);
  const meanSlow = (111 + 333) / 2, meanFast = (444 + 446) / 2;
  const ok = res.ok
    && res.rows[0].band.mean === meanSlow && res.rows[1].band.mean === meanFast
    && text.includes("controlled solid fraction at read")
    && SEEDS.every(s => text.includes(seedHex(s)))
    && text.includes(String(meanSlow)) && text.includes(String(meanFast))
    && !/REFUSED/.test(text)
    && lay.labels.some(l => l.kind === "controlled")
    && lay.band.length === 2 && lay.pts.length === 4
    && lay.pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  check("EXP-RENDERED", ok, {
    means: res.rows.map(r => r.band.mean), ctrlWidth: +res.ctrlWidth.toFixed(4),
    labels: lay.labels.map(l => l.kind),
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
