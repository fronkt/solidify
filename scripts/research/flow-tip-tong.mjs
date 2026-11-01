// FLOW-TIP-TONG — a literature study, NOT a regression gate (the quantitative
// 3D literature campaign set the precedent: a reference comparison that can fail
// on the physics lives here and keeps its claim open; the regression suite keeps
// the deterministic checks). Protocol pre-registered in tasks/todo.md
// ("FLOW-TIP-TONG protocol") before its first run, unchanged since.
//
// Writes docs/validation/flow-tong-<date>.json with every number, pass or fail.
//
//   node scripts/research/flow-tip-tong.mjs [port]
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PORT = process.argv[2] ?? "5199";
let verdict = null;
const check = (name, ok, detail) => { verdict = { name, ok, detail }; console.log(name, ok ? "OK" : "FAIL", JSON.stringify(detail)); };
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
try {
  // FLOW-TIP-TONG (pre-registered protocol: tasks/todo.md "FLOW-TIP-TONG")
  {
    const A1 = 0.8839, A2 = 0.6267, DELTA = 0.55, EPS4 = 0.05, REF = 0.017, PR = 23.1, UD0D = 0.035;
    const arm = (lambda, flow) => page.evaluate(async ([lambda, flow, A1, A2, DELTA, EPS4, REF, PR, UD0D]) => {
      const S = window.__solidify;
      S.app.setRun(false);
      if (S.sim().n !== 1024) { S.app.setGrid(1024); for (let i = 0; i < 200 && S.sim().n !== 1024; i++) await new Promise(r => setTimeout(r, 50)); }
      const sim = S.sim(), f = sim.step; sim.step = () => 0;
      try {
        await sim.device.queue.onSubmittedWorkDone();
        S.app.setInoculant(0);
        const dx = 0.8, dTilde = A2 * lambda, dt = (0.15 * dx * dx) / Math.max(1, dTilde);
        Object.assign(sim.params, { solver: 1, lambda, dx, dt, epsBar: 1, tau: 1, delta: EPS4, aniMode: 4, noiseAmp: 0,
          latent: 1, dTherm: dTilde, dSol: dTilde, alloyOn: 0, coolRate: 0, heatIn: 0, scen: 0, twinProb: 0, facet: 0, frozenT: 0 });
        if (flow) {
          Object.assign(sim.flowCfg, { u: UD0D * (lambda / A1) * 0.15 * dx, pr: PR, scale: flow.scale });
          const why = sim.setFlow(true);
          if (why) return { why };
        } else sim.setFlow(false);
        sim.reset(1 - DELTA);
        sim.addSeed(sim.n / 2, sim.n / 2, 8 / dx, 0);
        await sim.stepSync(0);
        const mid = sim.n / 2;
        const westTip = async () => {
          const d = await sim.readRows(mid, 1);
          for (let i = mid; i > 0; i--) if (d[i * 4] >= 0.5 && d[(i - 1) * 4] < 0.5) {
            const a = d[(i - 1) * 4], b = d[i * 4];
            return (i - 1) + (0.5 - a) / (b - a);
          }
          return NaN;
        };
        const vGuess = (REF * dTilde * lambda) / A1, travel = (8 * dTilde) / vGuess, NS = 33;
        const chunk = Math.max(50, Math.round(travel / vGuess / NS / dt));
        const trace = [];
        let t = 0;
        for (let k = 0; k < NS; k++) {
          await sim.stepSync(chunk);
          t += chunk * dt;
          const x = await westTip();
          trace.push({ t, x });
          if (!(x > sim.n * 0.12)) break;
        }
        const third = trace.slice(2 * Math.floor(trace.length / 3));
        let sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (const p of third) { sx += p.t; sy += p.x; sxy += p.t * p.x; sxx += p.t * p.t; }
        const slope = (third.length * sxy - sx * sy) / (third.length * sxx - sx * sx);   // cells per tau0, negative (westward)
        return { lambda, v: -slope * dx, chunk, samples: trace.length, tipX: trace.at(-1)?.x, trace: trace.map(p => +p.x.toFixed(2)) };
      } finally { sim.setFlow(false); Object.assign(sim.flowCfg, { u: 0.02, pr: 23.1, scale: 1 }); sim.step = f; }
    }, [lambda, flow, A1, A2, DELTA, EPS4, REF, PR, UD0D]);
    const rows = [];
    for (const lambda of [2.0, 2.4, 3.2]) {
      const none = await arm(lambda, null), fwd = await arm(lambda, { scale: 1 });
      rows.push({ lambda, vNoFlow: none.v, vFlow: fwd.v, ratio: fwd.v / none.v, samples: [none.samples, fwd.samples],
        Vd0overD: (none.v * A1) / (A2 * lambda * lambda), why: none.why ?? fwd.why });
    }
    const zero = await arm(2.4, { scale: 0 }), rev = await arm(2.4, { scale: -1 });
    const base24 = rows.find(r => r.lambda === 2.4);
    const ratios = rows.map(r => r.ratio), mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const spread = (Math.max(...ratios) - Math.min(...ratios)) / mean;
    const inBand = rows.every(r => r.ratio >= 1.26 && r.ratio <= 1.54);
    const zeroExact = zero.v === base24?.vNoFlow, revBelow = rev.v / base24.vNoFlow < 1;
    check("FLOW-TIP-TONG", inBand && spread < 0.05 && zeroExact && revBelow, {
      band: "[1.26, 1.54] every lambda, spread < 5 %", rows: rows.map(r => ({ lambda: r.lambda, ratio: +r.ratio.toFixed(3),
        Vd0overD_noflow: +r.Vd0overD.toExponential(3), samples: r.samples, why: r.why })),
      spread: +spread.toFixed(4), couplingZeroRatio: +(zero.v / base24.vNoFlow).toFixed(6), couplingReversedRatio: +(rev.v / base24.vNoFlow).toFixed(3),
    });
  }
} finally { await browser.close(); }
const date = new Date().toISOString().slice(0, 10);
const commit = execSync("git rev-parse HEAD").toString().trim();
writeFileSync(new URL(`../../docs/validation/flow-tong-${date}.json`, import.meta.url),
  JSON.stringify({ study: "FLOW-TIP-TONG", commit, date, protocol: "tasks/todo.md, FLOW-TIP-TONG protocol", pageErrors: errors, ...verdict }, null, 1) + String.fromCharCode(10));
process.exit(verdict?.ok && !errors.length ? 0 : 1);
