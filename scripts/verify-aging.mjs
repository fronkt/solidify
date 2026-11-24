/**
 * verify-aging.mjs — browser-free CI verification for SOLIDIFY v8.3
 * Shercliff & Ashby (1990) T6 precipitation age-hardening kinetics.
 *
 * Seven checks:
 *   AGING-PEAK-INVARIANTS    Δσ_ppt(0)=0, unique peak at P̄=1, monotone rise/overage, Δσ_ss depletion, T6 range
 *   AGING-ARRHENIUS-SCALING  exact t_peak(T) Arrhenius ratio, reference identity, Simpson ramp+hold convergence
 *   AGING-SOLVUS-REVERSION   T >= T_solvus dissolves precipitates (Δσ_ppt=0, solutionized T4) on schedule & curve
 *   AGING-ALLOY-SELECTIVITY  Al–Cu / A356 / AA2024 resolved; Cu, Fe–C, Ni, Mg, Zn, ice, SCN, 5xxx refused
 *   AGING-CURVE-AND-FIGURE   log-spaced agingCurve + src/plot/aging.ts Figure columns, refs, copy hygiene
 *   AGING-HEATTREAT-BACKCOMPAT  default aging OFF stays byte-identical to Hall–Petch in src/heattreat.ts
 *   AGING-SHARE-ROUNDTRIP    packAgingFlag / decodeAgingFlag / applyHeatSetup preserve legacy HeatTuple shapes
 */

