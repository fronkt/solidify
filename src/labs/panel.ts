import type {
  LabCaptureMap,
  LabDef,
  LabId,
  LabStepDef,
  LabTableCol,
  LabTableRow,
  RunnerViewState,
  SkipReason,
  StepProgress,
} from "./types";
import { panelHead, pill, plotModal } from "../design/panel";
import { LearnLayer, isLearnOn, onLearnChange } from "../learn";
import { panelText } from "../learn/panels";

export interface GuidedLabPanelHost {
  labs(): readonly LabDef[];
  state(): RunnerViewState;
  subscribe(fn: (s: RunnerViewState) => void): () => void;
  startLab(idOrHash: LabId | number, opts?: { restart?: boolean }): Promise<void> | void;
  exitLab(): void;
  nextStep(): boolean;
  selectStep(index: number): void;
  skipStep(reason?: SkipReason): void;
  resetSetup(): Promise<void> | void;
  openPicker(): void;
  reveal(target: string): void;
  clearReveals(): void;
  exportZip(): Promise<void> | void;
  hideRail?(): void;
}

const FALLBACK_LEARN =
  "Guided labs step through hands-on solidification experiments with live physics checks and recorded data. " +
  "Each step unlocks directly from the simulation state and exports cleanly into a lab report ZIP.";

const TOP_ANCHOR_IDS = ["head", "views", "scalebar", "thermbar", "sembar"] as const;
const REVEAL_TIMEOUT_MS = 4000;

/** Render text with backticked on-screen control names promoted to bright `<b>` elements safely. */
function renderRich(parent: HTMLElement, text: string): void {
  parent.textContent = "";
  const re = /`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parent.append(document.createTextNode(text.slice(last, idx)));
    const b = document.createElement("b");
    b.textContent = m[1];
    parent.append(b);
    last = idx + m[0].length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

/** Format a single data cell; empty/null values always print the lone empty-value glyph `—`. */
function fmtCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (Number.isInteger(v)) return String(v);
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(1);
    if (abs >= 10) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    return v.toPrecision(3);
  }
  return String(v);
}

/** Extract a concise single-value headline readout for a completed step row or latched subgoal. */
function headlineCapture(cap: LabCaptureMap | undefined, depth = 0): string {
  if (!cap) return "";
  const num = (k: string) => {
    const v = cap[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const sdas = num("sdasUm") ?? num("lambda2Um");
  if (sdas !== null) return `λ₂ ${fmtCell(sdas)} µm`;
  const sy = num("sigmaAfter") ?? num("sigmaY_MPa");
  if (sy !== null) return `σ_y ${fmtCell(sy)} MPa`;
  const twins = num("twinsSpawned");
  if (twins !== null && twins > 0) return `${Math.round(twins)} twins`;
  const dBar = num("dAfterUm") ?? num("dBarUm");
  if (dBar !== null) return `d̄ ${fmtCell(dBar)} µm`;
  const ratio = num("ratioD2D3") ?? num("ratio");
  if (ratio !== null) return `d₂/d₃ ${ratio.toFixed(2)}`;
  const q = num("Q_K");
  if (q !== null) return `Q ${fmtCell(q)} K`;
  const dt = num("dTL_K");
  if (dt !== null) return `ΔT_L ${fmtCell(dt)} K`;
  const pPure = num("pPureAtm");
  if (pPure !== null) return `${fmtCell(pPure)} atm`;
  const um = num("umPerCell");
  if (um !== null) return `${fmtCell(um)} µm/cell`;
  const fsPct = num("fracSolidPct");
  if (fsPct !== null) return `fs ${Math.round(fsPct)} %`;
  const fs = num("fracSolid");
  if (fs !== null) return `fs ${Math.round(fs * 100)} %`;
  if (typeof cap.pair === "string" && cap.pair) return cap.pair;
  if (typeof cap.verdict === "string" && cap.verdict) return cap.verdict;
  if (typeof cap.material === "string" && cap.material) return cap.material;
  if (depth === 0) {
    const nested = Object.values(cap).filter(
      (v): v is LabCaptureMap => v !== null && typeof v === "object" && !Array.isArray(v),
    );
    for (let i = nested.length - 1; i >= 0; i--) {
      const hit = headlineCapture(nested[i], 1);
      if (hit) return hit;
    }
  }
  return "";
}

/** Parse a `X % / Y %` fraction from a live hint for the 2 px achromatic progress bar, or null. */
function parseHintProgress(hint: string | null): number | null {
  if (!hint) return null;
  const m = /(\d+(?:\.\d+)?)\s*%\s*\/\s*(\d+(?:\.\d+)?)\s*%/.exec(hint);
  if (!m) return null;
  const cur = Number(m[1]);
  const tgt = Number(m[2]);
  if (!(tgt > 0) || !Number.isFinite(cur)) return null;
  return Math.max(0, Math.min(1, cur / tgt));
}

function isWarnHint(hint: string | null): boolean {
  if (!hint) return false;
  return /^(undercooling changed|melt has no seeds|TRUE 3D unavailable|warning:)/i.test(hint.trim());
}

function isVisibleEl(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function buildMarkdownTable(lab: LabDef, rows: LabTableRow[]): string {
  const headers = ["Run", ...lab.columns.map(c => (c.unit ? `${c.label} (${c.unit})` : c.label))];
  const sep = headers.map((_, i) => (i === 0 ? "---" : "---:"));
  const body = rows.map(r => {
    const name = r.group ? `${r.group} · ${r.label}` : r.label;
    const cells = [name, ...lab.columns.map(c => fmtCell(r.values[c.key]))];
    return `| ${cells.join(" | ")} |`;
  });
  return [`# ${lab.title}`, "", `| ${headers.join(" | ")} |`, `| ${sep.join(" | ")} |`, ...body, ""].join("\n");
}

