// D3.4 flow domain study: a research study, NOT a regression gate.
//
// It asks whether FLOW-TIP-TONG's rise of the upstream/no-flow tip-speed ratio
// with lambda (11-01: 1.259 / 1.329 / 1.356 at lambda 2.0 / 2.4 / 3.2, with the
// box in d0 rising alongside because n was fixed) is a domain effect. Lambda and
// the Karma-Rappel staging are held fixed while the box (in d0), the inlet
// distance and the half-width are varied one at a time. It never re-scores
// FLOW-TIP-TONG, which stays FAILED.
//
// Protocol: tasks/todo.md "D3.4 flow domain study - 2026-11-07", committed (and
// amended) before any run; PROTOCOL_COMMIT below. Arms: flow-domain-arms.json,
// validated here against the protocol's fixed staging.
//
//   node scripts/research/flow-domain.mjs [--self-test]   CPU only (the default)
//   node scripts/research/flow-domain.mjs --plan          arm table and GPU cost
//   node scripts/research/flow-domain.mjs --run [--port 5201] [--arms ID,ID]
//
// --run drives Chrome/WebGPU and needs a Vite server for THIS worktree
// (`npx vite --port 5201 --strictPort`); it checks that the served source bytes
// equal the worktree's. It writes docs/validation/flow-domain-<date>.json (every
// tip trace, run metadata, validity witnesses, the pre-registered decision) and
// the raw centre rows to verify-out/flow-domain-<date>/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const PROTOCOL_COMMIT = "8ad00f6837c0040e99cbf78f9c49bf53ddf6f62f";
export const PROTOCOL_HEADER = "## D3.4 flow domain study - 2026-11-07";
const ARMS_PATH = fileURLToPath(new URL("./flow-domain-arms.json", import.meta.url));
/** the repository root: every path below is relative to it, whatever the cwd */
export const REPO = fileURLToPath(new URL("../../", import.meta.url));

/** the fixed staging: FLOW-TIP-TONG's (= QPF-TIP-KR's) numbers, unchanged */
export const K = Object.freeze({
  A1: 0.8839, A2: 0.6267, DELTA: 0.55, EPS4: 0.05, REF: 0.017, PR: 23.1, UD0D: 0.035,
  DX: 0.8, SEED_R_W0: 8, NS: 33, TRAVEL_LD: 8, STOP_CELLS: 32,
  LAMBDAS: Object.freeze([2.0, 2.4, 3.2]),
  /** flowRefusal() refuses flow above 1024, and main.ts re-checks it every frame */
  N_MAX: 1024, N_MIN: 256,
});

/** pre-registered thresholds (tasks/todo.md D3.4) */
export const RULES = Object.freeze({
  replicaRatioTol: 0.0005, replicaVTol: 0.000005, refTol: 0.02, mirrorTol: 0.05,
  material: 0.03, immaterial: 0.015, support: 0.5, reject: 0.25, opposite: -0.25,
  inflowTrigger: 0.98, windowTrigger: 0.02, zInletMin: 0.5, zAheadMax: 0.9,
});

/** 11-01's measured upper bound on GPU cost: 574 s for 313104 units */
export const MS_PER_UNIT = 574000 / 313104;

/** files whose bytes define what ran (hashed before and after; served copies checked) */
export const HASHED = ["src/sim.ts", "src/shaders.ts", "src/lbm.ts", "src/flow.ts", "src/main.ts", "src/render.ts",
  "scripts/research/flow-domain.mjs", "scripts/research/flow-domain-selftest.mjs", "scripts/research/flow-domain-arms.json",
  "scripts/browser-cleanup.mjs"];
export const SERVED = ["src/sim.ts", "src/shaders.ts", "src/lbm.ts", "src/flow.ts", "src/main.ts", "src/render.ts"];

// ------------------------------------------------------------ staging math

/** every number a lambda's runs are staged with, computed exactly as 11-01 did */
export function staging(lambda) {
  const { A1, A2, DX, REF, NS, TRAVEL_LD, PR, UD0D, SEED_R_W0 } = K;
  const dx = DX, dTilde = A2 * lambda, dt = (0.15 * dx * dx) / Math.max(1, dTilde);
  const vGuess = (REF * dTilde * lambda) / A1;               // W0 per tau0
  const travel = (TRAVEL_LD * dTilde) / vGuess;             // = 8 l_D, in W0
  const chunk = Math.max(50, Math.round(travel / vGuess / NS / dt));
  const uLat = UD0D * (lambda / A1) * 0.15 * dx;            // cells per substep
  const d = (dTilde * dt) / (dx * dx);                      // diffusion number (0.15)
  const nuLat = d * PR, tau = 0.5 + 3 * nuLat;
  return {
    lambda, dx, dTilde, dt, vGuess, travelW0: travel, travelCells: travel / dx, chunk, substeps: chunk * NS,
    uLat, diffusionNumber: d, nuLat, tau, mach: uLat * Math.sqrt(3), peCell: uLat / d,
    cellD0: (dx * lambda) / A1, lDCells: dTilde / vGuess / dx, nuOverUCells: nuLat / uLat,
    seedRCells: SEED_R_W0 / dx,
  };
}

