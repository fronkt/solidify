// Challenge mode: you run one casting with live process controls, then the
// CMA-ES optimizer gets the same target and a fixed budget of castings.
// Best |ΔG| wins.

import type { StatsResult } from "./sim";
import { stream } from "./rng";
import { LearnLayer, onLearnChange } from "./learn";
import { panelText } from "./learn/panels";
import { kv, num, panelHead, pill } from "./design/panel";

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

  /** a challenge panel: the header row (CHALLENGE, the stage in quiet
   *  text, the "i"), then `html`; placed and sized by .modepanel
   *  (app/index.html), so it can reach neither the rail nor the transport bar */
  private mkPanel(stage: string, html: string): HTMLElement {
    this.panel?.remove();
    const p = document.createElement("div");
    p.className = "modepanel plate tpanel";
    const meta = document.createElement("span");
    meta.textContent = stage;
    const head = panelHead("CHALLENGE", null, meta);
    this.learn = new LearnLayer(() => this.learn.apply());
    const ex = this.learn.explain(head, "about the challenge", panelText("challenge"), meta);
    p.append(head, ex.body);
    p.insertAdjacentHTML("beforeend", html);
    document.getElementById("app")!.append(p);
    this.panel = p;
    this.learn.apply();
    return p;
  }

  private showBrief() {
    // the player's controls are the rail's own, named as the rail prints them
    const p = this.mkPanel("you vs optimizer", `<div class="kv">`
      + kv("target", `ASTM ${num(`G ${this.target}`)} · time limit ${num(`t ${TIME_LIMIT}`)} (model time)`)
      + kv("your controls", "<b>cooling rate</b>, <b>inoculant n_max</b>")
      + kv("then", `the optimizer: ${num(AI_CASTINGS)} castings`)
      + `</div><div class="pactions pnav"></div>`);
    const nav = p.querySelector(".pnav")!;
    nav.append(pill("▶ start", () => this.beginPlayer(), "accent"), pill("cancel", () => this.stop()));
  }

  private beginPlayer() {
    this.phase = "player";
    this.host.armPlayerRound(0.7);
    this.mkPanel("your casting", `<div class="kv">`
      + kv("target", `${num(`G ${this.target}`)} · steer <b>cooling rate</b>, <b>inoculant n_max</b>`)
      + kv("casting", `<span id="chTime" class="v">t 0.00 / ${TIME_LIMIT}</span>`)
      + `</div>`);
  }

  /** fed from the main stats poll */
  onStats(s: StatsResult) {
    if (!this.active || this.phase !== "player") return;
    const t = this.host.simTime();
    const el = this.panel?.querySelector("#chTime");
    if (el) el.textContent = `t ${t.toFixed(2)} / ${TIME_LIMIT} · solid ${(s.fracSolid * 100).toFixed(0)} %`;
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
    // the two results as spec rows, the winner's bright and the other's
    // quiet: the verdict is said in words and brightness, never a hue
    const res = (win: boolean, s: string) => win ? `<b class="v">${s}</b>` : `<span class="v q">${s}</span>`;
    const p = this.mkPanel("verdict", `<div class="kv">`
      + kv("you", res(youWin, fmt(this.playerG, this.playerScore)))
      + kv("optimizer", res(!youWin, fmt(aiG, aiScore)))
      + `</div><div class="pverdict">${youWin ? "you win" : "optimizer wins"}</div>`
      + `<div class="pactions pnav"></div>`);
    const nav = p.querySelector(".pnav")!;
    nav.append(
      pill("rematch", () => { this.active = false; this.panel?.remove(); this.panel = null; this.start(); }, "accent"),
      pill("close", () => this.stop()));
  }
}
