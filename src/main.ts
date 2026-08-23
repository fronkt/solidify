import { Simulation, type StatsResult } from "./sim";
import { MATERIALS, to3D } from "./materials";
import { Renderer, type ViewMode } from "./render";
import {
  Sim3D, GRID3_LADDER, type StatsResult3D, moldWallThickness, stepSectionBounds,
} from "./sim3d";
import { LENS3_NAMES, ICOSA_DELTA_MAX } from "./shaders3d";
import { Renderer3D, slicePlane } from "./render3d";
import { SlicePanel } from "./slicepanel";
import { ViewCube } from "./viewcube";
import { UI, type UIHost } from "./ui";
import { Hud } from "./hud";
import { Tour, SCENES, type TourHost } from "./tour";
import { Optimizer, type OptHost, type Recipe } from "./optimizer";
import { packShare, unpackShare, type ShareState } from "./share";
import { Challenge, type ChallengeHost } from "./challenge";
import { Composer } from "./composer";
import { derive as deriveAlloy, encodeMix, decodeMix, BASES, type Mix, type Derived as AlloyDerived } from "./alloy";
import { Analyze } from "./analyze";
import { Analyze3D } from "./analyze3d";
import { Nucleation } from "./nucleation";
import { Lab, type LabHost, type LabSetup } from "./lab";
import { HeatPanel, type HeatHost, type Census, regionCensus } from "./heatpanel";
import { Units, scaleOf, DEFAULT_UM_PER_CELL } from "./units";
import { stream, getSeed, setSeed, reseed, seedHex } from "./rng";
import { SOLVER } from "./shaders";
import { calibrate, defaultLambda, A_T, type QuantSetup } from "./quant";
import * as experiment from "./experiment";
import { WT_PER_C0 } from "./alloy";

/** fast-forward steps: the transport button cycles ×1 → ×2 → ×4 */
const SPEED_MULTS = [1, 2, 4] as const;

