import { BASES, FAMOUS, derive, encodeMix, decodeMix, soluteBound, type Mix, type Derived } from "./alloy";
import { PhaseFigureView } from "./phasediagram";
import { ELEMENTS, admit, probeWt, tablePos, type AdmitTier } from "./elements";

// The alloy composer: pick a base metal, add solutes in wt% (live at%
// conversion), read the real dilute-limit chemistry (liquidus shift, growth
// restriction Q), and pour it — the mix collapses onto the model's
// pseudo-binary solute field and arms a fresh melt.

/**
 * Refusal strings quote the offending key back at the user, and a mix can
 * reach `derive()` from `window.__solidify.alloy` or from a hand-built
 * `#alloy=` hash with keys this module never chose. Escaping is therefore not
 * paranoia: it is the difference between naming a bad input and executing it.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A fraction as a percentage that never rounds a real quantity to nothing.
 * `toFixed(0)` prints "0 %" for anything under half a percent, and the lever
 * rule is exactly 0 at the solubility limit and small-but-nonzero just past it,
 * so a slider one notch above C_SM read "0 % / 10 %" — a zero that means
 * "less than half a percent" sitting beside a zero that means zero.
 */
function pct(x: number): string {
  if (x === 0) return "0 %";
  if (x < 0.005) return "<1 %";
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;
}

/**
 * The weight a solute arrives at when it is added by a click — from the quick
 * list or from the grid, and it has to be ONE expression rather than two.
 *
 * v7.1 P3 fixed this once already, in the "+ add element" handler: seeding Ti
 * at a flat 0.5 wt% put the mix more than three times past the 0.15 wt% Al–Ti peritectic,
 * so a single click produced a named refusal instead of an alloy. P5 adds a
 * second way to click the same solute in, and a second copy of that expression
 * is a second chance to reintroduce the same bug on the next edit.
 *
 * It is deliberately NOT `probeWt`. They answer different questions: this one
 * is "what should the slider start at", the ceiling-aware default a user then
 * moves; `probeWt` is "at what composition should the grid ASK about this
 * pair", which is half the ceiling so that a pair is never coloured by a
 * composition the instrument would refuse. For Fe–C they are 0.52 and 0.265.
 */
export function defaultWt(baseKey: string, el: string): number {
  const b = soluteBound(baseKey, el);
  return Math.min(1, b ? b.max : BASES[baseKey].solutes[el].cap);
}

/**
 * The four tiers in the order the legend prints them, brightest first.
 *
 * REFUSED-PAIR IS LABELLED "refused" AND NOT "nothing entered", which is what
 * the first draft called it and what is false for six of its members. That tier
 * holds four reasons, and IS-THE-BASE is one of them: iron in an iron melt is
 * not an absence of data, it is not a composition. A label naming a mechanism
 * the tier does not share is the same defect this file's refusals are written
 * to avoid, one layer up in the UI. "Refused" is true of all four; the line
 * underneath supplies the mechanism, which is its whole job.
 */
const TIER_LABEL: Record<AdmitTier, string> = {
  "ASSESSED": "assessed — pourable",
  "OUTSIDE-THE-MODEL": "outside this solver",
  "REFUSED-PAIR": "refused",
  "NOT-A-SOLUTE": "not a solute here",
};

export interface ComposerHost {
  /**
   * `poured` is the fourth argument v7.1 P1 added, and it is the milestone in
   * one line: before it, the host learned a params bundle and a name and had
   * no way back to the chemistry, so the calibrated thermometer went on
   * measuring in the base material's default freezing range no matter what was
   * poured into it. The mix travels so the host can re-enter the calibration
   * with the alloy's own numbers, and the caveats travel so the clamps and
   * refusals can be rendered OUTSIDE this modal, where a deep link can see them.
   */
  applyAlloy(materialKey: string, params: Record<string, number>, name: string,
    poured: { mix: Mix; derived: Derived; caveats: string[] }): void;
  /** a deep link that could not be applied at all, and why — no pour follows */
  reportLinkRefusals(refusals: string[]): void;
  /**
   * The melt's current temperature in °C, or null when there is no liquid left
   * and null when the material has no SI identity. Two different nulls on
   * purpose: `sim.ts` returns `meanLiqT: null` once the casting is fully solid
   * (never 0, and the app's own readouts guard on `!= null` for exactly that
   * reason), while an abstract material has no thermometer at all. The figure
   * draws no cursor for either and says which.
   */
  meltC(): number | null;
  /** which material is actually in the crucible, for the cursor's own honesty check */
  materialKey(): string;
}

