/**
 * Declarative 9-lab, 40-step undergraduate MSE curriculum for SOLIDIFY Guided Labs.
 *
 * Pure data + pure predicates with zero DOM or WebGPU runtime imports so Node CI
 * (`scripts/verify-guided-labs.mjs`) can validate schema, copy rules, and synthetic
 * trajectories directly. Adding Lab 10+ requires appending one `LabDef` entry to `LABS`.
 */

import type {
  LabCaptureMap,
  LabDef,
  LabEvent,
  LabRunnerHost,
  LabSnapshot,
  LabTableRow,
} from "./types";

// ---------------------------------------------------------------- pure helpers

function round(v: number, digits = 1): number {
  return Number(v.toFixed(digits));
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asMap(v: unknown): LabCaptureMap | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as LabCaptureMap) : null;
}

function dbarUm(
  census: { meanAreaPx: number; meanVolVox?: number } | null,
  dim: "2d" | "3d",
  umPerCell: number,
): number | null {
  if (!census || !(umPerCell > 0)) return null;
  if (dim === "3d") {
    const v = census.meanVolVox ?? 0;
    return v > 0 ? Math.cbrt((6 * v) / Math.PI) * umPerCell : null;
  }
  return census.meanAreaPx > 0 ? 2 * Math.sqrt(census.meanAreaPx / Math.PI) * umPerCell : null;
}

function hallPetchMPa(si: { s0: number; kHP: number } | null, dUm: number | null): number | null {
  if (!si || dUm == null || !(dUm > 0)) return null;
  return si.s0 + si.kHP / Math.sqrt(dUm * 1e-6);
}

function captureLabPour(ev: Extract<LabEvent, { kind: "lab-pour-finished" }>, snap: LabSnapshot): LabCaptureMap {
  const u = snap.units;
  const dUm = dbarUm(ev.census, ev.dim, ev.umPerCell);
  const sig = hallPetchMPa(ev.si, dUm);
  return {
    program: ev.setup.program,
    atmosphere: ev.setup.atmosphere,
    mold: ev.setup.mold,
    material: ev.material,
    T_L_C: ev.ta.liquidus && u.known ? round(u.celsius(ev.ta.liquidus.T), 1) : null,
    T_N_C: ev.ta.nadir && u.known ? round(u.celsius(ev.ta.nadir.T), 1) : null,
    dTr_K: ev.ta.recalR != null && u.known ? round(u.kelvin(ev.ta.recalR), 1) : null,
    dTmax_K: u.known ? round(u.kelvin(ev.dTmax), 1) : round(ev.dTmax, 3),
    sitesFired: ev.fired,
    nMax: ev.nMax,
    dBarUm: dUm != null ? round(dUm, 1) : null,
    sigmaY_MPa: sig != null ? round(sig, 1) : null,
    intervened: ev.intervened,
  };
}

// ----------------------------------------------------------------------- Lab 1

