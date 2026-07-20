// Geometric dendrite generator — the dive's finale artwork. One seeded model
// serves two consumers: dive3d.ts grows it live under scroll (segments sorted
// by birth time drive a LineSegments drawRange), and scripts/gen-dive-art.mjs
// flattens the same geometry into the stage-5 poster SVG. Plain .mjs so both
// Vite and node can import it. Six-fold by design (see landing generator rule:
// a lone centered 4-fold crystal is never rendered).

/** Deterministic LCG so the dendrite is identical every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

/**
 * @typedef {{ a: [number,number,number], b: [number,number,number],
 *             t: number, cls: "w"|"d"|"amber" }} Seg
 * segment endpoints in dendrite-local units (primary arm length ≈ 4.2),
 * t = birth time in [0,1] (draw order = crystallization order)
 */

/**
 * Grow a six-fold dendrite: tapered primaries, secondary arms whose length
 * envelope follows distance behind the tip (the parabolic-tip look), tertiary
 * stubs near the trunk. Slight z-relief and per-arm tilt so a 3D camera gets
 * parallax while it still reads as flat vector art.
 * @returns {Seg[]} sorted by birth time
 */
export function genDendrite(seed = 20260719) {
  const R = rng(seed);
  const segs = [];
  const J = 6;
  const PRIM_LEN = 4.2;
  const STEPS = 26;

  for (let arm = 0; arm < J; arm++) {
    const th = (arm / J) * Math.PI * 2 + 0.13;
    const dir = [Math.cos(th), Math.sin(th)];
    // each arm lives in a very slightly tilted plane: parallax without volume
    const tilt = (arm % 2 ? 1 : -1) * 0.07;
    const lift = (x, y, r) => [x, y, r * tilt + (R() - 0.5) * 0.05];

    // every node is lifted ONCE and shared by adjoining segments — fresh
    // jitter per endpoint would split the polyline into visible dashes
    let prev = lift(0, 0, 0);
    let wobble = 0;
    for (let i = 1; i <= STEPS; i++) {
      const r = (i / STEPS) * PRIM_LEN;
      wobble += (R() - 0.5) * 0.012;
      const ox = -dir[1] * wobble * r * 0.25;
      const oy = dir[0] * wobble * r * 0.25;
      const x = dir[0] * r + ox, y = dir[1] * r + oy;
      const tBirth = (r / PRIM_LEN) * 0.5;
      const cur = lift(x, y, r);
      segs.push({ a: prev, b: cur, t: tBirth, cls: "w" });

      // secondary arms: alternating pairs at ±60° off the primary, length
      // envelope ∝ how far behind the (eventual) tip this node sits, choked
      // near the center where neighbouring arms impinge
      if (i >= 3 && i < STEPS - 1 && i % 2 === 0) {
        for (const side of [1, -1]) {
          const sTh = th + side * (Math.PI / 3);
          const behind = 1 - r / PRIM_LEN;
          const env = Math.pow(1 - behind, 0.35) * (1 - Math.pow(1 - behind, 6));
          const sLen = PRIM_LEN * 0.34 * env * (0.75 + R() * 0.5);
          if (sLen < 0.12) continue;
          const sSteps = Math.max(2, Math.round(sLen * 3.2));
          let sPrev = cur;
          for (let k = 1; k <= sSteps; k++) {
            const sr = (k / sSteps) * sLen;
            const jx = (R() - 0.5) * 0.03, jy = (R() - 0.5) * 0.03;
            const nx = x + Math.cos(sTh) * sr + jx, ny = y + Math.sin(sTh) * sr + jy;
            const t2 = tBirth + 0.16 + (sr / sLen) * 0.22;
            const node = lift(nx, ny, r);
            segs.push({ a: sPrev, b: node, t: t2, cls: "w" });
            // tertiary stubs on long secondaries, near their root
            if (sLen > 0.7 && k === 1) {
              for (const s3 of [1, -1]) {
                const tTh = sTh + s3 * (Math.PI / 3);
                const tLen = sLen * 0.22 * (0.6 + R() * 0.6);
                segs.push({
                  a: node,
                  b: lift(nx + Math.cos(tTh) * tLen, ny + Math.sin(tTh) * tLen, r),
                  t: t2 + 0.1, cls: "d",
                });
              }
            }
            sPrev = node;
          }
        }
      }
      prev = cur;
    }
  }

  // amber nucleus: tiny hex ring where it all started
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    const r0 = 0.16;
    segs.push({
      a: [Math.cos(a0) * r0, Math.sin(a0) * r0, 0],
      b: [Math.cos(a1) * r0, Math.sin(a1) * r0, 0],
      t: 0, cls: "amber",
    });
  }

  const maxT = segs.reduce((m, s) => Math.max(m, s.t), 0);
  for (const s of segs) s.t /= maxT;
  segs.sort((a, b) => a.t - b.t);
  return segs;
}
