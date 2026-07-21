// Shareable setup links: the whole instrument state — physics params, material,
// undercooling, lens, nucleation rain, even an applied ML recipe schedule —
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
  rain?: number;                            // nucleation seeds per second
  sched?: [number, number, number] | null;  // applied recipe cooling schedule
  d?: 1;                                    // 1 = the setup lives in TRUE-3D mode
  g3?: number;                              // 3D grid edge (128 / 160 / 192)
  sl?: [number, number, number, number, number]; // section plane: axis, off, tilt, turn, style
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
