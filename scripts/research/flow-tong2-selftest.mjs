// Browser-free self-test for scripts/research/flow-tong2.mjs (the next Tong
// comparison). Never launches Chrome or touches a GPU. Checks: the protocol and
// its amendment at the pinned commit (the original pre-registered text kept
// verbatim); the arm file and its refusals; the window and substep table
// recomputed from the formula (and values computed independently in Python);
// the statistic; the verdict code on synthetic traces (pass, each clause's miss,
// non-stationary, information-only, too few valid rows, the stop rule, the inlet
// liveness, the falsification arms and their negative controls); D3.4's in-page
// driver end to end against a mock app; the served-source admission; and the
// real Simulation (src/sim.ts, loaded through Vite's module runner, no server
// port) driven by the real in-page driver on a recording GPU device at every
// grid the comparison stages, n 160 included.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  PROTOCOL_COMMIT, PROTOCOL_HEADER, AMENDMENT_HEADER, D35_PASSED_COMMIT, REPO, K, RULES, PROTOCOL, COST, SCALE,
  staging, geometry, parseArms, summarizeRun, runArm, admission, hashText, assess, falsification, tierVerdict, decide, SERVED,
} from "./flow-tong2.mjs";
import { HELPER_SRC, installDriver } from "./flow-domain.mjs";

/** the commit that first recorded the protocol (before any amendment) */
const ORIGINAL_PROTOCOL_COMMIT = "79b0b0048639c8d0536a42d9465c7f452c820ea9";

let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log(`T2-SELFTEST-${name}`, ok ? "OK" : "FAIL", JSON.stringify(detail ?? {})); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20, cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
const ARMS = JSON.parse(readFileSync(new URL("./flow-tong2-arms.json", import.meta.url), "utf8"));
const norm = s => s.replace(/\s+/g, " ");
const section = text => { const i = text.indexOf(PROTOCOL_HEADER); if (i < 0) return null; const j = text.indexOf("\n## ", i); return text.slice(i, j < 0 ? undefined : j); };

function protocol() {
  let ok = true, detail = {};
  try {
    git(["cat-file", "-e", `${PROTOCOL_COMMIT}^{commit}`]);
    git(["merge-base", "--is-ancestor", PROTOCOL_COMMIT, "HEAD"]);
    git(["merge-base", "--is-ancestor", ORIGINAL_PROTOCOL_COMMIT, PROTOCOL_COMMIT]);
    git(["merge-base", "--is-ancestor", D35_PASSED_COMMIT, "HEAD"]);
    const amended = section(git(["show", `${PROTOCOL_COMMIT}:tasks/todo.md`]));
    const original = section(git(["show", `${ORIGINAL_PROTOCOL_COMMIT}:tasks/todo.md`]));
    const sec = norm(amended ?? "");
    const quoted = [
      "D2 17919 (543 x 33) / 71709 (2173 x 33); D3 6138 / 24618; D4-921 990 / 3993; D4-1658 3894 / 15576; D4-3315 5544 / n/a",
      "n 512 / 320 / 160 / 288 / 576 (1478 / 1387 / 924 / 1663 / 3326 d0)", "n 1024 / 640 / 320 / 576 for the first four rows",
      "D2 = 3.19 (box 1479 d0, Tong V d0/D 0.0247), D3 = 4.79 (1384 d0, 0.0248), D4 = 6.38 at 921 / 1658 / 3315 d0 (0.0265 / 0.0240 / 0.0244)",
      "1.372 / 1.417 / 1.550, 1.404, 1.427", "409.6 / 256 / 128 / 230.4 / 460.8", "T is 6.5 / 5.0 / 1.4 / 5.6 / 8.0 l_D",
      "T = min(8 l_D / V_KR, s / (1.5 V_KR)), s = side/2 - 8 - 38.4 W0", "V_KR = 0.017 D~ lambda / a1 W0 per tau0",
      "west tip within 32 cells of x = 0", "R in [1.26, 1.54]", "< 5 % of their mean", "|V d0/D / V_Tong(row) - 1| <= 0.10",
      "|v_last / v_mid - 1| <= 0.02 in BOTH runs", "within 1e-4 of 1", "fewer than two valid rows has no verdict",
      "coupling 0 must give R exactly 1 (traces equal) and fail; coupling -1 must give R < 1 and fail",
    ];
    detail = {
      header: amended != null, amendment: sec.includes(AMENDMENT_HEADER), originalKeptVerbatim: !!original && amended.startsWith(original.trimEnd()),
      missingQuotes: quoted.filter(q => !sec.includes(q)), armsCommit: ARMS.protocolCommit === PROTOCOL_COMMIT,
    };
    ok = detail.header && detail.amendment && detail.originalKeptVerbatim && detail.missingQuotes.length === 0 && detail.armsCommit;
  } catch (e) { ok = false; detail.error = String(e.message).split("\n")[0]; }
  let srcAsD35 = true;
  try { git(["diff", "--quiet", D35_PASSED_COMMIT, "HEAD", "--", "src"]); } catch { srcAsD35 = false; }
  check("PROTOCOL", ok, { commit: PROTOCOL_COMMIT.slice(0, 7), original: ORIGINAL_PROTOCOL_COMMIT.slice(0, 7), ...detail, srcAsD35PassedHead: srcAsD35 });
}

