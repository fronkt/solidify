/**
 * Learn mode: the instrument's teaching layer (v8 U1, docs/COPY-STYLE.md).
 *
 * The instrument is terse on purpose: a control is a label, a value and a
 * unit, and a caveat is one short line. Learn mode, off by default and turned
 * on from the top bar, adds what a student needs on top of that: a 1 to 2
 * sentence explanation per rail section (and, in later phases, per panel)
 * behind a small "i" button, and a one-line hint under the controls that
 * have one. With it off, none of it renders.
 *
 * Where the words live:
 *  - `learn/<area>.ts` holds one area's entries: `learn/rail.ts` for the
 *    control rail now; the panels, the composer and the tour add their own
 *    files and register them the same way.
 *  - A caveat is a `Caveat`: a terse `line` that is on screen while the caveat
 *    applies (see the interface for the two tooltip exceptions), and the
 *    fuller `learn` text, from ONE source object, so a
 *    gate can pin whichever half carries its phrase. Caveats that a model
 *    module computes (units.ts's dimensionless groups, materials.ts's notes
 *    and sources) keep that pair in the module that computes them, as
 *    `note`/`source` plus `learn`, so one function still returns both.
 *
 * Nothing here knows about the rail. `LearnLayer` is the render helper a
 * surface uses to attach its explanations and hints and to show or hide all
 * of them in one pass.
 */

/** an honesty caveat: what must stay on screen, and what learn mode adds */
export interface Caveat {
  /**
   * terse, on screen while the caveat applies: as visible text next to what
   * it qualifies. Two rail lines are a control's tooltip instead, and only
   * because the caveat is about using that control: reheat's (the button),
   * and `derived` on each grayed dial, whose lock the calibration readout
   * already states in visible text (`calLocked`).
   */
  line: string;
  /** 1 to 2 plain sentences for learn mode, no em dashes */
  learn: string;
}

export interface LearnEntry {
  /**
   * `sec:<title>` for a rail section: the same key the tour highlights it by,
   * so a chapter and learn mode can point at one text.
   */
  id: string;
  /** 1 to 2 sentences: what it is and why it matters, the physics last */
  text: string;
  /** one-line hints, keyed by the control's label exactly as it is printed */
  hints?: Readonly<Record<string, string>>;
}

// ------------------------------------------------------------------ registry

const registry = new Map<string, LearnEntry>();

/** add an area's entries; a later entry with the same id replaces the earlier (hot reload) */
export function registerLearn(entries: readonly LearnEntry[]): void {
  for (const e of entries) registry.set(e.id, e);
}

export function learnEntry(id: string): LearnEntry | undefined {
  return registry.get(id);
}

/** every registered id, optionally only those starting with `prefix` */
export function learnIds(prefix = ""): string[] {
  return [...registry.keys()].filter(k => k.startsWith(prefix));
}

// ------------------------------------------------------------------ storage

/**
 * localStorage, but never fatal: a private window, blocked site data or a
 * sandboxed frame can make the accessor itself throw, and the instrument has
 * to work regardless. A failed write means the setting lasts this visit only.
 */
export function storeGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function storeSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* not remembered */ }
}

// -------------------------------------------------------------- toggle state

const LEARN_KEY = "sol.learn";
let learnOn = storeGet(LEARN_KEY) === "1";
const listeners = new Set<(on: boolean) => void>();

export function isLearnOn(): boolean { return learnOn; }

export function setLearnOn(on: boolean): void {
  if (on === learnOn) return;
  learnOn = on;
  storeSet(LEARN_KEY, on ? "1" : "0");
  for (const f of listeners) f(on);
}