const LAB_1: LabDef = {
  id: "lab-1",
  hashId: 1,
  number: "01",
  title: "Dendrites, Symmetry & Calibration",
  course: "Intro MSE · Phase Transformations",
  minutes: 35,
  dimension: "2D",
  category: "2D",
  summary: "Contrast 4-fold, 6-fold, and seaweed growth, then enable Karma–Rappel calibration and measure arm spacing.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.setCalibrated(false);
    host.setMaterial("generic");
    host.applyScene("dendrite");
    host.syncUI();
  },
  columns: [
    { key: "regime", label: "model" },
    { key: "scale", label: "cell / domain" },
    { key: "metric", label: "readout" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["ms-instability"];
    if (s1 && Object.keys(s1).length) {
      rows.push({
        group: "1.1",
        label: "dendrite ×4",
        values: {
          regime: "Kobayashi",
          scale: `δ ${asNum(s1.delta) ?? "—"}`,
          metric: `f_s ${asNum(s1.fracSolidPct) ?? "—"} %`,
        },
      });
    }
    const s2 = byStep["symmetry-vs-seaweed"];
    const snow = asMap(s2?.snow);
    if (snow) {
      rows.push({
        group: "1.2",
        label: "snow ×6",
        values: {
          regime: `j = ${asNum(snow.aniMode) ?? 6}`,
          scale: `δ ${asNum(snow.delta) ?? "—"}`,
          metric: `f_s ${asNum(snow.fracSolidPct) ?? "—"} %`,
        },
      });
    }
    const sea = asMap(s2?.seaweed);
    if (sea) {
      rows.push({
        group: "1.2",
        label: "seaweed",
        values: {
          regime: "isotropic",
          scale: `δ ${asNum(sea.delta) ?? "—"}`,
          metric: `f_s ${asNum(sea.fracSolidPct) ?? "—"} %`,
        },
      });
    }
    const s3 = byStep["kobayashi-vs-kr"];
    const kob = asMap(s3?.kobayashi);
    if (kob) {
      rows.push({
        group: "1.3",
        label: "Al–Cu Kob.",
        values: {
          regime: "d₀/W n/a",
          scale: `${asNum(kob.umPerCell) ?? "—"} / ${asNum(kob.domainUm) ?? "—"} µm`,
          metric: "user pitch",
        },
      });
    }
    const cal = asMap(s3?.calibrated);
    if (cal) {
      rows.push({
        group: "1.3",
        label: "Al–Cu KR",
        values: {
          regime: `λ ${asNum(cal.lambda) ?? "—"}`,
          scale: `${asNum(cal.umPerCell) ?? "—"} / ${asNum(cal.domainUm) ?? "—"} µm`,
          metric: `d₀ ${asNum(cal.d0Nm) ?? "—"} nm`,
        },
      });
    }
    const s4 = byStep["sdas-convergence"];
    const rA = asMap(s4?.runA);
    if (rA) {
      rows.push({
        group: "1.4",
        label: `SDAS λ=${asNum(rA.lambda) ?? "—"}`,
        values: {
          regime: `W₀/d₀ ${asNum(rA.wOverD0) ?? "—"}`,
          scale: `${asNum(rA.umPerCell) ?? "—"} µm/cell`,
          metric: `λ₂ ${asNum(rA.sdasUm) ?? "—"} µm (${asNum(rA.arms) ?? "—"})`,
        },
      });
    }
    const rB = asMap(s4?.runB);
    if (rB) {
      rows.push({
        group: "1.4",
        label: `SDAS λ=${asNum(rB.lambda) ?? "—"}`,
        values: {
          regime: `W₀/d₀ ${asNum(rB.wOverD0) ?? "—"}`,
          scale: `${asNum(rB.umPerCell) ?? "—"} µm/cell`,
          metric: `λ₂ ${asNum(rB.sdasUm) ?? "—"} µm (${asNum(rB.arms) ?? "—"})`,
        },
      });
    }
    const s5 = byStep["xray-scheil"];
    if (s5 && Object.keys(s5).length) {
      rows.push({
        group: "1.5",
        label: "XRAY Scheil",
        values: {
          regime: s5.antiTrapping ? "AT on" : "AT off",
          scale: `${asNum(s5.scheilSamples) ?? "—"} pts`,
          metric: s5.interfaceTC != null ? `T_i ${asNum(s5.interfaceTC)} °C` : `f_s ${asNum(s5.fracSolidPct) ?? "—"} %`,
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "ms-instability",
      title: "Mullins–Sekerka tips & curvature",
      action: "Let the 4-fold dendrite grow past 12 % solid, then inspect both FIELD and CURV on the lens bar.",
      reveal: ["#views"],
      liveHint(snap, mem) {
        if (snap.fracSolid < 0.12) {
          return `solid ${(snap.fracSolid * 100).toFixed(1)} % / 12 %${snap.running ? "" : ": press ▶ run"}`;
        }
        const need = ["FIELD", "CURV"].filter(v => !mem.visitedLensesSolid.includes(v));
        return need.length ? `inspect lens: ${need.join(", ")}` : null;
      },
      check(snap, _ev, mem) {
        return (
          snap.mode === "2d" &&
          !snap.calibrated &&
          snap.params.aniMode === 4 &&
          snap.fracSolid >= 0.12 &&
          mem.visitedLensesSolid.includes("FIELD") &&
          mem.visitedLensesSolid.includes("CURV")
        );
      },
      capture(snap) {
        return {
          aniMode: snap.params.aniMode,
          delta: round(snap.params.delta, 3),
          fracSolidPct: round(snap.fracSolid * 100, 1),
          capillary: "not defined",
        };
      },
      takeaway:
        "Crowded isotherms in FIELD speed up protruding tips, while high positive curvature in CURV caps tip sharpness through the Gibbs–Thomson effect.",
    },
    {
      id: "symmetry-vs-seaweed",
      title: "Symmetry vs isotropic tip splitting",
      action: "Run snow in PRESETS past 10 % solid, then run seaweed past 12 % solid to contrast 6-fold locking with near-zero anisotropy.",
      reveal: ["sec:PRESETS", "sec:CRYSTAL"],
      subgoals: [
        {
          id: "snow",
          label: "snow (hex ×6, ≥ 10 %)",
          match(snap) {
            return snap.mode === "2d" && !snap.calibrated && snap.params.aniMode === 6 && snap.params.delta >= 0.02 && snap.fracSolid >= 0.10;
          },
          capture(snap) {
            return { aniMode: snap.params.aniMode, delta: round(snap.params.delta, 3), fracSolidPct: round(snap.fracSolid * 100, 1) };
          },
        },
        {
          id: "seaweed",
          label: "seaweed (δ ≤ 0.01, ≥ 12 %)",
          match(snap) {
            return snap.mode === "2d" && !snap.calibrated && snap.params.delta <= 0.01 && snap.fracSolid >= 0.12;
          },
          capture(snap) {
            return { aniMode: snap.params.aniMode, delta: round(snap.params.delta, 4), fracSolidPct: round(snap.fracSolid * 100, 1) };
          },
        },
      ],
      takeaway:
        "Changing symmetry from 4 to 6 selects six basal arms from the same PDE, whereas reducing anisotropy δ near zero triggers isotropic seaweed tip splitting.",
    },
    {
      id: "kobayashi-vs-kr",
      title: "Kobayashi vs Karma–Rappel scaling",
      action: "Click dendrite in PRESETS, pick aluminum · Al–Cu in MATERIAL, then switch calibrated solver ON in SCALE.",
      reveal: ["sec:PRESETS", "sec:MATERIAL", "sec:SCALE"],
      liveHint(snap, mem) {
        if (!mem.latched.kobayashi) {
          if (snap.material !== "al") return "pick aluminum · Al–Cu in MATERIAL";
          if (snap.params.alloyOn !== 1) return "enable solute field in ALLOY (or reselect aluminum · Al–Cu)";
          if (snap.calibrated) return "switch calibrated solver OFF briefly to record Kobayashi scaling first";
        } else if (!snap.calibrated) {
          return "switch calibrated solver ON in SCALE";
        }
        return null;
      },
      subgoals: [
        {
          id: "kobayashi",
          label: "Kobayashi Al–Cu scale",
          match(snap) {
            return snap.mode === "2d" && snap.material === "al" && snap.params.alloyOn === 1 && !snap.calibrated;
          },
          capture(snap) {
            return {
              umPerCell: round(snap.umPerCell, 3),
              domainUm: round(snap.units.scale.domainUm, 1),
              d0OverW: null,
            };
          },
        },
        {
          id: "calibrated",
          label: "calibrated solver ON",
          match(snap, _ev, mem) {
            return (
              Boolean(mem.latched.kobayashi) &&
              snap.mode === "2d" &&
              snap.material === "al" &&
              snap.params.alloyOn === 1 &&
              snap.calibrated &&
              snap.calibration != null
            );
          },
          capture(snap) {
            const cal = snap.calibration!;
            const le = snap.units.scale.groups.find(g => g.name.startsWith("Lewis"));
            return {
              umPerCell: round(snap.umPerCell, 3),
              domainUm: round(snap.units.scale.domainUm, 1),
              d0Nm: round(cal.d0 * 1e9, 2),
              W0Nm: round(cal.W0 * 1e9, 1),
              wOverD0: round(cal.wOverD0, 1),
              lambda: round(snap.lambda, 1),
              dT0K: round(cal.dT0, 1),
              leModel: le?.model != null ? round(le.model, 2) : null,
              leReal: le?.real != null ? round(le.real, 0) : null,
            };
          },
        },
      ],
      takeaway:
        "Enabling calibrated solver locks cell pitch and domain width (~89 µm at 1024²) to physical capillary length d₀ and diffusivity D while flagging the Lewis number mismatch.",
    },
    {
      id: "sdas-convergence",
      title: "SDAS ruler & coupling λ convergence",
      action:
        "Set undercooling near 0.65, click seed and ▶ run past 15 % solid, measure 3+ arms with SDAS ruler in ANALYZE, then shift coupling λ within 18–40 by at least 8, re-seed, and re-measure.",
      reveal: ["sec:MELT · PROCESS", "sec:ANALYZE", "sec:SCALE"],
      liveHint(snap, mem) {
        if (snap.mode !== "2d" || !snap.calibrated || snap.material !== "al" || snap.params.alloyOn !== 1) {
          return "keep aluminum · Al–Cu with calibrated solver ON in SCALE";
        }
        if (snap.fracSolid < 0.001 && snap.inoculant === 0) {
          return "melt has no seeds yet: click seed or tap canvas";
        }
        if (mem.latched.runA && !mem.latched.runB) {
          const lamA = asNum(mem.latched.runA.lambda) ?? 30;
          if (Math.abs(snap.lambda - lamA) < 8) {
            return `shift coupling λ within 18–40 by at least 8 from ${lamA.toFixed(1)} (now ${snap.lambda.toFixed(1)})`;
          }
          if (snap.fracSolid < 0.15) {
            return `shifted λ ${snap.lambda.toFixed(1)}: solid ${(snap.fracSolid * 100).toFixed(1)} % / 15 %${snap.running ? "" : " (press ▶ run)"}`;
          }
          return `drag SDAS ruler across 3+ arms at λ ${snap.lambda.toFixed(1)}`;
        }
        if (snap.fracSolid < 0.15) {
          return `solid ${(snap.fracSolid * 100).toFixed(1)} % / 15 %${snap.running ? "" : ": press ▶ run"}`;
        }
        return "drag SDAS ruler in ANALYZE across at least 3 secondary arms";
      },
      subgoals: [
        {
          id: "runA",
          label: "SDAS at initial λ",
          match(snap, ev) {
            return (
              ev?.kind === "sdas-measured" &&
              ev.dim === "2d" &&
              snap.calibrated &&
              snap.material === "al" &&
              snap.params.alloyOn === 1 &&
              snap.fracSolid >= 0.15 &&
              ev.arms >= 3 &&
              ev.lambda2Um > 0 &&
              snap.lambda >= 14 &&
              snap.lambda <= 48
            );
          },
          capture(snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "sdas-measured" }>;
            return {
              lambda: round(snap.lambda, 1),
              wOverD0: round(snap.calibration?.wOverD0 ?? snap.lambda / 0.8839, 1),
              umPerCell: round(snap.umPerCell, 3),
              sdasUm: round(e.lambda2Um, 2),
              arms: e.arms,
              fracSolidPct: round(snap.fracSolid * 100, 1),
            };
          },
        },
        {
          id: "runB",
          label: "SDAS at shifted λ (|Δλ| ≥ 8)",
          match(snap, ev, mem) {
            if (!mem.latched.runA || ev?.kind !== "sdas-measured" || ev.dim !== "2d") return false;
            const lamA = asNum(mem.latched.runA.lambda);
            return (
              lamA != null &&
              snap.calibrated &&
              snap.material === "al" &&
              snap.params.alloyOn === 1 &&
              snap.fracSolid >= 0.15 &&
              ev.arms >= 3 &&
              ev.lambda2Um > 0 &&
              snap.lambda >= 14 &&
              snap.lambda <= 48 &&
              Math.abs(snap.lambda - lamA) >= 8
            );
          },
          capture(snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "sdas-measured" }>;
            return {
              lambda: round(snap.lambda, 1),
              wOverD0: round(snap.calibration?.wOverD0 ?? snap.lambda / 0.8839, 1),
              umPerCell: round(snap.umPerCell, 3),
              sdasUm: round(e.lambda2Um, 2),
              arms: e.arms,
              fracSolidPct: round(snap.fracSolid * 100, 1),
            };
          },
        },
      ],
      takeaway:
        "In Karma–Rappel mode coupling λ is a numerical convergence knob (W₀/d₀), so physical arm spacing λ₂ stays converged as λ shifts.",
    },
    {
      id: "xray-scheil",
      title: "Solute rejection & Scheil verification",
      action: "Switch to XRAY, enable Scheil overlay in ANALYZE, and grow calibrated aluminum · Al–Cu past 20 % solid.",
      reveal: ["#views", "sec:ANALYZE"],
      liveHint(snap) {
        if (!snap.calibrated || snap.params.alloyOn !== 1) return "keep aluminum · Al–Cu with calibrated solver ON";
        if (snap.fracSolid < 0.001 && snap.inoculant === 0) return "melt has no seeds yet: click seed or tap canvas";
        if (snap.viewName !== "XRAY") return "select XRAY on the lens bar";
        if (!snap.scheilOn) return "enable Scheil overlay in ANALYZE";
        if (snap.fracSolid < 0.20 || snap.scheilSamples < 15) {
          return `solid ${(snap.fracSolid * 100).toFixed(1)} % / 20 % · ${snap.scheilSamples} Scheil pts`;
        }
        return null;
      },
      check(snap) {
        return (
          snap.mode === "2d" &&
          snap.calibrated &&
          snap.params.alloyOn === 1 &&
          snap.viewName === "XRAY" &&
          snap.scheilOn &&
          snap.scheilSamples >= 15 &&
          snap.fracSolid >= 0.20
        );
      },
      capture(snap) {
        return {
          fracSolidPct: round(snap.fracSolid * 100, 1),
          interfaceTC: snap.interfaceTC != null ? round(snap.interfaceTC, 1) : null,
          scheilSamples: snap.scheilSamples,
          antiTrapping: (snap.params.atCoef ?? 0) > 0,
        };
      },
      takeaway:
        "Dark interdendritic channels in XRAY trace rejected copper, while the anti-trapping current keeps interface partitioning aligned with the dashed Scheil path.",
    },
  ],
};

// ----------------------------------------------------------------------- Lab 2

const LAB_2: LabDef = {
  id: "lab-2",
  hashId: 2,
  number: "02",
  title: "Alloys, Screening & Scheil",
  course: "Physical Metallurgy · Phase Diagrams",
  minutes: 35,
  dimension: "2D",
  category: "2D",
  summary: "Audit Lever vs Gulliver–Scheil phases, trigger 118-element refusals, and run a controlled growth-restriction Q pair.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.setCalibrated(false);
    host.setMaterial("al");
    host.applyScene("alloy");
    host.setRun(false);
    host.syncUI();
  },
  columns: [
    { key: "chemistry", label: "system" },
    { key: "metric", label: "Q / pressure" },
    { key: "outcome", label: "readout" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["eutectic-peritectic-audit"];
    for (const [k, label] of [
      ["a356", "A356"],
      ["az91", "AZ91"],
      ["steel1045", "1045 steel"],
    ] as const) {
      const m = asMap(s1?.[k]);
      if (!m) continue;
      rows.push({
        group: "2.1",
        label,
        values: {
          chemistry: String(m.equilibrium ?? "—"),
          metric: `Q ${asNum(m.Q_K) ?? "—"} K`,
          outcome: m.scheilPct != null ? `L ${asNum(m.leverPct) ?? 0} % / S ${asNum(m.scheilPct)} %` : "peritectic (no single %)",
        },
      });
    }
    const s2 = byStep["screen-demix-and-vapor"];
    const demix = asMap(s2?.demix);
    if (demix) {
      rows.push({
        group: "2.2",
        label: String(demix.pair ?? "demix"),
        values: {
          chemistry: String(demix.tier ?? "—"),
          metric: "monotectic",
          outcome: String(demix.reason ?? "DEMIXES"),
        },
      });
    }
    const vap = asMap(s2?.vapor);
    if (vap) {
      rows.push({
        group: "2.2",
        label: String(vap.pair ?? "Fe vapor"),
        values: {
          chemistry: String(vap.tier ?? "—"),
          metric: vap.pPureAtm != null ? `${asNum(vap.pPureAtm)} atm` : "—",
          outcome: String(vap.band ?? "—"),
        },
      });
    }
    const s3 = byStep["hagg-and-brass-advisory"];
    const feC = asMap(s3?.feC);
    if (feC) {
      rows.push({
        group: "2.3",
        label: "Fe–C",
        values: {
          chemistry: "interstitial",
          metric: "Hägg 0.604",
          outcome: String(feC.tier ?? "ASSESSED"),
        },
      });
    }
    const cuZn = asMap(s3?.cuZn);
    if (cuZn) {
      rows.push({
        group: "2.3",
        label: "Cu–Zn",
        values: {
          chemistry: "advisory",
          metric: cuZn.pPureAtm != null ? `${asNum(cuZn.pPureAtm)} atm` : "—",
          outcome: String(cuZn.tier ?? "ASSESSED"),
        },
      });
    }
    const s4 = byStep["pour-a356-scheil"];
    if (s4 && Object.keys(s4).length) {
      rows.push({
        group: "2.4",
        label: "A356 XRAY",
        values: {
          chemistry: `${asNum(s4.scheilSamples) ?? "—"} pts`,
          metric: `Q ${asNum(s4.Q_K) ?? "—"} K`,
          outcome: s4.interfaceTC != null ? `T_i ${asNum(s4.interfaceTC)} °C` : `f_s ${asNum(s4.fracSolidPct) ?? "—"} %`,
        },
      });
    }
    const s5 = byStep["controlled-q-pair"];
    for (const [k, label] of [
      ["highQ", "Run A (high Q)"],
      ["lowQ", "Run B (low Q)"],
    ] as const) {
      const m = asMap(s5?.[k]);
      if (!m) continue;
      rows.push({
        group: "2.5",
        label,
        values: {
          chemistry: `ΔT ${asNum(m.dTeff_K) ?? "—"} K`,
          metric: `Q ${asNum(m.Q_K) ?? "—"} K`,
          outcome: `t ${asNum(m.simTime) ?? "—"} · ${asNum(m.grains) ?? "—"} gr`,
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "eutectic-peritectic-audit",
      title: "Lever vs Gulliver–Scheil phases",
      action: "Open alloy composer… in ALLOY and inspect A356, AZ91, and 1045 steel to compare equilibrium phases against what the solver grows.",
      reveal: ["sec:ALLOY"],
      subgoals: [
        {
          id: "a356",
          label: "inspect A356",
          match(_snap, ev) {
            return ev?.kind === "composer-mix-viewed" && ev.base === "al" && (ev.wt.Si ?? 0) >= 6.5 && (ev.wt.Si ?? 0) <= 7.5;
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "composer-mix-viewed" }>;
            return {
              name: e.derived.name,
              dTL_K: round(e.derived.dTL, 1),
              Q_K: round(e.derived.Q, 1),
              leverPct: e.derived.invariantFraction ? round(e.derived.invariantFraction.lever * 100, 1) : null,
              scheilPct: e.derived.invariantFraction ? round(e.derived.invariantFraction.scheil * 100, 1) : null,
              equilibrium: e.derived.phasesEquilibrium.join(" + "),
              grown: e.derived.phasesGrown.join(" + "),
            };
          },
        },
        {
          id: "az91",
          label: "inspect AZ91",
          match(_snap, ev) {
            return ev?.kind === "composer-mix-viewed" && ev.base === "mg" && (ev.wt.Al ?? 0) >= 8.5 && (ev.wt.Al ?? 0) <= 9.5;
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "composer-mix-viewed" }>;
            return {
              name: e.derived.name,
              dTL_K: round(e.derived.dTL, 1),
              Q_K: round(e.derived.Q, 1),
              leverPct: e.derived.invariantFraction ? round(e.derived.invariantFraction.lever * 100, 1) : null,
              scheilPct: e.derived.invariantFraction ? round(e.derived.invariantFraction.scheil * 100, 1) : null,
              equilibrium: e.derived.phasesEquilibrium.join(" + "),
              grown: e.derived.phasesGrown.join(" + "),
            };
          },
        },
        {
          id: "steel1045",
          label: "inspect 1045 steel",
          match(_snap, ev) {
            return ev?.kind === "composer-mix-viewed" && ev.base === "fe" && (ev.wt.C ?? 0) >= 0.40 && (ev.wt.C ?? 0) <= 0.50;
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "composer-mix-viewed" }>;
            return {
              name: e.derived.name,
              dTL_K: round(e.derived.dTL, 1),
              Q_K: round(e.derived.Q, 1),
              leverPct: null,
              scheilPct: null,
              equilibrium: e.derived.phasesEquilibrium.join(" + "),
              grown: e.derived.phasesGrown.join(" + "),
            };
          },
        },
      ],
      takeaway:
        "Without solid back-diffusion, AZ91 forms 11.9 % Scheil eutectic below its 12.9 wt% solubility limit, and 1045 steel crosses a peritectic that consumes all primary δ-ferrite.",
    },
    {
      id: "screen-demix-and-vapor",
      title: "Liquid immiscibility & vapor fuming",
      action:
        "In element screen · this melt, tap an immiscible solute in Al aluminum (Bi or Pb), then switch to Fe iron / steel and tap a boiling or fuming metal (Zn or Mg).",
      reveal: ["#composer .gridwrap"],
      subgoals: [
        {
          id: "demix",
          label: "monotectic gap (Al–Bi or Al–Pb)",
          match(_snap, ev) {
            return ev?.kind === "composer-picked" && ev.admission.reason === "DEMIXES";
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "composer-picked" }>;
            return {
              pair: `${e.base.toUpperCase()}–${e.el}`,
              tier: e.admission.tier,
              reason: e.admission.reason,
              line: e.admission.line,
            };
          },
        },
        {
          id: "vapor",
          label: "Fe vapor hazard (Zn or Mg)",
          match(_snap, ev) {
            return (
              ev?.kind === "composer-picked" &&
              ev.base === "fe" &&
              (ev.admission.vapour?.band === "BOILS" || ev.admission.vapour?.band === "FUME")
            );
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "composer-picked" }>;
            return {
              pair: `Fe–${e.el}`,
              tier: e.admission.tier,
              band: e.admission.vapour?.band ?? null,
              pPureAtm: e.admission.vapour ? round(e.admission.vapour.pPure, 1) : null,
              line: e.admission.vapour?.line ?? e.admission.line,
            };
          },
        },
      ],
      takeaway:
        "The 118-element screen separates structural solver limits (two-liquid monotectic gaps) from real foundry vapor hazards like 59 atm zinc over liquid iron.",
    },
    {
      id: "hagg-and-brass-advisory",
      title: "Interstitial size & brass advisory",
      action: "Still in element screen · this melt, tap C over Fe iron / steel for the interstitial size check, then switch to Cu copper and tap Zn.",
      reveal: ["#composer .gridwrap"],
      subgoals: [
        {
          id: "feC",
          label: "Fe–C Hägg check",
          match(_snap, ev) {
            return ev?.kind === "composer-picked" && ev.base === "fe" && ev.el === "C";
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "composer-picked" }>;
            return {
              pair: "Fe–C",
              tier: e.admission.tier,
              sizeLine: e.admission.size?.line ?? null,
            };
          },
        },
        {
          id: "cuZn",
          label: "Cu–Zn brass advisory",
          match(_snap, ev) {
            return ev?.kind === "composer-picked" && ev.base === "cu" && ev.el === "Zn";
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "composer-picked" }>;
            return {
              pair: "Cu–Zn",
              tier: e.admission.tier,
              band: e.admission.vapour?.band ?? null,
              pPureAtm: e.admission.vapour ? round(e.admission.vapour.pPure, 2) : null,
            };
          },
        },
      ],
      takeaway:
        "Carbon requires Hägg's interstitial ratio (r/R = 0.604) instead of Hume–Rothery's substitutional rule, and brass proves ideal Raoult vapor pressure must advise rather than refuse.",
    },
    {
      id: "pour-a356-scheil",
      title: "Pour A356 & track live Scheil",
      action: "Select A356 in alloy composer…, click pour, enable Scheil overlay in ANALYZE, switch to XRAY, click seed, and press ▶ run past 30 % solid.",
      reveal: ["#composer .pour", "sec:ANALYZE", "#views"],
      liveHint(snap) {
        const isA356 = snap.pouredMix?.mix.base === "al" && Math.abs((snap.pouredMix.mix.wt.Si ?? 0) - 7) <= 0.5;
        if (!isA356) return "select A356 in alloy composer… and click pour";
        if (snap.viewName !== "XRAY") return "select XRAY on the lens bar";
        if (!snap.scheilOn) return "enable Scheil overlay in ANALYZE";
        if (snap.fracSolid < 0.001 && snap.inoculant === 0) return "click seed and press ▶ run";
        if (snap.fracSolid < 0.30 || snap.scheilSamples < 20) {
          return `solid ${(snap.fracSolid * 100).toFixed(1)} % / 30 % · ${snap.scheilSamples} Scheil pts`;
        }
        return null;
      },
      check(snap) {
        return (
          snap.mode === "2d" &&
          snap.pouredMix?.mix.base === "al" &&
          Math.abs((snap.pouredMix.mix.wt.Si ?? 0) - 7) <= 0.5 &&
          snap.viewName === "XRAY" &&
          snap.scheilOn &&
          snap.scheilSamples >= 20 &&
          snap.fracSolid >= 0.30
        );
      },
      capture(snap) {
        return {
          alloyName: snap.alloyName,
          Q_K: round(snap.pouredMix!.derived.Q, 1),
          dTL_K: round(snap.pouredMix!.derived.dTL, 1),
          fracSolidPct: round(snap.fracSolid * 100, 1),
          interfaceTC: snap.interfaceTC != null ? round(snap.interfaceTC, 1) : null,
          scheilSamples: snap.scheilSamples,
        };
      },
      takeaway:
        "Rejected silicon enriches interdendritic channels along the Scheil trajectory, while the head plate warns that the 51 % eutectic constituent is not grown by a single-phase solver.",
    },
    {
      id: "controlled-q-pair",
      title: "Controlled growth-restriction (Q) pair",
      action:
        "Set inoculant n_max to 600, click reset and ▶ run A356 past 20 % solid, then compose Al + 1.0 wt% Zn (Al aluminum + Zn), pour, adjust undercooling to match ΔT below T_L, click reset, and ▶ run past 20 % solid.",
      reveal: ["sec:MELT · PROCESS", "sec:ALLOY"],
      liveHint(snap, mem) {
        if (Math.abs(snap.undercool - snap.lastResetUndercool) > 0.005) {
          return "undercooling changed: click reset to apply";
        }
        const highQ = mem.latched.highQ;
        if (!highQ) {
          if (snap.resetEpoch <= mem.enteredAtEpoch) {
            return "set inoculant n_max to 600 and click reset for a fresh A356 run";
          }
          if (!snap.pouredMix || snap.pouredMix.mix.base !== "al" || snap.pouredMix.derived.Q < 35) {
            return "pour A356 (Q ≥ 35 K) from alloy composer…";
          }
          if (snap.inoculant < 400) return "set inoculant n_max ≥ 400 and click reset";
          if (snap.effUndercool < 0.45) return "raise undercooling (≥ 0.65) and click reset so ΔT below T_L stays reachable";
          return `Run A (A356): solid ${(snap.fracSolid * 100).toFixed(1)} % / 20 % · ΔT below T_L ${snap.units.fmtK(snap.effUndercool)}`;
        }
        const targetEff = asNum(highQ.effUndercool) ?? 0.65;
        const targetK = snap.units.kelvin(targetEff);
        const curK = snap.units.kelvin(snap.effUndercool);
        const runAEpoch = asNum(highQ.resetEpoch) ?? mem.enteredAtEpoch;
        if (!snap.pouredMix || snap.pouredMix.mix.base !== "al" || snap.pouredMix.derived.Q > 3) {
          return `compose Al + 1.0 wt% Zn (Al aluminum + Zn) and pour (target ΔT below T_L ${targetK.toFixed(0)} K)`;
        }
        if (snap.resetEpoch <= runAEpoch) return "click reset to start Run B";
        if (Math.abs(snap.effUndercool - targetEff) > 0.04) {
          const suggested = Math.min(1.0, Math.max(0.3, targetEff + snap.params.mLiq * snap.params.c0));
          return `ΔT below T_L is ${curK.toFixed(0)} K (target ${targetK.toFixed(0)} ± 10 K): set undercooling near ${suggested.toFixed(2)} and click reset`;
        }
        const rateA = asNum(highQ.coolRate) ?? 0;
        if (Math.abs(snap.params.coolRate - rateA) > 0.02) {
          return `match cooling rate to Run A (${rateA.toFixed(2)}) and click reset`;
        }
        return `Run B matched at ${curK.toFixed(0)} K: solid ${(snap.fracSolid * 100).toFixed(1)} % / 20 %${snap.running ? "" : " (press ▶ run)"}`;
      },
      subgoals: [
        {
          id: "highQ",
          label: "Run A: high-Q A356 (≥ 20 %)",
          match(snap, _ev, mem) {
            return (
              snap.mode === "2d" &&
              !snap.calibrated &&
              snap.resetEpoch > mem.enteredAtEpoch &&
              snap.pouredMix?.mix.base === "al" &&
              snap.pouredMix.derived.Q >= 35 &&
              snap.inoculant >= 400 &&
              snap.nucFired >= 5 &&
              snap.grainCount >= 5 &&
              snap.effUndercool >= 0.45 &&
              Math.abs(snap.undercool - snap.lastResetUndercool) <= 0.005 &&
              snap.fracSolid >= 0.20
            );
          },
          capture(snap) {
            return {
              alloyName: snap.alloyName,
              Q_K: round(snap.pouredMix!.derived.Q, 1),
              dTL_K: round(snap.pouredMix!.derived.dTL, 1),
              effUndercool: round(snap.effUndercool, 3),
              dTeff_K: round(snap.units.kelvin(snap.effUndercool), 1),
              coolRate: round(snap.params.coolRate, 3),
              resetEpoch: snap.resetEpoch,
              simTime: round(snap.simTime, 3),
              tTo20Pct_s: snap.units.known ? round(snap.units.seconds(snap.simTime), 4) : null,
              grains: snap.grainCount,
              fired: snap.nucFired,
            };
          },
        },
        {
          id: "lowQ",
          label: "Run B: matched Al–1.0Zn (≥ 20 %)",
          match(snap, _ev, mem) {
            const highQ = mem.latched.highQ;
            if (!highQ) return false;
            const targetEff = asNum(highQ.effUndercool);
            const rateA = asNum(highQ.coolRate);
            const runAEpoch = asNum(highQ.resetEpoch);
            if (targetEff == null || rateA == null || runAEpoch == null) return false;
            return (
              snap.mode === "2d" &&
              !snap.calibrated &&
              snap.resetEpoch > runAEpoch &&
              snap.pouredMix?.mix.base === "al" &&
              snap.pouredMix.derived.Q > 0 &&
              snap.pouredMix.derived.Q <= 3 &&
              snap.inoculant >= 400 &&
              snap.nucFired >= 5 &&
              snap.grainCount >= 5 &&
              Math.abs(snap.undercool - snap.lastResetUndercool) <= 0.005 &&
              Math.abs(snap.effUndercool - targetEff) <= 0.04 &&
              Math.abs(snap.params.coolRate - rateA) <= 0.02 &&
              snap.fracSolid >= 0.20
            );
          },
          capture(snap) {
            return {
              alloyName: snap.alloyName,
              Q_K: round(snap.pouredMix!.derived.Q, 1),
              dTL_K: round(snap.pouredMix!.derived.dTL, 1),
              effUndercool: round(snap.effUndercool, 3),
              dTeff_K: round(snap.units.kelvin(snap.effUndercool), 1),
              coolRate: round(snap.params.coolRate, 3),
              resetEpoch: snap.resetEpoch,
              simTime: round(snap.simTime, 3),
              tTo20Pct_s: snap.units.known ? round(snap.units.seconds(snap.simTime), 4) : null,
              grains: snap.grainCount,
              fired: snap.nucFired,
            };
          },
        },
      ],
      takeaway:
        "High Q slows solidification at matched undercooling below each alloy's liquidus, whereas comparing at equal bath temperature confounds the liquidus shift (Q alone does not refine grains here).",
    },
  ],
};

