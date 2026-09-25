// 3D analysis instruments: the STEREOLOGY panel (2D section metallography vs
// the true 3D grain sizes — the classic Saltykov lesson, and the OptiGrain
// tie-in) and the two texture panels. The first projects every grain's crystal
// [001] axis into the SAMPLE frame (stereographic, sample z at the center,
// dot diameter ∝ the grain's equivalent-sphere diameter): that is a [001]
// pole figure. It was titled "IPF" until
// v8 U1b, but an inverse pole figure plots the SAMPLE axis in the CRYSTAL frame
// (the standard triangle), which this does not do. The second plots every
// symmetry axis family (⟨100⟩, (0001) or the 5-fold axes). Zero extra GPU work
// for either: they read the CPU quaternion mirror + the last stats census.
//
// Every plot here is a figure of the plot core (src/plot, U2), the 2D
// column's twins: axes and titles in the melt's units, DPR-correct canvases
// (they were drawn at one backing pixel per CSS pixel), a hover readout, and a
// click or the ⤢ opens each one large with its data table and exports (only
// the [001] pole figure could be enlarged before). The Scheil series is
// capped like every other (it grew without bound for the whole session).

import type { Sim3D, StatsResult3D } from "./sim3d";
import type { SlicePlane } from "./render3d";
import type { Units } from "./units";
import { DEFAULT_UM_PER_CELL } from "./units";
import { LearnLayer, learnSlot, fillLearnSlots, onLearnChange } from "./learn";
import { STATUS_LEARN, panelText } from "./learn/panels";
import { kv, kvFull, num, quiet } from "./design/panel";
import { bridgeOf, type Bridge } from "./plot/quantity";
import type { Chem, Figure } from "./plot/figures";
import {
  ProbeRecord, ScheilRecord, probeSample, scheilSample, probeFigure, scheilFigure, poleFigure, poleFamily,
} from "./plot/analysis";
import { PlotView } from "./plot/view";
import { openFigure, type FigureHandle } from "./plot/modal";
import type { Prov } from "./plot/csv";
import type { PlotMeta } from "./hud";

/** the [001] pole-figure panel's title, also its enlarged view's */
const POLE001_TITLE = "TEXTURE · POLE FIGURE [001]";

export interface An3Host {
  sim3d(): Sim3D | null;
  plane(): SlicePlane | null;
  lastStats(): StatsResult3D | null;
  /** the live unit bridge (main.ts unitsNow) */
  units(): Units;
  /** the melt, the seed and the grid, for a figure's provenance */
  meta(): PlotMeta;
  /** the chemistry the volume's solver runs now (main.ts chemNow: its
   *  alloyActive, not the bare request), latched with each series */
  chem(): Chem;
}

// resolution comes from the solver now (units.ts owns the anchor) — this used
// to be a hardcoded 1 mm / 1024 that disagreed with the 2D side at every grid
// size but the default
const umPerVox = (sim: Sim3D | null) => sim?.umPerCell ?? DEFAULT_UM_PER_CELL;

type Which3 = "probe" | "scheil" | "ipf" | "pole";
/** each plot's size in the column, CSS px (the 2D column's width) */
const SIZE3: Record<Which3, [number, number]> = { probe: [252, 168], scheil: [252, 168], ipf: [252, 236], pole: [252, 236] };

export class Analyze3D {
  stereoOn = false;
  ipfOn = false;
  probeOn = false;
  scheilOn = false;
  poleOn = false;
  private stereoPanel: HTMLElement;
  private ipfPanel: HTMLElement;
  private probePanel: HTMLElement;
  private scheilPanel: HTMLElement;
  private polePanel: HTMLElement;
  private stereoBody: HTMLElement;
  private views = {} as Record<Which3, PlotView>;
  /** the enlarged figure, when one is open */
  private modal: { which: Which3; h: FigureHandle } | null = null;
  private stereoClock = 0;
  private lastStereo: { sections: { id: number; areaVox: number }[]; poreVox: number } | null = null;
  /** the series, each with the unit bridge it started under, 900 samples
   *  at most (plot/figures.ts TimedRecord) */
  private curve = new ProbeRecord();
  private scheil = new ScheilRecord();

  /** learn mode's "i" on each panel's title bar; one explanation open at a
   *  time, so the column cannot climb under the top bar */
  private learn = new LearnLayer(() => this.learn.apply(), true);
  /** the second texture panel's title: its axis family follows the symmetry */
  private poleTitle!: HTMLElement;