function parsing() {
  let geos, parseError = null;
  try { geos = parseArms(ARMS); }
  catch (e) {
    // keep going on the unvalidated arms so the other checks still report
    parseError = String(e.message);
    geos = ARMS.arms.map(a => geometry(a, { id: a.row, ...PROTOCOL.rows[a.row] }));
  }
  const ids = geos.map(g => g.id);
  const want = ["D2-P", "D3-P", "D4-1658-P", "D4-3315-P", "D4-921-P", "D2-T", "D3-T", "D4-1658-T", "D4-921-T"];
  const mutate = f => { const j = JSON.parse(JSON.stringify(ARMS)); f(j); return () => parseArms(j); };
  const arm = (j, id) => j.arms.find(a => a.id === id), row = (j, id) => j.rows.find(r => r.id === id);
  const hostile = {
    tierT3315: throwsWith(mutate(j => { j.arms.push({ id: "D4-3315-T", row: "D4-3315", tier: "T", n: 1152, substeps: 22143 }); }), /over 1024/),
    nNotSide: throwsWith(mutate(j => { arm(j, "D3-P").n = 336; }), /not the side/),
    nNot16: throwsWith(mutate(j => { arm(j, "D3-P").n = 321; }), /multiple of 16/),
    substepsOff: throwsWith(mutate(j => { arm(j, "D2-P").substeps = 17952; }), /not the protocol's/),
    lambdaOff: throwsWith(mutate(j => { row(j, "D2").lambda = 3.2; }), /pre-registered/),
    vTongOff: throwsWith(mutate(j => { row(j, "D4-1658").tongVd0D = 0.0245; }), /pre-registered/),
    infoMoved: throwsWith(mutate(j => { row(j, "D4-921").informationOnly = false; }), /pre-registered/),
    infoAdded: throwsWith(mutate(j => { row(j, "D3").informationOnly = true; }), /pre-registered/),
    falsificationMoved: throwsWith(mutate(j => { arm(j, "D3-P").falsification = true; }), /falsification/),
    falsificationDropped: throwsWith(mutate(j => { delete arm(j, "D2-P").falsification; }), /falsification arm/),
    armMissing: throwsWith(mutate(j => { j.arms = j.arms.filter(a => a.id !== "D3-T"); }), /missing: D3-T/),
    rowMissing: throwsWith(mutate(j => { j.rows = j.rows.filter(r => r.id !== "D3"); }), /rows missing/),
    duplicate: throwsWith(mutate(j => { j.arms.push({ ...arm(j, "D3-P") }); }), /duplicate/),
    unknownKey: throwsWith(mutate(j => { arm(j, "D3-P").noise = 0.1; }), /unknown key/),
    badId: throwsWith(mutate(j => { arm(j, "D3-P").id = "D3P"; }), /row-tier/),
    notRunChanged: throwsWith(mutate(j => { j.notRun = []; }), /notRun/),
    wrongProtocol: throwsWith(mutate(j => { j.protocolCommit = ORIGINAL_PROTOCOL_COMMIT; }), /protocolCommit/),
  };
  const n160 = geos.find(g => g.id === "D4-921-P");
  check("PARSE", parseError === null && JSON.stringify(ids) === JSON.stringify(want) && Object.values(hostile).every(Boolean)
    && geos.filter(g => g.falsification).map(g => g.id).join() === "D2-P" && geos.filter(g => g.informationOnly).map(g => g.id).join() === "D4-921-P,D4-921-T"
    && n160.n === 160, { parseError, ids: ids.length, hostile });
  return geos;
}

/** check (1): the window and every substep count of the protocol's table, from the formula */
function windowTable(geos) {
  // independent values: Python 3 double arithmetic of the protocol's formulas (2026-11-07)
  const py = {
    D2: { T: 860.9482942089047, vKR: 0.1226554494739224, dt: [0.04801985621054306, 0.012004964052635765], uLat: [0.01515782328317683, 0.007578911641588415] },
    D3: { T: 196.70816663884807, vKR: 0.27655181241090626, dt: [0.0319798207331174, 0.00799495518327935], uLat: [0.022760493268469285, 0.011380246634234642] },
    "D4-921": { T: 23.9152303946918, vKR: 0.4906217978956896, dt: [0.02400992810527153, 0.006002482026317883], uLat: [0.03031564656635366, 0.01515782328317683] },
    "D4-1658": { T: 93.48680972470432, vKR: 0.4906217978956896, dt: [0.02400992810527153, 0.006002482026317883], uLat: [0.03031564656635366, 0.01515782328317683] },
    "D4-3315": { T: 132.88522043653344, vKR: 0.4906217978956896, dt: [0.02400992810527153, 0.006002482026317883], uLat: [0.03031564656635366, 0.01515782328317683] },
  };
  const tInLD = { D2: 6.5, D3: 5.0, "D4-921": 1.4, "D4-1658": 5.6, "D4-3315": 8.0 };
  const boxP = { D2: 1478, D3: 1387, "D4-921": 924, "D4-1658": 1663, "D4-3315": 3326 };
  const bad = [], table = {};
  for (const [id, row] of Object.entries(PROTOCOL.rows)) {
    const sP = staging(row.lambda, K.TIERS.P, row.sideW0), sT = staging(row.lambda, K.TIERS.T, row.sideW0);
    table[id] = [`${sP.substeps} (${sP.chunk} x 33)`, `${sT.substeps} (${sT.chunk} x 33)`];
    for (const [i, s] of [sP, sT].entries()) {
      const want = PROTOCOL.substeps[id][i];
      if (want != null && s.substeps !== want) bad.push(`${id}/${"PT"[i]}: ${s.substeps} vs table ${want}`);
      if (s.substeps !== s.chunk * K.NS) bad.push(`${id}/${"PT"[i]}: not 33 equal chunks`);
      const n = row.sideW0 / s.dx;
      if (PROTOCOL.n[id][i] != null && Math.round(n) !== PROTOCOL.n[id][i]) bad.push(`${id}/${"PT"[i]}: n ${n}`);
      for (const [k, got, w, tol] of [["T", s.T, py[id].T, 1e-15], ["vKR", s.vKR, py[id].vKR, 1e-15], ["dt", s.dt, py[id].dt[i], 1e-15], ["uLat", s.uLat, py[id].uLat[i], 1e-15]])
        if (!(rel(got, w) <= tol)) bad.push(`${id}/${"PT"[i]}:${k} ${got} vs ${w}`);
      if (!(s.mach <= 0.1 && s.peCell <= 2 && s.tau >= 0.51 && Math.abs(s.nuLat - 3.465) < 1e-12)) bad.push(`${id}/${"PT"[i]}: outside FLOW_LIMITS`);
    }
    if (sP.T !== sT.T) bad.push(`${id}: the window differs between tiers`);
    if (Math.round(sP.TinLD * 10) / 10 !== tInLD[id]) bad.push(`${id}: T ${sP.TinLD} l_D vs ${tInLD[id]}`);
    if (Math.round(sP.cellD0 * PROTOCOL.n[id][0]) !== boxP[id]) bad.push(`${id}: box ${sP.cellD0 * PROTOCOL.n[id][0]}`);
  }
  // the protocol's own "(543 x 33)" and "(2173 x 33)"; D4-3315-T would need n 1152 (not run)
  const d2 = table.D2.join(" / ") === "17919 (543 x 33) / 71709 (2173 x 33)";
  const t3315 = staging(6.38, K.TIERS.T, 460.8);
  // D3.4's max(50, ...) chunk floor would turn D4-921-P's 990 into 1650: the table has no floor
  const floor = Math.max(50, staging(6.38, 0.8, 128).chunk) * 33;
  const minGap = Math.min(...geos.map(g => g.predictedEndGapCells));
  check("WINDOW", bad.length === 0 && d2 && t3315.substeps === 22143 && 460.8 / 0.4 > K.N_MAX && floor === 1650 && minGap > K.STOP_CELLS,
    { bad, table, d4_3315_T: `${t3315.substeps} (n 1152, not run)`, minPredictedEndGapCells: +minGap.toFixed(1) });
}

function statistic() {
  // tier T (dx 0.4): the west tip runs at 0.1 cells/tau0 through sample 21 and 0.12 from there
  const tk = k => (k + 1) * 75.65, t21 = tk(21);
  const trace = Array.from({ length: 33 }, (_, k) => ({ k, t: tk(k), xEast: 524 + 0.05 * tk(k),
    xWest: k <= 21 ? 500 - 0.1 * tk(k) : 500 - 0.1 * t21 - 0.12 * (tk(k) - t21) }));
  const s = summarizeRun(trace, 3.19, 0.4);
  const ok = s.windowSamples[0] === 22 && s.windowSamples.at(-1) === 32 && s.midSamples[0] === 11 && s.midSamples.at(-1) === 21
    && Math.abs(s.vLast - 0.048) < 1e-12 && Math.abs(s.vMid - 0.04) < 1e-12 && Math.abs(s.stationarity - 0.2) < 1e-9 && Math.abs(s.vEastLast - 0.02) < 1e-12
    && rel(s.vd0D, (0.048 * K.A1) / (K.A2 * 3.19 * 3.19)) < 1e-12 && Math.abs(s.endGapCells - (trace.at(-1).xWest + 0.5)) < 1e-12;
  check("STATISTIC", ok, { vLast: s.vLast, vMid: s.vMid, stationarity: s.stationarity, vd0D: s.vd0D });
}

// ---- synthetic traces through the real assess / decide ----------------------

/** a run whose west tip moves at vA (W0/tau0) through sample 21 and vB after, so
 *  v_mid = vA and v_last = vB exactly; stopAt truncates it at the stop rule */
function synthRun(g, kind, { vA, vB, inletUx = 1, stopAt = null, nudge = 0 }) {
  const s = g.staging, tk = k => (k + 1) * s.chunk * s.dt, t21 = tk(21);
  const x0 = g.seedX - s.seedRCells;
  let trace = Array.from({ length: K.NS }, (_, k) => ({ k, t: tk(k), xEast: g.seedX + s.seedRCells + (vA * tk(k)) / s.dx,
    xWest: k <= 21 ? x0 - (vA * tk(k)) / s.dx : x0 - (vA * t21) / s.dx - (vB * (tk(k) - t21)) / s.dx, delivered: s.chunk, ms: 1 }));
  let stopped = false;
  if (stopAt != null) { trace = trace.slice(0, stopAt + 1); trace[stopAt].xWest = K.STOP_CELLS - 4; stopped = true; }
  if (nudge) trace[trace.length - 1].xWest += nudge;
  const scale = SCALE[kind];
  return { kind, scale, trace, stopped, flowLost: false, finished: true,
    setup: { n: g.n, flowOn: scale !== null, flowCfg: { u: s.uLat, pr: K.PR, scale: scale ?? 1 } },
    summary: summarizeRun(trace, g.lambda, s.dx),
    end: { yN: null, yS: null, mirror: 0, nonFinite: 0, asymPhi: { max: 0 }, asymT: { max: 0 }, vel: scale === null ? null : { inletUx, uxMirrorOverU: 0 } } };
}

/** a world: every arm with flow V d0/D = 1.03 x Tong's and the given R; options per arm */
function world(geos, spec = {}) {
  const R0 = { "D2-P": 1.40, "D3-P": 1.41, "D4-1658-P": 1.42, "D4-3315-P": 1.40, "D4-921-P": 1.55,
    "D2-T": 1.43, "D3-T": 1.42, "D4-1658-T": 1.44, "D4-921-T": 1.52 };
  const arms = [];
  for (const g of geos) {
    const o = { R: R0[g.id], vRatio: 1.03, statNoflow: 0, statFlow: 0, inletUx: 1, ...(spec[g.id] ?? {}) };
    if (o.skip) continue;
    const vFlow = (o.vRatio * g.tongVd0D * K.A2 * g.lambda * g.lambda) / K.A1, vNoflow = vFlow / o.R;
    const runs = {
      noflow: synthRun(g, "noflow", { vA: vNoflow / (1 + o.statNoflow), vB: vNoflow, stopAt: o.stopNoflow ?? null }),
      flow: synthRun(g, "flow", { vA: vFlow / (1 + o.statFlow), vB: vFlow, inletUx: o.inletUx, stopAt: o.stopFlow ?? null }),
    };
    if (g.falsification) {
      const f = { zeroNudge: 0, revR: 0.8, revStat: 0, revInlet: 1, ...(spec.falsification ?? {}) };
      if (!f.missing) {
        runs.zero = structuredClone(runs.noflow);
        Object.assign(runs.zero, { kind: "zero", scale: 0, setup: { ...runs.zero.setup, flowOn: true, flowCfg: { ...runs.zero.setup.flowCfg, scale: 0 } },
          end: { ...runs.zero.end, vel: { inletUx: 1, uxMirrorOverU: 0 } } });
        if (f.zeroNudge) { runs.zero.trace.at(-1).xWest += f.zeroNudge; runs.zero.summary = summarizeRun(runs.zero.trace, g.lambda, g.staging.dx); }
        const vRev = vNoflow * f.revR;
        runs.reversed = synthRun(g, "reversed", { vA: vRev / (1 + f.revStat), vB: vRev, inletUx: f.revInlet });
      }
    }
    arms.push({ id: g.id, row: g.row, tier: g.tier, D: g.D, lambda: g.lambda, n: g.n, dx: g.staging.dx, seedX: g.seedX, seedY: g.seedY,
      sideW0: g.sideW0, boxD0: g.boxD0, tongBoxD0: g.tongBoxD0, tongVd0D: g.tongVd0D, tongRatio: g.tongRatio,
      informationOnly: g.informationOnly, falsification: g.falsification, chunk: g.chunk, substeps: g.substeps, runs, errors: [] });
  }
  return decide(assess(arms, true));
}

/** check (2): the statistic, stationarity and verdict code on synthetic traces */
function verdicts(geos) {
  const w = spec => world(geos, spec);
  const r = {
    pass: w(),
    band: w({ "D2-P": { R: 1.27 }, "D3-P": { R: 1.25 }, "D4-1658-P": { R: 1.28 }, "D4-3315-P": { R: 1.29 } }),
    spread: w({ "D2-P": { R: 1.30 }, "D3-P": { R: 1.45 }, "D4-1658-P": { R: 1.38 }, "D4-3315-P": { R: 1.40 } }),
    vRatio: w({ "D4-1658-P": { vRatio: 1.12 } }),
    nonStationaryFlow: w({ "D3-P": { R: 1.10, statFlow: 0.03 } }),
    nonStationaryNoflow: w({ "D4-3315-P": { R: 1.10, statNoflow: -0.025 } }),
    infoOnly: w({ "D4-921-P": { R: 1.0, vRatio: 1.5 }, "D4-921-T": { R: 2.0, statFlow: 0.3 } }),
    fewValid: w({ "D3-T": { stopFlow: 20 }, "D4-1658-T": { statFlow: -0.05 } }),
    inletDead: w({ "D3-P": { R: 1.10, inletUx: 1.0002 } }),
    inletEdge: w({ "D3-P": { inletUx: 1.00009 } }),
    stationEdge: w({ "D3-P": { statFlow: 0.0199 } }),
    zeroLeak: w({ falsification: { zeroNudge: 1e-6 } }),
    revInBand: w({ falsification: { revR: 1.30 } }),
    revAboveOne: w({ falsification: { revR: 1.05 } }),
    revDeadInlet: w({ falsification: { revInlet: 0.9 } }),
    revNonStationary: w({ falsification: { revStat: 0.2 } }),
    falsMissing: w({ falsification: { missing: true } }),
    noD2P: w({ "D2-P": { skip: true } }),
    rowsFailFalsBroken: w({ "D3-P": { R: 1.10 }, falsification: { revR: 1.30 } }),
  };
  const V = x => `${x.P.verdict}/${x.T.verdict}`;
  const f = r.pass.falsification;
  const ok = {
    pass: V(r.pass) === "PASS/PASS" && r.pass.appMayCallQuantitative && f.ok && f.zero.R === 1 && f.zero.traceEqual && f.zero.bandFails
      && f.reversed.R < 1 && Math.abs(f.reversed.R - 0.8) < 1e-9 && f.reversed.bandFails
      && JSON.stringify(r.pass.P.validRows) === '["D2-P","D3-P","D4-1658-P","D4-3315-P"]' && JSON.stringify(r.pass.T.validRows) === '["D2-T","D3-T","D4-1658-T"]'
      && Math.abs(r.pass.resolution.find(x => x.row === "D2").step - 0.03) < 1e-9 && r.pass.resolution.length === 4
      && Math.abs(r.pass.P.clauses.spread.spread - 0.02 / 1.4075) < 1e-9 && r.pass.P.notRun.length === 0 && r.pass.T.notRun.length === 0
      && Number.isFinite(r.pass.P.rows[0].R) && r.pass.P.information.length === 1,
    band: V(r.band) === "FAIL/PASS" && JSON.stringify(r.band.P.failed) === '["band"]' && r.band.P.clauses.band.miss.join() === "D3-P" && !r.band.appMayCallQuantitative,
    spread: V(r.spread) === "FAIL/PASS" && JSON.stringify(r.spread.P.failed) === '["spread"]',
    vRatio: V(r.vRatio) === "FAIL/PASS" && JSON.stringify(r.vRatio.P.failed) === '["vRatio"]' && r.vRatio.P.clauses.vRatio.miss.join() === "D4-1658-P",
    nonStationaryFlow: V(r.nonStationaryFlow) === "PASS/PASS" && r.nonStationaryFlow.P.validRows.length === 3
      && /non-stationary/.test(r.nonStationaryFlow.P.rows.find(x => x.id === "D3-P").invalidBy.join()),
    nonStationaryNoflow: V(r.nonStationaryNoflow) === "PASS/PASS" && !r.nonStationaryNoflow.P.validRows.includes("D4-3315-P"),
    infoOnly: V(r.infoOnly) === "PASS/PASS" && r.infoOnly.P.information[0].id === "D4-921-P" && r.infoOnly.P.information[0].R === 1.0
      && !r.infoOnly.P.validRows.includes("D4-921-P") && r.infoOnly.T.information[0].valid === false,
    fewValid: V(r.fewValid) === "PASS/NO VERDICT" && r.fewValid.T.validRows.join() === "D2-T" && /1 valid row/.test(r.fewValid.T.why)
      && /stop rule \(flow\)/.test(r.fewValid.T.rows.find(x => x.id === "D3-T").invalidBy.join()),
    inletDead: V(r.inletDead) === "PASS/PASS" && /inlet not live/.test(r.inletDead.P.rows.find(x => x.id === "D3-P").invalidBy.join()),
    inletEdge: r.inletEdge.P.validRows.includes("D3-P"),
    stationEdge: r.stationEdge.P.validRows.includes("D3-P"),
    zeroLeak: V(r.zeroLeak) === "NO VERDICT/NO VERDICT" && r.zeroLeak.falsification.zero.R !== 1 && !r.zeroLeak.falsification.zero.traceEqual
      && r.zeroLeak.P.rowVerdict === "PASS" && /falsification not demonstrated/.test(r.zeroLeak.P.why) && !r.zeroLeak.appMayCallQuantitative,
    revInBand: V(r.revInBand) === "NO VERDICT/NO VERDICT" && !r.revInBand.falsification.reversed.bandFails,
    revAboveOne: V(r.revAboveOne) === "NO VERDICT/NO VERDICT" && r.revAboveOne.falsification.reversed.bandFails && !r.revAboveOne.falsification.reversed.ok,
    revDeadInlet: V(r.revDeadInlet) === "NO VERDICT/NO VERDICT" && /inlet not live/.test(r.revDeadInlet.falsification.reversed.issues.join()),
    revNonStationary: V(r.revNonStationary) === "PASS/PASS" && r.revNonStationary.falsification.ok && Math.abs(r.revNonStationary.falsification.reversed.stationarity - 0.2) < 1e-9,
    falsMissing: V(r.falsMissing) === "NO VERDICT/NO VERDICT" && /not run/.test(r.falsMissing.falsification.zero.issues.join()),
    noD2P: V(r.noD2P) === "NO VERDICT/NO VERDICT" && r.noD2P.falsification.run === false && r.noD2P.P.notRun.join() === "D2-P"
      && r.noD2P.P.rowVerdict === "PASS",
    rowsFailFalsBroken: V(r.rowsFailFalsBroken) === "NO VERDICT/NO VERDICT" && r.rowsFailFalsBroken.P.rowVerdict === "FAIL",
  };
  // the clause edges, on the pure tier verdict (R and V ratio set directly)
  const fake = (Rs, vr = [0, 0]) => Rs.map((R, i) => ({ id: `X${i}`, tier: "P", informationOnly: false, valid: true, R, vRatioTong: vr[i] ?? 0 }));
  const tv = (Rs, vr) => tierVerdict("P", fake(Rs, vr), { ok: true });
  const edges = {
    bandLoIn: tv([1.26, 1.29]).verdict === "PASS", bandHiIn: tv([1.54, 1.50]).verdict === "PASS",
    bandLoOut: tv([1.2599999, 1.29]).failed.join() === "band", bandHiOut: tv([1.5400001, 1.50]).failed.join() === "band",
    // two rows a < b: spread = 2 (b/a - 1) / (b/a + 1), 0.05 at b/a = 1.05128
    spreadIn: tv([1.40, 1.40 * 1.0512]).verdict === "PASS", spreadOut: tv([1.40, 1.40 * 1.0514]).failed.join() === "spread",
    vIn: tv([1.4, 1.4], [0.0999, -0.0999]).verdict === "PASS", vOut: tv([1.4, 1.4], [0.1001, 0]).failed.join() === "vRatio",
    vOutLow: tv([1.4, 1.4], [0, -0.1001]).failed.join() === "vRatio", oneRow: tv([1.4]).verdict === "NO VERDICT",
  };
  const all = { ...ok, edges: Object.values(edges).every(Boolean) };
  check("VERDICT", Object.values(all).every(Boolean), { failing: Object.entries(all).filter(([, v]) => !v).map(([k]) => k),
    edges: Object.entries(edges).filter(([, v]) => !v).map(([k]) => k),
    verdicts: Object.fromEntries(Object.entries(r).map(([k, x]) => [k, `${V(x)}${x.falsification.ok ? "" : " (falsification not demonstrated)"}`])) });
}

// ---- D3.4's in-page driver against a mock window.__solidify -----------------

function mockEnvironment({ speed = { v0: 0.12, v1: 0.168, east: 0.08, rev: 0.09, revEast: 0.16 }, failAtRead = null, inletFactor = 1,
  served = null, importThrows = [], fetchStatus = 200, fallbackAdapter = false } = {}) {
  const STEP = () => 7;   // sentinel: the driver must put the app's step back
  const device = {
    adapterInfo: { vendor: "mock", architecture: "cpu", device: "", description: "flow-tong2 self-test", isFallbackAdapter: fallbackAdapter },
    limits: { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxTextureDimension2D: 8192 },
    addEventListener() {}, lost: new Promise(() => {}),
    queue: { submit() {}, async onSubmittedWorkDone() {} },
    createBuffer({ size }) { const data = new Float32Array(size / 4); return { data, async mapAsync() {}, getMappedRange: () => data.buffer, unmap() {}, destroy() {} }; },
    createCommandEncoder() { return { copyTextureToBuffer(src, dst) { src.texture.fillInto(dst.buffer.data); }, finish: () => ({}) }; },
  };
  const log = { grids: [], stagedFlows: [], stages: 0, params: [], seeds: [] };
  const makeSim = n => {
    let reads = 0;
    const sim = {
      n, device, params: {}, flowCfg: { u: 0.02, pr: 23.1, scale: 1 }, flowOn: false, flowVelocity: null, t: 0, seed: null, step: STEP,
      setFlow(on) {
        this.flowOn = !!on;
        this.flowVelocity = on ? { fillInto: data => this.fillVelocity(data) } : null;
        if (on) log.stagedFlows.push({ ...this.flowCfg, n });
        return null;
      },
      reset() { log.stages++; log.params.push({ n, dx: this.params.dx, dt: this.params.dt, lambda: this.params.lambda, dTherm: this.params.dTherm }); this.t = 0; this.seed = null; },
      addSeed(x, y, r, th) { this.seed = { x, y, r, th }; log.seeds.push({ n, x, y, r }); },
      async stepSync(k) { this.t += k * this.params.dt; return k; },
      speeds() {
        const s = !this.flowOn ? null : this.flowCfg.scale;
        return s === 1 ? [speed.v1, speed.east] : s === -1 ? [speed.rev, speed.revEast] : [speed.v0, speed.v0];
      },
      tips() {
        const { x, y, r } = this.seed, dx = this.params.dx, [vw, ve] = this.speeds();
        const cx = x - 0.5, cy = y - 0.5, go = v => (v * this.t) / dx;
        return { cx, cy, west: cx - r - go(vw), east: cx + r + go(ve), north: cy + r + go(speed.v0), south: cy - r - go(speed.v0) };
      },
      phiAt(i, j, tp) {
        const ramp = s => Math.min(1, Math.max(0, 0.5 + s / 2));
        const h = Math.abs(j - tp.cy) <= 3 ? Math.min(ramp(i - tp.west), ramp(tp.east - i)) : 0;
        const v = Math.abs(i - tp.cx) <= 3 ? Math.min(ramp(j - tp.south), ramp(tp.north - j)) : 0;
        return Math.max(h, v);
      },
      fillVelocity(data) {
        const tp = this.tips(), U = this.flowCfg.u;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const o = (j * n + i) * 4;
          data[o] = (i === 0 ? inletFactor : 1) * (Math.abs(j - tp.cy) <= 20 ? U * Math.min(1, Math.max(0, (tp.west - i) / 20)) : U);
          data[o + 1] = 0; data[o + 2] = 1; data[o + 3] = 0;
        }
      },
      async readRows(y0, h) {
        reads++;
        if (failAtRead != null && reads === failAtRead) return null;
        const tp = this.tips(), out = new Float32Array(h * n * 4);
        for (let r = 0; r < h; r++) for (let i = 0; i < n; i++) { const o = (r * n + i) * 4; out[o] = this.phiAt(i, y0 + r, tp); out[o + 1] = -0.55; }
        return out;
      },
    };
    return sim;
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
      return page;
    },
  };
  return { ctx, S, STEP, log, speed, texts };
}

