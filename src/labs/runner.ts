/**
 * GuidedLabRunner — pure state machine for SOLIDIFY's in-app Guided Labs mode.
 *
 * Manages active lab/step selection, 4 Hz polling + push event evaluation,
 * per-step completion latching, skip tracking, sessionStorage persistence,
 * subscriber notifications, and `lab-report.json` assembly.
 *
 * Safe to run under both browser and Node CI (guards `sessionStorage`).
 */

import { LABS, findLabDef } from "./labs";
import type {
  GuidedLabReport,
  GuidedLabReportStep,
  LabCaptureMap,
  LabDef,
  LabEvent,
  LabId,
  LabProgressSummary,
  LabRunnerHost,
  LabSessionState,
  LabSnapshot,
  LabStepDef,
  RunnerViewState,
  SkipReason,
  StepMemory,
  StepProgress,
} from "./types";

export const LAB_STORAGE_KEY = "solidify.guidedLab.v1";

interface PersistedSessions {
  version: 1;
  sessions: Record<LabId, LabSessionState>;
}

function getStorage(): Storage | null {
  try {
    return typeof globalThis !== "undefined" && "sessionStorage" in globalThis && globalThis.sessionStorage
      ? globalThis.sessionStorage
      : null;
  } catch {
    return null;
  }
}

function makeFreshSession(lab: LabDef): LabSessionState {
  const steps: Record<string, StepProgress> = {};
  for (const st of lab.steps) {
    steps[st.id] = {
      id: st.id,
      status: "pending",
      completedAt: null,
      captures: {},
      subgoals: {},
    };
  }
  return {
    labId: lab.id,
    hashId: lab.hashId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    activeStepIndex: 0,
    anyIntervened: false,
    steps,
  };
}

function cloneMap(m: LabCaptureMap): LabCaptureMap {
  return { ...m };
}

export class GuidedLabRunner {
  private readonly catalog: readonly LabDef[];
  private readonly host: LabRunnerHost;
  private sessions: Record<LabId, LabSessionState> = {};
  private activeLab: LabDef | null = null;
  private stepMemory = new Map<string, StepMemory>();
  private listeners = new Set<(state: RunnerViewState) => void>();
  private lastSnapshot: LabSnapshot | null = null;
  private lastHint: string | null = null;
  private lastCan3d = false;

  constructor(host: LabRunnerHost, catalog: readonly LabDef[] = LABS) {
    this.host = host;
    this.catalog = catalog;
    this.loadStorage();
  }

  getLabs(): readonly LabDef[] {
    return this.catalog;
  }

  findLab(idOrHash: string | number): LabDef | null {
    return findLabDef(idOrHash, this.catalog);
  }

  isActive(): boolean {
    return this.activeLab != null;
  }

  getActiveLab(): LabDef | null {
    return this.activeLab;
  }

  getActiveHashId(): number | null {
    return this.activeLab?.hashId ?? null;
  }