// ----------------------------------------------------------------------- Lab 3

const LAB_3: LabDef = {
  id: "lab-3",
  hashId: 3,
  number: "03",
  title: "3D Casting, Cooling & Niyama",
  course: "Foundry · Solidification Processing",
  minutes: 40,
  dimension: "2D + 3D",
  category: "TRUE 3D",
  requires3d: true,
  summary: "Compare furnace vs quench recalescence, test refiner fade, cast a 3D step block, measure stereology bias, and map steel Niyama risk.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.setCalibrated(false);
    host.setMaterial("al");
    host.clearMelt(0.65);
    host.setRun(false);
    host.syncUI();
  },
  columns: [
    { key: "run", label: "pour / slice" },
    { key: "grain", label: "d̄ / sites" },
    { key: "result", label: "σ_y / risk" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["recalescence-ratchet"];
    for (const [k, label] of [
      ["furnace", "2D furnace"],
      ["quench", "2D quench"],
    ] as const) {
      const m = asMap(s1?.[k]);
      if (!m) continue;
      rows.push({
        group: "3.1",
        label,
        values: {
          run: m.dTr_K != null ? `ΔT_r ${asNum(m.dTr_K)} K` : `ΔT_m ${asNum(m.dTmax_K) ?? "—"} K`,
          grain: `${asNum(m.dBarUm) ?? "—"} µm · ${asNum(m.sitesFired) ?? "—"}/${asNum(m.nMax) ?? "—"}`,
          result: m.sigmaY_MPa != null ? `${asNum(m.sigmaY_MPa)} MPa` : "—",
        },
      });
    }
    const s2 = byStep["refiner-fade"];
    if (s2 && Object.keys(s2).length) {
      rows.push({
        group: "3.2",
        label: `fade ${asNum(s2.holdMin) ?? "—"} min`,
        values: {
          run: `${asNum(s2.fadeSurvivalPct) ?? "—"} % left`,
          grain: `${asNum(s2.dBarUm) ?? "—"} µm · ${asNum(s2.sitesFired) ?? "—"} fired`,
          result: s2.sigmaY_MPa != null ? `${asNum(s2.sigmaY_MPa)} MPa` : "—",
        },
      });
    }
    const s3 = byStep["step-block-3d"];
    if (s3 && Array.isArray(s3.sections)) {
      for (const sec of s3.sections as LabCaptureMap[]) {
        rows.push({
          group: "3.3",
          label: `step ${asNum(sec.thicknessUm) ?? "—"} µm`,
          values: {
            run: s3.cRejected != null ? `H ${asNum(s3.cRejected)} rej.` : "air",
            grain: sec.dBarUm != null ? `${asNum(sec.dBarUm)} µm` : `${asNum(sec.grainCount) ?? "—"} gr`,
            result: sec.sigmaY_MPa != null ? `${asNum(sec.sigmaY_MPa)} MPa` : "—",
          },
        });
      }
    }
    const s4 = byStep["stereology-bias"];
    if (s4 && Object.keys(s4).length) {
      rows.push({
        group: "3.4",
        label: "stereology",
        values: {
          run: `depth ${Math.round((asNum(s4.sliceOff) ?? 0) * 100)} %`,
          grain: `d̄₂ ${asNum(s4.d2Um) ?? "—"} / d̄₃ ${asNum(s4.d3Um) ?? "—"}`,
          result: `ratio ${asNum(s4.ratioD2D3) ?? "—"}`,
        },
      });
    }
    const s5 = byStep["steel-niyama"];
    const sp = asMap(s5?.steelPour);
    const ins = asMap(s5?.inspected);
    if (sp || ins) {
      rows.push({
        group: "3.5",
        label: `steel ${String(sp?.mold ?? "3D")}`,
        values: {
          run: `Ny ${asNum(ins?.nyCritSI) ?? 0.775}`,
          grain: sp?.dBarUm != null ? `${asNum(sp.dBarUm)} µm` : "—",
          result: ins?.poreFracPct != null ? `pores ${asNum(ins.poreFracPct)} %` : sp?.sigmaY_MPa != null ? `${asNum(sp.sigmaY_MPa)} MPa` : "—",
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "recalescence-ratchet",
      title: "Slow vs fast cooling & recalescence",
      action:
        "Open lab mode in MODES (argon, inoculant sites 600, hold before pour 0 min) and complete both a furnace pour and a quench pour without intervening mid-run.",
      reveal: ["sec:MODES", "#foundry"],
      subgoals: [
        {
          id: "furnace",
          label: "furnace pour (600 sites)",
          match(_snap, ev) {
            return (
              ev?.kind === "lab-pour-finished" &&
              ev.dim === "2d" &&
              !ev.intervened &&
              ev.material === "al" &&
              ev.setup.atmosphere === "argon" &&
              ev.setup.inoculant >= 500 &&
              ev.setup.inoculant <= 700 &&
              ev.setup.holdMin === 0 &&
              ev.setup.program === "furnace"
            );
          },
          capture(snap, ev) {
            return captureLabPour(ev as Extract<LabEvent, { kind: "lab-pour-finished" }>, snap);
          },
        },
        {
          id: "quench",
          label: "quench pour (600 sites)",
          match(_snap, ev) {
            return (
              ev?.kind === "lab-pour-finished" &&
              ev.dim === "2d" &&
              !ev.intervened &&
              ev.material === "al" &&
              ev.setup.atmosphere === "argon" &&
              ev.setup.inoculant >= 500 &&
              ev.setup.inoculant <= 700 &&
              ev.setup.holdMin === 0 &&
              ev.setup.program === "quench"
            );
          },
          capture(snap, ev) {
            return captureLabPour(ev as Extract<LabEvent, { kind: "lab-pour-finished" }>, snap);
          },
        },
      ],
      takeaway:
        "Quenching extracts heat faster than early nuclei release latent heat, pushing ΔT_max deeper before recalescence halts nucleation and yielding finer, stronger grains from the same 600 sites.",
    },
    {
      id: "refiner-fade",
      title: "Grain-refiner fade before pour",
      action: "In lab mode, keep inoculant sites near 600, set hold before pour to at least 45 min with cooling program on air, and complete a pour.",
      reveal: ["#foundry"],
      check(_snap, ev) {
        return (
          ev?.kind === "lab-pour-finished" &&
          !ev.intervened &&
          ev.material === "al" &&
          ev.setup.inoculant >= 500 &&
          ev.setup.inoculant <= 700 &&
          ev.setup.holdMin >= 45
        );
      },
      capture(snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "lab-pour-finished" }>;
        return {
          ...captureLabPour(e, snap),
          holdMin: e.setup.holdMin,
          fadeSurvivalPct: round(e.fadeF * 100, 0),
          effInoc: e.effInoc,
        };
      },
      takeaway:
        "Holding an inoculated melt above its liquidus allows potent nucleants to settle and agglomerate, reducing active sites before the pour begins.",
    },
    {
      id: "step-block-3d",
      title: "3D step block & Sievert hydrogen",
      requires3d: true,
      action:
        "Exit lab mode, switch TRUE 3D ON, reopen lab mode on aluminum · Al–Cu (air atmosphere, mold walls ON, mold shape step, air cooling), and complete the pour.",
      reveal: ["#dimSwitch", "sec:MODES", "#foundry"],
      liveHint(snap) {
        if (snap.mode === "3d" && snap.labRunning) {
          return "tip: press ×2 or ×4 in transport to speed up (same cooling program in sim time), or choose 128³ in ENGINE if slow";
        }
        if (snap.mode !== "3d") return "exit lab mode and switch TRUE 3D ON";
        return null;
      },
      check(_snap, ev) {
        return (
          ev?.kind === "lab-pour-finished" &&
          ev.dim === "3d" &&
          !ev.intervened &&
          ev.material === "al" &&
          ev.setup.atmosphere === "air" &&
          ev.setup.moldWalls &&
          ev.setup.mold === "step" &&
          (ev.sections?.length ?? 0) === 4
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "lab-pour-finished" }>;
        return {
          sections: (e.sections ?? []).map(sec => {
            const dUm = dbarUm(sec.census, "3d", e.umPerCell);
            const sig = hallPetchMPa(e.si, dUm);
            return {
              thicknessUm: round(sec.heightVox * e.umPerCell, 0),
              grainCount: sec.census.grainCount,
              dBarUm: dUm != null ? round(dUm, 1) : null,
              sigmaY_MPa: sig != null ? round(sig, 1) : null,
            };
          }),
          cLiquid: e.porosity ? round(e.porosity.cLiquid, 2) : null,
          cRejected: e.porosity ? round(e.porosity.cRejected, 2) : null,
          poreBias: e.porosity ? round(e.porosity.pPore, 3) : null,
          csc: e.csc != null ? round(e.csc, 2) : null,
        };
      },
      takeaway:
        "Thin sections cool fastest through higher wall-area-to-volume ratio for finer, stronger grains, while humid air dissolves hydrogen that rejects across the freezing front.",
    },
    {
      id: "stereology-bias",
      title: "2D section bias vs true 3D stereology",
      requires3d: true,
      action: "Exit lab mode, select SLICE, enable stereology (2D section vs 3D) in VOLUME · 3D, and move depth in SECTION PLANE to compare d̄₂ against d̄₃.",
      reveal: ["#views", "sec:VOLUME · 3D", "#slicePop"],
      liveHint(snap, mem) {
        if (snap.mode !== "3d") return "switch TRUE 3D ON";
        if (snap.labActive) return "click exit in LAB MODE first";
        if (snap.viewName !== "SLICE") return "select SLICE on the lens bar";
        if (!snap.stereoOn) return "enable stereology (2D section vs 3D) in VOLUME · 3D";
        if (!snap.sliceSweep && mem.enteredSliceOff != null && Math.abs(snap.sliceOff - mem.enteredSliceOff) < 0.08) {
          return "drag depth in SECTION PLANE (or enable CT sweep)";
        }
        return null;
      },
      check(snap, _ev, mem) {
        return (
          snap.mode === "3d" &&
          !snap.labActive &&
          snap.viewName === "SLICE" &&
          snap.stereoOn &&
          snap.stereo != null &&
          snap.stereo.d2Um > 0 &&
          snap.stereo.d3Um > 0 &&
          (snap.sliceSweep || (mem.enteredSliceOff != null && Math.abs(snap.sliceOff - mem.enteredSliceOff) >= 0.08))
        );
      },
      capture(snap) {
        const st = snap.stereo!;
        return {
          sliceOff: round(snap.sliceOff, 2),
          sectionGrains: st.n2,
          d2Um: round(st.d2Um, 1),
          d3Um: round(st.d3Um, 1),
          ratioD2D3: round(st.ratio, 2),
          astmG2: st.astmG2 != null ? round(st.astmG2, 1) : null,
        };
      },
      takeaway:
        "A random 2D cut slices most grains off-equator, so section diameter d̄₂ underestimates true 3D diameter d̄₃ (near √(2/3) ≈ 0.82 for equal spheres).",
    },
    {
      id: "steel-niyama",
      title: "Steel shrinkage & Niyama criterion",
      requires3d: true,
      action:
        "Select steel · Fe–C in MATERIAL, pour a 3D wedge or shell casting (mold walls ON, air) in lab mode, then exit and inspect both FIELD and SLICE set to Niyama map · porosity risk.",
      reveal: ["sec:MATERIAL", "sec:MODES", "#slicePop"],
      liveHint(snap, mem) {
        if (snap.mode === "3d" && snap.labRunning) {
          return "tip: press ×2 or ×4 in transport to speed up (same cooling program in sim time), or choose 128³ in ENGINE if slow";
        }
        if (!mem.latched.steelPour) {
          if (snap.material !== "steel") return "pick steel · Fe–C in MATERIAL";
          return null;
        }
        if (snap.labActive) return "click exit in LAB MODE to inspect FIELD and SLICE";
        if (!mem.visitedLenses.includes("FIELD")) return "inspect shrinkage cavities in FIELD, then switch to SLICE";
        if (snap.viewName !== "SLICE" || snap.cutStyle !== 5) return "select SLICE and set cut style to Niyama map · porosity risk";
        return null;
      },
      subgoals: [
        {
          id: "steelPour",
          label: "3D steel wedge or shell pour",
          match(_snap, ev) {
            return (
              ev?.kind === "lab-pour-finished" &&
              ev.dim === "3d" &&
              !ev.intervened &&
              ev.material === "steel" &&
              ev.setup.moldWalls &&
              (ev.setup.mold === "wedge" || ev.setup.mold === "shell")
            );
          },
          capture(snap, ev) {
            return captureLabPour(ev as Extract<LabEvent, { kind: "lab-pour-finished" }>, snap);
          },
        },
        {
          id: "inspected",
          label: "FIELD + Niyama map · porosity risk",
          match(snap, _ev, mem) {
            return (
              Boolean(mem.latched.steelPour) &&
              snap.mode === "3d" &&
              snap.material === "steel" &&
              !snap.labActive &&
              mem.visitedLenses.includes("FIELD") &&
              snap.viewName === "SLICE" &&
              snap.cutStyle === 5
            );
          },
          capture(snap) {
            return {
              nyCritSI: 0.775,
              poreFracPct: snap.poreFrac != null ? round(snap.poreFrac * 100, 2) : null,
              nyRiskFracPct: snap.nyRiskFrac != null ? round(snap.nyRiskFrac * 100, 2) : null,
            };
          },
        },
      ],
      takeaway:
        "Pinched-off liquid pockets form shrinkage cavities in FIELD, and only steel carries the cited 0.775 K·s^½·mm⁻¹ radiographic Niyama threshold.",
    },
  ],
};

// ----------------------------------------------------------------------- Lab 4

const LAB_4: LabDef = {
  id: "lab-4",
  hashId: 4,
  number: "04",
  title: "Heat Treat & Hall–Petch Specs",
  course: "Physical Metallurgy · Mechanical Behavior",
  minutes: 40,
  dimension: "2D + 3D",
  category: "HEAT TREAT",
  requires3d: true,
  summary: "Compare Arrhenius stress relief vs coarsening, probe incipient melting, meet a Hall–Petch spec with Zener pinning, and test 3D Σ3 twinning.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.setCalibrated(false);
    host.setMaterial("al");
    host.setParams({
      scen: 0,
      heatIn: 0,
      facet: 0,
      delta: 0.045,
      aniMode: 4,
      noiseAmp: 0.012,
      latent: 1.5,
      coolRate: 0.45,
      alloyOn: 1,
    });
    host.setUndercool(0.65);
    host.setInoculant(1800);
    host.clearMelt(0.65);
    host.setView(1); // ORIENT
    host.setSpeed(26);
    host.setRun(false);
    host.syncUI();
  },
  columns: [
    { key: "schedule", label: "schedule" },
    { key: "grain", label: "d̄₀ → d̄" },
    { key: "strength", label: "σ_y / twins" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["arrhenius-two-clocks"];
    for (const [k, label] of [
      ["stressRelief", "stress relief"],
      ["highT", "unpinned soak"],
    ] as const) {
      const m = asMap(s1?.[k]);
      if (!m) continue;
      rows.push({
        group: "4.1",
        label,
        values: {
          schedule: `${asNum(m.tC) ?? "—"} °C · ${round((asNum(m.holdMin) ?? 0) / 60, 1)} h`,
          grain: `${asNum(m.d0Um) ?? "—"} → ${asNum(m.dAfterUm) ?? "—"} µm`,
          strength: `${asNum(m.sigmaBefore) ?? "—"} → ${asNum(m.sigmaAfter) ?? "—"} MPa`,
        },
      });
    }
    const s2 = byStep["incipient-and-ceiling"];
    const inc = asMap(s2?.incipient);
    if (inc) {
      rows.push({
        group: "4.2",
        label: "incipient",
        values: {
          schedule: `${asNum(inc.incipientTempC) ?? "—"} °C`,
          grain: `${asNum(inc.peakFracTm) ?? "—"} T_m`,
          strength: "refused",
        },
      });
    }
    const ceil = asMap(s2?.ceiling);
    if (ceil) {
      rows.push({
        group: "4.2",
        label: "HP ceiling",
        values: {
          schedule: `spec ≥ ${asNum(ceil.unreachableSpec_MPa) ?? "—"}`,
          grain: `cur ${asNum(ceil.currentSigmaY_MPa) ?? "—"} MPa`,
          strength: "unreachable",
        },
      });
    }
    const s3 = byStep["zener-spec-pass"];
    if (s3 && Object.keys(s3).length) {
      rows.push({
        group: "4.3",
        label: `Zener ${asNum(s3.pinF_volPct) ?? "—"} %`,
        values: {
          schedule: `d_lim ${asNum(s3.dLimUm) ?? "—"} µm`,
          grain: `${asNum(s3.d0Um) ?? "—"} → ${asNum(s3.dAfterUm) ?? "—"} µm`,
          strength: `${asNum(s3.sigmaAfter) ?? "—"} MPa (met)`,
        },
      });
    }
    const s4 = byStep["cu-twins-3d"];
    if (s4 && Object.keys(s4).length) {
      rows.push({
        group: "4.4",
        label: "3D Cu (SFE 78)",
        values: {
          schedule: `${asNum(s4.tC) ?? "—"} °C · ${asNum(s4.holdMin) ?? "—"} min`,
          grain: `${asNum(s4.d0Um) ?? "—"} → ${asNum(s4.dAfterUm) ?? "—"} µm`,
          strength: `${asNum(s4.twinsSpawned) ?? 0} Σ3 twins`,
        },
      });
    }
    const s5 = byStep["twin-refusal-3d"];
    if (s5 && Object.keys(s5).length) {
      rows.push({
        group: "4.5",
        label: `3D ${String(s5.material ?? "refusal")}`,
        values: {
          schedule: `${asNum(s5.tC) ?? "—"} °C · ${asNum(s5.holdMin) ?? "—"} min`,
          grain: String(s5.sfeOrStructure ?? "—"),
          strength: "0 twins (refused)",
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "arrhenius-two-clocks",
      title: "Stress relief vs high-T coarsening",
      action:
        "Press ▶ run until solid fraction passes 95 %, pause, open heat treat, and run both a stress relief (≤ 250 °C, ≥ 120 min) and an unpinned anneal (550–570 °C, 6–12 h, dispersion none).",
      reveal: ["#transport", "sec:MODES", "#heattreat"],
      liveHint(snap) {
        if (!snap.heatActive && snap.fracSolid < 0.95) {
          return `solid ${(snap.fracSolid * 100).toFixed(0)} % / 95 %${snap.running ? "" : ": press ▶ run"}`;
        }
        if (!snap.heatActive && snap.fracSolid >= 0.95) return "pause and open heat treat in MODES";
        return null;
      },
      subgoals: [
        {
          id: "stressRelief",
          label: "stress relief (≤ 250 °C, ≥ 2 h)",
          match(_snap, ev) {
            return (
              ev?.kind === "heat-finished" &&
              ev.dim === "2d" &&
              ev.material === "al" &&
              !ev.aborted &&
              ev.tC <= 250 &&
              ev.holdMin >= 120 &&
              ev.pinF === 0
            );
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
            return {
              tC: round(e.tC, 0),
              holdMin: round(e.holdMin, 0),
              d0Um: round(e.d0Um, 1),
              dAfterUm: round(e.dAfterUm, 1),
              dPredUm: round(e.dPredUm, 1),
              sigmaBefore: round(e.sigmaBefore, 1),
              sigmaAfter: round(e.sigmaAfter, 1),
              oxideNm: round(e.oxideNm, 1),
              sweeps: e.sweeps,
            };
          },
        },
        {
          id: "highT",
          label: "unpinned anneal (540–590 °C, ≥ 6 h)",
          match(_snap, ev) {
            return (
              ev?.kind === "heat-finished" &&
              ev.dim === "2d" &&
              ev.material === "al" &&
              !ev.aborted &&
              ev.tC >= 540 &&
              ev.tC <= 590 &&
              ev.holdMin >= 360 &&
              ev.pinF === 0
            );
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
            return {
              tC: round(e.tC, 0),
              holdMin: round(e.holdMin, 0),
              d0Um: round(e.d0Um, 1),
              dAfterUm: round(e.dAfterUm, 1),
              dPredUm: round(e.dPredUm, 1),
              sigmaBefore: round(e.sigmaBefore, 1),
              sigmaAfter: round(e.sigmaAfter, 1),
              oxideNm: round(e.oxideNm, 1),
              sweeps: e.sweeps,
            };
          },
        },
      ],
      takeaway:
        "Arrhenius kinetics leave 200 °C virtually unchanged while a high-temperature soak coarsens grains and lowers Hall–Petch yield strength on an hours clock.",
    },
    {
      id: "incipient-and-ceiling",
      title: "Incipient melting & Hall–Petch ceiling",
      action:
        "Inside heat treat, raise temperature to at least 635 °C to trigger incipient melting, then lower it below 600 °C and dial spec σ_y above the current strength.",
      reveal: ["#heattreat"],
      subgoals: [
        {
          id: "incipient",
          label: "incipient melting (≥ 0.97 T_m)",
          match(_snap, ev) {
            return ev?.kind === "heat-plan" && ev.dim === "2d" && !ev.ok && ev.reason === "incipient" && ev.peakFracTm >= 0.97;
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-plan" }>;
            return { incipientTempC: round(e.tC, 0), peakFracTm: round(e.peakFracTm, 3) };
          },
        },
        {
          id: "ceiling",
          label: "unreachable spec σ_y",
          match(_snap, ev) {
            return ev?.kind === "heat-plan" && ev.dim === "2d" && ev.ok && ev.specUnreachable && ev.specMPa > 0 && ev.currentSigmaY != null;
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-plan" }>;
            return {
              currentSigmaY_MPa: round(e.currentSigmaY!, 1),
              unreachableSpec_MPa: round(e.specMPa, 1),
            };
          },
        },
      ],
      takeaway:
        "Above 0.97 T_m grain boundaries liquefy, and pure coarsening can never raise strength above the as-cast value without precipitation aging (T6).",
    },
    {
      id: "zener-spec-pass",
      title: "Pass a strength spec with Zener pinning",
      action:
        "Click exit in heat treat, recast a fresh fine aluminum · Al–Cu specimen (reset, ▶ run past 95 %), reopen heat treat, set spec σ_y ≥ 30 MPa with a Zener dispersion, and pass a ≥ 540 °C, ≥ 360 min anneal.",
      reveal: ["#transport", "#heattreat"],
      liveHint(snap) {
        if (!snap.heatActive && snap.fracSolid < 0.95) {
          return `recast solid ${(snap.fracSolid * 100).toFixed(0)} % / 95 %${snap.running ? "" : ": click reset then ▶ run"}`;
        }
        return null;
      },
      check(_snap, ev) {
        return (
          ev?.kind === "heat-finished" &&
          ev.dim === "2d" &&
          ev.material === "al" &&
          !ev.aborted &&
          ev.tC >= 540 &&
          ev.holdMin >= 360 &&
          ev.pinF > 0 &&
          ev.specMPa >= 30 &&
          ev.specMet === true &&
          (ev.dLimUm == null || ev.dLimUm < ev.dPredUm)
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
        return {
          pinF_volPct: round(e.pinF * 100, 1),
          pinR_cells: e.pinR,
          dLimUm: e.dLimUm != null ? round(e.dLimUm, 1) : null,
          d0Um: round(e.d0Um, 1),
          dAfterUm: round(e.dAfterUm, 1),
          dPredUnpinnedUm: round(e.dPredUm, 1),
          sigmaBefore: round(e.sigmaBefore, 1),
          sigmaAfter: round(e.sigmaAfter, 1),
          specMPa: round(e.specMPa, 1),
          verdict: "met",
        };
      },
      takeaway:
        "Second-phase dispersoids pin grain boundaries at d_lim ∝ r^0.205 / f^0.356, preserving Hall–Petch yield strength through a high-temperature soak.",
    },
    {
      id: "cu-twins-3d",
      title: "3D Σ3 annealing twins in copper",
      requires3d: true,
      action:
        "Click exit in heat treat, switch TRUE 3D ON, pick copper · bronze in MATERIAL, run rain past 85 % solid, then open heat treat (780–800 °C, 30–60 min, dispersion none) and click ▶ run treatment.",
      reveal: ["#dimSwitch", "sec:MATERIAL", "sec:PRESETS", "sec:MODES"],
      liveHint(snap) {
        if (snap.mode !== "3d") return "click exit in heat treat and switch TRUE 3D ON";
        if (snap.material !== "cu") return "pick copper · bronze in MATERIAL";
        if (!snap.heatActive && snap.fracSolid < 0.85) {
          return `3D Cu solid ${(snap.fracSolid * 100).toFixed(0)} % / 85 %: run rain in PRESETS`;
        }
        return null;
      },
      check(_snap, ev) {
        return (
          ev?.kind === "heat-finished" &&
          ev.dim === "3d" &&
          ev.material === "cu" &&
          !ev.aborted &&
          ev.pinF === 0 &&
          ev.tC >= 750 &&
          ev.tC <= 840 &&
          ev.holdMin >= 15 &&
          ev.twinsSpawned > 0
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
        return {
          material: "cu",
          sfe: 78,
          tC: round(e.tC, 0),
          holdMin: round(e.holdMin, 0),
          d0Um: round(e.d0Um, 1),
          dAfterUm: round(e.dAfterUm, 1),
          twinsSpawned: e.twinsSpawned,
        };
      },
      takeaway:
        "Copper's low stacking-fault energy (78 mJ/m²) lets migrating boundaries nucleate and retain planar Σ3 annealing twins (60° about ⟨111⟩).",
    },
    {
      id: "twin-refusal-3d",
      title: "High-SFE aluminum or BCC steel refusal",
      requires3d: true,
      action:
        "Stay in TRUE 3D, pick aluminum · Al–Cu or steel · Fe–C in MATERIAL, recast rain past 85 % solid, then run a 30 min heat treat (500 °C aluminum or 900 °C steel) to verify the twin refusal.",
      reveal: ["sec:MATERIAL", "sec:PRESETS", "#heattreat"],
      liveHint(snap) {
        if (snap.mode !== "3d") return "stay in TRUE 3D";
        if (snap.material !== "al" && snap.material !== "steel") {
          return "pick aluminum · Al–Cu or steel · Fe–C in MATERIAL";
        }
        if (!snap.heatActive && snap.fracSolid < 0.85) {
          return `recast rain past 85 % solid (now ${(snap.fracSolid * 100).toFixed(0)} %)`;
        }
        return null;
      },
      check(_snap, ev) {
        return (
          ev?.kind === "heat-finished" &&
          ev.dim === "3d" &&
          (ev.material === "al" || ev.material === "steel") &&
          !ev.aborted &&
          ev.holdMin >= 15 &&
          ev.twinVerdictOk === false
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
        return {
          material: e.material,
          sfeOrStructure: e.material === "al" ? "166 mJ/m²" : "BCC δ-ferrite",
          tC: round(e.tC, 0),
          holdMin: round(e.holdMin, 0),
          twinRefusalWhy: e.twinRefusalWhy,
        };
      },
      takeaway:
        "Aluminum's high stacking-fault energy (166 mJ/m²) suppresses twinning, while steel here freezes as BCC δ-ferrite rather than FCC austenite.",
    },
  ],
};

const RX_MODE_LABELS = [
  "random, at once",
  "random, steady",
  "boundaries, at once",
  "boundaries, steady",
] as const;

function rxModeLabel(mode: number | undefined): string {
  const idx = typeof mode === "number" && Number.isInteger(mode) && mode >= 0 && mode < RX_MODE_LABELS.length ? mode : 0;
  return RX_MODE_LABELS[idx];
}

function fmtOrNA(v: unknown, suffix = ""): string {
  const n = asNum(v);
  return n != null ? `${n}${suffix}` : "n/a";
}

function recoveredPeakJb(workJb: number, rec: number): number {
  const h0 = Math.max(0, 2 * workJb);
  return h0 / (1 + Math.max(0, rec) * h0);
}

// ----------------------------------------------------------------------- Lab 5

const LAB_5: LabDef = {
  id: "lab-5",
  hashId: 5,
  number: "05",
  title: "Cold Work, Recovery & Recrystallization",
  course: "Physical Metallurgy · Thermomechanical Processing",
  minutes: 40,
  dimension: "3D",
  category: "HEAT TREAT",
  requires3d: true,
  summary:
    "Contrast sub-barrier vs active 3D cold work, measure second-order recovery, and fit Avrami exponents across nucleation modes.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    if (host.snapshot().can3d) {
      await host.setMode("3d");
      host.setCalibrated(false);
      host.setMaterial("al");
      host.setParams({
        scen: 0,
        heatIn: 0,
        facet: 0,
        twinProb: 0,
        pPore: 0,
        delta: 0.045,
        noiseAmp: 0.012,
        latent: 1.5,
        coolRate: 0.35,
      });
      host.setUndercool(0.75);
      host.setInoculant(600);
      host.clearMelt(0.75);
      host.setView(1); // ORIENT
      host.setSpeed(22);
      host.setRun(false);
    } else {
      await host.setMode("2d");
      host.setCalibrated(false);
      host.setMaterial("al");
      host.setRun(false);
    }
    host.syncUI();
  },
  columns: [
    { key: "drive", label: "work / mode" },
    { key: "kinetics", label: "recovery / X" },
    { key: "result", label: "d̄ / Avrami n" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["cold-work-barrier"];
    for (const [k, label] of [
      ["subBarrier", "sub-barrier"],
      ["aboveBarrier", "active SIBM"],
    ] as const) {
      const m = asMap(s1?.[k]);
      if (!m) continue;
      rows.push({
        group: "5.1",
        label,
        values: {
          drive: `${fmtOrNA(m.coldWorkJb)} J_b (0–${fmtOrNA(m.peakStartJb)})`,
          kinetics: `rec ${fmtOrNA(m.recovery)} · ${fmtOrNA(m.sweeps)} sw`,
          result: `${fmtOrNA(m.d0Um)} → ${fmtOrNA(m.dAfterUm)} µm`,
        },
      });
    }
    const s2 = byStep["recovery-withdrawal"];
    if (s2 && Object.keys(s2).length) {
      rows.push({
        group: "5.2",
        label: "recovery",
        values: {
          drive: `${fmtOrNA(s2.coldWorkJb)} J_b · withdrawn`,
          kinetics: `${fmtOrNA(s2.peakStartJb)} → ${fmtOrNA(s2.peakEndJb)} J_b`,
          result: asNum(s2.recoveredMeanJb) != null ? `mean ${asNum(s2.recoveredMeanJb)} J_b` : "—",
        },
      });
    }
    const s3 = byStep["rx-site-saturated"];
    if (s3 && Object.keys(s3).length) {
      rows.push({
        group: "5.3",
        label: "at once",
        values: {
          drive: `${fmtOrNA(s3.rxNuclei)} · random`,
          kinetics: `X ${fmtOrNA(s3.rxFraction)} · r² ${fmtOrNA(s3.avramiR2)}`,
          result: asNum(s3.avramiN) != null ? `n ${asNum(s3.avramiN)}` : "—",
        },
      });
    }
    const s4 = byStep["rx-mode-contrast"];
    const steady = asMap(s4?.steady);
    if (steady) {
      rows.push({
        group: "5.4",
        label: "steady",
        values: {
          drive: `${fmtOrNA(steady.rxNuclei)} · random`,
          kinetics: `X ${fmtOrNA(steady.rxFraction)} · r² ${fmtOrNA(steady.avramiR2)}`,
          result: asNum(steady.avramiN) != null ? `n ${asNum(steady.avramiN)}` : "—",
        },
      });
    }
    const boundary = asMap(s4?.boundary);
    if (boundary) {
      rows.push({
        group: "5.4",
        label: "boundaries",
        values: {
          drive: `${fmtOrNA(boundary.rxNuclei)} · ${String(boundary.rxModeLabel ?? "boundaries")}`,
          kinetics: `X ${fmtOrNA(boundary.rxFraction)} · r² ${fmtOrNA(boundary.avramiR2)}`,
          result: asNum(boundary.avramiN) != null ? `n ${asNum(boundary.avramiN)}` : "—",
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "cold-work-barrier",
      title: "Sub-barrier vs active cold work (3D SIBM)",
      requires3d: true,
      action:
        "Press ▶ run until solid fraction passes 90 %, pause, open heat treat (aluminum · Al–Cu, 490–520 °C, 45–90 min), and run both a sub-barrier cold work (1.0–2.5 J_b) and an active cold work (≥ 6.0 J_b, nuclei none).",
      reveal: ["#transport", "sec:MODES", "#heattreat"],
      liveHint(snap, mem) {
        if (snap.mode !== "3d") return "switch TRUE 3D ON";
        if (!snap.heatActive && snap.fracSolid < 0.90) {
          return `3D solid ${(snap.fracSolid * 100).toFixed(0)} % / 90 %${snap.running ? "" : ": press ▶ run"}`;
        }
        if (!snap.heatActive) return "pause and open heat treat in MODES";
        if (!mem.latched.subBarrier && !mem.latched.aboveBarrier) {
          return "run cold work 1.0–2.5 J_b and ≥ 6.0 J_b (nuclei none, 490–520 °C, 45–90 min)";
        }
        if (!mem.latched.subBarrier) return "now run sub-barrier cold work (1.0–2.5 J_b, nuclei none)";
        if (!mem.latched.aboveBarrier) return "now run active cold work (≥ 6.0 J_b, nuclei none)";
        return null;
      },
      subgoals: [
        {
          id: "subBarrier",
          label: "sub-barrier cold work (1.0–2.5 J_b)",
          match(_snap, ev) {
            const w = ev?.kind === "heat-finished" ? (ev.coldWorkJb ?? 0) : 0;
            return (
              ev?.kind === "heat-finished" &&
              ev.dim === "3d" &&
              !ev.aborted &&
              w >= 1.0 &&
              w <= 2.5 &&
              (ev.rxNuclei ?? 0) === 0 &&
              ev.sweeps >= 40
            );
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
            const w = e.coldWorkJb ?? 0;
            const rec = e.recovery ?? 0;
            return {
              material: e.material,
              tC: round(e.tC, 0),
              holdMin: round(e.holdMin, 0),
              coldWorkJb: round(w, 1),
              peakStartJb: round(2 * w, 1),
              recovery: round(rec, 3),
              recoveredMeanJb: e.recoveredMeanJb != null ? round(e.recoveredMeanJb, 2) : null,
              d0Um: round(e.d0Um, 1),
              dAfterUm: round(e.dAfterUm, 1),
              sweeps: e.sweeps,
              lawWithdrawn: e.lawWithdrawn ?? true,
            };
          },
        },
        {
          id: "aboveBarrier",
          label: "active cold work (≥ 6.0 J_b)",
          match(_snap, ev) {
            const w = ev?.kind === "heat-finished" ? (ev.coldWorkJb ?? 0) : 0;
            return (
              ev?.kind === "heat-finished" &&
              ev.dim === "3d" &&
              !ev.aborted &&
              w >= 6.0 &&
              (ev.rxNuclei ?? 0) === 0 &&
              ev.sweeps >= 40
            );
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
            const w = e.coldWorkJb ?? 0;
            const rec = e.recovery ?? 0;
            return {
              material: e.material,
              tC: round(e.tC, 0),
              holdMin: round(e.holdMin, 0),
              coldWorkJb: round(w, 1),
              peakStartJb: round(2 * w, 1),
              recovery: round(rec, 3),
              recoveredMeanJb: e.recoveredMeanJb != null ? round(e.recoveredMeanJb, 2) : null,
              d0Um: round(e.d0Um, 1),
              dAfterUm: round(e.dAfterUm, 1),
              sweeps: e.sweeps,
              lawWithdrawn: e.lawWithdrawn ?? true,
            };
          },
        },
      ],
      takeaway:
        "Far below the 26-neighbor flat-{100} barrier (8 J_b, onset near 5–6 J_b) boundaries barely respond to stored energy, whereas above it low-strain grains consume high-strain neighbors and the curvature growth law is withdrawn.",
    },
    {
      id: "recovery-withdrawal",
      title: "Second-order recovery & endpoint withdrawal",
      requires3d: true,
      action:
        "In 3D heat treat, set cold work to 8.0–10.0 J_b (nuclei none) with a schedule delivering at least 180 MC sweeps (for example 500–520 °C, 60–90 min on aluminum · Al–Cu) and click ▶ run treatment.",
      reveal: ["#heattreat"],
      liveHint(snap) {
        if (snap.mode !== "3d") return "switch TRUE 3D ON";
        if (!snap.heatActive) return "open heat treat in MODES";
        return "set cold work 8.0–10.0 J_b (nuclei none) at 500–520 °C for 60–90 min (≥ 180 MC sweeps)";
      },
      check(_snap, ev) {
        return (
          ev?.kind === "heat-finished" &&
          ev.dim === "3d" &&
          !ev.aborted &&
          (ev.coldWorkJb ?? 0) >= 8.0 &&
          (ev.rxNuclei ?? 0) === 0 &&
          ev.sweeps >= 180 &&
          (ev.recovery ?? 0) >= 0.15 &&
          ev.lawWithdrawn === true
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
        const w = e.coldWorkJb ?? 0;
        const rec = e.recovery ?? 0;
        const peakEnd = e.recoveredPeakJb ?? recoveredPeakJb(w, rec);
        return {
          tC: round(e.tC, 0),
          holdMin: round(e.holdMin, 0),
          coldWorkJb: round(w, 1),
          peakStartJb: round(2 * w, 1),
          peakEndJb: round(peakEnd, 2),
          recoveredMeanJb: e.recoveredMeanJb != null ? round(e.recoveredMeanJb, 2) : null,
          recovery: round(rec, 3),
          sweeps: e.sweeps,
          d0Um: round(e.d0Um, 1),
          dAfterUm: round(e.dAfterUm, 1),
          lawWithdrawn: true,
        };
      },
      takeaway:
        "Second-order recovery H_S = H₀ / (1 + rec·H₀) drains the most deformed grains fastest, narrowing the driving spread until boundary migration stalls while keeping the curvature law endpoint withdrawn.",
    },
    {
      id: "rx-site-saturated",
      title: "Site-saturated recrystallization & Avrami n",
      requires3d: true,
      action:
        "In 3D heat treat (cold work 8.0–10.0 J_b, 500–520 °C, 60–90 min), set nuclei to 150–400 with nucleation on random, at once and click ▶ run treatment to fit the Avrami exponent n.",
      reveal: ["#heattreat"],
      liveHint(snap) {
        if (snap.mode !== "3d") return "switch TRUE 3D ON";
        if (!snap.heatActive) return "open heat treat in MODES";
        return "set cold work 8.0–10.0 J_b, nuclei 150–400, nucleation random, at once, and ▶ run treatment";
      },
      check(_snap, ev) {
        return (
          ev?.kind === "heat-finished" &&
          ev.dim === "3d" &&
          !ev.aborted &&
          (ev.coldWorkJb ?? 0) >= 8.0 &&
          (ev.rxNuclei ?? 0) >= 100 &&
          (ev.rxMode ?? 0) === 0 &&
          ev.avramiN != null &&
          Number.isFinite(ev.avramiN) &&
          (ev.avramiPoints ?? 0) >= 4
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
        return {
          coldWorkJb: round(e.coldWorkJb ?? 0, 1),
          rxNuclei: e.rxNuclei ?? 0,
          rxPlaced: e.rxPlaced ?? 0,
          rxMode: 0,
          rxModeLabel: rxModeLabel(0),
          rxFraction: e.rxFraction != null ? round(e.rxFraction, 2) : null,
          avramiN: e.avramiN != null ? round(e.avramiN, 2) : null,
          avramiR2: e.avramiR2 != null ? round(e.avramiR2, 3) : null,
          avramiPoints: e.avramiPoints ?? null,
          sweeps: e.sweeps,
          dAfterUm: round(e.dAfterUm, 1),
        };
      },
      takeaway:
        "Strain-free nuclei (0 J_b) sweep deformed grains along a sigmoidal JMAK curve; the fitted Avrami exponent n is measured on the Monte Carlo sweep clock rather than furnace seconds.",
    },
    {
      id: "rx-mode-contrast",
      title: "Steady-rate vs grain-boundary nucleation",
      requires3d: true,
      action:
        "Keep cold work 8.0–10.0 J_b and nuclei 150–400, then run both nucleation on random, steady and a grain-boundary mode (boundaries, at once or boundaries, steady) to compare their Avrami exponents.",
      reveal: ["#heattreat"],
      liveHint(snap, mem) {
        if (snap.mode !== "3d") return "switch TRUE 3D ON";
        if (!snap.heatActive) return "open heat treat in MODES";
        if (!mem.latched.steady && !mem.latched.boundary) {
          return "run nucleation random, steady and boundaries, at once (or boundaries, steady)";
        }
        if (!mem.latched.steady) return "now run nucleation random, steady (cold work 8.0–10.0 J_b, nuclei 150–400)";
        if (!mem.latched.boundary) return "now run nucleation boundaries, at once or boundaries, steady";
        return null;
      },
      subgoals: [
        {
          id: "steady",
          label: "random, steady (constant rate)",
          match(_snap, ev) {
            return (
              ev?.kind === "heat-finished" &&
              ev.dim === "3d" &&
              !ev.aborted &&
              (ev.coldWorkJb ?? 0) >= 8.0 &&
              (ev.rxNuclei ?? 0) >= 100 &&
              ev.rxMode === 1 &&
              ev.avramiN != null &&
              Number.isFinite(ev.avramiN) &&
              (ev.avramiPoints ?? 0) >= 4
            );
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
            return {
              coldWorkJb: round(e.coldWorkJb ?? 0, 1),
              rxNuclei: e.rxNuclei ?? 0,
              rxPlaced: e.rxPlaced ?? 0,
              rxMode: 1,
              rxModeLabel: rxModeLabel(1),
              rxFraction: e.rxFraction != null ? round(e.rxFraction, 2) : null,
              avramiN: e.avramiN != null ? round(e.avramiN, 2) : null,
              avramiR2: e.avramiR2 != null ? round(e.avramiR2, 3) : null,
              avramiPoints: e.avramiPoints ?? null,
              sweeps: e.sweeps,
            };
          },
        },
        {
          id: "boundary",
          label: "boundaries, at once or steady",
          match(_snap, ev) {
            return (
              ev?.kind === "heat-finished" &&
              ev.dim === "3d" &&
              !ev.aborted &&
              (ev.coldWorkJb ?? 0) >= 8.0 &&
              (ev.rxNuclei ?? 0) >= 100 &&
              (ev.rxMode === 2 || ev.rxMode === 3) &&
              ev.avramiN != null &&
              Number.isFinite(ev.avramiN) &&
              (ev.avramiPoints ?? 0) >= 4
            );
          },
          capture(_snap, ev) {
            const e = ev as Extract<LabEvent, { kind: "heat-finished" }>;
            const mode = e.rxMode ?? 2;
            return {
              coldWorkJb: round(e.coldWorkJb ?? 0, 1),
              rxNuclei: e.rxNuclei ?? 0,
              rxPlaced: e.rxPlaced ?? 0,
              rxMode: mode,
              rxModeLabel: rxModeLabel(mode),
              rxFraction: e.rxFraction != null ? round(e.rxFraction, 2) : null,
              avramiN: e.avramiN != null ? round(e.avramiN, 2) : null,
              avramiR2: e.avramiR2 != null ? round(e.avramiR2, 3) : null,
              avramiPoints: e.avramiPoints ?? null,
              sweeps: e.sweeps,
            };
          },
        },
      ],
      takeaway:
        "Staggering births over sweeps (random, steady) raises the JMAK slope toward the constant-rate limit, whereas crowding nuclei onto grain boundaries triggers earlier impingement and bends n downward.",
    },
  ],
};

// ----------------------------------------------------------------------- Lab 6

const LAB_6: LabDef = {
  id: "lab-6",
  hashId: 6,
  number: "06",
  title: "Directional Growth, Melt Flow & Selection",
  course: "Solidification Processing · Transport & Texture",
  minutes: 40,
  dimension: "2D + 3D",
  category: "TRUE 3D",
  requires3d: true,
  summary:
    "Contrast 2D Bridgman G/V regimes, test qualitative LBM melt flow asymmetry, and stage the 3D helical grain selector with [001] pole figures.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.setFlowOn?.(false);
    host.setCalibrated(false);
    host.setMaterial("ni");
    host.applyScene("bridgman");
    host.setRun(false);
    host.syncUI();
  },
  columns: [
    { key: "regime", label: "regime / flow" },
    { key: "params", label: "G, V / speed" },
    { key: "outcome", label: "readout" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["bridgman-gv-contrast"];
    for (const [k, label] of [
      ["highGV", "high G/V"],
      ["lowGV", "low G/V"],
    ] as const) {
      const m = asMap(s1?.[k]);
      if (!m) continue;
      rows.push({
        group: "6.1",
        label,
        values: {
          regime: asNum(m.gvRatio) != null ? `G/V ${asNum(m.gvRatio)}` : "—",
          params: `G ${fmtOrNA(m.gradG)} · V ${fmtOrNA(m.pullV)}`,
          outcome: `${fmtOrNA(m.grainCount)} gr · f_s ${fmtOrNA(m.fracSolidPct)} %`,
        },
      });
    }
    const s2 = byStep["lbm-melt-flow"];
    const still = asMap(s2?.still);
    if (still) {
      rows.push({
        group: "6.2",
        label: "still melt",
        values: {
          regime: "flow OFF",
          params: "u 0.000",
          outcome: `f_s ${fmtOrNA(still.fracSolidPct)} % · t ${fmtOrNA(still.simTime)}`,
        },
      });
    }
    const flowing = asMap(s2?.flowing);
    if (flowing) {
      rows.push({
        group: "6.2",
        label: "LBM flow",
        values: {
          regime: "qualitative 2D",
          params: asNum(flowing.flowSpeed) != null ? `u ${asNum(flowing.flowSpeed)} cell/step` : "—",
          outcome: `f_s ${fmtOrNA(flowing.fracSolidPct)} % · t ${fmtOrNA(flowing.simTime)}`,
        },
      });
    }
    const s3 = byStep["selector-3d-staging"];
    if (s3 && Object.keys(s3).length) {
      rows.push({
        group: "6.3",
        label: "3D selector",
        values: {
          regime: `${fmtOrNA(s3.gridN)}³ pigtail`,
          params: `G ${fmtOrNA(s3.gradG)} · V ${fmtOrNA(s3.pullV)}`,
          outcome: `${fmtOrNA(s3.grainCount)} gr · f_s ${fmtOrNA(s3.fracSolidPct)} %`,
        },
      });
    }
    const s4 = byStep["selector-pole-figure"];
    if (s4 && Object.keys(s4).length) {
      rows.push({
        group: "6.4",
        label: "[001] texture",
        values: {
          regime: "SLICE + [001]",
          params: `depth ${Math.round((asNum(s4.sliceOff) ?? 0) * 100)} %`,
          outcome: `${fmtOrNA(s4.grainCount)} gr · f_s ${fmtOrNA(s4.fracSolidPct)} %`,
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "bridgman-gv-contrast",
      title: "Bridgman gradient G vs pull speed V",
      action:
        "In SCENARIO (bridgman), run a high-G/V pass (gradient ≥ 0.12, pull speed ≤ 1.5) past 25 % solid, then click reset and chill wall, set a low-G/V pass (gradient ≤ 0.10, pull speed ≥ 3.5), and run past 25 % solid.",
      reveal: ["sec:SCENARIO", "sec:MELT · PROCESS", "#transport"],
      liveHint(snap, mem) {
        if (snap.mode !== "2d") return "switch TRUE 3D OFF for 2D bridgman first";
        if (snap.params.scen !== 1) return "select bridgman in SCENARIO or PRESETS";
        const hi = mem.latched.highGV;
        const lo = mem.latched.lowGV;
        if (!hi && !lo) {
          return `set G ≥ 0.12, V ≤ 1.5 (now G ${snap.bridgmanG.toFixed(3)}, V ${snap.bridgmanV.toFixed(1)}) · solid ${(snap.fracSolid * 100).toFixed(0)} % / 25 %`;
        }
        const prevEpoch = asNum((hi ?? lo)?.resetEpoch);
        if (prevEpoch != null && snap.resetEpoch === prevEpoch) {
          return "click reset and chill wall before starting the second G/V pass";
        }
        if (!hi) {
          return `high G/V pass: set gradient ≥ 0.12, pull speed ≤ 1.5 · solid ${(snap.fracSolid * 100).toFixed(0)} % / 25 %`;
        }
        return `low G/V pass: set gradient ≤ 0.10, pull speed ≥ 3.5 · solid ${(snap.fracSolid * 100).toFixed(0)} % / 25 %`;
      },
      subgoals: [
        {
          id: "highGV",
          label: "high G/V (G ≥ 0.12, V ≤ 1.5, ≥ 25 %)",
          match(snap, _ev, mem) {
            const otherEpoch = asNum(mem.latched.lowGV?.resetEpoch);
            return (
              snap.mode === "2d" &&
              snap.params.scen === 1 &&
              snap.bridgmanG >= 0.12 &&
              snap.bridgmanV <= 1.5 &&
              snap.fracSolid >= 0.25 &&
              snap.grainCount >= 3 &&
              (otherEpoch == null || snap.resetEpoch !== otherEpoch)
            );
          },
          capture(snap) {
            return {
              gradG: round(snap.bridgmanG, 3),
              pullV: round(snap.bridgmanV, 1),
              gvRatio: round(snap.bridgmanG / Math.max(1e-6, snap.bridgmanV), 4),
              coolGV: round(snap.bridgmanG * snap.bridgmanV, 3),
              grainCount: snap.grainCount,
              fracSolidPct: round(snap.fracSolid * 100, 1),
              resetEpoch: snap.resetEpoch,
            };
          },
        },
        {
          id: "lowGV",
          label: "low G/V (G ≤ 0.10, V ≥ 3.5, ≥ 25 %)",
          match(snap, _ev, mem) {
            const otherEpoch = asNum(mem.latched.highGV?.resetEpoch);
            return (
              snap.mode === "2d" &&
              snap.params.scen === 1 &&
              snap.bridgmanG <= 0.10 &&
              snap.bridgmanV >= 3.5 &&
              snap.fracSolid >= 0.25 &&
              snap.grainCount >= 3 &&
              (otherEpoch == null || snap.resetEpoch !== otherEpoch)
            );
          },
          capture(snap) {
            return {
              gradG: round(snap.bridgmanG, 3),
              pullV: round(snap.bridgmanV, 1),
              gvRatio: round(snap.bridgmanG / Math.max(1e-6, snap.bridgmanV), 4),
              coolGV: round(snap.bridgmanG * snap.bridgmanV, 3),
              grainCount: snap.grainCount,
              fracSolidPct: round(snap.fracSolid * 100, 1),
              resetEpoch: snap.resetEpoch,
            };
          },
        },
      ],
      takeaway:
        "High G/V keeps the directional front compact while misaligned columns are crowded out; lowering G/V with faster pull speed V increases cooling rate G·V and drives finer branched dendrites.",
    },
    {
      id: "lbm-melt-flow",
      title: "Qualitative 2D melt flow & arm asymmetry",
      action:
        "Click dendrite in PRESETS and grow past 10 % solid with melt flow OFF, then click dendrite again, enable melt flow in SCENARIO (flow speed ≥ 0.02, show flow ON), and grow past 10 % solid.",
      reveal: ["sec:PRESETS", "sec:SCENARIO", "#views"],
      liveHint(snap, mem) {
        if (snap.mode !== "2d") return "stay in 2D mode (melt flow is 2D free growth only)";
        if (snap.gridN > 1024) return "choose 1024² or 512² in ENGINE for melt flow";
        if (snap.params.scen !== 0 || snap.resetEpoch <= mem.enteredAtEpoch) {
          return "click dendrite in PRESETS to stage a fresh free-growth melt";
        }
        const still = mem.latched.still;
        const flowing = mem.latched.flowing;
        if (!still && !flowing) {
          return snap.flowOn
            ? `flowing run: u ${snap.flowSpeed.toFixed(3)} · solid ${(snap.fracSolid * 100).toFixed(1)} % / 10 %`
            : `still run: solid ${(snap.fracSolid * 100).toFixed(1)} % / 10 %${snap.running ? "" : ": press ▶ run"}`;
        }
        const prevEpoch = asNum((still ?? flowing)?.resetEpoch);
        if (prevEpoch != null && snap.resetEpoch === prevEpoch) {
          return "click dendrite in PRESETS (or reset and seed) for a fresh comparison run";
        }
        if (!flowing) {
          if (!snap.flowOn) return "enable melt flow in SCENARIO (flow speed ≥ 0.02, show flow ON)";
          if (snap.flowSpeed < 0.02) return `raise flow speed ≥ 0.020 (now ${snap.flowSpeed.toFixed(3)})`;
          return `flowing run: solid ${(snap.fracSolid * 100).toFixed(1)} % / 10 %`;
        }
        if (snap.flowOn) return "turn melt flow OFF and click dendrite for the still-melt baseline";
        return `still run: solid ${(snap.fracSolid * 100).toFixed(1)} % / 10 %`;
      },
      subgoals: [
        {
          id: "still",
          label: "still dendrite (melt flow OFF, ≥ 10 %)",
          match(snap, _ev, mem) {
            const otherEpoch = asNum(mem.latched.flowing?.resetEpoch);
            return (
              snap.mode === "2d" &&
              snap.params.scen === 0 &&
              snap.resetEpoch > mem.enteredAtEpoch &&
              !snap.flowOn &&
              snap.fracSolid >= 0.10 &&
              (otherEpoch == null || snap.resetEpoch !== otherEpoch)
            );
          },
          capture(snap) {
            return {
              flowOn: false,
              flowSpeed: 0,
              simTime: round(snap.simTime, 3),
              fracSolidPct: round(snap.fracSolid * 100, 1),
              resetEpoch: snap.resetEpoch,
            };
          },
        },
        {
          id: "flowing",
          label: "LBM flow ON (flow speed ≥ 0.02, ≥ 10 %)",
          match(snap, _ev, mem) {
            const otherEpoch = asNum(mem.latched.still?.resetEpoch);
            return (
              snap.mode === "2d" &&
              snap.params.scen === 0 &&
              snap.resetEpoch > mem.enteredAtEpoch &&
              snap.flowOn &&
              snap.flowSpeed >= 0.02 &&
              snap.fracSolid >= 0.10 &&
              (otherEpoch == null || snap.resetEpoch !== otherEpoch)
            );
          },
          capture(snap) {
            return {
              flowOn: true,
              flowSpeed: round(snap.flowSpeed, 4),
              flowView: snap.flowView,
              simTime: round(snap.simTime, 3),
              fracSolidPct: round(snap.fracSolid * 100, 1),
              resetEpoch: snap.resetEpoch,
            };
          },
        },
      ],
      takeaway:
        "Forced left-to-right LBM flow thins the upstream thermal boundary layer and sweeps latent heat into the downstream wake, making the windward arm outgrow the leeward arm; this 2D channel solver is qualitative and omits buoyancy.",
    },
    {
      id: "selector-3d-staging",
      title: "3D helical pigtail grain selector",
      requires3d: true,
      action:
        "Switch TRUE 3D ON, click selector in PRESETS, and let the 64 chill-floor grains climb competitively into the helical pigtail past 12 % solid.",
      reveal: ["#dimSwitch", "sec:PRESETS", "#views"],
      liveHint(snap) {
        if (snap.mode !== "3d") return "switch TRUE 3D ON";
        if (snap.params.scen !== 3) return "click selector in PRESETS";
        if (snap.fracSolid < 0.12) {
          return `selector solid ${(snap.fracSolid * 100).toFixed(1)} % / 12 %${snap.running ? " (tip: ×2 or ×4 speeds growth)" : ": press ▶ run"}`;
        }
        return null;
      },
      check(snap) {
        return (
          snap.mode === "3d" &&
          snap.params.scen === 3 &&
          snap.fracSolid >= 0.12 &&
          snap.grainCount >= 1
        );
      },
      capture(snap) {
        return {
          gridN: snap.gridN,
          gradG: round(snap.bridgmanG, 2),
          pullV: round(snap.bridgmanV, 1),
          grainCount: snap.grainCount,
          fracSolidPct: round(snap.fracSolid * 100, 1),
          simTime: round(snap.simTime, 3),
        };
      },
      takeaway:
        "The 3D selector stages 64 chill-floor grains racing up a helical pigtail under directional pull; competitive channel geometry narrows survival without guaranteeing a single exiting grain.",
    },
    {
      id: "selector-pole-figure",
      title: "[001] pole figure & section texture",
      requires3d: true,
      action:
        "Keep the 3D selector past 15 % solid, enable pole figure [001] in VOLUME · 3D, switch to SLICE, and move depth in SECTION PLANE to inspect texture from starter block to pigtail.",
      reveal: ["sec:VOLUME · 3D", "#views", "#slicePop"],
      liveHint(snap, mem) {
        if (snap.mode !== "3d" || snap.params.scen !== 3) return "stay on the 3D selector preset";
        if (snap.fracSolid < 0.15) return `selector solid ${(snap.fracSolid * 100).toFixed(1)} % / 15 %`;
        if (!snap.pole001On && !snap.poleFigureOn) return "enable pole figure [001] in VOLUME · 3D";
        if (snap.viewName !== "SLICE") return "select SLICE on the lens bar";
        if (!snap.sliceSweep && mem.enteredSliceOff != null && Math.abs(snap.sliceOff - mem.enteredSliceOff) < 0.08) {
          return "drag depth in SECTION PLANE (or enable CT sweep)";
        }
        return null;
      },
      check(snap, _ev, mem) {
        return (
          snap.mode === "3d" &&
          snap.params.scen === 3 &&
          snap.fracSolid >= 0.15 &&
          (snap.pole001On || snap.poleFigureOn) &&
          snap.viewName === "SLICE" &&
          (snap.sliceSweep || (mem.enteredSliceOff != null && Math.abs(snap.sliceOff - mem.enteredSliceOff) >= 0.08))
        );
      },
      capture(snap) {
        return {
          gridN: snap.gridN,
          sliceOff: round(snap.sliceOff, 2),
          grainCount: snap.grainCount,
          fracSolidPct: round(snap.fracSolid * 100, 1),
          poleFigureOn: true,
        };
      },
      takeaway:
        "Each dot in pole figure [001] projects a grain's [001] crystal axis toward the center pull axis and scales by diameter, making directional alignment visible alongside serial sections.",
    },
  ],
};

// ----------------------------------------------------------------------- Lab 7

const LAB_7: LabDef = {
  id: "lab-7",
  hashId: 7,
  number: "07",
  title: "Inverse Process Design & Optimization",
  course: "Materials Design · Inverse Process Optimization",
  minutes: 40,
  dimension: "2D + 3D",
  category: "2D",
  requires3d: true,
  summary:
    "Compete against CMA-ES in 2D challenge, converge and live-verify a 2D recipe on the full grid, and run current-grid 3D diameter optimization.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.setFlowOn?.(false);
    host.setCalibrated(false);
    host.setMaterial("al");
    host.applyScene("rain");
    host.setRun(false);
    host.syncUI();
  },
  columns: [
    { key: "target", label: "target" },
    { key: "search", label: "measured / best" },
    { key: "outcome", label: "error / verdict" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["challenge-human-vs-cmaes"];
    if (s1 && Object.keys(s1).length) {
      rows.push({
        group: "7.1",
        label: "challenge",
        values: {
          target: asNum(s1.targetG) != null ? `ASTM G ${asNum(s1.targetG)}` : "—",
          search: `you ${fmtOrNA(s1.playerG)} · opt ${fmtOrNA(s1.aiG)}`,
          outcome: typeof s1.verdict === "string" && s1.verdict ? s1.verdict : "—",
        },
      });
    }
    const s2 = byStep["opt-2d-cmaes"];
    if (s2 && Object.keys(s2).length) {
      rows.push({
        group: "7.2",
        label: `2D CMA-ES (${fmtOrNA(s2.episodes)})`,
        values: {
          target: asNum(s2.targetG) != null ? `ASTM G ${asNum(s2.targetG)}` : "—",
          search: `G ${fmtOrNA(s2.bestG)} · ${fmtOrNA(s2.nmax)} sites`,
          outcome: asNum(s2.bestError) != null ? `|ΔG| ${asNum(s2.bestError)}` : "—",
        },
      });
    }
    const s3 = byStep["opt-2d-apply-verify"];
    const ver = asMap(s3?.verified);
    const app = asMap(s3?.applied);
    if (app || ver) {
      const searchG = asNum(app?.searchG);
      const liveG = asNum(ver?.liveG);
      const deltaG = asNum(ver?.deltaFromTarget);
      rows.push({
        group: "7.3",
        label: `full ${asNum(ver?.gridN) ?? 1024}² verify`,
        values: {
          target: searchG != null ? `search G ${searchG}` : "—",
          search: liveG != null ? `live G ${liveG}` : "applied",
          outcome: ver ? (deltaG != null ? `|ΔG| ${deltaG}` : "verified") : "pending cast",
        },
      });
    }
    const s4 = byStep["opt-3d-volume-search"];
    if (s4 && Object.keys(s4).length) {
      const unit = String(s4.unit ?? "µm");
      rows.push({
        group: "7.4",
        label: `3D ${fmtOrNA(s4.gridN)}³ (${fmtOrNA(s4.episodes)})`,
        values: {
          target: asNum(s4.targetDiam) != null ? `d̄ ${asNum(s4.targetDiam)} ${unit}` : "—",
          search: asNum(s4.bestDiam) != null ? `best ${asNum(s4.bestDiam)} ${unit}` : "—",
          outcome: asNum(s4.relErrorPct) != null ? `err ${asNum(s4.relErrorPct)} %` : "—",
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "challenge-human-vs-cmaes",
      title: "Human vs CMA-ES challenge (2D)",
      action:
        "Open challenge in MODES, click ▶ start, steer cooling rate and inoculant n_max to hit the target ASTM G, and let the 10-casting optimizer finish the verdict.",
      reveal: ["sec:MODES", "sec:MELT · PROCESS"],
      liveHint(snap) {
        if (snap.mode !== "2d") return "switch TRUE 3D OFF (challenge is 2D only)";
        if (!snap.challengeActive) return "open challenge in MODES and click ▶ start";
        return "steer cooling rate and inoculant n_max, then wait for the 10-casting optimizer verdict";
      },
      check(_snap, ev) {
        return ev?.kind === "challenge-finished" && Number.isFinite(ev.targetG) && Number.isFinite(ev.aiScore);
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "challenge-finished" }>;
        return {
          targetG: round(e.targetG, 1),
          playerG: e.playerG != null ? round(e.playerG, 2) : null,
          playerScore: round(e.playerScore, 2),
          aiG: e.aiG != null ? round(e.aiG, 2) : null,
          aiScore: round(e.aiScore, 2),
          youWin: e.youWin,
          verdict: e.youWin ? "you win" : "optimizer wins",
        };
      },
      takeaway:
        "Recalescence couples cooling rate and inoculant n_max nonlinearly, so manual steering often overshoots while CMA-ES adapts its search distribution across ten 256² castings.",
    },
    {
      id: "opt-2d-cmaes",
      title: "2D CMA-ES schedule optimization",
      action:
        "Click close in CHALLENGE, open optimizer in MODES, choose a target ASTM G, and press ▶ run until OPTIMIZER reports a best recipe.",
      reveal: ["sec:MODES", "#transport"],
      liveHint(snap) {
        if (snap.mode !== "2d") return "stay in 2D mode for the 2D optimizer";
        if (snap.challengeActive) return "click close in CHALLENGE first";
        if (!snap.optActive) return "open optimizer in MODES";
        if (!snap.running) return "press ▶ run in transport to start CMA-ES castings";
        return "CMA-ES searching on 256²: wait for the recipe report";
      },
      check(_snap, ev) {
        return (
          ev?.kind === "opt-2d-finished" &&
          ev.episodes >= 12 &&
          ev.bestG != null &&
          Number.isFinite(ev.bestG)
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "opt-2d-finished" }>;
        return {
          targetG: round(e.targetG, 1),
          episodes: e.episodes,
          bestG: e.bestG != null ? round(e.bestG, 2) : null,
          bestError: e.bestError != null ? round(e.bestError, 2) : null,
          converged: e.converged,
          undercool: round(e.recipe.undercool, 2),
          nmax: Math.round(e.recipe.nmax),
          cool: e.recipe.cool.map(v => round(v, 3)),
        };
      },
      takeaway:
        "Separable CMA-ES tunes five coupled parameters (undercooling, inoculant n_max, and three-stage cooling) on 256² castings to minimize |ΔG|.",
    },
    {
      id: "opt-2d-apply-verify",
      title: "Apply & live-verify recipe on full grid",
      action:
        "Click apply recipe in OPTIMIZER, then press ▶ run to solidify the full-grid casting past 85 % solid and compare live ASTM G against the 256² search result.",
      reveal: ["#labReport", "#transport"],
      liveHint(snap, mem) {
        if (!mem.latched.applied) {
          return snap.optActive
            ? "click apply recipe in OPTIMIZER"
            : "open optimizer in MODES, finish a search, and click apply recipe";
        }
        if (!snap.recipeActive) return "applied recipe cleared: re-apply from OPTIMIZER before running";
        if (snap.fracSolid < 0.85) {
          return `full-grid verify: solid ${(snap.fracSolid * 100).toFixed(0)} % / 85 %${snap.running ? "" : ": press ▶ run"}`;
        }
        return null;
      },
      subgoals: [
        {
          id: "applied",
          label: "apply recipe to full grid",
          match(snap, ev) {
            if (ev?.kind === "opt-2d-applied" && Number.isFinite(ev.targetG)) return true;
            // Also accept an armed/freshly-started full-grid recipe applied just before advancing to Step 7.3.
            return (
              snap.mode === "2d" &&
              !snap.optActive &&
              !snap.challengeActive &&
              snap.recipeActive &&
              snap.fracSolid < 0.25
            );
          },
          capture(snap, ev) {
            if (ev?.kind === "opt-2d-applied") {
              return {
                targetG: round(ev.targetG, 1),
                searchG: ev.recipe.astm != null ? round(ev.recipe.astm, 2) : null,
                undercool: round(ev.recipe.undercool, 2),
                nmax: Math.round(ev.recipe.nmax),
                resetEpoch: snap.resetEpoch,
              };
            }
            return {
              targetG: null,
              searchG: null,
              undercool: round(snap.lastResetUndercool, 2),
              nmax: Math.round(snap.inoculant),
              resetEpoch: snap.resetEpoch,
            };
          },
        },
        {
          id: "verified",
          label: "full-grid cast ≥ 85 % solid",
          match(snap, _ev, mem) {
            return (
              Boolean(mem.latched.applied) &&
              snap.mode === "2d" &&
              !snap.optActive &&
              !snap.challengeActive &&
              snap.recipeActive &&
              snap.fracSolid >= 0.85 &&
              snap.astm != null &&
              snap.grainCount >= 3
            );
          },
          capture(snap, _ev, mem) {
            const targetG = asNum(mem.latched.applied?.targetG);
            const liveG = snap.astm!;
            return {
              gridN: snap.gridN,
              liveG: round(liveG, 2),
              deltaFromTarget: targetG != null ? round(Math.abs(liveG - targetG), 2) : null,
              grainCount: snap.grainCount,
              fracSolidPct: round(snap.fracSolid * 100, 1),
            };
          },
        },
      ],
      takeaway:
        "Replaying the 256² CMA-ES recipe on the full 1024² grid tests scale transfer: a schedule optimized on a fast proxy domain must always be verified on the target casting size.",
    },
    {
      id: "opt-3d-volume-search",
      title: "Current-grid 3D diameter optimization",
      requires3d: true,
      action:
        "Switch TRUE 3D ON (choose 96³ in ENGINE for speed, aluminum · Al–Cu in MATERIAL, calibrated solver OFF), open optimizer in MODES, set casting budget to 4 or 8, and press ▶ run until the 3D search finishes.",
      reveal: ["#dimSwitch", "sec:ENGINE", "sec:MODES", "#transport"],
      liveHint(snap) {
        if (snap.mode !== "3d") return "switch TRUE 3D ON (tip: choose 96³ in ENGINE for fast episodes)";
        if (snap.calibrated) return "turn calibrated solver OFF in SCALE (3D optimizer uses Kobayashi)";
        if (!snap.optActive) return "open optimizer in MODES and set casting budget to 4 or 8";
        if (!snap.running) return "press ▶ run in transport to start 3D CMA-ES castings";
        return "3D CMA-ES running on current grid: press ×2 or ×4 in transport to speed up";
      },
      check(_snap, ev) {
        return (
          ev?.kind === "opt-3d-finished" &&
          ev.episodes >= 4 &&
          ev.validEpisodes >= 1 &&
          ev.bestDiam != null &&
          Number.isFinite(ev.bestDiam)
        );
      },
      capture(_snap, ev) {
        const e = ev as Extract<LabEvent, { kind: "opt-3d-finished" }>;
        return {
          material: e.material,
          gridN: e.gridN,
          targetDiam: round(e.targetDiam, 1),
          bestDiam: e.bestDiam != null ? round(e.bestDiam, 1) : null,
          unit: e.unit,
          episodes: e.episodes,
          validEpisodes: e.validEpisodes,
          relErrorPct: e.bestRelError != null ? round(e.bestRelError * 100, 1) : null,
        };
      },
      takeaway:
        "The 3D optimizer runs real castings directly on the active grid without proxy-grid transfer, minimizing relative error on sphere-equivalent volume grain diameter d̄ under the qualitative Kobayashi model.",
    },
  ],
};

// ----------------------------------------------------------------------- Lab 8

const LAB_8: LabDef = {
  id: "eutectic-jh",
  hashId: 8,
  number: "08",
  title: "Binary Eutectic Lamellar Growth & Jackson–Hunt Scaling",
  course: "Phase Transformations · Eutectic Solidification",
  minutes: 45,
  dimension: "2D",
  category: "ENGINES",
  summary:
    "Grow coupled Al–Cu lamellae in EUTECTIC, inspect the SOLUTE boundary layer, perturb spacing on the Jackson–Hunt curve, and test off-eutectic lever fractions.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.startEutectic?.("alcu");
    host.syncUI();
  },
  columns: [
    { key: "setup", label: "setup" },
    { key: "spacing", label: "spacing / ΔT" },
    { key: "phases", label: "phase f_α" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["eutectic-lamellae"];
    if (s1 && Object.keys(s1).length) {
      const fA = asNum(s1.fAlpha);
      rows.push({
        group: "8.1",
        label: `${String(s1.alloy ?? "alcu")} (${fmtOrNA(s1.seedPairs)} pairs)`,
        values: {
          setup: `V ${fmtOrNA(s1.pullV)} µm/s`,
          spacing: `λ ${fmtOrNA(s1.lambdaUm)} µm · ΔT ${fmtOrNA(s1.dTFrontK)} K`,
          phases: fA != null ? `${(fA * 100).toFixed(1)} %` : "—",
        },
      });
    }
    const s2 = byStep["eutectic-solute-layer"];
    if (s2 && Object.keys(s2).length) {
      const fA = asNum(s2.fAlpha);
      rows.push({
        group: "8.2",
        label: "SOLUTE lens",
        values: {
          setup: `step ${fmtOrNA(s2.step)}`,
          spacing: `λ ${fmtOrNA(s2.lambdaUm)} µm · ΔT ${fmtOrNA(s2.dTFrontK)} K`,
          phases: fA != null ? `${(fA * 100).toFixed(1)} %` : "—",
        },
      });
    }
    const s3 = byStep["eutectic-jh-bowl"];
    if (s3 && Object.keys(s3).length) {
      const fA = asNum(s3.fAlpha);
      rows.push({
        group: "8.3",
        label: `JH (${fmtOrNA(s3.seedPairs)} pairs)`,
        values: {
          setup: `λ_min ${fmtOrNA(s3.lambdaMinUm)} µm`,
          spacing: `λ ${fmtOrNA(s3.lambdaUm)} µm · ΔT ${fmtOrNA(s3.dTFrontK)} K`,
          phases: fA != null ? `${(fA * 100).toFixed(1)} %` : "—",
        },
      });
    }
    const s4 = byStep["eutectic-lever-shift"];
    if (s4 && Object.keys(s4).length) {
      const fA = asNum(s4.fAlpha);
      const fLev = asNum(s4.fAlphaLever);
      rows.push({
        group: "8.4",
        label: `c₀ ${fmtOrNA(s4.c0Off)}`,
        values: {
          setup: fLev != null ? `lever ${(fLev * 100).toFixed(1)} %` : "—",
          spacing: `λ ${fmtOrNA(s4.lambdaUm)} µm · ΔT ${fmtOrNA(s4.dTFrontK)} K`,
          phases: fA != null ? `${(fA * 100).toFixed(1)} %` : "—",
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "eutectic-lamellae",
      title: "Steady Al–Cu lamellar growth",
      action:
        "Run Al–Cu in EUTECTIC with PHASES active until steady alternating α/β lamellae pass 400 steps and report spacing λ.",
      reveal: ["#eutectic", "#transport"],
      liveHint(snap) {
        const e = snap.eutectic;
        if (!e?.open) return "switch to EUTECTIC in the rail switcher";
        if (e.step < 400) {
          return `lamellar growth: step ${e.step} / 400${e.running ? "" : ": press ▶ run"}`;
        }
        if (e.lambdaUm == null || !Number.isFinite(e.lambdaUm)) return "waiting for lamellar spacing λ readback";
        if (!(e.maxSimplexErr < 1e-4)) return "simplex error elevated: click reset";
        return null;
      },
      check(snap) {
        const e = snap.eutectic;
        return Boolean(
          e &&
          e.open &&
          e.step >= 400 &&
          e.lambdaUm != null &&
          Number.isFinite(e.lambdaUm) &&
          e.lambdaUm > 0 &&
          Number.isFinite(e.maxSimplexErr) &&
          e.maxSimplexErr < 1e-4,
        );
      },
      capture(snap) {
        const e = snap.eutectic!;
        return {
          alloy: e.alloy,
          seedPairs: e.seedPairs,
          pullV: round(e.pullV, 1),
          step: e.step,
          lambdaUm: e.lambdaUm != null ? round(e.lambdaUm, 2) : null,
          lambdaMinUm: round(e.lambdaMinUm, 2),
          dTFrontK: round(e.dTFrontK, 2),
          fAlpha: round(e.fAlpha, 3),
          fAlphaLever: round(e.fAlphaLever, 3),
          maxSimplexErr: Number(e.maxSimplexErr.toExponential(2)),
        };
      },
      takeaway:
        "Coupled α-Al and θ-Al₂Cu lamellae advance together by exchanging rejected solute laterally across triple junctions while preserving the simplex sum p_α + p_β + p_L = 1.",
    },
    {
      id: "eutectic-solute-layer",
      title: "Inspect the SOLUTE diffusion layer",
      action:
        "Switch the top lens bar to SOLUTE and let the coupled front advance past 600 steps to inspect the alternating boundary layer ahead of the α/β triple junctions.",
      reveal: ["#views", "#eutectic"],
      liveHint(snap) {
        const e = snap.eutectic;
        if (!e?.open) return "keep EUTECTIC open in the rail switcher";
        if (e.lens !== 1) return "select SOLUTE on the top lens bar";
        if (e.step < 600) {
          return `SOLUTE active: step ${e.step} / 600${e.running ? "" : ": press ▶ run"}`;
        }
        return null;
      },
      check(snap) {
        const e = snap.eutectic;
        return Boolean(e && e.open && e.lens === 1 && e.step >= 600);
      },
      capture(snap) {
        const e = snap.eutectic!;
        return {
          lens: "SOLUTE",
          step: e.step,
          lambdaUm: e.lambdaUm != null ? round(e.lambdaUm, 2) : null,
          dTFrontK: round(e.dTFrontK, 2),
          fAlpha: round(e.fAlpha, 3),
        };
      },
      takeaway:
        "The SOLUTE lens reveals the periodic liquid diffusion layer of thickness ~λ/2 where copper rejected ahead of α-Al feeds neighboring θ-Al₂Cu tips laterally.",
    },
    {
      id: "eutectic-jh-bowl",
      title: "Perturb spacing on the Jackson–Hunt curve",
      action:
        "Move seed pairs away from 6 in EUTECTIC and grow past 400 steps to watch the operating point climb the ΔT(λ) Jackson–Hunt bowl.",
      reveal: ["#eutectic", "#eutJhPlot"],
      liveHint(snap) {
        const e = snap.eutectic;
        if (!e?.open) return "keep EUTECTIC open in the rail switcher";
        if (e.seedPairs === 6) return "change seed pairs away from 6 (for example 3 or 10) in EUTECTIC";
        if (e.step < 400 || !(e.dTFrontK > 0)) {
          return `seed pairs ${e.seedPairs}: step ${e.step} / 400${e.running ? "" : ": press ▶ run"}`;
        }
        return null;
      },
      check(snap) {
        const e = snap.eutectic;
        return Boolean(
          e &&
          e.open &&
          e.seedPairs !== 6 &&
          e.step >= 400 &&
          Number.isFinite(e.dTFrontK) &&
          e.dTFrontK > 0,
        );
      },
      capture(snap) {
        const e = snap.eutectic!;
        return {
          seedPairs: e.seedPairs,
          step: e.step,
          lambdaUm: e.lambdaUm != null ? round(e.lambdaUm, 2) : null,
          lambdaMinUm: round(e.lambdaMinUm, 2),
          dTFrontK: round(e.dTFrontK, 2),
          fAlpha: round(e.fAlpha, 3),
        };
      },
      takeaway:
        "Wide spacing lengthens lateral diffusion (K₁Vλ) while tight spacing raises curvature undercooling (K₂/λ), so moving seed pairs off the minimum pushes the front up the ΔT(λ) bowl.",
    },
    {
      id: "eutectic-lever-shift",
      title: "Off-eutectic composition & lever rule",
      action:
        "Shift composition c₀ by at least ±0.10 in EUTECTIC and grow past 300 steps (click reset if needed) to verify the lever-rule phase-fraction shift.",
      reveal: ["#eutectic", "#transport"],
      liveHint(snap) {
        const e = snap.eutectic;
        if (!e?.open) return "keep EUTECTIC open in the rail switcher";
        if (Math.abs(e.c0Off) < 0.10) {
          return `shift composition c₀ to |c₀| ≥ 0.10 (now ${e.c0Off.toFixed(2)})`;
        }
        if (e.step < 300) {
          return `c₀ ${e.c0Off.toFixed(2)}: step ${e.step} / 300${e.running ? "" : ": press ▶ run"}`;
        }
        if (Math.abs(e.fAlpha - 0.5) < 0.04) {
          return `waiting for f_α shift away from 50 % (now ${(e.fAlpha * 100).toFixed(1)} % · click reset or press ▶ run)`;
        }
        return null;
      },
      check(snap) {
        const e = snap.eutectic;
        return Boolean(
          e &&
          e.open &&
          Math.abs(e.c0Off) >= 0.10 &&
          e.step >= 300 &&
          Number.isFinite(e.fAlpha) &&
          Math.abs(e.fAlpha - 0.5) >= 0.04,
        );
      },
      capture(snap) {
        const e = snap.eutectic!;
        return {
          c0Off: round(e.c0Off, 2),
          step: e.step,
          lambdaUm: e.lambdaUm != null ? round(e.lambdaUm, 2) : null,
          dTFrontK: round(e.dTFrontK, 2),
          fAlpha: round(e.fAlpha, 3),
          fAlphaLever: round(e.fAlphaLever, 3),
        };
      },
      takeaway:
        "Shifting liquid composition c₀ off the eutectic point widens the richer phase and narrows the lean phase, tracking the binary lever-rule solid fraction behind the front.",
    },
  ],
};

// ----------------------------------------------------------------------- Lab 9

const LAB_9: LabDef = {
  id: "spinodal-lsw",
  hashId: 9,
  number: "09",
  title: "Spinodal Decomposition, Lyapunov Decay & 3D Coarsening",
  course: "Phase Transformations · Cahn–Hilliard Kinetics",
  minutes: 45,
  dimension: "2D + 3D",
  category: "ENGINES",
  summary:
    "Verify NIST PFHub B1 free-energy decay and mass conservation in SPINODAL, inspect CHEM μ gradients, track Fe–Cr coarsening, and orbit the 3D sponge.",
  async setup(host: LabRunnerHost) {
    host.closeModes();
    await host.setMode("2d");
    host.startSpinodal?.("pfhub1", "2d");
    host.syncUI();
  },
  columns: [
    { key: "regime", label: "preset / dim" },
    { key: "thermo", label: "F / mass drift" },
    { key: "coarsen", label: "L / LSW α" },
  ],
  formatRows(byStep): LabTableRow[] {
    const rows: LabTableRow[] = [];
    const s1 = byStep["spinodal-pfhub-lyapunov"];
    if (s1 && Object.keys(s1).length) {
      rows.push({
        group: "9.1",
        label: "PFHub B1 (2D)",
        values: {
          regime: `t ${fmtOrNA(s1.simTime)}`,
          thermo: `F ${fmtOrNA(s1.freeEnergy)} (${fmtOrNA(s1.fRatioPct, " %")})`,
          coarsen: `L ${fmtOrNA(s1.domainL)}`,
        },
      });
    }
    const s2 = byStep["spinodal-chem-mu"];
    if (s2 && Object.keys(s2).length) {
      rows.push({
        group: "9.2",
        label: "CHEM μ lens",
        values: {
          regime: `2D · t ${fmtOrNA(s2.simTime)}`,
          thermo: `F ${fmtOrNA(s2.freeEnergy)}`,
          coarsen: `L ${fmtOrNA(s2.domainL)}`,
        },
      });
    }
    const s3 = byStep["spinodal-lsw-coarsening"];
    if (s3 && Object.keys(s3).length) {
      rows.push({
        group: "9.3",
        label: `${String(s3.preset ?? "fecr")} (2D)`,
        values: {
          regime: `t ${fmtOrNA(s3.simTime)}`,
          thermo: `F ${fmtOrNA(s3.freeEnergy)}`,
          coarsen: `L ${fmtOrNA(s3.domainL)} · α ${fmtOrNA(s3.lswSlope)}`,
        },
      });
    }
    const s4 = byStep["spinodal-3d-sponge"];
    if (s4 && Object.keys(s4).length) {
      rows.push({
        group: "9.4",
        label: `3D 64³ (${String(s4.preset ?? "pfhub1")})`,
        values: {
          regime: `t ${fmtOrNA(s4.simTime)}`,
          thermo: `F ${fmtOrNA(s4.freeEnergy)} · Δ ${fmtOrNA(s4.massDrift)}`,
          coarsen: `L ${fmtOrNA(s4.domainL)}`,
        },
      });
    }
    return rows;
  },
  steps: [
    {
      id: "spinodal-pfhub-lyapunov",
      title: "NIST PFHub B1 Lyapunov decay",
      action:
        "Evolve NIST PFHub B1 in 2D SPINODAL with COMP active past t = 15 until free energy F drops below 78 % of its initial value while mean ⟨c⟩ stays conserved.",
      reveal: ["#spinodal", "#spinPlot"],
      liveHint(snap) {
        const sp = snap.spinodal;
        if (!sp?.open) return "switch to SPINODAL in the rail switcher";
        if (sp.dim !== "2d") return "select 2D in SPINODAL";
        if (sp.preset !== "pfhub1") return "select NIST PFHub B1 in SPINODAL";
        const ratio = sp.initialFreeEnergy > 0 ? sp.freeEnergy / sp.initialFreeEnergy : 1;
        if (sp.simTime < 15 || ratio >= 0.78) {
          return `t ${sp.simTime.toFixed(1)} / 15 · F/F₀ ${(ratio * 100).toFixed(0)} %${sp.running ? "" : ": press ▶ run"}`;
        }
        if (!(Math.abs(sp.massDrift) < 1e-4)) return "mass drift exceeded 1e-4: click reset";
        return null;
      },
      check(snap) {
        const sp = snap.spinodal;
        return Boolean(
          sp &&
          sp.open &&
          sp.dim === "2d" &&
          sp.preset === "pfhub1" &&
          sp.simTime >= 15 &&
          sp.initialFreeEnergy > 0 &&
          Number.isFinite(sp.freeEnergy) &&
          sp.freeEnergy >= 0 &&
          sp.freeEnergy < sp.initialFreeEnergy * 0.78 &&
          Number.isFinite(sp.massDrift) &&
          Math.abs(sp.massDrift) < 1e-4,
        );
      },
      capture(snap) {
        const sp = snap.spinodal!;
        const fRatioPct = sp.initialFreeEnergy > 0 ? round((sp.freeEnergy / sp.initialFreeEnergy) * 100, 1) : null;
        return {
          preset: sp.preset,
          dim: sp.dim,
          simTime: round(sp.simTime, 2),
          freeEnergy: round(sp.freeEnergy, 2),
          initialFreeEnergy: round(sp.initialFreeEnergy, 2),
          fRatioPct,
          meanC: round(sp.meanC, 4),
          massDrift: Number(Math.abs(sp.massDrift).toExponential(2)),
          domainL: round(sp.domainL, 2),
        };
      },
      takeaway:
        "The conserved Cahn–Hilliard PDE drives total free energy F(t) monotonically downward as a Lyapunov functional while the zero-sum periodic stencil conserves ⟨c⟩.",
    },
    {
      id: "spinodal-chem-mu",
      title: "Inspect CHEM μ potential gradients",
      action:
        "Switch the top lens bar to CHEM μ while 2D SPINODAL is past t = 15 to visualize the curvature-driven chemical-potential gradients powering domain coarsening.",
      reveal: ["#views", "#spinodal"],
      liveHint(snap) {
        const sp = snap.spinodal;
        if (!sp?.open) return "keep SPINODAL open in the rail switcher";
        if (sp.dim !== "2d") return "stay in 2D SPINODAL to inspect CHEM μ";
        if (sp.lens !== 1) return "select CHEM μ on the top lens bar";
        if (sp.simTime < 15) {
          return `CHEM μ active: t ${sp.simTime.toFixed(1)} / 15${sp.running ? "" : ": press ▶ run"}`;
        }
        return null;
      },
      check(snap) {
        const sp = snap.spinodal;
        return Boolean(sp && sp.open && sp.dim === "2d" && sp.lens === 1 && sp.simTime >= 15);
      },
      capture(snap) {
        const sp = snap.spinodal!;
        return {
          lens: "CHEM μ",
          dim: sp.dim,
          simTime: round(sp.simTime, 2),
          freeEnergy: round(sp.freeEnergy, 2),
          domainL: round(sp.domainL, 2),
        };
      },
      takeaway:
        "In CHEM μ, elevated chemical potential around tightly curved lobes drives diffusive flux toward flatter interfaces, coarsening the microstructure via Gibbs–Thomson ripening.",
    },
    {
      id: "spinodal-lsw-coarsening",
      title: "Alloy coarsening & LSW scaling",
      action:
        "Switch preset in SPINODAL to Fe–Cr (475 °C) (or Al–Zn or Off-critical droplets), run past t = 20, and track domain L(t) against the t^(1/3) LSW slope.",
      reveal: ["#spinodal", "#spinPlotL"],
      liveHint(snap) {
        const sp = snap.spinodal;
        if (!sp?.open) return "keep SPINODAL open in the rail switcher";
        if (sp.preset === "pfhub1") return "switch preset to Fe–Cr (475 °C), Al–Zn, or Off-critical droplets";
        if (sp.simTime < 20 || !(sp.domainL > 0)) {
          return `${sp.preset}: t ${sp.simTime.toFixed(1)} / 20${sp.running ? "" : ": press ▶ run"}`;
        }
        return null;
      },
      check(snap) {
        const sp = snap.spinodal;
        return Boolean(
          sp &&
          sp.open &&
          sp.preset !== "pfhub1" &&
          sp.simTime >= 20 &&
          Number.isFinite(sp.domainL) &&
          sp.domainL > 0,
        );
      },
      capture(snap) {
        const sp = snap.spinodal!;
        return {
          preset: sp.preset,
          dim: sp.dim,
          simTime: round(sp.simTime, 2),
          freeEnergy: round(sp.freeEnergy, 2),
          massDrift: Number(Math.abs(sp.massDrift).toExponential(2)),
          domainL: round(sp.domainL, 2),
          lswSlope: sp.lswSlope != null && Number.isFinite(sp.lswSlope) ? round(sp.lswSlope, 3) : null,
        };
      },
      takeaway:
        "Once compositions saturate near the binodal wells, diffusion-limited coarsening enters the Lifshitz–Slyozov–Wagner scaling regime L(t) ~ t^(1/3) as interfacial area shrinks.",
    },
    {
      id: "spinodal-3d-sponge",
      title: "3D bicontinuous spinodal sponge",
      action:
        "Click 3D in SPINODAL and evolve past t = 8 with conserved ⟨c⟩, then orbit the 64³ raymarched sponge across ISO 3D, SLICE, and VOL.",
      reveal: ["#spinDim3d", "#views"],
      liveHint(snap) {
        const sp = snap.spinodal;
        if (!sp?.open) return "keep SPINODAL open in the rail switcher";
        if (sp.dim !== "3d") return "click 3D in SPINODAL to switch to the 64³ solver";
        if (sp.simTime < 8) {
          return `3D sponge: t ${sp.simTime.toFixed(1)} / 8${sp.running ? "" : ": press ▶ run"}`;
        }
        if (!(Math.abs(sp.massDrift) < 1e-4)) return "mass drift exceeded 1e-4: click reset";
        return null;
      },
      check(snap) {
        const sp = snap.spinodal;
        return Boolean(
          sp &&
          sp.open &&
          sp.dim === "3d" &&
          sp.simTime >= 8 &&
          Number.isFinite(sp.massDrift) &&
          Math.abs(sp.massDrift) < 1e-4,
        );
      },
      capture(snap) {
        const sp = snap.spinodal!;
        return {
          preset: sp.preset,
          dim: "3d",
          simTime: round(sp.simTime, 2),
          freeEnergy: round(sp.freeEnergy, 2),
          meanC: round(sp.meanC, 4),
          massDrift: Number(Math.abs(sp.massDrift).toExponential(2)),
          domainL: round(sp.domainL, 2),
          lswSlope: sp.lswSlope != null && Number.isFinite(sp.lswSlope) ? round(sp.lswSlope, 3) : null,
        };
      },
      takeaway:
        "Near critical composition c₀ = 0.5, 3D spinodal decomposition percolates into an interconnected bicontinuous sponge whose saddle-shaped necks pinch off as domains coarsen.",
    },
  ],
};

export const LABS: readonly LabDef[] = [LAB_1, LAB_2, LAB_3, LAB_4, LAB_5, LAB_6, LAB_7, LAB_8, LAB_9];

export function findLabDef(idOrHash: string | number, catalog: readonly LabDef[] = LABS): LabDef | null {
  const raw = String(idOrHash).trim().toLowerCase();
  if (!raw) return null;
  const num = Number(raw);
  for (const lab of catalog) {
    if (Number.isInteger(num) && lab.hashId === num) return lab;
    if (lab.id.toLowerCase() === raw) return lab;
  }
  return null;
}
