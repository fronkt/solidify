// TRUE-3D simulation core: the Kobayashi model on an n³ voxel grid.
// Mirrors the 2D Simulation class (sim.ts) — same ping-pong / busy-guard /
// stats-reduction structure — with 3D textures, per-grain quaternion
// orientations, and an out-of-memory creation ladder for weaker GPUs.

import {
  FLUX3D_WGSL, update3dWgsl, STAMP3D_WGSL, STATS3D_WGSL, FEED3D_WGSL, STEREO3D_WGSL,
  MAX_GRAINS3, MAX_SEEDS3, SEED3_STRIDE, P3, PORE_ID,
} from "./shaders3d";
import { DOMAIN_MM } from "./sim";

export interface Phys3DParams {
  dx: number;
  dt: number;
  epsBar: number;
  delta: number;
  deltaZ: number;     // hex: c-axis penalty (plates)
  aniMode3: number;   // 0 isotropic, 1 cubic, 2 hex, 3 icosahedral
  tau: number;
  alpha: number;
  gamma: number;
  latent: number;
  noiseAmp: number;
  tFar: number;
  coolRate: number;
  heatIn: number;
  meltGlow: number;   // display-only, carried from the material
  pPore: number;      // shrinkage-pore hash gate at the thin-remnant stage (0 = off)
  scen: number;       // 0 free · 1 bridgman · 2 weld · 3 grain selector
  gradG: number;      // bridgman gradient along z
  pullV: number;      // bridgman pull speed (units of frontZ per sim-time)
  weldX: number;      // laser position on the top face (voxels)
  weldY: number;
  weldPow: number;
  weldSig: number;
  alloyOn: number;    // 1 = solute field active (textures lazily allocated)
  c0: number;
  mLiq: number;
  kPart: number;
  dSol: number;
  twinProb: number;   // stochastic growth-twin rate at the claim front
  facet: number;      // >0.5 = cusped {100} interface energy
}

export const DEFAULTS3D: Phys3DParams = {
  dx: 0.03,
  dt: 9e-5,          // 3D explicit T-limit is dx²/6 — keep the 2D safety margin
  epsBar: 0.01,
  delta: 0.04,
  deltaZ: 0.03,
  aniMode3: 1,
  tau: 3.0e-4,
  alpha: 0.9,
  gamma: 10.0,
  latent: 1.6,
  noiseAmp: 0.01,
  tFar: 0.0,
  coolRate: 0.0,
  heatIn: 0.0,
  meltGlow: 1.0,
  pPore: 0.85,
  scen: 0,
  gradG: 0.08,
  pullV: 1.5,
  weldX: 0,
  weldY: 0,
  weldPow: 700,
  weldSig: 4,
  alloyOn: 0,
  c0: 0.3,
  mLiq: 0.45,
  kPart: 0.2,
  dSol: 0.8,
  twinProb: 0,
  facet: 0,
};

export interface StatsResult3D {
  fracSolid: number;
  grainCount: number;
  meanVolVox: number;
  eqDiamUm: number | null;   // volume-equivalent sphere diameter
  poreFrac: number;          // shrinkage-porosity volume fraction
  interfaceT: number;        // mean T over the diffuse interface band
  probeT: number | null;     // cooling-curve probe readings (null when off)
  probePhi: number | null;
  grains: { id: number; vox: number }[];   // retained for IPF / histogram panels
}

interface Seed3 { x: number; y: number; z: number; r: number; id: number; tact: number }

export class Sim3D {
  readonly device: GPUDevice;
  n: number;
  params: Phys3DParams;
  frame = 0;
  simTime = 0;
  dir = 0;
  nextId = 1;
  /** last stamped seed centre — exposed for the headless tap-placement test */
  lastSeed: { x: number; y: number; z: number } | null = null;
  /** cooling-curve probe voxel (null = off) — rides the stats reduction */
  probe: { x: number; y: number; z: number } | null = null;
  /** bridgman/selector: z of the pulled reference isotherm (advances in step) */
  frontZ = 1;

