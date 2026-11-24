/**
 * Pure declarative types for SOLIDIFY's in-app Guided Labs mode.
 *
 * Zero DOM or WebGPU runtime imports so Node CI (`scripts/verify-guided-labs.mjs`)
 * can import and exercise every lab schema, trajectory, and report directly.
 */

import type { Mix, Derived as AlloyDerived } from "../alloy";
import type { Admission } from "../elements";
import type { Units, MaterialSI } from "../units";
import type { ThermalAnalysis } from "../thermal";
import type { PorosityResult } from "../porosity";
import type { LabSetup } from "../lab";
import type { Census } from "../heatpanel";

export type LabId = string;
export type SkipReason = "user" | "no-3d";
export type StepOutcome = "pending" | "completed" | "skipped";
export type LabCategory = "2D" | "TRUE 3D" | "HEAT TREAT" | "ENGINES";

export type LabCaptureMap = Record<string, unknown>;

export interface LabEutecticSnapshot {
  open: boolean;
  running: boolean;
  alloy: string;
  lens: number;
  pullV: number;
  c0Off: number;
  seedPairs: number;
  step: number;
  lambdaUm: number | null;
  lambdaMinUm: number;
  dTFrontK: number;
  fAlpha: number;
  fAlphaLever: number;
  maxSimplexErr: number;
}

export interface LabSpinodalSnapshot {
  open: boolean;
  running: boolean;
  preset: string;
  dim: "2d" | "3d";
  lens: number;
  c0: number;
  step: number;
  simTime: number;
  freeEnergy: number;
  initialFreeEnergy: number;
  meanC: number;
  massDrift: number;
  domainL: number;
  lswSlope: number | null;
}

export interface LabStereoSnapshot {
  n2: number;
  d2Um: number;
  d3Um: number;
  ratio: number;
  astmG2: number | null;
}

export interface LabCalibrationSnapshot {
  d0: number;
  W0: number;
  tau0: number;
  wOverD0: number;
  dT0: number;
  umPerCell: number;
}

/** Discrete read-only events pushed at the call site so transient actions are never missed by polling. */
export type LabEvent =
  | {
      kind: "sdas-measured";
      dim: "2d" | "3d";
      lambda2Um: number;
      arms: number;
      lenUm: number;
    }
  | {
      kind: "composer-mix-viewed";
      base: string;
      wt: Record<string, number>;
      derived: AlloyDerived;
    }
  | {
      kind: "composer-picked";
      base: string;
      el: string;
      admission: Admission;
    }
  | {
      kind: "composer-poured";
      mix: Mix;
      derived: AlloyDerived;
    }
  | {
      kind: "lab-pour-finished";
      dim: "2d" | "3d";
      material: string;
      setup: LabSetup;
      intervened: boolean;
      ta: ThermalAnalysis;
      census: Census | null;
      sections: { heightVox: number; census: Census }[] | null;
      fired: number;
      nMax: number;
      effInoc: number;
      fadeF: number;
      dTmax: number;
      porosity: PorosityResult | null;
      csc: number | null;
      umPerCell: number;
      si: MaterialSI | null;
    }
  | {
      kind: "heat-plan";
      dim: "2d" | "3d";
      material: string;
      ok: boolean;
      reason?: "incipient" | "domain" | "no-solid" | "too-few-grains" | "no-si" | "other";
      specUnreachable: boolean;
      tC: number;
      holdMin: number;
      peakFracTm: number;
      specMPa: number;
      currentSigmaY: number | null;
      dPredUm: number | null;
      coldWorkJb?: number;
      lawWithdrawn?: boolean;
      rxNuclei?: number;
      rxMode?: number;
      sweeps?: number;
    }
  | {
      kind: "heat-finished";
      dim: "2d" | "3d";
      material: string;
      tC: number;
      holdMin: number;
      pinF: number;
      pinR: number;
      dLimUm?: number;
      d0Um: number;
      dAfterUm: number;
      dPredUm: number;
      sigmaBefore: number;
      sigmaAfter: number;
      specMPa: number;
      specMet: boolean | null;
      oxideNm: number;
      sweeps: number;
      aborted: boolean;
      twinsSpawned: number;
      twinVerdictOk: boolean;
      twinRefusalWhy: string;
      /** 3D cold-work mean stored energy deposited (J_b); 0 when as-cast or 2D. */
      coldWorkJb?: number;
      /** Accumulated recovery ordinate rec = HT_RECOVER_3D * S; 0 when unworked. */
      recovery?: number;
      /** Mean recovered stored energy (J_b) after delivered sweeps. */
      recoveredMeanJb?: number;
      /** Peak grain recovered stored energy (J_b) from 2 * coldWorkJb. */
      recoveredPeakJb?: number;
      /** True when stored energy withdrew the curvature growth-law endpoint. */
      lawWithdrawn?: boolean;
      /** Requested 3D recrystallization nuclei count; 0 when none. */
      rxNuclei?: number;
      /** Placed 3D recrystallization nuclei count; 0 when none. */
      rxPlaced?: number;
      /** Nucleation mode index into RX_MODES (0..3). */
      rxMode?: number;
      /** Final recrystallized volume fraction X in [0, 1], or null if no event. */
      rxFraction?: number | null;
      /** Fitted JMAK Avrami exponent n on the Monte Carlo sweep clock, or null. */
      avramiN?: number | null;
      /** Avrami fit r^2, or null if unfitted. */
      avramiR2?: number | null;
      /** Points inside the Avrami fit window, or null if unfitted. */
      avramiPoints?: number | null;
      /** Optional SIBM share shift metric when measured. */
      sibmShareDelta?: number | null;
    }
  | {
      kind: "challenge-finished";
      targetG: number;
      playerG: number | null;
      playerScore: number;
      aiG: number | null;
      aiScore: number;
      youWin: boolean;
    }
  | {
      kind: "opt-2d-finished";
      targetG: number;
      episodes: number;
      bestG: number | null;
      bestError: number | null;
      converged: boolean;
      recipe: {
        undercool: number;
        nmax: number;
        cool: [number, number, number];
        astm: number | null;
      };
    }
  | {
      kind: "opt-2d-applied";
      targetG: number;
      recipe: {
        undercool: number;
        nmax: number;
        cool: [number, number, number];
        astm: number | null;
      };
    }
  | {
      kind: "opt-3d-finished";
      material: string;
      gridN: number;
      targetDiam: number;
      unit: "µm" | "cells";
      episodes: number;
      validEpisodes: number;
      bestDiam: number | null;
      bestRelError: number | null;
      recipe: {
        undercool: number;
        nmax: number;
        cool: [number, number, number];
        diameter: number | null;
      } | null;
    }
  | {
      kind: "opt-3d-applied";
      material: string;
      gridN: number;
      targetDiam: number;
      unit: "µm" | "cells";
      recipe: {
        undercool: number;
        nmax: number;
        cool: [number, number, number];
        diameter: number | null;
      };
    };

