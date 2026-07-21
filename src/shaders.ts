// WGSL for the Kobayashi (1993) anisotropic phase-field model, multi-grain,
// with a Warren–Boettinger-type dilute-alloy extension (qualitative) and
// process scenarios (directional/Bridgman frame, moving weld source).
//
//   tau dphi/dt = div(F) + phi(1-phi)(phi - 1/2 + m(T,c)) + noise
//   F = ( eps^2 phi_x - eps eps' phi_y ,  eps^2 phi_y + eps eps' phi_x )
//   eps(theta) = epsBar (1 + delta cos(j (theta - theta0_grain)))
//   dT/dt = lap(T) + K dphi/dt - cooling + heating + weld source (or relaxed
//           toward a pulled gradient frame in Bridgman mode)
//   dc/dt = div(D(phi) grad c) + (1-k) c dphi/dt        (alloy mode)
//   m(T,c) = (alpha/pi) atan(gamma (1 - mLiq c - T))    (liquidus slope)
//
// State rgba32float = (phi, T, c, age); age = sim time the cell solidified.
// Grain r32uint = grain id (0 = liquid/unclaimed); per-id theta0 buffer.

export const MAX_GRAINS = 4096;
export const MAX_SEEDS = 64;
export const SEED_STRIDE = 6; // floats per seed: x, y, r, id, dTact, pad

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
  time: f32,
  scen: u32,        // 0 none, 1 bridgman, 2 weld
  gradG: f32,
  frontX: f32,      // bridgman: x (in units) of the reference isotherm
  weldX: f32,
  weldY: f32,
  weldPow: f32,
  weldSig: f32,
  alloyOn: u32,
  c0: f32,
  mLiq: f32,
  kPart: f32,
  dSol: f32,
  quenchDT: f32,   // one-shot temperature drop applied in the stamp pass
  twinProb: f32,   // per-claim chance of nucleating a growth twin at the front
  idFloor: u32,    // CPU seed ids live below this; GPU twin ids above it
  probeX: u32,     // cooling-curve probe cell (0xffffffff = off)
  probeY: u32,
  holdT: f32,      // crucible (scen 3): heater set-point for non-mold cells
  holdRate: f32,   // crucible: relax rate toward the set-point
  facet: f32,      // 0 = smooth cos anisotropy, 1 = regularized-cusp (faceted growth)
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
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
  var eps: f32;
  var deps: f32;
  if (P.facet > 0.5) {
    // faceted growth: regularized-cusp interface energy |sin(β/2)| — the
    // cusped minima pin j flat facet orientations (Eggleston-style smoothing)
    let x = 0.5 * beta;
    let s = sin(x);
    let q = sqrt(s * s + 0.001);
    eps = P.epsBar * (1.0 + P.delta * (2.0 * q - 1.0));
    deps = P.epsBar * P.delta * P.aniMode * s * cos(x) / q;
  } else {
    eps = P.epsBar * (1.0 + P.delta * cos(beta));
    deps = -P.epsBar * P.delta * P.aniMode * sin(beta);
  }
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
@group(0) @binding(4) var stateOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_2d<r32uint, write>;
@group(0) @binding(6) var<storage, read_write> theta0: array<f32>;
@group(0) @binding(7) var<storage, read_write> twinCtr: atomic<u32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let c = vec2i(gid.xy);
  let inv2dx = 1.0 / (2.0 * P.dx);
  let s = textureLoad(state, c, 0);
  let phi = s.r;
  let T = s.g;
  let conc = s.b;
  var age = s.a;

  // 8 neighbours
  let sE = textureLoad(state, cid(P, c + vec2i(1, 0)), 0);
  let sW = textureLoad(state, cid(P, c - vec2i(1, 0)), 0);
  let sN = textureLoad(state, cid(P, c + vec2i(0, 1)), 0);
  let sS = textureLoad(state, cid(P, c - vec2i(0, 1)), 0);
  let sNE = textureLoad(state, cid(P, c + vec2i(1, 1)), 0);
  let sNW = textureLoad(state, cid(P, c + vec2i(-1, 1)), 0);
  let sSE = textureLoad(state, cid(P, c + vec2i(1, -1)), 0);
  let sSW = textureLoad(state, cid(P, c + vec2i(-1, -1)), 0);

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
  let cross = ((fN.x - fS.x) - (fE.y - fW.y)) * inv2dx;
  let ge2 = vec2f(fE.z - fW.z, fN.z - fS.z) * inv2dx;
  let aniso = fC.z * lapPhi + dot(ge2, vec2f(px, py)) + cross;

  // liquidus depression by solute: Teq = 1 - mLiq*c (constitutional undercooling)
  var tEq = 1.0;
  if (P.alloyOn == 1u) { tEq = 1.0 - P.mLiq * conc; }
  let m = (P.alpha / PI) * atan(P.gamma * (tEq - T));
  let chi = hash3(gid.x, gid.y, P.frame) - 0.5;
  let react = phi * (1.0 - phi) * (phi - 0.5 + m) + P.noiseAmp * phi * (1.0 - phi) * chi;
  let phiNew = clamp(phi + (P.dt / P.tau) * (aniso + react), 0.0, 1.0);
  let dPhi = phiNew - phi;

  // temperature
  var TNew = T + P.dt * lapT + P.latent * dPhi - P.dt * P.coolRate + P.dt * P.heatIn;
  if (P.scen == 2u) {
    // moving weld heat source (gaussian)
    let d2 = distance(vec2f(gid.xy), vec2f(P.weldX, P.weldY));
    TNew += P.dt * P.weldPow * exp(-(d2 * d2) / (2.0 * P.weldSig * P.weldSig));
  } else if (P.scen == 1u) {
    // Bridgman: relax toward a temperature frame pulled at V (frozen-gradient approx)
    let xu = f32(gid.x) * P.dx;
    let tProf = clamp(0.7 + P.gradG * (xu - P.frontX) / P.dx * P.dx / 1.0, -0.6, 1.5);
    TNew = mix(TNew, tProf, min(1.0, P.dt * 150.0));
  } else if (P.scen == 3u) {
    // crucible (cast logo): non-mold cells relax toward the heater set-point,
    // the mold stays a cold sink, and the pointer is a small torch
    let tGoal = select(P.holdT, 0.06, s.a < -0.5);
    TNew = mix(TNew, tGoal, min(1.0, P.dt * P.holdRate));
    let d2 = distance(vec2f(gid.xy), vec2f(P.weldX, P.weldY));
    TNew += P.dt * P.weldPow * exp(-(d2 * d2) / (2.0 * P.weldSig * P.weldSig));
  }
  TNew = clamp(TNew, -1.0, 2.0);

  // solute (alloy mode): variable-diffusivity face scheme + interface rejection
  var cNew = conc;
  if (P.alloyOn == 1u) {
    let dHere = mix(P.dSol, P.dSol * 0.02, phi);
    let dE = 0.5 * (dHere + mix(P.dSol, P.dSol * 0.02, sE.r));
    let dW = 0.5 * (dHere + mix(P.dSol, P.dSol * 0.02, sW.r));
    let dN = 0.5 * (dHere + mix(P.dSol, P.dSol * 0.02, sN.r));
    let dS = 0.5 * (dHere + mix(P.dSol, P.dSol * 0.02, sS.r));
    let divC = (dE * (sE.b - conc) + dW * (sW.b - conc) + dN * (sN.b - conc) + dS * (sS.b - conc)) / (P.dx * P.dx);
    cNew = clamp(conc + P.dt * divC + (1.0 - P.kPart) * conc * dPhi, 0.0, 2.0);
  }

  // solidification age (for the growth-rings lens)
  if (phi < 0.5 && phiNew >= 0.5) { age = P.time; }

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
    // growth twinning: rarely, a claim at the advancing front nucleates a new
    // domain in twin registry — theta0 + pi/j, the maximal-misorientation 2D
    // analog of a coherent twin (feathery Al grains; 12-branched snowflakes).
    // The twin then has to out-grow its parent to survive, like the real thing.
    if (id != 0u && best > 0.003 && P.twinProb > 0.0 &&
        hash3(gid.x + 7919u, gid.y + 104729u, P.frame) < P.twinProb) {
      let tid = atomicSub(&twinCtr, 1u);
      if (tid > P.idFloor && tid < ${MAX_GRAINS}u) {
        theta0[tid] = theta0[min(id, ${MAX_GRAINS - 1}u)] + PI / max(P.aniMode, 1.0);
        id = tid;
      }
    }
  }

  textureStore(stateOut, c, vec4f(phiNew, TNew, cNew, age));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`;

// ------------------------------------------------------------- stamp seeds
// A seed only fires where the melt is undercooled past that site's activation
// undercooling ΔT_act — measured against the LOCAL liquidus, so in an alloy a
// solute-enriched pocket (lower tEq) resists nucleation the way it should.
// User taps carry ΔT_act = -9 → always fire.
export const STAMP_WGSL = /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> seeds: array<f32, ${MAX_SEEDS * SEED_STRIDE}>;
@group(0) @binding(4) var stateOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let c = vec2i(gid.xy);
  let s = textureLoad(state, c, 0);
  var phi = s.r;
  var age = s.a;
  var id = textureLoad(grain, c, 0).r;
  let Tq = clamp(s.g - P.quenchDT, -1.0, 2.0);
  if (phi < 0.3) {
    let p = vec2f(gid.xy) + 0.5;
    let tEqLocal = 1.0 - P.mLiq * s.b * f32(P.alloyOn);
    let dT = tEqLocal - Tq;
    for (var i = 0u; i < P.seedCount; i++) {
      let b = i * ${SEED_STRIDE}u;
      let pos = vec2f(seeds[b], seeds[b + 1u]);
      let r = seeds[b + 2u];
      if (dT <= seeds[b + 4u]) { continue; }
      let d = distance(p, pos);
      if (d < r) {
        let v = 1.0 - smoothstep(r - 2.0, r, d);
        if (v > phi) { phi = v; id = u32(seeds[b + 3u]); age = P.time; }
      }
    }
  }
  textureStore(stateOut, c, vec4f(phi, Tq, s.b, age));
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
  liqCount: atomic<u32>,  // liquid cells sampled (stride 2 per axis)
  probeT: u32,            // (T+1) x1000 at the probe cell (single writer)
  probePhi: u32,          // phi x1000 at the probe cell
  liqTsum: atomic<u32>,   // sum of (T+1) x500 over the sampled liquid cells
  pad3: u32,
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
  if (gid.x == P.probeX && gid.y == P.probeY) {
    stats.probeT = u32(clamp(s.g + 1.0, 0.0, 3.0) * 1000.0);
    stats.probePhi = u32(clamp(s.r, 0.0, 1.0) * 1000.0);
  }
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
  // mean temperature of the remaining melt: the bulk undercooling the
  // nucleation model reads. Sampled every other cell on each axis and scaled
  // x500 so the sum stays inside u32 even on a 2048^2 grid.
  if (s.r < 0.5 && ((gid.x | gid.y) & 1u) == 0u) {
    atomicAdd(&stats.liqCount, 1u);
    atomicAdd(&stats.liqTsum, u32(clamp(s.g + 1.0, 0.0, 3.0) * 500.0));
  }
}
`;

