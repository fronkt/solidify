// WGSL for the Kobayashi (1993) anisotropic phase-field model, multi-grain extended.
//
//   tau dphi/dt = div(F) + phi(1-phi)(phi - 1/2 + m(T)) + noise
//   F = ( eps^2 phi_x - eps eps' phi_y ,  eps^2 phi_y + eps eps' phi_x )
//   eps(theta) = epsBar (1 + delta cos(j (theta - theta0_grain)))
//   dT/dt = lap(T) + K dphi/dt - cooling + heating
//
// Fields: state rg32float = (phi, T), grain r32uint = grain id (0 = liquid/unclaimed).
// Each grain id has a crystallographic offset theta0 in a storage buffer.

export const MAX_GRAINS = 4096;
export const MAX_SEEDS = 64;

const COMMON = /* wgsl */ `
struct Params {
  n: u32,
  frame: u32,
  dx: f32,
  dt: f32,
  epsBar: f32,
  delta: f32,
  aniMode: f32,
  tau: f32,
  alpha: f32,
  gamma: f32,
  latent: f32,
  noiseAmp: f32,
  tFar: f32,
  coolRate: f32,
  heatIn: f32,
  seedCount: u32,
}
const PI = 3.14159265359;

fn cid(p: Params, c: vec2i) -> vec2i {
  return clamp(c, vec2i(0), vec2i(i32(p.n) - 1));
}

fn hash3(x: u32, y: u32, z: u32) -> f32 {
  var v = x * 747796405u + y * 2891336453u + z * 3546859427u + 2654435769u;
  v ^= v >> 16u; v *= 2246822519u; v ^= v >> 13u; v *= 3266489917u; v ^= v >> 16u;
  return f32(v) * (1.0 / 4294967295.0);
}
`;

// ---------------------------------------------------------------- flux pass
// stores per cell: ( eps*eps' * phi_x , eps*eps' * phi_y , eps^2 , 0 )
export const FLUX_WGSL = /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> theta0: array<f32>;
@group(0) @binding(4) var flux: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let c = vec2i(gid.xy);
  let inv2dx = 1.0 / (2.0 * P.dx);
  let pR = textureLoad(state, cid(P, c + vec2i(1, 0)), 0).r;
  let pL = textureLoad(state, cid(P, c - vec2i(1, 0)), 0).r;
  let pU = textureLoad(state, cid(P, c + vec2i(0, 1)), 0).r;
  let pD = textureLoad(state, cid(P, c - vec2i(0, 1)), 0).r;
  let px = (pR - pL) * inv2dx;
  let py = (pU - pD) * inv2dx;
  if (px * px + py * py < 1e-12) {
    textureStore(flux, c, vec4f(0.0, 0.0, P.epsBar * P.epsBar, 0.0));
    return;
  }
  let id = textureLoad(grain, c, 0).r;
  let th0 = theta0[min(id, ${MAX_GRAINS - 1}u)];
  let beta = P.aniMode * (atan2(py, px) - th0);
  let eps = P.epsBar * (1.0 + P.delta * cos(beta));
  let deps = -P.epsBar * P.delta * P.aniMode * sin(beta);
  textureStore(flux, c, vec4f(eps * deps * px, eps * deps * py, eps * eps, 0.0));
}
`;

// -------------------------------------------------------------- update pass
export const UPDATE_WGSL = /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var flux: texture_2d<f32>;
@group(0) @binding(4) var stateOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let c = vec2i(gid.xy);
  let inv2dx = 1.0 / (2.0 * P.dx);
  let s = textureLoad(state, c, 0);
  let phi = s.r;
  let T = s.g;

  // 8 neighbours (phi, T)
  let sE = textureLoad(state, cid(P, c + vec2i(1, 0)), 0).rg;
  let sW = textureLoad(state, cid(P, c - vec2i(1, 0)), 0).rg;
  let sN = textureLoad(state, cid(P, c + vec2i(0, 1)), 0).rg;
  let sS = textureLoad(state, cid(P, c - vec2i(0, 1)), 0).rg;
  let sNE = textureLoad(state, cid(P, c + vec2i(1, 1)), 0).rg;
  let sNW = textureLoad(state, cid(P, c + vec2i(-1, 1)), 0).rg;
  let sSE = textureLoad(state, cid(P, c + vec2i(1, -1)), 0).rg;
  let sSW = textureLoad(state, cid(P, c + vec2i(-1, -1)), 0).rg;

  let inv6dx2 = 1.0 / (6.0 * P.dx * P.dx);
  // compact 9-point Laplacians (no checkerboard decoupling)
  let lapPhi = (4.0 * (sE.r + sW.r + sN.r + sS.r) + sNE.r + sNW.r + sSE.r + sSW.r - 20.0 * phi) * inv6dx2;
  let lapT   = (4.0 * (sE.g + sW.g + sN.g + sS.g) + sNE.g + sNW.g + sSE.g + sSW.g - 20.0 * T) * inv6dx2;

  let px = (sE.r - sW.r) * inv2dx;
  let py = (sN.r - sS.r) * inv2dx;

  // anisotropic terms from the flux texture: A = eps*eps', z = eps^2
  let fC = textureLoad(flux, c, 0);
  let fE = textureLoad(flux, cid(P, c + vec2i(1, 0)), 0);
  let fW = textureLoad(flux, cid(P, c - vec2i(1, 0)), 0);
  let fN = textureLoad(flux, cid(P, c + vec2i(0, 1)), 0);
  let fS = textureLoad(flux, cid(P, c - vec2i(0, 1)), 0);
  // d/dy(A phi_x) - d/dx(A phi_y)
  let cross = ((fN.x - fS.x) - (fE.y - fW.y)) * inv2dx;
  // grad(eps^2) . grad(phi)
  let ge2 = vec2f(fE.z - fW.z, fN.z - fS.z) * inv2dx;
  let aniso = fC.z * lapPhi + dot(ge2, vec2f(px, py)) + cross;

  let m = (P.alpha / PI) * atan(P.gamma * (1.0 - T));
  let chi = hash3(gid.x, gid.y, P.frame) - 0.5;
  let react = phi * (1.0 - phi) * (phi - 0.5 + m) + P.noiseAmp * phi * (1.0 - phi) * chi;
  let phiNew = clamp(phi + (P.dt / P.tau) * (aniso + react), 0.0, 1.0);

  let TNew = clamp(
    T + P.dt * lapT + P.latent * (phiNew - phi) - P.dt * P.coolRate + P.dt * P.heatIn,
    -1.0, 2.0);

  // grain id bookkeeping: claim ahead of the front, release on remelt
  var id = textureLoad(grain, c, 0).r;
  if (phiNew < 1e-4) {
    id = 0u;
  } else if (id == 0u) {
    var best = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dxo = -1; dxo <= 1; dxo++) {
        if (dxo == 0 && dy == 0) { continue; }
        let nc = cid(P, c + vec2i(dxo, dy));
        let nid = textureLoad(grain, nc, 0).r;
        if (nid != 0u) {
          let nphi = textureLoad(state, nc, 0).r;
          if (nphi > best) { best = nphi; id = nid; }
        }
      }
    }
  }

  textureStore(stateOut, c, vec4f(phiNew, TNew, 0.0, 0.0));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`;

