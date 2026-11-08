// Tong follow-up (ii): no-flow tip stationarity at D2. A research measurement,
// NOT a regression gate, and NOT a re-score: tong3's NO VERDICT (and its
// counterfactual V-clause FAIL) stand as recorded, and nothing here can make the
// flow quantitative.
//
// At tong3's tier-P staging (calibrated pure melt, lambda 3.19, dx 0.8 W0, chunk
// 671), two NO-FLOW arms run 81 chunks (54351 substeps, 19.6 l_D / V_KR): N1024
// (seed centred, the tong3 box) and N2048 (seed centred, twice the box). Nested
// prefix windows m in {33, 45, 57, 69, 81} apply tong2's v_last / v_mid unchanged;
// N1024's m = 33 prefix must replicate tong3's no-flow; each arm is labelled
// STEADY or DRIFTING; the two arms give the box rule; and R* = 0.021946 /
// V*_noflow is reported only when N1024 is STEADY. A probe records u on row n/2
// at 2, 4 and 8 l_D ahead of the west tip (reported, never gating).
//
// Protocol: tasks/todo.md "Tong follow-up (ii): no-flow tip stationarity at D2 -
// PROTOCOL" (80be923) with its "Amendment before any run" (PROTOCOL_COMMIT below).
// Arms: flow-noflow-d2-arms.json, validated here against the protocol.
//
// Reuses, unchanged: flow-domain.mjs's in-page driver and tip/mirror arithmetic,
// flow-tong2.mjs's statistic, run-completeness clauses, admission and contention
// log, and flow-tong3.mjs's tier-P staging and tau V / W. All three files must be
// byte-identical to the heads their GPU runs froze (checked before a run and in
// the self-test). The only new in-page code is a read-only probe that copies row
// n/2 of the state texture through the page's own Simulation.readRows (no src/
// change); it never steps.
//
//   node scripts/research/flow-noflow-d2.mjs [--self-test]   CPU only (the default)
//   node scripts/research/flow-noflow-d2.mjs --plan          arms, run length and GPU cost
//   node scripts/research/flow-noflow-d2.mjs --run [--port 5297] [--arms ID,ID]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import * as T2 from "./flow-tong2.mjs";
import * as T3 from "./flow-tong3.mjs";
import { westTip, eastTip, columnMirror, slope, HELPER_SRC, installDriver } from "./flow-domain.mjs";

export const PROTOCOL_COMMIT = "d4b885674877c851514be0a43c1f1893061ad93b";
export const PROTOCOL_HEADER = "### Tong follow-up (ii): no-flow tip stationarity at D2 - PROTOCOL (pre-registered 2026-11-07; not built, not run)";
export const AMENDMENT_HEADER = "#### Amendment before any run (2026-11-07, follow-up ii)";
export const ORIGINAL_PROTOCOL_COMMIT = "80be923b2d99e78bba4143e0a33fc25cabc96b27";
/** the heads the earlier GPU runs froze: the reused files must still equal them */
export const FROZEN = Object.freeze({
  "scripts/research/flow-domain.mjs": "21e73ee5dafc77a47c603dc97999aa50b254d6e8",
  "scripts/research/flow-tong2.mjs": "21e73ee5dafc77a47c603dc97999aa50b254d6e8",
  "scripts/research/flow-tong3.mjs": "f7db85acc123780f6343de1442085df94ef471b0",
});
/** the recorded tong3 result the replica reads (committed in f47bc6f) */
export const TONG3_RESULT = "docs/validation/flow-tong3-2026-11-08.json";
export const REPO = T2.REPO;
export const D35_PASSED_COMMIT = T2.D35_PASSED_COMMIT;
const ARMS_PATH = fileURLToPath(new URL("./flow-noflow-d2-arms.json", import.meta.url));

const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };
const K = T2.K;

export const PROTOCOL = deepFreeze({
  lambda: 3.19, dx: 0.8, chunk: 671, chunks: 81, substeps: 54351, windows: [33, 45, 57, 69, 81],
  arms: [
    { id: "N1024", n: 1024, seedX: 512, seedY: 512, replica: true },
    { id: "N2048", n: 2048, seedX: 1024, seedY: 1024 },
  ],
  /** tong3 P768's no-flow m = 33 values as RECORDED (amendment item 1); the protocol
   *  text quotes them rounded, 0.0162725 and -4.454 % */
  replica: { vd0D: 0.016272541498534042, s: -0.044540341195214994, quotedVd0D: 0.0162725, quotedS: -0.04454 },
  /** tong3 P768's flow V d0/D as the protocol writes it (the R* numerator) */
  flowVd0D: 0.021946,
  exactNoflowVd0D: 0.0170, tongNoflowVd0D: 0.0180, tongRatio: 1.372,
  probeLD: [2, 4, 8], probeFarU: -0.55,
  tong3Verdict: "NO VERDICT (tong3, f47bc6f): stands as recorded; this script never re-scores it",
});

