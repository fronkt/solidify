// Browser-free self-test for scripts/research/flow-tong3.mjs (Tong comparison 3,
// D2 only). Never launches Chrome or touches a GPU. Checks: the protocol and its
// amendment at the pinned commit (the pre-registered text kept verbatim); that
// tong2's machinery is the file its GPU run froze; the arm file and its refusals;
// the window (671 / 22143 and 2683 / 88539) from the formula and against Python;
// tau V / W; the verdict on synthetic traces (pass, each band's miss, the bound
// and stationarity clauses, the convergence clause's pass, miss and invalid arms,
// the falsification arms and the NO VERDICT paths, P512 and tier I never gating);
// D3.4's in-page driver through tong2's runArm against a mock app for each arm
// type; and the served-source admission.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as T2 from "./flow-tong2.mjs";
import {
  PROTOCOL_COMMIT, PROTOCOL_HEADER, AMENDMENT_HEADER, ORIGINAL_PROTOCOL_COMMIT, TONG2_RUN_COMMIT, D35_PASSED_COMMIT, REPO,
  PROTOCOL, RULES, COST, SERVED, staging, tauVW, geometry, parseArms, assess, decide,
} from "./flow-tong3.mjs";
import { HELPER_SRC, installDriver } from "./flow-domain.mjs";

const K = T2.K;
let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log(`T3-SELFTEST-${name}`, ok ? "OK" : "FAIL", JSON.stringify(detail ?? {})); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20, cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
const ARMS = JSON.parse(readFileSync(new URL("./flow-tong3-arms.json", import.meta.url), "utf8"));
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
      "T = 8 D~ / V_KR^2 = 1063.1 tau0", "chunk = round(T / 33 / dt) = 671, 22143 substeps", "tier I (dx 0.4): chunk 2683, 88539 substeps",
      "P512, seedX 512", "P640, seedX 640", "P768, seedX 768", "n 1024, dx 0.4 W0, box 1478 d0, seedX 512",
      "Stationarity: |v_last / v_mid - 1| <= 0.02 in BOTH runs.", "Bound: tau V / W <= 0.2 in BOTH runs.",
      "Inlet liveness: flow-run inlet-column mean u_x / U within 1e-4 of 1.", "the west tip within 32 cells of x = 0 makes the arm invalid",
      "C = |V_flow(P768) / V_flow(P640) - 1|", "CONVERGED if P640 and P768 are both valid and C <= 0.01",
      "|V_flow d0/D / 0.0247 - 1| <= 0.10", "R in [1.26, 1.54] (FLOW-TIP-TONG's band)",
      "coupling 0 must give R = 1 exactly with equal traces and fail the band; coupling -1 must give R < 1 and fail",
      "Order: P768 (no flow, flow, coupling 0, coupling -1), P640, P512, then I512.",
    ];
    detail = { header: amended != null, amendment: sec.includes(AMENDMENT_HEADER), originalKeptVerbatim: !!original && amended.startsWith(original.trimEnd()),
      missingQuotes: quoted.filter(q => !sec.includes(q)), armsCommit: ARMS.protocolCommit === PROTOCOL_COMMIT };
    ok = detail.header && detail.amendment && detail.originalKeptVerbatim && detail.missingQuotes.length === 0 && detail.armsCommit;
  } catch (e) { ok = false; detail.error = String(e.message).split("\n")[0]; }
  check("PROTOCOL", ok, { commit: PROTOCOL_COMMIT.slice(0, 7), original: ORIGINAL_PROTOCOL_COMMIT.slice(0, 7), ...detail });
}

/** tong2's machinery is imported unchanged: its files equal the head its GPU run froze */
function tong2Unchanged() {
  const paths = ["scripts/research/flow-tong2.mjs", "scripts/research/flow-tong2-selftest.mjs", "scripts/research/flow-tong2-arms.json", "scripts/research/flow-domain.mjs"];
  let same = true, srcAsD35 = true;
  try { git(["diff", "--quiet", TONG2_RUN_COMMIT, "HEAD", "--", ...paths]); git(["diff", "--quiet", TONG2_RUN_COMMIT, "--", ...paths]); } catch { same = false; }
  try { git(["diff", "--quiet", D35_PASSED_COMMIT, "HEAD", "--", "src"]); } catch { srcAsD35 = false; }
  // the clauses tong3 takes from tong2 carry the values tong3's protocol names
  const shared = T2.RULES.bandLo === RULES.rLo && T2.RULES.bandHi === RULES.rHi && T2.RULES.stationarityMax === 0.02 && T2.RULES.inletTol === 1e-4
    && T2.K.STOP_CELLS === 32 && T2.K.NS === 33 && T2.PROTOCOL.falsification === "D2-P";
  check("TONG2-UNCHANGED", same && shared, { run: TONG2_RUN_COMMIT.slice(0, 7), same, shared, srcAsD35PassedHead: srcAsD35 });
}

