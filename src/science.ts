// Interactive figures, animations, and live WebGPU micro-lab for /science/.
// Strictly follows docs/DESIGN.md: achromatic chrome, color reserved for
// simulated fields and --data-1..4 plot marks. Every animation respects
// prefers-reduced-motion and pauses when scrolled off screen.

import "./design/page";
import { Simulation } from "./sim";
import { Renderer } from "./render";
import { stream } from "./rng";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ TOC spy
function initToc() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".sciToc a[href^='#']")];
  if (!links.length) return;
  const map = new Map<string, HTMLAnchorElement>();
  for (const a of links) {
    const id = a.getAttribute("href")!.slice(1);
    map.set(id, a);
  }
  const sections = [...map.keys()]
    .map(id => document.getElementById(id))
    .filter((el): el is HTMLElement => el != null);

  let current = sections[0]?.id ?? "";
  const setActive = (id: string) => {
    if (!id || id === current) return;
    current = id;
    for (const [k, a] of map) a.classList.toggle("is-active", k === id);
  };
  map.get(current)?.classList.add("is-active");

  const io = new IntersectionObserver(entries => {
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setActive(visible[0].target.id);
  }, { rootMargin: "-15% 0px -65% 0px", threshold: 0 });

  for (const s of sections) io.observe(s);
}

// ------------------------------------------------------- 1. Live WebGPU Lab
interface ModeSpec {
  id: string;
  label: string;
  sym: string;
  delta: number;
  note: string;
  href: string;
  setup: (sim: Simulation) => void;
}

const DENDRITE_MODES: ModeSpec[] = [
  {
    id: "cubic",
    label: "4-fold cubic",
    sym: "4-fold (j = 4)",
    delta: 0.05,
    note: "Classic cubic metal dendrite. Four primary arms lock onto <100> axes while thermal noise seeds secondary side branches.",
    href: "../app/",
    setup: sim => {
      Object.assign(sim.params, {
        aniMode: 4, delta: 0.05, noiseAmp: 0.012, latent: 1.65, coolRate: 0.01,
        alloyOn: 0, twinProb: 0, meltGlow: 1.0, scen: 0, heatIn: 0, gradG: 0.08, pullV: 1.5,
      });
      sim.reset(0.08);
      sim.addSeed(sim.n * 0.5, sim.n * 0.5, 4.0, 0.35, 0.0);
    },
  },
  {
    id: "hex",
    label: "6-fold snowflake",
    sym: "6-fold (j = 6)",
    delta: 0.045,
    note: "Same PDE, hexagonal surface energy. Six primary arms emerge naturally because ice and zinc lattices are six-fold in the basal plane.",
    href: "../app/?tour=1",
    setup: sim => {
      Object.assign(sim.params, {
        aniMode: 6, delta: 0.045, noiseAmp: 0.010, latent: 1.75, coolRate: 0.01,
        alloyOn: 0, twinProb: 0, meltGlow: 0.35, scen: 0, heatIn: 0, gradG: 0.08, pullV: 1.5,
      });
      sim.reset(0.08);
      sim.addSeed(sim.n * 0.5, sim.n * 0.5, 4.0, 0.0, 0.0);
    },
  },
  {
    id: "seaweed",
    label: "Seaweed (δ → 0)",
    sym: "near-isotropic",
    delta: 0.002,
    note: "Turn anisotropy nearly off and arms lose their preferred axes, splitting continuously into dense-branching seaweed morphology.",
    href: "../app/",
    setup: sim => {
      Object.assign(sim.params, {
        aniMode: 4, delta: 0.002, noiseAmp: 0.018, latent: 1.7, coolRate: 0.015,
        alloyOn: 0, twinProb: 0, meltGlow: 1.0, scen: 0, heatIn: 0, gradG: 0.08, pullV: 1.5,
      });
      sim.reset(0.05);
      sim.addSeed(sim.n * 0.5, sim.n * 0.5, 4.0, 0.0, 0.0);
    },
  },
  {
    id: "cet",
    label: "Columnar + grains",
    sym: "polycrystal (j = 4)",
    delta: 0.045,
    note: "A cold bottom chill wall launches competing columnar grains while equiaxed nuclei impinge ahead of the front to form grain boundaries.",
    href: "../app/",
    setup: sim => {
      Object.assign(sim.params, {
        aniMode: 4, delta: 0.045, noiseAmp: 0.012, latent: 1.55, coolRate: 0.09,
        alloyOn: 1, c0: 0.25, mLiq: 0.38, kPart: 0.2, dSol: 0.8,
        twinProb: 0.001, meltGlow: 1.0, scen: 0, heatIn: 0, gradG: 0.08, pullV: 1.5,
      });
      sim.reset(0.14);
      const r = stream("sci-cet");
      for (let i = 0; i < 12; i++) {
        sim.addSeed(8 + (i + 0.5) * ((sim.n - 16) / 12), sim.n - 10, 3.2, r.upto(Math.PI * 0.5), 0.02);
      }
      for (let i = 0; i < 6; i++) {
        sim.addSeed(28 + r.upto(sim.n - 56), 28 + r.upto(sim.n * 0.55), 3.0, r.upto(Math.PI * 0.5), 0.06);
      }
    },
  },
];

