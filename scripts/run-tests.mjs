// Orchestrates the headless verification suite: starts `vite` on the fixed
// port the verify-*.mjs scripts expect (5199), waits for it to answer, runs
// each script in sequence against Frank's installed Chrome, then tears the
// server down. Requires a WebGPU-capable Chrome at the hardcoded
// executablePath inside each verify-*.mjs — Windows + a real GPU (or
// swiftshader), not portable to a generic CI runner. See TESTING.md.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const OUT = "verify-out";
// verify-3d takes an explicit port because it used to be run by hand against a
// second server; it belongs in the suite like everything else, and now that its
// checks actually set an exit code, including it is meaningful.
const SUITE = [
  ["scripts/verify-units.mjs"],   // no browser — runs first because it is instant
  ["scripts/verify-dive.mjs"],
  ["scripts/verify-dive-fallbacks.mjs"],
  ["scripts/verify-scroll-order.mjs"],
  ["scripts/verify-optimizer.mjs"],
  ["scripts/verify-tools.mjs"],
  ["scripts/verify-passsplit.mjs", String(PORT)],
  ["scripts/verify-scale3d.mjs", String(PORT)],
  ["scripts/verify-3d.mjs", String(PORT)],
];

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
    child.on("error", reject);
  });
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`vite dev server never answered at ${URL}`);
}

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "inherit" });

let failed = false;
try {
  await waitForServer();
  for (const [script, ...extra] of SUITE) {
    console.log(`\n=== ${script} ===`);
    await run("node", [script, OUT, ...extra]);
  }
} catch (err) {
  console.error(err.message);
  failed = true;
} finally {
  server.kill();
}

process.exit(failed ? 1 : 0);
