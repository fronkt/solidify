import { BASES, FAMOUS, derive, encodeMix, decodeMix, type Mix, type Derived } from "./alloy";

// The alloy composer: pick a base metal, add solutes in wt% (live at%
// conversion), read the real dilute-limit chemistry (liquidus shift, growth
// restriction Q), and pour it — the mix collapses onto the model's
// pseudo-binary solute field and arms a fresh melt.

export interface ComposerHost {
  applyAlloy(materialKey: string, params: Record<string, number>): void;
}

export class Composer {
  private overlay: HTMLElement;
  private rowsEl!: HTMLElement;
  private outEl!: HTMLElement;
  private addSel!: HTMLSelectElement;
  private baseBtns: HTMLButtonElement[] = [];
  private mix: Mix = { base: "al", wt: { Cu: 4.4, Mg: 1.5 } };

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
        <div class="cfoot"><button class="pour">⚗ pour this alloy</button><button class="cancel">cancel</button></div>
      </div>`;
    document.body.append(this.overlay);

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
        this.mix.wt[el] = Math.min(1, BASES[this.mix.base].solutes[el].cap);
        this.render();
      }
    });
    this.overlay.querySelector(".x")!.addEventListener("click", () => this.close());
    this.overlay.querySelector(".cancel")!.addEventListener("click", () => this.close());
    this.overlay.querySelector(".pour")!.addEventListener("click", () => this.pour());
    this.overlay.addEventListener("pointerdown", e => { if (e.target === this.overlay) this.close(); });
  }

  open() { this.overlay.classList.add("show"); this.render(); }
  close() { this.overlay.classList.remove("show"); }

  /** apply a #alloy=… deep link (no modal) */
  applyHash(hash: string): boolean {
    const mix = decodeMix(hash);
    if (!mix || Object.keys(mix.wt).length === 0) return false;
    this.mix = mix;
    this.pour(false);
    return true;
  }

  private pour(setHash = true) {
    const d = derive(this.mix);
    this.host.applyAlloy(BASES[this.mix.base].materialKey, d.params as Record<string, number>);
    if (setHash) history.replaceState(null, "", "#" + encodeMix(this.mix));
    this.close();
  }

  private render() {
    const base = BASES[this.mix.base];
    this.baseBtns.forEach(b => b.classList.toggle("on", b.dataset.base === this.mix.base));

    // solute rows
    this.rowsEl.innerHTML = "";
    const d = derive(this.mix);
    for (const [el, w] of Object.entries(this.mix.wt)) {
      const s = base.solutes[el];
      if (!s) { delete this.mix.wt[el]; continue; }
      const row = document.createElement("div");
      row.className = "crow";
      const at = d.atPct[el] ?? 0;
      row.innerHTML = `
        <b>${el}</b>
        <input type="range" min="0" max="${s.cap}" step="${s.cap <= 1 ? 0.01 : 0.05}" value="${w}">
        <span class="cv">${w.toFixed(2)} wt · ${at.toFixed(2)} at%</span>
        <button class="rm">✕</button>`;
      const slider = row.querySelector("input")!;
      slider.addEventListener("input", () => {
        this.mix.wt[el] = parseFloat(slider.value);
        this.renderOut();
        row.querySelector(".cv")!.textContent =
          `${this.mix.wt[el].toFixed(2)} wt · ${(derive(this.mix).atPct[el] ?? 0).toFixed(2)} at%`;
      });
      row.querySelector(".rm")!.addEventListener("click", () => { delete this.mix.wt[el]; this.render(); });
      if (s.note) row.title = s.note;
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
  }

  private renderOut() {
    const d: Derived = derive(this.mix);
    const p = d.params;
    const shift = d.dTL === 0 ? "0 K" : `${d.dTL > 0 ? "+" : "−"}${Math.abs(d.dTL).toFixed(1)} K`;
    this.outEl.innerHTML = `
      <div class="aname">${d.name}${d.totalWt === 0 ? " (pure)" : ""}</div>
      <div class="drow"><span>liquidus shift ΔT<sub>L</sub></span><b>${shift}</b></div>
      <div class="drow"><span>growth restriction Q</span><b>${d.Q.toFixed(1)} K</b></div>
      <div class="drow"><span>model mapping</span><b>c₀ ${p.c0!.toFixed(2)} · m ${p.mLiq!.toFixed(2)} · k ${p.kPart!.toFixed(2)} · D ${p.dSol!.toFixed(2)}</b></div>
      ${d.clamps.map(c => `<div class="clamp">⚠ ${c}</div>`).join("")}`;
  }
}
