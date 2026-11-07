// Next Tong comparison ("tong2"): a research comparison, NOT a regression gate.
//
// FLOW-TIP-TONG (11-01) stays FAILED as recorded. This is a NEW comparison with
// its own verdict: Tong, Beckermann, Karma & Li 2001 (PRE 63:061601) Table II at
// Tong's own lambda (D = a2 lambda) and boxes in d0, on the D3.5 velocity inlet,
// with a stationarity clause, at the app's resolution (tier P, dx 0.8 W0) and at
// Tong's (tier T, dx 0.4 W0).
//
// Protocol: tasks/todo.md "Next Tong comparison - PROTOCOL ONLY (pre-registered
// 2026-11-07; not built, not run)" with its "Amendment before any run", both
// committed before any run (PROTOCOL_COMMIT below). Arms: flow-tong2-arms.json,
// validated here against the protocol (rows, grids, and the window table, which
// is recomputed from the window formula).
//
// Reuses scripts/research/flow-domain.mjs (D3.4) unchanged: the tip, fit, window
// and mirror arithmetic, the in-page driver (installDriver: staging, chunked
// stepping, readback, restore) and its served-source metadata (each served file
// read by its ?raw import, by fetch only when the import throws, vehicle recorded).
//
//   node scripts/research/flow-tong2.mjs [--self-test]   CPU only (the default)
//   node scripts/research/flow-tong2.mjs --plan          arms, window and GPU cost
//   node scripts/research/flow-tong2.mjs --run [--port 5297] [--arms ID,ID]
//
// --run drives Chrome/WebGPU and needs a Vite server for THIS worktree
// (`npx vite --port 5297 --strictPort`). Before launching Chrome it refuses unless
// the hashed files are committed and unmodified and src/ is byte-identical to the
// head that passed the D3.5 GPU gates; each page is admitted only if its served
// source equals this tree's. It writes docs/validation/flow-tong2-<date>.json
// (every tip trace, run metadata, validity, the pre-registered verdicts) and the
// raw centre rows to verify-out/flow-tong2-<date>/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { westTip, eastTip, columnMirror, slope, windows, HELPER_SRC, installDriver } from "./flow-domain.mjs";

export const PROTOCOL_COMMIT = "0800b80c479adfa54ffe36931cc0672d22f7134a";
export const PROTOCOL_HEADER = "### Next Tong comparison - PROTOCOL ONLY (pre-registered 2026-11-07; not built, not run)";
export const AMENDMENT_HEADER = "#### Amendment before any run (2026-11-07)";
/** the head whose src/ passed the D3.5 GPU gates 15/15 (root, 2026-11-07, Arc 140V):
 *  the protocol's "Runs only on a head that passed the D3.5 GPU gates" */
export const D35_PASSED_COMMIT = "a3042546d76be27d6d5abca1bc2a63853e1bdb76";
const ARMS_PATH = fileURLToPath(new URL("./flow-tong2-arms.json", import.meta.url));
/** the repository root: every path below is relative to it, whatever the cwd */
export const REPO = fileURLToPath(new URL("../../", import.meta.url));

const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };

/** the fixed staging: the 11-01 / D3.4 calibrated pure melt, plus the window constants */
export const K = deepFreeze({
  A1: 0.8839, A2: 0.6267, DELTA: 0.55, EPS4: 0.05, REF: 0.017, PR: 23.1, UD0D: 0.035,
  SEED_R_W0: 8, NS: 33, TRAVEL_LD: 8, INLET_MARGIN_W0: 38.4, INLET_SPEED: 1.5, STOP_CELLS: 32,
  /** dx in W0 per tier */
  TIERS: { P: 0.8, T: 0.4 },
  /** flowRefusal() refuses flow above 1024 (flow.ts), and main.ts re-checks it every frame */
  N_MAX: 1024,
  /** Tong et al. 2001 Table I: the exact no-flow V d0/D at eps4 0.05, Delta 0.55 (reported only) */
  EXACT_NOFLOW_VD0D: 0.0170,
});

/** pre-registered thresholds (tasks/todo.md, Next Tong comparison) */
export const RULES = deepFreeze({
  bandLo: 1.26, bandHi: 1.54, spreadMax: 0.05, vRatioMax: 0.10, stationarityMax: 0.02, inletTol: 1e-4, minValidRows: 2,
  /** D3.4's V3 tolerance: REPORTED here, never gating (the protocol lists V3 under "Reported") */
  mirrorTol: 0.05,
});

