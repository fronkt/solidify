// Browser-free self-test for scripts/research/flow-noflow-d2.mjs (Tong follow-up
// (ii)). Never launches Chrome or touches a GPU. Checks: the protocol and its
// amendment at the pinned commit; that the reused scripts (and tong3's recorded
// result) are the frozen ones; the arm file and its refusals; the run length; the
// replica on tong3's own recorded trace, pass and fail; the prefix statistic,
// labels and m* on synthetic traces (steady, drifting, late-steady) and on
// explicit edges; the box rule and its edges; R* only when N1024 is STEADY and
// valid, never touching tong3's verdict; the probe; D3.4's in-page driver against
// a mock app for both arms; the served-source admission; and the real Simulation
// (src/sim.ts through Vite's module runner, no port) at n 1024 and 2048 with flow
// off on a recording GPU device, against WebGPU's default limits.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as T2 from "./flow-tong2.mjs";
import * as T3 from "./flow-tong3.mjs";
import {
  PROTOCOL_COMMIT, PROTOCOL_HEADER, AMENDMENT_HEADER, ORIGINAL_PROTOCOL_COMMIT, FROZEN, TONG3_RESULT, D35_PASSED_COMMIT, REPO,
  PROTOCOL, RULES, SERVED, geometry, parseArms, installProbe, uAt, probeSample, runArm, prefixes, label, perChunk, assess, boxRule, decide,
} from "./flow-noflow-d2.mjs";
import { HELPER_SRC, installDriver } from "./flow-domain.mjs";

const K = T2.K;
let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log(`ND2-SELFTEST-${name}`, ok ? "OK" : "FAIL", JSON.stringify(detail ?? {})); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20, cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
const ARMS = JSON.parse(readFileSync(new URL("./flow-noflow-d2-arms.json", import.meta.url), "utf8"));
const TONG3 = JSON.parse(readFileSync(new URL(`../../${TONG3_RESULT}`, import.meta.url), "utf8"));
const P768NF = TONG3.arms.find(a => a.id === "P768").runs.noflow;
const norm = s => s.replace(/\s+/g, " ");
const section = text => { const i = text.indexOf(PROTOCOL_HEADER); if (i < 0) return null; const j = text.indexOf("\n## ", i); return text.slice(i, j < 0 ? undefined : j); };

function protocol() {
  let ok = true, detail = {};
  try {
    git(["cat-file", "-e", `${PROTOCOL_COMMIT}^{commit}`]);
    git(["merge-base", "--is-ancestor", PROTOCOL_COMMIT, "HEAD"]);
    git(["merge-base", "--is-ancestor", ORIGINAL_PROTOCOL_COMMIT, PROTOCOL_COMMIT]);
    const amended = section(git(["show", `${PROTOCOL_COMMIT}:tasks/todo.md`]));
    const original = section(git(["show", `${ORIGINAL_PROTOCOL_COMMIT}:tasks/todo.md`]));
    const sec = norm(amended ?? "");
    const quoted = [
      "N1024: n 1024, dx 0.8 W0, seed centred (512, 512)", "N2048: n 2048, dx 0.8 W0, seed centred (1024, 1024)",
      "81 chunks of 671 substeps (54351 substeps)", "m in {33, 45, 57, 69, 81}", "s_m = v_last / v_mid - 1",
      "V d0/D 0.0162725 within 1e-6 relative, and s_33 = -4.454% within 0.01 points",
      "STEADY if |s_81| <= 0.02", "m* is the smallest m with |s_m| <= 0.02 for that and every larger window",
      "DRIFTING if |s_81| > 0.02", "BOX-INDEPENDENT if |V81(N2048) / V81(N1024) - 1| <= 0.005 and |s_81(N2048) - s_81(N1024)| <= 0.005",
      "BOX-DEPENDENT if either difference is > 0.02", "otherwise UNRESOLVED", "R* (only if N1024 is STEADY) = 0.021946 / V*_noflow(N1024)",
      "against [1.26, 1.54] and Tong's 1.372", "u at 2, 4 and 8 l_D_KR (l_D_KR = 16.3 W0) ahead of the west tip",
    ];
    detail = { header: amended != null, amendment: sec.includes(AMENDMENT_HEADER), originalKeptVerbatim: !!original && amended.startsWith(original.trimEnd()),
      missingQuotes: quoted.filter(q => !sec.includes(q)), armsCommit: ARMS.protocolCommit === PROTOCOL_COMMIT };
    ok = detail.header && detail.amendment && detail.originalKeptVerbatim && detail.missingQuotes.length === 0 && detail.armsCommit;
  } catch (e) { ok = false; detail.error = String(e.message).split("\n")[0]; }
  check("PROTOCOL", ok, { commit: PROTOCOL_COMMIT.slice(0, 7), original: ORIGINAL_PROTOCOL_COMMIT.slice(0, 7), ...detail });
}