function buildCsvTable(lab: LabDef, rows: LabTableRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const headers = ["run", ...lab.columns.map(c => (c.unit ? `${c.label} (${c.unit})` : c.label))];
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) {
    const name = r.group ? `${r.group} · ${r.label}` : r.label;
    const vals = [name, ...lab.columns.map(c => {
      const raw = r.values[c.key];
      return raw === null || raw === undefined ? "" : String(raw);
    })];
    lines.push(vals.map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

/**
 * Companion `#guidedLab` tracker (`z-index: 31`, NOT a `.modepanel`).
 * Dynamically mounted inside `#app` only while a lab is active, and removed
 * completely on exit so idle `/app/` leaves `#app.children` byte-identical.
 */
export class GuidedLabPanel {
  private root: HTMLElement | null = null;
  private tab: "steps" | "data" = "steps";
  private userCollapsed: boolean | null = null;
  private lastAutoReason = "";
  private expandedTakeaways = new Set<string>();
  private lastCompletedId: string | null = null;
  private prevStatuses = new Map<string, string>();
  private lastStructKey = "";
  private lastLabId: string | null = null;
  private lastStepId: string | null = null;
  private revealIdx = 0;
  private revealTimer: number | null = null;
  private revealCleanup: (() => void) | null = null;
  private dataModal: { close(): void } | null = null;
  private exportStatusMsg = "";
  private exportStatusTimer: number | null = null;

  // Live DOM patch targets (updated at 4 Hz without rebuilding buttons or losing focus)
  private stripIdEl: HTMLElement | null = null;
  private stripProgEl: HTMLElement | null = null;
  private stripShortEl: HTMLElement | null = null;
  private stripGoalEl: HTMLElement | null = null;
  private stripMarkEl: HTMLElement | null = null;
  private liveHintWrap: HTMLElement | null = null;
  private liveHintText: HTMLElement | null = null;
  private liveHintBar: HTMLElement | null = null;
  private liveHintFill: HTMLElement | null = null;
  private dataTabBtn: HTMLButtonElement | null = null;
  private liveRegion: HTMLElement | null = null;
  private exportStatusEl: HTMLElement | null = null;

  // Coexistence observers (created on mount, torn down on unmount)
  private resizeObs: ResizeObserver | null = null;
  private appObs: MutationObserver | null = null;
  private bodyObs: MutationObserver | null = null;
  private resultsObs: MutationObserver | null = null;
  private sliceObs: MutationObserver | null = null;
  private composerObs: MutationObserver | null = null;
  private onWinResize: (() => void) | null = null;
  private learn = new LearnLayer(() => this.learn.apply());
  private unsubRunner: () => void;
  private unsubLearn: () => void;

  constructor(private host: GuidedLabPanelHost) {
    this.unsubRunner = this.host.subscribe(st => this.onState(st));
    this.unsubLearn = onLearnChange(() => {
      if (this.root) this.learn.apply();
    });
    this.onState(this.host.state());
  }

  isMounted(): boolean {
    return !!this.root && this.root.isConnected;
  }

  element(): HTMLElement | null {
    return this.root;
  }

  sync(): void {
    this.onState(this.host.state());
  }

  destroy(): void {
    this.unsubRunner();
    this.unsubLearn();
    this.unmount();
  }

  // ---------------------------------------------------------------- lifecycle

  private mount(): HTMLElement {
    if (this.root && this.root.isConnected) return this.root;
    const el = document.createElement("aside");
    el.id = "guidedLab";
    el.className = "plate tpanel show";
    el.setAttribute("aria-label", "guided lab");
    el.addEventListener("animationend", () => el.classList.remove("pulse"));
    document.getElementById("app")!.append(el);
    this.root = el;
    this.installObservers();
    return el;
  }

  private unmount(): void {
    this.clearReveal();
    this.dataModal?.close();
    this.dataModal = null;
    if (this.exportStatusTimer !== null) {
      window.clearTimeout(this.exportStatusTimer);
      this.exportStatusTimer = null;
    }
    this.teardownObservers();
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.clearLiveRefs();
    this.lastStructKey = "";
    this.lastLabId = null;
    this.lastStepId = null;
    this.userCollapsed = null;
    this.lastAutoReason = "";
    this.prevStatuses.clear();
    this.expandedTakeaways.clear();
    this.lastCompletedId = null;
  }

  private clearLiveRefs(): void {
    this.stripIdEl = null;
    this.stripProgEl = null;
    this.stripShortEl = null;
    this.stripGoalEl = null;
    this.stripMarkEl = null;
    this.liveHintWrap = null;
    this.liveHintText = null;
    this.liveHintBar = null;
    this.liveHintFill = null;
    this.dataTabBtn = null;
    this.liveRegion = null;
    this.exportStatusEl = null;
  }

  // -------------------------------------------------------------- coexistence

  private installObservers(): void {
    this.teardownObservers();
    const sync = () => this.syncCoexistence();
    this.onWinResize = sync;
    window.addEventListener("resize", sync);

    this.resizeObs = new ResizeObserver(sync);
    for (const id of TOP_ANCHOR_IDS) {
      const node = document.getElementById(id);
      if (node) this.resizeObs.observe(node);
    }
    const rail = document.getElementById("rail");
    if (rail) this.resizeObs.observe(rail);

    this.bodyObs = new MutationObserver(sync);
    this.bodyObs.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    const appEl = document.getElementById("app");
    if (appEl) {
      this.appObs = new MutationObserver(() => {
        this.bindResultsObserver();
        sync();
      });
      this.appObs.observe(appEl, { childList: true });
    }
    this.bindResultsObserver();

    const sliceEl = document.getElementById("slicePop");
    if (sliceEl) {
      this.sliceObs = new MutationObserver(sync);
      this.sliceObs.observe(sliceEl, { attributes: true, attributeFilter: ["style", "class"] });
    }

    const composerEl = document.getElementById("composer");
    if (composerEl) {
      this.composerObs = new MutationObserver(sync);
      this.composerObs.observe(composerEl, { attributes: true, attributeFilter: ["class"] });
    }
    sync();
  }

  private bindResultsObserver(): void {
    this.resultsObs?.disconnect();
    this.resultsObs = null;
    const res = document.getElementById("foundryResults");
    if (res) {
      this.resultsObs = new MutationObserver(() => this.syncCoexistence());
      this.resultsObs.observe(res, { attributes: true, attributeFilter: ["class"] });
    }
  }

  private teardownObservers(): void {
    if (this.onWinResize) {
      window.removeEventListener("resize", this.onWinResize);
      this.onWinResize = null;
    }
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.appObs?.disconnect();
    this.appObs = null;
    this.bodyObs?.disconnect();
    this.bodyObs = null;
    this.resultsObs?.disconnect();
    this.resultsObs = null;
    this.sliceObs?.disconnect();
    this.sliceObs = null;
    this.composerObs?.disconnect();
    this.composerObs = null;
  }

  private syncCoexistence(): void {
    const el = this.root;
    if (!el || !el.isConnected) return;

    const narrow = document.body.classList.contains("narrow");
    const railPhone = document.body.classList.contains("railPhone");
    const railHidden = document.body.classList.contains("railHidden");
    const railEl = document.getElementById("rail");
    const railW = !railHidden && railEl ? railEl.offsetWidth : 0;
    const freeW = window.innerWidth - railW;

    const composerEl = document.getElementById("composer");
    const composerOpen = !!composerEl && composerEl.classList.contains("show");
    const sliceVisible = isVisibleEl(document.getElementById("slicePop"));
    const resultsEl = document.getElementById("foundryResults");
    const resultsVisible = !!resultsEl && !resultsEl.classList.contains("hidden");
    const modepanel = document.querySelector<HTMLElement>("#app > .modepanel");
    const modepanelVisible = isVisibleEl(modepanel);
    const modepanelRect = modepanelVisible && modepanel ? modepanel.getBoundingClientRect() : null;

    // Fallback top-chrome clearance for browsers without CSS anchor positioning.
    let topBottom = 54;
    for (const id of TOP_ANCHOR_IDS) {
      if (id === "views" && !narrow) continue;
      const node = document.getElementById(id);
      if (isVisibleEl(node)) topBottom = Math.max(topBottom, node!.getBoundingClientRect().bottom);
    }
    const labTop = Math.ceil(topBottom + 8);
    el.style.setProperty("--lab-top", `${labTop}px`);
    const availH = window.innerHeight - 62 - labTop;

    // Exact auto-collapse reasons (free_w < 614 matches .modepanel's --over formula;
    // modepanelRect.left < 298 catches any measured collision margin regardless of rail width).
    const reasons: string[] = [];
    if (railPhone) reasons.push("railPhone");
    if (window.innerWidth <= 760) reasons.push("phone");
    if (composerOpen && window.innerWidth <= 760) reasons.push("composer-narrow");
    if (sliceVisible) reasons.push("slice");
    if (resultsVisible) reasons.push("results");
    if (modepanelVisible && (narrow || freeW < 614 || (modepanelRect !== null && modepanelRect.left < 298))) {
      reasons.push("modepanel-lift");
    }
    if (!composerOpen && availH < 180) reasons.push("short");

    const reasonKey = reasons.join(",");
    if (reasonKey !== this.lastAutoReason) {
      this.lastAutoReason = reasonKey;
      this.userCollapsed = null;
    }

    const wantAuto = reasons.length > 0;
    const collapsed = railPhone ? true : this.userCollapsed !== null ? this.userCollapsed : wantAuto;
    el.classList.toggle("collapsed", collapsed);
    el.classList.toggle("manual-open", !collapsed && reasons.includes("short"));
  }

  // ------------------------------------------------------------------ state

  private onState(st: RunnerViewState): void {
    const lab = st.activeLab;
    const session = st.session;
    if (!lab || !session) {
      this.unmount();
      return;
    }

    const labChanged = this.lastLabId !== lab.id;
    if (labChanged) {
      this.lastLabId = lab.id;
      this.tab = "steps";
      this.userCollapsed = null;
      this.expandedTakeaways.clear();
      this.lastCompletedId = null;
      this.prevStatuses.clear();
      this.revealIdx = 0;
      this.clearReveal();
      for (const s of lab.steps) {
        this.prevStatuses.set(s.id, session.steps[s.id]?.status ?? "pending");
      }
    }

    // Detect newly completed step transitions for takeaway auto-reveal + pulse + live region.
    let newlyCompleted: LabStepDef | null = null;
    if (!labChanged) {
      for (const s of lab.steps) {
        const cur = session.steps[s.id]?.status ?? "pending";
        const prev = this.prevStatuses.get(s.id);
        if (prev && prev !== "completed" && cur === "completed") {
          newlyCompleted = s;
        }
        this.prevStatuses.set(s.id, cur);
      }
    }

    const stepId = st.activeStep?.id ?? null;
    if (stepId !== this.lastStepId) {
      this.lastStepId = stepId;
      this.revealIdx = 0;
      this.clearReveal();
    }

    if (newlyCompleted) {
      this.lastCompletedId = newlyCompleted.id;
      this.clearReveal();
    }

    const root = this.mount();
    const structKey = this.computeStructKey(st);
    if (structKey !== this.lastStructKey) {
      this.lastStructKey = structKey;
      this.renderStructure(root, st);
    }
    this.patchLive(st, newlyCompleted);
    this.syncCoexistence();
  }

  private computeStructKey(st: RunnerViewState): string {
    const lab = st.activeLab!;
    const session = st.session!;
    const stepsSig = lab.steps
      .map(s => {
        const p = session.steps[s.id];
        const subKeys = Object.keys(p?.subgoals ?? {}).sort().join(",");
        const capVal = headlineCapture(p?.captures);
        const exp = this.expandedTakeaways.has(s.id) || this.lastCompletedId === s.id ? "1" : "0";
        return `${s.id}:${p?.status ?? "pending"}:${p?.skipReason ?? ""}:${subKeys}:${capVal}:${exp}`;
      })
      .join("|");
    const rowsSig = st.tableRows
      .map(r => `${r.group ?? ""}:${r.label}:${lab.columns.map(c => fmtCell(r.values[c.key])).join(",")}`)
      .join("|");
    return [
      lab.id,
      st.activeStepIndex,
      this.tab,
      st.can3d ? "3d" : "2d",
      isLearnOn() ? "L1" : "L0",
      stepsSig,
      rowsSig,
    ].join("#");
  }

  // ----------------------------------------------------------------- render

  private renderStructure(root: HTMLElement, st: RunnerViewState): void {
    const lab = st.activeLab!;
    const session = st.session!;
    const total = lab.steps.length;
    const completedCount = lab.steps.filter(s => session.steps[s.id]?.status === "completed").length;
    const finishedCount = lab.steps.filter(s => {
      const status = session.steps[s.id]?.status;
      return status === "completed" || status === "skipped";
    }).length;
    const allDone = finishedCount >= total && total > 0;

    root.textContent = "";
    this.clearLiveRefs();

    // ---- compact 28px live strip (shown when .collapsed or body.railPhone)
    const strip = document.createElement("div");
    strip.className = "gl__strip";
    strip.addEventListener("click", () => this.expandFromStrip());

    const sId = document.createElement("span");
    sId.className = "gl__strip-id";
    sId.textContent = `LAB ${lab.hashId}`;

    const sProg = document.createElement("span");
    sProg.className = "gl__strip-prog";
    sProg.textContent = `${completedCount}/${total}`;

    const sShort = document.createElement("span");
    sShort.className = "gl__strip-short";
    sShort.textContent = `lab ${completedCount}/${total}`;

    const sGoal = document.createElement("span");
    sGoal.className = "gl__strip-goal";
    sGoal.textContent = allDone ? "lab complete" : st.activeStep?.title ?? lab.title;

    const sMark = document.createElement("span");
    sMark.className = "gl__strip-mark";
    sMark.textContent = allDone ? "✓" : "○";

    const expBtn = document.createElement("button");
    expBtn.type = "button";
    expBtn.className = "iconbtn";
    expBtn.textContent = "▴";
    expBtn.setAttribute("aria-expanded", "false");
    expBtn.setAttribute("aria-label", "expand guided lab");
    expBtn.addEventListener("click", e => {
      e.stopPropagation();
      this.expandFromStrip();
    });

    strip.append(sId, sProg, sShort, sGoal, sMark, expBtn);
    this.stripIdEl = sId;
    this.stripProgEl = sProg;
    this.stripShortEl = sShort;
    this.stripGoalEl = sGoal;
    this.stripMarkEl = sMark;

    // ---- expanded panel body
    const body = document.createElement("div");
    body.className = "gl__expanded";

    // Header (.phead): LAB N, k/5, learn "i", then collapse / labs / exit
    const meta = document.createElement("span");
    meta.className = "v";
    meta.textContent = `${completedCount}/${total}`;

    const hacts = document.createElement("span");
    hacts.className = "gl__hacts";
    const colBtn = document.createElement("button");
    colBtn.type = "button";
    colBtn.className = "iconbtn";
    colBtn.textContent = "▾";
    colBtn.title = "collapse to compact strip";
    colBtn.setAttribute("aria-expanded", "true");
    colBtn.setAttribute("aria-label", "collapse guided lab");
    colBtn.addEventListener("click", () => {
      this.userCollapsed = true;
      this.syncCoexistence();
      expBtn.focus({ preventScroll: true });
    });

    const labsBtn = pill("labs", () => this.host.openPicker(), "gl__link");
    labsBtn.title = "open guided labs catalog";
    const exitBtn = pill("exit", () => this.exitAndRestoreFocus());
    hacts.append(colBtn, labsBtn, exitBtn);

    const head = panelHead(`LAB ${lab.hashId}`, hacts, meta);
    this.learn = new LearnLayer(() => this.learn.apply());
    const learnCopy = panelText("guided lab") || FALLBACK_LEARN;
    const ex = this.learn.explain(head, "about guided labs", learnCopy, hacts);
    body.append(head, ex.body);

    // Top 2px segmented progress rail (.segs)
    const segs = document.createElement("div");
    segs.className = "segs gl__segs";
    segs.setAttribute("aria-hidden", "true");
    lab.steps.forEach((s, i) => {
      const seg = document.createElement("i");
      const status = session.steps[s.id]?.status ?? "pending";
      if (status === "completed" || status === "skipped" || (!allDone && i === st.activeStepIndex)) {
        seg.className = "is-on";
      }
      segs.append(seg);
    });
    body.append(segs);

    // Tabs row: STEPS | DATA (N) + enlarge ⤢ on DATA tab
    const tabbar = document.createElement("div");
    tabbar.className = "gl__tabbar";
    const tabs = document.createElement("div");
    tabs.className = "tabs gl__tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Guided lab sections");

    const mkTab = (id: "steps" | "data", label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tabs__tab";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(this.tab === id));
      b.textContent = label;
      b.addEventListener("click", () => {
        if (this.tab === id) return;
        this.tab = id;
        this.lastStructKey = "";
        this.onState(this.host.state());
      });
      return b;
    };
    const stepsTab = mkTab("steps", "STEPS");
    const dataTab = mkTab("data", `DATA (${st.tableRows.length})`);
    this.dataTabBtn = dataTab;
    tabs.append(stepsTab, dataTab);
    tabbar.append(tabs);

    if (this.tab === "data" && st.tableRows.length > 0) {
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "iconbtn";
      zoom.textContent = "⤢";
      zoom.title = "open full recorded data table and exports";
      zoom.setAttribute("aria-label", "open full recorded data table");
      zoom.addEventListener("click", () => this.openFullTable(lab, st.tableRows));
      tabbar.append(zoom);
    }
    body.append(tabbar);

    if (this.tab === "steps") {
      if (allDone) {
        body.append(this.buildDoneBanner(lab, completedCount, total));
      }
      body.append(this.buildStepsList(lab, st, allDone));
    } else {
      body.append(this.buildDataView(lab, st.tableRows));
    }

    // Persistent 1-row footer: export lab ZIP + reset setup
    const foot = document.createElement("div");
    foot.className = "gl__foot";
    const exportBtn = pill(
      "export lab ZIP",
      () => void this.handleExport(exportBtn),
      "gl__export" + (allDone ? " gl__export--ready" : ""),
    );
    exportBtn.title = "Download run bundle with lab-report.json";

    const resetBtn = pill(
      "reset setup",
      () => {
        this.clearReveal();
        void this.host.resetSetup();
      },
      "gl__link gl__reset",
    );
    resetBtn.title = "Re-stage this lab's starting setup without erasing finished steps";

    const status = document.createElement("div");
    status.className = "gl__status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = this.exportStatusMsg;
    this.exportStatusEl = status;

    foot.append(exportBtn, resetBtn, status);
    body.append(foot);

    // Polite screen-reader live region for step completion announcements
    const sr = document.createElement("div");
    sr.className = "sr-only";
    sr.setAttribute("role", "status");
    sr.setAttribute("aria-live", "polite");
    this.liveRegion = sr;

    root.append(strip, body, sr);
    this.learn.apply();
  }

  private buildDoneBanner(lab: LabDef, completedCount: number, total: number): HTMLElement {
    const box = document.createElement("div");
    box.className = "gl__done";
    const head = document.createElement("div");
    head.className = "gl__done-head";
    head.textContent = `✓ LAB ${lab.hashId} COMPLETE · ${completedCount}/${total}`;
    const acts = document.createElement("div");
    acts.className = "pactions";

    const labs = this.host.labs();
    const curIdx = labs.findIndex(l => l.id === lab.id);
    const nextLab = curIdx >= 0 && curIdx + 1 < labs.length ? labs[curIdx + 1] : null;
    if (nextLab) {
      acts.append(pill("next lab ▸", () => void this.host.startLab(nextLab.id)));
    }
    acts.append(pill("all labs", () => this.host.openPicker(), "gl__link"));
    box.append(head, acts);
    return box;
  }

  private buildStepsList(lab: LabDef, st: RunnerViewState, allDone: boolean): HTMLElement {
    const session = st.session!;
    const ol = document.createElement("ol");
    ol.className = "gl__steps";

    lab.steps.forEach((step, idx) => {
      const prog: StepProgress = session.steps[step.id] ?? {
        id: step.id,
        status: "pending",
        completedAt: null,
        captures: {},
        subgoals: {},
      };
      const isActive = !allDone && idx === st.activeStepIndex;
      const li = document.createElement("li");
      li.className = "gl__step" + (isActive ? " gl__step--active" : "");

      const numStr = String(idx + 1).padStart(2, "0");

      if (prog.status === "completed") {
        const showTakeaway = isActive || this.expandedTakeaways.has(step.id) || this.lastCompletedId === step.id;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gl__step-btn";
        btn.setAttribute("aria-expanded", String(showTakeaway));

        const mark = document.createElement("span");
        mark.className = "gl__idx";
        mark.textContent = "✓";
        mark.setAttribute("aria-label", "completed");

        const title = document.createElement("span");
        title.className = "gl__title";
        title.textContent = step.title;

        const val = document.createElement("span");
        val.className = "gl__val";
        val.textContent = headlineCapture(prog.captures);

        btn.append(mark, title, val);
        btn.addEventListener("click", () => {
          if (showTakeaway && !isActive) {
            this.expandedTakeaways.delete(step.id);
            if (this.lastCompletedId === step.id) this.lastCompletedId = null;
          } else {
            this.expandedTakeaways.add(step.id);
          }
          this.lastStructKey = "";
          this.onState(this.host.state());
        });
        li.append(btn);

        if (showTakeaway) {
          const take = document.createElement("div");
          take.className = "gl__takeaway";
          renderRich(take, step.takeaway);
          li.append(take);
        }

        if (isActive && idx + 1 < lab.steps.length) {
          const acts = document.createElement("div");
          acts.className = "gl__acts";
          acts.append(pill("next step ▸", () => void this.host.nextStep(), "gl__export--ready"));
          li.append(acts);
        }
      } else if (prog.status === "skipped") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gl__step-btn";
        btn.addEventListener("click", () => this.host.selectStep(idx));

        const mark = document.createElement("span");
        mark.className = "gl__idx";
        mark.textContent = "–";
        mark.setAttribute("aria-label", "skipped");

        const title = document.createElement("span");
        title.className = "gl__title";
        title.textContent = step.title;

        const val = document.createElement("span");
        val.className = "gl__val";
        val.textContent = prog.skipReason === "no-3d" ? "no 3D" : "skipped";

        btn.append(mark, title, val);
        li.append(btn);
      } else if (isActive) {
        const row = document.createElement("div");
        row.className = "gl__step-row";

        const idxEl = document.createElement("span");
        idxEl.className = "gl__idx";
        idxEl.textContent = numStr;

        const title = document.createElement("span");
        title.className = "gl__title";
        title.textContent = step.title;

        row.append(idxEl, title);
        li.append(row);

        const action = document.createElement("div");
        action.className = "gl__action";
        renderRich(action, step.action);
        li.append(action);

        // Multi-part contrast subgoals
        if (step.subgoals && step.subgoals.length > 0) {
          const sgWrap = document.createElement("div");
          sgWrap.className = "gl__subgoals";
          for (const sg of step.subgoals) {
            const cap = prog.subgoals[sg.id] ?? st.activeStepMemory?.latched[sg.id];
            const done = !!cap;
            const srow = document.createElement("div");
            srow.className = "gl__sub" + (done ? " is-done" : "");

            const m = document.createElement("span");
            m.className = "gl__sub-m";
            m.textContent = done ? "✓" : "○";
            m.setAttribute("aria-hidden", "true");

            const lbl = document.createElement("span");
            renderRich(lbl, sg.label);

            const v = document.createElement("span");
            v.className = "gl__sub-v";
            v.textContent = done ? headlineCapture(cap) : "";

            srow.append(m, lbl, v);
            sgWrap.append(srow);
          }
          li.append(sgWrap);
        }

        // Live hint + optional 2px progress bar (patched in place at 4 Hz)
        const hintWrap = document.createElement("div");
        hintWrap.className = "gl__hint";
        hintWrap.style.display = "none";

        const hintText = document.createElement("div");
        hintText.className = "gl__hint-row";

        const bar = document.createElement("div");
        bar.className = "gl__bar";
        bar.style.display = "none";
        const fill = document.createElement("div");
        fill.className = "gl__bar-fill";
        fill.style.width = "0%";
        bar.append(fill);

        hintWrap.append(hintText, bar);
        li.append(hintWrap);
        this.liveHintWrap = hintWrap;
        this.liveHintText = hintText;
        this.liveHintBar = bar;
        this.liveHintFill = fill;

        // 3D capability honesty notice
        const blocked3d = !!step.requires3d && !st.can3d;
        if (blocked3d) {
          const warn = document.createElement("div");
          warn.className = "gl__warn warnline";
          warn.textContent = "TRUE 3D unavailable on this GPU";
          li.append(warn);
        }

        // Action controls: opt-in show control (zero auto-flashing) + skip fallback
        const acts = document.createElement("div");
        acts.className = "gl__acts";
        if (step.reveal && step.reveal.length > 0 && !blocked3d) {
          const showBtn = pill("show control", () => this.triggerReveal(step));
          if (step.reveal.length > 1) {
            showBtn.title = "Highlight target control (click again for next)";
          }
          acts.append(showBtn);
        }
        const skipBtn = pill(
          blocked3d ? "skip 3D step" : "skip step",
          () => this.host.skipStep(blocked3d ? "no-3d" : "user"),
          "gl__link",
        );
        acts.append(skipBtn);
        li.append(acts);
      } else {
        // Upcoming pending step: quiet single-line button (--fg-3, never --fg-4)
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gl__step-btn";
        btn.addEventListener("click", () => this.host.selectStep(idx));

        const idxEl = document.createElement("span");
        idxEl.className = "gl__idx";
        idxEl.textContent = numStr;

        const title = document.createElement("span");
        title.className = "gl__title";
        title.textContent = step.title;

        btn.append(idxEl, title);
        li.append(btn);
      }

      ol.append(li);
    });

    return ol;
  }

  private buildDataView(lab: LabDef, rows: LabTableRow[]): HTMLElement {
    const box = document.createElement("div");
    box.className = "gl__data";
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gl__empty";
      empty.textContent = "No readings captured yet.";
      box.append(empty);
      return box;
    }

    const wrap = document.createElement("div");
    wrap.className = "gl__tablewrap";
    const table = document.createElement("table");
    table.className = "ptable";

    // Transpose 2-run wide comparisons into a 3-column spec table (`metric | run A | run B`)
    // so it fits cleanly inside the 266px side-by-side width without horizontal scroll.
    if (rows.length === 2 && lab.columns.length > 3) {
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      for (const [i, label] of ["metric", rows[0].label, rows[1].label].entries()) {
        const th = document.createElement("th");
        if (i > 0) th.className = "num";
        th.textContent = label;
        htr.append(th);
      }
      thead.append(htr);
      table.append(thead);

      const tbody = document.createElement("tbody");
      for (const col of lab.columns) {
        const v0 = rows[0].values[col.key];
        const v1 = rows[1].values[col.key];
        if ((v0 === null || v0 === undefined) && (v1 === null || v1 === undefined)) continue;
        const tr = document.createElement("tr");
        const k = document.createElement("td");
        k.className = "txt";
        k.textContent = col.unit ? `${col.label} (${col.unit})` : col.label;
        const c0 = document.createElement("td");
        c0.className = typeof v0 === "number" ? "v" : "txt";
        c0.textContent = fmtCell(v0);
        const c1 = document.createElement("td");
        c1.className = typeof v1 === "number" ? "v" : "txt";
        c1.textContent = fmtCell(v1);
        tr.append(k, c0, c1);
        tbody.append(tr);
      }
      table.append(tbody);
    } else {
      // Compact table: show label + up to 3 most-populated columns; full columns live in ⤢ modal.
      const cols = this.pickCompactColumns(lab.columns, rows, 3);
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      const th0 = document.createElement("th");
      th0.textContent = "run";
      htr.append(th0);
      for (const col of cols) {
        const th = document.createElement("th");
        th.className = "num";
        th.textContent = col.unit ? `${col.label} (${col.unit})` : col.label;
        htr.append(th);
      }
      thead.append(htr);
      table.append(thead);

      const tbody = document.createElement("tbody");
      for (const r of rows) {
        const tr = document.createElement("tr");
        const td0 = document.createElement("td");
        td0.className = "txt";
        td0.textContent = r.label;
        tr.append(td0);
        for (const col of cols) {
          const raw = r.values[col.key];
          const td = document.createElement("td");
          td.className = typeof raw === "number" ? "v" : "txt";
          td.textContent = fmtCell(raw);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
    }

    wrap.append(table);
    box.append(wrap);
    return box;
  }

  private pickCompactColumns(cols: LabTableCol[], rows: LabTableRow[], maxCols: number): LabTableCol[] {
    if (cols.length <= maxCols) return cols;
    const scored = cols.map((col, idx) => ({
      col,
      idx,
      filled: rows.reduce((n, r) => n + (r.values[col.key] !== null && r.values[col.key] !== undefined ? 1 : 0), 0),
    }));
    const kept = scored
      .filter(s => s.filled > 0)
      .sort((a, b) => b.filled - a.filled || a.idx - b.idx)
      .slice(0, maxCols)
      .sort((a, b) => a.idx - b.idx)
      .map(s => s.col);
    return kept.length > 0 ? kept : cols.slice(0, maxCols);
  }

  /** Fast 4 Hz in-place patch that never destroys DOM buttons or active keyboard focus. */
  private patchLive(st: RunnerViewState, newlyCompleted: LabStepDef | null): void {
    const lab = st.activeLab;
    const session = st.session;
    if (!lab || !session) return;

    const total = lab.steps.length;
    const completed = lab.steps.filter(s => session.steps[s.id]?.status === "completed").length;
    const finished = lab.steps.filter(s => {
      const k = session.steps[s.id]?.status;
      return k === "completed" || k === "skipped";
    }).length;
    const allDone = finished >= total && total > 0;

    const activeDone = st.activeStep ? session.steps[st.activeStep.id]?.status === "completed" : false;
    if (this.stripIdEl) this.stripIdEl.textContent = `LAB ${lab.hashId}`;
    if (this.stripProgEl) this.stripProgEl.textContent = `${completed}/${total}`;
    if (this.stripShortEl) this.stripShortEl.textContent = `lab ${completed}/${total}`;
    if (this.stripGoalEl) {
      this.stripGoalEl.textContent = allDone
        ? "lab complete"
        : activeDone
          ? `done: ${st.activeStep?.title ?? ""}`
          : st.activeStep?.title ?? lab.title;
    }
    if (this.stripMarkEl) this.stripMarkEl.textContent = allDone || activeDone ? "✓" : "○";
    if (this.dataTabBtn) this.dataTabBtn.textContent = `DATA (${st.tableRows.length})`;

    if (this.liveHintWrap && this.liveHintText) {
      const hint = st.liveHint;
      if (hint) {
        this.liveHintWrap.style.display = "";
        this.liveHintText.classList.toggle("warnline", isWarnHint(hint));
        renderRich(this.liveHintText, hint);
        const frac = parseHintProgress(hint);
        if (this.liveHintBar && this.liveHintFill) {
          if (frac !== null) {
            this.liveHintBar.style.display = "";
            this.liveHintFill.style.width = `${(frac * 100).toFixed(1)}%`;
          } else {
            this.liveHintBar.style.display = "none";
          }
        }
      } else {
        this.liveHintWrap.style.display = "none";
      }
    }

    if (newlyCompleted && this.root) {
      this.root.classList.remove("pulse");
      void this.root.offsetWidth;
      this.root.classList.add("pulse");
      if (this.liveRegion) {
        this.liveRegion.textContent = `Step complete: ${newlyCompleted.title}. ${newlyCompleted.takeaway}`;
      }
    }
  }

  // ---------------------------------------------------------------- actions

  private expandFromStrip(): void {
    if (document.body.classList.contains("railPhone")) {
      if (this.host.hideRail) this.host.hideRail();
      else if (!document.body.classList.contains("railHidden")) {
        document.getElementById("railToggle")?.click();
      }
      // Re-sync auto-collapse reasons after hiding the phone rail so the
      // railPhone -> phone transition does not clear userCollapsed below.
      this.syncCoexistence();
    }
    this.userCollapsed = false;
    this.syncCoexistence();
  }

  private exitAndRestoreFocus(): void {
    this.host.exitLab();
    const labsBtn = document.getElementById("labsBtn");
    if (labsBtn && isVisibleEl(labsBtn)) labsBtn.focus({ preventScroll: true });
  }

  private triggerReveal(step: LabStepDef): void {
    const targets = step.reveal;
    if (!targets || targets.length === 0) return;
    this.clearReveal();

    let target = targets[this.revealIdx % targets.length];
    this.revealIdx++;

    const composerEl = document.getElementById("composer");
    const composerOpen = !!composerEl && composerEl.classList.contains("show");
    if (target.startsWith("#composer") && !composerOpen) {
      target = "sec:ALLOY";
    }

    if (target.startsWith("#composer") && composerOpen) {
      const hit = document.querySelector<HTMLElement>(target);
      if (hit) {
        hit.scrollIntoView({ block: "nearest", behavior: "smooth" });
        hit.classList.add("hl");
      }
    } else {
      this.host.reveal(target);
    }

    // Auto-clear highlight on first user interaction with highlighted nodes or after 4 s.
    const highlighted = [...document.querySelectorAll<HTMLElement>(".hl")];
    const onInteract = () => this.clearReveal();
    const events = ["pointerdown", "input", "change"] as const;
    for (const el of highlighted) {
      for (const ev of events) el.addEventListener(ev, onInteract, { capture: true, once: true });
    }
    this.revealCleanup = () => {
      for (const el of highlighted) {
        for (const ev of events) el.removeEventListener(ev, onInteract, true);
      }
    };
    this.revealTimer = window.setTimeout(() => this.clearReveal(), REVEAL_TIMEOUT_MS);
  }

  private clearReveal(): void {
    if (this.revealTimer !== null) {
      window.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    if (this.revealCleanup) {
      this.revealCleanup();
      this.revealCleanup = null;
    }
    this.host.clearReveals();
  }

  private async handleExport(btn: HTMLButtonElement): Promise<void> {
    if (btn.disabled) return;
    const prev = btn.textContent ?? "export lab ZIP";
    btn.disabled = true;
    btn.textContent = "exporting…";
    try {
      await this.host.exportZip();
      this.setExportStatus("exported lab ZIP");
    } catch {
      this.setExportStatus("export failed");
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  private setExportStatus(msg: string): void {
    this.exportStatusMsg = msg;
    if (this.exportStatusEl) this.exportStatusEl.textContent = msg;
    if (this.exportStatusTimer !== null) window.clearTimeout(this.exportStatusTimer);
    this.exportStatusTimer = window.setTimeout(() => {
      this.exportStatusMsg = "";
      if (this.exportStatusEl) this.exportStatusEl.textContent = "";
      this.exportStatusTimer = null;
    }, 2600);
  }

  private openFullTable(lab: LabDef, rows: LabTableRow[]): void {
    this.dataModal?.close();
    const { wrap, card } = plotModal(`${lab.title} · recorded data`, () => {
      wrap.remove();
      this.dataModal = null;
    });
    this.dataModal = { close: () => wrap.remove() };

    const wrapTable = document.createElement("div");
    wrapTable.className = "figmodal__table";
    wrapTable.tabIndex = 0;

    const table = document.createElement("table");
    table.className = "dtable";

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.className = "txt";
    th0.textContent = "Run";
    htr.append(th0);
    for (const col of lab.columns) {
      const th = document.createElement("th");
      th.textContent = col.unit ? `${col.label} (${col.unit})` : col.label;
      htr.append(th);
    }
    thead.append(htr);
    table.append(thead);

    const tbody = document.createElement("tbody");
    for (const r of rows) {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.className = "txt";
      td0.textContent = r.group ? `${r.group} · ${r.label}` : r.label;
      tr.append(td0);
      for (const col of lab.columns) {
        const raw = r.values[col.key];
        const td = document.createElement("td");
        if (typeof raw === "string") td.className = "txt";
        td.textContent = fmtCell(raw);
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrapTable.append(table);

    const bar = document.createElement("div");
    bar.className = "pactions figmodal__bar";

    const copyBtn = pill("copy markdown", () => {
      void navigator.clipboard.writeText(buildMarkdownTable(lab, rows)).then(() => {
        copyBtn.textContent = "copied";
        window.setTimeout(() => {
          copyBtn.textContent = "copy markdown";
        }, 1400);
      });
    });

    const csvBtn = pill("export CSV", () => {
      const blob = new Blob([buildCsvTable(lab, rows)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `solidify-${lab.id}-data.csv`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    });

    const zipBtn = pill("export lab ZIP", () => void this.handleExport(zipBtn));
    const meta = document.createElement("span");
    meta.className = "figmodal__meta q";
    meta.textContent = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;

    bar.append(copyBtn, csvBtn, zipBtn, meta);
    card.append(wrapTable, bar);
  }
}