// ------------------------------------------------------------- stamp seeds
export const STAMP_WGSL = /* wgsl */ `
${COMMON}
struct Seed { pos: vec2f, r: f32, id: f32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> seeds: array<Seed, ${MAX_SEEDS}>;
@group(0) @binding(4) var stateOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let c = vec2i(gid.xy);
  let s = textureLoad(state, c, 0);
  var phi = s.r;
  var id = textureLoad(grain, c, 0).r;
  // nucleation only proceeds in (undercooled) liquid
  if (phi < 0.3) {
    let p = vec2f(gid.xy) + 0.5;
    for (var i = 0u; i < P.seedCount; i++) {
      let sd = seeds[i];
      let d = distance(p, sd.pos);
      if (d < sd.r) {
        let v = 1.0 - smoothstep(sd.r - 2.0, sd.r, d);
        if (v > phi) { phi = v; id = u32(sd.id); }
      }
    }
  }
  textureStore(stateOut, c, vec4f(phi, s.g, 0.0, 0.0));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`;

// -------------------------------------------------------------- stats pass
export const STATS_WGSL = /* wgsl */ `
${COMMON}
struct Stats {
  solid: atomic<u32>,
  interf: atomic<u32>,
  interfT: atomic<u32>,   // fixed point x1000
  pad: u32,
  counts: array<atomic<u32>, ${MAX_GRAINS}>,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read_write> stats: Stats;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let c = vec2i(gid.xy);
  let s = textureLoad(state, c, 0);
  if (s.r > 0.5) {
    atomicAdd(&stats.solid, 1u);
    let id = textureLoad(grain, c, 0).r;
    if (id > 0u && id < ${MAX_GRAINS}u) {
      atomicAdd(&stats.counts[id], 1u);
    }
  }
  if (s.r > 0.2 && s.r < 0.8) {
    atomicAdd(&stats.interf, 1u);
    atomicAdd(&stats.interfT, u32(clamp(s.g, 0.0, 2.0) * 1000.0));
  }
}
`;