/** called on every change; returns the unsubscribe */
export function onLearnChange(f: (on: boolean) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** wire the top bar's toggle: click flips it, aria-pressed and .on follow the state */
export function bindLearnToggle(btn: HTMLButtonElement): void {
  const paint = () => {
    btn.setAttribute("aria-pressed", String(learnOn));
    btn.classList.toggle("on", learnOn);
  };
  btn.addEventListener("click", () => setLearnOn(!learnOn));
  onLearnChange(paint);
  paint();
}

// ------------------------------------------------------------------- render

const show = (el: HTMLElement, on: boolean) => { el.style.display = on ? "" : "none"; };
const displayed = (el: HTMLElement) => el.style.display !== "none";
let uid = 0;

/** add or remove one id in `el`'s aria-describedby, leaving any others */
function describedBy(el: Element, id: string, on: boolean) {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(t => t && t !== id);
  if (on) ids.push(id);
  if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
  else el.removeAttribute("aria-describedby");
}

/** A header's "i" button and the explanation it expands (collapsed to start). */
export class Explainer {
  readonly button: HTMLButtonElement;
  readonly body: HTMLDivElement;
  private open = false;

  constructor(label: string, text: string, private onToggle: () => void) {
    this.body = document.createElement("div");
    this.body.className = "lrnText lrnSec";
    this.body.id = `lrn-${++uid}`;
    this.body.textContent = text;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "lrnInfo";
    this.button.textContent = "i";
    this.button.setAttribute("aria-label", label);
    this.button.setAttribute("aria-controls", this.body.id);
    this.button.setAttribute("aria-expanded", "false");
    this.button.addEventListener("click", e => {
      // the button sits inside a clickable header: explaining a section must
      // not also open or close it
      e.stopPropagation();
      this.open = !this.open;
      this.button.setAttribute("aria-expanded", String(this.open));
      this.onToggle();
    });
  }

  apply(on: boolean) {
    show(this.button, on);
    show(this.body, on && this.open);
  }
}

interface Item { apply(on: boolean): void }

/**
 * Everything learn mode adds to one surface, shown or hidden in one pass.
 * `apply()` belongs at the END of the surface's own refresh, after it has set
 * which controls are displayed, because a hint follows its control.
 */
export class LearnLayer {
  private items: Item[] = [];

  /** `refresh` re-runs the surface's own refresh, which ends in `apply()` */
  constructor(private refresh: () => void) {}

  /** an "i" button inside `header` (before `before`, if given); returns it with its body */
  explain(header: HTMLElement, label: string, text: string, before: Node | null = null): Explainer {
    const ex = new Explainer(label, text, () => this.refresh());
    header.insertBefore(ex.button, before);
    this.items.push(ex);
    return ex;
  }

  /**
   * a one-line hint right after `ctrl`, shown while learn is on and `ctrl` is
   * displayed. While shown it also describes the control's own input, select
   * or button (aria-describedby), so a screen reader tabbing through the rail
   * hears it; the id is removed when it hides, because aria-describedby still
   * reads a display:none target.
   */
  hint(ctrl: HTMLElement, text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "lrnHint";
    el.id = `lrn-${++uid}`;
    el.textContent = text;
    ctrl.after(el);
    const focusable = ctrl.matches("input, select, button") ? ctrl
      : ctrl.querySelector("input, select, button");
    this.items.push({
      apply: on => {
        const shown = on && displayed(ctrl);
        show(el, shown);
        if (focusable) describedBy(focusable, el.id, shown);
      },
    });
    return el;
  }

  /**
   * a learn paragraph right after `anchor` (a caveat's on-screen line, or a
   * control), shown while learn is on, `anchor` is displayed and has text
   * (when `anchor` is a line), and the paragraph itself has text. Set its
   * text later with `.textContent` when it depends on state.
   */
  para(anchor: HTMLElement, text = "", { needsAnchorText = false } = {}): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "lrnText";
    el.textContent = text;
    // below the anchor's own hint, if it has one
    let at: Element = anchor;
    while (at.nextElementSibling?.classList.contains("lrnHint")) at = at.nextElementSibling;
    at.after(el);
    this.items.push({
      apply: on => show(el, on && displayed(anchor) && !!el.textContent
        && (!needsAnchorText || !!anchor.textContent)),
    });
    return el;
  }

  apply(on = isLearnOn()) {
    for (const it of this.items) it.apply(on);
  }
}
