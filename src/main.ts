import { Simulation, DOMAIN_MM, type StatsResult } from "./sim";
import { MATERIALS } from "./materials";
import { Renderer, type ViewMode } from "./render";
import { UI, type UIHost } from "./ui";
import { Hud } from "./hud";
import { Tour, SCENES } from "./tour";
import { Optimizer, type OptHost, type Recipe } from "./optimizer";
import { Challenge, type ChallengeHost } from "./challenge";
import { Composer } from "./composer";
import { Analyze } from "./analyze";

const TURBO_STEPS = 150;

async function boot() {
  const gate = () => { document.getElementById("gate")!.style.display = "flex"; };
  if (!navigator.gpu) return gate();
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return gate();
  const device = await adapter.requestDevice();
  device.lost.then(info => { if (info.reason !== "destroyed") gate(); });

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  let sim = new Simulation(device, 1024);
  const renderer = new Renderer(device, canvas, sim);
  const hud = new Hud(document.getElementById("hud")!);

  // ------------------------------------------------------------- app state
  let view: ViewMode = 0;
  let running = true;
  let substeps = 14;
  let turbo = false;
  let rain = 0;
  let undercool = 1.0;
  let brush = 4;
  let weldAuto = false;
  let weldSweep = 55;      // cells per second
  let weldDir = 1;
  let rainAcc = 0;
  let lastStats: StatsResult | null = null;
  let fps = 60;
  let material = "generic";
  let alloyName = MATERIALS.generic.label;
  let recorder: MediaRecorder | null = null;
  // an applied optimizer recipe: phase-scheduled cooling driven off fracSolid,
  // exactly the way the optimizer's episodes ran it
  let recipeSchedule: [number, number, number] | null = null;

  const app: UIHost & OptHost = {
    // ---- AppControl (scenes / tour)
    clearMelt(u) {
      undercool = u;
      recipeSchedule = null;   // a new scene retires any applied recipe
      sim.reset(1 - u);
      hud.reset();
      analyze.reset();
      lastStats = null;
      sim.params.weldX = sim.n * 0.12;
      sim.params.weldY = sim.n * 0.2;
      weldDir = 1;
    },
    seedCenter() { sim.addSeed(sim.n / 2, sim.n / 2, brush + 1); hideHint(); },
    twinSeedCenter() { sim.addTwinSeed(sim.n / 2, sim.n / 2, brush + 1.5); hideHint(); },
    chillWall(edge = "auto") {
      const e = edge === "auto" ? (canvas.width >= canvas.height ? "left" : "bottom") : edge;
      sim.chillWall(e);
      hideHint();
    },
    scatterSeeds(count) {
      for (let i = 0; i < count; i++)
        sim.addSeed(Math.random() * sim.n, Math.random() * sim.n, 3.5);
    },
    setParams(p) { Object.assign(sim.params, p); },
    setRain(v) { rain = v; },
    setView(v) { view = v as ViewMode; },
    setSpeed(v) { substeps = v; turbo = false; },
    // while the optimizer owns the stage, the transport drives IT, not the melt
    setRun(on) { if (opt.active) opt.setRunning(on); else running = on; },
    setWeldAuto(on) { weldAuto = on; },
    startOptimizer() { if (!challenge.active) opt.start(sim.n); },
    startChallenge() { if (!opt.active) challenge.start(); },
    syncUI() { ui.sync(); },
    reveal(target) {
      if (target.startsWith("sec:")) ui.reveal(target.slice(4));
      else document.querySelectorAll(target).forEach(el => el.classList.add("hl"));
    },
    clearReveals() {
      document.querySelectorAll(".hl").forEach(el => el.classList.remove("hl"));
    },
    // ---- UIHost extras
    simParams: () => sim.params,
    getUndercool: () => undercool,
    setUndercool(v) { undercool = v; },
    getRain: () => rain,
    getSubsteps: () => substeps,
    isRunning: () => (opt.active ? opt.isRunning() : running),
    isEngineering: () => opt.active,
    isTurbo: () => turbo,
    toggleTurbo() { turbo = !turbo; },
    getMaterial: () => material,
    setMaterial(k) {
      const m = MATERIALS[k];
      if (!m) return;
      material = k;
      alloyName = m.label;
      Object.assign(sim.params, m.params);
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
    anneal(on) { sim.params.heatIn = on ? 1.1 : 0; },
    quench() { sim.quench(0.25); },
    resetArmed() {
      sim.reset(1 - undercool);
      hud.reset();
      analyze.reset();
      lastStats = null;
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
    getPalette: () => renderer.paletteOn,
    setPalette(b) { renderer.paletteOn = b; },
    getStain: () => renderer.stainMode,
    setStain(v) { renderer.stainMode = v; },
    getEbsd: () => renderer.ebsdOn,
    setEbsd(b) { renderer.ebsdOn = b; },
    resetZoom() { renderer.resetView(); },
    simTimeNow: () => sim.simTime,
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
    applyRecipe(r: Recipe) {
      // stop() has already restored the full grid; stage the winning casting
      // ARMED so the user presses run to watch their optimized recipe pour
      undercool = r.undercool;
      sim.params.coolRate = r.cool[0];
      recipeSchedule = r.cool;
      // optimizer rain is seeds per unit SIM-time; the app rains per wall-second
      rain = r.rain * sim.params.dt * substeps * 60;
      view = 1;
      app.resetArmed();          // does not clear the schedule (clearMelt does)
      ui.sync();
    },
  };

  const analyze = new Analyze({ getSim: () => sim, renderer, simParams: () => sim.params });
  const ui = new UI(app, analyze);
  const tour = new Tour(app);
  const opt = new Optimizer(app);
  const composer = new Composer({
    applyAlloy(materialKey, params, name) {
      app.setMaterial(materialKey);
      Object.assign(sim.params, params);   // derived pseudo-binary overrides
      alloyName = name;
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
      rain = 6;
      sim.reset(1 - u);
      hud.reset();
      lastStats = null;
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

  (window as unknown as Record<string, unknown>).__solidify = {
    app, opt, tour, ui, challenge, composer, analyze,
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
    renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
  }, { passive: false });

  window.addEventListener("keydown", e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") { e.preventDefault(); app.setRun(!running); ui.sync(); }
    if (/^[0-9]$/.test(e.key)) {
      const lens = e.key === "0" ? 9 : parseInt(e.key) - 1;
      app.setView(lens);
      ui.sync();
    }
  });

  // -------------------------------------------------------------- scale bar
  function updateScalebar() {
    if (view !== 2) return;
    const cssPxPerCell = renderer.cssPxPerCell(sim.n);
    const umPerCssPx = (DOMAIN_MM * 1000 / sim.n) / cssPxPerCell;
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

  function frame(t: number) {
    try {
      frameBody(t);
    } catch (err) {
      console.error("[solidify] frame error:", err);
    }
    requestAnimationFrame(frame);
  }

  function frameBody(t: number) {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

    if (opt.active) {
      opt.tick();
      // when paused, tick() is a no-op — keep the stage live so it isn't frozen
      if (!opt.isRunning()) renderer.render(sim, 1, t / 1000);
    } else {
      if (running) {
        // nucleation rain with an activation-undercooling distribution:
        // potent seeds fire near T~0.98, weak ones need a colder melt
        rainAcc += rain * dt;
        while (rainAcc >= 1) {
          rainAcc -= 1;
          sim.addSeed(Math.random() * sim.n, Math.random() * sim.n, 3.5,
            undefined, 0.86 + Math.random() * 0.12);
        }
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
        sim.step(turbo ? TURBO_STEPS : substeps);
      } else {
        sim.step(0); // stamp queued taps so staging is visible while armed
      }
      renderer.render(sim, view, t / 1000);
    }
    analyze.applyProbe();
    analyze.updateOverlay();

    statsClock += dt;
    if (statsClock > 0.25) {
      statsClock = 0;
      void sim.readStats().then(s => {
        if (s) {
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
        }
      });
      const s = lastStats;
      ui.setReadouts([
        ["t", sim.simTime.toFixed(3)],
        ["solid", s ? `${(s.fracSolid * 100).toFixed(1)} %` : "—"],
        ["grains", s ? String(s.grainCount) : "—"],
        ["ASTM", s?.astm != null ? `G ${s.astm.toFixed(1)}` : "—"],
        ["ΔT int", s ? (1 - s.interfaceT).toFixed(3) : "—"],
        ["fps", `${fps.toFixed(0)} · ${sim.n}²${renderer.zoom > 1.01 ? ` · ${renderer.zoom.toFixed(1)}×` : ""}`],
      ]);
      updateScalebar();
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
  ui.sync();
  requestAnimationFrame(frame);
}

void boot();
