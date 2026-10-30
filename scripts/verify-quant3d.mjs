// Genuine volume-solver checks against independent geometry, conservation
// and a sharp-interface similarity solution. Never reuse a 2D tip velocity.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { closeBrowser } from "./browser-cleanup.mjs";
import { installQuant3Driver } from "./fixtures/quant3d-driver.mjs";

const OUT = resolve(process.argv[2] ?? "verify-out"), PORT = process.argv[3] ?? "5199";
// Optional explicit gate filter supports diagnosing a failed fixture. The
// registered full-suite invocation omits it and always runs every gate.
const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  protocolTimeout: 3_600_000, args: ["--enable-unsafe-webgpu", "--enable-gpu"], defaultViewport: { width: 800, height: 700 } });
const page = await browser.newPage(), errors = [], results = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" || /binding size|minimum.*binding size/.test(m.text())) errors.push(m.text()); });
let failures = 0;
let metadata = null;
const check = (name, ok, data) => { results.push({ name, ok, data }); if (!ok) failures++; console.log(name, ok ? "OK" : "FAIL", JSON.stringify(data)); };
async function gate(name, run, judge) {
  if (only && !only.test(name)) { console.log(name, "SKIP (focused invocation)"); return; }
  const start = performance.now();
  try { const data = await run(); check(name, judge(data), data); console.log(name, "elapsed-ms", Math.round(performance.now()-start)); }
  catch (e) { check(name, false, { exception: e.stack ?? String(e) }); }
}
try {
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!window.__solidify);
  await page.evaluate(installQuant3Driver);
  metadata = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    const { PHASE_TABLE_VERSION } = await import("/src/phasedata.ts");
    return { capturedAt: new Date().toISOString(), seed: "51105d1f", build: window.__solidify.app.meta().build,
      phaseTable: PHASE_TABLE_VERSION, lengthUnit: "W0", timeUnit: "tau0", temperature: "Ttilde1=liquidus; pure latent1",
      adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description } : null,
      features: [...window.__solidify.sim().device.features] };
  });
  metadata.sourceHashes = Object.fromEntries(["sim3d", "shaders3d", "shaders3d-quant"].map(s =>
    [s, createHash("sha256").update(readFileSync(`src/${s}.ts`)).digest("hex")]));

  // A planar equilibrium profile is tanh(x/sqrt(2)W0), for every normal.
  await gate("QPF3-EQUIL", () => page.evaluate(async () => {
    const Q = window.__q3, rows = [];
    for (const axis of [0, 1, 2]) {
      const st = await Q.stage({ n: 64, dx: 0.4, axis });
      const before = await Q.state(), x0 = Q.cross(Q.profile(before.phi, st.n, axis));
      await Q.advance(2000);
      const after = await Q.state(), row = Q.profile(after.phi, st.n, axis), x1 = Q.cross(row);
      const fit = [];
      for (let i = 0; i < row.length; i++) if (row[i] > 0.02 && row[i] < 0.98) fit.push([i + 0.5, Math.atanh(1 - 2 * row[i])]);
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [x,y] of fit) { sx += x; sy += y; sxx += x*x; sxy += x*y; }
      const slope = (fit.length*sxy-sx*sy)/(fit.length*sxx-sx*sx), width = st.dx / (Math.SQRT2 * slope);
      let transverseError = 0;
      for (let z = 0; z < st.n; z++) for (let y = 0; y < st.n; y++) for (let x = 0; x < st.n; x++) {
        const i = (z * st.n + y) * st.n + x;
        transverseError = Math.max(transverseError, Math.abs(after.phi[i] - row[[x,y,z][axis]]));
      }
      rows.push({ ...st, axis, driftCells: x1-x0, widthOverW0: width, fitPoints: fit.length, transverseError });
    }
    return rows;
  }), rows => rows.length === 3 && rows.every(r => r.fitPoints >= 8 && Math.abs(r.driftCells) < 0.1
    && Math.abs(r.widthOverW0 - 1) < 0.02 && r.transverseError < 1e-6));

  // Sum(phi) measures continuous volume, avoiding integer voxel-count noise
  // around a slowly moving critical interface. Sphere has TWO curvatures;
  // the cylindrical control has one. The refinement halves dx at fixed box.
  await gate("QPF3-GIBBS-THOMSON", () => page.evaluate(async () => {
    const Q = window.__q3, rows = [], lambda = 2, delta = 0.08;
    for (const cfg of [{ shape: "sphere", dx: 0.8, n: 64, bracket: 0.08, curvature: 2 },
      { shape: "sphere", dx: 0.4, n: 128, bracket: 0.05, curvature: 2 },
      { shape: "cylinder", dx: 0.4, n: 128, bracket: 0.05, curvature: 1 }]) {
      const predicted = cfg.curvature * Q.A1 / lambda / delta, arms = [];
      for (const factor of [1-cfg.bracket, 1+cfg.bracket]) {
        const st = await Q.stage({ ...cfg, lambda, T: 1-delta, radius: predicted*factor });
        const a = Q.stats((await Q.state()).phi).sum;
        const steps = Math.ceil(5 / st.dt); await Q.advance(steps);
        const b = Q.stats((await Q.state()).phi).sum;
        arms.push({ radiusW0: predicted*factor, volumeBefore: a, volumeAfter: b, relativeChange: (b-a)/a, dt: st.dt, steps });
      }
      const [a,b] = arms, crossing = a.radiusW0 + (-a.relativeChange)/(b.relativeChange-a.relativeChange)*(b.radiusW0-a.radiusW0);
      rows.push({ ...cfg, predictedW0: predicted, arms, measuredW0: crossing, relativeError: Math.abs(crossing-predicted)/predicted });
    }
    return rows;
  }), rows => rows.length === 3 && rows.every(r => r.arms[0].relativeChange < -1e-5 && r.arms[1].relativeChange > 1e-5
    && r.relativeError < r.bracket));

  await gate("QPF3-ENERGY", () => page.evaluate(async () => {
    const Q = window.__q3;
    const st = await Q.stage({ n: 32, dx: 0.5, shape: "sphere", radius: 4, T: 0.65, perturbT: true, params: { frozenT: 0 } });
    const a = await Q.state(); let e0 = 0;
    for (let i = 0; i < a.phi.length; i++) e0 += a.T[i] - a.phi[i];
    await Q.advance(10000);
    const b = await Q.state(); let e1 = 0;
    for (let i = 0; i < b.phi.length; i++) e1 += b.T[i] - b.phi[i];
    return { ...st, initialEnergy: e0, finalEnergy: e1, relativeDrift: Math.abs(e1-e0)/Math.abs(e0),
      initialPhase: Q.stats(a.phi).sum, finalPhase: Q.stats(b.phi).sum, temperature: Q.stats(b.T), steps: 10000 };
  }), r => Math.abs(r.initialEnergy) > 1 && Math.abs(r.finalPhase-r.initialPhase) > 1
    && r.relativeDrift <= 5e-5 && r.temperature.min > -1 && r.temperature.max < 2);

  await gate("QPF3-COVARIANCE", () => page.evaluate(async () => {
    const Q=window.__q3, q90=[0,0,Math.SQRT1_2,Math.SQRT1_2], q30=[0,0,Math.sin(Math.PI/12),Math.cos(Math.PI/12)];
    const runs=[];
    for(const delta of [0,.04])for(const quat of [[0,0,0,1],q90,q30]){
      const st=await Q.stage({n:64,dx:.5,shape:"sphere",radius:5,T:.7,quat,params:{aniMode3:1,delta}});
      const initial=Q.stats((await Q.state()).phi).sum;
      await Q.advance(Math.ceil(4/st.dt));
      const after=await Q.state();runs.push({delta,quat,phi:after.phi,initial,final:Q.stats(after.phi).sum,dt:st.dt});
    }
    const diff=(a,b)=>{let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return max;};
    return {isotropic90:diff(runs[0].phi,runs[1].phi),isotropic30:diff(runs[0].phi,runs[2].phi),
      cubic90:diff(runs[3].phi,runs[4].phi),cubic30:diff(runs[3].phi,runs[5].phi),
      runs:runs.map(({phi,...r})=>r)};
  }),r=>r.runs.every(q=>Math.abs(q.final-q.initial)>1)&&r.isotropic90<1e-6&&r.isotropic30<1e-6
    &&r.cubic90<2e-5&&r.cubic30>1e-4);

  // Two-sided Stefan similarity solution with equal diffusivities, far-field
  // solid0.7/liquid0.9, melting T1, latent1. The nonlinear jump condition is
  // sqrt(pi) beta exp(beta²) = Ste_s/(1+erf beta)+Ste_l/erfc beta.
  await gate("QPF3-STEFAN", () => page.evaluate(async () => {
    const Q = window.__q3, rows = [];
    for (const cfg of [{ n: 96, dx: 0.8 }, { n: 192, dx: 0.4 }]) {
      const st = await Q.stage({ ...cfg, shape: "stefan", t0: 20, params: { frozenT: 0 } });
      const x0 = Q.cross(Q.profile((await Q.state()).phi, st.n)) * st.dx;
      const steps = Math.ceil(60/st.dt); await Q.advance(steps);
      const x1 = Q.cross(Q.profile((await Q.state()).phi, st.n)) * st.dx;
      const predicted = 2*st.beta*Math.sqrt(st.D)*(Math.sqrt(st.t0+steps*st.dt)-Math.sqrt(st.t0));
      rows.push({ ...st, ...cfg, beta: st.beta, expectedTravelW0: predicted, measuredTravelW0: x1-x0,
        relativeError: Math.abs(x1-x0-predicted)/predicted, steps, elapsedTau0: steps*st.dt });
    }
    return rows;
  }), rows => rows.length === 2 && rows.every(r => r.measuredTravelW0 > 1 && Number.isFinite(r.relativeError))
    && rows[1].relativeError <= 0.05 && rows[1].relativeError <= rows[0].relativeError + 0.005);

  await gate("QPF3-MASS", () => page.evaluate(async () => {
    const Q = window.__q3, rows = [];
    for (const at of [0, 0.35355339059]) for (const walls of [false, true]) {
      const st = await Q.stage({ n: 32, dx: 0.8, lambda: 3, shape: "oblique", T: 0.55, alloy: true, perturbC: true, pore: true,
        params: { atCoef: at, scen: walls ? 4 : 0, holdT: 0.55, holdRate: 0 } });
      const a = await Q.state(), initial = Q.stats(a.c), phase0 = Q.stats(a.phi).sum;
      await Q.advance(10000);
      const b = await Q.state(), final = Q.stats(b.c);
      const gpu = await Q.sim.readQuantitativeMass();
      if (!gpu) throw new Error("quantitative mass reduction unavailable");
      rows.push({ ...st, at, walls, initial, final, gpu, reductionRelativeError: Math.abs(gpu.mass-final.sum)/final.sum,
        relativeDrift: Math.abs(final.sum-initial.sum)/initial.sum,
        initialPhase: phase0, finalPhase: Q.stats(b.phi).sum, steps: 10000 });
    }
    return rows;
  }), rows => rows.length === 4 && rows.every(r => r.initial.sum > 1 && r.final.min >= 0
    && Math.abs(r.finalPhase-r.initialPhase) > 1 && r.relativeDrift <= 5e-5
    && r.gpu.count === r.n ** 3 && r.gpu.nonFinite === 0 && r.gpu.negative === 0
    && r.reductionRelativeError < 1e-5 && r.gpu.min === r.final.min && r.gpu.max === r.final.max));

  await gate("QPF3-AT-PARTITION", () => page.evaluate(async () => {
    const Q = window.__q3, rows = [], k = 0.15, c0 = 0.3;
    const fit = pts => {
      let sx=0,sy=0,sxx=0,sxy=0;
      for(const [x,y] of pts){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
      const m=(pts.length*sxy-sx*sy)/(pts.length*sxx-sx*sx);
      return {m,b:(sy-m*sx)/pts.length};
    };
    for (const lambda of [3,6]) for (const at of [0.35355339059,0]) {
      const st=await Q.stage({n:128,dx:0.8,lambda,x0:24*0.8,T:0.55,alloy:true,params:{atCoef:at,kPart:k,c0}});
      const start=Q.cross(Q.profile((await Q.state()).phi,st.n)), target=120*Q.A1/(lambda*st.dx);
      let steps=0, previous=start, previousTime=0, velocity=NaN, x=start;
      for(let j=0;j<200;j++){
        await Q.advance(500);steps+=500;
        x=Q.cross(Q.profile((await Q.state()).phi,st.n));
        velocity=(x-previous)*st.dx/(steps*st.dt-previousTime);previous=x;previousTime=steps*st.dt;
        if(!Number.isFinite(x)||x-start>=target||x>st.n-40)break;
      }
      const s=await Q.state(), phi=Q.profile(s.phi,st.n), c=Q.profile(s.c,st.n), xi=Math.floor(x-0.5);
      const sp=[]; for(let i=xi-16;i<=xi-5;i++)if(i>=0&&phi[i]>.99)sp.push([i+0.5,c[i]]);
      let peak=c0;for(let i=xi+1;i<Math.min(st.n,xi+60);i++)if(phi[i]<.3)peak=Math.max(peak,c[i]);
      const lp=[];for(let i=xi+2;i<Math.min(st.n,xi+60);i++){const excess=c[i]-c0;if(phi[i]<.05&&excess>.1*(peak-c0)&&excess>1e-4)lp.push([i+0.5,Math.log(excess)]);}
      const sf=fit(sp),lf=fit(lp),cs=sf.m*x+sf.b,cl=c0+Math.exp(lf.m*x+lf.b),keff=cs/cl;
      rows.push({n:st.n,dx:st.dx,dt:st.dt,D:st.D,lambda,at,kEff:keff,cs,cl,solidPoints:sp.length,liquidPoints:lp.length,front:x,initialFront:start,
        matchedTravelD0:(x-start)*st.dx*lambda/Q.A1,targetD0:120,velocityW0:velocity,
        tauVOverW:velocity*(1-(1-k)*.55),farLiquid:c.at(-1),steps,
        profile:{phi,concentration:c}});
    }
    return rows;
  }), rows => {
    const live=rows.length===4&&rows.every(r=>r.solidPoints>=5&&r.liquidPoints>=5&&r.cs>0&&r.cl>0&&r.front<88
      && r.matchedTravelD0>=120&&Math.abs(r.farLiquid-.3)<1e-4);
    const on=rows.filter(r=>r.at>0),off=rows.filter(r=>r.at===0),k=.15;
    return live&&on.every(r=>Math.abs(r.kEff/k-1)<.10)&&Math.abs(on[0].kEff-on[1].kEff)<.1*k
      &&off.some((r,i)=>Math.abs(r.kEff-k)>2*Math.abs(on[i].kEff-k)+.005);
  });

  check("QPF3-ERRORS", errors.length === 0, errors.slice(0, 12));
} finally {
  await page.evaluate(async () => { await window.__q3?.destroy(); }).catch(() => {});
  writeFileSync(resolve(OUT, "quant3d-result.json"), JSON.stringify({ metadata, results, errors, failures }, null, 2));
  await closeBrowser(browser);
}
console.log(failures ? `done: ${failures} failed` : "done: all quantitative 3D checks passed");
if (failures) process.exitCode = 1;
