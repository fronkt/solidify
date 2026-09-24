// Landing scroll-story controller. The pinned hero (hero.ts) is a pre-rendered
// image sequence and needs no GPU; below it, three real simulations share one
// GPU device: the pinned ten-lens act, the pinned materials act and the TRUE 3D
// act. Only the sim currently on screen ticks. GSAP's ScrollTrigger drives the
// three pins, created in scroll order; DOM-only motion lives in
// landing-motion.ts. Without WebGPU (or with reduced motion) the acts below the
// hero show stills, unpinned.
//
// Each act is a live canvas beside a spec column (docs/DESIGN.md section 6).
// Every value in those rails is real: a live readout of the running sim, a
// constant this file hands the sim, or a field of materials.ts. A value the
// page cannot read (no WebGPU, no volume) shows the empty-value glyph.

import "./landing-motion";
import { bootHero } from "./hero";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Simulation } from "./sim";
import { Renderer } from "./render";
import { MATERIALS } from "./materials";
import { LENS_NAMES } from "./shaders";
import { stream } from "./rng";

gsap.registerPlugin(ScrollTrigger);

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** the one line under each lens name */
const LENS_DESC = [
  "The melt as it glows. The halo around each growing tip is latent heat.",
  "Polarized light: every grain shows in its own color.",
  "An etched micrograph: dark grain boundaries, darker solute between the arms.",
  "The raw temperature field, with isotherms ahead of the front.",
  "Growth rings: each band is solid that froze at the same moment.",
  "The temperature field in a thermal camera's ironbow palette.",
  "A secondary-electron image: bright edges, scan lines included.",
  "Only the interface, the isotherms and the grain boundaries, drawn as glowing lines.",
  "A synchrotron radiograph: solute segregation in absorption contrast.",
  "Gibbs–Thomson curvature: sharp tips blue, grooves warm. The physics of shape.",
];

/**
 * What each lens draws and the real instrument it imitates, one entry per
 * LENS_NAMES index. Each is read off RENDER_WGSL's `switch (R.view)` in
 * shaders.ts as the landing drives it: Renderer's stain, EBSD and tilt flags
 * stay off here, so ETCH is the plain etch and ORIENT the polarized palette.
 *   MELT    heat(T · meltGlow), the incandescent ramp, over shaded solid
 *   ORIENT  polar() palette per grain (orientation plus a per-grain offset),
 *           relief-shaded, boundaries darkened
 *   ETCH    light liquid, gray grains, dark boundaries, solute-rich solid darker
 *   FIELD   inferno(T) with isotherm lines and the interface in white
 *   RINGS   bands of `age`, the sim time each cell froze
 *   THERM   ironbow(T), the FLIR palette
 *   SEM     gray relief lighting, edge brightening from |∇φ|, scan lines
 *   NEON    interface, liquid isotherms and grain boundaries as glow on black
 *   XRAY    exp(−attenuation) from φ and solute c
 *   CURV    the interface colored by ∇²φ / |∇φ|, its curvature
 * A lens that imitates no instrument says so.
 */
const LENS_SPEC: { shows: string; imitates: string }[] = [
  { shows: "temperature, as glow", imitates: "the naked eye" },
  { shows: "grains, by color", imitates: "polarized-light microscope" },
  { shows: "grain boundaries", imitates: "optical microscope, etched" },
  { shows: "temperature T", imitates: "none: solver output" },
  { shows: "time of freezing", imitates: "none: solver record" },
  { shows: "temperature T", imitates: "thermal camera" },
  { shows: "edges and relief", imitates: "scanning electron microscope" },
  { shows: "interface and boundaries", imitates: "none: stylized" },
  { shows: "solute, by absorption", imitates: "synchrotron radiography" },
  { shows: "interface curvature", imitates: "none: model quantity" },
];

/** the melts the materials act steps through; every number in its rail is
 *  read from MATERIALS[key], not written here. `tmNote` says whose melting
 *  point si.Tm is when it is not the named material's own: steel's is pure
 *  iron's (the material is Fe–C δ-ferrite), aluminum's pure aluminum's (the
 *  material is Al–4Cu). */
interface MatStep { key: string; name: string; fact: string; undercool: number; tmNote?: string }
const MAT_STEPS: MatStep[] = [
  { key: "steel", name: "Steel", fact: "It pours white-hot, the brightest melt in the instrument.", undercool: 0.9, tmNote: "pure Fe" },
  { key: "al", name: "Aluminum", fact: "It freezes low enough that the melt glows only a dull red.", undercool: 0.9, tmNote: "pure Al" },
  { key: "zn", name: "Zinc", fact: "Too cool to glow: six-fold crystals, the spangle on galvanized steel.", undercool: 0.95 },
  { key: "ice", name: "Ice", fact: "Six-fold because the lattice is hexagonal, which is why no snowflake has four arms.", undercool: 0.92 },
];

