// Guided tour: each chapter configures the instrument and narrates one idea.

export interface AppControl {
  clearMelt(undercool: number): void;
  seedCenter(): void;
  chillWall(): void;
  setParams(p: Partial<{ delta: number; aniMode: number; noiseAmp: number; latent: number; coolRate: number }>): void;
  setRain(perSec: number): void;
  setView(v: number): void;
  setSpeed(substeps: number): void;
  startOptimizer(): void;
  syncUI(): void;
}

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
      a.setParams({ delta: 0.008, aniMode: 4, noiseAmp: 0.022, latent: 1.7, coolRate: 0 });
      a.setRain(0);
      a.clearMelt(0.72);
      a.chillWall();
      a.setView(3);
      a.setSpeed(18);
    },
  },
  {
    title: "Why arms?",
    body: "Crystals are not round because surface energy depends on direction. A cubic metal grows fastest along four preferred directions, so a free crystal sharpens into a four-armed dendrite — the same physics that shapes every cast metal part.",
    watch: "Four arms lock onto the crystal axes; the glowing halo is latent heat escaping.",
    apply(a) {
      a.setParams({ delta: 0.05, aniMode: 4, noiseAmp: 0.006, latent: 1.6, coolRate: 0 });
      a.setRain(0);
      a.clearMelt(1.0);
      a.seedCenter();
      a.setView(0);
      a.setSpeed(16);
    },
  },
  {
    title: "Snow",
    body: "Change the symmetry of that surface energy from four-fold to six-fold and the same equations grow a snowflake. Ice is hexagonal; that single fact is why no snowflake has four arms.",
    watch: "Side branches appear where random noise disturbs the growing tip.",
    apply(a) {
      a.setParams({ delta: 0.04, aniMode: 6, noiseAmp: 0.014, latent: 1.8, coolRate: 0 });
      a.setRain(0);
      a.clearMelt(0.92);
      a.seedCenter();
      a.setView(0);
      a.setSpeed(16);
    },
  },
  {
    title: "Many grains",
    body: "Real melts nucleate everywhere at once. Each nucleus is a crystal with its own random orientation; where they collide, growth stops and a grain boundary is frozen in. This is why metal is made of grains.",
    watch: "Each colour is one crystal orientation. When the last liquid vanishes, switch to ETCH — that is a micrograph.",
    apply(a) {
      a.setParams({ delta: 0.045, aniMode: 4, noiseAmp: 0.012, latent: 1.5, coolRate: 0.12 });
      a.clearMelt(0.85);
      a.setRain(14);
      a.setView(1);
      a.setSpeed(22);
    },
  },
  {
    title: "The casting",
    body: "Pour metal against a cold mould wall and columnar grains race inward, feeding on the heat gradient. Ahead of them the remaining melt undercools until new equiaxed grains nucleate and block the columns — the columnar-to-equiaxed transition every foundry fights over.",
    watch: "Long columns from the wall, then a sudden switch to round grains mid-domain.",
    apply(a) {
      a.setParams({ delta: 0.045, aniMode: 4, noiseAmp: 0.014, latent: 1.85, coolRate: 0.28 });
      a.clearMelt(0.62);
      a.chillWall();
      a.setRain(3);
      a.setView(1);
      a.setSpeed(26);
    },
  },
  {
    title: "Engineer it",
    body: "Grain size sets strength — finer is stronger (Hall–Petch). A process engineer tunes cooling and inoculation to hit a target grain size. Here, an optimizer does that job: it runs castings, measures the ASTM grain number, and learns the schedule.",
    watch: "Each thumbnail is one casting the optimizer tried. Watch it converge on the target.",
    apply(a) {
      a.startOptimizer();
    },
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
