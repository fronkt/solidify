// Tong comparison 3 ("tong3", D2 only, far from the inlet): a research comparison,
// NOT a regression gate.
//
// FLOW-TIP-TONG (11-01) stays FAILED and tong2 stays NO VERDICT. This is a new
// comparison with its own verdict, restricted to the one Tong et al. 2001 Table II
// row inside the solver's tau V / W <= 0.2 bound (D 2, lambda 3.19): an
// inlet-distance ladder at n 1024, dx 0.8 W0 (tier P), a convergence clause, the
// V and R bands on the farthest arm, falsification arms there, and Tong's own
// geometry at dx 0.4 W0 as information only (tier I).
//
// Protocol: tasks/todo.md "Tong comparison 3 (D2 only, far from the inlet) -
// PROTOCOL" (75d2588, numbers corrected in 71c272a) with its "Amendment before any
// run", committed before any run (PROTOCOL_COMMIT below). Arms:
// flow-tong3-arms.json, validated here against the protocol.
//
// Reuses scripts/research/flow-tong2.mjs UNCHANGED (its file is byte-identical to
// the head the tong2 GPU run froze, 21e73ee): the staging arithmetic, runOne /
// runArm (D3.4's in-page driver and served-source metadata underneath), the
// statistic, runIssues, assess (V1, stop rule, stationarity in both runs, inlet
// liveness), the falsification (tong2 amendment item 1), the admission and the
// contention log. This file adds the window without an inlet cap, the tau V / W
// bound as a validity clause, the convergence clause and the one-row verdict.
//
//   node scripts/research/flow-tong3.mjs [--self-test]   CPU only (the default)
//   node scripts/research/flow-tong3.mjs --plan          arms, window and GPU cost
//   node scripts/research/flow-tong3.mjs --run [--port 5297] [--arms ID,ID]
//
// --run drives Chrome/WebGPU and needs a Vite server for THIS worktree
// (`npx vite --port 5297 --strictPort`). It refuses before launching Chrome unless
// the hashed files are committed and unmodified and src/ equals a304254, and
// admits each page only if its served source equals this tree's. It writes
// docs/validation/flow-tong3-<date>.json and raw rows to verify-out/flow-tong3-<date>/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as T2 from "./flow-tong2.mjs";
import { HELPER_SRC, installDriver } from "./flow-domain.mjs";

export const PROTOCOL_COMMIT = "72729d23a997185d871a29719bd9f9863a33a658";
export const PROTOCOL_HEADER = "### Tong comparison 3 (D2 only, far from the inlet) - PROTOCOL (pre-registered 2026-11-07; not built, not run)";
export const AMENDMENT_HEADER = "#### Amendment before any run (2026-11-07, tong3)";
/** the pre-registration as frozen (75d2588, its window numbers corrected in 71c272a) */
export const ORIGINAL_PROTOCOL_COMMIT = "71c272ad2051f4052b27a2d1dc31eeea9c22a122";
/** the head the tong2 GPU run froze: flow-tong2.mjs must still be byte-identical to it */
export const TONG2_RUN_COMMIT = "21e73ee5dafc77a47c603dc97999aa50b254d6e8";
export const REPO = T2.REPO;
export const D35_PASSED_COMMIT = T2.D35_PASSED_COMMIT;
const ARMS_PATH = fileURLToPath(new URL("./flow-tong3-arms.json", import.meta.url));

const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };
const K = T2.K;   // A1, A2, NS 33, STOP_CELLS 32, SEED_R_W0 8, ... as tong2