/** the reused scripts, their self-tests and arms, and tong3's recorded result are the frozen ones */
function frozen() {
  const groups = {
    "21e73ee5dafc77a47c603dc97999aa50b254d6e8": ["scripts/research/flow-domain.mjs", "scripts/research/flow-tong2.mjs", "scripts/research/flow-tong2-selftest.mjs", "scripts/research/flow-tong2-arms.json"],
    "f7db85acc123780f6343de1442085df94ef471b0": ["scripts/research/flow-tong3.mjs", "scripts/research/flow-tong3-selftest.mjs", "scripts/research/flow-tong3-arms.json"],
    "f47bc6f": [TONG3_RESULT],
  };
  const out = {};
  for (const [c, paths] of Object.entries(groups)) {
    try { git(["diff", "--quiet", c, "HEAD", "--", ...paths]); git(["diff", "--quiet", c, "--", ...paths]); out[c.slice(0, 7)] = true; } catch { out[c.slice(0, 7)] = false; }
  }
  const pinned = Object.keys(FROZEN).length === 3 && Object.entries(FROZEN).every(([p, c]) => groups[c]?.includes(p));
  let srcAsD35 = true;
  try { git(["diff", "--quiet", D35_PASSED_COMMIT, "HEAD", "--", "src"]); } catch { srcAsD35 = false; }
  check("FROZEN", Object.values(out).every(Boolean) && pinned, { ...out, pinned, srcAsD35PassedHead: srcAsD35 });
}