async function boot() {
  const gate = () => { document.getElementById("gate")!.style.display = "flex"; };
  if (!navigator.gpu) return gate();
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return gate();
  // float32-filterable buys the 3D raymarcher hardware trilinear sampling
  const wantFilter = adapter.features.has("float32-filterable");
  const device = await adapter.requestDevice({
    requiredFeatures: wantFilter ? ["float32-filterable" as GPUFeatureName] : [],
  });
  device.lost.then(info => { if (info.reason !== "destroyed") gate(); });

  // TRUE-3D capability gate: limits first; real memory gating happens in the
  // Sim3D.create OOM ladder (GRID3_LADDER: 192 -> 160 -> 128 -> 96) and is remembered
  const caps3d = {
    supported:
      adapter.limits.maxTextureDimension3D >= 128 &&
      adapter.limits.maxStorageTexturesPerShaderStage >= 3,
    maxN: adapter.limits.maxTextureDimension3D >= 192 ? 192
      : adapter.limits.maxTextureDimension3D >= 160 ? 160 : 128,
  };

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  let sim = new Simulation(device, 1024);
  const renderer = new Renderer(device, canvas, sim);
  const hud = new Hud(document.getElementById("hud")!);

  // ------------------------------------------------------------- app state
  let view: ViewMode = 0;
  let running = true;
  // a controlled-experiment cast owns the field for its duration: it holds
  // off BOTH the frame loop's transport (nuc.update + frame-paced sim.step —
  // a Space press mid-cast would otherwise inject physics around the cast's
  // fence-paced chunks) and the 4 Hz panel poll's async nuc.observe, which
  // lands at wall-clock times and would poison the ratchet (see experiment.ts)
  let benchHold = false;
  let substeps = 14;
  let speedMult = 1;
  let undercool = 1.0;
  let brush = 4;
  let weldAuto = false;
  let weldSweep = 55;      // cells per second
  let weldDir = 1;
  // heterogeneous nucleation: the charge's inoculant site population. The rate
  // is not a setting — it emerges from how the melt's undercooling deepens.
  const nuc = new Nucleation();
  let lastStats: StatsResult | null = null;
  let fps = 60;
  let material = "generic";
  let alloyName = MATERIALS.generic.label;
  /**
   * The alloy that was actually POURED, if one was — the composer's mix, its
   * derived chemistry, and the material key it was poured onto.
   *
   * It is a lifetime that `tsc` cannot see, so both ends are stated once here.
   * SET by `applyAlloy`, and only when `setMaterial` accepted the base metal.
   * CLEARED by `setMaterial`, because picking a material from the dropdown is
   * not pouring an alloy — after that, calibrating must use the material's own
   * numbers again. `calibrateNow` additionally re-checks `materialKey`, so a
   * clear that is ever missed cannot silently calibrate one metal against
   * another metal's chemistry.
   */
  let pouredMix: {
    materialKey: string; mix: Mix; derived: AlloyDerived;
    /**
     * The chemistry keys the pour wrote onto `sim.params`, stamped so
     * `calibrateNow` can tell whether the solver is STILL carrying this mix.
     * Chasing every writer of c0/mLiq/kPart is a losing game — the composition
     * slider writes `p().c0` directly (ui.ts), `setParams` is called by every
     * preset, scene and tour chapter, and a share link assigns the whole
     * bundle — so the invariant is checked at the point of use instead. Only
     * the four chemistry keys are stamped: `dSol` is deliberately absent
     * because `setSolver` overwrites it with the calibrated diffusivity.
     */
    stamp: { alloyOn: number; c0: number; mLiq: number; kPart: number };
  } | null = null;
  /**
   * Clamps and refusals from the last pour, rendered OUTSIDE the composer —
   * beside the alloy name and on the heat-treat card. Before v7.1 P1 they only
   * ever existed inside the modal, so an `#alloy=` deep link produced a melt
   * whose caveats the recipient never saw, which is exactly the claim
   * science/index.html makes about labelling every clamp.
   */
  let alloyCaveats: string[] = [];
  let recorder: MediaRecorder | null = null;
  // an applied optimizer recipe: phase-scheduled cooling driven off fracSolid,
  // exactly the way the optimizer's episodes ran it
  let recipeSchedule: [number, number, number] | null = null;
  // model resolution — the length anchor for BOTH solvers (units.ts)
  let umPerCell = DEFAULT_UM_PER_CELL;

  // ------------------------------------------------------- TRUE-3D mode state
  let mode: "2d" | "3d" = "2d";
  let sim3d: Sim3D | null = null;
  let renderer3d: Renderer3D | null = null;
  let viewcube: ViewCube | null = null;
  let view3d = 0;                 // 0 MELT, 1 ORIENT, 2 SLICE, 3 FIELD
  let running3d = true;
  let substeps3d = 8;
  const nuc3 = new Nucleation();
  let grid3 = caps3d.maxN;
  // section plane: preset axis + depth + free tilt/turn, CT-sweep animation,
  // and the cut-face style (the etch cabinet)
  const slice = { axis: 0, off: 0.5, tilt: 0, turn: 0, sweep: false, sweepDir: 1, style: 0 };
  let lastStats3: StatsResult3D | null = null;
  let turntable: { t0: number; az0: number } | null = null;

  /** φ volume → surface-nets worker → binary STL download (or test readout) */
  async function exportSTL(download: boolean): Promise<{ tris: number; bytes: number } | null> {
    if (mode !== "3d" || !sim3d) return null;
    const phi = await sim3d.readPhiVolume();
    if (!phi) return null;
    const n = sim3d.n;
    return new Promise(resolve => {
      const w = new Worker(new URL("./mc-worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent<{ stl?: ArrayBuffer; tris?: number; error?: string }>) => {
        w.terminate();
        if (!ev.data.stl) { console.error("[solidify] STL:", ev.data.error); resolve(null); return; }
        if (download) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([ev.data.stl], { type: "model/stl" }));
          a.download = `solidify-dendrite-${n}.stl`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        }
        resolve({ tris: ev.data.tris!, bytes: ev.data.stl.byteLength });
      };
      w.postMessage({ phi: phi.buffer, n, stride: 2, iso: 0.5, boxMm: 40 }, [phi.buffer]);
    });
  }
  let mode3dPending = false;

  const HINT_2D = "tap the melt to nucleate a crystal · shift-tap for a twin · scroll or pinch to zoom · right-drag to pan";
  const HINT_3D = "tap to nucleate in the volume · drag to orbit · wheel to dolly · right-drag to pan";
  const setHintMode = (m3: boolean) => {
    const h = document.getElementById("hint")!;
    h.textContent = m3 ? HINT_3D : HINT_2D;
    if (m3) h.classList.remove("gone");
  };

  /**
   * The live scaling. Rebuilt on demand rather than cached: it depends on the
   * material, the active solver's dx/latent/dSol, whether the solute field is
   * on, and the resolution — and a stale scale prints confidently wrong numbers,
   * which is the one failure mode this whole layer exists to prevent. It is a
   * few flops and one small object, called at panel cadence.
   */
  const unitsNow = (): Units => {
    const three = mode === "3d" && sim3d != null;
    const si = (MATERIALS[material] ?? MATERIALS.generic).si ?? null;
    const p = three ? sim3d!.params : sim.params;
    return new Units(scaleOf({
      si,
      n: three ? sim3d!.n : sim.n,
      dx: p.dx,
      latent: p.latent,
      dSol: p.dSol,
      alloy: three ? sim3d!.alloyActive : sim.params.alloyOn === 1,
      umPerCell,
      dTherm: (p as { dTherm?: number }).dTherm ?? 1,
      // λ only exists while the quantitative solver is the one running; passing
      // it under Kobayashi would print a capillary ratio the solver is not using
      lambda: (p as { solver?: number }).solver === SOLVER.QUANT
        ? (p as { lambda?: number }).lambda ?? null
        : null,
    }), si);
  };

  /**
   * The calibration the current material and composition imply at this λ, or
   * null for a material with no SI identity (there is nothing to calibrate a
   * reference crystal against).
   */
  /** the poured mix in `#alloy=` payload form for a share link, or undefined */
  const pouredShare = (): string | undefined =>
    pouredMix ? encodeMix(pouredMix.mix).replace(/^alloy=/, "") : undefined;

  const calibrateNow = (lambda: number): QuantSetup | null => {
    const si = (MATERIALS[material] ?? MATERIALS.generic).si;
    if (!si) return null;
    const alloy = sim.params.alloyOn === 1;
    // The poured mix's OWN freezing range, when one was poured onto THIS
    // material. Before v7.1 P1 this line did not exist and ΔT₀ came from
    // `si.mL`/`si.kPart` — for aluminium, −3.4 and 0.17, which materials.ts
    // says out loud are Al–4Cu. Pouring A356 therefore calibrated the
    // thermometer, the clock, the cell pitch and every SI readout for a
    // different alloy. The mix's own numbers are used when they exist, the
    // material's when they do not, and `coefficientSource` always says which.
    // Two conditions, and the second is the one that is easy to forget: the
    // mix must have been poured onto THIS material, and the solver must still
    // be carrying THAT chemistry. Move the composition slider, click a preset,
    // restore a scene — any of those rewrite c0/mLiq/kPart, and a ΔT₀ built for
    // a composition the kernel is no longer integrating is exactly the defect
    // this milestone removed one level up.
    const stale = pouredMix && !(
      sim.params.alloyOn === pouredMix.stamp.alloyOn
      && sim.params.c0 === pouredMix.stamp.c0
      && sim.params.mLiq === pouredMix.stamp.mLiq
      && sim.params.kPart === pouredMix.stamp.kPart);
    const poured = pouredMix && pouredMix.materialKey === material && !stale ? pouredMix : null;
    const d = poured?.derived ?? null;
    return calibrate({
      si, alloy, c0wt: sim.params.c0 * WT_PER_C0, lambda,
      dT0Override: alloy ? d?.dT0 ?? null : null,
      coefficientSource: !alloy ? undefined
        : !d
          ? (stale
            ? `the composition dials have moved since ${pouredMix!.derived.name} was poured, so its freezing range no longer describes what the solver carries. Calibrating on ${MATERIALS[material].label}'s own SI coefficients instead: |m| ${Math.abs(si.mL)} K/wt%, k ${si.kPart}, c∞ ${(sim.params.c0 * WT_PER_C0).toFixed(2)} wt%.`
            : undefined)
          : d.dT0 != null
            ? `${d.name}: ${d.dT0Source}`
            : `${d.name}: ΔT₀ declined — ${d.dT0Source} Calibrating on ${MATERIALS[material].label}'s own coefficients instead: |m| ${Math.abs(si.mL)} K/wt%, k ${si.kPart}.`,
    });
  };

  /**
   * The dials calibrated mode takes over, stashed so leaving it restores the
   * Kobayashi setup exactly. They are not deleted while it runs — share links,
   * presets and every scene still write them, and a mode switch that silently
   * discarded a user's ε̄ would be a worse surprise than a greyed-out slider.
   */
  let kobSnapshot: Record<string, number> | null = null;
  const KOB_OWNED = ["dx", "dt", "epsBar", "tau", "latent", "delta", "dTherm", "dSol", "lambda", "atCoef"] as const;

  /**
   * Switch solver. Under `SOLVER.QUANT` seven dials stop being choices: W₀ and
   * τ₀ follow from the material's own d₀ and D through the thin-interface
   * relations, the cell pitch follows from W₀, the latent coupling follows from
   * whichever reference interval the model is measuring temperature in, and the
   * anisotropy becomes the material's MEASURED ε₄ rather than the value its
   * morphology was tuned with. λ is the only thing left to pick, and it is a
   * convergence knob. Returns the calibration so a caller can print it.
   */
  const setSolver = (kind: number, lambda?: number): QuantSetup | null => {
    const P = sim.params as unknown as Record<string, number>;
    if (kind === SOLVER.QUANT) {
      // entering the mode picks the λ the material can afford; changing λ later
      // passes it explicitly and this default steps aside
      const want = lambda ?? (kobSnapshot ? sim.params.lambda : defaultLambda(sim.params.alloyOn === 1));
      const q = calibrateNow(want);
      if (!q) return null;
      const si = MATERIALS[material].si!;
      if (!kobSnapshot) {
        kobSnapshot = { umPerCell };
        for (const k of KOB_OWNED) kobSnapshot[k] = P[k];
      }
      Object.assign(sim.params, {
        solver: SOLVER.QUANT,
        lambda: q.lambda,
        dx: q.dx, dt: q.dt,
        epsBar: 1, tau: 1,          // length in W₀, time in τ₀ — that IS the calibration
        latent: q.latent,
        delta: si.eps4,
        dTherm: q.dTilde, dSol: q.dTilde,
        // the anti-trapping current is not optional in calibrated mode: without
        // it k_eff drifts with the interface width and the model stops being
        // quantitative in exactly the way it claims to be
        atCoef: A_T,
      });
      app.setUmPerCell(q.umPerCell);
      return q;
    }
    sim.params.solver = SOLVER.KOB;
    if (kobSnapshot) {
      const { umPerCell: um, ...dials } = kobSnapshot;
      Object.assign(sim.params, dials);
      app.setUmPerCell(um);
      kobSnapshot = null;
    }
    return null;
  };

  /** carry the current material + shared dials onto the 3D solver */
  /**
   * Niyama's own radiographic-soundness criterion for STEEL castings:
   * Ny < 1.0 (°C·min)^½·cm⁻¹ ⇒ shrinkage detectable on film. Converted:
   * √60 K^½·s^½ per 10 mm = 0.775 K^½·s^½·mm⁻¹ (E. Niyama, T. Uchida,
   * M. Morikawa, S. Saito, AFS Int. Cast Metals J. 7, 1982 — the reference
   * §11 already cites). STEEL-ONLY on purpose: a steel radiographic threshold
   * applied to aluminium — whose porosity in this instrument is Sievert
   * hydrogen, not shrinkage — would be the over-claim the honesty table
   * refuses, so every other material keeps the relative display scale.
   */
  const NY_STEEL_SI = Math.sqrt(60) / 10;

  /**
   * One owner for the Niyama threshold: the stats risk counter and the SLICE
   * ramp both read sim3d.params.nyCrit. Steel with known units gets the cited
   * criterion re-expressed in the volume's own dimensionless scale; everything
   * else keeps the legacy 8.0 — a relative map, and the legend says so.
   * Called from the 3D stats poll, so an anchor change (material, alloy flag,
   * grid) lands within one panel cadence.
   */
  const syncNyCrit = () => {
    if (!sim3d) return;
    const u = unitsNow();
    const one = u.known ? u.niyamaSI(1) : NaN;
    sim3d.params.nyCrit = material === "steel" && Number.isFinite(one) && one > 0
      ? NY_STEEL_SI / one
      : 8;
  };

  const apply3DMaterial = () => {
    if (!sim3d) return;
    const m3 = to3D(MATERIALS[material] ?? MATERIALS.generic);
    Object.assign(sim3d.params, {
      aniMode3: m3.aniMode3,
      delta: m3.delta,
      deltaZ: m3.deltaZ,
      latent: sim.params.latent,
      noiseAmp: sim.params.noiseAmp,
      meltGlow: sim.params.meltGlow,
      coolRate: sim.params.coolRate,
      // v6.2 P: the alloy constants were never mirrored, so a material swap in
      // the volume left the PREVIOUS charge's chemistry in the solver — the
      // dial fix above this (partition k reaching 3D) exposed it. sim.params
      // already carries the material's values (setMaterial assigns them before
      // calling here), composer overrides included.
      c0: sim.params.c0,
      mLiq: sim.params.mLiq,
      kPart: sim.params.kPart,
      dSol: sim.params.dSol,
    });
  };

  /** lazy-create the 3D stack once, then start a fresh melt with a centre seed */
  const enter3D = async (armed = false) => {
    if (mode3dPending || opt.active || challenge.active || !caps3d.supported) return;
    mode3dPending = true;
    try {
      if (!sim3d) {
        sim3d = await Sim3D.create(device, grid3);
        if (!sim3d) { caps3d.supported = false; ui.sync(); return; }
        grid3 = sim3d.n;
        renderer3d = new Renderer3D(device, canvas, sim3d);
        viewcube = new ViewCube(
          document.getElementById("viewcube") as HTMLCanvasElement,
          { snapTo: d => renderer3d!.snapTo(d), orbitBy: (dx, dy) => renderer3d!.orbitBy(dx, dy) },
        );
      }
      // (the tour survives the switch — part III drives it; the manual dim
      // switch closes it via closeTour() instead)
      apply3DMaterial();
      sim3d.reset(1 - undercool);
      sim3d.addSeed3D(sim3d.n / 2, sim3d.n / 2, sim3d.n / 2, brush + 1);
      lastStats3 = null;
      nuc3.stage(sim3d.n, true);
      running3d = !armed;
      renderer3d!.resetView();
      mode = "3d";
      document.body.classList.add("mode3d");
      hud.reset();
      hud.setMode3(true);
      setHintMode(true);
      ui.sync();
    } finally {
      mode3dPending = false;
    }
  };

  const exit3D = () => {
    mode = "2d";
    probeMark3.style.display = "none";   // the frame loop's 3D branch stops updating it
    rulerLine3.style.display = "none";
    rulerText3.style.display = "none";
    document.body.classList.remove("mode3d");
    hud.reset();
    hud.setMode3(false);
    setHintMode(false);
    ui.sync();
  };

  /** rebuild the 3D solver at a new grid edge (destroy first — ~403 MB at 192³) */
  const swapSim3D = async (n: number) => {
    if (!sim3d || mode3dPending) return;
    mode3dPending = true;
    try {
      const params = { ...sim3d.params };
      sim3d.destroy();
      sim3d = null;
      const created = await Sim3D.create(device, n);
      if (!created) { caps3d.supported = false; exit3D(); return; }
      created.params = params;
      // a grid swap rebuilds textures — the solute pair must re-allocate too
      if (params.alloyOn === 1) {
        created.params.alloyOn = 0;
        await created.enableAlloy();
      }
      created.reset(1 - undercool);
      created.addSeed3D(created.n / 2, created.n / 2, created.n / 2, brush + 1);
      sim3d = created;
      grid3 = created.n;
      renderer3d!.rebind3(created);
      lastStats3 = null;
      running3d = true;
      ui.sync();
    } finally {
      mode3dPending = false;
    }
  };

  /** edit the active mode's inoculant charge and re-draw its site population */
  const restageNuc = (edit: (N: Nucleation) => void) => {
    const three = mode === "3d" && !!sim3d;
    const N = three ? nuc3 : nuc;
    edit(N);
    N.restage(three ? sim3d!.n : sim.n, three);
  };

  // Declared before `app` so its guards can read `heat?.busy` without a TDZ
  // (the v2.0 boot-order lesson); constructed after the host adapters below.
  let heat: HeatPanel | null = null;

  // TourHost joined the annotation in v7.1 P6. `app` always satisfied it —
  // `new Tour(app)` typechecked structurally — but the requirement was invisible
  // here, so a member the tour needs and the rail does not (closeComposer) read
  // as an excess property on the literal. Naming all three hosts makes the
  // obligation explicit and puts the compile error on the interface it belongs to.
  const app: UIHost & OptHost & TourHost = {
    // ---- AppControl (scenes / tour)
    clearMelt(u) {
      if (heat?.busy) return;   // a treatment owns the field until it finishes
      undercool = u;
      recipeSchedule = null;   // a new scene retires any applied recipe
      if (mode === "3d" && sim3d) {
        sim3d.reset(1 - u);
        hud.reset();
        an3.reset();
        lastStats3 = null;
        nuc3.stage(sim3d.n, true);
        sim3d.params.weldX = sim3d.n * 0.12;
        sim3d.params.weldY = sim3d.n * 0.2;
        weldDir = 1;
        return;
      }
      sim.reset(1 - u);
      hud.reset();
      analyze.reset();
      lastStats = null;
      nuc.stage(sim.n, false);
      sim.params.weldX = sim.n * 0.12;
      sim.params.weldY = sim.n * 0.2;
      weldDir = 1;
    },
    seedCenter() {
      if (mode === "3d" && sim3d) sim3d.addSeed3D(sim3d.n / 2, sim3d.n / 2, sim3d.n / 2, brush + 1);
      else sim.addSeed(sim.n / 2, sim.n / 2, brush + 1);
      hideHint();
    },
    twinSeedCenter() {
      if (mode === "3d" && sim3d) sim3d.addTwinSeed3D(sim3d.n / 2, sim3d.n / 2, sim3d.n / 2, brush + 1.5);
      else sim.addTwinSeed(sim.n / 2, sim.n / 2, brush + 1.5);
      hideHint();
    },
    chillWall(edge = "auto") {
      if (mode === "3d" && sim3d) { sim3d.chillFloor(); hideHint(); return; }
      const e = edge === "auto" ? (canvas.width >= canvas.height ? "left" : "bottom") : edge;
      sim.chillWall(e);
      hideHint();
    },
    scatterSeeds(count) {
      // the host's own stream: scattering is an operator action, so it must not
      // consume draws from the solver's sequence and shift the cast underneath it
      const r = stream("scatter");
      if (mode === "3d" && sim3d) {
        for (let i = 0; i < count; i++)
          sim3d.addSeed3D(r.upto(sim3d.n), r.upto(sim3d.n), r.upto(sim3d.n), 3.5);
        return;
      }
      for (let i = 0; i < count; i++)
        sim.addSeed(r.upto(sim.n), r.upto(sim.n), 3.5);
    },
    // in 3D only the dials both solvers share land on the 3D params — a tour
    // chapter passing 2D-only fields (scen, alloyOn…) must not pollute them
    setParams(p) {
      if (mode === "3d" && sim3d) {
        const P = sim3d.params as unknown as Record<string, number>;
        for (const [k, v] of Object.entries(p)) if (k in P) P[k] = v as number;
        return;
      }
      Object.assign(sim.params, p);
    },
    // the inoculant addition: how many potential nuclei the charge carries.
    // Changing it re-draws the site population, keeping already-swept sites spent.
    setInoculant(v) { restageNuc(N => { N.p.nmax = v; }); },
    setView(v) { view = v as ViewMode; },
    setSpeed(v) {
      if (mode === "3d") substeps3d = Math.min(22, v);
      else substeps = v;
    },
    // while the optimizer owns the stage, the transport drives IT, not the melt
    setRun(on) {
      // the solver-paused interlock: a heat treatment freezes φ by definition,
      // so nothing — space bar, transport button, a tour scene — may restart
      // the solidification loop until the sweeps are spent
      if (on && heat?.busy) return;
      if (opt.active) opt.setRunning(on);
      else if (mode === "3d") running3d = on;
      else running = on;
    },
    setWeldAuto(on) { weldAuto = on; },
    // Both are 2D-only: the frame loop's 3D branch returns before opt.tick()
    // and challenge.onStats(), so starting either from the volume would leave a
    // mode that never advances. The buttons are already only2d and the tour
    // forces 2D first, but a share link, the console or a future caller can
    // reach these — guard at the host rather than rely on the UI.
    startOptimizer() { if (mode === "2d" && !challenge.active && !lab.active && !heat?.active) opt.start(sim.n); },
    startChallenge() { if (mode === "2d" && !opt.active && !lab.active && !heat?.active) challenge.start(); },
    // lab and heat treat share the bottom-centre panel slot — one at a time
    startLab() { if (!opt.active && !challenge.active && !heat?.active) lab.open(); },
    isLabOpen: () => lab.active,
    // both dimensions since H2b — the volume runs the 26-neighbour Potts pass
    startHeat() { if (!opt.active && !challenge.active && !lab.active) heat?.open(); },
    syncUI() { ui.sync(); },
    reveal(target) {
      if (target.startsWith("sec:")) ui.reveal(target.slice(4));
      else document.querySelectorAll(target).forEach(el => el.classList.add("hl"));
    },
    clearReveals() {
      document.querySelectorAll(".hl").forEach(el => el.classList.remove("hl"));
    },
    // ---- UIHost extras
    // in 3D mode the shared dial rows (δ, noise, latent, ε̄, γ, α, τ, cooling)
    // drive the 3D solver's params — same field names by design
    simParams: () => (mode === "3d" && sim3d ? (sim3d.params as unknown as typeof sim.params) : sim.params),
    units: () => unitsNow(),
    /**
     * The melt's temperature in °C, or null. THREE separate nulls, and they are
     * three separate facts. `meanLiqT` is null once the casting is fully solid
     * — sim.ts returns null and never 0, because 0 is a legitimate
     * dimensionless temperature one whole reference interval below the melting
     * point. `units.known` is false for a material with no SI identity, which
     * is the BOOT DEFAULT (`generic`), and there the converter returns NaN by
     * design so "we do not know" stays visibly different from "zero". And
     * `lastStats` is nulled by every reset, so there is a quarter-second gap
     * after a re-arm with nothing to report.
     *
     * Mode-aware for the same reason `unitsNow()` is: the 3D branch of the
     * frame loop returns before the 2D stats block, so `lastStats` is frozen
     * and stale the whole time the user is in the volume.
     */
    meltC() {
      const s = mode === "3d" ? lastStats3 : lastStats;
      if (!s || s.meanLiqT == null) return null;
      const u = unitsNow();
      if (!u.known) return null;
      const c = u.celsius(s.meanLiqT);
      return Number.isFinite(c) ? c : null;
    },
    fracSolidNow: () => (mode === "3d" ? lastStats3 : lastStats)?.fracSolid ?? 0,
    seedHex: () => seedHex(),
    // a new seed re-draws every stream, so the next pour is a genuinely new cast
    // rather than the same one with the dials nudged
    reseed: () => { reseed(); },
    // ---- calibrated mode (Phase Q). 2D only for now: the volume still runs
    // the Kobayashi solver, and offering a switch that silently did nothing
    // there would be exactly the dead-knob class U0 spent a milestone removing.
    canCalibrate: () => mode === "2d" && !!(MATERIALS[material] ?? {}).si,
    isCalibrated: () => sim.params.solver === SOLVER.QUANT,
    setCalibrated(on) {
      if (on && !app.canCalibrate()) return;
      setSolver(on ? SOLVER.QUANT : SOLVER.KOB);
      // dx, dt and the cell pitch all just changed, so the field in the
      // textures is no longer a solution of the equations being solved
      app.resetArmed();
      ui.sync();
    },
    getLambda: () => sim.params.lambda,
    setLambda(v) {
      if (sim.params.solver !== SOLVER.QUANT) { sim.params.lambda = v; return; }
      setSolver(SOLVER.QUANT, v);
      app.resetArmed();
    },
    calibration: () => (sim.params.solver === SOLVER.QUANT ? calibrateNow(sim.params.lambda) : null),
    getUmPerCell: () => umPerCell,
    setUmPerCell(v) {
      umPerCell = Math.max(0.01, v);
      // both solvers measure in the same physical units — that they did not
      // was the 2D-vs-3D discrepancy this release removed
      sim.umPerCell = umPerCell;
      if (sim3d) sim3d.umPerCell = umPerCell;
    },
    getUndercool: () => undercool,
    setUndercool(v) { undercool = v; },
    getInoculant: () => (mode === "3d" ? nuc3 : nuc).p.nmax,
    getNucPotency: () => (mode === "3d" ? nuc3 : nuc).p.dTN,
    setNucPotency(v) { restageNuc(N => { N.p.dTN = v; }); },
    getNucSpread: () => (mode === "3d" ? nuc3 : nuc).p.dTsig,
    setNucSpread(v) { restageNuc(N => { N.p.dTsig = v; }); },
    getNucFired: () => (mode === "3d" ? nuc3 : nuc).fired,
    getSubsteps: () => substeps,
    isRunning: () => (opt.active ? opt.isRunning() : mode === "3d" ? running3d : running),
    isEngineering: () => opt.active,
    getSpeedMult: () => speedMult,
    cycleSpeedMult() {
      speedMult = SPEED_MULTS[(SPEED_MULTS.indexOf(speedMult as 1 | 2 | 4) + 1) % SPEED_MULTS.length];
    },
    getMaterial: () => material,
    setMaterial(k) {
      const m = MATERIALS[k];
      if (!m) {
        // Was a bare `return`. It is reachable from a share link and from
        // window.__solidify, and its cost is not "nothing happened": the
        // CALLER goes on to set the alloy name, so the app printed one metal's
        // name over another metal's still-live thermometer, clock, Γ, ε₄ and
        // heat-treatment laws. Reporting the refusal is what lets the caller
        // decline to do that.
        alloyCaveats = [`there is no material called "${k}" in this build — the melt is still ${MATERIALS[material].label}`];
        return false;
      }
      material = k;
      alloyName = m.label;
      // picking a material is not pouring an alloy: the composed chemistry and
      // its caveats end here, and the calibration goes back to this material's
      // own coefficients
      pouredMix = null;
      alloyCaveats = [];
      Object.assign(sim.params, m.params);
      // That assign just wrote the NEW material's Kobayashi latent, delta and
      // dSol over whatever the calibration had derived, and two things follow.
      // First, the snapshot that leaving calibrated mode restores from was
      // taken for the PREVIOUS material, so it has to learn the keys that just
      // changed — otherwise exiting calibrated mode after a material swap puts
      // aluminium's dials on a magnesium melt. Second, the solver flag still
      // says QUANT, so the calibration has to be re-derived or the panel prints
      // a calibration the solver is not running. This is the same defect the
      // WIRE closes for pours, at its other call site.
      if (kobSnapshot) {
        const mp = m.params as unknown as Record<string, number>;
        for (const k of KOB_OWNED) if (k in mp) kobSnapshot[k] = mp[k];
      }
      if (sim.params.solver === SOLVER.QUANT) setSolver(SOLVER.QUANT, sim.params.lambda);
      if (mode === "3d") apply3DMaterial();
      return true;
    },
    openComposer() { if (!opt.active && !challenge.active) composer.open(); },
    // v7.1 P6: the tour calls this on leaving every chapter, so the one chapter
    // that opens the modal cannot leave it sitting over the next chapter's melt.
    // Unconditional on purpose — closing something already closed is a no-op,
    // and mirroring openComposer's opt/challenge guard here would mean a modal
    // opened before the optimizer started could never be put back.
    closeComposer() { composer.close(); },
    getAlloyName: () => alloyName,
    getAlloyCaveats: () => alloyCaveats.slice(),
    isRecording: () => recorder != null,
    toggleRec() {
      if (recorder) { recorder.stop(); return; }
      const stream = canvas.captureStream(60);
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
        .find(m => MediaRecorder.isTypeSupported(m));
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
        a.download = `solidify-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        recorder = null;
        ui.sync();
      };
      recorder.start();
      ui.sync();
    },
    getGrid: () => sim.n,
    setGrid(n) { if (n !== sim.n && !opt.active && !challenge.active && !heat?.busy) app.swapSim(n); },
    getView: () => view,
    // a uniform volumetric heat source held while the button is down: it warms
    // the melt and remelts what has frozen. Named `anneal` until v6.0, which was
    // the wrong word for it — see the button in ui.ts.
    reheat(on) {
      if (mode === "3d" && sim3d) sim3d.params.heatIn = on ? 1.1 : 0;
      else sim.params.heatIn = on ? 1.1 : 0;
    },
    quench() { if (mode === "3d" && sim3d) sim3d.quench(0.25); else sim.quench(0.25); },
    resetArmed() {
      if (heat?.busy) return;  // a treatment owns the field until it finishes
      if (mode === "3d" && sim3d) {
        sim3d.reset(1 - undercool);
        lastStats3 = null;
        nuc3.stage(sim3d.n, true);
        running3d = false;
        hud.reset();
        an3.reset();
        sim3d.params.weldX = sim3d.n * 0.12;
        sim3d.params.weldY = sim3d.n * 0.2;
        weldDir = 1;
        return;
      }
      sim.reset(1 - undercool);
      hud.reset();
      analyze.reset();
      lastStats = null;
      nuc.stage(sim.n, false);
      running = false;
      sim.params.weldX = sim.n * 0.12;
      sim.params.weldY = sim.n * 0.2;
      weldDir = 1;
    },
    getBrush: () => brush,
    setBrush(v) { brush = v; },
    getWeldAuto: () => weldAuto,
    getWeldSweep: () => weldSweep,
    setWeldSweep(v) { weldSweep = v; },
    getPixel: () => renderer.pixelSize,
    setPixel(v) { renderer.pixelSize = v; },
    getPalette: () => (mode === "3d" && renderer3d ? renderer3d.paletteOn : renderer.paletteOn),
    setPalette(b) {
      if (mode === "3d" && renderer3d) renderer3d.paletteOn = b;
      else renderer.paletteOn = b;
    },
    getVoxel3: () => renderer3d?.voxelOn ?? false,
    setVoxel3(b) { if (renderer3d) renderer3d.voxelOn = b; },
    getStain: () => renderer.stainMode,
    setStain(v) { renderer.stainMode = v; },
    getEbsd: () => renderer.ebsdOn,
    setEbsd(b) { renderer.ebsdOn = b; },
    getTilt: () => renderer.tiltOn,
    setTilt(b) { renderer.tiltOn = b; },
    resetZoom() { if (mode === "3d") renderer3d?.resetView(); else renderer.resetView(); },
    simTimeNow: () => (mode === "3d" && sim3d ? sim3d.simTime : sim.simTime),
    // ---- TRUE-3D mode surface
    getMode: () => mode,
    // returns the enter promise so the tour can await the switch before staging
    setMode(m) {
      if (m === mode) return;
      // the panel treats the specimen ON STAGE — a dimension switch swaps the
      // specimen, its census and its model constants, so close rather than
      // leave a run button aimed at a solver that is no longer there
      if (heat?.active) heat.close();
      if (m === "3d") return enter3D();
      exit3D();
    },
    closeTour() { tour.close(); },
    // a running experiment owns the solver — switching dimension mid-pour would
    // silently discard the run the report card is about to describe
    canSwitchMode: () => caps3d.supported && !opt.active && !challenge.active
      && !mode3dPending && !lab.running && !heat?.busy,
    // ascending, and always including whatever rung the OOM ladder actually
    // landed on — otherwise a GPU that fell back shows an empty selection
    caps3dSizes: () => {
      const rungs = [...GRID3_LADDER].filter(v => v <= caps3d.maxN);
      if (!rungs.includes(grid3)) rungs.push(grid3);
      return rungs.sort((a, b) => a - b);
    },
    getGrid3: () => grid3,
    setGrid3(n) {
      if (n === grid3 || !caps3d.supported || heat?.busy) return;
      grid3 = n;
      if (mode === "3d") void swapSim3D(n);
    },
    getView3d: () => view3d,
    setView3d(v) { view3d = Math.max(0, Math.min(LENS3_NAMES.length - 1, v)); },
    getSubsteps3: () => substeps3d,
    setSpeed3(v) { substeps3d = v; },
    getSliceAxis: () => slice.axis,
    setSliceAxis(a) { slice.axis = Math.max(0, Math.min(2, a)); },
    getSliceOff: () => slice.off,
    setSliceOff(v) { slice.off = Math.max(0.02, Math.min(0.98, v)); },
    getSliceTilt: () => slice.tilt,
    setSliceTilt(v) { slice.tilt = Math.max(0, Math.min(90, v)); },
    getSliceTurn: () => slice.turn,
    setSliceTurn(v) { slice.turn = ((v % 360) + 360) % 360; },
    getSliceSweep: () => slice.sweep,
    setSliceSweep(b) { slice.sweep = b; },
    getCutStyle: () => slice.style,
    setCutStyle(v) { slice.style = Math.max(0, Math.min(5, v)); },
    // the Niyama ramp's legend: the cited steel criterion with the live risk
    // census where it honestly applies, the refuse-by-name sentence where it
    // does not, and the clock anchor either way (the alloy flag moves the SI
    // value by the documented Lewis mismatch — the legend must say whose
    // second it is printing)
    niyamaLegend() {
      if (!(mode === "3d" && sim3d) || slice.style !== 5) return null;
      const u = unitsNow();
      if (!u.known) {
        return "relative ramp — the model metal carries no kelvin or second, so there is no threshold to calibrate";
      }
      const clock = sim3d.alloyActive ? "solute-diffusion clock" : "thermal clock";
      if (material === "steel") {
        const risk = lastStats3?.nyRiskFrac;
        return `Ny_crit ${u.fmtNiyama(sim3d.params.nyCrit)} — Niyama 1982 steel radiographic criterion`
          + (risk != null ? ` · ${(risk * 100).toFixed(1)} % of the measured frozen volume below it` : "")
          + ` · shrinkage feeding only — gas porosity is the Sievert card's business · ${clock}`;
      }
      return `relative map — no calibrated Ny threshold for this alloy class (the 0.775 criterion is steel radiography)`
        + ` · ramp full scale ≈ ${u.fmtNiyama(sim3d.params.nyCrit)} · shrinkage feeding only · ${clock}`;
    },
    getSym3: () => (sim3d?.params.aniMode3 === 2 ? 6 : sim3d?.params.aniMode3 === 3 ? 5 : 4),
    setSym3(j) {
      if (!sim3d) return;
      sim3d.params.aniMode3 = j === 6 ? 2 : j === 5 ? 3 : 1;
      sim3d.params.deltaZ = j === 6 ? 0.03 : 0;
      // icosahedral convexity edge sits lower than the cubic δ range
      if (j === 5) sim3d.params.delta = Math.min(sim3d.params.delta, ICOSA_DELTA_MAX);
    },
    getHabit: () => sim3d ? sim3d.params.deltaZ : NaN,
    setHabit(v) { if (sim3d) sim3d.params.deltaZ = v; },
    // alloy is a texture allocation in 3D, not just a param — route via the sim
    getAlloyOn: () => (mode === "3d" && sim3d ? sim3d.alloyActive : sim.params.alloyOn === 1),
    setAlloyOn(b) {
      if (mode === "3d" && sim3d) {
        if (b) {
          void sim3d.enableAlloy().then(ok => {
            if (ok && sim3d && renderer3d) renderer3d.rebindBGs(sim3d);
            ui.sync();
          });
        } else {
          // order matters: clear the sim's references, swap the renderer to the
          // dummy, THEN the deferred destroy inside disableAlloy fires
          sim3d.disableAlloy();
          if (renderer3d) renderer3d.rebindBGs(sim3d);
          ui.sync();
        }
        return;
      }
      sim.params.alloyOn = b ? 1 : 0;
    },
    getStereoOn: () => an3.stereoOn,
    setStereoOn(b) { an3.setStereoOn(b); },
    getIpfOn: () => an3.ipfOn,
    setIpfOn(b) { an3.setIpfOn(b); },
    getPoleOn: () => an3.poleOn,
    setPoleOn(b) { an3.setPoleOn(b); },
    getProbe3On: () => an3.probeOn,
    setProbe3On(b) { an3.setProbeOn(b); },
    getScheil3On: () => an3.scheilOn,
    setScheil3On(b) { an3.setScheilOn(b); },
    getRuler3On: () => an3.ruler3On,
    setRuler3On(b) {
      an3.setRuler3On(b);
      if (!b) { rulerLine3.style.display = "none"; rulerText3.style.display = "none"; }
    },
    exportSTL() { void exportSTL(true); },
    startTurntable() {
      if (mode !== "3d" || !renderer3d || turntable) return;
      if (!recorder) app.toggleRec();
      turntable = { t0: performance.now(), az0: renderer3d.cam().az };
    },
    // ---- OptHost
    swapSim(n) {
      const params = { ...sim.params };
      sim = new Simulation(device, n);
      sim.params = params;
      // a fresh Simulation starts at the DEFAULT pitch — carrying the params
      // over but not the scale would silently re-anchor every length readout to
      // 0.98 µm/cell, which under calibrated mode is not a cosmetic difference
      sim.umPerCell = umPerCell;
      sim.reset(1 - undercool);
      renderer.rebind(sim);
      renderer.resetView();
      hud.reset();
      lastStats = null;
      return sim;
    },
    getSim: () => sim,
    renderOnce(v) { renderer.render(sim, v as ViewMode, performance.now() / 1000); },
    captureThumb() {
      const t = document.createElement("canvas");
      t.width = 128; t.height = 128;
      const s = Math.min(canvas.width, canvas.height);
      t.getContext("2d")!.drawImage(
        canvas, (canvas.width - s) / 2, (canvas.height - s) / 2, s, s, 0, 0, 128, 128);
      return t;
    },
    onOptimizerDone() { ui.sync(); },
    shareLink() {
      if (mode === "3d" && sim3d) {
        // pack the 3D solver's own dials (packing sim.params here was a bug —
        // scen/alloy/twin/facet state never travelled)
        const p3 = { ...sim3d.params } as unknown as Record<string, number>;
        delete p3.weldX; delete p3.weldY;   // runtime-positional, like the 2D SKIP set
        return location.origin + location.pathname + packShare({
          p: p3, u: undercool, v: view3d, m: material,
          n: alloyName, mx: pouredShare(), nuc: [nuc3.p.nmax, nuc3.p.dTN, nuc3.p.dTsig], lab: labShare(), ht: heatShare(), d: 1, g3: sim3d.n,
          sl: [slice.axis, +slice.off.toFixed(3), Math.round(slice.tilt), Math.round(slice.turn), slice.style],
          seed: getSeed(),
        });
      }
      return location.origin + location.pathname + packShare({
        p: { ...sim.params }, u: undercool, v: view, m: material,
        n: alloyName, nuc: [nuc.p.nmax, nuc.p.dTN, nuc.p.dTsig], lab: labShare(), ht: heatShare(),
        sched: recipeSchedule, seed: getSeed(), mx: pouredShare(),
      });
    },
    shareRecipeLink(r: Recipe) {
      return location.origin + location.pathname + packShare({
        p: { ...sim.params, coolRate: r.cool[0] },
        u: r.undercool, v: 1, m: material, n: alloyName,
        nuc: [r.nmax, nuc.p.dTN, nuc.p.dTsig], sched: r.cool, seed: getSeed(),
      });
    },
    applyRecipe(r: Recipe) {
      // stop() has already restored the full grid; stage the winning casting
      // ARMED so the user presses run to watch their optimized recipe pour
      undercool = r.undercool;
      sim.params.coolRate = r.cool[0];
      recipeSchedule = r.cool;
      nuc.p.nmax = r.nmax;       // the optimizer's inoculant gene
      view = 1;
      app.resetArmed();          // does not clear the schedule (clearMelt does)
      ui.sync();
    },
  };

  const analyze = new Analyze({ getSim: () => sim, renderer, simParams: () => sim.params });
  const an3 = new Analyze3D({
    sim3d: () => sim3d,
    plane: () => (sim3d ? slicePlane(slice, sim3d.n) : null),
    lastStats: () => lastStats3,
  });
  // 3D probe crosshair on the shared overlay SVG (appended AFTER Analyze's
  // constructor set the overlay innerHTML — never rewrite it, append only)
  const probeMark3 = document.createElementNS("http://www.w3.org/2000/svg", "g");
  probeMark3.id = "probeMark3";
  probeMark3.style.display = "none";
  probeMark3.innerHTML =
    '<circle r="7" fill="none" stroke="#56d4dd" stroke-width="1.2"/>' +
    '<line x1="-11" x2="11" y1="0" y2="0" stroke="#56d4dd" stroke-width="1"/>' +
    '<line y1="-11" y2="11" x1="0" x2="0" stroke="#56d4dd" stroke-width="1"/>';
  document.getElementById("overlay")!.append(probeMark3);
  // 3D SDAS ruler line + readout (client-space — the drag itself is on screen)
  const rulerLine3 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  rulerLine3.id = "rulerLine3";
  rulerLine3.setAttribute("stroke", "#ffb454");
  rulerLine3.setAttribute("stroke-width", "1.4");
  rulerLine3.setAttribute("stroke-dasharray", "5 3");
  rulerLine3.style.display = "none";
  const rulerText3 = document.createElementNS("http://www.w3.org/2000/svg", "text");
  rulerText3.id = "rulerText3";
  rulerText3.setAttribute("fill", "#ffb454");
  rulerText3.setAttribute("font-size", "11");
  rulerText3.style.display = "none";
  document.getElementById("overlay")!.append(rulerLine3, rulerText3);
  let ruler3Start: [number, number, number] | null = null;
  let lastTap3: { x: number; y: number; z: number; t: number } | null = null;
  const ui = new UI(app, analyze);
  const slicePanelUI = new SlicePanel(app);
  slicePanelUI.addStyle("Niyama map · porosity risk");
  const tour = new Tour(app);
  const opt = new Optimizer(app);
  const composer = new Composer({
    reportLinkRefusals(refusals) {
      alloyCaveats = refusals.slice();
      ui.sync();
    },
    /**
     * The melt's temperature in °C for the composer's diagram cursor.
     *
     * Three separate nulls, and they are three separate facts. `meanLiqT` is
     * null once the casting is fully solid — sim.ts returns null and never 0,
     * because 0 is a legitimate dimensionless temperature one whole reference
     * interval below the melting point. `units.known` is false for a material
     * with no SI identity, which is the BOOT DEFAULT (`generic`), and there the
     * converter returns NaN by design so "we do not know" stays visibly
     * different from "zero". And `lastStats` is nulled by every reset, so there
     * is a quarter-second gap after a re-arm with nothing to report.
     *
     * Mode-aware for the same reason `unitsNow()` is: the 3D branch of the
     * frame loop returns before the 2D stats block, so `lastStats` is frozen
     * and stale the whole time the user is in the volume.
     */
    meltC: () => app.meltC(),
    materialKey: () => material,
    applyAlloy(materialKey, params, name, poured) {
      // setMaterial clears pouredMix and alloyCaveats, so both are re-set AFTER
      // it, never before. And when it refuses, the composed NAME is not written
      // over the material that is still live — a wrong label is worse than an
      // absent one, and this is the site that produced it.
      if (!app.setMaterial(materialKey)) {
        alloyCaveats = [`this alloy asks for a base metal ("${materialKey}") that this build does not carry — nothing was poured, and the melt is still ${MATERIALS[material].label}`];
        ui.sync();
        return;
      }
      alloyName = name;
      const dp = poured.derived.params;
      pouredMix = {
        materialKey, mix: poured.mix, derived: poured.derived,
        stamp: { alloyOn: dp.alloyOn!, c0: dp.c0!, mLiq: dp.mLiq!, kPart: dp.kPart! },
      };
      alloyCaveats = poured.caveats.slice();
      // The 2D solver takes the poured chemistry in BOTH modes. It used to be
      // written only on the 2D branch, so a pour made in TRUE-3D recorded the
      // mix in `pouredMix` while `sim.params` kept the base material's default
      // c0/mLiq/kPart — and switching back to 2D and calibrating then paired
      // one alloy's ΔT₀ with a different alloy's solute field. The two solvers
      // already share every other dial through the mode switch; the chemistry
      // is not an exception.
      Object.assign(sim.params, params);   // derived pseudo-binary overrides
      sim.params.coolRate = Math.min(sim.params.coolRate, 0.2);
      if (undercool < 0.9) undercool = 0.9; // pour = hot melt into a cold mould
      // THE WIRE, and it runs before the 3D branch for the same reason. Calibrated
      // mode is 2D-only to ENTER, but nothing forces it off on the way into the
      // volume, so `sim.params.solver` can still be QUANT while the user pours
      // in 3D. setMaterial above has just written MATERIALS[k].params over
      // whatever the calibration computed — latent, delta, dSol — so without
      // this the pour drops out of the calibration silently while the solver
      // flag still says QUANT. Re-entering setSolver re-derives W₀, τ₀, the cell
      // pitch and the latent coupling from the alloy that was actually poured.
      if (sim.params.solver === SOLVER.QUANT) setSolver(SOLVER.QUANT, sim.params.lambda);
      if (mode === "3d" && sim3d) {
        // route the pseudo-binary onto the 3D solver + allocate the solute pair
        const P = sim3d.params as unknown as Record<string, number>;
        for (const [k, v] of Object.entries(params)) if (k in P) P[k] = v as number;
        sim3d.params.coolRate = Math.min(sim3d.params.coolRate, 0.2);
        app.setAlloyOn(true);
        app.resetArmed();
        ui.sync();
        return;
      }
      app.resetArmed();
      ui.sync();
    },
  });

  // challenge host adapter
  let chSavedGrid = 1024;
  const chHost: ChallengeHost = {
    swapGrid(n) { chSavedGrid = sim.n; app.swapSim(n); },
    restoreGrid() { app.swapSim(chSavedGrid); },
    armPlayerRound(u) {
      undercool = u;
      sim.params.scen = 0;
      sim.params.alloyOn = 0;
      sim.params.coolRate = 0.12;
      sim.params.delta = 0.045;
      sim.params.aniMode = 4;
      sim.params.noiseAmp = 0.012;
      sim.params.latent = 1.5;
      sim.params.twinProb = 0;
      nuc.p.nmax = 260;
      sim.reset(1 - u);
      hud.reset();
      lastStats = null;
      nuc.stage(sim.n, false);
      running = true;
      substeps = 30;
      ui.sync();
    },
    async measureNow() {
      let s: StatsResult | null = null;
      for (let tries = 0; tries < 40 && !s; tries++) {
        s = await sim.readStats();
        if (!s) await sim.device.queue.onSubmittedWorkDone();
      }
      return s;
    },
    startAI(target, limit, onDone) { opt.start(sim.n, { target, limit, onDone }); },
    simTime: () => sim.simTime,
    syncUI() { ui.sync(); },
  };
  const challenge = new Challenge(chHost);

  // ------------------------------------------------------------- LAB MODE
  const labHost: LabHost = {
    getMode: () => mode,
    units: () => unitsNow(),
    simParams: () => app.simParams() as unknown as Record<string, number>,
    simTimeNow: () => app.simTimeNow(),
    clearMelt: u => app.clearMelt(u),
    setInoculant: v => app.setInoculant(v),
    setRun: on => app.setRun(on),
    setView: v => { if (mode !== "3d") view = v as ViewMode; },
    setView3d: v => { if (mode === "3d") app.setView3d(v); },
    resetArmed: () => app.resetArmed(),
    syncUI: () => ui.sync(),
    gridN: () => (mode === "3d" && sim3d ? sim3d.n : sim.n),
    setMoldWalls(on) {
      // the 3D solver rasterizes a mould shell into its mask; in 2D the walls
      // are the domain edges, so there is no geometry to switch on
      if (sim3d) sim3d.moldShell = on;
    },
    setMold(kind) {
      if (sim3d) sim3d.setMold(kind);
    },
    nucFired: () => (mode === "3d" ? nuc3 : nuc).fired,
    nucMax: () => (mode === "3d" ? nuc3 : nuc).p.nmax,
    maxUndercool: () => (mode === "3d" ? nuc3 : nuc).maxUndercool,
    setFilmSites(frac) { nuc.setFilm(frac); nuc3.setFilm(frac); },
    labShareLink: () => app.shareLink(),
    // L4: the same guaranteed-fresh census the heat-treat verdict stands on —
    // one measure() (declared below, resolved at call time), so the two cards
    // can never disagree about what was measured
    measureCensus: () => heatHost.measure(),
    // M4: the step block's own report — one region per section, thinnest
    // first. null for any other mould (including mid-pour shape changes the
    // UI never actually offers, but a stale share link could ask for).
    async measureSections() {
      if (mode !== "3d" || !sim3d || sim3d.moldKind !== "step") return null;
      const n = sim3d.n;
      const t = moldWallThickness(n);
      const secs = stepSectionBounds(n, t);
      const out: { heightVox: number; census: Census }[] = [];
      for (const s of secs) {
        let raw: Awaited<ReturnType<Sim3D["readRegion"]>> = null;
        for (let tries = 0; tries < 40 && !raw; tries++) {
          raw = await sim3d.readRegion([s.xlo, s.ylo, s.floorZ], [s.xhi, s.yhi, n]);
          if (!raw) await sim3d.device.queue.onSubmittedWorkDone();
        }
        if (!raw) return null;
        const regionVoxTotal = (s.xhi - s.xlo) * (s.yhi - s.ylo) * (n - s.floorZ);
        out.push({ heightVox: s.heightVox, census: regionCensus(raw, regionVoxTotal) });
      }
      return out;
    },
  };
  const lab = new Lab(labHost);

  // ---------------------------------------------------------- HEAT TREAT
  // the volume's census in the panel's shape: no plane areas, no plane ASTM —
  // the ⟨V⟩-equivalent diameter comes from meanVolVox instead
  const census3 = (s: StatsResult3D): Census => ({
    fracSolid: s.fracSolid, grainCount: s.grainCount,
    meanAreaPx: 0, meanVolVox: s.meanVolVox, astm: null,
  });
  const heatHost: HeatHost = {
    getMode: () => mode,
    materialKey: () => material,
    materialLabel: () => alloyName,
    alloyCaveats: () => alloyCaveats.slice(),
    si: () => (MATERIALS[material] ?? MATERIALS.generic).si ?? null,
    alloyOn: () => (mode === "3d" && sim3d ? sim3d.params.alloyOn > 0 : sim.params.alloyOn > 0),
    gridN: () => (mode === "3d" && sim3d ? sim3d.n : sim.n),
    umPerCell: () => umPerCell,
    // 2D StatsResult carries the Census fields structurally; 3D is adapted
    async measure() {
      if (mode === "3d" && sim3d) {
        let s3: StatsResult3D | null = null;
        for (let tries = 0; tries < 40 && !s3; tries++) {
          s3 = await sim3d.readStats();
          if (!s3) await sim3d.device.queue.onSubmittedWorkDone();
        }
        return s3 ? census3(s3) : null;
      }
      let s: StatsResult | null = null;
      for (let tries = 0; tries < 40 && !s; tries++) {
        s = await sim.readStats();
        if (!s) await sim.device.queue.onSubmittedWorkDone();
      }
      return s;
    },
    anneal: (sweeps, onProgress, pin) =>
      mode === "3d" && sim3d
        ? sim3d.anneal(sweeps, undefined, onProgress, pin)
        : sim.anneal(sweeps, undefined, onProgress, pin),
    // v7.0 C3a: the cold-work deposit and the recovery ordinate it banks. Both
    // are volume-only and both no-op in the plane rather than throwing — the
    // panel already refuses to render the dial there, so reaching either of
    // these in 2D would mean a mode switch outran a latched plan, and the right
    // answer to that is a treatment with no stored energy, not a crash.
    deposit: (workJb) => { if (mode === "3d" && sim3d) sim3d.deposit(workJb); },
    clearWork: () => { if (mode === "3d" && sim3d) sim3d.clearStored(); },
    storedRec: () => (mode === "3d" && sim3d ? sim3d.storedRec : 0),
    cubic: () => to3D(MATERIALS[material] ?? MATERIALS.generic).aniMode3 === 1,
    // Σ3 twinning: plate-nucleation events interleaved with the sweep chunks.
    // The host's job is the BUDGET — events target ~0.8 per existing grain
    // (annealed FCC metals carry a few twins per grain, and some plates get
    // swallowed), bounded by the remaining id range — and the honest count:
    // spawned is what the allocator actually delivered, and saturation is
    // reported rather than silently truncating the twin density.
    async annealTwins(sweeps, onProgress, pin) {
      if (!(mode === "3d" && sim3d)) {
        return { delivered: await sim.anneal(sweeps, undefined, onProgress, pin), spawned: 0, saturated: false };
      }
      const s3 = sim3d;
      const ctr0 = await s3.readTwinCtr();
      const avail = Math.max(0, (ctr0 ?? s3.nextId) - s3.nextId - 4);
      const grains = lastStats3?.grainCount ?? 500;
      const events = Math.min(Math.round(grains * 0.8), 400, avail);
      // 24 chunks bounds the readback stalls; events spread evenly, stamped
      // BEFORE each chunk so every plate faces the anneal that follows it
      const chunks = Math.max(1, Math.min(24, events));
      let delivered = 0, spawned = 0, saturated = false;
      for (let ci = 0; ci < chunks; ci++) {
        if (!saturated) {
          const per = Math.round(((ci + 1) * events) / chunks) - Math.round((ci * events) / chunks);
          for (let e = 0; e < per; e++) {
            const r = await s3.twinEvent();
            if (r === 1) spawned++;
            else if (r === -1) { saturated = true; break; }
          }
        }
        const share = Math.round(((ci + 1) * sweeps) / chunks) - Math.round((ci * sweeps) / chunks);
        if (share > 0) {
          const base = delivered;
          const got = await s3.anneal(share, undefined, done => onProgress(base + done), pin);
          delivered += got;
          if (got < share) break;   // aborted mid-chunk — report what landed
        }
      }
      return { delivered, spawned, saturated };
    },
    homogenize: (iters, onProgress) =>
      mode === "3d" && sim3d
        ? sim3d.homogenize(iters, onProgress)
        : sim.homogenize(iters, onProgress),
    // the measured segregation: RMS deviation of c over the solid skeleton.
    // A statistic, not a single-mode comparison — the exact-decay check lives
    // in HT-HOMOG, where the mode is seeded and the reference is the discrete
    // stencil eigenvalue
    async segregation() {
      if (mode === "3d" && sim3d) {
        if (!(sim3d.params.alloyOn > 0)) return null;
        const c = await sim3d.readSoluteVolume();
        const phi = await sim3d.readPhiVolume();
        if (!c || !phi) return null;
        let sum = 0, k = 0;
        for (let i = 0; i < c.length; i++) if (phi[i] >= 0.5) { sum += c[i]; k++; }
        if (!k) return null;
        const mean = sum / k;
        let ss = 0;
        for (let i = 0; i < c.length; i++) if (phi[i] >= 0.5) { const d = c[i] - mean; ss += d * d; }
        return { rms: Math.sqrt(ss / k), mean };
      }
      let rows: Float32Array | null = null;
      for (let t = 0; t < 40 && !rows; t++) {
        rows = await sim.readRows(0, sim.n);
        if (!rows) await sim.device.queue.onSubmittedWorkDone();
      }
      if (!rows) return null;
      // (φ, T, c, age) interleaved; solid and not mould
      let sum = 0, k = 0;
      for (let i = 0; i < rows.length; i += 4)
        if (rows[i] >= 0.5 && rows[i + 3] > -0.5) { sum += rows[i + 2]; k++; }
      if (!k) return null;
      const mean = sum / k;
      let ss = 0;
      for (let i = 0; i < rows.length; i += 4)
        if (rows[i] >= 0.5 && rows[i + 3] > -0.5) { const d = rows[i + 2] - mean; ss += d * d; }
      return { rms: Math.sqrt(ss / k), mean };
    },
    setRun: on => app.setRun(on),
    getView: () => (mode === "3d" ? view3d : view),
    setView: v => { if (mode === "3d") app.setView3d(v); else app.setView(v); },
    syncUI: () => ui.sync(),
  };
  heat = new HeatPanel(heatHost);

  (window as unknown as Record<string, unknown>).__solidify = {
    app, opt, tour, ui, challenge, composer, analyze, lab, heat,
    // the composer's chemistry, for headless physics checks that need to set
    // up a named alloy exactly as the UI would
    alloy: (mix: Mix) => deriveAlloy(mix),
    mode: () => mode,
    sim: () => sim,
    sim3d: () => sim3d,
    cam3: () => renderer3d?.cam() ?? null,
    vc: () => viewcube,
    fps: () => fps,
    stl: () => exportSTL(false),
    tick(k: number) { for (let i = 0; i < k; i++) frameBody(last + 1000 / 60); },
    units: () => unitsNow(),
    calibrate: (lambda: number) => calibrateNow(lambda),
    setSolver: (kind: number, lambda?: number) => setSolver(kind, lambda),
    seed: () => getSeed(),
    setSeed: (s: number) => { setSeed(s); ui.sync(); },
    // the controlled-experiment layer (v7.0 C1). The cast wrappers hold the
    // frame loop's async nuc.observe off for their duration — a bench that
    // shares the ratchet with a wall-clock poll is not a controlled bench —
    // and resolve `sim` lazily so a swapSim/setGrid between casts is seen.
    experiment: {
      ...experiment,
      castTip: async (o: { lambda: number }) => {
        benchHold = true;
        try { return await experiment.castTip(sim, o); } finally { benchHold = false; }
      },
      castCensus: async (o: { undercool: number }) => {
        benchHold = true;
        try { return await experiment.castCensus(sim, nuc, o); } finally { benchHold = false; }
      },
    },
  };

  // --------------------------------------------------------------- pointer
  // mouse: click seeds immediately, drag paints, right-drag pans.
  // touch: tap seeds on release, drag paints, two fingers pinch-zoom + pan.
  let seeding = false;
  let panning = false;
  let rulerDrag = false;
  let lastPan = { x: 0, y: 0 };
  let lastSeed = { x: -1e9, y: -1e9 };
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; mx: number; my: number } | null = null;
  let touchTap: { x: number; y: number; id: number } | null = null;
  const hideHint = () => document.getElementById("hint")!.classList.add("gone");

  // 3D pointer grammar: left-drag orbits, right-drag pans, wheel dollies,
  // pinch = dolly + pan, a clean quick tap (any pointer type) seeds at depth,
  // shift-drag scrubs the section plane while the SLICE lens is active
  const p3 = {
    pts: new Map<number, { x: number; y: number }>(),
    pinch: null as null | { d: number; my: number },
    drag: null as null | { x: number; y: number; sx: number; sy: number; t: number; btn: number; shift: boolean; moved: boolean },
    down(e: PointerEvent) {
      // armed SDAS ruler owns the drag — orbit yields (2D short-circuit port)
      if (an3.ruler3On && sim3d && e.button === 0) {
        const g = renderer3d?.pickSeedPoint(
          e.clientX, e.clientY,
          view3d === 2 ? slicePlane(slice, sim3d.n) : null);
        if (g) {
          ruler3Start = g;
          an3.beginRuler3(g);
          rulerLine3.setAttribute("x1", String(e.clientX));
          rulerLine3.setAttribute("y1", String(e.clientY));
          rulerLine3.setAttribute("x2", String(e.clientX));
          rulerLine3.setAttribute("y2", String(e.clientY));
          rulerLine3.style.display = "";
          rulerText3.style.display = "none";
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pts.size === 2) {
        this.drag = null;
        const [a, b] = [...this.pts.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), my: (a.y + b.y) / 2 };
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      this.drag = {
        x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
        t: performance.now(), btn: e.button, shift: e.shiftKey, moved: false,
      };
    },
    move(e: PointerEvent) {
      if (ruler3Start) {
        rulerLine3.setAttribute("x2", String(e.clientX));
        rulerLine3.setAttribute("y2", String(e.clientY));
        return;
      }
      if (this.pts.has(e.pointerId)) this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pts.size === 2) {
        const [a, b] = [...this.pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        renderer3d?.dollyBy(Math.pow(this.pinch.d / Math.max(d, 1e-3), 1.0));
        this.pinch = { d, my: (a.y + b.y) / 2 };
        return;
      }
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 6)
        this.drag.moved = true;
      if (this.drag.moved) {
        if (this.drag.btn === 2) renderer3d?.panTargetBy(dx, dy);
        else if (this.drag.shift && view3d === 2) app.setSliceOff(slice.off - dy * 0.0022);
        else renderer3d?.orbitBy(dx, dy);
      }
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    },
    up(e: PointerEvent, isUp: boolean) {
      if (ruler3Start && isUp && sim3d) {
        const g = renderer3d?.pickSeedPoint(
          e.clientX, e.clientY,
          view3d === 2 ? slicePlane(slice, sim3d.n) : null);
        ruler3Start = null;
        if (g) {
          void an3.endRuler3(g).then(txt => {
            rulerText3.textContent = txt;
            rulerText3.setAttribute("x", String(e.clientX + 10));
            rulerText3.setAttribute("y", String(e.clientY - 8));
            rulerText3.style.display = "";
          });
        }
        return;
      }
      this.pts.delete(e.pointerId);
      if (this.pts.size < 2) this.pinch = null;
      const d = this.drag;
      this.drag = null;
      if (!isUp || !d || d.moved || d.btn !== 0) return;
      if (performance.now() - d.t > 350) return;
      // ctrl-tap relocates the cooling probe (2D grammar port) — checked first
      if (e.ctrlKey && an3.probeOn && sim3d) {
        const g = renderer3d?.pickSeedPoint(
          e.clientX, e.clientY,
          view3d === 2 ? slicePlane(slice, sim3d.n) : null);
        if (g) {
          sim3d.probe = { x: g[0], y: g[1], z: g[2] };
          an3.reset();
          hideHint();
        }
        return;
      }
      // weld scenario: a tap steers the laser on the top face instead of seeding
      if (sim3d && sim3d.params.scen === 2) {
        const w = renderer3d?.pickSeedPoint(e.clientX, e.clientY, { n: [0, 0, 1], c: sim3d.n - 1 });
        if (w) {
          sim3d.params.weldX = w[0];
          sim3d.params.weldY = w[1];
          weldAuto = false;
          hideHint();
        }
        return;
      }
      const g = renderer3d?.pickSeedPoint(
        e.clientX, e.clientY,
        view3d === 2 && sim3d ? slicePlane(slice, sim3d.n) : null);
      if (g && sim3d) {
        // double-tap guard (2D lastSeed parity): the same spot within 600 ms
        // stays one seed — jittery taps don't stack nuclei
        const nowT = performance.now();
        const minD = Math.max(4, sim3d.n * 0.03);
        if (lastTap3 && nowT - lastTap3.t < 600 &&
            Math.hypot(g[0] - lastTap3.x, g[1] - lastTap3.y, g[2] - lastTap3.z) < minD) return;
        lastTap3 = { x: g[0], y: g[1], z: g[2], t: nowT };
        if (d.shift || e.shiftKey) sim3d.addTwinSeed3D(g[0], g[1], g[2], brush);
        else sim3d.addSeed3D(g[0], g[1], g[2], brush);
        hideHint();
      }
    },
    wheel(e: WheelEvent) {
      renderer3d?.dollyBy(Math.exp(e.deltaY * 0.0012));
    },
  };

  const seedAt = (e: PointerEvent) => {
    const g = renderer.clientToGrid(e.clientX, e.clientY, sim.n);
    if (!g) return;
    if (sim.params.scen === 2) {
      // steer the laser instead of seeding
      sim.params.weldX = g.x;
      sim.params.weldY = g.y;
      if (weldAuto) { weldAuto = false; ui.sync(); }
      hideHint();
      return;
    }
    const minDist = Math.max(6, sim.n * 0.012);
    if (Math.hypot(g.x - lastSeed.x, g.y - lastSeed.y) < minDist) return;
    lastSeed = g;
    if (e.shiftKey) sim.addTwinSeed(g.x, g.y, brush);
    else sim.addSeed(g.x, g.y, brush);
    hideHint();
  };

  canvas.addEventListener("pointerdown", e => {
    if (mode === "3d") { p3.down(e); return; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      // second finger: become a pinch, cancel any tap/paint in progress
      seeding = false;
      touchTap = null;
      rulerDrag = false;
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (e.button === 2) {
      panning = true;
      lastPan = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || opt.active) return;
    const g = renderer.clientToGrid(e.clientX, e.clientY, sim.n);
    if (analyze.rulerOn && g) { rulerDrag = true; analyze.beginRuler(g); return; }
    if (e.ctrlKey && analyze.probeOn && g) { analyze.setProbe(g.x, g.y); return; }
    if (e.pointerType === "touch") { touchTap = { x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
    seeding = true;
    seedAt(e);
  });
  canvas.addEventListener("pointermove", e => {
    if (mode === "3d") { p3.move(e); return; }
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      renderer.zoomAt(mx, my, d / Math.max(pinch.d, 1e-3));
      renderer.panBy(mx - pinch.mx, my - pinch.my);
      pinch = { d, mx, my };
      return;
    }
    if (panning) {
      renderer.panBy(e.clientX - lastPan.x, e.clientY - lastPan.y);
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (rulerDrag) {
      const g = renderer.clientToGrid(e.clientX, e.clientY, sim.n);
      if (g) analyze.dragRuler(g);
    } else if (touchTap && e.pointerId === touchTap.id) {
      if (Math.hypot(e.clientX - touchTap.x, e.clientY - touchTap.y) > 9) {
        touchTap = null;
        seeding = true;   // finger is dragging: paint seeds
      }
    } else if (seeding && !opt.active) {
      seedAt(e);
    }
  });
  for (const ev of ["pointerup", "pointercancel"] as const)
    canvas.addEventListener(ev, e => {
      if (mode === "3d") { p3.up(e, ev === "pointerup"); return; }
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (rulerDrag) { rulerDrag = false; void analyze.endRuler(); }
      if (touchTap && e.pointerId === touchTap.id) {
        if (ev === "pointerup") seedAt(e);   // clean tap: seed on release
        touchTap = null;
      }
      seeding = false;
      panning = false;
      lastSeed = { x: -1e9, y: -1e9 };
    });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    if (mode === "3d") { p3.wheel(e); return; }
    renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
  }, { passive: false });

  window.addEventListener("keydown", e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") { e.preventDefault(); app.setRun(!app.isRunning()); ui.sync(); }
    if (mode === "3d") {
      if (/^[1-9]$/.test(e.key)) { app.setView3d(parseInt(e.key) - 1); ui.sync(); }
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      const lens = e.key === "0" ? 9 : parseInt(e.key) - 1;
      app.setView(lens);
      ui.sync();
    }
  });

  // -------------------------------------------------------------- scale bar
  function updateScalebar() {
    let umPerCssPx: number;
    if (mode === "3d") {
      // 3D: shown for the SLICE lens (a section micrograph earns a scale bar);
      // scale taken at the camera-target distance, voxel = the 2D cell pitch
      if (view3d !== 2 || !renderer3d || !sim3d) return;
      umPerCssPx = sim3d.umPerCell / renderer3d.cssPerVoxel();
    } else {
      if (view !== 2) return;
      const cssPxPerCell = renderer.cssPxPerCell(sim.n);
      umPerCssPx = sim.umPerCell / cssPxPerCell;
    }
    let bestUm = 100;
    let bestErr = Infinity;
    for (const um of [5, 10, 20, 50, 100, 200, 500]) {
      const w = um / umPerCssPx;
      const err = Math.abs(w - 80);
      if (w > 30 && w < 160 && err < bestErr) { bestErr = err; bestUm = um; }
    }
    (document.querySelector("#scalebar .bar") as HTMLElement).style.width = `${bestUm / umPerCssPx}px`;
    document.getElementById("scalelabel")!.textContent = `${bestUm} µm`;
  }

  // ------------------------------------------------------------------ loop
  let last = performance.now();
  let statsClock = 0;
  let nucClock = 0;   // faster sub-cadence feeding the nucleation model

  function frame(t: number) {
    try {
      frameBody(t);
    } catch (err) {
      console.error("[solidify] frame error:", err);
    }
    requestAnimationFrame(frame);
  }

  // liquidus of the current charge: pure metal melts at 1, an alloy lower by
  // its liquidus slope. Undercooling is measured from here.
  const tEq2 = () => (sim.params.alloyOn ? 1 - sim.params.mLiq * sim.params.c0 : 1);
  const tEq3 = () => (sim3d?.params.alloyOn ? 1 - sim3d.params.mLiq * sim3d.params.c0 : 1);
  // how fast the melt is losing temperature right now — used only to bridge
  // between stats readbacks, never as the undercooling itself
  const coolProxy = () => Math.max(0, sim.params.coolRate);
  const coolProxy3 = () => Math.max(0, sim3d?.params.coolRate ?? 0);

  function frameBody(t: number) {
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = Math.max(last, t);
    if (dt > 0) fps = fps * 0.95 + (1 / dt) * 0.05;
    slicePanelUI.update(mode === "3d" && view3d === 2);
    // the composer's phase diagram, beside the slice panel and for the same
    // reason: both sit ABOVE the 2D/3D branch below, so they keep ticking in
    // the volume where the `return` at the end of the 3D block would otherwise
    // strand them. Both early-out when closed.
    composer.tick();

    // ------------------------------------------------------- TRUE-3D branch
    if (mode === "3d") {
      if (sim3d && renderer3d) {
        if (running3d) {
          if (lab.running) lab.tick(substeps3d * speedMult * sim3d.params.dt);
          nuc3.update(sim3d.simTime, coolProxy3(), (x, y, z, d) =>
            sim3d!.addSeed3D(x, y, z, 3.0, undefined, d));
          // weld auto-raster on the top face (2D serpentine port)
          if (sim3d.params.scen === 2 && weldAuto) {
            const p3d = sim3d.params;
            p3d.weldX += weldDir * weldSweep * dt;
            const margin = sim3d.n * 0.08;
            if (p3d.weldX > sim3d.n - margin || p3d.weldX < margin) {
              weldDir *= -1;
              p3d.weldX = Math.max(margin, Math.min(sim3d.n - margin, p3d.weldX));
              p3d.weldY += sim3d.n * 0.14;
              if (p3d.weldY > sim3d.n * 0.9) p3d.weldY = sim3d.n * 0.15;
            }
          }
          sim3d.step(substeps3d * speedMult);
        } else if (!heat?.busy) {
          // stamp queued taps so staging is visible while armed — but never
          // during a treatment: a stamp writes φ, and solid state means it can't
          sim3d.step(0);
        }
        // 360° turntable: constant-rate spin while the recorder runs
        if (turntable) {
          if (!recorder) {
            turntable = null;   // user stopped the recording early
          } else {
            const u2 = (t - turntable.t0) / 6000;
            renderer3d.spinTo(turntable.az0 + 2 * Math.PI * Math.min(u2, 1));
            if (u2 >= 1) { turntable = null; app.toggleRec(); }
          }
        }
        // CT sweep: the section plane serially sweeps the volume (pairs with ⏺ rec)
        if (slice.sweep && view3d === 2) {
          slice.off += slice.sweepDir * 0.08 * dt;
          if (slice.off > 0.98) { slice.off = 0.98; slice.sweepDir = -1; }
          if (slice.off < 0.02) { slice.off = 0.02; slice.sweepDir = 1; }
        }
        renderer3d.tick(dt);
        renderer3d.render(sim3d, view3d, t / 1000, slicePlane(slice, sim3d.n), slice.style);
        viewcube?.draw(renderer3d.cam());
        // probe crosshair rides the projection (perspective, so every frame)
        if (an3.probeOn && sim3d.probe) {
          const pc = renderer3d.worldToClient([sim3d.probe.x, sim3d.probe.y, sim3d.probe.z]);
          if (pc) {
            probeMark3.setAttribute("transform", `translate(${pc[0]}, ${pc[1]})`);
            probeMark3.style.display = "";
          } else probeMark3.style.display = "none";
        } else probeMark3.style.display = "none";

        statsClock += dt;
        // the nucleation model needs the melt temperature far more often than
        // the panels do, so poll every frame while sites are still waiting and
        // let the readback's own in-flight guard throttle it
        nucClock += dt;
        const forPanels3 = statsClock > 0.25;
        // 20 Hz is five times the panel cadence — enough resolution for the
        // ratchet without running a 7-million-voxel reduction every frame
        const wantFast3 = running3d && nuc3.p.nmax > 0 && nuc3.fired < nuc3.p.nmax && nucClock > 0.05;
        if (forPanels3) statsClock = 0;
        if (wantFast3) nucClock = 0;
        if (forPanels3 || wantFast3) {
          syncNyCrit();   // material/anchor changes land within one poll
          void sim3d.readStats().then(s => {
            if (!s || !sim3d) return;
            nuc3.observe(sim3d.simTime, s.meanLiqT, tEq3());
            // the lab reads the OPEN-volume fraction: with a mould shell the
            // whole-domain fs asymptotes at the open fraction (~0.85), which
            // is why the fs > 0.995 finish could never fire with walls on
            lab.onStats(s.meanLiqT, s.fracSolidOpen);
            if (forPanels3) {
              lastStats3 = s; hud.push3(s, sim3d.umPerCell); an3.onStats3(s, sim3d.simTime);
              heat?.onCensus(census3(s));
            }
          });
        }
        if (forPanels3) {
          // GPU-born twins live only in the GPU quat buffer — mirror them back
          // for the IPF/pole panels while the twin rate is nonzero
          if (sim3d.params.twinProb > 0) void sim3d.refreshQuats();
          an3.tick(0.25);
          updateScalebar();
          const s = lastStats3;
          const u = unitsNow();
          ui.setReadouts([
            ["t", u.fmtTime(sim3d.simTime)],
            ["melt", s?.meanLiqT != null ? u.fmtC(s.meanLiqT) : "—"],
            ["solid", s ? `${(s.fracSolid * 100).toFixed(1)} %` : "—"],
            ["grains", s ? String(s.grainCount) : "—"],
            ["d̄ eq", s?.eqDiamUm != null ? `${s.eqDiamUm.toFixed(0)} µm` : "—"],
            ["sites", nuc3.p.nmax > 0 ? `${nuc3.fired}/${nuc3.p.nmax.toFixed(0)}` : "—"],
            ["pores", s ? `${(s.poreFrac * 100).toFixed(2)} %` : "—"],
            ["fps", `${fps.toFixed(0)} · ${sim3d.n}³`],
          ]);
        }
      }
      return;
    }

    if (opt.active) {
      opt.tick();
      // when paused, tick() is a no-op — keep the stage live so it isn't frozen
      if (!opt.isRunning()) renderer.render(sim, 1, t / 1000);
    } else {
      // a bench cast owns the transport too, not just the observe below: with
      // the transport live this branch would inject frame-paced nuc.update +
      // sim.step around the cast's fence-paced chunks (Space mid-cast is
      // enough). The fall-through to the idle stamp branch is the interleave
      // castCensus's drain is already sized for.
      if (running && !benchHold) {
        // heterogeneous nucleation: sites fire as the melt sweeps past their
        // activation undercooling. No rate is specified anywhere — recalescence
        // stalls the sweep, so latent heat shuts nucleation off by itself.
        if (lab.running) lab.tick(substeps * speedMult * sim.params.dt);
        nuc.update(sim.simTime, coolProxy(), (x, y, _z, d) => sim.addSeed(x, y, 3.5, undefined, d));
        // weld auto-raster
        if (sim.params.scen === 2 && weldAuto) {
          sim.params.weldX += weldDir * weldSweep * dt;
          const margin = sim.n * 0.08;
          if (sim.params.weldX > sim.n - margin || sim.params.weldX < margin) {
            weldDir *= -1;
            sim.params.weldX = Math.max(margin, Math.min(sim.n - margin, sim.params.weldX));
            sim.params.weldY += sim.n * 0.14;
            if (sim.params.weldY > sim.n * 0.9) sim.params.weldY = sim.n * 0.15;
          }
        }
        sim.step(substeps * speedMult);
      } else if (!heat?.busy) {
        // stamp queued taps so staging is visible while armed — but never
        // during a treatment: a stamp writes φ, and solid state means it can't
        sim.step(0);
      }
      renderer.render(sim, view, t / 1000);
    }
    analyze.applyProbe();
    analyze.updateOverlay();

    statsClock += dt;
    // as in 3D: the panels want 4 Hz, the nucleation model wants every frame
    // it can get while sites are still unfired
    nucClock += dt;
    const forPanels = statsClock > 0.25;
    const wantFast = running && !opt.active && nuc.p.nmax > 0
      && nuc.fired < nuc.p.nmax && nucClock > 0.05;
    if (forPanels) statsClock = 0;
    if (wantFast) nucClock = 0;
    if (forPanels || wantFast) {
      void sim.readStats().then(s => {
        if (!s) return;
        if (!benchHold) nuc.observe(sim.simTime, s.meanLiqT, tEq2());
        lab.onStats(s.meanLiqT, s.fracSolid);
        if (!forPanels) return;
        lastStats = s;
        if (!opt.active) {
          hud.push(s);
          analyze.onStats(s, sim.simTime);
          // an applied ML recipe schedules cooling by solid fraction,
          // exactly as the optimizer's episodes did
          if (recipeSchedule && running) {
            sim.params.coolRate =
              s.fracSolid < 0.33 ? recipeSchedule[0] :
              s.fracSolid < 0.66 ? recipeSchedule[1] : recipeSchedule[2];
          }
        }
        challenge.onStats(s);
        heat?.onCensus(s);
      });
    }
    if (forPanels) {
      const s = lastStats;
      const u = unitsNow();
      ui.setReadouts([
        ["t", u.fmtTime(sim.simTime)],
        ["melt", s?.meanLiqT != null ? u.fmtC(s.meanLiqT) : "—"],
        ["solid", s ? `${(s.fracSolid * 100).toFixed(1)} %` : "—"],
        ["grains", s ? String(s.grainCount) : "—"],
        ["ASTM", s?.astm != null ? `G ${s.astm.toFixed(1)}` : "—"],
        ["sites", nuc.p.nmax > 0 ? `${nuc.fired}/${nuc.p.nmax.toFixed(0)}` : "—"],
        ["ΔT max", u.fmtK(nuc.maxUndercool)],
        ["fps", `${fps.toFixed(0)} · ${sim.n}²${renderer.zoom > 1.01 ? ` · ${renderer.zoom.toFixed(1)}×` : ""}`],
      ]);
      updateScalebar();
    }
  }

  /** the lab's experiment sheet, packed only when the lab is open */
  function labShare(): ShareState["lab"] {
    if (!lab.active) return undefined;
    const s = lab.setup;
    return [s.atmosphere, s.inoculant, s.superheat, s.moldT, s.moldWalls ? 1 : 0, s.program, s.holdMin, s.specMPa, s.mold];
  }

  /** the heat-treat setup — same doctrine: packed only while the panel is open */
  function heatShare(): ShareState["ht"] {
    return heat?.active ? heat.setup() : undefined;
  }

  // links made before v4.0 carry a wall-clock "seeds per second" rain; read it
  // as a site count so old setups still pour something recognisable
  function applyNucShare(N: Nucleation, s: ShareState) {
    if (s.nuc) {
      N.p.nmax = s.nuc[0]; N.p.dTN = s.nuc[1]; N.p.dTsig = s.nuc[2];
    } else {
      N.p.nmax = Math.min(3000, Math.round((s.rain ?? 0) * 40));
    }
  }

  // boot scene: a lone dendrite, instantly; ?tour=1 deep link opens the tour;
  // #alloy=… deep link pours a shared composition and runs it
  SCENES.dendrite(app);
  if (new URLSearchParams(location.search).has("tour")) tour.goto(0);
  if (location.hash.includes("alloy=") && composer.applyHash(location.hash)) {
    app.scatterSeeds(6);
    app.setView(0);
    app.setRun(true);
  }
  // shared-setup deep link: restore the whole instrument state, ARMED
  const shared: ShareState | null = location.hash.includes("set=") ? unpackShare(location.hash) : null;
  if (shared) {
    // FIRST, before anything that draws. setMaterial re-stages the charge and
    // applyNucShare below re-draws the whole site population — a seed applied
    // after either of those would be a seed the restored cast never used, which
    // is the same shape as the H7 clobber (the damage lives in the applier, not
    // the decoder). Number.isFinite whitelist per the g3 doctrine: a hand-built
    // link with a string seed keeps the page's own rather than hashing NaN.
    if (typeof shared.seed === "number" && Number.isFinite(shared.seed)) setSeed(shared.seed);
    const sharedMaterialTook = MATERIALS[shared.m] ? app.setMaterial(shared.m) : false;
    // The poured mix, restored BEFORE the params block below — which re-runs
    // setSolver for a calibrated link, and setSolver reads pouredMix. Restored
    // by hand rather than through applyAlloy, because applyAlloy is a POUR: it
    // would raise the undercooling, cap the cooling rate and re-arm the melt,
    // none of which the link asked for. setMaterial above has already cleared
    // any previous mix, so this is a set on a known-empty slot.
    let clampedChem: Record<string, number> | null = null;
    if (sharedMaterialTook && typeof shared.mx === "string") {
      const linkRefusals: string[] = [];
      const linkClamped: string[] = [];
      const mix = decodeMix("alloy=" + shared.mx, linkRefusals, linkClamped);
      if (mix && Object.keys(mix.wt).length) {
        const d = deriveAlloy(mix);
        if (BASES[mix.base]?.materialKey === shared.m) {
          // The link's own `p` block is assigned a few lines below, and it
          // carries the c0/mLiq/kPart the minter was running — so the stamp is
          // taken from the mix's derivation, which is what those params were,
          // and the staleness check then confirms the two agree.
          const dp = d.params;
          pouredMix = {
            materialKey: shared.m, mix, derived: d,
            stamp: { alloyOn: dp.alloyOn!, c0: dp.c0!, mLiq: dp.mLiq!, kPart: dp.kPart! },
          };
          // notGrown rides here for the same reason it rides in composer.pour():
          // a #set= link restores a melt without ever opening the composer, and
          // the phases equilibrium leaves in it are exactly what a recipient
          // cannot otherwise see.
          alloyCaveats = [...linkRefusals, ...d.refusals, ...d.notGrown, ...d.clamps];
          // THE FOURTH ROUTE PAST THE CEILING, and the only one that reaches
          // the kernel. `shared.p` is assigned onto sim.params a few lines
          // below and carries the c0/mLiq/kPart the MINTER was running — so a
          // link minted before v7.1 P3 from a 3 wt% carbon melt restores its
          // mix clamped to 0.52 wt%, prints the clamp, draws the clamped
          // diagram, and then hands the solver the cast iron anyway. The mix
          // and the melt would disagree in the one place a user cannot see.
          //
          // Applied ONLY when the decoder actually clamped, which is why
          // decodeMix reports that as a list of elements rather than leaving
          // main.ts to match on a sentence. Without that condition this would
          // also overwrite the legitimate case P1 already handles: a c0 slider
          // moved AFTER the pour, where the link's params and the mix's
          // derivation are meant to differ.
          if (linkClamped.length) {
            clampedChem = { alloyOn: dp.alloyOn!, c0: dp.c0!, mLiq: dp.mLiq!, kPart: dp.kPart!, dSol: dp.dSol! };
            alloyCaveats.push(`this link's solver settings were minted from a composition this build no longer pours (${linkClamped.join(", ")}), so the chemistry the solver runs was re-derived from the restored mix rather than restored from the link`);
          }
        } else {
          alloyCaveats = [`this link's mix is ${BASES[mix.base]?.label ?? mix.base}-based but its material is ${MATERIALS[shared.m].label} — the chemistry was not applied, and the calibration uses the material's own coefficients`];
        }
      } else if (linkRefusals.length) {
        alloyCaveats = linkRefusals;
      }
    }
    // scen numbers mean different things per mode — never cross-assign a 3D
    // link's params into the 2D solver
    if (shared.d !== 1) {
      Object.assign(sim.params, shared.p);
      // ...and the clamped chemistry wins over the link's own, when the mix it
      // describes is one this build refuses. Order matters: this must land
      // AFTER the bulk assign, or the assign puts the refused melt back.
      if (clampedChem) Object.assign(sim.params, clampedChem);
      // A calibrated link carries λ and the material, and NOTHING else it needs:
      // dx and dt are on the share blacklist (they are grid-derived), and under
      // this solver they are also material-derived. Re-running the calibration
      // is therefore both necessary and sufficient — and it is the only route
      // that cannot restore a solver flag onto a Kobayashi timestep.
      if (sim.params.solver === SOLVER.QUANT) setSolver(SOLVER.QUANT, sim.params.lambda);
    }
    undercool = shared.u;
    view = Math.max(0, Math.min(9, Math.round(shared.v))) as ViewMode;
    applyNucShare(nuc, shared);
    if (shared.lab) {
      const [atm, ino, sup, mT, walls, prog, hold, spec, mk] = shared.lab;
      // the optional tail elements carry the g3-style Number.isFinite whitelist:
      // a hand-built link with a string hold or spec must not seed a NaN fade
      // or a NaN verdict — it decodes as "not set"; mould kind gets the same
      // whitelist treatment as atmosphere just above (a valid string or the
      // shell default — an old link missing this element decodes mk as
      // undefined, which .includes() rejects the same way)
      lab.setup = {
        atmosphere: (["air", "argon", "vacuum"].includes(atm) ? atm : "argon") as LabSetup["atmosphere"],
        inoculant: ino, superheat: sup, moldT: mT, moldWalls: walls === 1, program: prog,
        holdMin: typeof hold === "number" && Number.isFinite(hold) ? hold : 0,
        specMPa: typeof spec === "number" && Number.isFinite(spec) ? Math.max(0, spec) : 0,
        mold: (["shell", "plate", "step", "wedge"].includes(mk as string) ? mk : "shell") as LabSetup["mold"],
      };
      lab.open();
    }
    recipeSchedule = shared.sched ?? null;
    // Second instance of the same shape applyAlloy carries, and it is not in
    // the milestone plan: a link whose `m` is a material this build does not
    // have restored its alloy NAME anyway, over a material that never changed.
    // The name is only honoured when the material it belongs to was accepted.
    if (shared.n) {
      if (sharedMaterialTook) alloyName = shared.n;
      else alloyCaveats = [`this link names the melt "${shared.n}" on a base metal ("${shared.m}") this build does not carry — the name was not applied, and the melt is still ${MATERIALS[material].label}`];
    }
    app.resetArmed();   // stages it ARMED; resetArmed keeps the schedule
    // the heat-treat setup: reopen the panel with the link's dialled schedule,
    // which refuses honestly ("nothing solid to treat yet") until the pour.
    // Lab and heat share the bottom-centre slot — a hand-built link carrying
    // both is malformed, and the lab, applied above, wins. In a 3D link the
    // open waits for enter3D, because a dimension switch closes the panel.
    const openHeat = () => {
      // Number.isFinite does not coerce, so a hand-built ht carrying strings,
      // nulls or NaN is rejected whole rather than clamped into NaN dials —
      // the g3 whitelist doctrine. A malformed ht simply does not open.
      // Length 3 (pre-C2 links), 5 (with the dispersion tail) or 6 (v7.0 C3a,
      // with the cold work behind it): every element PRESENT must be a finite
      // number — the whole-rejection stance stays, only the accepted shapes
      // grew (a 4-element hand-build is still malformed, and so is a 7).
      if (Array.isArray(shared.ht) && [3, 5, 6].includes(shared.ht.length)
        && shared.ht.every(Number.isFinite) && !lab.active) heat?.open(shared.ht);
    };
    if (shared.d !== 1) openHeat();
    // a TRUE-3D setup link re-enters the 3D mode at its grid, staged ARMED
    if (shared.d === 1 && caps3d.supported) {
      const g = Math.round(shared.g3 ?? 0);
      if ([128, 160, 192].includes(g) && g <= caps3d.maxN) grid3 = g;
      view3d = Math.max(0, Math.min(LENS3_NAMES.length - 1, Math.round(shared.v)));
      applyNucShare(nuc3, shared);
      if (shared.sl) {
        app.setSliceAxis(shared.sl[0]); app.setSliceOff(shared.sl[1]);
        app.setSliceTilt(shared.sl[2]); app.setSliceTurn(shared.sl[3]);
        app.setCutStyle(shared.sl[4]);
      }
      void enter3D(true).then(() => {
        // land the packed dials AFTER apply3DMaterial would overwrite them,
        // then allocate the solute pair if the link carried alloy
        if (sim3d) {
          const P = sim3d.params as unknown as Record<string, number>;
          for (const [k, v] of Object.entries(shared.p))
            if (k in P && typeof v === "number") P[k] = v;
          if (sim3d.params.alloyOn === 1) {
            sim3d.params.alloyOn = 0;
            void sim3d.enableAlloy().then(() => {
              if (sim3d && renderer3d) renderer3d.rebindBGs(sim3d);
              ui.sync();
            });
          }
        }
        app.setView3d(view3d);
        openHeat();
        ui.sync();
      });
    }
  }
  ui.sync();
  requestAnimationFrame(frame);
}

void boot();