/** pre-registered thresholds (tasks/todo.md, follow-up ii) */
export const RULES = deepFreeze({
  replicaRel: 1e-6, replicaPoints: 0.0001, steadyMax: 0.02,
  boxIndependentV: 0.005, boxIndependentS: 0.005, boxDependent: 0.02, rLo: 1.26, rHi: 1.54,
});

/** the protocol's cost section: no flow ~0.98 ms per substep at n 1024, ~4x at 2048 */
export const COST = deepFreeze({ noflowMs1024: 0.98 });

export const SERVED = T2.SERVED;
export const HASHED = [...SERVED,
  "scripts/research/flow-noflow-d2.mjs", "scripts/research/flow-noflow-d2-selftest.mjs", "scripts/research/flow-noflow-d2-arms.json",
  ...Object.keys(FROZEN), "scripts/browser-cleanup.mjs"];

// ------------------------------------------------------------ staging and arms

/** tong3's tier-P staging unchanged (chunk 671 from its window), run for 81 chunks */
export function geometry(arm) {
  const sideW0 = arm.n * PROTOCOL.dx, s = T3.staging(PROTOCOL.lambda, PROTOCOL.dx, sideW0);
  return {
    ...arm, lambda: PROTOCOL.lambda, sideW0, staging: s, chunk: s.chunk, chunks: PROTOCOL.chunks, substeps: s.chunk * PROTOCOL.chunks,
    tRun: s.chunk * PROTOCOL.chunks * s.dt, tRunInLD: (s.chunk * PROTOCOL.chunks * s.dt * s.vKR) / s.lD,
    boxD0: arm.n * s.cellD0, diffusionLengthCells: Math.sqrt(s.dTilde * s.chunk * PROTOCOL.chunks * s.dt) / s.dx,
    /** the protocol's sizing: the west tip at V d0/D 0.0165 for the whole run, from the seed's edge */
    predictedEndGapCells: arm.seedX - s.seedRCells - (0.0165 * K.A2 * PROTOCOL.lambda * PROTOCOL.lambda / K.A1) * s.chunk * PROTOCOL.chunks * s.dt / s.dx,
    probeCells: PROTOCOL.probeLD.map(k => (k * s.lD) / s.dx),
    costS: (COST.noflowMs1024 * (arm.n / 1024) ** 2 * s.chunk * PROTOCOL.chunks) / 1000,
  };
}

/** validate the arm file against the protocol; throws with the reason */
export function parseArms(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("arms: not an object");
  for (const k of Object.keys(json)) if (!["study", "protocol", "protocolCommit", "arms"].includes(k)) throw new Error(`arms: unknown key ${k}`);
  if (json.protocolCommit !== PROTOCOL_COMMIT) throw new Error(`arms: protocolCommit ${json.protocolCommit} is not ${PROTOCOL_COMMIT}`);
  if (!Array.isArray(json.arms)) throw new Error("arms: arms must be an array");
  const want = PROTOCOL.arms.map(a => a.id), got = json.arms.map(a => a?.id);
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`arms: arms must be exactly ${want.join(", ")} in the protocol's order, not ${got.join(", ")}`);
  return json.arms.map((a, i) => {
    const p = PROTOCOL.arms[i];
    for (const k of Object.keys(a)) if (!["id", "n", "seedX", "seedY", "chunk", "chunks", "substeps", "replica"].includes(k)) throw new Error(`arms: ${a.id}: unknown key ${k}`);
    for (const k of ["n", "seedX", "seedY"]) if (a[k] !== p[k]) throw new Error(`arms: ${a.id}: ${k} ${a[k]} is not the pre-registered ${p[k]}`);
    if ((a.replica ?? false) !== (p.replica ?? false)) throw new Error(`arms: ${a.id}: replica is pre-registered as ${p.replica ?? false}`);
    if (a.seedX !== a.n / 2 || a.seedY !== a.n / 2 || a.n % 16 !== 0) throw new Error(`arms: ${a.id}: seed not centred or n not a multiple of 16`);
    const g = geometry(p);
    if (a.chunk !== PROTOCOL.chunk || a.chunks !== PROTOCOL.chunks || a.substeps !== PROTOCOL.substeps) throw new Error(`arms: ${a.id}: ${a.chunks} chunks of ${a.chunk} (${a.substeps}) are not the protocol's 81 of 671 (54351)`);
    if (g.chunk !== PROTOCOL.chunk || g.substeps !== PROTOCOL.substeps) throw new Error(`arms: ${a.id}: tong3's staging gives chunk ${g.chunk} (${g.substeps}), not 671 (54351)`);
    return g;
  });
}

