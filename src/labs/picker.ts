import type { LabCategory, LabDef, LabId, LabProgressSummary } from "./types";
import { panelHead, pill, tabbables } from "../design/panel";

export interface GuidedLabPickerHost {
  labs(): readonly LabDef[];
  progress(): Record<LabId, LabProgressSummary>;
  activeLabId(): LabId | null;
  can3d(): boolean;
  startLab(idOrHash: LabId | number, opts?: { restart?: boolean }): Promise<void> | void;
}

type FilterKey = "ALL" | LabCategory;
const FILTERS: readonly FilterKey[] = ["ALL", "2D", "TRUE 3D", "HEAT TREAT", "ENGINES"];

/**
 * Full-catalog Guided Labs modal (`#guidedPicker`, `.tmodal` at z-index 40).
 * Mounted inside `#app` on open and removed on close so `main.ts`'s `.tmodal`
 * shortcut guard and `body:has(#guidedPicker) #transport .run` step-down apply
 * automatically.
 */
export class GuidedLabPicker {
  private wrap: HTMLElement | null = null;
  private opener: HTMLElement | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private filter: FilterKey = "ALL";

  constructor(private host: GuidedLabPickerHost) {}

  isOpen(): boolean {
    return !!this.wrap && this.wrap.isConnected;
  }

  open(notice?: string): void {
    this.close(false);
    this.filter = "ALL";
    this.opener =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;

    const wrap = document.createElement("div");
    wrap.id = "guidedPicker";
    wrap.className = "tmodal";

    const card = document.createElement("div");
    card.className = "tmodal__card tpanel glp__card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "guidedPickerTitle");

    const labs = this.host.labs();
    const meta = document.createElement("span");
    meta.textContent = `${labs.length} labs · browser-local · no login`;
    const closeB = pill("close", () => this.close(true));
    closeB.id = "guidedPickerClose";
    const head = panelHead("GUIDED LABS", closeB, meta);
    head.querySelector(".phead__title")?.setAttribute("id", "guidedPickerTitle");
    card.append(head);

    if (notice) {
      const warn = document.createElement("div");
      warn.className = "glp__notice warnline";
      warn.textContent = notice;
      card.append(warn);
    }

    const listWrap = document.createElement("div");
    listWrap.className = "glp__list";

    const renderList = () => {
      listWrap.textContent = "";
      const allLabs = this.host.labs();
      const visible = this.filter === "ALL" ? allLabs : allLabs.filter(l => l.category === this.filter);
      if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "glp__empty";
        empty.textContent = "No labs in this category.";
        listWrap.append(empty);
        return;
      }
      const progress = this.host.progress();
      const activeId = this.host.activeLabId();
      const can3d = this.host.can3d();

      // One filled primary pill across the entire picker: active lab if visible,
      // otherwise first unfinished lab, otherwise first visible lab.
      const primaryId =
        (activeId && visible.some(l => l.id === activeId) ? activeId : null) ??
        visible.find(l => {
          const p = progress[l.id];
          return !p || p.completed + p.skipped < l.steps.length;
        })?.id ??
        visible[0]?.id ??
        null;

      for (const lab of visible) {
        const p = progress[lab.id] ?? { completed: 0, skipped: 0, total: lab.steps.length, started: false };
        const doneCount = p.completed + p.skipped;
        const isActive = lab.id === activeId;
        const isPrimary = lab.id === primaryId;
        const isComplete = doneCount >= lab.steps.length && lab.steps.length > 0;

        const row = document.createElement("div");
        row.className = "glp__row" + (isActive || p.started ? " is-active" : "");

        const idx = document.createElement("div");
        idx.className = "glp__idx";
        idx.textContent = lab.number;

        const body = document.createElement("div");
        const title = document.createElement("div");
        title.className = "glp__title";
        title.textContent = lab.title;

        const summary = document.createElement("div");
        summary.className = "glp__summary";
        summary.textContent = lab.summary;

        const metaRow = document.createElement("div");
        metaRow.className = "glp__meta";
        const info = document.createElement("span");
        info.textContent = `${lab.minutes} min · ${lab.dimension} · ${lab.course}`;
        metaRow.append(info);

        if (p.started || doneCount > 0) {
          const prog = document.createElement("span");
          prog.className = "v";
          prog.textContent = isComplete
            ? `✓ ${p.completed}/${lab.steps.length}`
            : `${p.completed}/${lab.steps.length} done`;
          metaRow.append(prog);
        }

        body.append(title, summary, metaRow);

        if (lab.requires3d && !can3d) {
          const warn3d = document.createElement("div");
          warn3d.className = "glp__warn warnline";
          warn3d.textContent = "TRUE 3D unavailable on this GPU · 2D steps still runnable";
          body.append(warn3d);
        }

        const acts = document.createElement("div");
        acts.className = "glp__acts";

        const launchLabel = isPrimary
          ? p.started && !isComplete
            ? "▶ resume"
            : "▶ start"
          : p.started && !isComplete
            ? "resume"
            : "start";
        const launchBtn = pill(
          launchLabel,
          () => {
            this.close(false);
            void this.host.startLab(lab.id, { restart: isComplete });
          },
          isPrimary ? "accent" : "",
        );
        acts.append(launchBtn);

        if (p.started && !isComplete) {
          const restartBtn = pill(
            "restart",
            () => {
              this.close(false);
              void this.host.startLab(lab.id, { restart: true });
            },
            "gl__link",
          );
          acts.append(restartBtn);
        }

        row.append(idx, body, acts);
        listWrap.append(row);
      }
    };