const MINI_LENSES = [
  { idx: 0, name: "MELT" },
  { idx: 1, name: "ORIENT" },
  { idx: 3, name: "FIELD" },
  { idx: 2, name: "ETCH" },
];

async function initDendriteLab() {
  const root = document.getElementById("demoAniso");
  if (!root) return;
  const canvas = root.querySelector<HTMLCanvasElement>("#sciSimCanvas")!;
  const fallback = root.querySelector<HTMLImageElement>("#sciSimFallback")!;
  const noteEl = root.querySelector<HTMLElement>("#sciSimNote")!;
  const symEl = root.querySelector<HTMLElement>("#sciSimSym")!;
  const deltaEl = root.querySelector<HTMLElement>("#sciSimDelta")!;
  const solidEl = root.querySelector<HTMLElement>("#sciSimSolid")!;
  const openEl = root.querySelector<HTMLAnchorElement>("#sciSimOpen")!;
  const statusEl = root.querySelector<HTMLElement>("#sciSimStatus")!;
  const modeBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-mode]")];
  const lensBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-lens]")];
  const resetBtn = root.querySelector<HTMLButtonElement>("#sciSimReset")!;

  let activeMode = DENDRITE_MODES[0];
  let activeLens = 0;

  const paintMeta = () => {
    noteEl.textContent = activeMode.note;
    symEl.textContent = activeMode.sym;
    deltaEl.textContent = activeMode.delta.toFixed(3);
    openEl.href = activeMode.href;
    modeBtns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === activeMode.id)));
    lensBtns.forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.lens) === activeLens)));
  };
  paintMeta();

  const showStatic = (why: string) => {
    canvas.style.display = "none";
    fallback.style.display = "block";
    statusEl.textContent = why;
    solidEl.textContent = "—";
    modeBtns.forEach(b => b.addEventListener("click", () => {
      const m = DENDRITE_MODES.find(x => x.id === b.dataset.mode);
      if (m) { activeMode = m; paintMeta(); }
    }));
  };

  if (REDUCED || !navigator.gpu) {
    showStatic(REDUCED ? "Static preview (reduced motion enabled)" : "Static preview (WebGPU unavailable)");
    return;
  }

  let device: GPUDevice;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { showStatic("Static preview (no WebGPU adapter)"); return; }
    device = await adapter.requestDevice();
    device.lost.then(info => { if (info.reason !== "destroyed") showStatic("WebGPU device reset"); });
  } catch {
    showStatic("Static preview (WebGPU unavailable)");
    return;
  }

  const N = 256;
  const sim = new Simulation(device, N);
  const ren = new Renderer(device, canvas, sim);
  canvas.style.display = "block";
  fallback.style.display = "none";
  statusEl.textContent = "Live 256² WebGPU solver";

  const applyMode = (m: ModeSpec) => {
    activeMode = m;
    if (m.id === "hex" && activeLens === 0) activeLens = 1;
    else if (m.id === "cubic" && activeLens === 1) activeLens = 0;
    m.setup(sim);
    paintMeta();
  };
  applyMode(DENDRITE_MODES[0]);

  modeBtns.forEach(b => b.addEventListener("click", () => {
    const m = DENDRITE_MODES.find(x => x.id === b.dataset.mode);
    if (m) applyMode(m);
  }));
  lensBtns.forEach(b => b.addEventListener("click", () => {
    const v = Number(b.dataset.lens);
    if (MINI_LENSES.some(l => l.idx === v)) {
      activeLens = v;
      paintMeta();
    }
  }));
  resetBtn.addEventListener("click", () => activeMode.setup(sim));

  let visible = false;
  let lastPoll = 0;
  let rafId = 0;

  const io = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible && !rafId) rafId = requestAnimationFrame(tick);
  }, { rootMargin: "120px" });
  io.observe(root);

  const tick = (now: number) => {
    rafId = 0;
    if (!visible) return;
    sim.step(6);
    ren.render(sim, activeLens, now / 1000);
    if (now - lastPoll > 450) {
      lastPoll = now;
      void sim.readStats().then(s => {
        if (!s) return;
        solidEl.textContent = `${(s.fracSolid * 100).toFixed(0)} %`;
        if (s.fracSolid > 0.72) activeMode.setup(sim);
      });
    }
    rafId = requestAnimationFrame(tick);
  };
}