  private stateTex: GPUTexture[] = [];
  private grainTex: GPUTexture[] = [];
  private fluxTex!: GPUTexture;
  private ageTex!: GPUTexture;   // rg32float: r = freeze time, g = Niyama at freeze
  private fedTex: GPUTexture[] = [];   // r32uint generation-stamped feed flood
  /** feed-flood generation counter (advances every 2n SUBSTEPS; test-visible) */
  feedGen = 2;
  private subAcc = 0;
  private paramBuf!: GPUBuffer;
  private quatBuf!: GPUBuffer;
  private quatStaging!: GPUBuffer;
  private twinCtrBuf!: GPUBuffer;
  private quatsInFlight = false;
  private seedBuf!: GPUBuffer;
  private statsBuf!: GPUBuffer;
  private statsStaging!: GPUBuffer;
  private quatCPU = new Float32Array(MAX_GRAINS3 * 4);

  private fluxPipe!: GPUComputePipeline;
  private updatePipe!: GPUComputePipeline;
  private updateAlloyPipe: GPUComputePipeline | null = null;
  private updateAlloyBG: GPUBindGroup[] = [];
  private soluteTex: GPUTexture[] = [];
  private maskTex!: GPUTexture;   // r8uint mold walls (always n³ — 7 MB @192³)
  private maskReady = false;
  private stampPipe!: GPUComputePipeline;
  private statsPipe!: GPUComputePipeline;
  private feedPipe!: GPUComputePipeline;
  private stereoPipe!: GPUComputePipeline;
  private fluxBG: GPUBindGroup[] = [];
  private updateBG: GPUBindGroup[] = [];
  private stampBG: GPUBindGroup[] = [];
  private statsBG: GPUBindGroup[] = [];
  private feedBG: GPUBindGroup[][] = [];   // [stateDir][pingpong]
  private stereoBG: GPUBindGroup[] = [];
  private stereoBuf!: GPUBuffer;
  private stereoStaging!: GPUBuffer;
  private stereoParamBuf!: GPUBuffer;
  private stereoInFlight = false;

  private pendingSeeds: Seed3[] = [];
  private pendingQuench = 0;
  private statsInFlight = false;
  private paramData = new ArrayBuffer(P3.BYTES);
  private inFlight = 0;

  /** true when the GPU is >= 2 submitted frames behind — callers should skip stepping */
  get busy() { return this.inFlight >= 2; }

  private constructor(device: GPUDevice, n: number) {
    this.device = device;
    this.n = n;
    this.params = { ...DEFAULTS3D };
  }

  /**
   * Create at grid n, falling back down the ladder on out-of-memory
   * (192³ ≈ 283 MB of VRAM; 128³ ≈ 84 MB). Resolves null if even the
   * smallest rung fails.
   */
  static async create(device: GPUDevice, n: number): Promise<Sim3D | null> {
    // 96 is the landing-demo size and the last-chance rung for tight GPUs
    const ladder = [192, 160, 128, 96].filter(v => v <= n);
    if (!ladder.length) ladder.push(96);
    for (const rung of ladder) {
      const sim = new Sim3D(device, rung);
      device.pushErrorScope("out-of-memory");
      sim.build();
      const err = await device.popErrorScope();
      if (!err) {
        sim.reset(sim.params.tFar);
        return sim;
      }
      sim.destroy();
    }
    return null;
  }

  stateTexture(dir: number) { return this.stateTex[dir]; }
  grainTexture(dir: number) { return this.grainTex[dir]; }
  get quatBuffer() { return this.quatBuf; }
  get ageTexture() { return this.ageTex; }