import assert from "node:assert/strict";
import { createServer } from "vite";

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
  const AG = await server.ssrLoadModule("/src/aging.ts");
  const AP = await server.ssrLoadModule("/src/plot/aging.ts");
  const HT = await server.ssrLoadModule("/src/heattreat.ts");
  const HS = await server.ssrLoadModule("/src/heatshare.ts");
  const U = await server.ssrLoadModule("/src/units.ts");
  const M = await server.ssrLoadModule("/src/materials.ts");
  const Q = await server.ssrLoadModule("/src/plot/quantity.ts");

  const AL_SI = M.MATERIALS.al.si;
  const HP_15 = HT.hallPetch(AL_SI, 15e-6);

  // --------------------------------------------------- AGING-PEAK-INVARIANTS
  await check("AGING-PEAK-INVARIANTS", () => {
    const ids = Object.keys(AG.AGING_ALLOYS);
    assert.deepEqual(ids.sort(), ["a356", "aa2024", "al-cu"], "expected exactly 3 cited Al alloys");

    for (const spec of Object.values(AG.AGING_ALLOYS)) {
      // Zero kinetic progress -> Δσ_ppt = 0, full Δσ_ss0, as-cast
      const s0 = AG.agingStrengthAt(spec, 0, HP_15);
      assert.equal(s0.sigmaPptMPa, 0);
      assert.equal(s0.fTransformed, 0);
      assert.equal(s0.sigmaSsMPa, spec.deltaSigmaSs0MPa);
      assert.equal(s0.sigmaTotalMPa, HP_15 + spec.deltaSigmaSs0MPa);
      assert.equal(s0.temper, "as-cast");

      // Exact unique peak at P̄ = 1
      const sp = AG.agingStrengthAt(spec, 1, HP_15);
      assert(rel(sp.sigmaPptMPa, spec.deltaSigmaPeakMPa) < 1e-12, `${spec.id}: peak Δσ_ppt mismatch`);
      assert.equal(sp.temper, "peak-aged (T6)");
      assert(sp.sigmaTotalMPa >= 180 && sp.sigmaTotalMPa <= 360,
        `${spec.id}: T6 total σ_y ${sp.sigmaTotalMPa.toFixed(1)} MPa outside physical [180, 360] MPa`);

      // Solid-solution depletion exact identity Δσ_ss = Δσ_ss0 * (1 - f_r)^(2/3)
      for (const p of [0.05, 0.25, 0.5, 1.0, 2.5, 10.0]) {
        const st = AG.agingStrengthAt(spec, p, HP_15);
        const fr = 1 - Math.exp(-p);
        const wantSs = spec.deltaSigmaSs0MPa * Math.pow(1 - fr, 2 / 3);
        const wantPpt = (2 * spec.deltaSigmaPeakMPa * Math.sqrt(p)) / (1 + p);
        assert(rel(st.fTransformed, fr) < 1e-12);
        assert(rel(st.sigmaSsMPa, wantSs) < 1e-12);
        assert(rel(st.sigmaPptMPa, wantPpt) < 1e-12);
        assert(rel(st.sigmaTotalMPa, HP_15 + wantSs + wantPpt) < 1e-12);
      }

      // Strict monotone rise on underaged arm (P̄ < 1)
      const underGrid = [0, 1e-4, 1e-3, 0.01, 0.05, 0.15, 0.35, 0.6, 0.85, 0.99, 1.0];
      for (let i = 1; i < underGrid.length; i++) {
        const a = AG.agingStrengthAt(spec, underGrid[i - 1], HP_15);
        const b = AG.agingStrengthAt(spec, underGrid[i], HP_15);
        assert(b.sigmaPptMPa > a.sigmaPptMPa, `${spec.id}: underaged arm not strictly increasing at P̄=${underGrid[i]}`);
      }

      // Strict monotone overaging decay on overaged arm (P̄ > 1)
      const overGrid = [1.0, 1.01, 1.25, 1.8, 3.0, 6.0, 15.0, 50.0, 200.0, 1000.0];
      for (let i = 1; i < overGrid.length; i++) {
        const a = AG.agingStrengthAt(spec, overGrid[i - 1], HP_15);
        const b = AG.agingStrengthAt(spec, overGrid[i], HP_15);
        assert(b.sigmaPptMPa < a.sigmaPptMPa, `${spec.id}: overaged arm not strictly decreasing at P̄=${overGrid[i]}`);
      }

      // Temper classification boundaries
      assert.equal(AG.classifyTemper(0.2, false), "underaged");
      assert.equal(AG.classifyTemper(1.0, false), "peak-aged (T6)");
      assert.equal(AG.classifyTemper(4.0, false), "overaged (T7)");
      assert.equal(AG.classifyTemper(1.0, true), "solutionized (T4)");
    }
  });

  // ------------------------------------------------- AGING-ARRHENIUS-SCALING
  await check("AGING-ARRHENIUS-SCALING", () => {
    const alCu = AG.AGING_ALLOYS["al-cu"];

    // Exact reference identity
    for (const spec of Object.values(AG.AGING_ALLOYS)) {
      const tRef = AG.isothermalPeakTimeSec(spec, spec.refTempC);
      assert(rel(tRef, spec.refPeakHours * 3600) < 1e-12, `${spec.id}: ref peak time identity failed`);
    }

    // Arrhenius acceleration: 200 °C peaks faster than 170 °C by exact (T1/T2)*exp((Q_A/R)*(1/T1 - 1/T2))
    const t170 = AG.isothermalPeakTimeSec(alCu, 170);
    const t200 = AG.isothermalPeakTimeSec(alCu, 200);
    assert(t200 !== null && t170 !== null && t200 < t170, "200 °C must reach peak faster than 170 °C");
    const T170 = 170 + U.K0;
    const T200 = 200 + U.K0;
    const expectedRatio = (T170 / T200) * Math.exp((alCu.qA_Jmol / U.R_GAS) * (1 / T170 - 1 / T200));
    assert(rel(t170 / t200, expectedRatio) < 1e-12,
      `Arrhenius ratio mismatch: got ${(t170 / t200).toFixed(6)} vs ${expectedRatio.toFixed(6)}`);
    assert(expectedRatio > 8 && expectedRatio < 12, `expected ~9.5x speedup from 170->200 °C, got ${expectedRatio}`);

    // Pure isothermal schedule at (refTempC, refPeakHours) lands on exact P̄ = 1
    const isoSch = {
      name: "iso-t6",
      startC: alCu.refTempC,
      stages: [{ kind: "hold", minutes: alCu.refPeakHours * 60 }],
    };
    const isoRes = AG.evaluateAging(alCu, isoSch, HP_15);
    assert(rel(isoRes.pBar, 1.0) < 1e-12, `isothermal ref hold P̄=${isoRes.pBar}, expected 1`);
    assert.equal(isoRes.temper, "peak-aged (T6)");

    // Ramp + hold + cool Simpson convergence (256 vs 4096 samples) & ramp contribution
    const rampSch = {
      name: "ramp-hold-cool",
      startC: 20,
      stages: [
        { kind: "ramp", toC: 185, cPerMin: 5 },
        { kind: "hold", minutes: 180 },
        { kind: "ramp", toC: 20, cPerMin: 5 },
      ],
    };
    const coarse = AG.integrateKineticP(rampSch, alCu.qA_Jmol, 256);
    const fine = AG.integrateKineticP(rampSch, alCu.qA_Jmol, 256 * 16);
    assert(rel(coarse.P, fine.P) < 1e-6, `Simpson ramp convergence relErr=${rel(coarse.P, fine.P)}`);
    const holdOnly = AG.integrateKineticP({ name: "hold", startC: 185, stages: [{ kind: "hold", minutes: 180 }] }, alCu.qA_Jmol);
    assert(fine.P > holdOnly.P, "ramps must contribute positive kinetic progress P");

    // 250 °C x 12 h on Al–Cu must be strongly overaged (T7) with lower σ_y than 170 °C x 12 h peak T6
    const overRes = AG.evaluateAging(alCu, { name: "over", startC: 250, stages: [{ kind: "hold", minutes: 720 }] }, HP_15);
    assert.equal(overRes.temper, "overaged (T7)");
    assert(overRes.pBar > 10, `250 °C x 12 h should be far overaged, got P̄=${overRes.pBar}`);
    assert(overRes.sigmaTotalMPa < isoRes.sigmaTotalMPa - 80, "overaged 250 °C/12 h must be well below T6 peak");
  });

  // -------------------------------------------------- AGING-SOLVUS-REVERSION
  await check("AGING-SOLVUS-REVERSION", () => {
    for (const spec of Object.values(AG.AGING_ALLOYS)) {
      assert.equal(AG.isothermalPeakTimeSec(spec, spec.solvusC), null, `${spec.id}: solvusC must return null tPeak`);
      assert.equal(AG.isothermalPeakTimeMin(spec, spec.solvusC + 25), null, `${spec.id}: above solvus must return null`);

      // Schedule reaching exactly T_solvus and above T_solvus (530 °C)
      for (const peakC of [spec.solvusC, spec.solvusC + 25]) {
        const sch = {
          name: "solvus",
          startC: 20,
          stages: [
            { kind: "ramp", toC: peakC, cPerMin: 10 },
            { kind: "hold", minutes: 60 },
            { kind: "ramp", toC: 20, cPerMin: 10 },
          ],
        };
        const res = AG.evaluateAging(spec, sch, HP_15);
        assert.equal(res.dissolved, true);
        assert.equal(res.sigmaPptMPa, 0);
        assert.equal(res.sigmaSsMPa, spec.deltaSigmaSs0MPa);
        assert.equal(res.sigmaTotalMPa, HP_15 + spec.deltaSigmaSs0MPa);
        assert.equal(res.temper, "solutionized (T4)");
        assert.equal(res.tPeakAtHoldMin, null);
        assert.equal(res.note, AG.SOLVUS_DISSOLUTION_NOTE);
      }

      // Curve above solvus has zero Δσ_ppt everywhere and solutionized T4 temper
      const curve = AG.agingCurve(spec, spec.solvusC + 15, HP_15);
      assert.equal(curve.dissolved, true);
      assert.equal(curve.tPeakMin, null);
      assert.equal(curve.peakPptMPa, 0);
      assert(curve.points.every(pt => pt.sigmaPptMPa === 0 && pt.temper === "solutionized (T4)"));
    }
  });

  // ------------------------------------------------- AGING-ALLOY-SELECTIVITY
  await check("AGING-ALLOY-SELECTIVITY", () => {
    // Supported mappings
    assert.equal(AG.resolveAgingAlloy("al").alloyId, "al-cu");
    assert.equal(AG.resolveAgingAlloy("al", { base: "al", wt: { Si: 7.0, Mg: 0.35 } }).alloyId, "a356");
    assert.equal(AG.resolveAgingAlloy("al", { base: "al", wt: { Cu: 4.4, Mg: 1.5, Mn: 0.6 } }).alloyId, "aa2024");
    assert.equal(AG.resolveAgingAlloy("al", { base: "al", wt: { Cu: 4.5 } }).alloyId, "al-cu");
    assert.equal(AG.resolveAgingAlloy("al-cu").alloyId, "al-cu");
    assert.equal(AG.resolveAgingAlloy("a356").alloyId, "a356");
    assert.equal(AG.resolveAgingAlloy("aa2024").alloyId, "aa2024");

    // Unsupported materials & non-age-hardenable Al mixes must refuse honestly with zero em dashes
    const refusedKeys = ["cu", "steel", "ni", "co", "mg", "zn", "ice", "scn", "generic", "qc"];
    const sch = { name: "t", startC: 170, stages: [{ kind: "hold", minutes: 720 }] };
    for (const k of refusedKeys) {
      const r = AG.resolveAgingAlloy(k);
      assert.equal(r.supported, false, `${k} must be refused`);
      assert(typeof r.reason === "string" && r.reason.length > 20, `${k} needs explanatory refusal`);
      assert(!r.reason.includes("—"), `${k} refusal must not contain prose em dash`);
      const ev = AG.evaluateAgingForMaterial(k, null, sch, 50);
      assert.equal(ev.supported, false);
    }

    // Non-heat-treatable Al mixes (5xxx Al-Mg, lean Al-1Zn)
    for (const mix of [{ base: "al", wt: { Mg: 4.5 } }, { base: "al", wt: { Zn: 1.0 } }]) {
      const r = AG.resolveAgingAlloy("al", mix);
      assert.equal(r.supported, false, `Al mix ${JSON.stringify(mix.wt)} must be refused`);
      assert(!r.reason.includes("—"));
    }
  });

  // -------------------------------------------------- AGING-CURVE-AND-FIGURE
  await check("AGING-CURVE-AND-FIGURE", () => {
    const spec = AG.AGING_ALLOYS["al-cu"];
    const curve = AG.agingCurve(spec, 170, HP_15);
    assert.equal(curve.dissolved, false);
    assert.equal(curve.points.length, 121);
    assert(rel(curve.points[0].timeMin, 1.0) < 1e-12);
    assert(rel(curve.points.at(-1).timeMin, 60_000) < 1e-12);
    assert(rel(curve.tPeakMin, 720) < 1e-12);
    for (let i = 1; i < curve.points.length; i++) {
      assert(curve.points[i].timeMin > curve.points[i - 1].timeMin, "curve timeMin must be strictly increasing");
    }

    const sch = { name: "t6", startC: 20, stages: [{ kind: "ramp", toC: 170, cPerMin: 10 }, { kind: "hold", minutes: 720 }, { kind: "ramp", toC: 20, cPerMin: 5 }] };
    const result = AG.evaluateAging(spec, sch, HP_15);
    const units = new U.Units(U.scaleOf({ si: AL_SI, n: 1024, dx: 0.03, latent: 1.6, dSol: 0.8, alloy: true, umPerCell: 1 }), AL_SI);
    const fig = AP.agingFigure({
      curve,
      result,
      holdMin: 720,
      specMPa: 220,
      bridge: Q.bridgeOf(units, "Al–Cu"),
      prov: { material: "Al–Cu", seed: "00000539", grid: "1024² cells (2D)", solver: "Kobayashi", share: "https://example.test/app/", build: "test" },
    });
    assert(fig.title.includes("Al–Cu") && fig.title.includes("170 °C"));
    assert.equal(fig.columns.length, 6);
    assert.equal(fig.fig.panels.length, 1);
    assert(fig.fig.panels[0].y.lo >= 0);
    assert(fig.fig.panels[0].series.length === 2, "expected curve + dialed hold marker series");
    assert(fig.fig.panels[0].refs.some(r => r.label === "Hall–Petch"));
    assert(fig.fig.panels[0].refs.some(r => r.label === "peak T6"));
    assert(fig.prov.extra.some(l => l.includes("Shercliff & Ashby (1990)")));
    assert(!fig.title.includes("—") && fig.prov.extra.every(l => !l.includes("—")));
  });

  // ---------------------------------------------- AGING-HEATTREAT-BACKCOMPAT
  await check("AGING-HEATTREAT-BACKCOMPAT", () => {
    const hp = HT.hallPetch(AL_SI, 15e-6);
    assert.equal(HT.effectiveYieldMPa(AL_SI, 15e-6), hp);
    assert.equal(HT.effectiveYieldMPa(AL_SI, 15e-6, null), hp);
    assert.equal(HT.effectiveYieldMPa(AL_SI, 15e-6, AG.resolveAgingAlloy("cu")), hp);

    const sch = { name: "t6", startC: 170, stages: [{ kind: "hold", minutes: 720 }] };
    assert.equal(HT.evaluateScheduleAging(false, "al", null, sch, AL_SI, 15e-6), null);
    const on = HT.evaluateScheduleAging(true, "al", null, sch, AL_SI, 15e-6);
    assert(on && on.supported === true);
    assert.equal(on.temper, "peak-aged (T6)");
    assert(rel(HT.effectiveYieldMPa(AL_SI, 15e-6, on), on.sigmaTotalMPa) < 1e-12);
    assert(HT.effectiveYieldMPa(AL_SI, 15e-6, on) > hp + 150);
  });

  // --------------------------------------------------- AGING-SHARE-ROUNDTRIP
  await check("AGING-SHARE-ROUNDTRIP", () => {
    assert.equal(HS.packAgingFlag(false), undefined);
    assert.equal(HS.packAgingFlag(undefined), undefined);
    assert.equal(HS.packAgingFlag(true), 1);

    assert.equal(HS.decodeAgingFlag(1), true);
    assert.equal(HS.decodeAgingFlag(true), true);
    assert.equal(HS.decodeAgingFlag(0), false);
    assert.equal(HS.decodeAgingFlag(false), false);
    assert.equal(HS.decodeAgingFlag("1"), false);
    assert.equal(HS.decodeAgingFlag(null), false);
    assert.equal(HS.decodeAgingFlag(undefined), false);

    const base = { tC: 500, holdMin: 60, specMPa: 0, pinF: 0, pinR: 2, workJb: 0, rxN: 0, rxMode: 0 };
    const ranges = { tMin: 100, tMax: 660, specMax: 350, volume: false };
    const tuple = HS.packHeatSetup({ ...base, tC: 170, holdMin: 720, specMPa: 220, aging: true });
    assert.equal(tuple.length, 3, "aging flag must not bloat legacy 3-element HeatTuple");
    assert.equal(HS.heatTupleShapeOk(tuple), true);

    const restoredOn = HS.applyHeatSetup(tuple, ranges, base, 1);
    assert.equal(restoredOn.aging, true);
    assert.equal(restoredOn.tC, 170);
    assert.equal(restoredOn.holdMin, 720);
    assert.equal(restoredOn.specMPa, 220);

    const restoredOff = HS.applyHeatSetup(tuple, ranges, base);
    assert.equal(restoredOff.aging, undefined);
  });
} finally {
  await server.close();
}

console.log(failed ? `done — ${failed} FAILED` : "done — all aging checks passed");
process.exitCode = failed ? 1 : 0;
