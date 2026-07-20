import type { PhysParams } from "./sim";

// Everything a scene/chapter is allowed to do to the instrument.
export interface AppControl {
  clearMelt(undercool: number): void;
  seedCenter(): void;
  twinSeedCenter(): void;
  chillWall(edge?: "left" | "bottom" | "auto"): void;
  scatterSeeds(count: number): void;
  setParams(p: Partial<PhysParams>): void;
  setRain(perSec: number): void;
  setView(v: number): void;
  setSpeed(substeps: number): void;
  setRun(on: boolean): void;
  setWeldAuto(on: boolean): void;
  startOptimizer(): void;
  startChallenge(): void;
  syncUI(): void;
  /** tour part II: "sec:TITLE" opens+highlights a rail section, else a CSS selector */
  reveal(target: string): void;
  clearReveals(): void;
}

const NO_SCEN: Partial<PhysParams> = { scen: 0, heatIn: 0 };

// Named scenes: used by the preset buttons AND the tour chapters.
export const SCENES: Record<string, (a: AppControl) => void> = {
  dendrite(a) {
    a.setParams({ ...NO_SCEN, delta: 0.05, aniMode: 4, noiseAmp: 0.006, latent: 1.6, coolRate: 0, alloyOn: 0 });
    a.setRain(0); a.setWeldAuto(false);
    a.clearMelt(1.0); a.seedCenter();
    a.setView(0); a.setSpeed(16); a.setRun(true);
  },
  snow(a) {
    a.setParams({ ...NO_SCEN, delta: 0.04, aniMode: 6, noiseAmp: 0.014, latent: 1.8, coolRate: 0, alloyOn: 0 });
    a.setRain(0); a.setWeldAuto(false);
    a.clearMelt(0.92); a.seedCenter();
    a.setView(0); a.setSpeed(16); a.setRun(true);
  },
  seaweed(a) {
    // near-zero anisotropy: dense-branching / seaweed morphology
    a.setParams({ ...NO_SCEN, delta: 0.004, aniMode: 4, noiseAmp: 0.02, latent: 1.5, coolRate: 0, alloyOn: 0 });
    a.setRain(0); a.setWeldAuto(false);
    a.clearMelt(1.0); a.seedCenter();
    a.setView(0); a.setSpeed(18); a.setRun(true);
  },
  rain(a) {
    a.setParams({ ...NO_SCEN, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.5, coolRate: 0.12, alloyOn: 0 });
    a.setWeldAuto(false);
    a.clearMelt(0.85); a.setRain(14);
    a.setView(1); a.setSpeed(22); a.setRun(true);
  },
  casting(a) {
    a.setParams({ ...NO_SCEN, delta: 0.045, aniMode: 4, noiseAmp: 0.014, latent: 1.85, coolRate: 0.28, alloyOn: 0 });
    a.setWeldAuto(false);
    a.clearMelt(0.62); a.chillWall("auto"); a.setRain(3);
    a.setView(1); a.setSpeed(26); a.setRun(true);
  },
  bridgman(a) {
    a.setParams({ scen: 1, gradG: 0.11, pullV: 3.5, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.6, coolRate: 0, heatIn: 0, alloyOn: 0 });
    a.setRain(0); a.setWeldAuto(false);
    a.clearMelt(0.5); a.chillWall("left");
    a.setView(1); a.setSpeed(40); a.setRun(true);
  },
  weld(a) {
    a.setParams({ scen: 2, weldPow: 700, weldSig: 4, delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.6, coolRate: 0.5, heatIn: 0, alloyOn: 0 });
    a.setRain(0);
    a.clearMelt(0.6); a.scatterSeeds(70);
    a.setWeldAuto(true);
    a.setView(0); a.setSpeed(30); a.setRun(true);
  },
  alloy(a) {
    a.setParams({ ...NO_SCEN, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.8, delta: 0.05, aniMode: 4, noiseAmp: 0.008, latent: 1.2, coolRate: 0 });
    a.setRain(0); a.setWeldAuto(false);
    a.clearMelt(0.78); a.seedCenter();
    a.setView(0); a.setSpeed(18); a.setRun(true);
  },
};