export class Composer {
  private overlay: HTMLElement;
  private rowsEl!: HTMLElement;
  private outEl!: HTMLElement;
  private addSel!: HTMLSelectElement;
  private baseBtns: HTMLButtonElement[] = [];
  private mix: Mix = { base: "al", wt: { Cu: 4.4, Mg: 1.5 } };
  /**
   * Refusals raised OUTSIDE `derive()` — by the hash decoder and by this
   * modal's own render — which `derive()` therefore cannot know about. They
   * survive until the mix next changes, because a link that quietly lost a
   * solute must still be saying so when the melt it produced is on screen.
   */
  private extraRefusals: string[] = [];
  /**
   * The drawn diagram. It lives in its OWN container, appended once, because
   * `renderOut()` replaces `.derived`'s innerHTML on every slider frame and
   * would otherwise destroy and rebuild the whole SVG sixty times a second.
   */
  private figure = new PhaseFigureView();
  private open_ = false;
  private tickKey = "";
  /**
   * The 118 grid cells, built ONCE in the constructor and thereafter only
   * repainted. Switching the base rewrites four attributes per cell and no
   * markup at all — 118 attribute writes against 118 element creations plus a
   * layout, and more importantly the click handler is bound once and cannot go
   * stale under a rebuild.
   */
  private cells: HTMLButtonElement[] = [];
  private whyEl!: HTMLElement;
  /** which cell the reason panel is currently answering about; null before the first tap */
  private picked: string | null = null;

  constructor(private host: ComposerHost) {
    this.overlay = document.createElement("div");
    this.overlay.id = "composer";
    this.overlay.innerHTML = `
      <div class="card">
        <div class="chead"><h3>ALLOY COMPOSER</h3><button class="x">✕</button></div>
        <div class="cnote">approximate textbook dilute-limit coefficients; the mix collapses
        onto the model's pseudo-binary solute field (labelled honestly below)</div>
        <div class="bases"></div>
        <div class="rows"></div>
        <div class="addrow"><select></select><button class="add">+ add element</button></div>
        <div class="gridwrap">
          <div class="gcap">every element, against this melt</div>
          <div class="gscroll"><div class="grid"></div></div>
          <div class="glegend"></div>
          <div class="gwhy"></div>
        </div>
        <div class="famous"></div>
        <div class="derived"></div>
        <div class="figwrap"></div>
        <div class="cfoot"><button class="pour">⚗ pour this alloy</button><button class="cancel">cancel</button></div>
      </div>`;
    document.body.append(this.overlay);

    this.overlay.querySelector(".figwrap")!.append(this.figure.root);
    this.rowsEl = this.overlay.querySelector(".rows")!;
    this.outEl = this.overlay.querySelector(".derived")!;
    this.addSel = this.overlay.querySelector(".addrow select")!;

    const basesEl = this.overlay.querySelector(".bases")!;
    for (const [key, b] of Object.entries(BASES)) {
      const btn = document.createElement("button");
      btn.textContent = `${b.symbol} ${b.label}`;
      btn.dataset.base = key;
      btn.addEventListener("click", () => {
        if (this.mix.base !== key) { this.mix = { base: key, wt: {} }; this.render(); }
      });
      basesEl.append(btn);
      this.baseBtns.push(btn);
    }

    const famEl = this.overlay.querySelector(".famous")!;
    for (const f of FAMOUS) {
      const btn = document.createElement("button");
      btn.textContent = f.label;
      btn.addEventListener("click", () => {
        this.mix = { base: f.mix.base, wt: { ...f.mix.wt } };
        this.render();
      });
      famEl.append(btn);
    }

    this.buildGrid();

    this.overlay.querySelector(".add")!.addEventListener("click", () => {
      const el = this.addSel.value;
      if (el && !(el in this.mix.wt)) {
        // the CEILING, not the cap: "+ add element → Ti" used to seed 0.5 wt%,
        // which is past the 0.15 wt% Al–Ti peritectic, so one click would have
        // produced a named refusal instead of an alloy
        this.mix.wt[el] = defaultWt(this.mix.base, el);
        this.render();
      }
    });
    this.overlay.querySelector(".x")!.addEventListener("click", () => this.close());
    this.overlay.querySelector(".cancel")!.addEventListener("click", () => this.close());
    this.overlay.querySelector(".pour")!.addEventListener("click", () => this.pour());
    this.overlay.addEventListener("pointerdown", e => { if (e.target === this.overlay) this.close(); });
  }

