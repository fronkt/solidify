// Challenge mode: you run one casting with live process controls, then the
// CMA-ES optimizer gets the same target and a fixed budget of castings.
// Best |ΔG| wins.

import type { StatsResult } from "./sim";
import { stream } from "./rng";
import { LearnLayer, onLearnChange } from "./learn";
import { panelText } from "./learn/panels";

export interface ChallengeHost {
  swapGrid(n: number): void;
  restoreGrid(): void;
  armPlayerRound(undercool: number): void;   // reset + run, player drives sliders
  measureNow(): Promise<StatsResult | null>;
  startAI(target: number, limit: number, onDone: (bestScore: number, bestG: number | null) => void): void;
  simTime(): number;
  syncUI(): void;
}

const GRID = 256;
const AI_CASTINGS = 10;
const TIME_LIMIT = 2.6; // sim-time budget for the player's casting

type Phase = "idle" | "brief" | "player" | "ai" | "verdict";

export class Challenge {
  active = false;
  phase: Phase = "idle";
  target = 4;
  private playerG: number | null = null;
  private playerScore = Infinity;
  private panel: HTMLElement | null = null;
  /** learn mode's "i" on each panel's header (rebuilt with it) */
  private learn = new LearnLayer(() => this.learn.apply());

  constructor(private host: ChallengeHost) {
    onLearnChange(() => this.learn.apply());
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.phase = "brief";
    this.target = [2.5, 3, 3.5, 4, 4.5][stream("challenge").int(5)];
    this.playerG = null;
    this.playerScore = Infinity;
    this.host.swapGrid(GRID);
    this.showBrief();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.phase = "idle";
    this.panel?.remove();
    this.panel = null;
    this.host.restoreGrid();
    this.host.syncUI();
  }

  private mkPanel(html: string): HTMLElement {
    this.panel?.remove();
    const p = document.createElement("div");
    // placed and sized by .modepanel (app/index.html), so it can reach neither
    // the rail nor the transport bar
    p.className = "modepanel";
    p.style.cssText =
      "--cap:560px;" +
      "background:rgba(15,17,21,0.94);border:1px solid #262b33;border-radius:8px;padding:14px 18px;" +
      "backdrop-filter:blur(6px);z-index:7;font-size:12px;line-height:1.6;";
    p.innerHTML = html;
    document.getElementById("app")!.append(p);
    this.panel = p;
    // every challenge panel opens with its title line: the "i" goes on it
    const head = p.firstElementChild as HTMLElement;
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.gap = "8px";
    this.learn = new LearnLayer(() => this.learn.apply());
    head.after(this.learn.explain(head, "about the challenge", panelText("challenge")).body);
    this.learn.apply();
    return p;
  }

  private btn(parent: Element, label: string, fn: () => void, accent = false) {
    const b = document.createElement("button");
    b.textContent = label;
    if (accent) b.className = "accent";
    b.addEventListener("click", fn);
    parent.append(b);
    return b;
  }

  private showBrief() {
    // the player's controls are the rail's own, named as the rail prints them
    const p = this.mkPanel(`
      <div style="letter-spacing:.2em;color:#56d4dd;font-size:10px;margin-bottom:6px">CHALLENGE · YOU vs OPTIMIZER</div>
      <div>target <b style="color:#ffb454">ASTM G ${this.target}</b> · time limit t ${TIME_LIMIT} (model time)</div>
      <div style="color:#8891a0">your controls: <b>cooling rate</b>, <b>inoculant n_max</b> · then the optimizer: ${AI_CASTINGS} castings</div>
      <div class="nav" style="display:flex;gap:8px;margin-top:10px"></div>`);
    const nav = p.querySelector(".nav")!;
    this.btn(nav, "▶ start", () => this.beginPlayer(), true);
    this.btn(nav, "cancel", () => this.stop());
  }

  private beginPlayer() {
    this.phase = "player";
    this.host.armPlayerRound(0.7);
    this.mkPanel(`
      <div style="letter-spacing:.2em;color:#56d4dd;font-size:10px;margin-bottom:6px">CHALLENGE · YOUR CASTING</div>
      <div>target <b style="color:#ffb454">G ${this.target}</b> · steer <b>cooling rate</b>, <b>inoculant n_max</b>
      <span id="chTime" style="color:#6b7280"></span></div>`);
  }

  /** fed from the main stats poll */
  onStats(s: StatsResult) {
    if (!this.active || this.phase !== "player") return;
    const t = this.host.simTime();
    const el = this.panel?.querySelector("#chTime");
    if (el) el.textContent = ` · t ${t.toFixed(2)} / ${TIME_LIMIT} · solid ${(s.fracSolid * 100).toFixed(0)} %`;
    if (s.fracSolid > 0.92 || t >= TIME_LIMIT) void this.finishPlayer();
  }

  private async finishPlayer() {
    if (this.phase !== "player") return;
    this.phase = "ai";
    const s = await this.host.measureNow();
    this.playerG = s?.astm ?? null;
    this.playerScore = this.playerG !== null ? Math.abs(this.playerG - this.target) : 8;
    this.panel?.remove();
    this.panel = null;
    this.host.startAI(this.target, AI_CASTINGS, (aiScore, aiG) => this.verdict(aiScore, aiG));
  }

  private verdict(aiScore: number, aiG: number | null) {
    if (!this.active) return;
    this.phase = "verdict";
    const youWin = this.playerScore <= aiScore;
    const fmt = (g: number | null, sc: number) =>
      g !== null ? `G ${g.toFixed(1)} (|ΔG| ${sc.toFixed(2)})` : "no grains measured";
    const p = this.mkPanel(`
      <div style="letter-spacing:.2em;color:#56d4dd;font-size:10px;margin-bottom:6px">CHALLENGE · VERDICT</div>
      <div style="display:flex;gap:26px;margin:6px 0 4px">
        <div>YOU<br/><b style="color:${youWin ? "#ffb454" : "#c9cdd4"}">${fmt(this.playerG, this.playerScore)}</b></div>
        <div>OPTIMIZER<br/><b style="color:${youWin ? "#c9cdd4" : "#ffb454"}">${fmt(aiG, aiScore)}</b></div>
      </div>
      <div style="color:${youWin ? "#ffb454" : "#e06c60"};font-weight:600">
        ${youWin ? "you win" : "optimizer wins"}</div>
      <div class="nav" style="display:flex;gap:8px;margin-top:10px"></div>`);
    const nav = p.querySelector(".nav")!;
    this.btn(nav, "⚔ rematch", () => { this.active = false; this.panel?.remove(); this.panel = null; this.start(); }, true);
    this.btn(nav, "close", () => this.stop());
  }
}
