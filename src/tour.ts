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
  apply(app: AppControl): void;
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
    body: "Grain size sets strength — finer is stronger (Hall–Petch). A process engineer tunes cooling and inoculation to hit a target grain size. Here, an optimizer does that job: it runs castings, measures the ASTM grain number, and learns the schedule.",
    watch: "Each thumbnail is one casting the optimizer tried. Watch it converge — or fight it yourself with CHALLENGE in the controls.",
    apply(a) { a.startOptimizer(); },
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
    ch.apply(this.app);
    this.app.syncUI();
    this.el.innerHTML = `
      <div class="ch">TOUR · ${i + 1} / ${CHAPTERS.length}</div>
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
    this.el.classList.remove("show");
    this.btn.classList.remove("hide");
  }
}
