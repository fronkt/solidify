import { Simulation, DOMAIN_MM, type StatsResult } from "./sim";
import { Renderer, type ViewMode } from "./render";
import { UI, type UIHost } from "./ui";
import { Hud } from "./hud";
import { Tour, CHAPTERS } from "./tour";
import { Optimizer, type OptHost } from "./optimizer";

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
  let rain = 0;            // seeds per second
  let undercool = 1.0;
  let rainAcc = 0;
  let lastStats: StatsResult | null = null;
  let fps = 60;

  const app: UIHost & OptHost = {
    // ---- AppControl (tour / presets)
    clearMelt(u) { undercool = u; sim.reset(1 - u); hud.reset(); lastStats = null; },
    seedCenter() { sim.addSeed(sim.n / 2, sim.n / 2, 5); hideHint(); },
    // pick the mould wall the cover-crop keeps on screen
    chillWall() { sim.chillWall(canvas.width >= canvas.height ? "left" : "bottom"); hideHint(); },
    setParams(p) { Object.assign(sim.params, p); },
    setRain(v) { rain = v; },
    setView(v) { view = v as ViewMode; },
    setSpeed(v) { substeps = v; turbo = false; },
    startOptimizer() { opt.start(sim.n); },
    syncUI() { ui.sync(); },
    // ---- UIHost extras
    simParams: () => sim.params,
    getUndercool: () => undercool,
    setUndercool(v) { undercool = v; },
    getRain: () => rain,
    getSubsteps: () => substeps,
    isRunning: () => running,
    toggleRun() { running = !running; },
    isTurbo: () => turbo,
    toggleTurbo() { turbo = !turbo; },
    getGrid: () => sim.n,
    setGrid(n) { if (n !== sim.n) app.swapSim(n); },
    getView: () => view,
    anneal(on) { sim.params.heatIn = on ? 1.1 : 0; },
    clearAll() { sim.reset(1 - undercool); hud.reset(); lastStats = null; },
    // ---- OptHost
    swapSim(n) {
      const params = { ...sim.params };
      sim = new Simulation(device, n);
      sim.params = params;
      sim.reset(1 - undercool);
      renderer.rebind(sim);
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
  };

  const ui = new UI(app);
  const tour = new Tour(app);
  const opt = new Optimizer(app);
  (window as unknown as Record<string, unknown>).__solidify = {
    app, opt, tour, ui,
    // test hook: drive N synthetic 60 Hz frames even when rAF is throttled
    tick(k: number) { for (let i = 0; i < k; i++) frameBody(last + 1000 / 60); },
  };

  // --------------------------------------------------------------- pointer
  let dragging = false;
  let lastSeed = { x: -1e9, y: -1e9 };
  const hideHint = () => document.getElementById("hint")!.classList.add("gone");
  const seedAt = (e: PointerEvent) => {
    const g = renderer.clientToGrid(e.clientX, e.clientY, sim.n);
    if (!g) return;
    const minDist = sim.n * 0.02;
    if (Math.hypot(g.x - lastSeed.x, g.y - lastSeed.y) < minDist) return;
    lastSeed = g;
    sim.addSeed(g.x, g.y, 4);
    hideHint();
  };
  canvas.addEventListener("pointerdown", e => { if (!opt.active) { dragging = true; seedAt(e); } });
  canvas.addEventListener("pointermove", e => { if (dragging && !opt.active) seedAt(e); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"])
    canvas.addEventListener(ev, () => { dragging = false; lastSeed = { x: -1e9, y: -1e9 }; });

  window.addEventListener("keydown", e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") { e.preventDefault(); app.toggleRun(); ui.sync(); }
    if (e.key >= "1" && e.key <= "4") { app.setView(parseInt(e.key) - 1); ui.sync(); }
  });

  // -------------------------------------------------------------- scale bar
  function updateScalebar() {
    if (view !== 2) return;
    const cssPxPerCell = Math.max(canvas.width, canvas.height) / sim.n / (canvas.width / canvas.clientWidth);
    const umPerCssPx = (DOMAIN_MM * 1000 / sim.n) / cssPxPerCell;
    let bestUm = 100;
    let bestErr = Infinity;
    for (const um of [10, 20, 50, 100, 200, 500]) {
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
    } else {
      if (running) {
        rainAcc += rain * dt;
        while (rainAcc >= 1) {
          rainAcc -= 1;
          sim.addSeed(Math.random() * sim.n, Math.random() * sim.n, 3.5);
        }
        sim.step(turbo ? TURBO_STEPS : substeps);
      }
      renderer.render(sim, view, t / 1000);
    }

    statsClock += dt;
    if (statsClock > 0.25) {
      statsClock = 0;
      void sim.readStats().then(s => { if (s) { lastStats = s; if (!opt.active) hud.push(s); } });
      const s = lastStats;
      ui.setReadouts([
        ["t", sim.simTime.toFixed(3)],
        ["solid", s ? `${(s.fracSolid * 100).toFixed(1)} %` : "—"],
        ["grains", s ? String(s.grainCount) : "—"],
        ["ASTM", s?.astm != null ? `G ${s.astm.toFixed(1)}` : "—"],
        ["ΔT int", s ? (1 - s.interfaceT).toFixed(3) : "—"],
        ["fps", `${fps.toFixed(0)} · ${sim.n}²`],
      ]);
      updateScalebar();
    }
  }

  // boot scene: a lone dendrite, instantly
  CHAPTERS[1].apply(app);
  ui.sync();
  requestAnimationFrame(frame);
}

void boot();
