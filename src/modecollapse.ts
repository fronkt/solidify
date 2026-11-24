/**
 * Collapsible HUD strip for solidification workflow panels (`lab mode`,
 * `heat treat`, `2D optimizer`, `3D optimizer`, `challenge`).
 *
 * Every panel opens expanded by default; clicking `hide` or starting a run
 * folds the body into a compact single-row bottom strip so the live canvas
 * stays unobstructed, and clicking `setup ▴` (or the strip body) restores it.
 */
import { pill } from "./design/panel";
import { paintRanges } from "./design/tool";

export interface ModeCollapseOpts {
  title: string;
  head: HTMLElement;
  bodyEls: HTMLElement[];
  onExit: () => void;
  onToggle?: (collapsed: boolean) => void;
}

export interface ModeCollapseHandle {
  readonly collapsed: boolean;
  setCollapsed(b: boolean): void;
  setSummary(text: string): void;
  setAction(btn: HTMLButtonElement | null): void;
}

export function attachModeCollapse(
  panel: HTMLElement,
  opts: ModeCollapseOpts,
): ModeCollapseHandle {
  let collapsed = false;
  let actionBtn: HTMLButtonElement | null = null;

  const minBtn = pill("hide", () => setCollapsed(true), "mp__min");
  minBtn.setAttribute("aria-expanded", "true");
  minBtn.title = "minimize panel to watch simulation";

  const headActs = opts.head.querySelector<HTMLElement>(".pactions");
  if (headActs) {
    const exitEl = [...headActs.querySelectorAll("button")].find(
      b => b.textContent?.trim() === "exit",
    );
    headActs.insertBefore(minBtn, exitEl ?? headActs.firstChild);
  } else {
    const endEl = opts.head.querySelector<HTMLElement>(".phead__end");
    if (endEl) {
      const wrap = document.createElement("span");
      wrap.className = "pactions phead__end";
      endEl.classList.remove("phead__end");
      endEl.replaceWith(wrap);
      wrap.append(minBtn, endEl);
    } else {
      minBtn.classList.add("phead__end");
      opts.head.append(minBtn);
    }
  }

  const body = document.createElement("div");
  body.className = "mp__body";
  for (const el of opts.bodyEls) body.append(el);
  panel.append(body);

  const strip = document.createElement("div");
  strip.className = "mp__strip";
  strip.setAttribute("role", "region");
  strip.setAttribute("aria-label", `${opts.title.toLowerCase()} summary`);

  const titleEl = document.createElement("span");
  titleEl.className = "mp__title";
  titleEl.textContent = opts.title;

  const sumEl = document.createElement("span");
  sumEl.className = "mp__sum";

  const acts = document.createElement("div");
  acts.className = "mp__acts";
  const setupBtn = pill("setup ▴", () => setCollapsed(false));
  const exitBtn = pill("exit", () => opts.onExit());
  acts.append(setupBtn, exitBtn);

  strip.append(titleEl, sumEl, acts);
  strip.addEventListener("click", e => {
    if ((e.target as HTMLElement | null)?.closest("button")) return;
    setCollapsed(false);
  });
  panel.append(strip);

  const setCollapsed = (b: boolean) => {
    if (collapsed === b && panel.classList.contains("is-collapsed") === b) return;
    collapsed = b;
    panel.classList.toggle("is-collapsed", b);
    minBtn.setAttribute("aria-expanded", String(!b));
    if (!b) paintRanges(panel);
    opts.onToggle?.(b);
  };

  const setSummary = (text: string) => {
    if (sumEl.textContent !== text) sumEl.textContent = text;
  };

  const setAction = (btn: HTMLButtonElement | null) => {
    if (actionBtn === btn) return;
    actionBtn?.remove();
    actionBtn = btn;
    if (btn) acts.insertBefore(btn, setupBtn);
  };

  return {
    get collapsed() { return collapsed; },
    setCollapsed,
    setSummary,
    setAction,
  };
}
