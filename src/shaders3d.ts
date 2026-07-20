// WGSL for the TRUE-3D mode: the Kobayashi anisotropic phase-field model
// generalized to a 3D voxel grid, multi-grain with per-grain quaternion
// orientations, plus a raymarched volume renderer.
//
//   tau dphi/dt = div(F) + phi(1-phi)(phi - 1/2 + m(T)) + noise
//   F = eps^2 [ a^2 grad(phi) + a |grad phi| (g - (g.n) n) ]   (variational split)
//   a(n') with n' = R(q)^T n rotated into the grain frame:
//     cubic:  a = 1 + dc (4 (nx^4+ny^4+nz^4) - 3)          — <100> dendrite arms
//     hex:    a = 1 + d6 K6(nx,ny) - dz nz^2               — basal plates
//             K6 = nx^6 - 15 nx^4 ny^2 + 15 nx^2 ny^4 - ny^6  (= cos6ψ·(1-nz²)³)
//   dT/dt = lap(T) + K dphi/dt - cooling + heating
//
// State rg32float = (phi, T). Grain r32uint = id (0 = liquid). Flux rgba32float
// stores the anisotropic correction A.xyz and eps²a² in .w; the update pass
// assembles  aniso = w·lapφ + ∇w·∇φ + div A  — the same compact structure the
// 2D solver uses, which avoids the checkerboard mode of a naive div(F).

import { PALETTE_WGSL } from "./shaders";

export const MAX_GRAINS3 = 4096;
export const MAX_SEEDS3 = 64;
export const SEED3_STRIDE = 8; // floats per seed: x, y, z, r, id, tact, pad, pad
/** reserved grain id for shrinkage-pore voxels (φ pinned 0 forever) */
export const PORE_ID = MAX_GRAINS3 - 1;

export const LENS3_NAMES = ["MELT", "ORIENT", "SLICE", "FIELD", "SEM", "RINGS", "THERM", "NEON", "CURV"];

// Params3D slot map — single source of truth shared with sim3d.writeParams
// (u = u32 view, f = f32 view over one 128-byte buffer)
export const P3 = {
  n: 0, frame: 1, dx: 2, dt: 3,
  epsBar: 4, delta: 5, aniMode3: 6, tau: 7,
  alpha: 8, gamma: 9, latent: 10, noiseAmp: 11,
  tFar: 12, coolRate: 13, heatIn: 14, seedCount: 15,
  time: 16, deltaZ: 17, quenchDT: 18, curGen: 19,
  sliceN: 20,     // vec4f: stereology section plane (n̂ + c), else zeros
  pPore: 24,
  BYTES: 128,
} as const;

const COMMON3 = /* wgsl */ `
struct Params3D {
  n: u32,
  frame: u32,
  dx: f32,
  dt: f32,
  epsBar: f32,
  delta: f32,
  aniMode3: u32,   // 0 isotropic, 1 cubic <100>, 2 hex basal plates
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
  deltaZ: f32,     // hex: c-axis penalty that flattens growth into plates
  quenchDT: f32,   // one-shot temperature drop applied in the stamp pass
  curGen: u32,     // feed-flood generation counter (porosity)
  sliceN: vec4f,   // stereology section plane: unit normal + constant c
  pPore: f32,      // pore hash gate at the thin-remnant stage (0 disables)
  _p1a: f32,
  _p1b: f32,
  _p1c: f32,
  _pad2: vec4f,
}
const PORE = ${PORE_ID}u;
const PI = 3.14159265359;

fn cid3(p: Params3D, c: vec3i) -> vec3i {
  return clamp(c, vec3i(0), vec3i(i32(p.n) - 1));
}

fn hash3(x: u32, y: u32, z: u32) -> f32 {
  var v = x * 747796405u + y * 2891336453u + z * 3546859427u + 2654435769u;
  v ^= v >> 16u; v *= 2246822519u; v ^= v >> 13u; v *= 3266489917u; v ^= v >> 16u;
  return f32(v) * (1.0 / 4294967295.0);
}

// rotate v by unit quaternion q = (x, y, z, w)
fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
// rotate v by the inverse (conjugate) of q — lab frame into grain frame
fn qrotInv(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(-q.xyz, v);
  return v + q.w * t + cross(-q.xyz, t);
}

// interface-energy anisotropy a(n') and its gradient in the GRAIN frame
struct Ani { a: f32, g: vec3f }
fn aniso3(np: vec3f, P: Params3D) -> Ani {
  var r: Ani;
  if (P.aniMode3 == 1u) {
    // cubic harmonic: minima along <100> — six dendrite arms
    let n3 = np * np * np;
    r.a = 1.0 + P.delta * (4.0 * (n3.x * np.x + n3.y * np.y + n3.z * np.z) - 3.0);
    r.g = 16.0 * P.delta * n3;
  } else if (P.aniMode3 == 2u) {
    // hex: 6-fold in the basal plane (polynomial form of cos6ψ·(1-nz²)³ — no
    // atan2, smooth at the poles) minus a c-axis penalty that makes plates
    let x = np.x; let y = np.y;
    let x2 = x * x; let y2 = y * y;
    let k6 = x2 * x2 * x2 - 15.0 * x2 * x2 * y2 + 15.0 * x2 * y2 * y2 - y2 * y2 * y2;
    r.a = 1.0 + P.delta * k6 - P.deltaZ * np.z * np.z;
    r.g = vec3f(
      P.delta * (6.0 * x * x2 * x2 - 60.0 * x * x2 * y2 + 30.0 * x * y2 * y2),
      P.delta * (-30.0 * x2 * x2 * y + 60.0 * x2 * y * y2 - 6.0 * y * y2 * y2),
      -2.0 * P.deltaZ * np.z);
  } else {
    r.a = 1.0;
    r.g = vec3f(0.0);
  }
  return r;
}
`;

