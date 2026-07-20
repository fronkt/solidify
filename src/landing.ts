// Landing scroll-story controller. Two real simulations share one GPU device:
// the pinned ten-lens act and the materials act. Only the sim currently on
// screen ticks. GSAP's ScrollTrigger drives the pinned acts and the SEM
// blueprint that draws itself on scroll; DOM-only motion lives in
// landing-motion.ts. Without WebGPU (or with reduced motion) the page falls
// back to stills and a fully-drawn diagram, unpinned.

import "./landing-motion";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { initDive } from "./dive";
import { Simulation } from "./sim";
import { Renderer } from "./render";
import { MATERIALS } from "./materials";
import { LENS_NAMES } from "./shaders";

gsap.registerPlugin(ScrollTrigger);

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const LENS_DESC = [
  "Incandescent blackbody glow: the halo around every growing tip is latent heat escaping.",
  "Cross-polarised light: every colour is one crystal orientation.",
  "The metallographer's micrograph, etched boundaries, scale bar and all.",
  "The raw temperature field, isotherms drifting ahead of the front.",
  "Growth rings: every band is a moment of solidification history.",
  "An ironbow thermal camera pointed at the freezing melt.",
  "A secondary-electron microscope, scan lines included.",
  "Only the interface itself, glowing like a storm map.",
  "A synchrotron radiograph: solute segregation in absorption contrast.",
  "Gibbs–Thomson curvature: warm tips, cold grooves. The physics of shape.",
];

interface MatStep { key: string; name: string; temp: string; fact: string; undercool: number }
const MAT_STEPS: MatStep[] = [
  { key: "steel", name: "STEEL", temp: "Fe–C · pours at ~1540 °C", fact: "White-hot. Four-fold δ-ferrite dendrites, the brightest melt in the instrument.", undercool: 0.9 },
  { key: "al", name: "ALUMINUM", temp: "Al–Cu · freezes at 660 °C", fact: "A dull red glow, and castings that grow feathery twinned grains.", undercool: 0.9 },
  { key: "zn", name: "ZINC", temp: "the galvanizing spangle · 420 °C", fact: "No glow at all: six-fold crystals blooming in liquid silver.", undercool: 0.95 },
  { key: "ice", name: "ICE", temp: "H₂O · 0 °C", fact: "Six-fold because the lattice is. That single fact is why no snowflake has four arms.", undercool: 0.92 },
];

function buildRail(el: HTMLElement, count: number) {
  for (let i = 0; i < count; i++) el.append(document.createElement("i"));
  el.children[0].classList.add("on");
}

function setRail(el: HTMLElement, idx: number) {
  [...el.children].forEach((c, i) => c.classList.toggle("on", i === idx));
}

function staticFallback() {
  document.body.classList.add("nogpu");
}

