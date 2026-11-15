// Tong follow-up (iv): no-flow tip resolution at D2. A research measurement, NOT a
// regression gate, and NOT a re-score: tong3's NO VERDICT and follow-up (ii)'s
// DRIFTING / BOX-INDEPENDENT stand as recorded, and nothing here can make the flow
// quantitative (the flow side at dx 0.4 far from the inlet needs n > 1024 with flow
// on, which flowRefusal forbids).
//
// Question: at follow-up (ii)'s staging, does halving dx (0.8 -> 0.4 W0) bring the
// late no-flow tip speed to the exact 0.0170? Two NO-FLOW arms in the same physical
// box (819.2 W0), 81 samples at the same times (T81 = 2609.9 tau0 = 19.6 l_D / V_KR):
//   R1024  n 1024, dx 0.8, seed (512, 512),   81 chunks of 671  (54351 substeps):
//          (ii)'s N1024 again, which must replicate (ii)'s recorded prefix windows;
//   H2048  n 2048, dx 0.4, seed (1024, 1024), 81 chunks of 2684 (217404 substeps):
//          dt is a quarter of R1024's, so chunk 2684 = 4 x 671 puts every sample at
//          R1024's sample time (tong3's staging would round it to 2683: refused).
// Statistics: (ii)'s prefix windows (reported for comparability), and the late-window
// statistic L over the per-chunk speeds v_k, k = 54..80: V_L (mean), b (slope),
// drift_L = 26 b / V_L, SETTLED if |drift_L| <= 0.02. Decision on both arms valid and
// SETTLED: d = V_L(H2048) / V_L(R1024) - 1, e = V_L(H2048) / 0.0170 - 1, first match
// OVERSHOOT / RESOLUTION / NOT RESOLUTION / PARTLY RESOLUTION / OTHER.
//
// Protocol: tasks/todo.md "Tong follow-up (iv): no-flow tip resolution at D2 -
// PROTOCOL" (PROTOCOL_COMMIT) with its "Amendment before any run" (AMENDMENT_COMMIT).
// Arms: flow-noflow-dx-arms.json, validated here against the protocol.
//
// Reuses flow-noflow-d2.mjs UNCHANGED: runArm / runNoflow (D3.4's in-page driver,
// (ii)'s read-only probe, tong2's stop rule), prefixes, label, perChunk and assess
// (V1 as (ii)), with flow-tong2.mjs / flow-tong3.mjs / flow-domain.mjs underneath.
// That file, its self-test and arms, and everything (ii) froze must be git-blob
// identical to (ii)'s GPU head 14242e4 (checked before a run and in the self-test).
// New code: per-arm dx and chunk (the chunk carried by the staging object itself,
// since runNoflow advances and accumulates time by staging.chunk), the sample-time
// assert, the replica against (ii)'s recorded JSON, statistic L and the decision.
//
//   node scripts/research/flow-noflow-dx.mjs [--self-test]   CPU only (the default)
//   node scripts/research/flow-noflow-dx.mjs --plan          arms, run length and GPU cost
//   node scripts/research/flow-noflow-dx.mjs --run [--port 5297] [--arms ID,ID]
//
// --run drives Chrome/WebGPU and needs a Vite server for THIS worktree
// (`npx vite --port 5297 --strictPort`). It refuses before launching Chrome unless
// the hashed files are committed and unmodified, src/ equals a304254 and the frozen
// files equal their heads; it admits each page only if its served source equals this
// tree's. It writes docs/validation/flow-noflow-dx-<date>.json and raw rows to
// verify-out/flow-noflow-dx-<date>/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as T2 from "./flow-tong2.mjs";
import * as T3 from "./flow-tong3.mjs";
import * as D2 from "./flow-noflow-d2.mjs";
import { slope, HELPER_SRC, installDriver } from "./flow-domain.mjs";

/** the pre-registration (82931ec): the arm file's protocolCommit */
export const PROTOCOL_COMMIT = "82931ec43ddb9f38d569f8850b5946de1ee8ac67";
export const PROTOCOL_HEADER = "### Tong follow-up (iv): no-flow tip resolution at D2 - PROTOCOL (pre-registered 2026-11-15; not built, not run)";
export const AMENDMENT_HEADER = "#### Amendment before any run (2026-11-15, follow-up iv)";
/** the amendment, committed before this build and before any run */
export const AMENDMENT_COMMIT = "0acbb7120a57cfa70227a8a9f999ff41e76d7ab0";
/** (ii)'s GPU head: flow-noflow-d2.mjs and everything (ii) froze must still equal it */
export const II_RUN_COMMIT = "14242e4dab18eeb6e97463ddc5fac514f473775e";
/** (ii)'s recorded result, the replica reference (committed in 22f3c7d, after 14242e4) */
export const II_RESULT = "docs/validation/flow-noflow-d2-2026-11-08.json";
export const II_RESULT_COMMIT = "22f3c7d0f017e5bdb4487363edf2734aa692e22a";
export const REPO = T2.REPO;
export const D35_PASSED_COMMIT = T2.D35_PASSED_COMMIT;
const ARMS_PATH = fileURLToPath(new URL("./flow-noflow-dx-arms.json", import.meta.url));

