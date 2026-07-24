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

import { HT_COMMON, PALETTE_WGSL } from "./shaders";

export const MAX_GRAINS3 = 4096;
export const MAX_SEEDS3 = 128;   // as in 2D: a big inoculant burst must land while liquid remains
export const SEED3_STRIDE = 8; // floats per seed: x, y, z, r, id, dTact, pad, pad
/** reserved grain id for shrinkage-pore voxels (φ pinned 0 forever) */
export const PORE_ID = MAX_GRAINS3 - 1;

export const LENS3_NAMES = ["MELT", "ORIENT", "SLICE", "FIELD", "SEM", "RINGS", "THERM", "NEON", "CURV"];

/**
 * Largest δ the icosahedral energy stays convex at. The theoretical edge is
 * ≈0.029; this is the soak-tested cap the shader enforces. Single source of
 * truth — the WGSL clamps to it, `setSym3` snaps to it, and the δ slider
 * narrows its range to it, so the dial can never read a value the solver is
 * not using.
 */
export const ICOSA_DELTA_MAX = 0.035;

// Params3D slot map — single source of truth shared with sim3d.writeParams
// (u = u32 view, f = f32 view over one 192-byte buffer)
export const P3 = {
  n: 0, frame: 1, dx: 2, dt: 3,
  epsBar: 4, delta: 5, aniMode3: 6, tau: 7,
  alpha: 8, gamma: 9, latent: 10, noiseAmp: 11,
  tFar: 12, coolRate: 13, heatIn: 14, seedCount: 15,
  time: 16, deltaZ: 17, quenchDT: 18, curGen: 19,
  sliceN: 20,     // vec4f: stereology section plane (n̂ + c), else zeros
  pPore: 24,
  scen: 25,       // u32: 0 free · 1 bridgman · 2 weld · 3 grain selector
  gradG: 26, frontZ: 27,
  weldX: 28, weldY: 29, weldPow: 30, weldSig: 31,
  alloyOn: 32,    // u32
  c0: 33, mLiq: 34, kPart: 35, dSol: 36, twinProb: 37,
  idFloor: 38,    // u32: CPU seed ids live below this — GPU twins spawn above
  facet: 39,
  probeX: 40, probeY: 41, probeZ: 42,   // u32, 0xffffffff = probe off
  holdT: 43, holdRate: 44, moldT: 45,   // scen 4: set-point (lab) cooling
  BYTES: 192,
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
  scen: u32,       // 0 free · 1 bridgman pull · 2 weld · 3 grain selector
  gradG: f32,      // bridgman thermal gradient (per voxel-unit along z)
  frontZ: f32,     // z (units) of the pulled reference isotherm
  weldX: f32,      // laser position on the top face (voxels)
  weldY: f32,
  weldPow: f32,
  weldSig: f32,    // laser spot sigma (voxels)
  alloyOn: u32,
  c0: f32,         // far-field composition
  mLiq: f32,       // liquidus slope: tEq = 1 - mLiq*c
  kPart: f32,      // partition coefficient (solute rejection factor 1-k)
  dSol: f32,       // liquid solute diffusivity (solid = dSol*0.02)
  twinProb: f32,   // per-claim growth-twin probability (0 disables)
  idFloor: u32,    // GPU twin ids stay above this (CPU nextId)
  facet: f32,      // >0.5: cusped {100} interface energy — flat facets
  probeX: u32,     // cooling-curve probe voxel (0xffffffff = off)
  probeY: u32,
  probeZ: u32,
  holdT: f32,      // scen 4: set-point the charge relaxes toward
  holdRate: f32,   // scen 4: Newtonian relax rate
  moldT: f32,      // scen 4: temperature the mould shell holds
  _s46: f32,
  _s47: f32,
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
    if (P.facet > 0.5) {
      // regularized {100} cusps — the 3D Eggleston analog of the 2D |sin(β/2)|
      // energy: Σ√(nᵢ²+ε) has cusped MINIMA along ⟨100⟩, so genuinely flat
      // cube facets pin there (same 0.001 regularization as 2D)
      let q = sqrt(np * np + vec3f(0.001));
      r.a = 1.0 + 2.0 * P.delta * (q.x + q.y + q.z - 1.4);
      r.g = 2.0 * P.delta * np / q;
    } else {
      // cubic harmonic: minima along <100> — six dendrite arms
      let n3 = np * np * np;
      r.a = 1.0 + P.delta * (4.0 * (n3.x * np.x + n3.y * np.y + n3.z * np.z) - 3.0);
      r.g = 16.0 * P.delta * n3;
    }
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
  } else if (P.aniMode3 == 3u) {
    // icosahedral — the honest 3D answer to the "forbidden" 5-fold: energy
    // built on the six 5-fold axes (0, ±1, φ)/√(1+φ²) + cyclic. K=7, c₀=6
    // zero-mean Σ(n̂·mᵢ)⁶ (sphere mean 6/7, max 1.04 on the 5-fold axes);
    // δ clamped to the convexity-safe range (soak-tested at the slider max)
    let dI = min(P.delta, ${ICOSA_DELTA_MAX});
    var fsum = 0.0;
    var gsum = vec3f(0.0);
    for (var i = 0; i < 6; i++) {
      var mm = vec3f(0.0, 0.52573111, 0.85065081);
      if (i == 1) { mm = vec3f(0.0, -0.52573111, 0.85065081); }
      if (i == 2) { mm = vec3f(0.52573111, 0.85065081, 0.0); }
      if (i == 3) { mm = vec3f(-0.52573111, 0.85065081, 0.0); }
      if (i == 4) { mm = vec3f(0.85065081, 0.0, 0.52573111); }
      if (i == 5) { mm = vec3f(0.85065081, 0.0, -0.52573111); }
      let dp = dot(np, mm);
      let dp2 = dp * dp;
      let dp4 = dp2 * dp2;
      fsum += dp4 * dp2;
      gsum += mm * (dp4 * dp);
    }
    r.a = 1.0 + dI * (7.0 * fsum - 6.0);
    r.g = 42.0 * dI * gsum;
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
// Two sources from one template: the alloy variant binds the solute pair
// (4 storage textures — needs device limit ≥ 4); the base variant keeps 3 so
// the ≥3 caps gate still serves weak devices. Never dummy-bind storage:
// layout:"auto" drops statically-unused bindings (the v1.9 black-canvas bug).
export const update3dWgsl = (alloy: boolean) => /* wgsl */ `
${COMMON3}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var flux: texture_3d<f32>;
@group(0) @binding(4) var stateOut: texture_storage_3d<rg32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_3d<r32uint, write>;
@group(0) @binding(6) var ageOut: texture_storage_3d<rg32float, write>;
@group(0) @binding(7) var fed: texture_3d<u32>;
${alloy ? /* wgsl */ `@group(0) @binding(8) var solute: texture_3d<f32>;
@group(0) @binding(9) var soluteOut: texture_storage_3d<r32float, write>;` : ""}
@group(0) @binding(10) var<storage, read_write> quats: array<vec4f>;
@group(0) @binding(11) var<storage, read_write> twinCtr: atomic<u32>;
@group(0) @binding(12) var mask: texture_3d<u32>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let c = vec3i(gid);
  let inv2dx = 1.0 / (2.0 * P.dx);
  let invdx2 = 1.0 / (P.dx * P.dx);
  let s = textureLoad(state, c, 0);
  let phi = s.r;
  let T = s.g;
  ${alloy ? "let conc = textureLoad(solute, c, 0).r;" : ""}

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

  // mould wall: dead geometry — φ pinned 0, held at the mould temperature,
  // never claimed (walls keep id 0, so the claim loop needs no extra guard);
  // taps stamped into a wall self-heal next step. Used by the grain-selector
  // pigtail (scen 3) and the lab's mould shell (scen 4).
  if ((P.scen == 3u || P.scen == 4u) && textureLoad(mask, c, 0).r == 1u) {
    let wallT = select(0.12, P.moldT, P.scen == 4u);
    textureStore(stateOut, c, vec4f(0.0, mix(T + P.dt * lapT, wallT, min(1.0, P.dt * 30.0)), 0.0, 0.0));
    textureStore(grainOut, c, vec4u(0u, 0u, 0u, 0u));
    ${alloy ? "textureStore(soluteOut, c, vec4f(conc, 0.0, 0.0, 0.0));" : ""}
    return;
  }

  // shrinkage pore: a permanent void — φ pinned to 0 (else solid neighbours
  // would regrow it), temperature keeps conducting, anneal never heals it
  let selfId = textureLoad(grain, c, 0).r;
  if (selfId == PORE) {
    textureStore(stateOut, c, vec4f(0.0, clamp(T + P.dt * lapT - P.dt * P.coolRate, -1.0, 2.0), 0.0, 0.0));
    textureStore(grainOut, c, vec4u(PORE, 0u, 0u, 0u));
    ${alloy ? "textureStore(soluteOut, c, vec4f(conc, 0.0, 0.0, 0.0));" : ""}
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

  ${alloy
    ? /* wgsl */ `// constitutional undercooling: solute depresses the local liquidus
  let tEq = 1.0 - P.mLiq * conc;
  let m = (P.alpha / PI) * atan(P.gamma * (tEq - T));`
    : "let m = (P.alpha / PI) * atan(P.gamma * (1.0 - T));"}
  let chi = hash3(gid.x, gid.y * 7919u + gid.z * 104729u, P.frame) - 0.5;
  let react = phi * (1.0 - phi) * (phi - 0.5 + m) + P.noiseAmp * phi * (1.0 - phi) * chi;
  let phiNew = clamp(phi + (P.dt / P.tau) * (aniso + react), 0.0, 1.0);
  let dPhi = phiNew - phi;
  ${alloy ? /* wgsl */ `
  // Warren–Boettinger dilute solute (2D port): variable-D 6-face diffusion +
  // partition rejection (1-k)·c·dφ at the moving interface; no anti-trapping
  let cE = textureLoad(solute, cid3(P, c + vec3i(1, 0, 0)), 0).r;
  let cW = textureLoad(solute, cid3(P, c - vec3i(1, 0, 0)), 0).r;
  let cN = textureLoad(solute, cid3(P, c + vec3i(0, 1, 0)), 0).r;
  let cS = textureLoad(solute, cid3(P, c - vec3i(0, 1, 0)), 0).r;
  let cU = textureLoad(solute, cid3(P, c + vec3i(0, 0, 1)), 0).r;
  let cD = textureLoad(solute, cid3(P, c - vec3i(0, 0, 1)), 0).r;
  let dSolid = P.dSol * 0.02;
  let dHere = mix(P.dSol, dSolid, phi);
  let divC = (0.5 * (dHere + mix(P.dSol, dSolid, sE.r)) * (cE - conc)
            + 0.5 * (dHere + mix(P.dSol, dSolid, sW.r)) * (cW - conc)
            + 0.5 * (dHere + mix(P.dSol, dSolid, sN.r)) * (cN - conc)
            + 0.5 * (dHere + mix(P.dSol, dSolid, sS.r)) * (cS - conc)
            + 0.5 * (dHere + mix(P.dSol, dSolid, sU.r)) * (cU - conc)
            + 0.5 * (dHere + mix(P.dSol, dSolid, sD.r)) * (cD - conc)) * invdx2;
  let cNew = clamp(conc + P.dt * divC + (1.0 - P.kPart) * conc * dPhi, 0.0, 2.0);
  textureStore(soluteOut, c, vec4f(cNew, 0.0, 0.0, 0.0));` : ""}

  var TNew = T + P.dt * lapT + P.latent * dPhi - P.dt * P.coolRate + P.dt * P.heatIn;
  if (P.scen == 1u || P.scen == 3u) {
    // bridgman / selector: relax T toward the pulled linear profile (2D port,
    // minus its no-op /dx*dx algebra); cold below the isotherm, columns race up
    let zu = f32(gid.z) * P.dx;
    let tProf = clamp(0.7 + P.gradG * (zu - P.frontZ), -0.6, 1.5);
    TNew = mix(TNew, tProf, min(1.0, P.dt * 150.0));
  } else if (P.scen == 4u) {
    // lab: Newtonian shell cooling toward the program's set-point
    TNew = mix(TNew, P.holdT, min(1.0, P.dt * P.holdRate));
  } else if (P.scen == 2u) {
    // weld: laser on the TOP face — xy gaussian, Beer-Lambert decay in depth
    let dxy = distance(vec2f(gid.xy), vec2f(P.weldX, P.weldY));
    let depth = f32(P.n - 1u) - f32(gid.z);
    TNew += P.dt * P.weldPow
      * exp(-(dxy * dxy) / (2.0 * P.weldSig * P.weldSig))
      * exp(-depth / (2.0 * P.weldSig));
  }
  TNew = clamp(TNew, -1.0, 2.0);

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
    // stochastic growth twin at the moving front (2D claim-spawn port): the
    // freshly-claimed cell may re-nucleate in Σ3 registry — 60° about one of
    // the PARENT's ⟨111⟩ axes. Ids count DOWN from MAX_GRAINS3−2 (atomicSub
    // returns the pre-decrement value; the top id is the pore census) and stop
    // above idFloor; the double guard also catches u32 wraparound.
    if (id != 0u && best > 0.0002 && P.twinProb > 0.0 &&
        hash3(gid.x + 7919u, gid.y + 104729u, P.frame) < P.twinProb) {
      let tid = atomicSub(&twinCtr, 1u);
      if (tid > P.idFloor && tid < PORE) {
        let qp = quats[min(id, ${MAX_GRAINS3 - 1}u)];
        let hb = u32(hash3(gid.z + 337u, gid.x + 31u, P.frame) * 3.999);
        var ax = vec3f(0.57735027, 0.57735027, 0.57735027);
        if (hb == 1u) { ax = vec3f(-0.57735027, 0.57735027, 0.57735027); }
        if (hb == 2u) { ax = vec3f(0.57735027, -0.57735027, 0.57735027); }
        if (hb == 3u) { ax = vec3f(0.57735027, 0.57735027, -0.57735027); }
        let axl = qrot(qp, ax);
        let q60 = vec4f(axl * 0.5, 0.86602540);   // axis·sin30°, cos30°
        let qt = vec4f(
          q60.w * qp.xyz + qp.w * q60.xyz + cross(q60.xyz, qp.xyz),
          q60.w * qp.w - dot(q60.xyz, qp.xyz));
        quats[tid] = normalize(qt);
        id = tid;
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
    // activation undercooling against the liquidus. STAMP3D binds no solute
    // texture, so an alloy uses the nominal liquidus (1 - m*c0) rather than
    // the 2D pass's per-cell one — documented on the science page.
    let dT = 1.0 - P.mLiq * P.c0 * f32(P.alloyOn) - Tq;
    for (var i = 0u; i < P.seedCount; i++) {
      let b = i * ${SEED3_STRIDE}u;
      let pos = vec3f(seeds[b], seeds[b + 1u], seeds[b + 2u]);
      let r = seeds[b + 3u];
      if (dT <= seeds[b + 5u]) { continue; }
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
  interf: atomic<u32>,    // cells with 0.2 < phi < 0.8
  interfT: atomic<u32>,   // their summed (T+1)*1000 — mean interface temperature
  liqCount: atomic<u32>,  // liquid voxels sampled (stride 2 per axis)
  probeT: atomic<u32>,    // (T+1)*1000 at the probe voxel (single writer)
  probePhi: atomic<u32>,  // phi*1000 at the probe voxel
  liqTsum: atomic<u32>,   // sum of (T+1)*500 over the sampled liquid voxels
  pad7: u32,
  counts: array<atomic<u32>, ${MAX_GRAINS3}>,
}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var<storage, read_write> stats: Stats3;
@group(0) @binding(4) var mask: texture_3d<u32>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let s = textureLoad(state, vec3i(gid), 0);
  let id = textureLoad(grain, vec3i(gid), 0).r;
  if (gid.x == P.probeX && gid.y == P.probeY && gid.z == P.probeZ) {
    atomicStore(&stats.probeT, u32(clamp((s.g + 1.0) * 1000.0, 0.0, 4000.0)));
    atomicStore(&stats.probePhi, u32(clamp(s.r * 1000.0, 0.0, 1000.0)));
  }
  if (id == PORE) {
    atomicAdd(&stats.counts[PORE], 1u);   // porosity census rides the id table
    return;
  }
  if (s.r > 0.2 && s.r < 0.8) {
    atomicAdd(&stats.interf, 1u);
    atomicAdd(&stats.interfT, u32(clamp((s.g + 1.0) * 1000.0, 0.0, 4000.0)));
  }
  if (s.r > 0.5) {
    atomicAdd(&stats.solid, 1u);
    if (id > 0u && id < ${MAX_GRAINS3}u) {
      atomicAdd(&stats.counts[id], 1u);
    }
  }
  // mean melt temperature for the nucleation model — pores excluded by the
  // early return above; stride 2 per axis and x500 keeps the sum inside u32.
  let wall = (P.scen == 3u || P.scen == 4u) && textureLoad(mask, vec3i(gid), 0).r == 1u;
  if (s.r < 0.5 && !wall && ((gid.x | gid.y | gid.z) & 1u) == 0u) {
    atomicAdd(&stats.liqCount, 1u);
    atomicAdd(&stats.liqTsum, u32(clamp((s.g + 1.0) * 500.0, 0.0, 2000.0)));
  }
}
`;

// ------------------------------------------------------------ line sampler
// 400 φ samples along a 3D segment — the SDAS ruler's readback (the 2D
// row-copy readLine doesn't generalize to a volume line). Own tiny uniform:
// the shared Params3D has no free vec3 pair, and sharing buffers with step()
// is how the stereology race happened.
export const LINE3D_WGSL = /* wgsl */ `
struct LineU { a: vec4f, b: vec4f }   // endpoints in voxels; a.w = grid n
@group(0) @binding(0) var<uniform> L: LineU;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32, 400>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= 400u) { return; }
  let t = f32(i) / 399.0;
  let p = mix(L.a.xyz, L.b.xyz, vec3f(t));
  let n = i32(L.a.w);
  let c = clamp(vec3i(p), vec3i(0), vec3i(n - 1));
  out[i] = textureLoad(state, c, 0).r;
}
`;

// ------------------------------------------------------------ stereology pass
// counts per-grain voxels within half a voxel of the section plane — i.e. the
// grain's SECTION AREA — so the panel can compare 2D metallography against the
// true 3D grain sizes (the classic stereology lesson)
export const STEREO3D_WGSL = /* wgsl */ `
${COMMON3}
struct SBuf {
  pad: array<u32, 8>,
  counts: array<atomic<u32>, ${MAX_GRAINS3}>,
}
@group(0) @binding(0) var<uniform> P: Params3D;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var<storage, read_write> stats: SBuf;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.n || gid.y >= P.n || gid.z >= P.n) { return; }
  let pc = vec3f(gid) + 0.5;
  if (abs(dot(pc, P.sliceN.xyz) - P.sliceN.w) > 0.5) { return; }
  let c = vec3i(gid);
  let id = textureLoad(grain, c, 0).r;
  if (id == PORE) {
    atomicAdd(&stats.counts[PORE], 1u);
    return;
  }
  if (id > 0u && textureLoad(state, c, 0).r > 0.5) {
    atomicAdd(&stats.counts[id], 1u);
  }
}
`;

// ------------------------------------------------------- heat treatment (H2b)
// The volume's Monte Carlo Potts pass — the 2D pair in shaders.ts ported to
// 26 neighbours and 8 sublattice colours. The HT uniform struct, the 256 B
// stride and the MC-temperature doctrine (kT is numerical, the furnace enters
// only through the sweep count) are all shared with 2D via HT_COMMON/H2U.

/**
 * Sublattice colours, 3D: stride-2 in x, y AND z gives eight classes. Two cells
 * of one class differ by ≥2 on some axis, so their Chebyshev distance is ≥2 and
 * they are never 26-neighbours — simultaneous update within a class is identical
 * to sequential update in random order, which is what keeps detailed balance.
 *
 * **26 neighbours, deliberately not the claim pass's 6-face stencil.** 6-neighbour
 * Potts pins hard on the cubic lattice — flat {100} boundary segments have no
 * downhill or flat move at all — and the stall is indistinguishable by eye from
 * a finished anneal. 26 is the standard 3D Potts choice for exactly this reason.
 *
 * **Even, and it must stay even** — the same `dir`-parity argument as 2D: the
 * anneal flips only the grain ping-pong, `dir` also indexes the state pair, and
 * an odd dispatch count would pair a current state field with a stale grain
 * field. `Sim3D.anneal` asserts it.
 */
export const HT_COLOURS_3D = 8;

/**
 * Eligibility mask — built once per treatment, read every sweep (φ does not move
 * during a heat treatment; that is the definition of one). A voxel is treatable
 * when it is solid, carries a real grain id, is not a shrinkage pore (PORE is a
 * census id, not a grain — `shaders3d.ts:288` promised "anneal never heals it"
 * and this keeps the promise), and is not mould wall.
 *
 * r32uint for the same reason as 2D: r8uint cannot be a storage texture in
 * WebGPU at all (the mould mask gets away with r8uint by being CPU-written and
 * only sampled). Costs 4 B/voxel — 28 MB at 192³ — which is why the resources
 * are lazily allocated on the first treatment rather than riding the create
 * ladder of every 3D session that never heat-treats anything.
 */
export const HTMASK3_WGSL = /* wgsl */ `
${HT_COMMON}
@group(0) @binding(0) var<uniform> H: HT;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var mould: texture_3d<u32>;
@group(0) @binding(4) var maskOut: texture_storage_3d<r32uint, write>;
const PORE = ${PORE_ID}u;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= H.n || gid.y >= H.n || gid.z >= H.n) { return; }
  let c = vec3i(gid);
  let phi = textureLoad(state, c, 0).r;
  let id = textureLoad(grain, c, 0).r;
  let wall = textureLoad(mould, c, 0).r;
  let ok = phi >= 0.5 && id != 0u && id != PORE && wall == 0u;
  textureStore(maskOut, c, vec4u(select(0u, 1u, ok), 0u, 0u, 0u));
}
`;

/**
 * A coherent Σ3 boundary's energy as a fraction of a general high-angle
 * boundary's: the measured copper ratio, ≈ 24 mJ/m² coherent twin against
 * ≈ 625 mJ/m² random boundary (Murr 1975) ≈ 0.04.
 *
 * The value is load-bearing and the first draft got it wrong by trying to be
 * conservative: at 0.15 a cell adopting a nascent single-cell twin paid
 * ~12 neighbours × 0.15 of Σ3 energy against adopting the parent at ~0.15
 * total — an artificial nucleation barrier, and the twin was swallowed
 * laterally before it could become a lamella (measured: 15 of 493 spawns
 * surviving 300 sweeps). At the physical 0.04 the two adoptions are within
 * ~half a kT of each other, so a twin extends alongside its parent behind the
 * migrating front, which is the actual growth-accident picture.
 *
 * **The cusp is why annealing twins survive the anneal at all**: under a
 * uniform boundary energy the Hamiltonian has no reason to keep a Σ3 and eats
 * twins at the same rate as everything else. A single cusp, deliberately NOT
 * full Read–Shockley — that would change the energy of every boundary and
 * re-open the K_MC calibration for a milestone's worth of gain nothing needs.
 */
export const SIGMA3_COST = 0.04;

/**
 * Relative mobility of a Σ3 boundary against a general one. Coherent twin
 * interfaces are LOW-MOBILITY as well as low-energy — they cannot migrate by
 * the single-atom shuffles a general boundary uses, which is precisely why
 * twins survive recrystallization and grain growth in real FCC metals.
 *
 * The cusp alone is not enough, and that was measured, not argued: with
 * energy-only Σ3 physics, 3 of 512 spawned twins survived 300 sweeps and none
 * survived 450 — a nascent single-cell twin's revert to its parent is a
 * Σ3-boundary move that is always downhill by TWIN_COST per shared face, so it
 * is accepted whenever proposed. Suppressing Σ3-boundary MOVES (this factor)
 * leaves the revert almost never accepted while lateral growth into the
 * shrinking grain — a general boundary at full mobility — extends the twin
 * behind the migrating front. The value is a modelling choice, stated as such.
 */
export const SIGMA3_MOBILITY = 0.02;

/**
 * One sublattice's worth of Potts boundary migration in the volume.
 *
 * Every invocation writes — the pass ping-pongs the grain texture, and a cell
 * left unwritten would come back as whatever the other buffer held before the
 * sweep. Ineligible neighbours (liquid, pore, mould) are EXCLUDED from both
 * energies rather than counted as unlike, or the pass would eat the casting
 * inward from its own free surface. The candidate id is drawn only from an
 * eligible neighbour, never from the id space at large — a random id would
 * invent an orientation and the quaternion table would happily give it one.
 *
 * H3 adds the Σ3 physics, gated so the H2b calibration stands:
 *
 * **The Σ3 cusp.** A neighbour pair whose misorientation is a 60° rotation
 * about a ⟨111⟩ axis contributes `SIGMA3_COST` instead of 1. The detector is
 * exact-construction: every Σ3 in this app is built as q_t = q60 ∘ q_p, so the
 * relative quaternion has |w| = cos 30° and its axis, rotated into either
 * grain's frame, is ⟨111⟩ (a rotation fixes its own axis, so both frames give
 * the same answer). Random-texture pairs hit this within tolerance with
 * measure ≈ 0, which is why `GG3-KMC` re-measured within drift after the cusp
 * landed. Second-generation pairs (twin-of-twin, Σ9) rightly pay full price.
 *
 * **The Σ3 mobility gate.** A flip whose mine↔candidate pair is Σ3-related is
 * a coherent-interface migration and is suppressed to `SIGMA3_MOBILITY`.
 *
 * Twin NUCLEATION does not live in this pass. Two in-pass mechanisms were
 * built and measured dead first — see the H3 postmortem: a per-flip
 * single-cell spawn cannot cross the Potts nucleation geometry whatever the
 * cusp does, because a plate is sub-grid physics at spawn time. Nucleation is
 * `Sim3D.twinEvent()` — a plate stamped in exact Σ3 registry on a probed
 * migrating boundary — and everything AFTER birth is this pass's physics.
 */
export const ANNEAL3_WGSL = /* wgsl */ `
${HT_COMMON}
@group(0) @binding(0) var<uniform> H: HT;
@group(0) @binding(1) var grain: texture_3d<u32>;
@group(0) @binding(2) var mask: texture_3d<u32>;
@group(0) @binding(3) var grainOut: texture_storage_3d<r32uint, write>;
@group(0) @binding(4) var<storage, read> quats: array<vec4f>;
const PORE = ${PORE_ID}u;
const TWIN_COST = ${SIGMA3_COST};
const TWIN_MOB = ${SIGMA3_MOBILITY};

fn qmulHT(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}

// Σ3 test: relative rotation is 60° (|w| = cos 30°) about a ⟨111⟩ axis.
// The axis is checked in b's grain frame; for a true Σ3 pair either frame
// works because the twin rotation fixes its own axis.
fn sigma3(qa: vec4f, qb: vec4f) -> bool {
  let qr = qmulHT(qa, vec4f(-qb.xyz, qb.w));
  if (abs(abs(qr.w) - 0.8660254) > 0.02) { return false; }
  let len = length(qr.xyz);
  if (len < 1e-5) { return false; }
  let al = qr.xyz / len;
  let t = 2.0 * cross(-qb.xyz, al);
  let ag = abs(al + qb.w * t + cross(-qb.xyz, t));
  return min(ag.x, min(ag.y, ag.z)) > 0.5;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= H.n || gid.y >= H.n || gid.z >= H.n) { return; }
  let c = vec3i(gid);
  let mineId = textureLoad(grain, c, 0).r;

  // every cell writes, every dispatch — see the note above
  var out = mineId;

  // only this dispatch's sublattice may move, and only treatable cells
  let mine = (gid.x & 1u) | ((gid.y & 1u) << 1u) | ((gid.z & 1u) << 2u);
  if (mine == H.colour && textureLoad(mask, c, 0).r == 1u) {
    // gather the eligible 26-neighbourhood once
    var nid: array<u32, 26>;
    var nOk: array<bool, 26>;
    var k = 0;
    for (var dz = -1; dz <= 1; dz++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx == 0 && dy == 0 && dz == 0) { continue; }
          let nc = clamp(c + vec3i(dx, dy, dz), vec3i(0), vec3i(i32(H.n) - 1));
          nid[k] = textureLoad(grain, nc, 0).r;
          nOk[k] = textureLoad(mask, nc, 0).r == 1u;
          k++;
        }
      }
    }
    // one Metropolis move: propose adopting a random eligible neighbour's id
    let pick = i32(htHash(gid.x + 17u, gid.y + 91u, gid.z * 131u + H.salt) * 25.999);
    if (nOk[pick] && nid[pick] != mineId) {
      let cand = nid[pick];
      let qm = quats[min(mineId, PORE)];
      let qc = quats[min(cand, PORE)];
      var eNow = 0.0;
      var eNew = 0.0;
      for (var j = 0; j < 26; j++) {
        if (!nOk[j]) { continue; }          // excluded, not counted as unlike
        if (nid[j] != mineId || nid[j] != cand) {
          let qn = quats[min(nid[j], PORE)];
          if (nid[j] != mineId) { eNow += select(1.0, TWIN_COST, sigma3(qm, qn)); }
          if (nid[j] != cand)   { eNew += select(1.0, TWIN_COST, sigma3(qc, qn)); }
        }
      }
      let dE = eNew - eNow;
      // downhill and flat moves are taken; uphill costs the Boltzmann factor.
      // Flat moves matter doubly here — 3D lattice pinning is harsher than 2D.
      var accept = dE <= 0.0;
      if (!accept && H.kT > 0.0) {
        accept = htHash(gid.x + 613u, gid.y + 7u, gid.z * 977u + (H.salt ^ 0x9e3779b9u)) < exp(-dE / H.kT);
      }
      // a mine↔cand flip that crosses a Σ3 boundary is a coherent-interface
      // migration — near-immobile in real FCC metals, and the reason twins
      // survive at all (see SIGMA3_MOBILITY: the cusp alone was measured
      // insufficient — nascent twins died within sweeps)
      if (accept && sigma3(qm, qc)) {
        accept = htHash(gid.z + 811u, gid.x + 409u, H.salt ^ 0x7f4a7c15u) < TWIN_MOB;
      }
      if (accept) { out = cand; }
    }
  }
  textureStore(grainOut, c, vec4u(out, 0u, 0u, 0u));
}
`;

/**
 * Annealing-twin nucleation: stamp a thin plate of a fresh Σ3 id into its
 * parent grain.
 *
 * Real annealing twins are born as atomic-scale stacking events across a
 * {111} facet of a migrating boundary — they arrive as PLATES, and that
 * geometry is sub-grid for a per-cell Potts flip. Two in-pass single-cell
 * spawn mechanisms were built and measured dead (3/512 then 29/520 survivors;
 * the adopting neighbour pays an artificial nucleation barrier however the
 * cusp is tuned), so the plate is inserted whole — the shape mesoscale models
 * in the literature use — and the anneal pass owns everything after birth.
 *
 * The plate normal IS the twin axis: a Σ3 is a 60° rotation about ⟨111⟩ and
 * its coherent plane is the {111} normal to that same axis, so `nrm` arrives
 * as the parent's rotation axis in lab frame. Only voxels still belonging to
 * `pid` are claimed, so a plate can never cross into a third grain.
 *
 * `grainRW` is a READ-WRITE storage texture — r32uint is one of the three
 * formats core WebGPU allows that for — so the stamp works in place: no
 * ping-pong flip, no `dir` parity to break between sweeps.
 */
export const TWINSTAMP3_WGSL = /* wgsl */ `
struct TS {
  seed: vec4f,   // xyz: plate centre (voxels) · w: grid n
  nrm: vec4f,    // xyz: unit plate normal (lab ⟨111⟩ of the parent) · w: unused
  tid: u32,      // the freshly allocated twin id
  pid: u32,      // the parent id — the only id the plate may overwrite
  r: f32,        // plate radius, voxels
  halfT: f32,    // half-thickness, voxels
}
@group(0) @binding(0) var<uniform> T: TS;
@group(0) @binding(1) var grainRW: texture_storage_3d<r32uint, read_write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = u32(T.seed.w);
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let d = vec3f(gid) + 0.5 - T.seed.xyz;
  if (abs(dot(d, T.nrm.xyz)) > T.halfT || dot(d, d) > T.r * T.r) { return; }
  let c = vec3i(gid);
  if (textureLoad(grainRW, c).r == T.pid) {
    textureStore(grainRW, c, vec4u(T.tid, 0u, 0u, 0u));
  }
}
`;

/**
 * Homogenization, 3D (H4): numerical diffusivity per iteration, cells²/iter.
 * The explicit 7-point stability bound is 1/6; 0.14 keeps a margin. Numerical,
 * not physical — D_s enters only through the iteration budget.
 */
export const HOMOG_D3 = 0.14;

/**
 * Solute diffusion at frozen φ in the volume — the 2D pass's contract on the
 * lazily allocated solute pair: c diffuses through the solid skeleton only,
 * every non-solid face (liquid, pore via its pinned φ = 0, mould, the domain
 * edge via clamp) is zero-flux, and nothing else is read or written. The
 * solute pair ping-pongs on its own; an even iteration count lands the data
 * back in the slot `dir` expects, so the solver's own bookkeeping never sees
 * the treatment happened.
 */
export const HOMOG3_WGSL = /* wgsl */ `
struct HG { n: u32, d: f32, p2: u32, p3: u32 }
@group(0) @binding(0) var<uniform> G: HG;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var mould: texture_3d<u32>;
@group(0) @binding(3) var cIn: texture_3d<f32>;
@group(0) @binding(4) var cOut: texture_storage_3d<r32float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= G.n || gid.y >= G.n || gid.z >= G.n) { return; }
  let c = vec3i(gid);
  var cv = textureLoad(cIn, c, 0).r;
  if (textureLoad(state, c, 0).r >= 0.5 && textureLoad(mould, c, 0).r == 0u) {
    var lap = 0.0;
    for (var k = 0; k < 6; k++) {
      var dv = vec3i(1, 0, 0);
      if (k == 1) { dv = vec3i(-1, 0, 0); }
      if (k == 2) { dv = vec3i(0, 1, 0); }
      if (k == 3) { dv = vec3i(0, -1, 0); }
      if (k == 4) { dv = vec3i(0, 0, 1); }
      if (k == 5) { dv = vec3i(0, 0, -1); }
      let nc = clamp(c + dv, vec3i(0), vec3i(i32(G.n) - 1));
      if (textureLoad(state, nc, 0).r >= 0.5 && textureLoad(mould, nc, 0).r == 0u) {
        lap += textureLoad(cIn, nc, 0).r - cv;
      }
    }
    cv += G.d * lap;
  }
  textureStore(cOut, c, vec4f(cv, 0.0, 0.0, 0.0));
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
  var q = p;
  if ((R.flags & 1u) != 0u) { q = floor(p) + 0.5; }   // voxel mode: nearest
  return textureSampleLevel(state, samp, q / f32(R.n), 0.0).r;
}
fn stateFine(p: vec3f) -> vec2f {
  var q = p;
  if ((R.flags & 1u) != 0u) { q = floor(p) + 0.5; }
  return textureSampleLevel(state, samp, q / f32(R.n), 0.0).rg;
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
@group(0) @binding(6) var solute: texture_3d<f32>;
@group(0) @binding(7) var mask: texture_3d<u32>;
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
// solute (alloy mode; a 1×1×1 dummy binds otherwise — reads gated on flags bit 2)
fn soluteAt(p: vec3f) -> f32 {
  return textureLoad(solute, clampC(vec3i(p)), 0).r;
}
// selector mold walls (always n³ — reads gated on flags bit 3)
fn maskAt(p: vec3f) -> u32 {
  return textureLoad(mask, clampC(vec3i(p)), 0).r;
}

// central-difference surface normal at the phi=0.5 crossing
fn surfNormal(p: vec3f) -> vec3f {
  let e = 1.2;
  let gx = phiAt(p + vec3f(e, 0.0, 0.0)) - phiAt(p - vec3f(e, 0.0, 0.0));
  let gy = phiAt(p + vec3f(0.0, e, 0.0)) - phiAt(p - vec3f(0.0, e, 0.0));
  let gz = phiAt(p + vec3f(0.0, 0.0, e)) - phiAt(p - vec3f(0.0, 0.0, e));
  let g = vec3f(gx, gy, gz);
  let l = length(g);
  // where the crystal is truncated by a domain face, phi is uniform solid and
  // the central difference is numerical noise — per-pixel random normals read
  // as a rough, speckled face. Fall back to the geometric face normal there,
  // trusting the phi gradient only where a real interface carries one.
  let nf = f32(R.n);
  var fb = vec3f(0.0);
  if (p.x < 1.5) { fb.x = -1.0; } else if (p.x > nf - 1.5) { fb.x = 1.0; }
  if (p.y < 1.5) { fb.y = -1.0; } else if (p.y > nf - 1.5) { fb.y = 1.0; }
  if (p.z < 1.5) { fb.z = -1.0; } else if (p.z > nf - 1.5) { fb.z = 1.0; }
  if (dot(fb, fb) > 0.5) {
    let w = clamp(l / 0.12, 0.0, 1.0);
    return normalize(mix(normalize(fb), -g / max(l, 1e-6), w));
  }
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
  if ((R.flags & 4u) != 0u && style != 5u) {
    // microsegregation etches dark between the arms, like the 2D ETCH lens
    col *= 1.0 - clamp(soluteAt(p) - R.misc.z, 0.0, 1.0) * 0.35;
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
          if (denom < 0.0 && tp < tMax) {
            t = max(t, tp);
            // a cut face exists only where the crossing lies INSIDE the box;
            // rays that cross the infinite plane outside and enter the kept
            // half through a box face must march normally — sampling at that
            // outside crossing clamps to border voxels and smears the
            // micrograph across the face (Frank's warp report)
            if (tp >= hit.x) { cutFront = tp; }
          }
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
        if ((R.flags & 4u) != 0u) {
          // alloy: segregated solute absorbs — interdendritic liquid darkest,
          // the 2D XRAY weights carried into the transmission integral
          let cc = soluteAt(ro + rd * tt);
          att += (0.55 * cc * (1.0 - s.r) + 0.3 * cc * s.r) * 1.1;
        }
        if (grainAt(ro + rd * tt) == ${PORE_ID}u) { att += 7.0; }  // pores: dark NDT spots
        if ((R.flags & 8u) != 0u && maskAt(ro + rd * tt) == 1u) { att += 0.5; }  // mold walls x-ray faint
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
      // a ray that ENTERS the box already inside solid (crystal truncated by
      // a domain face): the visible surface IS the entry plane — hit it
      // exactly. Marching from the jittered start would land 0-2 voxels deep
      // at a per-pixel depth and speckle the flat face.
      if (cutFront < 0.0 && phiAt(ro + rd * (hit.x + 0.01)) >= 0.5) {
        hitT = hit.x + 0.01;
      }
      if (hitT < 0.0) {
      loop {
        if (t >= tMax) { break; }
        let p = ro + rd * t;
        let s = stateAt(p);
        if ((R.flags & 8u) != 0u && maskAt(p) == 1u) {
          // selector walls: a faint glass ghost so the pigtail geometry reads
          acc += trans * vec3f(0.055, 0.075, 0.095) * 0.06;
          trans *= 0.93;
          if (trans < 0.012) { break; }
        }
        if (s.r < 0.5 && (R.view == 0u || R.view == 6u)) {
          if (R.view == 0u) {
            // MELT: emissive incandescent liquid (smooth-sampled T)
            acc += trans * heat(stateFine(p).g * R.meltGlow) * emit * 2.0;
            if ((R.flags & 4u) != 0u) {
              // rejected solute reads as a cool blue haze against the heat
              acc += trans * vec3f(0.10, 0.16, 0.22) * clamp(soluteAt(p) - R.misc.z, 0.0, 1.0) * emit * 4.0;
            }
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

  // 8-bit palette + ordered dither (retro look, flags bit 1)
  if ((R.flags & 2u) != 0u) {
    let dith = (f32((u32(in.pos.x) + u32(in.pos.y) * 2u) % 4u) - 1.5) / 48.0;
    col = floor((col + vec3f(dith)) * 7.0 + vec3f(0.5)) / 7.0;
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