/** derived geometry of one arm: lengths in d0, cost, predicted clearances */
export function geometry(g) {
  const s = staging(g.lambda), seedY = g.n / 2;
  return {
    ...g, seedY, staging: s,
    boxD0: g.n * s.cellD0, halfWidthD0: seedY * s.cellD0, inletD0: g.seedX * s.cellD0, outletD0: (g.n - g.seedX) * s.cellD0,
    units: (g.n / 1024) ** 2 * s.substeps,
    // conservative: flow ratio 1.45 (above every measured one), 15 cells of seed transient
    predictedEndGapCells: g.seedX - s.seedRCells - 1.45 * s.travelCells - 15,
    predictedNoflowEastCells: g.seedX + s.seedRCells + s.travelCells + 15,
  };
}

/** validate the arm file against the protocol; throws with the reason */
export function parseArms(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("arms: not an object");
  for (const k of Object.keys(json)) if (!["study", "protocol", "protocolCommit", "geometries"].includes(k)) throw new Error(`arms: unknown key ${k}`);
  if (json.protocolCommit !== PROTOCOL_COMMIT) throw new Error(`arms: protocolCommit ${json.protocolCommit} is not ${PROTOCOL_COMMIT}`);
  if (!Array.isArray(json.geometries) || !json.geometries.length) throw new Error("arms: no geometries");
  const seen = new Set(), out = [];
  for (const g of json.geometries) {
    if (!g || typeof g !== "object") throw new Error("arms: geometry not an object");
    for (const k of Object.keys(g)) if (!["id", "family", "lambda", "n", "seedX", "control", "replica"].includes(k)) throw new Error(`arms: ${g.id}: unknown key ${k}`);
    if (typeof g.id !== "string" || !/^[DIL]\d\d-\d+$/.test(g.id)) throw new Error(`arms: bad id ${g.id}`);
    if (seen.has(g.id)) throw new Error(`arms: duplicate id ${g.id}`);
    seen.add(g.id);
    if (!["D", "I", "L"].includes(g.family) || g.id[0] !== g.family) throw new Error(`arms: ${g.id}: family ${g.family}`);
    if (!K.LAMBDAS.includes(g.lambda)) throw new Error(`arms: ${g.id}: lambda ${g.lambda} not pre-registered`);
    if (!Number.isInteger(g.n) || g.n % 16 !== 0) throw new Error(`arms: ${g.id}: n ${g.n} must be a multiple of 16 (readRows)`);
    if (g.n < K.N_MIN || g.n > K.N_MAX) throw new Error(`arms: ${g.id}: n ${g.n} outside [${K.N_MIN}, ${K.N_MAX}] (the frame loop turns flow off above 1024)`);
    if (!Number.isInteger(g.seedX) || g.seedX % 2 !== 0 || g.seedX <= 0 || g.seedX >= g.n) throw new Error(`arms: ${g.id}: seedX ${g.seedX}`);
    if (g.control !== undefined && g.control !== true) throw new Error(`arms: ${g.id}: control must be true or absent`);
    if (g.replica !== undefined) {
      const r = g.replica;
      if (!r || !Number.isFinite(r.ratio) || !Number.isFinite(r.vd0DNoflow) || Object.keys(r).length !== 2) throw new Error(`arms: ${g.id}: replica`);
      if (g.n !== 1024 || g.seedX !== 512 || g.family !== "D") throw new Error(`arms: ${g.id}: a replica must be the 11-01 geometry`);
    }
    const geo = geometry(g);
    if (!(geo.predictedEndGapCells > K.STOP_CELLS + 16)) throw new Error(`arms: ${g.id}: west tip predicted within ${geo.predictedEndGapCells.toFixed(1)} cells of the inlet`);
    if (!(geo.predictedNoflowEastCells < g.n - K.STOP_CELLS)) throw new Error(`arms: ${g.id}: no-flow east tip predicted at ${geo.predictedNoflowEastCells.toFixed(1)} of ${g.n}`);
    out.push(geo);
  }
  return out;
}

// ------------------------------------------------------------ measurement

/** 11-01's west tip: first phi = 0.5 crossing scanning west from `from` */
export function westTip(row, from) {
  for (let i = from; i > 0; i--) if (row[i] >= 0.5 && row[i - 1] < 0.5) {
    const a = row[i - 1], b = row[i];
    return (i - 1) + (0.5 - a) / (b - a);
  }
  return NaN;
}

/** the mirror image: first crossing scanning east from `from` */
export function eastTip(row, from) {
  for (let i = from; i < row.length - 1; i++) if (row[i] >= 0.5 && row[i + 1] < 0.5) {
    const a = row[i], b = row[i + 1];
    return i + (a - 0.5) / (a - b);
  }
  return NaN;
}

/** north (scan up from `from`) and south (scan down from `from - 1`) crossings on a
 *  column, and the mirror defect yN + yS - (n - 1), zero for a field symmetric
 *  about y = (n - 1)/2 */
export function columnMirror(col, from) {
  const n = col.length;
  let yN = NaN, yS = NaN;
  for (let j = from; j < n - 1; j++) if (col[j] >= 0.5 && col[j + 1] < 0.5) { yN = j + (col[j] - 0.5) / (col[j] - col[j + 1]); break; }
  for (let j = from - 1; j > 0; j--) if (col[j] >= 0.5 && col[j - 1] < 0.5) { yS = j - (col[j] - 0.5) / (col[j] - col[j - 1]); break; }
  const mirror = yN + yS - (n - 1);
  return { yN: Number.isFinite(yN) ? yN : null, yS: Number.isFinite(yS) ? yS : null, mirror: Number.isFinite(mirror) ? mirror : null };
}

