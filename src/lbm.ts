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
 * analytic gates) or a channel (a Zou-He velocity inlet at x = 0 that gives
 * every inlet node the velocity (U, 0), D3.5; zero-gradient outlet at
 * x = n - 1); y walls are free-slip, matching the phase field's clamped edges.
 * Units are lattice units: dx = dt = 1.
 *
 * D3.5: until 3b3fbdd the inlet was an equilibrium inlet (the populations
 * entering at x = 0 were feq at rho = 1 and (U, 0)). It fixed the density of
 * what entered as well as its velocity, so any overpressure in the channel (a
 * crystal's back-pressure, or the density level the zero-gradient outlet
 * leaves free) cut the delivered speed: 0.82 U at n 848 in the D3.4 study. It
 * stays selectable as FlowConfig.inlet = "equilibrium" for the must-miss arms of
 * the D3.5 gates only; the app never sets it. Design:
 * docs/D3-CONVECTION-DESIGN.md, "D3.5 addendum"; CPU reference:
 * scripts/fixtures/lbm-ref.mjs.
 */

import { shaderModule } from "./shaders";
import { latticeOf, deriveDragH } from "./flow";

/** the TRT magic product (tau+ - 1/2)(tau- - 1/2) */
export const TRT_LAMBDA = 0.25;

export const LBM_WGSL = /* wgsl */ `
struct LP {
  n: u32,
  channel: u32,     // 0 = periodic x; 1 = inlet at x = 0, outlet at x = n - 1
  phiOn: u32,       // 1: read phi for the drag
  inlet: u32,       // 0 = Zou-He velocity inlet; 1 = the pre-D3.5 equilibrium inlet (test harness only)
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
    // west inlet: the equilibrium populations of the pre-D3.5 inlet; with the
    // velocity inlet (L.inlet == 0) main() replaces these three
    return feq(i, 1.0, vec2f(L.uIn, 0.0));
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
  for (var i = 0u; i < 9u; i++) { f[i] = pull(x, y, i); }
  // D3.5 Zou-He velocity inlet: of a west node's nine populations, the three
  // with c_x = +1 (1, 5, 8) came from outside. They are rebuilt from the six
  // known ones so that sum f = rho and sum c f = (rho U, 0): rho from
  // rho (1 - U) = f0 + f2 + f4 + 2 (f3 + f6 + f7), the normal pair by
  // non-equilibrium bounce-back, the diagonals with the transverse correction.
  // At the corners the free-slip mirror has already supplied f2/f6 (y = 0) or
  // f4/f7 (y = n - 1). The node then collides like any other.
  if (L.channel == 1u && x == 0 && L.inlet == 0u) {
    let r = (f[0] + f[2] + f[4] + 2.0 * (f[3] + f[6] + f[7])) / (1.0 - L.uIn);
    let j = r * L.uIn;
    let t = 0.5 * (f[2] - f[4]);
    f[1] = f[3] + (2.0 / 3.0) * j;
    f[5] = f[7] - t + j / 6.0;
    f[8] = f[6] + t + j / 6.0;
  }
  var rho = 0.0;
  var m = vec2f(0.0);
  for (var i = 0u; i < 9u; i++) {
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
  /**
   * The west inlet of a channel. "velocity" (the default, and the only one the
   * app runs) is the D3.5 Zou-He inlet. "equilibrium" is the inlet that shipped
   * before D3.5, kept ONLY for the must-miss arms of the D3.5 gates
   * (verify-flow-gpu.mjs); no app path may set it (FLOW-INLET-DEFAULT).
   */
  inlet?: "velocity" | "equilibrium";
}

/**
 * The lattice uniform (struct LP in LBM_WGSL), 48 bytes. Pure, so the packing
 * and its default inlet are checked without a GPU (verify-flow.mjs
 * FLOW-INLET-DEFAULT). `phiOn`: a phase field is bound for the drag.
 */
export function lbmUniform(n: number, c: FlowConfig, phiOn: boolean, h: number): ArrayBuffer {
  const { tauP, tauM } = trtTaus(c.nu);
  const buf = new ArrayBuffer(48), u = new Uint32Array(buf), f = new Float32Array(buf);
  u[0] = n; u[1] = c.channel ? 1 : 0; u[2] = phiOn && c.width > 0 ? 1 : 0;
  u[3] = c.inlet === "equilibrium" ? 1 : 0;
  f[4] = 1 / tauP; f[5] = 1 / tauM; f[6] = c.uIn;
  f[7] = c.width > 0 ? (2 * h * c.nu) / (c.width * c.width) : 0;
  f[8] = c.force?.[0] ?? 0; f[9] = c.force?.[1] ?? 0;
  return buf;
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

  /** replace the configuration (viscosity, inlet, drag width); populations kept */
  configure(cfg: FlowConfig) { this.cfg = cfg; }

  /** write the uniform once before encoding steps into a caller's pass, with
   *  the drag read from the phase field the caller binds (encodeStep) */
  prepare() { this.writeParams(true); }

  private bgsByPhi = new WeakMap<GPUTexture, GPUBindGroup[]>();

  /**
   * One lattice step inside the CALLER's compute pass, the drag reading
   * `phiTex` (the solver's current state texture, phi in .r). The phase-field
   * step encodes this before its flux pass each substep (sim.ts submit), so
   * transport in the same substep reads this step's velocity.
   */
  encodeStep(pass: GPUComputePassEncoder, phiTex: GPUTexture) {
    let groups = this.bgsByPhi.get(phiTex);
    if (!groups) {
      groups = [0, 1].map(dir => this.device.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubuf } },
          { binding: 1, resource: { buffer: this.f[dir] } },
          { binding: 2, resource: { buffer: this.f[1 - dir] } },
          { binding: 3, resource: phiTex.createView() },
          { binding: 4, resource: this.velTex.createView() },
        ],
      }));
      this.bgsByPhi.set(phiTex, groups);
    }
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, groups[this.cur]);
    const g = Math.ceil(this.n / 8);
    pass.dispatchWorkgroups(g, g);
    this.cur = 1 - this.cur;
    this.steps++;
  }

  private writeParams(phiBound = false) {
    const c = this.cfg;
    const h = c.h ?? (this.hCache ??= deriveDragH());
    this.device.queue.writeBuffer(this.ubuf, 0, lbmUniform(this.n, c, !!(phiBound || this.phi), h));
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
