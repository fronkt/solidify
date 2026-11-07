// RX-* — C3b recrystallization arithmetic, checked without a browser.
//
// src/recrystallize.ts holds what the GPU gates will lean on: the Avrami fit
// the card and figure print, the log-spaced sample schedule, and the Potts
// bond counting that says which nuclei can grow at a given stored energy; and
// the free-id count nuclei and twins allocate from, including a counter the
// growth twins wrapped past 0.
// Design and citations: docs/C3B-RECRYSTALLIZATION-DESIGN.md.
//
//   node scripts/verify-recrystallize.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const X = await server.ssrLoadModule("/src/recrystallize.ts");
const { Rng } = await server.ssrLoadModule("/src/rng.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const jmak = (S, n, k, x0 = 0) => S.map(s => x0 + (1 - x0) * (1 - Math.exp(-k * s ** n)));

// 1. RX-AVRAMI-FIT — exact JMAK data returns its own n for n = 1..4; rescaling
//    the sweep clock moves only the intercept; points outside the window are
//    excluded and counted; too few points or an X = 1 in the window refuse.
//    Falsification arm: the nuclei' own starting volume x0 bends the left end
//    of the line, and the raised lower bound max(0.05, 3 x0) is what keeps n.
{
  const S = X.sweepSchedule(1, 4000, 60);
  const rec = [1, 2, 3, 4].map(n => {
    const k = Math.pow(1 / 300, n);            // X = 0.5 near S ~ 250 for every n
    const f = X.avramiFit(S, jmak(S, n, k));
    return { n, got: f.n, err: Math.abs(f.n - n), r2: f.r2, used: f.used, excluded: f.excluded };
  });
  const exact = rec.every(r => r.err < 1e-9 && r.used >= 4);
  const counted = rec.every(r => r.used + r.excluded === S.length && r.excluded > 0);
  const k3 = Math.pow(1 / 300, 3), data3 = jmak(S, 3, k3);
  const a = X.avramiFit(S, data3), b = X.avramiFit(S.map(s => s * 7.5), data3);
  const rescale = Math.abs(a.n - b.n) < 1e-9 && Math.abs((a.lnK - b.lnK) - 3 * Math.log(7.5)) < 1e-9;
  const few = X.avramiFit([10, 20, 30], [0.1, 0.4, 0.8]);
  const full = X.avramiFit([1, 2, 3, 4, 5], [0.1, 0.3, 0.6, 0.9, 1], [0.05, 1]);
  const refuse = "why" in few && "why" in full;
  // x0 = 0.04: every nucleus already counted, so the early points are offset
  const x0 = 0.04, off = jmak(S, 3, k3, x0);
  const naive = X.avramiFit(S, off, X.AVRAMI_WINDOW, 0);
  const bounded = X.avramiFit(S, off, X.AVRAMI_WINDOW, x0);
  const naiveErr = Math.abs(naive.n - 3), boundedErr = Math.abs(bounded.n - 3);
  const offsetMatters = naiveErr > 0.15 && boundedErr < naiveErr / 2;
  check("RX-AVRAMI-FIT", exact && counted && rescale && refuse && offsetMatters, {
    recovered: rec.map(r => ({ n: r.n, err: Number(r.err.toExponential(2)) })),
    countedExclusions: counted, rescaleInvariant: rescale, refusals: refuse,
    offsetArm: { naiveN: Number(naive.n.toFixed(3)), boundedN: Number(bounded.n.toFixed(3)), lowerBound: bounded.window[0] },
  });
}

// 2. RX-SCHEDULE — strictly increasing integers spanning the asked range.
{
  const s = X.sweepSchedule(1, 600, 24);
  const inc = s.every((v, i) => i === 0 || v > s[i - 1]);
  const ints = s.every(Number.isInteger);
  check("RX-SCHEDULE", inc && ints && s[0] === 1 && s[s.length - 1] === 600 && s.length >= 18,
    { count: s.length, first: s[0], last: s[s.length - 1], increasing: inc });
}

// 3. RX-LATTICE-THRESHOLDS — one bond counter reproduces the cited triangular
//    thresholds (a one-site nucleus grows above H/J = 4, a three-site one above
//    2, a flat front above 2: LA-UR-86-421) and the 26-neighbour flat front
//    H_FLAT_3D = 8; then it derives the band for the shipped radius-2 sphere
//    and requires the top of the cold-work dial (20 J_b) to clear it.
{
  const T = X.TRIANGULAR, C = X.CUBIC26;
  const one = X.growthBarrier([[0, 0, 0]], T);
  const three = X.growthBarrier([[0, 0, 0], [1, 0, 0], [0, 1, 0]], T);
  const flatT = X.flatFrontBarrier(T), flat3 = X.flatFrontBarrier(C);
  const sphere = X.digitalSphere(2);
  const grow3 = X.growthBarrier(sphere, C), revert3 = X.revertBarrier(sphere, C);
  const DIAL_TOP = 20;
  const ok = one === 4 && three === 2 && flatT === 2 && flat3 === 8 && sphere.length === 33
    && C.length === 26 && grow3 < DIAL_TOP && revert3 < DIAL_TOP;
  check("RX-LATTICE-THRESHOLDS", ok, {
    triangular: { oneSite: one, threeSite: three, flat: flatT }, cubic26Flat: flat3,
    sphereR2: { voxels: sphere.length, growAboveH: grow3, tipsRevertBelowH: revert3 }, dialTop: DIAL_TOP,
  });
}

// 4. RX-JMAK-CPU — site-saturated Poisson nuclei on a periodic 64^3 lattice:
//    X(S) is the fraction within R(S) of the nearest nucleus. With every
//    nucleus on one growth law, ln(-ln(1-X)) against ln V1 (one nucleus's own
//    volume) has slope 1 whatever R(S) does, so a decaying velocity (recovery)
//    keeps the gate sharp; with constant velocity the slope against ln S is 3.
//    Three seeds; the lattice's discreteness and one realization's Poisson
//    noise are what the band has to absorb.
{
  const L = 64, N = 150;
  const runs = [0x5eed01, 0x5eed02, 0x5eed03].map(seed => {
    const r = new Rng(seed);
    const pts = Array.from({ length: N }, () => [r.next() * L, r.next() * L, r.next() * L]);
    const dmin = new Float32Array(L * L * L);
    for (let z = 0, i = 0; z < L; z++) for (let y = 0; y < L; y++) for (let x = 0; x < L; x++, i++) {
      let best = Infinity;
      for (const p of pts) {
        let dx = Math.abs(x + 0.5 - p[0]); dx = Math.min(dx, L - dx);
        let dy = Math.abs(y + 0.5 - p[1]); dy = Math.min(dy, L - dy);
        let dz = Math.abs(z + 0.5 - p[2]); dz = Math.min(dz, L - dz);
        best = Math.min(best, dx * dx + dy * dy + dz * dz);
      }
      dmin[i] = Math.sqrt(best);
    }
    const sorted = Float64Array.from(dmin).sort();
    const fracWithin = R => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= R) lo = m + 1; else hi = m; } return lo / sorted.length; };
    const S = X.sweepSchedule(1, 400, 40);
    // decaying front: R(S) = 14 (1 - exp(-S / 90)), recovery-like
    const Rdec = S.map(s => 14 * (1 - Math.exp(-s / 90)));
    const Xdec = Rdec.map(fracWithin);
    const V1 = Rdec.map(R => (4 / 3) * Math.PI * R ** 3);
    const fitV = X.avramiFit(V1, Xdec);
    // constant front: R(S) = 0.04 S
    const Xcon = S.map(s => fracWithin(0.04 * s));
    const fitS = X.avramiFit(S, Xcon);
    return { seed, slopeV1: fitV.n, nConst: fitS.n, used: fitV.used };
  });
  const v1ok = runs.every(r => Math.abs(r.slopeV1 - 1) <= 0.05 && r.used >= 6);
  const n3 = runs.map(r => r.nConst);
  check("RX-JMAK-CPU", v1ok, {
    slopeVsLnV1: runs.map(r => Number(r.slopeV1.toFixed(4))),
    constantVelocityN: n3.map(v => Number(v.toFixed(3))), band: "1 +- 0.05",
  });
}