/** least-squares slope of x against t (11-01's arithmetic) */
export function slope(points) {
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) { sx += p.t; sy += p.x; sxy += p.t * p.x; sxx += p.t * p.t; }
  return (points.length * sxy - sx * sy) / (points.length * sxx - sx * sx);
}

/** 11-01's window (last third) and the middle third for the plateau check */
export function windows(trace) {
  const third = Math.floor(trace.length / 3);
  return { last: trace.slice(2 * third), mid: trace.slice(third, 2 * third) };
}

/** speeds of one run in W0/tau0 and V d0/D */
export function summarizeRun(trace, lambda) {
  const { last, mid } = windows(trace);
  const west = w => w.map(p => ({ t: p.t, x: p.xWest })), east = w => w.map(p => ({ t: p.t, x: p.xEast }));
  const vLast = -slope(west(last)) * K.DX, vMid = -slope(west(mid)) * K.DX;
  const vEastLast = slope(east(last)) * K.DX;
  const endX = trace.at(-1)?.xWest;
  return {
    vLast, vMid, steadiness: vLast / vMid - 1, vEastLast,
    vd0D: (vLast * K.A1) / (K.A2 * lambda * lambda),
    samples: trace.length, windowSamples: last.map(p => p.k), endX, endGapCells: endX + 0.5,
  };
}

// ------------------------------------------------------------ in-page helpers
// Pure and self-contained: their source text is shipped into the page, so the
// self-test runs exactly the code the GPU run does.

/** max |f(x,y) - f(x,n-1-y)| over a row-major field with `stride` channels */
export function mirrorAsymmetry(data, n, stride, channel) {
  let max = 0, sum = 0, over = 0, at = -1;
  for (let y = 0; y < (n >> 1); y++) {
    const ym = n - 1 - y;
    for (let x = 0; x < n; x++) {
      const d = Math.abs(data[(y * n + x) * stride + channel] - data[(ym * n + x) * stride + channel]);
      sum += d;
      if (d > 1e-3) over++;
      if (d > max) { max = d; at = y * n + x; }
    }
  }
  return { max, mean: sum / ((n >> 1) * n), cellsOver1e3: over, atX: at < 0 ? null : at % n, atY: at < 0 ? null : Math.floor(at / n) };
}

/** the LBM velocity (rgba32float: u.x, u.y, rho, drag) summarized against the
 *  nominal inflow U; `xTip` is the west tip on row `seedY` (cell index) */
export function velocityDiagnostics(vel, n, U, seedY, xTip) {
  const at = (x, y, c) => vel[(y * n + x) * 4 + c];
  const col = (x, f) => { let s = 0; for (let y = 0; y < n; y++) s += f(x, y); return s / n; };
  const ux = (x, y) => at(x, y, 0), rho = (x, y) => at(x, y, 2), flux = (x, y) => at(x, y, 0) * at(x, y, 2);
  const ahead = {};
  if (Number.isFinite(xTip)) for (const d of [2, 5, 10, 20, 50, 100, 200]) {
    const x = Math.floor(xTip) - d;
    if (x >= 0) ahead[d] = 0.5 * (ux(x, seedY) + ux(x, seedY - 1)) / U;
  }
  let maxSpeed = 0, rhoMin = Infinity, rhoMax = -Infinity, uxMirror = 0, uyMirror = 0, nonFinite = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = at(x, y, 0), b = at(x, y, 1), r = at(x, y, 2);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(r)) { nonFinite++; continue; }
    maxSpeed = Math.max(maxSpeed, Math.hypot(a, b));
    rhoMin = Math.min(rhoMin, r); rhoMax = Math.max(rhoMax, r);
    if (y < (n >> 1)) {
      const ym = n - 1 - y;
      uxMirror = Math.max(uxMirror, Math.abs(a - at(x, ym, 0)));
      uyMirror = Math.max(uyMirror, Math.abs(b + at(x, ym, 1)));
    }
  }
  return {
    inletUx: col(0, ux) / U, x1Ux: col(1, ux) / U, x8Ux: col(8, ux) / U, outletUx: col(n - 1, ux) / U,
    inletRho: col(0, rho), outletRho: col(n - 1, rho), inletMassFlux: col(0, flux) / U, outletMassFlux: col(n - 1, flux) / U,
    ahead, maxSpeedOverU: maxSpeed / U, rhoMin, rhoMax, uxMirrorOverU: uxMirror / U, uyMirrorOverU: uyMirror / U, nonFinite,
  };
}

export const HELPER_SRC = { mirrorAsymmetry: mirrorAsymmetry.toString(), velocityDiagnostics: velocityDiagnostics.toString() };