function parsing() {
  let geos, parseError = null;
  try { geos = parseArms(ARMS); } catch (e) { parseError = String(e.message); geos = PROTOCOL.arms.map(geometry); }
  const mutate = f => { const j = JSON.parse(JSON.stringify(ARMS)); f(j); return () => parseArms(j); };
  const hostile = {
    nSwapped: throwsWith(mutate(j => { j.arms[1].n = 1536; j.arms[1].seedX = 768; j.arms[1].seedY = 768; }), /pre-registered/),
    offCentre: throwsWith(mutate(j => { j.arms[0].seedX = 768; }), /pre-registered/),
    tong3Length: throwsWith(mutate(j => { j.arms[0].chunks = 33; j.arms[0].substeps = 22143; }), /not the protocol's/),
    chunkDraft: throwsWith(mutate(j => { j.arms[1].chunk = 670; j.arms[1].substeps = 54270; }), /not the protocol's/),
    replicaMoved: throwsWith(mutate(j => { delete j.arms[0].replica; j.arms[1].replica = true; }), /replica/),
    reordered: throwsWith(mutate(j => { j.arms.reverse(); }), /order/),
    extra: throwsWith(mutate(j => { j.arms.push({ ...j.arms[1], id: "N4096", n: 4096, seedX: 2048, seedY: 2048 }); }), /exactly/),
    missing: throwsWith(mutate(j => { j.arms.pop(); }), /exactly/),
    unknownKey: throwsWith(mutate(j => { j.arms[0].flow = true; }), /unknown key/),
    wrongProtocol: throwsWith(mutate(j => { j.protocolCommit = ORIGINAL_PROTOCOL_COMMIT; }), /protocolCommit/),
  };
  check("PARSE", parseError === null && geos.map(g => g.id).join() === "N1024,N2048" && Object.values(hostile).every(Boolean)
    && geos.filter(g => g.replica).map(g => g.id).join() === "N1024", { parseError, hostile });
  return geos;
}

/** the run length: tong3's tier-P chunk 671, 81 of them; the first 33 are tong3's window */
function runLength(geos) {
  const t3 = T3.staging(3.19, 0.8, 819.2), [a, b] = geos;
  // independent values (Python 3): T81 = 54351 x 0.04801985621054306; l_D = D~ / V_KR in cells
  const T81 = 54351 * 0.04801985621054306, lDcells = (0.6267 * 3.19) / 0.1226554494739224 / 0.8;
  const ok = a.chunk === 671 && b.chunk === 671 && a.substeps === 54351 && b.substeps === 54351 && a.chunks === 81
    && rel(a.tRun, T81) < 1e-14 && Math.round(a.tRun) === 2610 && Math.round(a.tRunInLD * 10) / 10 === 19.6
    && Math.abs(33 * a.chunk * a.staging.dt - t3.tSampled) < 1e-9 && a.staging.dt === t3.dt && a.staging.uLat === t3.uLat
    && Math.round(a.boxD0) === 2956 && Math.round(b.boxD0) === 5913 && Math.round(a.diffusionLengthCells) === 90
    && a.probeCells.every((x, i) => rel(x, PROTOCOL.probeLD[i] * lDcells) < 1e-12) && Math.abs(a.staging.lD - 16.3) < 0.01;
  check("RUN-LENGTH", ok, { substeps: a.substeps, T81: a.tRun, TinLD: a.tRunInLD, probeCells: a.probeCells, predictedEndGapCells: geos.map(g => +g.predictedEndGapCells.toFixed(0)) });
}

// ---- synthetic arms through assess / decide ---------------------------------------

const DT_CHUNK = 671 * 0.04801985621054306;
const toV = vd0D => (vd0D * K.A2 * 3.19 * 3.19) / K.A1;   // V d0/D -> W0 per tau0

/** a no-flow run whose west tip moves at speed(k) (V d0/D) during the chunk ending at sample k */
function synthRun(g, speed, { stopAt = null, samples = 81, flowOn = false } = {}) {
  let x = g.seedX - g.staging.seedRCells - 25;
  const trace = [];
  for (let k = 0; k < samples; k++) {
    if (k > 0) x -= (toV(speed(k)) * DT_CHUNK) / 0.8;
    trace.push({ k, t: (k + 1) * DT_CHUNK, xWest: x, xEast: 2 * g.seedX - x, delivered: g.chunk, ms: 1 });
  }
  let stopped = false;
  if (stopAt != null) { trace.length = stopAt + 1; trace[stopAt].xWest = K.STOP_CELLS - 4; stopped = true; }
  return { kind: "noflow", scale: null, trace, stopped, flowLost: false, flowOnDuring: flowOn, finished: true, probe: [],
    setup: { n: g.n, flowOn: false, flowCfg: { u: 0.02, pr: 23.1, scale: 1 } },
    summary: T2.summarizeRun(trace, g.lambda, 0.8), end: { yN: null, yS: null, mirror: 0, nonFinite: 0, asymPhi: { max: 0 }, asymT: { max: 0 }, vel: null } };
}

const armOf = (g, run) => ({ id: g.id, n: g.n, seedX: g.seedX, seedY: g.seedY, lambda: g.lambda, dx: 0.8, sideW0: g.sideW0, boxD0: g.boxD0,
  chunk: g.chunk, chunks: g.chunks, substeps: g.substeps, replica: !!g.replica, runs: run ? { noflow: run } : {}, errors: [] });

/** N1024 as tong3's recorded P768 no-flow trace for the first 33 samples, then `tail`;
 *  N2048 given its own speed function (or a run object, or skipped) */
function world(geos, { tail = () => 0.0161, n2048 = k => (k <= 32 ? null : 0.0161), n1024 = null, served = true } = {}) {
  const [a, b] = geos;
  const first = P768NF.trace.map(p => ({ ...p, xWest: p.xWest - 256, xEast: p.xEast == null ? null : p.xEast - 256 }));   // the same tip, seed at 512
  const extend = (base, sp, g) => {
    const tr = base.map(p => ({ ...p }));
    for (let k = tr.length; k < 81; k++) tr.push({ k, t: (k + 1) * DT_CHUNK, xWest: tr[k - 1].xWest - (toV(sp(k)) * DT_CHUNK) / 0.8, xEast: null, delivered: g.chunk, ms: 1 });
    return tr;
  };
  const runA = n1024 ?? (() => { const r = synthRun(a, () => 0.0161); r.trace = extend(first, tail, a); r.summary = T2.summarizeRun(r.trace, a.lambda, 0.8); return r; })();
  let runB = null;
  if (typeof n2048 === "function") { runB = synthRun(b, () => 0.0161); runB.trace = extend(first.map(p => ({ ...p, xWest: p.xWest + 512 })), k => n2048(k) ?? tail(k), b); runB.summary = T2.summarizeRun(runB.trace, b.lambda, 0.8); }
  else if (n2048 && typeof n2048 === "object") runB = n2048;
  const arms = [armOf(a, runA), ...(n2048 === "skip" ? [] : [armOf(b, runB)])];
  return { d: decide(assess(arms, served)), arms };
}

function replica(geos) {
  const [a] = geos;
  const w = prefixes(P768NF.trace, 3.19, 0.8)[0];
  // the recorded constants are the JSON's own doubles, and the arithmetic reproduces them exactly
  const exact = w.vd0D === P768NF.summary.vd0D && w.s === P768NF.summary.stationarity && PROTOCOL.replica.vd0D === P768NF.summary.vd0D
    && PROTOCOL.replica.s === P768NF.summary.stationarity;
  // amendment item 1: the quoted 0.0162725 sits 2.6e-6 from the recorded value, outside 1e-6
  const quotedGap = Math.abs(PROTOCOL.replica.quotedVd0D / P768NF.summary.vd0D - 1);
  const p512 = TONG3.arms.find(x => x.id === "P512").runs.noflow.summary;
  const pass = world(geos).arms[0];
  const nudge = f => { const r = synthRun(a, () => 0.0161); r.trace = P768NF.trace.map(p => ({ ...p, xWest: p.xWest - 256 })); f(r.trace);
    for (let k = 33; k < 81; k++) r.trace.push({ k, t: (k + 1) * DT_CHUNK, xWest: r.trace[k - 1].xWest - 4.6, xEast: null, delivered: 671, ms: 1 });
    r.summary = T2.summarizeRun(r.trace, a.lambda, 0.8); return world(geos, { n1024: r }).arms[0]; };
  // scale every displacement of the first 33 samples: V moves by the factor exactly, s does not
  const scaled = f => nudge(tr => { const x0 = tr[0].xWest; for (const p of tr.slice(0, 33)) p.xWest = x0 + (p.xWest - x0) * f; });
  const vOut = scaled(1 + 2e-6), vIn = scaled(1 + 5e-7);
  // bend the middle third: s moves, V (the last third) does not
  const bend = d => nudge(tr => { for (let k = 11; k < 22; k++) tr[k].xWest -= d * (k - 10); });
  const sOut = bend(0.01), sIn = bend(0.0002);
  const ok = exact && quotedGap > RULES.replicaRel && quotedGap < 3e-6 && Math.abs(p512.vd0D / PROTOCOL.replica.vd0D - 1) < RULES.replicaRel
    && pass.replicaCheck.ok && Math.abs(pass.replicaCheck.relV) < 1e-12 && pass.valid
    && !vOut.replicaCheck.ok && !vOut.valid && /replica missed/.test(vOut.invalidBy.join()) && vIn.replicaCheck.ok
    && !sOut.replicaCheck.ok && Math.abs(sOut.replicaCheck.pointsS) > 0.01 && Math.abs(sOut.replicaCheck.relV) < 1e-12
    && sIn.replicaCheck.ok && Math.abs(sIn.replicaCheck.pointsS) > 0.001 && Math.abs(sIn.replicaCheck.pointsS) < 0.01
    && Math.abs(vOut.replicaCheck.pointsS) < 1e-9 && Math.abs(vIn.replicaCheck.relV - 5e-7) < 1e-9;
  check("REPLICA", ok, { recorded: P768NF.summary.vd0D, quotedGapRel: quotedGap, p512Rel: p512.vd0D / PROTOCOL.replica.vd0D - 1,
    vOut: vOut.replicaCheck.relV, sOutPoints: sOut.replicaCheck.pointsS, sInPoints: sIn.replicaCheck.pointsS });
}

function prefixStatistic(geos) {
  const a = { ...geos[0], replica: false };   // the replica clause is tested on its own
  const steady = assess([armOf(a, synthRun(a, () => 0.0165))], true).N1024;
  const drifting = assess([armOf(a, synthRun(a, k => 0.0172 - 0.00003 * k))], true).N1024;
  const late = assess([armOf(a, synthRun(a, k => 0.0172 - 0.00004 * Math.min(k, 40)))], true).N1024;
  const stopped = assess([armOf(a, synthRun(a, () => 0.0165, { stopAt: 60 }))], true).N1024;
  const sm = x => x.windows.map(w => (w.available ? +(100 * w.s).toFixed(3) : null));
  // the explicit edges of the label rule (|s| <= 0.02, m* = the smallest m with it and every larger window)
  const L = ss => label(PROTOCOL.windows.map((m, i) => ({ m, available: ss[i] != null, s: ss[i], vd0D: 0.016 })));
  const e = {
    allSteady: L([0.01, 0.01, 0.01, 0.01, 0.01]).mStar === 33, nonMonotone: L([0.03, 0.01, 0.03, 0.01, 0.01]).mStar === 69,
    onlyLast: L([0.05, 0.05, 0.05, 0.05, 0.02]).mStar === 81 && L([0.05, 0.05, 0.05, 0.05, 0.02]).label === "STEADY",
    over: L([0.01, 0.01, 0.01, 0.01, 0.0201]).label === "DRIFTING", overNeg: L([0, 0, 0, 0, -0.0201]).label === "DRIFTING",
    negEdge: L([0, 0, 0, 0, -0.02]).label === "STEADY", missing81: L([0.01, 0.01, 0.01, 0.01, null]).label === null,
  };
  const w = steady.windows;
  const ok = steady.decision.label === "STEADY" && steady.decision.mStar === 33 && w.every(x => Math.abs(x.s) < 1e-9)
    && JSON.stringify(w.map(x => [x.windowSamples, x.midSamples])) === JSON.stringify([[[22, 32], [11, 21]], [[30, 44], [15, 29]], [[38, 56], [19, 37]], [[46, 68], [23, 45]], [[54, 80], [27, 53]]])
    && rel(w[4].vd0D, 0.0165) < 1e-9 && rel(w[4].tauVW, toV(0.0165)) < 1e-9
    && drifting.decision.label === "DRIFTING" && drifting.decision.mStar === null && rel(drifting.perChunk.driftPerChunk, -0.00003) < 1e-6
    && drifting.perChunk.firstBelowExact === 7 && drifting.valid
    && late.decision.label === "STEADY" && late.decision.mStar === 69 && Math.abs(late.windows[2].s) > 0.02 && Math.abs(late.windows[3].s) <= 0.02
    && !stopped.valid && stopped.invalidBy.join() === "stop rule" && stopped.decision.label === null && !stopped.windows[4].available
    && Object.values(e).every(Boolean);
  check("PREFIX", ok, { steady: sm(steady), drifting: sm(drifting), late: sm(late), lateMStar: late.decision.mStar, drift: drifting.perChunk.driftPerChunk,
    edges: Object.entries(e).filter(([, v]) => !v).map(([k]) => k) });
}

function boxAndRstar(geos) {
  const [, b] = geos;
  const edges = {
    in: boxRule(0.005, 0.005) === "BOX-INDEPENDENT", inNeg: boxRule(-0.005, -0.005) === "BOX-INDEPENDENT",
    vOver: boxRule(0.0051, 0) === "UNRESOLVED", sOver: boxRule(0, 0.0051) === "UNRESOLVED", dEdge: boxRule(0.02, 0.02) === "UNRESOLVED",
    vDep: boxRule(0.0201, 0) === "BOX-DEPENDENT", sDep: boxRule(0, -0.0201) === "BOX-DEPENDENT", nan: boxRule(NaN, 0) === "NOT TESTED",
  };
  const r = {
    steadySame: world(geos, { tail: () => 0.0161 }), // N1024 drifts -4.45 % in its first 33; the tail steadies it by window 81?
    flat: world(geos, { tail: () => 0.0161, n2048: () => null }),
    dep: world(geos, { n2048: k => (k <= 32 ? null : 0.0161 * 0.95) }),
    unres: world(geos, { n2048: k => (k <= 32 ? null : 0.0161 * 0.99) }),
    noN2048: world(geos, { n2048: "skip" }),
    n2048Stopped: world(geos, { n2048: synthRun(b, () => 0.0161, { stopAt: 70 }) }),
    drifting: world(geos, { tail: k => 0.0161 - 0.00005 * (k - 32), n2048: () => null }),
    replicaMiss: world(geos, { n1024: (() => { const g = geos[0], x = synthRun(g, () => 0.0161); return x; })() }),
    flowOn: world(geos, { n1024: (() => { const x = synthRun(geos[0], () => 0.0161, { flowOn: true }); return x; })() }),
  };
  const R = x => x.d.Rstar;
  const v81 = x => x.arms[0].windows[4].vd0D;
  const ok = Object.values(edges).every(Boolean)
    && r.steadySame.d.N1024.label === "STEADY" && r.steadySame.d.box.verdict === "BOX-INDEPENDENT" && Math.abs(r.steadySame.d.box.dV) < 1e-12
    && R(r.steadySame) && rel(R(r.steadySame).R, 0.021946 / v81(r.steadySame)) < 1e-15 && R(r.steadySame).inBand === (R(r.steadySame).R >= 1.26 && R(r.steadySame).R <= 1.54)
    && Math.abs(R(r.steadySame).vsTong.diff - (R(r.steadySame).R - 1.372)) < 1e-15
    && r.dep.d.box.verdict === "BOX-DEPENDENT" && r.unres.d.box.verdict === "UNRESOLVED"
    && r.noN2048.d.box.verdict === "NOT TESTED" && /N2048 not run/.test(r.noN2048.d.box.why) && R(r.noN2048) != null
    && r.n2048Stopped.d.box.verdict === "NOT TESTED" && /N2048 invalid/.test(r.n2048Stopped.d.box.why)
    && r.drifting.d.N1024.label === "DRIFTING" && R(r.drifting) === null && /DRIFTING/.test(r.drifting.d.RstarWhy)
    && r.replicaMiss.d.N1024.label === "STEADY" && !r.replicaMiss.d.N1024.valid && R(r.replicaMiss) === null && /invalid/.test(r.replicaMiss.d.RstarWhy)
    && r.replicaMiss.d.box.verdict === "NOT TESTED"
    && !r.flowOn.d.N1024.valid && /flow on during the run/.test(r.flowOn.d.N1024.invalidBy.join())
    // tong3's verdict: only the constant string, whatever the world
    && Object.values(r).every(x => x.d.tong3 === PROTOCOL.tong3Verdict && !("verdict" in x.d))
    && JSON.stringify(Object.keys(r.steadySame.d)) === JSON.stringify(["N1024", "N2048", "box", "Rstar", "RstarWhy", "tong3"]);
  check("BOX-RSTAR", ok, { edges: Object.entries(edges).filter(([, v]) => !v).map(([k]) => k),
    worlds: Object.fromEntries(Object.entries(r).map(([k, x]) => [k, `${x.d.N1024.label}${x.d.N1024.valid ? "" : "(invalid)"} / ${x.d.N2048.label} / ${x.d.box.verdict} / R* ${x.d.Rstar ? x.d.Rstar.R.toFixed(4) : "-"}`])),
    s1024: r.steadySame.d.N1024.s });
}

function probe() {
  const row = Array.from({ length: 100 }, (_, i) => 0.45 + 0.001 * i);
  const ps = probeSample(row, 90.25, [10.5, 20.25, 80.5]);
  const ok = Math.abs(uAt(row, 10.5) - (0.45 + 0.0105 - 1)) < 1e-12 && uAt(row, 0) === row[0] - 1 && uAt(row, 99) === row[99] - 1
    && uAt(row, -0.1) === null && uAt(row, 99.01) === null && uAt(row, NaN) === null
    && Math.abs(ps.u2 - (0.45 + 0.001 * 79.75 - 1)) < 1e-12 && Math.abs(ps.u4 - (0.45 + 0.07 - 1)) < 1e-12 && Math.abs(ps.u8 - (0.45 + 0.00975 - 1)) < 1e-12
    && JSON.stringify(Object.keys(ps)) === '["u2","u4","u8"]' && PROTOCOL.probeFarU === -0.55;
  check("PROBE", ok, ps);
}

// ---- D3.4's in-page driver against a mock app ------------------------------------

function mockEnvironment({ v0 = 0.12, failAtRead = null, failProbe = false, served = null, importThrows = [], fetchStatus = 200 } = {}) {
  const STEP = () => 7;
  const device = {
    adapterInfo: { vendor: "mock", architecture: "cpu", device: "", description: "flow-noflow-d2 self-test", isFallbackAdapter: false },
    limits: {}, addEventListener() {}, lost: new Promise(() => {}),
    queue: { submit() {}, async onSubmittedWorkDone() {} },
    createBuffer({ size }) { const data = new Float32Array(size / 4); return { data, async mapAsync() {}, getMappedRange: () => data.buffer, unmap() {}, destroy() {} }; },
    createCommandEncoder() { return { copyTextureToBuffer(src, dst) { src.texture.fillInto(dst.buffer.data); }, finish: () => ({}) }; },
  };
  const log = { grids: [], stagedFlows: [], stages: 0, seeds: [], params: [] };
  const makeSim = n => {
    let reads = 0;
    return {
      n, device, params: {}, flowCfg: { u: 0.02, pr: 23.1, scale: 1 }, flowOn: false, flowVelocity: null, t: 0, seed: null, step: STEP,
      setFlow(on) { this.flowOn = !!on; if (on) log.stagedFlows.push(n); return null; },
      reset() { log.stages++; log.params.push({ n, dx: this.params.dx, dt: this.params.dt }); this.t = 0; this.seed = null; },
      addSeed(x, y, r) { this.seed = { x, y, r }; log.seeds.push([n, x, y, r]); },
      async stepSync(k) { this.t += k * this.params.dt; return k; },
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
      async readRows(y0, h) {
        reads++;
        if (failAtRead != null && reads === failAtRead) return null;
        const tp = this.tips(), out = new Float32Array(h * n * 4);
        for (let r = 0; r < h; r++) for (let i = 0; i < n; i++) { const o = (r * n + i) * 4; out[o] = this.phiAt(i, y0 + r, tp); out[o + 1] = this.tAt(i, tp); }
        return out;
      },
    };
  };
  let sim = makeSim(1024);
  const S = { app: { setRun() {}, setGrid(n) { log.grids.push(n); sim = makeSim(n); }, setInoculant() {} }, sim: () => sim, seed: () => 42 };
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const texts = served ?? Object.fromEntries(SERVED.map(p => [p, `// ${p}\nexport const x = 1;\n`]));
  const ctx = {
    errors: [], rawDir: null,
    async open() {
      globalThis.window = { __solidify: S, __fdImport: async p => {
        if (p.endsWith("?raw")) { const path = p.slice(1, -4); if (importThrows.includes(path)) throw new SyntaxError(`Unexpected identifier (mock ${path})`); return { default: texts[path] }; }
        return { FLUX_WGSL: "f", PHI_WGSL: "p", TRANSPORT_WGSL: "t", STAMP_WGSL: "s", UPDATE_WGSL: "u", STATS_WGSL: "x" };
      } };
      globalThis.fetch = async url => { const path = String(url).slice(1, -4); return { ok: fetchStatus === 200, status: fetchStatus, text: async () => texts[path] }; };
      globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
      globalThis.GPUBufferUsage = { COPY_DST: 8, MAP_READ: 1 };
      globalThis.GPUMapMode = { READ: 1 };
      const page = { evaluate: async (fn, arg) => clone(await fn(clone(arg))), close: async () => {} };
      await page.evaluate(installDriver, HELPER_SRC);
      await page.evaluate(installProbe);
      if (failProbe) window.__nd2probe = { async tRow() { throw new Error("probe: readRows failed"); } };
      return page;
    },
  };
  const disk = Object.fromEntries(SERVED.map(p => [p, T2.hashText(`// ${p}\r\nexport const x = 1;\r\n`)]));
  ctx.admit = m => { const x = T2.admission(m, disk); if (!x.ok) throw new Error(`not admitted: ${x.why}`); return x; };
  return { ctx, S, STEP, log, texts };
}

const restored = env => { const s = env.S.sim(); return s.step === env.STEP && !s.flowOn; };

async function mockRun(geos) {
  const [a, b] = geos;
  const env = mockEnvironment();
  const rows = [await runArm(env.ctx, a)];
  const r1 = restored(env);
  rows.push(await runArm(env.ctx, b));
  const byId = assess(rows, true), A = byId.N1024, B = byId.N2048, d = decide(byId);
  const pr = A.runs.noflow.probe.at(-1), xw = A.runs.noflow.trace.at(-1).xWest;
  const want = k => 0.45 + 0.2 * Math.exp(-(k * a.staging.lD / 0.8) / 20) - 1;
  const ok = r1 && restored(env) && rows.every(r => !r.exception)
    && JSON.stringify(env.log.grids) === "[2048]" && env.log.stagedFlows.length === 0
    && JSON.stringify(env.log.seeds) === JSON.stringify([[1024, 512, 512, 10], [2048, 1024, 1024, 10]])
    && env.log.params.every(p => p.dx === 0.8 && p.dt === a.staging.dt)
    && A.runs.noflow.trace.length === 81 && A.runs.noflow.trace.every(p => p.delivered === 671) && B.runs.noflow.trace.length === 81
    && rows[1].gridAccepted.staged === 2048 && rows[1].gridAccepted.flowOn === false && rows[1].gridAccepted.delivered === 54351
    && A.runs.noflow.probe.length === 81 && A.runs.noflow.probeMatchesEnd === true && B.runs.noflow.probeMatchesEnd === true
    && Math.abs(pr.u2 - want(2)) < 1e-4 && Math.abs(pr.u4 - want(4)) < 1e-4 && (xw - a.probeCells[2] < 0 ? pr.u8 === null : Math.abs(pr.u8 - want(8)) < 1e-4)
    // the mock's speed is not tong3's, so N1024 misses the replica (and only that); N2048 is valid and steady
    && !A.valid && A.invalidBy.length === 1 && /replica missed/.test(A.invalidBy[0]) && B.valid && B.decision.label === "STEADY" && B.decision.mStar === 33
    && rel(B.windows[4].vd0D, (0.12 * K.A1) / (K.A2 * 3.19 * 3.19)) < 1e-6 && d.Rstar === null && d.box.verdict === "NOT TESTED"
    && rows[0].admission.ok;
  check("MOCK-RUN", ok, { samples: [A.runs.noflow.trace.length, B.runs.noflow.trace.length], grids: env.log.grids, probe: pr, xWest: xw, invalidBy: A.invalidBy, box: d.box.verdict });

  // the stop rule, a failed readback, and a failing probe (never gating)
  const fast = mockEnvironment({ v0: 0.3 });
  const sRow = await runArm(fast.ctx, a), sA = assess([sRow], true).N1024;
  const broken = mockEnvironment({ failAtRead: 9 });
  const bRow = await runArm(broken.ctx, b), bA = assess([bRow], true).N2048;
  const noProbe = mockEnvironment({ failProbe: true });
  const pRow = await runArm(noProbe.ctx, b), pA = assess([pRow], true).N2048;
  const st = sRow.runs.noflow.trace;
  const okFail = sRow.runs.noflow.stopped && st.length < 81 && Number.isFinite(st.at(-1).xWest) && st.at(-1).xWest <= K.STOP_CELLS && st.at(-2).xWest > K.STOP_CELLS && !sA.valid && /stop rule/.test(sA.invalidBy.join()) && restored(fast)
    && !!bRow.exception && /readRows failed/.test(bRow.exception) && restored(broken) && !bA.valid
    && /probe: readRows failed/.test(pRow.runs.noflow.probeError) && pA.valid && pRow.runs.noflow.probe.length === 0;
  check("MOCK-FAILURES", okFail, { stoppedAt: sRow.runs.noflow.trace.length, brokenException: String(bRow.exception).split("\n")[0], probeError: pRow.runs.noflow.probeError });
}

async function admissionCheck(geos) {
  const g = geos[1];
  const lf = Object.fromEntries(SERVED.map(p => [p, `// ${p}\nexport const x = 1;\n`]));
  const attempt = async opts => { const env = mockEnvironment(opts); const row = await runArm(env.ctx, g); return { row, stepped: env.log.stages > 0 || env.log.grids.length > 0 }; };
  const same = await attempt({ served: lf });
  const viaFetch = await attempt({ served: lf, importThrows: ["src/main.ts"] });
  const changed = await attempt({ served: { ...lf, "src/sim.ts": lf["src/sim.ts"].replace("x = 1", "x = 2") } });
  const refused = x => /not admitted/.test(x.row.exception ?? "") && Object.keys(x.row.runs).length === 0 && !x.stepped;
  const ok = !same.row.exception && same.stepped && same.row.admission.ok && viaFetch.row.admission?.vehicles["src/main.ts"] === "fetch"
    && refused(changed) && /served source differs: src\/sim.ts/.test(changed.row.exception) && !assess([changed.row], false).N2048.valid;
  check("ADMISSION", ok, { refusedWith: String(changed.row.exception).split("\n")[0] });
}

// ---- the real Simulation at n 1024 and 2048 with flow off, on a recording device ----

/** WebGPU's default limits (the app requests none: main.ts requestDevice names features only) */
const DEFAULT_LIMITS = { maxTextureDimension2D: 8192, maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 };

function recordingDevice() {
  const log = { textures: [], buffers: [], dispatches: [], copies: [] };
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
        beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(x, y = 1) { log.dispatches.push(`${x}x${y}`); }, end() {} }; },
        copyTextureToBuffer(src, dst, size) { log.copies.push({ bpr: dst.bytesPerRow, w: size.width ?? size[0] }); },
        copyBufferToBuffer() {}, clearBuffer() {}, finish() { return {}; },
      };
    },
    queue: { writeBuffer() {}, writeTexture() {}, submit() {}, async onSubmittedWorkDone() {} },
  };
  return { device, log };
}

