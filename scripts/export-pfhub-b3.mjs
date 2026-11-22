/**
 * NIST PFHub Benchmark 3 (Dendritic Growth) Reproducible Export Harness
 *
 * Drives SOLIDIFY's quantitative Karma-Rappel 2D WebGPU solver (`solver: 1`)
 * on the official NIST PFHub Benchmark 3 specification
 * (https://pages.nist.gov/pfhub/benchmarks/benchmark3.ipynb/):
 *   - Benchmark domain: 960 x 960 quarter-symmetry domain [0, 960]^2
 *   - Solved on the full 4-fold symmetric domain [-960, +960]^2 centered at
 *     (n/2, n/2) so x = 0 and y = 0 are exact analytic mirror planes (even for
 *     phi and U, odd for anisotropic cross fluxes W W' grad(phi)) with zero
 *     clamped-corner bias, then extracted on the upper-right quadrant [0, 960]^2.
 *   - Parameters: W_0 = 1, tau_0 = 1, D = 10, lambda = D / 0.6267 = 15.956598,
 *                 m = 4, epsilon_4 = 0.05, theta_0 = 0, Delta = -0.3, R_0 = 8 at (0, 0)
 *   - Target time: t = 1500 (sampled at exact checkpoints including multiples of 150)
 *
 * Computes the EXACT NIST Benchmark 3 free energy functional from the 2D (phi, U) field:
 *   F = int_{[0,960]^2} [ 0.5 * W(n)^2 * |grad phi|^2 - 0.5*phi^2 + 0.25*phi^4
 *                         + lambda * U * phi * (1 - (2/3)*phi^2 + (1/5)*phi^4) ] dV
 * and extracts the ordered zero level set (phi = 0, i.e. psi = 0.5) at t = tmax
 * using marching squares on [0, 960]^2.
 *
 * Emits all NIST PFHub & Zenodo artifacts into `--out` (default: pfhub/out):
 *   - bm3_results.csv        (time,free_energy,tip_position,solid_fraction)
 *   - solid_fraction.csv     (time,solid_fraction)
 *   - free_energy.csv        (time,free_energy)
 *   - tip_position.csv       (time,tip_position)
 *   - phase_field_1500.csv   (x,y ordered phi=0 contour at t=tmax)
 *   - meta.yaml              (official NIST PFHub submission manifest)
 *   - pfhub.json             (machine-readable provenance + published-code comparison)
 *
 * Usage:
 *   node scripts/export-pfhub-b3.mjs [--grid=2048] [--tmax=1500] [--sample-dt=50] [--port=5215] [--out=pfhub/out]
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
const GRID = Number(argVal("--grid", "2048")); // full symmetric [-960, +960]^2; quadrant is GRID/2 x GRID/2
const TMAX = Number(argVal("--tmax", "1500"));
const SAMPLE_DT = Number(argVal("--sample-dt", "50"));
const PORT = Number(argVal("--port", "5215"));
const OUT_DIR = path.resolve(argVal("--out", "pfhub/out"));
const L_QUAD = 960.0;
const L_FULL = 2.0 * L_QUAD;
const R0 = 8.0;
const D_DIFF = 10.0;
const A2 = 0.6267;
const LAMBDA = D_DIFF / A2; // 15.956598053295038
const DELTA = 0.3;          // U(t=0) = -0.3 => SOLIDIFY T = 1 - 0.3 = 0.7
const EPS4 = 0.05;

// Published NIST PFHub Benchmark 3a reference values at t = 1500:
//   - moose_itg_3a (Penn State MOOSE):   F = 1,988,325.6, tip = 264.00, fs = 0.016984
//   - inl_moose_3a (INL MOOSE):          F = 1,976,211.7, tip = 280.94, fs = 0.018780
//   - PRISMS_PF_3a_cubic (UMich PRISMS): F = 1,972,025.3, tip = 294.14, fs = 0.019309
//   - memphis_3a (Sandia Memphis):       tip = 216.84
const PFHUB_REF_1500 = {
  moose_itg_3a:      { F: 1988325.561, tip: 264.000, fs: 0.0169843 },
  inl_moose_3a:      { F: 1976211.723, tip: 280.945, fs: 0.0187804 },
  PRISMS_PF_3a_cubic:{ F: 1972025.307, tip: 294.143, fs: 0.0193087 },
  memphis_3a:        { tip: 216.84 },
};

if (GRID % 32 !== 0) {
  throw new Error(`--grid=${GRID} must be a multiple of 32 (so GRID and GRID/2 are WebGPU-aligned)`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const server = spawn("node", ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
  stdio: "ignore",
});

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/app/`);
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
    protocolTimeout: 3_600_000,
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-gpu"],
  });
  const page = await browser.newPage();
  page.on("console", m => {
    const txt = m.text();
    if (txt.startsWith("[pfhub]")) console.log(txt);
  });
  await page.goto(`http://127.0.0.1:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction("!!window.__solidify", { timeout: 20000 });

  const result = await page.evaluate(async ({ GRID, TMAX, SAMPLE_DT, L_FULL, R0, D_DIFF, LAMBDA, DELTA, EPS4 }) => {
    const S = window.__solidify;
    S.app.setRun(false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (S.sim().n !== GRID) S.app.setGrid(GRID);
    const sim = S.sim();
    const half = GRID / 2;
    const dx = L_FULL / GRID; // = 960 / (GRID/2)
    // 9-point Laplacian stability edge is 0.3 * dx^2 / D; 0.145 gives >2x margin.
    const dtTarget = (0.145 * dx * dx) / Math.max(1, D_DIFF);
    const stepsPerSample = Math.max(1, Math.ceil(SAMPLE_DT / dtTarget));
    const dt = SAMPLE_DT / stepsPerSample;
    const nSamples = Math.round(TMAX / SAMPLE_DT);
    const totalSteps = nSamples * stepsPerSample;

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
    // Full 4-fold symmetric domain [-960, +960]^2 centered at vertex (half, half)
    // Cell (half + i, half + j) sits at ((i + 0.5)*dx, (j + 0.5)*dx) inside [0, 960]^2.
    sim.reset(1.0 - DELTA);
    sim.addSeed(half, half, R0 / dx, 0, -9);
    await sim.stepSync(0);

    const ts = [];
    const fsArr = [];
    const feArr = [];
    const tipArr = [];

    // Read rows [half - 1 .. GRID - 1] (height = half + 1) so row j=0 inside the quadrant
    // has its exact physical mirror neighbor at row index 0 (global row half - 1).
    const measureQuadrant = async (tNow) => {
      const band = await sim.readRows(half - 1, half + 1);
      if (!band) throw new Error("readRows returned null");
      const inv2dx = 0.5 / dx;
      const cellArea = dx * dx;
      let psiSum = 0.0;
      let fTotal = 0.0;

      // Exact y = 0 symmetry line lies halfway between global rows (half - 1) and (half),
      // which are local band rows 0 and 1. Average them for exact y = 0 tip crossing.
      let tip = -1;
      for (let i = 0; i < half - 1; i++) {
        const gx = half + i;
        const a = 0.5 * (band[gx * 4] + band[(GRID + gx) * 4]);
        const b = 0.5 * (band[(gx + 1) * 4] + band[(GRID + gx + 1) * 4]);
        if (a >= 0.5 && b < 0.5) {
          tip = (i + 0.5 + (a - 0.5) / (a - b)) * dx;
          break;
        }
      }

      // Integrate solid fraction and exact NIST Benchmark 3 free energy F over quadrant [0, 960]^2
      for (let qj = 0; qj < half; qj++) {
        const bj = qj + 1; // local band row (global row half + qj)
        const bjN = bj + 1 <= half ? bj + 1 : bj;
        const bjS = bj - 1; // exact mirror row at qj = 0!
        const rowOff = bj * GRID;
        const rowN = bjN * GRID;
        const rowS = bjS * GRID;
        for (let qi = 0; qi < half; qi++) {
          const gi = half + qi;
          const idx = (rowOff + gi) * 4;
          const psi = band[idx];
          const U = band[idx + 1] - 1.0;
          psiSum += psi;

          const phi = 2.0 * psi - 1.0;
          const phi2 = phi * phi;
          const phi4 = phi2 * phi2;
          const fChem = -0.5 * phi2 + 0.25 * phi4
            + LAMBDA * U * phi * (1.0 - (2.0 / 3.0) * phi2 + 0.2 * phi4);

          const giE = gi + 1 < GRID ? gi + 1 : gi;
          const giW = gi - 1; // exact mirror col at qi = 0!
          const dphidx = 2.0 * (band[(rowOff + giE) * 4] - band[(rowOff + giW) * 4]) * inv2dx;
          const dphidy = 2.0 * (band[(rowN + gi) * 4] - band[(rowS + gi) * 4]) * inv2dx;
          const g2 = dphidx * dphidx + dphidy * dphidy;
          let fGrad = 0.0;
          if (g2 > 1e-18) {
            const nx2 = (dphidx * dphidx) / g2;
            const ny2 = (dphidy * dphidy) / g2;
            const cos4 = 1.0 - 8.0 * nx2 * ny2;
            const W = 1.0 + EPS4 * cos4;
            fGrad = 0.5 * W * W * g2;
          }
          fTotal += (fGrad + fChem) * cellArea;
        }
      }

      const fs = psiSum / (half * half);
      ts.push(tNow);
      fsArr.push(fs);
      feArr.push(fTotal);
      tipArr.push(tip);
      return { band, fs, fTotal, tip };
    };

    const t0Perf = performance.now();
    let lastMeasure = await measureQuadrant(0);
    console.log(`[pfhub] t=0 F=${lastMeasure.fTotal.toFixed(1)} tip=${lastMeasure.tip.toFixed(3)} fs=${lastMeasure.fs.toExponential(4)}`);

    // Step in safe GPU chunks (stepCap at 2048 is 38, stepSync drains cleanly inside loop)
    for (let s = 1; s <= nSamples; s++) {
      let rem = stepsPerSample;
      while (rem > 0) {
        const take = Math.min(36, rem);
        await sim.stepSync(take);
        rem -= take;
      }
      const tNow = s * SAMPLE_DT;
      lastMeasure = await measureQuadrant(tNow);
      if (s === 1 || Math.abs(tNow % 150) < 1e-6 || s === nSamples) {
        const el = ((performance.now() - t0Perf) / 1000).toFixed(1);
        console.log(`[pfhub] t=${tNow} (${el}s) F=${lastMeasure.fTotal.toFixed(1)} tip=${lastMeasure.tip.toFixed(3)} fs=${lastMeasure.fs.toFixed(6)}`);
      }
    }

    // Marching squares on the final quadrant [0, 960]^2 (level psi = 0.5 => phi = 0)
    const band = lastMeasure.band;
    const psiAt = (qi, qj) => band[((qj + 1) * GRID + (half + qi)) * 4];
    const segs = [];
    const interp = (a, b) => (0.5 - a) / (b - a);
    for (let j = 0; j < half - 1; j++) {
      for (let i = 0; i < half - 1; i++) {
        const v00 = psiAt(i, j);
        const v10 = psiAt(i + 1, j);
        const v11 = psiAt(i + 1, j + 1);
        const v01 = psiAt(i, j + 1);
        const mask = (v00 >= 0.5 ? 1 : 0) | (v10 >= 0.5 ? 2 : 0) | (v11 >= 0.5 ? 4 : 0) | (v01 >= 0.5 ? 8 : 0);
        if (mask === 0 || mask === 15) continue;
        const pB = [(i + 0.5 + interp(v00, v10)) * dx, (j + 0.5) * dx];
        const pR = [(i + 1.5) * dx, (j + 0.5 + interp(v10, v11)) * dx];
        const pT = [(i + 0.5 + interp(v01, v11)) * dx, (j + 1.5) * dx];
        const pL = [(i + 0.5) * dx, (j + 0.5 + interp(v00, v01)) * dx];
        const kB = `B:${i},${j}`, kR = `R:${i},${j}`, kT = `B:${i},${j + 1}`, kL = `R:${i - 1},${j}`;
        const add = (a, ka, b, kb) => segs.push([a, ka, b, kb]);
        switch (mask) {
          case 1: case 14: add(pL, kL, pB, kB); break;
          case 2: case 13: add(pB, kB, pR, kR); break;
          case 3: case 12: add(pL, kL, pR, kR); break;
          case 4: case 11: add(pR, kR, pT, kT); break;
          case 6: case 9:  add(pB, kB, pT, kT); break;
          case 7: case 8:  add(pL, kL, pT, kT); break;
          case 5: {
            const c = 0.25 * (v00 + v10 + v11 + v01);
            if (c >= 0.5) { add(pL, kL, pT, kT); add(pB, kB, pR, kR); }
            else { add(pL, kL, pB, kB); add(pR, kR, pT, kT); }
            break;
          }
          case 10: {
            const c = 0.25 * (v00 + v10 + v11 + v01);
            if (c >= 0.5) { add(pL, kL, pB, kB); add(pR, kR, pT, kT); }
            else { add(pL, kL, pT, kT); add(pB, kB, pR, kR); }
            break;
          }
        }
      }
    }

    const adj = new Map();
    const pts = new Map();
    for (const [pa, ka, pb, kb] of segs) {
      pts.set(ka, pa);
      pts.set(kb, pb);
      if (!adj.has(ka)) adj.set(ka, []);
      if (!adj.has(kb)) adj.set(kb, []);
      adj.get(ka).push(kb);
      adj.get(kb).push(ka);
    }
    const endpoints = [...adj.entries()].filter(([, nb]) => nb.length === 1).map(([k]) => k);
    let contour = [];
    if (endpoints.length > 0) {
      endpoints.sort((a, b) => pts.get(a)[0] - pts.get(b)[0]);
      const visited = new Set();
      let cur = endpoints[0];
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        contour.push(pts.get(cur));
        const next = (adj.get(cur) || []).find(n => !visited.has(n));
        cur = next || null;
      }
      if (contour.length > 0) {
        const yTip = contour[0][1];
        const xTip = lastMeasure.tip > 0 ? lastMeasure.tip : contour[contour.length - 1][0];
        contour = [[0.0, yTip], ...contour, [xTip, 0.0]];
      }
    }

    return { dt, dx, half, stepsPerSample, totalSteps, ts, fsArr, feArr, tipArr, contour };
  }, { GRID, TMAX, SAMPLE_DT, L_FULL, R0, D_DIFF, LAMBDA, DELTA, EPS4 });

  await browser.close();
  const wallSec = (performance.now() - tWallStart) / 1000;

  const writeCsv = (name, header, rows) => {
    const body = [header, ...rows.map(r => r.map(v => Number(v).toPrecision(9)).join(","))].join("\n") + "\n";
    fs.writeFileSync(path.join(OUT_DIR, name), body, "utf8");
  };

  writeCsv(
    "bm3_results.csv",
    "time,free_energy,tip_position,solid_fraction",
    result.ts.map((t, i) => [t, result.feArr[i], result.tipArr[i], result.fsArr[i]])
  );
  writeCsv("solid_fraction.csv", "time,solid_fraction", result.ts.map((t, i) => [t, result.fsArr[i]]));
  writeCsv("free_energy.csv", "time,free_energy", result.ts.map((t, i) => [t, result.feArr[i]]));
  writeCsv("tip_position.csv", "time,tip_position", result.ts.map((t, i) => [t, result.tipArr[i]]));
  writeCsv("phase_field_1500.csv", "x,y", result.contour);

  const lastIdx = result.ts.length - 1;
  const finalSummary = {
    time: result.ts[lastIdx],
    free_energy: result.feArr[lastIdx],
    tip_position: result.tipArr[lastIdx],
    solid_fraction: result.fsArr[lastIdx],
    contour_points: result.contour.length,
    vs_published_1500: Math.abs(TMAX - 1500) < 1e-6 ? Object.fromEntries(
      Object.entries(PFHUB_REF_1500).map(([k, r]) => [k, {
        tip_diff_pct: Number(((result.tipArr[lastIdx] - r.tip) / r.tip * 100).toFixed(2)),
        ...(r.F ? { F_diff_pct: Number(((result.feArr[lastIdx] - r.F) / r.F * 100).toFixed(3)) } : {}),
        ...(r.fs ? { fs_diff_pct: Number(((result.fsArr[lastIdx] - r.fs) / r.fs * 100).toFixed(2)) } : {}),
      }])
    ) : undefined,
  };

  const pfhubMeta = {
    benchmark: { id: "3a", version: "1" },
    metadata: {
      author: { first: "Frank", last: "Cai", email: "cai485@purdue.edu", github_id: "fronkt", orcid: "0009-0003-0041-1459" },
      timestamp: new Date().toISOString(),
      implementation: {
        name: "SOLIDIFY",
        version: "8.0.0",
        repo: { url: "https://github.com/fronkt/solidify", version: "main" },
      },
      summary: `Browser-native WebGPU Karma-Rappel 2D thin-interface solver (9-point explicit stencil, WGSL f32) solved on a full 4-fold symmetric ${GRID}x${GRID} domain [-960,+960]^2 (${result.half}x${result.half} quadrant [0,960]^2, dx=${result.dx.toFixed(4)}, dt=${result.dt.toExponential(4)}, ${result.totalSteps} steps to t=${TMAX}).`,
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
        full_grid: `${GRID}x${GRID}`,
        quadrant_grid: `${result.half}x${result.half}`,
        dx: result.dx,
        dt: result.dt,
        steps: result.totalSteps,
        t_final: TMAX,
        contour_points: result.contour.length,
      },
    },
    final_metrics: finalSummary,
    data: [
      { name: "free_energy", url: "free_energy.csv", format: { type: "csv", parse: { time: "number", free_energy: "number" } } },
      { name: "tip_position", url: "tip_position.csv", format: { type: "csv", parse: { time: "number", tip_position: "number" } } },
      { name: "solid_fraction", url: "solid_fraction.csv", format: { type: "csv", parse: { time: "number", solid_fraction: "number" } } },
      { name: "phase_field_1500", url: "phase_field_1500.csv", format: { type: "csv", parse: { x: "number", y: "number" } } },
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, "pfhub.json"), JSON.stringify(pfhubMeta, null, 2) + "\n", "utf8");

  const metaYaml = `metadata:
  author:
    first: Frank
    last: Cai
    email: cai485@purdue.edu
    github_id: fronkt
  timestamp: '${new Date().toUTCString()}'
  summary: >-
    Browser-native WebGPU Karma-Rappel 2D thin-interface phase-field solver
    (SOLIDIFY v8.0.0, 9-point explicit stencil in WGSL float32) on a full 4-fold
    symmetric ${GRID}x${GRID} domain [-960,+960]^2 (${result.half}x${result.half}
    benchmark quadrant [0,960]^2, dx = ${result.dx.toFixed(4)},
    dt = ${result.dt.toFixed(6)}, ${result.totalSteps} explicit steps to t = ${TMAX}).
  implementation:
    name: solidify
    repo:
      url: 'https://github.com/fronkt/solidify'
      version: v8.0.0
    container_url: 'https://solidify.frankcai.dev/'
  hardware:
    cpu_architecture: ${os.arch()}
    acc_architecture: WebGPU
    parallel_model: gpu
    clock_rate: '0'
    cores: '${os.cpus().length}'
    nodes: '1'
benchmark:
  id: 3a
  version: '1'
data:
  - name: run_time
    values:
      - wall_time: '${wallSec.toFixed(2)}'
        sim_time: '${TMAX}'
  - name: free_energy
    url: 'bm3_results.csv'
    format:
      type: csv
      parse:
        time: number
        free_energy: number
    description: Free energy as a function of time
    type: line
    transform:
      - type: formula
        expr: datum.time
        as: x
      - type: formula
        expr: datum.free_energy
        as: 'y'
  - name: tip_position
    url: 'bm3_results.csv'
    format:
      type: csv
      parse:
        time: number
        tip_position: number
    description: Tip position as a function of time
    type: line
    transform:
      - type: formula
        expr: datum.time
        as: x
      - type: formula
        expr: datum.tip_position
        as: 'y'
  - name: solid_fraction
    url: 'bm3_results.csv'
    format:
      type: csv
      parse:
        time: number
        solid_fraction: number
    description: Solid area fraction as a function of time
    type: line
    transform:
      - type: formula
        expr: datum.time
        as: x
      - type: formula
        expr: datum.solid_fraction
        as: 'y'
  - name: phase_field_1500
    url: 'phase_field_1500.csv'
    format:
      type: csv
      parse:
        x: number
        'y': number
    description: Zero level set of the order parameter at t=${TMAX}.
    type: line
    transform:
      - type: formula
        expr: datum.x
        as: x
      - type: formula
        expr: datum.y
        as: 'y'
`;
  fs.writeFileSync(path.join(OUT_DIR, "meta.yaml"), metaYaml, "utf8");

  console.log(`PFHUB_B3_DONE fullGrid=${GRID} quadGrid=${result.half} dx=${result.dx.toFixed(4)} dt=${result.dt.toFixed(6)} tmax=${TMAX} steps=${result.totalSteps} contourPts=${result.contour.length} wall=${wallSec.toFixed(1)}s out=${OUT_DIR}`);
  console.log("FINAL_SUMMARY:", JSON.stringify(finalSummary));
} finally {
  spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
