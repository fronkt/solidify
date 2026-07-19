import { FLUX_WGSL, UPDATE_WGSL, STAMP_WGSL, STATS_WGSL, MAX_GRAINS, MAX_SEEDS } from "./shaders";

export interface PhysParams {
  dx: number;
  dt: number;
  epsBar: number;
  delta: number;
  aniMode: number;
  tau: number;
  alpha: number;
  gamma: number;
  latent: number;
  noiseAmp: number;
  tFar: number;
  coolRate: number;
  heatIn: number;
}

export const DEFAULTS: PhysParams = {
  // canonical Kobayashi '93 values, dt with explicit-stability margin
  dx: 0.03,
  dt: 1.2e-4,
  epsBar: 0.01,
  delta: 0.04,
  aniMode: 4,
  tau: 3.0e-4,
  alpha: 0.9,
  gamma: 10.0,
  latent: 1.6,
  noiseAmp: 0.01,
  tFar: 0.0,
  coolRate: 0.0,
  heatIn: 0.0,
};

export interface StatsResult {
  fracSolid: number;
  grainCount: number;
  meanAreaPx: number;
  astm: number | null;       // needs a physical scale; domain is DOMAIN_MM wide
  interfaceT: number;        // mean T on the interface band
  diamsUm: number[];         // equivalent grain diameters, µm
}

export const DOMAIN_MM = 1.0; // nominal physical width of the domain

interface Seed { x: number; y: number; r: number; id: number }

export class Simulation {
  readonly device: GPUDevice;
  n: number;
  params: PhysParams;
  frame = 0;      // substep counter (noise salt)
  simTime = 0;    // dimensionless sim time
  dir = 0;        // which state/grain texture is current
  nextId = 1;

  private stateTex: GPUTexture[] = [];
  private grainTex: GPUTexture[] = [];
  private fluxTex!: GPUTexture;
  private paramBuf!: GPUBuffer;
  private theta0Buf!: GPUBuffer;
  private seedBuf!: GPUBuffer;
  private statsBuf!: GPUBuffer;
  private statsStaging!: GPUBuffer;
  private theta0CPU = new Float32Array(MAX_GRAINS);

  private fluxPipe!: GPUComputePipeline;
  private updatePipe!: GPUComputePipeline;
  private stampPipe!: GPUComputePipeline;
  private statsPipe!: GPUComputePipeline;
  private fluxBG: GPUBindGroup[] = [];
  private updateBG: GPUBindGroup[] = [];
  private stampBG: GPUBindGroup[] = [];
  private statsBG: GPUBindGroup[] = [];

  private pendingSeeds: Seed[] = [];
  private statsInFlight = false;
  private paramData = new ArrayBuffer(64);
  private inFlight = 0;

  /** true when the GPU is >= 2 submitted frames behind — callers should skip stepping */
  get busy() { return this.inFlight >= 2; }

  constructor(device: GPUDevice, n: number) {
    this.device = device;
    this.n = n;
    this.params = { ...DEFAULTS };
    this.build();
  }

  get theta0Buffer() { return this.theta0Buf; }
  stateTexture(dir: number) { return this.stateTex[dir]; }
  grainTexture(dir: number) { return this.grainTex[dir]; }

