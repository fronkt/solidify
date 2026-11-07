// Browser-free self-test for scripts/research/flow-domain.mjs (D3.4). Never
// launches Chrome or touches a GPU. Checks: the protocol commit, the arm file's
// parsing (and its refusals), the staging math against values computed
// independently in Python, the tip/fit/mirror/velocity arithmetic on synthetic
// fields with known answers, the pre-registered decision on synthetic worlds,
// and the in-page driver end to end against a mock window.__solidify.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  PROTOCOL_COMMIT, PROTOCOL_HEADER, REPO, K, RULES, staging, geometry, parseArms, westTip, eastTip, columnMirror, slope, windows,
  summarizeRun, mirrorAsymmetry, velocityDiagnostics, HELPER_SRC, installDriver, runGeometry, assess, decide, classify,
} from "./flow-domain.mjs";

let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log(`FD-SELFTEST-${name}`, ok ? "OK" : "FAIL", JSON.stringify(detail ?? {})); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };
const ARMS = JSON.parse(readFileSync(new URL("./flow-domain-arms.json", import.meta.url), "utf8"));

function protocol() {
  let ok = true, detail = {};
  try {
    execFileSync("git", ["cat-file", "-e", `${PROTOCOL_COMMIT}^{commit}`], { cwd: REPO });
    execFileSync("git", ["merge-base", "--is-ancestor", PROTOCOL_COMMIT, "HEAD"], { cwd: REPO });
    const text = execFileSync("git", ["show", `${PROTOCOL_COMMIT}:tasks/todo.md`], { encoding: "utf8", maxBuffer: 64 << 20, cwd: REPO });
    const sec = text.slice(text.indexOf(PROTOCOL_HEADER));
    detail = { header: text.includes(PROTOCOL_HEADER), amended: sec.includes("AMENDED BEFORE ANY RUN"),
      decisionIds: ["D20-1024", "D24-848", "D24-1024", "D32-640", "D32-768", "D32-1024", "I24-704", "I24-448", "L32-1024", "L24-1024", "Z24-848"].filter(id => !sec.includes(id)) };
    ok = detail.header && detail.amended && detail.decisionIds.length === 0 && ARMS.protocolCommit === PROTOCOL_COMMIT;
  } catch (e) { ok = false; detail.error = String(e.message); }
  check("PROTOCOL", ok, { commit: PROTOCOL_COMMIT.slice(0, 7), ...detail });
}

function parsing() {
  const geos = parseArms(ARMS);
  const ids = geos.map(g => g.id);
  const want = ["D24-1024", "D32-1024", "D20-1024", "D32-640", "D24-848", "D32-768", "L32-1024", "L32-768", "I24-448", "I24-576", "I24-704", "L24-1024"];
  const decisionIds = ["D20-1024", "D24-848", "D24-1024", "D32-640", "D32-768", "D32-1024", "I24-704", "I24-448", "L32-1024", "L32-768", "L24-1024"];
  const mutate = f => { const j = JSON.parse(JSON.stringify(ARMS)); f(j); return () => parseArms(j); };
  const hostile = {
    nNot16: throwsWith(mutate(j => { j.geometries[0].n = 1000; }), /multiple of 16/),
    nOver1024: throwsWith(mutate(j => { j.geometries[0].n = 1360; j.geometries[0].seedX = 680; delete j.geometries[0].replica; }), /outside/),
    oddSeed: throwsWith(mutate(j => { j.geometries[3].seedX = 321; }), /seedX/),
    seedNearInlet: throwsWith(mutate(j => { j.geometries[8].seedX = 300; }), /inlet/),
    seedNearEast: throwsWith(mutate(j => { j.geometries[10].seedX = 800; }), /east tip/),
    lambdaNotRegistered: throwsWith(mutate(j => { j.geometries[0].lambda = 2.2; }), /not pre-registered/),
    duplicateId: throwsWith(mutate(j => { j.geometries[1].id = "D24-1024"; }), /duplicate/),
    unknownKey: throwsWith(mutate(j => { j.geometries[2].noise = 0.1; }), /unknown key/),
    familyMismatch: throwsWith(mutate(j => { j.geometries[8].family = "D"; }), /family/),
    replicaOffGeometry: throwsWith(mutate(j => { j.geometries[3].replica = { ratio: 1, vd0DNoflow: 0.017 }; }), /replica/),
    wrongProtocol: throwsWith(mutate(j => { j.protocolCommit = "81afc8d59f4789d167b33b030aa9a848b596c5ca"; }), /protocolCommit/),
  };
  check("PARSE", JSON.stringify(ids) === JSON.stringify(want) && decisionIds.every(id => ids.includes(id)) && Object.values(hostile).every(Boolean)
    && geos.filter(g => g.control).map(g => g.id).join() === "D24-848" && geos.filter(g => g.replica).length === 3, { ids: ids.length, hostile });
  return geos;
}

