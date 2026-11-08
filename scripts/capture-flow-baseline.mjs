// Capture the FLOW-OFF-IDENTITY baseline (D3.2): run every case in
// fixtures/flow-off-cases.mjs on THIS commit, twice, require the two runs to
// agree (a case that does not repeat cannot be an identity reference), and
// write scripts/fixtures/flow-off-baseline.json with the commit it came from.
// Run once, on the commit before the transport pass gains advection.
//
//   node scripts/capture-flow-baseline.mjs [port]
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { captureFlowOffCases } from "./fixtures/flow-off-cases.mjs";

const PORT = process.argv[2] ?? "5199";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
const a = await captureFlowOffCases(page);
const b = await captureFlowOffCases(page);
await browser.close();
const differ = Object.keys(a).filter(k => a[k].state !== b[k].state || a[k].grain !== b[k].grain);
const repeat = differ.length === 0;
console.log(JSON.stringify({ repeat, differ, errors, cases: a }, null, 1));
if (!repeat || errors.length) { console.log("baseline NOT written: cases did not repeat or the page logged errors"); process.exit(1); }
const commit = execSync("git rev-parse HEAD").toString().trim();
writeFileSync(new URL("./fixtures/flow-off-baseline.json", import.meta.url),
  JSON.stringify({ commit, captured: new Date().toISOString(), cases: a }, null, 1) + "\n");
console.log(`baseline written for ${commit}`);
