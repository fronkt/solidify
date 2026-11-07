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

// ---------------------------------------------------------------------------
// C3b-3 and C3b-4a (design section 6; pre-registered in tasks/todo.md,
// "C3b-3 and C3b-4a - 2026-11-07", before their first run)
const HS = await server.ssrLoadModule("/src/heatshare.ts");
const mulberry = seed => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// 6. RX-BIRTH-SCHEDULE — the constant-rate schedule on the sweep clock. The
//    rate checker below is written from the definition, not from the code,
//    and must reject a front-loaded schedule and one short by a nucleus.
{
  const rateOk = (s, count, window, batches) => {
    if (count === 0) return s.length === 0;
    const w = Math.max(1, Math.floor(window));
    const B = Math.min(count, w, batches);
    if (s.length !== B) return false;
    let cum = 0;
    for (let b = 0; b < s.length; b++) {
      const { sweep, count: c } = s[b];
      if (!Number.isInteger(sweep) || !Number.isInteger(c) || c < 1) return false;
      if (b === 0 ? sweep !== 0 : !(sweep > s[b - 1].sweep)) return false;
      if (sweep >= w) return false;
      if (Math.abs(sweep - (b * w) / B) >= 1) return false;
      cum += c;
      if (Math.abs(cum - (count * (b + 1)) / B) > 0.5 + 1e-9) return false;
    }
    return cum === count;
  };
  const bad = [];
  let cases = 0;
  for (const count of [1, 7, 50, 200, 400, 1000]) for (const window of [0, 1, 2, 24, 70, 1318]) for (const batches of [8, 16]) {
    cases++;
    const s = X.birthSchedule(count, window, batches);
    if (!rateOk(s, count, window, batches)) bad.push({ count, window, batches, s: s.slice(0, 4) });
  }
  const empty = X.birthSchedule(0, 24, 8).length === 0;
  const atOnce = [0, 1].every(w => { const s = X.birthSchedule(50, w, 16); return s.length === 1 && s[0].sweep === 0 && s[0].count === 50; });
  const g = X.birthSchedule(400, 24, 8);
  const fixture = g.length === 8 && g.every((b, i) => b.sweep === 3 * i && b.count === 50);
  const frontLoaded = rateOk([{ sweep: 0, count: 400 }], 400, 24, 8);
  const short = g.map((b, i) => (i === g.length - 1 ? { ...b, count: b.count - 1 } : b));
  const shortOk = rateOk(short, 400, 24, 8);
  // information: the explicit-schedule validator nucleateEvent refuses with
  const shape = { generated: X.scheduleShapeOk(g, 400), short: X.scheduleShapeOk(short, 400),
    repeated: X.scheduleShapeOk([{ sweep: 0, count: 1 }, { sweep: 0, count: 1 }], 2),
    fractional: X.scheduleShapeOk([{ sweep: 0.5, count: 2 }], 2) };
  check("RX-BIRTH-SCHEDULE", bad.length === 0 && cases === 72 && empty && atOnce && fixture && !frontLoaded && !shortOk, {
    cases, bad: bad.slice(0, 3), empty, atOnce, fixture8x50: fixture,
    mustFail: { frontLoadedAccepted: frontLoaded, shortByOneAccepted: shortOk }, info: { scheduleShapeOk: shape },
  });
}

