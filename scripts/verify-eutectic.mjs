/**
 * verify-eutectic.mjs — browser-free CI verification for SOLIDIFY v8.4
 * 2D Binary Eutectic Phase-Field Solver (Folch & Plapp 2005 + Jackson & Hunt 1966).
 *
 * Seven checks:
 *   EUT-JH-SERIES            Jackson-Hunt Fourier series P(f) boundaries, symmetry, benchmark & convergence
 *   EUT-JH-SCALING           exact lambda_min ~ V^(-1/2), dT_min ~ V^(1/2), lambda^2*V = K2/K1 across 4 alloys
 *   EUT-LEVER-RULE           leverRule boundaries, physical alloys, clamping, monotonicity & sum === 1
 *   EUT-STABILITY            explicit 2D parabolic CFL check distinguishes safe vs unstable diffusion/phase steps
 *   EUT-MEASURE-SYNTH        measureLamellae recovers wavelength, pair count, frontY, phase fractions & catches NaN
 *   EUT-SOLUTE-CONSERVATION  Folch-Plapp Eq. (17) tilt identities, discrete solute conservation, simplex & lever shift
 *   EUT-DOCS-CAVEATS         cited caveats in science/README/alloys, copy hygiene, figure/CSV & #eutectic route
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
  const EU = await server.ssrLoadModule("/src/eutectic.ts");
  const EP = await server.ssrLoadModule("/src/plot/eutectic.ts");
  const PL = await server.ssrLoadModule("/src/plot/layout.ts");
  const PC = await server.ssrLoadModule("/src/plot/csv.ts");
  const RE = await server.ssrLoadModule("/src/run-export.ts");
  const SH = await server.ssrLoadModule("/src/share.ts");

  // --------------------------------------------------------- EUT-JH-SERIES
  await check("EUT-JH-SERIES", () => {
    assert.equal(EU.jacksonHuntSeriesP(0), 0);
    assert.equal(EU.jacksonHuntSeriesP(1), 0);
    assert.equal(EU.jacksonHuntSeriesP(-0.2), 0);
    assert.equal(EU.jacksonHuntSeriesP(1.2), 0);
    assert.equal(EU.jacksonHuntSeriesP(Number.NaN), 0);

    // Exact symmetry P(f) === P(1 - f)
    for (const f of [0.08, 0.15, 0.25, 0.37, 0.48]) {
      const a = EU.jacksonHuntSeriesP(f, 256);
      const b = EU.jacksonHuntSeriesP(1 - f, 256);
      assert(a > 0 && Number.isFinite(a), `P(${f}) should be positive finite`);
      assert(Math.abs(a - b) < 1e-14, `symmetry failed at f=${f}: ${a} vs ${b}`);
    }

    // Exact analytical maximum at f = 0.5: 7 * zeta(3) / (8 * pi^3) = 0.0339224236...
    const zeta3 = 1.2020569031595942;
    const pHalfExact = (7 * zeta3) / (8 * Math.PI ** 3);
    const pHalf256 = EU.jacksonHuntSeriesP(0.5, 256);
    const pHalf1024 = EU.jacksonHuntSeriesP(0.5, 1024);
    assert(rel(pHalf256, pHalfExact) < 1e-4, `P(0.5, 256)=${pHalf256} vs exact ${pHalfExact}`);
    assert(rel(pHalf1024, pHalfExact) < 1e-6, `P(0.5, 1024)=${pHalf1024} vs exact ${pHalfExact}`);
    assert(rel(pHalf256, pHalf1024) < 1e-5, `convergence mismatch: ${pHalf256} vs ${pHalf1024}`);

    // Unimodal strictly increasing on (0, 0.5]
    const grid = [0.05, 0.12, 0.22, 0.35, 0.45, 0.5];
    for (let i = 1; i < grid.length; i++) {
      assert(
        EU.jacksonHuntSeriesP(grid[i]) > EU.jacksonHuntSeriesP(grid[i - 1]),
        `P(f) not strictly increasing between ${grid[i - 1]} and ${grid[i]}`,
      );
    }
  });

  // -------------------------------------------------------- EUT-JH-SCALING
  await check("EUT-JH-SCALING", () => {
    const ids = Object.keys(EU.EUTECTIC_ALLOYS).sort();
    assert.deepEqual(ids, ["alcu", "alsi", "pbsn", "symmetric"], "expected exactly 4 eutectic alloy presets");

    const products = {};
    for (const id of ids) {
      const m5 = EU.jacksonHuntModel(id, 5, 0);
      const m20 = EU.jacksonHuntModel(id, 20, 0);
      const m80 = EU.jacksonHuntModel(id, 80, 0);
      products[id] = m20.lambda2VPhys;

      for (const m of [m5, m20, m80]) {
        for (const k of [
          "fAlpha", "fBeta", "pSeries", "k1Phys", "k2Phys", "lambda2VPhys",
          "lambdaMinUm", "dTMinK", "k1Sim", "k2Sim", "lambda2VSim", "lambdaMinCells", "dTMinSim",
        ]) {
          assert(Number.isFinite(m[k]) && m[k] > 0, `${id}.${k} must be finite positive, got ${m[k]}`);
        }
        assert(Math.abs(m.fAlpha + m.fBeta - 1) < 1e-12);
        assert(rel(m.lambda2VPhys, m.k2Phys / m.k1Phys) < 1e-12);
        assert(rel(m.lambda2VSim, m.k2Sim / m.k1Sim) < 1e-12);
      }

      // Exact JH power-law scaling for physical alloys (and sim-unit symmetric)
      if (id !== "symmetric") {
        assert(rel(m5.lambda2VPhys, m20.lambda2VPhys) < 1e-12, `${id}: lambda^2*V must not depend on V`);
        assert(rel(m20.lambda2VPhys, m80.lambda2VPhys) < 1e-12, `${id}: lambda^2*V must not depend on V`);
        assert(rel(m20.lambdaMinUm / m5.lambdaMinUm, 0.5) < 1e-12, `${id}: lambda_min(4V)/lambda_min(V) must be 0.5`);
        assert(rel(m80.lambdaMinUm / m20.lambdaMinUm, 0.5) < 1e-12, `${id}: lambda_min(4V)/lambda_min(V) must be 0.5`);
        assert(rel(m20.dTMinK / m5.dTMinK, 2.0) < 1e-12, `${id}: dT_min(4V)/dT_min(V) must be 2.0`);
        assert(rel(m80.dTMinK / m20.dTMinK, 2.0) < 1e-12, `${id}: dT_min(4V)/dT_min(V) must be 2.0`);
        assert(rel(m20.lambdaMinUm * m20.lambdaMinUm * 20, m20.lambda2VPhys) < 1e-12);
      } else {
        // Symmetric uses pullVToSim(V), where V=5 -> 0.01125 and V=20 -> 0.045 (exact 4x ratio inside clamp)
        assert(rel(m20.lambdaMinCells / m5.lambdaMinCells, 0.5) < 1e-12, "symmetric lambda_min(4V)/lambda_min(V) === 0.5");
        assert(rel(m20.dTMinSim / m5.dTMinSim, 2.0) < 1e-12, "symmetric dT_min(4V)/dT_min(V) === 2.0");
      }

      // Unique strict minimum at lambdaMinUm (phys) and lambdaMinCells (sim)
      assert(rel(m20.dTPhys(m20.lambdaMinUm), m20.dTMinK) < 1e-12, `${id}: dTPhys(lambdaMin) === dTMinK`);
      assert(rel(m20.dTPhys(0.5 * m20.lambdaMinUm), 1.25 * m20.dTMinK) < 1e-12, `${id}: dT(0.5*lamMin) === 1.25*dTMin`);
      assert(rel(m20.dTPhys(2.0 * m20.lambdaMinUm), 1.25 * m20.dTMinK) < 1e-12, `${id}: dT(2*lamMin) === 1.25*dTMin`);
      assert(m20.dTPhys(0.8 * m20.lambdaMinUm) > m20.dTMinK);
      assert(m20.dTPhys(1.25 * m20.lambdaMinUm) > m20.dTMinK);

      assert(rel(m20.dTSim(m20.lambdaMinCells), m20.dTMinSim) < 1e-12, `${id}: dTSim(lambdaMinCells) === dTMinSim`);
      assert(m20.dTSim(0.5 * m20.lambdaMinCells) > m20.dTMinSim);
      assert(m20.dTSim(2.0 * m20.lambdaMinCells) > m20.dTMinSim);

      // Off-eutectic shift moves fAlpha in lever-rule direction
      const mNeg = EU.jacksonHuntModel(id, 20, -0.15);
      const mPos = EU.jacksonHuntModel(id, 20, 0.15);
      assert(mNeg.fAlpha > m20.fAlpha && m20.fAlpha > mPos.fAlpha, `${id}: c0Off must shift fAlpha monotonically`);
    }

    // Physical alloy ordering and consistency with cited lambda^2*V references
    assert(products.pbsn < products.alcu && products.alcu < products.alsi,
      `expected pbsn < alcu < alsi lambda^2*V ordering, got ${JSON.stringify(products)}`);
    for (const id of ["alcu", "pbsn", "alsi"]) {
      const ref = EU.EUTECTIC_ALLOYS[id].lambda2VRefUm3s;
      assert(rel(products[id], ref) < 0.25, `${id}: computed lambda2V=${products[id].toFixed(2)} too far from ref ${ref}`);
    }
  });

  // -------------------------------------------------------- EUT-LEVER-RULE
  await check("EUT-LEVER-RULE", () => {
    // Exact endpoints and midpoint
    assert.deepEqual(EU.leverRule(-1, -1, 1), { fAlpha: 1, fBeta: 0 });
    assert.deepEqual(EU.leverRule(1, -1, 1), { fAlpha: 0, fBeta: 1 });
    assert.deepEqual(EU.leverRule(0, -1, 1), { fAlpha: 0.5, fBeta: 0.5 });

    // Clamping outside [cAlpha, cBeta]
    assert.deepEqual(EU.leverRule(-5, -1, 1), { fAlpha: 1, fBeta: 0 });
    assert.deepEqual(EU.leverRule(5, -1, 1), { fAlpha: 0, fBeta: 1 });

    // Physical alloys at eutectic composition
    const alcu = EU.EUTECTIC_ALLOYS.alcu;
    const alcuL = EU.leverRule(alcu.cE, alcu.cAlpha, alcu.cBeta);
    const alcuWant = (alcu.cBeta - alcu.cE) / (alcu.cBeta - alcu.cAlpha);
    assert(Math.abs(alcuL.fAlpha - alcuWant) < 1e-12);
    assert(Math.abs(alcuL.fAlpha + alcuL.fBeta - 1) < 1e-12);

    // Strict monotonicity across interior
    let prev = 1;
    for (const c of [-0.8, -0.4, 0, 0.4, 0.8]) {
      const r = EU.leverRule(c, -1, 1);
      assert(r.fAlpha < prev, `leverRule not strictly decreasing at c=${c}`);
      assert(Math.abs(r.fAlpha + r.fBeta - 1) < 1e-12);
      prev = r.fAlpha;
    }

    // Degenerate span guard
    assert.deepEqual(EU.leverRule(10, 10, 10), { fAlpha: 0.5, fBeta: 0.5 });
  });

  // --------------------------------------------------------- EUT-STABILITY
  await check("EUT-STABILITY", () => {
    const w2OverTau = (EU.FP_SIM.W * EU.FP_SIM.W) / EU.FP_SIM.tau;
    const def = EU.eutecticStability(EU.FP_SIM.dx, EU.FP_SIM.dt, EU.FP_SIM.dLiq, w2OverTau);
    assert.equal(def.stable, true, "default FP_SIM parameters must be CFL-stable");
    assert(rel(def.diffusionCfl, 0.72) < 1e-12, `expected diffusionCfl=0.72, got ${def.diffusionCfl}`);
    assert(rel(def.phaseCfl, 0.5184) < 1e-12, `expected phaseCfl=0.5184, got ${def.phaseCfl}`);
    assert(rel(def.maxDt, 0.0625) < 1e-12, `expected maxDt=0.0625, got ${def.maxDt}`);

    // Unstable diffusion step (dt > dx^2 / (4 * D))
    const badDiff = EU.eutecticStability(1.0, 0.07, 4.0, w2OverTau);
    assert.equal(badDiff.stable, false);
    assert(badDiff.diffusionCfl > 1);

    // Unstable phase-field step (dt > dx^2 / (4 * W^2 / tau))
    const badPhase = EU.eutecticStability(1.0, 0.045, 1.0, 8.0);
    assert.equal(badPhase.stable, false);
    assert(badPhase.phaseCfl > 1);

    // Invalid / non-positive inputs
    assert.equal(EU.eutecticStability(0, 0.01, 1, 1).stable, false);
    assert.equal(EU.eutecticStability(1, -0.01, 1, 1).stable, false);
    assert.equal(EU.eutecticStability(Number.NaN, 0.01, 1, 1).stable, false);
  });

  // ----------------------------------------------------- EUT-MEASURE-SYNTH
  await check("EUT-MEASURE-SYNTH", () => {
    const nx = 128;
    const ny = 96;
    const frontFrac = 0.55;
    for (const pairs of [4, 6, 8, 12]) {
      const field = EU.buildInitialEutecticField(nx, ny, pairs, 0, frontFrac);
      const m = EU.measureLamellae(field, nx, ny, 1, 12);
      const wantLam = nx / pairs;
      assert.equal(m.valid, true, `pairs=${pairs}: synthetic field must be valid`);
      assert.equal(m.pairs, pairs, `pairs=${pairs}: recovered ${m.pairs}`);
      assert(m.lambdaCells !== null && rel(m.lambdaCells, wantLam) < 0.02,
        `pairs=${pairs}: lambdaCells=${m.lambdaCells} vs ${wantLam}`);
      assert(Math.abs(m.frontY - ny * frontFrac) < 2.5, `pairs=${pairs}: frontY=${m.frontY}`);
      assert(Math.abs(m.fAlpha - 0.5) < 0.03, `pairs=${pairs}: fAlpha=${m.fAlpha}`);
      assert(Math.abs(m.fAlpha + m.fBeta - 1) < 1e-9);
      assert(m.maxSimplexErr < 1e-6, `pairs=${pairs}: maxSimplexErr=${m.maxSimplexErr}`);
    }

    // Off-eutectic phase fraction recovery
    const fNeg = EU.measureLamellae(EU.buildInitialEutecticField(nx, ny, 6, -0.20, frontFrac), nx, ny, 1, 12);
    const fPos = EU.measureLamellae(EU.buildInitialEutecticField(nx, ny, 6, 0.20, frontFrac), nx, ny, 1, 12);
    assert(Math.abs(fNeg.fAlpha - 0.60) < 0.03, `c0Off=-0.20 expected fAlpha ~ 0.60, got ${fNeg.fAlpha}`);
    assert(Math.abs(fPos.fAlpha - 0.40) < 0.03, `c0Off=+0.20 expected fAlpha ~ 0.40, got ${fPos.fAlpha}`);

    // Non-finite corruption detection
    const corrupt = EU.buildInitialEutecticField(32, 32, 4, 0, 0.5);
    corrupt[40] = Number.NaN;
    assert.equal(EU.measureLamellae(corrupt, 32, 32, 1, 6).valid, false, "NaN must set valid=false");
  });

  // ----------------------------------------------- EUT-SOLUTE-CONSERVATION
  await check("EUT-SOLUTE-CONSERVATION", () => {
    // 1. Folch-Plapp Eq. (17) partition of unity and zero third-phase intrusion
    const interior = [
      [0.2, 0.3, 0.5],
      [0.6, 0.25, 0.15],
      [0.1, 0.8, 0.1],
      [1 / 3, 1 / 3, 1 / 3],
      [0.45, 0.45, 0.1],
    ];
    for (const [pA, pB, pL] of interior) {
      const sum = EU.fpTilt(pA, pB, pL) + EU.fpTilt(pB, pL, pA) + EU.fpTilt(pL, pA, pB);
      assert(Math.abs(sum - 1) < 1e-12, `Eq.17 partition of unity failed at (${pA},${pB},${pL}): sum=${sum}`);
    }
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      assert.equal(EU.fpTilt(0, p, 1 - p), 0, `absent third phase must have g=0 at p=${p}`);
      const [gSelf, gJ, gK] = EU.fpTiltGrad(0, p, 1 - p);
      assert(Math.abs(gSelf) < 1e-15 && Math.abs(gJ) < 1e-15 && Math.abs(gK) < 1e-15,
        `absent third phase gradient must vanish at p=${p}: [${gSelf}, ${gJ}, ${gK}]`);
      // Reduces to quintic polynomial p^3(10 - 15p + 6p^2) on two-phase edge
      const quintic = p * p * p * (10 - 15 * p + 6 * p * p);
      assert(Math.abs(EU.fpTilt(p, 1 - p, 0) - quintic) < 1e-12, `two-phase edge quintic mismatch at p=${p}`);
    }

    // 2. Closed-box multi-step PDE evolution: exact solute conservation + simplex preservation
    const nx = 64;
    const ny = 48;
    let state = EU.buildInitialEutecticField(nx, ny, 4, 0.08, 0.45);
    const m0 = EU.measureLamellae(state, nx, ny, 1, 8);
    const initCopy = new Float32Array(state);
    for (let s = 0; s < 60; s++) {
      state = EU.cpuFolchPlappStep(state, nx, ny, { topDirichlet: false, c0Off: 0.08, yE: 28, gradG: 0.004 });
    }
    const m1 = EU.measureLamellae(state, nx, ny, 1, 8);

    // Liveness: state must actually evolve
    let maxDelta = 0;
    for (let i = 0; i < state.length; i++) {
      const d = Math.abs(state[i] - initCopy[i]);
      if (d > maxDelta) maxDelta = d;
    }
    assert(maxDelta > 0.05, `expected real phase-field evolution, maxDelta=${maxDelta}`);
    assert.equal(m1.valid, true, "evolved field must stay finite");
    assert(m1.maxSimplexErr < 1e-5, `simplex drift too large: ${m1.maxSimplexErr}`);
    assert(Math.abs(m1.meanC - m0.meanC) < 1e-6,
      `closed-box solute conservation drift too large: ${Math.abs(m1.meanC - m0.meanC)}`);

    // 3. Dynamic off-eutectic lever-rule response from identical 50/50 solid slab
    const runOff = (c0Off) => {
      let st = EU.buildInitialEutecticField(48, 48, 3, 0, 0.35);
      // Set liquid chemical potential to c0Off while keeping initial solid 50/50
      for (let i = 0; i < 48 * 48; i++) {
        st[i * 4 + 3] = c0Off;
      }
      for (let s = 0; s < 180; s++) {
        const yE = 24 + 0.045 * (s * EU.FP_SIM.dt);
        st = EU.cpuFolchPlappStep(st, 48, 48, { topDirichlet: true, c0Off, yE, gradG: 0.005 });
      }
      return EU.measureLamellae(st, 48, 48, 1, 6);
    };
    const mNeg = runOff(-0.15);
    const mPos = runOff(0.15);
    assert(mNeg.valid && mPos.valid, "off-eutectic CPU runs must stay valid");
    assert(mNeg.fAlpha > mPos.fAlpha + 0.04,
      `expected lever-rule shift fAlpha(-0.15)=${mNeg.fAlpha.toFixed(4)} > fAlpha(+0.15)=${mPos.fAlpha.toFixed(4)}`);
  });

  // ------------------------------------------------------ EUT-DOCS-CAVEATS
  await check("EUT-DOCS-CAVEATS", () => {
    const scienceHtml = fs.readFileSync(path.join(ROOT, "science", "index.html"), "utf8");
    const readmeMd = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

    // Both docs must cite Folch & Plapp (2005), Jackson & Hunt (1966), enlarged-width/isotropic & Al-Si faceting caveats
    for (const [label, doc] of [["science/index.html", scienceHtml], ["README.md", readmeMd]]) {
      assert(/Folch.{1,8}Plapp.*2005/i.test(doc), `${label} missing Folch & Plapp (2005) citation`);
      assert(/Jackson.{1,8}Hunt.*1966/i.test(doc), `${label} missing Jackson & Hunt (1966) citation`);
      assert(/isotropic|enlarged/i.test(doc), `${label} missing isotropic / enlarged-width caveat`);
      assert(/Al.{1,4}Si[\s\S]{0,160}facet|facet[\s\S]{0,160}Al.{1,4}Si/i.test(doc),
        `${label} missing Al-Si faceted irregular-eutectic caveat`);
    }

    // Alloy definitions copy hygiene & Al-Si caveat
    const british = /\b(aluminium|mould\w*|programme\w*|colours?|grey|artefacts?|behaviour|centre|modelled)\b/i;
    assert(typeof EU.EUTECTIC_ALLOYS.alsi.caveat === "string" && /facet/i.test(EU.EUTECTIC_ALLOYS.alsi.caveat),
      "EUTECTIC_ALLOYS.alsi.caveat must explain faceted Si irregular growth");
    for (const alloy of Object.values(EU.EUTECTIC_ALLOYS)) {
      for (const field of [alloy.label, alloy.note, alloy.caveat ?? "", alloy.citation]) {
        assert(!field.includes("—"), `prose em dash found in eutectic alloy ${alloy.id}: ${field}`);
        assert(!british.test(field), `British spelling found in eutectic alloy ${alloy.id}: ${field}`);
      }
    }

    // jacksonHuntFigure() layout + CSV + zero em dashes across all 4 alloys
    for (const alloy of Object.values(EU.EUTECTIC_ALLOYS)) {
      const jh = EU.jacksonHuntModel(alloy.id, 20, 0);
      const fig = EP.jacksonHuntFigure(alloy, jh, 20, {
        lambdaUm: alloy.id === "symmetric" ? jh.lambdaMinCells * 1.05 : jh.lambdaMinUm * 1.05,
        dTK: alloy.id === "symmetric" ? jh.dTMinSim * 1.02 : jh.dTMinK * 1.02,
      });
      assert(!fig.title.includes("—"), `em dash in figure title: ${fig.title}`);
      assert(fig.columns.length === 2 && fig.columns[0].values.length >= 64);
      const laid = PL.layoutFigure(fig.fig, { w: 460, h: 240, padL: 48, padR: 16, padT: 14, padB: 32 });
      assert(laid.panels.length === 1 && laid.panels[0].series.length === 2, `${alloy.id}: expected curve + live dot`);
      const csv = PC.toCSV(fig.title, fig.columns, fig.bridge, fig.prov);
      assert(csv.includes("Jackson & Hunt (1966)") && csv.includes("Folch & Plapp (2005)"));
      assert(!csv.includes("—"), `em dash in figure CSV for ${alloy.id}`);
    }

    // Run-export CSV & archive integration (non-breaking when omitted)
    const eutPayload = {
      alloy: EU.EUTECTIC_ALLOYS.alcu.label,
      pullVUmS: 20,
      c0Off: 0,
      gradGKmm: 10,
      lambdaUm: 2.15,
      lambdaMinUm: 2.10,
      lambda2VUm3s: 92.45,
      fAlpha: 0.412,
      fAlphaLever: 0.412,
      dTFrontK: 0.72,
      dTMinK: 0.70,
      meanC: 0.001,
      step: 2400,
    };
    const eutCsv = RE.formatEutecticCsv(eutPayload, { build: "v8.4", share: "#eutectic=alcu" });
    assert(eutCsv.includes("# SOLIDIFY figure data: 2D binary eutectic growth"));
    assert(eutCsv.includes("alloy,pull_V_um_s,c0_off,grad_G_K_mm,lambda_um,lambda_min_um"));
    assert(!eutCsv.includes("—"));

    const dummySnap = {
      exportedAt: "2026-11-24T00:00:00.000Z",
      build: "v8.4",
      solver: "Folch-Plapp",
      mode: "2d",
      material: { key: "al", name: "Al-Cu", constants: {}, mix: null, caveats: [] },
      seed: 0x12345678,
      grid: 256,
      simulationTime: 10,
      parameters: {},
      setupLink: "#eutectic=alcu",
      units: {},
      camera: {},
      image: { lens: 0, umPerPixel: 1, perspective: false },
      statistics: {},
    };
    const withoutEut = RE.runEntries(dummySnap, []);
    assert(!withoutEut.some(e => e.name === "data/eutectic.csv"), "data/eutectic.csv must be omitted when eutectic is null");
    const withEut = RE.runEntries(dummySnap, [], null, null, eutPayload);
    assert(withEut.some(e => e.name === "data/eutectic.csv"), "data/eutectic.csv must be emitted when eutectic is present");
    const manifest = JSON.parse(new TextDecoder().decode(withEut.find(e => e.name === "run.json").data));
    assert.equal(manifest.eutectic.file, "data/eutectic.csv");
    assert.equal(manifest.eutectic.step, 2400);

    // #eutectic route parsing
    assert.deepEqual(SH.parseEutecticRoute("#eutectic"), { kind: "eutectic" });
    assert.deepEqual(SH.parseEutecticRoute("#eutectic=alcu"), { kind: "eutectic", alloy: "alcu" });
    assert.deepEqual(SH.parseEutecticRoute("#eutectic=pbsn"), { kind: "eutectic", alloy: "pbsn" });
    assert.deepEqual(SH.parseEutecticRoute("#eutectic=alsi"), { kind: "eutectic", alloy: "alsi" });
    assert.deepEqual(SH.parseEutecticRoute("#eutectic=symmetric"), { kind: "eutectic", alloy: "symmetric" });
    assert.deepEqual(SH.parseEutecticRoute("", "?eutectic=alsi"), { kind: "eutectic", alloy: "alsi" });
    assert.deepEqual(SH.parseEutecticRoute("#eutectic=unknown"), { kind: "eutectic" });
    assert.equal(SH.parseEutecticRoute("#lab=5"), null);
    assert.equal(SH.parseEutecticRoute("#alloy=al:Cu4"), null);
  });
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\nverify-eutectic: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("\nverify-eutectic: ALL 7 CHECKS PASSED");