// -------------------------------------------------------------- render pass
export const RENDER_WGSL = /* wgsl */ `
struct RParams {
  view: u32,        // 0 melt, 1 orientation, 2 micrograph, 3 field
  n: u32,
  canvasW: f32,
  canvasH: f32,
  time: f32,
  aniMode: f32,
  tFar: f32,
  pad: f32,
}
const PI = 3.14159265359;
@group(0) @binding(0) var<uniform> R: RParams;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> theta0: array<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vmain(@builtin(vertex_index) vi: u32) -> VOut {
  var out: VOut;
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  out.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(xy.x, 1.0 - xy.y);
  return out;
}

fn hashf(x: u32, y: u32, z: u32) -> f32 {
  var v = x * 747796405u + y * 2891336453u + z * 3546859427u + 2654435769u;
  v ^= v >> 16u; v *= 2246822519u; v ^= v >> 13u; v *= 3266489917u; v ^= v >> 16u;
  return f32(v) * (1.0 / 4294967295.0);
}

fn cl(c: vec2i) -> vec2i { return clamp(c, vec2i(0), vec2i(i32(R.n) - 1)); }

// manual bilinear on (phi, T)
fn sampleState(p: vec2f) -> vec2f {
  let q = clamp(p - 0.5, vec2f(0.0), vec2f(f32(R.n) - 1.001));
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let s00 = textureLoad(state, cl(i), 0).rg;
  let s10 = textureLoad(state, cl(i + vec2i(1, 0)), 0).rg;
  let s01 = textureLoad(state, cl(i + vec2i(0, 1)), 0).rg;
  let s11 = textureLoad(state, cl(i + vec2i(1, 1)), 0).rg;
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

// incandescent ramp: dark steel -> deep red -> orange -> white hot
fn heat(T: f32) -> vec3f {
  let t = clamp((T - 0.15) / 0.9, 0.0, 1.0);
  var c = mix(vec3f(0.012, 0.011, 0.016), vec3f(0.135, 0.014, 0.008), smoothstep(0.0, 0.38, t));
  c = mix(c, vec3f(0.62, 0.11, 0.015), smoothstep(0.3, 0.62, t));
  c = mix(c, vec3f(1.0, 0.42, 0.06), smoothstep(0.55, 0.82, t));
  c = mix(c, vec3f(1.18, 0.83, 0.35), smoothstep(0.78, 0.95, t));
  c = mix(c, vec3f(1.35, 1.18, 0.95), smoothstep(0.92, 1.0, t));
  return c;
}

fn inferno(x: f32) -> vec3f {
  let t = clamp(x, 0.0, 1.0);
  var c = mix(vec3f(0.001, 0.0, 0.014), vec3f(0.34, 0.06, 0.38), smoothstep(0.0, 0.3, t));
  c = mix(c, vec3f(0.73, 0.21, 0.33), smoothstep(0.25, 0.55, t));
  c = mix(c, vec3f(0.98, 0.55, 0.13), smoothstep(0.5, 0.8, t));
  c = mix(c, vec3f(0.99, 0.99, 0.75), smoothstep(0.78, 1.0, t));
  return c;
}

fn hsv(h: f32, s: f32, v: f32) -> vec3f {
  let k = fract(vec3f(h, h + 2.0 / 3.0, h + 1.0 / 3.0)) * 6.0;
  let a = clamp(abs(k - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
  return v * mix(vec3f(1.0), a, s);
}

// cross-polarised metallographic palette: golds / blues / magentas
fn polar(h: f32, idh: f32) -> vec3f {
  let c1 = vec3f(0.93, 0.68, 0.20);  // gold
  let c2 = vec3f(0.16, 0.42, 0.72);  // steel blue
  let c3 = vec3f(0.74, 0.28, 0.55);  // magenta
  let c4 = vec3f(0.24, 0.63, 0.60);  // teal
  let t = fract(h + idh * 0.13);
  var c = mix(c1, c2, smoothstep(0.0, 0.33, t));
  c = mix(c, c3, smoothstep(0.33, 0.66, t));
  c = mix(c, c4, smoothstep(0.66, 0.92, t));
  c = mix(c, c1, smoothstep(0.92, 1.0, t));
  return c;
}

@fragment
fn fmain(in: VOut) -> @location(0) vec4f {
  // cover-fit the square domain onto the canvas
  let n = f32(R.n);
  let scale = max(R.canvasW, R.canvasH);
  let off = vec2f(R.canvasW - scale, R.canvasH - scale) * 0.5;
  let p = ((in.uv * vec2f(R.canvasW, R.canvasH)) - off) / scale * n;

  let s = sampleState(p);
  let phi = s.x;
  let T = s.y;
  let ci = vec2i(clamp(p, vec2f(0.0), vec2f(n - 1.0)));
  let id = textureLoad(grain, ci, 0).r;
  let idh = hashf(id, 17u, 91u);

  // relief normal from phi gradient (one-texel apart bilinear taps)
  let e = 1.0;
  let gx = sampleState(p + vec2f(e, 0.0)).x - sampleState(p - vec2f(e, 0.0)).x;
  let gy = sampleState(p + vec2f(0.0, e)).x - sampleState(p - vec2f(0.0, e)).x;
  let nrm = normalize(vec3f(-gx * 6.0, -gy * 6.0, 1.0));
  let L = normalize(vec3f(-0.45, -0.55, 0.62));
  let diff = max(dot(nrm, L), 0.0);
  let spec = pow(max(dot(nrm, normalize(L + vec3f(0.0, 0.0, 1.0))), 0.0), 28.0);

  let solidness = smoothstep(0.35, 0.65, phi);

  // grain boundary detect (both sides solid, different id)
  var gb = 0.0;
  if (id != 0u && phi > 0.5) {
    for (var k = 0; k < 4; k++) {
      var d = vec2i(1, 0);
      if (k == 1) { d = vec2i(-1, 0); }
      if (k == 2) { d = vec2i(0, 1); }
      if (k == 3) { d = vec2i(0, -1); }
      let nc = cl(ci + d);
      let nid = textureLoad(grain, nc, 0).r;
      if (nid != 0u && nid != id && textureLoad(state, nc, 0).r > 0.5) { gb = 1.0; }
    }
  }

  var col = vec3f(0.0);

  if (R.view == 0u) {
    // MELT: incandescent liquid, cooling steel solid; latent heat makes tips glow
    let glow = heat(T);
    let steel = vec3f(0.11, 0.115, 0.13) * (0.5 + 0.95 * diff) + vec3f(spec) * 0.3;
    let tint = polar(theta0[min(id, ${MAX_GRAINS - 1}u)] / (2.0 * PI / max(R.aniMode, 1.0)), idh);
    let solidCol = steel * (0.7 + 0.3 * tint) + glow * 0.3;
    col = mix(glow, solidCol, solidness);
    col -= gb * vec3f(0.03);
  } else if (R.view == 1u) {
    // ORIENTATION: cross-polarised colour by theta0, embossed
    let th = theta0[min(id, ${MAX_GRAINS - 1}u)];
    let hfrac = th / (2.0 * PI / max(R.aniMode, 1.0));
    let idv = 0.6 + 0.75 * hashf(id, 5u, 31u);
    let base = polar(hfrac, idh) * idv * (0.42 + 0.72 * diff) + vec3f(spec) * 0.2;
    let liq = vec3f(0.012, 0.014, 0.02) + heat(T) * 0.1;
    col = mix(liq, base, solidness);
    col *= 1.0 - gb * 0.7;
  } else if (R.view == 2u) {
    // MICROGRAPH: etched specimen; unetched (liquid) stays near-white
    let lum = 0.58 + 0.24 * idh + diff * 0.05 - spec * 0.03;
    let solidCol = vec3f(lum) * vec3f(0.99, 0.965, 0.915);
    let liq = vec3f(0.965, 0.955, 0.935);
    col = mix(liq, solidCol, solidness);
    col *= 1.0 - gb * 0.82;
    // etch noise
    col *= 0.97 + 0.06 * hashf(u32(ci.x), u32(ci.y), 7u);
  } else {
    // FIELD: T in inferno + isotherms + interface contour
    col = inferno((T + 0.2) / 1.3);
    let iso = smoothstep(0.05, 0.0, abs(fract(T * 18.0) - 0.5) * 2.0 - 0.9);
    col *= 1.0 - iso * 0.25;
    let ifc = 1.0 - smoothstep(0.0, 0.10, abs(phi - 0.5));
    col = mix(col, vec3f(0.95, 0.98, 1.0), ifc * 0.85);
  }

  // vignette + faint animated film grain (not on micrograph)
  let vuv = in.uv - 0.5;
  let vig = 1.0 - dot(vuv, vuv) * select(0.55, 0.18, R.view == 2u);
  col *= vig;
  if (R.view != 2u) {
    let fg = hashf(u32(in.pos.x), u32(in.pos.y), u32(R.time * 60.0) % 1024u) - 0.5;
    col += fg * 0.012;
  }

  return vec4f(pow(max(col, vec3f(0.0)), vec3f(1.0 / 1.06)), 1.0);
}
`;
