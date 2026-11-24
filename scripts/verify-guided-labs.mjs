/**
 * verify-guided-labs.mjs — browser-free CI verification for SOLIDIFY v8.1 Guided Labs.
 *
 * Five checks:
 *   LAB-SCHEMA           4 labs, 20 steps, unique IDs, valid setup & predicates
 *   LAB-COPY             zero prose em dashes, American spelling, exact control/lens casing
 *   LAB-TRAJECTORIES     deterministic pass trajectories for all 20 steps across Labs 1–4
 *   LAB-ANTI-CHEESE      rejects un-reset undercooling, stale latches, unseeded melts, 96³ overflow
 *   LAB-SKIP-AND-REPORT  skip status semantics, single-step reset, solidify-lab-report v1 round-trip
 */

import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
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

try {
  const { LABS, findLabDef } = await server.ssrLoadModule("/src/labs/labs.ts");
  const { GuidedLabRunner } = await server.ssrLoadModule("/src/labs/runner.ts");
  const { MATERIALS } = await server.ssrLoadModule("/src/materials.ts");
  const { Units, scaleOf } = await server.ssrLoadModule("/src/units.ts");
  const { derive } = await server.ssrLoadModule("/src/alloy.ts");
  const { admit } = await server.ssrLoadModule("/src/elements.ts");
  const HT = await server.ssrLoadModule("/src/heattreat.ts");

  function unitsFor(matKey, calibrated = false, umPerCell = 1) {
    const si = MATERIALS[matKey]?.si ?? null;
    return new Units(scaleOf({ si, n: 1024, dx: 0.03, latent: 1.6, dSol: 0.8, alloy: true, umPerCell, calibrated }), si);
  }

  function makeMockHost(initial = {}) {
    const calls = [];
    const snap = {
      mode: "2d",
      can3d: true,
      material: "generic",
      alloyName: "Generic",
      calibrated: false,
      lambda: 30,
      umPerCell: 1,
      gridN: 1024,
      units: unitsFor("generic"),
      calibration: null,
      params: {
        aniMode: 4,
        delta: 0.04,
        alloyOn: 0,
        c0: 0.1,
        mLiq: 0.25,
        kPart: 0.14,
        coolRate: 0,
        scen: 0,
        atCoef: 0,
      },
      undercool: 1.0,
      lastResetUndercool: 1.0,
      effUndercool: 1.0,
      resetEpoch: 1,
      inoculant: 0,
      nucFired: 0,
      viewName: "MELT",
      cutStyle: 0,
      sliceOff: 0.5,
      sliceSweep: false,
      fracSolid: 0,
      grainCount: 1,
      simTime: 0,
      interfaceTC: null,
      scheilOn: false,
      scheilSamples: 0,
      stereoOn: false,
      stereo: null,
      nyRiskFrac: null,
      poreFrac: null,
      pouredMix: null,
      labActive: false,
      labRunning: false,
      heatActive: false,
      composerOpen: false,
      running: false,
      ...initial,
    };

    const host = {
      calls,
      snap,
      snapshot() { return snap; },
      meta() { return { build: "test-build", seed: 1337, setupLink: "https://example.test/app/#lab=1" }; },
      applyScene(name) { calls.push(["applyScene", name]); },
      setMode(m) { snap.mode = m; calls.push(["setMode", m]); },
      setMaterial(key) {
        snap.material = key;
        snap.units = unitsFor(key, snap.calibrated, snap.umPerCell);
        calls.push(["setMaterial", key]);
        return true;
      },
      setCalibrated(on) { snap.calibrated = on; calls.push(["setCalibrated", on]); },
      setParams(p) { Object.assign(snap.params, p); calls.push(["setParams", p]); },
      setUndercool(v) { snap.undercool = v; calls.push(["setUndercool", v]); },
      setInoculant(nmax) { snap.inoculant = nmax; calls.push(["setInoculant", nmax]); },
      clearMelt(u) {
        snap.undercool = u;
        snap.lastResetUndercool = u;
        snap.effUndercool = u - snap.params.mLiq * snap.params.c0 * snap.params.alloyOn;
        snap.resetEpoch += 1;
        snap.fracSolid = 0;
        calls.push(["clearMelt", u]);
      },
      seedCenter() { calls.push(["seedCenter"]); },
      setView(v) { calls.push(["setView", v]); },
      setSpeed(s) { calls.push(["setSpeed", s]); },
      setRun(on) { snap.running = on; calls.push(["setRun", on]); },
      closeModes() { snap.labActive = false; snap.heatActive = false; snap.composerOpen = false; calls.push(["closeModes"]); },
      syncUI() { calls.push(["syncUI"]); },
      reveal(target) { calls.push(["reveal", target]); },
      clearReveals() { calls.push(["clearReveals"]); },
      onLabChange(id) { calls.push(["onLabChange", id]); },
    };
    return host;
  }

  // ----------------------------------------------------------------- LAB-SCHEMA
  await check("LAB-SCHEMA", async () => {
    assert.equal(LABS.length, 4, "expected 4 labs");
    const labIds = new Set();
    const stepIds = new Set();
    assert.deepEqual(LABS.map(l => l.hashId), [1, 2, 3, 4], "hashIds must be 1..4");
    for (const lab of LABS) {
      assert(!labIds.has(lab.id), `duplicate lab id ${lab.id}`);
      labIds.add(lab.id);
      assert.equal(findLabDef(lab.hashId)?.id, lab.id);
      assert.equal(findLabDef(lab.id)?.id, lab.id);
      assert.equal(lab.steps.length, 5, `${lab.id} must have 5 steps`);
      assert.equal(lab.columns.length, 3, `${lab.id} must have 3 table columns`);
      assert(lab.title.trim().length > 0);
      assert(lab.course.trim().length > 0);
      assert(lab.summary.trim().length > 0);
      assert(lab.minutes >= 15 && lab.minutes <= 60);
      for (const st of lab.steps) {
        assert(!stepIds.has(st.id), `duplicate step id ${st.id}`);
        stepIds.add(st.id);
        assert(st.title.trim().length > 0, `${st.id} needs title`);
        assert(st.action.trim().length > 0, `${st.id} needs action`);
        assert(st.takeaway.trim().length > 0, `${st.id} needs takeaway`);
        const hasSub = Array.isArray(st.subgoals) && st.subgoals.length >= 2;
        const hasCheck = typeof st.check === "function";
        assert(hasSub || hasCheck, `${st.id} needs check() or >=2 subgoals`);
      }
      const host = makeMockHost();
      await lab.setup(host);
      assert(host.calls.some(c => c[0] === "closeModes"), `${lab.id} setup calls closeModes`);
      assert(host.calls.some(c => c[0] === "setMode" && c[1] === "2d"), `${lab.id} setup enters 2d`);
      assert(host.calls.some(c => c[0] === "syncUI"), `${lab.id} setup calls syncUI`);
    }
    assert.equal(stepIds.size, 20, "expected 20 total steps");
    assert.equal(findLabDef(0), null);
    assert.equal(findLabDef(5), null);
    assert.equal(findLabDef(""), null);
    assert.equal(findLabDef("nonexistent"), null);
  });

  // ------------------------------------------------------------------- LAB-COPY
  await check("LAB-COPY", () => {
    const BRITISH = /\b(aluminium|moulds?|colours?|grey|programmes?|vapours?|diall?ed|behaviour)\b/i;
    const FORBIDDEN_GLYPH = /[⚗⚙⚠✕◇⚑]/;
    const issues = [];
    function audit(where, text, allowLoneEmDash = false) {
      if (typeof text !== "string" || !text) return;
      if (allowLoneEmDash && text.trim() === "—") return;
      if (text.includes("—")) issues.push(`${where}: prose em dash in "${text}"`);
      if (BRITISH.test(text)) issues.push(`${where}: British spelling in "${text}"`);
      if (FORBIDDEN_GLYPH.test(text)) issues.push(`${where}: forbidden glyph in "${text}"`);
    }
    for (const lab of LABS) {
      audit(`${lab.id}.title`, lab.title);
      audit(`${lab.id}.course`, lab.course);
      audit(`${lab.id}.summary`, lab.summary);
      for (const c of lab.columns) audit(`${lab.id}.col.${c.key}`, c.label);
      for (const st of lab.steps) {
        audit(`${lab.id}.${st.id}.title`, st.title);
        audit(`${lab.id}.${st.id}.action`, st.action);
        audit(`${lab.id}.${st.id}.takeaway`, st.takeaway);
        for (const sg of st.subgoals ?? []) audit(`${lab.id}.${st.id}.sg.${sg.id}`, sg.label);
      }
      // Exercise empty table formatting
      for (const row of lab.formatRows({})) {
        audit(`${lab.id}.row.label`, row.label);
        for (const [k, v] of Object.entries(row.values)) {
          if (typeof v === "string") audit(`${lab.id}.row.${k}`, v, true);
        }
      }
    }
    const lab4 = findLabDef(4);
    const step43 = lab4.steps.find(s => s.id === "zener-spec-pass");
    assert(step43.action.includes("exit"), "Lab 4.3 must refer to 'exit', not 'Close heat treat'");
    assert(!/close heat treat/i.test(step43.action), "Lab 4.3 must not say 'Close heat treat'");
    assert.deepEqual(issues, [], `copy violations:\n${issues.join("\n")}`);
  });

  // ----------------------------------------------------------- LAB-TRAJECTORIES
  await check("LAB-TRAJECTORIES", async () => {
    // --- Lab 1 ---
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(1, { restart: true }));
      const s = host.snap;

      // 1.1 ms-instability
      s.mode = "2d"; s.calibrated = false; s.params.aniMode = 4; s.params.delta = 0.04; s.fracSolid = 0.14;
      s.viewName = "FIELD"; runner.tick();
      s.viewName = "CURV"; runner.tick();
      assert.equal(runner.getState().session.steps["ms-instability"].status, "completed");

      // 1.2 symmetry-vs-seaweed
      runner.nextStep();
      s.params.aniMode = 6; s.params.delta = 0.04; s.fracSolid = 0.12; runner.tick();
      s.params.aniMode = 4; s.params.delta = 0.005; s.fracSolid = 0.15; runner.tick();
      assert.equal(runner.getState().session.steps["symmetry-vs-seaweed"].status, "completed");

      // 1.3 kobayashi-vs-kr
      runner.nextStep();
      s.material = "al"; s.units = unitsFor("al", false, 1); s.params.alloyOn = 1; s.calibrated = false;
      runner.tick();
      s.calibrated = true; s.lambda = 30; s.umPerCell = 0.087; s.units = unitsFor("al", true, 0.087);
      s.calibration = { d0: 5e-9, W0: 1.7e-7, tau0: 1e-6, wOverD0: 33.9, dT0: 74.7, umPerCell: 0.087 };
      runner.tick();
      assert.equal(runner.getState().session.steps["kobayashi-vs-kr"].status, "completed");

      // 1.4 sdas-convergence
      runner.nextStep();
      s.fracSolid = 0.22; s.lambda = 30;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 12.4, arms: 4, lenUm: 49.6 });
      s.lambda = 20; s.fracSolid = 0.20;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 12.1, arms: 4, lenUm: 48.4 });
      assert.equal(runner.getState().session.steps["sdas-convergence"].status, "completed");

      // 1.5 xray-scheil
      runner.nextStep();
      s.viewName = "XRAY"; s.scheilOn = true; s.scheilSamples = 20; s.fracSolid = 0.25; s.interfaceTC = 632.4; s.params.atCoef = 0.3536;
      runner.tick();
      assert.equal(runner.getState().session.steps["xray-scheil"].status, "completed");

      const rep = runner.buildLabReport();
      assert.equal(rep.stepsCompleted, 5);
      assert.equal(rep.stepsSkipped, 0);
      assert(rep.completedAt !== null);
      assert(rep.table.length >= 6);
      // Revisiting step 0 preserves completed latch
      runner.selectStep(0);
      assert.equal(runner.getState().session.steps["ms-instability"].status, "completed");
    }

    // --- Lab 2 ---
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(2, { restart: true }));
      const s = host.snap;
      s.material = "al"; s.units = unitsFor("al");

      const a356Mix = { base: "al", wt: { Si: 7.0, Mg: 0.35 } };
      const a356 = derive(a356Mix);
      const az91Mix = { base: "mg", wt: { Al: 9.0, Zn: 0.7 } };
      const az91 = derive(az91Mix);
      const s1045Mix = { base: "fe", wt: { C: 0.45, Mn: 0.75 } };
      const s1045 = derive(s1045Mix);
      const alZnMix = { base: "al", wt: { Zn: 1.0 } };
      const alZn = derive(alZnMix);

      // 2.1 eutectic-peritectic-audit
      runner.emit({ kind: "composer-mix-viewed", base: "al", wt: a356Mix.wt, derived: a356 });
      runner.emit({ kind: "composer-mix-viewed", base: "mg", wt: az91Mix.wt, derived: az91 });
      runner.emit({ kind: "composer-mix-viewed", base: "fe", wt: s1045Mix.wt, derived: s1045 });
      assert.equal(runner.getState().session.steps["eutectic-peritectic-audit"].status, "completed");

      // 2.2 screen-demix-and-vapor
      runner.nextStep();
      runner.emit({ kind: "composer-picked", base: "al", el: "Bi", admission: admit("al", "Bi", 1) });
      runner.emit({ kind: "composer-picked", base: "fe", el: "Zn", admission: admit("fe", "Zn", 1) });
      assert.equal(runner.getState().session.steps["screen-demix-and-vapor"].status, "completed");

      // 2.3 hagg-and-brass-advisory
      runner.nextStep();
      runner.emit({ kind: "composer-picked", base: "fe", el: "C", admission: admit("fe", "C", 0.45) });
      runner.emit({ kind: "composer-picked", base: "cu", el: "Zn", admission: admit("cu", "Zn", 30) });
      assert.equal(runner.getState().session.steps["hagg-and-brass-advisory"].status, "completed");

      // 2.4 pour-a356-scheil
      runner.nextStep();
      s.pouredMix = { mix: a356Mix, derived: a356 };
      s.alloyName = a356.name;
      s.params.alloyOn = 1; s.params.mLiq = a356.params.mLiq; s.params.c0 = a356.params.c0;
      s.viewName = "XRAY"; s.scheilOn = true; s.scheilSamples = 25; s.fracSolid = 0.35; s.interfaceTC = 610.2;
      runner.tick();
      assert.equal(runner.getState().session.steps["pour-a356-scheil"].status, "completed");

      // 2.5 controlled-q-pair
      runner.nextStep();
      // Run A: fresh reset of A356
      s.inoculant = 600; s.params.coolRate = 0.2;
      host.clearMelt(0.90);
      s.nucFired = 35; s.grainCount = 30; s.fracSolid = 0.25; s.simTime = 1.4;
      runner.tick();
      assert(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, "Run A should latch");
      const effA = s.effUndercool;

      // Run B: pour Al-1.0Zn and reset at matched effUndercool
      s.pouredMix = { mix: alZnMix, derived: alZn };
      s.alloyName = alZn.name;
      s.params.mLiq = alZn.params.mLiq; s.params.c0 = alZn.params.c0;
      const uB = effA + s.params.mLiq * s.params.c0;
      host.clearMelt(uB);
      s.nucFired = 28; s.grainCount = 24; s.fracSolid = 0.25; s.simTime = 0.9;
      runner.tick();
      assert.equal(runner.getState().session.steps["controlled-q-pair"].status, "completed");
      assert.equal(runner.buildLabReport().stepsCompleted, 5);
    }

    // --- Lab 3 ---
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(3, { restart: true }));
      const s = host.snap;
      s.material = "al"; s.units = unitsFor("al");

      const mkPour = (overrides) => ({
        kind: "lab-pour-finished",
        dim: "2d",
        material: "al",
        setup: { program: "furnace", atmosphere: "argon", inoculant: 600, holdMin: 0, mold: "box", moldWalls: false },
        intervened: false,
        ta: { liquidus: { T: 0.9 }, nadir: { T: 0.84 }, recalR: 0.04 },
        census: { grainCount: 45, meanAreaPx: 900, meanVolVox: 4200 },
        sections: null,
        fired: 45,
        nMax: 600,
        effInoc: 600,
        fadeF: 1.0,
        dTmax: 0.16,
        porosity: { cLiquid: 0.45, cRejected: 0.41, pPore: 0.08 },
        csc: 0.32,
        umPerCell: 1,
        si: MATERIALS.al.si,
        ...overrides,
      });

      // 3.1 recalescence-ratchet
      runner.emit(mkPour({ setup: { program: "furnace", atmosphere: "argon", inoculant: 600, holdMin: 0, mold: "box", moldWalls: false } }));
      runner.emit(mkPour({ setup: { program: "quench", atmosphere: "argon", inoculant: 600, holdMin: 0, mold: "box", moldWalls: false } }));
      assert.equal(runner.getState().session.steps["recalescence-ratchet"].status, "completed");

      // 3.2 refiner-fade
      runner.nextStep();
      runner.emit(mkPour({ setup: { program: "air", atmosphere: "argon", inoculant: 600, holdMin: 45, mold: "box", moldWalls: false }, fadeF: 0.35, effInoc: 210, fired: 18 }));
      assert.equal(runner.getState().session.steps["refiner-fade"].status, "completed");

      // 3.3 step-block-3d
      runner.nextStep();
      s.mode = "3d";
      runner.emit(mkPour({
        dim: "3d",
        setup: { program: "air", atmosphere: "air", inoculant: 600, holdMin: 0, mold: "step", moldWalls: true },
        sections: [
          { heightVox: 16, census: { grainCount: 30, meanAreaPx: 0, meanVolVox: 1800 } },
          { heightVox: 32, census: { grainCount: 24, meanAreaPx: 0, meanVolVox: 3200 } },
          { heightVox: 48, census: { grainCount: 19, meanAreaPx: 0, meanVolVox: 5100 } },
          { heightVox: 64, census: { grainCount: 15, meanAreaPx: 0, meanVolVox: 7400 } },
        ],
      }));
      assert.equal(runner.getState().session.steps["step-block-3d"].status, "completed");

      // 3.4 stereology-bias
      runner.nextStep();
      s.labActive = false; s.viewName = "SLICE"; s.stereoOn = true;
      s.stereo = { n2: 18, d2Um: 24.5, d3Um: 30.1, ratio: 0.814, astmG2: 7.2 };
      s.sliceOff = 0.72; // entered at 0.50 -> delta 0.22 >= 0.08
      runner.tick();
      assert.equal(runner.getState().session.steps["stereology-bias"].status, "completed");

      // 3.5 steel-niyama
      runner.nextStep();
      s.material = "steel"; s.units = unitsFor("steel");
      runner.emit(mkPour({
        dim: "3d",
        material: "steel",
        si: MATERIALS.steel.si,
        setup: { program: "air", atmosphere: "air", inoculant: 400, holdMin: 0, mold: "wedge", moldWalls: true },
      }));
      s.labActive = false; s.viewName = "FIELD"; s.fracSolid = 0.95; runner.tick();
      s.viewName = "SLICE"; s.cutStyle = 5; s.poreFrac = 0.024; s.nyRiskFrac = 0.091; runner.tick();
      assert.equal(runner.getState().session.steps["steel-niyama"].status, "completed");
      assert.equal(runner.buildLabReport().stepsCompleted, 5);
    }

    // --- Lab 4 ---
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(4, { restart: true }));
      const s = host.snap;

      const mkHeat = (overrides) => ({
        kind: "heat-finished",
        dim: "2d",
        material: "al",
        tC: 200,
        holdMin: 120,
        pinF: 0,
        pinR: 0,
        d0Um: 30,
        dAfterUm: 30.2,
        dPredUm: 30.2,
        sigmaBefore: 33.4,
        sigmaAfter: 33.3,
        specMPa: 0,
        specMet: null,
        oxideNm: 2.1,
        sweeps: 5,
        aborted: false,
        twinsSpawned: 0,
        twinVerdictOk: false,
        twinRefusalWhy: "2D does not nucleate twins",
        ...overrides,
      });

      // 4.1 arrhenius-two-clocks
      runner.emit(mkHeat({ tC: 200, holdMin: 180 }));
      runner.emit(mkHeat({ tC: 560, holdMin: 480, dAfterUm: 48.5, dPredUm: 49.0, sigmaAfter: 29.8, sweeps: 4200 }));
      assert.equal(runner.getState().session.steps["arrhenius-two-clocks"].status, "completed");

      // 4.2 incipient-and-ceiling
      runner.nextStep();
      runner.emit({
        kind: "heat-plan", dim: "2d", material: "al", ok: false, reason: "incipient",
        specUnreachable: false, tC: 645, holdMin: 120, peakFracTm: 0.984, specMPa: 0, currentSigmaY: 33.0, dPredUm: null,
      });
      runner.emit({
        kind: "heat-plan", dim: "2d", material: "al", ok: true,
        specUnreachable: true, tC: 560, holdMin: 360, peakFracTm: 0.892, specMPa: 45, currentSigmaY: 33.0, dPredUm: 46.2,
      });
      assert.equal(runner.getState().session.steps["incipient-and-ceiling"].status, "completed");

      // 4.3 zener-spec-pass
      runner.nextStep();
      runner.emit(mkHeat({
        tC: 560, holdMin: 480, pinF: 0.04, pinR: 2, dLimUm: 34.0, d0Um: 30, dAfterUm: 33.5, dPredUm: 49.0,
        sigmaBefore: 33.4, sigmaAfter: 32.1, specMPa: 31, specMet: true,
      }));
      assert.equal(runner.getState().session.steps["zener-spec-pass"].status, "completed");

      // 4.4 cu-twins-3d
      runner.nextStep();
      s.mode = "3d"; s.material = "cu";
      runner.emit(mkHeat({
        dim: "3d", material: "cu", tC: 790, holdMin: 30, d0Um: 22, dAfterUm: 26.5, dPredUm: 26.8,
        twinsSpawned: 12, twinVerdictOk: true, twinRefusalWhy: "",
      }));
      assert.equal(runner.getState().session.steps["cu-twins-3d"].status, "completed");

      // 4.5 twin-refusal-3d
      runner.nextStep();
      s.material = "al";
      runner.emit(mkHeat({
        dim: "3d", material: "al", tC: 500, holdMin: 30, d0Um: 22, dAfterUm: 24.8, dPredUm: 25.0,
        twinsSpawned: 0, twinVerdictOk: false, twinRefusalWhy: "SFE 166 mJ/m² exceeds 80 mJ/m²",
      }));
      assert.equal(runner.getState().session.steps["twin-refusal-3d"].status, "completed");
      assert.equal(runner.buildLabReport().stepsCompleted, 5);
    }
  });

  // ----------------------------------------------------------- LAB-ANTI-CHEESE
  await check("LAB-ANTI-CHEESE", async () => {
    // 1. Lab 2.5: un-reset slider & stale Step 2.4 single-crystal latch rejected
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      await runner.startLab(2, { restart: true });
      const s = host.snap;
      const a356Mix = { base: "al", wt: { Si: 7.0, Mg: 0.35 } };
      const a356 = derive(a356Mix);
      const alZnMix = { base: "al", wt: { Zn: 1.0 } };
      const alZn = derive(alZnMix);
      s.material = "al"; s.units = unitsFor("al");
      s.pouredMix = { mix: a356Mix, derived: a356 };
      s.params.alloyOn = 1; s.params.mLiq = a356.params.mLiq; s.params.c0 = a356.params.c0;
      s.undercool = 0.90; s.lastResetUndercool = 0.90; s.effUndercool = 0.90 - s.params.mLiq * s.params.c0;
      s.fracSolid = 0.35; s.grainCount = 25; s.nucFired = 25;

      // Enter Step 2.5 at current resetEpoch -> dragging inoculant without reset MUST NOT latch Run A
      runner.selectStep(4);
      s.inoculant = 600;
      runner.tick();
      assert.equal(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, undefined,
        "stale Step 2.4 field without fresh reset must not latch Run A");

      // Fresh reset but single-crystal (grainCount=2, nucFired=1) MUST NOT latch Run A
      host.clearMelt(0.90);
      s.fracSolid = 0.25; s.grainCount = 2; s.nucFired = 1;
      runner.tick();
      assert.equal(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, undefined,
        "low-grain single crystal must not latch Run A");

      // Proper Run A
      s.grainCount = 30; s.nucFired = 35; s.fracSolid = 0.25;
      runner.tick();
      assert(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, "valid Run A latches");
      const effA = s.effUndercool;

      // Pour Al-1.0Zn (baked GPU at 0.90), move slider to target WITHOUT clicking reset -> MUST REJECT + warn
      s.pouredMix = { mix: alZnMix, derived: alZn };
      s.params.mLiq = alZn.params.mLiq; s.params.c0 = alZn.params.c0;
      host.clearMelt(0.90); // composer.pour bakes 0.90
      s.undercool = effA + s.params.mLiq * s.params.c0; // slider moved, GPU still 0.90!
      s.grainCount = 24; s.nucFired = 28; s.fracSolid = 0.25;
      runner.tick();
      assert.equal(runner.getState().session.steps["controlled-q-pair"].status, "pending",
        "un-reset undercooling slider must NOT pass Run B");
      assert.equal(runner.getState().liveHint, "undercooling changed: click reset to apply",
        "un-reset undercooling slider must emit reset warning hint");
    }

    // 2. Lab 1.4: unseeded calibrated melt hint & low-solid / small-delta-lambda rejection
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      await runner.startLab(1, { restart: true });
      const s = host.snap;
      runner.selectStep(3); // sdas-convergence
      s.mode = "2d"; s.calibrated = true; s.material = "al"; s.params.alloyOn = 1;
      s.fracSolid = 0; s.inoculant = 0; s.lambda = 30;
      runner.tick();
      assert.equal(runner.getState().liveHint, "melt has no seeds yet: click seed or tap canvas");

      // Valid Event A at lambda=30, fracSolid=0.20
      s.fracSolid = 0.20;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 12.0, arms: 4, lenUm: 48.0 });
      assert(runner.getState().session.steps["sdas-convergence"].subgoals.runA);

      // Reject Event B with fracSolid < 0.15
      s.lambda = 20; s.fracSolid = 0.09;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 11.8, arms: 4, lenUm: 47.2 });
      assert.equal(runner.getState().session.steps["sdas-convergence"].status, "pending",
        "Event B with fracSolid < 0.15 must be rejected");

      // Reject Event B with |delta lambda| < 8
      s.lambda = 26; s.fracSolid = 0.20;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 11.9, arms: 4, lenUm: 47.6 });
      assert.equal(runner.getState().session.steps["sdas-convergence"].status, "pending",
        "Event B with |Δλ| < 8 must be rejected");
    }

    // 3. Lab 4.4 & 4.5: real 96³ GPU domain-limit safety & twin verdict physics from src/heattreat.ts
    {
      const umPerCell = 1000 / 1024;
      const limit96 = HT.domainLimitUm(96, umPerCell);
      assert(limit96 > 31 && limit96 < 33, `expected 96³ domain limit ~32.06 µm, got ${limit96}`);

      const checkSafe = (matKey, tC, holdMin, d0Um) => {
        const si = MATERIALS[matKey].si;
        const sch = { name: "test", stages: [{ kind: "hold", tC, min: holdMin }] };
        const integ = HT.integrate(sch, si);
        const dAfterUm = HT.grainAfter(d0Um * 1e-6, integ.gg, si) * 1e6;
        assert(dAfterUm < limit96, `${matKey} ${tC}°C/${holdMin}min from ${d0Um}µm -> ${dAfterUm.toFixed(2)}µm exceeds 96³ limit ${limit96.toFixed(2)}µm`);
      };
      checkSafe("cu", 790, 30, 22);
      checkSafe("cu", 800, 30, 22);
      checkSafe("al", 500, 30, 22);
      checkSafe("steel", 900, 30, 22);

      // Verify twin verdicts in 3D via real canTreat("twins", ...)
      const ctx = (matKey) => ({
        dim: "3d", key: matKey, si: MATERIALS[matKey].si, alloy: true,
        cubic: true, solidFraction: 0.95,
      });
      assert.equal(HT.canTreat("twins", ctx("cu")).ok, true, "3D Cu must admit twins");
      assert.equal(HT.canTreat("twins", ctx("al")).ok, false, "3D Al must refuse twins (high SFE)");
      assert.equal(HT.canTreat("twins", ctx("steel")).ok, false, "3D steel must refuse twins (BCC)");
    }

    // 4. Lab 3: intervened pour is rejected and flips anyIntervened flag
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      await runner.startLab(3, { restart: true });
      runner.emit({
        kind: "lab-pour-finished", dim: "2d", material: "al",
        setup: { program: "furnace", atmosphere: "argon", inoculant: 600, holdMin: 0, mold: "box", moldWalls: false },
        intervened: true, ta: {}, census: null, sections: null,
        fired: 10, nMax: 600, effInoc: 600, fadeF: 1, dTmax: 0.1, porosity: null, csc: null, umPerCell: 1, si: MATERIALS.al.si,
      });
      assert.equal(runner.getState().session.steps["recalescence-ratchet"].subgoals.furnace, undefined,
        "intervened pour must not satisfy Lab 3.1");
      assert.equal(runner.getState().session.anyIntervened, true, "anyIntervened flag must be recorded");
    }
  });

  // ------------------------------------------------------- LAB-SKIP-AND-REPORT
  await check("LAB-SKIP-AND-REPORT", async () => {
    const host = makeMockHost();
    const runner = new GuidedLabRunner(host);
    // Inactive runner returns null report so standard Run Export stays byte-identical
    assert.equal(runner.buildLabReport(), null);

    await runner.startLab(3, { restart: true });
    // Skip step 0 as "user" -> status "skipped", never "completed", advances to step 1
    runner.skipStep("user");
    const stAfterUserSkip = runner.getState();
    assert.equal(stAfterUserSkip.session.steps["recalescence-ratchet"].status, "skipped");
    assert.equal(stAfterUserSkip.session.steps["recalescence-ratchet"].skipReason, "user");
    assert.equal(stAfterUserSkip.activeStepIndex, 1);

    // Complete step 1 cleanly, then skip step 2 as "no-3d"
    runner.emit({
      kind: "lab-pour-finished", dim: "2d", material: "al",
      setup: { program: "air", atmosphere: "argon", inoculant: 600, holdMin: 50, mold: "box", moldWalls: false },
      intervened: false, ta: {}, census: { grainCount: 20, meanAreaPx: 1200 }, sections: null,
      fired: 20, nMax: 600, effInoc: 200, fadeF: 0.33, dTmax: 0.12, porosity: null, csc: null, umPerCell: 1, si: MATERIALS.al.si,
    });
    assert.equal(runner.getState().session.steps["refiner-fade"].status, "completed");

    runner.selectStep(2);
    runner.skipStep("no-3d");
    assert.equal(runner.getState().session.steps["step-block-3d"].status, "skipped");
    assert.equal(runner.getState().session.steps["step-block-3d"].skipReason, "no-3d");

    // resetCurrentStep clears ONLY active step, preserving step 1's completion
    runner.selectStep(2);
    runner.resetCurrentStep();
    assert.equal(runner.getState().session.steps["step-block-3d"].status, "pending");
    assert.equal(runner.getState().session.steps["refiner-fade"].status, "completed");

    // Re-skip step 2 and validate report JSON round-trip
    runner.skipStep("no-3d");
    const report = runner.buildLabReport();
    assert(report !== null);
    const roundTrip = JSON.parse(JSON.stringify(report));
    assert.equal(roundTrip.format, "solidify-lab-report");
    assert.equal(roundTrip.version, 1);
    assert.equal(roundTrip.labId, "lab-3");
    assert.equal(roundTrip.hashId, 3);
    assert.equal(roundTrip.stepsCompleted, 1);
    assert.equal(roundTrip.stepsSkipped, 2);
    assert.equal(roundTrip.stepsTotal, 5);
    assert.equal(roundTrip.steps.length, 5);
    assert.equal(roundTrip.steps[0].status, "skipped");
    assert.equal(roundTrip.steps[0].skipReason, "user");
    assert.equal(roundTrip.steps[1].status, "completed");
    assert.equal(roundTrip.steps[2].status, "skipped");
    assert.equal(roundTrip.steps[2].skipReason, "no-3d");

    runner.closeLab();
    assert.equal(runner.isActive(), false);
    assert.equal(runner.buildLabReport(), null);
  });
} finally {
  await server.close();
}

console.log(failed ? `done — ${failed} FAILED` : "done — all guided-labs checks passed");
process.exitCode = failed ? 1 : 0;
