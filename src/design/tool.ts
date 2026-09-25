// The instrument's side of the design system (tokens.css, the "tool"
// section): the two things CSS cannot do on its own.
//
//  - A slider's filled part. tokens.css draws the track as --fg up to --fill
//    and --rule-strong after it; the percentage has to come from script,
//    because no selector can read an input's live value.
//  - Canvas drawing (the view cube, the HUD's sparklines) cannot use var(),
//    so it reads the tokens once from the computed style of :root. No color
//    is written in a module: a hex value anywhere but tokens.css is a review
//    finding (docs/DESIGN.md section 7).

/** set one range input's --fill from its own value */
export function paintRange(inp: HTMLInputElement): void {
  const lo = inp.min === "" ? 0 : Number(inp.min);
  const hi = inp.max === "" ? 100 : Number(inp.max);
  const v = Number(inp.value);
  const f = hi > lo && Number.isFinite(v) ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
  inp.style.setProperty("--fill", `${(f * 100).toFixed(2)}%`);
}

/** every range input under `root`, after values were set from script */
export function paintRanges(root: ParentNode = document): void {
  for (const inp of root.querySelectorAll<HTMLInputElement>('input[type="range"]')) paintRange(inp);
}

/** a dragged slider follows its own value, whichever panel built it */
export function bindRangeFills(root: Document | HTMLElement = document): void {
  root.addEventListener("input", e => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === "range") paintRange(t);
  }, true);
}

/**
 * A toggle's state, for the eye and the screen reader at once: aria-pressed,
 * which tokens.css draws as the inverted pill (or, on the transport, as the
 * emphasized outline). Every set of toggles (symmetry, grid, scenario, the
 * SDAS ruler, the section axis, the composer's base) goes through this, so
 * none shows its state only visually.
 */
export function setPressed(b: HTMLElement, on: boolean): void {
  b.setAttribute("aria-pressed", String(on));
}

const cache = new Map<string, string>();

/** a design token's value (e.g. "--fg"), for canvas drawing */
export function token(name: string): string {
  let v = cache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    // an empty read (the stylesheet not applied yet) is not cached
    if (v) cache.set(name, v);
  }
  return v || "gray";
}

/** a hex color token as [r, g, b], 0 to 255 */
export function tokenRGB(name: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(token(name));
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** a hex color token at an alpha, for a canvas fill (a translucent band) */
export function tokenRGBA(name: string, alpha: number): string {
  const [r, g, b] = tokenRGB(name);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