function stagingMath() {
  // independent values: Python 3 double arithmetic of the 11-01 formulas (2026-11-07)
  const py = {
    2.0: { dTilde: 1.2534, dt: 0.07659167065581618, vGuess: 0.04821314628351624, travelW0: 207.9764705882353, chunk: 1707, substeps: 56331,
      cellD0: 1.8101595203077272, uLat: 0.009503337481615567, mach: 0.016460263359631824, peCell: 0.06335558321077045, nuOverUCells: 364.60875 },
    2.4: { dTilde: 1.50408, dt: 0.06382639221318015, vGuess: 0.06942693064826339, travelW0: 173.31372549019608, chunk: 1185, substeps: 39105,
      cellD0: 2.1721914243692724, uLat: 0.011404004977938682, mach: 0.01975231603155819, peCell: 0.07602669985292455, nuOverUCells: 303.84062499999993 },
    3.2: { dTilde: 2.00544, dt: 0.04786979415988511, vGuess: 0.12342565448580156, travelW0: 129.98529411764707, chunk: 667, substeps: 22011,
      cellD0: 2.896255232492364, uLat: 0.015205339970584911, mach: 0.026336421375410923, peCell: 0.10136893313723275, nuOverUCells: 227.88046874999995 },
  };
  const bad = [];
  for (const l of K.LAMBDAS) {
    const s = staging(l), want = py[l];
    for (const [k, v] of Object.entries(want)) {
      const tol = ["peCell", "nuOverUCells"].includes(k) ? 1e-12 : 1e-15;
      if (Number.isInteger(v) ? s[k] !== v : !(rel(s[k], v) <= tol)) bad.push(`${l}:${k} ${s[k]} vs ${v}`);
    }
    if (!(Math.abs(s.nuLat - 3.465) < 1e-12 && Math.abs(s.tau - 10.895) < 1e-12 && Math.abs(s.diffusionNumber - 0.15) < 1e-15)) bad.push(`${l}: lattice`);
    if (!(s.mach <= 0.1 && s.peCell <= 2 && s.tau >= 0.51)) bad.push(`${l}: outside FLOW_LIMITS`);
    // the schedule spans 8 diffusion lengths at the KR speed to within one chunk
    if (!(Math.abs(s.substeps * s.dt - s.travelW0 / s.vGuess) <= s.chunk * s.dt)) bad.push(`${l}: schedule`);
  }
  check("STAGING", bad.length === 0, { bad, chunks: K.LAMBDAS.map(l => staging(l).chunk), seedRCells: staging(2.4).seedRCells, stop: K.STOP_CELLS });
}