  private build() {
    const d = this.device;
    const n = this.n;
    const texDesc = (format: GPUTextureFormat): GPUTextureDescriptor => ({
      size: [n, n, n],
      dimension: "3d",
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    this.stateTex = [d.createTexture(texDesc("rg32float")), d.createTexture(texDesc("rg32float"))];
    this.grainTex = [d.createTexture(texDesc("r32uint")), d.createTexture(texDesc("r32uint"))];
    this.fluxTex = d.createTexture(texDesc("rgba32float"));
    this.ageTex = d.createTexture(texDesc("rg32float"));
    this.fedTex = [d.createTexture(texDesc("r32uint")), d.createTexture(texDesc("r32uint"))];
    // mold-wall mask: always allocated (n³ bytes ≈ 1.7% of the budget) so no
    // bind group ever needs rebuilding when the selector scenario toggles
    this.maskTex = d.createTexture({
      size: [n, n, n], dimension: "3d", format: "r8uint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    d.queue.writeTexture(
      { texture: this.maskTex }, new Uint8Array(n * n * n),
      { bytesPerRow: n, rowsPerImage: n }, [n, n, n]);

    this.paramBuf = d.createBuffer({ size: P3.BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.quatBuf = d.createBuffer({ size: MAX_GRAINS3 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.quatStaging = d.createBuffer({ size: MAX_GRAINS3 * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.twinCtrBuf = d.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.seedBuf = d.createBuffer({ size: MAX_SEEDS3 * SEED3_STRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const statsSize = (8 + MAX_GRAINS3) * 4;
    this.statsBuf = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.statsStaging = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.stereoBuf = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.stereoStaging = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    // the stereology pass gets its OWN uniform buffer: sharing paramBuf let a
    // concurrent step()'s writeParams zero the plane before the dispatch ran
    // (full-box census race — a section suddenly counting whole grains)
    this.stereoParamBuf = d.createBuffer({ size: P3.BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const mk = (code: string) =>
      d.createComputePipeline({ layout: "auto", compute: { module: d.createShaderModule({ code }), entryPoint: "main" } });
    this.fluxPipe = mk(FLUX3D_WGSL);
    this.updatePipe = mk(update3dWgsl(false));
    // the alloy variant compiles up front (no VRAM cost) so toggling never
    // hitches; its bind groups are built only when the solute pair exists
    if (d.limits.maxStorageTexturesPerShaderStage >= 4)
      this.updateAlloyPipe = mk(update3dWgsl(true));
    this.stampPipe = mk(STAMP3D_WGSL);
    this.statsPipe = mk(STATS3D_WGSL);
    this.feedPipe = mk(FEED3D_WGSL);
    this.stereoPipe = mk(STEREO3D_WGSL);

    for (const dir of [0, 1]) {
      const s = this.stateTex[dir].createView();
      const g = this.grainTex[dir].createView();
      const so = this.stateTex[1 - dir].createView();
      const go = this.grainTex[1 - dir].createView();
      this.fluxBG[dir] = d.createBindGroup({
        layout: this.fluxPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: g },
          { binding: 3, resource: { buffer: this.quatBuf } },
          { binding: 4, resource: this.fluxTex.createView() },
        ],
      });
      this.updateBG[dir] = d.createBindGroup({
        layout: this.updatePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: g },
          { binding: 3, resource: this.fluxTex.createView() },
          { binding: 4, resource: so },
          { binding: 5, resource: go },
          { binding: 6, resource: this.ageTex.createView() },
          { binding: 7, resource: this.fedTex[0].createView() },
          { binding: 10, resource: { buffer: this.quatBuf } },
          { binding: 11, resource: { buffer: this.twinCtrBuf } },
          { binding: 12, resource: this.maskTex.createView() },
        ],
      });
      // feed flood: 4 iterations/frame, even count → data always lands in fedTex[0]
      this.feedBG[dir] = [0, 1].map(pp => d.createBindGroup({
        layout: this.feedPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: this.fedTex[pp].createView() },
          { binding: 3, resource: this.fedTex[1 - pp].createView() },
        ],
      }));
      this.stampBG[dir] = d.createBindGroup({
        layout: this.stampPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: g },
          { binding: 3, resource: { buffer: this.seedBuf } },
          { binding: 4, resource: so },
          { binding: 5, resource: go },
          { binding: 6, resource: this.ageTex.createView() },
        ],
      });
      this.statsBG[dir] = d.createBindGroup({
        layout: this.statsPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: g },
          { binding: 3, resource: { buffer: this.statsBuf } },
        ],
      });
      this.stereoBG[dir] = d.createBindGroup({
        layout: this.stereoPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.stereoParamBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: g },
          { binding: 3, resource: { buffer: this.stereoBuf } },
        ],
      });
    }
  }

  /** the solute pair exists and the params ask for it — step() runs the alloy variant */
  get alloyActive(): boolean {
    return this.params.alloyOn === 1 && this.soluteTex.length === 2 && this.updateAlloyPipe != null;
  }
  soluteTexture(dir: number): GPUTexture | null { return this.soluteTex[dir] ?? null; }

  /**
   * Lazily allocate the solute ping-pong pair (+2·n³·4 B) and its bind groups.
   * Runtime allocation sits OUTSIDE the create-time OOM ladder, so it gets its
   * own error scope; failure leaves alloy off and reports false.
   */
  async enableAlloy(): Promise<boolean> {
    if (this.soluteTex.length === 2) { this.params.alloyOn = 1; return true; }
    if (!this.updateAlloyPipe) return false;
    const d = this.device;
    const n = this.n;
    d.pushErrorScope("out-of-memory");
    const mkTex = () => d.createTexture({
      size: [n, n, n], dimension: "3d", format: "r32float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    const pair = [mkTex(), mkTex()];
    const err = await d.popErrorScope();
    if (err) {
      for (const t of pair) t.destroy();
      this.params.alloyOn = 0;
      return false;
    }
    this.soluteTex = pair;
    this.fillSolute();
    for (const dir of [0, 1]) {
      this.updateAlloyBG[dir] = d.createBindGroup({
        layout: this.updateAlloyPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: this.stateTex[dir].createView() },
          { binding: 2, resource: this.grainTex[dir].createView() },
          { binding: 3, resource: this.fluxTex.createView() },
          { binding: 4, resource: this.stateTex[1 - dir].createView() },
          { binding: 5, resource: this.grainTex[1 - dir].createView() },
          { binding: 6, resource: this.ageTex.createView() },
          { binding: 7, resource: this.fedTex[0].createView() },
          { binding: 8, resource: this.soluteTex[dir].createView() },
          { binding: 9, resource: this.soluteTex[1 - dir].createView() },
          { binding: 10, resource: { buffer: this.quatBuf } },
          { binding: 11, resource: { buffer: this.twinCtrBuf } },
          { binding: 12, resource: this.maskTex.createView() },
        ],
      });
    }
    this.params.alloyOn = 1;
    return true;
  }

  get maskTexture(): GPUTexture { return this.maskTex; }

  /**
   * Rasterize the single-crystal grain selector: an open starter block, a
   * narrow helical channel (the turbine-blade "pigtail"), and an open blade
   * cavity above. Everything else in the selector band is mold wall.
   */
  private fillPigtail() {
    const n = this.n;
    const m = new Uint8Array(n * n * n);
    const cx = n / 2, cy = n / 2;
    const zStart = Math.floor(0.12 * n), zEnd = Math.floor(0.45 * n);
    const rCh = 0.055 * n;
    const rHel = 0.16 * n;
    const turns = 1.75;
    for (let z = zStart; z < zEnd; z++) {
      const u = (z - zStart) / (zEnd - zStart);
      const ang = u * turns * 2 * Math.PI;
      const hx = cx + rHel * Math.cos(ang);
      const hy = cy + rHel * Math.sin(ang);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const d2 = (x - hx) * (x - hx) + (y - hy) * (y - hy);
          m[(z * n + y) * n + x] = d2 < rCh * rCh ? 0 : 1;
        }
    }
    this.device.queue.writeTexture(
      { texture: this.maskTex }, m, { bytesPerRow: n, rowsPerImage: n }, [n, n, n]);
    this.maskReady = true;
  }