const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };
const K = T2.K;

/** git-blob freeze: flow-noflow-d2.mjs, its self-test and arms, and every file (ii)
 *  froze (its FROZEN map, its self-test's groups, tong3's result, the browser
 *  cleanup its --run imports) at (ii)'s GPU head; (ii)'s result at its own commit */
export const FROZEN = deepFreeze({
  "scripts/research/flow-noflow-d2.mjs": II_RUN_COMMIT,
  "scripts/research/flow-noflow-d2-selftest.mjs": II_RUN_COMMIT,
  "scripts/research/flow-noflow-d2-arms.json": II_RUN_COMMIT,
  "scripts/research/flow-domain.mjs": II_RUN_COMMIT,
  "scripts/research/flow-tong2.mjs": II_RUN_COMMIT,
  "scripts/research/flow-tong2-selftest.mjs": II_RUN_COMMIT,
  "scripts/research/flow-tong2-arms.json": II_RUN_COMMIT,
  "scripts/research/flow-tong3.mjs": II_RUN_COMMIT,
  "scripts/research/flow-tong3-selftest.mjs": II_RUN_COMMIT,
  "scripts/research/flow-tong3-arms.json": II_RUN_COMMIT,
  "docs/validation/flow-tong3-2026-11-08.json": II_RUN_COMMIT,
  "scripts/browser-cleanup.mjs": II_RUN_COMMIT,
  [II_RESULT]: II_RESULT_COMMIT,
});

export const PROTOCOL = deepFreeze({
  lambda: 3.19, sideW0: 819.2, chunks: 81, windows: [33, 45, 57, 69, 81],
  arms: [
    { id: "R1024", n: 1024, dx: 0.8, seedX: 512, seedY: 512, chunk: 671, substeps: 54351, replica: true },
    { id: "H2048", n: 2048, dx: 0.4, seedX: 1024, seedY: 1024, chunk: 2684, substeps: 217404 },
  ],
  /** H2048's chunk is this multiple of R1024's; tong3's staging rounds it to 2683 */
  chunkFactor: 4, tong3ChunkH: 2683,
  /** statistic L: per-chunk speeds v_k over k = 54..80 (27 values), drift across 26 chunks */
  lateWindow: [54, 80],
  exactNoflowVd0D: 0.0170, tongNoflowVd0D: 0.0180,
  /** tong3 P768's dx 0.8 flow speed (the descriptive ratio's numerator; NOT R*) */
  flowVd0D: 0.021946,
  prediction: "PARTLY RESOLUTION",
  /** the sizing: (ii) N1024's last west tip (cells), and H2048 assumed 6 % faster (reported only) */
  sizing: { iiEndXWest: 105.44791636144737, fasterBy: 0.06 },
  earlier: "tong3 NO VERDICT and follow-up (ii) DRIFTING / BOX-INDEPENDENT stand as recorded; this script re-scores neither",
});

/** pre-registered thresholds (tasks/todo.md, follow-up iv) */
export const RULES = deepFreeze({
  replicaRel: 1e-6, replicaPoints: 0.0001, settledMax: 0.02, sampleTimeAssert: 1e-12, sampleTimeRel: 1e-9,
  overshoot: 0.03, resolution: 0.03, notResolution: 0.02, partly: 0.02,
});

/** the protocol's cost section: (ii)'s recorded arm wall time per substep (probe and page load included) */
export const COST = deepFreeze({ iiArmWallMs: { 1024: 68391, 2048: 288324 }, iiSubsteps: 54351, planMin: 35 });

export const SERVED = T2.SERVED;
export const HASHED = [...new Set([...SERVED,
  "scripts/research/flow-noflow-dx.mjs", "scripts/research/flow-noflow-dx-selftest.mjs", "scripts/research/flow-noflow-dx-arms.json",
  ...Object.keys(FROZEN)])];

// ------------------------------------------------------------ staging and arms

/** one arm's geometry, shaped for (ii)'s runArm / runNoflow / assess. tong3's tier-P
 *  staging at this arm's dx, except the chunk, which the STAGING OBJECT carries:
 *  runNoflow advances by g.staging.chunk and accumulates t with staging.chunk x dt */
