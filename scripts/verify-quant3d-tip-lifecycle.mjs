// Real CLI/artifact failure paths under a CPU-only synthetic browser.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repo = fileURLToPath(new URL("../", import.meta.url));
const out = resolve(process.argv[2] ?? "verify-out/q3-tip-lifecycle");
mkdirSync(out, { recursive: true });
const cases = [
  ["positive", null], ["ledger-fail", "GPU error ledger read failed"],
  ["ledger-missing", "GPU error ledger is unavailable"], ["cleanup-fail", "fixture cleanup failed"],
  ["device-cleanup-fail", "device cleanup failed"], ["browser-cleanup-fail", "browser cleanup failed"],
  ["gpu-error", "manufactured GPU error"], ["page-error", "manufactured late page exception"],
  ["launch-fail", "manufactured launch failure"], ["newpage-fail", "manufactured newPage failure"],
  ["source-change", "benchmark source changed"], ["invalid-chrome-options", "CHROME_ARGS"],
  ["advance-fail", "manufactured advance failure"],
];
const rows = [];
function invoke(mode, directory, extra = []) {
  const env = { ...process.env, Q3_MOCK_MODE: mode };
  delete env.CHROME_ARGS;
  if (mode === "invalid-chrome-options") env.CHROME_ARGS = "{}";
  const child = spawnSync(process.execPath, ["--import", "./scripts/fixtures/quant3d-tip-lifecycle-preload.mjs",
    "scripts/verify-quant3d-tip.mjs", directory, "5199", "--run", ...extra],
  { cwd: repo, env, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 ** 2 });
  assert.ifError(child.error);
  writeFileSync(`${directory}.log`, child.stdout + child.stderr);
  const result = JSON.parse(readFileSync(resolve(directory, "quant3d-tip-result.json")));
  return { child, result };
}
for (const [mode, expectedError] of cases) {
  const directory = resolve(out, mode), { child, result } = invoke(mode, directory);
  if (expectedError) {
    assert.equal(child.status, 1, `${mode}: failure must set exit 1`);
    assert.equal(result.accepted, false, `${mode}: failure must refuse acceptance`);
    assert.ok(JSON.stringify({ errors: result.errors, exception: result.exception }).includes(expectedError), `${mode}: failed on the wrong clause`);
    assert.notEqual(result.status, "long 3D tip accepted", `${mode}: final status must agree`);
  } else {
    assert.equal(child.status, 0); assert.equal(result.accepted, true);
    assert.equal(result.deviceErrorLedgerRead, true); assert.equal(result.sourceStable, true);
  }
  rows.push({ mode, exitCode: child.status, accepted: result.accepted, status: result.status, expectedError });
}
const subset = invoke("positive", resolve(out, "subset"), ["--arms=base"]);
assert.equal(subset.child.status, 0); assert.equal(subset.result.accepted, false);
assert.match(subset.result.status, /diagnostic subset/);
const stale = invoke("launch-fail", resolve(out, "positive"));
assert.equal(stale.child.status, 1); assert.equal(stale.result.accepted, false);
assert.ok(stale.result.exception.includes("manufactured launch failure"), "a retry must replace a prior successful result");
writeFileSync(resolve(out, "lifecycle-controls.json"), JSON.stringify({
  purpose: "CPU-only synthetic verdict plumbing; no GPU or scientific acceptance", rows,
  passingSubsetCannotAccept: true, failedRetryReplacedSuccess: true,
}, null, 2));
console.log("QPF3-TIP-LIFECYCLE OK", JSON.stringify({ cases: rows.length, passingSubsetCannotAccept: true, failedRetryReplacedSuccess: true }));