// ---------------------------------------------------------------- flux pass
// stores per voxel: ( A.xyz = eps² a |∇φ| (g − (g·n)n) , w = eps² a² )
export const FLUX3D_WGSL = /* wgsl */ `
${COMMON3}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var<storage, read> quats: array<vec4f>;
@group(0) @binding(4) var flux: texture_storage_3d<rgba32float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let c = vec3i(gid);
  let inv2dx = 1.0 / (2.0 * P.dx);
  let pE = textureLoad(state, cid3(P, c + vec3i(1, 0, 0)), 0).r;
  let pW = textureLoad(state, cid3(P, c - vec3i(1, 0, 0)), 0).r;
  let pN = textureLoad(state, cid3(P, c + vec3i(0, 1, 0)), 0).r;
  let pS = textureLoad(state, cid3(P, c - vec3i(0, 1, 0)), 0).r;
  let pU = textureLoad(state, cid3(P, c + vec3i(0, 0, 1)), 0).r;
  let pD = textureLoad(state, cid3(P, c - vec3i(0, 0, 1)), 0).r;
  let gph = vec3f(pE - pW, pN - pS, pU - pD) * inv2dx;
  let g2 = dot(gph, gph);
  let e2 = P.epsBar * P.epsBar;
  if (g2 < 1e-12 || P.aniMode3 == 0u) {
    textureStore(flux, c, vec4f(0.0, 0.0, 0.0, e2));
    return;
  }
  let id = textureLoad(grain, c, 0).r;
  let q = quats[min(id, ${MAX_GRAINS3 - 1}u)];
  let gm = sqrt(g2);
  let nrm = gph / gm;
  let an = aniso3(qrotInv(q, nrm), P);
  let gl = qrot(q, an.g);                       // ∇a back in the lab frame
  let tang = gl - dot(gl, nrm) * nrm;           // tangential projection
  textureStore(flux, c, vec4f(e2 * an.a * gm * tang, e2 * an.a * an.a));
}
`;