/** the protocol's rows, grids and window table, as written (tasks/todo.md) */
export const PROTOCOL = deepFreeze({
  rows: {
    D2: { D: 2, lambda: 3.19, sideW0: 409.6, tongBoxD0: 1479, tongVd0D: 0.0247, tongRatio: 1.372, informationOnly: false },
    D3: { D: 3, lambda: 4.79, sideW0: 256, tongBoxD0: 1384, tongVd0D: 0.0248, tongRatio: 1.417, informationOnly: false },
    "D4-921": { D: 4, lambda: 6.38, sideW0: 128, tongBoxD0: 921, tongVd0D: 0.0265, tongRatio: 1.550, informationOnly: true },
    "D4-1658": { D: 4, lambda: 6.38, sideW0: 230.4, tongBoxD0: 1658, tongVd0D: 0.0240, tongRatio: 1.404, informationOnly: false },
    "D4-3315": { D: 4, lambda: 6.38, sideW0: 460.8, tongBoxD0: 3315, tongVd0D: 0.0244, tongRatio: 1.427, informationOnly: false },
  },
  /** [tier P, tier T]; null = not run in that tier */
  n: { D2: [512, 1024], D3: [320, 640], "D4-921": [160, 320], "D4-1658": [288, 576], "D4-3315": [576, null] },
  substeps: { D2: [17919, 71709], D3: [6138, 24618], "D4-921": [990, 3993], "D4-1658": [3894, 15576], "D4-3315": [5544, null] },
  falsification: "D2-P",
});

/** cost model of the protocol's cost section (Arc 140V, from D3.4's per-arm times):
 *  ms per substep = max(floor at n 640, upper bound per 1024^2-substep x (n/1024)^2) */
export const COST = deepFreeze({ flowMs1024: 2.7, noflowMs1024: 0.9, flowFloorMs: 0.83, noflowFloorMs: 0.34 });

/** files whose bytes define what ran (hashed before and after; served copies checked) */
export const HASHED = ["src/sim.ts", "src/shaders.ts", "src/lbm.ts", "src/flow.ts", "src/main.ts", "src/render.ts",
  "scripts/research/flow-tong2.mjs", "scripts/research/flow-tong2-selftest.mjs", "scripts/research/flow-tong2-arms.json",
  "scripts/research/flow-domain.mjs", "scripts/browser-cleanup.mjs"];
export const SERVED = ["src/sim.ts", "src/shaders.ts", "src/lbm.ts", "src/flow.ts", "src/main.ts", "src/render.ts"];

/** the coupling (P2.flowScale) of each run kind; null = flow off */
export const SCALE = deepFreeze({ noflow: null, flow: 1, zero: 0, reversed: -1 });

// ------------------------------------------------------------ staging and window

/** every number one (lambda, tier, box) is staged with: the 11-01 / D3.4 staging and
 *  the protocol's window T = min(8 l_D / V_KR, s / (1.5 V_KR)) in 33 equal chunks */
export function staging(lambda, dx, sideW0) {
  const { A1, A2, REF, NS, TRAVEL_LD, PR, UD0D, SEED_R_W0, INLET_MARGIN_W0, INLET_SPEED } = K;
  const dTilde = A2 * lambda, dt = (0.15 * dx * dx) / Math.max(1, dTilde);
  const vKR = (REF * dTilde * lambda) / A1;                 // W0 per tau0
  const lD = dTilde / vKR;                                  // W0
  const travel = (TRAVEL_LD * dTilde) / vKR;                // 8 l_D in W0 (D3.4's arithmetic)
  const tTravel = travel / vKR;                             // 8 l_D / V_KR
  const s = sideW0 / 2 - SEED_R_W0 - INLET_MARGIN_W0;       // seed edge to the stop margin, W0
  const tInlet = s / (INLET_SPEED * vKR);
  const T = Math.min(tTravel, tInlet);
  const chunk = Math.round(T / NS / dt);                    // no 50-substep floor: the table has 990 = 30 x 33
  const uLat = UD0D * (lambda / A1) * 0.15 * dx;            // cells per substep (D3.4's expression)
  const d = (dTilde * dt) / (dx * dx);                      // diffusion number (0.15)
  const nuLat = d * PR, tau = 0.5 + 3 * nuLat;
  return {
    lambda, dx, sideW0, dTilde, dt, vKR, lD, tTravel, s, tInlet, T, TinLD: (T * vKR) / lD, bound: tInlet < tTravel ? "inlet" : "travel",
    chunk, substeps: chunk * NS, tSampled: chunk * NS * dt,
    uLat, diffusionNumber: d, nuLat, tau, mach: uLat * Math.sqrt(3), peCell: uLat / d,
    cellD0: (dx * lambda) / A1, lDCells: lD / dx, nuOverUCells: nuLat / uLat, seedRCells: SEED_R_W0 / dx,
  };
}

/** derived geometry of one arm (row x tier): lengths in d0, prediction, cost */
export function geometry(arm, row) {
  const dx = K.TIERS[arm.tier], s = staging(row.lambda, dx, row.sideW0), seed = arm.n / 2;
  const a = (arm.n / 1024) ** 2;
  const flowMs = Math.max(COST.flowFloorMs, COST.flowMs1024 * a), noflowMs = Math.max(COST.noflowFloorMs, COST.noflowMs1024 * a);
  return {
    ...arm, falsification: !!arm.falsification, D: row.D, lambda: row.lambda, sideW0: row.sideW0, tongBoxD0: row.tongBoxD0,
    tongVd0D: row.tongVd0D, tongRatio: row.tongRatio, informationOnly: !!row.informationOnly,
    seedX: seed, seedY: seed, staging: s, chunk: s.chunk, boxD0: arm.n * s.cellD0,
    initialGapCells: seed - s.seedRCells,
    /** the west tip after T at 1.5 V_KR from the seed's edge (the window's own bound), cells from x = 0 */
    predictedEndGapCells: seed - s.seedRCells - (K.INLET_SPEED * s.vKR * s.tSampled) / dx,
    costS: { flow: (flowMs * s.substeps) / 1000, noflow: (noflowMs * s.substeps) / 1000,
      falsification: arm.falsification ? (2 * flowMs * s.substeps) / 1000 : 0 },
  };
}