const restored = env => { const s = env.S.sim(); return s.step === env.STEP && !s.flowOn && s.flowCfg.u === 0.02 && s.flowCfg.scale === 1 && s.flowCfg.pr === 23.1; };

async function mockRun(geos) {
  const by = Object.fromEntries(geos.map(g => [g.id, g]));
  const env = mockEnvironment();
  const disk = Object.fromEntries(Object.entries(env.texts).map(([p, t]) => [p, hashText(t)]));
  env.ctx.admit = m => { const a = admission(m, disk); if (!a.ok) throw new Error(`not admitted: ${a.why}`); return a; };
  const rows = [];
  for (const id of ["D2-P", "D4-921-P", "D4-921-T"]) {
    rows.push(await runArm(env.ctx, by[id]));
    if (!restored(env)) rows.at(-1).restoreFailed = true;
  }
  const byId = assess(rows, true), d = decide(byId);
  const a = byId["D2-P"], f = d.falsification, p160 = byId["D4-921-P"], t320 = byId["D4-921-T"];
  const want = env.speed.v1 / env.speed.v0, wantRev = env.speed.rev / env.speed.v0;
  const flows = env.log.stagedFlows;
  const ok = rows.every(r => !r.exception && !r.restoreFailed) && a.valid && p160.valid && t320.valid
    && rel(a.R, want) < 1e-6 && rel(p160.R, want) < 1e-6 && rel(t320.R, want) < 1e-6
    && f.ok && f.zero.R === 1 && f.zero.traceEqual && f.zero.rowsEqual && rel(f.reversed.R, wantRev) < 1e-6
    && JSON.stringify(env.log.grids) === "[512,160,320]"
    && JSON.stringify(flows.map(x => [x.n, x.scale])) === "[[512,1],[512,0],[512,-1],[160,1],[320,1]]"
    && rel(flows[0].u, by["D2-P"].staging.uLat) < 1e-15 && rel(flows[4].u, by["D4-921-T"].staging.uLat) < 1e-15 && flows.every(x => x.pr === 23.1)
    && JSON.stringify(env.log.seeds.map(s => [s.n, s.x, s.r])) === JSON.stringify([...Array(4).fill([512, 256, 10]), ...Array(2).fill([160, 80, 10]), ...Array(2).fill([320, 160, 20])])
    && env.log.params.filter(x => x.n === 320).every(x => x.dx === 0.4 && x.dt === by["D4-921-T"].staging.dt)
    && a.runs.noflow.trace.length === 33 && a.runs.flow.trace.every(p => p.delivered === 543) && p160.runs.flow.trace.every(p => p.delivered === 30)
    && Math.abs(a.inletUx - 1) < 1e-6 && Math.abs(a.runs.flow.end.mirror) < 1e-6 && a.runs.noflow.end.vel === null
    && p160.gridAccepted.staged === 160 && p160.gridAccepted.flowOn === true && p160.gridAccepted.delivered.flow === 990
    && rows[0].admission.ok && rows[0].metadata.served["src/lbm.ts"].via === "import"
    && d.P.verdict === "NO VERDICT" && /1 valid row/.test(d.P.why) && d.P.information[0].id === "D4-921-P";
  check("MOCK-RUN", ok, { R: [a.R, p160.R, t320.R], want, falsification: { zero: f.zero.R, reversed: f.reversed.R, ok: f.ok },
    grids: env.log.grids, n160: p160.gridAccepted, endGapD0: a.endGap?.d0, P: d.P.verdict });

  // the stop rule, a dead inlet and a failed readback, each through the driver
  const fast = mockEnvironment({ speed: { v0: 0.45, v1: 2.5, east: 0.3, rev: 0.3, revEast: 0.6 } });
  const sRow = await runArm(fast.ctx, by["D4-921-P"]);
  const sA = assess([sRow], true)["D4-921-P"];
  const dead = mockEnvironment({ inletFactor: 0.98 });
  const dRow = await runArm(dead.ctx, by["D3-P"]);
  const dA = assess([dRow], true)["D3-P"];
  const broken = mockEnvironment({ failAtRead: 5 });
  const bRow = await runArm(broken.ctx, by["D4-1658-T"]);
  const bA = assess([bRow], true)["D4-1658-T"];
  const okFail = sRow.runs.flow.stopped && sRow.runs.flow.trace.length < 33 && !sA.valid && sA.stopRule.join() === "flow"
    && sA.invalidBy.length === 1 && /stop rule/.test(sA.invalidBy[0]) && restored(fast)
    && !dA.valid && dA.invalidBy.length === 1 && /inlet not live/.test(dA.invalidBy[0]) && Math.abs(dA.inletUx - 0.98) < 1e-6
    && !!bRow.exception && /readRows failed/.test(bRow.exception) && bRow.runs.noflow.finished === true && restored(broken) && !bA.valid;
  check("MOCK-FAILURES", okFail, { stoppedAt: sRow.runs.flow.trace.length, stopInvalidBy: sA.invalidBy, deadInvalidBy: dA.invalidBy,
    brokenException: String(bRow.exception).split("\n")[0] });
}