export function geometry(arm) {
  const sideW0 = arm.n * arm.dx, s3 = T3.staging(PROTOCOL.lambda, arm.dx, sideW0);
  const s = arm.chunk === s3.chunk ? s3
    : { ...s3, chunk: arm.chunk, substeps: arm.chunk * K.NS, tSampled: arm.chunk * K.NS * s3.dt, tong3Chunk: s3.chunk };
  const substeps = s.chunk * PROTOCOL.chunks, tRun = substeps * s.dt;
  // the sample times exactly as runNoflow accumulates them
  const sampleTimes = [];
  for (let k = 0, t = 0; k < PROTOCOL.chunks; k++) { t += s.chunk * s.dt; sampleTimes.push(t); }
  const travelW0 = (PROTOCOL.arms[0].seedX - K.SEED_R_W0 / PROTOCOL.arms[0].dx - PROTOCOL.sizing.iiEndXWest) * PROTOCOL.arms[0].dx;
  const factor = arm.dx === PROTOCOL.arms[0].dx ? 1 : 1 + PROTOCOL.sizing.fasterBy;
  return {
    ...arm, lambda: PROTOCOL.lambda, sideW0, staging: s, chunk: s.chunk, chunks: PROTOCOL.chunks, substeps,
    // (ii)'s own replica clause (against tong3) is not this protocol's: d2's assess must not apply it
    replica: false, replicaIi: arm.replica === true,
    tRun, tRunInLD: (tRun * s.vKR) / s.lD, boxD0: arm.n * s.cellD0, diffusionLengthCells: Math.sqrt(s.dTilde * tRun) / s.dx,
    probeCells: D2.PROTOCOL.probeLD.map(k => (k * s.lD) / s.dx), sampleTimes,
    predictedEndGapCells: arm.seedX - s.seedRCells - (factor * travelW0) / s.dx,
    costS: ((COST.iiArmWallMs[arm.n] / COST.iiSubsteps) * substeps) / 1000,
  };
}

/** |chunk_H dt(0.4) / (chunk_R dt(0.8)) - 1| < 1e-12, or throw */
export function sampleTimeAssert(gR, gH) {
  const rel = Math.abs((gH.staging.chunk * gH.staging.dt) / (gR.staging.chunk * gR.staging.dt) - 1);
  if (!(rel < RULES.sampleTimeAssert)) throw new Error(`sample time: ${gH.staging.chunk} dt(${gH.staging.dx}) / (${gR.staging.chunk} dt(${gR.staging.dx})) - 1 = ${rel}, not < ${RULES.sampleTimeAssert}`);
  return rel;
}

const ARM_KEYS = ["id", "n", "dx", "seedX", "seedY", "chunk", "chunks", "substeps", "replica"];

/** validate the arm file against the protocol; throws with the reason */
export function parseArms(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("arms: not an object");
  for (const k of Object.keys(json)) if (!["study", "protocol", "protocolCommit", "arms"].includes(k)) throw new Error(`arms: unknown key ${k}`);
  if (json.protocolCommit !== PROTOCOL_COMMIT) throw new Error(`arms: protocolCommit ${json.protocolCommit} is not ${PROTOCOL_COMMIT}`);
  if (!Array.isArray(json.arms)) throw new Error("arms: arms must be an array");
  const want = PROTOCOL.arms.map(a => a.id), got = json.arms.map(a => a?.id);
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`arms: arms must be exactly ${want.join(", ")} in the protocol's order, not ${got.join(", ")}`);
  const geos = json.arms.map((a, i) => {
    const p = PROTOCOL.arms[i];
    for (const k of Object.keys(a)) if (!ARM_KEYS.includes(k)) throw new Error(`arms: ${a.id}: unknown key ${k}`);
    for (const k of ["n", "dx", "seedX", "seedY"]) if (a[k] !== p[k]) throw new Error(`arms: ${a.id}: ${k} ${a[k]} is not the pre-registered ${p[k]}`);
    if ((a.replica ?? false) !== (p.replica ?? false)) throw new Error(`arms: ${a.id}: replica is pre-registered as ${p.replica ?? false}`);
    if (a.seedX !== a.n / 2 || a.seedY !== a.n / 2 || a.n % 16 !== 0) throw new Error(`arms: ${a.id}: seed not centred or n not a multiple of 16`);
    if (!(Math.abs(a.n * a.dx - PROTOCOL.sideW0) < 1e-9)) throw new Error(`arms: ${a.id}: box n x dx = ${a.n * a.dx} W0 is not ${PROTOCOL.sideW0}`);
    if (!Number.isInteger(a.chunk) || a.chunks !== PROTOCOL.chunks || a.substeps !== a.chunk * a.chunks) throw new Error(`arms: ${a.id}: ${a.chunks} chunks of ${a.chunk} (${a.substeps}) are not 81 whole chunks`);
    return geometry({ ...p, chunk: a.chunk });
  });
  const [gR, gH] = geos;
  if (gR.chunk !== T3.staging(PROTOCOL.lambda, gR.dx, gR.sideW0).chunk) throw new Error(`arms: R1024: chunk ${gR.chunk} is not (ii)'s (tong3's staging at dx 0.8)`);
  sampleTimeAssert(gR, gH);
  geos.forEach((g, i) => {
    const p = PROTOCOL.arms[i];
    if (g.chunk !== p.chunk || g.substeps !== p.substeps) throw new Error(`arms: ${g.id}: ${g.chunks} chunks of ${g.chunk} (${g.substeps}) are not the protocol's 81 of ${p.chunk} (${p.substeps})`);
  });
  if (gH.chunk !== PROTOCOL.chunkFactor * gR.chunk) throw new Error(`arms: H2048: chunk ${gH.chunk} is not ${PROTOCOL.chunkFactor} x ${gR.chunk}`);
  return geos;
}