  /**
   * The 118 cells, and the legend that makes their colours mean something.
   *
   * WHY THE GRID IS HERE AT ALL. The "+ add element" select above it is a
   * CLOSED list: it holds whatever solutes the current base has a cited
   * coefficient row for, six at the most, and every other element in the
   * periodic table is invisible in it. Invisible is not the same as refused,
   * and a user who wonders what mercury does to an aluminium melt got no answer
   * from a control that simply did not list mercury. Every cell here is an
   * answer computed from a cited number — and 683 of the 708 (base, element)
   * pairs are refusals, which is the point rather than the cost: "mercury at
   * 1 wt% exerts 0.053 atm over liquid aluminium, where pure mercury would
   * exert 39" is metallurgy, and a greyed-out cell is nothing. (683 of 708, not
   * "93 of the 118", which is what this comment said first and which mixes two
   * frames: 25 pairs are pourable across all six bases, but over any ONE melt
   * at most six of the 118 cells are, so the per-melt count is 112 and up.)
   *
   * The quick list STAYS. It is one keystroke to the at-most-six solutes a base
   * can actually take — six over aluminium, iron and nickel, three over magnesium
   * and copper, one over zinc — it names each one's m and k in the option text, and it is
   * one tab stop rather than the grid's hundred-and-eighteen; the grid is the
   * open question beside it, not a replacement for the answer. Both are
   * keyboard-reachable — the cells are real buttons — but "reachable" and
   * "reachable without a hundred keystrokes" are different claims.
   */
  private buildGrid() {
    const gridEl = this.overlay.querySelector(".grid")!;
    for (const row of ELEMENTS) {
      const pos = tablePos(row.Z);
      if (!pos) continue;   // unreachable for Z 1-118; a null position is not a cell
      const b = document.createElement("button");
      b.className = "gcell";
      b.dataset.el = row.symbol;
      b.dataset.z = String(row.Z);
      // the lanthanide row carries the gap that separates it from period 7
      if (pos.row === 8) b.dataset.frow = "1";
      b.style.gridColumn = String(pos.col);
      b.style.gridRow = String(pos.row);
      b.textContent = row.symbol;
      gridEl.append(b);
      this.cells.push(b);
    }
    // ONE delegated listener rather than 118, and it reads the symbol off the
    // cell rather than closing over a loop variable — so a cell can be
    // repainted, re-ordered or replaced without leaving a handler behind that
    // still believes it is tungsten.
    gridEl.addEventListener("click", e => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".gcell");
      if (cell?.dataset.el) this.pick(cell.dataset.el);
    });

    const legend = this.overlay.querySelector(".glegend")!;
    for (const [tier, label] of Object.entries(TIER_LABEL)) {
      const s = document.createElement("span");
      s.dataset.tier = tier;
      s.textContent = label;
      legend.append(s);
    }
    const self = document.createElement("span");
    self.dataset.self = "1";
    self.textContent = "this melt's own metal";
    legend.append(self);
    const fume = document.createElement("span");
    fume.dataset.vap = "1";
    fume.textContent = "underlined: it fumes or boils over this melt";
    legend.append(fume);

    this.whyEl = this.overlay.querySelector(".gwhy")!;
    this.renderWhy();
  }

  /**
   * Recolour every cell for the base now selected. Four attributes per cell and
   * no markup — the base buttons are a paint pass, not a rebuild.
   *
   * EVERY CELL IS CLASSIFIED AT ITS OWN `probeWt`, NOT AT A FLAT 1 wt%, and
   * that is a note v7.1 P4 wrote down for this milestone after measuring it: at
   * 1 wt% the classifier answers OUTSIDE-THE-MODEL for Fe–C, Al–Ti and Mg–Zr,
   * because 1 wt% is past all three of their invariants (0.53, 0.15 and 0.58
   * wt%). Three of the twenty-five pourable pairs would have painted as
   * refusals on first open — carbon in steel among them — and every one of
   * those three would have been telling the truth about a composition nobody
   * asked for. `probeWt` asks each pair at 1 wt% OR at half its own invariant
   * composition, whichever is smaller — so Fe–C is asked at 0.265 wt% against a
   * 0.53 wt% peritectic, while Al–Cu, whose invariant is out at 33.2 wt%, is
   * still asked at 1. "Half its ceiling" would be the wrong description of the
   * second case and of most of the table.
   */
  private paintGrid() {
    for (const cell of this.cells) {
      const sym = cell.dataset.el!;
      const a = admit(this.mix.base, sym, probeWt(this.mix.base, sym));
      if (!a) continue;
      cell.dataset.tier = a.tier;
      // the vapour band rides ALONGSIDE the tier rather than inside it, because
      // it answers a different question. Zinc over iron is refused for having
      // no Fe–Zn coefficient row — an epistemic gap — and it also reads 59 atm,
      // which is why galvanised scrap fumes in an EAF. Collapsing the two would
      // lose one of them, and the second is the one a foundry notices.
      if (a.vapour && (a.vapour.band === "FUME" || a.vapour.band === "BOILS")) cell.dataset.vap = a.vapour.band;
      else delete cell.dataset.vap;
      if (sym in this.mix.wt) cell.dataset.in = "1"; else delete cell.dataset.in;
      // THE BASE'S OWN CELL IS MARKED, because otherwise iron sits greyed out
      // in the middle of an iron melt looking like one more thing this build
      // never got round to. Its tier is genuinely REFUSED-PAIR — "add Fe to
      // iron" is not a composition — but the visual grouping would have said
      // "no data", and it is not a data question at all.
      if (sym === BASES[this.mix.base].symbol) cell.dataset.self = "1"; else delete cell.dataset.self;
      cell.classList.toggle("sel", sym === this.picked);
      cell.title = a.line;
    }
  }

  /**
   * A cell was tapped. An assessed one joins the melt; every other one answers.
   *
   * TAP, NOT HOVER. At eighteen columns inside a 94vw card these cells are
   * about nineteen pixels wide, which is a fingertip on a phone and no hover
   * state at all — a reason that only appears under a mouse pointer is a reason
   * half this app's visitors would never see.
   */
  private pick(sym: string) {
    this.picked = sym;
    const a = admit(this.mix.base, sym, probeWt(this.mix.base, sym));
    if (a?.tier === "ASSESSED" && !(sym in this.mix.wt)) {
      // the SAME ceiling-aware default the quick list uses, from the same
      // function, so the two ways of adding a solute cannot disagree
      this.mix.wt[sym] = defaultWt(this.mix.base, sym);
      this.render();      // rows, readout, figure and grid all move together
      return;
    }
    this.paintGrid();
    this.renderWhy();
  }

  /**
   * The reason panel: the one-line answer, then everything the classifier
   * actually computed about this pair.
   *
   * THE ONE-LINER COMES FROM `Admission.line`, WHICH IS COMPOSED AND NOT CUT.
   * P4 left that note explicitly: every one of these sentences puts its number
   * in the middle, so a `.slice()` to fit a panel would have kept the
   * throat-clearing and dropped the measurement. The paragraph is printed
   * underneath it rather than instead of it — this modal already scrolls, and
   * the paragraph is the milestone's content.
   */
  private renderWhy() {
    if (!this.picked) {
      this.whyEl.dataset.el = "";
      this.whyEl.innerHTML = `<div class="gp">tap any cell for what this melt does with that element — 25 of the 708 pairs are pourable and the other 683 are computed refusals, each naming its own number.</div>`;
      return;
    }
    const sym = this.picked;
    const wt = probeWt(this.mix.base, sym);
    const a = admit(this.mix.base, sym, wt);
    if (!a) { this.whyEl.dataset.el = ""; this.whyEl.innerHTML = ""; return; }
    this.whyEl.dataset.el = sym;
    this.whyEl.dataset.tier = a.tier;
    // THE ADVISORY PRINTS FOR EVERY BAND EXCEPT NEGLIGIBLE, and the first draft
    // whitelisted FUME and BOILS instead — which silently threw away every
    // NO-DATA line in the table. Those are not empty: they are the vapour
    // rule's own refusals, each naming the reason it declined — mercury over
    // iron sits past mercury's critical point, chlorine's vapour is molecular
    // so a per-atom enthalpy would put the exponent out by the atom count, a
    // noble gas has no solution for Raoult's law to apply to. Suppressing them
    // is exactly the failure this file argues against one layer down: an
    // absent number is not a zero, and a refusal nobody renders is a refusal
    // nobody made. NEGLIGIBLE stays hidden because it genuinely says nothing —
    // a paragraph about an activity coefficient no melt would notice, on the
    // majority of the table.
    const hazard = a.vapour?.band === "FUME" || a.vapour?.band === "BOILS";
    const vap = a.vapour && a.vapour.band !== "NEGLIGIBLE"
      ? `<div class="gp">${hazard ? "⚠ " : ""}${esc(a.vapour.text)}</div>` : "";
    const size = a.size ? `<div class="gp">${esc(a.size.text)}</div>` : "";
    // THE AFFORDANCE IS THE PANEL'S TO STATE, NOT THE CLASSIFIER'S. `admit()`
    // is a function of (base, element, wt) and cannot know what is already in
    // the crucible, so an invitation to click composed in there kept inviting a
    // click for a solute already in the melt, where clicking does nothing.
    const cta = a.tier === "ASSESSED"
      ? sym in this.mix.wt
        ? `<div class="gp">Already in this melt at ${this.mix.wt[sym]} wt% — the slider above is where you move it.</div>`
        // reachable, and only one way: pick an assessed cell (which adds it),
        // then remove its row with the ✕. A first click never lands here,
        // because it has already put the solute in the mix by the time this
        // renders — so the word is "click", not "click again".
        : `<div class="gp">Click this cell to add it to the melt at ${defaultWt(this.mix.base, sym)} wt%.</div>`
      : "";
    this.whyEl.innerHTML = `
      <div class="ghead"><b>${esc(sym)}</b><span>${esc(TIER_LABEL[a.tier])}</span></div>
      <div class="gline">${esc(a.line)}</div>
      <div class="gp">${esc(a.sentence)}</div>
      ${cta}${vap}${size}`;
  }

  open() { this.open_ = true; this.overlay.classList.add("show"); this.render(); }
  close() { this.open_ = false; this.overlay.classList.remove("show"); }
  isOpen() { return this.open_; }

  /**
   * The frame loop's tick, in the `SlicePanel.update()` idiom: early-out when
   * the panel is closed, and only touch the DOM through the figure's own
   * attribute mutation. It exists because the composer is otherwise INPUT-DRIVEN
   * ONLY — nothing re-rendered it while it was open, so a temperature drawn at
   * open() would freeze while the casting behind it kept solidifying. The melt
   * temperature itself only refreshes at the readout's 4 Hz cadence, so this is
   * fifteen identical frames out of sixteen; the figure's own prose is diffed
   * against the mix so only the cursor's two attributes actually move.
   */
  tick() {
    if (!this.open_) return;
    // Nothing below the cursor's own printed precision is worth redrawing: the
    // label is whole degrees, the melt temperature itself only refreshes at the
    // readouts' 4 Hz cadence, and `layout()` rebuilds a dozen sentences every
    // call. Keyed on the rounded temperature and the material, so a paused melt
    // costs one comparison per frame.
    const t = this.host.meltC();
    const key = `${t == null ? "-" : Math.round(t)}|${this.host.materialKey()}`;
    if (key === this.tickKey) return;
    this.tickKey = key;
    this.figure.update(this.mix, t, this.host.materialKey());
  }

  /** apply a #alloy=… deep link (no modal) */
  applyHash(hash: string): boolean {
    const refusals: string[] = [];
    const mix = decodeMix(hash, refusals);
    if (!mix || Object.keys(mix.wt).length === 0) {
      // The link failed ENTIRELY — unknown base, or every solute term dropped.
      // Those are the loudest failures and the first version of this threw
      // their refusals away on the early return, so `#alloy=al:Xx3` restored
      // nothing and said nothing. The host is told even though no pour happens.
      if (refusals.length) this.host.reportLinkRefusals(refusals);
      return false;
    }
    this.mix = mix;
    this.extraRefusals = refusals;
    this.pour(false);
    return true;
  }

  private pour(setHash = true) {
    const d = derive(this.mix);
    // notGrown travels with the refusals and the clamps because it is the same
    // KIND of statement — something about this melt the instrument is not
    // doing — and because the channel P1 built renders outside the modal, where
    // an #alloy= deep link can carry it. A recipient who never opens the
    // composer still learns that half of the casting on screen freezes as a
    // phase this solver does not grow.
    const caveats = [...this.extraRefusals, ...d.refusals, ...d.notGrown, ...d.clamps];
    this.host.applyAlloy(BASES[this.mix.base].materialKey,
      d.params as Record<string, number>, d.name,
      { mix: { base: this.mix.base, wt: { ...this.mix.wt } }, derived: d, caveats });
    if (setHash) history.replaceState(null, "", "#" + encodeMix(this.mix));
    this.close();
  }

  private render() {
    const base = BASES[this.mix.base];
    // A full redraw re-derives the mix from scratch, so anything raised on the
    // previous pass is either about to be raised again or no longer true. The
    // hash decoder's refusals are deliberately dropped here: by the time the
    // modal is opened they have already been poured and are on screen outside
    // it, and repeating them against a mix the user is now editing would be
    // stale rather than informative.
    this.extraRefusals = [];
    this.baseBtns.forEach(b => b.classList.toggle("on", b.dataset.base === this.mix.base));

    // solute rows
    this.rowsEl.innerHTML = "";
    const d = derive(this.mix);
    for (const [el, w] of Object.entries(this.mix.wt)) {
      const s = base.solutes[el];
      if (!s) {
        // The key still has to go — every line below dereferences `s`. What
        // changes in v7.1 P1 is that it goes on the record: this is reachable
        // from a hand-built mix through window.__solidify, and before P1 the
        // modal simply redrew one row short with no explanation.
        this.extraRefusals.push(`${el} is not a solute this model carries in ${base.label} — removed from the melt`);
        delete this.mix.wt[el];
        continue;
      }
      const row = document.createElement("div");
      row.className = "crow";
      const at = d.atPct[el] ?? 0;
      // the slider's bound is DERIVED (v7.1 P3): the smaller of the hand-picked
      // cap and one step below the invariant this pair's primary phase changes
      // at. For five of the twenty-five pairs the second is the smaller one.
      const b = soluteBound(this.mix.base, el);
      const max = b ? b.max : s.cap;
      row.innerHTML = `
        <b>${el}</b>
        <input type="range" min="0" max="${max}" step="${b ? b.step : (s.cap <= 1 ? 0.01 : 0.05)}" value="${w}">
        <span class="cv">${w.toFixed(2)} wt · ${at.toFixed(2)} at%</span>
        <button class="rm">✕</button>`;
      const slider = row.querySelector("input")!;
      slider.addEventListener("input", () => {
        this.mix.wt[el] = parseFloat(slider.value);
        this.renderOut();
        this.tickKey = "";
        this.figure.update(this.mix, this.host.meltC(), this.host.materialKey());
        row.querySelector(".cv")!.textContent =
          `${this.mix.wt[el].toFixed(2)} wt · ${(derive(this.mix).atPct[el] ?? 0).toFixed(2)} at%`;
      });
      row.querySelector(".rm")!.addEventListener("click", () => { delete this.mix.wt[el]; this.render(); });
      // and why it stops where it does, when the diagram is what stopped it
      const why = [s.note, b && b.boundBy === "invariant" ? b.source : null]
        .filter(Boolean).join(" — ");
      if (why) row.title = why;
      this.rowsEl.append(row);
    }

    // add-element options
    this.addSel.innerHTML = "";
    for (const el of Object.keys(base.solutes)) {
      if (el in this.mix.wt) continue;
      const o = document.createElement("option");
      const s = base.solutes[el];
      o.value = el;
      o.textContent = `${el}  (m ${s.m > 0 ? "+" : ""}${s.m} K/wt%, k ${s.k})${s.note ? " — " + s.note : ""}`;
      this.addSel.append(o);
    }

    this.paintGrid();
    this.renderWhy();
    this.renderOut();
    this.tickKey = "";
    this.figure.update(this.mix, this.host.meltC(), this.host.materialKey());
  }

  private renderOut() {
    const d: Derived = derive(this.mix);
    const p = d.params;
    const base = BASES[this.mix.base];
    const shift = d.dTL === 0 ? "0 K" : `${d.dTL > 0 ? "+" : "−"}${Math.abs(d.dTL).toFixed(1)} K`;
    // The freezing range is the number calibrated mode actually measures
    // temperature in, so it is printed here beside the mapping it is built
    // from, with the regime that decided it. A refusal prints as a refusal.
    const rangeRow = d.dT0 != null
      ? `<div class="drow"><span>freezing range ΔT₀ · ${d.dT0Regime.toLowerCase()}</span><b>${d.dT0.toFixed(1)} K</b></div>`
      : `<div class="drow"><span>freezing range ΔT₀</span><b style="color:#c96a5b">refused</b></div>`;
    // THE TWO COLUMNS (v7.1 P3), and the whole milestone is the gap between
    // them. The left column is read off the cited invariants; the right is what
    // sim.ts grows, which is one solid phase and has always been one solid
    // phase. Printing them side by side is the only way the drawing above stops
    // implying that everything on it is in the model.
    const phaseRows = d.totalWt > 0 ? `
      <div class="phases">
        <div><span>PHASES EQUILIBRIUM PREDICTS</span><b>${esc(d.phasesEquilibrium.join(" · "))}</b></div>
        <div><span>PHASES THIS SOLVER GROWS</span><b>${esc(d.phasesGrown.join(" · "))}</b></div>
      </div>
      <div class="drow"><span>composition regime · ${esc(base.symbol)}–${esc(d.dominant ?? "")}</span><b>${d.regime.toLowerCase().replace(/-/g, " ")}</b></div>
      ${d.invariantFraction ? `<div class="drow"><span>freezes at the invariant · lever / Scheil</span><b>${pct(d.invariantFraction.lever)} / ${pct(d.invariantFraction.scheil)}</b></div>` : ""}` : "";
    this.outEl.innerHTML = `
      <div class="aname">${d.name}${d.totalWt === 0 ? " (pure)" : ""}</div>
      <div class="drow"><span>liquidus shift ΔT<sub>L</sub></span><b>${shift}</b></div>
      <div class="drow"><span>growth restriction Q</span><b>${d.Q.toFixed(1)} K</b></div>
      ${rangeRow}
      ${phaseRows}
      <div class="drow"><span>model mapping</span><b>c₀ ${p.c0!.toFixed(2)} · m ${p.mLiq!.toFixed(2)} · k ${p.kPart!.toFixed(2)} · D ${p.dSol!.toFixed(2)}</b></div>
      <div class="src">${esc(d.dT0Source)}</div>
      ${d.regimeSource ? `<div class="src">${esc(d.regimeSource)}</div>` : ""}
      ${d.refusals.concat(this.extraRefusals).map(r => `<div class="clamp">✕ ${esc(r)}</div>`).join("")}
      ${d.notGrown.map(n => `<div class="clamp">◇ ${esc(n)}</div>`).join("")}
      ${d.clamps.map(c => `<div class="clamp">⚠ ${esc(c)}</div>`).join("")}`;
  }
}