/** check (3): the served-source admission (D3.4's driver metadata, this script's admission) */
async function admissionCheck(geos) {
  const g = geos.find(x => x.id === "D3-P");
  const disk = {};
  const diskTexts = Object.fromEntries(SERVED.map(p => [p, `// ${p}\r\nexport const x = 1;\r\n`]));   // CRLF on disk
  for (const [p, t] of Object.entries(diskTexts)) disk[p] = hashText(t);
  const servedLF = Object.fromEntries(Object.entries(diskTexts).map(([p, t]) => [p, t.replace(/\r\n/g, "\n")]));
  const attempt = async opts => {
    const env = mockEnvironment({ served: opts.served ?? servedLF, ...opts });
    let verdict = null;
    env.ctx.admit = m => { verdict = admission(m, disk); if (!verdict.ok) throw new Error(`not admitted: ${verdict.why}`); return verdict; };
    const row = await runArm(env.ctx, g);
    return { row, verdict, env, stepped: env.log.stages > 0 || env.log.stagedFlows.length > 0 };
  };
  const changed = { ...servedLF, "src/lbm.ts": servedLF["src/lbm.ts"].replace("x = 1", "x = 2") };
  const fetchSaved = globalThis.fetch;
  try {
    const same = await attempt({});
    const viaFetch = await attempt({ importThrows: ["src/main.ts"] });
    const diff = await attempt({ served: changed });
    const diffViaFetch = await attempt({ served: { ...changed, "src/lbm.ts": servedLF["src/lbm.ts"], "src/main.ts": `${servedLF["src/main.ts"]} ` }, importThrows: ["src/main.ts"] });
    const noFetch = await attempt({ importThrows: ["src/sim.ts"], fetchStatus: 404 });
    const software = await attempt({ fallbackAdapter: true });
    const refused = x => /not admitted/.test(x.row.exception ?? "") && Object.keys(x.row.runs).length === 0 && !x.stepped;
    const ok = {
      same: !same.row.exception && same.verdict.ok && same.stepped && Object.values(same.verdict.vehicles).every(v => v === "import"),
      viaFetch: !viaFetch.row.exception && viaFetch.verdict.ok && viaFetch.verdict.vehicles["src/main.ts"] === "fetch"
        && /Unexpected identifier/.test(viaFetch.row.metadata.served["src/main.ts"].importError) && viaFetch.verdict.vehicles["src/sim.ts"] === "import",
      diff: refused(diff) && JSON.stringify(diff.verdict.bad) === '["src/lbm.ts"]' && /served source differs: src\/lbm.ts/.test(diff.row.exception),
      diffViaFetch: refused(diffViaFetch) && JSON.stringify(diffViaFetch.verdict.bad) === '["src/main.ts"]',
      noFetch: refused(noFetch) && JSON.stringify(noFetch.verdict.bad) === '["src/sim.ts"]' && /fetch 404/.test(noFetch.row.metadata.served["src/sim.ts"].error),
      software: refused(software) && software.verdict.fallback && /no hardware adapter/.test(software.row.exception),
    };
    // a refused page leaves its arm invalid
    const dA = assess([diff.row], false)["D3-P"];
    ok.invalid = !dA.valid && /exception/.test(dA.invalidBy[0]) && /served source not verified/.test(dA.invalidBy[0]);
    check("ADMISSION", Object.values(ok).every(Boolean), { failing: Object.entries(ok).filter(([, v]) => !v).map(([k]) => k),
      refusedWith: String(diff.row.exception).split("\n")[0], vehicles: viaFetch.verdict.vehicles });
  } finally { globalThis.fetch = fetchSaved; }
}