/** the protocol's row, arms and window, as written (tasks/todo.md, tong3) */
export const PROTOCOL = deepFreeze({
  row: { id: "D2", D: 2, lambda: 3.19, tongVd0D: 0.0247, tongNoflowVd0D: 0.0180, exactNoflowVd0D: 0.0170, tongRatio: 1.372, tongBoxD0: 1479 },
  /** dx in W0 per tier */
  tiers: { P: 0.8, I: 0.4 },
  arms: [
    { id: "P768", tier: "P", n: 1024, seedX: 768, falsification: true },
    { id: "P640", tier: "P", n: 1024, seedX: 640 },
    { id: "P512", tier: "P", n: 1024, seedX: 512 },
    { id: "I512", tier: "I", n: 1024, seedX: 512, informationOnly: true },
  ],
  /** 33 equal chunks over T = 8 D~ / V_KR^2 (no inlet cap); the self-test reproduces these */
  window: { P: { chunk: 671, substeps: 22143 }, I: { chunk: 2683, substeps: 88539 } },
  falsification: "P768", convergence: ["P768", "P640"], verdictArm: "P768",
});

/** pre-registered thresholds (tasks/todo.md, tong3); the falsification and validity
 *  clauses tong2 owns (band [1.26, 1.54], stationarity 0.02, inlet 1e-4) stay tong2's */
export const RULES = deepFreeze({ boundMax: 0.2, convergenceMax: 0.01, vBand: 0.10, rLo: 1.26, rHi: 1.54 });

/** cost model of the protocol's cost section (n 1024: flow 2.7, no flow 0.9 ms per substep) */
export const COST = deepFreeze({ flowMs: 2.7, noflowMs: 0.9 });

export const SERVED = T2.SERVED;
export const HASHED = [...SERVED,
  "scripts/research/flow-tong3.mjs", "scripts/research/flow-tong3-selftest.mjs", "scripts/research/flow-tong3-arms.json",
  "scripts/research/flow-tong2.mjs", "scripts/research/flow-domain.mjs", "scripts/browser-cleanup.mjs"];

// ------------------------------------------------------------ window and arms

/** tong2's staging arithmetic unchanged, with the tong3 window: T = 8 l_D / V_KR
 *  (tong2's tTravel, D3.4's 8 D~ / V_KR^2) in 33 equal chunks, no inlet cap */
export function staging(lambda, dx, sideW0) {
  const s = T2.staging(lambda, dx, sideW0);
  const T = s.tTravel, chunk = Math.round(T / K.NS / s.dt);
  const { s: _cap, tInlet: _t, ...rest } = s;
  return { ...rest, T, TinLD: (T * s.vKR) / s.lD, bound: "travel (no inlet cap)", chunk, substeps: chunk * K.NS, tSampled: chunk * K.NS * s.dt };
}

/** tau V / W of a run from its measured V d0/D (the protocol's formula); with the
 *  calibrated staging (tau0 = W0 = 1) it equals v in W0 per tau0 */
export const tauVW = (vd0D, lambda) => (Number.isFinite(vd0D) ? vd0D * (K.A2 * lambda) * (lambda / K.A1) : null);

/** derived geometry of one arm, shaped for tong2's runArm / runOne / assess */
export function geometry(arm) {
  const row = PROTOCOL.row, dx = PROTOCOL.tiers[arm.tier], sideW0 = arm.n * dx, s = staging(row.lambda, dx, sideW0), seedY = arm.n / 2;
  const vTong = (row.tongVd0D * K.A2 * row.lambda * row.lambda) / K.A1;   // Tong's D2 flow speed, W0 per tau0
  const nuUcells = s.nuOverUCells;
  return {
    ...arm, row: row.id, falsification: !!arm.falsification, informationOnly: !!arm.informationOnly, D: row.D, lambda: row.lambda, sideW0,
    tongBoxD0: row.tongBoxD0, tongVd0D: row.tongVd0D, tongRatio: row.tongRatio,
    seedY, staging: s, chunk: s.chunk, boxD0: arm.n * s.cellD0,
    inletGap0: { d0: arm.seedX * s.cellD0, nuOverU: arm.seedX / nuUcells },
    /** the protocol's prediction (seed centre, Tong's speed for T), reported only */
    predictedEndGapNuOverU: (arm.seedX - (vTong * s.tSampled) / dx) / nuUcells,
    predictedEndGapCellsFromTip: arm.seedX - s.seedRCells - (vTong * s.tSampled) / dx,
    costS: { flow: ((arm.falsification ? 3 : 1) * COST.flowMs * s.substeps) / 1000, noflow: (COST.noflowMs * s.substeps) / 1000 },
  };
}