// -------------------------------------------------------------- render pass
// Lenses: 0 MELT 1 ORIENT 2 ETCH 3 FIELD 4 RINGS 5 THERM 6 SEM 7 NEON 8 XRAY 9 CURV
export const LENS_NAMES = ["MELT", "ORIENT", "ETCH", "FIELD", "RINGS", "THERM", "SEM", "NEON", "XRAY", "CURV"];

// shared colour toolkit: used by the 2D lenses and the 3D raymarcher alike
export const PALETTE_WGSL = /* wgsl */ `
fn hashf(x: u32, y: u32, z: u32) -> f32 {
  var v = x * 747796405u + y * 2891336453u + z * 3546859427u + 2654435769u;
  v ^= v >> 16u; v *= 2246822519u; v ^= v >> 13u; v *= 3266489917u; v ^= v >> 16u;
  return f32(v) * (1.0 / 4294967295.0);
}

// incandescent ramp
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

// cross-polarised metallographic palette
fn polar(h: f32, idh: f32) -> vec3f {
  let c1 = vec3f(0.93, 0.68, 0.20);
  let c2 = vec3f(0.16, 0.42, 0.72);
  let c3 = vec3f(0.74, 0.28, 0.55);
  let c4 = vec3f(0.24, 0.63, 0.60);
  let t = fract(h + idh * 0.13);
  var c = mix(c1, c2, smoothstep(0.0, 0.33, t));
  c = mix(c, c3, smoothstep(0.33, 0.66, t));
  c = mix(c, c4, smoothstep(0.66, 0.92, t));
  c = mix(c, c1, smoothstep(0.92, 1.0, t));
  return c;
}

// hue wheel for the EBSD-style flat orientation map
fn hue2rgb(h: f32) -> vec3f {
  let x = fract(h) * 6.0;
  let r = clamp(abs(x - 3.0) - 1.0, 0.0, 1.0);
  let g = clamp(2.0 - abs(x - 2.0), 0.0, 1.0);
  let b = clamp(2.0 - abs(x - 4.0), 0.0, 1.0);
  return vec3f(r, g, b);
}

// FLIR-style ironbow
fn ironbow(x: f32) -> vec3f {
  let t = clamp(x, 0.0, 1.0);
  var c = mix(vec3f(0.01, 0.0, 0.03), vec3f(0.19, 0.02, 0.31), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3f(0.64, 0.10, 0.36), smoothstep(0.2, 0.5, t));
  c = mix(c, vec3f(0.89, 0.36, 0.11), smoothstep(0.45, 0.72, t));
  c = mix(c, vec3f(0.97, 0.72, 0.19), smoothstep(0.68, 0.9, t));
  c = mix(c, vec3f(1.0, 0.98, 0.88), smoothstep(0.88, 1.0, t));
  return c;
}
`;