// ------------------------------------------------------------ in-page driver
// Installed with page.evaluate(installDriver, HELPER_SRC). It reproduces
// flow-tip-tong.mjs's arm staging line for line; the loop itself is driven from
// Node one chunk at a time, so the tip arithmetic above is the only copy.
export function installDriver(helperSrc) {
  const S = window.__solidify;
  if (!S) throw new Error("window.__solidify missing");
  const H = {};
  for (const [name, src] of Object.entries(helperSrc)) H[name] = (0, eval)(`(${src})`);
  const errors = [];
  const watched = new WeakSet();
  const watch = device => {
    if (!device || watched.has(device)) return;
    watched.add(device);
    device.addEventListener?.("uncapturederror", e => errors.push({ kind: "device", message: String(e?.error?.message ?? e) }));
    device.lost?.then(info => errors.push({ kind: "device-lost", reason: info?.reason ?? null, message: info?.message ?? null }));
  };
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sha = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map(v => v.toString(16).padStart(2, "0")).join("");
  const load = window.__fdImport ?? (p => import(p));
  let armed = null;
  async function readTexture(device, texture, n) {
    const bpr = n * 16;
    const buf = device.createBuffer({ size: bpr * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture }, { buffer: buf, bytesPerRow: bpr }, [n, n]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(buf.getMappedRange().slice(0));
      buf.unmap();
      return out;
    } finally { buf.destroy(); }
  }
  window.__fd = {
    errors: () => errors.slice(),
    async metadata(paths) {
      const device = S.sim().device;
      watch(device);
      const i = device.adapterInfo ?? {};
      const served = {};
      for (const p of paths) {
        // Run 1 (2026-11-07): Vite answers the ?raw IMPORT of the HTML entry
        // module (src/main.ts) with untransformed TypeScript, which throws; a
        // fetch of the same ?raw URL returns its exact text. Fall back only on
        // a throw, record the vehicle, and keep the exact hash comparison.
        try {
          let text, via = "import", importError;
          try { text = (await load(`/${p}?raw`)).default; }
          catch (e) {
            importError = String(e?.message ?? e).slice(0, 160);
            const r = await fetch(`/${p}?raw`);
            if (!r.ok) throw new Error(`fetch ${r.status} after import failed: ${importError}`);
            text = await r.text(); via = "fetch";
          }
          served[p] = { raw: await sha(text), lf: await sha(text.replace(/\r\n/g, "\n")), via, ...(importError ? { importError } : {}) };
        } catch (e) { served[p] = { error: String(e?.message ?? e) }; }
      }
      const wgsl = {};
      try {
        const m = await load("/src/shaders.ts");
        for (const k of ["FLUX_WGSL", "PHI_WGSL", "TRANSPORT_WGSL", "STAMP_WGSL", "UPDATE_WGSL", "STATS_WGSL"])
          wgsl[k] = typeof m[k] === "string" ? await sha(m[k]) : null;
      } catch (e) { wgsl.error = String(e?.message ?? e); }
      return {
        hardware: { vendor: i.vendor ?? null, architecture: i.architecture ?? null, device: i.device ?? null,
          description: i.description ?? null, isFallbackAdapter: i.isFallbackAdapter ?? null },
        limits: { maxStorageBufferBindingSize: device.limits?.maxStorageBufferBindingSize ?? null,
          maxBufferSize: device.limits?.maxBufferSize ?? null, maxTextureDimension2D: device.limits?.maxTextureDimension2D ?? null },
        served, wgsl, userAgent: navigator.userAgent, appSeed: S.seed?.() ?? null,
      };
    },
    async stage(c) {
      if (armed) throw new Error("stage: the previous run was not finished");
      S.app.setRun(false);
      await frames();
      if (S.sim().n !== c.n) S.app.setGrid(c.n);
      const sim = S.sim();
      if (sim.n !== c.n) throw new Error(`stage: grid is ${sim.n}, wanted ${c.n}`);
      watch(sim.device);
      const f = sim.step;
      sim.step = () => 0;
      armed = { sim, f, c };
      await sim.device.queue.onSubmittedWorkDone();
      S.app.setInoculant(0);
      Object.assign(sim.params, { solver: 1, lambda: c.lambda, dx: c.dx, dt: c.dt, epsBar: 1, tau: 1, delta: c.eps4, aniMode: 4, noiseAmp: 0,
        latent: 1, dTherm: c.dTilde, dSol: c.dTilde, alloyOn: 0, coolRate: 0, heatIn: 0, scen: 0, twinProb: 0, facet: 0, frozenT: 0 });
      if (c.flow) {
        Object.assign(sim.flowCfg, { u: c.uLat, pr: c.pr, scale: c.flow.scale });
        const why = sim.setFlow(true);
        if (why) throw new Error(`stage: flow refused: ${why}`);
      } else sim.setFlow(false);
      sim.reset(1 - c.delta);
      sim.addSeed(c.seedX, c.seedY, c.seedR, 0);
      await sim.stepSync(0);
      const p = sim.params;
      return { n: sim.n, flowOn: sim.flowOn, flowCfg: { ...sim.flowCfg },
        params: { solver: p.solver, lambda: p.lambda, dx: p.dx, dt: p.dt, dTherm: p.dTherm, delta: p.delta, noiseAmp: p.noiseAmp, frozenT: p.frozenT, tFar: p.tFar } };
    },
    async advance(k) {
      if (!armed) throw new Error("advance: not staged");
      const { sim, c } = armed;
      const t0 = performance.now();
      const got = await sim.stepSync(k);
      const d = await sim.readRows(c.seedY, 1);
      if (!d) throw new Error("advance: readRows failed");
      const row = new Array(sim.n);
      for (let i = 0; i < sim.n; i++) row[i] = d[i * 4];
      return { got, row, flowOn: sim.flowOn, ms: performance.now() - t0 };
    },
    async end(xWest) {
      if (!armed) throw new Error("end: not staged");
      const { sim, c } = armed, n = sim.n;
      const all = await sim.readRows(0, n);
      if (!all) throw new Error("end: readRows failed");
      const column = new Array(n), tRow = new Array(n);
      for (let y = 0; y < n; y++) column[y] = all[(y * n + c.seedX) * 4];
      for (let x = 0; x < n; x++) tRow[x] = all[(c.seedY * n + x) * 4 + 1];
      let nonFinite = 0;
      for (let i = 0; i < n * n * 4; i++) if (!Number.isFinite(all[i])) nonFinite++;
      const vel = sim.flowVelocity ? H.velocityDiagnostics(await readTexture(sim.device, sim.flowVelocity, n), n, c.uLat, c.seedY, xWest) : null;
      return { column, tRow, nonFinite, asymPhi: H.mirrorAsymmetry(all, n, 4, 0), asymT: H.mirrorAsymmetry(all, n, 4, 1), vel, flowOn: sim.flowOn };
    },
    async finish() {
      if (!armed) return false;
      const { sim, f } = armed;
      try {
        await sim.device.queue.onSubmittedWorkDone();
        sim.setFlow(false);
        Object.assign(sim.flowCfg, { u: 0.02, pr: 23.1, scale: 1 });
      } finally { sim.step = f; armed = null; }
      return true;
    },
  };
  return true;
}

