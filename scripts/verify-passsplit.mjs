// PASSSPLIT — the fused and split solidification steps must be the same solver.
//
// v5.0 splits FLUX -> UPDATE into FLUX -> PHI -> TRANSPORT, because the
// quantitative solver's anti-trapping current needs dphi/dt at cell faces and a
// fused pass only knows it at its own cell. The split ships with ZERO physics
// change on purpose: that makes this test an exact trajectory comparison rather
// than a judgement call about whether two dendrites "look the same", and it
// isolates plumbing bugs (ping-pong bookkeeping, stale phiAux, a missed barrier)
// from the physics changes that come next.
//
// Both arms reset first, and reset() zeroes frame/dir/simTime — so the noise
// stream `hash3(x, y, frame)` is identical in both. Any divergence is the
// plumbing, not chance.
//
//   node scripts/verify-passsplit.mjs [outDir] [port]
import puppeteer from "puppeteer-core";

const PORT = process.argv[3] ?? "5207";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1200, height: 800 },
});
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => {
  const t = m.type();
  if (t === "error") errors.push(m.text());   // includes [solidify] WGSL ... compile errors
  if ((t === "warning" || t === "warn") && /binding size|minimum (buffer )?binding size/i.test(m.text()))
    errors.push("WARN " + m.text());
});

await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
await new Promise(r => setTimeout(r, 700));

/** run one arm and sample the solid-fraction trajectory */
const arm = async (split, alloyOn) => page.evaluate(async ([sp, al]) => {
  const S = window.__solidify;
  const sim = S.sim();
  const read = async () => {
    for (let t = 0; t < 80; t++) {
      const st = await sim.readStats();
      if (st) return st;
      await sim.device.queue.onSubmittedWorkDone();
    }
    return null;
  };
  // stop the frame loop BEFORE touching anything: otherwise the first arm runs
  // with rAF still stepping the solver underneath it and the second does not,
  // which is an asymmetry that looks exactly like a physics difference
  S.app.setRun(false);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  sim.splitPasses = sp;
  S.app.setParams({
    scen: 0, heatIn: 0, coolRate: 0.15, delta: 0.045, aniMode: 4,
    noiseAmp: 0.012, latent: 1.5, alloyOn: al, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.8,
  });
  S.app.setInoculant(0);
  S.app.clearMelt(0.8);
  S.app.seedCenter();
  const traj = [];
  for (let k = 0; k < 10; k++) {
    sim.step(200);               // 2000 substeps per arm — real growth, not a seed
    const st = await read();
    traj.push(st ? st.fracSolid : -1);
  }
  const st = await read();
  return { traj, grains: st?.grainCount ?? -1, interfaceT: st?.interfaceT ?? -1, frame: sim.frame };
}, [split, alloyOn]);

for (const alloyOn of [0, 1]) {
  const label = alloyOn ? "alloy" : "pure";
  const fused = await arm(false, alloyOn);
  const split = await arm(true, alloyOn);
  const dev = fused.traj.map((v, i) => Math.abs(v - split.traj[i]));
  const worst = Math.max(...dev);
  // the two shapes are composed from the same WGSL text and run the same noise
  // stream, so they should agree to float round-off, not merely to a tolerance
  const ok = fused.frame === split.frame && worst < 1e-3 && fused.grains === split.grains;
  console.log(`PASSSPLIT-${label.toUpperCase()}`, ok ? "OK" : FAIL(), JSON.stringify({
    worstDev: +worst.toExponential(2),
    fusedEnd: +fused.traj[fused.traj.length - 1].toFixed(6),
    splitEnd: +split.traj[split.traj.length - 1].toFixed(6),
    grains: [fused.grains, split.grains],
    frames: [fused.frame, split.frame],
  }));
}

// cost of the extra dispatch, measured rather than assumed — the fused path
// stays the default only if the split actually costs something
{
  const cost = await page.evaluate(async () => {
    const S = window.__solidify;
    const sim = S.sim();
    S.app.setRun(false);
    const bench = async (sp) => {
      sim.splitPasses = sp;
      S.app.clearMelt(0.8); S.app.seedCenter();
      sim.step(20); await sim.device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      for (let i = 0; i < 12; i++) { sim.step(20); await sim.device.queue.onSubmittedWorkDone(); }
      return (performance.now() - t0) / 12;
    };
    const fused = await bench(false);
    const split = await bench(true);
    sim.splitPasses = false;
    return { fusedMs: +fused.toFixed(2), splitMs: +split.toFixed(2), ratio: +(split / fused).toFixed(3) };
  });
  console.log("PASSSPLIT-COST", "info", JSON.stringify(cost));
}

console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
if (errors.length) failures++;
await browser.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
