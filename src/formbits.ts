/**
 * Shared form plumbing for the floating panels (lab mode, heat treat).
 *
 * These four widgets started life as private methods on `Lab`. The moment a
 * second panel needed them the choice was copy or share, and 55 lines of
 * duplicated form plumbing is how two panels start disagreeing about what a
 * slider looks like. They are deliberately dumb: build a row, wire the input,
 * return the element — no state, no styling opinions beyond the house palette.
 */

export function field(label: string): HTMLElement {
  const row = document.createElement("label");
  row.style.cssText = "display:flex;align-items:center;gap:8px;color:#8891a0;";
  const l = document.createElement("span");
  l.textContent = label;
  l.style.cssText = "flex:0 0 118px;";
  row.append(l);
  return row;
}

export function range(label: string, min: number, max: number, step: number, val: number,
  set: (v: number) => void, digits = 0, fmt?: (v: number) => string): HTMLElement {
  const row = field(label);
  const inp = document.createElement("input");
  inp.type = "range";
  inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
  inp.style.cssText = "flex:1;min-width:60px;";
  const out = document.createElement("span");
  const show = (v: number) => (fmt ? fmt(v) : v.toFixed(digits));
  out.textContent = show(val);
  out.style.cssText = "flex:0 0 58px;text-align:right;color:#cfd6df;";
  inp.addEventListener("input", () => {
    const v = parseFloat(inp.value);
    out.textContent = show(v);
    set(v);
  });
  row.append(inp, out);
  return row;
}

export function select(label: string, opts: string[], val: string, set: (v: string) => void): HTMLElement {
  const row = field(label);
  const sel = document.createElement("select");
  sel.style.cssText = "flex:1;background:#12151a;color:#cfd6df;border:1px solid #262b33;border-radius:4px;padding:2px 4px;";
  for (const o of opts) {
    const op = document.createElement("option");
    op.value = o; op.textContent = o;
    if (o === val) op.selected = true;
    sel.append(op);
  }
  sel.addEventListener("change", () => set(sel.value));
  row.append(sel);
  return row;
}

export function check(label: string, val: boolean, set: (v: boolean) => void): HTMLElement {
  const row = field(label);
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.checked = val;
  inp.addEventListener("change", () => set(inp.checked));
  row.append(inp);
  return row;
}