/** validate the arm file against the protocol; throws with the reason */
export function parseArms(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("arms: not an object");
  for (const k of Object.keys(json)) if (!["study", "protocol", "protocolCommit", "row", "arms"].includes(k)) throw new Error(`arms: unknown key ${k}`);
  if (json.protocolCommit !== PROTOCOL_COMMIT) throw new Error(`arms: protocolCommit ${json.protocolCommit} is not ${PROTOCOL_COMMIT}`);
  const r = json.row ?? {};
  for (const k of Object.keys(r)) if (!(k in PROTOCOL.row)) throw new Error(`arms: row: unknown key ${k}`);
  for (const [k, v] of Object.entries(PROTOCOL.row)) if (r[k] !== v) throw new Error(`arms: row: ${k} ${r[k]} is not the pre-registered ${v}`);
  if (!Array.isArray(json.arms)) throw new Error("arms: arms must be an array");
  const want = PROTOCOL.arms.map(a => a.id), got = json.arms.map(a => a?.id);
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`arms: arms must be exactly ${want.join(", ")} in the protocol's order, not ${got.join(", ")}`);
  return json.arms.map((a, i) => {
    const p = PROTOCOL.arms[i];
    for (const k of Object.keys(a)) if (!["id", "tier", "n", "seedX", "chunk", "substeps", "falsification", "informationOnly"].includes(k)) throw new Error(`arms: ${a.id}: unknown key ${k}`);
    for (const k of ["tier", "n", "seedX"]) if (a[k] !== p[k]) throw new Error(`arms: ${a.id}: ${k} ${a[k]} is not the pre-registered ${p[k]}`);
    for (const k of ["falsification", "informationOnly"]) if ((a[k] ?? false) !== (p[k] ?? false)) throw new Error(`arms: ${a.id}: ${k} is pre-registered as ${p[k] ?? false}`);
    if (!Number.isInteger(a.n) || a.n % 16 !== 0 || a.n > K.N_MAX) throw new Error(`arms: ${a.id}: n ${a.n}`);
    const g = geometry(p), w = PROTOCOL.window[p.tier];
    if (a.chunk !== w.chunk || a.substeps !== w.substeps) throw new Error(`arms: ${a.id}: chunk ${a.chunk} / ${a.substeps} substeps are not the protocol's ${w.chunk} / ${w.substeps}`);
    if (g.chunk !== w.chunk || g.staging.substeps !== w.substeps) throw new Error(`arms: ${a.id}: the window formula gives ${g.chunk} / ${g.staging.substeps}, not ${w.chunk} / ${w.substeps}`);
    return { ...g, substeps: g.staging.substeps };
  });
}

// ------------------------------------------------------------ validity and verdict

/** tong2's assess (V1, stop rule, stationarity in BOTH runs, inlet liveness)
 *  unchanged, plus the bound: tau V / W <= 0.2 in BOTH runs, and the downstream
 *  tip's gap to the outlet (reported) */
