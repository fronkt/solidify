/**
 * NIST PFHub Benchmark 1a (2D Periodic Spinodal Decomposition) Reproducible Export Harness
 *
 * Drives SOLIDIFY's conserved 2D Cahn-Hilliard WebGPU solver (`SpinodalSim`,
 * periodic 9-point Mehrstellen Laplacian, centered WGSL f32 storage) on the
 * official NIST PFHub Benchmark 1a specification
 * (https://pages.nist.gov/pfhub/benchmarks/benchmark1.ipynb/;
 *  Jokisaari et al., Comput. Mater. Sci. 126 (2017) 139-151):
 *   - Domain: periodic [0, 200]^2 on a GRID x GRID mesh (default 200 x 200, dx = 1.0)
 *   - Free energy: F = int [ rho_s*(c - c_alpha)^2*(c_beta - c)^2 + 0.5*kappa*|grad c|^2 ] dA
 *   - Parameters: c_alpha = 0.3, c_beta = 0.7, rho_s = 5.0, kappa = 2.0, M = 5.0, c0 = 0.5, eps = 0.01
 *   - Initial condition (Jokisaari et al. 2017 Eq. 5):
 *       c(x,y) = c0 + eps * [ cos(0.105 x)cos(0.11 y)
 *                           + (cos(0.13 x)cos(0.087 y))^2
 *                           + cos(0.025 x - 0.15 y)cos(0.07 x - 0.02 y) ]
 *   - Target time: t = 1000 (sampled every --sample-dt=25 by default)
 *
 * Emits all NIST PFHub Benchmark 1a artifacts into `--out` (default: pfhub/results-b1-200):
 *   - bm1_results.csv  (time,free_energy,chem_energy,grad_energy,domain_L,mean_c,mass_drift)
 *   - free_energy.csv  (time,free_energy)
 *   - meta.yaml        (official NIST PFHub Benchmark 1a submission manifest)
 *   - pfhub_b1.json    (machine-readable provenance, conservation & monotonicity checks, reference metadata)
 *
 * Usage:
 *   node scripts/export-pfhub-b1.mjs [--grid=200] [--tmax=1000] [--sample-dt=25] [--port=5297] [--out=pfhub/results-b1-200]
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

const GRID = Number(argVal("--grid", "200"));
const TMAX = Number(argVal("--tmax", "1000"));
const SAMPLE_DT = Number(argVal("--sample-dt", "25"));
const PORT = Number(argVal("--port", "5297"));
const OUT_DIR = path.resolve(argVal("--out", "pfhub/results-b1-200"));

if (!Number.isInteger(GRID) || GRID < 64 || GRID > 256) {
  throw new Error(`--grid=${GRID} must be an integer in [64, 256]`);
}
if (!Number.isFinite(TMAX) || TMAX <= 0) {
  throw new Error(`--tmax=${TMAX} must be a positive number`);
}
if (!Number.isFinite(SAMPLE_DT) || SAMPLE_DT <= 0) {
  throw new Error(`--sample-dt=${SAMPLE_DT} must be a positive number`);
}

// Reference metadata for NIST PFHub Benchmark 1a (Jokisaari et al. 2017)
const PFHUB_B1_REFERENCE = {
  citation: "A. M. Jokisaari, P. W. Voorhees, J. E. Guyer, J. Warren, and O. G. Heinonen, Benchmark problems for numerical implementations of phase field models, Computational Materials Science 126 (2017) 139–151.",
  doi: "10.1016/j.commatsci.2016.09.022",
  benchmark_url: "https://pages.nist.gov/pfhub/benchmarks/benchmark1.ipynb/",
  parameters: {
    domain: "[0, 200]^2",
    boundary_conditions: "periodic",
    c_alpha: 0.3,
    c_beta: 0.7,
    rho_s: 5.0,
    kappa: 2.0,
    mobility: 5.0,
    c0: 0.5,
    eps: 0.01,
  },
  expected_properties: {
    initial_free_energy_approx: 319.1,
    initial_mean_c_200_approx: 0.50255,
    lyapunov_free_energy: "dF/dt <= 0 strictly monotone decay",
    mass_conservation: "d<c>/dt = 0 (conserved order parameter)",
    lsw_coarsening_exponent: 1 / 3,
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });

const server = spawn(
  "node",
  ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
  { stdio: "ignore" },
);

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
    if (txt.startsWith("[pfhub-b1]")) console.log(txt);
  });

  await page.goto(`http://127.0.0.1:${PORT}/app/#spinodal=pfhub1`, {
    waitUntil: "networkidle0",
    timeout: 30000,
  });
  await page.waitForFunction(
    "!!(window.__solidify && window.__solidify.spinodal && window.__solidify.spinodal.isOpen() && window.__solidify.spinodal.sim())",
    { timeout: 20000 },
  );

  const result = await page.evaluate(async ({ GRID, TMAX, SAMPLE_DT }) => {
    const S = window.__solidify;
    const panel = S.spinodal;
    const sim = panel.sim();
    if (!sim) throw new Error("SpinodalSim was not initialized");

    const gpuErrors = [];
    const onGpuErr = (ev) => {
      gpuErrors.push(ev?.error?.message || String(ev));
    };
    sim.device.addEventListener("uncapturederror", onGpuErr);

    // Pause panel rAF stepping and silence background panel ticks so diagnostics
    // readbacks never race with deterministic benchmark stepping.
    if (panel.running) {
      const runBtn = document.getElementById("spinRun");
      if (runBtn) runBtn.click();
    }
    panel.tick = () => {};
    await sim.device.queue.onSubmittedWorkDone();
    await new Promise(r => setTimeout(r, 120));

    // Probe WebGPU adapter metadata when exposed by the browser
    let gpuInfo = null;
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      if (adapter && adapter.info) {
        gpuInfo = {
          vendor: adapter.info.vendor || "",
          architecture: adapter.info.architecture || "",
          device: adapter.info.device || "",
          description: adapter.info.description || "",
        };
      }
    } catch {
      gpuInfo = null;
    }

    // Reset deterministically to NIST PFHub Benchmark 1a on GRID x GRID
    sim.reset({
      preset: "pfhub1",
      dim: "2d",
      c0: 0.5,
      kappa: 2.0,
      mobility: 5.0,
      n2d: GRID,
    });
    await sim.device.queue.onSubmittedWorkDone();

    const dx = sim.dx;
    const dt = sim.dt;
    const checkpoints = [];
    for (let t = SAMPLE_DT; t < TMAX - 1e-9; t += SAMPLE_DT) {
      checkpoints.push(t);
    }
    checkpoints.push(TMAX);

    const rows = [];
    const pushStats = (st) => {
      rows.push({
        step: st.step,
        time: st.simTime,
        free_energy: st.freeEnergy,
        chem_energy: st.chemEnergy,
        grad_energy: st.gradEnergy,
        domain_L: st.domainL,
        mean_c: st.meanC,
        min_c: st.minC,
        max_c: st.maxC,
        mass_drift: st.massDrift,
        lsw_slope: st.lswSlope,
        valid: st.valid,
      });
    };

    const t0Perf = performance.now();
    const st0 = await sim.readDiagnostics();
    if (!st0.valid) throw new Error("Initial t=0 diagnostics invalid");
    pushStats(st0);
    console.log(
      `[pfhub-b1] t=0.00 F=${st0.freeEnergy.toFixed(4)} chem=${st0.chemEnergy.toFixed(4)} grad=${st0.gradEnergy.toFixed(4)} L=${st0.domainL.toFixed(3)} meanC=${st0.meanC.toFixed(6)}`,
    );

    const BATCH_STEPS = 512;
    let curStep = 0;
    for (let idx = 0; idx < checkpoints.length; idx++) {
      const targetT = checkpoints[idx];
      const targetStep = Math.round(targetT / dt);
      let rem = Math.max(0, targetStep - curStep);
      let submitsSinceDrain = 0;
      while (rem > 0) {
        const take = Math.min(BATCH_STEPS, rem);
        sim.step(take);
        curStep += take;
        rem -= take;
        submitsSinceDrain++;
        if (submitsSinceDrain >= 4) {
          await sim.device.queue.onSubmittedWorkDone();
          submitsSinceDrain = 0;
        }
      }
      await sim.device.queue.onSubmittedWorkDone();
      const st = await sim.readDiagnostics();
      if (!st.valid) throw new Error(`Invalid diagnostics at step=${st.step} t=${st.simTime}`);
      if (st.step !== curStep) {
        throw new Error(`Diagnostics step mismatch: expected ${curStep}, got ${st.step}`);
      }
      pushStats(st);

      const isMilestone = idx === 0 || idx === checkpoints.length - 1 || Math.abs(targetT % 100) < 1e-6;
      if (isMilestone) {
        const el = ((performance.now() - t0Perf) / 1000).toFixed(1);
        const slopeStr = st.lswSlope != null ? st.lswSlope.toFixed(3) : "n/a";
        console.log(
          `[pfhub-b1] t=${st.simTime.toFixed(2)} (${el}s, step=${st.step}) F=${st.freeEnergy.toFixed(4)} L=${st.domainL.toFixed(3)} drift=${st.massDrift.toExponential(2)} lsw=${slopeStr}`,
        );
      }
    }

    const solverSec = (performance.now() - t0Perf) / 1000;
    sim.device.removeEventListener("uncapturederror", onGpuErr);
    if (gpuErrors.length > 0) {
      throw new Error(`WebGPU uncapturederror during benchmark: ${gpuErrors.slice(0, 3).join(" | ")}`);
    }
    return {
      grid: sim.n,
      dx,
      dt,
      totalSteps: curStep,
      solverSec,
      gpuInfo,
      rows,
    };
  }, { GRID, TMAX, SAMPLE_DT });

  await browser.close();
  const wallSec = (performance.now() - tWallStart) / 1000;

  const fmtCell = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    if (n === 0) return "0";
    return n.toPrecision(9);
  };

  const writeCsv = (name, header, rows) => {
    const body = [header, ...rows.map(r => r.map(fmtCell).join(","))].join("\n") + "\n";
    fs.writeFileSync(path.join(OUT_DIR, name), body, "utf8");
  };

  writeCsv(
    "bm1_results.csv",
    "time,free_energy,chem_energy,grad_energy,domain_L,mean_c,mass_drift",
    result.rows.map(r => [
      r.time,
      r.free_energy,
      r.chem_energy,
      r.grad_energy,
      r.domain_L,
      r.mean_c,
      r.mass_drift,
    ]),
  );

  writeCsv(
    "free_energy.csv",
    "time,free_energy",
    result.rows.map(r => [r.time, r.free_energy]),
  );

  // Conservation and Lyapunov free-energy monotonicity verification
  let allValid = true;
  let strictlyMonotoneF = true;
  let monotoneNonincreasingF = true;
  let maxEnergyIncrease = 0;
  let maxAbsMassDrift = 0;
  for (let i = 0; i < result.rows.length; i++) {
    const r = result.rows[i];
    if (!r.valid) allValid = false;
    const ad = Math.abs(r.mass_drift);
    if (ad > maxAbsMassDrift) maxAbsMassDrift = ad;
    if (i > 0) {
      const dF = r.free_energy - result.rows[i - 1].free_energy;
      if (!(r.free_energy < result.rows[i - 1].free_energy)) strictlyMonotoneF = false;
      if (dF > 0) {
        monotoneNonincreasingF = false;
        if (dF > maxEnergyIncrease) maxEnergyIncrease = dF;
      }
    }
  }

  const firstRow = result.rows[0];
  const lastRow = result.rows[result.rows.length - 1];
  const finalSummary = {
    time: lastRow.time,
    step: lastRow.step,
    free_energy: lastRow.free_energy,
    chem_energy: lastRow.chem_energy,
    grad_energy: lastRow.grad_energy,
    domain_L: lastRow.domain_L,
    mean_c: lastRow.mean_c,
    min_c: lastRow.min_c,
    max_c: lastRow.max_c,
    mass_drift: lastRow.mass_drift,
    max_abs_mass_drift: maxAbsMassDrift,
    strictly_monotone_F: strictlyMonotoneF,
    monotone_nonincreasing_F: monotoneNonincreasingF,
    lsw_slope: lastRow.lsw_slope,
  };

  const pfhubB1Json = {
    benchmark: {
      id: "1a",
      version: "1",
      name: "Spinodal Decomposition (2D Periodic Square)",
      url: PFHUB_B1_REFERENCE.benchmark_url,
    },
    reference: PFHUB_B1_REFERENCE,
    metadata: {
      author: {
        first: "Frank",
        last: "Cai",
        email: "cai485@purdue.edu",
        github_id: "fronkt",
        orcid: "0009-0003-0041-1459",
      },
      timestamp: new Date().toISOString(),
      implementation: {
        name: "SOLIDIFY",
        version: "8.5.0",
        repo: { url: "https://github.com/fronkt/solidify", version: "main" },
        discretization: "Periodic 2D 9-point Mehrstellen Laplacian explicit Cahn-Hilliard in centered WGSL f32",
      },
      summary: `Browser-native WebGPU conserved Cahn-Hilliard 2D solver (SOLIDIFY v8.5.0, periodic 9-point Mehrstellen stencil in centered WGSL f32) on ${result.grid}x${result.grid} [0,200]^2 (dx=${result.dx.toFixed(4)}, dt=${result.dt.toExponential(4)}, ${result.totalSteps} explicit steps to t=${lastRow.time.toFixed(2)}).`,
      hardware: {
        cpu_architecture: os.arch(),
        acc_architecture: "WebGPU (GPU compute shader)",
        parallel_model: "WebGPU WGSL compute",
        clock_rate: 0,
        cores: os.cpus().length,
        nodes: 1,
        ...(result.gpuInfo ? { gpu_adapter: result.gpuInfo } : {}),
      },
      simulation: {
        wall_time_s: Number(wallSec.toFixed(2)),
        solver_time_s: Number(result.solverSec.toFixed(2)),
        grid: `${result.grid}x${result.grid}`,
        domain: "[0, 200]^2",
        dx: result.dx,
        dt: result.dt,
        steps: result.totalSteps,
        t_target: TMAX,
        t_final: lastRow.time,
        sample_dt: SAMPLE_DT,
        samples: result.rows.length,
      },
    },
    checks: {
      all_valid: allValid,
      initial_free_energy: firstRow.free_energy,
      final_free_energy: lastRow.free_energy,
      free_energy_ratio: firstRow.free_energy > 0 ? lastRow.free_energy / firstRow.free_energy : null,
      strictly_monotone_F: strictlyMonotoneF,
      monotone_nonincreasing_F: monotoneNonincreasingF,
      max_energy_increase: maxEnergyIncrease,
      initial_mean_c: firstRow.mean_c,
      final_mean_c: lastRow.mean_c,
      final_mass_drift: lastRow.mass_drift,
      max_abs_mass_drift: maxAbsMassDrift,
      initial_domain_L: firstRow.domain_L,
      final_domain_L: lastRow.domain_L,
      lsw_slope: lastRow.lsw_slope,
    },
    final_metrics: finalSummary,
    data: [
      {
        name: "bm1_results",
        url: "bm1_results.csv",
        format: {
          type: "csv",
          parse: {
            time: "number",
            free_energy: "number",
            chem_energy: "number",
            grad_energy: "number",
            domain_L: "number",
            mean_c: "number",
            mass_drift: "number",
          },
        },
      },
      {
        name: "free_energy",
        url: "free_energy.csv",
        format: { type: "csv", parse: { time: "number", free_energy: "number" } },
      },
    ],
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "pfhub_b1.json"),
    JSON.stringify(pfhubB1Json, null, 2) + "\n",
    "utf8",
  );

  const metaYaml = `metadata:
  author:
    first: Frank
    last: Cai
    email: cai485@purdue.edu
    github_id: fronkt
  timestamp: '${new Date().toUTCString()}'
  summary: >-
    Browser-native WebGPU conserved Cahn-Hilliard 2D phase-field solver
    (SOLIDIFY v8.5.0, periodic 9-point Mehrstellen stencil in centered WGSL
    float32) on ${result.grid}x${result.grid} [0,200]^2 (dx = ${result.dx.toFixed(4)},
    dt = ${result.dt.toFixed(6)}, ${result.totalSteps} explicit steps to
    t = ${lastRow.time.toFixed(2)}, Jokisaari et al., Comput. Mater. Sci. 126
    (2017) 139-151).
  implementation:
    name: solidify
    repo:
      url: 'https://github.com/fronkt/solidify'
      version: v8.5.0
    container_url: 'https://solidify.frankcai.dev/'
  hardware:
    cpu_architecture: ${os.arch()}
    acc_architecture: WebGPU
    parallel_model: gpu
    clock_rate: '0'
    cores: '${os.cpus().length}'
    nodes: '1'
benchmark:
  id: 1a
  version: '1'
data:
  - name: run_time
    values:
      - wall_time: '${wallSec.toFixed(2)}'
        sim_time: '${lastRow.time.toFixed(2)}'
  - name: free_energy
    url: 'free_energy.csv'
    format:
      type: csv
      parse:
        time: number
        free_energy: number
    description: Total Cahn-Hilliard free energy as a function of time
    type: line
    transform:
      - type: formula
        expr: datum.time
        as: x
      - type: formula
        expr: datum.free_energy
        as: 'y'
  - name: domain_length
    url: 'bm1_results.csv'
    format:
      type: csv
      parse:
        time: number
        domain_L: number
    description: Characteristic interfacial domain length L(t) as a function of time
    type: line
    transform:
      - type: formula
        expr: datum.time
        as: x
      - type: formula
        expr: datum.domain_L
        as: 'y'
`;

  fs.writeFileSync(path.join(OUT_DIR, "meta.yaml"), metaYaml, "utf8");

  console.log(
    `PFHUB_B1_DONE grid=${result.grid} dx=${result.dx.toFixed(4)} dt=${result.dt.toFixed(6)} tmax=${lastRow.time.toFixed(2)} steps=${result.totalSteps} F0=${firstRow.free_energy.toFixed(3)} Fend=${lastRow.free_energy.toFixed(3)} monotone=${strictlyMonotoneF} maxDrift=${maxAbsMassDrift.toExponential(2)} lsw=${lastRow.lsw_slope != null ? lastRow.lsw_slope.toFixed(3) : "null"} wall=${wallSec.toFixed(1)}s out=${OUT_DIR}`,
  );
  console.log("FINAL_SUMMARY:", JSON.stringify(finalSummary));
} finally {
  spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