// ------------------------------------------------------------ the probe (read-only, in page)

/** installed with page.evaluate(installProbe): copies row y of the state texture
 *  through the page's own Simulation.readRows and returns its T channel. It never
 *  steps, stages or writes anything. */
export function installProbe() {
  window.__nd2probe = {
    async tRow(y) {
      const sim = window.__solidify.sim();
      const d = await sim.readRows(y, 1);
      if (!d) throw new Error("probe: readRows failed");
      const out = new Array(sim.n);
      for (let i = 0; i < sim.n; i++) out[i] = d[i * 4 + 1];
      return out;
    },
  };
  return true;
}

/** u = T - 1 (the calibrated pure melt's drive, shaders.ts "drive = T - 1.0"; far field
 *  -Delta) at a sub-cell x on a row, linear between cells; null outside the row */
export function uAt(tRow, x) {
  if (!Number.isFinite(x) || x < 0 || x > tRow.length - 1) return null;
  const i = Math.min(tRow.length - 2, Math.floor(x)), f = x - i;
  return (1 - f) * tRow[i] + f * tRow[i + 1] - 1;
}

export function probeSample(tRow, xWest, probeCells) {
  return Object.fromEntries(PROTOCOL.probeLD.map((k, j) => [`u${k}`, uAt(tRow, xWest - probeCells[j])]));
}

// ------------------------------------------------------------ orchestration

const b64 = arr => Buffer.from(Float32Array.from(arr).buffer).toString("base64");

/** one no-flow run of 81 chunks through D3.4's driver, with the probe after each chunk */
export async function runNoflow(ctx, page, g) {
  const s = g.staging;
  const cfg = { lambda: g.lambda, n: g.n, seedX: g.seedX, seedY: g.seedY, dx: s.dx, dt: s.dt, dTilde: s.dTilde, eps4: K.EPS4,
    delta: K.DELTA, uLat: s.uLat, pr: K.PR, seedR: s.seedRCells, flow: null };
  const run = { kind: "noflow", scale: null, cfg, trace: [], probe: [], stopped: false, flowLost: false, flowOnDuring: false };
  const rows = [];
  let lastTRow = null;
  const t0 = Date.now();
  try {
    run.setup = await page.evaluate(c => window.__fd.stage(c), cfg);
    let t = 0;
    for (let k = 0; k < g.chunks; k++) {
      const a = await page.evaluate(m => window.__fd.advance(m), s.chunk);
      t += s.chunk * s.dt;
      const xWest = westTip(a.row, g.seedX), xEast = eastTip(a.row, g.seedX);
      run.trace.push({ k, t, xWest: Number.isFinite(xWest) ? xWest : null, xEast: Number.isFinite(xEast) ? xEast : null, delivered: a.got, ms: a.ms });
      rows.push(a.row);
      if (a.flowOn) run.flowOnDuring = true;
      if (!run.probeError) {
        try {
          lastTRow = await page.evaluate(y => window.__nd2probe.tRow(y), g.seedY);
          run.probe.push({ k, ...probeSample(lastTRow, xWest, g.probeCells) });
        } catch (err) { run.probeError = String(err?.message ?? err).split("\n")[0]; }   // the probe never gates
      }
      // the stop rule (as tong2): the west tip within 32 cells of x = 0 ends the run; the arm is invalid
      if (!(xWest > K.STOP_CELLS)) { run.stopped = true; break; }
    }
    run.summary = T2.summarizeRun(run.trace, g.lambda, s.dx);
    const e = await page.evaluate(x => window.__fd.end(x), run.trace.at(-1).xWest);
    run.end = { ...columnMirror(e.column, g.seedY), nonFinite: e.nonFinite, asymPhi: e.asymPhi, asymT: e.asymT, vel: e.vel };
    // witness: the probe's last copy is the state the driver's own end() read
    run.probeMatchesEnd = lastTRow ? lastTRow.length === e.tRow.length && lastTRow.every((v, i) => v === e.tRow[i]) : null;
    run.rowsSha256 = createHash("sha256").update(Buffer.from(Float32Array.from(rows.flat()).buffer)).digest("hex");
    if (ctx.rawDir) {
      const bytes = gzipSync(Buffer.from(JSON.stringify({ id: g.id, n: g.n, seedY: g.seedY, chunk: s.chunk, dt: s.dt,
        rowsF32: rows.map(b64), columnF32: b64(e.column), tRowF32: b64(e.tRow) })));
      const path = `${ctx.rawDir}/${g.id}-noflow.json.gz`;
      writeFileSync(path, bytes);
      run.raw = { path, sha256: createHash("sha256").update(bytes).digest("hex"), rows: rows.length };
    }
  } catch (err) {
    run.error = err?.stack ?? String(err);
  } finally {
    try { run.finished = await page.evaluate(() => window.__fd.finish()); } catch (err) { run.finishError = err?.stack ?? String(err); }
    run.wallMs = Date.now() - t0;
  }
  return run;
}