const ARM_KEYS = ["id", "row", "tier", "n", "substeps", "falsification"];
const ROW_KEYS = ["id", "D", "lambda", "sideW0", "tongBoxD0", "tongVd0D", "tongRatio", "informationOnly"];

/** validate the arm file against the protocol; throws with the reason */
export function parseArms(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("arms: not an object");
  for (const k of Object.keys(json)) if (!["study", "protocol", "protocolCommit", "rows", "arms", "notRun"].includes(k)) throw new Error(`arms: unknown key ${k}`);
  if (json.protocolCommit !== PROTOCOL_COMMIT) throw new Error(`arms: protocolCommit ${json.protocolCommit} is not ${PROTOCOL_COMMIT}`);
  if (!Array.isArray(json.rows) || !Array.isArray(json.arms)) throw new Error("arms: rows and arms must be arrays");
  const rows = {};
  for (const r of json.rows) {
    if (!r || typeof r !== "object") throw new Error("arms: row not an object");
    for (const k of Object.keys(r)) if (!ROW_KEYS.includes(k)) throw new Error(`arms: row ${r.id}: unknown key ${k}`);
    const want = PROTOCOL.rows[r.id];
    if (!want) throw new Error(`arms: row ${r.id} not pre-registered`);
    if (rows[r.id]) throw new Error(`arms: duplicate row ${r.id}`);
    for (const k of ROW_KEYS.slice(1)) if ((r[k] ?? false) !== want[k]) throw new Error(`arms: row ${r.id}: ${k} ${r[k]} is not the pre-registered ${want[k]}`);
    rows[r.id] = r;
  }
  const missingRows = Object.keys(PROTOCOL.rows).filter(id => !rows[id]);
  if (missingRows.length) throw new Error(`arms: rows missing: ${missingRows.join(", ")}`);
  const seen = new Set(), out = [];
  for (const a of json.arms) {
    if (!a || typeof a !== "object") throw new Error("arms: arm not an object");
    for (const k of Object.keys(a)) if (!ARM_KEYS.includes(k)) throw new Error(`arms: ${a.id}: unknown key ${k}`);
    if (seen.has(a.id)) throw new Error(`arms: duplicate id ${a.id}`);
    seen.add(a.id);
    const row = rows[a.row];
    if (!row) throw new Error(`arms: ${a.id}: unknown row ${a.row}`);
    const ti = ["P", "T"].indexOf(a.tier);
    if (ti < 0) throw new Error(`arms: ${a.id}: tier ${a.tier}`);
    if (a.id !== `${a.row}-${a.tier}`) throw new Error(`arms: ${a.id}: id must be row-tier`);
    const dx = K.TIERS[a.tier];
    if (!Number.isInteger(a.n) || a.n % 16 !== 0) throw new Error(`arms: ${a.id}: n ${a.n} must be a multiple of 16 (readRows)`);
    if (a.n > K.N_MAX) throw new Error(`arms: ${a.id}: n ${a.n} over ${K.N_MAX} (flowRefusal: the frame loop turns flow off above 1024)`);
    if (!(Math.abs(a.n * dx - row.sideW0) < 1e-9)) throw new Error(`arms: ${a.id}: n ${a.n} x dx ${dx} is not the side ${row.sideW0} W0`);
    if (PROTOCOL.n[a.row][ti] !== a.n) throw new Error(`arms: ${a.id}: n ${a.n} is not the protocol's ${PROTOCOL.n[a.row][ti]}`);
    if (PROTOCOL.substeps[a.row][ti] !== a.substeps) throw new Error(`arms: ${a.id}: substeps ${a.substeps} are not the protocol's ${PROTOCOL.substeps[a.row][ti]}`);
    const s = staging(row.lambda, dx, row.sideW0);
    if (s.substeps !== a.substeps) throw new Error(`arms: ${a.id}: the window formula gives ${s.substeps} substeps, not ${a.substeps}`);
    if (a.falsification !== undefined && (a.falsification !== true || a.id !== PROTOCOL.falsification)) throw new Error(`arms: ${a.id}: falsification is pre-registered at ${PROTOCOL.falsification} only`);
    out.push(geometry(a, row));
  }
  const want = Object.entries(PROTOCOL.n).flatMap(([id, ns]) => ns.map((n, i) => (n == null ? null : `${id}-${"PT"[i]}`)).filter(Boolean));
  const missing = want.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`arms: pre-registered arms missing: ${missing.join(", ")}`);
  if (!out.some(g => g.falsification)) throw new Error(`arms: the falsification arm ${PROTOCOL.falsification} is not marked`);
  const notRun = Object.entries(PROTOCOL.n).flatMap(([id, ns]) => ns.map((n, i) => (n == null ? `${id}-${"PT"[i]}` : null)).filter(Boolean));
  if (JSON.stringify((json.notRun ?? []).map(x => x.id)) !== JSON.stringify(notRun)) throw new Error(`arms: notRun must list exactly ${notRun.join(", ")}`);
  return out;
}

