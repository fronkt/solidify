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
import { latticeOf, deriveDragH, lbmBufferLayout } from "./flow";

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
// Planar SoA populations: 3 planes per buffer (each 12 * n * n bytes = 48 MiB at 2048^2)
//   fA: planes 0, 1, 2 at offsets 0, n^2, 2*n^2
//   fB: planes 3, 4, 5 at offsets 0, n^2, 2*n^2
//   fC: planes 6, 7, 8 at offsets 0, n^2, 2*n^2
@group(0) @binding(1) var<storage, read> fInA: array<f32>;
@group(0) @binding(2) var<storage, read> fInB: array<f32>;
@group(0) @binding(3) var<storage, read> fInC: array<f32>;
@group(0) @binding(4) var<storage, read_write> fOutA: array<f32>;
@group(0) @binding(5) var<storage, read_write> fOutB: array<f32>;
@group(0) @binding(6) var<storage, read_write> fOutC: array<f32>;
@group(0) @binding(7) var phiTex: texture_2d<f32>;
@group(0) @binding(8) var velOut: texture_storage_2d<rgba32float, write>;

// Paired TRT collision with Guo forcing split by parity for opposite pair (i, opp(i)):
//   ep = w * rho * (1 + 4.5 * cu^2 - 1.5 * u.u), em = 3 * w * rho * cu
//   sSym = w * (9 * cu * cF - 3 * uF),           sAnti = 3 * w * cF
fn trtPair(
  fi: f32, fo: f32, w: f32, cu: f32, cF: f32,
  rho: f32, uu: f32, uF: f32, wP: f32, wM: f32, sP: f32, sM: f32,
) -> vec2f {
  let wr = w * rho;
  let ep = wr * (1.0 + 4.5 * cu * cu - uu);
  let em = wr * (3.0 * cu);
  let fp = 0.5 * (fi + fo);
  let fm = 0.5 * (fi - fo);
  let sSym = w * (9.0 * cu * cF - 3.0 * uF);
  let sAnti = w * (3.0 * cF);
  let dS = -wP * (fp - ep) + sP * sSym;
  let dA = -wM * (fm - em) + sM * sAnti;
  return vec2f(fi + dS + dA, fo + dS - dA);
}