/** one arm in its own page */
export async function runArm(ctx, g) {
  const out = { id: g.id, n: g.n, seedX: g.seedX, seedY: g.seedY, lambda: g.lambda, dx: g.staging.dx, sideW0: g.sideW0, boxD0: g.boxD0,
    chunk: g.chunk, chunks: g.chunks, substeps: g.substeps, replica: !!g.replica, runs: {}, started: new Date().toISOString() };
  const before = ctx.errors.length, t0 = Date.now();
  let page = null;
  try {
    page = await ctx.open(g);
    out.metadata = await page.evaluate(paths => window.__fd.metadata(paths), SERVED);
    out.admission = ctx.admit?.(out.metadata) ?? null;   // throws before any GPU stepping if the page is not the code we hashed
    out.runs.noflow = await runNoflow(ctx, page, g);
    if (out.runs.noflow.error) throw new Error(`noflow: ${out.runs.noflow.error}`);
  } catch (err) {
    out.exception = err?.stack ?? String(err);
  } finally {
    // the grid the app actually ran (n 2048 with flow off: tasks/todo.md, follow-up ii status)
    out.gridAccepted = { wanted: g.n, staged: out.runs.noflow?.setup?.n ?? null, flowOn: out.runs.noflow?.setup?.flowOn ?? null,
      delivered: out.runs.noflow ? out.runs.noflow.trace.reduce((s, p) => s + p.delivered, 0) : 0 };
    if (page) {
      try { ctx.errors.push(...(await page.evaluate(() => window.__fd.errors())).map(x => ({ arm: g.id, ...x }))); }
      catch (err) { ctx.errors.push({ arm: g.id, kind: "error-readback", message: String(err?.message ?? err) }); }
      await page.close().catch(err => ctx.errors.push({ arm: g.id, kind: "page-close", message: String(err?.message ?? err) }));
    }
    out.wallMs = Date.now() - t0;
    out.errors = ctx.errors.slice(before);
  }
  return out;
}

// ------------------------------------------------------------ statistic, validity, decision

/** tong2's statistic on each nested prefix of the first m samples */
export function prefixes(trace, lambda, dx) {
  return PROTOCOL.windows.map(m => {
    if (trace.length < m) return { m, available: false };
    const s = T2.summarizeRun(trace.slice(0, m), lambda, dx);
    return { m, available: true, vLast: s.vLast, vMid: s.vMid, s: s.stationarity, vd0D: s.vd0D, tauVW: T3.tauVW(s.vd0D, lambda),
      windowSamples: [s.windowSamples[0], s.windowSamples.at(-1)], midSamples: [s.midSamples[0], s.midSamples.at(-1)] };
  });
}

/** STEADY / DRIFTING and m* from the s_m of the five windows (in the protocol's order) */
export function label(ws) {
  const s81 = ws.at(-1);
  if (!s81?.available || !Number.isFinite(s81.s)) return { label: null, mStar: null, why: "window 81 not available" };
  if (!(Math.abs(s81.s) <= RULES.steadyMax)) return { label: "DRIFTING", mStar: null, s81: s81.s };
  let mStar = s81.m;
  for (let i = ws.length - 1; i >= 0; i--) {
    if (ws[i].available && Number.isFinite(ws[i].s) && Math.abs(ws[i].s) <= RULES.steadyMax) mStar = ws[i].m;
    else break;
  }
  return { label: "STEADY", mStar, s81: s81.s, vStar: s81.vd0D };
}