// -------------------------------------------------------------- update pass
export const UPDATE3D_WGSL = /* wgsl */ `
${COMMON3}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var flux: texture_3d<f32>;
@group(0) @binding(4) var stateOut: texture_storage_3d<rg32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_3d<r32uint, write>;
@group(0) @binding(6) var ageOut: texture_storage_3d<rg32float, write>;
@group(0) @binding(7) var fed: texture_3d<u32>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let c = vec3i(gid);
  let inv2dx = 1.0 / (2.0 * P.dx);
  let invdx2 = 1.0 / (P.dx * P.dx);
  let s = textureLoad(state, c, 0);
  let phi = s.r;
  let T = s.g;

  // 6 face neighbours
  let sE = textureLoad(state, cid3(P, c + vec3i(1, 0, 0)), 0);
  let sW = textureLoad(state, cid3(P, c - vec3i(1, 0, 0)), 0);
  let sN = textureLoad(state, cid3(P, c + vec3i(0, 1, 0)), 0);
  let sS = textureLoad(state, cid3(P, c - vec3i(0, 1, 0)), 0);
  let sU = textureLoad(state, cid3(P, c + vec3i(0, 0, 1)), 0);
  let sD = textureLoad(state, cid3(P, c - vec3i(0, 0, 1)), 0);

  // 7-point Laplacians
  let lapPhi = (sE.r + sW.r + sN.r + sS.r + sU.r + sD.r - 6.0 * phi) * invdx2;
  let lapT   = (sE.g + sW.g + sN.g + sS.g + sU.g + sD.g - 6.0 * T) * invdx2;
  let gph = vec3f(sE.r - sW.r, sN.r - sS.r, sU.r - sD.r) * inv2dx;

  // shrinkage pore: a permanent void — φ pinned to 0 (else solid neighbours
  // would regrow it), temperature keeps conducting, anneal never heals it
  let selfId = textureLoad(grain, c, 0).r;
  if (selfId == PORE) {
    textureStore(stateOut, c, vec4f(0.0, clamp(T + P.dt * lapT - P.dt * P.coolRate, -1.0, 2.0), 0.0, 0.0));
    textureStore(grainOut, c, vec4u(PORE, 0u, 0u, 0u));
    return;
  }

  // anisotropic terms from the flux texture
  let fC = textureLoad(flux, c, 0);
  let fE = textureLoad(flux, cid3(P, c + vec3i(1, 0, 0)), 0);
  let fW = textureLoad(flux, cid3(P, c - vec3i(1, 0, 0)), 0);
  let fN = textureLoad(flux, cid3(P, c + vec3i(0, 1, 0)), 0);
  let fS = textureLoad(flux, cid3(P, c - vec3i(0, 1, 0)), 0);
  let fU = textureLoad(flux, cid3(P, c + vec3i(0, 0, 1)), 0);
  let fD = textureLoad(flux, cid3(P, c - vec3i(0, 0, 1)), 0);
  let divA = ((fE.x - fW.x) + (fN.y - fS.y) + (fU.z - fD.z)) * inv2dx;
  let gradW = vec3f(fE.w - fW.w, fN.w - fS.w, fU.w - fD.w) * inv2dx;
  let aniso = fC.w * lapPhi + dot(gradW, gph) + divA;

  let m = (P.alpha / PI) * atan(P.gamma * (1.0 - T));
  let chi = hash3(gid.x, gid.y * 7919u + gid.z * 104729u, P.frame) - 0.5;
  let react = phi * (1.0 - phi) * (phi - 0.5 + m) + P.noiseAmp * phi * (1.0 - phi) * chi;
  let phiNew = clamp(phi + (P.dt / P.tau) * (aniso + react), 0.0, 1.0);
  let dPhi = phiNew - phi;

  let TNew = clamp(T + P.dt * lapT + P.latent * dPhi - P.dt * P.coolRate + P.dt * P.heatIn, -1.0, 2.0);

  // solidification record: freeze time (growth rings) + Niyama at freeze.
  // Ṫ uses the thermal field only (lapT − cooling), NOT (TNew−T)/dt — the
  // voxel's own latent release (recalescence) would poison the criterion.
  if (phi < 0.5 && phiNew >= 0.5) {
    let gT = vec3f(sE.g - sW.g, sN.g - sS.g, sU.g - sD.g) * inv2dx;
    let tDotCool = lapT - P.coolRate + P.heatIn;
    let ny = length(gT) / sqrt(max(-tDotCool, 1e-4));
    textureStore(ageOut, c, vec4f(P.time, min(ny, 99.0), 0.0, 0.0));
  } else if (phi >= 0.5 && phiNew < 0.5) {
    textureStore(ageOut, c, vec4f(0.0));
  }

  // shrinkage-pore formation: a voxel that SOLIDIFIES while cut off from feed
  // metal voids with roughly the solidification-shrinkage fraction — this is
  // how interdendritic micro-porosity actually distributes in castings
  let isFed = textureLoad(fed, c, 0).r + 1u >= P.curGen;
  if (P.pPore > 0.0 && P.curGen >= 4u && !isFed && phi < 0.5 && phiNew >= 0.5) {
    if (hash3(gid.x, gid.y * 31u + gid.z, 977u) < P.pPore * 0.12) {
      textureStore(stateOut, c, vec4f(0.0, TNew, 0.0, 0.0));
      textureStore(grainOut, c, vec4u(PORE, 0u, 0u, 0u));
      return;
    }
  }

  // grain id bookkeeping: claim ahead of the front from the best face
  // neighbour, release on remelt (quaternions are CPU-written at seed time
  // only, so claiming reads a fixed table — no race by construction)
  var id = selfId;
  if (phiNew < 1e-4) {
    id = 0u;
  } else if (id == 0u) {
    var best = 0.0;
    for (var k = 0; k < 6; k++) {
      var d = vec3i(1, 0, 0);
      if (k == 1) { d = vec3i(-1, 0, 0); }
      if (k == 2) { d = vec3i(0, 1, 0); }
      if (k == 3) { d = vec3i(0, -1, 0); }
      if (k == 4) { d = vec3i(0, 0, 1); }
      if (k == 5) { d = vec3i(0, 0, -1); }
      let nc = cid3(P, c + d);
      let nid = textureLoad(grain, nc, 0).r;
      if (nid != 0u && nid != PORE) {
        let nphi = textureLoad(state, nc, 0).r;
        if (nphi > best) { best = nphi; id = nid; }
      }
    }
  }

  textureStore(stateOut, c, vec4f(phiNew, TNew, 0.0, 0.0));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`;

