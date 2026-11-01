// The 2D cases whose fields must not move when melt flow is OFF (D3.2,
// FLOW-OFF-IDENTITY). Captured once at the commit BEFORE the transport pass
// gained advection (scripts/capture-flow-baseline.mjs) and compared after.
// Each case is seeded and twin-free, steps a fixed number of substeps through
// stepSync, and hashes the full state (phi, T, c, age) and grain fields.
export const FLOW_OFF_CASES = [
  { name: "kobayashi-fused", setup: { split: false } },
  { name: "kobayashi-split", setup: { split: true } },
  { name: "kobayashi-alloy", setup: { split: true, alloy: true } },
  { name: "calibrated-pure", setup: { calibrated: 2.4 } },
  { name: "bridgman", setup: { scen: 1 } },
  { name: "weld", setup: { scen: 2 } },
  { name: "stamp-quench", setup: { quench: true } },
];

/** run every case in the page and return { name: { state, grain } } hashes */
export async function captureFlowOffCases(page) {
  const out = {};
  for (const c of FLOW_OFF_CASES) {
    out[c.name] = await page.evaluate(async (setup) => {
      const S = window.__solidify;
      S.app.setRun(false);
      if (S.mode() !== "2d") await S.app.setMode("2d");
      S.app.setMaterial(setup.calibrated ? "al" : "generic");
      if (S.sim().n !== 256) { S.app.setGrid(256); for (let i = 0; i < 100 && S.sim().n !== 256; i++) await new Promise(r => setTimeout(r, 50)); }
      const sim = S.sim(), frameStep = sim.step;
      sim.step = () => 0;
      try {
        await sim.device.queue.onSubmittedWorkDone();
        S.setSeed(0x0f1c);
        if (setup.calibrated) S.setSolver(1, setup.calibrated); else S.setSolver(0);
        sim.splitPasses = !!setup.split;
        Object.assign(sim.params, { scen: setup.scen ?? 0, heatIn: 0, twinProb: 0, alloyOn: setup.alloy ? 1 : 0, coolRate: 0.2 });
        sim.reset(1 - 0.6);
        sim.addSeed(128, 128, 4);
        if (setup.scen === 2) { sim.params.weldX = 60; sim.params.weldY = 90; }
        for (let i = 0; i < 3; i++) await sim.stepSync(0);
        for (let k = 0; k < 12; k++) {
          await sim.stepSync(25);
          if (setup.quench && k === 5) { sim.quench(0.2); await sim.stepSync(0); }
        }
        await sim.device.queue.onSubmittedWorkDone();
        const n = sim.n, st = await sim.readRows(0, n), gr = await sim.readGrainRows(0, n);
        const sha = async a => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
          new Uint8Array(a.buffer, a.byteOffset, a.byteLength)))].map(v => v.toString(16).padStart(2, "0")).join("");
        return { state: await sha(st), grain: await sha(gr), simTime: sim.simTime, solver: sim.params.solver };
      } finally { sim.step = frameStep; sim.splitPasses = false; }
    }, c.setup);
  }
  return out;
}
