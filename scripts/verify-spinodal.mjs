/**
 * verify-spinodal.mjs — browser-free CI verification for SOLIDIFY v8.5
 * 2D/3D Cahn-Hilliard Spinodal Decomposition & NIST PFHub Benchmark 1.
 *
 * Seven checks:
 *   SPIN-DOUBLE-WELL       exact PFHub B1 double-well zeros, barrier, spinodal inflection & finite-diff derivatives
 *   SPIN-DISPERSION        exact Cahn-Hilliard amplification omega(k), fastest mode kMax, cutoff kCut & stability outside
 *   SPIN-STABILITY         biharmonic explicit CFL check, 9-pt/19-pt isotropic gain, safe auto-dt across presets
 *   SPIN-PFHUB-B1-IC       deterministic PFHub B1a (2D) & B1c (3D) cosine ICs, z=0 match, meanC/F(0) & NaN guard
 *   SPIN-MASS-CONSERVATION conserved periodic 2D cpuCahnHilliardStep2D mass drift < 1e-6 (critical & off-critical)
 *   SPIN-LYAPUNOV-DECAY    strict monotone Lyapunov free-energy decay F(t_{k+1}) < F(t_k) with real phase separation
 *   SPIN-LSW-FIT-DOCS      fitLswSlope exact 1/3 recovery, spinodalFigure/CSV/route & cited docs/caveats hygiene
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`${name}: OK`);
  } catch (e) {
    failed++;
    console.error(`${name}: FAIL`, e?.stack || e?.message || e);
  }
}

const rel = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? Math.abs(a - b) / Math.abs(b) : Infinity);

try {
  const SP = await server.ssrLoadModule("/src/spinodal.ts");
  const SPL = await server.ssrLoadModule("/src/plot/spinodal.ts");
  const PL = await server.ssrLoadModule("/src/plot/layout.ts");
  const PC = await server.ssrLoadModule("/src/plot/csv.ts");
  const RE = await server.ssrLoadModule("/src/run-export.ts");
  const SH = await server.ssrLoadModule("/src/share.ts");

  // ------------------------------------------------------- SPIN-DOUBLE-WELL
  await check("SPIN-DOUBLE-WELL", () => {
    const cA = 0.3, cB = 0.7, rho = 5.0;
    // Equilibrium wells at cAlpha and cBeta
    assert(Math.abs(SP.doubleWellEnergy(cA, cA, cB, rho)) < 1e-15);
    assert(Math.abs(SP.doubleWellEnergy(cB, cA, cB, rho)) < 1e-15);
    assert(Math.abs(SP.doubleWellDeriv(cA, cA, cB, rho)) < 1e-15);
    assert(Math.abs(SP.doubleWellDeriv(cB, cA, cB, rho)) < 1e-15);
    assert(Math.abs(SP.doubleWellDeriv(0.5, cA, cB, rho)) < 1e-15);

    // Exact barrier height and curvature at c = 0.5
    assert(rel(SP.doubleWellEnergy(0.5, cA, cB, rho), 5 * 0.04 * 0.04) < 1e-12);
    assert(rel(SP.doubleWellSecondDeriv(0.5, cA, cB, rho), -0.16 * rho) < 1e-12);
    assert(rel(SP.doubleWellSecondDeriv(cA, cA, cB, rho), 0.32 * rho) < 1e-12);
    assert(rel(SP.doubleWellSecondDeriv(cB, cA, cB, rho), 0.32 * rho) < 1e-12);

    // Sign check for uphill/downhill driving force
    assert(SP.doubleWellDeriv(0.4, cA, cB, rho) > 0, "f'(0.4) must be positive");
    assert(SP.doubleWellDeriv(0.6, cA, cB, rho) < 0, "f'(0.6) must be negative");
    assert(SP.doubleWellDeriv(0.2, cA, cB, rho) < 0, "f'(0.2) must be negative");
    assert(SP.doubleWellDeriv(0.8, cA, cB, rho) > 0, "f'(0.8) must be positive");

    // Exact spinodal inflection points c_s = 0.5 +/- 0.2 / sqrt(3)
    const halfSpin = 0.2 / Math.sqrt(3);
    assert(Math.abs(SP.doubleWellSecondDeriv(0.5 - halfSpin, cA, cB, rho)) < 1e-13);
    assert(Math.abs(SP.doubleWellSecondDeriv(0.5 + halfSpin, cA, cB, rho)) < 1e-13);
    assert(SP.doubleWellSecondDeriv(0.5 - halfSpin + 0.01, cA, cB, rho) < 0);
    assert(SP.doubleWellSecondDeriv(0.5 - halfSpin - 0.01, cA, cB, rho) > 0);

    // Central finite-difference verification of f'(c) and f''(c)
    const h = 1e-6;
    for (const c of [0.15, 0.3, 0.42, 0.5, 0.63, 0.7, 0.85]) {
      const fd1 = (SP.doubleWellEnergy(c + h, cA, cB, rho) - SP.doubleWellEnergy(c - h, cA, cB, rho)) / (2 * h);
      const fd2 = (SP.doubleWellDeriv(c + h, cA, cB, rho) - SP.doubleWellDeriv(c - h, cA, cB, rho)) / (2 * h);
      assert(Math.abs(SP.doubleWellDeriv(c, cA, cB, rho) - fd1) < 1e-7, `f' mismatch at c=${c}`);
      assert(Math.abs(SP.doubleWellSecondDeriv(c, cA, cB, rho) - fd2) < 1e-6, `f'' mismatch at c=${c}`);
    }
  });

  // -------------------------------------------------------- SPIN-DISPERSION
  await check("SPIN-DISPERSION", () => {
    const w = SP.spinodalMaxWave(0.5, 0.3, 0.7, 5.0, 2.0, 5.0);
    assert.equal(w.unstable, true);
    assert(rel(w.f2, -0.8) < 1e-12);
    assert(rel(w.kCut, Math.sqrt(0.4)) < 1e-12);
    assert(rel(w.kMax, Math.sqrt(0.2)) < 1e-12);
    assert(rel(w.lambdaMax, (2 * Math.PI) / Math.sqrt(0.2)) < 1e-12);
    assert(rel(w.omegaMax, 0.4) < 1e-12);

    // Amplification curve exact zeros, peak, and high-k damping
    assert.equal(SP.cahnHilliardAmplification(0, 0.5), 0);
    assert(Math.abs(SP.cahnHilliardAmplification(w.kCut, 0.5)) < 1e-14);
    assert(rel(SP.cahnHilliardAmplification(w.kMax, 0.5), w.omegaMax) < 1e-12);
    assert(SP.cahnHilliardAmplification(0.5 * w.kMax, 0.5) > 0);
    assert(SP.cahnHilliardAmplification(0.5 * w.kMax, 0.5) < w.omegaMax);
    assert(SP.cahnHilliardAmplification(1.2 * w.kMax, 0.5) > 0);
    assert(SP.cahnHilliardAmplification(1.2 * w.kMax, 0.5) < w.omegaMax);
    assert(SP.cahnHilliardAmplification(1.5 * w.kCut, 0.5) < 0, "short waves above kCut must decay");

    // Outside the spinodal (f'' > 0): stable at all wavenumbers
    const stableOut = SP.spinodalMaxWave(0.32, 0.3, 0.7, 5.0, 2.0, 5.0);
    assert.equal(stableOut.unstable, false);
    assert(stableOut.f2 > 0);
    for (const k of [0.1, 0.4, 1.0]) {
      assert(SP.cahnHilliardAmplification(k, 0.32) < 0, `expected damping outside spinodal at k=${k}`);
    }
  });

  // --------------------------------------------------------- SPIN-STABILITY
  await check("SPIN-STABILITY", () => {
    const st2d = SP.spinodalStability(1.0, 0.00336, 2.0, 5.0, "2d", 1.6, true);
    assert.equal(st2d.stable, true);
    assert(rel(st2d.lambdaMax, 16 / 3) < 1e-12);
    assert(st2d.cfl < 1 && rel(st2d.dtSafe, 0.55 * st2d.dtMax) < 1e-12);

    // Isotropic stencils yield exact 2.25x (2D 9-pt vs 5-pt) and 5.0625x (3D 19-pt vs 7-pt) pure-biharmonic CFL gain
    const iso2 = SP.spinodalStability(1.0, 1e-4, 2.0, 5.0, "2d", 0, true);
    const std2 = SP.spinodalStability(1.0, 1e-4, 2.0, 5.0, "2d", 0, false);
    assert(rel(iso2.dtMax / std2.dtMax, 2.25) < 1e-12, `expected 2.25x 2D Mehrstellen gain, got ${iso2.dtMax / std2.dtMax}`);

    const iso3 = SP.spinodalStability(1.5625, 1e-4, 2.0, 5.0, "3d", 0, true);
    const std3 = SP.spinodalStability(1.5625, 1e-4, 2.0, 5.0, "3d", 0, false);
    assert(rel(iso3.dtMax / std3.dtMax, 5.0625) < 1e-12, `expected 5.0625x 3D 19-pt gain, got ${iso3.dtMax / std3.dtMax}`);

    // Unstable dt and invalid inputs
    const bad = SP.spinodalStability(1.0, st2d.dtMax * 1.1, 2.0, 5.0, "2d", 1.6, true);
    assert.equal(bad.stable, false);
    assert(bad.cfl > 1);
    assert.equal(SP.spinodalStability(0, 0.001, 2, 5).stable, false);
    assert.equal(SP.spinodalStability(1, -0.001, 2, 5).stable, false);
    assert.equal(SP.spinodalStability(1, 0.001, 0, 5).stable, false);

    // Auto dt selection is strictly stable for all 4 presets in both 2D and 3D
    const ids = Object.keys(SP.SPINODAL_PRESETS).sort();
    assert.deepEqual(ids, ["alzn", "fecr", "offcrit", "pfhub1"]);
    for (const preset of Object.values(SP.SPINODAL_PRESETS)) {
      const f2Well = SP.doubleWellSecondDeriv(preset.cAlpha, preset.cAlpha, preset.cBeta, preset.rhoS);
      for (const [dim, n, dom] of [["2d", 200, preset.domain2d], ["3d", 64, preset.domain3d]]) {
        const dx = dom / n;
        const dt = SP.chooseSpinodalDt(dx, preset.kappa, preset.mobility, dim, preset);
        const res = SP.spinodalStability(dx, dt, preset.kappa, preset.mobility, dim, f2Well, true);
        assert.equal(res.stable, true, `${preset.id} ${dim} chooseSpinodalDt must be stable`);
        assert(res.cfl <= 0.6, `${preset.id} ${dim} cfl=${res.cfl} should have safety headroom`);
      }
    }
  });

  // ------------------------------------------------------- SPIN-PFHUB-B1-IC
  await check("SPIN-PFHUB-B1-IC", () => {
    // 2D PFHub Benchmark 1a exact Eq. (5) IC
    const ic2a = SP.pfhubB1Init2D(200, 200, 200, 0.5, 0.01);
    const ic2b = SP.pfhubB1Init2D(200, 200, 200, 0.5, 0.01);
    assert.equal(ic2a.length, 40000);
    for (let i = 0; i < ic2a.length; i++) {
      assert.equal(ic2a[i], ic2b[i], "PFHub B1a IC must be byte-deterministic");
    }
    assert(Math.abs(ic2a[0] - 0.53) < 1e-6, `c(0,0) expected 0.53, got ${ic2a[0]}`);
    // Spot-check Eq. (5) at (x=37, y=83)
    const x = 37, y = 83;
    const eq5 =
      0.5 +
      0.01 *
        (Math.cos(0.105 * x) * Math.cos(0.11 * y) +
          Math.pow(Math.cos(0.13 * x) * Math.cos(0.087 * y), 2) +
          Math.cos(0.025 * x - 0.15 * y) * Math.cos(0.07 * x - 0.02 * y));
    assert(Math.abs(ic2a[y * 200 + x] - eq5) < 1e-6);

    const m2 = SP.measureSpinodal2D(ic2a, 200, 200, 1.0, 2.0, 0.3, 0.7, 5.0);
    assert.equal(m2.valid, true);
    assert(Math.abs(m2.meanC - 0.50255) < 5e-4, `PFHub B1a meanC=${m2.meanC}, expected ~0.50255`);
    assert(Math.abs(m2.F - 319.09) < 0.5, `PFHub B1a F(0)=${m2.F}, expected ~319.09`);
    assert(m2.chemF > 0 && m2.gradF > 0 && Math.abs(m2.F - (m2.chemF + m2.gradF)) < 1e-9);

    // 3D PFHub B1c-style IC reduces identically to 2D on z = 0 plane
    const ic3 = SP.pfhubB1Init3D(32, 32, 32, 100, 0.5, 0.01);
    const ic2Slice = SP.pfhubB1Init2D(32, 32, 100, 0.5, 0.01);
    assert.equal(ic3.length, 32 * 32 * 32);
    for (let i = 0; i < 32 * 32; i++) {
      assert(Math.abs(ic3[i] - ic2Slice[i]) < 1e-6, `3D z=0 plane mismatch at ${i}`);
    }
    const m3 = SP.measureSpinodal3D(ic3, 32, 32, 32, 100 / 32, 2.0, 0.3, 0.7, 5.0);
    assert.equal(m3.valid, true);
    assert(m3.F > 0 && m3.L > 0 && Math.abs(m3.F - (m3.chemF + m3.gradF)) < 1e-9);

    // NaN corruption guards
    const bad2 = new Float32Array(ic2Slice);
    bad2[17] = Number.NaN;
    assert.equal(SP.measureSpinodal2D(bad2, 32, 32, 1).valid, false);
    const bad3 = new Float32Array(ic3);
    bad3[100] = Number.NaN;
    assert.equal(SP.measureSpinodal3D(bad3, 32, 32, 32, 100 / 32).valid, false);

    // Seeded noise init preserves exact mean c0
    const noise = SP.buildSeededNoiseInit(4096, 0.42, 0.025, 1337);
    let s = 0;
    for (let i = 0; i < noise.length; i++) s += noise[i];
    assert(Math.abs(s / noise.length - 0.42) < 1e-6, "seeded noise mean must match c0");
  });

  // ------------------------------------------------ SPIN-MASS-CONSERVATION
  await check("SPIN-MASS-CONSERVATION", () => {
    const nx = 48, ny = 48;
    const cfg = { dx: 1.0, dt: 0.0033, kappa: 2.0, mobility: 5.0, cAlpha: 0.3, cBeta: 0.7, rhoS: 5.0 };

    // Critical PFHub B1 evolution (200 steps)
    let c = SP.pfhubB1Init2D(nx, ny, nx, 0.5, 0.04);
    const c0Copy = new Float32Array(c);
    const m0 = SP.measureSpinodal2D(c, nx, ny, cfg.dx, cfg.kappa, cfg.cAlpha, cfg.cBeta, cfg.rhoS);
    for (let step = 0; step < 200; step++) {
      c = SP.cpuCahnHilliardStep2D(c, nx, ny, cfg);
    }
    const m1 = SP.measureSpinodal2D(c, nx, ny, cfg.dx, cfg.kappa, cfg.cAlpha, cfg.cBeta, cfg.rhoS);
    let maxDelta = 0;
    for (let i = 0; i < c.length; i++) {
      const d = Math.abs(c[i] - c0Copy[i]);
      if (d > maxDelta) maxDelta = d;
    }
    assert(maxDelta > 0.01, `expected real Cahn-Hilliard evolution, maxDelta=${maxDelta}`);
    assert.equal(m1.valid, true);
    assert(Math.abs(m1.meanC - m0.meanC) < 1e-6, `mass drift too large: ${Math.abs(m1.meanC - m0.meanC)}`);

    // Off-critical evolution (c0 = 0.42, 100 steps)
    let co = SP.buildSeededNoiseInit(nx * ny, 0.42, 0.03, 99);
    const mo0 = SP.measureSpinodal2D(co, nx, ny, cfg.dx, cfg.kappa, cfg.cAlpha, cfg.cBeta, cfg.rhoS);
    for (let step = 0; step < 100; step++) {
      co = SP.cpuCahnHilliardStep2D(co, nx, ny, cfg);
    }
    const mo1 = SP.measureSpinodal2D(co, nx, ny, cfg.dx, cfg.kappa, cfg.cAlpha, cfg.cBeta, cfg.rhoS);
    assert.equal(mo1.valid, true);
    assert(Math.abs(mo1.meanC - mo0.meanC) < 1e-6, `off-critical mass drift: ${Math.abs(mo1.meanC - mo0.meanC)}`);
  });

  // ---------------------------------------------------- SPIN-LYAPUNOV-DECAY
  await check("SPIN-LYAPUNOV-DECAY", () => {
    const nx = 48, ny = 48;
    const cfg = { dx: 1.0, dt: 0.0033, kappa: 2.0, mobility: 5.0, cAlpha: 0.3, cBeta: 0.7, rhoS: 5.0 };
    // Smooth periodic unstable mode near k_max = 0.4472 (k = 2*pi*3/48 = 0.3927, omega > 0)
    let c = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        c[y * nx + x] =
          0.5 +
          0.04 * Math.cos((2 * Math.PI * 3 * x) / nx) +
          0.03 * Math.cos((2 * Math.PI * 3 * y) / ny);
      }
    }
    const mInit = SP.measureSpinodal2D(c, nx, ny, cfg.dx, cfg.kappa, cfg.cAlpha, cfg.cBeta, cfg.rhoS);
    let prevF = mInit.F;

    for (let block = 0; block < 20; block++) {
      for (let s = 0; s < 25; s++) {
        c = SP.cpuCahnHilliardStep2D(c, nx, ny, cfg);
      }
      const m = SP.measureSpinodal2D(c, nx, ny, cfg.dx, cfg.kappa, cfg.cAlpha, cfg.cBeta, cfg.rhoS);
      assert.equal(m.valid, true);
      assert(m.chemF >= 0 && m.gradF >= 0);
      assert(m.F < prevF, `Lyapunov decay violated at block ${block}: F=${m.F} >= prevF=${prevF}`);
      prevF = m.F;
    }

    const mEnd = SP.measureSpinodal2D(c, nx, ny, cfg.dx, cfg.kappa, cfg.cAlpha, cfg.cBeta, cfg.rhoS);
    assert(mEnd.F < mInit.F * 0.99, `expected significant energy drop: ${mInit.F} -> ${mEnd.F}`);
    assert(mEnd.maxC - mEnd.minC > mInit.maxC - mInit.minC, "spinodal amplitude should grow during decomposition");
  });

  // ----------------------------------------------------- SPIN-LSW-FIT-DOCS
  await check("SPIN-LSW-FIT-DOCS", () => {
    // Exact 1/3 slope recovery on synthetic L(t) = 2.5 * t^(1/3)
    const synth = [];
    for (const t of [10, 25, 50, 100, 250, 500, 1000]) {
      synth.push({
        t,
        F: 300 / Math.cbrt(t),
        chemF: 150 / Math.cbrt(t),
        gradF: 150 / Math.cbrt(t),
        L: 2.5 * Math.cbrt(t),
        meanC: 0.5,
        minC: 0.3,
        maxC: 0.7,
      });
    }
    const slope = SP.fitLswSlope(synth);
    assert(slope !== null && Math.abs(slope - 1 / 3) < 1e-12, `expected exact 1/3 slope, got ${slope}`);

    // Pre-spinodal dip exclusion (early falling L before minimum)
    const withDip = [
      { t: 1, F: 318, chemF: 317, gradF: 1, L: 25, meanC: 0.5, minC: 0.45, maxC: 0.55 },
      { t: 5, F: 260, chemF: 200, gradF: 60, L: 9.0, meanC: 0.5, minC: 0.31, maxC: 0.69 },
      ...synth,
    ];
    const slopeDip = SP.fitLswSlope(withDip);
    assert(slopeDip !== null && Math.abs(slopeDip - 1 / 3) < 1e-12, `dip exclusion failed: got ${slopeDip}`);

    // Refusal on too-few or pre-saturation points
    assert.equal(SP.fitLswSlope(synth.slice(0, 2)), null);
    assert.equal(
      SP.fitLswSlope(synth.map(s => ({ ...s, minC: 0.45, maxC: 0.55 }))),
      null,
      "must return null before phase separation exceeds 0.25",
    );

    // Figure builder (energy & coarsening) layout + CSV + copy hygiene
    for (const mode of ["energy", "coarsening"]) {
      const fig = SPL.spinodalFigure(synth, mode, slope, SP.SPINODAL_PRESETS.pfhub1.label);
      assert(!fig.title.includes("—"), `em dash in spinodal figure title: ${fig.title}`);
      const laid = PL.layoutFigure(fig.fig, { w: 460, h: 220, padL: 48, padR: 16, padT: 14, padB: 32 });
      assert.equal(laid.panels.length, 1);
      assert(laid.panels[0].series.length === (mode === "coarsening" ? 2 : 1));
      const csv = PC.toCSV(fig.title, fig.columns, fig.bridge, fig.prov);
      assert(!csv.includes("—"), `em dash in spinodal figure CSV (${mode})`);
    }

    // Run-export CSV & archive integration (non-breaking when omitted)
    const spinPayload = {
      preset: SP.SPINODAL_PRESETS.pfhub1.label,
      dim: "2d",
      n: 200,
      c0: 0.5,
      kappa: 2.0,
      mobility: 5.0,
      simTime: 1000,
      freeEnergy: 62.4,
      meanC: 0.50255,
      massDrift: 1.1e-7,
      domainL: 24.8,
      lswSlope: 0.333,
      samples: synth.map(s => ({ t: s.t, F: s.F, L: s.L, meanC: s.meanC })),
    };
    const spinCsv = RE.formatSpinodalCsv(spinPayload, { build: "v8.5", share: "#spinodal=pfhub1" });
    assert(spinCsv.includes("# SOLIDIFY figure data") && spinCsv.includes("time,free_energy_F,domain_L,mean_c"));
    assert(!spinCsv.includes("—"));

    const dummySnap = {
      exportedAt: "2026-11-24T00:00:00.000Z",
      build: "v8.5",
      solver: "Cahn-Hilliard",
      mode: "2d",
      material: { key: "al", name: "Al-Zn", constants: {}, mix: null, caveats: [] },
      seed: 0x12345678,
      grid: 200,
      simulationTime: 1000,
      parameters: {},
      setupLink: "#spinodal=pfhub1",
      units: {},
      camera: {},
      image: { lens: 0, umPerPixel: 1, perspective: false },
      statistics: {},
    };
    const withoutSpin = RE.runEntries(dummySnap, []);
    assert(!withoutSpin.some(e => e.name === "data/spinodal.csv"), "data/spinodal.csv must be omitted when spinodal is null");
    const withSpin = RE.runEntries(dummySnap, [], null, null, null, spinPayload);
    assert(withSpin.some(e => e.name === "data/spinodal.csv"), "data/spinodal.csv must be emitted when spinodal is present");
    const manifest = JSON.parse(new TextDecoder().decode(withSpin.find(e => e.name === "run.json").data));
    assert.equal(manifest.spinodal.file, "data/spinodal.csv");
    assert.equal(manifest.spinodal.dim, "2d");

    // #spinodal route parsing
    assert.deepEqual(SH.parseSpinodalRoute("#spinodal"), { kind: "spinodal" });
    assert.deepEqual(SH.parseSpinodalRoute("#spinodal=pfhub1"), { kind: "spinodal", preset: "pfhub1" });
    assert.deepEqual(SH.parseSpinodalRoute("#spinodal=fecr"), { kind: "spinodal", preset: "fecr" });
    assert.deepEqual(SH.parseSpinodalRoute("#spinodal=3d"), { kind: "spinodal", dim: "3d" });
    assert.deepEqual(SH.parseSpinodalRoute("#spinodal=pfhub1:3d"), { kind: "spinodal", preset: "pfhub1", dim: "3d" });
    assert.deepEqual(SH.parseSpinodalRoute("", "?spinodal=alzn:3d"), { kind: "spinodal", preset: "alzn", dim: "3d" });
    assert.equal(SH.parseSpinodalRoute("#eutectic=alcu"), null);
    assert.equal(SH.parseSpinodalRoute("#lab=1"), null);

    // Docs citations, caveats & copy hygiene
    const scienceHtml = fs.readFileSync(path.join(ROOT, "science", "index.html"), "utf8");
    const readmeMd = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    for (const [label, doc] of [["science/index.html", scienceHtml], ["README.md", readmeMd]]) {
      assert(/Cahn.{1,8}Hilliard.*1958/i.test(doc), `${label} missing Cahn & Hilliard (1958)`);
      assert(/Lifshitz.{1,8}Slyozov/i.test(doc), `${label} missing Lifshitz-Slyozov reference`);
      assert(/PFHub Benchmark 1|Jokisaari/i.test(doc), `${label} missing NIST PFHub Benchmark 1 / Jokisaari citation`);
      assert(/elastic|coherency/i.test(doc), `${label} missing omitted elastic coherency strain caveat`);
    }

    const british = /\b(aluminium|mould\w*|programme\w*|colours?|grey|artefacts?|behaviour|centre|modelled)\b/i;
    for (const preset of Object.values(SP.SPINODAL_PRESETS)) {
      for (const field of [preset.label, preset.note, preset.citation]) {
        assert(!field.includes("—"), `prose em dash in spinodal preset ${preset.id}: ${field}`);
        assert(!british.test(field), `British spelling in spinodal preset ${preset.id}: ${field}`);
      }
    }
  });
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\nverify-spinodal: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("\nverify-spinodal: ALL 7 CHECKS PASSED");