// ------------------------------------------------------------ orchestration

const b64 = arr => Buffer.from(Float32Array.from(arr).buffer).toString("base64");

/** one run (no flow, flow, or the coupling-0 control) of one geometry */
export async function runOne(ctx, page, g, kind) {
  const s = g.staging;
  const scale = kind === "flow" ? 1 : 0;
  const cfg = { lambda: g.lambda, n: g.n, seedX: g.seedX, seedY: g.seedY, dx: s.dx, dt: s.dt, dTilde: s.dTilde, eps4: K.EPS4,
    delta: K.DELTA, uLat: s.uLat, pr: K.PR, seedR: K.SEED_R_W0 / K.DX, flow: kind === "noflow" ? null : { scale } };
  const run = { kind, scale: kind === "noflow" ? null : scale, trace: [], stopped: false, flowLost: false };
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
      if (kind !== "noflow" && !a.flowOn) run.flowLost = true;
      if (!(xWest > K.STOP_CELLS)) { run.stopped = true; break; }
    }
    run.summary = summarizeRun(run.trace, g.lambda);
    const e = await page.evaluate(x => window.__fd.end(x), run.trace.at(-1).xWest);
    if (kind !== "noflow" && !e.flowOn) run.flowLost = true;
    run.end = { ...columnMirror(e.column, g.seedY), nonFinite: e.nonFinite, asymPhi: e.asymPhi, asymT: e.asymT, vel: e.vel };
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

/** one geometry in its own page: no flow, flow, then the control if registered */
export async function runGeometry(ctx, g) {
  const row = { id: g.id, family: g.family, lambda: g.lambda, n: g.n, seedX: g.seedX, seedY: g.seedY, control: !!g.control,
    replica: g.replica ?? null, boxD0: g.boxD0, halfWidthD0: g.halfWidthD0, inletD0: g.inletD0, outletD0: g.outletD0,
    units: g.units, chunk: g.staging.chunk, runs: {}, started: new Date().toISOString() };
  const before = ctx.errors.length, t0 = Date.now();
  let page = null;
  try {
    page = await ctx.open(g);
    row.metadata = await page.evaluate(paths => window.__fd.metadata(paths), SERVED);
    ctx.admit?.(row.metadata);   // throws before any GPU stepping if the page is not the code we hashed
    for (const kind of ["noflow", "flow", ...(g.control ? ["control"] : [])]) {
      row.runs[kind] = await runOne(ctx, page, g, kind);
      if (row.runs[kind].error) throw new Error(`${kind}: ${row.runs[kind].error}`);
    }
  } catch (err) {
    row.exception = err?.stack ?? String(err);
  } finally {
    if (page) {
      try { ctx.errors.push(...(await page.evaluate(() => window.__fd.errors())).map(x => ({ geometry: g.id, ...x }))); }
      catch (err) { ctx.errors.push({ geometry: g.id, kind: "error-readback", message: String(err?.message ?? err) }); }
      await page.close().catch(err => ctx.errors.push({ geometry: g.id, kind: "page-close", message: String(err?.message ?? err) }));
    }
    row.wallMs = Date.now() - t0;
    row.errors = ctx.errors.slice(before);
  }
  return row;
}