function geometryMath(geos) {
  // independent values (Python): box, half-width and inlet distance in d0, cost units
  const py = {
    "D24-1024": [2224.324, 1112.162, 1112.162, 39105], "D32-1024": [2965.765, 1482.883, 1482.883, 22011],
    "D20-1024": [1853.603, 926.802, 926.802, 56331], "D32-640": [1853.603, 926.802, 926.802, 8598.047],
    "D24-848": [1842.018, 921.009, 921.009, 26817.858], "D32-768": [2224.324, 1112.162, 1112.162, 12381.1875],
    "L32-1024": [2965.765, 1482.883, 926.802, 22011], "L32-768": [2224.324, 1112.162, 926.802, 12381.1875],
    "I24-448": [2224.324, 1112.162, 973.142, 39105], "I24-576": [2224.324, 1112.162, 1251.182, 39105],
    "I24-704": [2224.324, 1112.162, 1529.223, 39105], "L24-1024": [2224.324, 1112.162, 921.009, 39105],
  };
  const bad = [];
  for (const g of geos) {
    const [box, half, inlet, units] = py[g.id];
    for (const [k, got, want] of [["box", g.boxD0, box], ["half", g.halfWidthD0, half], ["inlet", g.inletD0, inlet], ["units", g.units, units]])
      if (!(Math.abs(got - want) <= 1e-3)) bad.push(`${g.id}:${k} ${got} vs ${want}`);
  }
  const noflow = geos.reduce((a, g) => a + g.units, 0), flow = noflow + geos.filter(g => g.control).reduce((a, g) => a + g.units, 0);
  if (!(Math.abs(noflow - 356056.2795) < 1e-3 && Math.abs(flow - 382874.1372) < 1e-3)) bad.push(`totals ${noflow} ${flow}`);
  // the matched boxes the decision compares really are matched
  const by = Object.fromEntries(geos.map(g => [g.id, g]));
  if (!(rel(by["D32-640"].boxD0, by["D20-1024"].boxD0) < 1e-12 && rel(by["D32-768"].boxD0, by["D24-1024"].boxD0) < 1e-12
    && rel(by["D24-848"].boxD0, by["D20-1024"].boxD0) < 0.01 && rel(by["L32-1024"].inletD0, by["D32-640"].inletD0) < 1e-12
    && by["L24-1024"].inletD0 === by["D24-848"].inletD0)) bad.push("matched boxes");
  const minGap = Math.min(...geos.map(g => g.predictedEndGapCells)), eastMargin = Math.min(...geos.map(g => g.n - g.predictedNoflowEastCells));
  check("GEOMETRY", bad.length === 0, { bad, minPredictedEndGapCells: +minGap.toFixed(1), minEastMarginCells: +eastMargin.toFixed(1), units: { noflow, flow } });
}

function tipsAndFit() {
  const n = 1024, ramp = (i, at, sign) => Math.min(1, Math.max(0, 0.5 + sign * (i - at) / 2));
  const row = Array.from({ length: n }, (_, i) => Math.min(ramp(i, 100.3, 1), ramp(i, 700.6, -1)));
  const w = westTip(row, 512), e = eastTip(row, 512);
  const island = row.slice(); island[40] = 1; island[41] = 1;   // a detached solid west of the tip
  const empty = new Array(n).fill(0);
  const stopOnNaN = !(westTip(empty, 512) > K.STOP_CELLS);
  // the west tip runs at 0.1 cells/tau0 through sample 21 and 0.12 from there, so
  // the window choice shows: last third 0.12 x dx, middle third 0.1 x dx
  const tk = k => (k + 1) * 75.65, t21 = tk(21);
  const trace = Array.from({ length: 33 }, (_, k) => ({ k, t: tk(k), xEast: 524 + 0.05 * tk(k),
    xWest: k <= 21 ? 500 - 0.1 * tk(k) : 500 - 0.1 * t21 - 0.12 * (tk(k) - t21) }));
  const { last, mid } = windows(trace), s = summarizeRun(trace, 2.4);
  const ok = Math.abs(w - 100.3) < 1e-12 && Math.abs(e - 700.6) < 1e-12 && Math.abs(westTip(island, 512) - 100.3) < 1e-12
    && Number.isNaN(westTip(empty, 512)) && stopOnNaN
    && last.length === 11 && last[0].k === 22 && last.at(-1).k === 32 && mid.length === 11 && mid[0].k === 11 && mid.at(-1).k === 21
    && Math.abs(s.vLast - 0.096) < 1e-12 && Math.abs(s.vMid - 0.08) < 1e-12 && Math.abs(s.steadiness - 0.2) < 1e-9 && Math.abs(s.vEastLast - 0.04) < 1e-12
    && rel(s.vd0D, 1.2 * 0.019588940304593724) < 1e-12 && Math.abs(slope([{ t: 1, x: 3 }, { t: 2, x: 5 }, { t: 4, x: 9 }]) - 2) < 1e-12;
  check("TIPS-FIT", ok, { west: w, east: e, vLast: s.vLast, vd0D: s.vd0D, window: [last[0].k, last.at(-1).k] });
}

