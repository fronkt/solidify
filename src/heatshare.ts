/**
 * The heat-treatment share tuple: the `ht` element of a `#set=` link.
 *
 * Pure so a browser-free gate can round-trip it (verify-recrystallize.mjs,
 * RX-SHARE-TUPLE): moved here unchanged from heatpanel.ts's setup() and its
 * restore block when C3b-3/4a added an eighth element, so the legacy shapes
 * are pinned against the old decoder's field values rather than re-derived.
 *
 * Shape: temperature °C, hold minutes, spec σ_y MPa (0 = none), then optional
 * tails, each present exactly when the mode it carries is in use: the Zener
 * dispersion's fraction and radius in cells (v7.0 C2), the cold work in bond
 * energies (v7.0 C3a), the recrystallization nuclei (C3b) and the nucleation
 * mode (C3b-3/4a, 1-3; the default 0 is never packed). A tail rides BEHIND
 * the ones before it with their off values spelled out, because a positional
 * tail with a hole in it cannot be decoded.
 */

/** the cold-work dial's ceiling and step, in bond energies (heatpanel.ts says why) */
export const WORK_MAX = 10;
export const WORK_STEP = 0.5;
/** C3b: recrystallization nuclei per treatment, and the dial's step */
export const RX_MAX = 1000;
export const RX_STEP = 25;
/**
 * C3b-3/4a: the nucleation select, in mode order. Bit 0 is the steady rate,
 * bit 1 boundary sites; 0 is the C3b at-once, random-site default.
 */
export const RX_MODES = ["random, at once", "random, steady", "boundaries, at once", "boundaries, steady"] as const;
export const rxSteady = (mode: number): boolean => (mode & 1) === 1;
export const rxBoundary = (mode: number): boolean => (mode & 2) === 2;

export type HeatTuple = [number, number, number, number?, number?, number?, number?, number?];

export interface HeatDials {
  tC: number;
  holdMin: number;
  specMPa: number;
  pinF: number;
  pinR: number;
  workJb: number;
  rxN: number;
  rxMode: number;
}

/** the dialled setup as a tuple, the shortest shape that carries it */
export function packHeatSetup(d: HeatDials): HeatTuple {
  // C3b-3/4a's mode rides behind the nuclei, packed only when not the default
  if (d.rxN > 0 && d.rxMode !== 0) return [d.tC, d.holdMin, d.specMPa, d.pinF, d.pinR, d.workJb, d.rxN, d.rxMode];
  // C3b's nuclei ride behind the work element, packed only when dialled
  if (d.rxN > 0) return [d.tC, d.holdMin, d.specMPa, d.pinF, d.pinR, d.workJb, d.rxN];
  if (d.workJb > 0) return [d.tC, d.holdMin, d.specMPa, d.pinF, d.pinR, d.workJb];
  return d.pinF > 0
    ? [d.tC, d.holdMin, d.specMPa, d.pinF, d.pinR]
    : [d.tC, d.holdMin, d.specMPa];
}

/** the material's own dial ranges a restored link is clamped into */
export interface HeatRanges {
  tMin: number;
  tMax: number;
  specMax: number;
  /** the volume is on stage: only there do work, nuclei and the mode exist */
  volume: boolean;
}

/**
 * A link's setup landed on `base` (the dials buildPanel just defaulted),
 * clamped to this material's ranges; a hand-built link does not get to dial
 * 2000 °C. Each optional element is applied only when present and finite.
 * pf snaps to the dial's step: a hand-built 0.0004 would otherwise latch the
 * pin ON while every surface prints "0.0 vol %". Work, nuclei and the mode
 * are applied in the VOLUME only: a plane has no dial to show them and no
 * kernel to spend them, and a dialled value no surface prints is the
 * lying-label case the pf snap was written for.
 */
export function applyHeatSetup(t: readonly (number | undefined)[], r: HeatRanges, base: HeatDials): HeatDials {
  const [tt, h, s, pf, pr, wk, rxn, md] = t;
  const d: HeatDials = { ...base };
  d.tC = Math.min(r.tMax, Math.max(r.tMin, Math.round(tt as number)));
  d.holdMin = Math.min(720, Math.max(1, Math.round(h as number)));
  d.specMPa = Math.min(r.specMax, Math.max(0, s as number));
  if (typeof pf === "number" && Number.isFinite(pf))
    d.pinF = Math.min(0.12, Math.max(0, Math.round(pf / 0.005) * 0.005));
  if (typeof pr === "number" && Number.isFinite(pr)) d.pinR = Math.min(5, Math.max(1, Math.round(pr)));
  if (typeof wk === "number" && Number.isFinite(wk) && r.volume)
    d.workJb = Math.min(WORK_MAX, Math.max(0, Math.round(wk / WORK_STEP) * WORK_STEP));
  if (typeof rxn === "number" && Number.isFinite(rxn) && r.volume)
    d.rxN = Math.min(RX_MAX, Math.max(0, Math.round(rxn / RX_STEP) * RX_STEP));
  if (typeof md === "number" && Number.isFinite(md) && r.volume)
    d.rxMode = Math.min(RX_MODES.length - 1, Math.max(0, Math.round(md)));
  return d;
}

/**
 * The decoder's whitelist: 3 (pre-C2), 5, 6, 7 or 8 elements, every one a
 * finite number. Number.isFinite does not coerce, so a hand-built tuple
 * carrying strings, nulls or NaN is rejected whole rather than clamped into
 * NaN dials (the g3 doctrine). A 4-element hand-build is still malformed.
 */
export function heatTupleShapeOk(t: unknown): t is HeatTuple {
  return Array.isArray(t) && [3, 5, 6, 7, 8].includes(t.length) && t.every(Number.isFinite);
}
