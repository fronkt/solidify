// TA-* — thermal-curve analysis, checked without a browser.
//
// src/thermal.ts is pure arithmetic over a cooling curve, so — like
// verify-units.mjs and verify-heattreat.mjs — it loads through vite's SSR loader
// and runs in CI, with no WebGPU Chrome. The strategy is synthetic curves whose
// landmarks are known by construction, so recovery is measured against a real
// answer rather than eyeballed. Two of the checks exist to fail a specific bug
// the analyser was written to avoid: TA-UNEVEN fails a derivative taken on the
// sample index instead of time, and TA-RETENTION fails the old splice that
// dropped a long run's liquidus arrest.
//
//   node scripts/verify-thermal.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const TH = await server.ssrLoadModule("/src/thermal.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// deterministic noise — a plain LCG, so the gate is reproducible run to run
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296 - 0.5; };
}

// ---- an analytic cooling curve with EXACT landmarks by construction.
// Segment A: steep linear liquid cooling  (0 → tL)          — the baseline
// Segment B: cosine dip to the nadir       (tL → tN)         — undercooling
// Segment C: cosine recovery to growth     (tN → tG)         — recalescence
// Segment D: cosine decline to the solidus (tG → tS)         — freezing
// fs ramps 0→1 across [tL, tS] as a smoothstep.
const LM = { T0: 1.28, tL: 5, TL: 1.00, tN: 7.5, TN: 0.90, tG: 9.5, TG: 0.965, tS: 16, TS: 0.72 };
const halfCos = (u) => 0.5 * (1 + Math.cos(Math.PI * Math.min(1, Math.max(0, u))));
function curveT(t, p = LM) {
  if (t <= p.tL) return p.TL + (p.T0 - p.TL) * (p.tL - t) / p.tL;      // A: T0 at 0, TL at tL
  if (t <= p.tN) return p.TN + (p.TL - p.TN) * halfCos((t - p.tL) / (p.tN - p.tL)); // B
  if (t <= p.tG) return p.TG + (p.TN - p.TG) * halfCos((t - p.tN) / (p.tG - p.tN)); // C
  if (t <= p.tS) return p.TS + (p.TG - p.TS) * halfCos((t - p.tG) / (p.tS - p.tG)); // D
  return 0;                                                            // past solidus: no liquid
}
function smoothstep(u) { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); }
function curveFs(t, p = LM) {
  if (t <= p.tL) return 0;
  if (t >= p.tS) return 1;
  return smoothstep((t - p.tL) / (p.tS - p.tL));
}
function sampleCurve(times, noise = 0, seed = 7, p = LM) {
  const r = rng(seed);
  return times.map(t => {
    const T = curveT(t, p);
    return { t, T: T > 0 ? T + noise * r() : 0, fs: curveFs(t, p) };
  });
}
const evenTimes = (t0, t1, dt) => {
  const out = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) out.push(t);
  return out;
};

const GT = {
  TL: LM.TL, TN: LM.TN, TG: LM.TG, TS: LM.TS,
  dTN: LM.TL - LM.TN, dTr: LM.TG - LM.TN, range: LM.TL - LM.TS, tf: LM.tS - LM.tL,
};

// 1. TA-SYNTH — clean, evenly sampled: every landmark recovered.
{
  const s = sampleCurve(evenTimes(0, 17, 0.05), 0);
  const a = TH.analyseCurve(s);
  const ok =
    near(a.liquidus?.T, GT.TL, 0.02) &&
    near(a.nadir?.T, GT.TN, 0.02) &&
    near(a.growth?.T, GT.TG, 0.02) &&
    near(a.solidus?.T, GT.TS, 0.03) &&
    near(a.undercoolN, GT.dTN, 0.03) &&
    near(a.recalR, GT.dTr, 0.02) &&
    near(a.freezeRange, GT.range, 0.04) &&
    near(a.tf, GT.tf, 0.6);
  check("TA-SYNTH", ok, {
    TL: r3(a.liquidus?.T), TN: r3(a.nadir?.T), TG: r3(a.growth?.T), TS: r3(a.solidus?.T),
    dTN: r3(a.undercoolN), dTr: r3(a.recalR), range: r3(a.freezeRange), tf: r3(a.tf),
    want: GT,
  });
}

// 2. TA-NOISE — same curve at the readback's real noise amplitude.
{
  const s = sampleCurve(evenTimes(0, 17, 0.05), 0.004, 11);
  const a = TH.analyseCurve(s);
  const ok =
    near(a.liquidus?.T, GT.TL, 0.035) &&
    near(a.nadir?.T, GT.TN, 0.03) &&
    near(a.growth?.T, GT.TG, 0.03) &&
    near(a.recalR, GT.dTr, 0.03) &&
    a.notes.filter(n => /no recalescence|no liquidus/.test(n)).length === 0;
  check("TA-NOISE", ok, {
    TL: r3(a.liquidus?.T), TN: r3(a.nadir?.T), TG: r3(a.growth?.T), dTr: r3(a.recalR),
    notes: a.notes,
  });
}