// ------------------------------------------------------------ measurement

/** speeds of one run in W0/tau0 (the protocol's statistic) and V d0/D */
export function summarizeRun(trace, lambda, dx) {
  const { last, mid } = windows(trace);
  const west = w => w.map(p => ({ t: p.t, x: p.xWest })), east = w => w.map(p => ({ t: p.t, x: p.xEast }));
  const vLast = -slope(west(last)) * dx, vMid = -slope(west(mid)) * dx;
  const vEastLast = slope(east(last)) * dx;
  const endX = trace.at(-1)?.xWest;
  return {
    vLast, vMid, stationarity: vLast / vMid - 1, vEastLast,
    vd0D: (vLast * K.A1) / (K.A2 * lambda * lambda),
    samples: trace.length, windowSamples: last.map(p => p.k), midSamples: mid.map(p => p.k), endX,
    endGapCells: Number.isFinite(endX) ? endX + 0.5 : null,   // from the inlet face at x = -1/2
  };
}

// ------------------------------------------------------------ orchestration

const b64 = arr => Buffer.from(Float32Array.from(arr).buffer).toString("base64");

/** one run (no flow, flow, or a falsification arm) of one arm, through D3.4's driver */
export async function runOne(ctx, page, g, kind) {
  const s = g.staging, scale = SCALE[kind];
  if (scale === undefined) throw new Error(`runOne: kind ${kind}`);
  const cfg = { lambda: g.lambda, n: g.n, seedX: g.seedX, seedY: g.seedY, dx: s.dx, dt: s.dt, dTilde: s.dTilde, eps4: K.EPS4,
    delta: K.DELTA, uLat: s.uLat, pr: K.PR, seedR: s.seedRCells, flow: scale === null ? null : { scale } };
  const run = { kind, scale, cfg, trace: [], stopped: false, flowLost: false };
  const rows = [];
  const t0 = Date.now();
  try {
    run.setup = await page.evaluate(c => window.__fd.stage(c), cfg);
    let t = 0;
    for (let k = 0; k < K.NS; k++) {
      const a = await page.evaluate(m => window.__fd.advance(m), s.chunk);
      t += s.chunk * s.dt;
      const xWest = westTip(a.row, g.seedX), xEast = eastTip(a.row, g.seedX);
      run.trace.push({ k, t, xWest: Number.isFinite(xWest) ? xWest : null, xEast: Number.isFinite(xEast) ? xEast : null, delivered: a.got, ms: a.ms });
      rows.push(a.row);
      if (scale !== null && !a.flowOn) run.flowLost = true;
      // the stop rule (as D3.4): the west tip within 32 cells of x = 0 ends the run; the arm is invalid
      if (!(xWest > K.STOP_CELLS)) { run.stopped = true; break; }
    }
    run.summary = summarizeRun(run.trace, g.lambda, s.dx);
    const e = await page.evaluate(x => window.__fd.end(x), run.trace.at(-1).xWest);
    if (scale !== null && !e.flowOn) run.flowLost = true;
    run.end = { ...columnMirror(e.column, g.seedY), nonFinite: e.nonFinite, asymPhi: e.asymPhi, asymT: e.asymT, vel: e.vel };
    run.rowsSha256 = createHash("sha256").update(Buffer.from(Float32Array.from(rows.flat()).buffer)).digest("hex");
    if (ctx.rawDir) {
      const bytes = gzipSync(Buffer.from(JSON.stringify({ id: g.id, kind, n: g.n, seedY: g.seedY, chunk: s.chunk, dt: s.dt,
        rowsF32: rows.map(b64), columnF32: b64(e.column), tRowF32: b64(e.tRow) })));
      const path = `${ctx.rawDir}/${g.id}-${kind}.json.gz`;
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

/** one arm in its own page: no flow, flow, then (D2-P only) coupling 0 and coupling -1 */
export async function runArm(ctx, g) {
  const out = { id: g.id, row: g.row, tier: g.tier, D: g.D, lambda: g.lambda, n: g.n, dx: g.staging.dx, seedX: g.seedX, seedY: g.seedY,
    sideW0: g.sideW0, boxD0: g.boxD0, tongBoxD0: g.tongBoxD0, tongVd0D: g.tongVd0D, tongRatio: g.tongRatio,
    informationOnly: g.informationOnly, falsification: g.falsification, chunk: g.chunk, substeps: g.substeps,
    window: { T: g.staging.T, TinLD: g.staging.TinLD, bound: g.staging.bound }, runs: {}, started: new Date().toISOString() };
  const before = ctx.errors.length, t0 = Date.now();
  let page = null;
  try {
    page = await ctx.open(g);
    out.metadata = await page.evaluate(paths => window.__fd.metadata(paths), SERVED);
    out.admission = ctx.admit?.(out.metadata) ?? null;   // throws before any GPU stepping if the page is not the code we hashed
    for (const kind of ["noflow", "flow", ...(g.falsification ? ["zero", "reversed"] : [])]) {
      out.runs[kind] = await runOne(ctx, page, g, kind);
      if (out.runs[kind].error) throw new Error(`${kind}: ${out.runs[kind].error}`);
    }
  } catch (err) {
    out.exception = err?.stack ?? String(err);
  } finally {
    // the grid the app actually ran (n 160 is below D3.4's arm bound: tasks/todo.md, tong2 status)
    out.gridAccepted = { wanted: g.n, staged: out.runs.noflow?.setup?.n ?? null, flowOn: out.runs.flow?.setup?.flowOn ?? null,
      delivered: Object.fromEntries(Object.entries(out.runs).map(([k, r]) => [k, r.trace.reduce((s, p) => s + p.delivered, 0)])) };
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

// ------------------------------------------------------------ admission

/** sha256 of a text as served (raw) and with CRLF -> LF (the comparison) */
export function hashText(text) {
  return { raw: createHash("sha256").update(text).digest("hex"), lf: createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex") };
}

/** the page is admitted only on a hardware adapter with every served file's
 *  LF-normalized hash equal to the disk's (exact, as D3.4 after its amendment) */
export function admission(m, disk, paths = SERVED) {
  const bad = paths.filter(p => !m?.served?.[p]?.lf || m.served[p].lf !== disk?.[p]?.lf);
  const fallback = m?.hardware?.isFallbackAdapter !== false;
  const why = [fallback ? "no hardware adapter" : null, bad.length ? `served source differs: ${bad.join(", ")}` : null].filter(Boolean).join("; ");
  return { ok: !fallback && bad.length === 0, bad, fallback, why: why || null,
    vehicles: Object.fromEntries(paths.map(p => [p, m?.served?.[p]?.via ?? null])) };
}

// ------------------------------------------------------------ validity and verdict

/** completeness of one run (D3.4's V1 clauses, per run); the stop rule is separate */
export function runIssues(run, chunk) {
  if (!run) return ["not run"];
  const out = [];
  if (run.error || run.finishError) out.push("error");
  if (!run.stopped && run.trace.length !== K.NS) out.push(`${run.trace.length} samples`);
  if (!run.trace.every(p => p.delivered === chunk)) out.push("short chunk");
  if (run.scale === null && run.setup?.flowOn !== false) out.push("flow not off");
  if (run.scale !== null && run.setup?.flowCfg?.scale !== run.scale) out.push(`coupling ${run.setup?.flowCfg?.scale} staged, not ${run.scale}`);
  if (run.scale !== null && run.flowLost) out.push("flow switched off during the run");
  if (!run.end || run.end.nonFinite) out.push(run.end ? "non-finite state" : "no end state");
  if (!run.stopped && !Number.isFinite(run.summary?.vLast)) out.push("no speed");
  return out;
}

const live = ux => ux != null && Number.isFinite(ux) && Math.abs(ux - 1) <= RULES.inletTol;
const pct = v => (v == null || !Number.isFinite(v) ? String(v) : `${(100 * v).toFixed(2)} %`);

/** per-arm statistic and validity, in place; returns the arms by id */
export function assess(arms, served) {
  for (const a of arms) {
    const nf = a.runs?.noflow, fl = a.runs?.flow, s = staging(a.lambda, a.dx, a.sideW0);
    a.servedVerified = !!served;
    const pageIssues = [a.exception ? "exception" : null, a.errors?.length ? `${a.errors.length} page/device errors` : null,
      served ? null : "served source not verified"].filter(Boolean);
    const incomplete = [...pageIssues, ...runIssues(nf, a.chunk).map(x => `noflow: ${x}`), ...runIssues(fl, a.chunk).map(x => `flow: ${x}`)];
    a.complete = incomplete.length === 0;
    a.stopRule = [nf, fl].filter(r => r?.stopped).map(r => r.kind);
    a.vNoflow = nf?.summary?.vLast ?? null;
    a.vFlow = fl?.summary?.vLast ?? null;
    a.R = Number.isFinite(a.vNoflow) && Number.isFinite(a.vFlow) && a.vNoflow !== 0 ? a.vFlow / a.vNoflow : null;
    a.vd0DFlow = fl?.summary?.vd0D ?? null;
    a.vd0DNoflow = nf?.summary?.vd0D ?? null;
    a.vRatioTong = Number.isFinite(a.vd0DFlow) ? a.vd0DFlow / a.tongVd0D - 1 : null;
    a.stationarity = { noflow: nf?.summary?.stationarity ?? null, flow: fl?.summary?.stationarity ?? null };
    a.stationary = [a.stationarity.noflow, a.stationarity.flow].every(v => Number.isFinite(v) && Math.abs(v) <= RULES.stationarityMax);
    a.inletUx = fl?.end?.vel?.inletUx ?? null;
    a.inletLive = live(a.inletUx);
    const why = [];
    if (!a.complete) why.push(`incomplete (${incomplete.join("; ")})`);
    if (a.stopRule.length) why.push(`stop rule (${a.stopRule.join(", ")})`);
    if (!a.stationary) why.push(`non-stationary (noflow ${pct(a.stationarity.noflow)}, flow ${pct(a.stationarity.flow)})`);
    if (!a.inletLive) why.push(`inlet not live (${a.inletUx})`);
    a.valid = why.length === 0;
    a.invalidBy = why;
    // reported only
    const gap = fl?.summary?.endGapCells;
    a.endGap = Number.isFinite(gap) ? { cells: gap, d0: gap * s.cellD0, nuOverU: gap / s.nuOverUCells } : null;
    a.V3 = fl?.end ? { mirror: fl.end.mirror, withinD34Tol: fl.end.mirror != null && Math.abs(fl.end.mirror) <= RULES.mirrorTol,
      asymPhiMax: fl.end.asymPhi?.max ?? null, uxMirrorOverU: fl.end.vel?.uxMirrorOverU ?? null } : null;
    a.noflowVsExact = Number.isFinite(a.vd0DNoflow) ? a.vd0DNoflow / K.EXACT_NOFLOW_VD0D - 1 : null;
  }
  return Object.fromEntries(arms.map(a => [a.id, a]));
}

/** the falsification at D2 tier P (protocol + amendment items 1-2): each arm is
 *  scored on the band clause its coupling breaks; it must be a complete run, not
 *  stopped and inlet-live so that it fails on the band and not on a broken run;
 *  its stationarity is reported, not required */
export function falsification(byId) {
  const a = byId[PROTOCOL.falsification];
  if (!a || !a.runs) return { run: false, ok: false, why: `${PROTOCOL.falsification} not run` };
  const nf = a.runs.noflow;
  const pageIssues = [a.exception ? "exception" : null, a.errors?.length ? `${a.errors.length} page/device errors` : null,
    a.servedVerified !== true ? "served source not verified" : null].filter(Boolean);
  const nfIssues = [...runIssues(nf, a.chunk), ...(nf?.stopped ? ["stop rule"] : [])].map(x => `noflow: ${x}`);
  const arm = kind => {
    const run = a.runs[kind];
    const issues = [...pageIssues, ...nfIssues, ...runIssues(run, a.chunk).map(x => `${kind}: ${x}`), ...(run?.stopped ? [`${kind}: stop rule`] : [])];
    const v = run?.summary?.vLast, v0 = nf?.summary?.vLast;
    const R = Number.isFinite(v) && Number.isFinite(v0) && v0 !== 0 ? v / v0 : null;
    const Rmid = Number.isFinite(run?.summary?.vMid) && Number.isFinite(nf?.summary?.vMid) ? run.summary.vMid / nf.summary.vMid : null;
    const inletUx = run?.end?.vel?.inletUx ?? null;
    if (!live(inletUx)) issues.push(`${kind}: inlet not live (${inletUx})`);
    const inBand = R != null && R >= RULES.bandLo && R <= RULES.bandHi;
    return { kind, scale: SCALE[kind], R, Rmid, vd0D: run?.summary?.vd0D ?? null, stationarity: run?.summary?.stationarity ?? null,
      inletUx, bandFails: R != null && !inBand, issues };
  };
  const zero = arm("zero"), reversed = arm("reversed");
  const z = a.runs.zero;
  zero.traceEqual = !!z && !!nf && z.trace.length === nf.trace.length && z.trace.every((p, i) => p.xWest === nf.trace[i].xWest && p.t === nf.trace[i].t);
  zero.rowsEqual = !!z?.rowsSha256 && z.rowsSha256 === nf?.rowsSha256;   // reported: the raw centre rows, bit for bit
  zero.ok = zero.issues.length === 0 && zero.traceEqual && zero.R === 1 && zero.bandFails;
  reversed.ok = reversed.issues.length === 0 && reversed.R != null && reversed.R < 1 && reversed.bandFails;
  return { run: true, zero, reversed, ok: zero.ok && reversed.ok };
}

/** the per-tier verdict over its valid non-information rows */
export function tierVerdict(tier, arms, fals) {
  const mine = arms.filter(a => a.tier === tier);
  const scored = mine.filter(a => !a.informationOnly), info = mine.filter(a => a.informationOnly);
  const valid = scored.filter(a => a.valid && Number.isFinite(a.R) && Number.isFinite(a.vRatioTong));
  const brief = a => ({ id: a.id, valid: !!a.valid, invalidBy: a.invalidBy ?? ["not run"], R: a.R ?? null, vd0DFlow: a.vd0DFlow ?? null,
    vRatioTong: a.vRatioTong ?? null, stationarity: a.stationarity ?? null, inletUx: a.inletUx ?? null });
  const ti = ["P", "T"].indexOf(tier);
  const notRun = Object.keys(PROTOCOL.rows).filter(id => PROTOCOL.n[id][ti] != null && !mine.some(a => a.row === id)).map(id => `${id}-${tier}`);
  const out = { tier, dx: K.TIERS[tier], rows: scored.map(brief), information: info.map(brief), validRows: valid.map(a => a.id), notRun };
  if (valid.length < RULES.minValidRows) {
    out.clauses = null;
    out.rowVerdict = "NO VERDICT";
    out.why = `${valid.length} valid row(s); a verdict needs ${RULES.minValidRows}`;
  } else {
    const Rs = valid.map(a => a.R), mean = Rs.reduce((x, y) => x + y, 0) / Rs.length;
    const spread = (Math.max(...Rs) - Math.min(...Rs)) / mean;
    const bandMiss = valid.filter(a => !(a.R >= RULES.bandLo && a.R <= RULES.bandHi)).map(a => a.id);
    const vMiss = valid.filter(a => !(Math.abs(a.vRatioTong) <= RULES.vRatioMax)).map(a => a.id);
    out.clauses = { band: { ok: bandMiss.length === 0, miss: bandMiss }, spread: { ok: spread < RULES.spreadMax, spread, mean },
      vRatio: { ok: vMiss.length === 0, miss: vMiss } };
    out.failed = Object.entries(out.clauses).filter(([, c]) => !c.ok).map(([k]) => k);
    out.rowVerdict = out.failed.length ? "FAIL" : "PASS";
  }
  if (!fals?.ok) {
    out.verdict = "NO VERDICT";
    out.why = `falsification not demonstrated${out.why ? `; ${out.why}` : ""} (row clauses: ${out.rowVerdict})`;
  } else out.verdict = out.rowVerdict;
  return out;
}

/** the pre-registered verdicts (tasks/todo.md, Next Tong comparison, as amended before any run) */
export function decide(byId) {
  const arms = Object.values(byId);
  const fals = falsification(byId);
  const P = tierVerdict("P", arms, fals), T = tierVerdict("T", arms, fals);
  const resolution = Object.keys(PROTOCOL.rows).filter(id => byId[`${id}-P`] && byId[`${id}-T`]).map(id => {
    const p = byId[`${id}-P`], t = byId[`${id}-T`];
    return { row: id, RP: p.R ?? null, RT: t.R ?? null, step: Number.isFinite(p.R) && Number.isFinite(t.R) ? t.R - p.R : null, validP: !!p.valid, validT: !!t.valid };
  });
  return { falsification: fals, P, T, appMayCallQuantitative: P.verdict === "PASS", resolution };
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

/** refuse before Chrome: the hashed files committed and unmodified, src/ clean and
 *  byte-identical to the head that passed the D3.5 GPU gates */
export function preconditions() {
  const dirty = sh("git", ["status", "--porcelain", "--", ...HASHED, "src"]);
  let srcAsD35 = true;
  try { sh("git", ["diff", "--quiet", D35_PASSED_COMMIT, "HEAD", "--", "src"]); } catch { srcAsD35 = false; }
  return { dirty, srcAsD35, d35PassedCommit: D35_PASSED_COMMIT, ok: dirty === "" && srcAsD35 };
}

function printPlan(geos) {
  console.log("arm        tier    n  box_d0  T/l_D bound   chunk substeps  gap0  gap@1.5V  est_s(flow+noflow+fals)");
  const tot = { P: { flow: 0, noflow: 0 }, T: { flow: 0, noflow: 0 }, falsification: 0 };
  for (const g of geos) {
    const s = g.staging, c = g.costS;
    tot[g.tier].flow += c.flow; tot[g.tier].noflow += c.noflow; tot.falsification += c.falsification;
    console.log(`${g.id.padEnd(10)} ${g.tier.padStart(4)} ${String(g.n).padStart(4)} ${g.boxD0.toFixed(0).padStart(7)} ${s.TinLD.toFixed(1).padStart(6)} ${s.bound.padStart(6)} ${String(g.chunk).padStart(6)} ${String(g.substeps).padStart(8)} ${g.initialGapCells.toFixed(0).padStart(5)} ${g.predictedEndGapCells.toFixed(1).padStart(9)}  ${(c.flow + c.noflow + c.falsification).toFixed(0)}${g.informationOnly ? "  (information only)" : ""}${g.falsification ? "  (+ coupling 0, -1)" : ""}`);
  }
  const all = tot.P.flow + tot.P.noflow + tot.T.flow + tot.T.noflow + tot.falsification;
  console.log(`stepping: tier P ${tot.P.flow.toFixed(0)} s flow + ${tot.P.noflow.toFixed(0)} s no flow; tier T ${tot.T.flow.toFixed(0)} s + ${tot.T.noflow.toFixed(0)} s; falsification ${tot.falsification.toFixed(0)} s; total ${(all / 60).toFixed(1)} min (protocol: ~6.5 min, plan <= 20 min with setup)`);
  console.log("not run: D4-3315-T (n 1152 > 1024)");
  return { ...tot, totalS: all };
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
    const { selfTest } = await import("./flow-tong2-selftest.mjs");
    return (await selfTest()) ? 0 : 1;
  }
  const armsJson = JSON.parse(readFileSync(ARMS_PATH, "utf8"));
  const geosAll = parseArms(armsJson);
  const pick = opt("--arms")?.split(",").filter(Boolean);
  if (pick) for (const id of pick) if (!geosAll.some(g => g.id === id)) throw new Error(`--arms: unknown ${id}`);
  const geos = pick ? geosAll.filter(g => pick.includes(g.id)) : geosAll;
  const port = opt("--port") ?? "5297";
  if (!/^\d+$/.test(port)) throw new Error("--port must be a number");
  const pre = preconditions();
  if (!pre.ok) {
    console.log("FLOW-TONG2 REFUSED", JSON.stringify(pre));
    return 1;
  }

  const date = new Date().toISOString().slice(0, 10);
  const rawDir = resolve(REPO, `verify-out/flow-tong2-${date}`);
  mkdirSync(rawDir, { recursive: true });
  const resultPath = resolve(REPO, `docs/validation/flow-tong2-${date}${pick ? "-partial" : ""}.json`);
  const disk = sourceHashes();
  const result = {
    study: "Next Tong comparison (tong2; research; FLOW-TIP-TONG stays FAILED and is not re-scored)",
    protocol: "tasks/todo.md, Next Tong comparison - PROTOCOL ONLY (pre-registered 2026-11-07), amended before any run", protocolCommit: PROTOCOL_COMMIT,
    commit: sh("git", ["rev-parse", "HEAD"]), preconditions: pre,
    committedBlobs: Object.fromEntries(HASHED.map(p => { try { return [p, sh("git", ["rev-parse", `HEAD:${p}`])]; } catch { return [p, null]; } })),
    date, started: new Date().toISOString(), argv: args, port, selected: geos.map(g => g.id), notRun: armsJson.notRun,
    constants: K, rules: RULES, protocolTable: PROTOCOL,
    staging: Object.fromEntries(geosAll.map(g => [g.id, g.staging])), sourceHashes: disk, arms: [], errors: [], completed: false,
  };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 1) + "\n");
  save();
  const { default: puppeteer } = await import("puppeteer-core");
  const { closeBrowser } = await import("../browser-cleanup.mjs");
  const extra = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
  if (!Array.isArray(extra) || extra.some(a => typeof a !== "string")) throw new Error("CHROME_ARGS must be a JSON string array");
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
      return page;
    },
    admit(m) {
      const a = admission(m, disk);
      if (!a.ok) { servedOk = false; throw new Error(`not admitted: ${a.why}`); }
      return a;
    },
  };
  try {
    for (const g of geos) {
      const row = await runArm(ctx, g);
      result.arms.push(row);
      const v = r => (r?.summary ? r.summary.vd0D.toFixed(5) : "-");
      const R = k => (row.runs[k]?.summary && row.runs.noflow?.summary ? +(row.runs[k].summary.vLast / row.runs.noflow.summary.vLast).toFixed(4) : null);
      console.log("T2-ARM", g.id, JSON.stringify({ R: R("flow"), ...(g.falsification ? { Rzero: R("zero"), Rreversed: R("reversed") } : {}),
        vd0D: [v(row.runs.noflow), v(row.runs.flow)], stationarity: [row.runs.noflow?.summary?.stationarity, row.runs.flow?.summary?.stationarity].map(x => (x == null ? null : +x.toFixed(4))),
        inletUx: row.runs.flow?.end?.vel?.inletUx ?? null, wallS: Math.round(row.wallMs / 1000), exception: row.exception ? row.exception.split("\n")[0] : undefined }));
      save();
      if (!servedOk) { result.abort = "served source differs from the worktree, or a software adapter: stopping"; break; }
    }
  } catch (err) {
    result.exception = err?.stack ?? String(err);
  } finally {
    await closeBrowser(browser);
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
  console.log("T2-VERDICT", JSON.stringify({ P: d.P.verdict, T: d.T.verdict, appMayCallQuantitative: d.appMayCallQuantitative,
    falsification: { ok: d.falsification.ok, zeroR: d.falsification.zero?.R ?? null, reversedR: d.falsification.reversed?.R ?? null },
    failedP: d.P.failed ?? null, failedT: d.T.failed ?? null, whyP: d.P.why ?? null, whyT: d.T.why ?? null }));
  console.log("FLOW-TONG2", result.completed ? "RECORDED" : "FAILED", JSON.stringify({ result: resultPath, completed: result.completed,
    sourceStable: result.sourceStable, servedVerified: servedOk, errors: result.errors.length, exception: result.exception?.split("\n")[0], abort: result.abort }));
  return result.completed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, err => { console.error(err?.stack ?? err); process.exitCode = 1; });
}