// ------------------------------------ 2. Diffuse Interface & Anti-Trapping
function initInterfaceDemo() {
  const root = document.getElementById("demoInterface");
  if (!root) return;
  const svg = root.querySelector<SVGSVGElement>("#ifSvg")!;
  const widthSlider = root.querySelector<HTMLInputElement>("#ifWidth")!;
  const widthVal = root.querySelector<HTMLElement>("#ifWidthVal")!;
  const atToggle = root.querySelector<HTMLButtonElement>("#ifAntiTrap")!;
  const keffVal = root.querySelector<HTMLElement>("#ifKeffVal")!;
  const errVal = root.querySelector<HTMLElement>("#ifErrVal")!;
  const barOn = root.querySelector<HTMLElement>("#ifBarOn")!;
  const barOff = root.querySelector<HTMLElement>("#ifBarOff")!;
  const note = root.querySelector<HTMLElement>("#ifNote")!;

  let antiTrap = true;
  let phase = 0;
  let visible = false;
  let rafId = 0;

  const draw = () => {
    const wOverD0 = parseFloat(widthSlider.value); // 1.5 .. 4.0
    widthVal.textContent = `${wOverD0.toFixed(1)} d₀`;
    atToggle.setAttribute("aria-pressed", String(antiTrap));
    atToggle.textContent = antiTrap ? "Anti-trapping: ON" : "Anti-trapping: OFF";

    // Measured behavior from SOLIDIFY 2D benchmark: true k = 0.15;
    // ON sits flat at 0.135-0.150; OFF rises linearly from ~0.186 to ~0.209 (+24% to +40%)
    const kTrue = 0.15;
    const tNorm = (wOverD0 - 1.5) / 2.5; // 0..1
    const kOn = 0.149 - 0.012 * tNorm;
    const kOff = 0.184 + 0.026 * tNorm;
    const kActive = antiTrap ? kOn : kOff;
    const relErr = ((kActive - kTrue) / kTrue) * 100;

    keffVal.textContent = kActive.toFixed(3);
    errVal.textContent = `${relErr >= 0 ? "+" : ""}${relErr.toFixed(1)} % vs k = 0.15`;
    barOn.style.width = `${Math.min(100, (kOn / 0.24) * 100).toFixed(1)}%`;
    barOff.style.width = `${Math.min(100, (kOff / 0.24) * 100).toFixed(1)}%`;
    note.textContent = antiTrap
      ? "With the anti-trapping current enabled, rejected solute escapes across the diffuse interface so the effective partition stays near k = 0.15 across interface widths."
      : "With anti-trapping disabled, a wider diffuse interface artificially traps solute inside the growing solid, inflating k_eff by 24% to 40%.";

    // Build SVG paths for phi(x) and c(x) moving slightly when visible
    const W = 520, H = 200;
    const padL = 44, padR = 16, padT = 18, padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const xFront = 0.44 + (REDUCED ? 0 : 0.04 * Math.sin(phase));
    const widthFrac = 0.025 + 0.032 * (wOverD0 / 4.0);

    const phiPts: string[] = [];
    const cPts: string[] = [];
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = padL + u * plotW;
      const z = (u - xFront) / widthFrac;
      const phi = 0.5 * (1 - Math.tanh(z));
      // Solute profile: solid side c_s = k_active * c_l, interface peak decaying into liquid
      const liquidTail = u >= xFront
        ? 0.22 + 0.62 * Math.exp(-(u - xFront) / 0.14)
        : 0.22 + 0.62 * Math.exp(-Math.pow((xFront - u) / (widthFrac * 1.15), 2));
      const cSolid = (kActive / 0.15) * 0.16;
      const cVal = phi * cSolid + (1 - phi) * liquidTail + (antiTrap ? 0 : 0.14 * phi * (1 - phi) * (wOverD0 / 3.0));
      const yPhi = padT + (1 - phi) * plotH;
      const yC = padT + (1 - Math.min(0.98, Math.max(0.02, cVal))) * plotH;
      phiPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${yPhi.toFixed(1)}`);
      cPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${yC.toFixed(1)}`);
    }

    const xBandL = padL + Math.max(0, xFront - widthFrac * 1.5) * plotW;
    const xBandW = Math.min(plotW, widthFrac * 3.0 * plotW);

    svg.innerHTML = `
      <rect x="${xBandL.toFixed(1)}" y="${padT}" width="${xBandW.toFixed(1)}" height="${plotH}" fill="var(--fg)" opacity="0.06"></rect>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="var(--rule-strong)" stroke-width="1"></line>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--rule-strong)" stroke-width="1"></line>
      <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${padL + plotW}" y2="${padT + plotH * 0.5}" stroke="var(--rule)" stroke-dasharray="3 3"></line>
      <path d="${phiPts.join(" ")}" fill="none" stroke="var(--data-1)" stroke-width="2.2"></path>
      <path d="${cPts.join(" ")}" fill="none" stroke="var(--data-2)" stroke-width="2.2"></path>
      <text x="${padL - 8}" y="${padT + 5}" text-anchor="end" fill="var(--fg-3)" font-size="11">1</text>
      <text x="${padL - 8}" y="${padT + plotH + 3}" text-anchor="end" fill="var(--fg-3)" font-size="11">0</text>
      <text x="${padL + 10}" y="${padT + 16}" fill="var(--fg-3)" font-size="11">SOLID (φ = 1)</text>
      <text x="${padL + plotW - 6}" y="${padT + 16}" text-anchor="end" fill="var(--fg-3)" font-size="11">LIQUID (φ = 0)</text>
      <text x="${(xBandL + xBandW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--fg-2)" font-size="11">interface width ≈ √2 W₀</text>
    `;
  };

  widthSlider.addEventListener("input", draw);
  atToggle.addEventListener("click", () => { antiTrap = !antiTrap; draw(); });

  const loop = () => {
    rafId = 0;
    if (!visible || REDUCED) return;
    phase += 0.025;
    draw();
    rafId = requestAnimationFrame(loop);
  };
  const io = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible && !REDUCED && !rafId) rafId = requestAnimationFrame(loop);
  }, { rootMargin: "80px" });
  io.observe(root);
  draw();
}