// 7. RX-BOUNDARY-CLASSIFIER — boundary sites on synthetic fields with hand
//    answers, then voxel for voxel against a brute-force 26-loop.
{
  const PORE = 4095;
  const field = (n, f) => {
    const ids = new Uint32Array(n * n * n), phi = new Float32Array(n * n * n);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (z * n + y) * n + x, v = f(x, y, z);
      ids[i] = v; phi[i] = v === 0 ? 0 : 1;
    }
    return { ids, ok: X.treatableVoxels(ids, phi, null, PORE) };
  };
  const count = (n, f) => { const { ids, ok } = field(n, f); return X.boundarySites(ids, ok, n).length; };
  const n = 8;
  const cases = {
    single: [count(n, () => 1), 0],
    bicrystal: [count(n, x => (x < 4 ? 1 : 2)), 128],
    octants: [count(n, (x, y, z) => 1 + (x >= 4) + 2 * (y >= 4) + 4 * (z >= 4)), 296],
    inclusion: [count(n, (x, y, z) => (x >= 3 && x <= 4 && y >= 3 && y <= 4 && z >= 3 && z <= 4 ? 2 : 1)), 64],
    liquidLayer: [count(n, (x, y, z) => (z < 2 ? 0 : 1)), 0],
    planeNoWrap: [count(n, x => (x === 0 ? 2 : 1)), 128],
    poreSlab: [count(n, x => (x < 3 ? 1 : x === 3 ? PORE : 2)), 0],
  };
  const handOk = Object.values(cases).every(([got, want]) => got === want);
  const brute = (ids, ok, m) => {
    const out = [];
    for (let z = 0; z < m; z++) for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const i = (z * m + y) * m + x;
      if (!ok[i]) continue;
      let b = false;
      for (let dz = -1; dz <= 1 && !b; dz++) for (let dy = -1; dy <= 1 && !b; dy++) for (let dx = -1; dx <= 1 && !b; dx++) {
        if (!dx && !dy && !dz) continue;
        const X2 = x + dx, Y2 = y + dy, Z2 = z + dz;
        if (X2 < 0 || Y2 < 0 || Z2 < 0 || X2 >= m || Y2 >= m || Z2 >= m) continue;
        const j = (Z2 * m + Y2) * m + X2;
        if (ok[j] && ids[j] !== ids[i]) b = true;
      }
      if (b) out.push(i);
    }
    return out;
  };
  const randomFields = [0x51, 0x52, 0x53].map(seed => {
    const r = mulberry(seed), m = 12;
    const { ids, ok } = field(m, () => (r() < 0.1 ? 0 : 1 + Math.floor(r() * 5)));
    const fast = Array.from(X.boundarySites(ids, ok, m)), slow = brute(ids, ok, m);
    return { seed, sites: fast.length, equal: fast.length === slow.length && fast.every((v, i) => v === slow[i]) };
  });
  // information: a mould wall is not a boundary either
  const mouldInfo = (() => {
    const m = 8, ids = new Uint32Array(m ** 3).fill(1), phi = new Float32Array(m ** 3).fill(1), mould = new Uint8Array(m ** 3);
    for (let i = 0; i < ids.length; i++) if (i % m === 0) { ids[i] = 2; mould[i] = 1; }
    return X.boundarySites(ids, X.treatableVoxels(ids, phi, mould, PORE), m).length;
  })();
  check("RX-BOUNDARY-CLASSIFIER", handOk && randomFields.every(f => f.equal && f.sites > 0), {
    hand: Object.fromEntries(Object.entries(cases).map(([k, [got, want]]) => [k, `${got}/${want}`])),
    bruteForce: randomFields, info: { mouldPlaneSites: mouldInfo },
  });
}

