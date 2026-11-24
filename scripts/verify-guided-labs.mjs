/**
 * verify-guided-labs.mjs — browser-free CI verification for SOLIDIFY v8.6 Guided Labs.
 *
 * Six checks:
 *   LAB-SCHEMA           9 labs, 40 steps, unique IDs, valid setup & predicates, dynamic #lab=N routes
 *   LAB-COPY             zero prose em dashes, American spelling, exact control/lens casing across all 9 labs
 *   LAB-TRAJECTORIES     deterministic pass trajectories for all 40 steps across Labs 1–9
 *   LAB-ANTI-CHEESE      rejects un-reset undercooling, stale latches, unseeded melts, 96³/128³/192³ bounds, Labs 5–9 guards
 *   LAB-SKIP-AND-REPORT  skip status semantics, single-step reset, solidify-lab-report v1 round-trip
 *   LAB-REPORT-HTML      formatLabReportHtml() light-mode print CSS, achromatic palette, XSS & unsafe-URL escaping
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
  const { GuidedLabRunner, formatLabReportHtml } = await server.ssrLoadModule("/src/labs/runner.ts");
  const { parseLabRoute } = await server.ssrLoadModule("/src/share.ts");
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
      astm: null,
      eqDiamUm: null,
      simTime: 0,
      interfaceTC: null,
      scheilOn: false,
      scheilSamples: 0,
      stereoOn: false,
      stereo: null,
      nyRiskFrac: null,
      poreFrac: null,
      pouredMix: null,
      flowOn: false,
      flowSpeed: 0,
      flowView: false,
      bridgmanG: 0.12,
      bridgmanV: 1.8,
      poleFigureOn: false,
      pole001On: false,
      presetId: null,
      labActive: false,
      labRunning: false,
      heatActive: false,
      challengeActive: false,
      optActive: false,
      recipeActive: false,
      composerOpen: false,
      running: false,
      eutectic: null,
      spinodal: null,
      ...initial,
    };

    const host = {
      calls,
      snap,
      snapshot() { return snap; },
      meta() { return { build: "test-build", seed: 1337, setupLink: "https://example.test/app/#lab=1" }; },
      applyScene(name) {
        snap.presetId = name;
        if (name === "bridgman") snap.params.scen = 1;
        else if (name === "selector") snap.params.scen = 3;
        else if (name === "dendrite" || name === "rain" || name === "alloy") snap.params.scen = 0;
        calls.push(["applyScene", name]);
      },
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
      setFlowOn(on) { snap.flowOn = on; calls.push(["setFlowOn", on]); },
      closeModes() {
        snap.labActive = false;
        snap.heatActive = false;
        snap.challengeActive = false;
        snap.optActive = false;
        snap.composerOpen = false;
        snap.eutectic = null;
        snap.spinodal = null;
        calls.push(["closeModes"]);
      },
      startEutectic(alloy = "alcu") {
        snap.spinodal = null;
        snap.eutectic = {
          open: true,
          running: true,
          alloy,
          lens: 0,
          pullV: 20,
          c0Off: 0,
          seedPairs: 6,
          step: 0,
          lambdaUm: null,
          lambdaMinUm: 2.1,
          dTFrontK: 0,
          fAlpha: 0.5,
          fAlphaLever: 0.5,
          maxSimplexErr: 0,
        };
        calls.push(["startEutectic", alloy]);
      },
      startSpinodal(preset = "pfhub1", dim = "2d") {
        snap.eutectic = null;
        snap.spinodal = {
          open: true,
          running: true,
          preset,
          dim,
          lens: 0,
          c0: 0.5,
          step: 0,
          simTime: 0,
          freeEnergy: 320,
          initialFreeEnergy: 320,
          meanC: 0.5,
          massDrift: 0,
          domainL: 4.0,
          lswSlope: null,
        };
        calls.push(["startSpinodal", preset, dim]);
      },
      syncUI() { calls.push(["syncUI"]); },
      reveal(target) { calls.push(["reveal", target]); },
      clearReveals() { calls.push(["clearReveals"]); },
      onLabChange(id) { calls.push(["onLabChange", id]); },
    };
    return host;
  }

  // ----------------------------------------------------------------- LAB-SCHEMA
  await check("LAB-SCHEMA", async () => {
    assert.equal(LABS.length, 9, "expected 9 labs");
    const labIds = new Set();
    const stepIds = new Set();
    const VALID_CATS = new Set(["2D", "TRUE 3D", "HEAT TREAT", "ENGINES"]);
    const VALID_DIMS = new Set(["2D", "3D", "2D + 3D"]);
    const expectedCounts = {
      "lab-1": 5, "lab-2": 5, "lab-3": 5, "lab-4": 5,
      "lab-5": 4, "lab-6": 4, "lab-7": 4,
      "eutectic-jh": 4, "spinodal-lsw": 4,
    };
    assert.deepEqual(LABS.map(l => l.hashId), [1, 2, 3, 4, 5, 6, 7, 8, 9], "hashIds must be 1..9");
    assert.deepEqual(LABS.map(l => l.number), ["01", "02", "03", "04", "05", "06", "07", "08", "09"], "numbers must be 01..09");

    for (const lab of LABS) {
      assert(!labIds.has(lab.id), `duplicate lab id ${lab.id}`);
      labIds.add(lab.id);
      assert.equal(findLabDef(lab.hashId)?.id, lab.id);
      assert.equal(findLabDef(lab.id)?.id, lab.id);
      assert.equal(lab.steps.length, expectedCounts[lab.id], `${lab.id} step count mismatch`);
      assert.equal(lab.columns.length, 3, `${lab.id} must have 3 table columns`);
      assert(VALID_CATS.has(lab.category), `${lab.id} invalid category ${lab.category}`);
      assert(VALID_DIMS.has(lab.dimension), `${lab.id} invalid dimension ${lab.dimension}`);
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

      const host = makeMockHost({ can3d: true });
      await lab.setup(host);
      assert(host.calls.some(c => c[0] === "closeModes"), `${lab.id} setup calls closeModes`);
      if (lab.id === "lab-5") {
        assert(host.calls.some(c => c[0] === "setMode" && c[1] === "3d"), "lab-5 setup enters 3d when can3d=true");
        const hostNo3d = makeMockHost({ can3d: false });
        await lab.setup(hostNo3d);
        assert(hostNo3d.calls.some(c => c[0] === "setMode" && c[1] === "2d"), "lab-5 setup falls back to 2d when can3d=false");
        assert(hostNo3d.calls.some(c => c[0] === "syncUI"), "lab-5 fallback setup calls syncUI");
      } else {
        assert(host.calls.some(c => c[0] === "setMode" && c[1] === "2d"), `${lab.id} setup enters 2d`);
      }
      if (lab.id === "eutectic-jh") {
        assert(host.calls.some(c => c[0] === "startEutectic" && c[1] === "alcu"), "lab 8 setup launches eutectic alcu");
        assert.equal(host.snap.eutectic?.open, true);
      } else if (lab.id === "spinodal-lsw") {
        assert(host.calls.some(c => c[0] === "startSpinodal" && c[1] === "pfhub1" && c[2] === "2d"), "lab 9 setup launches spinodal pfhub1 2d");
        assert.equal(host.snap.spinodal?.open, true);
      }
      assert(host.calls.some(c => c[0] === "syncUI"), `${lab.id} setup calls syncUI`);
    }

    assert.equal(stepIds.size, 40, "expected 40 total steps across 9 labs");
    assert.equal(findLabDef(0), null);
    assert.equal(findLabDef(8)?.id, "eutectic-jh");
    assert.equal(findLabDef(9)?.id, "spinodal-lsw");
    assert.equal(findLabDef(10), null);
    assert.equal(findLabDef(""), null);
    assert.equal(findLabDef("nonexistent"), null);

    // Switching across engine labs & back to Solidification clears stale engine state
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      await runner.startLab(8, { restart: true });
      assert.equal(host.snap.eutectic?.open, true);
      assert.equal(host.snap.spinodal, null);
      await runner.startLab(9, { restart: true });
      assert.equal(host.snap.eutectic, null);
      assert.equal(host.snap.spinodal?.open, true);
      await runner.startLab(1, { restart: true });
      assert.equal(host.snap.eutectic, null);
      assert.equal(host.snap.spinodal, null);
      // Even with applySetup: false, startLab still stages Lab 8/9 engines and closes stale engines for Labs 1–7
      await runner.startLab(8, { applySetup: false });
      assert.equal(host.snap.eutectic?.open, true);
      await runner.startLab(9, { applySetup: false });
      assert.equal(host.snap.spinodal?.open, true);
      await runner.startLab(1, { applySetup: false });
      assert.equal(host.snap.spinodal, null);
    }

    // Dynamic #lab=N routing in src/share.ts
    assert.deepEqual(parseLabRoute("#labs"), { kind: "picker" });
    assert.deepEqual(parseLabRoute("#lab=1"), { kind: "lab", ref: 1 });
    assert.deepEqual(parseLabRoute("#lab=5"), { kind: "lab", ref: 5 });
    assert.deepEqual(parseLabRoute("#lab=6"), { kind: "lab", ref: 6 });
    assert.deepEqual(parseLabRoute("#lab=7"), { kind: "lab", ref: 7 });
    assert.deepEqual(parseLabRoute("#lab=8"), { kind: "lab", ref: 8 });
    assert.deepEqual(parseLabRoute("#lab=9"), { kind: "lab", ref: 9 });
    assert.deepEqual(parseLabRoute("#lab=12"), { kind: "lab", ref: 12 });
    assert.deepEqual(parseLabRoute("", "?lab=8"), { kind: "lab", ref: 8 });
    assert.deepEqual(parseLabRoute("#set=abc123&lab=9"), { kind: "lab", ref: 9 });
    assert.deepEqual(parseLabRoute("#lab=eutectic-jh"), { kind: "lab", ref: "eutectic-jh" });
    assert.deepEqual(parseLabRoute("#lab=spinodal-lsw"), { kind: "lab", ref: "spinodal-lsw" });
    assert.deepEqual(parseLabRoute("#lab=lab-5"), { kind: "lab", ref: "lab-5" });
    // Out-of-range numeric strings pass through as slug refs that resolve to null in findLabDef
    // so main.ts can open the picker with a helpful notice instead of silently dropping the link.
    assert.equal(findLabDef(parseLabRoute("#lab=0")?.ref ?? ""), null, "lab=0 must not resolve to a lab");
    assert.equal(findLabDef(parseLabRoute("#lab=-3")?.ref ?? ""), null, "negative lab must not resolve to a lab");
    assert.equal(parseLabRoute("#lab="), null, "empty lab= must return null");
    assert.equal(parseLabRoute("#lab=bad/path"), null, "invalid slug chars must return null");
    assert.equal(parseLabRoute("#set=abc123"), null, "plain #set= must not route to lab");
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
    const baseSnap = makeMockHost().snap;
    const emptyMem = { enteredAtEpoch: 0, enteredSliceOff: 0.5, visitedLenses: [], visitedLensesSolid: [], latched: {} };

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
        if (st.liveHint) {
          audit(`${lab.id}.${st.id}.hint2d`, st.liveHint(baseSnap, emptyMem));
          audit(`${lab.id}.${st.id}.hint3d`, st.liveHint({ ...baseSnap, mode: "3d" }, emptyMem));
          audit(`${lab.id}.${st.id}.hintEut`, st.liveHint({
            ...baseSnap,
            eutectic: { open: true, running: false, alloy: "alcu", lens: 0, pullV: 20, c0Off: 0, seedPairs: 6, step: 120, lambdaUm: null, lambdaMinUm: 2.1, dTFrontK: 0.4, fAlpha: 0.5, fAlphaLever: 0.5, maxSimplexErr: 1e-6 },
          }, emptyMem));
          audit(`${lab.id}.${st.id}.hintSpin`, st.liveHint({
            ...baseSnap,
            spinodal: { open: true, running: false, preset: "pfhub1", dim: "2d", lens: 0, c0: 0.5, step: 100, simTime: 4, freeEnergy: 300, initialFreeEnergy: 320, meanC: 0.5, massDrift: 0, domainL: 5.2, lswSlope: null },
          }, emptyMem));
        }
      }
      for (const row of lab.formatRows({})) {
        audit(`${lab.id}.row.label`, row.label);
        for (const [k, v] of Object.entries(row.values)) {
          if (typeof v === "string") audit(`${lab.id}.row.${k}`, v, true);
        }
      }
    }

    // Exact on-screen control casing & model honesty checks
    const lab4 = findLabDef(4);
    const step43 = lab4.steps.find(s => s.id === "zener-spec-pass");
    assert(step43.action.includes("exit"), "Lab 4.3 must refer to 'exit', not 'Close heat treat'");
    assert(!/close heat treat/i.test(step43.action), "Lab 4.3 must not say 'Close heat treat'");

    const lab5 = findLabDef(5);
    assert(lab5.steps[0].action.includes("heat treat") && lab5.steps[0].action.includes("cold work"));
    assert(lab5.steps[1].action.includes("▶ run treatment"));
    assert(lab5.steps[2].action.includes("random, at once") && lab5.steps[2].action.includes("nucleation"));
    assert(lab5.steps[3].action.includes("random, steady") && lab5.steps[3].action.includes("boundaries, at once"));
    assert(lab5.steps[2].takeaway.includes("Monte Carlo sweep clock"), "Lab 5.3 must cite Monte Carlo sweep clock");

    const lab6 = findLabDef(6);
    assert(lab6.steps[0].action.includes("bridgman") && lab6.steps[0].action.includes("gradient") && lab6.steps[0].action.includes("pull speed"));
    assert(lab6.steps[1].action.includes("melt flow") && lab6.steps[1].action.includes("flow speed") && lab6.steps[1].action.includes("show flow"));
    assert(/qualitative/i.test(lab6.steps[1].takeaway), "Lab 6.2 must explicitly note qualitative 2D LBM caveat");
    assert(lab6.steps[2].action.includes("TRUE 3D") && lab6.steps[2].action.includes("selector"));
    assert(/without guaranteeing a single/i.test(lab6.steps[2].takeaway), "Lab 6.3 must stay honest about selector single-grain non-guarantee");
    assert(lab6.steps[3].action.includes("pole figure [001]") && lab6.steps[3].action.includes("SLICE") && lab6.steps[3].action.includes("SECTION PLANE"));

    const lab7 = findLabDef(7);
    assert(lab7.steps[0].action.includes("challenge") && lab7.steps[0].action.includes("▶ start"));
    assert(lab7.steps[1].action.includes("optimizer") && lab7.steps[1].action.includes("OPTIMIZER"));
    assert(lab7.steps[2].action.includes("apply recipe"));
    assert(lab7.steps[3].action.includes("TRUE 3D") && lab7.steps[3].action.includes("calibrated solver") && lab7.steps[3].action.includes("casting budget"));

    const lab8 = findLabDef(8);
    assert(lab8.steps[0].action.includes("EUTECTIC") && lab8.steps[0].action.includes("PHASES") && lab8.steps[0].action.includes("Al–Cu"));
    assert(lab8.steps[1].action.includes("SOLUTE"));
    assert(lab8.steps[2].action.includes("seed pairs") && lab8.steps[2].action.includes("Jackson–Hunt"));
    assert(lab8.steps[3].action.includes("composition c₀"));

    const lab9 = findLabDef(9);
    assert(lab9.steps[0].action.includes("NIST PFHub B1") && lab9.steps[0].action.includes("SPINODAL") && lab9.steps[0].action.includes("COMP"));
    assert(lab9.steps[1].action.includes("CHEM μ"));
    assert(lab9.steps[2].action.includes("Fe–Cr (475 °C)") && lab9.steps[2].action.includes("Al–Zn"));
    assert(lab9.steps[3].action.includes("3D") && lab9.steps[3].action.includes("ISO 3D") && lab9.steps[3].action.includes("SLICE") && lab9.steps[3].action.includes("VOL"));

    assert.deepEqual(issues, [], `copy violations:\n${issues.join("\n")}`);
  });

  // ----------------------------------------------------------- LAB-TRAJECTORIES
  const completedReports = [];
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
      completedReports.push(rep);
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

      runner.emit({ kind: "composer-mix-viewed", base: "al", wt: a356Mix.wt, derived: a356 });
      runner.emit({ kind: "composer-mix-viewed", base: "mg", wt: az91Mix.wt, derived: az91 });
      runner.emit({ kind: "composer-mix-viewed", base: "fe", wt: s1045Mix.wt, derived: s1045 });
      assert.equal(runner.getState().session.steps["eutectic-peritectic-audit"].status, "completed");

      runner.nextStep();
      runner.emit({ kind: "composer-picked", base: "al", el: "Bi", admission: admit("al", "Bi", 1) });
      runner.emit({ kind: "composer-picked", base: "fe", el: "Zn", admission: admit("fe", "Zn", 1) });
      assert.equal(runner.getState().session.steps["screen-demix-and-vapor"].status, "completed");

      runner.nextStep();
      runner.emit({ kind: "composer-picked", base: "fe", el: "C", admission: admit("fe", "C", 0.45) });
      runner.emit({ kind: "composer-picked", base: "cu", el: "Zn", admission: admit("cu", "Zn", 30) });
      assert.equal(runner.getState().session.steps["hagg-and-brass-advisory"].status, "completed");

      runner.nextStep();
      s.pouredMix = { mix: a356Mix, derived: a356 };
      s.alloyName = a356.name;
      s.params.alloyOn = 1; s.params.mLiq = a356.params.mLiq; s.params.c0 = a356.params.c0;
      s.viewName = "XRAY"; s.scheilOn = true; s.scheilSamples = 25; s.fracSolid = 0.35; s.interfaceTC = 610.2;
      runner.tick();
      assert.equal(runner.getState().session.steps["pour-a356-scheil"].status, "completed");

      runner.nextStep();
      s.inoculant = 600; s.params.coolRate = 0.2;
      host.clearMelt(0.90);
      s.nucFired = 35; s.grainCount = 30; s.fracSolid = 0.25; s.simTime = 1.4;
      runner.tick();
      assert(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, "Run A should latch");
      const effA = s.effUndercool;

      s.pouredMix = { mix: alZnMix, derived: alZn };
      s.alloyName = alZn.name;
      s.params.mLiq = alZn.params.mLiq; s.params.c0 = alZn.params.c0;
      const uB = effA + s.params.mLiq * s.params.c0;
      host.clearMelt(uB);
      s.nucFired = 28; s.grainCount = 24; s.fracSolid = 0.25; s.simTime = 0.9;
      runner.tick();
      assert.equal(runner.getState().session.steps["controlled-q-pair"].status, "completed");
      const rep = runner.buildLabReport();
      assert.equal(rep.stepsCompleted, 5);
      completedReports.push(rep);
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

      runner.emit(mkPour({ setup: { program: "furnace", atmosphere: "argon", inoculant: 600, holdMin: 0, mold: "box", moldWalls: false } }));
      runner.emit(mkPour({ setup: { program: "quench", atmosphere: "argon", inoculant: 600, holdMin: 0, mold: "box", moldWalls: false } }));
      assert.equal(runner.getState().session.steps["recalescence-ratchet"].status, "completed");

      runner.nextStep();
      runner.emit(mkPour({ setup: { program: "air", atmosphere: "argon", inoculant: 600, holdMin: 45, mold: "box", moldWalls: false }, fadeF: 0.35, effInoc: 210, fired: 18 }));
      assert.equal(runner.getState().session.steps["refiner-fade"].status, "completed");

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

      runner.nextStep();
      s.labActive = false; s.viewName = "SLICE"; s.stereoOn = true;
      s.stereo = { n2: 18, d2Um: 24.5, d3Um: 30.1, ratio: 0.814, astmG2: 7.2 };
      s.sliceOff = 0.72;
      runner.tick();
      assert.equal(runner.getState().session.steps["stereology-bias"].status, "completed");

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
      const rep = runner.buildLabReport();
      assert.equal(rep.stepsCompleted, 5);
      completedReports.push(rep);
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

      runner.emit(mkHeat({ tC: 200, holdMin: 180 }));
      runner.emit(mkHeat({ tC: 560, holdMin: 480, dAfterUm: 48.5, dPredUm: 49.0, sigmaAfter: 29.8, sweeps: 4200 }));
      assert.equal(runner.getState().session.steps["arrhenius-two-clocks"].status, "completed");

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

      runner.nextStep();
      runner.emit(mkHeat({
        tC: 560, holdMin: 480, pinF: 0.04, pinR: 2, dLimUm: 34.0, d0Um: 30, dAfterUm: 33.5, dPredUm: 49.0,
        sigmaBefore: 33.4, sigmaAfter: 32.1, specMPa: 31, specMet: true,
      }));
      assert.equal(runner.getState().session.steps["zener-spec-pass"].status, "completed");

      runner.nextStep();
      s.mode = "3d"; s.material = "cu";
      runner.emit(mkHeat({
        dim: "3d", material: "cu", tC: 790, holdMin: 30, d0Um: 22, dAfterUm: 26.5, dPredUm: 26.8,
        twinsSpawned: 12, twinVerdictOk: true, twinRefusalWhy: "",
      }));
      assert.equal(runner.getState().session.steps["cu-twins-3d"].status, "completed");

      runner.nextStep();
      s.material = "al";
      runner.emit(mkHeat({
        dim: "3d", material: "al", tC: 500, holdMin: 30, d0Um: 22, dAfterUm: 24.8, dPredUm: 25.0,
        twinsSpawned: 0, twinVerdictOk: false, twinRefusalWhy: "SFE 166 mJ/m² exceeds 80 mJ/m²",
      }));
      assert.equal(runner.getState().session.steps["twin-refusal-3d"].status, "completed");
      const rep = runner.buildLabReport();
      assert.equal(rep.stepsCompleted, 5);
      completedReports.push(rep);
    }

    // --- Lab 5: Cold Work, Recovery & Recrystallization (3D) ---
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(5, { restart: true }));
      const s = host.snap;
      assert.equal(s.mode, "3d", "Lab 5 starts in 3D when available");
      s.fracSolid = 0.94;
      s.heatActive = true;

      const mkHeat3d = (overrides) => ({
        kind: "heat-finished",
        dim: "3d",
        material: "al",
        tC: 510,
        holdMin: 60,
        pinF: 0,
        pinR: 0,
        d0Um: 18.0,
        dAfterUm: 21.5,
        dPredUm: 24.0,
        sigmaBefore: 36.0,
        sigmaAfter: 34.7,
        specMPa: 0,
        specMet: null,
        oxideNm: 2.3,
        sweeps: 220,
        aborted: false,
        twinsSpawned: 0,
        twinVerdictOk: false,
        twinRefusalWhy: "held back under cold work",
        coldWorkJb: 2.0,
        recovery: 0.22,
        recoveredMeanJb: HT.recoveredMeanUniform(2.0, 0.22),
        recoveredPeakJb: HT.recovered(4.0, 0.22),
        lawWithdrawn: true,
        rxNuclei: 0,
        rxPlaced: 0,
        rxMode: 0,
        rxFraction: null,
        avramiN: null,
        avramiR2: null,
        avramiPoints: null,
        sibmShareDelta: null,
        ...overrides,
      });

      // 5.1 cold-work-barrier
      runner.emit(mkHeat3d({ coldWorkJb: 2.0, sweeps: 120, recovery: 0.12, dAfterUm: 18.4 }));
      assert(runner.getState().session.steps["cold-work-barrier"].subgoals.subBarrier, "5.1 subBarrier latches");
      runner.emit(mkHeat3d({ coldWorkJb: 7.0, sweeps: 140, recovery: 0.14, dAfterUm: 22.8 }));
      assert.equal(runner.getState().session.steps["cold-work-barrier"].status, "completed");

      // 5.2 recovery-withdrawal
      runner.nextStep();
      runner.emit(mkHeat3d({
        tC: 515, holdMin: 75, coldWorkJb: 9.0, sweeps: 320, recovery: 0.32,
        recoveredMeanJb: HT.recoveredMeanUniform(9.0, 0.32),
        recoveredPeakJb: HT.recovered(18.0, 0.32),
        lawWithdrawn: true,
      }));
      assert.equal(runner.getState().session.steps["recovery-withdrawal"].status, "completed");

      // 5.3 rx-site-saturated
      runner.nextStep();
      runner.emit(mkHeat3d({
        coldWorkJb: 9.0, sweeps: 320, recovery: 0.32,
        rxNuclei: 250, rxPlaced: 244, rxMode: 0, rxFraction: 0.91,
        avramiN: 2.74, avramiR2: 0.992, avramiPoints: 10,
      }));
      assert.equal(runner.getState().session.steps["rx-site-saturated"].status, "completed");

      // 5.4 rx-mode-contrast (random, steady vs boundaries, at once)
      runner.nextStep();
      runner.emit(mkHeat3d({
        coldWorkJb: 9.0, sweeps: 320, recovery: 0.32,
        rxNuclei: 250, rxPlaced: 238, rxMode: 1, rxFraction: 0.87,
        avramiN: 3.41, avramiR2: 0.989, avramiPoints: 9,
      }));
      assert(runner.getState().session.steps["rx-mode-contrast"].subgoals.steady, "5.4 steady latches");
      runner.emit(mkHeat3d({
        coldWorkJb: 9.0, sweeps: 320, recovery: 0.32,
        rxNuclei: 250, rxPlaced: 241, rxMode: 2, rxFraction: 0.89,
        avramiN: 2.15, avramiR2: 0.985, avramiPoints: 8,
      }));
      assert.equal(runner.getState().session.steps["rx-mode-contrast"].status, "completed");

      // Also verify rxMode: 3 (boundaries, steady) satisfies boundary subgoal on reset
      runner.resetCurrentStep();
      runner.emit(mkHeat3d({
        coldWorkJb: 9.0, sweeps: 320, recovery: 0.32,
        rxNuclei: 250, rxPlaced: 235, rxMode: 3, rxFraction: 0.84,
        avramiN: 2.55, avramiR2: 0.981, avramiPoints: 8,
      }));
      assert(runner.getState().session.steps["rx-mode-contrast"].subgoals.boundary, "5.4 rxMode=3 latches boundary");
      runner.emit(mkHeat3d({
        coldWorkJb: 9.0, sweeps: 320, recovery: 0.32,
        rxNuclei: 250, rxPlaced: 238, rxMode: 1, rxFraction: 0.87,
        avramiN: 3.41, avramiR2: 0.989, avramiPoints: 9,
      }));
      assert.equal(runner.getState().session.steps["rx-mode-contrast"].status, "completed");

      const rep = runner.buildLabReport();
      assert.equal(rep.stepsCompleted, 4);
      assert.equal(rep.stepsTotal, 4);
      assert.equal(rep.table.length, 6);
      assert(rep.completedAt !== null);
      completedReports.push(rep);
    }

    // --- Lab 6: Directional Growth, Melt Flow & Selection ---
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(6, { restart: true }));
      const s = host.snap;

      // 6.1 bridgman-gv-contrast
      s.mode = "2d"; s.params.scen = 1;
      s.bridgmanG = 0.16; s.bridgmanV = 1.0; s.fracSolid = 0.30; s.grainCount = 14;
      runner.tick();
      assert(runner.getState().session.steps["bridgman-gv-contrast"].subgoals.highGV, "6.1 highGV latches");

      host.clearMelt(0.75);
      s.bridgmanG = 0.06; s.bridgmanV = 4.0; s.fracSolid = 0.31; s.grainCount = 19;
      runner.tick();
      assert.equal(runner.getState().session.steps["bridgman-gv-contrast"].status, "completed");

      // 6.2 lbm-melt-flow
      runner.nextStep();
      host.applyScene("dendrite");
      host.clearMelt(0.8);
      s.flowOn = false; s.flowSpeed = 0; s.fracSolid = 0.14; s.simTime = 0.95;
      runner.tick();
      assert(runner.getState().session.steps["lbm-melt-flow"].subgoals.still, "6.2 still latches");

      host.clearMelt(0.8);
      s.flowOn = true; s.flowSpeed = 0.03; s.flowView = true; s.fracSolid = 0.15; s.simTime = 0.82;
      runner.tick();
      assert.equal(runner.getState().session.steps["lbm-melt-flow"].status, "completed");

      // 6.3 selector-3d-staging
      runner.nextStep();
      s.mode = "3d"; s.gridN = 128; s.params.scen = 3; s.bridgmanG = 0.45; s.bridgmanV = 1.8;
      s.fracSolid = 0.14; s.grainCount = 26; s.simTime = 1.1;
      runner.tick();
      assert.equal(runner.getState().session.steps["selector-3d-staging"].status, "completed");

      // 6.4 selector-pole-figure
      runner.nextStep();
      s.fracSolid = 0.19; s.pole001On = true; s.poleFigureOn = true; s.viewName = "SLICE"; s.sliceOff = 0.68;
      runner.tick();
      assert.equal(runner.getState().session.steps["selector-pole-figure"].status, "completed");

      const rep = runner.buildLabReport();
      assert.equal(rep.stepsCompleted, 4);
      assert.equal(rep.stepsTotal, 4);
      assert.equal(rep.table.length, 6);
      assert(rep.completedAt !== null);
      completedReports.push(rep);
    }

    // --- Lab 7: Inverse Process Design & Optimization ---
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(7, { restart: true }));
      const s = host.snap;

      // 7.1 challenge-human-vs-cmaes
      s.challengeActive = true;
      runner.emit({
        kind: "challenge-finished",
        targetG: 4.0,
        playerG: 3.3,
        playerScore: 0.7,
        aiG: 4.08,
        aiScore: 0.08,
        youWin: false,
      });
      assert.equal(runner.getState().session.steps["challenge-human-vs-cmaes"].status, "completed");

      // 7.2 opt-2d-cmaes
      runner.nextStep();
      s.challengeActive = false; s.optActive = true; s.running = true;
      runner.emit({
        kind: "opt-2d-finished",
        targetG: 4.0,
        episodes: 18,
        bestG: 3.96,
        bestError: 0.04,
        converged: true,
        recipe: { undercool: 0.74, nmax: 420, cool: [0.18, 0.24, 0.30], astm: 3.96 },
      });
      assert.equal(runner.getState().session.steps["opt-2d-cmaes"].status, "completed");

      // 7.3 opt-2d-apply-verify (event path + full-grid completion)
      runner.nextStep();
      s.optActive = false; s.recipeActive = true; s.fracSolid = 0;
      runner.emit({
        kind: "opt-2d-applied",
        targetG: 4.0,
        recipe: { undercool: 0.74, nmax: 420, cool: [0.18, 0.24, 0.30], astm: 3.96 },
      });
      assert(runner.getState().session.steps["opt-2d-apply-verify"].subgoals.applied, "7.3 applied latches");
      s.gridN = 1024; s.fracSolid = 0.89; s.astm = 4.12; s.grainCount = 48;
      runner.tick();
      assert.equal(runner.getState().session.steps["opt-2d-apply-verify"].status, "completed");

      // 7.4 opt-3d-volume-search
      runner.nextStep();
      s.mode = "3d"; s.gridN = 96; s.calibrated = false; s.optActive = true; s.running = true;
      runner.emit({
        kind: "opt-3d-finished",
        material: "al",
        gridN: 96,
        targetDiam: 22.0,
        unit: "µm",
        episodes: 8,
        validEpisodes: 7,
        bestDiam: 21.4,
        bestRelError: 0.027,
        recipe: { undercool: 0.78, nmax: 350, cool: [0.22, 0.28, 0.35], diameter: 21.4 },
      });
      assert.equal(runner.getState().session.steps["opt-3d-volume-search"].status, "completed");

      const rep = runner.buildLabReport();
      assert.equal(rep.stepsCompleted, 4);
      assert.equal(rep.stepsTotal, 4);
      assert.equal(rep.table.length, 4);
      assert(rep.completedAt !== null);
      completedReports.push(rep);
    }

    // --- Lab 8: Binary Eutectic Lamellar Growth & Jackson–Hunt Scaling ---
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(8, { restart: true }));
      const e = host.snap.eutectic;
      assert(e && e.open && e.alloy === "alcu", "Lab 8 opens Al–Cu EUTECTIC");

      // 8.1 eutectic-lamellae
      e.step = 480;
      e.lambdaUm = 2.18;
      e.lambdaMinUm = 2.10;
      e.dTFrontK = 0.72;
      e.fAlpha = 0.502;
      e.fAlphaLever = 0.500;
      e.maxSimplexErr = 1.2e-7;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lamellae"].status, "completed");

      // 8.2 eutectic-solute-layer
      runner.nextStep();
      e.lens = 1;
      e.step = 672;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-solute-layer"].status, "completed");

      // 8.3 eutectic-jh-bowl
      runner.nextStep();
      e.seedPairs = 10;
      e.step = 432;
      e.lambdaUm = 1.31;
      e.dTFrontK = 0.96;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-jh-bowl"].status, "completed");

      // 8.4 eutectic-lever-shift
      runner.nextStep();
      e.c0Off = 0.16;
      e.step = 384;
      e.fAlpha = 0.421;
      e.fAlphaLever = 0.420;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lever-shift"].status, "completed");

      const rep = runner.buildLabReport();
      assert.equal(rep.labId, "eutectic-jh");
      assert.equal(rep.hashId, 8);
      assert.equal(rep.stepsCompleted, 4);
      assert.equal(rep.stepsTotal, 4);
      assert.equal(rep.table.length, 4);
      assert(rep.completedAt !== null);
      completedReports.push(rep);
    }

    // --- Lab 9: Spinodal Decomposition, Lyapunov Decay & 3D Coarsening ---
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      assert(await runner.startLab(9, { restart: true }));
      const sp = host.snap.spinodal;
      assert(sp && sp.open && sp.preset === "pfhub1" && sp.dim === "2d", "Lab 9 opens 2D PFHub B1 SPINODAL");

      // 9.1 spinodal-pfhub-lyapunov
      sp.step = 4800;
      sp.simTime = 16.2;
      sp.initialFreeEnergy = 320.0;
      sp.freeEnergy = 112.4;
      sp.meanC = 0.500001;
      sp.massDrift = 1.0e-6;
      sp.domainL = 11.4;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-pfhub-lyapunov"].status, "completed");

      // 9.2 spinodal-chem-mu
      runner.nextStep();
      sp.lens = 1;
      sp.simTime = 18.5;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-chem-mu"].status, "completed");

      // 9.3 spinodal-lsw-coarsening
      runner.nextStep();
      sp.preset = "fecr";
      sp.lens = 0;
      sp.simTime = 24.0;
      sp.freeEnergy = 98.5;
      sp.domainL = 14.8;
      sp.lswSlope = 0.324;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-lsw-coarsening"].status, "completed");

      // 9.4 spinodal-3d-sponge
      runner.nextStep();
      sp.dim = "3d";
      sp.simTime = 10.4;
      sp.freeEnergy = 415.2;
      sp.initialFreeEnergy = 980.0;
      sp.massDrift = -2.4e-6;
      sp.domainL = 12.6;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-3d-sponge"].status, "completed");

      const rep = runner.buildLabReport();
      assert.equal(rep.labId, "spinodal-lsw");
      assert.equal(rep.hashId, 9);
      assert.equal(rep.stepsCompleted, 4);
      assert.equal(rep.stepsTotal, 4);
      assert.equal(rep.table.length, 4);
      assert(rep.completedAt !== null);
      completedReports.push(rep);
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

      runner.selectStep(4);
      s.inoculant = 600;
      runner.tick();
      assert.equal(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, undefined,
        "stale Step 2.4 field without fresh reset must not latch Run A");

      host.clearMelt(0.90);
      s.fracSolid = 0.25; s.grainCount = 2; s.nucFired = 1;
      runner.tick();
      assert.equal(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, undefined,
        "low-grain single crystal must not latch Run A");

      s.grainCount = 30; s.nucFired = 35; s.fracSolid = 0.25;
      runner.tick();
      assert(runner.getState().session.steps["controlled-q-pair"].subgoals.highQ, "valid Run A latches");
      const effA = s.effUndercool;

      s.pouredMix = { mix: alZnMix, derived: alZn };
      s.params.mLiq = alZn.params.mLiq; s.params.c0 = alZn.params.c0;
      host.clearMelt(0.90);
      s.undercool = effA + s.params.mLiq * s.params.c0;
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
      runner.selectStep(3);
      s.mode = "2d"; s.calibrated = true; s.material = "al"; s.params.alloyOn = 1;
      s.fracSolid = 0; s.inoculant = 0; s.lambda = 30;
      runner.tick();
      assert.equal(runner.getState().liveHint, "melt has no seeds yet: click seed or tap canvas");

      s.fracSolid = 0.20;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 12.0, arms: 4, lenUm: 48.0 });
      assert(runner.getState().session.steps["sdas-convergence"].subgoals.runA);

      s.lambda = 20; s.fracSolid = 0.09;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 11.8, arms: 4, lenUm: 47.2 });
      assert.equal(runner.getState().session.steps["sdas-convergence"].status, "pending",
        "Event B with fracSolid < 0.15 must be rejected");

      s.lambda = 26; s.fracSolid = 0.20;
      runner.emit({ kind: "sdas-measured", dim: "2d", lambda2Um: 11.9, arms: 4, lenUm: 47.6 });
      assert.equal(runner.getState().session.steps["sdas-convergence"].status, "pending",
        "Event B with |Δλ| < 8 must be rejected");
    }

    // 3. Lab 4.4 & 4.5 + Lab 5: real 96³/128³/192³ domain-limit safety & twin/recovery physics from src/heattreat.ts
    {
      const umPerCell = 1000 / 1024;
      const limit96 = HT.domainLimitUm(96, umPerCell);
      assert(limit96 > 31 && limit96 < 33, `expected 96³ domain limit ~32.06 µm, got ${limit96}`);

      const checkSafe = (matKey, tC, holdMin, d0Um, gridN = 96) => {
        const si = MATERIALS[matKey].si;
        const sch = {
          name: "test",
          startC: HT.ROOM_C,
          stages: [
            { kind: "ramp", toC: tC, cPerMin: 10 },
            { kind: "hold", minutes: holdMin },
            { kind: "ramp", toC: HT.ROOM_C, cPerMin: 5 },
          ],
        };
        const integ = HT.integrate(sch, si);
        const dAfterUm = HT.grainAfter(d0Um * 1e-6, integ.gg, si) * 1e6;
        const lim = HT.domainLimitUm(gridN, umPerCell);
        assert(dAfterUm < lim, `${matKey} ${tC}°C/${holdMin}min on ${gridN}³ from ${d0Um}µm -> ${dAfterUm.toFixed(2)}µm exceeds limit ${lim.toFixed(2)}µm`);
        const sweeps = Math.round(HT.sweepsFor(d0Um, dAfterUm, umPerCell, HT.K_MC_3D, HT.M_MODEL_3D));
        return { dAfterUm, sweeps, rec: sweeps * HT.HT_RECOVER_3D };
      };
      checkSafe("cu", 790, 30, 22, 96);
      checkSafe("cu", 800, 30, 22, 96);
      checkSafe("al", 500, 30, 22, 96);
      checkSafe("steel", 900, 30, 22, 96);

      // Lab 5 recommended schedules across 96³, 128³, 192³ must stay under domain limit AND reach >= 180 sweeps for 5.2
      for (const gridN of [96, 128, 192]) {
        const r51 = checkSafe("al", 500, 60, 18, gridN);
        assert(r51.sweeps >= 40, `Lab 5.1 Al 500°C/60min on ${gridN}³ needs >=40 sweeps, got ${r51.sweeps}`);
        const r52 = checkSafe("al", 520, 90, 18, gridN);
        assert(r52.sweeps >= 180 && r52.rec >= 0.15,
          `Lab 5.2 Al 520°C/90min on ${gridN}³ needs >=180 sweeps & rec>=0.15, got ${r52.sweeps} / ${r52.rec.toFixed(3)}`);
      }

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

    // 5. Lab 5 anti-cheese: 2D/aborted/mid-gap/nuclei-on-5.1/low-sweeps/unfitted-Avrami rejected
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      await runner.startLab(5, { restart: true });
      const base = {
        kind: "heat-finished", dim: "3d", material: "al", tC: 510, holdMin: 60,
        pinF: 0, pinR: 0, d0Um: 18, dAfterUm: 22, dPredUm: 24, sigmaBefore: 36, sigmaAfter: 34,
        specMPa: 0, specMet: null, oxideNm: 2.1, sweeps: 220, aborted: false,
        twinsSpawned: 0, twinVerdictOk: false, twinRefusalWhy: "",
        coldWorkJb: 2.0, recovery: 0.22, lawWithdrawn: true, rxNuclei: 0, rxMode: 0,
      };
      // 2D heat-finished rejected
      runner.emit({ ...base, dim: "2d" });
      assert.equal(runner.getState().session.steps["cold-work-barrier"].subgoals.subBarrier, undefined);
      // Aborted rejected
      runner.emit({ ...base, aborted: true });
      assert.equal(runner.getState().session.steps["cold-work-barrier"].subgoals.subBarrier, undefined);
      // Mid-gap 4.0 J_b satisfies neither sub-barrier (<=2.5) nor active (>=6.0)
      runner.emit({ ...base, coldWorkJb: 4.0 });
      assert.deepEqual(runner.getState().session.steps["cold-work-barrier"].subgoals, {});
      // Active cold work with nuclei > 0 rejected on 5.1
      runner.emit({ ...base, coldWorkJb: 8.0, rxNuclei: 150 });
      assert.equal(runner.getState().session.steps["cold-work-barrier"].subgoals.aboveBarrier, undefined);
      // Low sweeps (<40) rejected on 5.1
      runner.emit({ ...base, coldWorkJb: 8.0, sweeps: 20 });
      assert.equal(runner.getState().session.steps["cold-work-barrier"].subgoals.aboveBarrier, undefined);

      // Step 5.2 rejects sweeps < 180, recovery < 0.15, or lawWithdrawn !== true
      runner.selectStep(1);
      runner.emit({ ...base, coldWorkJb: 9.0, sweeps: 120, recovery: 0.20, lawWithdrawn: true });
      assert.equal(runner.getState().session.steps["recovery-withdrawal"].status, "pending");
      runner.emit({ ...base, coldWorkJb: 9.0, sweeps: 250, recovery: 0.10, lawWithdrawn: true });
      assert.equal(runner.getState().session.steps["recovery-withdrawal"].status, "pending");
      runner.emit({ ...base, coldWorkJb: 9.0, sweeps: 250, recovery: 0.25, lawWithdrawn: false });
      assert.equal(runner.getState().session.steps["recovery-withdrawal"].status, "pending");

      // Step 5.3 rejects unfitted Avrami or < 4 points or wrong rxMode
      runner.selectStep(2);
      runner.emit({ ...base, coldWorkJb: 9.0, rxNuclei: 200, rxMode: 0, avramiN: null, avramiPoints: 0 });
      assert.equal(runner.getState().session.steps["rx-site-saturated"].status, "pending");
      runner.emit({ ...base, coldWorkJb: 9.0, rxNuclei: 200, rxMode: 0, avramiN: 2.7, avramiPoints: 3 });
      assert.equal(runner.getState().session.steps["rx-site-saturated"].status, "pending");
      runner.emit({ ...base, coldWorkJb: 9.0, rxNuclei: 200, rxMode: 1, avramiN: 3.3, avramiPoints: 8 });
      assert.equal(runner.getState().session.steps["rx-site-saturated"].status, "pending");

      // Step 5.4 rejects rxMode 0 (site-saturated random)
      runner.selectStep(3);
      runner.emit({ ...base, coldWorkJb: 9.0, rxNuclei: 200, rxMode: 0, avramiN: 2.8, avramiPoints: 9 });
      assert.deepEqual(runner.getState().session.steps["rx-mode-contrast"].subgoals, {});
    }

    // 6. Lab 6 anti-cheese: same-epoch G/V, stale melt before step 6.2, low flow speed, unmoved slice
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      await runner.startLab(6, { restart: true });
      const s = host.snap;

      // 6.1: latching highGV then switching sliders WITHOUT reset (same resetEpoch) must NOT latch lowGV
      s.mode = "2d"; s.params.scen = 1; s.bridgmanG = 0.16; s.bridgmanV = 1.0; s.fracSolid = 0.30; s.grainCount = 10;
      runner.tick();
      assert(runner.getState().session.steps["bridgman-gv-contrast"].subgoals.highGV);
      s.bridgmanG = 0.06; s.bridgmanV = 4.0; // same resetEpoch!
      runner.tick();
      assert.equal(runner.getState().session.steps["bridgman-gv-contrast"].subgoals.lowGV, undefined,
        "Lab 6.1 must reject lowGV on same resetEpoch as highGV");

      // 6.2: stale field at enteredAtEpoch must NOT latch still; flowSpeed < 0.02 rejected; same-epoch rejected
      runner.selectStep(1);
      s.params.scen = 0; s.flowOn = false; s.fracSolid = 0.25;
      runner.tick();
      assert.equal(runner.getState().session.steps["lbm-melt-flow"].subgoals.still, undefined,
        "Lab 6.2 must reject stale field without fresh reset after entering step");

      host.clearMelt(0.8);
      s.fracSolid = 0.14; s.flowOn = false;
      runner.tick();
      assert(runner.getState().session.steps["lbm-melt-flow"].subgoals.still);
      // Same resetEpoch with flow flipped on must be rejected
      s.flowOn = true; s.flowSpeed = 0.03;
      runner.tick();
      assert.equal(runner.getState().session.steps["lbm-melt-flow"].subgoals.flowing, undefined,
        "Lab 6.2 must reject flowing subgoal on same resetEpoch as still");
      // Fresh reset but flowSpeed < 0.02 rejected
      host.clearMelt(0.8);
      s.fracSolid = 0.14; s.flowOn = true; s.flowSpeed = 0.01;
      runner.tick();
      assert.equal(runner.getState().session.steps["lbm-melt-flow"].subgoals.flowing, undefined,
        "Lab 6.2 must reject flowSpeed < 0.02");

      // 6.3: 2D or wrong scen rejected
      runner.selectStep(2);
      s.mode = "2d"; s.params.scen = 3; s.fracSolid = 0.20; s.grainCount = 10;
      runner.tick();
      assert.equal(runner.getState().session.steps["selector-3d-staging"].status, "pending");

      // 6.4: SLICE without moving sliceOff >= 0.08 or without pole figure rejected
      runner.selectStep(3);
      s.mode = "3d"; s.params.scen = 3; s.fracSolid = 0.20; s.viewName = "SLICE";
      s.pole001On = true; s.poleFigureOn = true; s.sliceSweep = false; s.sliceOff = 0.54; // delta 0.04 < 0.08
      runner.tick();
      assert.equal(runner.getState().session.steps["selector-pole-figure"].status, "pending",
        "Lab 6.4 must reject sliceOff delta < 0.08 when sliceSweep is off");
      s.sliceOff = 0.70; s.pole001On = false; s.poleFigureOn = false;
      runner.tick();
      assert.equal(runner.getState().session.steps["selector-pole-figure"].status, "pending",
        "Lab 6.4 must reject missing pole figure");
    }

    // 7. Lab 7 anti-cheese: low episode counts, unapplied/cleared recipe, stale full-grid cast, 0 valid 3D episodes
    {
      const host = makeMockHost({ can3d: true });
      const runner = new GuidedLabRunner(host);
      await runner.startLab(7, { restart: true });
      const s = host.snap;

      // 7.2 rejects episodes < 12 or null bestG
      runner.selectStep(1);
      runner.emit({
        kind: "opt-2d-finished", targetG: 4.0, episodes: 8, bestG: 3.9, bestError: 0.1, converged: true,
        recipe: { undercool: 0.7, nmax: 300, cool: [0.2, 0.2, 0.2], astm: 3.9 },
      });
      assert.equal(runner.getState().session.steps["opt-2d-cmaes"].status, "pending");
      runner.emit({
        kind: "opt-2d-finished", targetG: 4.0, episodes: 16, bestG: null, bestError: null, converged: false,
        recipe: { undercool: 0.7, nmax: 300, cool: [0.2, 0.2, 0.2], astm: null },
      });
      assert.equal(runner.getState().session.steps["opt-2d-cmaes"].status, "pending");

      // 7.3 rejects stale high-solid cast on polling fallback, and rejects verified if recipeActive cleared
      runner.selectStep(2);
      s.mode = "2d"; s.optActive = false; s.challengeActive = false; s.recipeActive = true; s.fracSolid = 0.90; s.astm = 4.0; s.grainCount = 30;
      runner.tick();
      assert.equal(runner.getState().session.steps["opt-2d-apply-verify"].subgoals.applied, undefined,
        "Lab 7.3 polling fallback must reject already-solidified stale cast (fracSolid >= 0.25)");

      // Fresh armed recipe latches applied via polling fallback
      s.fracSolid = 0.05;
      runner.tick();
      assert(runner.getState().session.steps["opt-2d-apply-verify"].subgoals.applied,
        "Lab 7.3 polling fallback latches freshly armed recipe");
      // Clearing recipeActive (manual reset) prevents verification even at 90% solid
      s.recipeActive = false; s.fracSolid = 0.92;
      runner.tick();
      assert.equal(runner.getState().session.steps["opt-2d-apply-verify"].status, "pending",
        "Lab 7.3 must reject verification when recipeActive is false");

      // 7.4 rejects episodes < 4, validEpisodes === 0, or bestDiam === null
      runner.selectStep(3);
      s.mode = "3d";
      runner.emit({
        kind: "opt-3d-finished", material: "al", gridN: 96, targetDiam: 22, unit: "µm",
        episodes: 3, validEpisodes: 3, bestDiam: 21.8, bestRelError: 0.01, recipe: null,
      });
      assert.equal(runner.getState().session.steps["opt-3d-volume-search"].status, "pending");
      runner.emit({
        kind: "opt-3d-finished", material: "al", gridN: 96, targetDiam: 22, unit: "µm",
        episodes: 8, validEpisodes: 0, bestDiam: 21.8, bestRelError: 0.01, recipe: null,
      });
      assert.equal(runner.getState().session.steps["opt-3d-volume-search"].status, "pending");
      runner.emit({
        kind: "opt-3d-finished", material: "al", gridN: 96, targetDiam: 22, unit: "µm",
        episodes: 8, validEpisodes: 4, bestDiam: null, bestRelError: null, recipe: null,
      });
      assert.equal(runner.getState().session.steps["opt-3d-volume-search"].status, "pending");
    }

    // 8. Lab 8 anti-cheese: closed engine, low step, null lambdaUm, simplex error, wrong lens, default seedPairs, unshifted fAlpha
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      await runner.startLab(8, { restart: true });
      const e = host.snap.eutectic;

      // 8.1 rejects step < 400, null lambdaUm, elevated simplex error, or closed panel
      e.step = 350; e.lambdaUm = 2.1; e.maxSimplexErr = 1e-7;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lamellae"].status, "pending");
      e.step = 500; e.lambdaUm = null;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lamellae"].status, "pending");
      e.lambdaUm = 2.1; e.maxSimplexErr = 5e-4;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lamellae"].status, "pending");
      e.maxSimplexErr = 1e-7; e.open = false;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lamellae"].status, "pending");
      e.open = true;

      // 8.2 rejects PHASES/ETCH lens or step < 600
      runner.selectStep(1);
      e.lens = 0; e.step = 700;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-solute-layer"].status, "pending");
      e.lens = 2; e.step = 700;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-solute-layer"].status, "pending");
      e.lens = 1; e.step = 550;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-solute-layer"].status, "pending");

      // 8.3 rejects default seedPairs=6, step < 400, or dTFrontK <= 0
      runner.selectStep(2);
      e.seedPairs = 6; e.step = 500; e.dTFrontK = 0.8;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-jh-bowl"].status, "pending");
      e.seedPairs = 10; e.step = 320; e.dTFrontK = 0.9;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-jh-bowl"].status, "pending");
      e.step = 500; e.dTFrontK = 0;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-jh-bowl"].status, "pending");

      // 8.4 rejects |c0Off| < 0.10, step < 300, or unshifted fAlpha (paused slider cheese)
      runner.selectStep(3);
      e.c0Off = 0.08; e.step = 400; e.fAlpha = 0.43;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lever-shift"].status, "pending");
      e.c0Off = 0.15; e.step = 200; e.fAlpha = 0.43;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lever-shift"].status, "pending");
      e.step = 400; e.fAlpha = 0.49;
      runner.tick();
      assert.equal(runner.getState().session.steps["eutectic-lever-shift"].status, "pending");
    }

    // 9. Lab 9 anti-cheese: insufficient Lyapunov decay, mass drift, 3D SLICE on CHEM mu, pfhub1 on LSW step, 2D on 3D sponge
    {
      const host = makeMockHost();
      const runner = new GuidedLabRunner(host);
      await runner.startLab(9, { restart: true });
      const sp = host.snap.spinodal;

      // 9.1 rejects simTime < 15, F >= 0.78*F0, massDrift >= 1e-4, 3D dim, or non-pfhub1 preset
      sp.initialFreeEnergy = 320; sp.freeEnergy = 120; sp.simTime = 12; sp.massDrift = 0;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-pfhub-lyapunov"].status, "pending");
      sp.simTime = 16; sp.freeEnergy = 260; // 81.25% >= 78%
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-pfhub-lyapunov"].status, "pending");
      sp.freeEnergy = 120; sp.massDrift = 2e-4;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-pfhub-lyapunov"].status, "pending");
      sp.massDrift = 0; sp.dim = "3d";
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-pfhub-lyapunov"].status, "pending");
      sp.dim = "2d"; sp.preset = "fecr";
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-pfhub-lyapunov"].status, "pending");
      sp.preset = "pfhub1";

      // 9.2 rejects lens !== 1, dim === "3d" (SLICE is not CHEM mu), or simTime < 15
      runner.selectStep(1);
      sp.lens = 0; sp.simTime = 20;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-chem-mu"].status, "pending");
      sp.lens = 1; sp.dim = "3d";
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-chem-mu"].status, "pending");
      sp.dim = "2d"; sp.simTime = 10;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-chem-mu"].status, "pending");

      // 9.3 rejects pfhub1 preset, simTime < 20, or domainL <= 0
      runner.selectStep(2);
      sp.preset = "pfhub1"; sp.simTime = 25; sp.domainL = 12;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-lsw-coarsening"].status, "pending");
      sp.preset = "fecr"; sp.simTime = 18; sp.domainL = 12;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-lsw-coarsening"].status, "pending");
      sp.simTime = 25; sp.domainL = 0;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-lsw-coarsening"].status, "pending");

      // 9.4 rejects dim === "2d", simTime < 8, or |massDrift| >= 1e-4
      runner.selectStep(3);
      sp.dim = "2d"; sp.simTime = 12; sp.massDrift = 0;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-3d-sponge"].status, "pending");
      sp.dim = "3d"; sp.simTime = 6;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-3d-sponge"].status, "pending");
      sp.simTime = 12; sp.massDrift = -5e-4;
      runner.tick();
      assert.equal(runner.getState().session.steps["spinodal-3d-sponge"].status, "pending");
    }
  });

  // ------------------------------------------------------- LAB-SKIP-AND-REPORT
  await check("LAB-SKIP-AND-REPORT", async () => {
    const host = makeMockHost();
    const runner = new GuidedLabRunner(host);
    assert.equal(runner.buildLabReport(), null);

    await runner.startLab(3, { restart: true });
    runner.skipStep("user");
    const stAfterUserSkip = runner.getState();
    assert.equal(stAfterUserSkip.session.steps["recalescence-ratchet"].status, "skipped");
    assert.equal(stAfterUserSkip.session.steps["recalescence-ratchet"].skipReason, "user");
    assert.equal(stAfterUserSkip.activeStepIndex, 1);

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

    runner.selectStep(2);
    runner.resetCurrentStep();
    assert.equal(runner.getState().session.steps["step-block-3d"].status, "pending");
    assert.equal(runner.getState().session.steps["refiner-fade"].status, "completed");

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

    // Lab 7 no-3d skip on step 7.4 (3D optimizer)
    await runner.startLab(7, { restart: true });
    runner.selectStep(3);
    runner.skipStep("no-3d");
    const rep7 = runner.buildLabReport();
    assert.equal(rep7.steps[3].status, "skipped");
    assert.equal(rep7.steps[3].skipReason, "no-3d");

    // Lab 8 & Lab 9 skip/reset/report round-trip
    await runner.startLab(8, { restart: true });
    runner.skipStep("user");
    const rep8 = JSON.parse(JSON.stringify(runner.buildLabReport()));
    assert.equal(rep8.labId, "eutectic-jh");
    assert.equal(rep8.hashId, 8);
    assert.equal(rep8.stepsSkipped, 1);
    assert.equal(rep8.stepsTotal, 4);

    await runner.startLab(9, { restart: true });
    runner.skipStep("user");
    const rep9 = JSON.parse(JSON.stringify(runner.buildLabReport()));
    assert.equal(rep9.labId, "spinodal-lsw");
    assert.equal(rep9.hashId, 9);
    assert.equal(rep9.stepsSkipped, 1);
    assert.equal(rep9.stepsTotal, 4);

    runner.closeLab();
    assert.equal(runner.isActive(), false);
    assert.equal(runner.buildLabReport(), null);
  });

  // ----------------------------------------------------------- LAB-REPORT-HTML
  await check("LAB-REPORT-HTML", () => {
    assert.equal(completedReports.length, 9, "expected completed reports for all 9 labs");
    for (const rep of completedReports) {
      const html = formatLabReportHtml(rep);
      assert(html.startsWith("<!doctype html>"), `${rep.labId}: missing doctype`);
      assert(html.includes("@media print"), `${rep.labId}: missing @media print rules`);
      assert(html.includes('onclick="window.print()"'), `${rep.labId}: missing print button`);
      assert(html.includes("0x00000539 (1337)"), `${rep.labId}: missing hex+dec seed`);
      assert(html.includes(`#lab=${rep.hashId}`), `${rep.labId}: missing hashId`);
      assert(html.includes("solidify-lab-report v1"), `${rep.labId}: missing format footer`);
      assert(html.includes("COMPLETED"), `${rep.labId}: missing COMPLETED badge`);

      // Achromatic light-mode CSS check: every #RRGGBB in <style> must satisfy R === G === B
      const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
      assert(styleBlock.length > 200, `${rep.labId}: missing style block`);
      for (const m of styleBlock.matchAll(/#([0-9a-f]{6})\b/gi)) {
        const hex = m[1];
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        assert(r === g && g === b, `${rep.labId}: hued CSS color #${hex} in printable report`);
      }

      // Zero prose em dashes (lone empty-value "—" cells stripped first)
      const bodyOnly = html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/>\s*—\s*</g, "><");
      assert(!bodyOnly.includes("—"), `${rep.labId}: prose em dash found in printable report HTML`);
    }

    // Adversarial XSS & unsafe URL escaping + empty-table + skipped/intervened rendering
    const hostile = {
      format: "solidify-lab-report",
      version: 1,
      labId: 'lab-5"><script>alert(1)</script>',
      hashId: 5,
      title: `Cold Work <script>alert("x")</script> & 'quotes'`,
      course: `<img src=x onerror=alert(2)>`,
      startedAt: "2026-11-24T00:00:00Z",
      completedAt: null,
      build: "<b>dev</b>",
      seed: 0xdeadbeef,
      setupLink: "javascript:alert(3)",
      stepsCompleted: 0,
      stepsSkipped: 1,
      stepsTotal: 2,
      anyIntervened: true,
      steps: [
        {
          id: "step-1<svg>",
          title: `Step <svg onload=alert(4)>`,
          status: "skipped",
          skipReason: "no-3d",
          completedAt: "2026-11-24T00:05:00Z",
          captures: { "<badKey>": "</dd><script>evil()</script>", nested: { ok: 3.14159 } },
        },
        {
          id: "step-2",
          title: "Pending step",
          status: "pending",
          completedAt: null,
          captures: {},
        },
      ],
      columns: [{ key: "v", label: "val <x>", unit: "<b>u</b>" }],
      table: [],
    };
    const out = formatLabReportHtml(hostile);
    assert(!out.includes("<script>"), "raw <script> must be escaped");
    assert(!out.includes("<img "), "raw <img> must be escaped");
    assert(!out.includes("<svg "), "raw <svg> must be escaped");
    assert(!out.includes('href="javascript:'), "javascript: setupLink must not become an anchor href");
    assert(out.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"), "title must be HTML-escaped");
    assert(out.includes("0xdeadbeef"), "unsigned 32-bit hex seed formatting");
    assert(out.includes("SKIPPED (no-3d)"), "skipped badge with reason");
    assert(out.includes("PENDING"), "pending badge");
    assert(out.includes("intervened (physics settings changed mid-run)"), "intervened integrity banner");
    assert(out.includes("No measurements recorded yet."), "empty table message");

    // Safe https setupLink renders as clickable anchor
    const safeOut = formatLabReportHtml({ ...hostile, setupLink: "https://solidify.frankcai.dev/app/#lab=5" });
    assert(safeOut.includes('<a class="mono link" href="https://solidify.frankcai.dev/app/#lab=5"'),
      "safe https setupLink must render as anchor");
  });
} finally {
  await server.close();
}

console.log(failed ? `done — ${failed} FAILED` : "done — all guided-labs checks passed");
process.exitCode = failed ? 1 : 0;