function mirrorAndVelocity() {
  const n = 16, field = new Float32Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const d = Math.abs(y - (n - 1) / 2); field[(y * n + x) * 4] = Math.exp(-d) * (x / n); field[(y * n + x) * 4 + 1] = -0.55 + 0.01 * d; }
  const sym = mirrorAsymmetry(field, n, 4, 0), symT = mirrorAsymmetry(field, n, 4, 1);
  const bent = field.slice(); bent[(3 * n + 5) * 4] += 0.25;
  const asym = mirrorAsymmetry(bent, n, 4, 0);
  const col = Array.from({ length: 200 }, (_, j) => Math.min(1, Math.max(0, 0.5 - (Math.abs(j - 99.5) - 70.25) / 2)));
  const cm = columnMirror(col, 100);
  const shifted = col.map((v, j) => (j >= 100 ? Math.min(1, Math.max(0, 0.5 - (j - 99.5 - 70.25 - 0.3) / 2)) : v));
  const cs = columnMirror(shifted, 100);
  const U = 0.0114, vel = new Float32Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const o = (y * n + x) * 4; vel[o] = U; vel[o + 1] = 0.001 * (y - (n - 1) / 2); vel[o + 2] = 1; }
  const v = velocityDiagnostics(vel, n, U, n / 2, 12.0);
  const velSym = vel.slice(); for (let y = 0; y < n; y++) velSym[(y * n + 3) * 4 + 1] = 0.002;
  const vs = velocityDiagnostics(velSym, n, U, n / 2, NaN);
  const ok = sym.max === 0 && symT.max === 0 && Math.abs(asym.max - 0.25) < 1e-6 && asym.atX === 5 && asym.atY === 3 && asym.cellsOver1e3 === 1
    && Math.abs(cm.mirror) < 1e-12 && Math.abs(cs.mirror - 0.3) < 1e-9
    && Math.abs(v.inletUx - 1) < 1e-6 && Math.abs(v.outletUx - 1) < 1e-6 && Math.abs(v.inletMassFlux - 1) < 1e-6 && Math.abs(v.ahead[2] - 1) < 1e-6
    && Math.abs(v.ahead[10] - 1) < 1e-6 && !(20 in v.ahead) && v.uxMirrorOverU === 0 && v.uyMirrorOverU < 1e-9 && v.nonFinite === 0
    && Math.abs(vs.uyMirrorOverU - 0.004 / U) < 1e-6 && Object.keys(vs.ahead).length === 0;
  check("MIRROR-VELOCITY", ok, { sym: sym.max, asym: asym.max, columnMirror: [cm.mirror, cs.mirror], inletUx: v.inletUx, uyMirror: vs.uyMirrorOverU });
}