  constructor(private host: An3Host) {
    const root = document.getElementById("apanels3")!;
    const mk = (title: string, learnKey: string, which: Which3 | null) => {
      const p = document.createElement("div");
      p.className = "apanel";
      const t = document.createElement("div");
      t.className = "t";
      const name = document.createElement("span");
      name.textContent = title;
      t.append(name);
      let z: HTMLButtonElement | null = null;
      if (which) {
        z = document.createElement("button");
        z.type = "button";
        z.className = "zoomBtn iconbtn";
        z.textContent = "⤢";
        z.title = "enlarge";
        z.setAttribute("aria-label", `enlarge ${title.toLowerCase()}`);
        z.addEventListener("click", () => this.openBig(which));
        t.append(z);
      }
      // the "i" right after the title; its text no wider than the plot
      const ex = this.learn.explain(t, `about ${title.toLowerCase()}`, panelText(learnKey), z);
      ex.body.style.maxWidth = "252px";
      p.append(t, ex.body);
      if (which) {
        // the figure: a wrapper at the plot's size holding the canvas and
        // its hover overlay (plot/view.ts), a button that opens it large
        const holder = document.createElement("div");
        holder.className = "aplot";
        holder.style.width = `${SIZE3[which][0]}px`;
        holder.style.height = `${SIZE3[which][1]}px`;
        p.append(holder);
        this.views[which] = new PlotView(holder, { label: `${title.toLowerCase()}: open the full figure`, onOpen: () => this.openBig(which) });
      }
      root.append(p);
      return p;
    };
    this.probePanel = mk("COOLING CURVE · PROBE (3D)", "COOLING CURVE · PROBE", "probe");
    this.scheilPanel = mk("SCHEIL fs–T · PREDICTED vs MEASURED", "SCHEIL", "scheil");
    this.stereoPanel = mk("STEREOLOGY · SECTION vs TRUE 3D", "STEREOLOGY", null);
    this.stereoBody = document.createElement("div");
    this.stereoBody.className = "stereo";
    this.stereoPanel.append(this.stereoBody);
    this.ipfPanel = mk(POLE001_TITLE, "POLE FIGURE [001]", "ipf");
    this.polePanel = mk("TEXTURE · POLE FIGURE ⟨100⟩", "POLE FIGURE", "pole");
    this.poleTitle = this.polePanel.querySelector(".t span") as HTMLElement;
    onLearnChange(() => { this.learn.apply(); fillLearnSlots(this.stereoBody); });
    this.learn.apply();
  }

  /** the gesture hint shares the column's band: it steps out while the
   *  column shows a panel (app/index.html .cols3d) */
  private cols() {
    document.body.classList.toggle("cols3d", this.stereoOn || this.ipfOn || this.probeOn || this.scheilOn || this.poleOn);
  }
  setStereoOn(b: boolean) { this.stereoOn = b; this.stereoPanel.style.display = b ? "block" : "none"; this.cols(); }
  setIpfOn(b: boolean) { this.ipfOn = b; this.ipfPanel.style.display = b ? "block" : "none"; this.cols(); }
  setProbeOn(b: boolean) {
    this.probeOn = b;
    this.probePanel.style.display = b ? "block" : "none";
    this.cols();
    if (b) {
      // give the probe a home if it never had one
      const s3 = this.host.sim3d();
      if (s3 && !s3.probe) s3.probe = { x: s3.n / 2, y: s3.n / 2, z: s3.n / 2 };
    }
    this.curve.clear();
  }
  setScheilOn(b: boolean) { this.scheilOn = b; this.scheilPanel.style.display = b ? "block" : "none"; if (b) this.scheil.clear(); this.cols(); }
  setPoleOn(b: boolean) { this.poleOn = b; this.polePanel.style.display = b ? "block" : "none"; this.cols(); }
  /** melt reset / probe move: start fresh series */
  reset() { this.curve.clear(); this.scheil.clear(); this.lastStereo = null; }

