import { BASES, FAMOUS, derive, encodeMix, decodeMix, soluteBound, type Mix, type Derived } from "./alloy";
import { PhaseFigureView } from "./phasediagram";

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

    this.overlay.querySelector(".add")!.addEventListener("click", () => {
      const el = this.addSel.value;
      if (el && !(el in this.mix.wt)) {
        // the CEILING, not the cap: "+ add element → Ti" used to seed 0.5 wt%,
        // which is past the 0.15 wt% Al–Ti peritectic, so one click would have
        // produced a named refusal instead of an alloy
        const b = soluteBound(this.mix.base, el);
        this.mix.wt[el] = Math.min(1, b ? b.max : BASES[this.mix.base].solutes[el].cap);
        this.render();
      }
    });
    this.overlay.querySelector(".x")!.addEventListener("click", () => this.close());
    this.overlay.querySelector(".cancel")!.addEventListener("click", () => this.close());
    this.overlay.querySelector(".pour")!.addEventListener("click", () => this.pour());
    this.overlay.addEventListener("pointerdown", e => { if (e.target === this.overlay) this.close(); });
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
