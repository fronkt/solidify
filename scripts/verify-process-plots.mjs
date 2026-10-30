// Process plots: actual builders and unit/export paths, no browser or GPU.
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
let failures = 0;
const gate = async (name, run) => {
  try { const detail = await run(); console.log(name, "OK", JSON.stringify(detail ?? {})); }
  catch (error) { failures++; console.log(name, "FAIL", error.message); }
};
const assert = (ok, why) => { if (!ok) throw new Error(why); };
try {
  const P = await server.ssrLoadModule("/src/plot/process.ts");
  const Q = await server.ssrLoadModule("/src/plot/quantity.ts");
  const C = await server.ssrLoadModule("/src/plot/csv.ts");
  const U = await server.ssrLoadModule("/src/units.ts");
  const M = await server.ssrLoadModule("/src/materials.ts");
  const F = await server.ssrLoadModule("/src/plot/figures.ts");
  const H = await server.ssrLoadModule("/src/heattreat.ts");
  const L = await server.ssrLoadModule("/src/plot/layout.ts");
  const mat = M.MATERIALS.al, si = mat.si;
  const bridge = Q.bridgeOf(new U.Units(U.scaleOf({ si, n: 256, dx: 0.03, latent: 1.6, dSol: 0.9, alloy: true, umPerCell: 1 }), si), "Al–Cu");
  const prov = { material: "Al–Cu", seed: "abc12345", grid: "256²", solver: "Kobayashi", share: "https://example.test/app/#set=fixture", build: "fixture" };
  const dataRows = f => C.toCSV(f.title, f.columns, f.bridge, f.prov).split("\n").filter(l => l && !l.startsWith("#"));

  await gate("PROCESS-LIVE-POUR", () => {
    const f = P.livePourFigure({ series: [{ t: 0, T: 0.2, fs: 0.1, fired: 1 }, { t: 1, T: 0, fs: 0.4, fired: 4 }, { t: 2, T: -0.3, fs: 0.8, fired: 8 }, { t: 3, T: null, fs: 1, fired: 8 }], bridge, chem: F.chemOf(mat.params), prov });
    const rows = dataRows(f), keys = rows[0].split(","), ti = keys.indexOf("T_dimensionless");
    assert(rows[2].split(",")[ti] === "0" && rows[3].split(",")[ti] === "-0.3", "zero/negative liquid temperature was dropped");
    assert(rows[4].split(",")[ti] === "", "absent liquid became a temperature");
    const ys = f.fig.panels[0].series[0].ys;
    assert(ys.filter(Number.isFinite).length === 3 && Number.isNaN(ys[3]), "live path does not preserve the gap");
    assert(f.columns.some(c => c.key === "sites_fired" && c.values[2] === 8), "activated site record lost");
    return { samples: rows.length - 1, validTemperatures: 3 };
  });

  await gate("PROCESS-FURNACE-CLOCK", () => {
    const sch = { name: "test heat", startC: 20, stages: [{ kind: "ramp", toC: 500, cPerMin: 12 }, { kind: "hold", minutes: 60 }, { kind: "quench", toC: 20, cPerSec: 120 }] };
    const d0 = 12, points = P.heatTrajectory(sch, si, d0), ints = H.integrate(sch, si);
    const last = points.at(-1), want = H.grainAfter(d0 * 1e-6, ints.gg, si) * 1e6;
    assert(points.length > 100 && last.lawUm > d0, "trajectory did not grow");
    assert(Math.abs(last.seconds - ints.seconds) < 1e-8 && Math.abs(last.lawUm / want - 1) < 1e-5, "trajectory disagrees with independently integrated schedule");
    assert(points.every((p, i) => !i || p.seconds > points[i - 1].seconds), "furnace clock not strictly increasing");
    const f = P.heatProcessFigure({ points, measured: [{ seconds: 0, diameterUm: d0 }, { seconds: last.seconds, diameterUm: want * 0.98 }], bridge, prov, lawAvailable: true, progressSeconds: last.seconds });
    const rows = dataRows(f), keys = rows[0].split(","), time = keys.indexOf("furnace_time_s"), temp = keys.indexOf("scheduled_temperature_C");
    assert(!keys.includes("furnace_time_dimensionless"), "furnace time was treated as solver time");
    assert(Math.abs(+rows.at(-1).split(",")[time] - ints.seconds) < 1e-4 && +rows[1].split(",")[temp] === 20, "furnace units converted through phase-field bridge");
    const midway = points[Math.floor(points.length / 2)];
    assert(Math.abs(P.equivalentHeatTime(points, midway.lawUm) - midway.seconds) < 1e-5, "delivered budget maps to wrong physical time");
    const withdrawn = P.heatProcessFigure({ points, measured: [{ seconds: 0, diameterUm: d0 }], bridge, prov, lawAvailable: false });
    assert(withdrawn.columns.find(c => c.key === "law_diameter").values.every(Number.isNaN), "withdrawn law still exported");
    for (const [w, h] of [[252, 300], [640, 560]]) {
      const lay = L.layoutFigure(f.fig, w, h, L.approxMeasure);
      assert(lay.panels.length === 2, "physical schedule and grain-size panels did not lay out");
    }
    return { samples: points.length, furnaceSeconds: last.seconds, lawEndUm: want, solverSecondsPerUnit: bridge.units.scale.secondsPerUnit };
  });

  await gate("PROCESS-CONVERGENCE", () => {
    const f = P.convergenceFigure([{ episode: 1, error: 2, best: 2, score: 2.03 }, { episode: 2, error: null, best: 2, score: 8 }, { episode: 3, error: 0.4, best: 0.4, score: 0.53 }], bridge, prov, 4);
    const rows = dataRows(f), keys = rows[0].split(",");
    assert(keys.includes("casting") && keys.includes("error") && keys.includes("best_error") && keys.includes("score"), "convergence columns incomplete");
    assert(rows[2].split(",")[keys.indexOf("error")] === "", "failed casting became a valid grain-number error");
    const series = f.fig.panels[0].series;
    assert(series[0].ys[2] === 0.4 && series[1].ys[2] === 0.4, "search score penalty leaked into grain-number error");
    assert(f.prov.extra.some(s => s.includes("G = 4")), "target omitted from exported identity");
    assert(P.convergenceFigure([], bridge, prov, 4).fig.empty, "no completed castings has no empty state");
    return { completedCastings: rows.length - 1, finalError: 0.4, score: 0.53 };
  });
} finally {
  await server.close();
}
process.exitCode = failures ? 1 : 0;