/** per-chunk speeds: v_k between samples k-1 and k (k = 1..), V d0/D; the first k below
 *  the exact 0.0170; and the drift: the least-squares slope of v_k against k over the
 *  last third of the samples (amendment item 3) */
export function perChunk(trace, lambda, dx) {
  const toVd0D = v => (v * K.A1) / (K.A2 * lambda * lambda);
  const series = [];
  for (let k = 1; k < trace.length; k++) {
    const a = trace[k - 1], b = trace[k];
    series.push({ k, vd0D: Number.isFinite(a.xWest) && Number.isFinite(b.xWest) ? toVd0D((-dx * (b.xWest - a.xWest)) / (b.t - a.t)) : null });
  }
  const firstBelowExact = series.find(p => p.vd0D != null && p.vd0D < PROTOCOL.exactNoflowVd0D)?.k ?? null;
  const third = Math.floor(trace.length / 3), lastThird = series.filter(p => p.k >= 2 * third && p.vd0D != null);
  const drift = lastThird.length >= 2 ? slope(lastThird.map(p => ({ t: p.k, x: p.vd0D }))) : null;
  return { series, firstBelowExact, driftPerChunk: drift, driftWindow: lastThird.length ? [lastThird[0].k, lastThird.at(-1).k] : null };
}

/** per-arm statistic and validity, in place; returns the arms by id */
export function assess(arms, served) {
  for (const a of arms) {
    const run = a.runs?.noflow;
    a.servedVerified = !!served;
    const issues = [a.exception ? "exception" : null, a.errors?.length ? `${a.errors.length} page/device errors` : null, served ? null : "served source not verified",
      // tong2's completeness clauses, its 33-sample count replaced by this protocol's 81
      ...T2.runIssues(run, a.chunk).filter(x => !/^\d+ samples$/.test(x)),
      run && !run.stopped && run.trace.length !== PROTOCOL.chunks ? `${run.trace.length} samples` : null,
      run?.flowOnDuring ? "flow on during the run" : null].filter(Boolean);
    a.complete = issues.length === 0;
    a.stopRule = !!run?.stopped;
    a.windows = run ? prefixes(run.trace, a.lambda, a.dx) : [];
    a.perChunk = run ? perChunk(run.trace, a.lambda, a.dx) : null;
    a.decision = label(a.windows);
    if (a.replica) {
      const w33 = a.windows.find(w => w.m === 33);
      const dv = w33?.available ? w33.vd0D / PROTOCOL.replica.vd0D - 1 : null, ds = w33?.available ? w33.s - PROTOCOL.replica.s : null;
      a.replicaCheck = { vd0D: w33?.vd0D ?? null, s: w33?.s ?? null, relV: dv, pointsS: ds == null ? null : 100 * ds,
        ok: dv != null && Math.abs(dv) <= RULES.replicaRel && Math.abs(ds) <= RULES.replicaPoints };
    }
    const why = [];
    if (!a.complete) why.push(`incomplete (${issues.join("; ")})`);
    if (a.stopRule) why.push("stop rule");
    if (a.replica && !a.replicaCheck.ok) why.push(`replica missed (V ${a.replicaCheck.relV}, s ${a.replicaCheck.pointsS} points)`);
    a.valid = why.length === 0;
    a.invalidBy = why;
    const v81 = a.windows.at(-1);
    a.vsReferences = v81?.available ? { exact: v81.vd0D / PROTOCOL.exactNoflowVd0D - 1, tong: v81.vd0D / PROTOCOL.tongNoflowVd0D - 1 } : null;
    a.endGapCells = Number.isFinite(run?.summary?.endGapCells) ? run.summary.endGapCells : null;
  }
  return Object.fromEntries(arms.map(a => [a.id, a]));
}

/** the box rule from the two arms' window-81 values */
export function boxRule(dV, dS) {
  if (!Number.isFinite(dV) || !Number.isFinite(dS)) return "NOT TESTED";
  if (Math.abs(dV) <= RULES.boxIndependentV && Math.abs(dS) <= RULES.boxIndependentS) return "BOX-INDEPENDENT";
  if (Math.abs(dV) > RULES.boxDependent || Math.abs(dS) > RULES.boxDependent) return "BOX-DEPENDENT";
  return "UNRESOLVED";
}