function parsing() {
  let geos, parseError = null;
  try { geos = parseArms(ARMS); }
  catch (e) { parseError = String(e.message); geos = PROTOCOL.arms.map(a => ({ ...geometry(a), substeps: geometry(a).staging.substeps })); }
  const mutate = f => { const j = JSON.parse(JSON.stringify(ARMS)); f(j); return () => parseArms(j); };
  const arm = (j, id) => j.arms.find(a => a.id === id);
  const hostile = {
    seedMoved: throwsWith(mutate(j => { arm(j, "P768").seedX = 800; }), /seedX/),
    tierMoved: throwsWith(mutate(j => { arm(j, "I512").tier = "P"; }), /tier/),
    chunkDraft: throwsWith(mutate(j => { arm(j, "P640").chunk = 670; arm(j, "P640").substeps = 22110; }), /not the protocol's/),
    chunkDraftI: throwsWith(mutate(j => { arm(j, "I512").chunk = 2681; arm(j, "I512").substeps = 88473; }), /not the protocol's/),
    vTong: throwsWith(mutate(j => { j.row.tongVd0D = 0.025; }), /pre-registered/),
    lambda: throwsWith(mutate(j => { j.row.lambda = 3.2; }), /pre-registered/),
    falsificationMoved: throwsWith(mutate(j => { delete arm(j, "P768").falsification; arm(j, "P640").falsification = true; }), /falsification/),
    infoDropped: throwsWith(mutate(j => { delete arm(j, "I512").informationOnly; }), /informationOnly/),
    infoAdded: throwsWith(mutate(j => { arm(j, "P512").informationOnly = true; }), /informationOnly/),
    reordered: throwsWith(mutate(j => { j.arms.reverse(); }), /order/),
    missing: throwsWith(mutate(j => { j.arms.pop(); }), /exactly/),
    extra: throwsWith(mutate(j => { j.arms.push({ ...arm(j, "P512"), id: "P896", seedX: 896 }); }), /exactly/),
    unknownKey: throwsWith(mutate(j => { arm(j, "P512").noise = 0.1; }), /unknown key/),
    wrongProtocol: throwsWith(mutate(j => { j.protocolCommit = ORIGINAL_PROTOCOL_COMMIT; }), /protocolCommit/),
  };
  const ids = geos.map(g => g.id);
  check("PARSE", parseError === null && ids.join() === "P768,P640,P512,I512" && Object.values(hostile).every(Boolean)
    && geos.filter(g => g.falsification).map(g => g.id).join() === "P768" && geos.filter(g => g.informationOnly).map(g => g.id).join() === "I512",
  { parseError, hostile });
  return geos;
}

/** the substep formula: 33 equal chunks over T = 8 D~ / V_KR^2, no inlet cap */
function windowFormula(geos) {
  // independent values: Python 3 double arithmetic of the protocol's formula (2026-11-07)
  const py = { T: 1063.0817634922676, vKR: 0.1226554494739224, dt: { P: 0.04801985621054306, I: 0.012004964052635765 }, raw: { P: 670.8599616054694, I: 2683.4398464218775 } };
  const sP = staging(3.19, 0.8, 819.2), sI = staging(3.19, 0.4, 409.6);
  const bad = [];
  for (const [t, s] of [["P", sP], ["I", sI]]) {
    const w = PROTOCOL.window[t];
    if (s.chunk !== w.chunk || s.substeps !== w.substeps) bad.push(`${t}: ${s.chunk} / ${s.substeps}`);
    for (const [k, got, want] of [["T", s.T, py.T], ["vKR", s.vKR, py.vKR], ["dt", s.dt, py.dt[t]], ["chunkRaw", s.T / 33 / s.dt, py.raw[t]]])
      if (!(rel(got, want) <= 1e-14)) bad.push(`${t}:${k} ${got} vs ${want}`);
    if (!(Math.abs(s.T - (8 * s.dTilde) / (s.vKR * s.vKR)) <= 1e-9 * s.T)) bad.push(`${t}: T is not 8 D~ / V_KR^2`);
    if (!(s.mach <= 0.1 && s.peCell <= 2 && s.tau >= 0.51)) bad.push(`${t}: outside FLOW_LIMITS`);
  }
  // tong2's D2 window had the inlet cap (860.9 tau0); tong3's is the uncapped 8 l_D (tong2's own tTravel)
  const t2 = T2.staging(3.19, 0.8, 409.6);
  const ok = bad.length === 0 && sP.T === t2.tTravel && sP.T === sI.T && t2.T < sP.T && Math.round(sP.T * 10) / 10 === 1063.1
    && 670 * 33 !== sP.substeps && Math.round(sP.TinLD * 10) / 10 === 8
    && geos.every(g => g.substeps === PROTOCOL.window[g.tier].substeps && g.chunk === PROTOCOL.window[g.tier].chunk)
    && Math.abs(geos[0].boxD0 - 2956.4973413282) < 1e-6 && Math.abs(geos[3].boxD0 - 1478.2486706641) < 1e-6
    && geos.map(g => g.inletGap0.nuOverU.toFixed(2)).join() === "3.36,2.80,2.24,1.12";
  check("WINDOW", ok, { bad, P: `${sP.chunk} x 33 = ${sP.substeps}`, I: `${sI.chunk} x 33 = ${sI.substeps}`, T: sP.T, tong2CappedT: t2.T,
    predictedEndGapNuOverU: geos.map(g => +g.predictedEndGapNuOverU.toFixed(2)) });
}

function boundFormula() {
  // tau V / W = (V d0/D)(a2 lambda)(lambda / a1) = v in W0/tau0 (tau0 = W0 = 1 in the staging)
  const v = 0.1835, vd0D = (v * K.A1) / (K.A2 * 3.19 * 3.19);
  const ok = rel(tauVW(vd0D, 3.19), v) < 1e-12 && Math.abs(tauVW(0.0247, 3.19) - 0.1782111530591696) < 1e-12
    && Math.abs(tauVW(0.0170, 3.19) - 0.1226554494739224) < 1e-12 && tauVW(NaN, 3.19) === null && RULES.boundMax === 0.2;
  check("BOUND-FORMULA", ok, { tong: tauVW(0.0247, 3.19), exactNoflow: tauVW(0.0170, 3.19) });
}

// ---- synthetic traces through tong2's assess, tong3's bound and decide ----------

/** a run whose west tip moves at vA (W0/tau0) through sample 21 and vB after, so
 *  v_mid = vA and v_last = vB exactly; stopAt truncates it at the stop rule */
function synthRun(g, kind, { vA, vB, inletUx = 1, stopAt = null }) {
  const s = g.staging, tk = k => (k + 1) * s.chunk * s.dt, t21 = tk(21);
  const x0 = g.seedX - s.seedRCells;
  let trace = Array.from({ length: K.NS }, (_, k) => ({ k, t: tk(k), xEast: g.seedX + s.seedRCells + (0.08 * tk(k)) / s.dx,
    xWest: k <= 21 ? x0 - (vA * tk(k)) / s.dx : x0 - (vA * t21) / s.dx - (vB * (tk(k) - t21)) / s.dx, delivered: s.chunk, ms: 1 }));
  let stopped = false;
  if (stopAt != null) { trace = trace.slice(0, stopAt + 1); trace[stopAt].xWest = K.STOP_CELLS - 4; stopped = true; }
  const scale = T2.SCALE[kind];
  return { kind, scale, trace, stopped, flowLost: false, finished: true,
    setup: { n: g.n, flowOn: scale !== null, flowCfg: { u: s.uLat, pr: K.PR, scale: scale ?? 1 } },
    summary: T2.summarizeRun(trace, g.lambda, s.dx),
    end: { yN: null, yS: null, mirror: 0, nonFinite: 0, asymPhi: { max: 0 }, asymT: { max: 0 }, vel: scale === null ? null : { inletUx, uxMirrorOverU: 0 } } };
}

/** a world: flow V d0/D = vRatio x Tong's 0.0247 and R per arm; options per arm */
function world(geos, spec = {}) {
  const base = { P768: { vRatio: 1.03, R: 1.40 }, P640: { vRatio: 1.03 / 1.005, R: 1.40 }, P512: { vRatio: 1.00, R: 1.38 }, I512: { vRatio: 0.9, R: 1.6 } };
  const arms = [];
  for (const g of geos) {
    const o = { statNoflow: 0, statFlow: 0, inletUx: 1, ...base[g.id], ...(spec[g.id] ?? {}) };
    if (o.skip) continue;
    const vFlow = (o.vRatio * PROTOCOL.row.tongVd0D * K.A2 * g.lambda * g.lambda) / K.A1, vNoflow = vFlow / o.R;
    const runs = {
      noflow: synthRun(g, "noflow", { vA: vNoflow / (1 + o.statNoflow), vB: vNoflow, stopAt: o.stopNoflow ?? null }),
      flow: synthRun(g, "flow", { vA: vFlow / (1 + o.statFlow), vB: vFlow, inletUx: o.inletUx, stopAt: o.stopFlow ?? null }),
    };
    if (g.falsification) {
      const f = { zeroNudge: 0, revR: 0.514, revStat: 0, revInlet: 1, ...(spec.falsification ?? {}) };
      if (!f.missing) {
        runs.zero = structuredClone(runs.noflow);
        Object.assign(runs.zero, { kind: "zero", scale: 0, setup: { ...runs.zero.setup, flowOn: true, flowCfg: { ...runs.zero.setup.flowCfg, scale: 0 } },
          end: { ...runs.zero.end, vel: { inletUx: 1, uxMirrorOverU: 0 } } });
        if (f.zeroNudge) { runs.zero.trace.at(-1).xWest += f.zeroNudge; runs.zero.summary = T2.summarizeRun(runs.zero.trace, g.lambda, g.staging.dx); }
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

function verdicts(geos) {
  const w = spec => world(geos, spec);
  // the bound's edge in V d0/D terms: tau V / W = 0.2 at vRatio 0.2 / tauVW(0.0247)
  const edge = 0.2 / tauVW(PROTOCOL.row.tongVd0D, 3.19);
  const r = {
    pass: w(),
    vHigh: w({ P768: { vRatio: 1.11 }, P640: { vRatio: 1.11 } }), vLow: w({ P768: { vRatio: 0.89 }, P640: { vRatio: 0.89 } }),
    rHigh: w({ P768: { R: 1.56 } }), rLow: w({ P768: { R: 1.25 } }), both: w({ P768: { vRatio: 1.11, R: 1.56 }, P640: { vRatio: 1.11 } }),
    rEdges: w({ P768: { R: 1.5399999 } }), vEdge: w({ P768: { vRatio: 1.0999 }, P640: { vRatio: 1.0999 } }),
    convMiss: w({ P640: { vRatio: 1.03 / 1.015 } }), convEdgeIn: w({ P640: { vRatio: 1.03 / 1.0099 } }), convEdgeOut: w({ P640: { vRatio: 1.03 / 1.0101 } }),
    convP640Invalid: w({ P640: { statFlow: 0.03 } }), convP640Missing: w({ P640: { skip: true } }),
    boundFlowOut: w({ P768: { vRatio: edge * 1.0005 }, P640: { vRatio: edge * 1.0005 } }), boundFlowIn: w({ P768: { vRatio: edge * 0.9995 }, P640: { vRatio: edge * 0.9995 } }),
    boundNoflowOut: w({ P768: { R: 0.9 } }), boundP640Out: w({ P640: { vRatio: edge * 1.001 } }),
    statFlow: w({ P768: { statFlow: 0.03 } }), statNoflow: w({ P768: { statNoflow: -0.025 } }), statEdge: w({ P768: { statFlow: 0.0199 } }),
    inletDead: w({ P768: { inletUx: 1.0002 } }), stopFlow: w({ P768: { stopFlow: 25 } }),
    p512Bad: w({ P512: { statFlow: 0.05, vRatio: 0.7 } }),
    iBad: w({ I512: { stopFlow: 10, R: 3, statFlow: 0.3 } }), iMissing: w({ I512: { skip: true } }), iGoodPFails: w({ P768: { R: 1.56 }, I512: { vRatio: 1.0, R: 1.4 } }),
    zeroLeak: w({ falsification: { zeroNudge: 1e-6 } }), revInBand: w({ falsification: { revR: 1.30 } }), revAboveOne: w({ falsification: { revR: 1.05 } }),
    revDeadInlet: w({ falsification: { revInlet: 0.9 } }), revNonStationary: w({ falsification: { revStat: 0.2 } }), falsMissing: w({ falsification: { missing: true } }),
    p768Missing: w({ P768: { skip: true } }), twoReasons: w({ P640: { vRatio: 1.03 / 1.015 }, falsification: { revR: 1.30 } }),
  };
  const V = x => x.verdict, why = x => (x.why ?? []).join(" | ");
  const f = r.pass.falsification;
  const ok = {
    pass: V(r.pass) === "PASS" && f.ok && f.zero.R === 1 && f.zero.traceEqual && f.zero.bandFails && Math.abs(f.reversed.R - 0.514) < 1e-9
      && r.pass.convergence.converged && Math.abs(r.pass.convergence.C - 0.005) < 1e-9 && Math.abs(r.pass.clauses.vBand.signed - 0.03) < 1e-9
      && Math.abs(r.pass.reported.P768.RvsTong.diff - (1.40 - 1.372)) < 1e-9 && Math.abs(r.pass.reported.P512.vs640 - (1.00 * 1.005 / 1.03 - 1)) < 1e-9
      && Math.abs(r.pass.reported.P768.tauVW.flow - 1.03 * 0.1782111530591696) < 1e-9 && r.pass.reported.P768.tauVW.zero != null && r.pass.reported.P768.tauVW.reversed != null
      && r.pass.reported.arms.P768.outletGap.flow.cells > 0 && r.pass.information.I512.valid === true,
    vHigh: V(r.vHigh) === "FAIL" && r.vHigh.failed.join() === "vBand", vLow: V(r.vLow) === "FAIL" && r.vLow.failed.join() === "vBand",
    rHigh: V(r.rHigh) === "FAIL" && r.rHigh.failed.join() === "rBand", rLow: V(r.rLow) === "FAIL" && r.rLow.failed.join() === "rBand",
    both: V(r.both) === "FAIL" && r.both.failed.join() === "vBand,rBand", rEdges: V(r.rEdges) === "PASS", vEdge: V(r.vEdge) === "PASS",
    convMiss: V(r.convMiss) === "NO VERDICT" && /not converged in inlet distance/.test(why(r.convMiss)) && Math.abs(r.convMiss.convergence.C - 0.015) < 1e-9,
    convEdgeIn: V(r.convEdgeIn) === "PASS", convEdgeOut: V(r.convEdgeOut) === "NO VERDICT",
    convP640Invalid: V(r.convP640Invalid) === "NO VERDICT" && /arm invalid: P640 \(non-stationary/.test(why(r.convP640Invalid)) && !r.convP640Invalid.convergence.converged,
    convP640Missing: V(r.convP640Missing) === "NO VERDICT" && /arm invalid: P640 \(not run\)/.test(why(r.convP640Missing)),
    boundFlowOut: V(r.boundFlowOut) === "NO VERDICT" && /P768 \(outside the bound/.test(why(r.boundFlowOut)),
    boundFlowIn: V(r.boundFlowIn) === "FAIL" && r.boundFlowIn.failed.join() === "vBand",
    boundNoflowOut: V(r.boundNoflowOut) === "NO VERDICT" && /outside the bound \(tau V \/ W noflow 0\.20/.test(why(r.boundNoflowOut)),
    boundP640Out: V(r.boundP640Out) === "NO VERDICT" && /arm invalid: P640 \(outside the bound/.test(why(r.boundP640Out)),
    statFlow: V(r.statFlow) === "NO VERDICT" && /P768 \(non-stationary/.test(why(r.statFlow)),
    statNoflow: V(r.statNoflow) === "NO VERDICT" && /noflow -2\.50 %/.test(why(r.statNoflow)), statEdge: V(r.statEdge) === "PASS",
    inletDead: V(r.inletDead) === "NO VERDICT" && /inlet not live/.test(why(r.inletDead)),
    stopFlow: V(r.stopFlow) === "NO VERDICT" && /stop rule \(flow\)/.test(why(r.stopFlow)),
    p512Bad: V(r.p512Bad) === "PASS" && r.p512Bad.reported.P512.valid === false,
    iBad: V(r.iBad) === "PASS" && r.iBad.information.I512.valid === false && /stop rule/.test(r.iBad.information.I512.invalidBy.join()),
    iMissing: V(r.iMissing) === "PASS" && JSON.stringify(r.iMissing.clauses) === JSON.stringify(r.pass.clauses),
    iGoodPFails: V(r.iGoodPFails) === "FAIL" && r.iGoodPFails.information.I512.valid === true,
    zeroLeak: V(r.zeroLeak) === "NO VERDICT" && /falsification not demonstrated/.test(why(r.zeroLeak)) && !r.zeroLeak.falsification.zero.traceEqual,
    revInBand: V(r.revInBand) === "NO VERDICT" && !r.revInBand.falsification.reversed.bandFails,
    revAboveOne: V(r.revAboveOne) === "NO VERDICT" && r.revAboveOne.falsification.reversed.bandFails,
    revDeadInlet: V(r.revDeadInlet) === "NO VERDICT" && /inlet not live/.test(r.revDeadInlet.falsification.reversed.issues.join()),
    revNonStationary: V(r.revNonStationary) === "PASS" && r.revNonStationary.falsification.ok,
    falsMissing: V(r.falsMissing) === "NO VERDICT" && /not run/.test(r.falsMissing.falsification.zero.issues.join()),
    p768Missing: V(r.p768Missing) === "NO VERDICT" && /falsification not demonstrated/.test(why(r.p768Missing)) && /P768 \(not run\)/.test(why(r.p768Missing)),
    twoReasons: V(r.twoReasons) === "NO VERDICT" && r.twoReasons.why.length === 2,
  };
  check("VERDICT", Object.values(ok).every(Boolean), { failing: Object.entries(ok).filter(([, v]) => !v).map(([k]) => k),
    verdicts: Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.verdict + (x.failed ? ` ${x.failed.join("+")}` : "") + (x.why ? ` (${x.why.map(s => s.split(" (")[0]).join("; ")})` : "")])) });
}

// ---- D3.4's in-page driver through tong2's runArm, against a mock app -------------

function mockEnvironment({ speed = { v0: 0.12, v1: 0.168, east: 0.08, rev: 0.06, revEast: 0.16 }, failAtRead = null, inletFactor = 1,
  served = null, importThrows = [], fetchStatus = 200 } = {}) {
  const STEP = () => 7;   // sentinel: the driver must put the app's step back
  const device = {
    adapterInfo: { vendor: "mock", architecture: "cpu", device: "", description: "flow-tong3 self-test", isFallbackAdapter: false },
    limits: { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxTextureDimension2D: 8192 },
    addEventListener() {}, lost: new Promise(() => {}),
    queue: { submit() {}, async onSubmittedWorkDone() {} },
    createBuffer({ size }) { const data = new Float32Array(size / 4); return { data, async mapAsync() {}, getMappedRange: () => data.buffer, unmap() {}, destroy() {} }; },
    createCommandEncoder() { return { copyTextureToBuffer(src, dst) { src.texture.fillInto(dst.buffer.data); }, finish: () => ({}) }; },
  };
  const log = { grids: [], stagedFlows: [], stages: 0, params: [], seeds: [] };
  const makeSim = n => {
    let reads = 0;
    return {
      n, device, params: {}, flowCfg: { u: 0.02, pr: 23.1, scale: 1 }, flowOn: false, flowVelocity: null, t: 0, seed: null, step: STEP,
      setFlow(on) { this.flowOn = !!on; this.flowVelocity = on ? { fillInto: data => this.fillVelocity(data) } : null; if (on) log.stagedFlows.push({ ...this.flowCfg, n }); return null; },
      reset() { log.stages++; log.params.push({ dx: this.params.dx, dt: this.params.dt }); this.t = 0; this.seed = null; },
      addSeed(x, y, r) { this.seed = { x, y, r }; log.seeds.push([x, y, r]); },
      async stepSync(k) { this.t += k * this.params.dt; return k; },
      speeds() { const s = !this.flowOn ? null : this.flowCfg.scale; return s === 1 ? [speed.v1, speed.east] : s === -1 ? [speed.rev, speed.revEast] : [speed.v0, speed.v0]; },
      tips() {
        const { x, y, r } = this.seed, dx = this.params.dx, [vw, ve] = this.speeds(), cx = x - 0.5, cy = y - 0.5, go = v => (v * this.t) / dx;
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
  const disk = Object.fromEntries(SERVED.map(p => [p, T2.hashText(`// ${p}\r\nexport const x = 1;\r\n`)]));   // CRLF on disk
  ctx.admit = m => { const a = T2.admission(m, disk); if (!a.ok) throw new Error(`not admitted: ${a.why}`); return a; };
  return { ctx, S, STEP, log, speed, texts };
}

const restored = env => { const s = env.S.sim(); return s.step === env.STEP && !s.flowOn && s.flowCfg.u === 0.02 && s.flowCfg.scale === 1 && s.flowCfg.pr === 23.1; };

async function mockRun(geos) {
  const by = Object.fromEntries(geos.map(g => [g.id, g]));
  const env = mockEnvironment();
  const rows = [];
  for (const id of ["P768", "P640", "I512"]) { rows.push(await T2.runArm(env.ctx, by[id])); if (!restored(env)) rows.at(-1).restoreFailed = true; }
  const byId = assess(rows, true), d = decide(byId);
  const a = byId.P768, b = byId.P640, i = byId.I512, want = env.speed.v1 / env.speed.v0;
  const flows = env.log.stagedFlows;
  const ok = rows.every(x => !x.exception && !x.restoreFailed) && a.valid && b.valid && i.valid
    && rel(a.R, want) < 1e-6 && rel(b.R, want) < 1e-6 && rel(i.R, want) < 1e-6
    && d.falsification.ok && d.falsification.zero.R === 1 && d.falsification.zero.rowsEqual && rel(d.falsification.reversed.R, env.speed.rev / env.speed.v0) < 1e-6
    && env.log.grids.length === 0 && JSON.stringify(flows.map(x => [x.n, x.scale])) === "[[1024,1],[1024,0],[1024,-1],[1024,1],[1024,1]]"
    && rel(flows[0].u, by.P768.staging.uLat) < 1e-15 && rel(flows[4].u, by.I512.staging.uLat) < 1e-15 && rel(flows[4].u * 2, flows[0].u) < 1e-15
    && JSON.stringify(env.log.seeds) === JSON.stringify([...Array(4).fill([768, 512, 10]), ...Array(2).fill([640, 512, 10]), ...Array(2).fill([512, 512, 20])])
    && env.log.params.slice(6).every(p => p.dx === 0.4 && p.dt === by.I512.staging.dt) && env.log.params.slice(0, 6).every(p => p.dx === 0.8)
    && a.runs.flow.trace.every(p => p.delivered === 671) && i.runs.flow.trace.every(p => p.delivered === 2683) && i.runs.noflow.trace.length === 33
    && rel(a.tauVW.flow, env.speed.v1) < 1e-6 && rel(a.tauVW.noflow, env.speed.v0) < 1e-6 && rel(a.tauVW.reversed, env.speed.rev) < 1e-6 && a.withinBound
    && a.outletGap.flow.cells > a.outletGap.noflow.cells && a.outletGap.noflow.cells > 0 && Math.abs(a.inletUx - 1) < 1e-6
    && d.convergence.converged && d.convergence.C < 1e-6 && d.verdict === "PASS" && d.information.I512.valid
    && rows[0].admission.ok && rows[0].admission.vehicles["src/lbm.ts"] === "import";
  check("MOCK-RUN", ok, { R: [a.R, b.R, i.R], verdict: d.verdict, C: d.convergence.C, tauVW: a.tauVW, outletGapCells: a.outletGap.flow?.cells, staged: flows.length });

  // the stop rule (tier I), a dead inlet, a failed readback and a bound miss, each through the driver
  const fast = mockEnvironment({ speed: { v0: 0.12, v1: 0.5, east: 0.08, rev: 0.06, revEast: 0.16 } });
  const sRow = await T2.runArm(fast.ctx, by.I512), sA = assess([sRow], true).I512;
  const dead = mockEnvironment({ inletFactor: 0.98 });
  const dRow = await T2.runArm(dead.ctx, by.P640), dA = assess([dRow], true).P640;
  const broken = mockEnvironment({ failAtRead: 5 });
  const bRow = await T2.runArm(broken.ctx, by.P512), bA = assess([bRow], true).P512;
  const hot = mockEnvironment({ speed: { v0: 0.12, v1: 0.21, east: 0.08, rev: 0.06, revEast: 0.16 } });
  const hRow = await T2.runArm(hot.ctx, by.P640), hA = assess([hRow], true).P640;
  const okFail = sRow.runs.flow.stopped && sRow.runs.flow.trace.length < 33 && !sA.valid && /stop rule \(flow\)/.test(sA.invalidBy.join()) && restored(fast)
    && !dA.valid && dA.invalidBy.length === 1 && /inlet not live/.test(dA.invalidBy[0])
    && !!bRow.exception && /readRows failed/.test(bRow.exception) && restored(broken) && !bA.valid
    && !hA.valid && hA.validTong2 && hA.invalidBy.length === 1 && /outside the bound/.test(hA.invalidBy[0]) && rel(hA.tauVW.flow, 0.21) < 1e-6;
  check("MOCK-FAILURES", okFail, { stopInvalidBy: sA.invalidBy, deadInvalidBy: dA.invalidBy, boundInvalidBy: hA.invalidBy, brokenException: String(bRow.exception).split("\n")[0] });
}

/** the served-source admission (tong2's, through tong2's runArm with tong3's arms) */
async function admissionCheck(geos) {
  const g = geos.find(x => x.id === "P640");
  const lf = Object.fromEntries(SERVED.map(p => [p, `// ${p}\nexport const x = 1;\n`]));
  const attempt = async opts => { const env = mockEnvironment(opts); const row = await T2.runArm(env.ctx, g); return { row, stepped: env.log.stages > 0 || env.log.stagedFlows.length > 0 }; };
  const same = await attempt({ served: lf });
  const viaFetch = await attempt({ served: lf, importThrows: ["src/main.ts"] });
  const changed = await attempt({ served: { ...lf, "src/lbm.ts": lf["src/lbm.ts"].replace("x = 1", "x = 2") } });
  const noFetch = await attempt({ served: lf, importThrows: ["src/sim.ts"], fetchStatus: 404 });
  const refused = x => /not admitted/.test(x.row.exception ?? "") && Object.keys(x.row.runs).length === 0 && !x.stepped;
  const ok = !same.row.exception && same.stepped && same.row.admission.ok
    && !viaFetch.row.exception && viaFetch.row.admission.vehicles["src/main.ts"] === "fetch"
    && refused(changed) && /served source differs: src\/lbm.ts/.test(changed.row.exception) && refused(noFetch)
    && !assess([changed.row], false).P640.valid;
  check("ADMISSION", ok, { refusedWith: String(changed.row.exception).split("\n")[0], vehicles: viaFetch.row.admission?.vehicles });
}

export async function selfTest() {
  const fetchSaved = globalThis.fetch, windowSaved = globalThis.window;
  // a step that throws is a FAIL with its message, and the later steps still run
  const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, { threw: String(e?.message ?? e).split("\n")[0] }); } };
  protocol();
  tong2Unchanged();
  const geos = parsing();
  await guard("WINDOW", () => windowFormula(geos));
  await guard("BOUND-FORMULA", () => boundFormula());
  await guard("VERDICT", () => verdicts(geos));
  await guard("MOCK", () => mockRun(geos));
  await guard("ADMISSION", () => admissionCheck(geos));
  check("RULES-FROZEN", Object.isFrozen(RULES) && Object.isFrozen(PROTOCOL) && Object.isFrozen(PROTOCOL.arms[0]) && Object.isFrozen(COST)
    && RULES.boundMax === 0.2 && RULES.convergenceMax === 0.01 && RULES.vBand === 0.10 && RULES.rLo === 1.26 && RULES.rHi === 1.54
    && PROTOCOL.row.tongVd0D === 0.0247 && PROTOCOL.window.P.substeps === 22143 && PROTOCOL.window.I.substeps === 88539, {});
  globalThis.fetch = fetchSaved;
  globalThis.window = windowSaved;
  console.log(`T3-SELFTEST ${failures ? `FAILED (${failures})` : "PASSED"} (CPU only; no browser, no GPU)`);
  return failures === 0;
}