  subscribe(fn: (state: RunnerViewState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Launch or resume a guided lab. Set `applySetup: false` to preserve a restored `#set=` state. */
  async startLab(
    idOrHash: string | number,
    opts: { applySetup?: boolean; restart?: boolean } = {},
  ): Promise<boolean> {
    const lab = this.findLab(idOrHash);
    if (!lab) return false;

    const existing = this.sessions[lab.id];
    const isRestart = Boolean(opts.restart) || !existing;
    if (isRestart) {
      this.sessions[lab.id] = makeFreshSession(lab);
      this.clearLabMemory(lab);
    } else {
      this.ensureSessionSteps(lab, existing);
    }

    this.activeLab = lab;
    this.host.clearReveals?.();

    if (opts.applySetup !== false) {
      await lab.setup(this.host);
    }

    const snap = this.safeSnapshot();
    this.lastSnapshot = snap;
    this.lastCan3d = snap?.can3d ?? false;

    const session = this.sessions[lab.id];
    const step = lab.steps[session.activeStepIndex];
    if (step) this.initStepMemory(lab, step, snap, true);

    this.saveStorage();
    this.host.onLabChange?.(lab.hashId);
    this.emitState();
    return true;
  }

  /** Close the active dock while keeping session progress in memory and sessionStorage. */
  closeLab(): void {
    if (!this.activeLab) return;
    this.host.clearReveals?.();
    this.activeLab = null;
    this.lastHint = null;
    this.host.onLabChange?.(null);
    this.emitState();
  }

  /** Jump to any step index in the active lab (e.g. revisit a completed takeaway). */
  selectStep(index: number): void {
    const lab = this.activeLab;
    if (!lab) return;
    const session = this.sessions[lab.id];
    if (!session) return;
    const clamped = Math.max(0, Math.min(lab.steps.length - 1, index));
    if (clamped === session.activeStepIndex) return;

    this.host.clearReveals?.();
    session.activeStepIndex = clamped;
    const snap = this.safeSnapshot();
    this.lastSnapshot = snap;
    const step = lab.steps[clamped];
    if (step) this.initStepMemory(lab, step, snap, false);

    this.saveStorage();
    this.emitState();
  }

  nextStep(): boolean {
    const lab = this.activeLab;
    const session = lab ? this.sessions[lab.id] : null;
    if (!lab || !session || session.activeStepIndex + 1 >= lab.steps.length) return false;
    this.selectStep(session.activeStepIndex + 1);
    return true;
  }

  prevStep(): boolean {
    const lab = this.activeLab;
    const session = lab ? this.sessions[lab.id] : null;
    if (!lab || !session || session.activeStepIndex <= 0) return false;
    this.selectStep(session.activeStepIndex - 1);
    return true;
  }

  /** Mark the current step explicitly skipped (never verified) and advance to the next pending step. */
  skipStep(reason: SkipReason = "user"): void {
    const lab = this.activeLab;
    const session = lab ? this.sessions[lab.id] : null;
    if (!lab || !session) return;
    const step = lab.steps[session.activeStepIndex];
    if (!step) return;
    const prog = session.steps[step.id];
    if (prog && prog.status !== "completed") {
      prog.status = "skipped";
      prog.skipReason = reason;
      prog.completedAt = new Date().toISOString();
    }
    this.updateSessionCompletion(lab, session);

    const nextIdx = this.findNextPendingStep(lab, session, session.activeStepIndex + 1);
    if (nextIdx >= 0) {
      session.activeStepIndex = nextIdx;
      const snap = this.safeSnapshot();
      this.lastSnapshot = snap;
      this.initStepMemory(lab, lab.steps[nextIdx], snap, true);
    }

    this.host.clearReveals?.();
    this.saveStorage();
    this.emitState();
  }

  /** Reset only the currently active step's latches and progress. */
  resetCurrentStep(): void {
    const lab = this.activeLab;
    const session = lab ? this.sessions[lab.id] : null;
    if (!lab || !session) return;
    const step = lab.steps[session.activeStepIndex];
    if (!step) return;

    session.steps[step.id] = {
      id: step.id,
      status: "pending",
      completedAt: null,
      captures: {},
      subgoals: {},
    };
    session.completedAt = null;
    const snap = this.safeSnapshot();
    this.lastSnapshot = snap;
    this.initStepMemory(lab, step, snap, true);

    this.host.clearReveals?.();
    this.saveStorage();
    this.emitState();
  }

  /** Restart the active lab from step 1 and re-run its clean setup. */
  async resetLab(): Promise<boolean> {
    if (!this.activeLab) return false;
    return this.startLab(this.activeLab.id, { applySetup: true, restart: true });
  }

  /** Pulse a single reveal target from the active step (opt-in `show control`). */
  revealCurrentStep(targetIndex = 0): string | null {
    const lab = this.activeLab;
    const session = lab ? this.sessions[lab.id] : null;
    if (!lab || !session) return null;
    const targets = lab.steps[session.activeStepIndex]?.reveal ?? [];
    if (!targets.length) return null;
    const target = targets[targetIndex % targets.length];
    this.host.clearReveals?.();
    this.host.reveal?.(target);
    return target;
  }

  /** Poll live state at ~4 Hz (or synchronously in tests with an explicit snapshot). */
  tick(snapOverride?: LabSnapshot): void {
    const snap = snapOverride ?? this.safeSnapshot();
    if (!snap) return;
    this.evaluate(snap, null);
  }

  /** Push a discrete read-only event immediately from its call site. */
  emit(ev: LabEvent, snapOverride?: LabSnapshot): void {
    const snap = snapOverride ?? this.safeSnapshot();
    if (!snap) return;
    this.evaluate(snap, ev);
  }

  /** Assemble the serializable `lab-report.json` payload for Run-Export ZIP. */
  buildLabReport(labIdOverride?: LabId): GuidedLabReport | null {
    const lab = labIdOverride ? this.findLab(labIdOverride) : this.activeLab;
    if (!lab) return null;
    const session = this.sessions[lab.id];
    if (!session) return null;

    const meta = this.host.meta();
    const capturesByStep: Record<string, LabCaptureMap> = {};
    const steps: GuidedLabReportStep[] = [];
    let completed = 0;
    let skipped = 0;

    for (const def of lab.steps) {
      const prog = session.steps[def.id] ?? {
        id: def.id,
        status: "pending" as const,
        completedAt: null,
        captures: {},
        subgoals: {},
      };
      if (prog.status === "completed") completed++;
      else if (prog.status === "skipped") skipped++;
      capturesByStep[def.id] = cloneMap(prog.captures);
      const entry: GuidedLabReportStep = {
        id: def.id,
        title: def.title,
        status: prog.status,
        completedAt: prog.completedAt,
        captures: cloneMap(prog.captures),
      };
      if (prog.skipReason) entry.skipReason = prog.skipReason;
      steps.push(entry);
    }

    return {
      format: "solidify-lab-report",
      version: 1,
      labId: lab.id,
      hashId: lab.hashId,
      title: lab.title,
      course: lab.course,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      build: meta.build,
      seed: meta.seed,
      setupLink: meta.setupLink,
      stepsCompleted: completed,
      stepsSkipped: skipped,
      stepsTotal: lab.steps.length,
      anyIntervened: session.anyIntervened,
      steps,
      columns: lab.columns.map(c => ({ ...c })),
      table: lab.formatRows(capturesByStep),
    };
  }

  getState(): RunnerViewState {
    const lab = this.activeLab;
    const session = lab ? this.sessions[lab.id] ?? null : null;
    const activeStepIndex = session ? session.activeStepIndex : -1;
    const activeStep = lab && session ? lab.steps[session.activeStepIndex] ?? null : null;
    const activeStepMemory = lab && activeStep ? this.stepMemory.get(this.memKey(lab.id, activeStep.id)) ?? null : null;
    const liveHint =
      activeStep && activeStepMemory && this.lastSnapshot && session?.steps[activeStep.id]?.status !== "completed"
        ? activeStep.liveHint?.(this.lastSnapshot, activeStepMemory) ?? null
        : null;

    const capturesByStep: Record<string, LabCaptureMap> = {};
    if (lab && session) {
      for (const st of lab.steps) {
        capturesByStep[st.id] = session.steps[st.id]?.captures ?? {};
      }
    }
    const tableRows = lab ? lab.formatRows(capturesByStep) : [];

    const allLabProgress: Record<LabId, LabProgressSummary> = {};
    for (const def of this.catalog) {
      const s = this.sessions[def.id];
      let completed = 0;
      let skipped = 0;
      if (s) {
        for (const st of def.steps) {
          const p = s.steps[st.id];
          if (p?.status === "completed") completed++;
          else if (p?.status === "skipped") skipped++;
        }
      }
      allLabProgress[def.id] = {
        completed,
        skipped,
        total: def.steps.length,
        started: Boolean(s),
      };
    }

    const can3d = this.lastSnapshot?.can3d ?? this.safeSnapshot()?.can3d ?? false;

    return {
      activeLab: lab,
      session,
      activeStep,
      activeStepIndex,
      activeStepMemory,
      liveHint,
      tableRows,
      allLabProgress,
      can3d,
      lastSnapshot: this.lastSnapshot,
    };
  }

  // ---------------------------------------------------------------- internals

  private evaluate(snap: LabSnapshot, ev: LabEvent | null): void {
    this.lastSnapshot = snap;
    const can3dChanged = snap.can3d !== this.lastCan3d;
    this.lastCan3d = snap.can3d;

    const lab = this.activeLab;
    if (!lab) {
      if (can3dChanged) this.emitState();
      return;
    }
    const session = this.sessions[lab.id];
    if (!session) return;

    let progressChanged = false;
    if (ev?.kind === "lab-pour-finished" && ev.intervened && !session.anyIntervened) {
      session.anyIntervened = true;
      progressChanged = true;
    }

    const step = lab.steps[session.activeStepIndex];
    if (!step) return;
    const prog = session.steps[step.id];
    if (!prog) return;

    const mem = this.ensureStepMemory(lab, step, snap);
    if (snap.viewName && !mem.visitedLenses.includes(snap.viewName)) {
      mem.visitedLenses.push(snap.viewName);
    }
    if (snap.viewName && snap.fracSolid >= 0.05 && !mem.visitedLensesSolid.includes(snap.viewName)) {
      mem.visitedLensesSolid.push(snap.viewName);
    }

    if (prog.status !== "completed") {
      if (step.subgoals && step.subgoals.length > 0) {
        for (const sg of step.subgoals) {
          if (mem.latched[sg.id]) continue;
          if (sg.match(snap, ev, mem)) {
            const cap = sg.capture(snap, ev, mem);
            mem.latched[sg.id] = cap;
            prog.subgoals[sg.id] = cap;
            prog.captures[sg.id] = cap;
            progressChanged = true;
          }
        }
        if (step.subgoals.every(sg => Boolean(mem.latched[sg.id]))) {
          prog.status = "completed";
          delete prog.skipReason;
          prog.completedAt = new Date().toISOString();
          this.updateSessionCompletion(lab, session);
          this.host.clearReveals?.();
          progressChanged = true;
        }
      } else if (step.check && step.check(snap, ev, mem)) {
        prog.captures = step.capture ? step.capture(snap, ev, mem) : {};
        prog.status = "completed";
        delete prog.skipReason;
        prog.completedAt = new Date().toISOString();
        this.updateSessionCompletion(lab, session);
        this.host.clearReveals?.();
        progressChanged = true;
      }
    }

    const nextHint = prog.status === "completed" ? null : step.liveHint?.(snap, mem) ?? null;
    const hintChanged = nextHint !== this.lastHint;
    this.lastHint = nextHint;

    if (progressChanged) this.saveStorage();
    if (progressChanged || hintChanged || can3dChanged) this.emitState();
  }

  private memKey(labId: LabId, stepId: string): string {
    return `${labId}::${stepId}`;
  }

  private clearLabMemory(lab: LabDef): void {
    for (const st of lab.steps) {
      this.stepMemory.delete(this.memKey(lab.id, st.id));
    }
  }

  private initStepMemory(lab: LabDef, step: LabStepDef, snap: LabSnapshot | null, resetLatches: boolean): StepMemory {
    const key = this.memKey(lab.id, step.id);
    const prog = this.sessions[lab.id]?.steps[step.id];
    const latched: Record<string, LabCaptureMap> = {};
    if (!resetLatches && prog) {
      for (const [k, v] of Object.entries(prog.subgoals)) latched[k] = cloneMap(v);
    }
    const mem: StepMemory = {
      enteredAtEpoch: snap?.resetEpoch ?? 0,
      enteredSliceOff: snap ? snap.sliceOff : null,
      visitedLenses: [],
      visitedLensesSolid: [],
      latched,
    };
    this.stepMemory.set(key, mem);
    return mem;
  }

  private ensureStepMemory(lab: LabDef, step: LabStepDef, snap: LabSnapshot): StepMemory {
    const key = this.memKey(lab.id, step.id);
    const cur = this.stepMemory.get(key);
    if (cur) return cur;
    return this.initStepMemory(lab, step, snap, false);
  }

  private ensureSessionSteps(lab: LabDef, session: LabSessionState): void {
    for (const st of lab.steps) {
      if (!session.steps[st.id]) {
        session.steps[st.id] = {
          id: st.id,
          status: "pending",
          completedAt: null,
          captures: {},
          subgoals: {},
        };
      }
    }
    session.activeStepIndex = Math.max(0, Math.min(lab.steps.length - 1, session.activeStepIndex));
  }

  private findNextPendingStep(lab: LabDef, session: LabSessionState, fromIndex: number): number {
    for (let i = fromIndex; i < lab.steps.length; i++) {
      if (session.steps[lab.steps[i].id]?.status === "pending") return i;
    }
    for (let i = 0; i < Math.min(fromIndex, lab.steps.length); i++) {
      if (session.steps[lab.steps[i].id]?.status === "pending") return i;
    }
    return -1;
  }

  private updateSessionCompletion(lab: LabDef, session: LabSessionState): void {
    const allResolved = lab.steps.every(st => {
      const s = session.steps[st.id]?.status;
      return s === "completed" || s === "skipped";
    });
    if (allResolved && !session.completedAt) {
      session.completedAt = new Date().toISOString();
    } else if (!allResolved) {
      session.completedAt = null;
    }
  }

  private safeSnapshot(): LabSnapshot | null {
    try {
      return this.host.snapshot();
    } catch {
      return null;
    }
  }

  private emitState(): void {
    const view = this.getState();
    for (const fn of this.listeners) fn(view);
  }

  private loadStorage(): void {
    const st = getStorage();
    if (!st) return;
    try {
      const raw = st.getItem(LAB_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedSessions>;
      if (parsed?.version !== 1 || !parsed.sessions || typeof parsed.sessions !== "object") return;
      this.sessions = parsed.sessions;
    } catch {
      this.sessions = {};
    }
  }

  private saveStorage(): void {
    const st = getStorage();
    if (!st) return;
    try {
      const payload: PersistedSessions = { version: 1, sessions: this.sessions };
      st.setItem(LAB_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore private-mode or quota errors
    }
  }
}

// ------------------------------------------------------ printable HTML report

function escHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(https?:\/\/|\/|#)/i.test(trimmed)) return trimmed;
  return null;
}

function fmtReportValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (Number.isInteger(v)) return String(v);
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(1);
    if (abs >= 10) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    return v.toPrecision(3);
  }
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    return v
      .map((item, idx) => {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const pairs = Object.entries(item as Record<string, unknown>)
            .filter(([, val]) => val !== null && val !== undefined && val !== "")
            .map(([k, val]) => `${k}: ${fmtReportValue(val)}`);
          return `#${idx + 1} (${pairs.join(", ")})`;
        }
        return fmtReportValue(item);
      })
      .join("; ");
  }
  if (typeof v === "object") {
    const pairs = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && val !== "")
      .map(([k, val]) => `${k}: ${fmtReportValue(val)}`);
    return pairs.length ? pairs.join(", ") : "—";
  }
  return String(v);
}