/** one arm through (ii)'s runArm, unchanged, tagged with this protocol's replica clause */
export async function runArm(ctx, g) {
  const row = await D2.runArm(ctx, g);
  row.replicaIi = g.replicaIi;
  return row;
}

// ------------------------------------------------------------ the replica reference

/** (ii)'s recorded N1024: its prefix windows' V d0/D and s (the recorded doubles),
 *  its per-chunk series and its trace */
export function loadIiReference(text = readFileSync(resolve(REPO, II_RESULT), "utf8")) {
  const j = JSON.parse(text);
  const a = j.arms?.find(x => x.id === "N1024"), d = j.decision?.N1024;
  if (j.protocolCommit !== D2.PROTOCOL_COMMIT || j.commit !== II_RUN_COMMIT || j.completed !== true || !a || d?.valid !== true)
    throw new Error(`${II_RESULT}: not (ii)'s recorded, valid N1024 on ${II_RUN_COMMIT.slice(0, 7)}`);
  return deepFreeze({
    path: II_RESULT, commit: j.commit,
    vd0D: Object.fromEntries(PROTOCOL.windows.map(m => [m, d.vd0D[m]])), s: Object.fromEntries(PROTOCOL.windows.map(m => [m, d.s[m]])),
    series: a.perChunk.series.map(p => ({ k: p.k, vd0D: p.vd0D })), trace: a.runs.noflow.trace.map(p => ({ ...p })),
  });
}

/** every prefix window's V d0/D within 1e-6 relative of the reference, and every s_m within 0.01 points */
export function replicaCheck(windows, ref) {
  const per = PROTOCOL.windows.map(m => {
    const w = windows.find(x => x.m === m), rv = ref.vd0D[m], rs = ref.s[m];
    if (!w?.available || !Number.isFinite(w.vd0D) || !Number.isFinite(w.s) || !Number.isFinite(rv) || !Number.isFinite(rs)) return { m, ok: false, relV: null, pointsS: null };
    const relV = w.vd0D / rv - 1, ds = w.s - rs;
    return { m, vd0D: w.vd0D, s: w.s, relV, pointsS: 100 * ds, ok: Math.abs(relV) <= RULES.replicaRel && Math.abs(ds) <= RULES.replicaPoints };
  });
  const max = f => (per.every(x => Number.isFinite(f(x))) ? Math.max(...per.map(x => Math.abs(f(x)))) : null);
  return { against: ref.path, windows: per, maxRelV: max(x => x.relV), maxPointsS: max(x => x.pointsS), ok: per.length === PROTOCOL.windows.length && per.every(x => x.ok) };
}

/** per-chunk agreement with the reference (reported only) */
export function perChunkAgreement(series, refSeries) {
  let maxRel = null, atK = null, n = 0;
  for (const p of series) {
    const r = refSeries.find(q => q.k === p.k);
    if (p.vd0D == null || r?.vd0D == null) continue;
    const x = Math.abs(p.vd0D / r.vd0D - 1);
    n++;
    if (maxRel == null || x > maxRel) { maxRel = x; atK = p.k; }
  }
  return { chunks: n, maxRel, atK };
}

// ------------------------------------------------------------ statistic L, validity, decision

export const settled = drift => (Number.isFinite(drift) ? (Math.abs(drift) <= RULES.settledMax ? "SETTLED" : "MOVING") : null);

/** statistic L on the per-chunk speeds v_k ((ii)'s amendment, item 3) over k = 54..80 */
export function lateWindow(series, lambda) {
  const [k0, k1] = PROTOCOL.lateWindow, want = k1 - k0 + 1;
  const pts = series.filter(p => p.k >= k0 && p.k <= k1 && Number.isFinite(p.vd0D));
  if (pts.length !== want) return { available: false, window: [k0, k1], values: pts.length, label: null };
  const VL = pts.reduce((s, p) => s + p.vd0D, 0) / want;
  const b = slope(pts.map(p => ({ t: p.k, x: p.vd0D })));
  const driftL = ((k1 - k0) * b) / VL;
  return { available: true, window: [k0, k1], values: want, VL, b, driftL, label: settled(driftL), tauVW: T3.tauVW(VL, lambda) };
}

/** H2048's sample times against R1024's (the times runNoflow accumulates at R1024's staging) */
export function sampleTimeCheck(trace, ref) {
  if (!trace?.length) return { ok: false, samples: 0, maxRel: null, nonFinite: 0 };
  let maxRel = 0, nonFinite = 0;
  for (const p of trace) {
    const x = Math.abs(p.t / ref[p.k] - 1);   // a missing reference time (k > 80) gives NaN
    if (!Number.isFinite(x)) nonFinite++;
    else if (x > maxRel) maxRel = x;
  }
  return { ok: nonFinite === 0 && maxRel <= RULES.sampleTimeRel, samples: trace.length, maxRel, nonFinite };
}

