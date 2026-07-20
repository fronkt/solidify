// Floating SECTION PLANE panel — the metallographer's saw. Appears with the
// SLICE lens: orientation presets, depth, free tilt/turn rotation, a CT-sweep
// toggle (serial sectioning; pair with ⏺ rec for the classic lab video), and
// the cut-face style select (the etch cabinet).

export interface SliceHost {
  getSliceAxis(): number; setSliceAxis(a: number): void;
  getSliceOff(): number; setSliceOff(v: number): void;
  getSliceTilt(): number; setSliceTilt(v: number): void;
  getSliceTurn(): number; setSliceTurn(v: number): void;
  getSliceSweep(): boolean; setSliceSweep(b: boolean): void;
  getCutStyle(): number; setCutStyle(v: number): void;
}

export const CUT_STYLES = [
  "live cut · orientation tint",
  "plain Nital etch",
  "Klemm's tint etch",
  "Beraha's tint etch",
  "EBSD / IPF map",
];

export class SlicePanel {
  private root: HTMLElement;
  private offInp!: HTMLInputElement;
  private offVal!: HTMLElement;
  private axisBtns: HTMLButtonElement[] = [];
  private sweepChk!: HTMLInputElement;
  private styleSel!: HTMLSelectElement;
  private visible = false;

  constructor(private host: SliceHost) {
    this.root = document.getElementById("slicePop")!;
    const h = document.createElement("div");
    h.className = "t";
    h.textContent = "SECTION PLANE";
    this.root.append(h);

    const prow = document.createElement("div");
    prow.className = "btnrow";
    ["⊥ X", "⊥ Y", "⊥ Z · horizontal"].forEach((label, i) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", () => {
        host.setSliceAxis(i);
        host.setSliceTilt(0);
        host.setSliceTurn(0);
        this.syncNow();
      });
      prow.append(b);
      this.axisBtns.push(b);
    });
    this.root.append(prow);

    const mk = (label: string, min: number, max: number, step: number,
      get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const row = document.createElement("div");
      row.className = "row";
      const lab = document.createElement("label");
      lab.textContent = label;
      const inp = document.createElement("input");
      inp.type = "range";
      inp.min = String(min); inp.max = String(max); inp.step = String(step);
      inp.value = String(get());
      const val = document.createElement("div");
      val.className = "val";
      val.textContent = fmt(get());
      inp.addEventListener("input", () => { set(parseFloat(inp.value)); val.textContent = fmt(get()); });
      row.append(lab, inp, val);
      this.root.append(row);
      return { inp, val, fmt, get };
    };
    const depth = mk("depth", 0.02, 0.98, 0.005,
      () => host.getSliceOff(), v => host.setSliceOff(v), v => `${(v * 100).toFixed(0)}%`);
    this.offInp = depth.inp;
    this.offVal = depth.val;
    mk("tilt", 0, 90, 1, () => host.getSliceTilt(), v => host.setSliceTilt(v), v => `${v.toFixed(0)}°`);
    mk("turn", 0, 360, 2, () => host.getSliceTurn(), v => host.setSliceTurn(v), v => `${v.toFixed(0)}°`);

    const sweepRow = document.createElement("label");
    sweepRow.className = "checkrow";
    this.sweepChk = document.createElement("input");
    this.sweepChk.type = "checkbox";
    this.sweepChk.addEventListener("change", () => host.setSliceSweep(this.sweepChk.checked));
    const span = document.createElement("span");
    span.textContent = "CT sweep — serial sectioning (pair with ⏺ rec)";
    sweepRow.append(this.sweepChk, span);
    this.root.append(sweepRow);

    this.styleSel = document.createElement("select");
    CUT_STYLES.forEach((label, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = label;
      this.styleSel.append(o);
    });
    this.styleSel.addEventListener("change", () => host.setCutStyle(parseInt(this.styleSel.value, 10)));
    this.root.append(this.styleSel);

    const note = document.createElement("div");
    note.className = "matnote";
    note.textContent = "shift-drag on the melt scrubs the depth · tap the cut to seed on it";
    this.root.append(note);
    this.syncNow();
  }

  /** append a late-arriving cut style (e.g. the Niyama ramp) */
  addStyle(label: string) {
    const o = document.createElement("option");
    o.value = String(this.styleSel.options.length);
    o.textContent = label;
    this.styleSel.append(o);
  }

  private syncNow() {
    this.axisBtns.forEach((b, i) => b.classList.toggle("on", i === this.host.getSliceAxis()));
    this.offInp.value = String(this.host.getSliceOff());
    this.offVal.textContent = `${(this.host.getSliceOff() * 100).toFixed(0)}%`;
    this.sweepChk.checked = this.host.getSliceSweep();
    this.styleSel.value = String(this.host.getCutStyle());
  }

  /** called every 3D frame: visibility + live depth readout (sweep / shift-drag) */
  update(show: boolean) {
    if (show !== this.visible) {
      this.visible = show;
      this.root.style.display = show ? "block" : "none";
      if (show) this.syncNow();
    }
    if (show) {
      const txt = `${(this.host.getSliceOff() * 100).toFixed(0)}%`;
      if (this.offVal.textContent !== txt) {
        this.offVal.textContent = txt;
        this.offInp.value = String(this.host.getSliceOff());
      }
    }
  }
}
