// D3.5 sizing, run BEFORE the velocity inlet's gates were pre-registered
// (tasks/todo.md, "D3.5 velocity inlet - 2026-11-07"). Not a gate.
//
// It runs ONLY the shipped equilibrium inlet (the defect, already measured on
// the GPU by D3.4) through the CPU reference (scripts/fixtures/lbm-ref.mjs) on
// candidate blocked channels at the app's D3.4 setting (nu 3.465, tau 10.895,
// u_lat 0.011404 = lambda 2.4, drag width W = 1.25 cells, h derived). For each
// geometry it prints, over time, the inlet column's mean velocity (the deficit
// the must-miss arm must show) and the density span along the channel (which
// bounds how far ANY correct inlet's column-mean velocity can stray from U in
// this weakly compressible model, since u = (rho u) / rho with rho u uniform).
// The new inlet is not run here.
//
//   node scripts/research/flow-inlet-sizing.mjs [n,n,...] [r/n,r/n,...] [viscous times]
import { createServer } from "vite";
import { LbmRef, diskPhi } from "../fixtures/lbm-ref.mjs";

const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error",
  optimizeDeps: { noDiscovery: true, entries: [] } });
const F = await vite.ssrLoadModule("/src/flow.ts");
await vite.close();

const NU = 0.15 * 23.1, U = 0.011404004977938682, W = 1.25, H = F.deriveDragH();
const ns = (process.argv[2] ?? "64,96,128").split(",").map(Number);
const rs = (process.argv[3] ?? "0.1,0.15,0.2,0.25").split(",").map(Number);
const T = Number(process.argv[4] ?? 8);

console.log(JSON.stringify({ nu: NU, U, W, h: H, inlet: "equilibrium (shipped)" }));
for (const n of ns) for (const rf of rs) {
  const R = rf * n, cx = n / 2, cy = (n - 1) / 2;
  const L = new LbmRef(n, { nu: NU, uIn: U, channel: true, width: W, h: H, phi: diskPhi(n, cx, cy, R, W), inlet: "equilibrium" });
  const tv = Math.round(n * n / NU), rows = [];
  const t0 = performance.now();
  for (let k = 1; k <= 2 * T; k++) {
    L.step(Math.round(tv / 2));
    const c = L.columns();
    const V = Array.from(c.V), Q = Array.from(c.Q);
    rows.push({ steps: L.steps, V0: +c.V[0].toFixed(5), Vmin: +Math.min(...V).toFixed(5), Vmax: +Math.max(...V).toFixed(5),
      Qmin: +Math.min(...Q).toFixed(5), Qmax: +Math.max(...Q).toFixed(5),
      rhoIn: +c.R[0].toFixed(5), rhoOut: +c.R[n - 1].toFixed(5), span: +(c.R[0] - c.R[n - 1]).toFixed(5), mean: +L.meanRho().toFixed(6) });
  }
  console.log(JSON.stringify({ n, rOverN: rf, R, blockage: 2 * rf, viscousTime: tv, wallS: +((performance.now() - t0) / 1000).toFixed(1) }));
  for (const r of rows) console.log("  " + JSON.stringify(r));
}