/** per-arm statistic and validity, in place: (ii)'s assess (V1, stop rule, prefixes,
 *  per-chunk series, STEADY / DRIFTING), then this protocol's replica, sample times and L */
export function assess(arms, served, ref) {
  D2.assess(arms, served);
  const tR = geometry(PROTOCOL.arms[0]).sampleTimes;
  for (const a of arms) {
    const run = a.runs?.noflow, why = [...a.invalidBy];
    a.L = lateWindow(a.perChunk?.series ?? [], a.lambda);
    a.endGapW0 = a.endGapCells == null ? null : a.endGapCells * a.dx;
    a.notRun = a.gridAccepted?.staged === a.n ? null : `the app staged ${a.gridAccepted?.staged ?? "nothing"}, wanted n ${a.n}`;
    if (a.replicaIi) {
      a.replicaCheck = replicaCheck(a.windows, ref);
      a.perChunkVsIi = perChunkAgreement(a.perChunk?.series ?? [], ref.series);
      if (!a.replicaCheck.ok) why.push(`replica missed (max |dV| ${a.replicaCheck.maxRelV}, max |ds| ${a.replicaCheck.maxPointsS} points)`);
    }
    if (a.id === "H2048") {
      a.sampleTimes = sampleTimeCheck(run?.trace, tR);
      if (!a.sampleTimes.ok) why.push(`sample times not R1024's (max rel ${a.sampleTimes.maxRel})`);
    }
    a.valid = why.length === 0;
    a.invalidBy = why;
  }
  return Object.fromEntries(arms.map(a => [a.id, a]));
}

/** the decision regions, first match in the protocol's order */
export function classify(d, e) {
  if (e > RULES.overshoot) return "OVERSHOOT";
  if (Math.abs(e) <= RULES.resolution) return "RESOLUTION";
  if (Math.abs(d) < RULES.notResolution) return "NOT RESOLUTION";
  if (d >= RULES.partly) return "PARTLY RESOLUTION";
  return "OTHER";
}

/** the pre-registered decision (tasks/todo.md, follow-up iv, as amended before any run) */
export function decide(byId) {
  const R = byId.R1024, H = byId.H2048, exact = PROTOCOL.exactNoflowVd0D, tong = PROTOCOL.tongNoflowVd0D;
  const vR = R?.L?.available ? R.L.VL : null, vH = H?.L?.available ? H.L.VL : null;
  const d = vR != null && vH != null ? vH / vR - 1 : null, e = vH != null ? vH / exact - 1 : null;
  const reason = (x, id) => (!x ? `${id} not run` : !x.valid ? `${id} ${x.notRun ? `not run (${x.notRun})` : "invalid"}: ${x.invalidBy.join("; ")}` : null);
  const bad = [reason(R, "R1024"), reason(H, "H2048")].filter(Boolean);
  let verdict, why = null;
  if (!R?.valid || !H?.valid) { verdict = "NOT TESTED"; why = `${bad.join(" | ")}; the question stays open`; }
  else if (R.L.label !== "SETTLED" || H.L.label !== "SETTLED") {
    verdict = "NO DECISION";
    why = [R, H].filter(x => x.L.label !== "SETTLED").map(x => `${x.id} ${x.L.label ?? "no L"} (drift_L ${x.L.driftL})`).join("; ");
  } else verdict = classify(d, e);
  const arm = x => (x ? {
    valid: x.valid, invalidBy: x.invalidBy, notRun: x.notRun, label: x.decision?.label ?? null, mStar: x.decision?.mStar ?? null,
    s: Object.fromEntries((x.windows ?? []).map(w => [w.m, w.available ? w.s : null])), vd0D: Object.fromEntries((x.windows ?? []).map(w => [w.m, w.available ? w.vd0D : null])),
    tauVW: Object.fromEntries((x.windows ?? []).map(w => [w.m, w.available ? w.tauVW : null])), L: x.L,
    replica: x.replicaCheck, perChunkVsIi: x.perChunkVsIi, sampleTimes: x.sampleTimes, vsReferences: x.vsReferences ?? null,
    firstBelowExact: x.perChunk?.firstBelowExact ?? null, endGapCells: x.endGapCells ?? null, endGapW0: x.endGapW0 ?? null,
    probeLast: x.runs?.noflow?.probe?.at(-1) ?? null, wallMs: x.wallMs ?? null,
  } : { valid: false, invalidBy: ["not run"], label: null, L: null });
  const twoGrid = vR != null && vH != null ? Object.fromEntries([1, 2].map(p => {
    const v = vH + (vH - vR) / (2 ** p - 1);
    return [`p${p}`, { Vinf: v, vsExact: v / exact - 1, vsTong: v / tong - 1 }];
  })) : null;
  const sR = R?.perChunk?.series ?? [], sH = H?.perChunk?.series ?? [];
  const dk = sH.map(p => { const r = sR.find(q => q.k === p.k); return { k: p.k, d: p.vd0D != null && r?.vd0D != null ? p.vd0D / r.vd0D - 1 : null }; });
  return {
    verdict, why, d, e, VL: { R1024: vR, H2048: vH }, driftL: { R1024: R?.L?.driftL ?? null, H2048: H?.L?.driftL ?? null },
    L: { R1024: R?.L?.label ?? null, H2048: H?.L?.label ?? null },
    R1024: arm(R), H2048: arm(H),
    reported: {
      twoGrid, twoGridNote: "two grids cannot determine the order p, so neither estimate is a result",
      dk, exact, tong, tongOwnVsExact: tong / exact - 1,
      descriptiveRatio: vR != null ? { value: PROTOCOL.flowVd0D / vR, note: "descriptive arithmetic, NOT R*: tong3's dx 0.8 flow speed 0.021946 over R1024's dx 0.8 late no-flow speed V_L" } : null,
    },
    prediction: PROTOCOL.prediction, earlier: PROTOCOL.earlier,
  };
}

