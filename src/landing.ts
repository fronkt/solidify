// Landing-page hero: a real 256² phase-field simulation rolling random scenes.
// Falls back to a still image without WebGPU.

import { Simulation } from "./sim";
import { Renderer } from "./render";

const N = 256;

interface SceneResult { view: number; doneAt: number }

function rnd(lo: number, hi: number) { return lo + Math.random() * (hi - lo); }
function pick<T>(xs: T[]): T { return xs[Math.floor(Math.random() * xs.length)]; }

// Random scene generator. Archetypes chosen so a lone centered 4-fold cross
// never appears (single-crystal scenes are 6-fold or seaweed).
function randomScene(sim: Simulation, renderer: Renderer, first: boolean): SceneResult {
  const p = sim.params;
  Object.assign(p, { scen: 0, alloyOn: 0, heatIn: 0, coolRate: 0, aniMode: 4, twinProb: 0, meltGlow: 1 });

  const arch = first
    ? "duo"
    : pick(["multi", "multi", "duo", "duo", "snow", "seaweed", "rainCast", "rainCast", "hexRain", "twinStar"]);

  let view = 0;
  switch (arch) {
    case "snow": {
      p.aniMode = 6; p.delta = rnd(0.035, 0.05); p.noiseAmp = rnd(0.01, 0.02); p.latent = rnd(1.6, 1.9);
      sim.reset(rnd(0, 0.12));
      sim.addSeed(N * rnd(0.42, 0.58), N * rnd(0.42, 0.58), 4);
      break;
    }
    case "seaweed": {
      p.delta = rnd(0.002, 0.008); p.noiseAmp = rnd(0.015, 0.025); p.latent = rnd(1.4, 1.6);
      sim.reset(0);
      sim.addSeed(N * rnd(0.35, 0.65), N * rnd(0.35, 0.65), 4);
      break;
    }
    case "duo": {
      p.aniMode = pick([4, 4, 6]); p.delta = rnd(0.035, 0.06); p.noiseAmp = rnd(0.006, 0.016); p.latent = rnd(1.5, 1.8);
      sim.reset(rnd(0, 0.1));
      const k = pick([2, 3, 3]);
      for (let i = 0; i < k; i++)
        sim.addSeed(N * rnd(0.2, 0.8), N * rnd(0.2, 0.8), 4);
      break;
    }
    case "multi": {
      p.delta = rnd(0.03, 0.05); p.noiseAmp = rnd(0.008, 0.016); p.latent = rnd(1.4, 1.7); p.coolRate = rnd(0.04, 0.15);
      sim.reset(rnd(0.1, 0.25));
      const k = Math.floor(rnd(5, 12));
      for (let i = 0; i < k; i++)
        sim.addSeed(N * Math.random(), N * Math.random(), 3.5);
      view = pick([0, 0, 1, 4]);
      break;
    }
    case "twinStar": { // rotational twin: the 12-branched snowflake
      p.aniMode = 6; p.delta = rnd(0.038, 0.05); p.noiseAmp = rnd(0.008, 0.016); p.latent = rnd(1.6, 1.9);
      sim.reset(rnd(0, 0.1));
      sim.addTwinSeed(N * rnd(0.42, 0.58), N * rnd(0.42, 0.58), 4);
      view = pick([0, 0, 1]);
      break;
    }
    case "rainCast": {
      p.delta = rnd(0.035, 0.05); p.noiseAmp = rnd(0.01, 0.016); p.latent = rnd(1.3, 1.6); p.coolRate = rnd(0.2, 0.35);
      if (Math.random() < 0.25) p.twinProb = 0.0012;
      sim.reset(rnd(0.15, 0.3));
      const k = Math.floor(rnd(18, 40));
      for (let i = 0; i < k; i++)
        sim.addSeed(N * Math.random(), N * Math.random(), 3);
      view = pick([1, 1, 4, 0]);
      break;
    }
    default: { // hexRain
      p.aniMode = 6; p.delta = rnd(0.035, 0.045); p.noiseAmp = rnd(0.01, 0.018); p.latent = rnd(1.5, 1.8); p.coolRate = rnd(0.06, 0.15);
      sim.reset(rnd(0.05, 0.15));
      const k = Math.floor(rnd(8, 16));
      for (let i = 0; i < k; i++)
        sim.addSeed(N * Math.random(), N * Math.random(), 3.5);
      view = pick([0, 4, 1]);
    }
  }

  // occasional surprise looks
  if (!first && Math.random() < 0.10) view = 7;                    // neon wireframe
  renderer.pixelSize = !first && Math.random() < 0.12 ? Math.floor(rnd(4, 10)) : 0;
  renderer.paletteOn = renderer.pixelSize > 0 && Math.random() < 0.5;

  return { view, doneAt: rnd(0.6, 0.8) };
}

async function boot() {
  const canvas = document.getElementById("demo") as HTMLCanvasElement;
  const img = document.getElementById("demoImg") as HTMLImageElement;
  const tag = document.getElementById("demoTag")!;
  const fallback = () => {
    canvas.style.display = "none";
    img.style.display = "block";
    tag.textContent = "GROWN BY SOLIDIFY (YOUR BROWSER LACKS WEBGPU)";
  };
  try {
    if (!navigator.gpu) return fallback();
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return fallback();
    const device = await adapter.requestDevice();

    const sim = new Simulation(device, N);
    const renderer = new Renderer(device, canvas, sim);

    let scene = randomScene(sim, renderer, true);
    let sceneFrames = 0;
    let checking = false;

    function frame(t: number) {
      sim.step(10);
      renderer.render(sim, scene.view, t / 1000);
      sceneFrames++;
      if (sceneFrames > 240 && !checking) {
        checking = true;
        void sim.readStats().then(s => {
          checking = false;
          if ((s && s.fracSolid > scene.doneAt) || sceneFrames > 2400) {
            scene = randomScene(sim, renderer, false);
            sceneFrames = 0;
          }
        });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch {
    fallback();
  }
}

void boot();
