var T=Object.defineProperty;var B=(p,t,e)=>t in p?T(p,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):p[t]=e;var o=(p,t,e)=>B(p,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))a(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const r of s.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&a(r)}).observe(document,{childList:!0,subtree:!0});function e(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function a(i){if(i.ep)return;i.ep=!0;const s=e(i);fetch(i.href,s)}})();const h=4096,y=64,m=6,x=`
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
  pad0: f32,
  pad1: f32,
  pad2: f32,
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
${x}
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
  let th0 = theta0[min(id, ${h-1}u)];
  let beta = P.aniMode * (atan2(py, px) - th0);
  let eps = P.epsBar * (1.0 + P.delta * cos(beta));
  let deps = -P.epsBar * P.delta * P.aniMode * sin(beta);
  textureStore(flux, c, vec4f(eps * deps * px, eps * deps * py, eps * eps, 0.0));
}
`,L=`
${x}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var flux: texture_2d<f32>;
@group(0) @binding(4) var stateOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var grainOut: texture_storage_2d<r32uint, write>;

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
  }

  textureStore(stateOut, c, vec4f(phiNew, TNew, cNew, age));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`,G=`
${x}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> seeds: array<f32, ${y*m}>;
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
  if (phi < 0.3) {
    let p = vec2f(gid.xy) + 0.5;
    for (var i = 0u; i < P.seedCount; i++) {
      let b = i * ${m}u;
      let pos = vec2f(seeds[b], seeds[b + 1u]);
      let r = seeds[b + 2u];
      let tact = seeds[b + 4u];
      if (s.g >= tact) { continue; }
      let d = distance(p, pos);
      if (d < r) {
        let v = 1.0 - smoothstep(r - 2.0, r, d);
        if (v > phi) { phi = v; id = u32(seeds[b + 3u]); age = P.time; }
      }
    }
  }
  textureStore(stateOut, c, vec4f(phi, s.g, s.b, age));
  textureStore(grainOut, c, vec4u(id, 0u, 0u, 0u));
}
`,M=`
${x}
struct Stats {
  solid: atomic<u32>,
  interf: atomic<u32>,
  interfT: atomic<u32>,   // fixed point x1000
  pad: u32,
  counts: array<atomic<u32>, ${h}>,
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
    if (id > 0u && id < ${h}u) {
      atomicAdd(&stats.counts[id], 1u);
    }
  }
  if (s.r > 0.2 && s.r < 0.8) {
    atomicAdd(&stats.interf, 1u);
    atomicAdd(&stats.interfT, u32(clamp(s.g, 0.0, 2.0) * 1000.0));
  }
}
`,O=["MELT","ORIENT","ETCH","FIELD","RINGS","THERM","SEM","NEON","XRAY","CURV"],S=`
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
  pad0: f32,
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
  let th0 = theta0[min(id, ${h-1}u)];

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

  // grain boundary detect (step matches pixel size)
  var gb = 0.0;
  let st = max(1, i32(ps));
  if (id != 0u && phi > 0.5) {
    for (var k = 0; k < 4; k++) {
      var d = vec2i(st, 0);
      if (k == 1) { d = vec2i(-st, 0); }
      if (k == 2) { d = vec2i(0, st); }
      if (k == 3) { d = vec2i(0, -st); }
      let nc = cl(ci + d);
      let nid = textureLoad(grain, nc, 0).r;
      if (nid != 0u && nid != id && textureLoad(state, nc, 0).r > 0.5) { gb = 1.0; }
    }
  }

  var col = vec3f(0.0);

  switch (R.view) {
    case 0u: { // MELT
      let glow = heat(T);
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
      col *= 1.0 - gb * 0.7;
    }
    case 2u: { // ETCH
      var lum = 0.58 + 0.24 * idh + diff * 0.05 - spec * 0.03;
      // alloy: interdendritic segregation etches darker
      if (R.alloyOn == 1u) { lum -= clamp(conc - R.c0, 0.0, 1.0) * 0.35; }
      let solidCol = vec3f(lum) * vec3f(0.99, 0.965, 0.915);
      let liq = vec3f(0.965, 0.955, 0.935);
      col = mix(liq, solidCol, solidness);
      col *= 1.0 - gb * 0.82;
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
    default: { // CURV: Gibbs–Thomson lens — interface coloured by curvature
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
`,E={dx:.03,dt:12e-5,epsBar:.01,delta:.04,aniMode:4,tau:3e-4,alpha:.9,gamma:10,latent:1.6,noiseAmp:.01,tFar:0,coolRate:0,heatIn:0,scen:0,gradG:.08,pullV:1.5,weldX:0,weldY:0,weldPow:700,weldSig:4,alloyOn:0,c0:.3,mLiq:.45,kPart:.2,dSol:.8},z=1;class _{constructor(t,e){o(this,"device");o(this,"n");o(this,"params");o(this,"frame",0);o(this,"simTime",0);o(this,"dir",0);o(this,"nextId",1);o(this,"frontX",0);o(this,"stateTex",[]);o(this,"grainTex",[]);o(this,"fluxTex");o(this,"paramBuf");o(this,"theta0Buf");o(this,"seedBuf");o(this,"statsBuf");o(this,"statsStaging");o(this,"theta0CPU",new Float32Array(h));o(this,"fluxPipe");o(this,"updatePipe");o(this,"stampPipe");o(this,"statsPipe");o(this,"fluxBG",[]);o(this,"updateBG",[]);o(this,"stampBG",[]);o(this,"statsBG",[]);o(this,"pendingSeeds",[]);o(this,"statsInFlight",!1);o(this,"paramData",new ArrayBuffer(128));o(this,"inFlight",0);this.device=t,this.n=e,this.params={...E},this.build()}get busy(){return this.inFlight>=2}get theta0Buffer(){return this.theta0Buf}stateTexture(t){return this.stateTex[t]}grainTexture(t){return this.grainTex[t]}build(){const t=this.device,e=this.n,a=r=>({size:[e,e],format:r,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST});this.stateTex=[t.createTexture(a("rgba32float")),t.createTexture(a("rgba32float"))],this.grainTex=[t.createTexture(a("r32uint")),t.createTexture(a("r32uint"))],this.fluxTex=t.createTexture(a("rgba32float")),this.paramBuf=t.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.theta0Buf=t.createBuffer({size:h*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.seedBuf=t.createBuffer({size:y*m*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const i=(4+h)*4;this.statsBuf=t.createBuffer({size:i,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.statsStaging=t.createBuffer({size:i,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const s=r=>t.createComputePipeline({layout:"auto",compute:{module:t.createShaderModule({code:r}),entryPoint:"main"}});this.fluxPipe=s(R),this.updatePipe=s(L),this.stampPipe=s(G),this.statsPipe=s(M);for(const r of[0,1]){const c=this.stateTex[r].createView(),n=this.grainTex[r].createView(),l=this.stateTex[1-r].createView(),u=this.grainTex[1-r].createView();this.fluxBG[r]=t.createBindGroup({layout:this.fluxPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:n},{binding:3,resource:{buffer:this.theta0Buf}},{binding:4,resource:this.fluxTex.createView()}]}),this.updateBG[r]=t.createBindGroup({layout:this.updatePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:n},{binding:3,resource:this.fluxTex.createView()},{binding:4,resource:l},{binding:5,resource:u}]}),this.stampBG[r]=t.createBindGroup({layout:this.stampPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:n},{binding:3,resource:{buffer:this.seedBuf}},{binding:4,resource:l},{binding:5,resource:u}]}),this.statsBG[r]=t.createBindGroup({layout:this.statsPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:n},{binding:3,resource:{buffer:this.statsBuf}}]})}this.reset()}reset(t=this.params.tFar){const e=this.n;this.params.tFar=t;const a=new Float32Array(e*e*4),i=this.params.alloyOn?this.params.c0:0;for(let r=0;r<e*e;r++)a[r*4+1]=t,a[r*4+2]=i;for(const r of this.stateTex)this.device.queue.writeTexture({texture:r},a,{bytesPerRow:e*16},[e,e]);const s=new Uint32Array(e*e);for(const r of this.grainTex)this.device.queue.writeTexture({texture:r},s,{bytesPerRow:e*4},[e,e]);this.dir=0,this.frame=0,this.simTime=0,this.nextId=1,this.frontX=1,this.pendingSeeds=[],this.theta0CPU.fill(0),this.device.queue.writeBuffer(this.theta0Buf,0,this.theta0CPU)}addSeed(t,e,a=4,i,s=2){let r=this.nextId++;r>=h&&(this.nextId=2,r=1);const c=i??Math.random()*(2*Math.PI/this.params.aniMode);return this.theta0CPU[r]=c,this.device.queue.writeBuffer(this.theta0Buf,r*4,this.theta0CPU,r,1),this.pendingSeeds.push({x:t,y:e,r:a,id:r,tact:s}),r}chillWall(t="bottom",e=42){const a=this.n;for(let i=0;i<e;i++){const s=((i+.5)/e+(Math.random()-.5)*.6/e)*a;t==="bottom"?this.addSeed(s,a-3,3.5):this.addSeed(3,s,3.5)}}writeParams(t){const e=this.params,a=new Uint32Array(this.paramData),i=new Float32Array(this.paramData);a[0]=this.n,a[1]=this.frame,i[2]=e.dx,i[3]=e.dt,i[4]=e.epsBar,i[5]=e.delta,i[6]=e.aniMode,i[7]=e.tau,i[8]=e.alpha,i[9]=e.gamma,i[10]=e.latent,i[11]=e.noiseAmp,i[12]=e.tFar,i[13]=e.coolRate,i[14]=e.heatIn,a[15]=t,i[16]=this.simTime,a[17]=e.scen,i[18]=e.gradG,i[19]=this.frontX,i[20]=e.weldX,i[21]=e.weldY,i[22]=e.weldPow,i[23]=e.weldSig,a[24]=e.alloyOn,i[25]=e.c0,i[26]=e.mLiq,i[27]=e.kPart,i[28]=e.dSol,this.device.queue.writeBuffer(this.paramBuf,0,this.paramData)}dispatch(t){const e=Math.ceil(this.n/8);t.dispatchWorkgroups(e,e)}step(t){if(this.busy)return 0;const e=this.device,a=Math.max(1,Math.floor(16e7/(this.n*this.n))),i=Math.min(t,a);let s=0;if(this.pendingSeeds.length>0){const l=this.pendingSeeds.splice(0,y),u=new Float32Array(l.length*m);l.forEach((f,v)=>{const d=v*m;u[d]=f.x,u[d+1]=f.y,u[d+2]=f.r,u[d+3]=f.id,u[d+4]=f.tact}),e.queue.writeBuffer(this.seedBuf,0,u),s=l.length}if(i===0&&s===0)return 0;this.frame++,this.params.scen===1&&(this.frontX=1+this.params.pullV*this.simTime),this.writeParams(s);const r=e.createCommandEncoder(),c=r.beginComputePass();let n=this.dir;s>0&&(c.setPipeline(this.stampPipe),c.setBindGroup(0,this.stampBG[n]),this.dispatch(c),n=1-n);for(let l=0;l<i;l++)c.setPipeline(this.fluxPipe),c.setBindGroup(0,this.fluxBG[n]),this.dispatch(c),c.setPipeline(this.updatePipe),c.setBindGroup(0,this.updateBG[n]),this.dispatch(c),n=1-n;return c.end(),e.queue.submit([r.finish()]),this.dir=n,this.simTime+=i*this.params.dt,this.inFlight++,e.queue.onSubmittedWorkDone().then(()=>{this.inFlight=Math.max(0,this.inFlight-1)}),i}async readStats(){if(this.statsInFlight)return null;this.statsInFlight=!0;const t=this.device;this.writeParams(0);const e=t.createCommandEncoder();e.clearBuffer(this.statsBuf);const a=e.beginComputePass();a.setPipeline(this.statsPipe),a.setBindGroup(0,this.statsBG[this.dir]),this.dispatch(a),a.end(),e.copyBufferToBuffer(this.statsBuf,0,this.statsStaging,0,this.statsBuf.size),t.queue.submit([e.finish()]);try{await this.statsStaging.mapAsync(GPUMapMode.READ)}catch{return this.statsInFlight=!1,null}const i=new Uint32Array(this.statsStaging.getMappedRange().slice(0));this.statsStaging.unmap(),this.statsInFlight=!1;const s=this.n*this.n,r=i[0],c=i[1],n=c>0?i[2]/1e3/c:0,l=Math.max(20,this.n*this.n*1e-5),u=z*1e3/this.n,f=[];let v=0;for(let g=1;g<h;g++){const b=i[4+g];b>l&&(v+=b,f.push(2*Math.sqrt(b/Math.PI)*u))}const d=f.length,P=d>0?v/d:0;let w=null;if(d>=3&&P>0){const g=P*(u/1e3)**2;w=3.322*Math.log10(1/g)-2.954}return{fracSolid:r/s,grainCount:d,meanAreaPx:P,astm:w,interfaceT:n,diamsUm:f}}}class U{constructor(t,e,a){o(this,"device");o(this,"ctx");o(this,"canvas");o(this,"pipe");o(this,"rbuf");o(this,"bg",[]);o(this,"rdata",new ArrayBuffer(64));o(this,"zoom",1);o(this,"cx",.5);o(this,"cy",.5);o(this,"pixelSize",0);o(this,"paletteOn",!1);this.device=t,this.canvas=e,this.ctx=e.getContext("webgpu");const i=navigator.gpu.getPreferredCanvasFormat();this.ctx.configure({device:t,format:i,alphaMode:"opaque"}),this.pipe=t.createRenderPipeline({layout:"auto",vertex:{module:t.createShaderModule({code:S}),entryPoint:"vmain"},fragment:{module:t.createShaderModule({code:S}),entryPoint:"fmain",targets:[{format:i}]},primitive:{topology:"triangle-list"}}),this.rbuf=t.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.rebind(a)}rebind(t){for(const e of[0,1])this.bg[e]=this.device.createBindGroup({layout:this.pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.rbuf}},{binding:1,resource:t.stateTexture(e).createView()},{binding:2,resource:t.grainTexture(e).createView()},{binding:3,resource:{buffer:t.theta0Buffer}}]})}resize(){const t=Math.min(window.devicePixelRatio||1,2),e=Math.floor(this.canvas.clientWidth*t),a=Math.floor(this.canvas.clientHeight*t);(this.canvas.width!==e||this.canvas.height!==a)&&(this.canvas.width=e,this.canvas.height=a)}clampView(){this.zoom=Math.min(24,Math.max(1,this.zoom));const t=.5/this.zoom;this.cx=Math.min(1-t,Math.max(t,this.cx)),this.cy=Math.min(1-t,Math.max(t,this.cy))}resetView(){this.zoom=1,this.cx=.5,this.cy=.5}clientToCover(t,e){const a=this.canvas.getBoundingClientRect(),i=this.canvas.width/a.width,s=(t-a.left)*i,r=(e-a.top)*i,c=Math.max(this.canvas.width,this.canvas.height),n=(this.canvas.width-c)*.5,l=(this.canvas.height-c)*.5;return{x:(s-n)/c,y:(r-l)/c}}clientToGrid(t,e,a){const i=this.clientToCover(t,e),s=((i.x-.5)/this.zoom+this.cx)*a,r=((i.y-.5)/this.zoom+this.cy)*a;return s<0||r<0||s>=a||r>=a?null:{x:s,y:r}}zoomAt(t,e,a){const i=this.clientToCover(t,e),s=(i.x-.5)/this.zoom+this.cx,r=(i.y-.5)/this.zoom+this.cy;this.zoom*=a,this.zoom=Math.min(24,Math.max(1,this.zoom)),this.cx=s-(i.x-.5)/this.zoom,this.cy=r-(i.y-.5)/this.zoom,this.clampView()}panBy(t,e){const a=this.canvas.getBoundingClientRect(),i=this.canvas.width/a.width,s=Math.max(this.canvas.width,this.canvas.height);this.cx-=t*i/s/this.zoom,this.cy-=e*i/s/this.zoom,this.clampView()}cssPxPerCell(t){const e=this.canvas.getBoundingClientRect();return Math.max(e.width,e.height)/t*this.zoom}render(t,e,a){this.resize();const i=new Uint32Array(this.rdata),s=new Float32Array(this.rdata);i[0]=e,i[1]=t.n,s[2]=this.canvas.width,s[3]=this.canvas.height,s[4]=a,s[5]=t.params.aniMode,s[6]=t.params.tFar,s[7]=this.zoom,s[8]=this.cx,s[9]=this.cy,s[10]=this.pixelSize,i[11]=this.paletteOn?1:0,i[12]=t.params.alloyOn,s[13]=t.params.c0,this.device.queue.writeBuffer(this.rbuf,0,this.rdata);const r=this.device.createCommandEncoder(),c=r.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),loadOp:"clear",clearValue:{r:.04,g:.04,b:.05,a:1},storeOp:"store"}]});c.setPipeline(this.pipe),c.setBindGroup(0,this.bg[t.dir]),c.draw(3),c.end(),this.device.queue.submit([r.finish()])}}export{z as D,O as L,U as R,_ as S};