// 3. TA-UNEVEN — the SAME curve sampled 20 Hz for the first third then 4 Hz must
//    give the same landmarks as the evenly-sampled version. A derivative taken on
//    the sample index instead of time mis-scales dT/dt by the cadence ratio right
//    where the arrest is, and fails this.
{
  const even = TH.analyseCurve(sampleCurve(evenTimes(0, 17, 0.05), 0));
  const uneven = [];
  for (let t = 0; t <= 6; t += 0.02) uneven.push(t);       // dense early (through T_L)
  for (let t = 6.25; t <= 17; t += 0.25) uneven.push(t);   // sparse late
  const a = TH.analyseCurve(sampleCurve(uneven, 0));
  const ok =
    near(a.liquidus?.T, even.liquidus?.T, 0.02) &&
    near(a.nadir?.T, even.nadir?.T, 0.02) &&
    near(a.growth?.T, even.growth?.T, 0.02) &&
    near(a.rateLiquid, even.rateLiquid, 0.01) &&
    near(a.liquidus?.T, GT.TL, 0.03);
  check("TA-UNEVEN", ok, {
    uneven: { TL: r3(a.liquidus?.T), TN: r3(a.nadir?.T), TG: r3(a.growth?.T), rate: r4(a.rateLiquid) },
    even: { TL: r3(even.liquidus?.T), TN: r3(even.nadir?.T), TG: r3(even.growth?.T), rate: r4(even.rateLiquid) },
  });
}

// 4. TA-NOARREST — a monotonic Newtonian quench with NO latent heat must report
//    nadir = null and say why, not fish a noise minimum out of the curve.
{
  const Tamb = 0.2, k = 0.25, T0 = 1.25;
  const r = rng(3);
  const s = [];
  let T = T0;
  for (let t = 0; t <= 18; t += 0.05) {
    if (t > 0) T += -k * (T - Tamb) * 0.05;
    s.push({ t, T: T + 0.004 * r(), fs: 0 });
  }
  const a = TH.analyseCurve(s);
  const ok = a.nadir === null && a.growth === null &&
    a.notes.some(n => /no recalescence/.test(n));
  check("TA-NOARREST", ok, { nadir: a.nadir, growth: a.growth, notes: a.notes });
}

// 5. TA-FS — a curve generated by the Newtonian + latent model the analyser
//    inverts: derived solid fraction must track the prescribed fs.
{
  const Tamb = 0.3, k = 0.22, Lh = 0.9, T0 = 1.25, tL = 4, tS = 15;
  const fsOf = (t) => t <= tL ? 0 : t >= tS ? 1 : smoothstep((t - tL) / (tS - tL));
  const dt = 0.04;
  const s = [];
  let T = T0;
  for (let t = 0; t <= 17; t += dt) {
    if (t > 0) {
      const dfs = (fsOf(t) - fsOf(t - dt)) / dt;
      T += (-k * (T - Tamb) + Lh * dfs) * dt;
    }
    const fs = fsOf(t);
    s.push({ t, T: fs < 0.999 ? T : 0, fs });
  }
  const a = TH.analyseCurve(s);
  const ok = a.fsRms !== null && a.fsRms < 0.08 && a.fsDerived.length > 10;
  check("TA-FS", ok, { fsRms: r4(a.fsRms), pts: a.fsDerived.length,
    TL: r3(a.liquidus?.T), TS: r3(a.solidus?.T) });
}

// 6. TA-RETENTION — 5 000 streamed samples thinned to a 1 200 cap must keep the
//    span and the nadir, and analyse to the same landmarks as the full record.
//    This gates the old splice that silently deleted a long run's liquidus arrest.
{
  const full = sampleCurve(evenTimes(0, 17, 17 / 4999), 0.003, 23);
  const CAP = 1200;
  let stream = [];
  for (const p of full) { stream.push(p); stream = TH.retain(stream, CAP); }
  const aFull = TH.analyseCurve(full);
  const aKept = TH.analyseCurve(stream);
  const spanKept = stream[0].t === full[0].t && stream[stream.length - 1].t === full[full.length - 1].t;
  const nadirT = Math.min(...full.filter(p => p.T > 0).map(p => p.T));
  const nadirKept = stream.some(p => p.T > 0 && Math.abs(p.T - nadirT) < 1e-9);
  const ok = stream.length <= CAP && spanKept && nadirKept &&
    near(aKept.liquidus?.T, aFull.liquidus?.T, 0.02) &&
    near(aKept.nadir?.T, aFull.nadir?.T, 0.02) &&
    near(aKept.solidus?.T, aFull.solidus?.T, 0.03);
  check("TA-RETENTION", ok, {
    kept: stream.length, spanKept, nadirKept,
    full: { TL: r3(aFull.liquidus?.T), TN: r3(aFull.nadir?.T), TS: r3(aFull.solidus?.T) },
    thinned: { TL: r3(aKept.liquidus?.T), TN: r3(aKept.nadir?.T), TS: r3(aKept.solidus?.T) },
  });
}

function r3(x) { return x == null ? null : +x.toFixed(3); }
function r4(x) { return x == null ? null : +x.toFixed(4); }

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all thermal checks passed");
if (failures) process.exitCode = 1;