// 8. RX-RATE-CPU — constant-rate nucleation, the extended volume built from
//    the ACTUAL schedule and each batch's own growth V(t_b, S), phantoms
//    included: slope 1 against ln X_ext whatever the growth law does. The
//    site-saturated construction (everything born at 0) must miss.
{
  const L = 64, N = 120, schedule = X.birthSchedule(N, 24, 8);
  const samples = []; for (let s = 0; s <= 70; s += 2) samples.push(s);
  const laws = {
    constant: S => 0.3 * S,
    recovery: S => {
      let d = 0;
      for (let s = 0; s < S; s++) { const H = 20 / (1 + 0.02 * s); d += 0.4 * Math.min(1, Math.max(0.02, (H - 8) / 6)); }
      return d;
    },
  };
  const pd = (a, b) => { const d = Math.abs(a - b); return Math.min(d, L - d); };
  const vol = R => (R > 0 ? (4 / 3) * Math.PI * R ** 3 : 0);
  const run = (seed, lawName, r0) => {
    const D = laws[lawName], r = mulberry(seed);
    const real = [];   // { p, b, Dt }
    let phantoms = 0;
    const perBatch = schedule.map(() => []);
    schedule.forEach(({ sweep, count }, b) => {
      const Db = D(sweep);
      for (let k = 0; k < count; k++) {
        const p = [Math.floor(r() * L) + 0.5, Math.floor(r() * L) + 0.5, Math.floor(r() * L) + 0.5];
        let covered = false;
        for (const q of real) {
          if (q.t >= sweep) continue;
          const R = r0 + Db - q.Dt;
          if (pd(p[0], q.p[0]) ** 2 + pd(p[1], q.p[1]) ** 2 + pd(p[2], q.p[2]) ** 2 <= R * R) { covered = true; break; }
        }
        if (covered) { phantoms++; continue; }
        const nuc = { p, t: sweep, Dt: Db };
        perBatch[b].push(nuc);
      }
      real.push(...perBatch[b]);
    });
    // per batch, the squared distance from every voxel centre to its nearest real nucleus
    const V = L * L * L;
    const near = schedule.map((_, b) => {
      const a = new Float64Array(V).fill(Infinity);
      if (!perBatch[b].length) return a;
      for (let z = 0, i = 0; z < L; z++) for (let y = 0; y < L; y++) for (let x = 0; x < L; x++, i++) {
        let best = Infinity;
        for (const q of perBatch[b]) {
          const d2 = pd(x + 0.5, q.p[0]) ** 2 + pd(y + 0.5, q.p[1]) ** 2 + pd(z + 0.5, q.p[2]) ** 2;
          if (d2 < best) best = d2;
        }
        a[i] = best;
      }
      return a;
    });
    const Xs = samples.map(S => {
      const rad = schedule.map(({ sweep }) => (S > sweep ? r0 + D(S) - D(sweep) : -1));
      let c = 0;
      for (let i = 0; i < V; i++) {
        for (let b = 0; b < schedule.length; b++) if (rad[b] >= 0 && near[b][i] <= rad[b] * rad[b]) { c++; break; }
      }
      return c / V;
    });
    const ext = samples.map(S => schedule.reduce((a, { sweep, count }) => a + (S > sweep ? count * vol(r0 + D(S) - D(sweep)) : 0), 0) / V);
    const wrong = samples.map(S => (S > 0 ? (N * vol(r0 + D(S) - D(0))) / V : 0));
    const aged = samples.map(S => schedule.reduce((a, { sweep, count }) => a + (S > sweep ? count * vol(r0 + D(S - sweep)) : 0), 0) / V);
    const fit = X.avramiFit(ext, Xs), fitW = X.avramiFit(wrong, Xs), fitA = X.avramiFit(aged, Xs);
    const fitS = X.avramiFit(samples.filter(s => s > 0), Xs.filter((_, k) => samples[k] > 0));
    const n = f => ("why" in f ? null : Number(f.n.toFixed(4)));
    return { seed, law: lawName, r0, phantoms, xEnd: Number(Xs[Xs.length - 1].toFixed(4)), slope: n(fit), points: "why" in fit ? 0 : fit.used,
      siteSaturated: n(fitW), ageShifted: n(fitA), nSweeps: n(fitS) };
  };
  const gated = [], info = [];
  for (const seed of [0xc31, 0xc32, 0xc33]) for (const law of Object.keys(laws)) {
    gated.push(run(seed, law, 0));
    info.push(run(seed, law, 2));
  }
  const ok = gated.every(g => g.slope != null && Math.abs(g.slope - 1) <= 0.05 && g.points >= 6 && g.xEnd >= 0.95 && g.phantoms > 0
    && g.siteSaturated != null && g.siteSaturated > 1.15);
  check("RX-RATE-CPU", ok, { band: "slope vs ln X_ext 1 +- 0.05; site-saturated construction must exceed 1.15", gated,
    info: info.map(r => ({ seed: r.seed, law: r.law, r0: r.r0, slope: r.slope, siteSaturated: r.siteSaturated, ageShifted: r.ageShifted, nSweeps: r.nSweeps })) });
}

