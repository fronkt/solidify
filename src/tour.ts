import type { PhysParams } from "./sim";
import type { Phys3DParams } from "./sim3d";

// Everything a scene/chapter is allowed to do to the instrument.
export interface AppControl {
  clearMelt(undercool: number): void;
  seedCenter(): void;
  twinSeedCenter(): void;
  chillWall(edge?: "left" | "bottom" | "auto"): void;
  scatterSeeds(count: number): void;
  // accepts both solvers' dials; the mode-aware implementation lands each key
  // only on params that actually carry it
  setParams(p: Partial<PhysParams> & Partial<Phys3DParams>): void;
  /** inoculant charge: how many potential nuclei the melt carries (n_max) */
  setInoculant(nmax: number): void;
  setView(v: number): void;
  setSpeed(substeps: number): void;
  setRun(on: boolean): void;
  setWeldAuto(on: boolean): void;
  startOptimizer(): void;
  startChallenge(): void;
  startLab(): void;
  startHeat(): void;
  syncUI(): void;
  /** tour part II: "sec:TITLE" opens+highlights a rail section, else a CSS selector */
  reveal(target: string): void;
  clearReveals(): void;
}

// What the tour itself needs beyond AppControl (declared locally — importing
// UIHost from ui.ts would create a module cycle). main's `app` satisfies both.
export interface TourHost extends AppControl {
  /**
   * v7.1 P6. The composer is a modal at z-index 30 and `#tour` now sits one
   * layer above it, so a chapter can open it and the reader can still reach
   * "next ▸". This is the whole extent of the coupling: the chapter opens the
   * panel and its prose names the slider to move. Nothing in the tour reads or
   * writes the composer's DOM, and restructuring the modal into a dock — which
   * is what a chapter that stepped THROUGH the composer would need — is real
   * work with its own budget and is not in this arc.
   */
  openComposer(): void;
  /**
   * Leaving a chapter puts the modal back, in the same place and for the same
   * reason `clearReveals` does: the next chapter stages the melt, and its
   * "watch" line describes a canvas this panel would be covering.
   */
  closeComposer(): void;
  getMode(): "2d" | "3d";
  setMode(m: "2d" | "3d"): void | Promise<void>;
  canSwitchMode(): boolean;
  setView3d(v: number): void;
  setSym3(j: number): void;
  setSliceSweep(b: boolean): void;
  setCutStyle(v: number): void;
  setStereoOn(b: boolean): void;
  setAlloyOn(b: boolean): void;
}

const NO_SCEN: Partial<PhysParams> = { scen: 0, heatIn: 0, facet: 0 };

