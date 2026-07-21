import { Simulation, DOMAIN_MM, type StatsResult } from "./sim";
import { MATERIALS, to3D } from "./materials";
import { Renderer, type ViewMode } from "./render";
import { Sim3D, type StatsResult3D } from "./sim3d";
import { LENS3_NAMES } from "./shaders3d";
import { Renderer3D, slicePlane } from "./render3d";
import { SlicePanel } from "./slicepanel";
import { ViewCube } from "./viewcube";
import { UI, type UIHost } from "./ui";
import { Hud } from "./hud";
import { Tour, SCENES } from "./tour";
import { Optimizer, type OptHost, type Recipe } from "./optimizer";
import { packShare, unpackShare, type ShareState } from "./share";
import { Challenge, type ChallengeHost } from "./challenge";
import { Composer } from "./composer";
import { Analyze } from "./analyze";
import { Analyze3D } from "./analyze3d";
import { Nucleation } from "./nucleation";
import { Lab, type LabHost, type LabSetup } from "./lab";

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
  // Sim3D.create OOM ladder (192 -> 160 -> 128) and is remembered
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
  let recorder: MediaRecorder | null = null;
  // an applied optimizer recipe: phase-scheduled cooling driven off fracSolid,
  // exactly the way the optimizer's episodes ran it
  let recipeSchedule: [number, number, number] | null = null;

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

  /** carry the current material + shared dials onto the 3D solver */
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

  /** rebuild the 3D solver at a new grid edge (destroy first — ~283 MB at 192³) */
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

  const app: UIHost & OptHost = {
    // ---- AppControl (scenes / tour)
    clearMelt(u) {
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
      if (mode === "3d" && sim3d) {
        for (let i = 0; i < count; i++)
          sim3d.addSeed3D(Math.random() * sim3d.n, Math.random() * sim3d.n, Math.random() * sim3d.n, 3.5);
        return;
      }
      for (let i = 0; i < count; i++)
        sim.addSeed(Math.random() * sim.n, Math.random() * sim.n, 3.5);
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
      if (opt.active) opt.setRunning(on);
      else if (mode === "3d") running3d = on;
      else running = on;
    },
    setWeldAuto(on) { weldAuto = on; },
    startOptimizer() { if (!challenge.active && !lab.active) opt.start(sim.n); },
    startChallenge() { if (!opt.active && !lab.active) challenge.start(); },
    startLab() { if (!opt.active && !challenge.active) lab.open(); },
    isLabOpen: () => lab.active,
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
      if (!m) return;
      material = k;
      alloyName = m.label;
      Object.assign(sim.params, m.params);
      if (mode === "3d") apply3DMaterial();
    },
    openComposer() { if (!opt.active && !challenge.active) composer.open(); },
    getAlloyName: () => alloyName,
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
    setGrid(n) { if (n !== sim.n && !opt.active && !challenge.active) app.swapSim(n); },
    getView: () => view,
    anneal(on) {
      if (mode === "3d" && sim3d) sim3d.params.heatIn = on ? 1.1 : 0;
      else sim.params.heatIn = on ? 1.1 : 0;
    },
    quench() { if (mode === "3d" && sim3d) sim3d.quench(0.25); else sim.quench(0.25); },
    resetArmed() {
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
      if (m === "3d") return enter3D();
      exit3D();
    },
    closeTour() { tour.close(); },
    // a running experiment owns the solver — switching dimension mid-pour would
    // silently discard the run the report card is about to describe
    canSwitchMode: () => caps3d.supported && !opt.active && !challenge.active
      && !mode3dPending && !lab.running,
    caps3dSizes: () => [128, 160, 192].filter(v => v <= caps3d.maxN),
    getGrid3: () => grid3,
    setGrid3(n) {
      if (n === grid3 || !caps3d.supported) return;
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
    getSym3: () => (sim3d?.params.aniMode3 === 2 ? 6 : sim3d?.params.aniMode3 === 3 ? 5 : 4),
    setSym3(j) {
      if (!sim3d) return;
      sim3d.params.aniMode3 = j === 6 ? 2 : j === 5 ? 3 : 1;
      sim3d.params.deltaZ = j === 6 ? 0.03 : 0;
      // icosahedral convexity edge sits lower than the cubic δ range
      if (j === 5) sim3d.params.delta = Math.min(sim3d.params.delta, 0.02);
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
          n: alloyName, nuc: [nuc3.p.nmax, nuc3.p.dTN, nuc3.p.dTsig], lab: labShare(), d: 1, g3: sim3d.n,
          sl: [slice.axis, +slice.off.toFixed(3), Math.round(slice.tilt), Math.round(slice.turn), slice.style],
        });
      }
      return location.origin + location.pathname + packShare({
        p: { ...sim.params }, u: undercool, v: view, m: material,
        n: alloyName, nuc: [nuc.p.nmax, nuc.p.dTN, nuc.p.dTsig], lab: labShare(),
        sched: recipeSchedule,
      });
    },
    shareRecipeLink(r: Recipe) {
      return location.origin + location.pathname + packShare({
        p: { ...sim.params, coolRate: r.cool[0] },
        u: r.undercool, v: 1, m: material, n: alloyName,
        nuc: [r.nmax, nuc.p.dTN, nuc.p.dTsig], sched: r.cool,
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
    applyAlloy(materialKey, params, name) {
      app.setMaterial(materialKey);
      alloyName = name;
      if (mode === "3d" && sim3d) {
        // route the pseudo-binary onto the 3D solver + allocate the solute pair
        const P = sim3d.params as unknown as Record<string, number>;
        for (const [k, v] of Object.entries(params)) if (k in P) P[k] = v as number;
        sim3d.params.coolRate = Math.min(sim3d.params.coolRate, 0.2);
        if (undercool < 0.9) undercool = 0.9;
        app.setAlloyOn(true);
        app.resetArmed();
        ui.sync();
        return;
      }
      Object.assign(sim.params, params);   // derived pseudo-binary overrides
      sim.params.coolRate = Math.min(sim.params.coolRate, 0.2);
      if (undercool < 0.9) undercool = 0.9; // pour = hot melt into a cold mould
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
    nucFired: () => (mode === "3d" ? nuc3 : nuc).fired,
    nucMax: () => (mode === "3d" ? nuc3 : nuc).p.nmax,
    maxUndercool: () => (mode === "3d" ? nuc3 : nuc).maxUndercool,
    labShareLink: () => app.shareLink(),
  };
  const lab = new Lab(labHost);

  (window as unknown as Record<string, unknown>).__solidify = {
    app, opt, tour, ui, challenge, composer, analyze, lab,
    mode: () => mode,
    sim: () => sim,
    sim3d: () => sim3d,
    cam3: () => renderer3d?.cam() ?? null,
    vc: () => viewcube,
    fps: () => fps,
    stl: () => exportSTL(false),
    tick(k: number) { for (let i = 0; i < k; i++) frameBody(last + 1000 / 60); },
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
      if (view3d !== 2 || !renderer3d) return;
      umPerCssPx = (DOMAIN_MM * 1000 / 1024) / renderer3d.cssPerVoxel();
    } else {
      if (view !== 2) return;
      const cssPxPerCell = renderer.cssPxPerCell(sim.n);
      umPerCssPx = (DOMAIN_MM * 1000 / sim.n) / cssPxPerCell;
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
        } else {
          sim3d.step(0); // stamp queued taps so staging is visible while armed
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
          void sim3d.readStats().then(s => {
            if (!s || !sim3d) return;
            nuc3.observe(sim3d.simTime, s.meanLiqT, tEq3());
            lab.onStats(s.meanLiqT, s.fracSolid);
            if (forPanels3) { lastStats3 = s; hud.push3(s); an3.onStats3(s, sim3d.simTime); }
          });
        }
        if (forPanels3) {
          // GPU-born twins live only in the GPU quat buffer — mirror them back
          // for the IPF/pole panels while the twin rate is nonzero
          if (sim3d.params.twinProb > 0) void sim3d.refreshQuats();
          an3.tick(0.25);
          updateScalebar();
          const s = lastStats3;
          ui.setReadouts([
            ["t", sim3d.simTime.toFixed(3)],
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
      if (running) {
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
      } else {
        sim.step(0); // stamp queued taps so staging is visible while armed
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
        nuc.observe(sim.simTime, s.meanLiqT, tEq2());
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
      });
    }
    if (forPanels) {
      const s = lastStats;
      ui.setReadouts([
        ["t", sim.simTime.toFixed(3)],
        ["solid", s ? `${(s.fracSolid * 100).toFixed(1)} %` : "—"],
        ["grains", s ? String(s.grainCount) : "—"],
        ["ASTM", s?.astm != null ? `G ${s.astm.toFixed(1)}` : "—"],
        ["sites", nuc.p.nmax > 0 ? `${nuc.fired}/${nuc.p.nmax.toFixed(0)}` : "—"],
        ["ΔT max", nuc.maxUndercool.toFixed(3)],
        ["fps", `${fps.toFixed(0)} · ${sim.n}²${renderer.zoom > 1.01 ? ` · ${renderer.zoom.toFixed(1)}×` : ""}`],
      ]);
      updateScalebar();
    }
  }

  /** the lab's experiment sheet, packed only when the lab is open */
  function labShare(): ShareState["lab"] {
    if (!lab.active) return undefined;
    const s = lab.setup;
    return [s.atmosphere, s.inoculant, s.superheat, s.moldT, s.moldWalls ? 1 : 0, s.program];
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
    if (MATERIALS[shared.m]) app.setMaterial(shared.m);
    // scen numbers mean different things per mode — never cross-assign a 3D
    // link's params into the 2D solver
    if (shared.d !== 1) Object.assign(sim.params, shared.p);
    undercool = shared.u;
    view = Math.max(0, Math.min(9, Math.round(shared.v))) as ViewMode;
    applyNucShare(nuc, shared);
    if (shared.lab) {
      const [atm, ino, sup, mT, walls, prog] = shared.lab;
      lab.setup = {
        atmosphere: (["air", "argon", "vacuum"].includes(atm) ? atm : "argon") as LabSetup["atmosphere"],
        inoculant: ino, superheat: sup, moldT: mT, moldWalls: walls === 1, program: prog,
      };
      lab.open();
    }
    recipeSchedule = shared.sched ?? null;
    if (shared.n) alloyName = shared.n;
    app.resetArmed();   // stages it ARMED; resetArmed keeps the schedule
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
        ui.sync();
      });
    }
  }
  ui.sync();
  requestAnimationFrame(frame);
}

void boot();
