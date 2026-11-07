// D3.5: proof, without a browser, that switching the melt-flow inlet changes
// nothing on the flow-off path (tasks/todo.md, "D3.5 velocity inlet -
// 2026-11-07", flow-off identity proof). Not a CI gate: it needs the base
// commit in the local git history.
//
// Against a base commit (default 3b3fbdd, where feature/flow-inlet started):
//   1. every exported WGSL string of src/shaders.ts (the passes the 2D solver
//      builds with flow off, and with flow on apart from the LBM) hashes the
//      same, generated from the base text and from the working tree;
//   2. src/shaders.ts and src/sim.ts are unchanged (git diff, line endings
//      normalised as git stores them), so nothing that composes those strings
//      at run time changed either;
//   3. the lattice Boltzmann WGSL (lbm.ts LBM_WGSL) DIFFERS: the witness that
//      this comparison can see a shader change at all;
//   4. the LBM pipeline is built only by FlowSolver, and `new FlowSolver`
//      appears only in sim.ts setFlow, which flow-off never calls with true.
// FLOW-OFF-IDENTITY (verify-flow-gpu.mjs) stays the runtime proof.
//
//   node scripts/research/flow-inlet-identity.mjs [base]
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";

const base = process.argv[2] ?? "3b3fbdd";
const root = fileURLToPath(new URL("../../", import.meta.url));
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const sha = s => createHash("sha256").update(s).digest("hex");

/** the exported string constants of a TS module that has no imports */
async function wgslExports(tsText) {
  const { code } = await transform(tsText, { loader: "ts", format: "esm" });
  const mod = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  const out = {};
  for (const [k, v] of Object.entries(mod)) if (typeof v === "string" && /@compute|@vertex|@fragment|\bfn\s/.test(v)) out[k] = sha(v);
  return out;
}
/** a template literal's text as JS evaluates it (line terminators -> LF) */
const lbmWgsl = text => {
  const m = text.match(/const LBM_WGSL = \/\* wgsl \*\/ `([\s\S]*?)`;/);
  if (!m) throw new Error("LBM_WGSL not found");
  return m[1].replace(/\r\n?/g, "\n");
};

const baseShaders = git("show", `${base}:src/shaders.ts`);
const headShaders = readFileSync(join(root, "src/shaders.ts"), "utf8");
if (/^import\s/m.test(baseShaders) || /^import\s/m.test(headShaders)) throw new Error("shaders.ts gained an import: load it through vite instead");
const [b, h] = [await wgslExports(baseShaders), await wgslExports(headShaders)];
const names = [...new Set([...Object.keys(b), ...Object.keys(h)])].sort();
const differ = names.filter(k => b[k] !== h[k]);

const unchanged = ["src/shaders.ts", "src/sim.ts"].map(p => {
  let same = true;
  try { git("diff", "--quiet", base, "--", p); } catch { same = false; }
  return { path: p, same };
});
const changedSrc = git("diff", "--name-only", base, "--", "src").split("\n").filter(Boolean);

const lbmBase = sha(lbmWgsl(git("show", `${base}:src/lbm.ts`)));
const lbmHead = sha(lbmWgsl(readFileSync(join(root, "src/lbm.ts"), "utf8")));

const files = [];
const walk = d => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(e)) files.push(p); } };
walk(join(root, "src"));
const constructs = files.flatMap(p => readFileSync(p, "utf8").split(/\r?\n/).map((l, i) => ({ p, i, l }))
  .filter(x => /new FlowSolver\(/.test(x.l)).map(x => `${x.p.replace(/\\/g, "/").replace(/^.*\/src\//, "src/")}:${x.i + 1}`));
const simText = readFileSync(join(root, "src/sim.ts"), "utf8");
const inSetFlow = /setFlow\(on: boolean\)[\s\S]*?new FlowSolver\(/.test(simText.slice(simText.indexOf("setFlow(on: boolean)"), simText.indexOf("setFlow(on: boolean)") + 900));

const ok = names.length >= 10 && differ.length === 0 && unchanged.every(u => u.same) && lbmBase !== lbmHead
  && constructs.length === 1 && /^src\/sim\.ts:/.test(constructs[0]) && inSetFlow;
console.log(JSON.stringify({
  base, head: git("rev-parse", "--short", "HEAD").trim(), dirty: git("status", "--porcelain", "--", "src").trim() !== "",
  shadersExportsHashed: names.length, exportsThatDiffer: differ, perExport: Object.fromEntries(names.map(k => [k, h[k]?.slice(0, 16)])),
  sourcesUnchanged: unchanged, srcFilesChangedSinceBase: changedSrc,
  lbmWgsl: { base: lbmBase.slice(0, 16), head: lbmHead.slice(0, 16), differs: lbmBase !== lbmHead },
  flowSolverConstructed: constructs, onlyInSetFlow: inSetFlow,
}, null, 1));
console.log(ok ? "FLOW-INLET-OFF-IDENTITY OK" : "FLOW-INLET-OFF-IDENTITY FAIL");
process.exitCode = ok ? 0 : 1;