function decisions(geos) {
  const by = Object.fromEntries(geos.map(g => [g.id, g]));
  const world = (f, patch = {}) => Object.fromEntries(geos.map(g => [g.id, { id: g.id, valid: true, V1: true, V3: true, ratio: f(g), flowSteadiness: 0, flowInletUx: 1, ...(patch[g.id] ?? {}) }]));
  const lo = by["D20-1024"].boxD0, hi = by["D32-1024"].boxD0;
  const domain = g => 1.259 + 0.097 * (g.boxD0 - lo) / (hi - lo);
  const lam = g => ({ 2: 1.259, 2.4: 1.329, 3.2: 1.356 })[g.lambda];
  const res = {
    domain: decide(world(domain)),
    lambda: decide(world(lam)),
    mixed: decide(world(g => 0.4 * domain(g) + 0.6 * lam(g))),
    opposite: decide(world(g => ({ 2: 1.25, 2.4: 1.33, 3.2: 1.40 })[g.lambda] - 0.05 * (g.boxD0 - lo) / (hi - lo))),
    missing: decide(world(domain, { "D32-640": { valid: false } })),
    no768: decide(world(domain, { "D32-768": { valid: false } })),
    pNegative: decide(world(g => ({ 2: 1.259, 2.4: 1.20, 3.2: 1.356 })[g.lambda])),
    triggers: decide(world(lam, { "D24-1024": { flowInletUx: 0.97 }, "I24-576": { flowSteadiness: 0.03 }, "L24-1024": { V3: false } })),
  };
  // each threshold on its own: dDiag 0.097 and p 0.070 fixed, f_D and S_D24/p set directly
  const direct = (fD, q, r768) => {
    const v = { "D20-1024": 1.259, "D32-1024": 1.356, "D32-640": 1.356 - fD * 0.097, "D24-1024": 1.329, "D24-848": 1.329 - q * 0.070 };
    v["D32-768"] = r768 ?? 0.5 * (v["D32-640"] + v["D32-1024"]);
    return decide(world(g => v[g.id] ?? 1.3)).H_D.verdict;
  };
  const bounds = {
    fD04q06: direct(0.4, 0.6) === "PARTIAL", fD06q04: direct(0.6, 0.4) === "PARTIAL", fD06q06: direct(0.6, 0.6) === "SUPPORTED",
    fD06q06nonMono: direct(0.6, 0.6, 1.40) === "PARTIAL", fD02q03: direct(0.2, 0.3) === "PARTIAL", fD03q02: direct(0.3, 0.2) === "PARTIAL",
    fD02q02: direct(0.2, 0.2) === "REJECTED", fDm03: direct(-0.3, 0.1) === "REJECTED (opposite sign)", fDm02: direct(-0.2, 0.1) === "REJECTED",
  };
  res.bounds = { H_D: { verdict: Object.values(bounds).every(Boolean) ? "all bounds hold" : JSON.stringify(bounds) } };
  const cls = [classify(0.03), classify(-0.031), classify(0.0149), classify(0.02), classify(null)];
  const iWorld = decide(world(g => (g.id === "I24-704" ? 1.36 : g.id === "I24-448" ? 1.33 : 1.3)));
  const ok = Object.values(bounds).every(Boolean)
    && res.domain.H_D.verdict === "SUPPORTED" && Math.abs(res.domain.H_D.fD - 1) < 1e-12 && res.domain.H_D.monotone32 === true
    && Math.abs(res.domain.H_L.boxIsHalfPlusInlet) < 1e-12 && res.domain.next.N1.fires === false
    && res.lambda.H_D.verdict === "REJECTED" && Math.abs(res.lambda.H_D.fD) < 1e-12 && res.lambda.next.N1.fires === true
    && res.mixed.H_D.verdict === "PARTIAL" && Math.abs(res.mixed.H_D.fD - 0.4) < 1e-9
    && res.opposite.H_D.verdict === "REJECTED (opposite sign)"
    && res.missing.H_D.verdict === "NO VERDICT" && /D32-640/.test(res.missing.H_D.why)
    && res.no768.H_D.verdict === "PARTIAL" && /cannot be SUPPORTED/.test(res.no768.H_D.note)
    && res.pNegative.H_D.verdict === "NO VERDICT"
    && res.triggers.next.N2.fires === true && res.triggers.next.N3.fires === true && res.triggers.next.N3.runs[0].id === "I24-576"
    && res.triggers.next.lateral.fires === true && res.lambda.next.N2.fires === false && res.lambda.next.N3.fires === false
    && JSON.stringify(cls) === JSON.stringify(["material", "material", "immaterial", "inconclusive", "not run"])
    && iWorld.H_I.verdict === "material" && Math.abs(iWorld.H_I.S_I - 0.03) < 1e-12;
  check("DECISION", ok, Object.fromEntries(Object.entries(res).map(([k, v]) => [k, `${v.H_D.verdict}${v.H_D.fD != null ? ` fD ${v.H_D.fD.toFixed(3)}` : ""}`])));
}

