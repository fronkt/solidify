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
  syncUI(): void;
  /** tour part II: "sec:TITLE" opens+highlights a rail section, else a CSS selector */
  reveal(target: string): void;
  clearReveals(): void;
}

// What the tour itself needs beyond AppControl (declared locally — importing
// UIHost from ui.ts would create a module cycle). main's `app` satisfies both.
export interface TourHost extends AppControl {
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
    body: "A flat solidification front in an undercooled melt cannot stay flat. Any bump reaches deeper into cold liquid, rejects its latent heat faster, and grows faster still — the Mullins–Sekerka instability.",
    watch: "Watch the flat front from the wall break into fingers on its own.",
    apply(a) {
      a.setParams({ scen: 0, delta: 0.008, aniMode: 4, noiseAmp: 0.022, latent: 1.7, coolRate: 0, alloyOn: 0, heatIn: 0 });
      a.setInoculant(0); a.setWeldAuto(false);
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
    title: "Forbidden symmetry",
    body: "A periodic lattice can only repeat with 2-, 3-, 4- or 6-fold rotational symmetry — the crystallographic restriction theorem. So when Dan Shechtman measured a sharp 10-fold diffraction pattern in 1982, his lab asked him to leave. He had found quasicrystals: ordered, never repeating. It took the field years to believe him and won the 2011 Nobel Prize.",
    watch: "Five arms — the symmetry no ordinary crystal is allowed to have. Honesty note: we give the interface energy 5-fold symmetry; the aperiodic lattice itself is beyond this model. Try ×10 in CRYSTAL for the decagonal look, or the Al–Co–Ni quasicrystal in MATERIAL.",
    apply: SCENES.quasi,
  },
  {
    title: "The twin",
    body: "Sometimes a growing crystal makes a perfect mistake: a second lattice forms on it in mirror registry — a twin. Aluminum castings grow whole feathery grains this way, and two ice crystals locked at 30° grow the rarest snowflake of all: twelve branches.",
    watch: "One seed, two orientations. Count the arms — twelve. The two twin domains show as two colours split by a faint boundary; real twin boundaries etch faint too. Raise TWIN RATE in CRYSTAL to let twins fire mid-growth.",
    apply(a) {
      a.setParams({ scen: 0, heatIn: 0, delta: 0.042, aniMode: 6, noiseAmp: 0.012, latent: 1.8, coolRate: 0, alloyOn: 0, twinProb: 0 });
      a.setInoculant(0); a.setWeldAuto(false);
      a.clearMelt(0.92); a.twinSeedCenter();
      a.setView(1); a.setSpeed(16); a.setRun(true);
    },
  },
  {
    title: "Many grains",
    body: "Real melts nucleate everywhere at once. Each nucleus is a crystal with its own random orientation; where they collide, growth stops and a grain boundary is frozen in. This is why metal is made of grains. What you set is the INOCULANT — how many potential nuclei the melt carries. How many of them actually fire is decided by how deeply the melt undercools, which is why there is no nucleation-rate slider anywhere in this instrument.",
    watch: "Each colour is one crystal orientation. Watch the SITES readout: it climbs while the melt is still getting colder, then stops dead once the latent heat of the growing grains warms it back up. Nucleation shuts itself off. Now raise the COOLING RATE and re-pour — the melt gets deeper before that happens, more of the same inoculant fires, and the casting comes out finer.",
    apply: SCENES.rain,
    hl: ["sec:MELT · PROCESS"],
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
    watch: "Once running it replays dozens of fast castings back to back. Early ones nucleate heavily and look like a chaotic blizzard of grains — that is the optimizer exploring, not a glitch. Its genes are the inoculant charge and a three-stage cooling schedule, and those are coupled: the schedule decides how much of the charge ever fires, so it cannot tune one without disturbing the other. Watch |ΔG| shrink as it converges; drag the target toward G 1 and the grains thin out, toward G 5 and they multiply. Or fight it yourself with CHALLENGE.",
    apply(a) { a.startOptimizer(); },
  },
  {
    title: "Run it like a lab",
    body: "Everything so far has been a sandbox: you drag a slider and the melt answers. That is a fine way to learn the terms and a poor model of how the measurement is made. LAB MODE inverts it. You specify the experiment first — the charge and its inoculant, the atmosphere, the pour superheat, the mould temperature, and a cooling programme — then you pour it and you get what you get.",
    watch: "Pick a programme and press POUR AND RUN. The melt is poured above its liquidus, so nothing can freeze until the programme takes it down. When the casting is solid you get a report card: the cooling curve with the recalescence arrest marked, the deepest undercooling reached, and how much of the inoculant the run actually used. Touch a physics dial while it is pouring and the card will say so.",
    apply(a) { a.startLab(); },
    hl: ["sec:MODES"],
  },

