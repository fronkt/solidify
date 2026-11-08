// Q3 zero-physics-change gate. Both the preserved fused path and the split
// path owe every field bit captured before the port, not just a similar image.
import puppeteer from "puppeteer-core";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { closeBrowser } from "./browser-cleanup.mjs";
import { installKob3Capture } from "./fixtures/kob3d-capture.mjs";
import { quant3AllocationChecks } from "./fixtures/quant3d-allocation.mjs";

const OUT = resolve(process.argv[2] ?? "verify-out");
const PORT = process.argv[3] ?? "5199";
mkdirSync(OUT, { recursive: true });
const golden = JSON.parse(readFileSync(new URL("./fixtures/kob3d-baseline.json", import.meta.url), "utf8"));
const sha = b => createHash("sha256").update(b).digest("hex");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-gpu"], defaultViewport: { width: 800, height: 700 } });
const page = await browser.newPage(), errors = [], results = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" || /binding size|minimum.*binding size/.test(m.text())) errors.push(m.text()); });
let failures = 0;
try {
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!window.__solidify);
  await page.evaluate(installKob3Capture);
  for (const split of [false, true]) {
    const bad = []; let compared = 0, live = 0;
    for (const fixture of golden.cases) {
      try {
        const r = await page.evaluate(c => window.__q3Capture(c), { ...fixture.config, split });
        if (r.checkpoints.length !== fixture.checkpoints.length) throw new Error("checkpoint count changed");
        const first = r.checkpoints[0], end = r.checkpoints.at(-1);
        if (!(end.summary.phiSum !== first.summary.phiSum && end.summary.solid > 0 && end.summary.pores >= 1)) throw new Error("vacuous fixture");
        live++;
        for (let i = 0; i < r.checkpoints.length; i++) {
          const a = r.checkpoints[i], b = fixture.checkpoints[i];
          for (const k of ["target", "frame", "dir", "simTime", "feedGen"]) if (a[k] !== b[k]) bad.push({ case: fixture.config.name, point: i, metadata: k, got: a[k], want: b[k] });
          for (const f of b.fields) {
            const bytes = Buffer.from(a.data[f.field] ?? "", "base64"), hash = sha(bytes);
            compared++;
            if (bytes.length !== f.bytes || hash !== f.sha256) bad.push({ case: fixture.config.name, target: b.target, field: f.field, bytes: bytes.length, got: hash, want: f.sha256 });
          }
        }
      } catch (e) { bad.push({ case: fixture.config.name, exception: e.stack ?? String(e) }); }
    }
    const ok = bad.length === 0 && live === golden.cases.length && compared === 390;
    const result = { split, baselineCommit: golden.commit, live, fieldsCompared: compared, mismatches: bad };
    results.push(result);
    console.log(split ? "PASSSPLIT3-SPLIT" : "PASSSPLIT3-FUSED", ok ? "OK" : "FAIL", JSON.stringify({ ...result, mismatches: bad.slice(0, 12), mismatchCount: bad.length }));
    if (!ok) failures++;
  }
  try {
    const rows = await page.evaluate(quant3AllocationChecks);
    const ok = rows.length === 4 && rows.every(r => r.steps > 0 && Math.abs(r.phaseAfter-r.phaseBefore) > 1e-5
      && (r.boundary === "aux-texture" || r.boundary === "phase-bind-group"
        ? r.injected === 1 && r.returned === false && !!r.issue && r.changedFields.length === 0
          && r.preservedPair && r.preservedParams && r.quantAbsent
        : r.results.every((v,i) => v === (r.boundary !== "alloy-off-on" || i !== 0))
          && r.pairLength === 2 && r.phaseGroups === 2 && r.transportGroups === 2
          && r.status && r.status.flags === 0 && !r.status.issue
          && (r.boundary !== "concurrent-quant-alloy" || r.deduplicatedQuant && r.deduplicatedAlloy)
          && (r.boundary !== "alloy-off-on" || r.alloyOn === 1)));
    results.push({ name: "PASSSPLIT3-ALLOCATION", ok, rows });
    console.log("PASSSPLIT3-ALLOCATION", ok ? "OK" : "FAIL", JSON.stringify(rows));
    if (!ok) failures++;
  } catch (e) {
    const exception = e.stack ?? String(e); results.push({ name: "PASSSPLIT3-ALLOCATION", ok: false, exception });
    console.log("PASSSPLIT3-ALLOCATION FAIL", exception); failures++;
  }
  console.log("PASSSPLIT3-ERRORS", errors.length ? "FAIL" : "OK", JSON.stringify(errors.slice(0, 8)));
  if (errors.length) failures++;
} finally {
  writeFileSync(resolve(OUT, "passsplit3d-result.json"), JSON.stringify({ results, errors, failures }, null, 2));
  await closeBrowser(browser);
}
console.log(failures ? `done: ${failures} failed` : "done: all 3D split checks passed");
if (failures) process.exitCode = 1;
