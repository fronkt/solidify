// Browser-free self-test for scripts/research/flow-noflow-dx.mjs (Tong follow-up
// (iv)). Never launches Chrome, never starts a dev server, never touches a GPU.
// Checks: the protocol and its amendment at the pinned commits; that
// flow-noflow-d2.mjs and everything (ii) froze are git-blob identical to (ii)'s GPU
// head (and that a planted edit is caught); the constants; the arm file and its
// refusals (chunk 2683 refused by the sample-time assert); the staging (R1024 is
// (ii)'s N1024; H2048's chunk 2684 sits in the staging object runNoflow reads);
// statistic L on synthetic traces and its 0.02 edge; every decision region, its
// edges and the first-match order; the replica against (ii)'s recorded JSON (pass,
// and fail on a planted 2e-6 shift); NO DECISION and NOT TESTED worlds; (ii)'s
// runArm against a mock app for both arms (2684 advanced per chunk, sample times
// equal); admission refusal; the real Simulation (src/sim.ts through Vite's module
// runner in middleware mode: no port, no websocket) at both arms' staging on a
// recording device; and planted defects: mutated copies of the script, imported
// from data: URLs, must each turn at least one check red while the unmutated copy
// passes every one.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as T2 from "./flow-tong2.mjs";
import * as T3 from "./flow-tong3.mjs";
import * as D2 from "./flow-noflow-d2.mjs";
import { HELPER_SRC, installDriver } from "./flow-domain.mjs";
import * as REAL from "./flow-noflow-dx.mjs";

const K = T2.K, REPO = T2.REPO;
const SCRIPT_URL = new URL("./flow-noflow-dx.mjs", import.meta.url);
const ARMS = JSON.parse(readFileSync(new URL("./flow-noflow-dx-arms.json", import.meta.url), "utf8"));
const II_TEXT = readFileSync(new URL("../../docs/validation/flow-noflow-d2-2026-11-08.json", import.meta.url), "utf8");
const II = JSON.parse(II_TEXT);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20, cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
const norm = s => s.replace(/\s+/g, " ");
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

/** the self-test's own expectations, written independently of the module under test */
const II_RUN = "14242e4dab18eeb6e97463ddc5fac514f473775e";
const EXPECT = Object.freeze({
  protocolCommit: "82931ec43ddb9f38d569f8850b5946de1ee8ac67",
  header: "### Tong follow-up (iv): no-flow tip resolution at D2 - PROTOCOL (pre-registered 2026-11-15; not built, not run)",
  amendmentHeader: "#### Amendment before any run (2026-11-15, follow-up iv)",
  iiRun: II_RUN, iiResult: "docs/validation/flow-noflow-d2-2026-11-08.json", iiResultCommit: "22f3c7d0f017e5bdb4487363edf2734aa692e22a",
  frozen: [
    ["scripts/research/flow-noflow-d2.mjs", II_RUN], ["scripts/research/flow-noflow-d2-selftest.mjs", II_RUN], ["scripts/research/flow-noflow-d2-arms.json", II_RUN],
    ["scripts/research/flow-domain.mjs", II_RUN], ["scripts/research/flow-tong2.mjs", II_RUN], ["scripts/research/flow-tong2-selftest.mjs", II_RUN],
    ["scripts/research/flow-tong2-arms.json", II_RUN], ["scripts/research/flow-tong3.mjs", II_RUN], ["scripts/research/flow-tong3-selftest.mjs", II_RUN],
    ["scripts/research/flow-tong3-arms.json", II_RUN], ["docs/validation/flow-tong3-2026-11-08.json", II_RUN], ["scripts/browser-cleanup.mjs", II_RUN],
    ["docs/validation/flow-noflow-d2-2026-11-08.json", "22f3c7d0f017e5bdb4487363edf2734aa692e22a"],
  ],
  /** what (ii)'s own self-test froze besides its FROZEN map (its frozen() groups) */
  iiSelftestGroups: ["scripts/research/flow-tong2-selftest.mjs", "scripts/research/flow-tong2-arms.json", "scripts/research/flow-tong3-selftest.mjs",
    "scripts/research/flow-tong3-arms.json", "docs/validation/flow-tong3-2026-11-08.json"],
  rules: { replicaRel: 1e-6, replicaPoints: 0.0001, settledMax: 0.02, sampleTimeAssert: 1e-12, sampleTimeRel: 1e-9, overshoot: 0.03, resolution: 0.03, notResolution: 0.02, partly: 0.02 },
  arms: [
    { id: "R1024", n: 1024, dx: 0.8, seedX: 512, seedY: 512, chunk: 671, substeps: 54351, replica: true },
    { id: "H2048", n: 2048, dx: 0.4, seedX: 1024, seedY: 1024, chunk: 2684, substeps: 217404 },
  ],
  /** dt = 0.15 dx^2 / D~ with D~ = 0.6267 x 3.19 (> 1): (ii)'s recorded dt at dx 0.8, and a quarter of it */
  dt08: 0.04801985621054306, dt04: 0.04801985621054306 / 4, lD: 16.29909644108427,
});

function runner(quiet) {
  const failed = [];
  const check = (name, ok, detail) => { if (!ok) failed.push(name); if (!quiet) console.log(`NDX-SELFTEST-${name}`, ok ? "OK" : "FAIL", JSON.stringify(detail ?? {})); };
  return { check, failed };
}
const guard = async (check, name, fn) => { try { await fn(); } catch (e) { check(name, false, { threw: String(e?.stack ?? e).split("\n").slice(0, 2).join(" | ") }); } };
const section = (text, header) => { const i = text.indexOf(header); if (i < 0) return null; const j = text.indexOf("\n## ", i); return text.slice(i, j < 0 ? undefined : j); };

// ---- git: the protocol, the amendment, the freeze --------------------------------

function protocol(M, check) {
  let ok = true, detail = {};
  try {
    git(["cat-file", "-e", `${M.PROTOCOL_COMMIT}^{commit}`]);
    git(["cat-file", "-e", `${M.AMENDMENT_COMMIT}^{commit}`]);
    git(["merge-base", "--is-ancestor", M.PROTOCOL_COMMIT, M.AMENDMENT_COMMIT]);
    git(["merge-base", "--is-ancestor", M.AMENDMENT_COMMIT, "HEAD"]);
    const original = section(git(["show", `${M.PROTOCOL_COMMIT}:tasks/todo.md`]).replace(/\r\n/g, "\n"), M.PROTOCOL_HEADER);
    const amended = section(git(["show", `${M.AMENDMENT_COMMIT}:tasks/todo.md`]).replace(/\r\n/g, "\n"), M.PROTOCOL_HEADER);
    const sec = norm(original ?? "");
    const quoted = [
      "R1024 (replica): n 1024, dx 0.8 W0, seed (512, 512), 81 chunks of 671 (54351 substeps).",
      "H2048: n 2048, dx 0.4 W0, seed (1024, 1024).", "The box is 819.2 W0, the same physical box as R1024.",
      "dt = 0.15 dx^2 / D~, a quarter of R1024's.", "The chunk is 2684 = 4 x 671, so every sample lands at R1024's sample time.",
      "|2684 dt(0.4) / (671 dt(0.8)) - 1| < 1e-12", "81 chunks = 217404 substeps.", "The seed is r 8 W0 = 20 cells.",
      "s_m and V d0/D for m in {33, 45, 57, 69, 81}, label STEADY if |s_81| <= 0.02, else DRIFTING.",
      "over k = 54..80 (27 values)", "drift_L = 26 b / V_L, the fractional change across the window.",
      "The arm is SETTLED if |drift_L| <= 0.02, else MOVING.",
      "every prefix window's V d0/D within 1e-6 relative of (ii)'s recorded N1024 values, and every s_m within 0.01 points.",
      "every sample time within 1e-9 relative of R1024's.", "d = V_L(H2048) / V_L(R1024) - 1", "e = V_L(H2048) / 0.0170 - 1",
      "OVERSHOOT if e > +0.03", "RESOLUTION if |e| <= 0.03", "NOT RESOLUTION if |d| < 0.02", "PARTLY RESOLUTION if d >= +0.02",
      "OTHER otherwise", "V_inf = V_0.4 + (V_0.4 - V_0.8) / (2^p - 1)", "0.021946 / V_L(R1024)", "Prediction: PARTLY RESOLUTION.",
    ];
    detail = { header: original != null, amendment: !!amended && amended.includes(M.AMENDMENT_HEADER),
      originalKeptVerbatim: !!original && !!amended && amended.startsWith(original.trimEnd()),
      missingQuotes: quoted.filter(q => !sec.includes(q)), armsCommit: ARMS.protocolCommit === M.PROTOCOL_COMMIT };
    ok = detail.header && detail.amendment && detail.originalKeptVerbatim && detail.missingQuotes.length === 0 && detail.armsCommit;
  } catch (e) { ok = false; detail.error = String(e.message).split("\n")[0]; }
  check("PROTOCOL", ok, { commit: M.PROTOCOL_COMMIT.slice(0, 7), amendment: M.AMENDMENT_COMMIT.slice(0, 7), ...detail });
}