  disableAlloy() {
    this.params.alloyOn = 0;
    const old = this.soluteTex;
    this.soluteTex = [];
    this.updateAlloyBG = [];
    // the caller rebinds the renderer synchronously after this call; deferring
    // the destroy one microtask means no frame ever binds a dead texture
    queueMicrotask(() => { for (const t of old) t.destroy(); });
  }

  /** flood both solute textures with the far-field composition c0 */
  private fillSolute() {
    if (this.soluteTex.length !== 2) return;
    const n = this.n;
    const c = new Float32Array(n * n * n).fill(this.params.c0);
    for (const t of this.soluteTex)
      this.device.queue.writeTexture(
        { texture: t }, c, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
  }

  destroy() {
    for (const t of this.stateTex) t?.destroy();
    for (const t of this.grainTex) t?.destroy();
    this.fluxTex?.destroy();
    this.ageTex?.destroy();
    for (const t of this.fedTex) t?.destroy();
    for (const t of this.soluteTex) t?.destroy();
    this.maskTex?.destroy();
    this.paramBuf?.destroy();
    this.quatBuf?.destroy();
    this.quatStaging?.destroy();
    this.twinCtrBuf?.destroy();
    this.seedBuf?.destroy();
    this.statsBuf?.destroy();
    this.statsStaging?.destroy();
    this.stereoBuf?.destroy();
    this.stereoStaging?.destroy();
    this.stereoParamBuf?.destroy();
  }

  /** per-grain quaternions (CPU mirror) — read-only, for the IPF panel */
  get quats(): Float32Array { return this.quatCPU; }

  /** one-shot φ volume readback (n³ floats) — feeds the STL mesher */
  async readPhiVolume(): Promise<Float32Array | null> {
    const n = this.n;
    const buf = this.device.createBuffer({
      size: n * n * n * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: this.stateTex[this.dir] },
      { buffer: buf, bytesPerRow: n * 8, rowsPerImage: n },
      [n, n, n]);
    this.device.queue.submit([enc.finish()]);
    try {
      await buf.mapAsync(GPUMapMode.READ);
    } catch {
      buf.destroy();
      return null;
    }
    const raw = new Float32Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    const phi = new Float32Array(n * n * n);
    for (let i = 0; i < phi.length; i++) phi[i] = raw[i * 2];
    return phi;
  }

  reset(tFar = this.params.tFar) {
    const n = this.n;
    this.params.tFar = tFar;
    const state = new Float32Array(n * n * n * 2);
    // zeros first double as the age-texture clear
    this.device.queue.writeTexture(
      { texture: this.ageTex }, state, { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n]);
    for (let i = 0; i < n * n * n; i++) state[i * 2 + 1] = tFar;
    for (const t of this.stateTex)
      this.device.queue.writeTexture(
        { texture: t }, state, { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n]);
    const zeros = new Uint32Array(n * n * n);
    for (const t of this.grainTex)
      this.device.queue.writeTexture(
        { texture: t }, zeros, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    for (const t of this.fedTex)
      this.device.queue.writeTexture(
        { texture: t }, zeros, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    this.fillSolute();   // alloy melts re-pour at the far-field composition
    this.feedGen = 2;
    this.subAcc = 0;
    this.dir = 0;
    this.frame = 0;
    this.simTime = 0;
    this.nextId = 1;
    this.frontZ = 1;
    this.pendingSeeds = [];
    this.lastSeed = null;
    // identity quaternion everywhere (liquid cells read entry 0)
    this.quatCPU.fill(0);
    for (let i = 0; i < MAX_GRAINS3; i++) this.quatCPU[i * 4 + 3] = 1;
    this.device.queue.writeBuffer(this.quatBuf, 0, this.quatCPU);
    // GPU twin ids count DOWN from here (atomicSub returns pre-decrement;
    // MAX_GRAINS3−1 is the pore census slot)
    this.device.queue.writeBuffer(this.twinCtrBuf, 0, new Uint32Array([MAX_GRAINS3 - 2]));
  }

  /**
   * Refresh the CPU quaternion mirror from the GPU (twins are born GPU-side).
   * Call on the stats cadence while twinProb > 0; no-op when a read is in flight.
   */
  async refreshQuats(): Promise<void> {
    if (this.quatsInFlight) return;
    this.quatsInFlight = true;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.quatBuf, 0, this.quatStaging, 0, MAX_GRAINS3 * 16);
    this.device.queue.submit([enc.finish()]);
    try {
      await this.quatStaging.mapAsync(GPUMapMode.READ);
    } catch {
      this.quatsInFlight = false;
      return;
    }
    this.quatCPU.set(new Float32Array(this.quatStaging.getMappedRange().slice(0)));
    this.quatStaging.unmap();
    this.quatsInFlight = false;
  }

  /** Marsaglia (1972): uniform random rotation quaternion */
  private static randomQuat(): [number, number, number, number] {
    const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    return [
      a * Math.sin(2 * Math.PI * u2),
      a * Math.cos(2 * Math.PI * u2),
      b * Math.sin(2 * Math.PI * u3),
      b * Math.cos(2 * Math.PI * u3),
    ];
  }

  /**
   * queue a nucleus at voxel (x, y, z); returns the assigned grain id.
   * tact = activation temperature (2 = always fires; rain passes a distribution)
   */
  addSeed3D(x: number, y: number, z: number, r = 4, q?: [number, number, number, number], tact = 2.0): number {
    let id = this.nextId++;
    if (id >= MAX_GRAINS3 - 1) { this.nextId = 2; id = 1; }   // top id is PORE_ID
    const quat = q ?? Sim3D.randomQuat();
    this.quatCPU.set(quat, id * 4);
    this.device.queue.writeBuffer(this.quatBuf, id * 16, this.quatCPU, id * 4, 4);
    this.pendingSeeds.push({ x, y, z, r, id, tact });
    this.lastSeed = { x, y, z };
    return id;
  }

  /** one-shot uniform temperature drop; stacks if pressed again */
  quench(dT = 0.25) { this.pendingQuench += dT; }

  private static qmul(a: number[], b: number[]): [number, number, number, number] {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  }
  private static qrotV(q: number[], v: number[]): [number, number, number] {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
      v[0] + w * tx + (y * tz - z * ty),
      v[1] + w * ty + (z * tx - x * tz),
      v[2] + w * tz + (x * ty - y * tx),
    ];
  }

  /**
   * Σ3 coherent twin: two half-offset seeds, the second rotated 60° about one
   * of the FIRST grain's ⟨111⟩ axes — real cubic twin crystallography.
   */
  addTwinSeed3D(x: number, y: number, z: number, r = 4) {
    const q1 = Sim3D.randomQuat();
    const s = 1 / Math.sqrt(3);
    const axC = [
      (Math.random() < 0.5 ? -1 : 1) * s,
      (Math.random() < 0.5 ? -1 : 1) * s,
      (Math.random() < 0.5 ? -1 : 1) * s,
    ];
    const axLab = Sim3D.qrotV(q1, axC);
    const half = Math.PI / 6;   // 60° rotation
    const q60 = [Math.sin(half) * axLab[0], Math.sin(half) * axLab[1], Math.sin(half) * axLab[2], Math.cos(half)];
    const q2 = Sim3D.qmul(q60, q1);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const off = r * 0.45;
    const dx = Math.sin(ph) * Math.cos(th) * off;
    const dy = Math.sin(ph) * Math.sin(th) * off;
    const dz = Math.cos(ph) * off;
    this.addSeed3D(x - dx, y - dy, z - dz, r, q1);
    this.addSeed3D(x + dx, y + dy, z + dz, r, q2);
  }

  /** chill floor: jittered seed grid on the bottom face (opposite the riser) */
  chillFloor(count = 8) {
    const n = this.n;
    for (let i = 0; i < count; i++)
      for (let j = 0; j < count; j++) {
        const jx = ((i + 0.5) / count + (Math.random() - 0.5) * 0.5 / count) * n;
        const jy = ((j + 0.5) / count + (Math.random() - 0.5) * 0.5 / count) * n;
        this.addSeed3D(jx, jy, 2, 3.5);
      }
  }

  private writeParams(
    seedCount: number,
    plane?: { n: [number, number, number]; c: number },
    target?: GPUBuffer,
  ) {
    const p = this.params;
    const u = new Uint32Array(this.paramData);
    const f = new Float32Array(this.paramData);
    f[P3.sliceN] = plane?.n[0] ?? 0; f[P3.sliceN + 1] = plane?.n[1] ?? 0;
    f[P3.sliceN + 2] = plane?.n[2] ?? 0; f[P3.sliceN + 3] = plane?.c ?? 0;
    u[P3.n] = this.n;
    u[P3.frame] = this.frame;
    f[P3.dx] = p.dx; f[P3.dt] = p.dt;
    f[P3.epsBar] = p.epsBar; f[P3.delta] = p.delta;
    u[P3.aniMode3] = p.aniMode3; f[P3.tau] = p.tau;
    f[P3.alpha] = p.alpha; f[P3.gamma] = p.gamma;
    f[P3.latent] = p.latent; f[P3.noiseAmp] = p.noiseAmp;
    f[P3.tFar] = p.tFar; f[P3.coolRate] = p.coolRate; f[P3.heatIn] = p.heatIn;
    u[P3.seedCount] = seedCount;
    f[P3.time] = this.simTime;
    f[P3.deltaZ] = p.deltaZ;
    f[P3.quenchDT] = this.pendingQuench;
    u[P3.curGen] = this.feedGen;
    f[P3.pPore] = p.pPore;
    u[P3.scen] = p.scen;
    f[P3.gradG] = p.gradG;
    f[P3.frontZ] = this.frontZ;
    f[P3.weldX] = p.weldX; f[P3.weldY] = p.weldY;
    f[P3.weldPow] = p.weldPow; f[P3.weldSig] = p.weldSig;
    u[P3.alloyOn] = p.alloyOn;
    f[P3.c0] = p.c0; f[P3.mLiq] = p.mLiq;
    f[P3.kPart] = p.kPart; f[P3.dSol] = p.dSol;
    f[P3.twinProb] = p.twinProb;
    u[P3.idFloor] = this.nextId;
    f[P3.facet] = p.facet;
    u[P3.probeX] = this.probe ? Math.floor(this.probe.x) : 0xffffffff;
    u[P3.probeY] = this.probe ? Math.floor(this.probe.y) : 0xffffffff;
    u[P3.probeZ] = this.probe ? Math.floor(this.probe.z) : 0xffffffff;
    this.device.queue.writeBuffer(target ?? this.paramBuf, 0, this.paramData);
  }

  private dispatch(pass: GPUComputePassEncoder) {
    const wg = Math.ceil(this.n / 4);
    pass.dispatchWorkgroups(wg, wg, wg);
  }

  /**
   * Advance by `substeps` explicit Euler steps (0 = stamp seeds only).
   * Single command submission; skips while the GPU is >= 2 frames behind.
   */
  step(substeps: number): number {
    if (this.busy) return 0;
    // bridgman + selector: the reference isotherm rides sim time (2D frontX port)
    if (this.params.scen === 1 || this.params.scen === 3)
      this.frontZ = 1 + this.params.pullV * this.simTime;
    // entering the selector scenario rasterizes the pigtail on demand
    if (this.params.scen === 3 && !this.maskReady) this.fillPigtail();
    const d = this.device;
    const cap = Math.max(1, Math.floor(1.6e8 / (this.n * this.n * this.n)));
    const steps = Math.min(substeps, cap);

    let seedCount = 0;
    if (this.pendingSeeds.length > 0) {
      const batch = this.pendingSeeds.splice(0, MAX_SEEDS3);
      const sd = new Float32Array(batch.length * SEED3_STRIDE);
      batch.forEach((s, i) => {
        const b = i * SEED3_STRIDE;
        sd[b] = s.x; sd[b + 1] = s.y; sd[b + 2] = s.z;
        sd[b + 3] = s.r; sd[b + 4] = s.id; sd[b + 5] = s.tact;
      });
      d.queue.writeBuffer(this.seedBuf, 0, sd);
      seedCount = batch.length;
    }
    const doStamp = seedCount > 0 || this.pendingQuench !== 0;
    if (steps === 0 && !doStamp) return 0;
    this.frame++;
    // generations advance in PHYSICS time (2n substeps), and flood iterations
    // scale with substeps, so each generation always accumulates ≥ n iterations
    // whatever the wall-clock speed — turbo can't outrun the connectivity check
    this.subAcc += steps;
    if (this.subAcc >= 2 * this.n) { this.subAcc -= 2 * this.n; this.feedGen++; }
    this.writeParams(seedCount);
    this.pendingQuench = 0;

    const alloy = this.alloyActive;
    const enc = d.createCommandEncoder();
    // STAMP flips the state ping-pong without writing solute — mirror the flip
    // by copying solute across BEFORE the compute pass, or the pair desyncs
    if (doStamp && alloy)
      enc.copyTextureToTexture(
        { texture: this.soluteTex[this.dir] }, { texture: this.soluteTex[1 - this.dir] },
        [this.n, this.n, this.n]);
    const pass = enc.beginComputePass();
    let dir = this.dir;
    // even iteration count keeps the result in fedTex[0], which UPDATE binds
    if (this.params.pPore > 0 && steps > 0) {
      const feedIters = Math.min(24, Math.max(2, 2 * Math.ceil(steps / 4)));
      pass.setPipeline(this.feedPipe);
      for (let i = 0; i < feedIters; i++) {
        pass.setBindGroup(0, this.feedBG[dir][i % 2]);
        this.dispatch(pass);
      }
    }
    if (doStamp) {
      pass.setPipeline(this.stampPipe);
      pass.setBindGroup(0, this.stampBG[dir]);
      this.dispatch(pass);
      dir = 1 - dir;
    }
    for (let i = 0; i < steps; i++) {
      pass.setPipeline(this.fluxPipe);
      pass.setBindGroup(0, this.fluxBG[dir]);
      this.dispatch(pass);
      pass.setPipeline(alloy ? this.updateAlloyPipe! : this.updatePipe);
      pass.setBindGroup(0, alloy ? this.updateAlloyBG[dir] : this.updateBG[dir]);
      this.dispatch(pass);
      dir = 1 - dir;
    }
    pass.end();
    d.queue.submit([enc.finish()]);
    this.dir = dir;
    this.simTime += steps * this.params.dt;
    this.inFlight++;
    d.queue.onSubmittedWorkDone().then(() => { this.inFlight = Math.max(0, this.inFlight - 1); });
    return steps;
  }

  /**
   * per-grain section areas on an arbitrary plane — the stereology instrument.
   * Resolves null when a read is already in flight.
   */
  async readStereo(plane: { n: [number, number, number]; c: number }):
    Promise<{ sections: { id: number; areaVox: number }[]; poreVox: number } | null> {
    if (this.stereoInFlight) return null;
    this.stereoInFlight = true;
    const d = this.device;
    this.writeParams(0, plane, this.stereoParamBuf);
    const enc = d.createCommandEncoder();
    enc.clearBuffer(this.stereoBuf);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.stereoPipe);
    pass.setBindGroup(0, this.stereoBG[this.dir]);
    this.dispatch(pass);
    pass.end();
    enc.copyBufferToBuffer(this.stereoBuf, 0, this.stereoStaging, 0, this.stereoBuf.size);
    d.queue.submit([enc.finish()]);
    try {
      await this.stereoStaging.mapAsync(GPUMapMode.READ);
    } catch {
      this.stereoInFlight = false;
      return null;
    }
    const data = new Uint32Array(this.stereoStaging.getMappedRange().slice(0));
    this.stereoStaging.unmap();
    this.stereoInFlight = false;
    const sections: { id: number; areaVox: number }[] = [];
    for (let i = 1; i < MAX_GRAINS3 - 1; i++) {
      const c = data[8 + i];
      if (c >= 4) sections.push({ id: i, areaVox: c });
    }
    return { sections, poreVox: data[8 + PORE_ID] };
  }