async function boot() {
  // a pinned scroll story restored mid-pin on reload is disorienting; start clean
  history.scrollRestoration = "manual";
  buildRail(document.getElementById("lensRail")!, 10);
  buildRail(document.getElementById("matRail")!, MAT_STEPS.length);
  // the dive: true-3D Three.js wireframes when WebGL is up; otherwise the
  // 2.5D SVG camera (dive.ts), which needs no GPU at all.
  // AWAITED on purpose: every pinned ScrollTrigger below must be created
  // AFTER the dive's pin exists, or their start positions are computed
  // without its 8200px pin spacer and their pins land INSIDE the dive
  // (seen in the field as "GPU → lens act → die → …" interleaving).
  if (reduced) initDive(true);
  else {
    try {
      const m = await import("./dive3d");
      if (!m.initDive3D()) initDive(false);
    } catch {
      initDive(false);
    }
  }
  if (reduced || !navigator.gpu) return staticFallback();
  let device: GPUDevice;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return staticFallback();
    device = await adapter.requestDevice();
    device.lost.then(info => { if (info.reason !== "destroyed") staticFallback(); });
  } catch {
    return staticFallback();
  }

  // ------------------------------------------------------- lens act (pinned)
  const LN = 256;
  const lensSim = new Simulation(device, LN);
  const lensCanvas = document.getElementById("lensSim") as HTMLCanvasElement;
  const lensRen = new Renderer(device, lensCanvas, lensSim);
  let lensView = 0;
  const pourLens = () => {
    Object.assign(lensSim.params, {
      aniMode: 4, delta: 0.045, noiseAmp: 0.012, latent: 1.6, coolRate: 0.08,
      alloyOn: 1, c0: 0.25, mLiq: 0.4, kPart: 0.2, dSol: 0.8,
      twinProb: 0.0008, meltGlow: 1.0, scen: 0, heatIn: 0,
    });
    lensSim.reset(0.12);
    for (let i = 0; i < 9; i++)
      lensSim.addSeed(Math.random() * LN, Math.random() * LN, 3.5, undefined, 0.9 + Math.random() * 0.08);
  };
  pourLens();
  let lensPoll = 0;
  const lensScene = (dt: number) => {
    lensPoll += dt;
    if (lensPoll > 0.6) {
      lensPoll = 0;
      void lensSim.readStats().then(s => { if (s && s.fracSolid > 0.93) pourLens(); });
    }
  };

  const lensName = document.getElementById("lensName")!;
  const lensDesc = document.getElementById("lensDesc")!;
  const lensRail = document.getElementById("lensRail")!;
  const setLens = (idx: number) => {
    if (idx === lensView) return;
    lensView = idx;
    lensName.textContent = LENS_NAMES[idx];
    lensDesc.textContent = LENS_DESC[idx];
    setRail(lensRail, idx);
    gsap.fromTo(lensName, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power2.out", overwrite: true });
    gsap.fromTo(lensDesc, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "none", overwrite: true });
  };

  ScrollTrigger.create({
    trigger: "#lensAct",
    start: "top top",
    end: "+=3600",
    pin: true,
    scrub: true,
    onUpdate: self => setLens(Math.min(9, Math.floor(self.progress * 10))),
  });

  // -------------------------------------------------- materials act (pinned)
  const matSim = new Simulation(device, LN);
  const matCanvas = document.getElementById("matSim") as HTMLCanvasElement;
  const matRen = new Renderer(device, matCanvas, matSim);
  let matIdx = -1;
  const matName = document.getElementById("matName")!;
  const matTemp = document.getElementById("matTemp")!;
  const matFact = document.getElementById("matFact")!;
  const matRail = document.getElementById("matRail")!;
  const setMat = (idx: number) => {
    if (idx === matIdx) return;
    matIdx = idx;
    const m = MAT_STEPS[idx];
    Object.assign(matSim.params, { scen: 0, heatIn: 0, coolRate: 0.04, twinProb: 0, noiseAmp: 0.012 }, MATERIALS[m.key].params);
    matSim.reset(1 - m.undercool);
    for (let i = 0; i < 6; i++)
      matSim.addSeed(Math.random() * LN, Math.random() * LN, 3.5);
    matName.textContent = m.name;
    matTemp.textContent = m.temp;
    matFact.textContent = m.fact;
    setRail(matRail, idx);
    gsap.fromTo([matName, matTemp, matFact], { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: "power2.out", overwrite: true });
  };
  setMat(0);

  ScrollTrigger.create({
    trigger: "#matAct",
    start: "top top",
    end: "+=2200",
    pin: true,
    scrub: true,
    onUpdate: self => setMat(Math.min(MAT_STEPS.length - 1, Math.floor(self.progress * MAT_STEPS.length))),
  });

  // ------------------------------------------- visibility-gated master loop
  const active = { lens: false, mat: false };
  const watch = (el: Element, key: keyof typeof active) => {
    new IntersectionObserver(es => {
      for (const e of es) active[key] = e.isIntersecting;
    }, { threshold: 0.02 }).observe(el);
  };
  watch(lensCanvas, "lens");
  watch(matCanvas, "mat");

  let last = performance.now();
  function frameBody(t: number) {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    try {
      if (active.lens) {
        lensScene(dt);
        lensSim.step(7);   // slower growth: the dendrites get ~5 s more stage time
        lensRen.render(lensSim, lensView, t / 1000);
      }
      if (active.mat) {
        matSim.step(12);
        matRen.render(matSim, 0, t / 1000);
      }
    } catch (err) {
      console.error("[solidify] landing frame error:", err);
    }
  }
  function frame(t: number) {
    frameBody(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // test hook: drive frames manually in occluded windows (rAF is suspended)
  (window as unknown as Record<string, unknown>).__landing = {
    tick(k: number) { for (let i = 0; i < k; i++) frameBody(last + 1000 / 60); },
    sims: { lensSim, matSim },
    active,
    ST: ScrollTrigger,   // test hook: assert pinned acts never overlap
  };
}

void boot();
