// FLOW-DRAG-PROFILE's offset criterion, sized on the CPU before its first GPU
// run (S0 review, tasks/todo.md). Not a gate: it prints what the gate's
// parabola fit reads on a steady discrete proxy of the LBM equation and on a
// fine-grid continuum, for the derived h and the must-miss arms.
//
//   node scripts/research/flow-drag-offset-sizing.mjs
// Size a FLOW-DRAG-PROFILE offset criterion: the apparent no-slip plane fitted
// from the drag-free liquid of a body-force-driven profile over the diffuse
// solid, for the derived h and for 2h / h/2 arms.
// Steady discrete proxy for the LBM: nu (u[j+1] - 2u[j] + u[j-1]) - K[j] u[j] + Fb = 0
// on cell centres j = 0..n-1, free-slip (mirror) at both faces (u[-1] = u[0], u[n] = u[n-1]).
// Also a fine-grid continuum version (dx = 1/16) for comparison.
const n = 64, y0 = 16, W = 1.25, nu = 3.3, Fb = 2.9e-5;
const phi = y => 0.5 * (1 - Math.tanh((y - y0) / (Math.SQRT2 * W)));

function solve(h, sub = 1) {
  // grid of n*sub cells of size 1/sub, centres at (k + 0.5)/sub - 0.5
  const m = n * sub, dx = 1 / sub;
  const y = Array.from({ length: m }, (_, k) => (k + 0.5) / sub - 0.5);
  const K = y.map(yy => (2 * h * nu / (W * W)) * phi(yy) ** 2);
  // tridiagonal: a u[k-1] + b u[k] + c u[k+1] = d
  const A = new Float64Array(m), B = new Float64Array(m), C = new Float64Array(m), D = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    A[k] = nu / (dx * dx); C[k] = nu / (dx * dx); B[k] = -2 * nu / (dx * dx) - K[k]; D[k] = -Fb;
    if (k === 0) { B[k] += A[k]; A[k] = 0; }
    if (k === m - 1) { B[k] += C[k]; C[k] = 0; }
  }
  // Thomas
  for (let k = 1; k < m; k++) { const w = A[k] / B[k - 1]; B[k] -= w * C[k - 1]; D[k] -= w * D[k - 1]; }
  const u = new Float64Array(m);
  u[m - 1] = D[m - 1] / B[m - 1];
  for (let k = m - 2; k >= 0; k--) u[k] = (D[k] - C[k] * u[k + 1]) / B[k];
  // sample at integer cell centres j (for sub = 1 these are the cells)
  const out = [];
  for (let j = 0; j < n; j++) {
    // nearest fine centres bracketing j
    const kf = (j + 0.5) * sub - 0.5;
    const k0 = Math.floor(kf), t = kf - k0;
    out.push(k0 + 1 < m ? u[k0] * (1 - t) + u[k0 + 1] * t : u[k0]);
  }
  return out;
}

/** least-squares parabola over j in [lo, hi]; returns the root nearer the solid, as (y_w - y0)/W */
function offsetOf(u, lo = y0 + 9, hi = n - 3) {
  // normal equations for a y^2 + b y + c, centred for conditioning
  const ys = [], us = [];
  for (let j = lo; j <= hi; j++) { ys.push(j); us.push(u[j]); }
  const yc = ys.reduce((a, b) => a + b, 0) / ys.length;
  const X = ys.map(v => [(v - yc) ** 2, v - yc, 1]);
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  X.forEach((x, i) => { for (let p = 0; p < 3; p++) { r[p] += x[p] * us[i]; for (let q = 0; q < 3; q++) M[p][q] += x[p] * x[q]; } });
  // solve 3x3 by Cramer
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d0 = det(M);
  const sol = [0, 1, 2].map(k => det(M.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / d0);
  const [a, b, c] = sol;
  const disc = Math.sqrt(b * b - 4 * a * c);
  const roots = [(-b - disc) / (2 * a), (-b + disc) / (2 * a)].map(s => s + yc);
  const yw = Math.min(...roots);
  return { offsetW: (yw - y0) / W, vertex: -b / (2 * a) + yc, curvatureNuOverFb: -2 * a * nu / Fb };
}

const h = 2.7571;
for (const [name, hh] of [["h", h], ["2h", 2 * h], ["h/2", h / 2], ["1.5h", 1.5 * h], ["h/1.5", h / 1.5], ["4h", 4 * h], ["h/4", h / 4]]) {
  const disc = solve(hh, 1), cont = solve(hh, 16);
  const od = offsetOf(disc), oc = offsetOf(cont);
  const peak = Math.max(...disc);
  console.log(name.padEnd(6), "discrete offset/W", od.offsetW.toFixed(4), " continuum", oc.offsetW.toFixed(4),
    " vertex", od.vertex.toFixed(3), " curv*nu/Fb", od.curvatureNuOverFb.toFixed(4), " peak", peak.toExponential(3),
    " deepSolid/peak", (Math.max(...disc.slice(0, y0 - 6).map(Math.abs)) / peak).toExponential(2));
}
// sensitivity of the fit to f32 noise: perturb each sample by 1 ulp-ish relative noise
{
  const u = solve(h, 1);
  let worst = 0;
  for (let trial = 0; trial < 200; trial++) {
    let s = trial + 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
    const v = u.map(x => x * (1 + 2e-5 * rnd()));   // ~ 1e-5 relative noise
    worst = Math.max(worst, Math.abs(offsetOf(v).offsetW - offsetOf(u).offsetW));
  }
  console.log("fit shift under 1e-5 relative noise, worst of 200 (W):", worst.toExponential(2));
}
// fit-window sensitivity
{
  const u = solve(h, 1);
  for (const [lo, hi] of [[25, 61], [28, 60], [24, 62], [30, 55]]) console.log("window", lo, hi, offsetOf(u, lo, hi).offsetW.toFixed(4));
}