// ---- the real Simulation on a recording GPU device -------------------------

function recordingDevice() {
  const log = { textures: [], dispatches: [], copies: [], errors: [] };
  const stub = () => new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : stub()), apply: () => stub() });
  const device = {
    limits: { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxTextureDimension2D: 8192 },
    createTexture(d) { log.textures.push([...d.size]); return { createView: () => stub(), destroy() {}, width: d.size[0], height: d.size[1] }; },
    createBuffer(d) {
      const data = d.usage & 1 ? new ArrayBuffer(d.size) : null;   // only mappable buffers hold bytes
      return { size: d.size, destroy() {}, async mapAsync() {}, getMappedRange: () => data, unmap() {} };
    },
    createShaderModule() { return { getCompilationInfo: async () => ({ messages: [] }) }; },
    createComputePipeline() { return { getBindGroupLayout: () => stub() }; },
    createRenderPipeline() { return { getBindGroupLayout: () => stub() }; },
    createBindGroup: () => stub(), createBindGroupLayout: () => stub(), createPipelineLayout: () => stub(), createSampler: () => stub(),
    createCommandEncoder() {
      return {
        beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(x, y = 1) { log.dispatches.push(`${x}x${y}`); }, end() {} }; },
        copyTextureToBuffer(src, dst, size) { log.copies.push({ bpr: dst.bytesPerRow, w: size.width ?? size[0], h: size.height ?? size[1] }); },
        copyBufferToBuffer() {}, clearBuffer() {}, finish() { return {}; },
      };
    },
    queue: { writeBuffer() {}, writeTexture() {}, submit() {}, async onSubmittedWorkDone() {} },
  };
  return { device, log };
}