/** the validity witnesses V1, V2, V3, Z and REPLICA, in place on the rows */
export function assess(rows, served) {
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  for (const r of rows) {
    const runs = Object.values(r.runs), nf = r.runs.noflow, fl = r.runs.flow;
    r.vNoflow = nf?.summary?.vLast ?? null;
    r.vFlow = fl?.summary?.vLast ?? null;
    r.ratio = r.vNoflow && r.vFlow != null ? r.vFlow / r.vNoflow : null;
    r.vd0DNoflow = nf?.summary?.vd0D ?? null;
    r.flowSteadiness = fl?.summary?.steadiness ?? null;
    r.flowInletUx = fl?.end?.vel?.inletUx ?? null;
    r.endGap = fl?.summary ? { cells: fl.summary.endGapCells, d0: fl.summary.endGapCells * staging(r.lambda).cellD0,
      nuOverU: fl.summary.endGapCells / staging(r.lambda).nuOverUCells } : null;
    const issues = [];
    if (r.exception) issues.push("exception");
    if (runs.length < 2 + (r.control ? 1 : 0)) issues.push("runs missing");
    for (const run of runs) {
      if (run.error || run.finishError) issues.push(`${run.kind}: error`);
      if (run.stopped) issues.push(`${run.kind}: stopped early`);
      if (run.trace.length !== K.NS) issues.push(`${run.kind}: ${run.trace.length} samples`);
      if (!run.trace.every(p => p.delivered === r.chunk)) issues.push(`${run.kind}: short chunk`);
      if (run.flowLost) issues.push(`${run.kind}: flow switched off during the run`);
      if (run.end?.nonFinite) issues.push(`${run.kind}: non-finite state`);
      if (!Number.isFinite(run.summary?.vLast)) issues.push(`${run.kind}: no speed`);
    }
    if (r.errors?.length) issues.push(`${r.errors.length} page/device errors`);
    if (!served) issues.push("served source not verified");
    r.V1 = issues.length === 0;
    r.V1issues = issues;
    const mirrorRuns = [fl, r.runs.control].filter(Boolean);
    r.V3 = mirrorRuns.length > 0 && mirrorRuns.every(run => run.end?.mirror != null && Math.abs(run.end.mirror) <= RULES.mirrorTol);
  }
  for (const r of rows) {
    const ref = rows.find(x => x.family === "D" && x.lambda === r.lambda && x.n === 1024 && x.seedX === 512);
    if (!ref || !ref.V1) { r.V2 = null; r.V2dev = null; continue; }
    r.V2dev = r.vNoflow / ref.vNoflow - 1;
    r.V2 = Math.abs(r.V2dev) <= RULES.refTol;
  }
  const ctl = rows.find(r => r.control);
  let Z = { run: false };
  if (ctl) {
    const c = ctl.runs.control, nf = ctl.runs.noflow;
    const traceEqual = !!c && !!nf && c.trace.length === nf.trace.length && c.trace.every((p, i) => p.xWest === nf.trace[i].xWest);
    const ratio = c?.summary && nf?.summary ? c.summary.vLast / nf.summary.vLast : null;
    const inletUx = c?.end?.vel?.inletUx ?? null, ahead2 = c?.end?.vel?.ahead?.[2] ?? null;
    Z = { run: true, id: ctl.id, traceEqual, ratio, inletUx, ahead2,
      ok: ctl.V1 && traceEqual && ratio === 1 && inletUx != null && inletUx >= RULES.zInletMin && ahead2 != null && ahead2 <= RULES.zAheadMax };
  }
  for (const r of rows) {
    const why = [];
    if (!r.V1) why.push("V1");
    if (r.V2 === false) why.push("V2");
    if (!r.V3) why.push("V3");
    if (Z.run && !Z.ok && r.n !== 1024) why.push("Z");
    r.valid = why.length === 0;
    r.voidBy = why;
    if (r.replica) {
      const dr = r.ratio - r.replica.ratio, dv = r.vd0DNoflow - r.replica.vd0DNoflow;
      r.replicaCheck = { ratioDiff: dr, vd0DDiff: dv, ok: Math.abs(dr) <= RULES.replicaRatioTol && Math.abs(dv) <= RULES.replicaVTol };
    }
  }
  return { byId, Z };
}

export const classify = s => (s == null ? "not run" : Math.abs(s) >= RULES.material ? "material" : Math.abs(s) < RULES.immaterial ? "immaterial" : "inconclusive");