/** the lens and materials sims' grid, and the TRUE 3D act's requested side */
const LN = 256;
const D3N = 96;

/** The TRUE 3D act's pour: a warm-ish melt, so diffusion-limited growth keeps
 *  the crystal dendritic (a fully cold melt grows a featureless blob) while
 *  the cooling rate keeps it moving on stage. aniMode3 1 is the cubic ⟨100⟩
 *  anisotropy; the rail's symmetry row is read off it (SYM3), so a change of
 *  mode here changes the words on screen. */
const D3_POUR = {
  aniMode3: 1, delta: 0.05, noiseAmp: 0.014, latent: 1.7,
  coolRate: 0.04, heatIn: 0, pPore: 0, meltGlow: 1.0,
};
/** sim3d's anisotropy modes (Sim3DParams.aniMode3), as the rail words them */
const SYM3: Record<number, { value: string; sub: string }> = {
  0: { value: "isotropic", sub: "no preferred direction" },
  1: { value: "cubic ⟨100⟩", sub: "six primary arms" },
  2: { value: "hexagonal", sub: "six-fold in the basal plane" },
  3: { value: "icosahedral", sub: "five-fold axes" },
};

/** A screen under 560 px tall (index.html's head gate asks the same query)
 *  cannot fit a pinned act's column: there the acts scroll like a page, and
 *  the lens and melt steps follow each act's passage through the screen
 *  instead of a pin. Read once, at boot. */
const SHORT = matchMedia("(max-height: 560px)").matches;
const stepTrigger = (trigger: string, length: number) => SHORT
  ? { trigger, start: "top 75%", end: "bottom 25%", scrub: true }
  : { trigger, start: "top top", end: `+=${length}`, pin: true, scrub: true };

/** the landing fell back to its stills (no WebGPU, reduced motion, a lost
 *  device): nothing may step the acts' words away from their stills */
let still = false;
let toStill = () => {};

// ------------------------------------------------------------ spec rails
interface Row { label: string; sub?: string; value: string; unit?: string; text?: boolean; live?: string }

const fmtPct = (f: number) => (f * 100).toFixed(0);
const EMPTY = "—";

/** Render a spec rail (tokens.css .spec) into a <dl>. A row with `live` keeps
 *  a handle so its value can be updated in place (setLive). */
function renderRows(dl: HTMLElement, rows: Row[]) {
  dl.replaceChildren(...rows.map(r => {
    const row = document.createElement("div");
    row.className = "spec__row";
    if (r.live) row.dataset.live = r.live;
    const dt = document.createElement("dt");
    dt.className = "spec__label";
    dt.textContent = r.label;
    if (r.sub) { const s = document.createElement("small"); s.textContent = r.sub; dt.append(s); }
    const dd = document.createElement("dd");
    dd.className = r.text ? "spec__value spec__value--text" : "spec__value";
    // a readout not yet read shows the empty glyph, and no unit beside it
    if (r.value === EMPTY) dd.classList.add("is-empty");
    const v = document.createElement("span");
    v.className = "spec__v";
    v.textContent = r.value;
    dd.append(v);
    if (r.unit) {
      const u = document.createElement("span");
      u.className = r.unit.startsWith("-") ? "spec__unit spec__unit--tight" : "spec__unit";
      u.textContent = r.unit;
      dd.append(u);
    }
    row.append(dt, dd);
    return row;
  }));
}

/** a live value updates in place with ONE 150 ms opacity tick (DESIGN.md):
 *  tokens.css's spec-tick keyframe, restarted for each new value, which ends
 *  at full opacity rather than holding the value dimmed */
function setLive(dl: HTMLElement, key: string, text: string) {
  const dd = dl.querySelector<HTMLElement>(`[data-live="${key}"] .spec__value`);
  const v = dd?.querySelector<HTMLElement>(".spec__v");
  if (!dd || !v || v.textContent === text) return;
  v.textContent = text;
  dd.classList.remove("is-empty", "is-tick");
  void dd.offsetWidth;   // a reflow between the two restarts the animation
  dd.classList.add("is-tick");
}

/** The lens rail: the two word rows, then, only while a melt is running
 *  (`grid`, the sim's own side), its live readouts and its grid. The still
 *  act has no melt to read, so it carries no numbers. */