/** Live read-only simulation & UI state polled at 4 Hz and passed alongside every LabEvent. */
export interface LabSnapshot {
  mode: "2d" | "3d";
  can3d: boolean;
  material: string;
  alloyName: string;
  calibrated: boolean;
  lambda: number;
  umPerCell: number;
  gridN: number;
  units: Units;
  calibration: LabCalibrationSnapshot | null;
  params: {
    aniMode: number;
    delta: number;
    alloyOn: number;
    c0: number;
    mLiq: number;
    kPart: number;
    coolRate: number;
    scen: number;
    atCoef?: number;
  };
  /** Live undercooling slider value (may differ from GPU state until reset). */
  undercool: number;
  /** Undercooling actually baked into the GPU field at the last clearMelt / resetArmed. */
  lastResetUndercool: number;
  /** Effective undercooling below the active charge's liquidus, derived from lastResetUndercool. */
  effUndercool: number;
  /** Monotonic counter incremented only on clearMelt / resetArmed. */
  resetEpoch: number;
  inoculant: number;
  nucFired: number;
  viewName: string;
  cutStyle: number;
  sliceOff: number;
  sliceSweep: boolean;
  fracSolid: number;
  grainCount: number;
  /** Live 2D ASTM grain number (null in 3D or when < 3 grains). */
  astm: number | null;
  /** Live 3D volume-equivalent grain diameter in µm (null in 2D or before census). */
  eqDiamUm: number | null;
  simTime: number;
  interfaceTC: number | null;
  scheilOn: boolean;
  scheilSamples: number;
  stereoOn: boolean;
  stereo: LabStereoSnapshot | null;
  nyRiskFrac: number | null;
  poreFrac: number | null;
  pouredMix: { mix: Mix; derived: AlloyDerived } | null;
  /** True when 2D LBM forced melt flow is running. */
  flowOn: boolean;
  /** 2D LBM inlet speed in cells per substep. */
  flowSpeed: number;
  /** True when the 2D flow streak overlay is enabled. */
  flowView: boolean;
  /** Active Bridgman thermal gradient dial (gradG). */
  bridgmanG: number;
  /** Active Bridgman pull speed dial (pullV). */
  bridgmanV: number;
  /** True when either 3D pole figure panel ([001] or symmetry family) is enabled. */
  poleFigureOn: boolean;
  /** True specifically when 3D pole figure [001] is enabled. */
  pole001On: boolean;
  /** Last applied scene preset id (e.g. "bridgman", "dendrite", "selector"), or null. */
  presetId: string | null;
  labActive: boolean;
  labRunning: boolean;
  heatActive: boolean;
  challengeActive: boolean;
  optActive: boolean;
  /** True when an applied 2D or 3D optimizer recipe schedule is staged/running. */
  recipeActive: boolean;
  composerOpen: boolean;
  running: boolean;
  /** Optional read-only snapshot of the 2D Folch–Plapp eutectic engine (null when closed). */
  eutectic?: LabEutecticSnapshot | null;
  /** Optional read-only snapshot of the 2D/3D Cahn–Hilliard spinodal engine (null when closed). */
  spinodal?: LabSpinodalSnapshot | null;
}