/** the freeze: every file equals its freezing commit's blob; a planted edit is caught */
function frozen(M, check) {
  const real = M.frozenCheck();
  const plant = target => p => (p === target ? Buffer.concat([readFileSync(resolve(REPO, p)), Buffer.from("\n// planted\n")]) : null);
  const same = M.frozenCheck(p => (p === "scripts/research/flow-tong3.mjs" ? readFileSync(resolve(REPO, p)) : null));   // the same bytes through stdin
  const t3 = M.frozenCheck(plant("scripts/research/flow-tong3.mjs")), d2 = M.frozenCheck(plant("scripts/research/flow-noflow-d2.mjs"));
  const ii = M.frozenCheck(plant(EXPECT.iiResult));
  let srcAsD35 = true;
  try { git(["diff", "--quiet", M.D35_PASSED_COMMIT, "HEAD", "--", "src"]); } catch { srcAsD35 = false; }
  const ok = real.ok && Object.keys(real.files).length === EXPECT.frozen.length && same.ok
    && Object.entries(real.files).every(([p, f]) => f.commit === Object.fromEntries(EXPECT.frozen)[p].slice(0, 7) && /^[0-9a-f]{40}$/.test(f.want))
    && JSON.stringify(t3.bad) === '["scripts/research/flow-tong3.mjs"]' && JSON.stringify(d2.bad) === '["scripts/research/flow-noflow-d2.mjs"]'
    && JSON.stringify(ii.bad) === JSON.stringify([EXPECT.iiResult]) && !t3.ok && !d2.ok && !ii.ok;
  check("FROZEN", ok, { files: Object.keys(real.files).length, bad: real.bad, plantedCaught: [t3.bad, d2.bad, ii.bad], srcAsD35PassedHead: srcAsD35 });
}

// ---- module checks (run on the script and on every planted copy) ------------------

function constants(M, check) {
  const P = M.PROTOCOL;
  const frozenMap = JSON.stringify(Object.entries(M.FROZEN)) === JSON.stringify(EXPECT.frozen) && Object.isFrozen(M.FROZEN);
  const coversIi = Object.keys(D2.FROZEN).every(p => p in M.FROZEN) && D2.TONG3_RESULT in M.FROZEN && EXPECT.iiSelftestGroups.every(p => p in M.FROZEN)
    && ["scripts/research/flow-noflow-d2.mjs", "scripts/research/flow-noflow-d2-selftest.mjs", "scripts/research/flow-noflow-d2-arms.json"].every(p => M.FROZEN[p] === EXPECT.iiRun);
  const rules = JSON.stringify(M.RULES) === JSON.stringify(EXPECT.rules) && Object.isFrozen(M.RULES);
  const proto = Object.isFrozen(P) && Object.isFrozen(P.arms[1]) && P.lambda === 3.19 && P.sideW0 === 819.2 && P.chunks === 81
    && JSON.stringify(P.windows) === "[33,45,57,69,81]" && JSON.stringify(P.arms) === JSON.stringify(EXPECT.arms) && JSON.stringify(P.lateWindow) === "[54,80]"
    && P.exactNoflowVd0D === 0.017 && P.tongNoflowVd0D === 0.018 && P.flowVd0D === 0.021946 && P.chunkFactor === 4 && P.tong3ChunkH === 2683
    && P.prediction === "PARTLY RESOLUTION" && /stand as recorded/.test(P.earlier);
  const commits = M.PROTOCOL_COMMIT === EXPECT.protocolCommit && M.II_RUN_COMMIT === EXPECT.iiRun && M.II_RESULT === EXPECT.iiResult
    && M.II_RESULT_COMMIT === EXPECT.iiResultCommit && M.PROTOCOL_HEADER === EXPECT.header && M.AMENDMENT_HEADER === EXPECT.amendmentHeader
    && /^[0-9a-f]{40}$/.test(M.AMENDMENT_COMMIT) && M.D35_PASSED_COMMIT === D2.D35_PASSED_COMMIT;
  const hashed = [...EXPECT.frozen.map(([p]) => p), ...D2.SERVED, "scripts/research/flow-noflow-dx.mjs", "scripts/research/flow-noflow-dx-selftest.mjs",
    "scripts/research/flow-noflow-dx-arms.json"].every(p => M.HASHED.includes(p));
  // the sizing figure is (ii)'s own last west tip
  const sizing = P.sizing.iiEndXWest === II.arms[0].runs.noflow.trace.at(-1).xWest && P.sizing.fasterBy === 0.06;
  check("CONSTANTS", frozenMap && coversIi && rules && proto && commits && hashed && sizing, { frozenMap, coversIi, rules, proto, commits, hashed, sizing });
}

