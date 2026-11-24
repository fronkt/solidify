/**
 * Declarative 4-lab, 20-step undergraduate MSE curriculum for SOLIDIFY Guided Labs.
 *
 * Pure data + pure predicates with zero DOM or WebGPU runtime imports so Node CI
 * (`scripts/verify-guided-labs.mjs`) can validate schema, copy rules, and synthetic
 * trajectories directly. Adding Lab 5+ requires appending one `LabDef` entry to `LABS`.
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

export const LABS: readonly LabDef[] = [LAB_1, LAB_2, LAB_3, LAB_4];

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