// 5. RX-ID-RANGE — the free-id count nuclei and annealing twins allocate from
//    (freeGrainIds; Sim3D.freeIds). The GPU growth-twin pass atomicSubs on
//    every attempt, so a long twinning cast walks the u32 counter past 0; the
//    wrapped value must read as NO free ids. Below the wrap the count must equal
//    the rule it replaced (ctr - nextId - margin, floored at 0) at every counter
//    value, so nothing changes on a cast that never wrapped. Falsification arm:
//    the replaced rule on the wrapped counter hands out ids past the end of
//    every per-id buffer (lo >= MAX_GRAINS3), the RangeError that stuck the
//    heat-treatment panel busy.
{
  const { MAX_GRAINS3 } = await server.ssrLoadModule("/src/shaders3d.ts");
  const top = MAX_GRAINS3 - 2, nextId = 501;
  let sameBelowWrap = true;
  for (let ctr = 0; ctr <= top; ctr++) for (const margin of [2, 4]) {
    if (X.freeGrainIds(ctr, nextId, top, margin) !== Math.max(0, ctr - nextId - margin)) sameBelowWrap = false;
  }
  // 4200 twin attempts on a fresh counter: the u32 the GPU leaves behind
  let ctr = top;
  for (let i = 0; i < 4200; i++) ctr = (ctr - 1) >>> 0;
  const wrapped = ctr > top;
  const freeWrapped = [2, 4].map(m => X.freeGrainIds(ctr, nextId, top, m));
  const want = 200, oldK = Math.min(want, ctr - nextId - 2), oldLo = ctr - oldK + 1;
  const oldOverruns = oldLo >= MAX_GRAINS3;
  const fresh = X.freeGrainIds(top, nextId, top);
  const edge = [X.freeGrainIds(nextId + 2, nextId, top), X.freeGrainIds(nextId + 3, nextId, top), X.freeGrainIds(top + 1, nextId, top), X.freeGrainIds(NaN, nextId, top)];
  check("RX-ID-RANGE", sameBelowWrap && wrapped && freeWrapped.every(v => v === 0) && oldOverruns
    && fresh === top - nextId - 2 && edge.join() === "0,1,0,0", {
    sameAsReplacedRuleBelowWrap: sameBelowWrap, counterAfter4200Attempts: ctr,
    freeWhenWrapped: freeWrapped, replacedRuleFirstId: oldLo, replacedRuleOverruns: oldOverruns,
    freshCast: fresh, edges: edge,
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