function parsing(M, check) {
  let geos = null, parseError = null;
  try { geos = M.parseArms(ARMS); } catch (e) { parseError = String(e.message); }
  const mutate = f => { const j = JSON.parse(JSON.stringify(ARMS)); f(j); return () => M.parseArms(j); };
  const hostile = {
    wrongProtocol: throwsWith(mutate(j => { j.protocolCommit = D2.PROTOCOL_COMMIT; }), /protocolCommit/),
    reordered: throwsWith(mutate(j => { j.arms.reverse(); }), /order/),
    extra: throwsWith(mutate(j => { j.arms.push({ ...j.arms[1], id: "H4096", n: 4096, dx: 0.2, seedX: 2048, seedY: 2048 }); }), /exactly/),
    missing: throwsWith(mutate(j => { j.arms.pop(); }), /exactly/),
    unknownKey: throwsWith(mutate(j => { j.arms[1].flow = true; }), /unknown key/),
    dxSwapped: throwsWith(mutate(j => { j.arms[1].dx = 0.8; }), /dx 0.8 is not the pre-registered 0.4/),
    nChanged: throwsWith(mutate(j => { j.arms[1].n = 1024; j.arms[1].seedX = 512; j.arms[1].seedY = 512; }), /pre-registered/),
    offCentre: throwsWith(mutate(j => { j.arms[1].seedX = 1000; }), /pre-registered/),
    replicaMoved: throwsWith(mutate(j => { delete j.arms[0].replica; j.arms[1].replica = true; }), /replica/),
    // tong3's rounding at dx 0.4, and one more: refused by the sample-time assert itself
    chunk2683: throwsWith(mutate(j => { j.arms[1].chunk = 2683; j.arms[1].substeps = 2683 * 81; }), /sample time/),
    chunk2685: throwsWith(mutate(j => { j.arms[1].chunk = 2685; j.arms[1].substeps = 2685 * 81; }), /sample time/),
    // both chunks scaled together keep the sample times aligned but are not the protocol's
    bothScaled: throwsWith(mutate(j => { j.arms[0].chunk = 670; j.arms[0].substeps = 670 * 81; j.arms[1].chunk = 2680; j.arms[1].substeps = 2680 * 81; }), /R1024: chunk 670 is not \(ii\)'s/),
    chunks80: throwsWith(mutate(j => { j.arms[1].chunks = 80; j.arms[1].substeps = 2684 * 80; }), /81 whole chunks/),
    substepsOff: throwsWith(mutate(j => { j.arms[1].substeps = 217403; }), /81 whole chunks/),
    notObject: throwsWith(() => M.parseArms([]), /not an object/),
  };
  check("PARSE", parseError === null && geos?.map(g => g.id).join() === "R1024,H2048" && Object.values(hostile).every(Boolean),
    { parseError, refused: Object.entries(hostile).filter(([, v]) => !v).map(([k]) => `NOT ${k}`) });
  return geos ?? EXPECT.arms.map(a => M.geometry(a));
}

/** R1024 is (ii)'s N1024 to the last staging double; H2048 is tong3's staging at dx 0.4
 *  with chunk 2684 inside the staging object, and its 81 sample times are R1024's */
function staging(M, check, geos) {
  const [gR, gH] = geos, n1024 = D2.geometry(D2.PROTOCOL.arms[0]);
  const s4 = T3.staging(3.19, 0.4, 819.2);
  const T81 = 54351 * EXPECT.dt08;
  const r = {
    rIsN1024: JSON.stringify(gR.staging) === JSON.stringify(n1024.staging) && gR.chunk === n1024.chunk && gR.substeps === n1024.substeps
      && gR.chunks === n1024.chunks && JSON.stringify(gR.probeCells) === JSON.stringify(n1024.probeCells) && gR.seedX === 512 && gR.seedY === 512,
    dParamsOff: gR.replica === false && gH.replica === false && gR.replicaIi === true && gH.replicaIi === false,
    hChunkInStaging: gH.staging.chunk === 2684 && gH.chunk === 2684 && gH.substeps === 217404 && gH.chunks === 81 && gH.staging.tong3Chunk === 2683 && s4.chunk === 2683,
    hStaging: gH.staging.dx === 0.4 && gH.staging.dt === EXPECT.dt04 && gR.staging.dt === EXPECT.dt08 && gH.staging.seedRCells === 20 && gR.staging.seedRCells === 10
      && gH.staging.dTilde === s4.dTilde && gH.staging.lD === EXPECT.lD && gH.staging.uLat === s4.uLat,
    probeCells: gH.probeCells.every((x, i) => rel(x, ([2, 4, 8][i] * EXPECT.lD) / 0.4) < 1e-12) && gR.probeCells.every((x, i) => rel(x, ([2, 4, 8][i] * EXPECT.lD) / 0.8) < 1e-12),
    sameBox: gR.sideW0 === 819.2 && gH.sideW0 === 819.2 && rel(gH.boxD0, gR.boxD0) < 1e-12 && Math.round(gR.boxD0) === 2956,
    sameTime: rel(gR.tRun, T81) < 1e-14 && rel(gH.tRun, T81) < 1e-14 && Math.round(gH.tRunInLD * 10) / 10 === 19.6,
    sampleTimes: gH.sampleTimes.length === 81 && gH.sampleTimes.every((t, k) => Math.abs(t / gR.sampleTimes[k] - 1) <= 1e-9)
      && gR.sampleTimes.every((t, k) => t === II.arms[0].runs.noflow.trace[k].t),
    assert: M.sampleTimeAssert(gR, gH) < 1e-12 && throwsWith(() => M.sampleTimeAssert(gR, M.geometry({ ...EXPECT.arms[1], chunk: 2683 })), /sample time/)
      && throwsWith(() => M.sampleTimeAssert(gR, M.geometry({ ...EXPECT.arms[1], chunk: 2685 })), /sample time/),
    tong3Gap: Math.abs((2683 * EXPECT.dt04) / (671 * EXPECT.dt08) - 1) > 1e-4,
  };
  check("STAGING", Object.values(r).every(Boolean), { failed: Object.entries(r).filter(([, v]) => !v).map(([k]) => k), assert: M.sampleTimeAssert(gR, gH),
    hProbeCells: gH.probeCells, predictedEndGapCells: geos.map(g => +g.predictedEndGapCells.toFixed(0)) });
}

// ---- synthetic runs and worlds -----------------------------------------------------

const toV = vd0D => (vd0D * K.A2 * 3.19 * 3.19) / K.A1;   // V d0/D -> W0 per tau0

function runOf(g, trace, { stopped = false, flowOn = false } = {}) {
  return { kind: "noflow", scale: null, trace, stopped, flowLost: false, flowOnDuring: flowOn, finished: true, probe: [],
    setup: { n: g.n, flowOn: false, flowCfg: { u: 0.02, pr: 23.1, scale: 1 } },
    summary: T2.summarizeRun(trace, g.lambda, g.staging.dx), end: { yN: null, yS: null, mirror: 0, nonFinite: 0, asymPhi: { max: 0 }, asymT: { max: 0 }, vel: null } };
}

/** a no-flow run whose west tip moves at speed(k) (V d0/D) over the chunk ending at sample k */
function synthRun(g, speed, { stopAt = null, flowOn = false, times = g.sampleTimes } = {}) {
  const dx = g.staging.dx;
  let x = g.seedX - g.staging.seedRCells - 20 / dx;
  const trace = [];
  for (let k = 0; k < 81; k++) {
    if (k > 0) x -= (toV(speed(k)) * (times[k] - times[k - 1])) / dx;
    trace.push({ k, t: times[k], xWest: x, xEast: 2 * g.seedX - x, delivered: g.chunk, ms: 1 });
  }
  if (stopAt != null) { trace.length = stopAt + 1; trace[stopAt].xWest = K.STOP_CELLS - 4; }
  return runOf(g, trace, { stopped: stopAt != null, flowOn });
}

/** (ii)'s recorded N1024 trace as R1024's run, its displacements optionally scaled */
function iiRun(g, ref, scale = 1) {
  const tr = ref.trace.map(p => ({ ...p })), x0 = tr[0].xWest;
  if (scale !== 1) for (const p of tr) p.xWest = x0 + (p.xWest - x0) * scale;
  return runOf(g, tr);
}

const armRow = (g, run, staged) => ({ id: g.id, n: g.n, seedX: g.seedX, seedY: g.seedY, lambda: g.lambda, dx: g.staging.dx, sideW0: g.sideW0, boxD0: g.boxD0,
  chunk: g.chunk, chunks: g.chunks, substeps: g.substeps, replica: g.replica, replicaIi: g.replicaIi, runs: run ? { noflow: run } : {}, errors: [], wallMs: 0,
  gridAccepted: { wanted: g.n, staged: staged !== undefined ? staged : run ? g.n : null, flowOn: run ? false : null, delivered: run ? run.trace.reduce((s, p) => s + p.delivered, 0) : 0 } });

/** a reference made from a run's own windows (to test paths where R1024 is valid but not (ii)'s trace) */
function refOf(g, run) {
  const ws = D2.prefixes(run.trace, g.lambda, g.staging.dx);
  return { path: "synthetic", vd0D: Object.fromEntries(ws.map(w => [w.m, w.vd0D])), s: Object.fromEntries(ws.map(w => [w.m, w.s])),
    series: D2.perChunk(run.trace, g.lambda, g.staging.dx).series };
}

function world(M, geos, ref, { R, H, served = true, rowR = null, rowH = null }) {
  const [gR, gH] = geos;
  const rows = [rowR ?? (R === "skip" ? null : armRow(gR, R)), rowH ?? (H === "skip" ? null : armRow(gH, H))].filter(Boolean);
  const byId = M.assess(rows, served, ref);
  return { byId, d: M.decide(byId) };
}

/** statistic L on synthetic series, its edge, its window, and on (ii)'s recorded N1024 */
function late(M, check, ref) {
  const S = f => Array.from({ length: 80 }, (_, i) => ({ k: i + 1, vd0D: f(i + 1) }));
  const lin = c => S(k => 0.016 * (1 + (c * (k - 67)) / 26));   // mean 0.016 over 54..80, drift_L = c exactly in exact arithmetic
  const flat = M.lateWindow(S(() => 0.016), 3.19), moving = M.lateWindow(S(k => 0.016 - 2e-5 * (k - 54)), 3.19);
  const L = c => M.lateWindow(lin(c), 3.19);
  const garbage = M.lateWindow([...S(k => (k < 54 ? 9 : 0.016)), { k: 81, vd0D: 9 }], 3.19);
  const hole = M.lateWindow(S(() => 0.016).filter(p => p.k !== 60), 3.19), nul = M.lateWindow(S(k => (k === 70 ? null : 0.016)), 3.19);
  const ii = M.lateWindow(ref.series, 3.19), iiVals = II.arms[0].perChunk.series.filter(p => p.k >= 54 && p.k <= 80).map(p => p.vd0D);
  const r = {
    flat: flat.available && flat.values === 27 && rel(flat.VL, 0.016) < 1e-14 && Math.abs(flat.b) < 1e-15 && Math.abs(flat.driftL) < 1e-12 && flat.label === "SETTLED"
      && rel(flat.tauVW, T3.tauVW(0.016, 3.19)) < 1e-15 && JSON.stringify(flat.window) === "[54,80]",
    moving: rel(moving.b, -2e-5) < 1e-9 && rel(moving.VL, 0.016 - 2e-5 * 13) < 1e-12 && rel(moving.driftL, (-26 * 2e-5) / (0.016 - 2e-5 * 13)) < 1e-9 && moving.label === "MOVING",
    edge: L(0.0199).label === "SETTLED" && L(-0.0199).label === "SETTLED" && L(0.0201).label === "MOVING" && L(-0.0201).label === "MOVING"
      && rel(L(0.0199).driftL, 0.0199) < 1e-9 && rel(L(-0.0201).driftL, -0.0201) < 1e-9,
    pureEdge: M.settled(0.02) === "SETTLED" && M.settled(-0.02) === "SETTLED" && M.settled(0.02 + 1e-12) === "MOVING" && M.settled(-0.02 - 1e-12) === "MOVING"
      && M.settled(NaN) === null && M.settled(null) === null,
    window: garbage.available && garbage.VL === flat.VL && garbage.label === "SETTLED" && !hole.available && hole.label === null && !nul.available,
    // (ii)'s N1024: the protocol's 0.015519 and -1.28 %, and b is (ii)'s own recorded drift per chunk
    ii: ii.available && ii.VL === mean(iiVals) && Math.round(ii.VL * 1e6) === 15519 && Math.round(ii.driftL * 1e4) === -128 && ii.label === "SETTLED"
      && ii.b === II.arms[0].perChunk.driftPerChunk,
  };
  check("LATE", Object.values(r).every(Boolean), { failed: Object.entries(r).filter(([, v]) => !v).map(([k]) => k), ii: { VL: ii.VL, b: ii.b, driftL: ii.driftL },
    edge: [L(0.0199).driftL, L(0.0201).driftL], moving: moving.driftL });
}

/** every region, its edges, and the first-match order */
function regions(M, check) {
  const c = M.classify;
  const r = {
    overshoot: c(0.05, 0.031) === "OVERSHOOT" && c(0, 0.0300001) === "OVERSHOOT",
    resolution: c(0, 0.03) === "RESOLUTION" && c(0, -0.03) === "RESOLUTION" && c(-0.05, 0) === "RESOLUTION",
    notResolution: c(0, -0.0300001) === "NOT RESOLUTION" && c(0.0199, -0.05) === "NOT RESOLUTION" && c(-0.0199, -0.05) === "NOT RESOLUTION",
    partly: c(0.02, -0.05) === "PARTLY RESOLUTION" && c(0.05, -0.04) === "PARTLY RESOLUTION",
    other: c(-0.02, -0.05) === "OTHER" && c(-0.05, -0.12) === "OTHER",
    // the order: OVERSHOOT and RESOLUTION before NOT RESOLUTION and PARTLY RESOLUTION
    order: c(0.01, 0.05) === "OVERSHOOT" && c(0.01, 0.01) === "RESOLUTION" && c(0.05, 0.02) === "RESOLUTION" && c(0.05, 0.05) === "OVERSHOOT"
      && c(0.01, -0.02) === "RESOLUTION",
  };
  check("REGIONS", Object.values(r).every(Boolean), { failed: Object.entries(r).filter(([, v]) => !v).map(([k]) => k) });
}

/** the replica against (ii)'s recorded JSON: exact on its own trace, each clause on its own
 *  tolerance in every window, the planted 2e-6 shift, and the loader's refusals */
function replica(M, check, geos, ref) {
  const [gR] = geos, d = II.decision.N1024;
  const ws = D2.prefixes(ref.trace, 3.19, 0.8), exact = M.replicaCheck(ws, ref);
  const recorded = [33, 45, 57, 69, 81].every(m => ref.vd0D[m] === d.vd0D[m] && ref.s[m] === d.s[m] && ws.find(w => w.m === m).vd0D === d.vd0D[m]
    && ws.find(w => w.m === m).s === d.s[m]);
  const edit = (m, f) => ws.map(w => (w.m === m ? f({ ...w }) : w));
  const each = [33, 45, 57, 69, 81].map(m => ({
    m, vOut: !M.replicaCheck(edit(m, w => ({ ...w, vd0D: w.vd0D * (1 + 1.1e-6) })), ref).ok, vIn: M.replicaCheck(edit(m, w => ({ ...w, vd0D: w.vd0D * (1 + 0.9e-6) })), ref).ok,
    sOut: !M.replicaCheck(edit(m, w => ({ ...w, s: w.s + 0.000101 })), ref).ok, sIn: M.replicaCheck(edit(m, w => ({ ...w, s: w.s - 0.000099 })), ref).ok,
    gone: !M.replicaCheck(edit(m, w => ({ m: w.m, available: false })), ref).ok,
  }));
  const shift = world(M, geos, ref, { R: iiRun(gR, ref, 1 + 2e-6), H: "skip" }).byId.R1024, small = world(M, geos, ref, { R: iiRun(gR, ref, 1 + 5e-7), H: "skip" }).byId.R1024;
  const pass = world(M, geos, ref, { R: iiRun(gR, ref), H: "skip" }).byId.R1024;
  const txt = f => { const j = JSON.parse(II_TEXT); f(j); return JSON.stringify(j); };
  const loader = {
    commit: throwsWith(() => M.loadIiReference(txt(j => { j.commit = "f".repeat(40); })), /not \(ii\)'s/),
    protocol: throwsWith(() => M.loadIiReference(txt(j => { j.protocolCommit = M.PROTOCOL_COMMIT; })), /not \(ii\)'s/),
    incomplete: throwsWith(() => M.loadIiReference(txt(j => { j.completed = false; })), /not \(ii\)'s/),
    invalid: throwsWith(() => M.loadIiReference(txt(j => { j.decision.N1024.valid = false; })), /not \(ii\)'s/),
  };
  const ok = exact.ok && exact.maxRelV === 0 && exact.maxPointsS === 0 && exact.windows.length === 5 && recorded && exact.against === EXPECT.iiResult
    && each.every(x => x.vOut && x.vIn && x.sOut && x.sIn && x.gone)
    && pass.valid && pass.replicaCheck.ok && pass.perChunkVsIi.maxRel === 0 && pass.perChunkVsIi.chunks === 80
    && !shift.valid && !shift.replicaCheck.ok && shift.replicaCheck.windows.every(w => Math.abs(w.relV - 2e-6) < 1e-9 && Math.abs(w.pointsS) < 1e-6)
    && shift.invalidBy.length === 1 && /replica missed/.test(shift.invalidBy[0]) && Math.abs(shift.perChunkVsIi.maxRel - 2e-6) < 1e-9
    && small.valid && small.replicaCheck.ok && Object.values(loader).every(Boolean);
  check("REPLICA", ok, { shiftRelV: shift.replicaCheck?.maxRelV, smallRelV: small.replicaCheck?.maxRelV, each: each.filter(x => !(x.vOut && x.vIn && x.sOut && x.sIn && x.gone)).map(x => x.m),
    loader: Object.entries(loader).filter(([, v]) => !v).map(([k]) => k) });
}

/** the decision worlds through assess and decide, including NO DECISION and NOT TESTED */
function worlds(M, check, geos, ref) {
  const [gR, gH] = geos;
  const R = () => iiRun(gR, ref), Hc = v => synthRun(gH, () => v);
  const VLR = mean(II.arms[0].perChunk.series.filter(p => p.k >= 54).map(p => p.vd0D));
  const t2683 = []; for (let k = 0, t = 0; k < 81; k++) { t += 2683 * EXPECT.dt04; t2683.push(t); }
  const rMov = synthRun(gR, k => 0.016 * (1 - (0.03 * (k - 67)) / 26)), hMov = () => synthRun(gH, k => 0.0163 * (1 - (0.03 * (k - 67)) / 26));
  const refused = { ...armRow(gH, null, null), exception: "Error: noflow: Error: stage: grid is 1024, wanted 2048" };
  const W = {
    partly: world(M, geos, ref, { R: R(), H: Hc(0.0163) }), resolution: world(M, geos, ref, { R: R(), H: Hc(0.0170) }),
    overshoot: world(M, geos, ref, { R: R(), H: Hc(0.0180) }), notRes: world(M, geos, ref, { R: R(), H: Hc(0.0157) }),
    other: world(M, geos, ref, { R: R(), H: Hc(0.0150) }), nearRes: world(M, geos, ref, { R: R(), H: Hc(0.017 * (1 - 0.0299)) }),
    nearPartly: world(M, geos, ref, { R: R(), H: Hc(0.017 * (1 - 0.0301)) }),
    hMoving: world(M, geos, ref, { R: R(), H: hMov() }), rMoving: world(M, geos, refOf(gR, rMov), { R: rMov, H: Hc(0.0163) }),
    noH: world(M, geos, ref, { R: R(), H: "skip" }), noR: world(M, geos, ref, { R: "skip", H: Hc(0.0163) }),
    hStopped: world(M, geos, ref, { R: R(), H: synthRun(gH, () => 0.0163, { stopAt: 70 }) }),
    h2683: world(M, geos, ref, { R: R(), H: synthRun(gH, () => 0.0163, { times: t2683 }) }),
    rShift: world(M, geos, ref, { R: iiRun(gR, ref, 1 + 2e-6), H: Hc(0.0163) }), rShiftHMoving: world(M, geos, ref, { R: iiRun(gR, ref, 1 + 2e-6), H: hMov() }),
    rFlowOn: world(M, geos, ref, { R: (() => { const x = R(); x.flowOnDuring = true; return x; })(), H: Hc(0.0163) }),
    unserved: world(M, geos, ref, { R: R(), H: Hc(0.0163), served: false }), hRefused: world(M, geos, ref, { R: R(), rowH: refused }),
  };
  const v = k => W[k].d.verdict;
  const p = W.partly.d, two = (vH, q) => vH + (vH - VLR) / (2 ** q - 1);
  const r = {
    verdicts: v("partly") === "PARTLY RESOLUTION" && v("resolution") === "RESOLUTION" && v("overshoot") === "OVERSHOOT" && v("notRes") === "NOT RESOLUTION"
      && v("other") === "OTHER" && v("nearRes") === "RESOLUTION" && v("nearPartly") === "PARTLY RESOLUTION",
    partlyNumbers: p.why === null && rel(p.d, 0.0163 / VLR - 1) < 1e-9 && Math.abs(p.e - (0.0163 / 0.017 - 1)) < 1e-12 && rel(p.VL.H2048, 0.0163) < 1e-12 && p.VL.R1024 === VLR
      && Math.abs(p.driftL.H2048) < 1e-9 && p.L.R1024 === "SETTLED" && p.L.H2048 === "SETTLED" && p.R1024.label === "DRIFTING" && p.R1024.replica.ok && p.H2048.sampleTimes.ok
      && p.H2048.sampleTimes.maxRel === 0 && p.prediction === "PARTLY RESOLUTION" && /stand as recorded/.test(p.earlier),
    reported: rel(p.reported.twoGrid.p1.Vinf, two(0.0163, 1)) < 1e-12 && rel(p.reported.twoGrid.p2.Vinf, two(0.0163, 2)) < 1e-12
      && rel(p.reported.twoGrid.p2.vsExact, two(0.0163, 2) / 0.017 - 1) < 1e-9 && rel(p.reported.twoGrid.p1.vsTong, two(0.0163, 1) / 0.018 - 1) < 1e-9
      && rel(p.reported.descriptiveRatio.value, 0.021946 / VLR) < 1e-15 && /NOT R\*/.test(p.reported.descriptiveRatio.note) && /cannot determine/.test(p.reported.twoGridNote)
      && p.reported.dk.length === 80 && rel(p.reported.dk.find(x => x.k === 54).d, 0.0163 / II.arms[0].perChunk.series[53].vd0D - 1) < 1e-9
      && rel(p.reported.tongOwnVsExact, 0.018 / 0.017 - 1) < 1e-15,
    noDecision: v("hMoving") === "NO DECISION" && /H2048 MOVING/.test(W.hMoving.d.why) && !/R1024/.test(W.hMoving.d.why) && Number.isFinite(W.hMoving.d.d) && Number.isFinite(W.hMoving.d.e)
      && rel(W.hMoving.d.driftL.H2048, -0.03) < 1e-6 && v("rMoving") === "NO DECISION" && /R1024 MOVING/.test(W.rMoving.d.why) && W.rMoving.byId.R1024.valid,
    notTested: ["noH", "noR", "hStopped", "h2683", "rShift", "rShiftHMoving", "rFlowOn", "unserved", "hRefused"].every(k => v(k) === "NOT TESTED" && /stays open/.test(W[k].d.why))
      && /H2048 not run$|H2048 not run;/.test(W.noH.d.why) && /R1024 not run/.test(W.noR.d.why) && /H2048 invalid: stop rule/.test(W.hStopped.d.why)
      && /H2048 invalid: sample times not R1024's/.test(W.h2683.d.why) && W.h2683.byId.H2048.invalidBy.length === 1
      && /R1024 invalid: replica missed/.test(W.rShift.d.why) && !/H2048/.test(W.rShift.d.why) && Number.isFinite(W.rShift.d.d) && Number.isFinite(W.rShift.d.e)
      && /R1024 invalid/.test(W.rShiftHMoving.d.why) && /flow on during the run/.test(W.rFlowOn.d.why) && /served source not verified/.test(W.unserved.d.why)
      && /H2048 not run \(the app staged nothing, wanted n 2048\)/.test(W.hRefused.d.why) && W.hRefused.d.VL.H2048 === null && W.hRefused.d.d === null,
    shape: JSON.stringify(Object.keys(p)) === JSON.stringify(["verdict", "why", "d", "e", "VL", "driftL", "L", "R1024", "H2048", "reported", "prediction", "earlier"]),
  };
  check("WORLDS", Object.values(r).every(Boolean), { failed: Object.entries(r).filter(([, x]) => !x).map(([k]) => k),
    worlds: Object.fromEntries(Object.entries(W).map(([k, x]) => [k, `${x.d.verdict}${x.d.d == null ? "" : ` d ${(100 * x.d.d).toFixed(2)}% e ${(100 * x.d.e).toFixed(2)}%`}`])) });
}

// ---- (ii)'s runArm against a mock app ------------------------------------------------

function mockEnvironment({ v0 = 0.12, failAtRead = null, failProbe = false, served = null, importThrows = [], refuse2048 = false } = {}) {
  const STEP = () => 7;
  const device = {
    adapterInfo: { vendor: "mock", architecture: "cpu", device: "", description: "flow-noflow-dx self-test", isFallbackAdapter: false },
    limits: {}, addEventListener() {}, lost: new Promise(() => {}),
    queue: { submit() {}, async onSubmittedWorkDone() {} },
    createBuffer({ size }) { const data = new Float32Array(size / 4); return { data, async mapAsync() {}, getMappedRange: () => data.buffer, unmap() {}, destroy() {} }; },
    createCommandEncoder() { return { copyTextureToBuffer(src, dst) { src.texture.fillInto(dst.buffer.data); }, finish: () => ({}) }; },
  };
  const log = { grids: [], stagedFlows: [], stages: 0, seeds: [], params: [], advances: [] };
  const makeSim = n => {
    let reads = 0;
    return {
      n, device, params: {}, flowCfg: { u: 0.02, pr: 23.1, scale: 1 }, flowOn: false, flowVelocity: null, t: 0, seed: null, step: STEP,
      setFlow(on) { this.flowOn = !!on; if (on) log.stagedFlows.push(n); return null; },
      reset() { log.stages++; log.params.push({ n, dx: this.params.dx, dt: this.params.dt }); this.t = 0; this.seed = null; },
      addSeed(x, y, r) { this.seed = { x, y, r }; log.seeds.push([n, x, y, r]); },
      async stepSync(k) { if (k > 0) log.advances.push([n, k]); this.t += k * this.params.dt; return k; },
      tips() {
        const { x, y, r } = this.seed, go = (v0 * this.t) / this.params.dx, cx = x - 0.5, cy = y - 0.5;
        return { cx, cy, west: cx - r - go, east: cx + r + go, north: cy + r + go, south: cy - r - go };
      },
      phiAt(i, j, tp) {
        const ramp = s => Math.min(1, Math.max(0, 0.5 + s / 2));
        const h = Math.abs(j - tp.cy) <= 3 ? Math.min(ramp(i - tp.west), ramp(tp.east - i)) : 0;
        const v = Math.abs(i - tp.cx) <= 3 ? Math.min(ramp(j - tp.south), ramp(tp.north - j)) : 0;
        return Math.max(h, v);
      },
      /** T: 0.45 far away, warmed by 0.2 exp(-d / 20) within d cells ahead of the west tip */
      tAt(i, tp) { return i < tp.west ? 0.45 + 0.2 * Math.exp(-(tp.west - i) / 20) : 0.65; },
      /** as (ii)'s mock, cell for cell; phi is evaluated only where it can be non-zero
       *  (the seed row's band and column's band), so a 2048^2 end read stays cheap */
      async readRows(y0, h) {
        reads++;
        if (failAtRead != null && reads === failAtRead) return null;
        const tp = this.tips(), out = new Float32Array(h * n * 4), tRow = Array.from({ length: n }, (_, i) => this.tAt(i, tp));
        const lo = Math.max(0, Math.floor(tp.cx - 4)), hi = Math.min(n - 1, Math.ceil(tp.cx + 4));
        for (let r = 0; r < h; r++) {
          const j = y0 + r, o = r * n * 4, band = Math.abs(j - tp.cy) <= 3;
          for (let i = 0; i < n; i++) out[o + i * 4 + 1] = tRow[i];
          for (let i = band ? 0 : lo; i <= (band ? n - 1 : hi); i++) out[o + i * 4] = this.phiAt(i, j, tp);
        }
        return out;
      },
    };
  };
  let sim = makeSim(1024);
  const S = { app: { setRun() {}, setGrid(n) { log.grids.push(n); if (!(refuse2048 && n === 2048)) sim = makeSim(n); }, setInoculant() {} }, sim: () => sim, seed: () => 42 };
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const texts = served ?? Object.fromEntries(D2.SERVED.map(p => [p, `// ${p}\nexport const x = 1;\n`]));
  const ctx = {
    errors: [], rawDir: null,
    async open() {
      globalThis.window = { __solidify: S, __fdImport: async p => {
        if (p.endsWith("?raw")) { const path = p.slice(1, -4); if (importThrows.includes(path)) throw new SyntaxError(`Unexpected identifier (mock ${path})`); return { default: texts[path] }; }
        return { FLUX_WGSL: "f", PHI_WGSL: "p", TRANSPORT_WGSL: "t", STAMP_WGSL: "s", UPDATE_WGSL: "u", STATS_WGSL: "x" };
      } };
      globalThis.fetch = async url => { const path = String(url).slice(1, -4); return { ok: true, status: 200, text: async () => texts[path] }; };
      globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
      globalThis.GPUBufferUsage = { COPY_DST: 8, MAP_READ: 1 };
      globalThis.GPUMapMode = { READ: 1 };
      const page = { evaluate: async (fn, arg) => clone(await fn(clone(arg))), close: async () => {} };
      await page.evaluate(installDriver, HELPER_SRC);
      await page.evaluate(D2.installProbe);
      if (failProbe) window.__nd2probe = { async tRow() { throw new Error("probe: readRows failed"); } };
      return page;
    },
  };
  const disk = Object.fromEntries(D2.SERVED.map(p => [p, T2.hashText(`// ${p}\r\nexport const x = 1;\r\n`)]));
  ctx.admit = m => { const x = T2.admission(m, disk); if (!x.ok) throw new Error(`not admitted: ${x.why}`); return x; };
  return { ctx, S, STEP, log };
}

const restored = env => { const s = env.S.sim(); return s.step === env.STEP && !s.flowOn; };

async function mockRun(M, check, geos, ref) {
  const [gR, gH] = geos;
  const env = mockEnvironment();
  const rows = [await M.runArm(env.ctx, gR)];
  const r1 = restored(env);
  rows.push(await M.runArm(env.ctx, gH));
  const [A, B] = rows, tA = A.runs.noflow.trace, tB = B.runs.noflow.trace;
  const adv = n => env.log.advances.filter(x => x[0] === n).map(x => x[1]);
  const want = (k, dx) => 0.45 + 0.2 * Math.exp(-(k * EXPECT.lD) / dx / 20) - 1;
  const pB = B.runs.noflow.probe.at(-1), pA = A.runs.noflow.probe.at(-1), xB = tB.at(-1).xWest;
  const drive = {
    noException: rows.every(r => !r.exception) && r1 && restored(env),
    advanced: adv(1024).length === 81 && adv(1024).every(k => k === 671) && adv(2048).length === 81 && adv(2048).every(k => k === 2684),
    delivered: tA.length === 81 && tB.length === 81 && tA.every(p => p.delivered === 671) && tB.every(p => p.delivered === 2684)
      && A.gridAccepted.delivered === 54351 && B.gridAccepted.delivered === 217404 && B.gridAccepted.staged === 2048 && B.gridAccepted.flowOn === false,
    staged: JSON.stringify(env.log.grids) === "[2048]" && env.log.stagedFlows.length === 0
      && JSON.stringify(env.log.seeds) === JSON.stringify([[1024, 512, 512, 10], [2048, 1024, 1024, 20]])
      && JSON.stringify(env.log.params) === JSON.stringify([{ n: 1024, dx: 0.8, dt: EXPECT.dt08 }, { n: 2048, dx: 0.4, dt: EXPECT.dt04 }]),
    sameTimes: tB.every((p, k) => p.t === tA[k].t) && tA.every((p, k) => p.t === II.arms[0].runs.noflow.trace[k].t),
    probe: Math.abs(pB.u2 - want(2, 0.4)) < 1e-4 && Math.abs(pB.u4 - want(4, 0.4)) < 1e-4 && (xB - gH.probeCells[2] < 0 ? pB.u8 === null : Math.abs(pB.u8 - want(8, 0.4)) < 1e-4)
      && Math.abs(pA.u2 - want(2, 0.8)) < 1e-4 && A.runs.noflow.probeMatchesEnd === true && B.runs.noflow.probeMatchesEnd === true,
    tagged: A.replicaIi === true && B.replicaIi === false && A.dx === 0.8 && B.dx === 0.4 && B.chunk === 2684,
  };
  // against (ii)'s record the mock's speed misses the replica (and only that); H2048 is valid
  const byId = M.assess(rows, true, ref), d = M.decide(byId), vMock = (0.12 * K.A1) / (K.A2 * 3.19 * 3.19);
  const assessed = !byId.R1024.valid && byId.R1024.invalidBy.length === 1 && /replica missed/.test(byId.R1024.invalidBy[0]) && byId.H2048.valid
    && byId.H2048.L.label === "SETTLED" && rel(byId.H2048.L.VL, vMock) < 1e-6 && byId.H2048.sampleTimes.ok && byId.H2048.sampleTimes.maxRel === 0
    && d.verdict === "NOT TESTED" && /R1024 invalid: replica missed/.test(d.why);
  // against a reference made from the mock's own R1024 both are valid, and the verdict is classify(d, e)
  const own = M.decide(M.assess(rows, true, refOf(gR, A.runs.noflow)));
  const decided = own.R1024.valid && own.H2048.valid && Math.abs(own.d) < 1e-6 && own.verdict === M.classify(own.d, own.e) && own.verdict === (Math.abs(vMock / 0.017 - 1) <= 0.03 ? "RESOLUTION" : "NOT RESOLUTION");
  const ok = Object.values(drive).every(Boolean) && assessed && decided;
  check("MOCK-RUN", ok, { failed: Object.entries(drive).filter(([, v]) => !v).map(([k]) => k), assessed, decided, advanced: [adv(1024)[0], adv(2048)[0]],
    probeH2048: pB, own: own.verdict });
}

async function mockFailures(M, check, geos, ref) {
  const [gR, gH] = geos;
  const rowR = armRow(gR, iiRun(gR, ref));
  const ref1 = mockEnvironment({ refuse2048: true });
  const nRow = await M.runArm(ref1.ctx, gH), nd = M.decide(M.assess([rowR, nRow], true, ref));
  const fast = mockEnvironment({ v0: 0.3 });
  const sRow = await M.runArm(fast.ctx, gH), sA = M.assess([sRow], true, ref).H2048;
  const broken = mockEnvironment({ failAtRead: 9 });
  const bRow = await M.runArm(broken.ctx, gH), bA = M.assess([bRow], true, ref).H2048;
  const noProbe = mockEnvironment({ failProbe: true });
  // the probe never gates (at n 1024, against a reference made from the mock's own windows)
  const pRow = await M.runArm(noProbe.ctx, gR), pA = M.assess([pRow], true, refOf(gR, pRow.runs.noflow)).R1024;
  const st = sRow.runs.noflow.trace;
  const r = {
    refused: /grid is 1024, wanted 2048/.test(nRow.exception ?? "") && ref1.log.advances.length === 0 && nRow.gridAccepted.staged === null
      && nd.verdict === "NOT TESTED" && /H2048 not run \(the app staged nothing, wanted n 2048\)/.test(nd.why) && nd.R1024.valid,
    stopRule: sRow.runs.noflow.stopped && st.length < 81 && st.at(-1).xWest <= K.STOP_CELLS && st.at(-2).xWest > K.STOP_CELLS && !sA.valid && /stop rule/.test(sA.invalidBy.join()) && restored(fast),
    readback: /readRows failed/.test(bRow.exception ?? "") && restored(broken) && !bA.valid,
    probe: /probe: readRows failed/.test(pRow.runs.noflow.probeError ?? "") && pA.valid && pRow.runs.noflow.probe.length === 0,
  };
  check("MOCK-FAILURES", Object.values(r).every(Boolean), { failed: Object.entries(r).filter(([, v]) => !v).map(([k]) => k), refusedWith: String(nRow.exception).split("\n")[0],
    stoppedAt: st.length });
}

async function admissionCheck(M, check, geos, ref) {
  const g = geos[0];   // refusal happens before staging, whatever the arm; n 1024 keeps the full mock runs cheap
  const lf = Object.fromEntries(D2.SERVED.map(p => [p, `// ${p}\nexport const x = 1;\n`]));
  const attempt = async opts => { const env = mockEnvironment(opts); const row = await M.runArm(env.ctx, g); return { row, stepped: env.log.stages > 0 || env.log.grids.length > 0 || env.log.advances.length > 0 }; };
  const same = await attempt({ served: lf });
  const viaFetch = await attempt({ served: lf, importThrows: ["src/main.ts"] });
  const changed = await attempt({ served: { ...lf, "src/sim.ts": lf["src/sim.ts"].replace("x = 1", "x = 2") } });
  const refused = x => /not admitted/.test(x.row.exception ?? "") && Object.keys(x.row.runs).length === 0 && !x.stepped;
  const ok = !same.row.exception && same.stepped && same.row.admission.ok && viaFetch.row.admission?.vehicles["src/main.ts"] === "fetch"
    && refused(changed) && /served source differs: src\/sim.ts/.test(changed.row.exception) && !M.assess([changed.row], false, ref).R1024.valid;
  check("ADMISSION", ok, { refusedWith: String(changed.row.exception).split("\n")[0] });
}

/** every check that reads the module under test (and nothing outside the repo's git state) */
async function moduleChecks(M, check) {
  constants(M, check);
  const geos = parsing(M, check);
  let ref = null;
  try { ref = M.loadIiReference(II_TEXT); } catch (e) { check("REFERENCE", false, { threw: String(e.message) }); return; }
  await guard(check, "STAGING", () => staging(M, check, geos));
  await guard(check, "LATE", () => late(M, check, ref));
  await guard(check, "REGIONS", () => regions(M, check));
  await guard(check, "REPLICA", () => replica(M, check, geos, ref));
  await guard(check, "WORLDS", () => worlds(M, check, geos, ref));
  await guard(check, "MOCK-RUN", () => mockRun(M, check, geos, ref));
  await guard(check, "MOCK-FAILURES", () => mockFailures(M, check, geos, ref));
  await guard(check, "ADMISSION", () => admissionCheck(M, check, geos, ref));
  await guard(check, "FROZEN", () => frozen(M, check));
}

// ---- the real Simulation at both arms' staging, on a recording device ----------------

/** WebGPU's default limits (the app requests none: main.ts requestDevice names features only) */
const DEFAULT_LIMITS = { maxTextureDimension2D: 8192, maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 };

function recordingDevice() {
  const log = { textures: [], buffers: [], dispatches: 0, badDispatch: [], copies: [] };
  const stub = () => new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : stub()), apply: () => stub() });
  const device = {
    limits: { ...DEFAULT_LIMITS },
    createTexture(d) { log.textures.push([...d.size]); return { createView: () => stub(), destroy() {}, width: d.size[0], height: d.size[1] }; },
    createBuffer(d) {
      log.buffers.push({ size: d.size, usage: d.usage });
      const data = d.usage & 1 ? new ArrayBuffer(d.size) : null;
      return { size: d.size, destroy() {}, async mapAsync() {}, getMappedRange: () => data, unmap() {} };
    },
    createShaderModule() { return { getCompilationInfo: async () => ({ messages: [] }) }; },
    createComputePipeline() { return { getBindGroupLayout: () => stub() }; },
    createRenderPipeline() { return { getBindGroupLayout: () => stub() }; },
    createBindGroup: () => stub(), createBindGroupLayout: () => stub(), createPipelineLayout: () => stub(), createSampler: () => stub(),
    createCommandEncoder() {
      return {
        beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(x, y = 1) { log.dispatches++; log.last = `${x}x${y}`; if (log.want && log.last !== log.want) log.badDispatch.push(log.last); }, end() {} }; },
        copyTextureToBuffer(src, dst, size) { log.copies.push({ bpr: dst.bytesPerRow, w: size.width ?? size[0] }); },
        copyBufferToBuffer() {}, clearBuffer() {}, finish() { return {}; },
      };
    },
    queue: { writeBuffer() {}, writeTexture() {}, submit() {}, async onSubmittedWorkDone() {} },
  };
  return { device, log };
}