// 9. RX-BOUNDARY-CPU — site-saturated nuclei on grain-boundary voxels of the
//    GPU gate's own polycrystal against random sites on the same one. With
//    one growth law the transformed region is the union of balls about the
//    sites; boundary sites crowd onto a 2D network, so the Poisson
//    construction against ln V1 must bend below 1 while random sites keep 1.
{
  const L = 96, LO = 16, HI = 80, G = 12, NS = 600;
  const samples = []; for (let s = 0; s <= 70; s += 2) samples.push(s);
  const Rof = S => 2 + 0.35 * S;
  // squared Euclidean distance transform (Felzenszwalb and Huttenlocher), in place along one axis
  const edt1 = (f, n) => {
    const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    // f holds 0 or a large FINITE value (1e12): integers below 2^53, so every
    // parabola intersection here is exact and z[0] = -Infinity ends the loop
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
    return d;
  };
  const edt3 = (mark, n) => {
    const BIG = 1e12, g = new Float64Array(n * n * n);
    for (let i = 0; i < g.length; i++) g[i] = mark[i] ? 0 : BIG;
    const line = new Float64Array(n);
    for (const axis of [0, 1, 2]) {
      const stride = axis === 0 ? 1 : axis === 1 ? n : n * n;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        const base = axis === 0 ? (a * n + b) * n : axis === 1 ? a * n * n + b : a * n + b;
        for (let q = 0; q < n; q++) line[q] = g[base + q * stride];
        const d = edt1(line, n);
        for (let q = 0; q < n; q++) g[base + q * stride] = d[q];
      }
    }
    return g;
  };
  // the transform is the tool under the exact X_b <= F_B clause, so it is
  // proved first: an over-estimating transform would fail that clause, an
  // under-estimating one would pass it vacuously
  const edtExact = (() => {
    const m = 14, r = mulberry(0xed7), mk = new Uint8Array(m ** 3);
    for (let i = 0; i < mk.length; i++) mk[i] = r() < 0.01 ? 1 : 0;
    mk[0] = 1;
    const got = edt3(mk, m), on = [];
    for (let i = 0; i < mk.length; i++) if (mk[i]) on.push([i % m, Math.floor(i / m) % m, Math.floor(i / (m * m))]);
    for (let i = 0; i < mk.length; i++) {
      const x = i % m, y = Math.floor(i / m) % m, z = Math.floor(i / (m * m));
      let best = Infinity;
      for (const p of on) best = Math.min(best, (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2);
      if (got[i] !== best) return false;
    }
    return true;
  })();
  const boxIdx = [];
  for (let z = LO; z < HI; z++) for (let y = LO; y < HI; y++) for (let x = LO; x < HI; x++) boxIdx.push([x, y, z, (z * L + y) * L + x]);
  const fracWithin = (d2sorted, R) => {
    let lo = 0, hi = d2sorted.length;
    const t = R * R;
    while (lo < hi) { const m = (lo + hi) >> 1; if (d2sorted[m] <= t) lo = m + 1; else hi = m; }
    return lo / d2sorted.length;
  };
  const nearest = centres => {
    const out = new Float64Array(boxIdx.length);
    for (let j = 0; j < boxIdx.length; j++) {
      const [x, y, z] = boxIdx[j];
      let best = Infinity;
      for (const c of centres) { const d2 = (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2; if (d2 < best) best = d2; }
      out[j] = best;
    }
    return out.sort();
  };
  const runs = [0xb1, 0xb2, 0xb3].map(seed => {
    const r = mulberry(seed);
    const pts = Array.from({ length: G }, () => [r() * L, r() * L, r() * L]);
    const ids = new Uint32Array(L * L * L);
    for (let z = 0, i = 0; z < L; z++) for (let y = 0; y < L; y++) for (let x = 0; x < L; x++, i++) {
      let best = Infinity, bi = 0;
      for (let g = 0; g < G; g++) {
        const d = (x + 0.5 - pts[g][0]) ** 2 + (y + 0.5 - pts[g][1]) ** 2 + (z + 0.5 - pts[g][2]) ** 2;
        if (d < best) { best = d; bi = g; }
      }
      ids[i] = bi + 1;
    }
    const list = X.boundarySites(ids, new Uint8Array(ids.length).fill(1), L);
    const rs = mulberry(seed ^ 0x5eed);
    const toXYZ = v => [v % L, Math.floor(v / L) % L, Math.floor(v / (L * L))];
    const cb = Array.from({ length: NS }, () => toXYZ(list[Math.floor(rs() * list.length)]));
    const cr = Array.from({ length: NS }, () => [Math.floor(rs() * L), Math.floor(rs() * L), Math.floor(rs() * L)]);
    const db = nearest(cb), dr = nearest(cr);
    const mark = new Uint8Array(L * L * L);
    for (const v of list) mark[v] = 1;
    const dB = edt3(mark, L);
    const dBbox = Float64Array.from(boxIdx.map(b => dB[b[3]])).sort();
    const R = samples.map(Rof), V1 = R.map(x => (4 / 3) * Math.PI * x ** 3);
    const Xb = R.map(x => fracWithin(db, x)), Xr = R.map(x => fracWithin(dr, x)), FB = R.map(x => fracWithin(dBbox, x));
    const pos = samples.map((s, k) => k).filter(k => samples[k] > 0);
    const n = f => ("why" in f ? null : Number(f.n.toFixed(4)));
    const sb = X.avramiFit(V1, Xb), sr = X.avramiFit(V1, Xr);
    const nb = X.avramiFit(pos.map(k => samples[k]), pos.map(k => Xb[k])), nr = X.avramiFit(pos.map(k => samples[k]), pos.map(k => Xr[k]));
    return { seed, boundaryVoxels: list.length, boundarySlope: n(sb), randomSlope: n(sr), nBoundary: n(nb), nRandom: n(nr),
      underCahnLimit: Xb.every((x, k) => x <= FB[k]), xEnd: [Number(Xb[Xb.length - 1].toFixed(4)), Number(Xr[Xr.length - 1].toFixed(4))],
      lateCoverOfLimit: Number((Xb[Math.floor(Xb.length / 2)] / Math.max(1e-9, FB[Math.floor(FB.length / 2)])).toFixed(3)) };
  });
  const ok = edtExact && runs.every(r => r.randomSlope != null && Math.abs(r.randomSlope - 1) <= 0.1 && r.boundarySlope != null && r.boundarySlope < 0.85
    && r.nBoundary != null && r.nRandom != null && r.nBoundary < r.nRandom && r.underCahnLimit && r.xEnd.every(x => x >= 0.95));
  check("RX-BOUNDARY-CPU", ok, { band: "random 1 +- 0.1 vs ln V1; boundary < 0.85; n boundary < n random; X_b <= F_B; X_end >= 0.95",
    distanceTransformExact: edtExact, runs });
}

// 10. RX-SHARE-TUPLE — the heat-treat link tuple (src/heatshare.ts). Legacy
//     shapes decode to what the decoder that shipped before C3b-3/4a decoded
//     (copied verbatim below from heatpanel.ts at c3b021d), and pack as its
//     setup() packed; the eighth element appears only off the default.
{
  const R3 = { tMin: 100, tMax: 1000, specMax: 100, volume: true }, R2 = { ...R3, volume: false };
  const base = { tC: 900, holdMin: 60, specMPa: 0, pinF: 0, pinR: 2, workJb: 0, rxN: 0, rxMode: 0 };
  // the shipped decoder, verbatim but for `this.` and the mode test
  const oldDecode = (restore, r, b) => {
    const d = { ...b };
    const [t, h, s, pf, pr, wk, rxn] = restore;
    d.tC = Math.min(r.tMax, Math.max(r.tMin, Math.round(t)));
    d.holdMin = Math.min(720, Math.max(1, Math.round(h)));
    d.specMPa = Math.min(r.specMax, Math.max(0, s));
    if (typeof pf === "number" && Number.isFinite(pf)) d.pinF = Math.min(0.12, Math.max(0, Math.round(pf / 0.005) * 0.005));
    if (typeof pr === "number" && Number.isFinite(pr)) d.pinR = Math.min(5, Math.max(1, Math.round(pr)));
    if (typeof wk === "number" && Number.isFinite(wk) && r.volume) d.workJb = Math.min(10, Math.max(0, Math.round(wk / 0.5) * 0.5));
    if (typeof rxn === "number" && Number.isFinite(rxn) && r.volume) d.rxN = Math.min(1000, Math.max(0, Math.round(rxn / 25) * 25));
    return d;
  };
  const oldPack = d => {
    if (d.rxN > 0) return [d.tC, d.holdMin, d.specMPa, d.pinF, d.pinR, d.workJb, d.rxN];
    if (d.workJb > 0) return [d.tC, d.holdMin, d.specMPa, d.pinF, d.pinR, d.workJb];
    return d.pinF > 0 ? [d.tC, d.holdMin, d.specMPa, d.pinF, d.pinR] : [d.tC, d.holdMin, d.specMPa];
  };
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const legacy = [[800, 60, 25], [800, 60, 25, 0.05, 3], [800, 60, 25, 0, 2, 4], [800, 60, 25, 0, 2, 8, 200]];
  const handBuilt = [[5000, 60, 25, 0.0004, 2, 4.2, 210], [50, 0, 400, 0.2, 9, 12, 2000], [800, 60, 25, 0.0123, 2.4]];
  const decodeBad = [];
  for (const t of [...legacy, ...handBuilt]) for (const r of [R3, R2]) {
    const got = HS.applyHeatSetup(t, r, base), want = oldDecode(t, r, base);
    for (const k of Object.keys(want)) if (!Object.is(got[k], want[k])) decodeBad.push({ t, volume: r.volume, k, got: got[k], want: want[k] });
    if (got.rxMode !== 0) decodeBad.push({ t, volume: r.volume, k: "rxMode", got: got.rxMode, want: 0 });
  }
  const repack = legacy.every(t => same(HS.packHeatSetup(HS.applyHeatSetup(t, R3, base)), t));
  const hb = HS.applyHeatSetup(handBuilt[0], R3, base);
  const hand = hb.pinF === 0 && hb.workJb === 4 && hb.rxN === 200 && hb.tC === 1000;
  // old setup() and new pack agree on every legacy-reachable dial state
  const packBad = [];
  for (const pinF of [0, 0.05]) for (const workJb of [0, 4]) for (const rxN of [0, 200]) {
    const d = { ...base, tC: 800, specMPa: 25, pinF, pinR: 3, workJb, rxN };
    if (!same(HS.packHeatSetup(d), oldPack(d))) packBad.push(d);
  }
  const t8 = [800, 60, 25, 0, 2, 8, 200, 3];
  const m8 = HS.applyHeatSetup(t8, R3, base);
  const eight = m8.rxMode === 3 && same(HS.packHeatSetup(m8), t8);
  const zeroMode = HS.packHeatSetup(HS.applyHeatSetup([800, 60, 25, 0, 2, 8, 200, 0], R3, base)).length === 7;
  const noNuclei = HS.packHeatSetup(HS.applyHeatSetup([800, 60, 25, 0, 2, 8, 0, 2], R3, base)).length === 6;
  const plane = HS.applyHeatSetup(t8, R2, base);
  const planeDrops = plane.workJb === 0 && plane.rxN === 0 && plane.rxMode === 0 && HS.packHeatSetup(plane).length === 3;
  const snaps = [[2.6, 3], [-1, 0], [7, 3]].every(([v, want]) => HS.applyHeatSetup([800, 60, 25, 0, 2, 8, 200, v], R3, base).rxMode === want);
  const accept = [[800, 60, 25], [800, 60, 25, 0, 2], [800, 60, 25, 0, 2, 4], [800, 60, 25, 0, 2, 4, 200], t8].every(HS.heatTupleShapeOk);
  const reject = [[800, 60], [800, 60, 25, 0], [...t8, 1], [800, NaN, 25], ["800", 60, 25], null, "abc", { length: 3 }].every(t => !HS.heatTupleShapeOk(t));
  const def = HS.packHeatSetup(base).length === 3;
  check("RX-SHARE-TUPLE", decodeBad.length === 0 && repack && hand && packBad.length === 0 && eight && zeroMode && noNuclei
    && planeDrops && snaps && accept && reject && def, {
    legacyDecodeMismatches: decodeBad.slice(0, 4), legacyRepack: repack, handBuilt: hand, legacyPackMismatches: packBad.length,
    eightElement: eight, defaultModeNotPacked: zeroMode, noModeWithoutNuclei: noNuclei, planeDropsVolumeTail: planeDrops,
    modeSnaps: snaps, shapeAccepts: accept, shapeRejects: reject, defaultPacks3: def,
  });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