export function assess(arms, served) {
  const byId = T2.assess(arms, served);
  for (const a of arms) {
    const s = staging(a.lambda, a.dx, a.sideW0);
    a.validTong2 = a.valid;
    a.tauVW = Object.fromEntries(Object.entries(a.runs ?? {}).map(([k, r]) => [k, tauVW(r?.summary?.vd0D, a.lambda)]));
    a.withinBound = [a.tauVW.noflow, a.tauVW.flow].every(v => v != null && v <= RULES.boundMax);
    if (!a.withinBound) a.invalidBy.push(`outside the bound (tau V / W noflow ${a.tauVW.noflow?.toFixed(4) ?? null}, flow ${a.tauVW.flow?.toFixed(4) ?? null})`);
    a.valid = a.validTong2 && a.withinBound;
    // the downstream (east) tip's gap to the outlet face x = n - 1/2 at the end of each run: reported, never gating
    a.outletGap = Object.fromEntries(Object.entries(a.runs ?? {}).map(([k, r]) => {
      const x = r?.trace?.at(-1)?.xEast, c = Number.isFinite(x) ? a.n - 0.5 - x : null;
      return [k, c == null ? null : { cells: c, d0: c * s.cellD0, nuOverU: c / s.nuOverUCells }];
    }));
  }
  return byId;
}

const brief = a => (a ? {
  id: a.id, valid: !!a.valid, invalidBy: a.invalidBy ?? ["not run"], R: a.R ?? null, vd0DFlow: a.vd0DFlow ?? null, vd0DNoflow: a.vd0DNoflow ?? null,
  stationarity: a.stationarity ?? null, tauVW: a.tauVW ?? null, inletUx: a.inletUx ?? null, endGap: a.endGap ?? null, outletGap: a.outletGap ?? null,
} : { id: null, valid: false, invalidBy: ["not run"] });

