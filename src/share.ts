// Shareable setup links: the whole instrument state — physics params, material,
// undercooling, lens, the inoculant charge, even an applied ML recipe schedule —
// packed into a #set= hash. Same spirit as the composer's #alloy= links, but
// for ANY setup, including what the optimizer discovered.

export interface ShareState {
  // physics dials of WHICHEVER solver the link came from (2D PhysParams or
  // 3D Phys3DParams) — restore routes each key onto the params that carry it
  p: Record<string, number>;
  u: number;                                // undercooling
  v: number;                                // lens index
  m: string;                                // material key
  n?: string;                               // display name (composed alloys)
  rain?: number;                            // LEGACY: pre-v4 seeds per second
  nuc?: [number, number, number];           // inoculant: n_max, dT_N, dT_sigma
  /** lab experiment: atmosphere, inoculant, superheat, mould T, walls, programme,
   *  (optional, added v6.1) minutes held above the liquidus for refiner fade,
   *  (optional, v6.1 L4) the pre-pour spec σ_y in MPa (0 = no spec), and
   *  (optional, v6.2 M) the mould geometry kind — g3-style Number.isFinite/
   *  whitelist doctrine on every optional tail element */
  lab?: [string, number, number, number, number, string, number?, number?, string?];
  sched?: [number, number, number] | null;  // applied recipe cooling schedule
  d?: 1;                                    // 1 = the setup lives in TRUE-3D mode
  g3?: number;                              // 3D grid edge (128 / 160 / 192)
  sl?: [number, number, number, number, number]; // section plane: axis, off, tilt, turn, style
  /** heat-treat setup: temperature °C, hold minutes, spec σ_y MPa (0 = none),
   *  and (optional tail, v7.0 C2) the Zener dispersion's fraction and radius
   *  in cells — packed only while the panel is open */
  ht?: [number, number, number, number?, number?];
  /**
   * (v7.0) the run's RNG seed. This is what turns a link from "the same dials"
   * into "the same cast": grain orientations, nucleation sites and their
   * activation undercoolings all descend from it, so a shared link now
   * reproduces the actual casting rather than a statistically similar one.
   * Optional, so every pre-v7 link still restores — those simply keep whatever
   * seed the visitor's page drew.
   */
  seed?: number;
  /**
   * (v7.1 P1) the poured mix, in the composer's own `#alloy=` payload form —
   * "al:Si7,Mg0.35", without the `alloy=` prefix.
   *
   * It has to travel, and the reason is specific. `n` is a display name only,
   * so before P1 a shared calibrated link recalibrated on the MATERIAL's
   * default coefficients at both ends and the two agreed. Once the calibration
   * learns the poured alloy they stop agreeing: the minter measures A356's own
   * ~35 K freezing range and a recipient with no mix would measure Al–4Cu's
   * 122 K — a different W₀, cell pitch, timestep and thermometer behind an
   * identical-looking link. Optional, so every pre-v7.1 link still restores
   * exactly as it did; those simply have no mix and keep the material default,
   * which is what they were minted with.
   */
  mx?: string;
}

// grid-derived / runtime fields that must never ride a link
const SKIP = new Set(["dx", "dt", "weldX", "weldY", "tFar"]);

export function packShare(s: ShareState): string {
  const p: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.p)) {
    if (!SKIP.has(k) && typeof v === "number" && Number.isFinite(v)) p[k] = +v.toFixed(5);
  }
  const json = JSON.stringify({ ...s, p });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return "#set=" + b64;
}

export function unpackShare(hash: string): ShareState | null {
  const m = hash.match(/set=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const s = JSON.parse(new TextDecoder().decode(bytes)) as ShareState;
    if (!s || typeof s !== "object" || typeof s.u !== "number" || !s.p) return null;
    for (const k of Object.keys(s.p)) if (SKIP.has(k)) delete (s.p as Record<string, unknown>)[k];
    return s;
  } catch {
    return null;
  }
}