// ------------------------------------------------------------ CLI

function sh(cmd, args, input) {
  return execFileSync(cmd, args, { encoding: "utf8", cwd: REPO, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"], ...(input == null ? {} : { input }) }).trim();
}

/** every FROZEN file: its blob at the freezing commit, at HEAD, and of the working tree
 *  (through git's own filters for that path) must be one and the same. `read(path)`
 *  may supply other bytes for a path (the self-test plants an edit); null = the disk */
export function frozenCheck(read = () => null) {
  const paths = Object.keys(FROZEN);
  const each = (args, specs) => specs.map(x => { try { return sh("git", [...args, x]); } catch { return null; } });
  const batch = (args, specs) => { try { const out = sh("git", [...args, ...specs]).split(/\r?\n/); return out.length === specs.length ? out : each(args, specs); } catch { return each(args, specs); } };
  const want = batch(["rev-parse"], paths.map(p => `${FROZEN[p]}:${p}`)), head = batch(["rev-parse"], paths.map(p => `HEAD:${p}`));
  const given = paths.map(p => read(p));
  const onDisk = paths.filter((_, i) => given[i] == null), hashed = onDisk.length ? batch(["hash-object", "--"], onDisk) : [];
  const files = {};
  paths.forEach((p, i) => {
    let disk = null;
    if (given[i] == null) disk = hashed[onDisk.indexOf(p)] ?? null;
    else try { disk = sh("git", ["hash-object", `--path=${p}`, "--stdin"], given[i]); } catch { disk = null; }
    files[p] = { commit: FROZEN[p].slice(0, 7), want: want[i], head: head[i], disk, ok: !!want[i] && want[i] === head[i] && want[i] === disk };
  });
  return { files, bad: paths.filter(p => !files[p].ok), ok: paths.every(p => files[p].ok) };
}

export function sourceHashes() {
  const out = {};
  for (const p of HASHED) {
    const bytes = readFileSync(resolve(REPO, p));
    out[p] = { raw: createHash("sha256").update(bytes).digest("hex"), lf: createHash("sha256").update(bytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex") };
  }
  return out;
}

/** refuse before Chrome: (ii)'s own preconditions (its hashed files and src/ clean,
 *  src/ = a304254, its reused scripts at their frozen heads), this script's hashed
 *  files clean, and every FROZEN file at its freezing commit */
export function preconditions() {
  const ii = D2.preconditions();
  const dirty = sh("git", ["status", "--porcelain", "--", ...HASHED, "src"]);
  const frozen = frozenCheck();
  return { dirty, ii, frozen: { ok: frozen.ok, bad: frozen.bad }, ok: ii.ok && dirty === "" && frozen.ok };
}

function printPlan(geos) {
  const [gR, gH] = geos;
  console.log("arm     n   dx  seed  box_W0 box_d0   dt          chunks x chunk = substeps  T_tau0  T/l_D  seedR_cells  diff_len_cells  probe_cells(2/4/8 l_D)  pred_end_gap_cells  est_s");
  let total = 0;
  for (const g of geos) {
    total += g.costS;
    console.log(`${g.id.padEnd(6)} ${String(g.n).padStart(4)} ${g.dx.toFixed(1)} ${String(g.seedX).padStart(5)} ${g.sideW0.toFixed(1).padStart(7)} ${g.boxD0.toFixed(0).padStart(6)}  ${g.staging.dt.toFixed(9)}  ${g.chunks} x ${String(g.chunk).padStart(4)} = ${String(g.substeps).padStart(6)}  ${g.tRun.toFixed(1).padStart(7)} ${g.tRunInLD.toFixed(1).padStart(6)} ${String(g.staging.seedRCells).padStart(12)} ${g.diffusionLengthCells.toFixed(0).padStart(15)}  ${g.probeCells.map(x => x.toFixed(1)).join("/").padStart(22)} ${g.predictedEndGapCells.toFixed(0).padStart(19)} ${g.costS.toFixed(0).padStart(6)}`);
  }
  const maxT = Math.max(...gH.sampleTimes.map((t, k) => Math.abs(t / gR.sampleTimes[k] - 1)));
  console.log(`sample time: |${gH.chunk} dt(${gH.dx}) / (${gR.chunk} dt(${gR.dx})) - 1| = ${sampleTimeAssert(gR, gH)} (< ${RULES.sampleTimeAssert}); max |t_k(H2048) / t_k(R1024) - 1| over 81 samples = ${maxT} (<= ${RULES.sampleTimeRel})`);
  console.log(`tong3's staging at dx ${gH.dx} would give chunk ${gH.staging.tong3Chunk} (refused: |${gH.staging.tong3Chunk} dt(${gH.dx}) / (${gR.chunk} dt(${gR.dx})) - 1| = ${Math.abs((gH.staging.tong3Chunk * gH.staging.dt) / (gR.chunk * gR.staging.dt) - 1).toExponential(2)})`);
  console.log(`late window L: v_k for k = ${PROTOCOL.lateWindow.join("..")} (${PROTOCOL.lateWindow[1] - PROTOCOL.lateWindow[0] + 1} values); prefix windows m = ${PROTOCOL.windows.join(", ")}`);
  console.log(`GPU: ~${(total / 60).toFixed(1)} min at (ii)'s recorded arm wall time per substep (n 1024 ${(COST.iiArmWallMs[1024] / COST.iiSubsteps).toFixed(3)} ms, n 2048 ${(COST.iiArmWallMs[2048] / COST.iiSubsteps).toFixed(3)} ms, probe and page load included); order R1024 then H2048; protocol: plan <= ${COST.planMin} min`);
  return total;
}

async function main() {
  const args = process.argv.slice(2);
  const known = ["--self-test", "--plan", "--run", "--port", "--arms"];
  for (let i = 0; i < args.length; i++) {
    if (!known.includes(args[i])) throw new Error(`unknown option ${args[i]}`);
    if (args[i] === "--port" || args[i] === "--arms") i++;
  }
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (!args.includes("--run")) {
    if (args.includes("--plan")) { printPlan(parseArms(JSON.parse(readFileSync(ARMS_PATH, "utf8")))); return 0; }
    const { selfTest } = await import("./flow-noflow-dx-selftest.mjs");
    return (await selfTest()) ? 0 : 1;
  }
  const geosAll = parseArms(JSON.parse(readFileSync(ARMS_PATH, "utf8")));
  const pick = opt("--arms")?.split(",").filter(Boolean);
  if (pick) for (const id of pick) if (!geosAll.some(g => g.id === id)) throw new Error(`--arms: unknown ${id}`);
  const geos = pick ? geosAll.filter(g => pick.includes(g.id)) : geosAll;
  const port = opt("--port") ?? "5297";
  if (!/^\d+$/.test(port)) throw new Error("--port must be a number");
  const pre = preconditions();
  if (!pre.ok) { console.log("FLOW-NOFLOW-DX REFUSED", JSON.stringify(pre)); return 1; }
  const ref = loadIiReference();

  const date = new Date().toISOString().slice(0, 10);
  const rawDir = resolve(REPO, `verify-out/flow-noflow-dx-${date}`);
  mkdirSync(rawDir, { recursive: true });
  const resultPath = resolve(REPO, `docs/validation/flow-noflow-dx-${date}${pick ? "-partial" : ""}.json`);
  const disk = sourceHashes();
  const result = {
    study: "Tong follow-up (iv): no-flow tip resolution at D2 (research measurement; tong3 stays NO VERDICT; follow-up (ii) stays DRIFTING / BOX-INDEPENDENT; FLOW-TIP-TONG stays FAILED)",
    protocol: "tasks/todo.md, Tong follow-up (iv): no-flow tip resolution at D2 - PROTOCOL, amended before any run",
    protocolCommit: PROTOCOL_COMMIT, amendmentCommit: AMENDMENT_COMMIT,
    commit: sh("git", ["rev-parse", "HEAD"]), preconditions: pre,
    committedBlobs: Object.fromEntries(HASHED.map(p => { try { return [p, sh("git", ["rev-parse", `HEAD:${p}`])]; } catch { return [p, null]; } })),
    replicaReference: { path: ref.path, commit: II_RESULT_COMMIT, run: ref.commit, vd0D: ref.vd0D, s: ref.s },
    date, started: new Date().toISOString(), argv: args, port, selected: geos.map(g => g.id),
    constants: K, rules: RULES, protocolTable: PROTOCOL, staging: Object.fromEntries(geosAll.map(g => [g.id, g.staging])),
    sampleTimeAssert: sampleTimeAssert(geosAll[0], geosAll[1]),
    sourceHashes: disk, arms: [], errors: [], completed: false,
  };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 1) + "\n");
  result.contention = { start: T2.headlessChromes() };   // before our own browser exists
  save();
  const { default: puppeteer } = await import("puppeteer-core");
  const { closeBrowser } = await import("../browser-cleanup.mjs");
  const extra = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
  if (!Array.isArray(extra) || extra.some(x => typeof x !== "string")) throw new Error("CHROME_ARGS must be a JSON string array");
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true, protocolTimeout: 600_000, args: ["--enable-unsafe-webgpu", "--enable-gpu", ...extra] });
  let servedOk = true;
  const ctx = {
    errors: result.errors, rawDir,
    async open(g) {
      const page = await browser.newPage();
      await page.bringToFront();
      page.on("pageerror", e => ctx.errors.push({ arm: g.id, kind: "page", message: String(e?.message ?? e) }));
      page.on("console", m => { if (m.type() === "error") ctx.errors.push({ arm: g.id, kind: "console", message: m.text() }); });
      await page.goto(`http://localhost:${port}/app/`, { waitUntil: "networkidle0", timeout: 60_000 });
      await page.waitForFunction("!!window.__solidify", { timeout: 60_000 });
      await page.evaluate(installDriver, HELPER_SRC);
      await page.evaluate(D2.installProbe);
      return page;
    },
    admit(m) {
      const x = T2.admission(m, disk);
      if (!x.ok) { servedOk = false; throw new Error(`not admitted: ${x.why}`); }
      return x;
    },
  };
  try {
    for (const g of geos) {
      const row = await runArm(ctx, g);
      result.arms.push(row);
      const r = row.runs.noflow, ws = r ? D2.prefixes(r.trace, g.lambda, g.staging.dx) : [];
      const L = r ? lateWindow(D2.perChunk(r.trace, g.lambda, g.staging.dx).series, g.lambda) : null;
      console.log("NDX-ARM", g.id, JSON.stringify({ staged: row.gridAccepted, chunk: g.staging.chunk, samples: r?.trace.length ?? 0, stopped: r?.stopped ?? null,
        s: ws.map(w => (w.available ? +(100 * w.s).toFixed(3) : null)), vd0D81: ws.at(-1)?.available ? +ws.at(-1).vd0D.toFixed(6) : null,
        L: L?.available ? { VL: +L.VL.toFixed(6), driftL: +(100 * L.driftL).toFixed(3), label: L.label } : null,
        probe: r?.probe?.at(-1) ?? null, probeError: r?.probeError, probeMatchesEnd: r?.probeMatchesEnd ?? null,
        wallS: Math.round(row.wallMs / 1000), exception: row.exception ? row.exception.split("\n")[0] : undefined }));
      save();
      if (!servedOk) { result.abort = "served source differs from the worktree, or a software adapter: stopping"; break; }
    }
  } catch (err) {
    result.exception = err?.stack ?? String(err);
  } finally {
    await closeBrowser(browser);
    result.contention.end = T2.headlessChromes();   // after our own browser is closed
  }
  result.servedVerified = servedOk;
  const meta = result.arms.map(r => JSON.stringify({ h: r.metadata?.hardware, w: r.metadata?.wgsl }));
  result.metadataConsistent = meta.every(x => x === meta[0]);
  result.metadata = result.arms[0]?.metadata ?? null;
  const byId = assess(result.arms, servedOk, ref);
  result.decision = decide(byId);
  result.finalHashes = sourceHashes();
  result.sourceStable = JSON.stringify(result.finalHashes) === JSON.stringify(disk);
  result.finalPreconditions = preconditions();
  result.completed = !result.exception && !result.abort && result.errors.length === 0 && result.sourceStable && servedOk
    && result.finalPreconditions.ok && result.metadataConsistent && result.arms.length === geos.length && result.arms.every(r => !r.exception);
  result.finished = new Date().toISOString();
  result.reading = null;   // written by a person after the run, never by this script
  save();
  const d = result.decision;
  const brief = x => ({ valid: x.valid, label: x.label, L: x.L?.label ?? null, VL: x.L?.VL ?? null, driftL: x.L?.driftL ?? null });
  console.log("NDX-DECISION", JSON.stringify({ verdict: d.verdict, why: d.why, d: d.d, e: d.e, R1024: { ...brief(d.R1024), replica: d.R1024.replica?.ok ?? null },
    H2048: { ...brief(d.H2048), sampleTimes: d.H2048.sampleTimes?.ok ?? null }, prediction: d.prediction }));
  console.log("FLOW-NOFLOW-DX", result.completed ? "RECORDED" : "FAILED", JSON.stringify({ result: resultPath, completed: result.completed,
    sourceStable: result.sourceStable, servedVerified: servedOk, errors: result.errors.length, exception: result.exception?.split("\n")[0], abort: result.abort,
    otherHeadlessChrome: [result.contention.start?.pids ?? null, result.contention.end?.pids ?? null] }));
  return result.completed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, err => { console.error(err?.stack ?? err); process.exitCode = 1; });
}