  // ---- SDAS ruler on the section (drag pre-empts the orbit while armed)
  ruler3On = false;
  private rulerA: [number, number, number] | null = null;
  setRuler3On(b: boolean) { this.ruler3On = b; if (!b) this.rulerA = null; }
  beginRuler3(p: [number, number, number]) { this.rulerA = p; }
  /** intercept count + λ₂, verbatim port of the 2D hysteresis walk */
  async endRuler3(p: [number, number, number]): Promise<string> {
    const a = this.rulerA;
    this.rulerA = null;
    const s3 = this.host.sim3d();
    if (!a || !s3) return "";
    const phi = await s3.readLine3D(a, p);
    if (!phi) return "measuring…";
    let arms = 0;
    let inSolid = phi[0] > 0.6;
    for (let i = 1; i < phi.length; i++) {
      if (!inSolid && phi[i] > 0.6) { inSolid = true; arms++; }
      else if (inSolid && phi[i] < 0.4) inSolid = false;
    }
    if (arms === 0 && inSolid) arms = 1;
    const lenUm = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) * umPerVox(s3);
    return arms >= 2
      ? `λ₂ ≈ ${(lenUm / arms).toFixed(1)} µm · ${arms} arms / ${lenUm.toFixed(0)} µm`
      : `${arms} intercept${arms === 1 ? "" : "s"} · need ≥ 2 arms`;
  }

  /** the units in force now, latched by a series when it starts */
  private bridgeNow(): Bridge { return bridgeOf(this.host.units(), this.host.meta().material); }

  /** stats arrived (~4 Hz) — collect the instrument series, kept only while
   *  sim time advances and capped (plot/figures.ts TimedRecord) */
  onStats3(s: StatsResult3D, simTime: number) {
    const b = this.bridgeNow(), chem = this.host.chem();
    const pr = this.probeOn ? probeSample(simTime, s.probeT, s.probePhi) : null;
    if (pr) this.curve.push(pr, b, chem);
    if (this.scheilOn) {
      // presence is the reduction's own count of interface cells (a mean
      // interface temperature at or under T̃ = 0 is a real one, and was
      // dropped as "no interface" when presence was inferred from it)
      const q = scheilSample(simTime, s.fracSolid, s.interfaceT, s.interfaceCells > 0);
      if (q) this.scheil.push(q, b, chem);
    }
  }

  /** what a figure's provenance names, plus what this panel adds */
  private prov(recorded: number | undefined, extra: string[] = []): Prov {
    return { ...this.host.meta(), recorded, extra };
  }

  /** a panel's figure (plot/analysis.ts) */
  figure(which: Which3): Figure {
    const s3 = this.host.sim3d();
    const st = this.host.lastStats();
    const p = s3?.params;
    // the chemistry each series started under (the host's reads the solute
    // field the solver is RUNNING, alloyActive: alloyOn alone is a request,
    // and a Scheil path against a pure solve is not a comparison)
    if (which === "probe") {
      const pr = s3?.probe;
      return probeFigure({
        samples: this.curve.samples, bridge: this.curve.bridge ?? this.bridgeNow(),
        chem: this.curve.chem ?? this.host.chem(), three: true,
        prov: this.prov(this.curve.recorded, pr ? [`probe at voxel (${Math.round(pr.x)}, ${Math.round(pr.y)}, ${Math.round(pr.z)})`] : []),
      });
    }
    if (which === "scheil") {
      return scheilFigure({
        samples: this.scheil.samples, bridge: this.scheil.bridge ?? this.bridgeNow(),
        chem: this.scheil.chem ?? this.host.chem(), three: true, prov: this.prov(this.scheil.recorded),
      });
    }
    const fam = which === "ipf" ? { family: "[001]", axes: [[0, 0, 1]] as [number, number, number][] } : poleFamily(p?.aniMode3 ?? 1);
    return poleFigure({
      grains: s3 && st ? st.grains : [], quats: s3?.quats ?? [], axes: fam.axes, family: fam.family,
      umPerVox: umPerVox(s3), bridge: this.bridgeNow(), prov: this.prov(undefined),
    });
  }

  /** the enlarged figure (plot/modal.ts): large, with its data table and
   *  exports; live, it follows the casting */
  private openBig(which: Which3) {
    this.modal?.h.close();
    const h = openFigure(() => this.figure(which), () => { if (this.modal?.h === h) this.modal = null; });
    this.modal = { which, h };
  }

  /** called from the 3D stats cadence (~4 Hz) */
  tick(dt: number) {
    if (this.ipfOn) this.views.ipf.set(this.figure("ipf").fig);
    if (this.poleOn) { this.poleTitleSync(); this.views.pole.set(this.figure("pole").fig); }
    if (this.probeOn) this.views.probe.set(this.figure("probe").fig);
    if (this.scheilOn) this.views.scheil.set(this.figure("scheil").fig);
    this.modal?.h.update();
    if (!this.stereoOn) return;
    this.stereoClock += dt;
    if (this.stereoClock < 1) { this.drawStereo(); return; }
    this.stereoClock = 0;
    const s3 = this.host.sim3d();
    const pl = this.host.plane();
    if (!s3 || !pl) return;
    void s3.readStereo(pl).then(r => { if (r) { this.lastStereo = r; this.drawStereo(); } });
  }

  /** the second texture panel's title names the axis family actually
   *  plotted (cubic ⟨100⟩, hexagonal (0001), icosahedral 5-fold) */
  private poleTitleSync() {
    const mode = this.host.sim3d()?.params.aniMode3 ?? 1;
    const fam = mode === 2 ? "(0001)" : mode === 3 ? "5-FOLD" : "⟨100⟩";
    const title = `TEXTURE · POLE FIGURE ${fam}`;
    if (this.poleTitle.textContent !== title) {
      this.poleTitle.textContent = title;
      // the "i" is named after its panel, so a screen reader hears the title
      // that is on screen, not the ⟨100⟩ it was built with
      this.polePanel.querySelector(".lrnInfo")?.setAttribute("aria-label", `about ${title.toLowerCase()}`);
      this.polePanel.querySelector(".zoomBtn")?.setAttribute("aria-label", `enlarge ${title.toLowerCase()}`);
      // and the plot itself, a button too: it was named ⟨100⟩ for good
      this.views.pole.root.setAttribute("aria-label", `${title.toLowerCase()}: open the full figure`);
    }
  }

  private drawStereo() {
    const st = this.host.lastStats();
    const sec = this.lastStereo;
    if (!sec) { this.stereoBody.innerHTML = `<span class="q">measuring the section…</span>`; return; }
    const n2 = sec.sections.length;
    const meanA = n2 ? sec.sections.reduce((a, s) => a + s.areaVox, 0) / n2 : 0;
    const uv = umPerVox(this.host.sim3d());
    const d2 = meanA > 0 ? Math.sqrt((4 * meanA) / Math.PI) * uv : 0;
    const meanAmm = meanA * (uv / 1000) ** 2;
    const g2 = n2 >= 3 && meanAmm > 0 ? 3.322 * Math.log10(1 / meanAmm) - 2.954 : null;
    const d3 = st?.eqDiamUm ?? 0;
    const ratio = d3 > 0 && d2 > 0 ? d2 / d3 : null;
    // d̄₂ is the circle of the MEAN section area, so the equal-sphere reference
    // is √(2/3) ≈ 0.82 (mean area of a random section = 2/3 of the great
    // circle's). π/4, printed here before v8 U1b, is the mean section DIAMETER
    // ratio, a different statistic this panel does not compute.
    // a spec rail: the section's statistic, the volume's, and their ratio.
    // Units (U2): the diameters in µm (the section's circle-equivalent d̄₂,
    // the volume's sphere-equivalent d̄₃), ASTM G is the E112 grain-size
    // number (dimensionless) from the mean section area, the ratio is
    // dimensionless, and the pores cut by the plane are an AREA on it (they
    // printed as a voxel count)
    const poreUm2 = sec.poreVox * uv * uv;
    this.stereoBody.innerHTML = `<div class="kv">` +
      kv("section", `${num(n2)} grains · d̄₂ ${num(`${d2.toFixed(0)} µm`)}`
        + (g2 != null ? ` · ASTM ${num(`G ${g2.toFixed(1)}`)}` : "")) +
      kv("3D", `${num(st?.grainCount ?? "—")} grains · d̄₃ ${num(d3 ? d3.toFixed(0) + " µm" : "—")}`) +
      (ratio != null
        ? kv("d̄₂/d̄₃", `${num(ratio.toFixed(2))} ${quiet("(equal spheres ≈ 0.82)")}`, learnSlot(STATUS_LEARN.stereology))
        : kvFull(quiet("no grains yet"))) +
      (sec.poreVox > 0 ? kv("pores on section", `${num(`${poreUm2 >= 100 ? poreUm2.toFixed(0) : poreUm2.toPrecision(2)} µm²`)} ${quiet(`(${sec.poreVox} cells)`)}`) : "") +
      `</div>`;
    fillLearnSlots(this.stereoBody);
  }
}