interface Chapter {
  title: string;
  body: string;
  watch: string;
  apply?(app: AppControl): void;
  hl?: string[];     // reveal targets ("sec:TITLE" or CSS selector)
  part?: string;     // extra label in the chapter counter
}

export const CHAPTERS: Chapter[] = [
  {
    title: "The unstable front",
    body: "A flat solidification front in an undercooled melt cannot stay flat. Any bump reaches deeper into cold liquid, rejects its latent heat faster, and grows faster still — the Mullins–Sekerka instability.",
    watch: "Watch the flat front from the wall break into fingers on its own.",
    apply(a) {
      a.setParams({ scen: 0, delta: 0.008, aniMode: 4, noiseAmp: 0.022, latent: 1.7, coolRate: 0, alloyOn: 0, heatIn: 0 });
      a.setRain(0); a.setWeldAuto(false);
      a.clearMelt(0.72); a.chillWall("auto");
      a.setView(3); a.setSpeed(18); a.setRun(true);
    },
  },
  {
    title: "Why arms?",
    body: "Crystals are not round because surface energy depends on direction. A cubic metal grows fastest along four preferred directions, so a free crystal sharpens into a four-armed dendrite — the same physics that shapes every cast metal part.",
    watch: "Four arms lock onto the crystal axes; the glowing halo is latent heat escaping.",
    apply: SCENES.dendrite,
  },
  {
    title: "Snow",
    body: "Change the symmetry of that surface energy from four-fold to six-fold and the same equations grow a snowflake. Ice is hexagonal; that single fact is why no snowflake has four arms.",
    watch: "Side branches appear where random noise disturbs the growing tip. (Try the SEAWEED preset for what happens with almost no anisotropy.)",
    apply: SCENES.snow,
  },
  {
    title: "The twin",
    body: "Sometimes a growing crystal makes a perfect mistake: a second lattice forms on it in mirror registry — a twin. Aluminum castings grow whole feathery grains this way, and two ice crystals locked at 30° grow the rarest snowflake of all: twelve branches.",
    watch: "One seed, two orientations. Count the arms — twelve. The two twin domains show as two colours split by a faint boundary; real twin boundaries etch faint too. Raise TWIN RATE in CRYSTAL to let twins fire mid-growth.",
    apply(a) {
      a.setParams({ scen: 0, heatIn: 0, delta: 0.042, aniMode: 6, noiseAmp: 0.012, latent: 1.8, coolRate: 0, alloyOn: 0, twinProb: 0 });
      a.setRain(0); a.setWeldAuto(false);
      a.clearMelt(0.92); a.twinSeedCenter();
      a.setView(1); a.setSpeed(16); a.setRun(true);
    },
  },
  {
    title: "Many grains",
    body: "Real melts nucleate everywhere at once. Each nucleus is a crystal with its own random orientation; where they collide, growth stops and a grain boundary is frozen in. This is why metal is made of grains.",
    watch: "Each colour is one crystal orientation. When the last liquid vanishes, switch to ETCH — that is a micrograph.",
    apply: SCENES.rain,
  },
  {
    title: "The casting",
    body: "Pour metal against a cold mould wall and columnar grains race inward, feeding on the heat gradient. Ahead of them the melt undercools until new equiaxed grains nucleate and block the columns — the columnar-to-equiaxed transition every foundry fights over.",
    watch: "Long columns from the wall, then a sudden switch to round grains mid-domain.",
    apply: SCENES.casting,
  },
  {
    title: "One direction",
    body: "In directional solidification the sample is pulled through a fixed temperature gradient — the Bridgman furnace, how turbine-blade alloys and semiconductor crystals are grown. The front can only follow the moving isotherms.",
    watch: "An aligned columnar array marches with the gradient. Raise PULL SPEED and the front destabilises into finer cells and dendrites.",
    apply: SCENES.bridgman,
  },
  {
    title: "The weld",
    body: "A weld is solidification in motion: a travelling heat source melts a pool and the structure refreezes epitaxially behind it, growing off the grains it just melted. Every weld bead carries this signature microstructure.",
    watch: "Steer the laser with your pointer (or let it raster). Then switch to RINGS — the growth history of every pass is written in the bands.",
    apply: SCENES.weld,
  },
  {
    title: "The alloy",
    body: "Real metals are alloys. The growing solid rejects solute, which piles up ahead of the front and lowers the local melting point — constitutional undercooling, the engine of most real dendrites. The rejected solute freezes into the last liquid between the arms.",
    watch: "Blue-green halos hug the interface. Switch to XRAY — the segregation shows up exactly the way it does in synchrotron radiographs of real solidifying alloys. Then open COMPOSE ALLOY and mix your own: the growth restriction factor Q it reports genuinely refines the grains here.",
    apply: SCENES.alloy,
  },
  {
    title: "Engineer it",
    body: "Grain size sets strength — finer is stronger (Hall–Petch). A process engineer tunes cooling and inoculation to hit a target grain size. This opens ENGINEERING · ML MODE, where a CMA-ES optimizer does that job: it runs one casting after another, measures the ASTM grain number, and learns the recipe. It starts paused — press ▶ RUN to set it going, PAUSE to freeze any casting and inspect it.",
    watch: "Once running it replays dozens of fast castings back to back. Early ones nucleate heavily and look like a chaotic blizzard of grains — that is the optimizer exploring, not a glitch: grain count and nucleation are the same knob, so it tries a lot before it homes in. Watch |ΔG| shrink in the panel as it converges; drag the target toward G 1 and the grains thin out, toward G 6 and they multiply. Or fight it yourself with CHALLENGE.",
    apply(a) { a.startOptimizer(); },
  },

  // ---- part II: a control-by-control walk through the instrument ----------
  {
    part: "THE INSTRUMENT",
    title: "Part II: the instrument",
    body: "The rest of the tour walks every control on the instrument, dropdown by dropdown. Nothing in part II touches your melt — whatever you have growing keeps growing. Close anytime.",
    watch: "The transport (bottom left): RESET arms a fresh melt so you can stage seeds while paused, RUN/PAUSE is the space bar, TURBO fast-forwards, and ⏺ REC saves a .webm clip of the canvas.",
    hl: ["#transport"],
  },
  {
    part: "THE INSTRUMENT",
    title: "The lenses",
    body: "Ten ways to look at the same physics: incandescent MELT, ORIENT colours, the ETCH micrograph, raw FIELD, growth RINGS, a THERM camera, SEM, NEON contours, XRAY segregation, and CURV curvature.",
    watch: "Keys 1–9 and 0 switch lenses instantly — the crystal never notices.",
    hl: ["#views"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Presets",
    body: "Eight one-tap situations: dendrite, snow, seaweed, nucleation rain, a chilled casting, Bridgman directional growth, a raster weld, and a solutal alloy. Each stages the physics and hands the controls straight back to you.",
    watch: "They are starting points, not demos — everything stays fully adjustable afterwards.",
    hl: ["sec:PRESETS"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Material",
    body: "Ten material identities. Crystal structure picks the dendrite symmetry — FCC and BCC metals grow 4-fold, HCP metals 6-fold, and cobalt surprises everyone by freezing FCC. Each also sets how brightly its melt genuinely glows: steel white-hot, zinc not at all.",
    watch: "The amber line under the SOLIDIFY logo always states exactly what is in the melt.",
    hl: ["sec:MATERIAL"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Melt · process",
    body: "The foundry dials: UNDERCOOLING is how cold the melt starts, COOLING RATE keeps pulling heat out, and NUCLEATION rains in seeds gated by local temperature, like inoculant particles of varying potency.",
    watch: "The buttons: SEED and TWIN SEED drop nuclei, CHILL WALL lines an edge, QUENCH ⚡ plunges the whole melt colder, and holding ANNEAL ⌛ remelts and coarsens.",
    hl: ["sec:MELT · PROCESS"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Scenario",
    body: "FREE is an open melt. BRIDGMAN pulls the sample through a fixed thermal gradient — set the gradient and pull speed — the way turbine blades are grown. WELD drives a moving laser pool with power, spot size, and an auto-raster.",
    watch: "In weld mode your pointer steers the laser directly.",
    hl: ["sec:SCENARIO"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Alloy",
    body: "The dilute-solute field: composition, liquidus slope, and diffusivity sliders, plus partition k in ADVANCED. The ⚗ COMPOSE ALLOY builder goes further — pick a base metal, add elements in wt%, and read the real chemistry: liquidus shift and the growth restriction factor Q that foundries use to predict grain refinement.",
    watch: "Pour A356 + TiB against Al–1Zn under the same nucleation: composition alone refines the grains eight-fold. Compositions are shareable as #alloy links.",
    hl: ["sec:ALLOY"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Crystal",
    body: "The crystallography: ANISOTROPY δ sharpens arms (near zero grows seaweed), the symmetry toggles 4-fold metal against 6-fold ice, TIP NOISE seeds side-branches, LATENT HEAT K feeds recalescence, and TWIN RATE lets growth twins nucleate at the front.",
    watch: "Twins must out-grow their parent to survive — the winners widen into feathery grains.",
    hl: ["sec:CRYSTAL"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Analyze",
    body: "Foundry instruments: the COOLING PROBE plots T(t) at one cell — watch the recalescence arrest — and ctrl-tap moves it. SCHEIL overlays the predicted solidification path against what the sim measures. The TEXTURE ROSE histograms grain orientations. The SDAS RULER measures arm spacing by dragging a line, metallographer-style.",
    watch: "Grow a Bridgman casting with the rose open: columnar competition visibly sharpens the texture.",
    hl: ["sec:ANALYZE"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Look",
    body: "PIXEL MODE and the 8-BIT palette are the retro looks. The GRAIN STAIN select tints the ETCH micrograph like real reagents — Klemm's browns and blues, Beraha's violets, or anodize under crossed polars. EBSD FLAT MAP turns ORIENT into a microscope-style IPF orientation map.",
    watch: "RESET VIEW undoes any zoom and pan.",
    hl: ["sec:LOOK"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Engine · advanced · modes",
    body: "ENGINE sets simulation speed, brush size, and the grid (512² to 2048²). ADVANCED exposes the raw model dials — interface width ε̄, kinetics γ, driving α, relaxation τ, partition k — clamped to the numerically stable envelope. MODES holds the CMA-ES optimizer and the challenge match.",
    watch: "Instability is unreachable from the sliders on purpose: every range was mapped before shipping.",
    hl: ["sec:ENGINE", "sec:ADVANCED", "sec:MODES"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Your hands",
    body: "On the canvas itself: tap to nucleate a crystal, shift-tap for a twinned pair, scroll or pinch to zoom, right-drag (or two fingers) to pan, and ctrl-tap to move the cooling probe.",
    watch: "That is the whole instrument. Go freeze something.",
    hl: [],
  },
];

export class Tour {
  private el: HTMLElement;
  private btn: HTMLElement;
  constructor(private app: AppControl) {
    this.el = document.getElementById("tour")!;
    this.btn = document.getElementById("tourBtn")!;
    this.btn.addEventListener("click", () => this.goto(0));
  }
  goto(i: number) {
    if (i < 0 || i >= CHAPTERS.length) return this.close();
    const ch = CHAPTERS[i];
    this.app.clearReveals();
    ch.apply?.(this.app);
    this.app.syncUI();
    ch.hl?.forEach(t => this.app.reveal(t));
    this.el.innerHTML = `
      <div class="ch">TOUR · ${i + 1} / ${CHAPTERS.length}${ch.part ? " · " + ch.part : ""}</div>
      <h3>${ch.title}</h3>
      <p>${ch.body}</p>
      <div class="watch">▸ ${ch.watch}</div>
      <div class="nav"></div>`;
    const nav = this.el.querySelector(".nav")!;
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", fn);
      nav.append(b);
    };
    if (i > 0) mk("◂ back", () => this.goto(i - 1));
    mk(i < CHAPTERS.length - 1 ? "next ▸" : "finish", () => this.goto(i + 1));
    mk("close", () => this.close());
    this.el.classList.add("show");
    this.btn.classList.add("hide");
  }
  close() {
    this.app.clearReveals();
    this.el.classList.remove("show");
    this.btn.classList.remove("hide");
  }
}