async function simulationAccepts(geos) {
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
    const F = await server.ssrLoadModule("/src/flow.ts");
    // flowRefusal's grid clause is a FLOW refusal (grid > 1024); a no-flow run never asks it
    if (F.flowRefusal({ dim3: false, scenario: 0, frozenTemperature: false, alloy: false, calibrated: true, grid: 2048, busyMode: null }) == null) bad.push("flowRefusal(2048) is null");
    // source pins for what this check cannot load: the UI offers 2048, setGrid/swapSim are unbounded, the device takes default limits
    const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const main = read("src/main.ts"), ui = read("src/ui.ts");
    const at = main.indexOf("    swapSim(n) {"), swap = at < 0 ? "" : main.slice(at, main.indexOf("\n    },", at));
    const pins = {
      uiOffers2048: ui.includes("for (const n of [512, 1024, 2048]) {"),
      setGrid: main.includes("    setGrid(n) { if (n !== sim.n && !opt.active && !opt3?.active && !challenge.active && !heat?.busy) app.swapSim(n); },"),
      swapSim: swap.includes("      sim = new Simulation(device, n);") && !/Math\.(max|min)|throw|[<>]=? *\d/.test(swap),
      defaultLimits: /requestDevice\(\{\s*requiredFeatures:[^}]*\}\);/.test(main) && !main.includes("requiredLimits"),
      flowOnlyCheck: main.includes("      if (sim.flowOn) {\n        const why = flowWhyNot() ?? sim.flowLimitIssue;"),
    };
    for (const [k, v] of Object.entries(pins)) if (!v) bad.push(`source pin ${k} changed since the n 2048 reading: re-read it`);
    for (const g of geos) {
      const s = g.staging, { device, log } = recordingDevice();
      let sim = new Simulation(device, 1024), setFlowOn = 0;
      const S = { app: { setRun() {}, setGrid(n) { sim = new Simulation(device, n); }, setInoculant() {} }, sim: () => sim, seed: () => 0 };
      globalThis.window = { __solidify: S };
      installDriver(HELPER_SRC);
      installProbe();
      const cfg = { lambda: g.lambda, n: g.n, seedX: g.seedX, seedY: g.seedY, dx: s.dx, dt: s.dt, dTilde: s.dTilde, eps4: K.EPS4,
        delta: K.DELTA, uLat: s.uLat, pr: K.PR, seedR: s.seedRCells, flow: null };
      const st = await window.__fd.stage(cfg);
      const orig = S.sim().setFlow.bind(S.sim());
      S.sim().setFlow = on => { if (on) setFlowOn++; return orig(on); };
      log.dispatches.length = 0; log.copies.length = 0;
      const adv = await window.__fd.advance(s.chunk);
      const tRow = await window.__nd2probe.tRow(g.seedY);
      const e = await window.__fd.end(g.seedX - 20);
      const fin = await window.__fd.finish();
      const wg = Math.ceil(g.n / 8);
      const big = log.buffers.filter(x => x.size > DEFAULT_LIMITS.maxBufferSize || ((x.usage & 128) && x.size > DEFAULT_LIMITS.maxStorageBufferBindingSize));
      const k = { n: st.n, flowOn: st.flowOn, delivered: adv.got, row: adv.row.length, tRow: tRow.length, column: e.column.length, vel: e.vel, fin,
        dispatchOk: log.dispatches.length > 0 && log.dispatches.every(x => x === `${wg}x${wg}`) && wg <= DEFAULT_LIMITS.maxComputeWorkgroupsPerDimension,
        copyOk: log.copies.length > 0 && log.copies.every(c => c.bpr % 256 === 0 && c.w === g.n),
        texturesOk: log.textures.every(([w, h]) => w <= DEFAULT_LIMITS.maxTextureDimension2D && h <= DEFAULT_LIMITS.maxTextureDimension2D),
        largestBuffer: Math.max(...log.buffers.map(x => x.size)), overLimit: big.length, setFlowOn };
      if (!(k.n === g.n && k.flowOn === false && k.delivered === s.chunk && k.row === g.n && k.tRow === g.n && k.column === g.n && k.vel === null && k.fin === true
        && k.dispatchOk && k.copyOk && k.texturesOk && k.overLimit === 0 && k.setFlowOn === 0 && S.sim().step === Simulation.prototype.step)) bad.push(`${g.id}: ${JSON.stringify(k)}`);
      detail[g.id] = { n: g.n, wg, largestBufferMiB: +(k.largestBuffer / 2 ** 20).toFixed(1), stateTextureMiB: (g.n * g.n * 16) / 2 ** 20 };
    }
  } catch (e) { bad.push(String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); }
  finally {
    await server.close();
    Object.assign(globalThis, { window: saved.window, requestAnimationFrame: saved.raf, GPUTextureUsage: saved.tu, GPUBufferUsage: saved.bu, GPUShaderStage: saved.ss, GPUMapMode: saved.mm });
  }
  check("SIM-ACCEPTS-2048", bad.length === 0, { bad, ...detail });
}