// ---------------------------------------- 3. Interactive Binary Phase Explorer
interface BinarySystem {
  id: string;
  label: string;
  base: string;
  solute: string;
  Tm: number;
  Tinv: number;
  Csm: number;
  Cinv: number;
  Cprod?: number;
  mDilute: number;
  kDilute: number;
  kind: "eutectic" | "peritectic";
  defaultWt: number;
  maxWt: number;
  step: number;
  primaryPhase: string;
  secondPhase: string;
  presetName: string;
  hash: (wt: number) => string;
}

const BINARIES: BinarySystem[] = [
  {
    id: "al-si",
    label: "Al–Si (eutectic)",
    base: "Al",
    solute: "Si",
    Tm: 660,
    Tinv: 577,
    Csm: 1.65,
    Cinv: 12.6,
    mDilute: -6.6,
    kDilute: 0.12,
    kind: "eutectic",
    defaultWt: 7.0,
    maxWt: 12.0,
    step: 0.1,
    primaryPhase: "(Al)",
    secondPhase: "(Si)",
    presetName: "A356 class",
    hash: wt => `../app/#alloy=al:Si${wt.toFixed(1)}`,
  },
  {
    id: "fe-c",
    label: "Fe–C (peritectic)",
    base: "Fe",
    solute: "C",
    Tm: 1538,
    Tinv: 1495,
    Csm: 0.09,
    Cinv: 0.53,
    Cprod: 0.17,
    mDilute: -81.0,
    kDilute: 0.17,
    kind: "peritectic",
    defaultWt: 0.45,
    maxWt: 0.52,
    step: 0.01,
    primaryPhase: "δ-ferrite",
    secondPhase: "γ-austenite",
    presetName: "1045 carbon steel",
    hash: wt => `../app/#alloy=fe:C${wt.toFixed(2)}`,
  },
  {
    id: "mg-al",
    label: "Mg–Al (Scheil eutectic)",
    base: "Mg",
    solute: "Al",
    Tm: 650,
    Tinv: 437,
    Csm: 12.9,
    Cinv: 32.3,
    mDilute: -6.9,
    kDilute: 0.37,
    kind: "eutectic",
    defaultWt: 9.0,
    maxWt: 30.0,
    step: 0.5,
    primaryPhase: "(Mg)",
    secondPhase: "β-Mg₁₇Al₁₂",
    presetName: "AZ91 class",
    hash: wt => `../app/#alloy=mg:Al${wt.toFixed(1)}`,
  },
];

