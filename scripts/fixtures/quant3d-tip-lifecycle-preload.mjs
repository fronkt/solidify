// CPU-only process fixture. The real runner executes with a synthetic browser;
// its successful values exercise verdict plumbing, never physical validation.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const mode = process.env.Q3_MOCK_MODE ?? "positive";
const modes = ["positive", "ledger-fail", "ledger-missing", "cleanup-fail", "device-cleanup-fail",
  "browser-cleanup-fail", "gpu-error", "page-error", "launch-fail", "newpage-fail", "source-change",
  "invalid-chrome-options", "advance-fail"];
if (!modes.includes(mode)) throw new Error(`Unknown lifecycle fixture mode: ${mode}`);
const target = { P: .312, sigmaStar: .063 };
let config, steps = 0, ledgerReads = 0;
const handlers = {};
const fixture = {
  stage(c) { config = c; steps = 0; return { bytesPerVoxel: 61, shaderHashes: ["CPU-only plumbing"] }; },
  advance(count) {
    if (mode === "advance-fail") throw new Error("manufactured advance failure");
    steps += count; return { steps, time: steps * config.dt, count, seconds: .001, minTau: 1 };
  },
  sample() {
    const time = steps * config.dt, D = .6267 * config.lambda, d0 = .8839 / config.lambda;
    const rho = d0 / (target.P * target.sigmaStar), V = 2 * target.sigmaStar * target.P ** 2 * D / d0;
    const tip = config.radius + V * time, points = [];
    for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
      const X = (x + .5) * config.dx, Y = (y + .5) * config.dx, z = tip - (X * X + Y * Y) / (2 * rho);
      points.push({ x: X, y: Y, z, zCoarse: z, zRaw: z });
    }
    return { steps, time, points, farFieldDiagnostics: { patches: [], source: "CPU fixture only" } };
  },
  equivalence() {
    return { checkpoints: [1, 17, 64].map(target => ({ target, comparisons: ["state", "grain", "age"].map(field =>
      ({ field, mismatches: 0, productionHash: "CPU-only", specializedHash: "CPU-only" })) })) };
  },
  destroy() { if (mode === "cleanup-fail") throw new Error("manufactured queue completion failure"); },
};
globalThis.window = { __q3tip: fixture, __solidifyTipDevice: {
  destroy() { if (mode === "device-cleanup-fail") throw new Error("manufactured device cleanup failure"); },
} };
Object.defineProperty(window, "__solidifyTipDeviceErrors", { get() {
  ledgerReads++;
  if (mode === "ledger-fail") throw new Error("manufactured error ledger unavailable");
  if (mode === "ledger-missing") return undefined;
  if (mode === "page-error") handlers.pageerror?.(new Error("manufactured late page exception"));
  return mode === "gpu-error" ? ["manufactured GPU error"] : [];
} });
if (mode === "source-change") {
  const original = fs.readFileSync;
  fs.readFileSync = function (path, ...args) {
    const bytes = original.call(this, path, ...args);
    return ledgerReads && String(path).replaceAll("\\", "/").endsWith("src/shaders3d-quant.ts")
      ? Buffer.concat([bytes, Buffer.from("\n// manufactured source change\n")]) : bytes;
  };
  syncBuiltinESMExports();
}
const page = {
  on(event, handler) { handlers[event] = handler; }, async goto() {}, async waitForFunction() {},
  async evaluate(fn, arg) {
    if (fn.name === "installQuant3TipDriver") return;
    if (String(fn).includes("PHASE_TABLE_VERSION")) return { adapter: { isFallbackAdapter: false }, build: "CPU-only fake" };
    return await fn(arg);
  },
};
puppeteer.launch = async () => {
  if (mode === "launch-fail") throw new Error("manufactured launch failure");
  return {
    async newPage() { if (mode === "newpage-fail") throw new Error("manufactured newPage failure"); return page; },
    process() { if (mode === "browser-cleanup-fail") throw new Error("manufactured browser cleanup failure"); return null; },
    async close() {}, async disconnect() {},
  };
};
process.on("exit", code => console.log("CPU-LIFECYCLE-END", JSON.stringify({ mode, code, ledgerReads })));
