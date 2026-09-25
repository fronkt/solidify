// The markup the script-built panels share (v8 D2): the mode panels (lab
// mode, heat treat, optimizer, challenge), the lab's run report, the analysis
// columns and their enlarged plots. The look lives in tokens.css (the "tool"
// section: .tpanel, .phead, .kv, .v, .q, .warnline, .tmodal); these helpers
// only write the class names, once, so no panel spells a color or a size.
//
// Every string helper keeps the TEXT exactly what it wraps: a warning's "!"
// is CSS generated content, and a spec row's label and value are separated
// by one literal space, so a panel's textContent (which the gates parse)
// reads as the plain sentence it always did.

/** a number inside running text: bright, tabular mono */
export const num = (s: string | number): string => `<span class="v">${s}</span>`;
/** quiet text: a label, a unit, a provenance, a standing caveat */
export const quiet = (s: string): string => `<span class="q">${s}</span>`;
/** a verdict or refusal word: "!" and weight, never a hue */
export const warnWord = (s: string): string => `<span class="status--warn">${s}</span>`;
/** a warning that is a whole sentence (inline): bright, led by "!" */
export const warnLine = (s: string): string => `<span class="warnline">${s}</span>`;

/** one spec row of a report: label left in --fg-3, what it says right.
 *  `after` (a learn slot) spans the row under both */
export const kv = (k: string, v: string, after = ""): string =>
  `<div class="kv__row"><div class="kv__k">${k}</div> <div class="kv__v">${v}</div>${after}</div>`;
/** a row with no label, across both columns */
export const kvFull = (v: string, after = ""): string =>
  `<div class="kv__row kv__row--full"><div class="kv__v">${v}</div>${after}</div>`;

/** a panel's header row: the nav-style title, then `meta` (quiet text),
 *  then `end` pushed to the far end (exit, close) */
export function panelHead(title: string, end?: HTMLElement | null, meta?: HTMLElement | null): HTMLElement {
  const head = document.createElement("div");
  head.className = "phead";
  const t = document.createElement("span");
  t.className = "phead__title";
  t.textContent = title;
  head.append(t);
  if (meta) { meta.classList.add("phead__meta"); head.append(meta); }
  if (end) { end.classList.add("phead__end"); head.append(end); }
  return head;
}

/** a pill button with its label (and, when given, a class) */
export function pill(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

/** what Tab can reach inside `root`, in DOM order, displayed and enabled */
export function tabbables(root: Element | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")]
    .filter(e => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0);
}

/**
 * An enlarged plot: a --surface card over the dimmed instrument, its header
 * the plot's title and a close pill (#bigClose). A modal dialog for the
 * keyboard as well as the mouse, as the alloy composer is: focus moves to
 * the close pill, Tab wraps inside the card, Escape closes it (so does a
 * click on the backdrop), and focus goes back to the control that opened
 * it. main.ts's shortcuts (Space, the lens digits) stand down while a
 * .tmodal is open. Returns the backdrop (remove it to close) and the card.
 * `host` is where the backdrop goes: #app, or a modal the plot sits in (the
 * alloy composer's phase diagram), which inerts everything outside itself.
 */
export function plotModal(title: string, onClose: () => void, host?: HTMLElement): { wrap: HTMLElement; card: HTMLElement } {
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement : null;
  const close = () => {
    window.removeEventListener("keydown", onKey);
    onClose();
    if (opener && opener.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
  };
  const wrap = document.createElement("div");
  wrap.className = "tmodal";
  const card = document.createElement("div");
  card.className = "tmodal__card tpanel";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", title.toLowerCase());
  const closeB = pill("close", close);
  closeB.id = "bigClose";
  card.append(panelHead(title, closeB));
  wrap.append(card);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  // on window, not the card: a click on the card's text leaves focus on the
  // body, and Escape must still close it. It goes with the modal, however
  // the modal was removed
  const onKey = (e: KeyboardEvent) => {
    if (!wrap.isConnected) { window.removeEventListener("keydown", onKey); return; }
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const list = tabbables(card);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || (e.shiftKey ? i === 0 : i === list.length - 1)) {
      e.preventDefault();
      (e.shiftKey ? list[list.length - 1] : list[0]).focus();
    }
  };
  window.addEventListener("keydown", onKey);
  (host ?? document.getElementById("app")!).append(wrap);
  closeB.focus({ preventScroll: true });
  return { wrap, card };
}