function initAlloyExplorer() {
  const root = document.getElementById("demoAlloy");
  if (!root) return;
  const sysBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-sys]")];
  const slider = root.querySelector<HTMLInputElement>("#alloyWt")!;
  const wtVal = root.querySelector<HTMLElement>("#alloyWtVal")!;
  const svg = root.querySelector<SVGSVGElement>("#alloySvg")!;
  const dtlEl = root.querySelector<HTMLElement>("#alloyDtl")!;
  const qEl = root.querySelector<HTMLElement>("#alloyQ")!;
  const eqEl = root.querySelector<HTMLElement>("#alloyEq")!;
  const scheilEl = root.querySelector<HTMLElement>("#alloyScheil")!;
  const linkEl = root.querySelector<HTMLAnchorElement>("#alloyPourLink")!;

  let sys = BINARIES[0];

  const loadSystem = (s: BinarySystem) => {
    sys = s;
    slider.min = String(s.step);
    slider.max = String(s.maxWt);
    slider.step = String(s.step);
    slider.value = String(s.defaultWt);
    sysBtns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sys === s.id)));
    render();
  };

  const render = () => {
    const wt = parseFloat(slider.value);
    const dec = sys.step < 0.1 ? 2 : 1;
    wtVal.textContent = `${wt.toFixed(dec)} wt% ${sys.solute}`;
    linkEl.href = sys.hash(wt);

    // Chord properties matching phasedata.ts
    const kChord = sys.Csm / sys.Cinv;
    const dTL = sys.mDilute * wt;
    const Q = sys.mDilute * wt * (sys.kDilute - 1);
    const tPour = sys.Tm + ((sys.Tinv - sys.Tm) / sys.Cinv) * wt;

    dtlEl.textContent = `${Math.abs(dTL).toFixed(1)} K`;
    qEl.textContent = `${Math.abs(Q).toFixed(1)} K`;

    if (sys.kind === "eutectic") {
      const fScheil = Math.pow(wt / sys.Cinv, 1 / (1 - kChord));
      const fLever = wt > sys.Csm ? (wt - sys.Csm) / (sys.Cinv - sys.Csm) : 0;
      eqEl.textContent = wt > sys.Csm
        ? `${sys.primaryPhase} + ${sys.secondPhase} (solver grows ${sys.primaryPhase} only)`
        : `${sys.primaryPhase} single phase (equilibrium)`;
      scheilEl.textContent = wt > sys.Csm
        ? `Lever ${(fLever * 100).toFixed(0)} % · Scheil ${(fScheil * 100).toFixed(0)} %`
        : fScheil >= 0.01
          ? `Lever 0 % · Scheil ${(fScheil * 100).toFixed(1)} %`
          : "< 1 % (below reporting floor)";
    } else {
      const pastProd = sys.Cprod != null && wt > sys.Cprod;
      eqEl.textContent = wt <= sys.Csm
        ? `${sys.primaryPhase} single phase`
        : pastProd
          ? `${sys.secondPhase} (solver grows ${sys.primaryPhase})`
          : `${sys.primaryPhase} + ${sys.secondPhase} (solver grows ${sys.primaryPhase})`;
      scheilEl.textContent = "Peritectic fraction refused (two-arm balance)";
    }

    // Draw SVG chord diagram
    const W = 500, H = 220;
    const pL = 54, pR = 20, pT = 20, pB = 34;
    const w = W - pL - pR;
    const h = H - pT - pB;
    const xOf = (c: number) => pL + (c / sys.Cinv) * w;
    const tMin = sys.Tinv - (sys.Tm - sys.Tinv) * 0.16;
    const tMax = sys.Tm + (sys.Tm - sys.Tinv) * 0.06;
    const yOf = (t: number) => pT + ((tMax - t) / (tMax - tMin)) * h;

    const x0 = xOf(0), xSm = xOf(sys.Csm), xInv = xOf(sys.Cinv), xP = xOf(wt);
    const yTm = yOf(sys.Tm), yInv = yOf(sys.Tinv), yP = yOf(tPour);
    const pastCsm = wt > sys.Csm;

    const prodLine = sys.Cprod != null
      ? `<line x1="${xOf(sys.Cprod).toFixed(1)}" y1="${yInv.toFixed(1)}" x2="${xOf(sys.Cprod).toFixed(1)}" y2="${(pT + h).toFixed(1)}" stroke="var(--data-4)" stroke-dasharray="2 3"></line>
         <text x="${xOf(sys.Cprod).toFixed(1)}" y="${(pT + h - 6).toFixed(1)}" text-anchor="middle" fill="var(--data-4)" font-size="10">C_p ${sys.Cprod}</text>`
      : "";

    svg.innerHTML = `
      <rect x="${xSm.toFixed(1)}" y="${pT}" width="${(xInv - xSm).toFixed(1)}" height="${h}" fill="var(--fg)" opacity="${pastCsm ? "0.06" : "0.02"}"></rect>
      <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT + h}" stroke="var(--rule-strong)" stroke-width="1"></line>
      <line x1="${pL}" y1="${pT + h}" x2="${pL + w}" y2="${pT + h}" stroke="var(--rule-strong)" stroke-width="1"></line>
      <line x1="${xSm.toFixed(1)}" y1="${pT}" x2="${xSm.toFixed(1)}" y2="${pT + h}" stroke="var(--fg-3)" stroke-dasharray="3 3"></line>
      <line x1="${x0.toFixed(1)}" y1="${yTm.toFixed(1)}" x2="${xInv.toFixed(1)}" y2="${yInv.toFixed(1)}" stroke="var(--data-1)" stroke-width="2"></line>
      <line x1="${x0.toFixed(1)}" y1="${yTm.toFixed(1)}" x2="${xSm.toFixed(1)}" y2="${yInv.toFixed(1)}" stroke="var(--data-3)" stroke-width="1.6"></line>
      <line x1="${xSm.toFixed(1)}" y1="${yInv.toFixed(1)}" x2="${xInv.toFixed(1)}" y2="${yInv.toFixed(1)}" stroke="var(--fg-3)" stroke-width="1.4"></line>
      ${prodLine}
      <line x1="${xP.toFixed(1)}" y1="${yP.toFixed(1)}" x2="${xP.toFixed(1)}" y2="${pT + h}" stroke="var(--data-2)" stroke-dasharray="2 3"></line>
      <circle cx="${xP.toFixed(1)}" cy="${yP.toFixed(1)}" r="5" fill="var(--data-2)" stroke="var(--bg)" stroke-width="1.8"></circle>
      <text x="${pL - 8}" y="${(yTm + 4).toFixed(1)}" text-anchor="end" fill="var(--fg-2)" font-size="11">${sys.Tm} °C</text>
      <text x="${pL - 8}" y="${(yInv + 4).toFixed(1)}" text-anchor="end" fill="var(--fg-3)" font-size="11">${sys.Tinv} °C</text>
      <text x="${x0.toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="var(--fg-3)" font-size="11">0</text>
      <text x="${xSm.toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="var(--fg-2)" font-size="11">${sys.Csm}</text>
      <text x="${xInv.toFixed(1)}" y="${H - 12}" text-anchor="end" fill="var(--fg-3)" font-size="11">${sys.Cinv} wt% ${sys.solute}</text>
      <text x="${(xSm + (xInv - xSm) * 0.55).toFixed(1)}" y="${(yInv - 8).toFixed(1)}" text-anchor="middle" fill="var(--fg-3)" font-size="11">${sys.kind === "eutectic" ? `${sys.primaryPhase} + ${sys.secondPhase}` : `L + ${sys.primaryPhase} → ${sys.secondPhase}`}</text>
    `;
  };

  sysBtns.forEach(b => b.addEventListener("click", () => {
    const found = BINARIES.find(x => x.id === b.dataset.sys);
    if (found) loadSystem(found);
  }));
  slider.addEventListener("input", render);
  loadSystem(BINARIES[0]);
}