  /** async GPU reduction; resolves null if one is already in flight */
  async readStats(): Promise<StatsResult3D | null> {
    if (this.statsInFlight) return null;
    this.statsInFlight = true;
    const d = this.device;
    this.writeParams(0);
    const enc = d.createCommandEncoder();
    enc.clearBuffer(this.statsBuf);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.statsPipe);
    pass.setBindGroup(0, this.statsBG[this.dir]);
    this.dispatch(pass);
    pass.end();
    enc.copyBufferToBuffer(this.statsBuf, 0, this.statsStaging, 0, this.statsBuf.size);
    d.queue.submit([enc.finish()]);
    try {
      await this.statsStaging.mapAsync(GPUMapMode.READ);
    } catch {
      this.statsInFlight = false;
      return null;
    }
    const data = new Uint32Array(this.statsStaging.getMappedRange().slice(0));
    this.statsStaging.unmap();
    this.statsInFlight = false;

    const total = this.n * this.n * this.n;
    const solid = data[0];
    const minVox = Math.max(64, total * 1e-5);
    let volSum = 0;
    const grains: { id: number; vox: number }[] = [];
    for (let i = 1; i < MAX_GRAINS3 - 1; i++) {   // top id is the pore census
      const c = data[8 + i];
      if (c > minVox) { volSum += c; grains.push({ id: i, vox: c }); }
    }
    const count = grains.length;
    const meanVolVox = count > 0 ? volSum / count : 0;
    // same dx as the 2D reference grid (1024 cells / mm) → same physical voxel
    const umPerVox = (DOMAIN_MM * 1000) / 1024;
    const eqDiamUm = meanVolVox > 0
      ? Math.cbrt((6 * meanVolVox) / Math.PI) * umPerVox
      : null;
    const interf = data[1];
    const interfaceT = interf > 0 ? data[2] / 1000 / interf - 1 : 0;
    return {
      fracSolid: solid / total, grainCount: count, meanVolVox, eqDiamUm,
      poreFrac: data[8 + PORE_ID] / total, interfaceT,
      probeT: this.probe ? data[4] / 1000 - 1 : null,
      probePhi: this.probe ? data[5] / 1000 : null,
      grains,
    };
  }
}