    // Show category filter tabs only once the catalog grows beyond 4 labs.
    if (labs.length > 4) {
      const tabBar = document.createElement("div");
      tabBar.className = "tabs glp__tabs";
      tabBar.setAttribute("role", "tablist");
      tabBar.setAttribute("aria-label", "Filter guided labs");
      const btns: HTMLButtonElement[] = [];
      const selectFilter = (next: FilterKey, focusBtn = false) => {
        this.filter = next;
        btns.forEach((btn, i) => {
          const on = FILTERS[i] === this.filter;
          btn.setAttribute("aria-selected", String(on));
          btn.tabIndex = on ? 0 : -1;
          if (on && focusBtn) btn.focus();
        });
        listWrap.scrollTop = 0;
        renderList();
      };
      for (const f of FILTERS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tabs__tab";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(f === this.filter));
        b.tabIndex = f === this.filter ? 0 : -1;
        b.textContent = f;
        b.addEventListener("click", () => selectFilter(f));
        b.addEventListener("keydown", e => {
          const cur = FILTERS.indexOf(f);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            selectFilter(FILTERS[(cur + 1) % FILTERS.length], true);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            selectFilter(FILTERS[(cur + FILTERS.length - 1) % FILTERS.length], true);
          } else if (e.key === "Home") {
            e.preventDefault();
            selectFilter(FILTERS[0], true);
          } else if (e.key === "End") {
            e.preventDefault();
            selectFilter(FILTERS[FILTERS.length - 1], true);
          }
        });
        btns.push(b);
        tabBar.append(b);
      }
      card.append(tabBar);
    }

    renderList();
    card.append(listWrap);

    const foot = document.createElement("div");
    foot.className = "glp__foot";
    const note = document.createElement("span");
    note.textContent = "Browser-local progress · export ZIP or print report from any lab";
    const link = document.createElement("a");
    link.href = "https://github.com/fronkt/solidify/tree/main/docs/labs";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Course worksheets & instructor key ↗";
    foot.append(note, link);
    card.append(foot);

    wrap.append(card);
    wrap.addEventListener("click", e => {
      if (e.target === wrap) this.close(true);
    });

    const onKey = (e: KeyboardEvent) => {
      if (!wrap.isConnected) {
        this.cleanupKey();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.close(true);
        return;
      }
      if (e.key !== "Tab") return;
      const list = tabbables(card);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (i < 0 || (e.shiftKey ? i === 0 : i === list.length - 1)) {
        e.preventDefault();
        (e.shiftKey ? list[list.length - 1] : list[0]).focus();
      }
    };
    this.onKey = onKey;
    window.addEventListener("keydown", onKey);

    document.getElementById("app")!.append(wrap);
    this.wrap = wrap;
    closeB.focus({ preventScroll: true });
  }

  close(restoreFocus = true): void {
    this.cleanupKey();
    if (this.wrap) {
      this.wrap.remove();
      this.wrap = null;
    }
    if (restoreFocus && this.opener && this.opener.isConnected && this.opener.getClientRects().length > 0) {
      this.opener.focus({ preventScroll: true });
    }
    this.opener = null;
  }

  private cleanupKey(): void {
    if (this.onKey) {
      window.removeEventListener("keydown", this.onKey);
      this.onKey = null;
    }
  }
}