// Named scenes: used by the preset buttons AND the tour chapters.
export const SCENES: Record<string, (a: AppControl) => void> = {
  dendrite(a) {
    a.setParams({ ...NO_SCEN, delta: 0.05, aniMode: 4, noiseAmp: 0.006, latent: 1.6, coolRate: 0, alloyOn: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(1.0); a.seedCenter();
    a.setView(0); a.setSpeed(16); a.setRun(true);
  },
  snow(a) {
    a.setParams({ ...NO_SCEN, delta: 0.04, aniMode: 6, noiseAmp: 0.014, latent: 1.8, coolRate: 0, alloyOn: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.92); a.seedCenter();
    a.setView(0); a.setSpeed(16); a.setRun(true);
  },
  seaweed(a) {
    // near-zero anisotropy: dense-branching / seaweed morphology
    a.setParams({ ...NO_SCEN, delta: 0.004, aniMode: 4, noiseAmp: 0.02, latent: 1.5, coolRate: 0, alloyOn: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(1.0); a.seedCenter();
    a.setView(0); a.setSpeed(18); a.setRun(true);
  },
  quasi(a) {
    // the forbidden five: quasicrystal-style interface-energy symmetry
    a.setParams({ ...NO_SCEN, delta: 0.045, aniMode: 5, noiseAmp: 0.008, latent: 1.7, coolRate: 0, alloyOn: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(1.0); a.seedCenter();
    a.setView(0); a.setSpeed(16); a.setRun(true);
  },
  rain(a) {
    a.setParams({ ...NO_SCEN, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.5, coolRate: 0.12, alloyOn: 0 });
    a.setWeldAuto(false);
    a.clearMelt(0.85); a.setInoculant(700);
    a.setView(1); a.setSpeed(22); a.setRun(true);
  },
  casting(a) {
    a.setParams({ ...NO_SCEN, delta: 0.045, aniMode: 4, noiseAmp: 0.014, latent: 1.85, coolRate: 0.28, alloyOn: 0 });
    a.setWeldAuto(false);
    a.clearMelt(0.62); a.chillWall("auto"); a.setInoculant(220);
    a.setView(1); a.setSpeed(26); a.setRun(true);
  },
  bridgman(a) {
    a.setParams({ scen: 1, gradG: 0.11, pullV: 3.5, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.6, coolRate: 0, heatIn: 0, alloyOn: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.5); a.chillWall("left");
    a.setView(1); a.setSpeed(40); a.setRun(true);
  },
  weld(a) {
    a.setParams({ scen: 2, weldPow: 700, weldSig: 4, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.6, coolRate: 0.5, heatIn: 0, alloyOn: 0 });
    a.setInoculant(0);
    a.clearMelt(0.6); a.scatterSeeds(70);
    a.setWeldAuto(true);
    a.setView(0); a.setSpeed(30); a.setRun(true);
  },
  alloy(a) {
    a.setParams({ ...NO_SCEN, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.8, delta: 0.05, aniMode: 4, noiseAmp: 0.008, latent: 1.2, coolRate: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.78); a.seedCenter();
    a.setView(0); a.setSpeed(18); a.setRun(true);
  },
};

// 3D scene presets — same names as SCENES, staged for the volumetric solver;
// the preset row dispatches here in 3D mode. NO_SCEN3 clears every scenario /
// crystal residue a previous scene may have left.
const NO_SCEN3 = { scen: 0, heatIn: 0, twinProb: 0, facet: 0 };
export const SCENES3: Record<string, (a: TourHost) => void> = {
  dendrite(a) {
    a.setSym3(4);
    a.setParams({ ...NO_SCEN3, delta: 0.05, noiseAmp: 0.006, latent: 1.6, coolRate: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(1.0); a.seedCenter();
    a.setView3d(0); a.setSpeed(14); a.setRun(true);
  },
  snow(a) {
    a.setSym3(6);
    a.setParams({ ...NO_SCEN3, delta: 0.04, deltaZ: 0.05, noiseAmp: 0.014, latent: 1.8, coolRate: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.92); a.seedCenter();
    a.setView3d(0); a.setSpeed(16); a.setRun(true);
  },
  seaweed(a) {
    a.setSym3(4);
    a.setParams({ ...NO_SCEN3, delta: 0.004, noiseAmp: 0.02, latent: 1.5, coolRate: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(1.0); a.seedCenter();
    a.setView3d(0); a.setSpeed(18); a.setRun(true);
  },
  rain(a) {
    a.setSym3(4);
    a.setParams({ ...NO_SCEN3, delta: 0.045, noiseAmp: 0.012, latent: 1.5, coolRate: 0.12 });
    a.setWeldAuto(false);
    a.clearMelt(0.85); a.setInoculant(500);
    a.setView3d(1); a.setSpeed(22); a.setRun(true);
  },
  casting(a) {
    a.setSym3(4);
    a.setParams({ ...NO_SCEN3, delta: 0.045, noiseAmp: 0.014, latent: 1.85, coolRate: 0.28, pPore: 0.85 });
    a.setWeldAuto(false);
    a.clearMelt(0.62); a.chillWall("auto"); a.setInoculant(200);
    a.setView3d(1); a.setSpeed(22); a.setRun(true);
  },
  alloy(a) {
    a.setSym3(4);
    a.setParams({ ...NO_SCEN3, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.8, delta: 0.05, noiseAmp: 0.008, latent: 1.2, coolRate: 0 });
    a.setAlloyOn(true);
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.78); a.seedCenter();
    a.setView3d(0); a.setSpeed(18); a.setRun(true);
  },
  bridgman(a) {
    a.setSym3(4);
    a.setParams({ scen: 1, gradG: 0.55, pullV: 3.5, delta: 0.045, noiseAmp: 0.012, latent: 1.6, coolRate: 0, heatIn: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.5);
    a.chillWall("auto");     // = chill floor in 3D: the columnar race starts here
    a.setView3d(1); a.setSpeed(22); a.setRun(true);
  },
  weld(a) {
    a.setSym3(4);
    a.setParams({ scen: 2, weldPow: 950, weldSig: 5, delta: 0.045, noiseAmp: 0.012, latent: 1.6, coolRate: 0.5, heatIn: 0 });
    a.setInoculant(0);
    a.clearMelt(0.6);
    a.scatterSeeds(60);
    a.setWeldAuto(true);
    a.setView3d(0); a.setSpeed(22); a.setRun(true);
  },
  quasi(a) {
    a.setSym3(5);   // icosahedral: the genuine 3D forbidden symmetry
    a.setParams({ scen: 0, delta: 0.02, noiseAmp: 0.008, latent: 1.7, coolRate: 0.02, heatIn: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.8);
    a.seedCenter();
    a.setView3d(1); a.setSpeed(20); a.setRun(true);
  },
  selector(a) {
    // single-crystal grain selector: chill-floor polycrystal races up the
    // Bridgman gradient; the helical pigtail lets exactly one grain through.
    // gradG shallow enough that the channel is undercooled from the pour
    // (the climb is growth-limited, not pull-limited); the blade top stays hot
    a.setSym3(4);
    a.setParams({ scen: 3, gradG: 0.5, pullV: 4.0, delta: 0.045, noiseAmp: 0.012, latent: 1.6, coolRate: 0, heatIn: 0, pPore: 0 });
    a.setInoculant(0); a.setWeldAuto(false);
    a.clearMelt(0.5);
    a.chillWall("auto");
    a.setView3d(1); a.setSpeed(22); a.setRun(true);
  },
};

interface Chapter {
  title: string;
  body: string;
  watch: string;
  apply?(app: TourHost): void;
  hl?: string[];     // reveal targets ("sec:TITLE" or CSS selector)
  part?: string;     // extra label in the chapter counter
  dim?: "2d" | "3d"; // instrument mode this chapter runs in (default 2d)
}

export const CHAPTERS: Chapter[] = [
  {
    title: "The unstable front",
    body: "A bump on a freezing front reaches colder liquid and loses heat faster. It grows into a finger: the Mullins–Sekerka instability.",
    watch: "Watch the flat front break into fingers.",
    apply(a) {
      a.setParams({ scen: 0, delta: 0.008, aniMode: 4, noiseAmp: 0.022, latent: 1.7, coolRate: 0, alloyOn: 0, heatIn: 0 });
      a.setInoculant(0); a.setWeldAuto(false);
      a.clearMelt(0.72); a.chillWall("auto");
      a.setView(3); a.setSpeed(18); a.setRun(true);
    },
  },
  {
    title: "Why arms?",
    body: "Surface energy depends on direction. Cubic crystals favor three ⟨100⟩ axes, giving six arms in 3D. This plane contains four.",
    watch: "The glowing halo shows latent heat leaving the growing solid.",
    apply: SCENES.dendrite,
  },
  {
    title: "Snow",
    body: "Hexagonal symmetry gives ice six preferred growth directions. The same phase-field equations now grow a snowflake.",
    watch: "Noise seeds side branches. Try seaweed for nearly isotropic growth.",
    apply: SCENES.snow,
  },
  {
    title: "Forbidden symmetry",
    body: "Periodic lattices allow 2-, 3-, 4- or 6-fold symmetry. Quasicrystals can have five-fold order without repeating.",
    watch: "This models five-fold interface energy, not an aperiodic atomic lattice. Try ×10 in CRYSTAL.",
    apply: SCENES.quasi,
  },
  {
    title: "The twin",
    body: "Two crystal orientations can grow together as a twin. These six-fold domains are offset by 30°.",
    watch: "Count twelve arms. ORIENT shows the two domains; twin rate in CRYSTAL lets new twins appear during growth.",
    apply(a) {
      a.setParams({ scen: 0, heatIn: 0, delta: 0.042, aniMode: 6, noiseAmp: 0.012, latent: 1.8, coolRate: 0, alloyOn: 0, twinProb: 0 });
      a.setInoculant(0); a.setWeldAuto(false);
      a.clearMelt(0.92); a.twinSeedCenter();
      a.setView(1); a.setSpeed(16); a.setRun(true);
    },
  },
  {
    title: "Many grains",
    body: "Each nucleus carries its own orientation. Growing crystals meet at grain boundaries. Inoculant sites activate only when the melt undercools enough.",
    watch: "Increase cooling rate and reset. More sites can activate before latent heat warms the melt.",
    apply: SCENES.rain,
    hl: ["sec:MELT · PROCESS"],
  },
  {
    title: "The casting",
    body: "A cold mold grows columns inward. New grains ahead of them can block the columns: the columnar-to-equiaxed transition.",
    watch: "Watch columns give way to roughly equiaxed grains.",
    apply: SCENES.casting,
  },
  {
    title: "One direction",
    body: "Bridgman growth pulls a sample through a temperature gradient. Crystals compete while following the moving isotherms.",
    watch: "Raise pull speed in SCENARIO and compare the front.",
    apply: SCENES.bridgman,
  },
  {
    title: "The weld",
    body: "A moving heat source melts a pool. Existing grains grow into the liquid as the pool refreezes.",
    watch: "Steer the laser with your pointer. Switch to RINGS to see the passes.",
    apply: SCENES.weld,
  },
  {
    title: "The alloy",
    body: "Growing solid rejects solute. Enrichment ahead of the front lowers the local melting point and changes growth.",
    watch: "XRAY shows segregation. The alloy composer reports chemistry; its growth restriction Q does not independently predict grain refinement in this solver.",
    apply: SCENES.alloy,
  },
  {
    title: "The line you can cross",
    body: "The alloy composer draws cited phase data; the solver grows one solid phase. Aluminum holds up to 1.65 wt% Si.",
    watch: "Choose A356: the 577 °C eutectic constituent, (Al) + (Si), is about half the equilibrium casting. It is not simulated.",
    apply(a) { SCENES.alloy(a); a.openComposer(); },
  },
  {
    title: "Engineer it",
    body: "The optimizer searches cooling schedules and inoculant charges to reach a target ASTM grain number. It starts paused.",
    watch: "Press ▶ run. Watch measured error fall on the convergence plot, or try challenge.",
    apply(a) { a.startOptimizer(); },
  },
  {
    title: "Run it like a lab",
    body: "Lab mode fixes the charge, atmosphere, hold, superheat, mold and cooling program before pouring. Results come from the recorded run.",
    watch: "Press pour and run. Watch the live curve, then open results. Changing physics dials marks the run as intervened.",
    apply(a) { a.startLab(); },
    hl: ["sec:MODES"],
  },
  {
    title: "Heat treat it",
    body: "Heat treat uses a separate furnace clock. Supported rate laws budget grain-boundary migration; the solid fraction stays fixed.",
    watch: "Annealing coarsens grains and can reduce Hall–Petch strength. Particle pinning changes the endpoint; primary recrystallization is not modeled.",
    apply(a) { a.startHeat(); },
    hl: ["sec:MODES"],
  },

  // ---- part II: a control-by-control walk through the instrument ----------
  {
    part: "THE INSTRUMENT",
    title: "Part II: the instrument",
    body: "This part explains controls without changing your melt. Close the tour anytime.",
    watch: "Reset stages a paused melt. Space runs or pauses; ×1 cycles speed multipliers; rec records the canvas.",
    hl: ["#transport"],
  },
  {
    part: "THE INSTRUMENT",
    title: "The lenses",
    body: "Ten views share one simulation: MELT, ORIENT, ETCH, FIELD, RINGS, THERM, SEM, NEON, XRAY and CURV.",
    watch: "Keys 1–9 and 0 change lenses without changing the physics.",
    hl: ["#views"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Presets",
    body: "Nine one-tap situations stage different growth conditions. TRUE 3D also offers a single-crystal selector.",
    watch: "Every preset stays adjustable. Compare dendrite, snow, seaweed, rain, casting, Bridgman, weld, alloy and quasi.",
    hl: ["sec:PRESETS"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Material",
    body: "Eleven material identities set symmetry, model parameters and display appearance. Cobalt freezes FCC despite its familiar room-temperature HCP structure.",
    watch: "The name on the head plate states what is in the melt.",
    hl: ["sec:MATERIAL", "#head"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Melt · process",
    body: "Undercooling sets the initial temperature. Cooling rate removes heat; inoculant sites supply potential nuclei, not a prescribed nucleation rate.",
    watch: "Seed, twin seed and chill wall add nuclei. Quench cools; hold reheat remelts. The furnace is heat treat.",
    hl: ["sec:MELT · PROCESS"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Scenario",
    body: "FREE is an open melt. BRIDGMAN imposes a moving thermal gradient. WELD adds a traveling heat source.",
    watch: "Adjust gradient and pull speed, or steer the weld laser with your pointer.",
    hl: ["sec:SCENARIO"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Alloy",
    body: "The alloy composer accepts elements in wt% and reports liquidus shift, growth restriction Q and model limits.",
    watch: "Compare alloys at matched undercooling and solid fraction. Q alone does not refine grains in this solver; the science page explains the comparison.",
    hl: ["sec:ALLOY"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Crystal",
    body: "Anisotropy selects growth directions. Noise seeds branches; latent heat warms the melt; facets change interface energy; twin rate creates competing domains.",
    watch: "Twins must outgrow their parent to survive. Five-fold settings model interface symmetry, not atomic structure.",
    hl: ["sec:CRYSTAL"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Analyze",
    body: "Cooling probe records one cell; Scheil compares an analytic segregation path with measurements. Texture rose shows orientations; SDAS ruler measures arm spacing.",
    watch: "Ctrl-tap moves the probe. Open a plot for its data table and exports.",
    hl: ["sec:ANALYZE"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Look",
    body: "Pixel mode and 8-bit palette change appearance. Stain tints ETCH; EBSD map changes ORIENT to a crystallographic orientation map.",
    watch: "Reset view clears zoom and pan. These choices do not change growth.",
    hl: ["sec:LOOK"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Engine · advanced · modes",
    body: "ENGINE sets speed and grid. ADVANCED exposes model dials. MODES opens lab mode, heat treat, optimizer or challenge.",
    watch: "Lab mode, heat treat and optimizer work in both dimensions. The 3D optimizer targets volume-equivalent diameter; challenge remains 2D only.",
    hl: ["sec:ENGINE", "sec:ADVANCED", "sec:MODES"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Calibrate it",
    body: "SCALE names the unit bridge and its sources. The calibrated 2D solver derives interface and kinetic parameters from material data.",
    watch: "The reference interval follows the poured alloy when supported. Coupling λ tests convergence; unsupported compositions and TRUE 3D are refused.",
    hl: ["sec:SCALE"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Your hands",
    body: "Tap to seed, shift-tap for a twin, scroll or pinch to zoom, right-drag or two-finger drag to pan.",
    watch: "Ctrl-tap moves the cooling probe. Open ADVANCED and choose export run to save the setup, data and micrograph.",
    hl: [],
  },

  // ---- part III: the same physics with its missing dimension restored ------
  {
    part: "THE THIRD DIMENSION",
    dim: "3d",
    title: "Part III: out of the plane",
    body: "TRUE 3D evolves a volume rather than a section, with six ⟨100⟩ arms for cubic crystals. Grid size follows GPU capacity.",
    watch: "The volumetric solver remains qualitative Kobayashi; calibrated quantitative growth is currently 2D only.",
    apply(a) {
      a.setInoculant(0);
      a.setSym3(4);
      a.setParams({ delta: 0.05, noiseAmp: 0.006, latent: 1.6, coolRate: 0, heatIn: 0 });
      a.clearMelt(1.0);
      a.seedCenter();
      a.setView3d(0); a.setSpeed(14); a.setRun(true);
    },
  },
  {
    part: "THE THIRD DIMENSION",
    dim: "3d",
    title: "Orbit it",
    body: "Drag to orbit, wheel to dolly and right-drag to pan. ViewCube faces, edges and corners select standard views.",
    watch: "Tap to seed at depth. Shift-tap creates a Σ3 pair: 60° about a shared ⟨111⟩ axis.",
    hl: ["#viewcube"],
  },
  {
    part: "THE THIRD DIMENSION",
    dim: "3d",
    title: "Section it",
    body: "SLICE cuts the volume. Move, tilt or sweep the plane to inspect grains and pores; choose etched or EBSD-style sections.",
    watch: "Stereology compares section measurements with the true 3D census. Random sections usually underestimate grain size.",
    apply(a) {
      a.setSym3(4);
      a.setParams({ delta: 0.045, noiseAmp: 0.012, latent: 1.5, coolRate: 0.1, heatIn: 0 });
      a.clearMelt(0.85);
      a.scatterSeeds(30);
      a.setInoculant(300);
      a.setView3d(2);
      a.setSliceSweep(true);
      a.setCutStyle(4);
      a.setStereoOn(true);
      a.setSpeed(18); a.setRun(true);
    },
    hl: ["sec:VOLUME · 3D"],
  },
  {
    part: "THE THIRD DIMENSION",
    dim: "3d",
    title: "Inspect it",
    body: "Disconnected liquid can shrink into pores. FIELD reveals them; the section plane offers a Niyama risk map.",
    watch: "Only steel uses the cited 0.775 K·s^½·mm⁻¹ threshold. Other metals show relative values. Unmeasured seed cores stay unclassified.",
    apply(a) {
      a.setSym3(4);
      a.setParams({ delta: 0.045, noiseAmp: 0.014, latent: 1.85, coolRate: 0.28, heatIn: 0 });
      a.clearMelt(0.62);
      a.chillWall("auto");
      a.setInoculant(200);
      a.setSliceSweep(false);
      a.setCutStyle(5);
      a.setView3d(3);
      a.setSpeed(20); a.setRun(true);
    },
    hl: ["#hud"],
  },
  {
    part: "THE THIRD DIMENSION",
    dim: "3d",
    title: "Take it home",
    body: "STL saves a printable crystal. 360° records an orbit. Copy setup link reproduces the seeded setup, including the section plane.",
    watch: "Export run bundles settings, measured series and a scaled micrograph. Try the selector preset to watch grain competition.",
    hl: ["sec:VOLUME · 3D"],
  },
];

export class Tour {
  private el: HTMLElement;
  private btn: HTMLElement;
  private nav = 0;   // navigation token: a newer goto/close cancels one awaiting a mode switch
  constructor(private app: TourHost) {
    this.el = document.getElementById("tour")!;
    this.btn = document.getElementById("tourBtn")!;
    // from 3D the tour opens straight onto part III; the 2D chapters would
    // otherwise yank the user out of the volume they are looking at
    this.btn.addEventListener("click", () => {
      const p3 = CHAPTERS.findIndex(c => c.dim === "3d");
      void this.goto(this.app.getMode() === "3d" && p3 >= 0 ? p3 : 0);
    });
  }
  async goto(i: number) {
    if (i < 0 || i >= CHAPTERS.length) return this.close();
    const my = ++this.nav;
    const ch = CHAPTERS[i];
    // settle the instrument mode BEFORE staging the chapter — apply() must hit
    // the solver the chapter was written for
    const want = ch.dim ?? "2d";
    let blocked = false;
    if (this.app.getMode() !== want) {
      if (want === "3d" && !this.app.canSwitchMode()) blocked = true;
      else await this.app.setMode(want);
      if (my !== this.nav) return;   // user navigated on while the mode swapped
      if (this.app.getMode() !== want) blocked = true;
    }
    this.app.clearReveals();
    // and the composer, for the same reason: a chapter may have opened it, and
    // the one after it stages a melt whose "watch" line this modal covers
    this.app.closeComposer();
    if (!blocked) {
      ch.apply?.(this.app);
      this.app.syncUI();
      ch.hl?.forEach(t => this.app.reveal(t));
    } else this.app.syncUI();
    const body = blocked
      ? "TRUE 3D needs an idle instrument and enough GPU memory. " + ch.body
      : ch.body;
    const watch = blocked ? "Try a desktop with WebGPU to explore part III live." : ch.watch;
    this.el.innerHTML = `
      <div class="ch">TOUR · ${i + 1} / ${CHAPTERS.length}${ch.part ? " · " + ch.part : ""}</div>
      <h3>${ch.title}</h3>
      <p>${body}</p>
      <div class="watch">▸ ${watch}</div>
      <div class="nav"></div>`;
    const nav = this.el.querySelector(".nav")!;
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", fn);
      nav.append(b);
    };
    if (i > 0) mk("◂ back", () => void this.goto(i - 1));
    mk(i < CHAPTERS.length - 1 ? "next ▸" : "finish", () => void this.goto(i + 1));
    mk("close", () => this.close());
    this.el.classList.add("show");
    this.btn.classList.add("hide");
  }
  close() {
    this.nav++;
    this.app.clearReveals();
    this.app.closeComposer();
    this.el.classList.remove("show");
    this.btn.classList.remove("hide");
  }
}
