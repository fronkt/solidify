/**
 * D3.1: a standalone D2Q9 lattice Boltzmann melt-flow solver.
 *
 * Design: docs/D3-CONVECTION-DESIGN.md. Two-relaxation-time collision
 * (Ginzburg, Verhaeghe & d'Humieres 2008) with the "magic" product
 * Lambda = 1/4, Guo forcing (Guo, Zheng & Shi 2002), and the solid entering as
 * Beckermann's diffuse-interface drag on the superficial velocity, treated
 * implicitly: with F = -K u and K = 2 h nu phi^2 / W^2,
 *   u = (sum c_i f_i) / (rho (1 + K/2)).
 *
 * It owns its populations and a cell-centred velocity texture and READS a
 * phase-field texture for the drag; it writes nothing the phase field reads.
 * Coupling into transport is D3.2. Boundaries: x is either periodic (the
 * analytic gates) or a channel (equilibrium inlet at x = 0 with velocity
 * (U, 0), zero-gradient outlet at x = n - 1); y walls are free-slip, matching
 * the phase field's clamped edges. Units are lattice units: dx = dt = 1.
 */

import { shaderModule } from "./shaders";
import { latticeOf, deriveDragH } from "./flow";

/** the TRT magic product (tau+ - 1/2)(tau- - 1/2) */
export const TRT_LAMBDA = 0.25;

const LBM_WGSL = /* wgsl */ `
struct LP {
  n: u32,
  channel: u32,     // 0 = periodic x; 1 = inlet at x = 0, outlet at x = n - 1
  phiOn: u32,       // 1: read phi for the drag
  _a: u32,
  omegaP: f32,      // 1 / tau+
  omegaM: f32,      // 1 / tau-
  uIn: f32,         // inlet speed, lattice units
  dragK: f32,       // 2 h nu / W^2, multiplied by phi^2 per cell
  fx: f32,          // uniform body force (analytic gates)
  fy: f32,
  _b: f32,
  _c: f32,
}
@group(0) @binding(0) var<uniform> L: LP;
@group(0) @binding(1) var<storage, read> fIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> fOut: array<f32>;
@group(0) @binding(3) var phiTex: texture_2d<f32>;
@group(0) @binding(4) var velOut: texture_storage_2d<rgba32float, write>;

const CX = array<i32, 9>(0, 1, 0, -1, 0, 1, -1, -1, 1);
const CY = array<i32, 9>(0, 0, 1, 0, -1, 1, 1, -1, -1);
const W = array<f32, 9>(4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
                        1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);
const OPP = array<u32, 9>(0u, 3u, 4u, 1u, 2u, 7u, 8u, 5u, 6u);
// the population with its y velocity reversed (free-slip mirror)
const MY = array<u32, 9>(0u, 1u, 4u, 3u, 2u, 8u, 7u, 6u, 5u);

fn feq(i: u32, rho: f32, u: vec2f) -> f32 {
  let cu = f32(CX[i]) * u.x + f32(CY[i]) * u.y;
  return W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * dot(u, u));
}

fn at(x: i32, y: i32, i: u32) -> f32 {
  return fIn[(u32(y) * L.n + u32(x)) * 9u + i];
}

// pull streaming: population i at (x, y) arrives from (x - cx, y - cy)
fn pull(x: i32, y: i32, i: u32) -> f32 {
  let n = i32(L.n);
  var sx = x - CX[i];
  var sy = y - CY[i];
  var j = i;
  // free-slip walls in y: a population that would come from outside is the
  // mirror population of the cell it would have crossed
  if (sy < 0 || sy >= n) { sy = y; j = MY[i]; }
  if (L.channel == 0u) {
    sx = (sx + n) % n;
  } else if (sx < 0) {
    return feq(i, 1.0, vec2f(L.uIn, 0.0));     // equilibrium inlet
  } else if (sx >= n) {
    sx = n - 1;                                // zero-gradient outlet
  }
  return at(sx, sy, j);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= L.n || gid.y >= L.n) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  var f: array<f32, 9>;
  var rho = 0.0;
  var m = vec2f(0.0);
  for (var i = 0u; i < 9u; i++) {
    f[i] = pull(x, y, i);
    rho += f[i];
    m += vec2f(f32(CX[i]), f32(CY[i])) * f[i];
  }
  // implicit drag: F = -rho K u, so rho u = m + F/2 solves to u = m / (rho (1 + K/2))
  var K = 0.0;
  if (L.phiOn == 1u) {
    let ph = clamp(textureLoad(phiTex, vec2i(x, y), 0).r, 0.0, 1.0);
    K = L.dragK * ph * ph;
  }
  let Fb = vec2f(L.fx, L.fy);
  let u = (m + 0.5 * Fb) / (rho * (1.0 + 0.5 * K));
  let F = Fb - rho * K * u;
  textureStore(velOut, vec2i(x, y), vec4f(u, rho, K));
  // TRT collision with Guo's source split by parity
  for (var i = 0u; i < 9u; i++) {
    let o = OPP[i];
    let eq = feq(i, rho, u);
    let eo = feq(o, rho, u);
    let fp = 0.5 * (f[i] + f[o]);
    let fm = 0.5 * (f[i] - f[o]);
    let ep = 0.5 * (eq + eo);
    let em = 0.5 * (eq - eo);
    let c = vec2f(f32(CX[i]), f32(CY[i]));
    let cu = dot(c, u);
    let sAnti = W[i] * 3.0 * dot(c, F);
    let sSym = W[i] * (9.0 * cu * dot(c, F) - 3.0 * dot(u, F));
    fOut[(gid.y * L.n + gid.x) * 9u + i] = f[i] - L.omegaP * (fp - ep) - L.omegaM * (fm - em)
      + (1.0 - 0.5 * L.omegaM) * sAnti + (1.0 - 0.5 * L.omegaP) * sSym;
  }
}
`;

