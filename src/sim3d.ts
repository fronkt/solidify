// TRUE-3D simulation core: the Kobayashi model on an n³ voxel grid.
// Mirrors the 2D Simulation class (sim.ts) — same ping-pong / busy-guard /
// stats-reduction structure — with 3D textures, per-grain quaternion
// orientations, and an out-of-memory creation ladder for weaker GPUs.

import {
  FLUX3D_WGSL, UPDATE3D_WGSL, STAMP3D_WGSL, STATS3D_WGSL,
  MAX_GRAINS3, MAX_SEEDS3, SEED3_STRIDE, P3,
} from "./shaders3d";
import { DOMAIN_MM } from "./sim";

export interface Phys3DParams {
  dx: number;
  dt: number;
  epsBar: number;
  delta: number;
  deltaZ: number;     // hex: c-axis penalty (plates)
  aniMode3: number;   // 0 isotropic, 1 cubic, 2 hex
  tau: number;
  alpha: number;
  gamma: number;
  latent: number;
  noiseAmp: number;
  tFar: number;
  coolRate: number;
  heatIn: number;
  meltGlow: number;   // display-only, carried from the material
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
};

export interface StatsResult3D {
  fracSolid: number;
  grainCount: number;
  meanVolVox: number;
  eqDiamUm: number | null;   // volume-equivalent sphere diameter
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

  private stateTex: GPUTexture[] = [];
  private grainTex: GPUTexture[] = [];
  private fluxTex!: GPUTexture;
  private paramBuf!: GPUBuffer;
  private quatBuf!: GPUBuffer;
  private seedBuf!: GPUBuffer;
  private statsBuf!: GPUBuffer;
  private statsStaging!: GPUBuffer;
  private quatCPU = new Float32Array(MAX_GRAINS3 * 4);

  private fluxPipe!: GPUComputePipeline;
  private updatePipe!: GPUComputePipeline;
  private stampPipe!: GPUComputePipeline;
  private statsPipe!: GPUComputePipeline;
  private fluxBG: GPUBindGroup[] = [];
  private updateBG: GPUBindGroup[] = [];
  private stampBG: GPUBindGroup[] = [];
  private statsBG: GPUBindGroup[] = [];

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
    const ladder = [192, 160, 128].filter(v => v <= n);
    if (!ladder.length) ladder.push(128);
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

  private build() {
    const d = this.device;
    const n = this.n;
    const texDesc = (format: GPUTextureFormat): GPUTextureDescriptor => ({
      size: [n, n, n],
      dimension: "3d",
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.stateTex = [d.createTexture(texDesc("rg32float")), d.createTexture(texDesc("rg32float"))];
    this.grainTex = [d.createTexture(texDesc("r32uint")), d.createTexture(texDesc("r32uint"))];
    this.fluxTex = d.createTexture(texDesc("rgba32float"));

    this.paramBuf = d.createBuffer({ size: P3.BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.quatBuf = d.createBuffer({ size: MAX_GRAINS3 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.seedBuf = d.createBuffer({ size: MAX_SEEDS3 * SEED3_STRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const statsSize = (8 + MAX_GRAINS3) * 4;
    this.statsBuf = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.statsStaging = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const mk = (code: string) =>
      d.createComputePipeline({ layout: "auto", compute: { module: d.createShaderModule({ code }), entryPoint: "main" } });
    this.fluxPipe = mk(FLUX3D_WGSL);
    this.updatePipe = mk(UPDATE3D_WGSL);
    this.stampPipe = mk(STAMP3D_WGSL);
    this.statsPipe = mk(STATS3D_WGSL);

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
        ],
      });
      this.stampBG[dir] = d.createBindGroup({
        layout: this.stampPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: g },
          { binding: 3, resource: { buffer: this.seedBuf } },
          { binding: 4, resource: so },
          { binding: 5, resource: go },
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
    }
  }

  destroy() {
    for (const t of this.stateTex) t?.destroy();
    for (const t of this.grainTex) t?.destroy();
    this.fluxTex?.destroy();
    this.paramBuf?.destroy();
    this.quatBuf?.destroy();
    this.seedBuf?.destroy();
    this.statsBuf?.destroy();
    this.statsStaging?.destroy();
  }

  reset(tFar = this.params.tFar) {
    const n = this.n;
    this.params.tFar = tFar;
    const state = new Float32Array(n * n * n * 2);
    for (let i = 0; i < n * n * n; i++) state[i * 2 + 1] = tFar;
    for (const t of this.stateTex)
      this.device.queue.writeTexture(
        { texture: t }, state, { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n]);
    const zeros = new Uint32Array(n * n * n);
    for (const t of this.grainTex)
      this.device.queue.writeTexture(
        { texture: t }, zeros, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    this.dir = 0;
    this.frame = 0;
    this.simTime = 0;
    this.nextId = 1;
    this.pendingSeeds = [];
    this.lastSeed = null;
    // identity quaternion everywhere (liquid cells read entry 0)
    this.quatCPU.fill(0);
    for (let i = 0; i < MAX_GRAINS3; i++) this.quatCPU[i * 4 + 3] = 1;
    this.device.queue.writeBuffer(this.quatBuf, 0, this.quatCPU);
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
    if (id >= MAX_GRAINS3) { this.nextId = 2; id = 1; }
    const quat = q ?? Sim3D.randomQuat();
    this.quatCPU.set(quat, id * 4);
    this.device.queue.writeBuffer(this.quatBuf, id * 16, this.quatCPU, id * 4, 4);
    this.pendingSeeds.push({ x, y, z, r, id, tact });
    this.lastSeed = { x, y, z };
    return id;
  }

  /** one-shot uniform temperature drop; stacks if pressed again */
  quench(dT = 0.25) { this.pendingQuench += dT; }

  private writeParams(seedCount: number) {
    const p = this.params;
    const u = new Uint32Array(this.paramData);
    const f = new Float32Array(this.paramData);
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
    this.device.queue.writeBuffer(this.paramBuf, 0, this.paramData);
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
    this.writeParams(seedCount);
    this.pendingQuench = 0;

    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    let dir = this.dir;
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
      pass.setPipeline(this.updatePipe);
      pass.setBindGroup(0, this.updateBG[dir]);
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
    let count = 0;
    for (let i = 1; i < MAX_GRAINS3; i++) {
      const c = data[8 + i];
      if (c > minVox) { volSum += c; count++; }
    }
    const meanVolVox = count > 0 ? volSum / count : 0;
    // same dx as the 2D reference grid (1024 cells / mm) → same physical voxel
    const umPerVox = (DOMAIN_MM * 1000) / 1024;
    const eqDiamUm = meanVolVox > 0
      ? Math.cbrt((6 * meanVolVox) / Math.PI) * umPerVox
      : null;
    return { fracSolid: solid / total, grainCount: count, meanVolVox, eqDiamUm };
  }
}