  // ---- part II: a control-by-control walk through the instrument ----------
  {
    part: "THE INSTRUMENT",
    title: "Part II: the instrument",
    body: "The rest of the tour walks every control on the instrument, dropdown by dropdown. Nothing in part II touches your melt — whatever you have growing keeps growing. Close anytime.",
    watch: "The transport (bottom left): RESET arms a fresh melt so you can stage seeds while paused, RUN/PAUSE is the space bar, ×1 cycles to ×2 and ×4 to fast-forward (crank the speed slider first, then stack the multiplier), and ⏺ REC saves a .webm clip of the canvas.",
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
    body: "The foundry dials: UNDERCOOLING is how cold the melt starts, COOLING RATE keeps pulling heat out, and INOCULANT is how many potential nuclei the charge carries — a site population with a spread of activation undercoolings, set in ADVANCED. There is deliberately no nucleation-rate control: the rate is what those three produce between them.",
    watch: "The buttons: SEED and TWIN SEED drop nuclei, CHILL WALL lines an edge, QUENCH plunges the whole melt colder, and holding REHEAT pours heat back in and melts solid back to liquid — it is a brush, not a heat treatment.",
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
    watch: "Pour A356 + TiB against Al–1Zn on the same charge and cooling and the structures really do differ — though not only through growth restriction: an alloy's liquidus is depressed, which changes how far its melt undercools before its inoculant fires. The science page works through what that did to an older result. Compositions are shareable as #alloy links.",
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
    title: "Calibrate it",
    body: "SCALE holds the map from the solver's dimensionless numbers to real SI, with a provenance badge on every factor — and a switch. Turn on the calibrated solver and the interface width and relaxation time stop being dials: they are derived from this material's own capillary length and diffusivity, which is what turns tip radius and arm spacing from shapes into predictions. Seven sliders grey out because they are no longer choices.",
    watch: "The one control left is λ, and it is a convergence knob: it sets how many capillary lengths wide the interface is, and the answer has to not depend on it. The app prints W₀/d₀ beside it so you can check.",
    hl: ["sec:SCALE"],
  },
  {
    part: "THE INSTRUMENT",
    title: "Your hands",
    body: "On the canvas itself: tap to nucleate a crystal, shift-tap for a twinned pair, scroll or pinch to zoom, right-drag (or two fingers) to pan, and ctrl-tap to move the cooling probe.",
    watch: "That is the whole instrument. Go freeze something.",
    hl: [],
  },

  // ---- part III: the same physics with its missing dimension restored ------
  {
    part: "THE THIRD DIMENSION",
    dim: "3d",
    title: "Part III: out of the plane",
    body: "Everything so far was a 2D section of a 3D event. A real cubic dendrite grows six primary arms — one pair per crystal axis — and a real grain is a polyhedron you can only understand by walking around it. This flips the instrument into TRUE 3D: seven million voxels solving the same phase-field equations, drawn by marching rays through the volume.",
    watch: "One seed, six arms, locked to ⟨100⟩. The glow is the same latent heat as chapter two — now escaping in three dimensions, which is exactly why 3D tips grow sharper than 2D theory predicts.",
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
    body: "The camera is an instrument now. Drag to orbit, wheel to dolly, right-drag to pan. Or use the cube, exactly as in a CAD package: faces snap to engineering views, edges and corners to isometrics, and dragging the cube spins the crystal in your hand.",
    watch: "Hover the ViewCube — faces, edges and corners all light up. Tap the melt to nucleate at depth; shift-tap drops a Σ3 twin pair, two crystals locked at 60° about a shared ⟨111⟩ axis.",
    hl: ["#viewcube"],
  },
  {
    part: "THE THIRD DIMENSION",
    dim: "3d",
    title: "Section it",
    body: "A metallurgist cannot see inside an opaque solid either. The lab answer is serial sectioning: grind, polish, image, repeat, and rebuild the volume from slices. The SLICE lens is that section plane — free to move, tilt and turn — and CT SWEEP drives it through the volume like a tomography scan. The cut face renders as etched metal or as an EBSD orientation map.",
    watch: "The plane is sweeping a many-grain casting on the EBSD style. Open STEREOLOGY in VOLUME · 3D: the grain size measured on the section runs smaller than the true 3D size, because a random plane almost never cuts a grain through its equator. Sections lie small — that correction is a century of stereology.",
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
    body: "Now the defect that makes inspection an industry. A casting freezes from the walls inward; liquid pockets that lose their feed path to the riser shrink into voids as they solidify — shrinkage porosity. The FIELD lens is the x-ray radiograph NDT uses to find it: pores read as dark specks in the transmission image. The section plane's Niyama style maps |∇T|/√Ṫ, the foundry criterion that flags starved regions before they turn into pores.",
    watch: "A chill floor, nucleation rain, and hard cooling — a real casting recipe. Watch POROSITY % climb in the HUD as unfed pockets freeze. Then open the SECTION PLANE and switch the cut style to the Niyama map: the risk lights up ahead of the defects.",
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
    body: "Everything you grow is yours to keep. STL meshes the crystal into a watertight, printable surface straight from the φ field — closed pore shells included. 360° records a six-second orbit to webm while the physics keeps running. And the share link carries the entire setup, section plane and all, to anyone with a browser.",
    watch: "The whole instrument lives here now: every preset, Bridgman growth, the surface weld, the alloy field and composer, growth twins, facets, the icosahedral quasicrystal — and the SELECTOR preset, which races sixty grains through a helical channel until a single crystal survives, the way real turbine blades are made. Go fill the volume.",
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
    if (!blocked) {
      ch.apply?.(this.app);
      this.app.syncUI();
      ch.hl?.forEach(t => this.app.reveal(t));
    } else this.app.syncUI();
    const body = blocked
      ? "The volume mode isn't available right now — it needs an idle instrument (no optimizer or challenge running) and a WebGPU device with room for the 3D field. The story anyway: " + ch.body
      : ch.body;
    const watch = blocked ? "Part III is best experienced live — try a desktop with WebGPU." : ch.watch;
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
    this.el.classList.remove("show");
    this.btn.classList.remove("hide");
  }
}