/** the pre-registered verdict (tier P on P768), the convergence clause and the reports */
export function decide(byId) {
  const p768 = byId.P768, p640 = byId.P640, p512 = byId.P512, i512 = byId.I512;
  // tong2's falsification unchanged; it looks its arm up under tong2's id (amendment items 1-2 there, 1 here)
  const fals = p768 ? T2.falsification({ [T2.PROTOCOL.falsification]: p768 }) : { run: false, ok: false, why: "P768 not run" };
  const v = a => (a && Number.isFinite(a.vFlow) ? a.vFlow : null);
  const ratio = (a, b) => (v(a) != null && v(b) != null ? v(a) / v(b) - 1 : null);
  const C = ratio(p768, p640);
  const convergence = { C: C == null ? null : Math.abs(C), signed: C, P768valid: !!p768?.valid, P640valid: !!p640?.valid };
  convergence.converged = convergence.P768valid && convergence.P640valid && convergence.C != null && convergence.C <= RULES.convergenceMax;
  const why = [];
  if (!fals.ok) why.push("falsification not demonstrated");
  const invalid = ["P768", "P640"].filter(id => !byId[id]?.valid);
  if (invalid.length) why.push(`arm invalid: ${invalid.map(id => `${id} (${(byId[id]?.invalidBy ?? ["not run"]).join("; ")})`).join(", ")}`);
  else if (!convergence.converged) why.push(`not converged in inlet distance (C ${convergence.C} > ${RULES.convergenceMax})`);
  // the clauses on P768, computed whenever its values exist, so every value is reported
  const vDiff = Number.isFinite(p768?.vd0DFlow) ? p768.vd0DFlow / PROTOCOL.row.tongVd0D - 1 : null;
  const R = Number.isFinite(p768?.R) ? p768.R : null;
  const clauses = {
    vBand: { ok: vDiff != null && Math.abs(vDiff) <= RULES.vBand, signed: vDiff },
    rBand: { ok: R != null && R >= RULES.rLo && R <= RULES.rHi, R },
  };
  const failed = Object.entries(clauses).filter(([, c]) => !c.ok).map(([k]) => k);
  const verdict = why.length ? "NO VERDICT" : failed.length ? "FAIL" : "PASS";
  const nf = p768?.vd0DNoflow;
  return {
    verdict, why: why.length ? why : null, failed: verdict === "FAIL" ? failed : null, clauses, convergence, falsification: fals,
    reported: {
      P768: { vVsTong: vDiff, R, RvsTong: R == null ? null : { diff: R - PROTOCOL.row.tongRatio, rel: R / PROTOCOL.row.tongRatio - 1 },
        noflowVsTong: Number.isFinite(nf) ? nf / PROTOCOL.row.tongNoflowVd0D - 1 : null, noflowVsExact: Number.isFinite(nf) ? nf / PROTOCOL.row.exactNoflowVd0D - 1 : null,
        tauVW: p768?.tauVW ?? null },
      /** P512 indicates whether a 2.24 nu/U start is already converged; it does not gate */
      P512: { vs640: ratio(p512, p640), vs768: ratio(p512, p768), valid: !!p512?.valid },
      arms: Object.fromEntries(["P768", "P640", "P512"].map(id => [id, brief(byId[id])])),
    },
    /** tier I: information only, never read by the verdict above */
    information: { I512: { ...brief(i512), vVsTong: Number.isFinite(i512?.vd0DFlow) ? i512.vd0DFlow / PROTOCOL.row.tongVd0D - 1 : null } },
    meaning: "A PASS is one benchmark point (Tong's D2 row) at the app's staging; it does not make the flow quantitative in general. FAIL or NO VERDICT keeps the flow qualitative.",
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

/** refuse before Chrome: hashed files and src/ clean, src/ = a304254, tong2's script = its run's */
export function preconditions() {
  const dirty = sh("git", ["status", "--porcelain", "--", ...HASHED, "src"]);
  const same = (a, paths) => { try { sh("git", ["diff", "--quiet", a, "HEAD", "--", ...paths]); return true; } catch { return false; } };
  const srcAsD35 = same(D35_PASSED_COMMIT, ["src"]), tong2AsRun = same(TONG2_RUN_COMMIT, ["scripts/research/flow-tong2.mjs", "scripts/research/flow-domain.mjs"]);
  return { dirty, srcAsD35, tong2AsRun, d35PassedCommit: D35_PASSED_COMMIT, ok: dirty === "" && srcAsD35 && tong2AsRun };
}

function printPlan(geos) {
  console.log("arm   tier dx     n seedX  box_d0  gap0_d0 gap0_nu/U  chunk substeps  T_tau0  pred_end_nu/U  est_s");
  let total = 0;
  for (const g of geos) {
    const s = g.staging, c = g.costS.flow + g.costS.noflow;
    total += c;
    console.log(`${g.id.padEnd(5)} ${g.tier.padStart(4)} ${s.dx.toFixed(1)} ${String(g.n).padStart(5)} ${String(g.seedX).padStart(5)} ${g.boxD0.toFixed(0).padStart(7)} ${g.inletGap0.d0.toFixed(0).padStart(8)} ${g.inletGap0.nuOverU.toFixed(2).padStart(9)} ${String(g.chunk).padStart(6)} ${String(g.substeps).padStart(8)} ${s.T.toFixed(1).padStart(7)} ${g.predictedEndGapNuOverU.toFixed(2).padStart(14)} ${c.toFixed(0).padStart(6)}${g.informationOnly ? "  (information only)" : ""}${g.falsification ? "  (+ coupling 0, -1)" : ""}`);
  }
  console.log(`stepping <= ${(total / 60).toFixed(1)} min at ${COST.flowMs} / ${COST.noflowMs} ms per flow / no-flow substep (protocol: about 11 min, plan <= 25 min)`);
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
    const { selfTest } = await import("./flow-tong3-selftest.mjs");
    return (await selfTest()) ? 0 : 1;
  }
  const geosAll = parseArms(JSON.parse(readFileSync(ARMS_PATH, "utf8")));
  const pick = opt("--arms")?.split(",").filter(Boolean);
  if (pick) for (const id of pick) if (!geosAll.some(g => g.id === id)) throw new Error(`--arms: unknown ${id}`);
  const geos = pick ? geosAll.filter(g => pick.includes(g.id)) : geosAll;
  const port = opt("--port") ?? "5297";
  if (!/^\d+$/.test(port)) throw new Error("--port must be a number");
  const pre = preconditions();
  if (!pre.ok) { console.log("FLOW-TONG3 REFUSED", JSON.stringify(pre)); return 1; }

  const date = new Date().toISOString().slice(0, 10);
  const rawDir = resolve(REPO, `verify-out/flow-tong3-${date}`);
  mkdirSync(rawDir, { recursive: true });
  const resultPath = resolve(REPO, `docs/validation/flow-tong3-${date}${pick ? "-partial" : ""}.json`);
  const disk = sourceHashes();
  const result = {
    study: "Tong comparison 3 (tong3; D2 only, far from the inlet; research; FLOW-TIP-TONG stays FAILED, tong2 stays NO VERDICT)",
    protocol: "tasks/todo.md, Tong comparison 3 (D2 only, far from the inlet) - PROTOCOL, amended before any run", protocolCommit: PROTOCOL_COMMIT,
    commit: sh("git", ["rev-parse", "HEAD"]), preconditions: pre,
    committedBlobs: Object.fromEntries(HASHED.map(p => { try { return [p, sh("git", ["rev-parse", `HEAD:${p}`])]; } catch { return [p, null]; } })),
    date, started: new Date().toISOString(), argv: args, port, selected: geos.map(g => g.id),
    constants: K, tong2Rules: T2.RULES, rules: RULES, protocolTable: PROTOCOL,
    staging: Object.fromEntries(geosAll.map(g => [g.id, g.staging])), sourceHashes: disk, arms: [], errors: [], completed: false,
  };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 1) + "\n");
  result.contention = { start: T2.headlessChromes() };   // before our own browser exists
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
      const a = T2.admission(m, disk);
      if (!a.ok) { servedOk = false; throw new Error(`not admitted: ${a.why}`); }
      return a;
    },
  };
  try {
    for (const g of geos) {
      const row = await T2.runArm(ctx, g);
      result.arms.push(row);
      const s = k => row.runs[k]?.summary;
      const R = k => (s(k) && s("noflow") ? +(s(k).vLast / s("noflow").vLast).toFixed(4) : null);
      console.log("T3-ARM", g.id, JSON.stringify({ R: R("flow"), ...(g.falsification ? { Rzero: R("zero"), Rreversed: R("reversed") } : {}),
        vd0D: [s("noflow")?.vd0D, s("flow")?.vd0D].map(x => (x == null ? null : +x.toFixed(5))),
        tauVW: [s("noflow")?.vd0D, s("flow")?.vd0D].map(x => (x == null ? null : +tauVW(x, g.lambda).toFixed(4))),
        stationarity: [s("noflow")?.stationarity, s("flow")?.stationarity].map(x => (x == null ? null : +x.toFixed(4))),
        inletUx: row.runs.flow?.end?.vel?.inletUx ?? null, stopped: Object.values(row.runs).filter(r => r.stopped).map(r => r.kind),
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
  console.log("T3-VERDICT", JSON.stringify({ verdict: d.verdict, why: d.why, failed: d.failed, C: d.convergence.C,
    vVsTong: d.clauses.vBand.signed, R: d.clauses.rBand.R, falsification: { ok: d.falsification.ok, zeroR: d.falsification.zero?.R ?? null, reversedR: d.falsification.reversed?.R ?? null },
    I512: { valid: d.information.I512.valid, R: d.information.I512.R, vVsTong: d.information.I512.vVsTong } }));
  console.log("FLOW-TONG3", result.completed ? "RECORDED" : "FAILED", JSON.stringify({ result: resultPath, completed: result.completed,
    sourceStable: result.sourceStable, servedVerified: servedOk, errors: result.errors.length, exception: result.exception?.split("\n")[0], abort: result.abort,
    otherHeadlessChrome: [result.contention.start?.pids ?? null, result.contention.end?.pids ?? null] }));
  return result.completed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, err => { console.error(err?.stack ?? err); process.exitCode = 1; });
}