function lensRows(idx: number, grid: number | null): Row[] {
  const s = LENS_SPEC[idx];
  const rows: Row[] = [
    { label: "shows", value: s.shows, text: true },
    { label: "instrument", value: s.imitates, text: true },
  ];
  if (grid) rows.push(
    { label: "solid fraction · live", value: EMPTY, unit: "%", live: "solid" },
    { label: "grains · live", value: EMPTY, live: "grains" },
    { label: "grid", value: `${grid}²`, unit: "cells" },
  );
  return rows;
}

function matRows(step: MatStep): Row[] {
  const m = MATERIALS[step.key];
  const rows: Row[] = [];
  if (m.si) rows.push({ label: "melting point", sub: step.tmNote, value: String(Math.round(m.si.Tm - 273.15)), unit: "°C" });
  // the note's first segment is the structure (Material.note: "structure ·
  // symmetry · T_m")
  rows.push({ label: "crystal structure", value: m.note.split(" · ")[0], text: true });
  if (m.params.aniMode) rows.push({ label: "dendrite symmetry", sub: "in a 2D section", value: String(m.params.aniMode), unit: "-fold" });
  // meltGlow multiplies T in the MELT lens's incandescent ramp: a display
  // setting, not a brightness anyone measured, and the row says so
  if (m.params.meltGlow !== undefined)
    rows.push({ label: "glow scale", sub: "MELT lens display, not a measurement", value: m.params.meltGlow.toFixed(2) });
  return rows;
}

/** The TRUE 3D rail; `n` is the running volume's side (null for the still),
 *  `mode` its anisotropy (Sim3DParams.aniMode3) */
function d3Rows(n: number | null, mode: number): Row[] {
  const s = SYM3[mode] ?? { value: `mode ${mode}`, sub: "" };
  const sym: Row = { label: "symmetry", sub: s.sub || undefined, value: s.value, text: true };
  if (!n) return [sym, { label: "render", value: "still image", text: true }];
  return [
    { label: "grid", value: `${n}³`, unit: "voxels" },
    sym,
    { label: "render", sub: "live on your GPU", value: "raymarched", text: true },
    { label: "solid fraction · live", value: EMPTY, unit: "%", live: "solid" },
  ];
}

function buildSegs(el: HTMLElement, count: number) {
  el.replaceChildren(...Array.from({ length: count }, () => document.createElement("i")));
  el.children[0].classList.add("is-on");
}