// ---------------------------------------------------- feed-connectivity pass
// Generation-stamped flood from the riser (top face): fedTex stores the last
// generation that reached each liquid voxel. A pocket that stops receiving
// generations is cut off from feed metal — its last remnant becomes porosity.
export const FEED3D_WGSL = /* wgsl */ `
${COMMON3}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var fedIn: texture_3d<u32>;
@group(0) @binding(3) var fedOut: texture_storage_3d<r32uint, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let c = vec3i(gid);
  let phi = textureLoad(state, c, 0).r;
  let old = textureLoad(fedIn, c, 0).r;
  if (phi >= 0.5) {
    textureStore(fedOut, c, vec4u(old, 0u, 0u, 0u));
    return;
  }
  var g = old;
  if (gid.z == P.n - 1u) {
    g = P.curGen;                       // the riser: liquid on the top face
  } else {
    for (var k = 0; k < 6; k++) {
      var d = vec3i(1, 0, 0);
      if (k == 1) { d = vec3i(-1, 0, 0); }
      if (k == 2) { d = vec3i(0, 1, 0); }
      if (k == 3) { d = vec3i(0, -1, 0); }
      if (k == 4) { d = vec3i(0, 0, 1); }
      if (k == 5) { d = vec3i(0, 0, -1); }
      let nc = cid3(P, c + d);
      if (textureLoad(state, nc, 0).r < 0.5 && textureLoad(fedIn, nc, 0).r == P.curGen) {
        g = P.curGen;
      }
    }
  }
  textureStore(fedOut, c, vec4u(g, 0u, 0u, 0u));
}
`;

// ------------------------------------------------------------- stamp seeds
export const STAMP3D_WGSL = /* wgsl */ `
${COMMON3}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var<storage, read> seeds: array<f32, ${MAX_SEEDS3 * SEED3_STRIDE}>;
@group(0) @binding(4) var stateOut: texture_storage_3d<rg32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_3d<r32uint, write>;
@group(0) @binding(6) var ageOut: texture_storage_3d<rg32float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let c = vec3i(gid);
  let s = textureLoad(state, c, 0);
  var phi = s.r;
  var id = textureLoad(grain, c, 0).r;
  var stamped = false;
  let Tq = clamp(s.g - P.quenchDT, -1.0, 2.0);
  if (phi < 0.3 && id != PORE) {
    let p = vec3f(gid) + 0.5;
    for (var i = 0u; i < P.seedCount; i++) {
      let b = i * ${SEED3_STRIDE}u;
      let pos = vec3f(seeds[b], seeds[b + 1u], seeds[b + 2u]);
      let r = seeds[b + 3u];
      let tact = seeds[b + 5u];
      if (Tq >= tact) { continue; }
      let d = distance(p, pos);
      if (d < r) {
        let v = 1.0 - smoothstep(r - 2.0, r, d);
        if (v > phi) { phi = v; id = u32(seeds[b + 4u]); stamped = true; }
      }
    }
  }
  if (stamped && phi >= 0.5) {
    // seed cores are born solid — record the time, and a benign Niyama
    textureStore(ageOut, c, vec4f(P.time, 25.0, 0.0, 0.0));
  }
  textureStore(stateOut, c, vec4f(phi, Tq, 0.0, 0.0));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`;

// -------------------------------------------------------------- stats pass
export const STATS3D_WGSL = /* wgsl */ `
${COMMON3}
struct Stats3 {
  solid: atomic<u32>,
  pad1: u32, pad2: u32, pad3: u32,
  pad4: u32, pad5: u32, pad6: u32, pad7: u32,
  counts: array<atomic<u32>, ${MAX_GRAINS3}>,
}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var<storage, read_write> stats: Stats3;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let s = textureLoad(state, vec3i(gid), 0);
  let id = textureLoad(grain, vec3i(gid), 0).r;
  if (id == PORE) {
    atomicAdd(&stats.counts[PORE], 1u);   // porosity census rides the id table
    return;
  }
  if (s.r > 0.5) {
    atomicAdd(&stats.solid, 1u);
    if (id > 0u && id < ${MAX_GRAINS3}u) {
      atomicAdd(&stats.counts[id], 1u);
    }
  }
}
`;

// ------------------------------------------------------------- render pass
// RParams3D slot map (144 B; vec4s at byte offsets 48/64/80/96/112/128)
// flags bits 4–7 = cut-face style: 0 orientation tint · 1 Nital · 2 Klemm's ·
// 3 Beraha's · 4 EBSD-IPF · 5 Niyama ramp
export const R3 = {
  view: 0, n: 1, canvasW: 2, canvasH: 3,
  time: 4, res0: 5, res1: 6, flags: 7,
  meltGlow: 8, tFar: 9, stepScale: 10, _padA: 11,
  sliceN: 12,                            // vec4f: unit normal + plane constant c (voxels)
  eye: 16, right: 20, up: 24, fwd: 28,   // vec4 starts (f32 slots)
  misc: 32,                              // vec4f: x = simTime, y = nyCrit
  BYTES: 144,
} as const;

/**
 * Raymarched volume renderer. `filterable` switches φ refinement between
 * hardware trilinear (needs the float32-filterable feature) and nearest loads.
 */