async function simulationAccepts(M, check, geos) {
  const { createServer } = await import("vite");
  // no port at all: middleware mode, and no HMR websocket
  const server = await createServer({ root: REPO, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
  const saved = { window: globalThis.window, raf: globalThis.requestAnimationFrame, tu: globalThis.GPUTextureUsage, bu: globalThis.GPUBufferUsage,
    ss: globalThis.GPUShaderStage, mm: globalThis.GPUMapMode };
  const bad = [], detail = {};
  try {
    globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
    globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
    globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
    globalThis.GPUMapMode = { READ: 1, WRITE: 2 };
    globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    const { Simulation } = await server.ssrLoadModule("/src/sim.ts");
    for (const g of geos) {
      const s = g.staging, { device, log } = recordingDevice();
      let sim = new Simulation(device, 1024), setFlowOn = 0;
      const S = { app: { setRun() {}, setGrid(n) { sim = new Simulation(device, n); }, setInoculant() {} }, sim: () => sim, seed: () => 0 };
      globalThis.window = { __solidify: S };
      installDriver(HELPER_SRC);
      D2.installProbe();
      // the cfg exactly as (ii)'s runNoflow builds it from g.staging
      const cfg = { lambda: g.lambda, n: g.n, seedX: g.seedX, seedY: g.seedY, dx: s.dx, dt: s.dt, dTilde: s.dTilde, eps4: K.EPS4,
        delta: K.DELTA, uLat: s.uLat, pr: K.PR, seedR: s.seedRCells, flow: null };
      const st = await window.__fd.stage(cfg);
      const orig = S.sim().setFlow.bind(S.sim());
      S.sim().setFlow = on => { if (on) setFlowOn++; return orig(on); };
      const wg = Math.ceil(g.n / 8);
      log.dispatches = 0; log.copies.length = 0; log.want = `${wg}x${wg}`;
      const adv = await window.__fd.advance(s.chunk);
      const tRow = await window.__nd2probe.tRow(g.seedY);
      const e = await window.__fd.end(g.seedX - 20);
      const fin = await window.__fd.finish();
      const big = log.buffers.filter(x => x.size > DEFAULT_LIMITS.maxBufferSize || ((x.usage & 128) && x.size > DEFAULT_LIMITS.maxStorageBufferBindingSize));
      const k = { n: st.n, flowOn: st.flowOn, dx: st.params.dx, dt: st.params.dt, delivered: adv.got, row: adv.row.length, tRow: tRow.length, column: e.column.length, vel: e.vel, fin,
        dispatches: log.dispatches, badDispatch: log.badDispatch.length, copyOk: log.copies.length > 0 && log.copies.every(c => c.bpr % 256 === 0 && c.w === g.n),
        texturesOk: log.textures.every(([w, h]) => w <= DEFAULT_LIMITS.maxTextureDimension2D && h <= DEFAULT_LIMITS.maxTextureDimension2D),
        largestBuffer: Math.max(...log.buffers.map(x => x.size)), overLimit: big.length, setFlowOn };
      if (!(k.n === g.n && k.flowOn === false && k.dx === s.dx && k.dt === s.dt && k.delivered === g.chunk && k.delivered === s.chunk && k.row === g.n && k.tRow === g.n
        && k.column === g.n && k.vel === null && k.fin === true && k.dispatches > 0 && k.badDispatch === 0 && wg <= DEFAULT_LIMITS.maxComputeWorkgroupsPerDimension
        && k.copyOk && k.texturesOk && k.overLimit === 0 && k.setFlowOn === 0 && S.sim().step === Simulation.prototype.step)) bad.push(`${g.id}: ${JSON.stringify(k)}`);
      detail[g.id] = { n: g.n, dx: s.dx, delivered: k.delivered, dispatches: k.dispatches, largestBufferMiB: +(k.largestBuffer / 2 ** 20).toFixed(1) };
    }
  } catch (e) { bad.push(String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); }
  finally {
    await server.close();
    Object.assign(globalThis, { window: saved.window, requestAnimationFrame: saved.raf, GPUTextureUsage: saved.tu, GPUBufferUsage: saved.bu, GPUShaderStage: saved.ss, GPUMapMode: saved.mm });
  }
  check("SIM-ACCEPTS", bad.length === 0, { bad, ...detail });
}

// ---- planted defects ---------------------------------------------------------------

/** each defect is one or more exact edits of flow-noflow-dx.mjs; each edit must occur once */
export const PLANTED = [
  ["replica tolerance 1e-5", [["replicaRel: 1e-6,", "replicaRel: 1e-5,"]]],
  ["replica s tolerance 0.1 points", [["replicaPoints: 0.0001,", "replicaPoints: 0.001,"]]],
  ["replica on window 33 only", [["const per = PROTOCOL.windows.map(m => {", "const per = [33].map(m => {"], ["ok: per.length === PROTOCOL.windows.length && per.every(x => x.ok)", "ok: per.every(x => x.ok)"]]],
  ["replica not gating", [["if (!a.replicaCheck.ok) why.push(", "if (false) why.push("]]],
  ["replica clause untagged in runArm", [["row.replicaIi = g.replicaIi;", "row.replicaIi = false;"]]],
  ["(ii)'s tong3 replica applied", [["replica: false, replicaIi:", "replica: arm.replica === true, replicaIi:"]]],
  ["chunk 2683 in the staging, 2684 on the arm (the trap)", [["const s = arm.chunk === s3.chunk ? s3", "const s = true ? s3"],
    ["chunk: s.chunk, chunks: PROTOCOL.chunks, substeps,", "chunk: arm.chunk, chunks: PROTOCOL.chunks, substeps,"],
    ["const substeps = s.chunk * PROTOCOL.chunks", "const substeps = arm.chunk * PROTOCOL.chunks"],
    ["(gH.staging.chunk * gH.staging.dt) / (gR.staging.chunk * gR.staging.dt)", "(gH.chunk * gH.staging.dt) / (gR.chunk * gR.staging.dt)"]]],
  ["sample-time assert 1e-3", [["sampleTimeAssert: 1e-12,", "sampleTimeAssert: 1e-3,"]]],
  ["sample times not gating", [["if (!a.sampleTimes.ok) why.push(", "if (false) why.push("]]],
  ["sample times against the trace's own", [["a.sampleTimes = sampleTimeCheck(run?.trace, tR);", "a.sampleTimes = sampleTimeCheck(run?.trace, (run?.trace ?? []).map(p => p.t));"]]],
  ["H2048 staged at dx 0.8", [["T3.staging(PROTOCOL.lambda, arm.dx, sideW0)", "T3.staging(PROTOCOL.lambda, 0.8, sideW0)"]]],
  ["probe cells at dx 0.8", [["D2.PROTOCOL.probeLD.map(k => (k * s.lD) / s.dx)", "D2.PROTOCOL.probeLD.map(k => (k * s.lD) / 0.8)"]]],
  ["L window 53..80", [["lateWindow: [54, 80],", "lateWindow: [53, 80],"]]],
  ["drift_L over 27 chunks", [["const driftL = ((k1 - k0) * b) / VL;", "const driftL = ((k1 - k0 + 1) * b) / VL;"]]],
  ["V_L as the last value", [["const VL = pts.reduce((s, p) => s + p.vd0D, 0) / want;", "const VL = pts.at(-1).vd0D;"]]],
  ["SETTLED edge strict", [["Math.abs(drift) <= RULES.settledMax ? \"SETTLED\"", "Math.abs(drift) < RULES.settledMax ? \"SETTLED\""]]],
  ["SETTLED at 0.03", [["settledMax: 0.02,", "settledMax: 0.03,"]]],
  ["OVERSHOOT edge inclusive", [["if (e > RULES.overshoot)", "if (e >= RULES.overshoot)"]]],
  ["RESOLUTION edge strict", [["if (Math.abs(e) <= RULES.resolution)", "if (Math.abs(e) < RULES.resolution)"]]],
  ["NOT RESOLUTION edge inclusive", [["if (Math.abs(d) < RULES.notResolution)", "if (Math.abs(d) <= RULES.notResolution)"]]],
  ["PARTLY edge strict", [["if (d >= RULES.partly)", "if (d > RULES.partly)"]]],
  ["NOT RESOLUTION before RESOLUTION", [["  if (Math.abs(e) <= RULES.resolution) return \"RESOLUTION\";\n  if (Math.abs(d) < RULES.notResolution) return \"NOT RESOLUTION\";",
    "  if (Math.abs(d) < RULES.notResolution) return \"NOT RESOLUTION\";\n  if (Math.abs(e) <= RULES.resolution) return \"RESOLUTION\";"]]],
  ["PARTLY before OVERSHOOT", [["  if (e > RULES.overshoot) return \"OVERSHOOT\";\n  if (Math.abs(e) <= RULES.resolution) return \"RESOLUTION\";\n  if (Math.abs(d) < RULES.notResolution) return \"NOT RESOLUTION\";\n  if (d >= RULES.partly) return \"PARTLY RESOLUTION\";",
    "  if (d >= RULES.partly) return \"PARTLY RESOLUTION\";\n  if (e > RULES.overshoot) return \"OVERSHOOT\";\n  if (Math.abs(e) <= RULES.resolution) return \"RESOLUTION\";\n  if (Math.abs(d) < RULES.notResolution) return \"NOT RESOLUTION\";"]]],
  ["e against Tong's 0.0180", [["e = vH != null ? vH / exact - 1", "e = vH != null ? vH / tong - 1"]]],
  ["d inverted", [["const d = vR != null && vH != null ? vH / vR - 1", "const d = vR != null && vH != null ? vR / vH - 1"]]],
  ["MOVING ignored", [["else if (R.L.label !== \"SETTLED\" || H.L.label !== \"SETTLED\") {", "else if (false) {"]]],
  ["invalid arms decided", [["if (!R?.valid || !H?.valid) { verdict = \"NOT TESTED\";", "if (!R || !H) { verdict = \"NOT TESTED\";"]]],
  ["a missing H2048 not NOT TESTED", [["if (!R?.valid || !H?.valid) { verdict = \"NOT TESTED\";", "if (!R?.valid || H?.valid === false) { verdict = \"NOT TESTED\";"]]],
  ["invalid reads NO DECISION", [["verdict = \"NOT TESTED\"; why =", "verdict = \"NO DECISION\"; why ="]]],
  ["two-grid over 2^p", [["(vH - vR) / (2 ** p - 1)", "(vH - vR) / 2 ** p"]]],
  ["descriptive ratio over H2048", [["value: PROTOCOL.flowVd0D / vR,", "value: PROTOCOL.flowVd0D / vH,"]]],
  ["exact 0.0180", [["exactNoflowVd0D: 0.0170,", "exactNoflowVd0D: 0.0180,"]]],
  ["freeze drops tong3's self-test", [["  \"scripts/research/flow-tong3-selftest.mjs\": II_RUN_COMMIT,\n", ""]]],
  ["freeze at (ii)'s result commit", [["export const II_RUN_COMMIT = \"14242e4dab18eeb6e97463ddc5fac514f473775e\";", "export const II_RUN_COMMIT = \"22f3c7d0f017e5bdb4487363edf2734aa692e22a\";"]]],
  ["freeze ignores the working tree", [["!!want[i] && want[i] === head[i] && want[i] === disk", "!!want[i] && want[i] === head[i]"]]],
  ["reference from any run", [["j.commit !== II_RUN_COMMIT || ", ""]]],
];

/** import a copy of the script from a data: URL: relative imports and import.meta.url
 *  point at the real directory (the copy's own name is not the CLI's, so it never runs main) */
async function importVariant(src) {
  const dir = new URL("./", SCRIPT_URL).href;
  const text = src.replace(/from "\.\/([^"]+)"/g, (_, f) => `from "${dir}${f}"`).replaceAll("import.meta.url", JSON.stringify(`${dir}flow-noflow-dx.planted.mjs`));
  return import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
}

async function planted(check) {
  const source = readFileSync(SCRIPT_URL, "utf8").replace(/\r\n/g, "\n");
  const quietRun = async M => { const q = runner(true); await moduleChecks(M, q.check); return q.failed; };
  const savedFetch = globalThis.fetch, savedWindow = globalThis.window;
  const control = await quietRun(await importVariant(source));
  const out = [];
  for (const [name, edits] of PLANTED) {
    let src = source, applies = true;
    for (const [from, to] of edits) { if (src.split(from).length !== 2) applies = false; src = src.replace(from, to); }
    let failedChecks = null, importError = null;
    if (applies) { try { failedChecks = await quietRun(await importVariant(src)); } catch (e) { importError = String(e.message).split("\n")[0]; } }
    out.push({ name, applies, importError, caughtBy: failedChecks ? [...new Set(failedChecks)] : null });
  }
  globalThis.fetch = savedFetch; globalThis.window = savedWindow;
  const missed = out.filter(x => !x.applies || x.importError || !x.caughtBy?.length);
  check("PLANTED", control.length === 0 && missed.length === 0 && out.length === PLANTED.length,
    { control, planted: out.length, missed: missed.map(x => x.name), caught: Object.fromEntries(out.map(x => [x.name, x.caughtBy])) });
  return out;
}

export async function selfTest() {
  const fetchSaved = globalThis.fetch, windowSaved = globalThis.window;
  const { check, failed } = runner(false);
  await guard(check, "PROTOCOL", () => protocol(REAL, check));
  await moduleChecks(REAL, check);
  await guard(check, "SIM-ACCEPTS", () => simulationAccepts(REAL, check, REAL.parseArms(ARMS)));
  await guard(check, "PLANTED", () => planted(check));
  globalThis.fetch = fetchSaved;
  globalThis.window = windowSaved;
  console.log(`NDX-SELFTEST ${failed.length ? `FAILED (${failed.length}: ${[...new Set(failed)].join(", ")})` : "PASSED"} (CPU only; no browser, no dev server, no GPU)`);
  return failed.length === 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selfTest().then(ok => { process.exitCode = ok ? 0 : 1; }, err => { console.error(err?.stack ?? err); process.exitCode = 1; });
}
