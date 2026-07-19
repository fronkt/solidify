var M=Object.defineProperty;var C=(g,i,t)=>i in g?M(g,i,{enumerable:!0,configurable:!0,writable:!0,value:t}):g[i]=t;var n=(g,i,t)=>C(g,typeof i!="symbol"?i+"":i,t);(function(){const i=document.createElement("link").relList;if(i&&i.supports&&i.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))s(e);new MutationObserver(e=>{for(const a of e)if(a.type==="childList")for(const r of a.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&s(r)}).observe(document,{childList:!0,subtree:!0});function t(e){const a={};return e.integrity&&(a.integrity=e.integrity),e.referrerPolicy&&(a.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?a.credentials="include":e.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function s(e){if(e.ep)return;e.ep=!0;const a=t(e);fetch(e.href,a)}})();const f=4096,T=64,b=6,y=`
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
  pad3: f32,
  pad4: f32,
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
`,R=`
${y}
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
  let th0 = theta0[min(id, ${f-1}u)];
  let beta = P.aniMode * (atan2(py, px) - th0);
  let eps = P.epsBar * (1.0 + P.delta * cos(beta));
  let deps = -P.epsBar * P.delta * P.aniMode * sin(beta);
  textureStore(flux, c, vec4f(eps * deps * px, eps * deps * py, eps * eps, 0.0));
}
`,G=`
${y}
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
      if (tid > P.idFloor && tid < ${f}u) {
        theta0[tid] = theta0[min(id, ${f-1}u)] + PI / max(P.aniMode, 1.0);
        id = tid;
      }
    }
  }

  textureStore(stateOut, c, vec4f(phiNew, TNew, cNew, age));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`,L=`
${y}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> seeds: array<f32, ${T*b}>;
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
    for (var i = 0u; i < P.seedCount; i++) {
      let b = i * ${b}u;
      let pos = vec2f(seeds[b], seeds[b + 1u]);
      let r = seeds[b + 2u];
      let tact = seeds[b + 4u];
      if (Tq >= tact) { continue; }
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
`,z=`
${y}
struct Stats {
  solid: atomic<u32>,
  interf: atomic<u32>,
  interfT: atomic<u32>,   // fixed point x1000
  pad: u32,
  probeT: u32,            // (T+1) x1000 at the probe cell (single writer)
  probePhi: u32,          // phi x1000 at the probe cell
  pad2: u32,
  pad3: u32,
  counts: array<atomic<u32>, ${f}>,
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
    if (id > 0u && id < ${f}u) {
      atomicAdd(&stats.counts[id], 1u);
    }
  }
  if (s.r > 0.2 && s.r < 0.8) {
    atomicAdd(&stats.interf, 1u);
    atomicAdd(&stats.interfT, u32(clamp(s.g, 0.0, 2.0) * 1000.0));
  }
}
`,E=["MELT","ORIENT","ETCH","FIELD","RINGS","THERM","SEM","NEON","XRAY","CURV"],B=`
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
  pad1: f32,
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
  let th0 = theta0[min(id, ${f-1}u)];

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
        let dth = theta0[min(nid, ${f-1}u)] - th0;
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
    case 1u: { // ORIENT
      let hfrac = th0 / (2.0 * PI / max(R.aniMode, 1.0));
      let idv = 0.6 + 0.75 * hashf(id, 5u, 31u);
      let base = polar(hfrac, idh) * idv * (0.42 + 0.72 * diff) + vec3f(spec) * 0.2;
      let liq = vec3f(0.012, 0.014, 0.02) + heat(T) * 0.1;
      col = mix(liq, base, solidness);
      col *= 1.0 - gb * select(0.7, 0.28, gbTwin > 0.5);
    }
    case 2u: { // ETCH
      var lum = 0.58 + 0.24 * idh + diff * 0.05 - spec * 0.03;
      // alloy: interdendritic segregation etches darker
      if (R.alloyOn == 1u) { lum -= clamp(conc - R.c0, 0.0, 1.0) * 0.35; }
      let solidCol = vec3f(lum) * vec3f(0.99, 0.965, 0.915);
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
      let glow = heat(T);
      let isMold = age < -0.5;
      let tint = polar(th0 / (2.0 * PI / max(R.aniMode, 1.0)), idh);
      var base = vec3f(0.30, 0.31, 0.345);
      if (isMold) { base = vec3f(0.085, 0.09, 0.105); }
      var solidCol = base * (0.5 + 0.85 * diff) + vec3f(spec) * select(0.45, 0.15, isMold);
      if (!isMold) {
        solidCol *= 0.82 + 0.36 * tint;                                  // grain-to-grain sheen
        solidCol += vec3f(0.55, 0.22, 0.05) * clamp(T - 0.15, 0.0, 1.0); // residual-heat ember
      }
      col = mix(glow + vec3f(0.015), solidCol, solidness);
      col -= gb * vec3f(0.05);
    }
  }

  if (!inDomain) { col *= 0.12; }

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
`,U={dx:.03,dt:12e-5,epsBar:.01,delta:.04,aniMode:4,tau:3e-4,alpha:.9,gamma:10,latent:1.6,noiseAmp:.01,tFar:0,coolRate:0,heatIn:0,scen:0,gradG:.08,pullV:1.5,weldX:0,weldY:0,weldPow:700,weldSig:4,alloyOn:0,c0:.3,mLiq:.45,kPart:.2,dSol:.8,twinProb:0,meltGlow:1},A=1;class _{constructor(i,t){n(this,"device");n(this,"n");n(this,"params");n(this,"frame",0);n(this,"simTime",0);n(this,"dir",0);n(this,"nextId",1);n(this,"frontX",0);n(this,"probe",null);n(this,"stateTex",[]);n(this,"grainTex",[]);n(this,"fluxTex");n(this,"paramBuf");n(this,"theta0Buf");n(this,"twinCtrBuf");n(this,"seedBuf");n(this,"statsBuf");n(this,"statsStaging");n(this,"theta0CPU",new Float32Array(f));n(this,"fluxPipe");n(this,"updatePipe");n(this,"stampPipe");n(this,"statsPipe");n(this,"fluxBG",[]);n(this,"updateBG",[]);n(this,"stampBG",[]);n(this,"statsBG",[]);n(this,"pendingSeeds",[]);n(this,"pendingQuench",0);n(this,"statsInFlight",!1);n(this,"paramData",new ArrayBuffer(144));n(this,"inFlight",0);this.device=i,this.n=t,this.params={...U},this.build()}get busy(){return this.inFlight>=2}get theta0Buffer(){return this.theta0Buf}stateTexture(i){return this.stateTex[i]}grainTexture(i){return this.grainTex[i]}build(){const i=this.device,t=this.n,s=r=>({size:[t,t],format:r,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});this.stateTex=[i.createTexture(s("rgba32float")),i.createTexture(s("rgba32float"))],this.grainTex=[i.createTexture(s("r32uint")),i.createTexture(s("r32uint"))],this.fluxTex=i.createTexture(s("rgba32float")),this.paramBuf=i.createBuffer({size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.theta0Buf=i.createBuffer({size:f*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.twinCtrBuf=i.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.seedBuf=i.createBuffer({size:T*b*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const e=(8+f)*4;this.statsBuf=i.createBuffer({size:e,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.statsStaging=i.createBuffer({size:e,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const a=r=>i.createComputePipeline({layout:"auto",compute:{module:i.createShaderModule({code:r}),entryPoint:"main"}});this.fluxPipe=a(R),this.updatePipe=a(G),this.stampPipe=a(L),this.statsPipe=a(z);for(const r of[0,1]){const o=this.stateTex[r].createView(),c=this.grainTex[r].createView(),l=this.stateTex[1-r].createView(),d=this.grainTex[1-r].createView();this.fluxBG[r]=i.createBindGroup({layout:this.fluxPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:o},{binding:2,resource:c},{binding:3,resource:{buffer:this.theta0Buf}},{binding:4,resource:this.fluxTex.createView()}]}),this.updateBG[r]=i.createBindGroup({layout:this.updatePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:o},{binding:2,resource:c},{binding:3,resource:this.fluxTex.createView()},{binding:4,resource:l},{binding:5,resource:d},{binding:6,resource:{buffer:this.theta0Buf}},{binding:7,resource:{buffer:this.twinCtrBuf}}]}),this.stampBG[r]=i.createBindGroup({layout:this.stampPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:o},{binding:2,resource:c},{binding:3,resource:{buffer:this.seedBuf}},{binding:4,resource:l},{binding:5,resource:d}]}),this.statsBG[r]=i.createBindGroup({layout:this.statsPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:o},{binding:2,resource:c},{binding:3,resource:{buffer:this.statsBuf}}]})}this.reset()}reset(i=this.params.tFar){const t=this.n;this.params.tFar=i;const s=new Float32Array(t*t*4),e=this.params.alloyOn?this.params.c0:0;for(let r=0;r<t*t;r++)s[r*4+1]=i,s[r*4+2]=e;for(const r of this.stateTex)this.device.queue.writeTexture({texture:r},s,{bytesPerRow:t*16},[t,t]);const a=new Uint32Array(t*t);for(const r of this.grainTex)this.device.queue.writeTexture({texture:r},a,{bytesPerRow:t*4},[t,t]);this.dir=0,this.frame=0,this.simTime=0,this.nextId=1,this.frontX=1,this.pendingSeeds=[],this.theta0CPU.fill(0),this.device.queue.writeBuffer(this.theta0Buf,0,this.theta0CPU),this.device.queue.writeBuffer(this.twinCtrBuf,0,new Uint32Array([f-1]))}resetMold(i,t=1.15,s=.06){const e=this.n,a=new Float32Array(e*e*4),r=new Uint32Array(e*e);for(let o=0;o<e*e;o++){const c=i[o]===1;a[o*4]=c?0:1,a[o*4+1]=c?t:s,a[o*4+3]=c?0:-1}for(let o=0;o<e*e;o++)i[o]!==1&&(r[o]=1);for(const o of this.stateTex)this.device.queue.writeTexture({texture:o},a,{bytesPerRow:e*16},[e,e]);for(const o of this.grainTex)this.device.queue.writeTexture({texture:o},r,{bytesPerRow:e*4},[e,e]);this.dir=0,this.frame=0,this.simTime=0,this.frontX=1,this.pendingSeeds=[],this.theta0CPU.fill(0),this.theta0CPU[1]=Math.random()*(2*Math.PI/this.params.aniMode),this.nextId=2,this.device.queue.writeBuffer(this.theta0Buf,0,this.theta0CPU),this.device.queue.writeBuffer(this.twinCtrBuf,0,new Uint32Array([f-1]))}addSeed(i,t,s=4,e,a=2){let r=this.nextId++;r>=f&&(this.nextId=2,r=1);const o=e??Math.random()*(2*Math.PI/this.params.aniMode);return this.theta0CPU[r]=o,this.device.queue.writeBuffer(this.theta0Buf,r*4,this.theta0CPU,r,1),this.pendingSeeds.push({x:i,y:t,r:s,id:r,tact:a}),r}quench(i=.25){this.pendingQuench+=i}addTwinSeed(i,t,s=4){const e=Math.random()*(2*Math.PI/this.params.aniMode),a=Math.random()*Math.PI*2,r=s*.45;this.addSeed(i-Math.cos(a)*r,t-Math.sin(a)*r,s,e),this.addSeed(i+Math.cos(a)*r,t+Math.sin(a)*r,s,e+Math.PI/this.params.aniMode)}chillWall(i="bottom",t=42){const s=this.n;for(let e=0;e<t;e++){const a=((e+.5)/t+(Math.random()-.5)*.6/t)*s;i==="bottom"?this.addSeed(a,s-3,3.5):this.addSeed(3,a,3.5)}}writeParams(i){const t=this.params,s=new Uint32Array(this.paramData),e=new Float32Array(this.paramData);s[0]=this.n,s[1]=this.frame,e[2]=t.dx,e[3]=t.dt,e[4]=t.epsBar,e[5]=t.delta,e[6]=t.aniMode,e[7]=t.tau,e[8]=t.alpha,e[9]=t.gamma,e[10]=t.latent,e[11]=t.noiseAmp,e[12]=t.tFar,e[13]=t.coolRate,e[14]=t.heatIn,s[15]=i,e[16]=this.simTime,s[17]=t.scen,e[18]=t.gradG,e[19]=this.frontX,e[20]=t.weldX,e[21]=t.weldY,e[22]=t.weldPow,e[23]=t.weldSig,s[24]=t.alloyOn,e[25]=t.c0,e[26]=t.mLiq,e[27]=t.kPart,e[28]=t.dSol,e[29]=this.pendingQuench,e[30]=t.twinProb,s[31]=this.nextId,s[32]=this.probe?Math.round(this.probe.x):4294967295,s[33]=this.probe?Math.round(this.probe.y):4294967295,this.device.queue.writeBuffer(this.paramBuf,0,this.paramData)}dispatch(i){const t=Math.ceil(this.n/8);i.dispatchWorkgroups(t,t)}step(i){if(this.busy)return 0;const t=this.device,s=Math.max(1,Math.floor(16e7/(this.n*this.n))),e=Math.min(i,s);let a=0;if(this.pendingSeeds.length>0){const d=this.pendingSeeds.splice(0,T),u=new Float32Array(d.length*b);d.forEach((h,v)=>{const p=v*b;u[p]=h.x,u[p+1]=h.y,u[p+2]=h.r,u[p+3]=h.id,u[p+4]=h.tact}),t.queue.writeBuffer(this.seedBuf,0,u),a=d.length}const r=a>0||this.pendingQuench!==0;if(e===0&&!r)return 0;this.frame++,this.params.scen===1&&(this.frontX=1+this.params.pullV*this.simTime),this.writeParams(a),this.pendingQuench=0;const o=t.createCommandEncoder(),c=o.beginComputePass();let l=this.dir;r&&(c.setPipeline(this.stampPipe),c.setBindGroup(0,this.stampBG[l]),this.dispatch(c),l=1-l);for(let d=0;d<e;d++)c.setPipeline(this.fluxPipe),c.setBindGroup(0,this.fluxBG[l]),this.dispatch(c),c.setPipeline(this.updatePipe),c.setBindGroup(0,this.updateBG[l]),this.dispatch(c),l=1-l;return c.end(),t.queue.submit([o.finish()]),this.dir=l,this.simTime+=e*this.params.dt,this.inFlight++,t.queue.onSubmittedWorkDone().then(()=>{this.inFlight=Math.max(0,this.inFlight-1)}),e}async readStats(){if(this.statsInFlight)return null;this.statsInFlight=!0;const i=this.device;this.writeParams(0);const t=i.createCommandEncoder();t.clearBuffer(this.statsBuf);const s=t.beginComputePass();s.setPipeline(this.statsPipe),s.setBindGroup(0,this.statsBG[this.dir]),this.dispatch(s),s.end(),t.copyBufferToBuffer(this.statsBuf,0,this.statsStaging,0,this.statsBuf.size),i.queue.submit([t.finish()]);try{await this.statsStaging.mapAsync(GPUMapMode.READ)}catch{return this.statsInFlight=!1,null}const e=new Uint32Array(this.statsStaging.getMappedRange().slice(0));this.statsStaging.unmap(),this.statsInFlight=!1;const a=this.n*this.n,r=e[0],o=e[1],c=o>0?e[2]/1e3/o:0,l=this.probe?e[4]/1e3-1:null,d=this.probe?e[5]/1e3:null,u=Math.max(20,this.n*this.n*1e-5),h=A*1e3/this.n,v=[];let p=0;for(let x=1;x<f;x++){const S=e[8+x];S>u&&(p+=S,v.push(2*Math.sqrt(S/Math.PI)*h))}const m=v.length,P=m>0?p/m:0;let w=null;if(m>=3&&P>0){const x=P*(h/1e3)**2;w=3.322*Math.log10(1/x)-2.954}return{fracSolid:r/a,grainCount:m,meanAreaPx:P,astm:w,interfaceT:c,diamsUm:v,probeT:l,probePhi:d}}async readLine(i,t,s,e,a=400){const r=this.n,o=m=>Math.min(r-1,Math.max(0,m));i=o(i),t=o(t),s=o(s),e=o(e);const c=Math.floor(Math.min(t,e)),l=Math.ceil(Math.max(t,e))-c+1,d=r*16,u=this.device.createBuffer({size:d*l,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),h=this.device.createCommandEncoder();h.copyTextureToBuffer({texture:this.stateTex[this.dir],origin:{x:0,y:c}},{buffer:u,bytesPerRow:d},{width:r,height:l}),this.device.queue.submit([h.finish()]);try{await u.mapAsync(GPUMapMode.READ)}catch{return u.destroy(),null}const v=new Float32Array(u.getMappedRange().slice(0));u.unmap(),u.destroy();const p=new Float32Array(a);for(let m=0;m<a;m++){const P=m/(a-1),w=Math.round(i+(s-i)*P),x=Math.round(t+(e-t)*P);p[m]=v[((x-c)*r+w)*4]}return p}}const N={generic:{label:"model metal (pure)",note:"Kobayashi's dimensionless pure metal — the reference crystal every phase-field paper grows first.",params:{aniMode:4,delta:.04,latent:1.6,alloyOn:0,meltGlow:1}},al:{label:"aluminum · Al–Cu",note:"FCC, ⟨100⟩ arms. Freezes at 660 °C, so the melt only glows dull red. Al castings grow feathery twinned grains — try the twin rate slider.",params:{aniMode:4,delta:.045,latent:1.35,alloyOn:1,c0:.3,mLiq:.5,kPart:.14,dSol:.9,meltGlow:.55}},steel:{label:"steel · Fe–C",note:"BCC δ-ferrite, 4-fold ⟨100⟩ dendrites. Pours at ~1540 °C — white-hot, the brightest melt here.",params:{aniMode:4,delta:.03,latent:1.8,alloyOn:1,c0:.35,mLiq:.5,kPart:.3,dSol:.7,meltGlow:1}},ni:{label:"nickel superalloy",note:"Turbine-blade metal, grown as one single crystal in a Bridgman furnace — try the BRIDGMAN scenario.",params:{aniMode:4,delta:.04,latent:1.7,alloyOn:1,c0:.3,mLiq:.4,kPart:.35,dSol:.6,meltGlow:.95}},co:{label:"cobalt alloy",note:"Surprise: Co freezes FCC, so its dendrites are 4-fold like steel's. It only turns HCP at 417 °C, long after solidifying.",params:{aniMode:4,delta:.035,latent:1.7,alloyOn:1,c0:.3,mLiq:.45,kPart:.25,dSol:.7,meltGlow:.95}},cu:{label:"copper · bronze",note:"The oldest cast metal — bronze bells, brass fittings. FCC, freezes at 1085 °C with an honest orange glow.",params:{aniMode:4,delta:.04,latent:1.6,alloyOn:1,c0:.3,mLiq:.45,kPart:.2,dSol:.8,meltGlow:.8}},mg:{label:"magnesium · AZ91",note:"HCP — a metal that grows genuine 6-fold dendrites, snowflakes in magnesium.",params:{aniMode:6,delta:.04,latent:1.5,alloyOn:1,c0:.35,mLiq:.5,kPart:.35,dSol:.8,meltGlow:.6}},zn:{label:"zinc · spangle",note:"The spangle on galvanized steel is exactly this: HCP 6-fold crystals. At 420 °C the melt does not glow at all — just liquid silver.",params:{aniMode:6,delta:.045,latent:1.6,alloyOn:0,meltGlow:.3}},ice:{label:"water · ice",note:"Hexagonal ice — the one fact behind every 6-armed snowflake. Twinned seeds grow the rare 12-branched flake.",params:{aniMode:6,delta:.04,latent:1.8,noiseAmp:.014,alloyOn:0,meltGlow:.12}},scn:{label:"succinonitrile (SCN)",note:"NASA's transparent model metal — flown on the Space Shuttle to film dendrites growing. Weak anisotropy, soft rounded tips.",params:{aniMode:4,delta:.012,latent:1.4,noiseAmp:.016,alloyOn:0,meltGlow:.18}}};class q{constructor(i,t,s){n(this,"device");n(this,"ctx");n(this,"canvas");n(this,"pipe");n(this,"rbuf");n(this,"bg",[]);n(this,"rdata",new ArrayBuffer(64));n(this,"zoom",1);n(this,"cx",.5);n(this,"cy",.5);n(this,"pixelSize",0);n(this,"paletteOn",!1);this.device=i,this.canvas=t,this.ctx=t.getContext("webgpu");const e=navigator.gpu.getPreferredCanvasFormat();this.ctx.configure({device:i,format:e,alphaMode:"opaque"}),this.pipe=i.createRenderPipeline({layout:"auto",vertex:{module:i.createShaderModule({code:B}),entryPoint:"vmain"},fragment:{module:i.createShaderModule({code:B}),entryPoint:"fmain",targets:[{format:e}]},primitive:{topology:"triangle-list"}}),this.rbuf=i.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.rebind(s)}rebind(i){for(const t of[0,1])this.bg[t]=this.device.createBindGroup({layout:this.pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.rbuf}},{binding:1,resource:i.stateTexture(t).createView()},{binding:2,resource:i.grainTexture(t).createView()},{binding:3,resource:{buffer:i.theta0Buffer}}]})}resize(){const i=Math.min(window.devicePixelRatio||1,2),t=Math.floor(this.canvas.clientWidth*i),s=Math.floor(this.canvas.clientHeight*i);(this.canvas.width!==t||this.canvas.height!==s)&&(this.canvas.width=t,this.canvas.height=s)}clampView(){this.zoom=Math.min(24,Math.max(1,this.zoom));const i=.5/this.zoom;this.cx=Math.min(1-i,Math.max(i,this.cx)),this.cy=Math.min(1-i,Math.max(i,this.cy))}resetView(){this.zoom=1,this.cx=.5,this.cy=.5}clientToCover(i,t){const s=this.canvas.getBoundingClientRect(),e=this.canvas.width/s.width,a=(i-s.left)*e,r=(t-s.top)*e,o=Math.max(this.canvas.width,this.canvas.height),c=(this.canvas.width-o)*.5,l=(this.canvas.height-o)*.5;return{x:(a-c)/o,y:(r-l)/o}}clientToGrid(i,t,s){const e=this.clientToCover(i,t),a=((e.x-.5)/this.zoom+this.cx)*s,r=((e.y-.5)/this.zoom+this.cy)*s;return a<0||r<0||a>=s||r>=s?null:{x:a,y:r}}zoomAt(i,t,s){const e=this.clientToCover(i,t),a=(e.x-.5)/this.zoom+this.cx,r=(e.y-.5)/this.zoom+this.cy;this.zoom*=s,this.zoom=Math.min(24,Math.max(1,this.zoom)),this.cx=a-(e.x-.5)/this.zoom,this.cy=r-(e.y-.5)/this.zoom,this.clampView()}panBy(i,t){const s=this.canvas.getBoundingClientRect(),e=this.canvas.width/s.width,a=Math.max(this.canvas.width,this.canvas.height);this.cx-=i*e/a/this.zoom,this.cy-=t*e/a/this.zoom,this.clampView()}gridToClient(i,t,s){const e=this.canvas.getBoundingClientRect(),a=this.canvas.width/Math.max(e.width,1),r=Math.max(this.canvas.width,this.canvas.height),o=(this.canvas.width-r)*.5,c=(this.canvas.height-r)*.5,l=(i/s-this.cx)*this.zoom+.5,d=(t/s-this.cy)*this.zoom+.5;return{x:(l*r+o)/a+e.left,y:(d*r+c)/a+e.top}}cssPxPerCell(i){const t=this.canvas.getBoundingClientRect();return Math.max(t.width,t.height)/i*this.zoom}render(i,t,s){this.resize();const e=new Uint32Array(this.rdata),a=new Float32Array(this.rdata);e[0]=t,e[1]=i.n,a[2]=this.canvas.width,a[3]=this.canvas.height,a[4]=s,a[5]=i.params.aniMode,a[6]=i.params.tFar,a[7]=this.zoom,a[8]=this.cx,a[9]=this.cy,a[10]=this.pixelSize,e[11]=this.paletteOn?1:0,e[12]=i.params.alloyOn,a[13]=i.params.c0,a[14]=i.params.meltGlow,this.device.queue.writeBuffer(this.rbuf,0,this.rdata);const r=this.device.createCommandEncoder(),o=r.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),loadOp:"clear",clearValue:{r:.04,g:.04,b:.05,a:1},storeOp:"store"}]});o.setPipeline(this.pipe),o.setBindGroup(0,this.bg[i.dir]),o.draw(3),o.end(),this.device.queue.submit([r.finish()])}}export{A as D,E as L,N as M,q as R,_ as S};