/** Per-step memory managed by GuidedLabRunner so step definitions remain pure data + predicates. */
export interface StepMemory {
  enteredAtEpoch: number;
  enteredSliceOff: number | null;
  visitedLenses: string[];
  visitedLensesSolid: string[];
  latched: Record<string, LabCaptureMap>;
}

export interface LabSubgoal {
  id: string;
  label: string;
  match(snap: LabSnapshot, ev: LabEvent | null, mem: StepMemory): boolean;
  capture(snap: LabSnapshot, ev: LabEvent | null, mem: StepMemory): LabCaptureMap;
}

export interface LabStepDef {
  id: string;
  title: string;
  /** Terse 1-sentence student action (COPY-STYLE.md compliant). */
  action: string;
  /** Optional live hint shown while the step is active. */
  liveHint?(snap: LabSnapshot, mem: StepMemory): string | null;
  /** Rail sections (`sec:TITLE`) or CSS selectors pulsed on opt-in `show control`. */
  reveal?: string[];
  requires3d?: boolean;
  /** Multi-part contrast steps latch subgoals independently; single-goal steps use check + capture. */
  subgoals?: LabSubgoal[];
  check?(snap: LabSnapshot, ev: LabEvent | null, mem: StepMemory): boolean;
  capture?(snap: LabSnapshot, ev: LabEvent | null, mem: StepMemory): LabCaptureMap;
  /** 1-sentence physics takeaway revealed on completion. */
  takeaway: string;
}

export interface LabTableCol {
  key: string;
  label: string;
  unit?: string;
}

export interface LabTableRow {
  group?: string;
  label: string;
  values: Record<string, string | number | null>;
}

export interface LabRunnerHost {
  snapshot(): LabSnapshot;
  meta(): { build: string; seed: number; setupLink: string };
  applyScene(name: string): void;
  setMode(m: "2d" | "3d"): Promise<void> | void;
  setMaterial(key: string): boolean;
  setCalibrated(on: boolean): void;
  setParams(p: Record<string, number>): void;
  setUndercool(v: number): void;
  setInoculant(nmax: number): void;
  clearMelt(undercool: number): void;
  seedCenter(): void;
  setView(v: number): void;
  setSpeed(substeps: number): void;
  setRun(on: boolean): void;
  /** Close any active mode panel, tour, or composer before staging a fresh lab setup. */
  closeModes(): void;
  startEutectic?(alloy?: string): void;
  startSpinodal?(preset?: string, dim?: "2d" | "3d"): void;
  setFlowOn?(on: boolean): void;
  syncUI(): void;
  reveal?(target: string): void;
  clearReveals?(): void;
  exportRun?(): Promise<void> | void;
  onLabChange?(labHashId: number | null): void;
}

export interface LabDef {
  id: LabId;
  hashId: number;
  number: string;
  title: string;
  course: string;
  minutes: number;
  dimension: "2D" | "3D" | "2D + 3D";
  category: LabCategory;
  summary: string;
  requires3d?: boolean;
  setup(host: LabRunnerHost): Promise<void> | void;
  columns: LabTableCol[];
  formatRows(capturesByStep: Record<string, LabCaptureMap>): LabTableRow[];
  steps: LabStepDef[];
}

export interface StepProgress {
  id: string;
  status: StepOutcome;
  skipReason?: SkipReason;
  completedAt: string | null;
  captures: LabCaptureMap;
  subgoals: Record<string, LabCaptureMap>;
}

export interface LabSessionState {
  labId: LabId;
  hashId: number;
  startedAt: string;
  completedAt: string | null;
  activeStepIndex: number;
  anyIntervened: boolean;
  steps: Record<string, StepProgress>;
}

export interface GuidedLabReportStep {
  id: string;
  title: string;
  status: StepOutcome;
  skipReason?: SkipReason;
  completedAt: string | null;
  captures: LabCaptureMap;
}

export interface GuidedLabReport {
  format: "solidify-lab-report";
  version: 1;
  labId: LabId;
  hashId: number;
  title: string;
  course: string;
  startedAt: string;
  completedAt: string | null;
  build: string;
  seed: number;
  setupLink: string;
  stepsCompleted: number;
  stepsSkipped: number;
  stepsTotal: number;
  anyIntervened: boolean;
  steps: GuidedLabReportStep[];
  columns: LabTableCol[];
  table: LabTableRow[];
}

export interface LabProgressSummary {
  completed: number;
  skipped: number;
  total: number;
  started: boolean;
}

export interface RunnerViewState {
  activeLab: LabDef | null;
  session: LabSessionState | null;
  activeStep: LabStepDef | null;
  activeStepIndex: number;
  activeStepMemory: StepMemory | null;
  liveHint: string | null;
  tableRows: LabTableRow[];
  allLabProgress: Record<LabId, LabProgressSummary>;
  can3d: boolean;
  lastSnapshot: LabSnapshot | null;
}