/** the pre-registered decision (tasks/todo.md D3.4, as amended before any run) */
export function decide(byId) {
  const R = id => (byId[id]?.valid && Number.isFinite(byId[id].ratio) ? byId[id].ratio : null);
  const d = (a, b) => (R(a) != null && R(b) != null ? R(a) - R(b) : null);
  const out = {
    dDiag: d("D32-1024", "D20-1024"), S_D: d("D32-1024", "D32-640"), S_lambda: d("D32-640", "D20-1024"),
    S_D24: d("D24-1024", "D24-848"), p: d("D24-1024", "D20-1024"),
    boxStep32: d("D32-768", "D32-640"), lambdaStep2224: d("D32-768", "D24-1024"),
  };
  const core = ["D20-1024", "D24-848", "D24-1024", "D32-640", "D32-1024"];
  const missing = core.filter(id => R(id) == null);
  if (missing.length) out.H_D = { verdict: "NO VERDICT", why: `not valid or not run: ${missing.join(", ")}` };
  else if (!(out.dDiag > 0) || !(out.p > 0)) out.H_D = { verdict: "NO VERDICT", why: `dDiag ${out.dDiag} and p ${out.p} must both be > 0` };
  else {
    const fD = out.S_D / out.dDiag, q = out.S_D24 / out.p;
    const mono = R("D32-768") == null ? null : R("D32-640") < R("D32-768") && R("D32-768") < R("D32-1024");
    let verdict = "PARTIAL", note = null;
    if (fD >= RULES.support && q >= RULES.support && mono === true) verdict = "SUPPORTED";
    else if (fD <= RULES.reject && q <= RULES.reject) verdict = fD <= RULES.opposite ? "REJECTED (opposite sign)" : "REJECTED";
    else if (fD >= RULES.support && q >= RULES.support && mono === null) note = "D32-768 not valid: cannot be SUPPORTED";
    out.H_D = { verdict, fD, fLambda: 1 - fD, S_D24overP: q, monotone32: mono, note };
  }
  out.H_I = { S_I: d("I24-704", "I24-448"), inletStep32: d("D32-1024", "L32-1024") };
  out.H_I.verdict = classify(out.H_I.S_I);
  out.H_I.byGap = ["I24-448", "D24-1024", "I24-576", "I24-704"].filter(id => byId[id]).map(id => ({ id, ratio: byId[id].ratio, valid: byId[id].valid, endGap: byId[id].endGap }));
  out.H_L = { S_L: d("L32-1024", "D32-640"), S_L24: d("L24-1024", "D24-848"), halfStep32: d("L32-768", "D32-640") };
  out.H_L.verdict = classify(out.H_L.S_L);
  out.H_L.boxIsHalfPlusInlet = out.S_D != null && out.H_L.S_L != null && out.H_I.inletStep32 != null ? out.S_D - (out.H_L.S_L + out.H_I.inletStep32) : null;
  const n4 = {};
  for (const l of K.LAMBDAS) {
    const s = staging(l);
    n4[l] = { windowStartCells: Math.sqrt(s.nuLat * 23 * s.chunk), endCells: Math.sqrt(s.nuLat * 33 * s.chunk), nuOverUCells: s.nuOverUCells };
  }
  const rows = Object.values(byId);
  out.next = {
    N1: { fires: out.H_D.fLambda != null ? out.H_D.fLambda >= RULES.support : null, fLambda: out.H_D.fLambda ?? null },
    N2: { fires: byId["D24-1024"]?.V1 && byId["D24-1024"].flowInletUx != null ? byId["D24-1024"].flowInletUx < RULES.inflowTrigger : null, inletUx: byId["D24-1024"]?.flowInletUx ?? null },
    N3: { fires: rows.some(r => r.valid && Math.abs(r.flowSteadiness) > RULES.windowTrigger),
      runs: rows.filter(r => r.valid && Math.abs(r.flowSteadiness) > RULES.windowTrigger).map(r => ({ id: r.id, steadiness: r.flowSteadiness })) },
    N4: { reported: n4 },
    lateral: { fires: rows.some(r => r.V1 && !r.V3), runs: rows.filter(r => r.V1 && !r.V3).map(r => r.id) },
  };
  return out;
}

// ------------------------------------------------------------ CLI

function sh(cmd, args) { return execFileSync(cmd, args, { encoding: "utf8", cwd: REPO }).trim(); }