export const RENDER_WGSL = /* wgsl */ `
struct RParams {
  view: u32,
  n: u32,
  canvasW: f32,
  canvasH: f32,
  time: f32,
  aniMode: f32,
  tFar: f32,
  zoom: f32,
  cx: f32,
  cy: f32,
  pixelSize: f32,   // 0 = off; otherwise cells per chunky pixel
  paletteOn: u32,
  alloyOn: u32,
  c0: f32,
  meltGlow: f32,    // material incandescence: 1 = steel-bright, 0.3 = zinc (no glow)
  lookFlags: u32,   // low bits: stain (0 none, 1 Klemm, 2 Beraha, 3 anodize); bit 8: EBSD map
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

${PALETTE_WGSL}

fn cl(c: vec2i) -> vec2i { return clamp(c, vec2i(0), vec2i(i32(R.n) - 1)); }

// specimen-tilt relief height: solid stands proud, older solid stands prouder
fn tiltH(pf: vec2f) -> f32 {
  let s = textureLoad(state, cl(vec2i(pf)), 0);
  return s.r * (0.45 + 0.55 * clamp(s.a * 0.12, 0.0, 1.0));
}

// bilinear on (phi, T, c, age)
fn sampleState(p: vec2f) -> vec4f {
  let q = clamp(p - 0.5, vec2f(0.0), vec2f(f32(R.n) - 1.001));
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let s00 = textureLoad(state, cl(i), 0);
  let s10 = textureLoad(state, cl(i + vec2i(1, 0)), 0);
  let s01 = textureLoad(state, cl(i + vec2i(0, 1)), 0);
  let s11 = textureLoad(state, cl(i + vec2i(1, 1)), 0);
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

const BAYER = array<f32, 16>(
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0);

@fragment
fn fmain(in: VOut) -> @location(0) vec4f {
  // cover-fit, then zoom/pan view transform
  let n = f32(R.n);
  let scale = max(R.canvasW, R.canvasH);
  let off = vec2f(R.canvasW - scale, R.canvasH - scale) * 0.5;
  let pc = ((in.uv * vec2f(R.canvasW, R.canvasH)) - off) / scale;   // 0..1 cover space
  var p = ((pc - 0.5) / R.zoom + vec2f(R.cx, R.cy)) * n;

  // specimen tilt (2.5D): oblique foreshortening + parallax by local relief —
  // a raking-light view of the same 2D field, not a 3D solve
  if ((R.lookFlags & 512u) != 0u) {
    let ct = p / n - 0.5;
    p = (vec2f(ct.x, ct.y * 1.5 + 0.07) + 0.5) * n;
    p.y = p.y + tiltH(p) * n * 0.02;
  }

  // pixel mode: quantise the sampling position (chunky cells)
  var ps = 1.0;
  if (R.pixelSize > 0.5) {
    ps = R.pixelSize;
    p = (floor(p / ps) + 0.5) * ps;
  }
  let inDomain = p.x >= 0.0 && p.y >= 0.0 && p.x < n && p.y < n;

  let s = sampleState(p);
  let phi = s.x;
  let T = s.y;
  let conc = s.z;
  let age = s.w;
  let ci = vec2i(clamp(p, vec2f(0.0), vec2f(n - 1.0)));
  let id = textureLoad(grain, ci, 0).r;
  let idh = hashf(id, 17u, 91u);
  let th0 = theta0[min(id, ${MAX_GRAINS - 1}u)];

  // relief normal (taps scale with pixel mode for blocky lighting)
  let e = max(1.0, ps);
  let gx = sampleState(p + vec2f(e, 0.0)).x - sampleState(p - vec2f(e, 0.0)).x;
  let gy = sampleState(p + vec2f(0.0, e)).x - sampleState(p - vec2f(0.0, e)).x;
  let gmag = length(vec2f(gx, gy)) / (2.0 * e);
  let nrm = normalize(vec3f(-gx * 6.0, -gy * 6.0, 1.0));
  let L = normalize(vec3f(-0.45, -0.55, 0.62));
  let diff = max(dot(nrm, L), 0.0);
  let spec = pow(max(dot(nrm, normalize(L + vec3f(0.0, 0.0, 1.0))), 0.0), 28.0);

  let solidness = smoothstep(0.35, 0.65, phi);

  // grain boundary detect (step matches pixel size); coherent-twin boundaries
  // (misorientation near pi/j) etch faint, like real metallography
  var gb = 0.0;
  var gbTwin = 0.0;
  let st = max(1, i32(ps));
  if (id != 0u && phi > 0.5) {
    let period = 2.0 * PI / max(R.aniMode, 1.0);
    for (var k = 0; k < 4; k++) {
      var d = vec2i(st, 0);
      if (k == 1) { d = vec2i(-st, 0); }
      if (k == 2) { d = vec2i(0, st); }
      if (k == 3) { d = vec2i(0, -st); }
      let nc = cl(ci + d);
      let nid = textureLoad(grain, nc, 0).r;
      if (nid != 0u && nid != id && textureLoad(state, nc, 0).r > 0.5) {
        gb = 1.0;
        let dth = theta0[min(nid, ${MAX_GRAINS - 1}u)] - th0;
        let miso = abs(fract(dth / period + 0.5) - 0.5) * period;
        if (miso > 0.35 * period) { gbTwin = 1.0; }
      }
    }
  }

  var col = vec3f(0.0);

  switch (R.view) {
    case 0u: { // MELT
      // incandescence scales with the material's melting point; cold-melting
      // metals (Zn, Mg) read as silvery liquid instead of blackbody glow
      var glow = heat(T * R.meltGlow);
      glow += vec3f(0.14, 0.147, 0.163) * (1.0 - R.meltGlow) * clamp(T + 0.6, 0.0, 1.0);
      let steel = vec3f(0.11, 0.115, 0.13) * (0.5 + 0.95 * diff) + vec3f(spec) * 0.3;
      let tint = polar(th0 / (2.0 * PI / max(R.aniMode, 1.0)), idh);
      var solidCol = steel * (0.7 + 0.3 * tint) + glow * 0.3;
      col = mix(glow, solidCol, solidness);
      // solute halo shimmer in alloy mode
      if (R.alloyOn == 1u) {
        col += vec3f(0.10, 0.16, 0.22) * clamp(conc - R.c0, 0.0, 1.0) * (1.0 - solidness) * 3.2;
      }
      col -= gb * vec3f(0.03);
    }
    case 1u: { // ORIENT (with optional EBSD flat IPF map)
      let hfrac = th0 / (2.0 * PI / max(R.aniMode, 1.0));
      if ((R.lookFlags & 256u) != 0u) {
        // EBSD look: flat orientation hue, no relief, black boundaries
        let base = hue2rgb(hfrac) * 0.92 + 0.06;
        col = mix(vec3f(0.05, 0.055, 0.065), base, solidness);
        col *= 1.0 - gb * select(0.9, 0.45, gbTwin > 0.5);
      } else {
        let idv = 0.6 + 0.75 * hashf(id, 5u, 31u);
        let base = polar(hfrac, idh) * idv * (0.42 + 0.72 * diff) + vec3f(spec) * 0.2;
        let liq = vec3f(0.012, 0.014, 0.02) + heat(T) * 0.1;
        col = mix(liq, base, solidness);
        col *= 1.0 - gb * select(0.7, 0.28, gbTwin > 0.5);
      }
    }
    case 2u: { // ETCH (plain Nital, or tint-etched per the stain setting)
      var lum = 0.58 + 0.24 * idh + diff * 0.05 - spec * 0.03;
      // alloy: interdendritic segregation etches darker
      if (R.alloyOn == 1u) { lum -= clamp(conc - R.c0, 0.0, 1.0) * 0.35; }
      let stain = R.lookFlags & 255u;
      var solidCol = vec3f(lum) * vec3f(0.99, 0.965, 0.915);
      if (stain != 0u) {
        // tint etchants colour each grain by orientation (interference films)
        let hfrac = fract(th0 / (2.0 * PI / max(R.aniMode, 1.0)) + idh * 0.21);
        if (stain == 1u) {        // Klemm's: straw browns to steel blues
          solidCol = mix(vec3f(0.72, 0.53, 0.33), vec3f(0.30, 0.45, 0.66), hfrac) * (0.55 + 0.75 * lum);
        } else if (stain == 2u) { // Beraha's: pale blue to violet
          solidCol = mix(vec3f(0.42, 0.55, 0.78), vec3f(0.67, 0.48, 0.74), hfrac) * (0.55 + 0.75 * lum);
        } else {                  // anodized + crossed polars: vivid interference colours
          solidCol = (hue2rgb(hfrac) * 0.8 + 0.15) * (0.45 + 0.85 * lum);
        }
      }
      let liq = vec3f(0.965, 0.955, 0.935);
      col = mix(liq, solidCol, solidness);
      col *= 1.0 - gb * select(0.82, 0.4, gbTwin > 0.5);
      col *= 0.97 + 0.06 * hashf(u32(ci.x), u32(ci.y), 7u);
    }
    case 3u: { // FIELD
      col = inferno((T + 0.2) / 1.3);
      let iso = smoothstep(0.05, 0.0, abs(fract(T * 18.0) - 0.5) * 2.0 - 0.9);
      col *= 1.0 - iso * 0.25;
      let ifc = 1.0 - smoothstep(0.0, 0.10, abs(phi - 0.5));
      col = mix(col, vec3f(0.95, 0.98, 1.0), ifc * 0.85);
    }
    case 4u: { // RINGS: colour by solidification time — growth bands
      let band = fract(age * 14.0);
      let ring = smoothstep(0.0, 0.25, band) * (1.0 - smoothstep(0.75, 1.0, band));
      let ageN = clamp(age * 0.45, 0.0, 1.0);
      let base = mix(vec3f(0.16, 0.34, 0.44), vec3f(0.95, 0.72, 0.28), ageN);
      col = base * (0.35 + 0.5 * ring + 0.3 * diff);
      col = mix(vec3f(0.015, 0.02, 0.028) + heat(T) * 0.08, col, solidness);
      col *= 1.0 - gb * 0.5;
    }
    case 5u: { // THERM: FLIR ironbow, pure temperature
      col = ironbow((T + 0.25) / 1.35);
      col += vec3f(spec) * 0.04;
    }
    case 6u: { // SEM: secondary-electron look
      var g = 0.16 + diff * 0.52 + spec * 0.4 + gmag * 3.0;
      g = mix(g * 0.35 + 0.06, g, solidness);        // liquid reads flat/dark
      g += (hashf(u32(in.pos.x), u32(in.pos.y), u32(R.time * 30.0) % 512u) - 0.5) * 0.10;
      g += sin(in.pos.y * 1.7) * 0.015;               // scan lines
      col = vec3f(clamp(g, 0.0, 1.2)) * vec3f(0.94, 0.97, 1.0);
      col *= 1.0 - gb * 0.35;
    }
    case 7u: { // NEON: glowing contours on dark field
      col = vec3f(0.012, 0.016, 0.026);
      let ifc = exp(-pow(abs(phi - 0.5) / 0.10, 2.0));
      col += vec3f(0.25, 0.95, 1.0) * ifc * 1.1;
      let iso = exp(-pow((abs(fract(T * 12.0) - 0.5) * 2.0) / 0.10, 2.0));
      col += vec3f(1.0, 0.62, 0.18) * iso * 0.16 * (1.0 - solidness);
      col += vec3f(1.0, 0.2, 0.75) * gb * 0.9;
      col += vec3f(0.05, 0.09, 0.14) * solidness;
    }
    case 8u: { // XRAY: synchrotron radiograph — absorption contrast
      var att = 0.16 * phi;
      if (R.alloyOn == 1u) { att += 0.55 * conc * (1.0 - solidness) + 0.3 * conc * solidness; }
      var I = exp(-2.6 * att);
      I *= 0.97 + 0.05 * hashf(u32(in.pos.x), u32(in.pos.y), u32(R.time * 15.0) % 256u);
      col = vec3f(I) * vec3f(0.93, 0.96, 1.0);
    }
    case 9u: { // CURV: Gibbs–Thomson lens — interface coloured by curvature
      let lp = (sampleState(p + vec2f(e, 0.0)).x + sampleState(p - vec2f(e, 0.0)).x +
                sampleState(p + vec2f(0.0, e)).x + sampleState(p - vec2f(0.0, e)).x - 4.0 * phi) / (e * e);
      let kappa = clamp(lp * 6.0 / max(gmag * 4.0, 0.02), -1.2, 1.2);
      let band = exp(-pow(abs(phi - 0.5) / 0.16, 2.0));
      let warm = vec3f(1.0, 0.35, 0.15);
      let cool = vec3f(0.2, 0.55, 1.0);
      let kcol = mix(cool, warm, kappa * 0.5 + 0.5);
      col = vec3f(0.03, 0.035, 0.05) + vec3f(0.07) * solidness * (0.5 + diff);
      col = mix(col, kcol, band);
    }
    default: { // CAST (landing hero): dark mold (age -1), lit cast metal above
      // piecewise-compressed blackbody: only a superheated pour flashes white;
      // melt held near the liquidus reads orange, dying heat walks through red
      let Tr = select(T * 0.79, 0.79 + (T - 1.0) * 2.4, T > 1.0);
      let glow = heat(Tr);
      let isMold = age < -0.5;
      let tint = polar(th0 / (2.0 * PI / max(R.aniMode, 1.0)), idh);
      var base = vec3f(0.30, 0.31, 0.345);
      if (isMold) { base = vec3f(0.085, 0.09, 0.105); }
      var solidCol = base * (0.5 + 0.85 * diff) + vec3f(spec) * select(0.45, 0.15, isMold);
      if (!isMold) {
        solidCol *= 0.74 + 0.5 * tint;                                   // grain-to-grain sheen
        solidCol += vec3f(0.55, 0.22, 0.05) * clamp(T - 0.15, 0.0, 1.0); // residual-heat ember
      }
      col = mix(glow + vec3f(0.015), solidCol, solidness);
      col -= gb * vec3f(0.05);
    }
  }

  if (!inDomain) { col *= 0.12; }

  // specimen tilt: raking-light relief shading over whatever the lens drew
  if ((R.lookFlags & 512u) != 0u) {
    let e = max(2.0, n / 512.0);
    let hC = tiltH(p);
    let hU = tiltH(p - vec2f(0.0, e));
    let hR = tiltH(p + vec2f(e, 0.0));
    let nrm = normalize(vec3f((hC - hR) * 22.0, (hU - hC) * 22.0, 1.0));
    let lit = clamp(dot(nrm, normalize(vec3f(-0.45, 0.7, 0.6))), 0.0, 1.0);
    col *= 0.38 + 0.9 * lit;
  }

  // vignette + film grain (skip grain on ETCH and in pixel mode)
  let vuv = in.uv - 0.5;
  let vig = 1.0 - dot(vuv, vuv) * select(0.55, 0.18, R.view == 2u);
  col *= vig;
  if (R.view != 2u && R.pixelSize < 0.5) {
    let fg = hashf(u32(in.pos.x), u32(in.pos.y), u32(R.time * 60.0) % 1024u) - 0.5;
    col += fg * 0.012;
  }

  // 8-bit palette: ordered dither + posterise
  if (R.paletteOn == 1u) {
    let bx = u32(in.pos.x / max(ps, 1.0)) % 4u;
    let by = u32(in.pos.y / max(ps, 1.0)) % 4u;
    let d = (BAYER[by * 4u + bx] / 16.0 - 0.5) * 0.18;
    col = floor(clamp(col + d, vec3f(0.0), vec3f(1.3)) * 5.0 + 0.5) / 5.0;
  }

  return vec4f(pow(max(col, vec3f(0.0)), vec3f(1.0 / 1.06)), 1.0);
}
`;