// ---- the in-page driver against a mock window.__solidify ----------------------

function mockEnvironment({ speed = { v0: 0.068, v1: 0.091, east: 0.04 }, failAtRead = null } = {}) {
  const STEP = () => 7;   // sentinel: the driver must put the app's step back
  const device = {
    adapterInfo: { vendor: "mock", architecture: "cpu", device: "", description: "flow-domain self-test", isFallbackAdapter: false },
    limits: { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxTextureDimension2D: 8192 },
    addEventListener() {}, lost: new Promise(() => {}),
    queue: { submit() {}, async onSubmittedWorkDone() {} },
    createBuffer({ size }) { const data = new Float32Array(size / 4); return { data, async mapAsync() {}, getMappedRange: () => data.buffer, unmap() {}, destroy() {} }; },
    createCommandEncoder() { return { copyTextureToBuffer(src, dst) { src.texture.fillInto(dst.buffer.data); }, finish: () => ({}) }; },
  };
  const log = { grids: [], stagedFlows: [] };
  const makeSim = n => {
    let reads = 0;
    const sim = {
      n, device, params: {}, flowCfg: { u: 0.02, pr: 23.1, scale: 1 }, flowOn: false, flowVelocity: null, t: 0, seed: null, step: STEP,
      setFlow(on) {
        this.flowOn = !!on;
        this.flowVelocity = on ? { fillInto: data => this.fillVelocity(data) } : null;
        if (on) log.stagedFlows.push({ ...this.flowCfg });
        return null;
      },
      reset() { this.t = 0; this.seed = null; },
      addSeed(x, y, r, th) { this.seed = { x, y, r, th }; },
      async stepSync(k) { this.t += k * this.params.dt; return k; },
      tips() {
        const { x, y, r } = this.seed, dx = this.params.dx, flow = this.flowOn && this.flowCfg.scale !== 0;
        const cx = x - 0.5, cy = y - 0.5, go = v => (v * this.t) / dx;
        return { cx, cy, west: cx - r - go(flow ? speed.v1 : speed.v0), east: cx + r + go(flow ? speed.east : speed.v0),
          north: cy + r + go(speed.v0), south: cy - r - go(speed.v0) };
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
          data[o] = Math.abs(j - tp.cy) <= 20 ? U * Math.min(1, Math.max(0, (tp.west - i) / 20)) : U;
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
  const ctx = {
    errors: [], rawDir: null,
    async open() {
      globalThis.window = { __solidify: S, __fdImport: async p => (p.endsWith("?raw") ? { default: "a\r\nb" }
        : { FLUX_WGSL: "f", PHI_WGSL: "p", TRANSPORT_WGSL: "t", STAMP_WGSL: "s", UPDATE_WGSL: "u", STATS_WGSL: "x" }) };
      globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
      globalThis.GPUBufferUsage = { COPY_DST: 8, MAP_READ: 1 };
      globalThis.GPUMapMode = { READ: 1 };
      const page = { evaluate: async (fn, arg) => clone(await fn(clone(arg))), close: async () => {} };
      await page.evaluate(installDriver, HELPER_SRC);
      return page;
    },
  };
  return { ctx, S, STEP, log, speed };
}

async function mockRun(geos) {
  const by = Object.fromEntries(geos.map(g => [g.id, g]));
  const env = mockEnvironment();
  const rows = [];
  for (const id of ["D24-1024", "D24-848"]) {
    rows.push(await runGeometry(env.ctx, by[id]));
    const sim = env.S.sim();
    if (!(sim.step === env.STEP && !sim.flowOn && sim.flowCfg.u === 0.02 && sim.flowCfg.scale === 1)) rows.at(-1).restoreFailed = true;
  }
  const { byId, Z } = assess(rows, true);
  const r1 = byId["D24-1024"], r2 = byId["D24-848"], want = env.speed.v1 / env.speed.v0;
  const fl = r1.runs.flow;
  const staged = env.log.stagedFlows;
  const ok = rows.every(r => !r.exception && !r.restoreFailed && r.V1 && r.V3 && r.valid)
    && rel(r1.ratio, want) < 1e-9 && rel(r2.ratio, want) < 1e-9 && rel(r1.vNoflow, env.speed.v0) < 1e-9
    && r1.runs.noflow.trace.length === 33 && fl.trace.every(p => p.delivered === by["D24-1024"].staging.chunk)
    && Math.abs(fl.end.mirror) < 1e-6 && fl.end.asymPhi.max < 1e-6 && Math.abs(fl.end.vel.inletUx - 1) < 1e-6
    && fl.end.vel.ahead[2] >= 0.1 && fl.end.vel.ahead[2] < 0.15 && r1.runs.noflow.end.vel === null
    && Z.run && Z.ok && Z.traceEqual && Z.ratio === 1 && r2.V2 === true && Math.abs(r2.V2dev) < 1e-12
    && JSON.stringify(env.log.grids) === "[848]" && staged.length === 3 && staged[0].scale === 1 && staged[2].scale === 0
    && rel(staged[0].u, by["D24-1024"].staging.uLat) < 1e-15 && staged[0].pr === 23.1
    && r1.metadata.hardware.isFallbackAdapter === false && r1.metadata.wgsl.FLUX_WGSL.length === 64
    && decide(byId).H_D.verdict === "NO VERDICT";
  check("MOCK-RUN", ok, { ratio: [r1.ratio, r2.ratio], want, Z, grids: env.log.grids, endGap: r1.endGap, wallMs: rows.map(r => r.wallMs) });

  // a tip that runs into the inlet stops early and invalidates the geometry
  const fast = mockEnvironment({ speed: { v0: 0.12, v1: 0.6, east: 0.06 } });
  const sRow = await runGeometry(fast.ctx, by["D32-640"]);
  const sA = assess([sRow], true).byId["D32-640"];
  // a failed readback mid-run is recorded and the app's step is still restored
  const broken = mockEnvironment({ failAtRead: 5 });
  const bRow = await runGeometry(broken.ctx, by["D32-1024"]);
  const bA = assess([bRow], true).byId["D32-1024"];
  // a page that is not the hashed code is refused before any stepping
  const refused = mockEnvironment();
  refused.ctx.admit = () => { throw new Error("not admitted: served source differs: src/lbm.ts"); };
  const rRow = await runGeometry(refused.ctx, by["D24-1024"]);
  const okRefuse = /not admitted/.test(rRow.exception) && Object.keys(rRow.runs).length === 0 && refused.log.stagedFlows.length === 0;
  const okFail = okRefuse &&sRow.runs.flow.stopped && sRow.runs.flow.trace.length < 33 && !sA.V1 && !sA.valid && sA.V1issues.some(x => /stopped early/.test(x))
    && !!bRow.exception && /readRows failed/.test(bRow.exception) && bRow.runs.noflow.finished === true
    && broken.S.sim().step === broken.STEP && !bA.V1 && !bA.valid;
  check("MOCK-FAILURES", okFail, { stoppedAt: sRow.runs.flow.trace.length, stoppedIssues: sA.V1issues, brokenException: String(bRow.exception).split("\n")[0], refusedBeforeStepping: okRefuse });
}

export async function selfTest() {
  protocol();
  const geos = parsing();
  stagingMath();
  geometryMath(geos);
  tipsAndFit();
  mirrorAndVelocity();
  decisions(geos);
  await mockRun(geos);
  check("RULES-FROZEN", Object.isFrozen(RULES) && Object.isFrozen(K) && RULES.material === 0.03 && RULES.mirrorTol === 0.05 && K.STOP_CELLS === 32, {});
  console.log(`FD-SELFTEST ${failures ? `FAILED (${failures})` : "PASSED"} (CPU only; no browser, no GPU)`);
  return failures === 0;
}
