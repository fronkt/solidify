var X=Object.defineProperty;var j=(l,t,e)=>t in l?X(l,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):l[t]=e;var a=(l,t,e)=>j(l,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))i(s);new MutationObserver(s=>{for(const n of s)if(n.type==="childList")for(const o of n.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function e(s){const n={};return s.integrity&&(n.integrity=s.integrity),s.referrerPolicy&&(n.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?n.credentials="include":s.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function i(s){if(s.ep)return;s.ep=!0;const n=e(s);fetch(s.href,n)}})();const w=4096,O=64,R=`
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
`,K=`
${R}
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
  let th0 = theta0[min(id, ${w-1}u)];
  let beta = P.aniMode * (atan2(py, px) - th0);
  let eps = P.epsBar * (1.0 + P.delta * cos(beta));
  let deps = -P.epsBar * P.delta * P.aniMode * sin(beta);
  textureStore(flux, c, vec4f(eps * deps * px, eps * deps * py, eps * eps, 0.0));
}
`,Z=`
${R}
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
`,J=`
${R}
struct Seed { pos: vec2f, r: f32, id: f32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var grain: texture_2d<u32>;
@group(0) @binding(3) var<storage, read> seeds: array<Seed, ${O}>;
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
`,Q=`
${R}
struct Stats {
  solid: atomic<u32>,
  interf: atomic<u32>,
  interfT: atomic<u32>,   // fixed point x1000
  pad: u32,
  counts: array<atomic<u32>, ${w}>,
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
    if (id > 0u && id < ${w}u) {
      atomicAdd(&stats.counts[id], 1u);
    }
  }
  if (s.r > 0.2 && s.r < 0.8) {
    atomicAdd(&stats.interf, 1u);
    atomicAdd(&stats.interfT, u32(clamp(s.g, 0.0, 2.0) * 1000.0));
  }
}
`,W=`
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
    let tint = polar(theta0[min(id, ${w-1}u)] / (2.0 * PI / max(R.aniMode, 1.0)), idh);
    let solidCol = steel * (0.7 + 0.3 * tint) + glow * 0.3;
    col = mix(glow, solidCol, solidness);
    col -= gb * vec3f(0.03);
  } else if (R.view == 1u) {
    // ORIENTATION: cross-polarised colour by theta0, embossed
    let th = theta0[min(id, ${w-1}u)];
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
`,tt={dx:.03,dt:12e-5,epsBar:.01,delta:.04,aniMode:4,tau:3e-4,alpha:.9,gamma:10,latent:1.6,noiseAmp:.01,tFar:0,coolRate:0,heatIn:0},H=1;class D{constructor(t,e){a(this,"device");a(this,"n");a(this,"params");a(this,"frame",0);a(this,"simTime",0);a(this,"dir",0);a(this,"nextId",1);a(this,"stateTex",[]);a(this,"grainTex",[]);a(this,"fluxTex");a(this,"paramBuf");a(this,"theta0Buf");a(this,"seedBuf");a(this,"statsBuf");a(this,"statsStaging");a(this,"theta0CPU",new Float32Array(w));a(this,"fluxPipe");a(this,"updatePipe");a(this,"stampPipe");a(this,"statsPipe");a(this,"fluxBG",[]);a(this,"updateBG",[]);a(this,"stampBG",[]);a(this,"statsBG",[]);a(this,"pendingSeeds",[]);a(this,"statsInFlight",!1);a(this,"paramData",new ArrayBuffer(64));a(this,"inFlight",0);this.device=t,this.n=e,this.params={...tt},this.build()}get busy(){return this.inFlight>=2}get theta0Buffer(){return this.theta0Buf}stateTexture(t){return this.stateTex[t]}grainTexture(t){return this.grainTex[t]}build(){const t=this.device,e=this.n,i=o=>({size:[e,e],format:o,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST});this.stateTex=[t.createTexture(i("rg32float")),t.createTexture(i("rg32float"))],this.grainTex=[t.createTexture(i("r32uint")),t.createTexture(i("r32uint"))],this.fluxTex=t.createTexture(i("rgba32float")),this.paramBuf=t.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.theta0Buf=t.createBuffer({size:w*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.seedBuf=t.createBuffer({size:O*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const s=(4+w)*4;this.statsBuf=t.createBuffer({size:s,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.statsStaging=t.createBuffer({size:s,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const n=o=>t.createComputePipeline({layout:"auto",compute:{module:t.createShaderModule({code:o}),entryPoint:"main"}});this.fluxPipe=n(K),this.updatePipe=n(Z),this.stampPipe=n(J),this.statsPipe=n(Q);for(const o of[0,1]){const c=this.stateTex[o].createView(),r=this.grainTex[o].createView(),d=this.stateTex[1-o].createView(),p=this.grainTex[1-o].createView();this.fluxBG[o]=t.createBindGroup({layout:this.fluxPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:r},{binding:3,resource:{buffer:this.theta0Buf}},{binding:4,resource:this.fluxTex.createView()}]}),this.updateBG[o]=t.createBindGroup({layout:this.updatePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:r},{binding:3,resource:this.fluxTex.createView()},{binding:4,resource:d},{binding:5,resource:p}]}),this.stampBG[o]=t.createBindGroup({layout:this.stampPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:r},{binding:3,resource:{buffer:this.seedBuf}},{binding:4,resource:d},{binding:5,resource:p}]}),this.statsBG[o]=t.createBindGroup({layout:this.statsPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramBuf}},{binding:1,resource:c},{binding:2,resource:r},{binding:3,resource:{buffer:this.statsBuf}}]})}this.reset()}reset(t=this.params.tFar){const e=this.n;this.params.tFar=t;const i=new Float32Array(e*e*2);for(let n=0;n<e*e;n++)i[n*2+1]=t;this.device.queue.writeTexture({texture:this.stateTex[0]},i,{bytesPerRow:e*8},[e,e]),this.device.queue.writeTexture({texture:this.stateTex[1]},i,{bytesPerRow:e*8},[e,e]);const s=new Uint32Array(e*e);this.device.queue.writeTexture({texture:this.grainTex[0]},s,{bytesPerRow:e*4},[e,e]),this.device.queue.writeTexture({texture:this.grainTex[1]},s,{bytesPerRow:e*4},[e,e]),this.dir=0,this.frame=0,this.simTime=0,this.nextId=1,this.pendingSeeds=[],this.theta0CPU.fill(0),this.device.queue.writeBuffer(this.theta0Buf,0,this.theta0CPU)}addSeed(t,e,i=4,s){let n=this.nextId++;n>=w&&(this.nextId=2,n=1);const o=s??Math.random()*(2*Math.PI/this.params.aniMode);return this.theta0CPU[n]=o,this.device.queue.writeBuffer(this.theta0Buf,n*4,this.theta0CPU,n,1),this.pendingSeeds.push({x:t,y:e,r:i,id:n}),n}chillWall(t="bottom",e=42){const i=this.n;for(let s=0;s<e;s++){const n=((s+.5)/e+(Math.random()-.5)*.6/e)*i;t==="bottom"?this.addSeed(n,i-3,3.5):this.addSeed(3,n,3.5)}}writeParams(t){const e=this.params,i=new Uint32Array(this.paramData),s=new Float32Array(this.paramData);i[0]=this.n,i[1]=this.frame,s[2]=e.dx,s[3]=e.dt,s[4]=e.epsBar,s[5]=e.delta,s[6]=e.aniMode,s[7]=e.tau,s[8]=e.alpha,s[9]=e.gamma,s[10]=e.latent,s[11]=e.noiseAmp,s[12]=e.tFar,s[13]=e.coolRate,s[14]=e.heatIn,i[15]=t,this.device.queue.writeBuffer(this.paramBuf,0,this.paramData)}dispatch(t){const e=Math.ceil(this.n/8);t.dispatchWorkgroups(e,e)}step(t){if(this.busy)return 0;const e=this.device,i=Math.max(1,Math.floor(16e7/(this.n*this.n))),s=Math.min(t,i);let n=0;if(this.pendingSeeds.length>0){const d=this.pendingSeeds.splice(0,O),p=new Float32Array(d.length*4);d.forEach((f,m)=>{p[m*4]=f.x,p[m*4+1]=f.y,p[m*4+2]=f.r,p[m*4+3]=f.id}),e.queue.writeBuffer(this.seedBuf,0,p),n=d.length}this.frame++,this.writeParams(n);const o=e.createCommandEncoder(),c=o.beginComputePass();let r=this.dir;n>0&&(c.setPipeline(this.stampPipe),c.setBindGroup(0,this.stampBG[r]),this.dispatch(c),r=1-r);for(let d=0;d<s;d++)c.setPipeline(this.fluxPipe),c.setBindGroup(0,this.fluxBG[r]),this.dispatch(c),c.setPipeline(this.updatePipe),c.setBindGroup(0,this.updateBG[r]),this.dispatch(c),r=1-r;return c.end(),e.queue.submit([o.finish()]),this.dir=r,this.simTime+=s*this.params.dt,this.inFlight++,e.queue.onSubmittedWorkDone().then(()=>{this.inFlight=Math.max(0,this.inFlight-1)}),s}async readStats(){if(this.statsInFlight)return null;this.statsInFlight=!0;const t=this.device;this.writeParams(0);const e=t.createCommandEncoder();e.clearBuffer(this.statsBuf);const i=e.beginComputePass();i.setPipeline(this.statsPipe),i.setBindGroup(0,this.statsBG[this.dir]),this.dispatch(i),i.end(),e.copyBufferToBuffer(this.statsBuf,0,this.statsStaging,0,this.statsBuf.size),t.queue.submit([e.finish()]);try{await this.statsStaging.mapAsync(GPUMapMode.READ)}catch{return this.statsInFlight=!1,null}const s=new Uint32Array(this.statsStaging.getMappedRange().slice(0));this.statsStaging.unmap(),this.statsInFlight=!1;const n=this.n*this.n,o=s[0],c=s[1],r=c>0?s[2]/1e3/c:0,d=Math.max(20,this.n*this.n*1e-5),p=H*1e3/this.n,f=[];let m=0;for(let u=1;u<w;u++){const x=s[4+u];x>d&&(m+=x,f.push(2*Math.sqrt(x/Math.PI)*p))}const v=f.length,y=v>0?m/v:0;let P=null;if(v>=3&&y>0){const u=y*(p/1e3)**2;P=3.322*Math.log10(1/u)-2.954}return{fracSolid:o/n,grainCount:v,meanAreaPx:y,astm:P,interfaceT:r,diamsUm:f}}}class et{constructor(t,e,i){a(this,"device");a(this,"ctx");a(this,"canvas");a(this,"pipe");a(this,"rbuf");a(this,"bg",[]);a(this,"rdata",new ArrayBuffer(32));this.device=t,this.canvas=e,this.ctx=e.getContext("webgpu");const s=navigator.gpu.getPreferredCanvasFormat();this.ctx.configure({device:t,format:s,alphaMode:"opaque"}),this.pipe=t.createRenderPipeline({layout:"auto",vertex:{module:t.createShaderModule({code:W}),entryPoint:"vmain"},fragment:{module:t.createShaderModule({code:W}),entryPoint:"fmain",targets:[{format:s}]},primitive:{topology:"triangle-list"}}),this.rbuf=t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.rebind(i)}rebind(t){for(const e of[0,1])this.bg[e]=this.device.createBindGroup({layout:this.pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.rbuf}},{binding:1,resource:t.stateTexture(e).createView()},{binding:2,resource:t.grainTexture(e).createView()},{binding:3,resource:{buffer:t.theta0Buffer}}]})}resize(){const t=Math.min(window.devicePixelRatio||1,2),e=Math.floor(this.canvas.clientWidth*t),i=Math.floor(this.canvas.clientHeight*t);(this.canvas.width!==e||this.canvas.height!==i)&&(this.canvas.width=e,this.canvas.height=i)}clientToGrid(t,e,i){const s=this.canvas.getBoundingClientRect(),n=this.canvas.width/s.width,o=(t-s.left)*n,c=(e-s.top)*n,r=Math.max(this.canvas.width,this.canvas.height),d=(this.canvas.width-r)*.5,p=(this.canvas.height-r)*.5,f=(o-d)/r*i,m=(c-p)/r*i;return f<0||m<0||f>=i||m>=i?null:{x:f,y:m}}render(t,e,i){this.resize();const s=new Uint32Array(this.rdata),n=new Float32Array(this.rdata);s[0]=e,s[1]=t.n,n[2]=this.canvas.width,n[3]=this.canvas.height,n[4]=i,n[5]=t.params.aniMode,n[6]=t.params.tFar,this.device.queue.writeBuffer(this.rbuf,0,this.rdata);const o=this.device.createCommandEncoder(),c=o.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),loadOp:"clear",clearValue:{r:.04,g:.04,b:.05,a:1},storeOp:"store"}]});c.setPipeline(this.pipe),c.setBindGroup(0,this.bg[t.dir]),c.draw(3),c.end(),this.device.queue.submit([o.finish()])}}const M=[{title:"The unstable front",body:"A flat solidification front in an undercooled melt cannot stay flat. Any bump reaches deeper into cold liquid, rejects its latent heat faster, and grows faster still — the Mullins–Sekerka instability.",watch:"Watch the flat front from the wall break into fingers on its own.",apply(l){l.setParams({delta:.008,aniMode:4,noiseAmp:.022,latent:1.7,coolRate:0}),l.setRain(0),l.clearMelt(.72),l.chillWall(),l.setView(3),l.setSpeed(18)}},{title:"Why arms?",body:"Crystals are not round because surface energy depends on direction. A cubic metal grows fastest along four preferred directions, so a free crystal sharpens into a four-armed dendrite — the same physics that shapes every cast metal part.",watch:"Four arms lock onto the crystal axes; the glowing halo is latent heat escaping.",apply(l){l.setParams({delta:.05,aniMode:4,noiseAmp:.006,latent:1.6,coolRate:0}),l.setRain(0),l.clearMelt(1),l.seedCenter(),l.setView(0),l.setSpeed(16)}},{title:"Snow",body:"Change the symmetry of that surface energy from four-fold to six-fold and the same equations grow a snowflake. Ice is hexagonal; that single fact is why no snowflake has four arms.",watch:"Side branches appear where random noise disturbs the growing tip.",apply(l){l.setParams({delta:.04,aniMode:6,noiseAmp:.014,latent:1.8,coolRate:0}),l.setRain(0),l.clearMelt(.92),l.seedCenter(),l.setView(0),l.setSpeed(16)}},{title:"Many grains",body:"Real melts nucleate everywhere at once. Each nucleus is a crystal with its own random orientation; where they collide, growth stops and a grain boundary is frozen in. This is why metal is made of grains.",watch:"Each colour is one crystal orientation. When the last liquid vanishes, switch to ETCH — that is a micrograph.",apply(l){l.setParams({delta:.045,aniMode:4,noiseAmp:.012,latent:1.5,coolRate:.12}),l.clearMelt(.85),l.setRain(14),l.setView(1),l.setSpeed(22)}},{title:"The casting",body:"Pour metal against a cold mould wall and columnar grains race inward, feeding on the heat gradient. Ahead of them the remaining melt undercools until new equiaxed grains nucleate and block the columns — the columnar-to-equiaxed transition every foundry fights over.",watch:"Long columns from the wall, then a sudden switch to round grains mid-domain.",apply(l){l.setParams({delta:.045,aniMode:4,noiseAmp:.014,latent:1.85,coolRate:.28}),l.clearMelt(.62),l.chillWall(),l.setRain(3),l.setView(1),l.setSpeed(26)}},{title:"Engineer it",body:"Grain size sets strength — finer is stronger (Hall–Petch). A process engineer tunes cooling and inoculation to hit a target grain size. Here, an optimizer does that job: it runs castings, measures the ASTM grain number, and learns the schedule.",watch:"Each thumbnail is one casting the optimizer tried. Watch it converge on the target.",apply(l){l.startOptimizer()}}];class st{constructor(t){a(this,"el");a(this,"btn");this.app=t,this.el=document.getElementById("tour"),this.btn=document.getElementById("tourBtn"),this.btn.addEventListener("click",()=>this.goto(0))}goto(t){if(t<0||t>=M.length)return this.close();const e=M[t];e.apply(this.app),this.app.syncUI(),this.el.innerHTML=`
      <div class="ch">TOUR · ${t+1} / ${M.length}</div>
      <h3>${e.title}</h3>
      <p>${e.body}</p>
      <div class="watch">▸ ${e.watch}</div>
      <div class="nav"></div>`;const i=this.el.querySelector(".nav"),s=(n,o)=>{const c=document.createElement("button");c.textContent=n,c.addEventListener("click",o),i.append(c)};t>0&&s("◂ back",()=>this.goto(t-1)),s(t<M.length-1?"next ▸":"finish",()=>this.goto(t+1)),s("close",()=>this.close()),this.el.classList.add("show"),this.btn.classList.add("hide")}close(){this.el.classList.remove("show"),this.btn.classList.remove("hide")}}const it=["MELT","ORIENT","ETCH","FIELD"];class nt{constructor(t){a(this,"binds",[]);a(this,"viewBtns",[]);a(this,"runBtn");a(this,"turboBtn");a(this,"symBtns",[]);a(this,"gridBtns",[]);a(this,"readouts",document.getElementById("readouts"));this.host=t,this.buildViews(),this.buildRail(),document.getElementById("railToggle").addEventListener("click",()=>{document.getElementById("rail").classList.toggle("hidden"),document.body.classList.toggle("railHidden")})}buildViews(){const t=document.getElementById("views");it.forEach((e,i)=>{const s=document.createElement("button");s.textContent=e,s.addEventListener("click",()=>{this.host.setView(i),this.sync()}),t.append(s),this.viewBtns.push(s)})}section(t,e){const i=document.createElement("div");i.className="sec";const s=document.createElement("h2");return s.textContent=e,i.append(s),t.append(i),i}slider(t,e,i,s,n,o,c,r=d=>d.toFixed(2)){const d=document.createElement("div");d.className="row";const p=document.createElement("label");p.textContent=e;const f=document.createElement("input");f.type="range",f.min=String(i),f.max=String(s),f.step=String(n);const m=document.createElement("div");m.className="val";const v=()=>{f.value=String(o()),m.textContent=r(o())};f.addEventListener("input",()=>{c(parseFloat(f.value)),m.textContent=r(o())}),d.append(p,f,m),t.append(d),v(),this.binds.push({update:v})}button(t,e,i,s=""){const n=document.createElement("button");return n.textContent=e,s&&(n.className=s),n.addEventListener("click",i),t.append(n),n}btnRow(t){const e=document.createElement("div");return e.className="btnrow",t.append(e),e}buildRail(){const t=document.getElementById("rail"),e=this.host,i=()=>e.simParams(),s=this.section(t,"PRESETS"),n=this.btnRow(s),o=(u,x)=>this.button(n,u,()=>{M[x].apply(e),this.sync()});o("dendrite",1),o("snow",2),o("rain",3),o("casting",4);const c=this.section(t,"MELT · PROCESS");this.slider(c,"undercooling",.3,1,.01,()=>e.getUndercool(),u=>e.setUndercool(u)),this.slider(c,"cooling rate",0,.6,.005,()=>i().coolRate,u=>{i().coolRate=u}),this.slider(c,"nucleation /s",0,30,.5,()=>e.getRain(),u=>e.setRain(u),u=>u.toFixed(1));const r=this.btnRow(c);this.button(r,"seed",()=>e.seedCenter()),this.button(r,"chill wall",()=>e.chillWall());const d=this.button(r,"anneal ⌛",()=>{});d.addEventListener("pointerdown",()=>e.anneal(!0));for(const u of["pointerup","pointerleave","pointercancel"])d.addEventListener(u,()=>e.anneal(!1));this.button(r,"clear",()=>e.clearAll(),"warn");const p=this.section(t,"CRYSTAL");this.slider(p,"anisotropy δ",0,.08,.001,()=>i().delta,u=>{i().delta=u},u=>u.toFixed(3));const f=this.btnRow(p),m=(u,x)=>{const B=this.button(f,x,()=>{i().aniMode=u,this.sync()});return this.symBtns.push(B),B};m(4,"cubic ×4"),m(6,"hex ×6"),this.slider(p,"tip noise",0,.04,.001,()=>i().noiseAmp,u=>{i().noiseAmp=u},u=>u.toFixed(3)),this.slider(p,"latent heat K",.8,2.2,.01,()=>i().latent,u=>{i().latent=u});const v=this.section(t,"ENGINE");this.slider(v,"speed",1,60,1,()=>e.getSubsteps(),u=>e.setSpeed(u),u=>`${u.toFixed(0)}×`);const y=this.btnRow(v);this.runBtn=this.button(y,"pause",()=>{e.toggleRun(),this.sync()}),this.turboBtn=this.button(y,"turbo",()=>{e.toggleTurbo(),this.sync()});const P=this.btnRow(v);for(const u of[512,1024,2048]){const x=this.button(P,`${u}²`,()=>{e.setGrid(u),this.sync()});this.gridBtns.push(x)}}sync(){var i,s;for(const n of this.binds)n.update();this.viewBtns.forEach((n,o)=>n.classList.toggle("on",o===this.host.getView()));const t=this.host.simParams().aniMode;(i=this.symBtns[0])==null||i.classList.toggle("on",t===4),(s=this.symBtns[1])==null||s.classList.toggle("on",t===6),this.runBtn.textContent=this.host.isRunning()?"pause":"run",this.turboBtn.classList.toggle("on",this.host.isTurbo());const e=[512,1024,2048];this.gridBtns.forEach((n,o)=>n.classList.toggle("on",e[o]===this.host.getGrid())),document.getElementById("scalebar").style.display=this.host.getView()===2?"flex":"none"}setReadouts(t){this.readouts.innerHTML=t.map(([e,i])=>`<div>${e} <b>${i}</b></div>`).join("")}}class at{constructor(t){a(this,"root");a(this,"series",{fs:[],grains:[],dt:[]});a(this,"canvases",{});a(this,"histCtx");a(this,"cap",160);this.root=t,this.add("fs","FRACTION SOLID"),this.add("dt","INTERFACE ΔT"),this.add("grains","GRAINS"),this.addHist("GRAIN SIZE µm")}mkPanel(t){const e=document.createElement("div");e.className="spark";const i=document.createElement("div");i.className="t",i.textContent=t;const s=document.createElement("canvas");return s.width=110*devicePixelRatio,s.height=30*devicePixelRatio,s.style.width="110px",s.style.height="30px",e.append(i,s),this.root.append(e),s}add(t,e){const i=this.mkPanel(e);this.canvases[t]=i.getContext("2d")}addHist(t){const e=this.mkPanel(t);this.histCtx=e.getContext("2d")}reset(){for(const t of Object.keys(this.series))this.series[t]=[];this.drawAll(null)}push(t){this.series.fs.push(t.fracSolid),this.series.dt.push(Math.max(0,1-t.interfaceT)),this.series.grains.push(t.grainCount);for(const e of Object.keys(this.series))this.series[e].length>this.cap&&this.series[e].shift();this.drawAll(t)}drawAll(t){this.spark("fs","#ffb454",1),this.spark("dt","#56d4dd"),this.spark("grains","#b394e0"),this.hist((t==null?void 0:t.diamsUm)??[])}spark(t,e,i){const s=this.canvases[t],n=s.canvas.width,o=s.canvas.height,c=this.series[t];if(s.clearRect(0,0,n,o),c.length<2)return;const r=i??Math.max(...c,1e-9);s.strokeStyle=e,s.lineWidth=devicePixelRatio,s.beginPath(),c.forEach((d,p)=>{const f=p/(this.cap-1)*n,m=o-2-d/r*(o-5);p===0?s.moveTo(f,m):s.lineTo(f,m)}),s.stroke()}hist(t){const e=this.histCtx,i=e.canvas.width,s=e.canvas.height;if(e.clearRect(0,0,i,s),t.length<3)return;const n=14,o=Math.min(...t),c=Math.max(...t)+1e-9,r=new Array(n).fill(0);for(const f of t){const m=Math.min(n-1,Math.floor((f-o)/(c-o)*n));r[m]++}const d=Math.max(...r);e.fillStyle="#8aa1c0";const p=i/n;r.forEach((f,m)=>{const v=f/d*(s-4);e.fillRect(m*p+1,s-v,p-2,v)})}}class ${constructor(t,e=8,i=.8){a(this,"dim");a(this,"lambda");a(this,"mu");a(this,"mean");a(this,"sigma");a(this,"C");a(this,"ps");a(this,"pc");a(this,"weights");a(this,"mueff");a(this,"cs");a(this,"cc");a(this,"c1");a(this,"cmu");a(this,"damps");a(this,"pop",[]);this.dim=t,this.lambda=e,this.mu=Math.floor(e/2),this.mean=new Array(t).fill(0),this.sigma=i,this.C=new Array(t).fill(1),this.ps=new Array(t).fill(0),this.pc=new Array(t).fill(0);const s=Array.from({length:this.mu},(o,c)=>Math.log(this.mu+.5)-Math.log(c+1)),n=s.reduce((o,c)=>o+c,0);this.weights=s.map(o=>o/n),this.mueff=1/this.weights.reduce((o,c)=>o+c*c,0),this.cs=(this.mueff+2)/(t+this.mueff+5),this.cc=(4+this.mueff/t)/(t+4+2*this.mueff/t),this.c1=2/((t+1.3)**2+this.mueff),this.cmu=Math.min(1-this.c1,2*(this.mueff-2+1/this.mueff)/((t+2)**2+this.mueff)),this.damps=1+2*Math.max(0,Math.sqrt((this.mueff-1)/(t+1))-1)+this.cs}randn(){let t=0,e=0;for(;t===0;)t=Math.random();for(;e===0;)e=Math.random();return Math.sqrt(-2*Math.log(t))*Math.cos(2*Math.PI*e)}ask(){this.pop=[];for(let t=0;t<this.lambda;t++){const e=this.mean.map((i,s)=>i+this.sigma*Math.sqrt(this.C[s])*this.randn());this.pop.push(e)}return this.pop}tell(t){t.length!==this.pop.length&&console.warn("[cma] score/pop mismatch:",t.length,"vs",this.pop.length);const e=t.map((r,d)=>[r,d]).filter(r=>r[1]<this.pop.length).sort((r,d)=>r[0]-d[0]).map(r=>r[1]);if(e.length<this.mu)return;const i=this.mean.slice();this.mean=new Array(this.dim).fill(0);for(let r=0;r<this.mu;r++)for(let d=0;d<this.dim;d++)this.mean[d]+=this.weights[r]*this.pop[e[r]][d];const s=this.C.map(r=>1/Math.sqrt(r));for(let r=0;r<this.dim;r++){const d=(this.mean[r]-i[r])/this.sigma;this.ps[r]=(1-this.cs)*this.ps[r]+Math.sqrt(this.cs*(2-this.cs)*this.mueff)*s[r]*d}const n=Math.sqrt(this.ps.reduce((r,d)=>r+d*d,0)),o=Math.sqrt(this.dim)*(1-1/(4*this.dim)+1/(21*this.dim**2)),c=n/Math.sqrt(1-(1-this.cs)**2)/o<1.4+2/(this.dim+1)?1:0;for(let r=0;r<this.dim;r++){const d=(this.mean[r]-i[r])/this.sigma;this.pc[r]=(1-this.cc)*this.pc[r]+c*Math.sqrt(this.cc*(2-this.cc)*this.mueff)*d;let p=0;for(let f=0;f<this.mu;f++){const m=(this.pop[e[f]][r]-i[r])/this.sigma;p+=this.weights[f]*m*m}this.C[r]=(1-this.c1-this.cmu)*this.C[r]+this.c1*this.pc[r]*this.pc[r]+this.cmu*p,this.C[r]=Math.max(this.C[r],1e-8)}this.sigma*=Math.exp(this.cs/this.damps*(n/o-1)),this.sigma=Math.min(this.sigma,3)}}const rt=[[0,.5],[0,.5],[0,.5],[10,600],[.45,.95]],V=(l,t)=>{const[e,i]=rt[t];return e+(i-e)/(1+Math.exp(-l))},ot=256,U=9e3,_=300;class ct{constructor(t){a(this,"active",!1);a(this,"targetASTM",4);a(this,"cma",new $(5));a(this,"queue",[]);a(this,"scores",[]);a(this,"genome",null);a(this,"stepsUsed",0);a(this,"rainAcc",0);a(this,"polling",!1);a(this,"episode",0);a(this,"best",1/0);a(this,"bestASTM",null);a(this,"savedGrid",1024);a(this,"panel");a(this,"strip");a(this,"status");a(this,"finishing",!1);this.host=t}start(t){this.active||(this.active=!0,this.savedGrid=t,this.cma=new $(5),this.queue=[],this.scores=[],this.genome=null,this.episode=0,this.best=1/0,this.bestASTM=null,this.host.swapSim(ot),this.buildPanel())}stop(){var t;this.active&&(this.active=!1,(t=this.panel)==null||t.remove(),this.host.swapSim(this.savedGrid),this.host.onOptimizerDone())}buildPanel(){var o;(o=this.panel)==null||o.remove();const t=document.createElement("div");t.id="lab",t.style.cssText="position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(720px,86vw);background:rgba(15,17,21,0.93);border:1px solid #262b33;border-radius:8px;padding:10px 14px;backdrop-filter:blur(6px);z-index:6;";const e=document.createElement("div");e.style.cssText="display:flex;align-items:center;gap:12px;margin-bottom:8px;font-size:11px;",e.innerHTML=`<span style="letter-spacing:.2em;color:#56d4dd">LAB NOTEBOOK</span>
      <span>target ASTM <b style="color:#ffb454">G ${this.targetASTM}</b></span>
      <input id="labTarget" type="range" min="1" max="6" step="0.5" value="${this.targetASTM}" style="width:110px">
      <span id="labStatus" style="color:#6b7280;flex:1"></span>`;const i=document.createElement("button");i.textContent="stop",i.addEventListener("click",()=>this.stop()),e.append(i);const s=document.createElement("div");s.style.cssText="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;min-height:86px;align-items:flex-end;",t.append(e,s),document.getElementById("app").append(t),this.panel=t,this.strip=s,this.status=t.querySelector("#labStatus");const n=t.querySelector("#labTarget");n.addEventListener("input",()=>{this.targetASTM=parseFloat(n.value),e.querySelector("b").textContent=`G ${this.targetASTM}`}),this.status.textContent="casting #1 …"}beginEpisode(){this.queue.length===0&&(this.scores.length>0&&this.cma.tell(this.scores),this.queue=[...this.cma.ask()],this.scores=[]),this.genome=this.queue.shift(),this.stepsUsed=0,this.rainAcc=0,this.episode++;const t=this.genome.map(V),e=this.host.getSim();e.params.delta=.045,e.params.aniMode=4,e.params.noiseAmp=.012,e.params.latent=1.5,e.params.coolRate=t[0],e.reset(1-t[4])}async finishEpisode(){if(this.finishing||!this.genome)return;this.finishing=!0;const t=this.host.getSim();let e=null;for(let r=0;r<40&&!e;r++)e=await t.readStats(),e||await t.device.queue.onSubmittedWorkDone();let i=8,s=null;e&&e.astm!==null&&(s=e.astm,i=Math.abs(e.astm-this.targetASTM)+.15*(this.stepsUsed/U)),this.scores.push(i),i<this.best&&(this.best=i,this.bestASTM=s),this.host.renderOnce(2);const n=this.host.captureThumb(),o=document.createElement("div");o.style.cssText="flex:0 0 auto;text-align:center;font-size:9px;color:#6b7280;",n.style.cssText="width:64px;height:64px;border-radius:4px;border:1px solid "+(i===this.best?"#ffb454":"#262b33")+";display:block;";const c=document.createElement("div");c.textContent=s!==null?`G ${s.toFixed(1)}`:"—",i===this.best&&(c.style.color="#ffb454"),o.append(n,c),this.strip.append(o),this.strip.scrollLeft=this.strip.scrollWidth,this.status.textContent=`casting #${this.episode} done · best |ΔG| ${this.best===1/0?"—":this.best.toFixed(2)}`+(this.bestASTM!==null?` (G ${this.bestASTM.toFixed(1)})`:"")+` · σ ${this.cma.sigma.toFixed(2)}`,this.genome=null,this.finishing=!1}tick(){if(!this.active||this.finishing)return;if(!this.genome){this.beginEpisode();return}const t=this.host.getSim(),e=this.genome.map(V);for(this.rainAcc+=e[3]*_*t.params.dt;this.rainAcc>=1;)this.rainAcc-=1,t.addSeed(Math.random()*t.n,Math.random()*t.n,3);if(t.step(_),this.stepsUsed+=_,this.host.renderOnce(1),!this.polling){this.polling=!0;const i=this.episode;t.readStats().then(s=>{this.polling=!1,!(!s||!this.active||!this.genome||i!==this.episode)&&(t.params.coolRate=s.fracSolid<.33?e[0]:s.fracSolid<.66?e[1]:e[2],(s.fracSolid>.92||this.stepsUsed>=U)&&this.finishEpisode())})}this.stepsUsed>=U&&this.finishEpisode()}}const lt=150;async function ht(){const l=()=>{document.getElementById("gate").style.display="flex"};if(!navigator.gpu)return l();const t=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!t)return l();const e=await t.requestDevice();e.lost.then(h=>{h.reason!=="destroyed"&&l()});const i=document.getElementById("canvas");let s=new D(e,1024);const n=new et(e,i,s),o=new at(document.getElementById("hud"));let c=0,r=!0,d=14,p=!1,f=0,m=1,v=0,y=null,P=60;const u={clearMelt(h){m=h,s.reset(1-h),o.reset(),y=null},seedCenter(){s.addSeed(s.n/2,s.n/2,5),L()},chillWall(){s.chillWall(i.width>=i.height?"left":"bottom"),L()},setParams(h){Object.assign(s.params,h)},setRain(h){f=h},setView(h){c=h},setSpeed(h){d=h,p=!1},startOptimizer(){S.start(s.n)},syncUI(){x.sync()},simParams:()=>s.params,getUndercool:()=>m,setUndercool(h){m=h},getRain:()=>f,getSubsteps:()=>d,isRunning:()=>r,toggleRun(){r=!r},isTurbo:()=>p,toggleTurbo(){p=!p},getGrid:()=>s.n,setGrid(h){h!==s.n&&u.swapSim(h)},getView:()=>c,anneal(h){s.params.heatIn=h?1.1:0},clearAll(){s.reset(1-m),o.reset(),y=null},swapSim(h){const g={...s.params};return s=new D(e,h),s.params=g,s.reset(1-m),n.rebind(s),o.reset(),y=null,s},getSim:()=>s,renderOnce(h){n.render(s,h,performance.now()/1e3)},captureThumb(){const h=document.createElement("canvas");h.width=128,h.height=128;const g=Math.min(i.width,i.height);return h.getContext("2d").drawImage(i,(i.width-g)/2,(i.height-g)/2,g,g,0,0,128,128),h},onOptimizerDone(){x.sync()}},x=new nt(u),B=new st(u),S=new ct(u);window.__solidify={app:u,opt:S,tour:B,ui:x,tick(h){for(let g=0;g<h;g++)N(C+1e3/60)}};let A=!1,E={x:-1e9,y:-1e9};const L=()=>document.getElementById("hint").classList.add("gone"),k=h=>{const g=n.clientToGrid(h.clientX,h.clientY,s.n);if(!g)return;const b=s.n*.02;Math.hypot(g.x-E.x,g.y-E.y)<b||(E=g,s.addSeed(g.x,g.y,4),L())};i.addEventListener("pointerdown",h=>{S.active||(A=!0,k(h))}),i.addEventListener("pointermove",h=>{A&&!S.active&&k(h)});for(const h of["pointerup","pointercancel","pointerleave"])i.addEventListener(h,()=>{A=!1,E={x:-1e9,y:-1e9}});window.addEventListener("keydown",h=>{h.target instanceof HTMLInputElement||(h.code==="Space"&&(h.preventDefault(),u.toggleRun(),x.sync()),h.key>="1"&&h.key<="4"&&(u.setView(parseInt(h.key)-1),x.sync()))});function Y(){if(c!==2)return;const h=Math.max(i.width,i.height)/s.n/(i.width/i.clientWidth),g=H*1e3/s.n/h;let b=100,T=1/0;for(const F of[10,20,50,100,200,500]){const I=F/g,z=Math.abs(I-80);I>30&&I<160&&z<T&&(T=z,b=F)}document.querySelector("#scalebar .bar").style.width=`${b/g}px`,document.getElementById("scalelabel").textContent=`${b} µm`}let C=performance.now(),G=0;function q(h){try{N(h)}catch(g){console.error("[solidify] frame error:",g)}requestAnimationFrame(q)}function N(h){const g=Math.min(.1,(h-C)/1e3);if(C=h,P=P*.95+1/Math.max(g,1e-4)*.05,S.active)S.tick();else{if(r){for(v+=f*g;v>=1;)v-=1,s.addSeed(Math.random()*s.n,Math.random()*s.n,3.5);s.step(p?lt:d)}n.render(s,c,h/1e3)}if(G+=g,G>.25){G=0,s.readStats().then(T=>{T&&(y=T,S.active||o.push(T))});const b=y;x.setReadouts([["t",s.simTime.toFixed(3)],["solid",b?`${(b.fracSolid*100).toFixed(1)} %`:"—"],["grains",b?String(b.grainCount):"—"],["ASTM",(b==null?void 0:b.astm)!=null?`G ${b.astm.toFixed(1)}`:"—"],["ΔT int",b?(1-b.interfaceT).toFixed(3):"—"],["fps",`${P.toFixed(0)} · ${s.n}²`]]),Y()}}M[1].apply(u),x.sync(),requestAnimationFrame(q)}ht();
