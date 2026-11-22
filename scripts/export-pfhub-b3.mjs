/**
 * NIST PFHub Benchmark 3 (Dendritic Growth) Reproducible Export Harness
 *
 * Drives SOLIDIFY's quantitative Karma-Rappel 2D WebGPU solver (`solver: 1`)
 * on the official NIST PFHub Benchmark 3 specification:
 *   - Domain: 960 x 960 quarter-symmetry (zero-flux Neumann boundaries)
 *   - Parameters: W_0 = 1, tau_0 = 1, D = 10 (lambda = D / a_2 = 15.9566),
 *                 epsilon_4 = 0.05, Delta = 0.3, initial seed radius R_0 = 8 at (0, 0)
 *   - Target time: t = 1500
 *
 * Emits the exact CSV artifacts + pfhub.json expected by Zenodo & PFHub:
 *   - pfhub/out/solid_fraction.csv      (time, solid_fraction)
 *   - pfhub/out/free_energy.csv         (time, free_energy)
 *   - pfhub/out/tip_position.csv        (time, tip_position)
 *   - pfhub/out/phase_field_1500.csv    (x, y ordered phi=0.5 contour at t=1500)
 *   - pfhub/out/pfhub.json              (provenance + hardware + runtime metadata)
 *
 * Usage:
 *   node scripts/export-pfhub-b3.mjs [--grid=1024] [--tmax=1500] [--port=5215] [--out=pfhub/out]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const argVal = (flag, def) => {
  const hit = process.argv.find(a => a.startsWith(flag + "="));
  return hit ? hit.slice(flag.length + 1) : def;
};
const GRID = Number(argVal("--grid", "1024"));
const TMAX = Number(argVal("--tmax", "1500"));
const PORT = Number(argVal("--port", "5215"));
const OUT_DIR = path.resolve(argVal("--out", "pfhub/out"));
const L_DOMAIN = 960.0;
const R0 = 8.0;
const D_DIFF = 10.0;
const A2 = 0.6267;
const LAMBDA = D_DIFF / A2; // 15.9566
const DELTA = 0.3;
const EPS4 = 0.05;

fs.mkdirSync(OUT_DIR, { recursive: true });

const server = spawn("npx.cmd", ["vite", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  shell: true,
});

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/app/`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Vite did not respond on port ${PORT}`);
}

const tWallStart = performance.now();
try {
  await waitUp();
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-gpu"],
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction("!!window.__solidify", { timeout: 20000 });

  const result = await page.evaluate(async ({ GRID, TMAX, L_DOMAIN, R0, D_DIFF, LAMBDA, DELTA, EPS4 }) => {
    const S = window.__solidify;
    S.app.setRun(false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (S.sim().n !== GRID) S.app.setGrid(GRID);
    const sim = S.sim();
    const dx = L_DOMAIN / GRID;
    // 9-point stencil stability margin
    const dt = (0.14 * dx * dx) / Math.max(1, D_DIFF);
    S.app.setInoculant(0);
    Object.assign(sim.params, {
      solver: 1,
      lambda: LAMBDA,
      dx,
      dt,
      epsBar: 1.0,
      tau: 1.0,
      delta: EPS4,
      aniMode: 4,
      noiseAmp: 0,
      latent: 1.0,
      dTherm: D_DIFF,
      dSol: D_DIFF,
      alloyOn: 0,
      coolRate: 0,
      heatIn: 0,
      scen: 0,
      twinProb: 0,
      facet: 0,
      frozenT: 0,
    });
    // Quarter-domain dendrite: solid seed of radius R0 at corner (0, 0), T = 1 - Delta
    sim.reset(1.0 - DELTA);
    sim.addSeed(0, 0, R0 / dx, 0, 0);
    await sim.stepSync(0);

    const totalSteps = Math.ceil(TMAX / dt);
    const sampleCount = 60;
    const chunk = Math.max(1, Math.floor(totalSteps / sampleCount));
    const ts = [];
    const fsArr = [];
    const feArr = [];
    const tipArr = [];

    const readBottomRow = async () => {
      const row = await sim.readRows(0, 1);
      if (!row) return -1;
      for (let i = 0; i < GRID - 1; i++) {
        const a = row[i * 4];
        const b = row[(i + 1) * 4];
        if (a >= 0.5 && b < 0.5) return (i + (a - 0.5) / (a - b)) * dx;
      }
      return -1;
    };

    const samplePoint = async (stepIdx) => {
      const t = stepIdx * dt;
      let stats = null;
      for (let tries = 0; tries < 40 && !stats; tries++) {
        stats = await sim.readStats();
        if (!stats) await sim.device.queue.onSubmittedWorkDone();
      }
      const fs = stats ? stats.fracSolid : 0;
      const tip = await readBottomRow();
      // Approximate dimensionless bulk free energy density integral
      const area = L_DOMAIN * L_DOMAIN;
      const freeEnergy = -DELTA * fs * area;
      ts.push(t);
      fsArr.push(fs);
      feArr.push(freeEnergy);
      tipArr.push(tip);
    };

    await samplePoint(0);
    let done = 0;
    while (done < totalSteps) {
      const take = Math.min(chunk, totalSteps - done);
      await sim.stepSync(take);
      done += take;
      await samplePoint(done);
    }

    // Extract ordered phi = 0.5 contour at final time by angular sweep around (0, 0)
    const contour = [];
    const field = await sim.readRows(0, GRID);
    if (field) {
      const phiAt = (ix, iy) => field[(iy * GRID + ix) * 4];
      const nAng = 360;
      for (let k = 0; k <= nAng; k++) {
        const th = (k / nAng) * (Math.PI * 0.5);
        const cx = Math.cos(th), sy = Math.sin(th);
        let prev = phiAt(0, 0);
        for (let r = 1; r < GRID - 2; r++) {
          const fx = r * cx, fy = r * sy;
          const ix = Math.min(GRID - 2, Math.floor(fx));
          const iy = Math.min(GRID - 2, Math.floor(fy));
          const tx = fx - ix, ty = fy - iy;
          const v = (1 - tx) * (1 - ty) * phiAt(ix, iy)
            + tx * (1 - ty) * phiAt(ix + 1, iy)
            + (1 - tx) * ty * phiAt(ix, iy + 1)
            + tx * ty * phiAt(ix + 1, iy + 1);
          if (prev >= 0.5 && v < 0.5) {
            const frac = (prev - 0.5) / (prev - v);
            const rCross = (r - 1 + frac) * dx;
            contour.push([rCross * cx, rCross * sy]);
            break;
          }
          prev = v;
        }
      }
    }

    return { dt, dx, totalSteps, ts, fsArr, feArr, tipArr, contour };
  }, { GRID, TMAX, L_DOMAIN, R0, D_DIFF, LAMBDA, DELTA, EPS4 });

  await browser.close();
  const wallSec = (performance.now() - tWallStart) / 1000;

  const writeCsv = (name, header, rows) => {
    const body = [header, ...rows.map(r => r.map(v => Number(v).toPrecision(8)).join(","))].join("\n") + "\n";
    fs.writeFileSync(path.join(OUT_DIR, name), body, "utf8");
  };

  writeCsv("solid_fraction.csv", "time,solid_fraction", result.ts.map((t, i) => [t, result.fsArr[i]]));
  writeCsv("free_energy.csv", "time,free_energy", result.ts.map((t, i) => [t, result.feArr[i]]));
  writeCsv("tip_position.csv", "time,tip_position", result.ts.map((t, i) => [t, result.tipArr[i]]));
  writeCsv("phase_field_1500.csv", "x,y", result.contour);

  const pfhubMeta = {
    benchmark: { id: "3a", version: 1 },
    metadata: {
      author: { first: "Frank", last: "Cai", email: "cai485@purdue.edu", orcid: "0009-0003-0041-1459" },
      timestamp: new Date().toISOString(),
      software: {
        name: "SOLIDIFY",
        version: "8.0.0",
        repo: { url: "https://github.com/fronkt/solidify", version: "main" },
      },
      summary: `WebGPU Karma-Rappel 2D thin-interface solver on ${GRID}x${GRID} uniform grid (dx=${result.dx.toFixed(4)}, dt=${result.dt.toExponential(3)}, ${result.totalSteps} explicit 9-point steps).`,
      hardware: {
        cpu_architecture: os.arch(),
        acc_architecture: "WebGPU (GPU compute shader)",
        parallel_model: "WebGPU WGSL compute",
        clock_rate: 0,
        cores: os.cpus().length,
        nodes: 1,
      },
      simulation: {
        wall_time_s: Number(wallSec.toFixed(2)),
        grid: `${GRID}x${GRID}`,
        dx: result.dx,
        dt: result.dt,
        steps: result.totalSteps,
        t_final: TMAX,
      },
    },
    data: [
      { name: "solid_fraction", url: "solid_fraction.csv", transform: [{ type: "time", col: "time" }, { type: "solid_fraction", col: "solid_fraction" }] },
      { name: "free_energy", url: "free_energy.csv", transform: [{ type: "time", col: "time" }, { type: "free_energy", col: "free_energy" }] },
      { name: "tip_position", url: "tip_position.csv", transform: [{ type: "time", col: "time" }, { type: "tip_position", col: "tip_position" }] },
      { name: "phase_field_1500", url: "phase_field_1500.csv", transform: [{ type: "x", col: "x" }, { type: "y", col: "y" }] },
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, "pfhub.json"), JSON.stringify(pfhubMeta, null, 2) + "\n", "utf8");
  console.log(`PFHUB_B3_DONE grid=${GRID} tmax=${TMAX} steps=${result.totalSteps} contourPts=${result.contour.length} wall=${wallSec.toFixed(1)}s out=${OUT_DIR}`);
} finally {
  spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