export async function selfTest() {
  const fetchSaved = globalThis.fetch, windowSaved = globalThis.window;
  const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, { threw: String(e?.message ?? e).split("\n")[0] }); } };
  protocol();
  frozen();
  const geos = parsing();
  await guard("RUN-LENGTH", () => runLength(geos));
  await guard("REPLICA", () => replica(geos));
  await guard("PREFIX", () => prefixStatistic(geos));
  await guard("BOX-RSTAR", () => boxAndRstar(geos));
  await guard("PROBE", () => probe());
  await guard("MOCK", () => mockRun(geos));
  await guard("ADMISSION", () => admissionCheck(geos));
  await guard("SIM-ACCEPTS-2048", () => simulationAccepts(geos));
  check("RULES-FROZEN", Object.isFrozen(RULES) && Object.isFrozen(PROTOCOL) && Object.isFrozen(PROTOCOL.arms[1]) && Object.isFrozen(PROTOCOL.replica)
    && RULES.replicaRel === 1e-6 && RULES.replicaPoints === 0.0001 && RULES.steadyMax === 0.02 && RULES.boxIndependentV === 0.005
    && RULES.boxIndependentS === 0.005 && RULES.boxDependent === 0.02 && RULES.rLo === 1.26 && RULES.rHi === 1.54
    && PROTOCOL.flowVd0D === 0.021946 && PROTOCOL.chunks === 81 && PROTOCOL.chunk === 671 && JSON.stringify(PROTOCOL.windows) === "[33,45,57,69,81]", {});
  globalThis.fetch = fetchSaved;
  globalThis.window = windowSaved;
  console.log(`ND2-SELFTEST ${failures ? `FAILED (${failures})` : "PASSED"} (CPU only; no browser, no GPU)`);
  return failures === 0;
}