@compute @workgroup_size(16, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = L.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let x = gid.x;
  let y = gid.y;
  let n1 = n - 1u;
  let n2 = n * n;
  let n2x2 = 2u * n2;
  let row = y * n;
  let xm = select(x - 1u, n1, x == 0u);
  let xp = select(x + 1u, select(0u, n1, L.channel == 1u), x == n1);
  let westInlet = (L.channel == 1u && x == 0u);

  // Unrolled pull streaming from planar SoA buffers:
  //   0:(0,0)  1:(+1,0) 2:(0,+1) 3:(-1,0) 4:(0,-1) 5:(+1,+1) 6:(-1,+1) 7:(-1,-1) 8:(+1,-1)
  // Free-slip y mirrors: MY = (0, 1, 4, 3, 2, 8, 7, 6, 5).
  let f0 = fInA[row + x];
  var f1: f32;
  let f3 = fInB[row + xp];

  var f2: f32;
  var f5: f32;
  var f6: f32;
  if (y == 0u) {
    f2 = fInB[n2 + x];
    f5 = fInC[n2x2 + xm];
    f6 = fInC[n2 + xp];
  } else {
    let rowM = row - n;
    f2 = fInA[n2x2 + rowM + x];
    f5 = fInB[n2x2 + rowM + xm];
    f6 = fInC[rowM + xp];
  }

  var f4: f32;
  var f7: f32;
  var f8: f32;
  if (y == n1) {
    f4 = fInA[n2x2 + row + x];
    f7 = fInC[row + xp];
    f8 = fInB[n2x2 + row + xm];
  } else {
    let rowP = row + n;
    f4 = fInB[n2 + rowP + x];
    f7 = fInC[n2 + rowP + xp];
    f8 = fInC[n2x2 + rowP + xm];
  }

  // D3.5 Zou-He velocity inlet (or pre-D3.5 equilibrium inlet when L.inlet == 1):
  // of a west node's nine populations, the three with c_x = +1 (1, 5, 8) came
  // from outside. Rebuilt from the six known ones so sum f = rho and
  // sum c f = (rho U, 0). At the corners the free-slip mirror has already
  // supplied f2/f6 (y = 0) or f4/f7 (y = n - 1).
  if (westInlet) {
    if (L.inlet == 0u) {
      let r = (f0 + f2 + f4 + 2.0 * (f3 + f6 + f7)) / (1.0 - L.uIn);
      let j = r * L.uIn;
      let t = 0.5 * (f2 - f4);
      f1 = f3 + (2.0 / 3.0) * j;
      f5 = f7 - t + j * (1.0 / 6.0);
      f8 = f6 + t + j * (1.0 / 6.0);
    } else {
      let q = 1.0 + 3.0 * L.uIn + 3.0 * L.uIn * L.uIn;
      f1 = (1.0 / 9.0) * q;
      f5 = (1.0 / 36.0) * q;
      f8 = (1.0 / 36.0) * q;
    }
  } else {
    f1 = fInA[n2 + row + xm];
  }

  let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  let m = vec2f(
    f1 - f3 + f5 - f6 - f7 + f8,
    f2 - f4 + f5 + f6 - f7 - f8,
  );
  // implicit drag: F = -rho K u, so rho u = m + F/2 solves to u = m / (rho (1 + K/2))
  var K = 0.0;
  let xy = vec2i(i32(x), i32(y));
  if (L.phiOn == 1u) {
    let ph = clamp(textureLoad(phiTex, xy, 0).r, 0.0, 1.0);
    K = L.dragK * ph * ph;
  }
  let Fb = vec2f(L.fx, L.fy);
  let u = (m + 0.5 * Fb) / (rho * (1.0 + 0.5 * K));
  let F = Fb - rho * K * u;
  textureStore(velOut, xy, vec4f(u, rho, K));

  // Unrolled paired TRT collision with Guo forcing
  let wP = L.omegaP;
  let wM = L.omegaM;
  let sP = 1.0 - 0.5 * wP;
  let sM = 1.0 - 0.5 * wM;
  let uu = 1.5 * dot(u, u);
  let uF = dot(u, F);
  const W0 = 4.0 / 9.0;
  const W1 = 1.0 / 9.0;
  const W5 = 1.0 / 36.0;

  let o0 = f0 - wP * (f0 - W0 * rho * (1.0 - uu)) + sP * (W0 * (-3.0 * uF));
  let p13 = trtPair(f1, f3, W1, u.x, F.x, rho, uu, uF, wP, wM, sP, sM);
  let p24 = trtPair(f2, f4, W1, u.y, F.y, rho, uu, uF, wP, wM, sP, sM);
  let p57 = trtPair(f5, f7, W5, u.x + u.y, F.x + F.y, rho, uu, uF, wP, wM, sP, sM);
  let p68 = trtPair(f6, f8, W5, -u.x + u.y, -F.x + F.y, rho, uu, uF, wP, wM, sP, sM);

  let dst = row + x;
  fOutA[dst] = o0;
  fOutA[n2 + dst] = p13.x;
  fOutA[n2x2 + dst] = p24.x;
  fOutB[dst] = p13.y;
  fOutB[n2 + dst] = p24.y;
  fOutB[n2x2 + dst] = p57.x;
  fOutC[dst] = p68.x;
  fOutC[n2 + dst] = p57.y;
  fOutC[n2x2 + dst] = p68.y;
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
  private f: [GPUBuffer, GPUBuffer, GPUBuffer][];
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
    const layout = lbmBufferLayout(n);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.f = [0, 1].map(() => [
      device.createBuffer({ size: layout.sizesBytes[0], usage }),
      device.createBuffer({ size: layout.sizesBytes[1], usage }),
      device.createBuffer({ size: layout.sizesBytes[2], usage }),
    ]);
    this.ubuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.velTex = device.createTexture({ size: [n, n], format: "rgba32float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    this.dummyPhi = device.createTexture({ size: [1, 1], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.init((x, y) => [cfg.channel ? cfg.uIn : 0, 0]);
  }

  /** the drag's phase field (the solver's state texture: phi in .r), or null */
  setPhi(tex: GPUTexture | null) { this.phi = tex; this.bgs.clear(); }

  /** equilibrium populations at rho = 1 and the given velocity field (planar SoA: 3 planes per buffer) */
  init(vel: (x: number, y: number) => [number, number]) {
    const n = this.n, cells = n * n, cells2 = 2 * cells;
    const w0 = 4 / 9, w1 = 1 / 9, w5 = 1 / 36;
    const a = new Float32Array(cells * 3);
    const b = new Float32Array(cells * 3);
    const c = new Float32Array(cells * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const [ux, uy] = vel(x, y);
      const uu = 1.5 * (ux * ux + uy * uy);
      const base = 1 - uu;
      const c5 = ux + uy, c6 = -ux + uy;
      const idx = y * n + x;
      // fA: planes 0, 1, 2
      a[idx] = w0 * base;
      a[cells + idx] = w1 * (base + 3 * ux + 4.5 * ux * ux);
      a[cells2 + idx] = w1 * (base + 3 * uy + 4.5 * uy * uy);
      // fB: planes 3, 4, 5
      b[idx] = w1 * (base - 3 * ux + 4.5 * ux * ux);
      b[cells + idx] = w1 * (base - 3 * uy + 4.5 * uy * uy);
      b[cells2 + idx] = w5 * (base + 3 * c5 + 4.5 * c5 * c5);
      // fC: planes 6, 7, 8
      c[idx] = w5 * (base + 3 * c6 + 4.5 * c6 * c6);
      c[cells + idx] = w5 * (base - 3 * c5 + 4.5 * c5 * c5);
      c[cells2 + idx] = w5 * (base - 3 * c6 + 4.5 * c6 * c6);
    }
    for (const set of this.f) {
      this.device.queue.writeBuffer(set[0], 0, a);
      this.device.queue.writeBuffer(set[1], 0, b);
      this.device.queue.writeBuffer(set[2], 0, c);
    }
    this.cur = 0;
    this.steps = 0;
  }

  /** replace the configuration (viscosity, inlet, drag width); populations kept */
  configure(cfg: FlowConfig) { this.cfg = cfg; }

  /** write the uniform once before encoding steps into a caller's pass, with
   *  the drag read from the phase field the caller binds (encodeStep) */
  prepare() { this.writeParams(true); }

  private bgsByPhi = new WeakMap<GPUTexture, GPUBindGroup[]>();

  private makeBindGroup(dir: number, phiView: GPUTextureView): GPUBindGroup {
    const src = this.f[dir], dst = this.f[1 - dir];
    return this.device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 1, resource: { buffer: src[0] } },
        { binding: 2, resource: { buffer: src[1] } },
        { binding: 3, resource: { buffer: src[2] } },
        { binding: 4, resource: { buffer: dst[0] } },
        { binding: 5, resource: { buffer: dst[1] } },
        { binding: 6, resource: { buffer: dst[2] } },
        { binding: 7, resource: phiView },
        { binding: 8, resource: this.velTex.createView() },
      ],
    });
  }

  /**
   * One lattice step inside the CALLER's compute pass, the drag reading
   * `phiTex` (the solver's current state texture, phi in .r). The phase-field
   * step encodes this before its flux pass each substep (sim.ts submit), so
   * transport in the same substep reads this step's velocity.
   */
  encodeStep(pass: GPUComputePassEncoder, phiTex: GPUTexture) {
    let groups = this.bgsByPhi.get(phiTex);
    if (!groups) {
      const phiView = phiTex.createView();
      groups = [0, 1].map(dir => this.makeBindGroup(dir, phiView));
      this.bgsByPhi.set(phiTex, groups);
    }
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, groups[this.cur]);
    pass.dispatchWorkgroups(Math.ceil(this.n / 16), Math.ceil(this.n / 8));
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
      g = this.makeBindGroup(dir, (this.phi ?? this.dummyPhi).createView());
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
    const gx = Math.ceil(this.n / 16), gy = Math.ceil(this.n / 8);
    for (let i = 0; i < k; i++) {
      pass.setBindGroup(0, this.bg(this.cur));
      pass.dispatchWorkgroups(gx, gy);
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
    for (const set of this.f) for (const b of set) b.destroy();
    this.ubuf.destroy();
    this.velTex.destroy();
    this.dummyPhi.destroy();
  }
}