export interface FlowConfig {
  /** kinematic viscosity, lattice units */
  nu: number;
  /** inlet speed (channel) in lattice units */
  uIn: number;
  channel: boolean;
  /** interface width W in cells for the drag (0 = no solid) */
  width: number;
  /** drag constant h (defaults to the derived one) */
  h?: number;
  /** a uniform body force, lattice units (analytic gates) */
  force?: [number, number];
}

/** tau+ and tau- for a viscosity at the TRT magic product */
export function trtTaus(nu: number): { tauP: number; tauM: number } {
  const tauP = 0.5 + 3 * nu;
  return { tauP, tauM: 0.5 + TRT_LAMBDA / (tauP - 0.5) };
}

export class FlowSolver {
  readonly n: number;
  private device: GPUDevice;
  private pipe: GPUComputePipeline;
  private f: GPUBuffer[];
  private ubuf: GPUBuffer;
  readonly velTex: GPUTexture;
  private dummyPhi: GPUTexture;
  private bgs = new Map<string, GPUBindGroup>();
  private cur = 0;
  private cfg: FlowConfig;
  private phi: GPUTexture | null = null;
  steps = 0;
  private hCache: number | null = null;

  constructor(device: GPUDevice, n: number, cfg: FlowConfig) {
    this.device = device;
    this.n = n;
    this.cfg = cfg;
    this.pipe = device.createComputePipeline({
      layout: "auto", compute: { module: shaderModule(device, LBM_WGSL, "lbm2d"), entryPoint: "main" },
    });
    const bytes = n * n * 9 * 4;
    this.f = [0, 1].map(() => device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }));
    this.ubuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.velTex = device.createTexture({ size: [n, n], format: "rgba32float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    this.dummyPhi = device.createTexture({ size: [1, 1], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.init((x, y) => [cfg.channel ? cfg.uIn : 0, 0]);
  }

  /** the drag's phase field (the solver's state texture: phi in .r), or null */
  setPhi(tex: GPUTexture | null) { this.phi = tex; this.bgs.clear(); }

  /** equilibrium populations at rho = 1 and the given velocity field */
  init(vel: (x: number, y: number) => [number, number]) {
    const n = this.n, w = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
    const cx = [0, 1, 0, -1, 0, 1, -1, -1, 1], cy = [0, 0, 1, 0, -1, 1, 1, -1, -1];
    const a = new Float32Array(n * n * 9);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const [ux, uy] = vel(x, y), uu = ux * ux + uy * uy;
      for (let i = 0; i < 9; i++) {
        const cu = cx[i] * ux + cy[i] * uy;
        a[(y * n + x) * 9 + i] = w[i] * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * uu);
      }
    }
    for (const b of this.f) this.device.queue.writeBuffer(b, 0, a);
    this.cur = 0;
    this.steps = 0;
  }

  private writeParams() {
    const c = this.cfg, n = this.n;
    const { tauP, tauM } = trtTaus(c.nu);
    const h = c.h ?? (this.hCache ??= deriveDragH());
    const buf = new ArrayBuffer(48), u = new Uint32Array(buf), f = new Float32Array(buf);
    u[0] = n; u[1] = c.channel ? 1 : 0; u[2] = this.phi && c.width > 0 ? 1 : 0;
    f[4] = 1 / tauP; f[5] = 1 / tauM; f[6] = c.uIn;
    f[7] = c.width > 0 ? (2 * h * c.nu) / (c.width * c.width) : 0;
    f[8] = c.force?.[0] ?? 0; f[9] = c.force?.[1] ?? 0;
    this.device.queue.writeBuffer(this.ubuf, 0, buf);
  }

  private bg(dir: number): GPUBindGroup {
    const key = `${dir}`;
    let g = this.bgs.get(key);
    if (!g) {
      g = this.device.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubuf } },
          { binding: 1, resource: { buffer: this.f[dir] } },
          { binding: 2, resource: { buffer: this.f[1 - dir] } },
          { binding: 3, resource: (this.phi ?? this.dummyPhi).createView() },
          { binding: 4, resource: this.velTex.createView() },
        ],
      });
      this.bgs.set(key, g);
    }
    return g;
  }

  /** advance `k` lattice steps in one submit */
  step(k: number) {
    this.writeParams();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    const g = Math.ceil(this.n / 8);
    for (let i = 0; i < k; i++) {
      pass.setBindGroup(0, this.bg(this.cur));
      pass.dispatchWorkgroups(g, g);
      this.cur = 1 - this.cur;
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.steps += k;
  }

  /** the cell-centred velocity field (u.x, u.y, rho, K) as of the last step */
  async readVelocity(): Promise<Float32Array> {
    const n = this.n, bpr = n * 16;
    const buf = this.device.createBuffer({ size: bpr * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.velTex }, { buffer: buf, bytesPerRow: bpr }, [n, n]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    return out;
  }

  /** the lattice numbers this solver runs at (flow.ts latticeOf, d = 1/3 nominal) */
  lattice() { return latticeOf(this.cfg.nu / 1, 1, this.cfg.uIn); }

  destroy() {
    for (const b of this.f) b.destroy();
    this.ubuf.destroy();
    this.velTex.destroy();
    this.dummyPhi.destroy();
  }
}