function setSegs(el: HTMLElement, count: HTMLElement, idx: number) {
  [...el.children].forEach((c, i) => c.classList.toggle("is-on", i === idx));
  count.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(el.children.length).padStart(2, "0")}`;
}

/** the stills: canvases hidden (index.html .nogpu), and every column back on
 *  the words its still image shows */
function staticFallback() {
  still = true;
  document.body.classList.add("nogpu");
  toStill();
}

async function boot() {
  // a pinned scroll story restored mid-pin on reload is disorienting; start clean
  history.scrollRestoration = "manual";
  // The hero FIRST, and before any await: it does not depend on WebGPU, so it
  // boots above the gate below, and its pin is created synchronously so it
  // exists before the lens and materials pins. A pin created after a later one
  // computes its start without the earlier spacer (verify-scroll-order.mjs).
  bootHero();

  // the three spec columns, filled before the GPU gate so the still acts
  // (reduced motion, no WebGPU) carry their rails too; live values stay empty
  // until a sim runs
  const lensName = document.getElementById("lensName")!;
  const lensDesc = document.getElementById("lensDesc")!;
  const lensSpec = document.getElementById("lensSpec")!;
  const lensRail = document.getElementById("lensRail")!;
  const lensCount = document.getElementById("lensCount")!;
  const matName = document.getElementById("matName")!;
  const matFact = document.getElementById("matFact")!;
  const matSpec = document.getElementById("matSpec")!;
  const matRail = document.getElementById("matRail")!;
  const matCount = document.getElementById("matCount")!;
  const d3Spec = document.getElementById("d3Spec")!;
  buildSegs(lensRail, LENS_NAMES.length);
  buildSegs(matRail, MAT_STEPS.length);
  // The lens act's still is a capture through ONE lens, and its <img> says
  // which (data-lens): the still column describes that lens, never the live
  // melt's first one.
  const lensImg = document.querySelector<HTMLImageElement>("#lensAct img.fb");
  const stillLens = Math.max(0, LENS_NAMES.indexOf(lensImg?.dataset.lens ?? ""));
  const showLens = (idx: number, grid: number | null) => {
    lensName.textContent = LENS_NAMES[idx];
    lensDesc.textContent = LENS_DESC[idx];
    renderRows(lensSpec, lensRows(idx, grid));
    setSegs(lensRail, lensCount, idx);
  };
  const showMat = (idx: number) => {
    const m = MAT_STEPS[idx];
    matName.textContent = m.name;
    matFact.textContent = m.fact;
    renderRows(matSpec, matRows(m));
    setSegs(matRail, matCount, idx);
  };
  toStill = () => {
    showLens(stillLens, null);
    showMat(0);
    renderRows(d3Spec, d3Rows(null, D3_POUR.aniMode3));
  };
  toStill();

  if (reduced || !navigator.gpu) return staticFallback();
  let device: GPUDevice;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return staticFallback();
    device = await adapter.requestDevice(
      adapter.features.has("float32-filterable")
        ? { requiredFeatures: ["float32-filterable"] }   // smooth trilinear raymarch in the 3D act
        : undefined);
    device.lost.then(info => { if (info.reason !== "destroyed") staticFallback(); });
  } catch {
    return staticFallback();
  }

  // ------------------------------------------------------- lens act (pinned)
  const lensSim = new Simulation(device, LN);
  const lensCanvas = document.getElementById("lensSim") as HTMLCanvasElement;
  const lensRen = new Renderer(device, lensCanvas, lensSim);
  // live: the melt opens on the first lens, whatever the still showed
  showLens(0, lensSim.n);
  let lensView = 0;
  const pourLens = () => {
    Object.assign(lensSim.params, {
      aniMode: 4, delta: 0.045, noiseAmp: 0.012, latent: 1.6, coolRate: 0.08,
      alloyOn: 1, c0: 0.25, mLiq: 0.4, kPart: 0.2, dSol: 0.8,
      twinProb: 0.0008, meltGlow: 1.0, scen: 0, heatIn: 0,
    });
    lensSim.reset(0.12);
    const r = stream("landing");
    for (let i = 0; i < 9; i++)
      lensSim.addSeed(r.upto(LN), r.upto(LN), 3.5, undefined, 0.02 + r.upto(0.08));
  };
  pourLens();
  // the rail reads the melt it is shown beside, then re-pours it once it is
  // nearly solid; resolves to the stats it printed (null if a read was in flight)
  const pollLens = () => lensSim.readStats().then(s => {
    if (!s) return null;
    setLive(lensSpec, "solid", fmtPct(s.fracSolid));
    setLive(lensSpec, "grains", String(s.grainCount));
    if (s.fracSolid > 0.93) pourLens();
    return s;
  });
  let lensPoll = 0;
  const lensScene = (dt: number) => {
    lensPoll += dt;
    if (lensPoll > 0.6) {
      lensPoll = 0;
      void pollLens();
    }
  };

  const setLens = (idx: number) => {
    if (still || idx === lensView) return;
    lensView = idx;
    lensName.textContent = LENS_NAMES[idx];
    lensDesc.textContent = LENS_DESC[idx];
    lensCanvas.setAttribute("aria-label", `Live simulation, ${LENS_NAMES[idx]} lens`);
    // the two word rows change with the lens; the live rows are the melt's
    // and carry over
    const rows = lensSpec.querySelectorAll<HTMLElement>(".spec__row .spec__v");
    rows[0].textContent = LENS_SPEC[idx].shows;
    rows[1].textContent = LENS_SPEC[idx].imitates;
    setSegs(lensRail, lensCount, idx);
    gsap.fromTo(lensName, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power2.out", overwrite: true });
    gsap.fromTo([lensDesc, rows[0], rows[1]], { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "none", overwrite: true });
  };

  ScrollTrigger.create({
    ...stepTrigger("#lensAct", 3600),
    onUpdate: self => setLens(Math.min(LENS_NAMES.length - 1, Math.floor(self.progress * LENS_NAMES.length))),
  });

  // -------------------------------------------------- materials act (pinned)
  const matSim = new Simulation(device, LN);
  const matCanvas = document.getElementById("matSim") as HTMLCanvasElement;
  const matRen = new Renderer(device, matCanvas, matSim);
  let matIdx = -1;
  const setMat = (idx: number) => {
    if (still || idx === matIdx) return;
    const first = matIdx < 0;
    matIdx = idx;
    const m = MAT_STEPS[idx];
    Object.assign(matSim.params, { scen: 0, heatIn: 0, coolRate: 0.04, twinProb: 0, noiseAmp: 0.012 }, MATERIALS[m.key].params);
    matSim.reset(1 - m.undercool);
    const r = stream("landing");
    for (let i = 0; i < 6; i++)
      matSim.addSeed(r.upto(LN), r.upto(LN), 3.5);
    showMat(idx);
    matCanvas.setAttribute("aria-label", `Live simulation, ${m.name} melt`);
    if (!first)
      gsap.fromTo([matName, matFact, matSpec], { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: "power2.out", overwrite: true });
  };
  setMat(0);

  ScrollTrigger.create({
    ...stepTrigger("#matAct", 2200),
    onUpdate: self => setMat(Math.min(MAT_STEPS.length - 1, Math.floor(self.progress * MAT_STEPS.length))),
  });

  // --------------------------------------------- true-3D act (live volume)
  // dynamic import: the volumetric solver + raymarcher only load when the
  // device can host them; any failure leaves the still-image fallback
  const d3Canvas = document.getElementById("d3Sim") as HTMLCanvasElement;
  // `sub` carries the fractional substep budget (see the master loop) and `done`
  // latches once the crystal is grown: the volume holds its finished shape
  // instead of re-pouring, so a visitor who scrolls back finds the same crystal.
  let d3: { sim: import("./sim3d").Sim3D; ren: import("./render3d").Renderer3D; poll: number; sub: number; done: boolean } | null = null;
  const D3_PLANE = { n: [0, 0, 1] as [number, number, number], c: 48 };
  const pourD3 = () => {
    if (!d3) return;
    Object.assign(d3.sim.params, D3_POUR);
    d3.sim.reset(0.15);
    d3.sim.addSeed3D(d3.sim.n / 2, d3.sim.n / 2, d3.sim.n / 2, 4);
  };
  // the rail reads the volume it is shown beside, and latches `done` once the
  // crystal is grown: past this solid fraction the arms merge into a
  // featureless block, so the finished crystal is the thing worth keeping on
  // screen; resolves to the stats it printed (null if a read was in flight)
  const pollD3 = async () => {
    if (!d3) return null;
    const s = await d3.sim.readStats();
    if (!s) return null;
    setLive(d3Spec, "solid", fmtPct(s.fracSolid));
    if (s.fracSolid > 0.45) d3.done = true;
    return s;
  };
  if (device.limits.maxStorageTexturesPerShaderStage >= 3) {
    try {
      const [{ Sim3D }, { Renderer3D }] = await Promise.all([import("./sim3d"), import("./render3d")]);
      const s3 = await Sim3D.create(device, D3N);
      if (s3) {
        d3 = { sim: s3, ren: new Renderer3D(device, d3Canvas, s3), poll: 0, sub: 0, done: false };
        pourD3();
      }
    } catch {
      d3 = null;
    }
  }
  if (d3) renderRows(d3Spec, d3Rows(d3.sim.n, d3.sim.params.aniMode3));
  else document.getElementById("threeDAct")!.classList.add("no3d");

  // ------------------------------------------- visibility-gated master loop
  const active = { lens: false, mat: false, d3: false };
  const watch = (el: Element, key: keyof typeof active) => {
    new IntersectionObserver(es => {
      for (const e of es) active[key] = e.isIntersecting;
    }, { threshold: 0.02 }).observe(el);
  };
  watch(lensCanvas, "lens");
  watch(matCanvas, "mat");
  if (d3) watch(d3Canvas, "d3");

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
      if (active.d3 && d3) {
        if (!d3.done) {
          d3.poll += dt;
          if (d3.poll > 0.7) {
            d3.poll = 0;
            // grown: pollD3 freezes the solver rather than re-pouring
            void pollD3();
          }
          // a third of the old rate (was a flat 10 substeps/frame), so the
          // crystal takes 3x as long to grow. The budget is carried as a
          // fraction because 10/3 is not an integer number of Euler steps.
          d3.sub += 10 / 3;
          const sub = Math.floor(d3.sub);
          d3.sub -= sub;
          if (sub > 0) d3.sim.step(sub);
        }
        d3.ren.tick(dt);
        d3.ren.spinTo(-0.95 + t * 0.00012);   // one slow orbit ≈ 52 s
        d3.ren.render(d3.sim, 0, t / 1000, D3_PLANE);
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
    d3: () => d3,
    active,
    ST: ScrollTrigger,   // test hook: assert pinned acts never overlap
    pollLens,            // verify-landing-acts: the rails' own reads, on demand
    pollD3,
    short: SHORT,
  };
}

void boot();
