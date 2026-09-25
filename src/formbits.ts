/**
 * Shared form plumbing for the floating panels (lab mode, heat treat).
 *
 * These four widgets started life as private methods on `Lab`. The moment a
 * second panel needed them the choice was copy or share, and 55 lines of
 * duplicated form plumbing is how two panels start disagreeing about what a
 * slider looks like. They are deliberately dumb: build a row, wire the input,
 * return the element, no state. Their look is the design system's: the row,
 * label and value classes live in app/index.html (.fbrow), the slider,
 * select and switch in tokens.css's tool section, so no color is written
 * here.
 */
import { paintRange } from "./design/tool";

export function field(label: string): HTMLElement {
  const row = document.createElement("label");
  row.className = "fbrow";
  const l = document.createElement("span");
  l.className = "fblab";
  l.textContent = label;
  row.append(l);
  return row;
}

export function range(label: string, min: number, max: number, step: number, val: number,
  set: (v: number) => void, digits = 0, fmt?: (v: number) => string): HTMLElement {
  const row = field(label);
  const inp = document.createElement("input");
  inp.type = "range";
  inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
  paintRange(inp);
  const out = document.createElement("span");
  out.className = "fbval";
  const show = (v: number) => (fmt ? fmt(v) : v.toFixed(digits));
  out.textContent = show(val);
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