/** the pre-registered decision (tasks/todo.md, follow-up ii, as amended before any run) */
export function decide(byId) {
  const a = byId.N1024, b = byId.N2048;
  const arm = x => (x ? { valid: x.valid, invalidBy: x.invalidBy, label: x.decision?.label ?? null, mStar: x.decision?.mStar ?? null,
    s: Object.fromEntries((x.windows ?? []).map(w => [w.m, w.available ? w.s : null])), vd0D: Object.fromEntries((x.windows ?? []).map(w => [w.m, w.available ? w.vd0D : null])),
    tauVW: Object.fromEntries((x.windows ?? []).map(w => [w.m, w.available ? w.tauVW : null])), vsReferences: x.vsReferences ?? null,
    firstBelowExact: x.perChunk?.firstBelowExact ?? null, driftPerChunk: x.perChunk?.driftPerChunk ?? null, endGapCells: x.endGapCells ?? null,
    replica: x.replicaCheck ?? undefined } : { valid: false, invalidBy: ["not run"], label: null });
  const w81 = x => x?.windows?.at(-1);
  let box;
  if (!a?.valid || !b?.valid) box = { verdict: "NOT TESTED", why: `the box question stays open: ${[!a?.valid ? `N1024 ${a ? "invalid" : "not run"}` : null, !b?.valid ? `N2048 ${b ? "invalid" : "not run"}` : null].filter(Boolean).join(", ")}` };
  else {
    const dV = w81(b).vd0D / w81(a).vd0D - 1, dS = w81(b).s - w81(a).s;
    box = { verdict: boxRule(dV, dS), dV, dS };
  }
  let Rstar = null;
  if (a?.valid && a.decision?.label === "STEADY") {
    const v = a.decision.vStar, R = PROTOCOL.flowVd0D / v;
    Rstar = { R, vStarNoflow: v, inBand: R >= RULES.rLo && R <= RULES.rHi, vsTong: { diff: R - PROTOCOL.tongRatio, rel: R / PROTOCOL.tongRatio - 1 },
      note: "a measurement, not a verdict: it does not change tong3's NO VERDICT and cannot make the flow quantitative" };
  }
  return {
    N1024: arm(a), N2048: arm(b), box, Rstar,
    RstarWhy: Rstar ? null : !a ? "N1024 not run" : !a.valid ? "N1024 invalid" : `N1024 is ${a.decision?.label ?? "unlabelled"}`,
    tong3: PROTOCOL.tong3Verdict,
  };
}

// ------------------------------------------------------------ CLI

function sh(cmd, args) { return execFileSync(cmd, args, { encoding: "utf8", cwd: REPO, stdio: ["ignore", "pipe", "pipe"] }).trim(); }