// ------------------------------------ 4. Animated Cooling Curve & Ratchet
interface CoolPreset {
  id: string;
  label: string;
  nadir: number;       // undercooling depth in K
  recalRise: number;   // recalescence bump in K
  grains: number;      // illustrative relative grain activation
  firedPct: number;
  note: string;
}

const COOL_PRESETS: CoolPreset[] = [
  {
    id: "furnace",
    label: "Slow cooling (0.08)",
    nadir: 5.5,
    recalRise: 3.6,
    grains: 300,
    firedPct: 38,
    note: "Slow heat extraction lets latent heat catch up early. Recalescence arrives at shallow undercooling, halting the inoculant sweep around 300 grains.",
  },
  {
    id: "quench",
    label: "Fast cooling (0.45)",
    nadir: 11.4,
    recalRise: 2.8,
    grains: 420,
    firedPct: 76,
    note: "Faster extraction drives the melt deeper below the liquidus before recalescence catches it, activating more sites from the exact same inoculant charge (~420 grains).",
  },
];

function initCoolingDemo() {
  const root = document.getElementById("demoCooling");
  if (!root) return;
  const svg = root.querySelector<SVGSVGElement>("#coolSvg")!;
  const histSvg = root.querySelector<SVGSVGElement>("#histSvg")!;
  const btns = [...root.querySelectorAll<HTMLButtonElement>("[data-cool]")];
  const replayBtn = root.querySelector<HTMLButtonElement>("#coolReplay")!;
  const noteEl = root.querySelector<HTMLElement>("#coolNote")!;
  const nadirEl = root.querySelector<HTMLElement>("#coolNadir")!;
  const grainsEl = root.querySelector<HTMLElement>("#coolGrains")!;
  const stateEl = root.querySelector<HTMLElement>("#coolState")!;

  let preset = COOL_PRESETS[0];
  let prog = REDUCED ? 1 : 0;
  let rafId = 0;

  // Parametric cooling curve T(u) relative to T_L = 0
  const curveT = (u: number, p: CoolPreset): number => {
    if (u < 0.20) return 10 * (1 - u / 0.20); // superheat down to T_L
    if (u < 0.36) {
      const s = (u - 0.20) / 0.16;
      return -p.nadir * Math.sin(s * Math.PI * 0.5);
    }
    if (u < 0.50) {
      const s = (u - 0.36) / 0.14;
      return -p.nadir + p.recalRise * Math.sin(s * Math.PI * 0.5);
    }
    if (u < 0.78) {
      const s = (u - 0.50) / 0.28;
      return -p.nadir + p.recalRise - 1.6 * s;
    }
    const s = (u - 0.78) / 0.22;
    return -p.nadir + p.recalRise - 1.6 - 12 * s * s;
  };

  const drawFrame = () => {
    const W = 440, H = 190;
    const pL = 42, pR = 14, pT = 16, pB = 26;
    const w = W - pL - pR;
    const h = H - pT - pB;
    const yOf = (t: number) => pT + ((12 - t) / 34) * h; // +12 down to -22

    const pts: string[] = [];
    let maxDT = 0;
    let curT = 10;
    const N = 100;
    const iMax = Math.max(1, Math.round(prog * N));
    for (let i = 0; i <= iMax; i++) {
      const u = i / N;
      const t = curveT(u, preset);
      if (u <= 0.65 && t < 0) maxDT = Math.max(maxDT, -t);
      curT = t;
      pts.push(`${i === 0 ? "M" : "L"}${(pL + u * w).toFixed(1)},${yOf(t).toFixed(1)}`);
    }

    const xNow = pL + (iMax / N) * w;
    const yNow = yOf(curT);
    const yTL = yOf(0);
    const phaseLabel = prog < 0.20 ? "Cooling toward liquidus"
      : prog < 0.36 ? "Undercooling: sites firing"
      : prog < 0.50 ? "Recalescence: nucleation shut off"
      : prog < 0.78 ? "Growth plateau"
      : "Solidified";

    stateEl.textContent = phaseLabel;
    nadirEl.textContent = `${maxDT.toFixed(1)} K`;
    const activeGrains = Math.round(preset.grains * Math.min(1, maxDT / preset.nadir));
    grainsEl.textContent = `~${activeGrains}`;

    svg.innerHTML = `
      <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT + h}" stroke="var(--rule-strong)"></line>
      <line x1="${pL}" y1="${pT + h}" x2="${pL + w}" y2="${pT + h}" stroke="var(--rule-strong)"></line>
      <line x1="${pL}" y1="${yTL.toFixed(1)}" x2="${pL + w}" y2="${yTL.toFixed(1)}" stroke="var(--fg-3)" stroke-dasharray="3 3"></line>
      <text x="${pL - 6}" y="${(yTL + 4).toFixed(1)}" text-anchor="end" fill="var(--fg-2)" font-size="11">T_L</text>
      <path d="${pts.join(" ")}" fill="none" stroke="var(--data-1)" stroke-width="2.2"></path>
      <circle cx="${xNow.toFixed(1)}" cy="${yNow.toFixed(1)}" r="4.5" fill="var(--data-2)" stroke="var(--bg)" stroke-width="1.5"></circle>
      <text x="${pL + w}" y="${H - 8}" text-anchor="end" fill="var(--fg-3)" font-size="11">time →</text>
      <text x="${pL + 6}" y="${pT + 12}" fill="var(--fg-3)" font-size="10">T − T_L (K)</text>
    `;

    // Synchronized Gaussian site-distribution histogram
    const HW = 240, HH = 190;
    const hpL = 16, hpR = 16, hpT = 22, hpB = 26;
    const hw = HW - hpL - hpR, hh = HH - hpT - hpB;
    const bars = 16;
    const barW = hw / bars;
    const mu = 7.5, sig = 3.2;
    let barsHtml = "";
    for (let i = 0; i < bars; i++) {
      const dtBin = (i + 0.5) * (15 / bars);
      const pdf = Math.exp(-0.5 * Math.pow((dtBin - mu) / sig, 2));
      const bh = pdf * (hh - 10);
      const fired = dtBin <= maxDT;
      const x = hpL + i * barW + 1.5;
      const y = hpT + hh - bh;
      barsHtml += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="${bh.toFixed(1)}" fill="${fired ? "var(--data-3)" : "var(--rule-strong)"}"></rect>`;
    }
    const xCut = hpL + Math.min(1, maxDT / 15) * hw;
    histSvg.innerHTML = `
      ${barsHtml}
      <line x1="${hpL}" y1="${hpT + hh}" x2="${hpL + hw}" y2="${hpT + hh}" stroke="var(--rule-strong)"></line>
      <line x1="${xCut.toFixed(1)}" y1="${hpT}" x2="${xCut.toFixed(1)}" y2="${hpT + hh}" stroke="var(--data-2)" stroke-width="1.5" stroke-dasharray="3 2"></line>
      <text x="${hpL}" y="${hpT - 6}" fill="var(--fg-3)" font-size="10">INOCULANT POTENCY N(ΔT_N, ΔT_σ)</text>
      <text x="${hpL + hw}" y="${HH - 8}" text-anchor="end" fill="var(--fg-3)" font-size="11">ΔT_act (K) →</text>
    `;
  };

  const play = () => {
    if (rafId) cancelAnimationFrame(rafId);
    prog = REDUCED ? 1 : 0;
    noteEl.textContent = preset.note;
    btns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cool === preset.id)));
    if (REDUCED) { drawFrame(); return; }
    const start = performance.now();
    const dur = 3400;
    const step = (now: number) => {
      prog = Math.min(1, (now - start) / dur);
      drawFrame();
      if (prog < 1) rafId = requestAnimationFrame(step);
      else rafId = 0;
    };
    rafId = requestAnimationFrame(step);
  };

  btns.forEach(b => b.addEventListener("click", () => {
    const f = COOL_PRESETS.find(x => x.id === b.dataset.cool);
    if (f) { preset = f; play(); }
  }));
  replayBtn.addEventListener("click", play);

  let started = false;
  const io = new IntersectionObserver(entries => {
    if (entries[0]?.isIntersecting && !started) {
      started = true;
      play();
    }
  }, { rootMargin: "-10%" });
  io.observe(root);
  drawFrame();
}

// -------------------------------------- 5. Potts Stored-Energy Ladder Chart
function initPottsChart() {
  const svg = document.getElementById("pottsSvg") as SVGSVGElement | null;
  if (!svg) return;
  const data: [number, number][] = [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0.0003], [5, 0.0142],
    [6, 0.1524], [7, 0.2173], [8, 0.3170], [9, 0.3380], [10, 0.3614], [13, 0.4330], [20, 0.5827],
  ];
  const W = 520, H = 200;
  const pL = 50, pR = 20, pT = 18, pB = 34;
  const w = W - pL - pR, h = H - pT - pB;
  const xOf = (dh: number) => pL + (dh / 20) * w;
  const yOf = (v: number) => pT + (1 - v / 0.65) * h;

  const line = data.map(([x, y], i) => `${i === 0 ? "M" : "L"}${xOf(x).toFixed(1)},${yOf(y).toFixed(1)}`).join(" ");
  const dots = data.map(([x, y]) =>
    `<circle cx="${xOf(x).toFixed(1)}" cy="${yOf(y).toFixed(1)}" r="3.2" fill="var(--data-1)"></circle>`
  ).join("");
  const xKnee = xOf(5.5), xFlat = xOf(8), yNeutral = yOf(9 / 26);

  svg.innerHTML = `
    <rect x="${pL}" y="${pT}" width="${(xOf(3) - pL).toFixed(1)}" height="${h}" fill="var(--fg)" opacity="0.04"></rect>
    <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT + h}" stroke="var(--rule-strong)"></line>
    <line x1="${pL}" y1="${pT + h}" x2="${pL + w}" y2="${pT + h}" stroke="var(--rule-strong)"></line>
    <line x1="${xFlat.toFixed(1)}" y1="${pT}" x2="${xFlat.toFixed(1)}" y2="${pT + h}" stroke="var(--data-2)" stroke-dasharray="3 3"></line>
    <line x1="${pL}" y1="${yNeutral.toFixed(1)}" x2="${pL + w}" y2="${yNeutral.toFixed(1)}" stroke="var(--rule-strong)" stroke-dasharray="2 3"></line>
    <path d="${line}" fill="none" stroke="var(--data-1)" stroke-width="2"></path>
    ${dots}
    <text x="${(xFlat + 6).toFixed(1)}" y="${pT + 13}" fill="var(--data-2)" font-size="11">flat-{100} barrier ΔH = 8 J_b</text>
    <text x="${(xKnee - 4).toFixed(1)}" y="${(pT + h - 8).toFixed(1)}" text-anchor="end" fill="var(--fg-3)" font-size="10">kink onset 5–6</text>
    <text x="${pL + w}" y="${(yNeutral - 5).toFixed(1)}" text-anchor="end" fill="var(--fg-3)" font-size="10">9/26 = 0.346</text>
    <text x="${pL - 8}" y="${pT + 6}" text-anchor="end" fill="var(--fg-3)" font-size="11">0.65</text>
    <text x="${pL - 8}" y="${pT + h + 4}" text-anchor="end" fill="var(--fg-3)" font-size="11">0</text>
    <text x="${pL + w}" y="${H - 10}" text-anchor="end" fill="var(--fg-3)" font-size="11">Stored-energy drive ΔH (J_b)</text>
    <text x="${pL + 4}" y="${H - 10}" fill="var(--fg-3)" font-size="10">v (cells / sweep), 128³ bicrystal</text>
  `;
}

// -------------------------------------------------- 6. Filterable Scope Matrix
function initScopeFilter() {
  const root = document.getElementById("scopeMatrix");
  if (!root) return;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-cat]")];
  const rows = [...root.querySelectorAll<HTMLElement>("[data-cats]")];
  const setCat = (cat: string) => {
    tabs.forEach(t => t.setAttribute("aria-pressed", String(t.dataset.cat === cat)));
    rows.forEach(r => {
      const cats = (r.dataset.cats ?? "").split(" ");
      r.hidden = cat !== "all" && !cats.includes(cat);
    });
  };
  tabs.forEach(t => t.addEventListener("click", () => setCat(t.dataset.cat ?? "all")));
  setCat("all");
}

// ---------------------------------------------------------------------- boot
initToc();
void initDendriteLab();
initInterfaceDemo();
initAlloyExplorer();
initCoolingDemo();
initPottsChart();
initScopeFilter();