function sourceHashes() {
  const out = {};
  for (const p of HASHED) {
    const bytes = readFileSync(resolve(REPO, p));
    out[p] = { raw: createHash("sha256").update(bytes).digest("hex"),
      lf: createHash("sha256").update(bytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex") };
  }
  return out;
}

function printPlan(geos) {
  let total = 0;
  console.log("id        lambda    n seedX   box_d0  half_d0 inlet_d0   units  runs  est_s(<=)");
  for (const g of geos) {
    const runs = g.control ? 3 : 2, s = g.units * runs * MS_PER_UNIT / 1000;
    total += s;
    console.log(`${g.id.padEnd(9)} ${g.lambda.toFixed(1).padStart(6)} ${String(g.n).padStart(4)} ${String(g.seedX).padStart(5)} ${g.boxD0.toFixed(0).padStart(8)} ${g.halfWidthD0.toFixed(0).padStart(8)} ${g.inletD0.toFixed(0).padStart(8)} ${g.units.toFixed(0).padStart(7)} ${String(runs).padStart(5)} ${s.toFixed(0).padStart(9)}`);
  }
  console.log(`total stepping <= ${(total / 60).toFixed(1)} min at ${MS_PER_UNIT.toFixed(3)} ms per 1024^2-substep unit (11-01 bound)`);
}

async function main() {
  const args = process.argv.slice(2);
  const known = ["--self-test", "--plan", "--run", "--port", "--arms"];
  for (let i = 0; i < args.length; i++) {
    if (!known.includes(args[i])) throw new Error(`unknown option ${args[i]}`);
    if (args[i] === "--port" || args[i] === "--arms") i++;
  }
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const geosAll = parseArms(JSON.parse(readFileSync(ARMS_PATH, "utf8")));
  if (!args.includes("--run")) {
    if (args.includes("--plan")) { printPlan(geosAll); return 0; }
    const { selfTest } = await import("./flow-domain-selftest.mjs");
    return (await selfTest()) ? 0 : 1;
  }
  const pick = opt("--arms")?.split(",").filter(Boolean);
  if (pick) for (const id of pick) if (!geosAll.some(g => g.id === id)) throw new Error(`--arms: unknown ${id}`);
  const geos = pick ? geosAll.filter(g => pick.includes(g.id)) : geosAll;
  const port = opt("--port") ?? "5199";
  if (!/^\d+$/.test(port)) throw new Error("--port must be a number");

  const date = new Date().toISOString().slice(0, 10);
  const rawDir = resolve(REPO, `verify-out/flow-domain-${date}`);
  mkdirSync(rawDir, { recursive: true });
  const resultPath = resolve(REPO, `docs/validation/flow-domain-${date}${pick ? "-partial" : ""}.json`);
  const disk = sourceHashes();
  const result = {
    study: "D3.4 flow domain study (research; FLOW-TIP-TONG stays FAILED and is not re-scored)",
    protocol: "tasks/todo.md, D3.4 flow domain study - 2026-11-07 (amended before any run)", protocolCommit: PROTOCOL_COMMIT,
    commit: sh("git", ["rev-parse", "HEAD"]), dirty: sh("git", ["status", "--porcelain", "--", ...HASHED]),
    committedBlobs: Object.fromEntries(HASHED.map(p => { try { return [p, sh("git", ["rev-parse", `HEAD:${p}`])]; } catch { return [p, null]; } })),
    date, started: new Date().toISOString(), argv: args, port, selected: geos.map(g => g.id),
    constants: K, rules: RULES, staging: Object.fromEntries(K.LAMBDAS.map(l => [l, staging(l)])),
    sourceHashes: disk, geometries: [], errors: [], completed: false,
  };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 1) + "\n");
  save();
  const { default: puppeteer } = await import("puppeteer-core");
  const { closeBrowser } = await import("../browser-cleanup.mjs");
  const extra = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [];
  if (!Array.isArray(extra) || extra.some(a => typeof a !== "string")) throw new Error("CHROME_ARGS must be a JSON string array");
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true, protocolTimeout: 600_000, args: ["--enable-unsafe-webgpu", "--enable-gpu", ...extra] });
  const ctx = {
    errors: result.errors, rawDir,
    async open(g) {
      const page = await browser.newPage();
      await page.bringToFront();
      page.on("pageerror", e => ctx.errors.push({ geometry: g.id, kind: "page", message: String(e?.message ?? e) }));
      page.on("console", m => { if (m.type() === "error") ctx.errors.push({ geometry: g.id, kind: "console", message: m.text() }); });
      await page.goto(`http://localhost:${port}/app/`, { waitUntil: "networkidle0", timeout: 60_000 });
      await page.waitForFunction("!!window.__solidify", { timeout: 60_000 });
      await page.evaluate(installDriver, HELPER_SRC);
      return page;
    },
    admit(m) {
      const bad = SERVED.filter(p => !m?.served?.[p]?.lf || m.served[p].lf !== disk[p].lf);
      if (m?.hardware?.isFallbackAdapter !== false || bad.length) {
        servedOk = false;
        throw new Error(`not admitted: ${m?.hardware?.isFallbackAdapter !== false ? "no hardware adapter; " : ""}${bad.length ? `served source differs: ${bad.join(", ")}` : ""}`);
      }
    },
  };
  let servedOk = true;
  try {
    for (const g of geos) {
      const row = await runGeometry(ctx, g);
      result.geometries.push(row);
      const v = r => (r?.summary ? r.summary.vd0D.toFixed(5) : "-");
      console.log("FD-GEOMETRY", g.id, JSON.stringify({ ratio: row.runs.flow?.summary && row.runs.noflow?.summary ? +(row.runs.flow.summary.vLast / row.runs.noflow.summary.vLast).toFixed(4) : null,
        vd0D: [v(row.runs.noflow), v(row.runs.flow)], wallS: Math.round(row.wallMs / 1000), exception: row.exception ? row.exception.split("\n")[0] : undefined }));
      save();
      if (!servedOk) { result.abort = "served source differs from the worktree, or a software adapter: stopping"; break; }
    }
  } catch (err) {
    result.exception = err?.stack ?? String(err);
  } finally {
    await closeBrowser(browser);
  }
  result.servedVerified = servedOk;
  const meta = result.geometries.map(r => JSON.stringify({ h: r.metadata?.hardware, w: r.metadata?.wgsl }));
  result.metadataConsistent = meta.every(x => x === meta[0]);
  result.metadata = result.geometries[0]?.metadata ?? null;
  const { byId, Z } = assess(result.geometries, servedOk);
  result.Z = Z;
  result.decision = decide(byId);
  result.finalHashes = sourceHashes();
  result.sourceStable = JSON.stringify(result.finalHashes) === JSON.stringify(disk);
  result.completed = !result.exception && !result.abort && result.errors.length === 0 && result.sourceStable && servedOk
    && result.metadataConsistent && result.geometries.length === geos.length && result.geometries.every(r => !r.exception);
  result.finished = new Date().toISOString();
  result.reading = null;   // written by a person after the run, never by this script
  save();
  console.log("FD-DECISION", JSON.stringify({ H_D: result.decision.H_D, H_I: result.decision.H_I.verdict, H_L: result.decision.H_L.verdict,
    next: Object.fromEntries(Object.entries(result.decision.next).map(([k, v]) => [k, v.fires ?? "reported"])), Z }));
  console.log("FLOW-DOMAIN", result.completed ? "RECORDED" : "FAILED", JSON.stringify({ result: resultPath, completed: result.completed,
    sourceStable: result.sourceStable, servedVerified: servedOk, errors: result.errors.length, exception: result.exception?.split("\n")[0], abort: result.abort }));
  return result.completed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, err => { console.error(err?.stack ?? err); process.exitCode = 1; });
}