  private build() {
    const d = this.device;
    const n = this.n;
    const texDesc = (format: GPUTextureFormat): GPUTextureDescriptor => ({
      size: [n, n],
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST,
    });
    this.stateTex = [d.createTexture(texDesc("rg32float")), d.createTexture(texDesc("rg32float"))];
    this.grainTex = [d.createTexture(texDesc("r32uint")), d.createTexture(texDesc("r32uint"))];
    this.fluxTex = d.createTexture(texDesc("rgba32float"));

    this.paramBuf = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.theta0Buf = d.createBuffer({ size: MAX_GRAINS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.seedBuf = d.createBuffer({ size: MAX_SEEDS * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const statsSize = (4 + MAX_GRAINS) * 4;
    this.statsBuf = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.statsStaging = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const mk = (code: string) =>
      d.createComputePipeline({ layout: "auto", compute: { module: d.createShaderModule({ code }), entryPoint: "main" } });
    this.fluxPipe = mk(FLUX_WGSL);
    this.updatePipe = mk(UPDATE_WGSL);
    this.stampPipe = mk(STAMP_WGSL);
    this.statsPipe = mk(STATS_WGSL);

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
          { binding: 3, resource: { buffer: this.theta0Buf } },
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
    this.reset();
  }

  reset(tFar = this.params.tFar) {
    const n = this.n;
    this.params.tFar = tFar;
    const state = new Float32Array(n * n * 2);
    for (let i = 0; i < n * n; i++) state[i * 2 + 1] = tFar;
    this.device.queue.writeTexture(
      { texture: this.stateTex[0] }, state, { bytesPerRow: n * 8 }, [n, n]);
    this.device.queue.writeTexture(
      { texture: this.stateTex[1] }, state, { bytesPerRow: n * 8 }, [n, n]);
    const zeros = new Uint32Array(n * n);
    this.device.queue.writeTexture(
      { texture: this.grainTex[0] }, zeros, { bytesPerRow: n * 4 }, [n, n]);
    this.device.queue.writeTexture(
      { texture: this.grainTex[1] }, zeros, { bytesPerRow: n * 4 }, [n, n]);
    this.dir = 0;
    this.frame = 0;
    this.simTime = 0;
    this.nextId = 1;
    this.pendingSeeds = [];
    this.theta0CPU.fill(0);
    this.device.queue.writeBuffer(this.theta0Buf, 0, this.theta0CPU);
  }

  /** queue a nucleus; x, y in grid cells; returns assigned grain id */
  addSeed(x: number, y: number, r = 4, theta0?: number): number {
    let id = this.nextId++;
    if (id >= MAX_GRAINS) { this.nextId = 2; id = 1; }
    const th = theta0 ?? Math.random() * (2 * Math.PI / this.params.aniMode);
    this.theta0CPU[id] = th;
    this.device.queue.writeBuffer(this.theta0Buf, id * 4, this.theta0CPU, id, 1);
    this.pendingSeeds.push({ x, y, r, id });
    return id;
  }

  chillWall(edge: "bottom" | "left" = "bottom", count = 42) {
    const n = this.n;
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count + (Math.random() - 0.5) * 0.6 / count) * n;
      if (edge === "bottom") this.addSeed(t, n - 3, 3.5);
      else this.addSeed(3, t, 3.5);
    }
  }

  private writeParams(seedCount: number) {
    const p = this.params;
    const u = new Uint32Array(this.paramData);
    const f = new Float32Array(this.paramData);
    u[0] = this.n;
    u[1] = this.frame;
    f[2] = p.dx; f[3] = p.dt;
    f[4] = p.epsBar; f[5] = p.delta; f[6] = p.aniMode; f[7] = p.tau;
    f[8] = p.alpha; f[9] = p.gamma; f[10] = p.latent; f[11] = p.noiseAmp;
    f[12] = p.tFar; f[13] = p.coolRate; f[14] = p.heatIn;
    u[15] = seedCount;
    this.device.queue.writeBuffer(this.paramBuf, 0, this.paramData);
  }

  private dispatch(pass: GPUComputePassEncoder) {
    const wg = Math.ceil(this.n / 8);
    pass.dispatchWorkgroups(wg, wg);
  }

  /**
   * Advance the field by `substeps` explicit Euler steps.
   * Single command submission per call; WebGPU synchronizes successive
   * dispatches on the same resources. Skips (returns 0) while the GPU is
   * still behind, so a slow device can never accumulate an unbounded queue.
   */
  step(substeps: number): number {
    if (this.busy) return 0;
    const d = this.device;
    // never ask one frame for more cell-updates than a mid-range GPU sustains
    const cap = Math.max(1, Math.floor(1.6e8 / (this.n * this.n)));
    const steps = Math.min(substeps, cap);

    let seedCount = 0;
    if (this.pendingSeeds.length > 0) {
      const batch = this.pendingSeeds.splice(0, MAX_SEEDS);
      const sd = new Float32Array(batch.length * 4);
      batch.forEach((s, i) => {
        sd[i * 4] = s.x; sd[i * 4 + 1] = s.y; sd[i * 4 + 2] = s.r; sd[i * 4 + 3] = s.id;
      });
      d.queue.writeBuffer(this.seedBuf, 0, sd);
      seedCount = batch.length;
    }
    this.frame++;
    this.writeParams(seedCount);

    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    let dir = this.dir;
    if (seedCount > 0) {
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

  /** async GPU reduction; resolves to stats or null if one is already in flight */
  async readStats(): Promise<StatsResult | null> {
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

    const total = this.n * this.n;
    const solid = data[0];
    const interf = data[1];
    const interfT = interf > 0 ? data[2] / 1000 / interf : 0;
    const minPx = Math.max(20, this.n * this.n * 1e-5);
    const umPerPx = (DOMAIN_MM * 1000) / this.n;
    const diams: number[] = [];
    let areaSum = 0;
    for (let i = 1; i < MAX_GRAINS; i++) {
      const c = data[4 + i];
      if (c > minPx) {
        areaSum += c;
        diams.push(2 * Math.sqrt(c / Math.PI) * umPerPx);
      }
    }
    const count = diams.length;
    const meanAreaPx = count > 0 ? areaSum / count : 0;
    let astm: number | null = null;
    if (count >= 3 && meanAreaPx > 0) {
      // ASTM E112: G = 3.322 log10(N_A per mm^2) - 2.954, from mean grain area
      const meanAreaMm2 = meanAreaPx * (umPerPx / 1000) ** 2;
      astm = 3.322 * Math.log10(1 / meanAreaMm2) - 2.954;
    }
    return { fracSolid: solid / total, grainCount: count, meanAreaPx, astm, interfaceT: interfT, diamsUm: diams };
  }
}