function flattenCaptures(cap: LabCaptureMap, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, val] of Object.entries(cap)) {
    if (key === "resetEpoch") continue;
    const label = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const nested = flattenCaptures(val as LabCaptureMap, label);
      out.push(...nested);
    } else {
      out.push([label, fmtReportValue(val)]);
    }
  }
  return out;
}

/**
 * Pure light-mode printable HTML report formatter for a `GuidedLabReport`.
 * Zero DOM or WebGPU dependencies so Node CI can validate HTML integrity,
 * escaping, `@media print` rules, and copy discipline directly.
 */
export function formatLabReportHtml(report: GuidedLabReport): string {
  const labNum = String(report.hashId).padStart(2, "0");
  const seedHex = `0x${(report.seed >>> 0).toString(16).padStart(8, "0")}`;
  const statusSummary =
    `${report.stepsCompleted} / ${report.stepsTotal} completed` +
    (report.stepsSkipped > 0 ? `, ${report.stepsSkipped} skipped` : "");
  const integrity = report.anyIntervened
    ? "intervened (physics settings changed mid-run)"
    : "clean (no mid-run intervention)";
  const href = safeHref(report.setupLink);
  const setupHtml = href
    ? `<a class="mono link" href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(report.setupLink)}</a>`
    : report.setupLink
      ? `<span class="mono">${escHtml(report.setupLink)}</span>`
      : "—";

  const tableSection =
    report.table.length === 0
      ? `<p class="empty">No measurements recorded yet.</p>`
      : `<div class="table-wrap"><table><thead><tr><th>Run</th>${report.columns
          .map(col => {
            const hdr = col.unit ? `${col.label} (${col.unit})` : col.label;
            return `<th class="num">${escHtml(hdr)}</th>`;
          })
          .join("")}</tr></thead><tbody>${report.table
          .map(row => {
            const rowLabel = row.group ? `${row.group} · ${row.label}` : row.label;
            const cells = report.columns
              .map(col => {
                const raw = row.values[col.key];
                const isNum = typeof raw === "number" && Number.isFinite(raw);
                return `<td class="${isNum ? "num mono" : "txt"}">${escHtml(fmtReportValue(raw))}</td>`;
              })
              .join("");
            return `<tr><td class="txt run">${escHtml(rowLabel)}</td>${cells}</tr>`;
          })
          .join("")}</tbody></table></div>`;

  const stepsHtml = report.steps
    .map((step, idx) => {
      const num = String(idx + 1).padStart(2, "0");
      const badge =
        step.status === "completed"
          ? "COMPLETED"
          : step.status === "skipped"
            ? `SKIPPED (${step.skipReason ?? "user"})`
            : "PENDING";
      const badgeCls =
        step.status === "completed" ? "badge is-done" : step.status === "skipped" ? "badge is-skip" : "badge";
      const entries = flattenCaptures(step.captures);
      const capHtml =
        entries.length > 0
          ? `<dl class="caps">${entries
              .map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd class="mono">${escHtml(v)}</dd></div>`)
              .join("")}</dl>`
          : `<div class="cap-empty">No quantitative readouts latched for this step.</div>`;
      const timeHtml = step.completedAt ? `<span class="step-time mono">${escHtml(step.completedAt)}</span>` : "";
      return (
        `<article class="step">` +
        `<header class="step-head">` +
        `<span class="step-num mono">${num}</span>` +
        `<span class="step-title">${escHtml(step.title)}</span>` +
        `<span class="step-id mono">${escHtml(step.id)}</span>` +
        `<span class="${badgeCls}">${escHtml(badge)}</span>` +
        timeHtml +
        `</header>` +
        capHtml +
        `</article>`
      );
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SOLIDIFY Lab Report: Lab ${labNum} · ${escHtml(report.title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #111111;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .mono {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 24px;
    border-bottom: 1px solid #d4d4d4;
    background: #f7f7f7;
  }
  .toolbar__note {
    font-size: 12px;
    color: #525252;
  }
  .toolbar__btn {
    appearance: none;
    border: 1px solid #111111;
    background: #111111;
    color: #ffffff;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 14px;
    cursor: pointer;
  }
  .toolbar__btn:hover { background: #2e2e2e; }
  .page {
    max-width: 860px;
    margin: 0 auto;
    padding: 24px 28px 36px;
  }
  .kicker {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #525252;
  }
  h1 {
    margin: 4px 0 2px;
    font-size: 22px;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .course {
    margin: 0 0 18px;
    font-size: 13px;
    color: #404040;
  }
  .meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 18px;
    margin: 0 0 22px;
    padding: 12px 14px;
    border: 1px solid #d4d4d4;
    background: #fafafa;
  }
  .meta__row {
    display: grid;
    grid-template-columns: 108px minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
  }
  .meta__row.full { grid-column: 1 / -1; }
  .meta dt {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #525252;
  }
  .meta dd {
    margin: 0;
    word-break: break-word;
  }
  .link { color: #111111; text-decoration: underline; }
  h2 {
    margin: 22px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #111111;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .table-wrap { width: 100%; overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th, td {
    padding: 6px 8px;
    border-bottom: 1px solid #e0e0e0;
    vertical-align: top;
    text-align: left;
  }
  thead th {
    border-bottom: 1.5px solid #111111;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #404040;
    font-weight: 600;
  }
  th.num, td.num { text-align: right; white-space: nowrap; }
  td.run { font-weight: 600; }
  .empty { color: #525252; font-style: italic; margin: 8px 0 12px; }
  .steps { display: grid; gap: 10px; }
  .step {
    border: 1px solid #d4d4d4;
    padding: 10px 12px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .step-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .step-num { font-weight: 700; color: #525252; }
  .step-title { font-weight: 600; }
  .step-id { font-size: 11px; color: #666666; }
  .step-time { font-size: 11px; color: #525252; margin-left: auto; }
  .badge {
    display: inline-block;
    padding: 1px 6px;
    border: 1px solid #737373;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #404040;
  }
  .badge.is-done {
    border-color: #111111;
    background: #111111;
    color: #ffffff;
  }
  .badge.is-skip {
    border-style: dashed;
    color: #525252;
  }
  .caps {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 4px 12px;
    margin: 0;
    padding-top: 6px;
    border-top: 1px solid #ececec;
  }
  .caps > div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }
  .caps dt { color: #525252; }
  .caps dd { margin: 0; text-align: right; word-break: break-word; }
  .cap-empty { font-size: 12px; color: #666666; }
  footer {
    margin-top: 26px;
    padding-top: 8px;
    border-top: 1px solid #d4d4d4;
    font-size: 11px;
    color: #525252;
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media (max-width: 640px) {
    .meta { grid-template-columns: 1fr; }
    .page { padding: 16px; }
  }
  @media print {
    @page { margin: 14mm; }
    .no-print { display: none !important; }
    .page { max-width: none; padding: 0; }
    tr, .step, .meta { break-inside: avoid; page-break-inside: avoid; }
    a.link { text-decoration: none; }
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <span class="toolbar__note">SOLIDIFY printable lab report · light mode · ready for Print or Save as PDF</span>
    <button class="toolbar__btn" type="button" onclick="window.print()">Print / Save PDF</button>
  </div>
  <main class="page">
    <div class="kicker">SOLIDIFY · GUIDED LAB REPORT</div>
    <h1>Lab ${labNum}: ${escHtml(report.title)}</h1>
    <p class="course">${escHtml(report.course)}</p>

    <dl class="meta">
      <div class="meta__row"><dt>Lab ID</dt><dd class="mono">${escHtml(report.labId)} (#lab=${report.hashId})</dd></div>
      <div class="meta__row"><dt>Progress</dt><dd class="mono">${escHtml(statusSummary)}</dd></div>
      <div class="meta__row"><dt>Seed</dt><dd class="mono">${escHtml(seedHex)} (${report.seed})</dd></div>
      <div class="meta__row"><dt>Build</dt><dd class="mono">${escHtml(report.build || "—")}</dd></div>
      <div class="meta__row"><dt>Started</dt><dd class="mono">${escHtml(report.startedAt || "—")}</dd></div>
      <div class="meta__row"><dt>Completed</dt><dd class="mono">${escHtml(report.completedAt || "in progress")}</dd></div>
      <div class="meta__row full"><dt>Run integrity</dt><dd>${escHtml(integrity)}</dd></div>
      <div class="meta__row full"><dt>Setup link</dt><dd>${setupHtml}</dd></div>
    </dl>

    <section>
      <h2>Recorded Measurements</h2>
      ${tableSection}
    </section>

    <section>
      <h2>Step Completion Log</h2>
      <div class="steps">${stepsHtml}</div>
    </section>

    <footer>
      <span>Generated by SOLIDIFY Guided Labs · browser-local · no account required</span>
      <span class="mono">${escHtml(report.format)} v${report.version}</span>
    </footer>
  </main>
</body>
</html>
`;
}
