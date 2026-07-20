// Generates the landing page's grain-boundary background: a seamless, tileable
// equiaxed polycrystal (the same d3-delaunay Voronoi the specimen puck uses in
// dive3d.ts, only periodic so it repeats forever without a seam). Run
// `node scripts/gen-grain.mjs` and paste the emitted <path> d-string into the
// #grain <pattern> in index.html. Points are Lloyd-relaxed on a torus so grains
// come out evenly sized (equiaxed) rather than clumped.
import { Delaunay } from "d3-delaunay";

// --------------------------------------------------------------- parameters
const TILE = 420;   // pattern repeat, px
const N = 13;       // seeds per tile -> grain size ~ sqrt(TILE^2 / N) ~ 116px
const LLOYD = 2;    // relaxation passes: even grains, but not a rigid honeycomb
const SEED = 7;

// ------------------------------------------------------------- seeded rng
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry32(SEED);

// wrap a coordinate into [0, TILE)
const wrap = v => ((v % TILE) + TILE) % TILE;

// the 3x3 toroidal replication of a point set, so the central tile's Voronoi
// diagram is exactly the infinite periodic one
function replicate(pts) {
  const out = [];
  for (const [x, y] of pts)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) out.push([x + i * TILE, y + j * TILE]);
  return out;
}

// area-weighted centroid of a closed polygon
function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let k = 0; k < poly.length - 1; k++) {
    const [x0, y0] = poly[k], [x1, y1] = poly[k + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return poly[0];
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

// --------------------------------------------------------------- seeds + Lloyd
let pts = Array.from({ length: N }, () => [R() * TILE, R() * TILE]);
const BOUND = [-TILE, -TILE, 2 * TILE, 2 * TILE];

for (let pass = 0; pass < LLOYD; pass++) {
  const sup = replicate(pts);
  const vor = Delaunay.from(sup).voronoi(BOUND);
  // central copy of point p is at replicate index p*9 + 4 (i=0,j=0)
  pts = pts.map((_, p) => {
    const poly = vor.cellPolygon(p * 9 + 4);
    if (!poly) return pts[p];
    const [cx, cy] = centroid(poly);
    return [wrap(cx), wrap(cy)];
  });
}

// --------------------------------------------------- collect + clip the edges
const sup = replicate(pts);
const vor = Delaunay.from(sup).voronoi(BOUND);

// Liang-Barsky clip of segment (x0,y0)-(x1,y1) to [0,TILE] x [0,TILE]
function clip(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - 0, TILE - x0, y0 - 0, TILE - y0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  if (t1 - t0 < 1e-6) return null;
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

const fmt = n => (Math.round(n * 10) / 10).toString();
const seen = new Set();
const segs = [];
for (let i = 0; i < sup.length; i++) {
  const poly = vor.cellPolygon(i);
  if (!poly) continue;
  for (let k = 0; k < poly.length - 1; k++) {
    const c = clip(poly[k][0], poly[k][1], poly[k + 1][0], poly[k + 1][1]);
    if (!c) continue;
    let [ax, ay, bx, by] = c.map(v => Math.round(v * 10) / 10);
    if (Math.hypot(ax - bx, ay - by) < 0.5) continue;
    const key = [`${ax},${ay}`, `${bx},${by}`].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    segs.push(`M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}`);
  }
}

const d = segs.join(" ");
console.log(`TILE=${TILE}  seeds=${N}  segments=${segs.length}  chars=${d.length}`);
console.log("\n--- paste as the #grain <pattern> width/height and <path> d ---\n");
console.log(d);