/** the protocol: "n 160 is below the D3.4 script's N_MIN 256: the script must show
 *  Simulation accepts it". The real src/sim.ts and src/flow.ts (Vite's module runner,
 *  middleware mode: no port, no browser) driven by the real D3.4 in-page driver at
 *  every grid and coupling this comparison stages. A recording device stands in
 *  for WebGPU: WGSL compilation and the GPU's own validation are NOT exercised. */
async function simulationAccepts(geos) {
  const { createServer } = await import("vite");
  // no port at all: middleware mode, and no HMR websocket (it would bind 24678, which other sessions' servers may hold)
  const server = await createServer({ root: REPO, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
  const saved = { window: globalThis.window, raf: globalThis.requestAnimationFrame, tu: globalThis.GPUTextureUsage, bu: globalThis.GPUBufferUsage,
    ss: globalThis.GPUShaderStage, mm: globalThis.GPUMapMode };
  const detail = {}, bad = [];
  try {
    globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
    globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
    globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
    globalThis.GPUMapMode = { READ: 1, WRITE: 2 };
    globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    const { Simulation } = await server.ssrLoadModule("/src/sim.ts");
    const F = await server.ssrLoadModule("/src/flow.ts");
    const refusal = n => F.flowRefusal({ dim3: false, scenario: 0, frozenTemperature: false, alloy: false, calibrated: true, grid: n, busyMode: null });
    if (refusal(1152) == null) bad.push("flowRefusal(1152) is null");
    // main.ts is not loadable here (DOM); pin the source reading instead: the driver's
    // S.app.setGrid(n) reaches swapSim(n), which builds new Simulation(device, n) with
    // no bound on n (the GPU run's stage() asserts sim.n === n at run time)
    const main = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const at = main.indexOf("    swapSim(n) {"), swap = at < 0 ? "" : main.slice(at, main.indexOf("\n    },", at));
    const mainPinned = main.includes("    setGrid(n) { if (n !== sim.n && !opt.active && !opt3?.active && !challenge.active && !heat?.busy) app.swapSim(n); },")
      && swap.includes("      sim = new Simulation(device, n);") && !/Math\.(max|min)|throw|[<>]=? *\d/.test(swap);
    if (!mainPinned) bad.push("main.ts setGrid/swapSim changed since the n 160 reading: re-read it");
    for (const g of geos) {
      const s = g.staging, { device, log } = recordingDevice();
      let sim = new Simulation(device, 1024);
      const S = { app: { setRun() {}, setGrid(n) { sim = new Simulation(device, n); }, setInoculant() {} }, sim: () => sim, seed: () => 0 };
      globalThis.window = { __solidify: S };
      installDriver(HELPER_SRC);
      const out = { refusal: refusal(g.n), kinds: {} };
      for (const kind of ["noflow", "flow", ...(g.falsification ? ["zero", "reversed"] : [])]) {
        const scale = SCALE[kind];
        const cfg = { lambda: g.lambda, n: g.n, seedX: g.seedX, seedY: g.seedY, dx: s.dx, dt: s.dt, dTilde: s.dTilde, eps4: K.EPS4,
          delta: K.DELTA, uLat: s.uLat, pr: K.PR, seedR: s.seedRCells, flow: scale === null ? null : { scale } };
        log.dispatches.length = 0; log.copies.length = 0;
        const st = await window.__fd.stage(cfg);
        const simNow = S.sim();
        const issues = F.flowSetting({ dTherm: simNow.params.dTherm, dt: simNow.params.dt, dx: simNow.params.dx, epsBar: simNow.params.epsBar, calibrated: true }, simNow.flowCfg).issues;
        const a = await window.__fd.advance(s.chunk);
        const e = await window.__fd.end(g.seedX - 20);
        const fin = await window.__fd.finish();
        const wg = Math.ceil(g.n / 8), dispatchOk = log.dispatches.length > 0 && log.dispatches.every(x => x === `${wg}x${wg}`);
        const copyOk = log.copies.length > 0 && log.copies.every(c => c.bpr % 256 === 0 && c.w === g.n);
        out.kinds[kind] = { n: st.n, flowOn: st.flowOn, scale: st.flowCfg.scale, delivered: a.got, row: a.row.length, column: e.column.length,
          vel: e.vel != null, dispatches: log.dispatches.length, dispatchOk, copyBpr: [...new Set(log.copies.map(c => c.bpr))], copyOk, issues: issues.length, fin };
        const k = out.kinds[kind];
        if (!(k.n === g.n && k.flowOn === (scale !== null) && (scale === null || k.scale === scale) && k.delivered === s.chunk && k.row === g.n
          && k.column === g.n && k.vel === (scale !== null) && dispatchOk && copyOk && k.issues === 0 && fin === true && S.sim().step === Simulation.prototype.step))
          bad.push(`${g.id}/${kind}: ${JSON.stringify(k)}`);
      }
      if (out.refusal !== null) bad.push(`${g.id}: flowRefusal: ${out.refusal}`);
      if (!log.textures.every(([w, h]) => (w === g.n && h === g.n) || (w === 1024 && h === 1024) || (w === 1 && h === 1))) bad.push(`${g.id}: texture sizes`);
      detail[g.id] = { n: g.n, wg: Math.ceil(g.n / 8), bpr: g.n * 16, delivered: out.kinds.flow.delivered };
    }
  } catch (e) { bad.push(String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); }
  finally {
    await server.close();
    Object.assign(globalThis, { window: saved.window, requestAnimationFrame: saved.raf, GPUTextureUsage: saved.tu, GPUBufferUsage: saved.bu, GPUShaderStage: saved.ss, GPUMapMode: saved.mm });
  }
  check("SIM-ACCEPTS", bad.length === 0, { bad, n160: detail["D4-921-P"], grids: Object.values(detail).map(x => x.n) });
}

export async function selfTest() {
  const fetchSaved = globalThis.fetch, windowSaved = globalThis.window;
  protocol();
  const geos = parsing();
  windowTable(geos);
  statistic();
  verdicts(geos);
  await mockRun(geos);
  await admissionCheck(geos);
  await simulationAccepts(geos);
  check("RULES-FROZEN", Object.isFrozen(RULES) && Object.isFrozen(K) && Object.isFrozen(K.TIERS) && Object.isFrozen(PROTOCOL.rows.D2) && Object.isFrozen(COST)
    && RULES.bandLo === 1.26 && RULES.bandHi === 1.54 && RULES.spreadMax === 0.05 && RULES.vRatioMax === 0.10 && RULES.stationarityMax === 0.02
    && RULES.inletTol === 1e-4 && RULES.minValidRows === 2 && K.STOP_CELLS === 32 && K.TIERS.P === 0.8 && K.TIERS.T === 0.4, {});
  globalThis.fetch = fetchSaved;
  globalThis.window = windowSaved;
  console.log(`T2-SELFTEST ${failures ? `FAILED (${failures})` : "PASSED"} (CPU only; no browser, no GPU)`);
  return failures === 0;
}