export function sourceHashes() {
  const out = {};
  for (const p of HASHED) {
    const bytes = readFileSync(resolve(REPO, p));
    out[p] = { raw: createHash("sha256").update(bytes).digest("hex"), lf: createHash("sha256").update(bytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex") };
  }
  return out;
}

/** refuse before Chrome: hashed files and src/ clean, src/ = a304254, the reused scripts = their frozen heads */
export function preconditions() {
  const dirty = sh("git", ["status", "--porcelain", "--", ...HASHED, "src"]);
  const same = (c, paths) => { try { sh("git", ["diff", "--quiet", c, "HEAD", "--", ...paths]); return true; } catch { return false; } };
  const frozen = Object.fromEntries(Object.entries(FROZEN).map(([p, c]) => [p, same(c, [p])]));
  const srcAsD35 = same(D35_PASSED_COMMIT, ["src"]);
  return { dirty, srcAsD35, frozen, ok: dirty === "" && srcAsD35 && Object.values(frozen).every(Boolean) };
}

function printPlan(geos) {
  console.log("arm      n  seed   box_d0  chunks x chunk = substeps  T_tau0  T/l_D  diff_len_cells  pred_end_gap_cells  probe_cells  est_s");
  let total = 0;
  for (const g of geos) {
    total += g.costS;
    console.log(`${g.id.padEnd(6)} ${String(g.n).padStart(4)} ${String(g.seedX).padStart(5)} ${g.boxD0.toFixed(0).padStart(8)}  ${g.chunks} x ${g.chunk} = ${g.substeps}  ${g.tRun.toFixed(1).padStart(7)} ${g.tRunInLD.toFixed(1).padStart(6)} ${g.diffusionLengthCells.toFixed(0).padStart(15)} ${g.predictedEndGapCells.toFixed(0).padStart(19)}  ${g.probeCells.map(x => x.toFixed(0)).join("/").padStart(11)} ${g.costS.toFixed(0).padStart(6)}`);
  }
  console.log(`stepping ~${(total / 60).toFixed(1)} min at ${COST.noflowMs1024} ms per no-flow substep at n 1024 (x (n/1024)^2); protocol: plan <= 10 min`);
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
    const { selfTest } = await import("./flow-noflow-d2-selftest.mjs");
    return (await selfTest()) ? 0 : 1;
  }
  const geosAll = parseArms(JSON.parse(readFileSync(ARMS_PATH, "utf8")));
  const pick = opt("--arms")?.split(",").filter(Boolean);
  if (pick) for (const id of pick) if (!geosAll.some(g => g.id === id)) throw new Error(`--arms: unknown ${id}`);
  const geos = pick ? geosAll.filter(g => pick.includes(g.id)) : geosAll;
  const port = opt("--port") ?? "5297";
  if (!/^\d+$/.test(port)) throw new Error("--port must be a number");
  const pre = preconditions();
  if (!pre.ok) { console.log("FLOW-NOFLOW-D2 REFUSED", JSON.stringify(pre)); return 1; }

  const date = new Date().toISOString().slice(0, 10);
  const rawDir = resolve(REPO, `verify-out/flow-noflow-d2-${date}`);
  mkdirSync(rawDir, { recursive: true });
  const resultPath = resolve(REPO, `docs/validation/flow-noflow-d2-${date}${pick ? "-partial" : ""}.json`);
  const disk = sourceHashes();
  const result = {
    study: "Tong follow-up (ii): no-flow tip stationarity at D2 (research measurement; tong3 stays NO VERDICT; FLOW-TIP-TONG stays FAILED)",
    protocol: "tasks/todo.md, Tong follow-up (ii): no-flow tip stationarity at D2 - PROTOCOL, amended before any run", protocolCommit: PROTOCOL_COMMIT,
    commit: sh("git", ["rev-parse", "HEAD"]), preconditions: pre,
    committedBlobs: Object.fromEntries(HASHED.map(p => { try { return [p, sh("git", ["rev-parse", `HEAD:${p}`])]; } catch { return [p, null]; } })),
    date, started: new Date().toISOString(), argv: args, port, selected: geos.map(g => g.id),
    constants: K, rules: RULES, protocolTable: PROTOCOL, staging: Object.fromEntries(geosAll.map(g => [g.id, g.staging])),
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
      await page.evaluate(installProbe);
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
      const r = row.runs.noflow, ws = r ? prefixes(r.trace, g.lambda, g.staging.dx) : [];
      console.log("ND2-ARM", g.id, JSON.stringify({ staged: row.gridAccepted, samples: r?.trace.length ?? 0, stopped: r?.stopped ?? null,
        s: ws.map(w => (w.available ? +(100 * w.s).toFixed(3) : null)), vd0D81: ws.at(-1)?.available ? +ws.at(-1).vd0D.toFixed(6) : null,
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
  const byId = assess(result.arms, servedOk);
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
  console.log("ND2-DECISION", JSON.stringify({ N1024: { valid: d.N1024.valid, label: d.N1024.label, mStar: d.N1024.mStar, replica: d.N1024.replica?.ok ?? null },
    N2048: { valid: d.N2048.valid, label: d.N2048.label, mStar: d.N2048.mStar }, box: d.box.verdict, Rstar: d.Rstar?.R ?? null, RstarWhy: d.RstarWhy }));
  console.log("FLOW-NOFLOW-D2", result.completed ? "RECORDED" : "FAILED", JSON.stringify({ result: resultPath, completed: result.completed,
    sourceStable: result.sourceStable, servedVerified: servedOk, errors: result.errors.length, exception: result.exception?.split("\n")[0], abort: result.abort,
    otherHeadlessChrome: [result.contention.start?.pids ?? null, result.contention.end?.pids ?? null] }));
  return result.completed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, err => { console.error(err?.stack ?? err); process.exitCode = 1; });
}