export function render3dWgsl(filterable: boolean): string {
  const sampleFine = filterable
    ? /* wgsl */ `
fn phiAt(p: vec3f) -> f32 {
  return textureSampleLevel(state, samp, p / f32(R.n), 0.0).r;
}
fn stateFine(p: vec3f) -> vec2f {
  return textureSampleLevel(state, samp, p / f32(R.n), 0.0).rg;
}`
    : /* wgsl */ `
fn phiAt(p: vec3f) -> f32 {
  return textureLoad(state, clampC(vec3i(p)), 0).r;
}
fn stateFine(p: vec3f) -> vec2f {
  return textureLoad(state, clampC(vec3i(p)), 0).rg;
}`;
  const sampBinding = filterable ? `@group(0) @binding(4) var samp: sampler;` : "";

  return /* wgsl */ `
struct RParams3D {
  view: u32,        // lens index
  n: u32,
  canvasW: f32,
  canvasH: f32,
  time: f32,
  res0: f32,
  res1: f32,
  flags: u32,       // bits 4-7: cut-face style
  meltGlow: f32,
  tFar: f32,
  stepScale: f32,   // fine-march step in voxels
  _padA: f32,
  sliceN: vec4f,    // unit section-plane normal + plane constant c (voxels)
  eye: vec4f,       // xyz + tanHalfFov in w
  right: vec4f,     // xyz + aspect in w
  up: vec4f,
  fwd: vec4f,
  misc: vec4f,      // x = simTime, y = Niyama critical value
}
const PI = 3.14159265359;
@group(0) @binding(0) var<uniform> R: RParams3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var<storage, read> quats: array<vec4f>;
@group(0) @binding(5) var age: texture_3d<f32>;
${sampBinding}

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

fn clampC(c: vec3i) -> vec3i { return clamp(c, vec3i(0), vec3i(i32(R.n) - 1)); }
${sampleFine}

fn stateAt(p: vec3f) -> vec2f {
  return textureLoad(state, clampC(vec3i(p)), 0).rg;
}
fn grainAt(p: vec3f) -> u32 {
  return textureLoad(grain, clampC(vec3i(p)), 0).r;
}
fn ageAt(p: vec3f) -> vec2f {
  return textureLoad(age, clampC(vec3i(p)), 0).rg;
}

// central-difference surface normal at the phi=0.5 crossing
fn surfNormal(p: vec3f) -> vec3f {
  let e = 1.2;
  let gx = phiAt(p + vec3f(e, 0.0, 0.0)) - phiAt(p - vec3f(e, 0.0, 0.0));
  let gy = phiAt(p + vec3f(0.0, e, 0.0)) - phiAt(p - vec3f(0.0, e, 0.0));
  let gz = phiAt(p + vec3f(0.0, 0.0, e)) - phiAt(p - vec3f(0.0, 0.0, e));
  let g = vec3f(gx, gy, gz);
  let l = length(g);
  if (l < 1e-6) { return vec3f(0.0, 0.0, 1.0); }
  return -g / l;
}

// slab test against the volume box [0, n]^3; returns (tNear, tFar) or (1, 0)
fn boxHit(ro: vec3f, rd: vec3f) -> vec2f {
  let nf = f32(R.n);
  let inv = 1.0 / rd;
  let t0 = (vec3f(0.0) - ro) * inv;
  let t1 = (vec3f(nf) - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  let tfa = min(tmax.x, tmax.y);
  let tf2 = min(tfa, tmax.z);
  if (tn >= tf2) { return vec2f(1.0, 0.0); }
  return vec2f(tn, tf2);
}

fn qrotR(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

// per-grain hue from its true crystallographic axis (the quaternion), so
// similarly-oriented grains share a tint — like a real cross-polarised etch
fn grainCol(id: u32) -> vec3f {
  let q = quats[min(id, ${MAX_GRAINS3 - 1}u)];
  let ax = qrotR(q, vec3f(0.0, 0.0, 1.0));
  let hue = fract(atan2(ax.y, ax.x) / (2.0 * PI) + ax.z * 0.31);
  return polar(hue, hashf(id, 5u, 31u) * 0.6);
}

// shade a solid surface hit; lens picks the instrument (SLICE ghosts use ORIENT)
fn shadeSurface(p: vec3f, rd: vec3f, lens: u32) -> vec3f {
  let nrm = surfNormal(p);
  let L = normalize(vec3f(-0.5, -0.62, 0.6));
  let diff = max(dot(nrm, L), 0.0);
  let rim = pow(1.0 - max(dot(nrm, -rd), 0.0), 2.5);
  let spec = pow(max(dot(nrm, normalize(L - rd)), 0.0), 26.0);
  let id = grainAt(p);
  let s = stateFine(p);
  if (lens == 1u) {
    let idv = 0.62 + 0.7 * hashf(id, 5u, 31u);
    return grainCol(id) * idv * (0.30 + 0.85 * diff) + vec3f(spec) * 0.25 + vec3f(0.09, 0.10, 0.12) * rim;
  }
  if (lens == 4u) {
    // SEM secondary-electron: edges bright, faces flat gray (scan lines added later)
    let g = 0.14 + diff * 0.42 + spec * 0.35 + rim * 0.6;
    return vec3f(g) * vec3f(0.94, 0.97, 1.0);
  }
  if (lens == 5u) {
    // RINGS: growth-band shells by freeze time — 3D tree rings. Band count is
    // normalized to the total growth time so rings stay readable at any speed.
    let a = ageAt(p).r;
    let ageN = clamp(a / max(R.misc.x, 1e-3), 0.0, 1.0);
    let band = fract(ageN * 8.0);
    let ring = smoothstep(0.0, 0.3, band) * (1.0 - smoothstep(0.7, 1.0, band));
    let base = mix(vec3f(0.16, 0.34, 0.44), vec3f(0.95, 0.72, 0.28), ageN);
    return base * (0.34 + 0.42 * ring + 0.38 * diff) + vec3f(spec) * 0.15;
  }
  if (lens == 6u) {
    // THERM: FLIR ironbow of the surface temperature
    return ironbow((s.g + 0.25) / 1.35) * (0.55 + 0.5 * diff) + vec3f(spec) * 0.1;
  }
  if (lens == 8u) {
    // CURV: Gibbs–Thomson lens — tips vs necks by interface curvature
    let e = 1.5;
    let pxp = phiAt(p + vec3f(e, 0.0, 0.0)); let pxm = phiAt(p - vec3f(e, 0.0, 0.0));
    let pyp = phiAt(p + vec3f(0.0, e, 0.0)); let pym = phiAt(p - vec3f(0.0, e, 0.0));
    let pzp = phiAt(p + vec3f(0.0, 0.0, e)); let pzm = phiAt(p - vec3f(0.0, 0.0, e));
    let lp = (pxp + pxm + pyp + pym + pzp + pzm - 6.0 * phiAt(p)) / (e * e);
    let gm = length(vec3f(pxp - pxm, pyp - pym, pzp - pzm)) / (2.0 * e);
    let kappa = clamp(lp * 6.0 / max(gm * 4.0, 0.02), -1.2, 1.2);
    let kcol = mix(vec3f(0.2, 0.55, 1.0), vec3f(1.0, 0.35, 0.15), kappa * 0.5 + 0.5);
    return kcol * (0.35 + 0.55 * diff) + vec3f(spec) * 0.1;
  }
  let steel = vec3f(0.11, 0.115, 0.13) * (0.42 + 1.0 * diff) + vec3f(spec) * 0.3;
  let ember = heat(s.g * R.meltGlow) * 0.35;
  return steel * (0.72 + 0.28 * grainCol(id)) + ember + vec3f(0.08, 0.085, 0.1) * rim;
}

// orientation hue fraction from the grain's quaternion axis (shared by
// the IPF / tint-etch cut-face styles)
fn cutHue(id: u32) -> f32 {
  let q = quats[min(id, ${MAX_GRAINS3 - 1}u)];
  let ax = qrotR(q, vec3f(0.0, 0.0, 1.0));
  return fract(atan2(ax.y, ax.x) / (2.0 * PI) + ax.z * 0.31);
}

// micrograph colouring of a point on the section plane (SLICE lens);
// style comes from R.flags bits 4-7 — the real lab's etch cabinet
fn sliceColor(p: vec3f) -> vec3f {
  let s = stateAt(p);
  let id = grainAt(p);
  let style = (R.flags >> 4u) & 15u;
  if (id == ${PORE_ID}u) {
    // shrinkage pore on the cut: a void, near-black with a cold blue cast
    return vec3f(0.004, 0.008, 0.02);
  }
  // grain-boundary detect in the cut plane
  var gb = 0.0;
  if (s.r > 0.5) {
    for (var k = 0; k < 6; k++) {
      var d = vec3i(1, 0, 0);
      if (k == 1) { d = vec3i(-1, 0, 0); }
      if (k == 2) { d = vec3i(0, 1, 0); }
      if (k == 3) { d = vec3i(0, -1, 0); }
      if (k == 4) { d = vec3i(0, 0, 1); }
      if (k == 5) { d = vec3i(0, 0, -1); }
      let nc = clampC(vec3i(p) + d);
      let nid = textureLoad(grain, nc, 0).r;
      if (nid != 0u && nid != id && textureLoad(state, nc, 0).r > 0.5) { gb = 1.0; }
    }
  }
  if (s.r <= 0.5) {
    if (style == 0u) {
      // live view: incandescent liquid on the cut
      return heat(s.g * R.meltGlow) * 0.85 + vec3f(0.01, 0.012, 0.018);
    }
    if (style == 5u) {
      // Niyama map: still-liquid regions read as cold unmeasured blue
      return vec3f(0.05, 0.06, 0.10);
    }
    // etched-micrograph styles: liquid reads as pale mounting resin
    return vec3f(0.955, 0.945, 0.925);
  }
  let idh = hashf(id, 17u, 91u);
  let lum = 0.58 + 0.24 * idh;
  var col: vec3f;
  if (style == 5u) {          // Niyama ramp: hot spots = porosity risk
    let risk = clamp(1.0 - ageAt(p).g / max(R.misc.y, 1e-3), 0.0, 1.0);
    col = inferno(risk);
    col *= 1.0 - gb * 0.25;
  } else if (style == 1u) {   // plain Nital
    col = vec3f(lum) * vec3f(0.99, 0.965, 0.915);
    col *= 1.0 - gb * 0.82;
  } else if (style == 2u) {   // Klemm's tint etch: straw browns to steel blues
    col = mix(vec3f(0.72, 0.53, 0.33), vec3f(0.30, 0.45, 0.66), cutHue(id)) * (0.55 + 0.75 * lum);
    col *= 1.0 - gb * 0.6;
  } else if (style == 3u) {   // Beraha's: pale blue to violet
    col = mix(vec3f(0.42, 0.55, 0.78), vec3f(0.67, 0.48, 0.74), cutHue(id)) * (0.55 + 0.75 * lum);
    col *= 1.0 - gb * 0.6;
  } else if (style == 4u) {   // EBSD / IPF map: flat orientation hue, black GB
    col = hue2rgb(cutHue(id)) * 0.92 + 0.06;
    col *= 1.0 - gb * 0.9;
  } else {                    // 0 (default): orientation tint on the live cut
    col = grainCol(id) * (0.55 + 0.45 * hashf(id, 3u, 57u));
    col *= 1.0 - gb * 0.65;
  }
  return col;
}

@fragment
fn fmain(in: VOut) -> @location(0) vec4f {
  let tanF = R.eye.w;
  let aspect = R.right.w;
  let sx = (in.uv.x - 0.5) * 2.0 * tanF * aspect;
  let sy = (0.5 - in.uv.y) * 2.0 * tanF;
  let rd = normalize(R.fwd.xyz + sx * R.right.xyz + sy * R.up.xyz);
  let ro = R.eye.xyz;
  let nf = f32(R.n);

  var col = vec3f(0.016, 0.018, 0.023);
  let hit = boxHit(ro, rd);

  if (hit.x < hit.y) {
    // per-pixel start jitter breaks up the coarse-march contour banding
    var t = hit.x + 0.01 + hashf(u32(in.pos.x), u32(in.pos.y), 7u) * 2.0;
    var tMax = hit.y;
    let fine = max(R.stepScale, 0.35);
    var trans = 1.0;
    var acc = vec3f(0.0);
    let emit = 5.2 / nf;
    let absorb = 3.4 / nf;

    // SLICE lens: the section plane removes the + side of the volume (a fixed
    // cut, like a real sectioned specimen — orbit around it to see the face)
    var cutFront = -1.0;   // camera in the removed half: cut face fronts the volume
    var cutBack = -1.0;    // camera in the kept half: plane truncates the far side
    if (R.view == 2u) {
      let nrm = R.sliceN.xyz;
      let off = R.sliceN.w;
      let denom = dot(rd, nrm);
      let camSide = dot(ro, nrm) - off;
      if (abs(denom) < 1e-6) {
        if (camSide > 0.0) { t = tMax + 1.0; }   // parallel ray inside removed half
      } else {
        let tp = (off - dot(ro, nrm)) / denom;
        if (camSide > 0.0) {
          if (denom < 0.0 && tp < tMax) { t = max(t, tp); cutFront = tp; }
          else { t = tMax + 1.0; }               // never reaches the kept half
        } else if (denom > 0.0 && tp < tMax) {
          tMax = tp;                             // kept half, truncated at the plane
          cutBack = tp;
        }
      }
    }

    if (R.view == 3u) {
      // FIELD: x-ray transmittance line integral of phi, T tinted
      var att = 0.0;
      var tSum = 0.0;
      var wSum = 0.0;
      var tt = t;
      loop {
        if (tt >= tMax) { break; }
        let s = stateAt(ro + rd * tt);
        att += s.r * 2.0;
        if (grainAt(ro + rd * tt) == ${PORE_ID}u) { att += 7.0; }  // pores: dark NDT spots
        tSum += s.g;
        wSum += 1.0;
        tt += 2.0;
      }
      let I = exp(-att * 5.2 / nf);
      let Tm = tSum / max(wSum, 1.0);
      col = vec3f(I) * vec3f(0.90, 0.94, 1.0);
      col += inferno(clamp((Tm + 0.2) / 1.3, 0.0, 1.0)) * (1.0 - I) * 0.28;
      col += hashf(u32(in.pos.x), u32(in.pos.y), u32(R.time * 15.0) % 256u) * 0.02;
    } else if (R.view == 7u) {
      // NEON: volumetric glow of the whole interface — see every arm at once
      var glow = vec3f(0.0);
      var tt = t;
      loop {
        if (tt >= tMax) { break; }
        let s = stateAt(ro + rd * tt);
        let ifc = exp(-pow(abs(s.r - 0.5) / 0.09, 2.0));
        glow += vec3f(0.25, 0.95, 1.0) * ifc * 0.045;
        glow += vec3f(1.0, 0.62, 0.18) * exp(-pow((abs(fract(s.g * 12.0) - 0.5) * 2.0) / 0.10, 2.0)) * 0.004 * (1.0 - s.r);
        tt += 1.5;
      }
      col = vec3f(0.012, 0.016, 0.026) + glow;
    } else if (t < tMax) {
      // draw the cut face first when the camera looks through the section
      if (cutFront > 0.0) {
        let pc = ro + rd * (cutFront + 0.05);
        let sc = stateAt(pc);
        col = sliceColor(pc);
        if (sc.r > 0.5) {
          // solid on the cut: opaque micrograph — done
          return vec4f(pow(max(col, vec3f(0.0)), vec3f(1.0 / 1.06)), 1.0);
        }
        // liquid on the cut: keep a faint tint, march on behind for the ghost
        acc = col * 0.45;
        trans = 0.6;
        t = cutFront + 0.5;
      }

      // coarse march until near the interface, then fine + bisect
      var prevT = t;
      var hitT = -1.0;
      loop {
        if (t >= tMax) { break; }
        let p = ro + rd * t;
        let s = stateAt(p);
        if (s.r < 0.5 && (R.view == 0u || R.view == 6u)) {
          if (R.view == 0u) {
            // MELT: emissive incandescent liquid (smooth-sampled T)
            acc += trans * heat(stateFine(p).g * R.meltGlow) * emit * 2.0;
          } else {
            // THERM: the thermal halo itself, in ironbow
            acc += trans * ironbow(clamp((stateFine(p).g + 0.25) / 1.35, 0.0, 1.0)) * emit * 0.8;
          }
          trans *= exp(-absorb * 2.0);
          if (trans < 0.012) { break; }
        }
        if (s.r > 0.06) {
          // fine march toward the phi = 0.5 crossing (the diffuse interface is
          // several voxels wide — give grazing rays a long enough window)
          var tf = max(prevT, t - 2.0);
          var pf = phiAt(ro + rd * tf);
          let fEnd = min(t + 14.0, tMax);
          if (pf >= 0.5) { hitT = tf; }
          loop {
            if (hitT > 0.0 || tf >= fEnd) { break; }
            let tn = tf + fine;
            let pn = phiAt(ro + rd * tn);
            if (pf < 0.5 && pn >= 0.5) {
              var a = tf;
              var b = tn;
              for (var i = 0; i < 3; i++) {
                let mid = 0.5 * (a + b);
                if (phiAt(ro + rd * mid) >= 0.5) { b = mid; } else { a = mid; }
              }
              hitT = 0.5 * (a + b);
              break;
            }
            pf = pn;
            tf = tn;
          }
          if (hitT > 0.0) { break; }
          t = max(t, tf - 2.0);   // resume coarse from where the fine scan ended
        }
        prevT = t;
        t += 2.0;
      }

      if (hitT > 0.0) {
        let p = ro + rd * hitT;
        var lensS = R.view;
        if (R.view == 2u) { lensS = 1u; }        // SLICE ghosts shade like ORIENT
        var surf = shadeSurface(p, rd, lensS);
        if (R.view == 4u) {
          // SEM finish: shot noise + scan lines over the detector signal
          surf += (hashf(u32(in.pos.x), u32(in.pos.y), u32(R.time * 30.0) % 512u) - 0.5) * 0.10;
          surf += sin(in.pos.y * 1.7) * 0.015;
        }
        if (cutFront > 0.0) { surf *= 0.55; }    // ghosted behind the cut
        col = acc + trans * surf;
      } else if (cutBack > 0.0 && stateAt(ro + rd * (cutBack - 0.05)).r > 0.5) {
        // ray left through the section plane while inside solid: show the cut
        col = acc + trans * sliceColor(ro + rd * (cutBack - 0.05));
      } else {
        col = vec3f(0.016, 0.018, 0.023) * trans + acc;
        if (R.view == 1u) {
          // ORIENT: liquid reads as a faint dark haze, not black
          col += vec3f(0.012, 0.014, 0.02);
        }
      }
    }
  }

  // vignette + film grain, matching the 2D instrument's finish
  let vuv = in.uv - 0.5;
  col *= 1.0 - dot(vuv, vuv) * 0.5;
  let fg = hashf(u32(in.pos.x), u32(in.pos.y), u32(R.time * 60.0) % 1024u) - 0.5;
  col += fg * 0.012;

  return vec4f(pow(max(col, vec3f(0.0)), vec3f(1.0 / 1.06)), 1.0);
}
`;
}
